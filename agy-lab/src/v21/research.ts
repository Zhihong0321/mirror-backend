import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadChecklist, type ResearchPrompt } from './catalog.ts';
import { braveSearch, tavilySearch, mapsSearch, workerFetch, linkedinCompanyExa, type BraveHit, type TavilyHit } from './cloud.ts';
import { readWebPage, type PageResult } from './reader.ts';
import { siteLookupOn, loadHandlers, handlerFor, siteLookup, naverPlaceSearch, type HandlerEntry, type SiteLookupResult, type NaverPlace } from './site-lookup.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
// On the hub (production) the checkpoints go to the /data volume, which outlives a redeploy.
const runsDir = process.env.V21_RUNS_DIR || (process.env.NODE_ENV === 'production' ? '/data/v21-runs' : path.resolve(here, 'runs'));

export type ResearchInput = {
  company: string;
  country: string;
  industry: string;
  website?: string;
};

export type OfficialPageData = {
  url: string;
  label: 'home' | 'about' | 'contact';
  status: 'ok' | 'blocked' | 'error' | 'empty';
  charCount: number;
  markdown: string;
  method: string;
};

// Step 1 gathers only: each probe keeps the query it ran and what came back. Judging is Step 2's job.
export type ProbeResult = {
  rank: number;
  category: string;
  question: string;
  why_it_matters: string;
  source: {
    name: string;
    url: string;
    type: string;
  };
  how_to_query: string;
  query_type?: string;
  applies_when?: string;
  /** The search run, or the address read. Empty when the probe was not run. */
  query: string;
  evidence_urls: string[];
  snippets: string[];
  /** url_template and static_list: the page read, whole (up to the reader's limit). */
  page?: { url: string; status: string; charCount: number; truncated: boolean; text: string };
  /** Why the probe was not run (manual source, missing registration number). */
  not_run?: string;
  /** Site lookup on (the default; V21_SITE_LOOKUP=off turns it off) and the site has a verified handler: what the handler returned on a worker PC. When the
   *  lookup did not run (job_status failed), a url_template / static_list page is read on the worker; anything
   *  else is not run. */
  lookup?: SiteLookupResult;
  found_when?: string;
  not_found_when?: string;
  couldnt_check_when?: string;
};

export type RawResearchCheckpoint = {
  version: '2.1';
  stage: 1;
  created_at: string;
  input: ResearchInput;
  /** Old rows only (before 2026-11-11): no official site was confirmed and nothing else was gathered. */
  skipped?: string;
  /** Searches that failed (spent keys, service down): recorded, so a failure is never read as 'no results'. */
  search_errors?: string[];
  /** Set when the checkpoint file could not be written to disk; the data itself is kept and stored in the database. */
  save_error?: string;
  catalog: {
    country: string;
    industry: string;
    prompt_count: number;
    /** How many of the prompts are the country layer's (V21_COUNTRY_LAYER=on); absent in older checkpoints. */
    country_layer_count?: number;
  };
  official_site: {
    domain: string;
    resolved_url: string;
    /** Every candidate the gate tried and what it returned, kept even when one passes (a given site that fails is itself evidence). */
    tried: string[];
    pages: OfficialPageData[];
    /** Set when no candidate was confirmed as the official site: research still runs, the report is labelled. */
    not_confirmed?: string;
  };
  third_party_discoveries: Array<{
    url: string;
    title: string;
    snippets: string[];
    source: string;
    query: string;
  }>;
  probes: ProbeResult[];
  /** The Gmap worker's answer, raw: which listing is theirs is Step 2's call. */
  google_maps?: { query: string; status: string; worker?: string; result?: unknown; error?: string };
  /** South Korea: Naver Place listings for the Maps query, raw, every listing Naver returned. */
  naver_place?: { query: string; status: string; places: NaverPlace[]; error?: string };
  /** The company's LinkedIn page as the worker read it, raw (website, phone, HQ, founded, industry, type, size). */
  linkedin?: { url: string; status: string; worker?: string; result?: unknown; error?: string };
  /** Every outside page the searches found, read on the worker: the page text, not only the search snippet. */
  third_party_pages?: ThirdPartyPage[];
};

