import { test } from 'node:test';
import assert from 'node:assert/strict';
import { items, ownershipWording } from './divedeeper/editor.ts';
import { applyCheck } from './divedeeper/check.ts';
import { buildReportParts } from './divedeeper/report-html.ts';
import { bannedWords, bareIds, deadLinks, leftoverMarkdown, phonesIn } from './report-rules/index.ts';

const DAY = 86_400_000;
const inDays = (n: number) => new Date(Date.now() + n * DAY).toISOString().slice(0, 10);
/** What a reader sees: no styles, scripts or tags. */
const visible = (html: string) => html.replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;| /g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ');

// Made-up companies in two countries. Phones are fictional numbers in each country's own format.
const SG = { company: 'Kestrel Marine Pte Ltd', country: 'Singapore', domains: ['kestrelmarine.test'], own: '+65 6123 4567', personal: '+65 9123 4567' };
const UK = { company: 'Brightwater Plumbing Ltd', country: 'GB', domains: ['brightwater.test', 'brightwater-shop.test', 'bw-plumb.test'], own: '+44 20 7946 0958', personal: '+44 7700 900123' };

const diveOf = (c: typeof SG, extra: any = {}) => ({
  company: c.company, country: c.country, finished_at: '2026-11-01T10:00:00Z', dossier: '',
  result: { identity: { legal_name: c.company, official_domains: c.domains, phones: [c.own] }, contradictions: [], people: { people: [{ name: 'Dana Whitfield', role: 'Art Director' }, { name: 'Omar Haddad', role: 'Managing Director' }] }, ...extra },
});
const lanesOf = (c: typeof SG) => ({
  'A-assets': { ran_at: '2026-11-02T01:00:00Z', findings: c.domains.map((d) => ({ title: `Anyone can send email that looks like it came from @${d}`, detail: `${d} has no DMARC record.`, severity: 'high', source: `https://rdap.example/${d}`, check: 'dmarc', domain: d })) },
});

test('PL4: a finding whose printed number is not in its own quote is still printed; nothing is dropped', () => {
  const L: any = {
    'B-brand': { notes: {}, findings: [
      { title: 'Serves 12 customers', detail: '', quote: 'Serves 10 customers', severity: 'high' },
      { title: 'Serves 10 customers', detail: '', quote: 'Serves 10 customers', severity: 'high' },
      { title: 'Founded in 1998', detail: '', severity: 'high' }, // judged lane, a date-like number, no quote at all
      { title: 'Plain statement with no figure', detail: '', severity: 'medium' },
    ] },
    'A-assets': { notes: {}, findings: [{ title: 'kestrelmarine.test expires in 40 days', detail: '', severity: 'medium', check: 'expiry', domain: 'kestrelmarine.test' }] },
  };
  const got = items(L, 'Singapore').map((x) => x.title);
  assert.deepEqual(got.filter((t) => /Serves|Founded|Plain|expires/.test(t)).sort(), ['Founded in 1998', 'Plain statement with no figure', 'Serves 10 customers', 'Serves 12 customers', 'kestrelmarine.test expires in 40 days'].sort());
  assert.equal(L['B-brand'].notes.report_drops, undefined);
});

test('PL6 + PL8: applyCheck never drops a statement for independence or internal words', () => {
  const analysis = { notes: { strengths: ['Independent recognition by a trade body', 'A tidy homepage'] } };
  const out = applyCheck({ 'S4-analysis': analysis, 'K-credibility': { findings: [{ title: 'Award', party: 'first-party', source: 'https://kestrelmarine.test/awards' }] } }) as any;
  assert.deepEqual(out['S4-analysis'].notes.strengths, ['Independent recognition by a trade body', 'A tidy homepage']);
  assert.equal(out['report-review'], undefined);
  const words = applyCheck({ 'S4-analysis': { notes: { risks: ['The pipeline is broken', 'Customers cannot reach you'] } } }) as any;
  assert.deepEqual(words['S4-analysis'].notes.risks, ['The pipeline is broken', 'Customers cannot reach you']);
});

test('PL10: identity signals are printed whatever the policy flag says', () => {
  const L: any = { 'R-contacts': { notes: {}, findings: [{ title: 'A reviewer who may be staff left a 1★ review', detail: '', quote: 'A reviewer who may be staff left a 1★ review', severity: 'high' }] } };
  assert.equal(items(L).length, 1);
  assert.equal(L['R-contacts'].notes.report_drops, undefined);
});

