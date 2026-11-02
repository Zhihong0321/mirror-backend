// In-hub Google Maps worker. Claims gmap.scan jobs and answers them from
// scraper.tech's Maps API, so a business search no longer needs the Mac mini's
// Chrome on a home line. Notes and measurements: docs/scraper-tech-maps.md.
//
// One call per query, limit up to 500. A single call is stable run to run;
// paging in steps of 100 is not, and offset past the first call adds almost
// nothing. One query tops out around 150-190 places, which is Google's ceiling,
// so the three territory keywords (business, factory, shop) and a location-only
// search become a keyword sweep: "<word> in <place>" for each word of the
// keyword's family until `max` places are in hand. Any other keyword (a company
// name, "solar installer") is still one call.
//
// A Business sweep then searches street by street. Measured on six Taman Daya
// streets, the 48-word sweep had found 204 of the 257 businesses on them (79%);
// the rest are niche shops no common keyword reaches. "shop in <street>" found
// the most new ones and "company in <street>" most of the remainder, so each
// street the sweep turned up costs two calls.
//
// The API never fails a search: an empty query is `status: ok` with no rows, a
// nonsense one returns the nearest business. So zero rows is a real answer
// (found: 0), and only a transport error or a non-ok status fails the job. The
// Mac mini's "an empty feed is never 0" rule was about a throttled IP, which
// this path does not have.
import { maps } from './core/index.ts';
import * as jobs from './jobs.ts';
import * as db from './reportdb.ts';

export const JOB_TYPE = 'gmap.scan';
export const WORKER_NAME = 'scraper-tech-maps';

export const DEFAULT_MAX = 200;
const MAX_LIMIT = 500;
const CALL_TIMEOUT_MS = 90_000;
const SWEEP_CONCURRENCY = 6;
/**
 * scraper.tech now and then answers one search with `"status": "failed"`. One
 * such answer among a sweep's hundreds threw the whole taman away and the
 * auto-scan ran it again and again (Taman Bukit Perdana, 3 times on
 * 2026-10-25). In a sweep a failed search is tried once more, then skipped; the
 * scan fails only when more than this share of its searches did.
 */
const MAX_FAILED_SHARE = 0.2;
const STREET_CONCURRENCY = 10;
export const STREET_FORMS = ['shop', 'company'];
/** Stop starting street calls this long before the job's lease runs out. */
const DEADLINE_MARGIN_MS = 60_000;
/** Below this share of rows naming the place, the place is not how Google writes addresses there: keep everything. */
export const AREA_MATCH_FLOOR = 0.3;

/**
 * Keyword families, each ordered by how many new in-area places a word added in
 * the 2026-10-24 sweeps of Kawasan Perindustrian Tebrau (industrial) and Taman
 * Daya (mixed). Near-synonyms that added almost nothing are left out:
 * "industrial" (+0/+4), "pharmacy" (+0).
 */
const FACTORY = [
  'factory', 'sdn bhd', 'food', 'company', 'manufacturer', 'manufacturing', 'construction',
  'engineering', 'warehouse', 'trading', 'furniture', 'wholesale', 'logistics', 'plastic',
  'machinery', 'steel', 'printing', 'packaging', 'supplier',
];
const SHOP = [
  'shop', 'restaurant', 'salon', 'car', 'store', 'laundry', 'clinic', 'bakery', 'kedai',
  'electronics', 'hardware', 'cafe', 'retail', 'mart', 'tyre', 'spa',
];
/** Every kind of business: the categories that each added most in Taman Daya, then both families. */
const BUSINESS = [...new Set([
  'restaurant', 'salon', 'factory', 'company', 'business', 'sdn bhd', 'construction', 'tuition',
  'car', 'shop', 'property', 'trading', 'services', 'wholesale', 'manufacturer', 'office',
  'workshop', 'agency', 'laundry', 'hotel', 'contractor', 'kindergarten', ...FACTORY, ...SHOP,
])];
export const FAMILIES: Record<string, string[]> = { business: BUSINESS, factory: FACTORY, shop: SHOP };

/** The words a search sweeps, or null for one plain call. */
export function familyFor(keyword: string): string[] | null {
  return keyword ? FAMILIES[keyword.trim().toLowerCase()] ?? null : BUSINESS;
}

