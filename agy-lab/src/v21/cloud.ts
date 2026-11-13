import { workerIdentification } from './worker-identification.ts';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../..');

/** A value from the repo's .env, else the environment. */
export function envValue(name: string): string {
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

export async function braveSearch(query: string, options: { count?: number; country?: string; lang?: string } = {}): Promise<BraveHit[]> {
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
      // The language of the results (Brave's search_lang, e.g. "ko"), for countries searched in their own language.
      if (options.lang) q.set('search_lang', options.lang);
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

// ---------------------------------------------------------------- Exa / Tavily US proxy
/** Where one Exa or Tavily call can go, in order: each direct hub key, then the US proxy (it holds its own 20 Exa and
 *  20 Tavily keys, rests a spent one and retries on the next) when EXA_PROXY_URL and EXA_PROXY_TOKEN are in .env. */
type Target = { url: string; headers: Record<string, string> };
function apiTargets(api: 'exa' | 'tavily', path: string, directKeys: string[]): Target[] {
  const out: Target[] = directKeys.map((key) => api === 'exa'
    ? { url: `https://api.exa.ai/${path}`, headers: { 'Content-Type': 'application/json', 'x-api-key': key } }
    : { url: `https://api.tavily.com/${path}`, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` } });
  const proxyUrl = envValue('EXA_PROXY_URL').replace(/\/+$/, '');
  const proxyToken = envValue('EXA_PROXY_TOKEN');
  if (proxyUrl && proxyToken) {
    out.push({ url: `${proxyUrl}/${api === 'tavily' ? 'tavily/' : ''}${path}`, headers: { 'Content-Type': 'application/json', 'x-proxy-token': proxyToken } });
  }
  return out;
}

// ---------------------------------------------------------------- Tavily Search
export type TavilyHit = { url: string; title: string; content: string; raw_content?: string };

export async function tavilySearch(
  query: string,
  options: { max_results?: number; search_depth?: 'basic' | 'advanced'; include_raw_content?: boolean } = {},
): Promise<TavilyHit[]> {
  const keys = await getCloudKeys();
  let lastErr: Error | null = null;

  for (const target of apiTargets('tavily', 'search', keys.tavilyKeys)) {
    try {
      const res = await fetch(target.url, {
        method: 'POST',
        headers: target.headers,
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

  for (const target of apiTargets('exa', 'search', keys.exaKeys)) {
    try {
      const res = await fetch(target.url, {
        method: 'POST',
        headers: target.headers,
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
    let res = await fetch(`${MAPS_URL}/api/scan`, { method: 'POST', headers, body: JSON.stringify({ keyword, max, ...workerIdentification('Search Google Maps'), wait: 60 }) });
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

// ---------------------------------------------------------------- Page fetch on a worker PC
/** One page or PDF read on a Local Gmap Worker PC (POST /api/fetch), whole page as markdown: the footer and
 *  menu links are what Step 1 reads the legal name and the about/contact pages from. Throws when no worker
 *  is online or the fetch failed, so the caller can fall back. A PDF reads at about 0.4 s a page. */
export async function workerFetch(url: string, format: 'markdown' | 'html' = 'markdown'): Promise<{ content: string; truncated: boolean }> {
  const health = await (await fetch(`${MAPS_URL}/health`)).json();
  if (!health.workersLive) throw new Error('no worker online');
  const headers = { authorization: `Bearer ${MAPS_KEY}`, 'content-type': 'application/json' };
  let res = await fetch(`${MAPS_URL}/api/fetch`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ url, format, mainContent: false, timeoutMs: 120_000, ...workerIdentification('Read web page'), wait: 60 }),
  });
  let data = await res.json();
  // 202: still running (a long PDF); each poll holds up to 60s, under the host's proxy limit.
  while (res.status === 202) {
    res = await fetch(`${MAPS_URL}/api/fetch/${data.job.id}?wait=60`, { headers });
    data = await res.json();
  }
  const job = data.job;
  if (!res.ok || job?.status !== 'done') throw new Error(job?.error ?? data.error ?? `HTTP ${res.status}`);
  return { content: String(job.result?.content ?? '').trim(), truncated: Boolean(job.result?.truncated) };
}

// ---------------------------------------------------------------- SEO / GEO audit on a worker PC
/** One SEO and GEO benchmark of a website on a Local Gmap Worker PC (POST /api/audit, a site.audit job): the worker
 *  crawls the site on its own connection and its report comes back unchanged (scores.seo / scores.geo, checks, pages,
 *  facts, notChecked). Never throws: an audit that did not run comes back failed with why. */
export async function workerAudit(
  url: string,
  opts: { maxPages?: number; botTest?: boolean; timeoutMs?: number } = {},
): Promise<{ status: string; job_id?: string; worker?: string; result?: unknown; error?: string }> {
  const headers = { authorization: `Bearer ${MAPS_KEY}`, 'content-type': 'application/json' };
  try {
    const health = await (await fetch(`${MAPS_URL}/health`)).json();
    if (!health.workersLive) return { status: 'failed', error: 'no worker online' };
    const body = { url, ...workerIdentification('Audit website'), maxPages: opts.maxPages ?? 5, botTest: opts.botTest ?? true, timeoutMs: opts.timeoutMs ?? 300_000, wait: 30 };
    // Requests are held 30s at a time: a 60s hold on /api/jobs came back HTTP 502 from the host's proxy (2026-11-06).
    // The service fails the job itself after its timeout (also when no worker takes site.audit jobs).
    let res = await fetch(`${MAPS_URL}/api/audit`, { method: 'POST', headers, body: JSON.stringify(body) });
    let data = await res.json();
    while (res.status === 202) {
      res = await fetch(`${MAPS_URL}/api/jobs/${data.job.id}?wait=30`, { headers });
      data = await res.json();
    }
    if (!res.ok) return { status: 'failed', job_id: data.job?.id, error: data.error ?? `HTTP ${res.status}` };
    const job = data.job;
    return { status: job.status, job_id: job.id, worker: job.worker, result: job.result, error: job.error ?? undefined };
  } catch (err: any) {
    return { status: 'failed', error: err.message };
  }
}

// ---------------------------------------------------------------- LinkedIn company page through Exa
/** One LinkedIn company page read through Exa's /contents (its own crawl, so no Cloudflare): name, headquarters,
 *  founded, industry, size, about, and website / phone / type when Exa's "Company Details" block has them (empty
 *  otherwise). Same shape as linkedinCompany's answer (result.data). Status 'not_run' when Exa has no copy of the page. */
export async function linkedinCompanyExa(url: string): Promise<{ status: string; worker?: string; result?: unknown; error?: string }> {
  let lastErr = '';
  try {
    const keys = await getCloudKeys();
    for (const target of apiTargets('exa', 'contents', keys.exaKeys)) {
      const res = await fetch(target.url, {
        method: 'POST',
        headers: target.headers,
        body: JSON.stringify({ urls: [url], text: { maxCharacters: 6000 } }),
        signal: AbortSignal.timeout(60_000),
      });
      if (res.status === 429 || res.status === 402) { lastErr = `Exa ${res.status}`; continue; }
      if (!res.ok) { lastErr = `Exa ${res.status}: ${(await res.text()).slice(0, 150)}`; continue; }
      const data: any = await res.json();
      const hit = data.results?.[0];
      if (!hit) {
        const st = data.statuses?.[0];
        return { status: 'not_run', worker: 'exa', error: `Exa has no copy of this LinkedIn page${st?.error?.tag ? ` (${st.error.tag})` : ''}` };
      }
      const text = String(hit.text ?? '');
      const props = hit.entities?.[0]?.properties ?? {};
      const hq = props.headquarters;
      const afterAbout = text.split(/^## About\s*$/m)[1] ?? '';
      const about = afterAbout.split(/^## /m)[0]!.trim();
      // The "## Company Details" block lists "- Key: value" lines (Industry, Type, Homepage, Phone ...) when Exa has them.
      const detail = (key: string) => text.match(new RegExp(`^- ${key}: (.+)$`, 'm'))?.[1]?.trim() ?? '';
      const industry = detail('Industry') || (text.match(/ is an? ([^.]+?) company\./)?.[1] ?? '');
      const data2: Record<string, string> = {
        linkedin_url: String(hit.url ?? url),
        name: String(props.name ?? hit.title ?? ''),
        website: detail('Homepage'),
        phone: detail('Phone').split(',')[0]!.trim(),
        company_type: detail('Type'),
        headquarters: hq ? [hq.city, hq.country].filter(Boolean).join(', ') : detail('Headquarters'),
        founded: props.foundedYear ? String(props.foundedYear) : '',
        industry,
        company_size: props.workforce?.total ? `${props.workforce.total} employees` : '',
        about_us: about || String(props.description ?? ''),
      };
      return { status: 'done', worker: 'exa', result: { data: data2 } };
    }
    return { status: 'failed', worker: 'exa', error: lastErr || 'no Exa key' };
  } catch (err: any) {
    return { status: 'failed', worker: 'exa', error: err.message };
  }
}

// ---------------------------------------------------------------- LinkedIn company page on a worker PC
/** One LinkedIn company page read on a Local Gmap Worker PC (POST /api/linkedin, kind company): website, phone,
 *  headquarters, founded, industry, type, size, about. The worker paces LinkedIn reads (about 60s apart) and rests
 *  them after a rate limit, so this can take a minute; the caller runs it alongside other work. */
export async function linkedinCompany(url: string): Promise<{ status: string; worker?: string; result?: unknown; error?: string }> {
  const headers = { authorization: `Bearer ${MAPS_KEY}`, 'content-type': 'application/json' };
  try {
    const health = await (await fetch(`${MAPS_URL}/health`)).json();
    if (!health.workersLive) return { status: 'failed', error: 'no worker online' };
    let res = await fetch(`${MAPS_URL}/api/linkedin`, { method: 'POST', headers, body: JSON.stringify({ kind: 'company', url, ...workerIdentification('Read LinkedIn company'), wait: 60 }) });
    let data = await res.json();
    while (res.status === 202) {
      res = await fetch(`${MAPS_URL}/api/linkedin/${data.job.id}?wait=60`, { headers });
      data = await res.json();
    }
    if (!res.ok) return { status: 'failed', error: data.error ?? `HTTP ${res.status}` };
    const job = data.job;
    return { status: job.status, worker: job.worker, result: job.result, error: job.error ?? undefined };
  } catch (err: any) {
    return { status: 'failed', error: err.message };
  }
}
