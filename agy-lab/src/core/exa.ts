// Exa web search, the second search provider for contact research. Keys live in
// the gemini_contact_key table (kind 'exa') and rotate round-robin like Tavily's.
// Exa has no usage endpoint to read, so a key rests on the error that says it is
// spent: out of credits or refused rests it for a day, a rate limit for a minute,
// and the hub counts each key's spend itself from the costDollars on each answer.
import * as db from '../reportdb.ts';
import { startCall, type ApiCall } from '../cost.ts';
import { createKeyPool, type Lease, type SearchHit } from './tavily.ts';
import { isProxy, noKeyRestMs, parseProxy, proxy, setProxy, usage, withProxy } from './proxy.ts';
import * as vault from './vault.ts';

export { PROXY_SOURCE, isProxy, parseProxy, proxy, setProxy, type ProxyConfig } from './proxy.ts';

export const KEY_CONCURRENCY = 2;
// An hour, not a day: Exa's free credit comes back each month, and on
// 2026-11-01 a day's rest kept refilled keys idle. A refused call costs nothing.
const OUT_OF_CREDIT_REST_MS = 60 * 60_000;
const RATE_LIMIT_REST_MS = 60_000;

type FetchImpl = typeof fetch;

export const pool = createKeyPool({ concurrency: KEY_CONCURRENCY });

export function available(): boolean {
  return pool.slots() > 0;
}

// What each key spent, counted from the costDollars on every answer, so the
// /auto-queue page can show it. Held in memory and written once a minute.
type Tally = { calls: number; dollars: number; failures: number; lastOkAt: string | null; lastError: string | null; lastErrorAt: string | null };
const tallies = new Map<string, Tally>();
let flushTimer: NodeJS.Timeout | null = null;

/** Count one Exa call against its key: what it cost, or the error it hit. */
export function record(apiKey: string, outcome: { dollars?: number; error?: string }): void {
  const t = tallies.get(apiKey) ?? { calls: 0, dollars: 0, failures: 0, lastOkAt: null, lastError: null, lastErrorAt: null };
  t.calls++;
  if (outcome.error) { t.failures++; t.lastError = outcome.error.slice(0, 300); t.lastErrorAt = new Date().toISOString(); }
  else { t.dollars += outcome.dollars ?? 0; t.lastOkAt = new Date().toISOString(); }
  tallies.set(apiKey, t);
  flushTimer ??= setInterval(() => { void flush(); }, 60_000).unref();
}

export async function flush(): Promise<void> {
  const batch = [...tallies.entries()];
  tallies.clear();
  for (const [secret, t] of batch) {
    await db.addSearchKeySpend('exa', secret, t).catch((e: Error) => console.warn('[exa] could not save key spend: ' + e.message));
  }
}

// The US proxy (core/proxy.ts) is one more source in this pool, PROXY_SOURCE:
// its calls carry only the proxy token, and the proxy picks among the Exa keys
// it holds. A key saved as "us:<key>" is still sent through the proxy as that
// key (x-api-key), which the proxy passes on as it is.
export const PROXY_PREFIX = 'us:';
const DIRECT_API = 'https://api.exa.ai';

export function via(secret: string): 'us' | 'direct' {
  return isProxy(secret) || secret.startsWith(PROXY_PREFIX) ? 'us' : 'direct';
}

/** Where one key's call goes, with its headers. A proxy call with no proxy saved gets a 'quota' error, so only that source rests. */
export function endpoint(secret: string, path: string): { url: string; headers: Record<string, string> } {
  if (via(secret) === 'direct') return { url: `${DIRECT_API}/${path}`, headers: { 'x-api-key': secret, 'content-type': 'application/json' } };
  const saved = proxy();
  if (!saved) throw Object.assign(new Error('exa proxy is not saved: POST exaProxy {url, token} to /api/contact-keys'), { code: 'quota', provider: 'exa' });
  return {
    url: `${saved.url}/${path}`,
    headers: { ...(isProxy(secret) ? {} : { 'x-api-key': secret.slice(PROXY_PREFIX.length) }), 'x-proxy-token': saved.token, 'content-type': 'application/json' },
  };
}

