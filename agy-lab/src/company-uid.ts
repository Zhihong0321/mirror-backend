// Company UIDs: one UID per company across every search run.
//
// A research lead is a Google Maps listing (search_list_place, keyed by its
// place id). Listings that share a website host are one company: a chain's
// branches and a business's duplicate listings get the same UID. A listing with
// no website of its own (none, or only a social, chat, link-in-bio or
// marketplace page that many businesses share) is a company of its own. The
// same place found in another run keeps its UID, and a listing keeps the UID it
// was first given even if its website changes later.
import crypto from 'node:crypto';
import type http from 'node:http';
import * as db from './reportdb.ts';
import { addMeter, diveUsage, emptyUsage, price } from './cost.ts';

/** Hosts many unrelated businesses share; a website here says nothing about which company it is. */
const SHARED_HOSTS = new Set([
  'facebook.com', 'fb.com', 'fb.me', 'm.me', 'messenger.com', 'instagram.com', 'threads.net', 'tiktok.com',
  'youtube.com', 'youtu.be', 'twitter.com', 'x.com', 'linkedin.com', 'pinterest.com', 'xiaohongshu.com', 'weibo.com',
  'wa.me', 'wa.link', 'whatsapp.com', 'line.me', 'lin.ee', 't.me', 'telegram.me', 'wechat.com', 'qq.com', 'kakao.com',
  'linktr.ee', 'beacons.ai', 'lnk.bio', 'taplink.cc', 'msha.ke', 'linkin.bio', 'bio.link', 'campsite.bio',
  'google.com', 'goo.gl', 'g.page', 'g.co', 'forms.gle', 'bit.ly', 'tinyurl.com', 'ow.ly', 'cutt.ly', 's.id',
  'shopee.com', 'shopee.com.my', 'shopee.sg', 'shopee.co.id', 'shopee.co.th', 'shopee.ph', 'shopee.vn', 'shopee.tw',
  'lazada.com', 'lazada.com.my', 'lazada.sg', 'lazada.co.id', 'lazada.co.th', 'lazada.com.ph', 'lazada.vn',
  'tokopedia.com', 'carousell.com', 'carousell.com.my', 'carousell.sg', 'mudah.my', 'amazon.com', 'etsy.com', 'ebay.com',
  'grab.com', 'food.grab.com', 'foodpanda.my', 'foodpanda.sg', 'foodpanda.com', 'gofood.co.id', 'deliveroo.com',
  'yelp.com', 'tripadvisor.com', 'booking.com', 'agoda.com', 'airbnb.com', 'expedia.com', 'trip.com',
  'calendly.com', 'jotform.com', 'wix.com', 'squarespace.com', 'linkedin.cn', 'about.me', 'canva.site',
  'local.ch', 'search.ch', 'yell.com', 'yellowpages.com', 'yellowpages.com.au', 'pagesjaunes.fr', 'gelbeseiten.de', 'paginasamarillas.es',
  'hotfrog.com', 'cylex.de', 'gumtree.com', 'olx.com', 'mercadolivre.com.br', 'mercadolibre.com', 'rakuten.co.jp', 'bukalapak.com',
  'naver.com', 'naver.me', 'daum.net', 'kakao.com', 'ameblo.jp', 'note.com', 'medium.com', 'substack.com', 'vk.com', 'ok.ru',
]);

/** The website host a listing's company is grouped by, or null when it has no website of its own. */
export function companyDomain(website: unknown): string | null {
  const raw = typeof website === 'string' ? website.trim() : '';
  if (!raw) return null;
  let host: string;
  try {
    host = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : 'http://' + raw).hostname.toLowerCase();
  } catch {
    return null;
  }
  host = host.replace(/\.$/, '').replace(/^(www\d?|m)\./, '');
  if (!host.includes('.') || /^[\d.]+$/.test(host) || host.startsWith('[')) return null;
  for (let h = host; h.includes('.'); h = h.slice(h.indexOf('.') + 1)) if (SHARED_HOSTS.has(h)) return null;
  return host;
}

export const newUid = (): string => 'co_' + crypto.randomBytes(6).toString('hex');