export type ThirdPartyPage = {
  url: string;
  status: PageResult['status'];
  charCount: number;
  truncated: boolean;
  text: string;
  error?: string;
};

// An outside page is kept up to this long: a directory or job page carries the company's entry well before this.
const THIRD_PARTY_MAX_CHARS = 60_000;
// Pages read at the same time on the worker: one slow page does not hold up the rest.
const THIRD_PARTY_PARALLEL = 4;

/** Read every outside page the searches found (owner, 2026-11-06: Step 1 reads what it finds; a snippet is too thin
 *  for Step 2 to compare). Each URL once. Skipped: the official domain (its pages are read above), LinkedIn (read
 *  through Exa) and Google Maps (its own search). Every page goes through the local worker; there is no paid reader. */
async function readThirdPartyPages(urls: string[], officialDomain: string, log: (msg: string) => void): Promise<ThirdPartyPage[]> {
  const seen = new Set<string>();
  const list: string[] = [];
  for (const url of urls) {
    const domain = cleanDomain(url);
    if (!domain || domain === officialDomain || domain.endsWith('.' + officialDomain)) continue;
    if (/(^|\.)linkedin\.com$/.test(domain) || (/(^|\.)google\.[a-z.]+$/.test(domain) && /\/maps/.test(url))) continue;
    const key = url.replace(/#.*$/, '').replace(/\/$/, '');
    if (seen.has(key)) continue;
    seen.add(key);
    list.push(url);
  }
  log(`Reading ${list.length} outside pages found by the searches`);
  const out: ThirdPartyPage[] = new Array(list.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(THIRD_PARTY_PARALLEL, list.length) }, async () => {
      while (next < list.length) {
        const i = next++;
        const page = await readWebPage(list[i], THIRD_PARTY_MAX_CHARS);
        out[i] = {
          url: list[i],
          status: page.status,
          charCount: page.markdown.length,
          truncated: page.truncated ?? false,
          text: page.markdown,
          ...(page.error ? { error: page.error } : {}),
        };
        log(`Outside page ${page.status}: ${list[i]} (${page.markdown.length} chars)`);
      }
    }),
  );
  return out;
}

// Where an owner does not look: what customers and staff say, and the press.
const COVERAGE_QUERIES = [
  (name: string, country: string) => `"${name}" ${country} reviews`,
  (name: string, country: string) => `"${name}" ${country} employee reviews`,
  (name: string, country: string) => `"${name}" ${country} news`,
];

/** Countries searched in their own language: Brave's country and language codes, and the local words for the
 *  identity, coverage and Maps searches. The name searched is the local-script name without its legal form. */
type LocalSearch = { code: string; lang: string; site: string; coverage: string[]; countryWord: string };
const LOCAL_SEARCH: Record<string, LocalSearch> = {
  'south korea': { code: 'KR', lang: 'ko', site: '홈페이지', coverage: ['후기', '기업리뷰 잡플래닛', '뉴스'], countryWord: '한국' },
};

/** Hangul in Revised Romanization, syllable by syllable (은민에스엔디 -> eunminesuendi): Korean sites often use the
 *  romanised name as their domain (eunmin.co.kr). No sound-change rules: it only has to match a domain name. */
const RR_INITIAL = ['g', 'kk', 'n', 'd', 'tt', 'r', 'm', 'b', 'pp', 's', 'ss', '', 'j', 'jj', 'ch', 'k', 't', 'p', 'h'];
const RR_MEDIAL = ['a', 'ae', 'ya', 'yae', 'eo', 'e', 'yeo', 'ye', 'o', 'wa', 'wae', 'oe', 'yo', 'u', 'wo', 'we', 'wi', 'yu', 'eu', 'ui', 'i'];
const RR_FINAL = ['', 'k', 'k', 'k', 'n', 'n', 'n', 't', 'l', 'k', 'm', 'l', 'l', 'l', 'p', 'l', 'm', 'p', 'p', 't', 't', 'ng', 't', 't', 'k', 't', 'p', 't'];
function romanizeKo(text: string): string {
  let out = '';
  for (const ch of text) {
    const c = ch.charCodeAt(0) - 0xac00;
    if (c < 0 || c > 11171) continue;
    out += RR_INITIAL[Math.floor(c / 588)] + RR_MEDIAL[Math.floor((c % 588) / 28)] + RR_FINAL[c % 28];
  }
  return out;
}

