// PL25: the pre-send gate. One function runs every report lint and returns the failure list; an empty list means the
// report may be sent or served. Nothing here knows a company or a country: the country picks the currency (Intl).
import { readFileSync } from 'node:fs';
import {
  bannedWords, bareIds, claimMismatches, deadLinks, findPII, leftoverMarkdown, localeFor, similarPairs,
  type GateFailure,
} from './index.ts';

export type GateKind = 'v21-free' | 'deeper-full' | 'deeper-preview';
export type GateItem = {
  id: string; text: string; quotes: string[]; why?: string; ownership?: string;
  independentClaim?: boolean; hasIndependentSource?: boolean;
};
export type GateInput = {
  html: string; kind: GateKind; country: string; companyPhones: string[]; personNames: string[];
  items: GateItem[]; counts?: Record<string, number>;
};
export type { GateFailure };

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', hellip: '…', rsquo: '’', lsquo: '‘' };
const decode = (s: string) => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
  if (e[0] === '#') { const n = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); try { return String.fromCodePoint(n); } catch { return m; } }
  return ENTITIES[e.toLowerCase()] ?? m;
});

/** What a reader sees: no tags, <style>, <script>, attributes or comments; entities decoded; spaces collapsed. */
export function visibleText(html: string): string {
  return decode(html.replace(/<!--[\s\S]*?-->/g, ' ').replace(/<(style|script)\b[\s\S]*?<\/\1\s*>/gi, ' ').replace(/<[^>]*>/g, ' ')).replace(/[\s ]+/g, ' ').trim();
}

// ---------------------------------------------------------------- currency
// marker -> the currencies that print it, built from Intl: each currency is shown the way its own countries show it.
let markers: Map<string, Set<string>> | null = null;
const WORD_CODES = new Set(['ALL', 'TOP', 'TRY', 'PEN', 'SOS', 'MOP', 'CUP', 'GEL', 'LEU', 'KM']);
function currencyMarkers(): Map<string, Set<string>> {
  if (markers) return markers;
  const table: Record<string, string> = JSON.parse(readFileSync(new URL('./country-currencies.json', import.meta.url), 'utf8'));
  const homes = new Map<string, string[]>();
  for (const [country, cur] of Object.entries(table)) homes.set(cur, [...(homes.get(cur) ?? []), country]);
  const out = new Map<string, Set<string>>();
  const add = (marker: string | undefined, cur: string) => {
    if (!marker || (/^\p{L}$/u.test(marker)) || WORD_CODES.has(marker)) return;
    out.set(marker, (out.get(marker) ?? new Set()).add(cur));
  };
  for (const cur of Intl.supportedValuesOf('currency')) {
    add(cur, cur);
    for (const loc of ['en', ...(homes.get(cur) ?? []).slice(0, 3).map((c) => `en-${c}`)]) {
      for (const display of ['symbol', 'narrowSymbol'] as const) {
        try { add(new Intl.NumberFormat(loc, { style: 'currency', currency: cur, currencyDisplay: display }).formatToParts(1).find((p) => p.type === 'currency')?.value, cur); } catch { /* unknown locale */ }
      }
    }
  }
  return (markers = out);
}
const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Money written with a currency that is not the report country's own, e.g. "$59" on a Malaysian report. */
export function foreignCurrency(text: string, country: string): string[] {
  const own = localeFor(country).currency;
  const map = currencyMarkers();
  const pattern = [...map.keys()].sort((a, b) => b.length - a.length).map(escapeRegExp).join('|');
  const num = '\\d[\\d,.]*';
  const re = new RegExp(`(?<![\\p{L}\\p{N}])(${pattern})\\s?${num}|${num}\\s?(${pattern})(?![\\p{L}\\p{N}])`, 'gu');
  const bad = new Set<string>();
  for (const m of text.matchAll(re)) {
    const marker = m[1] ?? m[2];
    if (!map.get(marker)?.has(own)) bad.add(m[0].trim());
  }
  return [...bad];
}

/** The counts object a renderer printed its numbers from, kept in a data-counts='{...}' attribute on the page. */
export function countsInPage(html: string): Record<string, number> | undefined {
  const m = /sdata-countss*=s*"([^"]*)"/i.exec(html);
  if (!m) return undefined;
  try { const v = JSON.parse(decode(m[1])); return v && typeof v === 'object' ? v : undefined; } catch { return undefined; }
}

