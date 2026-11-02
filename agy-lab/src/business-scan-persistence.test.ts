import test from 'node:test';
import assert from 'node:assert/strict';
import { persistBusinessScan, scanPlaceKey } from './reportdb.ts';
import { placeKey as workerPlaceKey } from '../../worker/db.mjs';

test('server replay restores partial scan links without rescanning or duplicating the search report', async () => {
  const previousFetch = globalThis.fetch;
  const previousEnv = {
    DATABASE_URL: process.env.DATABASE_URL,
    PG_PROXY_URL: process.env.PG_PROXY_URL,
    PG_DB_NAME: process.env.PG_DB_NAME,
    PG_PROXY_TOKEN: process.env.PG_PROXY_TOKEN,
  };
  process.env.DATABASE_URL = '';
  process.env.PG_PROXY_URL = 'http://fake-proxy';
  process.env.PG_DB_NAME = 'test';
  process.env.PG_PROXY_TOKEN = 'test';

  const businesses = [
    { name: 'Eternalgy Sdn Bhd', address: 'Taman Mount Austin', mapsUrl: 'https://google.com/maps/data=!19sbranch123', phone: '012-3456789' },
    { name: 'The Store', address: 'Taman Mount Austin', mapsUrl: 'https://google.com/maps/data=!19sshop456' },
  ];
  for (const business of businesses) assert.equal(scanPlaceKey(business), workerPlaceKey(business));

  const companyIds = new Map<string, string>();
  const links = new Set<string>();
  let searchReportId: string | null = null;
  let inserts = 0;
  let failFirstLink = true;
  globalThis.fetch = async (_url, options) => {
    const { sql, params } = JSON.parse(String(options?.body));
    let rows: Record<string, unknown>[] = [];
    if (sql === 'select * from published_report where public_id = $1') {
      rows = [{ public_id: params[0], report_type: 'business_search', source_search_report_id: null, job_id: 'job-1', user_id: null, request: { place: 'Taman Mount Austin' } }];
    } else if (sql.includes('insert into company_data (place_id,name,rating,reviews,category,address,phone,website,maps_url)')) {
      for (let i = 0; i < params.length; i += 9) {
        const key = String(params[i]);
        if (!companyIds.has(key)) companyIds.set(key, String(companyIds.size + 1));
        rows.push({ id: companyIds.get(key), place_id: key });
      }
    } else if (sql.startsWith('select id from search_report where job_id')) {
      rows = searchReportId ? [{ id: searchReportId }] : [];
    } else if (sql.includes('insert into search_report (user_id')) {
      searchReportId = '101';
      inserts++;
      rows = [{ id: searchReportId }];
    } else if (sql.includes('insert into search_report_company (report_id')) {
      if (failFirstLink) {
        failFirstLink = false;
        return Response.json({ error: 'temporary link failure' }, { status: 500 });
      }
      for (let i = 0; i < params.length; i += 3) links.add(String(params[i]) + ':' + String(params[i + 1]));
    } else if (sql.startsWith('select count(*)::int as count from search_report_company')) {
      rows = [{ count: links.size }];
    }
    return Response.json({ rows, rowCount: rows.length });
  };

  try {
    const scan = { keyword: 'business', place: 'Taman Mount Austin', query: 'business Taman Mount Austin', found: 2, blocked: false };
    await assert.rejects(persistBusinessScan('report-1', scan, businesses), /temporary link failure/);
    const repaired = await persistBusinessScan('report-1', scan, businesses);
    assert.deepEqual(repaired, { reportId: '101', companies: 2, linked: 2 });
    assert.equal(inserts, 1);
    assert.equal(companyIds.size, 2);
  } finally {
    globalThis.fetch = previousFetch;
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
