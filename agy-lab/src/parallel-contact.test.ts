import test from 'node:test';
import assert from 'node:assert/strict';
import { parallelObjective, parallelPeople, searchParallelPeople } from './parallel-contact.ts';

test('Parallel search targets a company and preserves only supported leaders', () => {
  const company = { name: 'Acme Energy', website: 'https://acme.example' };
  assert.match(parallelObjective(company, 'Procurement'), /Acme Energy.*Procurement/);
  const people = parallelPeople(company, { entities: [
    { name: 'Jane Lee', url: 'https://example.com/jane', description: 'Managing Director at Acme Energy' },
    { name: 'Jane Lee', url: 'https://example.com/jane2', description: 'Director at Acme Energy' },
    { name: 'John Tan', url: 'https://example.com/john', description: 'Sales Manager at Other Company' },
    { name: 'Acme Energy', url: 'https://acme.example', description: 'Acme Energy company' },
    { name: 'Sam Low', url: 'https://example.com/sam', description: 'Employee at Acme Energy' },
  ] });
  assert.deepEqual(people.map(p => p.name), ['Jane Lee']);
  assert.equal(people[0]?.role, 'Managing Director');
  assert.equal(people[0]?.profile_url, 'https://example.com/jane');
  assert.equal(people[0]?.direct_phone, undefined);
});

test('Parallel request uses FindAll Entity Search and keeps the key in a header', async () => {
  const beforeKey = process.env.PARALLEL_API_KEY;
  const beforeFetch = globalThis.fetch;
  process.env.PARALLEL_API_KEY = 'test-only-key';
  let called = false;
  globalThis.fetch = (async (input, init) => {
    called = true;
    assert.equal(input, 'https://api.parallel.ai/v1beta/findall/entity-search');
    assert.equal((init?.headers as Record<string, string>)['x-api-key'], 'test-only-key');
    assert.deepEqual(JSON.parse(String(init?.body)).entity_type, 'people');
    return new Response(JSON.stringify({ entity_set_id: 'set_1', entities: [] }), { status: 200 });
  }) as typeof fetch;
  try {
    const result = await searchParallelPeople({ name: 'Acme Energy' });
    assert.ok(called);
    assert.deepEqual(result.people, []);
  } finally {
    globalThis.fetch = beforeFetch;
    if (beforeKey === undefined) delete process.env.PARALLEL_API_KEY;
    else process.env.PARALLEL_API_KEY = beforeKey;
  }
});