let migrated: Promise<void> | null = null;
function migrate(): Promise<void> {
  migrated ??= (async () => {
    await db.sql(`
      create table if not exists company (
        uid        text primary key,
        domain     text unique,
        created_at timestamptz not null default now()
      )
    `);
    await db.sql(`
      create table if not exists company_place (
        place_key  text primary key,
        uid        text not null references company(uid),
        created_at timestamptz not null default now()
      )
    `);
    await db.sql(`create index if not exists company_place_uid on company_place (uid)`);
  })().catch((err) => { migrated = null; throw err; });
  return migrated;
}

/** The company tables exist (for a reader that joins them). */
export const ready = (): Promise<void> => migrate();

/** Gives every listing here that has no UID yet one: its website's company, or a company of its own. Returns how many got one. */
export async function assign(places: Array<{ place_key: string; website?: unknown }>): Promise<number> {
  if (!places.length) return 0;
  await migrate();
  const byKey = new Map(places.map((p) => [p.place_key, companyDomain(p.website)]));
  const known = new Set((await db.sql<{ place_key: string }>(
    `select place_key from company_place where place_key = any($1::text[])`, [[...byKey.keys()]])).rows.map((r) => r.place_key));
  const fresh = [...byKey].filter(([key]) => !known.has(key));
  if (!fresh.length) return 0;
  const domains = [...new Set(fresh.map(([, domain]) => domain).filter((d): d is string => !!d))];
  if (domains.length) {
    await db.sql(`
      insert into company (uid, domain) select x.uid, x.domain from jsonb_to_recordset($1::jsonb) as x(uid text, domain text)
      on conflict (domain) do nothing`, [JSON.stringify(domains.map((domain) => ({ uid: newUid(), domain })))]);
  }
  const lone = fresh.filter(([, domain]) => !domain).map(([place_key]) => ({ place_key, uid: newUid() }));
  if (lone.length) {
    await db.sql(`insert into company (uid) select x.uid from jsonb_to_recordset($1::jsonb) as x(uid text)`, [JSON.stringify(lone)]);
  }
  const rows = [...fresh.filter(([, domain]) => domain).map(([place_key, domain]) => ({ place_key, domain })), ...lone];
  await db.sql(`
    insert into company_place (place_key, uid)
    select x.place_key, coalesce(x.uid, c.uid) from jsonb_to_recordset($1::jsonb) as x(place_key text, domain text, uid text)
    left join company c on c.domain = x.domain
    on conflict (place_key) do nothing`, [JSON.stringify(rows)]);
  // A listing two saves gave a UID at once keeps the first; the other's company has no listing and goes.
  if (lone.length) {
    await db.sql(`delete from company c where c.uid = any($1::text[]) and not exists (select 1 from company_place p where p.uid = c.uid)`,
      [lone.map((l) => l.uid)]);
  }
  return fresh.length;
}

/** Every research lead without a UID gets one, 2,000 listings at a time. Run at start; safe to run again. */
export async function backfill(): Promise<number> {
  await migrate();
  let total = 0;
  for (;;) {
    const rows = (await db.sql<{ place_key: string; website: string | null }>(`
      select distinct on (p.place_key) p.place_key, p.business->>'website' as website
      from search_list_place p
      where not exists (select 1 from company_place c where c.place_key = p.place_key)
      order by p.place_key, (p.business ? 'website') desc
      limit 2000`)).rows;
    if (!rows.length) return total;
    const n = await assign(rows);
    if (!n) return total;
    total += n;
  }
}

export const isUid = (v: unknown): v is string => typeof v === 'string' && /^co_[a-f0-9]{12}$/.test(v);

/**
 * The company UID a report belongs to: one company, many reports on different
 * dates. An explicit UID wins when it exists; else the UID of the website host
 * (the request's `website`, or the first http(s) URL in the company text). With
 * `create`, a host no lead has is given a UID now, so a company that was never in
 * a search still gets one page. null when there is nothing to group by.
 */
