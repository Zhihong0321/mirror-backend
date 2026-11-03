// One row per provider return, under the run's public id. The write is off the
// call: record() returns before any serialization when the switch is off or
// there is no report context, and a failure here never reaches the caller.
import crypto from 'node:crypto';
import { current, type ReportCtx } from './context.ts';
import type { ApiCall } from '../cost.ts';
import * as reportdb from '../reportdb.ts';

export type CallStatus = 'found' | 'not found' | "couldn't check" | 'failed';

export type EvidenceCall = {
  id: number;
  report_uid: string;
  parent_report_uid: string | null;
  kind: ReportCtx['kind'];
  step: string;
  provider: string;
  api: string;
  what: string;
  request: unknown;
  raw: unknown;
  status: CallStatus;
  ok: boolean;
  at: string;
  ms: number;
  model: string | null;
  usd: number | null;
  note: string | null;
};

/** 8 MiB of UTF-8. Above that the row still lands, with the body replaced. */
const CAP = 8 * 1024 * 1024;

const COULDNT = /time[d]?[ -]?out|unreachable|rate[ _-]?limit|\b429\b|blocked/i;
const SECRET = /^(authorization|api[-_]?key|x-api-key|access[-_]?token|refresh[-_]?token|id[-_]?token|jwt|assertion|private[-_]?key|secret|password|headers|token)$/i;

/** Marks text whose content type must not be stored (PDF, image, archive). */
const OPAQUE = Symbol.for('agy.evidence.opaque');

const warned = new Set<string>();
const failing = new Set<string>();
const pending = new Map<string, Set<Promise<void>>>();

let ready: Promise<void> | null = null;

const runKey = (reportUid: string) => reportUid;

/**
 * `results === 0` on a successful call is not found. A missing `results` is not
 * zero. Timeout, unreachable, rate limit, 429, or blocked could not be checked.
 */
export function statusOf(call: { ok: boolean; results?: number; note?: string }): CallStatus {
  if (call.ok) return call.results === 0 ? 'not found' : 'found';
  return COULDNT.test(call.note ?? '') ? "couldn't check" : 'failed';
}

/** True for PDF, images, audio, video, and archives. JSON, XML, and HTML are text. */
export function isOpaque(contentType: string): boolean {
  const mime = contentType.split(';')[0].trim().toLowerCase();
  if (!mime || mime.startsWith('text/')) return false;
  if (mime.includes('json') || mime.includes('xml') || mime.includes('html') || mime.includes('javascript')) return false;
  if (mime.startsWith('image/') || mime.startsWith('audio/') || mime.startsWith('video/') || mime.startsWith('font/')) return true;
  return mime === 'application/pdf'
    || mime === 'application/zip'
    || mime === 'application/gzip'
    || mime === 'application/x-gzip'
    || mime === 'application/octet-stream'
    || mime === 'application/wasm'
    || mime === 'application/x-tar'
    || mime === 'application/x-7z-compressed'
    || mime === 'application/vnd.rar'
    || mime === 'application/x-rar-compressed'
    || mime === 'application/x-bzip2'
    || mime === 'application/x-bzip';
}

/**
 * The body to store. Text stays text. An opaque content type becomes
 * `{ content_type, bytes, sha256 }` and the bytes are not kept. Cheap either way:
 * the hash of an opaque body happens later, inside the insert, not here.
 */
export function handoff(text: string, contentType?: string | null): unknown {
  if (contentType && isOpaque(contentType)) return { [OPAQUE]: true as const, text, content_type: contentType };
  return text;
}

function mimeOf(contentType: string): string {
  return contentType.split(';')[0].trim().toLowerCase();
}

function sha256(buf: Buffer): string {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function opaqueMeta(buf: Buffer, contentType: string): { content_type: string; bytes: number; sha256: string } {
  return { content_type: mimeOf(contentType) || 'application/octet-stream', bytes: buf.length, sha256: sha256(buf) };
}

function isOpaqueWrap(value: unknown): value is { text: string; content_type: string } {
  return Boolean(value) && typeof value === 'object' && OPAQUE in (value as object);
}

/** Drop a secret key on a plain request object. Arrays (messages) are left whole. */
function stripSecrets(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  if (value instanceof Error || value instanceof Response || Buffer.isBuffer(value) || isOpaqueWrap(value)) return value;
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (SECRET.test(key)) continue;
    out[key] = item;
  }
  return out;
}

