// H / plan — the search phrases and towns both H lanes use for one company, picked once
// by the LLM and stored in out/H-plan-<diveId>.json, so ranks stay comparable between runs
// (round 2 showed the LLM picking new trade words every run). Delete the file to re-pick.
import fs from 'node:fs';
import path from 'node:path';
import { OUT, type Ctx } from '../lib.ts';

export type HPlan = { trades: string[]; areas: string[]; offices: string[]; picked_at: string };

export async function getPlan(ctx: Ctx, dive: any): Promise<HPlan> {
  const file = path.join(OUT, `H-plan-${ctx.diveId}.json`);
  try {
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) { ctx.warn(`could not read ${file}: ${(e as Error).message}`); }

  const r = dive.result ?? {};
  const id = r.identity ?? {};
  const footprint = (r.facts ?? []).filter((f: any) => ['footprint', 'identity', 'products_services'].includes(f.topic)).map((f: any) => '- ' + f.fact).join('\n');
  const got = ctx.parseJson(await ctx.llm(
    `A Malaysian customer looks for a company like this on Google. Company: ${dive.company}. Industry: ${id.industry}. HQ: ${id.address}.\nFacts:\n${footprint}\n\n` +
    `Return JSON {"trades": [2 short search phrases a customer would type for its MAIN trade, e.g. "solar panel installer"], ` +
    `"offices": [Malaysian towns or cities where the company has an office, branch or showroom, HQ first], ` +
    `"areas": [up to 4 Malaysian towns or cities (never a state or a country) a customer would search in: its office towns first, then, if it serves a wider area, the biggest nearby cities]}. JSON only.`,
  ));
  const town = String(id.address ?? '').split(',').map((s: string) => s.replace(/\d{5}/, '').trim()).filter(Boolean).slice(-2, -1)[0] || 'Kuala Lumpur';
  const plan: HPlan = {
    trades: (got?.trades ?? []).slice(0, 2),
    offices: (got?.offices ?? []).slice(0, 6),
    areas: (got?.areas ?? []).slice(0, 4),
    picked_at: ctx.now(),
  };
  if (!plan.trades.length) { ctx.warn('no trades from the LLM; falling back to the industry'); plan.trades = [String(id.industry ?? 'company').split(/[,(]/)[0].trim()]; }
  if (!plan.areas.length) { ctx.warn('no areas from the LLM; falling back to the HQ town'); plan.areas = [town]; }
  if (!plan.offices.length) plan.offices = [plan.areas[0]];
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(plan, null, 2));
  return plan;
}
