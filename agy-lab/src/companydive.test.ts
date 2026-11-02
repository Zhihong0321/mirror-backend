import test from 'node:test';
import assert from 'node:assert/strict';
import { shortName, urlKey, Ledger, corpus, parseJson, stripThinking, Budget, BudgetSpent, budgetedCall, diveRunning, setRunningForTests, LANE_HOLD_MS } from './companydive.ts';

test('shortName drops Malaysian and common company suffixes', () => {
  assert.equal(shortName('Eternalgy Sdn Bhd'), 'Eternalgy');
  assert.equal(shortName('ETERNALGY SDN. BHD.'), 'ETERNALGY');
  assert.equal(shortName('Acme Holdings Berhad'), 'Acme Holdings');
  assert.equal(shortName('Foo Pte. Ltd.'), 'Foo');
});

test('urlKey folds www, trailing slash, fragments and tracking params', () => {
  assert.equal(urlKey('https://www.Eternalgy.me/about/?utm_source=x#top'), 'eternalgy.me/about');
  assert.equal(urlKey('https://eternalgy.me/about'), 'eternalgy.me/about');
  assert.equal(urlKey('https://eternalgy.me/faq?format=md'), 'eternalgy.me/faq?format=md');
});

test('ledger dedupes URLs and keeps page text over chunks', () => {
  const l = new Ledger();
  const a = l.add('https://www.x.com/a/', 'A', ['s1'], 'brave:exact');
  const b = l.add('https://x.com/a', '', ['s2'], 'tavily:T1');
  assert.equal(a, b);
  assert.deepEqual(a.found, ['brave:exact', 'tavily:T1']);
  l.setContent(a, 'full page', 'page');
  l.setContent(a, 'chunk', 'chunks');
  assert.equal(a.content, 'full page');
  assert.equal(a.contentKind, 'page');
});

test('corpus puts page text first and respects the size cap', () => {
  const l = new Ledger();
  l.add('https://a.com', 'snip', ['only a snippet'], 'b');
  const p = l.add('https://b.com', 'page', [], 'b');
  l.setContent(p, 'x'.repeat(100), 'page');
  const out = corpus(l.sources, 10_000);
  assert.ok(out.indexOf('[2]') < out.indexOf('[1]'));
  assert.ok(corpus(l.sources, 50).length <= 50);
});

test('parseJson finds the object inside fences and prose', () => {
  assert.deepEqual(parseJson('Sure:\n```json\n{"a": [1, "}"]}\n```'), { a: [1, '}'] });
  assert.deepEqual(parseJson('here {"b": {"c": 2}} trailing'), { b: { c: 2 } });
  assert.equal(stripThinking('<think>hmm</think> {"x":1}'), '{"x":1}');
});

test('Budget refuses the call past the cap and does not count a quota refusal', async () => {
  const budget = new Budget(2);
  const ok = (async () => ({ results: [], usage: { credits: 2 } })) as any;
  const quota = (async () => { throw Object.assign(new Error('every Tavily key is out of credits'), { code: 'quota' }); }) as any;
  await assert.rejects(budgetedCall(budget, 'search', { query: 'q' }, 'refused', quota));
  assert.equal(budget.used, 0);
  await budgetedCall(budget, 'search', { query: 'q' }, 'one', ok);
  await budgetedCall(budget, 'search', { query: 'q' }, 'two', ok);
  assert.equal(budget.used, 2);
  assert.equal(budget.credits, 4);
  await assert.rejects(budgetedCall(budget, 'search', { query: 'q' }, 'three', ok), BudgetSpent);
});

