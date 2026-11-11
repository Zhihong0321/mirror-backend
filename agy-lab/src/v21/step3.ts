// V2.1 Step 3 (owner, 2026-11-06): write the free report and the email for one company, from its Step 2 rules-v2
// result only. Step 3 writes; it never judges.
//
// The report page is rendered by plain code from the Step 2 items themselves, so nothing on it can drift from Step 2.
// Since 2026-11-10 (docs/preview-writing-plan.md) it shows THAT each problem exists, never where, what value or how to
// fix it, so a buyer's own AI cannot read it as the full report: 3 strengths in full, ONE proof finding in full, every
// other problem, contradiction and signal as a consequence title only, grouped by business area, with a code-set
// urgency. The action steps are not on it. The LLM writes four things, in one call:
//   summary   2-3 opening sentences for the report
//   email     a subject and 2-3 short paragraphs on why this report matters to this company
//   titles    one consequence title per problem, contradiction and signal, with no values in it (code checks; a title
//             that fails is recorded in `rejected` and the page uses the code teaser instead)
//   proof     the one item shown in full (an unknown id is recorded and the top-ranked item is used instead)
// Every sentence it writes cites Step 2 item ids. Plain code then checks each one: the ids exist, every number in it is
// in the cited items, it says nothing about the full report (the code writes that part, fixed). A sentence that fails
// is rejected with its reasons and kept; it never reaches the page or the email.
// The greeting, the deeper-dive paragraph (the owner's 7 areas), the report link and the sign-off are fixed text.
//
// Second pass (owner, 2026-11-07; V21_STEP3_REFINE=on): one more call reads the raw input Step 2 read (that Step 2
// run's 'tidy' row), the Step 2 items and the checked draft, and returns a refined summary and email with what it
// changed and why. The raw input is for checking that each sentence says what the sources really say, not for new
// facts: refined sentences cite Step 2 ids and pass the same code check. A part whose refined version fails (or a
// failed call) keeps the draft. Both versions are stored.
import type { ChatMessage } from './cloud.ts';
import { askLanes, parseAnswer, type Lane, type LaneAttempt } from './judge.ts';
import type { Step2V2Output } from './step2-v2.ts';
import { renderTidy, type TidyData } from './tidy.ts';
import { daysToImpact, localeFor, plural, rankKey, severity, type Urgency } from '../report-rules/index.ts';

export const STEP3_PROMPT = 'step3-v4';
export const STEP3_REFINE_PROMPT = 'step3-refine-v3';

/** On with V21_STEP3_REFINE=on (owner, 2026-11-07); off, Step 3 is one call as before. */
export const refineOn = (): boolean => (process.env.V21_STEP3_REFINE ?? '').trim().toLowerCase() === 'on';

export type Line = { text: string; cites: string[] };
export type Rejected = { part: string; item: unknown; reasons: string[] };

export type Step3Common = {
  version: '2.1';
  stage: 3;
  created_at: string;
  company: string;
  language: 'en' | 'ko';
  step2_row_id: number;
  step2_run_id: string;
  status: 'ok' | 'failed';
  error: string | null;
  rejected: Rejected[];
  meta: { prompt: string; lane: string | null; model: string | null; attempts: LaneAttempt[]; duration_ms: number };
  llm_raw: string | null;
  test?: string;
  /** The second pass, when it ran. The top-level parts are the refined ones where they passed, else the draft's. */
  refine?: Refine;
};

export type Refine = {
  status: 'done' | 'failed' | 'not_run';
  reason?: string;
  error?: string | null;
  /** Which version each part ended up as. */
  used: { summary: 'refined' | 'draft'; email: 'refined' | 'draft' };
  /** What the second pass says it changed, and why. */
  changes: Array<{ part: string; what: string; why: string }>;
  /** The draft, as pass 1 wrote it and code checked it. */
  draft: { summary: Line[]; subject: Line | null; body: Line[] };
  rejected: Rejected[];
  meta: { prompt: string; lane: string | null; model: string | null; attempts: LaneAttempt[]; duration_ms: number } | null;
  llm_raw: string | null;
};
export type Step3Report = Step3Common & {
  kind: 'report'; summary: Line[];
  /** id -> consequence title with no values (problems, contradictions, signals). Missing on reports before 2026-11-10. */
  titles?: Record<string, string>;
  /** The one item shown in full, as the LLM picked it. Missing or unknown -> the top-ranked item. */
  proof?: string | null;
};
export type Step3Email = Step3Common & { kind: 'email'; subject: Line | null; body: Line[]; report_url: string; text: string; /** Set when the check rejected the subject or every body paragraph and the model's own words were kept. */ unchecked?: string };

// ---------------------------------------------------------------- the owner's fixed wording

/** The deeper dive's 7 research areas (owner, 2026-11-06: v1's six plus social media). */
export const AREAS = {
  en: [
    ['Contact and reachability', 'Every published phone, email, WhatsApp link and address, and where each one really leads'],
    ['How the internet understands you', 'Search results, Maps, directories, AI assistants and your homepage, read as a buyer would'],
    ['Reviews, discussion and news', 'Google reviews, forums, social posts and news about you and your key people'],
    ['Credibility and official records', 'Regulator lists, courts, insolvency notices, registers, licence claims and trademarks'],
    ['Digital assets', 'Domain ownership and expiry, hosting, email spoofing and email reputation'],
    ['Website speed and quality', 'Google PageSpeed Insights, and what real Chrome visitors experienced'],
    ['Social media', 'Your Facebook, Instagram, LinkedIn and other social pages: are they yours, current and consistent'],
  ],
  ko: [
    ['연락처와 연결성', '공개된 모든 전화번호, 이메일, 메신저 링크, 주소와 각각이 실제로 어디로 연결되는지'],
    ['인터넷이 귀사를 이해하는 방식', '검색 결과, 지도, 디렉터리, AI 비서, 홈페이지를 구매자의 눈으로 읽기'],
    ['리뷰, 토론, 뉴스', '귀사와 핵심 인물에 대한 구글 리뷰, 커뮤니티, 소셜 게시물, 뉴스'],
    ['신뢰도와 공식 기록', '규제 기관 목록, 법원, 파산 공고, 등록부, 면허 주장, 상표'],
    ['디지털 자산', '도메인 소유와 만료, 호스팅, 이메일 위조, 이메일 평판'],
    ['웹사이트 속도와 품질', 'Google PageSpeed Insights와 실제 Chrome 방문자의 경험'],
    ['소셜 미디어', '페이스북, 인스타그램, 링크드인 등 소셜 페이지가 귀사의 것인지, 최신인지, 일관된지'],
  ],
} as const;

const T = {
  en: {
    greeting: (c: string) => `Hello ${c} team,`,
    deeper: `This free report shows what is wrong, not where it is or how to fix it. The full report gives every source and every fix, and goes deeper across 7 research areas: ${AREAS.en.map((a) => a[0].toLowerCase()).join('; ')}. Reply to this email to get your full report.`,
    link: (u: string) => `Your free report: ${u}`,
    sign: 'The Eternalgy team',
  },
  ko: {
    greeting: (c: string) => `${c} 담당자님께,`,
    deeper: `이 무료 보고서는 무엇이 문제인지만 보여 드리며, 어디에 있는지나 어떻게 고치는지는 담고 있지 않습니다. 전체 보고서는 모든 출처와 해결 방법을 담고, 7개 조사 영역(${AREAS.ko.map((a) => a[0]).join(', ')})에 걸쳐 더 깊이 조사합니다. 전체 보고서를 원하시면 이 이메일에 회신해 주세요.`,
    link: (u: string) => `무료 보고서: ${u}`,
    sign: 'Eternalgy 팀',
  },
};

// ---------------------------------------------------------------- the Step 2 items Step 3 may cite

type Item = { list: 'finding' | 'contradiction' | 'suggestion' | 'note'; item: any; text: string };

/** Every Step 2 item by id, with all its text (quotes included) for the number check. */
export function itemsOf(s2: Step2V2Output): Map<string, Item> {
  const m = new Map<string, Item>();
  const add = (list: Item['list'], x: any) => x?.id && m.set(String(x.id), { list, item: x, text: JSON.stringify(x) });
  for (const x of s2.conclusive_findings ?? []) add('finding', x);
  for (const x of s2.contradictions ?? []) add('contradiction', x);
  for (const x of s2.suggestions ?? []) add('suggestion', x);
  for (const x of s2.take_note ?? []) add('note', x);
  return m;
}

/** The numbers in a text, as plain tokens: 1,300 -> 1300, 04 -> 4, 4.3 stays 4.3. */
export function numbersIn(text: string): string[] {
  return (text.match(/\d+(?:[.,]\d+)*/g) ?? []).map((n) => {
    const t = /,\d{3}(?!\d)/.test(n) ? n.replace(/,/g, '') : n.replace(/,/g, '.');
    return t.replace(/^0+(?=\d)/, '');
  });
}

const FULL_REPORT_TALK = /full report|deeper dive|deep dive|research area|전체 보고서|심층/i;

/** A value in a title: 3+ digits in a row (phone, date, number), an email, a URL or a domain. Counts like "3 sources" pass. */
const TITLE_LEAK = /\d{3,}|\d[\d\s().+-]{5,}\d|@|https?:\/\/|www\.|\b[\w-]+\.(?:com|net|org|gov|edu|io|co|me|biz|info|asia|my|sg|kr|au|uk|de|fr|br|th|id|ph|vn|jp|cn|in)\b/i;

/** Value keys of a text: every token with a digit in it ("G7", "62", "2026-12-04", "4.7"), lowercased, plus each run of
 *  2+ digits inside it (so "62명" matches "62"). Single digits alone are not keys, so a count like "3 sources" passes. */
export function valueKeys(text: string): Set<string> {
  const keys = new Set<string>();
  for (const m of String(text ?? '').matchAll(/[\p{L}\p{N}][\p{L}\p{N}.,:\/+-]*/gu)) {
    const tok = m[0].replace(/[.,:\/+-]+$/, '').toLowerCase();
    if (!/\d/.test(tok)) continue;
    if (tok.length >= 2) keys.add(tok);
    for (const run of tok.match(/\d{2,}/g) ?? []) keys.add(run);
  }
  return keys;
}
/** Everything an item's sources say: its versions' values and quotes, its evidence quotes. Its own title and wording are not values. */
function sourceText(x: any): string {
  const v = (Array.isArray(x?.versions) ? x.versions : []).flatMap((y: any) => [y?.value, y?.quoted_text]);
  const e = (Array.isArray(x?.evidence) ? x.evidence : []).map((y: any) => y?.quoted_text);
  return [...v, ...e].map((t) => String(t ?? "")).join(" ");
}

/**
 * The titles the LLM wrote, checked by code: one per problem, contradiction or signal id; no value in it (TITLE_LEAK, or a
 * contradiction's own version values). A title that fails is recorded in `rejected` and left out, so the page uses
 * the code teaser for that item. Never throws.
 */
export function checkTitles(raw: unknown, s2: Step2V2Output, rejected: Rejected[]): Record<string, string> {
  const out: Record<string, string> = {};
  const eligible = new Map<string, any>();
  for (const f of s2.conclusive_findings ?? []) if (f?.id && f.kind === 'problem') eligible.set(String(f.id), f);
  for (const x of s2.contradictions ?? []) if (x?.id) eligible.set(String(x.id), x);
  for (const x of s2.take_note ?? []) if (x?.id) eligible.set(String(x.id), x);
  for (const [i, r] of (Array.isArray(raw) ? raw : []).entries()) {
    const id = String((r as any)?.id ?? '').trim();
    const text = typeof (r as any)?.text === 'string' ? (r as any).text.trim().replace(/\s+/g, ' ') : '';
    const reasons: string[] = [];
    if (!eligible.has(id)) reasons.push(`"${id}" is not a problem, contradiction or signal id`);
    if (!text) reasons.push('no text');
    if (text.length > 160) reasons.push('longer than 160 characters');
    const m = text.match(TITLE_LEAK);
    if (m) reasons.push(`gives a value away: "${m[0]}"`);
    const values = ((eligible.get(id)?.versions ?? []) as Array<{ value?: unknown }>).map((v) => String(v?.value ?? '').trim().toLowerCase()).filter((v) => v.length >= 4);
    const hit = values.find((v) => text.toLowerCase().includes(v));
    if (hit) reasons.push(`gives a source's value away: "${hit}"`);
    const own = id && eligible.has(id) ? valueKeys(sourceText(eligible.get(id))) : new Set<string>();
    const nums = [...valueKeys(text)].filter((k) => own.has(k));
    if (nums.length) reasons.push(`gives a value from its sources away: ${nums.join(", ")}`);
    if (id && out[id]) reasons.push('a second title for the same id');
    if (reasons.length) rejected.push({ part: `title ${i + 1}${id ? ` (${id})` : ''}`, item: r, reasons });
    else out[id] = text;
  }
  return out;
}

