import dns from 'node:dns';
import { brave, exa, llm, tavily } from '../core/index.ts';
import { PRICES, type ApiCall } from '../cost.ts';
import * as countries from '../countries.ts';
import * as pagefetch from '../pagefetch.ts';

export type Source = {
  id: number;
  url: string;
  title: string;
  snippets: string[];
  content: string;
  contentKind: 'none' | 'chunks' | 'page';
  found: string[];
  failed?: string;
};

export type Fact = { topic: string; fact: string; sources: number[]; confidence: 'high' | 'medium' | 'low' };

export type Identity = {
  legal_name?: string;
  aliases?: string[];
  registration_numbers?: string[];
  address?: string;
  official_domains?: string[];
  industry?: string;
  summary?: string;
};

export type DiveResult = {
  identity: Identity;
  facts: Fact[];
  contradictions: string[];
  gaps: string[];
  sources: Array<Omit<Source, 'content' | 'snippets'> & { relevant: boolean }>;
  tavily: TavilyCall[];
  llm: LlmUse[];
  braveCalls: number;
  /** Every Brave request, one by one (since 2026-10-31). */
  brave?: ApiCall[];
  /** Stages that could not finish and fell back; empty on a clean run. */
  warnings: string[];
  /** The people step (companydive-people.ts PeopleResult). */
  people?: unknown;
};

export type Progress = (stage: string, msg: string) => void | Promise<void>;

/** Hosts whose pages Tavily cannot read (login or bot walls); their search snippets are all we get. */
const WALLED = /(^|\.)(facebook\.com|instagram\.com|linkedin\.com|tiktok\.com|x\.com|twitter\.com|ctoscredit\.com\.my|dnb\.com|bloomberg\.com|zoominfo\.com)$/i;

const COUNTRY_CODES: Record<string, string> = {
  malaysia: 'MY', singapore: 'SG', indonesia: 'ID', thailand: 'TH', philippines: 'PH', vietnam: 'VN',
  china: 'CN', 'hong kong': 'HK', taiwan: 'TW', japan: 'JP', 'south korea': 'KR', india: 'IN',
  australia: 'AU', 'new zealand': 'NZ', 'united kingdom': 'GB', 'united states': 'US', canada: 'CA',
};

const TOPICS = ['identity', 'ownership_people', 'products_services', 'projects_clients', 'footprint',
  'size_financials', 'reputation', 'news', 'competitors', 'digital_presence', 'risks'];

// ---------------------------------------------------------------- budget and model

export const MAX_TAVILY_CALLS = 15;

export type TavilyCall = { n: number; at?: string; path: string; label: string; credits: number; ms: number; ok: boolean; usd?: number; note?: string;
  /** Who served it: 'tavily', or the name of the Mac mini fetch lane that read the pages. */
  via?: string };

/** Counts a dive's Tavily calls and refuses the one past the cap. A call no key accepted costs nothing and is not counted. */
export class Budget {
  calls: TavilyCall[] = [];
  readonly max: number;
  constructor(max = MAX_TAVILY_CALLS) { this.max = max; }
  get used(): number { return this.calls.length; }
  get left(): number { return this.max - this.calls.length; }
  get credits(): number { return this.calls.reduce((n, c) => n + c.credits, 0); }
}

export class BudgetSpent extends Error {}

type TavilyRequest = typeof tavily.request;
type PageReader = typeof pagefetch.read;

export async function budgetedCall(
  budget: Budget,
  path: 'search' | 'extract' | 'map',
  body: Record<string, unknown>,
  label: string,
  request: TavilyRequest = tavily.request,
  readPages: PageReader = pagefetch.read,
): Promise<Record<string, any>> {
  if (budget.left <= 0) throw new BudgetSpent(`Tavily budget of ${budget.max} calls is spent`);
  const started = Date.now();
  const at = new Date(started).toISOString();
  const via = path === 'extract' ? 'macmini' : 'tavily';
  try {
    // Pages are read on the Mac mini since 2026-11-01 (pagefetch.ts): the same
    // answer shape, for nothing, from an address websites actually serve.
    // Search and map stay with Tavily — they are search, not page reads.
    const out = path === 'extract'
      ? await readPages((body.urls as string[]) ?? [])
      : await request(path, body, { timeoutMs: path === 'map' ? 120_000 : 60_000 });
    const credits = Number(out.usage?.credits ?? 0);
    budget.calls.push({ n: budget.used + 1, at, path, label, credits, ms: Date.now() - started, ok: true, usd: credits * PRICES.tavilyCredit,
      via: path === 'extract' ? (out as pagefetch.ExtractAnswer).worker ?? via : via });
    return out;
  } catch (err) {
    const code = (err as { code?: string }).code;
    // Refused before any work was done (no key, or no fetch lane): no budget spent.
    if (code !== 'quota' && code !== 'not_installed') {
      budget.calls.push({ n: budget.used + 1, at, path, label, credits: 0, ms: Date.now() - started, ok: false, usd: 0, note: (err as Error).message.slice(0, 200), via });
    }
    throw err;
  }
}

/**
 * One LLM call. Tokens come from the provider's usage report; calls made before
 * 2026-10-30 have none. Since 2026-10-31 a failed attempt is kept too (ok false),
 * with its time, the lane that served it and its cost in USD (null for a model
 * with no per-token price).
 */
