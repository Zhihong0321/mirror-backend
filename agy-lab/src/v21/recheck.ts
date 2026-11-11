// V2.1 Step 2, Stage 3 — the recheck. One more LLM call reads the same tidy input, the same rules and the judge's
// findings, and says per finding: keep, fix or remove (with the problems it found). It may add findings the judge
// missed. Everything it returns goes through the same plain-code check (check-findings.ts) as the judge's answer.
// If the recheck fails, the judge's report stands unchanged.
import type { ChatMessage } from './cloud.ts';
import { tidySystemPrompt } from './analyse-prompt.ts';
import { checkJudgement, type RejectedFinding } from './check-findings.ts';
import { askLanes, parseAnswer, type Lane, type LaneAttempt } from './judge.ts';
import { renderTidy, type TidyData } from './tidy.ts';
import type { AnalysisFinding, Step2AnalysisOutput } from './analyse.ts';

export const RECHECK_PROMPT_VERSION = 'recheck-v1';

export type Verdict = 'keep' | 'fix' | 'remove';
export type Review = { finding_id: string; verdict: Verdict; problems: string[] };

export type RecheckResult = {
  status: 'rechecked' | 'failed' | 'skipped';
  error: string | null;
  reviews: Review[];
  /** Judge findings the recheck removed, with its problems. */
  removed: Array<{ finding: AnalysisFinding; problems: string[] }>;
  /** Titles of findings the recheck added (they are also in the final findings). */
  added: string[];
  /** Fixed or added findings that failed the plain-code check. */
  rejected: RejectedFinding[];
  meta: { prompt: string; lane: string | null; model: string | null; attempts: LaneAttempt[]; duration_ms: number };
  llm_raw: string | null;
};

function recheckInstructions(isKorean: boolean): string {
  return `

=== YOUR JOB NOW: CHECKER ===
You are not the judge. A judge already applied the rules above to the input and wrote the findings in section F. Check that report like a strict reviewer whose name goes on it. For EVERY finding in section F, re-read the cited item and the official site yourself and answer:
1. Identity: is the cited item really this company? Not a namesake, not a related/sister company (rule 3), not a branch being compared with the head office (rule 4)? Read the item's own details (names, city, regional office, domain), not the judge's justification.
2. Proof: does the quoted text prove the finding itself, not only who the company is? (A quote that only shows the person or company exists does not prove an award or a membership.)
3. Facts: is every fact in title, claim, outside_source and identity_justification exactly what the input says? Check names, numbers, places, dates one by one.
4. Rules: is it a finding at all under the rules (not-found, data-broker estimates, formatting differences, related companies, branches, outside means outside)? Is the type right? Is the confidence right under rule 9?
Verdicts: "keep" (all four pass), "fix" (a real finding with a wrong field: give the whole corrected finding), "remove" (fails identity, proof or the rules). List the problems you found for every verdict other than "keep".
Then look through the input for real findings the judge missed that pass every rule, and add them in "missed". Do not add anything doubtful: an empty list is fine.
${isKorean ? 'Write problems and any changed text in Korean; quotes stay exactly as in the input.' : 'Write in English; quotes stay exactly as in the input.'}

OUTPUT: one JSON object only:
{
  "reviews": [
    { "finding_id": "f1", "verdict": "keep | fix | remove", "problems": ["..."], "fixed": { ...the full corrected finding, same fields as the judge's, only when verdict is fix } }
  ],
  "missed": [ { ...a finding with the same fields as the judge's... } ]
}`;
}

function renderFindings(findings: AnalysisFinding[]): string {
  const lines = [`\n## F. THE JUDGE'S FINDINGS (${findings.length}) — check every one`];
  for (const f of findings) lines.push(JSON.stringify(f, null, 1));
  if (!findings.length) lines.push('(none: the judge found nothing; only look for missed findings)');
  return lines.join('\n');
}

/** Apply the checker's answer to the judge's findings. Pure: no LLM, no files. Anything malformed is ignored, so a bad
 * answer can only leave a judge finding as it was, never invent one past the code check. */
