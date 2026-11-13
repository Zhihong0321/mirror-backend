// Shared plumbing for the dive-deeper prototypes (docs/dive-deeper-plan.md, step 1).
// Local only: reads a finished company-dive through the hub API, never writes to it.
//
// Every helper here falls back instead of throwing: a failed call logs a warning on
// the context and returns an empty value, so a lane ends partial, never dead
// (no timeouts, no max_tokens, no throw-on-parse-fail).
//
// LLM, Exa and Brave calls go through ../core (core/README.md): on the hub,
// every LLM lane on /workers and the hub's key pools. On this machine the local
// vault (D:\Tools\my-vault\vault.json) is the fallback, unless the env already has
// the keys: EE_AUTO_LAB_TOKEN, ZM_AI_FIXED_KEY, VECTIDE_DEEPSEEK_KEY,
// EXA_API_KEY, BRAVE_SEARCH_API_KEY. Google Maps searches are gmap.scan jobs on a
// connected Gmap worker (PC or Mac mini), so they run only inside the hub.
import fs from 'node:fs';
import https from 'node:https';
import os from 'node:os';
import tls from 'node:tls';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as core from '../core/index.ts';
import { hedgedChat } from './hedge.ts';
import * as jobs from '../jobs.ts';
import * as pagefetch from '../pagefetch.ts';
import { startCall, type ApiCall, type ApiName } from '../cost.ts';
import { evidenceActive } from '../evidence/context.ts';
import { handoff, isOpaque, record as recordEvidence } from '../evidence/store.ts';
import type { ShotAsk } from './v21/myworker.ts';

export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const SECTIONS = path.join(HERE, 'sections');
// Lane outputs and caches. On this machine: agy-lab/scripts/dive-deeper/out (gitignored).
// In the hub's container the scripts folder is not shipped, so a temp folder; the hub keeps
// what matters in the dive_deeper table.
const LOCAL_OUT = path.join(HERE, '..', '..', 'scripts', 'dive-deeper', 'out');
export const OUT = process.env.DD_OUT_DIR
  ?? (fs.existsSync(path.dirname(LOCAL_OUT)) ? LOCAL_OUT : path.join(os.tmpdir(), 'dive-deeper'));

/** The hub plugs in its own key sources. */
type Hooks = { secret?: (name: string) => string | undefined };
let hooks: Hooks = {};
export function configure(h: Hooks): void { hooks = { ...hooks, ...h }; }
const VAULT = process.env.VAULT_PATH ?? 'D:/Tools/my-vault/vault.json';
const LAB = (process.env.LAB_URL ?? 'https://ee-auto.up.railway.app').replace(/\/+$/, '');
export const DEFAULT_MODEL = process.env.DD_LLM_MODEL ?? 'deepseek-v4.1-flash-1017';
/** The review and write-up steps (S1-S6, owner 2026-11-11): exactly DeepSeek V4.1 Flash 1017, at maximum reasoning. */
export const WRITE_LLM = { model: process.env.DD_WRITE_MODEL?.trim() || 'deepseek-v4.1-flash-1017', exactModel: true, reasoningEffort: process.env.DD_WRITE_EFFORT?.trim() || 'max' } as const;
/** DD_LLM_FALLBACK=off: a deeper-dive call is answered by its lane or fails; MiniMax never stands in (a single-provider test, owner 2026-11-13). */
const NO_FALLBACK = (process.env.DD_LLM_FALLBACK ?? '').trim().toLowerCase() === 'off';

// Every LLM, Maps, Exa, Brave and PageSpeed call goes through the app's core
// (core/README.md), which picks the keys and lanes: on the hub, those saved on
// /workers; on this machine with no hub database, the vault (core/vault.ts).