export type LlmUse = { step: string; engine: string; ms: number; promptChars: number; answerChars: number; tokensIn?: number; tokensOut?: number; at?: string; ok?: boolean; usd?: number | null; note?: string; provider?: string };

/** Where a stage that could not finish says so; the dive carries on. */
export type Warn = (msg: string) => void | Promise<void>;

/**
 * One LLM call through the app's router (core/llm.ts): every deepseek lane on
 * /workers, several at once, a lane that answers 429 rests while the call moves
 * on, MiniMax only after every lane failed twice. No timeout and no token cap.
 * If every round fails the stage gets the error and falls back; the dive itself
 * does not end here. Every attempt lands in `uses`.
 */
export async function ask(prompt: string, opts: { step: string; uses?: LlmUse[] }): Promise<string> {
  const log: ApiCall[] = [];
  try {
    return stripThinking((await llm.chat(prompt, { step: opts.step, log })).answer);
  } finally {
    for (const c of log) {
      opts.uses?.push({
        step: c.what, engine: c.model ?? 'unknown', provider: c.provider, at: c.at, ms: c.ms, ok: c.ok,
        promptChars: prompt.length, answerChars: Number(c.note?.match(/(\d+) out$/)?.[1] ?? 0),
        ...(c.tokensIn || c.tokensOut ? { tokensIn: c.tokensIn, tokensOut: c.tokensOut } : {}),
        usd: c.usd, ...(c.ok ? {} : { note: c.note }),
      });
    }
  }
}

/** Some gateways leave the model's reasoning inline in <think> tags. */
export function stripThinking(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
}

