import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { scan } from './myworker.ts';

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