/** What the proxy says about the Exa keys it holds (GET /usage): spend, estimated credit left, resting keys. */
export async function proxyUsage(fetchImpl: FetchImpl = fetch): Promise<Record<string, any> | null> {
  return usage('exa', fetchImpl);
}

export async function loadKeys(env: NodeJS.ProcessEnv = process.env): Promise<string[]> {
  let keys: string[] = [];
  try {
    const rows = await db.listGeminiContactKeys();
    keys = rows.filter((row) => row.kind === 'exa').map((row) => row.secret);
    setProxy(parseProxy(rows.find((row) => row.kind === 'exa_proxy')?.secret ?? ''));
  } catch { /* database table created on migrate; caller without db uses env */ }
  if (!keys.length) {
    keys = String(env.EXA_API_KEYS ?? env.EXA_API_KEY ?? vault.secret('EXA_API_KEY')).split(/[,\n]/).map((k) => k.trim()).filter(Boolean);
  }
  return keys;
}

/** Reload the keys into the shared pool, with the US proxy as one more source, and return the saved keys. */
export async function refresh(env: NodeJS.ProcessEnv = process.env): Promise<string[]> {
  const keys = await loadKeys(env);
  pool.setKeys(withProxy(keys));
  keysLoadedAt = Date.now();
  return keys;
}

/** Pool calls reload the keys at most this often; a job start or /workers save reloads them at once. */
const KEYS_RELOAD_MS = 30_000;
let keysLoadedAt = 0;

async function ensureKeys(): Promise<void> {
  if (Date.now() - keysLoadedAt > KEYS_RELOAD_MS) await refresh();
}

/** Tests: fill the pool with these keys and stop reloading it; null goes back to the saved keys. */
export function setKeysForTests(keys: string[] | null): void {
  pool.setKeys(keys ?? []);
  keysLoadedAt = keys ? Infinity : 0;
}

function fail(message: string, code: string): Error {
  return Object.assign(new Error(message), { code });
}

type SearchOpts = { numResults?: number; includeDomains?: string[]; timeoutMs?: number; fetchImpl?: FetchImpl; log?: ApiCall[]; what?: string };
type CallOpts = { what?: string; log?: ApiCall[]; timeoutMs?: number; fetchImpl?: FetchImpl };

/**
 * Any Exa endpoint (search, contents, answer) with one key: the request every
 * Exa call in the app ends in. Errors carry the codes releaseFor reads
 * (rate_limit, quota, timeout). Counts the key's spend and logs one ApiCall,
 * priced by Exa's own costDollars when it sends one.
 */
export async function requestWithKey(path: string, body: Record<string, unknown>, apiKey: string, opts: CallOpts = {}): Promise<Record<string, any>> {
  const call = startCall('exa', opts.what ?? `${path}: ${String(body.query ?? '').slice(0, 200)}`, { provider: `exa ${via(apiKey)}` });
  try {
    const out = await requestOnce(path, body, apiKey, opts);
    const dollars = Number(out.costDollars?.total ?? 0);
    record(apiKey, { dollars });
    opts.log?.push(call.done({ ok: true, results: Array.isArray(out.results) ? out.results.length : undefined, ...(out.costDollars?.total != null ? { usd: dollars } : {}) }));
    return out;
  } catch (cause) {
    record(apiKey, { error: (cause as Error).message ?? String(cause) });
    opts.log?.push(call.done({ ok: false, note: (cause as Error).message.slice(0, 200) }));
    throw cause;
  }
}

