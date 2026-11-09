import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanText, claimMismatches, similarPairs, bannedWords, phonesIn, findPII, daysToImpact, severity, rankKey, localeFor, formatMoney, bareIds, deadLinks, leftoverMarkdown, plural } from './report-rules/index.ts';

test('PL1 cleans markdown and currencies', () => {
  assert.equal(cleanText('# **Sales**\n- 35**RM million+** and USD 2 **million**; ₩ 3억; € 1.2 m [source](https://example.com)'), 'Sales RM35 million+ and USD 2 million; ₩ 3억; € 1.2 m source');
  assert.equal(cleanText('_hello_'), 'hello');
});
test('PL4 compares normalized claims', () => {
  assert.deepEqual(claimMismatches('Since 2015, revenue was 1,200 and 35 million.', ['Since 2016, revenue was 1.2k and 35,000,000.']), ['2015']);
  assert.deepEqual(claimMismatches('Call +1 212 555 1234', ['Call 12125551234']), []);
  assert.deepEqual(claimMismatches('On 2026-11-09 contact a@example.com or https://example.org and +1 212 555 1234', ['November 9, 2026: a@example.com example.org +12125551234']), []);
});
test('PL7 finds near repeats', () => {
  assert.deepEqual(similarPairs([{id:'a',text:'A buyer or a bank that checks this finds it holds up'}, {id:'b',text:'A bank or a buyer who checks this finds that it holds up'}, {id:'c',text:'The website has no contact page'}]), [['a','b']]);
});
test('PL8 matches whole internal words', () => {
  assert.deepEqual(bannedWords('The WORKER used a pipeline and PageSpeed API; benchmarked.'), ['worker', 'pipeline', 'PageSpeed API']);
});
test('PL9 normalizes international phones and finds people', () => {
  assert.deepEqual(phonesIn('MY +60 12-345 6789; KR +82 10-1234-5678; SG +65 8123 4567', ''), ['+60123456789', '+821012345678', '+6581234567']);
  assert.deepEqual(findPII('Call +60 12-345 6789 or +65 8123 4567; JANE DOE and Janet Doe', 'body', {country:'MY', companyPhones:['+60123456789'], personNames:['Jane Doe']}), [{kind:'phone',value:'+6581234567',where:'body'}, {kind:'person',value:'Jane Doe',where:'body'}]);
});
test('PL11 and PL13 severity and ranking', () => {
  assert.equal(daysToImpact(['Expires 2026-12-10 and 2026-11-19'], new Date('2026-11-09T12:00:00Z')), 10);
  assert.equal(daysToImpact(['Expired 2020-01-01'], new Date('2026-11-09')), null);
  for (const days of [-1, 10, 29, 30]) assert.equal(severity({recordLevel:1, confidence:'low', days}), 'critical');
  for (const days of [31, 90]) assert.equal(severity({recordLevel:1, confidence:'low', days}), 'high');
  assert.equal(severity({recordLevel:3, breaks:true, confidence:'high', days:null}), 'critical');
  assert.equal(severity({recordLevel:3, breaks:true, confidence:'medium', days:null}), 'high');
  assert.ok(rankKey('critical', 29) > rankKey('critical', 31));
  assert.ok(rankKey('critical', null) > rankKey('high', 0));
});
test('PL20 locale and configured prices', () => {
  const previous = process.env.REPORT_PRICES; process.env.REPORT_PRICES = JSON.stringify({MYR:'RM249',USD:'$59'});
  try {
    assert.equal(localeFor('Malaysia').price, 'RM249'); assert.match(formatMoney(35, localeFor('Malaysia')), /RM\s?35/);
    assert.equal(localeFor('South Korea').currency, 'KRW'); assert.match(formatMoney(35, localeFor('South Korea')), /₩/);
    assert.equal(localeFor('Singapore').price, null); assert.equal(localeFor('unknown').currency, 'USD');
  } finally { if (previous === undefined) delete process.env.REPORT_PRICES; else process.env.REPORT_PRICES = previous; }
});
test('PL21, PL22 and PL24 lint and plurals', () => {
  assert.deepEqual(bareIds('f1 s3 c2 n4 safe f12x'), ['f1','s3','c2','n4']);
  assert.deepEqual(deadLinks('<a href="#here">ok</a><div id="here"></div><a href="#missing">bad</a>'), ['#missing']);
  assert.ok(leftoverMarkdown('**bold** [link](https://example.com)').length);
  assert.deepEqual([0,1,2].map(n => plural(n,'review','reviews')), ['0 reviews','1 review','2 reviews']);
});


test('PL1 preserves ordinary text and handles currency markers', () => {
  for (const text of ['open 9 AM', '10 KM', '5 MB', '24 HR', 'info_sales@x.com', 'file_name', '5* rating', 'A*B']) assert.equal(cleanText(text), text);
  for (const [input, output] of [['35**RM million+**', 'RM35 million+'], ['USD 2 **million**', 'USD 2 million'], ['3 juta Rp', 'Rp3 juta'], ['**bold** __bold__ *word* _word_ `code`', 'bold bold word word code']]) assert.equal(cleanText(input), output);
});
test('PL8 allows ordinary customer wording', () => {
  assert.deepEqual(bannedWords('123 Orchard Lane; a prompt reply; tidy and Brave; fetch'), []);
  assert.deepEqual(bannedWords('the fetch'), ['the fetch']);
});
test('PL11 includes the nearest past expiry when requested', () => {
  const now = new Date('2026-11-09T12:00:00Z');
  assert.equal(daysToImpact(['2026-11-04', '2026-11-20'], now, {includePast:true}), -5);
  assert.equal(daysToImpact(['2026-11-09'], now, {includePast:true}), 0);
  for (const days of [-5, 0]) assert.equal(severity({recordLevel:1, confidence:'low', days}), 'critical');
});
test('PL20 resolves countries across regions', () => {
  for (const [country, code, currency] of [['Thailand','TH','THB'], ['Indonesia','ID','IDR'], ['Philippines','PH','PHP'], ['Vietnam','VN','VND'], ['Japan','JP','JPY'], ['Australia','AU','AUD'], ['India','IN','INR'], ['UAE','AE','AED'], ['Germany','DE','EUR'], ['GB','GB','GBP']]) {
    const loc = localeFor(country); assert.equal(loc.country, code); assert.equal(loc.currency, currency); assert.equal(loc.dateLocale, `en-${code}`);
  }
  assert.equal(localeFor('Japan', 'ko').dateLocale, 'ko-KR');
  assert.equal(localeFor('Unknown place').country, 'Unknown place');
});
