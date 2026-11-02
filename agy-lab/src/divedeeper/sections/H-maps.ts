// H / maps — findability on Google Maps.
// Where does the company rank for "<trade> in <area>" in the areas it serves, who sits
// above it, which of its office towns have no Maps listing, and which of its own
// listings are duplicates or incomplete. Trades and areas come from H-plan (picked once
// per company); the rest is scraper.tech search_maps, one request per query.
import type { Ctx, Finding } from '../lib.ts';
import { getPlan } from './H-plan.ts';

const LIMIT = 60;
const THIN = 10; // a query with fewer results than this says little about rank

const norm = (s: string) => s.toLowerCase().replace(/sdn\.?\s*bhd\.?|berhad|plt|enterprise|\(.*?\)/g, '').replace(/[^a-z0-9一-鿿]+/g, ' ').trim();
const host = (u: string | null | undefined) => {
  try { return u ? new URL(u.startsWith('http') ? u : 'https://' + u).hostname.replace(/^www\./, '') : ''; } catch { return ''; }
};
/** Postcode plus road number ("43000|3/3"), for spotting two listings at one place even when
 *  the street is spelled two ways ("Jalan Seksyen 3/3" vs "Jalan Section 3/3"). */
const place = (addr: string | null | undefined, name: string) => {
  const a = String(addr ?? '').toLowerCase().replace(name.toLowerCase(), '');
  const postcode = a.match(/\b\d{5}\b/)?.[0] ?? '';
  const road = a.match(/\b\d+[a-z]?\/\d+[a-z]?\b/)?.[0] ?? a.replace(/[^a-z0-9]+/g, ' ').trim().split(' ').slice(0, 4).join(' ');
  return postcode && road ? `${postcode}|${road}` : '';
};

