// V2.1 Step 2 on the tidy data: one LLM call, then the plain-code check (check-findings.ts).
// Used when the tidy switch is on; the old path in analyse.ts is untouched.
import { getLlmLanes, type ChatMessage } from './cloud.ts';
import { tidySystemPrompt } from './analyse-prompt.ts';
import { checkJudgement } from './check-findings.ts';
import { renderTidy, type TidyData } from './tidy.ts';
import type { Step2AnalysisOutput } from './analyse.ts';

export const TIDY_PROMPT_VERSION = 'tidy-v1';

/** Dive wait rule (docs/llm-wait-policy.md): slow is fine. A call is only given up if it will never answer (30 min). */
export const DEAD_CALL_MS = 1_800_000;

/** A call still silent after this long is not killed: the same request is also fired on the next lane. */
export const RACE_AFTER_MS = 180_000;

// No max_tokens is sent: each model answers up to its own limit (2026-11-11 probe: every working lane gave 58k-90k
// tokens in full). A cap here cut real answers off and lost them.

export type Lane = { label: string; url: string; key: string; model: string };
export type LaneAttempt = { lane: string; model: string; ms: number; finish_reason?: string; usage?: unknown; error?: string; won?: boolean; cut_off?: boolean };

/**
 * Ask the lanes until one gives a valid answer. A failed call starts the next lane at once; a call that is only slow
 * is never killed: after raceAfterMs the next lane is fired too and the first valid answer wins (the others are aborted).
 * Every call is recorded in attempts.
 *
 * A cut-off answer is never thrown away: it is closed at its last whole item and kept. If no lane gives a full answer,
 * the longest kept one is returned, labelled cut_off (on the result and on its attempt).
 */
export async function askLanes(
  messages: ChatMessage[],
  options: { lanes?: Lane[]; deadCallMs?: number; raceAfterMs?: number; accept?: (text: string) => void } = {},
): Promise<{ text: string; lane: string; model: string; attempts: LaneAttempt[]; cut_off?: boolean }> {
  const lanes: Lane[] = options.lanes ?? ((await getLlmLanes()) as Lane[]);
  const deadMs = options.deadCallMs ?? DEAD_CALL_MS;
  const raceMs = options.raceAfterMs ?? RACE_AFTER_MS;
  const attempts: LaneAttempt[] = [];
  const fail = () => {
    const e: any = new Error(`All LLM lanes failed (${attempts.map((a) => `${a.lane}: ${a.error}`).join('; ') || 'no lanes enabled'})`);
    e.attempts = attempts;
    return e;
  };
  if (!lanes.length) throw fail();

  return new Promise((resolve, reject) => {
    const running = new Map<number, { ctl: AbortController; t0: number }>();
    let next = 0;
    let done = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // The best cut-off answer so far (closed at its last whole item), used only if no lane gives a full answer.
    let kept: { text: string; lane: string; model: string; at: number } | null = null;

    const armRace = () => {
      clearTimeout(timer);
      if (done || next >= lanes.length) return;
      timer = setTimeout(launch, raceMs);
    };
    const settleCall = (i: number, entry: LaneAttempt) => {
      running.delete(i);
      attempts.push(entry);
    };
    const afterFailure = () => {
      if (done) return;
      if (next < lanes.length) launch();
      else if (!running.size) {
        done = true;
        clearTimeout(timer);
        if (kept) {
          attempts[kept.at] = { ...attempts[kept.at]!, won: true, cut_off: true };
          resolve({ text: kept.text, lane: kept.lane, model: kept.model, attempts, cut_off: true });
        } else reject(fail());
      }
    };

    async function call(i: number) {
      const lane = lanes[i];
      const { ctl, t0 } = running.get(i)!;
      const base = () => ({ lane: lane.label, model: lane.model, ms: Date.now() - t0 });
      try {
        const res = await fetch(`${lane.url}/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${lane.key}` },
          body: JSON.stringify({
            model: lane.model,
            messages,
            temperature: 0.1,
            response_format: { type: 'json_object' },
          }),
          signal: AbortSignal.any([ctl.signal, AbortSignal.timeout(deadMs)]),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 150)}`);
        const data: any = await res.json();
        if (done || !running.has(i)) return; // lost the race while reading
        const text = data?.choices?.[0]?.message?.content;
        const finish = data?.choices?.[0]?.finish_reason;
        const meta = { finish_reason: finish, usage: data?.usage };
        try {
          if (typeof text !== 'string' || !text.trim()) throw new Error('empty answer');
          // A cut-off answer: its whole items are kept, and the next lane is asked for a full answer.
          if (finish === 'length') {
            const closed = closeCutJson(text);
            let usable = false;
            if (closed) { try { options.accept?.(closed); usable = true; } catch { /* nothing whole in it */ } }
            if (usable && (!kept || closed!.length > kept.text.length)) kept = { text: closed!, lane: lane.label, model: lane.model, at: attempts.length };
            throw new Error(`answer cut off at the model's limit (${text.length} chars)${usable ? '; its whole items are kept in case no lane answers in full' : ''}`);
          }
          options.accept?.(text);
        } catch (err: any) {
          settleCall(i, { ...base(), ...meta, error: err.message });
          return afterFailure();
        }
        settleCall(i, { ...base(), ...meta, won: true });
        done = true;
        clearTimeout(timer);
        for (const [j, r] of [...running]) {
          const l = lanes[j];
          settleCall(j, { lane: l.label, model: l.model, ms: Date.now() - r.t0, error: 'lost the race (aborted)' });
          r.ctl.abort();
        }
        resolve({ text: text.trim(), lane: lane.label, model: lane.model, attempts });
      } catch (err: any) {
        if (done || !running.has(i)) return;
        const msg = err?.name === 'TimeoutError' ? `no answer in ${deadMs / 1000}s` : String(err?.cause?.code || err?.message || err);
        settleCall(i, { ...base(), error: msg });
        afterFailure();
      }
    }

    function launch() {
      if (done || next >= lanes.length) return;
      const i = next++;
      running.set(i, { ctl: new AbortController(), t0: Date.now() });
      void call(i);
      armRace();
    }
    launch();
  });
}