// Servers that leave their intermediate certificate out of the TLS handshake. Seen 2026-10-26:
// cims.cidb.gov.my answers the hub (Railway, Southeast Asia) with only its leaf, signed by
// Sectigo Public Server Authentication CA OV R36, so verification fails there while it passes
// from Malaysia. Only these hosts get the extra intermediate; every other request is plain fetch.
const EXTRA_CA: Array<{ domain: string; file: string }> = [{ domain: 'cidb.gov.my', file: 'sectigo-ov-r36.pem' }];
const caCache = new Map<string, string[]>();
function extraCaFor(url: string): string[] | null {
  let h = '';
  try { h = new URL(url).hostname; } catch { return null; }
  const hit = EXTRA_CA.find((x) => h === x.domain || h.endsWith('.' + x.domain));
  if (!hit) return null;
  if (!caCache.has(hit.file)) {
    let pem = '';
    try { pem = fs.readFileSync(path.join(HERE, 'certs', hit.file), 'utf8'); } catch { /* fall back to the default store */ }
    caCache.set(hit.file, [...tls.rootCertificates, ...(pem ? [pem] : [])]);
  }
  return caCache.get(hit.file)!;
}

/** A GET/POST over node:https with an explicit CA list, following redirects. Throws like fetch does. */
async function httpsWithCa(url: string, init: { method?: string; headers: Record<string, string>; body?: string }, ca: string[], hops = 0): Promise<{ url: string; status: number; headers: Record<string, string>; text: string }> {
  const r = await new Promise<{ status: number; headers: Record<string, string>; text: string }>((resolve, reject) => {
    const req = https.request(url, { method: init.method ?? 'GET', headers: { ...init.headers, ...(init.body ? { 'content-length': String(Buffer.byteLength(init.body)) } : {}) }, ca }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: Object.fromEntries(Object.entries(res.headers).map(([k, v]) => [k, Array.isArray(v) ? v.join(', ') : String(v ?? '')])), text: Buffer.concat(chunks).toString('utf8') }));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.setTimeout(PAGE_TIMEOUT_MS, () => req.destroy(new Error(`no answer within ${PAGE_TIMEOUT_MS / 1000}s`)));
    if (init.body) req.write(init.body);
    req.end();
  });
  const loc = r.headers.location;
  if ([301, 302, 303, 307, 308].includes(r.status) && loc && hops < 5) {
    const next = new URL(loc, url).href;
    const keep = r.status === 307 || r.status === 308;
    return httpsWithCa(next, { headers: init.headers, ...(keep ? { method: init.method, body: init.body } : {}) }, ca, hops + 1);
  }
  return { url, ...r };
}

type Cred = { name: string; secret: string; baseUrl?: string };

let vaultCache: Cred[] | null = null;
function vault(): Cred[] {
  if (vaultCache) return vaultCache;
  try {
    const v = JSON.parse(fs.readFileSync(VAULT, 'utf8'));
    vaultCache = Array.isArray(v) ? v : (v.credentials ?? v.items ?? Object.values(v));
  } catch {
    vaultCache = [];
  }
  return vaultCache!;
}

/** A key: the hub database's (core/secrets.ts) first, then env, the hook and the vault. */
export function secret(name: string): string {
  return (core.secrets.fromDbByEnvName(name) || (process.env[name] ?? hooks.secret?.(name) ?? vault().find((c) => c.name === name)?.secret ?? '')).trim();
}

export type Finding = {
  title: string;
  detail: string;
  severity: 'high' | 'medium' | 'low' | 'info';
  source: string | null;
  checked_at: string;
  evidence?: string;
  [extra: string]: unknown;
};

export type Meter = {
  started: number;
  llm: { calls: number; failed: number; promptChars: number; answerChars: number; tokensIn: number; tokensOut: number; byModel: Record<string, number>; byModelTokens: Record<string, { in: number; out: number }> };
  maps: { calls: number; failed: number };
  /** priced: calls that reported their own cost; dollars: what they reported. */
  exa: { calls: number; failed: number; results: number; priced: number; dollars: number };
  brave: { calls: number; failed: number };
  http: { calls: number; failed: number };
  other: Record<string, number>;
  /** Every request one by one, each retry and each key tried included, with its tokens and cost (since 2026-10-31). */
  calls: ApiCall[];
};

