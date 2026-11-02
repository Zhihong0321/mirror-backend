import test from 'node:test';
import assert from 'node:assert/strict';
import * as pi from './core/pi.ts';
import { officialSite, pickSitePages } from './contact-worker.ts';
import * as tavilyPipeline from './contact-tavily.ts';
import * as exaPipeline from './contact-exa.ts';
import * as tavilyApi from './core/tavily.ts';
import * as exaApi from './core/exa.ts';

const target = { name: "Kim's Florist & Floral Supplies", website: '', extraUrls: [], location: 'Johor Bahru' };

test('the official site is the lead website, else a hit whose host spells the name, never a directory or social page', () => {
  assert.equal(officialSite({ ...target, website: 'https://kims.example/' }, []), 'https://kims.example/');
  const sources = [
    { url: 'https://www.facebook.com/kimsflorist', kind: 'other', why: '' },
    { url: 'https://www.yellowpages.my/listing/kims-florist', kind: 'other', why: '' },
    { url: 'https://www.kimsflorist.com.my/contact', kind: 'other', why: '' },
  ];
  assert.equal(officialSite(target, sources), 'https://www.kimsflorist.com.my/');
  assert.equal(officialSite(target, sources.slice(0, 2)), '');
  assert.equal(officialSite({ ...target, name: 'Antlerzone Sdn Bhd' }, [{ url: 'https://www.antlerzone.com/x', kind: 'other', why: 'Antlerzone homestay, Johor Bahru' }]), 'https://www.antlerzone.com/');
  // A firm that shares only a common word, and a directory's per-company subdomain, are not the site.
  const lidsoon = { ...target, name: 'Lidsoon Machinery' };
  assert.equal(officialSite(lidsoon, [{ url: 'https://www.ecsmachinery.com.my/', kind: 'other', why: '' }]), '');
  assert.equal(officialSite({ ...target, name: 'Agribusiness Publishing Sdn. Bhd.' }, [
    { url: 'https://my563666-agribusiness-publishing-sdn-bhd.contact.page/', kind: 'other', why: '' },
  ]), '');
  assert.equal(officialSite(lidsoon, [{ url: 'http://lidsoon.blogspot.com/2019/01/post.html', kind: 'other', why: 'Lidsoon Machinery, Johor Bahru' }]), 'http://lidsoon.blogspot.com/');
  assert.equal(officialSite(lidsoon, [{ url: 'https://lidsoon.com.my/about', kind: 'other', why: '' }]), 'https://lidsoon.com.my/');
  // Off .my, the hit must show it is in Malaysia: multec.co.uk is a UK firm.
  const multec = { ...target, name: 'Multec Machinery', location: 'Jalan Austin Perdana' };
  assert.equal(officialSite(multec, [{ url: 'https://multec.co.uk/', kind: 'other', why: 'Multec, precision engineering in Sheffield' }]), '');
  assert.equal(officialSite(multec, [{ url: 'https://multec.com/', kind: 'other', why: 'Multec Machinery, Austin Perdana, Johor' }]), 'https://multec.com/');
});

test('site pages: home first, then contact, about and team paths on the same host, shortest first', () => {
  const picked = pickSitePages('https://www.antlerzone.com/', [
    'https://www.antlerzone.com/blog/post-1',
    'https://www.antlerzone.com/about-us',
    'https://www.antlerzone.com/contact',
    'https://antlerzone.com/contact/',
    'https://other.example/contact',
    'https://www.antlerzone.com/logo-contact.png',
  ]);
  assert.deepEqual(picked, ['https://www.antlerzone.com/', 'https://www.antlerzone.com/contact', 'https://www.antlerzone.com/about-us']);
});

test('an Exa person result reads as its name and current jobs only', () => {
  const line = exaPipeline.personLine({
    url: 'https://www.linkedin.com/in/valentina-kim',
    entities: [{
      type: 'person',
      properties: {
        name: 'Valentina Kim',
        location: 'Johor Bahru, Malaysia',
        workHistory: [
          { title: 'Owner', company: { name: "Kim's Florist" }, dates: { from: '2001-01', to: null } },
          { title: 'Sales Assistant', company: { name: 'Old Shop' }, dates: { from: '1998-01', to: '2000-12' } },
        ],
      },
    }],
  });
  assert.equal(line, "Valentina Kim — now: Owner at Kim's Florist — Johor Bahru, Malaysia");
});

