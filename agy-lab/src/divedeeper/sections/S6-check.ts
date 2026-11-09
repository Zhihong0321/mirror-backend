// S6 / check — the last look: is every statement the report prints supported by the findings?
//
// S3 rewrote the findings in plain words, S4 summarised them, S5 turned them into tasks. Each pass can drift from the evidence. This lane
// puts every statement S4 and S5 wrote in ONE prompt, with the findings and the measured facts as the only evidence, and marks each
// supported or unsupported. check.ts applyCheck() takes the unsupported ones out when the report is built (and a withdrawn task puts
// its findings back under its department). It only removes: a reply that does not parse changes nothing, a call the content filter
// refuses is split in half, and a check that condemns more than 40% of the statements is not believed.
import { readLane, type Ctx, type Finding } from '../lib.ts';
import { STAGE1_LANES, resolve } from '../editor.ts';
import { statements, tooMany, type Statement } from '../check.ts';
import { factsOf } from './S4-analysis.ts';

const BATCH = Number(process.env.S6_BATCH ?? 120);
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n) + ' …' : s);

export function promptOf(name: string, evidence: string, facts: string, list: Statement[]): string {
  return `You are the fact checker of an online presence audit for the owner of ${name}. Below is EVIDENCE (the findings and measured facts), then STATEMENTS the report is about to print. Check each statement against the evidence only.\n\n` +
    `For EACH statement decide:\n- "supported": every number, name, date and claim in it appears in the evidence or follows directly from it. Advice ("do X") is supported when the finding it responds to is in the evidence. Plain-word rewording of a finding is fine.\n` +
    `- "unsupported": it states a number, name, date or claim that the evidence does not contain, or it contradicts the evidence.\n` +
    `A statement calling something independent, third-party or verified by someone is supported only if the findings it rests on come from an independent source (party is 'independent', or the finding is a register, government or RDAP result); if they are only the company's own pages, listings or entries it submitted, mark it unsupported.\n` +
    `Use "unsupported" only when you can name the part that is missing or wrong in one short sentence. When unsure, say "supported". Do not rewrite anything.\n\n` +
    `MEASURED FACTS (settled):\n${facts}\n\nFINDINGS (the evidence), as part | severity | finding | detail | party:\n${evidence}\n\n` +
    `STATEMENTS, as id | kind | text:\n${list.map((s) => `${s.id} | ${s.kind} | ${clip(s.text, 600)}`).join('\n')}\n\n` +
    `Return JSON only: {"checks":[{"id":"stories.0","verdict":"supported|unsupported","why":"at most 20 words"}]} with one entry per statement, using the ids above.`;
}

export async function run(ctx: Ctx, dive: any): Promise<{ findings: Finding[]; notes: Record<string, unknown> }> {
  const L = Object.fromEntries([...STAGE1_LANES, 'S1-recheck', 'S2-consult', 'S3-editor', 'S4-analysis', 'S5-plan'].map((l) => [l, readLane(ctx.diveId, l)]));
  const R = resolve(dive, L);
  const list = statements(L['S4-analysis']?.notes, L['S5-plan']?.notes);
  if (!list.length) {
    ctx.warn('S4 and S5 wrote no statements; nothing to check');
    return { findings: [{ title: 'Report statements checked', detail: 'nothing to check', severity: 'info', source: null, checked_at: ctx.now() }], notes: { asked: 0, unsupported: [], ignored: false } };
  }
  const plain: Record<string, { title: string }> = L['S3-editor']?.notes?.plain ?? {};
  const evidence = R.items.map((x) => `${x.area} | ${x.severity} | ${clip(plain[x.key]?.title ?? x.title, 160)} | ${clip(x.detail, 260)} | ${x.raw.party ?? ''}`).join('\n');
  const facts = JSON.stringify(factsOf(R));
  const byId = new Map(list.map((s) => [s.id, s]));
  const raw: Record<string, { verdict: 'supported' | 'unsupported'; why: string }> = {};

  const askBatch = async (batch: Statement[]): Promise<void> => {
    if (!batch.length) return;
    const got = ctx.parseJson<any>(await ctx.llm(promptOf(R.name, evidence, facts, batch), { label: 'check statements' }));
    if (!got || !Array.isArray(got.checks)) {
      if (batch.length > 1) {
        ctx.warn(`check of ${batch.length} statements did not parse; asking again as two calls`);
        const half = Math.ceil(batch.length / 2);
        await Promise.all([askBatch(batch.slice(0, half)), askBatch(batch.slice(half))]);
      } else ctx.warn(`check of ${batch[0].id} did not parse; it stays`);
      return;
    }
    for (const c of got.checks) {
      const id = String(c?.id ?? '').trim();
      const verdict = String(c?.verdict ?? '').trim().toLowerCase();
      const why = clip(String(c?.why ?? '').trim(), 200);
      if (!byId.has(id) || (verdict !== 'supported' && verdict !== 'unsupported')) continue;
      // "unsupported" needs a reason; without one it is only a doubt, and doubt means "supported".
      raw[id] = { verdict: verdict === 'unsupported' && !why ? 'supported' : verdict, why };
    }
  };
  const batches: Statement[][] = [];
  for (let i = 0; i < list.length; i += BATCH) batches.push(list.slice(i, i + BATCH));
  await Promise.all(batches.map((b) => askBatch(b)));

  const bad = Object.entries(raw).filter(([, v]) => v.verdict === 'unsupported');
  const ignored = tooMany(bad.length, list.length);
  if (ignored) ctx.warn(`the check condemned ${bad.length} of ${list.length} statements; that is too many to believe, so they all stay`);
  const unsupported = ignored ? [] : bad.map(([id, v]) => ({ id, kind: byId.get(id)!.kind, text: clip(byId.get(id)!.text, 300), why: v.why }));
  const unanswered = list.filter((s) => !raw[s.id]).length;
  if (unanswered) ctx.warn(`${unanswered} of ${list.length} statements got no verdict and stay`);
  return {
    findings: [{ title: 'Report statements checked', detail: `${list.length} statements checked against the findings, ${unsupported.length} withdrawn as unsupported${ignored ? ' (verdicts ignored: too many)' : ''}`, severity: 'info', source: null, checked_at: ctx.now() }],
    notes: { asked: list.length, unsupported, ignored, unanswered, raw },
  };
}
