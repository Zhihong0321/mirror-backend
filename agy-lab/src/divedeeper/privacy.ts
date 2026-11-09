// What may be printed where. The preview goes to someone who has not paid, on a public link, so it
// shows only the company itself and its publicly named leadership. The full report goes to the
// client, so it may name their staff, but never prints a private document link (a proposal,
// invoice or portal meant for one customer) or an ID number.
import { findPII } from '../report-rules/index.ts';

/** A link to a document or portal meant for one customer or for staff, never for the public. */
const PRIVATE_URL = /proposal|invoice|quotation|receipt|[?&](uid|token|key)=|\/inv[-/]|\/(admin|agent|portal|dashboard)(\/|$|\?)/i;
export const isPrivateUrl = (u: unknown): boolean => PRIVATE_URL.test(String(u ?? ''));

/** Sources fit to list: the ones the company-dive judged to be about this company, minus private documents. */
export function publicSources<T extends { url?: string; relevant?: boolean }>(sources: T[] | undefined): T[] {
  return (sources ?? []).filter((s) => s && s.relevant !== false && !isPrivateUrl(s.url));
}

/** Named in public as running the company: the people a preview may name. */
export const isLeadership = (role: unknown): boolean => /\b(ceo|chief executive|founder|co-founder|managing director|director|owner|chairman|chairperson|president|general manager|principal)\b/i.test(String(role ?? ''));

// A job that merely contains "director" or "principal". The loose check above accepts these.
const CRAFT_DIRECTOR = /\b(?:art|creative|design|technical|music|athletic|funeral|film|video|stage|lighting|sound|photo|photography|marketing|sales)\s+director\b/i;
const RANK_PRINCIPAL = /\bprincipal\s+(?:engineer|engineering|consultant|designer|architect|developer|scientist|analyst|investigator|researcher)\b/i;
const OFFICE = /\b(ceo|chief executive|founder|co-founder|managing director|executive director|owner|chairman|chairperson|president|general manager)\b/i;

