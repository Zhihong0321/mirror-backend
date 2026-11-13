// A paid-report LLM call that is slow is never killed and restarted (docs/llm-wait-policy.md). After HEDGE_AFTER_MS
// the same request is fired again (the router starts it on the next lane) and the first call keeps running; the first
// answer wins and the others are cancelled.
//
// If nothing has answered by GIVE_UP_MS, the call comes back as an error, which ctx.llm turns into '' plus a warning, so the
// lane uses its own fallback and the report is still written, labelled with what is missing. Before this, a call that
// never answered held the whole run for ever: run 54e339be sat in S5-plan for 2+ hours on 2026-11-13.
import type * as core from '../core/index.ts';

type ChatOpts = Parameters<typeof core.llm.chat>[1];
type ChatAnswer = Awaited<ReturnType<typeof core.llm.chat>>;

/** A call still silent after this long gets a second copy on another lane (the 2026-11-09 owner rule: 3 minutes). */
export const HEDGE_AFTER_MS = 180_000;
/** Calls in flight for one request, the first included. */
export const HEDGE_MAX_CALLS = 3;
/** No call has answered by now: give up on this request. Owner rule 2026-11-13: an API call over 8 minutes is dead. */
export const HEDGE_GIVE_UP_MS = 480_000;

export type Hedge = {
  afterMs?: number; maxCalls?: number; giveUpMs?: number;
  /** Where "second call fired" and "gave up" are told (the hub console). */
  note?: (msg: string) => void;
};

export function hedgedChat(
  chat: (prompt: string, opts: ChatOpts) => Promise<ChatAnswer>,
  prompt: string,
  opts: ChatOpts,
  hedge: Hedge = {},
): Promise<ChatAnswer> {
  const afterMs = hedge.afterMs ?? HEDGE_AFTER_MS;
  const maxCalls = hedge.maxCalls ?? HEDGE_MAX_CALLS;
  const giveUpMs = hedge.giveUpMs ?? HEDGE_GIVE_UP_MS;
  const note = hedge.note ?? (() => {});
  return new Promise<ChatAnswer>((resolve, reject) => {
    const calls: AbortController[] = [];
    let running = 0;
    let done = false;
    let lastError: unknown = null;
    let hedgeTimer: ReturnType<typeof setTimeout> | undefined;
    let giveUpTimer: ReturnType<typeof setTimeout> | undefined;
    const stop = () => {
      done = true;
      clearTimeout(hedgeTimer);
      clearTimeout(giveUpTimer);
      for (const c of calls) c.abort();
    };
    const arm = () => {
      clearTimeout(hedgeTimer);
      if (!done && calls.length < maxCalls) hedgeTimer = setTimeout(fire, afterMs);
    };
    function fire() {
      if (done) return;
      const ctl = new AbortController();
      calls.push(ctl);
      running++;
      if (calls.length > 1) note(`${opts.step}: no answer after ${Math.round(afterMs / 1000)}s, call ${calls.length} of ${maxCalls} fired; the first keeps running`);
      // A throw from chat itself (not a rejected promise) is a failed call like any other.
      let started: Promise<ChatAnswer>;
      try { started = chat(prompt, { ...opts, signal: ctl.signal }); } catch (e) { started = Promise.reject(e); }
      started.then(
        (out) => { if (done) return; if (calls.length > 1) note(`${opts.step}: answered by call ${calls.indexOf(ctl) + 1} of ${calls.length}`); stop(); resolve(out); },
        (err) => {
          running--;
          if (done) return;
          lastError = err;
          // Every call failed on every lane: the router already retried, so give back its error at once.
          if (running === 0) { stop(); reject(lastError); }
        },
      );
      arm();
    }
    giveUpTimer = setTimeout(() => {
      if (done) return;
      note(`${opts.step}: no answer after ${Math.round(giveUpMs / 60_000)} min from ${calls.length} call(s); the lane carries on without it`);
      stop();
      reject(Object.assign(new Error(`no answer from any of ${calls.length} call(s) within ${Math.round(giveUpMs / 60_000)} min`), { code: 'timeout' }));
    }, giveUpMs);
    fire();
  });
}
