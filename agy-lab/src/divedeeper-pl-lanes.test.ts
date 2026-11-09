// PL2, PL3, PL5, PL11 (input), PL14 for the domain lane. Companies and domains are made up and from several countries.
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import dns from 'node:dns/promises';
import net from 'node:net';
import tls from 'node:tls';
import { htmlText, parseJson, writeLane, laneFile, type Ctx, type Finding } from './divedeeper/lib.ts';
import { run as assets, ownershipOf, weakest, fixFor, mergeByCheck } from './divedeeper/sections/A-assets.ts';
import { partyForUrl } from './divedeeper/sections/D-registry.ts';

test('PL3 ownership comes from the registrant against the company names, for any country', () => {
  assert.equal(ownershipOf('NTK Elektro Oy', ['NTK Elektro Oy'], true), 'owned');
  assert.equal(ownershipOf('Aurora Energi AS', ['Aurora Energi'], true), 'owned');
  assert.equal(ownershipOf('Sakura Denki K.K.', ['Sakura Denki Kabushiki Kaisha', 'Sakura Denki'], false), 'owned');
  assert.equal(ownershipOf('Pixel Studio Pty Ltd', ['Mesa Solar Pty Ltd'], true), 'used_by');
  assert.equal(ownershipOf(null, ['Mesa Solar Pty Ltd'], true), 'used_by');
  assert.equal(ownershipOf(null, ['Mesa Solar Pty Ltd'], false), 'unknown');
  // Only a legal-form word in common is not a match.
  assert.equal(ownershipOf('Delta Holdings Ltd', ['Omega Foods Ltd'], false), 'unknown');
  assert.equal(weakest(['owned', 'owned']), 'owned');
  assert.equal(weakest(['owned', 'used_by']), 'used_by');
  assert.equal(weakest([]), 'unknown');
});

test('PL5 only an owned domain gets an order; others get "if you control it"', () => {
  assert.equal(fixFor('owned', 'Renew it now.'), 'Renew it now.');
  assert.equal(fixFor('used_by', 'Renew it now.'), 'If you control it, renew it now.');
  assert.equal(fixFor('unknown', 'Set DMARC.', true), 'If you control them, set DMARC.');
});

test('PL14 mergeByCheck: 3 domains failing one check are one finding with 3 rows; 1 domain stays one', () => {
  const f = (domain: string, own: string, extra: Record<string, unknown> = {}) => ({ title: `No DMARC on ${domain}`, detail: 'x', severity: 'medium', source: null, checked_at: 't', check: 'dmarc', domain, ownership: own, label: 'No DMARC record', what: 'There is no DMARC record.', fix: 'Set DMARC.', ...extra }) as Finding;
  const merged = mergeByCheck([f('a.example', 'owned'), f('b.example', 'used_by'), f('c.example', 'owned'), { title: 'other', detail: '', severity: 'info', source: null, checked_at: 't', check: 'inventory' }]);
  assert.equal(merged.filter((x) => x.check === 'dmarc').length, 1);
  const m = merged.find((x) => x.check === 'dmarc')!;
  assert.equal((m.evidence_rows as any[]).length, 3);
  assert.equal(m.ownership, 'used_by');
  assert.match(m.detail, /If you control them, set DMARC/);
  assert.equal(merged.length, 2);
  const one = mergeByCheck([f('a.example', 'owned')]);
  assert.equal(one.length, 1);
  assert.equal((one[0].evidence_rows as any[]).length, 1);
  assert.equal(one[0].label, undefined);
  // The earliest expiry date is kept for the renderer.
  const e = mergeByCheck([f('a.example', 'owned', { check: 'expiry', expires_at: '2027-02-01T00:00:00.000Z' }), f('b.example', 'owned', { check: 'expiry', expires_at: '2027-01-05T00:00:00.000Z' })]);
  assert.equal(e[0].expires_at, '2027-01-05T00:00:00.000Z');
});

