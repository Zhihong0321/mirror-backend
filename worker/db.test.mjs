import test from 'node:test';
import assert from 'node:assert/strict';
import { saveScan } from './db.mjs';

test('worker refuses to report a saved scan when business links are missing', async () => {
  const oldFetch = globalThis.fetch;
  const oldEnv = {
    PG_PROXY_URL: process.env.PG_PROXY_URL,
    PG_DB_NAME: process.env.PG_DB_NAME,
    PG_PROXY_TOKEN: process.env.PG_PROXY_TOKEN,
  };
  process.env.PG_PROXY_URL = 'http://fake-proxy';
  process.env.PG_DB_NAME = 'test';
  process.env.PG_PROXY_TOKEN = 'test';
  globalThis.fetch = async (_url, options) => {
    const { sql, params } = JSON.parse(String(options.body));
    const rows = sql.includes('insert into company_data') ? [{ id: '7', place_id: params[0] }]
      : sql.includes('insert into search_report\n') ? [{ id: '11' }]
      : sql.includes('select count(*)::int as count') ? [{ count: 0 }] : [];
    return Response.json({ rows, rowCount: rows.length });
  };
  try {
    await assert.rejects(saveScan({
      keyword: 'business', place: 'Taman Sentosa', query: 'business Taman Sentosa', found: 1,
      blocked: false, capped: false, businesses: [{ name: 'Example Shop', mapsUrl: 'https://google.com/maps/data=!19splace123' }],
    }), /not all business links were persisted/);
  } finally {
    globalThis.fetch = oldFetch;
    for (const [key, value] of Object.entries(oldEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
