import { readFileSync } from 'node:fs';
import { findPhoneNumbersInText, parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js';

export type Locale = { country: string; currency: string; dateLocale: string };
const currencies: Record<string, string> = JSON.parse(readFileSync(new URL('./country-currencies.json', import.meta.url), 'utf8'));
const regionNames = new Intl.DisplayNames(['en'], { type: 'region' });
const regions = new Map<string, string>();
for (let a = 65; a <= 90; a++) for (let b = 65; b <= 90; b++) {
  const code = String.fromCharCode(a, b);
  const name = regionNames.of(code);
  if (name && name !== code) { regions.set(code.toLowerCase(), code); regions.set(name.toLowerCase(), code); }
}
for (const [name, code] of Object.entries({ 'south korea': 'KR', korea: 'KR', usa: 'US', uk: 'GB', uae: 'AE', vietnam: 'VN', 'viet nam': 'VN' })) regions.set(name, code);
function resolveCountry(country: string): string | undefined { return regions.get(country.trim().toLowerCase()); }
export function localeFor(country: string, language: 'en' | 'ko' = 'en'): Locale {
  const code = resolveCountry(country);
  const currency = (code && currencies[code]) || 'USD';
  return { country: code || country, currency, dateLocale: language === 'ko' ? 'ko-KR' : `en-${code || 'US'}` };
}
export function formatMoney(amount: number, loc: Locale): string {
  return new Intl.NumberFormat(loc.dateLocale, { style: 'currency', currency: loc.currency, maximumFractionDigits: 2 }).format(amount);
}
const currencyMarkers = new Set(Intl.supportedValuesOf('currency'));
for (const code of Object.keys(currencies)) for (const currency of Intl.supportedValuesOf('currency')) {
  const parts = new Intl.NumberFormat(`en-${code}`, { style: 'currency', currency, currencyDisplay: 'narrowSymbol' }).formatToParts(1);
  const marker = parts.find(part => part.type === 'currency')?.value;
  if (marker) currencyMarkers.add(marker);
}
// KM is also a common distance unit, so leave it in its original order. 
currencyMarkers.delete('KM');
const currencyPattern = [...currencyMarkers].sort((a, b) => b.length - a.length).map(s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
// A trailing marker is moved only when it is a currency symbol or a code of 2+ characters that is not an English word
// ("500 K", "4 K video", "100 ALL employees" and "Page 1 P" are not money).
const WORD_CODES = new Set(['ALL', 'CUP', 'TOP', 'MOP', 'BOB', 'PEN', 'MAD', 'SOS']);
const acceptableMarker = (m: string) => /^\p{Sc}$/u.test(m) || (m.length >= 2 && !WORD_CODES.has(m));
const leadingCurrency = new RegExp(`^(?:${currencyPattern}|\\p{Sc})`, 'u');
/** True when the text starts with a currency symbol or code (same set cleanText uses). */
export function startsWithCurrency(s: string): boolean { const m = leadingCurrency.exec(s); return !!m && acceptableMarker(m[0]); }
const trailingCurrency = new RegExp(`(\\d[\\d,.]*)(\\s+(?:[\\p{L}]+\\s+)?|\\s*)(${currencyPattern}|\\p{Sc})(?![\\p{L}\\p{N}])`, 'gu');
export function cleanText(s: string): string {
  return s.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/^\s{0,3}#{1,6}\s*/gm, '').replace(/^\s*[-*+]\s+/gm, '')
    .replace(/\*\*(?=\S)(.+?)(?<=\S)\*\*|(?<![\p{L}\p{N}_])__(?=\S)(.+?)(?<=\S)__(?![\p{L}\p{N}_])|(?<![\p{L}\p{N}_])\*(?=\S)(.+?)(?<=\S)\*(?![\p{L}\p{N}_])|(?<![\p{L}\p{N}_])_(?=\S)(.+?)(?<=\S)_(?![\p{L}\p{N}_])/gu, (_, a, b, c, d) => a ?? b ?? c ?? d)
    .replace(/`([^`]+)`/g, '$1').replace(trailingCurrency, (all, number, middle, marker) => !acceptableMarker(marker) ? all : `${marker}${number}${middle.trim() ? ' ' + middle.trim() : ''}`)
    .replace(/\s+/g, ' ').trim();
}
export function plural(n: number, one: string, many: string): string { return `${n} ${n === 1 ? one : many}`; }
function countryCode(country: string): CountryCode | undefined {
  const code = resolveCountry(country) ?? country.toUpperCase();
  return /^[A-Z]{2}$/.test(code) ? code as CountryCode : undefined;
}
export function phonesIn(text: string, country: string): string[] {
  try { return [...new Set(findPhoneNumbersInText(text, countryCode(country)).map(x => x.number.number))]; } catch { return []; }
}
export type PiiHit = { kind: 'phone' | 'person'; value: string; where: string };
const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export function findPII(text: string, where: string, ctx: { country: string; companyPhones: string[]; personNames: string[] }): PiiHit[] {
  const allowed = new Set(ctx.companyPhones.flatMap(p => phonesIn(p, ctx.country)));
  const hits: PiiHit[] = phonesIn(text, ctx.country).filter(p => !allowed.has(p)).map(value => ({ kind: 'phone', value, where }));
  for (const name of ctx.personNames.filter(n => n.trim())) {
    if (new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(name.trim())}(?![\\p{L}\\p{N}])`, 'iu').test(text)) hits.push({ kind: 'person', value: name, where });
  }
  return hits;
}
const datePattern = /\b(?:\d{4}[-/]\d{1,2}[-/]\d{1,2}|\d{1,2}[-/]\d{1,2}[-/]\d{4}|(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4}|\d{1,2}(?:st|nd|rd|th)?\s+(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{4})(?:\b|(?=T\d{2}:\d{2}))/gi;
// Countries that write 05/06/2024 as month first; everyone else (and no country) reads it day first.
const monthFirstCountries = new Set<string>(JSON.parse(readFileSync(new URL('./month-first-countries.json', import.meta.url), 'utf8')));
function dateValue(s: string, country?: string): number | null {
  let normalized = s.replace(/(\d)(st|nd|rd|th)\b/gi, '$1');
  const dmy = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(normalized);
  if (dmy) {
    const code = country ? resolveCountry(country) ?? country.toUpperCase() : '';
    const monthFirst = +dmy[1] > 12 ? false : +dmy[2] > 12 ? true : monthFirstCountries.has(code);
    const [d, m] = monthFirst ? [dmy[2], dmy[1]] : [dmy[1], dmy[2]];
    normalized = `${dmy[3]}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  const time = Date.parse(normalized + " UTC"); return Number.isNaN(time) ? null : time;
}
function claims(s: string, country?: string): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  // Consume structured claims first so their components are not treated as separate numbers.
  const take = (re: RegExp, norm: (v: string) => string | null) => { s = s.replace(re, v => { const n = norm(v); if (n !== null) out.push([v, n]); return ' '; }); };
  take(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, v => `email:${v.toLowerCase()}`);
  take(/\b(?:https?:\/\/)?(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/[^\s<]*)?/gi, v => `url:${v.toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/$/, '')}`);
  take(datePattern, v => { const d = dateValue(v, country); return d === null ? null : `date:${d}`; });
  const phones = findPhoneNumbersInText(s);
  for (const p of phones.reverse()) { out.push([p.raw, `phone:${p.number.number.replace(/\D/g, '')}`]); s = s.slice(0, p.startsAt) + ' ' + s.slice(p.endsAt); }
  take(/\b\d+(?:,\d{3})*(?:\.\d+)?(?:\s*(?:billion|million|thousand|[kmb])\b)?/gi, v => {
    const m = /^([\d,.]+)\s*(.*)$/i.exec(v)!; const mult: Record<string, number> = { k: 1e3, thousand: 1e3, m: 1e6, million: 1e6, b: 1e9, billion: 1e9 };
    return `number:${Number(m[1].replace(/,/g, '')) * (mult[m[2].toLowerCase()] ?? 1)}`;
  });
  return out;
}
export function claimMismatches(text: string, quotes: string[], country?: string): string[] {
  const supported = new Set(quotes.flatMap(q => claims(q, country).map(([, n]) => n)));
  for (const q of quotes) for (const m of q.matchAll(/[\w.+-]+@([\w.-]+\.[a-z]{2,})/gi)) supported.add(`url:${m[1].toLowerCase().replace(/^www\./, '')}`);
  const normalize = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim().replace(/[\p{P}]+$/gu, '');
  const normalizedQuotes = quotes.map(normalize);
  const quoteDigits = quotes.flatMap(q => [...q.matchAll(/\+?\d[\d ().-]{6,}\d/g)].map(m => m[0].replace(/\D/g, '')));
  return [...new Set(claims(text, country).filter(([v, n]) => !supported.has(n) && !(v && normalizedQuotes.some(q => q.includes(normalize(v)))) && !(n.startsWith('phone:') && quoteDigits.includes(n.slice(6)))).map(([v]) => v))];
}
export const BANNED_WORDS: string[] = JSON.parse(readFileSync(new URL('./banned-words.json', import.meta.url), 'utf8').replace(/^\uFEFF/, ''));
export function bannedWords(text: string): string[] {
  return BANNED_WORDS.filter(w => new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(w)}(?![\\p{L}\\p{N}])`, 'iu').test(text));
}
export function similarPairs(items: Array<{ id: string; text: string }>, threshold = 0.65): Array<[string, string]> {
  const sets = items.map(x => new Set(x.text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])); const pairs: Array<[string, string]> = [];
  for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
    const union = new Set([...sets[i], ...sets[j]]); const intersection = [...sets[i]].filter(w => sets[j].has(w)).length;
    if (union.size && intersection / union.size >= threshold) pairs.push([items[i].id, items[j].id]);
  } return pairs;
}
export type Urgency = 'critical' | 'high' | 'medium' | 'low';
export function daysToImpact(texts: string[], now: Date, options: { includePast?: boolean; country?: string } = {}): number | null {
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const dates = texts.flatMap(t => [...t.matchAll(datePattern)].map(m => dateValue(m[0], options.country))).filter((n): n is number => n !== null && (options.includePast || n >= today));
  return dates.length ? Math.round((dates.sort((a, b) => Math.abs(a - today) - Math.abs(b - today) || a - b)[0] - today) / 86400000) : null;
}
export function severity(x: { recordLevel: number; confidence: string | undefined; days: number | null; reach?: number; breaks?: boolean }): Urgency {
  let level = Math.max(1, Math.min(4, x.recordLevel + (x.breaks ? 1 : 0)));
  if (x.confidence !== 'high') level = Math.min(level, 3);
  if (x.days !== null && x.days <= 30) level = 4; else if (x.days !== null && x.days <= 90) level = Math.max(level, 3);
  return (['low', 'medium', 'high', 'critical'] as Urgency[])[level - 1];
}
export function rankKey(u: Urgency, days: number | null): number {
  const rank = { low: 1, medium: 2, high: 3, critical: 4 }[u];
  return rank * 1000000 + (days === null ? 0 : 1 / (1 + Math.max(0, days)));
}
export function leftoverMarkdown(text: string): string[] { return text.match(/\*\*|__|\[[^\]]+\]\([^)]+\)|^\s{0,3}#{1,6}\s|^\s*[-*+]\s+/gm) ?? []; }
export function bareIds(text: string): string[] { return text.match(/\b[fscn]\d+\b/gi)?.filter(x => /^[fscn]\d+$/i.test(x)) ?? []; }
export function deadLinks(html: string): string[] {
  const ids = new Set([...html.matchAll(/\bid\s*=\s*["']([^"']+)["']/gi)].map(m => m[1]));
  return [...new Set([...html.matchAll(/\bhref\s*=\s*["']#([^"']+)["']/gi)].map(m => m[1]).filter(id => !ids.has(id)).map(id => `#${id}`))];
}
export type GateFailure = { rule: string; where: string; detail: string };