/** A website read by the hub itself: given up after this long in all (a server can trickle bytes for ever). */
const PAGE_TIMEOUT_MS = 60_000;
/** A search engine's answer: given up after this long, then the next engine is asked. */
const SEARCH_TIMEOUT_MS = 45_000;

/** Marks the gmap.scan jobs the dive-deeper queues. */
const MAPS_SOURCE = 'dive.deeper';
const MAPS_TIMEOUT_MS = 300_000;
/** One business as a Gmap worker returns it. */
export type MapsRow = { name: string; rating: number | null; reviews: number | null; category: string | null; address: string | null; phone: string | null; website: string | null; mapsUrl: string | null };

export type Ctx = ReturnType<typeof makeCtx>;

export function makeCtx(diveId: string, section: string, lane: string, opts?: { worker?: 'myworker' }) {
  const v21 = opts?.worker === 'myworker';
  const warnings: string[] = [];
  const meter: Meter = {
    started: Date.now(),
    llm: { calls: 0, failed: 0, promptChars: 0, answerChars: 0, tokensIn: 0, tokensOut: 0, byModel: {}, byModelTokens: {} },
    maps: { calls: 0, failed: 0 },
    exa: { calls: 0, failed: 0, results: 0, priced: 0, dollars: 0 },
    brave: { calls: 0, failed: 0 },
    http: { calls: 0, failed: 0 },
    other: {},
    calls: [],
  };
  /**
   * Time one request; the first `done` adds it to the meter's call log and later
   * ones are ignored. Lanes that call an API themselves use this too.
   * Pass the body as the second argument (`read` and `page` do). With none, the
   * evidence row keeps no body: the lane fetched it and holds it.
   * ctx.call cannot see a body a lane fetches itself: that row is raw = null and note 'lane-fetched: body captured by the lane task'.
   */
  const OMITTED = Symbol('omitted');
  const call = (api: ApiName, what: string, extra: Partial<ApiCall> = {}) => {
    const c = startCall(api, what, extra);
    let rec: ApiCall | null = null;
    return { done: (end: Partial<ApiCall> & { ok: boolean }, raw: unknown = OMITTED): ApiCall => {
      if (!rec) {
        rec = c.done(end);
        meter.calls.push(rec);
        if (evidenceActive()) {
          if (raw === OMITTED) recordEvidence({ ...rec, note: 'lane-fetched: body captured by the lane task' }, null, what);
          else recordEvidence(rec, raw, what);
        }
      }
      return rec;
    } };
  };
  const warn = (msg: string) => {
    warnings.push(msg);
    console.warn(`  ! ${msg}`);
  };
  const log = (msg: string) => console.log(`  ${msg}`);

  /** Calls still waiting for an answer, so a lane that runs out of time can say on what (runner.ts). */
  const inFlight = new Map<number, { what: string; since: number }>();
  let nextCall = 0;
  async function track<T>(what: string, work: Promise<T>): Promise<T> {
    const n = nextCall++;
    inFlight.set(n, { what: what.slice(0, 160), since: Date.now() });
    try { return await work; } finally { inFlight.delete(n); }
  }
  const waitingOn = (): string[] => [...inFlight.values()].sort((a, b) => a.since - b.since)
    .map((c) => `${c.what} (${Math.round((Date.now() - c.since) / 1000)}s)`);

  // Worker reads and handlers are free HTTP calls. Their failures warn; they do not fail a lane.
  async function workerCall<T extends object>(what: string, work: () => Promise<T | { error: string }>): Promise<T | { error: string }> {
    meter.http.calls++;
    const c = call('fetch', what, { provider: 'myworker' });
    try {
      const out = await track(`myworker ${what}`, work());
      if ('error' in out && typeof out.error === 'string') throw new Error(out.error);
      c.done({ ok: true }, out);
      return out;
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      meter.http.failed++;
      warn(`myworker ${what}: ${error}`);
      c.done({ ok: false, note: error.slice(0, 200) }, null);
      return { error };
    }
  }

  async function lookup(handler: string, keyword: string) {
    if (!v21) return { error: 'site handlers require V2.1 mode' };
    return workerCall(`lookup ${handler}: ${keyword}`, async () => (await import('./v21/myworker.ts')).lookup(handler, keyword));
  }

  async function shot(ask: ShotAsk) {
    if (!v21) return { error: 'screenshots require V2.1 mode' };
    return workerCall(`shot ${ask.url}`, async () => (await import('./v21/myworker.ts')).shot(ask));
  }

  /** One chat call through the app's LLM router (core/llm.ts); '' when every lane and MiniMax failed. */
  async function llm(prompt: string, opts: { model?: string; system?: string; temperature?: number; label?: string; exactModel?: boolean; reasoningEffort?: string } = {}): Promise<string> {
    const model = opts.model ?? DEFAULT_MODEL;
    meter.llm.calls++;
    meter.llm.byModel[model] = (meter.llm.byModel[model] ?? 0) + 1;
    meter.llm.promptChars += prompt.length + (opts.system?.length ?? 0);
    try {
      // A slow call is raced by a second one, never killed (hedge.ts); one that never answers is given up, not waited on for ever.
      const out = await track(`llm ${model}`, hedgedChat(core.llm.chat, prompt, { step: opts.label ?? lane, model, system: opts.system, temperature: opts.temperature, exactModel: opts.exactModel, reasoningEffort: opts.reasoningEffort, ...(NO_FALLBACK ? { fallback: false } : {}), log: meter.calls }, { note: (m) => warn(m) }));
      meter.llm.answerChars += out.answer.length;
      meter.llm.tokensIn += out.tokensIn;
      meter.llm.tokensOut += out.tokensOut;
      const t = meter.llm.byModelTokens[model] ??= { in: 0, out: 0 };
      t.in += out.tokensIn;
      t.out += out.tokensOut;
      return out.answer;
    } catch (e) {
      warn(`llm ${model} failed on every lane: ${(e as Error).message.slice(0, 300)}`);
      meter.llm.failed++;
      return '';
    }
  }

  /** One Google Maps search as a gmap.scan job on a connected Gmap worker. Returns the
   *  businesses in Maps order (name, address, rating, reviews, phone, website, mapsUrl),
   *  or null when no worker is online or the search failed or was blocked. */
  async function mapsSearch(keyword: string, place: string, max: number): Promise<MapsRow[] | null> {
    meter.maps.calls++;
    const what = place ? `"${keyword}" in ${place}` : `"${keyword}"`;
    if (opts?.worker === 'myworker') {
      const { scan } = await import('./v21/myworker.ts');
      const out = await track(`maps ${what}`, scan(keyword, place, max));
      if (out.rows === null) {
        warn(`maps ${what}: ${out.error}`.slice(0, 300));
        meter.maps.failed++;
      }
      return out.rows;
    }
    if (!jobs.liveTypes().includes('gmap.scan')) {
      warn(`maps ${what}: no Gmap worker online`);
      meter.maps.failed++;
      return null;
    }
    const job = jobs.create('gmap.scan', { keyword, place, max, source: MAPS_SOURCE }, MAPS_TIMEOUT_MS);
    const settled = await track(`maps ${what}`, jobs.wait(job.id, MAPS_TIMEOUT_MS + 5_000));
    const result = settled?.result as { businesses?: MapsRow[]; blocked?: boolean; blockedReason?: string | null } | null | undefined;
    if (!settled || settled.status !== 'done' || !result || result.blocked || !Array.isArray(result.businesses)) {
      warn(`maps ${what}: ${settled?.error ?? (result?.blocked ? 'blocked: ' + (result.blockedReason ?? 'no reason') : settled ? 'no businesses in the answer' : 'no answer in time')}`.slice(0, 300));
      meter.maps.failed++;
      return null;
    }
    return result.businesses;
  }

  /** Exa search (core/exa.ts, the hub's key pool). `text: true` adds page text (capped by Exa's own maxCharacters).
   *  When every Exa key fails, Tavily and then Brave answer instead (their snippets as `text`), so a
   *  lane gets results whenever any engine is up; only all three failing counts as a failed call.
   *  V2.1 uses the engines for addresses only and reads at most five pages on myworker. */
  async function exa(query: string, opts: { numResults?: number; text?: boolean | number; type?: string; category?: string; includeDomains?: string[]; excludeDomains?: string[]; startPublishedDate?: string } = {}): Promise<any[]> {
    meter.exa.calls++;
    const texts = async (rows: any[]) => {
      if (!v21) return rows;
      // Never let paid page text or snippets through, even if an engine sends them unasked.
      const hits = rows.map((r) => ({ url: r.url, title: r.title, text: '',
        ...(opts.category === 'news' ? { publishedDate: r.publishedDate ?? r.page_age ?? null } : {}) }));
      if (opts.text) {
        const limit = typeof opts.text === 'number' ? opts.text : 4000;
        await Promise.all(hits.slice(0, 5).map(async (hit) => {
          const page = await read(hit.url);
          hit.text = page.status >= 200 && page.status < 300 ? page.text.slice(0, limit) : '';
        }));
      }
      return hits;
    };
    const body = {
      query,
      numResults: opts.numResults ?? 10,
      type: opts.type ?? 'auto',
      ...(opts.category ? { category: opts.category } : {}),
      ...(opts.includeDomains ? { includeDomains: opts.includeDomains } : {}),
      ...(opts.excludeDomains?.length ? { excludeDomains: opts.excludeDomains } : {}),
      ...(opts.startPublishedDate ? { startPublishedDate: opts.startPublishedDate } : {}),
      ...(!v21 && opts.text ? { contents: { text: typeof opts.text === 'number' ? { maxCharacters: opts.text } : true } } : {}),
    };
    const errors: string[] = [];
    try {
      const out = await track(`exa ${query}`, core.exa.request('search', body, { log: meter.calls, what: query, timeoutMs: SEARCH_TIMEOUT_MS }));
      const results = out.results ?? [];
      meter.exa.results += results.length;
      if (out.costDollars?.total != null) { meter.exa.priced++; meter.exa.dollars += Number(out.costDollars.total); }
      return await texts(results);
    } catch (e) {
      errors.push(`exa: ${(e as Error).message.slice(0, 150)}`);
    }
    // The fallbacks know no domain filter of their own: site: does the same job.
    const q = opts.includeDomains?.length ? `${query} ${opts.includeDomains.map((d) => 'site:' + d).join(' OR ')}` : query;
    const drop = (url: string) => (opts.excludeDomains ?? []).some((d) => {
      try { const h = new URL(url).hostname.replace(/^www\./, ''); return h === d || h.endsWith('.' + d); } catch { return false; }
    });
    try {
      const hits = await track(`tavily ${q}`, core.tavily.search(q, { maxResults: opts.numResults ?? 10, depth: 'advanced', timeoutMs: SEARCH_TIMEOUT_MS, log: meter.calls, what: query }));
      log(`exa failed, Tavily answered: ${query}`);
      return await texts(hits.filter((h) => !drop(h.url)).map((h) => ({ url: h.url, title: h.title, text: h.content })));
    } catch (e) {
      errors.push(`tavily: ${(e as Error).message.slice(0, 150)}`);
    }
    try {
      const rows = await track(`brave ${q}`, core.brave.searchRaw(q, { count: opts.numResults ?? 10, country: 'MY', log: meter.calls }));
      log(`exa and Tavily failed, Brave answered: ${query}`);
      return await texts(rows.filter((r) => !drop(String(r.url))).map((r) => ({ url: r.url, title: r.title, text: [r.description, ...(r.extra_snippets ?? [])].filter(Boolean).join(' '), publishedDate: r.page_age ?? null })));
    } catch (e) {
      errors.push(`brave: ${(e as Error).message.slice(0, 150)}`);
    }
    warn(`search failed on every engine: ${errors.join(' | ')}`);
    meter.exa.failed++;
    return [];
  }

  /** Brave web search (core/brave.ts); returns web.results (title, url, description, age...).
   *  When Brave fails, Exa and then Tavily answer in Brave's shape; only all three failing counts as a failed call. */
  async function brave(query: string, opts: { count?: number; country?: string } = {}): Promise<any[]> {
    meter.brave.calls++;
    const errors: string[] = [];
    try {
      return await track(`brave ${query}`, core.brave.searchRaw(query, { count: opts.count ?? 20, country: opts.country ?? 'MY', extraSnippets: false, log: meter.calls }));
    } catch (e) {
      errors.push(`brave: ${(e as Error).message.slice(0, 150)}`);
    }
    try {
      const hits = await track(`exa ${query}`, core.exa.search(query, { numResults: Math.min(opts.count ?? 20, 25), timeoutMs: SEARCH_TIMEOUT_MS, log: meter.calls, what: query }));
      log(`brave failed, Exa answered: ${query}`);
      return hits.map((h) => ({ url: h.url, title: h.title, description: h.content }));
    } catch (e) {
      errors.push(`exa: ${(e as Error).message.slice(0, 150)}`);
    }
    try {
      const hits = await track(`tavily ${query}`, core.tavily.search(query, { maxResults: Math.min(opts.count ?? 20, 20), depth: 'advanced', timeoutMs: SEARCH_TIMEOUT_MS, log: meter.calls, what: query }));
      log(`brave and Exa failed, Tavily answered: ${query}`);
      return hits.map((h) => ({ url: h.url, title: h.title, description: h.content }));
    } catch (e) {
      errors.push(`tavily: ${(e as Error).message.slice(0, 150)}`);
    }
    warn(`search failed on every engine: ${errors.join(' | ')}`);
    meter.brave.failed++;
    return [];
  }

  /**
   * A page's readable text, for a lane that hands it to the LLM. A fetch worker (Crawl4AI on the
   * Mac mini or a PC, a home line websites actually serve) reads it first, free and logged as a
   * `fetch` call; with no worker, or a page it could not read, the hub fetches it itself.
   * Lanes that need the raw HTML, headers or timing keep using page().
   */
  async function read(url: string): Promise<{ url: string; finalUrl: string; status: number; text: string; via: string; error?: string }> {
    if (v21) {
      const out = await workerCall(url, async () => {
        const page = await (await import('./v21/myworker.ts')).fetchPage(url, { format: 'markdown' });
        return !('error' in page) && page.status >= 400 ? { error: `HTTP ${page.status}` } : page;
      });
      if ('error' in out) return { url, finalUrl: url, status: 0, text: '', via: 'myworker', error: out.error };
      return { url, finalUrl: out.finalUrl, status: out.status, text: out.content, via: out.worker ?? 'myworker' };
    }
    const c = call('fetch', url);
    try {
      const out = await track(`fetch worker ${url}`, pagefetch.read([url]));
      const row = out.results[0];
      if (row?.raw_content) {
        meter.http.calls++;
        c.done({ ok: true, provider: out.worker ?? 'fetch worker', note: 'read by a fetch worker' }, row.raw_content);
        return { url, finalUrl: row.url || url, status: 200, text: row.raw_content, via: out.worker ?? 'fetch worker' };
      }
      c.done({ ok: false, note: out.failed_results[0]?.error ?? 'the fetch worker returned no text' }, null);
    } catch (e) {
      c.done({ ok: false, note: (e as Error).message.slice(0, 200) }, null);
    }
    const p = await page(url, { headers: { accept: 'text/html', 'accept-language': 'en-US,en;q=0.9' } });
    return { url, finalUrl: p.finalUrl, status: p.status, text: htmlText(p.html), via: 'hub', ...(p.error ? { error: p.error } : {}) };
  }

  /** Plain GET of a page. Never throws: a failure comes back as status 0 with `error`. */
  async function page(url: string, init: RequestInit = {}): Promise<{ url: string; finalUrl: string; status: number; ms: number; headers: Record<string, string>; html: string; error?: string }> {
    if (v21) {
      const t = Date.now();
      if ((init.method ?? 'GET').toUpperCase() !== 'GET') {
        const error = 'only GET runs on the worker; use a site handler';
        warn(error);
        return { url, finalUrl: url, status: 0, ms: Date.now() - t, headers: {}, html: '', error };
      }
      const out = await workerCall(url, async () => (await import('./v21/myworker.ts')).fetchPage(url, { format: 'html', keepErrors: true, headers: true }));
      if ('error' in out) return { url, finalUrl: url, status: 0, ms: Date.now() - t, headers: {}, html: '', error: out.error };
      return { url, finalUrl: out.finalUrl, status: out.status, ms: Date.now() - t, headers: out.headers, html: out.content };
    }
    meter.http.calls++;
    const t = Date.now();
    const c = call('web', url);
    try {
      const headers = { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36', ...(init.headers as Record<string, string>) };
      const ca = extraCaFor(url);
      if (ca) {
        const r = await track(`page ${url}`, httpsWithCa(url, { method: init.method, headers, body: init.body as string | undefined }, ca));
        if (evidenceActive()) c.done({ ok: true, note: `HTTP ${r.status}` }, handoff(r.text, r.headers['content-type']));
        else c.done({ ok: true, note: `HTTP ${r.status}` });
        return { url, finalUrl: r.url, status: r.status, ms: Date.now() - t, headers: r.headers, html: r.text };
      }
      const loaded = await track(`page ${url}`, (async () => {
        const res = await fetch(url, { redirect: 'follow', ...init, headers, signal: AbortSignal.timeout(PAGE_TIMEOUT_MS) });
        if (!evidenceActive()) return { res, html: await res.text(), kept: false as const, evidence: undefined as unknown };
        const ct = res.headers.get('content-type') ?? '';
        // Clone only while evidence is on, and only for a body we must not keep, so the lane still reads `res`.
        let evidence: unknown;
        if (isOpaque(ct)) {
          try { evidence = res.clone(); }
          catch (err) { evidence = { unreadable: true, note: err instanceof Error ? err.message : String(err) }; }
        }
        const html = await res.text();
        return { res, html, kept: true as const, evidence: evidence ?? html };
      })());
      if (loaded.kept) c.done({ ok: true, note: `HTTP ${loaded.res.status}` }, loaded.evidence);
      else c.done({ ok: true, note: `HTTP ${loaded.res.status}` });
      const { res, html } = loaded;
      return { url, finalUrl: res.url, status: res.status, ms: Date.now() - t, headers: Object.fromEntries(res.headers), html };
    } catch (e) {
      meter.http.failed++;
      c.done({ ok: false, note: (e as Error).message.slice(0, 200) }, null);
      const cause = (e as any).cause;
      return { url, finalUrl: url, status: 0, ms: Date.now() - t, headers: {}, html: '', error: `${(e as Error).message}${cause ? ' (' + (cause.code ?? cause.message) + ')' : ''}` };
    }
  }

  return { diveId, section, lane, v21, warnings, meter, warn, log, call, track, waitingOn, llm, mapsSearch, exa, brave, page, read, lookup, shot, parseJson, htmlText, now: () => new Date().toISOString() };
}

/** First JSON object or array in a model answer, or null. Never throws. */
export function parseJson<T = any>(text: string): T | null {
  if (!text) return null;
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : text;
  for (const [open, close] of [['{', '}'], ['[', ']']] as const) {
    const a = body.indexOf(open);
    const b = body.lastIndexOf(close);
    if (a >= 0 && b > a) {
      try { return JSON.parse(body.slice(a, b + 1)); } catch { /* try the other shape */ }
    }
  }
  return null;
}

/** Visible text of an HTML page, roughly: scripts, styles and tags removed. */
export function htmlText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6]|tr|section|article)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#39;|&rsquo;|&lsquo;/g, "'").replace(/&quot;|&ldquo;|&rdquo;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim();
}

