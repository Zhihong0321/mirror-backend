// W / speed — Google's own verdict on the company's official websites (part 6 of the
// malaysia-deeper-dive report): Google PageSpeed Insights on each live official homepage,
// on mobile and on desktop.
//
// For each page and device: Google's four Lighthouse scores (performance, accessibility, best
// practices, SEO), the lab timings, real Chrome-user speed from the last 28 days when Google has
// enough visitors on record, Google's own top suggestions with their estimated saving, and the
// accessibility, SEO and best-practice audits the page fails outright.
//
// Auth: a Google service account (GOOGLE_PAGESPEED_SERVICE_ACCOUNT, the whole JSON; env on the
// hub, vault on this machine). A JWT signed with its key and scope "openid" buys an access token
// (the cloud-platform scope is refused, and an x-goog-user-project header gives 403).
// No LLM. No kill gates: a call that fails is retried once, then warned, and the other pages still
// report. A call takes 15-60 s, so every page and device runs at once.
import { pagespeed, type ApiCall } from '../../core/index.ts';
import { nameOf, type Ctx, type Finding } from '../lib.ts';

/** A Google access token from the service account (core/pagespeed.ts); '' on failure. */
export async function pagespeedToken(warn: (m: string) => void, log?: ApiCall[]): Promise<string> {
  return pagespeed.token(warn, log);
}

export type Psi = {
  url: string; site: string; strategy: 'mobile' | 'desktop'; ok: boolean; error?: string;
  scores?: Record<string, number>; lab?: Record<string, string>;
  field?: { scope: string; overall: string; metrics: Record<string, string> };
  fixes?: { title: string; saving: string }[]; flags?: { category: string; title: string }[];
};

/** Reads one PageSpeed Insights answer into what the report shows. */
export function readPsi(d: any, base: Pick<Psi, 'url' | 'site' | 'strategy'>): Psi {
  const lr = d.lighthouseResult;
  const a = lr.audits ?? {};
  const scores = Object.fromEntries(Object.entries(lr.categories ?? {}).map(([k, v]: [string, any]) => [k, Math.round((v.score ?? 0) * 100)]));
  const lab = Object.fromEntries([['First paint', 'first-contentful-paint'], ['Main content shown', 'largest-contentful-paint'], ['Blocked by scripts', 'total-blocking-time'], ['Layout shift', 'cumulative-layout-shift'], ['Speed index', 'speed-index']]
    .filter(([, k]) => a[k]?.displayValue).map(([n, k]) => [n, String(a[k].displayValue)]));
  const le = d.loadingExperience?.metrics ? d.loadingExperience : d.originLoadingExperience?.metrics ? d.originLoadingExperience : null;
  const metrics: Record<string, string> = {};
  for (const [n, k, unit] of [['Main content shown', 'LARGEST_CONTENTFUL_PAINT_MS', 'ms'], ['Response to a tap', 'INTERACTION_TO_NEXT_PAINT', 'ms'], ['Layout shift', 'CUMULATIVE_LAYOUT_SHIFT_SCORE', 'cls'], ['First paint', 'FIRST_CONTENTFUL_PAINT_MS', 'ms']] as const) {
    const m = le?.metrics?.[k];
    if (m) metrics[n] = `${unit === 'cls' ? (m.percentile / 100).toFixed(2) : m.percentile >= 1000 ? (m.percentile / 1000).toFixed(1) + ' s' : m.percentile + ' ms'} (${String(m.category).toLowerCase()})`;
  }
  const field = le ? { scope: le === d.loadingExperience && !le.origin_fallback ? 'this page' : 'the whole site', overall: String(le.overall_category ?? '').toLowerCase(), metrics } : undefined;
  // Google's own suggestions: failing performance audits with an estimated saving, biggest first.
  const saving = (x: any) => Number(x.details?.overallSavingsMs ?? 0) || Math.max(0, ...Object.values(x.metricSavings ?? {}).map(Number).filter(Number.isFinite));
  const perfIds: string[] = (lr.categories?.performance?.auditRefs ?? []).map((r: any) => r.id);
  const fixes = perfIds.map((id) => a[id]).filter((x: any) => x && x.score !== null && x.score < 0.9 && saving(x) > 0)
    .sort((x: any, y: any) => saving(y) - saving(x)).slice(0, 5)
    // Google writes "Est savings of 1,254 KiB" or "Root document took 1,080 ms"; the report says "saves 1,254 KiB".
    .map((x: any) => {
      const shown = String(x.displayValue ?? '');
      const est = shown.match(/^est(?:imated)? savings of (.+)$/i)?.[1];
      return { title: String(x.title), saving: est ? `saves ${est}` : shown || `saves about ${(saving(x) / 1000).toFixed(1)} s` };
    });
  const flags = ['seo', 'accessibility', 'best-practices'].flatMap((c) => (lr.categories?.[c]?.auditRefs ?? [])
    .filter((r: any) => r.weight > 0).map((r: any) => a[r.id]).filter((x: any) => x && x.score === 0 && x.scoreDisplayMode === 'binary')
    .map((x: any) => ({ category: c, title: String(x.title) }))).slice(0, 10);
  return { ...base, ok: true, scores, lab, field, fixes, flags };
}

async function pageSpeed(ctx: Ctx, url: string, site: string, strategy: 'mobile' | 'desktop', token: string): Promise<Psi> {
  try {
    return readPsi(await pagespeed.run(url, strategy, token, { log: ctx.meter.calls }), { url, site, strategy });
  } catch (e) {
    return { url, site, strategy, ok: false, error: (e as Error).message };
  }
}

