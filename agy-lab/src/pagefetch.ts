// Reading a page on the Mac mini instead of buying the read from Tavily.
//
// WHY. Tavily's /extract is the most expensive thing a company dive does per
// page, and what it hands back is a page we could read ourselves: it fetches
// the URL, strips the chrome and returns the text. The one thing it has that
// this container does not is an address a website will serve. The Mac mini has
// that already — it is the whole reason docs/plan-macmini-worker.md exists —
// and a page read there costs nothing.
//
// DIRECTION, as always with the mini: it sits behind home NAT and this service
// can never connect TO it. So a read is a broker job (jobs.ts). The hub creates
// a `fetch.pages` job and awaits it; the mini's fetch lane is already holding
// GET /api/jobs/next open, so it claims the job within milliseconds, hands the
// URLs to Crawl4AI on its own loopback and posts the markdown back.
//
// THE ANSWER SHAPE is Tavily's /extract shape — `results[].raw_content` and
// `failed_results[]` — so companydive's addExtractResults reads it unchanged
// and nothing downstream of the ledger knows the provider changed.
//
// NO FALLBACK, by choice. With no fetch lane live, `read` fails with code
// 'not_installed' and the dive's read step says so and carries on from the
// search snippets. Falling back to Tavily would hide a mini that has been off
// for a week behind a bill that looks normal.
import * as jobs from './jobs.ts';

/** The broker job type the Mac mini's fetch lane claims. */
export const JOB_TYPE = 'fetch.pages';

/** Tavily's own /extract ceiling, kept so the two are swappable per call. */
export const MAX_URLS = 20;

/** A worker is "live" while it has checked in this recently (jobs.ts uses the same window). */
const LIVE_MS = 90_000;

/**
 * How long one batch may take: the browser start plus a slice per page. A page
 * Crawl4AI cannot finish is its own failed_result, so this ceiling is reached
 * only when the whole lane is wedged.
 */
const BASE_MS = 60_000;
const PER_URL_MS = 15_000;
const MAX_BATCH_MS = 600_000;

export type Page = { url: string; raw_content: string };
export type Failed = { url: string; error: string };

/** Tavily's /extract answer shape, so callers need no branch of their own. */
export type ExtractAnswer = {
  results: Page[];
  failed_results: Failed[];
  usage: { credits: number };
  /** Which machine read the pages, for the dive's own report. */
  worker: string | null;
};

export type ReadOptions = {
  /** Overrides the batch ceiling; for tests. */
  timeoutMs?: number;
  /** For tests. */
  broker?: Pick<typeof jobs, 'create' | 'wait' | 'cancel' | 'liveTypes'>;
};

function fail(message: string, code: string): Error {
  return Object.assign(new Error(message), { code });
}

/** True while a machine running the fetch lane has checked in. */
export function available(broker: Pick<typeof jobs, 'liveTypes'> = jobs): boolean {
  return broker.liveTypes(LIVE_MS).includes(JOB_TYPE);
}

export function batchMs(urls: number): number {
  return Math.min(MAX_BATCH_MS, BASE_MS + urls * PER_URL_MS);
}

/** One page of a worker's answer, kept only when it has both a URL and some text. */
function pages(result: unknown): Page[] {
  const rows = (result as { pages?: unknown })?.pages;
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((row): Page[] => {
    const url = String((row as { url?: unknown })?.url ?? '').trim();
    const text = String((row as { markdown?: unknown })?.markdown ?? '').trim();
    return url && text ? [{ url, raw_content: text }] : [];
  });
}

function failures(result: unknown): Failed[] {
  const rows = (result as { failed?: unknown })?.failed;
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((row): Failed[] => {
    const url = String((row as { url?: unknown })?.url ?? '').trim();
    return url ? [{ url, error: String((row as { error?: unknown })?.error ?? 'could not be read').slice(0, 300) }] : [];
  });
}

/**
 * Read these pages on the Mac mini. Answers in Tavily's /extract shape.
 *
 * A URL that could not be read is a `failed_results` row, never a thrown error:
 * one dead page must not lose the nineteen that worked. Only a missing lane, a
 * worker failure or a batch that never came back throws.
 */
export async function read(urls: string[], opts: ReadOptions = {}): Promise<ExtractAnswer> {
  const broker = opts.broker ?? jobs;
  const wanted = [...new Set(urls.map((u) => String(u ?? '').trim()).filter(Boolean))].slice(0, MAX_URLS);
  if (!wanted.length) return { results: [], failed_results: [], usage: { credits: 0 }, worker: null };
  if (!available(broker)) {
    throw fail(`no ${JOB_TYPE} worker has checked in; the pages were not read`, 'not_installed');
  }

  const timeoutMs = opts.timeoutMs ?? batchMs(wanted.length);
  const job = broker.create(JOB_TYPE, { urls: wanted }, timeoutMs);
  const done = await broker.wait(job.id, timeoutMs);

  if (!done) throw fail(`fetch job ${job.id} vanished from the broker`, 'engine_error');
  if (done.status === 'running' || done.status === 'pending') {
    // Give the slot back rather than leaving a batch nobody awaits to run its lease out.
    broker.cancel(job.id, 'the hub stopped waiting for this read');
    throw fail(`reading ${wanted.length} page(s) took over ${Math.round(timeoutMs / 1000)}s`, 'timeout');
  }
  if (done.status === 'failed') throw fail(done.error ?? 'the fetch worker failed', 'engine_error');

  const results = pages(done.result);
  const failed = failures(done.result);
  // Anything the worker neither read nor reported is still a page the dive asked for.
  const accounted = new Set([...results, ...failed].map((r) => r.url));
  for (const url of wanted) if (!accounted.has(url)) failed.push({ url, error: 'the worker returned nothing for this URL' });

  return { results, failed_results: failed, usage: { credits: 0 }, worker: done.worker };
}
