// V2.1 Step 2, rules v2 (owner, 2026-11-06): Step 2 reads everything Step 1 and Step 1.5 gathered and returns four
// lists for Step 3 to write the report from:
//   conclusive_findings  facts the evidence proves (problems and strengths)
//   contradictions       the same fact given differently by different sources, the company's own sites included
//   suggestions          what the owner can do, each tied to the items above
//   take_note            signals worth knowing that the evidence does not prove
// Same shape as rules v1: tidy input -> judge (one LLM call) -> plain-code check -> recheck (second call) -> the same
// code check. The code check only checks what code can know for sure: the cited item exists, the quote is in it, a
// contradiction has two different values, a suggestion rests on an item that was kept. Anything that fails is kept in
// `rejected` with the reasons, never silently deleted. Rules v1 (judge.ts, recheck.ts) is untouched.
import type { ChatMessage } from './cloud.ts';
import { askLanes, parseAnswer, type Lane, type LaneAttempt } from './judge.ts';
import { citableItems, quoteIsIn } from './check-findings.ts';
import { domainOf, officialId, onDomain, renderTidy, type DomainOwnership, type TidyData } from './tidy.ts';
import type { DroppedNamesake } from './analyse.ts';

export const RULES_V2_PROMPT = 'rules-v2.1';
export const RULES_V2_RECHECK_PROMPT = 'rules-v2-recheck';

export const TOPICS = [
  'contact', 'identity', 'website', 'email', 'reviews', 'scale', 'licence', 'awards', 'registration', 'reputation', 'other',
] as const;
export type Topic = (typeof TOPICS)[number];

/** first: the company wrote or submitted it (its own sites, LinkedIn, listings, award entries, press releases).
 *  independent: a register, bureau, regulator, news outlet or other party that did not get its words from the company. */
export type Party = 'first' | 'independent';
export type Evidence = { evidence_id: string; quoted_text: string; source_url: string; party: Party };

export type ConclusiveFinding = {
  id: string;
  kind: 'problem' | 'strength';
  topic: Topic;
  title: string;
  statement: string;
  evidence: Evidence[];
  why_it_matters: string;
  identity: string;
  confidence: 'high' | 'medium';
  /** Technical-check findings: the check that made them ('email-spoofing', 'domain-expiry'...). Same check + same kind merge. */
  check_id?: string;
  /** Domain findings: whether the company is shown to own the domain. Wording ("your domain", "Renew") follows it. */
  ownership?: DomainOwnership;
};

export type Contradiction = {
  id: string;
  topic: Topic;
  title: string;
  versions: Array<{ source: string; value: string } & Evidence>;
  why_it_matters: string;
  identity: string;
  confidence: 'high' | 'medium';
};

export type Suggestion = { id: string; topic: Topic; topics: Topic[]; action: string; why: string; based_on: string[] };

export type Note = {
  id: string; topic: Topic; title: string; note: string; evidence: Evidence[]; why_not_conclusive: string;
  /** A signal built on matching a person (a reviewer who shares a staff member's name). Recorded only; never dropped. */
  identity_signal: boolean;
  /** Set on identity signals. A record only: no page hides the note because of it. */
  paid_only?: boolean;
  check_id?: string;
  ownership?: DomainOwnership;
};

export type Rejected = { list: string; item: Record<string, unknown>; reasons: string[] };

export type Lists = {
  conclusive_findings: ConclusiveFinding[];
  contradictions: Contradiction[];
  suggestions: Suggestion[];
  take_note: Note[];
};

export type Step2V2Output = Lists & {
  version: '2.1';
  stage: 2;
  rules: 'v2';
  created_at: string;
  input: TidyData['input'];
  status: 'analyzed' | 'failed';
  error: string | null;
  skip_reason: null;
  baseline: Record<string, string[]>;
  dropped_namesakes: DroppedNamesake[];
  rejected: Rejected[];
  could_not_check: TidyData['could_not_check'];
  stats: Record<string, number>;
  meta: { prompt: string; lane: string | null; model: string | null; attempts: LaneAttempt[] };
  llm_raw: string | null;
  recheck?: RecheckV2;
};

export type RecheckV2 = {
  status: 'rechecked' | 'failed' | 'skipped';
  error: string | null;
  reviews: Array<{ id: string; verdict: 'keep' | 'fix' | 'remove'; problems: string[] }>;
  removed: Array<{ id: string; item: unknown; problems: string[] }>;
  added: string[];
  rejected: Rejected[];
  meta: { prompt: string; lane: string | null; model: string | null; attempts: LaneAttempt[]; duration_ms: number };
  llm_raw: string | null;
};

// ---------------------------------------------------------------- prompt

