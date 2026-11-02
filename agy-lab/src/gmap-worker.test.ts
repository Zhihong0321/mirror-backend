import test from 'node:test';
import assert from 'node:assert/strict';
import type http from 'node:http';
import zlib from 'node:zlib';
import { isJobRoute, isWorkerKey, JOB_TYPES, packageZip, strategy, workerKey, zip } from './gmap-worker.ts';
import { create, finish, handle, take } from './jobs.ts';

const TOKEN = 'lab-secret-123456789';

/** Every entry of a zip, inflated, read back through its central directory. */
function unzip(buf: Buffer): Map<string, Buffer> {
  const out = new Map<string, Buffer>();
  const end = buf.length - 22;
  assert.equal(buf.readUInt32LE(end), 0x06054b50);
  let at = buf.readUInt32LE(end + 16);
  for (let i = 0; i < buf.readUInt16LE(end + 10); i++) {
    assert.equal(buf.readUInt32LE(at), 0x02014b50);
    const crc = buf.readUInt32LE(at + 16);
    const size = buf.readUInt32LE(at + 20);
    const nameLen = buf.readUInt16LE(at + 28);
    const local = buf.readUInt32LE(at + 42);
    const name = buf.subarray(at + 46, at + 46 + nameLen).toString('utf8');
    const start = local + 30 + buf.readUInt16LE(local + 26);
    const data = zlib.inflateRawSync(buf.subarray(start, start + size));
    assert.equal(zlib.crc32(data), crc, name + ' crc');
    out.set(name, data);
    at += 46 + nameLen;
  }
  return out;
}

test('the worker key is derived from LAB_TOKEN and is not LAB_TOKEN', () => {
  const key = workerKey(TOKEN);
  assert.match(key, /^[a-f0-9]{64}$/);
  assert.notEqual(key, TOKEN);
  assert.equal(isWorkerKey(key, TOKEN), true);
  assert.equal(isWorkerKey(TOKEN, TOKEN), false, 'LAB_TOKEN itself is not a worker key');
  assert.equal(isWorkerKey(workerKey('another-token-1234567'), TOKEN), false);
  assert.equal(isWorkerKey(workerKey('short'), 'short'), false, 'no key without a real LAB_TOKEN');
});

test('a worker key reaches only claim, heartbeat and result', () => {
  assert.equal(isJobRoute('GET', '/api/jobs/next'), true);
  assert.equal(isJobRoute('POST', '/api/jobs/heartbeat'), true);
  assert.equal(isJobRoute('POST', '/api/jobs/0123456789ab/result'), true);
  assert.equal(isJobRoute('POST', '/api/jobs'), false);
  assert.equal(isJobRoute('GET', '/api/jobs'), false);
  assert.equal(isJobRoute('GET', '/api/jobs/0123456789ab'), false);
});

test('the package unzips to the worker folder, with Windows line endings and the key', () => {
  const files = unzip(packageZip('https://ee-auto.up.railway.app/', TOKEN));
  assert.deepEqual([...files.keys()].sort(), [
    'GmapWorker/Disable autostart.cmd', 'GmapWorker/Enable autostart.cmd', 'GmapWorker/README.txt',
    'GmapWorker/Start Gmap Worker.cmd', 'GmapWorker/app/worker.ps1', 'GmapWorker/worker.env',
  ]);
  const env = files.get('GmapWorker/worker.env')!.toString('utf8');
  assert.match(env, /^LAB_URL=https:\/\/ee-auto\.up\.railway\.app\r$/m);
  assert.ok(env.includes('GMAP_WORKER_KEY=' + workerKey(TOKEN) + '\r\n'));
  assert.ok(!env.includes(TOKEN), 'LAB_TOKEN never goes into the package');
  const script = files.get('GmapWorker/app/worker.ps1')!;
  assert.deepEqual([...script.subarray(0, 3)], [0xef, 0xbb, 0xbf], 'PowerShell 5.1 needs the BOM');
  assert.ok(!/[^\r]\n/.test(script.toString('utf8')), 'every line ends CRLF');
  assert.ok(!/[^\x00-\x7f]/.test(script.subarray(3).toString('utf8')), 'the script stays ASCII');
});

test('zip stores what it was given', () => {
  const files = unzip(zip([{ name: 'a/b.txt', data: Buffer.from('hello hello hello') }, { name: 'c', data: Buffer.alloc(0) }]));
  assert.equal(files.get('a/b.txt')!.toString(), 'hello hello hello');
  assert.equal(files.get('c')!.length, 0);
});

