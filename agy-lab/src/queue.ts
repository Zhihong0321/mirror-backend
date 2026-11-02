// The admission queue: what stands between a burst of API calls and the MiniMax
// account getting rate-limited.
//
// Calls are admitted a lane at a time, spaced, and counted, so a burst queues
// here instead of arriving at the provider as a burst.
//
// Three refusals, in order of how early they fire:
//
//   1. hourly cap    - this account has had enough for now. 429.
//   2. queue depth   - too many already waiting. 429, with how long to wait.
//   3. estimated wait- the queue is short but slow. 429 rather than a request
//                      that sits for ten minutes and then answers into a socket
//                      whose client gave up nine minutes ago.
//
// Anything that passes all three WAITS rather than fails: the caller asked for an
// answer, and an answer at +40s is worth more than an error at +0s. Callers that
// disagree set their own client timeout.

// Pi is the only engine left. The ChatGPT and Meta AI browser engines, and the
// lanes they ran in, were removed on 2026-10-26 once Cloudflare refused ChatGPT
// from this container.
export type Engine = 'pi';
type Lane = 'pi';

const laneOf = (_engine: Engine): Lane => 'pi';

const int = (name: string, fallback: number): number => {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw >= 0 ? raw : fallback;
};

/**
 * Per-engine policy.
 *
 * The gap is the important one and the least obvious: it is not about capacity,
 * it is about not looking like a script. Two seconds between browser calls costs
 * nothing against a 12-second answer and keeps a burst from arriving as a burst.
 * Zero for Pi, which is an API client talking to an API that expects programs.
 *
 * Hourly caps default to off. A cap that nobody chose is a pipeline that stops
 * at 3am for a reason nobody remembers - but the account limits here are real, so
 * the knob exists and is documented.
 */
function policy(engine: Engine): {
  minGapMs: number;
  maxDepth: number;
  maxWaitMs: number;
  hourlyLimit: number;
  neverReject: boolean;
} {
  const prefix = engine.toUpperCase();
  // Never reject by default: requests queue FIFO and wait their turn instead of being shed with 429.
  // Set QUEUE_REJECT=true to opt into legacy 429 load shedding.
  const neverReject = process.env.QUEUE_REJECT !== 'true';
  return {
    minGapMs: int(prefix + '_MIN_GAP_MS', 0),
    maxDepth: int(prefix + '_MAX_QUEUE', int('QUEUE_MAX_DEPTH', 10)),
    maxWaitMs: int(prefix + '_MAX_WAIT_MS', int('QUEUE_MAX_WAIT_MS', 300_000)),
    hourlyLimit: int(prefix + '_HOURLY_LIMIT', 0),
    neverReject,
  };
}

/** How many run at once in a lane. */
const laneConcurrency = (_lane: Lane): number => Math.max(1, int('PI_MAX_CONCURRENT', 6));

interface LaneState {
  inflight: number;
  waiting: Array<() => void>;
  /** Exponential moving average of how long a call in this lane takes, seeded on first use. */
  emaMs: number;
  samples: number;
}

interface EngineState {
  lastStartedAt: number;
  /** Start times within the last hour, for the cap. Trimmed on read. */
  recent: number[];
  ok: number;
  failed: number;
  refused: number;
  totalMs: number;
}

const lanes: Record<Lane, LaneState> = {
  pi: { inflight: 0, waiting: [], emaMs: 20_000, samples: 0 },
};

const engines: Record<Engine, EngineState> = {
  pi: fresh(),
};

function fresh(): EngineState {
  return { lastStartedAt: 0, recent: [], ok: 0, failed: 0, refused: 0, totalMs: 0 };
}

export interface BusyError extends Error {
  status: 429;
  type: string;
  retryAfterSec: number;
  queue: Record<string, unknown>;
}

function busy(type: string, message: string, retryAfterSec: number, engine: Engine): BusyError {
  engines[engine].refused++;
  return Object.assign(new Error(message), {
    status: 429 as const,
    type,
    retryAfterSec: Math.max(1, Math.ceil(retryAfterSec)),
    queue: snapshot(engine),
  });
}

const hourAgo = (): number => Date.now() - 3_600_000;

function recentHits(engine: Engine): number[] {
  const s = engines[engine];
  s.recent = s.recent.filter((t) => t > hourAgo());
  return s.recent;
}

/**
 * What a call will wait, before it commits to waiting.
 *
 * Deliberately pessimistic about the call already running: its remaining time is
 * counted as a whole average rather than half of one, because under-promising a
 * wait is what produces a client that gives up mid-answer.
 */
function estimateWaitMs(lane: Lane, engine: Engine): number {
  const l = lanes[lane];
  const concurrency = laneConcurrency(lane);
  const ahead = l.waiting.length + Math.min(l.inflight, concurrency);
  const rounds = Math.ceil(Math.max(0, ahead - concurrency + 1) / concurrency);
  const gap = policy(engine).minGapMs;
  return Math.max(0, rounds * (l.emaMs + gap));
}

export interface QueueInfo {
  /** How many were ahead when this call arrived. */
  ahead: number;
  estimatedWaitMs: number;
}

export interface Admitted<T> {
  value: T;
  queuedMs: number;
  ahead: number;
}

/**
 * Admit one call, or refuse it.
 *
 * `onQueued` fires once, before the wait, when there is a wait - the streaming
 * path uses it to tell the client it is queued rather than leaving a socket
 * silent for a minute.
 */