test('toHit keeps the profile name and dates every job, current or former', async () => {
  const { toHit } = await import('./companydive-people.ts');
  const hit = toHit({
    url: 'https://my.linkedin.com/in/x', title: 'X - HR at Eternalgy', highlights: ['HR at Eternalgy Sdn Bhd'],
    entities: [{ type: 'person', properties: { name: 'Yeap Elise', location: 'Johor', workHistory: [
      { title: 'Human Resources', company: { name: 'Eternalgy Sdn Bhd' }, dates: { from: '2025-01' } },
      { title: 'Clerk', company: { name: 'Old Co' }, dates: { from: '2020-01', to: '2024-12' } },
    ] } }],
  });
  assert.equal(hit.name, 'Yeap Elise');
  assert.deepEqual(hit.jobs, ['Human Resources at Eternalgy Sdn Bhd (2025-01 to now)', 'Clerk at Old Co (2020-01 to 2024-12)']);
  assert.match(hit.text, /HR at Eternalgy/);
});

test('fallbackQueries searches people under the legal name and every alias', async () => {
  const { fallbackQueries } = await import('./companydive-people.ts');
  const qs = fallbackQueries({
    id: 1, company: 'Eternalgy Sdn Bhd', country: 'Malaysia',
    result: { identity: { legal_name: 'ETERNALGY SDN. BHD.', aliases: ['Eternalgy', '恒浩能源'], industry: 'solar PV EPC' } },
  } as any);
  assert.deepEqual(qs.filter((q) => q.kind === 'people').length, 3);
  assert.ok(qs.some((q) => q.kind === 'web' && /director/.test(q.query)));
});

test('publicView shows only cited sources and no internal call details', async () => {
  const { publicView } = await import('./companydive.ts');
  const view = publicView({
    id: 3, public_id: 'abcdefghijklmnopqrst', options: { people: true }, company: 'Eternalgy Sdn Bhd', country: 'Malaysia',
    status: 'running', stage: 'people', error: 'hidden while running', log: [{ at: '2026-10-25T09:00:00Z', stage: 'write', msg: 'Writing' }],
    dossier: '# Eternalgy\n\nSummary [1].', tavily_calls: 14, tavily_credits: 37, brave_calls: 8, llm_calls: 6,
    created_at: '2026-10-25T09:00:00Z', finished_at: null,
    result: {
      identity: { legal_name: 'ETERNALGY SDN. BHD.' }, facts: [{ topic: 'identity', fact: 'f', sources: [1], confidence: 'high' }],
      contradictions: [], gaps: [], warnings: [], braveCalls: 8, llm: [], tavily: [{ n: 1, path: 'search', label: 'T1', credits: 2, ms: 1, ok: true }],
      sources: [
        { id: 1, url: 'https://a.my', title: 'A', contentKind: 'page', found: ['brave:exact'], relevant: true },
        { id: 2, url: 'https://b.my', title: 'B', contentKind: 'none', found: ['brave:exact'], relevant: false },
      ],
      people: { status: 'running', people: [], rejected: [{ name: 'x', reason: 'y' }], exa: [{}, {}], log: [] },
    } as any,
  });
  assert.deepEqual((view.sources as any[]).map((s) => s.id), [1]);
  assert.equal(view.error, null);
  assert.equal((view.people as any).rejected, 1);
  assert.equal((view.people as any).exa_calls, 2);
  assert.equal('tavily' in view, false);
});

test('reportPage embeds the data so a </script> in the log cannot end the tag', async () => {
  const { reportPage } = await import('./companydive-report.ts');
  const html = reportPage({ company: 'X', status: 'running', stage: 'read', log: [{ at: 'now', stage: 'read', msg: '</script><b>x' }] }, 'abcdefghijklmnopqrst');
  assert.equal(html.includes('</script><b>x'), false);
  assert.match(html, /data-id="abcdefghijklmnopqrst"/);
  assert.match(reportPage(null, 'abcdefghijklmnopqrst'), /Report not found/);
});

test('a running dive pauses contact research for at most LANE_HOLD_MS, then lets it go on', () => {
  const now = Date.now();
  setRunningForTests(null);
  assert.equal(diveRunning(now), false);
  setRunningForTests(now - 5 * 60_000);
  assert.equal(diveRunning(now), true);
  setRunningForTests(now - LANE_HOLD_MS - 1);
  assert.equal(diveRunning(now), false);
  setRunningForTests(null);
});
