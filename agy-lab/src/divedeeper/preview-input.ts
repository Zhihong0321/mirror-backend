// What the switched preview editor is allowed to see. Everything else in the company-dive
// (the address, registration numbers, domains, the summary, contradictions, gaps, and anyone
// who is not leadership) stays out of the prompt.
import type { DiveResult } from '../companydive/pipeline.ts';
import { hasPrivate, isLeadershipStrict, publicSources, scrubPublic } from './privacy.ts';

export type PreviewInput = {
  legalName: string;
  tradingNames: string[];
  industry: string;
  town: string;
  state: string;
  leadership: { name: string; title: string }[];
  /** Public facts that cite a public source. `sources` are those source ids. */
  facts: { fact: string; sources: number[] }[];
  /** Where a cited id was published. The prompt does not read this. */
  sourceUrls: { id: number; url: string }[];
  /** Scrubbed windows of cited sources. The writer fills this; the allow-list leaves it unset. */
  passages?: { id: number; text: string }[];
};

const clean = (text: unknown, domains: string[]): string => {
  const s = String(text ?? '').trim();
  if (!s) return '';
  return hasPrivate(s) ? scrubPublic(s, domains) : s;
};

/** Town and state after a Malaysian postcode. The street and the postcode stay out. */
function areaOf(address: unknown): { town: string; state: string } {
  const m = String(address ?? '').match(/\b\d{5}\s+([^,\n]+)\s*(?:,\s*([^,\n]+))?/);
  if (!m) return { town: '', state: '' };
  return { town: m[1].trim(), state: (m[2] ?? '').trim() };
}

function peopleOf(result: DiveResult): { name?: unknown; role?: unknown }[] {
  const people = (result.people as { people?: unknown } | null | undefined)?.people;
  return Array.isArray(people) ? people : [];
}

// Only facts from these topics (companydive/pipeline.ts TOPICS) reach the prompt. ownership_people, reputation, news
// and risks can name staff or private people and no code can spot every name, so they stay out whole; leadership
// comes in separately, as name and title from the people step.
const PUBLIC_TOPICS = new Set(['identity', 'products_services', 'projects_clients', 'footprint', 'size_financials',
  'competitors', 'digital_presence']);

const escRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The name as written, the name before a bracket, and the name inside it. */
function nameForms(name: unknown): string[] {
  const raw = String(name ?? '').replace(/\s+/g, ' ').trim();
  if (!raw) return [];
  const nick = raw.match(/\(([^)]+)\)/)?.[1]?.replace(/\s+/g, ' ').trim() ?? '';
  const bare = raw.replace(/\s*\(.*\)\s*$/, '').replace(/\s+/g, ' ').trim();
  return [...new Set([raw, bare, nick].filter((s) => s.length >= 3))];
}

function mentions(text: string, form: string): boolean {
  return new RegExp(`\\b${escRe(form)}\\b`, 'i').test(text);
}

/** Names on the people step that did not make the leadership list, including rejected ones. */
function blockedNames(result: DiveResult, allowed: Set<string>): string[] {
  const rejected = (result.people as { rejected?: unknown } | null | undefined)?.rejected;
  const extra = Array.isArray(rejected) ? rejected.flatMap((p) => nameForms((p as { name?: unknown })?.name)) : [];
  return [...peopleOf(result).flatMap((p) => nameForms(p?.name)), ...extra]
    .filter((n) => !allowed.has(n.toLowerCase()));
}

