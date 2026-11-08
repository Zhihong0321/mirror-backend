import test from 'node:test';
import assert from 'node:assert/strict';
import { executeRun, V21_DEEPER_LANES, V21_DEEPER_WRITING, type Runtime } from './run.ts';
import { loadV21Dive } from './adapter.ts';
import type { Run, Lane } from './store.ts';
import type { LaneResult } from '../runner.ts';

const plan = { trades: ['solar'], areas: ['Johor'], offices: ['Johor'], picked_at: '2026-01-01' };
const writing = V21_DEEPER_WRITING.map(([s, l]) => `${s}-${l}`);
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
  const started: string[] = [];
  const savedAll: LaneResult[] = [];
  const runtime: Runtime = {
    store: {
      getRun: async () => row,
      laneRows: async () => saved,
      update: async (_id, values) => { Object.assign(row, values); },
      saveLane: async (_row, lane) => {
        savedAll.push(lane);
        if (lane.section === 'H' && lane.lane === 'maps') { attempts.push(lane); events.push('saved'); }
      },
      lastPlan: async (reportId) => { assert.equal(reportId, 'report'); return earlierPlan; },
    },
    loadV21Dive: async () => loaded,
    stageDive: (id) => { assert.equal(id, 'v21-report'); events.push('staged'); },
    restoreLane: (r) => { restored.push(r); },
    writeLane: (id, name, data) => { files.push({ id, name, data }); },
    runLane: async (section, lane, key, _dive, _limit, opts) => {
      assert.deepEqual([key, opts], ['v21-report', { worker: 'myworker' }]);
      started.push(`${section}-${lane}`);
      if (section !== 'H' || lane !== 'maps') return { ...result('done'), section, lane, notes: {} };
      events.push('ran');
      assert.ok(statuses.length, 'unexpected extra lane attempt');
      return result(statuses.shift()!);
    },
    sleep: async (ms) => { events.push(`wait ${ms}`); },
    buildReport: () => '<!doctype html><title>Audit</title>',
  };
  return { row, runtime, events, attempts, restored, files, started, savedAll };
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
  assert.deepEqual(f.started, ['H-maps', 'G-search', 'K-credibility', 'N-news', 'H-maps', 'H-maps', 'H-web', 'D-registry', 'C-merged', 'G-recommend', 'R-contacts', 'A-assets', 'B-brand']);
  assert.equal(f.savedAll.length, 14);
  assert.equal(f.row.report_html, null);
}));

test('recovery restores a successful lane and its plan without another Maps call', async () => switchedOn(async () => {
  const kept = result('partial');
  const f = await fixture([], [{ id: 1, run_id: 'run', report_id: 'report', lane: 'H-maps', status: 'partial', payload: kept, created_at: '' }]);
  await executeRun('run', f.runtime);
  assert.deepEqual(f.restored.filter((r) => r.section !== 'W'), [kept]);
  assert.deepEqual(f.files, [{ id: 'v21-report', name: 'H-plan', data: plan }]);
  assert.deepEqual(f.events, ['staged']);
  assert.equal(f.row.status, 'done');
  assert.deepEqual(f.started, ['G-search', 'K-credibility', 'N-news', 'H-web', 'D-registry', 'C-merged', 'G-recommend', 'R-contacts', 'A-assets', 'B-brand', ...writing]);
}));

test('recovery retries a failed lane while keeping its saved trade and town plan', async () => switchedOn(async () => {
  const f = await fixture(['done'], [{ id: 1, run_id: 'run', report_id: 'report', lane: 'H-maps', status: 'failed', payload: result('failed'), created_at: '' }]);
  await executeRun('run', f.runtime);
  assert.deepEqual(f.restored.map((r) => `${r.section}-${r.lane}`), ['W-speed']);
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

test('stages start their lanes together and save every lane before starting the next stage', async () => switchedOn(async () => {
  assert.deepEqual(V21_DEEPER_LANES, [[['H', 'maps'], ['G', 'search'], ['K', 'credibility'], ['N', 'news']], [['H', 'web'], ['D', 'registry'], ['C', 'merged'], ['G', 'recommend']], [['R', 'contacts'], ['A', 'assets'], ['B', 'brand']]]);
  const f = await fixture([]);
  const started: string[] = [];
  const finish = new Map<string, () => void>();
  const saved: string[] = [];
  const stages = V21_DEEPER_LANES.map((s) => s.map(([section, lane]) => `${section}-${lane}`));
  const gate = () => {
    let open!: () => void;
    const ready = new Promise<void>((resolve) => { open = resolve; });
    return { ready, open };
  };
  const starts = new Map(stages.flat().map((name) => [name, gate()]));
  const firstTwoSaved = gate();
  f.runtime.runLane = async (section, lane) => {
    const name = `${section}-${lane}`;
    if (section.startsWith('S')) return { ...result('done'), section, lane };
    started.push(name);
    if (stages[1].includes(name)) assert.deepEqual(saved.filter((lane) => lane !== 'W-speed').sort(), [...stages[0]].sort());
    if (stages[2].includes(name)) assert.ok(stages[1].every((lane) => saved.includes(lane)));
    const done = new Promise<void>((resolve) => finish.set(name, resolve));
    starts.get(name)!.open();
    await done;
    return { ...result('done'), section, lane };
  };
  f.runtime.store.saveLane = async (_row, lane) => {
    saved.push(`${lane.section}-${lane.lane}`);
    if (saved.filter((name) => name !== 'W-speed').length === 2) firstTwoSaved.open();
  };
  const running = executeRun('run', f.runtime);
  await Promise.all(stages[0].map((name) => starts.get(name)!.ready));
  assert.deepEqual(started, stages[0]);
  finish.get('G-search')!();
  finish.get('H-maps')!();
  await firstTwoSaved.ready;
  assert.equal(started.length, 4, 'second stage waits for the last first-stage lane');
  finish.get('K-credibility')!();
  finish.get('N-news')!();
  await Promise.all(stages[1].map((name) => starts.get(name)!.ready));
  assert.deepEqual(started.slice(4), stages[1]);
  finish.get('H-web')!();
  finish.get('D-registry')!();
  // Contacts, assets and brand must still wait for C-merged's crawl and G-recommend.
  assert.equal(started.length, 8);
  finish.get('C-merged')!();
  finish.get('G-recommend')!();
  await Promise.all(stages[2].map((name) => starts.get(name)!.ready));
  assert.deepEqual(started.slice(8), stages[2]);
  for (const name of stages[2]) finish.get(name)!();
  await running;
  assert.equal(f.row.status, 'done');
}));

test('resume restores all completed stages and runs no lane again', async () => switchedOn(async () => {
  const saved: Lane[] = [...V21_DEEPER_LANES.flat(), ['W', 'speed'], ...V21_DEEPER_WRITING].map(([section, lane], i) => ({
    id: i + 1, run_id: 'run', report_id: 'report', lane: `${section}-${lane}`, status: 'done' as const,
    payload: { ...result('done'), section, lane }, created_at: '',
  }));
  const f = await fixture([], saved);
  await executeRun('run', f.runtime);
  assert.equal(f.restored.length, 18);
  assert.deepEqual(f.started, []);
  assert.deepEqual(f.savedAll, []);
  assert.equal(f.row.status, 'done');
}));