test('the strategy hands the bridge the hub sweep words', () => {
  const s = strategy() as { families: Record<string, string[]>; streetForms: string[] };
  assert.ok(s.families.business!.length > 40);
  assert.deepEqual(Object.keys(s.families).sort(), ['business', 'factory', 'shop']);
  assert.deepEqual(s.streetForms, ['shop', 'company']);
});

/** One broker call as server.ts makes it for a worker key. */
async function scoped(method: string, path: string, body: Record<string, unknown> = {}): Promise<{ status: number; body: Record<string, unknown> | null }> {
  let status = 0;
  let sent: Record<string, unknown> | null = null;
  const req = { method, headers: {}, socket: { remoteAddress: '203.0.113.9' } } as unknown as http.IncomingMessage;
  const res = { writableEnded: false, on: () => {}, writeHead: (code: number) => { status = code; },
    end: () => { res.writableEnded = true; } } as unknown as http.ServerResponse;
  await handle(req, res, new URL('http://lab' + path), {
    json: (_res, code, payload) => { status = code; sent = payload as Record<string, unknown>; },
    readJson: async () => body,
    scope: { types: JOB_TYPES },
  });
  return { status, body: sent };
}

test('a scoped claim is never handed anything but gmap.scan', async () => {
  const other = create('fb.company', { name: 'x' }, 60_000);
  const got = await scoped('GET', '/api/jobs/next?worker=pc-scope-1&types=fb.company&wait=0');
  assert.equal(got.status, 204, 'asking for another type gets nothing');
  assert.equal(other.status, 'pending');
  finish(other.id, false, null, 'test');
});

test('a scoped key answers only the gmap.scan job its own worker holds', async () => {
  const job = create('gmap.scan', { keyword: 'factory', place: 'Taman Scope' }, 60_000);
  assert.equal((await take('scan-elsewhere', { types: ['gmap.scan'], waitMs: 0 }))?.id, job.id);
  const stolen = await scoped('POST', `/api/jobs/${job.id}/result`, { worker: 'pc-scope-2', ok: true, result: { businesses: [] } });
  assert.equal(stolen.status, 403);
  assert.equal(job.status, 'running');
  finish(job.id, true, {}, null);

  const fb = create('fb.company', { name: 'y' }, 60_000);
  assert.equal((await take('pc-scope-2', { types: ['fb.company'], waitMs: 0 }))?.id, fb.id);
  assert.equal((await scoped('POST', `/api/jobs/${fb.id}/result`, { worker: 'pc-scope-2', ok: true })).status, 403);
  finish(fb.id, false, null, 'test');
});

test('a scoped key reads pages for a dive: it claims and answers fetch.pages', async () => {
  const job = create('fetch.pages', { urls: ['https://example.com'] }, 60_000);
  const got = await scoped('GET', '/api/jobs/next?worker=pc-fetch-1&types=fetch.pages&wait=0');
  assert.equal((got.body?.job as { id?: string } | undefined)?.id, job.id);
  const answered = await scoped('POST', `/api/jobs/${job.id}/result`,
    { worker: 'pc-fetch-1', ok: true, result: { pages: [{ url: 'https://example.com', markdown: 'Example' }], failed: [] } });
  assert.equal(answered.status, 200);
  assert.equal(job.status, 'done');
});

test('a scoped result for a job the broker lost is a 404', async () => {
  const lost = await scoped('POST', '/api/jobs/0000aaaa1111/result', { worker: 'pc-scope-3', ok: true, result: { businesses: [] } });
  assert.equal(lost.status, 404);
});

test('a job pinned to a worker goes to that worker only', async () => {
  const job = create('gmap.scan', { keyword: 'factory', place: 'Taman Pin', worker: 'pc-pinned' }, 60_000);
  assert.equal(await take('scraper-tech-maps', { types: ['gmap.scan'], waitMs: 0 }), null);
  const got = await scoped('GET', '/api/jobs/next?worker=pc-pinned&types=gmap.scan&wait=0');
  assert.equal((got.body?.job as { id?: string } | undefined)?.id, job.id);
  const answered = await scoped('POST', `/api/jobs/${job.id}/result`, { worker: 'pc-pinned', ok: true, result: { businesses: [] } });
  assert.equal(answered.status, 200);
  assert.equal(job.status, 'done');
});

test('a pinned job created while its worker waits is handed straight to it', async () => {
  const waiting = take('pc-waiting', { types: ['gmap.scan'], waitMs: 2_000 });
  const elsewhere = take('scraper-tech-maps-9', { types: ['gmap.scan'], waitMs: 50 });
  const job = create('gmap.scan', { keyword: 'shop', place: 'Taman Wait', worker: 'pc-waiting' }, 60_000);
  assert.equal((await waiting)?.id, job.id);
  assert.equal(await elsewhere, null);
  finish(job.id, true, {}, null);
});
