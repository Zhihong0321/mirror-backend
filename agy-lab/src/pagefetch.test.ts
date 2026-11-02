import test from 'node:test';
import assert from 'node:assert/strict';
import * as pagefetch from './pagefetch.ts';

type Job = { id: string; status: string; result: unknown; error: string | null; worker: string | null };

/** A broker stand-in: records what was created and answers with a job you set up. */
function broker(opts: { types?: string[]; answer?: Partial<Job>; status?: string } = {}) {
  const created: Array<{ type: string; payload: any; timeoutMs: number }> = [];
  const cancelled: string[] = [];
  return {
    created,
    cancelled,
    liveTypes: () => opts.types ?? ['fetch.pages'],
    create(type: string, payload: unknown, timeoutMs = 0) {
      created.push({ type, payload, timeoutMs });
      return { id: 'job1' } as any;
    },
    async wait() {
      return { id: 'job1', status: opts.status ?? 'done', result: null, error: null, worker: 'mini-fetch', ...opts.answer } as any;
    },
    cancel(id: string) { cancelled.push(id); return null as any; },
  };
}

test('with no fetch worker checked in, the read refuses instead of reading nothing', async () => {
  const b = broker({ types: ['gmap.scan'] });
  await assert.rejects(
    () => pagefetch.read(['https://a.test/'], { broker: b }),
    (err: Error & { code?: string }) => err.code === 'not_installed' && /no fetch\.pages worker/.test(err.message),
  );
  assert.equal(b.created.length, 0, 'no job is queued for a worker that is not there');
});

test('pages come back in Tavily /extract shape, and cost nothing', async () => {
  const b = broker({ answer: { result: { pages: [{ url: 'https://a.test/', markdown: '# A' }], failed: [] } } });
  const out = await pagefetch.read(['https://a.test/'], { broker: b });
  assert.deepEqual(out.results, [{ url: 'https://a.test/', raw_content: '# A' }]);
  assert.deepEqual(out.failed_results, []);
  assert.equal(out.usage.credits, 0);
  assert.equal(out.worker, 'mini-fetch');
  assert.equal(b.created[0]!.type, 'fetch.pages');
  assert.deepEqual(b.created[0]!.payload.urls, ['https://a.test/']);
});

test('a page the worker could not read is a failed_result, not a thrown error', async () => {
  const b = broker({ answer: { result: {
    pages: [{ url: 'https://ok.test/', markdown: 'text' }],
    failed: [{ url: 'https://dead.test/', error: 'the host does not resolve' }],
  } } });
  const out = await pagefetch.read(['https://ok.test/', 'https://dead.test/'], { broker: b });
  assert.equal(out.results.length, 1);
  assert.deepEqual(out.failed_results, [{ url: 'https://dead.test/', error: 'the host does not resolve' }]);
});

test('a URL the worker never mentioned is still accounted for', async () => {
  const b = broker({ answer: { result: { pages: [{ url: 'https://a.test/', markdown: 'text' }], failed: [] } } });
  const out = await pagefetch.read(['https://a.test/', 'https://forgotten.test/'], { broker: b });
  assert.deepEqual(out.failed_results, [{ url: 'https://forgotten.test/', error: 'the worker returned nothing for this URL' }]);
});

test('a page with a URL but no text is not passed off as read', async () => {
  const b = broker({ answer: { result: { pages: [{ url: 'https://a.test/', markdown: '   ' }], failed: [] } } });
  const out = await pagefetch.read(['https://a.test/'], { broker: b });
  assert.deepEqual(out.results, []);
  assert.equal(out.failed_results.length, 1);
});

test('a batch that never came back is cancelled, not left to run its lease out', async () => {
  const b = broker({ status: 'running' });
  await assert.rejects(
    () => pagefetch.read(['https://a.test/'], { broker: b, timeoutMs: 1_000 }),
    (err: Error & { code?: string }) => err.code === 'timeout',
  );
  assert.deepEqual(b.cancelled, ['job1']);
});

test('a worker failure is the read failing, not an empty page', async () => {
  const b = broker({ status: 'failed', answer: { status: 'failed', error: 'crawl4ai is not answering' } });
  await assert.rejects(
    () => pagefetch.read(['https://a.test/'], { broker: b }),
    (err: Error & { code?: string }) => err.code === 'engine_error' && /crawl4ai is not answering/.test(err.message),
  );
});

test('duplicates collapse and the batch is capped at Tavily\'s own ceiling', async () => {
  const b = broker({ answer: { result: { pages: [], failed: [] } } });
  const many = Array.from({ length: 30 }, (_, i) => `https://a.test/${i}`);
  await pagefetch.read([...many, 'https://a.test/0', ' '], { broker: b });
  const sent: string[] = b.created[0]!.payload.urls;
  assert.equal(sent.length, pagefetch.MAX_URLS);
  assert.equal(new Set(sent).size, pagefetch.MAX_URLS);
});

test('no URLs asks the broker for nothing', async () => {
  const b = broker();
  const out = await pagefetch.read([], { broker: b });
  assert.deepEqual(out, { results: [], failed_results: [], usage: { credits: 0 }, worker: null });
  assert.equal(b.created.length, 0);
});

test('the batch ceiling grows with the page count and is bounded', () => {
  assert.ok(pagefetch.batchMs(1) < pagefetch.batchMs(20), 'twenty pages get longer than one');
  assert.equal(pagefetch.batchMs(10_000), pagefetch.batchMs(20_000), 'and it stops growing somewhere');
});
