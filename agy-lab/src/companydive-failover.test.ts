// A whole company dive run against a fake network where providers fail, to prove the
// fallbacks and the incomplete rule do what companydive.ts says: Brave and Tavily fall
// back to Exa, and a step that still fails (here the page reads: no fetch worker) is a
// warning, which makes the dive incomplete.
import test from 'node:test';
import assert from 'node:assert/strict';
import { run, nextTry, liveDomains, MAX_TRIES } from './companydive.ts';
import * as jobs from './jobs.ts';
import { exa, llm, tavily } from './core/index.ts';
import { setProxy } from './core/proxy.ts';

const realFetch = globalThis.fetch;

/** What the fake LLM answers to every step: enough for triage, page picking, analysis and reflection. */
const ANSWER = JSON.stringify({
  identity: { legal_name: 'Acme Sdn Bhd', official_domains: ['acme.my'] },
  relevant_ids: [1, 2, 3], map_domain: 'acme.my', extract_ids: [3], gaps: ['directors'],
  urls: ['https://acme.my/about'],
  facts: [{ topic: 'identity', fact: 'Acme makes signboards.', sources: [1], confidence: 'high' }],
  contradictions: [], searches: [{ query: 'Acme Sdn Bhd directors' }], next: [],
});

function fakeNetwork(opts: { exaUp: boolean; tavilyMap?: string[] }): string[] {
  const asked: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input instanceof Request ? input.url : input);
    asked.push(new URL(url).host);
    if (url.startsWith('https://api.search.brave.com/')) return new Response('{"error":"down"}', { status: 503 });
    if (url.startsWith('https://api.tavily.com/map') && opts.tavilyMap) return new Response(JSON.stringify({ results: opts.tavilyMap }));
    if (url.startsWith('https://api.tavily.com/')) return new Response('{"error":"down"}', { status: 503 });
    if (url.startsWith('https://api.exa.ai/')) {
      return opts.exaUp
        ? new Response(JSON.stringify({ results: [
          { url: 'https://acme.my/', title: 'Acme Sdn Bhd', highlights: ['Acme makes signboards in Johor.'] },
          { url: 'https://news.example/acme', title: 'Acme wins award', highlights: ['Acme Sdn Bhd won an award.'] },
          // No snippet: the dive has to read this page, and with no fetch worker that read fails.
          { url: 'https://directory.example/acme', title: 'Acme Sdn Bhd listing', highlights: [] },
        ] }), { status: 200 })
        : new Response('{"error":"down"}', { status: 503 });
    }
    if (url.startsWith('https://llm.test/')) {
      return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: ANSWER } }], usage: { prompt_tokens: 10, completion_tokens: 10 } }));
    }
    throw new Error(`unexpected request to ${url}`);
  }) as typeof fetch;
  return asked;
}

function setUp(): void {
  process.env.BRAVE_API_KEYS = 'fake-brave';
  setProxy(null);
  exa.setKeysForTests(['fake-exa']);
  tavily.setKeysForTests(['fake-tavily']);
  llm.resetForTests();
  llm.setLanesForTests([{ url: 'https://llm.test/v1', key: 'fake-llm', model: 'deepseek-v4.1-flash-1017', label: 'Fake lane' }]);
}

function tearDown(): void {
  globalThis.fetch = realFetch;
  delete process.env.BRAVE_API_KEYS;
  exa.setKeysForTests(null);
  tavily.setKeysForTests(null);
  llm.setLanesForTests(null);
}

