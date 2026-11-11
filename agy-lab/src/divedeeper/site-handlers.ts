// V2.1 lanes share completed checks, including failures. Step 1 always takes precedence.
import { nameOf, type Ctx } from './lib.ts';
import { MY_HANDLERS } from './site-handler-catalog.ts';

export type HandlerResult = {
  handler: string; status: 'found' | 'not_found' | 'couldnt_check';
  records: unknown[]; source_url: string; excerpt: string; reason: string;
};
const checks = new WeakMap<object, Map<string, Promise<HandlerResult>>>();
/** A "not found" answer that is really the source turning the search away. */
const REFUSED = /not[_ -]?logged[_ -]?in|login[_ -]?required|log ?in to (?:continue|search|view)|sign[_ -]?in required|please (?:log|sign) ?in|captcha|access denied|unauthori[sz]ed|forbidden|rate[_ -]?limit|too many requests/i;

export function result(handler: string, raw: any): HandlerResult {
  const out: HandlerResult = { handler, status: 'couldnt_check', records: Array.isArray(raw?.records) ? raw.records : [],
    source_url: String(raw?.source_url ?? ''), excerpt: String(raw?.excerpt ?? ''), reason: '' };
  if (raw?.error || raw?.job_status === 'failed' || !['found', 'not_found'].includes(raw?.status)) {
    out.reason = String(raw?.error || raw?.reason || (raw?.job_status === 'failed' ? 'handler job failed' : `handler returned ${raw?.status ?? 'no result'}`));
  } else if (raw.status === 'found' && !out.records.length && !out.excerpt) {
    out.reason = 'handler reported a match without readable records';
  } else if (raw.status === 'not_found' && REFUSED.test(`${out.excerpt} ${raw.reason ?? ''}`)) {
    // The source refused the search (e.g. SSM's {"is_not_logged_in":true,"total":0}): nothing was searched,
    // so the claim could not be checked. It is never "not found".
    out.reason = `the source refused the search: ${out.excerpt.slice(0, 160) || String(raw.reason ?? '')}`;
  } else {
    out.status = raw.status;
    out.reason = String(raw.reason ?? '');
  }
  return out;
}

export async function lookupCompany(ctx: Ctx, dive: any, handler: string): Promise<HandlerResult> {
  if (!ctx.v21) throw new Error('site handlers require V2.1 mode');
  // Even a failed or empty Step 1 check is reused, never submitted again under another name.
  const N = nameOf(dive);
  const prior = dive.v21?.lookups;
  if (prior && Object.hasOwn(prior, handler)) return report(ctx, await readPdf(ctx, N, handler, prior[handler]));
  let cache = checks.get(dive);
  if (!cache) { cache = new Map(); checks.set(dive, cache); }
  if (!cache.has(handler)) cache.set(handler, (async () => {
    const spec = MY_HANDLERS.find((h) => h.id === handler);
    if (!spec || spec.tier === 4) return result(handler, { reason: spec?.reason || 'no site handler exists for this check' });
    if (!N.legal) return result(handler, { reason: 'company legal name is missing' });
    const ask = async (keyword: string) => {
      try { return await readPdf(ctx, N, handler, await ctx.lookup(handler, keyword)); }
      catch (err) { return result(handler, { error: err instanceof Error ? err.message : String(err) }); }
    };
    const first = await ask(N.legal);
    if (first.status !== 'not_found' || spec.legalOnly || !N.short || N.short.toLowerCase() === N.legal.toLowerCase()) return first;
    return ask(N.short);
  })());
  return report(ctx, await cache.get(handler)!);
}

/** A pdf handler answers with the list's PDF address (reason "pdf"), not a verdict: read the PDF on the worker and
 *  look for the company's name in it, as V2.1 Step 1 does with a static list. Any other answer passes through. */
async function readPdf(ctx: Ctx, N: ReturnType<typeof nameOf>, handler: string, raw: any): Promise<HandlerResult> {
  if (raw?.reason !== 'pdf' || !raw?.source_url) return result(handler, raw);
  const page = await ctx.read(String(raw.source_url));
  if (page.status < 200 || page.status >= 300 || !page.text) {
    return result(handler, { reason: `the list's PDF could not be read: ${page.error ?? 'HTTP ' + page.status}`, source_url: raw.source_url });
  }
  const text = page.text.replace(/\s+/g, ' ');
  const lower = text.toLowerCase();
  const names = [N.bare, N.short].map((x) => String(x ?? '').toLowerCase().trim()).filter((x) => x.length >= 4);
  const at = names.map((n) => lower.indexOf(n)).filter((i) => i >= 0).sort((a, b) => a - b)[0];
  if (at === undefined) return result(handler, { status: 'not_found', reason: `name not in the list (${text.length} characters read)`, source_url: raw.source_url });
  return result(handler, { status: 'found', reason: 'name found in the list', source_url: raw.source_url, excerpt: text.slice(Math.max(0, at - 300), at + 500) });
}

function report(ctx: Ctx, out: HandlerResult): HandlerResult {
  if (out.status === 'couldnt_check') ctx.warn(`${out.handler}: can't check automatically: ${out.reason}`);
  return out;
}

export const handlerText = (out: HandlerResult): string =>
  [out.records.length ? JSON.stringify(out.records) : '', out.excerpt].filter(Boolean).join('\n');

export function skipPeople(ctx: Ctx): void {
  ctx.warn('No key people were found for this company; person searches are skipped.');
}
