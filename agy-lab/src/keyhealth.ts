// API key health for the /auto-queue page: what each paid service the pipeline
// spends has left, from the provider itself wherever it will say.
//
//   Tavily        GET /usage per key (tavily.ts refreshes it every ten minutes)
//   Exa           no usage endpoint; the hub counts costDollars per key (exa.record),
//                 and the US proxy's GET /usage counts its own keys' spend
//   scraper.tech  no usage endpoint; the hub counts requests (maps_usage) plus the finder's
//   MiniMax       GET /v1/api/openplatform/coding_plan/remains, the Token Plan windows
//   Extract LLM   CONTACT_LLM_URL's /dashboard/billing/{subscription,usage} (one-api style)
//
// Provider reads are cached for five minutes, so a page refreshing every minute
// does not spend anyone's rate limit.
import * as db from './reportdb.ts';
import { exa, llm as extractLlm, pi, secrets, tavily } from './core/index.ts';
import * as autoScan from './autoscan.ts';

type FetchImpl = typeof fetch;
export type Level = 'ok' | 'warn' | 'bad' | 'unknown';

const CACHE_MS = 5 * 60_000;

const tail = (secret: string) => (secret.length <= 4 ? '••••' : '••••' + secret.slice(-4));
const iso = (v: unknown) => (v == null ? null : new Date(v as string).toISOString());

/** Share left to a level: under 5% is out, under 20% is low. */
export function levelFor(left: number | null, total: number | null): Level {
  if (left == null || total == null || total <= 0) return 'unknown';
  const share = left / total;
  return share < 0.05 ? 'bad' : share < 0.2 ? 'warn' : 'ok';
}

const cache = new Map<string, { at: number; value: unknown }>();
async function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value as T;
  const value = await load();
  cache.set(key, { at: Date.now(), value });
  return value;
}

/** The Token Plan windows MiniMax reports: the rolling interval and the week, as percent left. */
export function parseMinimax(body: unknown): Array<{ model: string; intervalLeftPct: number | null; intervalResetsAt: string | null; weekLeftPct: number | null; weekResetsAt: string | null }> {
  const b = body as { model_remains?: Array<Record<string, unknown>>; base_resp?: { status_code?: number; status_msg?: string } };
  if (b?.base_resp && b.base_resp.status_code !== 0) throw new Error('MiniMax: ' + (b.base_resp.status_msg ?? 'status ' + b.base_resp.status_code));
  const pct = (v: unknown) => (typeof v === 'number' ? v : null);
  const at = (v: unknown) => (typeof v === 'number' ? new Date(v).toISOString() : null);
  return (b?.model_remains ?? []).map((m) => ({
    model: String(m.model_name ?? 'general'),
    intervalLeftPct: pct(m.current_interval_remaining_percent),
    intervalResetsAt: at(m.end_time),
    weekLeftPct: pct(m.current_weekly_remaining_percent),
    weekResetsAt: at(m.weekly_end_time),
  }));
}

async function minimax(fetchImpl: FetchImpl) {
  const key = pi.config().apiKey;
  if (!key) return { level: 'unknown' as Level, configured: false, note: 'No MiniMax key on /workers' };
  try {
    const windows = await cached('minimax', async () => {
      return parseMinimax(await pi.remains(fetchImpl));
    });
    const worst = Math.min(...windows.flatMap((w) => [w.intervalLeftPct, w.weekLeftPct].filter((n): n is number => n != null)));
    return { level: Number.isFinite(worst) ? levelFor(worst, 100) : 'unknown' as Level, configured: true, keyTail: tail(key), windows };
  } catch (err) {
    return { level: 'unknown' as Level, configured: true, keyTail: tail(key), error: (err as Error).message };
  }
}

/** One-api style billing: hard_limit_usd is the key's total, total_usage is cents spent. */
export function parseBilling(subscription: unknown, usage: unknown): { limitUsd: number; usedUsd: number; leftUsd: number } | null {
  const limit = Number((subscription as { hard_limit_usd?: unknown })?.hard_limit_usd);
  const cents = Number((usage as { total_usage?: unknown })?.total_usage);
  if (!Number.isFinite(limit) || !Number.isFinite(cents)) return null;
  const usedUsd = cents / 100;
  return { limitUsd: limit, usedUsd, leftUsd: Math.max(0, limit - usedUsd) };
}

/** Every LLM lane's balance, from the lane's own account endpoint where it has one (one-api style). */
async function extract(fetchImpl: FetchImpl) {
  const all = extractLlm.pool();
  if (!all.length) return { level: 'unknown' as Level, configured: false, note: 'no LLM lane is saved on /workers' };
  const lanes = await Promise.all(all.map(async (cfg) => {
    const base = { lane: extractLlm.laneName(cfg), model: cfg.model, host: new URL(cfg.url).host, keyTail: tail(cfg.key), restingUntil: extractLlm.restingUntilFor(cfg.key), busy: extractLlm.busyFor(cfg.key) };
    try {
      const billing = await cached('extract:' + cfg.key, async () =>
        parseBilling(await extractLlm.laneGet(cfg, '/dashboard/billing/subscription', fetchImpl), await extractLlm.laneGet(cfg, '/dashboard/billing/usage', fetchImpl)));
      if (!billing) return { ...base, level: 'unknown' as Level, note: 'the provider gave no balance' };
      return { ...base, level: levelFor(billing.leftUsd, billing.limitUsd), ...billing };
    } catch (err) {
      return { ...base, level: 'unknown' as Level, error: (err as Error).message };
    }
  }));
  // The page's tile shows the first lane; every lane is listed beside it.
  return { ...lanes[0], configured: true, lanes };
}