const squash = (v: string): string => v.toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * The streets named in these addresses, most businesses first: the comma
 * segment that starts "Jalan" or "Jln" ("2-10, Jln Sagu 29, Taman Daya" gives
 * "Jalan Sagu 29"). Whole segments, so "Jalan Sagu 1" never stands in for 18.
 */
export function streetsOf(businesses: Business[]): string[] {
  const counts = new Map<string, { street: string; n: number }>();
  for (const b of businesses) {
    for (const part of String(b.address ?? '').split(',')) {
      const m = /^\s*(?:jalan|jln\.?)\s+(.+?)\s*$/i.exec(part);
      // A street fused with the rest of a garbled address ("Jalan Bukit Perdana
      // 2/573 jalan bukit perdana 2/5邮政编码: 83000") is not a street scraper.tech can search.
      if (!m || m[1]!.length > 40 || /[^\x20-\x7e]|\b\d{5}\b|\bjalan\b|\bjln\b/i.test(m[1]!)) continue;
      const street = 'Jalan ' + m[1]!.replace(/\s+/g, ' ');
      const key = squash(street);
      const hit = counts.get(key) ?? { street, n: 0 };
      hit.n++;
      counts.set(key, hit);
    }
  }
  return [...counts.values()].sort((a, b) => b.n - a.n).map((c) => c.street);
}

/**
 * The names a row's address must carry to be in this place: the first comma
 * segment, split on "/" ("Wadi Hana / Bukit Chagar / Tanjung Puteri, Johor Bahru").
 * Compared without spaces, so "SS5" matches "Jalan SS 5B/4".
 */
export function areaNames(place: string): string[] {
  return (place.split(',')[0] ?? '').split('/').map(squash).filter((n) => n.length >= 3);
}

/**
 * A sweep pulls in the neighbourhood: half of a Taman Daya sweep was other
 * tamans under the same postcode. Keep the rows whose address names the place,
 * unless too few do for the name to be how addresses are written there. The
 * neighbours are found again when their own taman is scanned.
 */
export function inArea(businesses: Business[], place: string): { kept: Business[]; outside: number } {
  const names = areaNames(place);
  if (!names.length) return { kept: businesses, outside: 0 };
  const kept = businesses.filter((b) => { const a = squash(b.address ?? ''); return names.some((n) => a.includes(n)); });
  if (kept.length < businesses.length * AREA_MATCH_FLOOR) return { kept: businesses, outside: 0 };
  return { kept, outside: businesses.length - kept.length };
}

type FetchImpl = typeof fetch;
export type MapsConfig = { key: string; baseUrl: string; lanes: number };
export type Business = {
  name: string; rating: number | null; reviews: number | null; category: string | null;
  address: string | null; phone: string | null; website: string | null; mapsUrl: string | null;
  place_id: string | null;
};
type Row = Record<string, unknown>;

function fail(message: string, code = 'engine_error'): Error {
  return Object.assign(new Error(message), { code });
}

