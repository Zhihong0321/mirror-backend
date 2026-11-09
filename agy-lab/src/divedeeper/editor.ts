// One settled set of numbers for the report, worked out in code from the lane outputs.
// The analysis and plan lanes (sections/S4-analysis.ts, S5-plan.ts) brief the LLM from it and the report draws its
// charts and scores from it, so the words and the pictures can never disagree.
//
// Where sources conflict, the official register wins over the company-dive's research
// (a CIDB grade read from CIDB beats one a website or directory printed).
import { savedReviews } from './v21/reviews.ts';
import { daysToImpact, severity as urgency, rankKey, plural } from '../report-rules/index.ts';

// The malaysia-deeper-dive report is read in six research parts, then one full analysis and one action plan. A lane can feed two
// parts: C-merged's website checks are sorted by what each one is about (see partOfCheck).
export type Area = 'contact' | 'understanding' | 'voice' | 'credibility' | 'assets' | 'speed';
export const AREAS: { id: Area; title: string; lanes: string[] }[] = [
  { id: 'contact', title: 'Contact and reachability', lanes: ['R-contacts', 'C-merged'] },
  { id: 'understanding', title: 'How the internet understands you', lanes: ['B-brand', 'G-search', 'G-recommend', 'H-maps', 'H-web', 'C-merged'] },
  { id: 'voice', title: 'Reviews, discussion and news', lanes: ['N-news'] },
  { id: 'credibility', title: 'Credibility and official records', lanes: ['K-credibility', 'D-registry', 'C-merged'] },
  { id: 'assets', title: 'Digital assets', lanes: ['A-assets', 'C-merged'] },
  { id: 'speed', title: 'Website speed and quality', lanes: ['W-speed', 'C-merged'] },
];
/** Every stage-1 lane, in the order the report reads them. */
export const STAGE1_LANES = [...new Set(AREAS.flatMap((a) => a.lanes))];

/** Which part a C-merged website check belongs to. */
export function partOfCheck(check: string | undefined): Area {
  const c = String(check ?? '');
  if (/^(phone|whatsapp|tel|mailto|form|address|free-mail)/.test(c)) return 'contact';
  if (/^(ssm)/.test(c)) return 'credibility';
  if (/^(ssl|https-redirect|redirect-domain|defacement|mixed-content|credit-link)/.test(c)) return 'assets';
  if (/^(slow|viewport)/.test(c)) return 'speed';
  return 'understanding';
}

export type Item = { key: string; lane: string; area: Area; severity: string; title: string; detail: string; source: string | null; check?: string; raw: any; days: number | null; rank: number; ownership?: string; evidence?: string[] };

// The action plan (sections/S5-plan.ts) hands every task to the department that does it.
export type Dept = 'website' | 'social' | 'it' | 'other';
export const DEPTS: { id: Dept; title: string; covers: string; who: string }[] = [
  { id: 'website', title: 'Website', covers: 'Content, pages, contact details on the site, page speed', who: 'Your web developer, or whoever edits the website' },
  { id: 'social', title: 'Social media', covers: 'Google reviews and replies, Google Maps listings, Facebook, LinkedIn, directories', who: 'Whoever runs your Google and social pages' },
  { id: 'it', title: 'IT', covers: 'Domains, email, DNS, hosting, certificates', who: 'Your IT vendor, or whoever set up your domains and email' },
  { id: 'other', title: 'Other', covers: 'Legal, licences, registrations, trademarks, official records', who: 'A director, with your company secretary' },
];

/** The department a finding goes to when nobody said otherwise. */
export function deptOf(x: Item): Dept {
  if (x.area === 'assets') return 'it';
  if (x.area === 'credibility') return x.lane === 'C-merged' ? 'website' : 'other';
  if (x.area === 'voice') return 'social';
  if (x.lane === 'H-maps') return 'social';
  if (x.lane === 'R-contacts' && /google maps|directory|listing|facebook|linkedin|instagram/i.test(`${x.title} ${x.detail}`) && !/your (web)?site|homepage/i.test(x.title)) return 'social';
  return 'website';
}

