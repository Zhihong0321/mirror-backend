// Search lists: a CSV of Google Maps searches (country, city, industry,
// search_keyword), run by the hub to the end. Each search is a gmap.scan job on
// the queue, so whichever Maps worker is free answers it: the Mac mini, the
// scraper.tech lanes or a Gmap Local Worker PC. Every business found is then
// checked on its own website for emails, phones, social links and people, with
// the country pipeline's plain-code contact step (./country/), no LLM.
//
// A list is sized for ~1,250 searches and ~100k businesses, so the run's state
// is not one file rewritten after every step: it is rows in the report
// database. One row per search, one row per business (a Google place id found
// by several searches is one row that names them all). A finished search or
// website check is one row update, and that row is the checkpoint: a redeploy,
// a crash or a pause loses only what was in flight, and the run carries on
// from the rows that are not done.
import crypto from 'node:crypto';
import type http from 'node:http';
import * as db from './reportdb.ts';
import * as jobs from './jobs.ts';
import * as companies from './company-uid.ts';
// @ts-ignore: plain .mjs from the pipeline repo
import { businessKey } from './country/gmap-industry.mjs';
// @ts-ignore
import { buildRows } from './country/country-industry-research.mjs';
// @ts-ignore
import { contacts as websiteContacts } from './country/website-contacts.mjs';

/** Marks the gmap.scan jobs a list queues; the mini may answer these (jobs.ts countryScanOnly). */
export const SCAN_SOURCE = 'search.list';
const MAX_PER_SEARCH = 200;
/** The mini, the PC and three scraper.tech lanes: one search each. */
const SEARCHES_IN_FLIGHT = 5;
const SEARCH_TIMEOUT_MS = 600_000;
/** A failed, blocked or cut-short search is asked once more, likely of another worker. */
const SEARCH_ATTEMPTS = 2;
/**
 * A search that failed both asks gets one more round, after the half hour a
 * worker Google refused rests for (BlockedRestSec in the PC's worker.ps1).
 */
const SEARCH_ROUNDS = 2;
const RETRY_AFTER_SECONDS = 1_800;
const CONTACT_CONCURRENCY = 12;
const CONTACT_BATCH = 50;
const LEASE_SECONDS = 120;
const BEAT_MS = 30_000;
const MAX_ROWS = 20_000;
const OWNER = 'hub-' + crypto.randomBytes(4).toString('hex');

/** The business fields kept per row; the rest of a worker's answer is not used. */
const BUSINESS_FIELDS = ['name', 'category', 'address', 'phone', 'website', 'rating', 'reviews', 'mapsUrl', 'place_id', 'latitude', 'longitude'];
const CSV_FIELDS = ['country', 'city', 'industry', 'search_keyword', 'name', 'category', 'address', 'phone', 'website', 'rating', 'reviews',
  'emails', 'email_sources', 'website_phones', 'phone_sources', 'people', 'people_sources', 'contact_links', 'mapsUrl', 'place_id',
  'research_status', 'research_errors'];

export type SearchRow = { country: string; city: string; industry: string; keyword: string };
type Scan = { businesses?: Array<Record<string, unknown>>; blocked?: boolean; error?: string | null; capped?: boolean; worker?: string | null;
  stoppedEarly?: string | null; retryAfterMs?: number; listError?: string | null };
type Place = { place_key: string; business: Record<string, unknown> };
export type Deps = {
  search: (payload: Record<string, unknown>) => Promise<Scan>;
  research: (payload: { website: string }) => Promise<Record<string, unknown>>;
};

function invalid(message: string): Error {
  return Object.assign(new Error(message), { code: 'bad_request' });
}

/**
 * Why a worker's answer is only part of the search, or null when it is whole.
 * Google can refuse a worker partway through: the PC then sends what it read
 * with `stoppedEarly`, the mini with `retryAfterMs`, and neither is `blocked`.
 */
export function cutShort(scan: Scan): string | null {
  if (typeof scan.stoppedEarly === 'string' && scan.stoppedEarly) return 'cut short: ' + scan.stoppedEarly;
  if (Number(scan.retryAfterMs) > 0) return 'cut short: Google refused the worker partway' + (scan.listError ? ' (' + scan.listError + ')' : '');
  return null;
}

