// Unit tests for the two rechecks (divedeeper/check.ts, sections/S1-recheck.ts, sections/S6-check.ts). The LLM is a fake that returns
// canned text: these show our own logic (what is sent, how verdicts act, the guards), not what a real model says.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { makeCtx, writeLane, laneFile } from './divedeeper/lib.ts';
import { applyCheck, statements, tooMany } from './divedeeper/check.ts';
import { items } from './divedeeper/editor.ts';
import { buildReport } from './divedeeper/report-html.ts';
import { run as recheck } from './divedeeper/sections/S1-recheck.ts';
import { run as checkReport } from './divedeeper/sections/S6-check.ts';

const dive = { company: 'Acme Sdn Bhd', finished_at: '2026-11-08T10:00:00Z', dossier: '', result: { identity: { legal_name: 'Acme Sdn Bhd', industry: 'Solar', registration_numbers: ['123456-W'], official_domains: ['acme.test'], address: '1, Jalan Satu' } } };
const f = (title: string, severity = 'high', extra: Record<string, unknown> = {}) => ({ title, detail: `detail of ${title}`, severity, source: null, checked_at: 'x', ...extra });

async function lanesOnDisk(lanes: Record<string, unknown>) {
  const id = `recheck-${randomUUID()}`;
  for (const [name, data] of Object.entries(lanes)) writeLane(id, name, data);
  return { id, clean: async () => { for (const name of Object.keys(lanes)) await fs.rm(laneFile(id, name), { force: true }); } };
}
function ctxFor(id: string, section: string, lane: string, replies: (prompt: string, n: number) => string) {
  const ctx: any = makeCtx(id, section, lane);
  const prompts: string[] = [];
  ctx.llm = async (p: string) => { prompts.push(p); return replies(p, prompts.length - 1); };
  return { ctx, prompts };
}
/** F-ids in a recheck prompt, in order. */
const idsIn = (p: string) => [...p.matchAll(/^(F\d+) \| /gm)].map((m) => m[1]);

test('a finding the recheck found false is left out, a weak one is lowered, the rest is untouched; without a recheck nothing changes', () => {
  const L: any = { 'K-credibility': { findings: [f('court case A'), f('court case B'), f('namesake C'), f('fine D')] } };
  assert.equal(items(L).length, 4);
  const withVerdicts = { ...L, 'S1-recheck': { notes: { verdicts: { 'K-credibility#2': { verdict: 'false', why: 'a namesake' }, 'K-credibility#1': { verdict: 'weak', why: 'minor' } } } } };
  const got = items(withVerdicts);
  assert.deepEqual(got.map((x) => [x.title, x.severity]), [['court case A', 'high'], ['fine D', 'high'], ['court case B', 'low']]);
});

test('S1 sends only the judged lanes\' urgent and needs-work findings; mechanical lanes and low findings never go', async () => {
  const d = await lanesOnDisk({
    'K-credibility': { findings: [f('K high'), f('K low', 'low')] },
    'N-news': { findings: [f('N medium', 'medium')] },
    'A-assets': { findings: [f('domain expires in 20 days')] },
    'W-speed': { findings: [f('slow page')] },
    'C-merged': { findings: [f('spelling: "DISCOVERY MORE"', 'high', { check: 'llm' }), f('SSM number missing', 'high', { check: 'ssm' })] },
  });
  try {
    const { ctx, prompts } = ctxFor(d.id, 'S1', 'recheck', () => JSON.stringify({ verdicts: [] }));
    await recheck(ctx, dive);
    assert.equal(prompts.length, 1, 'one prompt for all of them');
    const p = prompts[0];
    for (const sent of ['K high', 'N medium', 'DISCOVERY MORE']) assert.ok(p.includes(sent), sent);
    for (const notSent of ['K low', 'domain expires', 'slow page', 'SSM number missing']) assert.ok(!p.includes(notSent), notSent);
    assert.ok(p.includes('registration numbers: 123456-W') && p.includes('acme.test'));
  } finally { await d.clean(); }
});

