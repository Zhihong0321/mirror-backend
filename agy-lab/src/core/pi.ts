// The Pi worker: one prompt in, one answer out, run in this process through the
// Pi SDK (@earendil-works/pi-coding-agent) against MiniMax.
//
// This replaced agy (the Antigravity CLI, Gemini) after the Google accounts were
// banned. agy searched the web itself; MiniMax does not, so every run gets two
// tools of ours: web_search (Tavily, the same rotating keys contact research uses)
// and web_fetch (a plain GET of a public page, reduced to text). Pi gets no shell,
// no file tools and no project resources: it is a model with a browser, nothing more.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  createAgentSession,
  createExtensionRuntime,
  defineTool,
  ModelRuntime,
  SessionManager,
  SettingsManager,
  type ResourceLoader,
} from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import * as tavily from './tavily.ts';
import * as secrets from './secrets.ts';

export const PROVIDER = 'minimax';
export const DEFAULT_MODEL = 'MiniMax-M3.1-Flash-Preview';

export function config(env: NodeJS.ProcessEnv = process.env) {
  return {
    model: env.PI_MODEL?.trim() || DEFAULT_MODEL,
    // MiniMax-M3.1 refuses thinking "off" ("requires adaptive thinking").
    thinking: (env.PI_THINKING?.trim() || 'low') as ThinkingLevel,
    // On /workers (core/secrets.ts); MINIMAX_API_KEY only when the hub has none saved.
    apiKey: secrets.get('minimax', env),
    // Contact research takes CONTACT_LANES (3) of these; the rest stay free for
    // report rounds and translation, so a report never queues behind the backlog.
    maxConcurrent: Math.max(1, Number(env.PI_MAX_CONCURRENT ?? 6) || 6),
  };
}

export type ThinkingLevel = 'minimal' | 'low' | 'medium' | 'high';

export interface AskOptions {
  /** Default 300s; 0 means no timeout. */
  timeoutMs?: number;
  /** web_search and web_fetch. On unless a caller turns them off. */
  tools?: boolean;
  /**
   * Output cap (thinking plus answer) for one model turn; 0 leaves the model's own.
   * MiniMax ignores the thinking budget, so this is the only thing that stops a
   * run that keeps reasoning and never answers.
   */
  maxTokens?: number;
  /** Overrides PI_THINKING for this call. */
  thinking?: ThinkingLevel;
}

export interface AskOutcome {
  answer: string;
  ms: number;
  model: string;
  /** Summed over every model turn of the run (tool rounds and the nudge included); 0 when MiniMax reported none. */
  tokensIn: number;
  tokensOut: number;
}

/** What a run used, filled in by the runner as it ends, even when it fails. */
export type RunUsage = { tokensIn: number; tokensOut: number };

export interface AskError extends Error {
  /** `not_configured` | `timeout` | `rate_limit` | `length` | `empty` | `failed` — what the caller should do about it. */
  code?: string;
}

function fail(code: string, message: string): AskError {
  return Object.assign(new Error(message), { code }) as AskError;
}

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (!host.includes('.') || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) return true;
  const octets = host.split('.');
  if (octets.length !== 4 || octets.some((part) => !/^\d+$/.test(part))) return false;
  const n = octets.map(Number);
  return n[0] === 10 || n[0] === 127 || n[0] === 0 || (n[0] === 169 && n[1] === 254) ||
    (n[0] === 192 && n[1] === 168) || (n[0] === 172 && n[1]! >= 16 && n[1]! <= 31);
}

/** Visible text of an HTML page: no scripts, styles or tags, whitespace collapsed. */
export function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(br|\/p|\/div|\/li|\/tr|\/h[1-6])\b[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_m, code) => String.fromCodePoint(Number(code)))
    .replace(/[ \t\f\v\r]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim();
}

const PAGE_CHARS = 15_000;

