// Tavily web search, shared by the Pi worker's web_search tool and the contact
// worker's first step. Keys live in the gemini_contact_key table (kind 'tavily')
// and rotate round-robin.
//
// Each key's quota is Tavily's own number, read from GET /usage every ten
// minutes, plus what this process spent since that read. A key with less than
// one contact job's worth of credits left rests: it gets no work until a later
// /usage read shows credits again, which is how it wakes when Tavily resets the
// month. When every key rests, slots() is 0, the contact lanes stop taking jobs
// and the auto-queue stops creating them.
//
// The US proxy (core/proxy.ts) is one more source in this pool, PROXY_SOURCE:
// it holds its own Tavily keys, so its calls carry only the proxy token. Its
// "usage" is the proxy's GET /usage/tavily totals, and a PROXY_NO_KEY answer
// rests it for the proxy's retry-after.
import * as db from '../reportdb.ts';
import { startCall, type ApiCall } from '../cost.ts';
import { isProxy, noKeyRestMs, parseProxy, proxy, setProxy, usage, withProxy } from './proxy.ts';
import * as vault from './vault.ts';

const DIRECT_API = 'https://api.tavily.com';

/** Where one key's call goes, with its headers: Tavily itself, or the US proxy's /tavily path. */
export function endpoint(secret: string, path: string): { url: string; headers: Record<string, string> } {
  if (!isProxy(secret)) return { url: `${DIRECT_API}/${path}`, headers: { authorization: 'Bearer ' + secret, 'content-type': 'application/json' } };
  const saved = proxy();
  if (!saved) throw Object.assign(new Error('the US proxy is not saved: POST exaProxy {url, token} to /api/contact-keys'), { code: 'quota', provider: 'tavily' });
  return { url: `${saved.url}/tavily/${path}`, headers: { 'x-proxy-token': saved.token, 'content-type': 'application/json' } };
}

/** The proxy's Tavily report (GET /usage/tavily): credits spent and left on the keys it holds. */
export async function proxyUsage(fetchImpl: FetchImpl = fetch): Promise<Record<string, any> | null> {
  return usage('tavily', fetchImpl);
}

export const KEY_CONCURRENCY = 2;
/** One contact job is two advanced searches at two credits each. */
export const RESERVE_CREDITS = 4;
const USAGE_REFRESH_MS = 10 * 60_000;
/**
 * After a failed /usage read, wait this long before reading that key again.
 * Tavily answered the hub's /usage with 429 for every key on 2026-10-25 (the same
 * call from elsewhere answered 200), so back off well past its window.
 */
const USAGE_RETRY_MS = 15 * 60_000;

type FetchImpl = typeof fetch;

export type Lease = { secret: string; release: (coolMs?: number, quotaExceeded?: boolean) => void };

export type KeyPoolOptions = {
  concurrency?: number;
};

type Usage = { used: number; limit: number | null; spent: number; checkedAt: number };

