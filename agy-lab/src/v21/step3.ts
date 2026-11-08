// V2.1 Step 3 (owner, 2026-11-06): write the free report and the email for one company, from its Step 2 rules-v2
// result only. Step 3 writes; it never judges.
//
// The report page shows all four Step 2 lists in full (owner's choice), rendered by plain code from the Step 2 items
// themselves, so nothing on it can drift from Step 2. The LLM writes only two things, in one call:
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
  const f = (s2.conclusive_findings ?? []).map((x) => ({ id: x.id, kind: x.kind, title: x.title, statement: x.statement, why_it_matters: x.why_it_matters }));
  const c = (s2.contradictions ?? []).map((x) => ({ id: x.id, title: x.title, versions: x.versions.map((v) => `${v.source}: ${v.value}`), why_it_matters: x.why_it_matters }));
  const s = (s2.suggestions ?? []).map((x) => ({ id: x.id, action: x.action, why: x.why, based_on: x.based_on }));
  const n = (s2.take_note ?? []).map((x) => ({ id: x.id, title: x.title, note: x.note, why_not_conclusive: x.why_not_conclusive }));
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
2. No new facts: nothing that is not in the cited items, including no cost, audience, amount, date or consequence they do not give. Numbers, dates, names, domains and phone numbers are copied exactly as the items give them.
3. A "strength" stays a strength and a "problem" stays a problem. A contradiction is the sources disagreeing: say what differs, do not pick a winner.
4. A take_note item (n#) is never a fact: word it as something worth checking ("may", "worth checking"), or leave it out.
5. Persuasive, never false: urgency only from a real date or fact in the cited items (an expiry date, for example); no invented deadlines, no "hackers are attacking you", no threats, no fear beyond what the item says, no flattery beyond the strengths.
6. Never mention the full report, the paid report, a deeper dive or research areas: code writes that part.
7. Plain words, addressed to the owner ("your"). The subject is under 90 characters.
8. Language: ${ko ? 'this is a South Korean company: write in Korean. Names, domains and numbers stay exactly as in the items.' : 'English.'}`;
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
    fCountry: 'Country', fIndustry: 'Industry', fSites: 'Websites', fFound: 'This report', fDeeper: 'Deeper dive',
    found: (n: number) => `${n} items found, each with its source`,
    deeper: '7 research areas: not run yet',
    fileFoot: (d: string) => `Built ${d} from public sources`,
    strip: { strengths: 'strengths the sources confirm', problems: 'problems someone looking you up runs into', contradictions: 'places where sources disagree', notes: 'signals worth checking' },
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
    bandEye: 'The full report', bandH: 'Read it before your competitors do.', bandG: 'Fix it before your customers see it.',
    bandP: 'Everything on this page came from public sources. Anyone can find it, your rivals included.',
    fullEye: 'Your full report', fullH: 'One more pass,', fullG: 'deeper, across 7 research areas.',
    fullP: 'This free report is one pass over public sources. The full report runs one more time, as a deeper dive across 7 research areas. It may uncover more that is worth knowing.',
    doneW: 'This free report', doneS: 'One pass over public sources', done: 'Done', doneC: 'items found',
    notRun: 'Not run yet', notRunC: 'still to look at',
    cta: 'Get my full report', ctaP: 'Reply to the email that brought you this link, and we will run it for you.', keep: 'This free report is yours to keep.',
    colophon: [['Prepared for', (c: string, _d: string) => c], ['Built', (_c: string, d: string) => `${d}, from public sources`], ['Edition', (_c: string, _d: string) => 'Free report · one pass'], ['Method', (_c: string, _d: string) => 'Web pages, maps, directories, reviews, and a technical check of your domains and website.']] as Array<[string, (c: string, d: string) => string]>,
    foot: 'Every statement on this page traces to an item id (f, c, s, n) and its source.',
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
    fCountry: '국가', fIndustry: '업종', fSites: '웹사이트', fFound: '이 보고서', fDeeper: '심층 조사',
    found: (n: number) => `${n}개 항목, 모두 출처 포함`,
    deeper: '7개 조사 영역: 아직 진행 전',
    fileFoot: (d: string) => `${d} 공개 자료로 작성`,
    strip: { strengths: '출처가 확인해 주는 강점', problems: '귀사를 찾아보는 사람이 마주칠 문제', contradictions: '출처마다 다른 정보', notes: '확인해 볼 만한 신호' },
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
    bandEye: '전체 보고서', bandH: '경쟁사보다 먼저 읽으세요.', bandG: '고객이 보기 전에 고치세요.',
    bandP: '이 페이지의 모든 내용은 공개 자료에서 나왔습니다. 경쟁사를 포함해 누구나 찾을 수 있습니다.',
    fullEye: '전체 보고서', fullH: '한 번 더,', fullG: '7개 조사 영역에 걸쳐 더 깊이.',
    fullP: '이 무료 보고서는 공개 자료를 한 번 살펴본 결과입니다. 전체 보고서는 7개 조사 영역에 걸쳐 한 번 더 심층 조사를 진행하며, 더 알아 두실 만한 내용이 나올 수 있습니다.',
    doneW: '이 무료 보고서', doneS: '공개 자료를 한 번 살펴봄', done: '완료', doneC: '개 항목 발견',
    notRun: '아직 진행 전', notRunC: '아직 살펴보지 않음',
    cta: '전체 보고서 받기', ctaP: '이 링크를 받은 이메일에 회신해 주시면 진행해 드립니다.', keep: '이 무료 보고서는 귀사가 보관하시면 됩니다.',
    colophon: [['받는 곳', (c: string, _d: string) => c], ['작성', (_c: string, d: string) => `${d}, 공개 자료 기준`], ['구분', (_c: string, _d: string) => '무료 보고서 · 1차 조사'], ['방법', (_c: string, _d: string) => '웹 페이지, 지도, 디렉터리, 리뷰, 그리고 도메인과 웹사이트의 기술 점검.']] as Array<[string, (c: string, d: string) => string]>,
    foot: '이 페이지의 모든 문장은 항목 id(f, c, s, n)와 그 출처로 이어집니다.',
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
.hero h1{font-size:clamp(40px,5.6vw,76px);letter-spacing:-0.035em;line-height:1.02;margin-top:18px}
.hero .lead{margin-top:22px;color:var(--on-dark);opacity:.86;display:grid;gap:10px}.ctas{display:flex;flex-wrap:wrap;gap:12px;margin-top:32px}
.hero .anyone{margin-top:18px;font-size:13.5px;color:var(--on-dark-2)}
a.cite{font-size:.62em;font-weight:600;text-decoration:none;vertical-align:super;color:var(--muted);margin-left:3px;letter-spacing:.02em}.dark a.cite{color:var(--on-dark-2)}
.file{background:var(--paper);color:var(--ink);padding:26px;display:grid;gap:14px;box-shadow:0 30px 60px -30px rgba(0,0,0,.6);transform:rotate(1.2deg)}
.filehead{display:flex;justify-content:space-between;align-items:center;gap:12px}
.file .stamp{font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--wrong);border:2px solid var(--wrong);padding:3px 8px;transform:rotate(-3deg)}
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
.runs{display:grid;background:var(--paper);border:1px solid var(--line);color:var(--ink)}
.run{display:grid;grid-template-columns:40px minmax(0,1fr) 128px 200px;gap:18px;align-items:center;padding:14px 22px;border-top:1px solid var(--line)}
.run:first-child{border-top:0}.run .rn{font-family:var(--display);font-size:15px;font-weight:600;color:var(--muted);font-variant-numeric:tabular-nums}
.run .rw{display:grid;gap:2px}.run .rw b{font-family:var(--display);font-size:17px;font-weight:600;letter-spacing:-0.01em;line-height:1.25}.run .rw span{font-size:13.5px;color:var(--grey)}
.run .rs{justify-self:start;font-size:10.5px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--muted);border:1.5px dashed #b4bac2;padding:3px 8px;white-space:nowrap}
.run .rc{display:grid;grid-template-columns:auto minmax(0,1fr);gap:10px;align-items:center}
.run .rc b{font-family:var(--display);font-size:30px;font-weight:600;letter-spacing:-0.03em;line-height:1;color:var(--muted);white-space:nowrap;font-variant-numeric:tabular-nums}
.run .rc span{font-size:12.5px;color:var(--grey);line-height:1.3}
.run.done{background:var(--dark2);color:var(--on-dark);border-top:0}.run.done .rn,.run.done .rw span,.run.done .rc span{color:var(--on-dark-2)}
.run.done .rs{color:#8ee0b0;border:1.5px solid #8ee0b0}.run.done .rc b{color:#fff}
.sugs{display:grid;border:1px solid var(--line)}
.sug{display:grid;grid-template-columns:44px minmax(0,1fr) 220px;gap:18px;padding:20px 22px;border-top:1px solid var(--line);scroll-margin-top:70px}.sug:first-child{border-top:0}
.sug .rn{font-family:var(--display);font-size:28px;font-weight:500;letter-spacing:-0.04em;line-height:1;color:var(--muted);font-variant-numeric:tabular-nums}
.sug .rw{display:grid;gap:6px}.sug .rw b{font-family:var(--display);font-size:19px;font-weight:600;letter-spacing:-0.015em;line-height:1.25}.sug .rw p{font-size:15px;color:var(--grey)}
.sug .on{display:grid;gap:6px;align-content:start;font-size:12.5px;color:var(--muted)}.sug .on .k{font-size:10.5px;font-weight:700;letter-spacing:.1em;text-transform:uppercase}
.ids{display:flex;flex-wrap:wrap;gap:6px}.ids a{font-size:12px;font-weight:600;text-decoration:none;color:var(--ink);background:var(--band);padding:3px 8px}.ids a:hover{background:var(--line)}
.band-cta{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:32px;align-items:center;padding-top:72px;padding-bottom:72px}.band-cta h2{font-size:clamp(30px,3.4vw,46px)}
.ask{margin-top:14px;background:var(--dark2);padding:32px;display:grid;gap:12px;border-top:3px solid #fff}
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
.run{grid-template-columns:28px minmax(0,1fr);gap:6px 12px;padding:14px 16px}.run .rs,.run .rc{grid-column:2}.run .rc b{font-size:24px}.warn{padding:20px}}
@media print{.top,.ctas,.band-cta .btn{display:none}section{padding:32px 28px}.file{transform:none;box-shadow:none;border:1px solid var(--line)}
.warn,.sug,.run,.ledger tr,.colophon{break-inside:avoid}.head,h2,h3{break-after:avoid}details>:not(summary){display:block}details::details-content{display:block;content-visibility:visible}}
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

const cites = (ids: string[]) => ids.map((id) => `<a class="cite" href="#${esc(id)}">${esc(id)}</a>`).join('');
const idLinks = (ids: string[]) => `<span class="ids">${ids.map((id) => `<a href="#${esc(id)}">${esc(id)}</a>`).join('')}</span>`;
const two = (n: number) => String(n).padStart(2, '0');

/** The free report page: the Step 3 summary, then every Step 2 item in full, then what the full report adds. */
export function reportPage(report: Step3Report, s2: Step2V2Output): string {
  const ko = report.language === 'ko';
  const t = ko ? P.ko : P.en;
  const c = s2.input.company;
  const date = new Date(report.created_at).toLocaleDateString(ko ? 'ko-KR' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  const findings = s2.conclusive_findings ?? [];
  const strengths = findings.filter((f) => f.kind === 'strength');
  const problems = findings.filter((f) => f.kind === 'problem');
  const contradictions = s2.contradictions ?? [];
  const notes = s2.take_note ?? [];
  const suggestions = s2.suggestions ?? [];
  const found = findings.length + contradictions.length + notes.length;
  const sites = (s2.baseline?.websites ?? []).map((w) => String(w).replace(/\s*\(.*\)\s*$/, '')).filter(Boolean).slice(0, 3);
  const firstSection = strengths.length ? 'strengths' : problems.length ? 'problems' : contradictions.length ? 'contradictions' : 'notes';

  const head = (key: keyof typeof t.sec, n: number) => {
    const [eye, h, g] = t.sec[key];
    return `<div class="head"><p class="eyebrow">${esc(eye)} · ${n}</p><h2>${esc(h)}<br><span class="g">${esc(g)}</span></h2></div>`;
  };
  const cardHead = (cls: string, label: string, id: string) => `<div class="warnhead"><span class="tag ${cls}">${esc(label)}</span><span class="fileno">${esc(id)}</span></div>`;

  const finding = (f: Step2V2Output['conclusive_findings'][number], i: number) => {
    const cls = f.kind === 'strength' ? 'good' : 'wrong';
    return `<article class="warn ${cls}${f.kind === 'problem' && i === 0 ? ' first' : ''}" id="${esc(f.id)}">${cardHead(cls, f.kind === 'strength' ? t.tag.strength : t.tag.problem, f.id)}
<h3>${esc(f.title)}</h3><p class="d">${esc(f.statement)}</p>${f.why_it_matters ? `<p class="risk"><b>${esc(t.why)}:</b> ${esc(f.why_it_matters)}</p>` : ''}${evidenceList(f.evidence, t.sources)}</article>`;
  };

  const contradiction = (x: Step2V2Output['contradictions'][number]) => `<article class="warn contra" id="${esc(x.id)}">${cardHead('contra', t.tag.contra, x.id)}<h3>${esc(x.title)}</h3>
<table class="ledger"><thead><tr><th>${esc(t.source)}</th><th>${esc(t.value)}</th></tr></thead><tbody>${x.versions.map((v) => `<tr><td class="where">${esc(v.source)}<small>${sourceLink(v.source_url)}</small></td><td class="said"><b>${esc(v.value)}</b>${v.quoted_text && v.quoted_text.trim() !== String(v.value).trim() ? `<q>${esc(v.quoted_text)}</q>` : ''}</td></tr>`).join('')}</tbody></table>
${x.why_it_matters ? `<p class="risk"><b>${esc(t.why)}:</b> ${esc(x.why_it_matters)}</p>` : ''}</article>`;

  const note = (x: Step2V2Output['take_note'][number]) => `<article class="warn missing" id="${esc(x.id)}">${cardHead('missing', t.tag.note, x.id)}<h3>${esc(x.title)}</h3><p class="d">${esc(x.note)}</p>
<p class="risk"><b>${esc(t.notCertain)}:</b> ${esc(x.why_not_conclusive)}</p>${evidenceList(x.evidence, t.sources)}</article>`;

  const suggestion = (x: Step2V2Output['suggestions'][number], i: number) => `<div class="sug" id="${esc(x.id)}"><span class="rn">${two(i + 1)}</span>
<div class="rw"><b>${esc(x.action)}</b><p>${esc(x.why)}</p></div><div class="on"><span class="k">${esc(t.basedOn)}</span>${idLinks(x.based_on ?? [])}<span class="fileno">${esc(x.id)}</span></div></div>`;

  const strip = ([
    [strengths.length, t.strip.strengths, 'strengths'], [problems.length, t.strip.problems, 'problems'],
    [contradictions.length, t.strip.contradictions, 'contradictions'], [notes.length, t.strip.notes, 'notes'],
  ] as const).map(([n, label, href]) => `<a href="#${href}"><b>${n}</b><span>${esc(label)}</span></a>`).join('');

  // Sections alternate white and grey band, as v1's do; a list with no items is left out.
  let shade = false;
  const section = (id: string, n: number, body: string) => {
    if (!n) return '';
    shade = !shade;
    return `<section id="${id}"${shade ? ' class="band"' : ''}>${body}</section>`;
  };

  const body = [
    section('strengths', strengths.length, `${head('strengths', strengths.length)}<div class="warns">${strengths.map(finding).join('')}</div>`),
    section('problems', problems.length, `${head('problems', problems.length)}<div class="warns">${problems.map(finding).join('')}</div>`),
    section('contradictions', contradictions.length, `${head('contradictions', contradictions.length)}<div class="warns one">${contradictions.map(contradiction).join('')}</div>`),
  ].join('');
  const after = [
    section('notes', notes.length, `${head('notes', notes.length)}<div class="warns">${notes.map(note).join('')}</div>`),
    section('suggestions', suggestions.length, `${head('suggestions', suggestions.length)}<div class="sugs">${suggestions.map(suggestion).join('')}</div>`),
  ].join('');

  const areas = AREAS[ko ? 'ko' : 'en'];
  const runs = `<div class="runs"><div class="run done"><span class="rn">00</span><div class="rw"><b>${esc(t.doneW)}</b><span>${esc(t.doneS)}</span></div><span class="rs">${esc(t.done)}</span><div class="rc"><b>${found}</b><span>${esc(t.doneC)}</span></div></div>
${areas.map(([a, d], i) => `<div class="run"><span class="rn">${two(i + 1)}</span><div class="rw"><b>${esc(a)}</b><span>${esc(d)}</span></div><span class="rs">${esc(t.notRun)}</span><div class="rc"><b>?</b><span>${esc(t.notRunC)}</span></div></div>`).join('')}</div>`;

  return `<!doctype html><html lang="${ko ? 'ko' : 'en'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><title>${esc(t.title(c))}</title>${FONTS(ko)}<style>${CSS}</style></head><body>
<header class="top"><div><b>${esc(t.bar)}</b> <span class="for">${esc(t.barFor(c))}</span></div><a class="btn" href="#order">${esc(t.cta)}</a></header>
<section class="dark hero"><div><p class="eyebrow">${esc(t.eyebrow(c, date))}</p>
<h1>${esc(t.h1(c))}<br><span class="g">${esc(t.h1g(contradictions.length))}</span></h1>
${report.summary.length ? `<div class="lead">${report.summary.map((l) => `<p>${esc(l.text)}${cites(l.cites)}</p>`).join('')}</div>` : ''}
<div class="ctas"><a class="btn" href="#order">${esc(t.cta)}</a><a class="btn ghost" href="#${firstSection}">${esc(t.seeAll)}&nbsp;↓</a></div>
<p class="anyone">${esc(t.anyone)}</p></div>
<aside class="file"><div class="filehead"><span class="stamp">${esc(t.stamp)}</span><span class="fileno">${esc(t.fileNo)}</span></div><h3>${esc(c)}</h3><dl>
<div><dt>${esc(t.fCountry)}</dt><dd>${esc(s2.input.country)}</dd></div><div><dt>${esc(t.fIndustry)}</dt><dd>${esc(s2.input.industry)}</dd></div>
${sites.length ? `<div><dt>${esc(t.fSites)}</dt><dd>${esc(sites.join(', '))}</dd></div>` : ''}
<div><dt>${esc(t.fFound)}</dt><dd><b>${esc(t.found(found))}</b></dd></div><div><dt>${esc(t.fDeeper)}</dt><dd>${esc(t.deeper)}</dd></div>
</dl><p class="foot">${esc(t.fileFoot(date))}</p></aside></section>
<div class="strip">${strip}</div>
<section class="thesis"><p class="eyebrow">${esc(t.thesisEye)}</p><h2>${esc(t.thesisH)}<br><span class="g">${esc(t.thesisG)}</span></h2><p class="lead">${esc(t.thesisP)}</p></section>
${body}
<section class="dark band-cta"><div><p class="eyebrow">${esc(t.bandEye)}</p><h2>${esc(t.bandH)}<br><span class="g">${esc(t.bandG)}</span></h2><p class="lead" style="margin-top:16px">${esc(t.bandP)}</p></div><a class="btn" href="#order">${esc(t.cta)}</a></section>
${after}
<section id="order" class="dark"><div class="head"><p class="eyebrow">${esc(t.fullEye)}</p><h2>${esc(t.fullH)}<br><span class="g">${esc(t.fullG)}</span></h2><p class="lead">${esc(t.fullP)}</p></div>
${runs}
<div class="ask"><h3>${esc(t.cta)}</h3><p class="me">${esc(t.ctaP)}</p><p>${esc(t.keep)}</p></div></section>
<footer><div class="colophon">${t.colophon.map(([k, v]) => `<div><span class="k">${esc(k)}</span><span>${esc(v(c, date))}</span></div>`).join('')}</div><p>${esc(t.foot)}</p></footer>
</body></html>`;
}

export function missingPage(ko = false): string {
  const t = ko ? P.ko : P.en;
  return `<!doctype html><html lang="${ko ? 'ko' : 'en'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${esc(t.bar)}</title>${FONTS(ko)}<style>${CSS}</style></head><body>
<section class="dark notready"><p class="eyebrow">${esc(t.bar)}</p><h2>${esc(t.missing)}<br><span class="g">${esc(t.missingP)}</span></h2></section></body></html>`;
}