async function prepare(value: unknown): Promise<unknown> {
  if (value == null) return null;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  if (value instanceof Error) return { message: value.message, name: value.name };
  if (Buffer.isBuffer(value)) return opaqueMeta(value, 'application/octet-stream');
  if (isOpaqueWrap(value)) return opaqueMeta(Buffer.from(value.text), value.content_type);
  if (value instanceof Response) {
    try {
      const ct = value.headers.get('content-type') ?? '';
      if (isOpaque(ct)) return opaqueMeta(Buffer.from(await value.arrayBuffer()), ct);
      return await value.text();
    } catch (err) {
      return { unreadable: true, note: err instanceof Error ? err.message : String(err) };
    }
  }
  try { return structuredClone(value); }
  catch (err) { return { unreadable: true, note: err instanceof Error ? err.message : String(err) }; }
}

/** JSON text for a jsonb parameter, or `{ omitted: true, bytes }` when it is over the cap. */
function fitJson(value: unknown): string {
  let text: string;
  try {
    text = JSON.stringify(value, (_k, v) => (typeof v === 'string' ? v.toWellFormed() : v));
  } catch (err) {
    return JSON.stringify({ unreadable: true, note: err instanceof Error ? err.message : String(err) });
  }
  if (text === undefined) return JSON.stringify({ unreadable: true, note: 'not JSON' });
  const bytes = Buffer.byteLength(text, 'utf8');
  if (bytes > CAP) return JSON.stringify({ omitted: true, bytes });
  return text;
}

function ensureTable(): Promise<void> {
  ready ??= reportdb.sql(`
    create table if not exists evidence_call (
      id bigserial primary key,
      report_uid text not null,
      parent_report_uid text,
      kind text not null,
      step text not null,
      provider text not null,
      api text not null,
      what text not null,
      request jsonb,
      raw jsonb,
      status text not null,
      ok boolean not null,
      at timestamptz not null,
      ms int not null,
      model text,
      usd numeric,
      note text
    );
    create index if not exists evidence_call_report_idx on evidence_call (report_uid, at);
  `).then(() => {}).catch((err) => { ready = null; throw err; });
  return ready;
}

function copyCall(call: ApiCall): ApiCall {
  return {
    at: call.at,
    api: call.api,
    what: call.what,
    ms: call.ms,
    ok: call.ok,
    usd: call.usd ?? null,
    ...(call.model !== undefined ? { model: call.model } : {}),
    ...(call.provider !== undefined ? { provider: call.provider } : {}),
    ...(call.results !== undefined ? { results: call.results } : {}),
    ...(call.note !== undefined ? { note: call.note } : {}),
    ...(call.tokensIn !== undefined ? { tokensIn: call.tokensIn } : {}),
    ...(call.tokensOut !== undefined ? { tokensOut: call.tokensOut } : {}),
    ...(call.credits !== undefined ? { credits: call.credits } : {}),
    ...(call.lane !== undefined ? { lane: call.lane } : {}),
  };
}

function warnOnce(reportUid: string, err: unknown): void {
  const key = runKey(reportUid);
  if (warned.has(key)) return;
  warned.add(key);
  const message = err instanceof Error ? err.message : String(err);
  console.warn(`[evidence ${reportUid}] ${message}`);
}

function track(reportUid: string, job: Promise<void>): void {
  let set = pending.get(reportUid);
  if (!set) pending.set(reportUid, set = new Set());
  set.add(job);
  job.finally(() => {
    set!.delete(job);
    if (set!.size === 0) pending.delete(reportUid);
  });
}

type Meta = { reportUid: string; parentReportUid: string | null; kind: ReportCtx['kind']; step: string };