test('Brave and Tavily down: Exa answers every search, and a step that still fails makes the dive incomplete', async () => {
  setUp();
  const asked = fakeNetwork({ exaUp: true });
  const log: string[] = [];
  try {
    const { result } = await run('Acme Sdn Bhd (https://acme.my/)', 'Malaysia', (stage, msg) => { log.push(`${stage}: ${msg}`); });
    // Every Brave discovery query failed and Exa answered it.
    const braveFallbacks = log.filter((l) => /^discover: Brave \w+ failed .*; Exa: 3 results$/.test(l));
    assert.equal(braveFallbacks.length, 8, log.join('\n'));
    assert.ok(result.sources.some((s) => s.found.includes('exa:exact')), JSON.stringify(result.sources.map((s) => s.found)));
    // Tavily search failed and Exa answered: T1 and the gap search.
    assert.ok(log.some((l) => /^discover: T1 big picture: Tavily failed .*; Exa answered$/.test(l)), log.join('\n'));
    assert.ok(log.some((l) => /^fill: T\d+ Acme Sdn Bhd directors: Tavily failed .*; Exa answered$/.test(l)), log.join('\n'));
    // The name was searched without the website after it.
    assert.ok(log.some((l) => l === 'discover: Brave sweep for "Acme Sdn Bhd" (short name "Acme")'), log.join('\n'));
    // No search counts as failed; the page reads (no fetch worker) do, so the dive is incomplete.
    assert.ok(!result.warnings.some((w) => /search/.test(w)), result.warnings.join('\n'));
    assert.ok(result.warnings.some((w) => /^reading the (official|third-party) pages failed/.test(w)), result.warnings.join('\n'));
    assert.ok(asked.includes('api.exa.ai') && asked.includes('api.search.brave.com') && asked.includes('api.tavily.com'), [...new Set(asked)].join(','));
  } finally {
    tearDown();
  }
});

test('Brave, Tavily and Exa all down: the dive throws as worth another try, not as nothing to find', async () => {
  setUp();
  fakeNetwork({ exaUp: false });
  const log: string[] = [];
  try {
    const err = await run('Acme Sdn Bhd', 'Malaysia', (stage, msg) => { log.push(`${stage}: ${msg}`); }).catch((e) => e);
    assert.match(String(err?.message), /Discovery found nothing/);
    assert.equal(err.retryable, true);
    assert.equal(log.filter((l) => /^warn: discovery search \w+ failed on Brave and Exa/.test(l)).length, 8, log.join('\n'));
  } finally {
    tearDown();
  }
});

test('an incomplete dive is tried again 1, 3, then 30 minutes later, and fails after its last try', () => {
  assert.equal(MAX_TRIES, 6);
  assert.deepEqual([1, 2, 3, 4, 5].map(nextTry), [60_000, 180_000, 1_800_000, 1_800_000, 1_800_000]);
  assert.equal(nextTry(6), null);
});

test('the fetch worker reads none of the official pages: the dive is incomplete, not done on third-party pages alone', async () => {
  setUp();
  fakeNetwork({ exaUp: true, tavilyMap: ['https://acme.my/', 'https://acme.my/about'] });
  // A fetch worker that answers every read with the crash the Mac mini's Crawl4AI gave on signmastr.com.my.
  const stop = new AbortController();
  jobs.touch('test-fetch-worker', null, ['fetch.pages']); // checked in, as a real worker's heartbeat does
  void (async () => {
    while (!stop.signal.aborted) {
      const job = await jobs.take('test-fetch-worker', { types: ['fetch.pages'], waitMs: 200, signal: stop.signal });
      if (job) jobs.finish(job.id, true, { pages: [], failed: (job.payload as { urls: string[] }).urls.map((url) => ({ url, error: 'Unexpected error in _crawl_web' })) }, null);
    }
  })();
  const log: string[] = [];
  try {
    const { result } = await run('Acme Sdn Bhd', 'Malaysia', (stage, msg) => { log.push(`${stage}: ${msg}`); });
    assert.ok(result.warnings.some((w) => /^none of the 1 official pages could be read: Unexpected error in _crawl_web/.test(w)), result.warnings.join('\n') + '\n' + log.join('\n'));
  } finally {
    stop.abort();
    tearDown();
  }
});

test('official domains that do not resolve are dropped; the site triage read comes first; DNS down keeps the list', async () => {
  const lookup = async (host: string) => { if (host !== 'signmastr.com.my' && host !== 'signmastr.my') throw new Error('ENOTFOUND'); };
  const urls = ['https://signmastr.com.my/a', 'https://signmastr.com.my/b', 'https://www.signmastr.com/x', 'https://signmastr.my/'];
  assert.deepEqual(await liveDomains(['signmastr.com', 'signmastr.com.my', 'https://www.signmastr.my/'], '', urls, lookup), ['signmastr.com.my', 'signmastr.my']);
  assert.deepEqual(await liveDomains(['signmastr.com.my', 'signmastr.my'], 'signmastr.my', urls, lookup), ['signmastr.my', 'signmastr.com.my']);
  assert.deepEqual(await liveDomains(['a.example', 'b.example'], '', [], async () => { throw new Error('EAI_AGAIN'); }), ['a.example', 'b.example']);
});