const isPrivate = (f: any) => /^PRIVATE/i.test(String(f?.title ?? ''));
const short = (n: string) => n.replace(/\s*[-–|].*$/, '').replace(/\s+(Sdn\.?\s*Bhd\.?|Berhad|Holdings Berhad|Sdn)\.?$/i, '').trim();
const token = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').trim().split(/\s+/)[0] ?? '';
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);

const SEV_LEVEL: Record<string, number> = { high: 3, medium: 2, low: 1, info: 1 };
/** Every finding in the report, with a stable key (lane#index) the editor's plain titles hang on, best first (PL11, PL13). */
export function items(L: Record<string, any>, country = ''): Item[] {
  const out: Item[] = [];
  // S1-recheck's verdicts (check.ts): a finding it found false is left out, one it found weak is lowered. Absent when it did not run.
  const rechecked: Record<string, { verdict: string }> = L['S1-recheck']?.notes?.verdicts ?? {};
  const now = new Date();
  for (const lane of STAGE1_LANES) (L[lane]?.findings ?? []).forEach((f: any, i: number) => {
    const key = `${lane}#${i}`;
    if (isPrivate(f)) return;
    if (rechecked[key]?.verdict === 'false') return;
    // Rollups repeat what the per-question findings say; the AI chart shows them instead.
    if (/^(rollup|domain-rollup)$/.test(String(f.kind ?? ''))) return;
    // Inventory and summary lines feed the part's table and headline number, not the finding list.
    if (/^(inventory|contact-summary|cred-summary)$/.test(String(f.check ?? ''))) return;
    const printed = `${f.title ?? ''} ${f.detail ?? ''}`;
    const area = lane === 'C-merged' ? partOfCheck(f.check) : AREAS.find((a) => a.lanes.includes(lane))!.id;
    // The register showing better than the claim (G7 where the site says G3) is a fix, not an alarm.
    const first = f.direction === 'undersell' ? 'medium' : String(f.severity ?? 'info');
    const base = rechecked[key]?.verdict === 'weak' && (first === 'high' || first === 'medium') ? 'low' : first;
    // PL11: time to impact. The dated expiry (or the nearest date in the text of an expiry finding) moves the severity.
    const dated = f.expires_at ? daysToImpact([String(f.expires_at)], now, { includePast: true }) : null;
    const days = dated !== null ? dated : /expir|renew|deadline/i.test(`${printed} ${f.check ?? ''}`) ? daysToImpact([String(f.title ?? ''), String(f.detail ?? '')], now, { includePast: true }) : null;
    const u = urgency({ recordLevel: SEV_LEVEL[base] ?? 1, confidence: f.confidence ?? 'high', days });
    const severity = base === 'info' && u === 'low' ? 'info' : u;
    out.push({ key, lane, area, severity, title: String(f.title ?? ''), detail: String(f.detail ?? ''), source: f.source ?? null, check: f.check, raw: f, days, rank: rankKey(u, days), ownership: f.ownership });
  });
  out.sort((a, b) => b.rank - a.rank);
  // PL14: the same check failing on several assets is one finding with one evidence row per asset.
  const merged: Item[] = [];
  const groups = new Map<string, Item>();
  for (const x of out) {
    const g = x.check && x.raw.domain ? `${x.lane}|${x.check}` : '';
    const head = g ? groups.get(g) : undefined;
    if (!head) { if (g) groups.set(g, x); merged.push(x); continue; }
    (head.evidence ??= [head.title]).push(x.title);
  }
  return merged;
}

/** PL5: only a domain we know the company owns gets "your domain" and "Renew / Set DMARC" wording; any other gets a neutral one. */
export function ownershipWording(x: Item, text: string, officialDomains: string[]): string {
  const domain = String(x.raw?.domain ?? '').toLowerCase().replace(/^www\./, '');
  if (!domain && !x.ownership) return text;
  const official = officialDomains.some((d) => String(d).toLowerCase().replace(/^https?:\/\/(www\.)?/, '').replace(/\/.*$/, '') === domain);
  if (x.ownership === 'owned' || (!x.ownership && official)) return text;
  return text.replace(/\byour (domain|website address)\b/gi, 'the $1').replace(/(^|[.!?]\s+)(Renew|Set(?: up)? (?:a |the )?(?:DMARC|SPF|DKIM)\b)/g, (_, pre, verb) => `${pre}If you control the domain, ${verb.charAt(0).toLowerCase()}${verb.slice(1)}`);
}

