// Lane L2 (report checklist PL1-PL15): Step 2 findings and tidy. No LLM: checkV2 / tidyCheckpoint / renderTidy with fake
// data. Companies and countries here are made up and mixed on purpose; no rule may depend on one of them.
import test from 'node:test';
import assert from 'node:assert/strict';
import { checkV2, claimMismatches, citableV2 } from './v21/step2-v2.ts';
import { cleanText, ownershipOf, renderTidy, stripMarkdown, tidyCheckpoint, type TidyData } from './v21/tidy.ts';

const tidy: TidyData = {
  version: '2.1',
  stage: 1.5,
  input: { company: 'Nordlys Bygg AS', country: 'Norway', industry: 'Construction' },
  official: {
    domain: 'nordlys.example',
    site_wide: 'Nordlys Bygg AS · post@nordlys.example',
    pages: [{ label: 'home', url: 'https://nordlys.example', text: 'Phone +47 22 33 44 55\nOffice: Storgata 1, Oslo', cut_chars: 0 }],
    other_own_pages: [],
  },
  own_linkedin: null,
  domains: [
    { domain: 'nordlys.example', role: 'official site', registrant: 'Nordlys Bygg AS', ownership: 'owned' },
    { domain: 'nordlys-agency.example', role: 'candidate tried', registrant: 'Fjord Web Studio', ownership: 'used_by' },
    { domain: 'nordlys-old.example', role: 'candidate tried', registrant: null, ownership: 'unknown' },
  ],
  evidence: [
    { id: 'E1', kind: 'search', source_name: 'Domain Security & Assets', url: 'https://nordlys.example', title: 'spoof 1', text: '[HIGH] Domain nordlys.example is vulnerable to email spoofing (DMARC p=none).', check_id: 'email-spoofing', domain: 'nordlys.example' },
    { id: 'E2', kind: 'search', source_name: 'Domain Security & Assets', url: 'https://nordlys-agency.example', title: 'spoof 2', text: '[HIGH] Domain nordlys-agency.example is vulnerable to email spoofing (DMARC p=none).', check_id: 'email-spoofing', domain: 'nordlys-agency.example' },
    { id: 'E3', kind: 'search', source_name: 'Domain Security & Assets', url: 'https://nordlys-old.example', title: 'spoof 3', text: '[HIGH] Domain nordlys-old.example is vulnerable to email spoofing (DMARC p=none).', check_id: 'email-spoofing', domain: 'nordlys-old.example' },
    { id: 'E4', kind: 'search', source_name: 'bygg-awards.example', url: 'https://bygg-awards.example/entry/12', title: 'Entry', text: 'Entry submitted by Nordlys Bygg AS: best small builder 2025.' },
    { id: 'E5', kind: 'search', source_name: 'brreg.example', url: 'https://brreg.example/nordlys', title: 'Register', text: 'Nordlys Bygg AS, org no 912345678, registered 2011-05-02.' },
    { id: 'E6', kind: 'google_maps', source_name: 'Google Maps', url: 'https://maps.example/n', text: 'Name: Nordlys Bygg AS | Phone: +47 22 33 44 99 | Address: Storgata 1, Oslo' },
    { id: 'E7', kind: 'search', source_name: 'Domain Security & Assets', url: 'https://nordlys.example', title: 'expiry', text: '[CRITICAL] Domain nordlys.example expires in 26 days.', check_id: 'domain-expiry', domain: 'nordlys.example' },
  ],
  registers: [],
  could_not_check: [],
};

const spoof = (id: string, ev: string) => ({ id, kind: 'problem', topic: 'email', title: `Email can be forged (${ev})`, statement: 'DMARC is not enforced', evidence: [{ evidence_id: ev, quoted_text: 'is vulnerable to email spoofing' }] });

// ---------------------------------------------------------------- PL1

