// G / shared — helpers for the "How AI sees you" lanes (G-fixed, G-free, G-grounded).
// Not a lane on its own: it has no run(). It holds the profile pulled from the dive,
// the ask-every-model loop, the judge prompt and the finding writer, so the lanes
// differ only in WHICH prompts they send.
//
// No kill gates: every LLM call goes through ctx.llm (never throws); a judge answer
// that will not parse is warned and kept as "unjudged", and the lane continues.
import fs from 'node:fs';
import path from 'node:path';
import { OUT, type Ctx, type Finding } from '../lib.ts';

export const ANSWER_MODELS = (process.env.DD_G_MODELS ?? 'deepseek-v4.1-flash-1017,gpt-6.1-sol').split(',').map((s) => s.trim()).filter(Boolean);
export const JUDGE_MODEL = process.env.DD_G_JUDGE ?? 'gpt-6.1-sol';
/** Temperature of the ANSWER calls (the judge always runs at 0). Run once at 0 and once at 1 to see drift. */
export const ANSWER_TEMP = Number(process.env.DD_G_TEMP ?? 0);
/** Optional cap on prompts, for small test runs. */
export const MAX_PROMPTS = Number(process.env.DD_G_MAX ?? 0) || Infinity;
/** Round 3: ask for brevity in the system prompt (NOT a max_tokens cap; the user has not approved one).
 *  DD_G_BRIEF=0 turns it off. */
export const BRIEF = process.env.DD_G_BRIEF !== '0';
export const BRIEF_TEXT = 'Keep your answer under 150 words.';
/** Profile format version: v2 takes the area from the company's own premises, not identity.address. */
const PROFILE_VERSION = 3;

export type Profile = {
  name: string;          // legal name, e.g. Eternalgy Sdn Bhd
  brand: string;         // short brand, e.g. Eternalgy
  aliases: string[];
  trade: string;         // singular search phrase, e.g. "solar panel installer"
  trades: string;        // plural, e.g. "solar panel installers"
  job: string;           // what a customer wants done, e.g. "install solar panels on my house"
  area: string;          // HQ town, e.g. Johor Bahru
  state: string;         // e.g. Johor
  industry: string;
  v?: number;
};

export type Prompt = { id: string; kind: 'company' | 'trade'; text: string; topic?: string; lang?: string };

/** "sourced" (round 3, grounded lane): not in the dive, but stated in the search results the model was given. Never counts as wrong. */
export type Claim = { claim: string; verdict: 'correct' | 'wrong' | 'disputed' | 'unverifiable' | 'echo' | 'sourced'; facts?: number[]; hedged?: boolean; note?: string };
const VERDICTS = ['correct', 'wrong', 'disputed', 'unverifiable', 'echo', 'sourced'];
const isRight = (c: Claim) => c.verdict === 'correct' || c.verdict === 'disputed' || c.verdict === 'sourced';
export type Judged = {
  prompt: Prompt;
  model: string;
  answer: string;
  judged: boolean;
  mentions_company: boolean;
  declines: boolean;               // the answer says it has no information
  confused_with: string | null;    // talks about a different entity as if it were this one
  recommended: 'yes' | 'no' | 'neutral' | 'not_mentioned';
  claims: Claim[];
  competitors: string[];
  outcome: 'correct' | 'mixed' | 'wrong' | 'doesnt_know' | 'not_mentioned' | 'mentioned_no_facts' | 'unjudged';
  judge_summary: string;
  searched: boolean;               // the answer carries web-search citation markers (the model searched)
  stub?: boolean;                  // the answer is only "I'll check..." (a search preamble with no answer)
  dropped?: { claim: string; verdict: string; why: string }[];  // judge claims removed by the clean-up rules
  sample?: number;                 // round 3: which of the N repeats this is (0-based)
  spread?: { samples: number; agree: number; outcomes: string[]; wrong: string[][]; mentions: number };  // set on the majority answer
};

