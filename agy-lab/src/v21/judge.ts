// V2.1 Step 2 on the tidy data: one LLM call, then the plain-code check (check-findings.ts).
// Used when the tidy switch is on; the old path in analyse.ts is untouched.
import { getLlmLanes, type ChatMessage } from './cloud.ts';
import { tidySystemPrompt } from './analyse-prompt.ts';
import { checkJudgement } from './check-findings.ts';
import { renderTidy, type TidyData } from './tidy.ts';
import type { Step2AnalysisOutput } from './analyse.ts';

export const TIDY_PROMPT_VERSION = 'tidy-v1';

/** Dive wait rule (docs/llm-wait-policy.md): slow is fine, only a call that will never answer is given up. */
export const DEAD_CALL_MS = 600_000;

/** Room for the model's reasoning plus the JSON answer (8192 cut a real answer off mid-JSON). */
export const MAX_TOKENS = 16_384;

export type Lane = { label: string; url: string; key: string; model: string };
export type LaneAttempt = { lane: string; model: string; ms: number; finish_reason?: string; usage?: unknown; error?: string };

/** Ask the lanes in turn until one answers with text. Every attempt is recorded, failed or not. */
export async function askLanes(
  messages: ChatMessage[],
  options: { lanes?: Lane[]; deadCallMs?: number; maxTokens?: number; accept?: (text: string) => void } = {},
): Promise<{ text: string; lane: string; model: string; attempts: LaneAttempt[] }> {
  const lanes: Lane[] = options.lanes ?? ((await getLlmLanes()) as Lane[]);
  const attempts: LaneAttempt[] = [];
  for (const lane of lanes) {
    const t0 = Date.now();
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
        signal: AbortSignal.timeout(options.deadCallMs ?? DEAD_CALL_MS),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 150)}`);
      const data: any = await res.json();
      const text = data?.choices?.[0]?.message?.content;
      const finish = data?.choices?.[0]?.finish_reason;
      const meta = { finish_reason: finish, usage: data?.usage };
      try {
        if (typeof text !== 'string' || !text.trim()) throw new Error('empty answer');
        // A cut-off or unreadable answer is this lane failing: the next lane gets the call.
        if (finish === 'length') throw new Error(`answer cut off at the token limit (${text.length} chars)`);
        options.accept?.(text);
      } catch (err: any) {
        attempts.push({ lane: lane.label, model: lane.model, ms: Date.now() - t0, ...meta, error: err.message });
        continue;
      }
      attempts.push({ lane: lane.label, model: lane.model, ms: Date.now() - t0, ...meta });
      return { text: text.trim(), lane: lane.label, model: lane.model, attempts };
    } catch (err: any) {
      const msg = err?.name === 'TimeoutError' ? `no answer in ${(options.deadCallMs ?? DEAD_CALL_MS) / 1000}s` : String(err?.cause?.code || err?.message || err);
      attempts.push({ lane: lane.label, model: lane.model, ms: Date.now() - t0, error: msg });
    }
  }
  const e: any = new Error(`All LLM lanes failed (${attempts.map((a) => `${a.lane}: ${a.error}`).join('; ') || 'no lanes enabled'})`);
  e.attempts = attempts;
  throw e;
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
