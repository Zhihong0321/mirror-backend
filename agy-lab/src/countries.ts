// Country packs: per-country search instructions for company dive (src/countries/README.md).
//
// A pack is data, never code: src/countries/<CC>/pack.json. It may only ADD to what a dive
// already does, in a few fixed slots:
//
//   search    the country codes Brave, Tavily and Exa get (else today's COUNTRY_CODES / 'MY')
//   discover  up to 8 extra Brave queries in step 1 (outside the Tavily budget)
//   walled    extra hosts whose pages cannot be read (login or bot walls)
//   notes     country instructions added to the triage, analyse, reflect, reserve-facts,
//             write and people prompts, just before their "Answer with ONLY" line
//
// It cannot remove a query, change the Tavily budget, call another API or change a stage.
// No pack, an empty pack, a draft pack or a broken pack all give exactly today's dive:
// a pack that fails validation is ignored whole and the dive log says why.
//
// Only packs with status "live" are used. COUNTRY_PACKS_DRAFT=1 also uses drafts (local
// test runs: scripts/country-dive.ts). COUNTRY_PACKS=off turns every pack off.
import fs from 'node:fs';
import path from 'node:path';

export const DIR = path.join(import.meta.dirname, 'countries');

export const LANGUAGES: Record<string, string> = {
  en: 'English', ms: 'Malay', zh: 'Chinese', 'zh-Hans': 'Simplified Chinese', 'zh-Hant': 'Traditional Chinese',
  ta: 'Tamil', hi: 'Hindi', ja: 'Japanese', ko: 'Korean', th: 'Thai', vi: 'Vietnamese', id: 'Indonesian',
  tl: 'Filipino', ar: 'Arabic', pt: 'Portuguese', es: 'Spanish', fr: 'French', de: 'German', nl: 'Dutch',
  ru: 'Russian', it: 'Italian',
};

/**
 * The country codes Brave's search accepts (its 422 answer lists them, checked 2026-11-01).
 * Any other code fails every Brave query, so it is dropped and the search runs worldwide.
 * Not on it: Singapore, Thailand, Vietnam, Ireland, the UAE.
 */
export const BRAVE_COUNTRIES = new Set(['AR', 'AU', 'AT', 'BE', 'BR', 'CA', 'CL', 'DK', 'FI', 'FR', 'DE', 'GR', 'HK', 'IN', 'ID', 'IT',
  'JP', 'KR', 'MY', 'MX', 'NL', 'NZ', 'NO', 'CN', 'PL', 'PT', 'PH', 'RU', 'SA', 'ZA', 'ES', 'SE', 'CH', 'TW', 'TR', 'GB', 'US']);

/** The code to send Brave: `code` when Brave accepts it, else none. */
export function braveCountry(code: string | undefined): string | undefined {
  return code && BRAVE_COUNTRIES.has(code) ? code : undefined;
}

export const NOTE_STEPS =['triage', 'analyse', 'reflect', 'facts', 'write', 'people'] as const;
export type NoteStep = typeof NOTE_STEPS[number];

/** Labels the dive's own Brave queries use; a pack query may not take one. */
const BASE_LABELS = ['exact', 'country', 'facebook', 'linkedin', 'reviews', 'people', 'projects', 'news'];
const PLACEHOLDERS = ['company', 'short', 'country'];
const MAX_DISCOVER = 8;
const MAX_NOTE = 3000;

export type DiscoverQuery = { label: string; query: string; kind: 'web' | 'news' };

export type Pack = {
  code: string;
  country: string;
  status: 'draft' | 'live';
  names: string[];
  languages: string[];
  search: { brave_country?: string; tavily_country?: string; exa_location?: string };
  discover: DiscoverQuery[];
  walled: string[];
  notes: Partial<Record<NoteStep, string>>;
};

const KEYS = ['code', 'country', 'status', 'names', 'languages', 'search', 'discover', 'walled', 'notes'];
const SEARCH_KEYS = ['brave_country', 'tavily_country', 'exa_location'];

const isStr = (v: unknown): v is string => typeof v === 'string';

