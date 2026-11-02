// E / maps — customer feedback from Google Maps reviews (round 3).
//
// For each of the company's Google Maps listings (from H-maps' cached listings, else one
// search_maps), pull reviews with scraper.tech `reviews`, then report:
//   - per-listing coverage, reply rate, and what period the sample covers;
//   - every 1–3★ review without an owner reply;
//   - the tone of owner replies (helpful / defensive / templated / none);
//   - the rating trend, per listing, pointed at that listing;
//   - review bursts against the listing's own baseline rate, and the same account
//     reviewing several of the company's listings;
//   - recurring praise and complaint themes, and the staff customers name;
//   - whether good reviews are reused on the official website (phrase and reviewer-name
//     match, plus review-widget detection: Trustindex, Elfsight, Widget for Google
//     Reviews, EmbedSocial, SociableKit, ...).
//
// What the reviews API can do (measured, see E-results.md):
//   - 5 reviews per call whatever `limit` says;
//   - only sort "newest" returns a cursor; "lowest" and the default (relevance, no sort)
//     return one page of 5 and cursor null;
//   - `review_count` is null in its payload; reply dates do not exist.
// So a big listing cannot be sampled evenly across time. The sample is stratified:
//   the 5 lowest-rated (catches negatives from any year), the 5 most relevant (what a
//   customer sees first, spread across years), and the newest pages (recent period).
// Small listings are pulled first and get their share of the budget before the biggest.
//
// Budget: E_MAPS_BUDGET (default 10) fresh `reviews` calls per run. With E_PAGE_CACHE=1,
// a page already fetched in an earlier run (same business_id, sort and cursor, younger
// than E_PAGE_CACHE_MAX_H hours, default 96) is reused from out/E-maps-*.json,
// out/round2/E-maps-*.json or E_PAGE_CACHE_EXTRA (a JSON array of pages) at no cost.
//
// Gotcha: lib.ts's ctx.maps() rejects every `reviews` answer, because that payload has
// no `status: "ok"` field. This file carries its own caller and bumps ctx.meter.maps.
import fs from 'node:fs';
import path from 'node:path';
import { OUT, type Ctx, type Finding } from '../lib.ts';
import * as core from '../../core/index.ts';

const MAPS_BUDGET = Number(process.env.E_MAPS_BUDGET ?? 10);
const NEWEST_MAX_PAGES = Number(process.env.E_NEWEST_MAX_PAGES ?? 12); // for listings too big to pull whole
const CACHE_ON = process.env.E_PAGE_CACHE === '1';
const CACHE_MAX_MS = Number(process.env.E_PAGE_CACHE_MAX_H ?? 96) * 3600_000;
const PAGE = 5; // rows per call, measured

const norm = (s: string) => s.toLowerCase().replace(/sdn\.?\s*bhd\.?|berhad|plt|enterprise|\(.*?\)/g, '').replace(/[^a-z0-9一-鿿]+/g, ' ').trim();
const host = (u: string | null | undefined) => {
  try { return u ? new URL(u.startsWith('http') ? u : 'https://' + u).hostname.replace(/^www\./, '') : ''; } catch { return ''; }
};
const words = (s: string) => s.toLowerCase().replace(/[^a-z0-9一-鿿]+/g, ' ').trim().split(' ').filter(Boolean);
const bizIdFromLink = (link: string | null | undefined) => String(link ?? '').match(/!1s(0x[0-9a-f]+:0x[0-9a-f]+)/i)?.[1] ?? null;
const day = (ts: number) => new Date(ts).toISOString().slice(0, 10);
const half = (ts: number) => { const d = new Date(ts); return `${d.getUTCFullYear()}-H${d.getUTCMonth() < 6 ? 1 : 2}`; };
const clip = (s: string, n = 140) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
const short = (name: string) => name.replace(/^.*\(\s*(.*?)\s*\)\s*$/, '$1') || name;

type Listing = { name: string; address: string | null; rating: number | null; reviews: number | null; business_id: string; place_link: string | null; website?: string | null };
type Review = {
  listing: string; id: string; stars: number; ts: number; date: string; author: string; author_id: string | null; text: string; original: string | null;
  reply: string | null; link: string | null; strata: string[];
};
type Page = { listing: string; business_id: string; sort: string; cursor_in: string | null; cursor_out: string | null; rows: any[]; fetched_at: string | null; from_cache?: boolean };

// ---------- the reviews API, with an optional page cache ----------

async function reviewsCall(ctx: Ctx, args: Record<string, string>): Promise<any> {
  ctx.meter.maps.calls++;
  ctx.meter.maps.byTool.reviews = (ctx.meter.maps.byTool.reviews ?? 0) + 1;
  try {
    const data = await core.maps.call('reviews', { country: 'my', ...args }, { log: ctx.meter.calls });
    if (data?.data) return data;
    ctx.warn(`maps reviews: ${JSON.stringify(data).slice(0, 200)}`);
  } catch (e) {
    ctx.warn(`maps reviews failed: ${(e as Error).message.slice(0, 200)}`);
  }
  ctx.meter.maps.failed++;
  return null;
}

