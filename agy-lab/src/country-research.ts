// Country industry research, run by the hub. The pipeline is the one in
// github.com/Zhihong0321/gmap-country-insdusty (copied into ./country/), in its
// own order: cities from World Cities, one Maps search per city, merge,
// website contacts, CSV. One step differs: each city's search is a gmap.scan
// job on this hub's queue instead of a Chrome on the machine running the
// pipeline, so whichever Maps worker is free answers it: the scraper.tech
// lanes, a Gmap Local Worker PC, or the Mac mini (allowed these searches only,
// see jobs.ts countryScanOnly).
//
// Every step checkpoints to disk under the job id, as the worker did, so a
// redeploy mid-run resumes: the job's lease lapses, this lane takes it again,
// finished searches and website checks are kept.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as jobs from './jobs.ts';
// @ts-ignore: plain .mjs from the pipeline repo
import { CITY_DATA, locationsFromCsv, buildRows, csvText } from './country/country-industry-research.mjs';
// @ts-ignore
import { mergeResults } from './country/gmap-industry.mjs';
// @ts-ignore
import { runBatch } from './country/website-contacts-batch.mjs';
// @ts-ignore
import { contacts as websiteContacts } from './country/website-contacts.mjs';

export const JOB_TYPE = 'country.industry';
export const WORKER_NAME = 'hub-country';
/** Marks the gmap.scan jobs this pipeline queues; the mini may answer only these. */
export const SCAN_SOURCE = 'country.industry';
/** The pipeline's own default results per search. */
const MAX_PER_SEARCH = 200;
/** City searches in flight at once, so every free Maps worker gets one. */
const SEARCHES_IN_FLIGHT = 4;
const SEARCH_TIMEOUT_MS = 600_000;
/** A failed or blocked search is asked once more, likely of another worker. */
const SEARCH_ATTEMPTS = 2;
const CONTACT_CONCURRENCY = 4;
const BEAT_MS = 30_000;

type Scan = Record<string, unknown> & { keyword?: string; place?: string; businesses?: unknown[]; blocked?: boolean; error?: string; found?: number | null; capped?: boolean; possibleLimit?: boolean; worker?: string | null };
type Progress = { phase: string; completed: number; total: number | null; message: string };
export type Deps = {
  dir: string;
  cities: (country: string) => Promise<string[]>;
  search: (payload: Record<string, unknown>) => Promise<Scan>;
  research?: (payload: { website: string }) => Promise<Record<string, unknown>>;
  progress: (p: Progress) => void;
};

function invalid(message: string): Error {
  return Object.assign(new Error(message), { code: 'bad_request' });
}

export function normalizePayload(payload: unknown): { country: string; industry: string } {
  const p = payload as { country?: unknown; industry?: unknown } | null;
  if (!p || typeof p !== 'object' || Array.isArray(p)) throw invalid('country.industry requires an object with country and industry');
  const { country, industry } = p;
  if (typeof country !== 'string' || !country.trim() || country.length > 120 || typeof industry !== 'string' || !industry.trim() || industry.length > 160)
    throw invalid('country and industry must be nonempty strings');
  return { country: country.trim(), industry: industry.trim() };
}

function writeJson(file: string, data: unknown): void {
  fs.writeFileSync(file + '.tmp', JSON.stringify(data));
  fs.renameSync(file + '.tmp', file);
}

