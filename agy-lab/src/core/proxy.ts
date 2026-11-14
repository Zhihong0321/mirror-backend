// The US proxy in US West (G:\exa-api-proxy, Railway service exa-proxy). Since
// 2026-11-01 it holds its own Exa and Tavily keys: a call carries only
// x-proxy-token, the proxy picks a key, rests one the API refuses and retries the
// same call on the next, and answers 429 with tag PROXY_NO_KEY when every key it
// holds for that API rests. So the hub counts it as ONE source in each pool
// (PROXY_SOURCE), never as its keys. Its URL and token are one row of kind
// 'exa_proxy', saved as JSON {url, token} through /api/contact-keys.
export const PROXY_SOURCE = 'proxy:us';
/** A PROXY_NO_KEY answer rests the source this long at most. The proxy's own
 * retry-after can be hours off, and asking it again costs nothing: on
 * 2026-11-01 a long retry-after kept the source idle after its keys refilled. */
const NO_KEY_REST_MS = 10 * 60_000;

export type ProxyConfig = { url: string; token: string };
// Every saved proxy, in the order saved (the US one first). Since 2026-11-14 more than one can be saved (the SG proxy
// holds 50 more Exa keys); each is its own source in the Exa pool. Tavily uses only the first (the US one holds the
// Tavily keys). Saving one more never removes another.
let configs: ProxyConfig[] = [];
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
  setProxies(next ? [next] : []);
}

/** Every saved proxy, first one first. */
export function setProxies(list: Array<ProxyConfig | null>): void {
  configs = list.filter((c): c is ProxyConfig => !!c).filter((c, i, all) => all.findIndex((d) => d.url === c.url) === i);
  config = configs[0] ?? null;
}

export function proxies(): ProxyConfig[] {
  return [...configs];
}

/** The pool source name of a proxy: the first is PROXY_SOURCE (US), each other one "proxy:<its host's first label>". */
export function sourceOf(c: ProxyConfig, index: number): string {
  if (index === 0) return PROXY_SOURCE;
  let label = c.url;
  try { label = new URL(c.url).hostname.split('.')[0]; } catch { /* keep the url */ }
  return `proxy:${label}`;
}

/** The proxy a pool source stands for, else null. */
export function configFor(source: string): ProxyConfig | null {
  const i = configs.findIndex((c, k) => sourceOf(c, k) === source);
  return i >= 0 ? configs[i] : null;
}

export function isProxy(secret: string): boolean {
  return secret.startsWith('proxy:');
}

/** The pool's keys plus the first (US) proxy as one more source: Tavily's pool. */
export function withProxy(keys: string[]): string[] {
  return config ? [...keys, PROXY_SOURCE] : keys;
}

/** The pool's keys plus every saved proxy, each one more source: Exa's pool. */
export function withProxies(keys: string[]): string[] {
  return [...keys, ...configs.map(sourceOf)];
}

/** A proxy's report on the keys it holds: GET /usage (Exa) or /usage/tavily. The first proxy unless one is given. */
export async function usage(api: 'exa' | 'tavily', fetchImpl: typeof fetch = fetch, which: ProxyConfig | null = config): Promise<Record<string, any> | null> {
  if (!which) return null;
  const res = await fetchImpl(`${which.url}/usage${api === 'tavily' ? '/tavily' : ''}`, { headers: { 'x-proxy-token': which.token }, signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`proxy /usage${api === 'tavily' ? '/tavily' : ''} answered ${res.status}`);
  return res.json();
}

/** A 429 the proxy sent because every key it holds rests: how long to rest the source, else null. */
export function noKeyRestMs(res: Response, raw: string): number | null {
  if (!raw.includes('PROXY_NO_KEY')) return null;
  const after = Number(res.headers.get('retry-after'));
  return after > 0 ? Math.min(after * 1000, NO_KEY_REST_MS) : NO_KEY_REST_MS;
}