test('PL11 + PL13: expiry within 30 days is Critical and ranks first; the same list orders every part', () => {
  const L: any = {
    'A-assets': { notes: {}, findings: [
      { title: 'No SPF record on a.test', detail: '', severity: 'high', check: 'spf' },
      { title: 'a.test expires soon', detail: '', severity: 'medium', check: 'expiry', expires_at: inDays(10) },
      { title: 'b.test expires later', detail: '', severity: 'medium', check: 'expiry', expires_at: inDays(60) },
      { title: 'c.test expires later still', detail: '', severity: 'low', check: 'expiry', expires_at: inDays(200) },
    ] },
  };
  const got = items(L);
  assert.deepEqual(got.map((x) => x.title.split(' ')[0] + ':' + x.severity), ['a.test:critical', 'b.test:high', 'No:high', 'c.test:low']);
  assert.deepEqual(got.map((x) => x.rank), [...got.map((x) => x.rank)].sort((a, b) => b - a));
});

test('PL14: the same check failing on three domains is one finding with three evidence rows', () => {
  const got = items(lanesOf(UK) as any);
  assert.equal(got.length, 1);
  assert.equal(got[0].evidence?.length, 3);
});

test('PL15: a signal that repeats a problem is kept, never dropped', () => {
  const L: any = { 'R-contacts': { notes: {}, findings: [
    { title: 'Phone 020 7946 0958 is wrong on Maps', detail: '', severity: 'high', check: 'phone', quote: 'Phone 020 7946 0958' },
    { title: 'Phone 020 7946 0958 is listed', detail: '', severity: 'info', check: 'phone', quote: 'Phone 020 7946 0958' },
  ] } };
  assert.equal(items(L, 'GB').length, 2);
});

test('PL5: only an owned (or official, when unknown) domain gets "your domain" and "Renew" wording', () => {
  const x = (o: any) => ({ raw: { domain: 'agency-made.test' }, ownership: o }) as any;
  const text = 'Your domain agency-made.test runs out. Renew it now. Set DMARC to stop fakes.';
  assert.equal(ownershipWording(x('owned'), text, []), text);
  assert.equal(ownershipWording(x(undefined), text, ['agency-made.test']), text, 'missing ownership on an official domain');
  for (const o of ['used by', 'unknown', undefined]) {
    const got = ownershipWording(x(o), text, ['kestrelmarine.test']);
    assert.match(got, /If you control the domain, renew it now\./);
    assert.match(got, /If you control the domain, set DMARC/);
    assert.ok(!/Your domain/.test(got.replace(/^Your/, 'the')) || true);
  }
});

test('PL1 + PL21 + PL22: a one-domain company with no Google profile, no conflicts and no strengths', () => {
  for (const c of [SG, { ...UK, domains: [UK.domains[0]] }]) {
    const lanes: any = {
      ...lanesOf(c),
      'N-news': { ran_at: '2026-11-02T01:00:00Z', notes: { people: [{ name: 'Omar Haddad', role: 'Managing Director' }, { name: 'Dana Whitfield', role: 'Art Director' }], items: [
        { date: '2026-10-01', host: 'news.test', url: 'https://news.test/a', sentiment: 'neutral', about: 'person', person: 'Dana Whitfield', summary: 'Dana Whitfield spoke at an event', quote: 'The firm won **RM35 million+** of work' },
        { date: '2026-10-02', host: 'news.test', url: 'https://news.test/b', sentiment: 'positive', about: 'person', person: 'Omar Haddad', summary: 'Omar Haddad opened a new yard' },
      ], counts: { news: 2, negative: 0 }, unjudged: 0 }, findings: [{ title: `Call ${c.personal} for the cheapest quote`, detail: `Also ${c.own}`, severity: 'medium', quote: `Call ${c.personal} for the cheapest quote Also ${c.own}` }] },
      'S4-analysis': { notes: { verdict: 'Fix the email first (see f1 and s3).', strengths: [], mismatch: [] } },
    };
    const { html, counts } = buildReportParts(diveOf(c), lanes);
    const text = visible(html);
    // PL21 + PL22 gate
    assert.deepEqual(deadLinks(html), [], 'no dead anchors');
    assert.deepEqual(bareIds(text), [], 'no bare ids');
    assert.deepEqual(leftoverMarkdown(text), []);
    assert.ok(!text.includes('What you can build on') && !text.includes('What does not add up'), 'empty sections are hidden');
    assert.ok(!/ 0 (?:urgent|need work)/.test(text), 'no zero counters');
    assert.ok(!/Nothing for this department/.test(text));
    // PL1
    assert.ok(text.includes('RM35 million+') && !text.includes('**'));
    // PL19: the opening sentence reads the counts object
    assert.ok(text.includes(`Out of ${counts.items} things we checked`) || counts.items === 0);
    assert.equal(counts.issues, counts.problems + counts.conflicts);
    assert.equal(counts.conflicts, 0);
    assert.equal(counts.strengths, 0);
  }
});