test('PL1: markdown marks go without moving words or losing symbols', () => {
  assert.equal(stripMarkdown('35**RM million+** in projects'), '35RM million+ in projects');
  assert.equal(stripMarkdown('turnover **NOK 12 million**'), 'turnover NOK 12 million');
  assert.equal(stripMarkdown('## Awards\n__Best builder__ 2025 and #1 in Oslo'), 'Awards\nBest builder 2025 and #1 in Oslo');
  assert.ok(!/[*#_]{2}/.test(cleanText('<p>**$5 million+** and ### Heading</p>')));
  assert.match(cleanText('**$5 million+** sales'), /\$5 million\+/);
});

// ---------------------------------------------------------------- PL2

test('PL2: every evidence row carries a party; official-domain sources are first-party whatever the analyst said', () => {
  const f = {
    kind: 'problem', topic: 'email', title: 'Forgeable email',
    evidence: [
      { evidence_id: 'E1', quoted_text: 'is vulnerable to email spoofing', party: 'independent' }, // official domain: code says first
      { evidence_id: 'E4', quoted_text: 'Entry submitted by Nordlys Bygg AS', party: 'first' }, // analyst: written by the company
      { evidence_id: 'E5', quoted_text: 'org no 912345678' }, // nothing said: independent
      { evidence_id: 'O1', quoted_text: 'Phone +47 22 33 44 55', party: 'independent' }, // own page: first
    ],
  };
  const out = checkV2({ conclusive_findings: [f] }, tidy);
  assert.equal(out.rejected.length, 0, JSON.stringify(out.rejected));
  const parties = Object.fromEntries(out.conclusive_findings[0].evidence.map((e) => [e.evidence_id, e.party]));
  assert.deepEqual(parties, { E1: 'first', E4: 'first', E5: 'independent', O1: 'first' });
  for (const e of out.conclusive_findings[0].evidence) assert.ok(e.party === 'first' || e.party === 'independent');
});

test('PL2: contradiction versions and notes carry party too', () => {
  const c = { topic: 'contact', title: 'Two phones', versions: [
    { source: 'site', value: '+47 22 33 44 55', evidence_id: 'O1', quoted_text: 'Phone +47 22 33 44 55' },
    { source: 'Maps', value: '+47 22 33 44 99', evidence_id: 'E6', quoted_text: 'Phone: +47 22 33 44 99' },
  ] };
  const out = checkV2({ contradictions: [c] }, tidy);
  assert.deepEqual(out.contradictions[0].versions.map((v) => v.party), ['first', 'independent']);
});

// ---------------------------------------------------------------- PL3 / PL5

test('PL3: ownership comes from the registrant: owned, used_by, unknown', () => {
  assert.equal(ownershipOf('Nordlys Bygg AS', 'Nordlys Bygg AS'), 'owned');
  assert.equal(ownershipOf('NORDLYS BYGG', 'Nordlys Bygg AS'), 'owned');
  assert.equal(ownershipOf('Fjord Web Studio', 'Nordlys Bygg AS'), 'used_by');
  assert.equal(ownershipOf(null, 'Nordlys Bygg AS'), 'unknown');
  assert.equal(ownershipOf('  ', 'Nordlys Bygg AS'), 'unknown');
  // another country and another suffix style
  assert.equal(ownershipOf('Sunrise Logistics Pty Ltd', 'Sunrise Logistics Pty. Ltd.'), 'owned');
});

test('PL3/PL5: every domain finding has an ownership value, and the prompt shows it; the registrant is not shown', () => {
  const out = checkV2({ conclusive_findings: [spoof('a', 'E1'), { ...spoof('b', 'E2'), topic: 'website', evidence: [{ evidence_id: 'E2', quoted_text: 'nordlys-agency.example is vulnerable' }], title: 'Agency domain forgeable' }, { ...spoof('c', 'E3'), topic: 'identity', title: 'Old domain forgeable', evidence: [{ evidence_id: 'E3', quoted_text: 'nordlys-old.example is vulnerable' }] }] }, tidy);
  // three domains, one check: merged (PL14) and mixed ownership is the cautious value
  assert.equal(out.conclusive_findings.length, 1);
  assert.equal(out.conclusive_findings[0].ownership, 'unknown');
  const owned = checkV2({ conclusive_findings: [spoof('a', 'E1')] }, tidy);
  assert.equal(owned.conclusive_findings[0].ownership, 'owned');
  const used = checkV2({ conclusive_findings: [{ ...spoof('b', 'E2'), evidence: [{ evidence_id: 'E2', quoted_text: 'nordlys-agency.example is vulnerable' }] }] }, tidy);
  assert.equal(used.conclusive_findings[0].ownership, 'used_by');
  const text = renderTidy(tidy, { officialIds: true });
  assert.match(text, /domain: nordlys-agency\.example \(ownership: used_by\)/);
  assert.match(text, /domain: nordlys-old\.example \(ownership: unknown\)/);
  assert.ok(!text.includes('Fjord Web Studio'), 'registrant names stay out of the prompt');
});

test('PL3: tidyCheckpoint takes the registrant from the audited domains and sets check_id and domain on audit items', () => {
  const cp: any = { input: { company: 'Nordlys Bygg AS', country: 'Norway', industry: 'Construction' }, official_site: { domain: 'nordlys.example', pages: [] }, third_party_discoveries: [], probes: [] };
  const assets: any = {
    domains: [
      { domain: 'nordlys.example', role: 'official site', registration: { org: 'Nordlys Bygg AS' } },
      { domain: 'other.example', role: 'candidate tried', registration: { org: null } },
    ],
    findings: [{ id: 'asset_1', title: 'Domain nordlys.example expires in 26 days', detail: 'x', severity: 'critical', check: 'domain-expiry', domain: 'nordlys.example' }],
    pagespeed: { status: 'none' },
  };
  const t = tidyCheckpoint(cp, assets);
  assert.deepEqual(t.domains?.map((d) => [d.domain, d.ownership]), [['nordlys.example', 'owned'], ['other.example', 'unknown']]);
  assert.equal(t.evidence[0].check_id, 'domain-expiry');
  assert.equal(t.evidence[0].domain, 'nordlys.example');
});

// ---------------------------------------------------------------- PL6

test('PL6: "independent" or "third-party" with only first-party evidence is rejected', () => {
  const s = { kind: 'strength', topic: 'awards', title: 'Independent award body confirms best builder', statement: 'Third-party confirmation', evidence: [{ evidence_id: 'E4', quoted_text: 'Entry submitted by Nordlys Bygg AS', party: 'first' }] };
  const bad = checkV2({ conclusive_findings: [s] }, tidy);
  assert.equal(bad.conclusive_findings.length, 0);
  assert.match(bad.rejected[0].reasons.join(), /independent \/ third-party/);
  const good = checkV2({ conclusive_findings: [{ ...s, title: 'Independent register lists the company', statement: 'Third-party record', evidence: [{ evidence_id: 'E5', quoted_text: 'registered 2011-05-02' }] }] }, tidy);
  assert.equal(good.rejected.length, 0, JSON.stringify(good.rejected));
  // the same words without the claim are fine
  const plain = checkV2({ conclusive_findings: [{ ...s, title: 'Won best small builder', statement: 'Award entry exists', evidence: s.evidence }] }, tidy);
  assert.equal(plain.rejected.length, 0, JSON.stringify(plain.rejected));
});

// ---------------------------------------------------------------- PL4

test('PL4: a number, date, email, phone or URL in the text that no cited quote has blocks the item', () => {
  assert.deepEqual(claimMismatches('Registered 2011-05-02, org no 912345678', ['Nordlys Bygg AS, org no 912345678, registered 2011-05-02.']), []);
  assert.deepEqual(claimMismatches('Phone +47 22 33 44 99', ['Phone +47 22 33 44 55']), ['99']);
  assert.deepEqual(claimMismatches('Write to hello@nordlys.example', ['post@nordlys.example']), ['hello@nordlys.example']);
  assert.deepEqual(claimMismatches('See https://www.nordlys.example/about', ['visit nordlys.example/about']), []);
  assert.deepEqual(claimMismatches('See nordlys-shop.example', ['visit nordlys.example']), ['nordlys-shop.example']);
  const mismatch = { kind: 'problem', topic: 'contact', title: 'Phone wrong on Maps', statement: 'Maps shows +47 22 33 44 77', evidence: [{ evidence_id: 'E6', quoted_text: 'Phone: +47 22 33 44 99' }] };
  const out = checkV2({ conclusive_findings: [mismatch], take_note: [{ topic: 'registration', title: 'Founded in 2012', note: 'x', evidence: [{ evidence_id: 'E5', quoted_text: 'registered 2011-05-02' }] }] }, tidy);
  assert.equal(out.conclusive_findings.length, 0);
  assert.equal(out.take_note.length, 0);
  assert.match(out.rejected[0].reasons.join(), /not in any cited quote: 77/);
  assert.match(out.rejected[1].reasons.join(), /not in any cited quote: 2012/);
  const ok = checkV2({ conclusive_findings: [{ ...mismatch, statement: 'Maps shows +47 22 33 44 99' }] }, tidy);
  assert.equal(ok.rejected.length, 0, JSON.stringify(ok.rejected));
});

test('PL4+PL11: an expiry date as quoted passes; a computed "in N days" is rejected (writer must not derive figures)', () => {
  const quotes = ['Registry expiry date: 2026-12-05'];
  assert.deepEqual(claimMismatches('The domain expires on 2026-12-05', quotes), []);
  assert.deepEqual(claimMismatches('The domain expires in 26 days', quotes), ['26']);
});

// ---------------------------------------------------------------- PL9 / PL10

test('PL9: the review lines given to the LLM have no author name and read "1 review" / "2 reviews"', () => {
  const cp: any = { input: tidy.input, official_site: { domain: 'nordlys.example', pages: [] }, third_party_discoveries: [], probes: [] };
  const assets: any = {
    domains: [], findings: [], pagespeed: { status: 'none' },
    google_reviews: { status: 'done', profile: { name: 'Nordlys', place_id: 'p1' }, data: { name: 'Nordlys', review_count: 2, rating: 3, reviews: [
      { date: '2026-10-01T00:00:00Z', rating: 1, author: 'Kari Nordmann', author_reviews: 1, text: 'Bad', owner_reply: null },
      { date: '2026-09-01T00:00:00Z', rating: 5, author: 'Ola Hansen', author_reviews: 2, text: 'Good', owner_reply: null },
    ] } },
  };
  const t = tidyCheckpoint(cp, assets);
  const text = t.evidence.find((e) => e.source_name === 'Google Maps reviews')!.text;
  assert.ok(!/Kari|Nordmann|Ola|Hansen/.test(text), text);
  assert.match(text, /reviewer has written 1 review \|/);
  assert.match(text, /reviewer has written 2 reviews \|/);
  assert.ok(!/1 reviews/.test(text));
});

test('PL10: identity-signal notes are dropped with the flag off, kept and paid-only with it on', () => {
  const note = { topic: 'reviews', title: 'A reviewer shares a name with listed staff', note: 'Possible staff review', identity_signal: true, evidence: [{ evidence_id: 'E5', quoted_text: 'registered 2011-05-02' }] };
  const plain = { topic: 'registration', title: 'Registered 2011', note: 'Date only on register', evidence: [{ evidence_id: 'E5', quoted_text: 'registered 2011-05-02' }] };
  delete process.env.REPORT_IDENTITY_SIGNALS;
  const off = checkV2({ take_note: [note, plain] }, tidy);
  assert.equal(off.take_note.length, 1);
  assert.equal(off.take_note[0].identity_signal, false);
  assert.match(off.rejected[0].reasons.join(), /identity signal dropped/);
  process.env.REPORT_IDENTITY_SIGNALS = 'on';
  try {
    const on = checkV2({ take_note: [note, plain] }, tidy);
    assert.equal(on.take_note.length, 2);
    assert.equal(on.take_note[0].paid_only, true);
    assert.equal(on.take_note[1].paid_only, undefined);
  } finally {
    delete process.env.REPORT_IDENTITY_SIGNALS;
  }
});

// ---------------------------------------------------------------- PL12

test('PL12: every item type has a topic; a suggestion takes the topics of what it is based on', () => {
  const f = { id: 'f1', kind: 'problem', topic: 'email', title: 'Forgeable', evidence: [{ evidence_id: 'E1', quoted_text: 'is vulnerable to email spoofing' }] };
  const c = { id: 'c1', topic: 'contact', title: 'Two phones', versions: [
    { source: 'site', value: '+47 22 33 44 55', evidence_id: 'O1', quoted_text: 'Phone +47 22 33 44 55' },
    { source: 'Maps', value: '+47 22 33 44 99', evidence_id: 'E6', quoted_text: 'Phone: +47 22 33 44 99' },
  ] };
  const n = { id: 'n1', topic: 'bogus', title: 'Note', note: 'x', evidence: [{ evidence_id: 'E5', quoted_text: 'org no 912345678' }] };
  const out = checkV2({ conclusive_findings: [f], contradictions: [c], take_note: [n], suggestions: [{ action: 'Fix both', based_on: ['f1', 'c1'] }, { action: 'Fix mail', based_on: ['f1'] }] }, tidy);
  assert.equal(out.conclusive_findings[0].topic, 'email');
  assert.equal(out.contradictions[0].topic, 'contact');
  assert.equal(out.take_note[0].topic, 'other');
  assert.deepEqual(out.suggestions[0].topics, ['email', 'contact']);
  assert.equal(out.suggestions[0].topic, 'email');
  assert.deepEqual(out.suggestions[1].topics, ['email']);
});

// ---------------------------------------------------------------- PL14

test('PL14: the same failed check on 3 domains is one finding with 3 evidence rows; suggestions follow', () => {
  const three = [
    spoof('f1', 'E1'),
    { ...spoof('f2', 'E2'), evidence: [{ evidence_id: 'E2', quoted_text: 'nordlys-agency.example is vulnerable' }] },
    { ...spoof('f3', 'E3'), evidence: [{ evidence_id: 'E3', quoted_text: 'nordlys-old.example is vulnerable' }] },
    { id: 'f4', kind: 'problem', topic: 'website', title: 'Domain expires', evidence: [{ evidence_id: 'E7', quoted_text: 'expires in 26 days' }] },
  ];
  const out = checkV2({ conclusive_findings: three, suggestions: [{ action: 'Set DMARC on all', based_on: ['f2', 'f3'] }, { action: 'Renew', based_on: ['f4'] }] }, tidy);
  assert.equal(out.rejected.length, 0, JSON.stringify(out.rejected));
  assert.equal(out.conclusive_findings.length, 2);
  const merged = out.conclusive_findings[0];
  assert.equal(merged.id, 'f1');
  assert.equal(merged.check_id, 'email-spoofing');
  assert.deepEqual(merged.evidence.map((e) => e.evidence_id), ['E1', 'E2', 'E3']);
  assert.deepEqual(out.suggestions[0].based_on, ['f1']);
  assert.deepEqual(out.suggestions[1].based_on, ['f2']);
  assert.equal(out.conclusive_findings[1].check_id, 'domain-expiry');
});

test('PL14: different kinds of the same check are not merged', () => {
  const a = spoof('f1', 'E1');
  const b = { ...spoof('f2', 'E2'), kind: 'strength', evidence: [{ evidence_id: 'E2', quoted_text: 'nordlys-agency.example is vulnerable' }] };
  // a strength resting on a first-party audit row is allowed here; the point is the kind keeps them apart
  const out = checkV2({ conclusive_findings: [a, b] }, tidy);
  assert.equal(out.conclusive_findings.length, 2);
});

// ---------------------------------------------------------------- PL15

test('PL15: one fact lives in one list: problem > contradiction > note', () => {
  const c = { id: 'c1', topic: 'contact', title: 'Two phones', versions: [
    { source: 'site', value: '+47 22 33 44 55', evidence_id: 'O1', quoted_text: 'Phone +47 22 33 44 55' },
    { source: 'Maps', value: '+47 22 33 44 99', evidence_id: 'E6', quoted_text: 'Phone: +47 22 33 44 99' },
  ] };
  const notePhone = { id: 'n1', topic: 'contact', title: 'Maps phone', note: 'Maps lists +47 22 33 44 99', evidence: [{ evidence_id: 'E6', quoted_text: 'Phone: +47 22 33 44 99' }] };
  const noteOther = { id: 'n2', topic: 'registration', title: 'Org no', note: 'org no 912345678', evidence: [{ evidence_id: 'E5', quoted_text: 'org no 912345678' }] };
  const out = checkV2({ contradictions: [c], take_note: [notePhone, noteOther], suggestions: [{ action: 'Align phones', based_on: ['c1'] }] }, tidy);
  assert.equal(out.contradictions.length, 1);
  assert.deepEqual(out.take_note.map((n) => n.title), ['Org no']);
  assert.equal(out.take_note[0].id, 'n1');
  assert.match(out.rejected.map((r) => r.reasons.join()).join(), /already in c1/);
  assert.deepEqual(out.suggestions[0].based_on, ['c1']);
});

test('PL15: a problem beats a contradiction that repeats it; a contradiction with an extra version stays', () => {
  const problem = { id: 'f1', kind: 'problem', topic: 'contact', title: 'Maps phone differs', statement: 'Maps shows +47 22 33 44 99', evidence: [{ evidence_id: 'E6', quoted_text: 'Phone: +47 22 33 44 99' }] };
  const onlyThat = { id: 'c1', topic: 'contact', title: 'Maps phone', versions: [
    { source: 'Maps', value: '+47 22 33 44 99', evidence_id: 'E6', quoted_text: 'Phone: +47 22 33 44 99' },
    { source: 'Maps again', value: '0047 22 33 44 99', evidence_id: 'E6', quoted_text: 'Phone: +47 22 33 44 99' },
  ] };
  const two = { id: 'c2', topic: 'contact', title: 'Two phones', versions: [
    { source: 'site', value: '+47 22 33 44 55', evidence_id: 'O1', quoted_text: 'Phone +47 22 33 44 55' },
    { source: 'Maps', value: '+47 22 33 44 99', evidence_id: 'E6', quoted_text: 'Phone: +47 22 33 44 99' },
  ] };
  // `onlyThat` only repeats the problem's fact (the same number written two ways); `two` has a value the problem does not cover
  const out = checkV2({ conclusive_findings: [problem], contradictions: [onlyThat, two] }, tidy);
  assert.equal(out.contradictions.length, 1);
  assert.equal(out.contradictions[0].title, 'Two phones');
});

test('PL15: the same value in a different field is not a repeat', () => {
  const problem = { id: 'f1', kind: 'problem', topic: 'email', title: 'Forgeable', statement: 'on nordlys.example', evidence: [{ evidence_id: 'E1', quoted_text: 'is vulnerable to email spoofing' }] };
  const note = { id: 'n1', topic: 'website', title: 'Site mentions nordlys.example', note: 'nordlys.example appears', evidence: [{ evidence_id: 'E7', quoted_text: 'Domain nordlys.example expires' }] };
  const out = checkV2({ conclusive_findings: [problem], take_note: [note] }, tidy);
  assert.equal(out.take_note.length, 1);
});

// ---------------------------------------------------------------- R1 review fixes

test('R1: citableV2 gives check_id and domain to audit items and never throws on the others', () => {
  const items = citableV2(tidy);
  assert.equal(items.get('E1')?.check_id, 'email-spoofing');
  assert.equal(items.get('E1')?.domain, 'nordlys.example');
  assert.equal(items.get('E4')?.check_id, undefined);
});

test("R1: the company's own domain in two unrelated items does not make them one fact (PL15)", () => {
  const finding = { id: 'f1', kind: 'problem', topic: 'website', title: 'Slow on phones', statement: 'Mobile speed on nordlys.example is low', evidence: [{ evidence_id: 'E7', quoted_text: 'Domain nordlys.example expires in 26 days' }] };
  const note = { id: 'n1', topic: 'website', title: 'Outdated plugin', note: 'A plugin on nordlys.example looks old', evidence: [{ evidence_id: 'E7', quoted_text: 'Domain nordlys.example expires' }] };
  const out = checkV2({ conclusive_findings: [finding], take_note: [note] }, tidy);
  assert.equal(out.conclusive_findings.length, 1, JSON.stringify(out.rejected));
  assert.equal(out.take_note.length, 1, JSON.stringify(out.rejected));
});

test('R1: a quote of the review count line is found (title line leads the text)', () => {
  const cp: any = { input: tidy.input, official_site: { domain: 'nordlys.example', pages: [] }, third_party_discoveries: [], probes: [] };
  const assets: any = { domains: [], findings: [], pagespeed: { status: 'none' }, google_reviews: { status: 'done', profile: { name: 'Nordlys', place_id: 'p1' }, data: { name: 'Nordlys', review_count: 40, rating: 4.2, reviews: [{ date: '2026-10-01T00:00:00Z', rating: 5, author: 'A', author_reviews: 1, text: 'Good', owner_reply: null }] } } };
  const t = tidyCheckpoint(cp, assets);
  const id = t.evidence.find((e) => e.source_name === 'Google Maps reviews')!.id;
  const f = { kind: 'problem', topic: 'reviews', title: 'Reviews', statement: 'Of the 1 newest reviews shown, none got a reply', evidence: [{ evidence_id: id, quoted_text: '1 newest reviews of 40' }] };
  const out = checkV2({ conclusive_findings: [f] }, t);
  assert.equal(out.rejected.length, 0, JSON.stringify(out.rejected));
});

test('R1: merged findings name the other domains in the statement, and claimCheck stays valid', () => {
  const three = [
    spoof('f1', 'E1'),
    { ...spoof('f2', 'E2'), evidence: [{ evidence_id: 'E2', quoted_text: 'nordlys-agency.example is vulnerable' }] },
    { ...spoof('f3', 'E3'), evidence: [{ evidence_id: 'E3', quoted_text: 'nordlys-old.example is vulnerable' }] },
  ];
  const out = checkV2({ conclusive_findings: three }, tidy);
  assert.equal(out.conclusive_findings.length, 1);
  assert.match(out.conclusive_findings[0].statement, /The same applies to nordlys-agency\.example and nordlys-old\.example\.$/);
  assert.deepEqual(claimMismatches(out.conclusive_findings[0].statement, out.conclusive_findings[0].evidence.map((e) => e.quoted_text)), []);
  // one domain only: nothing is added
  assert.equal(checkV2({ conclusive_findings: [spoof('f1', 'E1')] }, tidy).conclusive_findings[0].statement, 'DMARC is not enforced');
});

test('R1: a short name matches a whole word of the registrant, not a part of one', () => {
  assert.equal(ownershipOf('HP Inc.', 'HP'), 'owned');
  assert.equal(ownershipOf('3M Company', '3M'), 'owned');
  assert.equal(ownershipOf('SAP SE', 'SAP SE'), 'owned');
  assert.equal(ownershipOf('LG Electronics Inc.', 'LG Electronics'), 'owned');
  assert.equal(ownershipOf('비바리퍼블리카(토스)', '토스'), 'owned');
  assert.equal(ownershipOf('Chiptech Ltd', 'HP'), 'used_by');
  assert.equal(ownershipOf('Hpe Holdings', 'HP'), 'used_by');
});

test('R1: stripMarkdown keeps the spacing of bold after a digit unless the bold starts with a currency', () => {
  assert.equal(stripMarkdown('Over 10**years** of experience'), 'Over 10 years of experience');
  assert.equal(stripMarkdown('35**RM million+** in projects'), '35RM million+ in projects');
  assert.equal(stripMarkdown('turnover 5**$ million+** a year'), 'turnover 5$ million+ a year');
});
