// The free report page is a sales page: what is locked must not be in the HTML at all, and every problem and
// contradiction carries an urgency badge set by code.
import test from 'node:test';
import assert from 'node:assert/strict';
import { FREE_N, rate, reportPage } from './v21/step3.ts';

// The price is one USD value read from the hub DB by the caller and passed in as options.price.
const NOW = new Date('2026-11-09T00:00:00Z');
const urgencyOf = (topic: string, text: string, confidence: string) => rate({ topic, confidence }, [text], NOW).urg;

const ev = (n: number) => [{ evidence_id: `E${n}`, quoted_text: `QUOTE-${n}`, source_url: `https://registry.example/secret-${n}` }];
const problem = (n: number, topic: string, title: string, confidence = 'high') => ({
  id: `f${n}`, kind: 'problem', topic, title, statement: `STATEMENT-${n}`, evidence: ev(n), why_it_matters: `WHY-${n}`, identity: 'x', confidence,
});
const s2: any = {
  input: { company: 'Acme Bhd', country: 'MY', industry: 'Solar' },
  baseline: { websites: ['acme.example'] },
  conclusive_findings: [
    { ...problem(1, 'other', 'Stale logo'), kind: 'strength', title: 'STRENGTH-TITLE' },
    problem(2, 'awards', 'LOWTITLE-2'),
    problem(3, 'registration', 'CRITTITLE-3 registration number is wrong'),
    problem(4, 'email', 'HIGHTITLE-4 no DMARC record'),
    problem(5, 'contact', 'HIDDEN-TITLE-5 phone disconnected'),
    problem(6, 'website', 'HIDDEN-TITLE-6'),
    problem(7, 'scale', 'HIDDEN-TITLE-7'),
  ],
  contradictions: [1, 2, 3].map((n) => ({
    id: `c${n}`, topic: 'registration', title: `CONTRA-${n}`, why_it_matters: `CWHY-${n}`, identity: 'x', confidence: 'high',
    versions: [{ source: 'Site', value: `VALUE-A-${n}`, ...ev(10 + n)[0] }, { source: 'Directory', value: `VALUE-B-${n}`, ...ev(20 + n)[0] }],
  })),
  take_note: [],
  suggestions: [
    { id: 's1', action: 'FREE-STEP-1', why: 'w', based_on: ['f3'] },
    { id: 's2', action: 'FREE-STEP-2', why: 'w', based_on: ['c1'] },
    { id: 's3', action: 'LOCKED-STEP-3', why: 'w', based_on: ['c2'] },
    { id: 's4', action: 'LEAK-STEP-4', why: 'w', based_on: ['f6'] },
  ],
};
const report: any = {
  language: 'en', created_at: '2026-11-08T00:00:00Z',
  summary: [{ text: 'SUMMARY-OK', cites: ['f3'] }, { text: 'SUMMARY-LEAK', cites: ['f6'] }],
};

test('urgency: record type sets the base, a break word adds one, medium confidence caps at High', () => {
  assert.equal(urgencyOf('awards', 'a logo', 'high'), 'low');
  assert.equal(urgencyOf('registration', 'number', 'high'), 'high');
  assert.equal(urgencyOf('registration', 'number is wrong', 'high'), 'critical');
  assert.equal(urgencyOf('registration', 'number is wrong', 'medium'), 'high');
  assert.equal(urgencyOf('nonsense', 'x', 'high'), 'low');
});

