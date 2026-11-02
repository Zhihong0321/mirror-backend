import { parallel } from './core/index.ts';

/** Parallel FindAll Entity Search adapter. Only the returned profile and description
 * are treated as evidence; this endpoint does not return phone or email fields. */
export function parallelObjective(company: Record<string, unknown>, targetRole?: string | null): string {
  const name = String(company.name ?? '').trim();
  const website = String(company.website ?? '').trim();
  return `People currently working at ${name}${website ? ` (${website})` : ''} who are owners, founders, CEOs, managing directors, general managers, procurement, sales, marketing or operations leaders${targetRole ? `, especially ${targetRole}` : ''}.`;
}

export function parallelPeople(company: Record<string, unknown>, response: unknown): Record<string, unknown>[] {
  const payload = response && typeof response === 'object' ? response as Record<string, unknown> : {};
  const entities = Array.isArray(payload.entities) ? payload.entities : [];
  const companyName = String(company.name ?? '').trim().toLowerCase();
  const seen = new Set<string>();
  return entities.flatMap((raw): Record<string, unknown>[] => {
    if (!raw || typeof raw !== 'object') return [];
    const entity = raw as Record<string, unknown>;
    const name = typeof entity.name === 'string' ? entity.name.trim() : '';
    const description = typeof entity.description === 'string' ? entity.description.trim() : '';
    const url = typeof entity.url === 'string' && /^https?:\/\//i.test(entity.url) ? entity.url : null;
    if (!name || !description || !companyName || !description.toLowerCase().includes(companyName) || name.toLowerCase() === companyName) return [];
    const key = name.toLowerCase();
    if (seen.has(key)) return [];
    seen.add(key);
    // Keep Parallel's words visible for review. A title is only extracted when
    // explicitly adjacent to the company name in the description.
    const escaped = companyName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const title = description.match(new RegExp(`(?:^|[,.])\\s*([^,.]{3,80}?)\\s+(?:at|of)\\s+${escaped}(?:\\b|$)`, 'i'))?.[1]?.trim()
      || description.match(new RegExp(`${escaped}\\s*[-–—,:]\\s*([^,.]{3,80})`, 'i'))?.[1]?.trim()
      || '';
    if (!/\b(owner|founder|chief|ceo|coo|cfo|director|manager|president|head|partner|procurement|purchasing|sales|marketing|operations)\b/i.test(title)) return [];
    return [{ name, role: title, profile_url: url, role_evidence_url: url, description }];
  }).slice(0, 10);
}

export async function searchParallelPeople(company: Record<string, unknown>, targetRole?: string | null): Promise<{ response: Record<string, unknown>; people: Record<string, unknown>[] }> {
  // The request goes through the app's core (core/parallel.ts).
  const response = await parallel.entitySearch({ entity_type: 'people', objective: parallelObjective(company, targetRole), match_limit: 20 });
  return { response, people: parallelPeople(company, response) };
}
