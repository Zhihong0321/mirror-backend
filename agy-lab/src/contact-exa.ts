// Contact research on Exa alone: Exa finds the pages and Exa reads them.
// The contact worker's first choice: contact-worker.ts runs it while an Exa key
// has credits and falls back to v2 on Tavily otherwise. See docs/search-providers.md
// for the API notes and the benchmark behind it.
//
// 1. Searches, all with userLocation MY: the name with its address, with full
//    text and highlights aimed at phones, emails and roles (the first ten
//    results' contents come in the search price); the people category, whose
//    results carry work history (name, title, company); and, when the lead has
//    no website, the company category to find the company's own site.
// 2. /contents on that site: the home page with its links, then the contact,
//    about and team pages those links point to. tel:, mailto: and wa.me links
//    are added to the page text, since a page's text often leaves them out.
// 3. Pi extracts from those pages and the search snippets, as in v2.
import * as cw from './contact-worker.ts';
import { exa } from './core/index.ts';

type FetchImpl = typeof fetch;

const SEARCH_RESULTS = 10;
const PAGE_CHARS = 8_000;
const MAX_SEARCH_PAGES = 8;
const HIGHLIGHT_QUERY = 'phone number, mobile, WhatsApp, email address, owner, director, manager, founder';

type ExaResult = {
  url?: string;
  title?: string;
  text?: string;
  highlights?: string[];
  entities?: Array<Record<string, unknown>>;
  subpages?: ExaResult[];
};
type ExaAnswer = { results?: ExaResult[]; costDollars?: { total?: number }; statuses?: Array<{ id?: string; status?: string }> };

/** One Exa call through the app's core (core/exa.ts), which picks the key, rests a spent one and tries the next. */
async function call(endpoint: string, body: Record<string, unknown>, fetchImpl: FetchImpl, timeoutMs = 45_000): Promise<ExaAnswer> {
  try {
    return await exa.request(endpoint, body, { fetchImpl, timeoutMs }) as ExaAnswer;
  } catch (cause) {
    // An Exa error carries provider 'exa', so the worker can tell it from a model error and fall back to Tavily.
    throw Object.assign(cause as Error, { provider: 'exa' });
  }
}

function clean(value: unknown, max: number): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

type Props = Record<string, unknown>;

/**
 * A people-category result as one line Pi can read: the name, then each job in
 * its work history that is still open ("present"), as printed by Exa. Old jobs
 * are left out so Pi does not take a former role as a current one.
 */
export function personLine(result: ExaResult): string {
  const entity = (result.entities ?? []).find((row) => /person/i.test(String(row.type ?? 'person')));
  const props = (entity?.properties ?? entity ?? {}) as Props;
  const name = clean(props.name, 120);
  if (!name) return '';
  const jobs = (Array.isArray(props.workHistory) ? props.workHistory : []) as Props[];
  const current = jobs.filter((job) => {
    const dates = (job.dates ?? {}) as Props;
    return !dates.to;
  }).map((job) => {
    const company = clean(((job.company ?? {}) as Props).name, 120);
    return [clean(job.title, 120), company && `at ${company}`].filter(Boolean).join(' ');
  }).filter(Boolean);
  const location = clean(props.location, 80);
  return `${name}${current.length ? ' — now: ' + current.slice(0, 3).join('; ') : ''}${location ? ' — ' + location : ''}`;
}

/** A company-category result's own site, when its entity says the company is in Malaysia. */
function companyHome(result: ExaResult): string {
  const entity = (result.entities ?? [])[0];
  const props = (entity?.properties ?? entity ?? {}) as Props;
  const country = clean(((props.headquarters ?? {}) as Props).country, 60);
  if (country && !/malaysia|^my$/i.test(country)) return '';
  try { return new URL(String(result.url)).origin + '/'; } catch { return ''; }
}

type Spec = { purpose: cw.SearchLog['purpose']; query: string; body: Record<string, unknown> };

