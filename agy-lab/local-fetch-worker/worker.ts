// Local Fetch Worker: reads web pages on this Mac mini so the hub never pays
// Tavily to read one.
//
// WHY THIS EXISTS. A company dive's most expensive line was Tavily /extract,
// and what it sold us was a page fetched, stripped of its chrome and handed
// back as text. The only part this container could not do itself is have an
// address a website will serve — and the mini has had that all along, which is
// the whole premise of docs/plan-macmini-worker.md. So the read moves here and
// costs nothing. Crawl4AI does the fetching and the stripping; this file is the
// bridge between it and the hub's job broker, and deliberately little else.
//
// DIRECTION. The mini is behind home NAT, so the hub can never connect to it.
// This worker holds GET /api/jobs/next open for 25s and the hub answers the
// moment a `fetch.pages` job exists (src/pagefetch.ts creates them). Only
// outbound requests, no tunnel, nothing on the home router.
//
// IT STOPS ASKING WHEN CRAWL4AI IS DOWN, and that is the design, not a gap: a
// lane that kept checking in while it could not read anything would leave the
// hub believing reads are available and fail every dive. Going quiet drops this
// worker out of the hub's live table within 90s, pagefetch.available() turns
// false, and a dive says "no fetch worker" instead of "this page is empty".
//
// Settings: ~/.local-fetch-worker/worker.env, or the file LOCAL_FETCH_WORKER_ENV names:
//   LAB_URL=https://ee-auto.up.railway.app
//   LAB_TOKEN=...                      (or GMAP_WORKER_KEY=... once fetch.pages is in its scope)
//   CRAWL4AI_URL=http://127.0.0.1:11235   (optional)
//   CRAWL4AI_TOKEN=...                 (optional, only if the container has JWT on)
//   WORKER_NAME=mini-fetch             (optional)
//   LANES=2                            (optional: dives served at once)
//   PAGE_CONCURRENCY=4                 (optional: pages read at once within one job)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const DATA = path.join(os.homedir(), '.local-fetch-worker');
const LOG = path.join(DATA, 'worker.log');
fs.mkdirSync(DATA, { recursive: true });

/** The broker's long-poll ceiling. Above it the server answers 204 first. */
const WAIT_SEC = 25;
/** The hub drops a silent worker after 90s; three beats fit in that window. */
const BEAT_MS = 30_000;
const IDLE_MS = 15_000;
/** One page. Past this the page is a failed_result, not a stuck job. */
const PAGE_MS = 45_000;
/** What one page may contribute, so twenty pages cannot blow the hub's payload. */
const MAX_PAGE_CHARS = 60_000;

function log(message: string): void {
  const line = `[${new Date().toISOString().replace('T', ' ').slice(0, 19)}] ${message}`;
  console.log(line);
  try {
    if (fs.existsSync(LOG) && fs.statSync(LOG).size > 5_000_000) fs.renameSync(LOG, LOG + '.old');
    fs.appendFileSync(LOG, line + '\n');
  } catch { /* the console still has it */ }
}

function settings(): Record<string, string> {
  const file = process.env.LOCAL_FETCH_WORKER_ENV ?? path.join(DATA, 'worker.env');
  const out: Record<string, string> = {};
  if (!fs.existsSync(file)) return out;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m) out[m[1]!] = m[2]!.replace(/^["']|["']$/g, '');
  }
  return out;
}

const env = { ...settings(), ...process.env } as Record<string, string>;
const LAB = (env.LAB_URL ?? 'https://ee-auto.up.railway.app').replace(/\/+$/, '');
const TOKEN = (env.LAB_TOKEN || env.GMAP_WORKER_KEY || '').trim();
const C4AI = (env.CRAWL4AI_URL ?? 'http://127.0.0.1:11235').replace(/\/+$/, '');
const C4AI_TOKEN = (env.CRAWL4AI_TOKEN ?? '').trim();
const NAME = env.WORKER_NAME || 'fetch-' + os.hostname().toLowerCase().replace(/[^a-z0-9.-]+/g, '-');
const LANES = Math.max(1, Math.min(8, Number(env.LANES) || 2));
const PAGE_CONCURRENCY = Math.max(1, Math.min(12, Number(env.PAGE_CONCURRENCY) || 4));

const TYPES = ['fetch.pages'];
const auth = { authorization: 'Bearer ' + TOKEN };
const jsonHeaders = { ...auth, 'content-type': 'application/json' };
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// --------------------------------------------------------------- crawl4ai

