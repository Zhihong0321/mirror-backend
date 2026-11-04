import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../..');

/** A value from the repo's .env, else the environment. */
function envValue(name: string): string {
  const envPath = path.join(root, '.env');
  if (fs.existsSync(envPath)) {
    const m = fs.readFileSync(envPath, 'utf8').match(new RegExp(`^${name}=(.*)`, 'm'));
    if (m && m[1]) return m[1].trim();
  }
  return process.env[name] ?? '';
}

const LAB_TOKEN = envValue('LAB_TOKEN');
const HUB_URL = process.env.LAB_URL ?? 'https://company-diver-production.up.railway.app';

type CloudKeys = {
  braveKeys: string[];
  tavilyKeys: string[];
  exaKeys: string[];
};

type LlmLane = {
  id: number;
  label: string;
  url: string;
  key: string;
  model: string;
  enabled: boolean;
};

let cachedKeys: CloudKeys | null = null;
let keysLoadedAt = 0;
let cachedLanes: LlmLane[] = [];
let lanesLoadedAt = 0;

export async function getCloudKeys(): Promise<CloudKeys> {
  if (cachedKeys && Date.now() - keysLoadedAt < 300_000) return cachedKeys;
  const res = await fetch(`${HUB_URL}/api/gemini-contact-keys`, {
    headers: { authorization: `Bearer ${LAB_TOKEN}` },
  });
  if (!res.ok) throw new Error(`Hub keys failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  cachedKeys = {
    braveKeys: (data.braveKeys ?? []).filter(Boolean),
    tavilyKeys: (data.tavilyKeys ?? []).filter(Boolean),
    exaKeys: (data.exaKeys ?? []).filter(Boolean),
  };
  keysLoadedAt = Date.now();
  return cachedKeys;
}

export async function getLlmLanes(): Promise<LlmLane[]> {
  if (cachedLanes.length && Date.now() - lanesLoadedAt < 300_000) return cachedLanes;
  const res = await fetch(`${HUB_URL}/api/llm-lanes`, {
    headers: { authorization: `Bearer ${LAB_TOKEN}` },
  });
  if (!res.ok) throw new Error(`Hub lanes failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  cachedLanes = (data.lanes ?? []).filter((l: LlmLane) => l.enabled);
  lanesLoadedAt = Date.now();
  return cachedLanes;
}

// ---------------------------------------------------------------- Brave Search
export type BraveHit = { url: string; title: string; snippets: string[] };

const BRAVE_SUPPORTED_COUNTRIES = new Set([
  'AR', 'AU', 'AT', 'BE', 'BR', 'CA', 'CL', 'DK', 'FI', 'FR', 'DE', 'GR', 'HK', 'IN', 'ID', 'IT', 'JP', 'KR', 'MY', 'MX', 'NL', 'NZ', 'NO', 'CN', 'PL', 'PT', 'PH', 'RU', 'SA', 'ZA', 'ES', 'SE', 'CH', 'TW', 'TR', 'GB', 'US', 'ALL'
]);

export async function braveSearch(query: string, options: { count?: number; country?: string } = {}): Promise<BraveHit[]> {
  const keys = await getCloudKeys();
  const count = options.count ?? 10;
  let lastErr: Error | null = null;

  for (const key of keys.braveKeys) {
    try {
      const q = new URLSearchParams({ q: query, count: String(count) });
      if (options.country) {
        const cCode = options.country.trim().toUpperCase();
        if (BRAVE_SUPPORTED_COUNTRIES.has(cCode)) {
          q.set('country', cCode);
        }
      }
      const res = await fetch(`https://api.search.brave.com/res/v1/web/search?${q}`, {
        headers: {
          'X-Subscription-Token': key,
          Accept: 'application/json',
        },
      });
      if (res.status === 402 || res.status === 429) {
        continue; // Try next key
      }
      if (!res.ok) {
        lastErr = new Error(`Brave ${res.status}: ${(await res.text()).slice(0, 150)}`);
        continue;
      }
      const data = await res.json();
      return (data.web?.results ?? []).map((r: any) => ({
        url: String(r.url),
        title: String(r.title ?? ''),
        snippets: Array.isArray(r.description) ? r.description : r.description ? [String(r.description)] : [],
      }));
    } catch (err: any) {
      lastErr = err;
    }
  }
  throw lastErr ?? new Error(`All Brave keys failed for query: "${query}"`);
}

// ---------------------------------------------------------------- Tavily Search
export type TavilyHit = { url: string; title: string; content: string; raw_content?: string };

export async function tavilySearch(
  query: string,
  options: { max_results?: number; search_depth?: 'basic' | 'advanced'; include_raw_content?: boolean } = {},
): Promise<TavilyHit[]> {
  const keys = await getCloudKeys();
  let lastErr: Error | null = null;

  for (const key of keys.tavilyKeys) {
    try {
      const res = await fetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({
          query,
          max_results: options.max_results ?? 8,
          search_depth: options.search_depth ?? 'basic',
          include_raw_content: options.include_raw_content ?? false,
        }),
      });
      if (res.status === 429 || res.status === 402) continue;
      if (!res.ok) {
        lastErr = new Error(`Tavily ${res.status}: ${(await res.text()).slice(0, 150)}`);
        continue;
      }
      const data = await res.json();
      return (data.results ?? []).map((r: any) => ({
        url: String(r.url),
        title: String(r.title ?? ''),
        content: String(r.content ?? ''),
        raw_content: r.raw_content ? String(r.raw_content) : undefined,
      }));
    } catch (err: any) {
      lastErr = err;
    }
  }
  throw lastErr ?? new Error(`All Tavily keys failed for query: "${query}"`);
}

