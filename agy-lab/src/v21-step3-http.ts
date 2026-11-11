// V2.1 Step 3 on the hub: write the free report and the email for one report, from its Step 2 rules-v2 result only
// (src/v21/step3.ts). Each result is written the moment it exists, as raw rows by report UID (src/v21-store.ts).
//
//   POST /api/v21/step3        { report_id, step2_run_id?, test? } -> 202 { report_id, run_id, step2_run_id }
//   GET  /api/v21/step3/{id}   ?run_id=  -> { report_id, step3_status, step3_error, run_id, report, email }
//   GET  /v21/r/{id}           public: the free report page (the newest stored report that passed; noindex)
//
// Refused before anything runs (409): no Step 2 result, a rules-v1 result, or a Step 2 result that failed or was skipped.
// Rows per run, both with the run_id: step 3 'report' and 'email'. Nothing is sent: the email is a draft.
// V21_STEP3_REFINE=on: a second pass reads the Step 2 run's raw input (its 'tidy' row) and the checked draft, and refines
// it (step3.ts refineStep3); both versions are in the rows, under 'refine'.
// test (LAB_TOKEN only, to prove the failure paths live): 'dead_lane' (every lane refuses), 'not_json' (a lane answers
// prose), 'bad_ids' (a lane answers JSON citing ids and numbers that are not in Step 2). Test rows are stored with
// status 'test', so the public page never shows them.
// The LLM wait policy applies: a slow call is never killed and restarted (judge.ts askLanes).
import type http from 'node:http';
import crypto from 'node:crypto';
import type { Lane } from './v21/judge.ts';
import { missingPage, refineOn, reportPage, writeStep3 } from './v21/step3.ts';
import * as store from './v21-store.ts';
import { fullReportPrice } from './reportdb.ts';

type Ctx = {
  json: (res: http.ServerResponse, status: number, body: unknown) => void;
  readJson: (req: http.IncomingMessage) => Promise<Record<string, unknown>>;
};

const PATH = '/api/v21/step3';
const PAGE = /^\/v21\/r\/([0-9a-f-]{36})\/?$/;
/** A report whose Step 3 says "running" for longer than this is taken as abandoned (a restart killed it). */
const STALE_MS = 60 * 60_000;

const TESTS = ['dead_lane', 'not_json', 'bad_ids'] as const;

/** A lane on this machine that answers every call with the given text (test runs only). */
async function stubLane(answer: string): Promise<{ lane: Lane; close: () => void }> {
  const http = await import('node:http');
  const server = http.createServer((req, res) => {
    req.resume().on('end', () => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { content: answer }, finish_reason: 'stop' }] }));
    });
  });
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', () => ok()));
  return { lane: { label: 'test-stub', url: `http://127.0.0.1:${(server.address() as any).port}`, key: 'x', model: 'stub' }, close: () => server.close() };
}

const BAD_IDS_ANSWER = JSON.stringify({
  summary: [
    { text: 'Google shows 4.7 stars from 32 reviews.', cites: ['f9'] },
    { text: 'Your domain expires in 90 days.', cites: ['f1'] },
    { text: 'Your branch list needs fixing.', cites: ['c99'] },
    { text: 'The full report will find more.', cites: ['f1'] },
  ],
  email: { subject: { text: 'Your domain expires soon', cites: ['f404'] }, body: [{ text: 'Google shows 4.7 stars from 32 reviews.', cites: ['f9'] }] },
});

/**
 * The hub chain (owner, 2026-11-11): Step 3 starts when Step 2 ends, whatever Step 2's outcome. No check stops it:
 * a missing or failed Step 2 result is written up as it is, and a failure is stored on the report. Never throws.
 */
export async function startStep3(reportId: string, base: string): Promise<void> {
  try {
    const s2row = await store.latestRaw(reportId, 'result');
    const runId = crypto.randomUUID();
    await store.setStatus(reportId, 3, 'running');
    await runStep3(reportId, s2row as any, runId, `${base}/v21/r/${reportId}`);
  } catch (err: any) {
    console.error(`[v21 chain] ${reportId}: Step 3 start: ${err?.message ?? err}`);
  }
}

export function baseUrl(req: http.IncomingMessage): string {
  const host = String(req.headers['x-forwarded-host'] ?? req.headers.host ?? '').split(',')[0]!.trim();
  const proto = String(req.headers['x-forwarded-proto'] ?? (host.startsWith('localhost') || host.startsWith('127.') ? 'http' : 'https')).split(',')[0]!.trim();
  return `${proto}://${host}`;
}

