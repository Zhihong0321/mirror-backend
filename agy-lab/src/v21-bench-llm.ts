// TEST ONLY (owner, 2026-11-13): gpt-6.1-terra (high) against deepseek v4.1 on Vectide (high), the same real Step 3
// prompt, fired together, timed and scored. Nothing here is on the report path and nothing it writes reaches a report.
//
//   POST /api/bench-llm      { report_ids: [uid...], rounds?: 1 }  -> 202 { bench_id }
//   GET  /api/bench-llm/{id} -> { status, results: [...] }  (answers included)
//   GET  /api/bench-llm      -> the bench ids this process knows
//
// For each report and round, Step 3's real messages (step3SystemPrompt + the Step 2 items, built from the stored Step 2
// 'result' row of that report) go to both models at the same moment (llm.benchCall: one lane, no retry, 8 minutes is
// dead). Each answer is then scored by Step 3's own code: it is run through writeStep3 against a stub lane that returns
// that exact answer, so the numbers (sentences kept, rejected with reasons, titles, proof) are what production would get.
//
// The terra lane is not in the llm_lane table, so no production call can ever land on it. Its key is the hub variable
// BENCH_LINGSUAN_KEY (never in git). The deepseek lane is the Vectide lane the hub already holds.
import type http from 'node:http';
import crypto from 'node:crypto';
import { llm } from './core/index.ts';
import { itemsForPrompt, step3SystemPrompt, writeStep3 } from './v21/step3.ts';
import * as store from './v21-store.ts';

type Ctx = {
  json: (res: http.ServerResponse, status: number, body: unknown) => void;
  readJson: (req: http.IncomingMessage) => Promise<Record<string, unknown>>;
};

const PATH = '/api/bench-llm';
const EFFORT = 'high';

type Target = { label: string; lane: llm.LlmConfig };
type Result = Record<string, unknown>;
type Bench = { id: string; status: 'running' | 'done'; started_at: string; finished_at: string | null; plan: unknown; results: Result[]; notes: string[] };
const benches = new Map<string, Bench>();

/** The two lanes under test, or what is missing. */
function targets(): { targets: Target[]; missing: string[] } {
  const missing: string[] = [];
  const out: Target[] = [];
  const key = (process.env.BENCH_LINGSUAN_KEY ?? '').trim();
  if (key) out.push({ label: 'gpt-6.1-terra (lingsuan)', lane: { url: 'https://api.lingsuan.si/v1', key, model: 'gpt-6.1-terra', label: 'bench lingsuan' } });
  else missing.push('hub variable BENCH_LINGSUAN_KEY is not set');
  const vectide = llm.pool().find((l) => /vectide\.cn/i.test(l.url) && /deepseek/i.test(l.model));
  if (vectide) out.push({ label: 'deepseek-v4.1 (vectide)', lane: { ...vectide, first: false, label: 'bench vectide' } });
  else missing.push('no Vectide deepseek lane in the hub pool');
  return { targets: out, missing };
}

/** A lane on this machine that answers every call with the given text: it lets Step 3's own code score a real answer. */
async function stubLane(answer: string): Promise<{ lane: { label: string; url: string; key: string; model: string }; close: () => void }> {
  const http = await import('node:http');
  const server = http.createServer((req, res) => {
    req.resume().on('end', () => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { content: answer }, finish_reason: 'stop' }] }));
    });
  });
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', () => ok()));
  return { lane: { label: 'bench-stub', url: `http://127.0.0.1:${(server.address() as any).port}`, key: 'x', model: 'stub' }, close: () => server.close() };
}

/** Step 3's own check of one answer. Never throws: a score that could not be made says why. */
async function score(s2: any, answer: string): Promise<Result> {
  let stub: Awaited<ReturnType<typeof stubLane>> | null = null;
  try {
    stub = await stubLane(answer);
    const { report, email } = await writeStep3(s2, { row_id: 0, run_id: 'bench' }, 'https://bench.invalid/r/x', { lanes: [stub.lane], test: 'bench' });
    if (report.status === 'failed') return { scored: false, why: report.error };
    let said: any = null;
    try { said = JSON.parse(answer.slice(answer.indexOf('{'), answer.lastIndexOf('}') + 1)); } catch { /* not JSON: report.status would be failed */ }
    const rejected = [...report.rejected, ...email.rejected];
    return {
      scored: true,
      summary: { written: Array.isArray(said?.summary) ? said.summary.length : 0, kept: report.summary.length },
      email: { subject_kept: email.unchecked?.startsWith('the subject') ? false : Boolean(email.subject), body_written: Array.isArray(said?.email?.body) ? said.email.body.length : 0, body_kept: email.unchecked?.startsWith('every body') ? 0 : email.body.length },
      titles: { written: Array.isArray(said?.titles) ? said.titles.length : 0, kept: Object.keys(report.titles ?? {}).length },
      proof: { picked: said?.proof?.id ?? null, valid: report.proof ?? null },
      rejected: rejected.map((r) => ({ part: r.part, reasons: r.reasons })),
      rejected_count: rejected.length,
      text: { summary: report.summary.map((l) => l.text), subject: email.subject?.text ?? null, body: email.body.map((l) => l.text), titles: report.titles ?? {} },
    };
  } catch (err: any) {
    return { scored: false, why: err?.message ?? String(err) };
  } finally {
    stub?.close();
  }
}