function positive(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function resolveConfig(env: NodeJS.ProcessEnv = process.env): MapsConfig {
  return {
    ...maps.config(env),
    lanes: Math.max(1, Math.floor(positive(env.MAPS_LANES, 3))),
  };
}

export function laneName(index: number): string {
  return index === 0 ? WORKER_NAME : `${WORKER_NAME}-${index + 1}`;
}

const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
const count = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** One scraper.tech row in the shape gmap.mjs returns, so the hub persists both alike. */
export function toBusiness(row: Row): Business {
  const types = Array.isArray(row.types) ? row.types : [];
  const name = text(row.name) ?? '';
  // full_address often starts with the business name ("KULAI RS HARDWARE, No.292, …").
  const address = text(row.full_address);
  return {
    name,
    rating: count(row.rating),
    reviews: count(row.review_count),
    category: text(types[0]),
    address: address && name && address.startsWith(name + ', ') ? address.slice(name.length + 2) : address,
    phone: text(row.phone_number),
    website: text(row.website),
    mapsUrl: text(row.place_link),
    // scanPlaceKey prefers it, and it is the same id the mini read from `!19s`.
    place_id: text(row.place_id),
  };
}

/** One search_maps call. Retries once on a transport failure; a non-ok answer is final. */
export async function searchMaps(
  config: MapsConfig, query: string, limit: number, fetchImpl: FetchImpl = fetch,
): Promise<Row[]> {
  // The request itself goes through the app's core (core/maps.ts), which asks once more on a 5xx or a dropped connection.
  const data = await maps.call('search_maps', { query, limit: String(limit), country: 'my', lang: 'en' },
    { key: config.key, baseUrl: config.baseUrl, fetchImpl, timeoutMs: CALL_TIMEOUT_MS });
  if (!Array.isArray(data.data)) throw fail('scraper.tech search failed: ' + (data.message ?? JSON.stringify(data).slice(0, 200)));
  return data.data as Row[];
}

/**
 * The gmap.scan payload, answered. Same payload and result shape as
 * worker/gmap.mjs `scan`, so runBusinessSearch needs no provider branch.
 */
export async function scan(
  payload: Record<string, unknown> | null, config: MapsConfig, fetchImpl: FetchImpl = fetch,
  opts: { deadline?: number } = {},
): Promise<Record<string, unknown>> {
  const startedAt = Date.now();
  const locationOnly = payload?.searchMode === 'location_only';
  const keyword = locationOnly ? '' : String(payload?.keyword ?? '').trim();
  const place = locationOnly
    ? String(payload?.originalPlace ?? payload?.place ?? payload?.keyword ?? '').trim()
    : String(payload?.place ?? '').trim();
  if (!keyword && !place) throw fail('gmap.scan needs a keyword or place');
  const max = positive(payload?.max, DEFAULT_MAX);
  const limit = Math.min(max, MAX_LIMIT);

  const found = new Map<string, Business>();
  const add = (rows: Row[]): number => {
    let added = 0;
    for (const row of rows) {
      // A closed place is not a lead; it only costs a contact-research run.
      if (row.is_permanently_closed === true) continue;
      const business = toBusiness(row);
      if (!business.name) continue;
      const key = business.place_id ?? business.name + '|' + (business.address ?? '');
      if (found.has(key)) continue;
      found.set(key, business);
      added++;
    }
    return added;
  };

  let query: string;
  let requests = 0;
  let searches = 0;
  const skipped: string[] = [];
  let outsideArea = 0;
  // Every call is counted, a failed scan's too, so the monthly budget sees them.
  const call = (q: string, n: number): Promise<Row[]> => { requests++; return searchMaps(config, q, n, fetchImpl); };
  const tolerant = async (q: string): Promise<Row[]> => {
    searches++;
    let last: unknown = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        return await call(q, MAX_LIMIT);
      } catch (cause) {
        // A rate limit is not one bad search: stop and let the lane cool down.
        if ((cause as { code?: string }).code === 'rate_limit') throw cause;
        last = cause;
      }
    }
    skipped.push(q);
    console.warn(`[maps] skipped "${q}" after 2 failed tries: ${String((last as Error)?.message ?? last).slice(0, 120)}`);
    return [];
  };
  const tooManySkipped = () => skipped.length > Math.max(2, Math.floor(searches * MAX_FAILED_SHARE));
  let businesses: Business[];
  const sweep: Array<{ keyword: string; rows: number; added: number }> = [];
  let streets: { total: number; searched: number; added: number } | null = null;
  // A place name alone returns that one place, not the businesses in it, so a
  // location-only search sweeps too. A family keyword with no place is one call:
  // there is no area to sweep.
  const family = place ? familyFor(keyword) : null;
  try {
    if (family) {
      query = keyword ? `${keyword} in ${place}` : place;
      for (let i = 0; i < family.length; i += SWEEP_CONCURRENCY) {
        const batch = family.slice(i, i + SWEEP_CONCURRENCY);
        const answers = await Promise.all(batch.map((word) => tolerant(`${word} in ${place}`)));
        answers.forEach((rows, j) => sweep.push({ keyword: batch[j]!, rows: rows.length, added: add(rows) }));
        if (tooManySkipped()) throw fail(`${skipped.length} of ${searches} searches failed: ${skipped.slice(0, 3).join(' | ')}`);
        if (inArea([...found.values()], place).kept.length >= max) break;
      }
      if (family === FAMILIES.business && inArea([...found.values()], place).kept.length < max) {
        const list = streetsOf(inArea([...found.values()], place).kept);
        streets = { total: list.length, searched: 0, added: 0 };
        const deadline = opts.deadline ?? Infinity;
        for (let i = 0; i < list.length && Date.now() < deadline; i += STREET_CONCURRENCY) {
          const batch = list.slice(i, i + STREET_CONCURRENCY);
          const queries = batch.flatMap((street) => STREET_FORMS.map((form) => `${form} in ${street}, ${place}`));
          const answers = await Promise.all(queries.map((q) => tolerant(q)));
          streets.searched += batch.length;
          if (tooManySkipped()) throw fail(`${skipped.length} of ${searches} searches failed: ${skipped.slice(0, 3).join(' | ')}`);
          for (const rows of answers) streets.added += add(rows);
          if (inArea([...found.values()], place).kept.length >= max) break;
        }
      }
      const area = inArea([...found.values()], place);
      businesses = area.kept.slice(0, max);
      outsideArea = area.outside;
    } else {
      query = place ? `${keyword} in ${place}` : keyword;
      add(await call(query, limit));
      businesses = [...found.values()].slice(0, max);
    }
  } catch (cause) {
    throw Object.assign(cause as Error, { requests });
  }

  return {
    query,
    keyword,
    place: place || null,
    businesses,
    found: businesses.length,
    capped: businesses.length >= max,
    blocked: false,
    blockedReason: null,
    limitedView: false,
    categories: sweep.length ? sweep : null,
    outsideArea,
    streets,
    skippedSearches: skipped.length ? skipped : null,
    scrolls: 0,
    provider: 'scraper.tech',
    requests,
    tookMs: Date.now() - startedAt,
    at: new Date().toISOString(),
    storage: 'hub',
  };
}

