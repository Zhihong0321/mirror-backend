// V2.1 Step 1.6: people and contacts linked to the company. Gathering only (docs/v21-people-step-plan.md).
// Reads the Step 1 checkpoint, searches in rounds until nothing new, and saves every call with what came back
// plus the names and contacts read from the results. It never decides who is really linked: Step 2 does that.
// Paid APIs are used for web search only. Any tool failing is one recorded line; the step always saves its output.
import { exa, brave, tavily } from '../core/index.ts';
import { toHit } from '../companydive-people.ts';
import { chat } from '../divedeeper/v21/myworker.ts';
import { liveHub } from '../divedeeper/sections/G-search.ts';
import { askLanes } from './judge.ts';

export type Hit = { url: string; title: string; text: string };
export type PeopleCall = {
  id: string; round: number; tool: 'step1-pages' | 'exa-people' | 'exa-web' | 'brave' | 'tavily' | 'chatgpt' | 'gemini';
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
  reads: Array<{ call: string; ms: number; lane?: string; error?: string }>;
  not_searched: { names: string[]; contacts: string[] };
  log: string[];
};

const MAX_NAMES = 16;
const MAX_CONTACTS = 10;
const MAX_ROUNDS = 4;
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
  const braveQ = (q: string) => async () => ({ hits: (await brave.search(q, { country: 'MY' })).map((h) => ({ url: h.url, title: h.title, text: (h.snippets ?? []).join(' … ') })) });
  const tavilyQ = (q: string) => async () => ({ hits: (await tavily.search(q, { maxResults: 10, depth: 'advanced' })).map((h) => ({ url: h.url, title: h.title, text: clean(h.content, 2000) })) });
  const assistantPrompt = `Who are the founders, directors, shareholders, managers, sales agents and staff of ${company}${website ? ` (${website})` : ''}, ${industry ? `a ${industry} ` : ''}in ${country}? List every person you can find, with their role and the URL where it is stated. Also list every phone number and email address tied to the company or to these people, with the URL. Say when you are unsure.`;
  const chatgptQ = () => async () => { const r = await chat(assistantPrompt); if ('error' in r) throw new Error(r.error); return { hits: [{ url: 'chatgpt-answer', title: 'ChatGPT answer', text: r.answer }] }; };
  const geminiQ = () => async () => { const hub = liveHub(); const w = await hub.workers(); if (!w.length) throw new Error('no Gemini worker online'); return { hits: [{ url: 'gemini-answer', title: 'Gemini answer', text: await hub.ask(assistantPrompt, w[0]!) }] }; };

  /** Read names and contacts out of one call's hits (8 at a time), on the V2.1 lanes. No judging. */
  const read = async (call: PeopleCall) => {
    for (let i = 0; i < call.hits.length; i += 8) {
      const part = call.hits.slice(i, i + 8);
      const block = part.map((h, j) => `[${i + j + 1}] ${h.title} | ${h.url}\n    ${clean(h.text, 3000)}`).join('\n');
      const prompt = `Results (each starts with [n]):\n${block}\n\nList every PERSON named in these results and every PHONE NUMBER or EMAIL ADDRESS in them, with the hit number, the person's role as written, and the exact words. A person and their contact on the same line go in one item. Copy; do not judge or leave out.\n\nAnswer ONLY JSON: {"items": [{"hit": 1, "name": "", "role": "", "contact": "", "quote": ""}]}`;
      const t = Date.now();
      try {
        const r = await askLanes([{ role: 'user', content: prompt }] as any, { accept: (txt) => { if (!Array.isArray(json(txt).items)) throw new Error('no items JSON'); } });
        out.reads.push({ call: call.id, ms: Date.now() - t, lane: r.lane });
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
  /** Names and contacts from hits that carry the brand word: the leads the next round searches. */
  const leads = () => {
    const names = new Map<string, string>(); const contacts = new Map<string, string>();
    for (const m of out.mentions) {
      const call = out.calls.find((c) => c.id === m.call);
      const hit = call?.hits[m.hit - 1];
      if (!hit || !(carriesBrand(hit, brand) || call!.tool === 'chatgpt' || call!.tool === 'gemini' || call!.tool === 'step1-pages')) continue;
      const n = normName(m.name); if (n && n.split(' ').length >= 2) names.set(n, m.name);
      const c = normContact(m.contact); if (c.length >= 7 && c.length <= 60) contacts.set(c, m.contact);
    }
    return { names, contacts };
  };

  try {
    // Round 0: what Step 1 already read (site pages and outside pages). No search cost.
    const step1Hits: Hit[] = [
      ...(checkpoint?.official_site?.pages ?? []).map((p: any) => ({ url: String(p?.url ?? ''), title: clean(p?.label, 80), text: clean(p?.markdown, 15000) })),
      ...(checkpoint?.third_party_pages ?? []).map((p: any) => ({ url: String(p?.url ?? ''), title: clean(p?.title, 160), text: clean(p?.markdown ?? p?.text ?? p?.content, 4000) })),
    ].filter((h) => h.text);
    out.calls.push({ id: 'S1', round: 0, tool: 'step1-pages', query: '(pages Step 1 read)', why: 'seed', hits: step1Hits, ms: 0 });
    await readRound(0);

    // Round 1: broad, every tool at once.
    const where = [industry, country].filter(Boolean).join(', ');
    await Promise.all([
      run('P1', 1, 'exa-people', `people who work at ${short}, ${where}`, 'broad', exaPeople(`people who work at ${short}, ${where}`)),
      run('P2', 1, 'exa-people', `${company} founder director CEO`, 'leaders', exaPeople(`${company} founder director CEO`)),
      run('P3', 1, 'exa-people', `${short} sales consultant agent ${country}`, 'sales', exaPeople(`${short} sales consultant agent ${country}`)),
      run('P4', 1, 'exa-people', `${short} engineer technician project manager ${country}`, 'staff', exaPeople(`${short} engineer technician project manager ${country}`)),
      run('W1', 1, 'exa-web', `${company} director founder`, 'leaders on the web', exaWeb(`${company} director founder`)),
      run('W2', 1, 'exa-web', `${short} ${country} CEO interview`, 'press', exaWeb(`${short} ${country} CEO interview`)),
      run('B1', 1, 'brave', `"${company}" director OR founder OR CEO`, 'leaders on the web', braveQ(`"${company}" director OR founder OR CEO`)),
      run('B2', 1, 'brave', `"${short}" ${industry} ${country}`, 'broad web', braveQ(`"${short}" ${industry} ${country}`)),
      run('T1', 1, 'tavily', `${company} ${country} founder news`, 'news', tavilyQ(`${company} ${country} founder news`)),
      run('C1', 1, 'chatgpt', 'who runs and works at the company', 'assistant lead', chatgptQ()),
      run('G1', 1, 'gemini', 'who runs and works at the company', 'assistant lead', geminiQ()),
    ]);
    await readRound(1);

    // Rounds 2+: each new name (Exa web + Exa people), each new contact (Brave, Exa web when Brave fails).
    const searchedNames = new Set<string>(); const searchedContacts = new Set<string>();
    for (let round = 2; round <= MAX_ROUNDS + 1; round++) {
      const { names, contacts } = leads();
      const newNames = [...names.keys()].filter((n) => !searchedNames.has(n));
      const newContacts = [...contacts.keys()].filter((c) => !searchedContacts.has(c));
      if (!newNames.length && !newContacts.length) { log(`round ${round}: nothing new to search, stopping`); break; }
      if (round > MAX_ROUNDS) { out.not_searched = { names: newNames.map((n) => names.get(n)!), contacts: newContacts.map((c) => contacts.get(c)!) }; log(`round limit reached; ${newNames.length} names, ${newContacts.length} contacts left`); break; }
      const nameNow = newNames.slice(0, MAX_NAMES); const contactNow = newContacts.slice(0, MAX_CONTACTS);
      out.not_searched.names.push(...newNames.slice(MAX_NAMES).map((n) => names.get(n)!));
      out.not_searched.contacts.push(...newContacts.slice(MAX_CONTACTS).map((c) => contacts.get(c)!));
      nameNow.forEach((n) => searchedNames.add(n)); contactNow.forEach((c) => searchedContacts.add(c));
      newNames.slice(MAX_NAMES).forEach((n) => searchedNames.add(n)); newContacts.slice(MAX_CONTACTS).forEach((c) => searchedContacts.add(c));
      log(`round ${round}: ${nameNow.length} names, ${contactNow.length} contacts`);
      await Promise.all([
        ...nameNow.flatMap((n, i) => [
          run(`R${round}N${i + 1}w`, round, 'exa-web', `"${names.get(n)}" ${short}`, `name: ${names.get(n)}`, exaWeb(`"${names.get(n)}" ${short}`)),
          run(`R${round}N${i + 1}p`, round, 'exa-people', `${names.get(n)} ${short} ${country}`, `name: ${names.get(n)}`, exaPeople(`${names.get(n)} ${short} ${country}`)),
        ]),
        ...contactNow.map((c, i) => run(`R${round}K${i + 1}`, round, 'brave', `"${contacts.get(c)}"`, `contact: ${contacts.get(c)}`, async () => {
          try { return await braveQ(`"${contacts.get(c)}"`)(); } catch { return await exaWeb(`"${contacts.get(c)}"`)(); }
        })),
      ]);
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