// ---------------------------------------------------------------- Exa Search
export type ExaHit = { url: string; title: string; text: string };

export async function exaSearch(query: string, options: { num_results?: number } = {}): Promise<ExaHit[]> {
  const keys = await getCloudKeys();
  let lastErr: Error | null = null;

  for (const key of keys.exaKeys) {
    try {
      const res = await fetch('https://api.exa.ai/search', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': key,
        },
        body: JSON.stringify({
          query,
          num_results: options.num_results ?? 6,
          contents: { text: { max_characters: 2000 } },
        }),
      });
      if (res.status === 429 || res.status === 402) continue;
      if (!res.ok) {
        lastErr = new Error(`Exa ${res.status}: ${(await res.text()).slice(0, 150)}`);
        continue;
      }
      const data = await res.json();
      return (data.results ?? []).map((r: any) => ({
        url: String(r.url),
        title: String(r.title ?? ''),
        text: String(r.text ?? ''),
      }));
    } catch (err: any) {
      lastErr = err;
    }
  }
  throw lastErr ?? new Error(`All Exa keys failed for query: "${query}"`);
}

// ---------------------------------------------------------------- DeepSeek LLM
export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };

export async function deepseekChat(
  messages: ChatMessage[],
  options: { max_tokens?: number; temperature?: number; json?: boolean } = {},
): Promise<string> {
  const lanes = await getLlmLanes();
  let lastErr: Error | null = null;

  for (const lane of lanes) {
    try {
      const body: Record<string, any> = {
        model: lane.model,
        messages,
        temperature: options.temperature ?? 0.2,
      };
      if (options.max_tokens) body.max_tokens = options.max_tokens;
      if (options.json) body.response_format = { type: 'json_object' };

      const res = await fetch(`${lane.url}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${lane.key}`,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(60_000), // 60s timeout per call (no 40-min hangs!)
      });

      if (res.status === 429 || res.status >= 500) continue; // Try next lane
      if (!res.ok) {
        lastErr = new Error(`LLM lane ${lane.label} error ${res.status}: ${(await res.text()).slice(0, 150)}`);
        continue;
      }
      const data = await res.json();
      const text = data.choices?.[0]?.message?.content;
      if (typeof text === 'string') return text.trim();
    } catch (err: any) {
      lastErr = err;
    }
  }
  throw lastErr ?? new Error('All DeepSeek cloud lanes failed or timed out');
}

// ---------------------------------------------------------------- Google Maps
const MAPS_URL = process.env.GMAP_API_URL ?? 'https://myworker.up.railway.app';
const MAPS_KEY = envValue('GMAP_API_KEY');

/** One Google Maps search on the Local Gmap Worker service (its /docs). Returns the job once it settles:
 *  status, the worker that ran it, result ({businesses, found, stoppedEarly, ...}), error. */
export async function mapsSearch(keyword: string, max = 20): Promise<{ status: string; worker?: string; result?: unknown; error?: string }> {
  const headers = { authorization: `Bearer ${MAPS_KEY}`, 'content-type': 'application/json' };
  try {
    // No worker connected: say so now, rather than wait for the service to give up.
    const health = await (await fetch(`${MAPS_URL}/health`)).json();
    if (!health.workersLive) return { status: 'failed', error: 'no Gmap worker online' };
    // Requests are held 60s at a time: the host's proxy drops a longer one ("upstream error").
    let res = await fetch(`${MAPS_URL}/api/scan`, { method: 'POST', headers, body: JSON.stringify({ keyword, max, wait: 60 }) });
    let data = await res.json();
    // 202: still running; each poll holds up to 60s. The service fails a job itself after its deadline.
    while (res.status === 202) {
      res = await fetch(`${MAPS_URL}/api/scan/${data.job.id}?wait=60`, { headers });
      data = await res.json();
    }
    if (!res.ok) return { status: 'failed', error: data.error ?? `HTTP ${res.status}` };
    const job = data.job;
    return { status: job.status, worker: job.worker, result: job.result, error: job.error ?? undefined };
  } catch (err: any) {
    return { status: 'failed', error: err.message };
  }
}