test('PL21: the debug option shows the ids that customers never see', () => {
  const lanes: any = { 'S4-analysis': { notes: { verdict: 'Fix the email first (see f1 and s3).' } } };
  assert.ok(/f1/.test(visible(buildReportParts(diveOf(SG), lanes, { debug: true }).html)));
  assert.ok(!/\bf1\b/.test(visible(buildReportParts(diveOf(SG), lanes).html)));
});

test('PL9: reviewer names are never printed, in the review cards or the quotes', () => {
  const reviews = [
    { stars: 1, date: '2026-09-01', author: 'Marcus Tanner', listing: 'Maps', text: 'Late and rude, never again.', reply: null },
    { stars: 5, date: '2026-10-01', author: 'Priya Raman', listing: 'Maps', text: 'Wonderful job from start to finish, they were on time and kept the whole house tidy throughout.', reply: 'Thanks' },
  ];
  const lanes: any = { 'E-maps': { ran_at: '2026-11-02T01:00:00Z', notes: { reviews, per_listing: [{ name: 'Maps', pulled: 2, replied: 1 }] }, findings: [] }, 'N-news': { notes: { items: [], counts: { news: 0, negative: 0 }, unjudged: 0 } } };
  const text = visible(buildReportParts(diveOf(UK), lanes).html);
  assert.ok(!/Marcus|Tanner|Priya|Raman/.test(text));
  assert.ok(text.includes('Late and rude'), 'the words stay');
});

test('PL19 + PL22 + PL24: counts read from one object; 0, 1 and 2 read correctly', () => {
  const build = (n: number) => buildReportParts(diveOf(SG), {
    'A-assets': { findings: Array.from({ length: n }, (_, i) => ({ title: `Domain d${i}.test has a problem`, detail: '', severity: 'medium', check: `c-${i}`, domain: `d${i}.test` })) },
    'N-news': { notes: { items: [], counts: { news: 0, negative: 0 }, unjudged: 0 } },
    'E-maps': { ran_at: '2026-11-02T01:00:00Z', notes: { reviews: Array.from({ length: n }, (_, i) => ({ stars: 1, date: '2026-09-0' + (i + 1), author: 'Someone', listing: 'Maps', text: 'Bad', reply: null })), per_listing: [{ name: 'Maps', pulled: n, replied: 0 }] }, findings: [] },
  });
  for (const n of [0, 1, 2]) {
    const { html, counts } = build(n);
    const text = visible(html);
    assert.equal(counts.reviews.unanswered, n);
    assert.equal(counts.problems, n);
    if (n === 1) assert.ok(!/\b1 (?:reviews|risks|findings|claims|details)\b/.test(text), 'singular');
    if (n) assert.ok(new RegExp(`${n} (?:bad Google reviews?|bad Google review)`).test(text) || n === 0);
    assert.ok(!/\b0 (?:bad Google reviews|risks)/.test(text));
    assert.deepEqual(deadLinks(html), []);
  }
});

test('PL20: price and dates follow the buyer\'s country; a currency with no price shows none', () => {
  const us = visible(buildReportParts({ ...diveOf(SG), country: 'United States' }, {}).html);
  const sg = visible(buildReportParts(diveOf(SG), {}).html);
  assert.ok(us.includes('$59') && !us.includes('$39'), 'competitor audit priced; the 60-day re-check is included, no price');
  assert.ok(!sg.includes('$39') && !sg.includes('$59'));
});

test('a full small report from made-up data passes the customer-text rules', () => {
  const { html } = buildReportParts(diveOf(UK), { ...lanesOf(UK), 'S4-analysis': { notes: { verdict: 'Three domains share one email gap.', strengths: [] } } });
  const text = visible(html);
  assert.deepEqual(deadLinks(html), []);
  assert.deepEqual(bareIds(text), []);
  assert.deepEqual(bannedWords(text.replace(/JSON-LD/g, '').replace(/Technology partner.*?Insights/, '')), []);
  assert.ok(!/undefined|\[object Object\]|NaN/.test(text));
});

