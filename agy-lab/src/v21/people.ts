// V2.1 Step 1.6: people and contacts linked to the company. Gathering only (docs/v21-people-step-plan.md).
// Reads the Step 1 checkpoint, searches in rounds until nothing new, and saves every call with what came back
// plus the names and contacts read from the results. It never decides who is really linked: Step 2 does that.
// Paid APIs are used for web search only. Any tool failing is one recorded line; the step always saves its output.
// Call set trimmed after the Eternalgy prod test (docs/reports/v21-people-eternalgy-2026-11-10.md): 4 broad searches,
// Exa web per new name, and a free worker read of the company's own llms.txt and PDFs. No Brave, no assistants.
import { exa, tavily } from '../core/index.ts';
import { toHit } from '../companydive-people.ts';
import { readWebPage } from './reader.ts';
import { askLanes } from './judge.ts';

export type Hit = { url: string; title: string; text: string };
export type PeopleCall = {
  id: string; round: number; tool: 'step1-pages' | 'own-site' | 'exa-people' | 'exa-web' | 'tavily';
  query: string; why: string; hits: Hit[]; ms: number; usd?: number; error?: string;
};
export type Mention = { call: string; hit: number; url: string; name: string; role: string; contact: string; quote: string };
export type Step1_6_PeopleOutput = {
  version: '2.1'; stage: 1.6; created_at: string; finished_at?: string;
  input: { company: string; country: string; industry: string; website?: string };
  status: 'done' | 'partial' | 'failed'; error?: string;
  brand: string[];
  calls: PeopleCall[];
  mentions: Mention[];
  reads: Array<{ call: string; ms: number; lane?: string; error?: string; cut_off?: boolean }>;
  not_searched: { names: string[]; contacts: string[] };
  log: string[];
};