/** Every problem with one pack.json; [] means it is valid. `folder` is the folder name it sits in. */
export function validate(raw: unknown, folder: string): string[] {
  const errs: string[] = [];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return ['pack.json is not a JSON object'];
  const p = raw as Record<string, unknown>;
  for (const k of Object.keys(p)) if (!KEYS.includes(k)) errs.push(`unknown field "${k}"`);
  if (!isStr(p.code) || !/^[A-Z]{2}$/.test(p.code)) errs.push('code must be two capital letters, e.g. "SG"');
  else if (p.code !== folder) errs.push(`code "${p.code}" does not match its folder "${folder}"`);
  if (!isStr(p.country) || !p.country.trim()) errs.push('country is required');
  if (p.status !== 'draft' && p.status !== 'live') errs.push('status must be "draft" or "live"');
  if (!Array.isArray(p.names) || !p.names.length || p.names.length > 10) errs.push('names must list 1 to 10 names');
  else for (const n of p.names) if (!isStr(n) || n !== n.trim().toLowerCase() || !n) errs.push(`name "${n}" must be lowercase text with no outer spaces`);
  if (!Array.isArray(p.languages) || !p.languages.length) errs.push('languages must list at least one language code');
  else for (const l of p.languages) if (!isStr(l) || !LANGUAGES[l]) errs.push(`language "${l}" is not one of: ${Object.keys(LANGUAGES).join(', ')}`);

  const s = p.search ?? {};
  if (typeof s !== 'object' || Array.isArray(s)) errs.push('search must be an object');
  else {
    const so = s as Record<string, unknown>;
    for (const k of Object.keys(so)) if (!SEARCH_KEYS.includes(k)) errs.push(`unknown field "search.${k}"`);
    for (const k of ['brave_country', 'exa_location']) if (so[k] !== undefined && (!isStr(so[k]) || !/^[A-Z]{2}$/.test(so[k] as string))) errs.push(`search.${k} must be two capital letters`);
    if (isStr(so.brave_country) && /^[A-Z]{2}$/.test(so.brave_country) && !BRAVE_COUNTRIES.has(so.brave_country)) errs.push(`search.brave_country "${so.brave_country}" is not a country Brave accepts; leave it out (Brave then searches worldwide). Brave accepts: ${[...BRAVE_COUNTRIES].join(', ')}`);
    if (so.tavily_country !== undefined && (!isStr(so.tavily_country) || !/^[a-z][a-z ]{1,40}$/.test(so.tavily_country))) errs.push('search.tavily_country must be a lowercase country name, e.g. "singapore"');
  }

  const d = p.discover ?? [];
  if (!Array.isArray(d)) errs.push('discover must be a list');
  else {
    if (d.length > MAX_DISCOVER) errs.push(`discover has ${d.length} queries; the most is ${MAX_DISCOVER}`);
    const seen = new Set<string>();
    d.forEach((q, i) => {
      const at = `discover[${i}]`;
      if (!q || typeof q !== 'object') { errs.push(`${at} must be an object`); return; }
      const qo = q as Record<string, unknown>;
      for (const k of Object.keys(qo)) if (!['label', 'query', 'kind'].includes(k)) errs.push(`unknown field "${at}.${k}"`);
      if (!isStr(qo.label) || !/^[a-z0-9-]{1,24}$/.test(qo.label)) errs.push(`${at}.label must be 1-24 of a-z, 0-9 and -`);
      else if (BASE_LABELS.includes(qo.label)) errs.push(`${at}.label "${qo.label}" is taken by the dive's own queries`);
      else if (seen.has(qo.label)) errs.push(`${at}.label "${qo.label}" is used twice`);
      else seen.add(qo.label);
      if (!isStr(qo.query) || !qo.query.trim() || qo.query.length > 200) errs.push(`${at}.query must be 1-200 characters`);
      else {
        for (const m of qo.query.matchAll(/\{([^}]*)\}/g)) if (!PLACEHOLDERS.includes(m[1])) errs.push(`${at}.query uses {${m[1]}}; only {company}, {short} and {country} exist`);
        if (!/\{(company|short)\}/.test(qo.query)) errs.push(`${at}.query must name the company with {company} or {short}`);
      }
      if (qo.kind !== 'web' && qo.kind !== 'news') errs.push(`${at}.kind must be "web" or "news"`);
    });
  }

  const w = p.walled ?? [];
  if (!Array.isArray(w) || w.length > 20) errs.push('walled must be a list of at most 20 hosts');
  else for (const h of w) if (!isStr(h) || !/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(h)) errs.push(`walled host "${h}" must be a bare host like "example.com.sg"`);

  const n = p.notes ?? {};
  if (typeof n !== 'object' || Array.isArray(n)) errs.push('notes must be an object');
  else for (const [k, v] of Object.entries(n as Record<string, unknown>)) {
    if (!(NOTE_STEPS as readonly string[]).includes(k)) errs.push(`unknown note "notes.${k}"; the steps are ${NOTE_STEPS.join(', ')}`);
    else if (!isStr(v)) errs.push(`notes.${k} must be text`);
    else if (v.length > MAX_NOTE) errs.push(`notes.${k} is ${v.length} characters; the most is ${MAX_NOTE}`);
  }
  return errs;
}

/** problems: folder -> what is wrong; broken: a name a broken pack claims -> its folder. */
export type Loaded = { packs: Pack[]; problems: Record<string, string[]>; broken: Record<string, string> };

