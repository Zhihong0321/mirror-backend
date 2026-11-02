// S2 / consult — dive-deeper stage 2: turn stage-1 findings into advice and ready-to-use drafts.
//
//   node scripts/dive-deeper/run.ts S2 consult <diveId>
//
// Reads the stage-1 outputs already in out/ (E-maps, H-maps, H-web, C-merged, D-registry,
// G-fixed, G-grounded for the same dive) and makes a handful of fresh reads: the company's
// own homepages, the competitors AI names most, and the "best <trade> in <town>" list pages
// AI read when it answered. Three LLM calls write the ready-to-use drafts: a website plan with
// rewritten homepage copy, the FAQ for an AI-visibility plan built against those competitors, and
// review-reply drafts. The business JSON-LD is built in code from the dive's facts. The analysis
// and the action plan read across everything afterwards (S4-analysis, S5-plan).
import fs from 'node:fs';
import path from 'node:path';
import { OUT, type Ctx, type Finding } from '../lib.ts';
import { STAGE1_LANES } from '../editor.ts';

const host = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n) + ' …' : s);

function stage1(diveId: string, lane: string): any | null {
  const file = path.join(OUT, `${lane}-${diveId}.json`);
  try { return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null; } catch { return null; }
}

const brief = (out: any, n = 30) => (out?.findings ?? []).slice(0, n).map((f: Finding) => `- [${f.severity}] ${f.title}: ${clip(String(f.detail ?? ''), 220)}`).join('\n');

/** One LLM call parsed as JSON, asked a second time if the first answer does not parse. */
async function askJson(ctx: Ctx, prompt: string, label: string): Promise<any> {
  for (let attempt = 1; attempt <= 2; attempt++) {
    const got = ctx.parseJson(await ctx.llm(prompt, { label }));
    if (got) return got;
    ctx.warn(`${label} did not parse (attempt ${attempt})`);
  }
  return null;
}