const jsonParam = (value: unknown): string =>
  JSON.stringify(value ?? null, (_k, v) => (typeof v === 'string' ? v.toWellFormed() : v)) ?? 'null';
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** RFC 4180: quoted cells, doubled quotes, commas and line breaks inside quotes. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const src = text.replace(/^﻿/, '');
  for (let i = 0; i < src.length; i++) {
    const c = src[i]!;
    if (quoted) {
      if (c !== '"') cell += c;
      else if (src[i + 1] === '"') { cell += '"'; i++; }
      else quoted = false;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((v) => v.trim()));
}

/** The list's rows, in file order. Columns: country, city, industry, search_keyword. */
export function parseSearchList(text: string): SearchRow[] {
  const [header, ...body] = parseCsv(text);
  if (!header) throw invalid('the CSV is empty');
  const at = (name: string) => header.findIndex((h) => h.trim().toLowerCase() === name);
  const cols = { country: at('country'), city: at('city'), industry: at('industry'), keyword: at('search_keyword') };
  if (Object.values(cols).some((i) => i < 0)) throw invalid('the CSV needs the columns country, city, industry, search_keyword');
  if (!body.length) throw invalid('the CSV has no searches');
  if (body.length > MAX_ROWS) throw invalid(`a list holds at most ${MAX_ROWS} searches`);
  return body.map((r, n) => {
    const row = { country: (r[cols.country] ?? '').trim(), city: (r[cols.city] ?? '').trim(), industry: (r[cols.industry] ?? '').trim(), keyword: (r[cols.keyword] ?? '').trim() };
    if (!row.keyword) throw invalid(`row ${n + 2} has no search_keyword`);
    return row;
  });
}

/** One business as stored: the kept fields, empty ones left out so a later search can fill them. */
export function slim(b: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of BUSINESS_FIELDS) if (b[f] !== null && b[f] !== undefined && b[f] !== '') out[f] = b[f];
  return out;
}

/** A search's businesses, one per Google place, keyed as the country pipeline merges them. */
export function placesOf(businesses: Array<Record<string, unknown>>): Array<{ key: string; business: Record<string, unknown> }> {
  const byKey = new Map<string, Record<string, unknown>>();
  for (const b of businesses) {
    if (!b?.name) continue;
    const key = businessKey(b) as string;
    if (!byKey.has(key)) byKey.set(key, slim(b));
  }
  return [...byKey].map(([key, business]) => ({ key, business }));
}

const cell = (v: unknown): string => {
  let s = String(v ?? '');
  if (/^\s*[=+@-]/.test(s)) s = "'" + s;
  return '"' + s.replaceAll('"', '""') + '"';
};
const joined = (values: string[]): string => [...new Set(values.filter(Boolean))].join('; ');

/** One CSV line: the searches that found the business, then the country pipeline's columns. */
export function csvLine(place: { business: Record<string, unknown>; contact: Record<string, unknown> | null; contact_status: string | null }, searches: SearchRow[]): string {
  const contact = place.contact ?? { status: place.contact_status === 'running' || !place.contact_status ? 'not_checked_yet' : place.contact_status };
  const [row] = buildRows({ results: { 0: { business: place.business, contact } } }) as Array<Record<string, unknown>>;
  const out: Record<string, unknown> = {
    ...row,
    country: joined(searches.map((s) => s.country)),
    city: joined(searches.map((s) => s.city)),
    industry: joined(searches.map((s) => s.industry)),
    search_keyword: joined(searches.map((s) => s.keyword)),
  };
  return CSV_FIELDS.map((f) => cell(out[f])).join(',');
}

// ---- storage -----------------------------------------------------------

let migrated: Promise<void> | null = null;
function migrate(): Promise<void> {
  migrated ??= (async () => {
    await db.sql(`
      create table if not exists search_list_run (
        id          text primary key,
        name        text not null,
        status      text not null default 'paused',
        created_at  timestamptz not null default now(),
        updated_at  timestamptz not null default now(),
        finished_at timestamptz,
        lease_owner text,
        lease_until timestamptz
      )
    `);
    await db.sql(`
      create table if not exists search_list_search (
        run_id      text not null references search_list_run(id) on delete cascade,
        idx         int not null,
        country     text not null,
        city        text not null,
        industry    text not null,
        keyword     text not null,
        status      text not null default 'pending',
        attempts    int not null default 0,
        worker      text,
        found       int,
        capped      boolean,
        error       text,
        finished_at timestamptz,
        primary key (run_id, idx)
      )
    `);
    await db.sql(`
      create table if not exists search_list_place (
        run_id           text not null references search_list_run(id) on delete cascade,
        place_key        text not null,
        business         jsonb not null,
        searches         int[] not null,
        contact          jsonb,
        contact_status   text,
        contact_attempts int not null default 0,
        updated_at       timestamptz not null default now(),
        primary key (run_id, place_key)
      )
    `);
    await db.sql(`
      create index if not exists search_list_place_unchecked on search_list_place (run_id) where contact_status is null
    `);
  })().catch((err) => { migrated = null; throw err; });
  return migrated;
}

