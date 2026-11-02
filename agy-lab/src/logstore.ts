// The API log: one record per request, in memory to read and on disk to keep.
//
// Two readers, two lifetimes. Debugging something that just broke wants the last
// fifty calls instantly, which is the ring buffer. Working out why an account got
// rate-limited last Tuesday wants days of history, which is a JSONL file per day
// on the volume. Neither is served by the other, so both exist.
//
// What is deliberately NOT recorded: the token. It arrives in a header, and it
// arrives in `?token=` for clients that cannot set one - so the query string is
// redacted rather than stored, because a log that leaks the credential is worse
// than no log at all.
import fs from 'node:fs';
import path from 'node:path';
import type http from 'node:http';

const HOME = process.env.HOME ?? '/data';
const DIR = path.join(HOME, 'logs');
const MEMORY = Math.max(50, Number(process.env.LOG_MEMORY ?? 1000));
/** A prompt preview makes a log worth reading. Set LOG_PROMPTS=0 where the prompts are sensitive. */
const KEEP_PROMPTS = process.env.LOG_PROMPTS !== '0';
const PROMPT_HEAD = 140;

export interface Entry {
  id: number;
  at: string;
  method: string;
  path: string;
  query?: string;
  ip?: string;
  ua?: string;
  /** Filled in by the gateway when the request reached an engine. */
  engine?: string;
  model?: string;
  stream?: boolean;
  promptChars?: number;
  promptHead?: string;
  answerChars?: number;
  /** How long it sat in the admission queue before an engine touched it. */
  queuedMs?: number;
  /** How long the engine itself took, as the engine reported it. */
  engineMs?: number;
  ms: number;
  status: number;
  error?: { type?: string; message: string };
}

let counter = 0;
const ring: Entry[] = [];
/** Open requests, so the gateway can annotate the record the server started. */
const open = new WeakMap<http.IncomingMessage, Entry & { startedAt: number }>();

let writeFailures = 0;
let lastWriteError: string | null = null;

/** Start a record. Returns it so a caller can annotate without a second lookup. */
export function begin(req: http.IncomingMessage, url: URL): Entry {
  const forwarded = (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim();
  const entry: Entry & { startedAt: number } = {
    startedAt: Date.now(),
    id: ++counter,
    at: new Date().toISOString(),
    method: req.method ?? 'GET',
    path: url.pathname,
    ...(url.search ? { query: redact(url) } : {}),
    ...(forwarded ? { ip: forwarded } : {}),
    ...(req.headers['user-agent'] ? { ua: String(req.headers['user-agent']).slice(0, 120) } : {}),
    ms: 0,
    status: 0,
  };
  open.set(req, entry);
  return entry;
}

/** Add what only the handler knows: which engine ran, how long it queued, how big the answer was. */
export function note(req: http.IncomingMessage, fields: Partial<Entry>): void {
  const entry = open.get(req);
  if (!entry) return;
  Object.assign(entry, fields);
  if (!KEEP_PROMPTS) delete entry.promptHead;
}

/** Record the prompt's size, and its head if previews are on. */
export function notePrompt(req: http.IncomingMessage, prompt: string): void {
  note(req, {
    promptChars: prompt.length,
    ...(KEEP_PROMPTS ? { promptHead: prompt.slice(0, PROMPT_HEAD) } : {}),
  });
}

export function noteError(req: http.IncomingMessage, err: { type?: string; message?: string }): void {
  note(req, { error: { ...(err.type ? { type: err.type } : {}), message: (err.message ?? 'unknown').slice(0, 400) } });
}

/** Close the record. Safe to call twice - a request that both finishes and closes is one entry. */
export function end(req: http.IncomingMessage, status: number): void {
  const entry = open.get(req);
  if (!entry) return;
  open.delete(req);
  entry.ms = Date.now() - entry.startedAt;
  entry.status = status;
  const { startedAt, ...record } = entry;
  void startedAt;
  ring.push(record);
  while (ring.length > MEMORY) ring.shift();
  append(record);
}

/** Failed writes must never take the request down: the log is the thing watching, not the thing running. */
function append(record: Entry): void {
  try {
    fs.mkdirSync(DIR, { recursive: true });
    fs.appendFile(path.join(DIR, 'api-' + record.at.slice(0, 10) + '.jsonl'), JSON.stringify(record) + '\n', (err) => {
      if (err) {
        writeFailures++;
        lastWriteError = err.message;
      }
    });
  } catch (err) {
    writeFailures++;
    lastWriteError = (err as Error).message;
  }
}

/** `?token=` is a credential wherever it appears. Everything else is kept as sent. */
function redact(url: URL): string {
  const copy = new URLSearchParams(url.search);
  for (const key of ['token', 'secret', 'password', 'key']) if (copy.has(key)) copy.set(key, '(redacted)');
  const out = copy.toString();
  return out.length > 300 ? out.slice(0, 300) + '...' : out;
}

export interface Query {
  limit?: number;
  /** Only 4xx/5xx and anything that recorded an error. */
  errorsOnly?: boolean;
  engine?: string;
  status?: number;
  /** ISO timestamp; entries at or after it. */
  since?: string;
  /** YYYY-MM-DD. Reads that day's file from the volume instead of memory. */
  date?: string;
  /** Substring match against path. */
  path?: string;
}

export function read(q: Query = {}): { source: 'memory' | 'file'; count: number; entries: Entry[]; truncated?: boolean } {
  const limit = Math.min(Math.max(1, q.limit ?? 100), 2000);
  const source: 'memory' | 'file' = q.date ? 'file' : 'memory';
  const all = q.date ? fromFile(q.date) : ring;

  const matched = all.filter((e) => {
    if (q.errorsOnly && !(e.status >= 400 || e.error)) return false;
    if (q.engine && e.engine !== q.engine) return false;
    if (q.status && e.status !== q.status) return false;
    if (q.since && e.at < q.since) return false;
    if (q.path && !e.path.includes(q.path)) return false;
    return true;
  });

  // Newest first: a log is read from the end.
  const entries = matched.slice(-limit).reverse();
  return { source, count: matched.length, entries, ...(matched.length > entries.length ? { truncated: true } : {}) };
}

function fromFile(date: string): Entry[] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('date must be YYYY-MM-DD');
  try {
    return fs
      .readFileSync(path.join(DIR, 'api-' + date + '.jsonl'), 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line) as Entry;
        } catch {
          return null;
        }
      })
      .filter((e): e is Entry => e !== null);
  } catch {
    return [];
  }
}

/** Which days are on disk, so a reader knows what they can ask for. */
export function days(): Array<{ date: string; bytes: number }> {
  try {
    return fs
      .readdirSync(DIR)
      .filter((f) => /^api-\d{4}-\d{2}-\d{2}\.jsonl$/.test(f))
      .sort()
      .reverse()
      .map((f) => ({ date: f.slice(4, 14), bytes: fs.statSync(path.join(DIR, f)).size }));
  } catch {
    return [];
  }
}

/** A one-glance count for /api/status. */
export function stats(): Record<string, unknown> {
  const byStatus: Record<string, number> = {};
  let errors = 0;
  for (const e of ring) {
    const bucket = Math.floor(e.status / 100) + 'xx';
    byStatus[bucket] = (byStatus[bucket] ?? 0) + 1;
    if (e.status >= 400 || e.error) errors++;
  }
  return {
    inMemory: ring.length,
    capacity: MEMORY,
    errors,
    byStatus,
    dir: DIR,
    days: days().length,
    ...(writeFailures ? { writeFailures, lastWriteError } : {}),
  };
}