type Read = { url: string; markdown: string } | { url: string; error: string };

/**
 * Crawl4AI says "URL blocked (SSRF protection)" for a host that does not
 * resolve, which reads in a dive report like we tried to crawl a router. Every
 * such answer measured on 2026-11-01 was simply a dead domain.
 */
export function plainError(detail: string): string {
  return /SSRF|URL blocked/i.test(detail)
    ? 'the host does not resolve, or is not a public address'
    : detail;
}

/**
 * Crawl4AI hands back its own failure AS the markdown, with success true, when
 * its parser chokes on a page (newpages.com.my: "Crawl4AI Error: This page is
 * not fully supported. Error Message: All strings must be XML compatible...").
 * Passed on, that paragraph reached a dive as the page's text.
 */
export function crawlError(markdown: string): string | null {
  const m = /^\s*Crawl4AI Error:\s*(.*?)(?:\s+Possible reasons:|$)/s.exec(markdown);
  return m ? 'crawl4ai could not parse the page: ' + m[1]!.replace(/\s+/g, ' ').slice(0, 200) : null;
}

/**
 * One page through Crawl4AI's /md, as `raw`: the whole page as markdown,
 * footer, contact block and side panels included.
 *
 * NOT `fit`, and NOT `bm25`. Both throw away the parts of a page that company
 * research is for. Measured on 2026-11-02 against Tavily /extract (advanced,
 * markdown, what dives bought before) on 12 pages dives had read: `fit` kept
 * about 67% of Tavily's words and 33 of the 78 phones, emails and SSM numbers
 * in Tavily's text, because its Readability pass cuts footers and side panels
 * as chrome, and that is where a company prints its registration number and
 * phone. `raw` kept about 99% of the words and all 78. bm25 is worse again: on
 * 2026-11-01 it kept 328, 475 and 181 characters where fit kept 5957, 4889 and
 * 1374. Do not swap the mode back without re-measuring against Tavily's text.
 */
export async function readPage(url: string): Promise<Read> {
  const ask = async (f: 'raw'): Promise<string> => {
    const res = await fetch(C4AI + '/md', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(C4AI_TOKEN ? { authorization: 'Bearer ' + C4AI_TOKEN } : {}) },
      body: JSON.stringify({ url, f }),
      signal: AbortSignal.timeout(PAGE_MS),
    });
    const text = await res.text();
    let body: { markdown?: unknown; success?: unknown; detail?: unknown } = {};
    try { body = JSON.parse(text); } catch { /* reported below with the status */ }
    // A refusal arrives as HTTP 200 carrying a `detail` and no `success` at all
    // (a dead host does), or as a 4xx. So anything short of an explicit true is
    // a failure — treating a missing or null `success` as fine would return an
    // empty page and lose the reason with it.
    if (!res.ok || body.success !== true || typeof body.markdown !== 'string') {
      throw new Error(plainError(String(body.detail ?? `crawl4ai /md answered ${res.status}: ${text.slice(0, 160)}`)));
    }
    return body.markdown;
  };

  try {
    const markdown = (await ask('raw')).trim();
    const failed = crawlError(markdown);
    if (failed) return { url, error: failed };
    if (!markdown) return { url, error: 'the page had no readable text' };
    return { url, markdown: markdown.length > MAX_PAGE_CHARS ? markdown.slice(0, MAX_PAGE_CHARS) : markdown };
  } catch (err) {
    return { url, error: (err as Error).message.slice(0, 300) };
  }
}

/** True while the container answers. The claim loop asks before every poll. */
async function crawl4aiUp(): Promise<boolean> {
  try {
    const res = await fetch(C4AI + '/health', { signal: AbortSignal.timeout(5_000) });
    return res.ok;
  } catch { return false; }
}

/** One job: every URL read, `PAGE_CONCURRENCY` at a time. */
async function work(payload: unknown): Promise<{ pages: Array<{ url: string; markdown: string }>; failed: Array<{ url: string; error: string }> }> {
  const urls = (payload as { urls?: unknown })?.urls;
  const list = Array.isArray(urls) ? urls.map(String).filter(Boolean) : [];
  const pages: Array<{ url: string; markdown: string }> = [];
  const failed: Array<{ url: string; error: string }> = [];
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(PAGE_CONCURRENCY, list.length) }, async () => {
    for (;;) {
      const url = list[next++];
      if (url === undefined) return;
      const out = await readPage(url);
      if ('markdown' in out) pages.push(out); else failed.push(out);
    }
  }));
  return { pages, failed };
}

