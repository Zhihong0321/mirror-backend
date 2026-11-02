// N / news — what is said about the company, its brand and its key people outside its own
// channels: news, forum and social discussion, complaints, awards and press (part 3 of the
// malaysia-deeper-dive report, next to E-maps' Google reviews).
//
// Searches: Exa news for the legal and the short name; Brave for news, complaints (English and
// Malay) and forum threads (Lowyat, Reddit, Facebook); and for up to three key people (directors,
// founders, owners from the dive's people step) their name together with the company's.
// A result is kept only when it names the company or the person. The company's own sites, its own
// social pages and staff pages carrying its name are dropped: they are the company talking. The LLM then judges each result in batches: is it about this company or person, or a
// namesake; what kind of page; positive, neutral or negative; when; with a verbatim quote that is
// checked against the text we have (a quote not found is dropped, the item kept without it).
// No kill gates: a failed search or batch only shrinks the list.
import { nameOf, type Ctx, type Finding } from '../lib.ts';

const KEY_ROLE = /director|founder|owner|shareholder|chief executive|ceo|managing|chairman|partner|principal|proprietor|pengarah|president/i;
const SKIP_HOST = /(^|\.)(google\.[a-z.]+|linkedin\.com|jobstreet\.com|hiredly\.com|maukerja\.my|indeed\.com|glassdoor\.com)$/;
const SOCIAL = /(^|\.)(facebook|instagram|tiktok|youtube|x|twitter|threads|xiaohongshu)\.com$/;

type Hit = { url: string; title: string; text: string; date: string | null; via: string[]; person: string | null };