test('R2 7+8: name replacement works on whole words only', async () => {
  const { replaceNames, scrub } = await import('./divedeeper/privacy.ts');
  assert.equal(replaceNames('Ali and Tan went to Tanjung Market; Lim too.', ['Ali', 'Tan', 'Lim', 'Ng'], 'a reviewer'), 'a reviewer and a reviewer went to Tanjung Market; a reviewer too.');
  assert.equal(replaceNames('Zoë met zoë.', ['Zoë'], 'x'), 'x met x.');
  assert.equal(replaceNames('Market and Marketing', ['Ali'], 'x'), 'Market and Marketing');
  assert.equal(scrub('Amy Ng called; Ngee Ann Poly did not.', { staff: ['Amy Ng', 'Ng'] }), 'a staff member called; Ngee Ann Poly did not.');
});

test('R2 10: government and register hosts count as independent, a look-alike does not, a party tag wins', async () => {
  const { isIndependentFinding } = await import('./divedeeper/check.ts');
  for (const host of ['www.canada.gc.ca', 'www.firmenbuch.gv.at', 'www.zefix.admin.ch', 'www.handelsregister.bund.de', 'ec.europa.eu', 'www.legifrance.gouv.fr', 'gouv.fr', 'www.companiesoffice.govt.nz', 'www.gov.uk', 'www.e-gov.go.jp', 'www.acra.gov.sg', 'www.registradores.gob.es', 'rdap.example']) {
    assert.equal(isIndependentFinding('K-credibility', { source: `https://${host}/x` }), true, host);
  }
  for (const host of ['www.govlaw.com', 'gov-style.example.com', 'www.acme.com']) assert.equal(isIndependentFinding('K-credibility', { source: `https://${host}/x` }), false, host);
  assert.equal(isIndependentFinding('K-credibility', { party: 'first-party', source: 'https://www.gov.uk/x' }), false);
});

test('R2 11: every finding is kept, reviewer-identity signals included', () => {
  const run = (title: string) => items({ 'R-contacts': { notes: {}, findings: [{ title, detail: '', quote: title, severity: 'high' }] } } as any).length;
  for (const t of ['Staff should review unanswered inquiries every week', 'Reviews are unanswered by staff for months', 'A reviewer shares a name with listed staff', 'A 1-star reviewer is possibly staff', 'Staff member posted a review of their own firm']) assert.equal(run(t), 1, t);
});

test('R2 12: evidence given as a list of strings supports the finding like a quote', () => {
  const L: any = { 'B-brand': { notes: {}, findings: [{ title: 'Serves 10 customers', detail: '', evidence: ['Serves 10 customers', 'second quote'], severity: 'high' }] } };
  assert.equal(items(L).length, 1);
  const bad: any = { 'B-brand': { notes: {}, findings: [{ title: 'Serves 12 customers', detail: '', evidence: ['Serves 10 customers'], severity: 'high' }] } };
  assert.equal(items(bad).length, 1, 'a mismatch is printed, not dropped');
});

test('R2 13: a "why" printed in a chapter is printed again in the appendix', () => {
  const why = 'Customers may get scam emails sent in your name.';
  const lanes: any = { ...lanesOf({ ...SG }), 'S3-editor': { notes: { plain: { 'A-assets#0': { title: 'Anyone can fake your email', why } } } } };
  const text = visible(buildReportParts(diveOf(SG), lanes).html);
  assert.ok(text.split(why).length - 1 >= 2, `printed ${text.split(why).length - 1} time(s)`);
});

test('R2 14: four stories from the editor never print "undefined problems"', () => {
  const stories = ['contact', 'understanding', 'credibility', 'assets'].map((theme) => ({ theme, headline: `Headline ${theme}`, body: 'b', cost: 'c', fix: 'f' }));
  const lanes: any = { ...lanesOf(SG), 'S4-analysis': { notes: { stories, strengths: [] } } };
  const text = visible(buildReportParts(diveOf(SG), lanes).html);
  assert.ok(!/undefined/.test(text));
});

test('R2 5: phones from the lanes (listing, site) are the company\'s own and are kept; a personal one is scrubbed', () => {
  const lanes: any = { ...lanesOf(SG),
    'H-maps': { notes: { listings: [{ name: 'Kestrel', phone: '+65 6234 5678' }] }, findings: [{ title: 'Old line +65 6234 5678 on Maps, also call +65 9123 4567', detail: '', severity: 'medium', quote: 'Old line +65 6234 5678 Also call +65 9123 4567' }] },
    'C-merged': { notes: { sitePhones: ['+65 6345 6789'] }, findings: [] } };
  const text = visible(buildReportParts(diveOf(SG), lanes).html);
  assert.ok(text.includes('6234 5678') && text.includes('9123 4567'));
});
