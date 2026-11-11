// Translate the saved V2.1 research into the input the existing lanes read.
import type { RawKind } from '../../v21-store.ts';

type Kind = Extract<RawKind, 'checkpoint' | 'assets' | 'tidy' | 'result'>;
type Raw = { id: number; payload: any };
export type Reader = {
  getReport: (id: string) => Promise<Record<string, unknown> | null>;
  latestRaw: (id: string, kind: Kind) => Promise<Raw | null>;
};
const kinds: Kind[] = ['checkpoint', 'assets', 'tidy', 'result'];
const strings = (value: unknown): string[] => Array.isArray(value) ? value.filter((x): x is string => typeof x === 'string') : typeof value === 'string' ? [value] : [];

// A bracket just before the legal form belongs to the registered name: "DNE Forwarding (M) Sdn Bhd".
const LEGAL_BRACKET = /\(([^()]*)\)(?=\s*(?:sdn\.?\s*bhd|bhd|berhad|plt|pte\.?\s*ltd|ltd)\b)/gi;

/** Bracketed annotations in the baseline are notes, not part of the name or address. */
function clean(value: string): string {
  // Park the legal-name brackets while the notes are removed, then put them back.
  let out = value.replace(LEGAL_BRACKET, '\u0001$1\u0002');
  while (/\([^()]*\)|\[[^\[\]]*\]/.test(out)) out = out.replace(/\([^()]*\)|\[[^\[\]]*\]/g, ' ');
  return out.replace(/\u0001/g, '(').replace(/\u0002/g, ')').replace(/\s+/g, ' ').trim();
}
const address = (value: string) => clean(value).replace(/^[\p{L}][\p{L} .'-]{0,40}:\s*/u, '').trim();
const unique = (values: string[]) => [...new Map(values.filter(Boolean).map((x) => [x.toLowerCase(), x])).values()];

function host(value: string): string {
  const bare = clean(value).replace(/^(?:website|domain|official site)\s*:\s*/i, '').trim();
  try {
    const url = new URL(/^https?:\/\//i.test(bare) ? bare : 'https://' + bare);
    return /^https?:$/.test(url.protocol) ? url.hostname.toLowerCase().replace(/^www\./, '').replace(/\.$/, '') : '';
  } catch { return ''; }
}

// Match the company's brand against the domain's own label, never a directory's subdomain.
function domainLabel(domain: string): string {
  const parts = domain.split('.');
  const suffix = /\.(?:com|net|org|edu|gov|co)\.[a-z]{2}$/.test(domain) ? 2 : 1;
  return parts.at(-suffix - 1) ?? '';
}

// The relation the old lanes key on, read from the role words as written (mechanical; Step 2 already judged who belongs).
function relationOf(role: string): string {
  const r = role.toLowerCase();
  if (/founder|co-founder|pengasas/.test(r)) return 'founder';
  if (/director|pengarah|chairman|ceo|managing|owner|proprietor|president/.test(r)) return 'director';
  if (/shareholder|pemegang saham/.test(r)) return 'shareholder';
  if (/manager|head|lead|chief|gm|general manager/.test(r)) return 'management';
  if (/agent|dealer|reseller|ejen/.test(r)) return 'agent';
  if (/partner/.test(r)) return 'partner';
  if (/former|ex-/.test(r)) return 'former';
  return r ? 'employee' : 'other';
}

/** Step 2's people list (every person and contact tied to the brand) in the shape the old lanes read. */
function peopleOf(list: unknown): any[] {
  return (Array.isArray(list) ? list : []).filter((p: any) => p && String(p.name ?? '').trim()).map((p: any) => ({
    name: String(p.name).trim(), role: String(p.role ?? ''), relation: relationOf(String(p.role ?? '')), current: null,
    evidence: (Array.isArray(p.evidence) ? p.evidence : []).map((e: any) => ({ url: String(e?.source_url ?? ''), quote: String(e?.quoted_text ?? '') })),
    confidence: 'high', ...(p.contact ? { notes: `contact: ${p.contact}` } : {}),
  }));
}

export async function loadV21Dive(reportId: string, reader?: Reader) {
  const source = reader ?? await import('../../v21-store.ts');
  const report = await source.getReport(reportId);
  if (!report) throw new Error(`V2.1 report ${reportId} is missing`);
  for (const step of [1, 2]) {
    if (report[`step${step}_status`] !== 'done') throw new Error(`V2.1 report ${reportId}: Step ${step} is not done (${report[`step${step}_status`] ?? 'missing'})`);
  }
  const raw = Object.fromEntries(await Promise.all(kinds.map(async (kind) => [kind, await source.latestRaw(reportId, kind)]))) as Record<Kind, Raw | null>;
  if (raw.checkpoint?.payload?.skipped) throw new Error(`V2.1 report ${reportId}: checkpoint is skipped`);
  if (!raw.result) throw new Error(`V2.1 report ${reportId}: no result row`);
  if (!raw.checkpoint) throw new Error(`V2.1 report ${reportId}: no checkpoint row`);
  const baseline = raw.result.payload?.baseline ?? {};
  const lookups = Object.fromEntries((raw.checkpoint.payload?.probes ?? [])
    .filter((p: any) => p?.lookup?.handler)
    .map((p: any) => [p.lookup.handler, p.lookup]));
  const legal = strings(baseline.legal_names);
  // A registration number printed beside the name ("... Sdn. Bhd. 201501019046 (1144381-A)") is not part of it;
  // it is read into registration_numbers below. Left in, it breaks register searches and the report's title.
  const legalName = clean(legal[0] ?? '').replace(/\b(?:\d{5,7}-[A-Z]|(?:19|20)\d{10})\b/gi, ' ').replace(/\s+/g, ' ').trim() || String(report.company);
  const aliases = unique(strings(baseline.brand_names).map(clean)).filter((x) => x.toLowerCase() !== legalName.toLowerCase());
  const registrations = unique([...legal, ...strings(baseline.claimed_numbers)].flatMap((x) =>
    [...x.matchAll(/\b(?:\d{5,7}-[A-Z]|(?:19|20)\d{10})\b/gi)].map((m) => m[0].toUpperCase())));
  const brandWords = unique([...aliases, legalName, String(report.company)].map((x) => x.toLowerCase().match(/[a-z0-9]+/)?.[0] ?? ''));
  const gate = host(String(raw.checkpoint.payload?.official_site?.domain ?? ''));
  const domains = [...strings(baseline.websites), ...strings(baseline.official_domain)].map(host)
    .filter((d) => d && brandWords.some((brand) => brand.length >= 3 && domainLabel(d).includes(brand)));
  const addresses = strings(baseline.addresses).map(address);
  const pages: { label: string; url: string; text: string }[] = (raw.tidy?.payload?.official?.pages ?? []).map((p: any) => ({
    label: String(p.label ?? 'Official page'), url: String(p.url ?? ''), text: String(p.text ?? ''),
  }));
  const siteWide = String(raw.tidy?.payload?.official?.site_wide ?? '');
  // V2.1 has official claims, not the old dive's verified fact sheet. Keep that distinction for the judge.
  const facts = [
    ...addresses.map((a) => ({ topic: 'footprint', fact: `Office: ${a}` })),
    ...strings(baseline.phones).map((p) => ({ topic: 'contact', fact: `Official phone: ${p}` })),
    ...strings(baseline.claimed_credentials).map((c) => ({ topic: 'credentials', fact: `Official site claims: ${c}` })),
    ...strings(baseline.claimed_numbers).map((n) => ({ topic: 'identity', fact: `Official site claims: ${n}` })),
    ...pages.map((p) => ({ topic: 'products_services', fact: `${p.label}: ${p.text}` })),
    ...(siteWide ? [{ topic: 'identity', fact: `Official header and footer: ${siteWide}` }] : []),
  ].map((f) => ({ ...f, confidence: 'medium' }));
  // Step 2 rules v1 keeps contradictions among its findings; rules v2 has its own list with every version of the fact.
  const contradictions: string[] = [
    ...(raw.result.payload?.findings ?? [])
      .filter((f: any) => ['contradiction', 'profile_drift'].includes(f.type))
      .map((f: any) => `Official claim: ${f.claim ?? ''}; ${f.source_name ?? 'outside source'}: ${f.outside_source ?? ''} (${f.source_url ?? ''})`),
    ...(raw.result.payload?.contradictions ?? [])
      .map((c: any) => `${c.title ?? ''}: ${(c.versions ?? []).map((v: any) => `${v.value ?? ''} (${v.source ?? ''})`).join(' vs ')}`),
  ];
  return {
    dive: {
      company: String(report.company), country: String(report.country),
      finished_at: raw.result.payload?.created_at ?? report.updated_at ?? null,
      result: {
        identity: { legal_name: legalName, aliases, address: addresses[0] ?? '', industry: report.industry, official_domains: unique([gate, ...domains]), registration_numbers: registrations,
          summary: pages.map((p) => `${p.label}: ${p.text}`).join('\n').slice(0, 1500) },
        facts, contradictions,
        people: { people: peopleOf(raw.result.payload?.people) }, sources: pages.filter((p) => p.url).map((p, i) => ({ id: i + 1, url: p.url, title: p.label })),
      },
      v21: { report_id: reportId, company_uid: report.company_uid ?? null, maps_own: raw.checkpoint.payload?.google_maps?.result?.businesses ?? [], pages, site_wide: siteWide,
        assets: raw.assets?.payload ?? null, baseline,
        warnings: ['V2.1 has no company-dive background dossier; that appendix is omitted.',
          ...(raw.assets?.payload?.google_reviews?.data?.truncated ? ['Step 1.5 Google reviews are a saved sample; review counts in the analysis cover only that sample.'] : [])],
        people: Array.isArray(raw.result.payload?.people) ? raw.result.payload.people : [],
        lookups, claims: { claimed_credentials: strings(baseline.claimed_credentials), claimed_numbers: strings(baseline.claimed_numbers) } },
    },
    rows: Object.fromEntries(kinds.map((kind) => [kind, raw[kind]?.id ?? null])),
  };
}
