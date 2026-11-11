import { workerFetch } from './cloud.ts';

// A whole page, footer included: the legal name and registration number usually sit at the end.
const MAX_PAGE_CHARS = 200_000;

export type PageResult = {
  url: string;
  markdown: string;
  status: 'ok' | 'blocked' | 'error' | 'empty';
  error?: string;
  method: 'worker' | 'failed';
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

/** Read a page or PDF on a Local Gmap Worker PC, through myworker.up.railway.app (owner, 2026-11-06: every page read
 *  goes through the local worker; Exa, Tavily and Brave are for web search only). No other reader, no paid fallback. */
export async function readWebPage(url: string, maxChars = MAX_PAGE_CHARS): Promise<PageResult> {
  try {
    const { content, truncated } = await workerFetch(url);
    if (!content) return { url, markdown: '', status: 'empty', method: 'worker' };
    // A page that looks like a block page is labelled 'blocked' but kept whole: a real short page that only mentions
    // "reCAPTCHA" or "Cloudflare" must not lose its phone and address.
    if (isBlocked(content)) return { url, markdown: content.slice(0, maxChars), truncated: truncated || content.length > maxChars, status: 'blocked', method: 'worker' };
    return { url, markdown: content.slice(0, maxChars), truncated: truncated || content.length > maxChars, status: 'ok', method: 'worker' };
  } catch (err: any) {
    return { url, markdown: '', status: 'error', error: `worker: ${err.message}`, method: 'failed' };
  }
}
