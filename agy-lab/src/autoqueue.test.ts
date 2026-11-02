import test from 'node:test';
import assert from 'node:assert/strict';
import * as aq from './autoqueue.ts';

const NOW = Date.parse('2026-10-25T05:30:00Z');
const H0 = '2026-10-25T05:00:00Z';
const H1 = '2026-10-25T04:00:00Z';
const empty = { started: [], finished: [], finder: [], events: [] };
const finished = (o: Partial<{ hour: string; kind: string; status: string; n: number; companies: number; requests: number; skipped: number; with_phone: number; people: number; avg_sec: number }>) => ({
  hour: H0, kind: 'business_search', status: 'completed', n: 1, companies: 0, requests: 0, skipped: 0, with_phone: 0, people: 0, avg_sec: 0, ...o,
});
const scanStatus = (o: Record<string, unknown> = {}) => ({ holding: null, lastTickAt: new Date(NOW - 60_000).toISOString(), ...o });
const contactStatus = (o: Record<string, unknown> = {}) => ({
  workerAvailable: true, pausedForQuota: false, paused: false, holding: null, lastTickAt: new Date(NOW - 30_000).toISOString(),
  jobType: 'research.contact.pi', totals: { queued: 0, running: 0, completed: 0, failed: 0 }, ...o,
}) as Awaited<ReturnType<typeof import('./autocontact.ts').status>>;
const recent = { last_queued: new Date(NOW - 60_000).toISOString(), last_finished: new Date(NOW - 120_000).toISOString(), last_completed: new Date(NOW - 120_000).toISOString() };

test('hour slots run newest first and include the current hour', () => {
  assert.deepEqual(aq.hourSlots(3, NOW), [H0, H1, '2026-10-25T03:00:00Z']);
});

test('an hour with nothing in it is a row of zeros, not a missing row', () => {
  const rows = aq.hourly(aq.hourSlots(24, NOW), empty);
  assert.equal(rows.length, 24);
  assert.equal(rows[5]!.maps.completed + rows[5]!.contact.completed + rows[5]!.errors, 0);
});

test('finished runs land in their hour with outcomes, finds and errors', () => {
  const rows = aq.hourly([H0, H1], {
    started: [{ hour: H0, kind: 'business_search', n: 2 }, { hour: H1, kind: 'contact_research', n: 3 }],
    finished: [
      finished({ companies: 900, requests: 300, skipped: 2, avg_sec: 600 }),
      finished({ status: 'failed', avg_sec: 60 }),
      finished({ hour: H1, kind: 'contact_research', n: 2, with_phone: 2, people: 3 }),
      finished({ hour: H1, kind: 'contact_research', status: 'failed' }),
    ],
    finder: [{ hour: H1, status: 'failed', n: 1, added: 0, requests: 4 }],
    events: [{ hour: H0, event: 'contact.deferred', n: 4 }, { hour: H0, event: 'auto.tick_failed', n: 1 }, { hour: H0, event: 'auto.hold', n: 2 }],
  });
  assert.deepEqual(rows[0]!.maps, { queued: 2, completed: 1, partial: 0, failed: 1, companies: 900, requests: 300, skipped: 2, avgSec: 330 });
  assert.equal(rows[0]!.contact.deferred, 4);
  assert.equal(rows[0]!.errors, 2, 'one failed scan, one loop error; a hold is not an error');
  assert.equal(rows[1]!.contact.completed, 2);
  assert.equal(rows[1]!.contact.withPhone, 2);
  assert.equal(rows[1]!.errors, 2, 'one failed contact report, one failed town');
});

test('maps verdict: a working queue is green', () => {
  const v = aq.mapsVerdict({ status: scanStatus(), latest: recent, open: [], lastHour: undefined, uptimeMs: 3_600_000, now: NOW });
  assert.equal(v.level, 'ok');
});

test('maps verdict: nothing holding the queue but nothing queued is red', () => {
  const v = aq.mapsVerdict({ status: scanStatus(), latest: { ...recent, last_queued: new Date(NOW - 40 * 60_000).toISOString() }, open: [], lastHour: undefined, uptimeMs: 3_600_000, now: NOW });
  assert.equal(v.level, 'bad');
  assert.match(v.headline, /no scan was queued for 40 min/);
});

