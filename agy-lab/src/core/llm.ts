// The app's one LLM router. Every model call in the hub goes through here:
// company-dive, dive-deeper, contact research, email replies, the gateway and
// the reports behind it. No other file talks to a model (core/README.md; the
// core-door test fails the build when one does).
//
// THE LANES. A lane is one OpenAI-compatible key: url, key, model. They live in
// the llm_lane table, managed on /workers through /api/llm-lanes: today the
// Vectide coding plan, the Vectide token plan and three Hive accounts, all
// serving deepseek. While that table holds an enabled lane, CONTACT_LLM_* and
// CONTACT_LLM_HIVE_KEYS are ignored; they only serve a hub whose table is empty.
//
// THE RULES, the same for every caller:
// 1. A call asks for a model family (deepseek unless it says otherwise) and may
//    use every enabled lane serving it.
// 2. Lanes marked "use first" (a plan whose unused tokens expire, like the
//    Vectide 5-hour coding plan) take every call, however many run at once;
//    the other lanes only serve while it rests after a 429 or when it failed
//    this call. They take turns, one further along each call.
// 3. Any other lane takes at most LLM_LANE_CONCURRENCY calls at once (3). A call
//    goes to the first lane in its order with a free slot.
// 4. A 429 rests that lane (a minute; a "use first" lane 10s) and the call moves
//    to the next lane at once. Any other failure (5xx, 400, empty answer, a
//    dropped connection) also moves the call to the next lane.
// 5. When every lane failed, chat() waits and goes round again (5s, 15s, 30s,
//    60s, 120s). MiniMax (Pi) is the last resort: only after every lane failed
//    twice, never instead of a lane that would answer.
// 6. No timeout and no max_tokens of ours unless the caller passes one: answers
//    stream, so a model that is still thinking keeps the connection alive.
// 7. Every attempt is one ApiCall in the caller's log: lane, model, tokens, USD,
//    time, ok or failed, so a run shows which lane served each call.
//
// Errors carry Pi's codes (rate_limit, timeout, length, empty, failed,
// not_configured), so callers treat both engines alike.

import * as db from '../reportdb.ts';
import * as pi from './pi.ts';
import * as vault from './vault.ts';
import { startCall, type ApiCall } from '../cost.ts';

type FetchImpl = typeof fetch;

export type LlmConfig = { url: string; key: string; model: string; first?: boolean; label?: string };
export type LlmLane = LlmConfig & { id?: number; label: string; enabled: boolean };

const HIVE_URL = 'https://api.thehive.ai/api/v3';
const HIVE_MODEL = 'deepseek-ai/deepseek-v4.1-flash-1017';
const REST_MS = 60_000;
const FIRST_REST_MS = 10_000;
const LANE_CONCURRENCY = Math.max(1, Number(process.env.LLM_LANE_CONCURRENCY ?? 3) || 3);
const WAITS = [5_000, 15_000, 30_000, 60_000, 120_000];
/** MiniMax joins from this round on (0-based): every lane has failed twice by then. */
const MINIMAX_FROM_ROUND = 1;

let saved: LlmConfig[] = [];

/** Every enabled lane: the saved ones, else CONTACT_LLM_* then each Hive key. */
export function pool(env: NodeJS.ProcessEnv = process.env): LlmConfig[] {
  if (env === process.env && saved.length) return saved;
  return envPool(env);
}

function envPool(env: NodeJS.ProcessEnv): LlmConfig[] {
  const out: LlmConfig[] = [];
  const url = env.CONTACT_LLM_URL?.trim().replace(/\/+$/, '') ?? '';
  const key = env.CONTACT_LLM_KEY?.trim() ?? '';
  const model = env.CONTACT_LLM_MODEL?.trim() ?? '';
  if (url && key && model) out.push({ url, key, model });
  const hiveUrl = env.CONTACT_LLM_HIVE_URL?.trim().replace(/\/+$/, '') || HIVE_URL;
  const hiveModel = env.CONTACT_LLM_HIVE_MODEL?.trim() || HIVE_MODEL;
  for (const hiveKey of (env.CONTACT_LLM_HIVE_KEYS ?? '').split(',').map((k) => k.trim()).filter(Boolean)) {
    out.push({ url: hiveUrl, key: hiveKey, model: hiveModel });
  }
  return out.length || env !== process.env ? out : vaultLanes();
}

