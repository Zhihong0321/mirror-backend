import test from 'node:test';
import assert from 'node:assert/strict';
import { areasIn, countEvidence, knownKeys, mapsQueries, pendingTowns, runTown, tamanKey, townId, type Deps } from './taman-finder.ts';
import type { DiscoveredTaman, FinderTownRun } from './reportdb.ts';
import type { DistrictLocation, StateTerritory } from './territories.ts';

function district(name: string, towns: Array<{ name: string; tamans: string[] }>): DistrictLocation {
  return {
    id: name.toLowerCase(), num: 1, name, state: 'Johor',
    towns: towns.map((t) => ({
      id: t.name, name: t.name, fullName: t.name, queryPlace: `${t.name}, ${name}, Johor`,
      tamans: t.tamans.map((n) => ({ name: n, queryPlace: `${n}, ${t.name}, Johor` })),
    })),
  };
}

const kulai = district('Kulai', [
  { name: 'Senai', tamans: ['Taman Senai Utama', 'Taman Sri Senai', 'Taman Bintang Senai', 'Bandar Putra Kulai (IOI)'] },
  { name: 'Kulai', tamans: ['Taman Kulai Besar'] },
]);
const johor: StateTerritory = { state: 'Johor', districts: [kulai, district('Kluang', [{ name: 'Kluang', tamans: [] }])] };

test('tamanKey: area word, brackets, punctuation and Seri all fold', () => {
  assert.equal(tamanKey('Tmn. Seri Senai'), tamanKey('Taman Sri Senai'));
  assert.equal(tamanKey('Bandar Putra Kulai (IOI)'), 'putrakulai');
  assert.equal(tamanKey('Kg. Baru Senai'), 'barusenai');
  assert.equal(tamanKey('Tamarind'), 'tamarind');
});

test('a listed taman also counts without its town name', () => {
  const keys = knownKeys(kulai);
  assert.ok(keys.has('bintang'), 'Taman Bintang Senai covers Taman Bintang in Senai');
  assert.ok(keys.has(tamanKey('Taman Seri Senai')), 'Seri is the listed Sri');
  assert.ok(keys.has(tamanKey('Bandar Putra Kulai')), 'brackets do not hide a listed name');
  assert.equal(keys.has('dawani'), false);
});

test('seven Maps list searches per town', () => {
  assert.deepEqual(mapsQueries('Senai, Kulai, Johor'), [
    'taman in Senai, Kulai, Johor', 'housing estate in Senai, Kulai, Johor', 'shop in Senai, Kulai, Johor', 'company in Senai, Kulai, Johor',
    'factory in Senai, Kulai, Johor', 'kedai in Senai, Kulai, Johor', 'services in Senai, Kulai, Johor',
  ]);
});

test('an address gives area names only when it is in the town, and never a road or garble', () => {
  assert.deepEqual(areasIn('12, Jalan Hulubalang, Taman Dawani, 81400 Senai, Johor', 'Senai'), ['Taman Dawani']);
  assert.deepEqual(areasIn('3, Jalan Merbau 1, Bandar Putra Kulai, 81000 Kulai, Johor', 'Senai'), []);
  assert.deepEqual(areasIn('Taman Aman, Senai, Johor', 'Senai'), ['Taman Aman']);
  assert.deepEqual(areasIn('Taman Jalan Raya, Taman 81400 Baru, Taman 新, 81400 Senai', 'Senai'), []);
});

test('evidence counts different addresses, and keeps the common spelling', () => {
  const ev = countEvidence([
    '1, Jalan A, Taman Dawani, 81400 Senai, Johor',
    '2, Jalan A, Taman Dawani, 81400 Senai, Johor',
    '2, Jalan A, Taman Dawani, 81400 Senai, Johor',
    '9, Jalan B, Tmn Dawani, 81400 Senai, Johor',
    'Our home, 5, Jalan C, Taman Selasih, 81400 Senai, Johor',
  ], 'Senai');
  assert.deepEqual(ev.map((e) => [e.name, e.addresses]), [['Taman Dawani', 3], ['Taman Selasih', 1]]);
});

function deps(over: Partial<Deps> = {}) {
  const saved: Array<DiscoveredTaman & { name_key: string }> = [];
  const recorded: FinderTownRun[] = [];
  const d: Deps = {
    maps: async () => [],
    leadAddresses: async () => [],
    save: async (rows) => { saved.push(...rows); return rows.length; },
    record: async (run) => { recorded.push(run); return true; },
    log: () => {},
    ...over,
  };
  return { d, saved, recorded };
}

