// npm test discovers src/*.test.ts. Keep the focused tests beside the new code.
import './divedeeper/v21/adapter.test.ts';
import './divedeeper/v21/myworker.test.ts';
import './divedeeper/v21/run.test.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeCtx } from './divedeeper/lib.ts';
import * as jobs from './jobs.ts';

test('makeCtx without opts still uses the old job broker and never contacts myworker', async () => {
  const realFetch = globalThis.fetch;
  const databaseUrl = process.env.DATABASE_URL;
  const proxyUrl = process.env.PG_PROXY_URL;
  delete process.env.DATABASE_URL;
  delete process.env.PG_PROXY_URL;
  let calls = 0;
  globalThis.fetch = (async () => { calls++; throw new Error('unexpected network request'); }) as typeof fetch;
  try {
    assert.ok(!jobs.liveTypes().includes('gmap.scan'), 'test process starts with no worker');
    const ctx = makeCtx('v21-legacy-test', 'H', 'maps');
    assert.equal(await ctx.mapsSearch('solar', 'Johor', 60), null);
    assert.deepEqual(ctx.meter.maps, { calls: 1, failed: 1 });
    assert.match(ctx.warnings[0], /no Gmap worker online/);
    const worker = 'v21-legacy-test';
    jobs.touch(worker, null, ['gmap.scan']);
    try {
      const pending = ctx.mapsSearch('legacy-compatibility', 'Johor', 60);
      const job = jobs.snapshot().jobs.find((j) => j.type === 'gmap.scan' && (j.payload as any).keyword === 'legacy-compatibility');
      assert.ok(job, 'the old broker received the search');
      assert.deepEqual(job.payload, { keyword: 'legacy-compatibility', place: 'Johor', max: 60, source: 'dive.deeper' });
      jobs.finish(job.id, true, { businesses: [] }, null);
      assert.deepEqual(await pending, []);
      assert.deepEqual(ctx.meter.maps, { calls: 2, failed: 1 });
    } finally { jobs.touch(worker, null, []); }
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = realFetch;
    if (databaseUrl !== undefined) process.env.DATABASE_URL = databaseUrl;
    if (proxyUrl !== undefined) process.env.PG_PROXY_URL = proxyUrl;
  }
});

test('makeCtx with myworker counts failures and warnings in the same meter', async () => {
  const realFetch = globalThis.fetch;
  const requested: string[] = [];
  globalThis.fetch = (async (url) => {
    requested.push(String(url));
    return new Response(JSON.stringify({ ok: true, workersLive: 0 }));
  }) as typeof fetch;
  try {
    const ctx = makeCtx('v21-new-test', 'H', 'maps', { worker: 'myworker' });
    assert.equal(await ctx.mapsSearch('solar', 'Johor', 60), null);
    assert.deepEqual(requested, ['https://myworker.up.railway.app/health']);
    assert.deepEqual(ctx.meter.maps, { calls: 1, failed: 1 });
    assert.match(ctx.warnings[0], /maps "solar" in Johor: no Gmap worker online/);
    assert.deepEqual(ctx.waitingOn(), []);
  } finally { globalThis.fetch = realFetch; }
});