/** The finished dive, read-only through the hub API, cached in out/ so reruns cost nothing. */
export async function loadDive(diveId: string, fresh = false): Promise<any> {
  fs.mkdirSync(OUT, { recursive: true });
  const file = path.join(OUT, `dive-${diveId}.json`);
  if (!fresh && fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  const res = await fetch(`${LAB}/api/company-dive/${encodeURIComponent(diveId)}`, { headers: { authorization: 'Bearer ' + secret('EE_AUTO_LAB_TOKEN') } });
  if (!res.ok) throw new Error(`GET /api/company-dive/${diveId}: HTTP ${res.status}`);
  const dive = await res.json();
  if (dive.status !== 'done') console.warn(`  ! dive ${diveId} is ${dive.status}, not done`);
  writeLane(diveId, 'dive', dive, 2);
  return dive;
}

/** The dive's source list as [id] -> url, for citing back into findings. */
export function sourceUrl(dive: any, id: number): string | null {
  return dive.result?.sources?.find((s: any) => s.id === id)?.url ?? null;
}

/** Another lane's saved output for this dive (out/<lane>-<diveId>.json), or null when it did not run. */
export function readLane(diveId: string, lane: string): any | null {
  const file = path.join(OUT, `${lane}-${diveId}.json`);
  try { return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null; } catch { return null; }
}

/** Where a lane's output for this dive is saved (out/<name>-<diveId>.json). */
export function laneFile(diveId: string, name: string): string {
  return path.join(OUT, `${name}-${diveId}.json`);
}

/** Like readLane, but tells a missing file (undefined) from one that will not read (it throws). */
export function readLaneStrict(diveId: string, name: string): any {
  const file = laneFile(diveId, name);
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : undefined;
}

/** Saves a lane's output for this dive (out/<name>-<diveId>.json). */
export function writeLane(diveId: string, name: string, data: any, space?: number | string): void {
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, `${name}-${diveId}.json`), JSON.stringify(data, null, space));
}

