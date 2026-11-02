import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PRICES, addMeter, diveCalls, diveUsage, emptyUsage, price, startCall } from './cost.ts';

test('a company-dive is priced from its tokens, Tavily credits, Brave and Exa calls', () => {
  const cost = price(diveUsage({
    tavily_calls: 10, tavily_credits: 15, brave_calls: 8,
    llm: [{ step: 'triage', engine: 'deepseek-v4.1-flash-1017', ms: 1, promptChars: 0, answerChars: 0, tokensIn: 600_000, tokensOut: 400_000 }],
    people_exa: [{ dollars: 0.01, ok: true }, { dollars: 0, ok: false }],
  }));
  const deepseek = 100 / 1000 / 7.2;
  // The failed Exa call did no billable work: it is listed, not charged.
  const want = deepseek + 15 * PRICES.tavilyCredit + 8 * PRICES.braveCall + 0.01;
  assert.ok(Math.abs(cost.usd - want) < 1e-9, `${cost.usd} vs ${want}`);
  assert.equal(cost.estimated, false);
  assert.deepEqual(cost.unpriced, []);
  assert.deepEqual(cost.lines.find((l) => l.item === 'Failed calls'), { item: 'Failed calls', detail: '1 call, not billed', usd: 0 });
});

test('every call is kept one by one with its time, tokens and cost', () => {
  const ok = startCall('llm', 'triage', { model: 'deepseek-v4.1-flash-1017' }).done({ ok: true, tokensIn: 600_000, tokensOut: 400_000 });
  assert.ok(Math.abs(ok.usd! - 100 / 1000 / 7.2) < 1e-12);
  assert.match(ok.at, /^\d{4}-\d\d-\d\dT/);
  assert.equal(startCall('llm', 'x', { model: 'pi/MiniMax-M3' }).done({ ok: true, tokensIn: 10, tokensOut: 10 }).usd, null);
  assert.equal(startCall('brave', 'q').done({ ok: false, note: 'HTTP 429' }).usd, 0);
  assert.equal(startCall('exa', 'q').done({ ok: true, usd: 0.022 }).usd, 0.022);
  assert.equal(startCall('maps', 'reviews').done({ ok: true }).usd, PRICES.mapsCall);
});

test('a deeper-dive meter with a call log is priced from the log, retries and failures included', () => {
  const calls = [
    startCall('llm', 'a', { model: 'deepseek-v-a' }).done({ ok: false, note: 'HTTP 429' }),
    startCall('llm', 'a', { model: 'deepseek-v-a' }).done({ ok: false, tokensIn: 50, tokensOut: 5, note: 'empty answer' }),
    startCall('llm', 'a', { model: 'deepseek-v-a' }).done({ ok: true, tokensIn: 100, tokensOut: 20 }),
    startCall('exa', 'q').done({ ok: true, usd: 0.03 }),
    startCall('brave', 'q').done({ ok: true }),
    startCall('web', 'https://x').done({ ok: true }),
  ];
  const u = addMeter(emptyUsage(), { calls, llm: { calls: 99 } as any });
  assert.deepEqual(u.llm['deepseek-v-a'], { calls: 2, tokensIn: 150, tokensOut: 25, estimated: false });
  assert.equal(u.failedCalls, 1);
  assert.equal(u.exaDollars, 0.03);
  assert.equal(u.braveCalls, 1);
  assert.equal(u.httpCalls, 1);
});

