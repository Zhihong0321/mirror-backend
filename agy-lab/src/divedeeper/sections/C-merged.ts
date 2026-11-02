// C / merged — website health, round 3 (see C-results.md). Rule checks from C-rules (LanguageTool dropped)
// + a defacement gate + an LLM that reads only the company's own prose.
//
// 1. Crawl: homepage + up to 14 linked pages per site (about/contact/services/projects first), 3 at a time,
//    robots.txt honoured, /index.html treated as /, `{{template}}` links skipped.
// 2. Defacement gate on each homepage (gambling/spam words, foreign <html lang> with a title that does not
//    name the company, unrendered {{...}} templates). A tripped site gets ONE high alert and nothing else:
//    no crawl, no link checks, no LLM.
// 3. Rule checks: SSL, http->https, viewport, title/description length, (c) year, SSM number (cleaned, and
//    "site shows X, registry shows Y" on a mismatch), free mail, phones vs the dive and Google Maps
//    (out/H-maps-<id>.json), street unit vs the dive, broken internal links (15 checked), wa.me business
//    name, tel:, mailto: MX, forms (never submitted), stale news, placeholder pages, plus feed hygiene
//    (duplicate cards, leaked AI/pipeline notes), junk image alt text, third-party credit links, and
//    brand-name variants ("Jingko" next to "Jinko").
// 4. LLM (deepseek): only the company's own prose pages (no news/blog listings), on cleaner text: images
//    become "[image]", inline tags do not add spaces, JS counters show their target value, review and
//    cookie widgets are removed. At most 5 issues a page; a finding is kept only when its exact quote is in
//    the page text. One cross-page call compares exact-quoted claims across pages and domains.
import fs from 'node:fs';
import path from 'node:path';
import tls from 'node:tls';
import dns from 'node:dns/promises';
import type { Ctx, Finding } from '../lib.ts';
import { OUT } from '../lib.ts';

const PER_DOMAIN = Number(process.env.C_PER_DOMAIN ?? 15);
const TOTAL_PAGES = Number(process.env.C_TOTAL_PAGES ?? 50);
const LINK_CAP = Number(process.env.C_LINK_CAP ?? 15);
const MAX_LLM = Number(process.env.C_MAX_LLM ?? 40);
const PAGE_CHARS = 12000;
const CONCURRENCY = 3;

// ---------------------------------------------------------------------------------------------
// HTML -> text that matches what a visitor sees
// ---------------------------------------------------------------------------------------------
const NAMED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', hellip: '…', mdash: '—', ndash: '–', times: '×', copy: '©', reg: '®', trade: '™', middot: '·', bull: '•', rarr: '→', larr: '←', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', laquo: '«', raquo: '»', deg: '°', euro: '€', pound: '£' };
export function decodeEntities(s: string): string {
  return s.replace(/&#(\d+);/g, (_, n) => { try { return String.fromCodePoint(Number(n)); } catch { return ' '; } })
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => { try { return String.fromCodePoint(parseInt(n, 16)); } catch { return ' '; } })
    .replace(/&([a-z]+);/gi, (m, n) => NAMED[n.toLowerCase()] ?? m);
}

/** Remove whole elements whose class or id matches `re` (balanced on the same tag name). */
function removeBlocks(html: string, re: RegExp): string {
  const open = new RegExp(`<(div|section|aside|footer|span|ul|iframe)\\b[^>]*\\b(?:class|id)\\s*=\\s*["'][^"']*(?:${re.source})[^"']*["'][^>]*>`, 'i');
  for (let guard = 0; guard < 200; guard++) {
    const m = open.exec(html);
    if (!m) break;
    const tag = m[1].toLowerCase();
    const tagRe = new RegExp(`<${tag}\\b[^>]*>|</${tag}\\s*>`, 'gi');
    tagRe.lastIndex = m.index + m[0].length;
    let depth = 1, end = html.length;
    for (let t = tagRe.exec(html); t; t = tagRe.exec(html)) {
      depth += t[0][1] === '/' ? -1 : 1;
      if (depth === 0) { end = t.index + t[0].length; break; }
    }
    html = html.slice(0, m.index) + ' ' + html.slice(end);
  }
  return html;
}

const WIDGETS = /trustindex|ti-widget|ti-review|elfsight|eapps-|google-review|grw-|wp-google-reviews|cookie|cky-|cmplz|gdpr|moove_gdpr|chaty|joinchat|wa-widget/;
const BLOCK = /^(p|div|li|ul|ol|h[1-6]|tr|td|th|table|thead|tbody|section|article|header|footer|nav|aside|main|form|label|button|option|select|figure|figcaption|blockquote|dd|dt|dl|pre|hr|address)$/i;
const INLINE = /^(span|a|strong|b|em|i|u|sup|sub|small|mark|abbr|code|font|s|strike|del|ins|time|cite|q|bdi|bdo|wbr)$/i;

