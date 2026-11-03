// Run one dive-deeper lane on one finished company-dive and save its output.
// Shared by the local script (scripts/dive-deeper/run.ts) and the hub (divedeeper.ts).
//
// A lane is sections/<section>-<lane>.ts exporting
//   run(ctx, dive): Promise<{ findings: Finding[]; notes?: Record<string, unknown> }>
// Its output lands in OUT/<section>-<lane>-<diveId>.json, where later lanes read it
// (C-merged reads H-maps' listings, S2 reads every stage-1 lane).
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { SECTIONS, makeCtx, writeLane, type Finding, type Meter } from './lib.ts';

/**
 * done: ran with nothing to note. partial: ran to the end, with notes (a page that did not
 * load, a thin search). failed: did not get what it needs: it crashed, ran out of time, or an
 * outside service failed after every backup (LLM lanes, search engines, Gmap workers).
 * A failed lane is run again; a report is published only when no lane failed (divedeeper.ts).
 */
export type LaneResult = {
  section: string; lane: string; diveId: string; company: string;
  status: 'done' | 'partial' | 'failed'; ran_at: string; ms: number; findings_count: number;
  meter: unknown; warnings: string[]; notes: Record<string, unknown>; findings: Finding[];
  /** Why the lane failed, when it did. */
  failure?: string;
};

/** The longest one lane may run (DD_LANE_LIMIT_MIN). The slowest seen took under 5 minutes. */
export const laneLimitMs = (env: NodeJS.ProcessEnv = process.env): number => (Number(env.DD_LANE_LIMIT_MIN) > 0 ? Number(env.DD_LANE_LIMIT_MIN) : 15) * 60_000;

/** Why a lane that ran to the end still failed: an outside service that failed after every backup. */
export function serviceFailures(meter: Meter): string | null {
  const parts = [
    meter.llm.failed && `${meter.llm.failed} LLM call(s) failed on every lane`,
    meter.exa.failed + meter.brave.failed && `${meter.exa.failed + meter.brave.failed} search(es) failed on every engine`,
    meter.maps.failed && `${meter.maps.failed} Google Maps search(es) failed on the Gmap workers`,
  ].filter(Boolean);
  return parts.length ? parts.join('; ') : null;
}

/** Puts a saved lane back where later lanes read it, so a resumed run sees what it had. */
export function restoreLane(result: LaneResult): void {
  writeLane(result.diveId, `${result.section}-${result.lane}`, result, 2);
}

/** Writes the dive where the lanes look for it (OUT/dive-<id>.json). */
export function stageDive(diveId: string, dive: unknown): void {
  writeLane(diveId, 'dive', dive);
}

/** Never throws: a crashed lane, or one past its time limit, comes back failed with the reason. */
export async function runLane(section: string, lane: string, diveId: string, dive: any, limitMs = laneLimitMs()): Promise<LaneResult> {
  const ctx = makeCtx(diveId, section, lane);
  let findings: Finding[] = [];
  let notes: Record<string, unknown> = {};
  let failure: string | null = null;
  const file = path.join(SECTIONS, `${section}-${lane}.ts`);
  let timer: NodeJS.Timeout | undefined;
  try {
    if (!fs.existsSync(file)) throw new Error(`no lane file ${section}-${lane}.ts`);
    const mod = await import(pathToFileURL(file).href);
    // A call that never answers cannot hold the run: past the limit the lane is given up, and
    // the calls it was still waiting on are named, so the stuck service shows in the log.
    const late = new Promise<'late'>((resolve) => { timer = setTimeout(() => resolve('late'), limitMs); });
    const out = await Promise.race([mod.run(ctx, dive), late]);
    if (out === 'late') {
      const on = ctx.waitingOn();
      failure = `did not finish within ${Math.round(limitMs / 60_000)} min${on.length ? `; still waiting on ${on.join(', ')}` : ''}`;
      ctx.warn(failure);
    } else {
      findings = out?.findings ?? [];
      notes = out?.notes ?? {};
    }
  } catch (e) {
    failure = `crashed: ${(e as Error).message}`;
    ctx.warn(`lane crashed: ${(e as Error).stack ?? e}`);
  } finally {
    clearTimeout(timer);
  }
  failure ??= serviceFailures(ctx.meter);
  const ms = Date.now() - ctx.meter.started;
  const result: LaneResult = {
    section, lane, diveId, company: dive.company,
    status: failure ? 'failed' : ctx.warnings.length ? 'partial' : 'done',
    ...(failure ? { failure } : {}),
    ran_at: new Date().toISOString(), ms,
    findings_count: findings.length,
    meter: ctx.meter, warnings: ctx.warnings, notes, findings,
  };
  writeLane(diveId, `${section}-${lane}`, result, 2);
  return result;
}
