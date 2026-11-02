// The gateway: one endpoint other tools point at, with Pi behind it.
//
// Everything else in this service is a harness. This is the part that exists to
// be CONSUMED: a tool that already speaks to an LLM should be able to change a
// base URL and get Pi instead, without learning anything about this service.
//
// Hence OpenAI's chat-completions shape rather than a nicer one of our own. Not
// because it is a good API — it carries fields Pi does not have (temperature,
// max_tokens, logprobs) and a token accounting it cannot produce — but because
// every client library, agent framework and script already emits it. A shape that
// needs a new client is a shape nobody adopts. POST /api/ask is the honest native
// form for anything written against this service directly.
//
// What the OpenAI shape promises and this cannot deliver:
//   - sampling parameters. The Pi worker runs its own fixed settings. They are
//     accepted and ignored, never silently approximated.
//   - token counts. Reported as a character-based estimate and labelled as one.
//   - many completions per call (n>1). Refused rather than faked.
// Everything ignored is listed back in the response so a caller can see it was.
//
// The ChatGPT and Meta AI browser engines were removed on 2026-10-26: Cloudflare
// refused ChatGPT from the container and Meta AI was already region-blocked.
import crypto from 'node:crypto';
import type http from 'node:http';
import { llm, pi } from './core/index.ts';
import * as queue from './queue.ts';
import * as log from './logstore.ts';

export interface Ctx {
  json: (res: http.ServerResponse, status: number, body: unknown) => void;
  readJson: (req: http.IncomingMessage) => Promise<Record<string, unknown>>;
}

/**
 * Generous because Pi is slow by construction: a model that searches and reads
 * pages before it answers. A caller that wants to give up sooner passes
 * timeoutMs; nothing here is faster for being hurried.
 */
const PI_TIMEOUT_MS = Number(process.env.PI_ASK_TIMEOUT_MS ?? 300_000);

const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback);
const num = (v: unknown, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);

interface HttpError extends Error {
  status: number;
  type: string;
}

function fail(status: number, message: string, type = 'invalid_request_error'): HttpError {
  return Object.assign(new Error(message), { status, type }) as HttpError;
}

// ---------------------------------------------------------------------------
// Models
// ---------------------------------------------------------------------------

type Route = { engine: 'pi'; model: string; location: 'container' };

/**
 * Model name to engine.
 *
 * Every name this gateway has ever served still resolves, to Pi: the agy and
 * gemini names it replaced after the Google ban, and the chatgpt, gpt-*, meta and
 * llama-* names of the removed browser engines. A tool that hard-coded one of
 * them keeps working, and every response names the model that actually ran.
 */
export function resolveModel(raw: string): Route {
  let wanted = str(raw).trim();
  if (!wanted || wanted.toLowerCase() === 'auto') {
    const fallback = process.env.DEFAULT_MODEL?.trim();
    return resolveModel(!fallback || fallback.toLowerCase() === 'auto' ? 'pi' : fallback);
  }
  const at = wanted.lastIndexOf('@');
  if (at > 0) {
    const tail = wanted.slice(at + 1).toLowerCase();
    if (tail === 'mini' || tail === 'macmini') throw fail(404, 'Nothing runs on the mini through this gateway any more; use pi.', 'model_not_found');
    if (tail !== 'container' && tail !== 'cloud') throw fail(404, `Unknown location "@${tail}".`, 'model_not_found');
    wanted = wanted.slice(0, at);
  }
  const name = (wanted.split(/[:/]/)[0] ?? '').toLowerCase();
  if (
    ['pi', 'minimax', 'agy', 'antigravity', 'gemini', 'gamini', 'google'].includes(name) ||
    ['chatgpt', 'openai', 'meta', 'metaai', 'meta.ai'].includes(name) ||
    /^(gpt|o[134]|llama)/.test(name)
  ) {
    return { engine: 'pi', model: 'pi', location: 'container' };
  }
  throw fail(404, `Unknown model "${wanted}". GET /v1/models lists what this gateway serves.`, 'model_not_found');
}

function models(): Record<string, unknown> {
  return {
    object: 'list',
    data: [
      {
        id: 'pi',
        object: 'model',
        created: Math.floor(Date.now() / 1000),
        owned_by: 'agy-lab',
        engine: 'pi',
        location: 'container',
        provider: pi.PROVIDER,
        model: pi.config().model,
        ready: pi.config().apiKey !== '',
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Messages in, prompt out
// ---------------------------------------------------------------------------

/** OpenAI content is a string or an array of parts; both arrive from real clients. */
function contentText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        const p = part as { type?: string; text?: string };
        if (typeof p?.text === 'string') return p.text;
        // An image part is not an error, but Pi cannot be handed one
        // through the surface it has, so say so in place rather than drop it.
        return p?.type ? '[unsupported content part: ' + p.type + ']' : '';
      })
      .filter(Boolean)
      .join('\n');
  }
  return '';
}

