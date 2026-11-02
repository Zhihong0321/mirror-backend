// Web search for the pipelines: they say what to search and, at most, which
// provider they prefer; this file does the rest. It takes turns between Tavily
// and Exa while both have credits, takes a key from the provider's pool (the US
// proxy is one source in each), rests a key the way its error asks and tries
// the next, and moves to the other provider when every key of the first rests.
// A pipeline never sees a key.
import * as tavily from './tavily.ts';
import * as exa from './exa.ts';
import type { ApiCall } from '../cost.ts';

export type Provider = 'tavily' | 'exa';
export type Hit = tavily.SearchHit;

type FetchImpl = typeof fetch;

export type WebOpts = {
  /** Try this provider first; with `only`, never the other. Without it, the providers take turns. */
  provider?: Provider;
  only?: boolean;
  maxResults?: number;
  includeDomains?: string[];
  /** Tavily's search depth (advanced costs two credits). */
  depth?: 'basic' | 'advanced';
  timeoutMs?: number;
  fetchImpl?: FetchImpl;
  log?: ApiCall[];
  what?: string;
};

let turn = 0;

/** Alternate between the providers that have credits, so the two can be compared. */
export function pickGeneral(tavilyReady: boolean, exaReady: boolean): Provider | null {
  if (tavilyReady && exaReady) return turn++ % 2 === 0 ? 'tavily' : 'exa';
  return tavilyReady ? 'tavily' : exaReady ? 'exa' : null;
}

/** True while the provider (or, with none named, either one) has a usable key. */
export function available(provider?: Provider): boolean {
  if (provider === 'tavily') return tavily.available();
  if (provider === 'exa') return exa.available();
  return tavily.available() || exa.available();
}

function fail(message: string, code: string): Error {
  return Object.assign(new Error(message), { code });
}

/** One web search. Answers with the hits and the provider that gave them. */
export async function web(query: string, opts: WebOpts = {}): Promise<{ hits: Hit[]; provider: Provider }> {
  const first = opts.provider ?? pickGeneral(tavily.available(), exa.available()) ?? 'tavily';
  const order: Provider[] = opts.only ? [first] : [first, first === 'tavily' ? 'exa' : 'tavily'];
  let last: unknown = null;
  for (const provider of order) {
    try {
      const hits = provider === 'tavily'
        ? await tavily.search(query, { maxResults: opts.maxResults ?? 8, depth: opts.depth ?? 'advanced', timeoutMs: opts.timeoutMs, fetchImpl: opts.fetchImpl, log: opts.log, what: opts.what })
        : await exa.search(query, { numResults: opts.maxResults ?? 8, includeDomains: opts.includeDomains, timeoutMs: opts.timeoutMs, fetchImpl: opts.fetchImpl, log: opts.log, what: opts.what });
      return { hits, provider };
    } catch (cause) {
      const code = (cause as { code?: string }).code;
      // Only "no credit here" moves on to the other provider; any other failure is this search's answer.
      if (code !== 'quota' && code !== 'rate_limit' && code !== 'not_installed') throw cause;
      if (code !== 'not_installed' || !last) last = cause;
    }
  }
  throw last ?? fail('every Tavily and Exa key is resting', 'quota');
}

/** Reload both providers' keys now (a job start does, so a key saved on /workers is used at once). */
export async function refresh(env: NodeJS.ProcessEnv = process.env): Promise<void> {
  await Promise.all([tavily.refresh(env), exa.refresh(env)]);
}
