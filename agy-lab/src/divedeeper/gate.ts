// PL25 for the deeper reports: what the gate needs from a company-dive, and the holding pages a blocked report gets.
import { gateReport, gateResult, type GateInput, type GateItem, type GateResult } from '../report-rules/gate.ts';
import { isLeadership } from './privacy.ts';

/** The company's own published contacts, and the people who may not be named (everyone not publicly named leadership). */
export function diveGateContext(dive: any): Pick<GateInput, 'country' | 'companyPhones' | 'personNames'> {
  const r = dive?.result ?? {};
  const id = r.identity ?? {};
  const rejected = Array.isArray(r.people?.rejected) ? r.people.rejected : [];
  const people: any[] = r.people?.people ?? [];
  return {
    country: String(dive?.country ?? ''),
    companyPhones: [String(id.address ?? ''), ...(Array.isArray(id.phones) ? id.phones.map(String) : [])].filter(Boolean),
    personNames: [...people.filter((p) => p?.name && !isLeadership(p.role)), ...rejected.filter((p: any) => p?.name)].map((p) => String(p.name)),
  };
}

/** The deeper full report: the page text against the company's contacts, banned words, markdown, ids, links, currency, counts. */
export function gateDeeperFull(dive: any, html: string): GateResult {
  return gateResult(gateReport({ ...diveGateContext(dive), html, kind: 'deeper-full', items: [] }));
}

/** The deeper preview: the same, and each warning is also checked against its own quote and against the other warnings' "why". */
export function gateDeeperPreview(dive: any, html: string, warnings: Array<{ title?: string; detail?: string; risk?: string; quote?: string }> = []): GateResult {
  const items: GateItem[] = warnings.map((w, i) => ({
    id: `w${i + 1}`, text: [w.title, w.detail].filter(Boolean).join('. '), quotes: w.quote ? [w.quote] : [], why: w.risk,
  }));
  return gateResult(gateReport({ ...diveGateContext(dive), html, kind: 'deeper-preview', items }));
}

export const failureLine = (g: GateResult) => g.failures.map((f) => `${f.rule} (${f.where}): ${f.detail}`).join('; ');

/** What a client link shows instead of a report the gate stopped. */
export const heldPage = (what: string) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${what}</title><style>body{font-family:system-ui,sans-serif;max-width:720px;margin:40px auto;padding:0 16px;line-height:1.5;color:#15201b}</style></head><body><h1>${what}</h1><p>This page is being checked before it is shared. Please come back later.</p></body></html>`;
