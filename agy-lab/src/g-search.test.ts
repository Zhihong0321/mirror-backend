// Unit tests for the G-search lane (docs/g-search-lane-design.md). They use a fake hub: they show the logic, not that the
// real hub works. The live proof is a run on the hub on Eternalgy.
import test from 'node:test';
import assert from 'node:assert/strict';
import { secrets } from './core/index.ts';
import { makeCtx } from './divedeeper/lib.ts';
import { buildReport } from './divedeeper/report-html.ts';
import { liveHub, promptA, promptB, promptC, questions, readAnswers, readCompare, run, runJobs, type Hub } from './divedeeper/sections/G-search.ts';

const profile: any = { v: 3, name: 'Acme Sdn Bhd', brand: 'Acme', trade: 'solar panel installer', trades: 'solar panel installers', area: 'Johor Bahru', state: 'Johor', job: 'install solar panels on my house', aliases: ['Acme'], industry: 'Solar' };
const qs = questions(profile);
const A = (named = false) => JSON.stringify(Object.fromEntries(qs.filter((q) => q.kind === 'company').map((q) => [q.id, { answer: `answer to ${q.id}`, sources: ['https://acme.test'] }])));
const B = (names: string[]) => '```json\n' + JSON.stringify(Object.fromEntries(qs.filter((q) => q.kind === 'trade').map((q) => [q.id, { answer: `Try ${names.join(', ')}.`, companies: names, sources: ['https://list.test/best'] }]))) + '\n```';
const C = JSON.stringify({ closest_competitors: ['Rival One', 'Rival Two'], reputation: 'r', services: 's', credentials: 'c', price_signals: 'p', recommend: 'Rival One', weakest: 'few reviews', sources: ['https://x.test'] });
const byPrompt = (names: string[]) => async (prompt: string) => (prompt.includes('closest_competitors') ? C : prompt.includes('"companies"') ? B(names) : A());
const fast = { sleep: () => new Promise<void>((r) => setImmediate(r)) };

test('the 12 prompts: 9 company, 2 trade, 1 comparison; the trade and comparison-free prompts never name the company', () => {
  assert.deepEqual(['company', 'trade', 'compare'].map((k) => qs.filter((q) => q.kind === k).length), [9, 2, 1]);
  assert.ok(!promptB(qs).includes('Acme'), 'prompt B must not prime the assistant with the company name');
  assert.ok(promptA(qs).includes('max 50 words') && promptA(qs).includes('What is Acme Sdn Bhd?'));
  assert.ok(!/Rival|Trexon|Solana/.test(promptC(qs)), 'prompt C names no competitor');
});

test('replies are read as JSON, fenced or not; a missing or empty answer drops only that question', () => {
  const ids = qs.filter((q) => q.kind === 'company').map((q) => q.id);
  assert.equal(Object.keys(readAnswers(A(), ids)!).length, 9);
  assert.equal(Object.keys(readAnswers('```json\n' + A() + '\n```', ids)!).length, 9);
  assert.equal(readAnswers('Sure! Eternalgy is a solar company.', ids), null, 'prose is not JSON');
  const missing = JSON.parse(A()); delete missing.phone;
  // Zero kill gates (owner, 2026-11-14): the other 8 answers are kept, only the missing one is absent.
  assert.deepEqual(Object.keys(readAnswers(JSON.stringify(missing), ids)!), ids.filter((id) => id !== 'phone'), 'a missing question id drops only that question');
  assert.deepEqual(Object.keys(readAnswers(JSON.stringify({ ...JSON.parse(A()), phone: { answer: '  ', sources: [] } }), ids)!), ids.filter((id) => id !== 'phone'), 'an empty answer drops only that question');
  assert.equal(readAnswers(JSON.stringify({ other: { answer: 'x' } }), ids), null, 'a reply that answers none of the questions is not an answer');
  assert.equal(readCompare(C)?.closest_competitors.length, 2);
  assert.equal(readCompare(JSON.stringify({ ...JSON.parse(C), closest_competitors: [] })), null);
  assert.equal(readCompare(JSON.stringify({ ...JSON.parse(C), weakest: '' })), null);
});