/** A dev machine with no hub database and no CONTACT_LLM_*: the vault's deepseek and gpt keys. */
function vaultLanes(): LlmConfig[] {
  return [['VECTIDE_DEEPSEEK_KEY', 'deepseek-v4.1-flash-1017'], ['ZM_AI_FIXED_KEY', 'gpt-6.1-sol']].flatMap(([name, model]) => {
    const c = vault.entry(name!);
    return c?.secret && c.baseUrl ? [{ url: c.baseUrl.replace(/\/+$/, ''), key: c.secret, model: model!, label: `vault ${name}` }] : [];
  });
}

/** True when a call can be answered: a lane, or MiniMax. */
export function ready(env: NodeJS.ProcessEnv = process.env): boolean {
  return pool(env).length > 0 || Boolean(pi.config(env).apiKey);
}

/** The first lane, or null when no lane is configured at all. */
export function config(env: NodeJS.ProcessEnv = process.env): LlmConfig | null {
  return pool(env)[0] ?? null;
}

async function ensureTable(): Promise<void> {
  await db.sql(`
    create table if not exists llm_lane (
      id bigserial primary key,
      label text not null default '',
      url text not null,
      api_key text not null,
      model text not null,
      enabled boolean not null default true,
      created_at timestamptz not null default now()
    );
    alter table llm_lane add column if not exists first boolean not null default false;
  `);
}

/** Every saved lane, disabled ones too, in the order calls take turns. */
export async function listLanes(): Promise<LlmLane[]> {
  await ensureTable();
  const out = await db.sql(`select id, label, url, api_key, model, enabled, first from llm_lane order by id`);
  return out.rows.map((row) => ({
    id: Number(row.id), label: String(row.label ?? ''), url: String(row.url), key: String(row.api_key),
    model: String(row.model), enabled: row.enabled !== false, first: row.first === true,
  }));
}

/** Reload the saved lanes into the pool; a hub without a database keeps CONTACT_LLM_*. */
export async function refresh(): Promise<LlmLane[]> {
  if (!db.configured()) return [];
  try {
    const lanes = await listLanes();
    const on = lanes.filter((l) => l.enabled).map(({ url, key, model, first, label }) => ({ url, key, model, first, label }));
    saved = [...on.filter((l) => l.first), ...on.filter((l) => !l.first)];
    return lanes;
  } catch (err) {
    console.error('[llm] could not load llm_lane: ' + (err as Error).message);
    return [];
  }
}

