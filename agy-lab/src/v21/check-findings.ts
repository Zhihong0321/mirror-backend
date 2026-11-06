// V2.1 Step 2 — plain-code check of the judge's JSON against the tidy data it was given.
// One pure function: Step 2 runs it on DeepSeek's answer, and the Stage 3 checker's answer goes through the same one.
// It checks only what code can know for sure (the item exists, the quote is in it, the type fits the item); it never
// judges meaning. A finding that fails is kept in `rejected` with the reasons, never silently deleted.
import type { TidyData } from './tidy.ts';
import type { AnalysisFinding, DroppedNamesake, FindingCategory, FindingType } from './analyse.ts';

const TYPES: FindingType[] = [
  'contradiction', 'outdated', 'unproven', 'missed_advantage', 'profile_drift', 'staff_review_risk', 'disciplinary_warning', 'other',
];
const CATEGORIES: FindingCategory[] = ['contact', 'identity', 'licence', 'awards', 'reputation', 'registration'];

export type RejectedFinding = { finding: Record<string, unknown>; reasons: string[] };

export type CheckedJudgement = {
  findings: AnalysisFinding[];
  rejected: RejectedFinding[];
  dropped_namesakes: DroppedNamesake[];
};

/** Letters and digits only, lower case: formatting (pipes, bullets, link syntax, spacing) never decides a match. */
function core(s: string): string {
  return String(s ?? '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
}

/** The text and URL of every item the judge may cite, by id. */
export function citableItems(t: TidyData): Map<string, { url: string; text: string; kind: 'E' | 'R' | 'LINKEDIN' }> {
  const items = new Map<string, { url: string; text: string; kind: 'E' | 'R' | 'LINKEDIN' }>();
  for (const e of t.evidence) items.set(e.id, { url: e.url, text: `${e.title ?? ''}\n${e.text}`, kind: 'E' });
  for (const g of t.registers) items.set(g.id, { url: g.url, text: [...g.mentions, ...g.hits].join('\n'), kind: 'R' });
  if (t.own_linkedin) {
    items.set('LINKEDIN', {
      url: t.own_linkedin.linkedin_url || '',
      text: Object.entries(t.own_linkedin).map(([k, v]) => `${k}: ${v}`).join('\n'),
      kind: 'LINKEDIN',
    });
  }
  return items;
}

/** A company page on LinkedIn (linkedin.com/company/<slug>), on any country subdomain. */
export function isLinkedinCompanyUrl(url: string): boolean {
  return /^https?:\/\/([a-z]{2,3}\.)?linkedin\.com\/company\/[^/?#]+/i.test(String(url ?? '').trim());
}

/** True when every piece of the quote (pieces split at "..."/"…") is in the item, in order. */
export function quoteIsIn(quote: string, itemText: string): boolean {
  const hay = core(itemText);
  const parts = String(quote ?? '').split(/\.\.\.|…/).map(core).filter((p) => p.length >= 4);
  if (!parts.length) return false;
  let from = 0;
  for (const p of parts) {
    const at = hay.indexOf(p, from);
    if (at === -1) return false;
    from = at + p.length;
  }
  return true;
}

export function checkJudgement(llm: any, tidy: TidyData): CheckedJudgement {
  const items = citableItems(tidy);

  const dropped: DroppedNamesake[] = [];
  const droppedIds = new Set<string>();
  for (const n of Array.isArray(llm?.dropped_namesakes) ? llm.dropped_namesakes : []) {
    if (!n || (!n.name && !n.evidence_id)) continue;
    const id = String(n.evidence_id ?? '').trim();
    const item = items.get(id);
    if (item) droppedIds.add(id);
    dropped.push({
      name: String(n.name ?? '').trim(),
      url: item?.url || String(n.url ?? '').trim(),
      snippet: String(n.snippet ?? '').trim(),
      reason_dropped: String(n.reason_dropped ?? '').trim(),
      ...(id ? { evidence_id: id } : {}),
    });
  }

  const findings: AnalysisFinding[] = [];
  const rejected: RejectedFinding[] = [];
  for (const f of Array.isArray(llm?.findings) ? llm.findings : []) {
    if (!f || typeof f !== 'object') continue;
    const reasons: string[] = [];
    const id = String(f.evidence_id ?? '').trim();
    const type = String(f.type ?? '').trim() as FindingType;
    const item = items.get(id);

    if (!TYPES.includes(type)) reasons.push(`type "${type}" is not one of the allowed types`);
    if (!item) reasons.push(`evidence_id "${id}" is not an item in the input`);
    else {
      if (!quoteIsIn(f.quoted_text, item.text)) reasons.push(`quoted_text is not in ${id}`);
      // The own LinkedIn read can be off (blocked); then a search hit on a linkedin.com/company page is the same page.
      if (type === 'profile_drift' && item.kind !== 'LINKEDIN' && !isLinkedinCompanyUrl(item.url)) reasons.push('profile_drift must cite LINKEDIN or a linkedin.com/company search hit');
      if (item.kind === 'LINKEDIN' && type !== 'profile_drift') reasons.push('the own LinkedIn page can only support profile_drift');
      if ((type === 'unproven' || type === 'disciplinary_warning') && item.kind !== 'R') reasons.push(`${type} must cite a register check (R#)`);
      if (droppedIds.has(id)) reasons.push(`${id} is in this same answer's dropped_namesakes`);
    }
    if (!String(f.title ?? '').trim()) reasons.push('no title');

    if (reasons.length) {
      rejected.push({ finding: f, reasons });
      continue;
    }
    const category = String(f.category ?? '').trim() as FindingCategory;
    findings.push({
      id: `f${findings.length + 1}`,
      type,
      category: CATEGORIES.includes(category) ? category : 'identity',
      title: String(f.title).trim(),
      claim: String(f.claim ?? '').trim(),
      outside_source: String(f.outside_source ?? '').trim(),
      source_name: String(f.source_name ?? '').trim(),
      source_url: item!.url, // from the input item, never typed by the LLM
      quoted_text: String(f.quoted_text).trim(),
      confidence: f.confidence === 'high' ? 'high' : 'medium',
      identity_justification: String(f.identity_justification ?? '').trim(),
      evidence_id: id,
    });
  }
  return { findings, rejected, dropped_namesakes: dropped };
}