/** The cities World Cities lists for this country, as the pipeline plans them. */
export async function worldCities(country: string): Promise<string[]> {
  const res = await fetch(CITY_DATA, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error('Could not download city list: HTTP ' + res.status);
  return locationsFromCsv(await res.text(), country);
}

/** One city search as a gmap.scan job; whichever Maps worker is free takes it. */
export async function queueSearch(payload: Record<string, unknown>): Promise<Scan> {
  const job = jobs.create('gmap.scan', { ...payload, source: SCAN_SOURCE }, SEARCH_TIMEOUT_MS);
  const settled = await jobs.wait(job.id, SEARCH_TIMEOUT_MS + 5_000);
  if (!settled || settled.status !== 'done') throw new Error(settled?.error ?? 'Maps search did not finish');
  return { ...(settled.result as Scan), worker: settled.worker };
}

export async function run(payload: unknown, deps: Deps): Promise<Record<string, unknown>> {
  const plan = normalizePayload(payload);
  fs.mkdirSync(deps.dir, { recursive: true });

  // 1. Cities.
  const placesFile = path.join(deps.dir, 'locations.txt');
  let places: string[];
  if (fs.existsSync(placesFile)) places = fs.readFileSync(placesFile, 'utf8').split(/\r?\n/).map((s) => s.trim()).filter((s) => s && !s.startsWith('#'));
  else {
    places = await deps.cities(plan.country);
    if (!places.length) throw invalid('Country not found in city dataset. Use its English name.');
    fs.writeFileSync(placesFile, places.join('\n') + '\n');
  }

  // 2. Maps, one search per city, through the queue.
  const mapsFile = path.join(deps.dir, 'maps.json');
  const state = fs.existsSync(mapsFile) ? JSON.parse(fs.readFileSync(mapsFile, 'utf8'))
    : { version: 1, plan: { keywords: [plan.industry], places, max: MAX_PER_SEARCH }, scans: [] as Scan[], businesses: [] };
  const ok = (s: Scan) => !s.blocked && !s.error;
  const done = () => (state.scans as Scan[]).filter(ok).length;
  const todo = places.filter((place) => !(state.scans as Scan[]).some((s) => s.place === place && ok(s)));
  deps.progress({ phase: 'maps', completed: done(), total: places.length, message: 'Searching Google Maps' });
  let next = 0;
  const one = async (place: string): Promise<void> => {
    let result: Scan = { keyword: plan.industry, place, error: 'not run', businesses: [] };
    for (let attempt = 0; attempt < SEARCH_ATTEMPTS; attempt++) {
      try { result = await deps.search({ keyword: plan.industry, place, max: MAX_PER_SEARCH }); }
      catch (error) { result = { keyword: plan.industry, place, error: (error as Error).message, businesses: [] }; }
      result.keyword = plan.industry; result.place = place;
      if (ok(result)) break;
    }
    result.possibleLimit = ok(result) && (Number(result.found) >= 120 || result.capped === true);
    // A retry replaces a previous blocked or failed attempt for that city.
    state.scans = (state.scans as Scan[]).filter((s) => s.place !== place).concat(result);
    state.businesses = mergeResults(state.scans);
    state.updatedAt = new Date().toISOString();
    state.summary = { planned: places.length, completed: done(), possibleLimits: (state.scans as Scan[]).filter((s) => s.possibleLimit).length, unique: state.businesses.length };
    writeJson(mapsFile, state);
    deps.progress({ phase: 'maps', completed: done(), total: places.length, message: 'Searching Google Maps' });
  };
  await Promise.all(Array.from({ length: Math.min(SEARCHES_IN_FLIGHT, todo.length) }, async () => {
    while (next < todo.length) await one(todo[next++]!);
  }));

  // 3. Website contacts, the pipeline's own batch with its checkpoint.
  const businesses = state.businesses as Array<Record<string, unknown>>;
  const withoutSite = businesses.filter((b) => !b.website).length;
  let checked = 0;
  const research = deps.research ?? websiteContacts;
  deps.progress({ phase: 'contacts', completed: 0, total: businesses.length, message: 'Researching company websites' });
  const contactState = await runBatch(businesses, {
    output: path.join(deps.dir, 'contacts.json'), concurrency: CONTACT_CONCURRENCY,
    research: async (p: { website: string }) => {
      try { return await research(p); }
      finally { checked++; deps.progress({ phase: 'contacts', completed: Math.min(businesses.length, checked + withoutSite), total: businesses.length, message: 'Researching company websites' }); }
    },
  });

  // 4. The CSV, exactly as the pipeline writes companies.csv.
  const scans = state.scans as Scan[];
  const byWorker: Record<string, number> = {};
  for (const s of scans.filter(ok)) byWorker[String(s.worker ?? 'unknown')] = (byWorker[String(s.worker ?? 'unknown')] ?? 0) + 1;
  return {
    country: plan.country, industry: plan.industry,
    filename: 'country-industry-report.csv', contentType: 'text/csv; charset=utf-8',
    csv: csvText(buildRows(contactState)),
    summary: {
      ...contactState.summary,
      searches: scans.length,
      failedSearches: scans.filter((s) => !ok(s)).length,
      possibleLimits: scans.filter((s) => s.possibleLimit).length,
      searchesByWorker: byWorker,
    },
    coverageNote: 'Maps search results are not an exhaustive census; some searches may be capped or incomplete.',
  };
}

function runDir(jobId: string): string {
  const root = process.env.COUNTRY_RUN_DIR || path.join(os.homedir(), '.agy-lab', 'country-runs');
  return path.join(root, jobId.replace(/[^a-f0-9]/g, ''));
}

async function lane(): Promise<void> {
  for (;;) {
    try {
      jobs.touch(WORKER_NAME, '127.0.0.1', [JOB_TYPE]);
      const job = await jobs.take(WORKER_NAME, { types: [JOB_TYPE], waitMs: 5_000 });
      if (!job) continue;
      let last: Progress | undefined;
      const beat = setInterval(() => { jobs.touch(WORKER_NAME, '127.0.0.1', [JOB_TYPE]); jobs.renewCountryJob(job.id, WORKER_NAME, last); }, BEAT_MS);
      beat.unref();
      try {
        const result = await run(job.payload, {
          dir: runDir(job.id), cities: worldCities, search: queueSearch,
          progress: (p) => { last = p; jobs.renewCountryJob(job.id, WORKER_NAME, p); },
        });
        jobs.finish(job.id, true, result, null);
      } catch (cause) {
        console.error(`[country] job ${job.id} failed: ${(cause as Error).stack ?? String(cause)}`);
        jobs.finish(job.id, false, null, (cause as Error).message ?? String(cause));
      } finally {
        clearInterval(beat);
      }
    } catch (cause) {
      console.error('[country] ' + ((cause as Error).message ?? String(cause)));
      await new Promise((resolve) => setTimeout(resolve, 5_000));
    }
  }
}

/** One country job at a time; its city searches go out several at once. */
export function start(): void {
  void lane();
  console.log(`[country] ${WORKER_NAME} claiming ${JOB_TYPE}; Maps searches go to the gmap.scan queue`);
}
