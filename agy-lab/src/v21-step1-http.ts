// V2.1 Step 1 on the hub: run one company's research here, not on a PC. LAB_TOKEN only (server.ts authorized()).
// A run takes a minute or two (searches, worker page reads, site lookups), so it runs in the background:
//
//   POST /api/v21/step1        { company, country, industry, website? } -> 202 { id, status: 'running' }
//   GET  /api/v21/step1/{id}   -> { id, status: running|done|failed, input, log[], checkpoint?, checkpointPath?, error? }
//   GET  /api/v21/step1        -> the runs since the last start (no checkpoints)
//
// Every page read goes through the Local Gmap Worker (myworker.up.railway.app); runs are kept in memory and the
// checkpoint file on the /data volume (src/v21/research.ts saveCheckpoint).
import type http from 'node:http';
import crypto from 'node:crypto';
import { runStep1Research, type ResearchInput } from './v21/research.ts';

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

    const run: Run = { id: crypto.randomBytes(6).toString('hex'), status: 'running', input, started: new Date().toISOString(), log: [] };
    runs.set(run.id, run);
    if (runs.size > MAX_RUNS) runs.delete(runs.keys().next().value!);
    runStep1Research(input, (msg) => run.log.push(msg))
      .then(({ checkpointPath, data }) => Object.assign(run, { status: 'done', checkpointPath, checkpoint: data }))
      .catch((err: Error) => Object.assign(run, { status: 'failed', error: err.message }))
      .finally(() => (run.finished = new Date().toISOString()));
    return json(res, 202, { id: run.id, status: run.status }), true;
  }

  if (req.method === 'GET' && p === PATH) {
    const list = [...runs.values()].reverse().map(({ checkpoint, log, ...rest }) => ({ ...rest, logLines: log.length }));
    return json(res, 200, { runs: list }), true;
  }

  if (req.method === 'GET') {
    const run = runs.get(p.slice(PATH.length + 1));
    if (!run) return json(res, 404, { error: 'no such run (runs are kept in memory until the hub restarts)' }), true;
    return json(res, 200, run), true;
  }

  return json(res, 405, { error: 'method not allowed' }), true;
}
