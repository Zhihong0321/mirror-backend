import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { scan, fetchPage, lookup, shot } from './myworker.ts';

const business = { name: 'Acme', rating: 4.7, reviews: 12, category: 'Installer', address: 'Johor', phone: '123', website: 'https://acme.my', mapsUrl: 'https://maps.example/acme', place_id: 'place-acme' };
type Request = { method: string; path: string; authorization?: string; body: any };
async function fake(answer: (request: Request) => { status?: number; body: unknown }, work: (baseUrl: string, requests: Request[]) => Promise<void>) {
  const requests: Request[] = [];
  const server = http.createServer(async (req, res) => {
    let text = '';
    for await (const chunk of req) text += chunk;
    const request = { method: req.method!, path: req.url!, authorization: req.headers.authorization, body: text ? JSON.parse(text) : null };
    requests.push(request);
    const reply = answer(request);
    res.writeHead(reply.status ?? 200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(reply.body));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  try { await work(base, requests); }
  finally { await new Promise<void>((resolve, reject) => { server.close((err) => err ? reject(err) : resolve()); server.closeAllConnections(); }); }
}
const health = { body: { ok: true, workersLive: 1 } };

test('myworker finishes in the POST response, preserving Maps order and place_id', async () => {
  await fake((r) => r.path === '/health' ? health : { body: { job: { id: 'a', status: 'done', result: { businesses: [business, { name: 'Second' }] } } } }, async (baseUrl, requests) => {
    const out = await scan('solar installer', 'Johor', 60, { baseUrl, apiKey: 'test-key' });
    assert.equal(out.error, undefined);
    assert.deepEqual(out.rows, [business, { name: 'Second', rating: null, reviews: null, category: null, address: null, phone: null, website: null, mapsUrl: null, place_id: null }]);
    assert.deepEqual(requests.map((r) => [r.method, r.path]), [['GET', '/health'], ['POST', '/api/scan']]);
    assert.deepEqual(requests[1].body, { keyword: 'solar installer', place: 'Johor', max: 60, wait: 60 });
    assert.equal(requests[1].authorization, 'Bearer test-key');
  });
});

test('myworker polls after 202 until done', async () => {
  let polls = 0;
  await fake((r) => r.path === '/health' ? health : r.method === 'POST'
    ? { status: 202, body: { job: { id: 'a', status: 'pending' } } }
    : { body: { job: ++polls === 1 ? { id: 'a', status: 'running' } : { id: 'a', status: 'done', result: { businesses: [business] } } } }, async (baseUrl, requests) => {
    assert.deepEqual((await scan('solar', '', 20, { baseUrl, apiKey: 'test-key' })).rows, [business]);
    assert.equal(polls, 2);
    assert.ok(requests.slice(2).every((r) => r.path === '/api/scan/a?wait=60' && r.authorization === 'Bearer test-key'));
  });
});

test('myworker returns the failed job reason', async () => {
  await fake((r) => r.path === '/health' ? health : { body: { job: { id: 'a', status: 'failed', error: 'worker could not open Maps' } } }, async (baseUrl) => {
    assert.deepEqual(await scan('solar', '', 20, { baseUrl, apiKey: 'test-key' }), { rows: null, error: 'worker could not open Maps' });
  });
});

test('myworker returns immediately with no live workers and never posts a job', async () => {
  await fake(() => ({ body: { ok: true, workersLive: 0 } }), async (baseUrl, requests) => {
    assert.deepEqual(await scan('solar', '', 20, { baseUrl, apiKey: '' }), { rows: null, error: 'no Gmap worker online' });
    assert.deepEqual(requests.map((r) => r.path), ['/health']);
  });
});

test('myworker refuses a stoppedEarly result and a malformed done result', async () => {
  for (const result of [{ businesses: [business], stoppedEarly: true }, {}]) {
    await fake((r) => r.path === '/health' ? health : { body: { job: { status: 'done', result } } }, async (baseUrl) => {
      const out = await scan('solar', '', 20, { baseUrl, apiKey: 'test-key' });
      assert.equal(out.rows, null);
      assert.match(out.error!, /stoppedEarly|no businesses/);
    });
  }
});

test('myworker returns an HTTP failure instead of throwing', async () => {
  await fake((r) => r.path === '/health' ? health : { status: 503, body: { error: 'down' } }, async (baseUrl) => {
    assert.deepEqual(await scan('solar', '', 20, { baseUrl, apiKey: 'test-key' }), { rows: null, error: 'myworker: HTTP 503' });
  });
});

test('fetchPage returns content, headers and redirects and requests the whole page', async () => {
  const page = { url: 'https://a.test', finalUrl: 'https://a.test/new', status: 200, content: '<h1>Worker</h1>',
    headers: { server: 'test' }, redirects: [{ url: 'https://a.test', status: 301, location: 'https://a.test/new' }], worker: 'pc-test' };
  await fake(() => ({ body: { job: { status: 'done', result: page } } }), async (baseUrl, requests) => {
    assert.deepEqual(await fetchPage(page.url, { format: 'html', keepErrors: true, headers: true }, { baseUrl, apiKey: 'test-key' }), page);
    assert.deepEqual(requests.map((r) => [r.method, r.path, r.authorization]), [['POST', '/api/fetch', 'Bearer test-key']]);
    assert.deepEqual(requests[0].body, { url: page.url, format: 'html', keepErrors: true, headers: true, mainContent: false, wait: 60 });
  });
});

test('fetchPage preserves a keepErrors 404 and defaults missing headers and redirects', async () => {
  await fake(() => ({ body: { job: { status: 'done', result: { status: 404, content: 'Not found' } } } }), async (baseUrl) => {
    const out = await fetchPage('https://a.test/missing', { format: 'markdown', keepErrors: true }, { baseUrl, apiKey: 'test-key' });
    assert.ok(!('error' in out));
    assert.equal(out.status, 404);
    assert.equal(out.content, 'Not found');
    assert.deepEqual(out.headers, {});
    assert.deepEqual(out.redirects, []);
  });
});

test('fetchPage recognises an old worker failed HTTP page but keeps network errors as errors', async () => {
  for (const error of ['the site answered HTTP 404', 'DNS failed']) {
    await fake(() => ({ body: { job: { status: 'failed', error } } }), async (baseUrl) => {
      const out = await fetchPage('https://a.test', { format: 'html', keepErrors: true, headers: true }, { baseUrl, apiKey: 'test-key' });
      if (error === 'DNS failed') assert.deepEqual(out, { error });
      else assert.deepEqual(out, { url: 'https://a.test', finalUrl: 'https://a.test', status: 404, content: '', headers: {}, redirects: [] });
    });
  }
});

test('lookup returns the handler answer with its handler and version', async () => {
  const result = { status: 'found', reason: null, records: [{ name: 'Acme' }], source_url: 'https://register.test', excerpt: 'Acme' };
  await fake(() => ({ body: { job: { status: 'done', result: { result, handler: 'MY-register/w1', version: 'abc123' } } } }), async (baseUrl, requests) => {
    assert.deepEqual(await lookup('MY-register/w1', 'Acme', { baseUrl, apiKey: 'test-key' }), { ...result, handler: 'MY-register/w1', version: 'abc123' });
    assert.equal(requests[0].path, '/api/lookup');
    assert.deepEqual(requests[0].body, { handler: 'MY-register/w1', keyword: 'Acme', wait: 60 });
  });
});

test('shot preserves successful proof and blocked evidence, and returns failed job errors', async () => {
  const ask = { url: 'https://a.test', device: 'mobile' as const, find: 'Contact' };
  for (const result of [
    { image: 'jpeg', found: true, blocked: false, detail: null, status: 200, finalUrl: ask.url, width: 390, loaded: true },
    { image: null, found: false, blocked: true, detail: { evidence: ['challenge'] }, status: 403, finalUrl: ask.url },
  ]) await fake(() => ({ body: { job: { status: 'done', result } } }), async (baseUrl, requests) => {
    assert.deepEqual(await shot(ask, { baseUrl, apiKey: 'test-key' }), result);
    assert.equal(requests[0].path, '/api/shot');
    assert.deepEqual(requests[0].body, { ...ask, wait: 60 });
  });
  await fake(() => ({ body: { job: { status: 'failed', error: 'browser failed' } } }), async (baseUrl) => {
    assert.deepEqual(await shot(ask, { baseUrl, apiKey: 'test-key' }), { error: 'browser failed' });
    assert.deepEqual(await lookup('MY-register/w1', 'Acme', { baseUrl, apiKey: 'test-key' }), { error: 'browser failed' });
  });
});

test('all page tools poll the shared jobs route through pending and running', async () => {
  const tasks = [
    { run: (baseUrl: string) => fetchPage('https://a.test', { format: 'markdown' }, { baseUrl, apiKey: 'test-key' }), result: { status: 200, content: 'Worker text' } },
    { run: (baseUrl: string) => lookup('MY-register/w1', 'Acme', { baseUrl, apiKey: 'test-key' }), result: { handler: 'MY-register/w1', version: 'abc', result: { status: 'couldnt_check', reason: 'layout_changed', records: [] } } },
    { run: (baseUrl: string) => shot({ url: 'https://a.test' }, { baseUrl, apiKey: 'test-key' }), result: { status: 200, blocked: false, image: 'jpeg' } },
  ];
  for (const task of tasks) {
    let polls = 0;
    await fake((r) => r.method === 'POST' ? { status: 202, body: { job: { id: 'a/b', status: 'pending' } } }
      : { body: { job: ++polls === 1 ? { id: 'a/b', status: 'running' } : { status: 'done', result: task.result } } }, async (baseUrl, requests) => {
      assert.ok(!('error' in await task.run(baseUrl)));
      assert.deepEqual(requests.slice(1).map((r) => [r.method, r.path, r.authorization]), [
        ['GET', '/api/jobs/a%2Fb?wait=60', 'Bearer test-key'], ['GET', '/api/jobs/a%2Fb?wait=60', 'Bearer test-key'],
      ]);
    });
  }
});
