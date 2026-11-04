import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadChecklist, type ResearchPrompt } from './catalog.ts';
import { braveSearch, tavilySearch, mapsSearch, linkedinCompany, type BraveHit, type TavilyHit } from './cloud.ts';
import { readWebPage } from './reader.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const runsDir = path.resolve(here, 'runs');

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
  found_when?: string;
  not_found_when?: string;
  couldnt_check_when?: string;
};

export type RawResearchCheckpoint = {
  version: '2.1';
  stage: 1;
  created_at: string;
  input: ResearchInput;
  /** Set when no official site was confirmed: the company is skipped and nothing else is gathered. */
  skipped?: string;
  catalog: {
    country: string;
    industry: string;
    prompt_count: number;
  };
  official_site: {
    domain: string;
    resolved_url: string;
    /** Every candidate the gate tried and what it returned, kept even when one passes (a given site that fails is itself evidence). */
    tried: string[];
    pages: OfficialPageData[];
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
  /** The company's LinkedIn page as the worker read it, raw (website, phone, HQ, founded, industry, type, size). */
  linkedin?: { url: string; status: string; worker?: string; result?: unknown; error?: string };
};

// Where an owner does not look: what customers and staff say, and the press.
const COVERAGE_QUERIES = [
  (name: string, country: string) => `"${name}" ${country} reviews`,
  (name: string, country: string) => `"${name}" ${country} employee reviews`,
  (name: string, country: string) => `"${name}" ${country} news`,
];

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'company';
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
    .replace(/[^a-z0-9]+/g, ' ')
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

  const testUrl = (url: string) => {
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
      if (!found.has('about') && /about|profile|our-story/.test(p)) found.set('about', url);
      if (!found.has('contact') && /contact/.test(p)) found.set('contact', url);
    } catch {}
  };

  for (const m of markdown.matchAll(/\]\((https?:\/\/[^)\s]+)/g)) {
    testUrl(m[1]);
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
  return '';
}

/** The first LinkedIn company page among the URLs whose name carries the whole brand, else its first word,
 *  as https://www.linkedin.com/company/<name>/ ("au.linkedin.com/company/digital-next-australia?trk=x"). */
