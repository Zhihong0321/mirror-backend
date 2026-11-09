// Owner decision 2026-11-09: one full report price, in USD, for every country, read from the hub DB (hub_setting).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { clearSettingCache, formatUsdPrice, fullReportPrice } from './reportdb.ts';
import { reportPage } from './v21/step3.ts';
import { gateStep3 } from './v21-step3-http.ts';
import { buildPreview } from './divedeeper/preview-html.ts';
import { gateDeeperPreview } from './divedeeper/gate.ts';
import { failureLine } from './divedeeper/gate.ts';

const dir = new URL('./fixtures/edge/', import.meta.url);
const fixtures = readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(readFileSync(new URL(f, dir), 'utf8')));

test('the DB value parses to USD text: whole numbers have no decimals, bad values give null', () => {
  assert.equal(formatUsdPrice('59'), '$59');
  assert.equal(formatUsdPrice(' $59 '), '$59');
  assert.equal(formatUsdPrice('59.5'), '$59.50');
  assert.equal(formatUsdPrice('1299'), '$1,299');
  for (const bad of ['', '  ', null, undefined, 'abc', '0', '-5', 'NaN', 'RM249']) assert.equal(formatUsdPrice(bad as any), null, String(bad));
});

test('no database or no setting means no price (null), never a guess', async () => {
  clearSettingCache();
  assert.equal(await fullReportPrice(), null);
});

for (const name of ['au-company', 'kr-company', 'sole-proprietorship']) {
  test(`${name}: the USD price on a non-US page is not a foreign-currency failure`, () => {
    const f = fixtures.find((x) => x.name === name)!;
    const html = reportPage(f.v21.report, f.v21.s2, { now: new Date('2026-11-09T00:00:00Z'), price: '$59' });
    assert.match(html, /data-price>\$59</);
    const gate = gateStep3(f.v21.report, f.v21.s2, '$59');
    assert.equal(gate.status, 'passed', failureLine(gate));
    const preview = buildPreview(f.dive, { price: '$59' }, null, { warnings: f.preview.warnings });
    assert.match(preview, /data-price>\$59</);
    const pg = gateDeeperPreview(f.dive, preview, f.preview.warnings);
    assert.equal(pg.status, 'passed', failureLine(pg));
  });
}

test('a dollar amount outside the price element is still a currency failure for a non-US country', () => {
  const f = fixtures.find((x) => x.name === 'kr-company')!;
  const s2 = { ...f.v21.s2, conclusive_findings: [{ ...f.v21.s2.conclusive_findings[0], statement: 'The fee is $59 per year.' }, ...f.v21.s2.conclusive_findings.slice(1)] };
  const gate = gateStep3(f.v21.report, s2, '$59');
  assert.ok(gate.failures.some((x) => x.rule === 'currency' || x.rule === 'claim-quote'));
});
