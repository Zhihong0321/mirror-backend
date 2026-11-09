// A / assets — digital assets: everything about the company's domains and sites that anyone can
// trace from the public internet (part 5 of the malaysia-deeper-dive report).
//
// Domains come from the dive (official domains, domains in its facts that carry the brand word),
// C-merged (redirecting domains, the domains its email addresses use). For each one:
//   - registration: MYNIC whois (port 43) for .my, RDAP (IANA bootstrap) for the rest: registrar,
//     created, expiry, registrant organisation when it is public, status;
//   - DNS: A, NS, MX, SPF and DMARC (can a stranger send email that looks like it came from you?);
//   - hosting: who owns the server's IP (RDAP of the address);
//   - the site itself: status, redirect, parked or for-sale page, TLS certificate, CMS and version;
//   - subdomains from the public certificate logs (crt.sh), checked for forgotten live sites;
//   - lookalike domains: the brand word on .com, .my and .com.my, held by someone else or free;
//   - email reputation, for every domain that receives mail: its mail servers' addresses on the
//     Barracuda and SpamCop blacklists (free DNS lookups, each list proved working first with its
//     own test entry), the SPF record read in full (duplicates, "allow anyone", over Google's limit
//     of 10 lookups), DKIM keys on the usual names, DMARC, and MTA-STS / TLS reporting. Spamhaus
//     refuses public DNS and its free key is non-commercial only, so it is named as not checked.
// No LLM. Every lookup falls back: a failed one leaves its cell empty and logs a warning.
import net from 'node:net';
import tls from 'node:tls';
import dnsp from 'node:dns/promises';
import { readLane, nameOf, type Ctx, type Finding } from '../lib.ts';
import { savedDomain } from '../asset-reuse.ts';

const FREE_MAIL = /^(gmail|googlemail|yahoo|ymail|hotmail|outlook|live|icloud|me|aol|proton|protonmail|qq|163|126|zoho)\./i;
const PARKED = /\b(domain (is )?for sale|buy this domain|this domain (name )?(is|may be) (for sale|parked|available)|parked (free|domain)|sedo|dan\.com|afternic|hugedomains|domain has expired|renew (this|your) domain|website (is )?coming soon)\b/i;
const day = 86_400_000;

type Reg = { registrar: string | null; created: string | null; expires: string | null; updated: string | null; org: string | null; status: string[]; ns: string[]; source: string; error?: string };

/** One whois query over port 43 (MYNIC for .my). '' on failure; never throws. */
function whois43(host: string, query: string): Promise<string> {
  return new Promise((resolve) => {
    let out = '';
    const s = net.connect(43, host, () => s.write(query + '\r\n'));
    s.setEncoding('utf8');
    s.on('data', (c) => { out += c; });
    s.on('end', () => resolve(out));
    s.on('error', () => resolve(out));
  });
}

let bootstrap: { dns?: any; ipv4?: any } = {};
async function rdapBase(kind: 'dns' | 'ipv4', key: string): Promise<string | null> {
  try {
    bootstrap[kind] ??= await (await fetch(`https://data.iana.org/rdap/${kind}.json`, { signal: AbortSignal.timeout(60_000) })).json();
    if (kind === 'dns') return bootstrap.dns.services.find((s: any) => s[0].includes(key))?.[1]?.[0] ?? null;
    const [a, b] = key.split('.').map(Number);
    // IPv4 bootstrap entries are /8 prefixes ("35.0.0.0/8"); the first octet is enough to pick the registry.
    return bootstrap.ipv4.services.find((s: any) => s[0].some((p: string) => Number(p.split('.')[0]) === a && (p.endsWith('/8') || Number(p.split('.')[1]) === b)))?.[1]?.[0] ?? null;
  } catch { return null; }
}

const vcardName = (e: any) => e?.vcardArray?.[1]?.find((v: any) => v[0] === 'fn')?.[3] ?? null;
const vcardOrg = (e: any) => e?.vcardArray?.[1]?.find((v: any) => v[0] === 'org')?.[3] ?? null;

/** The usual whois fields, read from a port-43 answer. */
function parseWhois(raw: string, source: string): Reg {
  const field = (...ks: string[]) => { for (const k of ks) { const v = raw.match(new RegExp(`^\s*${k}:\s*(.+)$`, 'im'))?.[1]?.trim(); if (v) return v; } return null; };
  if (!raw) return { registrar: null, created: null, expires: null, updated: null, org: null, status: [], ns: [], source, error: 'no answer' };
  if (/no match|not found|no data found|no entries found|status:\s*free/i.test(raw.slice(0, 400))) return { registrar: null, created: null, expires: null, updated: null, org: null, status: [], ns: [], source, error: 'not registered' };
  const org = field('Registrant Organization', 'Registrant Organisation', 'Registrant');
  return {
    registrar: field('Registrar', 'Sponsoring Registrar'), created: field('Creation Date', 'Created On', 'Registered On'),
    expires: field('Registry Expiry Date', 'Registrar Registration Expiration Date', 'Expiry Date', 'Expiration Date'), updated: field('Updated Date', 'Last Updated On'),
    org: org && !/redacted|privacy|proxy|withheld|not disclosed/i.test(org) ? org : null,
    status: [...raw.matchAll(/^\s*Domain Status:\s*(\S+)/gim)].map((m) => m[1]),
    ns: [...raw.matchAll(/^\s*Name Server:\s*(\S+)/gim)].map((m) => m[1].toLowerCase()),
    source,
  };
}

