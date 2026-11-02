import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv, parseSearchList, placesOf, csvLine, cutShort } from './search-list.ts';

test('parseCsv reads quotes, doubled quotes, commas and line breaks inside quotes, and a BOM', () => {
  assert.deepEqual(parseCsv('﻿"a","b, c"\r\n"say ""hi""","two\nlines"\n\n'), [['a', 'b, c'], ['say "hi"', 'two\nlines']]);
});

test('a search list needs its four columns and keeps file order', () => {
  const rows = parseSearchList('﻿"country","city","industry","search_keyword"\n"Malaysia","Kuala Lumpur","Accounting firm","Kuala Lumpur Accounting firm Malaysia"\n"Russia","Kazan","Web design company","Kazan Web design company Russia"\n');
  assert.deepEqual(rows, [
    { country: 'Malaysia', city: 'Kuala Lumpur', industry: 'Accounting firm', keyword: 'Kuala Lumpur Accounting firm Malaysia' },
    { country: 'Russia', city: 'Kazan', industry: 'Web design company', keyword: 'Kazan Web design company Russia' },
  ]);
  assert.throws(() => parseSearchList('country,city,industry\nMalaysia,KL,Accounting'), /search_keyword/);
  assert.throws(() => parseSearchList('country,city,industry,search_keyword\nMalaysia,KL,Accounting,'), /row 2/);
});

test('one place per Google place id, with only the kept fields and no empty ones', () => {
  const places = placesOf([
    { name: 'A', place_id: 'X1', website: '', phone: '+60 1', raw: { big: true } },
    { name: 'A again', place_id: 'X1' },
    { name: 'B', mapsUrl: 'https://www.google.com/maps/place/B/data=!4m2!3m1!1s0xabc:0xdef!19sChIJB' },
    { name: '' },
  ]);
  assert.deepEqual(places.map((p) => p.key), ['place:X1', 'place:ChIJB']);
  assert.deepEqual(places[0]!.business, { name: 'A', place_id: 'X1', phone: '+60 1' });
});

test('a CSV line names every search that found the business, then its website contacts', () => {
  const line = csvLine({
    business: { name: 'Acme', website: 'https://acme.example', place_id: 'X1' },
    contact: { status: 'ok', emails: [{ email: 'hi@acme.example', source: 'https://acme.example/contact' }], phones: [], people: [], links: [], errors: [] },
    contact_status: 'ok',
  }, [
    { country: 'Malaysia', city: 'Kuala Lumpur', industry: 'Web design company', keyword: 'KL web' },
    { country: 'Malaysia', city: 'Kuala Lumpur', industry: 'Digital marketing agency', keyword: 'KL digital' },
  ]);
  assert.match(line, /^"Malaysia","Kuala Lumpur","Web design company; Digital marketing agency","KL web; KL digital","Acme"/);
  assert.match(line, /"hi@acme\.example","https:\/\/acme\.example\/contact"/);
  const unchecked = csvLine({ business: { name: 'Later' }, contact: null, contact_status: null }, []);
  assert.match(unchecked, /"not_checked_yet",""$/);
});

test('an answer Google cut short is told apart from a whole one', () => {
  assert.equal(cutShort({ businesses: [{}], stoppedEarly: null }), null);
  assert.equal(cutShort({ businesses: [{}] }), null);
  assert.match(cutShort({ businesses: [{}], stoppedEarly: 'Google asked this line for a captcha' })!, /cut short: Google asked this line for a captcha/);
  assert.match(cutShort({ businesses: [{}], retryAfterMs: 1_800_000, listError: 'Google refused list requests (HTTP 429)' })!, /HTTP 429/);
});
