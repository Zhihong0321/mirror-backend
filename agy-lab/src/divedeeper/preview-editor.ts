// The preview's own editor: one LLM pass over the company-dive that writes what the landing page
// needs to hook the owner. Run once per company-dive and cached (the hub keeps it in dive_preview,
// this PC in out/preview-<id>.json). It reads the research only, not the dossier: the hub starts it
// before the dossier is written, and every word it reads or writes is time the owner waits.
//   hook      the opening line, about this company and nobody else
//   known     what public sources already say about them, as short label/value pairs
//   warnings  contradictions, missing information, outdated and wrong details, worst first
// Never throws: no answer, or one that does not parse, returns null and the page falls back to the
// company-dive's own contradictions and gaps.
export type PreviewNotes = {
  hook?: string;
  known?: { label: string; value: string }[];
  warnings?: { type: 'contradiction' | 'missing' | 'outdated' | 'wrong'; title: string; detail: string; risk: string }[];
  edited_at?: string;
};

const TYPES = new Set(['contradiction', 'missing', 'outdated', 'wrong']);
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n) + ' …' : s);

export async function editPreview(dive: any, llm: (prompt: string) => Promise<string>, parseJson: (t: string) => any, warn: (m: string) => void, today = new Date().toISOString().slice(0, 10)): Promise<PreviewNotes | null> {
  const r = dive?.result ?? {};
  const id = r.identity ?? {};
  const name = String(id.legal_name ?? dive?.company ?? '');
  const facts = (r.facts ?? []).map((f: any) => `- ${f.fact}${f.confidence ? ` (${f.confidence})` : ''}`).join('\n');
  const people = (r.people?.people ?? []).filter((p: any) => p.name).map((p: any) => `- ${p.name}: ${p.role ?? ''}`).join('\n');
  const prompt =
    `You are preparing a free preview of an online presence audit for the owner of ${name}. The preview must prove it was prepared for this company alone, and show the owner real warning signs we found in public sources, so they want the full audit. Today is ${today}.\n\n` +
    `Company: ${JSON.stringify(id)}\n\nPeople named in public sources:\n${people || '(none)'}\n\nFacts from public sources:\n${clip(facts, 14000)}\n\n` +
    `Where sources disagree:\n${(r.contradictions ?? []).map((c: string) => `- ${c}`).join('\n') || '(none)'}\n\n` +
    `What sources do not show:\n${(r.gaps ?? []).map((g: string) => `- ${g}`).join('\n') || '(none)'}\n\n` +
    `Return JSON only:\n{"hook": "one sentence to the owner, specific to them, at most 22 words; name a real number or detail",\n` +
    `"known": [{"label": "2-3 words, e.g. Founded, Leadership, Offices, Claimed projects, Registrations, Team size, Services, Awards", "value": "at most 14 words, the fact itself"}] (6 to 8, the things a customer or bank would learn first),\n` +
    `"warnings": [{"type": "contradiction | missing | outdated | wrong", "title": "at most 11 words, plain, specific", "detail": "1-2 sentences with the actual values the sources give", "risk": "1 sentence: who notices this and what it can cost the business"}] (5 or 6, most damaging first, use at least three different types)}\n\n` +
    `Types: contradiction = two sources give different values for the same thing; missing = something a buyer checks that no public source shows; ` +
    `outdated = a date, certificate, promotion or figure that has passed or no longer matches today; wrong = a source states something the stronger evidence shows is not so (e.g. a different legal form or address). ` +
    `Rules: use only the material above; never invent facts or numbers; do not accuse the company of dishonesty: say what the sources show; drop the [n] citation markers; British English; speak to the owner as "you". ` +
    `This preview is public and unpaid: name no person except publicly named leadership (founder, CEO, director); give no phone numbers, ID numbers, emails or links; never mention proposals, invoices or other documents meant for one customer.`;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const got = parseJson(await llm(prompt));
    if (got && Array.isArray(got.warnings)) {
      const warnings = got.warnings
        .filter((w: any) => w && TYPES.has(w.type) && typeof w.title === 'string' && w.title.trim())
        .map((w: any) => ({ type: w.type, title: String(w.title).trim(), detail: String(w.detail ?? '').trim(), risk: String(w.risk ?? '').trim() }))
        .slice(0, 8);
      const known = (Array.isArray(got.known) ? got.known : [])
        .filter((k: any) => k && typeof k.label === 'string' && typeof k.value === 'string' && k.value.trim())
        .map((k: any) => ({ label: k.label.trim(), value: k.value.trim() })).slice(0, 8);
      return { hook: typeof got.hook === 'string' ? got.hook.trim() : undefined, known, warnings, edited_at: new Date().toISOString() };
    }
    warn(`preview editor answer did not parse (attempt ${attempt})`);
  }
  return null;
}
