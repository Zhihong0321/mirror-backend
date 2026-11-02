// C / llm — website health, read by an LLM.
// Crawls the official site(s) (homepage + up to ~14 internal pages linked from it, about/contact/
// services/projects first), then deepseek reads each page and reports grammar and spelling errors,
// unclear or unprofessional wording, outdated content and inconsistencies, each with the exact quote
// and URL. A last call compares the numeric claims across all pages. Every quote is checked against
// the page text, and a quote that is not on the page is dropped (kept in notes for grading).
import type { Ctx, Finding } from '../lib.ts';

// ---------------------------------------------------------------------------------------------
// Crawl helper (same copy in C-rules.ts). Bounded, polite: 3 requests at a time, robots.txt honoured.
// ---------------------------------------------------------------------------------------------
const PER_DOMAIN = Number(process.env.C_PER_DOMAIN ?? 15);
const TOTAL_PAGES = Number(process.env.C_TOTAL_PAGES ?? 50);
const CONCURRENCY = 3;

export type CPage = {
  url: string; finalUrl: string; status: number; ms: number; bytes: number; html: string; text: string;
  unique: string; error?: string; headers: Record<string, string>; site: string; isHome: boolean;
};
export type CSite = {
  domain: string; host: string; home: string; aliases: string[]; disallow: string[];
  hrefs: string[]; pages: CPage[];
};

const bareHost = (u: string) => { try { return new URL(u).hostname.toLowerCase().replace(/^www\./, ''); } catch { return ''; } };
const ASSET = /\.(css|js|mjs|json|xml|txt|png|jpe?g|gif|webp|svg|ico|woff2?|ttf|eot|pdf|zip|mp4|webm|mp3|avif)(\?|$)/i;
const SKIP_PATH = /\/(admin|login|wp-admin|wp-login|agent|cart|checkout|account|feed|cdn-cgi)(\/|$)|\/(cn|zh|zh-cn|ms|my-ms|bm)(\/|$)|[?&]format=/i;
const PRIORITY: [RegExp, number][] = [
  [/about|company|who-we-are|profile|tentang|pages_id/i, 10],
  [/contact|hubungi|enquir/i, 10],
  [/service|solution|epc|o-?and-?m/i, 8],
  [/project|portfolio|case|gallery|photoalbum|apex|mwp/i, 7],
  [/product|ourproducts|inverter|module|panel|storage|ess/i, 5],
  [/faq|warranty|career|privacy|tips|news|latestnews/i, 4],
];

export async function pool<T, R>(items: T[], n: number, fn: (x: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); }
  }));
  return out;
}