export function rulesV2SystemPrompt(input: TidyData['input'], isKorean: boolean): string {
  return `You are Step 2 (the analyst) of Company Dive V2.1 for "${input.company}" (${input.country}, ${input.industry}).

WHY: Step 3 turns your answer into a free report that shows the owner what the public internet says about their company, so that they want the paid full report. The owner knows their own business; what they do not see is how their own sites, listings, directories, reviews and records look side by side to a customer, a bank or a tender panel. Read everything below and say what is true, where the sources disagree, what to do about it, and what to keep an eye on. Every item must be true, about this exact company, and backed by quotes you can see in the input. One wrong item about a client destroys trust; do not pad.

YOUR INPUT (gathered and tidied by plain code; you cannot search or open pages). Every item you may cite has an id:
A. OFFICIAL SITE: [O1], [O2]... the pages read from the company's own site(s), and [O0] the header/menu/footer lines repeated on every page. A company can run more than one site (domains, old and new sites): all of them are its own, and Step 1 may have read pages from more than one.
B. LINKEDIN (id LINKEDIN): the company's own LinkedIn page fields. The company controls it.
C. OUTSIDE EVIDENCE (E1, E2...): Google Maps listings; the company's Google reviews (one item: the newest reviews, each with date, stars, author, text and the owner's reply when there is one); search hits with their snippets and, when Step 1 read the page, the passages where the company's name appears ("PAGE READ"); and the technical audit, measured by code: domain registration and expiry, email security (SPF/DMARC), Google PageSpeed, and the SEO / GEO benchmark of the official website (one item with the SEO and GEO scores and the checks that passed, then one item per check that warned or failed, each saying how sure it is). Search engines match words, not companies: many items are other companies.
D. REGISTER CHECKS (R1, R2...): register or list pages read whole by plain code, with every passage where the name appears.
E. TECHNICAL AUDIT summary: the same audit results as in C, listed together.
F. COULD NOT CHECK: sources that were not checked. Say nothing about them.

WHAT TO RETURN: four lists.
1. "conclusive_findings": facts the evidence proves on its own. kind "problem": a risk to the business that a customer, bank, Google or attacker would meet (a domain about to expire, email anyone can forge, reviews never answered, a broken or wrong field on a listing, a slow phone site, a page that fails Google's checks). kind "strength": an outside source confirms something good (an award organiser lists them, a register shows their registration number, a strong rating). A strength is only what an OUTSIDE item shows; the company praising itself is not one.
2. "contradictions": the same fact given differently by different sources. Sources include the company's own sites and pages against each other (a customer opening one site sees a different phone than on the other), its LinkedIn, Google Maps, directories and registers. Facts: legal name, registration number, phone, email, address, website, the list of offices or branches, staff numbers, founding date, number of sites or projects, capacity, revenue, licences and their dates. Give every version once, each with its quote.
3. "suggestions": what the owner can do, concrete and short, each based on one or more of your conclusive_findings or contradictions ids. No sales talk.
4. "take_note": signals worth knowing that the evidence does not prove: a reviewer with the same name as a staff member, many reviews on one day, a big claim no outside source repeats, a figure that may be out of date. Say why it is not conclusive.

RULES
1. Identity before anything. For every outside item you use, decide if it is this company. Identity needs one of: an official domain, a phone or address on the official site, the registration number, or the same name + same city + same line of business. A similar name alone is not identity. Items that are another company go in "dropped_namesakes" (only ones that could be confused with the client). Never cite a dropped item.
2. Related companies. A sister, parent or subsidiary company with a similar name is not this company: cite nothing about it as this company's.
3. Branches. A branch's own address or phone is not a contradiction with the head office's. But the SAME office (for example the head office) given different addresses or phones by different sources, or different lists of offices, is a contradiction.
4. Formatting is not a contradiction: +60 vs 0, spaces, dashes, abbreviations, the order of the parts of an address. Different digits, a different unit number, a different street or area name are real differences.
5. Not found is not a finding. Absence from a search, directory or list proves nothing (on a sanctions or disciplinary list it means a clean record). The one exception: the official site claims a specific licence, membership or award, a register check (section D) is the authoritative list for exactly that claim, and the name is not on it: a conclusive_finding of kind "problem".
6. Numbers. A number the company states (staff, sites, projects, capacity, revenue, offices, years) that another source gives differently is a contradiction. Name each version's source plainly (for example "LinkedIn counts only staff who list the company"). A data-broker estimate with nothing the company states to compare it with is not an item.
7. The technical audit was measured by code: use its results as given and add nothing to them. A domain's expiry date, email set-up and PageSpeed scores are conclusive. In the SEO / GEO benchmark, the SEO and GEO scores and a check marked "exact" are conclusive; a check marked "rule of thumb" or "hint" is an estimate: take_note at most, never a conclusive_finding. A check that only says the site is missing from a list (Wikidata, Wikipedia, Common Crawl) is rule 5.
8. Reviews: count only what the review item shows (ratings, dates, authors, text, replies), and say "of the N newest reviews shown" (quote the review item's title line that gives N). Possible staff reviews or a burst of reviews on one day go in take_note, never in conclusive_findings.
9. Evidence. Every item cites "evidence": a list of {"evidence_id", "quoted_text"}; ids are O0, O1..., E#, R# or LINKEDIN. "quoted_text" is the shortest passage that proves the point, copied character for character from that item: no "..." joins, no added words. A contradiction cites each version's own evidence_id and quoted_text.
10. Confidence: "high" when every outside item cited carries an official domain, phone, address or the registration number; otherwise "medium".
11. Each fact once. One contradiction per fact, with every version in it; do not split it, and do not repeat it as a finding.
12. Whose words. Each cited passage is "first" (the company wrote or submitted it: its own sites and LinkedIn, a listing, an award entry or press release it supplied) or "independent" (a register, bureau, regulator, news outlet or another party that did not take its words from the company). Set "party" on every evidence entry. Call something independent, third-party or verified only when an independent passage backs it.
13. Ownership. A domain item in section C says "ownership: owned | used_by | unknown". Say "your domain" and give fixes like "Renew" or "Set DMARC" only when it is owned. For used_by or unknown, word it neutrally ("the domain X") and give the fix as "if you control it, ...".
14. Wording. Each why_it_matters is written for its own item, from its own facts; never reuse a stock sentence across items. No internal words in any text: worker, input, pipeline, benchmark, "the data", "review item", or the names of tools used as nouns. Write as to the owner reading a report, not as an analyst reading a file.
15. People. Never write a private person's name (a reviewer, an employee, a consultant) or a personal phone number in any field. Say "a reviewer". A signal that rests on matching a person's name to a reviewer or staff list is a take_note with "identity_signal": true; every other note has "identity_signal": false.
16. Every item has a "topic". Every place name, person name and figure in an item must appear in its cited quotes. State dates exactly as the quote gives them ("expires on 2026-12-05"); never compute "in N days", "N years old" or any other derived figure, code computes those. For a count of reviews, quote the line that gives the count.
17. Language: ${isKorean ? 'this is a South Korean company. Write title, statement, value, why_it_matters, action, why, note and reasons in Korean. Quotes stay exactly as in the input.' : 'write in English. Quotes stay exactly as in the input.'}

OUTPUT: one JSON object only, this shape:
{
  "baseline_summary": {
    "brand_names": [], "legal_names": [], "websites": [], "phones": [], "emails": [], "addresses": [], "claimed_credentials": [], "claimed_numbers": []
  },
  "conclusive_findings": [
    { "id": "f1", "kind": "problem | strength", "topic": "${TOPICS.join(' | ')}", "title": "one line", "statement": "what is true, plainly",
      "evidence": [ { "evidence_id": "E3", "quoted_text": "exact copy", "party": "first | independent" } ], "why_it_matters": "who meets it and what it costs", "identity": "which identifier ties the outside items to this company", "confidence": "high | medium" }
  ],
  "contradictions": [
    { "id": "c1", "topic": "...", "title": "one line", "versions": [ { "source": "eternalgy.me home page", "value": "the value this source gives", "evidence_id": "O1", "quoted_text": "exact copy", "party": "first | independent" } ],
      "why_it_matters": "...", "identity": "...", "confidence": "high | medium" }
  ],
  "suggestions": [ { "id": "s1", "action": "what to do", "why": "one line", "based_on": ["f1", "c2"] } ],
  "take_note": [ { "id": "n1", "topic": "...", "title": "one line", "note": "what was seen", "evidence": [ { "evidence_id": "E5", "quoted_text": "exact copy", "party": "first | independent" } ], "why_not_conclusive": "...", "identity_signal": false } ],
  "dropped_namesakes": [ { "evidence_id": "E7", "name": "...", "url": "...", "snippet": "short exact copy", "reason_dropped": "..." } ]
}`;
}

