import { readFileSync } from 'node:fs';
import { findPhoneNumbersInText, parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js';

export type Locale = { country: string; currency: string; price: string | null; dateLocale: string };
const countries: Record<string, [string, string, string]> = {
  malaysia: ['MY', 'MYR', 'en-MY'], my: ['MY', 'MYR', 'en-MY'],
  korea: ['KR', 'KRW', 'ko-KR'], 'south korea': ['KR', 'KRW', 'ko-KR'], kr: ['KR', 'KRW', 'ko-KR'],
  singapore: ['SG', 'SGD', 'en-SG'], sg: ['SG', 'SGD', 'en-SG'],
  'united states': ['US', 'USD', 'en-US'], usa: ['US', 'USD', 'en-US'], us: ['US', 'USD', 'en-US'],
  'united kingdom': ['GB', 'GBP', 'en-GB'], gb: ['GB', 'GBP', 'en-GB'],
};
export function localeFor(country: string, language: 'en' | 'ko' = 'en'): Locale {
  const [code, currency, dateLocale] = countries[country.trim().toLowerCase()] ?? ['', 'USD', 'en-US'];
  let prices: Record<string, string> = {};
  try { prices = JSON.parse(process.env.REPORT_PRICES ?? '{}'); } catch { /* Missing or invalid configuration. */ }
  return { country: code || country, currency, price: typeof prices?.[currency] === 'string' ? prices[currency] : null, dateLocale: language === 'ko' ? 'ko-KR' : dateLocale };
}
export function formatMoney(amount: number, loc: Locale): string {
  return new Intl.NumberFormat(loc.dateLocale, { style: 'currency', currency: loc.currency, maximumFractionDigits: 2 }).format(amount);
}
export function cleanText(s: string): string {
  return s.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/^\s{0,3}#{1,6}\s*/gm, '').replace(/^\s*[-*+]\s+/gm, '')
    .replace(/\*\*|__|[*_`]/g, '').replace(/(\d[\d,.]*)\s*([A-Z]{2,3}|\p{Sc})(?=\s|\d|$)/gu, '$2$1')
    .replace(/\s+/g, ' ').trim();
}
export function plural(n: number, one: string, many: string): string { return `${n} ${n === 1 ? one : many}`; }
function countryCode(country: string): CountryCode | undefined {
  const code = countries[country.trim().toLowerCase()]?.[0] ?? country.toUpperCase();
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
const datePattern = /\b(?:\d{4}[-/]\d{1,2}[-/]\d{1,2}|\d{1,2}[-/]\d{1,2}[-/]\d{4}|(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4}|\d{1,2}(?:st|nd|rd|th)?\s+(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{4})\b/gi;
function dateValue(s: string): number | null {
  let normalized = s.replace(/(\d)(st|nd|rd|th)\b/gi, '$1');
  const dmy = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(normalized);
  if (dmy && +dmy[1] > 12) normalized = `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;
  const time = Date.parse(normalized + " UTC"); return Number.isNaN(time) ? null : time;
}
function claims(s: string): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  // Consume structured claims first so their components are not treated as separate numbers.
  const take = (re: RegExp, norm: (v: string) => string | null) => { s = s.replace(re, v => { const n = norm(v); if (n !== null) out.push([v, n]); return ' '; }); };
  take(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, v => `email:${v.toLowerCase()}`);
  take(/\b(?:https?:\/\/)?(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/[^\s<]*)?/gi, v => `url:${v.toLowerCase().replace(/^https?:\/\//, '').replace(/\/$/, '')}`);
  take(datePattern, v => { const d = dateValue(v); return d === null ? null : `date:${d}`; });
  const phones = findPhoneNumbersInText(s);
  for (const p of phones.reverse()) { out.push([p.raw, `phone:${p.number.number.replace(/\D/g, '')}`]); s = s.slice(0, p.startsAt) + ' ' + s.slice(p.endsAt); }
  take(/\b\d+(?:,\d{3})*(?:\.\d+)?(?:\s*(?:billion|million|thousand|[kmb])\b)?/gi, v => {
    const m = /^([\d,.]+)\s*(.*)$/i.exec(v)!; const mult: Record<string, number> = { k: 1e3, thousand: 1e3, m: 1e6, million: 1e6, b: 1e9, billion: 1e9 };
    return `number:${Number(m[1].replace(/,/g, '')) * (mult[m[2].toLowerCase()] ?? 1)}`;
  });
  return out;
}
export function claimMismatches(text: string, quotes: string[]): string[] {
  const supported = new Set(quotes.flatMap(q => claims(q).map(([, n]) => n)));
  const quoteDigits = quotes.flatMap(q => [...q.matchAll(/\+?\d[\d ().-]{6,}\d/g)].map(m => m[0].replace(/\D/g, '')));
  return [...new Set(claims(text).filter(([, n]) => !supported.has(n) && !(n.startsWith('phone:') && quoteDigits.includes(n.slice(6)))).map(([v]) => v))];
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
export function daysToImpact(texts: string[], now: Date): number | null {
  const dates = texts.flatMap(t => [...t.matchAll(datePattern)].map(m => dateValue(m[0]))).filter((n): n is number => n !== null && n >= Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  return dates.length ? Math.ceil((Math.min(...dates) - Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())) / 86400000) : null;
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



