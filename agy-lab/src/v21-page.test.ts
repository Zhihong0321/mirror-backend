// Free report page rules (PL11-PL13, PL16-PL24): ranking and headline, one gate, one counts object, no bare ids,
// no dead links, one buy target, plurals. Fixtures use made-up companies in different countries.
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
const report = (summary: any[] = [], language = 'en'): any => ({ language, created_at: '2026-11-08T00:00:00Z', summary });
const text = (html: string) => html.replace(/<style[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ' ');

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

test('the headline card and "Highest urgency" are rank #1 of problems and contradictions together', () => {
  // The domain lapsing in 26 days outranks DMARC (Critical by wording) listed first, and a contradiction outranks a Medium problem.
  const s2 = make('Germany', {
    conclusive_findings: [finding('f1', 'problem', 'email', { statement: 'No DMARC record' }), finding('f2', 'problem', 'website', { statement: `Domain expires ${inDays(26)}` }), finding('f3', 'problem', 'scale')],
    contradictions: [contra('c1', 'other')],
  });
  const html = reportPage(report(), s2, { now: NOW });
  const firsts = [...html.matchAll(/<article class="warn [^"]*\bfirst\b[^"]*" id="([^"]+)"/g)].map((m) => m[1]);
  const order = [...html.matchAll(/<article class="warn [^"]*" id="(f\d|c\d)"/g)].map((m) => m[1]);
  assert.equal(firsts.length, 1);
  assert.equal(firsts[0], 'f2');
  assert.deepEqual(order.filter((i) => i.startsWith('f')), ['f2', 'f1', 'f3']);
  // A contradiction can be the headline when it ranks first.
  const s3 = make('Germany', { conclusive_findings: [finding('f1', 'problem', 'scale')], contradictions: [contra('c1', 'registration', { why_it_matters: 'The registration is wrong' })] });
  assert.deepEqual([...reportPage(report(), s3, { now: NOW }).matchAll(/<article class="warn [^"]*\bfirst\b[^"]*" id="([^"]+)"/g)].map((m) => m[1]), ['c1']);
});

test('one gate: strengths all, problems 3, contradictions 2, notes 1, suggestions 2; a locked item shows no text or evidence', () => {
  assert.deepEqual(FREE_N, { strengths: Infinity, problems: 3, contradictions: 2, notes: 1, suggestions: 2 });
  const s2 = make('Malaysia', {
    conclusive_findings: [1, 2, 3, 4, 5].map((n) => finding(`f${n}`, 'problem', 'website')).concat([1, 2, 3, 4].map((n) => finding(`s${n}`, 'strength', 'awards'))),
    contradictions: [1, 2, 3, 4].map((n) => contra(`c${n}`, 'registration')),
    take_note: [1, 2, 3].map((n) => note(`n${n}`, 'reviews')),
  });
  const html = reportPage(report(), s2, { now: NOW });
  const shown = (p: string) => [1, 2, 3, 4, 5].filter((n) => html.includes(`TITLE-${p}${n}`)).length;
  assert.equal(shown('f'), 3);
  assert.equal(shown('c'), 2);
  assert.equal([1, 2, 3].filter((n) => html.includes(`NOTE-n${n}`)).length, 1);
  assert.equal([1, 2, 3, 4].filter((n) => html.includes(`TITLE-s${n}`)).length, 4);
  // A visible contradiction shows every source link; a locked one shows nothing of it (no "source locked" rows).
  assert.equal([...html.matchAll(/href="https:\/\/register\.example\/c\d[ab]"/g)].length, 4);
  for (const hidden of ['f4', 'f5', 'c3', 'c4', 'n2', 'n3']) assert.ok(!html.includes(`register.example/${hidden}`) && !html.includes(`register.example/${hidden}a`) && !html.includes(`QUOTE-${hidden}`), hidden);
  assert.ok(!html.includes('Source link and quote'));
  // Every locked card still has its id, so links to it land.
  for (const id of ['f4', 'f5', 'c3', 'c4', 'n2', 'n3']) assert.match(html, new RegExp(`class="warn [^"]*locked" id="${id}"`));
  assert.match(html, /2 more problems found/);
  assert.match(html, /2 more places where sources disagree/);
  assert.match(html, /2 more signals worth checking/);
});

test('sections with 0 or 1 items obey the same gate and 0 items render no section or counter', () => {
  const s2 = make('Brazil', { conclusive_findings: [finding('f1', 'problem', 'website')], contradictions: [], take_note: [] });
  const html = reportPage(report(), s2, { now: NOW });
  assert.ok(html.includes('TITLE-f1') && !/more problems? found/.test(html));
  assert.ok(!html.includes('id="notes"') && !html.includes('id="contradictions"') && !html.includes('id="strengths"'));
  assert.ok(!html.includes('href="#notes"') && !html.includes('href="#contradictions"'));
  assert.deepEqual(deadLinks(html), []);
  assert.equal((html.match(/<div class="strip">[\s\S]*?<\/div>/)?.[0].match(/<a /g) ?? []).length, 1);
});

test('locked teaser titles are a category plus a hint, and unique within their section', () => {
  const s2 = make('France', {
    conclusive_findings: [1, 2, 3, 4, 5, 6, 7].map((n) => finding(`f${n}`, 'problem', 'website', n === 6 ? { check_id: 'privacy_page' } : {})),
  });
  const html = reportPage(report(), s2, { now: NOW });
  const titles = [...html.matchAll(/class="warn wrong locked"[^>]*>[\s\S]*?<p class="topic">([^<]*)<\/p>/g)].map((m) => m[1]);
  assert.equal(titles.length, 4);
  assert.equal(new Set(titles).size, 4);
  assert.ok(titles.every((x) => x.startsWith('Website: ')));
  assert.ok(titles.includes('Website: privacy page'));
  assert.ok(!titles.some((x) => /TITLE|STATEMENT/.test(x)));
});

test('every number on the page reads from one counts object', () => {
  const s2 = make('Malaysia', {
    conclusive_findings: [finding('f1', 'problem', 'registration'), finding('f2', 'problem', 'website'), finding('f3', 'problem', 'email'), finding('f4', 'problem', 'contact', { statement: 'phone disconnected' }),
      finding('s1', 'strength', 'licence'), finding('s2', 'strength', 'other')],
    contradictions: [contra('c1', 'awards'), contra('c2', 'website'), contra('c3', 'website')],
    take_note: [note('n1', 'registration'), note('n2', 'reviews')],
    suggestions: [{ id: 'g1', action: 'DO-1', why: 'w', based_on: ['f1'] }, { id: 'g2', action: 'DO-2', why: 'w', based_on: ['f4'] }],
  });
  // problems 4, contradictions 3, notes 2, strengths 2 => issues 7, items 11, records (registration/licence/awards on any type) = f1, s1, c1, n1 = 4.
  const html = reportPage(report([{ text: 'Line', cites: ['f1'] }]), s2, { now: NOW });
  const t = text(html);
  assert.match(t, /Action required\. We found 4 problems and 3 places where sources disagree; 3 are rated Critical or High/);
  assert.match(t, /11 items found, each with its source/);
  assert.match(t, /7 issues found/);
  assert.match(t, /4 findings concern registration, licences or awards/);
  assert.match(t, /This free report prints 3 of 4 problems\./);
  assert.match(t, /Problems · 4/); assert.match(t, /Where sources disagree · 3/); assert.match(t, /Strengths · 2/); assert.match(t, /Worth looking into · 2/);
  assert.match(t, /1 more problem found/); assert.match(t, /1 more place where sources disagree/); assert.match(t, /1 more signal worth checking/);
  const strip = html.match(/<div class="strip">[\s\S]*?<\/div>/)![0];
  assert.deepEqual([...strip.matchAll(/<b[^>]*>(\d+)<\/b>/g)].map((m) => +m[1]), [2, 4, 3, 2]);
  // "issues" is problems + contradictions and "items" includes strengths, defined in one place.
  assert.ok(!/\b(32|18) (items|issues)/.test(t));
});

test('no bare ids in customer text; ids live only in title / data-id; debug mode shows them', () => {
  const s2 = make('Malaysia', {
    conclusive_findings: [finding('f1', 'problem', 'registration'), finding('s1', 'strength', 'awards')],
    contradictions: [contra('c1', 'registration')],
    take_note: [note('n1', 'reviews')],
    suggestions: [{ id: 's9', action: 'DO-1', why: 'w', based_on: ['f1', 'c1'] }],
  });
  const html = reportPage(report([{ text: 'Summary line.', cites: ['f1', 's1'] }]), s2, { now: NOW });
  // Fixture placeholders such as TITLE-f1 and register.example/f1 are not customer text.
  assert.deepEqual(bareIds(text(html).replace(/\b[A-Z]+-\w+|register\.example\/\w+/g, ' ')), []);
  assert.ok(!html.includes('item id'));
  assert.match(html, /<a class="cite" href="#f1" title="f1" data-id="f1">Problem 1<\/a>/);
  assert.match(html, />Source disagreement 1</);
  assert.match(html, /href="#c1" title="c1" data-id="c1">Source disagreement 1</);
  assert.deepEqual(deadLinks(html), []);
  const debug = reportPage(report([{ text: 'Summary line.', cites: ['f1'] }]), s2, { now: NOW, debug: true });
  assert.match(text(debug), /Problem 1 \(f1\)/);
});

test('one buy target and one upsell block; the old "one more pass" block and "not run yet" are gone, in en and ko', () => {
  const s2 = make('Malaysia', { conclusive_findings: [finding('f1', 'problem', 'website')] });
  for (const lang of ['en', 'ko']) {
    const html = reportPage(report([], lang), s2, { now: NOW, price: "$59" });
    assert.equal((html.match(/id="order"/g) ?? []).length, 1);
    const buy = [...html.matchAll(/<a [^>]*href="#order"/g)].length;
    assert.ok(buy >= 4, `buy buttons ${buy}`);
    assert.deepEqual(deadLinks(html), []);
    assert.ok(!/class="runs?"/.test(html) && !/Not run yet|not run yet|아직 진행 전|One more pass|7 research areas|7개 조사 영역|Deeper dive|심층 조사|\?<\/b>/.test(html), lang);
    // The order block sits inside the "what you get" section and holds the price.
    assert.match(html, /<section id="inside"[\s\S]*<div class="ask" id="order">[\s\S]*\$59[\s\S]*<\/section>/);
  }
});

test('price is one USD value for every country, and dates follow the report country', () => {
  const page = (country: string, price?: string) => reportPage(report(), make(country, { conclusive_findings: [finding('f1', 'problem', 'website')] }), { now: NOW, price });
  for (const c of ['Malaysia', 'Germany', 'Thailand']) assert.match(page(c, '$59'), /<p class="price" data-price>\$59<\/p>/, c);
  const de = page('Germany', '$59');
  assert.ok(!de.includes('RM249'));
  const none = page('Thailand');
  assert.ok(!none.includes('class="price"') && !none.includes('class="pr"') && !/\$\d|RM\d/.test(text(none)));
  // en-DE and en-MY print the 8 Nov 2026 date in their own order / month names.
  assert.match(text(de), /8 (Nov|Nov\.|November) 2026/);
});

test('counts 0, 1 and 2 read correctly through the plural helper', () => {
  const page = (p: number, c: number, n: number) => text(reportPage(report(), make('Malaysia', {
    conclusive_findings: Array.from({ length: p }, (_, i) => finding(`f${i + 1}`, 'problem', 'registration')),
    contradictions: Array.from({ length: c }, (_, i) => contra(`c${i + 1}`, 'registration')),
    take_note: Array.from({ length: n }, (_, i) => note(`n${i + 1}`, 'reviews')),
  }), { now: NOW }));
  const one = page(1, 1, 1);
  assert.match(page(1, 0, 0), /1 issue found/);
  assert.match(one, /We found 1 problem and 1 place where sources disagree/);
  assert.match(one, /2 issues found/);
  assert.match(one, /2 findings concern registration/);
  assert.match(one, /3 items found/);
  assert.ok(!/\b1 (problems|issues|items|places|findings|signals)\b/.test(one));
  const two = page(2, 2, 2);
  assert.match(two, /We found 2 problems and 2 places/);
  assert.match(two, /4 issues found/);
  const zero = page(0, 0, 1);
  assert.ok(!/issues? found/.test(zero) && !zero.includes('Action required'));
  assert.ok(!/\b0 (problems|issues|items|places)\b/.test(zero));
  assert.match(zero, /1 item found/);
});

test('items for the paid report only (paid_only, identity_signal) are never printed; the same id is never printed twice', () => {
  const s2 = make('Malaysia', {
    conclusive_findings: [finding('f1', 'problem', 'website'), finding('f2', 'problem', 'reviews', { paid_only: true }), finding('f1', 'problem', 'website', { title: 'DUPLICATE-F1' })],
    contradictions: [contra('c1', 'registration', { identity_signal: true })],
    take_note: [note('n1', 'reviews', { identity_signal: true }), note('n2', 'reviews')],
    suggestions: [{ id: 'g1', action: 'DO-1', why: 'w', based_on: ['f2'] }],
  });
  const html = reportPage(report([{ text: 'Leaky summary', cites: ['f2'] }]), s2, { now: NOW });
  for (const gone of ['TITLE-f2', 'TITLE-c1', 'TITLE-n1', 'DUPLICATE-F1', 'Leaky summary']) assert.ok(!html.includes(gone), gone);
  for (const id of ['f1', 'f2', 'c1', 'n1', 'n2']) assert.ok((html.match(new RegExp(`\\sid="${id}"`, 'g')) ?? []).length <= 1, id);
  assert.ok(!html.includes('id="f2"') && !html.includes('id="c1"') && !html.includes('id="n1"'));
  assert.ok(html.includes('TITLE-f1') && html.includes('NOTE-n2'));
  assert.ok(!html.includes('id="g1"'));
  assert.deepEqual(deadLinks(html), []);
});

test('Korean page: same numbers, no dead links, no removed blocks', () => {
  const s2 = make('South Korea', { conclusive_findings: [finding('f1', 'problem', 'registration'), finding('f2', 'problem', 'website')], contradictions: [contra('c1', 'registration')] });
  const html = reportPage(report([], 'ko'), s2, { now: NOW });
  assert.deepEqual(deadLinks(html), []);
  assert.match(text(html), /3건 발견/);
  assert.match(text(html), /문제점 2개와 출처마다 다른 정보 1건/);
  assert.ok(!html.includes('class="price"'));
});
