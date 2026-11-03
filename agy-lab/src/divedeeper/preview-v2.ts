// The switched preview editor. It runs only when the company dive's `preview2` switch is on
// (T6's switchOn, including the global off). It stores into dive_preview.notes_v2 and leaves
// the old column untouched. The model sees previewInput and nothing else from the research,
// plus a short scrubbed passage of each cited source. A warning, and the hook, are kept only
// when their quote is in the text of a source they cite (quoteOnPage).
// The page text is passed in, so this file does not import an evidence module.
import * as reportdb from '../reportdb.ts';
import { updateRow } from '../companydive/store.ts';
import { makeCtx } from './lib.ts';
import { quoteOnPage } from './sections/C-merged.ts';
import { passageWindow, previewInput, type PreviewInput } from './preview-input.ts';
import { scrubPublic } from './privacy.ts';
import { editing } from './preview-writer.ts';
import { switchOn } from '../switches.ts';

const KEPT = new Set(['contradiction', 'outdated', 'wrong']);
const PASSAGE_CHARS = 700;
const PASSAGE_SOURCES = 20;
const PASSAGE_TOTAL = 12_000;

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

type PageCache = Map<string, Promise<string | null>>;
type PageRead = (url: string) => Promise<string | null>;

function citedIds(raw: unknown, urlOf: Map<number, string>): number[] {
  return [...new Set<number>((Array.isArray(raw) ? raw : []).map((n: unknown) => Number(n)).filter((n: number) => urlOf.has(n)))];
}

/** Source ids, in the order given, whose stored text contains `quote` by quoteOnPage. */
async function sourcesContaining(quote: string, ids: number[], urlOf: Map<number, string>, read: PageRead, cache: PageCache): Promise<number[]> {
  const found: number[] = [];
  for (const id of ids) {
    const text = await textFor(urlOf.get(id)!, read, cache);
    if (text && quoteOnPage(quote, text)) found.push(id);
  }
  return found;
}

/** Keeps a warning only when the quote is found, verbatim by quoteOnPage, in a source it cites. */
async function verifyWarnings(input: PreviewInput, got: any, read: PageRead, cache: PageCache): Promise<{ warnings: SavedWarning[]; dropped: Dropped[] }> {
  const warnings: SavedWarning[] = [];
  const dropped: Dropped[] = [];
  const urlOf = new Map(input.sourceUrls.map((s) => [s.id, s.url]));
  for (const w of Array.isArray(got?.warnings) ? got.warnings : []) {
    const title = typeof w?.title === 'string' ? w.title.trim() : '';
    if (!w || !KEPT.has(w.type) || !title) {
      dropped.push({ title, reason: title ? 'not a kept type' : 'no title' });
      continue;
    }
    const quote = typeof w.quote === 'string' ? w.quote.trim() : '';
    if (!quote) { dropped.push({ title, reason: 'no quote' }); continue; }
    const found = await sourcesContaining(quote, citedIds(w.sources, urlOf), urlOf, read, cache);
    if (!found.length) { dropped.push({ title, reason: 'quote is not in a cited source' }); continue; }
    warnings.push({ type: w.type, title, detail: String(w.detail ?? '').trim(), risk: String(w.risk ?? '').trim(), quote, sources: found });
  }
  return { warnings, dropped };
}

/** The hook is kept only when its own quote passes the same check. A failure becomes an empty hook. */
async function verifyHook(input: PreviewInput, got: any, read: PageRead, cache: PageCache): Promise<{ hook: string; dropped: Dropped | null }> {
  const raw = got?.hook;
  if (raw == null || raw === '') return { hook: '', dropped: null };
  const text = typeof raw === 'string' ? raw.trim() : (raw && typeof raw === 'object' && typeof raw.text === 'string' ? raw.text.trim() : '');
  const quote = raw && typeof raw === 'object' && typeof raw.quote === 'string' ? raw.quote.trim() : '';
  const sourceList = raw && typeof raw === 'object' ? raw.sources : undefined;
  if (!text && !quote && !Array.isArray(sourceList)) return { hook: '', dropped: null };
  const title = text || 'hook';
  if (!text) return { hook: '', dropped: { title, reason: 'no hook' } };
  if (!quote) return { hook: '', dropped: { title, reason: 'no quote' } };
  const urlOf = new Map(input.sourceUrls.map((s) => [s.id, s.url]));
  const found = await sourcesContaining(quote, citedIds(sourceList, urlOf), urlOf, read, cache);
  if (!found.length) return { hook: '', dropped: { title, reason: 'quote is not in a cited source' } };
  return { hook: text, dropped: null };
}

function officialDomains(dive: any): string[] {
  const list = dive?.result?.identity?.official_domains;
  return Array.isArray(list) ? list.map((d) => String(d)) : [];
}