async function write(call: ApiCall, raw: unknown, request: unknown, meta: Meta): Promise<void> {
  // evidence_fail: throw before any query. The run still finishes; nothing is inserted.
  if (failing.has(runKey(meta.reportUid))) throw new Error('evidence_fail');
  const requestJson = fitJson(await prepare(stripSecrets(request)));
  const rawJson = fitJson(await prepare(raw));
  if (failing.has(runKey(meta.reportUid))) throw new Error('evidence_fail');
  await ensureTable();
  if (failing.has(runKey(meta.reportUid))) throw new Error('evidence_fail');
  await reportdb.sql(
    `insert into evidence_call
       (report_uid, parent_report_uid, kind, step, provider, api, what, request, raw, status, ok, at, ms, model, usd, note)
     values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10, $11, $12, $13, $14, $15, $16)`,
    [
      meta.reportUid,
      meta.parentReportUid,
      meta.kind,
      meta.step,
      call.provider || 'api',
      call.api,
      call.what,
      requestJson,
      rawJson,
      statusOf(call),
      call.ok,
      call.at,
      call.ms,
      call.model ?? null,
      call.usd,
      call.note ?? null,
    ],
  );
}

/**
 * One warning per run, and whether this run's inserts throw before the query.
 * A later run of the same report clears the flag when `fail` is false, so a
 * proof can turn evidence_fail off by taking it out of options and running again.
 * Calls that return after settle still see the flag from the run that started them.
 */
export function watchRun(reportUid: string, fail: boolean): void {
  const key = runKey(reportUid);
  warned.delete(key);
  if (fail) failing.add(key);
  else failing.delete(key);
}

/**
 * Schedule one row. Returns at once when evidence is off or there is no context:
 * no serialize, no clone, no row. `request` is the query, URL, or messages.
 * Lookup, the cap, and the insert cannot throw into the caller.
 */
export function record(call: ApiCall, raw: unknown, request?: unknown): void {
  let ctx: ReportCtx | undefined;
  try { ctx = current(); } catch { return; }
  if (!ctx?.on || !ctx.reportUid) return;
  const snap = copyCall(call);
  const meta: Meta = {
    reportUid: ctx.reportUid,
    parentReportUid: ctx.parentReportUid,
    kind: ctx.kind,
    step: ctx.step,
  };
  // Off the caller. setTimeout yields past the return and the caller's own continuation.
  const job = new Promise<void>((resolve) => {
    setTimeout(() => {
      write(snap, raw, request, meta).then(resolve, (err) => {
        warnOnce(meta.reportUid, err);
        resolve();
      });
    }, 0);
  });
  track(meta.reportUid, job);
}

/** Wait for inserts already scheduled for this report. Never throws. A call that returns later writes its own row. */
export async function settle(reportUid: string, maxMs: number): Promise<void> {
  try {
    const deadline = Date.now() + Math.max(0, maxMs);
    for (;;) {
      const set = pending.get(reportUid);
      if (!set || set.size === 0) return;
      const left = deadline - Date.now();
      if (left <= 0) return;
      let timer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([
        Promise.allSettled([...set]),
        new Promise<void>((resolve) => { timer = setTimeout(resolve, left); }),
      ]);
      if (timer) clearTimeout(timer);
    }
  } catch { /* a settle never throws */ }
}

export async function callsForReport(reportUid: string): Promise<EvidenceCall[]> {
  await ensureTable();
  const out = await reportdb.sql<Record<string, unknown>>(
    `select id, report_uid, parent_report_uid, kind, step, provider, api, what, request, raw, status, ok, at, ms, model, usd, note
       from evidence_call where report_uid = $1 order by at, id`,
    [reportUid],
  );
  return out.rows.map((row) => ({
    id: Number(row.id),
    report_uid: String(row.report_uid),
    parent_report_uid: row.parent_report_uid == null ? null : String(row.parent_report_uid),
    kind: String(row.kind) as EvidenceCall['kind'],
    step: String(row.step),
    provider: String(row.provider),
    api: String(row.api),
    what: String(row.what),
    request: row.request ?? null,
    raw: row.raw ?? null,
    status: String(row.status) as CallStatus,
    ok: Boolean(row.ok),
    at: row.at instanceof Date ? row.at.toISOString() : String(row.at),
    ms: Number(row.ms),
    model: row.model == null ? null : String(row.model),
    usd: row.usd == null || row.usd === '' ? null : Number(row.usd),
    note: row.note == null ? null : String(row.note),
  }));
}
