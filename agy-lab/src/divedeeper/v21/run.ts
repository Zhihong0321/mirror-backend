import * as db from '../../reportdb.ts';
import { writeLane } from '../lib.ts';
import { restoreLane, runLane, stageDive, type LaneResult } from '../runner.ts';
import { loadV21Dive } from './adapter.ts';
import * as store from './store.ts';

export const enabled = (env: NodeJS.ProcessEnv = process.env): boolean => env.V21_DEEPER === 'on';
export const V21_DEEPER_LANES = [['H', 'maps']] as const;
export const waiting: string[] = [];
export let active: string | null = null;
const waits = [60_000, 180_000];
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// The same run can be exercised with in-memory storage and lanes, without a hub or workers.
const live = { store, loadV21Dive, stageDive, restoreLane, writeLane, runLane, sleep };
export type Runtime = Omit<typeof live, 'store'> & {
  store: Pick<typeof store, 'getRun' | 'laneRows' | 'update' | 'saveLane' | 'lastPlan'>;
};

export async function executeRun(id: string, runtime: Runtime = live): Promise<void> {
  if (!enabled()) return;
  const { store, loadV21Dive, stageDive, restoreLane, writeLane, runLane, sleep } = runtime;
  const row = await store.getRun(id);
  if (!row) return;
  const log = row.log ?? [];
  const say = async (stage: string, msg: string, extra: Parameters<typeof store.update>[1] = {}) => {
    log.push({ at: new Date().toISOString(), stage, msg });
    await store.update(id, { stage, log, ...extra });
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
    await say('running', `V2.1 rows: ${JSON.stringify(rows)}; ${kept.size} saved lanes restored; Maps plan ${planFrom ? 'from ' + planFrom : 'picked new'}`, { status: 'running', company_uid: dive.v21.company_uid as string | null, error: null, finished_at: null });
    const failures: string[] = [];
    for (const [section, lane] of V21_DEEPER_LANES) {
      const name = `${section}-${lane}`;
      if (kept.has(name)) continue;
      for (let attempt = 1; attempt <= 3; attempt++) {
        const result = await runLane(section, lane, key, dive, undefined, { worker: 'myworker' });
        // Every try is immutable and durable before another try can start.
        await store.saveLane(row, result);
        await say(name, `${name} try ${attempt}: ${result.status}${result.failure ? ': ' + result.failure : ''}`);
        if (result.status !== 'failed') break;
        if (attempt === 3) failures.push(`${name}: ${result.failure ?? 'failed'}`);
        else await sleep(waits[attempt - 1]);
      }
    }
    const status = failures.length ? 'incomplete' : 'done';
    await say(status, failures.length ? failures.join('; ') : 'Every lane finished', {
      status, error: failures.length ? failures.join('; ') : null, finished_at: new Date().toISOString(),
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    await say('failed', reason, { status: 'failed', error: reason, finished_at: new Date().toISOString() });
  }
}

export function queue(id: string): void {
  if (!enabled() || active === id || waiting.includes(id)) return;
  waiting.push(id);
  pump();
}
function pump(): void {
  if (!enabled() || active || !waiting.length) return;
  const id = waiting.shift()!;
  active = id;
  void executeRun(id).catch((err) => console.error(`[v21-deeper ${id}] could not save run state`, err))
    .finally(() => { active = null; pump(); });
}

/** Boot recovery only resumes queued and running runs; completed attempts stay saved. */
export async function resumeInterrupted(): Promise<void> {
  if (!enabled() || !db.configured()) return;
  for (const row of await store.interrupted()) queue(row.run_id);
}

export async function start(reportId: string): Promise<string> {
  if (!enabled()) throw new Error('V21_DEEPER is off');
  const id = await store.createRun(reportId);
  queue(id);
  return id;
}
