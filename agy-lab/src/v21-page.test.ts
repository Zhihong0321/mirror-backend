// Free preview page rules (owner template 2026-11-10, docs/preview-writing-plan.md): the page proves problems exist and keeps the answers
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

test('one proof item in full: the LLM pick when valid, else rank #1; its first piece of evidence and its fix', () => {
  assert.deepEqual(FREE_N, { strengths: 3, proof: 1 });
  const s2 = make('Germany', {
    conclusive_findings: [finding('f1', 'problem', 'email', { statement: 'No DMARC record', evidence: [...ev('f1'), ...ev('f1x')] }), finding('f2', 'problem', 'website', { statement: `Domain expires ${inDays(26)}` }), finding('f3', 'problem', 'scale')],
    contradictions: [contra('c1', 'other')],
    suggestions: [{ id: 'g1', action: 'FIX-F1', why: 'w', based_on: ['f1'] }, { id: 'g2', action: 'FIX-F3', why: 'w', based_on: ['f3'] }],
  });
  const proofOf = (html: string) => [...html.matchAll(/<div class="proof" id="([^"]+)"/g)].map((m) => m[1]);
  const picked = reportPage(report({ proof: 'f1' }), s2, { now: NOW });
  assert.deepEqual(proofOf(picked), ['f1']);
  assert.ok(picked.includes('No DMARC record') && picked.includes('register.example/f1"') && picked.includes('QUOTE-f1') && !picked.includes('QUOTE-f1x'));
  assert.ok(picked.includes('FIX-F1') && !picked.includes('FIX-F3'));
  // Nothing of any other problem or contradiction is in the HTML: no title, statement, why, quote, value or source link.
  for (const id of ['f2', 'f3', 'c1']) for (const x of [`TITLE-${id}`, `STATEMENT-${id}`, `WHY-${id}`, `QUOTE-${id}`, `A-${id}`, `register.example/${id}`]) assert.ok(!picked.includes(x), x);
  // An unknown or missing pick falls back to rank #1 (the domain lapsing in 26 days).
  for (const proof of ['zz9', undefined, 42]) assert.deepEqual(proofOf(reportPage(report({ proof }), s2, { now: NOW })), ['f2'], String(proof));
  // A contradiction picked as proof shows its versions with their sources.
  const c = reportPage(report({ proof: 'c1' }), s2, { now: NOW });
  assert.ok(c.includes('A-c1') && c.includes('B-c1') && c.includes('register.example/c1a'));
});

