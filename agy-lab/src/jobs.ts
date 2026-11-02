// agy-lab: the job broker.
//
// This exists for one reason: the Google Maps scan has to run from a home IP.
// Google silently degrades a datacenter profile — the same search that returns
// ~100 businesses from a residential line returns ~60 from a rented one, with no
// error and no captcha — so a scan run inside this container produces a dataset
// that is thin and looks complete. A Mac mini at home does not have that problem.
//
// DIRECTION. The mini sits behind home NAT with no public address, so this
// service can never connect TO it. The mini connects here and asks for work:
// GET /api/jobs/next holds the request open for up to ~25s and answers the moment
// a job exists. That is the whole reason this is a queue and not an outbound
// webhook — no tunnel, no port forwarding, no dynamic DNS, nothing on the home
// router to keep alive.
//
// Broker jobs live in a Map. Contact research has a database report row before
// dispatch, and worker results are written there even if this Map is lost on a
// deploy. Other job types still need their own durable result path.
//
// LEASES. Other job types may be retried after a lease. Contact research has no
// lease: its report remains pending until a worker posts a result or an actual
// worker failure.
import http from 'node:http';
import * as db from './reportdb.ts';
import crypto from 'node:crypto';
import {saveCountryJob, loadCountryJob, loadCountryJobs} from './country-job-store.ts';

export interface Ctx {
  json: (res: http.ServerResponse, status: number, body: unknown) => void;
  readJson: (req: http.IncomingMessage) => Promise<Record<string, unknown>>;
  /**
   * Set when the caller holds a scoped key rather than LAB_TOKEN (the Gmap Local
   * Worker, gmap-worker.ts): it may claim and answer only these job types.
   */
  scope?: { types: string[] };
}

export type JobStatus = 'pending' | 'running' | 'done' | 'failed';

export interface Job {
  id: string;
  type: string;
  payload: unknown;
  status: JobStatus;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  /** Which worker holds (or held) it. */
  worker: string | null;
  /** How many times it has been handed out. A retry after a lease expiry counts. */
  attempts: number;
  /** Lease length for other jobs; zero means contact work has no duration limit. */
  timeoutMs: number;
  result: unknown;
  error: string | null;
  /** Contact jobs become claimable only after their report stores this id. */
  ready?: boolean;
  /** Country jobs renew their lease only from the worker currently holding them. */
  leaseUpdatedAt?: string | null;
  progress?: { phase: string; completed: number; total: number | null; message: string; updatedAt: string } | null;
}

export interface WorkerInfo {
  name: string;
  lastSeenAt: string;
  /** As seen by Railway's proxy — the home IP the whole design is about. */
  ip: string | null;
  taken: number;
  done: number;
  failed: number;
  /**
   * The job types this worker's last claim asked for. Recorded so the gateway can
   * tell whether anything capable of a type is actually online BEFORE routing to
   * it — without this a call for an engine no live worker serves becomes a job
   * that sits pending until it times out, which reads to the caller as the engine
   * being slow rather than absent.
   */
  types: string[] | null;
  /** Lanes using the same account share one quota cooldown. */
  cooldownGroup: string | null;
  cooldownUntil: string | null;
  cooldownReason: string | null;
  cooldownRemainingMs?: number;
  status?: 'online' | 'offline' | 'cooldown';
}

/** Long enough for a Maps search with its scroll plateau, short enough to notice a dead worker. */
const DEFAULT_TIMEOUT_MS = 300_000;
const MAX_TIMEOUT_MS = 1_800_000;
/** Past this a job is poison, not unlucky: it has killed three workers. */
const MAX_ATTEMPTS = 3;
/** Ring size. Finished jobs are evicted oldest-first; pending and running are never evicted. */
const MAX_JOBS = 500;
/**
 * Long-poll ceiling. Railway's proxy and most clients tolerate a 30s idle
 * response; 25s leaves room to answer before anything in between decides the
 * request is stuck.
 */
const MAX_WAIT_MS = 25_000;

const jobs = new Map<string, Job>();
for (const restored of loadCountryJobs()) jobs.set(restored.id, restored);
const workers = new Map<string, WorkerInfo>();
const cooldowns = new Map<string, { until: number; reason: string }>();

interface Waiter {
  worker: string;
  types: string[] | null;
  settle: (job: Job | null) => void;
  timer: ReturnType<typeof setTimeout>;
}
const waiters: Waiter[] = [];

/** Callers blocked in `wait()`, keyed by job id. */
const finishWaiters = new Map<string, Set<(job: Job) => void>>();

