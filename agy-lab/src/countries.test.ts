// Country packs (countries.ts). The first tests guard Malaysia: its dive must stay exactly
// as it was before packs existed. scripts/check-country.ts runs this file.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as countries from './countries.ts';
import { discoveryQueries } from './companydive.ts';
import { bodyFor } from './companydive-people.ts';

const loaded = countries.loadAll();
const MY = loaded.packs.find((p) => p.code === 'MY')!;

/** The eight Brave queries every dive ran before country packs, copied from companydive.ts at 2dec74c. */
const BEFORE_PACKS = [
  ['exact', '"Eternalgy Sdn Bhd"', 'web'],
  ['country', '"Eternalgy" Malaysia', 'web'],
  ['facebook', '"Eternalgy" site:facebook.com', 'web'],
  ['linkedin', '"Eternalgy" site:linkedin.com', 'web'],
  ['reviews', '"Eternalgy" review OR complaint OR scam', 'web'],
  ['people', '"Eternalgy" founder OR director OR CEO OR owner', 'web'],
  ['projects', '"Eternalgy" project OR client OR award OR partnership', 'web'],
  ['news', '"Eternalgy"', 'news'],
];

test('every pack in src/countries is valid, with a research.md', () => {
  assert.deepEqual(loaded.problems, {});
  for (const p of loaded.packs) assert.ok(fs.existsSync(path.join(countries.DIR, p.code, 'research.md')), `${p.code}/research.md is missing`);
});

test('Malaysia: the pack is live and adds nothing', () => {
  assert.ok(MY, 'the MY pack is missing');
  assert.equal(MY.status, 'live');
  assert.deepEqual(MY.search, {});
  assert.deepEqual(MY.discover, []);
  assert.deepEqual(MY.walled, []);
  assert.deepEqual(MY.languages, ['en']);
  assert.deepEqual(MY.notes, {});
  // Found, and no log line: the public report's log reads as it did before packs.
  assert.deepEqual(countries.pick(loaded, 'Malaysia', {}), { pack: MY, note: '' });
});

test('Malaysia: the Brave queries are the eight from before packs', () => {
  assert.deepEqual(discoveryQueries('Eternalgy Sdn Bhd', 'Eternalgy', 'Malaysia', MY), BEFORE_PACKS);
  assert.deepEqual(discoveryQueries('Eternalgy Sdn Bhd', 'Eternalgy', 'Malaysia', null), BEFORE_PACKS);
});

test('Malaysia: every prompt comes back unchanged, character for character', () => {
  const prompt = 'Target company: "X" (Malaysia).\nRESULTS\n[1] a\n\nAnswer with ONLY this JSON:\n{}';
  for (const step of countries.NOTE_STEPS) {
    assert.equal(countries.withNotes(MY, step, prompt), prompt, step);
    assert.equal(countries.withNotes(null, step, prompt), prompt, step);
  }
});

test('Malaysia: Exa people searches still ask for MY, and no host is newly walled', () => {
  assert.deepEqual(bodyFor({ query: 'q', kind: 'people' }),
    { query: 'q', type: 'auto', category: 'people', numResults: 25, userLocation: 'MY', contents: { highlights: { maxCharacters: 600 } } });
  assert.deepEqual(bodyFor({ query: 'q', kind: 'web' }),
    { query: 'q', type: 'auto', numResults: 10, userLocation: 'MY', contents: { highlights: { maxCharacters: 900 } } });
  assert.equal(countries.walled(MY, 'ctoscredit.com.my'), false);
});

test('Brave gets only a country code it accepts: MY stays, SG, TH and VN are dropped', () => {
  assert.equal(countries.braveCountry('MY'), 'MY');
  assert.equal(countries.braveCountry('KR'), 'KR');
  for (const cc of ['SG', 'TH', 'VN']) assert.equal(countries.braveCountry(cc), undefined, cc);
  assert.equal(countries.braveCountry(undefined), undefined);
  const pack = { code: 'SG', country: 'Singapore', status: 'draft', names: ['singapore'], languages: ['en'], search: { brave_country: 'SG' } };
  assert.match(countries.validate(pack, 'SG').join(' '), /not a country Brave accepts/);
});

test('a country with no pack gets nothing, and no log line', () => {
  assert.deepEqual(countries.pick(loaded, 'Atlantis', {}), { pack: null, note: '' });
});

test('COUNTRY_PACKS=off turns every pack off, Malaysia included', () => {
  assert.equal(countries.pick(loaded, 'Malaysia', { COUNTRY_PACKS: 'off' }).pack, null);
});

// ---------------------------------------------------------------- packs in a temporary folder

