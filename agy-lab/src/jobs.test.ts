import test from 'node:test';
import assert from 'node:assert/strict';
import type http from 'node:http';
import { activate, coolDown, create, finish, get, handle, liveTypes, quotaRetryAfterMs, snapshot, take, wait } from './jobs.ts';

const ASK_TYPES = ['fb.person', 'x.subject', 'fb.company'];

/** POST /api/jobs/heartbeat exactly as worker/macmini.mjs sends it. */
async function heartbeat(worker: string, types: string[]): Promise<unknown> {
  let captured: unknown = null;
  const req = {
    method: 'POST', headers: {}, socket: { remoteAddress: '203.0.113.7' },
  } as unknown as http.IncomingMessage;
  const handled = await handle(req, {} as http.ServerResponse, new URL('http://lab/api/jobs/heartbeat'), {
    json: (_res, _status, body) => { captured = body; },
    readJson: async () => ({ worker, types }),
  });
  assert.equal(handled, true);
  return captured;
}

test('a job keeps its short lease when the payload budget is longer', () => {
  const job = create('fb.person', { prompt: 'audit', timeoutMs: 300_000 }, 120_000);
  assert.equal(job.timeoutMs, 120_000);
});

test('a beat registers a worker the table has never seen, types and all', async () => {
  // The redeploy case. Railway restarting empties the worker table while the
  // mini is mid-job, so the beat has to be able to introduce the lane from
  // nothing — re-registering the name alone would read as "serving nothing".
  assert.equal(liveTypes().includes('fb.company'), false);
  await heartbeat('macmini-fb', ASK_TYPES);
  for (const type of ASK_TYPES) assert.equal(liveTypes().includes(type), true);
});

test('a beat keeps a busy lane live past the window that dropped it', async () => {
  await heartbeat('macmini-busy', ['gmap.scan']);
  await new Promise((r) => setTimeout(r, 25));
  // `withinMs` stands in for elapsed time: 10ms ago is the 90s cliff a lane used
  // to fall off while it was three minutes into a research ask it had claimed.
  assert.equal(liveTypes(10).includes('gmap.scan'), false, 'silence must still age a lane out');
  await heartbeat('macmini-busy', ['gmap.scan']);
  assert.equal(liveTypes(10).includes('gmap.scan'), true, 'a beat must refresh it');
});

test('a beat without a worker name is refused', async () => {
  let status = 0;
  const req = { method: 'POST', headers: {}, socket: {} } as unknown as http.IncomingMessage;
  await handle(req, {} as http.ServerResponse, new URL('http://lab/api/jobs/heartbeat'), {
    json: (_res, code) => { status = code; },
    readJson: async () => ({ types: ASK_TYPES }),
  });
  assert.equal(status, 400);
});

test('a quota result cools down every lane sharing the account and stops claims', async () => {
  const type = 'quota-test.ask';
  const group = 'quota-test:account';
  for (const worker of ['quota-test-1', 'quota-test-2']) {
    const req = { method: 'POST', headers: {}, socket: {} } as unknown as http.IncomingMessage;
    await handle(req, {} as http.ServerResponse, new URL('http://lab/api/jobs/heartbeat'), {
      json: () => {},
      readJson: async () => ({ worker, types: [type], cooldownGroup: group }),
    });
  }

  const first = create(type, {});
  assert.equal((await take('quota-test-1', { types: [type], waitMs: 0 }))?.id, first.id);
  const second = create(type, {});
  const waiting = take('quota-test-2', { types: ['quota-test.other'], waitMs: 5_000 });
  const req = { method: 'POST', headers: {}, socket: {} } as unknown as http.IncomingMessage;
  let result: Record<string, unknown> = {};
  await handle(req, {} as http.ServerResponse, new URL(`http://lab/api/jobs/${first.id}/result`), {
    json: (_res, _status, body) => { result = body as Record<string, unknown>; },
    readJson: async () => ({ worker: 'quota-test-1', ok: false,
      error: 'quota_reached: Individual quota reached. Resets in 1h37m47s.',
      errorCode: 'quota_reached', retryAfterMs: 5_872_000 }),
  });
  assert.equal((await waiting), null, 'an existing long poll must be released');
  assert.equal(typeof result.cooldownUntil, 'string');
  assert.equal(liveTypes().includes(type), false);
  assert.equal((await take('quota-test-2', { types: [type], waitMs: 0 })), null);
  assert.equal(second.status, 'pending');
  const lanes = snapshot().workers.filter((w) => w.name.startsWith('quota-test-'));
  assert.equal(lanes.length, 2);
  assert.ok(lanes.every((w) => w.cooldownUntil === result.cooldownUntil));
  finish(second.id, false, null, 'test cleanup');
});