function searches(target: cw.Target): Spec[] {
  const name = target.name.trim();
  const location = target.location.trim();
  const place = location ? `${name}, ${location}` : name;
  const specs: Spec[] = [
    {
      purpose: 'general',
      query: `${place} Malaysia contact phone email`,
      body: {
        type: 'auto', numResults: SEARCH_RESULTS, userLocation: 'MY',
        contents: { text: { maxCharacters: PAGE_CHARS }, highlights: { query: HIGHLIGHT_QUERY, maxCharacters: 1_500 } },
      },
    },
    {
      purpose: 'people',
      query: `professional profiles of the owner, founder, director or manager at ${cw.coreName(name)}, Malaysia`,
      body: { type: 'auto', category: 'people', numResults: SEARCH_RESULTS, userLocation: 'MY', contents: { highlights: { maxCharacters: 800 } } },
    },
  ];
  if (!cw.publicUrl(target.website) || cw.isSearchPage(target.website)) {
    specs.push({
      purpose: 'site',
      query: `${place} Malaysia company homepage`,
      body: { type: 'auto', category: 'company', numResults: 5, userLocation: 'MY' },
    });
  }
  return specs;
}

type Found = { searched: cw.Searched; pages: cw.Page[]; dollars: number; companySites: string[] };

async function runSearches(target: cw.Target, fetchImpl: FetchImpl): Promise<Found> {
  const specs = searches(target);
  const answers = await Promise.all(specs.map((spec) =>
    call('search', { query: spec.query, ...spec.body }, fetchImpl).catch((cause: Error) => {
      // People and company searches are a bonus; the general search must answer.
      if (spec.purpose !== 'general') return { results: [], costDollars: { total: 0 }, failed: cause.message } as ExaAnswer;
      throw cause;
    })));
  const sources: cw.Source[] = [];
  const pages: cw.Page[] = [];
  const log: cw.SearchLog[] = [];
  const companySites: string[] = [];
  let dollars = 0;
  answers.forEach((answer, i) => {
    const spec = specs[i]!;
    const results = answer.results ?? [];
    const spent = answer.costDollars?.total ?? 0;
    dollars += spent;
    log.push({ provider: 'exa', purpose: spec.purpose, query: spec.query, results: results.length, dollars: spent });
    if (spec.purpose === 'site') {
      companySites.push(...results.map(companyHome).filter(Boolean));
      return;
    }
    const hits = results.map((row) => {
      const highlights = (row.highlights ?? []).join(' … ');
      const content = spec.purpose === 'people' ? [personLine(row), highlights].filter(Boolean).join(' | ') : highlights;
      return { url: String(row.url ?? ''), title: clean(row.title, 200), content: clean(content, 600) };
    });
    const found = cw.toSources(target, hits, 'exa');
    sources.push(...(spec.purpose === 'people' ? found.map((source) => ({ ...source, kind: 'social' })) : found));
    if (spec.purpose !== 'general') return;
    for (const row of results) {
      const url = cw.publicUrl(row.url);
      const text = String(row.text ?? '').trim();
      if (!url || !text || cw.isLinkedinPerson(url) || cw.isJobAdvertisement(url) || cw.isStalePdf(url)) continue;
      pages.push({ url, text: text.slice(0, PAGE_CHARS) });
    }
  });
  return {
    searched: { sources: dedupe(sources, (s) => s.url), queries: specs.map((spec) => spec.query), log },
    pages: dedupe(pages, (p) => p.url).slice(0, MAX_SEARCH_PAGES),
    dollars,
    companySites,
  };
}

