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
    bootstrap[kind] ??= await (await fetch(`https://data.iana.org/rdap/${kind}.json`)).json();
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
    const res = await fetch(`${base.replace(/\/?$/, '/')}domain/${domain}`, { headers: { accept: 'application/rdap+json' } });
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
      const j = await (await fetch(`${base.replace(/\/?$/, '/')}ip/${ip}`, { headers: { accept: 'application/rdap+json' } })).json() as any;
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
function techOf(headers: Record<string, string>, html: string): { stack: string[]; cms: string | null; version: string | null } {
  const stack = new Set<string>();
  const gen = html.match(/<meta[^>]+name=["']generator["'][^>]+content=["']([^"']+)/i)?.[1] ?? null;
  if (headers.server) stack.add(`server: ${headers.server}`);
  if (headers['x-powered-by']) stack.add(`powered by: ${headers['x-powered-by']}`);
  if (/cloudflare/i.test(headers.server ?? '') || headers['cf-ray']) stack.add('Cloudflare');
  if (gen) stack.add(gen);
  let cms: string | null = null;
  if (/wp-content|wp-includes/i.test(html) || /wordpress/i.test(gen ?? '')) cms = 'WordPress';
  else if (/cdn\.shopify|shopify/i.test(html)) cms = 'Shopify';
  else if (/wix\.com|wixstatic/i.test(html)) cms = 'Wix';
  else if (/squarespace/i.test(html)) cms = 'Squarespace';
  else if (/joomla/i.test(gen ?? '')) cms = 'Joomla';
  if (cms) stack.add(cms);
  const version = (gen ?? '').match(/(?:wordpress|joomla)\s+([\d.]+)/i)?.[1] ?? null;
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

export async function run(ctx: Ctx, dive: any): Promise<{ findings: Finding[]; notes: Record<string, unknown> }> {
  const r = dive.result ?? {};
  const N = nameOf(dive);
  const C = readLane(ctx.diveId, 'C-merged')?.notes ?? {};
  const findings: Finding[] = [];
  const add = (f: Omit<Finding, 'checked_at'>) => findings.push({ ...f, checked_at: ctx.now() } as Finding);
  const brand = N.brand.length >= 4 ? N.brand : '';

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
    const [reg, dns] = await Promise.all([registration(d), dnsOf(d)]);
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
        title, parked: PARKED.test(title + ' ' + text) && text.length < 3000, ...techOf(q.headers, q.html),
        social: [...new Set([...q.html.matchAll(/href=["'](https?:\/\/[^"'#]+)["']/gi)].map((m) => m[1]).filter((u) => SOCIAL.test(N.hostOf(u))))].slice(0, 12),
      };
    }
    const cert = dns.a.length ? await certOf(d) : null;
    return { domain: d, why: [...why.get(d)!], reg, dns, host, site, cert };
  }));

  // ---- 3. Findings, domain by domain. ----
  const now = Date.now();
  for (const a of assets) {
    const d = a.domain;
    const used = a.why.join(', ');
    const src = a.reg.source === 'MYNIC whois' ? `https://whois.mynic.my/` : `https://lookup.icann.org/en/lookup?name=${d}`;
    if (a.reg.error === 'not registered') {
      add({ title: `${d} is not registered to anyone`, detail: `It is ${used}, yet nobody holds the domain. Anyone can register it today and receive your customers' emails or show them their own page.`, severity: 'high', source: src, check: 'unregistered', domain: d });
      continue;
    }
    const left = a.reg.expires ? Math.floor((Date.parse(a.reg.expires) - now) / day) : null;
    if (left !== null && left < 0) add({ title: `${d} expired on ${a.reg.expires!.slice(0, 10)}`, detail: `The registration has run out. Renew it before the registrar releases it to someone else.`, severity: 'high', source: src, check: 'expiry', domain: d });
    else if (left !== null && left <= 90) add({ title: `${d} expires in ${left} days (${a.reg.expires!.slice(0, 10)})`, detail: `If the renewal fails (an old card, an ex-staff mailbox getting the reminder), the site and every email address on it stop working. Turn on auto-renew and check who receives the reminders.`, severity: left <= 30 ? 'high' : 'medium', source: src, check: 'expiry', domain: d });
    if (a.reg.org && brand && !a.reg.org.toLowerCase().includes(brand)) add({ title: `${d} is registered to "${a.reg.org}", not to your company`, detail: `Whoever is the registrant controls the domain. If that is a web designer, an agency or a former staff member, you need their cooperation to move or renew it. Transfer it to the company's own name.`, severity: 'medium', source: src, check: 'registrant', domain: d });
    if (!a.dns.a.length && !a.dns.mx.length) add({ title: `${d} does not point anywhere`, detail: `It is ${used}, but it has no website and no email server. A customer typing it or emailing it reaches nothing.`, severity: a.why.includes('official site') || a.why.includes('used for email') ? 'high' : 'medium', source: src, check: 'dns', domain: d });
    if (a.why.includes('used for email')) {
      if (!a.dns.mx.length) add({ title: `Email to @${d} cannot be delivered`, detail: `${d} has no mail server (MX) record, so messages customers send to your published address bounce.`, severity: 'high', source: src, check: 'mx', domain: d });
      if (!a.dns.spf) add({ title: `No SPF record on ${d}`, detail: `Mail servers cannot tell which servers may send email as @${d}, so your real emails land in spam more often and fakes get through.`, severity: 'medium', source: src, check: 'spf', domain: d });
      if (!a.dns.dmarc) add({ title: `Anyone can send email that looks like it came from @${d}`, detail: `${d} has no DMARC record. Scammers can send fake invoices or payment requests from your address and nothing tells the receiving bank or customer to reject them.`, severity: 'medium', source: src, check: 'dmarc', domain: d });
      else if (/p=none/i.test(a.dns.dmarc)) add({ title: `Your DMARC on ${d} only watches, it does not block fakes`, detail: `The record says p=none, so fake emails from @${d} are still delivered. Move to p=quarantine once your own senders pass.`, severity: 'low', source: src, check: 'dmarc', domain: d, evidence: a.dns.dmarc });
    }
    if (a.site) {
      if (a.site.parked) add({ title: `${d} shows a parked or for-sale page`, detail: `Visitors see "${a.site.title || 'a placeholder'}" instead of your business.`, severity: a.why.includes('official site') ? 'high' : 'medium', source: `https://${d}/`, check: 'parked', domain: d });
      else if (a.site.status >= 400 || a.site.status === 0) add({ title: `${d} does not open`, detail: `It is ${used}, and a customer who types it ${a.site.status ? `gets an error page (${a.site.status})` : 'waits for a server that never answers'}.`, severity: a.why.includes('official site') ? 'high' : 'medium', source: `https://${d}/`, check: 'site-down', domain: d });
      if (!a.site.https && a.site.status) add({ title: `${d} only opens without https`, detail: `Browsers mark the site "Not secure", which makes customers hesitate to fill in a form.`, severity: 'medium', source: `http://${d}/`, check: 'https', domain: d });
      if (a.site.cms === 'WordPress' && a.site.version && Number(a.site.version.split('.')[0]) < 6) add({ title: `${d} runs WordPress ${a.site.version}, several years out of date`, detail: `Old WordPress versions have known security holes; hacked small-business sites are often turned into gambling or spam pages. Update WordPress and its plugins, or ask who maintains the site.`, severity: 'medium', source: `https://${d}/`, check: 'cms', domain: d });
    }
    if (a.cert && a.site?.https && a.site.status) {
      if (!a.cert.ok) add({ title: `The security certificate on ${d} is not valid`, detail: `Browsers show a warning page (${a.cert.error}). Most customers turn back at that warning.`, severity: 'high', source: `https://${d}/`, check: 'cert', domain: d });
      else if (a.cert.daysLeft !== null && a.cert.daysLeft <= 14) add({ title: `The security certificate on ${d} runs out in ${a.cert.daysLeft} days`, detail: `Issued by ${a.cert.issuer ?? 'unknown'}. If it does not renew by itself, visitors get a warning page.`, severity: 'medium', source: `https://${d}/`, check: 'cert', domain: d });
    }
  }

  // ---- 3b. Email reputation: every domain that receives mail. ----
  // Each list is proved to answer first (its test entry 127.0.0.2 must come back listed), so a
  // list that refuses this network reads "could not check", never "clear".
  const working = new Set<string>();
  for (const bl of BLACKLISTS) if ((await listed('127.0.0.2', bl.zone)) === 'listed') working.add(bl.id); else ctx.log(`${bl.name} blacklist did not answer its test lookup; shown as not checked`);
  const email = await Promise.all(assets.filter((a) => a.dns.mx.length).map((a) => emailReputation(a.domain, a.dns.mx)));
  for (const e of email) {
    for (const bl of BLACKLISTS) {
      const l = e.lists[bl.id];
      if (!working.has(bl.id)) { l.checked = 0; continue; }
      if (l.listed.length) add({ title: `Your mail server for @${e.domain} is on the ${bl.name} spam blacklist`, detail: `${l.listed.join(', ')} (${e.mx.join(', ')}) is listed. Mail systems that use ${bl.name} reject or junk email from that server, so your quotes and invoices may never arrive. If the server is your web host's shared mail server, another customer of the host may have caused it; the fix sits with whoever runs the server.`, severity: 'high', source: bl.id === 'barracuda' ? `https://www.barracudacentral.org/lookups/lookup-reputation` : `https://www.spamcop.net/bl.shtml?${l.listed[0]}`, check: 'email-blacklist', domain: e.domain });
    }
    if (e.spf.records > 1) add({ title: `@${e.domain} has ${e.spf.records} SPF records, so its SPF check always fails`, detail: 'A domain may have only one SPF record. With two, receiving mail systems treat the check as broken, and your mail looks unverified.', severity: 'high', source: null, check: 'email-spf', domain: e.domain });
    if (e.spf.all === '+all') add({ title: `The SPF record for @${e.domain} lets any server in the world send as you`, detail: `It ends in "+all". Replace it with "~all" or "-all" after listing the servers you really use.`, severity: 'high', source: null, check: 'email-spf', domain: e.domain, evidence: e.spf.record });
    if (e.spf.lookups > 10) add({ title: `The SPF record for @${e.domain} is over the limit receivers accept`, detail: `Checking it takes ${e.spf.lookups} DNS lookups; the limit is 10, after which receivers count the check as failed. Remove services you no longer send from.`, severity: 'medium', source: null, check: 'email-spf', domain: e.domain, evidence: e.spf.record });
    if (!e.dkim.length) add({ title: `No DKIM signing key found for @${e.domain} on the usual names`, detail: 'DKIM proves an email really came from you. Gmail and Yahoo have required it for bulk senders since 2024, and mail without it goes to spam more often. We looked where Google, Microsoft and the common hosts put the key; a key under an unusual name would not show here.', severity: 'low', source: null, check: 'email-dkim', domain: e.domain });
  }
  const cleanLists = email.every((e) => BLACKLISTS.every((bl) => !e.lists[bl.id].listed.length));
  if (email.length) add({ title: `${email.length} email domain${email.length === 1 ? '' : 's'} checked: ${cleanLists ? 'no mail server on the spam blacklists we can check' : 'a mail server is blacklisted'}`, detail: `${email.map((e) => `@${e.domain}: ${e.ips.length} mail server address${e.ips.length === 1 ? '' : 'es'}, SPF ${e.spf.record ? (e.spf.records > 1 ? 'duplicated' : 'set') : 'missing'}, DKIM ${e.dkim.length ? 'found' : 'not found'}, DMARC ${e.dmarc ?? 'missing'}`).join('; ')}. Checked against ${BLACKLISTS.filter((b) => working.has(b.id)).map((b) => b.name).join(' and ') || 'no list (none answered)'}; Spamhaus, the list most mail systems use, needs a paid licence and was not checked.`, severity: 'info', source: null, check: 'inventory' });

  // ---- 4. Subdomains from the public certificate logs. ----
  const subs: any[] = [];
  for (const d of N.domains.slice(0, 3)) {
    const c = ctx.call('web', `crt.sh ${d}`);
    try {
      const res = await fetch(`https://crt.sh/?q=%25.${encodeURIComponent(d)}&output=json`);
      c.done({ ok: res.ok, note: `HTTP ${res.status}` });
      if (!res.ok) { ctx.warn(`crt.sh ${d}: HTTP ${res.status}`); continue; }
      const rows = await res.json() as any[];
      const names = [...new Set(rows.flatMap((x) => String(x.name_value ?? '').split('\n')).map((n) => n.toLowerCase().replace(/^\*\./, '')).filter((n) => n.endsWith('.' + d) && n !== 'www.' + d))].slice(0, 25);
      const live = await Promise.all(names.map(async (n) => ({ name: n, a: (await dnsp.resolve4(n).catch(() => [])) as string[] })));
      for (const s of live.filter((x) => x.a.length).slice(0, 10)) {
        const p = await ctx.page(`https://${s.name}/`, { headers: { accept: 'text/html' } });
        subs.push({ name: s.name, status: p.status, title: p.html.match(/<title[^>]*>([^<]*)/i)?.[1]?.trim() ?? '', error: p.error });
      }
      for (const s of live.filter((x) => !x.a.length)) subs.push({ name: s.name, status: null, title: '', resolves: false });
    } catch (e) {
      c.done({ ok: false, note: (e as Error).message.slice(0, 200) });
      ctx.warn(`crt.sh ${d} failed: ${(e as Error).message}`);
    }
  }
  const forgotten = subs.filter((s) => s.status && /^(dev|test|staging|stage|old|beta|demo|uat|new|temp|backup)[.-]/.test(s.name));
  for (const s of forgotten) add({ title: `A test or old copy of your site is open to the public: ${s.name}`, detail: `It answers ${s.status}${s.title ? ` with "${s.title}"` : ''}. Forgotten copies are rarely updated and are how small-business sites get hacked; they can also show old prices and details. Take it down or put it behind a password.`, severity: 'medium', source: `https://${s.name}/`, check: 'subdomain' });
  const broken = subs.filter((s) => s.status && s.status >= 500);
  if (broken.length) add({ title: `${broken.length} of your subdomains answer with a server error`, detail: broken.map((s) => s.name).join(', ') + '.', severity: 'low', source: `https://crt.sh/?q=%25.${N.domains[0]}`, check: 'subdomain' });

  // ---- 5. Lookalike domains: the brand word on the usual endings. ----
  const lookalikes: any[] = [];
  if (brand) {
    for (const d of [`${brand}.com`, `${brand}.com.my`, `${brand}.my`].filter((x) => !why.has(x))) {
      const reg = await registration(d);
      if (reg.error && reg.error !== 'not registered') continue;
      const a = reg.error === 'not registered' ? [] : await dnsp.resolve4(d).catch(() => [] as string[]);
      const title = a.length ? (await ctx.page(`https://${d}/`, { headers: { accept: 'text/html' } })).html.match(/<title[^>]*>([^<]*)/i)?.[1]?.trim() ?? '' : '';
      lookalikes.push({ domain: d, registered: reg.error !== 'not registered', registrar: reg.registrar, created: reg.created, org: reg.org, live: a.length > 0, title });
    }
    const theirs = lookalikes.filter((x) => x.registered && x.live);
    for (const x of theirs) add({ title: `${x.domain} belongs to someone else${x.title ? `: "${x.title}"` : ''}`, detail: `A customer who guesses your address as ${x.domain} lands on another site. Check it is not passing itself off as you; if it is unrelated, make your own address easy to find on Maps and social pages.`, severity: N.mentions(x.title) ? 'high' : 'low', source: `https://${x.domain}/`, check: 'lookalike' });
    const free = lookalikes.filter((x) => !x.registered);
    if (free.length) add({ title: `${free.map((x) => x.domain).join(' and ')} ${free.length === 1 ? 'is' : 'are'} free to register`, detail: `Registering ${free.length === 1 ? 'it' : 'them'} (a few ringgit a year each) and pointing ${free.length === 1 ? 'it' : 'them'} at your site stops anyone else using your name there.`, severity: 'low', source: null, check: 'lookalike' });
  }

  // ---- 6. One summary line per domain, for the report's asset table. ----
  const mailBy = (mx: string[]) => {
    const m = mx.join(' ');
    return /google|googlemail/.test(m) ? 'Google Workspace' : /outlook|microsoft/.test(m) ? 'Microsoft 365' : /zoho/.test(m) ? 'Zoho Mail' : /hostinger/.test(m) ? 'Hostinger' : /zmail|qiye|163|qq\.com|aliyun/.test(m) ? 'a China-based mail service' : /amazonaws/.test(m) ? 'Amazon SES' : mx[0] ?? null;
  };
  const table = assets.map((a) => ({
    domain: a.domain, why: a.why, registrar: a.reg.registrar, created: a.reg.created?.slice(0, 10) ?? null, expires: a.reg.expires?.slice(0, 10) ?? null,
    registrant: a.reg.org, ns: (a.dns.ns.length ? a.dns.ns : a.reg.ns).slice(0, 2), ip: a.dns.a[0] ?? null, host: a.host,
    mail: a.dns.mx.length ? mailBy(a.dns.mx) : null, spf: !!a.dns.spf, dmarc: a.dns.dmarc ? (a.dns.dmarc.match(/p=(\w+)/i)?.[1] ?? 'set') : null,
    site: a.site ? { status: a.site.status, final: a.site.final, title: a.site.title, cms: a.site.cms, version: a.site.version, stack: a.site.stack, parked: a.site.parked } : null,
    cert: a.cert ? { ok: a.cert.ok, issuer: a.cert.issuer, valid_to: a.cert.validTo?.slice(0, 10) ?? null } : null,
  }));
  const social = [...new Set(assets.flatMap((a) => a.site?.social ?? []))];
  add({ title: `${assets.length} domain${assets.length === 1 ? '' : 's'} traced to you`, detail: table.map((t) => `${t.domain} (${t.why.join(', ')}): ${t.registrar ? `registered with ${t.registrar}` : 'registrar unknown'}${t.expires ? `, renews by ${t.expires}` : ''}${t.host ? `, hosted at ${t.host}` : ''}${t.mail ? `, email by ${t.mail}` : ''}`).join('; ') + '.', severity: 'info', source: null, check: 'inventory' });
  return { findings, notes: { domains: table, subdomains: subs, lookalikes, social, email, blacklists: BLACKLISTS.map((b) => ({ ...b, working: working.has(b.id) })) } };
}
