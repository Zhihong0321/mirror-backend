// V2.1 Step 2 on the hub: judge one report's Step 1 research. Reads the checkpoint from the database by report UID and
// writes every result back the moment it exists (src/v21-store.ts), so a crash keeps what was already paid for.
//
//   POST /api/v21/step2             { report_id, recheck? (default true), rules? ('v1' default | 'v2') } -> 202 { report_id, run_id }
//   GET  /api/v21/step2/{report_id} ?run_id=  -> { report_id, step2_status, step2_error, run_id, result? }
//
// One run = tidy (no judging) -> judge (DeepSeek lanes, then the code check) -> recheck (second call, same code check).
// Rows written per run, all with the run_id: 'tidy' (the exact input the judge got), 'judge' and 'recheck' (each with
// its raw model answer and every lane attempt), 'result' (the final Step 2 output). No file is written.
// The LLM wait policy applies: a slow call is never killed and restarted (judge.ts askLanes).
import type http from 'node:http';
import crypto from 'node:crypto';
import { tidyCheckpoint } from './v21/tidy.ts';
import { judgeTidy } from './v21/judge.ts';
import { recheckTidy } from './v21/recheck.ts';
import { judgeV2, recheckV2 } from './v21/step2-v2.ts';
import type { Step2AnalysisOutput } from './v21/analyse.ts';
import { runStep1_5 } from './v21-step1-5-http.ts';
import { startStep3 } from './v21-step3-http.ts';
import * as store from './v21-store.ts';

type Ctx = {
  json: (res: http.ServerResponse, status: number, body: unknown) => void;
  readJson: (req: http.IncomingMessage) => Promise<Record<string, unknown>>;
};

const PATH = '/api/v21/step2';
/** A report whose Step 2 says "running" for longer than this is taken as abandoned (a restart killed it). */
const STALE_MS = 60 * 60_000;

function failedOutput(report: any, error: string): Step2AnalysisOutput {
  return {
    version: '2.1', stage: 2, created_at: new Date().toISOString(),
    input: { company: report.company, country: report.country, industry: report.industry, ...(report.website ? { website: report.website } : {}) },
    status: 'failed', error,
    baseline: { official_domain: '', pages_present: [], brand_names: [], legal_names: [], phones: [], addresses: [] },
    findings: [], dropped_namesakes: [], could_not_check: [],
    stats: { findings_count: 0, dropped_namesakes_count: 0, could_not_check_count: 0, llm_calls: 0, duration_ms: 0 },
  } as Step2AnalysisOutput;
}

/**
 * The hub chain (owner, 2026-11-11): when Step 1.5 ends, Step 2 runs, and when Step 2 ends, Step 3 runs, whatever
 * each outcome. No check stops it; a failure is stored on the report and the next step still starts. Never throws.
 */
export async function chainStep2And3(reportId: string, base: string): Promise<void> {
  try {
    const report: any = await store.getReport(reportId);
    const cp = await store.latestRaw(reportId, 'checkpoint');
    const runId = crypto.randomUUID();
    await store.setStatus(reportId, 2, 'running');
    await runStep2(report ?? { report_id: reportId }, cp?.payload ?? null, runId, true, 'v2');
  } catch (err: any) {
    console.error(`[v21 chain] ${reportId}: Step 2: ${err?.message ?? err}`);
  }
  await startStep3(reportId, base);
}