export async function run(ctx: Ctx, dive: any): Promise<{ findings: Finding[]; notes: Record<string, unknown> }> {
  const r = dive.result ?? {};
  const id = r.identity ?? {};
  const name = String(id.legal_name ?? dive.company);
  const brand = name.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').trim().split(/\s+/)[0] ?? '';
  const lanes = Object.fromEntries(STAGE1_LANES.map((l) => [l, stage1(ctx.diveId, l)]));
  for (const [l, v] of Object.entries(lanes)) if (!v) ctx.warn(`stage-1 output ${l}-${ctx.diveId}.json missing; advice will skip what it covers`);
  const findings: Finding[] = [];
  const now = ctx.now();

  // ---- Competitors AI names instead of the company, with their Maps review counts. ----
  const named = new Map<string, number>();
  for (const l of ['G-fixed', 'G-grounded']) for (const f of lanes[l]?.findings ?? []) {
    const m = String(f.detail ?? '').match(/Companies they name instead: ([^.]+?)(?:\.|$| deepseek| gpt)/);
    for (const c of m?.[1]?.split(',').map((s: string) => s.trim()).filter(Boolean) ?? []) {
      const key = c.replace(/\s+(Sdn\.? Bhd\.?|Berhad|Holdings Berhad)$/i, '').trim();
      if (key && !key.toLowerCase().includes(brand)) named.set(key, (named.get(key) ?? 0) + 1);
    }
  }
  const mapsRows: { name: string; rating: string; reviews: number }[] = [];
  for (const rk of lanes['H-maps']?.notes?.ranks ?? []) for (const s of rk.top ?? []) {
    const m = String(s).match(/^(.*) \(([\d.-]+)★, (\d+) reviews\)$/);
    if (m) mapsRows.push({ name: m[1], rating: m[2], reviews: Number(m[3]) });
  }
  const token = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').trim().split(/\s+/)[0] ?? '';
  const competitors = [...named.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([c, times]) => {
    const t = token(c);
    const row = mapsRows.filter((x) => token(x.name) === t).sort((a, b) => b.reviews - a.reviews)[0];
    return { name: c, token: t, ai_mentions: times, maps_rating: row?.rating ?? null, maps_reviews: row?.reviews ?? null, site: null as string | null, site_text: '' };
  });
  const ourListing = (lanes['H-maps']?.notes?.listings ?? [])[0];
  ctx.log(`competitors: ${competitors.map((c) => `${c.name} (${c.ai_mentions}× in AI, ${c.maps_reviews ?? '?'} reviews)`).join('; ')}`);

  // ---- The list pages AI read for the trade questions, and who is on them. ----
  const sr = lanes['G-grounded']?.notes?.search_results ?? {};
  const tradeUrls: string[] = Object.entries(sr).filter(([q]) => !q.toLowerCase().includes(brand)).flatMap(([, v]: any) => (Array.isArray(v) ? v : v?.rows ?? v?.results ?? []).map((x: any) => x.url ?? x)).filter(Boolean);
  for (const c of competitors) c.site = tradeUrls.find((u) => host(u).includes(c.token)) ?? null;
  const listPages = [...new Set(tradeUrls)].filter((u) => {
    const h = host(u);
    return h && !/exa\.ai|linkedin\.com|facebook\.com/.test(h) && !competitors.some((c) => h.includes(c.token)) && !h.includes(brand) && /\/(services|providers|industries|location|locations|directory|best|list)/i.test(new URL(u).pathname);
  }).slice(0, 5);
  const presence: { url: string; status: number; on: Record<string, boolean> }[] = [];
  for (const u of listPages) {
    const p = await ctx.page(u, { headers: { accept: 'text/html', 'accept-language': 'en-US,en;q=0.9' } });
    const text = ctx.htmlText(p.html).toLowerCase();
    const on: Record<string, boolean> = { [name]: text.includes(brand) };
    for (const c of competitors) on[c.name] = text.includes(c.token);
    presence.push({ url: u, status: p.status, on });
    if (p.status !== 200) ctx.warn(`list page ${u} answered ${p.status}${p.error ? ' ' + p.error : ''}`);
  }

  // ---- Competitor homepages and the company's own, as plain text for the LLM. ----
  for (const c of competitors.filter((c) => c.site)) {
    const p = await ctx.page(new URL(c.site!).origin + '/');
    c.site_text = clip(ctx.htmlText(p.html), 3000);
  }
  const ownSites: { url: string; text: string }[] = [];
  const seenFinal = new Set<string>();
  for (const d of id.official_domains ?? []) {
    const p = await ctx.page(`https://${d}/`, { headers: { accept: 'text/html' } });
    if (!p.html || seenFinal.has(host(p.finalUrl))) continue;
    seenFinal.add(host(p.finalUrl));
    ownSites.push({ url: p.finalUrl, text: clip(ctx.htmlText(p.html), 7000) });
  }

  const facts = (r.facts ?? []).filter((f: any) => f.confidence !== 'low').slice(0, 60).map((f: any) => `- ${f.fact}`).join('\n');
  // Register results override the dive's facts: proof points and FAQ may state only what a register
  // confirmed, use the register's value where it contradicts a claim, and never state an unverifiable claim as fact.
  const regs = (lanes['D-registry']?.findings ?? []).filter((f: Finding) => !/^PRIVATE/i.test(f.title));
  const regTruth = [
    ...regs.filter((f: Finding) => /VERIFIED|registered, grade/i.test(f.title)).map((f: Finding) => `- CONFIRMED by register: ${f.title.replace(/^VERIFIED:\s*/i, '')} (${clip(String(f.detail ?? ''), 160)})`),
    ...regs.filter((f: Finding) => /^CONTRADICTED/i.test(f.title)).map((f: Finding) => `- WRONG as claimed: ${f.title.replace(/^CONTRADICTED:\s*/i, '')}; register says: ${clip(String(f.detail ?? ''), 200)}`),
    ...regs.filter((f: Finding) => /^(CAN'T CHECK|NOT FOUND)/i.test(f.title)).map((f: Finding) => `- NOT VERIFIED (do not state as fact): ${f.title.replace(/^(CAN'T CHECK AUTOMATICALLY|NOT FOUND):\s*/i, '')}`),
  ].join('\n');
  const regRule = regTruth
    ? `\n\nRegister checks (these OVERRIDE the facts above):\n${regTruth}\nRules: proof points and credentials may only use CONFIRMED items, with the register's value. Never repeat a WRONG claim. Never state a NOT VERIFIED claim as fact. Where facts conflict with each other, leave the point out.\n`
    : '';
  const reviews: any[] = lanes['E-maps']?.notes?.reviews ?? [];
  const goodQuotes = reviews.filter((x) => x.stars >= 4 && String(x.text ?? '').length > 80).slice(0, 6).map((x) => `"${clip(String(x.text), 300)}"`).join('\n');
  const plan = lanes['H-maps']?.notes?.plan ?? {};

  // ---- 1. Website plan and homepage rewrite. ----
  const site = await askJson(ctx, 
    `You are a Malaysian SME website consultant. Write advice for ${name} (${id.industry}; HQ ${id.address}).\n` +
    `Verified facts:\n${facts}\n\nWhat customers praise in Google reviews (their own words):\n${goodQuotes || '(none)'}\n\n` +
    `Website problems we found:\n${brief(lanes['C-merged'], 35)}${regRule}\n` +
    `Customers search for: ${(plan.trades ?? []).join(', ')} in ${(plan.areas ?? []).join(', ')}.\n\n` +
    (ownSites.length ? ownSites.map((s) => `Current page ${s.url}:\n${s.text}`).join('\n\n') : 'The company has no website.') + '\n\n' +
    `Return JSON only:\n{"verdict": "2 sentences on the current site(s), plain words",\n` +
    `"homepage": {"headline": "under 12 words: what, where, proof", "subheadline": "1 sentence", "proof_points": ["4 short trust lines using ONLY register-CONFIRMED items"], "cta": "button text", ` +
    `"sections": [{"title": "", "body": "2-4 sentences of ready-to-paste copy"}] (4-6 sections, in page order)},\n` +
    `"pages_to_add": [{"slug": "/solar-installation-johor-bahru style", "title": "", "why": "1 sentence", "outline": ["3-5 bullet points"]}] (4-6 pages, service x town pages first),\n` +
    `"pages_to_fix": [{"page": "", "problem": "", "fix": ""}] (the most important 6-10 only),\n` +
    `"one_site_or_two": "1-2 sentences: should they keep two sites or merge, and why"}\n` +
    `Use only facts listed above; never invent numbers, awards or registrations. British English.`,
  'website plan');
  if (!site) ctx.warn('website plan did not parse');

  // ---- 2. AI-visibility plan, built in code from the measured evidence. ----
  // An LLM-written version was tried first: Vectide's content filter (VectorTide_content_retry_required)
  // blocked every phrasing of "help this company get mentioned over named rivals". Building the plan
  // from the evidence also keeps every line traceable to a measurement. The LLM only writes the FAQ.
  const ourOn = presence.filter((p) => p.on[name]).map((p) => host(p.url));
  const gaps = presence.filter((p) => !p.on[name] && competitors.some((c) => p.on[c.name]))
    .map((p) => ({ url: p.url, host: host(p.url), who: competitors.filter((c) => p.on[c.name]).map((c) => c.name) }));
  const ourReviews = Number(ourListing?.reviews ?? 0);
  const theirReviews = competitors.map((c) => c.maps_reviews).filter((n): n is number => typeof n === 'number');
  const medianTheirs = theirReviews.length ? [...theirReviews].sort((a, b) => a - b)[Math.floor(theirReviews.length / 2)] : null;
  const gTitles = ['G-fixed', 'G-grounded'].flatMap((l) => (lanes[l]?.findings ?? []).map((f: Finding) => f.title));
  const namedLine = gTitles.find((t) => /names you in \d+ of \d+/i.test(t)) ?? gTitles.find((t) => /names you/i.test(t));
  const fakeDomain = gTitles.find((t) => /does not exist/i.test(t));
  const wrongAddr = (lanes['G-fixed']?.findings ?? []).find((f: Finding) => /address/i.test(f.title) && /wrong claim/i.test(f.title));
  const noListing = (lanes['H-maps']?.findings ?? []).filter((f: Finding) => /^No Google Maps listing in /.test(f.title)).map((f: Finding) => f.title.replace('No Google Maps listing in ', ''));
  const webLine = (lanes['H-web']?.findings ?? []).find((f: Finding) => /customer searches/.test(f.title))?.title;
  const napIssues = (lanes['C-merged']?.findings ?? []).filter((f: Finding) => /phone|address|unit|masked/i.test(f.title) && ['high', 'medium'].includes(f.severity)).length;

  const why_they_win: string[] = [];
  for (const c of competitors) {
    const on = presence.filter((p) => p.on[c.name]).length;
    why_they_win.push(`${c.name}: ${c.maps_reviews ?? '?'} Google reviews (you have ${ourReviews}), on ${on} of the ${presence.length} "best installer" pages assistants read (you are on ${ourOn.length}).`);
  }
  if (webLine) why_they_win.push(`${webLine}. Assistants that search the web pick from what ranks.`);
  if (namedLine) why_they_win.push(`Measured: ${namedLine.replace(/^Neither .*? names you/, 'Assistants name you')}.`);

  const actions: any[] = [];
  if (gaps.length) actions.push({ action: `Get listed on ${gaps.map((g) => g.host).join(' and ')}`, why: `Assistants read these pages when asked for the best ${(plan.trades ?? ['installer'])[0]} in ${(plan.areas ?? [''])[0]}; ${gaps.map((g) => `${g.host} lists ${g.who.join(' and ')}`).join('; ')}, but not you.`, how: gaps.map((g) => `${g.url}: find its "add your business" or contact page and submit the company with the same name, address, phone and website as on Google Maps.`).join(' '), effort: '1–2 hours', impact: 'high' });
  if (medianTheirs && medianTheirs > ourReviews) actions.push({ action: `Grow Google reviews from ${ourReviews} towards ${medianTheirs}`, why: `The businesses mentioned instead have ${theirReviews.join(', ')} reviews; assistants and Maps both lean on review volume.`, how: 'Send every customer from the last 12 months the review request message (below), and make it a step at every handover. Reply to every review.', effort: 'ongoing, 15 min a week', impact: 'high' });
  if (napIssues) actions.push({ action: 'Use one name, address and phone everywhere', why: `We found ${napIssues} phone or address problems on your own sites; assistants repeat whichever version they read.`, how: 'Pick the HQ address and main number, then make the websites, the page data (JSON-LD below), all Google Maps listings, Facebook, LinkedIn and directory listings match exactly.', effort: '1 hour', impact: 'high' });
  if ((site?.pages_to_add ?? []).length) actions.push({ action: 'Add one page per service and town', why: `Searches like "${(plan.trades ?? [''])[0]} ${(plan.areas ?? [''])[0]}" are answered from pages that name the service and the town.`, how: `Start with ${site.pages_to_add.slice(0, 3).map((p: any) => p.slug).join(', ')} (outlines in the website plan).`, effort: '1–2 days', impact: 'high' });
  actions.push({ action: 'Publish an FAQ page with the answers below', why: 'Assistants quote short, factual answers; the FAQ gives them correct ones in your words.', how: 'Put the questions and answers below on one FAQ page and add FAQ page data to it.', effort: 'half a day', impact: 'medium' });
  if (noListing.length) actions.push({ action: `Create a Google Maps listing in ${noListing.join(', ')}`, why: `You have an office there but no listing, so neither Maps nor assistants can place you there.`, how: 'Create and verify a Google Business Profile for each branch with its own address and number.', effort: '1 day plus Google verification', impact: 'medium' });
  if (fakeDomain || wrongAddr) actions.push({ action: 'Correct the wrong details assistants give about you', why: [fakeDomain, wrongAddr?.title].filter(Boolean).join('; ') + '.', how: 'Make sure your LinkedIn page, directory listings and Wikipedia-style profiles (if any) all show the right website and address; assistants trained on old pages update as those pages change.', effort: '1 hour', impact: 'medium' });

  const faqOut = await askJson(ctx, 
    `Write the FAQ section for the website of ${name} (${id.industry}; HQ ${id.address}). Use ONLY these facts and say nothing they do not support:\n${facts}${regRule}\n` +
    `Write 7 questions a customer looking for this kind of business would ask, with 2–3 sentence answers. Include who they are, where they work, what they do, their registrations, how to contact them, and how a project works.\n` +
    `Return JSON only: {"faq": [{"q": "", "a": ""}]}. British English.`,
  'FAQ');
  if (!faqOut) ctx.warn('FAQ did not parse');
  const ai = {
    why_they_win, actions, faq: faqOut?.faq ?? [],
    measure: `Every month, ask the same ${gTitles.length ? 'questions' : 'customer questions'} to the same assistants and count how often you are named (now: ${namedLine ?? 'not measured'}); also re-check the list pages and your Maps rank.`,
  };

  // ---- 3. Review-reply drafts. ----
  const toReply = reviews.filter((x) => !x.reply && x.stars <= 3).concat(reviews.filter((x) => !x.reply && x.stars >= 5 && String(x.text ?? '').length > 60).slice(0, 2));
  const replies = toReply.length ? await askJson(ctx, 
    `Draft owner replies for ${name}'s Google reviews. Warm, specific, short (2-4 sentences), no excuses, no blame, offer a concrete next step for complaints with the main contact channel. ` +
    `Reply in the review's own language (if the original is Chinese, reply in Chinese and add an English version).\n` +
    toReply.map((x, i) => `${i}. ${x.stars}★ ${x.date} on "${x.listing}": ${x.original || x.text || '(no text, star only)'}`).join('\n') +
    `\n\nReturn JSON only: {"replies": [{"i": number, "reply": "", "reply_en": "only if the reply is not English", "note": "advice to the owner before posting, if any"}], "template_5star": "a reusable thank-you reply", "ask_message": "a short WhatsApp message to send customers after a job, asking for a Google review"}`,
  'review replies') : null;
  if (toReply.length && !replies) ctx.warn('review replies did not parse');

  // ---- 4. The business JSON-LD, in code from the dive's facts. ----
  const hw = lanes['H-web']?.notes?.unique ?? [];
  const sameAs = [...new Set(hw.filter((x: any) => x.class === 'own' && /facebook|instagram|linkedin|tiktok|youtube/.test(host(x.url))).map((x: any) => x.url.split('?')[0].replace(/\/(mentions|posts)\/?$/, '/')))];
  const addr = String(id.address ?? '');
  const postcode = addr.match(/\b\d{5}\b/)?.[0];
  const jsonld = {
    '@context': 'https://schema.org', '@type': 'LocalBusiness', name, legalName: name,
    url: ownSites[0]?.url ?? (id.official_domains?.[0] ? `https://${id.official_domains[0]}/` : undefined),
    telephone: ourListing?.phone ?? undefined,
    address: { '@type': 'PostalAddress', streetAddress: addr.split(postcode ?? '§')[0].replace(/,\s*$/, ''), postalCode: postcode, addressCountry: 'MY' },
    areaServed: plan.areas ?? [], sameAs,
    identifier: (id.registration_numbers ?? []).filter((x: string) => /^\d{12}$/.test(x)).map((x: string) => ({ '@type': 'PropertyValue', propertyID: 'SSM', value: x })),
  };

  findings.push({ title: 'Stage 2 consultation written', detail: `website plan ${site ? 'ok' : 'missing'}, AI plan ${ai ? 'ok' : 'missing'}, ${replies?.replies?.length ?? 0} review replies`, severity: 'info', source: null, checked_at: now });
  return { findings, notes: { competitors: competitors.map(({ site_text, ...c }) => c), presence, own_sites: ownSites.map((s) => s.url), site, ai, replies, reply_targets: toReply.map((x) => ({ stars: x.stars, date: x.date, listing: x.listing, author: x.author, text: x.text })), jsonld } };
}
