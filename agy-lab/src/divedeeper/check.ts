import { readFileSync } from 'node:fs';

// Hosts of governments and registers, as regex sources in a list so a new country is one line (government-hosts.json).
const GOVERNMENT_HOSTS = (JSON.parse(readFileSync(new URL('./government-hosts.json', import.meta.url), 'utf8')) as string[]).map((p) => new RegExp(p, 'i'));
// The two rechecks (docs/g-search-lane-design.md has the background; the owner asked for them 2026-11-08).
//
//   S1-recheck  runs before the writing stages. One prompt reads the findings that an LLM itself judged (K, N, H-web, R-contacts,
//               B-brand, and C-merged's copy-edit findings) and marks each real, weak or false. editor.ts items() then drops the
//               false ones and lowers the weak ones, so S2 to S5 and the report all see the same list.
//   S6-check    runs after S5. One prompt reads every statement the analysis (S4) and the plan (S5) wrote against the findings and
//               the measured facts, and marks each supported or unsupported. applyCheck() below withdraws the unsupported ones
//               when the report is built.
//
// Both only ever REMOVE or LOWER. A recheck that fails to answer changes nothing. A recheck that condemns more than MAX_SHARE of
// what it was asked about is not believed: its verdicts are ignored and the lane warns.
export const MAX_SHARE = 0.4;
/** Fewer than this many items: the share rule does not apply (one of two is not a pattern). */
export const MIN_FOR_SHARE = 5;

/** Lanes whose findings come from an LLM's judgement. Mechanical lanes and register results are never rechecked. */
export const JUDGED_LANES = ['K-credibility', 'N-news', 'H-web', 'R-contacts', 'B-brand'];
export const isJudged = (x: { lane: string; check?: string }): boolean => JUDGED_LANES.includes(x.lane) || (x.lane === 'C-merged' && x.check === 'llm');

export type Verdict = 'real' | 'weak' | 'false';
export const VERDICTS: Verdict[] = ['real', 'weak', 'false'];

/** True when the verdicts condemn so much that they cannot be believed. */
export function tooMany(condemned: number, asked: number): boolean {
  return asked >= MIN_FOR_SHARE && condemned / asked > MAX_SHARE;
}

// ---------------------------------------------------------------- S6: the statements the report prints

type Notes = Record<string, any>;
export type Statement = { id: string; kind: string; text: string };

const LIST_KEYS = ['strengths', 'risks', 'opportunities'] as const;
const LIST_KIND = { strengths: 'strength', risks: 'risk', opportunities: 'opportunity' } as const;

/** Every statement the analysis and the plan make, each with a path-like id that applyCheck understands. */
export function statements(an: Notes | undefined, plan: Notes | undefined): Statement[] {
  const out: Statement[] = [];
  if (an?.verdict) out.push({ id: 'verdict', kind: 'verdict', text: String(an.verdict) });
  (an?.stories ?? []).forEach((s: any, i: number) => out.push({ id: `stories.${i}`, kind: 'story', text: [s.headline, s.body, s.cost, s.fix].filter(Boolean).join(' ') }));
  (an?.parts ?? []).forEach((p: any, i: number) => out.push({ id: `parts.${i}`, kind: 'part assessment', text: String(p.assessment ?? '') }));
  (an?.threads ?? []).forEach((t: any, i: number) => out.push({ id: `threads.${i}`, kind: 'thread', text: `${t.title}: ${t.body}` }));
  for (const k of LIST_KEYS) (an?.[k] ?? []).forEach((line: string, i: number) => out.push({ id: `${k}.${i}`, kind: LIST_KIND[k], text: String(line) }));
  (an?.mismatch ?? []).forEach((m: any, i: number) => out.push({ id: `mismatch.${i}`, kind: 'mismatch', text: String(m.issue ?? '') }));
  for (const d of plan?.depts ?? []) (d.tasks ?? []).forEach((t: any, i: number) => out.push({ id: `task.${d.dept}.${i}`, kind: 'task', text: [t.task, t.why, t.how].filter(Boolean).join(' ') }));
  return out.filter((s) => s.text.trim());
}

/** A finding backed by a source that is not the company itself: tagged independent, or a register / government / RDAP result. */
export function isIndependentFinding(lane: string, f: any): boolean {
  if (f?.party) return f.party === 'independent';
  const host = (() => { try { return new URL(String(f?.source)).hostname; } catch { return ''; } })();
  return lane === 'D-registry' || GOVERNMENT_HOSTS.some((re) => re.test(host));
}

/**
 * The lanes with the statements S6-check found unsupported taken out. The input is not changed. A task that is withdrawn puts the
 * findings it covered back under its department's "more findings" list, so nothing urgent drops out of the plan.
 */
export function applyCheck<T extends Record<string, any>>(L: T): T {
  const unsupported: string[] = (L['S6-check']?.notes?.unsupported ?? []).map((u: any) => String(u?.id)).filter(Boolean);
  if (!unsupported.length || L['S6-check']?.notes?.ignored) return L;
  const drop = new Set(unsupported);
  const out: Record<string, any> = { ...L };
  const an = L['S4-analysis']?.notes;
  if (an) {
    const notes: Notes = { ...an };
    if (drop.has('verdict')) notes.verdict = null;
    for (const k of ['stories', 'parts', 'threads', 'mismatch', ...LIST_KEYS] as const) {
      if (Array.isArray(an[k])) notes[k] = an[k].filter((_: unknown, i: number) => !drop.has(`${k}.${i}`));
    }
    out['S4-analysis'] = { ...L['S4-analysis'], notes };
  }
  const plan = L['S5-plan']?.notes;
  if (plan?.depts) {
    const depts = plan.depts.map((d: any) => {
      const gone = (d.tasks ?? []).filter((_: unknown, i: number) => drop.has(`task.${d.dept}.${i}`));
      if (!gone.length) return d;
      const kept = (d.tasks ?? []).filter((_: unknown, i: number) => !drop.has(`task.${d.dept}.${i}`));
      const covered = new Set(kept.flatMap((t: any) => t.items ?? []));
      const back = gone.flatMap((t: any) => (t.items ?? []).filter((key: string) => !covered.has(key)).map((key: string) => ({ dept: d.dept, key, severity: t.impact === 'high' ? 'high' : 'medium', theme: t.theme })));
      return { ...d, tasks: kept, also: [...(d.also ?? []), ...back] };
    });
    out['S5-plan'] = { ...L['S5-plan'], notes: { ...plan, depts } };
  }
  return out as T;
}
