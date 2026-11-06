// V2.1 Step 1.5 on the hub: Digital Assets & Google PageSpeed audit.
// Reads the Step 1 checkpoint from the database by report UID, audits confirmed domains and official site,
// and writes the result to Postgres (src/v21-store.ts kind 'assets').
//
//   POST /api/v21/step1.5             { report_id } -> 202 { report_id, run_id, status: 'running' }
//   GET  /api/v21/step1.5/{report_id} ?run_id=      -> { report_id, step1_5_status, step1_5_error, run_id, result? }
//
// No LLM. Fast, deterministic, and free.
import type http from 'node:http';
import crypto from 'node:crypto';
import { runStep1_5Assets, type Step1_5_AssetsOutput } from './v21/assets.ts';
import * as store from './v21-store.ts';

type Ctx = {
  json: (res: http.ServerResponse, status: number, body: unknown) => void;
  readJson: (req: http.IncomingMessage) => Promise<Record<string, unknown>>;
};

const PATHS = ['/api/v21/step1.5', '/api/v21/step1_5'];
const STALE_MS = 30 * 60_000;

function failedAssetsOutput(report: any, error: string): Step1_5_AssetsOutput {
  return {
    version: '2.1',
    stage: 1.5,
    created_at: new Date().toISOString(),
    input: {
      company: report.company,
      country: report.country,
      industry: report.industry,
      ...(report.website ? { website: report.website } : {}),
    },
    status: 'failed',
    error,
    pagespeed: { status: 'failed', error },
    domains: [],
    google_reviews: { status: 'failed', error, max: 50 },
    findings: [],
    stats: { domains_checked: 0, pagespeed_runs: 0, findings_count: 0, duration_ms: 0 },
  };
}

/** Executes Step 1.5 in the background and writes the raw result to Postgres. */
export async function runStep1_5(report: any, checkpoint: any, runId: string): Promise<Step1_5_AssetsOutput> {
  const id: string = report.report_id;
  try {
    await store.setStatus(id, '1_5', 'running');
    const result = await runStep1_5Assets(checkpoint, (m) => console.log(`[v21 step1.5] ${id}: ${m}`));
    await store.addRaw(id, '1_5', 'assets', runId, result, result.status);
    await store.setStatus(id, '1_5', result.status, result.error ?? null);
    return result;
  } catch (err: any) {
    const message = err?.message ?? String(err);
    console.error(`[v21 step1.5] ${id}: failed: ${message}`);
    const failure = failedAssetsOutput(report, message);
    try {
      await store.addRaw(id, '1_5', 'assets', runId, failure, 'failed');
      await store.setStatus(id, '1_5', 'failed', message);
    } catch (e: any) {
      console.error(`[v21 step1.5] ${id}: could not store the failure: ${e?.message ?? e}`);
    }
    return failure;
  }
}

function matchesPath(p: string): boolean {
  return PATHS.some((base) => p === base || p.startsWith(base + '/'));
}

function getReportIdFromPath(p: string): string {
  for (const base of PATHS) {
    if (p.startsWith(base + '/')) return p.slice(base.length + 1);
  }
  return '';
}

export async function handle(req: http.IncomingMessage, res: http.ServerResponse, url: URL, { json, readJson }: Ctx): Promise<boolean> {
  const p = url.pathname.replace(/\/+$/, '');
  if (!matchesPath(p)) return false;

  try {
    const isBasePost = req.method === 'POST' && PATHS.includes(p);
    if (isBasePost) {
      const b = await readJson(req);
      const reportId = typeof b.report_id === 'string' ? b.report_id.trim() : '';
      if (!reportId) return json(res, 400, { error: 'missing: report_id' }), true;

      const report: any = await store.getReport(reportId);
      if (!report) return json(res, 404, { error: 'no such report' }), true;

      const cp = await store.latestRaw(reportId, 'checkpoint');
      if (!cp) return json(res, 409, { error: `report has no Step 1 checkpoint (step1_status=${report.step1_status})` }), true;

      if (report.step1_5_status === 'running' && Date.now() - new Date(report.updated_at).getTime() < STALE_MS) {
        return json(res, 409, { error: 'Step 1.5 is already running for this report' }), true;
      }

      const runId = crypto.randomUUID();
      void runStep1_5(report, cp.payload, runId);
      return json(res, 202, { report_id: reportId, run_id: runId, status: 'running' }), true;
    }

    if (req.method === 'GET') {
      const reportId = getReportIdFromPath(p);
      if (!reportId) return json(res, 400, { error: 'missing report_id in URL' }), true;

      const report: any = await store.getReport(reportId);
      if (!report) return json(res, 404, { error: 'no such report' }), true;

      const runId = url.searchParams.get('run_id') || undefined;
      const result = await store.latestRaw(reportId, 'assets', runId);

      return json(res, 200, {
        report_id: reportId,
        step1_5_status: report.step1_5_status ?? 'none',
        step1_5_error: report.step1_5_error ?? null,
        run_id: result?.run_id ?? runId ?? null,
        result: result?.payload ?? null,
      }), true;
    }
  } catch (err: any) {
    return json(res, 503, { error: `report store: ${err?.message ?? err}` }), true;
  }

  return json(res, 405, { error: 'method not allowed' }), true;
}
