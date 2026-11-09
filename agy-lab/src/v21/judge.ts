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

/** Room for the model's reasoning plus the JSON answer (8192 cut a real answer off mid-JSON). */
export const MAX_TOKENS = 16_384;

export type Lane = { label: string; url: string; key: string; model: string };
export type LaneAttempt = { lane: string; model: string; ms: number; finish_reason?: string; usage?: unknown; error?: string; won?: boolean };

/**
 * Ask the lanes until one gives a valid answer. A failed call starts the next lane at once; a call that is only slow
 * is never killed: after raceAfterMs the next lane is fired too and the first valid answer wins (the others are aborted).
 * Every call is recorded in attempts.
 */
export async function askLanes(
  messages: ChatMessage[],
  options: { lanes?: Lane[]; deadCallMs?: number; raceAfterMs?: number; maxTokens?: number; accept?: (text: string) => void } = {},
): Promise<{ text: string; lane: string; model: string; attempts: LaneAttempt[] }> {
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
        reject(fail());
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
            max_tokens: options.maxTokens ?? MAX_TOKENS,
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
          // A cut-off or unreadable answer is this lane failing: the next lane gets the call.
          if (finish === 'length') throw new Error(`answer cut off at the token limit (${text.length} chars)`);
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

/** The JSON object in the answer (a ```json fence is allowed). */
export function parseAnswer(text: string): any {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  if (!cleaned.startsWith('{') || !cleaned.endsWith('}')) throw new Error(`answer is not a JSON object (length ${text.length})`);
  return JSON.parse(cleaned);
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