test('a company-dive lists its calls oldest first, old ones estimated', () => {
  const calls = diveCalls({
    llm: [
      { step: 'dossier', engine: 'deepseek-v4.1-flash-1017', at: '2026-10-31T01:00:02Z', ms: 5, promptChars: 40, answerChars: 4, tokensIn: 10, tokensOut: 2, ok: true, usd: 0.5 },
      { step: 'triage', engine: 'deepseek-v4.1-flash-1017', ms: 5, promptChars: 4000, answerChars: 400 },
      { step: 'analyse', engine: 'deepseek-v4.1-flash-1017', at: '2026-10-31T01:00:01Z', ms: 5, promptChars: 40, answerChars: 0, ok: false, usd: 0, note: 'HTTP 500' },
    ],
    tavily: [{ at: '2026-10-31T01:00:00Z', path: 'search', label: 'T1', credits: 2, ms: 3, ok: true }],
    brave: [startCall('brave', 'exact: "Acme"').done({ ok: true, results: 20 })],
    people: { exa: [{ query: 'people at Acme', kind: 'people', results: 25, dollars: 0.022, ok: true }] },
  });
  assert.deepEqual(calls.map((c) => c.what), ['triage', 'people: people at Acme', 'T1 (search)', 'analyse', 'dossier', 'exact: "Acme"']);
  assert.deepEqual([calls[0].tokensIn, calls[0].tokensOut, calls[0].note], [1000, 100, 'tokens estimated from text length']);
  assert.equal(calls[1].usd, 0.022);
  assert.equal(calls[2].usd, 2 * PRICES.tavilyCredit);
  assert.equal(calls[3].ok, false);
  assert.equal(calls[4].usd, 0.5);
});

test('calls without reported tokens are estimated from text length and marked', () => {
  const cost = price(diveUsage({ llm: [{ step: 'dossier', engine: 'deepseek-v4.1-flash-1017', ms: 1, promptChars: 4000, answerChars: 400 }] }));
  assert.equal(cost.estimated, true);
  assert.match(cost.lines[0].detail, /1\.0k in \/ 100 out/);
});

test('a model with no price is counted and named, not guessed', () => {
  const cost = price(diveUsage({ llm: [{ step: 'x', engine: 'pi/MiniMax-M2', ms: 1, promptChars: 10, answerChars: 10, tokensIn: 5, tokensOut: 5 }] }));
  assert.equal(cost.usd, 0);
  assert.deepEqual(cost.unpriced, ['pi/MiniMax-M2 (1 call)']);
  assert.equal(cost.lines[0].usd, null);
});

test('deeper-dive meters add up, old ones split tokens by calls', () => {
  const u = emptyUsage();
  addMeter(u, { llm: { calls: 2, failed: 0, promptChars: 0, answerChars: 0, tokensIn: 100, tokensOut: 50, byModel: { 'deepseek-v-a': 2 }, byModelTokens: { 'deepseek-v-a': { in: 100, out: 50 } } },
    maps: { calls: 3, failed: 0, byTool: {} }, exa: { calls: 2, failed: 0, results: 0, priced: 1, dollars: 0.02 }, brave: { calls: 1, failed: 0 }, http: { calls: 4, failed: 0 } });
  addMeter(u, { llm: { calls: 4, tokensIn: 400, tokensOut: 0, byModel: { 'deepseek-v-a': 3, 'gpt-x': 1 } } as any });
  assert.deepEqual(u.llm['deepseek-v-a'], { calls: 5, tokensIn: 400, tokensOut: 50, estimated: true });
  assert.deepEqual(u.llm['gpt-x'], { calls: 1, tokensIn: 100, tokensOut: 0, estimated: true });
  const cost = price(u);
  assert.ok(Math.abs(cost.lines.find((l) => l.item === 'Exa')!.usd! - (0.02 + PRICES.exaSearch)) < 1e-12);
  assert.deepEqual(cost.unpriced, ['gpt-x (1 call)']);
});

test('Hive deepseek has no price on record: counted and named, not priced at the Vectide rate', () => {
  const cost = price(diveUsage({ llm: [{ step: 'x', engine: 'deepseek-ai/deepseek-v4.1-flash-1017', ms: 1, promptChars: 0, answerChars: 0, tokensIn: 10, tokensOut: 10 }] }));
  assert.deepEqual(cost.unpriced, ['deepseek-ai/deepseek-v4.1-flash-1017 (1 call)']);
});
