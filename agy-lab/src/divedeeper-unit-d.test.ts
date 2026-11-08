import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { loadV21Dive, type Reader } from './divedeeper/v21/adapter.ts';
import { speedLane } from './divedeeper/v21/speed.ts';
import { savedReviews } from './divedeeper/v21/reviews.ts';
import { executeRun, V21_DEEPER_LANES, V21_DEEPER_WRITING, type Runtime } from './divedeeper/v21/run.ts';
import type { Run, Lane } from './divedeeper/v21/store.ts';
import type { LaneResult } from './divedeeper/runner.ts';
import { buildReport } from './divedeeper/report-html.ts';
import { resolve, STAGE1_LANES } from './divedeeper/editor.ts';
import { makeCtx, parseJson, writeLane, laneFile, type Ctx } from './divedeeper/lib.ts';
import { run as consult } from './divedeeper/sections/S2-consult.ts';
import { run as edit } from './divedeeper/sections/S3-editor.ts';
import { run as analyse } from './divedeeper/sections/S4-analysis.ts';
import { run as plan } from './divedeeper/sections/S5-plan.ts';
import { handle } from './v21-deeper-http.ts';

const allNames = [...V21_DEEPER_LANES.flat(), ['W', 'speed'], ...V21_DEEPER_WRITING].map(([s, l]) => `${s}-${l}`);
const writing = V21_DEEPER_WRITING.map(([s, l]) => `${s}-${l}`);
function lane(name: string, status: LaneResult['status'] = 'done'): LaneResult {
  const [section, lane] = name.split('-');
  return { section, lane, diveId: 'v21-report', company: 'Acme', status, ran_at: '2026-11-07T00:00:00Z',
    ms: 0, findings_count: 0, meter: {}, warnings: [], notes: {}, findings: [], ...(status === 'failed' ? { failure: 'service down' } : {}) };
}
function runRow(): Run {
  return { run_id: 'run', report_id: 'report', company_uid: null, status: 'queued', stage: '', log: [], error: null,
    created_at: '', updated_at: '', finished_at: null, report_html: null };
}
async function loaded() {
  return loadV21Dive('report', { getReport: async () => ({ company: 'Acme', step1_status: 'done', step2_status: 'done' }),
    latestRaw: async (_id, kind) => ({ id: 1, payload: kind === 'result' ? { baseline: {} } : {} }) });
}
function on(t: TestContext) {
  const before = process.env.V21_DEEPER;
  process.env.V21_DEEPER = 'on';
  t.after(() => { if (before === undefined) delete process.env.V21_DEEPER; else process.env.V21_DEEPER = before; });
}
async function runtimeFixture(savedNames: string[] = []) {
  const row = runRow(), dive = await loaded();
  const saved: Lane[] = savedNames.map((name, id) => ({ id, run_id: 'run', report_id: 'report', lane: name,
    status: 'done', payload: lane(name), created_at: '' }));
  const events: string[] = [], reports: Record<string, LaneResult>[] = [], restores: string[] = [];
  const runtime: Runtime = {
    store: { getRun: async () => row, laneRows: async () => saved, lastPlan: async () => null,
      update: async (_id, values) => { if (values.report_html) events.push('report saved'); Object.assign(row, values); },
      saveLane: async (_row, result) => { events.push(`saved ${result.section}-${result.lane} ${result.status}`); },
    },
    loadV21Dive: async () => dive, stageDive: () => {}, writeLane: () => {},
    restoreLane: (r) => { restores.push(`${r.section}-${r.lane}`); },
    runLane: async (section, name, _key, _dive, _limit, opts) => {
      assert.deepEqual(opts, { worker: 'myworker' });
      events.push(`ran ${section}-${name}`); return lane(`${section}-${name}`);
    },
    sleep: async (ms) => { events.push(`wait ${ms}`); },
    buildReport: (_dive, lanes) => { reports.push(lanes); events.push('report built'); return '<!doctype html><title>Internal audit</title>'; },
  };
  return { row, runtime, events, reports, restores };
}

test('writing stages run one at a time after durable lanes, then the complete report is stored', async (t) => {
  on(t);
  const f = await runtimeFixture();
  const run = f.runtime.runLane;
  f.runtime.runLane = async (...args) => {
    const name = `${args[0]}-${args[1]}`;
    if (name === 'S2-consult') for (const lane of allNames.filter((n) => !writing.includes(n))) {
      assert.ok(f.events.some((e) => e.startsWith(`saved ${lane} `)), `${lane} must be durable before S2`);
    }
    const index = writing.indexOf(name);
    if (index > 0) assert.ok(f.events.includes(`saved ${writing[index - 1]} done`));
    return run(...args);
  };
  await executeRun('run', f.runtime);
  assert.equal(f.row.status, 'done');
  assert.deepEqual(f.events.filter((e) => e.startsWith('ran S')), writing.map((n) => `ran ${n}`));
  assert.deepEqual(Object.keys(f.reports[0]).sort(), [...allNames].sort());
  assert.deepEqual(f.events.slice(-2), ['report built', 'report saved']);
  assert.match(f.row.report_html!, /Internal audit/);
  assert.ok(f.restores.includes('W-speed'));
});

