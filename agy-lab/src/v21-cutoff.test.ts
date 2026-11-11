// askLanes: a cut-off answer is never thrown away. Fake fetch, no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { askLanes, closeCutJson, parseAnswer, type Lane } from './v21/judge.ts';

const lane = (n: number): Lane => ({ label: `L${n}`, url: `http://fake/${n}`, key: 'k', model: `m${n}` });
const body = (text: string, finish = 'stop') => ({ choices: [{ message: { content: text }, finish_reason: finish }] });

function fakeFetch(answers: Record<number, any>) {
  const sent: any[] = [];
  const orig = globalThis.fetch;
  globalThis.fetch = (async (url: string, init: any) => {
    sent.push(JSON.parse(init.body));
    const n = Number(String(url).split('/')[3]);
    return { ok: true, status: 200, text: async () => '', json: async () => answers[n] } as any;
  }) as any;
  return { sent, restore: () => { globalThis.fetch = orig; } };
}

const CUT = '{"items": [{"name": "Ann Lee", "quote": "a, b"}, {"name": "Bo Tan", "quote": "x\\"y"}, {"name": "Cut Of';
const accept = (t: string) => { if (!Array.isArray(parseAnswer(t).items)) throw new Error('no items'); };

test('closeCutJson keeps every whole item and drops only the unfinished one', () => {
  const j = JSON.parse(closeCutJson(CUT)!);
  assert.deepEqual(j.items.map((x: any) => x.name), ['Ann Lee', 'Bo Tan']);
  assert.equal(j.items[1].quote, 'x"y');
  assert.deepEqual(JSON.parse(closeCutJson('```json\n{"a": 1, "b": [1, 2, 3')!), { a: 1, b: [1, 2] });
  assert.deepEqual(JSON.parse(closeCutJson('{"a": {"x": 1}, "b": "half')!), { a: { x: 1 } });
  assert.equal(closeCutJson('{"items": [{"name": "half'), null);
  assert.equal(closeCutJson('no json'), null);
  assert.deepEqual(JSON.parse(closeCutJson('{"a": 1}')!), { a: 1 });
});

test('every lane cut off: the longest kept answer is returned, labelled cut_off', async () => {
  const f = fakeFetch({ 1: body('{"items": [{"name": "A B"}, {"na', 'length'), 2: body(CUT, 'length') });
  try {
    const r = await askLanes([], { lanes: [lane(1), lane(2)], raceAfterMs: 5000, accept });
    assert.equal(r.cut_off, true);
    assert.equal(r.lane, 'L2');
    assert.equal(parseAnswer(r.text).items.length, 2);
    const won = r.attempts.find((a) => a.won)!;
    assert.equal(won.lane, 'L2');
    assert.equal(won.cut_off, true);
    assert.match(r.attempts[0].error!, /cut off/);
  } finally { f.restore(); }
});

test('a later lane with a full answer wins over a kept cut-off answer', async () => {
  const f = fakeFetch({ 1: body(CUT, 'length'), 2: body('{"items": [{"name": "Full"}]}') });
  try {
    const r = await askLanes([], { lanes: [lane(1), lane(2)], raceAfterMs: 5000, accept });
    assert.equal(r.cut_off, undefined);
    assert.equal(r.lane, 'L2');
    assert.equal(parseAnswer(r.text).items[0].name, 'Full');
  } finally { f.restore(); }
});

test('a cut-off answer with nothing whole in it is a failed lane, as before', async () => {
  const f = fakeFetch({ 1: body('{"items": [{"name": "half', 'length') });
  try {
    await assert.rejects(askLanes([], { lanes: [lane(1)], raceAfterMs: 5000, accept }), /cut off/);
  } finally { f.restore(); }
});