/**
 * Flatten a conversation into one prompt.
 *
 * Pi does not take a message array: a run starts from one prompt. So multi-turn history has to be
 * rendered INTO the prompt, labelled, or the model reads a transcript as one
 * person talking. A single user message is passed through unlabelled, because
 * that is the common case and a "User:" prefix changes how a model answers it.
 */
export function promptFromMessages(messages: unknown): string {
  if (!Array.isArray(messages) || !messages.length) throw fail(400, 'messages must be a non-empty array.');
  const list = messages.map((m) => {
    const msg = m as { role?: unknown; content?: unknown };
    return { role: str(msg.role, 'user').toLowerCase(), text: contentText(msg.content) };
  });
  const isSystem = (role: string) => role === 'system' || role === 'developer';
  const system = list.filter((m) => isSystem(m.role)).map((m) => m.text).filter(Boolean);
  const turns = list.filter((m) => !isSystem(m.role) && m.text);
  const parts = [...system];
  if (turns.length === 1 && turns[0]!.role === 'user') parts.push(turns[0]!.text);
  else {
    for (const t of turns) {
      const label = t.role === 'assistant' ? 'Assistant' : t.role === 'tool' ? 'Tool' : 'User';
      parts.push(label + ': ' + t.text);
    }
    if (turns.length && turns[turns.length - 1]!.role !== 'assistant') parts.push('Assistant:');
  }
  const prompt = parts.join('\n\n').trim();
  if (!prompt) throw fail(400, 'messages carried no text to send.');
  return prompt;
}

/** Labelled an estimate everywhere it is returned, because ~4 chars per token is what it is. */
const estimateTokens = (text: string): number => Math.max(1, Math.ceil(text.length / 4));

/** Sampling knobs a client sent that Pi does not have. Reported, never approximated. */
const IGNORABLE = [
  'temperature',
  'top_p',
  'max_tokens',
  'max_completion_tokens',
  'presence_penalty',
  'frequency_penalty',
  'logprobs',
  'logit_bias',
  'seed',
  'stop',
  'tool_choice',
  'response_format',
];

// ---------------------------------------------------------------------------
// Running one ask
// ---------------------------------------------------------------------------

export interface AskResult {
  answer: string;
  ms: number;
  model: string;
  engine: 'pi';
  /** How long this call waited for its turn. Absent when it did not wait. */
  queuedMs?: number;
}

/**
 * Every engine call goes through the admission queue, and none goes round it.
 *
 * A burst does not make answers arrive faster - it gets the MiniMax account
 * rate-limited. See queue.ts for the three ways a call can be refused rather
 * than queued; all three surface here as a 429 with Retry-After.
 */
async function runAsk(
  route: Route,
  prompt: string,
  opts: { timeoutMs?: number; tools?: boolean; onDelta?: (chunk: string) => void; onQueued?: (info: queue.QueueInfo) => void } = {},
): Promise<AskResult> {
  const admitted = await queue
    .run(route.engine, () => engineAsk(route, prompt, opts), { onQueued: opts.onQueued })
    .catch((err: unknown) => {
      const e = err as queue.BusyError;
      if (e.status === 429) throw e;
      throw err;
    });
  const queuedMs = admitted.queuedMs;
  return { ...admitted.value, ...(queuedMs > 250 ? { queuedMs } : {}) };
}

/** Internal native call used by the durable business-intelligence orchestrator. */
export async function askModel(
  model: string,
  prompt: string,
  opts: { timeoutMs?: number; tools?: boolean } = {},
): Promise<AskResult> {
  return runAsk(resolveModel(model), prompt, opts);
}

