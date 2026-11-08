// Fake network only: these tests must never need the hub, paid keys or a live worker.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { makeCtx, writeLane, laneFile } from './divedeeper/lib.ts';
import { serviceFailures } from './divedeeper/runner.ts';
import { exa, tavily } from './core/index.ts';
import { setProxy } from './core/proxy.ts';
import * as jobs from './jobs.ts';
import { run as web } from './divedeeper/sections/H-web.ts';
import { run as brand } from './divedeeper/sections/B-brand.ts';
import { factSheet, profileOf } from './divedeeper/sections/G-shared.ts';
import { loadV21Dive } from './divedeeper/v21/adapter.ts';

type Request = { url: string; init: RequestInit; body: any };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
async function network(answer: (r: Request) => Response | Promise<Response>, work: (requests: Request[]) => Promise<void>) {
  const realFetch = globalThis.fetch;
  const names = ['DATABASE_URL', 'PG_PROXY_URL', 'BRAVE_API_KEYS', 'GMAP_API_KEY', 'V21_DEEPER_WORKER_URL'];
  const before = names.map((name) => process.env[name]);
  delete process.env.DATABASE_URL;
  delete process.env.PG_PROXY_URL;
  process.env.BRAVE_API_KEYS = 'fake-brave';
  process.env.GMAP_API_KEY = 'fake-worker';
  process.env.V21_DEEPER_WORKER_URL = 'https://worker.test';
  setProxy(null);
  exa.setKeysForTests(['fake-exa']);
  tavily.setKeysForTests(['fake-tavily']);
  const requests: Request[] = [];
  globalThis.fetch = (async (input, init = {}) => {
    const r = { url: String(input instanceof Request ? input.url : input), init, body: init.body ? JSON.parse(String(init.body)) : null };
    requests.push(r);
    return answer(r);
  }) as typeof fetch;
  try { await work(requests); }
  finally {
    globalThis.fetch = realFetch;
    exa.setKeysForTests(null);
    tavily.setKeysForTests(null);
    names.forEach((name, i) => { if (before[i] === undefined) delete process.env[name]; else process.env[name] = before[i]; });
  }
}

test('legacy read uses its broker and hub fallback; page still accepts POST; exa still requests paid text', async () => {
  await network((r) => {
    if (r.url === 'https://legacy.test/') return new Response('<h1>Hub page</h1>', { headers: { server: 'legacy' } });
    if (r.url === 'https://legacy.test/form') { assert.equal(r.init.method, 'POST'); return new Response('posted'); }
    if (r.url.startsWith('https://api.exa.ai/')) return json({ results: [{ url: 'https://legacy.test/', title: 'Old', text: 'Paid text' }] });
    assert.fail(`unexpected request: ${r.url}`);
  }, async (requests) => {
    const ctx = makeCtx('legacy-worker-test', 'Z', 'test');
    assert.equal(ctx.v21, false);
    assert.ok(!jobs.liveTypes().includes('fetch.pages'));
    assert.deepEqual(await ctx.read('https://legacy.test/'), { url: 'https://legacy.test/', finalUrl: '', status: 200, text: 'Hub page', via: 'hub' });
    assert.equal((await ctx.page('https://legacy.test/form', { method: 'POST', body: '{}' })).html, 'posted');
    assert.equal((await ctx.exa('old search', { text: 123 }))[0].text, 'Paid text');
    assert.deepEqual(requests.find((r) => r.url.startsWith('https://api.exa.ai/'))!.body.contents, { text: { maxCharacters: 123 } });
    const worker = 'legacy-page-worker-test';
    jobs.touch(worker, null, ['fetch.pages']);
    try {
      const reading = ctx.read('https://broker.test/');
      const job = jobs.snapshot().jobs.find((j) => j.type === 'fetch.pages' && (j.payload as any).urls?.includes('https://broker.test/'));
      assert.ok(job);
      jobs.finish(job.id, true, { pages: [{ url: 'https://broker.test/', markdown: '# Broker text' }] }, null);
      assert.equal((await reading).text, '# Broker text');
    } finally { jobs.touch(worker, null, []); }
    assert.ok(requests.every((r) => !r.url.includes('worker.test')));
  });
});

