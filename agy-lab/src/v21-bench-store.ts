// V2.1 Step 2 benchmark store on the hub: one row per judge run and per recheck run, written once, never updated.
// The V2.1 runner (src/v21/bench-db.ts) posts rows here so run 1 and its recheck can be compared across runs.
// Owns its one table (step2_bench_run); touches no other table. LAB_TOKEN only (server.ts authorized()).
//
//   POST /api/v21/step2-bench          one row -> { id }
//   GET  /api/v21/step2-bench          ?run_folder=&pass=&limit=  (llm_raw only with ?raw=1)
import type http from 'node:http';
import * as db from './reportdb.ts';

type Ctx = {
  json: (res: http.ServerResponse, status: number, body: unknown) => void;
  readJson: (req: http.IncomingMessage) => Promise<Record<string, unknown>>;
};

const PATH = '/api/v21/step2-bench';

let ready: Promise<void> | null = null;
function ensureTable(): Promise<void> {
  ready ??= db
    .sql(`create table if not exists step2_bench_run (
      id bigserial primary key,
      created_at timestamptz not null default now(),
      run_folder text not null,
      company text not null,
      country text not null,
      pass text not null check (pass in ('judge', 'recheck')),
      judge_id bigint references step2_bench_run(id),
      prompt text not null,
      model text,
      lane text,
      status text not null,
      error text,
      duration_ms integer not null,
      llm_calls integer not null,
      findings jsonb not null,
      rejected jsonb not null,
      dropped_namesakes jsonb not null,
      reviews jsonb not null,
      removed jsonb not null,
      added jsonb not null,
      attempts jsonb not null,
      llm_raw text
    )`)
    .then(() => db.sql(`create index if not exists step2_bench_run_folder on step2_bench_run (run_folder, id)`))
    .then(() => undefined)
    .catch((err) => {
      ready = null; // try again on the next call
      throw err;
    });
  return ready;
}

/** JSON for a jsonb parameter, lone surrogates repaired (Postgres rejects them). */
const jsonb = (v: unknown): string => JSON.stringify(v ?? [], (_k, x) => (typeof x === 'string' ? x.toWellFormed() : x));
const text = (v: unknown): string | null => (v === null || v === undefined ? null : String(v).toWellFormed());

export async function handle(req: http.IncomingMessage, res: http.ServerResponse, url: URL, { json, readJson }: Ctx): Promise<boolean> {
  if (url.pathname !== PATH) return false;
  if (!db.configured()) return json(res, 503, { error: 'no report database configured' }), true;

  if (req.method === 'POST') {
    const b = await readJson(req);
    const missing = ['run_folder', 'company', 'country', 'pass', 'prompt', 'status'].filter((k) => typeof b[k] !== 'string' || !b[k]);
    if (missing.length) return json(res, 400, { error: `missing: ${missing.join(', ')}` }), true;
    if (b.pass !== 'judge' && b.pass !== 'recheck') return json(res, 400, { error: 'pass must be judge or recheck' }), true;
    const judgeId = b.judge_id === null || b.judge_id === undefined ? null : Number(b.judge_id);
    if (judgeId !== null && !Number.isInteger(judgeId)) return json(res, 400, { error: 'judge_id must be an integer' }), true;
    await ensureTable();
    const out = await db.sql<{ id: string }>(
      `insert into step2_bench_run (run_folder, company, country, pass, judge_id, prompt, model, lane, status, error,
         duration_ms, llm_calls, findings, rejected, dropped_namesakes, reviews, removed, added, attempts, llm_raw)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb, $14::jsonb, $15::jsonb, $16::jsonb,
         $17::jsonb, $18::jsonb, $19::jsonb, $20)
       returning id`,
      [
        text(b.run_folder), text(b.company), text(b.country), b.pass, judgeId, text(b.prompt), text(b.model), text(b.lane),
        text(b.status), text(b.error), Math.round(Number(b.duration_ms) || 0), Math.round(Number(b.llm_calls) || 0),
        jsonb(b.findings), jsonb(b.rejected), jsonb(b.dropped_namesakes), jsonb(b.reviews), jsonb(b.removed),
        jsonb(b.added), jsonb(b.attempts), text(b.llm_raw),
      ],
    );
    return json(res, 201, { id: Number(out.rows[0]!.id) }), true;
  }

  if (req.method === 'GET') {
    await ensureTable();
    const q = url.searchParams;
    const where: string[] = [];
    const params: unknown[] = [];
    if (q.get('run_folder')) where.push(`run_folder = $${params.push(q.get('run_folder'))}`);
    if (q.get('pass')) where.push(`pass = $${params.push(q.get('pass'))}`);
    const limit = Math.min(Math.max(Number(q.get('limit')) || 200, 1), 1000);
    const cols = `id, created_at, run_folder, company, country, pass, judge_id, prompt, model, lane, status, error, duration_ms,
      llm_calls, findings, rejected, dropped_namesakes, reviews, removed, added, attempts${q.get('raw') === '1' ? ', llm_raw' : ''}`;
    const out = await db.sql(
      `select ${cols} from step2_bench_run ${where.length ? `where ${where.join(' and ')}` : ''} order by id desc limit ${limit}`,
      params,
    );
    return json(res, 200, { rows: out.rows }), true;
  }
  return false;
}