/** Replace every saved lane; incomplete rows are dropped. */
export async function replaceLanes(input: Array<Partial<LlmLane>>): Promise<LlmLane[]> {
  const clean = input.map((l) => ({
    label: String(l.label ?? '').trim(),
    url: String(l.url ?? '').trim().replace(/\/+$/, ''),
    key: String(l.key ?? '').trim(),
    model: String(l.model ?? '').trim(),
    enabled: l.enabled !== false,
    first: l.first === true,
  })).filter((l) => /^https?:\/\//.test(l.url) && l.key && l.model);
  await ensureTable();
  await db.sql(`delete from llm_lane`);
  for (const l of clean) {
    await db.sql(`insert into llm_lane (label, url, api_key, model, enabled, first) values ($1, $2, $3, $4, $5, $6)`, [l.label, l.url, l.key, l.model, l.enabled, l.first]);
  }
  return refresh();
}

// ---------------------------------------------------------------- turns, rests, slots

let turn = 0;
const restingUntil = new Map<string, number>();
const inFlight = new Map<string, number>();
let wakers: Array<() => void> = [];

/** When a lane that answered 429 may be called again, or null when it is awake. */
export function restingUntilFor(key: string): string | null {
  const until = restingUntil.get(key) ?? 0;
  return until > Date.now() ? new Date(until).toISOString() : null;
}

/** Calls a lane is serving right now. */
export function busyFor(key: string): number {
  return inFlight.get(key) ?? 0;
}

/** Test hook: forget turns, rests and slots. */
/** Tests: serve calls from these lanes as if saved on /workers; null clears them. */
export function setLanesForTests(lanes: LlmConfig[] | null): void {
  saved = lanes ?? [];
}

export function resetForTests(): void {
  saved = [];
  turn = 0;
  restingUntil.clear();
  inFlight.clear();
  wakers = [];
}

function fail(code: string, message: string): Error {
  return Object.assign(new Error(message), { code });
}

/** What the per-call log calls a lane: its label on /workers, else its host. */
export function laneName(c: LlmConfig): string {
  if (c.label) return c.label;
  try { return new URL(c.url).host; } catch { return c.url; }
}

const family = (model: string) => model.toLowerCase().split('/').pop() ?? '';
const isDeepseek = (model: string) => family(model).startsWith('deepseek');

/** The lanes that serve a model: any deepseek lane for a deepseek model, else lanes with that exact model. */
export function lanesFor(model = 'deepseek', all: LlmConfig[] = pool()): LlmConfig[] {
  return all.filter((c) => (isDeepseek(model) ? isDeepseek(c.model) : family(c.model) === family(model)));
}

/** The order one call tries lanes in: "use first" lanes, then the others from this call's turn, awake before resting. */
export function order(all: LlmConfig[] = pool()): LlmConfig[] {
  const firsts = all.filter((c) => c.first);
  const rest = all.filter((c) => !c.first);
  const start = rest.length ? turn++ : 0;
  const now = Date.now();
  const turned = [...firsts, ...rest.map((_, i) => rest[(start + i) % rest.length]!)];
  const awake = (c: LlmConfig) => (restingUntil.get(c.key) ?? 0) <= now;
  return [...turned.filter(awake), ...turned.filter((c) => !awake(c))];
}

/** A lane answered 429: calls skip it for a minute (a "use first" lane for 10s). */
export function rest(c: LlmConfig): void {
  restingUntil.set(c.key, Date.now() + (c.first ? FIRST_REST_MS : REST_MS));
}

/** The first lane in `list` with a free slot (an awake "use first" lane always has one), waiting when every lane is full. */
async function take(list: LlmConfig[]): Promise<LlmConfig> {
  for (;;) {
    const now = Date.now();
    const c = list.find((l) => (l.first && (restingUntil.get(l.key) ?? 0) <= now) || busyFor(l.key) < LANE_CONCURRENCY);
    if (c) {
      inFlight.set(c.key, busyFor(c.key) + 1);
      return c;
    }
    await new Promise<void>((resolve) => wakers.push(resolve));
  }
}

function give(c: LlmConfig): void {
  inFlight.set(c.key, Math.max(0, busyFor(c.key) - 1));
  const wake = wakers;
  wakers = [];
  for (const w of wake) w();
}

// ---------------------------------------------------------------- one request to one lane

type Message = { role: 'system' | 'user'; content: string };
type CallOpts = { temperature?: number; maxTokens?: number; timeoutMs?: number };
type Answer = { answer: string; tokensIn: number; tokensOut: number };

/**
 * One chat request, streamed: the reply is the content deltas, reasoning deltas
 * are dropped, and the usage chunk at the end gives the tokens. A server that
 * ignores stream and answers one JSON body is read the same way.
 */
async function request(c: LlmConfig, messages: Message[], opts: CallOpts, fetchImpl: FetchImpl, out: { tokensIn: number; tokensOut: number }): Promise<string> {
  let res: Response;
  try {
    res = await fetchImpl(c.url + '/chat/completions', {
      method: 'POST',
      headers: { authorization: 'Bearer ' + c.key, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: c.model,
        messages,
        temperature: opts.temperature ?? 0,
        stream: true,
        stream_options: { include_usage: true },
        ...(opts.maxTokens ? { max_tokens: opts.maxTokens } : {}),
      }),
      ...(opts.timeoutMs ? { signal: AbortSignal.timeout(opts.timeoutMs) } : {}),
    });
  } catch (cause) {
    const name = (cause as Error).name;
    if (name === 'TimeoutError' || name === 'AbortError') throw fail('timeout', `${c.model} gave no answer within ${Math.round((opts.timeoutMs ?? 0) / 1000)}s`);
    throw fail('failed', `${c.model} unreachable: ${(cause as Error).message}`);
  }
  let raw: string;
  try {
    raw = await res.text();
  } catch (cause) {
    const name = (cause as Error).name;
    throw fail(name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'failed', `${c.model} answer cut off: ${(cause as Error).message}`);
  }
  if (res.status === 429) throw fail('rate_limit', `${c.model} rate limit: 429 ${raw.slice(0, 300)}`);
  if (!res.ok) throw fail('failed', `${c.model} answered HTTP ${res.status}: ${raw.slice(0, 300)}`);
  let content = '';
  let finish = '';
  const read = (event: any) => {
    if (event?.error) throw fail('failed', `${c.model} error: ${String(event.error.message ?? JSON.stringify(event.error)).slice(0, 300)}`);
    const choice = event?.choices?.[0];
    content += choice?.delta?.content ?? choice?.message?.content ?? '';
    if (choice?.finish_reason) finish = choice.finish_reason;
    if (event?.usage) { out.tokensIn = Number(event.usage.prompt_tokens ?? 0); out.tokensOut = Number(event.usage.completion_tokens ?? 0); }
  };
  if (/^\s*data:/m.test(raw)) {
    for (const line of raw.split('\n')) {
      const data = line.trim().startsWith('data:') ? line.trim().slice(5).trim() : '';
      if (!data || data === '[DONE]') continue;
      let event: unknown;
      try { event = JSON.parse(data); } catch { continue; /* a keep-alive or partial line */ }
      read(event);
    }
  } else {
    let body: unknown;
    try { body = JSON.parse(raw); } catch { throw fail('failed', `${c.model} returned no JSON: ${raw.slice(0, 200)}`); }
    read(body);
  }
  const answer = content.trim();
  if (!answer && finish === 'length') throw fail('length', `${c.model} used its ${opts.maxTokens ?? 'default'} output tokens thinking and gave no answer.`);
  if (!answer) throw fail('empty', `${c.model} returned an empty answer`);
  return answer;
}