function recheckInstructions(isKorean: boolean): string {
  return `

=== YOUR JOB NOW: CHECKER ===
You are not the analyst. An analyst already applied the rules above to the input and wrote the answer in section G. Check it like a strict reviewer whose name goes on it. For EVERY item in section G (ids f#, c#, s#, n#), re-read the cited items yourself and answer:
1. Identity: is each cited outside item really this company (rule 1), not a namesake or related company (rule 2), not a branch compared with the head office (rule 3)?
2. Proof: do the quotes prove the item itself, not only that the company exists? For a contradiction: do the versions really give different values for the same fact (rule 4: formatting is not a difference)?
3. Facts: is every name, number, date and place in the text exactly what the input says? Every place name, person name and figure in an item must appear in its cited quotes. State dates exactly as the quote gives them ("expires on 2026-12-05"); never compute "in N days", "N years old" or any other derived figure, code computes those. For a count of reviews, quote the line that gives the count. Is a private person's name or personal phone anywhere (it must not be)? Does it say independent or third-party without an independent passage (rule 12), or say "your domain" / "Renew" for a domain that is not owned (rule 13)?
4. Rules and list: is it in the right list (proven -> conclusive_findings; disagreement -> contradictions; not proven -> take_note)? Is the confidence right (rule 10)? Is a suggestion based on items that stand?
Verdicts: "keep" (all pass), "fix" (real, but a field is wrong: give the whole corrected item, same fields, same id), "remove" (fails identity, proof or the rules). List the problems for every verdict other than "keep". An item that belongs in another list: "remove" it and add it to that list in "missed".
Then look through the input for items the analyst missed that pass every rule, and add them in "missed", with new ids mf1, mc1, ms1, mn1... (a missed suggestion may name a missed item's id in based_on). Nothing doubtful: empty lists are fine.
${isKorean ? 'Write problems and any changed text in Korean; quotes stay exactly as in the input.' : 'Write in English; quotes stay exactly as in the input.'}

OUTPUT: one JSON object only:
{
  "reviews": [ { "id": "f1", "verdict": "keep | fix | remove", "problems": ["..."], "fixed": { ...the full corrected item, only when verdict is fix } } ],
  "missed": { "conclusive_findings": [], "contradictions": [], "suggestions": [], "take_note": [] }
}`;
}

