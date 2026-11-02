// One-time copy of company-diver's data out of agy-lab's database (pg_2nd, read through
// the pg-proxy) into this service's own Postgres (DATABASE_URL, MirrorDB).
//
// Run it INSIDE the Railway service, where DATABASE_URL is the private address:
//   railway ssh --service company-diver
//   node scripts/import-from-pg2nd.ts --dry-run
//   node scripts/import-from-pg2nd.ts
// Notes and the table list: scripts/IMPORT.md.
//
// Source variables:  SRC_PG_PROXY_URL  SRC_PG_DB_NAME  SRC_PG_PROXY_TOKEN  (read-only is enough)
// Target variable:   DATABASE_URL
//
// The source is never written to: every request it sends is a SELECT.
//
// How a row travels. Each source column is read as ::text and written back with an
// explicit cast to its own type (jsonb, text[], timestamptz, numeric, bigint ...), so
// nothing passes through a JavaScript number or Date: bigint ids, numeric(…) and
// microsecond timestamps arrive exactly as they left. Strings are made well-formed
// before they go out (a lone surrogate is legal JSON and illegal Postgres json).
//
// Safe to re-run: rows land with ON CONFLICT DO NOTHING. A table with no primary key
// is only loaded while it is empty here (or with --truncate).
//
// Flags
//   --dry-run          read the source only: print plan, counts, DDL and the first insert; write nothing
//   --tables a,b       only these tables (default: the core group)
//   --group core|leads|all   which table group (default core)
//   --truncate         empty the selected tables here first (no CASCADE)
//   --resume           start each table after the last primary key already here (big tables, nothing else wrote to them)
//   --batch N          rows per request, upper bound (default 200; shrinks on its own for fat rows)
//   --skip-migrate     do not apply schema.sql / reportdb.migrate() first
//   --schema PATH      schema.sql location (default ../schema.sql)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// ---------------------------------------------------------------- what to copy

/** Everything the three pipelines, their workers and the key pool read or write. */
const CORE = [
  'llm_lane',            // LLM lanes edited on /workers (core/llm.ts) -- holds API keys
  'gemini_contact_key',  // key pool: tavily / exa / brave / minimax / scraper_tech / smartlead / pagespeed ... (contact-keys.ts)
  'search_key_spend',    // what each key in that pool has spent (reportdb.addSearchKeySpend)
  'maps_usage',          // Google Maps requests per month, written by maps-worker.ts
  'company_dive',        // company dive runs, dossiers and public pages (companydive*.ts)
  'dive_deeper',         // dive-deeper runs and report_html (divedeeper.ts)
  'dive_preview',        // free preview per company dive (divedeeper.ts)
];

/** The lead-pipeline tables. Only for a copy that keeps the lead routes; the three pipelines do not touch them. */
const LEADS = [
  'telemarketer', 'company_data', 'search_report', 'search_report_company', 'published_report',
  'company_research_run', 'person_research_run', 'contact_research_run', 'ads_research_run', 'ads_market_run',
  'run_event', 'company_email', 'taman_assignment', 'taman_finder_town', 'territory_discovered',
  'lead_activity_log', 'atap_solar_registrations', 'company', 'company_place',
  'search_list_run', 'search_list_search', 'search_list_place', 'list_step2_job', 'list_step2_lead',
  'email_marketing_lead', 'email_marketing_event', 'email_marketing_draft',
];

// ---------------------------------------------------------------- arguments

const argv = process.argv.slice(2);
const flag = (name: string): boolean => argv.includes('--' + name);
const opt = (name: string): string | undefined => {
  const i = argv.indexOf('--' + name);
  return i >= 0 ? argv[i + 1] : undefined;
};

const DRY = flag('dry-run');
const TRUNCATE = flag('truncate');
const RESUME = flag('resume');
const SKIP_MIGRATE = flag('skip-migrate');
const MAX_BATCH = Math.max(1, Number(opt('batch') ?? 200));
const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA = opt('schema') ?? path.join(HERE, '..', 'schema.sql');

