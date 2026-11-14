// Competitor Official Site Analysis (owner, 2026-11-14). Test stage: the output is a file (markdown + raw JSON) for the
// owner to review. No page, no report table, no queue yet.
//
// Input: country + industry, and optionally the client's own website (added as the 17th site when it is not already
// one of the 16).
//  1. ChatGPT (myworker /api/chat), JSON answers read loosely:
//     a. the top 10 competitors in the country;
//     b. the top 2 in each of up to 3 neighbouring countries (ChatGPT names the neighbours): up to 6.
//  2. Each site is read by myworker only (no paid API): homepage HTML (+ up to 2 of its own stylesheets) for the
//     design facts, homepage + up to 4 key pages as markdown, the sitemap page count, one desktop screenshot.
//  3. gpt-6.1-terra on lingsuan, 2 calls per site: (a) design + content volume + functions, with the screenshot;
//     (b) marketing language.
//  4. One terra call over every site's result: findings, summary, conclusion. The comparison table is built by code
//     from the per-site answers.
//
// Nothing here stops the report. A site that cannot be read, a ChatGPT list that cannot be parsed, a screenshot terra
// refuses or a terra call that fails is written into the report with its reason, and the rest goes on.
import { chat as workerChat, fetchPage as workerFetch, shot as workerShot } from './divedeeper/v21/myworker.ts';
import { askLanes, type Lane } from './v21/judge.ts';
import type { ChatMessage } from './v21/cloud.ts';

// ------------------------------------------------------------------ types

export type Input = { country: string; industry: string; own_website?: string | null; own_name?: string | null };
export type Competitor = { name: string; website: string; domain: string; country: string; source: 'home' | 'neighbour' | 'own'; own: boolean };
export type Page = { url: string; kind: string; status: number | null; chars: number; text: string; trimmed: boolean; error: string | null };
export type Facts = Record<string, unknown>;
export type SiteRead = {
  final_url: string | null; status: number | null; error: string | null;
  facts: Facts; pages: Page[];
  sitemap: { pages: number | null; source: string | null; note: string };
  screenshot: { ok: boolean; image: string | null; error: string | null };
};
export type Call = { ok: boolean; data: any; raw: string | null; error: string | null; tries: number; note?: string };
export type SiteResult = { competitor: Competitor; read: SiteRead; design: Call; marketing: Call };
export type ListResult = { competitors: Competitor[]; neighbours: string[]; notes: string[]; raw: { home: string | null; neighbours: string | null } };
export type Report = {
  input: Input; started_at: string; finished_at: string; notes: string[];
  list: ListResult; sites: SiteResult[]; final: Call;
};

type FetchOpts = { format: 'markdown' | 'html'; keepErrors?: boolean };
type Fetched = { finalUrl: string; status: number; content: string } | { error: string };
export type Deps = {
  chat: (prompt: string) => Promise<{ answer: string } | { error: string }>;
  fetchPage: (url: string, ask: FetchOpts) => Promise<Fetched>;
  shot: (url: string) => Promise<{ image?: string | null; blocked?: boolean; status?: number } | { error: string }>;
  /** One terra call; resolves the answer text. Throws on failure. */
  ask: (messages: unknown[]) => Promise<string>;
  sleep: (ms: number) => Promise<void>;
  log: (msg: string) => void;
};

export const HOME_MAX = 10;
export const PER_NEIGHBOUR = 2;
export const NEIGHBOURS_MAX = 3;
const KEY_PAGES = 4;
const PAGE_CHARS = 15_000;
const CONCURRENCY = 4;

// ------------------------------------------------------------------ small guards

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '');
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const strs = (v: unknown): string[] => arr(v).map((x) => (typeof x === 'object' && x ? Object.values(x).map(str).filter(Boolean).join(': ') : str(x))).filter(Boolean);
const reason = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 300);

