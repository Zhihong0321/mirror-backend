import test from 'node:test';
import assert from 'node:assert/strict';
import { buildList, htmlFacts, keyPages, readJson, run, site, toMarkdown, withoutImages, type Deps } from './competitor-sites.ts';
import { handle } from './competitor-sites-http.ts';

const HOME = JSON.stringify({ companies: Array.from({ length: 12 }, (_, i) => ({ name: `Home ${i}`, website: `home${i}.my` })) });
const NB = JSON.stringify({ countries: [
  { country: 'Singapore', companies: [{ name: 'SG A', website: 'https://sga.sg' }, { name: 'SG B', website: 'sgb.sg' }, { name: 'SG C', website: 'sgc.sg' }] },
  { country: 'Thailand', companies: [{ name: 'TH A', website: 'tha.co.th' }] },
  { country: 'Indonesia', companies: [{ name: 'dup', website: 'www.home1.my' }, { name: 'ID A', website: 'ida.co.id' }] },
  { country: 'Brunei', companies: [{ name: 'BN', website: 'bn.bn' }] },
] });

const PAGE = `<html lang="en"><head><title>Acme Solar</title><meta name="viewport" content="width=device-width">
<link rel="stylesheet" href="/s.css"><link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400&family=Open+Sans" rel="stylesheet">
<style>body{color:#0B2545;font-family:"Inter",sans-serif}</style></head><body class="elementor">
<a href="/about-us">About Us</a><a href="/why-choose-us">Why us</a><a href="/services">Services</a><a href="/contact">Contact</a><a href="https://fb.com">x</a>
<a href="https://wa.me/601">WhatsApp</a><form><input name="email"><textarea name="msg"></textarea></form>Get a Quote © 2019 - 2024 Acme</body></html>`;

function fakeDeps(over: Partial<Deps> = {}, calls: unknown[][] = []): Deps {
  return {
    chat: async (p) => ({ answer: p.includes('neighbouring') ? 'Sure! ```json\n' + NB + '\n```' : HOME }),
    fetchPage: async (url, ask) => {
      if (url.includes('down')) return { error: 'connect ECONNREFUSED' };
      if (url.endsWith('/robots.txt')) return { finalUrl: url, status: 200, content: 'Sitemap: ' + new URL(url).origin + '/sm.xml' };
      if (url.endsWith('/sm.xml')) return { finalUrl: url, status: 200, content: '<urlset><loc>a</loc><loc>b</loc><loc>c</loc></urlset>' };
      if (url.endsWith('.css')) return { finalUrl: url, status: 200, content: 'h1{font-family:Montserrat;color:#f5a623}' };
      if (/\.xml$/.test(url)) return { finalUrl: url, status: 404, content: '' };
      return { finalUrl: url, status: 200, content: ask.format === 'html' ? PAGE : `# Page ${url}\nWe are the best.` };
    },
    shot: async () => ({ image: 'A'.repeat(800), blocked: false, status: 200 }),
    ask: async (messages) => {
      calls.push(messages);
      const user: any = (messages as any[])[1].content;
      const text = typeof user === 'string' ? user : user[0].text;
      if (text.includes('Compare them')) return JSON.stringify({ summary: 'All similar.', conclusion: 'Done.', standouts: [{ company: 'Home 0', why: 'clean' }] });
      if (text.includes('"positioning"')) return JSON.stringify({ positioning: 'Best installer', headline_message: 'Save more', why_choose_us: ['cheap'] });
      return JSON.stringify({ design: { summary: 'Clean.', modernity_score: 8, modernity_verdict: 'modern', colour_theme: ['navy #0b2545'] }, content_volume: { level: 'medium' }, functions: [{ name: 'Request a quote', evidence: 'hero' }], based_on: 'screenshot + facts' });
    },
    sleep: async () => {},
    log: () => {},
    ...over,
  };
}

test('readJson and site read loose answers', () => {
  assert.deepEqual(readJson('Here:\n```json\n{"a":1}\n```'), { a: 1 });
  assert.equal(readJson('no json'), null);
  assert.deepEqual(site('www.Acme.com.my/'), { url: 'https://www.acme.com.my', domain: 'acme.com.my' });
  assert.equal(site('n/a'), null);
});

