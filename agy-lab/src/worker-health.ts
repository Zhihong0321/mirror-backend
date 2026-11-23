// GET /api/workers/health: every worker the hub knows about, in two sources, with its state and what it does.
//   source "hub":      workers that poll this hub's job queue (jobs.ts). Passive: a worker reports itself by polling.
//                       Online within 90 s, cooling while its quota group rests, offline otherwise. In memory, so a
//                       hub restart clears it until each worker polls again.
//   source "myworker": the worker PCs of the myworker service (page reads, Google Maps, ChatGPT tabs), read from its
//                       GET /api/workers. Online within 5 min (the same rule /api/tools-health uses).
// It only READS. It never stops, skips or blocks a job. A source that cannot be read is reported as unknown with its
// error; the other source is still shown.
//   GET /api/workers/health   (behind the operator token, like /api/tools-health)
import type http from 'node:http';
import * as jobs from './jobs.ts';
import { secrets } from './core/index.ts';
import { secret } from './divedeeper/lib.ts';

type Ctx = { json: (res: http.ServerResponse, status: number, body: unknown) => void };
type State = 'ok' | 'warn' | 'down' | 'unknown';
type Status = 'online' | 'cooldown' | 'offline';
type Source = 'hub' | 'myworker';

const when = (iso: string | null | undefined) => (iso ? iso.replace('T', ' ').slice(0, 16) + ' UTC' : '');
const minutesAgo = (iso: unknown, at: number): number | null => {
  const t = typeof iso === 'string' ? Date.parse(iso) : NaN;
  return Number.isFinite(t) ? Math.max(0, Math.round((at - t) / 60_000)) : null;
};

export interface WorkerRow {
  source: Source;
  name: string;
  state: State;
  status: Status;
  summary: string;
  lastSeenAt: string | null;
  secondsSinceSeen: number | null;
  ip: string | null;
  types: string[];
  taken: number;
  done: number;
  failed: number;
  cooldownGroup: string | null;
  cooldownUntil: string | null;
  cooldownReason: string | null;
}

function hubRow(w: jobs.WorkerInfo, at: number): WorkerRow {
  const seen = Date.parse(w.lastSeenAt);
  const secondsSinceSeen = Number.isFinite(seen) ? Math.max(0, Math.round((at - seen) / 1000)) : null;
  const types = Array.isArray(w.types) ? w.types : [];
  const status: Status = w.status ?? 'online';
  const state: State = status === 'offline' ? 'down' : status === 'cooldown' || types.length === 0 ? 'warn' : 'ok';
  const summary = status === 'offline'
    ? `not seen for ${secondsSinceSeen === null ? '?' : Math.round(secondsSinceSeen / 60)} min`
    : status === 'cooldown'
      ? `cooling until ${when(w.cooldownUntil)}${w.cooldownReason ? ` (${w.cooldownReason})` : ''}`
      : types.length === 0
        ? 'online, but has not declared any job type yet'
        : `online, last seen ${secondsSinceSeen ?? '?'} s ago`;
  return {
    source: 'hub', name: w.name, state, status, summary,
    lastSeenAt: w.lastSeenAt, secondsSinceSeen, ip: w.ip ?? null, types,
    taken: w.taken ?? 0, done: w.done ?? 0, failed: w.failed ?? 0,
    cooldownGroup: w.cooldownGroup ?? null, cooldownUntil: w.cooldownUntil ?? null, cooldownReason: w.cooldownReason ?? null,
  };
}