/**
 * Summary sentences shown on the page: a sentence that carries a value (valueKeys) from the sources of a cited problem,
 * contradiction or signal is recorded in `rejected` and left off the page. Values that the page shows anyway (the
 * proof item and the strengths) are allowed. Returns the sentences that pass. Never throws.
 */
export function checkSummaryValues(lines: Line[], s2: Step2V2Output, proof: string | null, rejected: Rejected[]): Line[] {
  const shown = new Set<string>();
  const hidden = new Map<string, Set<string>>();
  for (const f of s2.conclusive_findings ?? []) {
    if (!f?.id) continue;
    if (f.kind === "strength" || f.id === proof) for (const k of valueKeys(sourceText(f) + " " + [f.title, f.statement].join(" "))) shown.add(k);
    else hidden.set(f.id, valueKeys(sourceText(f)));
  }
  for (const x of [...(s2.contradictions ?? []), ...(s2.take_note ?? [])] as any[]) {
    if (!x?.id) continue;
    if (x.id === proof) for (const k of valueKeys(sourceText(x) + " " + String(x.title ?? ""))) shown.add(k);
    else hidden.set(x.id, valueKeys(sourceText(x)));
  }
  return (Array.isArray(lines) ? lines : []).filter((l, i) => {
    const hits = [...new Set((l?.cites ?? []).flatMap((c) => [...valueKeys(l?.text ?? "")].filter((k) => hidden.get(c)?.has(k) && !shown.has(k))))];
    if (!hits.length) return true;
    rejected.push({ part: `summary ${i + 1}`, item: l, reasons: [`gives a value from a hidden item away: ${hits.join(", ")}`] });
    return false;
  });
}

/** The proof pick: a problem finding or contradiction id, else null with the reason recorded (the page then uses rank #1). */
export function checkProof(raw: unknown, s2: Step2V2Output, rejected: Rejected[]): string | null {
  const id = String((raw as any)?.id ?? '').trim();
  const ok = (s2.conclusive_findings ?? []).some((f) => f?.id === id && f.kind === 'problem') || (s2.contradictions ?? []).some((x) => x?.id === id);
  if (ok) return id;
  rejected.push({ part: 'proof', item: raw ?? null, reasons: [id ? `"${id}" is not a problem or contradiction id` : 'no proof id'] });
  return null;
}

/** Check one sentence the LLM wrote. Returns the clean line, or null with the reasons pushed. */
export function checkLine(raw: any, items: Map<string, Item>, reasons: string[]): Line | null {
  const text = typeof raw?.text === 'string' ? raw.text.trim() : '';
  const cites: string[] = Array.isArray(raw?.cites) ? raw.cites.map((c: unknown) => String(c).trim()).filter(Boolean) : [];
  if (!text) reasons.push('no text');
  if (!cites.length) reasons.push('cites no Step 2 item');
  const missing = cites.filter((c) => !items.has(c));
  if (missing.length) reasons.push(`cites ids that are not in the Step 2 result: ${missing.join(', ')}`);
  if (text && FULL_REPORT_TALK.test(text)) reasons.push('talks about the full report or the deeper dive (only the fixed text may)');
  const cited = cites.filter((c) => items.has(c));
  if (text && cited.length) {
    const known = new Set(cited.flatMap((c) => numbersIn(items.get(c)!.text)));
    const unknown = numbersIn(text).filter((n) => !known.has(n));
    if (unknown.length) reasons.push(`numbers not in the cited items: ${unknown.join(', ')}`);
  }
  return reasons.length ? null : { text, cites };
}

// ---------------------------------------------------------------- the prompt

function itemsForPrompt(s2: Step2V2Output): string {
  const f = (s2.conclusive_findings ?? []).map((x) => ({ id: x.id, kind: x.kind, title: x.title, statement: x.statement, why_it_matters: x.why_it_matters, ...(x.ownership ? { domain_ownership: x.ownership } : {}), sources: [...new Set((x.evidence ?? []).map((e) => e.party))] }));
  const c = (s2.contradictions ?? []).map((x) => ({ id: x.id, title: x.title, versions: (x.versions ?? []).map((v) => `${v.source}: ${v.value}`), why_it_matters: x.why_it_matters }));
  const s = (s2.suggestions ?? []).map((x) => ({ id: x.id, action: x.action, why: x.why, based_on: x.based_on }));
  const n = (s2.take_note ?? []).map((x) => ({ id: x.id, title: x.title, note: x.note, why_not_conclusive: x.why_not_conclusive }));
  return JSON.stringify({ conclusive_findings: f, contradictions: c, suggestions: s, take_note: n }, null, 1);
}

export function step3SystemPrompt(s2: Step2V2Output, ko: boolean): string {
  return `You are Step 3 (the writer) of Company Dive V2.1 for "${s2.input.company}" (${s2.input.country}, ${s2.input.industry}).

WHY: the owner of this company will read a free report that shows what the public internet says about their company. It proves the problems are real but keeps the answers for the paid full report: code prints up to 3 strengths in full, ONE proof item in full, and every other problem, contradiction and signal as a title only, with no values, sources or fixes. Owners paste this page into their own AI; the page must leave that AI unable to answer which value is wrong, where, or how to fix it. You write four things:
1. "summary": 2 or 3 sentences at the top of the report page, each under 35 words. They are the first thing the owner reads; the first sentence must make them read on.
2. "email": the email that brings them the report link: a "subject" and a "body" of 2 or 3 short paragraphs, under 120 words in all. Its one goal is that the owner opens the report.
3. "titles": one title for EVERY problem finding, contradiction and take_note item (not strengths). Each under 110 characters, written as what it costs the business, never the value: "Your head office phone differs across 3 sources. Customers may call a line you don't answer." Never put in a title a phone number, email, address, domain, URL, date, registration or licence number, amount, grade, staff or project count, legal form, town name, person's name or the name of a source: the things that differ are the values. A count of sources ("3 sources") is fine.
4. "proof": the ONE problem finding or contradiction the page shows in full, with its evidence. Pick the one that passes all three tests: the owner can check it themselves in a minute; it is urgent; fixing it does not remove the need for the rest of the report.
Code adds the greeting, a fixed paragraph about the full report, the link and the sign-off. Do not write any of those.

YOU WRITE; YOU NEVER JUDGE. The items below were judged by Step 2 and are the only facts you have.
${writerRules(ko)}

OUTPUT: one JSON object only:
{
  "summary": [ { "text": "...", "cites": ["f1", "c3"] } ],
  "email": {
    "subject": { "text": "...", "cites": ["f1"] },
    "body": [ { "text": "...", "cites": ["f1", "f4"] } ]
  },
  "titles": [ { "id": "f2", "text": "..." } ],
  "proof": { "id": "f1", "why": "one line: how it passes the three tests" }
}`;
}

/** The job and the writing rules, shared word for word by the writer (pass 1) and the second pass. */
function writerRules(ko: boolean): string {
  return `YOUR JOB IS TO SELL, WITH THE TRUTH
The free report exists for one reason: to make the owner want the paid full report. You are not summarising the report and you are not a neutral reporter; you write persuasive copy that makes the owner care about what is already true about their company in public. The truth is your only material, and it is enough.
- Pick this company's 2 or 3 strongest true facts: the ones that cost it the most, or that it stands to gain the most from. Do not list everything; the report shows the rest.
- For each fact you use, make three things plain: what it costs them (a lost enquiry, a lost sale, lost trust, a weaker bid, money, time), who meets it (customers, banks, partners, staff they hire, rivals, Google, AI assistants: whoever the cited items name), and why it is worth acting on (it is public, so anyone looking them up sees it today). Take the cost and the audience from the items' own words (why_it_matters, why); never add ones they do not give.
- Lead with the fact that hits hardest for THIS company. A subject that names one concrete problem about them beats a general one.
- SHOW THAT IT IS WRONG, NEVER THE ANSWER. Say what is wrong and what it costs; never give the wrong value, where it is published, or how to fix it: no phone numbers, addresses, emails, domains, URLs, registration or licence numbers, or names of the sources that disagree. Counts of sources are fine ("differs across 3 sources"). The figures or names that differ ARE the values, so never write them: not the two grades, not the two staff counts, not the project totals, not a legal form, not town or branch names, not a review date or rating. Write what differs and what it costs: "your contractor grade differs between your site and a public directory", not "G7 on your site, G3 in a directory". Never compute a figure ("within 30 days"). The one exception is the item you pick as "proof": you may state it in full. Code checks every summary sentence and title for numbers taken from the sources of an item that is not the proof or a strength, and drops the ones that have them.
- Where the company has a real strength, set the problem against it ("your X is strong, and Y is undercutting it"): it is honest, and it sells better than a list of faults.
- Write to one person, the owner: "you", "your". Short sentences, active verbs, concrete nouns. No filler, no clichés, no exclamation marks.

RULES (selling never bends them)
1. Every sentence (summary entry, subject, body paragraph) cites the ids of the items it rests on in "cites" (f#, c#, s#, n#). A sentence with nothing to cite is not written.
2. No new facts: nothing that is not in the cited items, including no cost, audience, amount, date or consequence they do not give. Numbers, dates, names, domains and phone numbers are copied exactly as the items give them. Dates are stated as the item gives them ("expires on 2026-12-05"); never compute "in N days", "N years old" or other derived figures, code computes those. A count of reviews comes from the line that gives it.
3. A "strength" stays a strength and a "problem" stays a problem. A contradiction is the sources disagreeing: say what differs, do not pick a winner.
4. A take_note item (n#) is never a fact: word it as something worth checking ("may", "worth checking"), or leave it out.
5. Persuasive, never false: urgency only from a real date or fact in the cited items (an expiry date, for example); no invented deadlines, no "hackers are attacking you", no threats, no fear beyond what the item says, no flattery beyond the strengths.
6. Never mention the full report, the paid report, a deeper dive or research areas: code writes that part.
7. Plain words, addressed to the owner ("your"). The subject is under 90 characters.
8. Ownership. Say "your domain" only when its domain_ownership is "owned". For "used_by" or "unknown", say "a domain you use" and "if you control it". Never tell the owner how to fix anything: the fixes are in the full report.
9. Say "independent" or "third-party" only for an item whose sources include "independent". An item with only "first" sources is the company's own word.
10. No stock sentences: write each line from its own item's facts, never a sentence you could paste under any other item. Plain words for the owner; never say worker, input, pipeline, benchmark, review item or "the data".
11. Never write a private person's name or a personal phone number. A reviewer is "a reviewer".
12. Language: ${ko ? 'this is a South Korean company: write in Korean. Names, domains and numbers stay exactly as in the items.' : 'English.'}`;
}

/** The second pass: read the raw input, the Step 2 items and the checked draft; return the refined parts. */
export function refineSystemPrompt(s2: Step2V2Output, ko: boolean): string {
  return `You are the second reader of Step 3 (the writer) of Company Dive V2.1 for "${s2.input.company}" (${s2.input.country}, ${s2.input.industry}).

WHY: the owner of this company will read a free report showing what the public internet says about their company. It proves the problems are real but keeps the answers for the paid full report: up to 3 strengths and one proof item are printed in full; every other item is a title only, with no values, sources or fixes. A first writer drafted two short things around it: "summary" (2 or 3 opening sentences, each under 35 words) and "email" (a subject and 2 or 3 short paragraphs, under 120 words in all, on why this report matters to THIS company, using its 2 or 3 strongest facts). Your job is to make them better: truer, sharper and more relevant to this company.

YOU GET:
- RAW INPUT: everything Step 1 and Step 1.5 gathered, exactly as Step 2 read it (the company's own pages, outside sources, the technical audit).
- STEP 2 ITEMS: the judged facts (f#, c#, s#, n#). They are the only facts the report may state.
- DRAFT: the first writer's summary and email, each sentence with its cites, any sentences code rejected, with why, and "proof": the one item the page shows in full (null if none).

WHAT TO DO:
1. Check every draft sentence against its cited items and against the raw sources behind them: does it say what the sources really say? Fix any sentence that overstates, understates, blurs a strength and a problem, picks a winner in a contradiction, or words a take_note item as a fact.
2. Using the raw input, judge which 2 or 3 facts matter most to THIS company (its business, its customers, its size) and make sure the email leads with them; swap a weaker fact for a stronger Step 2 item where one exists.
3. Keep what is already good. Do not rewrite for the sake of it.
4. The raw input lets you check meaning; it is NOT a source of new facts. Every sentence still cites Step 2 items, and says nothing the cited items do not say.
5. Code writes the greeting, a fixed paragraph about the full report, the link and the sign-off. Do not write any of those.

${writerRules(ko)}

OUTPUT: one JSON object only, the whole refined summary and email (not only the changed sentences), and what you changed:
{
  "summary": [ { "text": "...", "cites": ["f1", "c3"] } ],
  "email": {
    "subject": { "text": "...", "cites": ["f1"] },
    "body": [ { "text": "...", "cites": ["f1", "f4"] } ]
  },
  "changes": [ { "part": "summary 2 | subject | body 1 ...", "what": "what you changed", "why": "why, in one line" } ]
}`;
}

