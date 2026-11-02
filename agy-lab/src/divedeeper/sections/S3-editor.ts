// S3 / editor — dive-deeper stage 3: turn the findings into a report an owner will read.
//
//   node scripts/dive-deeper/run.ts S3 editor <diveId>
//
// Reads every stage-1 lane and S2 from out/. Works out one settled set of numbers in code
// (editor.ts resolve: the register beats the research where they disagree), then:
//   1. rewrites every finding title in plain English for the owner (batches of 35),
//   2. takes proof screenshots of the worst website problems, with the problem outlined.
// The verdict, the stories and the rest of the analysis are S4's (sections/S4-analysis.ts).
// Every step falls back: no LLM answer keeps the lane's own wording, no browser means no shots.
import fs from 'node:fs';
import path from 'node:path';
import { OUT, type Ctx, type Finding } from '../lib.ts';
import { STAGE1_LANES, resolve, type Item } from '../editor.ts';
import { takeShots, type ShotAsk } from '../shots.ts';

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n) + ' …' : s);

function stage(diveId: string, lane: string): any | null {
  const file = path.join(OUT, `${lane}-${diveId}.json`);
  try { return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null; } catch { return null; }
}

async function askJson(ctx: Ctx, prompt: string, label: string, attempts = 2): Promise<any> {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const got = ctx.parseJson(await ctx.llm(prompt, { label }));
    if (got) return got;
    ctx.warn(`${label} did not parse (attempt ${attempt})`);
  }
  return null;
}

/** The worst website problems a screenshot can prove, plus the homepage on a phone for the cover. */
export function shotAsks(R: ReturnType<typeof resolve>, ownSite: string | null): ShotAsk[] {
  const site = R.items.filter((x) => x.lane === 'C-merged' && x.source && /^https?:/.test(x.source));
  const asks: ShotAsk[] = [];
  const add = (x: Item | undefined, find: string | null, caption: string) => {
    if (x && !asks.some((a) => a.url === x.source)) asks.push({ key: x.key, url: x.source!, find, caption });
  };
  const leak = site.find((x) => x.check === 'leaked-note');
  add(leak, leak ? String(leak.raw?.evidence ?? '').slice(0, 50) : null, 'Text left on the page that was never meant for customers');
  // The masked number in page data is invisible; shoot the one printed on the page, if any.
  const masked = site.find((x) => x.check === 'llm' && /\*{3,}/.test(String(x.raw?.evidence ?? '')));
  const maskedNo = String(masked?.raw?.evidence ?? '').match(/\+?\d[\d*]{6,}\d/)?.[0] ?? null;
  if (masked && maskedNo) add(masked, maskedNo, 'A phone number customers cannot dial');
  add(site.find((x) => x.check === 'placeholder'), 'Coming Soon', 'A service page with nothing on it');
  add(site.find((x) => x.check === 'page-status' && x.severity === 'high'), null, 'A page your homepage links to, which does not exist');
  const out = asks.slice(0, 4);
  if (ownSite) out.unshift({ key: 'cover', url: ownSite, find: null, caption: 'Your homepage on a phone', mobile: true });
  return out;
}

export async function run(ctx: Ctx, dive: any): Promise<{ findings: Finding[]; notes: Record<string, unknown> }> {
  const L = Object.fromEntries([...STAGE1_LANES, 'S2-consult'].map((l) => [l, stage(ctx.diveId, l)]));
  for (const [l, v] of Object.entries(L)) if (!v) ctx.warn(`${l}-${ctx.diveId}.json missing; the report skips what it covers`);
  const R = resolve(dive, L);
  const now = ctx.now();
  const name = R.name;

  // ---- 1. Plain titles. ----
  const plain: Record<string, { title: string; why: string }> = {};
  const batches: Item[][] = [];
  for (let i = 0; i < R.items.length; i += 35) batches.push(R.items.slice(i, i + 35));
  // Vectide's content filter refuses a whole batch over one review it dislikes, so a refused
  // batch is split in half until only the refused findings keep their own wording.
  const rewrite = async (b: Item[], label: string): Promise<void> => {
    const got = await askJson(ctx,
      `You are editing an audit report for the owner of ${name}, a small Malaysian business. Rewrite each finding below for the owner.\n` +
      `Rules: "title" is one plain sentence of at most 14 words, speaking to the owner as "you"; keep the exact numbers, dates, names and page paths that matter; ` +
      `no jargon, no labels like VERIFIED or CONTRADICTED, no URLs, no AI model names (say "an AI assistant"), no HTTP codes (say "the page does not exist"). ` +
      `"why" is at most 25 words: what it means for a customer or for the business. For good news, say why it helps. Never add facts that are not in the finding.\n\n` +
      b.map((x, i) => `${i} | ${x.area} | ${x.severity} | ${clip(x.title, 260)} | ${clip(x.detail, 320)}`).join('\n') +
      `\n\nReturn JSON only: {"items": [{"i": 0, "title": "", "why": ""}]} with one entry per finding, in order.`,
    label, b.length === 35 ? 2 : 1);
    if (!got && b.length > 1) {
      const half = Math.ceil(b.length / 2);
      await Promise.all([rewrite(b.slice(0, half), `${label}a`), rewrite(b.slice(half), `${label}b`)]);
      return;
    }
    for (const e of got?.items ?? []) {
      const x = b[Number(e?.i)];
      if (x && typeof e.title === 'string' && e.title.trim()) plain[x.key] = { title: e.title.trim(), why: String(e.why ?? '').trim() };
    }
  };
  await Promise.all(batches.map((b, n) => rewrite(b, `plain titles ${n + 1}/${batches.length}`)));
  ctx.log(`plain titles: ${Object.keys(plain).length} of ${R.items.length}`);
  if (Object.keys(plain).length < R.items.length) ctx.warn(`${R.items.length - Object.keys(plain).length} findings keep their original wording`);

  // ---- 2. Proof screenshots. ----
  const ownSite = (L['S2-consult']?.notes?.own_sites ?? [])[0] ?? (R.identity.domains[0] ? `https://${R.identity.domains[0]}/` : null);
  const shots = await takeShots(shotAsks(R, ownSite), ctx.warn);
  // A shot asked to find text that was not there proves nothing; keep it only for the cover and 404s.
  const kept = shots.filter((s) => s.found || !s.find);
  ctx.log(`screenshots: ${kept.length} of ${shots.length} kept`);

  return {
    findings: [{ title: 'Report edited', detail: `${Object.keys(plain).length} plain titles, ${kept.length} screenshots`, severity: 'info', source: null, checked_at: now }],
    notes: { plain, shots: kept },
  };
}