function dedupe<T>(rows: T[], urlOf: (row: T) => string): T[] {
  const seen = new Set<string>();
  return rows.filter((row) => {
    const key = cw.dedupeKey(urlOf(row));
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** The tel:, mailto: and WhatsApp links a page carries, which its text often leaves out. */
export function contactLinks(links: string[]): string[] {
  return [...new Set(links.filter((link) => /^(?:tel:|mailto:|https?:\/\/(?:wa\.me|api\.whatsapp\.com)\/)/i.test(link))
    .map((link) => decodeURIComponent(link.replace(/[?#].*$/, '')).slice(0, 120)))].slice(0, 12);
}

function pageOf(row: ExaResult & { extras?: { links?: string[] } }): cw.Page | null {
  const url = cw.publicUrl(row.url);
  const text = String(row.text ?? '').trim();
  if (!url || !text) return null;
  const links = contactLinks(row.extras?.links ?? []);
  return { url, text: text.slice(0, PAGE_CHARS) + (links.length ? '\nContact links on this page: ' + links.join(' ') : '') };
}

/**
 * The company's own site, read by Exa in two calls: the home page with its
 * links, then the pages those links point to whose path says contact, about,
 * team or management. Exa's own subpageTarget picked mailto: and wa.me links
 * over /contact and /about-us on the sites we tried, so the pick is ours.
 */
async function readSite(site: string, fetchImpl: FetchImpl): Promise<{ pages: cw.Page[]; log: cw.SearchLog[]; dollars: number }> {
  const log: cw.SearchLog[] = [];
  const pages: cw.Page[] = [];
  let dollars = 0;
  try {
    const home = await call('contents', {
      urls: [site], text: { maxCharacters: PAGE_CHARS }, extras: { links: 200 }, livecrawlTimeout: 15_000,
    }, fetchImpl, 60_000);
    const row = (home.results ?? [])[0] as (ExaResult & { extras?: { links?: string[] } }) | undefined;
    const homePage = row ? pageOf(row) : null;
    if (homePage) pages.push(homePage);
    dollars += home.costDollars?.total ?? 0;
    const links = row?.extras?.links ?? [];
    log.push({ provider: 'exa', purpose: 'site', query: `contents ${site} with links`, results: links.length, dollars: home.costDollars?.total ?? 0 });
    const more = cw.pickSitePages(site, links).slice(1);
    if (more.length) {
      const rest = await call('contents', { urls: more, text: { maxCharacters: PAGE_CHARS }, extras: { links: 200 }, livecrawlTimeout: 15_000 }, fetchImpl, 60_000);
      for (const sub of rest.results ?? []) {
        const page = pageOf(sub as ExaResult & { extras?: { links?: string[] } });
        if (page) pages.push(page);
      }
      dollars += rest.costDollars?.total ?? 0;
      log.push({ provider: 'exa', purpose: 'extract', query: `contents ${more.length} page(s) of ${site}`, results: (rest.results ?? []).length, dollars: rest.costDollars?.total ?? 0 });
    }
  } catch (cause) {
    const code = (cause as { code?: string }).code;
    if (code === 'quota' || code === 'rate_limit') throw cause;
    log.push({ provider: 'exa', purpose: 'extract', query: `contents ${site} (failed: ${(cause as Error).message.slice(0, 80)})`, results: 0, dollars: 0 });
  }
  return { pages: dedupe(pages, (p) => p.url), log, dollars };
}

/** One company through the Exa pipeline with one key. Same result shape as contact-worker's research(). */
export async function research(raw: unknown, deps: { fetchImpl?: FetchImpl; timeoutMs?: number }): Promise<Record<string, unknown>> {
  const target = cw.targetFromPayload(raw);
  const fetchImpl = deps.fetchImpl ?? fetch;
  const found = await runSearches(target, fetchImpl);
  // The lead's website, else a general hit whose host spells the name, else the company search's Malaysian hit.
  const site = cw.officialSite(target, found.searched.sources) || found.companySites.find((url) =>
    cw.officialSite({ ...target, website: '' }, [{ url, kind: 'other', why: '' }])) || '';
  const siteRead = site ? await readSite(site, fetchImpl) : { pages: [], log: [], dollars: 0 };
  const pages = dedupe([...siteRead.pages, ...found.pages], (p) => p.url);
  const searched: cw.Searched = { ...found.searched, log: [...found.searched.log, ...siteRead.log] };
  const pageFoundBy = new Map(pages.map((page) => [cw.dedupeKey(page.url), 'exa']));
  const result = await cw.extractResult(target, searched, pages, deps.timeoutMs ?? cw.resolveConfig().timeoutMs, pages.map((page) => page.url), pageFoundBy);
  const dollars = found.dollars + siteRead.dollars;
  const meta = result.research_meta as Record<string, unknown>;
  meta.engine = 'exa pipeline + ' + String(meta.engine).split(' + ').pop();
  meta.pipeline = 'exa';
  meta.official_site = site || null;
  meta.cost = { dollars: Number(dollars.toFixed(4)) };
  return result;
}
