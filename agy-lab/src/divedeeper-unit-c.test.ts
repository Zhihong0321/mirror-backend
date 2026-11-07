import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import dns from 'node:dns/promises';
import net from 'node:net';
import tls from 'node:tls';
import { htmlText, parseJson, writeLane, laneFile, type Ctx } from './divedeeper/lib.ts';
import { serviceFailures } from './divedeeper/runner.ts';
import { run as crawl } from './divedeeper/sections/C-merged.ts';
import { run as contacts } from './divedeeper/sections/R-contacts.ts';
import { run as assets } from './divedeeper/sections/A-assets.ts';

function context(v21 = true) {
  const warnings: string[] = [], pages: string[] = [], reads: string[] = [], searches: string[] = [], profiles: string[] = [], prompts: string[] = [];
  const ctx = {
    v21, diveId: `unit-c-${randomUUID()}`, warnings,
    meter: { other: {}, http: { calls: 0, failed: 0 }, llm: { calls: 0, failed: 0 }, exa: { failed: 0 }, brave: { failed: 0 }, maps: { failed: 0 } },
    now: () => '2026-11-07T00:00:00Z', warn: (s: string) => warnings.push(s), log: () => {}, htmlText, parseJson,
    call: () => ({ done: () => {} }),
    page: async (url: string) => { pages.push(url); return page(url, '<title>Acme official website</title><p>Acme</p>'); },
    read: async (url: string) => { reads.push(url); return { url, finalUrl: url, status: 200, text: 'WORKER_TEXT: Acme contact page', via: 'myworker' }; },
    brave: async (q: string) => { searches.push(q); return []; },
    exa: async (q: string) => { profiles.push(q); return []; },
    llm: async (q: string) => { prompts.push(q); return '{}'; },
  } as unknown as Ctx;
  return { ctx, warnings, pages, reads, searches, profiles, prompts };
}
function page(url: string, html: string, status = 200, headers: Record<string, string> = {}) {
  return { url, finalUrl: url, status, html, headers, ms: 10 };
}
function domain(domain = 'acme.test') {
  return { domain, registration: { registrar: 'Saved registrar', created: '2020-01-01', expires: '2020-02-01', org: 'Different owner', status: [], ns: [], source: 'RDAP', is_locked: false, error: 'no answer' },
    dns: { a: ['192.0.2.10'], ns: ['ns.acme.test'], mx: ['mail.acme.test'], spf: null, dmarc: null },
    tls: { valid: false, issuer: 'Saved CA', expires_at: '2020-02-01', days_remaining: -1 }, email_security: { has_spf: false, has_dmarc: false } };
}
function dive() {
  return { company: 'Acme Sdn Bhd', result: { identity: { legal_name: 'Acme Sdn Bhd', official_domains: ['acme.test'], registration_numbers: ['123456-W'], address: '1, Jalan Satu' },
    facts: [{ fact: 'Phone 03-2234 5678' }], people: { people: [] } },
    v21: { assets: { domains: [domain()], site_audit: { status: 'done' } }, baseline: { phones: ['03-2234 5678'], emails: ['amy@acme.test'], addresses: ['2, Jalan Dua'] } } };
}
function lanes(t: TestContext, ctx: Ctx, C: any = {}, H: any = {}) {
  writeLane(ctx.diveId, 'C-merged', { notes: C });
  writeLane(ctx.diveId, 'H-maps', { notes: H });
  t.after(async () => { for (const lane of ['C-merged', 'H-maps']) await fs.rm(laneFile(ctx.diveId, lane), { force: true }); });
}