// ---------------------------------------------------------------- the run

/** Build the full email text from the checked parts and the fixed wording. */
export function emailText(company: string, ko: boolean, subject: Line | null, body: Line[], reportUrl: string): string {
  const t = ko ? T.ko : T.en;
  return [`Subject: ${subject?.text ?? ''}`, '', t.greeting(company), '', ...body.flatMap((l) => [l.text, '']), t.deeper, '', t.link(reportUrl), '', t.sign].join('\n');
}

/**
 * One LLM call, then the code check; with V21_STEP3_REFINE=on, the second pass after it (refineStep3). Never throws: a
 * failed first call gives a failed report and a failed email, each with the error and every lane attempt; a failed
 * second pass keeps the draft.
 */
export async function writeStep3(
  s2: Step2V2Output,
  ref: { row_id: number; run_id: string },
  reportUrl: string,
  options: { lanes?: Lane[]; deadCallMs?: number; test?: string; raw?: TidyData | null } = {},
): Promise<{ report: Step3Report; email: Step3Email }> {
  const t0 = Date.now();
  const ko = /korea/i.test(s2.input.country);
  const items = itemsOf(s2);
  const common = {
    version: '2.1' as const, stage: 3 as const, created_at: new Date().toISOString(), company: s2.input.company,
    language: (ko ? 'ko' : 'en') as 'en' | 'ko', step2_row_id: ref.row_id, step2_run_id: ref.run_id,
    ...(options.test ? { test: options.test } : {}),
  };
  const messages: ChatMessage[] = [
    { role: 'system', content: step3SystemPrompt(s2, ko) },
    { role: 'user', content: `STEP 2 ITEMS:\n${itemsForPrompt(s2)}\n\nWrite the summary and the email now under the rules. Return the JSON object only.` },
  ];

  let answer: Awaited<ReturnType<typeof askLanes>> | null = null;
  try {
    answer = await askLanes(messages, { lanes: options.lanes, deadCallMs: options.deadCallMs, accept: (text) => void parseAnswer(text) });
    const llm = parseAnswer(answer.text);
    const meta = { prompt: STEP3_PROMPT, lane: answer.lane, model: answer.model, attempts: answer.attempts, duration_ms: Date.now() - t0 };

    const check = (raw: any, part: string, rejected: Rejected[]): Line | null => {
      const reasons: string[] = [];
      const line = checkLine(raw, items, reasons);
      if (!line) rejected.push({ part, item: raw, reasons });
      return line;
    };

    const emailOk = (p: { subject: Line | null; body: Line[] }) => Boolean(p.subject && p.body.length);

    const rRejected: Rejected[] = [];
    const eRejected: Rejected[] = [];
    const draft = {
      summary: (Array.isArray(llm?.summary) ? llm.summary : []).map((x: any, i: number) => check(x, `summary ${i + 1}`, rRejected)).filter(Boolean) as Line[],
      subject: check(llm?.email?.subject, 'subject', eRejected),
      body: (Array.isArray(llm?.email?.body) ? llm.email.body : []).map((x: any, i: number) => check(x, `body ${i + 1}`, eRejected)).filter(Boolean) as Line[],
    };

    // Titles and the proof pick come from the first pass only; the second pass refines the summary and the email.
    const titles = checkTitles(llm?.titles, s2, rRejected);
    const proof = checkProof(llm?.proof, s2, rRejected);

    // Second pass: the refined part replaces the draft's only when it passes the same check.
    let final = draft;
    let refine: Refine | undefined;
    if (refineOn()) {
      const r = await refineStep3(s2, ko, draft, [...rRejected, ...eRejected], { ...options, proof });
      refine = r.refine;
      if (r.parts) {
        const useSummary = r.parts.summary.length > 0;
        const useEmail = emailOk(r.parts);
        final = { summary: useSummary ? r.parts.summary : draft.summary, subject: useEmail ? r.parts.subject : draft.subject, body: useEmail ? r.parts.body : draft.body };
        refine.used = { summary: useSummary ? 'refined' : 'draft', email: useEmail ? 'refined' : 'draft' };
      }
    }

    const report: Step3Report = {
      ...common, kind: 'report', status: 'ok', error: null, summary: checkSummaryValues(final.summary, s2, proof, rRejected), titles, proof, rejected: rRejected, meta, llm_raw: answer.text,
      ...(refine ? { refine } : {}),
    };
    // A rejected subject or body never blanks the email: the model's own words are used and labelled unchecked.
    const rawLine = (x: any): Line | null => {
      const text = typeof x === 'string' ? x : typeof x?.text === 'string' ? x.text : '';
      return text.trim() ? { text: text.trim(), cites: Array.isArray(x?.cites) ? x.cites.map(String) : [] } : null;
    };
    const unchecked = !final.subject ? 'the subject failed the check; the subject the model wrote is used' : !final.body.length ? 'every body paragraph failed the check; the paragraphs the model wrote are used' : null;
    const subject = final.subject ?? rawLine(llm?.email?.subject);
    const body = final.body.length ? final.body : ((Array.isArray(llm?.email?.body) ? llm.email.body : []).map(rawLine).filter(Boolean) as Line[]);
    const email: Step3Email = {
      ...common, kind: 'email', status: 'ok', error: null, subject, body, ...(unchecked ? { unchecked } : {}),
      report_url: reportUrl, text: emailText(s2.input.company, ko, subject, body, reportUrl),
      rejected: eRejected, meta, llm_raw: answer.text,
      ...(refine ? { refine } : {}),
    };
    return { report, email };
  } catch (err: any) {
    const error = `Step 3 writing failed: ${err?.message ?? err}`;
    const meta = { prompt: STEP3_PROMPT, lane: answer?.lane ?? null, model: answer?.model ?? null, attempts: answer?.attempts ?? err?.attempts ?? [], duration_ms: Date.now() - t0 };
    const failed = { ...common, status: 'failed' as const, error, rejected: [], meta, llm_raw: answer?.text ?? null };
    return {
      report: { ...failed, kind: 'report', summary: [] },
      // The email still goes out with the greeting and the report link; the failure is on the row.
      email: { ...failed, kind: 'email', subject: null, body: [], report_url: reportUrl, text: emailText(s2?.input?.company ?? '', ko, null, [], reportUrl) },
    };
  }
}

/**
 * The second pass. Never throws: with no raw input it does not run; a failed call comes back failed with the attempts.
 * Returns the refined parts (each sentence checked by code) when the call answered, for writeStep3 to use part by part.
 */
async function refineStep3(
  s2: Step2V2Output,
  ko: boolean,
  draft: { summary: Line[]; subject: Line | null; body: Line[] },
  draftRejected: Rejected[],
  options: { lanes?: Lane[]; deadCallMs?: number; raw?: TidyData | null; proof?: string | null },
): Promise<{ refine: Refine; parts: { summary: Line[]; subject: Line | null; body: Line[] } | null }> {
  const t0 = Date.now();
  const base = { used: { summary: 'draft' as const, email: 'draft' as const }, changes: [], draft, rejected: [], meta: null, llm_raw: null };
  if (!options.raw) return { refine: { ...base, status: 'not_run', reason: 'no raw input: the Step 2 run has no tidy row' }, parts: null };

  const items = itemsOf(s2);
  const messages: ChatMessage[] = [
    { role: 'system', content: refineSystemPrompt(s2, ko) },
    {
      role: 'user',
      content: [
        `RAW INPUT:\n${renderTidy(options.raw, { officialIds: true })}`,
        `STEP 2 ITEMS:\n${itemsForPrompt(s2)}`,
        `DRAFT:\n${JSON.stringify({ proof: options.proof ?? null, summary: draft.summary, email: { subject: draft.subject, body: draft.body }, rejected_by_code: draftRejected.map((r) => ({ part: r.part, text: (r.item as any)?.text ?? null, reasons: r.reasons })) }, null, 1)}`,
        'Refine the summary and the email now under the rules. Return the JSON object only.',
      ].join('\n\n'),
    },
  ];
  let answer: Awaited<ReturnType<typeof askLanes>> | null = null;
  try {
    answer = await askLanes(messages, { lanes: options.lanes, deadCallMs: options.deadCallMs, accept: (text) => void parseAnswer(text) });
    const llm = parseAnswer(answer.text);
    const rejected: Rejected[] = [];
    const check = (raw: any, part: string): Line | null => {
      const reasons: string[] = [];
      const line = checkLine(raw, items, reasons);
      if (!line) rejected.push({ part: `refined ${part}`, item: raw, reasons });
      return line;
    };
    const parts = {
      summary: (Array.isArray(llm?.summary) ? llm.summary : []).map((x: any, i: number) => check(x, `summary ${i + 1}`)).filter(Boolean) as Line[],
      subject: check(llm?.email?.subject, 'subject'),
      body: (Array.isArray(llm?.email?.body) ? llm.email.body : []).map((x: any, i: number) => check(x, `body ${i + 1}`)).filter(Boolean) as Line[],
    };
    const str = (v: unknown) => String(v ?? '').trim();
    const changes = (Array.isArray(llm?.changes) ? llm.changes : []).map((c: any) => ({ part: str(c?.part), what: str(c?.what), why: str(c?.why) })).filter((c: { what: string }) => c.what);
    return {
      refine: {
        ...base, status: 'done', error: null, changes, rejected,
        meta: { prompt: STEP3_REFINE_PROMPT, lane: answer.lane, model: answer.model, attempts: answer.attempts, duration_ms: Date.now() - t0 },
        llm_raw: answer.text,
      },
      parts,
    };
  } catch (err: any) {
    return {
      refine: {
        ...base, status: 'failed', error: `second pass failed, the draft is kept: ${err?.message ?? err}`,
        meta: { prompt: STEP3_REFINE_PROMPT, lane: answer?.lane ?? null, model: answer?.model ?? null, attempts: answer?.attempts ?? err?.attempts ?? [], duration_ms: Date.now() - t0 },
        llm_raw: answer?.text ?? null,
      },
      parts: null,
    };
  }
}

// ---------------------------------------------------------------- the page
// The look is the v1 preview's (src/divedeeper/preview-html.ts; owner, 2026-11-07): Inter / Inter Tight, ink on white,
// a dark hero with the "file" card, a number strip, full-width sections, a dark call to action. The content is V2.1's:
// every Step 2 item in full, printed by code, each with its id, quotes and source links. Nothing on the page judges.

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);


// ---------------------------------------------------------------- what the free page shows, and urgency
// The preview is a sales page: what is locked is left out of the HTML (a CSS blur would still be in the page source).

/** What the free page prints in full (docs/preview-writing-plan.md, 2026-11-10): the top 3 strengths and ONE proof item.
 *  Every other problem, contradiction and signal is a consequence title only; the action steps are not on the page. */
export const FREE_N = { strengths: 3, proof: 1 };
type GetsN = { findings: number };

// The kind of record a finding is about; severity() bumps it one level when the wording names a break (expired, spoofable,
// dummy, unreachable ...), caps it at High unless Step 2 was highly confident, and raises it by the days left to an expiry.
const TOPIC_BASE: Record<string, number> = {
  registration: 3, licence: 3, email: 3, contact: 3, identity: 2, website: 2, reviews: 2, reputation: 2, scale: 1, awards: 1, other: 1,
};
const BREAK_WORDS = /expire|spoof|dmarc|\bspf\b|blacklist|suspend|revok|lapse|fraud|dummy|placeholder|disconnect|unreachable|bounce|not working|no longer|invalid|wrong/i;
/** The topics a bank, tender panel or partner checks against the company's own claims. */
const RECORD_TOPICS = new Set(['registration', 'licence', 'awards']);

