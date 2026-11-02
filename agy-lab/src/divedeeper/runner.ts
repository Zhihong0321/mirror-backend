// Run one dive-deeper lane on one finished company-dive and save its output.
// Shared by the local script (scripts/dive-deeper/run.ts) and the hub (divedeeper.ts).
//
// A lane is sections/<section>-<lane>.ts exporting
//   run(ctx, dive): Promise<{ findings: Finding[]; notes?: Record<string, unknown> }>
// Its output lands in OUT/<section>-<lane>-<diveId>.json, where later lanes read it
// (E-maps reads H-maps' listings, S2 reads every stage-1 lane).
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { OUT, SECTIONS, makeCtx, type Finding } from './lib.ts';

export type LaneResult = {
  section: string; lane: string; diveId: string; company: string;
  status: 'done' | 'partial'; ran_at: string; ms: number; findings_count: number;
  meter: unknown; warnings: string[]; notes: Record<string, unknown>; findings: Finding[];
};

/** Writes the dive where the lanes look for it (OUT/dive-<id>.json). */
export function stageDive(diveId: string, dive: unknown): void {
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, `dive-${diveId}.json`), JSON.stringify(dive));
}

/** Never throws: a crashed lane comes back partial with the crash in its warnings. */
export async function runLane(section: string, lane: string, diveId: string, dive: any): Promise<LaneResult> {
  const ctx = makeCtx(diveId, section, lane);
  let findings: Finding[] = [];
  let notes: Record<string, unknown> = {};
  const file = path.join(SECTIONS, `${section}-${lane}.ts`);
  try {
    if (!fs.existsSync(file)) throw new Error(`no lane file ${section}-${lane}.ts`);
    const mod = await import(pathToFileURL(file).href);
    const out = await mod.run(ctx, dive);
    findings = out?.findings ?? [];
    notes = out?.notes ?? {};
  } catch (e) {
    ctx.warn(`lane crashed: ${(e as Error).stack ?? e}`);
  }
  const ms = Date.now() - ctx.meter.started;
  const result: LaneResult = {
    section, lane, diveId, company: dive.company,
    status: ctx.warnings.length ? 'partial' : 'done',
    ran_at: new Date().toISOString(), ms,
    findings_count: findings.length,
    meter: ctx.meter, warnings: ctx.warnings, notes, findings,
  };
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, `${section}-${lane}-${diveId}.json`), JSON.stringify(result, null, 2));
  return result;
}