const group = opt('group') ?? 'core';
const TABLES: string[] = opt('tables')
  ? opt('tables')!.split(',').map((s) => s.trim()).filter(Boolean)
  : group === 'all' ? [...CORE, ...LEADS] : group === 'leads' ? LEADS : CORE;

const SRC_URL = (process.env.SRC_PG_PROXY_URL ?? '').replace(/\/+$/, '');
const SRC_DB = process.env.SRC_PG_DB_NAME ?? '';
const SRC_TOKEN = process.env.SRC_PG_PROXY_TOKEN ?? '';
if (!SRC_URL || !SRC_DB || !SRC_TOKEN) {
  console.error('set SRC_PG_PROXY_URL, SRC_PG_DB_NAME and SRC_PG_PROXY_TOKEN');
  process.exit(2);
}
if (!DRY && !process.env.DATABASE_URL?.trim()) {
  console.error('set DATABASE_URL (run this inside the Railway service), or pass --dry-run');
  process.exit(2);
}

// ---------------------------------------------------------------- helpers

type Row = Record<string, string | null>;
const q = (ident: string): string => '"' + ident.replace(/"/g, '""') + '"';
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const log = (msg: string): void => console.log(msg);

/** A well-formed copy of any JSON value: lone surrogates become U+FFFD. */
const wellFormed = (value: unknown): string =>
  JSON.stringify(value ?? null, (_k, v) => (typeof v === 'string' ? v.toWellFormed() : v)) ?? 'null';

let lastBytes = 0;

/** One read-only request to the pg-proxy, with retries. */
async function src(sql: string, params: unknown[] = []): Promise<Row[]> {
  let lastErr: Error = new Error('no attempt');
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const res = await fetch(SRC_URL + '/api/sql', {
        method: 'POST',
        headers: { authorization: 'Bearer ' + SRC_TOKEN, 'content-type': 'application/json' },
        body: JSON.stringify({ db_name: SRC_DB, sql, params }),
        signal: AbortSignal.timeout(120_000),
      });
      const text = await res.text();
      lastBytes = text.length;
      if (res.status === 401 || res.status === 403) throw Object.assign(new Error('pg-proxy ' + res.status + ': ' + text.slice(0, 200)), { fatal: true });
      if (!res.ok) throw new Error('pg-proxy ' + res.status + ': ' + text.slice(0, 300));
      return (JSON.parse(text) as { rows?: Row[] }).rows ?? [];
    } catch (err) {
      lastErr = err as Error;
      if ((err as { fatal?: boolean }).fatal) break;
      await sleep(1000 * attempt);
    }
  }
  throw lastErr;
}

// ---------------------------------------------------------------- source catalog

interface Col { name: string; type: string; notNull: boolean; def: string | null; identity: string; generated: string }
interface Meta {
  table: string;
  cols: Col[];
  pk: Col[];
  constraints: Array<{ name: string; kind: string; def: string }>;
  indexes: Array<{ name: string; def: string }>;
}

async function readMeta(table: string): Promise<Meta | null> {
  const cols = (await src(`
    select a.attname as name, format_type(a.atttypid, a.atttypmod) as type, a.attnotnull as nn,
           pg_get_expr(d.adbin, d.adrelid) as def, a.attidentity as idn, a.attgenerated as gen
    from pg_attribute a
    join pg_class c on c.oid = a.attrelid
    join pg_namespace n on n.oid = c.relnamespace
    left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
    where n.nspname = 'public' and c.relname = $1 and c.relkind = 'r' and a.attnum > 0 and not a.attisdropped
    order by a.attnum`, [table])).map((r): Col => ({
    name: String(r.name), type: String(r.type), notNull: String(r.nn) === 'true' || (r.nn as unknown) === true,
    def: r.def, identity: String(r.idn ?? ''), generated: String(r.gen ?? ''),
  }));
  if (!cols.length) return null;
  const byName = new Map(cols.map((c) => [c.name, c]));
  const pkNames = (await src(`
    select a.attname as name
    from pg_index i
    join pg_class c on c.oid = i.indrelid
    join pg_namespace n on n.oid = c.relnamespace
    join lateral unnest(i.indkey) with ordinality as k(attnum, ord) on true
    join pg_attribute a on a.attrelid = c.oid and a.attnum = k.attnum
    where i.indisprimary and n.nspname = 'public' and c.relname = $1
    order by k.ord`, [table])).map((r) => String(r.name));
  const constraints = (await src(`
    select conname as name, contype as kind, pg_get_constraintdef(oid) as def
    from pg_constraint
    where conrelid = ('public.' || quote_ident($1))::regclass and contype in ('p', 'u', 'c', 'f')
    order by contype, conname`, [table])).map((r) => ({ name: String(r.name), kind: String(r.kind), def: String(r.def) }));
  const owned = new Set(constraints.map((c) => c.name));
  const indexes = (await src(
    `select indexname as name, indexdef as def from pg_indexes where schemaname = 'public' and tablename = $1 order by indexname`,
    [table])).map((r) => ({ name: String(r.name), def: String(r.def) })).filter((i) => !owned.has(i.name));
  return { table, cols, pk: pkNames.map((n) => byName.get(n)!), constraints, indexes };
}