test('S1 verdicts are read by id; "false" without a reason counts as real; unknown ids and verdicts are ignored', async () => {
  const d = await lanesOnDisk({ 'K-credibility': { findings: Array.from({ length: 12 }, (_, i) => f(`finding ${String.fromCharCode(65 + i)}`)) } });
  try {
    const { ctx } = ctxFor(d.id, 'S1', 'recheck', () => JSON.stringify({ verdicts: [
      { id: 'F1', verdict: 'false', why: 'a namesake company' },
      { id: 'F2', verdict: 'false', why: '' },
      { id: 'F3', verdict: 'weak', why: 'minor' },
      { id: 'F99', verdict: 'false', why: 'no such finding' },
      { id: 'F4', verdict: 'maybe', why: 'not a verdict' },
    ] }));
    const out = await recheck(ctx, dive);
    const n: any = out.notes;
    assert.deepEqual(Object.keys(n.verdicts).sort(), ['K-credibility#0', 'K-credibility#2']);
    assert.equal(n.verdicts['K-credibility#0'].verdict, 'false');
    assert.equal(n.verdicts['K-credibility#2'].verdict, 'weak');
    assert.equal(n.dropped.length, 1);
    assert.equal(n.downgraded.length, 1);
    assert.equal(n.ignored, false);
    assert.equal(n.unanswered, 9, 'findings with no valid verdict stay as they were (F4\'s "maybe" is not one)');
  } finally { await d.clean(); }
});

test('S1 does not believe a recheck that condemns more than 40% of what it was asked', async () => {
  const d = await lanesOnDisk({ 'K-credibility': { findings: Array.from({ length: 6 }, (_, i) => f(`finding ${String.fromCharCode(65 + i)}`)) } });
  try {
    const { ctx } = ctxFor(d.id, 'S1', 'recheck', () => JSON.stringify({ verdicts: ['F1', 'F2', 'F3'].map((id) => ({ id, verdict: 'false', why: 'because' })) }));
    const out = await recheck(ctx, dive);
    assert.equal((out.notes as any).ignored, true);
    assert.deepEqual((out.notes as any).verdicts, {});
    assert.ok(ctx.warnings.some((w: string) => /too many to believe/.test(w)));
  } finally { await d.clean(); }
  assert.equal(tooMany(2, 4), false, 'under 5 asked: the share rule does not apply');
  assert.equal(tooMany(2, 5), false);
  assert.equal(tooMany(3, 5), true);
});

test('S1 splits a call that is not JSON (the content filter) in half, and leaves a lone finding as it was', async () => {
  const d = await lanesOnDisk({ 'K-credibility': { findings: [f('one'), f('two')] } });
  try {
    const { ctx, prompts } = ctxFor(d.id, 'S1', 'recheck', (p, n) => (n === 0 ? 'I cannot help with that.' : idsIn(p).includes('F1') ? JSON.stringify({ verdicts: [{ id: 'F1', verdict: 'false', why: 'reason' }] }) : 'refused again'));
    const out = await recheck(ctx, dive);
    assert.equal(prompts.length, 3, 'the whole list, then each half');
    assert.deepEqual(Object.keys((out.notes as any).verdicts), ['K-credibility#0']);
    assert.ok(ctx.warnings.some((w: string) => /stays as it was/.test(w)));
  } finally { await d.clean(); }
});

const S4 = { verdict: 'Acme stands well.', stories: [{ theme: 'understanding', headline: 'First story', body: 'b', cost: 'c', fix: 'f' }, { theme: 'credibility', headline: 'Second story', body: 'b', cost: 'c', fix: 'f' }], parts: [{ theme: 'contact', assessment: 'Part one.' }], threads: [{ title: 'Thread', body: 'T body', themes: [] }], strengths: ['Strong A', 'Strong B'], risks: ['Risk A'], opportunities: ['Opp A'], mismatch: [{ issue: 'Mismatch A', settled: null }] };
const S5 = { depts: [{ dept: 'website', tasks: [{ dept: 'website', task: 'Fix the page', why: 'w', how: 'h', impact: 'high', theme: 'contact', items: ['C-merged#0'] }, { dept: 'website', task: 'Add FAQ', why: 'w', how: 'h', impact: 'medium', theme: 'understanding', items: ['C-merged#1'] }], also: [] }] };

test('every statement S4 and S5 write has an id the check understands', () => {
  const ids = statements(S4, S5).map((s) => s.id);
  assert.deepEqual(ids, ['verdict', 'stories.0', 'stories.1', 'parts.0', 'threads.0', 'strengths.0', 'strengths.1', 'risks.0', 'opportunities.0', 'mismatch.0', 'task.website.0', 'task.website.1']);
  assert.deepEqual(statements(undefined, undefined), []);
});