export function createKeyPool(options: KeyPoolOptions = {}) {
  const concurrency = options.concurrency ?? KEY_CONCURRENCY;
  const state = {
    keys: [] as string[],
    inflight: new Map<string, number>(),
    coolUntil: new Map<string, number>(),
    usage: new Map<string, Usage>(),
    /** The last failed /usage read per key, so a broken read shows instead of reading as "no data". */
    usageError: new Map<string, { message: string; at: number }>(),
    rrIndex: 0,
    waiters: [] as Array<(lease: Lease) => void>,
  };

  function remaining(key: string): number | null {
    const u = state.usage.get(key);
    if (!u || u.limit === null) return null;
    return u.limit - u.used - u.spent;
  }

  function resting(key: string): boolean {
    const left = remaining(key);
    return left !== null && left < RESERVE_CREDITS;
  }

  function usable(key: string): boolean {
    if ((state.coolUntil.get(key) ?? 0) > Date.now()) return false;
    return !resting(key);
  }

  function wake(): void {
    if (!state.keys.length || !state.waiters.length) return;
    const len = state.keys.length;
    for (let attempt = 0; attempt < len && state.waiters.length; attempt++) {
      const idx = (state.rrIndex + attempt) % len;
      const key = state.keys[idx]!;
      if (!usable(key)) continue;
      while ((state.inflight.get(key) ?? 0) < concurrency && state.waiters.length) {
        state.rrIndex = (idx + 1) % len;
        const resolve = state.waiters.shift()!;
        state.inflight.set(key, (state.inflight.get(key) ?? 0) + 1);
        let released = false;
        resolve({
          secret: key,
          release(coolMs = 0, quotaExceeded = false) {
            if (released) return;
            released = true;
            // Out of credits: rest until a /usage read shows credits again.
            if (quotaExceeded) {
              const limit = state.usage.get(key)?.limit ?? 1;
              state.usage.set(key, { used: limit, limit, spent: 0, checkedAt: Date.now() });
            }
            if (coolMs > 0) state.coolUntil.set(key, Date.now() + coolMs);
            state.inflight.set(key, Math.max(0, (state.inflight.get(key) ?? 1) - 1));
            wake();
          },
        });
      }
    }
  }

  return {
    setKeys(keys: string[]) {
      state.keys = [...new Set(keys.map((k) => k.trim()).filter(Boolean))];
      wake();
    },
    acquire() {
      return new Promise<Lease>((resolve) => {
        state.waiters.push(resolve);
        wake();
      });
    },
    /** Tavily's own count for a key, from GET /usage. */
    setUsage(key: string, used: number, limit: number | null) {
      state.usage.set(key, { used, limit, spent: 0, checkedAt: Date.now() });
      state.usageError.delete(key);
      wake();
    },
    /** A /usage read failed: keep the old number, say why, and wait before trying that key again. */
    usageFailed(key: string, message: string) {
      state.usageError.set(key, { message: message.slice(0, 200), at: Date.now() });
    },
    /** Credits this process spent since the last /usage read. */
    spend(key: string, credits: number) {
      const u = state.usage.get(key);
      if (u) u.spent += credits;
    },
    /** Keys with no /usage read, or one older than maxAgeMs. */
    staleUsage(maxAgeMs: number): string[] {
      return state.keys.filter((key) => Date.now() - (state.usage.get(key)?.checkedAt ?? 0) > maxAgeMs
        && Date.now() - (state.usageError.get(key)?.at ?? 0) > USAGE_RETRY_MS);
    },
    stats() {
      return state.keys.map((secret) => {
        const u = state.usage.get(secret);
        return {
          secret,
          tail: maskKey(secret),
          usedThisMonth: u ? u.used + u.spent : null,
          monthlyLimit: u?.limit ?? null,
          cooling: !usable(secret),
          resting: resting(secret),
          usageError: state.usageError.get(secret)?.message ?? null,
          usageCheckedAt: u ? new Date(u.checkedAt).toISOString() : null,
        };
      });
    },
    slots() {
      return state.keys.filter(usable).length * concurrency;
    },
  };
}

export const pool = createKeyPool({ concurrency: KEY_CONCURRENCY });

/** True while at least one key has credits left. */
export function available(): boolean {
  return pool.slots() > 0;
}