const cacheKey = (bid: string, sort: string, cursor: string | null) => `${bid}|${sort}|${cursor ?? ''}`;

function loadCache(ctx: Ctx): Map<string, Page> {
  const cache = new Map<string, Page>();
  if (!CACHE_ON) return cache;
  const files = [
    ...[OUT, path.join(OUT, 'round2')].flatMap((d) => { try { return fs.readdirSync(d).filter((f) => /^E-maps-.*\.json$/.test(f)).map((f) => path.join(d, f)); } catch { return []; } }),
    ...(process.env.E_PAGE_CACHE_EXTRA ? [process.env.E_PAGE_CACHE_EXTRA] : []),
  ];
  for (const f of files) {
    try {
      const j = JSON.parse(fs.readFileSync(f, 'utf8'));
      const pages: any[] = Array.isArray(j) ? j : (j.notes?.raw_pages ?? []);
      for (const p of pages) {
        const fetched = p.fetched_at ?? j.ran_at ?? null;
        if (!p.business_id || !fetched || Date.now() - Date.parse(fetched) > CACHE_MAX_MS) continue;
        if (p.from_cache) continue;
        const sort = p.sort === undefined ? 'newest' : (p.sort ?? 'relevant'); // round-1/2 pages were all "newest"
        const k = cacheKey(p.business_id, sort, p.cursor_in ?? null);
        if (!cache.has(k)) cache.set(k, { ...p, sort, fetched_at: fetched });
      }
    } catch (e) { ctx.warn(`page cache: could not read ${f}: ${(e as Error).message}`); }
  }
  ctx.log(`page cache: ${cache.size} pages from ${files.length} files`);
  return cache;
}

/** One page: from the cache when allowed, else a fresh call if the allowance has room. */
async function getPage(ctx: Ctx, cache: Map<string, Page>, l: Listing, sort: string, cursor: string | null, allow: { left: number }): Promise<Page | 'no-budget' | null> {
  const hit = cache.get(cacheKey(l.business_id, sort, cursor));
  if (hit) return { ...hit, listing: l.name, from_cache: true };
  if (allow.left <= 0) return 'no-budget';
  allow.left--;
  const data = await reviewsCall(ctx, { business_id: l.business_id, limit: '100', ...(sort !== 'relevant' ? { sort } : {}), ...(cursor ? { cursor } : {}) });
  if (!data) return null;
  return { listing: l.name, business_id: l.business_id, sort, cursor_in: cursor, cursor_out: data.cursor ?? null, rows: data.data?.reviews ?? [], fetched_at: new Date().toISOString(), from_cache: false };
}

type Pull = { pages: Page[]; newestIds: Set<string>; complete: boolean; stop: string; fresh: number };

/** Pull one listing within a fresh-call allowance. Whole listing if it fits, else a stratified sample. */
async function pullListing(ctx: Ctx, cache: Map<string, Page>, l: Listing, allow: { left: number }, isBiggest: boolean): Promise<Pull> {
  const start = allow.left;
  const pages: Page[] = [];
  const newestIds = new Set<string>();
  const n = l.reviews ?? 0;
  const need = Math.ceil(n / PAGE);
  // Count the cached newest pages we already hold, to judge whether the whole listing fits.
  let cachedNewest = 0;
  for (let c: string | null = null, k = 0; k < 200; k++) {
    const p = cache.get(cacheKey(l.business_id, 'newest', c));
    if (!p) break;
    cachedNewest++;
    if (!p.cursor_out) break;
    c = p.cursor_out;
  }
  const fits = need <= cachedNewest + allow.left;
  // Stratified extras for listings that will not be pulled whole.
  if (!fits && n > PAGE) {
    for (const sort of ['lowest', 'relevant']) {
      if (allow.left < 2 && cachedNewest === 0) break; // keep at least one call for the newest page
      const p = await getPage(ctx, cache, l, sort, null, allow);
      if (p && p !== 'no-budget') pages.push(p);
    }
  }
  // Newest chain.
  let cursor: string | null = null;
  let stop = '';
  const maxPages = fits ? need + 2 : NEWEST_MAX_PAGES;
  for (let i = 0; i < maxPages; i++) {
    const p = await getPage(ctx, cache, l, 'newest', cursor, allow);
    if (p === 'no-budget') { stop = 'budget used up'; break; }
    if (!p) { stop = 'call failed'; break; }
    pages.push(p);
    const fresh = p.rows.filter((r) => r.review_id && !newestIds.has(r.review_id));
    fresh.forEach((r) => newestIds.add(r.review_id));
    if (!fresh.length) { stop = 'page added no new reviews'; break; }
    if (!p.cursor_out) { stop = 'no cursor'; break; }
    if (n && newestIds.size >= n) { stop = 'all listed reviews pulled'; break; }
    cursor = p.cursor_out;
    if (i === maxPages - 1) stop = `newest-page cap (${maxPages})`;
  }
  // (A relevance page for a listing pulled whole adds nothing: tried on MNA, 1 request wasted.)
  void isBiggest;
  const complete = n > 0 && newestIds.size >= n - 1 && /all listed|no cursor|no new/.test(stop) || (n > 0 && newestIds.size >= n);
  return { pages, newestIds, complete, stop, fresh: start - allow.left };
}