async function registration(domain: string): Promise<Reg> {
  if (/\.my$/.test(domain)) return parseWhois(await whois43('whois.mynic.my', domain), 'MYNIC whois');
  const tld = domain.split('.').pop()!;
  const base = await rdapBase('dns', tld);
  if (!base) {
    // No RDAP for this ending (.me, for one): ask IANA which whois server holds it.
    const refer = (await whois43('whois.iana.org', tld)).match(/^(?:refer|whois):\s*(\S+)/im)?.[1];
    return refer ? parseWhois(await whois43(refer, domain), `whois ${refer}`) : { registrar: null, created: null, expires: null, updated: null, org: null, status: [], ns: [], source: 'whois', error: `no registry found for .${tld}` };
  }
  try {
    const res = await fetch(`${base.replace(/\/?$/, '/')}domain/${domain}`, { headers: { accept: 'application/rdap+json' }, signal: AbortSignal.timeout(60_000) });
    if (res.status === 404) return { registrar: null, created: null, expires: null, updated: null, org: null, status: [], ns: [], source: 'RDAP', error: 'not registered' };
    const j = await res.json() as any;
    const ev = (a: string) => j.events?.find((e: any) => e.eventAction === a)?.eventDate ?? null;
    const registrar = j.entities?.find((e: any) => e.roles?.includes('registrar'));
    const registrant = j.entities?.find((e: any) => e.roles?.includes('registrant'));
    const org = vcardOrg(registrant) ?? vcardName(registrant);
    return {
      registrar: vcardName(registrar), created: ev('registration'), expires: ev('expiration'), updated: ev('last changed'),
      org: org && !/redacted|privacy|proxy|withheld/i.test(org) ? org : null,
      status: j.status ?? [], ns: (j.nameservers ?? []).map((n: any) => String(n.ldhName).toLowerCase()), source: 'RDAP',
    };
  } catch (e) {
    return { registrar: null, created: null, expires: null, updated: null, org: null, status: [], ns: [], source: 'RDAP', error: (e as Error).message };
  }
}

async function dnsOf(domain: string) {
  const q = async <T>(f: () => Promise<T>): Promise<T | null> => { try { return await f(); } catch { return null; } };
  const [a, ns, mx, txt, dmarc] = await Promise.all([
    q(() => dnsp.resolve4(domain)), q(() => dnsp.resolveNs(domain)), q(() => dnsp.resolveMx(domain)),
    q(() => dnsp.resolveTxt(domain)), q(() => dnsp.resolveTxt('_dmarc.' + domain)),
  ]);
  const flat = (x: string[][] | null) => (x ?? []).map((r) => r.join(''));
  return {
    a: a ?? [], ns: (ns ?? []).map((x) => x.toLowerCase()), mx: (mx ?? []).sort((p, q2) => p.priority - q2.priority).map((x) => x.exchange.toLowerCase()),
    spf: flat(txt).find((t) => /^v=spf1/i.test(t)) ?? null,
    dmarc: flat(dmarc).find((t) => /^v=DMARC1/i.test(t)) ?? null,
  };
}

const ipOwners = new Map<string, Promise<string | null>>();
function ipOwner(ip: string): Promise<string | null> {
  if (!ipOwners.has(ip)) ipOwners.set(ip, (async () => {
    const base = await rdapBase('ipv4', ip);
    if (!base) return null;
    try {
      const j = await (await fetch(`${base.replace(/\/?$/, '/')}ip/${ip}`, { headers: { accept: 'application/rdap+json' }, signal: AbortSignal.timeout(60_000) })).json() as any;
      const org = (j.entities ?? []).map((e: any) => vcardOrg(e) ?? vcardName(e)).find(Boolean);
      return [j.name, org].filter(Boolean).join(' · ') || null;
    } catch { return null; }
  })());
  return ipOwners.get(ip)!;
}

function certOf(host: string): Promise<{ ok: boolean; issuer: string | null; validTo: string | null; daysLeft: number | null; error?: string }> {
  return new Promise((resolve) => {
    const s = tls.connect({ host, port: 443, servername: host, rejectUnauthorized: false }, () => {
      const c = s.getPeerCertificate();
      const validTo = c?.valid_to ? new Date(c.valid_to).toISOString() : null;
      resolve({ ok: s.authorized, issuer: (c?.issuer?.O as string) ?? null, validTo, daysLeft: validTo ? Math.floor((Date.parse(validTo) - Date.now()) / day) : null, error: s.authorized ? undefined : String(s.authorizationError ?? '') });
      s.end();
    });
    s.on('error', (e) => resolve({ ok: false, issuer: null, validTo: null, daysLeft: null, error: e.message }));
  });
}

