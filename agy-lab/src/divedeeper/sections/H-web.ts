// H / web — findability in web search (Brave, country MY; a stand-in for Google).
// Where do the company's own pages rank for "<trade> <area>" (one table finding), and what
// does a search for its own name show: own pages and socials, third parties, a same-trade
// company with a similar name, negatives, outdated details, no reviews at all, and dead or
// defaced own pages still in the index. Trades and areas come from H-plan.
import type { Ctx, Finding } from '../lib.ts';
import { getPlan } from './H-plan.ts';

const SOCIAL = /(^|\.)(facebook|instagram|linkedin|tiktok|youtube|x|twitter|threads)\.com$/;
const DEFACED = /\b(slot ?gacor|gacor|togel|judi online|casino online|situs slot|daftar (game|slot)|royal ?123|sbobet|maxwin|pragmatic play)\b/i;

const host = (u: string | null | undefined) => {
  try { return u ? new URL(u).hostname.replace(/^www\./, '') : ''; } catch { return ''; }
};

export async function run(ctx: Ctx, dive: any): Promise<{ findings: Finding[]; notes: Record<string, unknown> }> {
  const r = dive.result ?? {};
  const id = r.identity ?? {};
  const domains: string[] = (id.official_domains ?? []).map((d: string) => d.replace(/^www\./, ''));
  const official = (u: string) => { const h = host(u); return domains.some((d) => h === d || h.endsWith('.' + d)); };
  const shortName = String(id.aliases?.[0] ?? id.legal_name ?? dive.company);
  const brand = String(id.legal_name ?? dive.company).toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').trim().split(/\s+/)[0] ?? '';

  const plan = await getPlan(ctx, dive);
  ctx.log(`trades: ${plan.trades.join(' | ')}   areas: ${plan.areas.join(' | ')}`);
  const findings: Finding[] = [];

  // 1. Trade x area: rank of the first official-domain result in the top 20, as one finding.
  const queries = plan.trades.flatMap((t) => plan.areas.map((a) => `${t} ${a}`));
  const results = await Promise.all(queries.map(async (q) => ({ q, rows: await ctx.brave(q, { count: 20 }) })));
  const ranks = results.map(({ q, rows }) => {
    const idx = rows.findIndex((x: any) => official(x.url));
    const ahead = rows.slice(0, idx >= 0 ? idx : 5).map((x: any) => host(x.url)).filter((h: string, i: number, a: string[]) => a.indexOf(h) === i).slice(0, 4);
    if (!rows.length) ctx.warn(`no web results for "${q}"`);
    return { query: q, rank: idx >= 0 ? idx + 1 : null, of: rows.length, url: idx >= 0 ? rows[idx].url : null, ahead };
  }).filter((x) => x.of > 0);
  if (ranks.length) {
    const shown = ranks.filter((x) => x.rank);
    const best = Math.min(...shown.map((x) => x.rank!), Infinity);
    findings.push({
      title: `Your website shows in the top 20 for ${shown.length} of ${ranks.length} customer searches`,
      detail: ranks.map((x) => `"${x.query}": ${x.rank ? '#' + x.rank : 'not in top ' + x.of}${x.rank ? '' : ' (top: ' + x.ahead.join(', ') + ')'}`).join('; ') + '.',
      severity: best <= 3 ? 'info' : best <= 10 ? 'medium' : 'high',
      source: `https://search.brave.com/search?q=${encodeURIComponent(ranks[0].query)}`, checked_at: ctx.now(), shown: shown.length, of: ranks.length,
    });
  }

  // 2. A search for the company's own name, deduped by URL across the queries.
  const nameQueries = [...new Set([shortName, String(id.legal_name ?? dive.company), `${shortName} review`])];
  const nameRows: any[] = [];
  const byUrl = new Map<string, any>();
  for (const q of nameQueries) {
    const rows = await ctx.brave(q, { count: 10 });
    rows.forEach((x: any, i: number) => {
      const row = { query: q, rank: i + 1, url: x.url, title: x.title, description: String(x.description ?? '').replace(/<[^>]+>/g, ''), age: x.age ?? x.page_age ?? null, official: official(x.url), social: SOCIAL.test(host(x.url)) };
      nameRows.push(row);
      const prev = byUrl.get(x.url);
      if (prev) prev.queries.push(q); else byUrl.set(x.url, { ...row, queries: [q] });
    });
  }
  const unique = [...byUrl.values()];
  const listing = unique.map((x, i) => `${i}. [${x.queries.join(' + ')}] ${x.official ? '(OFFICIAL DOMAIN) ' : ''}${x.title} | ${x.url} | ${x.description.slice(0, 220)}${x.age ? ' | ' + x.age : ''}`).join('\n');
  const facts = (r.facts ?? []).filter((f: any) => f.confidence !== 'low').slice(0, 40).map((f: any) => '- ' + f.fact).join('\n');
  const verdict = ctx.parseJson(await ctx.llm(
    `These are web search results for searches of a company's own name. Company: ${dive.company} (${id.industry}, ${id.address}). Official domains: ${domains.join(', ')}.\nKnown facts:\n${facts}\n\nResults:\n${listing}\n\n` +
    `Classify EVERY result as one of: own (official site, or a social profile/page run by the company), reviews (a third-party page with customer reviews or ratings of THIS company), third_party_ok (accurate directory/news/listing), outdated (shows old or wrong details of this company: phone, address, name, dates), wrong_entity (a different company with a similar name), negative (complaint, bad review, scam warning about this company), irrelevant.\n` +
    `For wrong_entity also give "same_trade_my": true only if that other company is in the same trade AND in Malaysia (so a customer could confuse the two).\n` +
    `Return JSON {"items":[{"i":number,"class":string,"same_trade_my":boolean,"why":short string}],"summary":"one sentence an owner would read"}. JSON only.`,
  ));
  if (!verdict) ctx.warn('name-result classification did not parse; name findings skipped');
  const items: any[] = verdict?.items ?? [];
  const cls = (i: number) => items.find((x) => x.i === i);
  const ownCount = unique.filter((x, i) => x.official || cls(i)?.class === 'own').length;
  findings.push({ title: `${ownCount} of the ${unique.length} different results for your name are your own pages or profiles`, detail: verdict?.summary ?? '', severity: ownCount >= 3 ? 'info' : 'medium', source: `https://search.brave.com/search?q=${encodeURIComponent(shortName)}`, checked_at: ctx.now() });

  for (const [i, row] of unique.entries()) {
    const it = cls(i);
    if (!it) continue;
    // A name collision abroad, or a firm that only shares generic words ("Renovation & Construction"),
    // means nothing to a customer here: keep it only for the same trade in Malaysia AND the brand word.
    if (it.class === 'wrong_entity' && (!it.same_trade_my || !(brand.length >= 3 && (row.title + ' ' + row.url).toLowerCase().includes(brand)))) continue;
    if (!['outdated', 'wrong_entity', 'negative'].includes(it.class)) continue;
    findings.push({ title: `${it.class === 'negative' ? 'Negative result' : it.class === 'wrong_entity' ? 'A similar-named company in your trade shows up' : 'Outdated details'} when someone searches your name: ${row.title}`, detail: it.why, severity: it.class === 'negative' ? 'high' : 'medium', source: row.url, checked_at: ctx.now(), class: it.class, queries: row.queries });
  }
  const reviewHits = unique.filter((x, i) => x.queries.includes(`${shortName} review`) && cls(i)?.class === 'reviews');
  if (verdict && !reviewHits.length) findings.push({ title: `A search for "${shortName} review" shows no customer reviews of you`, detail: `None of the results for that search is a page with reviews of your company, so a customer checking you out finds nothing to reassure them.`, severity: 'medium', source: `https://search.brave.com/search?q=${encodeURIComponent(shortName + ' review')}`, checked_at: ctx.now() });

  // 3. Own-domain results that are dead or defaced.
  for (const row of unique.filter((x) => x.official)) {
    const p = await ctx.page(row.url, { headers: { accept: 'text/html,application/xhtml+xml', 'accept-language': 'en-US,en;q=0.9' } });
    const text = ctx.htmlText(p.html).slice(0, 20000);
    if (DEFACED.test(text) || DEFACED.test(p.html.match(/<title>([^<]*)/i)?.[1] ?? '')) {
      findings.push({ title: `Your website ${host(row.url)} shows gambling content`, detail: `${row.url} is listed under your name in search, but the page now serves online-gambling content ("${(text.match(DEFACED) ?? [''])[0]}"). The domain or site has likely been taken over. Fix it before customers see it.`, severity: 'high', source: row.url, checked_at: ctx.now(), class: 'defaced' });
    } else if (p.status === 404 || p.status === 410 || /<title>[^<]*(404|not found)/i.test(p.html)) {
      findings.push({ title: `Search still lists a dead page of yours: ${row.url}`, detail: `It answers ${p.status}${p.finalUrl !== row.url ? ' (redirected to ' + p.finalUrl + ')' : ''}. Customers who click it from search land on an error page.`, severity: 'medium', source: row.url, checked_at: ctx.now(), class: 'dead' });
    } else if (p.status === 0) ctx.warn(`could not fetch ${row.url}: ${p.error}`);
  }

  return { findings, notes: { plan, ranks, nameRows, unique: unique.map((x, i) => ({ ...x, class: cls(i)?.class ?? null })), classified: items } };
}