/** The myworker service's worker PCs, same reading and thresholds as /api/tools-health. Never throws. */
async function myworkerRows(at: number): Promise<{ rows: WorkerRow[]; error: string | null }> {
  try {
    await secrets.load();
    const base = (process.env.V21_DEEPER_WORKER_URL ?? process.env.GMAP_API_URL ?? 'https://myworker.up.railway.app').replace(/\/+$/, '');
    const key = secret('GMAP_API_KEY');
    if (!key) return { rows: [], error: 'GMAP_API_KEY is missing: the worker PCs cannot be read' };
    const res = await fetch(`${base}/api/workers`, { headers: { authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(15_000) });
    const text = await res.text();
    if (!res.ok) return { rows: [], error: `HTTP ${res.status}: ${text.slice(0, 160)}` };
    const parsed = JSON.parse(text);
    const list: any[] = Array.isArray(parsed?.workers) ? parsed.workers : [];
    const rows = list.map((w: any): WorkerRow => {
      const seenMin = minutesAgo(w.lastSeen, at);
      const cooling = typeof w.coolUntil === 'string' && Date.parse(w.coolUntil) > at;
      const types: string[] = Array.isArray(w.types) ? w.types.map(String) : [];
      const chat = Array.isArray(w.chatBrowsers) && w.chatBrowsers.length > 0;
      const status: Status = seenMin === null || seenMin > 5 ? 'offline' : cooling ? 'cooldown' : 'online';
      const state: State = status === 'offline' ? 'down'
        : status === 'cooldown' || types.length === 0 || (types.includes('chat.ask') && !chat) ? 'warn' : 'ok';
      const summary = [
        status === 'offline' ? `not seen for ${seenMin ?? '?'} min` : status === 'cooldown' ? `cooling until ${when(w.coolUntil)}${w.coolReason ? ` (${w.coolReason})` : ''}` : 'online',
        types.length === 0 ? 'has not declared any job type yet' : '',
        types.includes('chat.ask') ? (chat ? `ChatGPT tab ready (${w.chatBrowsers.join(', ')})` : 'takes ChatGPT jobs but has NO ChatGPT tab connected') : '',
      ].filter(Boolean).join(' · ');
      return {
        source: 'myworker', name: String(w.name ?? 'unnamed'), state, status, summary,
        lastSeenAt: typeof w.lastSeen === 'string' ? w.lastSeen : null,
        secondsSinceSeen: seenMin === null ? null : seenMin * 60, ip: null, types,
        taken: 0, done: Number(w.done ?? 0) || 0, failed: Number(w.failed ?? 0) || 0,
        cooldownGroup: null, cooldownUntil: cooling ? w.coolUntil : null, cooldownReason: cooling ? (w.coolReason ?? null) : null,
      };
    });
    return { rows, error: null };
  } catch (e) {
    return { rows: [], error: `could not read the worker PCs: ${String(e).slice(0, 200)}` };
  }
}

export async function rows() {
  const at = Date.now();
  const sources: Array<{ source: Source; ok: boolean; error: string | null }> = [];
  let hub: WorkerRow[] = [];
  try {
    const snap = jobs.snapshot();
    hub = snap.workers.map((w) => hubRow(w, at));
    sources.push({ source: 'hub', ok: true, error: null });
  } catch (e) {
    sources.push({ source: 'hub', ok: false, error: `could not read the hub's worker registry: ${String(e).slice(0, 200)}` });
  }
  const mw = await myworkerRows(at);
  sources.push({ source: 'myworker', ok: mw.error === null, error: mw.error });

  const workers = [...hub, ...mw.rows];
  const counts = { online: 0, cooldown: 0, offline: 0 };
  for (const w of workers) counts[w.status] += 1;
  // Which job types each source's workers claim, and how many are online right now.
  const byType = new Map<string, { type: string; onlineWorkers: number; totalWorkers: number }>();
  for (const w of workers) {
    for (const t of w.types) {
      const row = byType.get(t) ?? { type: t, onlineWorkers: 0, totalWorkers: 0 };
      row.totalWorkers += 1;
      if (w.status === 'online') row.onlineWorkers += 1;
      byType.set(t, row);
    }
  }
  const anySourceUnread = sources.some((s) => !s.ok);
  const overall: State = counts.online === 0 ? 'down'
    : anySourceUnread || workers.some((w) => w.state !== 'ok') ? 'warn' : 'ok';
  return {
    at: new Date(at).toISOString(),
    hubUptimeSeconds: Math.round(process.uptime()),
    overall,
    sources,
    summary: { total: workers.length, ...counts },
    types: [...byType.values()].sort((a, b) => a.type.localeCompare(b.type)),
    workers: workers.sort((a, b) => (a.source === b.source ? a.name.localeCompare(b.name) : a.source.localeCompare(b.source))),
    note: 'Hub workers are passive: they report by polling the hub, and a hub restart clears them until each polls again.',
  };
}

export async function handle(req: http.IncomingMessage, res: http.ServerResponse, url: URL, ctx: Ctx): Promise<boolean> {
  if (url.pathname !== '/api/workers/health' || req.method !== 'GET') return false;
  try {
    ctx.json(res, 200, await rows());
  } catch (e) {
    // Something failed outside the two sources: say so in the answer, never answer with nothing.
    ctx.json(res, 200, {
      at: new Date().toISOString(),
      hubUptimeSeconds: Math.round(process.uptime()),
      overall: 'unknown',
      sources: [],
      error: `could not build the worker list: ${String(e).slice(0, 200)}`,
      summary: { total: 0, online: 0, cooldown: 0, offline: 0 },
      types: [],
      workers: [],
    });
  }
  return true;
}
