import * as reportdb from '../reportdb.ts';
import * as companies from '../company-uid.ts';
import { switchOn } from '../switches.ts';
import { runWithReport, step } from '../evidence/context.ts';
import { settle, watchRun } from '../evidence/store.ts';
import { run, type Alongside, type DiveResult, type DiveStats } from './pipeline.ts';
import { ensureTable, updateRow, type DiveRow } from './store.ts';

// ---------------------------------------------------------------- runner

export const waiting: number[] = [];
let active = 0;
// Three dives at once: a batch of leads gets its previews a third as late. The LLM router rests a lane that answers 429.
const CONCURRENCY = 3;

const finishedHooks: Array<(id: number) => void> = [];
/** Called the moment a dive's research is saved, before its dossier is written; the preview writer starts here. */
export function onFinished(fn: (id: number) => void): void {
  finishedHooks.push(fn);
}

/** A dive that is not complete runs again this long after its last try: soon at first, then every 30 min. */
const RETRY_AFTER_MS = [60_000, 180_000, 1_800_000, 1_800_000, 1_800_000];
/** Tries in all, the first included; after the last one an incomplete dive is failed. */
export const MAX_TRIES = RETRY_AFTER_MS.length + 1;
/** How long after try `tries` (1-based) the next one runs, or null when it was the last. */
export const nextTry = (tries: number): number | null => RETRY_AFTER_MS[tries - 1] ?? null;
/** The longest one try may take; past it the try counts as incomplete. The slowest dive seen took under 10 minutes. */
const DIVE_LIMIT_MS = 40 * 60_000;

/**
 * A dive started with a bare name has no website, so no company UID (the UID is keyed by
 * domain). Its research found the official domain: the UID comes from that, and the
 * dive-deeper runs on this dive take it too. Never throws.
 */
