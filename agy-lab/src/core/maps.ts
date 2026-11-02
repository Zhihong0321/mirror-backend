// scraper.tech's Google Maps API (an MCP server over HTTP): search_maps,
// place_info, reviews, place_photos. The one client for it: the Maps worker's
// sweeps, the dive-deeper lanes and their review pages all call here.
//
// The key is on /workers (core/secrets.ts; SCRAPER_TECH_KEY only when none is saved),
// SCRAPER_TECH_BASE_URL the server (mcp.scraper.tech).
// A 5xx or a dropped connection is asked again once; a 429 says rate_limit; an
// answer that is not ok says engine_error. A request scraper.tech answered with
// HTTP 200 is billed, so it is logged ok even when the tool reports an error.
import { startCall, type ApiCall } from '../cost.ts';
import * as secrets from './secrets.ts';

type FetchImpl = typeof fetch;

const DEFAULT_BASE_URL = 'https://mcp.scraper.tech';

export type MapsTool = 'search_maps' | 'place_info' | 'reviews' | 'place_photos';

export function config(env: NodeJS.ProcessEnv = process.env): { key: string; baseUrl: string } {
  return {
    key: secrets.get('scraper_tech', env),
    baseUrl: String(env.SCRAPER_TECH_BASE_URL ?? DEFAULT_BASE_URL).trim().replace(/\/+$/, ''),
  };
}

function fail(message: string, code = 'engine_error'): Error {
  return Object.assign(new Error(message), { code });
}

export type CallOpts = {
  what?: string;
  log?: ApiCall[];
  /** Override the configured key and server (a worker with its own config, a local script). */
  key?: string;
  baseUrl?: string;
  /** No timeout unless the caller passes one. */
  timeoutMs?: number;
  fetchImpl?: FetchImpl;
};

/** One tool call; returns the tool's parsed JSON answer. */
export async function call(tool: MapsTool, args: Record<string, string>, opts: CallOpts = {}): Promise<any> {
  if (!opts.key) await secrets.load();
  const cfg = config();
  const key = opts.key ?? cfg.key;
  const baseUrl = (opts.baseUrl ?? cfg.baseUrl).replace(/\/+$/, '');
  if (!key) throw fail('No scraper.tech key: add one on /workers', 'not_configured');
  const fetchImpl = opts.fetchImpl ?? fetch;
  const what = opts.what ?? `${tool} ${Object.values(args).join(' ')}`;
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const c = startCall('maps', what, { provider: 'scraper.tech' });
    let res: Response;
    try {
      res = await fetchImpl(`${baseUrl}/${key}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
        body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method: 'tools/call', params: { name: tool, arguments: args } }),
        ...(opts.timeoutMs ? { signal: AbortSignal.timeout(opts.timeoutMs) } : {}),
      });
    } catch (cause) {
      opts.log?.push(c.done({ ok: false, note: (cause as Error).message.slice(0, 200) }));
      lastError = cause;
      continue;
    }
    if (res.status >= 500) {
      opts.log?.push(c.done({ ok: false, note: `HTTP ${res.status}` }));
      lastError = fail(`scraper.tech answered HTTP ${res.status}`);
      continue;
    }
    if (!res.ok) {
      opts.log?.push(c.done({ ok: false, note: `HTTP ${res.status}` }));
      throw fail(`scraper.tech answered HTTP ${res.status}`, res.status === 429 ? 'rate_limit' : 'engine_error');
    }
    let rpc: { result?: { isError?: boolean; content?: Array<{ text?: string }> }; error?: { message?: string } };
    try {
      rpc = await res.json() as typeof rpc;
    } catch {
      opts.log?.push(c.done({ ok: true, note: 'answer was not JSON' }));
      throw fail('scraper.tech returned no JSON');
    }
    if (rpc.error) {
      opts.log?.push(c.done({ ok: true, note: String(rpc.error.message ?? 'JSON-RPC error').slice(0, 200) }));
      throw fail('scraper.tech: ' + (rpc.error.message ?? 'JSON-RPC error'));
    }
    const raw = rpc.result?.content?.[0]?.text ?? '';
    let data: { status?: string; message?: string; [k: string]: unknown };
    try {
      data = JSON.parse(raw);
    } catch {
      opts.log?.push(c.done({ ok: true, note: 'tool answer was not JSON' }));
      throw fail('scraper.tech returned no JSON: ' + raw.slice(0, 200));
    }
    // search_maps answers {status:"ok", data}; reviews has no status field at all.
    if (rpc.result?.isError || (data.status !== undefined && data.status !== 'ok')) {
      opts.log?.push(c.done({ ok: true, note: String(data.message ?? raw).slice(0, 200) }));
      throw fail(`scraper.tech ${tool} failed: ` + (data.message ?? raw.slice(0, 200)));
    }
    opts.log?.push(c.done({ ok: true, ...(Array.isArray(data.data) ? { results: data.data.length } : {}) }));
    return data;
  }
  throw fail('scraper.tech did not answer: ' + ((lastError as Error)?.message ?? String(lastError)), 'timeout');
}
