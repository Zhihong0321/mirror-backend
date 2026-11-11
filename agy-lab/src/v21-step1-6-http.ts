// V2.1 Step 1.6 on the hub: people and contacts linked to the company (src/v21/people.ts). Part of every run since
// 2026-11-11: Step 1 starts it beside Step 1.5, and Step 2 reads its newest 'people' row. Also on demand:
//
//   POST /api/v21/step1.6             { report_id } -> 202 { report_id, run_id, status: 'running' }
//   GET  /api/v21/step1.6/{report_id} ?run_id=      -> { report_id, status, run_id, result }
//
// The result is written to v21_raw (kind 'people') when the run ends; while it runs, GET answers from memory.
import type http from 'node:http';
import crypto from 'node:crypto';
import { runStep1_6People, type Step1_6_PeopleOutput } from './v21/people.ts';
import * as store from './v21-store.ts';

type Ctx = {
  json: (res: http.ServerResponse, status: number, body: unknown) => void;
  readJson: (req: http.IncomingMessage) => Promise<Record<string, unknown>>;
};

const PATHS = ['/api/v21/step1.6', '/api/v21/step1_6'];
const live = new Map<string, { runId: string; out: Step1_6_PeopleOutput | null; status: 'running' | 'done' | 'failed'; error?: string }>();

export async function runStep1_6(reportId: string, checkpoint: any, runId: string): Promise<void> {
  const entry = { runId, out: null as Step1_6_PeopleOutput | null, status: 'running' as 'running' | 'done' | 'failed', error: undefined as string | undefined };
  live.set(reportId, entry);
  try {
    // Every round is written as it ends (status 'round'), so a restart or deploy mid-run loses one round at most.
    const out = await runStep1_6People(checkpoint, (m) => console.log(`[v21 step1.6] ${reportId}: ${m}`), async (o) => {
      entry.out = o;
      await store.addRaw(reportId, 1, 'people', runId, o, 'round');
    });
    entry.out = out;
    await store.addRaw(reportId, 1, 'people', runId, out, out.status);
    entry.status = 'done';
  } catch (err: any) {
    entry.status = 'failed';
    entry.error = err?.message ?? String(err);
    console.error(`[v21 step1.6] ${reportId}: ${entry.error}`);
    // Keep whatever was gathered: the partial output is stored with the error, never dropped.
    try { await store.addRaw(reportId, 1, 'people', runId, { ...(entry.out ?? {}), status: 'failed', error: entry.error }, 'failed'); } catch (e: any) { console.error(`[v21 step1.6] ${reportId}: could not store: ${e?.message ?? e}`); }
  }
}

export async function handle(req: http.IncomingMessage, res: http.ServerResponse, url: URL, { json, readJson }: Ctx): Promise<boolean> {
  const p = url.pathname.replace(/\/+$/, '');
  const base = PATHS.find((b) => p === b || p.startsWith(b + '/'));
  if (!base) return false;
  try {
    if (req.method === 'POST' && p === base) {
      const b = await readJson(req);
      const reportId = typeof b.report_id === 'string' ? b.report_id.trim() : '';
      if (!reportId) return json(res, 400, { error: 'missing: report_id' }), true;
      const report: any = await store.getReport(reportId);
      if (!report) return json(res, 404, { error: 'no such report' }), true;
      const cp = await store.latestRaw(reportId, 'checkpoint');
      if (!cp) return json(res, 409, { error: `report has no Step 1 checkpoint (step1_status=${report.step1_status})` }), true;
      if (live.get(reportId)?.status === 'running') return json(res, 409, { error: 'Step 1.6 is already running for this report', run_id: live.get(reportId)!.runId }), true;
      const runId = crypto.randomUUID();
      void runStep1_6(reportId, cp.payload, runId);
      return json(res, 202, { report_id: reportId, run_id: runId, status: 'running' }), true;
    }
    if (req.method === 'GET' && p.startsWith(base + '/')) {
      const reportId = p.slice(base.length + 1);
      const runId = url.searchParams.get('run_id') || undefined;
      const now = live.get(reportId);
      if (now && (!runId || now.runId === runId) && now.status === 'running') {
        return json(res, 200, { report_id: reportId, status: 'running', run_id: now.runId, result: now.out }), true;
      }
      const row = await store.latestRaw(reportId, 'people', runId);
      return json(res, 200, { report_id: reportId, status: row ? row.status : 'none', run_id: row?.run_id ?? null, result: row?.payload ?? null }), true;
    }
    return json(res, 405, { error: 'method not allowed' }), true;
  } catch (err: any) {
    return json(res, 500, { error: err?.message ?? String(err) }), true;
  }
}