/** One scrubbed window per cited source. The cache keeps the raw page, which the quote check reads. */
async function sourcePassages(input: PreviewInput, read: PageRead, domains: readonly string[], cache: PageCache): Promise<{ id: number; text: string }[]> {
  const out: { id: number; text: string }[] = [];
  let used = 0;
  for (const src of input.sourceUrls) {
    if (out.length >= PASSAGE_SOURCES || used >= PASSAGE_TOTAL) break;
    const raw = await textFor(src.url, read, cache);
    if (!raw) continue;
    const facts = input.facts.filter((f) => f.sources.includes(src.id)).map((f) => f.fact).join(' ');
    const room = Math.min(PASSAGE_CHARS, PASSAGE_TOTAL - used);
    const text = passageWindow(scrubPublic(raw, domains), facts, room);
    if (!text) continue;
    out.push({ id: src.id, text });
    used += text.length;
  }
  return out;
}

function previewPrompt(input: PreviewInput): string {
  const today = new Date().toISOString().slice(0, 10);
  const names = [input.legalName, ...input.tradingNames].filter(Boolean).join(', ') || '(unknown)';
  const area = [input.town, input.state].filter(Boolean).join(', ') || '(unknown)';
  const leadership = input.leadership.map((p) => `- ${p.name}${p.title ? `: ${p.title}` : ''}`).join('\n') || '(none)';
  const facts = input.facts.map((f) => `- [${f.sources.join(', ')}] ${f.fact}`).join('\n') || '(none)';
  const passages = (input.passages ?? []).map((p) => `[${p.id}] ${p.text}`).join('\n\n') || '(none)';
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
    'Source passages. The number in brackets is the source id:',
    passages,
    '',
    'Return JSON only:',
    '{"hook": {"text": "one sentence to the owner, specific to them, at most 22 words", "quote": "exact words copied character for character from one passage above", "sources": [1]},',
    '"known": [{"label": "2-3 words", "value": "at most 14 words, the fact itself"}],',
    '"warnings": [{"type": "contradiction | outdated | wrong", "title": "at most 11 words, plain, specific", "detail": "1-2 sentences with the actual values the sources give", "risk": "1 sentence: who notices this and what it can cost the business", "quote": "exact words copied character for character from one passage above", "sources": [1]}]}',
    '',
    `Types: contradiction = two of the facts above give different values for the same thing; outdated = a date, certificate, promotion or figure in the facts that has passed or no longer matches today (${today}); wrong = a fact the other facts show is not so.`,
    'There is no quota and no minimum. Return a warning only when the facts above support it, and return an empty warnings list when they do not.',
    'Rules: use only the material above; every quote must be copied character for character from one of these passages, and must cite that passage\'s source id; never invent facts or numbers; do not accuse the company of dishonesty: say what the sources show; drop citation markers; British English; speak to the owner as "you".',
    'This preview is public and unpaid: name no person except the leadership listed above; give no phone numbers, ID numbers, emails or links.',
  ].join('\n');
}

export async function writePreviewV2(dive: any, sourceText: (url: string) => Promise<string | null>): Promise<void> {
  const id = Number(dive?.id);
  let release: (() => void) | undefined;
  try {
    const options = switchOptions(dive);
    if (!switchOn(options, 'preview2')) return;
    // Before any await: a concurrent sweep or /dp/ must already see this id in `editing`.
    editing.add(id);
    release = () => { editing.delete(id); };
    const ctx = makeCtx(String(dive.id), 'P', 'preview2');
    const input = previewInput(dive?.result);
    const read = typeof sourceText === 'function' ? sourceText : async () => null;
    const cache = new Map<string, Promise<string | null>>();
    await reportdb.sql(`alter table dive_preview add column if not exists notes_v2 jsonb`);
    input.passages = await sourcePassages(input, read, officialDomains(dive), cache);
    const prompt = previewPrompt(input);
    const edited_at = new Date().toISOString();
    const store = async (body: Record<string, unknown>) => {
      const saved = { ...body, meter: ctx.meter, edited_at };
      await reportdb.sql(
        `insert into dive_preview (dive_id, notes_v2, meter) values ($1, $2::jsonb, $3::jsonb) on conflict (dive_id) do update set notes_v2 = excluded.notes_v2, meter = excluded.meter`,
        [dive.id, JSON.stringify(saved), JSON.stringify(ctx.meter)],
      );
    };
    // A content failure still inserts a row. The notes column keeps its default. A thrown error stores its kind, never its message.
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
      // No answer, or an answer that did not parse. Either way the row exists, with the error's kind.
      const err = thrown ?? new Error('parse');
      if (thrown == null && err instanceof Error) err.name = 'parse';
      await store(failed(err));
      return;
    }
    let hook = '';
    let warnings: SavedWarning[];
    let dropped: Dropped[];
    try {
      ({ warnings, dropped } = await verifyWarnings(input, got, read, cache));
      const checked = await verifyHook(input, got, read, cache);
      hook = checked.hook;
      if (checked.dropped) dropped.push(checked.dropped);
    } catch (err) {
      // Quote check threw. Keep a row so the sweep's "no row yet" query leaves this dive alone.
      await store(failed(err));
      return;
    }
    await store({
      prompt,
      hook,
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
