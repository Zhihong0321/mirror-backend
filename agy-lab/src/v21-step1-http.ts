// V2.1 Step 1 on the hub: run one company's research here, not on a PC. LAB_TOKEN only (server.ts authorized()).
// A run takes a minute or two (searches, worker page reads, site lookups), so it runs in the background:
//
//   POST /api/v21/step1        { company, country, industry, website? } -> 202 { id, status: 'running' }
//   GET  /api/v21/step1/{id}   -> { id, status: running|done|failed, input, log[], checkpoint?, checkpointPath?, error? }
//   GET  /api/v21/step1        -> the runs since the last start (no checkpoints)
//
// Every page read goes through the Local Gmap Worker (myworker.up.railway.app). The run id IS the report UID
// (src/v21-store.ts): it is issued before the first call, and the whole checkpoint and the log are written to Postgres
// when the run ends (kinds 'checkpoint' and 'log'). The log of a running run is also kept in memory, and the checkpoint
// file still goes to the /data volume (src/v21/research.ts saveCheckpoint); the database copy is the one to read.
import type http from 'node:http';
import crypto from 'node:crypto';
import { runStep1Research, type ResearchInput } from './v21/research.ts';
import * as store from './v21-store.ts';

type Ctx = {
  json: (res: http.ServerResponse, status: number, body: unknown) => void;
  readJson: (req: http.IncomingMessage) => Promise<Record<string, unknown>>;
};

type Run = {
  id: string;
  status: 'running' | 'done' | 'failed';
  input: ResearchInput;
  started: string;
  finished?: string;
  log: string[];
  checkpointPath?: string;
  checkpoint?: unknown;
  error?: string;
  /** Set when the raw data could not be written to the database (the run itself is not lost: it is still in memory). */
  store_error?: string;
};

const PATH = '/api/v21/step1';
const runs = new Map<string, Run>();
const MAX_RUNS = 200;

export async function handle(req: http.IncomingMessage, res: http.ServerResponse, url: URL, { json, readJson }: Ctx): Promise<boolean> {
  const p = url.pathname.replace(/\/+$/, '');
  if (p !== PATH && !p.startsWith(PATH + '/')) return false;

  if (req.method === 'POST' && p === PATH) {
    const b = await readJson(req);
    const str = (k: string) => (typeof b[k] === 'string' ? (b[k] as string).trim() : '');
    const input: ResearchInput = { company: str('company'), country: str('country'), industry: str('industry') };
    if (str('website')) input.website = str('website');
    const missing = (['company', 'country', 'industry'] as const).filter((k) => !input[k]);
    if (missing.length) return json(res, 400, { error: `missing: ${missing.join(', ')}` }), true;

    // The report UID is the anchor: nothing is researched until it exists in the database.
    let id: string;
    try {
      id = await store.createReport(input);
    } catch (err: any) {
      return json(res, 503, { error: `report store: ${err?.message ?? err}` }), true;
    }
    const run: Run = { id, status: 'running', input, started: new Date().toISOString(), log: [] };
    runs.set(run.id, run);
    if (runs.size > MAX_RUNS) runs.delete(runs.keys().next().value!);
    void store.setStatus(id, 1, 'running').catch((err) => run.log.push(`report store: ${err?.message ?? err}`));
    runStep1Research(input, (msg) => run.log.push(msg))
      .then(async ({ checkpointPath, data }) => {
        Object.assign(run, { status: 'done', checkpointPath, checkpoint: data });
        try {
          await store.addRaw(id, 1, 'checkpoint', id, data);
          await store.addRaw(id, 1, 'log', id, run.log);
          await store.setStatus(id, 1, (data as any).skipped ? 'skipped' : 'done');
        } catch (err: any) {
          run.store_error = err?.message ?? String(err);
          void store.setStatus(id, 1, 'failed', `raw data not stored: ${run.store_error}`).catch(() => {});
        }
      })
      .catch(async (err: Error) => {
        Object.assign(run, { status: 'failed', error: err.message });
        try {
          await store.addRaw(id, 1, 'log', id, run.log, 'failed');
          await store.setStatus(id, 1, 'failed', err.message);
        } catch (e: any) {
          run.store_error = e?.message ?? String(e);
        }
      })
      .finally(() => (run.finished = new Date().toISOString()));
    return json(res, 202, { id: run.id, report_id: run.id, status: run.status }), true;
  }

  if (req.method === 'GET' && p === PATH) {
    const list = [...runs.values()].reverse().map(({ checkpoint, log, ...rest }) => ({ ...rest, logLines: log.length }));
    return json(res, 200, { runs: list }), true;
  }

  if (req.method === 'GET') {
    const id = p.slice(PATH.length + 1);
    const run = runs.get(id);
    if (run) return json(res, 200, run), true;
    // Not in memory (the hub restarted since): the database copy answers.
    try {
      const report: any = await store.getReport(id);
      if (!report) return json(res, 404, { error: 'no such run' }), true;
      const cp = await store.latestRaw(id, 'checkpoint');
      const lg = await store.latestRaw(id, 'log');
      return json(res, 200, {
        id, status: report.step1_status === 'running' ? 'running' : report.step1_status === 'failed' ? 'failed' : 'done',
        step1_status: report.step1_status, error: report.step1_error ?? undefined,
        input: { company: report.company, country: report.country, industry: report.industry, website: report.website ?? undefined },
        log: lg?.payload ?? [], checkpoint: cp?.payload, from: 'database',
      }), true;
    } catch (err: any) {
      return json(res, 503, { error: `report store: ${err?.message ?? err}` }), true;
    }
  }

  return json(res, 405, { error: 'method not allowed' }), true;
}