/** The page shows three levels: Critical and High are Urgent, Medium is Important, Low is Minor. */
type Level = 'urgent' | 'important' | 'minor';
const levelOf = (u: Urgency): Level => (u === 'critical' || u === 'high' ? 'urgent' : u === 'medium' ? 'important' : 'minor');

/** The business areas a CEO thinks in, by Step 2 topic. */
type Area = 'found' | 'reached' | 'credibility' | 'reputation' | 'name' | 'other';
const AREA_ORDER: Area[] = ['found', 'reached', 'credibility', 'reputation', 'name', 'other'];
const AREA_OF: Record<string, Area> = {
  website: 'found', contact: 'reached', registration: 'credibility', licence: 'credibility', awards: 'credibility', scale: 'credibility',
  reviews: 'reputation', reputation: 'reputation', identity: 'name', email: 'name',
};

type Rated = { urg: Urgency; days: number | null; key: number };
/** Urgency, days to impact and sort key of one item. Days come from `expires_at` when Step 2 gave one, else from dates in its text and quotes. */
export function rate(x: { topic?: string; confidence?: string; expires_at?: string }, texts: unknown[], now: Date): Rated {
  // A missing field (no why_it_matters, no quote) is an empty string, never a crash.
  texts = (Array.isArray(texts) ? texts : []).map((v) => (typeof v === 'string' ? v : ''));
  const at = x.expires_at ? Date.parse(x.expires_at) : NaN;
  const days = Number.isFinite(at) ? Math.ceil((at - now.getTime()) / 86400000) : daysToImpact(texts as string[], now);
  const urg = severity({ recordLevel: TOPIC_BASE[String(x.topic ?? 'other')] ?? 1, confidence: x.confidence, days, breaks: BREAK_WORDS.test((texts as string[]).join(' ')) });
  return { urg, days, key: rankKey(urg, days) };
}

/** Highest key first; equal keys keep Step 2's order. */
function ranked<T>(list: T[], key: (x: T) => number): T[] {
  return list.map((x, i) => ({ x, i, k: key(x) })).sort((a, b) => b.k - a.k || a.i - b.i).map((e) => e.x);
}
const P = {
  en: {
    title: (c: string) => `${c}: what the public internet says`,
    bar: 'Online presence report', barFor: (c: string) => `· Prepared for ${c}`,
    eyebrow: (c: string, d: string) => `Free report · prepared for ${c} · ${d}`,
    h1: (c: string, n: number) => (n ? `People who look up ${c} run into ${plural(n, 'problem', 'problems')}.` : `What strangers see about ${c} mostly checks out.`),
    h1g: (n: number) => (n ? 'You may not know about them. This page proves they exist.' : 'Here is what the sources confirm, and what this free report did not check.'),
    seeAll: 'See what we found',
    anyone: 'Built from public sources only. Anyone can look these up, your rivals included.',
    stamp: 'Prepared for you', fileNo: 'Free report',
    fCountry: 'Country', fIndustry: 'Industry', fSites: 'Websites', fFound: 'This report',
    found: (n: number) => `${plural(n, 'item', 'items')} found`,
    fileFoot: (d: string) => `Built ${d} from public sources`,
    strip: {
      strengths: (n: number) => `${noun(n, 'strength', 'strengths')} the sources confirm`, problems: (n: number) => `${noun(n, 'problem', 'problems')} someone looking you up runs into`,
      contradictions: (n: number) => `${noun(n, 'place', 'places')} where sources disagree`, notes: (n: number) => `${noun(n, 'signal', 'signals')} worth checking`,
    },
    fHighest: 'Highest urgency',
    execH: 'Action required.',
    exec: (p: number, c: number, hi: number) => `We found ${plural(p, 'problem', 'problems')} and ${plural(c, 'place', 'places')} where sources disagree${hi ? `; ${hi} ${hi === 1 ? 'is' : 'are'} Urgent` : ''}.`,
    execContra: 'Every day these differences stay public, customers, banks and partners see two versions of your business.',
    execPlain: 'Every day these problems stay public, customers, banks and partners run into them.',
    lvl: { urgent: 'Urgent', important: 'Important', minor: 'Minor' } as Record<Level, string>,
    urgLabel: 'Urgency',
    urgHow: 'Urgency is set by code from the kind of record affected (registration, licence, contact, email ...), how sure the evidence is and how soon it bites. Urgent means fix first.',
    topic: { contact: 'Contact details', identity: 'Company identity', website: 'Website', email: 'Email', reviews: 'Reviews', scale: 'Company size', licence: 'Licences', awards: 'Awards', registration: 'Registration', reputation: 'Reputation', other: 'Other' } as Record<string, string>,
    hint: 'issue',
    tag: { strength: 'Strength', problem: 'Problem', contra: 'Sources disagree', note: 'Worth checking' },
    why: 'Why it matters', sources: 'Sources', source: 'Source', value: 'What it says',
    // Short names for ids, so the page never prints f1 / s3 / c2 / n4.
    lab: { strength: 'Strength', problem: 'Problem', contra: 'Source disagreement', note: 'Signal' },
    stakeH: 'What is at stake.',
    stake: (price: string | null) => `One customer lost to what is below costs you more than this report.${price ? ` The full report costs ${price}.` : ''}`,
    stakeGood: 'This free report found no problem. It did not ask AI assistants, search Google Maps or check the official registers; the full report does.',
    qEye: 'Three questions', qH: 'Three questions every owner', qG: 'should be able to answer.',
    q1: 'Who is taking my customers?', q2: 'Would a bank or tender panel believe us?', q3: "What do strangers see that I don't?",
    st: { bad: 'Problem found', good: 'Looks good', none: 'Not checked here' },
    q1None: 'This free report did not ask AI assistants or search Google Maps for your trade.',
    q1Lock: 'which competitors AI assistants and Google Maps send your customers to, and why they win.',
    q2Bad: (n: number) => `${plural(n, 'record', 'records')} that banks and tender panels check ${n === 1 ? 'has a problem or differs' : 'have problems or differ'} between sources.`,
    q2Good: (n: number) => `${plural(n, 'record', 'records')} that banks and tender panels check ${n === 1 ? 'is' : 'are'} confirmed by an outside source.`,
    q2None: 'This free report found no registration, licence or award record to test.',
    q2Lock: 'which credentials, which official registers, and what to do about each.',
    q3Bad: (p: number, c: number, n: number) => [p ? `${plural(p, 'problem', 'problems')} someone looking you up runs into.` : '', c ? `Your details differ between sources in ${plural(c, 'place', 'places')}.` : '', n ? `${plural(n, 'signal', 'signals')} worth checking.` : ''].filter(Boolean).join(' '),
    q3Good: 'The sources we read tell one consistent story about you.',
    q3Lock: 'the values, the sources that publish them, and which one is right.',
    inFull: 'In the full report:',
    proofEye: 'One finding in full', proofH: 'One finding, with its proof.', proofG: 'Check it yourself in a minute.',
    proofP: 'Every other finding is listed below by title only. Its evidence, sources and fix are in the full report.',
    areasEye: 'What we found', areasH: 'What we found,', areasG: 'by business area.',
    areasP: 'Titles only. The values, the sources and the fix for each one are in the full report.',
    area: { found: 'Getting found', reached: 'Getting reached', credibility: 'Credibility with banks and tenders', reputation: 'Reputation', name: 'Risks to your company name', other: 'Other' } as Record<Area, string>,
    areasLockH: (n: number) => `The evidence for all ${plural(n, 'finding', 'findings')}`,
    areasLockP: 'Where each one is, what each source says, and the fix, in the full report.',
    strEye: 'What is working', strH: 'What is working for you.', strG: 'Each one confirmed by the sources under it.',
    moreStrengths: (n: number) => `${plural(n, 'more strength', 'more strengths')} confirmed, listed in the full report.`,
    noStrengths: 'This free report found no outside source confirming a strength yet. The full report checks registers, awards and reviews for them.',
    notEye: 'Not on this page', notH: 'What this free report', notG: 'does not tell you.',
    not: {
      rivals: 'Which competitors AI assistants and Google Maps recommend instead of you.',
      records: 'Which of your credentials a bank or tender panel can confirm in the official registers.',
      values: 'Which details are wrong, what each source says, and where it is published.',
      fixes: 'What to fix first, who does it and how long it takes.',
    },
    cta: 'Get my full report', ctaP: 'Reply to the email that brought you this link, and we will run it for you.', keep: 'This free report is yours to keep.',
    guarantee: 'Our guarantee: if the full report has fewer than 10 findings that are not in this free report, we refund you in full.',
    colophon: [['Prepared for', (c: string, _d: string, _n: number) => c], ['Built', (_c: string, d: string, n: number) => (n ? `${d}, from ${plural(n, 'public source', 'public sources')}` : `${d}, from public sources`)], ['Edition', () => 'Free report · one pass'], ['Method', () => 'Every statement in the full report traces to a source.']] as Array<[string, (c: string, d: string, n: number) => string]>,
    unlock: 'Unlock all findings',
    stickyN: (n: number) => `${plural(n, 'issue', 'issues')} found`,
    stickyP: 'Sources, evidence and every fix are in the full report.',
    insideEye: 'What you get', insideH: 'What the full report', insideG: 'puts in your hands.',
    insideP: 'The free report proves the problems exist. The full report is the working document for your team: where each one is, who fixes it, and the fix written out where we can.',
    gets: [
      { h: 'A one-page CEO summary', p: 'The decisions only you can make, and what is at stake in each.' },
      { h: 'Your competitors, by name', p: 'Who ChatGPT, Gemini and Google Maps send your customers to, and why they win.' },
      { h: 'Your credentials, checked against the official registers', p: 'What a bank or tender panel will and will not be able to confirm.' },
      { h: 'A task list for each department', p: 'Website, social media, IT and other: who does what, how long it takes and how much it matters.', note: (n: GetsN) => (n.findings ? `Starts from at least ${plural(n.findings, 'finding', 'findings')} in this free report, each with its evidence and fix.` : '') },
      { h: 'Done for you', p: 'Homepage text, review replies, an FAQ and pages for each town, written only from facts we verified.' },
    ] as Array<{ h: string; p: string; note?: (n: GetsN) => string }>,
    diyH: 'Doing it yourself',
    diy: (pages: number) => `To check this yourself: ${pages ? `read the ${plural(pages, 'public page', 'public pages')} behind this report, ` : ''}ask AI assistants the questions your customers ask, search Google Maps town by town, and look yourself up in the official registers.`,
    missing: 'This report is not ready yet.', missingP: 'Please come back to this link a little later.',
  },
  ko: {
    title: (c: string) => `${c}: 공개 인터넷이 말하는 것`,
    bar: '온라인 평판 보고서', barFor: (c: string) => `· ${c} 귀중`,
    eyebrow: (c: string, d: string) => `무료 보고서 · ${c} 귀중 · ${d}`,
    h1: (c: string, n: number) => (n ? `${c}을(를) 찾아보는 사람은 문제 ${n}개를 마주칩니다.` : `낯선 사람이 보는 ${c}의 모습은 대체로 문제없습니다.`),
    h1g: (n: number) => (n ? '모르고 계셨을 수 있습니다. 이 페이지가 그 존재를 보여 드립니다.' : '출처가 확인해 주는 내용과, 이 무료 보고서가 확인하지 않은 내용입니다.'),
    seeAll: '찾은 내용 보기',
    anyone: '공개 자료만으로 만들었습니다. 경쟁사를 포함해 누구나 찾아볼 수 있습니다.',
    stamp: '귀사 전용', fileNo: '무료 보고서',
    fCountry: '국가', fIndustry: '업종', fSites: '웹사이트', fFound: '이 보고서',
    found: (n: number) => `${n}개 항목 발견`,
    fileFoot: (d: string) => `${d} 공개 자료로 작성`,
    strip: { strengths: (_n: number) => '출처가 확인해 주는 강점', problems: (_n: number) => '귀사를 찾아보는 사람이 마주칠 문제', contradictions: (_n: number) => '출처마다 다른 정보', notes: (_n: number) => '확인해 볼 만한 신호' },
    fHighest: '최고 긴급도',
    execH: '조치가 필요합니다.',
    exec: (p: number, c: number, hi: number) => `문제점 ${p}개와 출처마다 다른 정보 ${c}건을 찾았습니다${hi ? `. 그중 ${hi}건은 긴급입니다` : ''}.`,
    execContra: '이 차이가 공개된 채로 있는 동안, 고객과 은행, 파트너는 귀사의 서로 다른 두 모습을 보게 됩니다.',
    execPlain: '이 문제가 공개된 채로 있는 동안, 고객과 은행, 파트너가 그대로 마주칩니다.',
    lvl: { urgent: '긴급', important: '중요', minor: '경미' } as Record<Level, string>,
    urgLabel: '긴급도',
    urgHow: '긴급도는 영향을 받는 기록의 종류(등록, 면허, 연락처, 이메일 등), 증거의 확실성, 영향이 닥치는 시점으로 코드가 정합니다. 긴급은 가장 먼저 고쳐야 한다는 뜻입니다.',
    topic: { contact: '연락처', identity: '회사 정보', website: '웹사이트', email: '이메일', reviews: '리뷰', scale: '회사 규모', licence: '면허', awards: '수상', registration: '등록', reputation: '평판', other: '기타' } as Record<string, string>,
    hint: '항목',
    tag: { strength: '강점', problem: '문제점', contra: '출처마다 다름', note: '확인해 볼 점' },
    why: '왜 중요한가', sources: '출처', source: '출처', value: '내용',
    lab: { strength: '강점', problem: '문제', contra: '출처 불일치', note: '신호' },
    stakeH: '무엇이 걸려 있는가.',
    stake: (price: string | null) => `아래 내용 때문에 고객 한 명을 잃는 비용이 이 보고서보다 큽니다.${price ? ` 전체 보고서는 ${price}입니다.` : ''}`,
    stakeGood: '이 무료 보고서에서는 문제가 발견되지 않았습니다. AI 비서 질문, 구글 지도 검색, 공식 등록부 확인은 하지 않았으며, 전체 보고서에서 진행합니다.',
    qEye: '세 가지 질문', qH: '모든 대표가 답할 수 있어야 하는', qG: '세 가지 질문.',
    q1: '누가 우리 고객을 가져가고 있는가?', q2: '은행이나 입찰 심사단이 우리를 믿을까?', q3: '낯선 사람은 무엇을 보는데 나는 모르는가?',
    st: { bad: '문제 발견', good: '양호', none: '여기서는 확인하지 않음' },
    q1None: '이 무료 보고서는 귀사 업종에 대해 AI 비서에게 묻거나 구글 지도를 검색하지 않았습니다.',
    q1Lock: 'AI 비서와 구글 지도가 귀사 고객을 어느 경쟁사로 보내는지, 그리고 그 이유.',
    q2Bad: (n: number) => `은행과 입찰 심사단이 확인하는 기록 ${n}건에 문제가 있거나 출처마다 다릅니다.`,
    q2Good: (n: number) => `은행과 입찰 심사단이 확인하는 기록 ${n}건이 외부 출처로 확인됩니다.`,
    q2None: '이 무료 보고서에서는 확인할 등록, 면허, 수상 기록을 찾지 못했습니다.',
    q2Lock: '어떤 자격인지, 어느 공식 등록부인지, 각각 무엇을 해야 하는지.',
    q3Bad: (p: number, c: number, n: number) => [p ? `귀사를 찾아보는 사람이 마주칠 문제 ${p}개.` : '', c ? `출처마다 귀사 정보가 다른 곳 ${c}건.` : '', n ? `확인해 볼 만한 신호 ${n}개.` : ''].filter(Boolean).join(' '),
    q3Good: '살펴본 출처들은 귀사에 대해 일관된 이야기를 합니다.',
    q3Lock: '각 값, 그 값을 게시한 출처, 그리고 어느 쪽이 맞는지.',
    inFull: '전체 보고서에서:',
    proofEye: '전체 공개 항목 하나', proofH: '증거와 함께 보여 드리는 한 가지.', proofG: '1분이면 직접 확인하실 수 있습니다.',
    proofP: '나머지 발견 사항은 아래에 제목만 있습니다. 증거, 출처, 해결 방법은 전체 보고서에 있습니다.',
    areasEye: '찾은 내용', areasH: '찾은 내용,', areasG: '사업 영역별로.',
    areasP: '제목만 있습니다. 각 항목의 값, 출처, 해결 방법은 전체 보고서에 있습니다.',
    area: { found: '검색되기', reached: '연락이 닿기', credibility: '은행과 입찰에서의 신뢰도', reputation: '평판', name: '회사 이름에 대한 위험', other: '기타' } as Record<Area, string>,
    areasLockH: (n: number) => `발견 사항 ${n}건 전체의 증거`,
    areasLockP: '각 항목이 어디에 있는지, 출처마다 무엇이라고 하는지, 해결 방법까지 전체 보고서에 있습니다.',
    strEye: '잘되고 있는 것', strH: '잘되고 있는 것.', strG: '각 항목 아래 출처가 확인해 줍니다.',
    moreStrengths: (n: number) => `확인된 강점 ${n}개가 더 있으며, 전체 보고서에 나와 있습니다.`,
    noStrengths: '이 무료 보고서에서는 아직 강점을 확인해 주는 외부 출처를 찾지 못했습니다. 전체 보고서는 등록부, 수상, 리뷰에서 이를 확인합니다.',
    notEye: '이 페이지에 없는 것', notH: '이 무료 보고서가', notG: '알려 드리지 않는 것.',
    not: {
      rivals: 'AI 비서와 구글 지도가 귀사 대신 추천하는 경쟁사.',
      records: '은행이나 입찰 심사단이 공식 등록부에서 확인할 수 있는 귀사의 자격.',
      values: '어떤 정보가 틀렸는지, 출처마다 무엇이라고 하는지, 어디에 게시되어 있는지.',
      fixes: '무엇부터 고칠지, 누가 하는지, 얼마나 걸리는지.',
    },
    cta: '전체 보고서 받기', ctaP: '이 링크를 받은 이메일에 회신해 주시면 진행해 드립니다.', keep: '이 무료 보고서는 귀사가 보관하시면 됩니다.',
    guarantee: '보장: 전체 보고서에 이 무료 보고서에 없는 발견 사항이 10건 미만이면 전액 환불해 드립니다.',
    colophon: [['받는 곳', (c: string, _d: string, _n: number) => c], ['작성', (_c: string, d: string, n: number) => (n ? `${d}, 공개 출처 ${n}곳 기준` : `${d}, 공개 자료 기준`)], ['구분', () => '무료 보고서 · 1차 조사'], ['방법', () => '전체 보고서의 모든 내용은 출처로 확인할 수 있습니다.']] as Array<[string, (c: string, d: string, n: number) => string]>,
    unlock: '모든 발견 사항 보기',
    stickyN: (n: number) => `${n}건 발견`,
    stickyP: '출처, 증거, 모든 해결 방법은 전체 보고서에 있습니다.',
    insideEye: '받으시는 내용', insideH: '전체 보고서가', insideG: '손에 쥐여 드리는 것.',
    insideP: '무료 보고서는 문제가 있다는 것을 보여 드립니다. 전체 보고서는 귀사 팀이 바로 쓸 수 있는 실무 문서입니다: 각 문제가 어디에 있는지, 누가 고치는지, 가능한 곳은 해결책까지 써 드립니다.',
    gets: [
      { h: '한 페이지 대표 요약', p: '대표님만 내릴 수 있는 결정과, 각 결정에 걸린 것.' },
      { h: '경쟁사, 이름까지', p: 'ChatGPT, Gemini, 구글 지도가 귀사 고객을 어느 경쟁사로 보내는지, 그리고 그 이유.' },
      { h: '공식 등록부로 확인한 귀사의 자격', p: '은행이나 입찰 심사단이 확인할 수 있는 것과 없는 것.' },
      { h: '부서별 할 일 목록', p: '웹사이트, 소셜 미디어, IT, 기타: 누가 무엇을 하는지, 얼마나 걸리는지, 얼마나 중요한지.', note: (n: GetsN) => (n.findings ? `이 무료 보고서의 발견 사항 최소 ${n.findings}건에서 시작하며, 각각 증거와 해결 방법이 있습니다.` : '') },
      { h: '바로 쓸 수 있게 써 드립니다', p: '홈페이지 문구, 리뷰 답글, FAQ, 지역별 페이지를 확인된 사실로만 작성합니다.' },
    ] as Array<{ h: string; p: string; note?: (n: GetsN) => string }>,
    diyH: '직접 하신다면',
    diy: (pages: number) => `직접 확인하시려면: ${pages ? `이 보고서의 근거가 된 공개 페이지 ${pages}개를 읽고, ` : ''}고객이 묻는 질문을 AI 비서에게 묻고, 구글 지도를 지역별로 검색하고, 공식 등록부에서 귀사를 찾아보셔야 합니다.`,
    missing: '이 보고서는 아직 준비되지 않았습니다.', missingP: '잠시 후 이 링크로 다시 와 주세요.',
  },
};

