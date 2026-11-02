import test from 'node:test';
import assert from 'node:assert/strict';
import * as exa from './exa.ts';

const PROXY = { url: 'https://exa-proxy.example', token: 'proxy-token' };

test('a plain key goes straight to Exa', () => {
  exa.setProxy(PROXY);
  assert.deepEqual(exa.endpoint('plain-key-123', 'search'), {
    url: 'https://api.exa.ai/search',
    headers: { 'x-api-key': 'plain-key-123', 'content-type': 'application/json' },
  });
  assert.equal(exa.via('plain-key-123'), 'direct');
});

test('a us: key goes through the proxy, with the prefix taken off and the proxy token added', () => {
  exa.setProxy(PROXY);
  assert.deepEqual(exa.endpoint('us:real-key-456', 'contents'), {
    url: 'https://exa-proxy.example/contents',
    headers: { 'x-api-key': 'real-key-456', 'x-proxy-token': 'proxy-token', 'content-type': 'application/json' },
  });
  assert.equal(exa.via('us:real-key-456'), 'us');
});

test('a us: key with no proxy saved fails as quota, so only that key rests', () => {
  exa.setProxy(null);
  assert.throws(() => exa.endpoint('us:real-key-456', 'search'), (err: any) => err.code === 'quota' && err.provider === 'exa');
  assert.equal(exa.endpoint('plain-key-123', 'search').url, 'https://api.exa.ai/search');
});

test('parseProxy takes {url, token} as an object or saved JSON, and drops a trailing slash', () => {
  assert.deepEqual(exa.parseProxy({ url: 'https://p.example/', token: ' t ' }), { url: 'https://p.example', token: 't' });
  assert.deepEqual(exa.parseProxy('{"url":"https://p.example","token":"t"}'), { url: 'https://p.example', token: 't' });
  assert.equal(exa.parseProxy({ url: 'p.example', token: 't' }), null);
  assert.equal(exa.parseProxy({ url: 'https://p.example', token: '' }), null);
  assert.equal(exa.parseProxy('not json'), null);
});

test('searchWithKey sends a us: key to the proxy', async () => {
  exa.setProxy(PROXY);
  let seen: { url: string; headers: Record<string, string> } | null = null;
  const fetchImpl = (async (url: string, init: RequestInit) => {
    seen = { url, headers: init.headers as Record<string, string> };
    return new Response(JSON.stringify({ results: [{ url: 'https://a.example', title: 'A', highlights: ['hi'] }], costDollars: { total: 0.007 } }), { status: 200 });
  }) as unknown as typeof fetch;
  const hits = await exa.searchWithKey('q', 'us:real-key-456', { fetchImpl });
  assert.equal(hits.length, 1);
  assert.equal(seen!.url, 'https://exa-proxy.example/search');
  assert.equal(seen!.headers['x-api-key'], 'real-key-456');
  assert.equal(seen!.headers['x-proxy-token'], 'proxy-token');
});

test('the proxy source calls the proxy with only its token: the proxy picks the Exa key', () => {
  exa.setProxy(PROXY);
  assert.deepEqual(exa.endpoint(exa.PROXY_SOURCE, 'search'), {
    url: 'https://exa-proxy.example/search',
    headers: { 'x-proxy-token': 'proxy-token', 'content-type': 'application/json' },
  });
  assert.equal(exa.via(exa.PROXY_SOURCE), 'us');
});

test('PROXY_NO_KEY from the proxy rests the proxy source for its retry-after', async () => {
  exa.setProxy(PROXY);
  const noKey = async () => new Response('{"error":"every key rests","tag":"PROXY_NO_KEY"}', { status: 429, headers: { 'retry-after': '120' } });
  const err = await exa.requestWithKey('search', { query: 'x' }, exa.PROXY_SOURCE, { fetchImpl: noKey as typeof fetch }).catch((e) => e);
  assert.equal(err.code, 'quota');
  assert.equal(err.restMs, 120_000);
  let rested = -1;
  exa.releaseFor({ secret: exa.PROXY_SOURCE, release: (ms = 0) => { rested = ms; } }, err);
  assert.equal(rested, 120_000);
});
