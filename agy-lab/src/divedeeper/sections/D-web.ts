// D / web — unproven claims, checked through web search (Exa + Brave) and an LLM judge.
//
// Step 1 (D-common): the same claim list as D-registry (dive facts + a fresh site read).
// Step 2: claims are grouped by issuing body (G3 and G7 share one search), and each group
// gets one Exa search (with page text) and one Brave search (snippets). At most 14 groups,
// so at most 14 Exa + 14 Brave calls.
// Step 3: one LLM call per group sorts every result into self-published (the company's own
// sites and social pages), copy (a directory or listing that repeats what the company
// typed) or independent (the issuing body, an organiser, a bank, news reporting), and gives
// each claim a verdict. Only independent evidence can verify or contradict.
import type { Ctx, Finding } from '../lib.ts';
import { extractClaims, companyNames, host, type Claim, type Verdict } from './D-common.ts';

const MAX_GROUPS = 14;

const WORDS: Record<string, string> = {
  CIDB: 'CIDB contractor grade', SEDA_RPVSP: 'SEDA registered PV service provider RPVSP', SEDA_RPVI: 'SEDA registered solar PV investor RPVI',
  MYHIJAU: 'MyHIJAU certified', GOLDEN_BULL: 'Golden Bull Award', MPSEA: 'MPSEA MPIA member', ST: 'Suruhanjaya Tenaga registered electrical contractor',
  SHRDC: 'SHRDC centre of excellence partner', MAYBANK: 'Maybank solar partner installer', SAJ: 'SAJ inverter Malaysia distributor',
  SSM: 'SSM paid-up capital registration', INSURER: 'insurance', SELF_COUNT: 'solar projects installed', OTHER: '',
};

/** Text around the company name and the claim words, so the judge sees the relevant part. */
function excerpt(text: string, needles: RegExp[], cap = 900): string {
  if (!text) return '';
  const spans: [number, number][] = [];
  for (const re of needles) for (const m of text.matchAll(new RegExp(re.source, 'gi'))) { spans.push([Math.max(0, m.index! - 250), Math.min(text.length, m.index! + 350)]); if (spans.length > 12) break; }
  if (!spans.length) return text.slice(0, 300);
  spans.sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const s of spans) { const l = merged[merged.length - 1]; if (l && s[0] <= l[1]) l[1] = Math.max(l[1], s[1]); else merged.push([...s]); }
  return merged.map(([a, b]) => text.slice(a, b).replace(/\s+/g, ' ')).join(' … ').slice(0, cap);
}

