// READ ONLY. For each table: every primary key in the source (pg_2nd) that the archive schema lacks.
// Proves an archive copy is complete even while the source still grows.
//
//   node scripts/archive-diff.ts <schema> <table,table,...>
//
// Env: DATABASE_URL, SRC_PG_PROXY_URL, SRC_PG_DB_NAME, SRC_PG_PROXY_TOKEN.
import pg from 'pg';

const [schema, list] = process.argv.slice(2);
if (!schema || !list || !/^[a-z_][a-z0-9_]*$/.test(schema)) { console.error('usage: archive-diff.ts <schema> <tables>'); process.exit(2); }
const PAGE = 20_000;
const q = (ident: string): string => '"' + ident.replace(/"/g, '""') + '"';

async function src(sql: string, params: unknown[] = []): Promise<Array<Record<string, string>>> {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch((process.env.SRC_PG_PROXY_URL ?? '').replace(/\/+$/, '') + '/api/sql', {
        method: 'POST',
        headers: { authorization: 'Bearer ' + process.env.SRC_PG_PROXY_TOKEN, 'content-type': 'application/json' },
        body: JSON.stringify({ db_name: process.env.SRC_PG_DB_NAME, sql, params }),
        signal: AbortSignal.timeout(120_000),
      });
      const text = await res.text();
      if (!res.ok) throw new Error('pg-proxy ' + res.status + ': ' + text.slice(0, 300));
      return (JSON.parse(text) as { rows?: Array<Record<string, string>> }).rows ?? [];
    } catch (err) {
      if (attempt >= 4) throw err;
      await new Promise((r) => setTimeout(r, 1000 * attempt));
    }
  }
}

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
let missingAll = 0;
for (const table of list.split(',').map((s) => s.trim()).filter(Boolean)) {
  // Primary key columns and their types, from the archive's own table.
  const pk = (await pool.query(
    `select a.attname as name, format_type(a.atttypid, a.atttypmod) as type
       from pg_index i join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey)
      where i.indrelid = to_regclass($1) and i.indisprimary order by array_position(i.indkey, a.attnum)`,
    [`${schema}.${q(table)}`])).rows as Array<{ name: string; type: string }>;
  if (!pk.length) { console.log(`${table}: no primary key in ${schema}; skipped`); continue; }
  let after: string[] | null = null, seen = 0, missing = 0;
  const examples: string[] = [];
  for (;;) {
    // t."col", never a bare "col": ORDER BY a bare name sorts by the ::text output column (10 before 6) and skips rows.
    const key = pk.map((c) => 't.' + q(c.name)).join(', ');
    const where = after ? `where (${key}) > (${pk.map((c, i) => `$${i + 1}::${c.type}`).join(', ')})` : '';
    const rows = await src(`select ${pk.map((c) => `t.${q(c.name)}::text as ${q(c.name)}`).join(', ')} from ${q(table)} t ${where} order by ${key} limit ${PAGE}`, after ?? []);
    if (!rows.length) break;
    seen += rows.length;
    const arrays = pk.map((c) => rows.map((r) => r[c.name]));
    const join = pk.map((c, i) => `t.${q(c.name)} = u.c${i}`).join(' and ');
    const found = (await pool.query(
      `select ${pk.map((c, i) => `u.c${i}::text as c${i}`).join(', ')}
         from unnest(${pk.map((c, i) => `$${i + 1}::${c.type}[]`).join(', ')}) as u(${pk.map((_, i) => `c${i}`).join(', ')})
        where not exists (select 1 from ${schema}.${q(table)} t where ${join})`, arrays)).rows;
    missing += found.length;
    for (const f of found.slice(0, 5 - examples.length)) examples.push(Object.values(f).join('/'));
    const last = rows[rows.length - 1];
    after = pk.map((c) => last[c.name]);
    if (rows.length < PAGE) break;
  }
  const archived = Number((await pool.query(`select count(*)::text n from ${schema}.${q(table)}`)).rows[0].n);
  console.log(`${table.padEnd(24)} source keys now ${String(seen).padStart(8)}  archive rows ${String(archived).padStart(8)}  MISSING ${missing}${examples.length ? '  e.g. ' + examples.join(', ') : ''}`);
  missingAll += missing;
}
await pool.end();
console.log(missingAll ? `${missingAll} source row(s) not in the archive` : 'every source row is in the archive');
process.exit(missingAll ? 1 : 0);
