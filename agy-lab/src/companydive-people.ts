// People linked to a company, found with Exa, added to a dive that already ran.
//
// It does not re-run the research. It reads the saved dive (identity anchors,
// the people facts, the sources), then:
//
//   1 plan     LLM: Exa queries from the identity and the people already known
//   2 search   Exa round 1: the 'people' category (profiles with work history)
//              plus web searches for directors, staff and agents
//   3 follow   LLM: names worth confirming, new angles -> Exa round 2
//   4 people   LLM: one list, each person cited, lookalike companies rejected
//
// Exa goes through the shared key pool in core/exa.ts; a step spends at most
// MAX_EXA_CALLS. Like the dive, nothing here has a timeout or a token cap, and a
// stage that gets no usable answer falls back instead of ending the step. The
// result lands in company_dive.result.people.

import { exa } from './core/index.ts';
import * as reportdb from './reportdb.ts';
import { PRICES } from './cost.ts';
import * as countries from './countries.ts';
import { ask, askJson, type DiveRow, type DiveResult, type LlmUse, type Warn } from './companydive.ts';

export const MAX_EXA_CALLS = 20;

export type ExaQuery = { query: string; kind: 'people' | 'web'; purpose?: string };

export type Person = {
  name: string;
  role: string;
  relation: 'founder' | 'director' | 'shareholder' | 'management' | 'employee' | 'agent' | 'partner' | 'former' | 'other';
  current: boolean | null;
  evidence: Array<{ url: string; quote: string }>;
  confidence: 'high' | 'medium' | 'low';
  notes?: string;
};

export type PeopleResult = {
  status: 'running' | 'done' | 'partial' | 'failed';
  started_at: string;
  finished_at?: string;
  error?: string;
  people: Person[];
  rejected: Array<{ name: string; reason: string }>;
  exa: Array<{ n: number; at?: string; query: string; kind: string; results: number; dollars: number; ms?: number; ok: boolean; usd?: number; note?: string }>;
  llm: LlmUse[];
  log: Array<{ at: string; msg: string }>;
  warnings: string[];
};

type ExaHit = {
  url: string;
  title: string;
  name: string;
  location: string;
  jobs: string[];
  text: string;
};

// ---------------------------------------------------------------- Exa

/** One Exa /search through the app's core (core/exa.ts): the shared key pool, a spent or refused key rests and the call moves on. */
export async function exaSearch(body: Record<string, unknown>, fetchImpl: typeof fetch = fetch): Promise<{ results: Array<Record<string, any>>; dollars: number }> {
  const out = await exa.request('search', body, { fetchImpl });
  return { results: out.results ?? [], dollars: Number(out.costDollars?.total ?? 0) };
}

