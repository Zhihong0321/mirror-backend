import test from 'node:test';
import assert from 'node:assert/strict';
import { config, holdReason, remaining } from './autoscan.ts';
import { ALL_TERRITORIES, allTamans, withDiscovered } from './territories.ts';

const open = { paused: false, workerLive: true, used: 0, budget: 25_000, inFlight: 0, concurrent: 1, left: 10 };

test('config defaults: running, 25k budget, one at a time, Johor before Selangor', () => {
  assert.deepEqual(config({}), { paused: false, budget: 25_000, concurrent: 1, states: ['johor', 'selangor'] });
  assert.equal(config({ AUTO_SCAN_PAUSED: '1' }).paused, true);
  assert.equal(config({ MAPS_MONTHLY_BUDGET: '280000', AUTO_SCAN_CONCURRENT: '2' }).budget, 280_000);
});

test('the queue holds for a pause, no worker, the budget, a running scan, or nothing left', () => {
  assert.equal(holdReason(open), null);
  assert.match(holdReason({ ...open, paused: true })!, /paused/);
  assert.match(holdReason({ ...open, workerLive: false })!, /no Maps worker/);
  // One more scan's worth would cross the budget: stop before, not after.
  assert.match(holdReason({ ...open, used: 24_700 })!, /budget/);
  assert.equal(holdReason({ ...open, used: 24_000 }), null);
  assert.match(holdReason({ ...open, inFlight: 1 })!, /running/);
  assert.match(holdReason({ ...open, left: 0 })!, /every listed taman/);
});

test('every listed taman is queued once, spread evenly over the districts', () => {
  const tamans = allTamans([], ['johor', 'selangor']);
  const districts = [...new Set(tamans.map((t) => t.state + '|' + t.district))];
  const order = remaining(tamans, new Set());
  assert.equal(order.length, tamans.length);
  // The first round takes one taman from each of the 19 districts, in list order.
  assert.deepEqual(order.slice(0, districts.length).map((t) => t.state + '|' + t.district), districts);
  assert.equal(order[0]!.queryPlace, tamans[0]!.queryPlace);
  // A district already ahead waits until the others catch up.
  const first = tamans.filter((t) => t.district === tamans[0]!.district).slice(0, 3);
  const ahead = remaining(tamans, new Set(first.map((t) => t.queryPlace.toLowerCase())));
  assert.notEqual(ahead[0]!.district, tamans[0]!.district);
  assert.equal(ahead.slice(0, districts.length - 1).some((t) => t.district === tamans[0]!.district), false);
});

test('within a district the queue keeps list order and skips scanned tamans', () => {
  const tamans = allTamans([], ['johor']);
  const district = tamans.filter((t) => t.district === tamans[0]!.district);
  const order = remaining(tamans, new Set([district[0]!.queryPlace.toLowerCase()]))
    .filter((t) => t.district === tamans[0]!.district);
  assert.deepEqual(order.map((t) => t.queryPlace), district.slice(1).map((t) => t.queryPlace));
});

test('verified discovered tamans join their district; unverified and already-listed ones do not', () => {
  const johor = ALL_TERRITORIES.johor!;
  const district = johor.districts[0]!;
  const listed = district.towns[0]!.tamans[0]!;
  const districts = withDiscovered(johor, [
    { state: 'Johor', district: district.name, name: 'Taman Baru Contoh', query_place: `Taman Baru Contoh, ${district.name}, Johor`, verified: true },
    { state: 'Johor', district: district.name, name: 'Taman Belum Pasti', query_place: `Taman Belum Pasti, ${district.name}, Johor`, verified: false },
    { state: 'Johor', district: district.name, name: listed.name, query_place: listed.queryPlace, verified: true },
  ]);
  const added = districts[0]!.towns.find((t) => t.name === 'Newly found tamans');
  assert.deepEqual(added?.tamans.map((t) => t.name), ['Taman Baru Contoh']);
  // The shared list itself is untouched.
  assert.equal(johor.districts[0]!.towns.some((t) => t.name === 'Newly found tamans'), false);
  assert.equal(allTamans([], ['johor']).length + 1, allTamans([
    { state: 'Johor', district: district.name, name: 'Taman Baru Contoh', query_place: `Taman Baru Contoh, ${district.name}, Johor`, verified: true },
  ], ['johor']).length);
});
