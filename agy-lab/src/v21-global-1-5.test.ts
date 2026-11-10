// Global handlers in Step 1.5 (assets.global_handlers) and how tidy hands them to Step 2. Offline: fetch is replaced.
import test from 'node:test';
import assert from 'node:assert/strict';
import { runGlobalHandlers } from './v21/site-lookup.ts';
import { tidyCheckpoint } from './v21/tidy.ts';

const realFetch = globalThis.fetch;
test.afterEach(() => { globalThis.fetch = realFetch; });

const entry = (id: string, name: string) => ({ id, tier: 1, host: id, source_name: name, source_url: 'https://x.example/', question: `q ${id}`, why_it_matters: `why ${id}` });

function stubService(answers: Record<string, any>) {
  const asked: string[] = [];
  globalThis.fetch = (async (url: string, init?: any) => {
    const u = String(url);
    if (u.includes('/api/handlers?country=ALL')) return new Response(JSON.stringify({ handlers: Object.keys(answers).map((id) => entry(id, `Source ${id}`)) }));
    if (u.endsWith('/api/lookup')) {
      const body = JSON.parse(init.body);
      asked.push(`${body.handler} ${body.keyword}`);
      const a = answers[body.handler];
      if (a === 'crash') return new Response(JSON.stringify({ error: 'no worker' }), { status: 503 });
      return new Response(JSON.stringify({ job: { status: 'done', worker: 'pc-1', result: { version: 'v1', result: a } } }));
    }
    throw new Error(`unexpected ${u}`);
  }) as typeof fetch;
  return asked;
}

test('runGlobalHandlers runs every handler on the domain and keeps a handler that did not run', async () => {
  const asked = stubService({
    'ALL-dns/w1': { status: 'found', records: [{}], source_url: 'https://dns.example/', excerpt: 'Mail (MX): zoho' },
    'ALL-crtsh/w1': 'crash',
    'ALL-youtube/w1': { status: 'not_found', reason: 'no_youtube_link_on_website', records: [], excerpt: 'no link' },
  });
  const block = await runGlobalHandlers('dezeno.com.my');
  assert.equal(block.status, 'done');
  assert.equal(block.domain, 'dezeno.com.my');
  assert.deepEqual(asked.sort(), ['ALL-crtsh/w1 dezeno.com.my', 'ALL-dns/w1 dezeno.com.my', 'ALL-youtube/w1 dezeno.com.my']);
  const by = Object.fromEntries(block.handlers.map((h) => [h.id, h.lookup]));
  assert.equal(by['ALL-dns/w1'].status, 'found');
  assert.equal(by['ALL-crtsh/w1'].job_status, 'failed');
  assert.equal(by['ALL-youtube/w1'].reason, 'no_youtube_link_on_website');
});

test('runGlobalHandlers returns a failed block, never throws, when the service cannot be read', async () => {
  globalThis.fetch = (async () => { throw new Error('network down'); }) as typeof fetch;
  const block = await runGlobalHandlers('dezeno.com.my');
  assert.equal(block.status, 'failed');
  assert.ok(block.error);
  assert.deepEqual(block.handlers, []);
});

const cp: any = { input: { company: 'Dezeno', country: 'Malaysia', industry: 'Interior designer' }, official_site: { domain: 'dezeno.com.my', pages: [] }, third_party_discoveries: [], probes: [] };
const ans = (id: string, lookup: any) => ({ id, question: `q ${id}`, source_name: `Source ${id}`, why_it_matters: '', lookup });

test('tidy: a handler that answered becomes an evidence item; one that did not run or could not check is "could not check"', () => {
  const assets: any = {
    domains: [], findings: [], pagespeed: { status: 'none' },
    global_handlers: { status: 'done', domain: 'dezeno.com.my', handlers: [
      ans('ALL-dns/w1', { handler: 'ALL-dns/w1', job_status: 'done', status: 'found', source_url: 'https://dns.example/', excerpt: 'Mail (MX): zoho' }),
      ans('ALL-youtube/w1', { handler: 'ALL-youtube/w1', job_status: 'done', status: 'not_found', excerpt: 'The home page links no YouTube channel.' }),
      ans('ALL-wayback/w1', { handler: 'ALL-wayback/w1', job_status: 'done', status: 'couldnt_check', reason: 'archive_unreachable', excerpt: 'could not be read' }),
      ans('ALL-crtsh/w1', { handler: 'ALL-crtsh/w1', job_status: 'failed', error: 'no worker' }),
    ] },
  };
  const t = tidyCheckpoint(cp, assets);
  const global = t.evidence.filter((e) => e.check_id?.startsWith('global:'));
  assert.deepEqual(global.map((e) => e.check_id), ['global:ALL-dns/w1', 'global:ALL-youtube/w1']);
  assert.equal(global[0].text, 'Mail (MX): zoho');
  assert.equal(global[0].domain, 'dezeno.com.my');
  assert.match(global[1].title ?? '', /nothing found/);
  const cnc = t.could_not_check.map((c) => `${c.target}: ${c.reason}`);
  assert.ok(cnc.some((c) => c.startsWith('Source ALL-wayback/w1') && c.includes('archive_unreachable')), cnc.join(' | '));
  assert.ok(cnc.some((c) => c.startsWith('Source ALL-crtsh/w1') && c.includes('no worker')), cnc.join(' | '));
});

test('tidy: a global block that did not run is one "could not check" line; no block (flag off) adds nothing', () => {
  const off = tidyCheckpoint(cp, { domains: [], findings: [], pagespeed: { status: 'none' } } as any);
  assert.ok(!off.evidence.some((e) => e.check_id?.startsWith('global:')));
  assert.ok(!off.could_not_check.some((c) => /Public records/.test(c.target)));
  const notRun = tidyCheckpoint(cp, { domains: [], findings: [], pagespeed: { status: 'none' }, global_handlers: { status: 'not_run', reason: 'No confirmed official website', handlers: [] } } as any);
  assert.ok(notRun.could_not_check.some((c) => /Public records/.test(c.target) && /official website/.test(c.reason)));
});