/** The whole run. Never throws: a failure is stored as a 'result' row with status failed. */
async function runStep2(report: any, checkpoint: any, runId: string, recheck: boolean, rules: 'v1' | 'v2' = 'v2'): Promise<void> {
  const id: string = report.report_id;
  try {
    // An old row whose Step 1 found no official site (checkpoint.skipped) is judged on what it has; tidy labels it.

    // Step 1.5 digital assets / PageSpeed technical findings: load existing or run on demand
    let assets = (await store.latestRaw(id, 'assets'))?.payload ?? null;
    if (!assets) {
      try {
        console.log(`[v21 step2] ${id}: Step 1.5 assets not found, running on-demand...`);
        assets = await runStep1_5(report, checkpoint, runId);
      } catch (e: any) {
        console.warn(`[v21 step2] ${id}: on-demand Step 1.5 failed: ${e?.message ?? e}`);
      }
    }

    const tidy = tidyCheckpoint(checkpoint, assets);
    await store.addRaw(id, 2, 'tidy', runId, tidy);

    // Rules v2 (step2-v2.ts): four lists for Step 3. Behind the switch until proven; v1 below is unchanged.
    if (rules === 'v2') {
      const judged = await judgeV2(tidy);
      await store.addRaw(id, 2, 'judge', runId, judged, judged.status);
      const final = recheck ? await recheckV2(tidy, judged) : judged;
      if (final.recheck) await store.addRaw(id, 2, 'recheck', runId, final.recheck, final.recheck.status);
      await store.addRaw(id, 2, 'result', runId, final, final.status);
      await store.setStatus(id, 2, final.status === 'failed' ? 'failed' : 'done', final.status === 'failed' ? final.error ?? 'judge failed' : null);
      return;
    }

    let result = await judgeTidy(tidy);
    if (assets) (result as any).technical_audit = assets;
    await store.addRaw(id, 2, 'judge', runId, result, result.status);

    if (recheck) {
      const { result: rc, findings } = await recheckTidy(tidy, result);
      await store.addRaw(id, 2, 'recheck', runId, { result: rc, findings }, rc.status);
      result = {
        ...result,
        findings,
        stats: { ...result.stats, findings_count: findings.length, llm_calls: result.stats.llm_calls + rc.meta.attempts.length },
        recheck: rc,
      };
      if (assets) (result as any).technical_audit = assets;
    }
    await store.addRaw(id, 2, 'result', runId, result, result.status);
    await store.setStatus(id, 2, result.status === 'failed' ? 'failed' : 'done', result.status === 'failed' ? result.error ?? 'judge failed' : null);
  } catch (err: any) {
    const message = err?.message ?? String(err);
    try {
      await store.addRaw(id, 2, 'result', runId, failedOutput(report, message), 'failed');
      await store.setStatus(id, 2, 'failed', message);
    } catch (e: any) {
      console.error(`[v21 step2] ${id}: could not store the failure: ${e?.message ?? e} (original: ${message})`);
    }
  }
}

export async function handle(req: http.IncomingMessage, res: http.ServerResponse, url: URL, { json, readJson }: Ctx): Promise<boolean> {
  const p = url.pathname.replace(/\/+$/, '');
  if (p !== PATH && !p.startsWith(PATH + '/')) return false;

  try {
    if (req.method === 'POST' && p === PATH) {
      const b = await readJson(req);
      const reportId = typeof b.report_id === 'string' ? b.report_id.trim() : '';
      if (!reportId) return json(res, 400, { error: 'missing: report_id' }), true;
      const report: any = await store.getReport(reportId);
      if (!report) return json(res, 404, { error: 'no such report' }), true;
      const cp = await store.latestRaw(reportId, 'checkpoint');
      if (!cp) return json(res, 409, { error: `report has no Step 1 checkpoint (step1_status=${report.step1_status})` }), true;
      if (report.step2_status === 'running' && Date.now() - new Date(report.updated_at).getTime() < STALE_MS) {
        return json(res, 409, { error: 'Step 2 is already running for this report' }), true;
      }
      const runId = crypto.randomUUID();
      await store.setStatus(reportId, 2, 'running');
      const recheck = b.recheck === undefined ? true : Boolean(b.recheck);
      // v2 by default: Step 3 reads v2 only, so a v1 result could never become a report. v1 only when asked for.
      const rules = b.rules === 'v1' ? 'v1' : 'v2';
      void runStep2(report, cp.payload, runId, recheck, rules);
      return json(res, 202, { report_id: reportId, run_id: runId, recheck, rules }), true;
    }

    if (req.method === 'GET') {
      const reportId = p.slice(PATH.length + 1);
      const report: any = await store.getReport(reportId);
      if (!report) return json(res, 404, { error: 'no such report' }), true;
      const runId = url.searchParams.get('run_id') || undefined;
      const result = await store.latestRaw(reportId, 'result', runId);
      return json(res, 200, {
        report_id: reportId,
        step2_status: report.step2_status,
        step2_error: report.step2_error ?? null,
        run_id: result?.run_id ?? runId ?? null,
        result: result?.payload ?? null,
      }), true;
    }
  } catch (err: any) {
    return json(res, 503, { error: `report store: ${err?.message ?? err}` }), true;
  }

  return json(res, 405, { error: 'method not allowed' }), true;
}