// All network functions are replaced. The call log catches a forbidden lookup even if a lane catches its error.
function network(t: TestContext) {
  const calls: string[] = [];
  t.mock.method(dns, 'resolve4', async (name: string) => { calls.push(`A ${name}`); return name.startsWith('dev.') ? ['192.0.2.20'] : []; });
  t.mock.method(dns, 'resolveNs', async (name: string) => { calls.push(`NS ${name}`); return []; });
  t.mock.method(dns, 'resolveMx', async (name: string) => { calls.push(`MX ${name}`); return []; });
  t.mock.method(dns, 'resolveTxt', async (name: string) => { calls.push(`TXT ${name}`); return []; });
  t.mock.method(net, 'connect', (...args: any[]) => {
    calls.push(`WHOIS ${args[1]}`);
    const socket: any = new EventEmitter();
    socket.setEncoding = () => socket;
    socket.write = () => { queueMicrotask(() => { socket.emit('data', 'No match'); socket.emit('end'); }); };
    queueMicrotask(() => args.at(-1)());
    return socket;
  });
  t.mock.method(tls, 'connect', (...args: any[]) => {
    calls.push(`TLS ${args[0].host}`);
    const socket: any = new EventEmitter();
    socket.authorized = true;
    socket.end = () => {};
    socket.getPeerCertificate = () => ({ valid_to: 'Jan 1 2030 GMT', issuer: { O: 'Test CA' } });
    queueMicrotask(() => args.at(-1)());
    return socket;
  });
  t.mock.method(globalThis, 'fetch', async (input: any) => {
    const url = String(input); calls.push(url);
    const body = url.endsWith('/ipv4.json') ? { services: [[['192.0.0.0/8'], ['https://rdap.test/']]] }
      : url.endsWith('/dns.json') ? { services: [[['test', 'com'], ['https://rdap.test/']]] }
      : url.includes('/ip/') ? { name: 'Test hosting' }
      : url.includes('crt.sh') ? [] : {};
    return new Response(JSON.stringify(body), { status: url.includes('/domain/') ? 404 : 200 });
  });
  return calls;
}

test('C V2.1 reuses the audit and retains site-specific checks and exact quotes', async (t) => {
  const calls = network(t), f = context(), d = dive();
  d.v21.assets.domains[0].dns.mx = [];
  lanes(t, f.ctx, {}, { listings: [{ name: 'Acme', phone: '03-3234 5678' }] });
  const home = `<title>X</title><img src="http://acme.test/image.png"><p>Acme (654321-X) info@gmail.com</p><p>9, Jalan Satu</p>
    <p>We delivers excellent service to every customer. ${'Our team builds reliable equipment. '.repeat(6)}</p>
    <a href="/contact">Contact</a><a href="/news">News</a><a href="/unreadable">Read</a><a href="/private">Private</a>
    <a href="tel:123">Call</a><a href="tel:03-2234 5678">Phone</a><a href="mailto:amy@acme.test">Email</a><a href="https://wa.me/60322345678">WhatsApp</a>`;
  f.ctx.page = async (url, init) => {
    f.pages.push(url); assert.ok(!init?.method || init.method === 'GET');
    if (url.endsWith('/robots.txt')) return page(url, 'User-agent: *\nDisallow: /private');
    if (url.includes('wa.me')) return page(url, '<h3 class="_9vd5 _9scb _9scr">Other Business</h3>');
    if (url.endsWith('/contact')) return page(url, '<p>Coming soon</p><form method="post" action="http://acme.test/send"><input name="email"></form>');
    if (url.endsWith('/news')) return page(url, '<p>News 2020-01-01</p>');
    if (url.endsWith('/unreadable')) return { ...page(url, '', 0), error: 'worker offline' };
    return page(url, home);
  };
  f.ctx.llm = async (q) => { f.prompts.push(q); return JSON.stringify({ issues: [
    { type: 'grammar', quote: 'We delivers excellent service', severity: 'medium', why: 'Wrong verb' },
    { type: 'grammar', quote: 'Invented quote never on page', severity: 'high' },
  ] }); };
  const out = await crawl(f.ctx, d), checks = out.findings.map((f) => f.check);
  for (const kept of ['ssm', 'free-mail', 'phone-maps', 'address', 'whatsapp', 'tel', 'mailto', 'form', 'stale-news', 'placeholder', 'llm']) assert.ok(checks.includes(kept), kept);
  for (const skipped of ['ssl', 'https-redirect', 'viewport', 'title', 'meta-description', 'broken-link', 'page-status', 'slow', 'mixed-content']) assert.ok(!checks.includes(skipped), skipped);
  assert.deepEqual(calls, []);
  assert.ok(!f.pages.some((u) => u.startsWith('http:') || u.endsWith('/private') || u.endsWith('/send')));
  assert.ok(f.warnings.some((s) => s.includes('worker offline')));
  assert.ok(!out.findings.some((f) => f.evidence === 'Invented quote never on page'));
  assert.equal(serviceFailures(f.ctx.meter), null);
});