// ---- the whole lane, with the network replaced ----
function ctxFor(): Ctx {
  const page = async (url: string) => ({ url, finalUrl: url, status: 200, html: '<title>Welcome</title><p>Hello</p>', headers: {}, ms: 5 });
  return {
    v21: false, diveId: `pl-${randomUUID()}`, meter: { other: {}, http: { calls: 0, failed: 0 }, llm: { calls: 0, failed: 0 }, exa: { failed: 0 }, brave: { failed: 0 }, maps: { failed: 0 } },
    now: () => new Date().toISOString(), warn: () => {}, log: () => {}, htmlText, parseJson, call: () => ({ done: () => {} }), page,
  } as unknown as Ctx;
}
function network(t: TestContext, reg: Record<string, { org: string | null; expires?: string }>) {
  t.mock.method(dns, 'resolve4', async () => ['192.0.2.9']);
  t.mock.method(dns, 'resolveNs', async () => []);
  t.mock.method(dns, 'resolveMx', async () => [{ priority: 1, exchange: 'mail.example.test' }]);
  t.mock.method(dns, 'resolveTxt', async () => []);
  t.mock.method(net, 'connect', (...args: any[]) => { const s: any = new EventEmitter(); s.setEncoding = () => s; s.write = () => queueMicrotask(() => { s.emit('end'); }); queueMicrotask(() => args.at(-1)()); return s; });
  t.mock.method(tls, 'connect', (...args: any[]) => { const s: any = new EventEmitter(); s.authorized = true; s.end = () => {}; s.getPeerCertificate = () => ({ valid_to: 'Jan 1 2040 GMT', issuer: { O: 'Test CA' } }); queueMicrotask(() => args.at(-1)()); return s; });
  t.mock.method(globalThis, 'fetch', async (input: any) => {
    const url = String(input);
    if (url.endsWith('/dns.json')) return new Response(JSON.stringify({ services: [[['test'], ['https://rdap.test/']]] }));
    if (url.endsWith('/ipv4.json')) return new Response(JSON.stringify({ services: [[['192.0.0.0/8'], ['https://rdap.test/']]] }));
    const d = url.match(/\/domain\/(.+)$/)?.[1];
    if (d && reg[d]) {
      const r = reg[d];
      return new Response(JSON.stringify({ events: r.expires ? [{ eventAction: 'expiration', eventDate: r.expires }] : [], status: [], nameservers: [],
        entities: r.org ? [{ roles: ['registrant'], vcardArray: ['vcard', [['fn', {}, 'text', r.org]]] }] : [] }));
    }
    return new Response('{}', { status: url.includes('/domain/') ? 404 : 200 });
  });
}
async function runLane(t: TestContext, company: string, domains: string[], reg: Parameters<typeof network>[1]) {
  network(t, reg);
  const ctx = ctxFor();
  const emails = Object.fromEntries(domains.map((d) => [d, [`info@${d}`]]));
  writeLane(ctx.diveId, 'C-merged', { notes: { emails } });
  t.after(async () => { await fs.rm(laneFile(ctx.diveId, 'C-merged'), { force: true }); });
  const dive = { company, result: { identity: { legal_name: company, official_domains: domains }, facts: [] } };
  return assets(ctx, dive);
}

test('PL14/PL3/PL5 three domains with no DMARC give one finding with three rows and neutral wording', async (t) => {
  const out = await runLane(t, 'NTK Elektro Oy', ['ntk-a.test', 'ntk-b.test', 'ntk-c.test'], {
    'ntk-a.test': { org: 'NTK Elektro Oy' }, 'ntk-b.test': { org: 'Pixel Studio Ltd' }, 'ntk-c.test': { org: null },
  });
  const dm = out.findings.filter((f) => f.check === 'dmarc');
  assert.equal(dm.length, 1);
  assert.equal((dm[0].evidence_rows as any[]).length, 3);
  assert.deepEqual((dm[0].evidence_rows as any[]).map((r) => r.ownership), ['owned', 'used_by', 'used_by']);
  assert.equal(dm[0].ownership, 'used_by');
  assert.match(dm[0].detail, /If you control them, set a DMARC/);
  assert.doesNotMatch(dm[0].title + dm[0].detail, /your domain/i);
  // The SPF failure is merged the same way, and every domain finding carries an ownership value and a party.
  assert.equal(out.findings.filter((f) => f.check === 'spf').length, 1);
  for (const f of out.findings.filter((x) => x.domain || x.domains)) assert.ok(['owned', 'used_by', 'unknown'].includes(String(f.ownership)), f.title);
  for (const f of out.findings) assert.ok(f.party === 'first' || f.party === 'independent', f.title);
  assert.equal(out.findings.find((f) => f.check === 'registrant')?.party, 'independent');
  assert.equal(dm[0].party, 'first');
});