test('jobs spread over the workers; a worker that errors is skipped and the next one answers', async () => {
  const log: string[] = [];
  const hub: Hub = { workers: async () => [], ask: async (_p, a) => { log.push(a); if (a === 'w1') throw new Error('quota exhausted'); return 'ok'; } };
  const out = await runJobs([{ key: 'x', prompt: 'p', read: (t) => t }, { key: 'y', prompt: 'p', read: (t) => t }], ['w1', 'w2', 'w3'], hub, fast);
  assert.ok([...out.values()].every((j) => j.done && j.done.account !== 'w1'));
  assert.ok([...out.values()].some((j) => j.errors.some((e) => /w1: quota exhausted/.test(e))));
});

test('wait rule: a slow call is not cut; a second copy goes to an idle worker and the first valid answer wins', async () => {
  let clock = 0;
  let w1Resolve!: (s: string) => void;
  let w1Aborted = false;
  const hub: Hub = { workers: async () => [], ask: (_p, a) => (a === 'w1' ? new Promise<string>((r) => { w1Resolve = r; }) : Promise.resolve('fast answer')) };
  const out = await runJobs([{ key: 'x', prompt: 'p', read: (t) => t }], ['w1', 'w2'], hub, { slowMs: 5000, now: () => clock, sleep: async (ms) => { clock += ms; await new Promise((r) => setImmediate(r)); }, say: () => {} });
  assert.equal(out.get('x')!.done!.account, 'w2', 'the copy answered first');
  assert.equal(w1Aborted, false);
  assert.ok(out.get('x')!.running.has('w1'), 'the first call is still running, not killed');
  w1Resolve('late');
});

test('a prompt every worker fails is given up with each worker\'s reason', async () => {
  const hub: Hub = { workers: async () => [], ask: async (_p, a) => { throw new Error(`${a} is down`); } };
  const out = await runJobs([{ key: 'x', prompt: 'p', read: (t) => t }], ['w1', 'w2'], hub, fast);
  assert.equal(out.get('x')!.done, null);
  assert.equal(out.get('x')!.gaveUp, true);
  assert.match(out.get('x')!.errors.join(' '), /w1 is down.*w2 is down/);
});

test('the lane: 3 prompts x 3 repeats; it counts how often the company is named and who is named instead', async () => {
  const ctx = makeCtx('g-search-test', 'G', 'search');
  const hub: Hub = { workers: async () => ['w1', 'w2', 'w3'], ask: byPrompt(['Trexon', 'Solana Tec']) };
  const out = await run(ctx, {}, { hub, profile });
  const notes: any = out.notes;
  assert.equal(notes.answers.length, (9 + 2) * 3);
  assert.equal(notes.compare.length, 3);
  assert.deepEqual(notes.runs, { A: { ok: 3, asked: 3 }, B: { ok: 3, asked: 3 }, C: { ok: 3, asked: 3 } });
  const named = out.findings.find((f) => /names you in/.test(f.title))!;
  assert.equal(named.title, 'An AI assistant with web search names you in 0 of 6 answers');
  assert.equal(named.severity, 'high');
  assert.match(named.detail, /Companies they name instead: Trexon, Solana Tec\./);
  assert.match(out.findings.find((f) => /closest competitors/.test(f.title))!.title, /Rival One, Rival Two/);
  assert.deepEqual(Object.values(notes.search_results), [[{ url: 'https://list.test/best' }], [{ url: 'https://list.test/best' }]]);
  assert.deepEqual(ctx.warnings, []);
  // named when the answer lists the company
  const ctx2 = makeCtx('g-search-test-2', 'G', 'search');
  const out2 = await run(ctx2, {}, { hub: { workers: async () => ['w1'], ask: byPrompt(['Acme Sdn Bhd', 'Trexon']) }, profile });
  assert.equal(out2.findings.find((f) => /names you in/.test(f.title))!.title, 'An AI assistant with web search names you in 6 of 6 answers');
});

