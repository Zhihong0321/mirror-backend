// Site lookups on the Local Gmap Worker service (myworker, its /docs "Site lookup"): a catalog prompt whose site has a
// verified handler is answered by running that handler on a worker PC, instead of a Brave site: search.
// Step 1 gathers only: the handler's answer is kept as it came back, with the handler id and version that produced it.
// On unless V21_SITE_LOOKUP=off (owner, 2026-11-06).
import { envValue } from './cloud.ts';

const HUB_URL = process.env.GMAP_API_URL ?? 'https://myworker.up.railway.app';

export const siteLookupOn = (): boolean => envValue('V21_SITE_LOOKUP').trim().toLowerCase() !== 'off';

export type HandlerEntry = {
  id: string;
  country: string;
  host: string;
  question: string;
  source_url: string;
  tier: number;
  method: string;
  pdf: boolean;
  /** Global handlers only (country "ALL"): they take the website domain, not a company name. */
  input?: string;
  scope?: string;
  source_name?: string;
  why_it_matters?: string;
};

export type SiteLookupResult = {
  handler: string;
  /** sha256 of the handler file, first 12 hex: the exact script that answered. */
  version?: string;
  /** done: the handler ran (its own status may still be couldnt_check); failed: it did not run. */
  job_status: 'done' | 'failed';
  worker?: string;
  took_ms?: number;
  status?: 'found' | 'not_found' | 'couldnt_check';
  reason?: string;
  records?: unknown[];
  source_url?: string;
  excerpt?: string;
  error?: string;
};

const norm = (s: string): string => s.replace(/\s+/g, ' ').trim().toLowerCase();
const headers = (): Record<string, string> => ({
  authorization: `Bearer ${envValue('GMAP_API_KEY')}`,
  'content-type': 'application/json',
});

/** The runnable handlers (tier 1 and 2) for one country, keyed by their question. A catalog prompt is matched only by
 *  its exact question (the probe copied each prompt's question into its want), never by a guess. Empty when the
 *  service cannot be read: the caller then runs every prompt the old way. */
export async function loadHandlers(countryCode: string): Promise<Map<string, HandlerEntry>> {
  const byQuestion = new Map<string, HandlerEntry>();
  try {
    const res = await fetch(`${HUB_URL}/api/handlers?country=${encodeURIComponent(countryCode)}`, { headers: headers() });
    if (!res.ok) return byQuestion;
    const data = await res.json();
    const list: HandlerEntry[] = Array.isArray(data) ? data : (data.handlers ?? []);
    for (const h of list) if (h.tier === 1 || h.tier === 2) byQuestion.set(norm(h.question), h);
  } catch {}
  return byQuestion;
}

export function handlerFor(handlers: Map<string, HandlerEntry>, question: string): HandlerEntry | undefined {
  return handlers.get(norm(question));
}

// ---------------------------------------------------------------- global handlers (country "ALL")
// A global handler applies to every report whatever the country and takes the company's website domain as its
// keyword (DNS, SSL certificate, certificate logs, Wayback Machine, YouTube). It is not matched to a catalog prompt:
// each one runs once per report on the confirmed official domain. Off unless V21_GLOBAL_HANDLERS=on.
export const globalHandlersOn = (): boolean => envValue('V21_GLOBAL_HANDLERS').trim().toLowerCase() === 'on';

/** The runnable global handlers (tier 1 and 2), in id order. Empty when the service cannot be read. */
export async function loadGlobalHandlers(): Promise<HandlerEntry[]> {
  try {
    const res = await fetch(`${HUB_URL}/api/handlers?country=ALL`, { headers: headers() });
    if (!res.ok) return [];
    const data = await res.json();
    const list: HandlerEntry[] = Array.isArray(data) ? data : (data.handlers ?? []);
    return list.filter((h) => h && h.id && (h.tier === 1 || h.tier === 2)).sort((a, b) => a.id.localeCompare(b.id));
  } catch {
    return [];
  }
}

/** Run one handler with one name on a worker PC. Never throws: a lookup that did not run comes back failed with why. */
export async function siteLookup(handler: string, keyword: string): Promise<SiteLookupResult> {
  try {
    // Requests are held 60s at a time: the host's proxy drops a longer one.
    let res = await fetch(`${HUB_URL}/api/lookup`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ handler, keyword, wait: 60 }),
    });
    let data = await res.json();
    while (res.status === 202) {
      res = await fetch(`${HUB_URL}/api/lookup/${data.job.id}?wait=60`, { headers: headers() });
      data = await res.json();
    }
    if (!res.ok) return { handler, job_status: 'failed', error: data.error ?? `HTTP ${res.status}` };
    const job = data.job;
    const r = job.result ?? {};
    const answer = r.result ?? {};
    if (job.status !== 'done') return { handler, version: r.version, job_status: 'failed', worker: job.worker, error: job.error ?? job.status };
    return {
      handler,
      version: r.version,
      job_status: 'done',
      worker: r.worker ?? job.worker,
      took_ms: r.tookMs,
      status: answer.status,
      reason: answer.reason,
      records: Array.isArray(answer.records) ? answer.records : [],
      source_url: answer.source_url,
      excerpt: answer.excerpt,
    };
  } catch (err: any) {
    return { handler, job_status: 'failed', error: err.message };
  }
}

// ---------------------------------------------------------------- Naver Place (South Korea)
// Naver Place listings come from the KR-naver.com/w1 handler on a worker PC: the listings sit in the mobile search
// page's scripts, which a plain web.fetch drops. Every listing is kept as Naver returns it; which one is the
// company is Step 2's call. This runs whatever V21_SITE_LOOKUP says: there is no other way to read Naver.
export type NaverPlace = { id: string; name: string } & Partial<Record<
  'category' | 'address' | 'roadAddress' | 'phone' | 'virtualPhone' | 'visitorReviewCount' | 'blogCafeReviewCount', string>>;

export async function naverPlaceSearch(query: string): Promise<{ status: 'done' | 'empty' | 'failed'; places: NaverPlace[]; error?: string }> {
  const r = await siteLookup('KR-naver.com/w1', query);
  if (r.job_status !== 'done') return { status: 'failed', places: [], error: r.error };
  if (r.status === 'found') return { status: 'done', places: (r.records ?? []) as NaverPlace[] };
  if (r.status === 'not_found') return { status: 'empty', places: [] };
  return { status: 'failed', places: [], error: `couldnt_check: ${r.reason || r.excerpt || 'no reason'}` };
}
