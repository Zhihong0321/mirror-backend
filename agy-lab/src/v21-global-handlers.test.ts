// Global handlers (country "ALL"): the hub side. Offline: fetch is replaced, nothing leaves this process.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadGlobalHandlers } from './v21/site-lookup.ts';

const realFetch = globalThis.fetch;
test.afterEach(() => { globalThis.fetch = realFetch; });

test('loadGlobalHandlers asks for country ALL, keeps tier 1 and 2, sorts by id', async () => {
  let asked = '';
  globalThis.fetch = (async (url: string) => {
    asked = String(url);
    return new Response(JSON.stringify({ handlers: [
      { id: 'ALL-wayback/w1', tier: 1, question: 'q2' },
      { id: 'ALL-dns/w1', tier: 1, question: 'q1' },
      { id: 'ALL-x/w1', tier: 3, question: 'not runnable' },
    ] }));
  }) as typeof fetch;
  const list = await loadGlobalHandlers();
  assert.match(asked, /\/api\/handlers\?country=ALL$/);
  assert.deepEqual(list.map((h) => h.id), ['ALL-dns/w1', 'ALL-wayback/w1']);
});

test('loadGlobalHandlers returns an empty list when the service cannot be read', async () => {
  globalThis.fetch = (async () => { throw new Error('network down'); }) as typeof fetch;
  assert.deepEqual(await loadGlobalHandlers(), []);
  globalThis.fetch = (async () => new Response('nope', { status: 500 })) as typeof fetch;
  assert.deepEqual(await loadGlobalHandlers(), []);
});