export async function run(ctx: Ctx, dive: any): Promise<{ findings: Finding[]; notes: Record<string, unknown> }> {
  const N = nameOf(dive);
  const findings: Finding[] = [];
  const add = (f: Omit<Finding, 'checked_at'>) => findings.push({ ...f, checked_at: ctx.now() } as Finding);

  // ---- 1. The live official homepages, one per site a domain lands on. ----
  const homes = new Map<string, string>();
  for (const d of N.domains) {
    const p = await ctx.page(`https://${d}/`, { headers: { accept: 'text/html' } });
    if (p.status !== 200) { ctx.log(`${d}: not checked (${p.status || p.error})`); continue; }
    const host = N.hostOf(p.finalUrl || `https://${d}/`);
    if (!homes.has(host)) homes.set(host, p.finalUrl || `https://${d}/`);
  }
  if (!homes.size) { ctx.warn('no official homepage answered, so Google PageSpeed had nothing to test'); return { findings, notes: { pages: [] } }; }

  // ---- 2. Google PageSpeed Insights, every page and device at once. ----
  const token = await pagespeedToken(ctx.warn, ctx.meter.calls);
  if (!token) return { findings, notes: { pages: [] } };
  ctx.meter.other.pagespeed = 0;
  const runs = await Promise.all([...homes].flatMap(([site, url]) => (['mobile', 'desktop'] as const).map((st) => {
    ctx.meter.other.pagespeed++;
    return pageSpeed(ctx, url, site, st, token);
  })));
  for (const x of runs.filter((r) => !r.ok)) ctx.warn(`PageSpeed ${x.strategy} ${x.url}: ${x.error}`);

  // ---- 3. Findings, in Google's words. ----
  const link = (x: Psi) => `https://pagespeed.web.dev/analysis?url=${encodeURIComponent(x.url)}&form_factor=${x.strategy}`;
  for (const x of runs.filter((r) => r.ok)) {
    const sc = x.scores!;
    const perf = sc.performance ?? 0;
    const real = x.field && Object.keys(x.field.metrics).length;
    add({
      title: `Google scores your ${x.strategy === 'mobile' ? 'mobile' : 'desktop'} homepage on ${x.site} ${perf} out of 100 for speed`,
      detail: [
        `Accessibility ${sc.accessibility ?? '?'}, best practices ${sc['best-practices'] ?? '?'}, SEO ${sc.seo ?? '?'} (90 and above is good, under 50 is poor).`,
        Object.keys(x.lab!).length ? `In Google's test: ${Object.entries(x.lab!).map(([k, v]) => `${k.toLowerCase()} ${v}`).join(', ')}.` : '',
        real ? `Real Chrome visitors to ${x.field!.scope} in the last 28 days${x.field!.overall ? `, rated ${x.field!.overall}` : ''}: ${Object.entries(x.field!.metrics).map(([k, v]) => `${k.toLowerCase()} ${v}`).join(', ')}.` : 'Google has too few real visitors on record to show real-world speed.',
      ].filter(Boolean).join(' '),
      severity: perf < 50 ? (x.strategy === 'mobile' ? 'high' : 'medium') : perf < 90 ? 'medium' : 'info',
      source: link(x), check: 'psi-score', strategy: x.strategy, site: x.site, scores: sc,
    });
    if (x.field?.overall === 'slow') add({ title: `Real visitors find ${x.site} slow on ${x.strategy}`, detail: `Google's record of real Chrome visitors over the last 28 days rates ${x.field.scope} as slow: ${Object.entries(x.field.metrics).map(([k, v]) => `${k.toLowerCase()} ${v}`).join(', ')}. Google uses this in how it ranks pages.`, severity: 'high', source: link(x), check: 'psi-field', strategy: x.strategy, site: x.site });
    if (x.fixes!.length && perf < 90) add({ title: `Google's top speed fixes for ${x.site} on ${x.strategy}`, detail: x.fixes!.map((f) => `${f.title} (${f.saving})`).join('; ') + '.', severity: perf < 50 ? 'medium' : 'low', source: link(x), check: 'psi-fixes', strategy: x.strategy, site: x.site });
  }
  // Failed SEO, accessibility and best-practice checks repeat across devices; report each once per site.
  for (const site of homes.keys()) {
    const flags = [...new Map(runs.filter((r) => r.ok && r.site === site).flatMap((r) => r.flags!).map((f) => [`${f.category}|${f.title}`, f])).values()];
    const seo = flags.filter((f) => f.category === 'seo');
    const rest = flags.filter((f) => f.category !== 'seo');
    if (seo.length) add({ title: `Your homepage on ${site} fails ${seo.length} of Google's SEO checks`, detail: seo.map((f) => f.title).join('; ') + '. These are the basics Google reads to understand and list a page.', severity: 'medium', source: link(runs.find((r) => r.site === site)!), check: 'psi-seo', site });
    if (rest.length) add({ title: `Your homepage on ${site} fails ${rest.length} accessibility or best-practice checks`, detail: rest.map((f) => f.title).join('; ') + '.', severity: 'low', source: link(runs.find((r) => r.site === site)!), check: 'psi-quality', site });
  }

  return { findings, notes: { pages: runs, homes: [...homes].map(([site, url]) => ({ site, url })) } };
}
