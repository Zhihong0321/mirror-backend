// The dive-deeper's search fallbacks (divedeeper/lib.ts) against a fake network: each engine
// that fails hands the query to the next, and only all three failing counts as a failed call.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeCtx } from './divedeeper/lib.ts';
import { serviceFailures } from './divedeeper/runner.ts';
import { exa, tavily } from './core/index.ts';
import { setProxy } from './core/proxy.ts';

const realFetch = globalThis.fetch;
type Up = { exa: boolean; tavily: boolean; brave: boolean };

function fakeNetwork(up: Up): void {
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input instanceof Request ? input.url : input);
    const down = new Response('{"error":"down"}', { status: 503 });
    if (url.startsWith('https://api.exa.ai/')) return up.exa ? new Response(JSON.stringify({ results: [{ url: 'https://a.example/', title: 'From Exa', text: 'exa text', highlights: ['exa text'] }] })) : down;
    if (url.startsWith('https://api.tavily.com/')) return up.tavily ? new Response(JSON.stringify({ results: [{ url: 'https://b.example/', title: 'From Tavily', content: 'tavily text' }] })) : down;
    if (url.startsWith('https://api.search.brave.com/')) return up.brave ? new Response(JSON.stringify({ web: { results: [{ url: 'https://c.example/', title: 'From Brave', description: 'brave text' }] } })) : down;
    throw new Error(`unexpected request to ${url}`);
  }) as typeof fetch;
}

async function withNetwork<T>(up: Up, work: () => Promise<T>): Promise<T> {
  process.env.BRAVE_API_KEYS = 'fake-brave';
  setProxy(null);
  exa.setKeysForTests(['fake-exa']);
  tavily.setKeysForTests(['fake-tavily']);
  fakeNetwork(up);
  try { return await work(); } finally {
    globalThis.fetch = realFetch;
    delete process.env.BRAVE_API_KEYS;
    exa.setKeysForTests(null);
    tavily.setKeysForTests(null);
  }
}

test('ctx.exa: Exa down, Tavily answers; Tavily down too, Brave answers; all down, one failed search', async () => {
  const ctx = makeCtx('t', 'Z', 'search');
  assert.equal((await withNetwork({ exa: true, tavily: true, brave: true }, () => ctx.exa('q')))[0].title, 'From Exa');
  assert.equal((await withNetwork({ exa: false, tavily: true, brave: true }, () => ctx.exa('q')))[0].title, 'From Tavily');
  const viaBrave = await withNetwork({ exa: false, tavily: false, brave: true }, () => ctx.exa('q'));
  assert.deepEqual([viaBrave[0].title, viaBrave[0].text], ['From Brave', 'brave text']);
  assert.equal(serviceFailures(ctx.meter), null);
  assert.deepEqual(await withNetwork({ exa: false, tavily: false, brave: false }, () => ctx.exa('q')), []);
  assert.match(String(serviceFailures(ctx.meter)), /1 search\(es\) failed on every engine/);
  assert.match(ctx.warnings.join('\n'), /search failed on every engine: exa: .* \| tavily: .* \| brave: /);
});

test('ctx.brave: Brave down, Exa answers; Exa down too, Tavily answers; all down, one failed search', async () => {
  const ctx = makeCtx('t', 'Z', 'search');
  assert.equal((await withNetwork({ exa: true, tavily: true, brave: true }, () => ctx.brave('q')))[0].title, 'From Brave');
  const viaExa = await withNetwork({ exa: true, tavily: true, brave: false }, () => ctx.brave('q'));
  assert.deepEqual([viaExa[0].title, viaExa[0].description], ['From Exa', 'exa text']);
  assert.equal((await withNetwork({ exa: false, tavily: true, brave: false }, () => ctx.brave('q')))[0].title, 'From Tavily');
  assert.equal(serviceFailures(ctx.meter), null);
  assert.deepEqual(await withNetwork({ exa: false, tavily: false, brave: false }, () => ctx.brave('q')), []);
  assert.match(String(serviceFailures(ctx.meter)), /1 search\(es\) failed on every engine/);
});