test('a worker can claim pending work when its cooldown expires', async () => {
  const worker = 'quota-expiry';
  const type = 'quota-expiry.ask';
  await heartbeat(worker, [type]);
  const job = create(type, {});
  assert.ok(coolDown(worker, 20, 'test quota'));
  assert.equal((await take(worker, { types: [type], waitMs: 0 })), null);
  await new Promise((r) => setTimeout(r, 30));
  assert.equal((await take(worker, { types: [type], waitMs: 0 }))?.id, job.id);
  finish(job.id, true, {}, null);
});

test('contact work stays running after its former lease and accepts a late answer', async () => {
  const job = create('research.contact', { name: 'Example' }, 1_000);
  assert.equal(job.timeoutMs, 0);
  assert.equal((await take('research-pc-1', { types: ['research.contact'], waitMs: 0 }))?.id, job.id);
  job.startedAt = new Date(Date.now() - 2_000).toISOString();
  assert.equal(get(job.id)?.status, 'running');
  assert.equal(job.attempts, 1);
  assert.equal(await take('research-pc-2', { types: ['research.contact'], waitMs: 0 }), null);
  finish(job.id, true, { decision_makers: [{ name: 'Late' }] }, null);
  assert.equal(job.status, 'done');
});

test('contact work is claimable only after its saved report has the job id', async () => {
  const job = create('research.contact', { name: 'Example' }, 1_000, false);
  assert.equal(await take('research-pc-1', { types: ['research.contact'], waitMs: 0 }), null);
  activate(job.id);
  assert.equal((await take('research-pc-1', { types: ['research.contact'], waitMs: 0 }))?.id, job.id);
  const settled = wait(job.id, 0);
  finish(job.id, true, {}, null);
  assert.equal((await settled)?.status, 'done');
});

test('old workers cannot claim contact work, while durable workers can', async () => {
  const job = create('research.contact', { name: 'Example' }, 0);
  const claim = async (protocol: string | null): Promise<string | null> => {
    let sent: Record<string, unknown> | null = null;
    const req = { method: 'GET', headers: {}, socket: { remoteAddress: '203.0.113.7' } } as unknown as http.IncomingMessage;
    const res = { writableEnded: false, on: () => {}, writeHead: () => {},
      end: () => { res.writableEnded = true; } } as unknown as http.ServerResponse;
    const url = new URL('http://lab/api/jobs/next?worker=research-pc&types=research.contact&wait=0');
    if (protocol) url.searchParams.set('contactProtocol', protocol);
    await handle(req, res, url, { json: (_res, _status, body) => { sent = body as Record<string, unknown>; }, readJson: async () => ({}) });
    return (sent?.job as { id: string } | undefined)?.id ?? null;
  };
  assert.equal(await claim(null), null);
  assert.equal(job.status, 'pending');
  assert.equal(await claim('durable-v1'), job.id);
  finish(job.id, true, {}, null);
});

