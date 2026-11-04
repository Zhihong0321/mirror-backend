import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getCloudKeys, workerFetch } from './cloud.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../..');

function loadCrawl4AiToken(): string {
  for (const file of ['.fetch-worker.env', '.env']) {
    const envPath = path.join(root, file);
    if (!fs.existsSync(envPath)) continue;
    const m = fs.readFileSync(envPath, 'utf8').match(/^CRAWL4AI_TOKEN=(.*)/m);
    if (m && m[1]) return m[1].trim();
  }
  return process.env.CRAWL4AI_TOKEN ?? '';
}

const CRAWL4AI_URL = process.env.CRAWL4AI_URL ?? 'http://127.0.0.1:11235';
const CRAWL4AI_TOKEN = loadCrawl4AiToken();
// A whole page, footer included: the legal name and registration number usually sit at the end.
const MAX_PAGE_CHARS = 200_000;

export type PageResult = {
  url: string;
  markdown: string;
  status: 'ok' | 'blocked' | 'error' | 'empty';
  error?: string;
  method: 'worker' | 'crawl4ai' | 'tavily' | 'failed';
  /** The page was longer than the limit and was cut. */
  truncated?: boolean;
};

const BLOCKED_PATTERNS = [
  /access denied/i,
  /cloudflare/i,
  /captcha/i,
  /checking your browser/i,
  /please enable javascript/i,
  /403 forbidden/i,
  /robot or human/i,
  /ddos-guard/i,
  /please wait while your request is being verified/i,
  /being verified/i,
  /just a moment\.\.\./i,
  /security check/i,
  /verify you are human/i,
  /turnstile/i,
];

function isBlocked(text: string): boolean {
  if (text.length > 5000) return false;
  if (text.length < 200 && /loader|verif|moment/i.test(text)) return true;
  return BLOCKED_PATTERNS.some((p) => p.test(text));
}

/** Fetch a page via local Crawl4AI headless worker */
async function fetchViaCrawl4Ai(url: string): Promise<string> {
  const res = await fetch(`${CRAWL4AI_URL}/md`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${CRAWL4AI_TOKEN}`,
    },
    body: JSON.stringify({ url, f: 'raw' }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`Crawl4AI HTTP ${res.status}`);
  const data = await res.json();
  if (data.success !== true || typeof data.markdown !== 'string') {
    throw new Error(data.detail ?? 'Crawl4AI returned unsuccessful');
  }
  return data.markdown.trim();
}

/** Fallback fetch via Tavily extract */
async function fetchViaTavily(url: string): Promise<string> {
  const keys = await getCloudKeys();
  for (const key of keys.tavilyKeys) {
    try {
      const res = await fetch('https://api.tavily.com/extract', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({ urls: [url], extract_depth: 'basic' }),
        signal: AbortSignal.timeout(25_000),
      });
      if (res.status === 429 || res.status === 402) continue;
      if (!res.ok) continue;
      const data = await res.json();
      const raw = data.results?.[0]?.raw_content;
      if (typeof raw === 'string' && raw.trim()) return raw.trim();
    } catch {
      // try next key
    }
  }
  throw new Error('All Tavily keys failed for extract');
}

/** Read a page or PDF: a worker PC first, then local Crawl4AI, then Tavily */
export async function readWebPage(url: string, maxChars = MAX_PAGE_CHARS): Promise<PageResult> {
  // 1. A worker PC (pages and PDFs, whole page, no JavaScript)
  let workerErr = '';
  try {
    const { content, truncated } = await workerFetch(url);
    if (isBlocked(content)) workerErr = 'worker was blocked by interstitial/captcha';
    else if (!content) workerErr = 'worker returned empty text';
    else return { url, markdown: content.slice(0, maxChars), truncated: truncated || content.length > maxChars, status: 'ok', method: 'worker' };
  } catch (err: any) {
    workerErr = `worker: ${err.message}`;
  }

  let crawl4aiErr = workerErr;
  // 2. Try local Crawl4AI (renders JavaScript)
  try {
    const text = await fetchViaCrawl4Ai(url);
    if (isBlocked(text)) {
      crawl4aiErr = `${workerErr} | Crawl4AI was blocked by interstitial/captcha`;
    } else if (!text) {
      crawl4aiErr = `${workerErr} | Crawl4AI returned empty text`;
    } else {
      return {
        url,
        markdown: text.slice(0, maxChars),
        truncated: text.length > maxChars,
        status: 'ok',
        method: 'crawl4ai',
      };
    }
  } catch (err: any) {
    crawl4aiErr = `${workerErr} | Crawl4AI: ${err.message}`;
  }

  // 3. Try Tavily /extract fallback
  try {
    const text = await fetchViaTavily(url);
    if (!text) return { url, markdown: '', status: 'empty', method: 'tavily' };
    if (isBlocked(text)) return { url, markdown: text.slice(0, 500), status: 'blocked', method: 'tavily' };
    return {
      url,
      markdown: text.slice(0, maxChars),
        truncated: text.length > maxChars,
      status: 'ok',
      method: 'tavily',
    };
  } catch (err2: any) {
    return {
      url,
      markdown: '',
      status: 'error',
      error: `${crawl4aiErr} | Tavily: ${err2.message}`,
      method: 'failed',
    };
  }
}