const DECLINE_RE = /\b(could ?n[o'’]t|cannot|can[’']t|unable to|not able to|did not find|didn[’']t find)\b.*\b(verify|find|confirm|identify|provide|locate)|\bno (reliable|verified|public|specific|confirmed) (public )?(information|source|record|data)/i;
const ADVICE_RE = /\bshould\b|\b(needs?|has) to be (verified|confirmed|checked)|\bmust be (verified|confirmed|checked)|^(ask|verify|check|confirm)\b/i;
const ECHO_RE = /private limited|sendirian berhad|privately[- ]held|not (a )?public(ly)?[- ]listed|stands for|registered (company )?(with|under) (the )?(SSM|Suruhanjaya Syarikat|Companies Commission)|\bSSM[- ]registered|has (a|an) (official )?(website|contact page|online presence|web presence)/i;
const STUB_RE = /^(I['’]ll|I will|Let me) (check|search|look)/i;

/** Some router models (gpt-6.1-sol) run a web search on their own and leave citation markers. */
export const SEARCH_MARK = /turn\d+search\d+|<Cite\b|【\d+†|\bturn\d+(news|view|fetch)\d+|<Entity\b|<AsyncImage\b/i;

/** Per-model token tally, from the lane's per-call log (every LLM call goes through core/llm.ts and lands there). */
export function usageByModel(ctx: Ctx): Record<string, { calls: number; tokensIn: number; tokensOut: number }> {
  const out: Record<string, { calls: number; tokensIn: number; tokensOut: number }> = {};
  for (const c of ctx.meter.calls) {
    if (c.api !== 'llm') continue;
    const u = (out[c.model ?? '?'] ??= { calls: 0, tokensIn: 0, tokensOut: 0 });
    u.calls++; u.tokensIn += c.tokensIn ?? 0; u.tokensOut += c.tokensOut ?? 0;
  }
  return out;
}

/** gpt-6.1-sol answers in a chat-app markup (<box>, <Entity value=...>, <Cite refs=...>) and once
 *  looped into a 700k-char answer. The judge sees a cleaned copy: markup stripped, repeated
 *  sentences dropped, and at most JUDGE_CHARS characters (input shaping, not a cap on the model). */
export const JUDGE_CHARS = Number(process.env.DD_G_JUDGE_CHARS ?? 16000);
export function cleanAnswer(a: string): string {
  const t = a
    .replace(/<Entity\b[^>]*?value="([^"]*)"[^>]*\/?>/g, '$1')
    .replace(/<(Cite|AsyncImage)\b[^>]*\/>/g, ' ')
    .replace(/<\/?(box|row|text|title|badge|divider|col|grid|card|span|div)\b[^>]*>/gi, ' ')
    .replace(/[ \t]+/g, ' ');
  const seen = new Set<string>();
  const out: string[] = [];
  for (const seg of t.split(/(?<=[.!?])\s+|\n+/)) {
    const k = seg.trim().toLowerCase();
    if (k.length >= 30 && seen.has(k)) continue;
    seen.add(k);
    out.push(seg.trim());
  }
  return out.filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
}

/** Small promise pool so ~20 calls do not hit the router at once. */
export async function pool<T, R>(items: T[], n: number, fn: (x: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); }
  }));
  return out;
}