test('free page: only the top problems are printed, in urgency order, each with a badge', () => {
  const html = reportPage(report, s2);
  assert.equal(FREE_N.problems, 3);
  // f3 (critical), f4 (high), f5 (contact + disconnected = critical) outrank f2 (low), f6 (medium), f7 (low).
  assert.ok(html.indexOf('id="f5"') < html.indexOf('id="f2"'));
  for (const shown of ['CRITTITLE-3', 'HIGHTITLE-4', 'HIDDEN-TITLE-5']) assert.ok(html.includes(shown), shown);
  for (const hidden of ['LOWTITLE-2', 'HIDDEN-TITLE-6', 'HIDDEN-TITLE-7', 'STATEMENT-2', 'STATEMENT-6', 'WHY-6', 'QUOTE-6', 'secret-6', 'secret-7']) {
    assert.ok(!html.includes(hidden), `${hidden} must not be in the HTML`);
  }
  // A locked card keeps its id and its urgency badge.
  assert.match(html, /<article class="warn wrong locked" id="f6">/);
  assert.match(html, /class="urg medium"/);
  assert.ok((html.match(/class="urg /g) ?? []).length >= 6 + 3);
  assert.match(html, /3 more problems found/);
});

test('free page: contradictions beyond the first two are locked whole: no title, values, link or quote', () => {
  const html = reportPage(report, s2);
  assert.equal(FREE_N.contradictions, 2);
  for (const t of ['CONTRA-1', 'CONTRA-2']) assert.ok(html.includes(t), t);
  for (const t of ['CONTRA-3', 'VALUE-A-3', 'VALUE-B-3', 'CWHY-3']) assert.ok(!html.includes(t), t);
  assert.ok(!html.includes('Source link and quote'));
  assert.ok(html.includes('secret-11') && html.includes('secret-12'));
  assert.ok(!html.includes('secret-13') && !html.includes('secret-23') && !html.includes('QUOTE-13'));
});

test('free page: an action step is free only when everything it rests on is on the page', () => {
  const html = reportPage(report, s2, { price: '$59' });
  assert.equal(FREE_N.suggestions, 2);
  assert.ok(html.includes('FREE-STEP-1') && html.includes('FREE-STEP-2'));
  assert.ok(!html.includes('LOCKED-STEP-3') && !html.includes('LEAK-STEP-4'));
  assert.match(html, /The full action plan, written out/);
  assert.match(html, /review replies ready to post/);
  // No invented figures: no task count or page count; the only money on the page is the price.
  const text = html.replace(/<style[\s\S]*?<\/style>/, '');
  assert.ok(!/\b25\b|\b21 tasks|14-page|13-page/.test(text));
  assert.deepEqual([...new Set(text.match(/RM\d+|\$\d+/g))], ['$59']);
});

test('one USD price for every country; no price passed means none shown', () => {
  for (const country of ['Malaysia', 'South Korea', 'United States']) {
    const c: any = { ...s2, input: { ...s2.input, country } };
    const html = reportPage(report, c, { now: NOW, price: '$59' });
    assert.match(html, /<p class="price" data-price>\$59<\/p>/, country);
    assert.match(html, /<span class="pr" data-price>\$59<\/span>/, country);
    assert.ok(!html.includes('RM249') && !html.includes('₩'), country);
  }
  const none = reportPage(report, s2, { now: NOW });
  assert.ok(!none.includes('class="price"') && !none.includes('class="pr"') && !/\$\d|RM\d/.test(none.replace(/<style[\s\S]*?<\/style>/, '')));
});

test('the page says what the full report holds, so the price has something to buy', () => {
  const html = reportPage(report, s2);
  assert.match(html, /<section id="inside"/);
  for (const part of ['Your scorecard', 'Every finding, with its evidence', 'What ChatGPT and Gemini say about you', 'What a stranger learns in ten minutes',
    'An action plan, department by department', 'Done for you: the copy, written', 'A plan to get recommended by AI assistants']) {
    assert.ok(html.includes(part), part);
  }
  assert.match(html, /This free report prints 3 of 6 problems\./);
  assert.match(html, /This free report prints the first 2 steps\./);
  // It describes the paid report only; nothing locked is named.
  assert.ok(!html.includes('LOCKED-STEP-3') && !html.includes('HIDDEN-TITLE-6'));
  const ko = reportPage({ ...report, language: 'ko' }, s2);
  assert.match(ko, /ChatGPT와 Gemini가 귀사에 대해 말하는 것/);
  assert.match(ko, /이 무료 보고서에는 문제 6개 중 3개만 있습니다/);
});

test('free page: a summary line that cites a locked item is dropped', () => {
  const html = reportPage(report, s2);
  assert.ok(html.includes('SUMMARY-OK'));
  assert.ok(!html.includes('SUMMARY-LEAK'));
});

test('free page: scorecard, records callout and sticky bar come from the real counts', () => {
  const html = reportPage(report, s2);
  assert.match(html, /We found 6 problems and 3 places where sources disagree; \d+ are rated Critical or High/);
  assert.match(html, /class="callout"/);
  assert.match(html, /class="sticky"/);
  assert.match(html, /9 issues found/);
  assert.ok(html.includes('STRENGTH-TITLE'));
});

test('a company with nothing to lock gets no lock card; one with no issues gets no sticky bar', () => {
  const small: any = { ...s2, conclusive_findings: [problem(2, 'awards', 'ONLY')], contradictions: [], suggestions: [] };
  const html = reportPage({ ...report, summary: [] }, small);
  assert.ok(html.includes('ONLY'));
  assert.ok(!/more problems? found/.test(html) && !html.includes('The full action plan, written out'));
  assert.ok(!html.includes('prints 1 of') && !html.includes('prints the first'));
  assert.ok(html.includes('<div class="sticky">'));
  const clean: any = { ...small, conclusive_findings: [{ ...problem(1, 'other', 'S'), kind: 'strength' }] };
  const none = reportPage({ ...report, summary: [] }, clean);
  assert.ok(!none.includes('<div class="sticky">') && !none.includes('class="exec"') && !none.includes('class="callout"'));
  // The order block is always there, so every buy button has a target.
  assert.ok(none.includes('id="order"'));
});

test('Korean page prints the same gate', () => {
  const html = reportPage({ ...report, language: 'ko' }, s2);
  assert.ok(!html.includes('HIDDEN-TITLE-6'));
  assert.match(html, /문제점 3개 더 발견/);
});
