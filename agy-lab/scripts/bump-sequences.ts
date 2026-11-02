// Moves each lead table's id counter past the SOURCE's highest id (plus a margin), so a row the
// hub writes while scripts/import-from-pg2nd.ts runs can never take an id a source row still
// needs (must-fix-checklist, lead import A1-A3; owner approved 2026-11-02). A counter only moves
// forward. The import's own resetSequences at the end of each table still runs and is safe:
// setval(max(id) + 1) keeps it above any row the hub wrote.
//
//   node scripts/bump-sequences.ts            # plan only: prints every counter, changes nothing
//   node scripts/bump-sequences.ts --apply    # moves the counters
//
// Env: DATABASE_URL (this service), SRC_PG_PROXY_URL, SRC_PG_DB_NAME, SRC_PG_PROXY_TOKEN (pg_2nd, read only).
import pg from 'pg';

const LEADS = [
  'telemarketer', 'company_data', 'search_report', 'search_report_company', 'published_report',
  'company_research_run', 'person_research_run', 'contact_research_run', 'ads_research_run', 'ads_market_run',
  'run_event', 'company_email', 'taman_assignment', 'taman_finder_town', 'territory_discovered',
  'lead_activity_log', 'atap_solar_registrations', 'company', 'company_place',
  'search_list_run', 'search_list_search', 'search_list_place', 'list_step2_job', 'list_step2_lead',
  'email_marketing_lead', 'email_marketing_event', 'email_marketing_draft',
];
/** Room for what ee-auto still writes to the source until it is stopped. */
const MARGIN = 1_000_000;
const APPLY = process.argv.includes('--apply');

const SRC_URL = (process.env.SRC_PG_PROXY_URL ?? '').replace(/\/+$/, '');
const SRC_DB = process.env.SRC_PG_DB_NAME ?? '';
const SRC_TOKEN = process.env.SRC_PG_PROXY_TOKEN ?? '';
if (!SRC_URL || !SRC_DB || !SRC_TOKEN || !process.env.DATABASE_URL?.trim()) {
  console.error('set DATABASE_URL, SRC_PG_PROXY_URL, SRC_PG_DB_NAME and SRC_PG_PROXY_TOKEN');
  process.exit(2);
}
const q = (ident: string): string => '"' + ident.replace(/"/g, '""') + '"';

/** One read-only request to the pg-proxy (the same call as import-from-pg2nd.ts). */
async function src(sql: string): Promise<Array<Record<string, string | null>>> {
  const res = await fetch(SRC_URL + '/api/sql', {
    method: 'POST',
    headers: { authorization: 'Bearer ' + SRC_TOKEN, 'content-type': 'application/json' },
    body: JSON.stringify({ db_name: SRC_DB, sql, params: [] }),
    signal: AbortSignal.timeout(120_000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error('pg-proxy ' + res.status + ': ' + text.slice(0, 300));
  return (JSON.parse(text) as { rows?: Array<Record<string, string | null>> }).rows ?? [];
}

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
let failed = 0;
console.log(`${APPLY ? 'APPLY' : 'PLAN (nothing changes; pass --apply)'}  margin ${MARGIN}`);
console.log('table.column'.padEnd(36), 'source max'.padStart(12), 'hub max'.padStart(12), 'counter now'.padStart(12), 'counter new'.padStart(12));
for (const table of LEADS) {
  // Every column of this table that a sequence feeds (serial, bigserial or identity).
  const cols = (await pool.query(
    `select a.attname as col, pg_get_serial_sequence($1, a.attname) as seq
       from pg_attribute a where a.attrelid = to_regclass($1) and a.attnum > 0 and not a.attisdropped
        and pg_get_serial_sequence($1, a.attname) is not null`, ['public.' + q(table)])).rows as Array<{ col: string; seq: string }>;
  for (const { col, seq } of cols) {
    const label = `${table}.${col}`.padEnd(36);
    try {
      const srcMax = Number((await src(`select coalesce(max(${q(col)}), 0)::text as n from ${q(table)}`))[0]?.n ?? 0);
      const hubMax = Number((await pool.query(`select coalesce(max(${q(col)}), 0)::text as n from ${q(table)}`)).rows[0].n);
      const s = (await pool.query(`select last_value::text as v, is_called from ${seq}`)).rows[0];
      const now = Number(s.v) + (s.is_called ? 1 : 0); // the next id it would hand out
      const want = Math.max(srcMax, hubMax) + MARGIN;
      if (now >= want) { console.log(label, String(srcMax).padStart(12), String(hubMax).padStart(12), String(now).padStart(12), 'kept'.padStart(12)); continue; }
      if (APPLY) await pool.query(`select setval($1, $2, false)`, [seq, want]);
      console.log(label, String(srcMax).padStart(12), String(hubMax).padStart(12), String(now).padStart(12), String(want).padStart(12));
    } catch (err) {
      failed++;
      console.log(label, 'FAILED: ' + (err as Error).message.slice(0, 200));
    }
  }
}
await pool.end();
console.log(failed ? `${failed} counter(s) failed` : APPLY ? 'done: every counter is past the source' : 'plan done: nothing changed');
process.exit(failed ? 1 : 0);