/**
 * Announce a job reaching a terminal state. Must be called from EVERY place a
 * job becomes done or failed — `finish()` for a real result, `sweep()` for a
 * lease that expired past its attempts. A terminal transition that skips this
 * leaves `wait()` hanging until its own timeout, which looks exactly like a slow
 * worker and is why the timeout is not a substitute for calling it.
 */
function settleFinished(job: Job): void {
  const set = finishWaiters.get(job.id);
  if (!set) return;
  finishWaiters.delete(job.id);
  for (const resolve of set) resolve(job);
}

const now = (): string => new Date().toISOString();
const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback);
const num = (v: unknown, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);

/**
 * The caller's address as Railway sees it. x-forwarded-for is spoofable, which
 * matters nowhere here: it is displayed so a person can confirm the worker is
 * where they think it is, never trusted for a decision.
 */
function callerIp(req: http.IncomingMessage): string | null {
  const fwd = req.headers['x-forwarded-for'];
  const raw = Array.isArray(fwd) ? fwd[0] : fwd;
  if (raw) return raw.split(',')[0]!.trim();
  return req.socket.remoteAddress ?? null;
}

function cooldownFor(group: string | null): { until: number; reason: string } | null {
  if (!group) return null;
  const cooldown = cooldowns.get(group);
  if (!cooldown) return null;
  if (cooldown.until > Date.now()) return cooldown;
  cooldowns.delete(group);
  return null;
}

export function isDurableContactJob(type: string): boolean {
  return type === 'research.contact' || type === 'research.contact.cloud' || type === 'research.contact.pi';
}

/**
 * Job types a machine has been retired from, keyed by worker-name prefix so every
 * lane of that machine is covered. Its offer of the type is dropped at the
 * door, it is never handed one, and it does not count toward liveTypes().
 *
 * The mini's country lane is retired since 2026-10-30: the hub runs
 * country.industry itself (country-research.ts) and sends its Maps searches to
 * the queue, where the mini can still answer them (countryScanOnly below).
 */
const RETIRED_TYPES: Array<{ prefix: string; types: string[] }> = [
  { prefix: 'm4-mini', types: ['country.industry'] },
];

export function isRetired(worker: string, type: string): boolean {
  return RETIRED_TYPES.some((r) => worker.startsWith(r.prefix) && r.types.includes(type));
}

/**
 * The mini's Chrome Maps scan found 118 businesses in Taman Daya where the
 * scraper.tech sweep found 1,838, so it gets no business search or taman scan.
 * It answers only the per-city searches of country research and the searches
 * of a search list, whose jobs carry `source: 'country.industry'` or
 * `source: 'search.list'`.
 */
const MINI_SOURCES = new Set(['country.industry', 'search.list']);
function countryScanOnly(worker: string, job: Job): boolean {
  return worker.startsWith('m4-mini') && job.type === 'gmap.scan'
    && !MINI_SOURCES.has(String((job.payload as { source?: unknown } | null)?.source ?? ''));
}

/**
 * Keep an in-hub country job's lease alive and, with `progress`, record where
 * it is. The progress route below does the same for a remote worker's post.
 */
export function renewCountryJob(id: string, worker: string, progress?: { phase: string; completed: number; total: number | null; message: string }): boolean {
  const job = jobs.get(id);
  if (!job || job.type !== 'country.industry' || job.status !== 'running' || job.worker !== worker) return false;
  const updated = { ...job, leaseUpdatedAt: now(), ...(progress ? { progress: { ...progress, updatedAt: now() } } : {}) };
  saveCountryJob(updated);
  Object.assign(job, updated);
  return true;
}

export function touch(name: string, ip: string | null, types?: string[] | null, group?: string | null): WorkerInfo {
  const existing = workers.get(name);
  const info: WorkerInfo =
    existing ?? { name, lastSeenAt: now(), ip, taken: 0, done: 0, failed: 0, types: null,
      cooldownGroup: null, cooldownUntil: null, cooldownReason: null };
  info.lastSeenAt = now();
  if (ip) info.ip = ip;
  // Only a claim declares types. A result POST also touches, and must not erase
  // what the claim recorded — an empty list there would read as "serves nothing".
  if (types && types.length) info.types = types;
  if (group) info.cooldownGroup = group;
  const cooldown = cooldownFor(info.cooldownGroup);
  info.cooldownUntil = cooldown ? new Date(cooldown.until).toISOString() : null;
  info.cooldownReason = cooldown?.reason ?? null;
  workers.set(name, info);
  return info;
}

