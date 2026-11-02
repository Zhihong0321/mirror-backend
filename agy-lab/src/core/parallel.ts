// Parallel's FindAll Entity Search, the one client for it (person research in
// intel.ts). The key is on /workers (core/secrets.ts; PARALLEL_API_KEY only when none is saved). Logged like every core call; Parallel
// prices per request on its own plan, so the log carries no USD for it.
import { startCall, type ApiCall } from '../cost.ts';
import * as secrets from './secrets.ts';

/** One entity search; returns Parallel's answer, which carries `entities`. */
export async function entitySearch(body: Record<string, unknown>, opts: { what?: string; log?: ApiCall[]; timeoutMs?: number } = {}): Promise<Record<string, unknown>> {
  await secrets.load();
  const key = secrets.get('parallel');
  if (!key) throw new Error('No Parallel key: add one on /workers');
  const c = startCall('web', opts.what ?? `Parallel entity search: ${String(body.objective ?? '').slice(0, 200)}`, { provider: 'parallel' });
  try {
    const response = await fetch('https://api.parallel.ai/v1beta/findall/entity-search', {
      method: 'POST',
      headers: { 'x-api-key': key, 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(opts.timeoutMs ?? 90_000),
    });
    if (!response.ok) throw new Error(`Parallel Entity Search returned HTTP ${response.status}`);
    const payload = await response.json();
    if (!payload || typeof payload !== 'object' || !Array.isArray((payload as Record<string, unknown>).entities)) {
      throw new Error('Parallel Entity Search returned an invalid response');
    }
    opts.log?.push(c.done({ ok: true, usd: null, results: (payload as { entities: unknown[] }).entities.length }));
    return payload as Record<string, unknown>;
  } catch (err) {
    opts.log?.push(c.done({ ok: false, usd: 0, note: (err as Error).message.slice(0, 200) }));
    throw err;
  }
}