async function engineAsk(
  route: Route,
  prompt: string,
  opts: { timeoutMs?: number; tools?: boolean; onDelta?: (chunk: string) => void } = {},
): Promise<AskResult> {
  // A missing key and a slow run are different problems with different fixes,
  // and the status code is the only part of this most clients will read.
  const out = await llm
    .agent(prompt, { timeoutMs: opts.timeoutMs ?? PI_TIMEOUT_MS, tools: true, step: 'gateway' })
    .catch((err: unknown) => {
      const e = err as { code?: string; message?: string };
      if (e.code === 'not_configured') throw fail(503, e.message ?? 'Pi is not configured.', 'engine_unavailable');
      if (e.code === 'rate_limit') throw fail(503, e.message ?? 'MiniMax is rate limiting.', 'engine_unavailable');
      if (e.code === 'timeout') throw fail(504, e.message ?? 'Pi timed out.', 'timeout');
      throw fail(502, e.message ?? 'Pi failed.', 'engine_error');
    });
  // The answer arrives whole when the run ends; there is no growing text to stream.
  opts.onDelta?.(out.answer);
  return { answer: out.answer, ms: out.ms, model: route.model, engine: 'pi' };
}

// ---------------------------------------------------------------------------
// The OpenAI shape
// ---------------------------------------------------------------------------

const completionId = (): string => 'chatcmpl-' + crypto.randomUUID().replace(/-/g, '');

function usage(prompt: string, answer: string): Record<string, unknown> {
  const prompt_tokens = estimateTokens(prompt);
  const completion_tokens = estimateTokens(answer);
  return { prompt_tokens, completion_tokens, total_tokens: prompt_tokens + completion_tokens, estimated: true };
}

function completionBody(id: string, result: AskResult, prompt: string, ignored: string[]): Record<string, unknown> {
  return {
    id,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: result.model,
    choices: [
      {
        index: 0,
        message: { role: 'assistant', content: result.answer },
        finish_reason: 'stop',
      },
    ],
    usage: usage(prompt, result.answer),
    agy_lab: {
      engine: result.engine,
      ms: result.ms,
      ...(result.queuedMs ? { queuedMs: result.queuedMs } : {}),
      ...(ignored.length ? { ignored } : {}),
    },
  };
}

function sseOpen(res: http.ServerResponse): void {
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-store',
    connection: 'keep-alive',
    // Railway's edge buffers a response it takes for a document. Without this the
    // whole stream lands at once, which is the one thing streaming exists to avoid.
    'x-accel-buffering': 'no',
  });
}

function sseSend(res: http.ServerResponse, data: unknown): void {
  res.write('data: ' + JSON.stringify(data) + '\n\n');
}

function chunkBody(
  id: string,
  model: string,
  delta: Record<string, unknown>,
  finish: string | null,
): Record<string, unknown> {
  return {
    id,
    object: 'chat.completion.chunk',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{ index: 0, delta, finish_reason: finish }],
  };
}

async function chatCompletions(req: http.IncomingMessage, res: http.ServerResponse, ctx: Ctx): Promise<void> {
  const body = await ctx.readJson(req);
  if (num(body.n, 1) !== 1) throw fail(400, 'n>1 is not supported: each call is one real model run, not a sample.');

  const route = resolveModel(str(body.model));
  const prompt = promptFromMessages(body.messages);
  const timeoutMs = num(body.timeoutMs ?? body.timeout_ms, PI_TIMEOUT_MS);
  const ignored = IGNORABLE.filter((k) => body[k] !== undefined);
  const id = completionId();
  log.note(req, { engine: route.engine, model: route.model, stream: body.stream === true });
  log.notePrompt(req, prompt);

  if (body.stream !== true) {
    const result = await runAsk(route, prompt, { timeoutMs, tools: body.tools === true });
    noteResult(req, result);
    ctx.json(res, 200, completionBody(id, result, prompt, ignored));
    return;
  }

  // Streaming. From here the status line is already sent, so an engine failure can
  // no longer be an HTTP error: it goes down the stream as a final chunk carrying
  // the reason, which is the only form a client still reading will ever see.
  sseOpen(res);
  sseSend(res, chunkBody(id, route.model, { role: 'assistant', content: '' }, null));
  let aborted = false;
  req.on('close', () => {
    aborted = true;
  });

  // A queued call can sit for a minute before the engine says anything. An SSE
  // connection that silent gets closed by an intermediary that assumes it died, so
  // the wait is narrated in comment lines - ignored by every SSE client, and
  // enough traffic to keep the socket honest.
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  const stopHeartbeat = (): void => {
    if (heartbeat) clearInterval(heartbeat);
    heartbeat = null;
  };
  try {
    const result = await runAsk(route, prompt, {
      timeoutMs,
      tools: body.tools === true,
      onQueued: (info) => {
        if (aborted) return;
        res.write(': queued ahead=' + info.ahead + ' eta=' + Math.ceil(info.estimatedWaitMs / 1000) + 's\n\n');
        heartbeat = setInterval(() => {
          if (aborted) return stopHeartbeat();
          res.write(': waiting\n\n');
        }, 15_000);
      },
      onDelta: (chunk) => {
        stopHeartbeat();
        if (!aborted && chunk) sseSend(res, chunkBody(id, route.model, { content: chunk }, null));
      },
    });
    stopHeartbeat();
    noteResult(req, result);
    if (aborted) return void res.end();
    sseSend(res, chunkBody(id, result.model, {}, 'stop'));
    sseSend(res, {
      id,
      object: 'chat.completion.chunk',
      created: Math.floor(Date.now() / 1000),
      model: result.model,
      choices: [],
      usage: usage(prompt, result.answer),
      agy_lab: {
        engine: result.engine,
        ms: result.ms,
        ...(result.queuedMs ? { queuedMs: result.queuedMs } : {}),
        ...(ignored.length ? { ignored } : {}),
      },
    });
    res.write('data: [DONE]\n\n');
    res.end();
  } catch (err: unknown) {
    stopHeartbeat();
    const e = err as HttpError & { retryAfterSec?: number; queue?: unknown };
    log.noteError(req, e);
    sseSend(res, {
      error: {
        message: e.message,
        type: e.type ?? 'engine_error',
        code: e.status ?? 502,
        ...(e.retryAfterSec ? { retry_after: e.retryAfterSec } : {}),
      },
    });
    res.write('data: [DONE]\n\n');
    res.end();
  }
}

