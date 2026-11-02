import test from 'node:test';
import assert from 'node:assert/strict';
import { handleApi } from './intel.ts';

test('worker snapshot upload requires LAB_TOKEN and repairs the existing report', async () => {
  const previousFetch = globalThis.fetch;
  const previousEnv = {
    DATABASE_URL: process.env.DATABASE_URL,
    PG_PROXY_URL: process.env.PG_PROXY_URL,
    PG_DB_NAME: process.env.PG_DB_NAME,
    PG_PROXY_TOKEN: process.env.PG_PROXY_TOKEN,
    LAB_TOKEN: process.env.LAB_TOKEN,
  };
  process.env.DATABASE_URL = '';
  process.env.PG_PROXY_URL = 'http://fake-proxy';
  process.env.PG_DB_NAME = 'test';
  process.env.PG_PROXY_TOKEN = 'test';
  process.env.LAB_TOKEN = 'lab-secret-123456789';

  const publicId = 'abcdefghijklmnopqrst';
  const report: Record<string, any> = {
    id: '1', public_id: publicId, report_type: 'business_search', status: 'failed',
    title: 'Business list', user_id: null, request: { place: 'Taman Sentosa' },
    source_search_report_id: null, job_id: 'job-1', result: null, error: 'database unavailable',
    version: 1, created_at: '2026-09-24', updated_at: '2026-09-24', completed_at: null,
  };
  let searchId: string | null = null;
  let inserts = 0;
  const links = new Set<string>();
  globalThis.fetch = async (_url, options) => {
    const { sql, params } = JSON.parse(String(options?.body));
    let rows: Record<string, unknown>[] = [];
    if (sql === 'select * from published_report where public_id = $1') rows = [report];
    else if (sql.includes('insert into company_data (place_id,name,rating,reviews,category,address,phone,website,maps_url)')) rows = [{ id: '7', place_id: params[0] }];
    else if (sql.startsWith('select id from search_report where job_id')) rows = searchId ? [{ id: searchId }] : [];
    else if (sql.includes('insert into search_report (user_id')) { searchId = '11'; inserts++; rows = [{ id: searchId }]; }
    else if (sql.includes('insert into search_report_company (report_id')) links.add('11:7');
    else if (sql.startsWith('select count(*)::int as count from search_report_company')) rows = [{ count: links.size }];
    else if (sql === 'select * from search_report where id = $1') rows = [{ id: '11', place: 'Taman Sentosa', found: 1 }];
    else if (sql.includes('from search_report_company src')) rows = [{ id: '7', place_id: 'place123', name: 'Example Shop', rank: 1 }];
    else if (sql.startsWith('update published_report set')) {
      if (params[1]) report.status = params[1];
      if (params[3]) report.source_search_report_id = params[3];
      if (params[6]) report.result = JSON.parse(params[7]);
      if (params[8]) report.error = params[9];
      rows = [report];
    }
    return Response.json({ rows, rowCount: rows.length });
  };

  const snapshot = { search: { keyword: 'business', place: 'Taman Sentosa', found: 1, blocked: false }, companies: [{ name: 'Example Shop', mapsUrl: 'https://google.com/maps/data=!19splace123' }] };
  const response: { status?: number; body?: any } = {};
  const ctx = { json: (_res: unknown, status: number, body: unknown) => { response.status = status; response.body = body; }, readJson: async () => ({ snapshot }) };
  const url = new URL(`http://localhost/api/reports/${publicId}/repair`);
  try {
    await handleApi({ method: 'POST', headers: { authorization: 'Bearer portal-token', host: 'localhost' } } as any, {} as any, url, ctx as any);
    assert.equal(response.status, 403);
    assert.equal(inserts, 0);

    await handleApi({ method: 'POST', headers: { authorization: 'Bearer lab-secret-123456789', host: 'localhost' } } as any, {} as any, url, ctx as any);
    assert.equal(response.status, 200);
    assert.equal(report.status, 'completed');
    assert.equal(report.source_search_report_id, '11');
    assert.equal(report.result.companies.length, 1);
    assert.equal(inserts, 1);

    // A worker may have saved its search while the lab failed to update the
    // public report. The job id alone can reconnect that existing result.
    report.status = 'failed';
    report.result = null;
    report.source_search_report_id = null;
    const noUpload = { ...ctx, readJson: async () => ({}) };
    await handleApi({ method: 'POST', headers: { authorization: 'Bearer portal-token', host: 'localhost' } } as any, {} as any, url, noUpload as any);
    assert.equal(response.status, 200);
    assert.equal(report.status, 'completed');
    assert.equal(inserts, 1);
  } finally {
    globalThis.fetch = previousFetch;
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('a Gmap worker result for a job the broker lost completes its report', async () => {
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

  // A hub restart mid-scan: the job is gone from the broker and boot marked the report abandoned.
  const publicId = 'latelatelatelatelate';
  const report: Record<string, any> = {
    id: '2', public_id: publicId, report_type: 'business_search', status: 'failed',
    title: 'business in Taman Late', user_id: null, request: { keyword: 'business', place: 'Taman Late' },
    source_search_report_id: null, job_id: 'aaaabbbbcccc', result: null,
    error: 'This run was abandoned before it finished, most likely because the service restarted while it was working. Start it again.',
    version: 1, created_at: '2026-11-01', updated_at: '2026-11-01', completed_at: null,
  };
  let searchId: string | null = null;
  const links = new Set<string>();
  globalThis.fetch = async (_url, options) => {
    const { sql, params } = JSON.parse(String(options?.body));
    let rows: Record<string, unknown>[] = [];
    if (sql === 'select * from published_report where public_id = $1') rows = [report];
    else if (sql.includes('insert into company_data (place_id,name,rating,reviews,category,address,phone,website,maps_url)')) rows = [{ id: '8', place_id: params[0] }];
    else if (sql.startsWith('select id from search_report where job_id')) rows = searchId ? [{ id: searchId }] : [];
    else if (sql.includes('insert into search_report (user_id')) { searchId = '12'; rows = [{ id: searchId }]; }
    else if (sql.includes('insert into search_report_company (report_id')) links.add('12:8');
    else if (sql.startsWith('select count(*)::int as count from search_report_company')) rows = [{ count: links.size }];
    else if (sql === 'select * from search_report where id = $1') rows = [{ id: '12', place: 'Taman Late', found: 1 }];
    else if (sql.includes('from search_report_company src')) rows = [{ id: '8', place_id: 'placeLate', name: 'Late Shop', rank: 1 }];
    else if (sql.startsWith('update published_report set')) {
      if (params[1]) report.status = params[1];
      if (params[3]) report.source_search_report_id = params[3];
      if (params[6]) report.result = JSON.parse(params[7]);
      if (params[8]) report.error = params[9];
      rows = [report];
    }
    return Response.json({ rows, rowCount: rows.length });
  };

  const { handle } = await import('./jobs.ts');
  const call = async (body: Record<string, unknown>) => {
    const response: { status?: number; body?: any } = {};
    await handle({ method: 'POST', headers: {}, socket: { remoteAddress: '203.0.113.9' } } as any, {} as any,
      new URL('http://lab/api/jobs/aaaabbbbcccc/result'), {
        json: (_res, status, payload) => { response.status = status; response.body = payload; },
        readJson: async () => body,
        scope: { types: ['gmap.scan'] },
      });
    return response;
  };
  const scan = { query: 'business in Taman Late', place: 'Taman Late', found: 1, blocked: false, provider: 'maps-list-local',
    businesses: [{ name: 'Late Shop', mapsUrl: 'https://www.google.com/maps/place/?q=place_id:placeLate', place_id: 'placeLate' }] };
  try {
    // Without the report's id there is nowhere to put it: the old answer.
    assert.equal((await call({ worker: 'pc-late', ok: true, result: scan })).status, 404);

    const saved = await call({ worker: 'pc-late', ok: true, reportPublicId: publicId, result: scan });
    assert.equal(saved.status, 200);
    assert.equal(report.status, 'completed');
    assert.equal(report.source_search_report_id, '12');
    assert.equal(report.result.companies.length, 1);

    // A report that already has its list is left alone.
    assert.equal((await call({ worker: 'pc-late', ok: true, reportPublicId: publicId, result: scan })).status, 409);
  } finally {
    globalThis.fetch = previousFetch;
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