function clean(v: unknown, max: number): string {
  return String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

/** An Exa result as the model reads it: the profile's name, every job with its dates, and the page text. */
export function toHit(r: Record<string, any>): ExaHit {
  const entity = (r.entities ?? []).find((e: Record<string, any>) => /person/i.test(String(e.type ?? 'person'))) ?? {};
  const props = (entity.properties ?? entity ?? {}) as Record<string, any>;
  const jobs = (Array.isArray(props.workHistory) ? props.workHistory : []).map((j: Record<string, any>) => {
    const dates = j.dates ?? {};
    const span = dates.to ? `${clean(dates.from, 10) || '?'} to ${clean(dates.to, 10)}` : `${clean(dates.from, 10) || '?'} to now`;
    return `${clean(j.title, 100)} at ${clean(j.company?.name, 100)} (${span})`;
  });
  const text = [...(Array.isArray(r.highlights) ? r.highlights : []), r.text ?? ''].map((t) => clean(t, 1_200)).filter(Boolean).join(' … ');
  return { url: String(r.url ?? ''), title: clean(r.title, 160), name: clean(props.name, 100), location: clean(props.location, 80), jobs, text: clean(text, 1_500) };
}

/** `location` is the country pack's exa_location (countries.ts); without one, 'MY' as always. */
export function bodyFor(q: ExaQuery, location = 'MY'): Record<string, unknown> {
  return q.kind === 'people'
    ? { query: q.query, type: 'auto', category: 'people', numResults: 25, userLocation: location, contents: { highlights: { maxCharacters: 600 } } }
    : { query: q.query, type: 'auto', numResults: 10, userLocation: location, contents: { highlights: { maxCharacters: 900 } } };
}

// ---------------------------------------------------------------- prompts

function knownBlock(row: DiveRow): string {
  const r = row.result as DiveResult;
  const people = r.facts.filter((f) => f.topic === 'ownership_people').map((f) => '- ' + f.fact).join('\n');
  return `Company: "${row.company}" (${row.country})
Identity: ${JSON.stringify(r.identity)}
People facts already in the dossier:
${people || '(none)'}`;
}

function planPrompt(row: DiveRow, max: number): string {
  return `${knownBlock(row)}

We want every person linked to this company: founders, directors, shareholders, managers, staff, sales agents, partners and former staff. Plan up to ${max} Exa searches.
- kind "people" searches Exa's index of professional profiles (LinkedIn-style, with work history). Phrase it as a description of the people, e.g. "people who work at <company>, a solar company in Johor Bahru, Malaysia". Vary it: the legal name, each alias and trade name, the Chinese name if any, and roles (engineer, technician, sales, agent, HR, project manager).
- kind "web" searches the web, for directors and shareholders in registries, news and interviews that name people, award pages, and staff named on the company's social pages.
- Also include one "people" search per person already known (name + company), to find their profile.
The company has lookalikes with similar names. Put the anchors (city, industry, registration number) in the queries.

Answer with ONLY JSON: {"queries": [{"query": "", "kind": "people|web", "purpose": ""}]}`;
}

function hitsBlock(hits: Array<ExaHit & { id: number }>): string {
  return hits.map((h) => `[${h.id}] ${h.title} | ${h.url}${h.name ? `\n    profile: ${h.name}${h.location ? ', ' + h.location : ''}` : ''}${h.jobs.length ? `\n    jobs: ${h.jobs.slice(0, 6).join('; ')}` : ''}\n    ${h.text}`).join('\n');
}

function followPrompt(row: DiveRow, hits: Array<ExaHit & { id: number }>, asked: string[], max: number): string {
  return `${knownBlock(row)}

First-round Exa results (each starts with [id]):
${hitsBlock(hits)}

Queries already run: ${JSON.stringify(asked)}

Plan up to ${max} more Exa searches that would find people still missing or confirm uncertain ones. Examples: "<new name> <company>" for a name that appears without a profile, a role or state the first round did not cover, an alias not tried yet. Do not repeat a query already run. Return [] if nothing is worth it.

Answer with ONLY JSON: {"queries": [{"query": "", "kind": "people|web", "purpose": ""}]}`;
}

function peoplePrompt(row: DiveRow, hits: Array<ExaHit & { id: number }>): string {
  return `${knownBlock(row)}

Exa results (each starts with [id]):
${hitsBlock(hits)}

List every person linked to THIS company: the company in the identity above, not lookalikes. A result counts when its profile, job list or text ties the person to this company by name, alias, domain, registration number or an unmistakable detail. Jobs listed "to now" are current; jobs with an end date are former. Reject people whose only link is a different company with a similar name (e.g. "Eternal Materials" is not "Eternalgy") and say why in one line. Merge duplicates of the same person. Use only the material above and the people facts from the dossier.

Answer with ONLY JSON:
{"people": [{"name": "", "role": "their title or role", "relation": "founder|director|shareholder|management|employee|agent|partner|former|other", "current": true, "evidence": [{"id": 0, "quote": "the words that tie them to the company"}], "confidence": "high|medium|low", "notes": ""}],
 "rejected": [{"name": "", "reason": ""}]}`;
}

// ---------------------------------------------------------------- the step

const RELATIONS = ['founder', 'director', 'shareholder', 'management', 'employee', 'agent', 'partner', 'former', 'other'];

export function fallbackQueries(row: DiveRow): ExaQuery[] {
  const id = (row.result as DiveResult).identity ?? {};
  const names = [...new Set([id.legal_name || row.company, ...(id.aliases ?? [])].filter(Boolean).map(String))].slice(0, 4);
  const where = [id.industry, id.address?.split(',').slice(-2).join(',')].filter(Boolean).join(', ');
  return [
    ...names.map((n): ExaQuery => ({ query: `people who work at ${n}${where ? ', ' + where : ''}, ${row.country}`, kind: 'people' })),
    { query: `${names[0]} director shareholder founder ${row.country}`, kind: 'web' },
  ];
}

export async function findPeople(row: DiveRow, save: (p: PeopleResult) => Promise<void>): Promise<PeopleResult> {
  const out: PeopleResult = { status: 'running', started_at: new Date().toISOString(), people: [], rejected: [], exa: [], llm: [], log: [], warnings: [] };
  const say = async (msg: string) => {
    out.log.push({ at: new Date().toISOString(), msg });
    console.log(`[company-dive ${row.id} people] ${msg}`);
    await save(out).catch(() => {});
  };
  const warn: Warn = async (msg) => { out.warnings.push(msg); await say('warning: ' + msg); };
  const uses = out.llm;
  const hits: Array<ExaHit & { id: number }> = [];
  const seen = new Map<string, number>();
  const { pack } = countries.forCountry(row.country);
  const location = pack?.search.exa_location ?? 'MY';

  const runQueries = async (queries: ExaQuery[]) => {
    for (const q of queries) {
      if (out.exa.length >= MAX_EXA_CALLS) break;
      const n = out.exa.length + 1;
      const started = Date.now();
      const at = new Date(started).toISOString();
      try {
        const { results, dollars } = await exaSearch(bodyFor(q, location));
        let added = 0;
        for (const r of results) {
          const hit = toHit(r);
          if (!hit.url || seen.has(hit.url)) continue;
          seen.set(hit.url, hits.length + 1);
          hits.push({ ...hit, id: hits.length + 1 });
          added++;
        }
        // Exa's own price when it sends one, else the list price.
        out.exa.push({ n, at, query: q.query, kind: q.kind, results: results.length, dollars, ms: Date.now() - started, ok: true, usd: dollars || PRICES.exaSearch });
        await say(`Exa ${n} (${q.kind}) "${q.query}": ${results.length} results, ${added} new`);
      } catch (err) {
        const code = (err as { code?: string }).code;
        if (code !== 'quota' && code !== 'not_installed') out.exa.push({ n, at, query: q.query, kind: q.kind, results: 0, dollars: 0, ms: Date.now() - started, ok: false, usd: 0, note: (err as Error).message.slice(0, 200) });
        await warn(`Exa "${q.query}" failed: ${(err as Error).message}`);
      }
    }
  };
  const cleanQueries = (list: unknown, asked: Set<string>): ExaQuery[] =>
    (Array.isArray(list) ? list : [])
      .filter((q) => q && typeof q.query === 'string' && q.query.trim() && !asked.has(q.query.trim().toLowerCase()))
      .map((q) => ({ query: String(q.query).trim(), kind: q.kind === 'web' ? 'web' : 'people', purpose: q.purpose ? String(q.purpose) : undefined }) as ExaQuery);

  try {
    // 1-2. plan and first round
    await say('Planning Exa searches from the saved dossier');
    const plan = await askJson<{ queries?: unknown }>(countries.withNotes(pack, 'people', planPrompt(row, 12)), { step: 'people-plan', uses, warn }, { queries: fallbackQueries(row) });
    const asked = new Set<string>();
    const first = cleanQueries(plan.queries, asked).slice(0, 12);
    for (const q of first) asked.add(q.query.toLowerCase());
    await runQueries(first);

    // 3. follow-up round on what the first one turned up
    const left = MAX_EXA_CALLS - out.exa.length;
    if (left > 0 && hits.length) {
      const follow = await askJson<{ queries?: unknown }>(countries.withNotes(pack, 'people', followPrompt(row, hits, [...asked], Math.min(8, left))), { step: 'people-follow', uses, warn }, { queries: [] });
      const second = cleanQueries(follow.queries, asked).slice(0, Math.min(8, left));
      for (const q of second) asked.add(q.query.toLowerCase());
      if (second.length) await runQueries(second);
    }

    // 4. one cited list
    await say(`Reading ${hits.length} Exa results for people linked to the company`);
    const found = await askJson<{ people?: unknown; rejected?: unknown }>(peoplePrompt(row, hits), { step: 'people-list', uses, warn }, { people: [], rejected: [] });
    out.people = (Array.isArray(found.people) ? found.people : [])
      .filter((p) => p && typeof p.name === 'string' && p.name.trim())
      .map((p): Person => ({
        name: clean(p.name, 120),
        role: clean(p.role, 160),
        relation: (RELATIONS.includes(p.relation) ? p.relation : 'other') as Person['relation'],
        current: typeof p.current === 'boolean' ? p.current : null,
        evidence: (Array.isArray(p.evidence) ? p.evidence : [])
          .map((e: Record<string, any>) => ({ url: hits[Number(e.id) - 1]?.url ?? (typeof e.url === 'string' ? e.url : ''), quote: clean(e.quote, 300) }))
          .filter((e: { url: string }) => e.url),
        confidence: (['high', 'medium', 'low'].includes(p.confidence) ? p.confidence : 'medium') as Person['confidence'],
        notes: p.notes ? clean(p.notes, 300) : undefined,
      }));
    out.rejected = (Array.isArray(found.rejected) ? found.rejected : [])
      .filter((r) => r && r.name).map((r) => ({ name: clean(r.name, 120), reason: clean(r.reason, 200) }));
    out.status = out.warnings.length ? 'partial' : 'done';
    const dollars = out.exa.reduce((n, c) => n + c.dollars, 0);
    await say(`${out.people.length} people linked, ${out.rejected.length} lookalikes rejected; Exa ${out.exa.length} calls, $${dollars.toFixed(3)}; LLM ${uses.length} calls`);
  } catch (err) {
    out.status = 'failed';
    out.error = (err as Error).message;
    await say('failed: ' + out.error);
  }
  out.finished_at = new Date().toISOString();
  await save(out);
  return out;
}

// ---------------------------------------------------------------- storage and HTTP

const runningFor = new Set<number>();

async function savePeople(id: number, people: PeopleResult): Promise<void> {
  await reportdb.sql(`update company_dive set result = jsonb_set(coalesce(result, '{}'::jsonb), '{people}', $2::jsonb) where id = $1`, [id, JSON.stringify(people)]);
}

/** Run the people step on a saved dive and store it; the dive runner calls this after the research. */
export async function runFor(row: DiveRow): Promise<PeopleResult> {
  if (runningFor.has(row.id)) throw new Error('the people step is already running for this dive');
  runningFor.add(row.id);
  try {
    return await findPeople(row, (p) => savePeople(row.id, p));
  } finally {
    runningFor.delete(row.id);
  }
}

/** A people step still 'running' at boot was cut off by a restart. */
export async function failInterrupted(): Promise<void> {
  if (!reportdb.configured()) return;
  await reportdb.sql(`update company_dive
      set result = jsonb_set(result, '{people}', (result->'people') || '{"status":"failed","error":"interrupted by a restart"}'::jsonb)
    where result->'people'->>'status' = 'running'`);
}

type Ctx = {
  json: (res: import('node:http').ServerResponse, status: number, body: unknown) => void;
};

/** POST /api/company-dive/:id/people starts the step; GET on the dive shows result.people. */
export async function handle(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse, url: URL, ctx: Ctx): Promise<boolean> {
  const m = url.pathname.match(/^\/api\/company-dive\/(\d+)\/people$/);
  if (!m) return false;
  const id = Number(m[1]);
  if (req.method === 'GET') {
    const row = (await reportdb.sql<DiveRow>(`select result from company_dive where id = $1`, [id])).rows[0];
    ctx.json(res, row ? 200 : 404, row ? { people: (row.result as any)?.people ?? null } : { error: 'no such dive' });
    return true;
  }
  if (req.method !== 'POST') {
    ctx.json(res, 405, { error: 'POST to start, GET to read' });
    return true;
  }
  const row = (await reportdb.sql<DiveRow>(`select * from company_dive where id = $1`, [id])).rows[0];
  if (!row) {
    ctx.json(res, 404, { error: 'no such dive' });
    return true;
  }
  if (!row.result?.identity) {
    ctx.json(res, 409, { error: `dive ${id} has no saved research yet (status ${row.status})` });
    return true;
  }
  if (runningFor.has(id)) {
    ctx.json(res, 409, { error: 'the people step is already running for this dive' });
    return true;
  }
  runningFor.add(id);
  void findPeople(row, (p) => savePeople(id, p))
    .catch((err) => console.error(`[company-dive ${id} people] crashed`, err))
    .finally(() => runningFor.delete(id));
  ctx.json(res, 202, { id, people: 'running', view_url: `/company-dive#${id}` });
  return true;
}
