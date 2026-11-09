// PL25: the pre-send gate. A clean page passes; each failure type is blocked and named.
import test from 'node:test';
import assert from 'node:assert/strict';
import { foreignCurrency, gateMode, gateReport, gateResult, visibleText, type GateInput } from './report-rules/gate.ts';

const clean: GateInput = {
  kind: 'v21-free', country: 'MY', companyPhones: ['+60 3 1234 5678'], personNames: ['Aminah Binti Yusof'],
  html: `<!doctype html><html><head><style>.a{content:"f1 **"}</style><script>var s1 = 'RM';</script></head><body>
<!-- note f1 --><nav><a href="#problems">Problems</a></nav>
<p class="eyebrow" data-count="problems">Problems · 2</p><div class="strip"><b data-count="items">5</b> items</div>
<section id="problems"><p>Call us on +60 3 1234 5678. Price RM249. The licence runs to 31 Dec 2026.</p></section></body></html>`,
  items: [
    { id: 'f1', text: 'Licence runs to 31 Dec 2026', quotes: ['Valid until 31 Dec 2026'], why: 'A bank checks this before lending money to the company.', ownership: 'owned' },
    { id: 'f2', text: 'The website has no privacy page', quotes: ['Pages: home, about, contact'], why: 'Visitors cannot see how their details are handled.' },
  ],
  counts: { problems: 2, items: 5 },
};
const rules = (i: GateInput) => [...new Set(gateReport(i).map((f) => f.rule))].sort();

test('visible text drops tags, style, script, comments and attributes, and decodes entities', () => {
  assert.equal(visibleText('<p title="x1">A &amp; B&nbsp;&#36;5</p><!-- c --><style>p{}</style><script>1</script>'), 'A & B $5');
});

test('a clean report passes', () => { assert.deepEqual(gateReport(clean), []); });

test('each failure type is blocked and named', () => {
  const bad = (html: string) => ({ ...clean, html: clean.html.replace('</body>', `${html}</body>`) });
  assert.deepEqual(rules(bad('<p>Ring +60 12 345 6789 now</p>')), ['pii']);
  assert.deepEqual(rules(bad('<p>Reviewer Aminah Binti Yusof said no</p>')), ['pii']);
  assert.deepEqual(rules(bad('<p>The worker could not read it</p>')), ['banned-word']);
  assert.deepEqual(rules(bad('<p>This is **bold** text</p>')), ['markdown']);
  assert.deepEqual(rules(bad('<p>See s3 and c2</p>')), ['bare-id']);
  assert.deepEqual(rules(bad('<a href="#nowhere">x</a>')), ['dead-link']);
  assert.deepEqual(rules(bad('<p>Only $59 today</p>')), ['currency']);
  assert.deepEqual(rules(bad('<p>Only 59 USD today</p>')), ['currency']);
  assert.deepEqual(rules(bad('<p data-count="problems">Problems · 3</p>')), ['count']);
  assert.deepEqual(rules(bad('<p data-count="nothing">4</p>')), ['count']);
  assert.deepEqual(rules({ ...clean, items: [{ ...clean.items[0], text: 'Licence runs to 1 Jan 2030' }] }), ['claim-quote']);
  assert.deepEqual(rules({ ...clean, items: [{ ...clean.items[1], ownership: 'used by', text: 'Renew your domain now' }] }), ['ownership']);
  assert.deepEqual(rules({ ...clean, items: [{ ...clean.items[0], independentClaim: true, hasIndependentSource: false }] }), ['independent']);
  assert.deepEqual(rules({ ...clean, items: [clean.items[0], { ...clean.items[1], why: clean.items[0].why }] }), ['repeated-why']);
});

test('failures name the rule, where and why', () => {
  const [f] = gateReport({ ...clean, html: clean.html.replace('</body>', '<p>See s3</p></body>') });
  assert.equal(f.rule, 'bare-id'); assert.equal(f.where, 'page'); assert.match(f.detail, /s3/);
});

test('currency follows the report country, not a fixed symbol; quoted source text is exempt', () => {
  assert.deepEqual(foreignCurrency('Price $59 and RM249', 'MY'), ['$59']);
  assert.deepEqual(foreignCurrency('Price $59', 'US'), []);
  assert.deepEqual(foreignCurrency('Price A$59', 'AU'), []);
  assert.deepEqual(foreignCurrency('Price RM249', 'US'), ['RM249']);
  assert.deepEqual(foreignCurrency('가격 ₩59,000', 'KR'), []);
  assert.deepEqual(foreignCurrency('TOP 10 firms', 'MY'), []);
  assert.deepEqual(rules({ ...clean, html: clean.html.replace('</body>', '<q>fee of $5 million</q></body>') }), []);
});

test('REPORT_GATE: block by default, warn keeps the failures but serves', () => {
  const failures = [{ rule: 'pii', where: 'page', detail: 'x' }];
  const saved = process.env.REPORT_GATE;
  try {
    delete process.env.REPORT_GATE;
    assert.equal(gateMode(), 'block'); assert.equal(gateResult(failures).status, 'blocked'); assert.equal(gateResult([]).status, 'passed');
    process.env.REPORT_GATE = 'warn';
    assert.deepEqual(gateResult(failures), { status: 'passed', failures });
  } finally { if (saved === undefined) delete process.env.REPORT_GATE; else process.env.REPORT_GATE = saved; }
});

test('a partner credit strip and a <pre> code sample are not report wording', () => {
  const html = clean.html.replace('</body>', '<div class="partners"><p>Technology partner</p><ul><li>Exa</li><li>Tavily</li></ul></div><pre>{"@type": "JSON"}</pre></body>');
  assert.deepEqual(gateReport({ ...clean, html }), []);
});

test('the V2.1 wiring blocks a page that prints a number its quote does not hold, and one that leaks a phone', async () => {
  const { gateStep3 } = await import('./v21-step3-http.ts');
  const fx = JSON.parse((await import('node:fs')).readFileSync(new URL('./fixtures/edge/one-domain.json', import.meta.url), 'utf8'));
  assert.equal(gateStep3(fx.v21.report, fx.v21.s2).status, 'passed');
  const wrongNumber = structuredClone(fx.v21.s2); wrongNumber.conclusive_findings[1].statement = 'The domain has no DMARC record for 45 days.';
  assert.deepEqual(gateStep3(fx.v21.report, wrongNumber).failures.map((f) => f.rule), ['claim-quote']);
  const leak = structuredClone(fx.v21.s2); leak.conclusive_findings[2].statement = 'Ring the owner on +65 9123 4567 about it.';
  assert.ok(gateStep3(fx.v21.report, leak).failures.some((f) => f.rule === 'pii'));
});

test('the deeper wiring blocks a personal phone and a staff name in the full report and the preview', async () => {
  const { gateDeeperFull, gateDeeperPreview } = await import('./divedeeper/gate.ts');
  const fx = JSON.parse((await import('node:fs')).readFileSync(new URL('./fixtures/edge/reviews-over-100.json', import.meta.url), 'utf8'));
  const reviewer = fx.dive.result.people.rejected[0].name;
  const html = `<html><body><p>Contact +61 4 1234 5678 or ${reviewer}</p></body></html>`;
  assert.deepEqual([...new Set(gateDeeperFull(fx.dive, html).failures.map((f) => f.rule))], ['pii']);
  assert.equal(gateDeeperPreview(fx.dive, html, []).status, 'blocked');
});