export async function createRun(name: string, rows: SearchRow[]): Promise<string> {
  await migrate();
  const id = crypto.randomBytes(6).toString('hex');
  await db.sql(`insert into search_list_run (id, name) values ($1, $2)`, [id, name]);
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500).map((r, j) => ({ idx: i + j, ...r }));
    await db.sql(`
      insert into search_list_search (run_id, idx, country, city, industry, keyword)
      select $1, x.idx, x.country, x.city, x.industry, x.keyword
      from jsonb_to_recordset($2::jsonb) as x(idx int, country text, city text, industry text, keyword text)`, [id, jsonParam(chunk)]);
  }
  return id;
}

export async function runStatus(id: string): Promise<Record<string, unknown> | null> {
  await migrate();
  const run = (await db.sql(`select id, name, status, created_at, updated_at, finished_at, lease_owner, lease_until from search_list_run where id = $1`, [id])).rows[0];
  if (!run) return null;
  const searches = (await db.sql<{ status: string; n: number; found: number }>(
    `select status, count(*)::int as n, coalesce(sum(found), 0)::int as found from search_list_search where run_id = $1 group by status`, [id])).rows;
  const byWorker = (await db.sql<{ worker: string; n: number }>(
    `select coalesce(worker, 'unknown') as worker, count(*)::int as n from search_list_search where run_id = $1 and status = 'done' group by 1 order by 2 desc`, [id])).rows;
  const places = (await db.sql(`
    select count(*)::int as places,
           count(*) filter (where contact_status is not null and contact_status <> 'running')::int as checked,
           count(*) filter (where business ? 'website')::int as with_website,
           count(*) filter (where jsonb_array_length(coalesce(contact->'emails', '[]'::jsonb)) > 0)::int as with_email,
           count(*) filter (where jsonb_array_length(coalesce(contact->'phones', '[]'::jsonb)) > 0)::int as with_website_phone,
           count(*) filter (where contact_status in ('failed', 'blocked'))::int as contact_failed
    from search_list_place where run_id = $1`, [id])).rows[0]!;
  const count = (s: string) => searches.find((r) => r.status === s)?.n ?? 0;
  return {
    ...run,
    searches: { total: searches.reduce((n, r) => n + r.n, 0), pending: count('pending') + count('searching'), done: count('done'), failed: count('failed'),
      businessesFound: searches.reduce((n, r) => n + r.found, 0) },
    searchesByWorker: Object.fromEntries(byWorker.map((r) => [r.worker, r.n])),
    places,
  };
}

export async function listRuns(): Promise<Array<Record<string, unknown>>> {
  await migrate();
  const ids = (await db.sql<{ id: string }>(`select id from search_list_run order by created_at desc limit 20`)).rows;
  return (await Promise.all(ids.map((r) => runStatus(r.id)))).filter((r): r is Record<string, unknown> => r !== null);
}

async function searchRows(id: string): Promise<Map<number, SearchRow>> {
  const rows = (await db.sql<SearchRow & { idx: number }>(`select idx, country, city, industry, keyword from search_list_search where run_id = $1`, [id])).rows;
  return new Map(rows.map((r) => [r.idx, r]));
}

