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
import { phonesIn } from './report-rules/index.ts';
import { gateReport, gateResult, type GateItem, type GateResult } from './report-rules/gate.ts';

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

function baseUrl(req: http.IncomingMessage): string {
  const host = String(req.headers['x-forwarded-host'] ?? req.headers.host ?? '').split(',')[0]!.trim();
  const proto = String(req.headers['x-forwarded-proto'] ?? (host.startsWith('localhost') || host.startsWith('127.') ? 'http' : 'https')).split(',')[0]!.trim();
  return `${proto}://${host}`;
}

const INDEPENDENT_WORDS = /\b(independent(?:ly)?|third[- ]party|verified by)\b|독립|제3자/i;

/** PL25: the free page as it would be served, run through the pre-send gate. The company's own published phones are the ones
 *  found in passages the company wrote itself (party 'first'); any other phone on the page is a hit. */
export function gateStep3(report: any, s2: any, price: string | null = null): GateResult {
  const country = String(s2?.input?.country ?? '');
  const ev = (e: any[] | undefined) => (e ?? []) as Array<{ quoted_text?: string; party?: string }>;
  const quotes = (e: any[] | undefined) => ev(e).map((x) => String(x.quoted_text ?? ''));
  const own = [...(s2.conclusive_findings ?? []), ...(s2.take_note ?? [])].flatMap((x: any) => ev(x.evidence).filter((e) => e.party === 'first').map((e) => String(e.quoted_text ?? '')))
    // Both sides of a contact conflict are numbers listed for the company.
    .concat((s2.contradictions ?? []).flatMap((x: any) => ev(x.versions).filter((e) => e.party === 'first' || x.topic === 'contact').map((e) => String(e.quoted_text ?? ''))));
  const items: GateItem[] = [
    ...(s2.conclusive_findings ?? []).filter((x: any) => !x.paid_only).map((x: any): GateItem => ({
      id: x.id, text: `${x.title}. ${x.statement}`, quotes: quotes(x.evidence), why: x.why_it_matters, ownership: x.ownership,
      independentClaim: INDEPENDENT_WORDS.test(`${x.title} ${x.statement}`), hasIndependentSource: ev(x.evidence).some((e) => e.party === 'independent'),
    })),
    ...(s2.contradictions ?? []).map((x: any): GateItem => ({ id: x.id, text: x.title, quotes: quotes(x.versions), why: x.why_it_matters })),
    ...(s2.take_note ?? []).filter((x: any) => !x.paid_only && !x.identity_signal).map((x: any): GateItem => ({ id: x.id, text: `${x.title}. ${x.note}`, quotes: quotes(x.evidence), ownership: x.ownership })),
  ];
  const byId = new Map(items.map((i) => [i.id, i]));
  // A summary line is checked against the quotes of the items it cites.
  (report.summary ?? []).forEach((l: any, i: number) => items.push({ id: `summary ${i + 1}`, text: String(l.text ?? ''), quotes: (l.cites ?? []).flatMap((id: string) => byId.get(id)?.quotes ?? []) }));
  const html = reportPage(report, s2, { price });
  return gateResult(gateReport({
    html, kind: 'v21-free', country, companyPhones: own.flatMap((q) => phonesIn(q, country)), personNames: [], items,
  }));
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
    // PL25: a report that fails the gate is stored as 'blocked': the public link serves the holding page and nothing exports the email row.
    const gate = !test && report.status === 'ok' ? gateStep3(report, s2row.payload, await fullReportPrice()) : null;
    const blocked = gate?.status === 'blocked';
    await store.addRaw(reportId, 3, 'report', runId, gate ? { ...report, gate } : report, test ? 'test' : blocked ? 'blocked' : report.status);
    await store.addRaw(reportId, 3, 'email', runId, gate ? { ...email, gate } : email, test ? 'test' : blocked ? 'blocked' : email.status);
    const failed = report.status === 'failed' ? report.error : email.status === 'failed' ? email.error : null;
    const gateNote = gate?.failures.length ? `pre-send gate ${gate.status}: ${gate.failures.map((f) => `${f.rule} (${f.where}): ${f.detail}`).join('; ')}` : null;
    await store.setStatus(reportId, 3, failed ? 'failed' : 'done', failed ?? gateNote);
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
  if (p.status !== 'analyzed') return `the Step 2 result is ${p.status}: ${p.error ?? p.skip_reason ?? 'no reason given'}`;
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
    const row = await store.latestRaw(m[1]!, 'report', undefined, 'ok');
    // A newer run the gate blocked hides the page: the link never serves an older report in its place.
    const held = await store.latestRaw(m[1]!, 'report', undefined, 'blocked');
    if (row && held && held.id > row.id) return send(404, missingPage()), true;
    const s2 = row ? await store.rawById(m[1]!, Number(row.payload.step2_row_id)) : null;
    if (!row || !s2) return send(404, missingPage()), true;
    return send(200, reportPage(row.payload, s2.payload, { price: await fullReportPrice() })), true;
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