test('V2.1 reads markdown and HTML only on myworker and refuses non-GET before sending anything', async () => {
  await network((r) => {
    assert.equal(r.url, 'https://worker.test/api/fetch');
    assert.equal(r.init.method, 'POST');
    assert.equal(r.body.mainContent, false);
    assert.ok(r.init.signal);
    return json({ job: { status: 'done', result: { url: r.body.url, finalUrl: 'https://page.test/final', status: r.body.format === 'html' ? 404 : 200,
      content: r.body.format === 'html' ? '<h1>Not found</h1>' : '# Worker text', headers: { server: 'worker' }, worker: 'pc-test' } } });
  }, async (requests) => {
    const ctx = makeCtx('worker-test', 'Z', 'test', { worker: 'myworker' });
    assert.equal(ctx.v21, true);
    assert.deepEqual(await ctx.read('https://page.test/'), { url: 'https://page.test/', finalUrl: 'https://page.test/final', status: 200, text: '# Worker text', via: 'pc-test' });
    const page = await ctx.page('https://page.test/', { headers: { accept: 'text/html' } });
    assert.equal(page.status, 404);
    assert.equal(page.finalUrl, 'https://page.test/final');
    assert.deepEqual(page.headers, { server: 'worker' });
    assert.equal(page.html, '<h1>Not found</h1>');
    assert.ok(page.ms >= 0);
    assert.deepEqual(requests.map((r) => r.body), [
      { url: 'https://page.test/', format: 'markdown', mainContent: false, wait: 60 },
      { url: 'https://page.test/', format: 'html', mainContent: false, keepErrors: true, headers: true, wait: 60 },
    ]);
    const post = await ctx.page('https://page.test/', { method: 'POST', body: '{}' });
    assert.equal(post.status, 0);
    assert.equal(post.error, 'only GET runs on the worker; use a site handler');
    assert.equal(requests.length, 2);
    assert.deepEqual(ctx.meter.http, { calls: 2, failed: 0 });
    assert.equal(ctx.meter.calls.filter((c) => c.provider === 'myworker').length, 2);
    assert.deepEqual(ctx.waitingOn(), []);
  });
});

test('worker failures warn and count HTTP failures without a hub or paid fallback or lane failure', async () => {
  await network((r) => {
    assert.equal(r.url, 'https://worker.test/api/fetch');
    return json({ job: { status: 'failed', error: 'DNS failed' } });
  }, async (requests) => {
    const ctx = makeCtx('worker-test', 'Z', 'test', { worker: 'myworker' });
    for (const out of [await ctx.read('https://page.test/'), await ctx.page('https://page.test/')]) {
      assert.equal(out.status, 0);
      assert.equal(out.error, 'DNS failed');
    }
    assert.equal(requests.length, 2);
    assert.deepEqual(ctx.meter.http, { calls: 2, failed: 2 });
    assert.equal(ctx.warnings.length, 2);
    assert.ok(ctx.meter.calls.every((c) => !c.ok));
    assert.equal(serviceFailures(ctx.meter), null);
  });
});

test('read treats old-worker HTTP failures as status zero while page preserves the HTTP status', async () => {
  await network(() => json({ job: { status: 'failed', error: 'the site answered HTTP 404' } }), async () => {
    const ctx = makeCtx('worker-test', 'Z', 'test', { worker: 'myworker' });
    const read = await ctx.read('https://page.test/missing');
    assert.equal(read.status, 0);
    assert.equal(read.error, 'HTTP 404');
    const page = await ctx.page('https://page.test/missing');
    assert.equal(page.status, 404);
    assert.deepEqual(page.headers, {});
    assert.equal(page.html, '');
    assert.deepEqual(ctx.meter.http, { calls: 2, failed: 1 });
    assert.equal(serviceFailures(ctx.meter), null);
  });
});

test('V2.1 Exa and both fallbacks discard paid text and worker-read at most the first five results', async () => {
  for (const engine of ['exa', 'tavily', 'brave']) await network((r) => {
    const rows = Array.from({ length: 7 }, (_, i) => ({ url: `https://pages.test/${i}`, title: `Result ${i}`,
      text: 'Paid text', content: 'Paid text', description: 'Paid text', extra_snippets: ['Paid text'], highlights: ['Paid text'] }));
    if (r.url.startsWith('https://api.exa.ai/')) { assert.ok(!('contents' in r.body)); return engine === 'exa' ? json({ results: rows }) : json({}, 503); }
    if (r.url.startsWith('https://api.tavily.com/')) return engine === 'tavily' ? json({ results: rows }) : json({}, 503);
    if (r.url.startsWith('https://api.search.brave.com/')) return json({ web: { results: rows } });
    assert.equal(r.url, 'https://worker.test/api/fetch');
    assert.equal(r.body.format, 'markdown');
    return r.body.url.endsWith('/1') ? json({ job: { status: 'failed', error: 'page refused' } })
      : json({ job: { status: 'done', result: { status: 200, content: 'Worker content for ' + r.body.url } } });
  }, async (requests) => {
    const ctx = makeCtx('worker-test', 'G', 'grounded', { worker: 'myworker' });
    const rows = await ctx.exa('query', { numResults: 7, text: 6 });
    assert.equal(rows.length, 7);
    assert.deepEqual(rows.map((r) => r.text), ['Worker', '', 'Worker', 'Worker', 'Worker', '', '']);
    assert.ok(rows.every((r) => Object.keys(r).sort().join(',') === 'text,title,url'));
    assert.equal(requests.filter((r) => r.url === 'https://worker.test/api/fetch').length, 5);
    assert.deepEqual(ctx.meter.http, { calls: 5, failed: 1 });
    assert.equal(serviceFailures(ctx.meter), null);
    const count = requests.length;
    assert.ok((await ctx.exa('URLs only', { numResults: 7 })).every((r) => r.text === ''));
    assert.ok(requests.slice(count).every((r) => r.url !== 'https://worker.test/api/fetch'));
  });
});

