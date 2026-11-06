// V2.1 raw-data store on the hub: every Step 1 and Step 2 result is written to Postgres, keyed by report UID.
// Owns two tables and touches no other table (company_id is reserved for the company-UID link, set where known).
//
//   v21_report  one row per V2.1 dive (the report UID is its key, issued before the first call), the company UID it
//               belongs to (company-uid.ts: co_xxxxxxxxxxxx, one per website host) and the step statuses.
//   v21_raw     one row per stored result: step, kind, run_id, payload. Written once, never updated or deleted.
//
// Kinds: step 1 'checkpoint' (the whole RawResearchCheckpoint: searches, page text, probes, Maps, LinkedIn) and 'log';
//        step 1.5 'assets' (PageSpeed + domain ownership and security audit);
//        step 2 'tidy' (the exact input the judge got), 'judge', 'recheck' (each with its raw model answer) and 'result'.
// A Step 2 run groups its rows by run_id; Step 1 rows use the report UID as run_id.
//
//   GET /api/v21/report/{id}                  the report row + its raw rows (kind, run_id, created_at, size; no payload)
//   GET /api/v21/report/{id}/raw/{rowId}      one row's payload
//   GET /api/v21/report?limit=&company_uid=   the latest reports, or every report of one company (a lookup, not a list
//                                             stored on the company)
// LAB_TOKEN only (server.ts authorized()). Research data is written with a report UID and read by report UID.
import type http from 'node:http';
import crypto from 'node:crypto';
import * as db from './reportdb.ts';
import * as companies from './company-uid.ts';

type Ctx = {
  json: (res: http.ServerResponse, status: number, body: unknown) => void;
  readJson?: (req: http.IncomingMessage) => Promise<Record<string, unknown>>;
};

export type ReportInput = { company: string; country: string; industry: string; website?: string };
export type StepStatus = 'none' | 'running' | 'done' | 'failed' | 'skipped';
export type RawKind = 'checkpoint' | 'log' | 'tidy' | 'judge' | 'recheck' | 'result' | 'assets';

const PATH = '/api/v21/report';

let ready: Promise<void> | null = null;
export function ensureTables(): Promise<void> {
  ready ??= db
    .sql(`create table if not exists v21_report (
      report_id text primary key,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      company text not null,
      country text not null,
      industry text not null,
      website text,
      company_uid text,
      step1_status text not null default 'none',
      step1_error text,
      step1_5_status text not null default 'none',
      step1_5_error text,
      step2_status text not null default 'none',
      step2_error text
    )`)
    // The first version of this table named the column company_id (always empty): same column, the name every other table uses.
    .then(() => db.sql(`do $$ begin
      if exists (select 1 from information_schema.columns where table_name = 'v21_report' and column_name = 'company_id')
         and not exists (select 1 from information_schema.columns where table_name = 'v21_report' and column_name = 'company_uid')
      then alter table v21_report rename column company_id to company_uid; end if; end $$`))
    .then(() => db.sql(`alter table v21_report add column if not exists step1_5_status text not null default 'none'`))
    .then(() => db.sql(`alter table v21_report add column if not exists step1_5_error text`))
    .then(() => db.sql(`create index if not exists v21_report_company on v21_report (company_uid, created_at desc)`))
    .then(() => db.sql(`create table if not exists v21_raw (\n      id bigserial primary key,
      report_id text not null references v21_report(report_id),
      step smallint not null check (step in (1, 2)),
      kind text not null,
      run_id text not null,
      status text not null default 'ok',
      created_at timestamptz not null default now(),
      payload jsonb not null
    )`))
    .then(() => db.sql(`create index if not exists v21_raw_report on v21_raw (report_id, id)`))
    .then(() => backfillCompanies())
    .catch((err) => {
      ready = null; // try again on the next call
      throw err;
    });
  return ready;
}

/** JSON for a jsonb parameter, lone surrogates repaired (Postgres rejects them). */
const jsonb = (v: unknown): string => JSON.stringify(v ?? null, (_k, x) => (typeof x === 'string' ? x.toWellFormed() : x));
const text = (v: unknown): string | null => (v === null || v === undefined ? null : String(v).toWellFormed());

/** A name-only company (no website host to group by): the same name and country keeps one UID of its own. */
async function loneCompany(company: string, country: string): Promise<string> {
  const known = await db.sql<{ company_uid: string }>(
    `select r.company_uid from v21_report r join company c on c.uid = r.company_uid
     where c.domain is null and lower(r.company) = lower($1) and r.country = $2 order by r.created_at limit 1`, [company, country]);
  if (known.rows[0]) return known.rows[0].company_uid;
  const uid = companies.newUid();
  await db.sql(`insert into company (uid) values ($1)`, [uid]);
  return uid;
}

/** Reports saved before they carried a company UID get one (set where empty, from their website). Safe to run again. */
async function backfillCompanies(): Promise<void> {
  const rows = await db.sql<{ report_id: string; website: string | null }>(
    `select report_id, website from v21_report where company_uid is null and website is not null`);
  for (const r of rows.rows) {
    const uid = await companies.resolve({ website: r.website, create: true });
    if (uid) await db.sql(`update v21_report set company_uid = $2 where report_id = $1 and company_uid is null`, [r.report_id, uid]);
  }
}