export async function run<T>(
  engine: Engine,
  fn: () => Promise<T>,
  hooks: { onQueued?: (info: QueueInfo) => void } = {},
): Promise<Admitted<T>> {
  const lane = laneOf(engine);
  const l = lanes[lane];
  const p = policy(engine);
  const arrived = Date.now();

  // If legacy rejection is explicitly enabled, fast-fail with 429 when limits are reached:
  if (!p.neverReject) {
    const hits = recentHits(engine);
    if (p.hourlyLimit && hits.length >= p.hourlyLimit) {
      const oldest = hits[0] ?? arrived;
      const freeIn = (oldest + 3_600_000 - arrived) / 1000;
      throw busy(
        'rate_limit_exceeded',
        `${engine} has used its hourly allowance (${hits.length}/${p.hourlyLimit}). It frees up in ${Math.ceil(freeIn / 60)} min.`,
        freeIn,
        engine,
      );
    }

    if (l.waiting.length >= p.maxDepth) {
      const wait = estimateWaitMs(lane, engine);
      throw busy(
        'queue_full',
        `System busy: ${l.waiting.length} calls are already waiting for Pi and the queue is capped at ${p.maxDepth}. Retry in about ${Math.ceil(wait / 1000)}s.`,
        wait / 1000,
        engine,
      );
    }

    const estimatedWaitMs = estimateWaitMs(lane, engine);
    if (estimatedWaitMs > p.maxWaitMs) {
      throw busy(
        'queue_too_slow',
        `System busy: the wait is about ${Math.ceil(estimatedWaitMs / 1000)}s, past the ${Math.round(p.maxWaitMs / 1000)}s this gateway will hold a request. Retry shortly.`,
        estimatedWaitMs / 1000,
        engine,
      );
    }
  }

  const ahead = l.waiting.length + l.inflight;
  const estimatedWaitMs = estimateWaitMs(lane, engine);
  if (ahead > 0 && hooks.onQueued) hooks.onQueued({ ahead, estimatedWaitMs });

  // ---- wait for a slot, FIFO -------------------------------------------
  if (l.inflight >= laneConcurrency(lane)) {
    await new Promise<void>((resolve) => l.waiting.push(resolve));
  }
  l.inflight++;

  try {
    // ---- hourly cap pacing (never reject: wait until quota opens) --------
    if (p.hourlyLimit) {
      while (recentHits(engine).length >= p.hourlyLimit) {
        const hits = recentHits(engine);
        const oldest = hits[0] ?? Date.now();
        const waitMs = Math.max(500, oldest + 3_600_000 - Date.now() + 100);
        await sleep(waitMs);
      }
    }

    // ---- space it out --------------------------------------------------
    const s = engines[engine];
    const since = Date.now() - s.lastStartedAt;
    if (s.lastStartedAt && since < p.minGapMs) await sleep(p.minGapMs - since);

    const startedAt = Date.now();
    s.lastStartedAt = startedAt;
    s.recent.push(startedAt);
    const queuedMs = startedAt - arrived;

    try {
      const value = await fn();
      const ms = Date.now() - startedAt;
      s.ok++;
      s.totalMs += ms;
      observe(l, ms);
      return { value, queuedMs, ahead };
    } catch (err) {
      // A failure still says how long the lane is busy for, and a failure that
      // took 90 seconds should not leave the estimate thinking calls take 13.
      const ms = Date.now() - startedAt;
      s.failed++;
      observe(l, ms);
      throw err;
    }
  } finally {
    l.inflight--;
    l.waiting.shift()?.();
  }
}

/** Seed on the first real measurement rather than trusting the constant above. */
function observe(l: LaneState, ms: number): void {
  l.emaMs = l.samples === 0 ? ms : Math.round(l.emaMs * 0.7 + ms * 0.3);
  l.samples++;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** What /api/queue serves, and what rides along on a 429. */
export function snapshot(engine?: Engine): Record<string, unknown> {
  const laneView = (lane: Lane) => ({
    running: lanes[lane].inflight,
    waiting: lanes[lane].waiting.length,
    concurrency: laneConcurrency(lane),
    averageMs: Math.round(lanes[lane].emaMs),
    samples: lanes[lane].samples,
  });
  const engineView = (e: Engine) => {
    const s = engines[e];
    const p = policy(e);
    return {
      lane: laneOf(e),
      minGapMs: p.minGapMs,
      maxQueue: p.maxDepth,
      maxWaitMs: p.maxWaitMs,
      hourlyLimit: p.hourlyLimit || null,
      neverReject: p.neverReject,
      usedThisHour: recentHits(e).length,
      answered: s.ok,
      failed: s.failed,
      refused: s.refused,
      averageMs: s.ok ? Math.round(s.totalMs / s.ok) : null,
      estimatedWaitMs: estimateWaitMs(laneOf(e), e),
    };
  };
  if (engine) return { engine, ...engineView(engine), lanes: { [laneOf(engine)]: laneView(laneOf(engine)) } };
  return {
    lanes: { pi: laneView('pi') },
    engines: { pi: engineView('pi') },
  };
}

/** Reset in-memory queue and engine state for deterministic test suites. */
export function resetForTests(): void {
  for (const lane of ['pi'] as Lane[]) {
    lanes[lane].inflight = 0;
    lanes[lane].waiting = [];
    lanes[lane].samples = 0;
    lanes[lane].emaMs = 20000;
  }
  for (const eng of ['pi'] as Engine[]) {
    engines[eng] = fresh();
  }
}