test('a cooling worker heartbeat restores the visible deadline and blocks claims', async () => {
  const worker = 'quota-heartbeat-worker';
  const type = 'quota-heartbeat.ask';
  const until = new Date(Date.now() + 5_825_000).toISOString();
  let response: { worker?: { status?: string; cooldownUntil?: string } } = {};
  const req = { method: 'POST', headers: {}, socket: {} } as unknown as http.IncomingMessage;
  await handle(req, {} as http.ServerResponse, new URL('http://lab/api/jobs/heartbeat'), {
    json: (_res, _status, body) => { response = body as typeof response; },
    readJson: async () => ({ worker, types: [type], cooldownGroup: 'quota-heartbeat:account',
      cooldownUntil: until, cooldownReason: 'Individual quota reached' }),
  });
  assert.ok(Math.abs(Date.parse(response.worker?.cooldownUntil ?? '') - Date.parse(until)) < 50);
  const visible = snapshot().workers.find((w) => w.name === worker);
  assert.equal(visible?.status, 'cooldown');
  assert.equal(visible?.cooldownReason, 'Individual quota reached');
  assert.ok((visible?.cooldownRemainingMs ?? 0) > 5_800_000);
  assert.equal(liveTypes().includes(type), false);
  assert.equal(await take(worker, { types: [type], waitMs: 0 }), null);
});

test('the snapshot joins a running job to the worker that claimed it', async () => {
  const worker = 'dashboard-join-worker';
  const type = 'dashboard-join.ask';
  await heartbeat(worker, [type]);
  const job = create(type, { keyword: 'solar', place: 'Johor' });
  assert.equal((await take(worker, { types: [type], waitMs: 0 }))?.id, job.id);

  const running = snapshot();
  const lane = running.workers.find((item) => item.name === worker);
  assert.ok(lane);
  assert.equal(lane.status, 'online');
  assert.equal(running.counts.running >= 1, true);

  // This is the exact join performed by workers.ts in the browser.
  const claimed = running.jobs.find((item) => item.status === 'running' && item.worker === worker);
  assert.equal(claimed?.id, job.id);
  assert.equal(claimed?.type, type);
  assert.equal(typeof claimed?.startedAt, 'string');
  assert.deepEqual(claimed?.payload, { keyword: 'solar', place: 'Johor' });

  finish(job.id, true, { found: 3 }, null);
  const finished = snapshot();
  assert.equal(finished.jobs.some((item) => item.status === 'running' && item.worker === worker), false);
  assert.equal(finished.jobs.find((item) => item.id === job.id)?.status, 'done');
  assert.equal(finished.workers.find((item) => item.name === worker)?.done, 1);
});

test('m4-mini answers only country research and search list Maps searches, and no longer country jobs', async () => {
  const job = create('gmap.scan', { keyword: 'factory', place: 'Taman Daya' }, 60_000);
  const city = create('gmap.scan', { keyword: 'advertising agency', place: 'Ipoh, Perak, Malaysia', source: 'country.industry' }, 60_000);
  const listed = create('gmap.scan', { keyword: 'Ipoh Accounting firm Malaysia', source: 'search.list' }, 60_000);
  const claim = async (worker: string): Promise<string | null> => {
    let sent: Record<string, unknown> | null = null;
    const req = { method: 'GET', headers: {}, socket: { remoteAddress: '203.0.113.7' } } as unknown as http.IncomingMessage;
    const res = { writableEnded: false, on: () => {}, writeHead: () => {},
      end: () => { res.writableEnded = true; } } as unknown as http.ServerResponse;
    const url = new URL(`http://lab/api/jobs/next?worker=${worker}&types=ping,gmap.scan&wait=0`);
    await handle(req, res, url, { json: (_res, _status, body) => { sent = body as Record<string, unknown>; }, readJson: async () => ({}) });
    return (sent?.job as { id: string } | undefined)?.id ?? null;
  };
  // The business scan was queued first, but the mini is handed the city search.
  assert.equal(await claim('m4-mini'), city.id);
  assert.equal(await claim('m4-mini'), listed.id);
  assert.equal(job.status, 'pending');
  assert.equal(await claim('m4-mini'), null, 'never a business scan or taman scan');
  // Any other machine still takes the scan.
  assert.equal(await claim('scan-host'), job.id);
  finish(job.id, true, {}, null);
  finish(city.id, true, {}, null);
  await heartbeat('m4-mini-country', ['country.industry']);
  assert.ok(!(snapshot().workers.find((w) => w.name === 'm4-mini-country')?.types ?? []).includes('country.industry'), 'the hub runs country jobs now');
});