// ---------------------------------------------------------------- the gate
const OWNED_WORDING = /\byour domain\b|\brenew\b|\bset dmarc\b/i;

export function gateReport(input: GateInput): GateFailure[] {
  const out: GateFailure[] = [];
  const fail = (rule: string, where: string, detail: string) => out.push({ rule, where, detail });
  const text = visibleText(input.html);

  for (const hit of findPII(text, 'page', { country: input.country, companyPhones: input.companyPhones, personNames: input.personNames })) {
    fail('pii', hit.where, hit.kind === 'phone' ? `phone number ${hit.value} is not one of the company's published contacts` : `person name "${hit.value}"`);
  }
  // The 'Technology partner' strip names the services on purpose (a credit), and a <pre> block is a code sample for the
  // reader's web developer; neither is report wording.
  const own = visibleText(input.html.replace(/<div class="partners">[\s\S]*?<\/ul><\/div>/g, ' ').replace(/<pre\b[\s\S]*?<\/pre>/gi, ' '));
  for (const w of bannedWords(own)) fail('banned-word', 'page', `"${w}"`);
  for (const m of new Set(leftoverMarkdown(text).map((x) => x.trim()))) fail('markdown', 'page', `leftover markdown "${m}"`);
  for (const id of new Set(bareIds(text))) fail('bare-id', 'page', `internal id "${id}" is visible`);
  for (const d of deadLinks(input.html)) fail('dead-link', 'page', `${d} points to no section`);
  for (const c of foreignCurrency(visibleText(input.html.replace(/<(q|blockquote)\b[\s\S]*?<\/\1\s*>/gi, ' ').replace(/<(\w+)\b[^>]*\bdata-price\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')), input.country)) { // the full report price is USD by design
    fail('currency', 'page', `"${c}" is not the currency of ${localeFor(input.country).country} (${localeFor(input.country).currency})`);
  }

  for (const item of input.items) {
    for (const v of claimMismatches(item.text, item.quotes)) fail('claim-quote', item.id, `"${v}" is in the claim but in none of its quotes`);
    if (item.ownership !== undefined && item.ownership !== 'owned' && OWNED_WORDING.test(`${item.text} ${item.why ?? ''}`)) {
      fail('ownership', item.id, `wording assumes the company controls the asset, but ownership is "${item.ownership}"`);
    }
    if (item.independentClaim && !item.hasIndependentSource) fail('independent', item.id, 'says independent or third-party but cites no independent source');
  }
  for (const [a, b] of similarPairs(input.items.filter((x) => x.why?.trim()).map((x) => ({ id: x.id, text: x.why! })))) {
    fail('repeated-why', `${a}, ${b}`, 'the same "why it matters" text is used twice');
  }

  const counts = input.counts ?? countsInPage(input.html);
  if (counts) {
    const re = /<([a-z0-9]+)\b[^>]*?\sdata-count\s*=\s*"([^"]+)"[^>]*>([\s\S]*?)<\/\1\s*>/gi;
    for (const m of input.html.matchAll(re)) {
      const key = m[2]; const want = counts[key];
      if (want === undefined) { fail('count', key, `data-count "${key}" is not in the counts object`); continue; }
      for (const n of visibleText(m[3]).match(/\d[\d,]*/g) ?? []) {
        if (Number(n.replace(/,/g, '')) !== want) fail('count', key, `page prints ${n}, counts.${key} is ${want}`);
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------- policy
export type GateResult = { status: 'passed' | 'blocked'; failures: GateFailure[] };
/** REPORT_GATE: 'block' (default) stops a failing report; 'warn' stores the failures and still serves it. */
export const gateMode = (): 'block' | 'warn' => ((process.env.REPORT_GATE ?? '').trim().toLowerCase() === 'warn' ? 'warn' : 'block');
/** The stored result. In warn mode a failing report is marked 'passed' with its failures kept, so it is still served. */
export function gateResult(failures: GateFailure[]): GateResult {
  return { status: failures.length && gateMode() === 'block' ? 'blocked' : 'passed', failures };
}
