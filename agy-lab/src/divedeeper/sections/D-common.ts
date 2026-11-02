// D / shared step 1 for both lanes (D-registry, D-web): build the list of claims to check.
//
// A claim is a grade, certificate, licence, registration, membership, award, appointment,
// project count or client logo that the company states about itself. Two inputs:
//   1. the finished dive's facts and contradictions (what company-dive already saw), and
//   2. a fresh read of the official site: each official domain's homepage plus its
//      about / why-choose / credentials pages, and the logo alt texts on the homepage.
// One LLM call turns that into a short, de-duplicated claim list. Every step falls back:
// a dead page or a bad LLM answer logs a warning and the list is built from what is left.
import fs from 'node:fs';
import path from 'node:path';
import { OUT, type Ctx } from '../lib.ts';

export type Verdict = 'verified' | 'contradicted' | 'not found' | "can't check automatically";

export type Claim = {
  id: string;
  claim: string;      // one sentence, as the company states it
  kind: string;       // grade | registration | certificate | licence | membership | award | appointment | count | client | superlative
  issuer: string;     // one of ISSUERS
  value: string;      // the checkable value: "G7", "MyHS00025/25", "2024", "1,000+"
  where: string[];    // urls where the company makes the claim
  quote: string;      // the words used, short
};

export const ISSUERS = ['CIDB', 'SEDA_RPVSP', 'SEDA_RPVI', 'MYHIJAU', 'GOLDEN_BULL', 'MPSEA', 'ST', 'SHRDC', 'MAYBANK', 'SAJ', 'SSM', 'INSURER', 'SELF_COUNT', 'OTHER'] as const;

const KW = /cidb|grade|\bg[1-7]\b|seda|rpvsp|rpvi|registered|myhijau|myhs|certif|licen[cs]|\biso\b|award|bull|winner|member|mpia|mpsea|partner|appointed|authori[sz]ed|sole distributor|preferred|approved|projects?\b|plants?\b|mwp|gwh|clients?\b|fastest|first|no\.?\s?1|most promising|insurance|msig|paid.?up|training cent|accredit|suruhanjaya|tenaga|maybank|shrdc|credib|recogni/i;

export const host = (u: string | null | undefined) => {
  try { return u ? new URL(u.startsWith('http') ? u : 'https://' + u).hostname.replace(/^www\./, '') : ''; } catch { return ''; }
};

/** Names to look the company up by, longest first: "ETERNALGY SDN BHD", "Eternalgy". */
export function companyNames(dive: any): { legal: string; short: string; ssmNew: string; ssmOld: string } {
  const id = dive.result?.identity ?? {};
  const legal = String(id.legal_name ?? dive.company ?? '').trim();
  const short = legal.replace(/\b(sdn\.?\s*bhd\.?|berhad|bhd\.?|plt|enterprise)\b/gi, '').replace(/[^\p{L}\p{N} &-]/gu, ' ').replace(/\s+/g, ' ').trim();
  const regs: string[] = (id.registration_numbers ?? []).map(String);
  return { legal, short, ssmNew: regs.find((r) => /^\d{12}$/.test(r.replace(/\D/g, ''))) ?? '', ssmOld: regs.find((r) => /^\d{5,8}-?[A-Z]$/i.test(r)) ?? '' };
}

/** Lines of a page's text that mention a credential-like word, capped. */
function claimLines(text: string, cap = 5000): string {
  const lines = text.split('\n').map((l) => l.trim()).filter((l) => l.length > 3 && l.length < 600 && KW.test(l));
  return [...new Set(lines)].join('\n').slice(0, cap);
}

