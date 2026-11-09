// V2.1 Step 3 (owner, 2026-11-06): write the free report and the email for one company, from its Step 2 rules-v2
// result only. Step 3 writes; it never judges.
//
// The report page is rendered by plain code from the Step 2 items themselves, so nothing on it can drift from Step 2.
// It was all four lists in full; since 2026-11-08 it is a preview that sells the full report: strengths and signals in
// full, the top 3 problems, 2 contradictions and 2 action steps in full, the rest as placeholders with no text in the
// HTML (see FREE_* below), and a code-set urgency badge on each problem. The LLM writes only two things, in one call:
//   summary   2-3 opening sentences for the report
//   email     a subject and 2-3 short paragraphs on why this report matters to this company
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

export const STEP3_PROMPT = 'step3-v3';
export const STEP3_REFINE_PROMPT = 'step3-refine-v2';

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
export type Step3Report = Step3Common & { kind: 'report'; summary: Line[] };
export type Step3Email = Step3Common & { kind: 'email'; subject: Line | null; body: Line[]; report_url: string; text: string };

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
    deeper: `This free report covers one pass over public sources. The full report runs one more time, as a deeper dive across 7 research areas: ${AREAS.en.map((a) => a[0].toLowerCase()).join('; ')}. It may uncover more that is worth knowing. Reply to this email to get your full report.`,
    link: (u: string) => `Your free report: ${u}`,
    sign: 'The Eternalgy team',
  },
  ko: {
    greeting: (c: string) => `${c} 담당자님께,`,
    deeper: `이 무료 보고서는 공개 자료를 한 번 살펴본 결과입니다. 전체 보고서는 7개 조사 영역(${AREAS.ko.map((a) => a[0]).join(', ')})에 걸쳐 한 번 더 심층 조사를 진행하며, 더 알아 두실 만한 내용이 나올 수 있습니다. 전체 보고서를 원하시면 이 이메일에 회신해 주세요.`,
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
  const c = (s2.contradictions ?? []).map((x) => ({ id: x.id, title: x.title, versions: x.versions.map((v) => `${v.source}: ${v.value}`), why_it_matters: x.why_it_matters }));
  const s = (s2.suggestions ?? []).map((x) => ({ id: x.id, action: x.action, why: x.why, based_on: x.based_on }));
  const n = (s2.take_note ?? []).filter((x) => !x.paid_only).map((x) => ({ id: x.id, title: x.title, note: x.note, why_not_conclusive: x.why_not_conclusive }));
  return JSON.stringify({ conclusive_findings: f, contradictions: c, suggestions: s, take_note: n }, null, 1);
}

export function step3SystemPrompt(s2: Step2V2Output, ko: boolean): string {
  return `You are Step 3 (the writer) of Company Dive V2.1 for "${s2.input.company}" (${s2.input.country}, ${s2.input.industry}).

WHY: the owner of this company will read a free report that shows what the public internet says about their company: every strength, problem, contradiction, suggestion and thing to look into below is printed on it in full, with its sources, by code. You write the two short pieces of copy around it:
1. "summary": 2 or 3 sentences at the top of the report page, each under 35 words. They are the first thing the owner reads; the first sentence must make them read on.
2. "email": the email that brings them the report link: a "subject" and a "body" of 2 or 3 short paragraphs, under 120 words in all. Its one goal is that the owner opens the report.
Code adds the greeting, a fixed paragraph about the full report, the link and the sign-off. Do not write any of those.

YOU WRITE; YOU NEVER JUDGE. The items below were judged by Step 2 and are the only facts you have.
${writerRules(ko)}

OUTPUT: one JSON object only:
{
  "summary": [ { "text": "...", "cites": ["f1", "c3"] } ],
  "email": {
    "subject": { "text": "...", "cites": ["f1"] },
    "body": [ { "text": "...", "cites": ["f1", "f4"] } ]
  }
}`;
}

/** The job and the writing rules, shared word for word by the writer (pass 1) and the second pass. */
function writerRules(ko: boolean): string {
  return `YOUR JOB IS TO SELL, WITH THE TRUTH
The free report exists for one reason: to make the owner want the paid full report. You are not summarising the report and you are not a neutral reporter; you write persuasive copy that makes the owner care about what is already true about their company in public. The truth is your only material, and it is enough.
- Pick this company's 2 or 3 strongest true facts: the ones that cost it the most, or that it stands to gain the most from. Do not list everything; the report shows the rest.
- For each fact you use, make three things plain: what it costs them (a lost enquiry, a lost sale, lost trust, a weaker bid, money, time), who meets it (customers, banks, partners, staff they hire, rivals, Google, AI assistants: whoever the cited items name), and why it is worth acting on (it is public, so anyone looking them up sees it today). Take the cost and the audience from the items' own words (why_it_matters, why); never add ones they do not give.
- Lead with the fact that hits hardest for THIS company. A subject that names one concrete fact about them beats a general one.
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
8. Ownership. Say "your domain" and tell the owner to renew or fix a domain only when its domain_ownership is "owned". For "used_by" or "unknown", name the domain neutrally and say "if you control it".
9. Say "independent" or "third-party" only for an item whose sources include "independent". An item with only "first" sources is the company's own word.
10. No stock sentences: write each line from its own item's facts, never a sentence you could paste under any other item. Plain words for the owner; never say worker, input, pipeline, benchmark, review item or "the data".
11. Never write a private person's name or a personal phone number. A reviewer is "a reviewer".
12. Language: ${ko ? 'this is a South Korean company: write in Korean. Names, domains and numbers stay exactly as in the items.' : 'English.'}`;
}

