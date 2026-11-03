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
/** Decoded text from the https agent: hashed as text, with a note that the original bytes are gone. */
const DECODED = Symbol.for('agy.evidence.decoded');

const warned = new Set<string>();
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

/** Text we store whole. Anything else is `{ content_type, bytes, sha256 }`, never the body. */
export function isOpaque(contentType: string): boolean {
  const mime = contentType.split(';')[0].trim().toLowerCase();
  if (mime.startsWith('text/')) return false;
  if (mime === 'application/json' || mime === 'application/xml' || mime === 'application/javascript') return false;
  if (mime.endsWith('+json') || mime.endsWith('+xml')) return false;
  return true;
}

/**
 * The body to store from decoded text (the extra-CA path has no original bytes).
 * Text types stay text. Anything else is marked and hashed later, inside the insert.
 */
export function handoff(text: string, contentType?: string | null): unknown {
  const ct = contentType ?? '';
  if (!isOpaque(ct)) return text;
  return { [DECODED]: true as const, text, content_type: ct };
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

function isDecodedWrap(value: unknown): value is { text: string; content_type: string } {
  return Boolean(value) && typeof value === 'object' && DECODED in (value as object);
}

function decodedMeta(text: string, contentType: string): { content_type: string; bytes: number; sha256: string; note: string } {
  return {
    content_type: mimeOf(contentType) || 'application/octet-stream',
    bytes: Buffer.byteLength(text),
    sha256: sha256(Buffer.from(text)),
    note: 'decoded by the https agent',
  };
}

/** Drop a secret key on a plain request object. Arrays (messages) are left whole. */
function stripSecrets(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  if (value instanceof Error || value instanceof Response || Buffer.isBuffer(value) || isOpaqueWrap(value) || isDecodedWrap(value)) return value;
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
  if (value instanceof Error) return { error: value.message };
  if (Buffer.isBuffer(value)) return opaqueMeta(value, 'application/octet-stream');
  if (isDecodedWrap(value)) return decodedMeta(value.text, value.content_type);
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

/** A failed call's row stores `{ error: <message> }`. Provider messages already carry the HTTP status and body excerpt. */
function asRaw(call: ApiCall, raw: unknown): unknown {
  if (call.ok || raw == null || raw instanceof Response || isOpaqueWrap(raw) || isDecodedWrap(raw)) return raw;
  const message = raw instanceof Error ? String((raw as any)?.message ?? raw) : (call.note ?? String((raw as any)?.message ?? raw));
  return { error: message };
}

async function write(call: ApiCall, raw: unknown, request: unknown, meta: Meta): Promise<void> {
  const requestJson = fitJson(await prepare(stripSecrets(request)));
  const rawJson = fitJson(await prepare(asRaw(call, raw)));
  await ensureTable();
  await reportdb.sql(
    `insert into evidence_call
       (report_uid, parent_report_uid, kind, step, provider, api, what, request, raw, status, ok, at, ms, model, usd, note)
     values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10, $11, $12, $13, $14, $15, $16)`,
    [
      meta.reportUid,
      meta.parentReportUid,
      meta.kind,
      meta.step,
      call.provider || call.api,
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

/** One warning per run: a new run of the report may warn again. (evidence_fail, proof only, was removed after T7's live proof.) */
export function watchRun(reportUid: string): void {
  warned.delete(runKey(reportUid));
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
