// Contact research on Tavily: Tavily finds the pages, and the fetch workers
// (pagefetch.ts: the Mac mini or a PC, Crawl4AI on a home line) read them.
// Not wired to the job queue: it lost the 2026-10-24 benchmark to the Exa
// pipeline and to v2 (fewer people). See docs/search-providers.md for the API notes behind it.
//
// 1. Three searches, all topic general and country malaysia: the name with its
//    address, the name with the roles and contact words we want, and LinkedIn
//    only. The first two ask for raw_content, which costs nothing extra, so the
//    directory and Facebook pages arrive already read.
// 2. The company's own site (the lead's website, or a hit whose host spells the
//    name): Map lists its pages, and a fetch worker reads the home page and the
//    ones whose path says contact, about, team or management. Never Tavily's
//    Extract: core/tavily.ts refuses it since 2026-11-01.
// 3. Pi extracts from those pages and the search snippets, as in v2.
import * as cw from './contact-worker.ts';
import { tavily } from './core/index.ts';
import * as pagefetch from './pagefetch.ts';

type FetchImpl = typeof fetch;
type PageReader = typeof pagefetch.read;

const SEARCH_RESULTS = 10;
const RAW_PAGE_CHARS = 8_000;
const MAX_SEARCH_PAGES = 8;
const MAP_LIMIT = 40;
/** PAYG price per credit, for the report's cost line. */
export const DOLLARS_PER_CREDIT = 0.008;

/** One Tavily call through the app's core (core/tavily.ts), which picks the key, rests a spent one and counts its credits. */
async function call<T>(endpoint: 'search' | 'map', body: Record<string, unknown>, fetchImpl: FetchImpl, timeoutMs = 45_000): Promise<T & { usage?: { credits?: number } }> {
  return await tavily.request(endpoint, body, { fetchImpl, timeoutMs }) as T & { usage?: { credits?: number } };
}

type RawResult = { url?: string; title?: string; content?: string; raw_content?: string | null; score?: number };

type SearchSpec = { purpose: cw.SearchLog['purpose']; query: string; body: Record<string, unknown> };

function searches(target: cw.Target): SearchSpec[] {
  const name = target.name.trim();
  const location = target.location.trim();
  const base = { topic: 'general', country: 'malaysia', max_results: SEARCH_RESULTS };
  return [
    {
      purpose: 'general',
      query: location ? `"${name}" ${location}` : `"${name}"`,
      body: { ...base, search_depth: 'advanced', chunks_per_source: 3, include_raw_content: 'text' },
    },
    {
      purpose: 'people',
      query: `"${name}" owner OR director OR "managing director" OR manager OR founder phone email`,
      body: { ...base, search_depth: 'advanced', chunks_per_source: 3, include_raw_content: 'text' },
    },
    {
      purpose: 'linkedin',
      query: `"${cw.coreName(name)}" director OR manager OR owner OR founder Malaysia`,
      body: { ...base, search_depth: 'basic', chunks_per_source: 3, include_domains: ['linkedin.com'] },
    },
  ];
}

type Found = { searched: cw.Searched; pages: cw.Page[]; credits: number };

async function runSearches(target: cw.Target, fetchImpl: FetchImpl): Promise<Found> {
  const specs = searches(target);
  const answers = await Promise.all(specs.map((spec) =>
    call<{ results?: RawResult[] }>('search', { query: spec.query, ...spec.body }, fetchImpl)
      .catch((cause: Error) => {
        // LinkedIn is a bonus; the two general searches must answer.
        if (spec.purpose === 'linkedin') return { results: [] as RawResult[], usage: { credits: 0 } };
        throw cause;
      })));
  const sources: cw.Source[] = [];
  const pages: cw.Page[] = [];
  const log: cw.SearchLog[] = [];
  let credits = 0;
  answers.forEach((answer, i) => {
    const spec = specs[i]!;
    const results = answer.results ?? [];
    const spent = answer.usage?.credits ?? (spec.body.search_depth === 'advanced' ? 2 : 1);
    credits += spent;
    log.push({ provider: 'tavily', purpose: spec.purpose, query: spec.query, results: results.length, credits: spent });
    const hits = results.map((row) => ({ url: String(row.url ?? ''), title: clean(row.title, 200), content: clean(row.content, 600) }));
    const found = cw.toSources(target, hits, 'tavily');
    sources.push(...(spec.purpose === 'linkedin' ? found.map((source) => ({ ...source, kind: 'social' })) : found));
    for (const row of results) {
      const url = cw.publicUrl(row.url);
      const text = String(row.raw_content ?? '').trim();
      if (!url || !text || cw.isLinkedinPerson(url) || cw.isJobAdvertisement(url) || cw.isStalePdf(url)) continue;
      pages.push({ url, text: text.slice(0, RAW_PAGE_CHARS) });
    }
  });
  return { searched: { sources: dedupeSources(sources), queries: specs.map((spec) => spec.query), log }, pages: dedupePages(pages).slice(0, MAX_SEARCH_PAGES), credits };
}