/** The second pass: read the raw input, the Step 2 items and the checked draft; return the refined parts. */
export function refineSystemPrompt(s2: Step2V2Output, ko: boolean): string {
  return `You are the second reader of Step 3 (the writer) of Company Dive V2.1 for "${s2.input.company}" (${s2.input.country}, ${s2.input.industry}).

WHY: the owner of this company will read a free report showing what the public internet says about their company; every Step 2 item is printed on it in full, with its sources. A first writer drafted two short things around it: "summary" (2 or 3 opening sentences, each under 35 words) and "email" (a subject and 2 or 3 short paragraphs, under 120 words in all, on why this report matters to THIS company, using its 2 or 3 strongest facts). Your job is to make them better: truer, sharper and more relevant to this company.

YOU GET:
- RAW INPUT: everything Step 1 and Step 1.5 gathered, exactly as Step 2 read it (the company's own pages, outside sources, the technical audit).
- STEP 2 ITEMS: the judged facts (f#, c#, s#, n#). They are the only facts the report may state.
- DRAFT: the first writer's summary and email, each sentence with its cites, and any sentences code rejected, with why.

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
    answer = await askLanes(messages, { lanes: options.lanes, deadCallMs: options.deadCallMs, maxTokens: 8192, accept: (text) => void parseAnswer(text) });
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

    // Second pass: the refined part replaces the draft's only when it passes the same check.
    let final = draft;
    let refine: Refine | undefined;
    if (refineOn()) {
      const r = await refineStep3(s2, ko, draft, [...rRejected, ...eRejected], options);
      refine = r.refine;
      if (r.parts) {
        const useSummary = r.parts.summary.length > 0;
        const useEmail = emailOk(r.parts);
        final = { summary: useSummary ? r.parts.summary : draft.summary, subject: useEmail ? r.parts.subject : draft.subject, body: useEmail ? r.parts.body : draft.body };
        refine.used = { summary: useSummary ? 'refined' : 'draft', email: useEmail ? 'refined' : 'draft' };
      }
    }

    const report: Step3Report = {
      ...common, kind: 'report', status: 'ok', error: null, summary: final.summary, rejected: rRejected, meta, llm_raw: answer.text,
      ...(refine ? { refine } : {}),
    };
    const emailError = !final.subject ? 'the subject was rejected' : !final.body.length ? 'every body paragraph was rejected' : null;
    const email: Step3Email = {
      ...common, kind: 'email', status: emailError ? 'failed' : 'ok', error: emailError, subject: final.subject, body: final.body,
      report_url: reportUrl, text: emailError ? '' : emailText(s2.input.company, ko, final.subject, final.body, reportUrl),
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
      email: { ...failed, kind: 'email', subject: null, body: [], report_url: reportUrl, text: '' },
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
  options: { lanes?: Lane[]; deadCallMs?: number; raw?: TidyData | null },
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
        `DRAFT:\n${JSON.stringify({ summary: draft.summary, email: { subject: draft.subject, body: draft.body }, rejected_by_code: draftRejected.map((r) => ({ part: r.part, text: (r.item as any)?.text ?? null, reasons: r.reasons })) }, null, 1)}`,
        'Refine the summary and the email now under the rules. Return the JSON object only.',
      ].join('\n\n'),
    },
  ];
  let answer: Awaited<ReturnType<typeof askLanes>> | null = null;
  try {
    answer = await askLanes(messages, { lanes: options.lanes, deadCallMs: options.deadCallMs, maxTokens: 8192, accept: (text) => void parseAnswer(text) });
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

/** How many of each list the free page shows in full, top N by rank. The rest are locked placeholders. One rule for every section. */
export const FREE_N = { strengths: Infinity, problems: 3, contradictions: 2, notes: 1, suggestions: 2 };
type GetsN = { shownP: number; totalP: number; hiddenP: number; shownS: number; hiddenS: number };

const URG_ORDER: Urgency[] = ['critical', 'high', 'medium', 'low'];
// The kind of record a finding is about; severity() bumps it one level when the wording names a break (expired, spoofable,
// dummy, unreachable ...), caps it at High unless Step 2 was highly confident, and raises it by the days left to an expiry.
const TOPIC_BASE: Record<string, number> = {
  registration: 3, licence: 3, email: 3, contact: 3, identity: 2, website: 2, reviews: 2, reputation: 2, scale: 1, awards: 1, other: 1,
};
const BREAK_WORDS = /expire|spoof|dmarc|\bspf\b|blacklist|suspend|revok|lapse|fraud|dummy|placeholder|disconnect|unreachable|bounce|not working|no longer|invalid|wrong/i;
/** The topics a bank, tender panel or partner checks against the company's own claims. */
const RECORD_TOPICS = new Set(['registration', 'licence', 'awards']);

type Rated = { urg: Urgency; days: number | null; key: number };
/** Urgency, days to impact and sort key of one item. Days come from `expires_at` when Step 2 gave one, else from dates in its text and quotes. */
export function rate(x: { topic?: string; confidence?: string; expires_at?: string }, texts: string[], now: Date): Rated {
  const at = x.expires_at ? Date.parse(x.expires_at) : NaN;
  const days = Number.isFinite(at) ? Math.ceil((at - now.getTime()) / 86400000) : daysToImpact(texts, now);
  const urg = severity({ recordLevel: TOPIC_BASE[String(x.topic ?? 'other')] ?? 1, confidence: x.confidence, days, breaks: BREAK_WORDS.test(texts.join(' ')) });
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
    h1: (c: string) => `What the public internet says about ${c}.`,
    h1g: (contra: number) => (contra ? 'Not every source tells the same story.' : 'Every item, with its source.'),
    seeAll: 'See what we found',
    anyone: 'Built from public sources only. Anyone can look these up, your rivals included.',
    stamp: 'Prepared for you', fileNo: 'Free report',
    fCountry: 'Country', fIndustry: 'Industry', fSites: 'Websites', fFound: 'This report',
    found: (n: number) => `${plural(n, 'item', 'items')} found, each with its source`,
    fileFoot: (d: string) => `Built ${d} from public sources`,
    strip: {
      strengths: (n: number) => `${noun(n, 'strength', 'strengths')} the sources confirm`, problems: (n: number) => `${noun(n, 'problem', 'problems')} someone looking you up runs into`,
      contradictions: (n: number) => `${noun(n, 'place', 'places')} where sources disagree`, notes: (n: number) => `${noun(n, 'signal', 'signals')} worth checking`,
    },
    thesisEye: 'Why this matters', thesisH: 'How good you are', thesisG: 'is how clearly the market sees it.',
    thesisP: 'Customers, banks, partners and AI assistants rarely see your work first. They see what is published about you, and decide from that. A strong business the market reads wrongly loses to a weaker one it reads clearly.',
    sec: {
      strengths: ['Strengths', 'What is working for you.', 'Each one confirmed by the sources under it.'],
      problems: ['Problems', 'What people run into today.', 'A customer, a bank, Google or a stranger, looking you up.'],
      contradictions: ['Where sources disagree', 'The same fact, told differently.', 'It depends on where someone looks.'],
      notes: ['Worth looking into', 'Signals worth checking.', 'The evidence does not prove them.'],
      suggestions: ['What you can do', 'Concrete steps.', 'Each one tied to the items above.'],
    },
    tag: { strength: 'Strength', problem: 'Problem', contra: 'Sources disagree', note: 'Worth checking' },
    why: 'Why it matters', notCertain: 'Why this is not certain', basedOn: 'Based on', sources: 'Sources', source: 'Source', value: 'What it says',
    // Short names for ids, so the page never prints f1 / s3 / c2 / n4.
    lab: { strength: 'Strength', problem: 'Problem', contra: 'Source disagreement', note: 'Signal', step: 'Step' }, hint: 'issue',
    bandEye: 'The full report', bandH: 'Read it before your competitors do.', bandG: 'Fix it before your customers see it.',
    bandP: 'Everything on this page came from public sources. Anyone can find it, your rivals included.',
    cta: 'Get my full report', ctaP: 'Reply to the email that brought you this link, and we will run it for you.', keep: 'This free report is yours to keep.',
    colophon: [['Prepared for', (c: string, _d: string) => c], ['Built', (_c: string, d: string) => `${d}, from public sources`], ['Edition', (_c: string, _d: string) => 'Free report · one pass'], ['Method', (_c: string, _d: string) => 'Web pages, maps, directories, reviews, and a technical check of your domains and website.']] as Array<[string, (c: string, d: string) => string]>,
    urg: { critical: 'Critical', high: 'High', medium: 'Medium', low: 'Low' } as Record<Urgency, string>,
    urgLabel: 'Urgency',
    urgHow: 'Urgency is set from the kind of record affected (registration, licence, contact, email ...) and how sure the evidence is. Critical means fix first.',
    topic: { contact: 'Contact details', identity: 'Company identity', website: 'Website', email: 'Email', reviews: 'Reviews', scale: 'Company size', licence: 'Licences', awards: 'Awards', registration: 'Registration', reputation: 'Reputation', other: 'Other' } as Record<string, string>,
    fHighest: 'Highest urgency',
    execH: 'Action required.',
    exec: (p: number, c: number, hi: number) => `We found ${plural(p, 'problem', 'problems')} and ${plural(c, 'place', 'places')} where sources disagree${hi ? `; ${hi} ${hi === 1 ? 'is' : 'are'} rated Critical or High` : ''}.`,
    execContra: 'Every day these differences stay public, customers, banks and partners see two versions of your business.',
    execPlain: 'Every day these problems stay public, customers, banks and partners run into them.',
    pitchProblems: ['Fix this before your next high-value prospect is misled.', 'These are what a customer, a bank or a partner meets when they look you up today.'],
    pitchContra: ['Your competitors can look up these sources right now.', 'Anyone comparing you with a rival can find these differences. Settle them before your next bid or pitch.'],
    recH: 'Records that banks and tender panels check.',
    rec: (n: number) => `${plural(n, 'finding', 'findings')} ${n === 1 ? 'concerns' : 'concern'} registration, licences or awards. A bank, tender panel or partner can compare ${n === 1 ? 'it' : 'these'} with what your own site says.`,
    locked: 'In the full report',
    lockedCard: { problems: (n: number) => `${n} more ${noun(n, 'problem', 'problems')} found`, contradictions: (n: number) => `${n} more ${noun(n, 'place', 'places')} where sources disagree`, notes: (n: number) => `${n} more ${noun(n, 'signal', 'signals')} worth checking` },
    lockedCardP: 'Their titles, evidence and sources are in the full report.',
    secSugLocked: ['Action plan', 'Start here.', 'The first steps. The rest are in the full report.'],
    lockedSugs: 'The full action plan, written out',
    lockedSugsP: 'Every finding becomes a task for the department that does it (website, social media, IT, other), with the work written for you where the findings call for it: your homepage rewritten, review replies ready to post, pages to add town by town, and the page data for Google.',
    lockedSugsTally: 'Desktop, mobile and A4 PDF',
    unlock: 'Unlock all findings',
    stickyN: (n: number) => `${plural(n, 'issue', 'issues')} found`,
    stickyP: 'Sources, evidence and every fix are in the full report.',
    // What the paid report holds, from the full-report sample (eternalgy-full-report-with-ai-section-2026-11-09). No counts of tasks or pages.
    insideEye: 'What you get', insideH: 'What the full report', insideG: 'puts in your hands.',
    insideP: 'The free report shows what we found. The full report is the working document for your team: every finding, who fixes it, and the fix written out where we can.',
    gets: [
      { h: 'Your scorecard', p: 'Where you stand in six numbers, then the three problems costing you the most customers. For each: what it costs you and what to do first.' },
      { h: 'Every finding, with its evidence', p: 'The full checklist, part by part. Each item is marked Urgent or Needs work and links to the page it came from.', note: (n: GetsN) => n.hiddenP ? `This free report prints ${n.shownP} of ${plural(n.totalP, 'problem', 'problems')}.` : '' },
      { h: 'What ChatGPT and Gemini say about you', p: 'We ask both the questions a customer asks, as a stranger. You see whether they name you, how they score you against your competitors, and whether they would send the customer to you or to a rival, and which rival.' },
      { h: 'What a stranger learns in ten minutes', p: 'Your company as a customer, a bank or a tender officer sees it: registration, Google rating, address, websites, and a list of what does not add up.' },
      { h: 'An action plan, department by department', p: 'Website, social media, IT and other. Each task says who does it, how long it takes and how much it matters, and points to the part of the report behind it.', note: (n: GetsN) => n.hiddenS && n.shownS ? `This free report prints ${n.shownS === 1 ? 'the first step' : `the first ${plural(n.shownS, 'step', 'steps')}`}.` : '' },
      { h: 'Done for you: the copy, written', p: 'Your homepage rewritten, review replies ready to post, a WhatsApp message asking customers for a review, an FAQ page for your site, pages to add town by town, and the business details for Google and AI to paste in. Written only from facts we verified, wherever the findings call for it.' },
      { h: 'A plan to get recommended by AI assistants', p: 'The specific steps, such as more reviews, one name, address and phone everywhere, and a page for each service and town, and how to track whether the assistants start naming you.' },
    ],
    missing: 'This report is not ready yet.', missingP: 'Please come back to this link a little later.',
  },
  ko: {
    title: (c: string) => `${c}: 공개 인터넷이 말하는 것`,
    bar: '온라인 평판 보고서', barFor: (c: string) => `· ${c} 귀중`,
    eyebrow: (c: string, d: string) => `무료 보고서 · ${c} 귀중 · ${d}`,
    h1: (c: string) => `공개 인터넷이 ${c}에 대해 말하는 것.`,
    h1g: (contra: number) => (contra ? '모든 출처가 같은 이야기를 하지는 않습니다.' : '모든 항목에 출처가 있습니다.'),
    seeAll: '찾은 내용 보기',
    anyone: '공개 자료만으로 만들었습니다. 경쟁사를 포함해 누구나 찾아볼 수 있습니다.',
    stamp: '귀사 전용', fileNo: '무료 보고서',
    fCountry: '국가', fIndustry: '업종', fSites: '웹사이트', fFound: '이 보고서',
    found: (n: number) => `${n}개 항목, 모두 출처 포함`,
    fileFoot: (d: string) => `${d} 공개 자료로 작성`,
    strip: { strengths: (_n: number) => '출처가 확인해 주는 강점', problems: (_n: number) => '귀사를 찾아보는 사람이 마주칠 문제', contradictions: (_n: number) => '출처마다 다른 정보', notes: (_n: number) => '확인해 볼 만한 신호' },
    thesisEye: '왜 중요한가', thesisH: '얼마나 잘하는지는', thesisG: '시장이 얼마나 분명히 보느냐로 정해집니다.',
    thesisP: '고객, 은행, 파트너, AI 비서는 귀사의 일을 먼저 보지 않습니다. 귀사에 대해 공개된 내용을 보고 판단합니다. 시장이 잘못 읽는 강한 회사는 분명히 읽히는 약한 회사에 밀립니다.',
    sec: {
      strengths: ['강점', '잘되고 있는 것.', '각 항목 아래 출처가 확인해 줍니다.'],
      problems: ['문제점', '오늘 사람들이 마주치는 것.', '귀사를 찾아보는 고객, 은행, 구글, 또는 낯선 사람.'],
      contradictions: ['출처마다 다른 정보', '같은 사실, 다른 내용.', '어디를 보느냐에 따라 달라집니다.'],
      notes: ['확인해 볼 만한 점', '확인해 볼 만한 신호.', '증거가 이를 입증하지는 않습니다.'],
      suggestions: ['할 수 있는 일', '구체적인 조치.', '각 조치는 위 항목에 근거합니다.'],
    },
    tag: { strength: '강점', problem: '문제점', contra: '출처마다 다름', note: '확인해 볼 점' },
    why: '왜 중요한가', notCertain: '확실하지 않은 이유', basedOn: '근거', sources: '출처', source: '출처', value: '내용',
    lab: { strength: '강점', problem: '문제', contra: '출처 불일치', note: '신호', step: '조치' }, hint: '항목',
    bandEye: '전체 보고서', bandH: '경쟁사보다 먼저 읽으세요.', bandG: '고객이 보기 전에 고치세요.',
    bandP: '이 페이지의 모든 내용은 공개 자료에서 나왔습니다. 경쟁사를 포함해 누구나 찾을 수 있습니다.',
    cta: '전체 보고서 받기', ctaP: '이 링크를 받은 이메일에 회신해 주시면 진행해 드립니다.', keep: '이 무료 보고서는 귀사가 보관하시면 됩니다.',
    colophon: [['받는 곳', (c: string, _d: string) => c], ['작성', (_c: string, d: string) => `${d}, 공개 자료 기준`], ['구분', (_c: string, _d: string) => '무료 보고서 · 1차 조사'], ['방법', (_c: string, _d: string) => '웹 페이지, 지도, 디렉터리, 리뷰, 그리고 도메인과 웹사이트의 기술 점검.']] as Array<[string, (c: string, d: string) => string]>,
    urg: { critical: '매우 긴급', high: '긴급', medium: '보통', low: '낮음' } as Record<Urgency, string>,
    urgLabel: '긴급도',
    urgHow: '긴급도는 영향을 받는 기록의 종류(등록, 면허, 연락처, 이메일 등)와 증거의 확실성으로 정합니다. 매우 긴급은 가장 먼저 고쳐야 한다는 뜻입니다.',
    topic: { contact: '연락처', identity: '회사 정보', website: '웹사이트', email: '이메일', reviews: '리뷰', scale: '회사 규모', licence: '면허', awards: '수상', registration: '등록', reputation: '평판', other: '기타' } as Record<string, string>,
    fHighest: '최고 긴급도',
    execH: '조치가 필요합니다.',
    exec: (p: number, c: number, hi: number) => `문제점 ${p}개와 출처마다 다른 정보 ${c}건을 찾았습니다${hi ? `. 그중 ${hi}건은 긴급 이상입니다` : ''}.`,
    execContra: '이 차이가 공개된 채로 있는 동안, 고객과 은행, 파트너는 귀사의 서로 다른 두 모습을 보게 됩니다.',
    execPlain: '이 문제가 공개된 채로 있는 동안, 고객과 은행, 파트너가 그대로 마주칩니다.',
    pitchProblems: ['중요한 고객이 잘못된 정보를 보기 전에 고치세요.', '오늘 고객, 은행, 파트너가 귀사를 찾아볼 때 마주치는 것입니다.'],
    pitchContra: ['경쟁사도 지금 이 출처들을 찾아볼 수 있습니다.', '귀사를 경쟁사와 비교하는 사람은 누구나 이 차이를 발견할 수 있습니다. 다음 입찰이나 제안 전에 정리하세요.'],
    recH: '은행과 입찰 심사단이 확인하는 기록.',
    rec: (n: number) => `${n}건이 등록, 면허, 수상과 관련됩니다. 은행, 입찰 심사단, 파트너는 이를 귀사 웹사이트의 내용과 비교할 수 있습니다.`,
    locked: '전체 보고서에서 확인',
    lockedCard: { problems: (n: number) => `문제점 ${n}개 더 발견`, contradictions: (n: number) => `출처마다 다른 정보 ${n}건 더 발견`, notes: (n: number) => `확인해 볼 신호 ${n}개 더 발견` },
    lockedCardP: '제목, 증거, 출처는 전체 보고서에 있습니다.',
    secSugLocked: ['실행 계획', '여기서 시작하세요.', '처음 몇 가지 조치입니다. 나머지는 전체 보고서에 있습니다.'],
    lockedSugs: '전체 실행 계획, 작업 내용까지',
    lockedSugsP: '모든 발견 사항이 담당 부서(웹사이트, 소셜 미디어, IT, 기타)의 할 일이 되며, 발견 사항에 따라 작업 내용도 작성해 드립니다: 다시 쓴 홈페이지, 바로 게시할 수 있는 리뷰 답글, 지역별 추가 페이지, 구글용 페이지 데이터.',
    lockedSugsTally: '데스크톱, 모바일, A4 PDF',
    unlock: '모든 발견 사항 보기',
    stickyN: (n: number) => `${n}건 발견`,
    stickyP: '출처, 증거, 모든 해결 방법은 전체 보고서에 있습니다.',
    insideEye: '받으시는 내용', insideH: '전체 보고서가', insideG: '손에 쥐여 드리는 것.',
    insideP: '무료 보고서는 발견한 내용을 보여 드립니다. 전체 보고서는 귀사 팀이 바로 쓸 수 있는 실무 문서입니다: 모든 발견 사항, 담당자, 가능한 곳은 해결책까지 써 드립니다.',
    gets: [
      { h: '한눈에 보는 성적표', p: '여섯 가지 수치로 보는 현재 위치와, 고객을 가장 많이 놓치게 하는 문제 세 가지. 각각 어떤 손실인지, 가장 먼저 무엇을 할지 알려 드립니다.' },
      { h: '모든 발견 사항과 증거', p: '부문별 전체 체크리스트. 각 항목에 긴급 또는 개선 필요 표시가 있고 출처 페이지로 연결됩니다.', note: (n: GetsN) => n.hiddenP ? `이 무료 보고서에는 문제 ${n.totalP}개 중 ${n.shownP}개만 있습니다.` : '' },
      { h: 'ChatGPT와 Gemini가 귀사에 대해 말하는 것', p: '고객이 묻는 질문을 낯선 사람처럼 두 AI에 물어봅니다. 귀사를 언급하는지, 경쟁사와 비교해 몇 점을 주는지, 고객에게 귀사와 경쟁사 중 어디를 권하는지, 권한다면 어느 경쟁사인지 확인하실 수 있습니다.' },
      { h: '낯선 사람이 10분 안에 알게 되는 것', p: '고객, 은행, 입찰 담당자가 보는 귀사의 모습: 등록 정보, 구글 평점, 주소, 웹사이트, 그리고 서로 맞지 않는 항목 목록.' },
      { h: '부서별 실행 계획', p: '웹사이트, 소셜 미디어, IT, 기타. 각 과제에 담당자, 소요 시간, 중요도와 근거가 된 보고서 부분이 표시됩니다.', note: (n: GetsN) => n.hiddenS ? `이 무료 보고서에는 첫 ${n.shownS}단계만 있습니다.` : '' },
      { h: '바로 쓸 수 있게 써 드립니다', p: '다시 쓴 홈페이지, 바로 게시할 수 있는 리뷰 답글, 리뷰를 부탁하는 WhatsApp 메시지, 웹사이트용 FAQ 페이지, 지역별 추가 페이지, 구글과 AI용 사업자 정보를 붙여 넣을 수 있게 준비합니다. 발견 사항에 따라 필요한 것만, 확인된 사실로만 작성합니다.' },
      { h: 'AI 비서가 귀사를 추천하게 만드는 계획', p: '리뷰 늘리기, 이름·주소·전화번호 통일, 서비스·지역별 페이지 같은 구체적인 단계와, AI 비서가 귀사를 언급하기 시작하는지 추적하는 방법.' },
    ],
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

/** The free report page: the Step 3 summary, then every Step 2 item in full, then what the full report adds. */
export function reportPage(report: Step3Report, s2: Step2V2Output, options: { debug?: boolean; now?: Date } = {}): string {
  const now = options.now ?? new Date();
  const ko = report.language === 'ko';
  const t = ko ? P.ko : P.en;
  const c = s2.input.company;
  const loc = localeFor(s2.input.country, ko ? 'ko' : 'en');
  const price = loc.price;
  let date: string;
  try { date = new Date(report.created_at).toLocaleDateString(loc.dateLocale, { day: 'numeric', month: 'short', year: 'numeric' }); } catch { date = new Date(report.created_at).toISOString().slice(0, 10); }
  type Finding = Step2V2Output['conclusive_findings'][number];
  type Contra = Step2V2Output['contradictions'][number];
  type Note = Step2V2Output['take_note'][number];
  type Sug = Step2V2Output['suggestions'][number];
  type Extra = { paid_only?: boolean; identity_signal?: boolean; check_id?: string; expires_at?: string };

  // Never print the same id twice, and never print what is for the paid report only (paid_only, identity_signal).
  const seen = new Set<string>(); const removed = new Set<string>();
  const usable = <T extends { id: string }>(list: T[] | undefined): T[] => (list ?? []).filter((x) => {
    const e = x as T & Extra;
    if (e.paid_only || e.identity_signal) { removed.add(x.id); return false; }
    if (seen.has(x.id)) return false;
    seen.add(x.id);
    return true;
  });
  const findings = usable(s2.conclusive_findings);
  const contraAll = usable(s2.contradictions);
  const noteAll = usable(s2.take_note);
  // A step resting on an item held back for the paid report is held back with it.
  const sugAll = usable(s2.suggestions).filter((x) => !(x.based_on ?? []).some((id) => removed.has(id)));

  const quotes = (ev: Array<{ quoted_text: string }> | undefined) => (ev ?? []).map((e) => e.quoted_text);
  const ratings = new Map<string, Rated>();
  for (const f of findings) ratings.set(f.id, rate({ ...f, expires_at: (f as Finding & Extra).expires_at }, [f.title, f.statement, f.why_it_matters, ...quotes(f.evidence)], now));
  for (const x of contraAll) ratings.set(x.id, rate({ ...x, expires_at: (x as Contra & Extra).expires_at }, [x.title, x.why_it_matters, ...x.versions.flatMap((v) => [v.value, v.quoted_text])], now));
  for (const x of noteAll) ratings.set(x.id, rate({ topic: x.topic, expires_at: (x as Note & Extra).expires_at }, [x.title, x.note, ...quotes(x.evidence)], now));
  const keyOf = (id: string) => ratings.get(id)?.key ?? 0;

  const strengths = ranked(findings.filter((f) => f.kind === 'strength'), (f) => keyOf(f.id));
  const problems = ranked(findings.filter((f) => f.kind === 'problem'), (f) => keyOf(f.id));
  const contradictions = ranked(contraAll, (x) => keyOf(x.id));
  const notes = ranked(noteAll, (x) => keyOf(x.id));
  // A step ranks with the most urgent item it rests on.
  const suggestions = ranked(sugAll, (s) => Math.max(0, ...(s.based_on ?? []).map(keyOf)));

  // One gate for every section: the top N by rank are shown, the rest are locked.
  const topN = <T,>(list: T[], n: number) => ({ shown: list.slice(0, n), hidden: list.slice(n) });
  const gP = topN(problems, FREE_N.problems);
  const gC = topN(contradictions, FREE_N.contradictions);
  const gN = topN(notes, FREE_N.notes);
  const visibleIds = new Set<string>([...strengths, ...gP.shown, ...gC.shown, ...gN.shown].map((x) => x.id));
  // An action step is free only when everything it rests on is on the page, so it cannot give away a locked item.
  const freeSugs = suggestions.filter((s) => (s.based_on ?? []).length > 0 && s.based_on.every((id) => visibleIds.has(id))).slice(0, FREE_N.suggestions);
  const freeSugIds = new Set(freeSugs.map((s) => s.id));
  const lockedSugs = suggestions.filter((s) => !freeSugIds.has(s.id));
  // A summary line may cite only what is printed in full.
  const summary = report.summary.filter((l) => l.cites.every((id) => visibleIds.has(id)));

  // Every number on the page reads from this object. "issues" = problems + contradictions; "items" = everything found,
  // strengths and signals included (the action steps are advice, not findings).
  const issueUrg = [...problems, ...contradictions].map((x) => ratings.get(x.id)!.urg);
  const counts = {
    strengths: strengths.length, problems: problems.length, contradictions: contradictions.length, notes: notes.length, suggestions: suggestions.length,
    issues: problems.length + contradictions.length,
    items: strengths.length + problems.length + contradictions.length + notes.length,
    shown: { strengths: strengths.length, problems: gP.shown.length, contradictions: gC.shown.length, notes: gN.shown.length, suggestions: freeSugs.length },
    hidden: { problems: gP.hidden.length, contradictions: gC.hidden.length, notes: gN.hidden.length, suggestions: lockedSugs.length },
    urgent: issueUrg.filter((u) => u === 'critical' || u === 'high').length,
    // Items of every type whose topic a bank, tender panel or partner checks, each counted once.
    records: [...strengths, ...problems, ...contradictions, ...notes].filter((x) => RECORD_TOPICS.has(String(x.topic))).length,
  };

  // The headline is rank #1 of problems and contradictions together: the same ranking the sections use.
  const topId = ranked<{ id: string }>([...problems, ...contradictions], (x) => keyOf(x.id))[0]?.id;
  const topUrg = topId ? ratings.get(topId)!.urg : null;

  // Short customer-facing labels for ids; the id itself is only in title= / data-id, or printed in debug mode.
  const labels = new Map<string, string>();
  strengths.forEach((x, i) => labels.set(x.id, `${t.lab.strength} ${i + 1}`));
  problems.forEach((x, i) => labels.set(x.id, `${t.lab.problem} ${i + 1}`));
  contradictions.forEach((x, i) => labels.set(x.id, `${t.lab.contra} ${i + 1}`));
  notes.forEach((x, i) => labels.set(x.id, `${t.lab.note} ${i + 1}`));
  suggestions.forEach((x, i) => labels.set(x.id, `${t.lab.step} ${i + 1}`));
  const labelOf = (id: string) => (options.debug ? `${labels.get(id) ?? ''} (${id})` : labels.get(id) ?? '');
  const idAttr = (id: string) => `title="${esc(id)}" data-id="${esc(id)}"`;
  const cites = (ids: string[]) => ids.filter((id) => labels.has(id)).map((id) => `<a class="cite" href="#${esc(id)}" ${idAttr(id)}>${esc(labelOf(id))}</a>`).join('');
  const idLinks = (ids: string[]) => `<span class="ids">${ids.filter((id) => labels.has(id)).map((id) => `<a href="#${esc(id)}" ${idAttr(id)}>${esc(labelOf(id))}</a>`).join('')}</span>`;

  const badge = (u: Urgency) => `<span class="urg ${u}" aria-label="${esc(t.urgLabel)}: ${esc(t.urg[u])}">${esc(t.urg[u])}</span>`;
  const tally = (us: Urgency[]) => URG_ORDER.map((k) => [k, us.filter((u) => u === k).length] as const).filter(([, n]) => n).map(([k, n]) => `${n} ${t.urg[k]}`).join(' · ');
  const lockIcon = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>';
  const sites = (s2.baseline?.websites ?? []).map((w) => String(w).replace(/\s*\(.*\)\s*$/, '')).filter(Boolean).slice(0, 3);
  const firstSection = (['strengths', 'problems', 'contradictions', 'notes'] as const).find((k) => counts[k]);

  const head = (key: keyof typeof t.sec, n: number, pitch?: readonly [string, string], sec?: readonly [string, string, string]) => {
    const [eye, h, g] = sec ?? t.sec[key];
    return `<div class="head"><p class="eyebrow">${esc(eye)} · ${n}</p><h2>${esc(h)}<br><span class="g">${esc(g)}</span></h2>${pitch ? `<p class="pitch">${esc(pitch[0])}<span>${esc(pitch[1])}</span></p>` : ''}</div>`;
  };
  const cardHead = (cls: string, label: string, id: string, urg?: Urgency) => `<div class="warnhead"><span class="hl"><span class="tag ${cls}">${esc(label)}</span>${urg ? badge(urg) : ''}</span><span class="fileno" ${idAttr(id)}>${esc(labelOf(id))}</span></div>`;
  const bars = (n = 3) => `<div class="bars" aria-hidden="true">${['s', 'm', '', 'm'].slice(0, n).map((w) => `<i${w ? ` class="${w}"` : ''}></i>`).join('')}</div>`;
  const lockLine = (label: string) => `<p class="lk">${lockIcon}${esc(label)}</p>`;

  // A locked teaser title: the kind of record plus a short hint (the check, else "issue 2"), unique within its section.
  const teasers = (list: Array<{ id: string; topic?: string }>): Map<string, string> => {
    const out = new Map<string, string>(); const used = new Set<string>(); const perTopic = new Map<string, number>();
    for (const x of list) {
      const topic = t.topic[String(x.topic)] ?? t.topic.other;
      const k = (perTopic.get(topic) ?? 0) + 1; perTopic.set(topic, k);
      const check = String((x as Extra).check_id ?? '').replace(/[_-]+/g, ' ').trim();
      let title = `${topic}: ${check || `${t.hint} ${k}`}`;
      if (used.has(title)) title = `${topic}: ${t.hint} ${k}`;
      for (let n = 2; used.has(title); n++) title = `${topic}: ${t.hint} ${k}.${n}`;
      used.add(title); out.set(x.id, title);
    }
    return out;
  };
  const tP = teasers(gP.hidden); const tC = teasers(gC.hidden); const tN = teasers(gN.hidden);

  const finding = (f: Finding) => {
    const cls = f.kind === 'strength' ? 'good' : 'wrong';
    return `<article class="warn ${cls}${f.id === topId ? ' first' : ''}" id="${esc(f.id)}">${cardHead(cls, f.kind === 'strength' ? t.tag.strength : t.tag.problem, f.id, f.kind === 'problem' ? ratings.get(f.id)!.urg : undefined)}
<h3>${esc(f.title)}</h3><p class="d">${esc(f.statement)}</p>${f.why_it_matters ? `<p class="risk"><b>${esc(t.why)}:</b> ${esc(f.why_it_matters)}</p>` : ''}${evidenceList(f.evidence, t.sources)}</article>`;
  };
  // A locked item: its id, kind and teaser title only. Text, evidence and sources are not in the HTML.
  const lockedCard = (cls: string, tag: string, id: string, title: string, urg?: Urgency) => `<article class="warn ${cls} locked" id="${esc(id)}">${cardHead(cls, tag, id, urg)}<p class="topic">${esc(title)}</p>${bars()}${lockLine(t.locked)}</article>`;
  const unlockCard = (title: string, text: string, extra = '') => `<div class="unlock"><div><h3>${esc(title)}</h3><p>${esc(text)}</p>${extra ? `<p class="tally">${esc(extra)}</p>` : ''}</div><a class="btn" href="#order">${esc(t.unlock)}&nbsp;→</a></div>`;

  // A shown contradiction shows every version with its source link and quote; a locked one shows none of it.
  const contradiction = (x: Contra) => `<article class="warn contra${x.id === topId ? ' first' : ''}" id="${esc(x.id)}">${cardHead('contra', t.tag.contra, x.id, ratings.get(x.id)!.urg)}<h3>${esc(x.title)}</h3>
<table class="ledger"><thead><tr><th>${esc(t.source)}</th><th>${esc(t.value)}</th></tr></thead><tbody>${x.versions.map((v) => `<tr><td class="where">${esc(v.source)}<small>${sourceLink(v.source_url)}</small></td><td class="said"><b>${esc(v.value)}</b>${v.quoted_text && v.quoted_text.trim() !== String(v.value).trim() ? `<q>${esc(v.quoted_text)}</q>` : ''}</td></tr>`).join('')}</tbody></table>
${x.why_it_matters ? `<p class="risk"><b>${esc(t.why)}:</b> ${esc(x.why_it_matters)}</p>` : ''}</article>`;

  const note = (x: Note) => `<article class="warn missing" id="${esc(x.id)}">${cardHead('missing', t.tag.note, x.id)}<h3>${esc(x.title)}</h3><p class="d">${esc(x.note)}</p>
<p class="risk"><b>${esc(t.notCertain)}:</b> ${esc(x.why_not_conclusive)}</p>${evidenceList(x.evidence, t.sources)}</article>`;

  const suggestion = (x: Sug, i: number) => `<div class="sug" id="${esc(x.id)}"><span class="rn">${two(i + 1)}</span>
<div class="rw"><b>${esc(x.action)}</b><p>${esc(x.why)}</p></div><div class="on"><span class="k">${esc(t.basedOn)}</span>${idLinks(x.based_on ?? [])}<span class="fileno" ${idAttr(x.id)}>${esc(labelOf(x.id))}</span></div></div>`;
  const lockedSuggestion = (x: Sug, i: number) => {
    const topic = (x as Sug & { topic?: string }).topic;
    return `<div class="sug locked" id="${esc(x.id)}"><span class="rn">${two(i + 1)}</span>
<div class="rw"><p class="topic">${esc(topic ? `${labels.get(x.id)} · ${t.topic[topic] ?? t.topic.other}` : labels.get(x.id) ?? '')}</p>${bars(2)}${lockLine(t.locked)}</div><div class="on"><span class="fileno" ${idAttr(x.id)}>${esc(options.debug ? x.id : '')}</span></div></div>`;
  };

  // Strip: a counter exists only for a section that is printed.
  const strip = ([
    [counts.strengths, t.strip.strengths(counts.strengths), 'strengths'], [counts.problems, t.strip.problems(counts.problems), 'problems'],
    [counts.contradictions, t.strip.contradictions(counts.contradictions), 'contradictions'], [counts.notes, t.strip.notes(counts.notes), 'notes'],
  ] as const).filter(([n]) => n > 0).map(([n, label, href]) => `<a href="#${href}"><b>${n}</b><span>${esc(label)}</span></a>`).join('');

  // Sections alternate white and grey band, as v1's do; a list with no items is left out.
  let shade = false;
  const section = (id: string, n: number, body: string) => {
    if (!n) return '';
    shade = !shade;
    return `<section id="${id}"${shade ? ' class="band"' : ''}>${body}</section>`;
  };

  const getsN: GetsN = { shownP: counts.shown.problems, totalP: counts.problems, hiddenP: counts.hidden.problems, shownS: counts.shown.suggestions, hiddenS: counts.hidden.suggestions };
  const body = [
    section('strengths', counts.strengths, `${head('strengths', counts.strengths)}<div class="warns">${strengths.map(finding).join('')}</div>`),
    section('problems', counts.problems, `${head('problems', counts.problems, t.pitchProblems)}<p class="legend">${esc(t.urgHow)}</p><div class="warns">${gP.shown.map(finding).join('')}${gP.hidden.map((f) => lockedCard('wrong', t.tag.problem, f.id, tP.get(f.id)!, ratings.get(f.id)!.urg)).join('')}${counts.hidden.problems ? unlockCard(t.lockedCard.problems(counts.hidden.problems), t.lockedCardP, tally(gP.hidden.map((f) => ratings.get(f.id)!.urg))) : ''}</div>`),
    section('contradictions', counts.contradictions, `${head('contradictions', counts.contradictions, t.pitchContra)}<div class="warns one">${gC.shown.map(contradiction).join('')}${gC.hidden.map((x) => lockedCard('contra', t.tag.contra, x.id, tC.get(x.id)!, ratings.get(x.id)!.urg)).join('')}${counts.hidden.contradictions ? unlockCard(t.lockedCard.contradictions(counts.hidden.contradictions), t.lockedCardP, tally(gC.hidden.map((x) => ratings.get(x.id)!.urg))) : ''}</div>`),
  ].join('');
  const after = [
    section('notes', counts.notes, `${head('notes', counts.notes)}<div class="warns">${gN.shown.map(note).join('')}${gN.hidden.map((x) => lockedCard('missing', t.tag.note, x.id, tN.get(x.id)!)).join('')}${counts.hidden.notes ? unlockCard(t.lockedCard.notes(counts.hidden.notes), t.lockedCardP) : ''}</div>`),
    section('suggestions', counts.suggestions, `${head('suggestions', counts.suggestions, undefined, counts.hidden.suggestions ? t.secSugLocked : undefined)}<div class="sugs">${freeSugs.map(suggestion).join('')}${lockedSugs.map((x, i) => lockedSuggestion(x, freeSugs.length + i)).join('')}${counts.hidden.suggestions ? unlockCard(t.lockedSugs, t.lockedSugsP, t.lockedSugsTally) : ''}</div>`),
    // What the full report holds, so the buyer knows what the price buys. It ends in the one order block every buy button points to.
    section('inside', 1, `<div class="head"><p class="eyebrow">${esc(t.insideEye)}</p><h2>${esc(t.insideH)}<br><span class="g">${esc(t.insideG)}</span></h2><p class="lead">${esc(t.insideP)}</p></div>
<div class="gets">${t.gets.map((g, i) => { const n = g.note?.(getsN) ?? ''; return `<div class="get"><span class="rn">${two(i + 1)}</span><h3>${esc(g.h)}</h3><p>${esc(g.p)}</p>${n ? `<p class="free">${esc(n)}</p>` : ''}</div>`; }).join('')}
<div class="ask" id="order"><h3>${esc(t.cta)}</h3>${price ? `<p class="price">${esc(price)}</p>` : ''}<p class="me">${esc(t.ctaP)}</p><p>${esc(t.keep)}</p></div></div>`),
  ].join('');
  const callout = counts.records ? `<div class="callout"><b>${esc(t.recH)}</b><span>${esc(t.rec(counts.records))}</span></div>` : '';

  return `<!doctype html><html lang="${ko ? 'ko' : 'en'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><title>${esc(t.title(c))}</title>${FONTS(ko)}<style>${CSS}</style></head><body>
<header class="top"><div><b>${esc(t.bar)}</b> <span class="for">${esc(t.barFor(c))}</span></div><a class="btn" href="#order">${esc(t.cta)}</a></header>
<section class="dark hero"><div><p class="eyebrow">${esc(t.eyebrow(c, date))}</p>
<h1>${esc(t.h1(c))}<br><span class="g">${esc(t.h1g(counts.contradictions))}</span></h1>
${summary.length ? `<div class="lead">${summary.map((l) => `<p>${esc(l.text)}${cites(l.cites)}</p>`).join('')}</div>` : ''}
${counts.issues ? `<div class="exec"><b>${esc(t.execH)} ${esc(t.exec(counts.problems, counts.contradictions, counts.urgent))}</b><span>${esc(counts.contradictions ? t.execContra : t.execPlain)}</span></div>` : ''}
<div class="ctas"><a class="btn" href="#order">${esc(t.cta)}</a>${firstSection ? `<a class="btn ghost" href="#${firstSection}">${esc(t.seeAll)}&nbsp;↓</a>` : ''}</div>
<p class="anyone">${esc(t.anyone)}</p></div>
<aside class="file"><div class="filehead"><span class="stamp">${esc(t.stamp)}</span><span class="fileno">${esc(t.fileNo)}</span></div><h3>${esc(c)}</h3><dl>
<div><dt>${esc(t.fCountry)}</dt><dd>${esc(s2.input.country)}</dd></div><div><dt>${esc(t.fIndustry)}</dt><dd>${esc(s2.input.industry)}</dd></div>
${sites.length ? `<div><dt>${esc(t.fSites)}</dt><dd>${esc(sites.join(', '))}</dd></div>` : ''}
<div><dt>${esc(t.fFound)}</dt><dd><b>${esc(t.found(counts.items))}</b></dd></div>${topUrg ? `<div><dt>${esc(t.fHighest)}</dt><dd>${badge(topUrg)}</dd></div>` : ''}
</dl><p class="foot">${esc(t.fileFoot(date))}</p></aside></section>
${strip ? `<div class="strip">${strip}</div>` : ''}
${callout}
<section class="thesis"><p class="eyebrow">${esc(t.thesisEye)}</p><h2>${esc(t.thesisH)}<br><span class="g">${esc(t.thesisG)}</span></h2><p class="lead">${esc(t.thesisP)}</p></section>
${body}
<section class="dark band-cta"><div><p class="eyebrow">${esc(t.bandEye)}</p><h2>${esc(t.bandH)}<br><span class="g">${esc(t.bandG)}</span></h2><p class="lead" style="margin-top:16px">${esc(t.bandP)}</p></div><a class="btn" href="#order">${esc(t.cta)}</a></section>
${after}
<footer><div class="colophon">${t.colophon.map(([k, v]) => `<div><span class="k">${esc(k)}</span><span>${esc(v(c, date))}</span></div>`).join('')}</div></footer>
${counts.issues ? `<div class="sticky"><div class="l"><span class="n">${esc(t.stickyN(counts.issues))}</span><span class="p">${esc(t.stickyP)}</span></div><div class="r">${price ? `<span class="pr">${esc(price)}</span>` : ''}<a class="btn" href="#order">${esc(t.cta)}&nbsp;→</a></div></div>` : ''}
</body></html>`;
}

export function missingPage(ko = false): string {
  const t = ko ? P.ko : P.en;
  return `<!doctype html><html lang="${ko ? 'ko' : 'en'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${esc(t.bar)}</title>${FONTS(ko)}<style>${CSS}</style></head><body>
<section class="dark notready"><p class="eyebrow">${esc(t.bar)}</p><h2>${esc(t.missing)}<br><span class="g">${esc(t.missingP)}</span></h2></section></body></html>`;
}
