import { test } from 'node:test';
import assert from 'node:assert/strict';
import { items } from './divedeeper/editor.ts';
import { applyCheck } from './divedeeper/check.ts';
import { buildReport } from './divedeeper/report-html.ts';

test('unsupported numerical claims are dropped and recorded', () => {
  const lanes: any = { 'B-brand': { notes: {}, findings: [
    { title: 'Serves 12 customers', evidence: 'Serves 10 customers', severity: 'high' },
    { title: 'Serves 10 customers', evidence: 'Serves 10 customers', severity: 'high' },
  ] } };
  assert.equal(items(lanes).length, 1);
  assert.equal(lanes['B-brand'].notes.report_drops[0].rule, 'PL4');
});

test('analysis drops unsupported independence and internal language', () => {
  const lanes = { 'S4-analysis': { notes: { strengths: ['Independent recognition'], risks: ['The pipeline is broken'] } } };
  const result = applyCheck(lanes);
  assert.deepEqual(result['S4-analysis'].notes.strengths, []);
  assert.deepEqual(result['S4-analysis'].notes.risks, []);
});

test('empty reports render for two countries', () => {
  for (const country of ['Singapore', 'United Kingdom']) {
    const html = buildReport({ company: 'Example Works', country, result: { identity: { official_domains: ['example.test'] } } }, {});
    assert.ok(html.includes('Example Works'));
  }
});
