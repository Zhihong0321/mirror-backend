// One settled set of numbers for the report, worked out in code from the lane outputs.
// The analysis and plan lanes (sections/S4-analysis.ts, S5-plan.ts) brief the LLM from it and the report draws its
// charts and scores from it, so the words and the pictures can never disagree.
//
// Where sources conflict, the official register wins over the company-dive's research
// (a CIDB grade read from CIDB beats one a website or directory printed).

// The malaysia-deeper-dive report is read in six research parts, then one full analysis and one action plan. A lane can feed two
// parts: C-merged's website checks are sorted by what each one is about (see partOfCheck).
export type Area = 'contact' | 'understanding' | 'voice' | 'credibility' | 'assets' | 'speed';
export const AREAS: { id: Area; title: string; lanes: string[] }[] = [
  { id: 'contact', title: 'Contact and reachability', lanes: ['R-contacts', 'C-merged'] },
  { id: 'understanding', title: 'How the internet understands you', lanes: ['B-brand', 'G-fixed', 'G-grounded', 'H-maps', 'H-web', 'C-merged'] },
  { id: 'voice', title: 'Reviews, discussion and news', lanes: ['E-maps', 'N-news'] },
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

export type Item = { key: string; lane: string; area: Area; severity: string; title: string; detail: string; source: string | null; check?: string; raw: any };

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

/** Every finding in the report, with a stable key (lane#index) the editor's plain titles hang on. */
export function items(L: Record<string, any>): Item[] {
  const out: Item[] = [];
  for (const lane of STAGE1_LANES) (L[lane]?.findings ?? []).forEach((f: any, i: number) => {
    if (isPrivate(f)) return;
    // Rollups repeat what the per-question findings say; the AI chart shows them instead.
    if (/^(rollup|domain-rollup)$/.test(String(f.kind ?? ''))) return;
    // Inventory and summary lines feed the part's table and headline number, not the finding list.
    if (/^(inventory|contact-summary|cred-summary)$/.test(String(f.check ?? ''))) return;
    const area = lane === 'C-merged' ? partOfCheck(f.check) : AREAS.find((a) => a.lanes.includes(lane))!.id;
    // The register showing better than the claim (G7 where the site says G3) is a fix, not an alarm.
    const severity = f.direction === 'undersell' ? 'medium' : String(f.severity ?? 'info');
    out.push({ key: `${lane}#${i}`, lane, area, severity, title: String(f.title ?? ''), detail: String(f.detail ?? ''), source: f.source ?? null, check: f.check, raw: f });
  });
  return out;
}

/** Act now / needs work / good, from the urgent and needs-work items in an area. */
export function status(list: Item[]): [string, string] {
  const hi = list.filter((x) => x.severity === 'high').length;
  const md = list.filter((x) => x.severity === 'medium').length;
  return hi >= 2 ? ['urgent', 'Act now'] : hi || md >= 2 ? ['fix', 'Needs work'] : ['good', 'Good'];
}

export function resolve(dive: any, L: Record<string, any>) {
  const r = dive?.result ?? {};
  const id = r.identity ?? {};
  const name = String(id.legal_name ?? dive?.company ?? '');
  const brand = token(name);
  const now = (L['E-maps']?.ran_at ?? L['H-maps']?.ran_at ?? new Date().toISOString()).slice(0, 10);
  const all = items(L);

  // ---- reviews ----
  const en = L['E-maps']?.notes ?? {};
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

  // ---- AI assistants: "from memory" (G-fixed) and "with a web search" (G-grounded) kept apart ----
  const modelName = (m: string) => (/deepseek/i.test(m) ? 'DeepSeek' : /gpt/i.test(m) ? 'GPT' : m);
  const aiMode = (lane: string, label: string) => {
    const n = L[lane]?.notes;
    if (!n) return null;
    const kind = new Map<string, string>((n.prompts ?? []).map((p: any) => [p.id, p.kind]));
    const models = [...new Set((n.answers ?? []).map((a: any) => a.model))] as string[];
    return {
      label, lane,
      models: models.map((m) => {
        const as = (n.answers ?? []).filter((a: any) => a.model === m);
        const company = as.filter((a: any) => kind.get(a.id) === 'company');
        const trade = as.filter((a: any) => kind.get(a.id) === 'trade');
        const count = (o: string) => company.filter((a: any) => a.outcome === o).length;
        return {
          model: modelName(m), asked: company.length,
          right: count('correct'), mixed: count('mixed'), wrong: count('wrong'), dont_know: count('doesnt_know') + count('not_mentioned'),
          trade_asked: trade.length, trade_named: trade.filter((a: any) => a.outcome && a.outcome !== 'not_mentioned').length,
        };
      }),
      wrong_examples: (n.answers ?? []).flatMap((a: any) => (a.claims ?? []).filter((c: any) => c.verdict === 'wrong').map((c: any) => ({ model: modelName(a.model), q: a.id, claim: c.claim, note: c.note }))).slice(0, 4),
      trade: (n.answers ?? []).filter((a: any) => kind.get(a.id) === 'trade'),
    };
  };
  const memory = aiMode('G-fixed', 'Asked from memory');
  const search = aiMode('G-grounded', 'Asked with a web search');
  const voice = new Map<string, { name: string; n: number }>();
  let tradeAnswers = 0, namedUs = 0;
  for (const mode of [memory, search]) for (const a of mode?.trade ?? []) {
    tradeAnswers++;
    if (a.outcome && a.outcome !== 'not_mentioned') namedUs++;
    const seen = new Set<string>();
    for (const c of a.competitors ?? []) {
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
  const tradeQuestion = (L['G-fixed']?.notes?.prompts ?? L['G-grounded']?.notes?.prompts ?? []).find((p: any) => p.kind === 'trade')?.text ?? null;
  const badDomain = [...(L['G-fixed']?.findings ?? []), ...(L['G-grounded']?.findings ?? [])].find((f: any) => /does not exist/i.test(f.title))?.title ?? null;

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
  const assetIssues = all.filter((x) => x.area === 'assets' && (x.severity === 'high' || x.severity === 'medium')).length;

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
    contact: contact.total ? (contact.judged ? `${contact.ok} of ${contact.total} contact points reach you` : `${contact.total} contact points traced`) : null,
    understanding: brandView.score != null ? `Understood ${brandView.score} out of 100` : tradeAnswers ? `Recommended in ${namedUs} of ${tradeAnswers} AI answers` : null,
    voice: totalReviews ? `${replied} of ${totalReviews} reviews answered${news.counts ? ` · ${news.counts.news} news article${news.counts.news === 1 ? '' : 's'}` : ''}` : news.counts ? `${news.counts.news} news articles, ${news.counts.negative} negative mentions` : null,
    credibility: risky.length ? `${risky.filter((c) => c.result === 'clear').length} of ${risky.length} risk checks clear${regCheckable ? ` · ${regOk} of ${regCheckable} claims confirmed` : ''}` : regCheckable ? `${regOk} of ${regCheckable} checkable claims confirmed` : null,
    assets: assetRows.length ? `${assetRows.length} domains · ${assetIssues} at risk` : null,
    speed: mainMobile ? `${mainMobile.scores.performance} out of 100 on mobile, ${mainMobile.site}` : null,
  };
  const areas = AREAS.map((a) => {
    const ran = a.lanes.some((l) => L[l]);
    const list = all.filter((x) => x.area === a.id);
    return { id: a.id, title: a.title, ran, status: ran ? status(list) : ['info', 'Not checked'], metric: ran ? metric[a.id] : null, high: list.filter((x) => x.severity === 'high').length, medium: list.filter((x) => x.severity === 'medium').length };
  });

  return {
    name, brand, checked_on: now, hq, plan, areas,
    identity: { legal_name: name, ssm: (id.registration_numbers ?? []).find((x: string) => /^\d{12}$/.test(x)) ?? (id.registration_numbers ?? [])[0] ?? null, address: id.address ?? null, domains: id.official_domains ?? [], industry: id.industry ?? null, summary: id.summary ?? null },
    reviews: { total: totalReviews, replied, listings: perListing.map((x) => ({ name: x.name, rating: x.listed_rating, count: x.listed_reviews, replied: x.replied, pulled: x.pulled })), unanswered_low: unansweredLow, monthly, bursts, cross_reviewers: crossReviewers, praise: [...praise.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5), good_quotes: goodQuotes },
    maps: { listings: listings.map((x) => ({ name: x.name, rating: x.rating, reviews: x.reviews, phone: x.phone })), by_area: byArea, no_listing_in: noListingIn, our: ourListing ? { name: ourListing.name, rating: ourListing.rating, reviews: ourListing.reviews } : null, web_line: webShown?.title ?? null },
    ai: { memory: memory && { ...memory, trade: undefined }, search: search && { ...search, trade: undefined }, share: shareOfVoice, trade_answers: tradeAnswers, named_us: namedUs, trade_question: tradeQuestion, bad_domain: badDomain },
    credentials: { cidb_grade: cidbGrade, cidb_detail: cidb?.detail ?? null, list: credentials, undersells },
    website: { issues: site.filter((x) => x.severity === 'high' || x.severity === 'medium').length, high: site.filter((x) => x.severity === 'high').length, copy_errors: copyErrors, phones },
    speed: { pages: psi, main_mobile: mainMobile },
    contact, brand_view: brandView, news, records: { checks, risky }, assets: { domains: assetRows, issues: assetIssues, subdomains: L['A-assets']?.notes?.subdomains ?? [], email: L['A-assets']?.notes?.email ?? [], blacklists: L['A-assets']?.notes?.blacklists ?? [], lookalikes: L['A-assets']?.notes?.lookalikes ?? [] },
    items: all,
  };
}
export type Resolved = ReturnType<typeof resolve>;
