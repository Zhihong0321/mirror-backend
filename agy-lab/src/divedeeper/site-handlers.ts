// V2.1 lanes share completed checks, including failures. Step 1 always takes precedence.
import { nameOf, type Ctx } from './lib.ts';
import { MY_HANDLERS } from './site-handler-catalog.ts';

export type HandlerResult = {
  handler: string; status: 'found' | 'not_found' | 'couldnt_check';
  records: unknown[]; source_url: string; excerpt: string; reason: string;
};
const checks = new WeakMap<object, Map<string, Promise<HandlerResult>>>();

function result(handler: string, raw: any): HandlerResult {
  const out: HandlerResult = { handler, status: 'couldnt_check', records: Array.isArray(raw?.records) ? raw.records : [],
    source_url: String(raw?.source_url ?? ''), excerpt: String(raw?.excerpt ?? ''), reason: '' };
  if (raw?.error || raw?.job_status === 'failed' || !['found', 'not_found'].includes(raw?.status)) {
    out.reason = String(raw?.error || raw?.reason || (raw?.job_status === 'failed' ? 'handler job failed' : `handler returned ${raw?.status ?? 'no result'}`));
  } else if (raw.status === 'found' && !out.records.length && !out.excerpt) {
    out.reason = 'handler reported a match without readable records';
  } else {
    out.status = raw.status;
    out.reason = String(raw.reason ?? '');
  }
  return out;
}

export async function lookupCompany(ctx: Ctx, dive: any, handler: string): Promise<HandlerResult> {
  if (!ctx.v21) throw new Error('site handlers require V2.1 mode');
  // Even a failed or empty Step 1 check is reused, never submitted again under another name.
  const prior = dive.v21?.lookups;
  if (prior && Object.hasOwn(prior, handler)) return report(ctx, result(handler, prior[handler]));
  let cache = checks.get(dive);
  if (!cache) { cache = new Map(); checks.set(dive, cache); }
  if (!cache.has(handler)) cache.set(handler, (async () => {
    const spec = MY_HANDLERS.find((h) => h.id === handler);
    if (!spec || spec.tier === 4) return result(handler, { reason: spec?.reason || 'no site handler exists for this check' });
    const N = nameOf(dive);
    if (!N.legal) return result(handler, { reason: 'company legal name is missing' });
    const ask = async (keyword: string) => {
      try { return result(handler, await ctx.lookup(handler, keyword)); }
      catch (err) { return result(handler, { error: err instanceof Error ? err.message : String(err) }); }
    };
    const first = await ask(N.legal);
    if (first.status !== 'not_found' || spec.legalOnly || !N.short || N.short.toLowerCase() === N.legal.toLowerCase()) return first;
    return ask(N.short);
  })());
  return report(ctx, await cache.get(handler)!);
}

function report(ctx: Ctx, out: HandlerResult): HandlerResult {
  if (out.status === 'couldnt_check') ctx.warn(`${out.handler}: can't check automatically: ${out.reason}`);
  return out;
}

export const handlerText = (out: HandlerResult): string =>
  [out.records.length ? JSON.stringify(out.records) : '', out.excerpt].filter(Boolean).join('\n');

export function skipPeople(ctx: Ctx): void {
  ctx.warn('V2.1 has no key people step yet; person searches are skipped.');
}