// ------------------------------------------------------------- the hub client

async function claim(lane: string): Promise<any> {
  const q = new URLSearchParams({ worker: lane, wait: String(WAIT_SEC), types: TYPES.join(',') });
  const res = await fetch(LAB + '/api/jobs/next?' + q, {
    headers: auth,
    signal: AbortSignal.timeout((WAIT_SEC + 15) * 1000),
  });
  // A wrong token never fixes itself, and a loop that retries it forever looks
  // exactly like a worker that is running fine.
  if (res.status === 401) throw Object.assign(new Error('401 — the token is wrong or was rotated'), { fatal: true });
  if (res.status === 204) return null;
  if (!res.ok) throw new Error(`/api/jobs/next answered ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return (await res.json()).job ?? null;
}

async function report(lane: string, id: string, ok: boolean, result: unknown, error: string | null): Promise<void> {
  const res = await fetch(`${LAB}/api/jobs/${id}/result`, {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify({ worker: lane, ok, result, error }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`posting the result answered ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

/**
 * Say "still here" while a job runs. The claim loop is the check-in and it does
 * not come back round until the job in hand is done, so a twenty-page batch
 * would otherwise go missing from the live table halfway through — and a hub
 * that thinks this lane is gone stops sending reads to it. A missed beat is not
 * worth a log line: the next is 30s away and the window is 90s.
 */
function beat(lane: string): () => void {
  const timer = setInterval(() => {
    void fetch(LAB + '/api/jobs/heartbeat', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ worker: lane, types: TYPES }),
      signal: AbortSignal.timeout(15_000),
    }).catch(() => {});
  }, BEAT_MS);
  timer.unref();
  return () => clearInterval(timer);
}

async function lane(n: number): Promise<void> {
  const name = LANES > 1 ? `${NAME}-${n}` : NAME;
  let quiet = false;
  for (;;) {
    if (!await crawl4aiUp()) {
      if (!quiet) log(`${name}: crawl4ai is not answering at ${C4AI}; not claiming until it does`);
      quiet = true;
      await sleep(IDLE_MS);
      continue;
    }
    if (quiet) log(`${name}: crawl4ai is back; claiming again`);
    quiet = false;

    let job: any = null;
    try { job = await claim(name); }
    catch (err) {
      if ((err as { fatal?: boolean }).fatal) throw err;
      log(`${name}: could not reach the hub: ${(err as Error).message}`);
      await sleep(IDLE_MS);
      continue;
    }
    if (!job) continue;

    const stop = beat(name);
    const at = Date.now();
    try {
      const out = await work(job.payload);
      await report(name, job.id, true, out, null);
      log(`${name}: job ${job.id} read ${out.pages.length} page(s), ${out.failed.length} failed, in ${Date.now() - at}ms`);
    } catch (err) {
      log(`${name}: job ${job.id} FAILED after ${Date.now() - at}ms: ${(err as Error).message}`);
      await report(name, job.id, false, null, (err as Error).message.slice(0, 500)).catch((e: Error) =>
        log(`${name}: could not report the failure either: ${e.message}`));
    } finally {
      stop();
    }
  }
}

async function main(): Promise<void> {
  if (!TOKEN) {
    log(`no LAB_TOKEN or GMAP_WORKER_KEY in ${process.env.LOCAL_FETCH_WORKER_ENV ?? path.join(DATA, 'worker.env')}; nothing to do`);
    process.exit(2);
  }
  log(`Local Fetch Worker ${NAME}: ${LANES} lane(s), ${PAGE_CONCURRENCY} pages at a time, crawl4ai ${C4AI}, hub ${LAB}`);
  // One rejected lane must not take the others down; a bad token must stop everything.
  await Promise.all(Array.from({ length: LANES }, (_, i) => lane(i + 1)));
}

// Only when run as the worker. `check.ts` imports readPage from here and must
// not start a claim loop by doing so.
if (process.argv[1] && import.meta.filename === path.resolve(process.argv[1])) {
  process.on('unhandledRejection', (err) => log('unhandled: ' + ((err as Error)?.message ?? String(err))));
  void main().catch((err: Error) => { log('stopping: ' + err.message); process.exit(1); });
}