const MAX_NAMES = 8;
const MAX_ROUNDS = 3;
const MAX_OWN_PDFS = 3;
const clean = (v: unknown, n: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const hostLabel = (u: string) => { try { return new URL(/^https?:/.test(u) ? u : 'https://' + u).hostname.replace(/^www\./, '').split('.')[0] ?? ''; } catch { return ''; } };

export function brandTokens(company: string, website?: string): string[] {
  const first = clean(company, 200).replace(/\(.*?\)/g, '').toLowerCase().replace(/\b(sdn\.?\s*bhd\.?|pte\.?\s*ltd\.?|pty\.?\s*ltd\.?|bhd|ltd|plt|llp|inc|co\.?)\b/g, '').replace(/[^\p{L}\p{N}\s]/gu, ' ').trim().split(/\s+/)[0] ?? '';
  return [...new Set([first, website ? hostLabel(website).toLowerCase() : ''].filter((t) => t.length >= 3))];
}
/** Mechanical: does this hit carry the company's brand word? Decides only where to search next, never what a result means. */
const carriesBrand = (h: Hit, brand: string[]) => { const s = `${h.url} ${h.title} ${h.text}`.toLowerCase(); return brand.some((b) => s.includes(b)); };
export const normName = (s: string) => s.toLowerCase().replace(/\b(mr|ms|mrs|dr|ir|ts|dato'?|datuk|tan sri|encik|puan)\.?\s+/g, '').replace(/[^\p{L}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
export const normContact = (s: string) => /@/.test(s) ? s.toLowerCase().replace(/^%20/, '').trim() : s.replace(/\D/g, '').replace(/^60/, '0');

function json(text: string): any {
  const m = String(text ?? '').match(/\{[\s\S]*\}/);
  try { return m ? JSON.parse(m[0]) : {}; } catch { return {}; }
}

export async function runStep1_6People(checkpoint: any, say: (m: string) => void = () => {}, save: (o: Step1_6_PeopleOutput) => Promise<void> = async () => {}): Promise<Step1_6_PeopleOutput> {
  const input = checkpoint?.input ?? {};
  const company = clean(input.company, 200) || 'the company';
  const country = clean(input.country, 80);
  const industry = clean(input.industry, 120);
  const website = clean(input.website || checkpoint?.official_site?.resolved_url, 300) || undefined;
  const brand = brandTokens(company, website);
  const short = brand[0] ? brand[0].charAt(0).toUpperCase() + brand[0].slice(1) : company;
  const out: Step1_6_PeopleOutput = {
    version: '2.1', stage: 1.6, created_at: new Date().toISOString(), input: { company, country, industry, ...(website ? { website } : {}) },
    status: 'done', brand, calls: [], mentions: [], reads: [], not_searched: { names: [], contacts: [] }, log: [],
  };
  const log = (m: string) => { out.log.push(`${new Date().toISOString()} ${m}`); say(m); };
  const persist = async () => { try { await save(out); } catch (e) { say(`save failed: ${(e as Error).message}`); } };

  const run = async (id: string, round: number, tool: PeopleCall['tool'], query: string, why: string, fn: () => Promise<{ hits: Hit[]; usd?: number }>) => {
    const t = Date.now();
    try {
      const { hits, usd } = await fn();
      out.calls.push({ id, round, tool, query, why, hits: Array.isArray(hits) ? hits : [], ms: Date.now() - t, ...(usd ? { usd } : {}) });
      log(`${id} ${tool} "${query.slice(0, 90)}": ${hits.length} hits`);
    } catch (e) {
      out.calls.push({ id, round, tool, query, why, hits: [], ms: Date.now() - t, error: clean((e as Error)?.message ?? e, 300) });
      log(`${id} ${tool} failed: ${clean((e as Error)?.message ?? e, 200)}`);
    }
  };
  const exaPeople = (q: string) => async () => {
    const r = await exa.request('search', { query: q, type: 'auto', category: 'people', numResults: 25, userLocation: 'MY', contents: { highlights: { maxCharacters: 600 } } });
    return { usd: Number(r?.costDollars?.total ?? 0), hits: (Array.isArray(r?.results) ? r.results : []).map((x: any) => { const h = toHit(x); return { url: h.url, title: `${h.title}${h.name ? ' | profile: ' + h.name + (h.location ? ', ' + h.location : '') : ''}`, text: `${h.jobs.length ? 'jobs: ' + h.jobs.slice(0, 8).join('; ') + ' … ' : ''}${h.text}` }; }) };
  };
  const exaWeb = (q: string) => async () => {
    const r = await exa.request('search', { query: q, type: 'auto', numResults: 10, userLocation: 'MY', contents: { highlights: { maxCharacters: 900 } } });
    return { usd: Number(r?.costDollars?.total ?? 0), hits: (Array.isArray(r?.results) ? r.results : []).map((x: any) => ({ url: String(x?.url ?? ''), title: clean(x?.title, 160), text: clean([...(Array.isArray(x?.highlights) ? x.highlights : []), x?.text ?? ''].join(' … '), 2000) })) };
  };
  const tavilyQ = (q: string) => async () => ({ hits: (await tavily.search(q, { maxResults: 10, depth: 'advanced' })).map((h) => ({ url: h.url, title: h.title, text: clean(h.content, 2000) })) });
  /** Free worker reads of the company's own files that list people: llms.txt and PDFs the site links to. */
  const ownSite = async () => {
    let origin = '';
    try { origin = website ? new URL(/^https?:/.test(website) ? website : 'https://' + website).origin : ''; } catch { origin = ''; }
    if (!origin) throw new Error('no official website to read');
    const links = new Set<string>([origin + '/llms.txt']);
    for (const p of checkpoint?.official_site?.pages ?? []) {
      for (const m of String(p?.markdown ?? '').matchAll(/\]\(([^)\s]+\.pdf)\)/gi)) {
        try { const u = new URL(m[1]!, origin); if (u.origin === origin && links.size < MAX_OWN_PDFS + 1) links.add(u.href); } catch { /* not a URL */ }
      }
    }
    const hits: Hit[] = []; const failed: string[] = [];
    for (const url of links) {
      const r = await readWebPage(url).catch((e) => ({ status: 'error', markdown: '', error: String(e?.message ?? e) }) as any);
      if (r?.status === 'ok' && r.markdown) hits.push({ url, title: url.split('/').pop() ?? url, text: clean(r.markdown, 30000) });
      else failed.push(`${url}: ${clean(r?.error ?? r?.status, 120)}`);
    }
    if (failed.length) log(`own-site reads not done: ${failed.join(' | ')}`);
    return { hits };
  };

  /** Read names and contacts out of one call's hits (8 at a time), on the V2.1 lanes. No judging. Only hits that carry
   *  the brand word are read: the rest cost LLM time and, in the Eternalgy test, gave nothing new. */
  const read = async (call: PeopleCall) => {
    const toRead = call.hits.map((h, idx) => ({ h, n: idx + 1 })).filter(({ h }) => call.tool === 'step1-pages' || call.tool === 'own-site' || carriesBrand(h, brand));
    const size = call.tool === 'own-site' ? 1 : 8;
    for (let i = 0; i < toRead.length; i += size) {
      const part = toRead.slice(i, i + size);
      const block = part.map(({ h, n }) => `[${n}] ${h.title} | ${h.url}\n    ${clean(h.text, call.tool === 'own-site' ? 30000 : 3000)}`).join('\n');
      const prompt = `Results (each starts with [n]):\n${block}\n\nList every PERSON named in these results and every PHONE NUMBER or EMAIL ADDRESS in them, with the hit number, the person's role as written, and the exact words. A person and their contact on the same line go in one item. Copy; do not judge or leave out.\n\nAnswer ONLY JSON: {"items": [{"hit": 1, "name": "", "role": "", "contact": "", "quote": ""}]}`;
      const t = Date.now();
      try {
        const r = await askLanes([{ role: 'user', content: prompt }] as any, { accept: (txt) => { if (!Array.isArray(json(txt).items)) throw new Error('no items JSON'); } });
        out.reads.push({ call: call.id, ms: Date.now() - t, lane: r.lane, ...(r.cut_off ? { cut_off: true } : {}) });
        if (r.cut_off) log(`reading ${call.id}: answer cut off; its whole items are kept, the unfinished last one is lost`);
        for (const it of json(r.text).items ?? []) {
          if (!it || (!clean(it.name, 1) && !clean(it.contact, 1))) continue;
          const n = Number(it.hit);
          out.mentions.push({ call: call.id, hit: Number.isFinite(n) ? n : 0, url: call.hits[n - 1]?.url ?? '', name: clean(it.name, 120), role: clean(it.role, 160), contact: clean(it.contact, 120), quote: clean(it.quote, 300) });
        }
      } catch (e) {
        out.reads.push({ call: call.id, ms: Date.now() - t, error: clean((e as Error)?.message ?? e, 300) });
        log(`reading ${call.id} failed: ${clean((e as Error)?.message ?? e, 160)}`);
      }
    }
  };
  const readRound = async (round: number) => {
    const list = out.calls.filter((c) => c.round === round && c.hits.length);
    const q = [...list];
    await Promise.all(Array.from({ length: 4 }, async () => { while (q.length) await read(q.shift()!); }));
    await persist();
  };
  /** Names from search hits that carry the brand word (and Step 1 pages): the leads the next round searches. */
  const leads = () => {
    const names = new Map<string, string>();
    for (const m of out.mentions) {
      const call = out.calls.find((c) => c.id === m.call);
      const hit = call?.hits[m.hit - 1];
      // Names from the own-site files (e.g. an agent list in llms.txt) are saved but not searched one by one.
      if (!hit || call!.tool === 'own-site' || !(carriesBrand(hit, brand) || call!.tool === 'step1-pages')) continue;
      const n = normName(m.name); if (n && n.split(' ').length >= 2) names.set(n, m.name);
    }
    return { names };
  };

  try {
    // Round 0: what Step 1 already read (site pages and outside pages). No search cost.
    const step1Hits: Hit[] = [
      ...(checkpoint?.official_site?.pages ?? []).map((p: any) => ({ url: String(p?.url ?? ''), title: clean(p?.label, 80), text: clean(p?.markdown, 15000) })),
      ...(checkpoint?.third_party_pages ?? []).map((p: any) => ({ url: String(p?.url ?? ''), title: clean(p?.title, 160), text: clean(p?.markdown ?? p?.text ?? p?.content, 4000) })),
    ].filter((h) => h.text);
    out.calls.push({ id: 'S1', round: 0, tool: 'step1-pages', query: '(pages Step 1 read)', why: 'seed', hits: step1Hits, ms: 0 });
    await run('O1', 0, 'own-site', '(llms.txt and linked PDFs on the official site, free worker read)', 'own files that list people', ownSite);
    await readRound(0);

    // Round 1: the 4 broad searches that found the outside people in the Eternalgy test.
    const where = [industry, country].filter(Boolean).join(', ');
    await Promise.all([
      run('P1', 1, 'exa-people', `people who work at ${short}, ${where}`, 'staff profiles', exaPeople(`people who work at ${short}, ${where}`)),
      run('P2', 1, 'exa-people', `${company} founder director CEO`, 'leaders', exaPeople(`${company} founder director CEO`)),
      run('W1', 1, 'exa-web', `${company} director founder`, 'leaders on the web', exaWeb(`${company} director founder`)),
      run('T1', 1, 'tavily', `${company} ${country} founder news`, 'news', tavilyQ(`${company} ${country} founder news`)),
    ]);
    await readRound(1);

    // Rounds 2+: Exa web per new name from brand hits, up to MAX_NAMES per round.
    const searchedNames = new Set<string>();
    for (let round = 2; round <= MAX_ROUNDS + 1; round++) {
      const { names } = leads();
      const newNames = [...names.keys()].filter((n) => !searchedNames.has(n));
      if (!newNames.length) { log(`round ${round}: nothing new to search, stopping`); break; }
      if (round > MAX_ROUNDS) { out.not_searched.names.push(...newNames.map((n) => names.get(n)!)); log(`round limit reached; ${newNames.length} names left`); break; }
      const nameNow = newNames.slice(0, MAX_NAMES);
      out.not_searched.names.push(...newNames.slice(MAX_NAMES).map((n) => names.get(n)!));
      newNames.forEach((n) => searchedNames.add(n));
      log(`round ${round}: ${nameNow.length} names (${newNames.length - nameNow.length} left unsearched)`);
      await Promise.all(nameNow.map((n, i) => run(`R${round}N${i + 1}`, round, 'exa-web', `"${names.get(n)}" ${short}`, `name: ${names.get(n)}`, exaWeb(`"${names.get(n)}" ${short}`))));
      await readRound(round);
    }
  } catch (e) {
    out.status = 'partial';
    out.error = clean((e as Error)?.message ?? e, 500);
    log(`stopped early: ${out.error}`);
  }
  out.finished_at = new Date().toISOString();
  await persist();
  return out;
}
