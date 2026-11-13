import { workerIdentification } from '../../v21/worker-identification.ts';
import { secret, type MapsRow } from '../lib.ts';

export type WorkerRow = MapsRow & { place_id: string | null };
type Options = { baseUrl?: string; apiKey?: string };
type Answer = { rows: WorkerRow[]; error?: never } | { rows: null; error: string };

type Failed = { error: string };
export type FetchOptions = { format: 'markdown' | 'html'; keepErrors?: boolean; headers?: boolean };
export type Page = {
  url: string; finalUrl: string; status: number; content: string;
  headers: Record<string, string>; redirects: Array<{ url: string; status: number; location: string }>;
  worker?: string;
};
export type Lookup = {
  status: string; reason: string | null; records: unknown[]; source_url: string; excerpt: string;
  handler: string; version: string;
};
export type ShotAsk = { url: string; device?: 'desktop' | 'mobile'; find?: string };
export type Shot = {
  image?: string | null; found?: boolean; blocked: boolean; detail?: unknown;
  status: number; finalUrl: string; [key: string]: unknown;
};

/** These jobs expire on the service. Each long poll gets its own 90-second request limit. */
async function job(path: string, payload: Record<string, unknown>, opts: Options): Promise<any> {
  const base = (opts.baseUrl ?? process.env.V21_DEEPER_WORKER_URL ?? process.env.GMAP_API_URL ?? 'https://myworker.up.railway.app').replace(/\/+$/, '');
  const key = opts.apiKey ?? secret('GMAP_API_KEY');
  if (!key) throw new Error('GMAP_API_KEY is missing');
  const headers = { authorization: 'Bearer ' + key, 'content-type': 'application/json' };
  const request = async (route: string, init: RequestInit = {}) => {
    const res = await fetch(base + route, { ...init, headers, signal: AbortSignal.timeout(90_000) });
    if (!res.ok) throw new Error(`myworker: HTTP ${res.status}`);
    const body = await res.json() as any;
    if (!body.job) throw new Error('myworker returned no job');
    return body.job;
  };
  let out = await request(path, { method: 'POST', body: JSON.stringify({ ...payload, ...workerIdentification(({ '/api/fetch': 'Read web page', '/api/lookup': 'Look up company', '/api/chat': 'Ask ChatGPT', '/api/shot': 'Capture web page' } as Record<string, string>)[path] ?? 'Run worker job'), wait: 60 }) });
  while (out.status === 'pending' || out.status === 'running') {
    if (!out.id) throw new Error('myworker returned no job id');
    out = await request(`/api/jobs/${encodeURIComponent(out.id)}?wait=60`);
  }
  if (out.status === 'failed') throw new Error(String(out.error ?? 'myworker job failed'));
  if (out.status !== 'done') throw new Error(`unexpected myworker job status: ${out.status}`);
  if (!out.result || typeof out.result !== 'object') throw new Error('myworker returned no result');
  return out.result;
}

const reason = (err: unknown) => err instanceof Error ? err.message : String(err);

export async function fetchPage(url: string, ask: FetchOptions, opts: Options = {}): Promise<Page | Failed> {
  try {
    const out = await job('/api/fetch', { url, ...ask, mainContent: false }, opts);
    if (typeof out.status !== 'number' || typeof out.content !== 'string') throw new Error('myworker returned no page');
    return { url: out.url ?? url, finalUrl: out.finalUrl ?? out.url ?? url, status: out.status, content: out.content,
      headers: out.headers ?? {}, redirects: out.redirects ?? [], worker: out.worker };
  } catch (err) {
    // Older workers fail error pages even when keepErrors was requested. Keep their HTTP status.
    const status = reason(err).match(/the site answered HTTP ([45]\d{2})\b/i);
    if (status) return { url, finalUrl: url, status: Number(status[1]), content: '', headers: {}, redirects: [] };
    return { error: reason(err) };
  }
}

export async function lookup(handler: string, keyword: string, opts: Options = {}): Promise<Lookup | Failed> {
  try {
    const out = await job('/api/lookup', { handler, keyword }, opts);
    if (!out.result || typeof out.result.status !== 'string') throw new Error('myworker returned no lookup result');
    return { ...out.result, handler: out.handler ?? handler, version: out.version };
  } catch (err) { return { error: reason(err) }; }
}

