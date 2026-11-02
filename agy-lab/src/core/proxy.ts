// The US proxy in US West (G:\exa-api-proxy, Railway service exa-proxy). Since
// 2026-11-01 it holds its own Exa and Tavily keys: a call carries only
// x-proxy-token, the proxy picks a key, rests one the API refuses and retries the
// same call on the next, and answers 429 with tag PROXY_NO_KEY when every key it
// holds for that API rests. So the hub counts it as ONE source in each pool
// (PROXY_SOURCE), never as its keys. Its URL and token are one row of kind
// 'exa_proxy', saved as JSON {url, token} through /api/contact-keys.
export const PROXY_SOURCE = 'proxy:us';
/** A PROXY_NO_KEY answer with no retry-after rests the source this long. */
const NO_KEY_REST_MS = 10 * 60_000;

export type ProxyConfig = { url: string; token: string };
let config: ProxyConfig | null = null;

export function parseProxy(saved: unknown): ProxyConfig | null {
  let p: { url?: unknown; token?: unknown };
  try { p = typeof saved === 'string' ? JSON.parse(saved) : (saved as typeof p); } catch { return null; }
  const url = String(p?.url ?? '').trim().replace(/\/+$/, '');
  const token = String(p?.token ?? '').trim();
  return /^https?:\/\/\S+$/.test(url) && token ? { url, token } : null;
}

export function proxy(): ProxyConfig | null {
  return config;
}

export function setProxy(next: ProxyConfig | null): void {
  config = next;
}

export function isProxy(secret: string): boolean {
  return secret === PROXY_SOURCE;
}

/** The pool's keys plus the proxy as one more source, when a proxy is saved. */
export function withProxy(keys: string[]): string[] {
  return config ? [...keys, PROXY_SOURCE] : keys;
}

/** The proxy's report on the keys it holds: GET /usage (Exa) or /usage/tavily. */
export async function usage(api: 'exa' | 'tavily', fetchImpl: typeof fetch = fetch): Promise<Record<string, any> | null> {
  if (!config) return null;
  const res = await fetchImpl(`${config.url}/usage${api === 'tavily' ? '/tavily' : ''}`, { headers: { 'x-proxy-token': config.token }, signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`proxy /usage${api === 'tavily' ? '/tavily' : ''} answered ${res.status}`);
  return res.json();
}

/** A 429 the proxy sent because every key it holds rests: how long to rest the source, else null. */
export function noKeyRestMs(res: Response, raw: string): number | null {
  if (!raw.includes('PROXY_NO_KEY')) return null;
  const after = Number(res.headers.get('retry-after'));
  return after > 0 ? after * 1000 : NO_KEY_REST_MS;
}
