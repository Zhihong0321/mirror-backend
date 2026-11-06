// V2.1 raw-data store on the hub: every Step 1 and Step 2 result is written to Postgres, keyed by report UID.
// Owns two tables and touches no other table (company_id is reserved for the company-UID link, set where known).
//
//   v21_report  one row per V2.1 dive (the report UID is its key, issued before the first call), with step statuses.
//   v21_raw     one row per stored result: step, kind, run_id, payload. Written once, never updated or deleted.
//
// Kinds: step 1 'checkpoint' (the whole RawResearchCheckpoint: searches, page text, probes, Maps, LinkedIn) and 'log';
//        step 2 'tidy' (the exact input the judge got), 'judge', 'recheck' (each with its raw model answer) and 'result'.
// A Step 2 run groups its rows by run_id; Step 1 rows use the report UID as run_id.
//
//   GET /api/v21/report/{id}                  the report row + its raw rows (kind, run_id, created_at, size; no payload)
//   GET /api/v21/report/{id}/raw/{rowId}      one row's payload
//   GET /api/v21/report?limit=                the latest reports
// LAB_TOKEN only (server.ts authorized()). Research data is written with a report UID and read by report UID.
import type http from 'node:http';
import crypto from 'node:crypto';
import * as db from './reportdb.ts';

type Ctx = {
  json: (res: http.ServerResponse, status: number, body: unknown) => void;
  readJson?: (req: http.IncomingMessage) => Promise<Record<string, unknown>>;
};

export type ReportInput = { company: string; country: string; industry: string; website?: string };
export type StepStatus = 'none' | 'running' | 'done' | 'failed' | 'skipped';
export type RawKind = 'checkpoint' | 'log' | 'tidy' | 'judge' | 'recheck' | 'result';

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
      company_id text,
      step1_status text not null default 'none',
      step1_error text,
      step2_status text not null default 'none',
      step2_error text
    )`)
    .then(() => db.sql(`create table if not exists v21_raw (
      id bigserial primary key,
      report_id text not null references v21_report(report_id),
      step smallint not null check (step in (1, 2)),
      kind text not null,
      run_id text not null,
      status text not null default 'ok',
      created_at timestamptz not null default now(),
      payload jsonb not null
    )`))
    .then(() => db.sql(`create index if not exists v21_raw_report on v21_raw (report_id, id)`))
    .then(() => undefined)
    .catch((err) => {
      ready = null; // try again on the next call
      throw err;
    });
  return ready;
}

/** JSON for a jsonb parameter, lone surrogates repaired (Postgres rejects them). */
const jsonb = (v: unknown): string => JSON.stringify(v ?? null, (_k, x) => (typeof x === 'string' ? x.toWellFormed() : x));
const text = (v: unknown): string | null => (v === null || v === undefined ? null : String(v).toWellFormed());

/** A new report: its UID exists before any research call is made. */
export async function createReport(input: ReportInput): Promise<string> {
  await ensureTables();
  const id = crypto.randomUUID();
  await db.sql(`insert into v21_report (report_id, company, country, industry, website) values ($1, $2, $3, $4, $5)`, [
    id, text(input.company), text(input.country), text(input.industry), text(input.website),
  ]);
  return id;
}

export async function getReport(id: string): Promise<Record<string, unknown> | null> {
  await ensureTables();
  const out = await db.sql(`select * from v21_report where report_id = $1`, [id]);
  return out.rows[0] ?? null;
}

/** Set one step's status (control state; the raw rows are what never change). */
export async function setStatus(id: string, step: 1 | 2, status: StepStatus, error: string | null = null): Promise<void> {
  await ensureTables();
  await db.sql(`update v21_report set step${step}_status = $2, step${step}_error = $3, updated_at = now() where report_id = $1`, [id, status, text(error)]);
}

/** Write one result the moment it exists. Returns the row id. Throws when the database does not take it. */
export async function addRaw(id: string, step: 1 | 2, kind: RawKind, runId: string, payload: unknown, status = 'ok'): Promise<number> {
  await ensureTables();
  const out = await db.sql<{ id: string }>(
    `insert into v21_raw (report_id, step, kind, run_id, status, payload) values ($1, $2, $3, $4, $5, $6::jsonb) returning id`,
    [id, step, kind, runId, status, jsonb(payload)],
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
    const out = await db.sql(`select * from v21_report order by created_at desc limit ${limit}`);
    return json(res, 200, { reports: out.rows }), true;
  }

  const parts = p.slice(PATH.length + 1).split('/');
  const report = await getReport(parts[0]!);
  if (!report) return json(res, 404, { error: 'no such report' }), true;

  if (parts.length === 1) {
    const rows = await db.sql(
      `select id, step, kind, run_id, status, created_at, pg_column_size(payload) as bytes from v21_raw where report_id = $1 order by id`,
      [parts[0]],
    );
    return json(res, 200, { report, raw: rows.rows }), true;
  }
  if (parts.length === 3 && parts[1] === 'raw') {
    const rowId = Number(parts[2]);
    if (!Number.isInteger(rowId)) return json(res, 400, { error: 'row id must be an integer' }), true;
    const out = await db.sql(`select id, step, kind, run_id, status, created_at, payload from v21_raw where report_id = $1 and id = $2`, [parts[0], rowId]);
    if (!out.rows[0]) return json(res, 404, { error: 'no such row for this report' }), true;
    return json(res, 200, out.rows[0]), true;
  }
  return json(res, 404, { error: 'not found' }), true;
}