/** Running the company. "Art Director" and "Principal Engineer" fail it; "Director" and "Principal" do not. */
export const isLeadershipStrict = (role: unknown): boolean => {
  const s = String(role ?? '');
  if (!s.trim()) return false;
  if (OFFICE.test(s)) return true;
  if (CRAFT_DIRECTOR.test(s) || RANK_PRINCIPAL.test(s)) return false;
  return /\b(director|principal)\b/i.test(s);
};

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const PUB_PHONE = /(?:\+?6?0)[\s-]?1\d[\s-]?\d{3,4}[\s-]?\d{3,4}\b|\+\d[\d\s().-]{6,}\d|\b0\d{1,2}[\s-]\d{3,4}[\s-]?\d{4}\b/i;
const WEB = /\b(?:https?:\/\/|www\.)[^\s<>"')\]]+|\b(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/[^\s<>"')\]]*)?/i;
const DIGITS = /\d{6,}/;
// Any country's phone as written: 3 or more digit groups split by spaces, dots, dashes or brackets, 9 or more digits in all
// (1-888-595-8255, 03-2022 5418, (02) 9374 4000). Dates stay: 2026-11-03 and 2009-2019 have only 8 digits.
const GROUPED = /\(?\+?\d{1,4}\)?(?:[\s.()-]{1,3}\d{1,4}){2,}/g;
const phoneLike = (m: string): boolean => (m.match(/\d/g) ?? []).length >= 9;
const hasGroupedPhone = (s: string): boolean => (s.match(GROUPED) ?? []).some(phoneLike);

/** True when the text holds an email, a phone number, a URL, or a run of 6 or more digits. */
export const hasPrivate = (text: unknown): boolean => {
  const s = String(text ?? '');
  return EMAIL.test(s) || PUB_PHONE.test(s) || hasGroupedPhone(s) || WEB.test(s) || DIGITS.test(s);
};

const hostOfUrl = (raw: string): string => {
  const core = raw.trim().replace(/[.,;:)]+$/, '');
  try {
    return new URL(/^https?:\/\//i.test(core) ? core : `http://${core}`).hostname.replace(/^www\./i, '').toLowerCase();
  } catch {
    return '';
  }
};

const officialHost = (domain: string): string => domain.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split(/[/?#]/)[0]?.replace(/\.$/, '') ?? '';

const isOfficialUrl = (raw: string, domains: readonly string[]): boolean => {
  const host = hostOfUrl(raw);
  if (!host) return false;
  return domains.some((d) => {
    const official = officialHost(String(d));
    return !!official && (host === official || host.endsWith(`.${official}`));
  });
};

/** Drops emails, phone numbers, non-official URLs, official URLs that hold 6 or more digits in a row, and any other run of 6 or more digits. */
export function scrubPublic(text: unknown, officialDomains: readonly string[] = []): string {
  const s = String(text ?? '');
  if (!s) return s;
  const domains = officialDomains.map((d) => String(d));
  const email = new RegExp(EMAIL.source, 'gi');
  const phone = new RegExp(PUB_PHONE.source, 'gi');
  const url = new RegExp(WEB.source, 'gi');
  const peel = (m: string) => {
    const parts = m.match(/^(.*?)([.,;:)]*)$/);
    const core = parts?.[1] || m;
    const tail = parts?.[2] ?? '';
    // No digit-run exception: an official URL that itself holds one is dropped whole.
    return { core, tail, ok: isOfficialUrl(core, domains) && !/\d{6,}/.test(core) };
  };
  let out = s.replace(email, '').replace(phone, '').replace(GROUPED, (m) => (phoneLike(m) ? '' : m));
  out = out.replace(url, (m) => { const p = peel(m); return (p.ok ? p.core : '') + p.tail; });
  out = out.replace(/\d{6,}/g, '');
  if (out === s) return s;
  return out.replace(/[ \t]{2,}/g, ' ').replace(/[ \t]+([,.;:)])/g, '$1').trim();
}

// URLs and bare hosts that point at one customer's document, e.g. ee-proposal-production.up.railway.app?uid=….
const URLISH = /\b(?:https?:\/\/)?[a-z0-9.-]+\.[a-z]{2,}(?:\/[^\s)\]"'<>]*)?(?:\?[^\s)\]"'<>]*)?/gi;
// Malaysian phone numbers as people write them: +60 11-2341 1550, 012-7165685, 01120672895.
const PHONE = /(?:\+?6?0)[\s-]?1\d[\s-]?\d{3,4}[\s-]?\d{3,4}\b|\b0\d{1,2}[\s-]\d{3,4}[\s-]?\d{4}\b/g;
const escRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Removes private document links from any text; for the preview also phone numbers and the names of staff who are not leadership. */
export function scrub(text: unknown, opts: { phones?: boolean; staff?: string[] } = {}): string {
  let s = String(text ?? '');
  s = s.replace(URLISH, (m) => (isPrivateUrl(m) || /proposal/i.test(m) ? 'a private customer document' : m));
  if (opts.phones) s = s.replace(PHONE, 'a phone number');
  for (const name of opts.staff ?? []) {
    // Full name first, then the name before any bracket, so "Ahmad Safwan bin Ahmad Nazri (Safwan Nazri)" goes either way.
    for (const form of [name, name.replace(/\s*\(.*\)\s*$/, ''), name.match(/\(([^)]+)\)/)?.[1]].filter((x): x is string => !!x && x.trim().length >= 4)) {
      s = s.replace(new RegExp(escRe(form.trim()), 'gi'), 'a staff member');
    }
  }
  return s;
}

/** The customer's own report prints a phone only when it is one of the company's published contacts (any country, via libphonenumber). */
export function scrubPersonalPhones(text: string, ctx: { country: string; companyPhones: string[] }): string {
  return text.replace(/\+?\(?\d[\d\s().-]{6,}\d/g, (span) => (findPII(span, 'report', { ...ctx, personNames: [] }).length ? 'a phone number' : span));
}

/** Names the report may print: reviewers never, staff only where the role is leadership. */
export const mayNamePerson = (role: unknown): boolean => isLeadershipStrict(role);