/** A search's businesses into the run: new places added, places found before gain this search. */
async function savePlaces(runId: string, idx: number, businesses: Array<Record<string, unknown>>): Promise<number> {
  const places = placesOf(businesses);
  if (!places.length) return 0;
  // On a conflict the stored fields win and the new answer only fills the gaps;
  // a business that had no website and now has one goes back to be checked.
  await db.sql(`
    insert into search_list_place (run_id, place_key, business, searches)
    select $1, x.key, x.business, array[$2::int] from jsonb_to_recordset($3::jsonb) as x(key text, business jsonb)
    on conflict (run_id, place_key) do update set
      business = excluded.business || search_list_place.business,
      searches = case when $2::int = any(search_list_place.searches) then search_list_place.searches else search_list_place.searches || $2::int end,
      contact_status = case when search_list_place.contact_status = 'no_website' and excluded.business ? 'website'
        and not search_list_place.business ? 'website' then null else search_list_place.contact_status end,
      updated_at = now()`, [runId, idx, jsonParam(places)]);
  // A UID a save cannot give now is given by the next start's backfill.
  await companies.assign(places.map((p) => ({ place_key: p.key, website: p.business.website })))
    .catch((err: Error) => console.error('[search-list] company UIDs: ' + err.message));
  return places.length;
}

// ---- the work ----------------------------------------------------------

/** One search as a gmap.scan job; whichever Maps worker is free takes it, or `worker` when named. */
export async function queueSearch(payload: Record<string, unknown>): Promise<Scan> {
  const job = jobs.create('gmap.scan', { ...payload, source: SCAN_SOURCE }, SEARCH_TIMEOUT_MS);
  const settled = await jobs.wait(job.id, SEARCH_TIMEOUT_MS + 5_000);
  if (!settled || settled.status !== 'done') throw new Error(settled?.error ?? 'Maps search did not finish');
  return { ...(settled.result as Scan), worker: settled.worker };
}

const DEFAULT_DEPS: Deps = { search: queueSearch, research: websiteContacts };

/**
 * One row of the list: asked up to twice, its businesses saved, the row marked
 * done or failed. A cut-short answer's businesses are kept and the search is
 * asked again, so a block partway does not leave the row short.
 */
async function runSearch(runId: string, idx: number, row: SearchRow, deps: Deps, worker?: string): Promise<void> {
  let result: Scan | null = null;
  let error = 'not run';
  let kept = 0;
  for (let attempt = 0; attempt < SEARCH_ATTEMPTS; attempt++) {
    await db.sql(`update search_list_search set attempts = attempts + 1 where run_id = $1 and idx = $2`, [runId, idx]);
    try {
      const scan = await deps.search({ keyword: row.keyword, max: MAX_PER_SEARCH, ...(worker ? { worker } : {}) });
      if (scan.blocked || scan.error) { error = scan.error || 'blocked'; continue; }
      kept = Math.max(kept, await savePlaces(runId, idx, Array.isArray(scan.businesses) ? scan.businesses : []));
      const short = cutShort(scan);
      if (!short) { result = scan; break; }
      error = short;
    } catch (cause) {
      error = (cause as Error).message ?? String(cause);
    }
  }
  if (!result) {
    await db.sql(`update search_list_search set status = 'failed', found = $4, error = $3, finished_at = now() where run_id = $1 and idx = $2`,
      [runId, idx, error.slice(0, 500), kept || null]);
    return;
  }
  await db.sql(`update search_list_search set status = 'done', worker = $3, found = $4, capped = $5, error = null, finished_at = now() where run_id = $1 and idx = $2`,
    [runId, idx, result.worker ?? null, kept, result.capped === true]);
}

/**
 * The next search to ask, marked `searching` so no other loop asks it too:
 * pending ones first, then failed ones whose rest is over and that have a
 * round left. 'wait' when only resting ones remain.
 */
async function takeSearch(runId: string): Promise<number | 'wait' | null> {
  const taken = await db.sql<{ idx: number }>(`
    update search_list_search set status = 'searching'
    where run_id = $1 and idx = (
      select idx from search_list_search
      where run_id = $1 and (status = 'pending'
        or (status = 'failed' and attempts < $2 and finished_at < now() - make_interval(secs => $3)))
      order by status desc, idx limit 1 for update skip locked)
    returning idx`, [runId, SEARCH_ATTEMPTS * SEARCH_ROUNDS, RETRY_AFTER_SECONDS]);
  if (taken.rows[0]) return taken.rows[0].idx;
  const resting = await db.sql<{ n: number }>(`select count(*)::int as n from search_list_search where run_id = $1 and status = 'failed' and attempts < $2`,
    [runId, SEARCH_ATTEMPTS * SEARCH_ROUNDS]);
  return Number(resting.rows[0]?.n) > 0 ? 'wait' : null;
}

const NO_WEBSITE = { website: null, status: 'no_website', emails: [], phones: [], people: [], links: [], pages: [], errors: [] };