test('applyCheck takes out the unsupported statements, puts a withdrawn task\'s findings back under its department, and changes nothing else', () => {
  const L: any = { 'S4-analysis': { notes: S4 }, 'S5-plan': { notes: S5 }, 'S6-check': { notes: { unsupported: [{ id: 'verdict' }, { id: 'stories.0' }, { id: 'strengths.1' }, { id: 'task.website.0' }], ignored: false } } };
  const before = JSON.stringify(L);
  const out = applyCheck(L);
  assert.equal(JSON.stringify(L), before, 'the input is not changed');
  const an = out['S4-analysis'].notes;
  assert.equal(an.verdict, null);
  assert.deepEqual(an.stories.map((s: any) => s.headline), ['Second story']);
  assert.deepEqual(an.strengths, ['Strong A']);
  assert.equal(an.threads.length, 1);
  const d = out['S5-plan'].notes.depts[0];
  assert.deepEqual(d.tasks.map((t: any) => t.task), ['Add FAQ']);
  assert.deepEqual(d.also, [{ dept: 'website', key: 'C-merged#0', severity: 'high', theme: 'contact' }]);
  assert.equal(applyCheck({ 'S4-analysis': { notes: S4 } } as any)['S4-analysis'].notes, S4, 'no check lane: the same notes');
  assert.equal(applyCheck({ ...L, 'S6-check': { notes: { unsupported: [{ id: 'verdict' }], ignored: true } } })['S4-analysis'].notes.verdict, S4.verdict, 'an ignored check removes nothing');
});

test('S6 sends every statement with the findings as evidence; it withdraws the unsupported ones, and "unsupported" needs a reason', async () => {
  const d = await lanesOnDisk({ 'K-credibility': { findings: [f('Court case in 2019 against Acme', 'high', { quote: 'Court case in 2019 against Acme' })] }, 'S4-analysis': { notes: S4 }, 'S5-plan': { notes: S5 } });
  try {
    const { ctx, prompts } = ctxFor(d.id, 'S6', 'check', () => JSON.stringify({ checks: [
      { id: 'stories.0', verdict: 'unsupported', why: 'cites 62 staff, no finding says so' },
      { id: 'stories.1', verdict: 'unsupported', why: '' },
      { id: 'verdict', verdict: 'supported', why: '' },
      { id: 'nope', verdict: 'unsupported', why: 'no such statement' },
    ] }));
    const out = await checkReport(ctx, dive);
    assert.equal(prompts.length, 1);
    for (const s of ['Court case in 2019 against Acme', 'stories.0 | story | First story', 'task.website.1 | task | Add FAQ', 'MEASURED FACTS']) assert.ok(prompts[0].includes(s), s);
    const n: any = out.notes;
    assert.deepEqual(n.unsupported.map((u: any) => u.id), ['stories.0']);
    assert.equal(n.asked, 12);
    assert.equal(n.ignored, false);
  } finally { await d.clean(); }
});

test('S6 is not believed when it condemns more than 40% of the statements, and it splits a call that fails', async () => {
  const d = await lanesOnDisk({ 'S4-analysis': { notes: S4 }, 'S5-plan': { notes: S5 } });
  try {
    const all = ctxFor(d.id, 'S6', 'check', (p) => JSON.stringify({ checks: [...p.matchAll(/^([a-z]+(?:\.[\w.]+)?) \| (?:verdict|story|part assessment|thread|strength|risk|opportunity|mismatch|task) \|/gm)].map((m) => ({ id: m[1], verdict: 'unsupported', why: 'nothing backs it' })) }));
    const out = await checkReport(all.ctx, dive);
    assert.equal((out.notes as any).ignored, true);
    assert.deepEqual((out.notes as any).unsupported, []);
    const split = ctxFor(d.id, 'S6', 'check', (p, n) => (n === 0 ? 'refused' : JSON.stringify({ checks: [] })));
    await checkReport(split.ctx, dive);
    assert.equal(split.prompts.length, 3);
  } finally { await d.clean(); }
});

test('the report leaves out a story the check found unsupported, and keeps the others', () => {
  const lanes: any = {
    'D-registry': { ran_at: '2026-11-08T01:00:00Z', findings: [f('VERIFIED: CIDB Grade G7', 'info', { verdict: 'verified' })] },
    'G-search': { ran_at: '2026-11-08T01:00:00Z', findings: [], notes: { assistant: 'Gemini (web search)', models: ['Gemini (web search)'], prompts: [], answers: [] } },
    'S4-analysis': { notes: S4 },
  };
  const html = (l: any) => buildReport(dive, l).replace(/<style[\s\S]*?<\/style>/, '').replace(/ |&nbsp;/g, ' ');
  const plain = html(lanes);
  assert.ok(plain.includes('First story') && plain.includes('Second story'));
  const checked = html({ ...lanes, 'S6-check': { notes: { unsupported: [{ id: 'stories.0' }], ignored: false } } });
  assert.ok(!checked.includes('First story'), 'the unsupported story is gone');
  assert.ok(checked.includes('Second story'));
  assert.ok(!/undefined|\[object Object\]|NaN/.test(checked));
});
