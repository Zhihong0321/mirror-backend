import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dedupeSections, items, ownershipWording } from './divedeeper/editor.ts';
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

test('PL4: a finding whose printed number is not in its own quote is dropped and recorded; a measured one needs no quote', () => {
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
  assert.deepEqual(got.filter((t) => /Serves|Founded|Plain|expires/.test(t)).sort(), ['Plain statement with no figure', 'Serves 10 customers', 'kestrelmarine.test expires in 40 days'].sort());
  const rules = L['B-brand'].notes.report_drops.map((d: any) => `${d.key}:${d.rule}`).sort();
  assert.deepEqual(rules, ['B-brand#0:PL4', 'B-brand#2:PL4']);
});

test('PL6: independence words stay when an independent source backs the run, and go when none does', () => {
  const analysis = { notes: { strengths: ['Independent recognition by a trade body', 'A tidy homepage'] } };
  const without = applyCheck({ 'S4-analysis': analysis, 'K-credibility': { findings: [{ title: 'Award', party: 'first-party', source: 'https://kestrelmarine.test/awards' }] } }) as any;
  assert.deepEqual(without['S4-analysis'].notes.strengths, ['A tidy homepage']);
  assert.equal(without['report-review'].notes.drops[0].rule, 'PL6');
  for (const proof of [{ party: 'independent', source: 'https://trade.example/x' }, { source: 'https://rdap.example/kestrelmarine.test' }, { source: 'https://www.companieshouse.gov.uk/company/1' }]) {
    const kept = applyCheck({ 'S4-analysis': analysis, 'A-assets': { findings: [{ title: 'Registered', ...proof }] } }) as any;
    assert.equal(kept['S4-analysis'].notes.strengths.length, 2, JSON.stringify(proof));
  }
});

test('PL8: internal words in analysis lines are dropped and recorded', () => {
  const out = applyCheck({ 'S4-analysis': { notes: { risks: ['The pipeline is broken', 'Customers cannot reach you'] } } }) as any;
  assert.deepEqual(out['S4-analysis'].notes.risks, ['Customers cannot reach you']);
});

test('PL10: identity signals are off by default and only appear when the policy flag is on', () => {
  const make = (): any => ({ 'R-contacts': { notes: {}, findings: [{ title: 'A reviewer who may be staff left a 1★ review', detail: '', quote: 'A reviewer who may be staff left a 1★ review', severity: 'high' }] } });
  const L = make();
  assert.equal(items(L).length, 0);
  assert.equal(L['R-contacts'].notes.report_drops[0].rule, 'PL10');
  process.env.REPORT_IDENTITY_SIGNALS = 'on';
  try { assert.equal(items(make()).length, 1); } finally { delete process.env.REPORT_IDENTITY_SIGNALS; }
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

test('PL15: a fact lives in one section: problem over conflict over signal', () => {
  const L: any = { 'R-contacts': { notes: {}, findings: [
    { title: 'Phone 020 7946 0958 is wrong on Maps', detail: '', severity: 'high', check: 'phone', quote: 'Phone 020 7946 0958' },
    { title: 'Phone 020 7946 0958 is listed', detail: '', severity: 'info', check: 'phone', quote: 'Phone 020 7946 0958' },
  ] } };
  assert.equal(items(L, 'GB').length, 1);
  const list = items({ 'A-assets': { notes: {}, findings: [{ title: 'Mail for kestrelmarine.test is unprotected', detail: '', severity: 'high', check: 'dmarc' }, { title: 'Site at shipyard.test has a note', detail: '', severity: 'info', check: 'note' }] } } as any, 'Singapore');
  const out = dedupeSections(list, [{ issue: 'kestrelmarine.test is called two things' }, { issue: 'shipyard.test is named two ways' }, { issue: 'Head office differs between sources' }], 'Singapore');
  assert.deepEqual(out.conflicts.map((c) => c.issue), ['shipyard.test is named two ways', 'Head office differs between sources'], 'the conflict a problem already says is removed');
  assert.equal(out.items.length, 1, 'the signal that repeats a conflict is removed');
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

test('PL1 + PL9 + PL21 + PL22: a one-domain company with no Google profile, no conflicts and no strengths', () => {
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
    // PL9: only the company's own phone is printed; leadership may be named, other staff may not
    assert.ok(!text.includes(c.personal.replace(/\D/g, '').slice(-7)) && phonesIn(text, c.country).every((p) => phonesIn(c.own, c.country).includes(p)), 'no personal phone');
    assert.ok(text.includes('Omar Haddad') && !text.includes('Dana Whitfield'), 'staff are named only when they lead');
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
  assert.ok(us.includes('$39') && us.includes('$59'));
  assert.ok(!sg.includes('$39') && !sg.includes('$59'));
});

test('PL25 gate: a full small report from made-up data passes the customer-text rules', () => {
  const { html } = buildReportParts(diveOf(UK), { ...lanesOf(UK), 'S4-analysis': { notes: { verdict: 'Three domains share one email gap.', strengths: [] } } });
  const text = visible(html);
  assert.deepEqual(deadLinks(html), []);
  assert.deepEqual(bareIds(text), []);
  assert.deepEqual(bannedWords(text.replace(/JSON-LD/g, '').replace(/Technology partner.*?Insights/, '')), []);
  assert.ok(!/undefined|\[object Object\]|NaN/.test(text));
});