async function requestOnce(path: string, body: Record<string, unknown>, apiKey: string, opts: CallOpts): Promise<Record<string, any>> {
  const target = endpoint(apiKey, path);
  let res: Response;
  try {
    res = await (opts.fetchImpl ?? fetch)(target.url, {
      method: 'POST',
      headers: target.headers,
      body: JSON.stringify(body),
      ...(opts.timeoutMs ? { signal: AbortSignal.timeout(opts.timeoutMs) } : {}),
    });
  } catch (cause) {
    const name = cause instanceof Error ? cause.name : '';
    throw fail(name === 'TimeoutError' || name === 'AbortError' ? `exa ${path} timed out` : `upstream error: ${(cause as Error)?.message ?? cause}`, 'timeout');
  }
  const raw = await res.text();
  const noKey = noKeyRestMs(res, raw);
  if (noKey) throw Object.assign(fail(`US proxy has no usable Exa key: ${raw.slice(0, 200)}`, 'quota'), { restMs: noKey, provider: 'exa' });
  if (res.status === 429) throw fail(`429 rate_limit_error: exa rate limit: ${raw.slice(0, 200)}`, 'rate_limit');
  if (res.status === 401 || res.status === 402 || res.status === 403 || (!res.ok && /credit|balance|billing|quota|payment/i.test(raw))) {
    throw fail(`exa key refused or out of credits (${res.status}): ${raw.slice(0, 200)}`, 'quota');
  }
  if (!res.ok) throw fail(`upstream error: exa ${path} answered ${res.status}: ${raw.slice(0, 200)}`, 'timeout');
  try { return JSON.parse(raw); } catch { throw fail(`exa ${path} answered non-JSON`, 'timeout'); }
}

/**
 * Any Exa endpoint through the shared pool: a spent or refused key rests and
 * the call moves to the next key. `apiKey` pins one key (a caller holding a
 * lease, or a local script with its own key when the pool is empty).
 */
export async function request(path: string, body: Record<string, unknown>, opts: CallOpts = {}): Promise<Record<string, any>> {
  await ensureKeys();
  const tries = pool.stats().length;
  if (!tries) throw fail('no Exa key is configured', 'not_installed');
  let lastErr = '';
  for (let attempt = 0; attempt < tries; attempt++) {
    if (!available()) break;
    const lease = await pool.acquire();
    try {
      const out = await requestWithKey(path, body, lease.secret, opts);
      lease.release();
      return out;
    } catch (cause) {
      releaseFor(lease, cause);
      const code = (cause as { code?: string }).code;
      if (code !== 'rate_limit' && code !== 'quota') throw cause;
      lastErr = (cause as Error).message;
    }
  }
  throw fail(`every Exa key is resting (${lastErr || 'no credit'})`, 'quota');
}

function searchBody(query: string, opts: SearchOpts): Record<string, unknown> {
  return {
    query,
    numResults: opts.numResults ?? 8,
    type: 'auto',
    ...(opts.includeDomains ? { includeDomains: opts.includeDomains } : {}),
    contents: { highlights: { numSentences: 3, highlightsPerUrl: 2 } },
  };
}

/** One Exa search through the shared pool, as Tavily-shaped hits; a spent or refused key rests and the search moves on. */
export async function search(query: string, opts: SearchOpts = {}): Promise<SearchHit[]> {
  return toHits(await request('search', searchBody(query, opts), { ...opts, timeoutMs: opts.timeoutMs ?? 30_000, what: opts.what ?? `search: ${query}` }));
}

/** One Exa search with the given key, as Tavily-shaped hits: url, title, and the highlight sentences as content. */
export async function searchWithKey(query: string, apiKey: string, opts: SearchOpts = {}): Promise<SearchHit[]> {
  return toHits(await requestWithKey('search', searchBody(query, opts), apiKey, { ...opts, timeoutMs: opts.timeoutMs ?? 30_000, what: opts.what ?? `search: ${query}` }));
}

function toHits(answer: Record<string, any>): SearchHit[] {
  const body = answer as { results?: Array<{ url?: string; title?: string; highlights?: string[] }> };
  const clean = (v: unknown, max: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
  const hits = (body.results ?? []).flatMap((item): SearchHit[] => {
    const url = typeof item.url === 'string' ? item.url.trim() : '';
    if (!/^https?:\/\//i.test(url)) return [];
    return [{ url, title: clean(item.title, 200), content: clean((item.highlights ?? []).join(' '), 600) }];
  });
  return hits;
}

/** Rest the key the way the error asks: the proxy's retry-after, an hour for a refused or spent key, a minute for a rate limit. */
export function releaseFor(lease: Lease, cause: unknown): void {
  const { code, restMs } = (cause as { code?: string; restMs?: number } | null) ?? {};
  lease.release(restMs ?? (code === 'quota' ? OUT_OF_CREDIT_REST_MS : code === 'rate_limit' ? RATE_LIMIT_REST_MS : 0));
}