/** One place that copies an answer's shape into the log record. */
function noteResult(req: http.IncomingMessage, result: AskResult): void {
  log.note(req, {
    engine: result.engine,
    model: result.model,
    answerChars: result.answer.length,
    engineMs: result.ms,
    ...(result.queuedMs ? { queuedMs: result.queuedMs } : {}),
  });
}

// ---------------------------------------------------------------------------
// The native shape
// ---------------------------------------------------------------------------

async function nativeAsk(req: http.IncomingMessage, res: http.ServerResponse, ctx: Ctx): Promise<void> {
  const body = await ctx.readJson(req);
  const route = resolveModel(str(body.model ?? body.engine));
  const prompt = body.messages ? promptFromMessages(body.messages) : str(body.prompt).trim();
  if (!prompt) throw fail(400, 'prompt is required (or messages).');
  log.note(req, { engine: route.engine, model: route.model });
  log.notePrompt(req, prompt);
  const result = await runAsk(route, prompt, {
    timeoutMs: num(body.timeoutMs, PI_TIMEOUT_MS),
    tools: body.tools === true,
  });
  noteResult(req, result);
  ctx.json(res, 200, {
    model: result.model,
    engine: result.engine,
    answer: result.answer,
    ms: result.ms,
    ...(result.queuedMs ? { queuedMs: result.queuedMs } : {}),
  });
}

// ---------------------------------------------------------------------------

/** Returns true when it handled the request. */
export async function handle(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url: URL,
  ctx: Ctx,
): Promise<boolean> {
  const p = url.pathname.replace(/^\/api\/v1\//, '/v1/');
  const method = req.method ?? 'GET';
  try {
    if (method === 'GET' && (p === '/v1/models' || p === '/api/models')) {
      ctx.json(res, 200, models());
      return true;
    }
    // What the queue is doing right now: running, waiting, spacing, and how much
    // of each engine's hourly allowance is gone. The thing to look at when a call
    // comes back 429 or takes a minute to start.
    if (method === 'GET' && p === '/api/queue') {
      ctx.json(res, 200, queue.snapshot());
      return true;
    }
    if (method === 'POST' && p === '/v1/chat/completions') {
      await chatCompletions(req, res, ctx);
      return true;
    }
    if (method === 'POST' && p === '/api/ask') {
      await nativeAsk(req, res, ctx);
      return true;
    }
    return false;
  } catch (err: unknown) {
    const e = err as HttpError & { retryAfterSec?: number; queue?: Record<string, unknown> };
    log.noteError(req, e);
    if (res.headersSent) {
      res.end();
      return true;
    }
    // Retry-After is the part a client can act on without reading prose, and the
    // queue snapshot is the part a human can. A 429 carries both.
    if (e.retryAfterSec) res.setHeader('retry-after', String(e.retryAfterSec));
    ctx.json(res, e.status ?? 500, {
      error: {
        message: e.message ?? String(err),
        type: e.type ?? 'server_error',
        code: e.status ?? 500,
        ...(e.retryAfterSec ? { retry_after: e.retryAfterSec } : {}),
      },
      ...(e.queue ? { queue: e.queue } : {}),
    });
    return true;
  }
}
