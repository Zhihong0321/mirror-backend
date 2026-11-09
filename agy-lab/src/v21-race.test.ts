// askLanes: a slow call is raced, never killed and restarted. Fake fetch, no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { askLanes, type Lane } from './v21/judge.ts';

type Plan = { delay: number; body?: any; status?: number; throws?: string };
const lane = (n: number): Lane => ({ label: `L${n}`, url: `http://fake/${n}`, key: 'k', model: `m${n}` });
const ok = (text: string, finish = 'stop') => ({ choices: [{ message: { content: text }, finish_reason: finish }] });

/** plans[n] = what lane n does; returns the calls log. */
function fakeFetch(plans: Record<number, Plan>) {
  const calls: { n: number; aborted: boolean }[] = [];
  const orig = globalThis.fetch;
  globalThis.fetch = (async (url: string, init: any) => {
    const n = Number(String(url).split('/')[3]);
    const rec = { n, aborted: false };
    calls.push(rec);
    const p = plans[n];
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(resolve, p.delay);
      init.signal.addEventListener('abort', () => { rec.aborted = true; clearTimeout(t); reject(init.signal.reason); });
    });
    if (p.throws) throw new Error(p.throws);
    return { ok: (p.status ?? 200) < 400, status: p.status ?? 200, text: async () => 'err', json: async () => p.body } as any;
  }) as any;
  return { calls, restore: () => { globalThis.fetch = orig; } };
}

test('slow lane 1 + fast lane 2: lane 2 wins, lane 1 is aborted', async () => {
  const f = fakeFetch({ 1: { delay: 500, body: ok('slow') }, 2: { delay: 10, body: ok('fast') } });
  try {
    const r = await askLanes([], { lanes: [lane(1), lane(2)], raceAfterMs: 50 });
    assert.equal(r.text, 'fast');
    assert.equal(r.lane, 'L2');
    assert.equal(f.calls.find((c) => c.n === 1)!.aborted, true);
    assert.equal(r.attempts.find((a) => a.lane === 'L1')!.error, 'lost the race (aborted)');
    assert.equal(r.attempts.find((a) => a.lane === 'L2')!.won, true);
  } finally { f.restore(); }
});

test('lane 1 answers before the race fires: only one call', async () => {
  const f = fakeFetch({ 1: { delay: 10, body: ok('one') }, 2: { delay: 10, body: ok('two') } });
  try {
    const r = await askLanes([], { lanes: [lane(1), lane(2)], raceAfterMs: 200 });
    assert.equal(r.lane, 'L1');
    assert.equal(f.calls.length, 1);
    assert.equal(r.attempts.length, 1);
  } finally { f.restore(); }
});

test('lane 1 fails fast: lane 2 starts at once, not after the race time', async () => {
  const f = fakeFetch({ 1: { delay: 5, status: 500, body: {} }, 2: { delay: 5, body: ok('two') } });
  try {
    const t0 = Date.now();
    const r = await askLanes([], { lanes: [lane(1), lane(2)], raceAfterMs: 5000 });
    assert.equal(r.lane, 'L2');
    assert.ok(Date.now() - t0 < 1000);
    assert.match(r.attempts[0].error ?? '', /HTTP 500/);
  } finally { f.restore(); }
});

test('lane 1 slow but answers first after lane 2 started: lane 1 wins, lane 2 aborted', async () => {
  const f = fakeFetch({ 1: { delay: 120, body: ok('one') }, 2: { delay: 1000, body: ok('two') } });
  try {
    const r = await askLanes([], { lanes: [lane(1), lane(2)], raceAfterMs: 50 });
    assert.equal(r.lane, 'L1');
    assert.equal(f.calls.length, 2);
    assert.equal(f.calls.find((c) => c.n === 2)!.aborted, true);
  } finally { f.restore(); }
});

test("lane 2's answer rejected by accept: lane 1's later valid answer wins", async () => {
  const f = fakeFetch({ 1: { delay: 200, body: ok('good') }, 2: { delay: 10, body: ok('bad') } });
  try {
    const r = await askLanes([], {
      lanes: [lane(1), lane(2)], raceAfterMs: 50,
      accept: (t) => { if (t === 'bad') throw new Error('not valid'); },
    });
    assert.equal(r.text, 'good');
    assert.equal(r.lane, 'L1');
    assert.ok(r.attempts.some((a) => a.lane === 'L2' && a.error === 'not valid'));
  } finally { f.restore(); }
});

test('a third lane joins only after another race interval; lanes are never fired twice', async () => {
  const f = fakeFetch({ 1: { delay: 1000, body: ok('1') }, 2: { delay: 1000, body: ok('2') }, 3: { delay: 10, body: ok('3') } });
  try {
    const r = await askLanes([], { lanes: [lane(1), lane(2), lane(3)], raceAfterMs: 60 });
    assert.equal(r.lane, 'L3');
    assert.deepEqual(f.calls.map((c) => c.n), [1, 2, 3]);
    assert.equal(r.attempts.filter((a) => a.error === 'lost the race (aborted)').length, 2);
  } finally { f.restore(); }
});

test('cut-off answer fails the lane and the next one is used', async () => {
  const f = fakeFetch({ 1: { delay: 5, body: ok('{"a"', 'length') }, 2: { delay: 5, body: ok('{}') } });
  try {
    const r = await askLanes([], { lanes: [lane(1), lane(2)], raceAfterMs: 5000 });
    assert.equal(r.lane, 'L2');
    assert.match(r.attempts[0].error ?? '', /cut off/);
  } finally { f.restore(); }
});

test('dead-call ceiling gives up one call only', async () => {
  const f = fakeFetch({ 1: { delay: 5000, body: ok('x') }, 2: { delay: 60, body: ok('two') } });
  try {
    const r = await askLanes([], { lanes: [lane(1), lane(2)], raceAfterMs: 50, deadCallMs: 80 });
    assert.equal(r.lane, 'L2');
    assert.match(r.attempts.find((a) => a.lane === 'L1')!.error ?? '', /no answer in/);
  } finally { f.restore(); }
});

test('all lanes fail: error carries every attempt', async () => {
  const f = fakeFetch({ 1: { delay: 5, status: 500, body: {} }, 2: { delay: 5, throws: 'boom' } });
  try {
    await assert.rejects(askLanes([], { lanes: [lane(1), lane(2)], raceAfterMs: 5000 }), (e: any) => {
      assert.match(e.message, /All LLM lanes failed \(L1: HTTP 500.*; L2: boom\)/);
      assert.equal(e.attempts.length, 2);
      return true;
    });
  } finally { f.restore(); }
});