for (const v21 of [true, false]) test(`C ${v21 ? 'V2.1 without a completed audit' : 'legacy'} retains the original checks`, async (t) => {
  const calls = network(t), f = context(v21), d = dive();
  if (v21) d.v21.assets.site_audit.status = 'failed';
  lanes(t, f.ctx);
  f.ctx.page = async (url) => { f.pages.push(url); return page(url, url.endsWith('/robots.txt') ? '' : '<title>X</title><a href="/private">Read</a>'); };
  const out = await crawl(f.ctx, d);
  assert.ok(calls.includes('TLS acme.test'));
  assert.ok(f.pages.includes('http://acme.test/'));
  assert.ok(out.findings.some((x) => x.check === 'viewport'));
  assert.ok(out.findings.some((x) => x.check === 'title'));
  assert.ok(out.findings.some((x) => x.check === 'meta-description'));
});

test('C V2.1 defacement stops the crawl, link checks and LLM', async (t) => {
  const calls = network(t), f = context(); lanes(t, f.ctx);
  f.ctx.page = async (url) => { f.pages.push(url); return page(url, '<title>Casino</title><p>casino poker togel judi jackpot</p><a href="/about">About</a>'); };
  const out = await crawl(f.ctx, dive());
  assert.deepEqual(out.findings.map((f) => f.check), ['defacement']);
  assert.deepEqual(f.pages, ['https://acme.test/']);
  assert.deepEqual(f.prompts, []); assert.deepEqual(calls, []);
});

test('R V2.1 searches each contact once, reads at most 15 unique pages and never judges snippets or profiles', async (t) => {
  const calls = network(t), f = context(), d = dive();
  lanes(t, f.ctx, { sitePhones: { '03-2234 5678': ['https://acme.test/'] }, emails: { 'acme.test': ['amy@acme.test'] }, waStatus: [{ number: '60322345678', business: 'Amy', valid: true }] },
    { listings: [{ name: 'Acme', phone: '03-3234 5678', address: '3, Jalan Tiga' }] });
  f.ctx.brave = async (q) => { f.searches.push(q); return Array.from({ length: 20 }, (_, i) => ({ title: `Directory ${i}`, url: `https://directory.test/${i}`, description: 'SEARCH_SNIPPET_POISON', text: 'PAID_TEXT_POISON', extra_snippets: ['EXTRA_SNIPPET_POISON'] })); };
  f.ctx.read = async (url) => { f.reads.push(url); return { url, finalUrl: url, status: url.endsWith('/0') ? 0 : 200, text: url.endsWith('/0') ? 'FAILED_TEXT_POISON' : 'WORKER_TEXT: company contact', via: 'myworker' }; };
  const out = await contacts(f.ctx, d);
  assert.equal(f.searches.length, 3); // Two phones (one also on WhatsApp), one email.
  assert.equal(f.reads.length, 15); assert.equal(new Set(f.reads).size, 15);
  assert.deepEqual(f.profiles, []); assert.deepEqual(calls, []);
  assert.equal(f.warnings.filter((w) => w.includes('no key people')).length, 1);
  assert.match(f.prompts[0], /WORKER_TEXT/);
  assert.doesNotMatch(f.prompts[0], /SEARCH_SNIPPET_POISON|PAID_TEXT_POISON|EXTRA_SNIPPET_POISON|FAILED_TEXT_POISON/);
  assert.match(f.prompts[0], /2, Jalan Dua|3, Jalan Tiga/);
  assert.deepEqual(out.notes.lookups, {});
  const evidence = out.notes.evidence as any[];
  assert.equal(evidence[0].pages[1].rank, 2);
});

test('R legacy keeps snippet evidence and the existing personal profile lookup', async (t) => {
  const calls = network(t), f = context(false), d = dive();
  lanes(t, f.ctx, { emails: { 'acme.test': ['amy@acme.test'] }, mailStatus: [{ email: 'amy@acme.test', mx: ['mail.acme.test'] }] });
  f.ctx.brave = async () => [{ title: 'Directory', url: 'https://directory.test/', description: 'amy@acme.test LEGACY_SNIPPET' }];
  await contacts(f.ctx, d);
  assert.equal(f.profiles.length, 1); assert.deepEqual(f.reads, []);
  assert.match(f.prompts[0], /LEGACY_SNIPPET/);
  assert.ok(!f.warnings.some((s) => s.includes('no key people'))); assert.deepEqual(calls, []);
});

