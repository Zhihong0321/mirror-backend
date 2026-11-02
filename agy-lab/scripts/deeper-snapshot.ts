// READ ONLY. A dive-deeper run reduced to what a no-behaviour-change deploy must keep the same: the stage
// sequence, the log message shapes (numbers and quoted text masked), each lane's place and status, the report,
// and the free preview of a company dive. Two snapshots are compared line by line (docs/contracts/wave0-seams.md).
//
//   node scripts/deeper-snapshot.ts <dive_deeper id> [<company_dive id whose preview to show>]
//
// Env: DATABASE_URL.
import pg from 'pg';

const id = Number(process.argv[2]);
const previewOf = Number(process.argv[3] ?? 0);
if (!id) { console.error('usage: deeper-snapshot.ts <dive_deeper id> [company_dive id]'); process.exit(2); }
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
const row = (await pool.query(`select * from dive_deeper where id = $1`, [id])).rows[0];
if (!row) { console.error(`no dive_deeper ${id}`); process.exit(1); }

const shape = (msg: string): string => msg
  .replace(/https?:\/\/\S+/g, '<url>')
  .replace(/"[^"]*"|'[^']*'|“[^”]*”/g, '<text>')
  .replace(/\d+(\.\d+)?/g, '#')
  .slice(0, 140);
const keys = (o: unknown): string => (o && typeof o === 'object' ? Object.keys(o as object).sort().join(',') : String(o));
const log: Array<{ stage: string; msg: string }> = row.log ?? [];
const lanes: Record<string, any> = row.lanes ?? {};

const out: string[] = [];
out.push(`status ${row.status}`);
out.push(`resumes ${row.resumes ?? 'n/a'}`);
out.push(`columns ${Object.keys(row).sort().join(',')}`);
out.push(`stages ${[...new Set(log.map((l) => l.stage))].join(' > ')}`);
for (const l of log) out.push(`log ${l.stage}: ${shape(l.msg)}`);
out.push(`lanes ${Object.keys(lanes).join(' > ')}`);
for (const [k, v] of Object.entries(lanes)) out.push(`lane ${k}: ${v?.status ?? '?'} fields ${keys(v)}`);
out.push(`report ${row.report_html ? 'written' : 'none'}`);
out.push(`error ${row.error ?? 'none'}`);
out.push(`public_id ${row.public_id ? 'set' : 'none'}`);
if (previewOf) {
  const p = (await pool.query(`select notes, meter is not null as metered from dive_preview where dive_id = $1`, [previewOf])).rows[0];
  out.push(`preview ${p ? 'written, notes fields ' + keys(p.notes) + ', metered ' + p.metered : 'none'}`);
}
console.log(out.join('\n'));
await pool.end();