test('each writing stage stops later stages after three failures; resume skips everything already saved', async (t) => {
  on(t);
  for (const [index, name] of writing.entries()) {
    const f = await runtimeFixture(allNames.filter((n) => !writing.includes(n)).concat(writing.slice(0, index)));
    f.row.report_html = 'stale HTML';
    f.runtime.runLane = async (section, suffix) => { const name = `${section}-${suffix}`; f.events.push(`ran ${name}`); return lane(name, 'failed'); };
    await executeRun('run', f.runtime);
    assert.equal(f.row.status, 'incomplete', name);
    assert.equal(f.row.report_html, null);
    assert.deepEqual(f.events, [
      `ran ${name}`, `saved ${name} failed`, 'wait 60000',
      `ran ${name}`, `saved ${name} failed`, 'wait 180000',
      `ran ${name}`, `saved ${name} failed`,
    ]);
    assert.equal(f.reports.length, 0);
    assert.match(f.row.error!, new RegExp(name));
    const resumed = await runtimeFixture(allNames.filter((n) => !writing.slice(index).includes(n)));
    await executeRun('run', resumed.runtime);
    assert.deepEqual(resumed.events.filter((e) => e.startsWith('ran ')), writing.slice(index).map((n) => `ran ${n}`));
    assert.equal(resumed.row.status, 'done');
  }
});

test('writing retries accept partial results and all saved stages can rebuild the report without rerunning', async (t) => {
  on(t);
  const f = await runtimeFixture(allNames.filter((n) => n !== 'S5-plan'));
  let tries = 0;
  f.runtime.runLane = async () => lane('S5-plan', ++tries === 1 ? 'failed' : 'partial');
  await executeRun('run', f.runtime);
  assert.equal(tries, 2);
  assert.equal(f.row.status, 'done');
  assert.equal(f.reports[0]['S5-plan'].status, 'partial');
  const resumed = await runtimeFixture(allNames);
  resumed.runtime.runLane = async () => assert.fail('saved stage must not run');
  await executeRun('run', resumed.runtime);
  assert.equal(resumed.restores.length, 15);
  assert.equal(resumed.row.status, 'done');
  assert.equal(resumed.reports.length, 1);
});

test('missing, skipped, or failed Step 1.5 speed yields no pages and a warning without a request', (t) => {
  t.mock.method(globalThis, 'fetch', async () => assert.fail('must reuse saved PageSpeed'));
  for (const assets of [null, {}, { pagespeed: { status: 'skipped' } }, { pagespeed: { status: 'failed', error: 'Google unavailable' } },
    { pagespeed: { status: 'done', mobile: { ok: false, error: 'failed' }, desktop: { ok: false, error: 'failed' } } }]) {
    const result = speedLane('v21-report', { company: 'Acme', v21: { assets } });
    assert.equal(result.status, 'partial');
    assert.deepEqual(result.notes.pages, []);
    assert.deepEqual(result.notes.homes, []);
    assert.ok(result.warnings.length);
  }
});

test('a missing device does not lose the saved PageSpeed score for the other device', () => {
  const result = speedLane('v21-report', { company: 'Acme', v21: { assets: { pagespeed: { status: 'done',
    mobile: { ok: true, url: 'https://acme.test', site: 'acme.test', scores: { performance: 70 } } } } } });
  assert.equal(result.status, 'partial');
  assert.equal((result.notes.pages as any[])[0].strategy, 'mobile');
  assert.equal(resolve({ company: 'Acme' }, { 'W-speed': result }).speed.main_mobile.scores.performance, 70);
});

