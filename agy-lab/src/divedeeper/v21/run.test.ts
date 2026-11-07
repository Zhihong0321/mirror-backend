import test from 'node:test';
import assert from 'node:assert/strict';
import { executeRun, type Runtime } from './run.ts';
import { loadV21Dive } from './adapter.ts';
import type { Run, Lane } from './store.ts';
import type { LaneResult } from '../runner.ts';

const plan = { trades: ['solar'], areas: ['Johor'], offices: ['Johor'], picked_at: '2026-01-01' };
function result(status: LaneResult['status']): LaneResult {
  return { section: 'H', lane: 'maps', diveId: 'v21-report', company: 'Acme', status,
    ran_at: '2026-01-01', ms: 1, findings_count: 0, meter: {}, warnings: [], notes: { plan }, findings: [],
    ...(status === 'failed' ? { failure: 'worker offline' } : {}),
  };
}
async function fixture(statuses: LaneResult['status'][], saved: Lane[] = [], earlierPlan: unknown = null) {
  const row: Run = { run_id: 'run', report_id: 'report', company_uid: null, status: 'queued', stage: '', log: [], error: null, created_at: '', updated_at: '', finished_at: null };
  const loaded = await loadV21Dive('report', {
    getReport: async () => ({ company: 'Acme', country: 'Malaysia', industry: 'Solar', company_uid: 'co_acme', step1_status: 'done', step2_status: 'done' }),
    latestRaw: async (_id, kind) => ({ id: 1, payload: kind === 'result' ? { baseline: {} } : {} }),
  });
  const events: string[] = [];
  const attempts: LaneResult[] = [];
  const restored: LaneResult[] = [];
  const files: { id: string; name: string; data: unknown }[] = [];
  const runtime: Runtime = {
    store: {
      getRun: async () => row,
      laneRows: async () => saved,
      update: async (_id, values) => { Object.assign(row, values); },
      saveLane: async (_row, lane) => { attempts.push(lane); events.push('saved'); },
      lastPlan: async (reportId) => { assert.equal(reportId, 'report'); return earlierPlan; },
    },
    loadV21Dive: async () => loaded,
    stageDive: (id) => { assert.equal(id, 'v21-report'); events.push('staged'); },
    restoreLane: (r) => { restored.push(r); },
    writeLane: (id, name, data) => { files.push({ id, name, data }); },
    runLane: async (section, lane, key, _dive, _limit, opts) => {
      assert.deepEqual([section, lane, key, opts], ['H', 'maps', 'v21-report', { worker: 'myworker' }]);
      events.push('ran');
      assert.ok(statuses.length, 'unexpected extra lane attempt');
      return result(statuses.shift()!);
    },
    sleep: async (ms) => { events.push(`wait ${ms}`); },
  };
  return { row, runtime, events, attempts, restored, files };
}
async function switchedOn(work: () => Promise<void>) {
  const before = process.env.V21_DEEPER;
  process.env.V21_DEEPER = 'on';
  try { await work(); } finally {
    if (before === undefined) delete process.env.V21_DEEPER;
    else process.env.V21_DEEPER = before;
  }
}

test('a run saves each failed try before waiting, and partial is a completed lane', async () => switchedOn(async () => {
  const f = await fixture(['failed', 'failed', 'partial']);
  await executeRun('run', f.runtime);
  assert.deepEqual(f.events, ['staged', 'ran', 'saved', 'wait 60000', 'ran', 'saved', 'wait 180000', 'ran', 'saved']);
  assert.deepEqual(f.attempts.map((r) => r.status), ['failed', 'failed', 'partial']);
  assert.equal(f.row.status, 'done');
  assert.equal(f.row.company_uid, 'co_acme');
  assert.ok(f.row.finished_at);
}));

test('three failed attempts leave an incomplete run with the lane reason', async () => switchedOn(async () => {
  const f = await fixture(['failed', 'failed', 'failed']);
  await executeRun('run', f.runtime);
  assert.equal(f.attempts.length, 3);
  assert.equal(f.row.status, 'incomplete');
  assert.match(f.row.error!, /H-maps: worker offline/);
}));

test('recovery restores a successful lane and its plan without another Maps call', async () => switchedOn(async () => {
  const kept = result('partial');
  const f = await fixture([], [{ id: 1, run_id: 'run', report_id: 'report', lane: 'H-maps', status: 'partial', payload: kept, created_at: '' }]);
  await executeRun('run', f.runtime);
  assert.deepEqual(f.restored, [kept]);
  assert.deepEqual(f.files, [{ id: 'v21-report', name: 'H-plan', data: plan }]);
  assert.deepEqual(f.events, ['staged']);
  assert.equal(f.row.status, 'done');
}));

test('recovery retries a failed lane while keeping its saved trade and town plan', async () => switchedOn(async () => {
  const f = await fixture(['done'], [{ id: 1, run_id: 'run', report_id: 'report', lane: 'H-maps', status: 'failed', payload: result('failed'), created_at: '' }]);
  await executeRun('run', f.runtime);
  assert.deepEqual(f.restored, []);
  assert.deepEqual(f.files[0].data, plan);
  assert.equal(f.attempts.length, 1);
  assert.equal(f.row.status, 'done');
}));

test('a new run of a report reuses the plan of its last run', async () => switchedOn(async () => {
  const earlier = { trades: ['freight forwarder'], areas: ['Klang'], offices: ['Klang'], picked_at: '2026-11-07' };
  const f = await fixture(['done'], [], earlier);
  await executeRun('run', f.runtime);
  assert.deepEqual(f.files, [{ id: 'v21-report', name: 'H-plan', data: earlier }]);
  assert.match(f.row.log[0].msg, /Maps plan from the last run of this report/);
  assert.equal(f.row.status, 'done');
}));

test("this run's own saved plan beats the report's earlier plan", async () => switchedOn(async () => {
  const earlier = { trades: ['old'], areas: ['Old'], offices: ['Old'], picked_at: '2026-01-01' };
  const f = await fixture(['done'], [{ id: 1, run_id: 'run', report_id: 'report', lane: 'H-maps', status: 'failed', payload: result('failed'), created_at: '' }], earlier);
  await executeRun('run', f.runtime);
  assert.deepEqual(f.files, [{ id: 'v21-report', name: 'H-plan', data: plan }]);
  assert.match(f.row.log[0].msg, /Maps plan from this run/);
}));

test('a report that never ran H-maps picks a new plan', async () => switchedOn(async () => {
  const f = await fixture(['done']);
  await executeRun('run', f.runtime);
  assert.deepEqual(f.files, []);
  assert.match(f.row.log[0].msg, /Maps plan picked new/);
}));

test('an adapter rejection fails the run without staging a dive or running a lane', async () => switchedOn(async () => {
  const f = await fixture([]);
  f.runtime.loadV21Dive = async () => { throw new Error('Step 2 is not done'); };
  await executeRun('run', f.runtime);
  assert.equal(f.row.status, 'failed');
  assert.equal(f.row.error, 'Step 2 is not done');
  assert.deepEqual(f.events, []);
}));
