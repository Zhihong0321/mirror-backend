import * as db from '../../reportdb.ts';
import { writeLane } from '../lib.ts';
import { restoreLane, runLane, stageDive, type LaneResult } from '../runner.ts';
import { loadV21Dive } from './adapter.ts';
import { buildReport } from '../report-html.ts';
import { speedLane } from './speed.ts';
import * as store from './store.ts';

// Each lane starts as soon as the lanes it reads have finished (done, partial or failed), not when a whole stage has.
// On 2026-11-11 fixed stages held contacts, assets and brand (2 minutes of work) 44 minutes behind the ChatGPT questions,
// which none of them read. The third item is what the lane reads; a lane must come after everything it reads.
// H-web and C-merged read H-maps (its trade and town plan, its listings); G-recommend reuses G-search's company profile.
export const V21_DEEPER_LANES = [
  ['H', 'maps', []],
  ['G', 'search', []],
  ['K', 'credibility', []],
  ['N', 'news', []],
  ['D', 'registry', []],
  ['H', 'web', ['H-maps']],
  ['C', 'merged', ['H-maps']],
  ['G', 'recommend', ['G-search']],
  ['R', 'contacts', ['C-merged', 'H-maps']],
  ['A', 'assets', ['C-merged']],
  ['B', 'brand', ['C-merged', 'G-search', 'H-web']],
] as const;
// S1-recheck looks again at what the judging lanes found, before anything is written about it; S6-check looks again at what was written.
export const V21_DEEPER_WRITING = [['S1', 'recheck'], ['S2', 'consult'], ['S3', 'editor'], ['S4', 'analysis'], ['S5', 'plan'], ['S6', 'check']] as const;
export const waiting: string[] = [];
export let active: string | null = null;
const waits = [60_000, 180_000];
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// The same run can be exercised with in-memory storage and lanes, without a hub or workers.
const live = { store, loadV21Dive, stageDive, restoreLane, writeLane, runLane, buildReport, sleep };
export type Runtime = Omit<typeof live, 'store'> & {
  store: Pick<typeof store, 'getRun' | 'laneRows' | 'update' | 'saveLane' | 'lastPlan'>;
};

export async function executeRun(id: string, runtime: Runtime = live): Promise<void> {
  const { store, loadV21Dive, stageDive, restoreLane, writeLane, runLane, sleep } = runtime;
  const row = await store.getRun(id);
  // A run cancelled while it waited in the queue is not run.
  if (!row || !['queued', 'running'].includes(row.status)) return;
  const log = row.log ?? [];
  let logging = Promise.resolve();
  const say = (stage: string, msg: string, extra: Parameters<typeof store.update>[1] = {}) => {
    // Parallel lanes must not overwrite a newer log with an earlier database update.
    const saved = logging.then(async () => {
      log.push({ at: new Date().toISOString(), stage, msg });
      await store.update(id, { stage, log, ...extra });
    });
    logging = saved.catch(() => {});
    return saved;
  };
  try {
    const { dive, rows } = await loadV21Dive(row.report_id);
    const key = `v21-${row.report_id}`;
    stageDive(key, dive);
    const saved = await store.laneRows(id);
    const kept = new Map<string, LaneResult>();
    // H-maps keeps its plan in notes. Restore it even when that attempt failed, so a
    // fresh container keeps the same trades and towns as the interrupted attempt.
    let plan: unknown = null;
    for (const lane of saved) {
      if (lane.lane === 'H-maps' && lane.payload.notes?.plan) plan = lane.payload.notes.plan;
      if (lane.status !== 'failed') kept.set(lane.lane, lane.payload);
    }
    // A new run of the same report searches the same trades and towns as its last run, so its Maps ranks can be
    // compared with that run's. The lane files live in the container's temp folder and are gone after a deploy.
    let planFrom = plan ? 'this run' : '';
    if (!plan) {
      plan = await store.lastPlan(row.report_id);
      if (plan) planFrom = 'the last run of this report';
    }
    if (plan) writeLane(key, 'H-plan', plan, 2);
    for (const result of kept.values()) restoreLane(result);
    await say('running', `V2.1 rows: ${JSON.stringify(rows)}; ${kept.size} saved lanes restored; Maps plan ${planFrom ? 'from ' + planFrom : 'picked new'}`, { status: 'running', company_uid: dive.v21.company_uid as string | null, error: null, finished_at: null, report_html: null });
    if (!kept.has('W-speed')) {
      const speed = speedLane(key, dive);
      await store.saveLane(row, speed);
      restoreLane(speed);
      kept.set('W-speed', speed);
    }
    for (const warning of kept.get('W-speed')!.warnings) await say('W-speed', warning);
    for (const warning of dive.v21.warnings ?? []) await say('adapter', warning);
    const failures: string[] = [];
    const one = async (section: string, lane: string) => {
      const name = `${section}-${lane}`;
      if (kept.has(name)) return;
      for (let attempt = 1; attempt <= 3; attempt++) {
        // No lane time limit (owner's wait rule): a slow LLM answer is waited for, never cut and restarted. A call that
        // will never answer still fails by itself in the LLM router's idle check. 2^31-1 ms is setTimeout's maximum.
        const result = await runLane(section, lane, key, dive, 2_147_483_647, { worker: 'myworker' });
        // Every try is immutable and durable before this lane's next try can start.
        await store.saveLane(row, result);
        await say(name, `${name} try ${attempt}: ${result.status}${result.failure ? ': ' + result.failure : ''}`);
        if (result.status !== 'failed') { kept.set(name, result); break; }
        if (attempt === 3) failures.push(`${name}: ${result.failure ?? 'failed'}`);
        else await sleep(waits[attempt - 1]);
      }
    };
    const finished = new Map<string, Promise<void>>();
    for (const [section, lane, after] of V21_DEEPER_LANES) {
      finished.set(`${section}-${lane}`, Promise.all(after.map((name) => finished.get(name))).then(() => one(section, lane)));
    }
    await Promise.all(finished.values());
    // A lane that failed all its tries never stops the report (owner's rule): the writing stages still run on what the
    // other lanes found, the report is built, and the run is labelled 'incomplete' with every failure named.
    for (const [section, lane] of V21_DEEPER_WRITING) await one(section, lane);
    const html = runtime.buildReport(dive, Object.fromEntries(kept));
    if (failures.length) {
      await say('incomplete', `Report built without: ${failures.join('; ')}`, {
        status: 'incomplete', error: failures.join('; '), report_html: html, finished_at: new Date().toISOString(),
      });
      return;
    }
    await say('done', 'Report ready: every lane and writing stage finished', {
      status: 'done', error: null, report_html: html, finished_at: new Date().toISOString(),
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    await say('failed', reason, { status: 'failed', error: reason, finished_at: new Date().toISOString() });
  }
}

export function queue(id: string): void {
  if (active === id || waiting.includes(id)) return;
  waiting.push(id);
  pump();
}
function pump(): void {
  if (active || !waiting.length) return;
  const id = waiting.shift()!;
  active = id;
  void executeRun(id).catch((err) => console.error(`[v21-deeper ${id}] could not save run state`, err))
    .finally(() => { active = null; pump(); });
}

/** Boot recovery only resumes queued and running runs; completed attempts stay saved. */
export async function resumeInterrupted(): Promise<void> {
  if (!db.configured()) return;
  for (const row of await store.interrupted()) queue(row.run_id);
}

export async function start(reportId: string): Promise<string> {
  const id = await store.createRun(reportId);
  queue(id);
  return id;
}