/** What runs the site, from headers and the page itself. */
function techOf(headers: Record<string, string>, html: string, useHeaders = false): { stack: string[]; cms: string | null; version: string | null } {
  if (useHeaders) headers = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  const stack = new Set<string>();
  const gen = html.match(/<meta[^>]+name=["']generator["'][^>]+content=["']([^"']+)/i)?.[1]
    ?? (useHeaders ? headers['x-generator'] ?? headers['x-powered-by'] : null) ?? null;
  if (headers.server) stack.add(`server: ${headers.server}`);
  if (headers['x-powered-by']) stack.add(`powered by: ${headers['x-powered-by']}`);
  if (/cloudflare/i.test(headers.server ?? '') || headers['cf-ray']) stack.add('Cloudflare');
  if (gen) stack.add(gen);
  let cms: string | null = null;
  if (/wp-content|wp-includes/i.test(html) || /wordpress/i.test(gen ?? '') || (useHeaders && /wp-json/i.test(headers.link ?? ''))) cms = 'WordPress';
  else if (/cdn\.shopify|shopify/i.test(html)) cms = 'Shopify';
  else if (/wix\.com|wixstatic/i.test(html)) cms = 'Wix';
  else if (/squarespace/i.test(html)) cms = 'Squarespace';
  else if (/joomla/i.test(gen ?? '')) cms = 'Joomla';
  if (cms) stack.add(cms);
  const version = (gen ?? '').match(useHeaders ? /(?:wordpress|joomla)[\s/]+([\d.]+)/i : /(?:wordpress|joomla)\s+([\d.]+)/i)?.[1] ?? null;
  return { stack: [...stack], cms, version };
}

// ---------------------------------------------------------------- email reputation

/** The blacklists that answer free DNS lookups (tested 2026-10-30); 127.0.0.2 is each one's own test entry. */
const BLACKLISTS = [
  { id: 'barracuda', name: 'Barracuda', zone: 'b.barracudacentral.org' },
  { id: 'spamcop', name: 'SpamCop', zone: 'bl.spamcop.net' },
];
/** Where the big mail services keep their DKIM keys. */
const DKIM_SELECTORS = ['google', 'selector1', 'selector2', 'default', 'dkim', 'mail', 'k1', 's1', 's2', 'zoho', 'zmail', 'mxvault', 'hostingermail1', 'x'];

const txtOf = async (name: string): Promise<string[]> => (await dnsp.resolveTxt(name).catch(() => [] as string[][])).map((r) => r.join(''));

/** "listed" | "clear" for one IPv4 address on one list; null when the lookup itself failed. */
async function listed(ip: string, zone: string): Promise<'listed' | 'clear' | null> {
  try {
    const a = await dnsp.resolve4(`${ip.split('.').reverse().join('.')}.${zone}`);
    // 127.0.0.x is a listing; anything else (127.255.255.x) is the list refusing to answer.
    return a.some((x) => /^127\.0\.0\.\d+$/.test(x)) ? 'listed' : null;
  } catch (e) {
    return (e as any).code === 'ENOTFOUND' || (e as any).code === 'ENODATA' ? 'clear' : null;
  }
}

/** Counts the DNS lookups an SPF check needs (include, a, mx, ptr, exists, redirect), following includes. */
async function spfLookups(record: string, depth = 0, seen = new Set<string>()): Promise<number> {
  let n = 0;
  for (const term of record.split(/\s+/).slice(1)) {
    const m = term.match(/^[+?~-]?(include|a|mx|ptr|exists|redirect)(?:[:=](.+))?$/i);
    if (!m) continue;
    n++;
    const kind = m[1].toLowerCase();
    if ((kind === 'include' || kind === 'redirect') && m[2] && depth < 6 && !seen.has(m[2])) {
      seen.add(m[2]);
      const inner = (await txtOf(m[2])).find((t) => /^v=spf1/i.test(t));
      if (inner) n += await spfLookups(inner, depth + 1, seen);
    }
  }
  return n;
}

async function emailReputation(domain: string, mx: string[]) {
  const ips = [...new Set((await Promise.all(mx.slice(0, 4).map((h) => dnsp.resolve4(h).catch(() => [] as string[])))).flat())].slice(0, 6);
  const lists: Record<string, { listed: string[]; checked: number; failed: number }> = {};
  for (const bl of BLACKLISTS) {
    const res = await Promise.all(ips.map(async (ip) => ({ ip, r: await listed(ip, bl.zone) })));
    lists[bl.id] = { listed: res.filter((x) => x.r === 'listed').map((x) => x.ip), checked: res.filter((x) => x.r).length, failed: res.filter((x) => !x.r).length };
  }
  const spfs = (await txtOf(domain)).filter((t) => /^v=spf1/i.test(t));
  const spf = spfs[0] ?? null;
  const all = spf?.match(/([+?~-]?)all\b/i);
  const dkim = (await Promise.all(DKIM_SELECTORS.map(async (s) => ((await txtOf(`${s}._domainkey.${domain}`)).some((t) => /v=DKIM1|k=rsa|p=/i.test(t)) ? s : null)))).filter(Boolean) as string[];
  const dmarc = (await txtOf('_dmarc.' + domain)).find((t) => /^v=DMARC1/i.test(t)) ?? null;
  return {
    domain, mx: mx.slice(0, 4), ips, lists,
    spf: { records: spfs.length, record: spf, lookups: spf ? await spfLookups(spf) : 0, all: all ? (all[1] || '+') + 'all' : null },
    dkim, dmarc: dmarc ? (dmarc.match(/p=(\w+)/i)?.[1] ?? 'set') : null,
    mta_sts: (await txtOf('_mta-sts.' + domain)).some((t) => /^v=STSv1/i.test(t)),
    tls_rpt: (await txtOf('_smtp._tls.' + domain)).some((t) => /^v=TLSRPTv1/i.test(t)),
  };
}

const SOCIAL = /^(?:[a-z]+\.)?(facebook|instagram|linkedin|tiktok|youtube|x|twitter|xiaohongshu|threads)\.com$/i;

// ---------------------------------------------------------------- ownership, wording, merging (PL3, PL5, PL14, PL2)

/** owned: the registrant is the company. used_by: the company uses the domain but the registrant is someone else or hidden. unknown: no tie shown. */
export type Ownership = 'owned' | 'used_by' | 'unknown';
const LEGAL_WORDS = new Set(['sdn', 'bhd', 'berhad', 'ltd', 'limited', 'llc', 'inc', 'incorporated', 'corp', 'corporation', 'plc', 'plt', 'pte', 'pty', 'gmbh', 'ag', 'sa', 'srl', 'bv', 'oy', 'ab', 'co', 'company', 'the', 'and', 'for', 'kk', 'pvt', 'private', 'public']);
const allTokens = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu, ' ').split(' ').filter((t) => t && !LEGAL_WORDS.has(t));
const nameTokens = (s: string) => allTokens(s).filter((t) => t.length >= 3);
/** Decided from data the lane already has: the registrant organisation against the company's names, and whether the company presents the domain as its own. */
export function ownershipOf(registrant: string | null | undefined, companyNames: string[], linked: boolean): Ownership {
  const reg = new Set(nameTokens(registrant ?? ''));
  if (reg.size) {
    const same = companyNames.map(nameTokens).some((c) => c.length && (c.every((t) => reg.has(t)) || [...reg].every((t) => c.includes(t))));
    if (same) return 'owned';
  }
  // A short name ("HP", "3M") has no token of 3+ characters: it matches when each of its words is a whole word of the registrant.
  const regWords = new Set(allTokens(registrant ?? ''));
  if (companyNames.some((n) => !nameTokens(n).length && allTokens(n).length && allTokens(n).every((t) => regWords.has(t)))) return 'owned';
  return linked ? 'used_by' : 'unknown';
}
/** The weakest ownership of a group: a sentence about several domains may say "yours" only if all are. */
export function weakest(list: Ownership[]): Ownership {
  return list.length && list.every((o) => o === 'owned') ? 'owned' : list.includes('used_by') ? 'used_by' : 'unknown';
}
/** Fixes are written as orders for the owner; anyone else gets them as "if you control it". */
export function fixFor(own: Ownership, fix: string, many = false): string {
  return own === 'owned' ? fix : `If you control ${many ? 'them' : 'it'}, ${fix[0].toLowerCase()}${fix.slice(1)}`;
}
/** PL2: who wrote the source. Registers, RDAP/WHOIS and blacklists are independent; the company's own DNS and site are first-party. */
const PARTY: Record<string, 'first' | 'independent'> = {
  unregistered: 'independent', expiry: 'independent', registrant: 'independent', lookalike: 'independent', 'email-blacklist': 'independent', inventory: 'independent',
};

type Row = { domain: string; ownership: Ownership; text: string; source: string | null; evidence?: string; expires_at?: string };
const SEV = { info: 0, low: 1, medium: 2, high: 3 } as const;
/** PL14: the same failed check on several domains becomes one finding with one evidence row per domain. */
export function mergeByCheck(list: Finding[]): Finding[] {
  // The label names the failure mode: "expired" and "expires soon", or "no DMARC" and "p=none", are different findings.
  const keyOf = (f: Finding) => `${f.check}|${f.sub ?? ''}|${f.label ?? ''}`;
  const groups = new Map<string, Finding[]>();
  for (const f of list) if (f.label && f.domain) (groups.get(keyOf(f)) ?? groups.set(keyOf(f), []).get(keyOf(f))!).push(f);
  const row = (f: Finding): Row => ({ domain: String(f.domain), ownership: f.ownership as Ownership, text: f.title, source: f.source, ...(f.evidence ? { evidence: f.evidence } : {}), ...(f.expires_at ? { expires_at: String(f.expires_at) } : {}) });
  const out: Finding[] = [];
  const done = new Set<string>();
  for (const f of list) {
    const g = f.label && f.domain ? groups.get(keyOf(f))! : null;
    if (!g || new Set(g.map((x) => x.domain)).size < 2) {
      if (g) { const { label, what, fix, sub, ...rest } = f; out.push({ ...rest, evidence_rows: [row(f)] } as Finding); } else out.push(f);
      continue;
    }
    if (done.has(keyOf(f))) continue;
    done.add(keyOf(f));
    const domains = [...new Set(g.map((x) => String(x.domain)))];
    const own = weakest(g.map((x) => x.ownership as Ownership));
    const dates = g.map((x) => x.expires_at).filter(Boolean).map(String).sort();
    out.push({
      title: `${f.label} on ${domains.length} domains: ${domains.join(', ')}`,
      detail: `${f.what}${f.fix ? ' ' + fixFor(own, String(f.fix), true) : ''}`,
      severity: g.reduce((m, x) => (SEV[x.severity] > SEV[m] ? x.severity : m), 'info' as Finding['severity']),
      source: f.source, checked_at: f.checked_at, check: f.check, domain: domains[0], domains, ownership: own,
      ...(dates.length ? { expires_at: dates[0] } : {}), evidence_rows: g.map(row),
    } as Finding);
  }
  return out;
}

export async function run(ctx: Ctx, dive: any): Promise<{ findings: Finding[]; notes: Record<string, unknown> }> {
  const r = dive.result ?? {};
  const N = nameOf(dive);
  const C = readLane(ctx.diveId, 'C-merged')?.notes ?? {};
  const findings: Finding[] = [];
  const add = (f: Omit<Finding, 'checked_at'>) => findings.push({ ...f, checked_at: ctx.now() } as Finding);
  const brand = N.brand.length >= 4 ? N.brand : '';
  const companyNames = [N.legal, N.bare, N.short, ...(r.identity?.aliases ?? [])].map(String).filter(Boolean);

  // ---- 1. Which domains are the company's. ----
  const why = new Map<string, Set<string>>();
  const note = (d: string, w: string) => { d = d.toLowerCase().replace(/^www\./, '').replace(/\.$/, ''); if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(d)) return; (why.get(d) ?? why.set(d, new Set()).get(d)!).add(w); };
  for (const d of N.domains) note(d, 'official site');
  for (const x of C.redirects ?? []) note(x.domain, 'redirects to your site');
  for (const list of Object.values(C.emails ?? {}) as string[][]) for (const e of list) { const d = e.split('@')[1]; if (d && !FREE_MAIL.test(d + '.')) note(d, 'used for email'); }
  const factText = JSON.stringify(r.facts ?? []);
  for (const m of factText.matchAll(/\b([a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com\.my|net\.my|org\.my|my|com|net|asia|biz|co))\b/gi)) {
    if (brand && m[1].toLowerCase().includes(brand)) note(m[1], 'named in public sources');
  }
  for (const m of factText.matchAll(/[a-z0-9._%+-]+@([a-z0-9-]+(?:\.[a-z0-9-]+)+)/gi)) if (!FREE_MAIL.test(m[1] + '.') && (!brand || m[1].toLowerCase().includes(brand))) note(m[1], 'used for email');
  const domains = [...why.keys()].slice(0, 10);
  if (!domains.length) { ctx.warn('no domains to check'); return { findings, notes: { domains: [] } }; }
  ctx.log(`domains: ${domains.join(', ')}`);

  // ---- 2. Each domain: registration, DNS, hosting, the site. ----
  const assets = await Promise.all(domains.map(async (d) => {
    const prior = ctx.v21 ? savedDomain(dive, d) : undefined;
    const [reg, dns] = prior ? [
      { registrar: null, created: null, expires: null, updated: null, org: null, status: [], ns: [], source: 'Step 1.5', ...prior.registration } as Reg,
      { a: [], ns: [], mx: [], spf: null, dmarc: null, ...prior.dns } as Awaited<ReturnType<typeof dnsOf>>,
    ] : await Promise.all([registration(d), dnsOf(d)]);
    if (reg.error && reg.error !== 'not registered') ctx.warn(`${d}: registration lookup failed (${reg.error})`);
    const host = dns.a[0] ? await ipOwner(dns.a[0]) : null;
    let site: any = null;
    if (dns.a.length) {
      const p = await ctx.page(`https://${d}/`, { headers: { accept: 'text/html' } });
      const fallback = p.status === 0 ? await ctx.page(`http://${d}/`, { headers: { accept: 'text/html' } }) : null;
      const q = fallback && fallback.status ? fallback : p;
      const text = ctx.htmlText(q.html).slice(0, 4000);
      const title = q.html.match(/<title[^>]*>([^<]*)/i)?.[1]?.trim() ?? '';
      site = {
        status: q.status, final: q.finalUrl, https: !fallback || !fallback.status, error: q.status ? undefined : (q.error ?? p.error),
        title, parked: PARKED.test(title + ' ' + text) && text.length < 3000, ...techOf(q.headers ?? {}, q.html, ctx.v21),
        ...(ctx.v21 ? { cms_note: Object.keys(q.headers ?? {}).length ? 'CMS checked from worker headers and HTML.' : 'Worker sent no headers; CMS checked from HTML only.' } : {}),
        social: [...new Set([...q.html.matchAll(/href=["'](https?:\/\/[^"'#]+)["']/gi)].map((m) => m[1]).filter((u) => SOCIAL.test(N.hostOf(u))))].slice(0, 12),
      };
    }
    const cert = prior ? (prior.tls ? { ok: prior.tls.valid, issuer: prior.tls.issuer ?? null, validTo: prior.tls.expires_at ?? null, daysLeft: prior.tls.days_remaining ?? null, error: prior.tls.error } : null)
      : dns.a.length ? await certOf(d) : null;
    const own = ownershipOf(reg.org, companyNames, [...why.get(d)!].some((w) => w !== 'named in public sources'));
    return { domain: d, why: [...why.get(d)!], reg, dns, host, site, cert, prior, own };
  }));

  // ---- 3. Findings, domain by domain. ----
  const now = Date.now();
  const ownOf = new Map(assets.map((a) => [a.domain, a.own] as const));
  type MkOpts = { label: string; title: string; what: string; fix?: string; severity: Finding['severity']; source: string | null; evidence?: string; expires_at?: string; sub?: string };
  // One place builds a domain finding: `what` is the shared problem, `fix` the owner's order (reworded unless the domain is proven theirs).
  const mkd = (domain: string, own: Ownership, check: string, o: MkOpts) =>
    add({ title: o.title, detail: `${o.what}${o.fix ? ' ' + fixFor(own, o.fix) : ''}`, severity: o.severity, source: o.source, check, domain, ownership: own, label: o.label, what: o.what, fix: o.fix, sub: o.sub, evidence: o.evidence, expires_at: o.expires_at });
  for (const a of assets) {
    const d = a.domain;
    const used = a.why.join(', ');
    const src = a.reg.source === 'MYNIC whois' ? `https://whois.mynic.my/` : `https://lookup.icann.org/en/lookup?name=${d}`;
    const mk = (check: string, o: MkOpts) => mkd(d, a.own, check, o);
    // Step 1.5 already reported these domain checks. Keep its answers in the table.
    if (!a.prior) {
      if (a.reg.error === 'not registered') {
        mk('unregistered', { label: 'Domain not registered to anyone', title: `${d} is not registered to anyone`, what: `It is ${used}, yet nobody holds the domain. Anyone can register it today and receive emails sent to it or show visitors their own page.`, severity: 'high', source: src });
        continue;
      }
      const left = a.reg.expires ? Math.floor((Date.parse(a.reg.expires) - now) / day) : null;
      const iso = a.reg.expires && !Number.isNaN(Date.parse(a.reg.expires)) ? new Date(a.reg.expires).toISOString() : undefined;
      if (left !== null && left < 0) mk('expiry', { label: 'Registration expired', title: `${d} expired on ${a.reg.expires!.slice(0, 10)}`, what: 'The registration has run out and the registrar may release it to someone else.', fix: 'Renew it before the registrar releases it.', severity: 'high', source: src, expires_at: iso });
      else if (left !== null && left <= 90) mk('expiry', { label: 'Registration expires soon', title: `${d} expires in ${left} days (${a.reg.expires!.slice(0, 10)})`, what: 'If the renewal fails (an old card, an ex-staff mailbox getting the reminder), the site and every email address on it stop working.', fix: 'Turn on auto-renew and check who receives the reminders.', severity: left <= 30 ? 'high' : 'medium', source: src, expires_at: iso });
      if (a.reg.org && a.own !== 'owned') mk('registrant', { label: 'Registered to another party', title: `${d} is registered to "${a.reg.org}", not to your company`, what: 'Whoever is the registrant controls the domain. If that is a web designer, an agency or a former staff member, moving or renewing it needs their cooperation.', fix: "Transfer it to the company's own name.", severity: 'medium', source: src });
      if (!a.dns.a.length && !a.dns.mx.length) mk('dns', { label: 'Domain does not point anywhere', title: `${d} does not point anywhere`, what: `It is ${used}, but it has no website and no email server. A customer typing it or emailing it reaches nothing.`, severity: a.why.includes('official site') || a.why.includes('used for email') ? 'high' : 'medium', source: src });
      if (a.why.includes('used for email')) {
        if (!a.dns.mx.length) mk('mx', { label: 'Email cannot be delivered', title: `Email to @${d} cannot be delivered`, what: 'The domain has no mail server (MX) record, so messages customers send to its published address bounce.', severity: 'high', source: src });
        if (!a.dns.spf) mk('spf', { label: 'No SPF record', title: `No SPF record on ${d}`, what: 'Mail servers cannot tell which servers may send email from this domain, so real emails land in spam more often and fakes get through.', fix: 'Publish an SPF record that lists the servers you send from.', severity: 'medium', source: src });
        if (!a.dns.dmarc) mk('dmarc', { label: 'No DMARC record', title: `Anyone can send email that looks like it came from @${d}`, what: 'There is no DMARC record. Scammers can send fake invoices or payment requests from that address and nothing tells the receiving bank or customer to reject them.', fix: 'Set a DMARC record (start with p=none, then move to quarantine).', severity: 'medium', source: src });
        else if (/p=none/i.test(a.dns.dmarc)) mk('dmarc', { label: 'DMARC only watches', title: `The DMARC on ${d} only watches, it does not block fakes`, what: 'The record says p=none, so fake emails from the domain are still delivered.', fix: 'Move to p=quarantine once your own senders pass.', severity: 'low', source: src, evidence: a.dns.dmarc });
      }
    }
    if (a.site) {
      if (a.site.parked) mk('parked', { label: 'Parked or for-sale page', title: `${d} shows a parked or for-sale page`, what: `Visitors see "${a.site.title || 'a placeholder'}" instead of the business.`, severity: a.why.includes('official site') ? 'high' : 'medium', source: `https://${d}/` });
      else if (ctx.v21 && (a.site.status === 0 || a.site.error)) ctx.warn(`${d}: worker could not read the site (${a.site.error ?? 'no answer'})`);
      else if (a.site.status >= 400 || a.site.status === 0) mk('site-down', { label: 'Site does not open', title: `${d} does not open`, what: `It is ${used}, and a customer who types it ${a.site.status ? `gets an error page (${a.site.status})` : 'waits for a server that never answers'}.`, severity: a.why.includes('official site') ? 'high' : 'medium', source: `https://${d}/` });
      if (!a.prior && !a.site.https && a.site.status) mk('https', { label: 'Only opens without https', title: `${d} only opens without https`, what: 'Browsers mark the site "Not secure", which makes customers hesitate to fill in a form.', severity: 'medium', source: `http://${d}/` });
      if (a.site.cms === 'WordPress' && a.site.version && Number(a.site.version.split('.')[0]) < 6) mk('cms', { label: 'Out-of-date WordPress', title: `${d} runs WordPress ${a.site.version}, several years out of date`, what: 'Old WordPress versions have known security holes; hacked small-business sites are often turned into gambling or spam pages.', fix: 'Update WordPress and its plugins, or ask who maintains the site.', severity: 'medium', source: `https://${d}/` });
    }
    if (!a.prior && a.cert && a.site?.https && a.site.status) {
      if (!a.cert.ok) mk('cert', { label: 'Invalid security certificate', title: `The security certificate on ${d} is not valid`, what: `Browsers show a warning page (${a.cert.error}). Most customers turn back at that warning.`, severity: 'high', source: `https://${d}/` });
      else if (a.cert.daysLeft !== null && a.cert.daysLeft <= 14) mk('cert', { label: 'Security certificate about to run out', title: `The security certificate on ${d} runs out in ${a.cert.daysLeft} days`, what: `Issued by ${a.cert.issuer ?? 'unknown'}. If it does not renew by itself, visitors get a warning page.`, severity: 'medium', source: `https://${d}/`, expires_at: a.cert.validTo ?? undefined });
    }
  }

  // ---- 3b. Email reputation: every domain that receives mail. ----
  // Each list is proved to answer first (its test entry 127.0.0.2 must come back listed), so a
  // list that refuses this network reads "could not check", never "clear".
  const working = new Set<string>();
  // Email reputation also makes fresh DNS queries; never run it for a reused domain.
  const emailAssets = assets.filter((a) => !a.prior && a.dns.mx.length);
  for (const bl of ctx.v21 && !emailAssets.length ? [] : BLACKLISTS) if ((await listed('127.0.0.2', bl.zone)) === 'listed') working.add(bl.id); else ctx.log(`${bl.name} blacklist did not answer its test lookup; shown as not checked`);
  const email = await Promise.all(emailAssets.map((a) => emailReputation(a.domain, a.dns.mx)));
  for (const e of email) {
    for (const bl of BLACKLISTS) {
      const l = e.lists[bl.id];
      if (!working.has(bl.id)) { l.checked = 0; continue; }
      if (l.listed.length) mkd(e.domain, ownOf.get(e.domain) ?? 'unknown', 'email-blacklist', { sub: bl.id, label: `Mail server on the ${bl.name} spam blacklist`, title: `The mail server for @${e.domain} is on the ${bl.name} spam blacklist`, what: `${l.listed.join(', ')} (${e.mx.join(', ')}) is listed. Mail systems that use ${bl.name} reject or junk email from that server, so quotes and invoices sent from it may never arrive. If it is a web host's shared mail server, another customer of the host may have caused it.`, fix: 'Ask whoever runs the server to get it delisted.', severity: 'high', source: bl.id === 'barracuda' ? `https://www.barracudacentral.org/lookups/lookup-reputation` : `https://www.spamcop.net/bl.shtml?${l.listed[0]}` });
    }
    const own = ownOf.get(e.domain) ?? 'unknown';
    if (e.spf.records > 1) mkd(e.domain, own, 'email-spf', { label: 'More than one SPF record', title: `@${e.domain} has ${e.spf.records} SPF records, so its SPF check always fails`, what: 'A domain may have only one SPF record. With two, receiving mail systems treat the check as broken, and mail from it looks unverified.', fix: 'Merge them into one record.', severity: 'high', source: null });
    if (e.spf.all === '+all') mkd(e.domain, own, 'email-spf', { label: 'SPF lets any server send', title: `The SPF record for @${e.domain} lets any server in the world send as that domain`, what: 'It ends in "+all".', fix: 'Replace it with "~all" or "-all" after listing the servers you really use.', severity: 'high', source: null, evidence: e.spf.record ?? undefined });
    if (e.spf.lookups > 10) mkd(e.domain, own, 'email-spf', { label: 'SPF over the lookup limit', title: `The SPF record for @${e.domain} is over the limit receivers accept`, what: `Checking it takes ${e.spf.lookups} DNS lookups; the limit is 10, after which receivers count the check as failed.`, fix: 'Remove services you no longer send from.', severity: 'medium', source: null, evidence: e.spf.record ?? undefined });
    if (!e.dkim.length) mkd(e.domain, own, 'email-dkim', { label: 'No DKIM signing key found', title: `No DKIM signing key found for @${e.domain} on the usual names`, what: 'DKIM proves an email really came from the sender. Gmail and Yahoo have required it for bulk senders since 2024, and mail without it goes to spam more often. We looked where Google, Microsoft and the common hosts put the key; a key under an unusual name would not show here.', severity: 'low', source: null });
  }
  const cleanLists = email.every((e) => BLACKLISTS.every((bl) => !e.lists[bl.id].listed.length));
  if (email.length) add({ title: `${email.length} email domain${email.length === 1 ? '' : 's'} checked: ${cleanLists ? 'no mail server on the spam blacklists we can check' : 'a mail server is blacklisted'}`, detail: `${email.map((e) => `@${e.domain}: ${e.ips.length} mail server address${e.ips.length === 1 ? '' : 'es'}, SPF ${e.spf.record ? (e.spf.records > 1 ? 'duplicated' : 'set') : 'missing'}, DKIM ${e.dkim.length ? 'found' : 'not found'}, DMARC ${e.dmarc ?? 'missing'}`).join('; ')}. Checked against ${BLACKLISTS.filter((b) => working.has(b.id)).map((b) => b.name).join(' and ') || 'no list (none answered)'}; Spamhaus, the list most mail systems use, needs a paid licence and was not checked.`, severity: 'info', source: null, check: 'inventory', ownership: weakest(email.map((e) => ownOf.get(e.domain) ?? 'unknown')) });

  // ---- 4. Subdomains from the public certificate logs. ----
  const subs: any[] = [];
  for (const d of N.domains.slice(0, 3)) {
    const c = ctx.call('web', `crt.sh ${d}`);
    try {
      let rows: any[];
      const url = `https://crt.sh/?q=%25.${encodeURIComponent(d)}&output=json`;
      if (ctx.v21) {
        const res = await ctx.page(url);
        c.done({ ok: res.status === 200, note: `HTTP ${res.status}` });
        if (res.status !== 200) { ctx.warn(`crt.sh ${d}: ${res.error ?? `HTTP ${res.status}`}`); continue; }
        rows = JSON.parse(res.html);
        if (!Array.isArray(rows)) throw new Error('expected a JSON array');
      } else {
        const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
        c.done({ ok: res.ok, note: `HTTP ${res.status}` });
        if (!res.ok) { ctx.warn(`crt.sh ${d}: HTTP ${res.status}`); continue; }
        rows = await res.json() as any[];
      }
      const names = [...new Set(rows.flatMap((x) => String(x.name_value ?? '').split('\n')).map((n) => n.toLowerCase().replace(/^\*\./, '')).filter((n) => n.endsWith('.' + d) && n !== 'www.' + d))].slice(0, 25);
      const live = await Promise.all(names.map(async (n) => {
        const prior = ctx.v21 ? savedDomain(dive, n) : undefined;
        return { name: n, a: prior ? prior.dns?.a ?? [] : (await dnsp.resolve4(n).catch(() => [])) as string[] };
      }));
      for (const s of live.filter((x) => x.a.length).slice(0, 10)) {
        const p = await ctx.page(`https://${s.name}/`, { headers: { accept: 'text/html' } });
        subs.push({ parent: d, name: s.name, status: p.status, title: p.html.match(/<title[^>]*>([^<]*)/i)?.[1]?.trim() ?? '', error: p.error });
      }
      for (const s of live.filter((x) => !x.a.length)) subs.push({ parent: d, name: s.name, status: null, title: '', resolves: false });
    } catch (e) {
      c.done({ ok: false, note: (e as Error).message.slice(0, 200) });
      ctx.warn(`crt.sh ${d} failed: ${(e as Error).message}`);
    }
  }
  const forgotten = subs.filter((s) => s.status && /^(dev|test|staging|stage|old|beta|demo|uat|new|temp|backup)[.-]/.test(s.name));
  for (const s of forgotten) add({ title: `A test or old copy of a site is open to the public: ${s.name}`, detail: `It answers ${s.status}${s.title ? ` with "${s.title}"` : ''}. Forgotten copies are rarely updated and are how small-business sites get hacked; they can also show old prices and details. ${fixFor(ownOf.get(s.parent) ?? 'unknown', 'Take it down or put it behind a password.')}`, severity: 'medium', source: `https://${s.name}/`, check: 'subdomain', ownership: ownOf.get(s.parent) ?? 'unknown' });
  const broken = subs.filter((s) => s.status && s.status >= 500);
  if (broken.length) add({ title: `${broken.length} subdomain${broken.length === 1 ? '' : 's'} of the official domain${N.domains.length === 1 ? '' : 's'} answer${broken.length === 1 ? 's' : ''} with a server error`, detail: broken.map((s) => s.name).join(', ') + '.', severity: 'low', source: `https://crt.sh/?q=%25.${N.domains[0]}`, check: 'subdomain', ownership: weakest(broken.map((s) => ownOf.get(s.parent) ?? 'unknown')) });

  // ---- 5. Lookalike domains: the brand word on the usual endings. ----
  const lookalikes: any[] = [];
  if (brand) {
    for (const d of [`${brand}.com`, `${brand}.com.my`, `${brand}.my`].filter((x) => !why.has(x))) {
      const prior = ctx.v21 ? savedDomain(dive, d) : undefined;
      const reg = prior ? prior.registration as Reg : await registration(d);
      if (reg.error && reg.error !== 'not registered') continue;
      const a = reg.error === 'not registered' ? [] : prior ? prior.dns?.a ?? [] : await dnsp.resolve4(d).catch(() => [] as string[]);
      const title = a.length ? (await ctx.page(`https://${d}/`, { headers: { accept: 'text/html' } })).html.match(/<title[^>]*>([^<]*)/i)?.[1]?.trim() ?? '' : '';
      lookalikes.push({ domain: d, registered: reg.error !== 'not registered', registrar: reg.registrar, created: reg.created, org: reg.org, live: a.length > 0, title });
    }
    const theirs = lookalikes.filter((x) => x.registered && x.live);
    for (const x of theirs) add({ title: `${x.domain} belongs to someone else${x.title ? `: "${x.title}"` : ''}`, detail: `A customer who guesses your address as ${x.domain} lands on another site. Check it is not passing itself off as you; if it is unrelated, make your own address easy to find on Maps and social pages.`, severity: N.mentions(x.title) ? 'high' : 'low', source: `https://${x.domain}/`, check: 'lookalike', ownership: 'unknown' as Ownership });
    const free = lookalikes.filter((x) => !x.registered);
    if (free.length) add({ title: `${free.map((x) => x.domain).join(' and ')} ${free.length === 1 ? 'is' : 'are'} free to register`, detail: `Registering ${free.length === 1 ? 'it' : 'them'} (a small yearly fee each) and pointing ${free.length === 1 ? 'it' : 'them'} at your site stops anyone else using your name there.`, severity: 'low', source: null, check: 'lookalike', ownership: 'unknown' as Ownership });
  }

  // ---- 6. One summary line per domain, for the report's asset table. ----
  const mailBy = (mx: string[]) => {
    const m = mx.join(' ');
    return /google|googlemail/.test(m) ? 'Google Workspace' : /outlook|microsoft/.test(m) ? 'Microsoft 365' : /zoho/.test(m) ? 'Zoho Mail' : /hostinger/.test(m) ? 'Hostinger' : /zmail|qiye|163|qq\.com|aliyun/.test(m) ? 'a China-based mail service' : /amazonaws/.test(m) ? 'Amazon SES' : mx[0] ?? null;
  };
  const table = assets.map((a) => ({
    ...(ctx.v21 ? { reused_step15: !!a.prior, step15: a.prior ?? null, cms_note: a.site?.cms_note ?? null } : {}),
    domain: a.domain, why: a.why, registrar: a.reg.registrar, created: a.reg.created?.slice(0, 10) ?? null, expires: a.reg.expires?.slice(0, 10) ?? null,
    registrant: a.reg.org, ns: (a.dns.ns.length ? a.dns.ns : a.reg.ns).slice(0, 2), ip: a.dns.a[0] ?? null, host: a.host,
    mail: a.dns.mx.length ? mailBy(a.dns.mx) : null, spf: !!a.dns.spf, dmarc: a.dns.dmarc ? (a.dns.dmarc.match(/p=(\w+)/i)?.[1] ?? 'set') : null,
    site: a.site ? { status: a.site.status, final: a.site.final, title: a.site.title, cms: a.site.cms, version: a.site.version, stack: a.site.stack, parked: a.site.parked } : null,
    cert: a.cert ? { ok: a.cert.ok, issuer: a.cert.issuer, valid_to: a.cert.validTo?.slice(0, 10) ?? null } : null,
  }));
  const social = [...new Set(assets.flatMap((a) => a.site?.social ?? []))];
  add({ title: `${assets.length} domain${assets.length === 1 ? '' : 's'} linked to the company`, detail: table.map((t) => `${t.domain} (${t.why.join(', ')}): ${t.registrar ? `registered with ${t.registrar}` : 'registrar unknown'}${t.expires ? `, renews by ${t.expires}` : ''}${t.host ? `, hosted at ${t.host}` : ''}${t.mail ? `, email by ${t.mail}` : ''}`).join('; ') + '.', severity: 'info', source: null, check: 'inventory', ownership: weakest(assets.map((a) => a.own)) });
  const merged = mergeByCheck(findings).map((f) => ({ ...f, party: f.party ?? PARTY[String(f.check)] ?? 'first' }));
  return { findings: merged, notes: {
    ...(ctx.v21 ? { email_reputation_skipped: assets.filter((a) => a.prior).map((a) => a.domain),
      email_reputation_note: 'Saved domains are not probed again for email reputation because those checks make fresh DNS queries.' } : {}),
    domains: table, subdomains: subs, lookalikes, social, email, blacklists: BLACKLISTS.map((b) => ({ ...b, working: working.has(b.id) })),
  } };
}
