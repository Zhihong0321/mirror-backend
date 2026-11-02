import test from 'node:test';
import assert from 'node:assert/strict';
import * as kh from './keyhealth.ts';

test('quota share maps to a level: under 5% is out, under 20% is low', () => {
  assert.equal(kh.levelFor(50, 100), 'ok');
  assert.equal(kh.levelFor(19, 100), 'warn');
  assert.equal(kh.levelFor(4, 100), 'bad');
  assert.equal(kh.levelFor(null, 100), 'unknown');
  assert.equal(kh.levelFor(5, 0), 'unknown');
});

test('the MiniMax Token Plan answer becomes percent left per window with reset times', () => {
  // The shape api.minimax.io answered on 2026-10-25.
  const windows = kh.parseMinimax({
    model_remains: [{
      start_time: 1792898643148, end_time: 1792916643148, model_name: 'general',
      current_interval_remaining_percent: 73, current_weekly_remaining_percent: 40, weekly_end_time: 1793010423654,
    }],
    base_resp: { status_code: 0, status_msg: 'success' },
  });
  assert.deepEqual(windows, [{
    model: 'general', intervalLeftPct: 73, intervalResetsAt: new Date(1792916643148).toISOString(),
    weekLeftPct: 40, weekResetsAt: new Date(1793010423654).toISOString(),
  }]);
});

test('a MiniMax error status is an error, not 0% left', () => {
  assert.throws(() => kh.parseMinimax({ base_resp: { status_code: 2062, status_msg: 'no active token plan' } }), /no active token plan/);
});

test('one-api billing: hard limit in dollars, usage in cents', () => {
  // The shape the asiasouth proxy answered on 2026-10-25.
  const b = kh.parseBilling({ hard_limit_usd: 203.8158696 }, { total_usage: 16493.11848 })!;
  assert.equal(Math.round(b.usedUsd * 100) / 100, 164.93);
  assert.equal(Math.round(b.leftUsd * 100) / 100, 38.88);
  assert.equal(kh.parseBilling({}, {}), null);
});