export async function run(ctx: Ctx, dive: any): Promise<{ findings: Finding[]; notes: Record<string, unknown> }> {
  const r = dive.result ?? {};
  const N = nameOf(dive);
  const findings: Finding[] = [];
  const add = (f: Omit<Finding, 'checked_at'>) => findings.push({ ...f, checked_at: ctx.now() } as Finding);
  const people = (r.people?.people ?? [])
    .filter((p: any) => p.current !== false && KEY_ROLE.test(`${p.role ?? ''} ${p.relation ?? ''}`) && /\s/.test(String(p.name ?? '').trim()) && !/unknown/i.test(p.name))
    .slice(0, 3).map((p: any) => ({ name: String(p.name).trim(), role: String(p.role ?? p.relation ?? '') }));
  ctx.log(`key people: ${people.map((p: any) => p.name).join(', ') || 'none'}`);

  // ---- 1. Searches. ----
  const hits = new Map<string, Hit>();
  // The company's own social pages, and staff pages carrying its name, are the company talking, not outside voices.
  const ownSocial = (u: string) => {
    if (!SOCIAL.test(N.hostOf(u)) || N.brand.length < 4) return false;
    try { return decodeURIComponent(new URL(u).pathname).toLowerCase().split('/').filter(Boolean).slice(0, 2).some((seg) => seg.includes(N.brand)); } catch { return false; }
  };
  const keep = (via: string, x: { url: string; title?: string; text?: string; date?: string | null }, person: string | null) => {
    if (!x.url || N.own(x.url) || ownSocial(x.url) || SKIP_HOST.test(N.hostOf(x.url))) return;
    const text = String(x.text ?? '');
    const all = `${x.title ?? ''} ${text}`;
    const named = N.mentions(all) || (person ? all.toLowerCase().includes(person.toLowerCase()) : false);
    if (!named) return;
    const h = hits.get(x.url) ?? { url: x.url, title: String(x.title ?? ''), text: '', date: x.date ?? null, via: [], person };
    if (text.length > h.text.length) h.text = text.slice(0, 2500);
    if (!h.via.includes(via)) h.via.push(via);
    hits.set(x.url, h);
  };
  const exaNews = async (q: string, person: string | null = null) => {
    for (const x of await ctx.exa(q, { category: 'news', numResults: 10, text: 2500 })) keep(`exa news: ${q}`, { url: x.url, title: x.title, text: x.text, date: x.publishedDate ?? null }, person);
  };
  const braveQ = async (q: string, person: string | null = null) => {
    for (const x of await ctx.brave(q, { count: 20 })) keep(`brave: ${q}`, { url: x.url, title: x.title, text: String(x.description ?? '').replace(/<[^>]+>/g, '') + (x.extra_snippets ? ' ' + x.extra_snippets.join(' ') : ''), date: x.page_age ?? x.age ?? null }, person);
  };
  const short = N.short;
  await Promise.all([
    exaNews(`"${N.bare}"`),
    short.toLowerCase() !== N.bare.toLowerCase() ? exaNews(`"${short}" Malaysia`) : Promise.resolve(),
    braveQ(`"${short}" news OR berita OR akhbar`),
    braveQ(`"${short}" complaint OR scam OR review OR aduan OR penipuan OR kecewa`),
    braveQ(`"${short}" site:lowyat.net OR site:reddit.com OR site:facebook.com`),
    ...people.map((p: any) => braveQ(`"${p.name}" "${short}"`, p.name)),
    ...people.map((p: any) => exaNews(`${p.name} ${short}`, p.name)),
  ]);
  const list = [...hits.values()];
  ctx.log(`${list.length} pages name the company or its people`);

  // ---- 2. Judge in batches. ----
  const judged: any[] = [];
  let unjudged = 0;
  for (let i = 0; i < list.length; i += 12) {
    const batch = list.slice(i, i + 12);
    const got = ctx.parseJson(await ctx.llm(
      `Company: ${N.legal} (${N.industry}; ${N.address}). Brand: ${short}. Key people: ${people.map((p: any) => `${p.name} (${p.role})`).join('; ') || 'none known'}.\n` +
      `Below are web pages that mention the company or one of those people. For each, decide:\n` +
      `- about: "company" (this company or its brand), "person" (one of the key people, in a context tied to this company or its trade), "namesake" (a different company or person with a similar name), or "irrelevant"\n` +
      `- kind: news | press_release | forum | social | complaint | review | award | legal | directory | other\n` +
      `- sentiment: positive | neutral | negative (negative = complaints, disputes, scams, lawsuits, accidents, unpaid bills, bad service)\n` +
      `- date: YYYY-MM-DD or YYYY-MM or YYYY if the page shows when, else ""\n` +
      `- summary: one sentence an owner reads (what is said, by whom)\n` +
      `- quote: an exact sentence copied from the text that shows it (verbatim, max 200 chars), or ""\n` +
      `- person: the key person's name if about=person\n\n` +
      batch.map((h, j) => `#${j} | ${h.title} | ${h.url} | date: ${h.date ?? '?'}\n${h.text.slice(0, 1800)}`).join('\n\n') +
      `\n\nReturn JSON only: {"items":[{"i":0,"about":"","kind":"","sentiment":"","date":"","summary":"","quote":"","person":""}]}`,
    ));
    if (!got) { ctx.warn(`news batch ${i / 12 + 1} did not parse; ${batch.length} pages unjudged`); unjudged += batch.length; continue; }
    for (const it of got.items ?? []) {
      const h = batch[Number(it?.i)];
      if (!h || !['company', 'person'].includes(it.about)) continue;
      const flat = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
      const quote = it.quote && flat(h.text + ' ' + h.title).includes(flat(String(it.quote))) ? String(it.quote) : '';
      judged.push({ url: h.url, title: h.title, about: it.about, person: it.person || h.person, kind: it.kind, sentiment: it.sentiment, date: it.date || (h.date ? String(h.date).slice(0, 10) : ''), summary: it.summary, quote, host: N.hostOf(h.url) });
    }
  }

  // ---- 3. Findings. ----
  const year = (d: string) => Number(String(d).slice(0, 4)) || 0;
  const thisYear = new Date().getFullYear();
  const neg = judged.filter((x) => x.sentiment === 'negative');
  for (const x of neg) {
    const serious = /complaint|legal|forum|social|review/.test(x.kind) || /scam|fraud|court|sue|saman|unpaid|penipuan|police/i.test(`${x.summary} ${x.quote}`);
    add({ title: `${x.about === 'person' ? `${x.person}: ` : ''}${x.kind === 'news' ? 'Negative news' : x.kind === 'forum' || x.kind === 'social' ? 'Negative discussion' : 'A complaint'} on ${x.host}${x.date ? ` (${x.date})` : ''}`, detail: `${x.summary}${x.quote ? ` “${x.quote}”` : ''}`, severity: serious && year(x.date) >= thisYear - 3 ? 'high' : 'medium', source: x.url, check: `news-${x.kind}`, sentiment: 'negative', about: x.about });
  }
  const news = judged.filter((x) => x.about === 'company' && ['news', 'press_release', 'award'].includes(x.kind));
  const independent = news.filter((x) => x.kind !== 'press_release');
  const recent = independent.filter((x) => year(x.date) >= thisYear - 2);
  const latest = independent.map((x) => x.date).filter(Boolean).sort().pop() ?? null;
  // "Nothing found" is only said when every page found was read; unread pages could be the story.
  if (!independent.length && !unjudged) add({ title: 'No news outlet has written about you', detail: `We found no independent news article naming ${short}${news.length ? ` (only ${news.length} press release${news.length === 1 ? '' : 's'} you published)` : ''}. A buyer who searches you finds no outside voice vouching for the business, and AI assistants have nothing independent to quote.`, severity: 'medium', source: null, check: 'news-coverage' });
  else if (independent.length) add({ title: `${independent.length} news article${independent.length === 1 ? ' names' : 's name'} you, ${recent.length} in the last two years`, detail: `Latest: ${latest ?? 'undated'}. ${independent.slice(0, 3).map((x) => `${x.host}: ${x.summary}`).join(' ')}`, severity: recent.length ? 'info' : 'low', source: independent[0].url, check: 'news-coverage' });
  for (const x of judged.filter((y) => y.sentiment === 'positive' && ['news', 'award', 'forum', 'social', 'review'].includes(y.kind)).slice(0, 4)) {
    add({ title: `${x.about === 'person' ? `${x.person}: ` : ''}${x.kind === 'award' ? 'An award' : x.kind === 'news' ? 'Good press' : 'Good word of mouth'} on ${x.host}${x.date ? ` (${x.date})` : ''}`, detail: `${x.summary}${x.quote ? ` “${x.quote}”` : ''} Put this where customers see it: your site's About page and your social profiles.`, severity: 'info', source: x.url, check: `news-${x.kind}`, sentiment: 'positive', about: x.about });
  }
  const talk = judged.filter((x) => ['forum', 'social'].includes(x.kind) && x.about === 'company');
  if (!talk.length && judged.length && !unjudged) add({ title: 'Nobody discusses you on forums or social media that we could find', detail: 'No Lowyat, Reddit or public Facebook thread names you. Word of mouth is happening offline, which helps no one searching.', severity: 'low', source: null, check: 'news-discussion' });

  return { findings, notes: { people, items: judged, pages_found: list.length, unjudged, counts: { news: independent.length, press: news.length - independent.length, negative: neg.length, discussion: talk.length, latest_news: latest } } };
}
