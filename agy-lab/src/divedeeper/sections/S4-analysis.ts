// S4 / analysis — dive-deeper stage 4: one full analysis, read across all six research parts.
//
//   node scripts/dive-deeper/run.ts S4 analysis <diveId>
//
// Reads every stage-1 lane, S2 and S3 (for the owner's plain titles) from out/. Works out the
// settled numbers in code (editor.ts resolve: the register beats the research), then one LLM call
// writes the whole analysis: the verdict, the three stories that cost the most customers, a short
// assessment of each part, the threads that run through several parts, what to build on, the risks,
// the opportunities, and the few things a stranger would notice do not add up.
// No answer keeps the report's built-in wording for every block.
import fs from 'node:fs';
import path from 'node:path';
import { OUT, type Ctx, type Finding } from '../lib.ts';
import { AREAS, STAGE1_LANES, resolve, type Item } from '../editor.ts';

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n) + ' …' : s);
const THEMES = AREAS.map((a) => a.id);
const THEME_HELP = 'contact = contact and reachability, understanding = how the internet understands the brand, voice = reviews, discussion and news, credibility = official records and licences, assets = domains, hosting and email, speed = Google PageSpeed scores of the official homepages';

function stage(diveId: string, lane: string): any | null {
  const file = path.join(OUT, `${lane}-${diveId}.json`);
  try { return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null; } catch { return null; }
}

async function askJson(ctx: Ctx, prompt: string, label: string): Promise<any> {
  for (let attempt = 1; attempt <= 2; attempt++) {
    const got = ctx.parseJson(await ctx.llm(prompt, { label }));
    if (got) return got;
    ctx.warn(`${label} did not parse (attempt ${attempt})`);
  }
  return null;
}

/** Every measured number the analysis may use, from the settled set. */
export function factsOf(R: ReturnType<typeof resolve>) {
  return {
    areas: R.areas.map((a) => ({ area: a.id, status: a.status[1], measured: a.metric })),
    reviews: { answered: `${R.reviews.replied} of ${R.reviews.total}`, listings: R.reviews.listings, unanswered_bad_reviews: R.reviews.unanswered_low.map((x) => ({ stars: x.stars, date: x.date, days_without_reply: x.days_open, text: clip(x.text, 200) })), review_spikes: R.reviews.bursts, same_reviewers_on_two_listings: R.reviews.cross_reviewers, praised_for: R.reviews.praise },
    google_maps: R.maps.by_area.map((a) => ({ town: a.area, your_best_rank: a.best_rank, of: a.of, shown_first: a.top.slice(0, 3) })), no_maps_listing_in: R.maps.no_listing_in, your_listing: R.maps.our,
    ai_assistants: { recommended_you: `${R.ai.named_us} of ${R.ai.trade_answers} answers to "${R.ai.trade_question}"`, named_instead: R.ai.share.slice(0, 5), from_memory: R.ai.memory?.models, with_web_search: R.ai.search?.models, wrong_things_said: R.ai.memory?.wrong_examples },
    licences: { cidb_grade_on_official_register: R.credentials.cidb_grade, claims: R.credentials.list.map((c: any) => `${c.verdict}${c.direction ? ` (${c.direction})` : ''}: ${clip(c.claim, 120)}`) },
    website: R.website,
    contact_points: { reach_you: `${R.contact.ok} of ${R.contact.total}`, wrong_way: R.contact.points.filter((p: any) => !['current', 'unclear'].includes(p.status)).slice(0, 8).map((p: any) => `${p.kind} ${p.value}: ${p.status}${p.left ? ' (someone who has left)' : ''}; ${clip(String(p.reason ?? ''), 140)}`) },
    brand: { understood_out_of_100: R.brand_view.score, why_choose_you: R.brand_view.why, five_second_test: R.brand_view.five, offer: R.brand_view.offer, unanswered_buyer_questions: R.brand_view.missing },
    news_and_discussion: { counts: R.news.counts, negative: R.news.items.filter((x: any) => x.sentiment === 'negative').slice(0, 5).map((x: any) => `${x.date} ${x.host}: ${clip(String(x.summary), 160)}`) },
    official_records: R.records.checks.map((c: any) => `${c.label}: ${c.result}; ${clip(String(c.detail), 160)}`),
    google_pagespeed: R.speed.pages.map((p: any) => ({ site: p.site, device: p.strategy, scores: p.scores, real_visitors: p.field?.overall ?? null, top_fixes: (p.fixes ?? []).slice(0, 3).map((f: any) => f.title) })),
    digital_assets: R.assets.domains.map((d: any) => ({ domain: d.domain, expires: d.expires, registrant: d.registrant, email_by: d.mail, dmarc: d.dmarc, site_status: d.site?.status ?? null })),
  };
}