/** One pass over the lanes: each tried once, a free one first; the first answer wins. */
async function round(step: string, messages: Message[], lanes: LlmConfig[], opts: CallOpts, fetchImpl: FetchImpl, log?: ApiCall[]): Promise<Answer & { lane: LlmConfig }> {
  const left = order(lanes);
  let last: Error | null = null;
  const chars = messages.reduce((n, m) => n + m.content.length, 0);
  while (left.length) {
    const c = await take(left);
    left.splice(left.indexOf(c), 1);
    const call = startCall('llm', step, { model: c.model, provider: laneName(c) });
    const used = { tokensIn: 0, tokensOut: 0 };
    try {
      const answer = await request(c, messages, opts, fetchImpl, used);
      log?.push(call.done({ ok: true, ...used, note: `${chars} chars in, ${answer.length} out` }));
      return { answer, ...used, lane: c };
    } catch (err) {
      last = err as Error;
      if ((err as { code?: string }).code === 'rate_limit') rest(c);
      log?.push(call.done({ ok: false, ...(used.tokensIn || used.tokensOut ? used : {}), note: (err as Error).message.slice(0, 200) }));
    } finally {
      give(c);
    }
  }
  throw last!;
}

const toMessages = (prompt: string, system?: string): Message[] => [
  // toWellFormed: page text cut mid-emoji leaves half a surrogate pair, which Vectide rejects (HTTP 400).
  ...(system ? [{ role: 'system' as const, content: system.toWellFormed() }] : []),
  { role: 'user', content: prompt.toWellFormed() },
];

// ---------------------------------------------------------------- what callers use

export type ChatOpts = {
  /** What the call is for; it names the call in the per-call log. */
  step: string;
  /** A model family; deepseek unless given. */
  model?: string;
  system?: string;
  temperature?: number;
  /** Only callers that already capped tokens pass these; the router adds none. */
  maxTokens?: number;
  timeoutMs?: number;
  /** Every attempt is pushed here as an ApiCall. */
  log?: ApiCall[];
  /** MiniMax as the last resort; on unless false. */
  fallback?: boolean;
  fetchImpl?: FetchImpl;
};

export type ChatAnswer = { answer: string; model: string; lane: string; ms: number; tokensIn: number; tokensOut: number };

/**
 * One chat call through the router, with the full patience: every lane, then
 * rounds with growing waits, MiniMax from the second round on. Throws the last
 * error only when every lane and MiniMax failed every round.
 */