export async function resolve(input: { uid?: unknown; website?: unknown; text?: unknown; create?: boolean }): Promise<string | null> {
  await migrate();
  if (isUid(input.uid)) {
    const hit = (await db.sql(`select uid from company where uid = $1`, [input.uid])).rows[0] as { uid: string } | undefined;
    if (hit) return hit.uid;
  }
  const text = typeof input.text === 'string' ? input.text : '';
  const site = (typeof input.website === 'string' && input.website.trim()) || text.match(/https?:\/\/[^\s)]+/i)?.[0] || '';
  const domain = companyDomain(site);
  if (!domain) return null;
  if (input.create) {
    await db.sql(`insert into company (uid, domain) values ($1, $2) on conflict (domain) do nothing`, [newUid(), domain]);
  }
  return ((await db.sql(`select uid from company where domain = $1`, [domain])).rows[0] as { uid: string } | undefined)?.uid ?? null;
}

/** Reports saved before dives carried a UID get theirs: the website in their company text, and their dive's UID for a dive-deeper. Safe to run again. */
export async function backfillReports(): Promise<number> {
  await migrate();
  let n = 0;
  const has = (await db.sql(`select to_regclass('company_dive') as d, to_regclass('dive_deeper') as dd`)).rows[0] as { d: string | null; dd: string | null };
  if (!has.d) return 0;
  const cols = (await db.sql(`select 1 from information_schema.columns where table_name = 'company_dive' and column_name = 'company_uid'`)).rows.length;
  if (!cols) return 0;
  // The website in the company text, else the official domain the dive's own research found.
  const rows = (await db.sql(`select id, company, result->'identity'->'official_domains'->>0 as domain from company_dive where company_uid is null`)).rows as Array<{ id: string; company: string; domain: string | null }>;
  for (const row of rows) {
    const found = row.domain ? (/^https?:/i.test(row.domain) ? row.domain : 'https://' + row.domain) : undefined;
    const uid = await resolve({ text: row.company, create: true }) ?? (found ? await resolve({ website: found, create: true }) : null);
    if (uid) { await db.sql(`update company_dive set company_uid = $2 where id = $1`, [row.id, uid]); n++; }
  }
  if (has.dd) {
    await db.sql(`update dive_deeper d set company_uid = c.company_uid from company_dive c where d.dive_id = c.id and d.company_uid is null and c.company_uid is not null`);
  }
  return n;
}

const originOf = (req: http.IncomingMessage): string =>
  `${String(req.headers['x-forwarded-proto'] ?? 'https').split(',')[0]}://${req.headers['x-forwarded-host'] ?? req.headers.host}`;

const plainName = (text: string): string => text.replace(/\s*\(https?:\/\/[^)]*\)\s*$/i, '').trim();

/** Every report of one company, newest first: each company dive with the dive-deeper runs made on it. */
export async function reports(uid: string, base: string): Promise<Array<Record<string, unknown>>> {
  const has = (await db.sql(`select to_regclass('company_dive') as d, to_regclass('dive_deeper') as dd`)).rows[0] as { d: string | null; dd: string | null };
  if (!has.d) return [];
  const dives = (await db.sql(`
    select id, public_id, company, country, status, stage, error, created_at, finished_at, tavily_calls, tavily_credits, brave_calls,
           result->'llm' as llm, result->'people'->'llm' as people_llm, result->'people'->'exa' as people_exa, result->'tavily' as tavily
    from company_dive where company_uid = $1 order by created_at desc`, [uid])).rows as Array<Record<string, any>>;
  const deeper = has.dd ? (await db.sql(`
    select id, public_id, dive_id, status, stage, error, created_at, finished_at, lanes
    from dive_deeper where company_uid = $1 order by created_at desc`, [uid])).rows as Array<Record<string, any>> : [];
  const runsOf = (diveId: string) => deeper.filter((d) => String(d.dive_id) === String(diveId)).map((d) => {
    const used = emptyUsage();
    for (const lane of Object.values(d.lanes ?? {}) as Array<{ meter?: unknown }>) addMeter(used, lane?.meter as never);
    return {
      id: Number(d.id), public_id: d.public_id, status: d.status, stage: d.stage, error: d.error ?? null,
      created_at: d.created_at, finished_at: d.finished_at, report_url: `${base}/dd/${d.public_id}`, cost_usd: price(used).usd,
    };
  });
  return dives.map((d) => ({
    dive_id: Number(d.id), public_id: d.public_id, company: plainName(d.company), country: d.country, status: d.status, stage: d.stage, error: d.error ?? null,
    created_at: d.created_at, finished_at: d.finished_at, report_url: `${base}/d/${d.public_id}`, preview_url: `${base}/dp/${d.public_id}`,
    cost_usd: price(diveUsage({ tavily_calls: d.tavily_calls, tavily_credits: d.tavily_credits, brave_calls: d.brave_calls, llm: d.llm, people_llm: d.people_llm, people_exa: d.people_exa, tavily: d.tavily })).usd,
    deeper: runsOf(d.id),
  }));
}

