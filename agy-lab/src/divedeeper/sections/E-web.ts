// E / web — customer feedback from the open web (no Maps).
//
// Exa + Brave searches for reviews, complaints and mentions of the company on Facebook,
// forums (Lowyat, Reddit), review sites, complaint sites and directories. Results are
// kept only when they name the company (exact name or alias, which drops the "Eternal…"
// noise the company-dive picked up). Page text comes from Exa's contents, or a direct
// page read for Brave-only hits. The LLM extracts each review/complaint/testimonial
// mention with a verbatim quote; a quote that cannot be found in the page text is
// marked unverified and not reported as a finding.
//
// Own-channel posts (the company's own site or Facebook page) are kept apart: they answer
// "are good reviews reused on the website / social media", not "what customers say".
import type { Ctx, Finding } from '../lib.ts';

const EXA_TEXT = 4000;      // characters of page text per Exa result
const PAGE_TEXT = 4000;     // characters of page text sent to the LLM per page
const MAX_PAGE_READS = 15;  // direct reads for Brave-only hits

const host = (u: string | null | undefined) => {
  try { return u ? new URL(u.startsWith('http') ? u : 'https://' + u).hostname.replace(/^www\.|^m\.|^mobile\./, '') : ''; } catch { return ''; }
};
const flat = (s: string) => s.toLowerCase().replace(/[\s ]+/g, ' ').replace(/[“”"‘’'`]/g, '').replace(/[^a-z0-9一-鿿 ]+/g, ' ').replace(/ +/g, ' ').trim();
const clip = (s: string, n = 160) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
const canon = (u: string) => { try { const x = new URL(u); x.hash = ''; ['fbclid', 'utm_source', 'utm_medium', 'utm_campaign', 'mibextid'].forEach((k) => x.searchParams.delete(k)); return x.href.replace(/\/$/, ''); } catch { return u; } };

type Hit = { url: string; title: string; snippet: string; text: string; via: string[]; date: string | null };

export async function run(ctx: Ctx, dive: any): Promise<{ findings: Finding[]; notes: Record<string, unknown> }> {
  const r = dive.result ?? {};
  const id = r.identity ?? {};
  const brand = String(id.aliases?.find((a: string) => /^[A-Za-z]/.test(a) && !/sdn|bhd/i.test(a)) ?? dive.company).trim(); // "Eternalgy"
  const legal = String(id.legal_name ?? dive.company);
  const cjk = (id.aliases ?? []).filter((a: string) => /[一-鿿]/.test(a));
  const nameRe = new RegExp([brand, ...cjk].map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'i');
  const ownHosts = new Set<string>((id.official_domains ?? []).map((d: string) => d.replace(/^www\./, '')));
  const ownFb = (r.sources ?? []).map((s: any) => String(s.url)).filter((u: string) => /facebook\.com\/(eternalgy|p\/Eternalgy)/i.test(u)); // not used for matching, just notes
  const isOwn = (u: string) => {
    const h = host(u);
    if ([...ownHosts].some((d) => h === d || h.endsWith('.' + d))) return 'website';
    const slug = brand.toLowerCase();
    if (/facebook\.com$/.test(h) && new RegExp(`facebook\\.com/(${slug}|p/${slug})`, 'i').test(u)) return 'facebook';
    if (/(instagram|tiktok|youtube|x|twitter|linkedin|xiaohongshu)\.com$/.test(h) && u.toLowerCase().includes(slug)) return 'social';
    return null;
  };

  // 1. Searches. Brave is cheap and broad; Exa adds page text and finds forum/FB posts.
  const braveQ = [
    `"${brand}" review`,
    `"${brand}" solar review Malaysia`,
    `"${brand}" complaint OR scam OR problem`,
    `"${brand}" lowyat`,
    `"${brand}" reddit`,
    `"${brand}" facebook review recommend`,
    `"${legal}" reviews`,
    `"${brand}" solar experience installer`,
    `"${brand}" testimonial`,
    `"${brand}" ulasan solar`,
    ...cjk.map((c: string) => `"${c}" solar 评价`),
    `"${brand}" roof leak solar`,
  ].slice(0, 15);
  const exaQ: { q: string; o: any }[] = [
    { q: `${brand} solar Malaysia customer review`, o: {} },
    { q: `${brand} Sdn Bhd solar installer complaint`, o: {} },
    { q: `${brand} solar installer experience`, o: { includeDomains: ['forum.lowyat.net', 'reddit.com', 'cari.com.my'] } },
    { q: `${brand} solar`, o: { includeDomains: ['facebook.com'] } },
    { q: `${brand} solar review rating`, o: { includeDomains: ['solar100.com.my', 'solardir.com', 'trustpilot.com', 'homebagus.com', 'newpages.com.my', 'recommend.my', 'iprice.my'] } },
    { q: `Is ${brand} solar reliable? recommendations for solar installer in Johor`, o: {} },
  ].slice(0, 15);

  const hits = new Map<string, Hit>();
  const addHit = (url: string, title: string, snippet: string, text: string, via: string, date: string | null) => {
    if (!url) return;
    const k = canon(url);
    const h = hits.get(k) ?? { url: k, title: '', snippet: '', text: '', via: [], date: null };
    h.title ||= title; h.snippet ||= snippet; if (text.length > h.text.length) h.text = text; h.via.push(via); h.date ||= date;
    hits.set(k, h);
  };
  const searchLog: any[] = [];
  await Promise.all([
    ...braveQ.map(async (q) => {
      const res = await ctx.brave(q, { count: 20 });
      searchLog.push({ engine: 'brave', q, n: res.length });
      for (const x of res) addHit(x.url, ctx.htmlText(String(x.title ?? '')), ctx.htmlText([x.description, ...(x.extra_snippets ?? [])].filter(Boolean).join(' … ')), '', 'brave', x.page_age ?? x.age ?? null);
    }),
    ...exaQ.map(async ({ q, o }) => {
      const res = await ctx.exa(q, { numResults: 10, text: EXA_TEXT, ...o });
      searchLog.push({ engine: 'exa', q, n: res.length, domains: o.includeDomains ?? null });
      for (const x of res) addHit(x.url, String(x.title ?? ''), '', String(x.text ?? ''), 'exa', x.publishedDate ?? null);
    }),
  ]);
  ctx.log(`${hits.size} unique URLs from ${braveQ.length} Brave + ${exaQ.length} Exa searches`);

  // 2. Keep only results that name the company.
  const named = [...hits.values()].filter((h) => nameRe.test(h.title + ' ' + h.snippet + ' ' + h.text));
  ctx.log(`${named.length} name the company`);

  // 3. Page text for Brave-only hits (Facebook needs a login, so its snippet is all we get).
  // Own-channel pages are skipped: in testing the reads went on eternalgy.com/admin and an invoice link.
  let reads = 0;
  for (const h of named) {
    if (h.text.length > 400 || isOwn(h.url)) continue;
    if (/facebook\.com|instagram\.com|tiktok\.com|xiaohongshu\.com/.test(host(h.url))) continue;
    if (reads >= MAX_PAGE_READS) break;
    reads++;
    const p = await ctx.page(h.url);
    if (p.html && p.status < 400) h.text = ctx.htmlText(p.html);
    else ctx.warn(`page read ${h.url}: ${p.error ?? p.status}`);
  }

  // 4. LLM extraction, in batches of pages; every quote must be verbatim.
  type Mention = { url: string; platform: string; kind: string; stance: string; author: string | null; date: string | null; rating: number | null; quote: string; about_company: boolean; verified?: boolean; own_channel?: string | null };
  const mentions: Mention[] = [];
  const docs = named.map((h, i) => {
    const body = (h.text || h.snippet);
    // Centre the excerpt on the first name match so long pages keep the relevant part.
    const m = body.search(nameRe);
    const start = Math.max(0, (m < 0 ? 0 : m) - 600);
    return { i, url: h.url, title: h.title, snippet: h.snippet, excerpt: body.slice(start, start + PAGE_TEXT) };
  });
  for (let b = 0; b < docs.length; b += 8) {
    const batch = docs.slice(b, b + 8);
    const ans = ctx.parseJson(await ctx.llm(
      `We audit what the public says about the company "${legal}" (brand "${brand}"${cjk.length ? ', Chinese name ' + cjk.join('/') : ''}), a ${id.industry ?? 'company'} based at ${id.address ?? 'Malaysia'}.\n` +
      `For each document below, extract every CUSTOMER REVIEW, COMPLAINT, RATING or TESTIMONIAL about this exact company (not about another company with a similar name, and not general solar advice). ` +
      `Company marketing copy is not a review, but a customer testimonial or a review the company reposts IS one (mark kind "testimonial").\n\n` +
      `Documents (JSON):\n${JSON.stringify(batch)}\n\n` +
      `Return JSON only: {"mentions":[{"doc":i,"platform":"facebook|lowyat|reddit|review site|directory|news|blog|other","kind":"review|complaint|rating|testimonial|forum_mention",` +
      `"stance":"positive|negative|mixed|neutral","author":"name or null","date":"as written or null","rating":number or null,` +
      `"quote":"VERBATIM words copied from the document, max 300 characters","about_company":true}]}\n` +
      `Copy quotes exactly; never paraphrase or translate inside "quote". If a document has nothing, give it no mention.`,
    ));
    if (!ans) { ctx.warn(`extraction batch ${b / 8 + 1}: the LLM answer did not parse; batch skipped`); continue; }
    for (const m of ans.mentions ?? []) {
      const d = batch.find((x) => x.i === m.doc);
      if (!d || !m.quote) continue;
      const src = named[d.i];
      const hay = flat(src.title + ' ' + src.snippet + ' ' + src.text);
      const q = flat(String(m.quote)).replace(/ ?\.\.\.? ?|…/g, ' ').trim();
      // Verified when the quote (or each of its halves, if the model joined two pieces) is on the page.
      const parts = q.length > 60 ? [q.slice(0, Math.floor(q.length / 2)), q.slice(Math.floor(q.length / 2))].map((s) => s.trim().split(' ').slice(1, -1).join(' ')) : [q];
      const verified = parts.every((p) => p.length < 8 || hay.includes(p));
      mentions.push({ url: src.url, platform: m.platform ?? 'other', kind: m.kind ?? 'review', stance: m.stance ?? 'neutral', author: m.author ?? null, date: m.date ?? null, rating: typeof m.rating === 'number' ? m.rating : null, quote: String(m.quote), about_company: m.about_company !== false, verified, own_channel: isOwn(src.url) });
    }
  }
  const good = mentions.filter((m) => m.about_company && m.verified);
  ctx.log(`${mentions.length} mentions extracted, ${good.length} verified and about the company`);

  // 5. Findings.
  const findings: Finding[] = [];
  const add = (f: Omit<Finding, 'checked_at'>) => findings.push({ ...f, checked_at: ctx.now() });
  const third = good.filter((m) => !m.own_channel);
  const own = good.filter((m) => m.own_channel);

  for (const m of third.filter((m) => m.stance === 'negative' || m.stance === 'mixed' || m.kind === 'complaint')) add({
    title: `${m.stance === 'mixed' ? 'Mixed' : 'Negative'} ${m.kind} on ${host(m.url)}${m.date ? ` (${m.date})` : ''}`,
    detail: `${m.author ? m.author + ': ' : ''}"${clip(m.quote, 280)}"`, severity: 'high', source: m.url, evidence: m.quote, platform: m.platform,
  });
  // Ratings one by one (a stale count on a directory is itself worth showing); positive
  // reviews grouped per page, since one page often mirrors a whole review list.
  const pos = third.filter((m) => (m.stance === 'positive' || m.stance === 'neutral') && m.kind !== 'complaint');
  for (const m of pos.filter((m) => m.kind === 'rating')) add({
    title: `${host(m.url)} shows your rating: "${clip(m.quote, 80)}"`,
    detail: `${m.author ? m.author + ': ' : ''}"${clip(m.quote, 280)}"${m.date ? ` (${m.date})` : ''}`, severity: 'info', source: m.url, evidence: m.quote, platform: m.platform,
  });
  const byUrl = new Map<string, Mention[]>();
  for (const m of pos.filter((m) => m.kind !== 'rating')) byUrl.set(m.url, [...(byUrl.get(m.url) ?? []), m]);
  for (const [url, ms] of byUrl) add({
    title: `${ms.length} positive ${ms.length === 1 ? ms[0].kind : 'reviews'} on ${host(url)}`,
    detail: ms.slice(0, 3).map((m) => `${m.author ? m.author + ' ' : ''}${m.rating != null ? m.rating + '★ ' : ''}${m.date ? '(' + m.date + ') ' : ''}"${clip(m.quote, 140)}"`).join(' | ') + (ms.length > 3 ? ` | +${ms.length - 3} more` : ''),
    severity: 'info', source: url, evidence: ms.map((m) => m.quote).join(' || '), platform: ms[0].platform, count: ms.length,
  });
  if (own.length) add({
    title: `${own.length} customer testimonial(s) reposted on your own channels`,
    detail: own.map((m) => `${m.own_channel}: ${m.author ? m.author + ' — ' : ''}"${clip(m.quote, 120)}" (${m.url})`).join(' | '),
    severity: 'info', source: own[0].url, platforms: [...new Set(own.map((m) => m.own_channel))],
  });
  else add({ title: 'No customer testimonial found reposted on your website or social pages', detail: `Searches over your website and public social posts found no reposted review or testimonial text.`, severity: 'low', source: null });

  // Forums and complaint sites: an absence is a finding too.
  const forumHosts = ['forum.lowyat.net', 'reddit.com', 'cari.com.my'];
  const forumHits = named.filter((h) => forumHosts.some((f) => host(h.url).endsWith(f)));
  const forumMentions = third.filter((m) => forumHosts.some((f) => host(m.url).endsWith(f)));
  add({
    title: forumMentions.length ? `${forumMentions.length} forum post(s) discuss you` : `No forum discussion of ${brand} found (Lowyat, Reddit, Cari)`,
    detail: forumMentions.length ? forumMentions.map((m) => `${host(m.url)}: "${clip(m.quote, 120)}"`).join(' | ') : `${forumHits.length} forum pages named the company; none held a review or complaint. Prospects who search forums before buying solar find nothing either way.`,
    severity: 'info', source: forumMentions[0]?.url ?? null,
  });
  const complaintSites = third.filter((m) => /complaint|scam|aduan/i.test(host(m.url)));
  if (!third.some((m) => m.stance === 'negative' || m.kind === 'complaint')) add({
    title: 'No complaint about you found on the open web', detail: `Searched ${braveQ.length + exaQ.length} queries (reviews, complaints, scam, forums, Facebook, review sites). ${named.length} pages name you; none carries a complaint.${complaintSites.length ? '' : ''}`,
    severity: 'info', source: null,
  });

  return {
    findings,
    notes: {
      brand, queries: { brave: braveQ, exa: exaQ.map((x) => ({ q: x.q, domains: x.o.includeDomains ?? null })) }, searchLog,
      urls_total: hits.size, named: named.map((h) => ({ url: h.url, title: h.title, via: [...new Set(h.via)], text_chars: h.text.length, own: isOwn(h.url) })),
      mentions, own_fb_seen_in_dive: ownFb.length, page_reads: reads,
    },
  };
}