test('maps verdict: a scan running past its timeout is red', () => {
  const open = [{ public_id: 'x', kind: 'business_search', status: 'running', title: 'business in Taman Daya', created_at: new Date(NOW - 45 * 60_000).toISOString(), updated_at: '' }];
  const v = aq.mapsVerdict({ status: scanStatus({ holding: 'a scan is running' }), latest: recent, open, lastHour: undefined, uptimeMs: 3_600_000, now: NOW });
  assert.equal(v.level, 'bad');
  assert.match(v.headline, /Taman Daya has been running 45 min/);
});

test('maps verdict: a loop that stopped ticking is red, but not right after a restart', () => {
  const stale = scanStatus({ lastTickAt: null });
  assert.equal(aq.mapsVerdict({ status: stale, latest: recent, open: [], lastHour: undefined, uptimeMs: 3_600_000, now: NOW }).level, 'bad');
  assert.equal(aq.mapsVerdict({ status: stale, latest: recent, open: [], lastHour: undefined, uptimeMs: 60_000, now: NOW }).level, 'ok');
});

test('maps verdict: an hour where every scan failed is red; budget reached is amber', () => {
  const rows = aq.hourly([H0], { ...empty, finished: [finished({ status: 'failed', n: 3 })] });
  assert.equal(aq.mapsVerdict({ status: scanStatus(), latest: recent, open: [], lastHour: rows[0], uptimeMs: 3_600_000, now: NOW }).level, 'bad');
  const budget = aq.mapsVerdict({ status: scanStatus({ holding: 'monthly Maps budget reached (25000 of 25000 requests)' }), latest: recent, open: [], lastHour: undefined, uptimeMs: 3_600_000, now: NOW });
  assert.equal(budget.level, 'warn');
});

test('contact verdict: no worker or no search credits is red', () => {
  assert.equal(aq.contactVerdict({ status: contactStatus({ workerAvailable: false }), latest: recent, open: [], lastHour: undefined, uptimeMs: 3_600_000, now: NOW }).level, 'bad');
  assert.equal(aq.contactVerdict({ status: contactStatus({ pausedForQuota: true }), latest: recent, open: [], lastHour: undefined, uptimeMs: 3_600_000, now: NOW }).level, 'bad');
  assert.equal(aq.contactVerdict({ status: contactStatus(), latest: recent, open: [], lastHour: undefined, uptimeMs: 3_600_000, now: NOW }).level, 'ok');
});

test('contact verdict: open reports with nothing finishing is red', () => {
  const open = [{ public_id: 'y', kind: 'contact_research', status: 'queued', title: 'Co', created_at: new Date(NOW - 50 * 60_000).toISOString(), updated_at: '' }];
  const v = aq.contactVerdict({ status: contactStatus(), latest: { ...recent, last_finished: new Date(NOW - 45 * 60_000).toISOString() }, open, lastHour: undefined, uptimeMs: 3_600_000, now: NOW });
  assert.equal(v.level, 'bad');
  assert.match(v.headline, /none finished for 45 min/);
});

test('the same error repeated groups into one line with a count', () => {
  const p = (at: string, message: string) => ({ at, source: 'business_search', kind: 'failed', title: null, message, public_id: null });
  const groups = aq.groupProblems([
    p('2026-10-25T05:00:00Z', 'scraper.tech answered HTTP 502'),
    p('2026-10-25T04:00:00Z', 'scraper.tech answered HTTP 503'),
    p('2026-10-25T03:00:00Z', 'Google Maps scan did not finish'),
  ]);
  assert.equal(groups.length, 2);
  assert.equal(groups[0]!.count, 2);
  assert.equal(groups[0]!.last, '2026-10-25T05:00:00Z');
});

test('the page loads its data from the protected dashboard endpoint', () => {
  const html = aq.page();
  assert.match(html, /\/api\/auto-queue\/dashboard/);
  assert.match(html, /aria-current="page">Auto queue/);
});
