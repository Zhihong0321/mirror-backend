// C / rules — website health, rule-based only (no LLM).
// Same bounded crawl as C-llm.ts (homepage + up to ~14 internal pages per site). Then deterministic
// checks: HTTP status of internal, wa.me, tel: and mailto: links; SSL certificate; the http->https
// redirect; viewport meta; the (c) year; the SSM registration number; free-mail addresses; phones on
// the site vs the dive and Google Maps; street address vs the dive; title and meta description;
// page weight and time; mixed content; forms (found, never submitted); placeholder text; stale news.
// Grammar comes from the free LanguageTool public API (en-GB), paced under its public limits, with a
// deterministic filter for Malay words, brand names and product codes.
import fs from 'node:fs';
import path from 'node:path';
import tls from 'node:tls';
import dns from 'node:dns/promises';
import type { Ctx, Finding } from '../lib.ts';
import { OUT } from '../lib.ts';

// ---------------------------------------------------------------------------------------------
// Crawl helper (same copy in C-llm.ts). Bounded, polite: 3 requests at a time, robots.txt honoured.
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
// The rules lane
// ---------------------------------------------------------------------------------------------
const LINK_CAP = Number(process.env.C_LINK_CAP ?? 25);
const LT_URL = 'https://api.languagetool.org/v2/check';
const LT_MAX_BYTES = 7000;           // public limit is 20 KB, but long requests hit its 20 s check limit
const LT_PAGE_CHARS = 8000;          // read at most this much own text per page (listing pages are huge)
const LT_BYTES_PER_MIN = 70000;      // public limit is 75 KB per minute
const LT_REQ_PER_MIN = 18;           // public limit is 20 per minute
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Malaysian phone number -> digits starting 60, or '' if it does not look like one. */
export function normPhone(raw: string): string {
  let d = raw.replace(/\D/g, '');
  if (d.startsWith('0')) d = '6' + d;
  else if (d.startsWith('1') && d.length >= 9 && d.length <= 10) d = '60' + d;
  if (!d.startsWith('60')) return '';
  const rest = d.slice(2);
  if (/^1\d{8,9}$/.test(rest)) return d;        // mobile: 01x-xxx xxxx / 011-xxxx xxxx
  if (/^3\d{8}$/.test(rest)) return d;          // KL/Selangor landline
  if (/^[4-9]\d{7,8}$/.test(rest)) return d;    // other landlines
  return '';
}
const fmtPhone = (d: string) => d.startsWith('601') ? `0${d.slice(2, 4)}-${d.slice(4)}` : `0${d.slice(2)}`;
const PHONE_RE = /(?:\+?\s?6?0)[\s-]?(?:1\d[\s-]?\d{3,4}[\s-]?\d{4}|[3-9][\s-]?\d{3,4}[\s-]?\d{4})/g;

function phonesIn(text: string): string[] {
  return [...new Set([...text.matchAll(PHONE_RE)].map((m) => normPhone(m[0])).filter(Boolean))];
}

