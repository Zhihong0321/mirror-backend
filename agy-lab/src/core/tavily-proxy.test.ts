import test from 'node:test';
import assert from 'node:assert/strict';
import * as tavily from './tavily.ts';
import { PROXY_SOURCE, setProxy } from './proxy.ts';

const PROXY = { url: 'https://exa-proxy.example', token: 'proxy-token' };

test('a Tavily key goes to Tavily with its bearer; the proxy source goes to /tavily with only the proxy token', () => {
  setProxy(PROXY);
  assert.deepEqual(tavily.endpoint('tvly-abc', 'search').headers.authorization, 'Bearer tvly-abc');
  assert.deepEqual(tavily.endpoint(PROXY_SOURCE, 'search'), {
    url: 'https://exa-proxy.example/tavily/search',
    headers: { 'x-proxy-token': 'proxy-token', 'content-type': 'application/json' },
  });
});

test('the proxy source reads its credit from GET /usage/tavily, and none usable reads as spent', async () => {
  setProxy(PROXY);
  const report = (usable: number) => (async (url: string) => {
    assert.equal(url, 'https://exa-proxy.example/usage/tavily');
    return Response.json({ creditAssumedCredits: 1000, totals: { keys: 20, usable, estimatedLeftCredits: 19_000 } });
  }) as typeof fetch;
  assert.deepEqual(await tavily.fetchUsage(PROXY_SOURCE, report(20)), { used: 1000, limit: 20_000 });
  assert.deepEqual(await tavily.fetchUsage(PROXY_SOURCE, report(0)), { used: 20_000, limit: 20_000 });
});

test('PROXY_NO_KEY on a Tavily search rests the proxy source for its retry-after', async () => {
  setProxy(PROXY);
  const noKey = (async () => new Response('{"tag":"PROXY_NO_KEY"}', { status: 429, headers: { 'retry-after': '60' } })) as typeof fetch;
  const err = await tavily.searchWithKey('x', PROXY_SOURCE, { fetchImpl: noKey }).catch((e) => e);
  assert.equal(err.code, 'quota');
  assert.equal(err.restMs, 60_000);
});

test('Tavily is never paid to read a page: extract and crawl are refused before any request', async () => {
  tavily.setKeysForTests(['tvly-test']);
  let requests = 0;
  const spy = (async () => { requests++; return Response.json({ results: [], usage: { credits: 1 } }); }) as typeof fetch;
  for (const path of ['extract', 'crawl']) {
    const err = await tavily.request(path as 'search', { urls: ['https://example.com'] }, { fetchImpl: spy }).catch((e) => e);
    assert.equal(err.code, 'unsupported', `/${path} is refused`);
    assert.match(err.message, /fetch workers/);
  }
  assert.equal(requests, 0, 'no request left for Tavily');
  await tavily.request('search', { query: 'x' }, { fetchImpl: spy });
  assert.equal(requests, 1, 'search still goes to Tavily');
});