test('every finding is listed by area with its mark; titles from the LLM else a teaser; the proof row links up', () => {
  const html = reportPage(report({ proof: 'f1', titles: { f2: 'Customers may land on a page that does not load.', c3: 'Your phone differs across 2 sources.' } }), big(), { now: NOW });
  const t = text(html);
  assert.match(t, /Customers may land on a page that does not load\./);
  assert.match(t, /Your phone differs across 2 sources\./);
  assert.match(t, /Email: issue 1/);
  for (const id of ['f2', 'f3', 'f4', 'c1', 'c2', 'c3', 'n1', 'n2']) {
    assert.match(html, new RegExp(`<li id="${id}" title="${id}" data-id="${id}"><span><span class="tag (first|conf|check)">`), id);
    for (const x of [`TITLE-${id}`, `STATEMENT-${id}`, `NOTE-${id}`, `QUOTE-${id}`, `A-${id}`, `register.example/${id}`]) assert.ok(!html.includes(x), x);
  }
  assert.match(html, /<a href="#proof">Shown in full above<\/a>/);
  // Signals are "To check"; the scorecard has one mark per finding (9) and one open mark for the proof.
  assert.equal((html.match(/<span class="tag check">To check<\/span>/g) ?? []).length, 2);
  const card = html.match(/<aside class="card"[\s\S]*?<\/aside>/)![0];
  assert.equal((card.match(/<div class="dots">[\s\S]*?<\/div>/g) ?? []).join('').match(/<i class="dot/g)!.length, 9);
  assert.equal((card.match(/<i class="dot o">/g) ?? []).length, 2); // the proof mark + its key
  const order = [...html.matchAll(/<div class="group" id="a-(\w+)">/g)].map((m) => m[1]);
  assert.deepEqual(order, ['found', 'reached', 'credibility', 'reputation', 'name']);
  assert.deepEqual(deadLinks(html), []);
});

test('teaser titles are unique on the page and use the check id when there is one', () => {
  const s2 = make('France', { conclusive_findings: [1, 2, 3, 4, 5, 6, 7].map((n) => finding(`f${n}`, 'problem', 'website', n === 6 ? { check_id: 'privacy_page' } : {})) });
  const html = reportPage(report({ proof: 'f1' }), s2, { now: NOW });
  const titles = [...html.matchAll(/<li id="f\d"[^>]*><span>[\s\S]*?<\/span><span class="t">([^<]*)<\/span>/g)].map((m) => m[1]);
  assert.equal(titles.length, 6);
  assert.equal(new Set(titles).size, 6);
  assert.ok(titles.every((x) => x.startsWith('Website: ')));
  assert.ok(titles.includes('Website: privacy page'));
});

test('strengths: the top 3 in full with sources, the rest as a count; none -> a plain line, never a missing section', () => {
  const html = reportPage(report(), big(), { now: NOW });
  assert.equal(['s1', 's2', 's3', 's4'].filter((id) => html.includes(`TITLE-${id}`)).length, 3);
  assert.match(text(html), /1 more strength is confirmed and listed in the full report\./);
  const none = reportPage(report(), make('Brazil', { conclusive_findings: [finding('f1', 'problem', 'website')] }), { now: NOW });
  assert.match(none, /<section class="sec band" id="strengths"/);
  assert.match(text(none), /found no outside source confirming a strength yet/);
});

test('every number on the page reads from one counts object', () => {
  // problems 4, contradictions 3, notes 2, strengths 4 => issues 7, findings 9; record issues f1 + c1 = 2, record strengths s1 + s4 = 2.
  const html = reportPage(report({ proof: 'f1' }), big(), { now: NOW, price: '$59' });
  const t = text(html);
  assert.match(t, /People who look up Beispiel GmbH run into at least 9 things you would want changed\./);
  assert.match(t, /7 are confirmed by public sources\. 2 are signals we could not confirm\. One is shown in full/);
  assert.match(t, /Where the 9 found so far sit/);
  assert.match(t, /1 shown in full · 8 by what they cost you/);
  assert.match(t, /7 confirmed problems\. In 3 of them, public sources state different facts/);
  assert.match(t, /2 records confirmed by an outside source\. 2 records that banks and tender panels check have problems/);
  assert.match(t, /The 9 findings from this free check/);
  assert.match(t, /8 of these have three things missing here/);
  assert.match(t, /The other 8 findings were found the same way/);
  // 4 problem + 4 strength + 2 note sources, 6 contradiction versions = 16 distinct pages; 16×10 + 8×15 + 180 = 460 min.
  assert.match(t, /16 × 10 min/);
  assert.match(t, /8 × 15 min/);
  assert.match(t, /7½ h/);
  assert.match(t, /from 16 public sources/);
  const counts = JSON.parse(html.match(/data-counts="([^"]*)"/)![1].replace(/&quot;/g, '"'));
  assert.equal(counts.findings, 9); assert.equal(counts['shown.listed'], 8); assert.equal(counts['shown.proof'], 1);
});

test('no bare ids in customer text; ids live only in id / title / data-id; debug mode shows them', () => {
  const html = reportPage(report({ proof: 'f1' }), big(), { now: NOW });
  assert.deepEqual(bareIds(text(html).replace(/\b[A-Z]+-\w+|register\.example\/\w+/g, ' ')), []);
  assert.deepEqual(deadLinks(html), []);
  const debug = reportPage(report({ proof: 'f1' }), big(), { now: NOW, debug: true });
  assert.match(text(debug), /\(f1\)/);
  assert.match(text(debug), /\(c2\)/);
});

test('one buy target with price, guarantee and the order line; every buy link points to it', () => {
  const s2 = make('Malaysia', { conclusive_findings: [finding('f1', 'problem', 'website'), finding('f2', 'problem', 'contact')] });
  const html = reportPage(report(), s2, { now: NOW, price: '$59', ref: '1ED41496' });
  assert.equal((html.match(/id="order"/g) ?? []).length, 1);
  assert.ok([...html.matchAll(/<a [^>]*href="#order"/g)].length >= 3);
  assert.deepEqual(deadLinks(html), []);
  assert.ok(!/uncover more|7 research areas/.test(html));
  assert.match(html, /<div class="ask" id="order"><div class="price"><b data-price>\$59<\/b>/);
  assert.match(text(html), /YES, run the full report for Beispiel GmbH\. Ref 1ED41496\./);
  assert.match(text(html), /fewer than 10 problems beyond this page, each with a public source, we refund the full price/);
  assert.ok(!/findings that are not in this preview/.test(html));
  assert.match(text(html), /1ED41496 · free preview/);
  // No ref: the order line still reads right.
  assert.match(text(reportPage(report(), s2, { now: NOW })), /YES, run the full report for Beispiel GmbH\.\s/);
});

test('closing note: list price, 72-hour price and date; proof line only with a proof; none on a page with no findings', () => {
  const s2 = make('Malaysia', { conclusive_findings: [finding('f1', 'problem', 'website')] });
  const t = text(reportPage(report(), s2, { now: NOW, price: '$59' }));
  assert.match(t, /Is it worth the risk to save \$59\?/);
  assert.match(t, /The full report costs \$120\. Order by 11 Nov 2026 and it costs \$59, with a full refund/);
  assert.match(t, /One is shown in full above/);
  assert.match(t, /Which competitors do AI assistants recommend instead of me in my area\?/);
  // No price: no dollar figure anywhere.
  const noPrice = text(reportPage(report(), s2, { now: NOW }));
  assert.match(noPrice, /save the price of this report\?/);
  assert.ok(!/\$\d/.test(noPrice));
  // Signals only: no proof, so no "shown in full" claim.
  const notesOnly = text(reportPage(report(), make('Malaysia', { take_note: [note('n1', 'reviews')] }), { now: NOW, price: '$59' }));
  assert.match(notesOnly, /What this page proves/);
  assert.ok(!/One is shown in full above/.test(notesOnly));
  const good = reportPage(report(), make('Malaysia', { conclusive_findings: [finding('s1', 'strength', 'registration')] }), { now: NOW, price: '$59' });
  assert.ok(!good.includes('id="closing"'));
});

test('good news: no findings gives the calm headline and Q3, no proof or list; every other section still there', () => {
  const s2 = make('Thailand', { conclusive_findings: [finding('s1', 'strength', 'registration')] });
  const html = reportPage(report(), s2, { now: NOW });
  const t = text(html);
  assert.match(t, /What strangers see about Beispiel GmbH mostly checks out\./);
  assert.match(t, /The sources we read tell one consistent story about you\./);
  assert.match(t, /1 record confirmed by an outside source\./);
  assert.match(t, /We did not test it, so we make no claim here/);
  assert.ok(!html.includes('id="proof"') && !html.includes('id="findings"'));
  assert.deepEqual(deadLinks(html), []);
  const empty = reportPage(report(), make('Thailand', {}), { now: NOW });
  for (const id of ['questions', 'strengths', 'not', 'offer']) assert.match(empty, new RegExp(`id="${id}"`), id);
  assert.match(text(empty), /found no registration, licence or award record to test/);
  assert.deepEqual(deadLinks(empty), []);
});

test('the first deadline ahead shows in the hero and links to the proof when it is the proof', () => {
  const s2 = make('Malaysia', { conclusive_findings: [finding('f1', 'problem', 'website', { statement: `Domain expires ${inDays(26)}` }), finding('f2', 'problem', 'scale')] });
  const html = reportPage(report({ proof: 'f1' }), s2, { now: NOW });
  assert.match(html, /<a class="deadline" href="#proof">[\s\S]*5 Dec 2026/);
  assert.match(text(html), /It is the finding we show in full/);
  const none = reportPage(report(), make('Malaysia', { conclusive_findings: [finding('f2', 'problem', 'scale')] }), { now: NOW });
  assert.ok(!none.includes('class="deadline"'));
});

test('price is one USD value for every country, and dates follow the report country', () => {
  const page = (country: string, price?: string) => reportPage(report(), make(country, { conclusive_findings: [finding('f1', 'problem', 'website')] }), { now: NOW, price });
  for (const c of ['Malaysia', 'Germany', 'Thailand']) assert.match(page(c, '$59'), /<b data-price>\$59<\/b>/, c);
  const none = page('Thailand');
  assert.ok(!none.includes('data-price') && !/\$\d|RM\d/.test(text(none)));
  assert.match(text(page('Germany', '$59')), /8 (Nov|Nov\.|November) 2026/);
});

test('counts 0, 1 and 2 read correctly through the plural helper', () => {
  const page = (p: number, c: number, n: number) => text(reportPage(report(), make('Malaysia', {
    conclusive_findings: Array.from({ length: p }, (_, i) => finding(`f${i + 1}`, 'problem', 'registration')),
    contradictions: Array.from({ length: c }, (_, i) => contra(`c${i + 1}`, 'registration')),
    take_note: Array.from({ length: n }, (_, i) => note(`n${i + 1}`, 'reviews')),
  }), { now: NOW }));
  assert.match(page(1, 0, 0), /run into at least 1 thing you would want changed\./);
  assert.match(page(1, 0, 0), /1 is confirmed by public sources\./);
  const one = page(1, 1, 1);
  assert.match(one, /run into at least 3 things/);
  assert.match(one, /1 is a signal we could not confirm/);
  assert.match(page(1, 0, 1), /1 of these has three things missing here/);
  assert.ok(!/\b1 (problems|things|findings|signals|records|strengths)\b/.test(one));
  assert.ok(!/\b0 (problems|things|findings|signals|records)\b/.test(page(0, 0, 1)));
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
    const html = reportPage(report({ proof }), s2, { now: NOW });
    assert.ok(html.endsWith('</html>'));
    assert.deepEqual(deadLinks(html), []);
  }
});

test('a Korean report still renders with its numbers and no dead links', () => {
  const s2 = make('South Korea', { conclusive_findings: [finding('f1', 'problem', 'registration'), finding('f2', 'problem', 'website')], contradictions: [contra('c1', 'registration')] });
  const html = reportPage(report({}, 'ko'), s2, { now: NOW });
  assert.deepEqual(deadLinks(html), []);
  assert.match(html, /<html lang="ko">/);
  assert.ok(!html.includes('TITLE-f2') && !html.includes('data-price'));
});