export function hrefsOf(html: string, base: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/<a\b[^>]*?\bhref\s*=\s*(["'])(.*?)\1/gis)) {
    const raw = m[2].replace(/&amp;/g, '&').trim();
    if (!raw || raw.startsWith('#') || /^javascript:/i.test(raw)) continue;
    try { out.push(/^(mailto|tel|sms|whatsapp):/i.test(raw) ? raw : new URL(raw, base).href); } catch { /* bad href */ }
  }
  return [...new Set(out)];
}

const normUrl = (u: string) => { try { const x = new URL(u); x.hash = ''; let s = x.href; if (s.endsWith('/') && x.pathname !== '/') s = s.slice(0, -1); return s; } catch { return u; } };

function robotsDisallow(txt: string): string[] {
  const out: string[] = [];
  let applies = false;
  for (const line of txt.split(/\r?\n/)) {
    const [k, ...rest] = line.split(':');
    const v = rest.join(':').trim();
    if (/^user-agent$/i.test(k.trim())) applies = v === '*';
    else if (applies && /^disallow$/i.test(k.trim()) && v) out.push(v);
  }
  return out;
}

/** Lines that repeat on most pages of a site (menus, footers) are boilerplate; `unique` drops them. */
function markBoilerplate(site: CSite) {
  const pages = site.pages.filter((p) => p.text);
  const count = new Map<string, number>();
  for (const p of pages) for (const l of new Set(p.text.split('\n').map((x) => x.trim()).filter(Boolean))) count.set(l, (count.get(l) ?? 0) + 1);
  const limit = Math.max(2, Math.ceil(pages.length * 0.4));
  for (const p of site.pages) {
    p.unique = p.isHome || pages.length < 3 ? p.text : p.text.split('\n').filter((l) => (count.get(l.trim()) ?? 0) < limit).join('\n');
  }
}

export async function crawl(ctx: Ctx, dive: any): Promise<{ sites: CSite[]; redirects: { domain: string; to: string }[] }> {
  const domains: string[] = [...new Set<string>((dive.result?.identity?.official_domains ?? []).map((d: string) => d.toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '')))];
  const sites: CSite[] = [];
  const redirects: { domain: string; to: string }[] = [];
  let budget = TOTAL_PAGES;
  const toPage = (r: Awaited<ReturnType<Ctx['page']>>, site: string, isHome: boolean): CPage => ({
    url: r.url, finalUrl: r.finalUrl, status: r.status, ms: r.ms, bytes: Buffer.byteLength(r.html ?? ''), html: r.html ?? '',
    text: r.html ? decodeEntities(ctx.htmlText(r.html)) : '', unique: '', error: r.error, headers: r.headers, site, isHome,
  });

  for (const d of domains) {
    if (budget <= 0) { ctx.warn(`page budget spent before ${d}`); break; }
    let r = await ctx.page(`https://${d}/`);
    budget--;
    if (r.status === 0) { ctx.warn(`https://${d}/ failed (${r.error}); trying http`); r = await ctx.page(`http://${d}/`); budget--; }
    if (r.status === 0 || r.status >= 400) { ctx.warn(`${d} homepage: HTTP ${r.status} ${r.error ?? ''}`); sites.push({ domain: d, host: d, home: `https://${d}/`, aliases: [], disallow: [], hrefs: [], pages: [toPage(r, d, true)] }); continue; }
    const host = bareHost(r.finalUrl);
    const existing = sites.find((s) => s.host === host);
    if (existing) { existing.aliases.push(d); redirects.push({ domain: d, to: r.finalUrl }); ctx.log(`${d} redirects to ${r.finalUrl} (same site as ${existing.domain})`); continue; }
    if (host !== d) redirects.push({ domain: d, to: r.finalUrl });
    const site: CSite = { domain: d, host, home: r.finalUrl, aliases: [], disallow: [], hrefs: [], pages: [toPage(r, d, true)] };
    sites.push(site);
    const robots = await ctx.page(new URL('/robots.txt', r.finalUrl).href);
    if (robots.status === 200 && !/<html/i.test(robots.html)) site.disallow = robotsDisallow(robots.html);
    site.hrefs = hrefsOf(r.html, r.finalUrl);

    const seen = new Set([normUrl(r.finalUrl), normUrl(`https://${d}/`)]);
    const candidates = site.hrefs
      .filter((u) => /^https?:/i.test(u) && bareHost(u) === host && !ASSET.test(u) && !SKIP_PATH.test(new URL(u).pathname + new URL(u).search))
      .map(normUrl)
      .filter((u) => !seen.has(u) && (seen.add(u), true))
      .filter((u) => !site.disallow.some((p) => new URL(u).pathname.startsWith(p)))
      .map((u, i) => ({ u, score: PRIORITY.reduce((s, [re, w]) => s + (re.test(new URL(u).pathname) ? w : 0), 0) - i * 0.01 }))
      .sort((a, b) => b.score - a.score)
      .slice(0, Math.max(0, Math.min(PER_DOMAIN - 1, budget)))
      .map((x) => x.u);
    budget -= candidates.length;
    ctx.log(`${d}: homepage + ${candidates.length} pages: ${candidates.map((u) => new URL(u).pathname).join(' ')}`);
    const pages = await pool(candidates, CONCURRENCY, async (u) => toPage(await ctx.page(u), d, false));
    site.pages.push(...pages);
    markBoilerplate(site);
  }
  return { sites, redirects };
}

/** htmlText leaves numeric entities (&#34; &#039;) and a few named ones; a browser shows them decoded. */
export function decodeEntities(s: string): string {
  return s.replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&(hellip|mdash|ndash|times|copy|reg|trade|middot|bull|rarr|larr);/g, (_, n) => ({ hellip: '…', mdash: '—', ndash: '–', times: '×', copy: '©', reg: '®', trade: '™', middot: '·', bull: '•', rarr: '→', larr: '←' } as Record<string, string>)[n]);
}

/** Split text into pieces of at most `max` chars at line breaks (or spaces), never inside a word. */
export function splitText(text: string, max: number): string[] {
  const out: string[] = [];
  let rest = text;
  while (rest.length > max) {
    let cut = rest.lastIndexOf('\n', max);
    if (cut < max * 0.5) cut = rest.lastIndexOf(' ', max);
    if (cut <= 0) cut = max;
    out.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) out.push(rest);
  return out;
}