test('PL5/PL11 an expiry on a proven-owned domain says "Turn on", another party\'s says "If you control it"; the date is structured', async (t) => {
  const soon = new Date(Date.now() + 20 * 86_400_000).toISOString();
  const owned = await runLane(t, 'Mesa Solar Pty Ltd', ['mesa.test'], { 'mesa.test': { org: 'Mesa Solar Pty Ltd', expires: soon } });
  const o = owned.findings.find((f) => f.check === 'expiry')!;
  assert.equal(o.ownership, 'owned');
  assert.match(o.detail, /Turn on auto-renew/);
  assert.equal(o.expires_at, soon);
  assert.equal(o.severity, 'high');
  assert.equal(o.party, 'independent');
});
test('PL5 expiry on a domain held by a web agency is neutral', async (t) => {
  const soon = new Date(Date.now() + 20 * 86_400_000).toISOString();
  const used = await runLane(t, 'Sakura Denki KK', ['sakura.test'], { 'sakura.test': { org: 'Webya Agency GK', expires: soon } });
  const u = used.findings.find((f) => f.check === 'expiry')!;
  assert.equal(u.ownership, 'used_by');
  assert.match(u.detail, /If you control it, turn on auto-renew/);
  assert.doesNotMatch(u.title + u.detail, /your domain/i);
  assert.match(used.findings.find((f) => f.check === 'registrant')!.detail, /If you control it, transfer/);
});

test('R1 mergeByCheck: different failure modes of one check are not merged', () => {
  const f = (domain: string, label: string, check = 'expiry', extra: Record<string, unknown> = {}) => ({ title: `${label} ${domain}`, detail: 'x', severity: 'medium', source: null, checked_at: 't', check, domain, ownership: 'owned', label, what: `${label}.`, fix: 'Fix.', ...extra }) as Finding;
  const expiry = mergeByCheck([f('a.example', 'Registration expired'), f('b.example', 'Registration expires soon'), f('c.example', 'Registration expires soon')]);
  assert.equal(expiry.length, 2);
  assert.match(expiry.find((x) => /expired/.test(x.title))!.title, /a\.example/);
  assert.equal((expiry.find((x) => /soon/.test(x.title))!.evidence_rows as any[]).length, 2);
  const dmarc = mergeByCheck([f('a.example', 'No DMARC record', 'dmarc'), f('b.example', 'DMARC only watches', 'dmarc'), f('c.example', 'No DMARC record', 'dmarc')]);
  assert.equal(dmarc.length, 2);
  const spf = mergeByCheck([f('a.example', 'No SPF record', 'spf'), f('b.example', 'More than one SPF record', 'spf')]);
  assert.equal(spf.length, 2);
  assert.ok(spf.every((x) => /SPF/.test(x.title)));
});

test('R1 ownershipOf: a short name matches a whole word of the registrant', () => {
  assert.equal(ownershipOf('HP Inc.', ['HP'], false), 'owned');
  assert.equal(ownershipOf('3M Company', ['3M'], false), 'owned');
  assert.equal(ownershipOf('SAP SE', ['SAP SE'], false), 'owned');
  assert.equal(ownershipOf('LG Electronics Inc.', ['LG Electronics'], true), 'owned');
  assert.equal(ownershipOf('비바리퍼블리카(토스)', ['토스'], false), 'owned');
  assert.equal(ownershipOf('Hpe Holdings', ['HP'], true), 'used_by');
  assert.equal(ownershipOf('Omega Foods', ['HP'], false), 'unknown');
});

test('R1 partyForUrl: no URL or an empty domain never counts as the company\'s own', () => {
  assert.equal(partyForUrl(undefined, ['', 'example.com']), 'independent');
  assert.equal(partyForUrl('', ['']), 'independent');
  assert.equal(partyForUrl(null, undefined), 'independent');
  assert.equal(partyForUrl('https://www.example.com/x', ['example.com']), 'first');
  assert.equal(partyForUrl('https://register.gov.example/x', ['example.com']), 'independent');
});
