// PL checks for the free deeper-dive preview, with made-up companies from several countries.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPreview, gated, teasers, GATE } from './divedeeper/preview-html.ts';
import { bareIds, deadLinks, leftoverMarkdown } from './report-rules/index.ts';

const strip = (h: string) => h.replace(/<style[\s\S]*?<\/style>/g, '').replace(/\u00a0|&nbsp;/g, ' ');
const text = (h: string) => strip(h).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

const mkWarn = (i: number, over: any = {}) => ({ type: 'contradiction', title: `Registered address differs on source ${i}`, detail: `Two pages give different addresses ${i}.`, risk: `Reason number ${i} is its own sentence about ${['lenders', 'insurers', 'tenders', 'partners', 'regulators', 'customers', 'agents'][i % 7]}.`, quote: `Address line ${i} as printed`, sources: [1], ...over });
const dive = (country: string, company: string, extra: any = {}) => ({
  company, country, finished_at: '2026-11-01T10:00:00Z',
  result: { identity: { legal_name: company, official_domains: ['example.com'] }, facts: [], sources: [{ id: 1, url: 'https://registry.example.org/x', title: 'Registry' }], contradictions: [], gaps: [], ...extra },
});

test('PL16/17/18: one gate per section, a shown sign has its quote, a locked one has none, teaser titles are unique', () => {
  const warnings = Array.from({ length: 9 }, (_, i) => mkWarn(i, { title: 'Website: no privacy page' }));
  const html = buildPreview(dive('SG', 'Lion Tools Pte Ltd'), {}, null, { warnings });
  assert.equal((html.match(/class="warn /g) ?? []).length, GATE.signs);
  assert.equal((html.match(/<article class="locked"/g) ?? []).length, 4);
  assert.equal((html.match(/<blockquote class="ev"/g) ?? []).length, GATE.signs);
  assert.ok(!html.includes('Address line 8 as printed'), 'a locked item shows no evidence');
  const titles = [...html.matchAll(/<h3 class="ttl">([^<]+)</g)].map((m) => m[1].toLowerCase());
  assert.equal(new Set(titles).size, titles.length);
  assert.deepEqual(gated([1, 2, 3], 0), { shown: [], locked: [1, 2, 3] });
  assert.deepEqual(gated([1], 3), { shown: [1], locked: [] });
  assert.equal(new Set(teasers(Array.from({ length: 4 }, () => ({ type: 'missing', title: 'Same title' })))).size, 4);
});

test('PL19/22: with 0 signs there is no counter, no section and no dead link; counts agree with the page', () => {
  const html = buildPreview(dive('DE', 'Nord Werkzeug GmbH'), { price: '€59' }, null, { warnings: [] });
  assert.deepEqual(deadLinks(html), []);
  assert.ok(!html.includes('id="warnings"') && !html.includes('#warnings'));
  assert.ok(!/\b0 (warning|sign|public source|fact)/.test(text(html)));
  const many = buildPreview(dive('MY', 'Acme Sdn Bhd'), {}, null, { warnings: Array.from({ length: 7 }, (_, i) => mkWarn(i)) });
  assert.deepEqual(deadLinks(many), []);
  assert.match(text(many), /found 7 warning signs/);
  assert.match(text(many), /5 of 7 are shown/);
});

test('PL23: one buy target and no "not run yet" block', () => {
  const html = buildPreview(dive('US', 'Prairie Tools LLC'), { order_url: 'https://pay.example.com/o' }, null, { warnings: [mkWarn(1)] });
  const hrefs = new Set([...html.matchAll(/class="btn(?! ghost)[^"]*" href="([^"]+)"/g)].map((m) => m[1]));
  assert.equal(hrefs.size, 1);
  assert.ok(!/not run yet|has not run/i.test(text(html)));
});

test('PL1/8/9/10/21/24: clean text, no internal words, no staff names or phones, no identity signal, no bare ids, plurals', () => {
  const warnings = [
    mkWarn(1, { quote: 'Turnover is **RM35 million+** a year' }),
    mkWarn(2, { title: 'Reviewer Jane Doe may be staff', detail: 'Jane Doe wrote a 1-star review' }),
    mkWarn(3, { title: 'The worker could not fetch the page', detail: 'cannot be settled from the input' }),
    mkWarn(4, { type: 'identity', title: 'Possible staff review' }),
    mkWarn(5, { detail: 'Call 0123456789 for the consultant' }),
  ];
  const d = dive('MY', 'Acme Sdn Bhd', { people: { people: [{ name: 'Jane Doe', role: 'Sales Executive' }, { name: 'Ali Baba', role: 'Managing Director' }] } });
  const html = buildPreview(d, {}, null, { warnings });
  const t = text(html);
  assert.ok(!t.includes('Jane Doe') && !t.includes('0123456789'));
  assert.ok(!/\bworker\b|the input|identity|possible staff/i.test(t));
  assert.deepEqual(leftoverMarkdown(t), []);
  assert.deepEqual(bareIds(t), []);
  assert.ok(!t.includes('**'));
  assert.match(t, /1 warning sign\b/);
});

test('PL7: a repeated "why it matters" sentence is printed once', () => {
  const same = 'A buyer who checks this sees two stories and starts to doubt both.';
  const html = buildPreview(dive('GB', 'Thames Joinery Ltd'), {}, null, { warnings: [mkWarn(1, { risk: same }), mkWarn(2, { risk: same }), mkWarn(3, { risk: same })] });
  assert.equal(text(html).split('sees two stories').length - 1, 1);
});

test('PL11/13/20: urgent items lead, and the price follows the report country', () => {
  const soon = new Date(Date.now() + 10 * 864e5).toISOString().slice(0, 10);
  const html = buildPreview(dive('MY', 'Acme Sdn Bhd'), {}, null, { warnings: [mkWarn(1, { type: 'missing' }), mkWarn(2, { title: 'Domain lapses soon', detail: `Domain expires ${soon}.`, quote: `Expiry ${soon}` })] });
  const firstCard = html.match(/<article class="warn [^"]*first[^"]*">[\s\S]*?<\/article>/)![0];
  assert.match(strip(firstCard), /Domain lapses soon/);
  assert.match(firstCard, /Critical/);
});

test('the price is the one USD value passed in, for every country', () => {
  for (const [cc, name] of [['MY', 'Acme Sdn Bhd'], ['DE', 'Nord Werkzeug GmbH'], ['KR', 'Hanbit Co']]) {
    const html = buildPreview(dive(cc, name), { price: '$59' });
    assert.match(html, /<p class="price" data-price>\$59<\/p>/, cc);
  }
  assert.ok(!buildPreview(dive('MY', 'Acme Sdn Bhd'), {}).includes('class="price"'));
});