/** Reads every src/countries/<CC>/pack.json. Folders starting with _ (the template) are skipped. */
export function loadAll(dir = DIR): Loaded {
  const packs: Pack[] = [];
  const problems: Record<string, string[]> = {};
  const broken: Record<string, string> = {};
  let folders: string[] = [];
  try { folders = fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory() && !e.name.startsWith('_')).map((e) => e.name); } catch { /* no folder: no packs */ }
  const owner = new Map<string, string>();
  for (const folder of folders.sort()) {
    let raw: unknown;
    try { raw = JSON.parse(fs.readFileSync(path.join(dir, folder, 'pack.json'), 'utf8')); } catch (err) {
      problems[folder] = [`pack.json could not be read: ${(err as Error).message}`];
      continue;
    }
    const errs = validate(raw, folder);
    const p = raw as Pack;
    if (!errs.length) for (const name of p.names) {
      if (owner.has(name)) errs.push(`name "${name}" is already used by ${owner.get(name)}`);
    }
    if (errs.length) {
      problems[folder] = errs;
      for (const n of Array.isArray(p?.names) ? p.names : []) if (isStr(n)) broken[n.trim().toLowerCase()] = folder;
      continue;
    }
    for (const name of p.names) owner.set(name, folder);
    packs.push({ ...p, search: p.search ?? {}, discover: p.discover ?? [], walled: p.walled ?? [], notes: p.notes ?? {} });
  }
  return { packs, problems, broken };
}

let cache: Loaded | null = null;

/** What a dive should use for a country: a pack, or null, and a line for the log. Never throws. */
export function forCountry(country: string, env: NodeJS.ProcessEnv = process.env): { pack: Pack | null; note: string } {
  if ((env.COUNTRY_PACKS ?? '').toLowerCase() === 'off') return { pack: null, note: '' };
  let loaded: Loaded;
  try { loaded = cache ??= loadAll(); } catch (err) { return { pack: null, note: `Country packs could not load (${(err as Error).message}); none is used` }; }
  return pick(loaded, country, env);
}

/** forCountry's choice from packs already loaded. */
export function pick(loaded: Loaded, country: string, env: NodeJS.ProcessEnv = process.env): { pack: Pack | null; note: string } {
  if ((env.COUNTRY_PACKS ?? '').toLowerCase() === 'off') return { pack: null, note: '' };
  const key = country.trim().toLowerCase();
  const pack = loaded.packs.find((p) => p.names.includes(key));
  if (!pack) {
    const folder = loaded.broken[key];
    return { pack: null, note: folder ? `Country pack ${folder} is ignored: ${loaded.problems[folder][0]}` : '' };
  }
  if (pack.status !== 'live' && env.COUNTRY_PACKS_DRAFT !== '1') return { pack: null, note: `Country pack ${pack.code} is a draft; not used` };
  // A pack that adds nothing (Malaysia's) leaves the dive log as it always was.
  const empty = !Object.keys(pack.search).length && !pack.discover.length && !pack.walled.length
    && !Object.values(pack.notes).some((n) => n?.trim()) && pack.languages.every((l) => l === 'en');
  return { pack, note: empty ? '' : `Country pack ${pack.code} (${pack.status}) applied` };
}

/** Forget the loaded packs (tests). */
export function reset(): void { cache = null; }

/** The pack's extra Brave queries with the placeholders filled in. [] without a pack. */
export function discoverQueries(pack: Pack | null, vars: { company: string; short: string; country: string }): Array<[string, string, 'web' | 'news']> {
  if (!pack) return [];
  return pack.discover.map((q) => [q.label, q.query.replace(/\{(company|short|country)\}/g, (_, k: keyof typeof vars) => vars[k]), q.kind]);
}

/** True when the pack lists this host (or a parent of it) as unreadable. */
export function walled(pack: Pack | null, host: string): boolean {
  if (!pack || !host) return false;
  return pack.walled.some((w) => host === w || host.endsWith('.' + w));
}

/** Fixed lines for a pack whose sources are not only in English; the same for every country. */
function languageLines(pack: Pack, step: NoteStep): string {
  const local = pack.languages.filter((l) => l !== 'en').map((l) => LANGUAGES[l]);
  if (!local.length) return '';
  const langs = local.join(' and ');
  if (step === 'triage') return `Sources may be in ${langs}. If any source shows the company's name in ${langs}, put it in identity.aliases exactly as written.`;
  if (step === 'analyse') return `Sources may be in ${langs}: read them as fully as English ones. Write every fact in English; keep a name in its original script with the English after it in brackets. Plan some searches in ${langs}, using the company's ${langs} name when one is known.`;
  if (step === 'people') return `Plan some searches in ${langs} too, with the company's ${langs} name when one is known. Keep each person's name in its original script with the English after it in brackets.`;
  return `Sources may be in ${langs}. Write in English; keep a name in its original script with the English after it in brackets.`;
}

/**
 * The prompt with the pack's instructions for this step, put just before its last
 * "Answer with ONLY" line (or at the end). Without a pack, or with nothing to add,
 * the prompt comes back unchanged, character for character.
 */
export function withNotes(pack: Pack | null, step: NoteStep, prompt: string): string {
  if (!pack) return prompt;
  const text = [languageLines(pack, step), (pack.notes[step] ?? '').trim()].filter(Boolean).join('\n');
  if (!text) return prompt;
  const block = `COUNTRY NOTES (${pack.country})\n${text}\n\n`;
  const at = prompt.lastIndexOf('Answer with ONLY');
  return at < 0 ? `${prompt}\n\n${block.trimEnd()}` : prompt.slice(0, at) + block + prompt.slice(at);
}
