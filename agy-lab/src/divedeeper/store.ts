import crypto from 'node:crypto';
import * as reportdb from '../reportdb.ts';
import type { SwitchOptions } from '../switches.ts';
import { type LaneResult } from './runner.ts';

export type Row = {
  id: number; public_id: string; company: string; dive_id: number | null;
  status: string; stage: string; log: Array<{ at: string; stage: string; msg: string }>;
  lanes: Record<string, LaneResult>; report_html: string | null; error: string | null;
  created_at: string; finished_at: string | null;
  /** How many times an incomplete run was picked up again on its own, and when it is next. */
  resumes?: number; retry_at?: string | null;
  options?: SwitchOptions;
};

let tableReady: Promise<unknown> | null = null;
export function ensureTable(): Promise<unknown> {
  tableReady ??= reportdb.sql(`
    create table if not exists dive_deeper (
      id bigserial primary key,
      public_id text not null unique,
      company text not null,
      dive_id bigint,
      status text not null default 'queued',
      stage text not null default '',
      log jsonb not null default '[]',
      lanes jsonb not null default '{}',
      report_html text,
      error text,
      created_at timestamptz not null default now(),
      finished_at timestamptz
    );
    create index if not exists dive_deeper_created_idx on dive_deeper (created_at desc);
    create table if not exists dive_preview (
      dive_id bigint primary key,
      notes jsonb not null default '{}',
      created_at timestamptz not null default now()
    );
    -- What writing the preview used (one LLM pass), for its cost.
    alter table dive_preview add column if not exists meter jsonb;
    -- Same company UID as the company-dive it runs on (company-uid.ts), so a company's page lists both.
    alter table dive_deeper add column if not exists company_uid text;
    create index if not exists dive_deeper_uid_idx on dive_deeper (company_uid, created_at desc);
    alter table dive_deeper add column if not exists options jsonb not null default '{}'::jsonb;
    -- An incomplete run (a lane failed after its tries) is picked up again at retry_at.
    alter table dive_deeper add column if not exists resumes int not null default 0;
    alter table dive_deeper add column if not exists retry_at timestamptz;
  `).catch((err) => { tableReady = null; throw err; });
  return tableReady;
}

export const newPublicId = () => crypto.randomBytes(15).toString('base64url');

export async function update(id: number, fields: Partial<Omit<Row, 'id' | 'created_at'>>): Promise<void> {
  const keys = Object.keys(fields);
  if (!keys.length) return;
  const json = new Set(['log', 'lanes', 'options']);
  const sets = keys.map((k, i) => `${k} = $${i + 2}${json.has(k) ? '::jsonb' : ''}`).join(', ');
  const values = keys.map((k) => (json.has(k) ? JSON.stringify((fields as any)[k]) : (fields as any)[k]));
  await reportdb.sql(`update dive_deeper set ${sets} where id = $1`, [id, ...values]);
}

// ---------------------------------------------------------------- keys and the dive

// Keys and LLM lanes are not picked here: every lane calls the app's core
// (core/README.md), which uses the hub's lanes on /workers and its key pools.

export async function diveRow(diveId: number): Promise<any | null> {
  return (await reportdb.sql(`select * from company_dive where id = $1`, [diveId])).rows[0] ?? null;
}