export async function run(ctx: Ctx, dive: any): Promise<{ findings: Finding[]; notes: Record<string, unknown> }> {
  const L = Object.fromEntries([...STAGE1_LANES, 'S2-consult', 'S3-editor'].map((l) => [l, stage(ctx.diveId, l)]));
  for (const [l, v] of Object.entries(L)) if (!v) ctx.warn(`${l}-${ctx.diveId}.json missing; the analysis skips what it covers`);
  const R = resolve(dive, L);
  const name = R.name;
  const plain: Record<string, { title: string }> = L['S3-editor']?.notes?.plain ?? {};
  const T = (x: Item) => plain[x.key]?.title ?? x.title;
  const urgent = (area: string) => R.items.filter((x) => x.area === area && (x.severity === 'high' || x.severity === 'medium')).slice(0, 10).map((x) => `- [${x.severity}] ${T(x)}`).join('\n');
  const good = (area: string) => R.items.filter((x) => x.area === area && (x.severity === 'info' || x.severity === 'low')).slice(0, 4).map((x) => `- ${T(x)}`).join('\n');

  // Only these register results may settle a mismatch; the analysis cites one by its R-number.
  const regs = R.credentials.list.filter((c: any) => !/can't check/.test(c.verdict));
  const regLines = regs.map((c: any, i: number) => `R${i + 1}: ${c.verdict}${c.direction ? ` (${c.direction})` : ''}: ${clip(c.claim, 110)}; ${clip(c.detail, 160)}`).join('\n');
  const mismatchesIn = (dive?.result?.contradictions ?? []).slice(0, 14).map((c: string) => `- ${c.replace(/\[\d+\]/g, '').replace(/\s+/g, ' ').trim()}`).join('\n');

  const an = await askJson(ctx,
    `You are the senior consultant signing an online presence audit for the owner of ${name} (${R.identity.industry}). We researched six parts of the business (${THEME_HELP}). Write the full analysis that reads across all six. Plain British English, warm but direct, no hype, no jargon, every claim backed by the facts below. Speak to the owner as "you".\n\n` +
    `Measured facts (settled; where an official register is given it is the truth):\n${JSON.stringify(factsOf(R))}\n\n` +
    `Urgent and needs-work items by part:\n${THEMES.map((t) => `## ${t}\n${urgent(t) || '(none)'}`).join('\n')}\n\n` +
    `Good news and notes by part:\n${THEMES.map((t) => `## ${t}\n${good(t) || '(none)'}`).join('\n')}\n\n` +
    `Things public sources disagree on about the company:\n${mismatchesIn || '(none)'}\n\n` +
    `Official register results (the only things that settle anything):\n${regLines || '(none)'}\n\n` +
    `Return JSON only:\n{"verdict": "3 sentences: where they stand, the single biggest risk, the single biggest opportunity. Use real numbers.",\n` +
    `"stories": [{"theme": "one of ${THEMES.join(', ')}", "headline": "at most 12 words, includes a real number", "body": "2-3 sentences: what we found and why it matters", "cost": "1 sentence: how this loses customers or money", "fix": "1 sentence: the first thing to do"}] (exactly 3, different themes, the three costing the most customers first),\n` +
    `"parts": [{"theme": "one of ${THEMES.join(', ')}", "assessment": "2 sentences: what this part shows about the business, with its number"}] (one per part above, in that order),\n` +
    `"threads": [{"title": "at most 10 words", "body": "2-3 sentences: one cause that shows up in several parts, and what fixing it once would solve", "themes": ["the parts it runs through"]}] (2-4, the causes behind the most findings first),\n` +
    `"strengths": ["1 sentence each: something verified the business can build on"] (3-4),\n` +
    `"risks": ["1 sentence each: what could go wrong if nothing changes, tied to a finding"] (3),\n` +
    `"opportunities": ["1 sentence each: what the business could win, tied to a finding"] (3),\n` +
    `"mismatch": [{"issue": "1 sentence a customer, bank or tender officer would notice", "settled_by": "the R-number of the register result above that settles it, or null; directories, portfolio sites and the company's own pages settle nothing"}] (at most 5, the ones that most hurt trust; drop any the register settles in the company's favour unless their own site still says the wrong thing)}`,
  'analysis');
  if (!an) ctx.warn('analysis did not parse; the report uses its built-in wording');

  const one = <T,>(list: any, ok: (x: any) => boolean, n: number): T[] => (Array.isArray(list) ? list.filter(ok).slice(0, n) : []);
  const stories = one<any>(an?.stories, (s) => THEMES.includes(s?.theme), 6).filter((s, i, a) => a.findIndex((x) => x.theme === s.theme) === i).slice(0, 3);
  const parts = one<any>(an?.parts, (p) => THEMES.includes(p?.theme) && typeof p.assessment === 'string', 6);
  const threads = one<any>(an?.threads, (t) => typeof t?.title === 'string' && typeof t.body === 'string', 4)
    .map((t) => ({ title: t.title, body: t.body, themes: (Array.isArray(t.themes) ? t.themes : []).filter((x: string) => THEMES.includes(x as any)) }));
  const lines = (list: any, n: number) => one<string>(list, (x) => typeof x === 'string' && x.trim(), n);
  const mismatch = one<any>(an?.mismatch, (m) => m?.issue, 5).map((m) => {
    const reg = regs[Number(String(m?.settled_by ?? '').replace(/\D/g, '')) - 1];
    return { issue: String(m.issue), settled: reg ? `${reg.verdict === 'verified' ? 'confirms' : reg.direction === 'undersell' ? 'shows better than you claim' : reg.verdict === 'contradicted' ? 'contradicts' : 'has no record of'}: ${clip(reg.claim, 110)}` : null, source: reg?.source ?? null };
  });

  return {
    findings: [{ title: 'Full analysis written', detail: `verdict ${an?.verdict ? 'ok' : 'missing'}, ${stories.length} stories, ${parts.length} part assessments, ${threads.length} threads, ${mismatch.length} mismatches`, severity: 'info', source: null, checked_at: ctx.now() }],
    notes: { verdict: an?.verdict ?? null, stories, parts, threads, strengths: lines(an?.strengths, 4), risks: lines(an?.risks, 3), opportunities: lines(an?.opportunities, 3), mismatch },
  };
}
