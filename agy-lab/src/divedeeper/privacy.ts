// What may be printed where. The preview goes to someone who has not paid, on a public link, so it
// shows only the company itself and its publicly named leadership. The full report goes to the
// client, so it may name their staff, but never prints a private document link (a proposal,
// invoice or portal meant for one customer) or an ID number.

/** A link to a document or portal meant for one customer or for staff, never for the public. */
const PRIVATE_URL = /proposal|invoice|quotation|receipt|[?&](uid|token|key)=|\/inv[-/]|\/(admin|agent|portal|dashboard)(\/|$|\?)/i;
export const isPrivateUrl = (u: unknown): boolean => PRIVATE_URL.test(String(u ?? ''));

/** Sources fit to list: the ones the company-dive judged to be about this company, minus private documents. */
export function publicSources<T extends { url?: string; relevant?: boolean }>(sources: T[] | undefined): T[] {
  return (sources ?? []).filter((s) => s && s.relevant !== false && !isPrivateUrl(s.url));
}

/** Named in public as running the company: the people a preview may name. */
export const isLeadership = (role: unknown): boolean => /\b(ceo|chief executive|founder|co-founder|managing director|director|owner|chairman|chairperson|president|general manager|principal)\b/i.test(String(role ?? ''));

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