/** WhatsApp pre-filled messages on a page (text the customer sends, so it is site copy too). */
export function waPrefills(html: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/https?:\/\/(?:wa\.me|api\.whatsapp\.com\/send)[^"'\s>]*/gi)) {
    try { const t = new URL(m[0].replace(/&amp;/g, '&')).searchParams.get('text'); if (t) out.push(t.replace(/&#0?39;/g, "'").replace(/&quot;/g, "\"").replace(/&amp;/g, "&").trim()); } catch { /* skip */ }
  }
  return [...new Set(out)];
}

const normQ = (s: string) => s.toLowerCase().replace(/[‘’ʼ`]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
export function quoteOnPage(quote: string, page: CPage, extra = ''): boolean {
  const q = normQ(quote).replace(/^["']|["']$/g, '').replace(/\.\.\.|…/g, '');
  if (!q) return false;
  const hay = normQ(page.text + ' ' + extra);
  if (hay.includes(q)) return true;
  // Allow an elided middle ("... ") by checking each long part.
  const parts = q.split(/\s*(?:\.\.\.|…)\s*/).filter((x) => x.length > 8);
  return parts.length > 1 && parts.every((x) => hay.includes(x));
}

// ---------------------------------------------------------------------------------------------
// The LLM lane
// ---------------------------------------------------------------------------------------------
const MAX_LLM = 44;
const CHUNK = 12000;
const PAGE_CAP = Number(process.env.C_PAGE_CAP ?? 24000);

function phonesFromDive(dive: any): string[] {
  const text = JSON.stringify(dive.result?.facts ?? []);
  return [...new Set([...text.matchAll(/\+?6?0\s?1\d[\d\s-]{7,11}\d|\+?6?0\s?[3-9][\d\s-]{6,10}\d/g)].map((m) => m[0].trim()))];
}

export async function run(ctx: Ctx, dive: any): Promise<{ findings: Finding[]; notes: Record<string, unknown> }> {
  const r = dive.result ?? {};
  const id = r.identity ?? {};
  const today = ctx.now().slice(0, 10);
  const { sites, redirects } = await crawl(ctx, dive);
  const findings: Finding[] = [];
  const dropped: any[] = [];
  const claims: { url: string; claims: string[] }[] = [];
  const perPage: any[] = [];

  const facts = [
    `Legal name: ${id.legal_name}; registration numbers: ${(id.registration_numbers ?? []).join(', ')}`,
    `Address (HQ): ${id.address}`,
    `Founded: ${(r.facts ?? []).find((f: any) => /incorporated|established|founded/i.test(f.fact))?.fact ?? 'unknown'}`,
    `Phones seen elsewhere: ${phonesFromDive(dive).join(', ')}`,
  ].join('\n');

  const system = 'You are a meticulous copy editor auditing a Malaysian company\'s website for its owner. You report only real, specific problems that a careful native English editor would fix, and you quote the page exactly.';
  const askPage = (url: string, text: string, part: string) =>
    `Company: ${dive.company}. Today is ${today}.\nKnown facts about the company (from public records):\n${facts}\n\n` +
    `Below is the visible text of ONE page of its website${part}: ${url}\n` +
    `(Menus, buttons and footers are flattened into lines; that is normal, do not report layout.)\n\n` +
    `Report:\n- "spelling": misspelled English words.\n- "grammar": grammatical errors.\n- "wording": unclear, awkward or unprofessional wording a customer would notice (not mere style preferences).\n- "outdated": content that looks stale as of today (old years, expired offers, past events written as upcoming, old copyright).\n- "inconsistency": statements that contradict each other on this page or contradict the known facts.\n` +
    `Do NOT report: Malay or Chinese words, brand and product names, model codes, units (kWp, MWp), British vs American spelling, ALL-CAPS headings, or missing punctuation in menus and button labels.\n` +
    `"quote" must be copied character-for-character from the page text (3 to 25 words), so it can be found with a text search.\n` +
    `Also list "claims": short factual claims on the page that carry a number or date (projects done, capacity, staff, offices, years, warranty, phone numbers, addresses).\n` +
    `Return JSON only: {"issues":[{"type":"spelling|grammar|wording|outdated|inconsistency","quote":"...","fix":"suggested correction","why":"one short sentence","severity":"high|medium|low"}],"claims":["..."]}\n\n` +
    `PAGE TEXT:\n${text}`;

  const jobs: { site: CSite; page: CPage; text: string; part: string }[] = [];
  for (const site of sites) {
    for (const p of site.pages) {
      if (p.status !== 200 || !p.text) continue;
      let text = (p.isHome ? p.text : p.unique).trim();
      const pre = waPrefills(p.html);
      if (pre.length && p.isHome) text += `\n\n[WhatsApp pre-filled message(s) on this page]\n${pre.join('\n')}`;
      if (text.length < 150) { ctx.log(`skip ${p.finalUrl}: only ${text.length} chars of own text`); continue; }
      // A listing page (news feed, archive) can be 50x a normal page; read only its first PAGE_CAP chars.
      if (text.length > PAGE_CAP) { ctx.log(`${p.finalUrl}: ${text.length} chars of own text, reading the first ${PAGE_CAP}`); text = splitText(text, PAGE_CAP)[0]; }
      const parts = splitText(text, CHUNK);
      parts.forEach((t, i) => jobs.push({ site, page: p, text: t, part: parts.length > 1 ? ` (part ${i + 1} of ${parts.length})` : '' }));
    }
  }
  if (jobs.length > MAX_LLM - 1) { ctx.warn(`${jobs.length} page reads exceed the LLM budget; reading the first ${MAX_LLM - 1}`); jobs.length = MAX_LLM - 1; }
  ctx.log(`${jobs.length} LLM page reads`);

  await pool(jobs, 3, async (j) => {
    const answer = await ctx.llm(askPage(j.page.finalUrl, j.text, j.part), { system });
    const parsed = ctx.parseJson<any>(answer);
    if (!parsed) { ctx.warn(`no JSON for ${j.page.finalUrl}${j.part}`); return; }
    const issues: any[] = Array.isArray(parsed.issues) ? parsed.issues : [];
    perPage.push({ url: j.page.finalUrl, part: j.part, issues: issues.length });
    if (Array.isArray(parsed.claims) && parsed.claims.length) claims.push({ url: j.page.finalUrl, claims: parsed.claims.map(String).slice(0, 25) });
    const prefill = waPrefills(j.page.html).join(' ');
    for (const it of issues) {
      const quote = String(it.quote ?? '').trim();
      const onPage = quoteOnPage(quote, j.page, prefill);
      const f: Finding = {
        title: `${String(it.type ?? 'issue')}: "${quote.slice(0, 90)}"`,
        detail: `${it.why ?? ''}${it.fix ? ` Suggested: "${it.fix}".` : ''}`.trim(),
        severity: ['high', 'medium', 'low'].includes(it.severity) ? it.severity : 'low',
        source: j.page.finalUrl, checked_at: ctx.now(), evidence: quote, type: it.type, fix: it.fix ?? null, quote_on_page: onPage,
      };
      if (onPage) findings.push(f); else dropped.push(f);
    }
  });

  // One cross-page call: do the pages (and domains) contradict each other?
  if (claims.length > 1 && ctx.meter.llm.calls < MAX_LLM) {
    const list = claims.map((c) => `${c.url}\n${c.claims.map((x) => '  - ' + x).join('\n')}`).join('\n');
    const answer = await ctx.llm(
      `Company: ${dive.company}. Today is ${today}. Known facts:\n${facts}\n\nThese are the factual claims found on each page of its website(s). ` +
      `Find claims that CONTRADICT each other across pages or domains (different project counts, capacities, staff numbers, office counts, warranty terms, phone numbers, addresses, founding dates), or contradict the known facts. ` +
      `Only real conflicts, not the same thing worded differently. Return JSON only: {"issues":[{"quote_a":"claim text as listed","url_a":"...","quote_b":"claim text as listed","url_b":"...","why":"one sentence","severity":"high|medium|low"}]}\n\n${list}`,
      { system },
    );
    const parsed = ctx.parseJson<any>(answer);
    if (!parsed) ctx.warn('no JSON from the cross-page call');
    for (const it of parsed?.issues ?? []) {
      findings.push({
        title: `inconsistency across pages: "${String(it.quote_a).slice(0, 70)}" vs "${String(it.quote_b).slice(0, 70)}"`,
        detail: `${it.why ?? ''} (${it.url_a} vs ${it.url_b})`, severity: ['high', 'medium', 'low'].includes(it.severity) ? it.severity : 'medium',
        source: it.url_a ?? null, checked_at: ctx.now(), evidence: `${it.quote_a} | ${it.quote_b}`, type: 'inconsistency-cross', quote_on_page: null,
      });
    }
  }

  return {
    findings,
    notes: {
      redirects,
      sites: sites.map((s) => ({ domain: s.domain, host: s.host, aliases: s.aliases, pages: s.pages.map((p) => ({ url: p.finalUrl, status: p.status, ms: p.ms, chars: p.text.length, unique: p.unique.length })) })),
      pages_fetched: ctx.meter.http.calls, perPage, claims, dropped_not_on_page: dropped,
    },
  };
}
