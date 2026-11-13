import test from 'node:test';
import assert from 'node:assert/strict';
import { hedgedChat } from './hedge.ts';
import { chat, resetForTests, setLanesForTests, busyFor } from '../core/llm.ts';
import type { ChatAnswer, ChatOpts } from '../core/llm.ts';

const answer = (text: string): ChatAnswer => ({ answer: text, model: 'm', lane: 'l', ms: 1, tokensIn: 0, tokensOut: 0 });
const opts = { step: 'action plan' } as ChatOpts;
/** A call that never answers; it ends only when its signal aborts. */
const hangs = (opts: ChatOpts) => new Promise<ChatAnswer>((_, reject) => opts.signal!.addEventListener('abort', () => reject(Object.assign(new Error('cancelled'), { code: 'aborted' }))));

test('a fast answer fires no second call', async () => {
  let calls = 0;
  const out = await hedgedChat(async () => { calls++; return answer('a'); }, 'p', opts, { afterMs: 30, giveUpMs: 500 });
  await new Promise((r) => setTimeout(r, 80));
  assert.equal(out.answer, 'a');
  assert.equal(calls, 1);
});

test('a call that never answers is raced by a second one; the first keeps running until the second wins, then it is cancelled', async () => {
  const seen: Array<{ signal: AbortSignal }> = [];
  const notes: string[] = [];
  const chatFn = (_p: string, o: ChatOpts) => {
    seen.push({ signal: o.signal! });
    return seen.length === 1 ? hangs(o) : Promise.resolve(answer('second'));
  };
  const out = await hedgedChat(chatFn, 'p', opts, { afterMs: 30, giveUpMs: 2000, note: (m) => notes.push(m) });
  assert.equal(out.answer, 'second');
  assert.equal(seen.length, 2);
  assert.equal(seen[0]!.signal.aborted, true, 'the loser is cancelled');
  assert.match(notes.join('\n'), /call 2 of 3 fired; the first keeps running/);
});

test('the first call may still win after the second was fired (nothing is killed)', async () => {
  let n = 0;
  const chatFn = async (_p: string, o: ChatOpts) => {
    n++;
    if (n === 1) { await new Promise((r) => setTimeout(r, 60)); return answer('first'); }
    return hangs(o);
  };
  const out = await hedgedChat(chatFn, 'p', opts, { afterMs: 20, giveUpMs: 2000 });
  assert.equal(out.answer, 'first');
});

test('no call answers: after the give-up time it comes back as an error, every call cancelled, never waits for ever', async () => {
  const ctls: AbortSignal[] = [];
  const t0 = Date.now();
  await assert.rejects(
    hedgedChat((_p, o) => { ctls.push(o.signal!); return hangs(o); }, 'p', opts, { afterMs: 20, giveUpMs: 150, maxCalls: 3 }),
    (e: any) => e.code === 'timeout' && /3 call\(s\)/.test(e.message),
  );
  assert.ok(Date.now() - t0 < 1000);
  assert.equal(ctls.length, 3);
  assert.ok(ctls.every((s) => s.aborted));
});

test('every call failing gives the error back at once, not after the give-up time', async () => {
  const t0 = Date.now();
  await assert.rejects(hedgedChat(async () => { throw new Error('all lanes failed'); }, 'p', opts, { afterMs: 500, giveUpMs: 5000 }), /all lanes failed/);
  assert.ok(Date.now() - t0 < 300);
});

test('the router: a stream that sends reasoning for ever (never trips the idle check) is cancelled by the signal and frees its lane slot', async () => {
  resetForTests();
  const lane = { url: 'https://h.example/v1', key: 'h', model: 'deepseek-v4.1-flash-1017', label: 'Hive' };
  setLanesForTests([lane]);
  let pinger: NodeJS.Timeout | undefined;
  // The 2026-11-13 stall: answer-shaped data keeps arriving, so the idle check never fires, and the answer never ends.
  const runaway = () => new Response(new ReadableStream({
    start(c) { pinger = setInterval(() => { try { c.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"reasoning_content":"hmm "}}]}\n\n')); } catch { clearInterval(pinger); } }, 5); },
    cancel() { clearInterval(pinger); },
  }));
  const ctl = new AbortController();
  try {
    const call = chat('x', { step: 's', fetchImpl: (async () => runaway()) as unknown as typeof fetch, fallback: false, idleMs: 60, signal: ctl.signal });
    await new Promise((r) => setTimeout(r, 200));
    assert.equal(busyFor(lane.key), 1, 'the runaway call holds a slot');
    ctl.abort();
    await assert.rejects(call, (e: any) => e.code === 'aborted');
    assert.equal(busyFor(lane.key), 0, 'its slot is free again');
  } finally {
    clearInterval(pinger);
    resetForTests();
  }
});