test('the lane fails visibly, with the reasons, when a whole prompt gets no valid answer; a lost comparison only makes it partial', async () => {
  const ctx = makeCtx('g-search-fail', 'G', 'search');
  await assert.rejects(run(ctx, {}, { hub: { workers: async () => ['w1', 'w2'], ask: async () => 'I cannot help with that.' }, profile }), /prompt A got no valid answer.*not the JSON asked for/);
  const ctx2 = makeCtx('g-search-nohub', 'G', 'search');
  await assert.rejects(run(ctx2, {}, { hub: { workers: async () => [], ask: async () => '' }, profile }), /no worker online/);
  const ctx3 = makeCtx('g-search-nocompare', 'G', 'search');
  const out = await run(ctx3, {}, { hub: { workers: async () => ['w1', 'w2'], ask: async (p, a) => (p.includes('closest_competitors') ? 'prose' : byPrompt(['Trexon'])(p)) }, profile });
  assert.equal(ctx3.warnings.some((w) => /comparison prompt got no valid answer/.test(w)), true);
  assert.ok(!out.findings.some((f) => /closest competitors/.test(f.title)));
});

test('the hub client submits a job, polls it until done, and raises the worker\'s error when it fails', async () => {
  const real = globalThis.fetch;
  process.env.AGY_REMOTE_TOKEN = 'test-token';
  let polls = 0;
  let outcome: 'done' | 'failed' = 'done';
  globalThis.fetch = (async (url: string, init?: any) => {
    const u = String(url);
    const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
    assert.equal(init.headers.authorization, 'Bearer test-token');
    if (u.endsWith('/api/status')) return reply({ accounts: { w1: { enabled: true }, w2: { enabled: false }, w3: {} } });
    if (u.endsWith('/api/jobs')) { assert.equal(JSON.parse(init.body).account, 'w1'); return reply({ job_id: 'j1', status: 'queued' }); }
    polls++;
    if (polls < 3) return reply({ status: 'running' });
    return outcome === 'done' ? reply({ status: 'done', ok: true, answer: 'hello' }) : reply({ status: 'failed', ok: false, error: 'quota exhausted' });
  }) as typeof fetch;
  try {
    const hub = liveHub();
    assert.deepEqual(await hub.workers(), ['w1', 'w3'], 'a disabled worker is not used');
    assert.equal(await hub.ask('q', 'w1'), 'hello');
    assert.ok(polls >= 3, 'it kept polling while the job ran');
    polls = 0; outcome = 'failed';
    await assert.rejects(hub.ask('q', 'w1'), /quota exhausted/);
  } finally { globalThis.fetch = real; delete process.env.AGY_REMOTE_TOKEN; }
});

test('the report shows what the assistant said, with its sources and the comparison, and no judge words', async () => {
  const ctx = makeCtx('g-search-report', 'G', 'search');
  const out = await run(ctx, {}, { hub: { workers: async () => ['w1', 'w2', 'w3'], ask: byPrompt(['Trexon']) }, profile });
  const dive = { company: 'Acme Sdn Bhd', finished_at: '2026-11-08T10:00:00Z', dossier: '', result: { identity: { legal_name: 'Acme Sdn Bhd' } } };
  const html = buildReport(dive, { 'G-search': { ran_at: '2026-11-08T01:00:00Z', findings: out.findings, notes: out.notes } } as any).replace(/<style[\s\S]*?<\/style>/, '').replace(/ |&nbsp;/g, ' ');
  for (const s of ['A customer asks', 'Gemini (web search) answers', 'answer to phone', 'This is what it said, not a check of whether it is right', 'Who the assistant compares you with', 'Rival One, Rival Two', 'few reviews']) assert.ok(html.includes(s), s);
  for (const bad of ['from memory', 'Asked from memory', 'None of these is correct', 'wrong ·', 'undefined', '[object Object]', 'NaN']) assert.ok(!html.includes(bad), bad);
});

test('the hub token has its own slot in the key store: the Railway variable name is its fallback, and /workers can save it', () => {
  assert.equal(secrets.KINDS.agy_hub, 'AGY_REMOTE_TOKEN');
  assert.equal(secrets.get('agy_hub', { AGY_REMOTE_TOKEN: ' from-env ' } as NodeJS.ProcessEnv), 'from-env');
  assert.equal(secrets.fromDbByEnvName('SOMETHING_ELSE'), '');
});

test('the /workers page has a text box for the hub token, and the database allows its kind', async () => {
  const { readFileSync } = await import('node:fs');
  assert.match(readFileSync(new URL('./workers.ts', import.meta.url), 'utf8'), /id="secret_agy_hub" data-secret="agy_hub"/);
  const db = readFileSync(new URL('./reportdb.ts', import.meta.url), 'utf8');
  assert.equal((db.match(/'agy_hub'/g) ?? []).length, 3, 'type, kind list and check constraint');
});
