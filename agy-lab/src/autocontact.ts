// Queues contact research for untouched leads while a matching worker is live.
import * as jobs from './jobs.ts';
import * as db from './reportdb.ts';
import { pi, search } from './core/index.ts';
import { resolveConfig, switchedOff } from './contact-worker.ts';

const INTERVAL_MS = 15_000;

/** Keep one report waiting behind each research lane, so a lane never idles between ticks. */
function batch(): number {
  return resolveConfig().lanes * 2;
}

function modelName(): string {
  const model = (process.env.CONTACT_RESEARCH_MODEL?.trim() || 'research.contact').toLowerCase();
  return model.split(/[:@/]/)[0] ?? model;
}

/**
 * Job type a live contact worker must claim.
 *
 * Pi is the in-hub worker: Tavily finds the pages, Pi (MiniMax) reads them for
 * people and contacts. A MiniMax or Tavily key owns the contact queue. Gemini and
 * agy names from before the Google ban, and ChatGPT names from before that engine
 * was removed, route here too, so an old CONTACT_RESEARCH_MODEL value cannot
 * strand the queue on a worker that is gone.
 */
export function contactResearchJobType(): string {
  const name = modelName();
  if (
    pi.config().apiKey ||
    process.env.TAVILY_API_KEY?.trim() ||
    process.env.TAVILY_API_KEYS?.trim() ||
    /^(pi|minimax|tavily|gemini|gamini|agy|chatgpt|openai|gpt|o[134])/.test(name)
  ) {
    return 'research.contact.pi';
  }
  return 'research.contact';
}

type Launch = (
  company: Record<string, unknown>,
  opts: { autoQueued?: boolean },
) => Promise<unknown>;

type Deps = {
  launch: Launch;
  liveTypes?: () => string[];
  backlog?: (limit: number) => Promise<Record<string, unknown>[]>;
  tavilyAvailable?: () => boolean;
};

let deps: Deps = {
  launch: async () => { throw new Error('auto-queue not initialised'); },
};
let ticking = false;

export function init(next: Deps): void {
  deps = next;
}

function workerLive(): boolean {
  const types = deps.liveTypes ? deps.liveTypes() : jobs.liveTypes();
  return types.includes(contactResearchJobType());
}

/** Queue up to batch() untouched leads when a matching worker is live. */
let pausedForQuota = false;

/** The pi worker searches with Tavily or Exa, so it has no work to give while every key of both rests. */
function outOfCredits(): boolean {
  const paused = contactResearchJobType() === 'research.contact.pi' && !(deps.tavilyAvailable ?? (() => search.available()))();
  if (paused !== pausedForQuota) {
    console.log(paused ? '[auto-queue] paused: every Tavily and Exa key is resting' : '[auto-queue] resumed: a search key has credits again');
    pausedForQuota = paused;
  }
  return paused;
}

/**
 * Held by hand while the lead blacklist (docs/lead-blacklist.md) is reviewed:
 * without it the backlog includes banks, chains and competitors. Railway env, so
 * it survives a redeploy and lifts without one.
 */
export function pausedByHand(env: NodeJS.ProcessEnv = process.env): boolean {
  return /^(1|true|yes|on)$/i.test(env.AUTO_CONTACT_PAUSED?.trim() ?? '');
}

/** Why the queue is not queuing, or null while it works; kept for status() and the /auto-queue page. */
let hold: string | null | undefined;
let lastTickAt: string | null = null;

/** Record a change of hold in run_event, so the dashboard can say when and why the queue stopped. */
function noteHold(next: string | null): void {
  lastTickAt = new Date().toISOString();
  if (next === hold) return;
  hold = next;
  void db.logEvent({ stage: 'auto-contact', event: 'auto.hold', detail: { reason: next } });
}

export async function tick(): Promise<number> {
  if (ticking) return 0;
  const blocked = switchedOff() ? 'switched off (contact-worker.switchedOff)'
    : pausedByHand() ? 'paused (AUTO_CONTACT_PAUSED)'
    : !workerLive() ? `no live worker claims ${contactResearchJobType()}`
    : outOfCredits() ? 'every Tavily and Exa key is resting'
    : null;
  if (blocked) { noteHold(blocked); return 0; }
  ticking = true;
  try {
    // Saved reports are the durable queue. Do not mint new reports while older
    // ones are waiting for the research lanes.
    const free = deps.backlog ? batch() : Math.max(0, batch() - await db.pendingContactReportCount());
    // Full lanes are the queue working, not a hold.
    if (!free) { noteHold(null); return 0; }
    // The backlog only offers leads checked against the blacklist; check new ones first.
    if (!deps.backlog) await db.applyLeadBlacklist();
    const rows = deps.backlog
      ? await deps.backlog(free)
      : await db.contactResearchBacklog(free);
    for (const company of rows) {
      await deps.launch(company, { autoQueued: true });
    }
    noteHold(rows.length ? null : 'no lead is waiting for contact research');
    console.log(`[auto-queue] queued ${rows.length} contact research job(s)`);
    return rows.length;
  } catch (err) {
    const message = (err as Error).message ?? String(err);
    console.warn('[auto-queue] tick failed: ' + message);
    void db.logEvent({ stage: 'auto-contact', event: 'auto.tick_failed', detail: { error: message } });
    return 0;
  } finally {
    ticking = false;
  }
}

export function start(): void {
  setInterval(() => { void tick(); }, INTERVAL_MS).unref();
}

export async function status(): Promise<{
  workerAvailable: boolean;
  pausedForQuota: boolean;
  paused: boolean;
  holding: string | null;
  lastTickAt: string | null;
  jobType: string;
  totals: { queued: number; running: number; completed: number; failed: number };
}> {
  return {
    workerAvailable: workerLive(),
    pausedForQuota: outOfCredits(),
    paused: pausedByHand(),
    holding: hold ?? null,
    lastTickAt,
    jobType: contactResearchJobType(),
    totals: await db.autoContactQueueTotals(),
  };
}
