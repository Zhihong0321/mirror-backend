// READ ONLY. Lists hub rows that sit on an id the source (pg_2nd) also uses for a DIFFERENT row
// (must-fix-checklist, lead import A2/A3). A hub row is the copied source row when the source row
// with the same id has the same identity value: public_id where the table has one, else
// created_at, else at. Writes nothing anywhere.
//
//   node scripts/id-collisions.ts [table,table,...]      # default: every lead table with an id counter
//
// Env: DATABASE_URL, SRC_PG_PROXY_URL, SRC_PG_DB_NAME, SRC_PG_PROXY_TOKEN.
import pg from 'pg';

const TABLES = (process.argv[2]?.split(',') ?? [
  'published_report', 'search_report', 'company_data', 'run_event', 'lead_activity_log', 'telemarketer',
  'taman_assignment', 'taman_finder_town', 'territory_discovered', 'atap_solar_registrations', 'email_marketing_event',
]).map((s) => s.trim()).filter(Boolean);
const CHUNK = 2000;

const SRC_URL = (process.env.SRC_PG_PROXY_URL ?? '').replace(/\/+$/, '');
const SRC_DB = process.env.SRC_PG_DB_NAME ?? '';
const SRC_TOKEN = process.env.SRC_PG_PROXY_TOKEN ?? '';
if (!SRC_URL || !SRC_DB || !SRC_TOKEN || !process.env.DATABASE_URL?.trim()) {
  console.error('set DATABASE_URL, SRC_PG_PROXY_URL, SRC_PG_DB_NAME and SRC_PG_PROXY_TOKEN');
  process.exit(2);
}
const q = (ident: string): string => '"' + ident.replace(/"/g, '""') + '"';

async function src(sql: string): Promise<Array<Record<string, string | null>>> {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(SRC_URL + '/api/sql', {
        method: 'POST',
        headers: { authorization: 'Bearer ' + SRC_TOKEN, 'content-type': 'application/json' },
        body: JSON.stringify({ db_name: SRC_DB, sql, params: [] }),
        signal: AbortSignal.timeout(120_000),
      });
      const text = await res.text();
      if (!res.ok) throw new Error('pg-proxy ' + res.status + ': ' + text.slice(0, 300));
      return (JSON.parse(text) as { rows?: Array<Record<string, string | null>> }).rows ?? [];
    } catch (err) {
      if (attempt >= 4) throw err;
      await new Promise((r) => setTimeout(r, 1000 * attempt));
    }
  }
}

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
for (const table of TABLES) {
  const cols = (await pool.query(`select column_name from information_schema.columns where table_schema = 'public' and table_name = $1`, [table])).rows.map((r) => r.column_name as string);
  // run_event.public_id is often null, so its time is the better identity; company_data has place_id (unique).
  const key = (table === 'run_event' ? ['at'] : ['public_id', 'place_id', 'created_at', 'at']).find((c) => cols.includes(c));
  if (!key) { console.log(`${table}: no identity column (public_id, created_at, at); skipped`); continue; }
  // Timestamps compare as epoch seconds: their text form depends on each session's time zone.
  const expr = key === 'public_id' || key === 'place_id' ? q(key) : `extract(epoch from ${q(key)})`;
  const srcMax = Number((await src(`select coalesce(max(id), 0)::text as n from ${q(table)}`))[0]?.n ?? 0);
  const hub = (await pool.query(`select id::text as id, (${expr})::text as k from ${q(table)} where id <= $1 order by id`, [srcMax])).rows as Array<{ id: string; k: string | null }>;
  let same = 0, missingInSource = 0;
  const clashes: Array<{ id: string; hub: string | null; source: string | null }> = [];
  for (let i = 0; i < hub.length; i += CHUNK) {
    const part = hub.slice(i, i + CHUNK);
    const rows = await src(`select id::text as id, (${expr})::text as k from ${q(table)} where id in (${part.map((r) => Number(r.id)).join(',')})`);
    const bySrc = new Map(rows.map((r) => [r.id, r.k]));
    for (const r of part) {
      if (!bySrc.has(r.id)) { missingInSource++; continue; }
      if (bySrc.get(r.id) === r.k) same++;
      else clashes.push({ id: r.id, hub: r.k, source: bySrc.get(r.id) ?? null });
    }
  }
  console.log(`${table} (by ${key}): hub rows at source ids ${hub.length}, same row ${same}, hub-only id (no source row) ${missingInSource}, COLLISIONS ${clashes.length}`);
  for (const c of clashes.slice(0, 300)) console.log(`  id ${c.id}: hub ${c.hub} | source ${c.source}`);
  if (clashes.length > 300) console.log(`  ... ${clashes.length - 300} more`);
}
await pool.end();
process.exit(0);