export async function run(ctx: Ctx, dive: any): Promise<{ findings: Finding[]; notes: Record<string, unknown> }> {
  const r = dive.result ?? {};
  const id = r.identity ?? {};
  const names = [id.legal_name, dive.company, ...(id.aliases ?? [])].filter(Boolean).map(norm).filter((n: string) => n.length >= 4);
  const domains = (id.official_domains ?? []).map((d: string) => d.replace(/^www\./, ''));
  // The brand word ("rienzo", "eternalgy"): a listing whose name is only PART of an alias must carry it,
  // or "AutoGate System" would match the alias "Rienzo Autogate System".
  const brand = norm(String(id.legal_name ?? dive.company)).split(' ')[0] ?? '';
  const isUs = (row: any) => {
    const n = norm(String(row.name ?? ''));
    const h = host(row.website);
    return names.some((x: string) => n.includes(x) || (x.includes(n) && n.length >= 4 && brand.length >= 3 && n.includes(brand))) || (h && domains.some((d: string) => h === d || h.endsWith('.' + d)));
  };

  const plan = await getPlan(ctx, dive);
  ctx.log(`trades: ${plan.trades.join(' | ')}   areas: ${plan.areas.join(' | ')}   offices: ${plan.offices.join(' | ')}`);

  const findings: Finding[] = [];
  const ranks: any[] = [];
  const queries = plan.trades.flatMap((t) => plan.areas.map((a) => ({ q: `${t} in ${a}`, trade: t, area: a })));
  const results = await Promise.all(queries.map(async (x) => ({ ...x, data: await ctx.maps('search_maps', { query: x.q, limit: String(LIMIT), lang: 'en' }) })));
  for (const { q, trade, area, data } of results) {
    if (!data) { ranks.push({ query: q, trade, area, rank: null, of: null, failed: true }); continue; }
    const rows: any[] = data.data ?? [];
    const idx = rows.findIndex(isUs);
    const above = rows.slice(0, idx >= 0 ? idx : 5).filter((x) => !isUs(x)).slice(0, 5).map((x) => `${x.name} (${x.rating ?? '-'}★, ${x.review_count ?? 0} reviews)`);
    ranks.push({ query: q, trade, area, rank: idx >= 0 ? idx + 1 : null, of: rows.length, thin: rows.length < THIN, listing: idx >= 0 ? rows[idx].name : null, top: above });
  }

  // One finding per area: every trade's rank there, thin queries left out.
  for (const area of plan.areas) {
    const here = ranks.filter((x) => x.area === area && !x.failed && !x.thin);
    if (!here.length) { ctx.log(`${area}: every query thin or failed, no finding`); continue; }
    const best = Math.min(...here.map((x) => x.rank ?? Infinity));
    const line = here.map((x) => `"${x.query}": ${x.rank ? `#${x.rank} of ${x.of}` : `not in the top ${x.of}`}`).join('; ');
    const ahead = here.find((x) => x.top.length)?.top ?? [];
    findings.push({
      title: best === Infinity ? `Not on the first page of Google Maps in ${area}` : `Best Maps rank in ${area}: #${best}`,
      detail: `${line}.${ahead.length ? ` Shown before you: ${ahead.slice(0, 4).join('; ')}.` : ''}`,
      severity: best <= 3 ? 'info' : best <= 10 ? 'medium' : 'high',
      source: `https://www.google.com/maps/search/${encodeURIComponent(here[0].query)}`, checked_at: ctx.now(), area, best_rank: best === Infinity ? null : best,
    });
  }

  // The company's own listings: the name search plus any listing the trade searches turned up.
  const own = await ctx.maps('search_maps', { query: String(id.legal_name ?? dive.company), limit: '20', lang: 'en' });
  const seen = new Set<string>();
  const ownRows = [...(own?.data ?? []), ...results.flatMap((x) => x.data?.data ?? [])].filter(isUs)
    .filter((x: any) => { const k = String(x.place_id ?? x.business_id ?? x.name); if (seen.has(k)) return false; seen.add(k); return true; });
  const listings = ownRows.map((x: any) => ({ name: x.name, address: x.full_address, rating: x.rating, reviews: x.review_count, phone: x.phone_number, website: x.website, claimed: x.is_claimed, verified: x.verified, closed: x.is_permanently_closed || x.is_temporarily_closed, place_link: x.place_link }));
  if (own || listings.length) {
    findings.push({ title: `${listings.length} Google Maps listing${listings.length === 1 ? '' : 's'} carry your name`, detail: listings.map((l: any) => `${l.name} — ${l.address ?? 'no address'} — ${l.rating ?? '-'}★/${l.reviews ?? 0} — ${l.phone ?? 'no phone'} — ${l.website ?? 'no website'}${l.claimed === false ? ' — NOT CLAIMED' : ''}${l.closed ? ' — CLOSED' : ''}`).join(' | ') || 'none found', severity: listings.length === 0 ? 'high' : listings.some((l: any) => l.claimed === false || l.closed) ? 'medium' : 'info', source: `https://www.google.com/maps/search/${encodeURIComponent(String(id.legal_name ?? dive.company))}`, checked_at: ctx.now() });

    // Two listings at the same place are a duplicate; branches with their own phone are normal.
    const byPlace = new Map<string, any[]>();
    for (const l of listings) { const k = place(l.address, l.name); if (k) byPlace.set(k, [...(byPlace.get(k) ?? []), l]); }
    for (const group of byPlace.values()) if (group.length > 1) {
      const phones = [...new Set(group.map((l: any) => l.phone).filter(Boolean))];
      findings.push({ title: `${group.length} Maps listings for the same address`, detail: `${group.map((l: any) => `"${l.name}" (${l.rating ?? '-'}★/${l.reviews ?? 0}, ${l.phone ?? 'no phone'})`).join(' and ')}.${phones.length > 1 ? ' They give different phone numbers.' : ''} Customers and their reviews are split between them.`, severity: 'medium', source: group[0].place_link, checked_at: ctx.now() });
    }
    for (const l of listings.filter((l: any) => !l.website)) findings.push({ title: `Listing "${l.name}" has no website link`, detail: `${l.address}`, severity: 'medium', source: l.place_link, checked_at: ctx.now() });

    // Office towns with no listing of the company.
    const addrs = listings.map((l: any) => String(l.address ?? '').toLowerCase());
    for (const town of plan.offices) {
      const t = town.toLowerCase().replace(/^(bandar|kota)\s+/, '');
      if (!addrs.some((a: string) => a.includes(t))) findings.push({ title: `No Google Maps listing in ${town}`, detail: `Your own material says you have an office or branch in ${town}, but none of your ${listings.length} Maps listing(s) is there, so customers searching in ${town} cannot find it.`, severity: 'high', source: null, checked_at: ctx.now(), town });
    }
  }

  return { findings, notes: { plan, ranks, listings } };
}