/**
 * Workers seen within `withinMs`, i.e. the ones a route may still count on. A
 * worker that stopped polling is not "slow", it is gone; the gateway needs that
 * distinction to refuse rather than enqueue.
 */
export function liveWorkers(withinMs = 90_000): WorkerInfo[] {
  const at = Date.now();
  return [...workers.values()].filter((w) => at - Date.parse(w.lastSeenAt) <= withinMs && !cooldownFor(w.cooldownGroup));
}

/** Every job type at least one live worker is currently claiming. */
export function liveTypes(withinMs = 90_000): string[] {
  const out = new Set<string>();
  for (const w of liveWorkers(withinMs)) for (const t of w.types ?? []) out.add(t);
  return [...out];
}

/**
 * Expire leases and evict old finished jobs. Called on every read and every
 * hand-out rather than from an interval: a timer in a container that Railway may
 * pause is one more thing that can be quietly not running, and the sweep is O(n)
 * over at most MAX_JOBS entries.
 */
function sweep(): void {
  const at = Date.now();
  for (const job of jobs.values()) {
    if (job.status !== 'running' || !job.startedAt) continue;
    // Contact reports own their lifecycle in Postgres. Time passing cannot
    // declare their worker dead or invalidate a result that may still arrive.
    if (isDurableContactJob(job.type)) continue;
    // The field is what the hub shows and what this comparison uses. Raise it to
    // the payload budget before deciding, or a 20-minute run stored with the
    // 5-minute default is taken back while the worker is still heartbeating.
    const holdMs = leaseMs(job.type, job.payload, job.timeoutMs);
    if (holdMs > job.timeoutMs) job.timeoutMs = holdMs;
    const leaseStart = job.type === 'country.industry' && job.leaseUpdatedAt ? job.leaseUpdatedAt : job.startedAt;
    if (at - Date.parse(leaseStart) <= job.timeoutMs) continue;
    if (job.attempts >= MAX_ATTEMPTS) {
      const failed = { ...job, status: 'failed' as const, finishedAt: now(), error: 'lease expired ' + job.attempts + 'x without a result (last worker: ' + (job.worker ?? 'unknown') + ')' };
      saveCountryJob(failed);
      Object.assign(job, failed);
      settleFinished(job);
      continue;
    }
    const requeued = { ...job, status: 'pending' as const, startedAt: null, worker: null };
    saveCountryJob(requeued);
    Object.assign(job, requeued);
  }

  if (jobs.size <= MAX_JOBS) return;
  // Insertion order is creation order, so the first finished job found is the
  // oldest one. Pending and running are skipped: dropping work that has not run
  // is the one loss this cache must never cause.
  for (const [id, job] of jobs) {
    if (jobs.size <= MAX_JOBS) break;
    if (job.status === 'done' || job.status === 'failed') jobs.delete(id);
  }
}

/**
 * The one worker a job may go to, when its payload names one. Lets a person
 * test a particular machine without another lane claiming the job first.
 */
function pinnedTo(job: Job): string | null {
  const worker = (job.payload as { worker?: unknown } | null)?.worker;
  return typeof worker === 'string' && worker.trim() ? worker.trim() : null;
}

function pending(types: string[] | null, worker: string): Job | null {
  for (const job of jobs.values()) {
    if (job.status !== 'pending') continue;
    if (job.ready === false) continue;
    if (types && !types.includes(job.type)) continue;
    const pin = pinnedTo(job);
    if (pin && pin !== worker) continue;
    if (countryScanOnly(worker, job)) continue;
    return job;
  }
  return null;
}

function lease(job: Job, worker: string): Job {
  const startedAt = now();
  const leased = { ...job, status: 'running' as const, startedAt, worker, attempts: job.attempts + 1,
    ...(job.type === 'country.industry' ? { leaseUpdatedAt: startedAt } : {}) };
  saveCountryJob(leased);
  Object.assign(job, leased);
  const info = workers.get(worker);
  if (info) info.taken += 1;
  return job;
}

/** Hand a freshly created job straight to a waiting worker, if one matches. */
function wake(job: Job): void {
  const pin = pinnedTo(job);
  const i = waiters.findIndex((w) => !cooldownFor(workers.get(w.worker)?.cooldownGroup ?? null)
    && (!w.types || w.types.includes(job.type)) && (!pin || pin === w.worker) && !countryScanOnly(w.worker, job));
  if (i === -1) return;
  const w = waiters.splice(i, 1)[0]!;
  clearTimeout(w.timer);
  w.settle(lease(job, w.worker));
}

// ------------------------------------------------------------------- the API