/** The allow-list. Only this object may be turned into the preview prompt. */
export function previewInput(result: DiveResult): PreviewInput {
  const r = result ?? ({} as DiveResult);
  const id = r.identity ?? {};
  const domains = (id.official_domains ?? []).map((d) => String(d));
  const urls = new Map(publicSources(r.sources).flatMap((s) => (s.url ? [[s.id, s.url] as const] : [])));
  const people = peopleOf(r);
  const allowed = new Set<string>();
  const leadership = people.flatMap((p) => {
    if (!isLeadershipStrict(p?.role)) return [];
    const name = clean(p?.name, domains);
    if (!name) return [];
    for (const form of [...nameForms(p?.name), ...nameForms(name)]) allowed.add(form.toLowerCase());
    return [{ name, title: clean(p?.role, domains) }];
  });
  // Anyone else from the people step stays out of the prompt, including inside a fact.
  const blocked = blockedNames(r, allowed);
  const facts = (r.facts ?? []).flatMap((f) => {
    if (!f || typeof f.fact !== 'string') return [];
    if (!PUBLIC_TOPICS.has(String((f as { topic?: unknown }).topic ?? ''))) return [];
    const fact = f.fact.trim();
    if (!fact || hasPrivate(fact)) return [];
    if (blocked.some((n) => mentions(fact, n))) return [];
    const sources = [...new Set((f.sources ?? []).filter((n) => urls.has(n)))];
    return sources.length ? [{ fact, sources }] : [];
  });
  const cited = new Set(facts.flatMap((f) => f.sources));
  const area = areaOf(id.address);
  return {
    legalName: clean(id.legal_name, domains),
    tradingNames: (id.aliases ?? []).map((a) => clean(a, domains)).filter(Boolean),
    industry: clean(id.industry, domains),
    town: clean(area.town, domains),
    state: clean(area.state, domains),
    leadership,
    facts,
    sourceUrls: [...cited].flatMap((n) => {
      const url = urls.get(n);
      return url ? [{ id: n, url }] : [];
    }),
  };
}

const WORD = /[a-z0-9]+/g;

function wordSet(text: string): Set<string> {
  return new Set(text.toLowerCase().match(WORD) ?? []);
}

/** How many distinct words in `text` also appear in `words`. */
function wordOverlap(text: string, words: Set<string>): number {
  let n = 0;
  const seen = new Set<string>();
  for (const w of text.toLowerCase().match(WORD) ?? []) {
    if (!words.has(w) || seen.has(w)) continue;
    seen.add(w);
    n++;
  }
  return n;
}

/** Sentence spans in reading order. A line break ends a sentence, as does . ! or ? before whitespace. */
function sentenceSpans(text: string): { start: number; end: number }[] {
  const spans: { start: number; end: number }[] = [];
  let start = 0;
  for (let i = 0; i <= text.length; i++) {
    const atEnd = i === text.length;
    const c = text[i];
    const brk = atEnd || c === '\n' || ((c === '.' || c === '!' || c === '?') && (i + 1 === text.length || /\s/.test(text[i + 1] ?? '')));
    if (!brk) continue;
    const end = atEnd || c === '\n' ? i : i + 1;
    if (text.slice(start, end).trim()) spans.push({ start, end });
    if (atEnd) break;
    let next = c === '\n' ? i + 1 : end;
    while (next < text.length && text[next] !== '\n' && /\s/.test(text[next])) next++;
    start = next;
    i = next - 1;
  }
  return spans;
}

function clip(text: string, limit: number): string {
  const s = text.trim();
  if (s.length <= limit) return s;
  const cut = s.slice(0, limit);
  const sp = cut.lastIndexOf(' ');
  return (sp >= Math.floor(limit * 0.6) ? cut.slice(0, sp) : cut).trim();
}

/** At most `limit` characters around the first sentence that shares the most words with `facts`. */
export function passageWindow(text: string, facts: string, limit = 700): string {
  const body = String(text ?? '');
  if (limit <= 0 || !body.trim()) return '';
  const spans = sentenceSpans(body);
  if (!spans.length) return clip(body, limit);
  const factWords = wordSet(String(facts ?? ''));
  let best = 0;
  let bestScore = -1;
  for (let i = 0; i < spans.length; i++) {
    const score = wordOverlap(body.slice(spans[i].start, spans[i].end), factWords);
    if (score > bestScore) { bestScore = score; best = i; }
  }
  const lengthOf = (a: number, b: number) => body.slice(spans[a].start, spans[b].end).trim().length;
  if (lengthOf(best, best) > limit) return clip(body.slice(spans[best].start, spans[best].end), limit);
  let lo = best;
  let hi = best;
  let takePrev = true;
  for (;;) {
    const prevOk = lo > 0 && lengthOf(lo - 1, hi) <= limit;
    const nextOk = hi + 1 < spans.length && lengthOf(lo, hi + 1) <= limit;
    if (takePrev && prevOk) { lo--; takePrev = false; continue; }
    if (nextOk) { hi++; takePrev = true; continue; }
    if (prevOk) { lo--; takePrev = false; continue; }
    break;
  }
  return body.slice(spans[lo].start, spans[hi].end).trim();
}
