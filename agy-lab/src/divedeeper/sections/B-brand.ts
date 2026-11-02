// B / brand — how well the internet understands the brand, its products and its services, read
// from a marketer's side (part 2 of the malaysia-deeper-dive report, next to the AI (G), search
// and Maps (H) lanes).
//
// Three readings of the same company:
//   1. what it says about itself: its homepage, about, products and services pages (fresh reads
//      of the pages C-merged crawled; a homepage read when C-merged did not run);
//   2. what others say: the search results for its name (H-web), independent pages that
//      describe it (Exa, its own domains excluded) and the dive's research on its products;
//   3. what AI assistants say when asked what it is and what it sells (G-fixed answers).
// One LLM call compares them: the offer, the selling points and their proof, the answer to
// "why choose you", a five-second test of the homepage, what outside sources have out of date or
// never mention, and how consistent the message is. Quotes from the company's pages are checked
// against the page text; a quote that is not there is dropped.
// No kill gates: a missing input narrows the comparison; an unparsed answer leaves only the
// inputs in notes.
import { readLane, nameOf, type Ctx, type Finding } from '../lib.ts';

const PITCH = /about|tentang|company|profile|who-we-are|why|service|perkhidmatan|product|produk|solution|what-we-do|industr|portfolio|project/i;

export async function run(ctx: Ctx, dive: any): Promise<{ findings: Finding[]; notes: Record<string, unknown> }> {
  const r = dive.result ?? {};
  const N = nameOf(dive);
  const findings: Finding[] = [];
  const add = (f: Omit<Finding, 'checked_at'>) => findings.push({ ...f, checked_at: ctx.now() } as Finding);
  const C = readLane(ctx.diveId, 'C-merged')?.notes ?? {};
  const HW = readLane(ctx.diveId, 'H-web')?.notes ?? {};
  const G = readLane(ctx.diveId, 'G-fixed')?.notes ?? {};

  // ---- 1. The company's own pitch. ----
  const crawled: string[] = [...new Set<string>([...(C.llm_pages ?? []), ...(C.sites ?? []).flatMap((s: any) => (s.pages ?? []).map((p: any) => p.url))])];
  const homes = N.domains.map((d) => `https://${d}/`);
  const pick = [...crawled.filter((u) => { try { return new URL(u).pathname === '/'; } catch { return false; } }), ...crawled.filter((u) => PITCH.test(u))];
  const urls = [...new Set(pick.length ? pick : homes)].slice(0, 7);
  const own: { url: string; text: string }[] = [];
  for (const u of urls) {
    const p = await ctx.page(u, { headers: { accept: 'text/html', 'accept-language': 'en-US,en;q=0.9' } });
    if (p.status !== 200) { if (p.status === 0) ctx.warn(`could not read ${u}: ${p.error}`); continue; }
    const text = ctx.htmlText(p.html).replace(/\s+/g, ' ').slice(0, 4500);
    if (text.length > 200) own.push({ url: p.finalUrl || u, text });
  }
  if (!own.length) ctx.warn('none of the company pages could be read; the comparison uses outside sources only');

  // ---- 2. What others say. ----
  const searchRows = (HW.unique ?? []).filter((x: any) => !x.official).slice(0, 14).map((x: any) => `${x.title} | ${x.url} | ${x.description}${x.class ? ` [${x.class}]` : ''}`);
  const exa = await ctx.exa(`${N.short} ${N.industry} Malaysia`, { numResults: 10, text: 1500, excludeDomains: N.domains });
  const outside = exa.filter((x: any) => N.mentions(`${x.title} ${x.text}`)).slice(0, 8).map((x: any) => ({ url: x.url, title: x.title, date: x.publishedDate ?? null, text: String(x.text ?? '').replace(/\s+/g, ' ').slice(0, 1200) }));
  const research = (r.facts ?? []).filter((f: any) => ['products_services', 'projects_clients', 'reputation', 'footprint', 'digital_presence'].includes(f.topic)).slice(0, 30).map((f: any) => `- ${f.fact}`);
  const kind = new Map<string, string>((G.prompts ?? []).map((p: any) => [p.id, p.text]));
  const ai = (G.answers ?? []).filter((a: any) => ['what', 'services', 'reliable'].includes(a.id) && a.sample === 0).map((a: any) => `Q: ${kind.get(a.id)}\nA: ${String(a.answer ?? '').slice(0, 900)}`);

  // ---- 3. The comparison. ----
  const got = ctx.parseJson(await ctx.llm(
    `You are a brand and marketing consultant auditing how well the internet understands ${N.legal} (${N.industry}, ${N.address}). Be concrete and fair; British English.\n\n` +
    `A. WHAT THE COMPANY SAYS ABOUT ITSELF (its own pages):\n${own.map((p) => `### ${p.url}\n${p.text}`).join('\n\n') || '(could not be read)'}\n\n` +
    `B. WHAT OTHERS SAY (search results for its name, independent pages, research notes):\n${searchRows.join('\n') || '(none)'}\n${outside.map((x: any) => `### ${x.title} | ${x.url} | ${x.date ?? ''}\n${x.text}`).join('\n\n')}\nResearch notes:\n${research.join('\n') || '(none)'}\n\n` +
    `C. WHAT AN AI ASSISTANT SAYS WHEN ASKED (from memory):\n${ai.join('\n\n') || '(not asked)'}\n\n` +
    `Return JSON only:\n{\n` +
    `"offer": [{"item": "a product or service the company sells, per A", "own_pages": true, "outside": "well covered | mentioned | missing", "ai": "right | vague | wrong | missing", "note": ""}] (its main lines, at most 8),\n` +
    `"selling_points": [{"point": "a reason to choose them that A states", "quote": "the exact words from A (verbatim)", "proof": "what on the pages backs it: numbers, named clients, certificates, reviews; or 'none'", "repeated_outside": true}] (at most 6),\n` +
    `"why_choose_you": "the one-sentence answer a stranger could piece together from everything above, or '' if no clear reason comes through",\n` +
    `"five_second_test": {"pass": true, "understood": "what a first-time visitor to the homepage grasps in five seconds", "problem": "what stops them, or ''"},\n` +
    `"outdated": [{"what": "an outside page or AI answer that has old or wrong details (products, name, address, phone, years)", "where": "url or 'AI answer'", "correct": "what A says now"}],\n` +
    `"missing": ["a question a buyer in this trade asks that no source answers, e.g. price range, area covered, warranty, lead time, minimum order, case studies"] (at most 6),\n` +
    `"inconsistent": [{"what": "the company describes itself differently in different places", "where": ["", ""]}],\n` +
    `"coverage": {"score": 0-100, "independent_sources": number, "comment": "how much of the offer an outsider can learn without visiting the site"},\n` +
    `"summary": "3 sentences: how well the internet understands this brand, the biggest gap, the quickest win"\n}`,
  ));
  if (!got) ctx.warn('brand comparison did not parse; no brand findings this run');

  // ---- 4. Findings. ----
  const flat = (s: string) => s.toLowerCase().replace(/[\s ]+/g, ' ').replace(/[’‘]/g, "'").trim();
  const ownAll = flat(own.map((p) => p.text).join(' '));
  const points = (got?.selling_points ?? []).map((p: any) => ({ ...p, quote: p.quote && ownAll.includes(flat(String(p.quote))) ? String(p.quote) : '' }));
  const offer: any[] = got?.offer ?? [];
  if (got) {
    const score = Number(got.coverage?.score ?? 0);
    add({ title: `The internet understands your business ${score >= 70 ? 'well' : score >= 40 ? 'in part' : 'poorly'}: ${score} out of 100`, detail: `${got.summary ?? ''} ${got.coverage?.comment ?? ''}`.trim(), severity: score >= 70 ? 'info' : score >= 40 ? 'medium' : 'high', source: null, check: 'brand-coverage', score });
    if (!String(got.why_choose_you ?? '').trim()) add({ title: 'Nothing online answers “why choose you?”', detail: 'Neither your own pages nor anyone else gives a clear reason to pick you over the next name on the list. Buyers compare; give them the reason in one line on the homepage, with proof.', severity: 'high', source: own[0]?.url ?? null, check: 'brand-why' });
    else add({ title: `Why choose you, as a stranger reads it: “${String(got.why_choose_you).slice(0, 160)}”`, detail: 'This is what comes through from everything public. If it is not the reason you want to be chosen for, your pages are saying the wrong thing.', severity: 'info', source: null, check: 'brand-why' });
    const ft = got.five_second_test ?? {};
    if (ft.pass === false) add({ title: 'A first-time visitor cannot tell what you sell within five seconds', detail: `${ft.understood ? `What they take away: ${ft.understood}. ` : ''}${ft.problem ?? ''}`, severity: 'high', source: own[0]?.url ?? null, check: 'brand-5s' });
    const unproven = points.filter((p: any) => !p.proof || /^none/i.test(String(p.proof)));
    if (unproven.length) add({ title: `${unproven.length} of your ${points.length} selling point${points.length === 1 ? ' has' : 's have'} no proof on the page`, detail: unproven.map((p: any) => `“${p.quote || p.point}”`).join('; ') + '. A claim with a number, a named client or a certificate next to it persuades; a bare claim reads as filler.', severity: 'medium', source: own[0]?.url ?? null, check: 'brand-proof' });
    const lonely = points.filter((p: any) => p.repeated_outside === false);
    if (lonely.length && lonely.length === points.length) add({ title: 'None of your selling points is repeated anywhere outside your own site', detail: 'Reviews, directories, news and AI assistants do not say what you say about yourself. Your strengths only exist where you wrote them.', severity: 'medium', source: null, check: 'brand-echo' });
    const missingOut = offer.filter((o) => o.outside === 'missing');
    if (missingOut.length) add({ title: `${missingOut.length} of your ${offer.length} products or services are invisible outside your site`, detail: `${missingOut.map((o) => o.item).join(', ')}: no directory, review, article or listing mentions them, so a buyer searching for them will not find you.`, severity: missingOut.length >= offer.length / 2 ? 'high' : 'medium', source: null, check: 'brand-offer' });
    const aiWrong = offer.filter((o) => o.ai === 'wrong' || o.ai === 'missing');
    if (aiWrong.length && ai.length) add({ title: `AI assistants miss or misdescribe ${aiWrong.length} of your ${offer.length} lines of business`, detail: aiWrong.map((o) => `${o.item} (${o.ai})`).join(', ') + '.', severity: 'medium', source: null, check: 'brand-ai' });
    for (const o of (got.outdated ?? []).slice(0, 6)) if (o?.what) add({ title: `Out of date about you: ${String(o.what).slice(0, 140)}`, detail: `${o.correct ? `Your own site says: ${o.correct}. ` : ''}Ask the site to update it, or replace it with a page you control.`, severity: 'medium', source: /^https?:/.test(String(o.where)) ? o.where : null, check: 'brand-outdated' });
    for (const x of (got.inconsistent ?? []).slice(0, 3)) if (x?.what) add({ title: `You describe yourself differently in different places: ${String(x.what).slice(0, 140)}`, detail: (x.where ?? []).join('; '), severity: 'low', source: null, check: 'brand-inconsistent' });
    if ((got.missing ?? []).length) add({ title: `${got.missing.length} question${got.missing.length === 1 ? '' : 's'} buyers ask that nothing online answers`, detail: got.missing.join('; ') + '.', severity: 'medium', source: null, check: 'brand-missing' });
  }

  return { findings, notes: { pages: own.map((p) => p.url), outside: outside.map(({ text, ...x }: any) => x), offer, selling_points: points, why_choose_you: got?.why_choose_you ?? null, five_second_test: got?.five_second_test ?? null, outdated: got?.outdated ?? [], missing: got?.missing ?? [], inconsistent: got?.inconsistent ?? [], coverage: got?.coverage ?? null, summary: got?.summary ?? null } };
}
