// Pipeline bugs found in the Verdant Solar deeper report (2026-11-11). Each test fails on the old code and holds a
// general rule, not one company's data: numbers inside numbers are not phones, a refused search is not "not found",
// a page without its <head> is not a page without a title, one AI count, copy about an old date is not a deadline.
import test from 'node:test';
import assert from 'node:assert/strict';
import { phonesIn } from './divedeeper/sections/C-merged.ts';
import { RESEARCH_PHONE_RE } from './divedeeper/sections/R-contacts.ts';
import { result } from './divedeeper/site-handlers.ts';
import { items, resolve } from './divedeeper/editor.ts';

const research = (t: string) => [...t.matchAll(RESEARCH_PHONE_RE)].map((m) => m[0]);

test('a registration number is not a phone; a real number beside it still is', () => {
  assert.deepEqual(phonesIn('Copyright © 2026 Verdant Solar Sdn. Bhd. 201501019046 (1144381-A) | All rights reserved.'), []);
  assert.deepEqual(phonesIn('Tel: +603-7831 8770'), ['60378318770']);
  assert.deepEqual(research('Verdant Solar Sdn. Bhd. 201501019046 (1144381-A)'), []);
});

test('research text: a glued dropdown gives no phone, a spaced number is read whole', () => {
  assert.deepEqual(research('Average Monthly Bill <200200-300300-400400-500500-600600-900900-2000>2000'), []);
  assert.deepEqual(research('+603 - 7831 8770 | 6012 - 358 0692'), ['+603 - 7831 8770', '6012 - 358 0692']);
  assert.deepEqual(research('03-7499 2251 or 012-345 6789, hotline 1300-88-1234'), ['03-7499 2251', '012-345 6789', '1300-88-1234']);
});

test('a source that refused the search is "could not check", never "not found"', () => {
  const refused = result('MY-ssmsearch.com/w1', { status: 'not_found', excerpt: '{"is_not_logged_in":true,"total":0,"is_more_than_limit":false}' });
  assert.equal(refused.status, 'couldnt_check');
  assert.match(refused.reason, /refused/);
  assert.equal(result('MY-ssmsearch.com/w1', { status: 'not_found', excerpt: '{"total":0}' }).status, 'not_found');
  assert.equal(result('x', { status: 'not_found', reason: 'Please log in to continue' }).status, 'couldnt_check');
});

test('one AI count: G-search\'s "names you in N of M" gives way to G-recommend when it answered', () => {
  const gs = { findings: [{ title: 'An AI assistant with web search names you in 4 of 6 answers', detail: '', severity: 'medium', check: 'ai-share' }] };
  const has = (L: Record<string, any>) => items(L).some((x) => x.lane === 'G-search' && x.check === 'ai-share');
  assert.equal(has({ 'G-search': gs }), true);
  assert.equal(has({ 'G-search': gs, 'G-recommend': { notes: { answers: [{ kind: 'find', assistant: 'Gemini', named: true }] } } }), false);
});

test('copy about a past date is not a deadline; an expiring asset still is', () => {
  const L = {
    'C-merged': { findings: [{ check: 'llm', type: 'outdated', title: 'outdated: "1st April 2021 – 31st December 2024"', detail: 'The NOVA quota period has expired.', severity: 'high' }] },
    'A-assets': { findings: [{ check: 'domain-expiry', title: 'example.my expires on 2020-01-31', detail: 'Renew it.', severity: 'medium' }] },
  };
  const got = items(L);
  assert.notEqual(got.find((x) => x.lane === 'C-merged')?.severity, 'critical');
  assert.equal(got.find((x) => x.lane === 'A-assets')?.severity, 'critical');
});

test('risk checks that could not run are not counted as failed', () => {
  const checks = [
    { id: 'bnm', result: 'clear' }, { id: 'fca', result: 'clear' }, { id: 'sc', result: 'clear' }, { id: 'court', result: 'found' },
    { id: 'insolvency', result: 'not_checked' }, { id: 'tenders', result: 'clear' },
  ];
  const R = resolve({ result: { identity: {} } }, { 'K-credibility': { notes: { checks }, findings: [] } });
  assert.deepEqual(R.records.risky.map((c: any) => c.id), ['bnm', 'fca', 'sc', 'court']);
});

test('a legal-name-only register search is retried with the other spelling of the legal form', async () => {
  const { otherLegalForm } = await import('./divedeeper/site-handlers.ts');
  assert.equal(otherLegalForm('Eternalgy Sdn Bhd'), 'Eternalgy Sdn. Bhd.');
  assert.equal(otherLegalForm('Verdant Solar Sdn. Bhd.'), 'Verdant Solar Sdn Bhd');
  assert.equal(otherLegalForm('Solarvest Holdings Bhd'), 'Solarvest Holdings Bhd.');
  assert.equal(otherLegalForm('Acme Trading'), '');
  assert.equal(otherLegalForm('Pekat Group Berhad'), '');
});

test('the cover counts what was read: every AI answer from both AI lanes, and the site pages the crawl read', () => {
  const L = {
    'G-search': { notes: { answers: [{ id: 'a', sample: 0 }, { id: 'b', sample: 0 }] } },
    'G-recommend': { notes: { assistants: ['Gemini'], answers: [{ kind: 'find', assistant: 'Gemini' }, { kind: 'rate', assistant: 'Gemini' }, { kind: 'pick', assistant: 'Gemini' }] } },
    'C-merged': { notes: { pages_crawled: 15 }, findings: [] },
  };
  const R = resolve({ result: { identity: {} } }, L);
  assert.equal(R.ai.answers, 5);
  assert.equal(R.pages_tested, 15);
  assert.equal(resolve({ result: { identity: {} } }, {}).pages_tested, null);
});

test('contact evidence: Facebook addresses are recognised and skipped', async () => {
  const { isFacebook } = await import('./divedeeper/sections/R-contacts.ts');
  for (const u of ['https://www.facebook.com/250657781749452', 'https://m.facebook.com/x', 'https://fb.com/acme', 'https://fb.watch/abc']) assert.equal(isFacebook(u), true, u);
  for (const u of ['https://www.crunchbase.com/organization/x', 'https://notfacebook.com/', 'not a url']) assert.equal(isFacebook(u), false, u);
});