/**
 * How long the broker will let this job stay with one worker before taking it back.
 *
 * Asks keep the lease the caller passed. Contact research has no lease.
 */
function leaseMs(type: string, payload: unknown, timeoutMs: number): number {
  if (isDurableContactJob(type)) return 0;
  return Math.min(Math.max(1_000, timeoutMs), MAX_TIMEOUT_MS);
}

export function create(type: string, payload: unknown, timeoutMs = DEFAULT_TIMEOUT_MS, ready = true): Job {
  sweep();
  const job: Job = {
    id: crypto.randomBytes(6).toString('hex'),
    type,
    payload: payload ?? null,
    status: 'pending',
    createdAt: now(),
    startedAt: null,
    finishedAt: null,
    worker: null,
    attempts: 0,
    timeoutMs: leaseMs(type, payload, timeoutMs),
    result: null,
    error: null,
    ready,
  };
  saveCountryJob(job);
  jobs.set(job.id, job);
  // `reportId` rides the payload when the caller has one. Fire-and-forget: the
  // broker is synchronous and a trail write must never be able to delay or fail
  // a job handout.
  void db.logEvent({
    reportId: (payload as { reportId?: string })?.reportId ?? null,
    jobId: job.id, stage: type, event: 'job.created',
    detail: { type, timeout_ms: job.timeoutMs },
  });
  if (ready) wake(job);
  return job;
}

export function activate(id: string): Job | null {
  const job = jobs.get(id);
  if (!job || job.status !== 'pending') return job ?? null;
  job.ready = true;
  wake(job);
  return job;
}

/**
 * Claim one job, waiting up to `waitMs` for one to appear.
 *
 * `signal` is the request being aborted — a worker that hung up must not keep a
 * slot in the waiter list, because the next job created would be handed to a
 * socket nobody is reading and would only come back after its lease expired.
 */
export function take(
  worker: string,
  opts: { waitMs?: number; types?: string[] | null; signal?: AbortSignal } = {},
): Promise<Job | null> {
  sweep();
  if (cooldownFor(workers.get(worker)?.cooldownGroup ?? null)) return Promise.resolve(null);
  const types = opts.types && opts.types.length ? opts.types : null;
  const ready = pending(types, worker);
  if (ready) return Promise.resolve(lease(ready, worker));

  const waitMs = Math.min(Math.max(0, opts.waitMs ?? MAX_WAIT_MS), MAX_WAIT_MS);
  if (!waitMs) return Promise.resolve(null);

  return new Promise<Job | null>((resolve) => {
    let settled = false;
    const done = (job: Job | null): void => {
      if (settled) return;
      settled = true;
      opts.signal?.removeEventListener('abort', onAbort);
      resolve(job);
    };
    const w: Waiter = {
      worker,
      types,
      settle: done,
      timer: setTimeout(() => {
        const i = waiters.indexOf(w);
        if (i !== -1) waiters.splice(i, 1);
        done(null);
      }, waitMs),
    };
    function onAbort(): void {
      const i = waiters.indexOf(w);
      if (i !== -1) waiters.splice(i, 1);
      clearTimeout(w.timer);
      done(null);
    }
    opts.signal?.addEventListener('abort', onAbort, { once: true });
    waiters.push(w);
  });
}

/** Put the account behind this lane on cooldown and release its active long polls. */
export function coolDown(worker: string, retryAfterMs: number, reason: string): string | null {
  const info = workers.get(worker);
  if (!info || !Number.isFinite(retryAfterMs) || retryAfterMs <= 0) return null;
  const group = info.cooldownGroup ?? worker;
  info.cooldownGroup = group;
  const until = Math.max(cooldowns.get(group)?.until ?? 0, Date.now() + Math.min(retryAfterMs, 7 * 86_400_000));
  cooldowns.set(group, { until, reason: reason.slice(0, 500) });
  for (const lane of workers.values()) {
    if ((lane.cooldownGroup ?? lane.name) !== group) continue;
    lane.cooldownUntil = new Date(until).toISOString();
    lane.cooldownReason = reason.slice(0, 500);
  }
  for (let i = waiters.length - 1; i >= 0; i--) {
    if ((workers.get(waiters[i]!.worker)?.cooldownGroup ?? waiters[i]!.worker) !== group) continue;
    const w = waiters.splice(i, 1)[0]!;
    clearTimeout(w.timer);
    w.settle(null);
  }
  return new Date(until).toISOString();
}