export async function run(ctx: Ctx, dive: any): Promise<{ findings: Finding[]; notes: Record<string, unknown> }> {
  const id = dive.result?.identity ?? {};
  const n = companyNames(dive);
  const { claims, pages } = await extractClaims(ctx, dive);
  ctx.log(`${claims.length} claims: ${claims.map((c) => `${c.id} ${c.issuer} ${c.value}`).join(' | ')}`);

  // Group by issuer; OTHER claims each get their own group.
  const groups: { key: string; claims: Claim[] }[] = [];
  for (const c of claims) {
    const key = c.issuer === 'OTHER' ? 'OTHER:' + c.id : c.issuer;
    const g = groups.find((x) => x.key === key);
    if (g) g.claims.push(c); else groups.push({ key, claims: [c] });
  }
  const searched = groups.slice(0, MAX_GROUPS);
  if (groups.length > MAX_GROUPS) ctx.warn(`${groups.length - MAX_GROUPS} claim groups over the search budget; reported as not checked`);

  const findings: Finding[] = [];
  const evidenceLog: any[] = [];
  for (const g of searched) {
    const issuer = g.key.split(':')[0];
    const words = WORDS[issuer] || g.claims[0].claim.split(/\s+/).slice(0, 6).join(' ');
    const q = `"${n.short}" ${words}`.trim();
    const [ex, br] = await Promise.all([ctx.exa(q, { numResults: 6, text: 4000 }), ctx.brave(q, { count: 10 })]);
    const needles = [new RegExp(n.short.replace(/\s+/g, '\\s*')), ...words.split(/\s+/).filter((w) => w.length > 3).slice(0, 3).map((w) => new RegExp(w.replace(/[^\w]/g, '')))];
    const seen = new Set<string>();
    const results = [
      ...ex.map((r: any) => ({ via: 'exa', url: r.url, title: r.title ?? '', date: r.publishedDate ?? '', text: excerpt(r.text ?? '', needles) })),
      ...br.map((r: any) => ({ via: 'brave', url: r.url, title: String(r.title ?? '').replace(/<[^>]+>/g, ''), date: r.age ?? r.page_age ?? '', text: String(r.description ?? '').replace(/<[^>]+>/g, '') + (r.extra_snippets ? ' … ' + r.extra_snippets.join(' … ') : '') })),
    ].filter((r) => r.url && !seen.has(r.url) && (seen.add(r.url), true)).slice(0, 14);
    ctx.log(`${g.key}: "${q}" -> ${ex.length} exa, ${br.length} brave, ${results.length} unique`);

    let judged: any = null;
    if (results.length) {
      const prompt = `You check a company's claims against web search results. Today is ${ctx.now().slice(0, 10)}.
Company: ${id.legal_name} (Malaysia). Its own websites: ${(id.official_domains ?? []).join(', ')}. Its own social pages (Facebook, Instagram, LinkedIn, TikTok, YouTube, Xiaohongshu) and its customer proposal app also count as self-published.

Sort every result into one of:
- "self": published by the company itself;
- "copy": a directory, listing, job board, marketplace or press-release page that repeats what the company wrote about itself (e.g. business directories, SolarDir, Newpages, Homebagus, paid announcements);
- "independent": the issuing body's own site or register, the award organiser, a bank or partner announcing it, or news reporting written by a journalist.
Then give each claim one verdict:
- "verified": an INDEPENDENT result clearly supports it as worded;
- "contradicted": an INDEPENDENT result clearly says something different (another grade, year, status);
- "not found": only self/copy results support it, or nothing relevant.
Name the single best evidence url for the verdict (an independent one when there is one). Say who published it.

Claims:
${g.claims.map((c) => `- ${c.id}: ${c.claim} (value: ${c.value || '-'})`).join('\n')}

Results:
${results.map((r, i) => `[${i + 1}] ${r.url} | ${r.title}${r.date ? ' | ' + r.date : ''}\n${r.text}`).join('\n\n')}

Return JSON only: {"results":[{"n":1,"kind":"self|copy|independent","publisher":"..."}],"claims":[{"id":"C01","verdict":"verified|contradicted|not found","evidence_url":"...","why":"one sentence"}]}`;
      judged = ctx.parseJson(await ctx.llm(prompt));
      if (!judged) ctx.warn(`${g.key}: judge answer did not parse`);
    }
    const kinds = (judged?.results ?? []).reduce((acc: Record<string, number>, r: any) => { acc[r.kind] = (acc[r.kind] ?? 0) + 1; return acc; }, {});
    evidenceLog.push({ group: g.key, query: q, results: results.map((r, i) => ({ ...r, text: r.text.slice(0, 300), kind: judged?.results?.find((x: any) => x.n === i + 1)?.kind, publisher: judged?.results?.find((x: any) => x.n === i + 1)?.publisher })) });

    for (const c of g.claims) {
      const v = judged?.claims?.find((x: any) => x.id === c.id);
      const verdict: Verdict = !results.length ? 'not found' : !v ? "can't check automatically" : (['verified', 'contradicted', 'not found'].includes(v.verdict) ? v.verdict : 'not found');
      const why = !results.length ? `no search results for "${q}"` : v?.why ?? 'the judge gave no verdict for this claim';
      const evUrl = v?.evidence_url && /^https?:/.test(v.evidence_url) ? v.evidence_url : null;
      const evKind = evUrl ? judged?.results?.find((x: any) => results[x.n - 1]?.url === evUrl)?.kind : undefined;
      findings.push({
        title: `${verdict.toUpperCase()}: ${c.claim}`,
        detail: `${why} (results: ${Object.entries(kinds).map(([k, x]) => `${x} ${k}`).join(', ') || 'none'}.)`,
        severity: verdict === 'contradicted' ? 'high' : verdict === 'not found' ? 'medium' : verdict === 'verified' ? 'info' : 'low',
        source: evUrl,
        checked_at: ctx.now(),
        evidence: evUrl ? `${evKind ?? '?'}: ${results.find((r) => r.url === evUrl)?.text.slice(0, 300) ?? ''}` : undefined,
        claim_id: c.id, claim: c.claim, issuer: c.issuer, value: c.value, claimed_on: c.where, verdict, evidence_kind: evKind ?? null,
      });
    }
  }
  for (const g of groups.slice(MAX_GROUPS)) for (const c of g.claims) findings.push({ title: `CAN'T CHECK AUTOMATICALLY: ${c.claim}`, detail: 'over this run\'s search budget', severity: 'low', source: null, checked_at: ctx.now(), claim_id: c.id, claim: c.claim, issuer: c.issuer, value: c.value, verdict: "can't check automatically" });

  findings.sort((a, b) => String(a.claim_id).localeCompare(String(b.claim_id)));
  return { findings, notes: { claims, pages_read: pages, evidence: evidenceLog } };
}