const FONTS = (ko: boolean) => `<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter+Tight:wght@500;600&family=Inter:wght@400;500;600;700${ko ? '&family=Noto+Sans+KR:wght@400;500;600;700' : ''}&display=swap">`;

/** The v1 preview's stylesheet, cut down to what this page uses, plus the V2.1 parts (sources, versions, steps). */
const CSS = `
:root{--ink:#111418;--grey:#5c636d;--muted:#8a9099;--line:#e6e8eb;--band:#f2f3f5;--paper:#fff;--dark:#0e1013;--dark2:#1b2129;--on-dark:#f3f4f6;--on-dark-2:#9aa1ab;
--contra:#a15c07;--contra-bg:#fdf3e2;--missing:#475467;--missing-bg:#eef0f2;--wrong:#b42318;--wrong-bg:#fdecea;--good:#067647;--good-bg:#e5f4ec;
--display:"Inter Tight","Inter","Noto Sans KR",system-ui,sans-serif;--body:"Inter","Noto Sans KR",system-ui,sans-serif;--w:1120px;--gut:max(20px,calc((100vw - var(--w)) / 2))}
*{box-sizing:border-box}html{scroll-behavior:smooth;-webkit-print-color-adjust:exact;print-color-adjust:exact}
body{margin:0;background:var(--paper);color:var(--ink);font-family:var(--body);font-size:16px;line-height:1.55;font-kerning:normal;text-rendering:optimizeLegibility}
h1,h2,h3{font-family:var(--display);font-weight:600;margin:0;letter-spacing:-0.025em;line-height:1.05;text-wrap:balance}p{margin:0}a{color:inherit}
p,li,dd{text-wrap:pretty}:lang(ko) h1,:lang(ko) h2,:lang(ko) h3{word-break:keep-all}::selection{background:var(--ink);color:#fff}a:focus-visible{outline:2px solid currentColor;outline-offset:3px}
.g{color:var(--grey)}.dark .g{color:var(--on-dark-2)}
section{padding:96px var(--gut);scroll-margin-top:60px}.dark{background:var(--dark);color:var(--on-dark);-webkit-font-smoothing:antialiased}
.band{background:var(--band)}
.eyebrow{font-size:12px;font-weight:600;letter-spacing:.14em;text-transform:uppercase;color:var(--muted)}.dark .eyebrow{color:var(--on-dark-2)}
h2{font-size:clamp(34px,4.4vw,58px);max-width:16em}.lead{font-size:19px;line-height:1.5;color:var(--grey);max-width:38em}.dark .lead{color:var(--on-dark-2)}
.head{display:grid;gap:14px;margin-bottom:44px}
.btn{display:inline-flex;align-items:center;gap:8px;background:#fff;color:var(--ink);font-weight:600;padding:14px 22px;text-decoration:none;font-size:15px}
.btn.ghost{background:none;color:inherit;border:1px solid currentColor;opacity:.85}.btn:hover{opacity:.9}.btn:focus-visible{outline:2px solid currentColor;outline-offset:3px}
.top{position:sticky;top:0;z-index:10;display:flex;justify-content:space-between;align-items:center;gap:16px;padding:10px var(--gut);background:rgba(14,16,19,.92);backdrop-filter:blur(10px);color:var(--on-dark);font-size:13px}
.top b{font-weight:600}.top span{color:var(--on-dark-2)}.top .btn{padding:9px 14px;font-size:13px}
.hero{display:grid;grid-template-columns:minmax(0,1.35fr) minmax(0,1fr);gap:56px;align-items:center;padding-top:88px;padding-bottom:88px}
.hero h1{font-size:clamp(36px,4.6vw,64px);letter-spacing:-0.03em;line-height:1.05;margin-top:18px;overflow-wrap:break-word}
.hero .lead{margin-top:22px;color:var(--on-dark);opacity:.86;display:grid;gap:10px}.ctas{display:flex;flex-wrap:wrap;gap:12px;margin-top:32px}
.hero .anyone{margin-top:18px;font-size:13.5px;color:var(--on-dark-2)}
a.cite{font-size:.62em;font-weight:600;text-decoration:none;vertical-align:super;color:var(--muted);margin-left:3px;letter-spacing:.02em}.dark a.cite{color:var(--on-dark-2)}
.file{background:var(--paper);color:var(--ink);padding:26px;display:grid;gap:14px;border-top:3px solid var(--ink);box-shadow:0 0 0 1px rgba(255,255,255,.1)}
.hero>div{min-width:0}.hero .lead{max-width:100%}
.filehead{display:flex;justify-content:space-between;align-items:center;gap:12px}
.file .stamp{font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#fff;background:var(--ink);padding:4px 9px}
.fileno{font-size:11px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;color:var(--muted)}
.file h3{font-size:24px;letter-spacing:-0.02em}.file dl{margin:0;display:grid;font-size:13.5px}
.file dl div{display:grid;grid-template-columns:96px minmax(0,1fr);gap:10px;padding:7px 0;border-top:1px solid var(--line)}.file dt{color:var(--muted)}.file dd{margin:0;overflow-wrap:anywhere}
.file .foot{font-size:12px;color:var(--muted)}
.strip{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:24px;padding:48px var(--gut);border-bottom:1px solid var(--line)}
.strip a{text-decoration:none;display:grid;gap:6px;align-content:start}
.strip b{display:block;font-family:var(--display);font-size:clamp(40px,4.6vw,60px);font-weight:500;letter-spacing:-0.04em;line-height:1;font-variant-numeric:tabular-nums lining-nums}
.strip span{font-size:14px;color:var(--grey)}.strip a:hover b{opacity:.75}
.thesis{text-align:center;display:grid;justify-items:center;gap:18px;padding-top:112px;padding-bottom:112px;border-bottom:1px solid var(--line)}
.thesis h2{font-size:clamp(38px,5.4vw,72px);letter-spacing:-0.035em;max-width:none}.thesis .lead{max-width:40em}
.tag{display:inline-block;font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;padding:4px 9px}
.tag.good{color:var(--good);background:var(--good-bg)}.tag.wrong{color:var(--wrong);background:var(--wrong-bg)}.tag.contra{color:var(--contra);background:var(--contra-bg)}.tag.missing{color:var(--missing);background:var(--missing-bg)}
.warns{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}.warns.one{grid-template-columns:minmax(0,1fr)}
.warn{background:var(--paper);padding:24px;display:grid;gap:10px;align-content:start;border-top:3px solid var(--ink);scroll-margin-top:70px}
section:not(.band) .warn{background:var(--band)}
.warn.good{border-top-color:var(--good)}.warn.wrong{border-top-color:var(--wrong)}.warn.contra{border-top-color:var(--contra)}.warn.missing{border-top-color:var(--missing)}
.warnhead{display:flex;justify-content:space-between;align-items:center;gap:12px}
.warn h3{font-size:21px;letter-spacing:-0.015em;line-height:1.2}.warn .d{color:var(--grey);font-size:15px}
.warn .risk{font-size:14px;border-left:2px solid var(--ink);padding-left:10px}.warn .risk b{font-weight:600}
.warns .warn.first{grid-column:1/-1;background:var(--dark);color:var(--on-dark);-webkit-font-smoothing:antialiased}.warn.first .d{color:var(--on-dark-2)}
.warn.first .risk{border-left-color:#fff}.warn.first h3{font-size:clamp(24px,2.6vw,30px)}.warn.first .fileno{color:var(--on-dark-2)}
.src{font-size:13px}.src>summary{cursor:pointer;color:var(--grey);font-weight:600;padding:6px 0 2px;border-top:1px solid var(--line)}.warn.first .src>summary{color:var(--on-dark-2);border-top-color:#2a3038}
.src ol{margin:8px 0 0;padding-left:20px;display:grid;gap:8px}.src q{display:block;quotes:"“" "”"}.src .u{display:block;color:var(--muted);overflow-wrap:anywhere;font-size:12.5px}.warn.first .src .u{color:var(--on-dark-2)}
.ledger{width:100%;border-collapse:collapse;background:var(--paper);font-size:15px}
.ledger th{text-align:left;font-size:11.5px;letter-spacing:.1em;text-transform:uppercase;color:var(--muted);padding:10px 16px;font-weight:600;border-bottom:2px solid var(--ink)}
.ledger td{padding:14px 16px;border-top:1px solid var(--line);vertical-align:top}.ledger tr:first-child td{border-top:0}
.ledger .where{color:var(--grey);font-size:14px;width:38%}.ledger .where small{display:block;color:var(--muted);font-size:12.5px;overflow-wrap:anywhere}
.ledger .said{display:grid;gap:4px}.ledger .said b{font-weight:600}.ledger .said q{color:var(--grey);font-size:13.5px;quotes:"“" "”"}
.sugs{display:grid;border:1px solid var(--line)}
.warn.first .ledger{color:var(--ink)}
.sug{display:grid;grid-template-columns:44px minmax(0,1fr) 220px;gap:18px;padding:20px 22px;border-top:1px solid var(--line);scroll-margin-top:70px}.sug:first-child{border-top:0}
.sug .rn{font-family:var(--display);font-size:28px;font-weight:500;letter-spacing:-0.04em;line-height:1;color:var(--muted);font-variant-numeric:tabular-nums}
.sug .rw{display:grid;gap:6px}.sug .rw b{font-family:var(--display);font-size:19px;font-weight:600;letter-spacing:-0.015em;line-height:1.25}.sug .rw p{font-size:15px;color:var(--grey)}
.sug .on{display:grid;gap:6px;align-content:start;font-size:12.5px;color:var(--muted)}.sug .on .k{font-size:10.5px;font-weight:700;letter-spacing:.1em;text-transform:uppercase}
.ids{display:flex;flex-wrap:wrap;gap:6px}.ids a{font-size:12px;font-weight:600;text-decoration:none;color:var(--ink);background:var(--band);padding:3px 8px}.ids a:hover{background:var(--line)}
.band-cta{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:32px;align-items:center;padding-top:72px;padding-bottom:72px}.band-cta h2{font-size:clamp(30px,3.4vw,46px)}
.ask{scroll-margin-top:70px;background:var(--dark2);padding:32px;display:grid;gap:12px;border-top:3px solid #fff}
.ask h3{font-size:clamp(30px,3.4vw,44px);letter-spacing:-0.03em;line-height:1}.ask p{color:var(--on-dark-2);font-size:15px}.ask p.me{color:var(--on-dark);font-size:17px}
footer{padding:48px var(--gut) 64px;font-size:13px;color:var(--grey);display:grid;gap:12px}
.colophon{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:18px;padding-top:20px;border-top:1px solid var(--line)}
.colophon div{display:grid;gap:4px;align-content:start}.colophon .k{font-size:11px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;color:var(--muted)}.colophon span:not(.k){color:var(--ink);font-size:13.5px}
.warnhead .fileno,.sug .fileno{text-transform:none;letter-spacing:.04em}
.notready{min-height:100vh;display:grid;align-content:center;gap:18px}
@media (max-width:900px){section{padding-top:64px;padding-bottom:64px}.hero{grid-template-columns:1fr;gap:40px;padding-top:56px}.file{transform:none}
.strip{grid-template-columns:1fr 1fr}.warns{grid-template-columns:1fr}.band-cta{grid-template-columns:1fr}.colophon{grid-template-columns:1fr 1fr}
.top span.for{display:none}.lead{font-size:17px}.sug{grid-template-columns:36px minmax(0,1fr)}.sug .on{grid-column:2}}
@media (max-width:700px){.ledger thead{display:none}.ledger tr{display:grid;gap:6px;padding:12px 14px;border-top:1px solid var(--line)}.ledger tr:first-child{border-top:0}
.ledger td{display:block;padding:0;border:0;width:auto!important}
.warn{padding:20px}}
@media print{.top,.ctas,.band-cta .btn{display:none}section{padding:32px 28px}.file{transform:none;box-shadow:none;border:1px solid var(--line)}
.warn,.sug,.ledger tr,.colophon{break-inside:avoid}.head,h2,h3{break-after:avoid}details>:not(summary){display:block}details::details-content{display:block;content-visibility:visible}.sticky{display:none}}
/* urgency badges, locked placeholders, the sticky bar (2026-11-08) */
body{padding-bottom:68px}
.hl{display:inline-flex;flex-wrap:wrap;align-items:center;gap:8px}
.urg{display:inline-flex;align-items:center;gap:6px;font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;padding:4px 9px;border:1px solid transparent;white-space:nowrap}
.urg::before{content:"";width:7px;height:7px;border-radius:50%;background:currentColor;flex:none}
.urg.critical{background:var(--wrong);color:#fff}.urg.high{background:var(--wrong-bg);color:var(--wrong);border-color:#f1b8b2}
.urg.medium{background:var(--contra-bg);color:var(--contra);border-color:#f0d6a4}.urg.low{background:var(--missing-bg);color:var(--missing);border-color:#d0d5dd}
.hero .urg{vertical-align:middle}
.pitch{font-family:var(--display);font-size:clamp(20px,2.2vw,26px);font-weight:600;letter-spacing:-0.015em;line-height:1.25;max-width:34em;color:var(--ink)}
.pitch span{display:block;font-family:var(--body);font-weight:400;font-size:15px;letter-spacing:0;color:var(--grey);margin-top:6px}
.legend{font-size:13px;color:var(--muted);max-width:52em;margin:-24px 0 28px}
.exec{margin-top:22px;border-left:3px solid #ff8a7a;background:rgba(255,255,255,.06);padding:14px 18px;font-size:15px;max-width:38em;display:grid;gap:4px}
.exec span{color:var(--on-dark-2);font-size:14px}
.callout{margin:48px var(--gut) 0;border-left:4px solid var(--wrong);background:var(--wrong-bg);padding:20px 24px;display:grid;gap:6px;color:var(--ink)}
.callout b{font-family:var(--display);font-size:20px;letter-spacing:-0.01em}.callout span{font-size:15px;color:var(--grey);max-width:56em}
.warn.locked{border-top-color:var(--line)}
.topic{font-family:var(--display);font-size:19px;font-weight:600;letter-spacing:-0.01em}
.bars{display:grid;gap:9px}.bars i{display:block;height:11px;background:#dfe2e6}.bars i.s{width:58%}.bars i.m{width:84%}
.lk{display:flex;align-items:center;gap:8px;font-size:11.5px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--grey)}
.lk svg{flex:none}
.unlock{background:var(--dark);color:var(--on-dark);padding:28px;display:grid;grid-template-columns:minmax(0,1fr) auto;gap:20px;align-items:center;border-top:3px solid #fff;-webkit-font-smoothing:antialiased}.warns .unlock{grid-column:1/-1}
.unlock h3{font-size:clamp(24px,2.6vw,32px)}.unlock p{color:var(--on-dark-2);font-size:15px;margin-top:6px}.unlock .tally{color:var(--on-dark);font-weight:600;font-size:14px;margin-top:10px}
.sug.locked{background:var(--band)}.sug.locked .rw{gap:9px;align-content:center}
.sticky{position:fixed;left:0;right:0;bottom:0;z-index:20;display:flex;justify-content:space-between;align-items:center;gap:14px;padding:10px var(--gut);background:rgba(14,16,19,.96);backdrop-filter:blur(10px);color:var(--on-dark);font-size:14px}
.sticky .l{display:flex;align-items:center;gap:12px;min-width:0}.sticky .n{flex:none;background:var(--wrong);color:#fff;font-size:11px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;padding:4px 9px}
.sticky .p{color:var(--on-dark-2)}.sticky .btn{padding:10px 16px;font-size:14px;white-space:nowrap}
.sticky .r{display:flex;align-items:center;gap:14px;flex:none}.sticky .pr{font-family:var(--display);font-size:18px;font-weight:600;letter-spacing:-0.01em}
.ask .price{font-family:var(--display);font-size:44px;font-weight:600;letter-spacing:-0.03em;line-height:1;color:#fff}
.gets{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}
.get{background:var(--paper);padding:24px;display:grid;gap:8px;align-content:start;border-top:3px solid var(--ink)}section:not(.band) .get{background:var(--band)}
.get .rn{font-size:12px;font-weight:600;letter-spacing:.12em;color:var(--muted);font-variant-numeric:tabular-nums}
.get h3{font-size:21px;letter-spacing:-0.015em;line-height:1.2}.get p{color:var(--grey);font-size:15px}
.get p.free{color:var(--ink);font-size:13.5px;font-weight:600;border-left:2px solid var(--ink);padding-left:10px;margin-top:4px}
.gets .unlock,.gets .ask{grid-column:1/-1}.gets .get:nth-last-child(2):nth-child(odd){grid-column:1/-1}
@media (max-width:900px){.gets{grid-template-columns:1fr}.unlock{grid-template-columns:1fr}.callout{margin-top:32px}}
@media (max-width:640px){.sticky .p{display:none}.legend{margin-top:-28px}}
/* the 2026-11-10 preview: three levels, three questions, findings by area, what the page does not tell you */
.urg.urgent{background:var(--wrong);color:#fff}.urg.important{background:var(--contra-bg);color:var(--contra);border-color:#f0d6a4}.urg.minor{background:var(--missing-bg);color:var(--missing);border-color:#d0d5dd}
.callout.calm{border-left-color:var(--good);background:var(--good-bg)}
.qs{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px}
.ql{display:flex;gap:8px;align-items:flex-start;font-size:14px;color:var(--grey);border-top:1px solid var(--line);padding-top:10px;margin-top:auto}.ql svg{flex:none;margin-top:3px}.ql b{color:var(--ink);font-weight:600}
.areas{display:grid;gap:28px}.area h3{font-size:21px;letter-spacing:-0.015em;margin-bottom:10px}
.rows{list-style:none;margin:0;padding:0;border:1px solid var(--line);background:var(--paper)}
.rows li{display:grid;grid-template-columns:118px minmax(0,1fr) auto;gap:14px;align-items:center;padding:14px 18px;border-top:1px solid var(--line);scroll-margin-top:70px}.rows li:first-child{border-top:0}
.rows .rt{font-size:15.5px}.rows .kd{font-size:12px;color:var(--muted);white-space:nowrap}
.areas .unlock{margin-top:4px}
p.more{margin-top:18px;color:var(--grey);font-size:15px}
.nots{margin:0;padding-left:22px;display:grid;gap:12px;font-size:18px;max-width:44em}
.gets .diy{grid-column:1/-1;background:var(--paper);border-top:3px solid var(--line);padding:24px;display:grid;gap:8px}section:not(.band) .gets .diy{background:var(--band)}
.diy h3{font-size:21px;letter-spacing:-0.015em}.diy p{color:var(--grey);font-size:15px;max-width:52em}
.ask p.guar{color:var(--on-dark);font-size:15px;border-left:2px solid #fff;padding-left:10px}
@media (max-width:900px){.qs{grid-template-columns:1fr}}
@media (max-width:640px){.rows li{grid-template-columns:1fr;gap:6px}}
`;


