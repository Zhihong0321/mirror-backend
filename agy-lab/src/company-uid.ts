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

/** One company: its UID, website host and every listing of it in every run. */
export async function company(uid: string): Promise<Record<string, unknown> | null> {
  await migrate();
  const row = (await db.sql(`select uid, domain, created_at from company where uid = $1`, [uid])).rows[0];
  if (!row) return null;
  const listings = (await db.sql(`
    select cp.place_key, max(p.business->>'name') as name, max(p.business->>'address') as address, max(p.business->>'website') as website,
           array_agg(distinct p.run_id) filter (where p.run_id is not null) as runs
    from company_place cp left join search_list_place p on p.place_key = cp.place_key
    where cp.uid = $1 group by cp.place_key order by 2`, [uid])).rows;
  return { ...row, listings };
}

type Ctx = { json: (res: http.ServerResponse, status: number, body: unknown) => void };

/** GET /api/companies/:uid (LAB_TOKEN): one company and its listings. */
export async function handle(req: http.IncomingMessage, res: http.ServerResponse, url: URL, { json }: Ctx): Promise<boolean> {
  const m = /^\/api\/companies\/(co_[a-f0-9]{12})$/.exec(url.pathname);
  if (!m || req.method !== 'GET') return false;
  if (!db.configured()) return json(res, 503, { error: 'no report database configured' }), true;
  const found = await company(m[1]!);
  return json(res, found ? 200 : 404, found ?? { error: 'no such company' }), true;
}