/** Act now / needs work / good, from the urgent and needs-work items in an area. */
export function status(list: Item[]): [string, string] {
  const hi = list.filter((x) => (x.severity === 'high' || x.severity === 'critical')).length;
  const md = list.filter((x) => x.severity === 'medium').length;
  return hi >= 2 ? ['urgent', 'Act now'] : hi || md >= 2 ? ['fix', 'Needs work'] : ['good', 'Good'];
}

export function resolve(dive: any, L: Record<string, any>) {
  const r = dive?.result ?? {};
  const id = r.identity ?? {};
  const name = String(id.legal_name ?? dive?.company ?? '');
  const brand = token(name);
  const now = (L['E-maps']?.ran_at ?? L['H-maps']?.ran_at ?? new Date().toISOString()).slice(0, 10);
  const all = items(L, String(dive?.country ?? ''));

  // ---- reviews ----
  const en = dive?.v21 && !L['E-maps']?.notes?.reviews?.length ? savedReviews(dive) : L['E-maps']?.notes ?? {};
  const reviews: any[] = en.reviews ?? [];
  const perListing: any[] = en.per_listing ?? [];
  const totalReviews = perListing.reduce((t, x) => t + Number(x.pulled ?? 0), 0);
  const replied = perListing.reduce((t, x) => t + Number(x.replied ?? 0), 0);
  const unansweredLow = reviews.filter((x) => x.stars <= 2 && !x.reply).sort((a, b) => String(a.date).localeCompare(String(b.date)))
    .map((x) => ({ stars: x.stars, date: x.date, author: x.author, listing: x.listing, text: x.text ?? '', days_open: x.date ? daysBetween(x.date, now) : null }));
  const months = new Map<string, { n: number; low: number }>();
  for (const x of reviews) {
    const m = String(x.date ?? '').slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(m)) continue;
    const v = months.get(m) ?? { n: 0, low: 0 };
    v.n++; if (x.stars <= 2) v.low++;
    months.set(m, v);
  }
  const monthly: { month: string; n: number; low: number }[] = [];
  if (months.size) {
    const keys = [...months.keys()].sort();
    let [y, m] = keys[0].split('-').map(Number);
    const [ey, em] = keys[keys.length - 1].split('-').map(Number);
    while (y < ey || (y === ey && m <= em)) {
      const k = `${y}-${String(m).padStart(2, '0')}`;
      monthly.push({ month: k, ...(months.get(k) ?? { n: 0, low: 0 }) });
      if (++m > 12) { m = 1; y++; }
    }
  }
  const bursts: any[] = en.bursts ?? [];
  const praise = new Map<string, number>();
  for (const c of en.classified?.reviews ?? []) for (const p of c.praise ?? []) praise.set(p, (praise.get(p) ?? 0) + 1);
  const crossReviewers = (L['E-maps']?.findings ?? []).find((f: any) => /reviewers? left a review on more than one/i.test(f.title))?.title ?? null;
  const goodQuotes = reviews.filter((x) => x.stars >= 5 && String(x.text ?? '').length > 90).sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, 3).map((x) => ({ text: x.text, author: x.author, date: x.date }));

  // ---- Maps and web ----
  const hm = L['H-maps']?.notes ?? {};
  const listings: any[] = hm.listings ?? [];
  const parseTop = (s: string) => { const m = String(s).match(/^(.*) \(([\d.]+|-)★, (\d+) reviews\)$/); return m ? { name: m[1], rating: m[2] === '-' ? null : Number(m[2]), reviews: Number(m[3]) } : { name: String(s), rating: null, reviews: null }; };
  const ranks = (hm.ranks ?? []).map((x: any) => ({ query: x.query, area: x.area, rank: x.rank ?? null, of: x.of ?? null, listing: x.listing ?? null, top: (x.top ?? []).map(parseTop) }));
  const plan = hm.plan ?? L['H-web']?.notes?.plan ?? {};
  const hq = (plan.areas ?? [])[0] ?? null;
  const byArea = (plan.areas ?? []).map((a: string) => {
    const rs = ranks.filter((x: any) => x.area === a);
    const ranked = rs.filter((x: any) => x.rank);
    const best = ranked.sort((p: any, q: any) => p.rank - q.rank)[0] ?? null;
    return { area: a, best_rank: best?.rank ?? null, of: best?.of ?? Math.max(0, ...rs.map((x: any) => x.of ?? 0)), query: (best ?? rs[0])?.query ?? null, top: (best ?? rs[0])?.top ?? [] };
  });
  const noListingIn = (L['H-maps']?.findings ?? []).filter((f: any) => /^No Google Maps listing in /.test(f.title)).map((f: any) => f.title.replace('No Google Maps listing in ', ''));
  const webShown = (L['H-web']?.findings ?? []).find((f: any) => /customer searches/.test(f.title)) ?? null;
  const ourListing = listings[0] ?? null;

  // ---- An AI assistant with a web search (G-search): what it said, who it names, who it calls the closest competitors ----
  const gs = L['G-search']?.notes ?? null;
  const gsAnswers: any[] = gs?.answers ?? [];
  const gsPrompts: any[] = gs?.prompts ?? [];
  const kind = new Map<string, string>(gsPrompts.map((p: any) => [p.id, p.kind]));
  const said = gsPrompts.filter((p: any) => p.kind === 'company')
    .map((p: any) => ({ p, a: gsAnswers.find((x: any) => x.id === p.id && x.sample === 0) })).filter((x) => x.a)
    .map((x) => ({ id: x.p.id, q: x.p.text as string, a: String(x.a.answer), sources: (x.a.sources ?? []) as string[] }));
  const voice = new Map<string, { name: string; n: number }>();
  const tradeAll = gsAnswers.filter((a: any) => kind.get(a.id) === 'trade');
  const tradeAnswers = tradeAll.length;
  const namedUs = tradeAll.filter((a: any) => a.named).length;
  for (const a of tradeAll) {
    const seen = new Set<string>();
    for (const c of a.companies ?? []) {
      const t = token(short(c));
      if (!t || t === brand || seen.has(t)) continue;
      seen.add(t);
      const v = voice.get(t) ?? { name: short(c), n: 0 };
      v.n++;
      if (short(c).length < v.name.length) v.name = short(c);
      voice.set(t, v);
    }
  }
  const shareOfVoice = [...voice.values()].sort((a, b) => b.n - a.n).slice(0, 7);
  const tradeQuestion = gsPrompts.find((p: any) => p.kind === 'trade')?.text ?? null;
  const compareRuns: any[] = gs?.compare ?? [];
  const compare = compareRuns[0] ?? null;
  const rivalCount = new Map<string, { name: string; n: number }>();
  for (const c of compareRuns) for (const name of c.closest_competitors ?? []) {
    const t = token(short(name));
    if (!t || t === brand) continue;
    const v = rivalCount.get(t) ?? { name: short(name), n: 0 };
    v.n++;
    rivalCount.set(t, v);
  }
  const rivals = [...rivalCount.values()].sort((a, b) => b.n - a.n).slice(0, 4);

  // ---- G-recommend: ChatGPT and Gemini asked as customers. Named without the name? Rated? Picked over the others? ----
  const gr = L['G-recommend']?.notes ?? null;
  const grAnswers: any[] = gr?.answers ?? [];
  const grAsks: any[] = gr?.asks ?? [];
  const grWho: string[] = gr?.assistants ?? [];
  // "SS SOLAR Malaysia", "SS Solar (by Swee Seng)" and "Verdant Solar Holdings Berhad (Johor)" are one company each.
  const nameKey = (n: string) => short(String(n).replace(/\([^)]*\)/g, ' ')).toLowerCase()
    .replace(/\b(sdn|bhd|berhad|holdings?|group|malaysia|m|plt|enterprise|co|ltd)\b\.?/g, ' ').replace(/[^a-z0-9]+/g, '');
  const grKeys: string[] = gr?.keys ?? [];
  const isUs = (n: string) => { const t = ` ${String(n).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()} `; return grKeys.some((k) => t.includes(` ${k} `)); };
  const mean = (xs: number[]) => (xs.length ? Math.round((xs.reduce((s, v) => s + v, 0) / xs.length) * 10) / 10 : null);
  const finds = grAnswers.filter((a) => a.kind === 'find');
  const recFind = grWho.map((w) => {
    const xs = finds.filter((a) => a.assistant === w);
    const pos = xs.filter((a) => a.named && a.position).map((a) => Number(a.position));
    return { assistant: w, named: xs.filter((a) => a.named).length, of: xs.length, best: pos.length ? Math.min(...pos) : null, avg: mean(pos) };
  });
  const recByAsk = grAsks.filter((q) => q.kind === 'find').map((q) => ({
    q: String(q.text).replace(/ Please check the web for current information\.$/, ''),
    rows: grWho.map((w) => {
      const xs = finds.filter((a) => a.id === q.id && a.assistant === w);
      const pos = xs.filter((a) => a.named && a.position).map((a) => Number(a.position));
      return { assistant: w, named: xs.filter((a) => a.named).length, of: xs.length, best: pos.length ? Math.min(...pos) : null, top: (xs[0]?.companies ?? []).slice(0, 4).map((n: string) => short(n)) };
    }),
  }));
  const recShare = new Map<string, { name: string; by: Record<string, number>; total: number }>();
  for (const a of finds) for (const n of new Set((a.companies ?? []) as string[])) {
    const k = nameKey(n);
    if (!k || isUs(n)) continue;
    const v = recShare.get(k) ?? { name: short(n), by: {}, total: 0 };
    v.by[a.assistant] = (v.by[a.assistant] ?? 0) + 1; v.total++;
    if (short(n).length < v.name.length) v.name = short(n);
    recShare.set(k, v);
  }
  const rates = grAnswers.filter((a) => a.kind === 'rate');
  const rateRows = new Map<string, { name: string; by: Record<string, number[]> }>();
  for (const a of rates) for (const s of a.scores ?? []) {
    const k = nameKey(s.name);
    if (!k || isUs(s.name)) continue;
    const v = rateRows.get(k) ?? { name: short(s.name), by: {} };
    (v.by[a.assistant] ??= []).push(Number(s.score));
    rateRows.set(k, v);
  }
  const picks = grAnswers.filter((a) => a.kind === 'pick');
  const rec = gr ? {
    assistants: grWho, repeat: gr.repeat ?? null, asked_on: L['G-recommend']?.ran_at ?? null, method: gr.method ?? '', profile: gr.profile ?? null,
    find: recFind, by_ask: recByAsk,
    share: [...recShare.values()].sort((a, b) => b.total - a.total).slice(0, 8),
    rating: {
      you: Object.fromEntries(grWho.map((w) => [w, mean(rates.filter((a) => a.assistant === w && a.target_score != null).map((a) => Number(a.target_score)))])),
      rivals: [...rateRows.values()].map((v) => ({ name: v.name, by: Object.fromEntries(grWho.map((w) => [w, mean(v.by[w] ?? [])])), n: Object.values(v.by).flat().length }))
        .sort((a, b) => b.n - a.n).slice(0, 5),
      why: rates.map((a) => ({ assistant: a.assistant, summary: a.summary })).filter((x) => x.summary),
    },
    pick: grWho.map((w) => {
      const xs = picks.filter((a) => a.assistant === w);
      // Recommended over the others only when its own pick is you, or it picked no one and said yes.
      const yes = xs.filter((a) => a.picks_us || (!a.pick && a.recommends === 'yes')).length;
      const others = [...new Set(xs.filter((a) => a.pick && !a.picks_us).map((a) => short(a.pick)))];
      return { assistant: w, yes, of: xs.length, verdicts: xs.map((a) => a.recommends), others, summary: xs.find((a) => a.summary)?.summary ?? '' };
    }),
    answers: grAnswers.map((a) => ({ assistant: a.assistant, id: a.id, kind: a.kind, sample: a.sample, text: a.text, named: a.named, position: a.position })),
    asks: grAsks,
  } : null;

  // ---- credentials: the register's answer, claim by claim ----
  const reg = (L['D-registry']?.findings ?? []).filter((f: any) => !isPrivate(f));
  const cidb = reg.find((f: any) => /^CIDB sweep/i.test(f.title));
  const cidbGrade = String(cidb?.title ?? '').match(/grade (G\d)/i)?.[1] ?? null;
  const verdictOf = (f: any) => String(f.verdict ?? '').toLowerCase();
  const claimOf = (f: any) => String(f.title).replace(/^(VERIFIED|CONTRADICTED|NOT FOUND|CAN'T CHECK AUTOMATICALLY):\s*/i, '');
  const credentials = reg.filter((f: any) => !/^CIDB sweep/i.test(f.title)).map((f: any) => ({
    claim: claimOf(f), verdict: verdictOf(f), direction: f.direction ?? null, detail: String(f.detail ?? ''), source: f.source ?? null,
  }));
  // A claim the register contradicts by showing something better is an undersell, not a lie.
  const undersells = credentials.filter((c: any) => c.verdict === 'contradicted' && c.direction === 'undersell');

  // ---- website (C-merged, whichever part its checks landed in) ----
  const site = all.filter((x) => x.lane === 'C-merged');
  const copyErrors = site.filter((x) => /^(spelling|grammar|wording)/i.test(x.title)).length;
  const phones = L['C-merged']?.notes?.sitePhones ?? null;

  // ---- part 1: contact points ----
  const inventory: any[] = L['R-contacts']?.notes?.inventory ?? [];
  const contact = {
    points: inventory, ok: inventory.filter((p) => p.status === 'current').length, total: inventory.length,
    bad: inventory.filter((p) => !['current', 'unclear'].includes(p.status)).length,
    left: inventory.filter((p) => p.left).length, summary: L['R-contacts']?.notes?.summary ?? null,
    judged: L['R-contacts']?.notes?.judged === true,
  };

  // ---- part 2: the brand as the internet understands it ----
  const bn = L['B-brand']?.notes ?? {};
  const brandView = { score: bn.coverage?.score ?? null, why: bn.why_choose_you ?? null, five: bn.five_second_test ?? null, offer: bn.offer ?? [], points: bn.selling_points ?? [], missing: bn.missing ?? [], summary: bn.summary ?? null };

  // ---- part 3: news and discussion ----
  const nn = L['N-news']?.notes ?? {};
  // Counts are only a verdict when every page found was judged.
  const news = { items: nn.items ?? [], counts: nn.counts && nn.unjudged === 0 ? nn.counts : null, people: nn.people ?? [] };

  // ---- part 4: official records ----
  const checks: any[] = L['K-credibility']?.notes?.checks ?? [];
  const risky = checks.filter((c) => ['bnm', 'sc', 'court', 'insolvency'].includes(c.id));

  // ---- part 5: digital assets ----
  const assetRows: any[] = L['A-assets']?.notes?.domains ?? [];
  const assetIssues = all.filter((x) => x.area === 'assets' && ((x.severity === 'high' || x.severity === 'critical') || x.severity === 'medium')).length;

  // ---- part 6: Google PageSpeed Insights on the official homepages ----
  const psi: any[] = (L['W-speed']?.notes?.pages ?? []).filter((p: any) => p.ok);
  // The site customers land on first: the first official domain's, else the first one Google scored.
  const mainSite = L['W-speed']?.notes?.homes?.[0]?.site ?? psi[0]?.site ?? null;
  const mainMobile = psi.find((p) => p.site === mainSite && p.strategy === 'mobile') ?? psi.find((p) => p.strategy === 'mobile') ?? null;

  // ---- one status and one measured number per part ----
  const regOk = credentials.filter((c: any) => c.verdict === 'verified' || c.direction === 'undersell').length;
  const regCheckable = credentials.filter((c: any) => !/can't check/.test(c.verdict)).length;
  const metric: Record<Area, string | null> = {
    // Until the judge has spoken, every point is "unclear": count what was traced, not "0 reach you".
    contact: contact.total ? (contact.judged ? `${contact.ok} of ${plural(contact.total, 'contact point', 'contact points')} ${contact.total === 1 ? 'reaches' : 'reach'} you` : `${plural(contact.total, 'contact point', 'contact points')} traced`) : null,
    understanding: brandView.score != null ? `Understood ${brandView.score} out of 100` : tradeAnswers ? `Recommended in ${namedUs} of ${plural(tradeAnswers, 'AI answer', 'AI answers')}` : null,
    voice: totalReviews ? `${replied} of ${plural(totalReviews, 'review', 'reviews')} answered${news.counts ? ` · ${plural(news.counts.news, 'news article', 'news articles')}` : ''}` : news.counts ? `${plural(news.counts.news, 'news article', 'news articles')}, ${plural(news.counts.negative, 'negative mention', 'negative mentions')}` : null,
    credibility: risky.length ? `${risky.filter((c) => c.result === 'clear').length} of ${plural(risky.length, 'risk check', 'risk checks')} clear${regCheckable ? ` · ${regOk} of ${plural(regCheckable, 'claim', 'claims')} confirmed` : ''}` : regCheckable ? `${regOk} of ${plural(regCheckable, 'checkable claim', 'checkable claims')} confirmed` : null,
    assets: assetRows.length ? `${plural(assetRows.length, 'domain', 'domains')} · ${assetIssues} at risk` : null,
    speed: mainMobile ? `${mainMobile.scores.performance} out of 100 on mobile, ${mainMobile.site}` : null,
  };
  const areas = AREAS.map((a) => {
    const ran = a.lanes.some((l) => L[l]);
    const list = all.filter((x) => x.area === a.id);
    return { id: a.id, title: a.title, ran, status: ran ? status(list) : ['info', 'Not checked'], metric: ran ? metric[a.id] : null, high: list.filter((x) => (x.severity === 'high' || x.severity === 'critical')).length, medium: list.filter((x) => x.severity === 'medium').length };
  });

  return {
    name, brand, checked_on: now, hq, plan, areas,
    identity: { legal_name: name, ssm: (id.registration_numbers ?? []).find((x: string) => /^\d{12}$/.test(x)) ?? (id.registration_numbers ?? [])[0] ?? null, address: id.address ?? null, domains: id.official_domains ?? [], industry: id.industry ?? null, summary: id.summary ?? null },
    reviews: { total: totalReviews, replied, listings: perListing.map((x) => ({ name: x.name, rating: x.listed_rating, count: x.listed_reviews, replied: x.replied, pulled: x.pulled })), unanswered_low: unansweredLow, monthly, bursts, cross_reviewers: crossReviewers, praise: [...praise.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5), good_quotes: goodQuotes },
    maps: { listings: listings.map((x) => ({ name: x.name, rating: x.rating, reviews: x.reviews, phone: x.phone })), by_area: byArea, no_listing_in: noListingIn, our: ourListing ? { name: ourListing.name, rating: ourListing.rating, reviews: ourListing.reviews } : null, web_line: webShown?.title ?? null },
    ai: { assistant: gs?.assistant ?? null, answers: gsAnswers.length, asked_on: L['G-search']?.ran_at ?? null, runs: gs?.runs ?? null, repeat: gs?.repeat ?? null, said, compare, rivals, share: shareOfVoice, trade_answers: tradeAnswers, named_us: namedUs, trade_question: tradeQuestion },
    rec,
    credentials: { cidb_grade: cidbGrade, cidb_detail: cidb?.detail ?? null, list: credentials, undersells },
    website: { issues: site.filter((x) => (x.severity === 'high' || x.severity === 'critical') || x.severity === 'medium').length, high: site.filter((x) => (x.severity === 'high' || x.severity === 'critical')).length, copy_errors: copyErrors, phones },
    speed: { pages: psi, main_mobile: mainMobile },
    contact, brand_view: brandView, news, records: { checks, risky }, assets: { domains: assetRows, issues: assetIssues, subdomains: L['A-assets']?.notes?.subdomains ?? [], email: L['A-assets']?.notes?.email ?? [], blacklists: L['A-assets']?.notes?.blacklists ?? [], lookalikes: L['A-assets']?.notes?.lookalikes ?? [] },
    items: all,
  };
}
export type Resolved = ReturnType<typeof resolve>;
