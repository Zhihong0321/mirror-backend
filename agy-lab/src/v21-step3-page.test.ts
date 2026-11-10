// Step 3 writer checks for the 2026-11-10 preview: the consequence titles and the proof pick are checked by code. A
// failing title or pick is recorded in `rejected` and the page falls back (teaser / rank #1); nothing blocks the report.
import test from 'node:test';
import assert from 'node:assert/strict';
import { checkProof, checkTitles, emailText, rate, step3SystemPrompt } from './v21/step3.ts';

const NOW = new Date('2026-11-09T00:00:00Z');
const s2: any = {
  input: { company: 'Acme Bhd', country: 'Malaysia', industry: 'Solar' },
  baseline: { websites: ['acme.example'] },
  conclusive_findings: [
    { id: 'f1', kind: 'strength', topic: 'awards', title: 'S', statement: 'S', evidence: [], why_it_matters: '', identity: 'x', confidence: 'high' },
    { id: 'f2', kind: 'problem', topic: 'contact', title: 'P', statement: 'P', evidence: [], why_it_matters: '', identity: 'x', confidence: 'high' },
  ],
  contradictions: [{ id: 'c1', topic: 'contact', title: 'C', why_it_matters: '', identity: 'x', confidence: 'high', versions: [{ source: 'Site', value: 'Jalan Ampang' }, { source: 'Maps', value: 'Jalan Tun' }] }],
  take_note: [{ id: 'n1', topic: 'reviews', title: 'N', note: 'N', evidence: [], why_not_conclusive: '' }],
  suggestions: [],
};

test('urgency: record type sets the base, a break word adds one, medium confidence caps at High', () => {
  const u = (topic: string, text: string, confidence: string) => rate({ topic, confidence }, [text], NOW).urg;
  assert.equal(u('awards', 'a logo', 'high'), 'low');
  assert.equal(u('registration', 'number', 'high'), 'high');
  assert.equal(u('registration', 'number is wrong', 'high'), 'critical');
  assert.equal(u('registration', 'number is wrong', 'medium'), 'high');
});

test('titles: a consequence with a count passes; a value, a strength id or an unknown id is recorded, not kept', () => {
  const rejected: any[] = [];
  const out = checkTitles([
    { id: 'f2', text: 'Your head office phone differs across 3 sources. Customers may call a line you do not answer.' },
    { id: 'c1', text: 'Your address reads Jalan Ampang on one page.' },
    { id: 'n1', text: 'Call us on 03-2161 8888 today' },
    { id: 'f1', text: 'A strength' },
    { id: 'zz', text: 'Unknown' },
    { id: 'n1', text: 'Mail info@acme.example now' },
    null,
  ], s2, rejected);
  assert.deepEqual(out, { f2: 'Your head office phone differs across 3 sources. Customers may call a line you do not answer.' });
  assert.equal(rejected.length, 6);
  assert.ok(rejected.every((r) => r.reasons.length));
  assert.ok(rejected.some((r) => r.reasons.some((x: string) => x.includes("source's value"))));
  // Not an array: nothing kept, nothing thrown.
  assert.deepEqual(checkTitles(undefined, s2, []), {});
});

test('proof: a problem or contradiction id is kept; anything else is recorded and gives null', () => {
  const rejected: any[] = [];
  assert.equal(checkProof({ id: 'f2' }, s2, rejected), 'f2');
  assert.equal(checkProof({ id: 'c1' }, s2, rejected), 'c1');
  assert.equal(checkProof({ id: 'f1' }, s2, rejected), null);
  assert.equal(checkProof(undefined, s2, rejected), null);
  assert.equal(rejected.length, 2);
});

test('the writer prompt asks for titles with no values and one proof pick; the email has no "may uncover more"', () => {
  const p = step3SystemPrompt(s2, false);
  assert.match(p, /"titles"/);
  assert.match(p, /"proof"/);
  assert.match(p, /never give the wrong value/);
  const mail = emailText('Acme Bhd', false, { text: 'Subj', cites: ['f2'] }, [{ text: 'Body', cites: ['f2'] }], 'https://x.example/r');
  assert.ok(!/uncover more/i.test(mail));
  assert.match(mail, /shows what is wrong, not where it is or how to fix it/);
  assert.ok(!/나올 수 있습니다/.test(emailText('A', true, null, [], 'u')));
});

test('a title or summary line carrying a number from a hidden item\'s own sources is recorded and left out', async () => {
  const { checkSummaryValues, valueKeys } = await import('./v21/step3.ts');
  const s: any = {
    ...s2,
    conclusive_findings: [
      { id: 'f1', kind: 'strength', topic: 'reviews', title: '4.7 rating', statement: '4.7 from 32 reviews', evidence: [{ quoted_text: '4.7 (32)' }] },
      { id: 'f2', kind: 'problem', topic: 'website', title: 'Domain expires', statement: 'x', evidence: [{ quoted_text: 'expiration: 2026-12-04' }] },
    ],
    contradictions: [
      { id: 'c1', topic: 'scale', title: 'Staff count', versions: [{ source: 'Site', value: '62 staff' }, { source: 'LinkedIn', value: '13 employees' }] },
      { id: 'c2', topic: 'registration', title: 'Grade', versions: [{ source: 'Site', value: 'Grade G7' }, { source: 'Directory', value: 'G3' }] },
    ],
    take_note: [],
  };
  assert.deepEqual([...valueKeys('3 sources')], []);
  const rejected: any[] = [];
  const titles = checkTitles([
    { id: 'c1', text: 'Your site says 62 staff and LinkedIn says 13. Panels size teams from this.' },
    { id: 'c2', text: 'Your contractor grade shows G7 on your site and G3 elsewhere.' },
    { id: 'c2', text: 'Your contractor grade differs across 2 sources, so a tender panel may cap your bid.' },
  ], s, rejected);
  assert.deepEqual(Object.keys(titles), ['c2']);
  assert.match(titles.c2, /differs across 2 sources/);
  assert.equal(rejected.length, 2);
  // Summary: the proof (f2) and the strength (f1) may give their values; a hidden contradiction may not.
  const sr: any[] = [];
  const kept = checkSummaryValues([
    { text: 'Your domain expires on 2026-12-04.', cites: ['f2'] },
    { text: 'Your 4.7 rating from 32 reviews is an asset.', cites: ['f1'] },
    { text: 'Your site says G7 while a directory shows G3.', cites: ['c2'] },
    { text: 'Your contractor grade differs between your site and a public directory.', cites: ['c2'] },
  ], s, 'f2', sr);
  assert.deepEqual(kept.map((l: any) => l.cites[0]), ['f2', 'f1', 'c2']);
  assert.equal(sr.length, 1);
  assert.match(sr[0].reasons[0], /g7|g3/);
});