async function runBench(bench: Bench, reportIds: string[], rounds: number, tg: Target[]): Promise<void> {
  try {
    for (const reportId of reportIds) {
      const row = await store.latestRaw(reportId, 'result');
      const s2 = row?.payload;
      if (!s2?.input) { bench.notes.push(`${reportId}: no Step 2 result, skipped`); continue; }
      const ko = /korea/i.test(s2.input.country);
      const messages = [
        { role: 'system' as const, content: step3SystemPrompt(s2, ko) },
        { role: 'user' as const, content: `STEP 2 ITEMS:\n${itemsForPrompt(s2)}\n\nWrite the summary and the email now under the rules. Return the JSON object only.` },
      ];
      const promptChars = messages.reduce((n, m) => n + m.content.length, 0);
      for (let round = 1; round <= rounds; round++) {
        // Fired together: both calls start in the same tick and are awaited together.
        const calls = await Promise.all(tg.map(async (t) => {
          const call = await llm.benchCall(t.lane, messages, { reasoningEffort: EFFORT, temperature: 0.1, json: true });
          bench.notes.push(`${s2.input.company} round ${round}: ${t.label} ${call.ok ? 'answered' : 'FAILED: ' + call.error} in ${(call.ms / 1000).toFixed(1)}s`);
          return { t, call };
        }));
        for (const { t, call } of calls) {
          bench.results.push({
            report_id: reportId, company: s2.input.company, country: s2.input.country, round, model: t.label, effort: EFFORT, prompt_chars: promptChars,
            ok: call.ok, error: call.error, seconds: +(call.ms / 1000).toFixed(1),
            first_reasoning_s: call.firstReasoningMs === null ? null : +(call.firstReasoningMs / 1000).toFixed(1),
            first_answer_s: call.firstAnswerMs === null ? null : +(call.firstAnswerMs / 1000).toFixed(1),
            tokens_in: call.tokensIn, tokens_out: call.tokensOut, finish: call.finish,
            tokens_per_s: call.tokensOut && call.ms ? +(call.tokensOut / (call.ms / 1000)).toFixed(1) : null,
            answer_chars: call.answer.length,
            quality: call.answer ? await score(s2, call.answer) : { scored: false, why: 'no answer' },
            answer: call.answer,
          });
        }
      }
    }
  } catch (err: any) {
    bench.notes.push(`bench stopped: ${err?.message ?? err}`);
  } finally {
    bench.status = 'done';
    bench.finished_at = new Date().toISOString();
  }
}

export async function handle(req: http.IncomingMessage, res: http.ServerResponse, url: URL, { json, readJson }: Ctx): Promise<boolean> {
  const p = url.pathname.replace(/\/+$/, '');
  if (p !== PATH && !p.startsWith(PATH + '/')) return false;
  try {
    if (req.method === 'POST' && p === PATH) {
      const b = await readJson(req);
      const reportIds = (Array.isArray(b.report_ids) ? b.report_ids : []).map(String).filter(Boolean);
      if (!reportIds.length) return json(res, 400, { error: 'missing: report_ids' }), true;
      const rounds = Math.min(5, Math.max(1, Number(b.rounds) || 1));
      const tg = targets();
      if (tg.missing.length) return json(res, 409, { error: tg.missing.join('; ') }), true;
      const bench: Bench = { id: crypto.randomUUID(), status: 'running', started_at: new Date().toISOString(), finished_at: null, plan: { report_ids: reportIds, rounds, effort: EFFORT, models: tg.targets.map((t) => t.label) }, results: [], notes: [] };
      benches.set(bench.id, bench);
      void runBench(bench, reportIds, rounds, tg.targets);
      return json(res, 202, { bench_id: bench.id, plan: bench.plan }), true;
    }
    if (req.method === 'GET' && p === PATH) return json(res, 200, { benches: [...benches.values()].map((x) => ({ id: x.id, status: x.status, started_at: x.started_at })) }), true;
    if (req.method === 'GET') {
      const bench = benches.get(p.slice(PATH.length + 1));
      return bench ? json(res, 200, bench) : json(res, 404, { error: 'no such bench (a restart forgets them)' }), true;
    }
  } catch (err: any) {
    return json(res, 503, { error: `bench: ${err?.message ?? err}` }), true;
  }
  return json(res, 405, { error: 'method not allowed' }), true;
}
