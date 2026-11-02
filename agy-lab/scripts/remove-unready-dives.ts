// Removes company dives (and their dive-deeper runs and previews) for countries that have no research
// pack yet. Ready countries: Malaysia, Singapore, South Korea. Run inside the service:
//   node scripts/remove-unready-dives.ts           list what would go
//   node scripts/remove-unready-dives.ts --delete  remove it
import pg from 'pg';

const READY = ['Malaysia', 'Singapore', 'South Korea'];
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
const dives = (await pool.query(
  `select id, company, country, status, created_at from company_dive where country <> all($1::text[]) order by id`, [READY])).rows;
const ids = dives.map((d) => d.id);
const deeper = ids.length ? (await pool.query(`select id, dive_id, status from dive_deeper where dive_id = any($1::bigint[])`, [ids])).rows : [];
const previews = ids.length ? (await pool.query(`select dive_id from dive_preview where dive_id = any($1::bigint[])`, [ids])).rows : [];
console.log('by country:', JSON.stringify((await pool.query(`select country, count(*)::int n from company_dive group by 1 order by 1`)).rows));
console.log('dives to remove:', JSON.stringify(dives));
console.log('deeper runs to remove:', JSON.stringify(deeper));
console.log('previews to remove:', previews.length);
if (process.argv.includes('--delete') && ids.length) {
  await pool.query(`delete from dive_deeper where dive_id = any($1::bigint[])`, [ids]);
  await pool.query(`delete from dive_preview where dive_id = any($1::bigint[])`, [ids]);
  await pool.query(`delete from company_dive where id = any($1::bigint[])`, [ids]);
  console.log('removed.');
  console.log('by country now:', JSON.stringify((await pool.query(`select country, count(*)::int n from company_dive group by 1 order by 1`)).rows));
}
await pool.end();
process.exit(0);