/** A new report: its UID exists before any research call. The company UID comes from the website when it has a host of its own. */
export async function createReport(input: ReportInput & { company_uid?: string }): Promise<{ report_id: string; company_uid: string | null }> {
  await ensureTables();
  const id = crypto.randomUUID();
  const companyUid = await companies.resolve({ uid: input.company_uid, website: input.website, create: true });
  await db.sql(`insert into v21_report (report_id, company, country, industry, website, company_uid) values ($1, $2, $3, $4, $5, $6)`, [
    id, text(input.company), text(input.country), text(input.industry), text(input.website), companyUid,
  ]);
  return { report_id: id, company_uid: companyUid };
}

/**
 * When Step 1 ends: a report still without a company UID gets one from the official domain Step 1 confirmed; with no
 * domain at all (skipped, failed, no site) it gets a UID of its own, so no report is left unidentified. Set where empty.
 */
export async function linkCompany(id: string, officialDomain?: string | null): Promise<string | null> {
  await ensureTables();
  const report: any = await getReport(id);
  if (!report) return null;
  if (report.company_uid) return report.company_uid;
  const site = officialDomain ? (/^https?:/i.test(officialDomain) ? officialDomain : 'https://' + officialDomain) : '';
  const uid = (site ? await companies.resolve({ website: site, create: true }) : null) ?? (await loneCompany(report.company, report.country));
  await db.sql(`update v21_report set company_uid = $2, updated_at = now() where report_id = $1 and company_uid is null`, [id, uid]);
  return ((await getReport(id)) as any)?.company_uid ?? uid;
}

export async function getReport(id: string): Promise<Record<string, unknown> | null> {
  await ensureTables();
  const out = await db.sql(`select * from v21_report where report_id = $1`, [id]);
  return out.rows[0] ?? null;
}

/** Set one step's status (control state; the raw rows are what never change). */
export async function setStatus(id: string, step: 1 | '1_5' | 1.5 | 2, status: StepStatus, error: string | null = null): Promise<void> {
  await ensureTables();
  const col = step === '1_5' || step === 1.5 ? 'step1_5' : `step${step}`;
  await db.sql(`update v21_report set ${col}_status = $2, ${col}_error = $3, updated_at = now() where report_id = $1`, [id, status, text(error)]);
}

/** Write one result the moment it exists. Returns the row id. Throws when the database does not take it. */
export async function addRaw(id: string, step: 1 | '1_5' | 1.5 | 2, kind: RawKind, runId: string, payload: unknown, status = 'ok'): Promise<number> {
  await ensureTables();
  const stepNum = step === '1_5' || step === 1.5 ? 1 : step;
  const out = await db.sql<{ id: string }>(
    `insert into v21_raw (report_id, step, kind, run_id, status, payload) values ($1, $2, $3, $4, $5, $6::jsonb) returning id`,
    [id, stepNum, kind, runId, status, jsonb(payload)],
  );
  return Number(out.rows[0]!.id);
}

/** The newest row of a kind for a report (optionally of one run), payload included. */
export async function latestRaw(id: string, kind: RawKind, runId?: string): Promise<{ id: number; run_id: string; status: string; created_at: string; payload: any } | null> {
  await ensureTables();
  const out = await db.sql(
    `select id, run_id, status, created_at, payload from v21_raw where report_id = $1 and kind = $2 ${runId ? 'and run_id = $3' : ''} order by id desc limit 1`,
    runId ? [id, kind, runId] : [id, kind],
  );
  const r: any = out.rows[0];
  return r ? { ...r, id: Number(r.id) } : null;
}

export async function handle(req: http.IncomingMessage, res: http.ServerResponse, url: URL, { json }: Ctx): Promise<boolean> {
  const p = url.pathname.replace(/\/+$/, '');
  if (p !== PATH && !p.startsWith(PATH + '/')) return false;
  if (req.method !== 'GET') return json(res, 405, { error: 'method not allowed' }), true;
  if (!db.configured()) return json(res, 503, { error: 'no report database configured' }), true;
  await ensureTables();

  if (p === PATH) {
    const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 50, 1), 500);
    const uid = url.searchParams.get('company_uid');
    const out = uid
      ? await db.sql(`select * from v21_report where company_uid = $1 order by created_at desc limit ${limit}`, [uid])
      : await db.sql(`select * from v21_report order by created_at desc limit ${limit}`);
    return json(res, 200, { reports: out.rows }), true;
  }

  const parts = p.slice(PATH.length + 1).split('/');
  const report = await getReport(parts[0]!);
  if (!report) return json(res, 404, { error: 'no such report' }), true;

  if (parts.length === 1) {
    const rows = await db.sql(
      `select id, step, kind, run_id, status, created_at, pg_column_size(payload) as bytes from v21_raw where report_id = $1 order by id`, [report.report_id]);
    return json(res, 200, { report, raw_rows: rows.rows.map((r) => ({ ...r, id: Number(r.id), bytes: Number(r.bytes) })) }), true;
  }

  if (parts[1] === 'raw' && parts[2]) {
    const row = await db.sql(`select id, report_id, step, kind, run_id, status, created_at, payload from v21_raw where report_id = $1 and id = $2`, [report.report_id, parts[2]]);
    if (!row.rows[0]) return json(res, 404, { error: 'no such raw row' }), true;
    const r: any = row.rows[0];
    return json(res, 200, { ...r, id: Number(r.id) }), true;
  }

  return json(res, 404, { error: 'not found' }), true;
}