/** Accept quota errors from older workers that still post only a stack string. */
export function quotaRetryAfterMs(error: string): number | null {
  if (!/individual quota reached/i.test(error)) return null;
  const reset = /resets?\s+in\s+([^\r\n.]+)/i.exec(error)?.[1] ?? '';
  let ms = 0;
  for (const part of reset.matchAll(/(\d+)\s*([dhms])/gi)) {
    ms += Number(part[1]) * { d: 86_400_000, h: 3_600_000, m: 60_000, s: 1_000 }[part[2]!.toLowerCase() as 'd' | 'h' | 'm' | 's'];
  }
  return Math.min(Math.max(ms || 3_600_000, 60_000) + 5_000, 7 * 86_400_000);
}

export function finish(id: string, ok: boolean, result: unknown, error: string | null): Job | null {
  const job = jobs.get(id);
  if (!job) return null;
  // A result for a job whose lease already expired is still accepted: the work
  // genuinely happened, and refusing it would mean re-running a scan that has
  // already spent its Google budget. It may arrive after a retry was handed out;
  // last writer wins, and `attempts` is what records that it happened twice.
  const finished = { ...job, status: (ok ? 'done' : 'failed') as JobStatus, finishedAt: now(),
    result: ok ? (result ?? null) : null, error: ok ? null : (error ?? 'worker reported failure with no message') };
  saveCountryJob(finished);
  Object.assign(job, finished);
  const info = job.worker ? workers.get(job.worker) : undefined;
  if (info) {
    if (ok) info.done += 1;
    else info.failed += 1;
  }
  void db.logEvent({
    reportId: (job.payload as { reportId?: string })?.reportId ?? null,
    jobId: job.id, stage: job.type, event: ok ? 'job.done' : 'job.failed',
    detail: {
      type: job.type, worker: job.worker, attempts: job.attempts,
      ms: job.startedAt ? Date.parse(job.finishedAt!) - Date.parse(job.startedAt) : null,
      ...(ok ? {} : { error: String(job.error ?? '').slice(0, 2_000) }),
    },
  });
  settleFinished(job);
  return job;
}

/** Close a job that could not be linked to its report before dispatch. */
export function cancel(id: string, reason: string): Job | null {
  const job = jobs.get(id);
  if (!job) return null;
  if (job.status === 'done' || job.status === 'failed') return job;
  const cancelled = { ...job, status: 'failed' as const, finishedAt: now(), error: reason };
  saveCountryJob(cancelled);
  Object.assign(job, cancelled);
  void db.logEvent({
    reportId: (job.payload as { reportId?: string })?.reportId ?? null,
    jobId: job.id, stage: job.type, event: 'job.cancelled',
    detail: { type: job.type, worker: job.worker, attempts: job.attempts, reason },
  });
  settleFinished(job);
  return job;
}

/**
 * Resolve when a job reaches a terminal state, or when `timeoutMs` runs out.
 *
 * This is what lets a request await its own job instead of the caller polling.
 * Resolving with the job STILL RUNNING on timeout is deliberate: the work is not
 * cancelled, the result will land, and the caller gets an id it can read later —
 * so a slow answer degrades to "come back for it" rather than being thrown away.
 * `null` means no such job at all.
 */
export function wait(id: string, timeoutMs: number): Promise<Job | null> {
  const job = get(id);
  if (!job) return Promise.resolve(null);
  if (job.status === 'done' || job.status === 'failed') return Promise.resolve(job);

  return new Promise<Job | null>((resolve) => {
    const done = (j: Job | null): void => {
      if (timer) clearTimeout(timer);
      finishWaiters.get(id)?.delete(settle);
      resolve(j);
    };
    const settle = (j: Job): void => done(j);
    const timer = timeoutMs > 0 ? setTimeout(() => done(get(id)), Math.max(1_000, timeoutMs)) : null;
    const set = finishWaiters.get(id) ?? new Set();
    set.add(settle);
    finishWaiters.set(id, set);
  });
}

export function get(id: string): Job | null {
  sweep();
  const existing = jobs.get(id);
  if (existing) return existing;
  const restored = /^[a-f0-9]{12}$/.test(id) ? loadCountryJob(id) : null;
  if (restored) jobs.set(id, restored);
  return restored;
}