function linkedinCompanyUrl(urls: string[], brandCompact: string, brandToken: string): string {
  const slugs = urls
    .map((u) => u.match(/linkedin\.com\/company\/([^/?#]+)/i)?.[1]?.toLowerCase())
    .filter((s): s is string => Boolean(s));
  const compact = (s: string) => s.replace(/[^a-z0-9]/g, '');
  const slug =
    slugs.find((s) => brandCompact && compact(s).includes(brandCompact)) ??
    slugs.find((s) => brandToken.length >= 3 && compact(s).includes(brandToken));
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
  else log(`Loaded ${prompts.length} industry prompts from catalog`);

  const discoveries: RawResearchCheckpoint['third_party_discoveries'] = [];
  const search = async (query: string, count = 8) => {
    const hits = await braveSearch(query, { count }).catch(() => [] as BraveHit[]);
    for (const h of hits) discoveries.push({ url: h.url, title: h.title, snippets: h.snippets, source: 'brave', query });
    return hits;
  };

  // 1. Identity searches
  const tavilyQuery = `${company} ${country} official website`;
  const [, tavilyHits] = await Promise.all([
    search(`"${company}" ${country}`),
    tavilySearch(tavilyQuery, { max_results: 6 }).catch(() => [] as TavilyHit[]),
  ]);
  for (const h of tavilyHits) {
    discoveries.push({ url: h.url, title: h.title, snippets: [h.content], source: 'tavily', query: tavilyQuery });
  }

  // 2. Gate: an official site loads and carries the company name, on the page or as its domain name.
  // The given website is a hint, tried first. Other candidates are search hits whose domain name carries the
  // brand's first word; a directory's domain name never does.
  const brandToken = brand.split(' ')[0].replace(/[^a-z0-9]/g, '');
  const brandCompact = brand.replace(/[^a-z0-9]/g, '');
  const candidates = [...new Set([
    ...(input.website ? [cleanDomain(input.website)] : []),
    ...discoveries.map((d) => cleanDomain(d.url)).filter((d) => brandToken && mainLabel(d).includes(brandToken)),
  ].filter(Boolean))].slice(0, 4);

  let officialDomain = '';
  let officialUrl = '';
  let homeMarkdown = '';
  let homeStatus: OfficialPageData['status'] = 'error';
  let homeMethod = '';
  const tried: string[] = [];
  for (const domain of candidates) {
    const url = `https://${domain}`;
    log(`Checking official site candidate ${url}`);
    const page = await readWebPage(url);
    const pageNorm = page.markdown.toLowerCase().replace(/[^a-z0-9]+/g, ' ');
    const carriesName =
      mainLabel(domain).includes(brandCompact) ||
      brandCompact.includes(mainLabel(domain)) ||
      pageNorm.includes(brand) ||
      (brandToken.length >= 4 && mainLabel(domain).includes(brandToken) && pageNorm.includes(brandToken));
    tried.push(`${url}: ${page.status}${page.status === 'ok' && !carriesName ? ', company name not on page' : ''}`);
    if (page.status === 'ok' && carriesName) {
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
    },
    official_site: { domain: officialDomain, resolved_url: officialUrl, tried, pages: [] },
    third_party_discoveries: discoveries,
    probes: [],
  };

  if (!officialDomain) {
    checkpoint.skipped = `No official site confirmed. Tried: ${tried.join('; ') || 'no candidates'}`;
    log(`Skipped: ${checkpoint.skipped}`);
    return saveCheckpoint(checkpoint, company, log);
  }
  log(`Official site confirmed: ${officialUrl}`);

  // 3. Read the official site: home, then its own about and contact links. A page identical to one read is dropped.
  const pages = checkpoint.official_site.pages;
  pages.push({ url: officialUrl, label: 'home', status: homeStatus, charCount: homeMarkdown.length, markdown: homeMarkdown, method: homeMethod });
  const discoveryUrls = discoveries.map((d) => d.url);
  for (const [url, label] of aboutContactLinks(homeMarkdown, officialDomain, discoveryUrls)) {
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
  if (!company.toLowerCase().includes(country.toLowerCase())) mapsParts.push(country);
  const mapsQuery = mapsParts.join(' ');
  log(`Google Maps search: ${mapsQuery}`);
  const maps = mapsSearch(mapsQuery);
  for (const q of COVERAGE_QUERIES) {
    const query = q(company, country);
    log(`Coverage search: ${query}`);
    await search(query);
  }

  // LinkedIn company page: only a URL the searches found, whose name carries the brand; read alongside the probes.
  const linkedinUrl = linkedinCompanyUrl(discoveries.map((d) => d.url), brandCompact, brandToken);
  log(linkedinUrl ? `LinkedIn company page: ${linkedinUrl}` : 'LinkedIn company page: none in the search results');
  const linkedin = linkedinUrl ? linkedinCompany(linkedinUrl) : null;

  // 5. Catalog probes, each the way its prompt says (query_type):
  //    manual: not run, the prompt's reason kept; url_template / static_list: read query_url, keep the page whole;
  //    no query_type (older prompts): a site: search on the source's host.
  // The same query or address runs once, under the first probe that asks for it.
  log(`Running ${prompts.length} catalog probes`);
  const probed = new Set<string>();
  for (const p of prompts) {
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
        found_when: p.found_when,
        not_found_when: p.not_found_when,
        couldnt_check_when: p.couldnt_check_when,
      });

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
      const url = raw.replace(/\{company\}/g, encodeURIComponent(company));
      if (probed.has(url)) {
        log(`Probe #${p.rank} [${p.category}]: same address as an earlier probe, not read again`);
        continue;
      }
      probed.add(url);
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

    let host = '';
    try {
      host = new URL(p.source.url).hostname.replace(/^www\./, '');
    } catch {}
    const query = host ? `"${company}" site:${host}` : `"${company}" ${p.source.name}`;
    if (probed.has(query)) {
      log(`Probe #${p.rank} [${p.category}]: same query as an earlier probe, not run again`);
      continue;
    }
    probed.add(query);
    log(`Probe #${p.rank} [${p.category}]: ${query}`);
    const hits = await braveSearch(query, { count: 3 }).catch(() => [] as BraveHit[]);
    probe({ query, evidence_urls: hits.map((h) => h.url), snippets: hits.flatMap((h) => h.snippets) });
  }

  checkpoint.google_maps = { query: mapsQuery, ...(await maps) };
  log(`Google Maps search: ${checkpoint.google_maps.status}`);
  checkpoint.linkedin = linkedin
    ? { url: linkedinUrl, ...(await linkedin) }
    : { url: '', status: 'not_run', error: 'no LinkedIn company page in the search results' };
  log(`LinkedIn company page: ${checkpoint.linkedin.status}`);

  return saveCheckpoint(checkpoint, company, log);
}

function saveCheckpoint(
  checkpoint: RawResearchCheckpoint,
  company: string,
  log: (msg: string) => void,
): { checkpointPath: string; data: RawResearchCheckpoint } {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const runFolder = path.join(runsDir, `${timestamp}_${slugify(company)}`);
  fs.mkdirSync(runFolder, { recursive: true });

  const checkpointPath = path.join(runFolder, 'step1_research.json');
  fs.writeFileSync(checkpointPath, JSON.stringify(checkpoint, null, 2), 'utf8');

  log(`Step 1 Complete! Checkpoint saved to:\n${checkpointPath}`);
  return { checkpointPath, data: checkpoint };
}