/** The first JSON object or array in a model answer, fences and prose around it ignored. */
export function parseJson<T>(text: string): T {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : text;
  const start = body.search(/[[{]/);
  if (start < 0) throw new Error(`no JSON in answer: ${text.slice(0, 200)}`);
  const open = body[start];
  const close = open === '{' ? '}' : ']';
  let depth = 0;
  let inString = false;
  for (let i = start; i < body.length; i++) {
    const ch = body[i];
    if (inString) {
      if (ch === '\\') i++;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === open) depth++;
    else if (ch === close && --depth === 0) return JSON.parse(body.slice(start, i + 1)) as T;
  }
  throw new Error(`unterminated JSON in answer: ${text.slice(0, 200)}`);
}

/**
 * Ask for JSON, re-asking with the parse error up to twice. A stage that still
 * gets no usable JSON takes `fallback`, logs a warning and the dive goes on.
 */
export async function askJson<T>(prompt: string, opts: { step: string; uses?: LlmUse[]; warn: Warn }, fallback: T): Promise<T> {
  let ask_ = prompt;
  let lastErr = '';
  for (let round = 0; round < 3; round++) {
    try {
      return parseJson<T>(await ask(ask_, { ...opts, step: round ? `${opts.step}:retry${round}` : opts.step }));
    } catch (err) {
      lastErr = (err as Error).message;
      if (/^LLM failed/.test(lastErr)) break;
      ask_ = `${prompt}\n\nYour previous answer could not be parsed (${lastErr.slice(0, 200)}). Answer again with only the complete JSON.`;
    }
  }
  await opts.warn(`${opts.step}: no usable answer (${lastErr.slice(0, 200)}); carrying on with a fallback`);
  return fallback;
}

// ---------------------------------------------------------------- helpers

/** The company name without a website in brackets after it. */
export function plainName(company: string): string {
  return company.replace(/\s*\(https?:\/\/[^)]*\)\s*$/i, '').trim() || company.trim();
}

export function shortName(company: string): string {
  let name = company.trim();
  const suffix = /[\s,]+(sdn\.?\s*bhd\.?|bhd\.?|berhad|plt|pte\.?\s*ltd\.?|ltd\.?|limited|llc|inc\.?|corp(oration)?\.?|co\.?|enterprise)\s*$/i;
  while (suffix.test(name)) name = name.replace(suffix, '');
  return name.replace(/[.,\s]+$/, '') || company.trim();
}

/** The dedupe key for a URL: no www, fragment, tracking params or trailing slash. */
export function urlKey(raw: string): string {
  try {
    const u = new URL(raw.trim());
    u.hash = '';
    for (const p of [...u.searchParams.keys()]) {
      if (/^(utm_|fbclid$|gclid$|mc_|ref$|ref_src$)/i.test(p)) u.searchParams.delete(p);
    }
    const host = u.hostname.toLowerCase().replace(/^www\./, '');
    const path = u.pathname.replace(/\/+$/, '');
    return `${host}${path}${u.search}`;
  } catch {
    return raw.trim().toLowerCase();
  }
}

export function hostOf(raw: string): string {
  try { return new URL(raw).hostname.toLowerCase().replace(/^www\./, ''); } catch { return ''; }
}

type Lookup = (host: string) => Promise<unknown>;
const dnsLookup: Lookup = (host) => dns.promises.lookup(host);

/**
 * The official domains, checked. Triage lists every domain it saw the company use, stale ones
 * too: Signmastr's list was ["signmastr.com", "signmastr.com.my"], the first does not resolve, and
 * the company UID and every dive-deeper lane took it. A domain that does not resolve is dropped;
 * the site triage picked to read comes first, then the domains most sources sit on. If none
 * resolves (DNS itself down), the list is kept as it was.
 */
export async function liveDomains(domains: string[], mapDomain: string, urls: string[], lookup: Lookup = dnsLookup): Promise<string[]> {
  const norm = (d: string) => hostOf('https://' + String(d).trim().replace(/^https?:\/\//i, ''));
  const all = [...new Set([mapDomain, ...domains].map(norm).filter(Boolean))];
  const ok = await Promise.all(all.map((d) => Promise.race([
    lookup(d).then(() => true, () => false),
    new Promise<boolean>((r) => setTimeout(() => r(false), 5_000).unref()),
  ])));
  const live = all.filter((_, i) => ok[i]);
  if (!live.length) return domains;
  const count = (d: string) => urls.filter((u) => { const h = hostOf(u); return h === d || h.endsWith('.' + d); }).length;
  return live.sort((a, b) => Number(b === mapDomain) - Number(a === mapDomain) || count(b) - count(a));
}

export class Ledger {
  sources: Source[] = [];
  private byKey = new Map<string, Source>();

  add(url: string, title: string, snippets: string[], found: string): Source {
    const key = urlKey(url);
    let s = this.byKey.get(key);
    if (!s) {
      s = { id: this.sources.length + 1, url, title, snippets: [], content: '', contentKind: 'none', found: [] };
      this.sources.push(s);
      this.byKey.set(key, s);
    }
    if (!s.title && title) s.title = title;
    for (const sn of snippets) if (sn && !s.snippets.includes(sn)) s.snippets.push(sn);
    if (!s.found.includes(found)) s.found.push(found);
    return s;
  }

  find(url: string): Source | undefined {
    return this.byKey.get(urlKey(url));
  }

  byId(id: number): Source | undefined {
    return this.sources[id - 1];
  }

  setContent(s: Source, text: string, kind: 'chunks' | 'page'): void {
    if (!text) return;
    if (kind === 'page' || s.contentKind !== 'page') {
      s.content = kind === 'chunks' && s.contentKind === 'chunks' ? `${s.content}\n…\n${text}` : text;
      s.contentKind = kind;
      delete s.failed;
    }
  }
}

function clip(text: string, max: number): string {
  const t = text.replace(/\n{3,}/g, '\n\n').trim();
  return t.length <= max ? t : t.slice(0, max) + ' …[cut]';
}

/** The material the model reads: page text first, then chunks, then bare snippets, under one size cap. */
export function corpus(sources: Source[], maxChars: number): string {
  const rank = (s: Source) => (s.contentKind === 'page' ? 0 : s.contentKind === 'chunks' ? 1 : 2);
  const parts: string[] = [];
  let total = 0;
  for (const s of [...sources].sort((a, b) => rank(a) - rank(b) || a.id - b.id)) {
    const body = s.contentKind === 'page' ? clip(s.content, 6_000)
      : s.contentKind === 'chunks' ? clip(s.content, 2_500)
      : clip(s.snippets.join(' | '), 700);
    if (!body) continue;
    const block = `### [${s.id}] ${s.title}\nURL: ${s.url}\n${body}\n`;
    if (total + block.length > maxChars) continue;
    parts.push(block);
    total += block.length;
  }
  return parts.join('\n');
}

function ids(list: unknown, ledger: Ledger): number[] {
  return Array.isArray(list) ? [...new Set(list.map(Number).filter((n) => ledger.byId(n)))] : [];
}

function cleanFacts(list: unknown, ledger: Ledger): Fact[] {
  if (!Array.isArray(list)) return [];
  return list
    .filter((f) => f && typeof f.fact === 'string' && f.fact.trim())
    .map((f) => ({
      topic: TOPICS.includes(f.topic) ? f.topic : 'identity',
      fact: String(f.fact).trim(),
      sources: ids(f.sources, ledger),
      confidence: (['high', 'medium', 'low'].includes(f.confidence) ? f.confidence : 'medium') as Fact['confidence'],
    }));
}

// ---------------------------------------------------------------- prompts

function triagePrompt(company: string, country: string, ledger: Ledger, t1Answer: string): string {
  const rows = ledger.sources.map((s) =>
    `[${s.id}] ${s.title} | ${s.url} | found by: ${s.found.join(', ')} | text: ${s.contentKind === 'none' ? 'no' : 'yes'}\n    ${clip(s.snippets.join(' | '), 400)}`,
  ).join('\n');
  return `You are the research lead for a company due-diligence dossier.
Target company: "${company}" (${country}).

Below are search results from Brave and Tavily. Many are about other companies with similar names. Work out which ones are about the target. Use hard anchors: registration number, address, official domains, industry. Then decide what to read next.

Tavily's own summary (machine-written, unverified): ${t1Answer || '(none)'}

RESULTS
${rows}

Answer with ONLY this JSON:
{
  "identity": {"legal_name": "", "aliases": ["trade names, other-language names"], "registration_numbers": [], "address": "", "official_domains": ["domains the company itself runs"], "industry": "", "summary": "one sentence"},
  "relevant_ids": [ids that are about the target company],
  "map_domain": "the company's main official domain to crawl for its site structure, or null",
  "extract_ids": [up to 20 relevant ids with text: no, most informative first. Skip facebook, instagram, linkedin, tiktok, x, ctoscredit, dnb and bloomberg: those block reading, and their snippets already count. Skip pages on map_domain, which get picked after the site map],
  "gaps": ["important things about the company nothing above answers yet"]
}`;
}

function pickPagesPrompt(company: string, identity: Identity, urls: string[], max: number): string {
  return `Company: "${company}" — ${identity.summary ?? ''}
These URLs are from the company's own website. Pick up to ${max} that tell the most about the company itself: about/profile, services and products, projects and case studies, clients, team and leadership, locations and agents, contact, FAQ, pricing, awards. Skip generic industry news and blog posts that are not about the company, and duplicates (?format= variants, pagination).

${urls.map((u) => '- ' + u).join('\n')}

Answer with ONLY JSON: {"urls": ["..."]}`;
}

function analysePrompt(company: string, country: string, identity: Identity, gaps: string[], material: string, maxSearches: number): string {
  return `You are writing a due-diligence dossier on "${company}" (${country}).
Known identity: ${JSON.stringify(identity)}
Open questions from triage: ${JSON.stringify(gaps)}

SOURCE MATERIAL (each block starts with [id]):
${material}

Tasks:
1. Extract every useful fact about the target company. Each fact cites the [id]s it came from. Do not use outside knowledge. Ignore material about other companies with similar names.
2. Note contradictions between sources, such as different addresses, founding dates or headcounts.
3. List what an investor, partner or competitor would still want to know.
4. Plan up to ${maxSearches} web searches that would close the biggest gaps. Make each query specific: use the exact name, aliases or registration number. Set include_domains when one site is the obvious place (e.g. linkedin.com for people, a government registry, a forum for reviews). Use topic "news" with time_range "year" for recent news. Do not repeat what the material already answers.

Topics: ${TOPICS.join(', ')}.

Answer with ONLY this JSON:
{
  "facts": [{"topic": "", "fact": "", "sources": [ids], "confidence": "high|medium|low"}],
  "contradictions": [""],
  "gaps": [""],
  "searches": [{"query": "", "purpose": "", "topic": "general|news", "include_domains": [], "time_range": null}]
}`;
}

function reflectPrompt(company: string, identity: Identity, facts: Fact[], gaps: string[], material: string, maxCalls: number, readable: string): string {
  return `Dossier on "${company}". Identity: ${JSON.stringify(identity)}
Facts so far (${facts.length}): ${JSON.stringify(facts.map((f) => [f.topic, f.fact]))}
Open gaps: ${JSON.stringify(gaps)}

NEW MATERIAL from gap-filling searches (each block starts with [id]):
${material}

Tasks:
1. Extract new facts from the NEW MATERIAL only. Cite [id]s. Skip anything already in the facts list. Ignore other companies with similar names.
2. Say which gaps are still open.
3. ${maxCalls > 0 ? `You may spend up to ${maxCalls} more calls, but only on gaps worth it. A call is either a search ({"kind":"search","query":"","topic":"general|news","include_domains":[],"time_range":null}) or a page read ({"kind":"extract","ids":[up to 20 ids]}). These ids have not been read yet and can be extracted: ${readable || '(none)'}. Return [] if nothing is worth it.` : 'No calls are left. Return "next": [].'}

Answer with ONLY this JSON:
{"facts": [{"topic": "", "fact": "", "sources": [ids], "confidence": "high|medium|low"}], "gaps": [""], "next": []}`;
}

function factsPrompt(company: string, facts: Fact[], material: string): string {
  return `Dossier on "${company}". Facts so far: ${JSON.stringify(facts.map((f) => [f.topic, f.fact]))}

NEW MATERIAL (each block starts with [id]):
${material}

Extract new facts about "${company}" from the NEW MATERIAL only. Cite [id]s and skip anything already known.
Answer with ONLY JSON: {"facts": [{"topic": "", "fact": "", "sources": [ids], "confidence": "high|medium|low"}], "gaps_closed": [""]}`;
}

function dossierPrompt(company: string, country: string, identity: Identity, facts: Fact[], contradictions: string[], gaps: string[], sourceIndex: string): string {
  return `Write a company due-diligence dossier in Markdown on "${company}" (${country}).
Use ONLY the facts below. Cite each claim with its source ids in square brackets, like [3] or [3][7]. Write in clear, plain English for a business reader. Use tables where they help (people, projects, registrations). Say plainly when something is unknown.

Identity: ${JSON.stringify(identity)}
Facts: ${JSON.stringify(facts)}
Contradictions between sources: ${JSON.stringify(contradictions)}
Still unknown: ${JSON.stringify(gaps)}

Sources:
${sourceIndex}

Sections, in order (skip one only if nothing at all is known):
# ${identity.legal_name || company}
A 3–5 sentence summary at the top.
## Identity and registration
## Ownership and people
## Products and services
## Projects and clients
## Footprint and size
## Reputation and reviews
## News and timeline
## Competitors and positioning
## Digital presence
## Risks and red flags
## Open questions
Do not add a source list; it is shown separately.`;
}

/** Step 1's Brave queries: these eight always, then the country pack's extras (countries.ts) after them. */
export function discoveryQueries(company: string, short: string, country: string, pack: countries.Pack | null): Array<[string, string, 'web' | 'news']> {
  const q = `"${short}"`;
  return [
    ['exact', `"${company}"`, 'web'],
    ['country', `${q} ${country}`, 'web'],
    ['facebook', `${q} site:facebook.com`, 'web'],
    ['linkedin', `${q} site:linkedin.com`, 'web'],
    ['reviews', `${q} review OR complaint OR scam`, 'web'],
    ['people', `${q} founder OR director OR CEO OR owner`, 'web'],
    ['projects', `${q} project OR client OR award OR partnership`, 'web'],
    ['news', q, 'news'],
    ...countries.discoverQueries(pack, { company, short, country }),
  ];
}

// ---------------------------------------------------------------- the dive

/** What a dive has spent so far; a failed dive's error carries it as `stats`. */
export type DiveStats = { tavily: TavilyCall[]; llmCalls: number; braveCalls: number };

/** Runs beside the research once the facts are in (the people step); its answer is saved as result.people. */
export type Alongside = (identity: Identity, facts: Fact[]) => Promise<unknown>;
type DiveOut = { result: DiveResult; writeDossier: () => Promise<string> };

export async function run(company: string, country: string, progress: Progress, alongside?: Alongside): Promise<DiveOut> {
  const budget = new Budget();
  const uses: LlmUse[] = [];
  const counts = { brave: 0, braveLog: [] as ApiCall[] };
  try {
    return await dive(company, country, progress, budget, uses, counts, alongside);
  } catch (err) {
    const stats: DiveStats = { tavily: budget.calls, llmCalls: uses.length, braveCalls: counts.brave };
    throw Object.assign(err as Error, { stats });
  }
}

async function dive(asked: string, country: string, progress: Progress, budget: Budget, uses: LlmUse[], counts: { brave: number; braveLog: ApiCall[] }, alongside?: Alongside): Promise<DiveOut> {
  // A website after the name ("Acme Sdn Bhd (https://acme.my/)") is there for the company UID; searched
  // as part of the name it made Brave's exact, country, Facebook and LinkedIn queries come back empty.
  const company = plainName(asked);
  const short = shortName(company);
  // A country pack (countries.ts) only adds: without one every line below is what it always was.
  const { pack, note: packNote } = countries.forCountry(country);
  const known = COUNTRY_CODES[country.trim().toLowerCase()];
  // Brave refuses every query with a country it does not know (SG, TH, VN), so such a code is dropped.
  const cc = countries.braveCountry(pack?.search.brave_country ?? known);
  const tavilyCountry = pack?.search.tavily_country ?? (known ? country.trim().toLowerCase() : undefined);
  const isWalled = (host: string) => WALLED.test(host) || countries.walled(pack, host);
  const ledger = new Ledger();

  const say = async (stage: string, msg: string) => { await progress(stage, msg); };
  const warnings: string[] = [];
  const warn: Warn = async (msg) => { warnings.push(msg); await say('warn', msg); };
  const T = (path: 'search' | 'extract' | 'map', body: Record<string, unknown>, label: string) =>
    budgetedCall(budget, path, body, label);
  /** A Tavily search, or the same query on Exa when Tavily fails; throws only when both did. */
  const search = async (body: Record<string, unknown>, label: string): Promise<Record<string, any>> => {
    try {
      return await T('search', body, label);
    } catch (err) {
      if (err instanceof BudgetSpent) throw err;
      try {
        const hits = await exa.search(String(body.query), { numResults: Number(body.max_results ?? 8), timeoutMs: 45_000, what: label,
          ...(Array.isArray(body.include_domains) ? { includeDomains: body.include_domains as string[] } : {}) });
        await say(label.startsWith('T1 ') ? 'discover' : 'fill', `${label}: Tavily failed (${(err as Error).message.slice(0, 120)}); Exa answered`);
        return { results: hits.map((h) => ({ url: h.url, title: h.title, content: h.content })) };
      } catch (err2) {
        throw new Error(`Tavily: ${(err as Error).message.slice(0, 150)} | Exa: ${(err2 as Error).message.slice(0, 150)}`);
      }
    }
  };

  const addSearchResults = (out: Record<string, any>, found: string) => {
    for (const r of out.results ?? []) {
      const s = ledger.add(String(r.url), String(r.title ?? ''), [], found);
      if (r.raw_content) ledger.setContent(s, String(r.raw_content), 'page');
      else if (r.content) ledger.setContent(s, String(r.content), 'chunks');
    }
  };

  const addExtractResults = (out: Record<string, any>, found: string) => {
    for (const r of out.results ?? []) {
      const s = ledger.find(String(r.url)) ?? ledger.add(String(r.url), '', [], found);
      if (!s.found.includes(found)) s.found.push(found);
      ledger.setContent(s, String(r.raw_content ?? ''), 'page');
    }
    for (const f of out.failed_results ?? []) {
      const s = ledger.find(String(f.url));
      if (s && s.contentKind === 'none') s.failed = String(f.error ?? 'failed');
    }
  };

  // 1. discover -----------------------------------------------------------
  if (packNote) await say('discover', packNote);
  await say('discover', `Brave sweep for "${company}" (short name "${short}")`);
  const braveQueries = discoveryQueries(company, short, country, pack);
  // All eight at once; the results join the ledger in query order, so source ids stay stable.
  // A Brave query that fails is asked of Exa; only both failing is a warning.
  const braveOut = await Promise.all(braveQueries.map(([label, query, kind]) =>
    brave.search(query, { country: cc, kind, onCall: (c) => counts.braveLog.push({ ...c, what: `${label}: ${c.what}` }) })
      .then((hits) => ({ label, query, hits, err: null }), (err: Error) => ({ label, query, hits: [], err }))));
  for (const { label, query, hits, err } of braveOut) {
    if (err) {
      try {
        const got = await exa.search(query, { numResults: 10, timeoutMs: 45_000, what: `brave fallback ${label}` });
        for (const h of got) ledger.add(h.url, h.title, h.content ? [h.content] : [], `exa:${label}`);
        await say('discover', `Brave ${label} failed (${err.message.slice(0, 120)}); Exa: ${got.length} results`);
      } catch (err2) {
        await warn(`discovery search ${label} failed on Brave and Exa: ${err.message.slice(0, 120)} | ${(err2 as Error).message.slice(0, 120)}`);
      }
      continue;
    }
    counts.brave++;
    for (const h of hits) ledger.add(h.url, h.title, h.snippets, `brave:${label}`);
    await say('discover', `Brave ${label}: ${hits.length} results`);
  }

  let t1Answer = '';
  try {
    const out = await search({
      query: `${company} ${country} company profile`,
      search_depth: 'advanced', max_results: 20, include_answer: 'advanced', include_raw_content: 'markdown',
      ...(tavilyCountry ? { country: tavilyCountry } : {}),
    }, 'T1 big picture');
    t1Answer = String(out.answer ?? '');
    addSearchResults(out, 'tavily:T1');
    await say('discover', `Tavily T1: ${(out.results ?? []).length} results; ${ledger.sources.length} unique URLs in total`);
  } catch (err) {
    await warn(`T1 big picture search failed: ${(err as Error).message}`);
  }
  // Nothing found while every engine answered is the company's answer; found nothing because engines failed is worth another try.
  if (!ledger.sources.length) throw Object.assign(new Error('Discovery found nothing: no Brave, Exa or Tavily results'), { retryable: warnings.length > 0 });

  // 2. triage -------------------------------------------------------------
  await say('triage', `LLM triage of ${ledger.sources.length} URLs`);
  const tri = await askJson<{ identity?: Identity; relevant_ids?: unknown; map_domain?: string | null; extract_ids?: unknown; gaps?: string[] }>(
    countries.withNotes(pack, 'triage', triagePrompt(company, country, ledger, t1Answer)), { step: 'triage', uses, warn },
    { relevant_ids: ledger.sources.map((s) => s.id), map_domain: null, extract_ids: [], gaps: [] });
  const identity: Identity = tri.identity ?? {};
  const relevant = new Set(ids(tri.relevant_ids, ledger));
  let gaps: string[] = Array.isArray(tri.gaps) ? tri.gaps.map(String) : [];
  const mapDomain = typeof tri.map_domain === 'string' && tri.map_domain.trim() ? hostOf('https://' + tri.map_domain.replace(/^https?:\/\//, '')) : '';
  const named = identity.official_domains ?? [];
  identity.official_domains = await liveDomains(named, mapDomain, ledger.sources.map((s) => s.url));
  const dropped = named.filter((d) => !identity.official_domains!.includes(hostOf('https://' + String(d).replace(/^https?:\/\//i, ''))));
  if (dropped.length) await say('triage', `Dropped official domain(s) that do not resolve: ${dropped.join(', ')}`);
  const thirdParty = ids(tri.extract_ids, ledger)
    .map((id) => ledger.byId(id)!)
    .filter((s) => s.contentKind === 'none' && !isWalled(hostOf(s.url)) && (!mapDomain || hostOf(s.url) !== mapDomain))
    .slice(0, 20);
  await say('triage', `${relevant.size} URLs are about the company; official site ${mapDomain || 'unknown'}; ${thirdParty.length} pages to read`);

  // 3. read ---------------------------------------------------------------
  let ownPages: string[] = [];
  if (mapDomain) {
    let mapped: string[] = [];
    try {
      const out = await T('map', { url: 'https://' + mapDomain, max_depth: 2, limit: 50 }, 'T2 site map');
      mapped = [...new Set((out.results ?? []).map(String))] as string[];
    } catch (err) {
      await say('read', `Tavily T2 failed: ${(err as Error).message}`);
    }
    // /map sometimes answers with no pages for a site it mapped fine an hour
    // earlier. The official pages discovery already found are the fallback.
    if (!mapped.length) {
      const official = new Set([mapDomain, ...(identity.official_domains ?? []).map((d) => hostOf('https://' + String(d).replace(/^https?:\/\//, '')))]);
      mapped = ledger.sources.filter((s) => official.has(hostOf(s.url))).map((s) => s.url);
    }
    const unread = mapped.filter((u) => (ledger.find(u)?.contentKind ?? 'none') === 'none');
    await say('read', `Tavily T2: ${mapped.length} official pages, ${unread.length} not read yet`);
    if (unread.length) {
      const pick = await askJson<{ urls?: string[] }>(pickPagesPrompt(company, identity, unread.slice(0, 150), 15), { step: 'pick-pages', uses, warn },
        { urls: [...unread].sort((x, y) => x.length - y.length).slice(0, 15) });
      const allowed = new Set(unread.map(urlKey));
      ownPages = (pick.urls ?? []).filter((u) => allowed.has(urlKey(u))).slice(0, 20);
    }
  }
  for (const u of ownPages) relevant.add(ledger.add(u, '', [], 'tavily:T2').id);

  await Promise.all([
    ownPages.length && T('extract', { urls: ownPages, extract_depth: 'advanced', format: 'markdown' }, 'T3 official pages')
      .then((out) => {
        addExtractResults(out, 'tavily:T3');
        // Without one page of the company's own site the dossier would be written from third parties only.
        if (!(out.results ?? []).length) {
          return warn(`none of the ${ownPages.length} official pages could be read: ${String(out.failed_results?.[0]?.error ?? 'no reason given').slice(0, 160)}`);
        }
        return say('read', `Tavily T3: read ${(out.results ?? []).length} of ${ownPages.length} official pages`);
      })
      .catch((err) => warn(`reading the official pages failed: ${err.message}`)),
    thirdParty.length && T('extract', { urls: thirdParty.map((s) => s.url), extract_depth: 'advanced', format: 'markdown' }, 'T4 third-party pages')
      .then((out) => { addExtractResults(out, 'tavily:T4'); return say('read', `Tavily T4: read ${(out.results ?? []).length} of ${thirdParty.length} third-party pages`); })
      .catch((err) => warn(`reading the third-party pages failed: ${err.message}`)),
  ]);

  // 4. analyse ------------------------------------------------------------
  const relevantSources = () => ledger.sources.filter((s) => relevant.has(s.id));
  const maxSearches = Math.max(0, Math.min(8, budget.left - 4));
  await say('analyse', `LLM analysis of ${relevantSources().length} sources`);
  const ana = await askJson<{ facts?: unknown; contradictions?: string[]; gaps?: string[]; searches?: Array<Record<string, any>> }>(
    countries.withNotes(pack, 'analyse', analysePrompt(company, country, identity, gaps, corpus(relevantSources(), 120_000), maxSearches)), { step: 'analyse', uses, warn },
    { facts: [], contradictions: [], gaps, searches: gaps.slice(0, maxSearches).map((g) => ({ query: `"${company}" ${g}` })) });
  let facts = cleanFacts(ana.facts, ledger);
  const contradictions = Array.isArray(ana.contradictions) ? ana.contradictions.map(String) : [];
  gaps = Array.isArray(ana.gaps) ? ana.gaps.map(String) : gaps;
  const searches = (ana.searches ?? []).filter((s) => s && typeof s.query === 'string' && s.query.trim()).slice(0, maxSearches);
  await say('analyse', `${facts.length} facts, ${gaps.length} gaps, ${searches.length} searches planned`);
  // The people step needs only the identity and these facts, so it runs beside the gap searches and reflection.
  const people = alongside?.(identity, facts).catch(async (err: Error) => { await warn(`people: ${err.message}`); return undefined; });

  // 5. fill gaps ----------------------------------------------------------
  const before = new Set(ledger.sources.map((s) => s.id));
  const summaries: string[] = [];
  const gapSearch = async (s: Record<string, any>, label: string) => {
    const body: Record<string, unknown> = {
      query: String(s.query), search_depth: 'advanced', max_results: 8, chunks_per_source: 3, include_answer: 'basic',
      topic: s.topic === 'news' ? 'news' : 'general',
    };
    if (Array.isArray(s.include_domains) && s.include_domains.length) body.include_domains = s.include_domains.map(String).slice(0, 10);
    if (['day', 'week', 'month', 'year'].includes(s.time_range)) body.time_range = s.time_range;
    if (tavilyCountry && body.topic === 'general' && !body.include_domains) body.country = tavilyCountry;
    const out = await search(body, `${label} ${String(s.query).slice(0, 60)}`);
    addSearchResults(out, `tavily:${label}`);
    if (out.answer) summaries.push(`Search "${s.query}" summary (machine-written, unverified): ${out.answer}`);
    return (out.results ?? []).length;
  };
  for (let i = 0; i < searches.length; i += 3) {
    await Promise.all(searches.slice(i, i + 3).map((s, j) => {
      const label = `T${budget.used + 1 + j}`;
      return gapSearch(s, label)
        .then((n) => say('fill', `${label} "${s.query}": ${n} results`))
        .catch((err) => (err instanceof BudgetSpent ? say('fill', `${label} skipped: ${err.message}`) : warn(`gap search "${s.query}" failed: ${err.message}`)));
    }));
  }
  // Everything the gap searches returned is in scope: the queries were about this company.
  const fresh = ledger.sources.filter((s) => !before.has(s.id) || s.found.some((f) => f.startsWith('tavily:T') && !/^tavily:T[1-4]$/.test(f)));
  for (const s of fresh) relevant.add(s.id);

  // 6. reflect ------------------------------------------------------------
  const reserve = Math.max(0, budget.left - 1);
  const readable = relevantSources().filter((s) => s.contentKind === 'none' && !isWalled(hostOf(s.url)) && !s.failed).map((s) => s.id).join(', ');
  await say('reflect', `LLM reflection on ${fresh.length} new sources; ${reserve} reserve calls available`);
  const ref = await askJson<{ facts?: unknown; gaps?: string[]; next?: Array<Record<string, any>> }>(
    countries.withNotes(pack, 'reflect', reflectPrompt(company, identity, facts, gaps, corpus(fresh, 80_000) + '\n' + summaries.join('\n'), reserve, readable)), { step: 'reflect', uses, warn },
    { facts: [], gaps, next: [] });
  facts = facts.concat(cleanFacts(ref.facts, ledger));
  gaps = Array.isArray(ref.gaps) ? ref.gaps.map(String) : gaps;
  const next = (ref.next ?? []).slice(0, reserve);
  if (next.length) {
    const beforeReserve = new Set(ledger.sources.map((s) => `${s.id}:${s.contentKind}`));
    for (const n of next) {
      const label = `T${budget.used + 1}`;
      try {
        if (n.kind === 'extract') {
          const urls = ids(n.ids, ledger).map((id) => ledger.byId(id)!).filter((s) => s.contentKind === 'none').map((s) => s.url).slice(0, 20);
          if (!urls.length) continue;
          const out = await T('extract', { urls, extract_depth: 'advanced', format: 'markdown' }, `${label} reserve read`);
          addExtractResults(out, `tavily:${label}`);
          await say('reflect', `${label} read ${(out.results ?? []).length} of ${urls.length} pages`);
        } else if (typeof n.query === 'string') {
          const got = await gapSearch(n, label);
          await say('reflect', `${label} "${n.query}": ${got} results`);
        }
      } catch (err) {
        if (err instanceof BudgetSpent) break;
        await warn(`reserve call ${label} failed: ${(err as Error).message}`);
      }
    }
    const reserveNew = ledger.sources.filter((s) => !beforeReserve.has(`${s.id}:${s.contentKind}`) && s.contentKind !== 'none');
    for (const s of reserveNew) relevant.add(s.id);
    if (reserveNew.length) {
      const extra = await askJson<{ facts?: unknown }>(countries.withNotes(pack, 'facts', factsPrompt(company, facts, corpus(reserveNew, 80_000))), { step: 'reserve-facts', uses, warn }, { facts: [] });
      facts = facts.concat(cleanFacts(extra.facts, ledger));
    }
  }

  if (people) await say('people', 'Waiting for the people step');
  const peopleFound = await people;

  // 7. write --------------------------------------------------------------
  // Only the paid report's appendix shows the write-up, so the caller saves the research first
  // (the preview starts from it) and writes the dossier after.
  const writeDossier = async (): Promise<string> => {
    const cited = new Set(facts.flatMap((f) => f.sources));
    const sourceIndex = ledger.sources.filter((s) => cited.has(s.id)).map((s) => `[${s.id}] ${s.title || hostOf(s.url)} — ${s.url}`).join('\n');
    await say('write', `Writing the dossier from ${facts.length} facts and ${cited.size} cited sources`);
    let prompt = countries.withNotes(pack, 'write', dossierPrompt(company, country, identity, facts, contradictions, gaps, sourceIndex));
    // With no facts (analysis fell back), the dossier reads the material itself.
    if (!facts.length) prompt += `\n\nNo facts were extracted, so write from this material instead, citing its [id]s:\n${corpus(relevantSources(), 100_000)}`;
    let dossier = '';
    let lastErr: unknown = null;
    for (let t = 1; t <= 3 && !dossier; t++) {
      try {
        dossier = await ask(prompt, { step: t > 1 ? `dossier:retry${t - 1}` : 'dossier', uses });
      } catch (err) {
        lastErr = err;
        if (t < 3) { await say('write', `dossier try ${t} failed: ${(err as Error).message.slice(0, 160)}`); await new Promise((r) => setTimeout(r, t * 60_000)); }
      }
    }
    if (!dossier) {
      const err = lastErr as Error;
      // The writing failed, not the research: the collected facts are the output.
      await warn(`dossier: ${(err as Error).message}; the facts are shown instead`);
      const sections = TOPICS.map((t) => {
        const rows = facts.filter((f) => f.topic === t);
        if (!rows.length) return '';
        return `## ${t.replace(/_/g, ' ')}\n` + rows.map((f) => `- ${f.fact} ${f.sources.map((n) => `[${n}]`).join('')}`).join('\n') + '\n';
      });
      dossier = `# ${identity.legal_name || company}\n\nThe dossier could not be written this run. These are the facts collected, with their sources.\n\n${sections.join('\n')}`;
    }
    return stripThinking(dossier).replace(/^```(?:markdown)?\s*|\s*```$/g, '');
  };

  const result: DiveResult = {
    identity,
    facts,
    contradictions,
    gaps,
    sources: ledger.sources.map(({ content, snippets, ...rest }) => ({ ...rest, relevant: relevant.has(rest.id) })),
    tavily: budget.calls,
    llm: uses,
    braveCalls: counts.brave,
    brave: counts.braveLog,
    warnings,
    ...(peopleFound ? { people: peopleFound } : {}),
  };
  await say('done', `Tavily ${budget.used}/${budget.max} calls, ${budget.credits} credits; Brave ${counts.brave}; LLM ${uses.length} calls`);
  return { result, writeDossier };
}
