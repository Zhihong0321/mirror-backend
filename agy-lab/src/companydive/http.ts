import type http from 'node:http';
import { brave } from '../core/index.ts';
import * as reportdb from '../reportdb.ts';
import { diveCalls, diveUsage, price } from '../cost.ts';
import * as companies from '../company-uid.ts';
import type { DiveResult, LlmUse } from './pipeline.ts';
import { ensureTable, newPublicId, type DiveRow } from './store.ts';
import { pump, waiting } from './runner.ts';

function origin(req: http.IncomingMessage): string {
  const proto = String(req.headers['x-forwarded-proto'] ?? '').split(',')[0]?.trim() || 'http';
  return proto + '://' + (req.headers.host ?? 'localhost');
}

function links(req: http.IncomingMessage, row: { id: number | string; public_id: string | null }): Record<string, string> {
  const base = origin(req);
  return {
    report_url: `${base}/d/${row.public_id}`,
    status_url: `${base}/d/${row.public_id}/data`,
    api_url: `${base}/api/company-dive/${row.id}`,
  };
}

// ---------------------------------------------------------------- HTTP

type Ctx = {
  json: (res: import('node:http').ServerResponse, status: number, body: unknown) => void;
  readJson: (req: import('node:http').IncomingMessage) => Promise<Record<string, unknown>>;
};

/** /api/company-dive routes, behind the operator token. Returns false for any other path. */
export async function handle(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse, url: URL, ctx: Ctx): Promise<boolean> {
  const p = url.pathname;
  if (p !== '/api/company-dive' && !p.startsWith('/api/company-dive/')) return false;
  if (!reportdb.configured()) {
    ctx.json(res, 503, { error: 'no report database configured' });
    return true;
  }
  await ensureTable();
  const method = req.method ?? 'GET';
  if (p === '/api/company-dive' && method === 'GET') {
    const out = await reportdb.sql(
      `select id, public_id, company, country, status, stage, tavily_calls, tavily_credits, brave_calls, llm_calls, created_at, finished_at,
              result->'llm' as llm, result->'people'->'llm' as people_llm, result->'people'->'exa' as people_exa
         from company_dive order by id desc limit 50`);
    ctx.json(res, 200, { dives: out.rows.map(({ llm, people_llm, people_exa, ...r }: any) => ({ ...r, cost: price(diveUsage({ ...r, llm, people_llm, people_exa })), ...links(req, r as DiveRow) })) });
    return true;
  }
  if (p === '/api/company-dive' && method === 'POST') {
    const body = await ctx.readJson(req);
    const company = String(body.company ?? body.name ?? '').trim();
    const country = String(body.country ?? '').trim() || 'Malaysia';
    if (company.length < 2 || company.length > 200) {
      ctx.json(res, 400, { error: 'company is required' });
      return true;
    }
    if (!(await brave.current()).length) {
      ctx.json(res, 503, { error: 'No Brave keys: add one on /workers' });
      return true;
    }
    const options = { people: body.people !== false };
    const publicId = newPublicId();
    // The report joins its company's page: the UID given, else the one its website's host has (made if new).
    const companyUid = await companies.resolve({ uid: body.company_uid, website: body.website, text: company, create: true }).catch(() => null);
    const out = await reportdb.sql<{ id: string }>(
      `insert into company_dive (company, country, public_id, options, company_uid) values ($1, $2, $3, $4, $5) returning id`,
      [company, country, publicId, JSON.stringify(options), companyUid]);
    const id = Number(out.rows[0].id);
    waiting.push(id);
    pump();
    // The report link works at once: it shows the live log until the report is ready.
    ctx.json(res, 202, {
      id, public_id: publicId, status: 'queued', company, country, company_uid: companyUid, people: options.people,
      // Still in `waiting` after pump() means another dive holds the one slot.
      queued_behind_another: waiting.includes(id),
      ...links(req, { id, public_id: publicId }),
      expected_minutes: '5-10',
    });
    return true;
  }
  const m = p.match(/^\/api\/company-dive\/(\d+)$/);
  if (m && method === 'GET') {
    const row = (await reportdb.sql<DiveRow>(`select * from company_dive where id = $1`, [Number(m[1])])).rows[0];
    const people = (row?.result as { people?: { llm?: LlmUse[]; exa?: [] } } | null)?.people;
    if (row) ctx.json(res, 200, { ...row, cost: price(diveUsage({ ...row, llm: row.result?.llm, people_llm: people?.llm, people_exa: people?.exa, tavily: (row.result as { tavily?: never } | null)?.tavily })), calls: diveCalls(row.result as Parameters<typeof diveCalls>[0]), ...links(req, row) });
    else ctx.json(res, 404, { error: 'no such dive' });
    return true;
  }
  ctx.json(res, 404, { error: 'not found', path: p });
  return true;
}

// ---------------------------------------------------------------- public report

/** What the public page may show: no keys, no internal ids beyond the source numbers. */
export function publicView(row: DiveRow): Record<string, unknown> {
  const r = row.result;
  const cited = new Set((r?.facts ?? []).flatMap((f) => f.sources));
  const people = (r as (DiveResult & { people?: Record<string, any> }) | null)?.people;
  return {
    company: row.company,
    country: row.country,
    status: row.status,
    stage: row.stage,
    error: row.status === 'failed' || row.status === 'incomplete' ? row.error : null,
    created_at: row.created_at,
    finished_at: row.finished_at,
    log: (row.log ?? []).map((l) => ({ at: l.at, stage: l.stage, msg: l.msg })),
    dossier: row.dossier,
    identity: r?.identity ?? null,
    sources: (r?.sources ?? []).filter((s) => cited.has(s.id)).map((s) => ({ id: s.id, title: s.title, url: s.url })),
    stats: r ? {
      tavily_calls: row.tavily_calls, brave_calls: row.brave_calls, llm_calls: row.llm_calls,
      facts: r.facts.length, sources_found: r.sources.length, sources_cited: cited.size,
    } : null,
    people: people ? {
      status: people.status,
      people: people.people ?? [],
      rejected: (people.rejected ?? []).length,
      exa_calls: (people.exa ?? []).length,
      log: (people.log ?? []).map((l: { at: string; msg: string }) => ({ at: l.at, msg: l.msg })),
    } : null,
  };
}

/** /d/:publicId and /d/:publicId/data, served without a token: the opaque id is the permission. */
export async function handlePublic(req: http.IncomingMessage, res: http.ServerResponse, url: URL): Promise<boolean> {
  const m = /^\/d\/([A-Za-z0-9_-]{20})(\/data)?\/?$/.exec(url.pathname);
  if (!m || (req.method ?? 'GET') !== 'GET') return false;
  const send = (status: number, type: string, body: string) => {
    res.writeHead(status, { 'content-type': `${type}; charset=utf-8`, 'cache-control': 'no-store', 'x-robots-tag': 'noindex, nofollow' });
    res.end(body);
  };
  if (!reportdb.configured()) return send(503, 'application/json', JSON.stringify({ error: 'reports are not configured' })), true;
  await ensureTable();
  const row = (await reportdb.sql<DiveRow>(`select * from company_dive where public_id = $1`, [m[1]])).rows[0];
  if (m[2]) {
    send(row ? 200 : 404, 'application/json', JSON.stringify(row ? publicView(row) : { error: 'report not found' }));
    return true;
  }
  const { reportPage } = await import('../companydive-report.ts');
  send(row ? 200 : 404, 'text/html', reportPage(row ? publicView(row) : null, m[1]));
  return true;
}
