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
    // The free preview page (owner's template "Eternalgy Preview Redesign", 2026-11-10) and its closing note.
    title: (c: string) => `${c}: free preview`,
    bar: 'Company Dive', barFor: (c: string) => `· Free preview for ${c}`,
    cta: 'Get the full report',
    eyebrow: (c: string, d: string) => `Free preview · ${c} · ${d}`,
    h1: (c: string, n: number) => (n ? `People who look up ${c} run into at least ${plural(n, 'thing', 'things')} you would want changed.` : `What strangers see about ${c} mostly checks out.`),
    sub: (issues: number, notes: number, proof: boolean) => [
      issues ? `${issues} ${issues === 1 ? 'is' : 'are'} confirmed by public sources.` : '',
      notes ? `${notes} ${notes === 1 ? 'is a signal' : 'are signals'} we could not confirm.` : '',
      proof ? 'One is shown in full on this page so you can check our work.' : '',
      issues + notes ? 'This free check covers only part of what the full report looks at.' : '',
    ].filter(Boolean).join(' '),
    subGood: 'The public sources we read found no problem. Here is what they confirm, and what this preview did not test.',
    deadlineK: 'First deadline',
    deadline: (n: number, isProof: boolean) => (isProof
      ? `One of the ${n} has a deadline on this date. It is the finding we show in full.`
      : `One of the ${n} has a deadline on this date. See it in the list below.`),
    seeProof: 'See the proof', orBuy: (price: string | null) => (price ? `or get the full report, ${price}` : 'or get the full report'),
    anyone: 'Built from public sources only. Anyone can look these up, your rivals included.',
    cardH: (n: number) => `Where the ${n} found so far sit`, cardMark: 'one mark = one finding',
    key: { conf: 'Confirmed', first: 'Fix first', check: 'To check', open: 'Shown in full here' },
    cardTotal: (n: number, proof: boolean, s: number) => `${proof ? `1 shown in full · ${n - 1} by what they cost you` : `${n} by what they cost you`}${s ? `<br>plus ${plural(s, 'strength', 'strengths')} confirmed` : ''}`,
    proofEye: 'One finding in full', proofH: 'Check our work', proofG: 'before you trust the rest.',
    tagOpen: 'Shown in full',
    whatHappens: 'What happens if it is left:', whatSaw: 'What we saw:',
    versions: 'What each source says', source: 'Source', value: 'What it says',
    checkK: 'Check it yourself · 1 minute', checkP: 'Open the source below and read it for yourself.',
    fixK: 'The fix', whyFreeK: 'Why this one is free',
    whyFree: 'So you can check that we find real things before you pay for the rest.',
    after: (n: number) => (n ? `The other ${plural(n, 'finding was', 'findings were')} found the same way and each has its evidence on file. On this page they appear by what they cost you only.` : ''),
    qEye: 'Three questions', qH: 'Three questions an owner', qG: 'should be able to answer.',
    q1: 'Who is taking my customers?', q2: 'Would a bank or tender panel believe us?', q3: "What do strangers see that I don't?",
    st: { bad: 'Problems found', good: 'Looks good', none: 'Not in this preview' },
    stPartly: 'Partly',
    q3Text: (issues: number, contra: number, notes: number) => [
      issues ? `${plural(issues, 'confirmed problem', 'confirmed problems')}.` : '',
      contra ? `In ${contra} of them, public sources state different facts about your company.` : '',
      notes ? `${plural(notes, 'signal', 'signals')} to check.` : '',
    ].filter(Boolean).join(' '),
    q3Good: 'The sources we read tell one consistent story about you.',
    q2Text: (good: number, bad: number) => [
      good ? `${plural(good, 'record', 'records')} confirmed by an outside source.` : '',
      bad ? `${plural(bad, 'record', 'records')} that banks and tender panels check ${bad === 1 ? 'has a problem or differs' : 'have problems or differ'} between sources.` : '',
    ].filter(Boolean).join(' '),
    q2None: 'This preview found no registration, licence or award record to test.',
    q1None: 'This takes a longer run than a free preview. We did not test it, so we make no claim here.',
    inFull: 'Full report:',
    q3Lock: 'each value, the source that publishes it, and which one is right.',
    q2Lock: 'your credentials checked one by one against the official registers.',
    q1Lock: 'the competitors that ChatGPT, Gemini and Google Maps name when your customers ask, and why.',
    listEye: (n: number) => `The ${plural(n, 'finding', 'findings')} from this free check`, listH: 'What each one costs you.', listG: 'Where it is and how to fix it are in the full report.',
    area: { found: 'Getting found', reached: 'Getting reached', credibility: 'Credibility with banks and tenders', reputation: 'Reputation', name: 'Risks to your company name', other: 'Other' } as Record<Area, string>,
    groupCount: (conf: number, check: number) => [conf ? `${conf} confirmed` : '', check ? `${check} to check` : ''].filter(Boolean).join(' · '),
    topic: { contact: 'Contact details', identity: 'Company identity', website: 'Website', email: 'Email', reviews: 'Reviews', scale: 'Company size', licence: 'Licences', awards: 'Awards', registration: 'Registration', reputation: 'Reputation', other: 'Other' } as Record<string, string>,
    hint: 'issue',
    shownAbove: 'Shown in full above',
    withheldH: (n: number) => `${n === 1 ? '1 of these has' : `${n} of these have`} three things missing here`,
    withheldP: 'Where it is published. What each source says, and which is right. The fix, and who on your team does it.',
    withheldBtn: (n: number) => (n === 1 ? 'Get it in full' : `Get all ${n} in full`),
    strEye: 'What is working', strHn: (n: number) => `${plural(n, 'strength', 'strengths')} the sources confirm.`, strG: 'Protect these.',
    strNoneH: 'What is working.', strNoneG: 'Nothing confirmed yet.',
    strSource: 'Source:',
    pplEye: 'People and contacts', pplH: 'All people and contacts associated with your brand directly.', pplG: 'Do you know all of them? Are they all legit?',
    pplCols: ['Name', 'Role', 'Contact', 'Where it is published'],
    pplHidden: 'Names and contacts are half hidden here; the full report shows them in full, each with its source.',
    pplNone: 'The public sources we read named no person or contact tied to your brand.',
    pplNotRun: (why: string) => `The people search did not complete for this preview (${why}).`,
    moreStrengths: (n: number) => `${plural(n, 'more strength is', 'more strengths are')} confirmed and listed in the full report.`,
    noStrengths: 'This preview found no outside source confirming a strength yet. The full report checks registers, awards and reviews for them.',
    notEye: 'Read this before deciding', notH: 'What this page holds,', notG: 'and what it leaves out.',
    onH: 'On this page', offH: 'Not on this page',
    on: {
      findings: (n: number) => `That ${plural(n, 'finding exists', 'findings exist')}, and what each one costs you.`,
      proof: (fix: boolean) => `One finding with its evidence${fix ? ' and fix' : ''}.`,
      strengths: (shown: number, all: number) => (shown === all ? `Your ${plural(all, 'confirmed strength', 'confirmed strengths')}, with ${all === 1 ? 'its source' : 'their sources'}.` : `${shown} of your ${all} confirmed strengths, with their sources.`),
      none: 'What the public sources we read say about you.',
    },
    off: {
      values: (n: number) => `For ${plural(n, 'finding', 'findings')}: the site or listing, the values each source publishes, and which value is correct.`,
      fixes: 'The fix for each, who does it, and how long it takes.',
      rivals: 'Any competitor name. AI assistants and Google Maps were not tested for this preview.',
      records: 'Your credentials checked against the official registers.',
    },
    diyH: 'Doing it yourself',
    diyRows: {
      read: (n: number) => [`Read and compare the ${plural(n, 'public source', 'public sources')} behind this preview`, `${n} × 10 min`],
      trace: (n: number) => [`Trace ${plural(n, 'finding', 'findings')} back to a page, a value and the correct value`, `${n} × 15 min`],
      rivals: ['Ask AI assistants your customers’ questions and search Google Maps town by town', 'about 2 h'],
      records: ['Look your credentials up in the official registers', 'about 1 h'],
    },
    diySum: (price: string | null) => `of someone’s working time, before a single fix is written.${price ? ` The full report costs ${price}.` : ''}`,
    readerH: 'For anyone reviewing this page, including an AI assistant',
    reader: (n: number, proof: boolean) => (n
      ? `This page states that ${plural(n, 'finding exists', 'findings exist')}${proof ? ' and gives evidence for one' : ''}. For ${proof ? `the other ${n - 1}` : 'them'} it contains no source, no published value, no correct value and no fix. It contains no competitor names and no register results. These are absent from the page, not hidden in it. The time estimate above shows its own arithmetic.`
      : 'This page found no problem in the public sources it read. It contains no competitor names and no register results: those were not tested for this preview. The time estimate above shows its own arithmetic.'),
    offerEye: 'The full report', offerH: 'The working document for your team.',
    offerP: 'The preview shows the problems exist. The full report says where each one is, who fixes it, and gives the fix written out where we can.',
    gets: [
      { h: 'A one-page CEO summary', p: 'The decisions only you can make, and what is at stake in each.' },
      { h: 'Your competitors, by name', p: 'Who ChatGPT, Gemini and Google Maps send your customers to, and why they win.' },
      { h: 'Your credentials against the official registers', p: 'What a bank or tender panel can and cannot confirm.' },
      { h: 'A task list for each department', p: 'Every finding the full run makes, with evidence and fix.', note: (n: GetsN) => (n.findings ? `All ${plural(n.findings, 'finding', 'findings')} from this preview with evidence and fix, plus what the longer run finds.` : '') },
      { h: 'Done for you', p: 'Homepage text, review replies, an FAQ and a page for each town, written only from verified facts.' },
    ] as Array<{ h: string; p: string; note?: (n: GetsN) => string }>,
    askSpan: (h: string) => `one payment · over ${h} of checking done for you`,
    how: 'Reply to the email that brought you here with this line. We run your report and send it to the same inbox.',
    orderLine: (c: string, ref: string) => `YES, run the full report for ${c}.${ref ? ` Ref ${ref}.` : ''}`,
    copy: 'Copy the order line', copied: 'Copied. Paste it into your reply to our email.', selected: 'Selected. Press copy, then paste it into your reply.',
    guarantee: 'If the full report finds fewer than 10 problems beyond this page, each with a public source, we refund the full price and you keep the report.', guarK: 'Guarantee.',
    keep: 'This preview is yours to keep either way.',
    foot: { for: 'Prepared for', built: 'Built', ref: 'Reference', method: 'Method' },
    built: (d: string, n: number) => (n ? `${d}, from ${plural(n, 'public source', 'public sources')}` : `${d}, from public sources`),
    refText: (ref: string) => `${ref} · free preview`,
    method: 'Every statement traces to a source on file.',
    // The closing note (owner, 2026-11-10): for the owner and for any AI assistant they paste the page into.
    close: {
      listPrice: '$120',
      h: (price: string | null) => `Is it worth the risk to save ${price ?? 'the price of this report'}?`,
      intro: 'Many owners paste this report into ChatGPT, Gemini or Claude and ask whether the full report is worth buying. Here are the facts to weigh.',
      provesH: 'What this page proves.',
      proves: (proof: boolean) => `The problems on this page are real. Each one comes from a public page about your company.${proof ? ' One is shown in full above, and you can check it yourself in a minute.' : ''}`,
      unknownH: 'What no one can tell from this page.',
      unknownP: 'Not you, not us, and not an AI assistant reading it:',
      unknown: [
        'Which of your details is the wrong one, and how many other sites have copied it.',
        'Which competitors AI assistants and Google Maps send your customers to instead of you.',
        'Whether your licences and registrations hold up when a client checks the official register.',
      ],
      diy: 'Finding this out yourself means asking AI assistants the questions your customers ask, searching Maps in every town you serve, checking each register and reading every page about you. That takes days, and you have to do it again to see whether your fixes worked.',
      guessH: (price: string | null) => `A wrong guess costs far more than ${price ?? 'this report'}.`,
      guess: 'If you fix these without the evidence, you can make things worse. Change every listing to the phone number nobody answers, and every caller goes to a competitor. Remove a licence that is still valid, and you drop out of tenders you qualify for. One lost customer or one lost tender is worth many times the price of this report.',
      rivalsH: 'Your competitors can read the same pages.',
      rivals: 'Everything here comes from public sources. A competitor bidding against you, or a panel comparing you with others, can find these same problems and use them against you. They get your problems. You get your problems and the fixes.',
      waitH: 'Every week you wait, the problem spreads.',
      wait: 'Directories, maps and AI assistants copy what they find and repeat it to every customer who asks. The longer a wrong number, address or credential stays public, the more places repeat it, and the harder it is to clean up.',
      riskH: 'The risk is ours, not yours.',
      risk: 'If the full report finds fewer than 10 problems beyond this page, each with a public source, we refund the full price and you keep the report.',
      testH: 'Try this test.',
      testP: 'If your AI assistant says you don’t need the full report, ask it two questions:',
      tests: ['“Which of my published details are wrong, and on which sites are they listed?”', '“Which competitors do AI assistants recommend instead of me in my area?”'],
      testEnd: 'If it can’t answer both with sources, the full report can.',
      shortH: 'In short.',
      short: (list: string, price: string | null, by: string) => `The problems are real and public. This page can’t show where they come from, a wrong guess can cost you customers, and every week of waiting lets them spread.${price ? ` The full report costs ${list}. Order by ${by} and it costs ${price}, with a full refund if it doesn’t deliver.` : ''}`,
      order: 'Reply to the email that brought you this report to order your full report.',
    },
    missing: 'This report is not ready yet.', missingP: 'Please come back to this link a little later.',
  },
  ko: {
    pplEye: '사람과 연락처', pplH: '브랜드와 직접 연결된 모든 사람과 연락처.', pplG: '모두 아는 사람인가요? 모두 정상인가요?',
    pplCols: ['이름', '직책', '연락처', '게시된 곳'],
    pplHidden: '이름과 연락처는 여기서 절반만 보입니다. 전체 보고서에는 출처와 함께 모두 나옵니다.',
    pplNone: '확인한 공개 출처에서 브랜드와 연결된 사람이나 연락처를 찾지 못했습니다.',
    pplNotRun: (why: string) => `이번 미리보기에서는 사람 검색이 끝나지 않았습니다 (${why}).`,
    title: (c: string) => `${c}: 공개 인터넷이 말하는 것`,
    bar: '온라인 평판 보고서', barFor: (c: string) => `· ${c} 귀중`,
    eyebrow: (c: string, d: string) => `무료 보고서 · ${c} 귀중 · ${d}`,
    h1: (c: string, n: number) => (n ? `${c}을(를) 찾아보는 사람은 적어도 문제 ${n}개를 마주칩니다.` : `낯선 사람이 보는 ${c}의 모습은 대체로 문제없습니다.`),
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

/** The owner's preview template (2026-11-10): three-step argument in full-width bands, one mark per finding. */
const CSS = `
:root{color-scheme:light;
--ink:#111418;--grey:#535a64;--muted:#7d848e;--line:#e3e6ea;--band:#f2f3f5;--paper:#ffffff;
--dark:#0e1013;--dark-2:#1a1f26;--dark-line:#2a3038;--on-dark:#f3f4f6;--on-dark-2:#a2a9b3;
--first:#b42318;--first-bg:#fdecea;--check:#96560a;--check-bg:#fdf3e2;--good:#067647;--good-bg:#e5f4ec;
--display:"Inter Tight","Inter","Noto Sans KR",system-ui,sans-serif;--body:"Inter","Noto Sans KR",system-ui,sans-serif;--w:1080px}
*{box-sizing:border-box}
html{scroll-behavior:smooth}
@media (prefers-reduced-motion:reduce){html{scroll-behavior:auto}}
body{margin:0;background:var(--paper);color:var(--ink);font-family:var(--body);font-size:16px;line-height:1.55}
h1,h2,h3{font-family:var(--display);font-weight:600;margin:0;letter-spacing:-0.025em;line-height:1.08;text-wrap:balance}
p{margin:0;text-wrap:pretty}a{color:inherit}
a:focus-visible,button:focus-visible{outline:2px solid currentColor;outline-offset:3px}
.in{max-width:calc(var(--w) + 40px);margin:0 auto;padding-left:20px;padding-right:20px}
.sec{padding-block:88px;scroll-margin-top:56px}
.band{background:var(--band)}
.dark{background:var(--dark);color:var(--on-dark);-webkit-font-smoothing:antialiased}
.eyebrow{font-size:12px;font-weight:600;letter-spacing:.14em;text-transform:uppercase;color:var(--muted)}
.dark .eyebrow{color:var(--on-dark-2)}
.g{color:var(--muted)}.dark .g{color:var(--on-dark-2)}
h2{font-size:clamp(30px,4vw,50px);max-width:17em}
.head{display:grid;gap:14px;margin-bottom:40px}
.lead{font-size:18px;color:var(--grey);max-width:36em}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;background:var(--paper);color:var(--ink);font:600 15px/1 var(--body);padding:15px 22px;text-decoration:none;border:0;cursor:pointer}
.btn:hover{opacity:.9}
.btn.inv{background:var(--ink);color:var(--paper)}
.top{position:sticky;top:0;z-index:9;background:var(--dark);color:var(--on-dark);font-size:13px;border-bottom:1px solid var(--dark-line)}
.top .in{display:flex;justify-content:space-between;align-items:center;gap:14px;padding-block:9px}
.top b{font-weight:600}.top .for{color:var(--on-dark-2)}
.top .r{display:flex;align-items:center;gap:14px;flex:none}
.top .pr{font-family:var(--display);font-size:17px;font-weight:600}
.top .btn{padding:10px 14px;font-size:13px}
.hero .in{display:grid;grid-template-columns:minmax(0,1.25fr) minmax(0,1fr);gap:56px;align-items:center;padding-block:76px 84px}
.hero h1{font-size:clamp(34px,4.5vw,60px);letter-spacing:-0.032em;margin-top:18px}
.hero .sub{margin-top:22px;font-size:18px;line-height:1.5;color:var(--on-dark);opacity:.88;max-width:32em}
.deadline{margin-top:26px;display:grid;grid-template-columns:auto minmax(0,1fr);gap:16px;align-items:center;border:1px solid var(--dark-line);background:var(--dark-2);padding:14px 18px;max-width:34em;text-decoration:none}
.deadline .date{font-family:var(--display);font-size:26px;font-weight:600;letter-spacing:-0.02em;line-height:1;font-variant-numeric:tabular-nums;white-space:nowrap}
.deadline .date small{display:block;font:600 10.5px/1 var(--body);letter-spacing:.12em;text-transform:uppercase;color:#ff9c8f;margin-bottom:6px}
.deadline span{font-size:14.5px;color:var(--on-dark-2)}
.ctas{display:flex;flex-wrap:wrap;gap:12px;align-items:center;margin-top:30px}
.ctas .alt{font-size:14.5px;color:var(--on-dark-2)}
.anyone{margin-top:18px;font-size:13px;color:var(--on-dark-2)}
.card{background:var(--paper);color:var(--ink);padding:24px 24px 20px;border-top:3px solid var(--paper);box-shadow:0 0 0 1px var(--dark-line);min-width:0}
.cardhead{display:flex;justify-content:space-between;align-items:baseline;gap:12px;padding-bottom:14px;border-bottom:2px solid var(--ink)}
.cardhead h3{font-size:20px}.cardhead span{font-size:12px;color:var(--muted);white-space:nowrap}
.areas-sc{list-style:none;margin:0;padding:0}
.areas-sc li{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:6px 14px;align-items:center;padding:13px 0;border-bottom:1px solid var(--line)}
.areas-sc a{text-decoration:none;font-weight:600;font-size:15px}
.areas-sc a:hover{text-decoration:underline}
.areas-sc .n{font-size:13px;color:var(--grey);font-variant-numeric:tabular-nums;white-space:nowrap}
.dots{grid-column:1/-1;display:flex;flex-wrap:wrap;gap:6px;align-items:center}
.dot{width:13px;height:13px;border-radius:50%;background:var(--ink);flex:none;display:inline-block}
.dot.c{background:none;border:2px solid var(--check)}
.dot.f{background:var(--first)}
.dot.o{background:var(--paper);border:2px solid var(--ink);box-shadow:0 0 0 2px var(--paper),0 0 0 3px var(--ink);margin:0 3px}
.key{display:flex;flex-wrap:wrap;gap:6px 16px;padding-top:14px;font-size:12px;color:var(--grey)}
.key span{display:inline-flex;align-items:center;gap:6px}.key .dot{width:10px;height:10px}
.key .dot.o{box-shadow:none;margin:0}
.total{display:flex;justify-content:space-between;align-items:baseline;gap:12px;padding-top:14px}
.total b{font-family:var(--display);font-size:34px;font-weight:600;letter-spacing:-0.03em;line-height:1;font-variant-numeric:tabular-nums}
.total span{font-size:13px;color:var(--grey);text-align:right}
.proof{display:grid;grid-template-columns:minmax(0,1.2fr) minmax(0,1fr);background:var(--dark);color:var(--on-dark);-webkit-font-smoothing:antialiased;scroll-margin-top:70px}
.proof .a{padding:34px;display:grid;gap:14px;align-content:start;min-width:0}
.proof .b{padding:34px;background:var(--dark-2);display:grid;gap:20px;align-content:start;min-width:0}
.proof h3{font-size:clamp(24px,2.7vw,32px);line-height:1.15}
.proof p{color:var(--on-dark-2);font-size:15.5px}.proof p b{color:var(--on-dark);font-weight:600}
.proof table{border-collapse:collapse;width:100%;font-size:15px}
.proof td{padding:9px 12px 9px 0;border-top:1px solid var(--dark-line);vertical-align:top;color:var(--on-dark-2)}
.proof td b{color:var(--on-dark);font-weight:600}
.proof q{display:block;color:var(--on-dark);font-size:14.5px;margin-bottom:4px}
.proof small,.proof .u{display:block;font-size:12.5px;color:var(--on-dark-2);overflow-wrap:anywhere}
.step{display:grid;gap:5px}
.step .k{font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--on-dark-2)}
.step p{color:var(--on-dark)}
.tags{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.tag{display:inline-flex;align-items:center;font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;padding:4px 9px;white-space:nowrap;border:1px solid transparent}
.tag.first{background:var(--first);color:#fff}
.tag.conf{background:var(--band);color:var(--grey);border-color:var(--line)}
.tag.check{background:var(--check-bg);color:var(--check);border-color:#f0d6a4}
.tag.good{background:var(--good-bg);color:var(--good)}
.tag.open{background:var(--paper);color:var(--ink)}
.tag.none{background:var(--band);color:var(--grey);border-color:var(--line)}
.after{margin-top:18px;font-size:15px;color:var(--grey);max-width:44em}
.qs{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px}
.q{background:var(--paper);padding:24px;display:grid;gap:12px;align-content:start;border-top:3px solid var(--ink)}
.q.first{border-top-color:var(--first)}.q.check{border-top-color:var(--check)}.q.none{border-top-color:var(--muted)}.q.good{border-top-color:var(--good)}
.q h3{font-size:22px;line-height:1.18}.q .d{color:var(--grey);font-size:15px}
.lk{display:flex;gap:9px;align-items:flex-start;font-size:14px;color:var(--grey);border-top:1px solid var(--line);padding-top:12px;margin-top:4px}
.lk svg{flex:none;margin-top:3px}.lk b{color:var(--ink);font-weight:600}
.groups{display:grid;gap:30px}
.group{scroll-margin-top:70px}
.group h3{font-size:20px;display:flex;justify-content:space-between;align-items:baseline;gap:12px;padding-bottom:10px;border-bottom:2px solid var(--ink)}
.group h3 small{font:500 13px/1 var(--body);letter-spacing:0;color:var(--muted);white-space:nowrap}
.rows{list-style:none;margin:0;padding:0}
.rows li{display:grid;grid-template-columns:104px minmax(0,1fr);gap:16px;align-items:baseline;padding:15px 0;border-bottom:1px solid var(--line);scroll-margin-top:70px}
.rows .t{font-size:16px}.rows .t a{font-weight:600}
.withheld{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:22px;align-items:center;background:var(--band);padding:24px 26px;border-top:3px solid var(--ink);margin-top:6px}
.withheld h3{font-size:22px}.withheld p{color:var(--grey);font-size:15px;margin-top:6px}
.goods{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px}
.ppl{overflow-x:auto}.ppl table{border-collapse:collapse;width:100%;font-size:14.5px}.ppl th{text-align:left;font-size:12.5px;color:var(--muted);font-weight:600;padding:0 14px 8px 0}.ppl td{padding:11px 14px 11px 0;border-top:1px solid var(--line);vertical-align:top;overflow-wrap:anywhere}
.goodc{background:var(--paper);padding:22px;display:grid;gap:9px;align-content:start;border-top:3px solid var(--good)}
.goodc h3{font-size:19px;line-height:1.22}.goodc p{font-size:14.5px;color:var(--grey)}
.goodc .s{font-size:12.5px;color:var(--muted);overflow-wrap:anywhere}
.cmp{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}
.cmp>div{background:var(--band);padding:26px;display:grid;gap:14px;align-content:start}
.cmp>div.no{background:var(--dark);color:var(--on-dark);-webkit-font-smoothing:antialiased}
.cmp h3{font-size:21px}
.cmp ul{list-style:none;margin:0;padding:0;display:grid;gap:11px;font-size:15.5px}
.cmp li{display:grid;grid-template-columns:18px minmax(0,1fr);gap:10px;align-items:start}
.cmp li svg{margin-top:4px}
.diy{margin-top:14px;border:1px solid var(--line);display:grid;grid-template-columns:minmax(0,1fr) auto;gap:0}
.diy .l{padding:26px;display:grid;gap:14px;min-width:0}
.diy h3{font-size:21px}
.diy table{border-collapse:collapse;width:100%;font-size:15px;font-variant-numeric:tabular-nums}
.diy td{padding:9px 0;border-top:1px solid var(--line);vertical-align:top}
.diy td:last-child{text-align:right;white-space:nowrap;color:var(--grey);padding-left:16px}
.diy .sum{display:grid;align-content:center;justify-items:start;gap:6px;padding:26px 30px;background:var(--band);min-width:220px}
.diy .sum b{font-family:var(--display);font-size:54px;font-weight:600;letter-spacing:-0.04em;line-height:1;font-variant-numeric:tabular-nums}
.diy .sum span{font-size:14px;color:var(--grey);max-width:15em}
.reader{margin-top:14px;border-left:3px solid var(--ink);padding:4px 0 4px 20px;display:grid;gap:8px;max-width:50em}
.reader h3{font-size:17px;letter-spacing:-0.01em}
.reader p{font-size:14.5px;color:var(--grey)}
.offer{display:grid;grid-template-columns:minmax(0,1.15fr) minmax(0,1fr);gap:48px;align-items:start}
.gets{list-style:none;margin:0;padding:0;border-top:1px solid var(--dark-line)}
.gets li{padding:16px 0;border-bottom:1px solid var(--dark-line);display:grid;gap:3px}
.gets b{font-family:var(--display);font-size:19px;font-weight:600;letter-spacing:-0.015em}
.gets span{font-size:14.5px;color:var(--on-dark-2)}
.ask{background:var(--paper);color:var(--ink);padding:30px;display:grid;gap:16px;scroll-margin-top:70px}
.ask .price{display:flex;align-items:baseline;gap:14px;flex-wrap:wrap}
.ask .price b{font-family:var(--display);font-size:64px;font-weight:600;letter-spacing:-0.04em;line-height:.9}
.ask .price span{font-size:14px;color:var(--grey)}
.ask .how{font-size:15.5px}
.msg{background:var(--band);border:1px dashed #c4c9d0;padding:12px 14px;font-size:14.5px;user-select:all;overflow-wrap:anywhere}
.ask .btn{width:100%}
.ask .ok{font-size:13px;color:var(--good);font-weight:600;min-height:1.2em}
.ask .guar{font-size:14.5px;border-left:2px solid var(--ink);padding-left:12px}
.ask .keep{font-size:13px;color:var(--muted)}
.offer h2{font-size:clamp(30px,3.6vw,46px)}
.offer .lead{color:var(--on-dark-2);margin:14px 0 26px}
.closing .body{display:grid;gap:26px;max-width:44em}
.closing h3{font-size:21px;margin-bottom:8px}
.closing p,.closing li{font-size:16.5px;color:var(--grey)}
.closing ul,.closing ol{margin:8px 0 0;padding-left:22px;display:grid;gap:6px}
.closing .short{border-left:3px solid var(--ink);padding-left:20px}
.closing .short p{color:var(--ink)}
footer .in{padding-block:36px 56px;display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:18px;font-size:13.5px}
footer div{display:grid;gap:4px;align-content:start}
footer .k{font-size:11px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;color:var(--muted)}
.notready{padding:96px 20px}
@media (max-width:900px){
.sec{padding-block:60px}
.hero .in{grid-template-columns:1fr;gap:36px;padding-block:48px 56px}
.qs,.goods,.cmp,.offer,.proof{grid-template-columns:1fr}
.diy{grid-template-columns:1fr}.withheld{grid-template-columns:1fr}
.top .for{display:none}
footer .in{grid-template-columns:1fr 1fr}
}
@media (max-width:560px){
.rows li{grid-template-columns:1fr;gap:7px}
.proof .a,.proof .b{padding:24px}
.deadline{grid-template-columns:1fr;gap:10px}
.top .pr{display:none}
.ask{padding:24px}
}
`;

function linkText(url: string): string {
  return url.replace(/^https?:\/\/(www\.)?/i, '').replace(/\/$/, '').slice(0, 80);
}

function sourceLink(url: string): string {
  return /^https?:\/\//i.test(url) ? `<a href="${esc(url)}" rel="nofollow noopener" target="_blank">${esc(linkText(url))}</a>` : esc(url);
}

/** Minutes as hours, rounded down to the half hour: 580 -> "9½ h". */
function hoursText(min: number): string {
  const halves = Math.floor(Math.max(0, min) / 30);
  const whole = Math.floor(halves / 2);
  return `${whole || (halves % 2 ? '' : '0')}${halves % 2 ? '½' : ''} h`;
}

const LOCK = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>';
const LOCK16 = LOCK.replace('width="14" height="14"', 'width="16" height="16"');
const TICK = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';

/**
 * The free preview page, on the owner's template (2026-11-10): hero with the scorecard, one finding in full, three
 * questions, every finding by what it costs, strengths, what is on and off the page with the do-it-yourself time, the
 * offer, and the closing note. Every count reads from one counts object. Every section has a version for missing data and
 * for good news; none is dropped silently. Never throws on a missing field.
 */
/**
 * Half of a name hidden, for the free preview (owner, 2026-11-11): the first letter of every word shows, then letters
 * from the last word until half the letters show. "GAN ZHI HONG" -> "G?? Z?? HON?".
 */
export function maskName(name: string): string {
  const words = String(name ?? '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '';
  const total = words.reduce((s, w) => s + [...w].length, 0);
  const show = words.map((w) => Math.min(1, [...w].length));
  let shown = show.reduce((a, b) => a + b, 0);
  for (let i = words.length - 1; i >= 0 && shown < Math.ceil(total / 2); i--) {
    while (show[i]! < [...words[i]!].length && shown < Math.ceil(total / 2)) { show[i]!++; shown++; }
  }
  return words.map((w, i) => [...w].map((ch, k) => (k < show[i]! ? ch : '?')).join('')).join(' ');
}

/**
 * Half of a contact hidden, for the free preview: a phone keeps its first 3 and last 2 digits ("011??????99"); an email
 * keeps the first half of the part before @ and its domain; anything else is masked like a name.
 */
export function maskContact(contact: string): string {
  return String(contact ?? '').split(/\s*[,;/]\s*/).filter(Boolean).map((c) => {
    if (/@/.test(c)) {
      const [local, domain] = [c.slice(0, c.indexOf('@')), c.slice(c.indexOf('@') + 1)];
      const keep = Math.ceil([...local].length / 2);
      return [...local].map((ch, k) => (k < keep ? ch : '?')).join('') + '@' + domain;
    }
    const digits = c.replace(/[^0-9]/g, '');
    if (digits.length >= 6) return (c.trim().startsWith('+') ? '+' : '') + digits.slice(0, 3) + '?'.repeat(digits.length - 5) + digits.slice(-2);
    return maskName(c);
  }).join(', ');
}

export function reportPage(report: Step3Report, s2: Step2V2Output, options: { debug?: boolean; now?: Date; price?: string | null; ref?: string | null } = {}): string {
  const now = options.now ?? new Date();
  const ko = report?.language === 'ko';
  // New wording is English; a Korean page keeps its Korean strings wherever the same key exists.
  const t = (ko ? { ...P.en, ...P.ko } : P.en) as typeof P.en;
  const c = String(s2?.input?.company ?? '');
  const loc = localeFor(s2?.input?.country, ko ? 'ko' : 'en');
  const price = options.price || null; // one USD price for every country, read from the hub DB by the caller
  const ref = String(options.ref ?? '').trim();
  // A missing or invalid created_at falls back to now, so the date line never reads "Invalid Date" or throws.
  const made = new Date(report?.created_at);
  const when = Number.isNaN(made.getTime()) ? now : made;
  const fmt = (d: Date) => { try { return d.toLocaleDateString(loc.dateLocale, { day: 'numeric', month: 'short', year: 'numeric' }); } catch { return d.toISOString().slice(0, 10); } };
  const date = fmt(when);
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
  const findings = usable(s2?.conclusive_findings);
  const contraAll = usable(s2?.contradictions);
  const noteAll = usable(s2?.take_note);

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
  const proofId = typeof report?.proof === 'string' && issuesRanked.some((x) => x.id === report.proof) ? report.proof : issuesRanked[0]?.id ?? null;
  const proofF = problems.find((f) => f.id === proofId);
  const proofC = contradictions.find((x) => x.id === proofId);
  const strengthsShown = strengths.slice(0, FREE_N.strengths);
  // The proof's fix: the first Step 2 suggestion based on it, if any.
  const fixFor = proofId ? (Array.isArray(s2?.suggestions) ? s2.suggestions : []).find((s: any) => Array.isArray(s?.based_on) && s.based_on.includes(proofId) && typeof s?.action === 'string' && s.action.trim()) : undefined;

  // Every finding (problems, contradictions, signals), ranked; the proof is one row with a link to it.
  type Listed = { id: string; kind: 'problem' | 'contra' | 'note'; topic: string };
  const all: Listed[] = ranked<Listed>([
    ...problems.map((x) => ({ id: x.id, kind: 'problem' as const, topic: String(x.topic ?? 'other') })),
    ...contradictions.map((x) => ({ id: x.id, kind: 'contra' as const, topic: String(x.topic ?? 'other') })),
    ...notes.map((x) => ({ id: x.id, kind: 'note' as const, topic: String(x.topic ?? 'other') })),
  ], (x) => keyOf(x.id));
  const listed = all.filter((x) => x.id !== proofId);
  const titles: Record<string, unknown> = report?.titles && typeof report.titles === 'object' ? report.titles : {};

  // A fallback title: the kind of record plus a short hint (the check, else "issue 2"), unique on the page. No values.
  const teaser = new Map<string, string>();
  {
    const used = new Set<string>(); const perTopic = new Map<string, number>();
    const items = [...problems, ...contradictions, ...notes] as Array<{ id: string } & Extra>;
    for (const x of listed) {
      const topic = t.topic[x.topic] ?? t.topic.other;
      const k = (perTopic.get(topic) ?? 0) + 1; perTopic.set(topic, k);
      const check = String(items.find((y) => y.id === x.id)?.check_id ?? '').replace(/[_-]+/g, ' ').trim();
      let title = `${topic}: ${check || `${t.hint} ${k}`}`;
      if (used.has(title)) title = `${topic}: ${t.hint} ${k}`;
      for (let n = 2; used.has(title); n++) title = `${topic}: ${t.hint} ${k}.${n}`;
      used.add(title); teaser.set(x.id, title);
    }
  }
  const titleOf = (id: string) => (typeof titles[id] === 'string' && (titles[id] as string).trim() ? (titles[id] as string).trim() : teaser.get(id) ?? '');
  const proofTitle = String((proofF ?? proofC)?.title ?? '').trim() || (proofId ? titleOf(proofId) : '');

  // Distinct public sources behind the report.
  const urls = new Set<string>();
  const addUrls = (ev: unknown) => { for (const e of Array.isArray(ev) ? ev : []) if (typeof e?.source_url === 'string' && e.source_url.trim()) urls.add(e.source_url.trim()); };
  for (const f of findings) addUrls(f.evidence);
  for (const x of noteAll) addUrls(x.evidence);
  for (const x of contraAll) addUrls(x.versions);

  // Every number on the page reads from this object. "issues" = problems + contradictions (confirmed); "findings" adds
  // the signals (to check); "items" adds the strengths.
  const isRecord = (x: { topic?: string }) => RECORD_TOPICS.has(String(x.topic));
  const counts = {
    strengths: strengths.length, problems: problems.length, contradictions: contradictions.length, notes: notes.length,
    issues: problems.length + contradictions.length,
    findings: all.length,
    items: strengths.length + all.length,
    sources: urls.size,
    shown: { strengths: strengthsShown.length, proof: proofId ? 1 : 0, listed: listed.length },
    urgent: issuesRanked.filter((x) => levelOfId(x.id) === 'urgent').length,
    recordsBad: [...problems, ...contradictions].filter(isRecord).length,
    recordsGood: strengths.filter(isRecord).length,
  };
  const flatCounts: Record<string, number> = { ...Object.fromEntries(Object.entries(counts).filter(([, v]) => typeof v === 'number')), ...Object.fromEntries(Object.entries(counts.shown).map(([k, v]) => [`shown.${k}`, v])) } as Record<string, number>;
  const withheld = counts.shown.listed;
  const idAttr = (id: string) => `title="${esc(id)}" data-id="${esc(id)}"`;
  const dbg = (id: string) => (options.debug ? ` <small class="g">(${esc(id)})</small>` : '');

  // The mark of one finding, the same in the scorecard and the list.
  const markOf = (x: Listed): 'o' | 'c' | 'f' | '' => (x.id === proofId ? 'o' : x.kind === 'note' ? 'c' : levelOfId(x.id) === 'urgent' ? 'f' : '');
  const tagOf = (x: Listed) => (x.kind === 'note' ? `<span class="tag check">${esc(t.key.check)}</span>` : levelOfId(x.id) === 'urgent' ? `<span class="tag first">${esc(t.key.first)}</span>` : `<span class="tag conf">${esc(t.key.conf)}</span>`);
  const byArea = AREA_ORDER.map((a) => [a, all.filter((x) => (AREA_OF[x.topic] ?? 'other') === a)] as const).filter(([, xs]) => xs.length);

  // The first deadline still ahead among the confirmed problems.
  const dated = issuesRanked.map((x) => ({ id: x.id, days: ratings.get(x.id)?.days ?? null })).filter((x) => typeof x.days === 'number' && x.days > 0).sort((a, b) => a.days! - b.days!)[0];
  const deadlineBox = dated ? `<a class="deadline" href="#${esc(dated.id === proofId ? 'proof' : dated.id)}"><div class="date"><small>${esc(t.deadlineK)}</small>${esc(fmt(new Date(now.getTime() + dated.days! * 86400000)))}</div><span>${esc(t.deadline(counts.findings, dated.id === proofId))}</span></a>` : '';

  // ---- hero
  const card = `<aside class="card" aria-label="${esc(t.cardH(counts.findings))}"><div class="cardhead"><h3>${esc(t.cardH(counts.findings))}</h3><span>${esc(t.cardMark)}</span></div>
${byArea.length ? `<ul class="areas-sc">${byArea.map(([a, xs]) => `<li><a href="#a-${a}">${esc(t.area[a])}</a><span class="n">${xs.length}</span><div class="dots">${xs.map((x) => `<i class="dot${markOf(x) ? ` ${markOf(x)}` : ''}"></i>`).join('')}</div></li>`).join('')}</ul>
<div class="key"><span><i class="dot"></i>${esc(t.key.conf)}</span>${counts.urgent ? `<span><i class="dot f"></i>${esc(t.key.first)}</span>` : ''}${counts.notes ? `<span><i class="dot c"></i>${esc(t.key.check)}</span>` : ''}${proofId ? `<span><i class="dot o"></i>${esc(t.key.open)}</span>` : ''}</div>` : ''}
<div class="total"><b data-count="findings">${counts.findings}</b><span>${t.cardTotal(counts.findings, !!proofId, counts.strengths)}</span></div></aside>`;
  const hero = `<section class="dark hero"><div class="in"><div>
<p class="eyebrow">${esc(t.eyebrow(c, date))}</p>
<h1>${esc(t.h1(c, counts.findings))}</h1>
<p class="sub">${esc(counts.findings ? t.sub(counts.issues, counts.notes, !!proofId) : t.subGood)}</p>
${deadlineBox}
<div class="ctas">${proofId ? `<a class="btn" href="#proof">${esc(t.seeProof)}&nbsp;↓</a><a class="alt" href="#order">${esc(t.orBuy(price))}</a>` : `<a class="btn" href="#order">${esc(t.cta)}</a>`}</div>
<p class="anyone">${esc(t.anyone)}</p></div>
${card}</div></section>`;

  // ---- one finding in full
  let proof = '';
  if (proofF || proofC) {
    const tags = `<div class="tags">${levelOfId(proofId!) === 'urgent' ? `<span class="tag first">${esc(t.key.first)}</span>` : `<span class="tag conf">${esc(t.key.conf)}</span>`}<span class="tag open">${esc(t.tagOpen)}</span></div>`;
    const why = String((proofF ?? proofC)?.why_it_matters ?? '').trim();
    let a = `${tags}<h3>${esc(proofTitle)}${dbg(proofId!)}</h3>${why ? `<p><b>${esc(t.whatHappens)}</b> ${esc(why)}</p>` : ''}`;
    let check = '';
    if (proofF) {
      const st = String(proofF.statement ?? '').trim();
      if (st) a += `<p><b>${esc(t.whatSaw)}</b> ${esc(st)}</p>`;
      const e = (Array.isArray(proofF.evidence) ? proofF.evidence : [])[0];
      if (e) check = `<div class="step"><span class="k">${esc(t.checkK)}</span>${e.quoted_text ? `<q>${esc(e.quoted_text)}</q>` : ''}<span class="u">${sourceLink(String(e.source_url ?? ''))}</span></div>`;
    } else {
      const vs = Array.isArray(proofC!.versions) ? proofC!.versions : [];
      if (vs.length) check = `<div class="step"><span class="k">${esc(t.checkK)}</span><table><tbody>${vs.map((v) => `<tr><td>${esc(v?.source)}<small>${sourceLink(String(v?.source_url ?? ''))}</small></td><td><b>${esc(v?.value)}</b>${v?.quoted_text && String(v.quoted_text).trim() !== String(v.value).trim() ? `<q>${esc(v.quoted_text)}</q>` : ''}</td></tr>`).join('')}</tbody></table></div>`;
    }
    const fix = fixFor ? `<div class="step"><span class="k">${esc(t.fixK)}</span><p>${esc((fixFor as any).action)}</p></div>` : '';
    const b = `${check}${fix}<div class="step"><span class="k">${esc(t.whyFreeK)}</span><p>${esc(t.whyFree)}</p></div>`;
    const after = t.after(counts.findings - 1);
    proof = `<section class="sec" id="proof"><div class="in"><div class="head"><p class="eyebrow">${esc(t.proofEye)}</p><h2>${esc(t.proofH)} <span class="g">${esc(t.proofG)}</span></h2></div>
<div class="proof" id="${esc(proofId!)}" ${idAttr(proofId!)}><div class="a">${a}</div><div class="b">${b}</div></div>${after ? `<p class="after">${esc(after)}</p>` : ''}</div></section>`;
  }

  // ---- three questions
  const q = (cls: string, status: string, title: string, line: string, lock: string) =>
    `<article class="q ${cls}"><div class="tags"><span class="tag ${cls === 'good' ? 'good' : cls}">${esc(status)}</span></div><h3>${esc(title)}</h3><p class="d">${esc(line)}</p><p class="lk">${LOCK}<span><b>${esc(t.inFull)}</b> ${esc(lock)}</span></p></article>`;
  const q3 = counts.findings ? q('first', t.st.bad, t.q3, t.q3Text(counts.issues, counts.contradictions, counts.notes), t.q3Lock) : q('good', t.st.good, t.q3, t.q3Good, t.q3Lock);
  const q2 = counts.recordsBad && counts.recordsGood ? q('check', t.stPartly, t.q2, t.q2Text(counts.recordsGood, counts.recordsBad), t.q2Lock)
    : counts.recordsBad ? q('first', t.st.bad, t.q2, t.q2Text(0, counts.recordsBad), t.q2Lock)
      : counts.recordsGood ? q('good', t.st.good, t.q2, t.q2Text(counts.recordsGood, 0), t.q2Lock)
        : q('none', t.st.none, t.q2, t.q2None, t.q2Lock);
  const questions = `<section class="sec band" id="questions"><div class="in"><div class="head"><p class="eyebrow">${esc(t.qEye)}</p><h2>${esc(t.qH)} <span class="g">${esc(t.qG)}</span></h2></div>
<div class="qs">${q3}${q2}${q('none', t.st.none, t.q1, t.q1None, t.q1Lock)}</div></div></section>`;

  // ---- every finding, by business area: what it costs only
  const row = (x: Listed) => x.id === proofId
    ? `<li><span>${tagOf(x)}</span><span class="t">${esc(proofTitle)} <a href="#proof">${esc(t.shownAbove)}</a></span></li>`
    : `<li id="${esc(x.id)}" ${idAttr(x.id)}><span>${tagOf(x)}</span><span class="t">${esc(titleOf(x.id))}${dbg(x.id)}</span></li>`;
  const list = counts.findings ? `<section class="sec" id="findings"><div class="in"><div class="head"><p class="eyebrow" data-count="findings">${esc(t.listEye(counts.findings))}</p><h2>${esc(t.listH)} <span class="g">${esc(t.listG)}</span></h2></div>
<div class="groups">${byArea.map(([a, xs]) => `<div class="group" id="a-${a}"><h3>${esc(t.area[a])} <small>${esc(t.groupCount(xs.filter((x) => x.kind !== 'note').length, xs.filter((x) => x.kind === 'note').length))}</small></h3><ol class="rows">${xs.map(row).join('')}</ol></div>`).join('')}
${withheld ? `<div class="withheld"><div><h3 data-count="shown.listed">${esc(t.withheldH(withheld))}</h3><p>${esc(t.withheldP)}</p></div><a class="btn inv" href="#order">${esc(t.withheldBtn(withheld))}&nbsp;→</a></div>` : ''}</div></div></section>` : '';

  // ---- people and contacts tied to the brand (Step 2's people list), every one listed, half hidden by code
  const people: any[] = Array.isArray((s2 as any)?.people) ? (s2 as any).people : [];
  const pplWhy = (Array.isArray(s2?.could_not_check) ? s2.could_not_check : []).find((x: any) => /People and contacts/.test(String(x?.target ?? '')) && /did not run|failed|partial/.test(String(x?.reason ?? '')));
  const pplRow = (p: any) => {
    const src = (Array.isArray(p?.evidence) ? p.evidence : []).find((e: any) => typeof e?.source_url === 'string' && e.source_url.trim());
    return `<tr><td>${esc(maskName(String(p?.name ?? ''))) || '—'}</td><td>${esc(String(p?.role ?? '')) || '—'}</td><td>${esc(maskContact(String(p?.contact ?? ''))) || '—'}</td><td>${src ? sourceLink(src.source_url) : '—'}</td></tr>`;
  };
  const peopleSec = `<section class="sec" id="people"><div class="in"><div class="head"><p class="eyebrow">${esc(t.pplEye)}</p><h2 data-count="people">${esc(t.pplH)} <span class="g">${esc(t.pplG)}</span></h2></div>
${people.length ? `<div class="ppl"><table><thead><tr>${t.pplCols.map((h: string) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${people.map(pplRow).join('')}</tbody></table></div><p class="after">${esc(t.pplHidden)}</p>` : `<p class="lead">${esc(pplWhy ? t.pplNotRun(String(pplWhy.reason)) : t.pplNone)}</p>`}</div></section>`;

  // ---- what is working
  const goods = strengthsShown.map((f) => {
    const src = (Array.isArray(f.evidence) ? f.evidence : []).find((e) => typeof e?.source_url === 'string' && e.source_url.trim());
    return `<article class="goodc" id="${esc(f.id)}" ${idAttr(f.id)}><div class="tags"><span class="tag good">${esc(t.key.conf)}</span></div><h3>${esc(f.title)}${dbg(f.id)}</h3>${f.statement ? `<p>${esc(f.statement)}</p>` : ''}${src ? `<p class="s">${esc(t.strSource)} ${sourceLink(src.source_url)}</p>` : ''}</article>`;
  }).join('');
  const working = `<section class="sec band" id="strengths"><div class="in"><div class="head"><p class="eyebrow">${esc(t.strEye)}</p><h2 data-count="strengths">${esc(counts.strengths ? t.strHn(counts.strengths) : t.strNoneH)} <span class="g">${esc(counts.strengths ? t.strG : t.strNoneG)}</span></h2></div>
${goods ? `<div class="goods">${goods}</div>${counts.strengths > strengthsShown.length ? `<p class="after">${esc(t.moreStrengths(counts.strengths - strengthsShown.length))}</p>` : ''}` : `<p class="lead">${esc(t.noStrengths)}</p>`}</div></section>`;

  // ---- on / not on this page, doing it yourself, and a note for any AI reading the page
  const ons = [
    counts.findings ? t.on.findings(counts.findings) : t.on.none,
    ...(proofId ? [t.on.proof(!!fixFor)] : []),
    ...(counts.strengths ? [t.on.strengths(strengthsShown.length, counts.strengths)] : []),
  ];
  const offs = [...(withheld ? [t.off.values(withheld)] : []), ...(counts.findings ? [t.off.fixes] : []), t.off.rivals, t.off.records];
  const diyRows: string[][] = [...(counts.sources ? [t.diyRows.read(counts.sources)] : []), ...(withheld ? [t.diyRows.trace(withheld)] : []), t.diyRows.rivals, t.diyRows.records];
  const diyMin = counts.sources * 10 + withheld * 15 + 180;
  const hours = hoursText(diyMin);
  const notOn = `<section class="sec" id="not"><div class="in"><div class="head"><p class="eyebrow">${esc(t.notEye)}</p><h2>${esc(t.notH)} <span class="g">${esc(t.notG)}</span></h2></div>
<div class="cmp"><div><h3>${esc(t.onH)}</h3><ul>${ons.map((x) => `<li>${TICK}<span>${esc(x)}</span></li>`).join('')}</ul></div>
<div class="no"><h3>${esc(t.offH)}</h3><ul>${offs.map((x) => `<li>${LOCK16}<span>${esc(x)}</span></li>`).join('')}</ul></div></div>
<div class="diy"><div class="l"><h3>${esc(t.diyH)}</h3><table>${diyRows.map(([a, b]) => `<tr><td>${esc(a)}</td><td>${esc(b)}</td></tr>`).join('')}</table></div>
<div class="sum"><b>${esc(hours)}</b><span>${esc(t.diySum(price))}</span></div></div>
<div class="reader"><h3>${esc(t.readerH)}</h3><p>${esc(t.reader(counts.findings, !!proofId))}</p></div></div></section>`;

  // ---- the offer: the only #order on the page
  const getsN: GetsN = { findings: counts.findings };
  const offer = `<section class="sec dark" id="offer"><div class="in offer"><div><p class="eyebrow">${esc(t.offerEye)}</p><h2>${esc(t.offerH)}</h2><p class="lead">${esc(t.offerP)}</p>
<ul class="gets">${t.gets.map((g) => `<li><b>${esc(g.h)}</b><span>${esc(g.note?.(getsN) || g.p)}</span></li>`).join('')}</ul></div>
<div class="ask" id="order">${price ? `<div class="price"><b data-price>${esc(price)}</b><span>${esc(t.askSpan(hours))}</span></div>` : ''}
<p class="how">${esc(t.how)}</p><p class="msg" id="msg">${esc(t.orderLine(c, ref))}</p>
<button class="btn inv" id="copy" type="button">${esc(t.copy)}</button><p class="ok" id="ok" aria-live="polite"></p>
<p class="guar"><b>${esc(t.guarK)}</b> ${esc(t.guarantee)}</p><p class="keep">${esc(t.keep)}</p></div></div></section>`;

  // ---- the closing note, for the owner and any AI assistant they paste the page into. It argues from the problems, so a
  // page with none gets no note (its wording would be false there).
  const k = t.close;
  const by = fmt(new Date(when.getTime() + 72 * 3600000));
  const closing = counts.findings ? `<section class="sec band closing" id="closing"><div class="in"><div class="head"><h2>${esc(k.h(price))}</h2><p class="lead">${esc(k.intro)}</p></div><div class="body">
<div><h3>${esc(k.provesH)}</h3><p>${esc(k.proves(!!proofId))}</p></div>
<div><h3>${esc(k.unknownH)}</h3><p>${esc(k.unknownP)}</p><ul>${k.unknown.map((x) => `<li>${esc(x)}</li>`).join('')}</ul><p style="margin-top:12px">${esc(k.diy)}</p></div>
<div><h3>${esc(k.guessH(price))}</h3><p>${esc(k.guess)}</p></div>
<div><h3>${esc(k.rivalsH)}</h3><p>${esc(k.rivals)}</p></div>
<div><h3>${esc(k.waitH)}</h3><p>${esc(k.wait)}</p></div>
<div><h3>${esc(k.riskH)}</h3><p>${esc(k.risk)}</p></div>
<div><h3>${esc(k.testH)}</h3><p>${esc(k.testP)}</p><ol>${k.tests.map((x) => `<li>${esc(x)}</li>`).join('')}</ol><p style="margin-top:12px">${esc(k.testEnd)}</p></div>
<div class="short"><h3>${esc(k.shortH)}</h3><p>${esc(k.short(k.listPrice, price, by))}</p><p style="margin-top:12px"><a href="#order">${esc(k.order)}</a></p></div>
</div></div></section>` : '';

  const footer = `<footer><div class="in"><div><span class="k">${esc(t.foot.for)}</span><span>${esc(c)}</span></div><div><span class="k">${esc(t.foot.built)}</span><span>${esc(t.built(date, counts.sources))}</span></div>${ref ? `<div><span class="k">${esc(t.foot.ref)}</span><span>${esc(t.refText(ref))}</span></div>` : ''}<div><span class="k">${esc(t.foot.method)}</span><span>${esc(t.method)}</span></div></div></footer>`;

  const script = `<script>(function(){var b=document.getElementById('copy'),m=document.getElementById('msg'),ok=document.getElementById('ok');if(!b||!m||!ok)return;
function sel(){var r=document.createRange();r.selectNodeContents(m);var s=getSelection();s.removeAllRanges();s.addRange(r);ok.textContent=${JSON.stringify(t.selected)};}
b.addEventListener('click',function(){try{navigator.clipboard.writeText(m.textContent).then(function(){ok.textContent=${JSON.stringify(t.copied)};},sel);}catch(e){sel();}});})();</script>`;

  return `<!doctype html><html lang="${ko ? 'ko' : 'en'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><title>${esc(t.title(c))}</title>${FONTS(ko)}<style>${CSS}</style></head><body data-counts="${esc(JSON.stringify(flatCounts))}">
<header class="top"><div class="in"><div><b>${esc(t.bar)}</b> <span class="for">${esc(t.barFor(c))}</span></div><div class="r">${price ? `<span class="pr" data-price>${esc(price)}</span>` : ''}<a class="btn" href="#order">${esc(t.cta)}</a></div></div></header>
${hero}
${proof}
${questions}
${list}
${peopleSec}
${working}
${notOn}
${offer}
${closing}
${footer}
${script}
</body></html>`;
}

export function missingPage(ko = false): string {
  const t = ko ? P.ko : P.en;
  return `<!doctype html><html lang="${ko ? 'ko' : 'en'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${esc(t.bar)}</title>${FONTS(ko)}<style>${CSS}</style></head><body>
<section class="dark notready"><p class="eyebrow">${esc(t.bar)}</p><h2>${esc(t.missing)}<br><span class="g">${esc(t.missingP)}</span></h2></section></body></html>`;
}