test('saved assets and every adapter report build without old company-dive fields', { skip: !process.env.V21_DEEPER_ROWS }, async (t) => {
  t.mock.method(globalThis, 'fetch', async () => assert.fail('fixtures must stay offline'));
  const folder = process.env.V21_DEEPER_ROWS!;
  const entries = (await fs.readdir(folder, { withFileTypes: true })).filter((entry) => entry.isDirectory());
  assert.ok(entries.length);
  for (const entry of entries) await t.test(entry.name, async () => {
    const dir = path.join(folder, entry.name);
    const { report } = JSON.parse(await fs.readFile(path.join(dir, 'report.json'), 'utf8'));
    const rows = await Promise.all((await fs.readdir(dir)).filter((f) => /^row-.*\.json$/.test(f)).map(async (f) => JSON.parse(await fs.readFile(path.join(dir, f), 'utf8'))));
    const reader: Reader = { getReport: async () => report,
      latestRaw: async (_id, kind) => rows.filter((r) => r.kind === kind).sort((a, b) => Number(b.id) - Number(a.id))[0] ?? null };
    const { dive } = await loadV21Dive(report.report_id, reader);
    const speed = speedLane(`v21-${report.report_id}`, dive);
    const assets = (await reader.latestRaw(report.report_id, 'assets'))!.payload;
    assert.deepEqual(speed.notes.pages, [assets.pagespeed.mobile, assets.pagespeed.desktop]);
    assert.equal(speed.status, 'done');
    assert.equal(speed.ran_at, assets.created_at);
    assert.deepEqual(speed.notes.homes, [{ site: assets.pagespeed.mobile.site, url: assets.pagespeed.mobile.url }]);
    assert.equal(speed.findings.length, assets.findings.filter((f: any) => /^psi-/.test(f.check)).length);
    const L = Object.fromEntries(allNames.map((name) => [name, lane(name)]));
    L['W-speed'] = speed;
    const R = resolve(dive, L);
    assert.deepEqual(R.speed.pages, speed.notes.pages);
    assert.equal(R.reviews.total, assets.google_reviews.data.reviews.length);
    assert.deepEqual(R.reviews.listings.map((l) => l.count), [assets.google_reviews.data.review_count]);
    const html = buildReport(dive, L);
    assert.match(html, /<!doctype html>/i);
    assert.match(html, /Website speed and quality/);
    assert.match(html, /no company-dive background dossier/);
    const noSpeed = { ...L, 'W-speed': speedLane('v21-report', { ...dive, v21: { ...dive.v21, assets: null } }) };
    assert.doesNotThrow(() => buildReport(dive, noSpeed));
  });
});

function context(t: TestContext, v21 = true) {
  const warnings: string[] = [], reads: string[] = [], prompts: string[] = [];
  const ctx = { ...makeCtx(`unit-d-${randomUUID()}`, 'S3', 'editor', v21 ? { worker: 'myworker' } : undefined),
    warn: (s: string) => { warnings.push(s); }, log: () => {}, parseJson,
    llm: async (prompt: string) => { prompts.push(prompt); return '{}'; },
    read: async (url: string) => { reads.push(url); return { url, finalUrl: url, status: 200, text: 'WORKER_TEXT', via: 'myworker' }; },
  } as Ctx;
  const names = [...STAGE1_LANES, 'E-maps', ...writing];
  for (const name of names) writeLane(ctx.diveId, name, lane(name));
  t.after(async () => { for (const name of names) await fs.rm(laneFile(ctx.diveId, name), { force: true }); });
  return { ctx, warnings, reads, prompts };
}
function reviewDive() {
  return { company: 'Acme', result: { identity: { legal_name: 'Acme', official_domains: ['acme.test'] } }, v21: { assets: {
    google_reviews: { status: 'done', profile: { name: 'Acme HQ' }, data: { name: 'Acme', rating: 4.5, review_count: 80, truncated: true, reviews: [
      { rating: 1, author: 'Unanswered', date: '2026-11-01', text: 'Please help with the installation', owner_reply: null },
      { rating: 2, author: 'Answered', date: '2026-11-02', text: 'An issue', owner_reply: { text: 'We have called you' } },
      { rating: 5, author: 'Happy', date: '2026-11-03', text: 'Excellent service and safe installation. '.repeat(4), owner_reply: null },
    ] } },
  } } };
}

test('S2 uses worker reads and saved Step 1.5 reviews with reply, rating, and listing fields mapped', async (t) => {
  const f = context(t), d = reviewDive();
  t.mock.method(globalThis, 'fetch', async () => assert.fail('stage must use ctx.read'));
  f.ctx.page = async () => assert.fail('stage must use ctx.read');
  const output = await consult(f.ctx, d);
  assert.deepEqual(f.reads, ['https://acme.test/']);
  assert.match(f.prompts[0], /WORKER_TEXT/);
  const prompt = f.prompts.find((p) => p.startsWith('Draft owner replies'))!;
  assert.match(prompt, /1★ 2026-11-01 on "Acme HQ"/);
  assert.match(prompt, /Please help with the installation/);
  assert.doesNotMatch(prompt, /An issue/);
  assert.equal((output.notes.reply_targets as any[]).length, 2);
  assert.equal(savedReviews(d).per_listing[0].pulled, 3);
  assert.equal(savedReviews(d).per_listing[0].replied, 1);
  const R = resolve(d, {});
  assert.equal(R.reviews.total, 3);
  assert.equal(R.reviews.replied, 1);
  assert.equal(R.reviews.unanswered_low.length, 1);
  assert.equal(R.reviews.listings[0].count, 80);
});