/** The first JSON object in a reply (code fences and chatter around it are ignored). Null when there is none. */
export function readJson(text: unknown): any {
  const s = String(text ?? '').replace(/```(?:json)?/gi, '');
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(s.slice(start, end + 1)); } catch { return null; }
}

/** https://www.Acme.com/x -> { url: 'https://www.acme.com/x', domain: 'acme.com' }. Null for something that is not a web address. */
export function site(raw: unknown): { url: string; domain: string } | null {
  let s = str(raw);
  if (!s) return null;
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s.replace(/^\/+/, '');
  try {
    const u = new URL(s);
    if (!u.hostname.includes('.')) return null;
    return { url: u.origin + (u.pathname === '/' ? '' : u.pathname), domain: u.hostname.toLowerCase().replace(/^www\./, '') };
  } catch { return null; }
}

async function mapLimit<T, R>(items: T[], n: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i]!, i); }
  }));
  return out;
}

// ------------------------------------------------------------------ 1. the list (ChatGPT)

export function homePrompt(input: Input): string {
  return `List the top ${HOME_MAX} competitors in the ${input.industry} industry in ${input.country}: the best-known companies `
    + `selling ${input.industry} to customers in ${input.country}, each with its official website.`
    + `\n\nAnswer with JSON only, no other text, in exactly this shape:\n`
    + `{"country": "${input.country}", "companies": [{"name": "Company name", "website": "https://..."}]}`;
}

export function neighbourPrompt(input: Input): string {
  return `For the ${input.industry} industry: pick up to ${NEIGHBOURS_MAX} neighbouring countries of ${input.country} `
    + `(countries that share a border with it or are its closest neighbours). For each of them, list its top ${PER_NEIGHBOUR} `
    + `${input.industry} companies, each with its official website.`
    + `\n\nAnswer with JSON only, no other text, in exactly this shape:\n`
    + `{"countries": [{"country": "Country name", "companies": [{"name": "Company name", "website": "https://..."}]}]}`;
}

async function askList(prompt: string, what: string, deps: Deps, notes: string[]): Promise<{ json: any; raw: string | null }> {
  let raw: string | null = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const r = await deps.chat(prompt).catch((e) => ({ error: reason(e) }));
    if ('answer' in r) {
      raw = r.answer;
      const json = readJson(r.answer);
      if (json) return { json, raw };
      notes.push(`ChatGPT ${what} try ${attempt}: the answer had no readable JSON`);
    } else notes.push(`ChatGPT ${what} try ${attempt}: ${r.error}`);
    deps.log(`ChatGPT ${what} try ${attempt} gave no list`);
    if (attempt < 3) await deps.sleep(attempt * 10_000);
  }
  return { json: null, raw };
}

export async function buildList(input: Input, deps: Deps): Promise<ListResult> {
  const notes: string[] = [];
  const seen = new Set<string>();
  const competitors: Competitor[] = [];
  const own = site(input.own_website);
  const add = (name: unknown, website: unknown, country: string, source: Competitor['source']) => {
    const s = site(website);
    if (!s) { notes.push(`${source} list: "${str(name) || '?'}" has no usable website ("${str(website)}"), left out`); return false; }
    if (seen.has(s.domain)) return false;
    seen.add(s.domain);
    competitors.push({ name: str(name) || s.domain, website: s.url, domain: s.domain, country, source, own: Boolean(own && own.domain === s.domain) });
    return true;
  };

  const home = await askList(homePrompt(input), 'home-country list', deps, notes);
  const homeRows = arr(home.json?.companies);
  let homeCount = 0;
  for (const c of homeRows) {
    if (homeCount >= HOME_MAX) { notes.push(`ChatGPT gave ${homeRows.length} home-country companies; the first ${HOME_MAX} usable ones are kept`); break; }
    if (add((c as any)?.name, (c as any)?.website, input.country, 'home')) homeCount++;
  }
  if (homeCount < HOME_MAX) notes.push(`only ${homeCount} of ${HOME_MAX} home-country competitors found`);

  const nb = await askList(neighbourPrompt(input), 'neighbour list', deps, notes);
  const neighbours: string[] = [];
  for (const block of arr(nb.json?.countries).slice(0, NEIGHBOURS_MAX)) {
    const country = str((block as any)?.country) || 'unknown country';
    neighbours.push(country);
    let n = 0;
    for (const c of arr((block as any)?.companies)) {
      if (n >= PER_NEIGHBOUR) break;
      if (add((c as any)?.name, (c as any)?.website, country, 'neighbour')) n++;
    }
    if (n < PER_NEIGHBOUR) notes.push(`${country}: only ${n} of ${PER_NEIGHBOUR} competitors found`);
  }
  if (arr(nb.json?.countries).length > NEIGHBOURS_MAX) notes.push(`ChatGPT named more than ${NEIGHBOURS_MAX} neighbouring countries; the first ${NEIGHBOURS_MAX} are kept`);

  if (own) {
    const found = competitors.find((c) => c.domain === own.domain);
    if (found) notes.push(`the own website ${own.domain} is already in the list (${found.name}); it is marked as own, no 17th site added`);
    else competitors.push({ name: str(input.own_name) || own.domain, website: own.url, domain: own.domain, country: input.country, source: 'own', own: true });
  }
  return { competitors, neighbours, notes, raw: { home: home.raw, neighbours: nb.raw } };
}

// ------------------------------------------------------------------ 2. reading a site (myworker)

const PLATFORMS: [string, RegExp][] = [
  ['WordPress', /wp-content|wp-includes/i], ['Elementor', /elementor/i], ['Divi', /et_pb_|divi/i], ['WooCommerce', /woocommerce/i],
  ['Wix', /wixstatic|wix\.com|_wixCss/i], ['Shopify', /cdn\.shopify|shopify\.theme/i], ['Squarespace', /squarespace/i],
  ['Webflow', /webflow/i], ['Framer', /framerusercontent|framer\.com/i], ['Joomla', /joomla/i], ['Drupal', /drupal/i],
  ['Next.js', /__NEXT_DATA__|\/_next\//], ['Nuxt', /__NUXT__|\/_nuxt\//], ['Gatsby', /___gatsby/], ['Bootstrap', /bootstrap(?:\.min)?\.(?:css|js)/i],
  ['Tailwind', /tailwind/i], ['jQuery', /jquery/i], ['Google Sites', /sites\.google\.com/i],
];

const FUNCTIONS: [string, RegExp][] = [
  ['login / customer portal', /\b(log ?in|sign ?in|my account|member login|customer portal)\b/i],
  ['register / sign up', /\b(register|sign ?up|create an account)\b/i],
  ['shop / cart / checkout', /\b(add to cart|shopping cart|checkout|cart)\b|woocommerce|cdn\.shopify/i],
  ['request a quote', /\b(get a quote|request (?:a )?quot\w*|free quot\w*|quotation|get quote)\b/i],
  ['booking / appointment', /\b(book now|booking|appointment|schedule a (?:call|visit|consultation))\b/i],
  ['calculator / estimator', /\b(calculator|estimator|estimate your|savings calculator)\b/i],
  ['WhatsApp', /wa\.me\/|api\.whatsapp\.com|whatsapp/i],
  ['live chat widget', /tawk\.to|intercom|crisp\.chat|livechatinc|zendesk|tidio|hs-scripts|hubspot|messenger|chatwoot|freshchat/i],
  ['site search', /type=["']search["']|role=["']search["']/i],
  ['newsletter signup', /\b(newsletter|subscribe)\b/i],
  ['blog / news', /\b(blog|news|articles|insights)\b/i],
  ['careers', /\b(careers|join us|we'?re hiring|vacanc\w+)\b/i],
  ['downloadable brochure / catalogue', /\.pdf\b|\b(brochure|catalogue|catalog|download)\b/i],
  ['map / location', /google\.com\/maps|maps\.google|goo\.gl\/maps/i],
  ['video', /youtube\.com\/embed|player\.vimeo|<video\b/i],
];

const SOCIAL: [string, RegExp][] = [
  ['Facebook', /facebook\.com\//i], ['Instagram', /instagram\.com\//i], ['LinkedIn', /linkedin\.com\//i], ['YouTube', /youtube\.com\//i],
  ['TikTok', /tiktok\.com\//i], ['X / Twitter', /(?:twitter|x)\.com\//i], ['Xiaohongshu', /xiaohongshu\.com/i],
];

const meta = (html: string, name: string) =>
  str(html.match(new RegExp(`<meta[^>]+(?:name|property)=["']${name}["'][^>]*content=["']([^"']*)`, 'i'))?.[1]
    ?? html.match(new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:name|property)=["']${name}["']`, 'i'))?.[1]);

function topCounts(list: string[], n: number): { value: string; count: number }[] {
  const m = new Map<string, number>();
  for (const v of list) m.set(v, (m.get(v) ?? 0) + 1);
  return [...m].sort((a, b) => b[1] - a[1]).slice(0, n).map(([value, count]) => ({ value, count }));
}

/** Plain facts read by code from the homepage HTML (+ its CSS). Mechanical only; the judging is terra's. */
export function htmlFacts(html: string, css: string, baseUrl: string): Facts {
  const h = String(html ?? '');
  const styles = [...h.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]).join('\n')
    + '\n' + [...h.matchAll(/\sstyle=["']([^"']*)["']/gi)].map((m) => m[1]).join(';') + '\n' + String(css ?? '');
  const fonts = [...styles.matchAll(/font-family\s*:\s*([^;}"]+)/gi)].map((m) => m[1]!.split(',')[0]!.replace(/["']/g, '').trim()).filter((f) => f && !/^(inherit|initial|var\()/i.test(f));
  const googleFonts = [...h.matchAll(/fonts\.googleapis\.com\/css2?\?([^"'\s>]+)/gi)].flatMap((m) => [...m[1]!.matchAll(/family=([^&:]+)/g)].map((f) => decodeURIComponent(f[1]!.replace(/\+/g, ' '))));
  const colours = [...styles.matchAll(/#([0-9a-f]{6}|[0-9a-f]{3})\b/gi)].map((m) => {
    const x = m[1]!.toLowerCase();
    return '#' + (x.length === 3 ? x.split('').map((c) => c + c).join('') : x);
  });
  const years = [...h.matchAll(/(?:©|&copy;|copyright)\s*(?:\d{4}\s*(?:-|–|&ndash;)\s*)?(\d{4})/gi)].map((m) => Number(m[1])).filter((y) => y > 1990 && y < 2100);
  let host = '';
  try { host = new URL(baseUrl).hostname.replace(/^www\./, ''); } catch { /* left empty */ }
  const links = [...h.matchAll(/<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi)].map((m) => ({ href: m[1]!, text: m[2]!.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) }));
  const internal: { url: string; text: string }[] = [];
  const seen = new Set<string>();
  for (const l of links) {
    try {
      const u = new URL(l.href, baseUrl);
      if (!/^https?:$/.test(u.protocol) || u.hostname.replace(/^www\./, '') !== host) continue;
      const key = u.origin + u.pathname.replace(/\/+$/, '');
      if (seen.has(key) || /\.(jpg|jpeg|png|gif|webp|svg|pdf|zip|mp4)$/i.test(u.pathname)) continue;
      seen.add(key);
      internal.push({ url: key || u.origin, text: l.text });
    } catch { /* not a link */ }
  }
  const text = h.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ');
  return {
    title: str(h.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]).replace(/\s+/g, ' ').slice(0, 200) || null,
    meta_description: meta(h, 'description').slice(0, 300) || null,
    generator: meta(h, 'generator') || null,
    theme_color: meta(h, 'theme-color') || null,
    html_lang: str(h.match(/<html[^>]*\blang=["']([^"']+)/i)?.[1]) || null,
    mobile_viewport: /<meta[^>]+name=["']viewport["']/i.test(h),
    languages_offered: [...new Set([...h.matchAll(/hreflang=["']([^"']+)/gi)].map((m) => m[1]))].slice(0, 12),
    platform_signs: PLATFORMS.filter(([, re]) => re.test(h)).map(([n]) => n),
    fonts: topCounts([...googleFonts, ...fonts], 8),
    colours: topCounts(colours, 12),
    latest_copyright_year: years.length ? Math.max(...years) : null,
    function_signs: FUNCTIONS.filter(([, re]) => re.test(text)).map(([n]) => n),
    social_links: SOCIAL.filter(([, re]) => re.test(h)).map(([n]) => n),
    forms: (h.match(/<form\b/gi) ?? []).length,
    form_fields: [...new Set([...h.matchAll(/<(?:input|textarea|select)\b[^>]*\bname=["']([^"']+)/gi)].map((m) => m[1]))].slice(0, 25),
    images: (h.match(/<img\b/gi) ?? []).length,
    scripts: (h.match(/<script\b/gi) ?? []).length,
    html_chars: h.length,
    internal_links: internal.length,
    nav_links: internal.slice(0, 40),
  };
}

const PAGE_KINDS: [string, RegExp][] = [
  ['about', /about|company|who-we-are|our-story|profile|tentang|关于/i],
  ['why us', /why|advantage|difference|benefit|kenapa|mengapa/i],
  ['services', /service|solution|what-we-do|perkhidmatan|服务/i],
  ['products', /product|shop|range|catalog|produk|产品/i],
  ['projects', /project|portfolio|case|work|client|testimonial|review/i],
];

/** Up to KEY_PAGES internal pages, one per kind, for the marketing read. Mechanical: link address and text only. */
export function keyPages(links: { url: string; text: string }[]): { url: string; kind: string }[] {
  const out: { url: string; kind: string }[] = [];
  const used = new Set<string>();
  for (const [kind, re] of PAGE_KINDS) {
    if (out.length >= KEY_PAGES) break;
    const hit = links.find((l) => !used.has(l.url) && (re.test(new URL(l.url).pathname) || re.test(l.text)) && new URL(l.url).pathname.length > 1);
    if (hit) { used.add(hit.url); out.push({ url: hit.url, kind }); }
  }
  for (const l of links) {
    if (out.length >= KEY_PAGES) break;
    if (!used.has(l.url) && new URL(l.url).pathname.length > 1 && !/contact|login|cart|privacy|terms|policy/i.test(l.url)) { used.add(l.url); out.push({ url: l.url, kind: 'other' }); }
  }
  return out;
}

async function get(deps: Deps, url: string, format: FetchOpts['format']): Promise<{ status: number | null; content: string; finalUrl: string | null; error: string | null }> {
  try {
    const r = await deps.fetchPage(url, { format, keepErrors: true });
    if ('error' in r) return { status: null, content: '', finalUrl: null, error: r.error };
    return { status: r.status, content: String(r.content ?? ''), finalUrl: r.finalUrl ?? url, error: r.status >= 400 ? `HTTP ${r.status}` : null };
  } catch (e) { return { status: null, content: '', finalUrl: null, error: reason(e) }; }
}

async function sitemapCount(origin: string, deps: Deps): Promise<SiteRead['sitemap']> {
  const tried: string[] = [];
  const robots = await get(deps, origin + '/robots.txt', 'html');
  const listed = [...robots.content.matchAll(/^\s*sitemap:\s*(\S+)/gim)].map((m) => m[1]!);
  for (const url of [...new Set([...listed, origin + '/sitemap.xml', origin + '/sitemap_index.xml', origin + '/wp-sitemap.xml'])].slice(0, 5)) {
    tried.push(url);
    const r = await get(deps, url, 'html');
    const locs = [...r.content.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1]!);
    if (!locs.length) continue;
    if (!/<sitemapindex/i.test(r.content)) return { pages: locs.length, source: url, note: `${locs.length} addresses in ${url}` };
    const children = locs.slice(0, 10);
    let total = 0;
    let read = 0;
    for (const child of children) {
      const c = await get(deps, child, 'html');
      const n = (c.content.match(/<loc>/gi) ?? []).length;
      if (n) { total += n; read++; }
    }
    return { pages: total || null, source: url, note: `${total} addresses in ${read} of ${locs.length} child sitemaps${locs.length > children.length ? ` (first ${children.length} read)` : ''}` };
  }
  return { pages: null, source: null, note: `no sitemap found (tried ${tried.join(', ') || 'none'})` };
}

function asImage(raw: unknown): string | null {
  const s = str(raw);
  if (!s) return null;
  if (s.startsWith('data:image/')) return s;
  if (/^https?:\/\//.test(s)) return s;
  if (s.length > 500 && /^[A-Za-z0-9+/=\s]+$/.test(s.slice(0, 500))) return 'data:image/jpeg;base64,' + s.replace(/\s+/g, '');
  return null;
}

export async function readSite(c: Competitor, deps: Deps): Promise<SiteRead> {
  const out: SiteRead = { final_url: null, status: null, error: null, facts: {}, pages: [], sitemap: { pages: null, source: null, note: 'not read' }, screenshot: { ok: false, image: null, error: 'not taken' } };
  const html = await get(deps, c.website, 'html');
  out.final_url = html.finalUrl;
  out.status = html.status;
  out.error = html.error;
  const base = html.finalUrl || c.website;
  let origin = c.website;
  try { origin = new URL(base).origin; } catch { /* keep the given address */ }

  // Up to 2 of the site's own stylesheets: fonts and colours often live only there.
  let css = '';
  try {
    const sheets = [...html.content.matchAll(/<link\b[^>]*rel=["']stylesheet["'][^>]*>/gi)]
      .map((m) => m[0].match(/href=["']([^"']+)/i)?.[1]).filter(Boolean)
      .map((href) => new URL(href!, base)).filter((u) => u.origin === origin).slice(0, 2);
    for (const u of sheets) css += '\n' + (await get(deps, u.href, 'html')).content.slice(0, 400_000);
  } catch (e) { deps.log(`${c.domain}: stylesheets not read: ${reason(e)}`); }
  out.facts = htmlFacts(html.content, css, base);

  const [shotResult, sitemap] = await Promise.all([
    deps.shot(base).catch((e) => ({ error: reason(e) })),
    sitemapCount(origin, deps).catch((e) => ({ pages: null, source: null, note: `sitemap not read: ${reason(e)}` })),
  ]);
  out.sitemap = sitemap;
  if ('error' in shotResult) out.screenshot = { ok: false, image: null, error: shotResult.error };
  else {
    const image = asImage(shotResult.image);
    out.screenshot = image ? { ok: true, image, error: shotResult.blocked ? 'the worker says the page looked blocked; terra judges what the picture shows' : null }
      : { ok: false, image: null, error: shotResult.blocked ? 'the site blocked the screenshot' : 'the worker returned no image' };
  }

  const wanted = [{ url: base, kind: 'home' }, ...keyPages((out.facts.nav_links as { url: string; text: string }[]) ?? [])];
  for (const p of wanted) {
    const r = await get(deps, p.url, 'markdown');
    const text = r.content.trim();
    out.pages.push({ url: p.url, kind: p.kind, status: r.status, chars: text.length, text: text.slice(0, PAGE_CHARS), trimmed: text.length > PAGE_CHARS, error: r.error ?? (text ? null : 'empty page') });
  }
  return out;
}

// ------------------------------------------------------------------ 3 + 4. terra

/** gpt-6.1-terra on lingsuan. The key is a hub variable (never in git); BENCH_LINGSUAN_KEY is the older name of it. */
export function terraLane(env: NodeJS.ProcessEnv = process.env): Lane | null {
  const key = (env.LINGSUAN_KEY ?? env.BENCH_LINGSUAN_KEY ?? '').trim();
  if (!key) return null;
  return { label: 'lingsuan terra', url: (env.LINGSUAN_URL ?? 'https://api.lingsuan.si/v1').trim().replace(/\/+$/, ''), key, model: (env.COMPETITOR_SITES_MODEL ?? 'gpt-6.1-terra').trim() };
}

/** One terra call that must give a JSON object. Failed calls are tried again (3 tries); slow ones are never killed (askLanes). */
async function terra(messages: unknown[], what: string, deps: Deps): Promise<Call> {
  const errors: string[] = [];
  let raw: string | null = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      raw = await deps.ask(messages);
      const data = readJson(raw);
      if (data) return { ok: true, data, raw, error: errors.length ? `earlier tries: ${errors.join(' | ')}` : null, tries: attempt };
      errors.push(`try ${attempt}: no readable JSON in the answer`);
    } catch (e) { errors.push(`try ${attempt}: ${reason(e)}`); }
    deps.log(`terra ${what}: ${errors.at(-1)}`);
    if (attempt < 3) await deps.sleep(attempt * 30_000);
  }
  return { ok: false, data: null, raw, error: errors.join(' | '), tries: 3 };
}

const SYSTEM = 'You review company websites for a competitor study. Judge only what the screenshot, the page facts and the page text show; '
  + 'when something cannot be seen, say so instead of guessing. Write plain English. Return one JSON object only.';

function who(c: Competitor, input: Input): string {
  return `Company: ${c.name} (${c.country}), website ${c.website}. Industry: ${input.industry}.${c.own ? ' This is the client\'s own website.' : ''}`;
}

export function designPrompt(c: Competitor, read: SiteRead, input: Input, withShot: boolean): string {
  const { nav_links: _nav, ...facts } = read.facts as Record<string, unknown>;
  const home = read.pages.find((p) => p.kind === 'home');
  return `${who(c, input)}

${withShot ? 'The image is a screenshot of the homepage in a desktop browser.' : `There is no screenshot (${read.screenshot.error ?? 'not taken'}). Judge the design from the facts only and say so in "based_on".`}

PAGE FACTS (read by code from the homepage HTML and its stylesheets; colours and fonts are counted by how often the CSS uses them):
${JSON.stringify(facts, null, 1)}

SITEMAP: ${read.sitemap.pages ?? 'unknown'} pages (${read.sitemap.note}).
PAGES READ: ${read.pages.map((p) => `${p.kind} ${p.url} (${p.chars} chars${p.error ? `, ${p.error}` : ''})`).join('; ') || 'none'}.

HOMEPAGE TEXT (markdown${home?.trimmed ? `, first ${PAGE_CHARS} characters` : ''}):
${home?.text || '(empty: the homepage text could not be read)'}

Return this JSON:
{
 "design": {
  "summary": "2-4 sentences on the design language: layout, imagery, spacing, overall feel",
  "colour_theme": ["the main colours, each as a name and hex where known, e.g. 'navy #0b2545'"],
  "fonts": ["font families used"],
  "style_words": ["3 to 6 words that describe the style"],
  "modernity_score": 1-10 (10 = fresh and current, 1 = clearly outdated),
  "modernity_verdict": "modern" | "mostly modern" | "dated" | "outdated",
  "modernity_reasons": ["concrete signs that support the score"]
 },
 "content_volume": {
  "level": "very light" | "light" | "medium" | "rich" | "very rich",
  "estimated_pages": number or null,
  "summary": "1-2 sentences: how much content the site has and what kind"
 },
 "functions": [{"name": "e.g. Request a quote", "evidence": "where it was seen"}],
 "based_on": "screenshot + facts" | "facts only"
}`;
}

export function marketingPrompt(c: Competitor, read: SiteRead, input: Input): string {
  const pages = read.pages.filter((p) => p.text).map((p) => `--- ${p.kind}: ${p.url}${p.trimmed ? ` (first ${PAGE_CHARS} characters)` : ''}\n${p.text}`).join('\n\n');
  return `${who(c, input)}

Read what this company says about itself on its own website and how it sells its products or services.

PAGES (markdown):
${pages || '(no page text could be read; say so in "positioning" and leave the rest empty)'}

Return this JSON:
{
 "positioning": "one sentence: who they say they are and for whom",
 "headline_message": "their main promise, short, in their own words where possible",
 "why_choose_us": ["each reason they give for choosing them"],
 "selling_approach": "2-3 sentences on how they sell: price, quality, trust, speed, expertise, scale, service, emotion...",
 "proof_used": ["certifications, awards, client names, numbers, testimonials, years in business..."],
 "calls_to_action": ["the main calls to action"],
 "tone": "short description of the voice",
 "target_customers": ["who they speak to"],
 "key_phrases": ["up to 5 short phrases quoted from the site"],
 "site_language": "the language(s) the site is written in"
}`;
}

function compact(r: SiteResult): Record<string, unknown> {
  return {
    company: r.competitor.name, country: r.competitor.country, website: r.competitor.website, own_site: r.competitor.own,
    read: r.read.error && !r.read.pages.some((p) => p.chars) ? `site could not be read: ${r.read.error}` : 'read',
    sitemap_pages: r.read.sitemap.pages,
    design_and_functions: r.design.ok ? r.design.data : `analysis failed: ${r.design.error}`,
    marketing: r.marketing.ok ? r.marketing.data : `analysis failed: ${r.marketing.error}`,
  };
}

export function finalPrompt(input: Input, sites: SiteResult[]): string {
  const own = sites.find((s) => s.competitor.own);
  return `Competitor study of official websites: ${input.industry} in ${input.country}, with the top competitors of its neighbouring countries.
${own ? `The client's own website is ${own.competitor.name} (${own.competitor.website}); compare it against the others.` : 'No client website was given.'}

Below is the analysis of each website (design, content volume, functions, marketing language). A site marked "could not be read" or "analysis failed" has no data; do not guess about it.

${JSON.stringify(sites.map(compact), null, 1)}

Compare them and return this JSON:
{
 "summary": "5-8 sentences: the overall picture",
 "design_findings": ["patterns and differences in design and how modern the sites look"],
 "content_findings": ["how much content they have and what kind"],
 "function_findings": ["which functions are common, rare or missing"],
 "marketing_findings": ["how they sell: common claims, different angles, proof used"],
 "home_vs_neighbours": "how the ${input.country} sites differ from the neighbouring countries' sites",
 "standouts": [{"company": "name", "why": "what it does best"}],
 "gaps_and_opportunities": ["what no one or few do well, that a company could use to stand out"],
 "own_site_vs_competitors": ${own ? '"where the client\'s site is ahead, level and behind, with the most important fixes"' : 'null'},
 "conclusion": "3-5 sentences"
}`;
}

async function analyseSite(c: Competitor, read: SiteRead, input: Input, deps: Deps): Promise<SiteResult> {
  const shotOn = read.screenshot.ok && Boolean(read.screenshot.image);
  const withImage = (text: string): unknown[] => [
    { role: 'system', content: SYSTEM },
    { role: 'user', content: [{ type: 'text', text }, { type: 'image_url', image_url: { url: read.screenshot.image } }] },
  ];
  const plain = (text: string): unknown[] => [{ role: 'system', content: SYSTEM }, { role: 'user', content: text }];

  const [design0, marketing] = await Promise.all([
    terra(shotOn ? withImage(designPrompt(c, read, input, true)) : plain(designPrompt(c, read, input, false)), `${c.domain} design`, deps),
    terra(plain(marketingPrompt(c, read, input)), `${c.domain} marketing`, deps),
  ]);
  let design = design0;
  // A screenshot terra will not take must not cost the design part: ask again from the facts only, and say so.
  if (!design.ok && shotOn) {
    deps.log(`${c.domain}: design with the screenshot failed, asking again from the facts only`);
    const again = await terra(plain(designPrompt(c, { ...read, screenshot: { ...read.screenshot, error: 'terra could not take the screenshot' } }, input, false)), `${c.domain} design (no screenshot)`, deps);
    design = { ...again, note: `the call with the screenshot failed (${design0.error}); this answer is from the facts only` };
  }
  return { competitor: c, read, design, marketing };
}

// ------------------------------------------------------------------ the run

export async function run(input: Input, deps: Deps): Promise<Report> {
  const started = new Date().toISOString();
  const notes: string[] = [];
  if (!terraLane()) notes.push('LINGSUAN_KEY is not set on the hub: every terra call fails and is marked as such');
  deps.log(`list: asking ChatGPT for ${input.industry} competitors in ${input.country} and its neighbours`);
  const list = await buildList(input, deps).catch((e) => {
    notes.push(`the competitor list failed: ${reason(e)}`);
    return { competitors: [], neighbours: [], notes: [], raw: { home: null, neighbours: null } } as ListResult;
  });
  deps.log(`list: ${list.competitors.length} sites (${list.competitors.map((c) => c.domain).join(', ')})`);

  const sites = await mapLimit(list.competitors, CONCURRENCY, async (c) => {
    deps.log(`${c.domain}: reading`);
    const read = await readSite(c, deps).catch((e): SiteRead => ({ final_url: null, status: null, error: `read failed: ${reason(e)}`, facts: {}, pages: [], sitemap: { pages: null, source: null, note: 'not read' }, screenshot: { ok: false, image: null, error: 'not taken' } }));
    deps.log(`${c.domain}: read (${read.pages.filter((p) => p.chars).length} pages, screenshot ${read.screenshot.ok ? 'yes' : 'no'}); analysing`);
    const result = await analyseSite(c, read, input, deps).catch((e): SiteResult => ({ competitor: c, read, design: { ok: false, data: null, raw: null, error: reason(e), tries: 0 }, marketing: { ok: false, data: null, raw: null, error: reason(e), tries: 0 } }));
    deps.log(`${c.domain}: done (design ${result.design.ok ? 'ok' : 'failed'}, marketing ${result.marketing.ok ? 'ok' : 'failed'})`);
    return result;
  });

  deps.log('final comparison: asking terra');
  const final = sites.length
    ? await terra([{ role: 'system', content: SYSTEM }, { role: 'user', content: finalPrompt(input, sites) }], 'final comparison', deps)
    : { ok: false, data: null, raw: null, error: 'no competitor sites to compare', tries: 0 };
  return { input, started_at: started, finished_at: new Date().toISOString(), notes, list, sites, final };
}

export function liveDeps(log: (msg: string) => void): Deps {
  return {
    chat: (prompt) => workerChat(prompt),
    fetchPage: (url, ask) => workerFetch(url, ask),
    shot: (url) => workerShot({ url, device: 'desktop' }),
    ask: async (messages) => {
      const lane = terraLane();
      if (!lane) throw new Error('LINGSUAN_KEY is not set on the hub');
      // askLanes sends messages as given; a user message with an image is the OpenAI content-parts form.
      const out = await askLanes(messages as ChatMessage[], { lanes: [lane], accept: (t) => { if (!readJson(t)) throw new Error('no JSON object in the answer'); } });
      return out.text;
    },
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    log,
  };
}

// ------------------------------------------------------------------ the file

const cell = (v: unknown) => str(v).replace(/\|/g, '/').replace(/\s+/g, ' ') || '-';
const bullets = (v: unknown, empty = '- (none)') => { const l = strs(v); return l.length ? l.map((x) => `- ${x}`).join('\n') : empty; };

export function toMarkdown(r: Report): string {
  const L: string[] = [];
  const f = r.final.ok ? r.final.data ?? {} : {};
  L.push(`# Competitor official site analysis: ${r.input.industry}, ${r.input.country}`, '');
  L.push(`Run ${r.started_at} to ${r.finished_at}. ${r.sites.length} sites: ${r.sites.filter((s) => s.competitor.source === 'home').length} in ${r.input.country}, `
    + `${r.sites.filter((s) => s.competitor.source === 'neighbour').length} from neighbouring countries (${r.list.neighbours.join(', ') || 'none named'})`
    + `${r.sites.some((s) => s.competitor.own) ? ', plus the own website' : ''}. Competitor list by ChatGPT; sites read by myworker; analysis by gpt-6.1-terra.`, '');
  const problems = [...r.notes, ...r.list.notes];
  if (problems.length) L.push('**Notes on this run**', '', ...problems.map((n) => `- ${n}`), '');

  L.push('## Comparison', '');
  L.push('| # | Company | Country | Modern (1-10) | Verdict | Content | Sitemap pages | Functions | Main selling point |', '|---|---|---|---|---|---|---|---|---|');
  r.sites.forEach((s, i) => {
    const d = s.design.ok ? s.design.data ?? {} : {};
    const m = s.marketing.ok ? s.marketing.data ?? {} : {};
    const unread = s.read.error && !s.read.pages.some((p) => p.chars);
    L.push(`| ${i + 1} | ${cell(s.competitor.name)}${s.competitor.own ? ' **(own)**' : ''} | ${cell(s.competitor.country)} | ${cell(d.design?.modernity_score)} | ${cell(unread ? 'site could not be read' : d.design?.modernity_verdict ?? (s.design.ok ? '' : 'analysis failed'))} | ${cell(d.content_volume?.level)} | ${cell(s.read.sitemap.pages)} | ${cell(strs(arr(d.functions).map((x: any) => x?.name ?? x)).join(', '))} | ${cell(m.headline_message ?? m.positioning ?? (s.marketing.ok ? '' : 'analysis failed'))} |`);
  });
  L.push('');

  L.push('## Summary', '', r.final.ok ? str(f.summary) || '(no summary given)' : `**The final comparison failed:** ${r.final.error}`, '');
  if (r.final.ok) {
    L.push('### Design', '', bullets(f.design_findings), '', '### Content volume', '', bullets(f.content_findings), '',
      '### Functions', '', bullets(f.function_findings), '', '### Marketing language', '', bullets(f.marketing_findings), '',
      `### ${r.input.country} vs neighbouring countries`, '', str(f.home_vs_neighbours) || '-', '',
      '### Standouts', '', bullets(f.standouts), '', '### Gaps and opportunities', '', bullets(f.gaps_and_opportunities), '');
    if (str(f.own_site_vs_competitors)) L.push('### Own website vs competitors', '', str(f.own_site_vs_competitors), '');
    L.push('## Conclusion', '', str(f.conclusion) || '-', '');
  }

  L.push('## Each website', '');
  r.sites.forEach((s, i) => {
    const c = s.competitor;
    const d = s.design.ok ? s.design.data ?? {} : {};
    const m = s.marketing.ok ? s.marketing.data ?? {} : {};
    L.push(`### ${i + 1}. ${c.name}${c.own ? ' (own website)' : ''}: ${c.country}`, '', `${c.website}${s.read.final_url && s.read.final_url !== c.website ? ` (opened as ${s.read.final_url})` : ''}`, '');
    const read = [`HTTP ${s.read.status ?? '-'}`, `${s.read.pages.filter((p) => p.chars).length} of ${s.read.pages.length} pages read`, `screenshot ${s.read.screenshot.ok ? 'taken' : `not taken (${s.read.screenshot.error})`}`, `sitemap: ${s.read.sitemap.note}`];
    if (s.read.error) read.unshift(`**read problem: ${s.read.error}**`);
    L.push(`*Read:* ${read.join('; ')}.`, '');

    L.push('**1. Design**', '');
    if (s.design.ok) {
      if (s.design.note) L.push(`*${s.design.note}*`, '');
      L.push(str(d.design?.summary) || '-', '',
        `- Colours: ${strs(d.design?.colour_theme).join(', ') || '-'}`,
        `- Fonts: ${strs(d.design?.fonts).join(', ') || '-'}`,
        `- Style: ${strs(d.design?.style_words).join(', ') || '-'}`,
        `- Modern: **${str(d.design?.modernity_score) || '?'}/10, ${str(d.design?.modernity_verdict) || '?'}** (${str(d.based_on) || 'basis not given'})`,
        ...strs(d.design?.modernity_reasons).map((x) => `  - ${x}`), '');
      L.push('**2. Content volume**', '', `${str(d.content_volume?.level) || '?'}${d.content_volume?.estimated_pages ? `, about ${str(d.content_volume.estimated_pages)} pages` : ''}. ${str(d.content_volume?.summary)}`, '');
      L.push('**3. Functions**', '', bullets(arr(d.functions).map((x: any) => (typeof x === 'object' && x ? `${str(x.name)}${str(x.evidence) ? ` (${str(x.evidence)})` : ''}` : str(x)))), '');
    } else L.push(`**Design, content and functions analysis failed:** ${s.design.error}`, '');

    L.push('**4. Marketing language**', '');
    if (s.marketing.ok) {
      L.push(`- Positioning: ${str(m.positioning) || '-'}`, `- Headline message: ${str(m.headline_message) || '-'}`, `- Selling approach: ${str(m.selling_approach) || '-'}`,
        `- Tone: ${str(m.tone) || '-'}`, `- Target customers: ${strs(m.target_customers).join(', ') || '-'}`, `- Site language: ${str(m.site_language) || '-'}`,
        '', '*Why choose us:*', bullets(m.why_choose_us), '', '*Proof used:*', bullets(m.proof_used), '',
        '*Calls to action:*', bullets(m.calls_to_action), '', '*Key phrases:*', bullets(strs(m.key_phrases).map((x) => `"${x}"`)), '');
    } else L.push(`**Marketing analysis failed:** ${s.marketing.error}`, '');
  });
  return L.join('\n');
}

/** The report without screenshots (they are large); each site keeps whether one was taken. */
export function withoutImages(r: Report): Report {
  return { ...r, sites: r.sites.map((s) => ({ ...s, read: { ...s.read, screenshot: { ...s.read.screenshot, image: s.read.screenshot.image ? `(${s.read.screenshot.image.length} chars, not kept here)` : null } } })) };
}