test('V2.1 URL-only news searches retain dates for lane ranking without fetching paid or worker text', async () => {
  await network((r) => {
    assert.ok(r.url.startsWith('https://api.exa.ai/'));
    assert.ok(!('contents' in r.body));
    return json({ results: [{ url: 'https://news.test/story', title: 'Acme', publishedDate: '2026-11-07', text: 'Paid text', highlights: ['Paid snippet'] }] });
  }, async (requests) => {
    const ctx = makeCtx('worker-news-test', 'N', 'news', { worker: 'myworker' });
    assert.deepEqual(await ctx.exa('Acme', { category: 'news' }), [{ url: 'https://news.test/story', title: 'Acme', text: '', publishedDate: '2026-11-07' }]);
    assert.equal(requests.length, 1);
  });
});

test('text true caps worker text at 4000; a failed worker read does not trigger another search engine', async () => {
  let failed = false;
  await network((r) => {
    if (r.url.startsWith('https://api.exa.ai/')) return json({ results: [{ url: 'https://pages.test/', title: 'A', text: 'Paid' }] });
    assert.equal(r.url, 'https://worker.test/api/fetch');
    return failed ? json({ job: { status: 'failed', error: 'worker offline' } }) : json({ job: { status: 'done', result: { status: 200, content: 'x'.repeat(5000) } } });
  }, async (requests) => {
    const ctx = makeCtx('worker-test', 'G', 'grounded', { worker: 'myworker' });
    assert.equal((await ctx.exa('q', { text: true }))[0].text.length, 4000);
    failed = true;
    assert.equal((await ctx.exa('q', { text: true }))[0].text, '');
    assert.equal(requests.length, 4);
    assert.equal(ctx.meter.exa.failed, 0);
  });
});

test('lookup and shot preserve worker answers, track pending work and meter failures as warnings', async () => {
  let release!: (answer: Response) => void;
  let arrived!: () => void;
  const requested = new Promise<void>((resolve) => { arrived = resolve; });
  let blocked = false;
  await network((r) => {
    if (r.url.endsWith('/api/lookup')) return new Promise<Response>((resolve) => { release = resolve; arrived(); });
    assert.equal(r.url, 'https://worker.test/api/shot');
    return blocked ? json({ job: { status: 'done', result: { blocked: true, detail: { evidence: ['challenge'] }, status: 403 } } })
      : json({ job: { status: 'failed', error: 'browser failed' } });
  }, async () => {
    const ctx = makeCtx('worker-test', 'Z', 'test', { worker: 'myworker' });
    const pending = ctx.lookup('MY-register/w1', 'Acme');
    await requested;
    assert.match(ctx.waitingOn()[0], /lookup MY-register\/w1: Acme/);
    assert.ok(release);
    release(json({ job: { status: 'done', result: { handler: 'MY-register/w1', version: 'v1', result: { status: 'not_found', reason: null, records: [] } } } }));
    assert.equal((await pending as any).status, 'not_found');
    assert.deepEqual(await ctx.shot({ url: 'https://page.test/', device: 'mobile', find: 'Call' }), { error: 'browser failed' });
    blocked = true;
    assert.equal((await ctx.shot({ url: 'https://page.test/' }) as any).blocked, true);
    assert.deepEqual(ctx.meter.http, { calls: 3, failed: 1 });
    assert.equal(ctx.meter.calls.length, 3);
    assert.equal(serviceFailures(ctx.meter), null);
    assert.deepEqual(ctx.waitingOn(), []);
  });
});

const dive = { company: 'Acme', result: { identity: { legal_name: 'Acme Sdn Bhd', aliases: ['Acme'], official_domains: ['acme.test'], industry: 'Solar', address: 'Johor' }, facts: [] },
  v21: { pages: [{ label: 'home', url: 'https://acme.test/', text: 'Acme installs solar. Ten years of work.' }], site_wide: 'Call Acme' } };