async function checkPlace(runId: string, place: Place, deps: Deps): Promise<void> {
  const website = typeof place.business.website === 'string' ? place.business.website : '';
  let contact: Record<string, unknown>;
  if (!website) contact = NO_WEBSITE;
  else {
    try { contact = await deps.research({ website }); }
    catch (cause) { contact = { ...NO_WEBSITE, website, status: 'failed', errors: [{ url: website, error: (cause as Error).message }] }; }
  }
  await db.sql(`update search_list_place set contact = $3::jsonb, contact_status = $4, contact_attempts = contact_attempts + 1, updated_at = now()
    where run_id = $1 and place_key = $2`, [runId, place.place_key, jsonParam(contact), String(contact.status ?? 'done')]);
}

/** Takes up to `limit` unchecked businesses, marked running so no other loop takes them too. */
async function takePlaces(runId: string, limit: number, searchIdx?: number): Promise<Place[]> {
  return (await db.sql<Place>(`
    update search_list_place set contact_status = 'running'
    where run_id = $1 and place_key in (
      select place_key from search_list_place
      where run_id = $1 and contact_status is null ${searchIdx === undefined ? '' : 'and $3::int = any(searches)'}
      limit $2 for update skip locked)
    returning place_key, business`, searchIdx === undefined ? [runId, limit] : [runId, limit, searchIdx])).rows;
}

/** Website checks until nothing is left and `more()` says no more businesses are coming. */
async function checkPlaces(runId: string, deps: Deps, alive: () => boolean, more: () => boolean, searchIdx?: number): Promise<void> {
  const queue: Place[] = [];
  let refilling: Promise<void> | null = null;
  const refill = () => (refilling ??= takePlaces(runId, CONTACT_BATCH, searchIdx)
    .then((rows) => { queue.push(...rows); })
    .finally(() => { refilling = null; }));
  const worker = async () => {
    while (alive()) {
      if (!queue.length) await refill();
      const place = queue.shift();
      if (place) { await checkPlace(runId, place, deps); continue; }
      if (!more()) return;
      await sleep(5_000);
    }
  };
  try {
    await Promise.all(Array.from({ length: CONTACT_CONCURRENCY }, worker));
  } finally {
    // A pause leaves taken rows unchecked; they go back to be taken again.
    if (queue.length) await db.sql(`update search_list_place set contact_status = null where run_id = $1 and place_key = any($2::text[]) and contact_status = 'running'`,
      [runId, queue.map((p) => p.place_key)]);
  }
}

/** The whole list, searches and website checks side by side, while this hub holds the run's lease. */
export async function work(runId: string, deps: Deps = DEFAULT_DEPS): Promise<void> {
  // Rows taken by a hub that stopped mid-search or mid-check are not being worked by anyone.
  await db.sql(`update search_list_search set status = 'pending' where run_id = $1 and status = 'searching'`, [runId]);
  await db.sql(`update search_list_place set contact_status = null where run_id = $1 and contact_status = 'running'`, [runId]);
  let alive = true;
  const beat = setInterval(() => {
    db.sql(`update search_list_run set lease_until = now() + make_interval(secs => $3), updated_at = now()
      where id = $1 and lease_owner = $2 and status = 'running' returning id`, [runId, OWNER, LEASE_SECONDS])
      .then((r) => { if (!r.rowCount) alive = false; })
      .catch((err: Error) => console.warn('[search-list] lease: ' + err.message));
  }, BEAT_MS);
  beat.unref();
  try {
    const rows = await searchRows(runId);
    let searching = true;
    let inFlight = 0;
    console.log(`[search-list] run ${runId}: searching`);
    const searches = Promise.all(Array.from({ length: SEARCHES_IN_FLIGHT }, async () => {
      while (alive) {
        const idx = await takeSearch(runId);
        // Nothing to take: this loop is done unless a search in flight may still fail into a retry.
        if (idx === null && !inFlight) return;
        if (idx === null || idx === 'wait') { await sleep(30_000); continue; }
        inFlight++;
        try { await runSearch(runId, idx, rows.get(idx)!, deps); }
        catch (cause) {
          console.error(`[search-list] run ${runId} search ${idx}: ${(cause as Error).message}`);
          await db.sql(`update search_list_search set status = 'pending' where run_id = $1 and idx = $2 and status = 'searching'`, [runId, idx]).catch(() => {});
        } finally { inFlight--; }
      }
    })).finally(() => { searching = false; });
    await Promise.all([searches, checkPlaces(runId, deps, () => alive, () => searching)]);
    if (!alive) return;
    const left = (await db.sql<{ n: number }>(`
      select (select count(*) from search_list_search where run_id = $1
                and (status in ('pending', 'searching') or (status = 'failed' and attempts < $2)))
           + (select count(*) from search_list_place where run_id = $1 and contact_status is null) as n`, [runId, SEARCH_ATTEMPTS * SEARCH_ROUNDS])).rows[0]!;
    if (Number(left.n) === 0) {
      await db.sql(`update search_list_run set status = 'done', finished_at = now(), updated_at = now() where id = $1 and status = 'running'`, [runId]);
      console.log(`[search-list] run ${runId} done`);
    }
  } finally {
    clearInterval(beat);
    await db.sql(`update search_list_search set status = 'pending' where run_id = $1 and status = 'searching'`, [runId]);
    await db.sql(`update search_list_run set lease_owner = null, lease_until = null where id = $1 and lease_owner = $2`, [runId, OWNER]);
  }
}