test('V2.1 prefers lane reviews when present and legacy consultation ignores saved assets', async (t) => {
  const f = context(t), d = reviewDive();
  writeLane(f.ctx.diveId, 'E-maps', { notes: { reviews: [{ stars: 1, text: 'LANE_REVIEW', listing: 'Lane listing' }] } });
  await consult(f.ctx, d);
  assert.match(f.prompts.find((p) => p.startsWith('Draft owner replies'))!, /LANE_REVIEW/);
  assert.doesNotMatch(f.prompts.find((p) => p.startsWith('Draft owner replies'))!, /Please help/);
  assert.equal(resolve(d, { 'E-maps': { notes: { reviews: [{ stars: 1, text: 'Lane review' }] } } }).reviews.unanswered_low[0].text, 'Lane review');
  const old = context(t, false);
  const output = await consult(old.ctx, d);
  assert.equal(output.notes.replies, null);
  assert.equal(old.prompts.some((p) => p.startsWith('Draft owner replies')), false);
});

test('S3 V2.1 calls the worker once per ask, maps JPEG shots, and skips blocked or failed shots', async (t) => {
  const f = context(t), d = reviewDive();
  const asks: any[] = [];
  const realExists = fsSync.existsSync;
  let browserProbes = 0;
  t.mock.method(fsSync, 'existsSync', (file: any) => { if (!String(file).endsWith('.json')) { browserProbes++; return false; } return realExists(file); });
  writeLane(f.ctx.diveId, 'C-merged', { findings: [
    { title: 'Leaked note', check: 'leaked-note', evidence: 'Outline this text', source: 'https://acme.test/note', severity: 'high' },
    { title: 'Empty page', check: 'placeholder', source: 'https://acme.test/empty', severity: 'medium' },
    { title: 'Missing page', check: 'page-status', source: 'https://acme.test/missing', severity: 'high' },
  ] });
  f.ctx.shot = async (ask) => {
    asks.push(ask);
    if (ask.url.endsWith('/empty')) return { image: 'blocked', found: true, blocked: true, status: 403, finalUrl: ask.url };
    if (ask.url.endsWith('/missing')) return { error: 'worker offline' };
    return { image: 'data:image/jpeg;base64,/9j/TEST', found: Boolean(ask.find), blocked: false, status: 200, finalUrl: ask.url };
  };
  const output = await edit(f.ctx, d);
  assert.deepEqual(asks, [
    { url: 'https://acme.test/', device: 'mobile' },
    { url: 'https://acme.test/note', device: 'desktop', find: 'Outline this text' },
    { url: 'https://acme.test/empty', device: 'desktop', find: 'Coming Soon' },
    { url: 'https://acme.test/missing', device: 'desktop' },
  ]);
  assert.equal(browserProbes, 0);
  const shots = output.notes.shots as any[];
  assert.equal(shots.length, 2);
  assert.deepEqual(shots.map((s) => [s.key, s.img, s.found]), [['cover', '/9j/TEST', false], ['C-merged#0', '/9j/TEST', true]]);
  assert.equal(shots[1].caption, 'Text left on the page that was never meant for customers');
  assert.equal(shots[1].find, 'Outline this text');
  assert.ok(Number.isFinite(Date.parse(shots[1].taken_at)));
  assert.ok(f.warnings.some((w) => /blocked/.test(w)));
  assert.ok(f.warnings.some((w) => /worker offline/.test(w)));
});

test('S3 skips a thrown worker shot and an unproven text shot, while legacy uses the local browser path', async (t) => {
  const f = context(t), d = reviewDive();
  writeLane(f.ctx.diveId, 'C-merged', { findings: [{ check: 'placeholder', source: 'https://acme.test/empty' }] });
  f.ctx.shot = async (ask) => {
    if (!ask.find) throw new Error('worker disconnected');
    return { image: '/9j/TEST', found: false, blocked: false, status: 200, finalUrl: ask.url };
  };
  assert.deepEqual((await edit(f.ctx, d)).notes.shots, []);
  assert.ok(f.warnings.some((w) => /worker disconnected/.test(w)));
  const old = context(t, false);
  old.ctx.shot = async () => assert.fail('legacy editor must not use worker');
  const realExists = fsSync.existsSync;
  let browserProbes = 0;
  t.mock.method(fsSync, 'existsSync', (file: any) => { if (!String(file).endsWith('.json')) { browserProbes++; return false; } return realExists(file); });
  assert.deepEqual((await edit(old.ctx, d)).notes.shots, []);
  assert.ok(browserProbes > 0);
  assert.ok(old.warnings.some((w) => /no browser/.test(w)));
});

