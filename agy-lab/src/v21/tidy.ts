// V2.1 Step 2 Tidy: Plain code between Step 1/1.5 (gather) and Step 2 (judge).
// It cleans and lays out what Step 1 and Step 1.5 saved, so Step 2's LLM reads all of it in one clear shape.
// It never judges: no namesake dropping, no found/not-found verdicts, no ranking. Every item keeps its source URL
// and gets an id (E1, E2, R1...) that Step 2 cites.
import type { RawResearchCheckpoint } from './research.ts';
import type { Step1_5_AssetsOutput } from './assets.ts';

export type TidyEvidence = {
  id: string;
  kind: 'google_maps' | 'naver_place' | 'search';
  source_name: string;
  url: string;
  title?: string;
  text: string;
  query?: string;
};

export type TidyRegister = {
  id: string;
  question: string;
  source_name: string;
  url: string;
  found_when?: string;
  not_found_when?: string;
  page_chars: number;
  name_terms: string[];
  /** Passages of the register page around each place a name term appears, as read. Empty = no term appears. */
  mentions: string[];
  /** Search-type probes: the hits Step 1 saved (no page read). */
  hits: string[];
};

export type TidyData = {
  version: '2.1';
  stage: 1.5;
  input: RawResearchCheckpoint['input'];
  official: {
    domain: string;
    /** Header, menu and footer lines that repeat on every page read, kept once. */
    site_wide: string;
    pages: Array<{ label: string; url: string; text: string; cut_chars: number }>;
    /** Pages of the official domain that turned up in searches: search snippets only, page not read. */
    other_own_pages: Array<{ url: string; title: string; text: string }>;
  };
  own_linkedin: Record<string, string> | null;
  evidence: TidyEvidence[];
  registers: TidyRegister[];
  technical_audit?: {
    pagespeed_status: string;
    target_url?: string;
    mobile_score?: number;
    desktop_score?: number;
    field_speed?: string;
    domains_checked: number;
    findings_count: number;
    items: Array<{ title: string; detail: string; severity: string; check: string }>;
    /** The worker's SEO / GEO benchmark of the official website (Step 1.5 site_audit), when it ran. */
    seo_score?: number;
    geo_score?: number;
    audit_groups?: string[];
  };
  could_not_check: Array<{ target: string; reason: string }>;
};

// How sure each check of the worker's SEO / GEO benchmark is, as the worker's own API page states it (site.audit,
// "What the audit measures"). Step 2 is told: exact = measured; rule of thumb / hint = an estimate.
const AUDIT_SOURCE = 'SEO / GEO benchmark (worker site.audit)';
const AUDIT_SURE: Record<string, string> = {
  crawl: 'exact',
  onpage: 'exact',
  speed: "exact, timed from the worker's connection on the HTML only (not Lighthouse)",
  schema: "exact, against the worker's copy of Google's rules (not Google's Rich Results Test)",
  security: 'exact',
  ai_access: 'exact',
  answer: 'rule of thumb, tuned for English',
  trust: 'exact presence check',
  citability: 'rule of thumb, tuned for English',
  entity: 'exact lookup in Wikidata, Wikipedia and Common Crawl',
};
const AUDIT_SURE_CHECK: Record<string, string> = {
  'ai_access.firewall': "hint: the bots' names were sent from the worker's address, not the real bots' addresses",
  'ai_access.no_js_content': 'hint: judged from the HTML only',
  'ai_access.training_bots': 'exact; blocking AI training bots is a fair choice, so it can only warn',
};

const PAGE_MAX = 15_000;
const SNIPPET_MAX = 700;
const MENTION_BEFORE = 120;
const MENTION_AFTER = 450;
const MENTIONS_MAX = 6;
// An outside page read in Step 1: wider passages around the name (a directory entry's details follow the name).
const PAGE_MENTION_BEFORE = 300;
const PAGE_MENTION_AFTER = 1_200;
const PAGE_MENTIONS_MAX = 6;

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };

