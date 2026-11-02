// Every email we hold, one row per company + email, for email marketing.
//
// Two sources: contact research (people and company emails in the report results)
// and the website email lane (company_email). An address found by both is one row
// marked with both sources. Hidden and merged leads are left out.
import * as db from './reportdb.ts';
import { extractCompanyContacts } from './contacts.ts';

export interface EmailRow {
  email: string;
  company_id: string;
  company_name: string;
  category: string | null;
  person_name: string | null;
  person_role: string | null;
  sources: ('research' | 'website')[];
  source_url: string | null;
  lead_status: string | null;
  assigned_to: string | null;
}

export interface EmailStats {
  rows: number;
  distinctEmails: number;
  companies: number;
  withPerson: number;
  research: number;
  website: number;
  both: number;
}

const CACHE_MS = 2 * 60_000;
let cached: { at: number; rows: EmailRow[] } | null = null;

async function build(): Promise<EmailRow[]> {
  const byKey = new Map<string, EmailRow>();
  const add = (row: Omit<EmailRow, 'sources'>, source: 'research' | 'website') => {
    const email = row.email.trim().toLowerCase();
    if (!email.includes('@')) return;
    const key = row.company_id + '|' + email;
    const have = byKey.get(key);
    if (!have) { byKey.set(key, { ...row, email, sources: [source] }); return; }
    if (!have.sources.includes(source)) have.sources.push(source);
    if (!have.person_name && row.person_name) { have.person_name = row.person_name; have.person_role = row.person_role; }
    if (!have.source_url && row.source_url) have.source_url = row.source_url;
  };

  const researched = await db.getCompanyContactRows({ researchedOnly: true });
  for (const raw of researched) {
    const g = extractCompanyContacts(raw);
    const base = { company_id: g.company_id, company_name: g.company_name, category: g.category, lead_status: g.lead_status, assigned_to: g.assigned_to };
    for (const p of g.people) {
      if (p.unnamed || !p.direct_email) continue;
      add({ ...base, email: p.direct_email, person_name: p.name || null, person_role: p.role || null, source_url: p.evidence_url }, 'research');
    }
    // 'Website' emails come from company_email; they are added below for every lead.
    for (const e of g.emails) {
      if (e.label === 'Website') continue;
      add({ ...base, email: e.email, person_name: null, person_role: null, source_url: e.evidence_url }, 'research');
    }
  }

  const site = await db.sql<{ company_id: string; email: string; source_url: string | null; name: string; category: string | null; lead_status: string | null; assigned_to: string | null }>(`
    select ce.company_id::text, ce.email, ce.source_url, c.name, c.category, c.lead_status, c.assigned_to
      from company_email ce join company_data c on c.id = ce.company_id
     where c.merged_into is null and coalesce(c.is_hidden, false) = false`);
  for (const r of site.rows) {
    add({ email: r.email, company_id: r.company_id, company_name: r.name, category: r.category, person_name: null, person_role: null, source_url: r.source_url, lead_status: r.lead_status, assigned_to: r.assigned_to }, 'website');
  }

  return [...byKey.values()].sort((a, b) => a.company_name.localeCompare(b.company_name, undefined, { sensitivity: 'base' }) || a.email.localeCompare(b.email));
}

export async function allRows(fresh = false): Promise<EmailRow[]> {
  if (!fresh && cached && Date.now() - cached.at < CACHE_MS) return cached.rows;
  cached = { at: Date.now(), rows: await build() };
  return cached.rows;
}

export function stats(rows: EmailRow[]): EmailStats {
  return {
    rows: rows.length,
    distinctEmails: new Set(rows.map((r) => r.email)).size,
    companies: new Set(rows.map((r) => r.company_id)).size,
    withPerson: rows.filter((r) => r.person_name).length,
    research: rows.filter((r) => r.sources.includes('research')).length,
    website: rows.filter((r) => r.sources.includes('website')).length,
    both: rows.filter((r) => r.sources.length > 1).length,
  };
}

/** source: all | research | website | person (has a person name). */
export function filter(rows: EmailRow[], options: { search?: string | null; source?: string | null }): EmailRow[] {
  const q = (options.search ?? '').trim().toLowerCase();
  const source = options.source || 'all';
  return rows.filter((r) => {
    if (source === 'research' && !r.sources.includes('research')) return false;
    if (source === 'website' && !r.sources.includes('website')) return false;
    if (source === 'person' && !r.person_name) return false;
    if (!q) return true;
    return r.email.includes(q) || r.company_name.toLowerCase().includes(q) || (r.person_name ?? '').toLowerCase().includes(q);
  });
}

export function toCsv(rows: EmailRow[]): string {
  const cell = (v: unknown) => '"' + String(v ?? '').replace(/"/g, '""') + '"';
  const head = ['email', 'company_id', 'company_name', 'category', 'person_name', 'person_role', 'sources', 'source_url', 'lead_status', 'assigned_to'];
  const lines = rows.map((r) => [r.email, r.company_id, r.company_name, r.category, r.person_name, r.person_role, r.sources.join('+'), r.source_url, r.lead_status, r.assigned_to].map(cell).join(','));
  return '﻿' + head.join(',') + '\r\n' + lines.join('\r\n');
}