/** One prompt to web ChatGPT on a worker PC (myworker /api/chat). Each prompt is its own unpersonalized temporary chat
 *  on that PC, with ChatGPT's default model; the service gives no model choice. */
export async function chat(prompt: string, opts: Options & { timeoutMs?: number } = {}): Promise<{ answer: string; tookMs: number | null; worker?: string } | Failed> {
  try {
    const out = await job('/api/chat', { prompt, timeoutMs: opts.timeoutMs ?? 240_000 }, opts);
    if (typeof out.answer !== 'string' || !out.answer.trim()) throw new Error('ChatGPT returned no answer');
    return { answer: out.answer, tookMs: typeof out.tookMs === 'number' ? out.tookMs : null, worker: out.worker };
  } catch (err) { return { error: reason(err) }; }
}

export async function shot(ask: ShotAsk, opts: Options = {}): Promise<Shot | Failed> {
  try { return await job('/api/shot', { ...ask }, opts); }
  catch (err) { return { error: reason(err) }; }
}

/** Each request holds for at most 60 seconds. The service, rather than this client, expires jobs. */
export async function scan(keyword: string, place: string, max: number, opts: Options = {}): Promise<Answer> {
  // V21_DEEPER_WORKER_URL points only the deeper dive elsewhere (V2.1 Step 1 keeps GMAP_API_URL), e.g. at a dead
  // address to make the worker-down path fail on purpose in a live test.
  const base = (opts.baseUrl ?? process.env.V21_DEEPER_WORKER_URL ?? process.env.GMAP_API_URL ?? 'https://myworker.up.railway.app').replace(/\/+$/, '');
  try {
    const health = await fetch(base + '/health', { signal: AbortSignal.timeout(60_000) });
    if (!health.ok) throw new Error(`myworker health: HTTP ${health.status}`);
    const live = await health.json() as { ok: boolean; workersLive: number | unknown[] };
    if (!(Array.isArray(live.workersLive) ? live.workersLive.length : live.workersLive)) return { rows: null, error: 'no Gmap worker online' };
    if (!live.ok) throw new Error('myworker health failed');
    const key = opts.apiKey ?? secret('GMAP_API_KEY');
    if (!key) throw new Error('GMAP_API_KEY is missing');
    const headers = { authorization: 'Bearer ' + key, 'content-type': 'application/json' };
    const request = async (url: string, init: RequestInit = {}) => {
      // The service holds a request up to 60 s; give it room to answer before giving up on this one request.
      const res = await fetch(base + url, { ...init, headers, signal: AbortSignal.timeout(90_000) });
      if (!res.ok) throw new Error(`myworker: HTTP ${res.status}`);
      const body = await res.json() as any;
      if (!body.job) throw new Error('myworker returned no job');
      return body.job;
    };
    let job = await request('/api/scan', { method: 'POST', body: JSON.stringify({ keyword, place, max, ...workerIdentification('Search Google Maps'), wait: 60 }) });
    while (job.status === 'pending' || job.status === 'running') {
      if (!job.id) throw new Error('myworker returned no job id');
      job = await request(`/api/scan/${encodeURIComponent(job.id)}?wait=60`);
    }
    if (job.status === 'failed') throw new Error(String(job.error ?? 'Gmap job failed'));
    if (job.status !== 'done') throw new Error(`unexpected Gmap job status: ${job.status}`);
    if (job.result?.stoppedEarly) throw new Error('Google refused the Gmap worker (stoppedEarly)');
    if (!Array.isArray(job.result?.businesses)) throw new Error('no businesses in the answer');
    return { rows: job.result.businesses.map((r: any): WorkerRow => ({
      name: r.name, rating: r.rating ?? null, reviews: r.reviews ?? null, category: r.category ?? null,
      address: r.address ?? null, phone: r.phone ?? null, website: r.website ?? null, mapsUrl: r.mapsUrl ?? null, place_id: r.place_id ?? null,
    })) };
  } catch (err) { return { rows: null, error: err instanceof Error ? err.message : String(err) }; }
}