/**
 * A cut-off JSON answer closed at its last whole value: an unfinished item at the end is dropped, everything before
 * it is kept. Null when not one whole value came back.
 */
export function closeCutJson(text: string): string | null {
  const s = String(text ?? '').trim().replace(/^```(?:json)?\s*/i, '');
  const start = s.indexOf('{');
  if (start < 0) return null;
  const open: string[] = [];
  let inStr = false, esc = false, cut = -1, cutOpen: string[] = [];
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '{') open.push('}');
    else if (c === '[') open.push(']');
    else if (c === '}' || c === ']') {
      open.pop();
      if (!open.length) return s.slice(start, i + 1); // it was whole after all
      cut = i + 1; cutOpen = [...open];
    } else if (c === ',') { cut = i; cutOpen = [...open]; }
  }
  return cut < 0 ? null : s.slice(start, cut) + cutOpen.reverse().join('');
}

/**
 * The JSON object in the answer. Text the model wrote around it ("Here is the JSON:", a ```json fence, a closing
 * note) is set aside, never a reason to throw the answer away. Throws only when there is no JSON object in it at all.
 */
export function parseAnswer(text: string): any {
  const s = String(text ?? '');
  const a = s.indexOf('{');
  const b = s.lastIndexOf('}');
  if (a < 0 || b < a) throw new Error(`answer is not a JSON object, none in it (length ${s.length})`);
  return JSON.parse(s.slice(a, b + 1));
}

export async function judgeTidy(
  tidy: TidyData,
  options: { lanes?: Lane[]; deadCallMs?: number } = {},
): Promise<Step2AnalysisOutput> {
  const t0 = Date.now();
  const input = tidy.input;
  const isKorean = /korea/i.test(input.country);
  const messages: ChatMessage[] = [
    { role: 'system', content: tidySystemPrompt(input, isKorean) },
    { role: 'user', content: renderTidy(tidy) + '\n\nJudge the evidence now under the rules. Return the JSON object only.' },
  ];
  const base = {
    version: '2.1' as const,
    stage: 2 as const,
    created_at: new Date().toISOString(),
    input,
    skip_reason: null,
    could_not_check: tidy.could_not_check,
  };
  const emptyBaseline = {
    official_domain: tidy.official.domain,
    pages_present: tidy.official.pages.map((p) => p.label),
    brand_names: [input.company],
    legal_names: [],
    phones: [],
    addresses: [],
  };

  let answer: Awaited<ReturnType<typeof askLanes>> | null = null;
  let attempts: LaneAttempt[] = [];
  try {
    answer = await askLanes(messages, { ...options, accept: (text) => void parseAnswer(text) });
    attempts = answer.attempts;
    const llm = parseAnswer(answer.text);
    const checked = checkJudgement(llm, tidy);
    const b = llm?.baseline_summary ?? {};
    const list = (v: unknown) => (Array.isArray(v) ? v.map(String) : []);
    return {
      ...base,
      status: 'analyzed',
      error: null,
      baseline: {
        ...emptyBaseline,
        brand_names: list(b.brand_names).length ? list(b.brand_names) : [input.company],
        legal_names: list(b.legal_names),
        phones: list(b.phones),
        addresses: list(b.addresses),
        claimed_credentials: list(b.claimed_credentials),
      },
      findings: checked.findings,
      rejected_findings: checked.rejected,
      dropped_namesakes: checked.dropped_namesakes,
      stats: {
        findings_count: checked.findings.length,
        rejected_count: checked.rejected.length,
        dropped_namesakes_count: checked.dropped_namesakes.length,
        could_not_check_count: tidy.could_not_check.length,
        llm_calls: attempts.length,
        duration_ms: Date.now() - t0,
      },
      meta: { prompt: TIDY_PROMPT_VERSION, lane: answer.lane, model: answer.model, attempts },
      llm_raw: answer.text,
    };
  } catch (err: any) {
    attempts = attempts.length ? attempts : err?.attempts ?? [];
    return {
      ...base,
      status: 'failed',
      error: `LLM analysis failed: ${err?.message ?? err}`,
      baseline: emptyBaseline,
      findings: [],
      rejected_findings: [],
      dropped_namesakes: [],
      stats: {
        findings_count: 0,
        rejected_count: 0,
        dropped_namesakes_count: 0,
        could_not_check_count: tidy.could_not_check.length,
        llm_calls: attempts.length,
        duration_ms: Date.now() - t0,
      },
      meta: { prompt: TIDY_PROMPT_VERSION, lane: answer?.lane ?? null, model: answer?.model ?? null, attempts },
      llm_raw: answer?.text ?? null,
    };
  }
}
