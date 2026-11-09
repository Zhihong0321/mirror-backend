// PL26: the golden-set scorer, on tiny fake label and report files.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { run, scoreGolden } from '../scripts/golden-score.ts';

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'golden-'));
  mkdirSync(join(dir, 'labels')); mkdirSync(join(dir, 'reports', 'v1'), { recursive: true }); mkdirSync(join(dir, 'reports', 'v2'), { recursive: true });
  writeFileSync(join(dir, 'labels', 'acme.json'), JSON.stringify({ company: 'Acme', report_ids: ['r1'], items: [
    { id: 'f1', section: 'problems', verdict: 'true', note: '' }, { id: 'f2', section: 'problems', verdict: 'false', note: '' },
    { id: 'f3', section: 'problems', verdict: 'unsure', note: '' }, { id: 'c1', section: 'contradictions', verdict: 'true', note: '' },
  ] }));
  writeFileSync(join(dir, 'labels', 'empty.json'), JSON.stringify({ company: '', report_ids: [], items: [] }));
  writeFileSync(join(dir, 'reports', 'v1', 'acme.json'), JSON.stringify({ report_id: 'r1', conclusive_findings: [{ id: 'f1' }, { id: 'f2' }, { id: 'f3' }], contradictions: [{ id: 'c1' }] }));
  // v2 produced only f1 and no contradiction.
  writeFileSync(join(dir, 'reports', 'v2', 'acme.json'), JSON.stringify({ report_id: 'r1', conclusive_findings: [{ id: 'f1' }] }));
  return dir;
}

test('accuracy per version and section: true of labelled, unsure left out, missing items not counted', () => {
  const s = scoreGolden(fixture());
  assert.deepEqual(s.versions, ['v1', 'v2']);
  assert.deepEqual(s.cells.v1.problems, { yes: 1, no: 1, unsure: 1 });
  assert.deepEqual(s.cells.v1.contradictions, { yes: 1, no: 0, unsure: 0 });
  assert.deepEqual(s.cells.v2.problems, { yes: 1, no: 0, unsure: 0 });
  assert.equal(s.cells.v2.contradictions, undefined);
});

test('the scorer writes a plain table', () => {
  const dir = fixture();
  run(dir);
  const html = readFileSync(join(dir, 'accuracy.html'), 'utf8');
  assert.match(html, /<th>v1<\/th><td>100%<small> n=1<\/small><\/td><td>50%<small> n=2<\/small><\/td>/);
  assert.match(html, /<th>v2<\/th><td>-<small> n=0<\/small><\/td><td>100%<small> n=1<\/small><\/td>/);
});

test('an empty golden folder scores nothing and does not fail', () => {
  const dir = mkdtempSync(join(tmpdir(), 'golden-'));
  assert.deepEqual(scoreGolden(dir), { versions: [], sections: [], cells: {} });
});
