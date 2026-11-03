// What the switched preview editor is allowed to see. Everything else in the company-dive
// (the address, registration numbers, domains, the summary, contradictions, gaps, and anyone
// who is not leadership) stays out of the prompt.
import type { DiveResult } from '../companydive/pipeline.ts';
import { hasPrivate, isLeadershipStrict, publicSources, scrubPublic } from './privacy.ts';

export type PreviewInput = {
  legalName: string;
  tradingNames: string[];
  industry: string;
  town: string;
  state: string;
  leadership: { name: string; title: string }[];
  /** Public facts that cite a public source. `sources` are those source ids. */
  facts: { fact: string; sources: number[] }[];
  /** Where a cited id was published. The prompt does not read this. */
  sourceUrls: { id: number; url: string }[];
};

const clean = (text: unknown, domains: string[]): string => {
  const s = String(text ?? '').trim();
  if (!s) return '';
  return hasPrivate(s) ? scrubPublic(s, domains) : s;
};

/** Town and state after a Malaysian postcode. The street and the postcode stay out. */
function areaOf(address: unknown): { town: string; state: string } {
  const m = String(address ?? '').match(/\b\d{5}\s+([^,\n]+)\s*(?:,\s*([^,\n]+))?/);
  if (!m) return { town: '', state: '' };
  return { town: m[1].trim(), state: (m[2] ?? '').trim() };
}

function peopleOf(result: DiveResult): { name?: unknown; role?: unknown }[] {
  const people = (result.people as { people?: unknown } | null | undefined)?.people;
  return Array.isArray(people) ? people : [];
}

/** The allow-list. Only this object may be turned into the preview prompt. */
export function previewInput(result: DiveResult): PreviewInput {
  const r = result ?? ({} as DiveResult);
  const id = r.identity ?? {};
  const domains = (id.official_domains ?? []).map((d) => String(d));
  const urls = new Map(publicSources(r.sources).flatMap((s) => (s.url ? [[s.id, s.url] as const] : [])));
  const facts = (r.facts ?? []).flatMap((f) => {
    if (!f || typeof f.fact !== 'string') return [];
    const fact = f.fact.trim();
    if (!fact || hasPrivate(fact)) return [];
    const sources = [...new Set((f.sources ?? []).filter((n) => urls.has(n)))];
    return sources.length ? [{ fact, sources }] : [];
  });
  const cited = new Set(facts.flatMap((f) => f.sources));
  const area = areaOf(id.address);
  return {
    legalName: clean(id.legal_name, domains),
    tradingNames: (id.aliases ?? []).map((a) => clean(a, domains)).filter(Boolean),
    industry: clean(id.industry, domains),
    town: clean(area.town, domains),
    state: clean(area.state, domains),
    leadership: peopleOf(r).flatMap((p) => {
      if (!isLeadershipStrict(p?.role)) return [];
      const name = clean(p?.name, domains);
      return name ? [{ name, title: clean(p?.role, domains) }] : [];
    }),
    facts,
    sourceUrls: [...cited].flatMap((n) => {
      const url = urls.get(n);
      return url ? [{ id: n, url }] : [];
    }),
  };
}