async function lane(name: string, env: NodeJS.ProcessEnv): Promise<void> {
  for (;;) {
    try {
      const config = resolveConfig(env);
      // No key, no lane: liveTypes() must not count a worker that cannot answer,
      // or a business search queues a scan nobody will run.
      if (!config.key) {
        await new Promise((resolve) => setTimeout(resolve, 60_000));
        continue;
      }
      jobs.touch(name, '127.0.0.1', [JOB_TYPE]);
      const job = await jobs.take(name, { types: [JOB_TYPE], waitMs: 5_000 });
      if (!job) continue;
      const beat = setInterval(() => { jobs.touch(name, '127.0.0.1', [JOB_TYPE]); }, 20_000);
      beat.unref();
      try {
        const deadline = Date.parse(job.startedAt ?? new Date().toISOString()) + job.timeoutMs - DEADLINE_MARGIN_MS;
        const result = await scan(job.payload as Record<string, unknown> | null, config, fetch, { deadline });
        jobs.finish(job.id, true, result, null);
        // The monthly count the taman auto-scan budgets against.
        void db.addMapsUsage(Number(result.requests)).catch((e: Error) => console.warn('[maps] could not count usage: ' + e.message));
      } catch (cause) {
        const message = (cause as Error).message ?? String(cause);
        jobs.finish(job.id, false, null, message);
        const spent = Number((cause as { requests?: number }).requests);
        if (spent > 0) void db.addMapsUsage(spent).catch((e: Error) => console.warn('[maps] could not count usage: ' + e.message));
        if ((cause as { code?: string }).code === 'rate_limit') jobs.coolDown(name, 5 * 60_000, message);
      } finally {
        clearInterval(beat);
      }
    } catch (cause) {
      console.error(`[maps] ${name} ${(cause as Error).message ?? String(cause)}`);
      await new Promise((resolve) => setTimeout(resolve, 5_000));
    }
  }
}

/** MAPS_LANES lanes (default 3), each one scan at a time. Idle until SCRAPER_TECH_KEY is set. */
export function start(env: NodeJS.ProcessEnv = process.env): void {
  const lanes = resolveConfig(env).lanes;
  for (let i = 0; i < lanes; i++) void lane(laneName(i), env);
  console.log(`[maps] worker ${WORKER_NAME} claiming ${JOB_TYPE} on ${lanes} lane(s)` + (resolveConfig(env).key ? '' : ' (idle: no scraper.tech key on /workers)'));
}