/** Name, trade and area from the dive. One LLM call at temperature 0, with a plain fallback. */
export async function profileOf(ctx: Ctx, dive: any): Promise<Profile> {
  // The template must be the SAME every run, but even at temperature 0 the profile call drifted
  // ("my house" / "my property" / "my house or business"). Reuse the profile of the last G run for
  // this dive (read-only from out/); DD_G_NEW_PROFILE=1 builds a fresh one.
  if (!process.env.DD_G_NEW_PROFILE) {
    for (const lane of ['fixed', 'free', 'grounded']) {
      try {
        const prev = JSON.parse(fs.readFileSync(path.join(OUT, `G-${lane}-${ctx.diveId}.json`), 'utf8'));
        // Only reuse a v2 profile: v1 took the area from identity.address, which for Rienzo was a credit agency's office.
        if (prev.notes?.profile?.trade && prev.notes.profile.v === PROFILE_VERSION) { ctx.log(`profile reused from out/G-${lane}-${ctx.diveId}.json`); return prev.notes.profile; }
      } catch { /* none yet */ }
    }
  }
  const r = dive.result ?? {};
  const id = r.identity ?? {};
  const name = String(id.legal_name ?? dive.company);
  const aliases: string[] = (id.aliases ?? []).filter((a: string) => a && a !== name);
  const brand = aliases.find((a) => !/sdn|bhd|berhad|plt/i.test(a) && /^[\x20-\x7e]+$/.test(a)) ?? name.replace(/\s*(sdn\.?\s*bhd\.?|berhad|plt)\s*$/i, '').trim();
  const addr = String(id.address ?? '');
  const footprint = (r.facts ?? []).filter((f: any) => f.topic === 'footprint').slice(0, 10).map((f: any) => '- ' + f.fact).join('\n');
  const offer = (r.facts ?? []).filter((f: any) => f.topic === 'products_services').slice(0, 6).map((f: any) => '- ' + f.fact).join('\n');
  const p = ctx.parseJson(await ctx.llm(
    `Company: ${name}. Industry: ${id.industry}. Address on file: ${addr}. Summary: ${id.summary}\n` +
    `Location facts:\n${footprint || '- none'}\nWhat it sells:\n${offer || '- none'}\n\n` +
    `Return JSON {"trade": "the 2-5 word phrase a customer would type to find a company selling its MAIN product line: name the kind of BUSINESS (ending in installer, contractor, supplier, maker, shop or similar), using the company's own product words, singular, e.g. \\"solar panel installer\\"", ` +
    `"trades": "the same phrase in plural", "job": "what a household or business customer wants done, as the end of 'I want to ...', e.g. \\"install solar panels on my house\\"", ` +
    `"area": "the city or town of the company's OWN head office or main premises, e.g. Johor Bahru. Use the official website or contact-page address; ignore any address the facts say belongs to someone else (a directory, a credit agency)", ` +
    `"state": "that town's state, e.g. Johor"}. JSON only.`,
    { temperature: 0 },
  ));
  if (!p?.trade) ctx.warn('profile: no trade from the LLM, using the industry words');
  const parts = addr.split(',').map((s) => s.trim());
  const fallbackArea = (parts.find((s) => /\d{5}/.test(s)) ?? parts[parts.length - 3] ?? 'Kuala Lumpur').replace(/\d{5}\s*/, '');
  const trade = p?.trade ?? String(id.industry ?? 'company').split(/[,(]/)[0].trim();
  return {
    name, brand, aliases,
    trade, trades: p?.trades ?? trade + 's', job: p?.job ?? `hire a ${trade}`,
    area: p?.area ?? fallbackArea, state: p?.state ?? parts[parts.length - 2] ?? '',
    industry: String(id.industry ?? ''),
    v: PROFILE_VERSION,
  };
}

/** The dive as a numbered fact sheet for the judge. */
export function factSheet(dive: any): string {
  const r = dive.result ?? {};
  const id = r.identity ?? {};
  const facts = (r.facts ?? []).map((f: any, i: number) => `#${i} [${f.topic}, ${f.confidence}] ${f.fact}`).join('\n');
  return [
    `Legal name: ${id.legal_name}. Aliases: ${(id.aliases ?? []).join(', ')}.`,
    `Registration numbers: ${(id.registration_numbers ?? []).join(', ')}.`,
    `HQ address: ${id.address}.`,
    `Official domains: ${(id.official_domains ?? []).join(', ')}.`,
    `Industry: ${id.industry}. Summary: ${id.summary}`,
    '',
    'FACTS (numbered; cite these numbers):',
    facts,
    '',
    'KNOWN CONTRADICTIONS between sources (a claim matching either side is "disputed", not "wrong"):',
    ...(r.contradictions ?? []).map((c: string) => '- ' + c),
  ].join('\n');
}

const JUDGE_SYSTEM = 'You are a strict fact-checker. You compare what an AI assistant said about a company with a researched fact sheet. You answer with JSON only.';

/** One judge call: what does this answer claim about the company, and is each claim right? */
export async function judge(ctx: Ctx, profile: Profile, sheet: string, prompt: Prompt, model: string, answer: string, evidence = ''): Promise<Judged> {
  const base: Judged = {
    prompt, model, answer, judged: false, mentions_company: false, declines: false, confused_with: null,
    recommended: 'not_mentioned', claims: [], competitors: [], outcome: 'unjudged', judge_summary: '', searched: SEARCH_MARK.test(answer),
  };
  if (!answer) { ctx.warn(`judge: empty answer from ${model} for ${prompt.id}`); return base; }
  const clean = cleanAnswer(answer);
  // A stub is an answer that is ONLY search narration ("I'll check...", "I'm checking..."), with nothing after it.
  const stub = STUB_RE.test(clean) && clean.split(/(?<=[.!?])\s*/).filter((x) => !/^(I['’]ll|I will|Let me|I['’]m (checking|starting|looking|searching|now))/i.test(x.trim())).join(' ').trim().length < 40;
  if (clean.length > JUDGE_CHARS) ctx.warn(`judge: ${model}/${prompt.id} answer is ${answer.length} chars (${clean.length} after clean-up); the judge reads the first ${JUDGE_CHARS}`);
  const names = [profile.name, profile.brand, ...profile.aliases].join(' / ');
  const norm = (s: string) => s.toLowerCase().replace(/sdn\.?\s*bhd\.?|berhad|plt|\(.*?\)/g, '').replace(/[^a-z0-9]+/g, '');
  const ownNames = [profile.name, profile.brand, ...profile.aliases].map(norm).filter((n) => n.length >= 3);
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const areaEcho = prompt.text.toLowerCase().includes(profile.area.toLowerCase())
    ? new RegExp(`\\b(based|located|operat\\w*|headquartered|serv\\w*)\\b[^.]*\\b${esc(profile.area)}\\b`, 'i') : /$^/;
  const raw = await ctx.llm(
    `THE COMPANY: ${names}\n\nFACT SHEET (researched from the web; treat as ground truth unless it lists a contradiction):\n${sheet}\n\n` +
    (evidence ? `SEARCH RESULTS THE ASSISTANT WAS GIVEN (real web pages; they may hold true details the fact sheet lacks):\n${evidence}\n\n` : '') +
    `---\nA customer asked an AI assistant:\n"${prompt.text}"\n\nThe assistant (${model}) answered:\n"""\n${clean.slice(0, JUDGE_CHARS)}\n"""\n---\n\n` +
    `Judge the answer ONLY for what it says about THE COMPANY. Return JSON:\n` +
    `{"mentions_company": true if the answer names THE COMPANY (any of its names) at all,\n` +
    ` "declines": true if the answer says it has no / limited / no specific information about THE COMPANY (or, for a question that does not name it, false),\n` +
    ` "confused_with": null, or the name of a DIFFERENT named company (not a sector, not one of THE COMPANY's own names or aliases) the answer describes as if it were THE COMPANY,\n` +
    ` "recommended": "yes" | "no" | "neutral" | "not_mentioned"  (does the answer steer the customer toward THE COMPANY?),\n` +
    ` "claims": [ every specific factual claim the answer makes about THE COMPANY: phone, address, website, founding date, owner, size, services, licences, reputation, reviews, prices, etc.\n` +
    `   {"claim": "short paraphrase", "verdict": "correct" | "wrong" | "disputed" | "unverifiable" | "echo"${evidence ? ' | "sourced"' : ''}, "facts": [fact numbers that support or contradict it], "note": "why, one short sentence"} ],\n` +
    ` "competitors": [names of OTHER companies the answer names or recommends, exactly as written],\n` +
    ` "summary": "one sentence an owner of THE COMPANY would read, e.g. 'Says it does not know you and names A, B and C instead' or 'Gives a phone number that is not yours'"}\n\n` +
    `Rules: "correct" = the fact sheet supports it. "wrong" = the fact sheet contradicts it (a different phone, address, domain, founding year, business line or owner) ` +
    `or it is a specific detail that is clearly invented (a phone number, street address, founder name or year that appears nowhere in the sheet counts as wrong). ` +
    `"disputed" = it matches one side of a listed contradiction (not merely "partly supported"). "unverifiable" = the sheet neither supports nor contradicts it. ` +
    (evidence ? `"sourced" = the SEARCH RESULTS state it (a phone, address, rating, registration number, date, person...) even though the fact sheet lacks it or says otherwise; ` +
      `say in the note if it conflicts with the fact sheet. Use "wrong" ONLY when neither the fact sheet nor the search results support the detail. ` : '') +
    `"echo" = it only repeats what the customer's question already said (e.g. the town or trade named in the question) or what the name itself implies; echoes show no knowledge. For example "X Sdn Bhd is a Malaysian private limited company" is ALWAYS an echo, ` +
    `and "X is a solar installer in Johor Bahru" is an echo when the question said so. ` +
    `Statements about the assistant's own knowledge ("I could not verify", "there is little public information") are NOT claims: they set "declines" to true. ` +
    `Do NOT list general advice ("check reviews", "ask for quotes", "verify SEDA registration") as claims, and do not list claims about other companies. ` +
    `If the answer does not mention THE COMPANY, claims is []. JSON only.`,
    { model: JUDGE_MODEL, system: JUDGE_SYSTEM, temperature: 0 },
  );
  const j = ctx.parseJson(raw);
  if (!j || typeof j !== 'object') { ctx.warn(`judge: unparseable verdict for ${model}/${prompt.id}: ${raw.slice(0, 120)}`); return base; }
  const rawClaims: Claim[] = Array.isArray(j.claims) ? j.claims.filter((c: any) => c && c.claim).map((c: any) => ({
    claim: String(c.claim), verdict: (VERDICTS.includes(c.verdict) && (c.verdict !== 'sourced' || evidence) ? c.verdict : 'unverifiable'), hedged: !!c.hedged,
    facts: Array.isArray(c.facts) ? c.facts.map(Number).filter((n: number) => Number.isFinite(n)) : [], note: c.note ? String(c.note) : undefined,
  })) : [];
  // Deterministic clean-up of what the judge model gets wrong most often (seen in testing):
  // advice listed as a claim, "I could not verify" listed as a wrong claim, and the
  // "Sdn Bhd = private limited company" echo counted as knowledge.
  const dropped: { claim: string; verdict: string; why: string }[] = [];
  let declines = !!j.declines;
  const claims: Claim[] = [];
  for (const c of rawClaims) {
    if (DECLINE_RE.test(c.claim)) { dropped.push({ claim: c.claim, verdict: c.verdict, why: 'decline, not a claim' }); declines = true; continue; }
    if (ADVICE_RE.test(c.claim)) { dropped.push({ claim: c.claim, verdict: c.verdict, why: 'advice, not a claim' }); continue; }
    if (ECHO_RE.test(c.claim) && c.verdict !== 'echo' && c.verdict !== 'wrong') { dropped.push({ claim: c.claim, verdict: c.verdict, why: 'echo of the name' }); claims.push({ ...c, verdict: 'echo' }); continue; }
    // "X is based in <town>" when the question itself named that town is an echo, not knowledge.
    if (areaEcho.test(c.claim) && !/\d/.test(c.claim) && c.claim.length < 90 && c.verdict !== 'echo' && c.verdict !== 'wrong') { dropped.push({ claim: c.claim, verdict: c.verdict, why: 'echo of the question' }); claims.push({ ...c, verdict: 'echo' }); continue; }
    claims.push(c);
  }
  // confused_with must be another company: not a sector (all lower case) and not one of our own names.
  let confused: string | null = j.confused_with ? String(j.confused_with) : null;
  if (confused && (confused === confused.toLowerCase() || ownNames.some((n) => n && norm(confused!).includes(n)))) { dropped.push({ claim: `confused_with: ${confused}`, verdict: 'confused', why: 'own alias or a sector, not another company' }); confused = null; }
  const mentions = !!j.mentions_company;
  const right = claims.filter(isRight).length;
  const wrong = claims.filter((c) => c.verdict === 'wrong').length;
  const outcome: Judged['outcome'] =
    !mentions ? (prompt.kind === 'trade' ? 'not_mentioned' : (j.declines ? 'doesnt_know' : 'not_mentioned'))
    : wrong && right ? 'mixed' : wrong ? 'wrong' : right ? 'correct' : declines ? 'doesnt_know' : 'mentioned_no_facts';
  if (stub) ctx.warn(`${model} gave only a preamble for ${prompt.id} ("${answer.slice(0, 60)}…"): it started a web search and never answered`);
  return {
    ...base, judged: true, mentions_company: mentions, declines, dropped, stub,
    confused_with: confused,
    recommended: (['yes', 'no', 'neutral', 'not_mentioned'].includes(j.recommended) ? j.recommended : (mentions ? 'neutral' : 'not_mentioned')),
    claims, competitors: Array.isArray(j.competitors) ? j.competitors.map(String) : [], outcome, judge_summary: String(j.summary ?? ''),
  };
}

/** Ask every model every prompt, then judge every answer. */
export async function askAndJudge(ctx: Ctx, dive: any, profile: Profile, prompts: Prompt[], opts: { context?: (p: Prompt) => string; system?: string; repeat?: number; evidence?: (p: Prompt) => string } = {}): Promise<Judged[]> {
  const sheet = factSheet(dive);
  const repeat = Math.max(1, opts.repeat ?? 1);
  const jobs = prompts.flatMap((p) => ANSWER_MODELS.flatMap((m) => Array.from({ length: repeat }, (_, k) => ({ p, m, k }))));
  const system = [opts.system, BRIEF ? BRIEF_TEXT : ''].filter(Boolean).join(' ');
  ctx.log(`asking ${prompts.length} prompts x ${ANSWER_MODELS.length} models x ${repeat} at temperature ${ANSWER_TEMP}${BRIEF ? ' (brevity asked)' : ''}; judge ${JUDGE_MODEL}`);
  return pool(jobs, repeat > 1 ? 6 : 4, async ({ p, m, k }) => {
    const text = opts.context ? opts.context(p) + p.text : p.text;
    const answer = await ctx.llm(text, { model: m, temperature: ANSWER_TEMP, ...(system ? { system } : {}) });
    const j = await judge(ctx, profile, sheet, p, m, answer, opts.evidence ? opts.evidence(p) : '');
    j.sample = k;
    ctx.log(`${p.id}#${k} ${m}: ${j.outcome}${j.competitors.length ? ' | names ' + j.competitors.slice(0, 4).join(', ') : ''}`);
    return j;
  });
}

/** Round 3: for repeated asks, one representative answer per (prompt, model): the first sample
 *  with the majority outcome, carrying the spread (how many samples agree, every sample's wrong claims). */
export function majority(judged: Judged[]): Judged[] {
  const groups = new Map<string, Judged[]>();
  for (const j of judged) { const k = j.prompt.id + '|' + j.model; groups.set(k, [...(groups.get(k) ?? []), j]); }
  const out: Judged[] = [];
  for (const js of groups.values()) {
    const count = new Map<string, number>();
    for (const j of js) count.set(j.outcome, (count.get(j.outcome) ?? 0) + 1);
    const top = [...count.entries()].sort((a, b) => b[1] - a[1])[0][0];
    const rep = js.find((j) => j.outcome === top)!;
    out.push({ ...rep, spread: { samples: js.length, agree: count.get(top)!, outcomes: js.map((j) => j.outcome), wrong: js.map((j) => j.claims.filter((c) => c.verdict === 'wrong').map((c) => c.claim)), mentions: js.filter((j) => j.mentions_company).length } });
  }
  return out;
}

const spreadText = (j: Judged) => {
  const s = j.spread;
  if (!s || s.samples < 2) return '';
  const others = s.outcomes.filter((o) => o !== j.outcome);
  return ` [${s.agree} of ${s.samples} asks${others.length ? '; others: ' + others.join(', ') : ''}]`;
};
const spreadDetail = (j: Judged) => {
  const s = j.spread;
  if (!s || s.samples < 2) return '';
  const w = s.wrong.map((ws, i) => ws.length ? `ask ${i + 1}: ${ws.join(' | ')}` : '').filter(Boolean);
  return w.length ? ` Wrong claims per ask: ${w.join(' || ')}.` : '';
};

/** Round 3: DNS (and a light page check) for every domain an answer gives for the company.
 *  "AI sends customers to a website that does not exist" becomes a checked fact. Never throws. */
export async function checkDomains(ctx: Ctx, dive: any, profile: Profile, judged: Judged[]): Promise<{ findings: Finding[]; domains: any[] }> {
  const dns = await import('node:dns');
  const official = (dive.result?.identity?.official_domains ?? []).map((d: string) => d.toLowerCase().replace(/^www\./, ''));
  const stop = new Set(['sdn', 'bhd', 'the', 'and', 'malaysia', 'technologies', 'technology', 'tech', 'home', 'solar', 'green', 'renovation', 'construction', 'group', 'enterprise', 'services', 'trading', 'industries', 'engineering', 'energy']);
  const words = [profile.name, profile.brand, ...profile.aliases].join(' ').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter((w) => w.length >= 3 && !stop.has(w));
  const tokens = [...new Set([...words, profile.brand.toLowerCase().replace(/[^a-z0-9]+/g, '')].filter((w) => w.length >= 3))];
  const HOST = /\b((?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:com\.my|net\.my|org\.my|biz\.my|my|com|net|org|co|io|me|asia|biz|info|shop|store))\b/gi;
  const seen = new Map<string, { domain: string; answers: string[] }>();
  for (const j of judged) {
    const text = cleanAnswer(j.answer).replace(/https?:\/\//g, ' ');
    for (const m of text.matchAll(HOST)) {
      const d = m[1].toLowerCase().replace(/^www\./, '');
      const label = d.split('.')[0];
      if (!official.includes(d) && !tokens.some((t) => label.includes(t)) && j.prompt.id !== 'website') continue;
      if (/^(facebook|google|linkedin|instagram|youtube|tiktok|wa|whatsapp|x|twitter|yelp|exa|gmail|yahoo|hotmail|outlook)\./.test(d)) continue;
      const e = seen.get(d) ?? { domain: d, answers: [] };
      const tag = `${short(j.model)}/${j.prompt.id}${j.sample != null ? '#' + (j.sample + 1) : ''}`;
      if (!e.answers.includes(tag)) e.answers.push(tag);
      seen.set(d, e);
    }
  }
  const GAMBLING = /\b(slot|slots|togel|judi|casino|gacor|royal ?123|sbobet|toto|maxwin|bandar)\b/i;
  const domains: any[] = [];
  for (const e of seen.values()) {
    let dnsStatus = 'ok';
    try { await dns.promises.lookup(e.domain); } catch (err: any) { dnsStatus = err?.code ?? 'error'; }
    let page: any = null;
    if (dnsStatus === 'ok') {
      const p = await ctx.page('https://' + e.domain);
      const t = (p.html || '').replace(/<[^>]+>/g, ' ').slice(0, 20000);
      page = { status: p.status, finalUrl: p.finalUrl, error: p.error, gambling: GAMBLING.test(t), mentionsYou: tokens.some((tk) => t.toLowerCase().includes(tk)) };
    }
    domains.push({ ...e, official: official.includes(e.domain), dns: dnsStatus, page });
  }
  const at = ctx.now();
  const findings: Finding[] = [];
  for (const d of domains) {
    const who = `${d.answers.length} answer${d.answers.length > 1 ? 's' : ''} (${[...new Set(d.answers)].slice(0, 8).join(', ')})`;
    if (d.dns !== 'ok') findings.push({ title: `AI gives ${d.domain} for you, and that domain does not exist (DNS ${d.dns})`, detail: `Named in ${who}. Your known domains: ${official.join(', ') || 'none'}.`, severity: 'high', source: null, checked_at: at, kind: 'domain', domain: d.domain, dns: d.dns });
    else if (d.page?.gambling) findings.push({ title: `AI sends customers to ${d.domain}, which now shows gambling content`, detail: `Named in ${who}. The page (${d.page.finalUrl}, HTTP ${d.page.status}) contains gambling words.${d.official ? ' It is one of your official domains.' : ''}`, severity: 'high', source: 'https://' + d.domain, checked_at: at, kind: 'domain', domain: d.domain });
    else if (!d.official) findings.push({ title: `AI gives ${d.domain} for you; it exists but is not one of your known domains`, detail: `Named in ${who}. HTTP ${d.page?.status ?? '-'}${d.page?.error ? ' (' + d.page.error + ')' : ''}; ${d.page?.mentionsYou ? 'the page mentions your name' : 'the page does not mention your name'}.`, severity: d.page?.mentionsYou ? 'low' : 'medium', source: 'https://' + d.domain, checked_at: at, kind: 'domain', domain: d.domain });
  }
  const ok = domains.filter((d) => d.official && d.dns === 'ok' && !d.page?.gambling);
  if (domains.length) findings.push({ title: `Domains AI gives for you: ${ok.length} of ${domains.length} are your real, working sites`, detail: domains.map((d) => `${d.domain}: ${d.dns !== 'ok' ? 'does not exist' : d.page?.gambling ? 'gambling content' : d.official ? 'yours' : 'not yours'} (${d.answers.length}x)`).join('; ') + '.', severity: ok.length === domains.length ? 'info' : 'medium', source: null, checked_at: at, kind: 'domain-rollup' });
  return { findings, domains };
}

const short = (m: string) => m.replace(/-flash-1017$/, '-flash').replace(/^gpt-/, 'gpt-');
const quote = (s: string, n = 220) => { const t = s.replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n) + '…' : t; };
const claimList = (cs: Claim[]) => cs.map((c) => `"${c.claim}" (${c.verdict}${c.hedged ? ', hedged' : ''}${c.facts?.length ? ', fact ' + c.facts.join('/') : ''}${c.note ? ': ' + c.note : ''})`).join('; ');

/** Owner-facing findings from the judged answers. One per prompt when the models agree, else one per model. */
export function findingsFrom(ctx: Ctx, profile: Profile, judged: Judged[], prompts: Prompt[], all: Judged[] = judged): Finding[] {
  const findings: Finding[] = [];
  const at = ctx.now();
  const models = [...new Set(judged.map((j) => j.model))];
  const both = models.map(short).join(' nor ');
  for (const p of prompts) {
    const js = judged.filter((j) => j.prompt.id === p.id);
    if (!js.length) continue;
    const q = `"${quote(p.text, 120)}"`;
    if (p.kind === 'trade') {
      const named = js.filter((j) => j.mentions_company);
      const comp = [...new Set(js.flatMap((j) => j.competitors))];
      if (!named.length) {
        findings.push({ title: `Neither ${both} names you when asked ${q}${js[0].spread && js[0].spread.samples > 1 ? ` (named you in ${js.reduce((a, j) => a + (j.spread?.mentions ?? 0), 0)} of ${js.reduce((a, j) => a + (j.spread?.samples ?? 1), 0)} asks)` : ''}`, detail: `Companies they name instead: ${comp.slice(0, 12).join(', ') || 'none (generic advice only)'}.` + js.map((j) => ` ${short(j.model)}: ${j.competitors.join(', ') || 'no company named'}.`).join(''), severity: 'high', source: null, checked_at: at, prompt: p.text, kind: p.kind, outcome: 'not_mentioned', models: js.map((j) => j.model), competitors: comp });
      } else {
        for (const j of js) findings.push({ title: (j.mentions_company ? `${short(j.model)} names you when asked ${q}` : `${short(j.model)} does not name you when asked ${q}`) + (j.spread && j.spread.samples > 1 ? ` (named you in ${j.spread.mentions} of ${j.spread.samples} asks)` : ''), detail: `${j.judge_summary} Recommended: ${j.recommended}. Others named: ${j.competitors.join(', ') || 'none'}.${j.claims.length ? ' Claims about you: ' + claimList(j.claims) : ''}`, severity: j.mentions_company ? (j.claims.some((c) => c.verdict === 'wrong') ? 'medium' : 'info') : 'high', source: null, checked_at: at, prompt: p.text, kind: p.kind, outcome: j.outcome, model: j.model, competitors: j.competitors, evidence: quote(j.answer, 400) });
      }
      continue;
    }
    // Company question: merge when every model simply does not know / does not mention.
    if (js.every((j) => (j.outcome === 'doesnt_know' || j.outcome === 'not_mentioned') && !j.claims.some((c) => c.verdict !== 'echo') && !j.confused_with)) {
      findings.push({ title: `Neither ${both} knows anything about you for ${q}${js[0].spread && js[0].spread.samples > 1 ? ` [${js.map((j) => `${short(j.model)} ${j.spread!.agree} of ${j.spread!.samples}`).join(', ')} asks]` : ''}`, detail: `Both say they have no information about ${profile.name}.` + js.map((j) => ` ${short(j.model)}: "${quote(j.answer, 160)}"`).join(''), severity: 'medium', source: null, checked_at: at, prompt: p.text, kind: p.kind, outcome: 'doesnt_know', models: js.map((j) => j.model) });
      continue;
    }
    for (const j of js) {
      const wrong = j.claims.filter((c) => c.verdict === 'wrong');
      const right = j.claims.filter(isRight);
      let title: string;
      let sev: Finding['severity'];
      if (j.outcome === 'unjudged') { title = `${short(j.model)}: answer to ${q} could not be judged`; sev = 'info'; }
      else if (j.confused_with) { title = `${short(j.model)} mistakes you for ${j.confused_with} when asked ${q}`; sev = 'high'; }
      else if (wrong.length) { title = `${short(j.model)}, asked ${q}: ${wrong.length} wrong claim${wrong.length > 1 ? 's' : ''} about you. ${j.judge_summary}`; sev = 'high'; }
      else if (right.length) { title = `${short(j.model)}, asked ${q}: ${right.length} right claim${right.length > 1 ? 's' : ''}, none wrong. ${j.judge_summary}`; sev = 'info'; }
      else if (j.outcome === 'doesnt_know' || j.outcome === 'not_mentioned') { title = `${short(j.model)} does not know the answer to ${q}. ${j.judge_summary}`; sev = 'medium'; }
      else { title = `${short(j.model)}, asked ${q}: nothing checkable about you. ${j.judge_summary}`; sev = 'low'; }
      if (j.recommended !== 'not_mentioned' && (!p.topic || p.id === 'reliable')) title += ` (Recommends you: ${j.recommended}.)`;
      title += spreadText(j);
      findings.push({ title, detail: `${j.claims.length ? 'Claims: ' + claimList(j.claims) : 'No claims about you.'}${spreadDetail(j)}${j.searched ? ' (The model ran its own web search for this answer.)' : ''}`, severity: sev, source: null, checked_at: at, prompt: p.text, kind: p.kind, outcome: j.outcome, model: j.model, evidence: quote(j.answer, 400) });
    }
  }
  // Roll-up: how much does each model know?
  for (const m of models) {
    const js = all.filter((j) => j.model === m);
    const co = js.filter((j) => j.prompt.kind === 'company');
    const tr = js.filter((j) => j.prompt.kind === 'trade');
    const nRight = js.reduce((a, j) => a + j.claims.filter(isRight).length, 0);
    const nSourced = js.reduce((a, j) => a + j.claims.filter((c) => c.verdict === 'sourced').length, 0);
    const nWrong = js.reduce((a, j) => a + j.claims.filter((c) => c.verdict === 'wrong').length, 0);
    const dk = co.filter((j) => j.outcome === 'doesnt_know' || j.outcome === 'not_mentioned').length;
    findings.push({
      title: `${short(m)} overall: ${nRight} right${nSourced ? ` (${nSourced} of them found in search results, not in our research)` : ''} and ${nWrong} wrong claims about you; "don't know" on ${dk} of ${co.length} ${all !== judged ? 'asks' : 'questions'} about you; names you in ${tr.filter((j) => j.mentions_company).length} of ${tr.length} trade ${all !== judged ? 'asks' : 'questions'}`,
      detail: `Outcomes: ${js.map((j) => `${j.prompt.id}=${j.outcome}${j.searched ? '(searched)' : ''}`).join(', ')}. ${js.filter((j) => j.searched).length} of ${js.length} answers show web-search citations (those reflect a live search, not training data).`, severity: nWrong ? 'high' : 'medium', source: null, checked_at: at, model: m, kind: 'rollup',
    });
  }
  // Who AI names instead of you: competitor counts over every trade answer.
  const tradeJs = all.filter((j) => j.prompt.kind === 'trade' && j.judged);
  if (tradeJs.length) {
    const key = (n: string) => n.toLowerCase().replace(/\(.*?\)|sdn\.?\s*bhd\.?|berhad|holdings|group|energy|solar|systems?|\bplt\b|\/.*$/g, '').replace(/[^a-z0-9]+/g, '').trim() || n.toLowerCase();
    const tally = new Map<string, { name: string; n: number; models: Set<string> }>();
    for (const j of tradeJs) for (const c of new Set(j.competitors.map(key))) {
      const name = j.competitors.find((x) => key(x) === c)!;
      const t = tally.get(c) ?? { name, n: 0, models: new Set() };
      t.n++; t.models.add(short(j.model)); tally.set(c, t);
    }
    const top = [...tally.values()].sort((a, b) => b.n - a.n).slice(0, 8);
    const you = tradeJs.filter((j) => j.mentions_company).length;
    findings.push({
      title: `When customers ask AI for ${/^[aeiou]/i.test(profile.trade) ? 'an' : 'a'} ${profile.trade} without naming you, AI names you in ${you} of ${tradeJs.length} answers; it names ${top.slice(0, 3).map((t) => t.name).join(', ')} most`,
      detail: `Names that come up across ${tradeJs.length} trade answers: ${top.map((t) => `${t.name} ${t.n}x (${[...t.models].join('+')})`).join('; ') || 'none'}.`,
      severity: you ? 'medium' : 'high', source: null, checked_at: at, kind: 'rollup', competitors: top.map((t) => ({ name: t.name, count: t.n })),
    });
  }
  return findings;
}

/** Compact per-answer signature, for comparing two runs. */
export function signatures(judged: Judged[]) {
  return judged.map((j) => ({
    id: j.prompt.id, sample: j.sample ?? 0, model: j.model, outcome: j.outcome, searched: j.searched, mentions: j.mentions_company, declines: j.declines, confused_with: j.confused_with,
    claims: j.claims.map((c) => `${c.verdict}${c.hedged ? '~' : ''}: ${c.claim}`), competitors: j.competitors, answer_chars: j.answer.length,
  }));
}
