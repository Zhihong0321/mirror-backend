// READ ONLY. A company dive reduced to what a no-behaviour-change deploy must keep the same: the stage
// sequence, the log message shapes (numbers and quoted text masked, since they differ run to run), the
// result's fields, the counters, the dossier and the free preview. Two snapshots are compared line by
// line for a seam's live proof (docs/contracts/wave0-seams.md).
//
//   node scripts/dive-snapshot.ts <company_dive id>
//
// Env: DATABASE_URL.
import pg from 'pg';

const id = Number(process.argv[2]);
if (!id) { console.error('usage: dive-snapshot.ts <company_dive id>'); process.exit(2); }
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
const row = (await pool.query(`select * from company_dive where id = $1`, [id])).rows[0];
if (!row) { console.error(`no company_dive ${id}`); process.exit(1); }

/** A log line's shape: what code wrote it, not what this run found. */
const shape = (msg: string): string => msg
  .replace(/https?:\/\/\S+/g, '<url>')
  .replace(/"[^"]*"|'[^']*'|“[^”]*”/g, '<text>')
  .replace(/\d+(\.\d+)?/g, '#')
  .slice(0, 140);
const keys = (o: unknown): string => (o && typeof o === 'object' ? Object.keys(o as object).sort().join(',') : String(o));
const log: Array<{ stage: string; msg: string }> = row.log ?? [];
const r = row.result ?? {};
const preview = (await pool.query(`select notes, meter is not null as metered from dive_preview where dive_id = $1`, [id])).rows[0];

const out: string[] = [];
out.push(`status ${row.status}`);
out.push(`tries ${row.tries ?? 'n/a'}`);
out.push(`columns ${Object.keys(row).sort().join(',')}`);
out.push(`stages ${[...new Set(log.map((l) => l.stage))].join(' > ')}`);
for (const l of log) out.push(`log ${l.stage}: ${shape(l.msg)}`);
out.push(`result fields ${keys(r)}`);
out.push(`identity fields ${keys(r.identity)}`);
out.push(`facts ${Array.isArray(r.facts) ? 'list' : typeof r.facts}, sources ${Array.isArray(r.sources) ? 'list' : typeof r.sources}`);
out.push(`warnings ${JSON.stringify(r.warnings ?? null)}`);
out.push(`people fields ${keys(r.people)}`);
out.push(`counters tavily ${row.tavily_calls > 0 ? '>0' : '0'}, brave ${row.brave_calls > 0 ? '>0' : '0'}, llm ${row.llm_calls > 0 ? '>0' : '0'}`);
out.push(`dossier ${row.dossier ? 'written' : 'none'}`);
out.push(`error ${row.error ?? 'none'}`);
out.push(`preview ${preview ? 'written, notes fields ' + keys(preview.notes) + ', metered ' + preview.metered : 'none'}`);
out.push(`public_id ${row.public_id ? 'set' : 'none'}`);
console.log(out.join('\n'));
await pool.end();
