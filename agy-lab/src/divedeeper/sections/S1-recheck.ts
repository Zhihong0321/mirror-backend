// S1 / recheck — a second look at the findings an LLM judged, before anything is written about them.
//
// Several lanes (K-credibility, N-news, H-web, R-contacts, B-brand, and C-merged's copy-edit findings) decide by one pass of one small
// model. This lane puts every urgent and needs-work finding of those lanes in ONE prompt and asks: is it real, weak or false?
// editor.ts items() then drops the false ones and lowers the weak ones for everything after it (S2 to S5 and the report).
// Mechanical lanes (assets, speed, Maps) and the register results are never sent: a second model cannot overrule a measurement.
//
// It only removes or lowers. A reply that does not parse changes nothing; a call the content filter refuses is split in half.
// If it condemns more than 40% of what it was asked, it is not believed (check.ts tooMany) and its verdicts are ignored.
import { readLane, WRITE_LLM, type Ctx, type Finding } from '../lib.ts';
import { STAGE1_LANES, resolve, type Item } from '../editor.ts';
import { isJudged, tooMany, VERDICTS, type Verdict } from '../check.ts';

const BATCH = Number(process.env.S1_BATCH ?? 80);
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n) + ' …' : s);

export function promptOf(dive: any, name: string, entries: [string, Item][], register: string): string {
  const id = dive?.result?.identity ?? {};
  return `You are the second reviewer of an online presence audit for the owner of ${name}, a small Malaysian business. A first pass listed the findings below; check each one before it reaches the owner.\n\n` +
    `Settled facts about the company:\n- Legal name: ${id.legal_name ?? name}; registration numbers: ${(id.registration_numbers ?? []).join(', ') || 'unknown'}\n- Registered address: ${id.address ?? 'unknown'}\n- Official domains: ${(id.official_domains ?? []).join(', ') || 'unknown'}\n` +
    (register ? `Official register results (these settle anything they cover):\n${register}\n` : '') + `\n` +
    `For EACH finding decide:\n- "real": the evidence shown supports it, and a customer, bank or tender officer would care.\n- "weak": true, but too small to act on (a nitpick, a style preference, a harmless difference).\n` +
    `- "false": the evidence does not show it; or it is about a different business or person with a similar name; or it contradicts the settled facts or a register result; or it flags something the company does on purpose (brand names, Malay or Chinese text).\n` +
    `Use "false" only when you can say why in one short sentence. When unsure, say "real". Do not add findings.\n\n` +
    `Findings, as id | part | severity | finding | detail | evidence | source:\n` +
    entries.map(([k, x]) => `${k} | ${x.area} | ${x.severity} | ${clip(x.title, 220)} | ${clip(x.detail, 300)} | ${clip(String(x.raw?.evidence ?? ''), 200)} | ${x.source ?? ''}`).join('\n') +
    `\n\nReturn JSON only: {"verdicts":[{"id":"F1","verdict":"real|weak|false","why":"at most 20 words"}]} with one entry per finding.`;
}

export async function run(ctx: Ctx, dive: any): Promise<{ findings: Finding[]; notes: Record<string, unknown> }> {
  const L = Object.fromEntries(STAGE1_LANES.map((l) => [l, readLane(ctx.diveId, l)]));
  const R = resolve(dive, L);
  const asked = R.items.filter((x) => isJudged(x) && (x.severity === 'high' || x.severity === 'medium'));
  const ref = new Map<string, Item>(asked.map((x, i) => [`F${i + 1}`, x]));
  const register = R.credentials.list.filter((c: any) => !/can't check/.test(c.verdict)).slice(0, 14)
    .map((c: any) => `- ${c.verdict}${c.direction ? ` (${c.direction})` : ''}: ${clip(String(c.claim), 110)}; ${clip(String(c.detail ?? ''), 140)}`).join('\n');
  const raw: Record<string, { verdict: Verdict; why: string }> = {};

  const askBatch = async (entries: [string, Item][]): Promise<void> => {
    if (!entries.length) return;
    const got = ctx.parseJson<any>(await ctx.llm(promptOf(dive, R.name, entries, register), { ...WRITE_LLM, label: 'recheck findings' }));
    if (!got || !Array.isArray(got.verdicts)) {
      // Not JSON, or refused by the content filter over one finding: read each half on its own.
      if (entries.length > 1) {
        ctx.warn(`recheck of ${entries.length} findings did not parse; asking again as two calls`);
        const half = Math.ceil(entries.length / 2);
        await Promise.all([askBatch(entries.slice(0, half)), askBatch(entries.slice(half))]);
      } else ctx.warn(`recheck of ${entries[0][0]} did not parse; it stays as it was`);
      return;
    }
    for (const v of got.verdicts) {
      const k = String(v?.id ?? '').trim().toUpperCase();
      const verdict = String(v?.verdict ?? '').trim().toLowerCase() as Verdict;
      const why = clip(String(v?.why ?? '').trim(), 200);
      if (!ref.has(k) || !VERDICTS.includes(verdict)) continue;
      // "false" needs a reason. Without one it is only a doubt, and doubt means "real".
      raw[ref.get(k)!.key] = { verdict: verdict === 'false' && !why ? 'real' : verdict, why };
    }
  };
  const all = [...ref.entries()];
  const batches: [string, Item][][] = [];
  for (let i = 0; i < all.length; i += BATCH) batches.push(all.slice(i, i + BATCH));
  await Promise.all(batches.map((b) => askBatch(b)));

  const condemned = Object.values(raw).filter((v) => v.verdict !== 'real').length;
  const ignored = tooMany(condemned, asked.length);
  if (ignored) ctx.warn(`the recheck condemned ${condemned} of ${asked.length} findings; that is too many to believe, so its verdicts are ignored`);
  const verdicts = ignored ? {} : Object.fromEntries(Object.entries(raw).filter(([, v]) => v.verdict !== 'real'));
  const titleOf = new Map(asked.map((x) => [x.key, x.title]));
  const list = (kind: Verdict) => Object.entries(verdicts).filter(([, v]) => v.verdict === kind).map(([key, v]) => ({ key, title: titleOf.get(key) ?? '', why: v.why }));
  const dropped = list('false'), downgraded = list('weak');
  const unanswered = asked.filter((x) => !raw[x.key]).length;
  if (unanswered) ctx.warn(`${unanswered} of ${asked.length} findings got no verdict and stay as they were`);

  return {
    findings: [{ title: 'Findings rechecked', detail: `${asked.length} judged findings asked about, ${dropped.length} dropped as false, ${downgraded.length} lowered as weak${ignored ? ' (verdicts ignored: too many)' : ''}`, severity: 'info', source: null, checked_at: ctx.now() }],
    notes: { asked: asked.length, verdicts, dropped, downgraded, ignored, unanswered, raw },
  };
}