/** The names a page has to carry to be about this company, and its own domains. */
export function nameOf(dive: any) {
  const id = dive.result?.identity ?? {};
  const legal = String(id.legal_name ?? dive.company ?? '').trim();
  const bare = legal.replace(/\b(sdn\.?\s*bhd\.?|berhad|bhd\.?|plt|enterprise|holdings?)(?=\W|$)/gi, '').replace(/[^\p{L}\p{N}&' ]+/gu, ' ').replace(/\s+/g, ' ').trim();
  const short = String(id.aliases?.[0] ?? bare ?? legal).trim();
  const brand = legal.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').trim().split(/\s+/)[0] ?? '';
  const domains: string[] = [...new Set<string>((id.official_domains ?? []).map((d: string) => String(d).toLowerCase().replace(/^www\./, '')))];
  const hostOf = (u: string | null | undefined) => { try { return u ? new URL(u).hostname.toLowerCase().replace(/^www\./, '') : ''; } catch { return ''; } };
  const own = (u: string | null | undefined) => { const h = hostOf(u); return !!h && domains.some((d) => h === d || h.endsWith('.' + d)); };
  /** True when the text names the company: the bare legal name or one of its aliases. */
  const names = [bare, short, ...(id.aliases ?? [])].map((x: string) => String(x).toLowerCase()).filter((x: string) => x.length >= 4);
  const mentions = (text: string) => { const t = String(text ?? '').toLowerCase().replace(/\s+/g, ' '); return names.some((n) => t.includes(n)); };
  return { legal, bare, short, brand, domains, hostOf, own, mentions, address: String(id.address ?? ''), industry: String(id.industry ?? '') };
}