function sslCert(host: string): Promise<{ host: string; ok: boolean; error?: string; validTo?: string; daysLeft?: number; issuer?: string; names?: string }> {
  return new Promise((resolve) => {
    const s = tls.connect({ host, port: 443, servername: host, rejectUnauthorized: false }, () => {
      const c = s.getPeerCertificate();
      const validTo = c?.valid_to ? new Date(c.valid_to) : null;
      resolve({ host, ok: s.authorized, error: s.authorized ? undefined : String(s.authorizationError), validTo: validTo?.toISOString(), daysLeft: validTo ? Math.round((validTo.getTime() - Date.now()) / 86400000) : undefined, issuer: c?.issuer?.O ?? c?.issuer?.CN, names: c?.subjectaltname });
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
const decode = (s: string) => s.replace(/&amp;/g, '&').replace(/&#0?39;|&rsquo;/g, "'").replace(/&quot;/g, '"').replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();

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

// Words LanguageTool's English speller does not know but that are right on a Malaysian site.
const MALAY_ETC = new Set(('jalan jln taman tmn lorong persiaran lebuh sdn bhd berhad johor bahru kuala lumpur selangor negeri sembilan seremban kluang melaka pulau pinang penang ' +
  'perak kedah kelantan terengganu pahang sabah sarawak putrajaya labuan klang shah alam petaling jaya subang puchong cheras ampang kajang skudai iskandar puteri nusajaya ' +
  'masai pasir gudang senai kulai muar batu pahat segamat pontian mersing kota tinggi ipoh mutiara emas austin tasik indah uptown bandar baru seri sri desa ' +
  'lembaga pembangunan industri pembinaan kementerian tenaga suruhanjaya kg kampung bukit sungai tanjung pantai ' +
  'tnb seda suria nem nova atap solar mydigital cidb ssm spkk ppk lhdn mida bumiputera rm sen kwh kwp mwp gwh mwh kva kw mw pv bess ess epc epcc o&m capex opex ppa rpvi ' +
  'atap gso lsc netoff nem3 selco lss topcon hjt perc bifacial jinko longi trina saj huawei sungrow solis growatt enphase fronius goodwe deye risen canadian ja ' +
  'whatsapp facebook instagram tiktok xiaohongshu youtube linkedin wechat google maps waze grab shopee lazada').split(/\s+/));

function editDistance(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}

type LtHit = { sentStart?: boolean; url: string; rule: string; category: string; message: string; context: string; word: string; replacements: string[]; sentence: string; kept: boolean; reason?: string };

export async function run(ctx: Ctx, dive: any): Promise<{ findings: Finding[]; notes: Record<string, unknown> }> {
  const r = dive.result ?? {};
  const id = r.identity ?? {};
  const todayMs = Date.now();
  const year = new Date().getFullYear();
  const findings: Finding[] = [];
  const add = (check: string, f: Omit<Finding, 'checked_at'>) => findings.push({ ...f, check, checked_at: ctx.now() } as Finding);
  ctx.meter.other.languagetool = 0;
  ctx.meter.other.languagetool_bytes = 0;
  ctx.meter.other.tls = 0;
  ctx.meter.other.dns = 0;

  const { sites, redirects } = await crawl(ctx, dive);
  const crawled = sites.flatMap((s) => s.pages);
  const crawledCount = crawled.length;
  const allHosts = new Set(sites.flatMap((s) => [s.host, s.domain, ...s.aliases]));
  const isInternal = (u: string) => allHosts.has(bareHost(u));
  const pageByUrl = new Map(crawled.map((p) => [normUrl(p.finalUrl), p] as const).concat(crawled.map((p) => [normUrl(p.url), p] as const)));

  // 0. Domains that redirect to another domain (customers typing one name land on another site).
  for (const rd of redirects) add('redirect-domain', { title: `${rd.domain} redirects to ${bareHost(rd.to)}`, detail: `Typing ${rd.domain} lands on ${rd.to}. Fine if intended; the dive lists both as official domains.`, severity: 'info', source: `https://${rd.domain}/`, evidence: rd.to });

  // 1. SSL and the http -> https redirect, per domain.
  const tlsHosts = [...new Set(sites.flatMap((s) => [new URL(s.home).hostname, s.domain, ...s.aliases]))];
  const certs = await pool(tlsHosts, 3, async (h) => { ctx.meter.other.tls++; return sslCert(h); });
  for (const c of certs) {
    if (!c.ok) add('ssl', { title: `SSL problem on ${c.host}`, detail: `The certificate is not trusted: ${c.error}.`, severity: 'high', source: `https://${c.host}/`, evidence: c.error });
    else if ((c.daysLeft ?? 99) < 21) add('ssl', { title: `SSL certificate on ${c.host} expires in ${c.daysLeft} days`, detail: `Valid to ${c.validTo} (${c.issuer}). If auto-renewal fails, visitors get a security warning.`, severity: (c.daysLeft ?? 0) < 7 ? 'high' : 'low', source: `https://${c.host}/`, evidence: c.validTo });
  }
  const httpChecks = await pool([...new Set(sites.flatMap((s) => [s.domain, ...s.aliases]))], 3, async (d) => ({ d, r: await ctx.page(`http://${d}/`, { redirect: 'manual' }) }));
  for (const { d, r: h } of httpChecks) {
    const loc = h.headers['location'] ?? '';
    if (h.status === 0) add('https-redirect', { title: `http://${d}/ does not answer`, detail: h.error ?? '', severity: 'medium', source: `http://${d}/` });
    else if (!(h.status >= 300 && h.status < 400 && /^https:/i.test(new URL(loc || '/', `http://${d}/`).href))) add('https-redirect', { title: `http://${d}/ does not redirect to https`, detail: `HTTP ${h.status}${loc ? ' -> ' + loc : ''}. Visitors on the plain-http address get an unencrypted page marked "Not secure".`, severity: 'medium', source: `http://${d}/` });
  }

  // 2. Per page: status, speed, weight, title, description, viewport, mixed content, placeholder text.
  const titles = new Map<string, string[]>();
  const seoBySite = new Map<string, { pages: number; noTitle: string[]; longTitle: string[]; shortTitle: string[]; noDesc: string[]; longDesc: string[]; shortDesc: string[] }>();
  for (const p of crawled) {
    const u = p.finalUrl;
    if (p.status !== 200) { add('page-status', { title: `Page ${new URL(p.url).pathname} returns HTTP ${p.status}`, detail: p.error ?? `Linked from the homepage of ${p.site} but answers ${p.status}.`, severity: p.status === 0 || p.status >= 500 || p.status === 404 ? 'high' : 'medium', source: p.url }); continue; }
    if (p.ms > 3000) add('slow', { title: `Slow page: ${new URL(u).pathname} took ${(p.ms / 1000).toFixed(1)} s for the HTML alone`, detail: `Server response plus HTML download, measured from the test machine (Malaysia). Images and scripts come on top.`, severity: p.ms > 6000 ? 'medium' : 'low', source: u, evidence: `${p.ms} ms` });
    if (p.bytes > 800_000) add('weight', { title: `Heavy HTML: ${new URL(u).pathname} is ${(p.bytes / 1024).toFixed(0)} KB before images`, detail: 'Large inline HTML slows mobile visitors.', severity: 'low', source: u, evidence: `${p.bytes} bytes` });
    const title = decode(p.html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '');
    const desc = decode(metaContent(p.html, 'description') ?? '');
    const viewport = metaContent(p.html, 'viewport');
    const seo = seoBySite.get(p.site) ?? { pages: 0, noTitle: [], longTitle: [], shortTitle: [], noDesc: [], longDesc: [], shortDesc: [] };
    seoBySite.set(p.site, seo);
    seo.pages++;
    const path_ = new URL(u).pathname;
    if (!title) seo.noTitle.push(path_);
    else {
      titles.set(title, [...(titles.get(title) ?? []), u]);
      if (title.length > 70) seo.longTitle.push(`${path_} (${title.length})`);
      if (title.length < 15) seo.shortTitle.push(`${path_} (${title.length})`);
    }
    if (!desc) seo.noDesc.push(path_);
    else if (desc.length > 170) seo.longDesc.push(`${path_} (${desc.length})`);
    else if (desc.length < 50) seo.shortDesc.push(`${path_} (${desc.length})`);
    if (!viewport) add('viewport', { title: `No mobile viewport on ${new URL(u).pathname}`, detail: 'Without <meta name="viewport"> phones show the desktop layout zoomed out.', severity: 'high', source: u });
    else if (/user-scalable\s*=\s*(no|0)|maximum-scale\s*=\s*1(\.0)?\b/i.test(viewport)) add('viewport', { title: `Zoom disabled on ${new URL(u).pathname}`, detail: `viewport="${viewport}" stops visitors from pinch-zooming.`, severity: 'low', source: u, evidence: viewport });
    const mixed = [...p.html.matchAll(/<(?:img|script|iframe|source|link)\b[^>]*\b(?:src|href)\s*=\s*["'](http:\/\/[^"']+)/gi)].map((m) => m[1]);
    if (mixed.length && u.startsWith('https:')) add('mixed-content', { title: `${mixed.length} insecure (http://) resources on ${new URL(u).pathname}`, detail: 'Browsers block or warn on http:// images and scripts inside an https page.', severity: 'medium', source: u, evidence: mixed.slice(0, 3).join(' ') });
    // A placeholder phrase counts only as a short standalone line (a label), not inside a sentence.
    const placeholder = p.text.split('\n').map((l) => l.trim()).filter((l) => l.length <= 40)
      .map((l) => l.match(/^(?:.{0,15}\b)?(lorem ipsum|dolor sit amet|sample text|your (?:company|title|text) here|coming soon|under construction|\[object object\]|undefined|NaN|(?:about|contact|test)\s+123)\b/i)).find(Boolean);
    if (placeholder) add('placeholder', { title: `Placeholder or template text on ${new URL(u).pathname}: "${placeholder[0]}"`, detail: 'Looks like template text left in the live site.', severity: 'medium', source: u, evidence: placeholder.input });
  }
  for (const [site, x] of seoBySite) {
    const ex = (a: string[]) => a.slice(0, 4).join(', ') + (a.length > 4 ? ` and ${a.length - 4} more` : '');
    if (x.noTitle.length) add('title', { title: `${x.noTitle.length} of ${x.pages} pages on ${site} have no <title>`, detail: `Google shows the URL instead of a page name: ${ex(x.noTitle)}.`, severity: 'medium', source: null });
    if (x.longTitle.length) add('title', { title: `${x.longTitle.length} of ${x.pages} pages on ${site} have titles over 70 characters`, detail: `Google cuts titles at about 60-70 characters: ${ex(x.longTitle)}.`, severity: 'low', source: null });
    if (x.shortTitle.length) add('title', { title: `${x.shortTitle.length} of ${x.pages} pages on ${site} have titles under 15 characters`, detail: ex(x.shortTitle), severity: 'low', source: null });
    if (x.noDesc.length) add('meta-description', { title: `${x.noDesc.length} of ${x.pages} pages on ${site} have no meta description`, detail: `Google picks its own snippet: ${ex(x.noDesc)}.`, severity: 'low', source: null });
    if (x.longDesc.length) add('meta-description', { title: `${x.longDesc.length} of ${x.pages} pages on ${site} have meta descriptions over 170 characters`, detail: `Google cuts them at about 155-160: ${ex(x.longDesc)}.`, severity: 'low', source: null });
    if (x.shortDesc.length) add('meta-description', { title: `${x.shortDesc.length} of ${x.pages} pages on ${site} have meta descriptions under 50 characters`, detail: ex(x.shortDesc), severity: 'low', source: null });
  }
  for (const [t, urls] of titles) if (urls.length > 1) add('title', { title: `${urls.length} pages share the same title`, detail: `"${t.slice(0, 100)}" on ${urls.map((x) => new URL(x).pathname).join(', ')}. Google may treat them as duplicates.`, severity: 'low', source: urls[0], evidence: t });

  // 3. Footer facts on each site: (c) year, SSM number, emails.
  const regs: string[] = (id.registration_numbers ?? []).map((x: string) => x.replace(/[^0-9A-Z]/gi, '').toUpperCase());
  for (const s of sites) {
    const home = s.pages[0];
    if (!home || home.status !== 200) continue;
    const ok = s.pages.filter((p) => p.status === 200);
    const allText = ok.map((p) => p.text).join('\n');
    // (c) year
    const copy = [...home.text.matchAll(/(?:©|&copy;|\(c\)|copyright)\s*((?:19|20)\d\d)(?:\s*[-–]\s*((?:19|20)\d\d))?|((?:19|20)\d\d)\s*[-–]\s*((?:19|20)\d\d)\s*(?:©)?\s*(?=[^\n]{0,30}(?:sdn|bhd|berhad|all rights|reserved))|((?:19|20)\d\d)\s*©/gi)];
    if (!copy.length) add('copyright', { title: `No copyright line found on ${s.host}`, detail: 'No "© year" in the homepage text.', severity: 'info', source: home.finalUrl });
    else {
      const latest = Math.max(...copy.map((m) => Number(m[2] ?? m[1] ?? m[4] ?? m[5])).filter(Boolean));
      if (latest < year) add('copyright', { title: `Stale copyright year on ${s.host}: ${latest}`, detail: `The footer says ${copy[0][0].trim()}; it is ${year}. Visitors read an old year as an abandoned site.`, severity: latest < year - 1 ? 'medium' : 'low', source: home.finalUrl, evidence: copy[0][0].trim() });
    }
    // SSM registration number
    const found12 = [...new Set([...allText.matchAll(/\b((?:19|20)\d\d0[1-6]\d{6})\b/g)].map((m) => m[1]))];
    const foundOld = [...new Set([...allText.matchAll(/\b(\d{5,7})-?\s?([A-Z])\b/g)].map((m) => m[1] + m[2]))];
    const onHome = regs.some((x) => home.text.replace(/[^0-9A-Z]/gi, '').toUpperCase().includes(x));
    if (!onHome) add('ssm', { title: `SSM registration number not on the ${s.host} homepage`, detail: `Expected one of ${(id.registration_numbers ?? []).join(', ')}. Companies Act 2016 s.70 asks for it on the website; it also builds trust.${found12.length || foundOld.length ? ' Found elsewhere on the site: ' + [...found12, ...foundOld].join(', ') : ''}`, severity: 'medium', source: home.finalUrl });
    for (const n of found12) if (regs.length && !regs.includes(n)) add('ssm', { title: `Unknown registration number ${n} on ${s.host}`, detail: `The dive's numbers are ${(id.registration_numbers ?? []).join(', ')}.`, severity: 'medium', source: ok.find((p) => p.text.includes(n))?.finalUrl ?? home.finalUrl, evidence: n });
    // emails
    const emails = [...new Set(ok.flatMap((p) => [...p.html.matchAll(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)].map((m) => m[0].toLowerCase())))].filter((e) => !/\.(png|jpe?g|webp|svg|gif)$/i.test(e) && !/@(sentry|example|domain|email)\./.test(e));
    for (const e of emails) {
      const dom = e.split('@')[1];
      if (/^(gmail|googlemail|hotmail|outlook|live|yahoo|ymail|icloud|aol|msn)\.(com|my|co\.uk|com\.my)$/.test(dom)) add('free-mail', { title: `Free-mail contact address on ${s.host}: ${e}`, detail: 'A Gmail or Hotmail address looks less established than one on your own domain.', severity: 'medium', source: ok.find((p) => p.html.toLowerCase().includes(e))?.finalUrl ?? home.finalUrl, evidence: e });
    }
    (s as any).emails = emails;
  }

  // 4. Phones: site vs the dive vs Google Maps. Address: site vs the dive.
  const sitePhones = new Map<string, Set<string>>(); // phone -> urls
  const notePhone = (raw: string, url: string, how: string) => { const n = normPhone(raw); if (n) { if (!sitePhones.has(n)) sitePhones.set(n, new Set()); sitePhones.get(n)!.add(`${url} (${how})`); } };
  for (const p of crawled.filter((x) => x.status === 200)) {
    for (const h of hrefsOf(p.html, p.finalUrl)) {
      if (/^tel:/i.test(h)) notePhone(h.slice(4), p.finalUrl, 'tel link');
      const wa = h.match(/(?:wa\.me\/|api\.whatsapp\.com\/send\/?\?phone=)(\d+)/i);
      if (wa) notePhone(wa[1], p.finalUrl, 'WhatsApp link');
    }
    for (const m of p.html.matchAll(/"telephone"\s*:\s*"([^"]+)"/g)) {
      if (/\*/.test(m[1])) add('phone-masked', { title: `A masked phone number "${m[1]}" is published in the page's structured data`, detail: 'Search engines and AI assistants read this JSON-LD block; a masked number there is shown as your phone and nobody can call it.', severity: 'high', source: p.finalUrl, evidence: m[0] });
      else notePhone(m[1], p.finalUrl, 'structured data');
    }
    for (const n of phonesIn(p.text)) notePhone(n, p.finalUrl, 'page text');
  }
  const divePhones = new Set(phonesIn(JSON.stringify(r.facts ?? []) + ' ' + JSON.stringify(r.people ?? [])));
  const mapsFile = path.join(OUT, `H-maps-${ctx.diveId}.json`);
  let mapsListings: any[] = [];
  try { mapsListings = JSON.parse(fs.readFileSync(mapsFile, 'utf8')).notes?.listings ?? []; } catch { ctx.warn(`no ${path.basename(mapsFile)}; skipping the Maps phone check`); }
  for (const l of mapsListings) {
    const n = normPhone(String(l.phone ?? ''));
    if (n && !sitePhones.has(n)) add('phone-maps', { title: `Maps listing "${l.name}" gives ${fmtPhone(n)}, which is not on your website`, detail: `A customer who finds this branch on Google Maps calls a number your site never shows. Site numbers: ${[...sitePhones.keys()].map(fmtPhone).join(', ')}.`, severity: 'medium', source: l.place_link ?? null, evidence: l.phone });
  }
  const mapsPhones = new Set(mapsListings.map((l) => normPhone(String(l.phone ?? ''))).filter(Boolean));
  for (const [n, where] of sitePhones) {
    if (!divePhones.has(n) && !mapsPhones.has(n)) add('phone-unknown', { title: `Site phone ${fmtPhone(n)} is not in the dive or on Maps`, detail: `Found at ${[...where].slice(0, 3).join('; ')}. Check it is still in use.`, severity: 'low', source: [...where][0].split(' (')[0], evidence: n });
  }
  // Which number does each site lead with?
  const perSite = sites.map((s) => ({ host: s.host, phones: [...sitePhones].filter(([, w]) => [...w].some((x) => bareHost(x.split(' ')[0]) === s.host)).map(([n]) => n) }));
  if (perSite.length > 1 && perSite.every((x) => x.phones.length) && !perSite.slice(1).some((x) => x.phones.some((n) => perSite[0].phones.includes(n)))) {
    add('phone-sites', { title: 'Your websites give different phone numbers', detail: perSite.map((x) => `${x.host}: ${x.phones.map(fmtPhone).join(', ')}`).join(' | ') + '. No number appears on both.', severity: 'medium', source: null, evidence: JSON.stringify(perSite) });
  }
  // Street address: same street as the dive, different unit number?
  const addr = String(id.address ?? '');
  const street = addr.match(/(?:^|,\s*)(?:[\w-]+,?\s+)?((?:jalan|jln|lorong|persiaran|lebuh)\s+[^,]+)/i)?.[1]?.trim();
  const unit = addr.match(/^\s*(?:no\.?\s*)?([\dA-Z]+-[\dA-Z-]+|\d+[A-Z]?)\b/i)?.[1];
  if (street && unit) {
    const esc = street.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
    const seen = new Map<string, string>();
    for (const p of crawled.filter((x) => x.status === 200)) {
      for (const m of (p.text + '\n' + p.html).matchAll(new RegExp(`(?:no\\.?\\s*)?([\\dA-Z]+-[\\dA-Z-]+|\\d+[A-Z]?)\\s*,?\\s*${esc}`, 'gi'))) if (!seen.has(m[1].toUpperCase())) seen.set(m[1].toUpperCase(), p.finalUrl);
    }
    for (const [u, url] of seen) if (u !== unit.toUpperCase()) add('address', { title: `Address unit "${u}, ${street}" differs from the registered "${unit}"`, detail: `The dive's address is "${addr}". The site shows unit ${u} on the same street.`, severity: 'high', source: url, evidence: `${u}, ${street}` });
  }

  // 5. Links: internal (status), wa.me (live business account?), tel: (format), mailto: (MX).
  const linkFrom = new Map<string, Set<string>>();
  for (const p of crawled.filter((x) => x.status === 200)) for (const h of hrefsOf(p.html, p.finalUrl)) { if (!linkFrom.has(h)) linkFrom.set(h, new Set()); linkFrom.get(h)!.add(p.finalUrl); }
  const internal = [...linkFrom.keys()].filter((u) => /^https?:/i.test(u) && isInternal(u) && !/\/cdn-cgi\//.test(u)).map(normUrl);
  const uncrawled = [...new Set(internal)].filter((u) => !pageByUrl.has(u)).sort((a, b) => (linkFrom.get(b)?.size ?? 0) - (linkFrom.get(a)?.size ?? 0));
  if (uncrawled.length > LINK_CAP) ctx.warn(`${uncrawled.length} internal links not crawled; checking the ${LINK_CAP} linked most often`);
  const checked = await pool(uncrawled.slice(0, LINK_CAP), 3, async (u) => ({ u, r: await ctx.page(u) }));
  const linkStatus: any[] = [];
  for (const { u, r: h } of checked) {
    linkStatus.push({ url: u, status: h.status, final: h.finalUrl });
    const from = [...(linkFrom.get(u) ?? linkFrom.get(u + '/') ?? [])];
    if (h.status === 0 || h.status >= 400) add('broken-link', { title: `Broken internal link: ${new URL(u).pathname} (HTTP ${h.status || 'no answer'})`, detail: `Linked from ${from.slice(0, 3).map((x) => new URL(x).pathname).join(', ') || 'a crawled page'}.${h.status === 403 ? ' A 403 can mean the server blocks bots; check in a browser.' : ''}`, severity: h.status === 403 ? 'low' : 'medium', source: u, evidence: h.error ?? String(h.status) });
  }
  const waNums = [...new Set([...linkFrom.keys()].map((h) => h.match(/(?:wa\.me\/|api\.whatsapp\.com\/send\/?\?phone=)(\d+)/i)?.[1]).filter(Boolean) as string[])];
  const waStatus: any[] = [];
  const companyWords: string[] = [id.legal_name, dive.company, ...(id.aliases ?? [])].filter(Boolean).map((x: string) => x.toLowerCase().replace(/sdn\.?\s*bhd\.?|berhad|\(.*?\)/g, '').trim()).filter((x: string) => x.length >= 4);
  for (const n of waNums) {
    const h = await ctx.page(`https://wa.me/${n}`);
    const biz = decode(h.html.match(/<h3 class="_9vd5 _9scb _9scr">([^<]*)<\/h3>/)?.[1] ?? '');
    const from = [...linkFrom.keys()].filter((k) => k.includes(n)).flatMap((k) => [...linkFrom.get(k)!]);
    waStatus.push({ number: n, status: h.status, business: biz || null, valid: !!normPhone(n) });
    if (h.status !== 200) add('whatsapp', { title: `WhatsApp link wa.me/${n} answers HTTP ${h.status}`, detail: h.error ?? '', severity: 'medium', source: from[0] ?? null });
    else if (!normPhone(n)) add('whatsapp', { title: `WhatsApp link wa.me/${n} is not a valid Malaysian number`, detail: 'The link opens WhatsApp with a number that cannot exist.', severity: 'high', source: from[0] ?? null, evidence: n });
    else if (biz && !companyWords.some((w: string) => biz.toLowerCase().includes(w))) add('whatsapp', { title: `WhatsApp wa.me/${n} opens a chat with "${biz}", not the company`, detail: `The WhatsApp Business name a customer sees for ${fmtPhone(n)} is "${biz}", where they expect ${dive.company}.`, severity: 'medium', source: from[0] ?? null, evidence: biz });
    else if (!biz) add('whatsapp', { title: `WhatsApp link wa.me/${n} shows no business name`, detail: 'wa.me shows the WhatsApp Business name for business accounts; none here. The number may be a personal account or not on WhatsApp. Check by hand.', severity: 'low', source: from[0] ?? null, evidence: n });
  }
  const telStatus: any[] = [];
  for (const t of [...new Set([...linkFrom.keys()].filter((h) => /^tel:/i.test(h)))]) {
    const n = normPhone(decodeURIComponent(t.slice(4)));
    telStatus.push({ tel: t, normalised: n || null });
    if (!n) add('tel', { title: `Click-to-call link "${t}" is not a valid Malaysian number`, detail: 'Tapping it on a phone dials a wrong or impossible number.', severity: 'high', source: [...linkFrom.get(t)!][0], evidence: t });
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

  // 6. Forms: list them (never submitted).
  const forms: any[] = [];
  for (const p of crawled.filter((x) => x.status === 200)) {
    for (const m of p.html.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/gi)) {
      const inputs = [...m[2].matchAll(/<(?:input|textarea|select)\b[^>]*>/gi)].map((x) => attr(x[0], 'name') ?? attr(x[0], 'type') ?? '?');
      const action = attr(m[1], 'action');
      const kind = inputs.some((x) => /search|^q$/i.test(x)) || /search/i.test(m[1]) ? 'search' : 'other';
      forms.push({ page: p.finalUrl, action, method: (attr(m[1], 'method') ?? 'get').toLowerCase(), inputs, kind });
      if (action && /^http:\/\//i.test(action)) add('form', { title: `Form on ${new URL(p.finalUrl).pathname} posts to an insecure http:// address`, detail: `action="${action}"`, severity: 'high', source: p.finalUrl, evidence: action });
    }
  }
  for (const s of sites) {
    const contact = s.pages.find((p) => p.status === 200 && /contact|hubungi/i.test(new URL(p.finalUrl).pathname));
    const contactForms = forms.filter((f) => bareHost(f.page) === s.host && f.kind !== 'search');
    if (!contactForms.length) add('form', { title: `No enquiry form found on ${s.host}`, detail: `${contact ? 'The contact page ' + new URL(contact.finalUrl).pathname + ' has' : 'The crawled pages have'} no HTML <form> other than search. Customers must call, WhatsApp or email. (A form built by JavaScript would not show here.)`, severity: 'info', source: contact?.finalUrl ?? s.home });
  }

  // 7. Stale news / blog: newest dated item on news-like pages.
  for (const s of sites) {
    const news = s.pages.filter((p) => p.status === 200 && /news|blog|latest|article|tips/i.test(new URL(p.finalUrl).pathname));
    const dates = news.flatMap((p) => datesIn(p.text, todayMs).map((d) => ({ d, url: p.finalUrl })));
    if (!news.length) continue;
    if (!dates.length) { add('stale-news', { title: `No dates on the news pages of ${s.host}`, detail: `${news.map((p) => new URL(p.finalUrl).pathname).join(', ')} show no post dates, so freshness cannot be told.`, severity: 'info', source: news[0].finalUrl }); continue; }
    const newest = dates.reduce((a, b) => (b.d > a.d ? b : a));
    const days = Math.round((todayMs - newest.d.getTime()) / 86400000);
    if (days > 180) add('stale-news', { title: `Newest news item on ${s.host} is ${Math.round(days / 30)} months old`, detail: `Latest date on ${new URL(newest.url).pathname}: ${newest.d.toISOString().slice(0, 10)}. A stale news page makes the company look inactive.`, severity: days > 365 ? 'medium' : 'low', source: newest.url, evidence: newest.d.toISOString().slice(0, 10) });
  }
  // Expired offers: "valid until <date in the past>".
  for (const p of crawled.filter((x) => x.status === 200)) {
    for (const m of p.text.matchAll(/\b(?:valid(?: until| till| thru| through)?|promo(?:tion)? (?:ends?|period)|offer ends?|expires?|deadline|until|till)\b[^.\n]{0,25}?((?:\d{1,2}\s+[A-Za-z]{3,9}\s+20\d\d)|(?:[A-Za-z]{3,9}\s+\d{1,2},?\s+20\d\d)|(?:\d{1,2}\/\d{1,2}\/20\d\d))/gi)) {
      const d = datesIn(m[1], todayMs + 10 * 365 * 86400000)[0];
      if (d && d.getTime() < todayMs - 86400000) add('expired', { title: `Expired date on ${new URL(p.finalUrl).pathname}: "${m[0].trim()}"`, detail: 'An offer or deadline that has already passed is still shown.', severity: 'medium', source: p.finalUrl, evidence: m[0].trim() });
    }
  }

  // 8. Grammar and spelling: LanguageTool public API.
  const aliasWords = new Set([id.legal_name, dive.company, ...(id.aliases ?? [])].join(' ').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));
  const ltDocs: { url: string; text: string }[] = [];
  for (const s of sites) for (const p of s.pages) {
    if (p.status !== 200) continue;
    // Keep lines of 4+ words: menus, buttons and labels are not sentences.
    let text = (p.isHome ? p.text : p.unique).split('\n').map((l) => l.trim()).filter((l) => l.split(/\s+/).length >= 4 && !/[一-鿿]/.test(l)).join('\n');
    const pre = p.isHome ? waPrefills(p.html) : [];
    if (pre.length) text += '\n' + pre.join('\n');
    if (text.length > LT_PAGE_CHARS) text = splitText(text, LT_PAGE_CHARS)[0];
    if (text.length > 80) ltDocs.push({ url: p.finalUrl, text });
  }
  // Pack pages into requests under the byte limit, keeping each page's offset range.
  const batches: { text: string; ranges: { url: string; start: number; end: number }[] }[] = [];
  for (const d of ltDocs) {
    for (const piece of splitText(d.text, LT_MAX_BYTES / 2)) {
      let b = batches[batches.length - 1];
      if (!b || Buffer.byteLength(b.text + '\n\n' + piece) > LT_MAX_BYTES) { b = { text: '', ranges: [] }; batches.push(b); }
      const start = b.text ? b.text.length + 2 : 0;
      b.text = b.text ? b.text + '\n\n' + piece : piece;
      b.ranges.push({ url: d.url, start, end: b.text.length });
    }
  }
  const hits: LtHit[] = [];
  const sent: { t: number; bytes: number }[] = [];
  let ltDead = false;
  for (const b of batches) {
    if (ltDead) break;
    const bytes = Buffer.byteLength(b.text);
    // Pace under the public limits: wait until the last minute has room.
    for (;;) {
      const recent = sent.filter((x) => x.t > Date.now() - 60000);
      if (recent.length < LT_REQ_PER_MIN && recent.reduce((a, x) => a + x.bytes, 0) + bytes <= LT_BYTES_PER_MIN) break;
      await sleep(Math.max(1000, (recent[0]?.t ?? Date.now()) + 60500 - Date.now()));
    }
    sent.push({ t: Date.now(), bytes });
    ctx.meter.other.languagetool++;
    ctx.meter.other.languagetool_bytes += bytes;
    let body: any = null;
    for (let attempt = 0; attempt < 2 && !body; attempt++) {
      const c = ctx.call('web', `LanguageTool ${bytes} bytes`);
      try {
        const res = await fetch(LT_URL, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' }, body: new URLSearchParams({ text: b.text, language: 'en-GB', enabledOnly: 'false' }) });
        const raw = await res.text();
        c.done({ ok: res.ok, note: `HTTP ${res.status}` });
        if (res.status === 429) { ctx.warn(`LanguageTool 429 (attempt ${attempt + 1}); waiting a minute`); await sleep(61000); continue; }
        if (!res.ok) { ctx.warn(`LanguageTool HTTP ${res.status}: ${raw.slice(0, 160)}`); if (res.status === 403) ltDead = true; break; }
        body = JSON.parse(raw);
      } catch (e) { c.done({ ok: false, note: (e as Error).message.slice(0, 200) }); ctx.warn(`LanguageTool failed: ${(e as Error).message}`); }
    }
    if (!body) continue;
    for (const m of body.matches ?? []) {
      const rg = b.ranges.find((x) => m.offset >= x.start && m.offset < x.end);
      const word = b.text.slice(m.offset, m.offset + m.length);
      const before = b.text.slice(Math.max(0, m.offset - 3), m.offset);
      hits.push({ sentStart: m.offset === 0 || /(^|[.!?:]\s+|\n\s*)$/.test(before), url: rg?.url ?? '?', rule: m.rule?.id, category: m.rule?.category?.id, message: m.message, context: m.context?.text ?? '', word, replacements: (m.replacements ?? []).slice(0, 3).map((x: any) => x.value), sentence: String(m.sentence ?? '').slice(0, 220), kept: true });
    }
  }
  if (!batches.length) ctx.warn('no text for LanguageTool');

  // Deterministic filter for the usual false alarms.
  const IGNORE_RULES = /^(WHITESPACE_RULE|CONSECUTIVE_SPACES|UPPERCASE_SENTENCE_START|EN_QUOTES|DASH_RULE|PUNCTUATION_PARAGRAPH_END|SENTENCE_WHITESPACE|EN_UNPAIRED_BRACKETS|EN_UNPAIRED_QUOTES|ARROWS|MULTIPLICATION_SIGN|ENGLISH_WORD_REPEAT_BEGINNING_RULE|EN_SPECIFIC_CASE|PLUS_MINUS|NUMBERS_IN_WORDS|THREE_NN|EN_COMPOUNDS.*|DOUBLE_PUNCTUATION|ELLIPSIS|APOS_ARE|SENT_START_NUM|CURRENCY|UNIT_SPACE|EN_SIMPLE_REPLACE.*|OXFORD_SPELLING.*|EN_GB_SIMPLE_REPLACE.*|PROFANITY|TOO_LONG_SENTENCE)$/;
  const wordCount = new Map<string, number>();
  for (const h of hits) if (/MORFOLOGIK/.test(h.rule)) wordCount.set(h.word.toLowerCase(), (wordCount.get(h.word.toLowerCase()) ?? 0) + 1);
  for (const h of hits) {
    const w = h.word.toLowerCase();
    if (IGNORE_RULES.test(h.rule)) { h.kept = false; h.reason = 'formatting rule'; continue; }
    if (['TYPOGRAPHY', 'STYLE', 'REDUNDANCY', 'CASING'].includes(h.category) && h.rule !== 'COMMA_PARENTHESIS_WHITESPACE') { h.kept = false; h.reason = `category ${h.category}`; continue; }
    if (/\n/.test(h.word)) { h.kept = false; h.reason = 'crosses a line break (flattening artefact)'; continue; }
    if (/^\s[,.;:)]$|^\(\s$/.test(h.word)) { h.kept = false; h.reason = 'space around punctuation (tag-stripping artefact)'; continue; }
    if (/American English|British English/i.test(h.message)) { h.kept = false; h.reason = 'US vs UK spelling'; continue; }
    if (/MORFOLOGIK/.test(h.rule)) {
      if (!h.replacements.length || editDistance(w, h.replacements[0].toLowerCase()) > 2) { h.kept = false; h.reason = 'no close suggestion (likely a name or term)'; continue; }
      if (/\d/.test(w)) { h.kept = false; h.reason = 'has digits (model code)'; continue; }
      if (MALAY_ETC.has(w) || aliasWords.has(w)) { h.kept = false; h.reason = 'Malay/place/trade word or brand'; continue; }
      if (h.word.replace(/[^a-z]/gi, '').length <= 2) { h.kept = false; h.reason = 'fragment (cut-off excerpt)'; continue; }
      if ((/^[A-Z][a-z]+/.test(h.word) && !h.sentStart) || /^[A-Z]{2,}s?$/.test(h.word) || /[a-z][A-Z]/.test(h.word)) { h.kept = false; h.reason = 'proper noun, acronym or CamelCase'; continue; }
      if ((wordCount.get(w) ?? 0) >= 3) { h.kept = false; h.reason = 'repeated 3+ times (likely a term)'; continue; }
    }
  }
  const seenHit = new Set<string>();
  for (const h of hits.filter((x) => x.kept)) {
    const key = `${h.rule}|${h.word.toLowerCase()}|${h.sentence.slice(0, 60)}`;
    if (seenHit.has(key)) continue;
    seenHit.add(key);
    add('grammar', { title: `${/MORFOLOGIK/.test(h.rule) ? 'spelling' : 'grammar'}: "${h.word}" — ${h.message.slice(0, 100)}`, detail: `In: "${h.context.trim()}"${h.replacements.length ? ` Suggested: ${h.replacements.join(' / ')}.` : ''} [LanguageTool ${h.rule}]`, severity: 'low', source: h.url, evidence: h.context.trim(), rule: h.rule });
  }

  const uniq = new Map<string, Finding>();
  for (const f of findings) {
    const k = f.check === 'grammar' ? `${f.title}|${f.source}` : f.title;
    const prev = uniq.get(k);
    if (!prev) uniq.set(k, { ...f, also_on: [] as string[] });
    else if (f.source && f.source !== prev.source && !(prev.also_on as string[]).includes(f.source)) (prev.also_on as string[]).push(f.source);
  }
  return {
    findings: [...uniq.values()],
    notes: {
      redirects, certs, linkStatus, waStatus, telStatus, mailStatus, forms,
      sitePhones: Object.fromEntries([...sitePhones].map(([k, v]) => [fmtPhone(k), [...v]])),
      divePhones: [...divePhones].map(fmtPhone), mapsPhones: [...mapsPhones].map(fmtPhone),
      emails: sites.map((s) => ({ host: s.host, emails: (s as any).emails ?? [] })),
      pages_crawled: crawledCount, http_total: ctx.meter.http.calls,
      sites: sites.map((s) => ({ domain: s.domain, host: s.host, aliases: s.aliases, pages: s.pages.map((p) => ({ url: p.finalUrl, status: p.status, ms: p.ms, kb: Math.round(p.bytes / 1024) })) })),
      languagetool: { requests: ctx.meter.other.languagetool, bytes: ctx.meter.other.languagetool_bytes, raw_matches: hits.length, kept: hits.filter((h) => h.kept).length, filtered: hits.filter((h) => !h.kept).map((h) => ({ word: h.word, rule: h.rule, reason: h.reason, url: h.url })) },
    },
  };
}