async function giveUid(id: number, row: DiveRow, result: DiveResult): Promise<void> {
  if ((row as { company_uid?: string | null }).company_uid) return;
  const domain = (result.identity.official_domains ?? []).map((d) => String(d).trim()).find(Boolean);
  if (!domain) return;
  try {
    const uid = await companies.resolve({ website: /^https?:\/\//i.test(domain) ? domain : 'https://' + domain, create: true });
    if (!uid) return;
    await reportdb.sql(`update company_dive set company_uid = $2 where id = $1 and company_uid is null`, [id, uid]);
    await reportdb.sql(`update dive_deeper set company_uid = $2 where dive_id = $1 and company_uid is null`, [id, uid]).catch(() => {});
    console.log(`[company-dive ${id}] company UID ${uid} from ${domain}`);
  } catch (err) {
    console.warn(`[company-dive ${id}] no company UID from ${domain}: ${(err as Error).message}`);
  }
}

/** Not complete: try again later, or fail when the tries are used up. */
async function notComplete(id: number, tries: number, reason: string, log: DiveRow['log'], stats?: DiveStats): Promise<void> {
  const wait = nextTry(tries);
  const at = new Date().toISOString();
  const counts = stats ? {
    tavily_calls: stats.tavily.length, tavily_credits: stats.tavily.reduce((n, c) => n + c.credits, 0), brave_calls: stats.braveCalls, llm_calls: stats.llmCalls,
  } : {};
  if (wait === null) {
    const message = `incomplete after ${tries} tries: ${reason}`;
    log.push({ at, stage: 'failed', msg: message });
    console.error(`[company-dive ${id}] ${message}`);
    await updateRow(id, { status: 'failed', stage: 'failed', error: message, log, retry_at: null, finished_at: at, ...counts });
    return;
  }
  const retryAt = new Date(Date.now() + wait).toISOString();
  const message = `Not complete (try ${tries} of ${MAX_TRIES}): ${reason}. Next try in ${Math.round(wait / 60_000)} min.`;
  log.push({ at, stage: 'incomplete', msg: message });
  console.warn(`[company-dive ${id}] ${message}`);
  await updateRow(id, { status: 'incomplete', stage: 'incomplete', error: message, log, retry_at: retryAt, ...counts });
}

async function execute(id: number): Promise<void> {
  const row = (await reportdb.sql<DiveRow>(`select * from company_dive where id = $1`, [id])).rows[0];
  if (!row) return;
  const evidenceOn = switchOn(row.options, 'evidence') && Boolean(row.public_id);
  if (!evidenceOn || !row.public_id) return executeBody(id, row, false);
  const uid = row.public_id;
  watchRun(uid);
  try {
    await runWithReport({
      reportUid: uid, parentReportUid: null, kind: 'company_dive', step: 'research', weight: 1, on: true,
    }, () => executeBody(id, row, true));
  } finally {
    await settle(uid, 10_000);
  }
}

async function executeBody(id: number, row: DiveRow, evidenceOn: boolean): Promise<void> {
  const tries = (row.tries ?? 0) + 1;
  // Each try keeps the earlier tries' lines, so the log tells the whole story.
  const log: DiveRow['log'] = [...(row.log ?? [])];
  await updateRow(id, { status: 'running', stage: 'discover', tries, retry_at: null, error: null });
  // Once the research is saved the stage stays 'done'; the dossier only adds log lines.
  let saved = false;
  const progress = async (stage: string, msg: string) => {
    log.push({ at: new Date().toISOString(), stage, msg });
    console.log(`[company-dive ${id}] ${stage}: ${msg}`);
    await updateRow(id, saved ? { log } : { stage, log }).catch((err) => console.error(`[company-dive ${id}] log write failed`, err));
  };
  if (tries > 1) await progress('discover', `Try ${tries} of ${MAX_TRIES}`);
  let timer: NodeJS.Timeout | undefined;
  try {
    // Loaded here, not at the top: companydive-people imports this module.
    const people = row.options?.people !== false ? await import('../companydive-people.ts') : null;
    const alongside: Alongside | undefined = people && (async (identity, facts) => {
      const found = evidenceOn
        ? await step('people', () => people.findPeople({ ...row, result: { identity, facts } as DiveResult }, async () => {}))
        : await people.findPeople({ ...row, result: { identity, facts } as DiveResult }, async () => {});
      await progress('people', `People step ${found.status}: ${found.people.length} people linked`);
      return found;
    });
    const late = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`the try did not finish within ${DIVE_LIMIT_MS / 60_000} min (last stage: ${log[log.length - 1]?.stage ?? 'none'})`)), DIVE_LIMIT_MS);
    });
    late.catch(() => {}); // raced twice below; never an unhandled rejection in between
    const { result, writeDossier } = await Promise.race([run(row.company, row.country, progress, alongside), late]);
    // Something failed after its backups: no result is saved, and the dive runs again.
    if (result.warnings.length) {
      if (evidenceOn && row.public_id) await settle(row.public_id, 10_000);
      await notComplete(id, tries, result.warnings.join('; ').slice(0, 1500), log, { tavily: result.tavily, llmCalls: result.llm.length, braveCalls: result.braveCalls });
      return;
    }
    if (evidenceOn && row.public_id) await settle(row.public_id, 10_000);
    await updateRow(id, {
      status: 'done', stage: 'done', log, result, error: null,
      tavily_calls: result.tavily.length,
      tavily_credits: result.tavily.reduce((n, c) => n + c.credits, 0),
      brave_calls: result.braveCalls,
      llm_calls: result.llm.length,
      finished_at: new Date().toISOString(),
    });
    saved = true;
    await giveUid(id, row, result);
    for (const fn of finishedHooks) { try { fn(id); } catch (err) { console.error(`[company-dive ${id}] finish hook failed`, err); } }
    // The write-up's LLM call joins result.llm, so the result is saved again with it.
    const dossier = await Promise.race([writeDossier(), late]);
    // A dossier that fell back to the bare facts after its tries is not the report: run the dive again.
    if (result.warnings.length) {
      saved = false;
      if (evidenceOn && row.public_id) await settle(row.public_id, 10_000);
      await notComplete(id, tries, result.warnings.join('; ').slice(0, 1500), log);
      return;
    }
    await updateRow(id, { dossier, log, result, llm_calls: result.llm.length });
  } catch (err) {
    // The research is saved and the preview has it; a dossier that could not be stored fails nothing.
    if (saved) { console.error(`[company-dive ${id}] dossier save failed`, err); return; }
    const message = (err as Error).message;
    const stats = (err as { stats?: DiveStats }).stats;
    console.error(`[company-dive ${id}] try ${tries} failed`, err);
    if ((err as { retryable?: boolean }).retryable === false) {
      log.push({ at: new Date().toISOString(), stage: 'failed', msg: message });
      if (evidenceOn && row.public_id) await settle(row.public_id, 10_000);
      await updateRow(id, {
        status: 'failed', error: message, log, finished_at: new Date().toISOString(),
        ...(stats ? { tavily_calls: stats.tavily.length, tavily_credits: stats.tavily.reduce((n, c) => n + c.credits, 0), brave_calls: stats.braveCalls, llm_calls: stats.llmCalls } : {}),
      });
      return;
    }
    if (evidenceOn && row.public_id) await settle(row.public_id, 10_000);
    await notComplete(id, tries, message, log, stats);
  } finally {
    clearTimeout(timer);
    if (evidenceOn && row.public_id) await settle(row.public_id, 10_000);
  }
}

