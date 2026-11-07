import crypto from 'node:crypto';
import * as db from '../../reportdb.ts';
import type { LaneResult } from '../runner.ts';

export type Status = 'queued' | 'running' | 'done' | 'incomplete' | 'failed';
export type Run = {
  run_id: string; report_id: string; company_uid: string | null; status: Status; stage: string;
  log: { at: string; stage: string; msg: string }[]; error: string | null;
  created_at: string; updated_at: string; finished_at: string | null;
};
export type Lane = { id: number; run_id: string; report_id: string; lane: string; status: LaneResult['status']; payload: LaneResult; created_at: string };
const jsonb = (value: unknown) => JSON.stringify(value, (_k, v) => typeof v === 'string' ? v.toWellFormed() : v);

let ready: Promise<void> | null = null;
export function ensureTables(): Promise<void> {
  ready ??= (async () => {
    await db.sql(`create table if not exists v21_deeper_run (
      run_id text primary key, report_id text not null, company_uid text,
      status text not null default 'queued' check (status in ('queued', 'running', 'done', 'incomplete', 'failed')),
      stage text not null default '', log jsonb not null default '[]'::jsonb, error text,
      created_at timestamptz not null default now(), updated_at timestamptz not null default now(), finished_at timestamptz
    )`);
    await db.sql(`create table if not exists v21_deeper_lane (
      id serial primary key, run_id text not null references v21_deeper_run(run_id), report_id text not null,
      lane text not null, status text not null check (status in ('done', 'partial', 'failed')), payload jsonb not null,
      created_at timestamptz not null default now()
    )`);
    await db.sql(`create index if not exists v21_deeper_run_report on v21_deeper_run (report_id, created_at desc)`);
    await db.sql(`create index if not exists v21_deeper_lane_run on v21_deeper_lane (run_id, id)`);
  })().catch((err) => { ready = null; throw err; });
  return ready;
}

export async function createRun(reportId: string): Promise<string> {
  await ensureTables();
  const id = crypto.randomUUID();
  await db.sql(`insert into v21_deeper_run (run_id, report_id) values ($1, $2)`, [id, reportId]);
  return id;
}
export async function getRun(id: string): Promise<Run | null> {
  await ensureTables();
  return (await db.sql<Run>(`select * from v21_deeper_run where run_id = $1`, [id])).rows[0] ?? null;
}
export async function listRuns(reportId: string): Promise<Run[]> {
  await ensureTables();
  return (await db.sql<Run>(`select * from v21_deeper_run where report_id = $1 order by created_at desc, run_id`, [reportId])).rows;
}
export async function laneRows(id: string): Promise<Lane[]> {
  await ensureTables();
  return (await db.sql<Lane>(`select * from v21_deeper_lane where run_id = $1 order by id`, [id])).rows;
}
/** The trades and towns the report's newest H-maps lane searched, from any earlier run; a lane that ran beats a failed
 *  try. null when the report has never run H-maps. */
export async function lastPlan(reportId: string): Promise<unknown> {
  await ensureTables();
  const out = await db.sql<{ plan: unknown }>(`select payload->'notes'->'plan' as plan from v21_deeper_lane
    where report_id = $1 and lane = 'H-maps' and payload->'notes'->'plan' is not null
    order by (status <> 'failed') desc, id desc limit 1`, [reportId]);
  return out.rows[0]?.plan ?? null;
}
export async function saveLane(run: Run, result: LaneResult): Promise<void> {
  await ensureTables();
  await db.sql(`insert into v21_deeper_lane (run_id, report_id, lane, status, payload) values ($1, $2, $3, $4, $5::jsonb)`,
    [run.run_id, run.report_id, `${result.section}-${result.lane}`, result.status, jsonb(result)]);
}
export async function update(id: string, values: Partial<Pick<Run, 'company_uid' | 'status' | 'stage' | 'log' | 'error' | 'finished_at'>>): Promise<void> {
  await ensureTables();
  const args: unknown[] = [id];
  const set = Object.entries(values).map(([key, value]) => `${key} = $${args.push(key === 'log' ? jsonb(value) : value)}${key === 'log' ? '::jsonb' : ''}`);
  await db.sql(`update v21_deeper_run set ${[...set, 'updated_at = now()'].join(', ')} where run_id = $1`, args);
}
export async function interrupted(): Promise<Run[]> {
  await ensureTables();
  return (await db.sql<Run>(`update v21_deeper_run set status = 'queued', stage = '', updated_at = now()
    where status in ('queued', 'running') returning *`)).rows.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
}
