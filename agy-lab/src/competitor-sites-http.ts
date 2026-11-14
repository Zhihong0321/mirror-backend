// Competitor Official Site Analysis on the hub (src/competitor-sites.ts). Test stage: behind the hub token like every
// API route; no on/off switch. Runs are kept in memory only (a redeploy forgets them). The result is a file: markdown
// for the owner, JSON for the raw answers.
//
//   POST /api/competitor-sites            { country, industry, own_website?, own_name? } -> 202 { id }
//   GET  /api/competitor-sites            -> the runs this process knows
//   GET  /api/competitor-sites/{id}       -> { status, log, report (no screenshots) }
//   GET  /api/competitor-sites/{id}.md    -> the report as markdown
//
// country and industry are required: a missing one is a question back (400), never a guess.
import type http from 'node:http';
import crypto from 'node:crypto';
import { liveDeps, run, toMarkdown, withoutImages, type Input, type Report } from './competitor-sites.ts';

type Ctx = {
  json: (res: http.ServerResponse, status: number, body: unknown) => void;
  readJson: (req: http.IncomingMessage) => Promise<Record<string, unknown>>;
};

const PATH = '/api/competitor-sites';
type Run = { id: string; status: 'running' | 'done' | 'failed'; input: Input; started_at: string; finished_at: string | null; log: string[]; report: Report | null; error: string | null };
const runs = new Map<string, Run>();

export async function handle(req: http.IncomingMessage, res: http.ServerResponse, url: URL, ctx: Ctx): Promise<boolean> {
  if (url.pathname !== PATH && !url.pathname.startsWith(PATH + '/')) return false;

  if (req.method === 'POST' && url.pathname === PATH) {
    const body = await ctx.readJson(req).catch(() => ({} as Record<string, unknown>));
    const s = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
    const input: Input = { country: s(body.country), industry: s(body.industry), own_website: s(body.own_website) || null, own_name: s(body.own_name) || null };
    const missing = [!input.country && 'country', !input.industry && 'industry'].filter(Boolean);
    if (missing.length) { ctx.json(res, 400, { error: `which ${missing.join(' and ')}? Both country and industry are needed.` }); return true; }
    const r: Run = { id: crypto.randomUUID(), status: 'running', input, started_at: new Date().toISOString(), finished_at: null, log: [], report: null, error: null };
    runs.set(r.id, r);
    const log = (msg: string) => { r.log.push(`${new Date().toISOString()} ${msg}`); console.log(`[competitor-sites ${r.id.slice(0, 8)}] ${msg}`); };
    void run(input, liveDeps(log))
      .then((report) => { r.report = report; r.status = 'done'; })
      .catch((e) => { r.status = 'failed'; r.error = e instanceof Error ? e.message : String(e); log(`run failed: ${r.error}`); })
      .finally(() => { r.finished_at = new Date().toISOString(); });
    ctx.json(res, 202, { id: r.id, input });
    return true;
  }

  if (req.method === 'GET' && url.pathname === PATH) {
    ctx.json(res, 200, { runs: [...runs.values()].map((r) => ({ id: r.id, status: r.status, input: r.input, started_at: r.started_at, finished_at: r.finished_at })) });
    return true;
  }

  const m = url.pathname.slice(PATH.length + 1).match(/^([0-9a-f-]{36})(\.md)?$/);
  if (req.method === 'GET' && m) {
    const r = runs.get(m[1]!);
    if (!r) { ctx.json(res, 404, { error: 'no such run in this process (runs are kept in memory; a redeploy forgets them)' }); return true; }
    if (m[2]) {
      if (!r.report) { ctx.json(res, 409, { error: `run is ${r.status}; no report yet`, log: r.log.slice(-20) }); return true; }
      res.writeHead(200, { 'content-type': 'text/markdown; charset=utf-8' });
      res.end(toMarkdown(r.report));
      return true;
    }
    ctx.json(res, 200, { ...r, report: r.report ? withoutImages(r.report) : null });
    return true;
  }
  ctx.json(res, 404, { error: 'unknown competitor-sites route' });
  return true;
}