async function tavilyKeys() {
  await tavily.refresh();
  // The US proxy is one source in the pool; its own report is shown apart, not summed with the hub's keys.
  const keys = tavily.pool.stats().filter((k) => !exa.isProxy(k.secret)).map((k) => ({
    tail: k.tail,
    used: k.usedThisMonth,
    limit: k.monthlyLimit,
    left: k.monthlyLimit != null && k.usedThisMonth != null ? Math.max(0, k.monthlyLimit - k.usedThisMonth) : null,
    resting: k.resting,
    cooling: k.cooling,
    usageError: k.usageError,
    usageCheckedAt: k.usageCheckedAt,
  }));
  const known = keys.filter((k) => k.limit != null);
  const left = known.reduce((n, k) => n + (k.left ?? 0), 0);
  const total = known.reduce((n, k) => n + (k.limit ?? 0), 0);
  const usable = keys.filter((k) => !k.cooling).length;
  const failed = keys.filter((k) => k.usageError);
  // A key whose quota cannot be read is not known to be fine.
  const level: Level = !keys.length ? 'unknown' : !usable ? 'bad' : failed.length && !known.length ? 'warn' : levelFor(left, total);
  const proxy = await cached('tavily-proxy', tavilyProxy);
  const proxyUsable = proxy?.reachable ? Number(proxy.usable ?? 0) : 0;
  return {
    level: !usable && proxyUsable ? 'warn' as Level : level, keys: keys.length, usable, creditsLeft: left, creditsTotal: total, keysRead: known.length,
    readFailures: failed.length, readError: failed[0]?.usageError ?? null, perKey: keys, proxy,
  };
}

/** The US proxy's Tavily keys (GET /usage/tavily): how many, how many usable, credits spent and an estimate of what is left. */
async function tavilyProxy() {
  const saved = exa.proxy();
  if (!saved) return null;
  try {
    const usage = await tavily.proxyUsage();
    return { url: saved.url, reachable: true, creditAssumedCredits: usage?.creditAssumedCredits ?? null, ...(usage?.totals ?? {}) };
  } catch (err) {
    return { url: saved.url, reachable: false, error: (err as Error).message };
  }
}

async function exaKeys() {
  await exa.refresh();
  await exa.flush();
  const spend = new Map((await db.listSearchKeySpend('exa')).map((r) => [r.secret, r]));
  const keys = exa.pool.stats().map((k) => {
    const s = spend.get(k.secret);
    return {
      tail: exa.isProxy(k.secret) ? 'US proxy' : k.tail,
      via: exa.via(k.secret),
      cooling: k.cooling,
      spentUsd: s ? Math.round(s.dollars * 1000) / 1000 : 0,
      calls: s?.calls ?? 0,
      failures: s?.failures ?? 0,
      lastOkAt: iso(s?.last_ok_at),
      lastError: s?.last_error ?? null,
      lastErrorAt: iso(s?.last_error_at),
      since: iso(s?.since),
    };
  });
  const usable = keys.filter((k) => !k.cooling).length;
  const level: Level = !keys.length ? 'unknown' : !usable ? 'bad' : usable < keys.length / 2 ? 'warn' : 'ok';
  // One pool, split by where the call leaves from: this server, or the US proxy.
  const split = (via: 'direct' | 'us') => {
    const some = keys.filter((k) => k.via === via);
    return { keys: some.length, usable: some.filter((k) => !k.cooling).length, spentUsd: Math.round(some.reduce((n, k) => n + k.spentUsd, 0) * 100) / 100 };
  };
  return {
    level, keys: keys.length, usable, spentUsd: Math.round(keys.reduce((n, k) => n + k.spentUsd, 0) * 100) / 100,
    direct: split('direct'), us: split('us'), proxy: await cached('exa-proxy', exaProxy), perKey: keys,
  };
}

/** The US proxy's own count: what its keys spent and an estimate of the credit they have left. */
async function exaProxy() {
  const saved = exa.proxy();
  if (!saved) return null;
  try {
    const usage = await exa.proxyUsage();
    return { url: saved.url, reachable: true, creditAssumedUsd: usage?.creditAssumedUsd ?? null, ...(usage?.totals ?? {}) };
  } catch (err) {
    return { url: saved.url, reachable: false, error: (err as Error).message };
  }
}

async function scraperTech() {
  const plan = Number(process.env.SCRAPER_TECH_MONTHLY_LIMIT) || 30_000;
  const budget = autoScan.config().budget;
  const [hub, finder] = await Promise.all([db.mapsUsageThisMonth(), db.finderMapsRequestsThisMonth()]);
  const used = hub + finder;
  const left = Math.max(0, plan - used);
  const now = new Date();
  const resetsAt = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString();
  return { level: levelFor(left, plan), plan, used, hub, finder, left, autoScanBudget: budget, resetsAt, configured: Boolean(secrets.get('scraper_tech')) };
}

const settle = async <T>(name: string, run: () => Promise<T>): Promise<T | { level: Level; error: string }> => {
  try { return await run(); } catch (err) { return { level: 'unknown', error: `${name}: ${(err as Error).message}` }; }
};

export async function snapshot(fetchImpl: FetchImpl = fetch) {
  const [tav, ex, maps, mm, llm] = await Promise.all([
    settle('tavily', tavilyKeys), settle('exa', exaKeys), settle('scraper.tech', scraperTech), minimax(fetchImpl), extract(fetchImpl),
  ]);
  return { tavily: tav, exa: ex, scraperTech: maps, minimax: mm, extractLlm: llm };
}
