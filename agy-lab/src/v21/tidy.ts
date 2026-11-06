// V2.1 Step 1.5 — Tidy. Plain code between Step 1 (gather) and Step 2 (judge).
// It only cleans and lays out what Step 1 saved, so Step 2's LLM reads all of it in one clear shape.
// It never judges: no namesake dropping, no found/not-found verdicts, no ranking. Every item keeps its source URL
// and gets an id (E1, E2, R1...) that Step 2 cites.
import type { RawResearchCheckpoint } from './research.ts';

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
  could_not_check: Array<{ target: string; reason: string }>;
};

const PAGE_MAX = 15_000;
const SNIPPET_MAX = 700;
const MENTION_BEFORE = 120;
const MENTION_AFTER = 450;
const MENTIONS_MAX = 6;

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
  return t.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
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

/** Markdown to plain lines: drop images, keep link text, drop bare link targets. */
function pageLines(markdown: string): string[] {
  return String(markdown ?? '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\((?:[^()]|\([^)]*\))*\)/g, '$1')
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter((l) => l && !/^[-=*_#|\s]+$/.test(l));
}

const GENERIC = new Set([
  'sdn', 'bhd', 'pte', 'ltd', 'pty', 'plt', 'llc', 'inc', 'co', 'the', 'and', 'group', 'holdings', 'company',
  'limited', 'corporation', 'corp', 'singapore', 'malaysia', 'australia', 'korea',
  // common business words: on their own they match half of any register
  'advisors', 'advisory', 'consulting', 'consultants', 'partners', 'digital', 'design', 'logistics', 'marketing',
  'services', 'solutions', 'trading', 'international', 'global', 'media', 'studio', 'agency', 'interior', 'web',
  '주식회사', '주', '유', '세무법인', '회계법인', '법무법인', '유한회사',
]);

/** The company name as written, plus its distinctive words (generic company words removed). */
export function nameTerms(company: string): string[] {
  const full = company.replace(/[()㈜]/g, ' ').replace(/\s+/g, ' ').trim();
  const words = full
    .split(/[\s&.,'’\-]+/)
    .map((w) => w.trim())
    .filter((w) => w && !GENERIC.has(w.toLowerCase()))
    .filter((w) => (/[가-힣]/.test(w) ? w.length >= 2 : w.length >= 3));
  const out = [full, ...words.filter((w) => w.toLowerCase() !== full.toLowerCase())];
  return [...new Set(out)].filter(Boolean);
}

/** Passages around where the name terms appear in a long page. Full name first; single words only if it is absent. */
export function findMentions(text: string, terms: string[]): string[] {
  // Link targets and images are noise in a register table; keep the visible text.
  const flat = String(text ?? '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\((?:[^()]|\([^)]*\))*\)/g, '$1')
    .replace(/\s+/g, ' ');
  const lower = flat.toLowerCase();
  const spans: Array<[number, number]> = [];
  for (const [i, term] of terms.entries()) {
    if (i > 0 && spans.length) break; // the full name was found: don't widen to single words
    const t = term.toLowerCase();
    let at = lower.indexOf(t);
    while (at !== -1 && spans.length < 50) {
      // Registers list one entity per row and a row's details follow its name: take little before the name
      // (so the previous row's details don't come along) and more after it.
      spans.push([Math.max(0, at - MENTION_BEFORE), Math.min(flat.length, at + t.length + MENTION_AFTER)]);
      at = lower.indexOf(t, at + t.length);
    }
  }
  spans.sort((a, b) => a[0] - b[0]);
  const merged: Array<[number, number]> = [];
  for (const s of spans) {
    const last = merged[merged.length - 1];
    if (last && s[0] <= last[1]) last[1] = Math.max(last[1], s[1]);
    else merged.push([...s]);
  }
  return merged.slice(0, MENTIONS_MAX).map(([a, b]) => (a > 0 ? '…' : '') + flat.slice(a, b).trim() + (b < flat.length ? '…' : ''));
}

export function tidyCheckpoint(cp: RawResearchCheckpoint): TidyData {
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
    else if (nv.status === 'failed') couldNotCheck.push({ target: 'Naver Place', reason: nv.error || 'Naver Place search failed' });
    else {
      for (const p of nv.places || []) {
        evidence.push({
          id: `E${++n}`,
          kind: 'naver_place',
          source_name: 'Naver Place',
          url: `https://map.naver.com/p/entry/place/${p.id}`,
          title: p.name,
          text: [
            `Name: ${p.name}`,
            `Category: ${p.category ?? 'n/a'}`,
            `Road address: ${p.roadAddress ?? 'n/a'}`,
            `Lot address: ${p.address ?? 'n/a'}`,
            `Phone: ${p.phone ?? 'n/a'}`,
            `Virtual phone: ${p.virtualPhone ?? 'n/a'}`,
            `Visitor reviews: ${p.visitorReviewCount ?? 0}`,
            `Blog/cafe reviews: ${p.blogCafeReviewCount ?? 0}`,
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
    could_not_check: couldNotCheck,
  };
}

/** Lay the tidy data out as the Step 2 user prompt. Same order as the system prompt describes. */
export function renderTidy(t: TidyData): string {
  const out: string[] = [];
  out.push(`# COMPANY: "${t.input.company}" | ${t.input.country} | ${t.input.industry} | official domain: ${t.official.domain || 'none'}`);

  out.push(`\n## A. OFFICIAL SITE (what the company says)`);
  out.push(`Pages read in full: ${t.official.pages.map((p) => p.label).join(', ') || 'none'}.`);
  for (const p of t.official.pages) {
    out.push(`\n### OFFICIAL PAGE ${p.label.toUpperCase()} — ${p.url}`);
    out.push(p.text || '(empty)');
    if (p.cut_chars) out.push(`[${p.cut_chars} more characters of this page not shown]`);
  }
  if (t.official.site_wide) {
    out.push(`\n### SITE-WIDE HEADER / MENU / FOOTER (repeats on every page read)`);
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

  if (t.could_not_check.length) {
    out.push(`\n## E. COULD NOT CHECK (say nothing about these)`);
    for (const c of t.could_not_check) out.push(`- ${c.target}: ${c.reason}`);
  }
  return out.join('\n');
}