function clean(value: unknown, max: number): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function dedupeSources(sources: cw.Source[]): cw.Source[] {
  const seen = new Set<string>();
  return sources.filter((source) => {
    const key = cw.dedupeKey(source.url);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function dedupePages(pages: cw.Page[]): cw.Page[] {
  const seen = new Set<string>();
  return pages.filter((page) => {
    const key = cw.dedupeKey(page.url);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}


/** Map the company's site, then have a fetch worker read the home page and its contact, about and team pages. */
async function readSite(site: string, fetchImpl: FetchImpl, readPages: PageReader): Promise<{ pages: cw.Page[]; log: cw.SearchLog[]; credits: number }> {
  const log: cw.SearchLog[] = [];
  let credits = 0;
  let mapped: string[] = [];
  try {
    const host = new URL(site).hostname.replace(/^www\./, '').replace(/\./g, '\\.');
    const map = await call<{ results?: string[] }>('map', {
      url: site, max_depth: 2, max_breadth: 30, limit: MAP_LIMIT, allow_external: false,
      select_domains: [`^(www\\.)?${host}$`], timeout: 30,
    }, fetchImpl);
    mapped = Array.isArray(map.results) ? map.results.filter((url) => typeof url === 'string') : [];
    const spent = map.usage?.credits ?? Math.ceil(mapped.length / 10);
    credits += spent;
    log.push({ provider: 'tavily', purpose: 'site', query: 'map ' + site, results: mapped.length, credits: spent });
  } catch (cause) {
    log.push({ provider: 'tavily', purpose: 'site', query: `map ${site} (failed: ${(cause as Error).message.slice(0, 80)})`, results: 0, credits: 0 });
    if ((cause as { code?: string }).code === 'quota' || (cause as { code?: string }).code === 'rate_limit') throw cause;
  }
  const urls = cw.pickSitePages(site, mapped);
  const read = await readOnWorker(urls, readPages);
  log.push({ provider: 'fetch-worker', purpose: 'extract', query: `read ${urls.length} page(s) of ${site}${read.worker ? ' on ' + read.worker : ''}${read.error ? ' (failed: ' + read.error.slice(0, 80) + ')' : ''}`, results: read.pages.length, credits: 0 });
  return { pages: read.pages, log, credits };
}

/**
 * The site's pages, read by a fetch worker for nothing. Crawl4AI renders
 * JavaScript itself, so there is no basic-then-advanced retry as Tavily needed.
 * A worker that is down or fails loses the site pages, not the company: the
 * search pages still carry the research.
 */
async function readOnWorker(urls: string[], readPages: PageReader): Promise<{ pages: cw.Page[]; worker: string | null; error: string | null }> {
  if (!urls.length) return { pages: [], worker: null, error: null };
  try {
    const out = await readPages(urls);
    const pages = out.results.flatMap((row): cw.Page[] => {
      const url = cw.publicUrl(row.url);
      const text = String(row.raw_content ?? '').trim();
      return url && text ? [{ url, text: text.slice(0, RAW_PAGE_CHARS) }] : [];
    });
    return { pages, worker: out.worker, error: null };
  } catch (cause) {
    return { pages: [], worker: null, error: (cause as Error).message };
  }
}

/** One company through the Tavily pipeline with one key. Same result shape as contact-worker's research(). */
export async function research(raw: unknown, deps: { fetchImpl?: FetchImpl; timeoutMs?: number; readPages?: PageReader }): Promise<Record<string, unknown>> {
  const target = cw.targetFromPayload(raw);
  const fetchImpl = deps.fetchImpl ?? fetch;
  const found = await runSearches(target, fetchImpl);
  const site = cw.officialSite(target, found.searched.sources);
  const siteRead = site ? await readSite(site, fetchImpl, deps.readPages ?? pagefetch.read) : { pages: [], log: [], credits: 0 };
  // Site pages first: they are the company's own words.
  const pages = dedupePages([...siteRead.pages, ...found.pages]);
  const searched: cw.Searched = { ...found.searched, log: [...found.searched.log, ...siteRead.log] };
  const pageFoundBy = new Map(pages.map((page) => [cw.dedupeKey(page.url), 'tavily']));
  const result = await cw.extractResult(target, searched, pages, deps.timeoutMs ?? cw.resolveConfig().timeoutMs, pages.map((page) => page.url), pageFoundBy);
  const credits = found.credits + siteRead.credits;
  const meta = result.research_meta as Record<string, unknown>;
  meta.engine = 'tavily pipeline + ' + String(meta.engine).split(' + ').pop();
  meta.pipeline = 'tavily';
  meta.official_site = site || null;
  meta.cost = { tavily_credits: credits, dollars: Number((credits * DOLLARS_PER_CREDIT).toFixed(4)) };
  return result;
}