/** The whole run. Never throws: a failure is stored as 'report' and 'email' rows with status failed. */
async function runStep3(reportId: string, s2row: { id: number; run_id: string; payload: any }, runId: string, reportUrl: string, test?: string): Promise<void> {
  let stub: { lane: Lane; close: () => void } | null = null;
  try {
    let lanes: Lane[] | undefined;
    if (test === 'dead_lane') lanes = [{ label: 'dead-port', url: 'http://127.0.0.1:9', key: 'x', model: 'none' }];
    if (test === 'not_json') stub = await stubLane('Here is the summary and the email you asked for: the domain expires soon.');
    if (test === 'bad_ids') stub = await stubLane(BAD_IDS_ANSWER);
    if (stub) lanes = [stub.lane];

    // The second pass reads the raw input this Step 2 run read: its 'tidy' row (same run_id). Only loaded when it runs.
    const raw = refineOn() ? ((await store.latestRaw(reportId, 'tidy', s2row.run_id))?.payload ?? null) : null;
    const { report, email } = await writeStep3(s2row.payload, { row_id: s2row.id, run_id: s2row.run_id }, reportUrl, { lanes, test, raw });
    await store.addRaw(reportId, 3, 'report', runId, report, test ? 'test' : report.status);
    await store.addRaw(reportId, 3, 'email', runId, email, test ? 'test' : email.status);
    const failed = report.status === 'failed' ? report.error : email.status === 'failed' ? email.error : null;
    await store.setStatus(reportId, 3, failed ? 'failed' : 'done', failed);
  } catch (err: any) {
    const message = err?.message ?? String(err);
    console.error(`[v21 step3] ${reportId}: ${message}`);
    try {
      await store.setStatus(reportId, 3, 'failed', message);
    } catch { /* the database is gone; the log line above is all there is */ }
  } finally {
    stub?.close();
  }
}

/** Why a Step 2 result cannot be written up, or null when it can. */
function refuse(row: { payload: any } | null): string | null {
  if (!row) return 'report has no Step 2 result';
  const p = row.payload ?? {};
  if (p.rules !== 'v2') return 'the Step 2 result is rules v1; Step 3 reads rules v2 only (POST /api/v21/step2 {rules:"v2"})';
  // A failed or skipped Step 2 is still written up (its report says what could not be checked); it never stops the report.
  return null;
}

/** The public report page. Outside the token gate: the report UID is the share link. */
export async function handlePublic(req: http.IncomingMessage, res: http.ServerResponse, url: URL): Promise<boolean> {
  const m = PAGE.exec(url.pathname);
  if (!m || req.method !== 'GET') return false;
  const send = (status: number, html: string) => {
    res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex, nofollow' });
    res.end(html);
  };
  try {
    // The newest written report. Rows an earlier pre-send gate marked 'blocked' are complete reports too.
    // A row whose writing call failed is served too: the page is drawn by code from the Step 2 items.
    const rows = await Promise.all(['ok', 'blocked', 'failed'].map((s) => store.latestRaw(m[1]!, 'report', undefined, s)));
    const row = rows.filter(Boolean).sort((a: any, b: any) => b.id - a.id)[0] ?? null;
    const s2 = row ? await store.rawById(m[1]!, Number(row.payload.step2_row_id)) : null;
    if (!row || !s2) return send(404, missingPage()), true;
    return send(200, reportPage(row.payload, s2.payload, { price: await fullReportPrice(), ref: m[1]!.slice(0, 8).toUpperCase() })), true;
  } catch (err: any) {
    console.error(`[v21 step3] page ${m[1]}: ${err?.message ?? err}`);
    return send(503, missingPage()), true;
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
      const test = typeof b.test === 'string' ? b.test : undefined;
      if (test && !(TESTS as readonly string[]).includes(test)) return json(res, 400, { error: `test must be one of ${TESTS.join(', ')}` }), true;
      const report: any = await store.getReport(reportId);
      if (!report) return json(res, 404, { error: 'no such report' }), true;
      const s2run = typeof b.step2_run_id === 'string' && b.step2_run_id.trim() ? b.step2_run_id.trim() : undefined;
      const s2row = await store.latestRaw(reportId, 'result', s2run);
      const why = refuse(s2row);
      if (why) return json(res, 409, { error: why, step2_run_id: s2row?.run_id ?? null }), true;
      if (report.step3_status === 'running' && Date.now() - new Date(report.updated_at).getTime() < STALE_MS) {
        return json(res, 409, { error: 'Step 3 is already running for this report' }), true;
      }
      const runId = crypto.randomUUID();
      await store.setStatus(reportId, 3, 'running');
      void runStep3(reportId, s2row!, runId, `${baseUrl(req)}/v21/r/${reportId}`, test);
      return json(res, 202, { report_id: reportId, run_id: runId, step2_run_id: s2row!.run_id, ...(test ? { test } : {}) }), true;
    }

    if (req.method === 'GET') {
      const reportId = p.slice(PATH.length + 1);
      const report: any = await store.getReport(reportId);
      if (!report) return json(res, 404, { error: 'no such report' }), true;
      const runId = url.searchParams.get('run_id') || undefined;
      const r = await store.latestRaw(reportId, 'report', runId);
      const e = r ? await store.latestRaw(reportId, 'email', r.run_id) : null;
      return json(res, 200, {
        report_id: reportId,
        step3_status: report.step3_status,
        step3_error: report.step3_error ?? null,
        run_id: r?.run_id ?? runId ?? null,
        report: r ? { row_id: r.id, row_status: r.status, ...r.payload } : null,
        email: e ? { row_id: e.id, row_status: e.status, ...e.payload } : null,
      }), true;
    }
  } catch (err: any) {
    return json(res, 503, { error: `report store: ${err?.message ?? err}` }), true;
  }

  return json(res, 405, { error: 'method not allowed' }), true;
}
