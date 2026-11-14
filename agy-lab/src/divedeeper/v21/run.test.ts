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

test('three failed attempts: the writing stages still run, the report is built, the run is labelled incomplete with the reason', async () => switchedOn(async () => {
  const f = await fixture(['failed', 'failed', 'failed']);
  await executeRun('run', f.runtime);
  assert.equal(f.attempts.length, 3);
  assert.equal(f.row.status, 'incomplete');
  assert.match(f.row.error!, /H-maps: worker offline/);
  assert.deepEqual(f.started, ['G-recommend', 'H-maps', 'G-search', 'K-credibility', 'N-news', 'D-registry', 'H-maps', 'H-maps', 'H-web', 'C-merged', 'R-contacts', 'A-assets', 'B-brand', ...writing]);
  assert.equal(f.savedAll.length, 14 + writing.length);
  assert.ok(f.row.report_html, 'a lane failing never stops the report');
}));

test('recovery restores a successful lane and its plan without another Maps call', async () => switchedOn(async () => {
  const kept = result('partial');
  const f = await fixture([], [{ id: 1, run_id: 'run', report_id: 'report', lane: 'H-maps', status: 'partial', payload: kept, created_at: '' }]);
  await executeRun('run', f.runtime);
  assert.deepEqual(f.restored.filter((r) => r.section !== 'W'), [kept]);
  assert.deepEqual(f.files, [{ id: 'v21-report', name: 'H-plan', data: plan }]);
  assert.deepEqual(f.events, ['staged']);
  assert.equal(f.row.status, 'done');
  assert.deepEqual(f.started, ['G-recommend', 'G-search', 'K-credibility', 'N-news', 'D-registry', 'H-web', 'C-merged', 'R-contacts', 'A-assets', 'B-brand', ...writing]);
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

test('each lane starts when the lanes it reads are done: a slow ChatGPT lane holds back nothing that does not read it', async () => switchedOn(async () => {
  const names = V21_DEEPER_LANES.map(([section, lane]) => `${section}-${lane}`);
  // Every lane comes after everything it reads.
  V21_DEEPER_LANES.forEach(([, , after], i) => { for (const n of after) assert.ok(names.indexOf(n) > -1 && names.indexOf(n) < i, `${names[i]} after ${n}`); });
  const f = await fixture([]);
  const started: string[] = [];
  const saved: string[] = [];
  const finish = new Map<string, () => void>();
  const startedGate = new Map<string, () => void>();
  const startedNow = (name: string) => new Promise<void>((resolve) => { if (started.includes(name)) resolve(); else startedGate.set(name, resolve); });
  f.runtime.runLane = async (section, lane) => {
    const name = `${section}-${lane}`;
    if (section.startsWith('S')) {
      // The writing steps start only after every lane is saved.
      assert.ok(names.every((n) => saved.includes(n)), `${name} waited for every lane`);
      return { ...result('done'), section, lane };
    }
    const reads = V21_DEEPER_LANES.find(([s, l]) => s === section && l === lane)![2];
    assert.ok(reads.every((n) => saved.includes(n)), `${name} starts after what it reads is saved`);
    started.push(name);
    startedGate.get(name)?.();
    await new Promise<void>((resolve) => finish.set(name, resolve));
    return { ...result('done'), section, lane };
  };
  f.runtime.store.saveLane = async (_row, lane) => { saved.push(`${lane.section}-${lane.lane}`); };
  const running = executeRun('run', f.runtime);
  for (const n of ['G-recommend', 'H-maps', 'G-search', 'K-credibility', 'N-news', 'D-registry']) await startedNow(n);
  // G-recommend reads no other lane: it starts at once, beside the first lanes (owner, 2026-11-14).
  assert.deepEqual(started.sort(), ['D-registry', 'G-recommend', 'G-search', 'H-maps', 'K-credibility', 'N-news']);
  finish.get('G-search')!();
  finish.get('H-maps')!();
  await startedNow('C-merged');
  await startedNow('H-web');
  finish.get('C-merged')!();
  await startedNow('R-contacts');
  await startedNow('A-assets');
  finish.get('H-web')!();
  await startedNow('B-brand');
  // G-recommend (ChatGPT) is still asking; contacts, assets and brand did not wait for it.
  for (const n of ['R-contacts', 'A-assets', 'B-brand']) finish.get(n)!();
  for (const n of ['K-credibility', 'N-news', 'D-registry']) finish.get(n)!();
  await new Promise((r) => setTimeout(r, 20));
  assert.ok(!saved.includes('S1-recheck') && !started.some((n) => n.startsWith('S')));
  assert.equal(saved.includes('G-recommend'), false);
  finish.get('G-recommend')!();
  await running;
  assert.equal(f.row.status, 'done');
}));

test('resume restores all completed stages and runs no lane again', async () => switchedOn(async () => {
  const saved: Lane[] = [...V21_DEEPER_LANES.map(([s, l]) => [s, l]), ['W', 'speed'], ...V21_DEEPER_WRITING].map(([section, lane], i) => ({
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

test('a finished report is saved where the report route serves it, whatever its text says', async () => switchedOn(async () => {
  const f = await fixture(['done']);
  f.runtime.buildReport = () => '<!doctype html><title>Audit</title><p>Any text at all.</p>';
  await executeRun('run', f.runtime);
  assert.equal(f.row.status, 'done');
  assert.match(f.row.report_html!, /Any text at all/);
}));