function linkText(url: string): string {
  return url.replace(/^https?:\/\/(www\.)?/i, '').replace(/\/$/, '').slice(0, 80);
}

function sourceLink(url: string): string {
  return /^https?:\/\//i.test(url) ? `<a href="${esc(url)}" rel="nofollow noopener" target="_blank">${esc(linkText(url))}</a>` : esc(url);
}

function evidenceList(ev: Array<{ quoted_text: string; source_url: string }>, label: string): string {
  if (!ev?.length) return '';
  return `<details class="src"><summary>${esc(label)} (${ev.length})</summary><ol>${ev.map((e) => `<li><q>${esc(e.quoted_text)}</q><span class="u">${sourceLink(e.source_url)}</span></li>`).join('')}</ol></details>`;
}

const two = (n: number) => String(n).padStart(2, '0');
/** The noun part of a plural() phrase: "problems" for 2, "problem" for 1. */
const noun = (n: number, one: string, many: string) => plural(n, one, many).slice(String(n).length + 1);

/**
 * The free report page (docs/preview-writing-plan.md): headline, what is at stake, three questions, one proof item in
 * full, every other finding as a title by business area, what is working, what this page does not tell you, what the
 * full report gives, doing it yourself, price and guarantee, how it was built. Every section has a version for missing
 * data and for good news; none is dropped silently. Never throws on a missing field.
 */
