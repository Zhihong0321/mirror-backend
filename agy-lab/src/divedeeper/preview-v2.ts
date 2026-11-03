// The switched preview editor. It runs only when the company dive's `preview2` switch is on
// (T6's switchOn, including the global off). It stores into dive_preview.notes_v2 and leaves
// the old column untouched. The model sees previewInput and nothing else from the research.
// A warning is kept only when its quote is in the text of a source it cites (quoteOnPage).
// The page text is passed in, so this file does not import an evidence module.
import * as reportdb from '../reportdb.ts';
import { updateRow } from '../companydive/store.ts';
import { makeCtx } from './lib.ts';
import { quoteOnPage } from './sections/C-merged.ts';
import { previewInput, type PreviewInput } from './preview-input.ts';
import { switchOn } from '../switches.ts';

const KEPT = new Set(['contradiction', 'outdated', 'wrong']);

type SavedWarning = {
  type: 'contradiction' | 'outdated' | 'wrong';
  title: string;
  detail: string;
  risk: string;
  quote: string;
  sources: number[];
};

type Dropped = { title: string; reason: string };

function switchOptions(dive: any): { switches?: string[] } | null {
  const o = dive?.options;
  if (o == null || typeof o === 'object') return o ?? null;
  if (typeof o === 'string') {
    try {
      const parsed = JSON.parse(o);
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch { /* malformed options fail closed */ }
  }
  return null;
}

function logLines(v: unknown): Array<{ at: string; stage: string; msg: string }> {
  try {
    const raw = typeof v === 'string' ? JSON.parse(v) : v;
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

/** What kind of failure it was, never its message: a message can carry a name, an address or a number. */
function errorKind(err: unknown): string {
  return err instanceof Error ? err.name : typeof err;
}

/** One line on the company dive, through updateRow. preview2_fail is proof only. */
async function notePreview2Fail(dive: any): Promise<void> {
  const id = Number(dive.id);
  const row = (await reportdb.sql(`select log from company_dive where id = $1`, [id])).rows[0] as { log?: unknown } | undefined;
  const log = [...logLines(row?.log ?? dive?.log), {
    at: new Date().toISOString(),
    stage: 'preview',
    msg: 'preview2_fail: skipped the model and took the failure path',
  }];
  await updateRow(id, { log });
}

function knownOf(got: any): { label: string; value: string }[] {
  return (Array.isArray(got?.known) ? got.known : [])
    .filter((k: any) => k && typeof k.label === 'string' && typeof k.value === 'string' && k.value.trim())
    .map((k: any) => ({ label: k.label.trim(), value: k.value.trim() }));
}

async function textFor(url: string, read: (url: string) => Promise<string | null>, cache: Map<string, Promise<string | null>>): Promise<string | null> {
  let pending = cache.get(url);
  if (!pending) {
    pending = Promise.resolve().then(() => read(url)).then((t) => (typeof t === 'string' ? t : null), () => null);
    cache.set(url, pending);
  }
  return pending;
}

/** Keeps a warning only when the quote is found, verbatim by quoteOnPage, in a source it cites. */
async function verifyWarnings(input: PreviewInput, got: any, read: (url: string) => Promise<string | null>): Promise<{ warnings: SavedWarning[]; dropped: Dropped[] }> {
  const warnings: SavedWarning[] = [];
  const dropped: Dropped[] = [];
  const urlOf = new Map(input.sourceUrls.map((s) => [s.id, s.url]));
  const cache = new Map<string, Promise<string | null>>();
  for (const w of Array.isArray(got?.warnings) ? got.warnings : []) {
    const title = typeof w?.title === 'string' ? w.title.trim() : '';
    if (!w || !KEPT.has(w.type) || !title) {
      dropped.push({ title, reason: title ? 'not a kept type' : 'no title' });
      continue;
    }
    const quote = typeof w.quote === 'string' ? w.quote.trim() : '';
    if (!quote) { dropped.push({ title, reason: 'no quote' }); continue; }
    const ids = [...new Set<number>((Array.isArray(w.sources) ? w.sources : []).map((n: unknown) => Number(n)).filter((n: number) => urlOf.has(n)))];
    const found: number[] = [];
    for (const id of ids) {
      const text = await textFor(urlOf.get(id)!, read, cache);
      if (text && quoteOnPage(quote, text)) found.push(id);
    }
    if (!found.length) { dropped.push({ title, reason: 'quote is not in a cited source' }); continue; }
    warnings.push({ type: w.type, title, detail: String(w.detail ?? '').trim(), risk: String(w.risk ?? '').trim(), quote, sources: found });
  }
  return { warnings, dropped };
}

function previewPrompt(input: PreviewInput): string {
  const today = new Date().toISOString().slice(0, 10);
  const names = [input.legalName, ...input.tradingNames].filter(Boolean).join(', ') || '(unknown)';
  const area = [input.town, input.state].filter(Boolean).join(', ') || '(unknown)';
  const leadership = input.leadership.map((p) => `- ${p.name}${p.title ? `: ${p.title}` : ''}`).join('\n') || '(none)';
  const facts = input.facts.map((f) => `- [${f.sources.join(', ')}] ${f.fact}`).join('\n') || '(none)';
  return [
    `You are preparing a free preview of an online presence audit for the owner of ${names}. The preview must prove it was prepared for this company alone. Today is ${today}.`,
    '',
    `Company: ${names}`,
    `Industry: ${input.industry || '(unknown)'}`,
    `Area: ${area}`,
    '',
    'Leadership named in public:',
    leadership,
    '',
    'Facts from public sources. The numbers in brackets are source ids:',
    facts,
    '',
    'Return JSON only:',
    '{"hook": "one sentence to the owner, specific to them, at most 22 words",',
    '"known": [{"label": "2-3 words", "value": "at most 14 words, the fact itself"}],',
    '"warnings": [{"type": "contradiction | outdated | wrong", "title": "at most 11 words, plain, specific", "detail": "1-2 sentences with the actual values the sources give", "risk": "1 sentence: who notices this and what it can cost the business", "quote": "exact words copied from one fact above", "sources": [1]}]}',
    '',
    `Types: contradiction = two of the facts above give different values for the same thing; outdated = a date, certificate, promotion or figure in the facts that has passed or no longer matches today (${today}); wrong = a fact the other facts show is not so.`,
    'There is no quota and no minimum. Return a warning only when the facts above support it, and return an empty warnings list when they do not.',
    'Rules: use only the material above; the quote must be copied verbatim from one fact above; sources must be source ids printed on that fact; never invent facts or numbers; do not accuse the company of dishonesty: say what the sources show; drop citation markers; British English; speak to the owner as "you".',
    'This preview is public and unpaid: name no person except the leadership listed above; give no phone numbers, ID numbers, emails or links.',
  ].join('\n');
}

export async function writePreviewV2(dive: any, sourceText: (url: string) => Promise<string | null>): Promise<void> {
  const id = Number(dive?.id);
  let release: (() => void) | undefined;
  try {
    const options = switchOptions(dive);
    if (!switchOn(options, 'preview2')) return;
    const { editing } = await import('./preview-writer.ts');
    editing.add(id);
    release = () => { editing.delete(id); };
    const ctx = makeCtx(String(dive.id), 'P', 'preview2');
    const input = previewInput(dive?.result);
    const prompt = previewPrompt(input);
    const read = typeof sourceText === 'function' ? sourceText : async () => null;
    await reportdb.sql(`alter table dive_preview add column if not exists notes_v2 jsonb`);
    const edited_at = new Date().toISOString();
    const store = async (body: Record<string, unknown>) => {
      const saved = { ...body, meter: ctx.meter, edited_at };
      await reportdb.sql(
        `insert into dive_preview (dive_id, notes_v2, meter) values ($1, $2::jsonb, $3::jsonb) on conflict (dive_id) do update set notes_v2 = excluded.notes_v2, meter = excluded.meter`,
        [dive.id, JSON.stringify(saved), JSON.stringify(ctx.meter)],
      );
    };
    // Same shape as a returned failure. A thrown error adds its scrubbed text.
    const failed = (err?: unknown) => ({
      prompt, hook: '', known: [] as { label: string; value: string }[], warnings: [] as SavedWarning[], dropped: [] as Dropped[], failed: true as const,
      ...(err == null ? {} : { error: errorKind(err) }),
    });
    if (switchOn(options, 'preview2_fail')) {
      try { await notePreview2Fail(dive); }
      catch (err) { console.error(`[dive-preview ${id}] preview2_fail log failed`, err); }
      await store(failed());
      return;
    }
    let got: any = null;
    let thrown: unknown = null;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        got = ctx.parseJson(await ctx.llm(prompt, { label: 'preview2' }));
        thrown = null;
      } catch (err) {
        // The model or the parser threw. Retry once, then save failed below.
        thrown = err;
        got = null;
      }
      if (got && Array.isArray(got.warnings)) break;
      ctx.warn(`preview editor answer did not parse (attempt ${attempt})`);
      got = null;
    }
    if (!got) {
      await store(failed(thrown ?? undefined));
      return;
    }
    let warnings: SavedWarning[];
    let dropped: Dropped[];
    try {
      ({ warnings, dropped } = await verifyWarnings(input, got, read));
    } catch (err) {
      await store(failed(err));
      return;
    }
    await store({
      prompt,
      hook: typeof got.hook === 'string' ? got.hook.trim() : '',
      known: knownOf(got),
      warnings,
      dropped,
      failed: false,
    });
  } catch (err) {
    // The model and the parser save their own failure. A database error stays a log.
    console.error(`[dive-preview ${id}] preview2 failed`, err);
  } finally {
    release?.();
  }
}
