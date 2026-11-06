// Scraper.Tech's Google Maps API over its MCP endpoint (plain JSON-RPC POST), the one client for it. Used for Google
// Maps REVIEWS: the local Gmap worker reads the Maps list and at most ~10 reviews of a profile, so full review reading
// (many pages of 5) goes here. Key: secrets.ts kind `scraper_tech` (SCRAPER_TECH_KEY on Railway, then the local vault).
// Endpoint = https://mcp.scraper.tech/<key>. A page of reviews is 5 reviews and one request on the plan (the plan's
// counter on scraper.tech is the proof of cost; the `limit` argument is ignored by the API). Logged like every core call.
import { startCall, type ApiCall } from '../cost.ts';
import * as secrets from './secrets.ts';

const HOST = 'https://mcp.scraper.tech';
const PAGE = 5;

export type MapsReview = {
  review_id: string;
  author: string;
  author_reviews: number | null;
  rating: number | null;
  date: string | null;
  text: string | null;
  owner_reply: string | null;
  photos: number;
  link: string | null;
};

export type MapsReviews = {
  business_id: string;
  name: string | null;
  rating: number | null;
  review_count: number | null;
  reviews: MapsReview[];
  /** Requests spent on this read (each page of 5 is one). */
  calls: number;
  /** True when there were more reviews than `max`. */
  truncated: boolean;
};

/** A Maps place ID (ChIJ...) holds the feature ID the reviews tool wants (0x..:0x..); decoded here, no request needed. */
export function featureIdFromPlaceId(placeId: string): string | null {
  try {
    const b = Buffer.from(placeId.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
    if (b.length < 20 || b[0] !== 0x0a || b[2] !== 0x09 || b[11] !== 0x11) return null;
    return `0x${b.readBigUInt64LE(3).toString(16)}:0x${b.readBigUInt64LE(12).toString(16)}`;
  } catch {
    return null;
  }
}

async function rpc(key: string, name: string, args: Record<string, string>, timeoutMs: number): Promise<any> {
  const response = await fetch(`${HOST}/${key}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error(`Scraper.Tech returned HTTP ${response.status}`);
  const raw = await response.text();
  const body = JSON.parse(raw.includes('data:') ? raw.slice(raw.indexOf('data:') + 5) : raw);
  if (body.error) throw new Error(`Scraper.Tech: ${String(body.error.message ?? JSON.stringify(body.error)).slice(0, 200)}`);
  const text: string = body.result?.content?.[0]?.text ?? '';
  let payload: any;
  try { payload = JSON.parse(text); } catch { throw new Error(`Scraper.Tech: ${text.slice(0, 200) || 'empty answer'}`); }
  if (payload?.error) throw new Error(`Scraper.Tech: ${String(payload.error).slice(0, 200)}`); // e.g. "Tariff ended" (quota used up)
  return payload;
}

/** The newest `max` reviews of one Maps profile (a place ID or feature ID). Throws when the key is missing or the API refuses. */
export async function reviews(
  place: { placeId?: string; businessId?: string },
  opts: { max?: number; country?: string; sort?: string; log?: ApiCall[]; timeoutMs?: number } = {},
): Promise<MapsReviews> {
  await secrets.load();
  const key = secrets.get('scraper_tech');
  if (!key) throw new Error('No Scraper.Tech key: set SCRAPER_TECH_KEY');
  const businessId = place.businessId || (place.placeId ? featureIdFromPlaceId(place.placeId) : null);
  if (!businessId) throw new Error('No usable Maps ID (need a place ID ChIJ... or a feature ID 0x..:0x..)');
  const max = Math.max(1, Math.min(opts.max ?? 50, 200));

  const out: MapsReviews = { business_id: businessId, name: null, rating: null, review_count: null, reviews: [], calls: 0, truncated: false };
  const seen = new Set<string>();
  let cursor = '';
  const maxCalls = Math.ceil(max / PAGE) + 2;
  while (out.reviews.length < max && out.calls < maxCalls) {
    const args: Record<string, string> = { business_id: businessId, sort: opts.sort ?? 'newest', limit: String(PAGE) };
    if (opts.country) args.country = opts.country;
    if (cursor) args.cursor = cursor;
    const c = startCall('maps', `Scraper.Tech reviews ${businessId} page ${out.calls + 1}`, { provider: 'scraper.tech' });
    let payload: any;
    try {
      out.calls++;
      payload = await rpc(key, 'reviews', args, opts.timeoutMs ?? 90_000);
    } catch (err) {
      opts.log?.push(c.done({ ok: false, usd: null, note: String((err as Error).message).slice(0, 200) }));
      throw err;
    }
    const data = payload?.data ?? {};
    const page: any[] = Array.isArray(data.reviews) ? data.reviews : [];
    opts.log?.push(c.done({ ok: true, usd: null, results: page.length }));
    if (out.name === null && data.name) {
      out.name = data.name;
      out.rating = data.rating ?? null;
      out.review_count = data.review_count ?? null;
    }
    for (const r of page) {
      const id = String(r.review_id ?? `${r.user_link}:${r.iso_date}`);
      if (seen.has(id)) continue;
      seen.add(id);
      out.reviews.push({
        review_id: id,
        author: String(r.user_name ?? ''),
        author_reviews: typeof r.user_total_reviews === 'number' ? r.user_total_reviews : null,
        rating: typeof r.review_rate === 'number' ? r.review_rate : Number(r.review_rate) || null,
        date: r.iso_date ?? null,
        text: r.review_text ? String(r.review_text) : null,
        owner_reply: r.business_response_text ? String(r.business_response_text) : null,
        photos: Array.isArray(r.review_photos) ? r.review_photos.length : 0,
        link: r.review_link ?? null,
      });
    }
    cursor = String(payload?.cursor ?? '');
    if (!cursor || !page.length) break;
  }
  if (out.reviews.length > max) { out.reviews.length = max; out.truncated = true; }
  else if (cursor && out.reviews.length >= max) out.truncated = true;
  return out;
}