test('tel, mailto and WhatsApp links are kept, other links are not', () => {
  assert.deepEqual(exaPipeline.contactLinks([
    'https://www.antlerzone.com/contact', 'tel:+6072243663', 'mailto:sales@kims.example?subject=Hi', 'https://wa.me/60169629627', 'https://wa.me/60169629627',
  ]), ['tel:+6072243663', 'mailto:sales@kims.example', 'https://wa.me/60169629627']);
});

test('the Tavily pipeline searches on Tavily, reads the site on a fetch worker, and keeps the report shape', async () => {
  const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
  const fetchMock = (async (url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    calls.push({ url, body });
    const json = (value: unknown) => new Response(JSON.stringify(value), { status: 200 });
    if (url.endsWith('/search')) {
      return json({
        results: body.include_domains ? [] : [{ url: 'https://www.kimsflorist.com.my/', title: "Kim's Florist", content: 'Tel 07-224 3663', raw_content: 'Kim\'s Florist\nTel: 07-224 3663' }],
        usage: { credits: body.search_depth === 'advanced' ? 2 : 1 },
      });
    }
    if (url.endsWith('/map')) return json({ results: ['https://www.kimsflorist.com.my/', 'https://www.kimsflorist.com.my/contact-us'], usage: { credits: 1 } });
    throw new Error('the pipeline fetched a page itself: ' + url);
  }) as typeof fetch;
  // The site's pages come from a fetch worker (pagefetch.ts), never Tavily's /extract.
  const read: string[][] = [];
  const readPages = async (urls: string[]) => {
    read.push(urls);
    return { results: [{ url: 'https://www.kimsflorist.com.my/contact-us', raw_content: 'Contact Valentina Kim, Owner\nHP 012-319 7772\nsales@kimsflorist.com.my' }],
      failed_results: [], usage: { credits: 0 }, worker: 'pc-test-fetch' };
  };
  pi.setRunnerForTests(async () => JSON.stringify({
    people: [{ name: 'valentina kim', position: 'Owner', evidence_url: 'https://www.kimsflorist.com.my/contact-us' }],
    phones: [{ number: '012-319 7772', label: 'Valentina Kim mobile', evidence_url: 'https://www.kimsflorist.com.my/contact-us' }],
    emails: [{ email: 'sales@kimsflorist.com.my', label: 'Sales', evidence_url: 'https://www.kimsflorist.com.my/contact-us' }],
  }));
  try {
    const result = await (tavilyApi.setKeysForTests(['tvly-test']), tavilyPipeline.research({ name: target.name, location: 'Johor Bahru' }, { fetchImpl: fetchMock, timeoutMs: 60_000, readPages }));
    const people = result.decision_makers as Array<Record<string, unknown>>;
    assert.equal(people[0]!.name, 'Valentina Kim');
    assert.equal(people[0]!.found_by, 'tavily');
    assert.equal(people[0]!.direct_phone, '012-319 7772');
    const meta = result.research_meta as Record<string, unknown>;
    assert.equal(meta.official_site, 'https://www.kimsflorist.com.my/');
    assert.deepEqual(meta.cost, { tavily_credits: 6, dollars: 0.048 });
    assert.equal(read.length, 1, 'the site is read in one worker batch');
    assert.ok(read[0]!.includes('https://www.kimsflorist.com.my/contact-us'));
    assert.ok(!calls.some((call) => call.url.endsWith('/extract')), 'Tavily is never asked to read a page');
    assert.ok(calls.every((call) => call.url.startsWith('https://api.tavily.com/')));
    assert.ok(calls.filter((call) => call.url.endsWith('/search')).every((call) => call.body.country === 'malaysia'));
  } finally {
    pi.setRunnerForTests(null);
  }
});