export function snapshot(): {
  counts: Record<JobStatus, number>;
  waiting: number;
  jobs: Job[];
  workers: WorkerInfo[];
} {
  sweep();
  const counts: Record<JobStatus, number> = { pending: 0, running: 0, done: 0, failed: 0 };
  for (const job of jobs.values()) counts[job.status] += 1;
  return {
    counts,
    waiting: waiters.length,
    jobs: [...jobs.values()].reverse().map((job) => {
      if (job.type !== 'country.industry' || !job.result || typeof job.result !== 'object') return job;
      // A nationwide CSV can be large; it is available from GET /api/jobs/:id,
      // not copied into every worker-dashboard poll of GET /api/jobs.
      const {csv: _csv, ...metadata} = job.result as Record<string, unknown>;
      return {...job, result: {...metadata, csvAvailable: typeof _csv === 'string'}};
    }),
    workers: [...workers.values()].map((w) => {
      const cooldown = cooldownFor(w.cooldownGroup);
      return { ...w,
        cooldownUntil: cooldown ? new Date(cooldown.until).toISOString() : null,
        cooldownReason: cooldown?.reason ?? null,
        cooldownRemainingMs: cooldown ? Math.max(0, cooldown.until - Date.now()) : 0,
        status: Date.now() - Date.parse(w.lastSeenAt) > 90_000 ? 'offline' : cooldown ? 'cooldown' : 'online',
      };
    }).sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt)),
  };
}

// ----------------------------------------------------------------- the routes

