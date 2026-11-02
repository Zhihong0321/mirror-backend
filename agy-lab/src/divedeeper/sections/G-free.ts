// G / free — how AI sees you, with FREE-FORM prompts in a customer's own voice.
// One LLM call writes ~6 messages a real customer of this company's trade, in its area,
// might type into an AI assistant (budget, bill size, comparisons, Manglish, Chinese/Malay),
// some naming the company and most not. Every model answers each; the judge extracts what
// the answer says about the company (or that it is absent) and which competitors it names.
//
// Calls: 1 (profile) + 1 (prompts) + 6 x 2 answers + 6 x 2 judge = 26 LLM calls. No Exa.
// Env: DD_G_TEMP (answer temperature), DD_G_MAX, DD_G_MODELS, DD_G_JUDGE,
//      DD_G_REUSE=1 reuses the prompts saved in the last out/G-free-<id>.json, so two runs
//      at different temperatures ask exactly the same things.
// Limit: answers reflect training data unless the model searches by itself (gpt-6.1-sol does;
// see `searched` on each answer).
import fs from 'node:fs';
import path from 'node:path';
import { OUT, type Ctx, type Finding } from '../lib.ts';
import { ANSWER_MODELS, ANSWER_TEMP, JUDGE_MODEL, MAX_PROMPTS, usageByModel, askAndJudge, findingsFrom, profileOf, signatures, type Profile, type Prompt } from './G-shared.ts';

async function customerPrompts(ctx: Ctx, dive: any, p: Profile): Promise<Prompt[]> {
  if (process.env.DD_G_REUSE) {
    try {
      const prev = JSON.parse(fs.readFileSync(path.join(OUT, `G-free-${ctx.diveId}.json`), 'utf8'));
      if (prev.notes?.prompts?.length) { ctx.log(`reusing ${prev.notes.prompts.length} prompts from the last run`); return prev.notes.prompts; }
    } catch { /* fall through and generate */ }
    ctx.warn('DD_G_REUSE set but no previous prompts found; generating new ones');
  }
  const services = (dive.result?.facts ?? []).filter((f: any) => f.topic === 'products_services').slice(0, 6).map((f: any) => '- ' + f.fact).join('\n');
  const raw = await ctx.llm(
    `Company: ${p.name} (brand "${p.brand}"; other names: ${p.aliases.join(', ')}). Trade: ${p.trade}. HQ area: ${p.area}, ${p.state}, Malaysia.\nWhat it sells:\n${services}\n\n` +
    `Write 6 messages that real Malaysian customers might type into ChatGPT when they need a ${p.trade} in or near ${p.area}. ` +
    `Write them in the customer's own voice: specific, informal, with real numbers where natural (a monthly electricity bill, a budget, house type, roof size). ` +
    `Mix: 3 that do NOT name any company (the customer wants recommendations); 1 that names "${p.brand}" and asks if they are legit or worth it (e.g. "my friend recommended..."); ` +
    `1 that asks to compare "${p.brand}" with one or two well-known competitors you name; 1 written in Malay or Chinese (Malaysian style), not naming any company. ` +
    `Return JSON [{"text": "...", "names_company": true|false, "lang": "en"|"ms"|"zh"}]. JSON only.`,
    { temperature: 0 },
  );
  const arr = ctx.parseJson<any[]>(raw);
  if (!Array.isArray(arr) || !arr.length) {
    ctx.warn('prompt generator gave no list; using 3 fallback prompts');
    return [
      { id: 'f1', kind: 'trade', text: `I live in ${p.area}. Which ${p.trade} should I get? Please name companies.`, lang: 'en' },
      { id: 'f2', kind: 'company', text: `My friend recommended ${p.brand} in ${p.area}. Are they legit?`, lang: 'en' },
      { id: 'f3', kind: 'company', text: `${p.brand} vs other ${p.trades} in ${p.state}, which is better?`, lang: 'en' },
    ];
  }
  const re = new RegExp([p.name, p.brand, ...p.aliases].map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'i');
  return arr.filter((x) => x?.text).map((x, i) => ({
    id: `f${i + 1}`,
    // Trust the text over the generator's flag: a prompt that names the company is a company prompt.
    kind: re.test(String(x.text)) ? 'company' as const : 'trade' as const,
    text: String(x.text), lang: String(x.lang ?? 'en'),
  }));
}

export async function run(ctx: Ctx, dive: any): Promise<{ findings: Finding[]; notes: Record<string, unknown> }> {
  const profile = await profileOf(ctx, dive);
  ctx.log(`profile: ${profile.name} | ${profile.trade} | ${profile.area}, ${profile.state}`);
  let prompts = await customerPrompts(ctx, dive, profile);
  if (MAX_PROMPTS < prompts.length) prompts = prompts.slice(0, MAX_PROMPTS);
  prompts.forEach((q) => ctx.log(`${q.id} [${q.kind}/${q.lang}] ${q.text}`));
  const judged = await askAndJudge(ctx, dive, profile, prompts);
  const findings = findingsFrom(ctx, profile, judged, prompts);
  return {
    findings,
    notes: {
      profile, answer_temperature: ANSWER_TEMP, models: ANSWER_MODELS, judge: JUDGE_MODEL, usage_by_model: usageByModel(ctx),
      prompts, signatures: signatures(judged),
      answers: judged.map((j) => ({ id: j.prompt.id, model: j.model, outcome: j.outcome, searched: j.searched, stub: j.stub, answer: j.answer, claims: j.claims, dropped: j.dropped, competitors: j.competitors, confused_with: j.confused_with, recommended: j.recommended, judge_summary: j.judge_summary })),
      limit: 'Answers reflect training data unless the model searched by itself (see searched).',
    },
  };
}
