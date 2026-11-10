// Free report page rules (docs/preview-writing-plan.md, 2026-11-10): the page proves problems exist and keeps the answers
// for the full report. Strengths (top 3) and ONE proof item in full; every other finding a value-free title by business
// area; every section has a missing / good-news version. Fixtures use made-up companies in different countries.
import test from 'node:test';
import assert from 'node:assert/strict';
import { bareIds, deadLinks } from './report-rules/index.ts';
import { FREE_N, rate, reportPage } from './v21/step3.ts';

const NOW = new Date('2026-11-09T00:00:00Z');
const inDays = (n: number) => new Date(NOW.getTime() + n * 86400000).toISOString().slice(0, 10);

const ev = (id: string) => [{ evidence_id: `E-${id}`, quoted_text: `QUOTE-${id}`, source_url: `https://register.example/${id}` }];
const finding = (id: string, kind: string, topic: string, extra: Record<string, unknown> = {}): any => ({
  id, kind, topic, title: `TITLE-${id}`, statement: `STATEMENT-${id}`, evidence: ev(id), why_it_matters: `WHY-${id}`, identity: 'x', confidence: 'high', ...extra,
});
const contra = (id: string, topic: string, extra: Record<string, unknown> = {}): any => ({
  id, topic, title: `TITLE-${id}`, why_it_matters: `WHY-${id}`, identity: 'x', confidence: 'high',
  versions: [{ source: 'Site', value: `A-${id}`, ...ev(`${id}a`)[0] }, { source: 'Directory', value: `B-${id}`, ...ev(`${id}b`)[0] }], ...extra,
});
const note = (id: string, topic: string, extra: Record<string, unknown> = {}): any => ({ id, topic, title: `TITLE-${id}`, note: `NOTE-${id}`, evidence: ev(id), why_not_conclusive: `NOTWHY-${id}`, ...extra });
const make = (country: string, lists: Record<string, any[]>): any => ({
  input: { company: 'Beispiel GmbH', country, industry: 'Solar' }, baseline: { websites: [] },
  conclusive_findings: [], contradictions: [], take_note: [], suggestions: [], ...lists,
});
const report = (extra: Record<string, unknown> = {}, language = 'en'): any => ({ language, created_at: '2026-11-08T00:00:00Z', summary: [], ...extra });
const text = (html: string) => html.replace(/<style[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ' ');

const big = () => make('Malaysia', {
  conclusive_findings: [finding('f1', 'problem', 'registration'), finding('f2', 'problem', 'website'), finding('f3', 'problem', 'email'), finding('f4', 'problem', 'contact', { statement: 'phone disconnected' }),
    finding('s1', 'strength', 'licence'), finding('s2', 'strength', 'other'), finding('s3', 'strength', 'reviews'), finding('s4', 'strength', 'awards')],
  contradictions: [contra('c1', 'awards'), contra('c2', 'website'), contra('c3', 'contact')],
  take_note: [note('n1', 'registration'), note('n2', 'reviews')],
  suggestions: [{ id: 'g1', action: 'DO-1', why: 'w', based_on: ['f1'] }],
});

test('expiry at 10, 29, 31 and 90 days sets the urgency; expires_at beats dates in the text', () => {
  const u = (days: number) => rate({ topic: 'other', confidence: 'high' }, [`The domain renews on ${inDays(days)}.`], NOW).urg;
  assert.equal(u(10), 'critical');
  assert.equal(u(29), 'critical');
  assert.equal(u(31), 'high');
  assert.equal(u(90), 'high');
  assert.equal(u(200), 'low');
  assert.equal(rate({ topic: 'other', confidence: 'high', expires_at: inDays(5) }, ['no date in the text'], NOW).urg, 'critical');
  assert.equal(rate({ topic: 'other', confidence: 'high', expires_at: inDays(-3) }, ['x'], NOW).urg, 'critical');
});

test('one proof item in full: the LLM pick when valid, else rank #1; only its first piece of evidence', () => {
  assert.deepEqual(FREE_N, { strengths: 3, proof: 1 });
  const s2 = make('Germany', {
    conclusive_findings: [finding('f1', 'problem', 'email', { statement: 'No DMARC record', evidence: [...ev('f1'), ...ev('f1x')] }), finding('f2', 'problem', 'website', { statement: `Domain expires ${inDays(26)}` }), finding('f3', 'problem', 'scale')],
    contradictions: [contra('c1', 'other')],
  });
  const picked = reportPage(report({ proof: 'f1' }), s2, { now: NOW });
  assert.deepEqual([...picked.matchAll(/<article class="warn [^"]*\bfirst\b[^"]*" id="([^"]+)"/g)].map((m) => m[1]), ['f1']);
  assert.ok(picked.includes('No DMARC record') && picked.includes('register.example/f1"') && !picked.includes('QUOTE-f1x'));
  // Nothing of any other problem or contradiction is in the HTML: no title, statement, why, quote, value or source link.
  for (const id of ['f2', 'f3', 'c1']) for (const x of [`TITLE-${id}`, `STATEMENT-${id}`, `WHY-${id}`, `QUOTE-${id}`, `A-${id}`, `register.example/${id}`]) assert.ok(!picked.includes(x), x);
  // An unknown or missing pick falls back to rank #1 (the domain lapsing in 26 days).
  for (const proof of ['zz9', undefined, 42]) {
    const html = reportPage(report({ proof }), s2, { now: NOW });
    assert.deepEqual([...html.matchAll(/<article class="warn [^"]*\bfirst\b[^"]*" id="([^"]+)"/g)].map((m) => m[1]), ['f2'], String(proof));
  }
  // A contradiction picked as proof shows its versions with their sources.
  const c = reportPage(report({ proof: 'c1' }), s2, { now: NOW });
  assert.ok(c.includes('A-c1') && c.includes('B-c1') && c.includes('register.example/c1a'));
});

test('every other finding is a title only, grouped by business area, with a level badge; LLM titles else a teaser', () => {
  const html = reportPage(report({ proof: 'f1', titles: { f2: 'Customers may land on a page that does not load.', c3: 'Your phone differs across 2 sources.' } }), big(), { now: NOW });
  const t = text(html);
  assert.match(t, /Customers may land on a page that does not load\./);
  assert.match(t, /Your phone differs across 2 sources\./);
  // No LLM title -> the teaser: kind of record plus a hint, never the Step 2 title.
  assert.match(t, /Email: issue 1/);
  for (const id of ['f2', 'f3', 'f4', 'c1', 'c2', 'c3', 'n1', 'n2']) {
    assert.match(html, new RegExp(`<li id="${id}" title="${id}" data-id="${id}"><span class="urg (urgent|important|minor)"`), id);
    for (const x of [`TITLE-${id}`, `STATEMENT-${id}`, `NOTE-${id}`, `QUOTE-${id}`, `A-${id}`, `register.example/${id}`]) assert.ok(!html.includes(x), x);
  }
  // Areas in CEO order; the action steps are not on the page.
  const order = [...t.matchAll(/(Getting found|Getting reached|Credibility with banks and tenders|Reputation|Risks to your company name|Other) · \d+/g)].map((m) => m[1]);
  assert.deepEqual(order, ['Getting found', 'Getting reached', 'Credibility with banks and tenders', 'Reputation', 'Risks to your company name']);
  assert.ok(!html.includes('DO-1') && !html.includes('id="suggestions"'));
  assert.deepEqual(deadLinks(html), []);
});

test('teaser titles are unique on the page and use the check id when there is one', () => {
  const s2 = make('France', { conclusive_findings: [1, 2, 3, 4, 5, 6, 7].map((n) => finding(`f${n}`, 'problem', 'website', n === 6 ? { check_id: 'privacy_page' } : {})) });
  const html = reportPage(report({ proof: 'f1' }), s2, { now: NOW });
  const titles = [...html.matchAll(/<span class="rt">([^<]*)<\/span>/g)].map((m) => m[1]);
  assert.equal(titles.length, 6);
  assert.equal(new Set(titles).size, 6);
  assert.ok(titles.every((x) => x.startsWith('Website: ')));
  assert.ok(titles.includes('Website: privacy page'));
});

test('strengths: the top 3 in full with sources, the rest as a count; none -> a plain line, never a missing section', () => {
  const html = reportPage(report(), big(), { now: NOW });
  assert.equal(['s1', 's2', 's3', 's4'].filter((id) => html.includes(`TITLE-${id}`)).length, 3);
  assert.match(text(html), /1 more strength confirmed, listed in the full report\./);
  const none = reportPage(report(), make('Brazil', { conclusive_findings: [finding('f1', 'problem', 'website')] }), { now: NOW });
  assert.match(none, /<section id="strengths"/);
  assert.match(text(none), /found no outside source confirming a strength yet/);
});

test('every number on the page reads from one counts object', () => {
  // problems 4, contradictions 3, notes 2, strengths 4 => issues 7, findings 9, items 13; record issues f1 + c1 = 2.
  const html = reportPage(report({ proof: 'f1' }), big(), { now: NOW, price: '$59' });
  const t = text(html);
  assert.match(t, /People who look up Beispiel GmbH run into 7 problems\./);
  assert.match(t, /Action required\. We found 4 problems and 3 places where sources disagree; \d+ (is|are) Urgent/);
  assert.match(t, /13 items found/);
  assert.match(t, /7 issues found/);
  assert.match(t, /2 records that banks and tender panels check have problems or differ between sources\./);
  assert.match(t, /4 problems someone looking you up runs into\. Your details differ between sources in 3 places\. 2 signals worth checking\./);
  assert.match(t, /The evidence for all 9 findings/);
  assert.match(t, /Starts from at least 9 findings in this free report/);
  // 4 problem + 4 strength + 2 note sources, 6 contradiction versions = 16 distinct pages.
  assert.match(t, /read the 16 public pages behind this report/);
  assert.match(t, /from 16 public sources/);
  const strip = html.match(/<div class="strip">[\s\S]*?<\/div>/)![0];
  assert.deepEqual([...strip.matchAll(/<b[^>]*>(\d+)<\/b>/g)].map((m) => +m[1]), [4, 4, 3, 2]);
  const counts = JSON.parse(html.match(/data-counts="([^"]*)"/)![1].replace(/&quot;/g, '"'));
  assert.equal(counts.findings, 9); assert.equal(counts['shown.listed'], 8); assert.equal(counts['shown.proof'], 1);
});

test('no bare ids in customer text; ids live only in title / data-id; debug mode shows them', () => {
  const html = reportPage(report({ proof: 'f1', summary: [{ text: 'Summary line.', cites: ['f1', 's1', 'c1'] }] }), big(), { now: NOW });
  assert.deepEqual(bareIds(text(html).replace(/\b[A-Z]+-\w+|register\.example\/\w+/g, ' ')), []);
  assert.match(html, /<a class="cite" href="#f1" title="f1" data-id="f1">Problem \d<\/a>/);
  assert.match(html, /<a class="cite" href="#c1" title="c1" data-id="c1">Source disagreement \d<\/a>/);
  assert.deepEqual(deadLinks(html), []);
  const debug = reportPage(report({ proof: 'f1', summary: [{ text: 'Summary line.', cites: ['f1'] }] }), big(), { now: NOW, debug: true });
  assert.match(text(debug), /Problem \d \(f1\)/);
});

test('a summary cite to an item not on the page (4th strength) is printed but not linked', () => {
  const html = reportPage(report({ summary: [{ text: 'LINE-S4', cites: ['s4'] }] }), big(), { now: NOW });
  assert.ok(html.includes('LINE-S4') && !html.includes('href="#s4"'));
  assert.deepEqual(deadLinks(html), []);
});

test('one buy target with price and guarantee; no "may uncover more", "not run yet" or action plan, in en and ko', () => {
  const s2 = make('Malaysia', { conclusive_findings: [finding('f1', 'problem', 'website'), finding('f2', 'problem', 'contact')] });
  for (const lang of ['en', 'ko']) {
    const html = reportPage(report({}, lang), s2, { now: NOW, price: '$59' });
    assert.equal((html.match(/id="order"/g) ?? []).length, 1);
    assert.ok([...html.matchAll(/<a [^>]*href="#order"/g)].length >= 4, lang);
    assert.deepEqual(deadLinks(html), []);
    assert.ok(!/class="runs?"/.test(html) && !/Not run yet|not run yet|아직 진행 전|uncover more|7 research areas|7개 조사 영역|\?<\/b>/.test(html), lang);
    assert.match(html, /<section id="inside"[\s\S]*<div class="ask" id="order">[\s\S]*\$59[\s\S]*class="guar"[\s\S]*<\/section>/);
  }
  assert.match(text(reportPage(report(), s2, { now: NOW })), /fewer than 10 findings that are not in this free report, we refund you in full/);
});

test('good news: no problems gives the calm headline, stake and Q3, no exec box or sticky bar; Q1 says not checked', () => {
  const s2 = make('Thailand', { conclusive_findings: [finding('s1', 'strength', 'registration')] });
  const html = reportPage(report(), s2, { now: NOW });
  const t = text(html);
  assert.match(t, /What strangers see about Beispiel GmbH mostly checks out\./);
  assert.match(t, /This free report found no problem\./);
  assert.match(t, /The sources we read tell one consistent story about you\./);
  assert.match(t, /1 record that banks and tender panels check is confirmed by an outside source\./);
  assert.match(t, /did not ask AI assistants or search Google Maps/);
  assert.ok(!html.includes('<div class="sticky">') && !html.includes('class="exec"') && !html.includes('id="proof"') && !html.includes('id="areas"'));
  assert.deepEqual(deadLinks(html), []);
  // Nothing at all: still every section, with its missing wording.
  const empty = reportPage(report(), make('Thailand', {}), { now: NOW });
  for (const id of ['questions', 'strengths', 'not', 'inside']) assert.match(empty, new RegExp(`<section id="${id}"`), id);
  assert.match(text(empty), /found no registration, licence or award record to test/);
});

test('price is one USD value for every country, and dates follow the report country', () => {
  const page = (country: string, price?: string) => reportPage(report(), make(country, { conclusive_findings: [finding('f1', 'problem', 'website')] }), { now: NOW, price });
  for (const c of ['Malaysia', 'Germany', 'Thailand']) assert.match(page(c, '$59'), /<p class="price" data-price>\$59<\/p>/, c);
  const none = page('Thailand');
  assert.ok(!none.includes('class="price"') && !none.includes('class="pr"') && !/\$\d|RM\d/.test(text(none)));
  assert.match(text(page('Germany', '$59')), /8 (Nov|Nov\.|November) 2026/);
});

test('counts 0, 1 and 2 read correctly through the plural helper', () => {
  const page = (p: number, c: number, n: number) => text(reportPage(report(), make('Malaysia', {
    conclusive_findings: Array.from({ length: p }, (_, i) => finding(`f${i + 1}`, 'problem', 'registration')),
    contradictions: Array.from({ length: c }, (_, i) => contra(`c${i + 1}`, 'registration')),
    take_note: Array.from({ length: n }, (_, i) => note(`n${i + 1}`, 'reviews')),
  }), { now: NOW }));
  const one = page(1, 1, 1);
  assert.match(page(1, 0, 0), /1 issue found/);
  assert.match(page(1, 0, 0), /run into 1 problem\./);
  assert.match(one, /We found 1 problem and 1 place where sources disagree/);
  assert.match(one, /2 issues found/);
  assert.match(one, /3 items found/);
  assert.ok(!/\b1 (problems|issues|items|places|findings|signals|records)\b/.test(one));
  const zero = page(0, 0, 1);
  assert.ok(!/issues? found/.test(zero) && !zero.includes('Action required'));
  assert.ok(!/\b0 (problems|issues|items|places|findings)\b/.test(zero));
  assert.match(zero, /1 item found/);
});

test('the same id is never printed twice; junk titles, proof and versions never throw', () => {
  const s2 = make('Malaysia', {
    conclusive_findings: [finding('f1', 'problem', 'website'), finding('f2', 'problem', 'reviews', { paid_only: true }), finding('f1', 'problem', 'website', { title: 'DUPLICATE-F1' }), null],
    contradictions: [contra('c1', 'registration', { identity_signal: true, versions: undefined })],
    take_note: [note('n1', 'reviews', { identity_signal: true })],
  });
  for (const r of [report({ titles: null, proof: { id: 'f1' } }), report({ titles: 'junk', summary: null }), report({ titles: { c1: 42 }, created_at: 'not a date' })]) {
    const html = reportPage(r, s2, { now: NOW });
    assert.ok(!html.includes('DUPLICATE-F1'));
    for (const id of ['f1', 'f2', 'c1', 'n1']) assert.equal((html.match(new RegExp(`\\sid="${id}"`, 'g')) ?? []).length, 1, id);
    assert.deepEqual(deadLinks(html), []);
  }
});

test('items with missing text fields (no why_it_matters, no title) still render', () => {
  const s2 = make('Malaysia', {
    conclusive_findings: [{ id: 'f1', kind: 'problem', topic: 'registration', evidence: null }, { id: 's1', kind: 'strength', topic: 'licence' }],
    contradictions: [{ id: 'c1', topic: 'awards', versions: [null, { value: 5 }] }],
    take_note: [{ id: 'n1' }],
  });
  for (const proof of ['f1', 'c1']) {
    const html = reportPage(report({ proof, summary: [{ text: 'L', cites: ['f1', 's1', 'c1'] }] }), s2, { now: NOW });
    assert.ok(html.endsWith("</html>"));
    assert.deepEqual(deadLinks(html), []);
  }
});

test('Korean page: same numbers, no dead links', () => {
  const s2 = make('South Korea', { conclusive_findings: [finding('f1', 'problem', 'registration'), finding('f2', 'problem', 'website')], contradictions: [contra('c1', 'registration')] });
  const html = reportPage(report({}, 'ko'), s2, { now: NOW });
  assert.deepEqual(deadLinks(html), []);
  assert.match(text(html), /3건 발견/);
  assert.match(text(html), /문제점 2개와 출처마다 다른 정보 1건/);
  assert.match(text(html), /문제 3개를 마주칩니다/);
  assert.ok(!html.includes('TITLE-f2') && !html.includes('class="price"'));
});