export function applyRecheck(
  judge: Pick<Step2AnalysisOutput, 'findings' | 'dropped_namesakes'>,
  answer: any,
  tidy: TidyData,
): Pick<RecheckResult, 'reviews' | 'removed' | 'added' | 'rejected'> & { findings: AnalysisFinding[] } {
  const byId = new Map(judge.findings.map((f) => [f.id, f]));
  const reviews: Review[] = [];
  const fixedById = new Map<string, any>();
  for (const r of Array.isArray(answer?.reviews) ? answer.reviews : []) {
    const id = String(r?.finding_id ?? '');
    const verdict = r?.verdict as Verdict;
    if (!byId.has(id) || !['keep', 'fix', 'remove'].includes(verdict) || reviews.some((x) => x.finding_id === id)) continue;
    if (verdict === 'fix' && (!r.fixed || typeof r.fixed !== 'object')) continue; // a fix without the fixed finding is no fix
    reviews.push({ finding_id: id, verdict, problems: (Array.isArray(r.problems) ? r.problems : []).map(String) });
    if (verdict === 'fix') fixedById.set(id, r.fixed);
  }

  const removed: RecheckResult['removed'] = [];
  const candidates: any[] = [];
  for (const f of judge.findings) {
    const rv = reviews.find((r) => r.finding_id === f.id);
    if (rv?.verdict === 'remove') removed.push({ finding: f, problems: rv.problems });
    else if (rv?.verdict === 'fix') candidates.push({ ...f, ...fixedById.get(f.id) });
    else candidates.push(f); // keep, or not reviewed
  }
  const missed = (Array.isArray(answer?.missed) ? answer.missed : []).filter((m: any) => m && typeof m === 'object');
  const missedTitles = new Set(missed.map((m: any) => String(m.title ?? '').trim()));

  // The same plain-code check as the judge's answer, with the judge's dropped namesakes.
  const checked = checkJudgement(
    { findings: [...candidates, ...missed], dropped_namesakes: judge.dropped_namesakes },
    tidy,
  );
  return {
    findings: checked.findings,
    reviews,
    removed,
    added: checked.findings.filter((f) => missedTitles.has(f.title)).map((f) => f.title),
    rejected: checked.rejected,
  };
}

export async function recheckTidy(
  tidy: TidyData,
  judge: Step2AnalysisOutput,
  options: { lanes?: Lane[]; deadCallMs?: number } = {},
): Promise<{ result: RecheckResult; findings: AnalysisFinding[] }> {
  const t0 = Date.now();
  const meta = (attempts: LaneAttempt[], lane: string | null = null, model: string | null = null) => ({
    prompt: RECHECK_PROMPT_VERSION, lane, model, attempts, duration_ms: Date.now() - t0,
  });
  if (judge.status !== 'analyzed') {
    return {
      result: { status: 'skipped', error: `judge status ${judge.status}`, reviews: [], removed: [], added: [], rejected: [], meta: meta([]), llm_raw: null },
      findings: judge.findings,
    };
  }
  const isKorean = /korea/i.test(tidy.input.country);
  const messages: ChatMessage[] = [
    { role: 'system', content: tidySystemPrompt(tidy.input, isKorean) + recheckInstructions(isKorean) },
    { role: 'user', content: renderTidy(tidy) + '\n' + renderFindings(judge.findings) + '\n\nCheck the report now. Return the JSON object only.' },
  ];
  let answer: Awaited<ReturnType<typeof askLanes>> | null = null;
  try {
    answer = await askLanes(messages, { ...options, accept: (text) => void parseObject(text) });
    const applied = applyRecheck(judge, parseObject(answer.text), tidy);
    return {
      result: {
        status: 'rechecked',
        error: null,
        reviews: applied.reviews,
        removed: applied.removed,
        added: applied.added,
        rejected: applied.rejected,
        meta: meta(answer.attempts, answer.lane, answer.model),
        llm_raw: answer.text,
      },
      findings: applied.findings,
    };
  } catch (err: any) {
    return {
      result: {
        status: 'failed',
        error: `Recheck failed: ${err?.message ?? err}`,
        reviews: [], removed: [], added: [], rejected: [],
        meta: answer ? meta(answer.attempts, answer.lane, answer.model) : meta(err?.attempts ?? []),
        llm_raw: answer?.text ?? null, // the checker's answer is kept even when applying it failed
      },
      findings: judge.findings, // the judge's report stands
    };
  }
}

/** Same reader as Step 2: text around the JSON object is set aside, never a reason to throw the answer away. */
const parseObject = (text: string): any => parseAnswer(text);
