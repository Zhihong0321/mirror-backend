// Step 2 Worker: runs list processing step 2 on this Windows PC, beside the hub.
//
// It asks the hub for a batch of step-2 leads, works each one with the same
// processLead the hub runs (src/list-step2.ts: the website read again for a
// contact form, emails, MX hosting, phone types, social links), on this PC's
// own internet line, and sends each result back as soon as it is ready. Each
// slot takes its next lead as soon as it is free, so one slow lead or send never
// holds up the others. Only outbound requests. When no step-2 job is running it
// asks again every minute, so it shares the work whenever the PC is on and a job is running.
//
// It holds the Gmap worker key (an HMAC of LAB_TOKEN that reaches only the
// worker routes), never LAB_TOKEN. A machine that already holds LAB_TOKEN (the
// Mac mini) may use it instead. Settings: %LOCALAPPDATA%\Step2Worker\worker.env on
// Windows, ~/.step2-worker/worker.env elsewhere, or the file STEP2_WORKER_ENV names:
//   LAB_URL=https://ee-auto.up.railway.app
//   GMAP_WORKER_KEY=...                (or LAB_TOKEN=...)
//   WORKER_NAME=pc-<computer name>     (optional)
//   CONCURRENCY=6                      (optional: leads worked at once)
// A lead this PC took and never answered (it went offline) goes back to the
// hub or another PC when its 15-minute lease ends; nothing is lost.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { makeReader, WORKER_BATCH_MAX, type Reader } from '../src/list-step2.ts';

const DATA = process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Step2Worker') : path.join(os.homedir(), '.step2-worker');
const LOG = path.join(DATA, 'worker.log');
const IDLE_MS = 60_000;
fs.mkdirSync(DATA, { recursive: true });

function log(message: string): void {
  const line = `[${new Date().toISOString().replace('T', ' ').slice(0, 19)}] ${message}`;
  console.log(line);
  try {
    if (fs.existsSync(LOG) && fs.statSync(LOG).size > 5_000_000) fs.renameSync(LOG, LOG + '.old');
    fs.appendFileSync(LOG, line + '\n');
  } catch { /* the console still has it */ }
}

function settings(): Record<string, string> {
  const file = process.env.STEP2_WORKER_ENV ?? path.join(DATA, 'worker.env');
  const out: Record<string, string> = {};
  if (!fs.existsSync(file)) return out;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m) out[m[1]!] = m[2]!.replace(/^["']|["']$/g, '');
  }
  return out;
}

const env = settings();
const LAB_URL = (env.LAB_URL ?? '').replace(/\/+$/, '');
const KEY = env.GMAP_WORKER_KEY || env.LAB_TOKEN || '';
const WORKER = env.WORKER_NAME || 'pc-' + os.hostname().toLowerCase().replace(/[^a-z0-9.-]+/g, '-');
const CONCURRENCY = Math.max(1, Math.min(20, Number(env.CONCURRENCY) || 6));
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const SEND_MS = 60_000;

/** A hub request that gets no answer in a minute is dropped, so the caller can try again. */
async function post(route: string, body: Record<string, unknown>): Promise<any> {
  const res = await fetch(LAB_URL + route, {
    method: 'POST',
    headers: { authorization: 'Bearer ' + KEY, 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(SEND_MS),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
  return JSON.parse(text);
}

/** One lead, its answer sent back; a send that fails is tried twice more, then left to the lease. */
async function work(lead: any, reader: Reader): Promise<boolean> {
  const result = await reader.read(lead);
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await post('/api/list-step2/worker/done', { worker: WORKER, job_id: lead.job_id, place_key: lead.place_key, result });
      return true;
    } catch (err) {
      log(`could not send ${lead.business?.name ?? lead.place_key}: ${(err as Error).message}`);
      await sleep(10_000 * attempt);
    }
  }
  return false;
}

// Leads waiting for a free slot. Each slot takes the next one as soon as it is
// free, so a slow page or a slow send holds up only its own slot. The queue is
// topped up from the hub while the slots still have work in hand.
const queue: any[] = [];
let refill: Promise<void> | null = null;
let idle = false;

async function fill(): Promise<void> {
  try {
    const leads = (await post('/api/list-step2/worker/take', { worker: WORKER, limit: Math.min(WORKER_BATCH_MAX, CONCURRENCY * 2) })).leads ?? [];
    if (leads.length) {
      idle = false;
      queue.push(...leads);
      return;
    }
    if (!idle) log('no step-2 work running; asking again every minute');
    idle = true;
  } catch (err) {
    log('could not reach the hub: ' + (err as Error).message);
  }
  await sleep(IDLE_MS);
}

async function nextLead(): Promise<any> {
  for (;;) {
    if (queue.length <= CONCURRENCY && !refill) refill = fill().finally(() => { refill = null; });
    if (queue.length) return queue.shift();
    await refill;
  }
}

async function main(): Promise<void> {
  if (!LAB_URL || !KEY) {
    log(`no LAB_URL, or no GMAP_WORKER_KEY or LAB_TOKEN, in ${process.env.STEP2_WORKER_ENV ?? path.join(DATA, 'worker.env')}; nothing to do`);
    process.exit(2);
  }
  log(`Step 2 Worker ${WORKER}: ${CONCURRENCY} leads at a time, hub ${LAB_URL}`);
  let total = 0;
  let recent = 0;
  let since = Date.now();
  // One thread per slot reads the pages, so a freak page can stall only its thread, never this loop.
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    const reader = makeReader();
    for (;;) {
      const lead = await nextLead();
      try { if (await work(lead, reader)) { total++; recent++; } }
      catch (err) { log(`${lead.business?.name ?? lead.place_key}: ${(err as Error).message}`); }
      if (Date.now() - since >= 60_000) {
        log(`${recent} leads done in the last ${Math.round((Date.now() - since) / 1000)} s (${total} since start)`);
        recent = 0;
        since = Date.now();
      }
    }
  }));
}

process.on('unhandledRejection', (err) => log('unhandled: ' + ((err as Error)?.message ?? String(err))));
void main();
