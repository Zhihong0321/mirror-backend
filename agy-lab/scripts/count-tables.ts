// Row counts of the copied tables in this service's database, to set beside pg_2nd's. node scripts/count-tables.ts
import pg from 'pg';

const TABLES = ['company', 'company_place', 'company_data', 'company_email', 'search_report', 'search_report_company', 'published_report',
  'contact_research_run', 'person_research_run', 'company_research_run', 'run_event', 'lead_activity_log', 'telemarketer', 'taman_assignment',
  'territory_discovered', 'search_list_run', 'search_list_search', 'search_list_place', 'list_step2_job', 'list_step2_lead',
  'email_marketing_lead', 'email_marketing_event', 'ads_research_run', 'ads_market_run', 'atap_solar_registrations'];
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
for (const t of TABLES) {
  try {
    console.log(t.padEnd(26), (await pool.query(`select count(*)::int n from "${t}"`)).rows[0].n);
  } catch (e) { console.log(t.padEnd(26), 'MISSING'); }
}
await pool.end();
process.exit(0);