/** When each running dive started; the contact worker reads it through diveRunning(). */
const runningSince = new Map<number, number>();

export function pump(): void {
  while (active < CONCURRENCY && waiting.length) {
    const id = waiting.shift()!;
    active++;
    runningSince.set(id, Date.now());
    execute(id).finally(() => { active--; runningSince.delete(id); pump(); });
  }
}

/** A dive shares the deepseek lanes with contact research. One holding them longer than this no longer pauses it. */
export const LANE_HOLD_MS = 30 * 60_000;

/**
 * True while a dive started in the last LANE_HOLD_MS is running: the contact
 * worker takes no new job then, so the dive has the LLM lanes to itself. A dive
 * that runs longer stops holding them; nothing is cut either way.
 */
export function diveRunning(now = Date.now()): boolean {
  for (const started of runningSince.values()) if (now - started < LANE_HOLD_MS) return true;
  return false;
}

/** Tests: mark a dive as running since `at`, or clear them all with null. */
export function setRunningForTests(at: number | null): void {
  runningSince.clear();
  if (at !== null) runningSince.set(-1, at);
}

const RETRY_SWEEP_MS = 60_000;

function queue(id: number): void {
  if (!waiting.includes(id)) waiting.push(id);
  pump();
}

/**
 * Dives live only in this process, so one still queued or running at boot was cut off by a
 * restart: it is queued again (a try cut off this way does not count). Then incomplete dives
 * run again when their retry_at comes.
 */
export async function resumeInterrupted(): Promise<void> {
  if (!reportdb.configured()) return;
  await ensureTable();
  // Cut off in the people step: the research is saved, so the report stands.
  await reportdb.sql(`update company_dive set status = 'done', stage = 'done', finished_at = now()
                       where status = 'running' and stage = 'people' and dossier is not null`);
  const out = await reportdb.sql<{ id: string }>(`update company_dive set status = 'queued', stage = '', tries = case when status = 'running' then greatest(tries - 1, 0) else tries end
                                                   where status in ('queued', 'running') returning id`);
  const ids = out.rows.map((r) => Number(r.id)).sort((a, b) => a - b);
  if (ids.length) console.log(`[company-dive] resuming ${ids.length} dive(s) cut off by the restart: ${ids.join(', ')}`);
  for (const id of ids) queue(id);
  setInterval(() => { void retryDue(); }, RETRY_SWEEP_MS).unref();
}

async function retryDue(): Promise<void> {
  try {
    const due = await reportdb.sql<{ id: string }>(`update company_dive set status = 'queued', stage = '', retry_at = null
                                                     where status = 'incomplete' and retry_at is not null and retry_at <= now() returning id`);
    for (const r of due.rows) queue(Number(r.id));
  } catch (err) {
    console.warn(`[company-dive] retry sweep failed: ${(err as Error).message}`);
  }
}
