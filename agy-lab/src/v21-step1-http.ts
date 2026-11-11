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
import { runStep1_5 } from './v21-step1-5-http.ts';
import { chainStep2And3 } from './v21-step2-http.ts';
import { baseUrl } from './v21-step3-http.ts';
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
    const base = baseUrl(req); // the hub address, for the report link Step 3 writes
    const b = await readJson(req);
    const str = (k: string) => (typeof b[k] === 'string' ? (b[k] as string).trim() : '');
    const input: ResearchInput = { company: str('company'), country: str('country'), industry: str('industry') };
    if (str('website')) input.website = str('website');
    const missing = (['company', 'country', 'industry'] as const).filter((k) => !input[k]);
    if (missing.length) return json(res, 400, { error: `missing: ${missing.join(', ')}` }), true;

    // The report UID is the anchor: nothing is researched until it exists in the database.
    let id: string;
    let companyUid: string | null;
    try {
      ({ report_id: id, company_uid: companyUid } = await store.createReport({ ...input, company_uid: typeof b.company_uid === 'string' ? b.company_uid : undefined }));
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
        // Only the checkpoint itself is needed downstream: a failed log row or link is recorded and never stops the report.
        try {
          await store.addRaw(id, 1, 'checkpoint', id, data);
        } catch (err: any) {
          run.store_error = err?.message ?? String(err);
          void store.setStatus(id, 1, 'failed', `raw data not stored: ${run.store_error}`).catch(() => {});
          return;
        }
        // Company UID where still empty: from the official domain Step 1 confirmed, else one of its own.
        try {
          await store.linkCompany(id, (data as any).official_site?.domain);
        } catch (err: any) {
          run.log.push(`company link: ${err?.message ?? err}`);
        }
        try {
          await store.addRaw(id, 1, 'log', id, run.log);
        } catch (err: any) {
          console.error(`[v21 step1] ${id}: log row not stored: ${err?.message ?? err}`);
        }
        try {
          await store.setStatus(id, 1, 'done');
        } catch (err: any) {
          console.error(`[v21 step1] ${id}: status not set: ${err?.message ?? err}`);
        }

        // Trigger Step 1.5 (technical audit: PageSpeed + Domain ownership & security) automatically in background
        try {
          const rep: any = await store.getReport(id);
          // The hub chain: when Step 1.5 ends (done or failed), Step 2 and then Step 3 run. Nothing stops it.
          if (rep) void runStep1_5(rep, data, id).catch((e: any) => console.error(`[v21 chain] ${id}: Step 1.5: ${e?.message ?? e}`)).then(() => chainStep2And3(id, base));
        } catch (err: any) {
          console.error(`[v21 step1 auto step1.5] ${id}: ${err?.message ?? err}`);
        }
      })
      .catch(async (err: Error) => {
        Object.assign(run, { status: 'failed', error: err.message });
        try {
          await store.linkCompany(id, null).catch((e: any) => run.log.push(`company link: ${e?.message ?? e}`));
          await store.addRaw(id, 1, 'log', id, run.log, 'failed');
          await store.setStatus(id, 1, 'failed', err.message);
        } catch (e: any) {
          run.store_error = e?.message ?? String(e);
        }
      })
      .finally(() => (run.finished = new Date().toISOString()));
    return json(res, 202, { id: run.id, report_id: run.id, company_uid: companyUid, status: run.status }), true;
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
        step1_status: report.step1_status, company_uid: report.company_uid ?? null, error: report.step1_error ?? undefined,
        input: { company: report.company, country: report.country, industry: report.industry, website: report.website ?? undefined },
        log: lg?.payload ?? [], checkpoint: cp?.payload, from: 'database',
      }), true;
    } catch (err: any) {
      return json(res, 503, { error: `report store: ${err?.message ?? err}` }), true;
    }
  }

  return json(res, 405, { error: 'method not allowed' }), true;
}