// ---------------------------------------------------------------- DDL for a table the target lacks

const SERIAL: Record<string, string> = { bigint: 'bigserial', integer: 'serial', smallint: 'smallserial' };
const nextvalOf = (def: string | null): string | null => def?.match(/^nextval\('(.+)'::regclass\)$/)?.[1].replace(/"/g, '').replace(/^public\./, '') ?? null;
const isSerial = (table: string, c: Col): boolean => {
  const seq = nextvalOf(c.def);
  return !!seq && seq === `${table}_${c.name}_seq` && c.type in SERIAL;
};

function createSql(m: Meta): string[] {
  const out: string[] = [];
  const lines: string[] = [];
  for (const c of m.cols) {
    if (c.generated === 's') {
      lines.push(`${q(c.name)} ${c.type} generated always as (${c.def}) stored${c.notNull ? ' not null' : ''}`);
      continue;
    }
    let line = q(c.name) + ' ';
    if (isSerial(m.table, c)) {
      line += SERIAL[c.type];
    } else {
      line += c.type;
      if (c.identity === 'a') line += ' generated always as identity';
      else if (c.identity === 'd') line += ' generated by default as identity';
      else if (c.def) {
        const seq = nextvalOf(c.def);
        if (seq) out.push(`create sequence if not exists ${q(seq)}`);
        line += ' default ' + c.def;
      }
    }
    if (c.notNull && !isSerial(m.table, c) && !c.identity) line += ' not null';
    lines.push(line);
  }
  for (const k of m.constraints.filter((k) => k.kind !== 'f')) lines.push(`constraint ${q(k.name)} ${k.def}`);
  out.push(`create table if not exists ${q(m.table)} (\n  ${lines.join(',\n  ')}\n)`);
  return out;
}

const indexSql = (def: string): string => def.replace(/^CREATE (UNIQUE )?INDEX /, 'CREATE $1INDEX IF NOT EXISTS ');
const insertable = (m: Meta): Col[] => m.cols.filter((c) => c.generated !== 's');

// ---------------------------------------------------------------- rows

const castFrom = (c: Col): string => `x.${q(c.name)}` + (c.type === 'text' ? '' : `::${c.type}`);

/** Source read: every column as text, keyset-paged by primary key (OFFSET by ctid when there is none). */
function readSql(m: Meta, limit: number, after: boolean): string {
  const cols = insertable(m).map((c) => `t.${q(c.name)}::text as ${q(c.name)}`).join(', ');
  if (!m.pk.length) return `select ${cols} from ${q(m.table)} t order by t.ctid offset $1 limit ${limit}`;
  // t."col": a bare "col" in ORDER BY would sort by the ::text output column of the same name (10 before 6).
  const key = m.pk.map((c) => 't.' + q(c.name)).join(', ');
  const where = after ? ` where (${key}) > (${m.pk.map((c, i) => `$${i + 1}::${c.type}`).join(', ')})` : '';
  return `select ${cols} from ${q(m.table)} t${where} order by ${key} limit ${limit}`;
}

function insertSql(m: Meta): string {
  const cols = insertable(m);
  const override = m.cols.some((c) => c.identity === 'a') ? ' overriding system value' : '';
  return `insert into ${q(m.table)} (${cols.map((c) => q(c.name)).join(', ')})${override}
    select ${cols.map(castFrom).join(', ')}
    from jsonb_to_recordset($1::jsonb) as x(${cols.map((c) => q(c.name) + ' text').join(', ')})
    on conflict do nothing`;
}

/** Dry-run proof that the cast chain is lossless: send rows through the insert's own SELECT (on the source, read-only) and compare. */
async function verifyCasts(m: Meta, sample: Row[]): Promise<string> {
  // The proxy 502s on request bodies over ~1 MB and, measured, corrupts multi-byte characters that straddle
  // a chunk boundary in bodies over ~64 KB (a Chinese character came back as U+FFFD U+FFFD). The real write goes
  // straight to Postgres with neither problem, so this check only sends small bodies.
  const full = sample;
  const fit: Row[] = [];
  for (const row of sample) { if (wellFormed([...fit, row]).length < 60_000) fit.push(row); }
  if (!fit.length) return 'rows too large to round-trip through the proxy (the real import does not send them through it)';
  sample = fit;
  const cols = insertable(m);
  const back = await src(
    `select ${cols.map((c) => `(${castFrom(c)})::text as ${q(c.name)}`).join(', ')}
     from jsonb_to_recordset($1::jsonb) as x(${cols.map((c) => q(c.name) + ' text').join(', ')})`, [wellFormed(sample)]);
  let diffs = 0;
  back.forEach((row, i) => { for (const c of cols) if (row[c.name] !== sample[i][c.name]) { diffs++; console.error(`   differs: ${m.table}.${c.name} row ${i}`); } });
  if (m.pk.length) {
    const next = await src(readSql(m, 1, true), m.pk.map((c) => String(full[full.length - 1][c.name])));
    const cmp = await src(readSql(m, full.length + 1, false), []);
    if (cmp.length > full.length && next[0] && next[0][m.pk[0].name] !== cmp[full.length][m.pk[0].name]) diffs++;
  }
  return diffs ? `${diffs} DIFFERENCES` : `lossless on ${sample.length} row(s), keyset page OK`;
}

// ---------------------------------------------------------------- the copy

interface Pool { query(text: string, params?: unknown[]): Promise<{ rows: Array<Record<string, unknown>>; rowCount: number | null }>; end(): Promise<void> }
let dst: Pool | null = null;
const d = async (text: string, params?: unknown[]) => dst!.query(text, params);

async function exists(table: string): Promise<boolean> {
  return (await d(`select to_regclass($1) is not null as ok`, ['public.' + q(table)])).rows[0].ok === true;
}

async function ensureTable(m: Meta): Promise<void> {
  if (!(await exists(m.table))) {
    for (const stmt of createSql(m)) await d(stmt);
    log(`  created ${m.table} from the source catalog`);
  } else {
    const have = new Set((await d(
      `select column_name from information_schema.columns where table_schema = 'public' and table_name = $1`, [m.table])).rows.map((r) => String(r.column_name)));
    for (const c of m.cols.filter((c) => !have.has(c.name) && c.generated !== 's')) {
      await d(`alter table ${q(m.table)} add column if not exists ${q(c.name)} ${c.type}${c.def && !nextvalOf(c.def) ? ' default ' + c.def : ''}`);
      log(`  ${m.table}: added missing column ${c.name}`);
    }
  }
  // Unique indexes first: ON CONFLICT DO NOTHING needs them in place before rows arrive.
  for (const i of m.indexes.filter((i) => /^CREATE UNIQUE INDEX/.test(i.def))) await d(indexSql(i.def));
}

/** Write one batch; on failure split it until the one bad row is known, skip it and say which. */
async function writeBatch(m: Meta, rows: Row[], sql: string, stats: { inserted: number; skipped: number }): Promise<void> {
  try {
    const out = await d(sql, [wellFormed(rows)]);
    stats.inserted += out.rowCount ?? 0;
  } catch (err) {
    if (rows.length === 1) {
      stats.skipped++;
      const key = m.pk.map((c) => `${c.name}=${rows[0][c.name]}`).join(' ');
      console.error(`  ! ${m.table}: row skipped (${key || 'no key'}): ${(err as Error).message.slice(0, 200)}`);
      return;
    }
    const mid = rows.length >> 1;
    await writeBatch(m, rows.slice(0, mid), sql, stats);
    await writeBatch(m, rows.slice(mid), sql, stats);
  }
}

async function copyTable(m: Meta, srcCount: number): Promise<{ inserted: number; skipped: number }> {
  const stats = { inserted: 0, skipped: 0 };
  const sql = insertSql(m);
  const here = Number((await d(`select count(*)::bigint as n from ${q(m.table)}`)).rows[0].n);
  if (!m.pk.length && here > 0 && !TRUNCATE) {
    log(`  ${m.table}: no primary key and ${here} rows already here; skipped (use --truncate to reload)`);
    return stats;
  }
  let after: string[] | null = null;
  if (RESUME && m.pk.length && here > 0) {
    const last = (await d(`select ${m.pk.map((c) => 't.' + q(c.name) + '::text as ' + q(c.name)).join(', ')} from ${q(m.table)} t order by ${m.pk.map((c) => 't.' + q(c.name) + ' desc').join(', ')} limit 1`)).rows[0];
    after = m.pk.map((c) => String(last[c.name]));
    log(`  ${m.table}: resuming after ${after.join(',')}`);
  }
  let batch = Math.min(MAX_BATCH, 10);
  let offset = 0;
  let done = 0;
  for (;;) {
    const limit = batch;
    let rows: Row[];
    try {
      rows = await src(readSql(m, limit, !!after), m.pk.length ? (after ?? []) : [offset]);
    } catch (err) {
      if (limit === 1) throw err;
      batch = Math.max(1, limit >> 1);
      continue;
    }
    if (!rows.length) break;
    await writeBatch(m, rows, sql, stats);
    done += rows.length;
    offset += rows.length;
    if (m.pk.length) after = m.pk.map((c) => String(rows[rows.length - 1][c.name]));
    process.stdout.write(`\r  ${m.table}: ${done}/${srcCount}   `);
    if (rows.length < limit) break;
    // Aim for ~3 MB a request: fat rows (dossiers, report_html) shrink the batch, thin ones grow it.
    const scale = Math.sqrt(3_000_000 / Math.max(lastBytes, 1));
    batch = Math.max(1, Math.min(MAX_BATCH, Math.floor(limit * Math.min(scale, 2))));
  }
  process.stdout.write('\n');
  return stats;
}

async function resetSequences(m: Meta): Promise<void> {
  for (const c of m.cols.filter((c) => isSerial(m.table, c) || c.identity)) {
    await d(`select setval(pg_get_serial_sequence($1, $2), coalesce(max(${q(c.name)}), 0) + 1, false) from ${q(m.table)}`, [q(m.table), c.name]);
  }
}

async function addForeignKeys(metas: Meta[]): Promise<void> {
  const chosen = new Set(metas.map((m) => m.table));
  for (const m of metas) {
    for (const k of m.constraints.filter((k) => k.kind === 'f')) {
      const ref = k.def.match(/REFERENCES\s+"?([a-z_0-9]+)"?\(/i)?.[1];
      if (!ref || !chosen.has(ref)) continue; // points at a table this copy does not carry
      const has = (await d(`select 1 from pg_constraint where conname = $1 and conrelid = to_regclass($2)`, [k.name, 'public.' + q(m.table)])).rows.length > 0;
      if (has) continue;
      try {
        await d(`alter table ${q(m.table)} add constraint ${q(k.name)} ${k.def}`);
      } catch (err) {
        await d(`alter table ${q(m.table)} add constraint ${q(k.name)} ${k.def} not valid`).catch(() => {});
        console.error(`  ! ${m.table}.${k.name}: rows break it (${(err as Error).message.slice(0, 120)}); added NOT VALID`);
      }
    }
  }
}

// ---------------------------------------------------------------- main

async function main(): Promise<void> {
  log(`${DRY ? 'DRY RUN' : 'IMPORT'}  source ${SRC_DB} @ ${SRC_URL}  tables: ${TABLES.join(', ')}`);

  const metas: Meta[] = [];
  const counts = new Map<string, number>();
  for (const t of TABLES) {
    const m = await readMeta(t);
    if (!m) { console.error(`  ! ${t}: not found in the source; skipped`); continue; }
    metas.push(m);
    counts.set(t, Number((await src(`select count(*)::bigint as n from ${q(t)}`))[0].n));
    log(`  ${t.padEnd(24)} ${String(counts.get(t)).padStart(8)} rows  pk(${m.pk.map((c) => c.name).join(',') || 'none'})  ${m.cols.length} cols`);
  }

  if (DRY) {
    for (const m of metas) {
      log(`\n-- ${m.table}: DDL used only if the target lacks the table`);
      log(createSql(m).join(';\n') + ';');
      for (const i of m.indexes) log(indexSql(i.def) + ';');
      for (const k of m.constraints.filter((k) => k.kind === 'f')) log(`-- fk ${k.name}: ${k.def}`);
      const sample = await src(readSql(m, 2, false), m.pk.length ? [] : [0]);
      log(`-- first read: ${sample.length} row(s), ${lastBytes} bytes; insert statement:\n${insertSql(m).replace(/\n\s+/g, '\n  ')}`);
      log(`-- cast round trip: ${await verifyCasts(m, sample)}`);
    }
    log('\nDry run done: nothing was written.');
    return;
  }

  const { default: pg } = await import('pg');
  dst = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2, connectionTimeoutMillis: 15_000 }) as unknown as Pool;
  await d('select 1');

  if (!SKIP_MIGRATE) {
    if (!fs.existsSync(SCHEMA)) throw new Error(`schema.sql not found at ${SCHEMA}; copy agy-lab/schema.sql into the image or pass --schema`);
    log('applying schema.sql ...');
    await d(fs.readFileSync(SCHEMA, 'utf8'));
    log('running reportdb.migrate() ...');
    const reportdb = await import(pathToFileURL(path.join(HERE, '..', 'src', 'reportdb.ts')).href) as { migrate(): Promise<void> };
    await reportdb.migrate();
  }

  if (TRUNCATE) {
    await d(`truncate table ${metas.map((m) => q(m.table)).join(', ')} restart identity`);
    log('truncated: ' + metas.map((m) => m.table).join(', '));
  }

  const failures: string[] = [];
  const skipped = new Map<string, number>();
  for (const m of metas) {
    log(`\n${m.table}`);
    try {
      await ensureTable(m);
      const stats = await copyTable(m, counts.get(m.table) ?? 0);
      skipped.set(m.table, stats.skipped);
      for (const i of m.indexes.filter((i) => !/^CREATE UNIQUE INDEX/.test(i.def))) await d(indexSql(i.def));
      await resetSequences(m);
      log(`  inserted ${stats.inserted}${stats.skipped ? `, SKIPPED ${stats.skipped}` : ''}`);
    } catch (err) {
      failures.push(m.table);
      console.error(`  ! ${m.table} failed: ${(err as Error).message}`);
    }
  }
  await addForeignKeys(metas.filter((m) => !failures.includes(m.table)));

  log('\ntable                      source      target');
  let bad = failures.length;
  for (const m of metas) {
    const here = Number((await d(`select count(*)::bigint as n from ${q(m.table)}`).catch(() => ({ rows: [{ n: -1 }] }))).rows[0].n);
    const want = counts.get(m.table) ?? 0;
    const ok = here === want && !failures.includes(m.table);
    if (!ok) bad++;
    log(`${m.table.padEnd(24)} ${String(want).padStart(8)}  ${String(here).padStart(10)}  ${ok ? 'OK' : 'MISMATCH' + (skipped.get(m.table) ? ` (${skipped.get(m.table)} row(s) skipped)` : '')}`);
  }
  await dst.end();
  log(bad ? `\n${bad} table(s) need attention.` : '\nAll counts match.');
  process.exit(bad ? 1 : 0);
}

main().catch((err) => {
  console.error('import failed: ' + (err as Error).message);
  process.exit(1);
});