// ---------- listings ----------

async function findListings(ctx: Ctx, dive: any): Promise<{ listings: Listing[]; from: string }> {
  const id = dive.result?.identity ?? {};
  const hFile = path.join(OUT, `H-maps-${ctx.diveId}.json`);
  try {
    if (fs.existsSync(hFile)) {
      const h = JSON.parse(fs.readFileSync(hFile, 'utf8'));
      const rows = (h.notes?.listings ?? []).map((l: any) => ({ name: l.name, address: l.address ?? null, rating: l.rating ?? null, reviews: l.reviews ?? null, business_id: bizIdFromLink(l.place_link), place_link: l.place_link ?? null, website: l.website ?? null }))
        .filter((l: any) => l.business_id);
      if (rows.length) return { listings: rows, from: `H-maps cache (${h.ran_at ?? '?'})` };
    }
  } catch (e) { ctx.warn(`could not read ${hFile}: ${(e as Error).message}`); }

  const names = [id.legal_name, dive.company, ...(id.aliases ?? [])].filter(Boolean).map(norm).filter((n: string) => n.length >= 4);
  const domains = (id.official_domains ?? []).map((d: string) => d.replace(/^www\./, ''));
  const isUs = (row: any) => {
    const n = norm(String(row.name ?? ''));
    const h = host(row.website);
    return names.some((x: string) => n.includes(x) || (x.includes(n) && n.length >= 4)) || (h && domains.some((d: string) => h === d || h.endsWith('.' + d)));
  };
  const own = await ctx.maps('search_maps', { query: String(id.legal_name ?? dive.company), limit: '20', lang: 'en' });
  const rows = (own?.data ?? []).filter(isUs).map((x: any) => ({ name: x.name, address: x.full_address ?? null, rating: x.rating ?? null, reviews: x.review_count ?? null, business_id: x.business_id ?? bizIdFromLink(x.place_link), place_link: x.place_link ?? null, website: x.website ?? null }))
    .filter((l: any) => l.business_id);
  return { listings: rows, from: 'search_maps' };
}

function toReview(listing: string, r: any): Review {
  // Posting date, not the last edit (review_timestamp and sort:newest follow the edit date).
  const ts = Math.round(Number(r.iso_date_timestamp ?? r.review_timestamp ?? 0) / 1000) || Date.parse(String(r.iso_date ?? '').replace(' ', 'T') + 'Z');
  const original = r.review_text ?? null;
  const en = r.translations && !Array.isArray(r.translations) ? r.translations.en : null;
  return {
    listing, id: r.review_id, stars: Number(r.review_rate ?? 0), ts, date: ts ? day(ts) : String(r.iso_date ?? '').slice(0, 10),
    author: String(r.user_name ?? ''), author_id: String(r.user_link ?? '').match(/contrib\/(\d+)/)?.[1] ?? null,
    text: String(en ?? original ?? '').trim(), original, reply: r.business_response_text ?? null, link: r.review_link ?? null, strata: [],
  };
}

// ---------- review widgets on the website ----------

const WIDGETS: [string, RegExp][] = [
  ['Trustindex', /trustindex|ti-widget/i],
  ['Elfsight', /elfsight/i],
  ['Widget for Google Reviews (RichPlugins)', /widget-google-reviews|grw-|wp-gr |rplg|richplugins/i],
  ['EmbedSocial', /embedsocial/i],
  ['SociableKIT', /sociablekit|sk-ww-google-reviews/i],
  ['Featurable', /featurable/i],
  ['Taggbox / Tagembed', /taggbox|tagembed/i],
  ['Shapo', /shapo\.io/i],
  ['Google Places reviews plugin', /wp-google-places-review|google-places-reviews|wpgr-/i],
  ['Reviews on My Website', /reviewsonmywebsite/i],
  ['Starloop / Repuso / Birdeye', /repuso|birdeye|starloop/i],
];

function widgetInfo(html: string) {
  const vendor = WIDGETS.find(([, re]) => re.test(html))?.[0] ?? null;
  if (!vendor) return null;
  // Server-rendered review items (Trustindex puts them in a <template>).
  const names = [...html.matchAll(/class="[^"]*(?:ti-name|grw-review-name|wp-google-name|es-review-author|reviewer-name)[^"]*"[^>]*>\s*([^<]{2,60})/gi)].map((m) => m[1].trim());
  const times = [...html.matchAll(/data-time="(\d{9,10})"/g)].map((m) => Number(m[1]) * 1000);
  return { vendor, names: [...new Set(names)], newest: times.length ? day(Math.max(...times)) : null, items: names.length };
}

// ---------- the lane ----------