/** Tavily's own usage for one key, as credits used against a limit. Null limit means unlimited. */
export async function fetchUsage(apiKey: string, fetchImpl: FetchImpl = fetch): Promise<{ used: number; limit: number | null }> {
  if (isProxy(apiKey)) {
    // The proxy's keys together: no usable key reads as spent, so the source rests until one is.
    const report = await proxyUsage(fetchImpl);
    const t = report?.totals ?? {};
    const limit = Number(t.keys ?? 0) * Number(report?.creditAssumedCredits ?? 1000);
    const left = Number(t.usable ?? 0) > 0 ? Math.max(0, Number(t.estimatedLeftCredits ?? 0)) : 0;
    return { used: Math.max(0, limit - left), limit };
  }
  const res = await fetchImpl(`${DIRECT_API}/usage`, {
    headers: { authorization: 'Bearer ' + apiKey },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`tavily /usage answered ${res.status}`);
  const body = await res.json() as {
    key?: { usage?: number; limit?: number | null };
    account?: { plan_usage?: number; plan_limit?: number | null };
  };
  const plan = body.account ?? {};
  const planLeft = typeof plan.plan_limit === 'number' ? plan.plan_limit - (plan.plan_usage ?? 0) : null;
  const keyLeft = typeof body.key?.limit === 'number' ? body.key.limit - (body.key.usage ?? 0) : null;
  if (planLeft === null && keyLeft === null) return { used: 0, limit: null };
  const left = Math.min(planLeft ?? Infinity, keyLeft ?? Infinity);
  const limit = typeof plan.plan_limit === 'number' ? plan.plan_limit : (body.key?.limit ?? 0);
  return { used: Math.max(0, limit - left), limit };
}

let usageRun: Promise<void> | null = null;

/** Re-read /usage for keys whose number is older than ten minutes. A failed read keeps the old number.
 *  All keys at once: read one by one, 19 keys whose reads time out held the first Tavily call after a
 *  restart for almost four minutes (company-dive 17, 2026-11-01). */
export function refreshUsage(fetchImpl: FetchImpl = fetch): Promise<void> {
  usageRun ??= Promise.all(pool.staleUsage(USAGE_REFRESH_MS).map(async (key) => {
    try {
      const { used, limit } = await fetchUsage(key, fetchImpl);
      pool.setUsage(key, used, limit);
    } catch (err) {
      // Kept on the key and shown on /auto-queue; retried after USAGE_RETRY_MS.
      const e = err as Error & { cause?: { code?: string } };
      pool.usageFailed(key, `${e.name}: ${e.message}${e.cause?.code ? ' (' + e.cause.code + ')' : ''}`);
    }
  })).then(() => {}).finally(() => { usageRun = null; });
  return usageRun;
}

function maskKey(secret: string): string {
  if (isProxy(secret)) return 'US proxy';
  return secret.length <= 4 ? '••••' : `••••${secret.slice(-4)}`;
}

export async function loadKeys(env: NodeJS.ProcessEnv = process.env): Promise<string[]> {
  let keys: string[] = [];
  try {
    const rows = await db.listGeminiContactKeys();
    keys = rows.filter((row) => row.kind === 'tavily').map((row) => row.secret);
    setProxy(parseProxy(rows.find((row) => row.kind === 'exa_proxy')?.secret ?? ''));
    if (!keys.length) keys = rows.filter((row) => row.secret.startsWith('tvly-')).map((row) => row.secret);
  } catch { /* database table created on migrate; caller without db uses env */ }
  if (!keys.length) {
    keys = String(env.TAVILY_API_KEYS ?? env.TAVILY_API_KEY ?? vault.secret('TAVILY_API_KEY')).split(/[,\n]/).map((k) => k.trim()).filter(Boolean);
  }
  return keys;
}

/** Reload the keys into the shared pool, refresh their quota, and return them. */
export async function refresh(env: NodeJS.ProcessEnv = process.env): Promise<string[]> {
  const keys = await loadKeys(env);
  pool.setKeys(withProxy(keys));
  keysLoadedAt = Date.now();
  await refreshUsage();
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

export type SearchHit = { url: string; title: string; content: string };

/**
 * One Tavily search with the given key. Only an error response counts as a quota or
 * rate limit: a 200 body is search results, and their text can say "credit" or "quota".
 * Tavily answers 432 when the plan's monthly credits are spent and 433 when the
 * pay-as-you-go cap is hit.
 */
export async function searchWithKey(
  query: string,
  apiKey: string,
  opts: { maxResults?: number; depth?: 'basic' | 'advanced'; timeoutMs?: number; fetchImpl?: FetchImpl; log?: ApiCall[]; what?: string } = {},
): Promise<SearchHit[]> {
  const call = startCall('tavily', opts.what ?? `search: ${query}`, { provider: isProxy(apiKey) ? 'tavily us proxy' : 'tavily' });
  try {
    const hits = await searchOnce(query, apiKey, opts);
    opts.log?.push(call.done({ ok: true, results: hits.length, credits: (opts.depth ?? 'advanced') === 'advanced' ? 2 : 1 }));
    return hits;
  } catch (cause) {
    opts.log?.push(call.done({ ok: false, note: (cause as Error).message.slice(0, 200) }));
    throw cause;
  }
}

async function searchOnce(
  query: string,
  apiKey: string,
  opts: { maxResults?: number; depth?: 'basic' | 'advanced'; timeoutMs?: number; fetchImpl?: FetchImpl },
): Promise<SearchHit[]> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const target = endpoint(apiKey, 'search');
  let res: Response;
  try {
    res = await fetchImpl(target.url, {
      method: 'POST',
      headers: target.headers,
      body: JSON.stringify({
        query,
        max_results: opts.maxResults ?? 8,
        search_depth: opts.depth ?? 'advanced',
        include_answer: false,
      }),
      signal: AbortSignal.timeout(opts.timeoutMs ?? 30_000),
    });
  } catch (cause) {
    const name = cause instanceof Error ? cause.name : '';
    throw fail(
      name === 'TimeoutError' || name === 'AbortError'
        ? 'tavily search timed out'
        : `upstream error: ${(cause as Error)?.message ?? cause}`,
      'timeout',
    );
  }
  const raw = await res.text();
  const noKey = noKeyRestMs(res, raw);
  if (noKey) throw Object.assign(fail(`US proxy has no usable Tavily key: ${raw.slice(0, 200)}`, 'quota'), { restMs: noKey, provider: 'tavily' });
  if (res.status === 432 || res.status === 433 || res.status === 401 || (!res.ok && /usage_limit|quota|credit|plan limit/i.test(raw))) {
    throw fail(`tavily monthly quota exceeded or key refused (${res.status}): ${raw.slice(0, 200)}`, 'quota');
  }
  if (res.status === 429) throw fail(`429 rate_limit_error: tavily rate limit: ${raw.slice(0, 200)}`, 'rate_limit');
  if (!res.ok) throw fail(`upstream error: tavily answered ${res.status}: ${raw.slice(0, 200)}`, 'timeout');
  pool.spend(apiKey, (opts.depth ?? 'advanced') === 'advanced' ? 2 : 1);
  let body: unknown;
  try { body = JSON.parse(raw); } catch { return []; }
  const results = (body as { results?: unknown })?.results;
  if (!Array.isArray(results)) return [];
  return results.flatMap((item): SearchHit[] => {
    const row = item as Record<string, unknown>;
    const url = typeof row.url === 'string' ? row.url.trim() : '';
    if (!/^https?:\/\//i.test(url)) return [];
    const clean = (v: unknown, max: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
    return [{ url, title: clean(row.title, 200), content: clean(row.content, 400) }];
  });
}

/** Release a lease the way the error asks: the proxy's retry-after, rest the key for quota, a minute off for a rate limit. */
export function releaseFor(lease: Lease, cause: unknown): void {
  const { code, restMs } = (cause as { code?: string; restMs?: number } | null) ?? {};
  if (restMs) return lease.release(restMs);
  lease.release(code === 'rate_limit' ? 60_000 : 0, code === 'quota');
}

/**
 * Tavily's search or map through the shared pool, for callers that need more
 * than searchWithKey's trimmed hits. A key that answers 432/433 rests like it
 * does for contact research, and the call moves on to the next key; the credits
 * Tavily reports for the call are counted against the key.
 *
 * NO PAGE READS. Since 2026-11-01 a page is read by the Mac mini or a PC fetch
 * worker (pagefetch.ts, Crawl4AI on a home line) for nothing, so /extract and
 * /crawl are refused here before a key is picked: Tavily is never paid to read
 * a page again, whoever asks.
 */
export async function request(
  path: 'search' | 'map',
  body: Record<string, unknown>,
  opts: { timeoutMs?: number; fetchImpl?: FetchImpl; log?: ApiCall[]; what?: string } = {},
): Promise<Record<string, any>> {
  const asked: string = path;
  if (asked !== 'search' && asked !== 'map') {
    throw fail(`tavily /${asked} is retired: pages are read by the fetch workers (pagefetch.ts), not bought from Tavily`, 'unsupported');
  }
  const call = startCall('tavily', opts.what ?? `${path}: ${String(body.query ?? body.url ?? '').slice(0, 200)}`, { provider: 'tavily' });
  try {
    const out = await requestPool(path, body, opts);
    opts.log?.push(call.done({ ok: true, credits: Number(out.usage?.credits ?? 0) }));
    return out;
  } catch (cause) {
    opts.log?.push(call.done({ ok: false, note: (cause as Error).message.slice(0, 200) }));
    throw cause;
  }
}

async function requestPool(
  path: 'search' | 'map',
  body: Record<string, unknown>,
  opts: { timeoutMs?: number; fetchImpl?: FetchImpl },
): Promise<Record<string, any>> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  await ensureKeys();
  const tries = pool.stats().length;
  if (!tries) throw fail('no Tavily key is configured', 'not_installed');
  for (let attempt = 0; attempt < tries; attempt++) {
    if (!available()) break;
    const lease = await pool.acquire();
    let res: Response;
    try {
      const target = endpoint(lease.secret, path);
      res = await fetchImpl(target.url, {
        method: 'POST',
        headers: target.headers,
        body: JSON.stringify({ ...body, include_usage: true }),
        // No timeout unless the caller asks for one: a slow map still finishes.
        ...(opts.timeoutMs ? { signal: AbortSignal.timeout(opts.timeoutMs) } : {}),
      });
    } catch (cause) {
      lease.release();
      throw fail(`tavily /${path} unreachable: ${(cause as Error).message}`, 'timeout');
    }
    const raw = await res.text();
    const noKey = noKeyRestMs(res, raw);
    if (noKey) {
      lease.release(noKey);
      continue;
    }
    if (res.status === 432 || res.status === 433 || res.status === 401) {
      lease.release(0, true);
      continue;
    }
    if (res.status === 429) {
      lease.release(60_000);
      continue;
    }
    lease.release();
    if (!res.ok) throw fail(`tavily /${path} answered ${res.status}: ${raw.slice(0, 200)}`, res.status === 403 ? 'unsupported' : 'failed');
    const out = JSON.parse(raw) as Record<string, any>;
    pool.spend(lease.secret, Number(out.usage?.credits ?? 0));
    return out;
  }
  throw fail('every Tavily key is out of credits until its quota resets', 'quota');
}

/**
 * Any Tavily endpoint with one key the caller holds (a contact job's lease).
 * Quota and rate-limit errors carry the codes releaseFor reads; a 403 says the
 * endpoint is not on the key's plan (unsupported).
 */
export async function requestWithKey<T = Record<string, any>>(
  path: string,
  body: Record<string, unknown>,
  apiKey: string,
  opts: { timeoutMs?: number; fetchImpl?: FetchImpl; log?: ApiCall[]; what?: string } = {},
): Promise<T & { usage?: { credits?: number } }> {
  const call = startCall('tavily', opts.what ?? `${path}: ${String(body.query ?? body.url ?? '').slice(0, 200)}`, { provider: isProxy(apiKey) ? 'tavily us proxy' : 'tavily' });
  let res: Response;
  try {
    const target = endpoint(apiKey, path);
    res = await (opts.fetchImpl ?? fetch)(target.url, {
      method: 'POST',
      headers: target.headers,
      body: JSON.stringify({ ...body, include_usage: true }),
      ...(opts.timeoutMs ? { signal: AbortSignal.timeout(opts.timeoutMs) } : {}),
    });
  } catch (cause) {
    const name = cause instanceof Error ? cause.name : '';
    const err = fail(name === 'TimeoutError' || name === 'AbortError' ? `tavily ${path} timed out` : `upstream error: ${(cause as Error)?.message ?? cause}`, 'timeout');
    opts.log?.push(call.done({ ok: false, note: err.message.slice(0, 200) }));
    throw err;
  }
  const raw = await res.text();
  const refuse = (message: string, code: string) => { opts.log?.push(call.done({ ok: false, note: message.slice(0, 200) })); return fail(message, code); };
  const noKey = noKeyRestMs(res, raw);
  if (noKey) throw Object.assign(refuse(`US proxy has no usable Tavily key: ${raw.slice(0, 200)}`, 'quota'), { restMs: noKey, provider: 'tavily' });
  if (res.status === 432 || res.status === 433) throw refuse(`tavily quota exceeded (${res.status}): ${raw.slice(0, 200)}`, 'quota');
  if (res.status === 429) throw refuse(`429 rate_limit_error: tavily rate limit: ${raw.slice(0, 200)}`, 'rate_limit');
  if (!res.ok) throw refuse(`upstream error: tavily ${path} answered ${res.status}: ${raw.slice(0, 200)}`, res.status === 403 ? 'unsupported' : 'timeout');
  let out: T & { usage?: { credits?: number } };
  try { out = JSON.parse(raw); } catch { throw refuse(`tavily ${path} answered non-JSON`, 'timeout'); }
  // The caller counts the credits against its key (it holds the lease).
  opts.log?.push(call.done({ ok: true, credits: Number(out.usage?.credits ?? 0) }));
  return out;
}

/** One search through the shared pool: a spent or rate-limited key rests and the search moves to the next. */
export async function search(query: string, opts: { maxResults?: number; depth?: 'basic' | 'advanced'; timeoutMs?: number; fetchImpl?: FetchImpl; log?: ApiCall[]; what?: string } = {}): Promise<SearchHit[]> {
  await ensureKeys();
  const tries = pool.stats().length;
  if (!tries) throw fail('no Tavily key is configured', 'not_installed');
  let last: unknown = null;
  for (let attempt = 0; attempt < tries && available(); attempt++) {
    const lease = await pool.acquire();
    try {
      const hits = await searchWithKey(query, lease.secret, opts);
      lease.release();
      return hits;
    } catch (cause) {
      releaseFor(lease, cause);
      const code = (cause as { code?: string }).code;
      if (code !== 'quota' && code !== 'rate_limit') throw cause;
      last = cause;
    }
  }
  throw last ?? fail('every Tavily key is out of credits until its quota resets', 'quota');
}