/** One company: its UID, website host, every listing of it in every run, and every report run on it. */
export async function company(uid: string, base = ''): Promise<Record<string, unknown> | null> {
  await migrate();
  const row = (await db.sql(`select uid, domain, created_at from company where uid = $1`, [uid])).rows[0];
  if (!row) return null;
  const listings = (await db.sql(`
    select cp.place_key, max(p.business->>'name') as name, max(p.business->>'address') as address, max(p.business->>'website') as website,
           array_agg(distinct p.run_id) filter (where p.run_id is not null) as runs
    from company_place cp left join search_list_place p on p.place_key = cp.place_key
    where cp.uid = $1 group by cp.place_key order by 2`, [uid])).rows as Array<Record<string, any>>;
  const list = await reports(uid, base);
  const name = (list[0]?.company as string | undefined) || (listings.find((l) => l.name)?.name as string | undefined) || (row as { domain?: string }).domain || uid;
  const country = (list[0]?.country as string | undefined) ?? null;
  return { ...row, name, country, listings, reports: list };
}

/** Companies that have at least one report, most recently reported first. */
export async function withReports(opts: { q?: string; limit?: number } = {}): Promise<Array<Record<string, unknown>>> {
  await migrate();
  const has = (await db.sql(`select to_regclass('company_dive') as d`)).rows[0] as { d: string | null };
  if (!has.d) return [];
  const q = (opts.q ?? '').trim().toLowerCase();
  const rows = (await db.sql(`
    select c.uid, c.domain, (array_agg(d.company order by d.created_at desc))[1] as name, count(*)::int as reports, max(d.created_at) as last_report_at
    from company_dive d join company c on c.uid = d.company_uid
    where $1 = '' or lower(c.domain) like '%' || $1 || '%' or lower(d.company) like '%' || $1 || '%' or c.uid = $1
    group by c.uid, c.domain order by max(d.created_at) desc limit $2`, [q, Math.min(Math.max(opts.limit ?? 100, 1), 500)])).rows as Array<Record<string, any>>;
  return rows.map((r) => ({ ...r, name: plainName(String(r.name ?? '')) || r.domain }));
}

type Ctx = { json: (res: http.ServerResponse, status: number, body: unknown) => void };

/** GET /api/companies (companies that have reports; ?q= ?limit=) and GET /api/companies/:uid (LAB_TOKEN): one company, its listings and its reports. */
export async function handle(req: http.IncomingMessage, res: http.ServerResponse, url: URL, { json }: Ctx): Promise<boolean> {
  if (req.method !== 'GET') return false;
  if (url.pathname === '/api/companies') {
    if (!db.configured()) return json(res, 503, { error: 'no report database configured' }), true;
    const found = await withReports({ q: url.searchParams.get('q') ?? '', limit: Number(url.searchParams.get('limit') ?? 100) });
    return json(res, 200, { companies: found }), true;
  }
  const m = /^\/api\/companies\/(co_[a-f0-9]{12})$/.exec(url.pathname);
  if (!m) return false;
  if (!db.configured()) return json(res, 503, { error: 'no report database configured' }), true;
  const found = await company(m[1]!, originOf(req));
  return json(res, found ? 200 : 404, found ?? { error: 'no such company' }), true;
}
