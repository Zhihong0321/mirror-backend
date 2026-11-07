import type { Finding } from '../lib.ts';
import type { LaneResult } from '../runner.ts';
import type { Psi } from '../sections/W-speed.ts';

/** Step 1.5 already paid for these tests. Copy its answers without another request. */
export function speedLane(diveId: string, dive: any): LaneResult {
  const assets = dive.v21?.assets;
  const saved = assets?.pagespeed;
  const warnings: string[] = [];
  const pages: Psi[] = [];
  for (const strategy of ['mobile', 'desktop'] as const) {
    const page = saved?.[strategy];
    if (page?.ok && page.scores && typeof page.scores.performance === 'number' && page.url && page.site) {
      pages.push({ ...page, strategy });
    } else if (page || saved?.status === 'done') {
      warnings.push(`Step 1.5 PageSpeed ${strategy}: ${page?.error ?? 'no usable saved result'}`);
    }
  }
  if (!pages.length) warnings.push(`Step 1.5 has no saved PageSpeed results (${saved?.error ?? saved?.status ?? 'not run'}); website speed is omitted`);
  const homes = [...new Map(pages.map((p) => [p.site, { site: p.site, url: p.url }])).values()];
  const ran_at = assets?.created_at ?? new Date().toISOString();
  const findings: Finding[] = (assets?.findings ?? []).filter((f: any) => /^psi-/.test(f.check ?? '') && pages.length)
    .map((f: any) => ({ ...f, severity: f.severity === 'critical' ? 'high' : f.severity ?? 'info', source: f.source ?? null, checked_at: ran_at }));
  return { section: 'W', lane: 'speed', diveId, company: dive.company, status: warnings.length ? 'partial' : 'done',
    ran_at, ms: 0, findings_count: findings.length, meter: {}, warnings, findings, notes: { pages, homes } };
}