/** Strip HTML tags and entities, collapse white space. */
export function cleanText(s: string): string {
  let t = String(s ?? '');
  for (let i = 0; i < 2; i++) {
    // twice: snippets carry double-encoded entities like &amp;#xa0;
    t = t
      .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
      .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
      .replace(/&([a-z]+|#39);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m);
  }
  return stripMarkdown(t.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
}

const WORD_CHAR = /[\p{L}\p{N}]/u;
const MASK = '\u0002';

/**
 * Markdown marks to plain text, for every page, snippet and passage Step 2 reads (and quotes onto the report): bold
 * and italic marks that wrap text, heading marks, backslash escapes. A lone mark is text and stays: a directory masks a
 * phone as "03-7971 9**XX"; "C#", "#1", "#hashtag", "snake_case" and "Lot # 12" are not formatting. Sites glue bold
 * to the words around it ("Residential**Jendela**Renovation"): where removing a mark would join two words, a space
 * goes in its place.
 */
export function stripMarkdown(s: string): string {
  const spaced = (before: string, inner: string, after: string) => {
    const l = WORD_CHAR.test(before) && WORD_CHAR.test(inner[0] ?? '') ? ' ' : '';
    const end = inner.at(-1) ?? '';
    const r = WORD_CHAR.test(after) && (WORD_CHAR.test(end) || /\s/.test(end)) ? ' ' : '';
    return l + inner.trim() + r;
  };
  return (
    String(s ?? '')
      // masked digits are text: 9**XX (a bare 4*** can also close bold, "$20,000***", so it is not protected)
      .replace(/(?<=\d)\*{2,}(?=[Xx]+(?![\p{L}]))/gu, (m) => MASK.repeat(m.length))
      // bold **x** on one line, the text holding no other **
      .replace(/\*\*(?=\S)((?:(?!\*\*)[^\n])+?)\*\*/gu, (m, inner: string, at: number, all: string) =>
        spaced(all[at - 1] ?? '', inner, all[at + m.length] ?? ''),
      )
      // bold __x__ only outside words (snake__case and __init__ are text)
      .replace(/(?<![\p{L}\p{N}_])__(?=\S)((?:(?!__)[^\n])+?)(?<=\S)__(?![\p{L}\p{N}_])/gu, '$1')
      // italic *x* / _x_: only between spaces, brackets or punctuation
      .replace(/(^|[\s(\[])([*_])(?=[^\s*_])([^*_\n]*?[^\s*_\\])\2(?=[\s).,;:!?\]]|$)/gmu, '$1$3')
      // headings: at a line start; inside flattened text (## before anything, # before a word); closing ## after text
      .replace(/^[ \t]*#{1,6}[ \t]+/gm, '')
      .replace(/(^|[\s[(])#{2,6}\s+/gm, '$1')
      .replace(/(^|\s)#\s+(?=\p{L})/gmu, '$1')
      .replace(/(?<=\S)#{2,6}(?=\s|$)/gm, '')
      // escapes: \_ -> _, \* -> * (an escaped mark is the page's own text)
      .replace(/\\([`*_{}[\]()#+\-.!|>~])/g, '$1')
      .replaceAll(MASK, '*')
  );
}

function domainOf(rawUrl: string): string {
  try {
    const u = /^https?:\/\//i.test(rawUrl.trim()) ? rawUrl.trim() : 'https://' + rawUrl.trim();
    return new URL(u).hostname.replace(/^www\./i, '').toLowerCase();
  } catch {
    return '';
  }
}

function onDomain(url: string, domain: string): boolean {
  if (!domain) return false;
  const d = domainOf(url);
  return d === domain || d.endsWith('.' + domain);
}

/** Markdown to plain lines: drop images, keep link text, drop bare link targets and formatting marks. */
function pageLines(markdown: string): string[] {
  return String(markdown ?? '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\((?:[^()]|\([^)]*\))*\)/g, '$1')
    .split('\n')
    .map((l) => stripMarkdown(l).replace(/\s+/g, ' ').trim())
    .filter((l) => l && !/^[-=*_#|\s]+$/.test(l));
}

const GENERIC = new Set([
  'sdn', 'bhd', 'pte', 'ltd', 'pty', 'plt', 'llc', 'inc', 'co', 'the', 'and', 'group', 'holdings', 'company',
  'limited', 'corporation', 'corp', 'singapore', 'malaysia', 'australia', 'korea',
  // common business words: on their own they match half of any register
  'advisors', 'advisory', 'consulting', 'consultants', 'partners', 'digital', 'design', 'logistics', 'marketing',
  'agency', 'studio', 'solutions', 'services', 'management', 'international', 'global', 'asia',
]);

/** Pick search terms for register mention scans: the full company name, plus the distinctive single words. */
function nameTerms(company: string): string[] {
  const norm = cleanText(company).toLowerCase();
  const words = norm
    .split(/[\s,./\-_&]+/)
    .map((w) => w.replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, ''))
    .filter((w) => w.length >= 3 && !GENERIC.has(w));
  const out = new Set<string>();
  if (norm.length >= 3) out.add(norm);
  for (const w of words) out.add(w);
  return [...out];
}

/** Find all places any name term appears in a register page; return non-overlapping excerpts. */
function findMentions(pageText: string, terms: string[], before = MENTION_BEFORE, after = MENTION_AFTER, max = MENTIONS_MAX): string[] {
  if (!pageText || !terms.length) return [];
  const flat = cleanText(pageText);
  const lower = flat.toLowerCase();
  const spans: Array<[number, number]> = [];
  for (const t of terms) {
    let at = 0;
    while (at < lower.length) {
      const idx = lower.indexOf(t, at);
      if (idx === -1) break;
      const start = Math.max(0, idx - before);
      const end = Math.min(flat.length, idx + t.length + after);
      spans.push([start, end]);
      at = idx + Math.max(1, t.length);
    }
  }
  if (!spans.length) return [];
  spans.sort((a, b) => a[0] - b[0]);
  const merged: Array<[number, number]> = [];
  for (const s of spans) {
    const last = merged[merged.length - 1];
    if (last && s[0] <= last[1]) last[1] = Math.max(last[1], s[1]);
    else merged.push([...s]);
  }
  return merged.slice(0, max).map(([a, b]) => (a > 0 ? '…' : '') + flat.slice(a, b).trim() + (b < flat.length ? '…' : ''));
}

export function tidyCheckpoint(cp: RawResearchCheckpoint, assets?: Step1_5_AssetsOutput | null): TidyData {
  const input = cp.input;
  const domain = (cp.official_site?.domain || domainOf(input.website || '')).toLowerCase();
  const terms = nameTerms(input.company);
  const couldNotCheck: TidyData['could_not_check'] = [];

  // ---- Official pages: remove the menu/footer lines repeated across pages, keep them once.
  const pages = (cp.official_site?.pages || []).filter((p) => p.markdown);
  const linesByPage = pages.map((p) => pageLines(p.markdown));
  const seenIn = new Map<string, number>();
  for (const lines of linesByPage) for (const l of new Set(lines)) seenIn.set(l, (seenIn.get(l) || 0) + 1);
  const repeated = (l: string) => pages.length > 1 && (seenIn.get(l) || 0) >= 2;
  const siteWide: string[] = [];
  for (const lines of linesByPage) for (const l of lines) if (repeated(l) && !siteWide.includes(l)) siteWide.push(l);
  const tidyPages = pages.map((p, i) => {
    const kept: string[] = [];
    for (const l of linesByPage[i]) if (!repeated(l) && kept[kept.length - 1] !== l) kept.push(l);
    const text = kept.join('\n');
    return { label: p.label, url: p.url, text: text.slice(0, PAGE_MAX), cut_chars: Math.max(0, text.length - PAGE_MAX) };
  });

  // ---- Search hits: own-domain hits go with the official site; the rest become evidence. Same URL merged.
  const otherOwn: TidyData['official']['other_own_pages'] = [];
  const evidence: TidyEvidence[] = [];
  const byUrl = new Map<string, TidyEvidence>();
  const officialUrls = new Set(pages.map((p) => p.url.replace(/\/$/, '')));
  let n = 0;

  const maps = cp.google_maps;
  if (!maps) couldNotCheck.push({ target: 'Google Maps', reason: 'Not gathered in Step 1' });
  else if (maps.status !== 'done') couldNotCheck.push({ target: 'Google Maps', reason: maps.error || `Maps ${maps.status}` });
  else {
    for (const b of ((maps.result as any)?.businesses || []) as any[]) {
      evidence.push({
        id: `E${++n}`,
        kind: 'google_maps',
        source_name: 'Google Maps',
        url: b.mapsUrl || '',
        title: b.name,
        text: [
          `Name: ${b.name}`,
          `Category: ${b.category ?? 'n/a'}`,
          `Rating: ${b.rating ?? 'n/a'} (${b.reviews ?? 0} reviews)`,
          `Address: ${b.address ?? 'n/a'}`,
          `Phone: ${b.phone ?? 'n/a'}`,
          `Website: ${b.website ?? 'n/a'}`,
        ].join(' | '),
      });
    }
  }

  if (/korea/i.test(input.country)) {
    const nv = cp.naver_place;
    if (!nv) couldNotCheck.push({ target: 'Naver Place', reason: 'Not gathered in Step 1' });
    else if (nv.status !== 'done') couldNotCheck.push({ target: 'Naver Place', reason: nv.error || `Naver Place ${nv.status}` });
    else {
      for (const b of ((nv.result as any)?.places || []) as any[]) {
        evidence.push({
          id: `E${++n}`,
          kind: 'naver_place',
          source_name: 'Naver Place',
          url: b.url || '',
          title: b.name,
          text: [
            `Name: ${b.name}`,
            `Category: ${b.category ?? 'n/a'}`,
            `Address: ${b.address ?? 'n/a'}`,
            `Phone: ${b.phone ?? 'n/a'}`,
          ].join(' | '),
        });
      }
    }
  }

  for (const d of cp.third_party_discoveries || []) {
    if (!d.url) continue;
    const snippets = (d.snippets || []).map((s) => cleanText(s).slice(0, SNIPPET_MAX)).filter(Boolean);
    if (onDomain(d.url, domain)) {
      if (officialUrls.has(d.url.replace(/\/$/, ''))) continue;
      const prev = otherOwn.find((o) => o.url === d.url);
      if (prev) prev.text = [...new Set([...prev.text.split('\n'), ...snippets])].join('\n');
      else otherOwn.push({ url: d.url, title: cleanText(d.title), text: [...new Set(snippets)].join('\n') });
      continue;
    }
    const prev = byUrl.get(d.url);
    if (prev) {
      const have = new Set(prev.text.split('\n'));
      for (const s of snippets) if (!have.has(s)) prev.text += '\n' + s;
      continue;
    }
    const item: TidyEvidence = {
      id: `E${++n}`,
      kind: 'search',
      source_name: domainOf(d.url),
      url: d.url,
      title: cleanText(d.title),
      text: [...new Set(snippets)].join('\n'),
      query: d.query,
    };
    byUrl.set(d.url, item);
    evidence.push(item);
  }

  // ---- Outside pages Step 1 read: the passages where the company's name appears, under the snippet.
  // Checkpoints from before 2026-11-06 have no third_party_pages: their items stay snippets only.
  if (cp.third_party_pages) {
    const key = (u: string) => u.replace(/#.*$/, '').replace(/\/$/, '');
    const readByUrl = new Map(cp.third_party_pages.map((p) => [key(p.url), p]));
    for (const item of byUrl.values()) {
      const page = readByUrl.get(key(item.url));
      if (!page) continue;
      const snippet = item.text ? `Search snippet: ${item.text}` : '';
      let read: string;
      if (page.status !== 'ok' || !page.text) {
        read = `PAGE NOT READ (${page.status}${page.error ? `: ${page.error}` : ''}); only the snippet above is known.`;
      } else {
        const text = pageLines(page.text).join('\n');
        const passages = findMentions(text, terms, PAGE_MENTION_BEFORE, PAGE_MENTION_AFTER, PAGE_MENTIONS_MAX);
        const size = `${page.charCount}-character page${page.truncated ? ', cut at that length' : ''}`;
        read = passages.length
          ? `PAGE READ (${size}). Passages where ${terms.map((x) => `"${x}"`).join(' / ')} appear:\n` + passages.map((m) => `  > ${m}`).join('\n')
          : `PAGE READ (${size}): none of ${terms.map((x) => `"${x}"`).join(' / ')} appear anywhere on it.`;
      }
      item.text = [snippet, read].filter(Boolean).join('\n');
    }
  }

  // ---- Step 1.5 Technical Infrastructure & Digital Assets Findings
  let technicalAudit: TidyData['technical_audit'] = undefined;
  if (assets) {
    technicalAudit = {
      pagespeed_status: assets.pagespeed?.status ?? 'none',
      target_url: assets.pagespeed?.target_url,
      mobile_score: assets.pagespeed?.mobile?.scores?.performance,
      desktop_score: assets.pagespeed?.desktop?.scores?.performance,
      field_speed: assets.pagespeed?.mobile?.field?.overall,
      domains_checked: assets.domains?.length ?? 0,
      findings_count: assets.findings?.length ?? 0,
      items: (assets.findings ?? []).map((f) => ({
        title: f.title,
        detail: f.detail,
        severity: f.severity,
        check: f.check,
      })),
    };

    for (const f of assets.findings ?? []) {
      const src = f.check.startsWith('psi') ? 'Google PageSpeed Insights' : 'Domain Security & Assets';
      evidence.push({
        id: `E${++n}`,
        kind: 'search',
        source_name: src,
        url: f.evidence_url || f.source || (domain ? `https://${domain}` : ''),
        title: f.title,
        text: `[${f.severity.toUpperCase()}] ${f.title}. ${f.detail}`,
      });
    }

    // Google Maps reviews of the company's own profile (Step 1.5, Scraper.Tech). Laid out as plain lines, newest first.
    // A review with no text is kept as a rating line. Not run / failed is "could not check", never a finding.
    const gr = assets.google_reviews;
    if (!gr) couldNotCheck.push({ target: 'Google Maps reviews', reason: 'Not gathered in Step 1.5' });
    else if (gr.status !== 'done' || !gr.data) couldNotCheck.push({ target: 'Google Maps reviews', reason: gr.reason || gr.error || `reviews ${gr.status}` });
    else {
      const d = gr.data;
      const line = (r: (typeof d.reviews)[number]) =>
        `${r.date?.slice(0, 10) ?? '?'} | ${r.rating ?? '?'}★ | ${r.author}${r.author_reviews != null ? ` (${r.author_reviews} reviews by this person)` : ''} | ` +
        `${r.text ? cleanText(r.text).slice(0, 600) : '(rating only, no text)'}` +
        `${r.owner_reply ? ` | OWNER REPLY: ${cleanText(r.owner_reply).slice(0, 400)}` : ''}`;
      evidence.push({
        id: `E${++n}`,
        kind: 'google_maps',
        source_name: 'Google Maps reviews',
        url: gr.profile?.maps_url || (gr.profile ? `https://www.google.com/maps/place/?q=place_id:${gr.profile.place_id}` : ''),
        title: `${gr.profile?.name ?? d.name ?? 'Google Maps profile'}: ${d.reviews.length} newest reviews of ${d.review_count ?? '?'} (profile rating ${d.rating ?? '?'})`,
        text: d.reviews.map(line).join('\n'),
      });
    }

    // SEO / GEO benchmark of the official website (Step 1.5 site_audit, measured by the worker). One item with the
    // scores and the checks that passed, then one item per check that warned or failed, each saying how sure it is.
    // What the audit does not cover (notChecked), and an audit that did not run, are "could not check".
    const sa = assets.site_audit;
    const ar: any = sa?.status === 'done' ? sa.result : null;
    if (sa && !ar?.scores) {
      couldNotCheck.push({ target: 'SEO / GEO benchmark of the official website', reason: sa.reason || sa.error || `audit ${sa.status}` });
    } else if (ar?.scores) {
      const url = ar.finalUrl || sa?.target_url || '';
      const checks: any[] = Array.isArray(ar.checks) ? ar.checks : [];
      const groups = Object.entries(ar.scores.groups ?? {}).map(([g, v]: [string, any]) => `${g} (${String(v.area).toUpperCase()}, ${AUDIT_SURE[g] ?? 'how sure not stated'}) ${v.score}/100`);
      const sure = (c: any) => AUDIT_SURE_CHECK[c.id] ?? AUDIT_SURE[c.group] ?? 'how sure not stated';
      technicalAudit!.seo_score = ar.scores.seo;
      technicalAudit!.geo_score = ar.scores.geo;
      technicalAudit!.audit_groups = groups;
      evidence.push({
        id: `E${++n}`,
        kind: 'search',
        source_name: AUDIT_SOURCE,
        url,
        title: `SEO ${ar.scores.seo}/100 and GEO ${ar.scores.geo}/100 for ${url}`,
        text: [
          `SEO score ${ar.scores.seo}/100 (how well Google can crawl, read and trust the site) and GEO score ${ar.scores.geo}/100 (how well AI answer engines can reach, understand and quote it), over ${(ar.pages ?? []).length} pages read: ${(ar.pages ?? []).map((p: any) => p.url).join(', ')}.`,
          `Group scores: ${groups.join('; ')}.`,
          `Checks passed: ${checks.filter((c) => c.status === 'pass').map((c) => c.title).join('; ') || 'none'}.`,
        ].join('\n'),
      });
      for (const c of checks.filter((x) => x.status === 'fail' || x.status === 'warn')) {
        evidence.push({
          id: `E${++n}`,
          kind: 'search',
          source_name: AUDIT_SOURCE,
          url: c.worstUrl || url,
          title: c.title,
          text: `[${String(c.status).toUpperCase()}] ${c.title} (group ${c.group}; ${sure(c)}): ${cleanText(String(c.detail ?? ''))}`,
        });
      }
      for (const x of ar.notChecked ?? []) couldNotCheck.push({ target: 'SEO / GEO benchmark', reason: String(x) });
    }
  }

  // ---- Catalog probes: not run -> could not check; read pages -> passages where the name appears.
  const registers: TidyRegister[] = [];
  let r = 0;
  for (const p of cp.probes || []) {
    if (p.not_run) {
      couldNotCheck.push({ target: p.source.name, reason: p.not_run });
      continue;
    }
    const pageText = p.page?.text || '';
    if (p.page && p.page.status !== 'ok' && !pageText) {
      couldNotCheck.push({ target: p.source.name, reason: `register page ${p.page.status}` });
      continue;
    }
    registers.push({
      id: `R${++r}`,
      question: p.question,
      source_name: p.source.name,
      url: p.page?.url || p.evidence_urls?.[0] || p.source.url,
      found_when: p.found_when,
      not_found_when: p.not_found_when,
      page_chars: pageText.length,
      name_terms: terms,
      mentions: pageText ? findMentions(pageText, terms) : [],
      hits: (p.snippets || []).map((s) => cleanText(s).slice(0, SNIPPET_MAX)).filter(Boolean),
    });
  }

  // ---- Own LinkedIn: the fields as read.
  let ownLinkedin: TidyData['own_linkedin'] = null;
  const li = cp.linkedin;
  if (!li) couldNotCheck.push({ target: 'LinkedIn company page', reason: 'Not gathered in Step 1' });
  else if (li.status !== 'done') couldNotCheck.push({ target: 'LinkedIn company page', reason: li.error || (li.status === 'not_run' ? 'No company page found' : `LinkedIn ${li.status}`) });
  else {
    const data = (li.result as any)?.data || {};
    ownLinkedin = {};
    for (const k of ['linkedin_url', 'name', 'website', 'phone', 'headquarters', 'founded', 'industry', 'company_type', 'company_size', 'specialties', 'about_us']) {
      if (data[k]) ownLinkedin[k] = cleanText(String(data[k]));
    }
    if (!ownLinkedin.linkedin_url) ownLinkedin.linkedin_url = li.url;
  }

  return {
    version: '2.1',
    stage: 1.5,
    input,
    official: { domain, site_wide: siteWide.join('\n'), pages: tidyPages, other_own_pages: otherOwn },
    own_linkedin: ownLinkedin,
    evidence,
    registers,
    technical_audit: technicalAudit,
    could_not_check: couldNotCheck,
  };
}

/** Rules v2 (step2-v2.ts): each official page is citable as O1, O2... in page order; the site-wide lines as O0. */
export function officialId(pageIndex: number): string {
  return `O${pageIndex + 1}`;
}

/** Lay the tidy data out as the Step 2 user prompt. Same order as the system prompt describes.
 *  `officialIds` (rules v2) puts the O0 / O1... ids on the official pages; the v1 prompt is laid out as before. */
export function renderTidy(t: TidyData, opts: { officialIds?: boolean } = {}): string {
  const out: string[] = [];
  const tag = (id: string) => (opts.officialIds ? `[${id}] ` : '');
  out.push(`# COMPANY: "${t.input.company}" | ${t.input.country} | ${t.input.industry} | official domain: ${t.official.domain || 'none'}`);

  out.push(`\n## A. OFFICIAL SITE (what the company says)`);
  out.push(`Pages read in full: ${t.official.pages.map((p) => p.label).join(', ') || 'none'}.`);
  t.official.pages.forEach((p, i) => {
    out.push(`\n### ${tag(officialId(i))}OFFICIAL PAGE ${p.label.toUpperCase()} — ${p.url}`);
    out.push(p.text || '(empty)');
    if (p.cut_chars) out.push(`[${p.cut_chars} more characters of this page not shown]`);
  });
  if (t.official.site_wide) {
    out.push(`\n### ${tag('O0')}SITE-WIDE HEADER / MENU / FOOTER (repeats on every page read)`);
    out.push(t.official.site_wide);
  }
  if (t.official.other_own_pages.length) {
    out.push(`\n### OTHER PAGES ON THE OFFICIAL DOMAIN (seen in search only, search snippets, page not read)`);
    for (const o of t.official.other_own_pages) out.push(`- ${o.url} | ${o.title}\n  ${o.text.replace(/\n/g, '\n  ')}`);
  }

  out.push(`\n## B. COMPANY'S OWN LINKEDIN PAGE (id: LINKEDIN)`);
  if (t.own_linkedin) for (const [k, v] of Object.entries(t.own_linkedin)) out.push(`- ${k}: ${v}`);
  else out.push('(not available)');

  out.push(`\n## C. OUTSIDE EVIDENCE (${t.evidence.length} items; which ones are this company is your call)`);
  for (const e of t.evidence) {
    out.push(`\n[${e.id}] ${e.kind} | ${e.source_name} | ${e.url}${e.title ? ` | title: ${e.title}` : ''}${e.query ? ` | found by search: ${e.query}` : ''}`);
    out.push(e.text || '(no text)');
  }

  out.push(`\n## D. REGISTER CHECKS (${t.registers.length}; each register page was read whole by plain code)`);
  for (const g of t.registers) {
    out.push(`\n[${g.id}] ${g.source_name} | ${g.url}`);
    out.push(`Question: ${g.question}`);
    if (g.found_when) out.push(`Counts as found when: ${g.found_when}`);
    if (g.not_found_when) out.push(`Counts as not found when: ${g.not_found_when}`);
    if (g.page_chars) {
      if (g.mentions.length) {
        out.push(`Passages where ${g.name_terms.map((x) => `"${x}"`).join(' / ')} appear in the ${g.page_chars}-character page:`);
        for (const m of g.mentions) out.push(`  > ${m}`);
      } else {
        out.push(`None of ${g.name_terms.map((x) => `"${x}"`).join(' / ')} appear anywhere in the ${g.page_chars}-character page.`);
      }
    }
    if (g.hits.length) {
      out.push('Search hits:');
      for (const h of g.hits) out.push(`  > ${h}`);
    }
    if (!g.page_chars && !g.hits.length) out.push('Nothing was returned.');
  }

  if (t.technical_audit && (t.technical_audit.items.length > 0 || t.technical_audit.seo_score !== undefined)) {
    out.push(`\n## E. TECHNICAL INFRASTRUCTURE & ASSET AUDIT (Google PageSpeed, Domain Security, SEO / GEO benchmark)`);
    if (t.technical_audit.seo_score !== undefined) {
      out.push(`- SEO / GEO benchmark of the official website: SEO ${t.technical_audit.seo_score}/100, GEO ${t.technical_audit.geo_score}/100. Groups: ${(t.technical_audit.audit_groups ?? []).join('; ')}.`);
    }
    if (t.technical_audit.mobile_score !== undefined) {
      out.push(`- Mobile PageSpeed Performance Score: ${t.technical_audit.mobile_score}/100`);
    }
    if (t.technical_audit.desktop_score !== undefined) {
      out.push(`- Desktop PageSpeed Performance Score: ${t.technical_audit.desktop_score}/100`);
    }
    for (const it of t.technical_audit.items) {
      out.push(`- [${it.severity.toUpperCase()}] ${it.title}: ${it.detail}`);
    }
  }

  if (t.could_not_check.length) {
    out.push(`\n## F. COULD NOT CHECK (say nothing about these)`);
    for (const c of t.could_not_check) out.push(`- ${c.target}: ${c.reason}`);
  }
  return out.join('\n');
}
