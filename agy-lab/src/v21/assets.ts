// V2.1 Step 1.5: Technical Infrastructure & Asset Security Audit.
// Deterministic, zero-LLM technical audit executing:
//   1. Google PageSpeed Insights (Mobile + Desktop) on the confirmed official website using the vault service account.
//   2. Domain ownership & security audit on all discovered domains (WHOIS/RDAP, hijack lock, SPF/DMARC spoofing, TLS).
//   3. Google Maps reviews of the company's own profile (Scraper.Tech).
//   4. SEO and GEO benchmark of the official website on a Local Gmap Worker PC (site.audit; V21_SITE_AUDIT=on). The
//      worker's report is kept as it came back (scores, checks, pages, facts, notChecked); nothing is judged here.
//   5. The global handlers on the official domain, on Local Gmap Worker PCs (DNS, SSL certificate, certificate logs,
//      Wayback Machine, YouTube; on unless V21_GLOBAL_HANDLERS=off). Each answer is kept as it came back.
//
// Runs after Step 1 (Research) and before Step 2 (Analyse) so that objective technical facts feed the judge.
import net from 'node:net';
import tls from 'node:tls';
import dnsp from 'node:dns/promises';
import { pagespeed, scrapertech } from '../core/index.ts';
import { readPsi, type Psi } from '../divedeeper/sections/W-speed.ts';
import type { RawResearchCheckpoint } from './research.ts';
import { workerAudit } from './cloud.ts';
import { siteLookupOn, globalHandlersOn, runGlobalHandlers, type GlobalHandlersBlock } from './site-lookup.ts';

const FREE_MAIL = /^(gmail|googlemail|yahoo|ymail|hotmail|outlook|live|icloud|me|aol|proton|protonmail|qq|163|126|zoho)\./i;
const SOCIAL_DOMAINS = /^(?:[a-z0-9-]+\.)?(facebook|instagram|linkedin|tiktok|youtube|x|twitter|xiaohongshu|threads|weibo|github|pinterest|whatsapp|telegram)\.com$/i;

/** A registry transfer lock in the domain's status. WHOIS writes it run together (clientTransferProhibited), RDAP with
 *  spaces (client transfer prohibited); either form counts, client or server. */
export function isTransferLocked(status: string[]): boolean {
  return status.some((s) => /transfer\s*prohibited/i.test(s));
}

export type DomainRegistration = {
  registrar: string | null;
  created: string | null;
  expires: string | null;
  updated: string | null;
  org: string | null;
  status: string[];
  ns: string[];
  source: string;
  days_until_expiry: number | null;
  is_locked: boolean;
  error?: string;
};

export type DomainDns = {
  a: string[];
  ns: string[];
  mx: string[];
  spf: string | null;
  dmarc: string | null;
};

export type EmailSecurity = {
  has_spf: boolean;
  spf_all: string | null;
  has_dmarc: boolean;
  dmarc_policy: string | null;
  is_spoofable: boolean;
};

export type TlsInfo = {
  valid: boolean;
  issuer?: string;
  expires_at?: string;
  days_remaining?: number;
  error?: string;
};

export type AuditedDomain = {
  domain: string;
  role: string;
  registration: DomainRegistration;
  dns: DomainDns;
  email_security: EmailSecurity;
  tls: TlsInfo | null;
};

export type TechnicalFinding = {
  id: string;
  title: string;
  detail: string;
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  check:
    | 'psi-score'
    | 'psi-field'
    | 'psi-fixes'
    | 'psi-seo'
    | 'psi-quality'
    | 'domain-expiry'
    | 'domain-lock'
    | 'ownership-mismatch'
    | 'email-spoofing'
    | 'tls-expiry';
  source?: string;
  domain?: string;
  strategy?: 'mobile' | 'desktop';
  evidence_url?: string;
};

