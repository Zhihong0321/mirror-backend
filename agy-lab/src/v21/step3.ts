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
import type { ChatMessage } from './cloud.ts';
import { askLanes, parseAnswer, type Lane, type LaneAttempt } from './judge.ts';
import type { Step2V2Output } from './step2-v2.ts';

export const STEP3_PROMPT = 'step3-v2';

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

WHY: the owner of this company will read a free report that shows what the public internet says about their company: every strength, problem, contradiction, suggestion and thing to look into below is printed on it in full, with its sources. You write two short things around it, so the owner sees why it matters to them and wants the paid full report:
1. "summary": 2 or 3 sentences that open the report, each under 35 words.
2. "email": the email that brings them the report link: a "subject" and a "body" of 2 or 3 short paragraphs, under 120 words in all, saying why this report matters to THIS company, using its 2 or 3 strongest facts. Pick; do not list everything: the report has the rest.
Code adds the greeting, a fixed paragraph about the full report, the link and the sign-off. Do not write any of those.

YOU WRITE; YOU NEVER JUDGE. The items below were judged by Step 2 and are the only facts you have.
RULES
1. Every sentence (summary entry, subject, body paragraph) cites the ids of the items it rests on in "cites" (f#, c#, s#, n#). A sentence with nothing to cite is not written.
2. No new facts: nothing that is not in the cited items. Numbers, dates, names, domains and phone numbers are copied exactly as the items give them.
3. A "strength" stays a strength and a "problem" stays a problem. A contradiction is the sources disagreeing: say what differs, do not pick a winner.
4. A take_note item (n#) is never a fact: word it as something worth looking into ("may", "worth checking"), or leave it out.
5. Persuasive, not false: no invented urgency, no "hackers are attacking you", no threats, no flattery beyond the strengths.
6. Never mention the full report, the paid report, a deeper dive or research areas: code writes that part.
7. Plain words, short sentences, addressed to the owner ("your"). The subject is under 90 characters.
8. Language: ${ko ? 'this is a South Korean company: write in Korean. Names, domains and numbers stay exactly as in the items.' : 'English.'}

OUTPUT: one JSON object only:
{
  "summary": [ { "text": "...", "cites": ["f1", "c3"] } ],
  "email": {
    "subject": { "text": "...", "cites": ["f1"] },
    "body": [ { "text": "...", "cites": ["f1", "f4"] } ]
  }
}`;
}

// ---------------------------------------------------------------- the run

/** Build the full email text from the checked parts and the fixed wording. */
export function emailText(company: string, ko: boolean, subject: Line | null, body: Line[], reportUrl: string): string {
  const t = ko ? T.ko : T.en;
  return [`Subject: ${subject?.text ?? ''}`, '', t.greeting(company), '', ...body.flatMap((l) => [l.text, '']), t.deeper, '', t.link(reportUrl), '', t.sign].join('\n');
}

/**
 * One LLM call, then the code check. Never throws: a failed call gives a failed report and a failed email, each with
 * the error and every lane attempt.
 */
export async function writeStep3(
  s2: Step2V2Output,
  ref: { row_id: number; run_id: string },
  reportUrl: string,
  options: { lanes?: Lane[]; deadCallMs?: number; test?: string } = {},
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

    const rRejected: Rejected[] = [];
    const summary = (Array.isArray(llm?.summary) ? llm.summary : []).map((x: any, i: number) => check(x, `summary ${i + 1}`, rRejected)).filter(Boolean) as Line[];
    const report: Step3Report = { ...common, kind: 'report', status: 'ok', error: null, summary, rejected: rRejected, meta, llm_raw: answer.text };

    const eRejected: Rejected[] = [];
    const subject = check(llm?.email?.subject, 'subject', eRejected);
    const body = (Array.isArray(llm?.email?.body) ? llm.email.body : []).map((x: any, i: number) => check(x, `body ${i + 1}`, eRejected)).filter(Boolean) as Line[];
    const emailError = !subject ? 'the subject was rejected' : !body.length ? 'every body paragraph was rejected' : null;
    const email: Step3Email = {
      ...common, kind: 'email', status: emailError ? 'failed' : 'ok', error: emailError, subject, body,
      report_url: reportUrl, text: emailError ? '' : emailText(s2.input.company, ko, subject, body, reportUrl),
      rejected: eRejected, meta, llm_raw: answer.text,
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

// ---------------------------------------------------------------- the page

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const P = {
  en: {
    title: (c: string) => `${c}: what the public internet says`,
    eyebrow: (c: string, d: string) => `Free report · prepared for ${c} · ${d}`,
    h1: (c: string) => `What the public internet says about ${c}`,
    lead: 'Everything below comes from public sources: your own sites, Google, directories, records and a technical check of your domains and website. Every item shows the source it comes from.',
    strengths: 'Strengths', problems: 'Problems', contradictions: 'Where sources disagree', notes: 'Worth looking into', suggestions: 'What you can do',
    strengthsSub: 'What outside sources confirm about you.',
    problemsSub: 'What a customer, a bank, Google or a stranger would run into today.',
    contradictionsSub: 'The same fact, given differently depending on where someone looks.',
    notesSub: 'Signals worth checking. The evidence does not prove them.',
    suggestionsSub: 'Concrete steps, each tied to the items above.',
    why: 'Why it matters', notCertain: 'Why this is not certain', basedOn: 'Based on', sources: 'Sources', source: 'Source', value: 'What it says',
    fullH: 'What the full report adds',
    fullP: 'This free report is one pass over public sources. The full report runs one more time, as a deeper dive across 7 research areas. It may uncover more that is worth knowing.',
    cta: 'Get my full report', ctaP: 'Reply to the email that brought you this link, and we will run it for you.',
    foot: (d: string) => `Built from public sources only, on ${d}. Every statement on this page traces to an item id (f, c, s, n) and its source.`,
    missing: 'This report is not ready yet.',
  },
  ko: {
    title: (c: string) => `${c}: 공개 인터넷이 말하는 것`,
    eyebrow: (c: string, d: string) => `무료 보고서 · ${c} 귀중 · ${d}`,
    h1: (c: string) => `공개 인터넷이 ${c}에 대해 말하는 것`,
    lead: '아래 내용은 모두 공개 자료에서 나왔습니다: 귀사의 사이트, 구글, 디렉터리, 공식 기록, 그리고 도메인과 웹사이트의 기술 점검. 모든 항목에 출처가 표시됩니다.',
    strengths: '강점', problems: '문제점', contradictions: '출처마다 다른 정보', notes: '확인해 볼 만한 점', suggestions: '할 수 있는 일',
    strengthsSub: '외부 출처가 확인해 주는 귀사의 강점입니다.',
    problemsSub: '고객, 은행, 구글 또는 낯선 사람이 오늘 마주칠 문제입니다.',
    contradictionsSub: '같은 사실이 어디를 보느냐에 따라 다르게 나옵니다.',
    notesSub: '확인해 볼 만한 신호입니다. 증거가 이를 입증하지는 않습니다.',
    suggestionsSub: '위 항목에 근거한 구체적인 조치입니다.',
    why: '왜 중요한가', notCertain: '확실하지 않은 이유', basedOn: '근거', sources: '출처', source: '출처', value: '내용',
    fullH: '전체 보고서가 더해 주는 것',
    fullP: '이 무료 보고서는 공개 자료를 한 번 살펴본 결과입니다. 전체 보고서는 7개 조사 영역에 걸쳐 한 번 더 심층 조사를 진행하며, 더 알아 두실 만한 내용이 나올 수 있습니다.',
    cta: '전체 보고서 받기', ctaP: '이 링크를 받은 이메일에 회신해 주시면 진행해 드립니다.',
    foot: (d: string) => `공개 자료만으로 ${d}에 작성되었습니다. 이 페이지의 모든 문장은 항목 id(f, c, s, n)와 그 출처로 이어집니다.`,
    missing: '이 보고서는 아직 준비되지 않았습니다.',
  },
};

function sourceLink(url: string): string {
  return /^https?:\/\//i.test(url) ? `<a href="${esc(url)}" rel="nofollow noopener" target="_blank">${esc(url.replace(/^https?:\/\/(www\.)?/i, '').slice(0, 70))}</a>` : esc(url);
}

function evidenceList(ev: Array<{ quoted_text: string; source_url: string }>, label: string): string {
  if (!ev?.length) return '';
  return `<details class="src"><summary>${esc(label)} (${ev.length})</summary><ul>${ev.map((e) => `<li><q>${esc(e.quoted_text)}</q><span>${sourceLink(e.source_url)}</span></li>`).join('')}</ul></details>`;
}

const chips = (ids: string[]) => ids.map((id) => `<a class="chip" href="#${esc(id)}">${esc(id)}</a>`).join('');

/** The free report page: the Step 3 summary, then every Step 2 item in full, then what the full report adds. */
export function reportPage(report: Step3Report, s2: Step2V2Output): string {
  const ko = report.language === 'ko';
  const t = ko ? P.ko : P.en;
  const c = s2.input.company;
  const date = new Date(report.created_at).toLocaleDateString(ko ? 'ko-KR' : 'en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  const strengths = s2.conclusive_findings.filter((f) => f.kind === 'strength');
  const problems = s2.conclusive_findings.filter((f) => f.kind === 'problem');

  const finding = (f: Step2V2Output['conclusive_findings'][number]) => `<article class="card ${f.kind}" id="${esc(f.id)}">
    <div class="tag">${esc(f.id)}</div><h3>${esc(f.title)}</h3><p>${esc(f.statement)}</p>
    ${f.why_it_matters ? `<p class="why"><b>${t.why}:</b> ${esc(f.why_it_matters)}</p>` : ''}${evidenceList(f.evidence, t.sources)}</article>`;

  const section = (key: string, title: string, sub: string, n: number, body: string) => n
    ? `<section id="${key}"><h2>${esc(title)} <span class="n">${n}</span></h2><p class="sub">${esc(sub)}</p>${body}</section>` : '';

  const contradiction = (x: Step2V2Output['contradictions'][number]) => `<article class="card contra" id="${esc(x.id)}">
    <div class="tag">${esc(x.id)}</div><h3>${esc(x.title)}</h3>
    <table><thead><tr><th>${t.source}</th><th>${t.value}</th></tr></thead><tbody>${x.versions.map((v) => `<tr><td>${esc(v.source)}<br><small>${sourceLink(v.source_url)}</small></td><td><b>${esc(v.value)}</b></td></tr>`).join('')}</tbody></table>
    ${x.why_it_matters ? `<p class="why"><b>${t.why}:</b> ${esc(x.why_it_matters)}</p>` : ''}</article>`;

  const note = (x: Step2V2Output['take_note'][number]) => `<article class="card note" id="${esc(x.id)}">
    <div class="tag">${esc(x.id)}</div><h3>${esc(x.title)}</h3><p>${esc(x.note)}</p>
    <p class="why"><b>${t.notCertain}:</b> ${esc(x.why_not_conclusive)}</p>${evidenceList(x.evidence, t.sources)}</article>`;

  const suggestion = (x: Step2V2Output['suggestions'][number]) => `<li class="sug" id="${esc(x.id)}"><div class="tag">${esc(x.id)}</div>
    <b>${esc(x.action)}</b><p>${esc(x.why)}</p><p class="based">${t.basedOn}: ${chips(x.based_on ?? [])}</p></li>`;

  const counts = [
    [t.strengths, strengths.length, 'strengths', 'strength'], [t.problems, problems.length, 'problems', 'problem'],
    [t.contradictions, s2.contradictions.length, 'contradictions', 'contra'], [t.notes, s2.take_note.length, 'notes', 'note'],
  ].filter((x) => x[1]).map(([label, n, href, cls]) => `<a class="count ${cls}" href="#${href}"><b>${n}</b><span>${esc(label)}</span></a>`).join('');

  return `<!doctype html><html lang="${ko ? 'ko' : 'en'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><title>${esc(t.title(c))}</title><style>
:root{--ink:#14213d;--mut:#5b6478;--line:#e3e7ef;--bg:#f6f7fb;--card:#fff;--good:#1f8a5b;--bad:#c2410c;--con:#6d28d9;--note:#64748b;--acc:#f5a524}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.6 system-ui,-apple-system,"Segoe UI",Roboto,"Noto Sans KR",sans-serif}
.wrap{max-width:860px;margin:0 auto;padding:0 16px}header{background:var(--ink);color:#fff;padding:48px 0 40px}
.eyebrow{color:#c9d2e6;font-size:13px;letter-spacing:.04em;text-transform:uppercase}h1{font-size:clamp(28px,5vw,42px);line-height:1.15;margin:12px 0 16px}
.summary{font-size:18px;color:#eef2fa}.summary .chip{background:rgba(255,255,255,.14);color:#fff}.lead{color:#c9d2e6;font-size:14px;margin-top:18px}
.counts{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin:-26px 0 8px}
.count{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px 16px;text-decoration:none;color:var(--ink);border-top:4px solid}
.count b{display:block;font-size:30px;line-height:1}.count span{font-size:14px;color:var(--mut)}
.count.strength{border-top-color:var(--good)}.count.problem{border-top-color:var(--bad)}.count.contra{border-top-color:var(--con)}.count.note{border-top-color:var(--note)}
section{margin:40px 0}h2{font-size:24px;margin:0}h2 .n{font-size:15px;color:var(--mut);font-weight:500}.sub{color:var(--mut);margin:4px 0 16px}
.card{position:relative;background:var(--card);border:1px solid var(--line);border-left:5px solid;border-radius:12px;padding:18px 20px;margin:12px 0}
.card.strength{border-left-color:var(--good)}.card.problem{border-left-color:var(--bad)}.card.contra{border-left-color:var(--con)}.card.note{border-left-color:var(--note)}
.card h3{font-size:18px;margin:0 40px 6px 0;line-height:1.35}.card p{margin:6px 0}.why{color:var(--mut);font-size:15px}
.tag{position:absolute;top:14px;right:16px;font:12px ui-monospace,Consolas,monospace;color:var(--mut)}
table{width:100%;border-collapse:collapse;margin:8px 0;font-size:15px}th,td{text-align:left;padding:8px;border-bottom:1px solid var(--line);vertical-align:top}th{font-size:12px;color:var(--mut);text-transform:uppercase}
td small{color:var(--mut);word-break:break-all}.src{margin-top:8px;font-size:14px}.src summary{cursor:pointer;color:var(--mut)}
.src ul{padding-left:18px;margin:6px 0}.src li{margin:6px 0}.src q{display:block}.src span{color:var(--mut);font-size:13px;word-break:break-all}
a{color:#1d4ed8}.chip{display:inline-block;font:12px ui-monospace,Consolas,monospace;background:#eef1f7;color:var(--ink);border-radius:6px;padding:0 6px;margin-left:4px;text-decoration:none;vertical-align:1px}
ol.sugs{list-style:none;padding:0;margin:0}.sug{position:relative;background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px 20px;margin:10px 0}
.sug b{display:block;margin-right:40px}.sug p{margin:4px 0;color:var(--mut)}.based{font-size:14px}
.full{background:var(--ink);color:#fff;border-radius:16px;padding:28px 24px;margin:48px 0}.full h2{color:#fff}.full>p{color:#c9d2e6}
.areas{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:10px;margin:18px 0;padding:0;list-style:none;counter-reset:a}
.areas li{background:rgba(255,255,255,.07);border-radius:10px;padding:12px 14px;counter-increment:a}.areas li b{display:block}.areas li b:before{content:counter(a,decimal-leading-zero) "  ";color:var(--acc)}
.areas li span{font-size:14px;color:#c9d2e6}.cta{display:inline-block;background:var(--acc);color:var(--ink);font-weight:700;border-radius:10px;padding:12px 20px;margin-top:6px}
.full .ctap{color:#c9d2e6;font-size:14px;margin:8px 0 0}footer{color:var(--mut);font-size:13px;padding:0 0 40px}
@media(max-width:560px){header{padding:32px 0 40px}.card,.sug{padding:16px}.card h3{font-size:17px}table,thead,tbody,tr,th,td{display:block}thead{display:none}td{border:0;padding:4px 0}tr{border-bottom:1px solid var(--line);padding:6px 0}}
</style></head><body>
<header><div class="wrap"><div class="eyebrow">${esc(t.eyebrow(c, date))}</div><h1>${esc(t.h1(c))}</h1>
${report.summary.length ? `<p class="summary">${report.summary.map((l) => `${esc(l.text)}${chips(l.cites)}`).join(' ')}</p>` : ''}
<p class="lead">${esc(t.lead)}</p></div></header>
<main class="wrap"><div class="counts">${counts}</div>
${section('strengths', t.strengths, t.strengthsSub, strengths.length, strengths.map(finding).join(''))}
${section('problems', t.problems, t.problemsSub, problems.length, problems.map(finding).join(''))}
${section('contradictions', t.contradictions, t.contradictionsSub, s2.contradictions.length, s2.contradictions.map(contradiction).join(''))}
${section('notes', t.notes, t.notesSub, s2.take_note.length, s2.take_note.map(note).join(''))}
${section('suggestions', t.suggestions, t.suggestionsSub, s2.suggestions.length, `<ol class="sugs">${s2.suggestions.map(suggestion).join('')}</ol>`)}
<section class="full" id="full"><h2>${esc(t.fullH)}</h2><p>${esc(t.fullP)}</p>
<ul class="areas">${AREAS[ko ? 'ko' : 'en'].map(([a, d]) => `<li><b>${esc(a)}</b><span>${esc(d)}</span></li>`).join('')}</ul>
<span class="cta">${esc(t.cta)}</span><p class="ctap">${esc(t.ctaP)}</p></section>
</main><footer class="wrap">${esc(t.foot(date))}</footer></body></html>`;
}

export function missingPage(ko = false): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Report</title></head><body style="font:16px system-ui;padding:48px 16px;text-align:center;color:#14213d;background:#f6f7fb">${esc((ko ? P.ko : P.en).missing)}</body></html>`;
}