export async function run(ctx: Ctx, dive: any): Promise<{ findings: Finding[]; notes: Record<string, unknown> }> {
  const findings: Finding[] = [];
  const id = dive.result?.identity ?? {};
  const add = (f: Omit<Finding, 'checked_at'>) => findings.push({ ...f, checked_at: ctx.now() });
  const now = Date.now();

  // 1. Listings, then pages: smallest listings first, each with a fair share of the budget.
  const { listings, from: listingsFrom } = await findListings(ctx, dive);
  ctx.log(`${listings.length} listings (${listingsFrom}): ${listings.map((l) => `${l.name} ${l.rating ?? '-'}★/${l.reviews ?? 0}`).join(' | ')}`);
  if (!listings.length) {
    ctx.warn('no Google Maps listing found for the company');
    add({ title: 'No Google Maps listing found', detail: `A Maps search for "${id.legal_name ?? dive.company}" found no listing that matches the name or the official domains.`, severity: 'high', source: `https://www.google.com/maps/search/${encodeURIComponent(String(id.legal_name ?? dive.company))}` });
    return { findings, notes: { listingsFrom, listings } };
  }
  const cache = loadCache(ctx);
  const pool = { left: MAPS_BUDGET };
  const withReviews = listings.filter((l) => (l.reviews ?? 0) > 0).sort((a, b) => (a.reviews ?? 0) - (b.reviews ?? 0));
  const biggest = withReviews[withReviews.length - 1]?.name;
  const pulls = new Map<string, Pull>();
  for (let i = 0; i < withReviews.length; i++) {
    const l = withReviews[i];
    const share = Math.max(1, Math.floor(pool.left / (withReviews.length - i)));
    const allow = { left: Math.min(share, pool.left) };
    if (l.name === biggest) allow.left = pool.left; // the last (biggest) takes what is left
    const got = await pullListing(ctx, cache, l, allow, l.name === biggest);
    pool.left -= got.fresh;
    pulls.set(l.name, got);
    const rows = new Set(got.pages.flatMap((p) => p.rows.map((r) => r.review_id))).size;
    ctx.log(`${l.name}: ${rows} unique rows in ${got.pages.length} pages (${got.pages.filter((p) => p.from_cache).length} cached, ${got.fresh} fresh) — ${got.complete ? 'complete' : 'sample'}; ${got.stop}`);
  }
  const pages = [...pulls.values()].flatMap((p) => p.pages);

  // 2. Reviews, de-duplicated, with the strata each came from.
  const byId = new Map<string, Review>();
  for (const p of pages) for (const r of p.rows ?? []) {
    if (!r.review_id) continue;
    const rv = byId.get(r.review_id) ?? toReview(p.listing, r);
    if (!rv.strata.includes(p.sort)) rv.strata.push(p.sort);
    byId.set(r.review_id, rv);
  }
  const reviews = [...byId.values()].sort((a, b) => b.ts - a.ts);
  const ofListing = (name: string) => reviews.filter((r) => r.listing === name);
  const newestOf = (name: string) => ofListing(name).filter((r) => pulls.get(name)?.newestIds.has(r.id));

  // 3. Per listing: coverage, period, reply rate.
  const perListing: any[] = [];
  for (const l of listings) {
    const pull = pulls.get(l.name);
    const rs = ofListing(l.name);
    if (!pull || !rs.length) {
      perListing.push({ name: l.name, listed_reviews: l.reviews, pulled: 0, note: (l.reviews ?? 0) ? 'not pulled' : 'listing shows 0 reviews' });
      if ((l.reviews ?? 0) > 0) ctx.warn(`${l.name}: ${l.reviews} reviews listed, none pulled`);
      continue;
    }
    const nw = newestOf(l.name);
    const span = nw.length ? `${nw[nw.length - 1].date} to ${nw[0].date}` : '-';
    const replied = rs.filter((r) => r.reply);
    const stars: Record<number, number> = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
    rs.forEach((r) => { stars[r.stars] = (stars[r.stars] ?? 0) + 1; });
    const lowest = rs.filter((r) => r.strata.includes('lowest'));
    const relevant = rs.filter((r) => r.strata.includes('relevant'));
    const row = {
      name: l.name, listed_rating: l.rating, listed_reviews: l.reviews, pulled: rs.length, complete: pull.complete, newest_span: span, newest_count: nw.length,
      lowest_page: lowest.map((r) => `${r.stars}★ ${r.date}`), relevant_page: relevant.map((r) => `${r.stars}★ ${r.date}`),
      stars, with_text: rs.filter((r) => r.text).length, replied: replied.length, reply_rate: +(replied.length / rs.length).toFixed(2), stop: pull.stop,
    };
    perListing.push(row);
    const coverage = pull.complete
      ? `all ${plural(rs.length, 'review')} (${span})`
      : `${rs.length} of ${l.reviews ?? '?'}: the newest ${nw.length} (${span})${lowest.length ? `, the ${lowest.length} lowest-rated (${lowest.map((r) => `${r.stars}★ ${r.date.slice(0, 7)}`).join(', ')})` : ''}${relevant.length ? `, and the ${relevant.length} Google shows first (${[...new Set(relevant.map((r) => r.date.slice(0, 4)))].join(', ')})` : ''}`;
    add({
      title: `${l.name}: owner replied to ${replied.length} of ${plural(rs.length, 'review')} checked (${Math.round(row.reply_rate * 100)}%)`,
      detail: `Listed ${l.rating ?? '-'}★ from ${plural(l.reviews ?? 0, 'review')}. Checked ${coverage}. Stars in that set: ${[5, 4, 3, 2, 1].map((s) => `${stars[s]}×${s}★`).join(', ')}; ${row.with_text} with text. Google gives no reply dates, so reply speed cannot be measured.`,
      severity: row.reply_rate < 0.3 && rs.length >= 5 ? 'medium' : 'info', source: l.place_link, listing: l.name, reply_rate: row.reply_rate, complete: pull.complete,
    });
    if (!pull.complete) ctx.warn(`${l.name}: sampled ${rs.length} of ${l.reviews} reviews (${pull.stop})`);
    // The 5 lowest-rated are all 4–5★: no real negative exists on this listing.
    if (lowest.length >= PAGE && lowest.every((r) => r.stars >= 4)) add({
      title: `${l.name}: even its ${lowest.length} lowest-rated reviews are ${Math.min(...lowest.map((r) => r.stars))}★ or better`,
      detail: `Google's lowest-rating sort returns ${lowest.map((r) => `${r.stars}★ (${r.date})`).join(', ')}, so none of the ${l.reviews} reviews is below ${Math.min(...lowest.map((r) => r.stars))}★.`,
      severity: 'info', source: l.place_link, listing: l.name,
    });
  }

  // 4. Negatives (1–3★) without an owner reply: each one is a finding.
  for (const r of reviews.filter((r) => r.stars <= 3 && !r.reply)) {
    add({
      title: `${r.stars}★ review with no reply (${r.listing}, ${r.date})`,
      detail: `${r.author || 'A customer'} left ${r.stars}★ ${Math.round((now - r.ts) / 86400000)} days ago${r.text ? `: "${clip(r.text, 220)}"${r.original && r.original !== r.text ? ' (Google translation)' : ''}` : ' with no text (star only)'}. No owner reply; anyone reading the listing sees it unanswered.`,
      severity: r.stars <= 2 ? 'high' : 'medium', source: r.link, listing: r.listing, review_id: r.id, stars: r.stars,
    });
  }

  // 5. Reply tone: deterministic "templated" plus one LLM call for the rest.
  const replied = reviews.filter((r) => r.reply);
  const tone = new Map<string, { tone: string; why: string }>();
  if (replied.length) {
    const key = (r: Review) => words(String(r.reply).replace(new RegExp(r.author.split(/\s+/).filter((w) => w.length > 1).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') || '^$', 'gi'), ' ')).join(' ').slice(0, 80);
    const counts = new Map<string, number>();
    replied.forEach((r) => counts.set(key(r), (counts.get(key(r)) ?? 0) + 1));
    replied.filter((r) => (counts.get(key(r)) ?? 0) >= 3).forEach((r) => tone.set(r.id, { tone: 'templated', why: `the same reply is used ${counts.get(key(r))} times` }));
    const rest = replied.filter((r) => !tone.has(r.id)).sort((a, b) => a.stars - b.stars).slice(0, 60);
    if (rest.length) {
      const ans = ctx.parseJson(await ctx.llm(
        `These are Google Maps reviews of ${dive.company} with the owner's reply. Tag the tone of each REPLY.\n` +
        `- "helpful": answers the specific point, apologises or offers a concrete fix or next step (for a positive review: a personal, specific thank-you).\n` +
        `- "defensive": makes excuses, argues, blames the customer or circumstances, or dismisses the complaint.\n` +
        `- "templated": a generic thank-you that would fit any review.\n\n` +
        `${JSON.stringify(rest.map((r, i) => ({ i, stars: r.stars, review: clip(r.text || '(no text)', 300), reply: clip(String(r.reply), 500) })))}\n\n` +
        `Return JSON only: {"replies":[{"i":0,"tone":"helpful|defensive|templated","why":"under 15 words"}]}`,
      ));
      if (!ans) ctx.warn('reply tone: the LLM answer did not parse; tones skipped');
      for (const x of ans?.replies ?? []) if (rest[x.i] && /^(helpful|defensive|templated)$/.test(x.tone)) tone.set(rest[x.i].id, { tone: x.tone, why: String(x.why ?? '') });
    }
  }
  for (const l of listings) {
    const rs = ofListing(l.name);
    if (!rs.length) continue;
    const t = { helpful: 0, defensive: 0, templated: 0, untagged: 0, none: 0 };
    rs.forEach((r) => { if (!r.reply) t.none++; else t[(tone.get(r.id)?.tone ?? 'untagged') as keyof typeof t]++; });
    if (!rs.some((r) => r.reply)) continue; // "no replies" is already in the coverage finding
    const negReplied = rs.filter((r) => r.stars <= 3 && r.reply);
    const bad = negReplied.filter((r) => tone.get(r.id)?.tone === 'defensive');
    add({
      title: `${l.name}: owner replies are ${t.helpful} helpful, ${t.templated} templated, ${t.defensive} defensive; ${t.none} reviews have none`,
      detail: `Of ${plural(rs.length, 'review')} checked.${t.untagged ? ` ${t.untagged} replies untagged.` : ''} Replies to 1–3★ reviews: ${negReplied.length ? negReplied.map((r) => `${r.stars}★ ${r.date} ${tone.get(r.id)?.tone ?? '?'}`).join(', ') : 'none'}.`,
      severity: bad.length ? 'high' : t.templated > t.helpful ? 'low' : 'info', source: l.place_link, listing: l.name, tones: t,
    });
    for (const r of bad) add({
      title: `Defensive owner reply to a ${r.stars}★ review (${r.listing}, ${r.date})`,
      detail: `Review: "${clip(r.text || '(star only)', 160)}". Reply: "${clip(String(r.reply), 260)}". ${tone.get(r.id)?.why ?? ''} Prospects read replies to bad reviews more closely than the reviews themselves.`,
      severity: 'high', source: r.link, listing: r.listing, review_id: r.id,
    });
  }

  // 6. Trend per listing, pointed at that listing.
  const trend: any[] = [];
  for (const l of listings) {
    const pull = pulls.get(l.name);
    const nw = newestOf(l.name);
    if (!pull || nw.length < 8) continue;
    const avg = (rs: Review[]) => (rs.length ? +(rs.reduce((n, r) => n + r.stars, 0) / rs.length).toFixed(2) : null);
    if (pull.complete) {
      const recent = nw.filter((r) => now - r.ts < 180 * 86400000), older = nw.filter((r) => now - r.ts >= 180 * 86400000);
      const buckets = new Map<string, Review[]>();
      nw.forEach((r) => buckets.set(half(r.ts), [...(buckets.get(half(r.ts)) ?? []), r]));
      const t = [...buckets.entries()].sort().map(([k, rs]) => ({ period: k, reviews: rs.length, avg: avg(rs) }));
      trend.push({ listing: l.name, halves: t });
      const ra = avg(recent), oa = avg(older);
      const dir = ra != null && oa != null && recent.length >= 3 ? (ra < oa - 0.2 ? 'falling' : ra > oa + 0.2 ? 'rising' : 'steady') : 'too few recent reviews to tell';
      add({
        title: `${l.name}: rating trend ${dir}${ra != null ? ` (last 6 months ${ra}★ from ${recent.length}` : ''}${oa != null ? `, before that ${oa}★ from ${older.length})` : ra != null ? ')' : ''}`,
        detail: `By half-year: ${t.map((x) => `${x.period} ${x.avg}★ (${x.reviews})`).join('; ')}. Newest review ${nw[0].date}, ${Math.round((now - nw[0].ts) / 86400000)} days ago.`,
        severity: dir === 'falling' ? 'medium' : 'info', source: l.place_link, listing: l.name,
      });
    } else {
      const a = avg(nw);
      const dir = a != null && l.rating != null ? (a < l.rating - 0.2 ? 'below' : a > l.rating + 0.2 ? 'above' : 'in line with') : 'not comparable to';
      trend.push({ listing: l.name, newest_avg: a, newest_n: nw.length, listed: l.rating });
      add({
        title: `${l.name}: the newest ${nw.length} reviews average ${a}★, ${dir} the overall ${l.rating ?? '-'}★`,
        detail: `Newest reviews ${nw[nw.length - 1].date} to ${nw[0].date} (${Math.round((nw[0].ts - nw[nw.length - 1].ts) / 86400000)} days). The listing has ${l.reviews} reviews in all; the API pages newest-first only, so older periods are seen only through the lowest-rated and most-relevant pages.`,
        severity: dir === 'below' ? 'medium' : 'info', source: l.place_link, listing: l.name,
      });
    }
  }

  // 7. Bursts against the listing's own rate, and the same account on several listings.
  const bursts: any[] = [];
  for (const l of listings) {
    const nw = newestOf(l.name).slice().sort((a, b) => a.ts - b.ts);
    if (nw.length < 8) continue;
    const spanDays = Math.max(1, (nw[nw.length - 1].ts - nw[0].ts) / 86400000);
    if (spanDays < 60) { bursts.push({ listing: l.name, skipped: `sample spans only ${Math.round(spanDays)} days` }); continue; }
    const rate = nw.length / spanDays; // reviews per day over the sampled period
    const perDay = new Map<string, Review[]>();
    nw.forEach((r) => perDay.set(r.date, [...(perDay.get(r.date) ?? []), r]));
    const threshold = Math.max(4, 10 * rate);
    for (const [d, rs] of perDay) if (rs.length >= threshold) {
      bursts.push({ listing: l.name, day: d, n: rs.length, rate: +rate.toFixed(3) });
      add({
        title: `${l.name}: ${rs.length} reviews on ${d}, about ${Math.round(rs.length / rate)}× its usual daily rate`,
        detail: `Over ${nw[0].date} to ${nw[nw.length - 1].date} the listing averaged ${rate.toFixed(2)} reviews a day; ${d} had ${rs.length} (${rs.filter((r) => !r.text).length} star-only). A one-day spike reads as a review drive; Google may hold back reviews that arrive in clusters.`,
        severity: 'medium', source: l.place_link, listing: l.name,
      });
    }
  }
  const byAuthor = new Map<string, Review[]>();
  for (const r of reviews) if (r.author_id) byAuthor.set(r.author_id, [...(byAuthor.get(r.author_id) ?? []), r]);
  const multi = [...byAuthor.values()].filter((rs) => new Set(rs.map((r) => r.listing)).size > 1);
  if (multi.length) add({
    title: `${plural(multi.length, 'reviewer')} left a review on more than one of your listings`,
    detail: multi.map((rs) => `${rs[0].author}: ${rs.map((r) => `${short(r.listing)} ${r.stars}★ ${r.date}`).join(', ')}`).join('; ') + '. One customer usually deals with one branch; Google treats the same account reviewing sister listings as a sign of solicited reviews and may remove them.',
    severity: 'medium', source: multi[0][0].link, author_ids: multi.map((rs) => rs[0].author_id),
  });

  // 8. Themes, complaints and named staff (one LLM call over the reviews with text).
  const texted = reviews.filter((r) => r.text);
  let themes: any = null;
  if (texted.length) {
    themes = ctx.parseJson(await ctx.llm(
      `These are Google Maps reviews of ${dive.company} (${id.industry ?? 'a company'}). Classify each review and find what customers repeatedly praise or complain about.\n\n` +
      `Reviews (JSON):\n${JSON.stringify(texted.map((r, i) => ({ i, stars: r.stars, date: r.date, text: clip(r.text, 700) })))}\n\n` +
      `Return JSON only:\n{"reviews":[{"i":0,"sentiment":"positive|mixed|negative","praise":["short theme"],"complaints":["short theme"]}],\n` +
      ` "praise_themes":[{"theme":"short label","reviews":[i,...]}],\n "complaint_themes":[{"theme":"short label","reviews":[i,...]}],\n` +
      ` "staff_named":[{"name":"staff name as written","reviews":[i,...]}]}\n` +
      `Rules: a praise theme needs at least 2 reviews; list EVERY complaint theme, even one from a single review; complaints inside positive reviews count; list every review index that supports each item; use only what the text says.`,
    ));
    if (!themes) ctx.warn('review classification: the LLM answer did not parse; themes skipped');
  }
  const valid = (ids: any) => (Array.isArray(ids) ? ids.filter((i: any) => Number.isInteger(i) && texted[i]) : []);
  const allComplete = listings.every((l) => !(l.reviews ?? 0) || pulls.get(l.name)?.complete);
  if (themes) {
    const praise = (themes.praise_themes ?? []).filter((t: any) => valid(t.reviews).length >= 2).sort((a: any, b: any) => valid(b.reviews).length - valid(a.reviews).length);
    let complaints = (themes.complaint_themes ?? []).filter((t: any) => valid(t.reviews).length >= 1);
    if (!complaints.length) complaints = (themes.reviews ?? []).filter((x: any) => texted[x.i] && (x.complaints?.length || x.sentiment === 'negative'))
      .map((x: any) => ({ theme: (x.complaints ?? []).slice(0, 3).join(' / ') || 'negative experience', reviews: [x.i] }));
    if (praise.length) {
      const ex = texted[valid(praise[0].reviews)[0]];
      add({
        title: `What customers praise most: ${praise.slice(0, 3).map((t: any) => t.theme).join(', ')}`,
        detail: `${praise.map((t: any) => `${t.theme} (${valid(t.reviews).length})`).join('; ')}. From ${texted.length} reviews with text. E.g. "${clip(ex.text, 160)}" (${ex.author}).`,
        severity: 'info', source: ex.link,
      });
    }
    const coverageNote = allComplete ? `all ${texted.length} written reviews` : `the ${texted.length} written reviews sampled (newest, lowest-rated and most relevant)`;
    if (complaints.length) add({
      title: `Complaints in the review text: ${complaints.slice(0, 3).map((t: any) => t.theme).join(', ')}`,
      detail: `In ${coverageNote}: ` + complaints.map((t: any) => `${t.theme} (${valid(t.reviews).length}): ${valid(t.reviews).slice(0, 2).map((i: number) => `"${clip(texted[i].text, 120)}" ${texted[i].stars}★ ${texted[i].date}`).join(' / ')}`).join('; '),
      severity: 'medium', source: texted[valid(complaints[0].reviews)[0]]?.link ?? null,
    });
    else add({
      title: `No complaint in ${coverageNote}`,
      detail: allComplete ? `Any low rating is star-only, so its reason is unknown.` : `The sample includes Google's lowest-rated page, so a written complaint, if one existed, would most likely be in it.`,
      severity: 'info', source: listings[0].place_link,
    });
    const staff = (themes.staff_named ?? []).filter((s: any) => valid(s.reviews).length >= 2);
    if (staff.length) add({ title: `Staff customers name in reviews: ${staff.map((s: any) => s.name).join(', ')}`, detail: staff.map((s: any) => `${s.name} (${valid(s.reviews).length} reviews)`).join('; ') + '.', severity: 'info', source: texted[valid(staff[0].reviews)[0]].link });
  }

  // 9. Are good reviews reused on the official website? Widgets, phrases and reviewer names.
  const good = texted.filter((r) => r.stars >= 4 && words(r.original ?? r.text).length >= 6);
  const domains: string[] = [...new Set<string>([...(id.official_domains ?? []), ...listings.map((l) => host(l.website))].filter(Boolean).map((d: string) => d.replace(/^www\./, '')))];
  const pagesRead: any[] = [];
  const site: { url: string; text: string; widget: ReturnType<typeof widgetInfo> }[] = [];
  for (const d of domains.slice(0, 4)) {
    const home = await ctx.page(`https://${d}/`);
    pagesRead.push({ url: home.finalUrl, status: home.status, chars: home.html.length });
    if (!home.html) { ctx.warn(`could not read https://${d}/: ${home.error ?? home.status}`); continue; }
    if (site.some((s) => s.url === home.finalUrl)) continue;
    site.push({ url: home.finalUrl, text: ctx.htmlText(home.html), widget: widgetInfo(home.html) });
    const links = [...home.html.matchAll(/href=["']([^"'#]+)["']/gi)].map((m) => m[1])
      .filter((h) => /testimon|review|client|customer|happy|ulasan|评价|见证/i.test(h) && !/\.(css|js|png|jpe?g|webp|svg|gif|ico|pdf)(\?|$)/i.test(h))
      .map((h) => { try { return new URL(h, home.finalUrl).href; } catch { return ''; } })
      .filter((u) => u && host(u) === host(home.finalUrl));
    for (const u of [...new Set(links)].slice(0, 2)) {
      const p = await ctx.page(u);
      pagesRead.push({ url: p.finalUrl, status: p.status, chars: p.html.length });
      if (p.html && p.status < 400) site.push({ url: p.finalUrl, text: ctx.htmlText(p.html), widget: widgetInfo(p.html) });
    }
  }
  const reuse: { review: Review; url: string; how: string }[] = [];
  for (const r of good) {
    const w = words(r.original ?? r.text);
    const grams: string[] = [];
    for (let i = 0; i + 6 <= w.length; i++) grams.push(w.slice(i, i + 6).join(' '));
    for (const s of site) {
      const t = ' ' + words(s.text).join(' ') + ' ';
      const hit = grams.find((g) => t.includes(' ' + g + ' '));
      if (hit) { reuse.push({ review: r, url: s.url, how: `phrase "${hit}"` }); break; }
    }
  }
  const widgets = site.filter((s) => s.widget);
  const widgetNames = new Set(widgets.flatMap((s) => s.widget!.names.map((n) => n.toLowerCase())));
  const nameHits = reviews.filter((r) => r.author.length > 3 && widgetNames.has(r.author.toLowerCase()));
  if (site.length) {
    if (widgets.length) {
      const w = widgets[0].widget!;
      const newestGoogle = reviews.filter((r) => r.stars >= 4)[0]?.date ?? null;
      const stale = w.newest && newestGoogle && Date.parse(newestGoogle) - Date.parse(w.newest) > 60 * 86400000;
      add({
        title: `Your website shows Google reviews through a ${w.vendor} widget${w.items ? ` (${plural(w.items, 'review')} in the page${w.newest ? `, newest ${w.newest}` : ''})` : ''}`,
        detail: (w.items ? `Reviewers shown: ${w.names.slice(0, 8).join(', ')}${nameHits.length ? `; ${nameHits.length} of them match reviews we pulled` : ''}.` : 'The reviews load in the visitor\'s browser, so which ones it shows cannot be read from the page.') +
          (stale ? ` The widget's newest review is ${w.newest}, while Google has 4–5★ reviews up to ${newestGoogle}: refresh or re-sync it.` : '') + ` On ${widgets.map((s) => s.url).join(', ')}.`,
        severity: stale ? 'low' : 'info', source: widgets[0].url, vendor: w.vendor,
      });
    } else if (reuse.length) add({
      title: `${plural(reuse.length, 'Google review')} quoted on your website`,
      detail: reuse.map((x) => `${x.review.author} ${x.review.stars}★ on ${x.url} (${x.how})`).join('; '), severity: 'info', source: reuse[0].url,
    });
    else add({
      title: `None of your ${good.length} good written Google reviews appear on your website, and it has no review widget`,
      detail: `Checked ${plural(site.length, 'page')} (${site.map((s) => s.url).join(', ')}) for any 6-word phrase from each 4–5★ review and for review widgets. ${good.length ? `Strong ones to reuse: ${good.slice().sort((a, b) => b.text.length - a.text.length).slice(0, 2).map((r) => `"${clip(r.text, 100)}" (${r.author})`).join('; ')}.` : ''}`,
      severity: good.length ? 'low' : 'info', source: site[0].url,
    });
  }

  return {
    findings,
    notes: {
      listingsFrom, listings, per_listing: perListing, trend, bursts,
      budget: { limit: MAPS_BUDGET, fresh_calls: MAPS_BUDGET - pool.left, cached_pages: pages.filter((p) => p.from_cache).length, cache_on: CACHE_ON },
      classified: themes, tones: Object.fromEntries(tone), pages_read: pagesRead,
      widgets: site.filter((s) => s.widget).map((s) => ({ url: s.url, ...s.widget })),
      reviews: reviews.map((r) => ({ ...r, link: undefined })),
      raw_pages: pages,
    },
  };
}