export type Step1_5_AssetsOutput = {
  version: '2.1';
  stage: 1.5;
  created_at: string;
  input: {
    company: string;
    country: string;
    industry: string;
    website?: string;
  };
  status: 'done' | 'skipped' | 'failed';
  skip_reason?: string | null;
  error?: string | null;
  pagespeed: {
    status: 'done' | 'skipped' | 'failed';
    reason?: string;
    target_url?: string;
    mobile?: Psi;
    desktop?: Psi;
    error?: string;
  };
  domains: AuditedDomain[];
  /** Google Maps reviews of the company's own profile (Scraper.Tech; newest first, at most REVIEWS_MAX). */
  google_reviews: GoogleReviewsBlock;
  /** The worker's SEO / GEO benchmark of the official website. Absent when V21_SITE_AUDIT is not on. */
  site_audit?: SiteAuditBlock;
  /** The global handlers' answers for the official domain. Absent when V21_GLOBAL_HANDLERS=off. */
  global_handlers?: GlobalHandlersBlock;
  findings: TechnicalFinding[];
  stats: {
    domains_checked: number;
    pagespeed_runs: number;
    findings_count: number;
    reviews_read?: number;
    duration_ms: number;
  };
};

export const REVIEWS_MAX = 50;

/** On with V21_SITE_AUDIT=on (owner, 2026-11-06); off, Step 1.5 is as before and has no site_audit block. */
export const siteAuditOn = (): boolean => (process.env.V21_SITE_AUDIT ?? '').trim().toLowerCase() === 'on';

export type SiteAuditBlock = {
  /** done: the worker's report is in result. not_run: no official website to audit. failed: the audit did not run or broke. */
  status: 'done' | 'not_run' | 'failed';
  reason?: string;
  error?: string;
  target_url?: string;
  job_id?: string;
  worker?: string;
  /** The worker's report, unchanged (POST /api/audit job.result). */
  result?: unknown;
};

export type GoogleReviewsBlock = {
  /** done: read. not_run: nothing to read (no Maps profile / no confident match): not a finding. failed: the read broke. */
  status: 'done' | 'not_run' | 'failed';
  reason?: string;
  error?: string;
  max: number;
  profile?: { name: string; place_id: string; address?: string; website?: string; phone?: string; maps_url?: string };
  data?: scrapertech.MapsReviews;
};

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9ㄱ-ㆎ가-힣]+/g, '');
const hostOf = (u: string) => { try { return new URL(/^https?:/i.test(u) ? u : `https://${u}`).hostname.replace(/^www\./, '').toLowerCase(); } catch { return ''; } };

/** The company's own Maps profile among Step 1's Maps results: same name (exact), else same website domain. Never a guess:
 *  one namesake result is not enough, so no match = not_run with the reason. */
export function pickMapsProfile(checkpoint: RawResearchCheckpoint): { profile?: GoogleReviewsBlock['profile']; reason?: string } {
  const gm: any = (checkpoint as any).google_maps;
  const businesses: any[] = gm?.result?.businesses ?? [];
  if (!gm) return { reason: 'Step 1 did not search Google Maps' };
  if (gm.status !== 'done') return { reason: `Step 1 Google Maps search ${gm.status ?? 'not done'}${gm.error ? `: ${gm.error}` : ''}` };
  if (!businesses.length) return { reason: 'Google Maps search returned no listing' };
  const company = norm(checkpoint.input?.company ?? '');
  const sites = new Set([checkpoint.official_site?.domain, checkpoint.input?.website].filter(Boolean).map((d) => hostOf(String(d))));
  const byName = businesses.filter((b) => b.place_id && norm(String(b.name ?? '')) === company);
  const byDomain = businesses.filter((b) => b.place_id && b.website && sites.has(hostOf(String(b.website))));
  const hit = byName[0] ?? byDomain[0];
  if (!hit) return { reason: `No Maps listing matches "${checkpoint.input?.company}" by name or website (${businesses.length} listing(s) found)` };
  return {
    profile: {
      name: String(hit.name), place_id: String(hit.place_id), address: hit.address, website: hit.website, phone: hit.phone, maps_url: hit.mapsUrl,
    },
  };
}

/** Port 43 WHOIS query with 6s timeout; '' on failure, never throws. */
export function whois43(host: string, query: string, timeoutMs = 6000): Promise<string> {
  return new Promise((resolve) => {
    let out = '';
    const s = net.connect(43, host, () => s.write(query + '\r\n'));
    s.setTimeout(timeoutMs, () => {
      s.destroy();
      resolve(out);
    });
    s.setEncoding('utf8');
    s.on('data', (c) => { out += c; });
    s.on('end', () => resolve(out));
    s.on('error', () => resolve(out));
  });
}