test('H-web V2.1 uses the shared H-plan and ranks own pages without name search, classification or page reads', async () => {
  const id = randomUUID();
  const plan = { trades: ['solar installer'], areas: ['Johor'], offices: ['Johor'], picked_at: 'today' };
  writeLane(id, 'H-plan', plan);
  try {
    const ctx = makeCtx(id, 'H', 'web', { worker: 'myworker' });
    const queries: string[] = [];
    ctx.brave = async (q) => { queries.push(q); return [{ url: 'https://other.test/' }, { url: 'https://acme.test/services' }]; };
    ctx.llm = async () => assert.fail('no name classification or new plan');
    ctx.page = async () => assert.fail('no page checks in V2.1 H-web');
    const out = await web(ctx, dive);
    assert.deepEqual(queries, ['solar installer Johor']);
    assert.deepEqual(out.notes.plan, plan);
    assert.equal((out.notes.ranks as any[])[0].rank, 2);
    assert.deepEqual(out.notes.unique, []);
    assert.equal(out.findings.length, 1);
  } finally { await fs.unlink(laneFile(id, 'H-plan')); }
});

test('B-brand reuses saved V2.1 pages and earlier H-web/G-search outputs; legacy still reads its own pages', async () => {
  const id = randomUUID();
  writeLane(id, 'H-web', { notes: { unique: [{ official: false, title: 'External Acme', url: 'https://other.test/', description: 'Outside description' }] } });
  writeLane(id, 'G-search', { notes: { prompts: [{ id: 'what', text: 'What is Acme?' }], answers: [{ id: 'what', sample: 0, answer: 'AI description of Acme' }] } });
  try {
    for (const v21 of [true, false]) {
      const ctx = makeCtx(id, 'B', 'brand', v21 ? { worker: 'myworker' } : undefined);
      let reads = 0;
      ctx.read = async (url) => { reads++; return { url, finalUrl: url, status: 200, text: 'Legacy pitch '.repeat(30), via: 'test' }; };
      ctx.exa = async (_query, opts) => { assert.equal(opts?.text, 1500); assert.deepEqual(opts?.excludeDomains, ['acme.test']); return [{ url: 'https://outside.test', title: 'Acme', text: 'Acme from worker' }]; };
      ctx.llm = async (prompt) => {
        assert.match(prompt, /Outside description/);
        assert.match(prompt, /AI description of Acme/);
        if (v21) { assert.match(prompt, /Ten years of work/); assert.match(prompt, /Call Acme/); }
        else assert.match(prompt, /Legacy pitch/);
        return JSON.stringify({ selling_points: [{ point: 'Experience', quote: 'Ten years of work.', proof: 'Ten years' }] });
      };
      const out = await brand(ctx, dive);
      assert.equal(reads, v21 ? 0 : 1);
      assert.deepEqual(out.notes.pages, ['https://acme.test/']);
      assert.equal((out.notes.selling_points as any[])[0].quote, v21 ? 'Ten years of work.' : '');
    }
    const ctx = makeCtx(id, 'B', 'brand', { worker: 'myworker' });
    ctx.read = async () => assert.fail('missing saved pages must not be fetched again');
    ctx.exa = async () => [];
    ctx.llm = async () => '{}';
    await brand(ctx, { ...dive, v21: { pages: [] } });
    assert.match(ctx.warnings.join(' '), /no saved official page text/);
  } finally { await Promise.all(['H-web', 'G-search'].map((name) => fs.unlink(laneFile(id, name)))); }
});

test('G shared helpers receive all needed identity and fact-sheet fields from the adapter', async () => {
  const { dive: adapted } = await loadV21Dive('fixture', {
    getReport: async () => ({ company: 'Acme', country: 'Malaysia', industry: 'Solar', step1_status: 'done', step2_status: 'done' }),
    latestRaw: async (_id, kind) => ({ id: 1, payload: kind === 'tidy'
      ? { official: { pages: [{ label: 'home', url: 'https://acme.test', text: 'We install solar.' }], site_wide: 'Founded in 2018' } }
      : kind === 'result' ? { baseline: { legal_names: ['Acme Sdn Bhd'], phones: ['07-1234567'], addresses: ['12345 Johor Bahru, Johor'], claimed_credentials: ['SEDA'] },
        findings: [{ type: 'contradiction', claim: '07-1234567', outside_source: '07-7654321' }] }
      : { official_site: { domain: 'acme.test' } } }),
  });
  const sheet = factSheet(adapted);
  assert.doesNotMatch(sheet, /undefined/);
  for (const text of ['Acme Sdn Bhd', '12345 Johor Bahru', '07-1234567', '07-7654321', 'We install solar.', 'Founded in 2018', 'SEDA']) assert.ok(sheet.includes(text), text);
  const ctx = makeCtx(randomUUID(), 'G', 'fixed', { worker: 'myworker' });
  ctx.llm = async (prompt) => { assert.match(prompt, /Location facts:\n- Office: 12345 Johor Bahru/); return JSON.stringify({ trade: 'solar installer', area: 'Johor Bahru', state: 'Johor' }); };
  assert.equal((await profileOf(ctx, adapted)).trade, 'solar installer');
});
