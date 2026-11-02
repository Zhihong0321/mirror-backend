// Queues a Google Maps Business scan for every taman in every listed district,
// one after another and spread evenly over the districts, so the lead list fills
// without anyone clicking a taman.
//
// A taman is done once it has a Business scan since the scraper.tech switch:
// the Mac mini's scans before that found a fraction of what a sweep finds
// (Taman Daya: 118 against 1,838), so they do not count. Scans are paid per
// request, so the queue spends against MAPS_MONTHLY_BUDGET, counted in
// maps_usage by maps-worker.ts, and stops starting scans once a scan's worth
// would cross it. Manual scans count against the same number but are never held.
import * as jobs from './jobs.ts';
import * as db from './reportdb.ts';
import * as territories from './territories.ts';

const INTERVAL_MS = 120_000;
/** The first scraper.tech Business scan (2026-10-24): earlier scans ran on the Mac mini. */
export const SCRAPER_SINCE = '2026-10-24T12:00:00Z';
/** Failures count toward giving up only from the sweep retry fix on: before it, one bad search failed any taman. */
export const RETRY_FIX_SINCE = '2026-10-25T01:45:00Z';
/** A Business scan with its street pass: 417 requests in Taman Daya, the densest seen. */
const SCAN_ESTIMATE = 420;

type Launch = (input: { keyword: string; place: string; max: number; userId: string; autoQueued: boolean }) => Promise<unknown>;

let launch: Launch = async () => { throw new Error('auto-scan not initialised'); };
let ticking = false;

export function init(next: { launch: Launch }): void {
  launch = next.launch;
}

export function config(env: NodeJS.ProcessEnv = process.env) {
  const n = (v: string | undefined, fallback: number) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : fallback);
  return {
    paused: /^(1|true|yes|on)$/i.test(env.AUTO_SCAN_PAUSED?.trim() ?? ''),
    budget: n(env.MAPS_MONTHLY_BUDGET, 25_000),
    concurrent: Math.floor(n(env.AUTO_SCAN_CONCURRENT, 1)),
    states: (env.AUTO_SCAN_STATES?.trim() || 'johor,selangor').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
  };
}

type Taman = ReturnType<typeof territories.allTamans>[number];

/**
 * The tamans still to scan, spread evenly over every daerah: the next one always
 * comes from the district with the fewest scanned so far (list order breaks a
 * tie), so all of Johor and Selangor fill at the same pace instead of one
 * district at a time. Within a district, list order.
 */
export function remaining(tamans: Taman[], done: Set<string>): Taman[] {
  const groups = new Map<string, { scanned: number; left: Taman[] }>();
  for (const t of tamans) {
    const key = t.state + '|' + t.district;
    const g = groups.get(key) ?? { scanned: 0, left: [] };
    if (done.has(t.queryPlace.trim().toLowerCase())) g.scanned++; else g.left.push(t);
    groups.set(key, g);
  }
  const order = [...groups.values()];
  const out: Taman[] = [];
  for (;;) {
    let pick: { scanned: number; left: Taman[] } | null = null;
    for (const g of order) if (g.left.length && (!pick || g.scanned < pick.scanned)) pick = g;
    if (!pick) return out;
    out.push(pick.left.shift()!);
    pick.scanned++;
  }
}

/** Why the queue is not starting a scan right now, or null when it may. */
export function holdReason(state: { paused: boolean; workerLive: boolean; used: number; budget: number; inFlight: number; concurrent: number; left: number }): string | null {
  if (state.paused) return 'paused (AUTO_SCAN_PAUSED)';
  if (!state.workerLive) return 'no Maps worker is live';
  if (state.used + SCAN_ESTIMATE > state.budget) return `monthly Maps budget reached (${state.used} of ${state.budget} requests)`;
  if (state.inFlight >= state.concurrent) return 'a scan is running';
  if (!state.left) return 'every listed taman has a Business scan';
  return null;
}

async function snapshot() {
  const cfg = config();
  const [progress, used, discovered] = await Promise.all([
    db.autoScanProgress(SCRAPER_SINCE, RETRY_FIX_SINCE), db.mapsUsageThisMonth(), db.listDiscoveredTamans(),
  ]);
  const tamans = territories.allTamans(discovered, cfg.states);
  // A taman whose scan failed AUTO_SCAN_MAX_FAILURES times is skipped, not retried forever.
  const left = remaining(tamans, new Set([...progress.done, ...progress.gaveUp]));
  const hold = holdReason({
    paused: cfg.paused, workerLive: jobs.liveTypes().includes('gmap.scan'), used, budget: cfg.budget,
    inFlight: progress.inFlight, concurrent: cfg.concurrent, left: left.length,
  });
  return { cfg, used, inFlight: progress.inFlight, total: tamans.length, left, hold, gaveUp: [...progress.gaveUp] };
}

let lastHold: string | null | undefined;
let lastTickAt: string | null = null;

/** Record a change of hold in run_event, so the dashboard can say when and why the scan queue stopped. */
function noteHold(hold: string | null): void {
  lastTickAt = new Date().toISOString();
  // A running scan is the queue working, not a hold.
  const next = hold === 'a scan is running' ? null : hold;
  if (next === lastHold) return;
  lastHold = next;
  void db.logEvent({ stage: 'auto-scan', event: 'auto.hold', detail: { reason: next } });
}

export async function tick(): Promise<string | null> {
  if (ticking || !db.configured()) return null;
  ticking = true;
  try {
    const s = await snapshot();
    noteHold(s.hold);
    if (s.hold) return null;
    const next = s.left[0]!;
    await launch({ keyword: 'business', place: next.queryPlace, max: 2000, userId: 'auto-scan:' + next.name, autoQueued: true });
    console.log(`[auto-scan] queued Business scan of ${next.queryPlace} (${s.total - s.left.length + 1} of ${s.total}, ${s.used} Maps requests used this month)`);
    return next.queryPlace;
  } catch (err) {
    const message = (err as Error).message ?? String(err);
    console.warn('[auto-scan] tick failed: ' + message);
    void db.logEvent({ stage: 'auto-scan', event: 'auto.tick_failed', detail: { error: message } });
    return null;
  } finally {
    ticking = false;
  }
}

export function start(): void {
  setInterval(() => { void tick(); }, INTERVAL_MS).unref();
}

export async function status(): Promise<Record<string, unknown>> {
  const s = await snapshot();
  return {
    paused: s.cfg.paused,
    holding: s.hold,
    lastTickAt,
    states: s.cfg.states,
    tamans: s.total,
    scanned: s.total - s.left.length,
    remaining: s.left.length,
    next: s.left.slice(0, 5).map((t) => t.queryPlace),
    inFlight: s.inFlight,
    gaveUpOn: s.gaveUp,
    mapsRequestsThisMonth: s.used,
    monthlyBudget: s.cfg.budget,
  };
}