export async function chat(prompt: string, opts: ChatOpts): Promise<ChatAnswer> {
  const started = Date.now();
  const messages = toMessages(prompt, opts.system);
  const fetchImpl = opts.fetchImpl ?? fetch;
  const minimaxOn = opts.fallback !== false && Boolean(pi.config().apiKey);
  const errors: string[] = [];
  for (let r = 0; r <= WAITS.length; r++) {
    const lanes = lanesFor(opts.model ?? 'deepseek');
    if (!lanes.length && !minimaxOn) throw fail('not_configured', `no lane serves ${opts.model ?? 'deepseek'}: add one on /workers`);
    if (lanes.length) {
      try {
        const out = await round(opts.step, messages, lanes, opts, fetchImpl, opts.log);
        return { answer: out.answer, model: out.lane.model, lane: laneName(out.lane), ms: Date.now() - started, tokensIn: out.tokensIn, tokensOut: out.tokensOut };
      } catch (err) {
        errors.push((err as Error).message.slice(0, 200));
      }
    }
    if (minimaxOn && (r >= MINIMAX_FROM_ROUND || !lanes.length)) {
      try {
        const out = await minimax(prompt, opts);
        return { ...out, ms: Date.now() - started };
      } catch (err) {
        errors.push((err as Error).message.slice(0, 200));
      }
    }
    if (r < WAITS.length) await new Promise((resolve) => setTimeout(resolve, WAITS[r]));
  }
  throw fail('failed', `LLM failed at ${opts.step}: ${errors.slice(-3).join(' | ')}`);
}

async function minimax(prompt: string, opts: ChatOpts): Promise<Omit<ChatAnswer, 'ms'>> {
  const model = `pi/${pi.config().model}`;
  const call = startCall('llm', opts.step, { model, provider: 'MiniMax' });
  const used = { tokensIn: 0, tokensOut: 0 };
  try {
    const text = opts.system ? `${opts.system}\n\n${prompt}` : prompt;
    const out = await pi.ask(text, { tools: false, timeoutMs: opts.timeoutMs ?? 0, ...(opts.maxTokens ? { maxTokens: opts.maxTokens } : {}) }, used);
    opts.log?.push(call.done({ ok: true, ...used }));
    return { answer: out.answer, model, lane: 'MiniMax', tokensIn: used.tokensIn, tokensOut: used.tokensOut };
  } catch (err) {
    opts.log?.push(call.done({ ok: false, ...(used.tokensIn || used.tokensOut ? used : {}), note: (err as Error).message.slice(0, 200) }));
    throw err;
  }
}

/**
 * One pass over the lanes: for callers with their own retry and cooldown
 * (contact research, email replies). With no lane at all, MiniMax answers
 * instead. Throws the last lane's error, code intact.
 */
export async function ask(
  prompt: string,
  opts: { timeoutMs?: number; maxTokens?: number; step?: string; log?: ApiCall[]; thinking?: pi.ThinkingLevel } = {},
  cfg: LlmConfig | LlmConfig[] | null = pool(),
  fetchImpl: FetchImpl = fetch,
): Promise<{ answer: string; ms: number; model: string }> {
  const all = Array.isArray(cfg) ? cfg : cfg ? [cfg] : [];
  if (!all.length) {
    const started = Date.now();
    const out = await agent(prompt, { tools: false, step: opts.step, log: opts.log, ...(opts.timeoutMs ? { timeoutMs: opts.timeoutMs } : {}), ...(opts.maxTokens ? { maxTokens: opts.maxTokens } : {}), ...(opts.thinking ? { thinking: opts.thinking } : {}) });
    return { answer: out.answer, ms: Date.now() - started, model: `pi/${pi.config().model}` };
  }
  const started = Date.now();
  const out = await round(opts.step ?? 'ask', toMessages(prompt), all, opts, fetchImpl, opts.log);
  return { answer: out.answer, ms: Date.now() - started, model: out.lane.model };
}

/**
 * Pi on MiniMax as an agent, with web_search and web_fetch: the reports and the
 * gateway need tools, which the lanes do not offer. Logged like any call.
 */
export async function agent(prompt: string, opts: pi.AskOptions & { step?: string; log?: ApiCall[] } = {}): Promise<pi.AskOutcome> {
  const call = startCall('llm', opts.step ?? 'agent', { model: `pi/${pi.config().model}`, provider: 'MiniMax' });
  const used = { tokensIn: 0, tokensOut: 0 };
  try {
    const out = await pi.ask(prompt, opts, used);
    opts.log?.push(call.done({ ok: true, ...used }));
    return out;
  } catch (err) {
    opts.log?.push(call.done({ ok: false, ...(used.tokensIn || used.tokensOut ? used : {}), note: (err as Error).message.slice(0, 200) }));
    throw err;
  }
}

/** A lane's own account endpoint (one-api style /dashboard/billing/*), for the key health page. */
export async function laneGet(c: LlmConfig, path: string, fetchImpl: FetchImpl = fetch): Promise<unknown> {
  const res = await fetchImpl(c.url + path, { headers: { authorization: 'Bearer ' + c.key }, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`${path} answered HTTP ${res.status}`);
  return res.json();
}