test('R V2.1 searches every baseline phone and email beyond the legacy inventory caps', async (t) => {
  const calls = network(t), f = context(), d = dive(); lanes(t, f.ctx);
  d.result.facts = [];
  d.v21.baseline.phones = Array.from({ length: 11 }, (_, i) => `03-2234 ${5600 + i}`);
  d.v21.baseline.emails = Array.from({ length: 7 }, (_, i) => `sales${i}@acme.test`);
  await contacts(f.ctx, d);
  assert.equal(f.searches.length, 18);
  assert.equal(new Set(f.searches).size, 18);
  assert.deepEqual(f.reads, []); assert.deepEqual(f.profiles, []); assert.deepEqual(calls, []);
});

for (const headers of [{ 'x-generator': 'WordPress 5.9', server: 'nginx' }, {}] as Record<string, string>[]) test(`A V2.1 reuses saved checks and keeps hosting, parked pages, CMS and subdomains (${Object.keys(headers).length ? 'headers' : 'old worker'})`, async (t) => {
  const calls = network(t), f = context(), d = dive();
  const ip = Object.keys(headers).length ? '192.0.2.11' : '192.0.2.12';
  d.v21.assets.domains[0].dns.a = [ip];
  // A three-letter brand avoids unrelated lookalike calls in this reuse test.
  d.company = d.result.identity.legal_name = 'DNE Sdn Bhd';
  lanes(t, f.ctx, { emails: { 'acme.test': ['amy@acme.test'] } });
  f.ctx.page = async (url) => {
    f.pages.push(url);
    if (url.includes('crt.sh')) return page(url, JSON.stringify([{ name_value: 'dev.acme.test\nwww.acme.test' }]));
    return page(url, '<title>Domain is for sale</title>' + (Object.keys(headers).length ? '' : '<meta name="generator" content="WordPress 5.9">') + '<p>Buy this domain</p>', 200, headers);
  };
  const out = await assets(f.ctx, d), rows = out.notes.domains as any[];
  assert.equal(rows[0].reused_step15, true);
  assert.deepEqual(rows[0].step15, d.v21.assets.domains[0]);
  assert.equal(rows[0].cert.ok, false); assert.equal(rows[0].site.cms, 'WordPress'); assert.equal(rows[0].site.version, '5.9');
  assert.match(rows[0].cms_note, Object.keys(headers).length ? /worker headers and HTML/ : /no headers.*HTML only/);
  assert.ok(out.findings.some((x) => x.check === 'parked'));
  assert.ok(out.findings.some((x) => x.check === 'cms'));
  assert.ok(out.findings.some((x) => x.check === 'subdomain'));
  assert.ok(!out.findings.some((x) => ['expiry', 'registrant', 'spf', 'dmarc', 'cert', 'email-dkim'].includes(String(x.check))));
  assert.ok(f.pages.some((u) => u.includes('crt.sh')));
  assert.ok(calls.some((u) => u.includes(`/ip/${ip}`)));
  assert.ok(!calls.some((u) => /^(WHOIS|TLS|MX|NS|TXT) |^A acme\.test$|\/domain\/|crt\.sh/.test(u)), calls.join('\n'));
  assert.deepEqual(out.notes.email, []);
});

for (const v21 of [true, false]) test(`A ${v21 ? 'V2.1 with an unchecked domain' : 'legacy even with saved assets'} performs fresh domain checks`, async (t) => {
  const calls = network(t), f = context(v21), d = dive();
  t.mock.method(dns, 'resolve4', async (name: string) => { calls.push(`A ${name}`); return name === 'acme.test' ? ['192.0.2.50'] : []; });
  d.company = d.result.identity.legal_name = 'DNE Sdn Bhd';
  if (v21) d.v21.assets.domains = [];
  lanes(t, f.ctx);
  await assets(f.ctx, d);
  for (const kind of ['A', 'NS', 'MX', 'TXT']) assert.ok(calls.includes(`${kind} acme.test`), kind);
  assert.ok(calls.some((x) => x.endsWith('/domain/acme.test')));
  assert.ok(calls.includes('TLS acme.test'));
  assert.equal(f.pages.some((u) => u.includes('crt.sh')), v21);
  assert.equal(calls.some((u) => u.includes('crt.sh')), !v21);
});

test('A V2.1 still investigates lookalike domains', async (t) => {
  const calls = network(t), f = context(); lanes(t, f.ctx);
  const out = await assets(f.ctx, dive());
  assert.ok(calls.some((u) => u.endsWith('/domain/acme.com')));
  assert.ok(calls.some((u) => u.startsWith('WHOIS ')));
  assert.ok(out.findings.some((x) => x.check === 'lookalike'));
});