let rdapBootstrap: any = null;
async function rdapBase(tld: string): Promise<string | null> {
  try {
    rdapBootstrap ??= await (await fetch('https://data.iana.org/rdap/dns.json', { signal: AbortSignal.timeout(10_000) })).json();
    return rdapBootstrap?.services?.find((s: any) => s[0].includes(tld))?.[1]?.[0] ?? null;
  } catch {
    return null;
  }
}

const vcardName = (e: any) => e?.vcardArray?.[1]?.find((v: any) => v[0] === 'fn')?.[3] ?? null;
const vcardOrg = (e: any) => e?.vcardArray?.[1]?.find((v: any) => v[0] === 'org')?.[3] ?? null;

function parseWhois(raw: string, source: string): DomainRegistration {
  const field = (...ks: string[]) => {
    for (const k of ks) {
      const v = raw.match(new RegExp(`^\\s*${k}:\\s*(.+)$`, 'im'))?.[1]?.trim();
      if (v) return v;
    }
    return null;
  };

  if (!raw) {
    return {
      registrar: null, created: null, expires: null, updated: null, org: null,
      status: [], ns: [], source, days_until_expiry: null, is_locked: false, error: 'no answer',
    };
  }
  if (/no match|not found|no data found|no entries found|status:\s*free/i.test(raw.slice(0, 400))) {
    return {
      registrar: null, created: null, expires: null, updated: null, org: null,
      status: [], ns: [], source, days_until_expiry: null, is_locked: false, error: 'not registered',
    };
  }

  const org = field('Registrant Organization', 'Registrant Organisation', 'Registrant');
  const expires = field('Registry Expiry Date', 'Registrar Registration Expiration Date', 'Expiry Date', 'Expiration Date');
  const status = [...raw.matchAll(/^\s*Domain Status:\s*(\S+)/gim)].map((m) => m[1]);
  const ns = [...raw.matchAll(/^\s*Name Server:\s*(\S+)/gim)].map((m) => m[1].toLowerCase());

  let daysUntilExpiry: number | null = null;
  if (expires) {
    const expDate = new Date(expires);
    if (!isNaN(expDate.getTime())) {
      daysUntilExpiry = Math.round((expDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
    }
  }

  const isLocked = isTransferLocked(status);

  return {
    registrar: field('Registrar', 'Sponsoring Registrar'),
    created: field('Creation Date', 'Created On', 'Registered On'),
    expires,
    updated: field('Updated Date', 'Last Updated On'),
    org: org && !/redacted|privacy|proxy|withheld|not disclosed/i.test(org) ? org : null,
    status,
    ns,
    source,
    days_until_expiry: daysUntilExpiry,
    is_locked: isLocked,
  };
}

export async function lookupRegistration(domain: string): Promise<DomainRegistration> {
  if (/\.my$/i.test(domain)) {
    return parseWhois(await whois43('whois.mynic.my', domain), 'MYNIC whois');
  }

  const parts = domain.split('.');
  const tld = parts.pop()!;
  const base = await rdapBase(tld);
  if (!base) {
    const refer = (await whois43('whois.iana.org', tld)).match(/^(?:refer|whois):\s*(\S+)/im)?.[1];
    return refer
      ? parseWhois(await whois43(refer, domain), `whois ${refer}`)
      : {
          registrar: null, created: null, expires: null, updated: null, org: null,
          status: [], ns: [], source: 'whois', days_until_expiry: null, is_locked: false,
          error: `no registry found for .${tld}`,
        };
  }

  try {
    const res = await fetch(`${base.replace(/\/?$/, '/')}domain/${domain}`, {
      headers: { accept: 'application/rdap+json' },
      signal: AbortSignal.timeout(10_000),
    });
    if (res.status === 404) {
      return {
        registrar: null, created: null, expires: null, updated: null, org: null,
        status: [], ns: [], source: 'RDAP', days_until_expiry: null, is_locked: false,
        error: 'not registered',
      };
    }
    const j = (await res.json()) as any;
    const ev = (a: string) => j.events?.find((e: any) => e.eventAction === a)?.eventDate ?? null;
    const registrar = j.entities?.find((e: any) => e.roles?.includes('registrar'));
    const registrant = j.entities?.find((e: any) => e.roles?.includes('registrant'));
    const org = vcardOrg(registrant) ?? vcardName(registrant);
    const expires = ev('expiration');
    let daysUntilExpiry: number | null = null;
    if (expires) {
      const expDate = new Date(expires);
      if (!isNaN(expDate.getTime())) {
        daysUntilExpiry = Math.round((expDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
      }
    }
    const status: string[] = j.status ?? [];
    const isLocked = isTransferLocked(status);

    return {
      registrar: vcardName(registrar),
      created: ev('registration'),
      expires,
      updated: ev('last changed'),
      org: org && !/redacted|privacy|proxy|withheld/i.test(org) ? org : null,
      status,
      ns: (j.nameservers ?? []).map((n: any) => String(n.ldhName).toLowerCase()),
      source: 'RDAP',
      days_until_expiry: daysUntilExpiry,
      is_locked: isLocked,
    };
  } catch (e: any) {
    return {
      registrar: null, created: null, expires: null, updated: null, org: null,
      status: [], ns: [], source: 'RDAP', days_until_expiry: null, is_locked: false,
      error: e?.message ?? String(e),
    };
  }
}

export async function lookupDns(domain: string): Promise<DomainDns> {
  const safe = async <T>(f: () => Promise<T>): Promise<T | null> => {
    try {
      return await f();
    } catch {
      return null;
    }
  };

  const [a, ns, mx, txt, dmarcTxt] = await Promise.all([
    safe(() => dnsp.resolve4(domain)),
    safe(() => dnsp.resolveNs(domain)),
    safe(() => dnsp.resolveMx(domain)),
    safe(() => dnsp.resolveTxt(domain)),
    safe(() => dnsp.resolveTxt(`_dmarc.${domain}`)),
  ]);

  const flat = (x: string[][] | null) => (x ?? []).map((r) => r.join(''));
  return {
    a: a ?? [],
    ns: (ns ?? []).map((x) => x.toLowerCase()),
    mx: (mx ?? []).sort((p, q) => p.priority - q.priority).map((x) => x.exchange.toLowerCase()),
    spf: flat(txt).find((t) => /^v=spf1/i.test(t)) ?? null,
    dmarc: flat(dmarcTxt).find((t) => /^v=DMARC1/i.test(t)) ?? null,
  };
}

export function checkTls(host: string, port = 443, timeoutMs = 5000): Promise<TlsInfo> {
  return new Promise((resolve) => {
    const socket = tls.connect(
      { host, port, servername: host, rejectUnauthorized: false, timeout: timeoutMs },
      () => {
        try {
          const cert = socket.getPeerCertificate();
          if (!cert || !cert.valid_to) {
            socket.destroy();
            return resolve({ valid: false, error: 'no certificate presented' });
          }
          const validTo = new Date(cert.valid_to);
          const days = Math.round((validTo.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
          const issuer = cert.issuer ? (cert.issuer.O || cert.issuer.CN || 'Unknown') : undefined;
          socket.destroy();
          resolve({
            valid: socket.authorized && days > 0,
            issuer,
            expires_at: validTo.toISOString(),
            days_remaining: days,
          });
        } catch (err: any) {
          socket.destroy();
          resolve({ valid: false, error: err?.message ?? String(err) });
        }
      },
    );
    socket.on('timeout', () => {
      socket.destroy();
      resolve({ valid: false, error: 'timeout' });
    });
    socket.on('error', (err) => {
      socket.destroy();
      resolve({ valid: false, error: err.message });
    });
  });
}

/** Extracts unique candidate domains from a Step 1 checkpoint. */
export function extractCandidateDomains(checkpoint: RawResearchCheckpoint): Map<string, string> {
  const domains = new Map<string, string>();
  const add = (d?: string | null, role = 'official site') => {
    if (!d) return;
    d = d.toLowerCase().trim().replace(/^https?:\/\//i, '').replace(/\/.*$/, '').replace(/^www\./, '').replace(/\.$/, '');
    if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(d)) return;
    if (FREE_MAIL.test(d + '.') || SOCIAL_DOMAINS.test(d)) return;
    if (!domains.has(d)) domains.set(d, role);
  };

  add(checkpoint.official_site?.domain, 'official site');
  if (checkpoint.official_site?.resolved_url) {
    try {
      add(new URL(checkpoint.official_site.resolved_url).hostname, 'official site');
    } catch {}
  }

  for (const t of checkpoint.official_site?.tried ?? []) {
    try {
      add(t.includes('://') ? new URL(t).hostname : t, 'candidate tried');
    } catch {
      add(t, 'candidate tried');
    }
  }

  const brand = (checkpoint.input?.company ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

  for (const page of checkpoint.official_site?.pages ?? []) {
    for (const m of page.markdown.matchAll(/[a-z0-9._%+-]+@([a-z0-9-]+(?:\.[a-z0-9-]+)+)/gi)) {
      add(m[1], 'email domain');
    }
  }

  for (const disc of checkpoint.third_party_discoveries ?? []) {
    try {
      const h = new URL(disc.url).hostname;
      if (brand.length >= 4 && h.toLowerCase().replace(/[^a-z0-9]/g, '').includes(brand)) {
        add(h, 'discovered namesake/brand domain');
      }
    } catch {}
  }

  return domains;
}

/** Runs the complete Step 1.5 audit: PageSpeed + Domain ownership & security. */
export async function runStep1_5Assets(
  checkpoint: RawResearchCheckpoint,
  log: (msg: string) => void = () => {},
): Promise<Step1_5_AssetsOutput> {
  const started = Date.now();
  const input = checkpoint.input ?? { company: '', country: '', industry: '' };
  const findings: TechnicalFinding[] = [];
  let findingSeq = 1;
  const addFinding = (f: Omit<TechnicalFinding, 'id'>) => {
    findings.push({ id: `asset_${findingSeq++}`, ...f });
  };

  // -------------------------------------------------------------
  // 1. Digital Assets: Domains, WHOIS, DNS, Email Defense, TLS
  // -------------------------------------------------------------
  const domainMap = extractCandidateDomains(checkpoint);
  const domainList = [...domainMap.keys()].slice(0, 5); // limit to top 5 relevant domains
  log(`[Step 1.5] Auditing ${domainList.length} domains: ${domainList.join(', ')}`);

  const auditedDomains: AuditedDomain[] = await Promise.all(
    domainList.map(async (domain) => {
      const role = domainMap.get(domain) ?? 'domain';
      log(`[Step 1.5] Checking registration & DNS for ${domain}...`);
      const [reg, dns, tlsInfo] = await Promise.all([
        lookupRegistration(domain),
        lookupDns(domain),
        checkTls(domain).catch((e) => ({ valid: false, error: e?.message ?? String(e) })),
      ]);

      const spfAll = dns.spf?.match(/([+?~-]?)all\b/i)?.[1] ?? null;
      const isPermissiveSpf = !dns.spf || spfAll === '+' || spfAll === '?';
      const dmarcMatch = dns.dmarc?.match(/p=(\w+)/i)?.[1]?.toLowerCase() ?? null;
      const isEnforcedDmarc = dmarcMatch === 'reject' || dmarcMatch === 'quarantine';
      const isSpoofable = isPermissiveSpf || !isEnforcedDmarc;

      const emailSec: EmailSecurity = {
        has_spf: !!dns.spf,
        spf_all: spfAll ? `${spfAll}all` : null,
        has_dmarc: !!dns.dmarc,
        dmarc_policy: dmarcMatch,
        is_spoofable: isSpoofable,
      };

      // Findings: Expiry
      if (reg.days_until_expiry !== null) {
        if (reg.days_until_expiry <= 30) {
          addFinding({
            title: `Domain ${domain} expires in ${reg.days_until_expiry} days`,
            detail: `Domain registration expires on ${reg.expires} (under 30 days remaining). Failure to renew will immediately take down the company website and email.`,
            severity: 'critical',
            check: 'domain-expiry',
            domain,
            source: `${reg.source}:${domain}`,
          });
        } else if (reg.days_until_expiry <= 60) {
          addFinding({
            title: `Domain ${domain} expires in ${reg.days_until_expiry} days`,
            detail: `Domain registration expires on ${reg.expires}. Renewal recommended before grace period risk.`,
            severity: 'high',
            check: 'domain-expiry',
            domain,
            source: `${reg.source}:${domain}`,
          });
        }
      }

      // Findings: Hijack Transfer Lock
      if (reg.registrar && !reg.is_locked && !reg.error) {
        addFinding({
          title: `Domain ${domain} lacks transfer lock protection`,
          detail: `The domain status does not have 'clientTransferProhibited'. Without this registry lock, the domain is vulnerable to unauthorized transfer or domain hijacking.`,
          severity: 'medium',
          check: 'domain-lock',
          domain,
          source: `${reg.source}:${domain}`,
        });
      }

      // Findings: Email Spoofing & Phishing Vulnerability
      if (isSpoofable && (dns.mx.length > 0 || role.includes('official') || role.includes('email'))) {
        const reasons: string[] = [];
        if (!dns.spf) reasons.push('missing SPF record');
        else if (isPermissiveSpf) reasons.push(`permissive SPF policy (${spfAll || '+'}all)`);
        if (!dns.dmarc) reasons.push('missing DMARC record');
        else if (!isEnforcedDmarc) reasons.push(`unenforced DMARC policy (p=${dmarcMatch})`);

        addFinding({
          title: `Domain ${domain} is vulnerable to email spoofing & impersonation`,
          detail: `Mail servers do not strictly reject unauthorized senders (${reasons.join(', ')}). Threat actors can forge email from @${domain} for CEO fraud, client invoice redirection, or phishing.`,
          severity: 'high',
          check: 'email-spoofing',
          domain,
          source: `dns:${domain}`,
        });
      }

      // Findings: TLS Cert Expiry
      if (tlsInfo && tlsInfo.days_remaining !== undefined && tlsInfo.days_remaining < 14 && tlsInfo.days_remaining >= 0) {
        addFinding({
          title: `SSL/TLS certificate for ${domain} expires in ${tlsInfo.days_remaining} days`,
          detail: `Certificate issued by ${tlsInfo.issuer ?? 'unknown'} expires on ${tlsInfo.expires_at}. Browsers will flag the site with security warnings upon expiration.`,
          severity: 'high',
          check: 'tls-expiry',
          domain,
          source: `https://${domain}`,
        });
      }

      return {
        domain,
        role,
        registration: reg,
        dns,
        email_security: emailSec,
        tls: tlsInfo,
      };
    }),
  );

  // -------------------------------------------------------------
  // 2. Google PageSpeed Insights (Official Website)
  // -------------------------------------------------------------
  const officialSiteUrl = checkpoint.official_site?.resolved_url || (checkpoint.official_site?.domain ? `https://${checkpoint.official_site.domain}/` : null);
  let psiMobile: Psi | undefined;
  let psiDesktop: Psi | undefined;
  let psiStatus: 'done' | 'skipped' | 'failed' = 'done';
  let psiReason: string | undefined;
  let psiError: string | undefined;

  // 4. The SEO / GEO benchmark runs on a worker PC while PageSpeed and the reviews read go; awaited at the end.
  let siteAudit: SiteAuditBlock | undefined;
  let auditRun: Promise<SiteAuditBlock> | null = null;
  if (siteAuditOn()) {
    if (checkpoint.skipped || !officialSiteUrl) {
      siteAudit = { status: 'not_run', reason: checkpoint.skipped ? `Research skipped: ${checkpoint.skipped}` : 'No confirmed official website' };
    } else {
      log(`[Step 1.5] SEO / GEO benchmark of ${officialSiteUrl} on a worker...`);
      auditRun = workerAudit(officialSiteUrl).then((a) => ({
        status: a.status === 'done' ? 'done' : 'failed',
        target_url: officialSiteUrl,
        ...(a.job_id ? { job_id: a.job_id } : {}),
        ...(a.worker ? { worker: a.worker } : {}),
        ...(a.status === 'done' ? { result: a.result } : { error: a.error ?? `audit ${a.status}` }),
      }));
    }
  }

  // 5. The global handlers run on worker PCs (the slowest, Wayback, can take a minute) while PageSpeed and the reviews
  // read go; awaited at the end. A handler that fails is recorded in its answer; it never stops the rest of Step 1.5.
  let globalHandlers: GlobalHandlersBlock | undefined;
  let globalRun: Promise<GlobalHandlersBlock> | null = null;
  if (siteLookupOn() && globalHandlersOn()) {
    const officialDomain = checkpoint.official_site?.domain;
    if (checkpoint.skipped || !officialDomain) {
      globalHandlers = { status: 'not_run', reason: checkpoint.skipped ? `Research skipped: ${checkpoint.skipped}` : 'No confirmed official website', handlers: [] };
    } else {
      log(`[Step 1.5] Global handlers on ${officialDomain} (worker PCs)...`);
      globalRun = runGlobalHandlers(officialDomain);
    }
  }

  if (checkpoint.skipped || !officialSiteUrl) {
    psiStatus = 'skipped';
    psiReason = checkpoint.skipped ? `Research skipped: ${checkpoint.skipped}` : 'No confirmed official website';
    log(`[Step 1.5] PageSpeed skipped: ${psiReason}`);
  } else {
    log(`[Step 1.5] Requesting Google token and running PageSpeed on ${officialSiteUrl}...`);
    try {
      const token = await pagespeed.token((w) => log(`[Step 1.5] PageSpeed token warn: ${w}`));
      if (!token) {
        psiStatus = 'failed';
        psiError = 'Google service account token could not be obtained';
        log(`[Step 1.5] ${psiError}`);
      } else {
        const site = checkpoint.official_site?.domain || new URL(officialSiteUrl).hostname;
        const [mobRaw, deskRaw] = await Promise.all([
          pagespeed.run(officialSiteUrl, 'mobile', token).catch((e: any) => ({ error: e.message })),
          pagespeed.run(officialSiteUrl, 'desktop', token).catch((e: any) => ({ error: e.message })),
        ]);

        if (mobRaw?.lighthouseResult) {
          psiMobile = readPsi(mobRaw, { url: officialSiteUrl, site, strategy: 'mobile' });
        } else {
          psiMobile = { url: officialSiteUrl, site, strategy: 'mobile', ok: false, error: mobRaw?.error ?? 'no Lighthouse result' };
        }

        if (deskRaw?.lighthouseResult) {
          psiDesktop = readPsi(deskRaw, { url: officialSiteUrl, site, strategy: 'desktop' });
        } else {
          psiDesktop = { url: officialSiteUrl, site, strategy: 'desktop', ok: false, error: deskRaw?.error ?? 'no Lighthouse result' };
        }

        const link = (st: 'mobile' | 'desktop') => `https://pagespeed.web.dev/analysis?url=${encodeURIComponent(officialSiteUrl)}&form_factor=${st}`;

        // PageSpeed Findings
        for (const psi of [psiMobile, psiDesktop]) {
          if (!psi || !psi.ok || !psi.scores) continue;
          const perf = psi.scores.performance ?? 0;
          const real = psi.field && Object.keys(psi.field.metrics).length;

          addFinding({
            title: `Google scores ${psi.strategy} website on ${psi.site} ${perf}/100 for speed`,
            detail: [
              `Performance ${perf}/100, Accessibility ${psi.scores.accessibility ?? '?'}/100, Best Practices ${psi.scores['best-practices'] ?? '?'}/100, SEO ${psi.scores.seo ?? '?'}/100.`,
              psi.lab && Object.keys(psi.lab).length ? `Lab metrics: ${Object.entries(psi.lab).map(([k, v]) => `${k.toLowerCase()} ${v}`).join(', ')}.` : '',
              real ? `Real Chrome visitors in the last 28 days: ${Object.entries(psi.field!.metrics).map(([k, v]) => `${k.toLowerCase()} ${v}`).join(', ')}.` : 'Google has too few visitors on record to report real-world 28-day field data.',
            ].filter(Boolean).join(' '),
            severity: perf < 50 ? (psi.strategy === 'mobile' ? 'high' : 'medium') : perf < 90 ? 'medium' : 'info',
            check: 'psi-score',
            strategy: psi.strategy,
            domain: psi.site,
            source: link(psi.strategy),
            evidence_url: link(psi.strategy),
          });

          if (psi.field?.overall === 'slow') {
            addFinding({
              title: `Real visitors experience slow loading on ${psi.site} (${psi.strategy})`,
              detail: `Google CrUX 28-day field data rates the site as 'slow' overall. Google uses real-user Core Web Vitals directly in its search ranking algorithms.`,
              severity: 'high',
              check: 'psi-field',
              strategy: psi.strategy,
              domain: psi.site,
              source: link(psi.strategy),
              evidence_url: link(psi.strategy),
            });
          }

          if (psi.fixes && psi.fixes.length > 0 && perf < 90) {
            addFinding({
              title: `Google's top performance fixes for ${psi.site} on ${psi.strategy}`,
              detail: psi.fixes.map((f) => `${f.title} (${f.saving})`).join('; ') + '.',
              severity: perf < 50 ? 'medium' : 'low',
              check: 'psi-fixes',
              strategy: psi.strategy,
              domain: psi.site,
              source: link(psi.strategy),
              evidence_url: link(psi.strategy),
            });
          }

          if (psi.flags && psi.flags.length > 0) {
            const seoFlags = psi.flags.filter((f) => f.category === 'seo');
            if (seoFlags.length > 0 && psi.strategy === 'mobile') {
              addFinding({
                title: `Homepage on ${psi.site} fails ${seoFlags.length} of Google's SEO checks`,
                detail: seoFlags.map((f) => f.title).join('; ') + '. These fundamentals impair Google search indexing and ranking.',
                severity: 'medium',
                check: 'psi-seo',
                domain: psi.site,
                source: link(psi.strategy),
                evidence_url: link(psi.strategy),
              });
            }
          }
        }
      }
    } catch (e: any) {
      psiStatus = 'failed';
      psiError = e?.message ?? String(e);
      log(`[Step 1.5] PageSpeed run failed: ${psiError}`);
    }
  }

  // -------------------------------------------------------------
  // 3. Google Maps reviews of the company's own profile (Scraper.Tech; the worker reads at most ~10, so not the worker)
  // -------------------------------------------------------------
  const google_reviews: GoogleReviewsBlock = { status: 'not_run', max: REVIEWS_MAX };
  if (checkpoint.skipped) {
    google_reviews.reason = `Research skipped: ${checkpoint.skipped}`;
  } else {
    const pick = pickMapsProfile(checkpoint);
    if (!pick.profile) {
      google_reviews.reason = pick.reason;
    } else {
      google_reviews.profile = pick.profile;
      log(`[Step 1.5] Reading Google Maps reviews of "${pick.profile.name}" (max ${REVIEWS_MAX}) through Scraper.Tech...`);
      try {
        const data = await scrapertech.reviews({ placeId: pick.profile.place_id }, { max: REVIEWS_MAX, country: /malaysia/i.test(input.country) ? 'my' : undefined });
        google_reviews.status = 'done';
        google_reviews.data = data;
        log(`[Step 1.5] Google reviews: ${data.reviews.length} read in ${data.calls} request(s)${data.truncated ? ' (more exist)' : ''}.`);
      } catch (e: any) {
        google_reviews.status = 'failed';
        google_reviews.error = e?.message ?? String(e);
        log(`[Step 1.5] Google reviews failed: ${google_reviews.error}`);
      }
    }
  }

  if (auditRun) {
    siteAudit = await auditRun;
    const sc = (siteAudit.result as any)?.scores;
    log(`[Step 1.5] SEO / GEO benchmark: ${siteAudit.status}${sc ? ` (SEO ${sc.seo}, GEO ${sc.geo})` : ''}${siteAudit.error ? `: ${siteAudit.error}` : ''}`);
  }

  if (globalRun) {
    globalHandlers = await globalRun;
    log(`[Step 1.5] Global handlers: ${globalHandlers.status}${globalHandlers.error ? ` (${globalHandlers.error})` : ''}${globalHandlers.handlers.length ? ` - ${globalHandlers.handlers.map((h) => `${h.id} ${h.lookup.job_status === 'done' ? h.lookup.status : 'did not run'}`).join(', ')}` : ''}`);
  }

  const durationMs = Date.now() - started;
  log(`[Step 1.5] Completed in ${durationMs}ms with ${findings.length} technical findings.`);

  return {
    version: '2.1',
    stage: 1.5,
    created_at: new Date().toISOString(),
    input: {
      company: input.company,
      country: input.country,
      industry: input.industry,
      ...(input.website ? { website: input.website } : {}),
    },
    status: 'done',
    skip_reason: checkpoint.skipped ?? null,
    error: null,
    pagespeed: {
      status: psiStatus,
      reason: psiReason,
      target_url: officialSiteUrl ?? undefined,
      mobile: psiMobile,
      desktop: psiDesktop,
      error: psiError,
    },
    domains: auditedDomains,
    google_reviews,
    ...(siteAudit ? { site_audit: siteAudit } : {}),
    ...(globalHandlers ? { global_handlers: globalHandlers } : {}),
    findings,
    stats: {
      domains_checked: auditedDomains.length,
      pagespeed_runs: psiStatus === 'done' ? 2 : 0,
      findings_count: findings.length,
      reviews_read: google_reviews.data?.reviews.length ?? 0,
      duration_ms: durationMs,
    },
  };
}