/** Fetch a public page and return its text, capped. Throws on a private address or a failed fetch. */
export async function fetchPageText(url: string, opts: { timeoutMs?: number; maxChars?: number; fetchImpl?: typeof fetch } = {}): Promise<string> {
  let parsed: URL;
  try { parsed = new URL(url); } catch { throw new Error('not a URL: ' + url); }
  if (!/^https?:$/.test(parsed.protocol) || parsed.username || parsed.password || isPrivateHost(parsed.hostname)) {
    throw new Error('only public http(s) pages can be fetched');
  }
  const res = await (opts.fetchImpl ?? fetch)(parsed.href, {
    redirect: 'follow',
    headers: { 'user-agent': 'Mozilla/5.0 (compatible; eternalgy-research/1.0)', accept: 'text/html,text/plain,application/json;q=0.9,*/*;q=0.5' },
    signal: AbortSignal.timeout(opts.timeoutMs ?? 20_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${parsed.hostname}`);
  const type = res.headers.get('content-type') ?? '';
  if (/pdf|image|video|audio|octet-stream|zip/i.test(type)) throw new Error(`cannot read ${type || 'binary'} content`);
  const raw = await res.text();
  const text = /html|xml/i.test(type) || /^\s*</.test(raw) ? htmlToText(raw) : raw.replace(/\s+/g, ' ').trim();
  const max = opts.maxChars ?? PAGE_CHARS;
  return text.length > max ? text.slice(0, max) + `\n[truncated at ${max} characters]` : text;
}

function textResult(text: string) {
  return { content: [{ type: 'text' as const, text }], details: {} };
}

const webSearch = defineTool({
  name: 'web_search',
  label: 'Web search',
  description: 'Search the web. Returns up to 8 results, each with URL, title and a snippet. Use specific queries: the exact name in quotes plus a town or a word like "contact".',
  promptSnippet: 'web_search: search the web (Tavily)',
  parameters: Type.Object({ query: Type.String({ description: 'The search query' }) }),
  async execute(_id, params) {
    try {
      const hits = await tavily.search(params.query, { maxResults: 8, depth: 'advanced' });
      if (!hits.length) return textResult(`No results for ${params.query}`);
      return textResult(hits.map((h, i) => `${i + 1}. ${h.url}\n   ${h.title}\n   ${h.content}`).join('\n'));
    } catch (err) {
      return textResult('web_search failed: ' + ((err as Error).message ?? String(err)));
    }
  },
});

const webFetch = defineTool({
  name: 'web_fetch',
  label: 'Web fetch',
  description: 'Read a public web page. Returns the visible text of the page (up to 15,000 characters). Use it to read a page that web_search found before you cite it.',
  promptSnippet: 'web_fetch: read the text of a public web page',
  parameters: Type.Object({ url: Type.String({ description: 'The full http(s) URL' }) }),
  async execute(_id, params) {
    try {
      const text = await fetchPageText(params.url);
      return textResult(text || '(the page has no readable text)');
    } catch (err) {
      return textResult(`web_fetch failed for ${params.url}: ` + ((err as Error).message ?? String(err)));
    }
  },
});

// ---------------------------------------------------------------------------
// Running a prompt
// ---------------------------------------------------------------------------

const AGENT_DIR = path.join(process.env.HOME?.trim() || os.tmpdir(), '.pi-lab');
let runtime: Promise<ModelRuntime> | null = null;

function modelRuntime(apiKey: string): Promise<ModelRuntime> {
  runtime ??= (async () => {
    fs.mkdirSync(AGENT_DIR, { recursive: true });
    const rt = await ModelRuntime.create({ authPath: path.join(AGENT_DIR, 'auth.json'), modelsPath: path.join(AGENT_DIR, 'models.json') });
    await rt.setRuntimeApiKey(PROVIDER, apiKey);
    return rt;
  })();
  runtime.catch(() => { runtime = null; });
  return runtime;
}

function systemPrompt(tools: boolean): string {
  return [
    'You are a careful business research assistant working for a Malaysian solar company.',
    `Today is ${new Date().toISOString().slice(0, 10)}.`,
    tools
      ? 'You have two tools: web_search finds pages, web_fetch reads one. Search and read before you state a fact about a real company or person, and cite only URLs you actually retrieved.'
      : 'You have no tools. Work only from the text you are given.',
    'Follow the output format the user asks for exactly. When asked for JSON, reply with the JSON only.',
  ].join('\n');
}

function loader(tools: boolean): ResourceLoader {
  return {
    getExtensions: () => ({ extensions: [], errors: [], runtime: createExtensionRuntime() }),
    getSkills: () => ({ skills: [], diagnostics: [] }),
    getPrompts: () => ({ prompts: [], diagnostics: [] }),
    getThemes: () => ({ themes: [], diagnostics: [] }),
    getAgentsFiles: () => ({ agentsFiles: [] }),
    getSystemPrompt: () => systemPrompt(tools),
    getSystemPromptSource: () => undefined,
    getAppendSystemPrompt: () => [],
    getAppendSystemPromptSources: () => [],
    extendResources: () => {},
    reload: async () => {},
  };
}

type Runner = (prompt: string, opts: Required<AskOptions>, usage?: RunUsage) => Promise<string>;

async function runSdk(prompt: string, opts: Required<AskOptions>, usage?: RunUsage): Promise<string> {
  await secrets.load();
  const cfg = config();
  if (!cfg.apiKey) throw fail('not_configured', 'No MiniMax key (add one on /workers), so the Pi worker cannot run.');
  const rt = await modelRuntime(cfg.apiKey);
  const known = rt.getModel(PROVIDER, cfg.model);
  const base = known ?? rt.getModel(PROVIDER, 'MiniMax-M3');
  if (!base) throw fail('not_configured', `Pi has no ${PROVIDER} model catalog.`);
  const named = known ?? { ...base, id: cfg.model, name: cfg.model };
  const model = opts.maxTokens > 0 ? { ...named, maxTokens: opts.maxTokens } : named;
  const { session } = await createAgentSession({
    cwd: AGENT_DIR,
    agentDir: AGENT_DIR,
    model,
    thinkingLevel: opts.thinking,
    modelRuntime: rt,
    resourceLoader: loader(opts.tools),
    tools: opts.tools ? ['web_search', 'web_fetch'] : [],
    customTools: opts.tools ? [webSearch, webFetch] : [],
    sessionManager: SessionManager.inMemory(AGENT_DIR),
    settingsManager: SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: true, maxRetries: 2 } }),
  } as Parameters<typeof createAgentSession>[0]);
  let timer: NodeJS.Timeout | undefined;
  try {
    // timeoutMs 0 means no timeout: the run ends when the model answers.
    const timedOut = new Promise<never>((_, reject) => {
      if (opts.timeoutMs <= 0) return;
      timer = setTimeout(() => {
        void session.abort().catch(() => {});
        reject(fail('timeout', `Pi gave no answer within ${Math.round(opts.timeoutMs / 1000)}s.`));
      }, opts.timeoutMs);
    });
    const lastAssistant = () => [...session.messages].reverse().find((m) => (m as { role?: string }).role === 'assistant') as
      | { stopReason?: string; errorMessage?: string }
      | undefined;
    const checkError = () => {
      const last = lastAssistant();
      if (last?.stopReason !== 'error') return;
      const message = String(last.errorMessage ?? 'unknown error');
      if (/\b429\b|rate.?limit|too many requests|usage limit|quota/i.test(message)) throw fail('rate_limit', 'MiniMax rate limit: ' + message.slice(0, 300));
      if (/\b401\b|\b403\b|invalid.*(api.?key|token)|unauthori[sz]ed/i.test(message)) throw fail('not_configured', 'MiniMax rejected the key: ' + message.slice(0, 300));
      throw fail('failed', 'MiniMax error: ' + message.slice(0, 300));
    };
    await Promise.race([session.prompt(prompt), timedOut]);
    checkError();
    let answer = (session.getLastAssistantText() ?? '').trim();
    // The output cap ran out mid-thought. A nudge would think again under the same
    // cap; the caller decides whether a smaller prompt is worth another run.
    if (!answer && lastAssistant()?.stopReason === 'length') {
      throw fail('length', `Pi used its ${opts.maxTokens || 'full'} output tokens thinking and gave no answer.`);
    }
    // MiniMax sometimes ends a tool run on a turn that holds only thinking. One
    // nudge in the same session gets the answer it already worked out.
    if (!answer) {
      await Promise.race([session.prompt('Give your final answer now, in exactly the format asked for.'), timedOut]);
      checkError();
      answer = (session.getLastAssistantText() ?? '').trim();
    }
    if (!answer) throw fail('empty', `Pi finished without an answer (stop reason: ${lastAssistant()?.stopReason ?? 'none'}).`);
    return answer;
  } finally {
    clearTimeout(timer);
    if (usage) {
      for (const m of session.messages as Array<{ role?: string; usage?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number } }>) {
        if (m.role !== 'assistant' || !m.usage) continue;
        usage.tokensIn += (m.usage.input ?? 0) + (m.usage.cacheRead ?? 0) + (m.usage.cacheWrite ?? 0);
        usage.tokensOut += m.usage.output ?? 0;
      }
    }
    session.dispose();
  }
}

let runner: Runner = runSdk;

/** Tests swap the model call for a stub. */
export function setRunnerForTests(fn: Runner | null): void {
  runner = fn ?? runSdk;
}

let inFlight = 0;
const waiting: Array<() => void> = [];

async function withSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (inFlight >= config().maxConcurrent) await new Promise<void>((resolve) => waiting.push(resolve));
  inFlight++;
  try {
    return await fn();
  } finally {
    inFlight--;
    waiting.shift()?.();
  }
}

export function busy(): { inFlight: number; waiting: number; max: number } {
  return { inFlight, waiting: waiting.length, max: config().maxConcurrent };
}

export async function ask(prompt: string, opts: AskOptions = {}, usage: RunUsage = { tokensIn: 0, tokensOut: 0 }): Promise<AskOutcome> {
  const full: Required<AskOptions> = {
    timeoutMs: opts.timeoutMs ?? 300_000,
    tools: opts.tools !== false,
    maxTokens: Math.max(0, Math.floor(opts.maxTokens ?? 0)),
    thinking: opts.thinking ?? config().thinking,
  };
  const started = Date.now();
  return withSlot(async () => {
    const answer = await runner(prompt, full, usage);
    if (!answer) throw fail('empty', 'Pi finished without an answer.');
    return { answer, ms: Date.now() - started, model: config().model, tokensIn: usage.tokensIn, tokensOut: usage.tokensOut };
  });
}

export function status(): Record<string, unknown> {
  const cfg = config();
  return { engine: 'pi', provider: PROVIDER, model: cfg.model, configured: Boolean(cfg.apiKey), ...busy() };
}

const REMAINS_URL = 'https://api.minimax.io/v1/api/openplatform/coding_plan/remains';

/** The Token Plan's usage windows, from MiniMax itself (the key health page). */
export async function remains(fetchImpl: typeof fetch = fetch): Promise<unknown> {
  await secrets.load();
  const key = config().apiKey;
  if (!key) throw fail('not_configured', 'No MiniMax key: add one on /workers');
  const res = await fetchImpl(REMAINS_URL, { headers: { authorization: 'Bearer ' + key }, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`MiniMax answered HTTP ${res.status}`);
  return res.json();
}