test('list: 10 home + 2 per neighbour (max 3), duplicates merged, own site added as the 17th', async () => {
  const l = await buildList({ country: 'Malaysia', industry: 'solar', own_website: 'https://eternalgy.me' }, fakeDeps());
  assert.equal(l.competitors.filter((c) => c.source === 'home').length, 10);
  assert.deepEqual(l.neighbours, ['Singapore', 'Thailand', 'Indonesia']);
  assert.deepEqual(l.competitors.filter((c) => c.source === 'neighbour').map((c) => c.domain), ['sga.sg', 'sgb.sg', 'tha.co.th', 'ida.co.id']);
  assert.equal(l.competitors.length, 15);
  assert.equal(l.competitors.at(-1)!.own, true);
  assert.ok(l.notes.some((n) => n.includes('Thailand: only 1')));
});

test('list: own site already in the list is marked, not added again', async () => {
  const l = await buildList({ country: 'Malaysia', industry: 'solar', own_website: 'home3.my' }, fakeDeps());
  assert.equal(l.competitors.filter((c) => c.own).length, 1);
  assert.equal(l.competitors.find((c) => c.own)!.source, 'home');
});

test('list: ChatGPT never giving JSON still returns (empty list, reasons recorded)', async () => {
  const l = await buildList({ country: 'Malaysia', industry: 'solar' }, fakeDeps({ chat: async () => ({ error: 'tab crashed' }) }));
  assert.equal(l.competitors.length, 0);
  assert.ok(l.notes.some((n) => n.includes('tab crashed')));
});

test('htmlFacts and keyPages read the mechanical facts', () => {
  const f: any = htmlFacts(PAGE, 'h1{font-family:Montserrat}', 'https://acme.my');
  assert.equal(f.title, 'Acme Solar');
  assert.equal(f.latest_copyright_year, 2024);
  assert.ok(f.platform_signs.includes('Elementor'));
  assert.ok(f.function_signs.includes('request a quote') && f.function_signs.includes('WhatsApp'));
  assert.ok(f.fonts.some((x: any) => x.value === 'Poppins') && f.fonts.some((x: any) => x.value === 'Montserrat'));
  assert.equal(f.colours[0].value, '#0b2545');
  assert.deepEqual(keyPages(f.nav_links).map((p) => p.kind), ['about', 'why us', 'services']);
});

test('run: a dead site, a refused screenshot and a failed final call all still give a full report', async () => {
  const calls: unknown[][] = [];
  const deps = fakeDeps({
    chat: async (p) => ({ answer: p.includes('neighbouring') ? '{"countries":[]}' : JSON.stringify({ companies: [{ name: 'Good', website: 'good.my' }, { name: 'Down', website: 'down.my' }] }) }),
  }, calls);
  const ask = deps.ask;
  deps.ask = async (m) => {
    const user: any = (m as any[])[1].content;
    if (Array.isArray(user)) throw new Error('HTTP 400: image input not supported');
    if (typeof user === 'string' && user.includes('Compare them')) throw new Error('lane down');
    return ask(m);
  };
  const r = await run({ country: 'Malaysia', industry: 'solar', own_website: 'eternalgy.me' }, deps);
  assert.equal(r.sites.length, 3);
  const good = r.sites[0]!;
  assert.equal(good.read.sitemap.pages, 3);
  assert.equal(good.read.screenshot.ok, true);
  assert.equal(good.design.ok, true);
  assert.match(good.design.note!, /facts only/);
  const down = r.sites[1]!;
  assert.match(down.read.error!, /ECONNREFUSED/);
  assert.equal(r.final.ok, false);
  const md = toMarkdown(r);
  assert.match(md, /The final comparison failed/);
  assert.match(md, /site could not be read/);
  assert.match(md, /\*\*\(own\)\*\*/);
  assert.match(md, /Modern: \*\*8\/10, modern\*\*/);
  assert.ok(!JSON.stringify(withoutImages(r)).includes('A'.repeat(800)));
});

test('run: the full happy path gives the summary and per-site sections', async () => {
  const r = await run({ country: 'Malaysia', industry: 'solar' }, fakeDeps());
  assert.equal(r.sites.length, 14);
  assert.equal(r.final.ok, true);
  const md = toMarkdown(r);
  assert.match(md, /## Summary\n\nAll similar\./);
  assert.match(md, /### 14\. ID A: Indonesia/);
  assert.match(md, /Why choose us/);
});

test('http: no switch; a missing country or industry is asked for, never guessed', async () => {
  const out: { status?: number; body?: any } = {};
  const ctx = { json: (_res: any, status: number, body: unknown) => { out.status = status; out.body = body; }, readJson: async () => ({ country: 'Malaysia' }) };
  const req: any = { method: 'POST' };
  assert.equal(await handle(req, {} as any, new URL('http://x/api/competitor-sites'), ctx), true);
  assert.equal(out.status, 400);
  assert.match(out.body.error, /industry/);
  assert.equal(await handle(req, {} as any, new URL('http://x/api/other'), ctx), false);
});
