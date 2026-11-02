// G / grounded — how a SEARCH-ENABLED assistant (Perplexity, ChatGPT with search) sees you.
// Same fixed questions as G-fixed, but each model first gets Exa search results for the
// question, as a search assistant would. The gap between G-fixed and this lane shows what is
// missing from training data versus what is missing from the web itself.
//
// Calls: 1 (profile) + 11 x 2 answers + 11 x 2 judge = 45 LLM calls; 9 Exa calls
// (the phone, website and address questions share one contact search).
// Env: DD_G_TEMP, DD_G_MAX, DD_G_MODELS, DD_G_JUDGE; DD_G_REUSE=1 reuses the search results
// saved in the last out/G-grounded-<id>.json (0 Exa calls), to compare two runs on the same evidence.
import fs from 'node:fs';
import path from 'node:path';
import { OUT, type Ctx, type Finding } from '../lib.ts';
import { ANSWER_MODELS, ANSWER_TEMP, BRIEF, JUDGE_MODEL, MAX_PROMPTS, usageByModel, askAndJudge, checkDomains, findingsFrom, profileOf, signatures, type Prompt } from './G-shared.ts';
import { fixedQuestions } from './G-fixed.ts';

const SYSTEM = 'You are a helpful assistant with web search. Use the search results provided when they are relevant, cite the URLs you rely on, and say so when the results do not answer the question.';

export async function run(ctx: Ctx, dive: any): Promise<{ findings: Finding[]; notes: Record<string, unknown> }> {
  const profile = await profileOf(ctx, dive);
  const prompts = fixedQuestions(profile);
  void MAX_PROMPTS;
  // One search per question, contact questions share one.
  const queryOf = (p: Prompt) => ['phone', 'website', 'address'].includes(p.id) ? `${profile.name} contact phone address website` : p.text;
  const queries = [...new Set(prompts.map(queryOf))];
  const results = new Map<string, any[]>();
  if (process.env.DD_G_REUSE) {
    try {
      const prev = JSON.parse(fs.readFileSync(path.join(OUT, `G-grounded-${ctx.diveId}.json`), 'utf8'));
      for (const [q, r] of Object.entries(prev.notes?.search_results ?? {})) results.set(q, r as any[]);
      ctx.log(`reusing search results for ${results.size} queries`);
    } catch { ctx.warn('DD_G_REUSE set but no previous search results; searching'); }
  }
  for (const q of queries) {
    if (results.has(q)) continue;
    const r = await ctx.exa(q, { numResults: 6, text: 1200 });
    if (!r.length) ctx.warn(`exa: no results for "${q}"`);
    results.set(q, r);
  }
  // Round 3: the judge sees the same search results, so real details from search are "sourced", not "wrong".
  const evidence = (p: Prompt) => (results.get(queryOf(p)) ?? []).map((x: any, i: number) => `[${i + 1}] ${x.title ?? ''} — ${x.url}\n${String(x.text ?? '').replace(/\s+/g, ' ').slice(0, 1200)}`).join('\n\n');
  const context = (p: Prompt) => {
    const r = results.get(queryOf(p)) ?? [];
    if (!r.length) return '';
    return 'Web search results:\n' + r.map((x: any, i: number) => `[${i + 1}] ${x.title ?? ''} — ${x.url}\n${String(x.text ?? '').replace(/\s+/g, ' ').slice(0, 1200)}`).join('\n\n') + '\n\nQuestion: ';
  };
  const judged = await askAndJudge(ctx, dive, profile, prompts, { context, system: SYSTEM, evidence });
  const findings = findingsFrom(ctx, profile, judged, prompts);
  // Which of our own pages does the search even surface?
  const domains = (dive.result?.identity?.official_domains ?? []).map((d: string) => d.replace(/^www\./, ''));
  const hits = queries.map((q) => ({ q, urls: (results.get(q) ?? []).map((x: any) => x.url), own: (results.get(q) ?? []).filter((x: any) => domains.some((d: string) => String(x.url).includes(d))).length }));
  // Round 3 fix: pick the trade searches by prompt kind. The old filter (!/contact/) also dropped the hire
  // question, whose text ends "Which companies should I contact?".
  const tradeQ = new Set(prompts.filter((p) => p.kind === 'trade').map(queryOf));
  for (const h of hits.filter((h) => tradeQ.has(h.q))) {
    findings.push({ title: `A web search for "${h.q}" returns ${h.own} of your pages in the top ${h.urls.length}`, detail: h.urls.join(' | '), severity: h.own ? 'info' : 'high', source: null, checked_at: ctx.now(), kind: 'search' });
  }
  const dom = await checkDomains(ctx, dive, profile, judged);
  findings.push(...dom.findings);
  return {
    findings,
    notes: {
      profile, answer_temperature: ANSWER_TEMP, brief: BRIEF, domains: dom.domains, max_answer_chars: Math.max(0, ...judged.map((j) => j.answer.length)), models: ANSWER_MODELS, judge: JUDGE_MODEL, usage_by_model: usageByModel(ctx),
      prompts, search_hits: hits, search_results: Object.fromEntries([...results].map(([q, r]) => [q, r.map((x: any) => ({ title: x.title, url: x.url, text: String(x.text ?? '').slice(0, 1200) }))])), signatures: signatures(judged),
      answers: judged.map((j) => ({ id: j.prompt.id, model: j.model, outcome: j.outcome, searched: j.searched, stub: j.stub, answer: j.answer, claims: j.claims, dropped: j.dropped, competitors: j.competitors, confused_with: j.confused_with, recommended: j.recommended, judge_summary: j.judge_summary })),
      limit: 'Simulated search assistant: Exa results pasted into the prompt. Real Perplexity/ChatGPT use their own search index and ranking.',
    },
  };
}