test('S3 keeps a worker screenshot that proves a missing page and skips an answer without an image', async (t) => {
  const f = context(t), d = reviewDive();
  writeLane(f.ctx.diveId, 'C-merged', { findings: [{ check: 'page-status', severity: 'high', source: 'https://acme.test/missing' }] });
  f.ctx.shot = async (ask) => ({ ...(ask.url.endsWith('/missing') ? { image: '/9j/TEST' } : {}),
    found: false, blocked: false, status: ask.url.endsWith('/missing') ? 404 : 200, finalUrl: ask.url });
  const shots = (await edit(f.ctx, d)).notes.shots as any[];
  assert.deepEqual(shots.map((s) => s.url), ['https://acme.test/missing']);
  assert.ok(f.warnings.some((w) => /no image/.test(w)));
});

test('S4 and S5 read adapter fields and remain LLM-only in both modes', async (t) => {
  for (const v21 of [true, false]) {
    const f = context(t, v21), { dive } = await loaded();
    f.ctx.read = async () => assert.fail('analysis and plan are LLM-only');
    f.ctx.page = async () => assert.fail('analysis and plan are LLM-only');
    f.ctx.shot = async () => assert.fail('analysis and plan are LLM-only');
    f.ctx.llm = async (prompt) => { f.prompts.push(prompt); return prompt.startsWith('You are the senior') ? '{"verdict":"Saved analysis","parts":[],"stories":[]}' : '{"tasks":[]}'; };
    const a = await analyse(f.ctx, dive);
    assert.equal(a.notes.verdict, 'Saved analysis');
    writeLane(f.ctx.diveId, 'S4-analysis', a);
    const c = lane('C-merged');
    c.findings = [{ title: 'Fix contact page', detail: 'Contact page is missing', severity: 'high', source: null, checked_at: '' }];
    writeLane(f.ctx.diveId, 'C-merged', c);
    const p = await plan(f.ctx, dive);
    assert.equal(p.notes.total, 1);
    assert.equal(p.notes.covered, 1);
    assert.equal(f.prompts.length, 2);
  }
});

test('report endpoint returns 404 before HTML exists, serves HTML afterwards, and obeys the switch', async (t) => {
  on(t);
  let row: Run | null = null, status = 0, body: any, headers: Record<string, string> = {}, reads = 0;
  const runtime = { configured: () => true, getRun: async () => { reads++; return row; },
    listRuns: async () => [], laneRows: async () => [], start: async () => assert.fail('GET cannot start work') };
  const res = { writeHead: (code: number, value: any) => { status = code; headers = value; }, end: (value: any) => { body = value; } } as any;
  const ctx = { json: (_res: any, code: number, value: unknown) => { status = code; body = value; }, readJson: async () => ({}) };
  const url = new URL('http://local/api/v21/deeper/run/report');
  await handle({ method: 'GET' } as any, res, url, ctx, runtime);
  assert.equal(status, 404);
  row = runRow();
  await handle({ method: 'GET' } as any, res, url, ctx, runtime);
  assert.equal(status, 404);
  row.report_html = '<!doctype html><h1>Internal</h1>';
  await handle({ method: 'GET' } as any, res, url, ctx, runtime);
  assert.equal(status, 200);
  assert.equal(headers['content-type'], 'text/html; charset=utf-8');
  assert.equal(headers['cache-control'], 'no-store');
  assert.equal(body, row.report_html);
  process.env.V21_DEEPER = 'off';
  assert.equal(await handle({ method: 'GET' } as any, res, url, ctx, runtime), false);
  assert.equal(reads, 3);
});

test('V2.1 report routing stays behind operator authorization and outside public handlers', async () => {
  const source = await fs.readFile(new URL('./server.ts', import.meta.url), 'utf8');
  const gate = source.indexOf('// An OpenAI client');
  // server.ts mounts the V2.1 deeper-dive routes itself, after the operator-token check.
  const mount = source.indexOf('await v21DeeperHttp.handle(req, res, url');
  assert.ok(gate >= 0 && mount > gate);
  assert.match(source.slice(gate - 55, gate), /if \(!authorized\(req, url\)\)/);
});