/**
 * Runs chosen rows of a paused list, each pinned to one worker, and checks the
 * websites of what they found. A trial before the whole list: its results stay
 * in the run, so starting the list later does not ask these searches again.
 */
export async function trial(runId: string, picks: Array<{ idx: number; worker: string }>, deps: Deps = DEFAULT_DEPS): Promise<void> {
  const rows = await searchRows(runId);
  await Promise.all(picks.map(async ({ idx, worker }) => {
    await db.sql(`update search_list_search set status = 'pending', attempts = 0, error = null where run_id = $1 and idx = $2`, [runId, idx]);
    await runSearch(runId, idx, rows.get(idx)!, deps, worker);
    await checkPlaces(runId, deps, () => true, () => false, idx);
  }));
}

export async function claim(): Promise<string | null> {
  const r = await db.sql<{ id: string }>(`
    update search_list_run set lease_owner = $1, lease_until = now() + make_interval(secs => $2), updated_at = now()
    where id = (select id from search_list_run
                where status = 'running' and (lease_until is null or lease_until < now())
                order by created_at limit 1 for update skip locked)
    returning id`, [OWNER, LEASE_SECONDS]);
  return r.rows[0]?.id ?? null;
}

async function lane(): Promise<void> {
  for (;;) {
    try {
      const id = await claim();
      if (id) await work(id);
      else await sleep(15_000);
    } catch (cause) {
      console.error('[search-list] ' + ((cause as Error).message ?? String(cause)));
      await sleep(15_000);
    }
  }
}

export function start(): void {
  if (!db.configured()) return void console.warn('[search-list] no report database; search lists are off');
  void migrate().then(() => lane()).catch((err: Error) => console.error('[search-list] could not start: ' + err.message));
  void companies.backfill()
    .then((n) => { if (n) console.log(`[search-list] gave ${n} research leads a company UID`); })
    .catch((err: Error) => console.error('[search-list] company UID backfill: ' + err.message));
  console.log(`[search-list] ${OWNER} runs search lists; Maps searches go to the gmap.scan queue`);
}

// ---- HTTP --------------------------------------------------------------

type Ctx = {
  json: (res: http.ServerResponse, status: number, body: unknown) => void;
  readJson: (req: http.IncomingMessage) => Promise<Record<string, unknown>>;
};