// ---------------------------------------------------------------- plain-code check

type Cited = { url: string; text: string; check_id?: string; domain?: string };

/** Every item the analyst may cite, by id: the v1 items (E#, R#, LINKEDIN) plus the official pages (O0, O1...). */
export function citableV2(t: TidyData): Map<string, Cited> {
  const items = new Map<string, Cited>();
  for (const [id, it] of citableItems(t)) items.set(id, { url: it.url, text: it.text });
  for (const e of t.evidence) { const it = e.check_id || e.domain ? items.get(e.id) : undefined; if (it) Object.assign(it, { check_id: e.check_id, domain: e.domain }); }
  t.official.pages.forEach((p, i) => items.set(officialId(i), { url: p.url, text: p.text }));
  if (t.official.site_wide) items.set('O0', { url: t.official.pages[0]?.url ?? '', text: t.official.site_wide });
  return items;
}

const str = (v: unknown) => String(v ?? '').trim();
const core = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
const topicOf = (v: unknown): Topic => (TOPICS.includes(str(v) as Topic) ? (str(v) as Topic) : 'other');
const confidenceOf = (v: unknown): 'high' | 'medium' => (v === 'high' ? 'high' : 'medium');

// ---- claim vs quote (PL4). TODO: swap for claimMismatches from ../report-rules once that module is merged.

const EMAIL_RE = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
const URL_RE = /https?:\/\/[^\s)]+|\b(?:[a-z0-9-]+\.)+[a-z]{2,}\b(?:\/[^\s)]*)?/gi;
const bareUrl = (u: string) => u.toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/[/.,;:]+$/, '');
const numberTokens = (text: string) =>
  (text.match(/\d+(?:[.,]\d+)*/g) ?? []).map((n) => (/,\d{3}(?!\d)/.test(n) ? n.replace(/,/g, '') : n.replace(/,/g, '.')).replace(/^0+(?=\d)/, ''));

