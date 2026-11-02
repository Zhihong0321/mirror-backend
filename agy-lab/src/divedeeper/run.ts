import * as reportdb from '../reportdb.ts';
import { restoreLane, runLane, stageDive, type LaneResult } from './runner.ts';
import { buildReport } from './report-html.ts';
import { enabled, STAGE1_FIRST, STAGE1_AFTER_H, STAGE1_LAST, STAGE2, STAGE3, STAGE4, STAGE5 } from './stages.ts';
import { ensureTable, update, diveRow, type Row } from './store.ts';

/** Starts a company-dive through the hub's own public API, exactly as any caller would. */
export async function startDive(company: string): Promise<{ id: number } | { error: string }> {
  const port = Number(process.env.PORT ?? 8080);
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/company-dive`, {
      method: 'POST',
      headers: { authorization: 'Bearer ' + (process.env.LAB_TOKEN ?? ''), 'content-type': 'application/json' },
      body: JSON.stringify({ company, country: 'Malaysia' }),
    });
    const body = await res.json() as any;
    return res.ok && body.id ? { id: Number(body.id) } : { error: body.error ?? `company-dive answered HTTP ${res.status}` };
  } catch (e) {
    return { error: `could not start the company-dive: ${(e as Error).message}` };
  }
}

// ---------------------------------------------------------------- the run

export const waiting: number[] = [];
export let active = false;
const DIVE_POLL_MS = 20_000;
/** A failed lane is tried this many times in a row, waiting between tries (an outage often passes in minutes). */
const LANE_TRIES = 3;
const LANE_WAITS_MS = [60_000, 180_000];
/** An incomplete run is picked up again this long after, at most MAX_RESUMES times; after that it waits for Retry. */
const RESUME_AFTER_MS = 30 * 60_000;
const MAX_RESUMES = 6;
const RESUME_SWEEP_MS = 5 * 60_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const clock = (iso: string) => new Date(iso).toLocaleTimeString('en-GB', { timeZone: 'Asia/Kuala_Lumpur', hour: '2-digit', minute: '2-digit' });

/**
 * One run, start to end, or from where it stopped: lanes already saved (from before a restart,
 * or an earlier try of an incomplete run) are kept, and only failed or missing lanes run. A
 * failed lane is tried LANE_TRIES times; if it still fails, nothing after it runs, no report is
 * published, and the run is incomplete until a later try completes it.
 */
async function execute(id: number): Promise<void> {
  const row = (await reportdb.sql<Row>(`select * from dive_deeper where id = $1`, [id])).rows[0];
  if (!row) return;
  const log = row.log ?? [];
  const say = async (stage: string, msg: string, extra: Partial<Row> = {}) => {
    log.push({ at: new Date().toISOString(), stage, msg });
    console.log(`[dive-deeper ${id}] ${stage}: ${msg}`);
    await update(id, { stage, log, ...extra }).catch((err) => console.error(`[dive-deeper ${id}] log write failed`, err));
  };
  try {
    if (!row.dive_id) throw new Error('no company-dive linked to this run');
    const lanes: Record<string, LaneResult> = row.lanes ?? {};

    // 1. Wait for the company-dive (it runs in its own queue). An incomplete one is still being
    //    tried, and one cut off by a restart is queued again, so both are waited for.
    const diveId = row.dive_id;
    let dive = await diveRow(diveId);
    if (dive && !['done', 'partial', 'failed'].includes(dive.status)) {
      await say('waiting_dive', `Waiting for company-dive #${diveId} to finish`, { status: 'waiting_dive' });
      while (dive && !['done', 'partial', 'failed'].includes(dive.status)) {
        await sleep(DIVE_POLL_MS);
        dive = await diveRow(diveId);
      }
    }
    if (!dive) throw new Error(`company-dive #${diveId} not found`);
    if (dive.status === 'failed' || !dive.result) throw new Error(`company-dive #${diveId} ${dive.status}: ${dive.error ?? 'no research saved'}`);

    // 2. The lanes, stage by stage. Each lane's result is saved as soon as it lands.
    const diveKey = String(diveId);
    stageDive(diveKey, dive);
    const kept = Object.values(lanes).filter((l) => l.status !== 'failed');
    for (const l of kept) restoreLane(l);
    await say('stage1', kept.length ? `Resuming: ${kept.length} lanes kept, the rest run now` : `Company-dive #${diveId} is ${dive.status}; running stage 1`, { status: 'running', lanes, retry_at: null });

    /** One lane, tried until it does not fail; true when it ran (done or partial). */
    const one = async (stage: string, section: string, lane: string): Promise<boolean> => {
      const key = `${section}-${lane}`;
      if (lanes[key] && lanes[key].status !== 'failed') return true;
      for (let t = 1; t <= LANE_TRIES; t++) {
        const r = await runLane(section, lane, diveKey, dive);
        lanes[key] = r;
        if (r.status !== 'failed') {
          await say(stage, `${key}: ${r.findings_count} findings${r.warnings.length ? `, ${r.warnings.length} warnings` : ''}${t > 1 ? ` (try ${t})` : ''}`, { lanes });
          return true;
        }
        const wait = LANE_WAITS_MS[t - 1];
        await say(stage, `${key} failed (try ${t} of ${LANE_TRIES}): ${r.failure}${t < LANE_TRIES ? `; next try in ${Math.round(wait / 60_000)} min` : ''}`, { lanes });
        if (t < LANE_TRIES) await sleep(wait);
      }
      return false;
    };

    const hMaps = one('stage1', 'H', 'maps');
    const first = await Promise.all([
      hMaps,
      ...STAGE1_FIRST.filter(([s, l]) => !(s === 'H' && l === 'maps')).map(([s, l]) => one('stage1', s, l)),
      // These read H-maps' listings: without them they would run on half the data.
      hMaps.then((ok) => ok && Promise.all(STAGE1_AFTER_H.map(([s, l]) => one('stage1', s, l))).then((all) => all.every(Boolean))),
    ]);
    const complete = first.every(Boolean)
      && (await Promise.all(STAGE1_LAST.map(([s, l]) => one('stage1', s, l)))).every(Boolean)
      && (await say('stage2', 'Writing the consultation'), await one('stage2', STAGE2[0], STAGE2[1]))
      && (await say('stage3', 'Editing the report and taking screenshots'), await one('stage3', STAGE3[0], STAGE3[1]))
      && (await say('stage4', 'Writing the full analysis'), await one('stage4', STAGE4[0], STAGE4[1]))
      && (await say('stage5', 'Compiling the action plan'), await one('stage5', STAGE5[0], STAGE5[1]));

    if (!complete) {
      const failed = Object.values(lanes).filter((l) => l.status === 'failed');
      const resumes = row.resumes ?? 0;
      const retryAt = resumes < MAX_RESUMES ? new Date(Date.now() + RESUME_AFTER_MS).toISOString() : null;
      const msg = `Not complete: ${failed.map((l) => `${l.section}-${l.lane} ${l.failure}`).join('; ')}. `
        + (retryAt ? `Next automatic try at ${clock(retryAt)} (${resumes + 1} of ${MAX_RESUMES}).` : `All ${MAX_RESUMES} automatic tries used; press Retry.`);
      await say('incomplete', msg, { status: 'incomplete', error: msg, lanes, retry_at: retryAt });
      return;
    }

    // 3. The report: every lane ran.
    const html = buildReport(dive, lanes);
    await say('done', 'Report ready: every lane ran', {
      status: 'done', error: null, lanes, report_html: html, retry_at: null, finished_at: new Date().toISOString(),
    });
  } catch (err) {
    console.error(`[dive-deeper ${id}] failed`, err);
    log.push({ at: new Date().toISOString(), stage: 'failed', msg: (err as Error).message });
    await update(id, { status: 'failed', stage: 'failed', error: (err as Error).message, log, finished_at: new Date().toISOString() });
  }
}