/** Fresh read of the official site: homepages, then up to 5 about/why/credential pages. */
export async function readOfficialSite(ctx: Ctx, dive: any): Promise<{ url: string; status: number; lines: string; alts: string[] }[]> {
  const r = dive.result ?? {};
  const domains: string[] = (r.identity?.official_domains ?? []).map((d: string) => d.replace(/^www\./, ''));
  const pages: { url: string; status: number; lines: string; alts: string[] }[] = [];
  const seenBody = new Set<string>();
  const queue: string[] = domains.map((d) => `https://${d}/`);
  // Pages the dive already cited on the official domains whose url says about/why/credentials.
  for (const s of r.sources ?? []) if (domains.includes(host(s.url)) && /about|why|credential|certif|award|milestone/i.test(s.url)) queue.push(s.url);
  const done = new Set<string>();
  let extra = 0;
  while (queue.length) {
    const url = queue.shift()!;
    const key = url.replace(/\/+$/, '').replace('://www.', '://');
    if (done.has(key)) continue;
    done.add(key);
    const p = await ctx.page(url);
    if (p.status !== 200 || !p.html) { ctx.warn(`official page ${url}: HTTP ${p.status} ${p.error ?? ''}`); continue; }
    const sig = p.html.length + ':' + p.html.slice(0, 2000);
    if (seenBody.has(sig)) { ctx.log(`same page as before: ${url}`); continue; }
    seenBody.add(sig);
    const text = ctx.htmlText(p.html);
    const alts = [...new Set([...p.html.matchAll(/<img[^>]*\balt="([^"]{2,60})"/gi)].map((m) => m[1].trim()))];
    pages.push({ url: p.finalUrl || url, status: p.status, lines: claimLines(text), alts });
    // Discover about / why-choose / credential links on the same host (homepages only).
    if (domains.map((d) => `https://${d}/`).includes(url)) {
      const h = host(p.finalUrl || url);
      for (const m of p.html.matchAll(/href="([^"#]+)"/gi)) {
        let u: string;
        try { u = new URL(m[1], p.finalUrl || url).href; } catch { continue; }
        if (host(u) !== h || !/about|why-choose|why_choose|credential|certificat|award|milestone/i.test(u) || /\/cn\/|\/zh\/|share=|wa\.me/i.test(u)) continue;
        if (extra < 5 && !done.has(u.replace(/\/+$/, '').replace('://www.', '://'))) { queue.push(u); extra++; }
      }
    }
  }
  return pages;
}

export type SelfGrade = { grade: string; where: string; text: string };
export type ClaimSet = { claims: Claim[]; pages: { url: string; status: number }[]; selfGrades: SelfGrade[]; extracted_at?: string; cached?: boolean };

/** Identity facts are not claims to verify: the CIDB sweep covers registration numbers and names. */
const IDENTITY = /registration (no|number)|registered (as|company) (no|number)|\bssm\b.*\b(no|number)\b|incorporat|established|founded|formerly|also known|known as|legal name|registered name|aliases?|address|headcount|employees|staff count|portfolio shows/i;
function isIdentity(c: Claim): boolean {
  if (c.issuer === 'SSM' && !/capital/i.test(c.claim)) return true;
  return IDENTITY.test(c.claim) && !/capital|cidb|seda|myhijau|grade/i.test(c.claim);
}

/** Every CIDB grade the company or its listings show: the official site today, plus the dive's facts. */
function gradesShown(pages: { url: string; lines: string }[], dive: any): SelfGrade[] {
  const out: SelfGrade[] = [];
  const r = dive.result ?? {};
  const add = (text: string, where: string) => {
    if (!/cidb|gred|grade/i.test(text)) return;
    for (const m of text.matchAll(/\bG([1-7])\b/g)) out.push({ grade: 'G' + m[1], where, text: text.slice(Math.max(0, m.index! - 80), m.index! + 60).replace(/\s+/g, ' ') });
  };
  for (const p of pages) for (const line of p.lines.split('\n')) add(line, p.url);
  for (const f of r.facts ?? []) for (const sid of f.sources ?? []) { const u = r.sources?.find((s: any) => s.id === sid)?.url; if (u) add(f.fact, u); }
  const seen = new Set<string>();
  return out.filter((g) => { const k = g.grade + '|' + g.where; if (seen.has(k)) return false; seen.add(k); return true; });
}

function filterOnly(set: ClaimSet): ClaimSet {
  const only = process.env.D_ONLY;
  return only ? { ...set, claims: set.claims.filter((c) => only.split(',').includes(c.issuer)) } : set;
}

/** Step 1: the claim list (dive facts + a fresh read of the official site), one LLM call.
 *  Stored once per dive in out/D-claims-<id>.json so reruns check the same claims; D_FRESH_CLAIMS=1 rebuilds it. */
export async function extractClaims(ctx: Ctx, dive: any): Promise<ClaimSet> {
  const file = path.join(OUT, `D-claims-${ctx.diveId}.json`);
  if (!process.env.D_FRESH_CLAIMS && fs.existsSync(file)) {
    try {
      const cached = JSON.parse(fs.readFileSync(file, 'utf8')) as ClaimSet;
      ctx.log(`claim list from ${path.basename(file)} (${cached.claims.length} claims, extracted ${cached.extracted_at})`);
      return filterOnly({ ...cached, cached: true });
    } catch (e) { ctx.warn(`claim cache unreadable (${(e as Error).message}); extracting again`); }
  }
  const r = dive.result ?? {};
  const src = (ids: number[]) => (ids ?? []).map((i) => r.sources?.find((s: any) => s.id === i)?.url).filter(Boolean);
  const facts = (r.facts ?? []).filter((f: any) => KW.test(f.fact)).map((f: any) => `- ${f.fact} [sources: ${src(f.sources).join(' ')}]`).join('\n');
  const contradictions = (r.contradictions ?? []).map((c: string) => '- ' + c).join('\n');
  const pages = await readOfficialSite(ctx, dive);
  const site = pages.map((p) => `### ${p.url}\n${p.lines}\nLogos/images: ${p.alts.join(', ')}`).join('\n\n');
  ctx.log(`official pages read: ${pages.map((p) => p.url).join(' | ')}`);

  const prompt = `You list the CHECKABLE CLAIMS a company makes about itself, so each can be checked against the body that would issue it.
Company: ${r.identity?.legal_name ?? dive.company} (${r.identity?.industry ?? ''}), Malaysia.

A checkable claim is a grade, licence, certificate (with its number if given), registration with a body other than SSM (CIDB, SEDA, ST, MOF...), membership, award (with its year), appointment or partnership (e.g. "preferred partner", "sole distributor"), a project / capacity / customer count, a named client or a client/partner logo, or a superlative ("fastest", "first", "No.1", "highest").
Skip product specs, warranties, prices and opinions.
Skip IDENTITY FACTS entirely (they are checked elsewhere): company registration numbers, incorporation or founding dates, "established in", legal names, former names, aliases, addresses, headcount, and observations a directory makes about the company (e.g. "portfolio shows 0 projects").

Rules:
- If two pages give DIFFERENT values for the same credential (e.g. grade G7 on one site, G3 on another; award year 2024 vs 2025; 1,000+ vs 925+ projects), make ONE CLAIM PER VALUE, each with its own pages.
- Merge the same value said on several pages into one claim with all the pages in "where".
- A logo with no words (e.g. "cidb", "seda", "suruhanjaya tenaga", "Maybank") counts only if no worded claim covers that body; then the claim is "displays the <body> logo".
- issuer is exactly one of: ${ISSUERS.join(', ')}.
  CIDB = contractor grade; SEDA_RPVSP = SEDA registered PV service provider; SEDA_RPVI = SEDA registered PV investor; MYHIJAU = MyHijau mark / certificate / green tax allowance; GOLDEN_BULL = Golden Bull Award; MPSEA = MPIA/MPSEA association membership; ST = Suruhanjaya Tenaga (Energy Commission) licence/registration; SHRDC = SHRDC centre of excellence / training partner; MAYBANK = Maybank partner/installer; SAJ = SAJ distributorship; SSM = paid-up capital only; INSURER = insurance cover; SELF_COUNT = project/plant/MWp/revenue counts, "fastest", "first" and other figures only the company holds; OTHER = anything else.
- value: the exact checkable value (grade "G7", certificate number, award year, the count, category codes, dates), or "" if none.
- At most 18 claims, most important first (grades, registrations and certificates first).

Dive facts (already researched; urls are where each was seen):
${facts}

Dive contradictions:
${contradictions}

Fresh read of the official site today (lines mentioning credentials, then the image alt texts):
${site}

Return JSON only: {"claims":[{"claim":"...","kind":"grade|registration|certificate|licence|membership|award|appointment|count|client|superlative","issuer":"...","value":"...","where":["url",...],"quote":"short words used"}]}`;

  const answer = await ctx.llm(prompt);
  const parsed = ctx.parseJson<{ claims: any[] }>(answer);
  let claims: Claim[] = (parsed?.claims ?? []).filter((c: any) => c && c.claim).map((c: any) => ({
    id: '',
    claim: String(c.claim),
    kind: String(c.kind ?? 'other'),
    issuer: (ISSUERS as readonly string[]).includes(String(c.issuer)) ? String(c.issuer) : 'OTHER',
    value: String(c.value ?? ''),
    where: Array.isArray(c.where) ? c.where.map(String).slice(0, 4) : [],
    quote: String(c.quote ?? '').slice(0, 200),
  }));
  const dropped = claims.filter(isIdentity);
  if (dropped.length) ctx.log(`dropped ${dropped.length} identity facts: ${dropped.map((c) => c.claim).join(' | ')}`);
  claims = claims.filter((c) => !isIdentity(c)).slice(0, 18).map((c, i) => ({ ...c, id: 'C' + String(i + 1).padStart(2, '0') }));
  if (!parsed) {
    ctx.warn('claim extraction failed; falling back to a keyword pick of the dive facts');
    claims = (r.facts ?? []).filter((f: any) => f.topic === 'reputation').slice(0, 10).map((f: any, i: number) => ({
      id: 'C' + String(i + 1).padStart(2, '0'), claim: f.fact, kind: 'other',
      issuer: /cidb/i.test(f.fact) ? 'CIDB' : /investor|rpvi/i.test(f.fact) ? 'SEDA_RPVI' : /seda/i.test(f.fact) ? 'SEDA_RPVSP' : /myhijau/i.test(f.fact) ? 'MYHIJAU' : /bull/i.test(f.fact) ? 'GOLDEN_BULL' : /mpia|mpsea/i.test(f.fact) ? 'MPSEA' : /maybank/i.test(f.fact) ? 'MAYBANK' : 'OTHER',
      value: (f.fact.match(/\bG[1-7]\b|MyHS[\w/]+|20\d\d/) ?? [''])[0], where: src(f.sources), quote: '',
    }));
  }
  const set: ClaimSet = { claims, pages: pages.map((p) => ({ url: p.url, status: p.status })), selfGrades: gradesShown(pages, dive), extracted_at: ctx.now() };
  if (parsed) {
    try { fs.mkdirSync(OUT, { recursive: true }); fs.writeFileSync(file, JSON.stringify(set, null, 2)); }
    catch (e) { ctx.warn(`claim cache not written: ${(e as Error).message}`); }
  }
  return filterOnly(set);
}