test('country research heartbeat renews only the current worker lease', async () => {
  const job = create('country.industry', {country:'Malaysia',industry:'advertising'}, 1000);
  assert.equal((await take('country-owner',{types:['country.industry'],waitMs:0}))?.id,job.id);
  const req = {method:'POST',headers:{},socket:{}} as unknown as http.IncomingMessage;
  const res = {} as http.ServerResponse;
  const call = async (worker:string) => handle(req,res,new URL('http://lab/api/jobs/heartbeat'),{json:()=>{},readJson:async()=>({worker,types:['country.industry'],jobId:job.id})});
  job.startedAt = new Date(Date.now()-2000).toISOString();
  job.leaseUpdatedAt = new Date(Date.now()-500).toISOString();
  const before = job.leaseUpdatedAt;
  await call('other-worker');
  assert.equal(job.leaseUpdatedAt, before);
  await call('country-owner');
  assert.ok(Date.now()-Date.parse(job.leaseUpdatedAt!)<1000);
  assert.equal(get(job.id)?.status,'running');
  finish(job.id,true,{},null);
});

test('country progress requires the current lease holder', async () => {
  const job=create('country.industry',{country:'Malaysia',industry:'advertising'});
  await take('progress-owner',{types:['country.industry'],waitMs:0});
  const req={method:'POST',headers:{},socket:{}} as unknown as http.IncomingMessage;
  let status=0;let output:any;
  const send=async(worker:string)=>handle(req,{} as http.ServerResponse,new URL('http://lab/api/jobs/'+job.id+'/progress'),{json:(_r,s,b)=>{status=s;output=b;},readJson:async()=>({worker,progress:{phase:'maps',completed:3,total:10,message:'Searching'}})});
  await send('wrong-worker');assert.equal(status,409);assert.equal(job.progress,undefined);
  await send('progress-owner');assert.equal(status,200);assert.equal(output.progress.completed,3);assert.equal(get(job.id)?.progress?.total,10);
  finish(job.id,true,{},null);
});

test('country CSV stays available on its job without inflating the job-list response', async()=>{
  const job=create('country.industry',{country:'Malaysia',industry:'advertising'});
  await take('csv-owner',{types:['country.industry'],waitMs:0});
  finish(job.id,true,{filename:'report.csv',csv:'name,email\nExample,a@example.com\n'},null);
  const listed=snapshot().jobs.find(j=>j.id===job.id)!;
  assert.equal((listed.result as any).csv,undefined);
  assert.equal((listed.result as any).csvAvailable,true);
  assert.match((get(job.id)?.result as any).csv,/a@example.com/);
});

test('country result from a stale worker cannot overwrite the active lease', async()=>{
  const job=create('country.industry',{country:'Malaysia',industry:'advertising'});
  await take('current-owner',{types:['country.industry'],waitMs:0});
  const req={method:'POST',headers:{},socket:{}} as unknown as http.IncomingMessage;
  let status=0;
  await handle(req,{} as http.ServerResponse,new URL('http://lab/api/jobs/'+job.id+'/result'),{json:(_r,s)=>{status=s;},readJson:async()=>({worker:'stale-owner',ok:true,result:{csv:'wrong'}})});
  assert.equal(status,409);assert.equal(get(job.id)?.status,'running');assert.equal(get(job.id)?.result,null);
  finish(job.id,true,{csv:'correct'},null);
});

test('imports a completed country report without offering it to a worker', async () => {
  const req = { method: 'POST', headers: {}, socket: {} } as unknown as http.IncomingMessage;
  let status = 0, result: any;
  await handle(req, {} as http.ServerResponse, new URL('http://lab/api/jobs/import-country'), {
    json: (_res, code, body) => {status=code;result=body;},
    readJson: async () => ({country:'West Malaysia',industry:'advertising',filename:'report.csv',csv:'name,website,emails,research_status\n',summary:{processed:0}}),
  });
  assert.equal(status,201);
  const job=get(result.job.id);
  assert.equal(job?.status,'done');
  assert.equal(job?.worker,null);
  assert.equal((job?.result as any).imported,true);
  assert.equal((job?.result as any).csv,'name,website,emails,research_status\n');
  assert.equal(await take('import-test-worker',{types:['country.industry'],waitMs:0}),null);
});