export function queue(id: number): void {
  if (!waiting.includes(id)) waiting.push(id);
  pump();
}

function pump(): void {
  if (active || !waiting.length) return;
  active = true;
  const id = waiting.shift()!;
  execute(id).finally(() => { active = false; pump(); });
}

/** Runs live in this process, so a restart cuts them off; at boot each one is queued again and resumes
 *  from its saved lanes. Then incomplete runs are picked up again when their retry_at comes. */
export async function resumeInterrupted(): Promise<void> {
  if (!enabled() || !reportdb.configured()) return;
  await ensureTable();
  const out = await reportdb.sql<{ id: string }>(`update dive_deeper set status = 'queued', stage = '' where status in ('queued', 'waiting_dive', 'running') returning id`);
  const ids = out.rows.map((r) => Number(r.id)).sort((a, b) => a - b);
  if (ids.length) console.log(`[dive-deeper] resuming ${ids.length} run(s) cut off by the restart: ${ids.join(', ')}`);
  for (const id of ids) queue(id);
  setInterval(() => { void resumeDue(); }, RESUME_SWEEP_MS).unref();
}

async function resumeDue(): Promise<void> {
  try {
    const due = await reportdb.sql<{ id: string }>(`update dive_deeper set status = 'queued', stage = '', resumes = resumes + 1, retry_at = null
                                                     where status = 'incomplete' and retry_at is not null and retry_at <= now() returning id`);
    for (const r of due.rows) queue(Number(r.id));
  } catch (err) {
    console.warn(`[dive-deeper] resume sweep failed: ${(err as Error).message}`);
  }
}
