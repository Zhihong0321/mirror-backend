import test from 'node:test';
import assert from 'node:assert/strict';
import * as autoContact from './autocontact.ts';

const company = (id: string) => ({ id, name: 'Co ' + id });
const live = () => ['research.contact'];

const ROUTING_ENV = ['CONTACT_RESEARCH_MODEL', 'MINIMAX_API_KEY', 'TAVILY_API_KEY', 'TAVILY_API_KEYS', 'CONTACT_LANES'] as const;

function withEnv(values: Partial<Record<typeof ROUTING_ENV[number], string>>, fn: () => Promise<void> | void) {
  const saved = Object.fromEntries(ROUTING_ENV.map((key) => [key, process.env[key]]));
  for (const key of ROUTING_ENV) {
    if (values[key] === undefined) delete process.env[key]; else process.env[key] = values[key];
  }
  const restore = () => {
    for (const key of ROUTING_ENV) {
      if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key];
    }
  };
  try {
    const out = fn();
    return out instanceof Promise ? out.finally(restore) : (restore(), out);
  } catch (err) {
    restore();
    throw err;
  }
}

test('default contact reports require a dedicated research worker', () => withEnv({}, () => {
  assert.equal(autoContact.contactResearchJobType(), 'research.contact');
}));

test('no live worker claiming the job type queues nothing', async () => {
  let launched = 0;
  autoContact.init({
    liveTypes: () => [],
    backlog: async () => [company('1')],
    launch: async () => { launched += 1; },
  });
  assert.equal(await autoContact.tick(), 0);
  assert.equal(launched, 0);
});

test('a MiniMax key makes the hub assign contact jobs to the pi worker', () => withEnv({ MINIMAX_API_KEY: 'test-key' }, async () => {
  let launched = 0;
  assert.equal(autoContact.contactResearchJobType(), 'research.contact.pi');
  autoContact.init({
    liveTypes: () => ['research.contact'],
    backlog: async () => [company('local')],
    launch: async () => { launched++; },
  });
  assert.equal(await autoContact.tick(), 0);
  autoContact.init({
    liveTypes: () => ['research.contact.pi'],
    backlog: async () => [company('pi')],
    launch: async () => { launched++; },
    tavilyAvailable: () => true,
  });
  assert.equal(await autoContact.tick(), 1);
  assert.equal(launched, 1);
}));

test('the auto-queue stops while every Tavily key is out of credits, and resumes after', () => withEnv({ MINIMAX_API_KEY: 'test-key' }, async () => {
  let launched = 0;
  let credits = false;
  autoContact.init({
    liveTypes: () => ['research.contact.pi'],
    backlog: async () => [company('pi')],
    launch: async () => { launched++; },
    tavilyAvailable: () => credits,
  });
  assert.equal(await autoContact.tick(), 0);
  assert.equal(launched, 0);
  credits = true;
  assert.equal(await autoContact.tick(), 1);
  assert.equal(launched, 1);
}));

test('a leftover gemini or agy model name routes to the pi worker, not a retired one', () => {
  for (const model of ['gamini-3.7-flash', 'gemini-3.7-flash', 'agy-web', 'pi', 'minimax']) {
    withEnv({ CONTACT_RESEARCH_MODEL: model }, () => {
      assert.equal(autoContact.contactResearchJobType(), 'research.contact.pi', model);
    });
  }
  withEnv({ CONTACT_RESEARCH_MODEL: 'chatgpt' }, () => {
    assert.equal(autoContact.contactResearchJobType(), 'research.contact.pi');
  });
});

test('a live worker queues min(batch, backlog) and logs the count', () => withEnv({ CONTACT_LANES: '1' }, async () => {
  const launched: string[] = [];
  const lines: string[] = [];
  const orig = console.log;
  console.log = (...args: unknown[]) => { lines.push(args.map(String).join(' ')); };
  try {
    autoContact.init({
      liveTypes: live,
      backlog: async (limit) => ['1', '2', '3', '4', '5'].slice(0, limit).map(company),
      launch: async (row) => { launched.push(String(row.id)); },
    });
    assert.equal(await autoContact.tick(), 2);
    assert.deepEqual(launched, ['1', '2']);
    assert.ok(lines.some((line) => line.includes('[auto-queue] queued 2 contact research job(s)')));
  } finally {
    console.log = orig;
  }
}));

test('launch receives autoQueued true', () => withEnv({}, async () => {
  let opts: { autoQueued?: boolean } | undefined;
  autoContact.init({
    liveTypes: live,
    backlog: async () => [company('9')],
    launch: async (_row, next) => { opts = next; },
  });
  await autoContact.tick();
  assert.equal(opts?.autoQueued, true);
}));

test('AUTO_CONTACT_PAUSED holds the queue with a live worker and backlog, and lifts when unset', () => withEnv({}, async () => {
  let launched = 0;
  autoContact.init({ liveTypes: live, backlog: async () => [company('held')], launch: async () => { launched++; } });
  process.env.AUTO_CONTACT_PAUSED = '1';
  try {
    assert.equal(autoContact.pausedByHand(), true);
    assert.equal(await autoContact.tick(), 0);
    assert.equal(launched, 0);
  } finally {
    delete process.env.AUTO_CONTACT_PAUSED;
  }
  assert.equal(autoContact.pausedByHand({ AUTO_CONTACT_PAUSED: 'no' }), false);
  assert.equal(await autoContact.tick(), 1);
  assert.equal(launched, 1);
}));
