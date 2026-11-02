import crypto from 'node:crypto';
import * as reportdb from '../reportdb.ts';
import type { DiveResult } from './pipeline.ts';

// ---------------------------------------------------------------- storage

export type DiveRow = {
  id: number; public_id: string | null; options: { people?: boolean } | null;
  company: string; country: string; status: string; stage: string;
  log: Array<{ at: string; stage: string; msg: string }>; result: DiveResult | null; dossier: string | null; error: string | null;
  tavily_calls: number; tavily_credits: number; brave_calls: number; llm_calls: number;
  created_at: string; finished_at: string | null;
  /** Tries so far, and when an incomplete dive runs again. */
  tries?: number; retry_at?: string | null;
};

let tableReady: Promise<unknown> | null = null;

export function ensureTable(): Promise<unknown> {
  tableReady ??= reportdb.sql(`
    create table if not exists company_dive (
      id bigserial primary key,
      company text not null,
      country text not null,
      status text not null default 'queued',
      stage text not null default '',
      log jsonb not null default '[]',
      result jsonb,
      dossier text,
      error text,
      tavily_calls int not null default 0,
      tavily_credits int not null default 0,
      brave_calls int not null default 0,
      llm_calls int not null default 0,
      created_at timestamptz not null default now(),
      finished_at timestamptz
    );
    alter table company_dive add column if not exists public_id text unique;
    alter table company_dive add column if not exists options jsonb not null default '{}'::jsonb;
    -- The company UID (company-uid.ts) this report belongs to: one company, many reports on different dates.
    alter table company_dive add column if not exists company_uid text;
    create index if not exists company_dive_uid_idx on company_dive (company_uid, created_at desc);
    -- A dive that is not complete runs again at retry_at (execute, notComplete).
    alter table company_dive add column if not exists tries int not null default 0;
    alter table company_dive add column if not exists retry_at timestamptz;`)
    .then(async () => {
      // Dives from before public links get one now.
      const old = await reportdb.sql<{ id: string }>(`select id from company_dive where public_id is null`);
      for (const row of old.rows) await reportdb.sql(`update company_dive set public_id = $2 where id = $1`, [row.id, newPublicId()]);
    })
    .catch((err) => { tableReady = null; throw err; });
  return tableReady;
}

/** 20 url-safe characters, the same shape as the hub's /r/:id report links. */
export function newPublicId(): string {
  return crypto.randomBytes(15).toString('base64url');
}

export async function updateRow(id: number, fields: Partial<Omit<DiveRow, 'id' | 'created_at'>>): Promise<void> {
  const cols = Object.keys(fields);
  if (!cols.length) return;
  const sets = cols.map((c, i) => `${c} = $${i + 2}`).join(', ');
  const vals = cols.map((c) => {
    const v = (fields as Record<string, unknown>)[c];
    return c === 'log' || c === 'result' ? JSON.stringify(v) : v;
  });
  await reportdb.sql(`update company_dive set ${sets} where id = $1`, [id, ...vals]);
}
