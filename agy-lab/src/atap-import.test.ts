import test from 'node:test';
import assert from 'node:assert/strict';
import { isSalesAgent, type AtapUser } from './atap-import.ts';

const user = (access_level: string[], name = 'Test User'): AtapUser => ({
  id: 1,
  bubble_id: 'user_test',
  email: 'test@example.com',
  access_level,
  linked_agent_profile: null,
  name,
  contact: '0123456789',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
});

test('access levels seen in the live roster classify correctly', () => {
  assert.ok(isSalesAgent(user(['outsource sales agent (osa)', 'team-kluang'])));
  assert.ok(isSalesAgent(user(['team-jb', 'sales'])));
  assert.ok(isSalesAgent(user(['team-klang', 'sales consultant'])));
  assert.ok(isSalesAgent(user(['sales team manager'])));
  assert.ok(isSalesAgent(user(['sales outsource manager (oum)'])));
  assert.ok(isSalesAgent(user(['senior sales consultant'])));
  assert.ok(isSalesAgent(user(['outsource unit manager (oum)'])));
});

test('non-sales access levels are skipped', () => {
  assert.ok(!isSalesAgent(user(['admin'])));
  assert.ok(!isSalesAgent(user(['finance', 'hr'])));
  assert.ok(!isSalesAgent(user(['engineering', 'seda'])));
  assert.ok(!isSalesAgent(user(['delete this'])));
  assert.ok(!isSalesAgent(user([])));
});

test('sales agents blocked from the app are skipped, even with a sales role', () => {
  assert.ok(!isSalesAgent(user(['sales', 'blocked'])));
});

test('a sales role is still recognised alongside unrelated tags', () => {
  assert.ok(isSalesAgent(user(['finance', 'sales', 'report'])));
});
