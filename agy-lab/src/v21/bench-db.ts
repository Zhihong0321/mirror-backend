// V2.1 Step 2 benchmark store: every judge run and every recheck run, one row each, in the hub's Postgres
// (table step2_bench_run, hub module src/v21-bench-store.ts). Rows are written once and never updated, so any two runs
// (prompt versions, models, before/after a fix) can be compared later. A recheck row points at its judge row (judge_id).
// A failed write is the caller's to report; it never stops a run.
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { envValue } from './cloud.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const HUB_URL = (process.env.LAB_URL ?? 'https://company-diver-production.up.railway.app').replace(/\/$/, '');
const LAB_TOKEN = envValue('LAB_TOKEN');
const ROUTE = '/api/v21/step2-bench';

/** The first local store (2026-11-04), kept only so its rows can be copied to the hub once. */
export const OLD_SQLITE = path.join(here, 'runs', 'step2-bench.sqlite');

export type BenchRow = {
  run_folder: string;
  company: string;
  country: string;
  pass: 'judge' | 'recheck';
  judge_id?: number | null;
  prompt: string;
  model: string | null;
  lane: string | null;
  status: string;
  error: string | null;
  duration_ms: number;
  llm_calls: number;
  findings: unknown[];
  rejected: unknown[];
  dropped_namesakes?: unknown[];
  reviews?: unknown[];
  removed?: unknown[];
  added?: string[];
  attempts: unknown[];
  llm_raw: string | null;
};

/** Insert one row on the hub; returns its id. Throws when the hub does not take it. `hub` overrides the URL (tests). */
export async function saveBenchRow(row: BenchRow, hub = HUB_URL): Promise<number> {
  const res = await fetch(`${hub}${ROUTE}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${LAB_TOKEN}`, 'content-type': 'application/json' },
    body: JSON.stringify({ ...row, dropped_namesakes: row.dropped_namesakes ?? [], reviews: row.reviews ?? [], removed: row.removed ?? [], added: row.added ?? [] }),
    signal: AbortSignal.timeout(30_000),
  });
  const body: any = await res.json().catch(() => ({}));
  if (res.status !== 201 || !Number.isInteger(body?.id)) throw new Error(`hub ${res.status}: ${JSON.stringify(body).slice(0, 200)}`);
  return body.id;
}

async function fetchRows(hub = HUB_URL): Promise<any[]> {
  const res = await fetch(`${hub}${ROUTE}?limit=1000`, { headers: { authorization: `Bearer ${LAB_TOKEN}` }, signal: AbortSignal.timeout(30_000) });
  const body: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`hub ${res.status}: ${JSON.stringify(body).slice(0, 200)}`);
  return body.rows ?? [];
}

type Review = { finding_id: string; verdict: string; problems: string[] };

/** Latest judge run per run folder with its recheck: what the recheck kept, fixed, removed and added. */
export async function benchReport(hub = HUB_URL): Promise<string> {
  const rows = await fetchRows(hub);
  const latestJudge = new Map<string, any>();
  for (const r of rows) if (r.pass === 'judge' && !(Number(latestJudge.get(r.run_folder)?.id) > Number(r.id))) latestJudge.set(r.run_folder, r);
  const out: string[] = [`${rows.length} rows on the hub`];
  for (const j of [...latestJudge.values()].sort((a, b) => a.run_folder.localeCompare(b.run_folder))) {
    const runs = rows.filter((r) => r.run_folder === j.run_folder && r.pass === 'judge').length;
    out.push(`\n## ${j.company}  (${j.run_folder})  judge #${j.id} ${j.status} ${j.findings.length} findings ${(j.duration_ms / 1000).toFixed(0)}s  [${runs} judge run(s) stored]`);
    const r = rows.find((x) => x.pass === 'recheck' && Number(x.judge_id) === Number(j.id));
    if (!r) { out.push('   no recheck'); continue; }
    const reviews = r.reviews as Review[];
    const count = (v: string) => reviews.filter((x) => x.verdict === v).length;
    out.push(`   recheck #${r.id} ${r.status}${r.error ? ` (${r.error})` : ''} ${(r.duration_ms / 1000).toFixed(0)}s ${r.model ?? ''}: keep ${count('keep')}, fix ${count('fix')}, remove ${count('remove')}, added ${r.added.length}, refused by code ${r.rejected.length} -> ${r.findings.length} findings`);
    for (const v of reviews) {
      const f = j.findings.find((y: any) => y.id === v.finding_id);
      out.push(`   - ${v.verdict.toUpperCase().padEnd(6)} ${f?.title ?? v.finding_id}`);
      for (const p of v.problems) out.push(`            ${p}`);
    }
    for (const a of r.added) out.push(`   - ADDED  ${a}`);
    for (const x of r.rejected) out.push(`   - REFUSED ${x.finding?.title}: ${x.reasons.join('; ')}`);
  }
  return out.join('\n');
}

/** Copy the rows of the first local SQLite store to the hub, oldest first, keeping each recheck linked to its judge.
 * Rows already copied (same run_folder, pass, prompt and llm_raw on the hub) are skipped, so running it twice is safe. */
export async function importOldSqlite(file = OLD_SQLITE, hub = HUB_URL): Promise<string> {
  const local = new DatabaseSync(file, { readOnly: true });
  const rows = local.prepare('SELECT * FROM step2_run ORDER BY id').all() as any[];
  local.close();
  const onHub = await fetch(`${hub}${ROUTE}?limit=1000&raw=1`, { headers: { authorization: `Bearer ${LAB_TOKEN}` } }).then((r) => r.json()).then((b: any) => b.rows ?? []);
  const key = (r: any) => `${r.run_folder}|${r.pass}|${r.prompt}|${r.llm_raw ?? ''}`;
  const have = new Map<string, number>(onHub.map((r: any) => [key(r), Number(r.id)]));
  const newId = new Map<number, number>();
  const lines: string[] = [];
  for (const r of rows) {
    const k = key(r);
    if (have.has(k)) {
      newId.set(r.id, have.get(k)!);
      lines.push(`local #${r.id} already on hub as #${have.get(k)}`);
      continue;
    }
    const id = await saveBenchRow({
      run_folder: r.run_folder, company: r.company, country: r.country, pass: r.pass,
      judge_id: r.judge_id === null ? null : newId.get(r.judge_id) ?? null,
      prompt: r.prompt, model: r.model, lane: r.lane, status: r.status, error: r.error,
      duration_ms: r.duration_ms, llm_calls: r.llm_calls,
      findings: JSON.parse(r.findings_json), rejected: JSON.parse(r.rejected_json), dropped_namesakes: JSON.parse(r.dropped_json),
      reviews: JSON.parse(r.reviews_json), removed: JSON.parse(r.removed_json), added: JSON.parse(r.added_json),
      attempts: JSON.parse(r.attempts_json), llm_raw: r.llm_raw,
    }, hub);
    newId.set(r.id, id);
    lines.push(`local #${r.id} (${r.pass} ${r.company}) -> hub #${id}`);
  }
  return lines.join('\n');
}
