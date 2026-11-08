import type http from 'node:http';
import * as db from './reportdb.ts';
import { start } from './divedeeper/v21/run.ts';
import { getRun, laneRows, listRuns, update } from './divedeeper/v21/store.ts';

type Ctx = {
  json: (res: http.ServerResponse, status: number, body: unknown) => void;
  readJson: (req: http.IncomingMessage) => Promise<Record<string, unknown>>;
};
const PATH = '/api/v21/deeper';
const live = { configured: db.configured, start, getRun, laneRows, listRuns };

/** Registered behind the server's existing operator authorization. */
export async function handle(req: http.IncomingMessage, res: http.ServerResponse, url: URL, ctx: Ctx, runtime: typeof live = live): Promise<boolean> {
  if ((url.pathname !== PATH && !url.pathname.startsWith(PATH + '/'))) return false;
  const { configured, start, getRun, laneRows, listRuns } = runtime;
  if (!configured()) { ctx.json(res, 503, { error: 'no report database configured' }); return true; }
  const report = url.pathname.match(/^\/api\/v21\/deeper\/([a-zA-Z0-9_-]+)\/report$/);
  if (report && req.method === 'GET') {
    const run = await getRun(report[1]);
    if (!run?.report_html) { ctx.json(res, 404, { error: 'no report yet' }); return true; }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex, nofollow' });
    res.end(run.report_html);
    return true;
  }
  if (url.pathname === PATH && req.method === 'POST') {
    let body: Record<string, unknown>;
    try { body = await ctx.readJson(req); }
    catch { ctx.json(res, 400, { error: 'invalid JSON body' }); return true; }
    const id = typeof body?.report_id === 'string' ? body.report_id.trim() : '';
    if (!/^[a-zA-Z0-9_-]{1,100}$/.test(id)) { ctx.json(res, 400, { error: 'report_id is required (letters, numbers, underscores and hyphens only)' }); return true; }
    ctx.json(res, 202, { run_id: await start(id) });
    return true;
  }
  if (url.pathname === PATH && req.method === 'GET') {
    const reportId = url.searchParams.get('report_id')?.trim();
    if (!reportId) { ctx.json(res, 400, { error: 'report_id is required' }); return true; }
    ctx.json(res, 200, { runs: await listRuns(reportId) });
    return true;
  }
  const one = url.pathname.match(/^\/api\/v21\/deeper\/([a-zA-Z0-9_-]+)$/);
  if (one && req.method === 'GET') {
    const run = await getRun(one[1]);
    if (!run) { ctx.json(res, 404, { error: 'no such run' }); return true; }
    ctx.json(res, 200, { ...run, lanes: await laneRows(run.run_id) });
    return true;
  }
  // Cancel a run that has not started: it stays in the table as failed, and the queue skips it.
  if (one && req.method === 'DELETE') {
    const run = await getRun(one[1]);
    if (!run) { ctx.json(res, 404, { error: 'no such run' }); return true; }
    if (run.status !== 'queued') { ctx.json(res, 409, { error: `only a queued run can be cancelled; this one is ${run.status}` }); return true; }
    await update(run.run_id, { status: 'failed', stage: 'cancelled', error: 'cancelled by the owner before it started', finished_at: new Date().toISOString() });
    ctx.json(res, 200, { run_id: run.run_id, status: 'failed', error: 'cancelled by the owner before it started' });
    return true;
  }
  ctx.json(res, 404, { error: 'not found' });
  return true;
}
