// Country handlers in Step 1.5 (assets.country_handlers) and how tidy hands them to Step 2. Offline: fetch is replaced.
import test from 'node:test';
import assert from 'node:assert/strict';
import { countryCodeOf } from './v21/catalog.ts';
import { runCountryHandlers, nameNote } from './v21/site-lookup.ts';
import { tidyCheckpoint } from './v21/tidy.ts';

const realFetch = globalThis.fetch;
test.afterEach(() => { globalThis.fetch = realFetch; });

const entry = (id: string, tier = 1, health = 'ok') => ({ id, tier, host: id, source_name: `Source ${id}`, source_url: 'https://x.example/', question: `q ${id}`, health: { state: health } });

function stubService(country: string, list: any[], answers: Record<string, any>) {
  const asked: string[] = [];
  globalThis.fetch = (async (url: string, init?: any) => {
    const u = String(url);
    if (u.includes(`/api/handlers?country=${country}`)) return new Response(JSON.stringify({ handlers: list }));
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

test('countryCodeOf knows the 25 research countries by every name a dive may carry, and nothing else', () => {
  for (const [name, code] of [['Malaysia', 'MY'], ['south korea', 'KR'], ['  UK ', 'GB'], ['United Kingdom', 'GB'], ['USA', 'US'], ['United States of America', 'US'],
    ['UAE', 'AE'], ['The Netherlands', 'NL'], ['Viet Nam', 'VN'], ['Russian Federation', 'RU'], ['Thailand', 'TH'], ['Taiwan', 'TW'], ['Japan', 'JP'], ['Ireland', 'IE'], ['New Zealand', 'NZ']]) {
    assert.equal(countryCodeOf(name), code, name);
  }
  assert.equal(countryCodeOf('Atlantis'), null);
  assert.equal(countryCodeOf(''), null);
});

test('runCountryHandlers asks every runnable handler of the country for the company name and keeps one that did not run', async () => {
  const asked = stubService('MY', [entry('MY-a/w1'), entry('MY-b/w2', 2, 'broken'), entry('MY-c/w1'), entry('MY-d/w1', 3), entry('MY-e/w1', 4)], {
    'MY-a/w1': { status: 'found', records: [{ name: 'ACME SDN BHD' }], source_url: 'https://a.example/', excerpt: '1 match' },
    'MY-b/w2': { status: 'not_found', records: [], excerpt: 'no match' },
    'MY-c/w1': 'crash',
  });
  const block = await runCountryHandlers('MY', 'Acme Sdn Bhd');
  assert.equal(block.status, 'done');
  assert.equal(block.company, 'Acme Sdn Bhd');
  assert.deepEqual(asked.sort(), ['MY-a/w1 Acme Sdn Bhd', 'MY-b/w2 Acme Sdn Bhd', 'MY-c/w1 Acme Sdn Bhd']); // tier 3 and 4 are not asked
  const by = Object.fromEntries(block.handlers.map((h) => [h.id, h]));
  assert.equal(by['MY-a/w1'].lookup.status, 'found');
  assert.equal(by['MY-b/w2'].health, 'broken'); // asked anyway; its health is recorded with its answer
  assert.equal(by['MY-b/w2'].lookup.status, 'not_found');
  assert.equal(by['MY-c/w1'].lookup.job_status, 'failed');
  assert.equal(by['MY-a/w1'].name_note, undefined);
});

test('runCountryHandlers asks all of a long list (the pool does not drop any) and notes an English name on an own-script register', async () => {
  const list = Array.from({ length: 45 }, (_, i) => entry(`TH-s${String(i).padStart(2, '0')}/w1`));
  const asked = stubService('TH', list, Object.fromEntries(list.map((h) => [h.id, { status: 'not_found', records: [], excerpt: 'none' }])));
  const block = await runCountryHandlers('TH', 'CP ALL Public Company');
  assert.equal(asked.length, 45);
  assert.equal(block.handlers.length, 45);
  assert.ok(block.handlers.every((h) => h.lookup.job_status === 'done' && h.name_note?.includes('Thai')));
  assert.equal(nameNote('TH', 'บริษัท ซีพี ออลล์ จำกัด (มหาชน)'), undefined); // a Thai name needs no note
  assert.equal(nameNote('MY', 'Acme'), undefined);
});

test('runCountryHandlers never throws: no country, no name, no handlers, or the service down', async () => {
  assert.equal((await runCountryHandlers(null, 'Acme')).status, 'not_run');
  assert.equal((await runCountryHandlers('MY', '  ')).status, 'not_run');
  stubService('MY', [], {});
  assert.equal((await runCountryHandlers('MY', 'Acme')).status, 'not_run');
  globalThis.fetch = (async () => { throw new Error('network down'); }) as typeof fetch;
  const down = await runCountryHandlers('MY', 'Acme');
  assert.equal(down.status, 'failed');
  assert.ok(down.error);
  assert.deepEqual(down.handlers, []);
});

const cp: any = { input: { company: 'Acme Sdn Bhd', country: 'Malaysia', industry: 'Interior designer' }, official_site: { domain: 'acme.com.my', pages: [] }, third_party_discoveries: [], probes: [] };
const ans = (id: string, lookup: any, extra: any = {}) => ({ id, question: `q ${id}`, source_name: `Source ${id}`, lookup, ...extra });

test('tidy: records found become evidence (first three records), "not listed" is one item, could-not-check stays out of the evidence', () => {
  const assets: any = {
    domains: [], findings: [], pagespeed: { status: 'none' },
    country_handlers: { status: 'done', country_code: 'MY', company: 'Acme Sdn Bhd', handlers: [
      ans('MY-a/w1', { handler: 'MY-a/w1', job_status: 'done', status: 'found', source_url: 'https://a.example/', excerpt: '5 matches', records: [1, 2, 3, 4, 5].map((i) => ({ name: `ACME ${i}`, status: 'struck off' })) }),
      ans('MY-b/w1', { handler: 'MY-b/w1', job_status: 'done', status: 'not_found', excerpt: 'none' }),
      ans('MY-c/w1', { handler: 'MY-c/w1', job_status: 'done', status: 'not_found', excerpt: 'none' }, { name_note: 'searched with the English name; this source is in Thai, so "not listed" here is unconfirmed' }),
      ans('MY-d/w1', { handler: 'MY-d/w1', job_status: 'done', status: 'couldnt_check', reason: 'blocked', excerpt: 'HTTP 403' }),
      ans('MY-e/w1', { handler: 'MY-e/w1', job_status: 'failed', error: 'no worker' }),
    ] },
  };
  const t = tidyCheckpoint(cp, assets);
  const country = t.evidence.filter((e) => e.check_id?.startsWith('country:'));
  assert.deepEqual(country.map((e) => e.check_id), ['country:MY-a/w1', 'country:not_listed']);
  assert.match(country[0].text, /5 matches/);
  assert.match(country[0].text, /Record 3: .*ACME 3/);
  assert.doesNotMatch(country[0].text, /Record 4/);
  assert.match(country[1].text, /Source MY-b\/w1/);
  assert.match(country[1].text, /Source MY-c\/w1 \(unconfirmed: searched with the English name/);
  const cannot = t.could_not_check.map((c: any) => c.target);
  assert.ok(cannot.includes('Source MY-d/w1') && cannot.includes('Source MY-e/w1'));
});

test('tidy: a failed country-handlers block is "could not check"; a block that was not run says nothing; no block changes nothing', () => {
  const failed = tidyCheckpoint(cp, { domains: [], findings: [], pagespeed: { status: 'none' }, country_handlers: { status: 'failed', error: 'service down', handlers: [] } } as any);
  assert.ok(failed.could_not_check.some((c: any) => /registers and directories/i.test(c.target) && c.reason === 'service down'));
  const notRun = tidyCheckpoint(cp, { domains: [], findings: [], pagespeed: { status: 'none' }, country_handlers: { status: 'not_run', reason: 'no handlers', handlers: [] } } as any);
  assert.equal(notRun.evidence.filter((e) => e.check_id?.startsWith('country:')).length, 0);
  assert.equal(notRun.could_not_check.some((c: any) => /registers and directories/i.test(c.target)), false);
  const none = tidyCheckpoint(cp, { domains: [], findings: [], pagespeed: { status: 'none' } } as any);
  assert.equal(none.evidence.filter((e) => e.check_id?.startsWith('country:')).length, 0);
});