export function reportPage(report: Step3Report, s2: Step2V2Output, options: { debug?: boolean; now?: Date; price?: string | null } = {}): string {
  const now = options.now ?? new Date();
  const ko = report.language === 'ko';
  const t = ko ? P.ko : P.en;
  const c = s2.input.company;
  const loc = localeFor(s2.input.country, ko ? 'ko' : 'en');
  const price = options.price || null; // one USD price for every country, read from the hub DB by the caller
  // A missing or invalid created_at falls back to now, so the date line never reads "Invalid Date" or throws.
  const made = new Date(report.created_at);
  const when = Number.isNaN(made.getTime()) ? now : made;
  let date: string;
  try { date = when.toLocaleDateString(loc.dateLocale, { day: 'numeric', month: 'short', year: 'numeric' }); } catch { date = when.toISOString().slice(0, 10); }
  type Finding = Step2V2Output['conclusive_findings'][number];
  type Contra = Step2V2Output['contradictions'][number];
  type Note = Step2V2Output['take_note'][number];
  type Extra = { paid_only?: boolean; identity_signal?: boolean; check_id?: string; expires_at?: string };

  // Never print the same id twice.
  const seen = new Set<string>();
  const usable = <T extends { id: string }>(list: T[] | undefined): T[] => (Array.isArray(list) ? list : []).filter((x) => {
    if (!x?.id || seen.has(x.id)) return false;
    seen.add(x.id);
    return true;
  });
  const findings = usable(s2.conclusive_findings);
  const contraAll = usable(s2.contradictions);
  const noteAll = usable(s2.take_note);

  const quotes = (ev: Array<{ quoted_text: string }> | undefined) => (Array.isArray(ev) ? ev : []).map((e) => e?.quoted_text ?? '');
  const ratings = new Map<string, Rated>();
  for (const f of findings) ratings.set(f.id, rate({ ...f, expires_at: (f as Finding & Extra).expires_at }, [f.title, f.statement, f.why_it_matters, ...quotes(f.evidence)], now));
  for (const x of contraAll) ratings.set(x.id, rate({ ...x, expires_at: (x as Contra & Extra).expires_at }, [x.title, x.why_it_matters, ...(Array.isArray(x.versions) ? x.versions : []).flatMap((v) => [v?.value, v?.quoted_text])], now));
  for (const x of noteAll) ratings.set(x.id, rate({ topic: x.topic, expires_at: (x as Note & Extra).expires_at }, [x.title, x.note, ...quotes(x.evidence)], now));
  const keyOf = (id: string) => ratings.get(id)?.key ?? 0;
  const levelOfId = (id: string) => levelOf(ratings.get(id)?.urg ?? 'low');

  const strengths = ranked(findings.filter((f) => f.kind === 'strength'), (f) => keyOf(f.id));
  const problems = ranked(findings.filter((f) => f.kind === 'problem'), (f) => keyOf(f.id));
  const contradictions = ranked(contraAll, (x) => keyOf(x.id));
  const notes = ranked(noteAll, (x) => keyOf(x.id));

  // The proof: the LLM's pick when it is a problem or contradiction here, else rank #1 of both together.
  const issuesRanked = ranked<{ id: string }>([...problems, ...contradictions], (x) => keyOf(x.id));
  const proofId = typeof report.proof === 'string' && issuesRanked.some((x) => x.id === report.proof) ? report.proof : issuesRanked[0]?.id ?? null;
  const proofF = problems.find((f) => f.id === proofId);
  const proofC = contradictions.find((x) => x.id === proofId);
  const strengthsShown = strengths.slice(0, FREE_N.strengths);

  // Every other problem, contradiction and signal is listed by title only.
  type Listed = { id: string; kind: 'problem' | 'contra' | 'note'; topic: string };
  const listed: Listed[] = ranked<Listed>([
    ...problems.map((x) => ({ id: x.id, kind: 'problem' as const, topic: String(x.topic ?? 'other') })),
    ...contradictions.map((x) => ({ id: x.id, kind: 'contra' as const, topic: String(x.topic ?? 'other') })),
    ...notes.map((x) => ({ id: x.id, kind: 'note' as const, topic: String(x.topic ?? 'other') })),
  ].filter((x) => x.id !== proofId), (x) => keyOf(x.id));
  const titles: Record<string, unknown> = report.titles && typeof report.titles === 'object' ? report.titles : {};

  // A fallback title: the kind of record plus a short hint (the check, else "issue 2"), unique on the page. No values.
  const teaser = new Map<string, string>();
  {
    const used = new Set<string>(); const perTopic = new Map<string, number>();
    for (const x of listed) {
      const topic = t.topic[x.topic] ?? t.topic.other;
      const k = (perTopic.get(topic) ?? 0) + 1; perTopic.set(topic, k);
      const all = [...problems, ...contradictions, ...notes] as Array<{ id: string } & Extra>;
      const check = String(all.find((y) => y.id === x.id)?.check_id ?? '').replace(/[_-]+/g, ' ').trim();
      let title = `${topic}: ${check || `${t.hint} ${k}`}`;
      if (used.has(title)) title = `${topic}: ${t.hint} ${k}`;
      for (let n = 2; used.has(title); n++) title = `${topic}: ${t.hint} ${k}.${n}`;
      used.add(title); teaser.set(x.id, title);
    }
  }
  const titleOf = (id: string) => (typeof titles[id] === 'string' && (titles[id] as string).trim() ? (titles[id] as string).trim() : teaser.get(id) ?? '');

  // Distinct public sources behind the report.
  const urls = new Set<string>();
  const addUrls = (ev: unknown) => { for (const e of Array.isArray(ev) ? ev : []) if (typeof e?.source_url === 'string' && e.source_url.trim()) urls.add(e.source_url.trim()); };
  for (const f of findings) addUrls(f.evidence);
  for (const x of noteAll) addUrls(x.evidence);
  for (const x of contraAll) addUrls(x.versions);

  // Every number on the page reads from this object. "issues" = problems + contradictions; "findings" adds the signals;
  // "items" adds the strengths.
  const isRecord = (x: { topic?: string }) => RECORD_TOPICS.has(String(x.topic));
  const counts = {
    strengths: strengths.length, problems: problems.length, contradictions: contradictions.length, notes: notes.length,
    issues: problems.length + contradictions.length,
    findings: problems.length + contradictions.length + notes.length,
    items: strengths.length + problems.length + contradictions.length + notes.length,
    sources: urls.size,
    shown: { strengths: strengthsShown.length, proof: proofId ? 1 : 0, listed: listed.length },
    urgent: issuesRanked.filter((x) => levelOfId(x.id) === 'urgent').length,
    recordsBad: [...problems, ...contradictions].filter(isRecord).length,
    recordsGood: strengths.filter(isRecord).length,
  };
  // The same numbers, flat, on the body tag (data-count="key" elements match it).
  const flatCounts: Record<string, number> = { ...Object.fromEntries(Object.entries(counts).filter(([, v]) => typeof v === 'number')), ...Object.fromEntries(Object.entries(counts.shown).map(([k, v]) => [`shown.${k}`, v])) } as Record<string, number>;

  // Short customer-facing labels for ids; the id itself is only in title= / data-id, or printed in debug mode.
  const labels = new Map<string, string>();
  strengths.forEach((x, i) => labels.set(x.id, `${t.lab.strength} ${i + 1}`));
  problems.forEach((x, i) => labels.set(x.id, `${t.lab.problem} ${i + 1}`));
  contradictions.forEach((x, i) => labels.set(x.id, `${t.lab.contra} ${i + 1}`));
  notes.forEach((x, i) => labels.set(x.id, `${t.lab.note} ${i + 1}`));
  // Only ids printed on the page get a link, so no link is dead.
  const onPage = new Set<string>([...strengthsShown.map((x) => x.id), ...(proofId ? [proofId] : []), ...listed.map((x) => x.id)]);
  const labelOf = (id: string) => (options.debug ? `${labels.get(id) ?? ''} (${id})` : labels.get(id) ?? '');
  const idAttr = (id: string) => `title="${esc(id)}" data-id="${esc(id)}"`;
  const cites = (ids: string[]) => (Array.isArray(ids) ? ids : []).filter((id) => labels.has(id) && onPage.has(id)).map((id) => `<a class="cite" href="#${esc(id)}" ${idAttr(id)}>${esc(labelOf(id))}</a>`).join('');

  const badge = (lv: Level) => `<span class="urg ${lv}" aria-label="${esc(t.urgLabel)}: ${esc(t.lvl[lv])}">${esc(t.lvl[lv])}</span>`;
  const lockIcon = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>';
  const sites = (Array.isArray(s2.baseline?.websites) ? s2.baseline.websites : []).map((w) => String(w).replace(/\s*\(.*\)\s*$/, '')).filter(Boolean).slice(0, 3);
  const topLevel = issuesRanked[0] ? levelOfId(issuesRanked[0].id) : null;

  const head = (eye: string, h: string, g: string, lead = '', countKey = '', n?: number) =>
    `<div class="head"><p class="eyebrow"${countKey ? ` data-count="${countKey}"` : ''}>${esc(eye)}${n !== undefined ? ` · ${n}` : ''}</p><h2>${esc(h)}<br><span class="g">${esc(g)}</span></h2>${lead ? `<p class="lead">${esc(lead)}</p>` : ''}</div>`;
  const cardHead = (cls: string, label: string, id: string, lv?: Level) => `<div class="warnhead"><span class="hl"><span class="tag ${cls}">${esc(label)}</span>${lv ? badge(lv) : ''}</span><span class="fileno" ${idAttr(id)}>${esc(labelOf(id))}</span></div>`;
  const lockNote = (text: string) => `<p class="ql">${lockIcon}<span><b>${esc(t.inFull)}</b> ${esc(text)}</span></p>`;
  const unlockCard = (title: string, text: string, key = '') => `<div class="unlock"><div><h3${key ? ` data-count="${key}"` : ''}>${esc(title)}</h3><p>${esc(text)}</p></div><a class="btn" href="#order">${esc(t.unlock)}&nbsp;→</a></div>`;

  // A strength, or the proof problem, in full; the proof shows its first piece of evidence only.
  const finding = (f: Finding, proof = false) => {
    const cls = f.kind === 'strength' ? 'good' : 'wrong';
    const ev = Array.isArray(f.evidence) ? (proof ? f.evidence.slice(0, 1) : f.evidence) : [];
    return `<article class="warn ${cls}${proof ? ' first' : ''}" id="${esc(f.id)}">${cardHead(cls, f.kind === 'strength' ? t.tag.strength : t.tag.problem, f.id, f.kind === 'problem' ? levelOfId(f.id) : undefined)}
<h3>${esc(f.title)}</h3><p class="d">${esc(f.statement)}</p>${f.why_it_matters ? `<p class="risk"><b>${esc(t.why)}:</b> ${esc(f.why_it_matters)}</p>` : ''}${evidenceList(ev, proof ? t.source : t.sources)}</article>`;
  };
  // The proof contradiction: every version with its source.
  const contradiction = (x: Contra) => `<article class="warn contra first" id="${esc(x.id)}">${cardHead('contra', t.tag.contra, x.id, levelOfId(x.id))}<h3>${esc(x.title)}</h3>
<table class="ledger"><thead><tr><th>${esc(t.source)}</th><th>${esc(t.value)}</th></tr></thead><tbody>${(Array.isArray(x.versions) ? x.versions : []).map((v) => `<tr><td class="where">${esc(v?.source)}<small>${sourceLink(String(v?.source_url ?? ''))}</small></td><td class="said"><b>${esc(v?.value)}</b>${v?.quoted_text && v.quoted_text.trim() !== String(v.value).trim() ? `<q>${esc(v.quoted_text)}</q>` : ''}</td></tr>`).join('')}</tbody></table>
${x.why_it_matters ? `<p class="risk"><b>${esc(t.why)}:</b> ${esc(x.why_it_matters)}</p>` : ''}</article>`;

  // Strip: a counter exists only for a list with items; it links to where that list is on the page.
  const listHref = listed.length ? 'areas' : 'proof';
  const strip = ([
    [counts.strengths, t.strip.strengths(counts.strengths), 'strengths', 'strengths'], [counts.problems, t.strip.problems(counts.problems), 'problems', listHref],
    [counts.contradictions, t.strip.contradictions(counts.contradictions), 'contradictions', listHref], [counts.notes, t.strip.notes(counts.notes), 'notes', 'areas'],
  ] as const).filter(([n]) => n > 0).map(([n, label, key, href]) => `<a href="#${href}"><b data-count="${key}">${n}</b><span>${esc(label)}</span></a>`).join('');

  // Sections alternate white and grey band.
  let shade = false;
  const section = (id: string, body: string) => {
    shade = !shade;
    return `<section id="${id}"${shade ? ' class="band"' : ''}>${body}</section>`;
  };

  // 2. What is at stake.
  const stake = `<div class="callout${counts.issues ? '' : ' calm'}"><b>${esc(t.stakeH)}</b><span>${esc(counts.issues ? t.stake(price) : t.stakeGood)}</span></div>`;

  // 3. Three questions: status, one number, the answer locked.
  const q = (title: string, cls: 'wrong' | 'good' | 'missing', status: string, line: string, lock: string) =>
    `<article class="warn ${cls} q"><div class="warnhead"><span class="tag ${cls}">${esc(status)}</span></div><h3>${esc(title)}</h3><p class="d">${esc(line)}</p>${lockNote(lock)}</article>`;
  const q2 = counts.recordsBad ? q(t.q2, 'wrong', t.st.bad, t.q2Bad(counts.recordsBad), t.q2Lock)
    : counts.recordsGood ? q(t.q2, 'good', t.st.good, t.q2Good(counts.recordsGood), t.q2Lock)
      : q(t.q2, 'missing', t.st.none, t.q2None, t.q2Lock);
  const q3 = counts.findings ? q(t.q3, 'wrong', t.st.bad, t.q3Bad(counts.problems, counts.contradictions, counts.notes), t.q3Lock) : q(t.q3, 'good', t.st.good, t.q3Good, t.q3Lock);
  const questions = section('questions', `${head(t.qEye, t.qH, t.qG)}<div class="qs">${q(t.q1, 'missing', t.st.none, t.q1None, t.q1Lock)}${q2}${q3}</div>`);

  // 4. One finding in full.
  const proof = proofF || proofC ? section('proof', `${head(t.proofEye, t.proofH, t.proofG, t.proofP)}<div class="warns one">${proofF ? finding(proofF, true) : contradiction(proofC!)}</div>`) : '';

  // 5. Every other finding, by business area: title and urgency only.
  const byArea = AREA_ORDER.map((a) => [a, listed.filter((x) => (AREA_OF[x.topic] ?? 'other') === a)] as const).filter(([, xs]) => xs.length);
  const areas = listed.length ? section('areas', `${head(t.areasEye, t.areasH, t.areasG, t.areasP, 'shown.listed', listed.length)}<p class="legend">${esc(t.urgHow)}</p><div class="areas">${byArea.map(([a, xs]) => `<div class="area"><h3>${esc(t.area[a])} · ${xs.length}</h3><ol class="rows">${xs.map((x) => `<li id="${esc(x.id)}" ${idAttr(x.id)}>${badge(levelOfId(x.id))}<span class="rt">${esc(titleOf(x.id))}</span><span class="kd">${esc(t.tag[x.kind])}${options.debug ? ` · ${esc(labelOf(x.id))}` : ''}</span></li>`).join('')}</ol></div>`).join('')}
${unlockCard(t.areasLockH(counts.findings), t.areasLockP, 'findings')}</div>`) : '';

  // 6. What is working.
  const working = section('strengths', `${head(t.strEye, t.strH, t.strG, '', 'strengths', counts.strengths)}${strengthsShown.length ? `<div class="warns">${strengthsShown.map((f) => finding(f)).join('')}</div>${counts.strengths > strengthsShown.length ? `<p class="more">${esc(t.moreStrengths(counts.strengths - strengthsShown.length))}</p>` : ''}` : `<p class="lead">${esc(t.noStrengths)}</p>`}`);

  // 7. What this page does not tell you, for the human and for any AI that reads it.
  const nots = [t.not.rivals, t.not.records, ...(counts.findings ? [t.not.values] : []), ...(counts.issues ? [t.not.fixes] : [])];
  const notTold = section('not', `${head(t.notEye, t.notH, t.notG)}<ul class="nots">${nots.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`);

  // 8-10. What the full report gives, doing it yourself, price and guarantee. Every buy button points to #order.
  const getsN: GetsN = { findings: counts.findings };
  const inside = section('inside', `${head(t.insideEye, t.insideH, t.insideG, t.insideP)}
<div class="gets">${t.gets.map((g, i) => { const n = g.note?.(getsN) ?? ''; return `<div class="get"><span class="rn">${two(i + 1)}</span><h3>${esc(g.h)}</h3><p>${esc(g.p)}</p>${n ? `<p class="free">${esc(n)}</p>` : ''}</div>`; }).join('')}
<div class="diy"><h3>${esc(t.diyH)}</h3><p>${esc(t.diy(counts.sources))}</p></div>
<div class="ask" id="order"><h3>${esc(t.cta)}</h3>${price ? `<p class="price" data-price>${esc(price)}</p>` : ''}<p class="me">${esc(t.ctaP)}</p><p class="guar">${esc(t.guarantee)}</p><p>${esc(t.keep)}</p></div></div>`);

  const summary = Array.isArray(report.summary) ? report.summary.filter((l) => typeof l?.text === 'string') : [];
  return `<!doctype html><html lang="${ko ? 'ko' : 'en'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><title>${esc(t.title(c))}</title>${FONTS(ko)}<style>${CSS}</style></head><body data-counts="${esc(JSON.stringify(flatCounts))}">
<header class="top"><div><b>${esc(t.bar)}</b> <span class="for">${esc(t.barFor(c))}</span></div><a class="btn" href="#order">${esc(t.cta)}</a></header>
<section class="dark hero"><div><p class="eyebrow">${esc(t.eyebrow(c, date))}</p>
<h1>${esc(t.h1(c, counts.issues))}<br><span class="g">${esc(t.h1g(counts.issues))}</span></h1>
${summary.length ? `<div class="lead">${summary.map((l) => `<p>${esc(l.text)}${cites(l.cites)}</p>`).join('')}</div>` : ''}
${counts.issues ? `<div class="exec"><b>${esc(t.execH)} ${esc(t.exec(counts.problems, counts.contradictions, counts.urgent))}</b><span>${esc(counts.contradictions ? t.execContra : t.execPlain)}</span></div>` : ''}
<div class="ctas"><a class="btn" href="#order">${esc(t.cta)}</a><a class="btn ghost" href="#questions">${esc(t.seeAll)}&nbsp;↓</a></div>
<p class="anyone">${esc(t.anyone)}</p></div>
<aside class="file"><div class="filehead"><span class="stamp">${esc(t.stamp)}</span><span class="fileno">${esc(t.fileNo)}</span></div><h3>${esc(c)}</h3><dl>
<div><dt>${esc(t.fCountry)}</dt><dd>${esc(s2.input.country)}</dd></div><div><dt>${esc(t.fIndustry)}</dt><dd>${esc(s2.input.industry)}</dd></div>
${sites.length ? `<div><dt>${esc(t.fSites)}</dt><dd>${esc(sites.join(', '))}</dd></div>` : ''}
<div><dt>${esc(t.fFound)}</dt><dd><b data-count="items">${esc(t.found(counts.items))}</b></dd></div>${topLevel ? `<div><dt>${esc(t.fHighest)}</dt><dd>${badge(topLevel)}</dd></div>` : ''}
</dl><p class="foot">${esc(t.fileFoot(date))}</p></aside></section>
${strip ? `<div class="strip">${strip}</div>` : ''}
${stake}
${questions}
${proof}
${areas}
${working}
${notTold}
${inside}
<footer><div class="colophon">${t.colophon.map(([k, v]) => `<div><span class="k">${esc(k)}</span><span>${esc(v(c, date, counts.sources))}</span></div>`).join('')}</div></footer>
${counts.issues ? `<div class="sticky"><div class="l"><span class="n" data-count="issues">${esc(t.stickyN(counts.issues))}</span><span class="p">${esc(t.stickyP)}</span></div><div class="r">${price ? `<span class="pr" data-price>${esc(price)}</span>` : ''}<a class="btn" href="#order">${esc(t.cta)}&nbsp;→</a></div></div>` : ''}
</body></html>`;
}

export function missingPage(ko = false): string {
  const t = ko ? P.ko : P.en;
  return `<!doctype html><html lang="${ko ? 'ko' : 'en'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${esc(t.bar)}</title>${FONTS(ko)}<style>${CSS}</style></head><body>
<section class="dark notready"><p class="eyebrow">${esc(t.bar)}</p><h2>${esc(t.missing)}<br><span class="g">${esc(t.missingP)}</span></h2></section></body></html>`;
}