/** Visible text: scripts, styles, widgets removed; images -> "[image]"; inline tags join without spaces. */
export function cleanText(html: string): string {
  let h = html
    .replace(/<head\b[\s\S]*?<\/head>/i, ' ')
    .replace(/<(script|style|noscript|template|svg|iframe|select)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<![^>]*>/g, ' ');
  h = removeBlocks(h, WIDGETS);
  // JS counters (Elementor, PureCounter, CountUp): show the target the script counts up to.
  h = h.replace(/(<(\w+)\b[^>]*\bdata-(?:to-value|target|count|end|purecounter-end|counter)\s*=\s*["']([\d.,]+)["'][^>]*>)\s*0\s*(<\/\2>)/gi, '$1$3$4');
  h = h.replace(/<img\b[^>]*>/gi, ' [image] ');
  h = h.replace(/<br\s*\/?>/gi, '\n');
  h = h.replace(/<\/?([a-z][a-z0-9]*)\b[^>]*>/gi, (_, t) => (BLOCK.test(t) ? '\n' : INLINE.test(t) ? '\u0001' : ' '));
  h = decodeEntities(h);
  h = h.replace(/([\p{L}\p{N}])\u0001+(?=[\p{L}\p{N}])/gu, '$1 ').replace(/\u0001/g, '');
  return h.split('\n').map((l) => l.replace(/[ \t ]+/g, ' ').trim()).filter(Boolean)
    .join('\n').replace(/(\[image\]\s*){2,}/g, '[image] ').replace(/\n(\[image\]\n)+/g, '\n[image]\n').trim();
}

// ---------------------------------------------------------------------------------------------
// Crawl
// ---------------------------------------------------------------------------------------------
export type CPage = { url: string; finalUrl: string; status: number; ms: number; bytes: number; html: string; text: string; unique: string; error?: string; headers: Record<string, string>; site: string; isHome: boolean };
export type CSite = { domain: string; host: string; home: string; aliases: string[]; disallow: string[]; hrefs: string[]; pages: CPage[]; defaced?: { signals: string[]; title: string; lang: string; sample: string[] } };

const bareHost = (u: string) => { try { return new URL(u).hostname.toLowerCase().replace(/^www\./, ''); } catch { return ''; } };
const ASSET = /\.(css|js|mjs|json|xml|txt|png|jpe?g|gif|webp|svg|ico|woff2?|ttf|eot|pdf|zip|mp4|webm|mp3|avif)(\?|$)/i;
const SKIP_PATH = /\/(admin|login|wp-admin|wp-login|agent|cart|checkout|account|feed|cdn-cgi|my-account|wp-json)(\/|$)|\/(cn|zh|zh-cn|ms|my-ms|bm)(\/|$)|[?&]format=|%7B%7B|\{\{/i;
const PRIORITY: [RegExp, number][] = [
  [/about|company|who-we-are|profile|tentang|pages_id/i, 10],
  [/contact|hubungi|enquir/i, 10],
  [/service|solution|epc|o-?and-?m|install/i, 8],
  [/project|portfolio|case|gallery|photoalbum/i, 7],
  [/product|shop|catalog|package|panel|gate|tent/i, 5],
  [/faq|warranty|career|privacy|tips|news|latestnews/i, 4],
];
const LISTING = /\/(news|blog|tips|latestnews|media|media-news|press|articles?|category|tag|author|page\/\d+)(\/|$)/i;

export async function pool<T, R>(items: T[], n: number, fn: (x: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); } }));
  return out;
}
export function hrefsOf(html: string, base: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/<a\b[^>]*?\bhref\s*=\s*(["'])(.*?)\1/gis)) {
    const raw = m[2].replace(/&amp;/g, '&').trim();
    if (!raw || raw.startsWith('#') || /^javascript:/i.test(raw) || /\{\{|%7B%7B/i.test(raw)) continue;
    try { out.push(/^(mailto|tel|sms|whatsapp):/i.test(raw) ? raw : new URL(raw, base).href); } catch { /* bad href */ }
  }
  return [...new Set(out)];
}
const normUrl = (u: string) => {
  try { const x = new URL(u); x.hash = ''; x.pathname = x.pathname.replace(/\/index\.(html?|php)$/i, '/'); let s = x.href; if (s.endsWith('/') && x.pathname !== '/') s = s.slice(0, -1); return s; } catch { return u; }
};
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
function markBoilerplate(site: CSite) {
  const pages = site.pages.filter((p) => p.text);
  const count = new Map<string, number>();
  for (const p of pages) for (const l of new Set(p.text.split('\n').map((x) => x.trim()).filter(Boolean))) count.set(l, (count.get(l) ?? 0) + 1);
  const limit = Math.max(2, Math.ceil(pages.length * 0.4));
  for (const p of site.pages) p.unique = p.isHome || pages.length < 3 ? p.text : p.text.split('\n').filter((l) => (count.get(l.trim()) ?? 0) < limit).join('\n');
}

const GAMBLING = /\b(slot\s?(?:online|gacor|88)?|gacor|togel|judi|casino|kasino|poker|sbobet|maxwin|jackpot|rtp\s?live|scatter|taruhan|bandar\s?(?:judi|togel|bola)|sportsbook|betting|bet88|bonus\s?new\s?member|deposit\s?(?:pulsa|dana)|daftar\s?(?:slot|akun|game)|viagra|cialis|replica\s?watches)\b/gi;

/** Signals that a homepage serves someone else's content. Tripped -> the site is not the company's. */
export function defacement(html: string, text: string, companyTokens: string[], domain: string): CSite['defaced'] | undefined {
  const title = decodeEntities(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '').replace(/\s+/g, ' ').trim();
  const h1 = cleanText(html.match(/<h1\b[\s\S]*?<\/h1>/i)?.[0] ?? '');
  const lang = (html.match(/<html\b[^>]*\blang\s*=\s*["']([^"']+)/i)?.[1] ?? '').toLowerCase();
  const hits = [...(title + '\n' + text).matchAll(GAMBLING)].map((m) => m[0].toLowerCase());
  const label = domain.split('.')[0].toLowerCase();
  const named = (s: string) => { const l = s.toLowerCase().replace(/[^a-z0-9]+/g, ' '); return companyTokens.some((t) => l.includes(t)) || l.replace(/ /g, '').includes(label); };
  const titleMismatch = !!title && !named(title) && !named(h1);
  const foreignLang = !!lang && !/^(en|ms|zh|ta|my)\b/.test(lang);
  const templates = (text.match(/\{\{[^}]{2,80}\}\}/g) ?? []).length;
  const signals: string[] = [];
  if (hits.length >= 5) signals.push(`${hits.length} gambling/spam words (${[...new Set(hits)].slice(0, 6).join(', ')})`);
  if (titleMismatch) signals.push(`title "${title.slice(0, 90)}" does not name the company`);
  if (foreignLang) signals.push(`<html lang="${lang}">`);
  if (templates >= 3) signals.push(`${templates} unrendered {{template}} placeholders`);
  const tripped = hits.length >= 5 || (titleMismatch && (foreignLang || templates >= 3));
  return tripped ? { signals, title, lang, sample: [...new Set(hits)].slice(0, 8) } : undefined;
}

export async function crawl(ctx: Ctx, dive: any, companyTokens: string[]): Promise<{ sites: CSite[]; redirects: { domain: string; to: string }[] }> {
  const domains: string[] = [...new Set<string>((dive.result?.identity?.official_domains ?? []).map((d: string) => d.toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '')))];
  const sites: CSite[] = [];
  const redirects: { domain: string; to: string }[] = [];
  let budget = TOTAL_PAGES;
  const toPage = (r: Awaited<ReturnType<Ctx['page']>>, site: string, isHome: boolean): CPage => ({
    url: r.url, finalUrl: r.finalUrl, status: r.status, ms: r.ms, bytes: Buffer.byteLength(r.html ?? ''), html: r.html ?? '',
    text: r.html ? cleanText(r.html) : '', unique: '', error: r.error, headers: r.headers, site, isHome,
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
    const home = toPage(r, d, true);
    const site: CSite = { domain: d, host, home: r.finalUrl, aliases: [], disallow: [], hrefs: [], pages: [home] };
    sites.push(site);
    site.defaced = defacement(r.html, home.text, companyTokens, d);
    if (site.defaced) { ctx.log(`${d}: DEFACEMENT gate tripped (${site.defaced.signals.join('; ')}); not crawling it`); home.unique = home.text; continue; }
    const robots = await ctx.page(new URL('/robots.txt', r.finalUrl).href);
    if (robots.status === 200 && !/<html/i.test(robots.html)) site.disallow = robotsDisallow(robots.html);
    site.hrefs = hrefsOf(r.html, r.finalUrl);
    const seen = new Set([normUrl(r.finalUrl), normUrl(`https://${d}/`), normUrl(`https://www.${d}/`)]);
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
    site.pages.push(...await pool(candidates, CONCURRENCY, async (u) => toPage(await ctx.page(u), d, false)));
    markBoilerplate(site);
  }
  return { sites, redirects };
}

export function waPrefills(html: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/https?:\/\/(?:wa\.me|api\.whatsapp\.com\/send)[^"'\s>]*/gi)) {
    try { const t = new URL(m[0].replace(/&amp;/g, '&')).searchParams.get('text'); if (t) out.push(decodeEntities(t).trim()); } catch { /* skip */ }
  }
  return [...new Set(out)];
}
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
const normQ = (s: string) => decodeEntities(s).toLowerCase().replace(/[‘’ʼ`´]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-').replace(/\s+/g, ' ').trim();
/** Strict: the whole quote (outer quotes trimmed) must appear in the page's visible text. */
export function quoteOnPage(quote: string, haystack: string): boolean {
  const q = normQ(quote).replace(/^["'“]+|["'”]+$/g, '').trim();
  return q.length >= 3 && normQ(haystack).includes(q);
}

// ---------------------------------------------------------------------------------------------
// Rule helpers (from C-rules)
// ---------------------------------------------------------------------------------------------
export function normPhone(raw: string): string {
  let d = raw.replace(/\D/g, '');
  if (d.startsWith('0')) d = '6' + d;
  else if (d.startsWith('1') && d.length >= 9 && d.length <= 10) d = '60' + d;
  if (!d.startsWith('60')) return '';
  const rest = d.slice(2);
  if (/^1\d{8,9}$/.test(rest) || /^3\d{8}$/.test(rest) || /^[4-9]\d{7,8}$/.test(rest)) return d;
  return '';
}
const fmtPhone = (d: string) => d.startsWith('601') ? `0${d.slice(2, 4)}-${d.slice(4)}` : `0${d.slice(2)}`;
const PHONE_RE = /(?:\+?\s?6?0)[\s-]?(?:1\d[\s-]?\d{3,4}[\s-]?\d{4}|[3-9][\s-]?\d{3,4}[\s-]?\d{4})(?![\d-]*[A-Z])/g;
const phonesIn = (text: string) => [...new Set([...text.matchAll(PHONE_RE)].map((m) => normPhone(m[0])).filter(Boolean))];

function sslCert(host: string): Promise<{ host: string; ok: boolean; error?: string; validTo?: string; daysLeft?: number; issuer?: string }> {
  return new Promise((resolve) => {
    const s = tls.connect({ host, port: 443, servername: host, rejectUnauthorized: false }, () => {
      const c = s.getPeerCertificate();
      const validTo = c?.valid_to ? new Date(c.valid_to) : null;
      resolve({ host, ok: s.authorized, error: s.authorized ? undefined : String(s.authorizationError), validTo: validTo?.toISOString(), daysLeft: validTo ? Math.round((validTo.getTime() - Date.now()) / 86400000) : undefined, issuer: c?.issuer?.O ?? c?.issuer?.CN });
      s.end();
    });
    s.on('error', (e) => resolve({ host, ok: false, error: e.message }));
  });
}
const attr = (tag: string, name: string) => tag.match(new RegExp(`\\b${name}\\s*=\\s*(["'])(.*?)\\1`, 'is'))?.[2] ?? null;
const metaContent = (html: string, name: string) => {
  for (const m of html.matchAll(/<meta\b[^>]*>/gi)) if ((attr(m[0], 'name') ?? attr(m[0], 'property') ?? '').toLowerCase() === name) return attr(m[0], 'content');
  return null;
};
const decode = (s: string) => decodeEntities(s).replace(/\s+/g, ' ').trim();
const MONTHS = 'jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec';
function datesIn(text: string, todayMs: number): Date[] {
  const out: Date[] = [];
  const push = (d: Date) => { if (!isNaN(d.getTime()) && d.getTime() <= todayMs + 86400000 && d.getFullYear() >= 2000) out.push(d); };
  for (const m of text.matchAll(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(${MONTHS})[a-z]*,?\\s+(20\\d\\d)\\b`, 'gi'))) push(new Date(`${m[2]} ${m[1]} ${m[3]}`));
  for (const m of text.matchAll(new RegExp(`\\b(${MONTHS})[a-z]*\\.?\\s+(\\d{1,2}),?\\s+(20\\d\\d)\\b`, 'gi'))) push(new Date(`${m[1]} ${m[2]} ${m[3]}`));
  for (const m of text.matchAll(/\b(20\d\d)-(\d\d)-(\d\d)\b/g)) push(new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00Z`));
  for (const m of text.matchAll(/\b(\d{1,2})\/(\d{1,2})\/(20\d\d)\b/g)) push(new Date(Date.UTC(+m[3], +m[2] - 1, +m[1])));
  return out;
}
function editDistance(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1), i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1] ? d[i - 2][j - 2] + 1 : 99);
  return d[a.length][b.length];
}
/** Registration numbers, cleaned: 12-digit new format and 5-7 digit + letter old format only. */
function cleanRegs(list: string[]): string[] {
  const out = new Set<string>();
  for (const x of list) {
    for (const m of String(x).matchAll(/\b(\d{12})\b/g)) out.add(m[1]);
    for (const m of String(x).toUpperCase().matchAll(/(?:^|[^\d])(\d{5,7})\s*-?\s*([A-Z])(?![A-Z0-9])/g)) out.add(m[1].replace(/^0+/, '') + m[2]);
  }
  return [...out];
}
function regsIn(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(/\b((?:19|20)\d\d0[1-6]\d{6})\b/g)) out.add(m[1]);
  for (const m of text.matchAll(/\(\s*(\d{5,7})\s*-?\s*([A-Z])\s*\)|\b(\d{5,7})-([A-Z])\b/g)) out.add(((m[1] ?? m[3]) as string).replace(/^0+/, '') + (m[2] ?? m[4]));
  return [...out];
}
const PLACES = new Set('klang kluang kajang johor bahru selangor seremban sembilan negeri kuala lumpur melaka penang perak kedah kelantan pahang sabah sarawak puchong cheras ampang subang petaling shah alam nilai bangi semenyih rawang putrajaya cyberjaya'.split(' '));

// ---------------------------------------------------------------------------------------------
// The lane
// ---------------------------------------------------------------------------------------------
export async function run(ctx: Ctx, dive: any): Promise<{ findings: Finding[]; notes: Record<string, unknown> }> {
  const r = dive.result ?? {};
  const id = r.identity ?? {};
  const todayMs = Date.now();
  const today = ctx.now().slice(0, 10);
  const year = new Date().getFullYear();
  const findings: Finding[] = [];
  const add = (check: string, f: Omit<Finding, 'checked_at'>) => findings.push({ ...f, check, checked_at: ctx.now() } as Finding);
  ctx.meter.other.tls = 0;
  ctx.meter.other.dns = 0;
  ctx.meter.other.retest = 0;

  const STOP = new Set(['sdn', 'bhd', 'berhad', 'enterprise', 'trading', 'group', 'holdings', 'malaysia', 'the', 'and', 'company', 'services', 'technologies', 'technology', 'solutions', 'construction', 'renovation', 'home', 'green', 'tech']);
  const companyTokens = [...new Set([id.legal_name, dive.company, ...(id.aliases ?? [])].filter(Boolean).join(' ').toLowerCase().replace(/\(.*?\)/g, ' ').split(/[^a-z0-9]+/).filter((t) => t.length >= 3 && !STOP.has(t)))];

  const { sites: allSites, redirects } = await crawl(ctx, dive, companyTokens);
  // Defaced sites: one alert each, then they are left out of everything else.
  for (const s of allSites.filter((x) => x.defaced)) {
    add('defacement', {
      title: `${s.domain} is not showing your website: it serves someone else's content (possible hijack)`,
      detail: `The homepage of ${s.domain}, listed as one of your official domains, now shows: ${s.defaced!.signals.join('; ')}. Customers and Google who reach this domain see this instead of ${dive.company}. Check the domain registration, DNS and hosting, or stop listing the domain.`,
      severity: 'high', source: s.home, evidence: s.defaced!.title,
    });
  }
  const sites = allSites.filter((s) => !s.defaced);
  const crawled = sites.flatMap((s) => s.pages);
  const ok = crawled.filter((p) => p.status === 200);
  const allHosts = new Set(sites.flatMap((s) => [s.host, s.domain, ...s.aliases]));
  const isInternal = (u: string) => allHosts.has(bareHost(u));
  const pageByUrl = new Map(crawled.flatMap((p) => [[normUrl(p.finalUrl), p], [normUrl(p.url), p]] as [string, CPage][]));

  for (const rd of redirects) add('redirect-domain', { title: `${rd.domain} redirects to ${bareHost(rd.to)}`, detail: `Typing ${rd.domain} lands on ${rd.to}. Fine if intended.`, severity: 'info', source: `https://${rd.domain}/`, evidence: rd.to });

  // 1. SSL and http -> https.
  const tlsHosts = [...new Set(sites.flatMap((s) => [new URL(s.home).hostname, s.domain, ...s.aliases]))];
  const certs = await pool(tlsHosts, 3, async (h) => { ctx.meter.other.tls++; return sslCert(h); });
  for (const c of certs) {
    if (!c.ok) add('ssl', { title: `SSL problem on ${c.host}`, detail: `The certificate is not trusted: ${c.error}.`, severity: 'high', source: `https://${c.host}/`, evidence: c.error });
    else if ((c.daysLeft ?? 99) < 21) add('ssl', { title: `SSL certificate on ${c.host} expires in ${c.daysLeft} days`, detail: `Valid to ${c.validTo} (${c.issuer}).`, severity: (c.daysLeft ?? 0) < 7 ? 'high' : 'low', source: `https://${c.host}/`, evidence: c.validTo });
  }
  const httpChecks = await pool([...new Set(sites.flatMap((s) => [s.domain, ...s.aliases]))], 3, async (d) => ({ d, r: await ctx.page(`http://${d}/`, { redirect: 'manual' }) }));
  for (const { d, r: h } of httpChecks) {
    const loc = h.headers['location'] ?? '';
    if (h.status === 0) add('https-redirect', { title: `http://${d}/ does not answer`, detail: h.error ?? '', severity: 'medium', source: `http://${d}/` });
    else if (!(h.status >= 300 && h.status < 400 && /^https:/i.test(new URL(loc || '/', `http://${d}/`).href))) add('https-redirect', { title: `http://${d}/ does not redirect to https`, detail: `HTTP ${h.status}${loc ? ' -> ' + loc : ''}. Visitors on the plain-http address get a page marked "Not secure".`, severity: 'medium', source: `http://${d}/` });
  }

  // 2. Per page, aggregated per site.
  const titles = new Map<string, string[]>();
  type Agg = { pages: number; noTitle: string[]; longTitle: string[]; shortTitle: string[]; noDesc: string[]; longDesc: string[]; shortDesc: string[]; noViewport: string[]; zoomOff: string[]; slowFirst: CPage[]; mixed: string[]; junkAlt: number; imgs: number };
  const agg = new Map<string, Agg>();
  for (const p of crawled) {
    const u = p.finalUrl;
    const path_ = (() => { try { return new URL(u).pathname; } catch { return u; } })();
    if (p.status !== 200) { add('page-status', { title: `Page ${path_} returns HTTP ${p.status || 'no answer'}`, detail: p.error ?? `Linked from the homepage of ${p.site} but answers ${p.status}.${p.status === 403 ? ' A 403 can mean the server blocks bots; check in a browser.' : ''}`, severity: p.status === 404 || p.status >= 500 || p.status === 0 ? 'high' : 'medium', source: p.url }); continue; }
    const x: Agg = agg.get(p.site) ?? { pages: 0, noTitle: [], longTitle: [], shortTitle: [], noDesc: [], longDesc: [], shortDesc: [], noViewport: [], zoomOff: [], slowFirst: [], mixed: [], junkAlt: 0, imgs: 0 };
    agg.set(p.site, x);
    x.pages++;
    const title = decode(p.html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '');
    const desc = decode(metaContent(p.html, 'description') ?? '');
    const viewport = metaContent(p.html, 'viewport');
    if (!title) x.noTitle.push(path_);
    else {
      titles.set(title, [...new Set([...(titles.get(title) ?? []), normUrl(u)])]);
      if (title.length > 70) x.longTitle.push(`${path_} (${title.length})`);
      if (title.length < 15) x.shortTitle.push(`${path_} (${title.length})`);
    }
    if (!desc) x.noDesc.push(path_); else if (desc.length > 170) x.longDesc.push(`${path_} (${desc.length})`); else if (desc.length < 50) x.shortDesc.push(`${path_} (${desc.length})`);
    if (!viewport) x.noViewport.push(path_); else if (/user-scalable\s*=\s*(no|0)|maximum-scale\s*=\s*1(\.0)?\b/i.test(viewport)) x.zoomOff.push(path_);
    if (p.ms > 3000) x.slowFirst.push(p);
    if (u.startsWith('https:') && /<(?:img|script|iframe|source|link)\b[^>]*\b(?:src|href)\s*=\s*["']http:\/\//i.test(p.html)) x.mixed.push(path_);
    for (const m of p.html.matchAll(/<img\b[^>]*>/gi)) { x.imgs++; const alt = attr(m[0], 'alt'); if (alt && alt.length >= 16 && !/\s/.test(alt) && /[0-9+\/=]/.test(alt) && /[A-Z]/.test(alt) && /[a-z]/.test(alt)) x.junkAlt++; }
    // Placeholder page: the page's own content is little more than "coming soon" / "under construction".
    const own = (p.isHome ? p.text : p.unique).replace(/\[image\]/g, '').trim();
    const ph = own.match(/\b(coming soon|under construction|lorem ipsum|dolor sit amet|sample page|page not found)\b/i);
    if (ph && own.length < 400) add('placeholder', { title: `Placeholder page: ${path_} shows only "${ph[1]}"`, detail: `The page's own content is ${own.length} characters, mostly "${ph[0]}". Visitors who click through find nothing.`, severity: 'medium', source: u, evidence: ph[0] });
  }
  // Slow pages: fetch once more; slow only if slow twice.
  for (const [site, x] of agg) {
    const slow: string[] = [];
    for (const p of x.slowFirst) { ctx.meter.other.retest++; const again = await ctx.page(p.finalUrl); if (again.ms > 3000) slow.push(`${new URL(p.finalUrl).pathname} (${(p.ms / 1000).toFixed(1)} s, then ${(again.ms / 1000).toFixed(1)} s)`); }
    const ex = (a: string[]) => a.slice(0, 4).join(', ') + (a.length > 4 ? ` and ${a.length - 4} more` : '');
    if (slow.length) add('slow', { title: `${slow.length} slow page(s) on ${site}: over 3 s for the HTML alone, twice`, detail: ex(slow), severity: 'medium', source: null });
    if (x.noViewport.length) add('viewport', { title: `${x.noViewport.length} of ${x.pages} pages on ${site} have no mobile viewport`, detail: `Phones show the desktop layout zoomed out: ${ex(x.noViewport)}.`, severity: 'high', source: null });
    if (x.zoomOff.length) add('viewport', { title: `Pinch-zoom is disabled on ${x.zoomOff.length} of ${x.pages} pages on ${site}`, detail: `The viewport tag has user-scalable=no or maximum-scale=1: ${ex(x.zoomOff)}.`, severity: 'low', source: null });
    if (x.mixed.length) add('mixed-content', { title: `${x.mixed.length} pages on ${site} load http:// resources inside https`, detail: ex(x.mixed), severity: 'medium', source: null });
    if (x.noTitle.length) add('title', { title: `${x.noTitle.length} of ${x.pages} pages on ${site} have no <title>`, detail: ex(x.noTitle), severity: 'medium', source: null });
    if (x.longTitle.length) add('title', { title: `${x.longTitle.length} of ${x.pages} pages on ${site} have titles over 70 characters`, detail: `Google cuts titles at about 60-70 characters: ${ex(x.longTitle)}.`, severity: 'low', source: null });
    if (x.shortTitle.length) add('title', { title: `${x.shortTitle.length} of ${x.pages} pages on ${site} have titles under 15 characters`, detail: ex(x.shortTitle), severity: 'low', source: null });
    if (x.noDesc.length) add('meta-description', { title: `${x.noDesc.length} of ${x.pages} pages on ${site} have no meta description`, detail: `Google picks its own snippet: ${ex(x.noDesc)}.`, severity: 'low', source: null });
    if (x.longDesc.length) add('meta-description', { title: `${x.longDesc.length} of ${x.pages} pages on ${site} have meta descriptions over 170 characters`, detail: ex(x.longDesc), severity: 'low', source: null });
    if (x.shortDesc.length) add('meta-description', { title: `${x.shortDesc.length} of ${x.pages} pages on ${site} have meta descriptions under 50 characters`, detail: ex(x.shortDesc), severity: 'low', source: null });
    if (x.junkAlt >= 3) add('alt-text', { title: `${x.junkAlt} images on ${site} have meaningless alt text`, detail: `Their alt text is a code fragment (like "kNNaC+DPdf540AAAAASUVORK5CYII="), which screen readers read aloud and Google indexes. ${x.imgs} images checked.`, severity: 'low', source: null });
  }
  for (const [t, urls] of titles) if (urls.length > 1) add('title', { title: `${urls.length} pages share the same title`, detail: `"${t.slice(0, 100)}" on ${urls.map((x) => new URL(x).pathname).join(', ')}.`, severity: 'low', source: urls[0], evidence: t });

  // 3. Footer facts: (c) year, SSM number, emails.
  const regs = cleanRegs(id.registration_numbers ?? []);
  const emailsBySite: Record<string, string[]> = {};
  for (const s of sites) {
    const home = s.pages[0];
    if (!home || home.status !== 200) continue;
    const okp = s.pages.filter((p) => p.status === 200);
    const allText = okp.map((p) => p.text).join('\n');
    const copy = [...home.text.matchAll(/(?:©|\(c\)|copyright)\s*((?:19|20)\d\d)(?:\s*[-–]\s*((?:19|20)\d\d))?|((?:19|20)\d\d)\s*[-–]\s*((?:19|20)\d\d)\s*(?:©)?\s*(?=[^\n]{0,30}(?:sdn|bhd|berhad|all rights|reserved))|((?:19|20)\d\d)\s*©/gi)];
    if (copy.length) {
      const latest = Math.max(...copy.map((m) => Number(m[2] ?? m[1] ?? m[4] ?? m[3] ?? m[5])).filter(Boolean));
      if (latest < year) add('copyright', { title: `Stale copyright year on ${s.host}: ${latest}`, detail: `The footer says "${copy[0][0].trim()}"; it is ${year}. Visitors read an old year as an abandoned site.`, severity: latest < year - 1 ? 'medium' : 'low', source: home.finalUrl, evidence: copy[0][0].trim() });
    }
    const onSite = regsIn(allText);
    const onHome = regsIn(home.text);
    if (regs.length) {
      const match = onHome.filter((x) => regs.includes(x));
      const other = onSite.filter((x) => !regs.includes(x));
      if (!match.length && other.length) add('ssm', { title: `${s.host} shows registration number ${other.join(', ')}, but the registry has ${(id.registration_numbers ?? []).join(', ')}`, detail: `The number on the site does not match the company's SSM record from the dive. Either the site is out of date or it names a different company.`, severity: 'high', source: okp.find((p) => regsIn(p.text).some((x) => other.includes(x)))?.finalUrl ?? home.finalUrl, evidence: other.join(', ') });
      else if (!match.length) add('ssm', { title: `SSM registration number not on the ${s.host} homepage`, detail: `Expected ${(id.registration_numbers ?? []).join(', ')}. The Companies Act 2016 (s.70) asks for it on the website, and it builds trust.${onSite.length ? ' It appears elsewhere on the site.' : ' It appears on no crawled page.'}`, severity: 'medium', source: home.finalUrl });
    } else if (!onSite.length) add('ssm', { title: `No SSM registration number anywhere on ${s.host}`, detail: 'No company number on any crawled page (and none known from the dive).', severity: 'medium', source: home.finalUrl });
    const emails = [...new Set(okp.flatMap((p) => [...p.html.matchAll(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)].map((m) => m[0].toLowerCase())))].filter((e) => !/\.(png|jpe?g|webp|svg|gif)$/i.test(e) && !/@(sentry|example|domain|email|wixpress)\./.test(e));
    emailsBySite[s.host] = emails;
    for (const e of emails) if (/^(gmail|googlemail|hotmail|outlook|live|yahoo|ymail|icloud|aol|msn)\.(com|my|co\.uk|com\.my)$/.test(e.split('@')[1])) add('free-mail', { title: `Free-mail contact address on ${s.host}: ${e}`, detail: 'A Gmail or Hotmail address looks less established than one on your own domain.', severity: 'medium', source: okp.find((p) => p.html.toLowerCase().includes(e))?.finalUrl ?? home.finalUrl, evidence: e });
  }

  // 4. Phones: site vs dive vs Google Maps; street unit vs dive.
  const sitePhones = new Map<string, Set<string>>();
  const notePhone = (raw: string, url: string, how: string) => { const n = normPhone(raw); if (n) { if (!sitePhones.has(n)) sitePhones.set(n, new Set()); sitePhones.get(n)!.add(`${url} (${how})`); } };
  for (const p of ok) {
    for (const h of hrefsOf(p.html, p.finalUrl)) {
      if (/^tel:/i.test(h)) notePhone(h.slice(4), p.finalUrl, 'tel link');
      const wa = h.match(/(?:wa\.me\/|api\.whatsapp\.com\/send\/?\?phone=)(\d+)/i);
      if (wa) notePhone(wa[1], p.finalUrl, 'WhatsApp link');
    }
    for (const m of p.html.matchAll(/"telephone"\s*:\s*"([^"]+)"/g)) {
      if (/\*/.test(m[1])) add('phone-masked', { title: `A masked phone number "${m[1]}" is published on ${new URL(p.finalUrl).pathname}`, detail: 'It sits in the structured data (JSON-LD) that Google and AI assistants read as your phone; nobody can call it.', severity: 'high', source: p.finalUrl, evidence: m[0] });
      else notePhone(m[1], p.finalUrl, 'structured data');
    }
    for (const n of phonesIn(p.text)) notePhone(n, p.finalUrl, 'page text');
  }
  const divePhones = new Set(phonesIn(JSON.stringify(r.facts ?? []) + ' ' + JSON.stringify(r.people ?? [])));
  let mapsListings: any[] | null = null;
  try { mapsListings = JSON.parse(fs.readFileSync(path.join(OUT, `H-maps-${ctx.diveId}.json`), 'utf8')).notes?.listings ?? []; } catch { ctx.warn(`no H-maps-${ctx.diveId}.json; Maps phones NOT checked`); }
  const mapsPhones = new Set((mapsListings ?? []).map((l) => normPhone(String(l.phone ?? ''))).filter(Boolean));
  if (sitePhones.size) for (const l of mapsListings ?? []) {
    const n = normPhone(String(l.phone ?? ''));
    if (n && !sitePhones.has(n)) add('phone-maps', { title: `Google Maps listing "${l.name}" gives ${fmtPhone(n)}, which is not on your website`, detail: `A customer who finds you on Maps calls a number your site never shows. Site numbers: ${[...sitePhones.keys()].map(fmtPhone).join(', ')}.`, severity: 'medium', source: l.place_link ?? null, evidence: String(l.phone) });
  }
  for (const [n, where] of sitePhones) {
    if (!divePhones.has(n) && !mapsPhones.has(n)) add('phone-unknown', { title: `Site phone ${fmtPhone(n)} is not in the dive${mapsListings ? ' or on Google Maps' : ' (Maps not checked)'}`, detail: `Found at ${[...where].slice(0, 3).join('; ')}. Check it is still answered.`, severity: 'low', source: [...where][0].split(' (')[0], evidence: n });
  }
  const perSite = sites.map((s) => ({ host: s.host, phones: [...sitePhones].filter(([, w]) => [...w].some((x) => bareHost(x.split(' ')[0]) === s.host)).map(([n]) => n) }));
  if (perSite.length > 1 && perSite.every((x) => x.phones.length) && !perSite.slice(1).some((x) => x.phones.some((n) => perSite[0].phones.includes(n)))) add('phone-sites', { title: 'Your websites give different phone numbers', detail: perSite.map((x) => `${x.host}: ${x.phones.map(fmtPhone).join(', ')}`).join(' | ') + '. No number appears on both.', severity: 'medium', source: null });
  const addr = String(id.address ?? '');
  const street = addr.match(/(?:^|,\s*)(?:[\w-]+,?\s+)?((?:jalan|jln|lorong|persiaran|lebuh)\s+[^,]+)/i)?.[1]?.trim();
  const unit = addr.match(/^\s*(?:no\.?\s*)?([\dA-Z]+-[\dA-Z-]+|\d+[A-Z]?)\b/i)?.[1];
  if (street && unit) {
    const esc = street.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
    const seen = new Map<string, string>();
    for (const p of ok) for (const m of (p.text + '\n' + p.html).matchAll(new RegExp(`(?:no\\.?\\s*)?([\\dA-Z]+-[\\dA-Z-]+|\\d+[A-Z]?)\\s*,?\\s*${esc}`, 'gi'))) if (!seen.has(m[1].toUpperCase())) seen.set(m[1].toUpperCase(), p.finalUrl);
    for (const [u, url] of seen) if (u !== unit.toUpperCase()) add('address', { title: `Address unit "${u}, ${street}" differs from the registered "${unit}"`, detail: `The dive's address is "${addr}". The site shows unit ${u} on the same street.`, severity: 'high', source: url, evidence: `${u}, ${street}` });
  }

  // 5. Links: internal status (15 most-linked), wa.me, tel:, mailto:, third-party credit links.
  const linkFrom = new Map<string, Set<string>>();
  const anchors: { href: string; text: string; page: string }[] = [];
  for (const p of ok) {
    for (const h of hrefsOf(p.html, p.finalUrl)) { if (!linkFrom.has(h)) linkFrom.set(h, new Set()); linkFrom.get(h)!.add(p.finalUrl); }
    for (const m of p.html.matchAll(/<a\b([^>]*)>([\s\S]{0,300}?)<\/a>/gi)) anchors.push({ href: attr(m[1], 'href') ?? '', text: cleanText(m[2]), page: p.finalUrl });
  }
  const internal = [...linkFrom.keys()].filter((u) => /^https?:/i.test(u) && isInternal(u) && !ASSET.test(u) && !/\/cdn-cgi\//.test(u)).map(normUrl);
  const uncrawled = [...new Set(internal)].filter((u) => !pageByUrl.has(u)).sort((a, b) => (linkFrom.get(b)?.size ?? 0) - (linkFrom.get(a)?.size ?? 0));
  if (uncrawled.length > LINK_CAP) ctx.log(`${uncrawled.length} internal links not crawled; checking the ${LINK_CAP} linked most often`);
  const checkedLinks = await pool(uncrawled.slice(0, LINK_CAP), 3, async (u) => ({ u, r: await ctx.page(u) }));
  const linkStatus: any[] = [];
  for (const { u, r: h } of checkedLinks) {
    linkStatus.push({ url: u, status: h.status, final: h.finalUrl });
    const from = [...(linkFrom.get(u) ?? linkFrom.get(u + '/') ?? [])];
    if (h.status === 0 || h.status >= 400) add('broken-link', { title: `Broken internal link: ${new URL(u).pathname} (HTTP ${h.status || 'no answer'})`, detail: `Linked from ${from.slice(0, 3).map((x) => new URL(x).pathname).join(', ') || 'a crawled page'}.${h.status === 403 ? ' A 403 can mean the server blocks bots; check in a browser.' : ''}`, severity: h.status === 403 ? 'low' : 'medium', source: u, evidence: String(h.status) });
  }
  const credit = anchors.filter((a) => /embed-?google-?maps?|embedgooglemap|wowslider|w3layouts|themewagon|colorlib|free (?:html|website) template|maps-generator|mapembed/i.test(a.href + ' ' + a.text));
  if (credit.length) {
    const uniq = [...new Map(credit.map((a) => [a.text + a.href, a])).values()];
    add('credit-link', { title: `Third-party credit or backlink text visible on ${new Set(uniq.map((a) => bareHost(a.page))).size > 1 ? 'your sites' : bareHost(uniq[0].page)}: "${uniq[0].text || uniq[0].href}"`, detail: `${uniq.slice(0, 4).map((a) => `"${a.text}" -> ${a.href} (on ${new URL(a.page).pathname})`).join('; ')}. Free widgets add these links; they look unprofessional and give your page's ranking to the widget maker.`, severity: 'low', source: uniq[0].page, evidence: uniq[0].text || uniq[0].href });
  }
  const companyWords: string[] = [id.legal_name, dive.company, ...(id.aliases ?? [])].filter(Boolean).map((x: string) => x.toLowerCase().replace(/sdn\.?\s*bhd\.?|berhad|\(.*?\)/g, '').trim()).filter((x: string) => x.length >= 4);
  const waNums = [...new Set([...linkFrom.keys()].map((h) => h.match(/(?:wa\.me\/|api\.whatsapp\.com\/send\/?\?phone=)(\d+)/i)?.[1]).filter(Boolean) as string[])];
  const waStatus: any[] = [];
  for (const n of waNums) {
    const h = await ctx.page(`https://wa.me/${n}`);
    const biz = decode(h.html.match(/<h3 class="_9vd5 _9scb _9scr">([^<]*)<\/h3>/)?.[1] ?? '');
    const from = [...linkFrom.keys()].filter((k) => k.includes(n)).flatMap((k) => [...linkFrom.get(k)!]);
    waStatus.push({ number: n, status: h.status, business: biz || null, valid: !!normPhone(n) });
    const tokens = companyTokens.filter((t) => t.length >= 4);
    if (h.status !== 200) add('whatsapp', { title: `WhatsApp link wa.me/${n} answers HTTP ${h.status}`, detail: h.error ?? '', severity: 'medium', source: from[0] ?? null });
    else if (!normPhone(n)) add('whatsapp', { title: `WhatsApp link wa.me/${n} is not a valid Malaysian number`, detail: 'The link opens WhatsApp with a number that cannot exist.', severity: 'high', source: from[0] ?? null, evidence: n });
    else if (biz && !companyWords.some((w) => biz.toLowerCase().includes(w)) && !tokens.some((t) => biz.toLowerCase().includes(t))) add('whatsapp', { title: `WhatsApp ${fmtPhone(n)} opens a chat named "${biz}", not the company`, detail: `The WhatsApp Business name a customer sees is "${biz}", where they expect ${dive.company}.`, severity: 'medium', source: from[0] ?? null, evidence: biz });
    else if (!biz) add('whatsapp', { title: `WhatsApp link wa.me/${n} shows no business name`, detail: 'wa.me shows a WhatsApp Business name for business accounts; none here. It may be a personal account or not on WhatsApp. Check by hand.', severity: 'low', source: from[0] ?? null, evidence: n });
  }
  for (const t of [...new Set([...linkFrom.keys()].filter((h) => /^tel:/i.test(h)))]) {
    if (!normPhone(decodeURIComponent(t.slice(4)))) add('tel', { title: `Click-to-call link "${t}" is not a valid Malaysian number`, detail: 'Tapping it on a phone dials a wrong or impossible number.', severity: 'high', source: [...linkFrom.get(t)!][0], evidence: t });
  }
  const mailStatus: any[] = [];
  for (const m of [...new Set([...linkFrom.keys()].filter((h) => /^mailto:/i.test(h)).map((h) => decodeURIComponent(h.slice(7)).split('?')[0].toLowerCase()))]) {
    const dom = m.split('@')[1] ?? '';
    ctx.meter.other.dns++;
    let mx: any[] = [];
    try { mx = await dns.resolveMx(dom); } catch (e) { ctx.warn(`MX lookup for ${dom} failed: ${(e as Error).message}`); }
    mailStatus.push({ email: m, mx: mx.map((x) => x.exchange) });
    if (!mx.length) add('mailto', { title: `Email link ${m} has no mail server (no MX record)`, detail: 'Emails sent to this address bounce.', severity: 'high', source: null, evidence: m });
  }

  // 6. Forms (found, never submitted).
  const forms: any[] = [];
  for (const p of ok) for (const m of p.html.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/gi)) {
    const inputs = [...m[2].matchAll(/<(?:input|textarea|select)\b[^>]*>/gi)].map((x) => attr(x[0], 'name') ?? attr(x[0], 'type') ?? '?');
    const action = attr(m[1], 'action');
    forms.push({ page: p.finalUrl, action, method: (attr(m[1], 'method') ?? 'get').toLowerCase(), inputs, kind: inputs.some((x) => /search|^q$|^s$/i.test(x)) || /search/i.test(m[1]) ? 'search' : 'other' });
    if (action && /^http:\/\//i.test(action)) add('form', { title: `Form on ${new URL(p.finalUrl).pathname} posts to an insecure http:// address`, detail: `action="${action}"`, severity: 'high', source: p.finalUrl, evidence: action });
  }
  for (const s of sites) {
    if (!forms.some((f) => bareHost(f.page) === s.host && f.kind !== 'search')) {
      const contact = s.pages.find((p) => p.status === 200 && /contact|hubungi/i.test(p.finalUrl));
      add('form', { title: `No enquiry form found on ${s.host}`, detail: `${contact ? 'The contact page has' : 'The crawled pages have'} no HTML form other than search, so customers must call, WhatsApp or email. A form built by JavaScript would not show here.`, severity: 'info', source: contact?.finalUrl ?? s.home });
    }
  }

  // 7. News freshness and feed hygiene.
  for (const s of sites) {
    const news = s.pages.filter((p) => p.status === 200 && LISTING.test(new URL(p.finalUrl).pathname + '/'));
    if (!news.length) continue;
    const dates = news.flatMap((p) => datesIn(p.text, todayMs).map((d) => ({ d, url: p.finalUrl })));
    if (dates.length) {
      const newest = dates.reduce((a, b) => (b.d > a.d ? b : a));
      const days = Math.round((todayMs - newest.d.getTime()) / 86400000);
      if (days > 90) add('stale-news', { title: `Newest news item on ${s.host} is ${Math.round(days / 30)} months old (${newest.d.toISOString().slice(0, 10)})`, detail: `On ${new URL(newest.url).pathname}. A stale news page makes the company look inactive.`, severity: days > 365 ? 'medium' : 'low', source: newest.url, evidence: newest.d.toISOString().slice(0, 10) });
    }
    for (const p of news) {
      const heads = [...p.html.matchAll(/<h[2-4]\b[^>]*>([\s\S]*?)<\/h[2-4]>/gi)].map((m) => cleanText(m[1])).filter((t) => t.length > 15);
      const cnt = new Map<string, number>();
      for (const t of heads) cnt.set(t, (cnt.get(t) ?? 0) + 1);
      const dup = [...cnt].filter(([, n]) => n > 1);
      if (dup.length) add('feed-duplicates', { title: `${dup.length} headline(s) listed more than once on ${new URL(p.finalUrl).pathname}`, detail: dup.slice(0, 4).map(([t, n]) => `"${t.slice(0, 80)}" x${n}`).join('; '), severity: 'low', source: p.finalUrl, evidence: dup[0][0] });
    }
  }
  const LEAK = /(as an ai(?: language model)?|i (?:cannot|can't) (?:access|browse|view)|(?:was|were) not (?:included|provided) in the (?:submission|input|prompt)|the article body was not|here is (?:a|the) (?:summary|rewritten)|\[insert [^\]]{2,40}\]|lorem ipsum)/i;
  for (const p of ok) {
    const m = p.text.match(LEAK);
    if (m) {
      const line = p.text.split('\n').find((l) => LEAK.test(l)) ?? m[0];
      add('leaked-note', { title: `Leaked AI or editor note on ${new URL(p.finalUrl).pathname}: "${m[0]}"`, detail: `Visible text: "${line.slice(0, 220)}". It reads as if no human checked the page.`, severity: 'high', source: p.finalUrl, evidence: line.slice(0, 220) });
    }
  }
  // Brand variants: a rare capitalised word one edit away from a common one on the same site.
  // Off by default after round 3: 1 real hit ("Charges" vs "Charger") in 5 runs, the rest were real
  // English pairs (Offices/Officer, Protection/Protector) or Malay (Sistem). Set C_NAME_VARIANT=1 to try it.
  for (const s of process.env.C_NAME_VARIANT === '1' ? sites : []) {
    const counts = new Map<string, number>();
    for (const p of s.pages.filter((x) => x.status === 200)) for (const w of (p.isHome ? p.text : p.unique).match(/\b[A-Z][a-z]{4,}\b/g) ?? []) counts.set(w, (counts.get(w) ?? 0) + 1);
    const words = [...counts.keys()];
    const out: string[] = [];
    for (const rare of words) {
      const rc = counts.get(rare)!;
      if (rc > 2 || PLACES.has(rare.toLowerCase())) continue;
      for (const common of words) {
        const cc = counts.get(common)!;
        if (common === rare || cc < 3 || cc < rc * 3 || PLACES.has(common.toLowerCase()) || rare[0] !== common[0]) continue;
        const a = rare.toLowerCase(), b = common.toLowerCase();
        if (a.startsWith(b) || b.startsWith(a) || a.replace(/s$/, '') === b.replace(/s$/, '')) continue;
        const dist = editDistance(a, b);
        if (dist === 1 || (dist === 2 && Math.min(a.length, b.length) >= 8)) out.push(`"${rare}" (${rc}x) vs "${common}" (${cc}x)`);
      }
    }
    if (out.length) add('name-variant', { title: `Possible misspelt name(s) on ${s.host}: ${out.slice(0, 3).join(', ')}`, detail: `A name written one way most of the time and differently once or twice is usually a typo. ${out.slice(0, 6).join('; ')}.`, severity: 'low', source: null, evidence: out.join('; ') });
  }

  // 8. LLM on the company's own prose.
  const facts = [
    `Legal name: ${id.legal_name}; registration numbers: ${(id.registration_numbers ?? []).join(', ') || 'unknown'}`,
    `Registered address in public records (may be a company-secretary office, so a different business address on the site is NOT an inconsistency): ${id.address}`,
    `Founded: ${(r.facts ?? []).find((f: any) => /incorporated|established|founded/i.test(f.fact))?.fact ?? 'unknown'}`,
    `Phones seen elsewhere: ${[...divePhones, ...mapsPhones].map(fmtPhone).join(', ') || 'none'}`,
  ].join('\n');
  const system = "You are a meticulous copy editor auditing a Malaysian company's website for its owner. You report only real, specific problems a customer would notice, and you quote the page exactly.";
  const prompt = (url: string, text: string) =>
    `Company: ${dive.company}. Today is ${today}.\nKnown facts:\n${facts}\n\n` +
    `Below is the visible text of ONE page of the company's website: ${url}\n` +
    `Notes on the text: menus, buttons and footers are flattened into lines. "[image]" marks an image; numbers or formulas shown as images are NOT missing, so never report a value missing next to [image]. Counter numbers are the values the page animates to.\n\n` +
    `Report at most 5 issues, the ones a customer would notice most:\n- "spelling": misspelled words, including misspelled brand or product names.\n- "grammar": clear grammatical errors.\n- "wording": unclear or unprofessional wording (not style preferences).\n- "outdated": stale content as of today (old years, expired offers, past events written as upcoming). Not for dated news or blog posts.\n- "inconsistency": statements that contradict each other on this page or contradict the known facts.\n` +
    `Do NOT report: Malay or Chinese text, brand and model names spelled as the maker spells them, units, British vs American spelling, the capitalisation of ALL-CAPS headings (but DO report wrong words in headings and buttons, like "DISCOVERY MORE"), menu labels, customer reviews or other third-party text, or a business address that differs from the registered address.\n` +
    `"quote" must be copied character-for-character from the page text (3 to 25 words) so a text search finds it.\n` +
    `Also list "claims": up to 10 short factual claims with a number or date (projects, capacity, staff, offices, years in business, warranty, phone, address), each copied exactly from the page.\n` +
    `Return JSON only: {"issues":[{"type":"spelling|grammar|wording|outdated|inconsistency","quote":"...","fix":"...","why":"one short sentence","severity":"high|medium|low"}],"claims":["..."]}\n\nPAGE TEXT:\n${text}`;

  const jobs: { page: CPage; text: string; hay: string }[] = [];
  const skipped: string[] = [];
  for (const p of ok) {
    const pathq = new URL(p.finalUrl).pathname + '/';
    if (LISTING.test(pathq)) { skipped.push(`${p.finalUrl} (listing page)`); continue; }
    if (!p.isHome && datesIn(p.text, todayMs).length >= 8) { skipped.push(`${p.finalUrl} (many dated items: a feed)`); continue; }
    let text = (p.isHome ? p.text : p.unique).trim();
    const pre = p.isHome ? waPrefills(p.html) : [];
    if (pre.length) text += `\n\n[WhatsApp pre-filled message]\n${pre.join('\n')}`;
    if (text.replace(/\[image\]/g, '').trim().length < 150) { skipped.push(`${p.finalUrl} (${text.length} chars)`); continue; }
    if (text.length > PAGE_CHARS) text = splitText(text, PAGE_CHARS)[0];
    jobs.push({ page: p, text, hay: p.text + '\n' + pre.join('\n') });
  }
  if (jobs.length > MAX_LLM - 1) { ctx.warn(`${jobs.length} prose pages; reading the first ${MAX_LLM - 1}`); jobs.length = MAX_LLM - 1; }
  ctx.log(`LLM reads ${jobs.length} prose pages; skipped ${skipped.length}`);
  const claims: { url: string; claims: string[] }[] = [];
  const dropped: any[] = [];
  const llmFindings: Finding[] = [];
  await pool(jobs, 3, async (j) => {
    const parsed = ctx.parseJson<any>(await ctx.llm(prompt(j.page.finalUrl, j.text), { system }));
    if (!parsed) { ctx.warn(`no JSON for ${j.page.finalUrl}`); return; }
    const okClaims = (Array.isArray(parsed.claims) ? parsed.claims : []).map(String).filter((c: string) => quoteOnPage(c, j.hay)).slice(0, 10);
    if (okClaims.length) claims.push({ url: j.page.finalUrl, claims: okClaims });
    for (const it of (Array.isArray(parsed.issues) ? parsed.issues : []).slice(0, 5)) {
      const quote = String(it.quote ?? '').trim();
      const sev = ['high', 'medium', 'low'].includes(it.severity) ? it.severity : 'low';
      const f = { title: `${it.type ?? 'issue'}: "${quote.slice(0, 90)}"`, detail: `${it.why ?? ''}${it.fix ? ` Suggested: "${it.fix}".` : ''}`.trim(), severity: sev, source: j.page.finalUrl, checked_at: ctx.now(), evidence: quote, check: 'llm', type: it.type, fix: it.fix ?? null } as Finding;
      if (!quoteOnPage(quote, j.hay)) { dropped.push({ ...f, reason: 'quote not on page' }); continue; }
      if (it.type === 'wording' && sev === 'low') { dropped.push({ ...f, reason: 'low-severity wording' }); continue; }
      llmFindings.push(f);
    }
  });
  if (claims.length > 1 && ctx.meter.llm.calls < MAX_LLM) {
    const list = claims.map((c, i) => `[P${i + 1}] ${c.url}\n${c.claims.map((x) => '  - ' + x).join('\n')}`).join('\n');
    const parsed = ctx.parseJson<any>(await ctx.llm(
      `Company: ${dive.company}. Today is ${today}. Known facts:\n${facts}\n\nThese claims were copied exactly from pages of the company's website(s). Find claims that CONTRADICT each other across pages or domains (different project counts, capacities, staff, offices, years in business, warranty terms, phone numbers, branch addresses, founding dates), or contradict the known facts. Only real conflicts, not the same thing worded differently, and not the registered address. Copy both claims exactly as listed. Return JSON only: {"issues":[{"page_a":"P1","quote_a":"...","page_b":"P2","quote_b":"...","why":"one sentence","severity":"high|medium|low"}]}\n\n${list}`,
      { system },
    ));
    if (!parsed) ctx.warn('no JSON from the cross-page call');
    for (const it of parsed?.issues ?? []) {
      const a = claims[Number(String(it.page_a).replace(/\D/g, '')) - 1], b = claims[Number(String(it.page_b).replace(/\D/g, '')) - 1];
      const pa = a && ok.find((p) => p.finalUrl === a.url), pb = b && ok.find((p) => p.finalUrl === b.url);
      const f = { title: `inconsistency across pages: "${String(it.quote_a).slice(0, 70)}" vs "${String(it.quote_b).slice(0, 70)}"`, detail: `${it.why ?? ''} (${a?.url} vs ${b?.url})`, severity: ['high', 'medium', 'low'].includes(it.severity) ? it.severity : 'medium', source: a?.url ?? null, checked_at: ctx.now(), evidence: `${it.quote_a} | ${it.quote_b}`, check: 'llm', type: 'inconsistency-cross', also: b?.url ?? null } as Finding;
      if (pa && pb && quoteOnPage(String(it.quote_a), pa.text) && quoteOnPage(String(it.quote_b), pb.text)) llmFindings.push(f); else dropped.push({ ...f, reason: 'cross quote not on page' });
    }
  }
  // Same quote on several pages -> one finding.
  const byQuote = new Map<string, Finding>();
  for (const f of llmFindings) {
    const k = `${f.type}|${normQ(String(f.evidence))}`;
    const prev = byQuote.get(k);
    if (!prev) byQuote.set(k, { ...f, also_on: [] as string[] });
    else if (f.source && f.source !== prev.source) (prev.also_on as string[]).push(f.source);
  }
  findings.push(...byQuote.values());

  const uniq = new Map<string, Finding>();
  for (const f of findings) {
    const k = f.check === 'llm' ? `${f.title}|${f.source}` : f.title;
    const prev = uniq.get(k);
    if (!prev) uniq.set(k, { ...f, also_on: (f.also_on as string[]) ?? [] });
    else if (f.source && f.source !== prev.source && !(prev.also_on as string[]).includes(f.source)) (prev.also_on as string[]).push(f.source);
  }
  return {
    findings: [...uniq.values()],
    notes: {
      redirects, certs, linkStatus, waStatus, mailStatus, forms,
      defaced: allSites.filter((s) => s.defaced).map((s) => ({ domain: s.domain, ...s.defaced })),
      sitePhones: Object.fromEntries([...sitePhones].map(([k, v]) => [fmtPhone(k), [...v]])),
      divePhones: [...divePhones].map(fmtPhone), mapsPhones: mapsListings ? [...mapsPhones].map(fmtPhone) : 'not checked',
      emails: emailsBySite, regsClean: regs,
      sites: allSites.map((s) => ({ domain: s.domain, host: s.host, aliases: s.aliases, defaced: !!s.defaced, pages: s.pages.map((p) => ({ url: p.finalUrl, status: p.status, ms: p.ms, kb: Math.round(p.bytes / 1024), chars: p.text.length, unique: p.unique.length })) })),
      pages_crawled: allSites.reduce((a, s) => a + s.pages.length, 0), http_total: ctx.meter.http.calls,
      llm_pages: jobs.map((j) => j.page.finalUrl), llm_skipped: skipped, claims, dropped,
    },
  };
}