/** /api/search-lists: create, read, start, pause, retry, trial and the CSV. All behind LAB_TOKEN. */
export async function handle(req: http.IncomingMessage, res: http.ServerResponse, url: URL, { json, readJson }: Ctx): Promise<boolean> {
  const p = url.pathname;
  if (p !== '/api/search-lists' && !p.startsWith('/api/search-lists/')) return false;
  if (!db.configured()) return json(res, 503, { error: 'no report database configured' }), true;
  const method = req.method ?? 'GET';
  try {
    if (p === '/api/search-lists') {
      if (method === 'GET') return json(res, 200, { runs: await listRuns() }), true;
      if (method === 'POST') {
        const body = await readJson(req);
        if (typeof body.csv !== 'string') throw invalid('send {name, csv} with the list as CSV text');
        const rows = parseSearchList(body.csv);
        const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim().slice(0, 200) : `${rows.length} searches`;
        const id = await createRun(name, rows);
        return json(res, 201, await runStatus(id)), true;
      }
      return false;
    }
    const m = /^\/api\/search-lists\/([a-f0-9]{12})(?:\/([a-z.-]+))?$/.exec(p);
    if (!m) return false;
    const [, id, action] = m as unknown as [string, string, string | undefined];
    const run = await runStatus(id);
    if (!run) return json(res, 404, { error: 'no such search list' }), true;

    if (method === 'GET' && !action) return json(res, 200, run), true;
    if (method === 'POST' && (action === 'start' || action === 'pause')) {
      if (run.status === 'done' && action === 'start') return json(res, 409, { error: 'this list is done; retry its failures to run it again' }), true;
      await db.sql(`update search_list_run set status = $2, updated_at = now() where id = $1 and status <> 'done'`, [id, action === 'start' ? 'running' : 'paused']);
      return json(res, 200, await runStatus(id)), true;
    }
    if (method === 'POST' && action === 'retry') {
      const s = await db.sql(`update search_list_search set status = 'pending', attempts = 0, error = null where run_id = $1 and status = 'failed'`, [id]);
      const c = await db.sql(`update search_list_place set contact_status = null where run_id = $1 and contact_status in ('failed', 'blocked')`, [id]);
      if ((s.rowCount ?? 0) + (c.rowCount ?? 0) > 0) await db.sql(`update search_list_run set status = case when status = 'done' then 'running' else status end, finished_at = null where id = $1`, [id]);
      return json(res, 200, { searches: s.rowCount ?? 0, websites: c.rowCount ?? 0, run: await runStatus(id) }), true;
    }
    if (method === 'POST' && action === 'trial') {
      if (run.status === 'running') return json(res, 409, { error: 'pause the list before a trial' }), true;
      const body = await readJson(req);
      const picks = Array.isArray(body.searches) ? body.searches as Array<{ idx?: unknown; worker?: unknown }> : [];
      const total = (run.searches as { total: number }).total;
      if (!picks.length || picks.length > 10 || picks.some((x) => !Number.isInteger(x.idx) || Number(x.idx) < 0 || Number(x.idx) >= total || typeof x.worker !== 'string' || !x.worker.trim()))
        throw invalid('send {searches: [{idx, worker}]}, 1 to 10 rows, idx counted from 0');
      const list = picks.map((x) => ({ idx: Number(x.idx), worker: String(x.worker).trim() }));
      void trial(id, list).catch((err: Error) => console.error(`[search-list] trial on ${id}: ${err.message}`));
      return json(res, 202, { started: list }), true;
    }
    if (method === 'GET' && action === 'companies.csv') {
      await sendCsv(res, id, url.searchParams.get('country'));
      return true;
    }
    return false;
  } catch (cause) {
    const err = cause as Error & { code?: string };
    if (res.headersSent) { res.destroy(err); return true; }
    return json(res, err.code === 'bad_request' ? 400 : 500, { error: err.message }), true;
  }
}

/** Every business of the run so far, a page of rows at a time, unchecked ones included. */
async function sendCsv(res: http.ServerResponse, runId: string, country: string | null): Promise<void> {
  const rows = await searchRows(runId);
  const want = country?.trim().toLowerCase() || null;
  res.writeHead(200, {
    'content-type': 'text/csv; charset=utf-8',
    'content-disposition': `attachment; filename="search-list-${runId}${want ? '-' + want.replace(/[^a-z0-9]+/g, '-') : ''}.csv"`,
    'cache-control': 'no-store',
  });
  res.write('﻿' + CSV_FIELDS.join(',') + '\n');
  let after = '';
  for (;;) {
    const page = (await db.sql<{ place_key: string; business: Record<string, unknown>; searches: number[]; contact: Record<string, unknown> | null; contact_status: string | null }>(`
      select place_key, business, searches, contact, contact_status from search_list_place
      where run_id = $1 and place_key > $2 order by place_key limit 2000`, [runId, after])).rows;
    if (!page.length) break;
    let chunk = '';
    for (const place of page) {
      const found = place.searches.map((i) => rows.get(i)).filter((s): s is SearchRow => Boolean(s));
      if (want && !found.some((s) => s.country.toLowerCase() === want)) continue;
      chunk += csvLine(place, found) + '\n';
    }
    if (chunk && !res.write(chunk)) await new Promise((resolve) => res.once('drain', resolve));
    after = page[page.length - 1]!.place_key;
  }
  res.end();
}
