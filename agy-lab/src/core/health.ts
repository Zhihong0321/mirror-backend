// What every outside tool core/ owns looks like right now, for the /tools page: the key pools as the hub holds them,
// what the Exa/Tavily proxy says about its keys, each LLM lane, and whether each other API has a key saved.
// It only READS state. It never rests, leases or changes a key, and it never stops a run: a tool that is down is shown
// as down, and the pipeline keeps going on whatever still works. Each part is guarded on its own, so one tool that
// cannot be read shows "unknown" and never hides the others.
import * as exa from './exa.ts';
import * as tavily from './tavily.ts';
import * as brave from './brave.ts';
import * as llm from './llm.ts';
import * as secrets from './secrets.ts';
import * as proxy from './proxy.ts';

export type State = 'ok' | 'warn' | 'down' | 'off' | 'unknown';
/** One tool. `match` is how its calls are recorded (cost.ts startCall): api name and, for LLM lanes, the lane label. */
export type Row = { group: string; tool: string; state: State; summary: string; details: string[]; match?: { api: string; provider?: string } };

const message = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 300);

/** Runs one probe; a probe that throws becomes an "unknown" row with the reason, never a missing row. */
export async function guard(group: string, tool: string, probe: () => Promise<Row[]> | Row[]): Promise<Row[]> {
  try {
    const rows = await probe();
    return rows.length ? rows : [{ group, tool, state: 'unknown', summary: 'nothing to report', details: [] }];
  } catch (e) {
    return [{ group, tool, state: 'unknown', summary: `could not read its status: ${message(e)}`, details: [] }];
  }
}

const when = (iso: string | null | undefined) => (iso ? iso.replace('T', ' ').slice(0, 16) + ' UTC' : '');

/** The hub's own key pool (in this process): how many keys it holds and how many it is resting. */
function poolRow(group: string, tool: string, stats: Array<Record<string, any>>, api: string): Row {
  const keys = stats.filter((k) => !proxy.isProxy(String(k.secret ?? '')));
  const viaProxy = stats.length > keys.length;
  const resting = stats.filter((k) => k.resting || k.cooling);
  const state: State = !stats.length ? 'unknown' : resting.length === stats.length ? 'down' : resting.length ? 'warn' : 'ok';
  const summary = !stats.length
    ? 'the hub has not loaded these keys since it started (they load on first use)'
    : `${stats.length - resting.length} of ${stats.length} sources usable by the hub${viaProxy ? ' (the proxy counts as one source)' : ''}${resting.length ? `, ${resting.length} resting` : ''}`;
  const details = stats.filter((k) => k.resting || k.cooling || k.usageError).map((k) =>
    `${proxy.isProxy(String(k.secret ?? '')) ? 'proxy' : k.tail ?? 'key'}: ${k.resting ? 'resting (out of credit)' : k.cooling ? 'cooling down' : 'ok'}${k.usageError ? ` · ${k.usageError}` : ''}`);
  return { group, tool, state, summary, details, match: { api } };
}

/** What the proxy reports about the keys it holds (GET /usage, /usage/tavily). */
async function proxyRow(group: string, tool: string, api: 'exa' | 'tavily'): Promise<Row[]> {
  if (!proxy.proxy()) return [{ group, tool, state: 'off', summary: 'no proxy saved on /workers', details: [] }];
  const u = await proxy.usage(api);
  const t = u?.totals ?? {};
  const keys = Number(t.keys ?? 0), usable = Number(t.usable ?? 0);
  const state: State = !keys ? 'down' : usable === 0 ? 'down' : usable * 4 < keys ? 'warn' : 'ok';
  const left = api === 'exa' ? (t.estimatedLeftUsd != null ? `about $${t.estimatedLeftUsd} left` : '') : (t.estimatedLeftCredits != null ? `about ${t.estimatedLeftCredits} credits left` : '');
  const summary = `${usable} of ${keys} keys usable · ${t.outOfCredit ?? 0} out of credit · ${t.invalid ?? 0} invalid · ${t.rateLimited ?? 0} rate-limited${left ? ` · ${left}` : ''}`;
  const details = (u?.keys ?? []).filter((k: any) => k.state !== 'ok').map((k: any) =>
    `${k.tail ?? 'key'}: ${k.state}${k.lastErrorAt ? ` since ${when(k.lastErrorAt)}` : ''}${k.lastError ? ` · ${String(k.lastError).slice(0, 160)}` : ''}`);
  return [{ group, tool, state, summary, details, match: { api } }];
}

/** Every tool core/ owns. */
export async function snapshot(): Promise<Row[]> {
  // The proxy setting and the keys load on a tool's first use after a restart; load them here so the page never
  // says "no proxy" or "not loaded" only because no search has run yet. Loading changes no key's state.
  try { await exa.loadKeys(); } catch { /* shown as unknown below */ }
  try { if (!exa.pool.stats().length) await exa.refresh(); } catch { /* shown as unknown below */ }
  try { if (!tavily.pool.stats().length) tavily.pool.setKeys(proxy.withProxy(await tavily.loadKeys())); } catch { /* shown as unknown below */ }
  const parts = await Promise.all([
    guard('Web search', 'Exa (keys the proxy holds)', () => proxyRow('Web search', 'Exa (keys the proxy holds)', 'exa')),
    guard('Web search', 'Exa (hub key pool)', () => [poolRow('Web search', 'Exa (hub key pool)', exa.pool.stats(), 'exa')]),
    guard('Web search', 'Tavily (keys the proxy holds)', () => proxyRow('Web search', 'Tavily (keys the proxy holds)', 'tavily')),
    guard('Web search', 'Tavily (hub key pool)', () => [poolRow('Web search', 'Tavily (hub key pool)', tavily.pool.stats(), 'tavily')]),
    guard('Web search', 'Brave', async () => {
      const keys = await brave.current();
      return [{ group: 'Web search', tool: 'Brave', state: keys.length ? 'ok' : 'off', summary: keys.length ? `${keys.length} key${keys.length === 1 ? '' : 's'} saved (Brave reports no credit; see the last calls)` : 'no key saved', details: [], match: { api: 'brave' } }];
    }),
    guard('LLM lanes', 'LLM lanes', async () => (await llm.listLanes()).map((l) => {
      const until = llm.restingUntilFor(l.key);
      const busy = llm.busyFor(l.key);
      const state: State = !l.enabled ? 'off' : until ? 'warn' : 'ok';
      const summary = `${l.model} · ${l.url.replace(/^https?:\/\//, '').replace(/\/.*$/, '')}${!l.enabled ? ' · switched off' : ''}${l.first ? ' · used first' : ''}${until ? ` · resting until ${when(until)}` : ''}${busy ? ` · ${busy} call${busy === 1 ? '' : 's'} running now` : ''}`;
      return { group: 'LLM lanes', tool: l.label, state, summary, details: [], match: { api: 'llm', provider: l.label } };
    })),
    guard('Other APIs', 'Saved API keys', () => (Object.keys(secrets.KINDS) as secrets.Kind[]).map((kind) => {
      const saved = !!secrets.get(kind);
      const name: Record<string, string> = { minimax: 'MiniMax (last-resort LLM)', parallel: 'Parallel (person research)', smartlead: 'Smartlead (cold email)', pagespeed: 'Google PageSpeed', scraper_tech: 'ScraperTech (Google reviews)', agy_hub: 'Antigravity hub token' };
      return { group: 'Other APIs', tool: name[kind] ?? kind, state: (saved ? 'ok' : 'down') as State, summary: saved ? 'key saved' : 'no key saved: anything that needs it cannot run', details: [] };
    })),
  ]);
  return parts.flat();
}