function tmpPacks(packs: Record<string, unknown>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'packs-'));
  for (const [folder, pack] of Object.entries(packs)) {
    fs.mkdirSync(path.join(dir, folder));
    fs.writeFileSync(path.join(dir, folder, 'pack.json'), typeof pack === 'string' ? pack : JSON.stringify(pack));
  }
  return dir;
}

const SG = {
  code: 'SG', country: 'Singapore', status: 'draft', names: ['singapore', 'sg'], languages: ['en', 'zh'],
  search: { tavily_country: 'singapore', exa_location: 'SG' },
  discover: [{ label: 'uen', query: '"{short}" UEN {country}', kind: 'web' }],
  walled: ['recordowl.com'],
  notes: { analyse: 'Look for the UEN.' },
};

test('a draft pack is used only with COUNTRY_PACKS_DRAFT=1', () => {
  const l = countries.loadAll(tmpPacks({ SG }));
  assert.deepEqual(l.problems, {});
  assert.deepEqual(countries.pick(l, 'Singapore', {}), { pack: null, note: 'Country pack SG is a draft; not used' });
  const used = countries.pick(l, ' SG ', { COUNTRY_PACKS_DRAFT: '1' });
  assert.equal(used.pack?.code, 'SG');
  assert.equal(used.note, 'Country pack SG (draft) applied');
});

test('a pack adds its queries after the eight, fills placeholders, and walls its hosts', () => {
  const pack = countries.loadAll(tmpPacks({ SG })).packs[0];
  const q = discoveryQueries('Acme Pte. Ltd.', 'Acme', 'Singapore', pack);
  assert.equal(q.length, 9);
  assert.deepEqual(q[8], ['uen', '"Acme" UEN Singapore', 'web']);
  assert.ok(countries.walled(pack, 'www.recordowl.com'));
  assert.ok(!countries.walled(pack, 'notrecordowl.com'));
});

test('notes go in just before the last "Answer with ONLY", with the language lines', () => {
  const pack = countries.loadAll(tmpPacks({ SG })).packs[0];
  const out = countries.withNotes(pack, 'analyse', 'Material.\n\nAnswer with ONLY this JSON:\n{}');
  assert.match(out, /^Material\.\n\nCOUNTRY NOTES \(Singapore\)\nSources may be in Chinese[^\n]*\nLook for the UEN\.\n\nAnswer with ONLY this JSON:\n\{\}$/);
  const triage = countries.withNotes(pack, 'triage', 'no answer line');
  assert.match(triage, /^no answer line\n\nCOUNTRY NOTES \(Singapore\)\nSources may be in Chinese/);
});

test('a broken pack is ignored whole, and the log says why', () => {
  const l = countries.loadAll(tmpPacks({ SG: { ...SG, status: 'live', discover: [{ label: 'x', query: '{name} UEN', kind: 'web' }] }, KR: '{ not json' }));
  assert.equal(l.packs.length, 0);
  assert.match(l.problems.SG.join(' '), /only \{company\}, \{short\} and \{country\} exist/);
  assert.match(l.problems.KR[0], /could not be read/);
  const r = countries.pick(l, 'Singapore', {});
  assert.equal(r.pack, null);
  assert.match(r.note, /^Country pack SG is ignored: /);
});

test('the validator refuses what a pack may not do', () => {
  const errs = (p: Record<string, unknown>, folder = 'SG') => countries.validate({ ...SG, ...p }, folder).join(' | ');
  assert.match(errs({ budget: 30 }), /unknown field "budget"/);
  assert.match(errs({}, 'KR'), /does not match its folder/);
  assert.match(errs({ discover: [{ label: 'exact', query: '"{short}"', kind: 'web' }] }), /taken by the dive's own queries/);
  assert.match(errs({ discover: [{ label: 'a', query: 'no company here', kind: 'web' }] }), /must name the company/);
  assert.match(errs({ discover: Array.from({ length: 9 }, (_, i) => ({ label: `q${i}`, query: '{short}', kind: 'web' })) }), /the most is 8/);
  assert.match(errs({ notes: { triage: 'x'.repeat(3001) } }), /the most is 3000/);
  assert.match(errs({ notes: { dossier: 'x' } }), /unknown note/);
  assert.match(errs({ languages: ['xx'] }), /language "xx"/);
  assert.match(errs({ walled: ['https://a.com/'] }), /bare host/);
  assert.match(errs({ names: ['Singapore'] }), /lowercase/);
  assert.equal(errs({}), '');
});

test('two packs cannot claim the same country name', () => {
  const l = countries.loadAll(tmpPacks({ SG, XS: { ...SG, code: 'XS', names: ['sg'] } }));
  assert.equal(l.packs.length, 1);
  assert.match(l.problems.XS[0], /"sg" is already used by SG/);
});