test('a town keeps new names with two or more addresses and records the outcome once', async () => {
  const { d, saved, recorded } = deps({
    maps: async (q) => q.startsWith('taman in') ? [
      { full_address: '1, Jalan A, Taman Dawani, 81400 Senai, Johor' },
      { full_address: '2, Jalan B, Taman Dawani, 81400 Senai, Johor' },
      { full_address: 'Shalini, 47, Jalan Bintang 2, Taman Bintang, 81400 Senai, Johor' },
      { full_address: '8, Jalan C, Taman Bintang, 81400 Senai, Johor' },
      { full_address: 'Our home, 5, Jalan D, Taman Selasih, 81400 Senai, Johor' },
    ] : [],
    leadAddresses: async () => ['7, Jalan E, Taman Dawani, 81400 Senai, Johor', '3, Jalan F, Tmn Seri Senai, 81400 Senai, Johor', '4, Jalan F, Taman Sri Senai, 81400 Senai, Johor'],
  });
  const out = await runTown(johor, kulai, kulai.towns[0]!, d);
  assert.deepEqual(saved.map((r) => [r.name, r.query_place, r.verified]), [['Taman Dawani', 'Taman Dawani, Senai, Johor', true]]);
  assert.equal(saved[0]!.evidence_url, 'named in 3 addresses in Senai');
  // Taman Bintang is the listed Taman Bintang Senai; Tmn Seri Senai is the listed Taman Sri Senai.
  assert.deepEqual(out.listed.map((e) => e.key).sort(), ['bintang', tamanKey('Taman Sri Senai')].sort());
  assert.deepEqual(out.thin.map((e) => e.name), ['Taman Selasih']);
  assert.equal(recorded.length, 1);
  assert.equal(recorded[0]!.status, 'done');
  assert.equal(recorded[0]!.maps_requests, 7);
  assert.equal(recorded[0]!.added, 1);
});

test('a search that fails once is retried; a town where most searches fail is recorded failed', async () => {
  const tries = new Map<string, number>();
  const flaky = deps({
    maps: async (q) => {
      tries.set(q, (tries.get(q) ?? 0) + 1);
      if (tries.get(q) === 1) throw new Error('fetch failed');
      return [{ full_address: '1, Jalan A, Taman Dawani, 81400 Senai, Johor' }, { full_address: '2, Jalan B, Taman Dawani, 81400 Senai, Johor' }];
    },
  });
  const ok = await runTown(johor, kulai, kulai.towns[0]!, flaky.d);
  assert.equal(ok.status, 'done');
  assert.equal(ok.maps_requests, 14);
  assert.deepEqual(flaky.saved.map((r) => r.name), ['Taman Dawani']);

  let n = 0;
  const mostlyDown = deps({
    // 4 of the 7 searches fail both tries (8 calls): more than half.
    maps: async () => { if (n++ >= 8) return []; throw new Error("fetch failed"); },
    leadAddresses: async () => ['1, Jalan A, Taman Dawani, 81400 Senai, Johor', '2, Jalan B, Taman Dawani, 81400 Senai, Johor'],
  });
  const down = await runTown(johor, kulai, kulai.towns[0]!, mostlyDown.d);
  assert.equal(down.status, 'failed', 'leads alone do not make a check that lost most of its searches');
  assert.equal(mostlyDown.saved.length, 0);
});

test('a town where every source failed is recorded failed and saves nothing', async () => {
  const { d, saved, recorded } = deps({
    maps: async () => { throw new Error('scraper.tech down'); },
    leadAddresses: async () => { throw new Error('db down'); },
  });
  const out = await runTown(johor, kulai, kulai.towns[0]!, d);
  assert.equal(out.status, 'failed');
  assert.equal(saved.length, 0);
  assert.equal(recorded[0]!.status, 'failed');
  assert.match(String(recorded[0]!.error), /scraper.tech down/);
});

test('a town with no evidence is done, not failed: checked once either way', async () => {
  const { d, recorded } = deps();
  const out = await runTown(johor, kulai, kulai.towns[1]!, d);
  assert.equal(out.status, 'done');
  assert.equal(recorded[0]!.added, 0);
});

test('pending towns skip checked ones and spread over the daerah', () => {
  const all = pendingTowns(new Set(), ['johor'], { johor });
  assert.deepEqual(all.map((t) => t.town.name), ['Senai', 'Kluang', 'Kulai']);
  const left = pendingTowns(new Set([townId('Johor', 'Kulai', 'Senai')]), ['johor'], { johor });
  assert.deepEqual(left.map((t) => t.town.name), ['Kluang', 'Kulai']);
});

test('a common word left after dropping a town never hides another taman', () => {
  const d = district('Kulai', [
    { name: 'Senai', tamans: ['Taman Bintang Senai'] },
    { name: 'Sedenak', tamans: ['Kampung Baru Sedenak'] },
  ]);
  const senai = knownKeys(d, 'Senai');
  assert.equal(senai.has('baru'), false, 'Kampung Baru Sedenak is not "baru" in Senai');
  assert.equal(senai.has('bintang'), true);
  assert.equal(knownKeys(d, 'Sedenak').has('bintang'), false, 'the bare name only counts in its own town');
});

test('a name that is only a common word is set aside as too vague', async () => {
  const { d, saved } = deps({
    leadAddresses: async () => [
      '1, Jalan A, Kampung Baru, 81400 Senai, Johor', '2, Jalan B, Kampung Baru, 81400 Senai, Johor',
      '3, Jalan C, Taman Dawani, 81400 Senai, Johor', '4, Jalan D, Taman Dawani, 81400 Senai, Johor',
    ],
  });
  const out = await runTown(johor, kulai, kulai.towns[0]!, d);
  assert.deepEqual(saved.map((r) => r.name), ['Taman Dawani']);
  assert.deepEqual(out.vague.map((e) => e.name), ['Kampung Baru']);
});