/** Returns true when it handled the request. */
export async function handle(req: http.IncomingMessage, res: http.ServerResponse, url: URL, ctx: Ctx): Promise<boolean> {
  const p = url.pathname;
  const method = req.method ?? 'GET';
  const { json, readJson } = ctx;

  // Claim work. Checked before the collection routes so /api/jobs/next is never
  // read as a job id.
  if (method === 'GET' && p === '/api/jobs/next') {
    const q = url.searchParams;
    const worker = (q.get('worker') ?? '').trim();
    if (!worker) {
      json(res, 400, { error: 'worker is required — name the machine asking, it is what /api/jobs reports' });
      return true;
    }
    const offeredTypes = (q.get('types') ?? '').split(',').map((t) => t.trim()).filter(Boolean);
    // Older workers still impose a Pi deadline and can discard completed
    // research. They may report work already claimed, but cannot claim more.
    const types = (q.get('contactProtocol') === 'durable-v1'
      ? offeredTypes : offeredTypes.filter((type) => !isDurableContactJob(type)))
      .filter((type) => !isRetired(worker, type))
      .filter((type) => !ctx.scope || ctx.scope.types.includes(type));
    touch(worker, callerIp(req), types, (q.get('cooldownGroup') ?? '').trim());
    const waitSec = Number(q.get('wait'));
    const controller = new AbortController();
    // The socket closing IS the cancellation. Without this a worker restarted
    // mid-poll leaves a waiter that will be handed the next job and drop it.
    res.on('close', () => controller.abort());
    const job = await take(worker, {
      waitMs: Number.isFinite(waitSec) ? waitSec * 1000 : MAX_WAIT_MS,
      types: types.length ? types : ['__no_supported_job_types__'],
      signal: controller.signal,
    });
    if (res.writableEnded) return true;
    // 204, not 200 with a null: "nothing right now" is the ordinary answer here,
    // and a worker loop should be able to branch on the status alone.
    if (!job) {
      const cooldown = cooldownFor(workers.get(worker)?.cooldownGroup ?? null);
      // Older workers ignore the cooldown header and repoll immediately. Hold
      // their 204 for the normal long-poll window instead of spinning on it.
      if (cooldown) {
        const pause = Math.min(MAX_WAIT_MS, Math.max(0, Number.isFinite(waitSec) ? waitSec * 1000 : MAX_WAIT_MS), cooldown.until - Date.now());
        if (pause > 0 && !controller.signal.aborted) await new Promise<void>((resolve) => {
          const timer = setTimeout(done, pause);
          function done(): void { clearTimeout(timer); controller.signal.removeEventListener('abort', done); resolve(); }
          controller.signal.addEventListener('abort', done, { once: true });
        });
      }
      if (res.writableEnded) return true;
      res.writeHead(204, { 'cache-control': 'no-store',
        ...(cooldown ? { 'x-worker-cooldown-until': new Date(cooldown.until).toISOString() } : {}) });
      res.end();
      return true;
    }
    if (isDurableContactJob(job.type)) {
      const reportId = str((job.payload as { reportId?: unknown } | null)?.reportId);
      if (reportId) {
        try {
          if (!await db.markContactClaimed(reportId, job.id)) {
            job.status = 'failed';
            job.finishedAt = now();
            job.error = 'contact report was closed before this job could be claimed';
            settleFinished(job);
            res.writeHead(204, { 'cache-control': 'no-store' });
            res.end();
            return true;
          }
        } catch (error) {
          job.status = 'pending';
          job.startedAt = null;
          job.worker = null;
          throw error;
        }
      }
    }
    json(res, 200, { job });
    return true;
  }

  // Keep a BUSY worker visible.
  //
  // A lane only touches the registry when it claims or when it reports, and it
  // does neither while a job is in its hands. A round of deep research
  // runs two to four minutes — well past the 90s liveWorkers() waits before it
  // calls a worker gone — so a lane doing exactly what it was told to do ages out
  // of the table, and the gateway then refuses new work for engines this machine
  // is demonstrably serving. That refusal is instant and total: every round of a
  // second research run fails in milliseconds with "no worker is claiming …".
  if (method === 'POST' && p === '/api/jobs/heartbeat') {
    const body = await readJson(req);
    const worker = str(body.worker).trim();
    if (!worker) {
      json(res, 400, { error: 'worker is required — name the machine checking in' });
      return true;
    }
    // Types ride along on every beat because a redeploy empties this table: a
    // beat that re-registered the name alone would read as "here, serving
    // nothing", which the gateway treats the same as absent.
    const offeredTypes = Array.isArray(body.types) ? body.types.map((t) => str(t).trim()).filter(Boolean) : [];
    const types = (body.contactProtocol === 'durable-v1'
      ? offeredTypes : offeredTypes.filter((type) => !isDurableContactJob(type)))
      .filter((type) => !isRetired(worker, type))
      .filter((type) => !ctx.scope || ctx.scope.types.includes(type));
    const group = str(body.cooldownGroup).trim();
    touch(worker, callerIp(req), types, group);
    sweep();
    const activeJobId = str(body.jobId);
    const activeJob = activeJobId ? jobs.get(activeJobId) : null;
    if (activeJob?.type === 'country.industry' && activeJob.status === 'running' && activeJob.worker === worker) { const renewed = {...activeJob, leaseUpdatedAt: now()}; saveCountryJob(renewed); Object.assign(activeJob, renewed); }
    // A cooling worker keeps beating. Restore its deadline after a broker
    // restart without extending it by another full retry interval on each beat.
    const until = Date.parse(str(body.cooldownUntil));
    if (Number.isFinite(until) && until > Date.now()) {
      coolDown(worker, until - Date.now(), str(body.cooldownReason) || 'Individual quota reached');
    }
    json(res, 200, { worker: touch(worker, callerIp(req), types, group) });
    return true;
  }

  // Import already completed research without putting it on a worker queue.
  if (method === 'POST' && p === '/api/jobs/import-country') {
    const body = await readJson(req);
    const country = str(body.country).trim(), industry = str(body.industry).trim();
    const csv = str(body.csv), filename = str(body.filename).trim();
    const summary = body.summary;
    if (!country || country.length > 120 || !industry || industry.length > 160 || !csv || !filename || !summary || typeof summary !== 'object' || Array.isArray(summary)) {
      json(res, 400, {error: 'country, industry, filename, CSV and summary are required'});
      return true;
    }
    const job = create('country.industry', {country, industry, imported: true}, DEFAULT_TIMEOUT_MS, false);
    finish(job.id, true, {country, industry, filename, contentType: 'text/csv; charset=utf-8', csv, summary, imported: true}, null);
    json(res, 201, {job: {...job, result: {imported: true, csvAvailable: true}}});
    return true;
  }

  if (method === 'POST' && p === '/api/jobs') {
    const body = await readJson(req);
    const type = str(body.type).trim();
    if (!type) {
      json(res, 400, { error: 'type is required' });
      return true;
    }
    const job = create(type, body.payload ?? null, num(body.timeoutMs, DEFAULT_TIMEOUT_MS));
    json(res, 201, { job });
    return true;
  }

  if (method === 'GET' && p === '/api/jobs') {
    json(res, 200, snapshot());
    return true;
  }

  const progress = /^\/api\/jobs\/([a-f0-9]{12})\/progress$/.exec(p);
  if (method === 'POST' && progress) {
    const body = await readJson(req);
    sweep();
    const job = jobs.get(progress[1]!);
    const worker = str(body.worker).trim();
    if (!job || job.type !== 'country.industry') { json(res, 404, { error: 'no such country industry job' }); return true; }
    if (job.status !== 'running' || !worker || job.worker !== worker) { json(res, 409, { error: 'job is not held by this worker' }); return true; }
    const data = body.progress && typeof body.progress === 'object' ? body.progress as Record<string, unknown> : {};
    const total = num(data.total, 0);
    const updated = { ...job, progress: { phase: str(data.phase).slice(0, 40), completed: Math.max(0, Math.floor(num(data.completed, 0))), total: total > 0 ? Math.floor(total) : null, message: str(data.message).slice(0, 300), updatedAt: now() }, leaseUpdatedAt: now() };
    saveCountryJob(updated);
    Object.assign(job, updated);
    json(res, 200, { progress: job.progress });
    return true;
  }

  const result = /^\/api\/jobs\/([a-f0-9]{12})\/result$/.exec(p);
  if (method === 'POST' && result) {
    const body = await readJson(req);
    const worker = str(body.worker).trim();
    if (worker) touch(worker, callerIp(req));
    const current = get(result[1]!);
    // A scoped key answers only a job of its own types that this worker holds. A
    // job this broker no longer has (a redeploy mid-scan) is a plain 404, and
    // never reaches the contact-report recovery below.
    // A finished scan for a job the broker lost or already settled (a restart
    // mid-scan, or the report's wait ran out) still goes to the report it was for.
    const latePublicId = ctx.scope && body.ok !== false ? str(body.reportPublicId).trim() : '';
    if (latePublicId && (!current || ctx.scope!.types.includes(current.type) && (current.status === 'done' || current.status === 'failed'))) {
      const intel = await import('./intel.ts');
      const late = await intel.acceptLateBusinessScan(latePublicId, result[1]!, worker,
        body.result && typeof body.result === 'object' ? body.result as Record<string, unknown> : {});
      json(res, late.status, late.body);
      return true;
    }
    if (ctx.scope && !current) {
      json(res, 404, { error: 'no such job — it was evicted, or the service restarted while it ran', id: result[1] });
      return true;
    }
    if (ctx.scope && current && (!ctx.scope.types.includes(current.type) || !worker || current.worker !== worker)) {
      json(res, 403, { error: 'this key may only answer a ' + ctx.scope.types.join('/') + ' job its worker holds' });
      return true;
    }
    if (current?.type === 'country.industry' && (current.status !== 'running' || !worker || current.worker !== worker)) {
      json(res, 409, { error: 'country job is not held by this worker' });
      return true;
    }
    let reportId = str(body.reportId || (current?.payload as { reportId?: unknown } | null)?.reportId);
    let savedContact = false;
    if (!reportId && (!current || isDurableContactJob(current.type)))
      reportId = (await db.getContactReportByJobId(result[1]!))?.id ?? '';
    if (reportId && (!current || isDurableContactJob(current.type))) {
      // The report row, not this volatile Map, is the destination. A worker can
      // return after a Railway restart or long after the original request ended.
      const intel = await import('./intel.ts');
      await intel.acceptContactResult(reportId, result[1]!, body.ok !== false,
        body.result ?? null, str(body.error) || null, worker);
      savedContact = true;
      if (!current) {
        json(res, 200, { saved: true, reportId, jobId: result[1] });
        return true;
      }
    }
    const job = finish(result[1]!, body.ok !== false, body.result ?? null, str(body.error) || null);
    const quotaMs = job ? num(body.retryAfterMs, 0) || quotaRetryAfterMs(str(body.error)) : null;
    const cooldownUntil = quotaMs && worker
      ? coolDown(worker, quotaMs, str(body.error).split(/\r?\n/)[0] || 'Individual quota reached') : null;
    if (!job) {
      // Almost always the ring having evicted it, or a redeploy having dropped it.
      // Say which, because "unknown job" reads like a bug in the worker.
      // THIS is the line that ate five minutes of the mini's work at 16:56 on
      // 23 Aug and left no durable trace anywhere: the worker was told its job
      // no longer existed, wrote one line to a text file on a machine at home,
      // and that was the entire record. Now it is a row.
      void db.logEvent({
        jobId: result[1]!, stage: 'broker', event: 'job.evicted',
        detail: {
          worker, reported_ok: body.ok !== false,
          error: str(body.error).slice(0, 1_000) || null,
          note: 'worker returned a result for a job the broker no longer had: ring eviction or a container restart mid-run',
        },
      });
      json(res, 404, { error: 'no such job — it was evicted, or the service restarted while it ran', id: result[1] });
      return true;
    }
    json(res, 200, { job, cooldownUntil, ...(savedContact ? { saved: true, reportId } : {}) });
    return true;
  }

  const one = /^\/api\/jobs\/([a-f0-9]{12})$/.exec(p);
  if (method === 'GET' && one) {
    const job = get(one[1]!);
    if (!job) {
      json(res, 404, { error: 'no such job', id: one[1] });
      return true;
    }
    json(res, 200, { job });
    return true;
  }

  return false;
}
