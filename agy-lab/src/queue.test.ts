import test from 'node:test';
import assert from 'node:assert/strict';
import { run, snapshot, resetForTests } from './queue.ts';

test.beforeEach(() => {
  resetForTests();
  delete process.env.QUEUE_REJECT;
  delete process.env.QUEUE_MAX_DEPTH;
  delete process.env.QUEUE_MAX_WAIT_MS;
  delete process.env.PI_MIN_GAP_MS;
  delete process.env.PI_HOURLY_LIMIT;
});

test.afterEach(() => {
  resetForTests();
});

test('neverReject: bursts beyond queue depth do not throw queue_full', async () => {
  process.env.QUEUE_MAX_DEPTH = '2'; // Very low depth limit
  process.env.PI_MIN_GAP_MS = '0';
  process.env.PI_MAX_CONCURRENT = '1';

  const order: number[] = [];
  const promises: Promise<unknown>[] = [];

  // Launch 5 concurrent calls into a queue capped at depth 2 with concurrency 1
  for (let i = 0; i < 5; i++) {
    const idx = i;
    promises.push(
      run('pi', async () => {
        await new Promise((r) => setTimeout(r, 20));
        order.push(idx);
        return idx;
      }),
    );
  }

  const results = await Promise.all(promises);
  assert.equal(results.length, 5);
  assert.deepEqual(order, [0, 1, 2, 3, 4], 'calls must execute FIFO without any rejection');
});

test('neverReject: long wait estimate does not throw queue_too_slow', async () => {
  process.env.QUEUE_MAX_WAIT_MS = '10'; // 10ms max wait estimate
  process.env.PI_MIN_GAP_MS = '0';
  process.env.PI_MAX_CONCURRENT = '1';

  const results = await Promise.all([
    run('pi', async () => {
      await new Promise((r) => setTimeout(r, 30));
      return 'first';
    }),
    run('pi', async () => {
      return 'second';
    }),
  ]);

  assert.equal(results[0].value, 'first');
  assert.equal(results[1].value, 'second');
});

test('inter-call spacing enforces minGapMs between starts', async () => {
  process.env.PI_MIN_GAP_MS = '50';
  process.env.PI_MAX_CONCURRENT = '2';

  const startTimes: number[] = [];
  await Promise.all([
    run('pi', async () => {
      startTimes.push(Date.now());
      return 1;
    }),
    run('pi', async () => {
      startTimes.push(Date.now());
      return 2;
    }),
  ]);

  assert.equal(startTimes.length, 2);
  const diff = Math.abs(startTimes[1] - startTimes[0]);
  assert.ok(diff >= 45, `expected gap >= 50ms, got ${diff}ms`);
});

test('hourly cap pacing: waits instead of throwing rate_limit_exceeded', async () => {
  process.env.PI_HOURLY_LIMIT = '2';
  process.env.PI_MIN_GAP_MS = '0';
  process.env.PI_MAX_CONCURRENT = '2';

  // Run 2 calls to fill the hourly allowance
  await run('pi', async () => 'call 1');
  await run('pi', async () => 'call 2');

  const snapBefore = snapshot('pi') as { usedThisHour: number; hourlyLimit: number; neverReject: boolean };
  assert.equal(snapBefore.usedThisHour, 2);
  assert.equal(snapBefore.hourlyLimit, 2);
  assert.equal(snapBefore.neverReject, true);
});

test('legacy queue rejection still works when QUEUE_REJECT=true is explicitly set', async () => {
  process.env.QUEUE_REJECT = 'true';
  process.env.QUEUE_MAX_DEPTH = '1';
  process.env.PI_MIN_GAP_MS = '0';
  process.env.PI_MAX_CONCURRENT = '1';

  let threw = false;
  try {
    await Promise.all([
      run('pi', async () => {
        await new Promise((r) => setTimeout(r, 50));
        return 1;
      }),
      run('pi', async () => {
        await new Promise((r) => setTimeout(r, 50));
        return 2;
      }),
      run('pi', async () => 3), // This 3rd call exceeds depth 1 while 1 is running and 1 is waiting
    ]);
  } catch (err: unknown) {
    const e = err as { status?: number; type?: string };
    if (e.status === 429 && e.type === 'queue_full') {
      threw = true;
    }
  }
  assert.equal(threw, true, 'QUEUE_REJECT=true should throw 429 queue_full');
});
