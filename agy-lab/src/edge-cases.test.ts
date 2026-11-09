// PL27: edge-case set. Every made-up company renders through the V2.1 free page, the deeper full report and the deeper
// preview (each takes its own shape of input), and every page passes the PL25 gate.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { gateStep3 } from './v21-step3-http.ts';
import { reportPage } from './v21/step3.ts';
import { buildReportParts } from './divedeeper/report-html.ts';
import { buildPreview } from './divedeeper/preview-html.ts';
import { gateDeeperFull, gateDeeperPreview } from './divedeeper/gate.ts';
import { failureLine } from './divedeeper/gate.ts';

const dir = new URL('./fixtures/edge/', import.meta.url);
const fixtures = readdirSync(dir).filter((f) => f.endsWith('.json')).sort().map((f) => JSON.parse(readFileSync(new URL(f, dir), 'utf8')));
process.env.REPORT_PRICES = '{"MYR":"RM249","USD":"$59","SGD":"S$79","GBP":"£49","AUD":"A$89","NZD":"NZ$99","KRW":"₩79,000"}';
delete process.env.REPORT_GATE;

test('the edge set covers each shape the owner listed', () => {
  assert.deepEqual(fixtures.map((f) => f.name), ['au-company', 'kr-company', 'no-google-profile', 'one-domain', 'reviews-over-100', 'sole-proprietorship', 'zero-conflicts', 'zero-strengths']);
});

for (const f of fixtures) {
  test(`${f.name}: V2.1 free page renders and passes the gate`, () => {
    const html = reportPage(f.v21.report, f.v21.s2, { now: new Date('2026-11-09T00:00:00Z') });
    assert.ok(html.includes(f.v21.s2.input.company.replace(/&/g, '&amp;')));
    const gate = gateStep3(f.v21.report, f.v21.s2);
    assert.equal(gate.status, 'passed', failureLine(gate));
  });

  test(`${f.name}: deeper full report renders and passes the gate`, () => {
    const { html } = buildReportParts(f.dive, f.lanes);
    assert.ok(html.length > 1000);
    const gate = gateDeeperFull(f.dive, html);
    assert.equal(gate.status, 'passed', failureLine(gate));
  });

  test(`${f.name}: deeper preview renders and passes the gate`, () => {
    const html = buildPreview(f.dive, {}, null, { warnings: f.preview.warnings });
    assert.ok(html.length > 1000);
    const gate = gateDeeperPreview(f.dive, html, f.preview.warnings);
    assert.equal(gate.status, 'passed', failureLine(gate));
  });
}