/** Emails, URLs / domains and numbers (dates and phone numbers are numbers) in `text` that appear in none of the quotes. */
export function claimMismatches(text: string, quotes: string[]): string[] {
  const hay = quotes.join('\n').toLowerCase();
  const hayBare = hay.replace(/https?:\/\//g, '').replace(/www\./g, '');
  const body = text.replace(/\b(?:[EOR]|[fcsn])\d+\b/g, ' '); // item ids like "E3" or "f1" are not claims
  const out: string[] = [];
  for (const e of body.match(EMAIL_RE) ?? []) if (!hay.includes(e.toLowerCase())) out.push(e);
  const rest = body.replace(EMAIL_RE, ' ');
  for (const u of rest.match(URL_RE) ?? []) if (!hayBare.includes(bareUrl(u))) out.push(u);
  const have = new Set(numberTokens(hay));
  for (const n of numberTokens(rest.replace(URL_RE, ' '))) if (!have.has(n)) out.push(n);
  return [...new Set(out)];
}

const INDEPENDENT_WORDS = /\b(independent(?:ly)?|third[- ]party|verified by)\b|독립|제3자/i;

// ---- who wrote it (PL2), who owns the domain (PL3)

/** First-party: the company's own pages, LinkedIn, any page on an official domain, or what the analyst marked as written
 *  or submitted by the company. Otherwise independent. Code decides the first three whatever the analyst said. */
function partyOf(id: string, item: Cited, claimed: unknown, officialHosts: string[]): Party {
  if (id.startsWith('O') || id === 'LINKEDIN') return 'first';
  if (officialHosts.some((h) => onDomain(item.url, h))) return 'first';
  return str(claimed).toLowerCase() === 'first' ? 'first' : 'independent';
}

/** Check one cited passage: the id exists, it is not a dropped namesake, the quote is in it. */
function checkEvidence(e: any, items: Map<string, Cited>, dropped: Set<string>, where: string, reasons: string[], officialHosts: string[]): Evidence | null {
  const id = str(e?.evidence_id);
  const item = items.get(id);
  if (!item) return reasons.push(`${where}: evidence_id "${id}" is not an item in the input`), null;
  if (dropped.has(id)) return reasons.push(`${where}: ${id} is in this same answer's dropped_namesakes`), null;
  if (!quoteIsIn(e?.quoted_text, item.text)) return reasons.push(`${where}: quoted_text is not in ${id}`), null;
  return { evidence_id: id, quoted_text: str(e.quoted_text), source_url: item.url, party: partyOf(id, item, e?.party, officialHosts) };
}

export function checkEvidenceList(list: unknown, items: Map<string, Cited>, dropped: Set<string>, reasons: string[], officialHosts: string[] = []): Evidence[] {
  const arr = Array.isArray(list) ? list : [];
  if (!arr.length) reasons.push('no evidence cited');
  return arr.map((e, i) => checkEvidence(e, items, dropped, `evidence ${i + 1}`, reasons, officialHosts)).filter((e): e is Evidence => e !== null);
}

/** What the cited technical items say about the item (PL3, PL14): one check_id when all its evidence is from the same
 *  check; an ownership value when any evidence is about a domain (mixed or no registrant data -> unknown). */
function techFacts(evidence: Evidence[], items: Map<string, Cited>, tidy: TidyData): { check_id?: string; ownership?: DomainOwnership } {
  const cited = evidence.map((e) => items.get(e.evidence_id));
  const checks = new Set(cited.map((c) => c?.check_id ?? ''));
  const domains = [...new Set(cited.map((c) => c?.domain).filter((d): d is string => Boolean(d)))];
  const owns = new Set(domains.map((d) => tidy.domains?.find((x) => x.domain === d)?.ownership ?? 'unknown'));
  return {
    ...(checks.size === 1 && [...checks][0] ? { check_id: [...checks][0] } : {}),
    ...(domains.length ? { ownership: owns.size === 1 ? [...owns][0] : ('unknown' as const) } : {}),
  };
}

/** The analyst's (or the checker's) answer, checked against the input. Pure. Ids are renumbered f1.., c1.., s1.., n1..
 *  in order; a suggestion's based_on follows the renumbering, and loses any id that was not kept. */
export function checkV2(llm: any, tidy: TidyData): Lists & { dropped_namesakes: DroppedNamesake[]; rejected: Rejected[] } {
  const items = citableV2(tidy);
  const rejected: Rejected[] = [];
  const officialHosts = [
    tidy.official.domain,
    ...(tidy.domains ?? []).filter((d) => /official/i.test(d.role)).map((d) => d.domain),
    ...(Array.isArray(llm?.baseline_summary?.websites) ? llm.baseline_summary.websites.map((w: unknown) => domainOf(str(w))) : []),
  ].filter(Boolean);
  const ev = (list: unknown, dropped: Set<string>, reasons: string[]) => checkEvidenceList(list, items, dropped, reasons, officialHosts);

  const dropped_namesakes: DroppedNamesake[] = [];
  const droppedIds = new Set<string>();
  for (const n of Array.isArray(llm?.dropped_namesakes) ? llm.dropped_namesakes : []) {
    if (!n || (!n.name && !n.evidence_id)) continue;
    const id = str(n.evidence_id);
    const item = items.get(id);
    if (item && !id.startsWith('O')) droppedIds.add(id);
    dropped_namesakes.push({ name: str(n.name), url: item?.url || str(n.url), snippet: str(n.snippet), reason_dropped: str(n.reason_dropped), ...(id ? { evidence_id: id } : {}) });
  }

  const renumber = new Map<string, string>();
  const keep = (prefix: string, raw: any, count: number) => {
    const newId = `${prefix}${count}`;
    if (str(raw?.id)) renumber.set(str(raw.id), newId);
    return newId;
  };

  const conclusive_findings: ConclusiveFinding[] = [];
  for (const f of Array.isArray(llm?.conclusive_findings) ? llm.conclusive_findings : []) {
    if (!f || typeof f !== 'object') continue;
    const reasons: string[] = [];
    if (!str(f.title)) reasons.push('no title');
    if (!['problem', 'strength'].includes(str(f.kind))) reasons.push(`kind "${str(f.kind)}" is not problem or strength`);
    const evidence = ev(f.evidence, droppedIds, reasons);
    if (f.kind === 'strength' && evidence.length && evidence.every((e) => e.evidence_id.startsWith('O'))) reasons.push('a strength must rest on an outside item, not only the official site');
    if (reasons.length) { rejected.push({ list: 'conclusive_findings', item: f, reasons }); continue; }
    conclusive_findings.push({
      id: keep('f', f, conclusive_findings.length + 1),
      kind: f.kind, topic: topicOf(f.topic), title: str(f.title), statement: str(f.statement), evidence,
      why_it_matters: str(f.why_it_matters), identity: str(f.identity), confidence: confidenceOf(f.confidence),
      ...techFacts(evidence, items, tidy),
    });
  }

  const contradictions: Contradiction[] = [];
  for (const c of Array.isArray(llm?.contradictions) ? llm.contradictions : []) {
    if (!c || typeof c !== 'object') continue;
    const reasons: string[] = [];
    if (!str(c.title)) reasons.push('no title');
    const raw = Array.isArray(c.versions) ? c.versions : [];
    const versions = raw
      .map((v: any, i: number) => {
        const e = checkEvidence(v, items, droppedIds, `version ${i + 1}`, reasons, officialHosts);
        if (e && !str(v?.value)) reasons.push(`version ${i + 1}: no value`);
        return e ? { source: str(v.source), value: str(v.value), ...e } : null;
      })
      .filter((v: unknown): v is Contradiction['versions'][number] => v !== null);
    if (raw.length < 2) reasons.push('a contradiction needs at least two versions');
    else if (new Set(versions.map((v: { value: string }) => core(v.value))).size < 2) reasons.push('the versions do not give different values');
    if (reasons.length) { rejected.push({ list: 'contradictions', item: c, reasons }); continue; }
    contradictions.push({
      id: keep('c', c, contradictions.length + 1),
      topic: topicOf(c.topic), title: str(c.title), versions,
      why_it_matters: str(c.why_it_matters), identity: str(c.identity), confidence: confidenceOf(c.confidence),
    });
  }

  const take_note: Note[] = [];
  for (const n of Array.isArray(llm?.take_note) ? llm.take_note : []) {
    if (!n || typeof n !== 'object') continue;
    const reasons: string[] = [];
    if (!str(n.title)) reasons.push('no title');
    const evidence = ev(n.evidence, droppedIds, reasons);
    // A signal built on matching a person's name: recorded on the note, never dropped (PL10)
    const identity_signal = n.identity_signal === true;
    if (reasons.length) { rejected.push({ list: 'take_note', item: n, reasons }); continue; }
    take_note.push({
      id: keep('n', n, take_note.length + 1),
      topic: topicOf(n.topic), title: str(n.title), note: str(n.note), evidence, why_not_conclusive: str(n.why_not_conclusive),
      identity_signal, ...(identity_signal ? { paid_only: true } : {}), ...techFacts(evidence, items, tidy),
    });
  }

  // ---- The same failed check on several assets is one finding with all the evidence rows (PL14).
  const alias = new Map<string, string>(); // provisional id -> the item that now holds it
  const byCheck = new Map<string, ConclusiveFinding>();
  const ownDomains = new Map<ConclusiveFinding, Set<string>>(); // the domains each merged finding's own wording is about
  for (const f of [...conclusive_findings]) {
    if (!f.check_id) continue;
    const key = `${f.check_id}|${f.kind}`;
    const first = byCheck.get(key);
    if (!first) { byCheck.set(key, f); ownDomains.set(f, new Set(f.evidence.map((e) => items.get(e.evidence_id)?.domain).filter((d): d is string => Boolean(d)))); continue; }
    for (const e of f.evidence) if (!first.evidence.some((x) => x.evidence_id === e.evidence_id)) first.evidence.push(e);
    Object.assign(first, techFacts(first.evidence, items, tidy));
    alias.set(f.id, first.id);
    conclusive_findings.splice(conclusive_findings.indexOf(f), 1);
  }

  // The other domains must not vanish from the merged wording: one plain sentence naming them, only those a quote shows (PL4).
  for (const first of new Set(byCheck.values())) {
    const own = ownDomains.get(first)!;
    const quotes = first.evidence.map((e) => e.quoted_text).join(' ').toLowerCase();
    const others = [...new Set(first.evidence.map((e) => items.get(e.evidence_id)?.domain).filter((d): d is string => Boolean(d)))].filter((d) => !own.has(d) && quotes.includes(d.toLowerCase()));
    if (!others.length) continue;
    const ko = /korea/i.test(tidy.input.country);
    const list = others.length > 1 ? `${others.slice(0, -1).join(', ')} ${ko ? '및' : 'and'} ${others.at(-1)}` : others[0];
    first.statement = `${first.statement} ${ko ? `${list}에도 동일하게 적용됩니다.` : `The same applies to ${list}.`}`.trim();
  }

  // ---- Final ids, in order.
  const finalId = new Map<string, string>();
  for (const [list, prefix] of [[conclusive_findings, 'f'], [contradictions, 'c'], [take_note, 'n']] as const) {
    (list as Array<{ id: string }>).forEach((x, i) => finalId.set(x.id, `${prefix}${i + 1}`));
  }
  for (const x of [...conclusive_findings, ...contradictions, ...take_note]) x.id = finalId.get(x.id)!;
  const finalOf = (prov: string | undefined) => (prov ? finalId.get(alias.get(prov) ?? prov) : undefined);

  // Suggestions last: they point at the items above, by their new ids, and take their topics.
  const suggestions: Suggestion[] = [];
  const topicByFinal = new Map([...conclusive_findings, ...contradictions].map((x) => [x.id, x.topic] as const));
  for (const s of Array.isArray(llm?.suggestions) ? llm.suggestions : []) {
    if (!s || typeof s !== 'object') continue;
    const reasons: string[] = [];
    if (!str(s.action)) reasons.push('no action');
    const based = (Array.isArray(s.based_on) ? s.based_on : []).map((id: unknown) => finalOf(renumber.get(str(id)))).filter((id: string | undefined): id is string => Boolean(id && topicByFinal.has(id)));
    if (!based.length) reasons.push('based_on names no kept finding or contradiction');
    if (reasons.length) { rejected.push({ list: 'suggestions', item: s, reasons }); continue; }
    const ids = [...new Set<string>(based)];
    const topics = [...new Set(ids.map((id) => topicByFinal.get(id)!))];
    suggestions.push({ id: `s${suggestions.length + 1}`, topic: topics[0], topics, action: str(s.action), why: str(s.why), based_on: ids });
  }

  return { conclusive_findings, contradictions, suggestions, take_note, dropped_namesakes, rejected };
}

// ---------------------------------------------------------------- judge

function render(tidy: TidyData): string {
  return renderTidy(tidy, { officialIds: true });
}

export async function judgeV2(tidy: TidyData, options: { lanes?: Lane[]; deadCallMs?: number } = {}): Promise<Step2V2Output> {
  const t0 = Date.now();
  const input = tidy.input;
  const isKorean = /korea/i.test(input.country);
  const messages: ChatMessage[] = [
    { role: 'system', content: rulesV2SystemPrompt(input, isKorean) },
    { role: 'user', content: render(tidy) + '\n\nAnalyse the input now under the rules. Return the JSON object only.' },
  ];
  const base = {
    version: '2.1' as const, stage: 2 as const, rules: 'v2' as const, created_at: new Date().toISOString(), input,
    skip_reason: null, could_not_check: tidy.could_not_check,
  };
  let answer: Awaited<ReturnType<typeof askLanes>> | null = null;
  try {
    answer = await askLanes(messages, { ...options, accept: (text) => void parseAnswer(text) });
    const llm = parseAnswer(answer.text);
    const checked = checkV2(llm, tidy);
    const b = llm?.baseline_summary ?? {};
    const baseline: Record<string, string[]> = {};
    for (const k of ['brand_names', 'legal_names', 'websites', 'phones', 'emails', 'addresses', 'claimed_credentials', 'claimed_numbers']) {
      baseline[k] = Array.isArray(b[k]) ? b[k].map(String) : [];
    }
    return {
      ...base, status: 'analyzed', error: null, baseline, ...checked,
      stats: statsOf(checked, tidy, answer.attempts.length, Date.now() - t0),
      meta: { prompt: RULES_V2_PROMPT, lane: answer.lane, model: answer.model, attempts: answer.attempts },
      llm_raw: answer.text,
    };
  } catch (err: any) {
    const empty = { conclusive_findings: [], contradictions: [], suggestions: [], take_note: [], dropped_namesakes: [], rejected: [] };
    const attempts: LaneAttempt[] = answer?.attempts ?? err?.attempts ?? [];
    return {
      ...base, status: 'failed', error: `LLM analysis failed: ${err?.message ?? err}`, baseline: {}, ...empty,
      stats: statsOf(empty, tidy, attempts.length, Date.now() - t0),
      meta: { prompt: RULES_V2_PROMPT, lane: answer?.lane ?? null, model: answer?.model ?? null, attempts },
      llm_raw: answer?.text ?? null,
    };
  }
}

function statsOf(l: Lists & { rejected: Rejected[]; dropped_namesakes: DroppedNamesake[] }, tidy: TidyData, calls: number, ms: number) {
  return {
    conclusive_findings: l.conclusive_findings.length,
    contradictions: l.contradictions.length,
    suggestions: l.suggestions.length,
    take_note: l.take_note.length,
    rejected: l.rejected.length,
    dropped_namesakes: l.dropped_namesakes.length,
    could_not_check: tidy.could_not_check.length,
    llm_calls: calls,
    duration_ms: ms,
  };
}

// ---------------------------------------------------------------- recheck

const LISTS = ['conclusive_findings', 'contradictions', 'suggestions', 'take_note'] as const;

/** Apply the checker's answer. Pure. A malformed review leaves the item as it was; everything kept, fixed or added goes
 *  through checkV2 again, so the checker can never pass an item the code check would reject. */
export function applyRecheckV2(judge: Step2V2Output, answer: any, tidy: TidyData) {
  const all = new Map<string, { list: (typeof LISTS)[number]; item: any }>();
  for (const list of LISTS) for (const item of judge[list]) all.set(item.id, { list, item });

  const reviews: RecheckV2['reviews'] = [];
  const fixed = new Map<string, any>();
  for (const r of Array.isArray(answer?.reviews) ? answer.reviews : []) {
    const id = str(r?.id ?? r?.finding_id);
    const verdict = str(r?.verdict) as 'keep' | 'fix' | 'remove';
    if (!all.has(id) || !['keep', 'fix', 'remove'].includes(verdict) || reviews.some((x) => x.id === id)) continue;
    if (verdict === 'fix' && (!r.fixed || typeof r.fixed !== 'object')) continue;
    reviews.push({ id, verdict, problems: (Array.isArray(r.problems) ? r.problems : []).map(String) });
    if (verdict === 'fix') fixed.set(id, { ...r.fixed, id });
  }

  const removed: RecheckV2['removed'] = [];
  const candidate: Record<string, any[]> = { conclusive_findings: [], contradictions: [], suggestions: [], take_note: [] };
  for (const [id, { list, item }] of all) {
    const rv = reviews.find((r) => r.id === id);
    if (rv?.verdict === 'remove') removed.push({ id, item, problems: rv.problems });
    else candidate[list].push(rv?.verdict === 'fix' ? fixed.get(id) : item);
  }
  // Checked items carry source_url; checkV2 takes it from the input again.
  const missed = answer?.missed && typeof answer.missed === 'object' ? answer.missed : {};
  const taken = new Set(all.keys());
  const added: string[] = [];
  for (const list of LISTS) {
    for (const m of Array.isArray(missed[list]) ? missed[list] : []) {
      if (!m || typeof m !== 'object') continue;
      let id = str(m.id) || `${list[0]}x`;
      while (taken.has(id)) id += 'x'; // a missed item's id must not clash with a kept one
      taken.add(id);
      candidate[list].push({ ...m, id });
      added.push(str(m.title ?? m.action));
    }
  }
  const checked = checkV2({ ...candidate, dropped_namesakes: judge.dropped_namesakes }, tidy);
  return { lists: checked, reviews, removed, added: added.filter(Boolean), rejected: checked.rejected };
}

function renderAnswer(judge: Step2V2Output): string {
  const lines = [`\n## G. THE ANALYST'S ANSWER — check every item`];
  for (const list of LISTS) {
    lines.push(`\n### ${list} (${judge[list].length})`);
    for (const item of judge[list]) lines.push(JSON.stringify(item));
    if (!judge[list].length) lines.push('(none)');
  }
  return lines.join('\n');
}

export async function recheckV2(tidy: TidyData, judge: Step2V2Output, options: { lanes?: Lane[]; deadCallMs?: number } = {}): Promise<Step2V2Output> {
  const t0 = Date.now();
  const meta = (attempts: LaneAttempt[], lane: string | null = null, model: string | null = null) => ({
    prompt: RULES_V2_RECHECK_PROMPT, lane, model, attempts, duration_ms: Date.now() - t0,
  });
  if (judge.status !== 'analyzed') {
    return { ...judge, recheck: { status: 'skipped', error: `judge status ${judge.status}`, reviews: [], removed: [], added: [], rejected: [], meta: meta([]), llm_raw: null } };
  }
  const isKorean = /korea/i.test(tidy.input.country);
  const messages: ChatMessage[] = [
    { role: 'system', content: rulesV2SystemPrompt(tidy.input, isKorean) + recheckInstructions(isKorean) },
    { role: 'user', content: render(tidy) + '\n' + renderAnswer(judge) + '\n\nCheck the answer now. Return the JSON object only.' },
  ];
  let answer: Awaited<ReturnType<typeof askLanes>> | null = null;
  try {
    answer = await askLanes(messages, { ...options, accept: (text) => void parseAnswer(text) });
    const applied = applyRecheckV2(judge, parseAnswer(answer.text), tidy);
    const { dropped_namesakes, rejected, ...lists } = applied.lists;
    return {
      ...judge,
      ...lists,
      stats: { ...statsOf({ ...lists, rejected: judge.rejected, dropped_namesakes: judge.dropped_namesakes }, tidy, judge.stats.llm_calls + answer.attempts.length, judge.stats.duration_ms + Date.now() - t0) },
      recheck: {
        status: 'rechecked', error: null, reviews: applied.reviews, removed: applied.removed, added: applied.added,
        rejected, meta: meta(answer.attempts, answer.lane, answer.model), llm_raw: answer.text,
      },
    };
  } catch (err: any) {
    // The analyst's answer stands; the checker's answer is kept even when applying it failed.
    return { ...judge, recheck: { status: 'failed', error: `Recheck failed: ${err?.message ?? err}`, reviews: [], removed: [], added: [], rejected: [], meta: answer ? meta(answer.attempts, answer.lane, answer.model) : meta(err?.attempts ?? []), llm_raw: answer?.text ?? null } };
  }
}