/** Korean legal forms, written before or after the name: (주), 주식회사, 세무법인 ... */
const LEGAL_KO = /\(주\)|㈜|주식회사|유한책임회사|유한회사|합자회사|합명회사|사단법인|재단법인|세무법인|회계법인|법무법인/g;

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9가-힣]+/g, '-').replace(/^-|-$/g, '') || 'company';
}

function cleanDomain(rawUrl: string): string {
  try {
    let u = rawUrl.trim();
    if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
    return new URL(u).hostname.replace(/^www\./i, '');
  } catch {
    return '';
  }
}

/** Company name without its legal suffix, lower case, single spaces, normalized punctuation. */
function brandName(company: string): string {
  return company
    .toLowerCase()
    .replace(/\b(sdn\.?\s*bhd\.?|bhd\.?|plt|pte\.?\s*ltd\.?|ltd\.?|llc|inc\.?)\b/g, '')
    .replace(LEGAL_KO, ' ')
    .replace(/[^a-z0-9가-힣]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** A domain's own name, without subdomains or suffix: dnelogistics.com.my -> dnelogistics, x.contact.page -> contact. */
function mainLabel(domain: string): string {
  const parts = domain.split('.');
  parts.pop();
  if (parts.length > 1 && /^(com|net|org|co|gov|edu)$/.test(parts[parts.length - 1])) parts.pop();
  return (parts.pop() ?? '').replace(/[^a-z0-9]/g, '');
}

/** Same-domain links on a page whose path says about or contact, first of each. */
function aboutContactLinks(
  markdown: string,
  domain: string,
  extraUrls: string[] = [],
): Array<[string, 'about' | 'contact']> {
  const found = new Map<'about' | 'contact', string>();
  const dLabel = mainLabel(domain);

  const testUrl = (url: string, text = '') => {
    const uDom = cleanDomain(url);
    const uLabel = mainLabel(uDom);
    const isSameSite =
      uDom === domain ||
      (uLabel &&
        dLabel &&
        (dLabel.includes(uLabel) || uLabel.includes(dLabel)) &&
        Math.min(uLabel.length, dLabel.length) >= 3);
    if (!isSameSite) return;
    try {
      const p = new URL(url).pathname.toLowerCase();
      // The path, or the link's own text (Korean sites: 회사소개, 오시는 길, under paths like /sub01.php).
      if (!found.has('about') && (/about|profile|our-story/.test(p) || /회사\s*소개|기업\s*소개|회사\s*개요|인사말/.test(text))) found.set('about', url);
      if (!found.has('contact') && (/contact/.test(p) || /오시는\s*길|찾아\s*오시는|연락처|문의하기|고객\s*문의/.test(text))) found.set('contact', url);
    } catch {}
  };

  // Absolute links, and links relative to the site (the reader keeps "/sub01/sub_01.php" as written).
  for (const m of markdown.matchAll(/\[([^\]]*)\]\(((?:https?:\/\/|\/)[^)\s]+)/g)) {
    try {
      testUrl(new URL(m[2], `https://${domain}/`).href, m[1]);
    } catch {}
  }
  for (const u of extraUrls) {
    testUrl(u);
  }
  return [...found].map(([label, url]) => [url, label]);
}

/** Town and state from the first postcode address on the site (e.g. "41200 Klang, Selangor" -> "Klang, Selangor", "South Melbourne VIC 3205" -> "South Melbourne, VIC"). */
function siteTown(markdown: string, country: string): string {
  const text = markdown.replace(/\]\([^)]*\)/g, ']');
  // Malaysia: 5-digit postcode followed by town and state
  const mMY = text.match(/\b\d{5}\s+([A-Z][A-Za-z'. ]{2,40}?)(?:\s*,\s*([A-Z][A-Za-z ]{2,30}?))?\s*(?:[,.\n|*]|$)/);
  if (mMY) {
    const res = [mMY[1], mMY[2]].filter((x) => x && x.trim().toLowerCase() !== country.toLowerCase()).join(', ').trim();
    if (res) return res;
  }
  // Australia: suburb, STATE, 4-digit postcode ("South Melbourne, VIC, 3205"; "Bondi Junction\nNSW 2022").
  // The suburb never spans a line; the state is upper case.
  const mAU = text.match(/\b([A-Z][A-Za-z ]{2,25}?),?\s+(VIC|NSW|QLD|WA|SA|TAS|ACT|NT),?\s+\d{4}\b/);
  if (mAU) {
    return `${mAU[1].trim()}, ${mAU[2]}`;
  }
  // South Korea: province or city, then its city or district ("경기도 수원시 영통구" -> "경기 수원시 영통구").
  const mKR = text.match(/(서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충북|충남|충청북|충청남|전북|전남|전라북|전라남|경북|경남|경상북|경상남|제주)[가-힣]*\s+([가-힣]{1,4}[시군구])(?:\s+([가-힣]{1,4}구))?/);
  if (mKR) {
    return [mKR[1], mKR[2], mKR[3]].filter(Boolean).join(' ');
  }
  return '';
}

/** The first LinkedIn company page among the URLs whose name carries the whole brand, else its first word,
 *  as https://www.linkedin.com/company/<name>/ ("au.linkedin.com/company/digital-next-australia?trk=x"). */
function linkedinCompanyUrl(urls: string[], brandCompact: string, brandToken: string, domainLabel = ''): string {
  const slugs = urls
    .map((u) => u.match(/linkedin\.com\/company\/([^/?#]+)/i)?.[1]?.toLowerCase())
    .filter((s): s is string => Boolean(s));
  const compact = (s: string) => s.replace(/[^a-z0-9]/g, '');
  const slug =
    slugs.find((s) => brandCompact && compact(s).includes(brandCompact)) ??
    slugs.find((s) => brandToken.length >= 3 && compact(s).includes(brandToken)) ??
    // A name with no Latin letters (Korean): a slug that is part of the official domain's name (heum in heumtax).
    slugs.find((s) => domainLabel && compact(s).length >= 4 && domainLabel.includes(compact(s)));
  return slug ? `https://www.linkedin.com/company/${slug}/` : '';
}

/** Step 1: confirm the official site, read it, then search where the owner does not look */
export async function runStep1Research(
  input: ResearchInput,
  onProgress?: (msg: string) => void,
): Promise<{ checkpointPath: string; data: RawResearchCheckpoint }> {
  const log = (msg: string) => {
    if (onProgress) onProgress(msg);
    else console.log(`[Step 1 Research] ${msg}`);
  };

  const { company, country, industry } = input;
  const brand = brandName(company);
  log(`Starting research for "${company}" (${country}, ${industry})`);

  const checklist = loadChecklist(country, industry);
  const prompts: ResearchPrompt[] = checklist?.prompts ?? [];
  if (!checklist) log(`Warning: No specific checklist found for ${country} / ${industry}`);
  else log(`Loaded ${prompts.length - checklist.countryLayerCount} industry prompts and ${checklist.countryLayerCount} country-layer prompts from catalog`);

  // A country searched in its own language: the local-script name without its legal form, local words, and Brave's
  // country and language set. Every other country: the name as given, English words, the country in the query.
  const local = LOCAL_SEARCH[country.trim().toLowerCase()];
  const searchName = local ? company.replace(LEGAL_KO, ' ').replace(/\s+/g, ' ').trim() || company : company;
  if (local) log(`Searching in the local language (${local.lang}) as "${searchName}"`);

  const discoveries: RawResearchCheckpoint['third_party_discoveries'] = [];
  const searchErrors: string[] = [];
  const search = async (query: string, count = 8) => {
    const opts = local ? { count, country: local.code, lang: local.lang } : { count };
    const hits = await braveSearch(query, opts).catch((e) => {
      searchErrors.push(`Brave "${query}": ${e?.message ?? e}`);
      log(`Brave search failed for "${query}": ${e?.message ?? e}`);
      return [] as BraveHit[];
    });
    for (const h of hits) discoveries.push({ url: h.url, title: h.title, snippets: h.snippets, source: 'brave', query });
    return hits;
  };

  // 1. Identity searches
  const tavilyQuery = local ? `${searchName} ${local.site}` : `${company} ${country} official website`;
  const [, tavilyHits] = await Promise.all([
    search(local ? `"${searchName}"` : `"${company}" ${country}`),
    tavilySearch(tavilyQuery, { max_results: 6 }).catch((e) => {
      searchErrors.push(`Tavily "${tavilyQuery}": ${e?.message ?? e}`);
      log(`Tavily search failed for "${tavilyQuery}": ${e?.message ?? e}`);
      return [] as TavilyHit[];
    }),
  ]);
  for (const h of tavilyHits) {
    discoveries.push({ url: h.url, title: h.title, snippets: [h.content], source: 'tavily', query: tavilyQuery });
  }

  // 2. Gate: an official site loads and carries the company name, on the page or as its domain name.
  // The given website is a hint, tried first. Other candidates are search hits whose domain name carries the
  // brand's first word; a directory's domain name never does.
  // brandToken and brandCompact are the Latin letters only (domains are Latin); a Korean name has none, and is
  // matched on the page by its Hangul (brandKo) instead.
  const brandToken = brand.split(' ')[0].replace(/[^a-z0-9]/g, '');
  const brandCompact = brand.replace(/[^a-z0-9]/g, '');
  const brandKo = brand.replace(/[^가-힣]/g, '');
  const brandRoman = romanizeKo(brandKo);
  const candidates = [...new Set([
    ...(input.website ? [cleanDomain(input.website)] : []),
    ...discoveries.map((d) => cleanDomain(d.url)).filter((d) => brandToken && mainLabel(d).includes(brandToken)),
  ].filter(Boolean))];

  let officialDomain = '';
  let officialUrl = '';
  let homeMarkdown = '';
  let homeStatus: OfficialPageData['status'] = 'error';
  let homeMethod = '';
  const tried: string[] = [];
  for (const domain of candidates) {
    let url = `https://${domain}`;
    log(`Checking official site candidate ${url}`);
    let page = await readWebPage(url);
    const carries = (markdown: string) => {
      const pageNorm = markdown.toLowerCase().replace(/[^a-z0-9가-힣]+/g, ' ');
      return (
        (brandCompact.length > 0 && mainLabel(domain).includes(brandCompact)) ||
        (brandCompact.length > 0 && brandCompact.includes(mainLabel(domain))) ||
        pageNorm.includes(brand) ||
        (brandKo.length >= 2 && pageNorm.replace(/ /g, '').includes(brandKo)) ||
        // A Korean name whose romanised form holds the domain's name (eunmin.co.kr for 은민에스엔디).
        (brandRoman.length > 0 && mainLabel(domain).length >= 4 && brandRoman.includes(mainLabel(domain))) ||
        (brandToken.length >= 4 && mainLabel(domain).includes(brandToken) && pageNorm.includes(brandToken))
      );
    };
    let carriesName = carries(page.markdown);
    tried.push(`${url}: ${page.status}${page.status === 'ok' && !carriesName ? ', company name not on page' : ''}`);
    // A splash page (a language choice, an "enter" button) is short and carries no name: follow its first link on
    // the same site, once (worldjltrade.com -> worldjltrade.com/index.php).
    if (page.status === 'ok' && !carriesName && page.markdown.length < 2000) {
      const sameSite = (u: string) =>
        cleanDomain(u) === domain && !/\.(png|jpe?g|gif|svg|webp|ico|css|js)(\?|$)/i.test(u) && u.replace(/\/$/, '') !== url;
      // The reader's markdown can drop links around images (language buttons): then take them from the raw HTML.
      let links = [...page.markdown.matchAll(/\((https?:\/\/[^)\s]+)\)/g)].map((m) => m[1]);
      if (!links.some(sameSite)) {
        const html = await workerFetch(url, 'html')
          .then((r) => r.content)
          .catch(() => '');
        links = [...html.matchAll(/<a\b[^>]*\bhref=["']([^"'#]+)["']/gi)].flatMap((m) => {
          try {
            return [new URL(m[1], url).href];
          } catch {
            return [];
          }
        });
      }
      const next = links.find(sameSite);
      if (next) {
        log(`Short page without the name; following its link ${next}`);
        url = next;
        page = await readWebPage(url);
        carriesName = carries(page.markdown);
        tried.push(`${url} (linked from the splash page): ${page.status}${page.status === 'ok' && !carriesName ? ', company name not on page' : ''}`);
      }
    }
    // A page labelled 'blocked' (it mentions captcha, Cloudflare...) still counts when it carries the name.
    if ((page.status === 'ok' || page.status === 'blocked') && carriesName) {
      officialDomain = domain;
      officialUrl = url;
      homeMarkdown = page.markdown;
      homeStatus = page.status;
      homeMethod = page.method;
      break;
    }
  }

  const checkpoint: RawResearchCheckpoint = {
    version: '2.1',
    stage: 1,
    created_at: new Date().toISOString(),
    input,
    catalog: {
      country: checklist?.country ?? country,
      industry: checklist?.industry ?? industry,
      prompt_count: prompts.length,
      country_layer_count: checklist?.countryLayerCount ?? 0,
    },
    official_site: { domain: officialDomain, resolved_url: officialUrl, tried, pages: [] },
    third_party_discoveries: discoveries,
    probes: [],
    search_errors: searchErrors,
  };

  // No official site confirmed: research still runs on everything else, and the report is labelled (never stopped).
  if (!officialDomain) {
    checkpoint.official_site.not_confirmed = `No official site confirmed. Tried: ${tried.join('; ') || 'no candidates'}`;
    log(`${checkpoint.official_site.not_confirmed}. Research goes on without it.`);
  } else log(`Official site confirmed: ${officialUrl}`);

  // 3. Read the official site: home, then its own about and contact links. A page identical to one read is dropped.
  const pages = checkpoint.official_site.pages;
  if (officialDomain) pages.push({ url: officialUrl, label: 'home', status: homeStatus, charCount: homeMarkdown.length, markdown: homeMarkdown, method: homeMethod });
  const discoveryUrls = discoveries.map((d) => d.url);
  for (const [url, label] of officialDomain ? aboutContactLinks(homeMarkdown, officialDomain, discoveryUrls) : []) {
    log(`Reading [${label}] ${url}`);
    const page = await readWebPage(url);
    if (page.status === 'ok' && pages.some((p) => p.markdown === page.markdown)) {
      log(`[${label}] is the same as a page already read; dropped`);
      continue;
    }
    pages.push({ url, label, status: page.status, charCount: page.markdown.length, markdown: page.markdown, method: page.method });
  }

  // 4. Coverage searches: Google Maps (on a Gmap worker, running while the rest go), reviews, employee reviews, news
  // Maps needs a place: the town and state from the site's own address, else the country alone.
  const town = siteTown(pages.map((p) => p.markdown).join('\n'), country);
  const mapsParts = [company];
  if (town) mapsParts.push(town);
  if (local) {
    if (!town) mapsParts.push(local.countryWord);
  } else if (!company.toLowerCase().includes(country.toLowerCase())) mapsParts.push(country);
  const mapsQuery = mapsParts.join(' ');
  log(`Google Maps search: ${mapsQuery}`);
  const maps = mapsSearch(mapsQuery);
  // South Korea: Naver Place, where Korean customers review, with the Maps query; with no town from the site, the
  // name alone (Naver returns nothing for "<name> 한국").
  const naverQuery = town ? mapsQuery : company;
  if (local?.code === 'KR') log(`Naver Place search: ${naverQuery}`);
  const naver = local?.code === 'KR' ? naverPlaceSearch(naverQuery) : null;
  const coverage = local ? local.coverage.map((w) => `"${searchName}" ${w}`) : COVERAGE_QUERIES.map((q) => q(company, country));
  for (const query of coverage) {
    log(`Coverage search: ${query}`);
    await search(query);
  }

  // LinkedIn company page: only a URL the searches found, whose name carries the brand; read alongside the probes.
  // A name with no Latin letters (Korean) is matched by the official domain's own name instead (heumtax.com -> heumtax).
  const domainLabel = brandCompact ? '' : mainLabel(officialDomain);
  const linkedinUrl = linkedinCompanyUrl(discoveries.map((d) => d.url), brandCompact || domainLabel, brandToken, domainLabel);
  log(linkedinUrl ? `LinkedIn company page: ${linkedinUrl}` : 'LinkedIn company page: none in the search results');
  // The worker's LinkedIn read is blocked by Cloudflare (HTTP 403, 2026-11-06); the page is read through Exa instead (end of this function).

  // Every outside page the searches found, read while the probes run; awaited at the end.
  // Off until proven live (V21_READ_OUTSIDE=on turns it on); off, Step 1 is as before.
  const readOutside = process.env.V21_READ_OUTSIDE === 'on';
  const thirdParty = readOutside ? readThirdPartyPages(discoveries.map((d) => d.url), officialDomain, log) : null;

  // 5. Catalog probes, each the way its prompt says (query_type):
  //    manual: not run, the prompt's reason kept; url_template / static_list: read query_url, keep the page whole;
  //    site_search, or no query_type (older prompts): not run (no Brave site: search; it needs a site handler).
  // The same query or address runs once, under the first probe that asks for it.
  //    Site lookup (on unless V21_SITE_LOOKUP=off): a prompt whose site has a verified handler runs that handler on a worker PC first.
  log(`Running ${prompts.length} catalog probes`);
  const handlers: Map<string, HandlerEntry> =
    siteLookupOn() && checklist ? await loadHandlers(checklist.countryCode) : new Map();
  if (siteLookupOn()) log(`Site lookup on: ${handlers.size} handlers for ${checklist?.countryCode ?? country}`);
  const probed = new Map<string, number>();
  for (const p of prompts) {
    let lookup: SiteLookupResult | undefined;
    const probe = (fields: Pick<ProbeResult, 'query' | 'evidence_urls' | 'snippets' | 'page' | 'not_run'>) =>
      checkpoint.probes.push({
        rank: p.rank,
        category: p.category,
        question: p.question,
        why_it_matters: p.why_it_matters,
        source: { name: p.source.name, url: p.source.url, type: p.source.type },
        how_to_query: p.how_to_query,
        query_type: p.query_type,
        applies_when: p.applies_when,
        ...fields,
        ...(lookup ? { lookup } : {}),
        found_when: p.found_when,
        not_found_when: p.not_found_when,
        couldnt_check_when: p.couldnt_check_when,
      });

    const handler = handlerFor(handlers, p.question);
    if (handler) {
      log(`Probe #${p.rank} [${p.category}]: site lookup ${handler.id}`);
      lookup = await siteLookup(handler.id, searchName);
      const query = `site.lookup ${handler.id} "${searchName}"`;
      if (lookup.job_status === 'done' && lookup.reason === 'pdf' && lookup.source_url) {
        // A PDF handler names the PDF; the reader reads it whole, as a static list is.
        const page = await readWebPage(lookup.source_url, 1_000_000);
        probe({
          query,
          evidence_urls: [lookup.source_url],
          snippets: [],
          page: { url: lookup.source_url, status: page.status, charCount: page.markdown.length, truncated: page.truncated ?? false, text: page.markdown },
        });
        continue;
      }
      if (lookup.job_status === 'done') {
        log(`Probe #${p.rank}: ${lookup.status}${lookup.reason ? ` (${lookup.reason})` : ''}, ${lookup.records?.length ?? 0} records`);
        probe({ query, evidence_urls: lookup.source_url ? [lookup.source_url] : [], snippets: lookup.excerpt ? [lookup.excerpt] : [] });
        continue;
      }
      log(`Probe #${p.rank}: site lookup did not run (${lookup.error})`);
    }

    if (p.query_type === 'manual') {
      log(`Probe #${p.rank} [${p.category}]: manual source, not run`);
      probe({ query: '', evidence_urls: [], snippets: [], not_run: p.manual_reason || 'manual source' });
      continue;
    }

    if (p.query_type === 'url_template' || p.query_type === 'static_list') {
      const raw = p.query_url ?? '';
      if (/\{reg_no\}/.test(raw)) {
        log(`Probe #${p.rank} [${p.category}]: needs the registration number, not run`);
        probe({ query: raw, evidence_urls: [], snippets: [], not_run: 'the address needs the registration number' });
        continue;
      }
      const url = raw.replace(/\{company\}/g, encodeURIComponent(searchName));
      if (probed.has(url)) {
        log(`Probe #${p.rank} [${p.category}]: same address as probe #${probed.get(url)}, not read again`);
        probe({ query: url, evidence_urls: [url], snippets: [], not_run: `same address as probe #${probed.get(url)}; its page is there` });
        continue;
      }
      probed.set(url, p.rank);
      log(`Probe #${p.rank} [${p.category}]: reading ${url}`);
      // A list is read whole: a cut list cannot show that a name is absent.
      const page = await readWebPage(url, 1_000_000);
      probe({
        query: url,
        evidence_urls: [url],
        snippets: [],
        page: { url, status: page.status, charCount: page.markdown.length, truncated: page.truncated ?? false, text: page.markdown },
      });
      continue;
    }

    // No Brave site: search here (owner, 2026-11-06: Brave credit is limited, sites are read on the local worker).
    // A site with no working handler is not run, and says why, so Step 2 sees it was not checked.
    const why = lookup ? `site lookup did not run: ${lookup.error}` : 'no working site handler for this source yet';
    log(`Probe #${p.rank} [${p.category}]: not run, ${why}`);
    probe({ query: '', evidence_urls: [], snippets: [], not_run: why });
  }

  checkpoint.google_maps = { query: mapsQuery, ...(await maps) };
  log(`Google Maps search: ${checkpoint.google_maps.status}`);
  if (naver) {
    checkpoint.naver_place = { query: naverQuery, ...(await naver) };
    log(`Naver Place search: ${checkpoint.naver_place.status}, ${checkpoint.naver_place.places.length} listings`);
  }
  // Read through Exa (its own crawl) in place of the blocked worker read; the worker read stays off.
  checkpoint.linkedin = linkedinUrl
    ? { url: linkedinUrl, ...(await linkedinCompanyExa(linkedinUrl)) }
    : { url: linkedinUrl, status: 'not_run', error: 'no LinkedIn company page in the search results' };
  log(`LinkedIn company page: ${checkpoint.linkedin.status}`);
  if (thirdParty) {
    checkpoint.third_party_pages = await thirdParty;
    log(`Outside pages read: ${checkpoint.third_party_pages.filter((p) => p.status === 'ok').length} of ${checkpoint.third_party_pages.length}`);
  }

  return saveCheckpoint(checkpoint, company, log);
}

function saveCheckpoint(
  checkpoint: RawResearchCheckpoint,
  company: string,
  log: (msg: string) => void,
): { checkpointPath: string; data: RawResearchCheckpoint } {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const runFolder = path.join(runsDir, `${timestamp}_${slugify(company)}`);
  const checkpointPath = path.join(runFolder, 'step1_research.json');
  // A disk that cannot be written never loses the research: the error is recorded and the data goes on to the database.
  try {
    fs.mkdirSync(runFolder, { recursive: true });
    fs.writeFileSync(checkpointPath, JSON.stringify(checkpoint, null, 2), 'utf8');
    log(`Step 1 Complete! Checkpoint saved to:\n${checkpointPath}`);
  } catch (e: any) {
    checkpoint.save_error = `checkpoint file not written (${checkpointPath}): ${e?.message ?? e}`;
    log(`Step 1 Complete! ${checkpoint.save_error}`);
  }
  return { checkpointPath, data: checkpoint };
}
