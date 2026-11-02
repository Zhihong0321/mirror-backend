// Public business-search and company-intelligence product surface.
//
// Both workflows are asynchronous by design. The POST returns an opaque share
// URL immediately; the same URL renders progress and later the completed report.
import crypto from 'node:crypto';
import type http from 'node:http';
import * as jobs from './jobs.ts';
import * as gateway from './gateway.ts';
import * as db from './reportdb.ts';
import * as ui from './reportui.ts';
import * as territories from './territories.ts';
import * as contacts from './contacts.ts';
import * as emailList from './email-list.ts';
import { normalizePhoneNumber } from './phone.ts';
import { importSalesAgents } from './atap-import.ts';
import { searchParallelPeople } from './parallel-contact.ts';
import * as autoContact from './autocontact.ts';
import * as contactWorker from './contact-worker.ts';
import * as autoScan from './autoscan.ts';
import { secrets } from './core/index.ts';
export { normalizePhoneNumber };

export interface Ctx {
  json: (res: http.ServerResponse, status: number, body: unknown) => void;
  readJson: (req: http.IncomingMessage) => Promise<Record<string, unknown>>;
  db?: Partial<typeof db>;
  isOperator?: boolean;
}

const active = new Set<string>();
const activeContact = new Set<string>();
let recoveringContact = false;

/** Runs this process is working on right now, so the reaper never kills one. */
export function activeReports(): string[] {
  return [...active];
}
const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback);
const num = (v: unknown, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
const object = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
const rows = (v: unknown): Record<string, unknown>[] =>
  Array.isArray(v) ? v.filter((x) => x && typeof x === 'object') as Record<string, unknown>[] : [];

/**
 * Identity resolvers are supplied only for the live discovery call. The raw
 * values never enter a report request, run artifact, ledger, or final brief.
 */
export interface PersonIdentityHints {
  email?: string;
  mobile?: string;
}

export function normalizeMobileHint(value: string): string | null {
  const raw = value.trim();
  if (!raw || !/^[+()\d.\s-]+$/.test(raw)) return null;
  const digits = raw.replace(/\D/g, '');
  // E.164 tops out at 15 digits. We also allow national-format mobile input,
  // but refuse short values that are more likely an extension or random text.
  return digits.length >= 7 && digits.length <= 15 ? digits : null;
}

function identityHintValues(hints: PersonIdentityHints): string[] {
  const values: string[] = [];
  if (hints.email) values.push(hints.email.trim().toLowerCase());
  const mobile = hints.mobile ? normalizeMobileHint(hints.mobile) : null;
  if (mobile) values.push(mobile);
  return values;
}

function containsIdentityHint(value: unknown, hints: PersonIdentityHints): boolean {
  const values = identityHintValues(hints);
  if (!values.length) return false;
  if (typeof value === 'string') {
    const lower = value.toLowerCase();
    const digits = value.replace(/\D/g, '');
    return values.some((hint) => hint.includes('@') ? lower.includes(hint) : digits.includes(hint));
  }
  if (Array.isArray(value)) return value.some((entry) => containsIdentityHint(entry, hints));
  if (value && typeof value === 'object') return Object.values(value as Record<string, unknown>).some((entry) => containsIdentityHint(entry, hints));
  return false;
}

/** Drop any model row that repeats a caller-supplied resolver before it reaches storage. */
export function redactIdentityHintsFromDiscovery(
  discovery: Record<string, unknown>,
  hints: PersonIdentityHints,
): Record<string, unknown> {
  if (!identityHintValues(hints).length) return discovery;
  const cleaned = structuredClone(discovery);
  for (const key of ['contacts', 'facts', 'signals']) {
    if (Array.isArray(cleaned[key])) cleaned[key] = rows(cleaned[key]).filter((row) => !containsIdentityHint(row, hints));
  }
  return cleaned;
}

/** A social scout may report only evidence it directly observed on its own network. */
export function keepDiscoveryEvidenceFromHosts(
  discovery: Record<string, unknown>,
  allowedHosts: string[],
): Record<string, unknown> {
  const hosts = new Set(allowedHosts.map((host) => host.toLowerCase()));
  const allowed = (row: Record<string, unknown>): boolean => {
    const evidence = directUrl(first(row, ['evidence_url', 'source_url', 'url']));
    if (!evidence) return false;
    const hostname = new URL(evidence).hostname.toLowerCase();
    return [...hosts].some((host) => hostname === host || hostname.endsWith('.' + host));
  };
  const cleaned = structuredClone(discovery);
  for (const key of ['contacts', 'facts', 'signals']) {
    if (Array.isArray(cleaned[key])) cleaned[key] = rows(cleaned[key]).filter(allowed);
  }
  return cleaned;
}

function origin(req: http.IncomingMessage): string {
  const forwarded = str(req.headers['x-forwarded-proto']);
  const proto = forwarded.split(',')[0]?.trim() || 'http';
  return proto + '://' + (req.headers.host ?? 'localhost');
}

function envelope(req: http.IncomingMessage, report: db.PublishedReport): Record<string, unknown> {
  const base = origin(req);
  const pendingOver24h = (report.status === 'queued' || report.status === 'running')
    && Date.now() - Date.parse(String(report.created_at)) >= 24 * 60 * 60_000;
  const resource = report.report_type === 'business_search'
    ? 'business-search'
    : report.report_type === 'person_research' ? 'person-research'
    : report.report_type === 'ads_research' ? 'ads-research'
    : report.report_type === 'ads_market' ? 'ads-market'
    : report.report_type === 'contact_research' ? (object(report.request).provider === 'parallel' ? 'parallel-contact-research' : 'contact-research') : 'company-research';
  return {
    id: report.public_id,
    type: report.report_type,
    status: report.status,
    pending_over_24h: pendingOver24h,
    ...(report.report_type === 'contact_research' ? { job_status: pendingOver24h ? 'pending_over_24h'
      : report.status === 'completed' ? 'completed'
      : report.status === 'failed' ? 'failed' : 'pending' } : {}),
    title: report.title,
    // Which pass this is on the same company. 1 unless the company has been
    // researched before; a caller comparing two dossiers needs to know which
    // one is newer without parsing the title.
    version: report.version,
    created_at: report.created_at,
    updated_at: report.updated_at,
    completed_at: report.completed_at,
    view_url: base + '/r/' + report.public_id,
    api_url: base + '/api/' + resource + '/' + report.public_id,
    // The company this report is about, so a caller can start ads research against
    // the same company without having to re-resolve it from the title.
    company_id: report.company_id == null ? null : String(report.company_id),
    error: report.error,
  };
}

export function extractJson(raw: string): { value: Record<string, unknown> | null; error: string | null } {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end <= start) return { value: null, error: 'model output contains no JSON object' };
  try {
    const parsed = JSON.parse(raw.slice(start, end + 1));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('root is not an object');
    return { value: parsed as Record<string, unknown>, error: null };
  } catch (err) {
    return { value: null, error: 'invalid JSON: ' + ((err as Error).message ?? String(err)) };
  }
}

/**
 * A URL a model wrapped in Markdown is still that URL.
 *
 * The prompts ask for raw https:// strings -- though until this was written only
 * Round 02 said so, and the two synthesis steps, which is where it went wrong,
 * did not. One VIP brief published 17 evidence links as
 * `[https://host/path](https://host/path)`. Those are dead links in the report
 * UI. Unwrapping here is the permissive half; validateFinal / validatePersonFinal
 * are the strict half, and they now see through the same wrapper.
 */
export function unwrapUrl(value: string): string {
  const text = value.trim();
  const linked = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(text);
  if (linked) return linked[2]!.trim();
  const bracketed = /^\[([^\]]+)\]$/.exec(text);
  if (bracketed) return bracketed[1]!.trim();
  return text;
}

/**
 * Formatting normalises. Integrity rejects. Never the same code path.
 *
 * A Markdown-wrapped URL is a formatting defect: `unwrapUrl` repairs it
 * losslessly, so it must never be fatal. Making it fatal cost person report
 * `LSSBGcICBys3tdJgVCSG` a good summary over a bracket -- a cosmetic defect
 * traded for a substantive one, since the report went `partial` and the link was
 * no better for it. The wrappers are third-party models and their output shape
 * is not ours to control, so the consumer repairs what is repairable and rejects
 * only what is not: an invented URL, a dropped person, a changed ID set.
 *
 * Only a string that is *entirely* a Markdown link and unwraps to a parseable
 * https URL is rewritten. Prose that merely contains a link, and a plain
 * `[label]` that is not a URL, are left exactly as the model wrote them.
 */
export function normaliseUrls<T>(value: T): T {
  if (typeof value === 'string') {
    const candidate = unwrapUrl(value);
    if (candidate === value.trim() || !/^https?:\/\//.test(candidate)) return value;
    try { new URL(candidate); } catch { return value; }
    return candidate as unknown as T;
  }
  if (Array.isArray(value)) return value.map((entry) => normaliseUrls(entry)) as unknown as T;
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => [key, normaliseUrls(entry)]),
    ) as unknown as T;
  }
  return value;
}

/**
 * How strong the evidence behind a row is. Never a reason to delete the row.
 *
 * This used to be a gate. `directUrl` returned null for anything that was not
 * https with a path, and every collector did `if (!evidence) continue`, so the
 * row vanished with no log, no gap entry and no count. On one measured run that
 * silently binned 14 of 37 researched rows -- 38% -- including four sourced from
 * the company's own website, plus SEDA, MyHIJAU, CTOS, JobStreet and China Press.
 * Round 01's prompt names those exact registries and spends a four-minute model
 * call collecting them; the gate then deleted the results.
 *
 * The concern behind it was real: a model that writes "source: seda.gov.my" may
 * have named an organisation rather than opened a page. But deleting fails
 * SILENTLY, and that is the whole problem -- a report missing 38% of its findings
 * looks complete, while a weak citation looks like a bug. So the code optimised
 * for never looking wrong instead of for being useful, and it did that invisibly,
 * on every run, to the person paying for the research.
 *
 * The https-only half had no argument at all. Nothing here is executed; a URL is
 * written to a JSON field. It cost 6 of 15 real company websites, because
 * Malaysian SME sites are routinely http.
 *
 * So: classify, never discard. The reader decides what to trust, which is the
 * only sound place for that decision to live. `candidate_people` has always
 * worked this way -- keep the row, stamp it needs_direct_role_evidence. This is
 * that same idiom, applied to every kind of row.
 */
export type EvidenceStrength =
  | 'direct_page'      // https, and a real path: the strongest thing we get
  | 'domain_only'      // https homepage -- names a source without pinning the page
  | 'insecure_page'    // http with a path
  | 'insecure_domain'  // http homepage
  | 'search_result'    // a search-engine URL: proves a query ran, not a fact
  | 'unsourced';       // the round gave no URL at all

/** Ranked worst-to-best, for sorting and for "how much of this report is solid". */
export const EVIDENCE_ORDER: EvidenceStrength[] =
  ['unsourced', 'search_result', 'insecure_domain', 'domain_only', 'insecure_page', 'direct_page'];

export function classifyEvidence(value: unknown): { url: string | null; strength: EvidenceStrength } {
  if (typeof value !== 'string' || !value.trim()) return { url: null, strength: 'unsourced' };
  let url: URL;
  try {
    url = new URL(unwrapUrl(value));
  } catch {
    // Not parseable as a URL at all. Keep whatever the round said -- it may be a
    // publication name a human can follow -- but call it what it is.
    return { url: null, strength: 'unsourced' };
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return { url: null, strength: 'unsourced' };
  const bare = url.pathname === '/' || !url.pathname;
  const insecure = url.protocol !== 'https:';
  if (/google\.[^/]+\/search|bing\.com\/search|duckduckgo\.com/i.test(url.href)) {
    return { url: url.href, strength: 'search_result' };
  }
  if (/google\.com\/maps/i.test(url.href)) return { url: url.href, strength: 'direct_page' };
  if (bare) return { url: url.href, strength: insecure ? 'insecure_domain' : 'domain_only' };
  return { url: url.href, strength: insecure ? 'insecure_page' : 'direct_page' };
}

/**
 * The strict form, for the few places that genuinely need a usable link rather
 * than a classification -- a Messenger link we are about to publish as a contact
 * route, say. Everything that builds ledger rows uses classifyEvidence instead.
 */
function directUrl(value: unknown): string | null {
  const { url, strength } = classifyEvidence(value);
  return url && strength !== 'unsourced' && strength !== 'search_result' ? url : null;
}

function id(prefix: string, parts: unknown[]): string {
  return prefix + '_' + crypto.createHash('sha256').update(parts.map((v) => String(v ?? '')).join('|')).digest('hex').slice(0, 12);
}

function first(row: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) if (typeof row[key] === 'string' && str(row[key]).trim()) return str(row[key]).trim();
  return '';
}

function collectContacts(sources: Record<string, unknown>[]): Record<string, unknown>[] {
  const found = new Map<string, Record<string, unknown>>();
  for (const source of sources) {
    for (const row of rows(source.contacts)) {
      const cited = classifyEvidence(first(row, ['evidence_url', 'source_url', 'url']));
      const raw = first(row, ['value_as_published', 'value', 'raw_value', 'contact']);
      // The contact value is the row. Weak evidence downgrades it; it never deletes it.
      if (!raw) continue;
      const normalized = first(row, ['normalized_value', 'normalized']) || raw;
      const purpose = first(row, ['purpose', 'channel', 'type']) || 'Business contact';
      const key = normalized.toLowerCase() + '|' + purpose.toLowerCase();
      if (!found.has(key)) found.set(key, {
        id: id('contact', [normalized, purpose]), purpose, value_as_published: raw,
        normalized_value: normalized,
        current_status: first(row, ['current_status', 'status']) || 'published',
        evidence_class: first(row, ['evidence_class', 'source_type']) || 'unclassified',
        evidence_url: cited.url,
        evidence_strength: cited.strength,
        evidence_as_cited: cited.url ? null : first(row, ['evidence_url', 'source_url', 'url']) || null,
        source_date: row.source_date ?? row.visible_source_date ?? null,
        introduced_by: first(row, ['introduced_by', '_round']) || null,
      });
    }
  }
  return keepBestContacts([...found.values()]);
}

/**
 * Which contacts survive the cap.
 *
 * The cap itself is fine -- a reader cannot use eighty phone numbers. What was
 * wrong was the tiebreak: `.slice(0, 24)` keeps whoever arrived first, and
 * arrival order is round order, not evidence order. The Eternalgy report filled
 * all 24 slots with Round 01's five branch addresses and every social profile it
 * could name, so every row Round 03 had actually *crawled* -- the Page phone,
 * the Page email and all three Messenger links, one of them the route to a named
 * person -- fell off the end and never reached the report.
 *
 * So rank before cutting. A row a crawler read off the live page outranks one a
 * wrapper recalled, and better-sourced outranks worse. Survivors are emitted in
 * their original order, so a report under the cap is byte-for-byte what it was.
 */
const CONTACT_CAP = 24;

function keepBestContacts(contacts: Record<string, unknown>[]): Record<string, unknown>[] {
  if (contacts.length <= CONTACT_CAP) return contacts;
  const arrival = new Map(contacts.map((row, index) => [row, index]));
  // Round 03 crawled a live page; nothing it read is displaced by a recollection.
  const crawled = (row: Record<string, unknown>): number => (str(row.introduced_by) === 'round03' ? 0 : 1);
  // Everything else takes turns. Straight priority would only move the starvation
  // -- Round 01 files the most rows, so it would eat Round 02 whole. Each round's
  // first row is kept before any round's second, so a round that found three
  // numbers keeps them even next to a round that found twenty addresses.
  const turn = new Map<Record<string, unknown>, number>();
  const taken = new Map<string, number>();
  for (const row of contacts) {
    const round = str(row.introduced_by) || 'unattributed';
    const n = taken.get(round) ?? 0;
    turn.set(row, n);
    taken.set(round, n + 1);
  }
  const sourced = (row: Record<string, unknown>): number => EVIDENCE_ORDER.indexOf(str(row.evidence_strength) as EvidenceStrength);
  const survivors = new Set([...contacts]
    .sort((a, b) => crawled(a) - crawled(b)
      || turn.get(a)! - turn.get(b)!
      || sourced(b) - sourced(a)
      || arrival.get(a)! - arrival.get(b)!)
    .slice(0, CONTACT_CAP));
  return contacts.filter((row) => survivors.has(row));
}

/**
 * Seniority, for choosing P01.
 *
 * `people[0]` is the person the pipeline sends to VIP research, so the order of
 * this list is a decision, not a presentation detail. It used to be insertion
 * order -- whoever Round 01 happened to mention first -- which was right on the
 * Eternalgy report only by luck.
 *
 * Matched longest-title-first so "chief executive" is not scored by the "chief"
 * of a lesser title, and against a spaced, punctuation-free string so
 * "CEO & Founder; Director" and "CEO / Founder" reduce to the same thing.
 */
const SENIORITY: Array<[RegExp, number]> = [
  [/\bchief executive|\bceo\b|\bmanaging director|\bgroup managing/, 100],
  [/\bfounder|\bco founder|\bproprietor|\bowner\b/, 95],
  [/\bchairman|\bchairperson|\bpresident\b/, 90],
  [/\bchief \w+ officer|\bcto\b|\bcfo\b|\bcoo\b|\bcmo\b/, 85],
  [/\bdirector\b|\bpartner\b/, 75],
  [/\bgeneral manager|\bhead of\b|\bvice president|\bvp\b/, 65],
  [/\bmanager\b|\blead\b|\bprincipal\b/, 45],
  [/\bengineer\b|\bofficer\b|\bexecutive\b|\bdesigner\b/, 25],
];

export function seniorityScore(role: string): number {
  const flat = ' ' + role.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim() + ' ';
  for (const [pattern, score] of SENIORITY) if (pattern.test(flat)) return score;
  return 10;
}

/** A person is one human, however many ways the rounds spelled their title. */
function personKey(name: string): string {
  const folded = name.toLowerCase().normalize('NFKD').replace(/\s+/g, ' ').trim();
  const letters = folded.replace(/[^\p{L}\p{N}\s]/gu, '').replace(/\s+/g, ' ').trim();
  return letters || folded;
}

/**
 * One row per human, ranked by seniority.
 *
 * Keyed on name alone. The old key was name+role, so the Eternalgy report
 * carried "Gan Lai Soon" three times -- as "CEO & Founder; Director", as
 * "CEO & Founder / Director" and as "Director" -- three rows, one person, and a
 * P01 choice that was really a choice of transcription. When the same person
 * arrives twice, the more senior title and the better-classified evidence win,
 * and the alternate titles are kept so nothing sourced is thrown away.
 */
function collectPeople(sources: Record<string, unknown>[]): Record<string, unknown>[] {
  const found = new Map<string, Record<string, unknown>>();
  for (const source of sources) {
    for (const row of rows(source.people)) {
      const cited = classifyEvidence(first(row, ['role_evidence_url', 'evidence_url', 'role_url', 'source_url']));
      const name = first(row, ['name']);
      const role = first(row, ['current_role', 'role', 'position']);
      // A named person with a stated role is the row. How well it is sourced is
      // a property of the row, not a condition of its existence.
      if (!name || !role) continue;
      const key = personKey(name);
      const existing = found.get(key);
      if (!existing) {
        found.set(key, {
          id: id('person', [name, role]), name, role,
          relevance: first(row, ['relevance', 'why_relevant', 'outreach_relevance']),
          evidence_class: first(row, ['evidence_class', 'source_type']) || 'unclassified',
          role_url: cited.url,
          evidence_strength: cited.strength,
          evidence_as_cited: cited.url ? null : first(row, ['role_evidence_url', 'evidence_url', 'role_url', 'source_url']) || null,
          personal_profile_url: classifyEvidence(row.personal_profile_url).url,
          source_date: row.source_date ?? row.visible_source_date ?? null,
          introduced_by: first(row, ['introduced_by', '_round']) || null,
          also_described_as: [] as string[],
          seniority: seniorityScore(role),
        });
        continue;
      }
      // A profile URL found on the second sighting is still a profile URL.
      if (!existing.personal_profile_url) existing.personal_profile_url = classifyEvidence(row.personal_profile_url).url;
      const alts = existing.also_described_as as string[];
      const promote = seniorityScore(role) > num(existing.seniority, 0);
      // Whichever title loses goes to `also_described_as` -- including the one
      // being displaced, which is the half that is easy to drop on the floor.
      const demoted = promote ? String(existing.role) : role;
      if (promote) {
        existing.role = role;
        existing.seniority = seniorityScore(role);
        existing.role_url = cited.url;
        existing.evidence_strength = cited.strength;
        existing.evidence_class = first(row, ['evidence_class', 'source_type']) || existing.evidence_class;
      }
      const seen = new Set([String(existing.role).toLowerCase(), ...alts.map((r) => r.toLowerCase())]);
      if (!seen.has(demoted.toLowerCase())) alts.push(demoted);
    }
  }
  return [...found.values()]
    .sort((a, b) => num(b.seniority, 0) - num(a.seniority, 0))
    .slice(0, 16);
}

/**
 * Recall is useful before verification.  V1 surfaced registry contacts and
 * LinkedIn employees even when it could not attach a role page; silently
 * discarding them made a thin report look like a thin company.  These rows are
 * deliberately separate from `people`: they never qualify as verified people,
 * cannot trigger VIP research, and the UI labels them as leads to verify.
 */
function collectCandidatePeople(sources: Record<string, unknown>[]): Record<string, unknown>[] {
  const found = new Map<string, Record<string, unknown>>();
  for (const source of sources) {
    for (const row of rows(source.candidate_people)) {
      const name = first(row, ['name']);
      const role = first(row, ['current_role', 'role', 'position']) || 'Role not independently confirmed';
      const sourceName = first(row, ['source_name', 'source', 'evidence_note']);
      const sourceUrl = directUrl(first(row, ['source_url', 'role_evidence_url', 'evidence_url', 'role_url']));
      // A candidate must still say where it came from.  A URL is preferred, but
      // V1's useful registry and employee leads frequently had only a named source.
      if (!name || (!sourceName && !sourceUrl)) continue;
      const key = name.toLowerCase() + '|' + role.toLowerCase();
      if (!found.has(key)) found.set(key, {
        id: id('candidate_person', [name, role, sourceName || sourceUrl]), name, role,
        source_name: sourceName || new URL(sourceUrl!).hostname,
        source_url: sourceUrl,
        relevance: first(row, ['relevance', 'why_relevant', 'outreach_relevance']),
        verification_status: 'needs_direct_role_evidence',
        verification_note: first(row, ['verification_note', 'reason']) || 'Candidate from a named public source; current role needs direct verification.',
        introduced_by: first(row, ['introduced_by', '_round']) || null,
      });
    }
  }
  return [...found.values()].slice(0, 24);
}

function collectSignals(sources: Record<string, unknown>[]): Record<string, unknown>[] {
  const found = new Map<string, Record<string, unknown>>();
  for (const source of sources) {
    for (const row of rows(source.signals ?? source.business_signals ?? source.independent_signals)) {
      const cited = classifyEvidence(first(row, ['evidence_url', 'source_url', 'url']));
      const fact = first(row, ['fact', 'signal', 'description']);
      if (!fact) continue;
      const key = fact.toLowerCase().slice(0, 180) + '|' + (cited.url ?? 'unsourced');
      if (!found.has(key)) found.set(key, {
        id: id('signal', [fact, cited.url ?? 'unsourced']), date: row.date ?? row.visible_source_date ?? null,
        fact, evidence_class: first(row, ['evidence_class', 'source_type', 'source_class']) || 'unclassified',
        evidence_url: cited.url,
        evidence_strength: cited.strength,
        evidence_as_cited: cited.url ? null : first(row, ['evidence_url', 'source_url', 'url']) || null,
        outreach_use: first(row, ['outreach_use', 'relevance']),
        introduced_by: first(row, ['introduced_by', '_round']) || null,
      });
    }
  }
  return [...found.values()].slice(0, 14);
}

export function buildLedger(
  company: Record<string, unknown>,
  parsed: Record<string, unknown>[],
): Record<string, unknown> {
  const mapsUrl = directUrl(company.maps_url);
  const baseline: Record<string, unknown> = { contacts: [], people: [], signals: [] };
  if (company.phone && mapsUrl) {
    baseline.contacts = [{
      purpose: 'Google Maps phone', value: company.phone, normalized: company.phone,
      current_status: 'maps_listing', source_type: 'google_maps', source_url: mapsUrl, _round: 'gmap',
    }];
  }
  const all = [baseline, ...parsed];
  const contacts = collectContacts(all);
  const people = collectPeople(all);
  const candidatePeople = collectCandidatePeople(all);
  const signals = collectSignals(all);
  const conflicts = parsed.flatMap((p) => rows(p.conflicts ?? p.conflicts_and_unknowns)).slice(0, 12);
  return {
    entity: {
      company_id: String(company.id ?? ''), name: company.name, category: company.category,
      address: company.address, phone: company.phone, website: company.website,
      maps_url: company.maps_url, rating: company.rating, reviews: company.reviews,
    },
    contacts, people, candidate_people: candidatePeople, signals, conflicts_and_unknowns: conflicts,
    validation: {
      policy: 'Every row the research returned is retained and carries an evidence_strength; nothing is discarded for weak sourcing. direct_page is an https page that supports the field; domain_only names a source without pinning the page; insecure_* is the same over http; search_result proves a query ran, not a fact; unsourced means the round cited nothing. Candidate people are named by a public source but lack direct role evidence. Final synthesis may not add rows.',
      contact_count: contacts.length, people_count: people.length, candidate_people_count: candidatePeople.length, signal_count: signals.length,
      evidence_breakdown: evidenceBreakdown(contacts, people, signals),
    },
  };
}

/**
 * How the retained rows break down by evidence strength.
 *
 * This exists because the old behaviour was dishonest in a specific way: rows
 * were deleted for weak evidence, and the report then presented itself as
 * complete. Nothing counted what had gone. Now nothing is deleted, so the report
 * owes the reader a straight account of what it is made of.
 */
export function evidenceBreakdown(...groups: Record<string, unknown>[][]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const strength of EVIDENCE_ORDER) out[strength] = 0;
  for (const group of groups) {
    for (const row of group) {
      const key = String(row.evidence_strength ?? 'unsourced');
      out[key] = (out[key] ?? 0) + 1;
    }
  }
  for (const key of Object.keys(out)) if (!out[key]) delete out[key];
  return out;
}

function sameSet(a: unknown[], b: unknown[]): boolean {
  const left = [...new Set(a.map(String))].sort();
  const right = [...new Set(b.map(String))].sort();
  return left.length === right.length && left.every((v, i) => v === right[i]);
}

export function validateFinal(final: Record<string, unknown>, ledger: Record<string, unknown>): string[] {
  const errors: string[] = [];
  const finalContacts = rows(final.contacts);
  const finalPeople = rows(final.people);
  const finalCandidates = rows(final.candidate_people);
  const ledgerContacts = rows(ledger.contacts);
  const ledgerPeople = rows(ledger.people);
  const ledgerCandidates = rows(ledger.candidate_people);
  if (!sameSet(finalContacts.map((r) => r.id), ledgerContacts.map((r) => r.id))) errors.push('contact id set changed');
  if (!sameSet(finalPeople.map((r) => r.id), ledgerPeople.map((r) => r.id))) errors.push('people id set changed');
  if (!sameSet(finalCandidates.map((r) => r.id), ledgerCandidates.map((r) => r.id))) errors.push('candidate people id set changed');
  const allowedUrls = new Set<string>();
  const collectAllowed = (value: unknown): void => {
    if (typeof value === 'string' && /^https?:\/\//.test(unwrapUrl(value))) {
      try { allowedUrls.add(new URL(unwrapUrl(value)).href); } catch { /* malformed URLs are caught by the ledger filter */ }
    } else if (Array.isArray(value)) value.forEach(collectAllowed);
    else if (value && typeof value === 'object') Object.values(value as Record<string, unknown>).forEach(collectAllowed);
  };
  collectAllowed(ledger);
  const visit = (value: unknown): void => {
    if (typeof value === 'string') {
      // Unwrap first: a Markdown-wrapped URL does not start with "https://" and
      // used to slip through this check entirely. Wrapping itself is not an
      // error here -- `normaliseUrls` has already repaired it, and the URL a
      // model wrapped is still the URL it cited.
      const candidate = unwrapUrl(value);
      if (/^https?:\/\//.test(candidate)) {
        let href: string | null = null;
        try { href = new URL(candidate).href; } catch { href = null; }
        if (!href) errors.push('malformed URL: ' + value);
        else if (!allowedUrls.has(href)) errors.push('new URL: ' + value);
      }
      return;
    }
    if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === 'object') Object.values(value as Record<string, unknown>).forEach(visit);
  };
  visit(final);
  return [...new Set(errors)];
}

/**
 * How a finished research run is published.
 *
 * `produced` counts the rounds that came back with usable output, and it is the
 * whole point of this function. Every round failure is caught where it happens
 * so one dead engine cannot abandon the work the others did — but nothing used
 * to ask whether ANY round had run, so a run in which all six calls were refused
 * published as `partial`: a green "Complete · noted gaps" over four empty
 * sections, indistinguishable from a company the research genuinely found
 * nothing on. Nothing ran is not a gap. It is a failure, and it says so.
 *
 * Reasons are deduplicated because they repeat by engine, not by round: one
 * offline worker turning away six calls is one fact, not six.
 */
export function publishOutcome(produced: number, failures: string[]): {
  status: 'completed' | 'partial' | 'failed';
  error: string | null;
} {
  const reasons = [...new Set(failures.filter(Boolean))];
  if (!produced) {
    return {
      status: 'failed',
      error: 'No research round produced any output, so this report has no findings. '
        + (reasons.join(' ') || 'Every round failed without reporting a reason.'),
    };
  }
  if (reasons.length) {
    return {
      status: 'partial',
      error: 'Report completed with one or more round, validation, or Chinese-translation gaps; only validated fields are published.',
    };
  }
  return { status: 'completed', error: null };
}

/**
 * The translation is a presentation copy, never a new research pass. These
 * values identify the evidence rows and/or lead a user to a source, so changing
 * one would turn a harmless language operation into data corruption.
 */
export function validateChineseTranslation(
  translated: Record<string, unknown>,
  canonical: Record<string, unknown>,
): string[] {
  const errors: string[] = [];
  for (const collection of ['contacts', 'people', 'candidate_people', 'signals', 'conflicts_and_unknowns']) {
    if (rows(translated[collection]).length !== rows(canonical[collection]).length) errors.push(collection + ' row count changed');
  }
  if (!sameSet(rows(translated.contacts).map((row) => row.id), rows(canonical.contacts).map((row) => row.id))) errors.push('contact id set changed');
  if (!sameSet(rows(translated.people).map((row) => row.id), rows(canonical.people).map((row) => row.id))) errors.push('people id set changed');
  if (!sameSet(rows(translated.candidate_people).map((row) => row.id), rows(canonical.candidate_people).map((row) => row.id))) errors.push('candidate people id set changed');
  if (!sameSet(rows(translated.signals).map((row) => row.id), rows(canonical.signals).map((row) => row.id))) errors.push('signal id set changed');

  const compareInvariant = (original: unknown, candidate: unknown, path = ''): void => {
    if (Array.isArray(original)) {
      if (!Array.isArray(candidate) || original.length !== candidate.length) {
        errors.push('structure changed at ' + path);
        return;
      }
      original.forEach((value, index) => compareInvariant(value, candidate[index], `${path}[${index}]`));
      return;
    }
    if (!original || typeof original !== 'object') {
      if (typeof original !== typeof candidate) errors.push('value type changed at ' + path);
      return;
    }
    if (Array.isArray(candidate) || !candidate || typeof candidate !== 'object') {
      errors.push('structure changed at ' + path);
      return;
    }
    const originalKeys = Object.keys(original as Record<string, unknown>).sort();
    const candidateKeys = Object.keys(candidate as Record<string, unknown>).sort();
    if (!sameSet(originalKeys, candidateKeys)) errors.push('object keys changed at ' + path);
    for (const [key, value] of Object.entries(original as Record<string, unknown>)) {
      const translatedValue = (candidate as Record<string, unknown>)[key];
      const isInvariant = translationInvariantKey(key);
      if (isInvariant && JSON.stringify(value) !== JSON.stringify(translatedValue)) errors.push('canonical value changed at ' + (path ? path + '.' : '') + key);
      else compareInvariant(value, translatedValue, path ? path + '.' + key : key);
    }
  };
  compareInvariant(canonical, translated);
  return [...new Set(errors)];
}

function translationInvariantKey(key: string): boolean {
  return key === 'id' || key.endsWith('_id') || key.endsWith('_url') ||
    key === 'normalized_value' || key === 'value_as_published' || key === 'phone' ||
    key === 'website' || key === 'maps_url' || key === 'name' || key === 'company_name' ||
    key === 'person_name' || key === 'address' || key === 'date' || key === 'source_date' ||
    key === 'introduced_by' || key === 'synthesis_mode';
}

function collectPersonFacts(sources: Record<string, unknown>[]): Record<string, unknown>[] {
  const found = new Map<string, Record<string, unknown>>();
  for (const source of sources) {
    for (const row of rows(source.facts)) {
      const cited = classifyEvidence(first(row, ['evidence_url', 'source_url', 'url']));
      const category = first(row, ['category', 'type']) || 'Professional fact';
      const fact = first(row, ['fact', 'value', 'description']);
      if (!fact) continue;
      const key = category.toLowerCase() + '|' + fact.toLowerCase().slice(0, 220) + '|' + (cited.url ?? 'unsourced');
      if (!found.has(key)) found.set(key, {
        id: id('fact', [category, fact, cited.url ?? 'unsourced']), category, fact,
        evidence_class: first(row, ['evidence_class', 'source_type', 'source_class']) || 'unclassified',
        evidence_url: cited.url,
        evidence_strength: cited.strength,
        evidence_as_cited: cited.url ? null : first(row, ['evidence_url', 'source_url', 'url']) || null,
        source_date: row.source_date ?? row.visible_source_date ?? null,
        // This may say that an individual resolver matched, but never contains
        // the resolver value itself. It makes a historical affiliation auditable
        // without exposing an email address or mobile number.
        identity_match_basis: first(row, ['identity_match_basis', 'identity_match_note']) || null,
        introduced_by: first(row, ['introduced_by', '_round']) || null,
      });
    }
  }
  return [...found.values()].slice(0, 16);
}

export function buildPersonLedger(
  company: Record<string, unknown>,
  person: Record<string, unknown>,
  parsed: Record<string, unknown>[],
): Record<string, unknown> {
  const roleUrl = directUrl(first(person, ['role_url', 'role_evidence_url', 'evidence_url']));
  const name = first(person, ['name']);
  const role = first(person, ['role', 'current_role', 'position']);
  const baseline: Record<string, unknown> = {
    facts: roleUrl && name && role ? [{
      category: 'Current role', fact: `${name} is listed as ${role} at ${str(company.name, 'the company')}.`,
      evidence_class: first(person, ['evidence_class']) || 'first_party', evidence_url: roleUrl, _round: 'company_research',
      identity_match_basis: 'direct_current_role_evidence',
    }] : [],
    contacts: [], signals: [],
  };
  const all = [baseline, ...parsed];
  return {
    person: {
      id: first(person, ['id']), name, current_role: role,
      company_name: str(company.name), company_id: String(company.id ?? ''),
      role_evidence_url: roleUrl,
      personal_profile_url: directUrl(person.personal_profile_url) ?? null,
    },
    contacts: collectContacts(all),
    facts: collectPersonFacts(all),
    signals: collectSignals(all),
    validation: {
      policy: 'Public professional evidence only. An exact individual email or normalized mobile match may validate a sourced historical affiliation, but the matching value is never retained or published. Private or sensitive personal data and uncited social claims are excluded. Retained entries carry evidence_strength so the reader can judge sourcing.',
      contact_count: collectContacts(all).length,
      fact_count: collectPersonFacts(all).length,
      signal_count: collectSignals(all).length,
      evidence_breakdown: evidenceBreakdown(collectContacts(all), collectPersonFacts(all), collectSignals(all)),
    },
  };
}

export function validatePersonFinal(final: Record<string, unknown>, ledger: Record<string, unknown>): string[] {
  const errors: string[] = [];
  if (!sameSet(rows(final.contacts).map((row) => row.id), rows(ledger.contacts).map((row) => row.id))) errors.push('contact id set changed');
  if (!sameSet(rows(final.facts).map((row) => row.id), rows(ledger.facts).map((row) => row.id))) errors.push('fact id set changed');
  if (!sameSet(rows(final.signals).map((row) => row.id), rows(ledger.signals).map((row) => row.id))) errors.push('signal id set changed');
  const allowedUrls = new Set<string>();
  const collectAllowed = (value: unknown): void => {
    if (typeof value === 'string' && /^https?:\/\//.test(unwrapUrl(value))) {
      try { allowedUrls.add(new URL(unwrapUrl(value)).href); } catch { /* validation below keeps malformed URLs out */ }
    } else if (Array.isArray(value)) value.forEach(collectAllowed);
    else if (value && typeof value === 'object') Object.values(value as Record<string, unknown>).forEach(collectAllowed);
  };
  collectAllowed(ledger);
  const visit = (value: unknown): void => {
    if (typeof value === 'string') {
      // Unwrap first: a Markdown-wrapped URL does not start with "https://" and
      // used to slip through this check entirely. Wrapping itself is not an
      // error here -- `normaliseUrls` has already repaired it, and the URL a
      // model wrapped is still the URL it cited.
      const candidate = unwrapUrl(value);
      if (/^https?:\/\//.test(candidate)) {
        let href: string | null = null;
        try { href = new URL(candidate).href; } catch { href = null; }
        if (!href) errors.push('malformed URL: ' + value);
        else if (!allowedUrls.has(href)) errors.push('new URL: ' + value);
      }
      return;
    }
    if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === 'object') Object.values(value as Record<string, unknown>).forEach(visit);
  };
  visit(final);
  return [...new Set(errors)];
}

/** P01 is the first person retained by the same evidence ledger used by the report UI. */
export function highestRankedPerson(
  company: Record<string, unknown>,
  parsed: Record<string, unknown>[],
): Record<string, unknown> | null {
  return rows(buildLedger(company, parsed).people)[0] ?? null;
}

function companyBaseline(company: Record<string, unknown>): string {
  return JSON.stringify({
    id: String(company.id ?? ''), name: company.name, category: company.category,
    address: company.address, phone: company.phone, website: company.website,
    maps_url: company.maps_url, rating: company.rating, reviews: company.reviews,
  });
}

/**
 * How a research round finds and reads pages.
 *
 * The Pi worker has exactly two tools, web_search (Tavily) and web_fetch (a plain
 * GET reduced to text), and no shell. Naming them keeps a round from spending its
 * budget asking for a tool it does not have.
 */
const FETCH_POLICY = 'Find pages with the web_search tool and read each page with the web_fetch tool '
  + 'before you cite it. Cite only URLs you actually fetched or that web_search returned. You have no '
  + 'shell, terminal or file tools.';

/**
 * Company and person rounds still land inside four minutes. Contact research does
 * not: a large company can take up to twenty, and that path asks with a twenty
 * minute budget. This budget is only for the shorter rounds.
 *
 * A model that knows the deadline can land before it. This does not lower any
 * cap -- a round that finishes early still returns everything it found.
 */
const TIME_BUDGET = 'HARD TIME BUDGET: you have about four minutes of wall clock. The run is '
  + 'stopped at seven and everything you have done is then lost, so treat four minutes '
  + 'as a deadline, not a target. Track it. When you reach it, stop researching immediately and emit the '
  + 'JSON with what you already have, even if sections are thin or empty -- a short answer is a result '
  + 'and a missed deadline is not. Do not narrate the deadline; just meet it.';

const CONTACT_TIME_BUDGET = 'HARD TIME BUDGET: you have about eighteen minutes of wall clock. The run is '
  + 'killed at twenty minutes and anything not yet printed is lost, so treat eighteen minutes as a deadline, '
  + 'not a target. Keep researching until you have the decision-makers, dialable numbers, and emails the '
  + 'sources actually show, or until you are close to that deadline. Then stop and emit the JSON with what '
  + 'you have, even if some sections are thin. A finished JSON object is a result; a killed run is not. '
  + 'Do not narrate the deadline; just meet it.';

export function contactResearchPrompt(company: Record<string, unknown>, targetRole?: string | null): string {
  const roleHint = targetRole
    ? `Target persona / role focus: ${targetRole}. Prioritize finding this role or equivalent decision-makers.`
    : 'Target key decision-makers: Owner, Founder, CEO, Managing Director, General Manager, Head of Procurement/Purchasing, Head of Sales/Marketing, Operations Director.';
  return `You are a high-speed B2B telemarketing contact research specialist researching as of ${new Date().toISOString().slice(0, 10)}.
TARGET COMPANY: ${companyBaseline(company)}
${roleHint}
${FETCH_POLICY}
${CONTACT_TIME_BUDGET}

OBJECTIVE:
Find actionable telemarketing contact details and key decision-makers to call.
Strictly focus on:
1. Decision makers / Leaders: Full Name, Current Role/Title, Seniority Rank (1-100), direct personal phone/mobile (if found), direct email (if found), direct LinkedIn or profile URL, direct role evidence URL.
2. Dialable Phone Numbers:
   - Mobile / WhatsApp numbers: (E.164 + local format, state if WhatsApp is supported).
   - Direct desk lines or department lines (e.g. Sales, Procurement, General Manager's office).
   - Switchboard / General office phone (Google Maps phone or main reception).
3. Email Addresses:
   - Direct personal work emails (e.g. name@company.com).
   - General inquiries or department emails (e.g. sales@, procurement@, info@).
4. Telemarketing Cheat Sheet:
   - Primary decision maker to ask for when calling (Name & Role).
   - Best dialable number (mobile/WhatsApp preferred, then direct desk, then switchboard).
   - Gatekeeper phrase (concise, polite English sentence for the telemarketer when speaking to the receptionist or gatekeeper, asking directly for the decision maker by name and title).

RULES:
- Return raw literal URLs in evidence_url, role_evidence_url, profile_url.
- Do NOT guess or hallucinate phone numbers or emails. Only report numbers and emails that exist in public sources (official site, contact page, team page, job portals, social pages, directories, registries).
- Prioritize Malaysian mobile prefixes (010, 011, 012, 013, 014, 016, 017, 018, 019) as mobile_whatsapp when in Malaysia.
- Normalise phone numbers into E.164 (e.g. +60183999247) when clear.

Return exactly ONE compact JSON object in a single fenced code block with keys:
{
  "cheat_sheet": {
    "primary_decision_maker": "Name (Title)",
    "primary_phone": "+60...",
    "primary_channel": "WhatsApp / Mobile" | "Direct Desk" | "Switchboard Line",
    "gatekeeper_phrase": "Hello, may I speak with..."
  },
  "decision_makers": [
    {
      "name": "Full Name",
      "role": "Current Title",
      "seniority": 100,
      "direct_phone": "+60...",
      "direct_email": "name@...",
      "profile_url": "https://linkedin.com/in/...",
      "role_evidence_url": "https://..."
    }
  ],
  "phone_contacts": [
    {
      "type": "mobile_whatsapp" | "direct_desk" | "switchboard",
      "number_raw": "018-399 9247",
      "number_e164": "+60183999247",
      "whatsapp_url": "https://wa.me/60183999247",
      "label": "Direct Mobile / WhatsApp" | "Head Office" | "Sales Desk",
      "evidence_url": "https://..."
    }
  ],
  "email_contacts": [
    {
      "type": "direct" | "general",
      "email": "name@company.com",
      "label": "Personal Work Email" | "General Inquiries",
      "evidence_url": "https://..."
    }
  ]
}

Max 8 decision_makers, 10 phone_contacts, 6 email_contacts. No prose outside JSON.`;
}

/** Shorter contact prompt kept for an old cloud job slot. New jobs do not use it. */
export function cloudContactResearchPrompt(company: Record<string, unknown>, targetRole?: string | null): string {
  return contactResearchPrompt(company, targetRole).replace(
    CONTACT_TIME_BUDGET,
    'HARD TIME BUDGET: research for at most two minutes. Stop browsing and return the required JSON immediately with the publicly sourced details found so far. Empty arrays are valid when a detail cannot be verified.',
  );
}

export function buildContactLedger(
  company: Record<string, unknown>,
  discovery: Record<string, unknown> | null,
  fbData?: Record<string, unknown> | null,
): Record<string, unknown> {
  const entity = {
    company_id: String(company.id ?? ''),
    name: str(company.name),
    category: company.category ?? null,
    address: company.address ?? null,
    phone: company.phone ?? null,
    website: company.website ?? null,
    maps_url: company.maps_url ?? null,
    rating: company.rating ?? null,
    reviews: company.reviews ?? null,
  };

  const rawPhones: Array<{ raw: string; type?: string; label?: string; evidence_url?: string | null }> = [];
  
  if (company.phone) {
    rawPhones.push({
      raw: str(company.phone),
      type: 'switchboard',
      label: 'Google Maps Phone',
      evidence_url: directUrl(company.maps_url) ?? null,
    });
  }

  if (fbData && fbData.phone) {
    rawPhones.push({
      raw: str(fbData.phone),
      type: 'facebook',
      label: 'Facebook Page Phone',
      evidence_url: directUrl(fbData.facebook_url) ?? null,
    });
  }

  for (const p of rows(discovery?.phone_contacts ?? discovery?.contacts)) {
    const raw = first(p, ['number_raw', 'value_as_published', 'value', 'raw_value', 'phone']);
    if (raw) {
      rawPhones.push({
        raw,
        type: first(p, ['type', 'channel', 'purpose']),
        label: first(p, ['label', 'purpose']) || 'Business Phone',
        evidence_url: directUrl(first(p, ['evidence_url', 'source_url', 'url'])),
      });
    }
  }

  const phoneContacts: Record<string, unknown>[] = [];
  const seenPhones = new Set<string>();

  for (const item of rawPhones) {
    const norm = normalizePhoneNumber(item.raw);
    const key = norm.e164 || norm.digits || item.raw.toLowerCase();
    if (!key || seenPhones.has(key)) continue;
    seenPhones.add(key);

    let finalType = item.type || (norm.isMobile ? 'mobile_whatsapp' : 'switchboard');
    if (norm.isMobile && finalType !== 'direct_desk') finalType = 'mobile_whatsapp';

    phoneContacts.push({
      id: id('phone', [key]),
      type: finalType,
      number_raw: norm.raw,
      number_e164: norm.e164,
      whatsapp_url: norm.whatsappUrl,
      dial_url: norm.dialUrl,
      is_mobile: norm.isMobile,
      label: item.label || (norm.isMobile ? 'Mobile / WhatsApp' : 'Office Line'),
      evidence_url: item.evidence_url ?? null,
    });
  }

  const seenPeople = new Map<string, Record<string, unknown>>();
  for (const person of rows(discovery?.decision_makers ?? discovery?.people)) {
    const name = first(person, ['name']);
    const role = first(person, ['role', 'current_role', 'position']) || 'Key Contact';
    if (!name) continue;
    const key = personKey(name);
    const existing = seenPeople.get(key);
    const cited = first(person, ['role_evidence_url', 'evidence_url', 'role_url', 'source_url']);
    const roleUrl = directUrl(cited) || cited || null;
    const profileCited = first(person, ['profile_url', 'personal_profile_url', 'linkedin_url']);
    const profileUrl = directUrl(profileCited) || profileCited || null;
    const directPhone = first(person, ['direct_phone', 'phone', 'mobile']);
    const directEmail = first(person, ['direct_email', 'email']);
    const score = seniorityScore(role);

    if (!existing || score > num(existing.seniority, 0)) {
      seenPeople.set(key, {
        id: id('person', [name, role]),
        name,
        role,
        seniority: score,
        direct_phone: directPhone ? normalizePhoneNumber(directPhone).e164 || directPhone : null,
        direct_email: directEmail || null,
        profile_url: profileUrl,
        role_evidence_url: roleUrl,
      });
    }
  }

  const decisionMakers = [...seenPeople.values()]
    .sort((a, b) => num(b.seniority, 0) - num(a.seniority, 0));

  const emailContacts: Record<string, unknown>[] = [];
  const seenEmails = new Set<string>();

  if (fbData && fbData.email) {
    const fbEmail = str(fbData.email).trim().toLowerCase();
    if (fbEmail && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fbEmail)) {
      seenEmails.add(fbEmail);
      emailContacts.push({
        id: id('email', [fbEmail]),
        type: 'general',
        email: fbEmail,
        label: 'Facebook Page Email',
        evidence_url: directUrl(fbData.facebook_url) ?? null,
      });
    }
  }

  for (const e of rows(discovery?.email_contacts ?? discovery?.contacts)) {
    const email = first(e, ['email', 'value_as_published', 'value']).trim().toLowerCase();
    if (email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && !seenEmails.has(email)) {
      seenEmails.add(email);
      const isGeneral = /^(info|sales|enquiry|support|contact|admin|hello|office)@/i.test(email);
      emailContacts.push({
        id: id('email', [email]),
        type: isGeneral ? 'general' : 'direct',
        email,
        label: isGeneral ? 'General Inquiry' : 'Direct Work Email',
        evidence_url: directUrl(first(e, ['evidence_url', 'source_url', 'url'])),
      });
    }
  }

  const primaryDM = decisionMakers[0];
  const primaryPhone = phoneContacts.find((p) => p.type === 'mobile_whatsapp') || phoneContacts.find((p) => p.type === 'direct_desk') || phoneContacts[0];

  const gatekeeperPhrase = primaryDM
    ? `Hello, may I speak with ${primaryDM.name}, ${primaryDM.role}, please?`
    : `Hello, could you please connect me with the person in charge of business operations or partnerships?`;

  const cheatSheet = {
    primary_decision_maker: primaryDM ? `${primaryDM.name} (${primaryDM.role})` : null,
    primary_decision_maker_name: primaryDM ? str(primaryDM.name) : null,
    primary_decision_maker_role: primaryDM ? str(primaryDM.role) : null,
    primary_phone: primaryPhone ? str(primaryPhone.number_e164 || primaryPhone.number_raw) : null,
    primary_channel: primaryPhone ? (primaryPhone.is_mobile ? 'WhatsApp / Mobile' : 'Switchboard Line') : null,
    whatsapp_url: primaryPhone && primaryPhone.whatsapp_url ? str(primaryPhone.whatsapp_url) : null,
    dial_url: primaryPhone ? str(primaryPhone.dial_url) : null,
    gatekeeper_phrase: gatekeeperPhrase,
  };

  return {
    entity,
    cheat_sheet: cheatSheet,
    decision_makers: decisionMakers,
    phone_contacts: phoneContacts,
    email_contacts: emailContacts,
    summary: primaryDM
      ? `Key contact is ${primaryDM.name} (${primaryDM.role}). Best reach via ${cheatSheet.primary_channel ?? 'phone'}.`
      : `Telemarketing research for ${str(company.name)}. ${phoneContacts.length} phone routes found.`,
  };
}

export function round01Prompt(company: Record<string, unknown>): string {
  return `You are Round 01 of a business lead-enrichment test. Research this exact company as of ${new Date().toISOString().slice(0, 10)}.
IMMUTABLE GOOGLE MAPS INPUT: ${companyBaseline(company)}
${FETCH_POLICY}
${TIME_BUDGET}
Find complete public company contacts, verified decision-relevant people, and separately retain named people who need verification. Search these sources separately: SSM/e-Info, CTOS/CreditScan, MyHIJAU, SEDA, CIDB, Maukerja, Hiredly, Ricebowl, JobStreet, Jora, LinkedIn company and people pages, official team/careers/testimonial pages, and reputable award, association, tender and news pages.
Rules: report everything you find and let the pipeline grade it -- never withhold a real finding because its source is only a homepage, is http rather than https, or is a registry you could not deep-link into. Give the most specific URL you actually used, as a raw https:// or http:// string and never a Markdown link; if you genuinely have no URL, name the source in evidence_url and return the row anyway. Company pages are first_party; do not infer emails/profiles/dates; no negative claims from search absence; do not explain conflicts without evidence; source date is null unless visibly published. Put a person in people only when their current role has direct URL evidence. Put a person in candidate_people when a named public source identifies them but that direct role evidence is missing; provide source_name, and source_url when known. Candidates are leads to verify, not confirmed roles.
Return exactly one compact JSON object in one fenced code block with arrays contacts, people, candidate_people, signals, conflicts_and_unknowns. Contact fields: purpose,value_as_published,normalized_value,current_status,evidence_class,evidence_url,source_date. People: name,current_role,relevance,evidence_class,role_evidence_url,personal_profile_url,source_date. Candidate people: name,current_role,source_name,source_url,relevance,verification_note. Signals: date,fact,evidence_class,evidence_url,outreach_use. Max 20 contacts, 12 people, 24 candidate_people, 10 signals. No prose outside JSON.`;
}

function round02Prompt(kind: 'contacts' | 'people' | 'signals', company: Record<string, unknown>, r1: Record<string, unknown>): string {
  const schemas = {
    contacts: 'contacts: purpose,value_as_published,normalized_value,current_status,evidence_class,evidence_url,source_date',
    people: 'people: name,current_role,relevance,evidence_class,role_evidence_url,personal_profile_url,source_date; candidate_people: name,current_role,source_name,source_url,relevance,verification_note',
    signals: 'signals: date,fact,evidence_class,evidence_url,outreach_use',
  };
  return `You are Round 02 auditing Round 01 for ${str(company.name)}. Do fresh web research; Round 01 is untrusted.
COMPANY BASELINE: ${companyBaseline(company)}
ROUND 01 PARSED LEADS: ${JSON.stringify(r1).slice(0, 28_000)}
Focus only on ${kind}. Confirm, correct, reject and add missed evidence. For contacts inspect subscription/campaign/careers/vendor pages. For people inspect SSM/e-Info, CTOS/CreditScan, MyHIJAU, SEDA, CIDB, job boards, LinkedIn people/company pages, official team pages, awards and associations. Prioritize CEO, commercial, partnerships, procurement, operations and HR, but retain directors, registry contacts, team members and employees as candidate_people when the named source is public but the current role lacks direct evidence. For signals use direct issuer or specific company pages.
Return exactly one compact JSON object inside one fenced code block with ${schemas[kind]}. Every URL must be a literal raw URL string inside JSON, never a Markdown link label. Report what you find and let the pipeline grade its sourcing: do not drop a real finding because its source is a homepage or is http. Candidate people require source_name and use source_url only when known. No inferred emails or personal URLs. Search snippets and crawl dates are not evidence. Use null when unknown. Max ${kind === 'contacts' ? 20 : kind === 'people' ? '12 people plus 24 candidate_people' : 10} rows and no prose outside JSON.`;
}


// ---------------------------------------------------------------- Round 03
//
// Round 03 used to be a Meta/Muse ask: a model was asked whether it could see
// live Facebook pages and, if it said yes, what was on them. Both halves of that
// answer came from the same place, so the round could not be audited — and it
// mostly replied `no_live_access` with empty arrays, which is the honest answer
// to a question that should never have been put to a model. The muse engine
// behind it is retired.
//
// It is the fb-recon crawler on the mini now. A deterministic read-only browser
// visits the pages, and every row below carries the facebook.com URL it was read
// from — the evidence standard the ledger always claimed, now actually met.

// Only a confirmed or likely page match contributes rows. A `weak` match is a
// plausible page that may belong to a different business, and attaching its phone
// number to this company is precisely the poisoning this round exists to prevent.
const FB_TRUSTED = new Set(['confirmed', 'likely']);

async function runJob(type: string, payload: Record<string, unknown>, timeoutMs: number, onCreated?: (id: string) => Promise<unknown>): Promise<Record<string, unknown>> {
  const job = jobs.create(type, payload, timeoutMs);
  if (onCreated) await onCreated(job.id);
  const settled = await jobs.wait(job.id, timeoutMs + 5_000);
  if (!settled || settled.status !== 'done') throw new Error(settled?.error ?? type + ' did not finish');
  return object(settled.result);
}

/**
 * A Messenger link is a contact point only when the page published one. fb-recon
 * also *derives* a link from the profile URL for convenience and labels it
 * `derived`; that is arithmetic, not evidence, so it never enters the ledger.
 */
function messengerContact(row: Record<string, unknown>, purpose: string, evidenceUrl: string | null): Record<string, unknown> | null {
  const link = str(row.messenger_url).trim();
  if (!evidenceUrl || !link) return null;
  // `detected` means the page published the link; `derived` means fb-recon built
  // it from the profile URL. The derived one used to be discarded as "arithmetic,
  // not evidence" -- but it is a working Messenger route to this business, and
  // deleting a usable contact because of how it was obtained helps nobody. It is
  // labelled instead, and the label says exactly what it is.
  const detected = str(row.messenger_source) === 'detected';
  return {
    purpose, value_as_published: link, normalized_value: link,
    current_status: 'published',
    evidence_class: detected ? 'facebook_page_published' : 'facebook_link_derived_from_profile',
    evidence_strength: detected ? 'direct_page' : 'domain_only',
    derived: !detected,
    evidence_url: evidenceUrl, _round: 'round03',
  };
}

/**
 * Turn what the crawler saw into ledger rows. Pure on purpose: this is where the
 * evidence policy is actually enforced, so it has to be provable without a
 * worker, a queue or a browser in the way.
 */
export function facebookLedgerRows(page: Record<string, unknown>, discovered: Record<string, unknown> | null): {
  contacts: Record<string, unknown>[]; people: Record<string, unknown>[];
  signals: Record<string, unknown>[]; gaps: string[]; pageUrl: string | null;
} {
  const contacts: Record<string, unknown>[] = [];
  const people: Record<string, unknown>[] = [];
  const signals: Record<string, unknown>[] = [];
  const gaps: string[] = [];
  const pageUrl = classifyEvidence(page.facebook_url).url;
  if (!pageUrl) return { contacts, people, signals, gaps, pageUrl: null };
  // Confidence grades the rows; it does not decide whether they exist. This used
  // to return empty for a `weak` match, so a page the crawler found -- with its
  // phone, email, Messenger link, follower count and every person on it -- was
  // thrown away wholesale because the match was not certain. A `weak` match that
  // is really this company is a real finding, and whether to believe it is the
  // reader's call, not this function's.
  const confidence = str(page.confidence) || 'weak';
  const confirmed = FB_TRUSTED.has(confidence);
  const fbStrength: EvidenceStrength = confirmed ? 'direct_page' : 'domain_only';
  const fbClass = confirmed ? 'facebook_page' : 'facebook_page_unconfirmed_match';
  if (!confirmed) {
    gaps.push('Facebook page match is confidence "' + confidence + '": these rows may belong to a different business.');
  }

  const contact = (purpose: string, value: unknown): void => {
    const raw = str(value).trim();
    if (!raw) return;
    contacts.push({
      purpose, value_as_published: raw, normalized_value: raw,
      current_status: 'published', evidence_class: fbClass,
      evidence_url: pageUrl, evidence_strength: fbStrength,
      facebook_match_confidence: confidence, _round: 'round03',
    });
  };
  contact('Facebook Page phone', page.phone);
  contact('Facebook Page email', page.email);
  const pageMessenger = messengerContact(page, 'Messenger — company page', pageUrl);
  if (pageMessenger) contacts.push(pageMessenger);

  // Followers and reviews are the one thing a Page states about itself that is
  // worth a signal row: it is what "are they actually active here" looks like.
  const audience = [
    str(page.followers).trim() ? str(page.followers).trim() + ' followers' : '',
    num(page.reviews, 0) > 0 ? String(num(page.reviews, 0)) + ' reviews' : '',
  ].filter(Boolean).join(' and ');
  if (audience) {
    signals.push({
      date: null, fact: 'Facebook Page shows ' + audience + '.',
      evidence_class: fbClass, evidence_url: pageUrl, evidence_strength: fbStrength,
      facebook_match_confidence: confidence,
      outreach_use: 'Gauges how active and how public this business is on Facebook.',
      _round: 'round03',
    });
  }

  const companyUrl = directUrl(discovered?.company_url) ?? pageUrl;
  for (const person of rows(discovered?.people)) {
    const name = str(person.name).trim();
    const role = str(person.role).trim();
    if (!name) continue;
    // A named human at this company is a finding whether or not Facebook stated a
    // title for them. This used to drop them and log a gap; the name is the part
    // that matters and the missing title is now said out loud on the row itself.
    const profileUrl = classifyEvidence(person.profile_url).url;
    people.push({
      name, role: role || 'Role not stated on Facebook',
      role_stated: Boolean(role),
      relevance: str(person.source).trim() || null,
      evidence_class: 'facebook_' + (str(person.confidence) || 'weak'),
      evidence_strength: role ? fbStrength : 'domain_only',
      facebook_match_confidence: confidence,
      role_evidence_url: companyUrl,
      personal_profile_url: profileUrl,
      _round: 'round03',
    });
    const personMessenger = messengerContact(person, 'Messenger — ' + name, profileUrl ?? companyUrl);
    if (personMessenger) contacts.push(personMessenger);
  }

  return { contacts, people, signals, gaps, pageUrl };
}

async function round03Facebook(company: Record<string, unknown>): Promise<{
  artifact: Record<string, unknown>; parsed: Record<string, unknown> | null; status: string;
}> {
  const empty = { contacts: [], people: [], signals: [], search_gaps: [] as string[] };
  // A type no lane is claiming would leave a job pending until it timed out.
  // Saying so up front costs the run nothing and reads honestly in the report.
  if (!jobs.liveTypes().includes('fb.company')) {
    return {
      artifact: { access_mode: 'no_live_access', access_evidence: 'No mini worker is claiming fb.company; nothing visited Facebook for this run.', ...empty },
      parsed: null,
      status: 'skipped',
    };
  }

  const lead = {
    name: str(company.name), address: str(company.address), phone: str(company.phone),
    website: str(company.website), category: str(company.category),
  };
  const lookup = await runJob('fb.company', { ...lead, timeoutMs: 300_000 }, 300_000);
  const page = object(lookup.result);

  // Named humans — but only off a page the crawler confirmed. `discover` is the
  // expensive half of this round, so it never runs against an unconfirmed page.
  let discovery: Record<string, unknown> | null = null;
  const gaps: string[] = [];
  const trusted = directUrl(page.facebook_url) && FB_TRUSTED.has(str(page.confidence));
  if (trusted && jobs.liveTypes().includes('fb.discover')) {
    try {
      discovery = await runJob('fb.discover', { name: lead.name, address: lead.address, timeoutMs: 420_000 }, 420_000);
    } catch (err) {
      gaps.push('fb.discover failed: ' + ((err as Error).message ?? String(err)));
    }
  } else if (trusted) {
    gaps.push('No mini worker is claiming fb.discover; people were not searched for.');
  }

  const built = facebookLedgerRows(page, discovery ? object(discovery.result) : null);
  if (!built.pageUrl) {
    return {
      artifact: {
        access_mode: 'no_live_access',
        access_evidence: directUrl(page.facebook_url)
          ? 'A Facebook page was found, but only at confidence "' + str(page.confidence) + '", which is below the bar for evidence.'
          : 'No Facebook page for this business could be confirmed.',
        company_lookup: lookup, ...empty,
      },
      parsed: null,
      status: 'completed',
    };
  }

  const searchGaps = [...gaps, ...built.gaps];
  return {
    artifact: {
      access_mode: 'live_facebook_pages',
      access_evidence: 'fb-recon crawled ' + built.pageUrl + ' read-only at confidence "' + str(page.confidence) + '".',
      company_lookup: lookup, people_lookup: discovery,
      contacts: built.contacts, people: built.people, signals: built.signals, search_gaps: searchGaps,
    },
    parsed: { access_mode: 'live_facebook_pages', contacts: built.contacts, people: built.people, signals: built.signals },
    status: 'completed',
  };
}

function round04Prompt(ledger: Record<string, unknown>): string {
  return `You are Round 04. Write a concise final business-intelligence synthesis using only this validated ledger: ${JSON.stringify(ledger)}
Candidate people are leads to verify, not confirmed roles: do not present their role or affiliation as fact in summary or outreach_angles. Return exactly one JSON object in a fenced code block with keys summary (max 120 words), outreach_angles (max 5 short strings), entity, contacts, people, candidate_people, signals, conflicts_and_unknowns. Copy entity/contacts/people/candidate_people/signals/conflicts arrays exactly, including every id and URL.Copy every URL as a literal raw https:// string exactly as it appears in the ledger, never as a Markdown link and never wrapped in brackets. Do not browse, add, remove, rename, infer, resolve conflicts or introduce any number/name/URL not present in the ledger. No prose outside JSON.`;
}

interface TranslationEntry { path: string[]; text: string; }

function translationEntries(value: unknown, path: string[] = [], out: TranslationEntry[] = []): TranslationEntry[] {
  if (typeof value === 'string') {
    const key = path[path.length - 1] ?? '';
    // Published data routes and identifiers must be copied byte-for-byte. The
    // remaining strings are human-facing report copy and can be safely localised.
    if (!translationInvariantKey(key) && !/^https?:\/\//i.test(value) && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) out.push({ path, text: value });
  } else if (Array.isArray(value)) {
    value.forEach((child, index) => translationEntries(child, [...path, String(index)], out));
  } else if (value && typeof value === 'object') {
    Object.entries(value as Record<string, unknown>).forEach(([key, child]) => translationEntries(child, [...path, key], out));
  }
  return out;
}

function putTranslation(target: Record<string, unknown>, path: string[], text: string): void {
  let cursor: Record<string, unknown> | unknown[] = target;
  for (let index = 0; index < path.length - 1; index++) cursor = cursor[Array.isArray(cursor) ? Number(path[index]) : path[index]!] as Record<string, unknown> | unknown[];
  const key = path[path.length - 1]!;
  if (Array.isArray(cursor)) cursor[Number(key)] = text;
  else cursor[key] = text;
}

/**
 * One translation batch through the research gateway.
 *
 * Retries are two, not four, and there is no backoff ladder any more. Both of
 * those existed to ride out e-router cold-starting behind a 503, and they are
 * what turned a dead translation service into 232 seconds of a company report.
 * The gateway's own admission queue is now the thing that paces this, and an
 * engine that is genuinely unavailable is refused there in milliseconds rather
 * than slept on here. A second try is still worth having: a run that hits its
 * time limit is a lost call rather than a broken engine.
 */
async function translationAsk(prompt: string, timeoutMs: number): Promise<string> {
  const model = process.env.TRANSLATION_MODEL?.trim() || 'pi';
  const out = await gateway.askModel(model, prompt, { timeoutMs });
  return out.answer;
}

async function translationResponse(
  askEngine: (prompt: string, timeoutMs: number) => Promise<string>,
  texts: string[],
): Promise<string[]> {
  const prompt = `Translate each English string below to Simplified Chinese (zh-CN), in order. This is translation only: do not add, omit, merge, reorder, infer, or correct anything. Preserve all proper names, identifiers, URLs, email addresses, phone numbers, dates, codes, and numbers exactly if present. Return exactly one JSON object in a fenced code block: {"translations":["...same count and order..."]}.\nINPUT: ${JSON.stringify(texts)}`;
  let lastError = 'translation request failed';
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const raw = await askEngine(prompt, 300_000);
      const parsed = extractJson(raw);
      const translated = parsed.value?.translations;
      if (!Array.isArray(translated) || translated.length !== texts.length || !translated.every((item) => typeof item === 'string')) {
        throw new Error(parsed.error ?? 'translation service returned an invalid translations array');
      }
      return translated as string[];
    } catch (err) {
      lastError = (err as Error).message ?? String(err);
      // Pause only for a refusal, and only once. The admission queue turns a
      // burst away with a 429, and retrying that in the same millisecond only
      // collects a second one. A model that answered with prose instead of JSON
      // is a different failure and wants the retry immediately -- waiting on it
      // buys nothing, which is what the old 2s/8s/20s ladder was doing when it
      // spent 232 seconds of a report arriving at the same result.
      const refused = /\b429\b|too many|rate limit|retry-after|queue is|busy/i.test(lastError);
      if (attempt === 0 && refused) await new Promise((resolve) => setTimeout(resolve, 3_000));
    }
  }
  throw new Error(lastError);
}

function personBaseline(company: Record<string, unknown>, person: Record<string, unknown>): string {
  return JSON.stringify({
    company_name: company.name,
    company_website: company.website ?? null,
    person_id: person.id,
    person_name: first(person, ['name']),
    current_role: first(person, ['role', 'current_role', 'position']),
    role_evidence_url: first(person, ['role_url', 'role_evidence_url', 'evidence_url']),
    personal_profile_url: directUrl(person.personal_profile_url) ?? null,
  });
}

export function personDiscoveryPrompt(company: Record<string, unknown>, person: Record<string, unknown>, hints: PersonIdentityHints = {}): string {
  const resolvers = [
    hints.email ? `email: ${hints.email}` : null,
    hints.mobile ? `mobile: ${hints.mobile}` : null,
  ].filter(Boolean);
  const privateHint = resolvers.length
    ? `PRIVATE IDENTITY RESOLVERS (caller-supplied; use only as exact search and disambiguation keys): ${resolvers.join('; ')}. Never repeat, return, publish, save, or treat these values as a contact or evidence. Use them only to locate public professional pages that independently connect the target name to the target company or current role. Do not query breach data, data brokers, people-search sites, or private/social accounts.`
    : 'No private identity resolver was supplied; scope discovery with the target name and company.';
  return `You are researching a confirmed business leader for a VIP qualification brief as of ${new Date().toISOString().slice(0, 10)}.
TARGET BASELINE: ${personBaseline(company, person)}
${privateHint}
${FETCH_POLICY}
${TIME_BUDGET}
Research public professional business information only: the current role, public company/board affiliations, attributable interviews or talks, dated business signals, and professional publications or speaking appearances relevant to a commercial or partnership conversation. Resolve namesakes conservatively: retain a finding only when the direct source ties it to the target company/current role, when two independent public-professional sources make the match clear, or when a source contains an exact match to a caller-supplied individual email or normalized mobile. That exact resolver match is sufficient to retain a prior-company affiliation even when the source names a different employer; label it as historical, never current. For a resolver-validated row, set identity_match_basis to exact_email_match or exact_mobile_match, but never repeat any identifier value.
Never collect or return home address, non-business phone, family, private social accounts, age, ethnicity, religion, health, political views, private wealth, breach data, data-broker records, or personal contact details. Do not infer any fact, email, profile, title, date or affiliation.
Every retained item requires a raw full https:// direct source URL. Company-controlled pages are first_party; independent issuer/news pages are independent; public professional platforms are social_platform. Search snippets and bare homepages are not evidence.
Return exactly one compact JSON object inside a fenced code block with arrays contacts, facts and signals. Contact fields: purpose,value_as_published,normalized_value,current_status,evidence_class,evidence_url,source_date,identity_match_note. Retain only professional/business contact routes directly published by the person, company, or a reputable organization; distinguish a company-wide route from a person-specific route. Fact fields: category,fact,evidence_class,evidence_url,source_date,identity_match_basis. Signal fields: date,fact,evidence_class,evidence_url,outreach_use. Max 16 contacts, 16 facts and 10 signals. No prose outside JSON.`;
}

function personAuditPrompt(
  company: Record<string, unknown>,
  person: Record<string, unknown>,
  discovery: Record<string, unknown>,
): string {
  const leadUrls = [...rows(discovery.contacts), ...rows(discovery.facts), ...rows(discovery.signals)]
    .map((row) => first(row, ['evidence_url', 'source_url', 'url']))
    .filter(Boolean)
    .slice(0, 24);
  return `Independently audit and extend a VIP qualification brief for this exact business leader as of ${new Date().toISOString().slice(0, 10)}.
TARGET BASELINE: ${personBaseline(company, person)}
These untrusted public URLs are leads only; verify them and research beyond them: ${JSON.stringify(leadUrls)}
Use only the target name, company, role, and public-source leads. Do not seek or infer personal identifiers, and do not collect private or sensitive data. Retain only public professional information that direct evidence connects to the target company/current role, or to a historical employer already resolver-validated by the primary pass: current role, board/company affiliations, attributable interviews/talks/publications, and dated business signals relevant to a commercial conversation. Never upgrade a historical affiliation into a current role.
Every retained row needs a raw full https:// direct evidence URL; exclude search snippets, bare homepages, uncited claims, namesake matches, data brokers, breach data, and personal contact details. Return exactly one compact JSON object inside a fenced code block with contacts, facts and signals. Use the same fields as the discovery pass. Max 12 contacts, 16 facts and 10 signals. No prose outside JSON.`;
}

type SocialScout = 'facebook' | 'x';

const scoutConfig: Record<SocialScout, { jobType: string; hosts: string[]; label: string; defaultTimeoutMs: number }> = {
  facebook: {
    // Matches the home worker's public-person contract, not the company-page
    // crawler. It needs both names to resolve a namesake conservatively.
    jobType: process.env.VIP_FB_SCOUT_JOB_TYPE?.trim() || 'fb.person',
    hosts: ['facebook.com', 'instagram.com', 'threads.net'],
    label: 'Facebook/Instagram Scout',
    defaultTimeoutMs: 300_000,
  },
  x: {
    // x-recon uses Grok to search X and exposes the cited X permalinks in its
    // x.subject envelope. It intentionally has a longer budget than Facebook.
    jobType: process.env.VIP_XAI_SCOUT_JOB_TYPE?.trim() || 'x.subject',
    hosts: ['x.com', 'twitter.com'],
    label: 'Grok / X Scout',
    defaultTimeoutMs: 600_000,
  },
};

function personScoutPayload(
  scout: SocialScout,
  company: Record<string, unknown>,
  person: Record<string, unknown>,
  timeoutMs: number,
): Record<string, unknown> {
  const personName = first(person, ['name']);
  const companyName = str(company.name);
  if (scout === 'facebook') {
    return {
      person: personName,
      company: companyName,
      address: str(company.address),
      website: str(company.website),
      budget: Math.min(Math.max(Number(process.env.VIP_FB_SCOUT_BUDGET ?? 8), 1), 25),
      timeoutMs,
    };
  }
  return {
    // The company qualifier is part of the actual X/Grok search subject so a
    // common name does not silently turn into a namesake investigation.
    subject: `${personName} ${companyName}`.trim(),
    max: Math.min(Math.max(Number(process.env.VIP_XAI_SCOUT_MAX ?? 12), 1), 40),
    budget: Math.min(Math.max(Number(process.env.VIP_XAI_SCOUT_BUDGET ?? 4), 1), 10),
    timeoutMs,
  };
}

/** Convert supported worker envelopes to the evidence-only VIP ledger shape. */
export function scoutParsed(scout: SocialScout, result: unknown): Record<string, unknown> | null {
  const value = object(result);
  const direct = object(value.parsed);
  if (Object.keys(direct).length) return direct;
  const raw = str(value.answer || value.text || value.output);
  if (raw) return extractJson(raw).value;
  if (Array.isArray(value.contacts) || Array.isArray(value.facts) || Array.isArray(value.signals)) return value;

  const native = object(value.result);
  if (!Object.keys(native).length) return null;
  if (scout === 'facebook') {
    const confidence = str(native.confidence).toLowerCase();
    const url = directUrl(first(native, ['facebook_url', 'profile_url', 'page_url']));
    // fb.person has already resolved name + company. A weak lead is not enough
    // to identify a person in a VIP report, even though it is useful worker
    // telemetry, so it contributes no ledger row.
    if (!url || !['confirmed', 'likely'].includes(confidence)) return { contacts: [], facts: [], signals: [] };
    return {
      contacts: [],
      facts: [{
        category: 'Public social profile',
        fact: 'A public Facebook profile/page was matched to the scoped person and company.',
        evidence_class: 'social_platform', evidence_url: url, source_date: null,
      }],
      signals: [],
    };
  }

  // x-recon labels whether Grok actually rendered each permalink. An X URL
  // alone is not sufficient: only cited threads are direct worker evidence.
  const threads = rows(native.threads)
    .filter((thread) => thread.cited === true && Boolean(directUrl(first(thread, ['url', 'evidence_url']))))
    .slice(0, 10);
  const facts = threads.map((thread) => {
    const author = first(thread, ['author']) || 'an X account';
    const detail = first(thread, ['topic', 'excerpt']) || 'a public post relevant to the scoped person/company';
    return {
      category: 'Cited X post', fact: `${author} posted about ${detail}.`, evidence_class: 'social_platform',
      evidence_url: directUrl(first(thread, ['url', 'evidence_url'])), source_date: thread.date ?? null,
    };
  });
  const signals = threads.filter((thread) => Boolean(str(thread.date))).map((thread) => ({
    date: thread.date, fact: first(thread, ['topic', 'excerpt']) || 'Cited X discussion relevant to the scoped person/company.',
    evidence_class: 'social_platform', evidence_url: directUrl(first(thread, ['url', 'evidence_url'])),
    outreach_use: 'Use only when the cited discussion is relevant to the conversation.',
  }));
  return { contacts: [], facts, signals };
}

async function runPersonScout(
  scout: SocialScout,
  company: Record<string, unknown>,
  person: Record<string, unknown>,
): Promise<{ parsed: Record<string, unknown> | null; metadata: Record<string, unknown>; failed: boolean }> {
  const config = scoutConfig[scout];
  if (!jobs.liveTypes().includes(config.jobType)) {
    return { parsed: null, metadata: { status: 'unavailable', lane: config.label, worker_job_type: config.jobType }, failed: false };
  }
  const configuredTimeout = Number(process.env.VIP_SOCIAL_SCOUT_TIMEOUT_MS);
  const timeoutMs = Math.min(Math.max(Number.isFinite(configuredTimeout) ? configuredTimeout : config.defaultTimeoutMs, 30_000), 600_000);
  const started = Date.now();
  try {
    // Private resolvers intentionally do not cross into worker payloads. The
    // payload below is the actual fb.person / x.subject worker contract.
    const job = jobs.create(config.jobType, personScoutPayload(scout, company, person, timeoutMs), timeoutMs);
    const settled = await jobs.wait(job.id, timeoutMs + 5_000);
    if (!settled || settled.status === 'pending' || settled.status === 'running') {
      return { parsed: null, metadata: { status: 'timeout', lane: config.label, worker_job_type: config.jobType, job_id: job.id, ms: Date.now() - started }, failed: true };
    }
    if (settled.status !== 'done') {
      return { parsed: null, metadata: { status: 'failed', lane: config.label, worker_job_type: config.jobType, job_id: job.id, error: settled.error, ms: Date.now() - started }, failed: true };
    }
    const parsed = scoutParsed(scout, settled.result);
    if (!parsed) {
      return { parsed: null, metadata: { status: 'invalid_output', lane: config.label, worker_job_type: config.jobType, job_id: job.id, ms: Date.now() - started }, failed: true };
    }
    return {
      parsed: keepDiscoveryEvidenceFromHosts(parsed, config.hosts),
      metadata: { status: 'completed', lane: config.label, worker_job_type: config.jobType, job_id: job.id, ms: Date.now() - started },
      failed: false,
    };
  } catch (err) {
    return { parsed: null, metadata: { status: 'failed', lane: config.label, worker_job_type: config.jobType, error: (err as Error).message ?? String(err), ms: Date.now() - started }, failed: true };
  }
}

function personSynthesisPrompt(ledger: Record<string, unknown>): string {
  return `Write a concise VIP qualification brief using only this validated public-professional ledger: ${JSON.stringify(ledger)}
Return exactly one JSON object in a fenced code block with keys summary (max 120 words), research_angles (max 4 short strings), person, contacts, facts, signals. Copy person, contacts, facts and signals exactly, including every id and URL.Copy every URL as a literal raw https:// string exactly as it appears in the ledger, never as a Markdown link and never wrapped in brackets. Do not browse, add, remove, rename, infer, or introduce any new URL, fact, affiliation, contact detail, or sensitive personal data. No prose outside JSON.`;
}

async function ask(model: string, prompt: string, timeoutMs: number): Promise<{
  raw: string; parsed: Record<string, unknown> | null; parse_error: string | null;
  model: string; engine: string; ms: number; queued_ms: number; wall_ms: number;
}> {
  // `ms` is engine time, and engine time is not the whole story: a call can wait
  // in the admission queue and then again in the job broker before any engine
  // sees it. Rounds used to record `ms` alone, which is how a Round 04 that
  // occupied 355 seconds came to be filed as 49 and nobody could see where a
  // 13-minute report had gone. Carry the wait and the wall clock beside it.
  const started = Date.now();
  const out = await gateway.askModel(model, prompt, { timeoutMs });
  const parsed = extractJson(out.answer);
  return {
    raw: out.answer, parsed: parsed.value, parse_error: parsed.error,
    model: out.model, engine: out.engine, ms: out.ms,
    queued_ms: out.queuedMs ?? 0, wall_ms: Date.now() - started,
  };
}

/**
 * The Chinese edition, translated by Pi.
 *
 * It used to be an OpenAI-compatible call to e-router's `step-3.7-flash`, held
 * deliberately outside the research gateway. That was the wrong side of the
 * fence: e-router answered 503 on run 2rO7nzyANyjYDpfOf0mQ and the bespoke
 * four-attempt backoff spent 232 seconds riding it out before failing anyway --
 * on the critical path, after the English dossier was already finished and
 * saved. Pi is the model this pipeline already depends on for Rounds 01 and 04,
 * and routing through the gateway means the admission queue governs it like everything else
 * instead of it being a private HTTP client with private retry rules.
 *
 * `askEngine` is injected so this is testable without a gateway, a queue or a
 * worker in the way; nothing in production passes it.
 */
export async function translateChinese(
  finalReport: Record<string, unknown>,
  askEngine: (prompt: string, timeoutMs: number) => Promise<string> = translationAsk,
): Promise<{
  translated: Record<string, unknown>; model: string; ms: number; validation_errors: string[];
}> {
  const model = process.env.TRANSLATION_MODEL?.trim() || 'pi';
  const started = Date.now();
  const translated = structuredClone(finalReport);
  const entries = translationEntries(finalReport);
  // Batches were 30 because e-router 503'd on anything larger. That constraint
  // left with e-router: Pi already takes the Round 01 and Round 04 prompts,
  // which are the whole ledger in one message. Bigger batches mean fewer round
  // trips, and a round trip is the expensive part.
  const size = Math.max(1, Number(process.env.TRANSLATION_BATCH) || 60);
  const batches: TranslationEntry[][] = [];
  for (let offset = 0; offset < entries.length; offset += size) {
    batches.push(entries.slice(offset, offset + size));
  }
  // The batches are independent: each carries its own texts and writes to its own
  // paths, and each ask is a stateless completion.
  //
  // Two. Wider does not go faster -- it just moves the queue into the gateway's
  // Pi lane, where the extra calls wait exactly as long.
  const width = Math.max(1, Number(process.env.TRANSLATION_CONCURRENCY) || 2);
  let next = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const index = next++;
      const batch = batches[index];
      if (!batch) return;
      const texts = await translationResponse(askEngine, batch.map((entry) => entry.text));
      batch.forEach((entry, at) => putTranslation(translated, entry.path, texts[at]!));
    }
  };
  await Promise.all(Array.from({ length: Math.min(width, batches.length) }, worker));
  // A validation failure used to throw, which meant one bad field destroyed the
  // whole Chinese report and the reader got nothing. The translation is built by
  // copying the English report and replacing text in place, so every id, URL,
  // phone number and email is already carried over structurally -- a validation
  // error flags a discrepancy worth knowing about, not a document worth binning.
  // So it ships, and it ships carrying the list of what did not check out.
  const errors = validateChineseTranslation(translated, finalReport);
  return { translated, model, ms: Date.now() - started, validation_errors: errors };
}

/** Start one business-list report. The portal, the API and the taman auto-scan all start here. */
export async function launchBusinessSearch(input: {
  keyword?: string; place?: string; max?: unknown; userId?: string | null; timeoutMs?: unknown; autoQueued?: boolean;
}): Promise<db.PublishedReport> {
  const keyword = str(input.keyword).trim();
  const place = str(input.place).trim();
  const max = Math.min(Math.max(Math.round(num(input.max, 200)), 1), 2000);
  const request: Record<string, unknown> = {
    keyword, place: place || null, max, userId: input.userId || null, timeoutMs: num(input.timeoutMs, 1_200_000),
    ...(input.autoQueued ? { autoQueued: 'true' } : {}),
  };
  const title = keyword ? `${keyword}${place ? ' in ' + place : ''}` : `Businesses in ${place}`;
  const report = await db.createReport({ type: 'business_search', title, userId: str(request.userId) || null, request });
  void runBusinessSearch(report.public_id, report.id, request);
  return report;
}

async function runBusinessSearch(publicId: string, reportId: string, request: Record<string, unknown>): Promise<void> {
  if (active.has(publicId)) return;
  active.add(publicId);
  try {
    await db.updateReport(publicId, { status: 'running', error: null });
    if (!jobs.liveTypes().includes('gmap.scan')) throw new Error('Google Maps worker is offline');
    const timeoutMs = Math.min(Math.max(num(request.timeoutMs, 600_000), 60_000), 1_200_000);
    const keyword = str(request.keyword).trim();
    const place = str(request.place).trim();
    // Keep location-only searches working while a Mac mini may still be running
    // the previous worker, which required a non-empty keyword. Updated workers
    // use searchMode/originalPlace to preserve the proper field semantics.
    const locationOnly = !keyword && Boolean(place);
    const job = jobs.create('gmap.scan', {
      keyword: locationOnly ? place : keyword,
      place: locationOnly ? null : place || null,
      searchMode: locationOnly ? 'location_only' : undefined,
      originalPlace: locationOnly ? place : undefined,
      max: request.max,
      userId: request.userId,
      reportPublicId: publicId,
      storage: 'hub',
    }, timeoutMs);
    await db.updateReport(publicId, { jobId: job.id });
    const settled = await jobs.wait(job.id, timeoutMs + 5_000);
    if (!settled || settled.status !== 'done') throw new Error(settled?.error ?? 'Google Maps scan did not finish');
    const scan = object(settled.result);
    if (!Array.isArray(scan.businesses)) throw new Error('Google Maps worker returned no businesses array');
    const capturedCompanies = rows(scan.businesses);
    const saved = object(scan.saved);
    const savedId = saved.reportId != null ? String(saved.reportId) : null;
    const workerSaveError = str(scan.saveError, savedId || scan.storage === 'hub' ? '' : 'worker returned no saved report id');
    const scanDetails = { ...scan };
    delete scanDetails.businesses;
    const captured = { search: scanDetails, companies: capturedCompanies, scan_metadata: {
      blocked: scan.blocked, limited_view: scan.limitedView, capped: scan.capped,
      save_error: workerSaveError || null,
      // The saved result swaps `search` for the database row, so the scan's own
      // cost and skipped searches live here, where /auto-queue reads them.
      requests: typeof scan.requests === 'number' ? scan.requests : null,
      skipped_searches: Array.isArray(scan.skippedSearches) ? scan.skippedSearches : null,
      took_ms: typeof scan.tookMs === 'number' ? scan.tookMs : null,
    } };
    // Keep the harvested rows before attempting any further writes. A later
    // persistence failure can then be repaired from this report without Maps.
    try {
      await db.updateReport(publicId, { result: captured });
    } catch (captureError) {
      console.error(`[business_search.snapshot_failed] report=${publicId} job=${job.id}: ${(captureError as Error).message ?? String(captureError)}`);
    }
    await db.logEvent({ reportId, publicId, jobId: job.id, stage: 'business_search', event: 'business_search.captured', detail: { companies: capturedCompanies.length, worker_saved: Boolean(savedId), worker_error: workerSaveError || null } });

    let durable: Awaited<ReturnType<typeof db.searchResult>> = null;
    let searchReportId = savedId;
    let recovered = false;
    const expected = new Set(capturedCompanies.filter((c) => str(c.name).trim()).map(db.scanPlaceKey)).size;
    try {
      durable = savedId ? await db.searchResult(savedId) : null;
      if (!durable || durable.companies.length < expected) {
        const repaired = await db.persistBusinessScan(publicId, scan, capturedCompanies, job.worker ?? 'unknown-worker');
        searchReportId = repaired.reportId;
        durable = await db.searchResult(searchReportId);
        if (!durable || durable.companies.length < expected) throw new Error(`verification found ${durable?.companies.length ?? 0} of ${expected} companies`);
        recovered = true;
        await db.logEvent({ reportId, publicId, jobId: job.id, stage: 'business_search', event: 'business_search.server_recovered', detail: { companies: capturedCompanies.length, linked: repaired.linked, worker_error: workerSaveError || null } });
      }
    } catch (saveError) {
      const recoveryError = (saveError as Error).message ?? String(saveError);
      const error = `Scan captured ${capturedCompanies.length} businesses, but hub database save failed: ${recoveryError}`
        + (workerSaveError ? `. Legacy worker save also failed: ${workerSaveError}` : '');
      console.error(`[business_search.save_failed] report=${publicId} job=${job.id}: ${error}`);
      await db.logEvent({ reportId, publicId, jobId: job.id, stage: 'business_search', event: 'business_search.save_failed', detail: { companies: capturedCompanies.length, worker_error: workerSaveError || null, server_error: recoveryError } });
      await db.updateReport(publicId, { status: 'partial', result: { ...captured, scan_metadata: { ...captured.scan_metadata, recovery_error: recoveryError } }, error, completed: true });
      return;
    }
    const result = { search: durable!.report, companies: durable!.companies, scan_metadata: {
      ...captured.scan_metadata, recovered,
    } };
    await db.updateReport(publicId, {
      status: 'completed', searchReportId,
      result, error: null,
      completed: true,
    });
    // Mark the new leads before anything can queue research on them.
    // A taman already given to a telemarketer then gets its new leads, apart
    // from the ones the blacklist just made do-not-call.
    void db.applyLeadBlacklist()
      .catch((e: Error) => console.warn('[blacklist] could not check new leads: ' + e.message))
      .then(() => db.assignScanLeadsToTamanOwner(publicId, place))
      .then((r) => { if (r?.updated) console.log(`[territories] ${r.updated} new leads at ${r.taman} assigned to ${r.assignedTo}`); })
      .catch((e: Error) => console.warn(`[territories] could not assign new leads from ${place} to the taman's telemarketer: ${e.message}`));
  } catch (err) {
    console.error(`[business_search.failed] report=${publicId}: ${(err as Error).stack ?? String(err)}`);
    await db.updateReport(publicId, { status: 'failed', error: (err as Error).message ?? String(err), completed: true }).catch(() => {});
  } finally {
    active.delete(publicId);
  }
}

/**
 * Save a captured business list into its report and complete the report. The
 * repair route and a late worker result both finish a report this way.
 */
async function completeFromSnapshot(publicId: string, snapshot: Record<string, unknown>, worker?: string) {
  const companies = rows(snapshot.companies);
  const saved = await db.persistBusinessScan(publicId, object(snapshot.search), companies, worker);
  const durable = await db.searchResult(saved.reportId);
  const expected = new Set(companies.filter((c) => str(c.name).trim()).map(db.scanPlaceKey)).size;
  if (!durable || durable.companies.length < expected) throw new Error(`verification found ${durable?.companies.length ?? 0} of ${expected} businesses`);
  const result = { ...snapshot, search: durable.report, companies: durable.companies, scan_metadata: { ...object(snapshot.scan_metadata), recovered: true, recovery_error: null } };
  const updated = await db.updateReport(publicId, { status: 'completed', searchReportId: saved.reportId, result, error: null, completed: true });
  return { updated, saved };
}

/**
 * A gmap.scan result that came back after the broker lost its job. A Gmap Local
 * Worker scan runs up to 20 minutes, and a hub restart in that window empties
 * the job table and marks the report abandoned: the PC's answer then had nowhere
 * to go, and on 2026-11-01 twelve finished scans were thrown away like that. The
 * worker names the report it scanned for, so while that report has no finished
 * list, the scan completes it.
 */
export async function acceptLateBusinessScan(publicId: string, jobId: string, worker: string, scan: Record<string, unknown>): Promise<{ status: number; body: Record<string, unknown> }> {
  const report = await db.getReport(publicId);
  if (!report || report.report_type !== 'business_search') return { status: 404, body: { error: 'no business list report ' + publicId } };
  if (report.status === 'completed') return { status: 409, body: { error: 'report ' + publicId + ' already has its list' } };
  if (active.has(publicId)) return { status: 409, body: { error: 'report ' + publicId + ' is running again with a newer job' } };
  if (!Array.isArray(scan.businesses)) return { status: 400, body: { error: 'the result has no businesses array' } };
  active.add(publicId);
  try {
    const search = { ...scan };
    delete search.businesses;
    const snapshot = { search, companies: rows(scan.businesses), scan_metadata: {
      late_result: true, job_id: jobId, worker, capped: scan.capped,
      took_ms: typeof scan.tookMs === 'number' ? scan.tookMs : null,
    } };
    await db.updateReport(publicId, { status: 'partial', result: snapshot, error: 'Late worker result loaded; database save in progress', jobId });
    const { saved } = await completeFromSnapshot(publicId, snapshot, worker);
    await db.logEvent({ reportId: report.id, publicId, jobId, stage: 'business_search', event: 'business_search.late_result_saved', detail: { worker, companies: saved.companies, linked: saved.linked } });
    const place = str(object(report.request).place).trim();
    void db.applyLeadBlacklist()
      .catch((e: Error) => console.warn('[blacklist] could not check new leads: ' + e.message))
      .then(() => db.assignScanLeadsToTamanOwner(publicId, place))
      .catch((e: Error) => console.warn(`[territories] could not assign new leads from ${place} to the taman's telemarketer: ${e.message}`));
    return { status: 200, body: { saved: true, reportPublicId: publicId, companies: saved.companies, linked: saved.linked } };
  } catch (err) {
    const detail = (err as Error).message ?? String(err);
    console.error(`[business_search.late_result_failed] report=${publicId} job=${jobId}: ${detail}`);
    await db.updateReport(publicId, { status: 'partial', error: `Late worker result could not be saved: ${detail}` }).catch(() => {});
    return { status: 500, body: { error: detail } };
  } finally {
    active.delete(publicId);
  }
}

type PersonResearchLaunch = {
  sourceReportId: string;
  company: Record<string, unknown>;
  person: Record<string, unknown>;
  requesterId: string | null;
  identityHints?: PersonIdentityHints;
  autoTriggered: boolean;
  selectionRule?: string;
};

/**
 * The sole launcher for both POST /api/person-research and the P01 child that
 * company research creates. Keeping this shared is deliberate: the automatic
 * brief must always enter the current VIP pipeline (Pi + available
 * social scouts + independent audit), rather than preserving an older fork.
 */
async function launchPersonResearch(input: PersonResearchLaunch): Promise<db.PublishedReport> {
  const { sourceReportId, company, person, requesterId, autoTriggered } = input;
  const identityHints = input.identityHints ?? {};
  const personId = first(person, ['id']);
  if (autoTriggered) {
    const existing = await db.findPersonResearchReport(sourceReportId, personId);
    if (existing) {
      if ((existing.status === 'queued' || existing.status === 'running') && !active.has(existing.public_id)) {
        void runPersonResearch(existing.public_id, existing.id, company, person);
      }
      return existing;
    }
  }
  const personSnapshot = {
    id: personId,
    name: first(person, ['name']),
    role: first(person, ['role', 'current_role', 'position']),
    role_url: first(person, ['role_url', 'role_evidence_url', 'evidence_url']),
    relevance: first(person, ['relevance', 'why_relevant', 'outreach_relevance']),
    evidence_class: first(person, ['evidence_class', 'source_type']),
    personal_profile_url: directUrl(person.personal_profile_url) ?? null,
  };
  const request = {
    sourceReportId,
    personId,
    requesterId,
    emailProvided: Boolean(identityHints.email),
    mobileProvided: Boolean(identityHints.mobile),
    autoTriggered,
    ...(input.selectionRule ? { selectionRule: input.selectionRule } : {}),
    pipelineVersion: 'vip-pi-fb-xai-v1',
    personSnapshot,
  };
  let report: db.PublishedReport;
  try {
    report = await db.createReport({
      type: 'person_research', title: first(person, ['name']) + ' VIP brief',
      userId: str(request.requesterId) || null, request, companyId: String(company.id ?? '') || null,
    });
  } catch (err) {
    const raced = autoTriggered ? await db.findPersonResearchReport(sourceReportId, personId) : null;
    if (!raced) throw err;
    report = raced;
  }
  if (report.status === 'queued' || report.status === 'running') {
    void runPersonResearch(report.public_id, report.id, company, person, identityHints);
  }
  return report;
}

async function startAutoPersonResearch(
  sourcePublicId: string,
  company: Record<string, unknown>,
  person: Record<string, unknown>,
  companyRequest: Record<string, unknown>,
): Promise<db.PublishedReport> {
  return launchPersonResearch({
    sourceReportId: sourcePublicId,
    company,
    person,
    requesterId: str(companyRequest.requesterId || companyRequest.userId) || null,
    autoTriggered: true,
    selectionRule: 'company_report_p01',
  });
}

async function runCompanyResearch(
  publicId: string,
  reportId: string,
  company: Record<string, unknown>,
  companyRequest: Record<string, unknown>,
): Promise<void> {
  if (active.has(publicId)) return;
  active.add(publicId);
  const parsedForLedger: Record<string, unknown>[] = [];
  // Why rounds produced nothing, and how many produced something. The count is
  // the load-bearing half: see publishOutcome.
  const failures: string[] = [];
  let produced = 0;
  let autoPersonResearch: Record<string, unknown> | null = null;
  // Set the moment the English dossier is out. After that, nothing below may
  // demote the report to `failed` -- see the catch at the end of this function.
  let published = false;
  const triggerAutoPersonResearch = async (): Promise<void> => {
    if (autoPersonResearch) return;
    const topPerson = highestRankedPerson(company, parsedForLedger);
    if (!topPerson) {
      // Say so. This used to return in silence, so a company report simply had no
      // VIP brief and nothing anywhere explained why.
      autoPersonResearch = {
        selection_rule: 'company_report_p01',
        not_started: 'No person had been validated at the time the people audit finished, so there was no P01 to research.',
      };
      return;
    }
    try {
      const child = await startAutoPersonResearch(publicId, company, topPerson, companyRequest);
      autoPersonResearch = {
        report_id: child.public_id,
        person_id: first(topPerson, ['id']),
        person_name: first(topPerson, ['name']),
        selection_rule: 'company_report_p01',
        started_before_company_completion: true,
      };
    } catch (err) {
      autoPersonResearch = {
        person_id: first(topPerson, ['id']),
        person_name: first(topPerson, ['name']),
        selection_rule: 'company_report_p01',
        start_error: (err as Error).message ?? String(err),
      };
    }
  };
  try {
    await db.updateReport(publicId, { status: 'running', error: null });
    await db.initResearchRun(reportId);

    // Round 03 takes the same company record the run was started with and crawls
    // Facebook on the mini's job queue. It reads nothing Round 01 or Round 02
    // produce, and it runs on a different machine down a different lane -- so
    // awaiting it in file order was buying nothing and costing its whole duration
    // (159s on the run this was measured against). Started here, it overlaps the
    // Pi rounds and is collected below, before the ledger is
    // built. `catch` is attached immediately so a rejection while nobody is
    // awaiting it cannot become an unhandled rejection.
    // Stamped inside the chain, not at collection: the round finishes while
    // Round 01 is still running, and `Date.now()` at the point we get round to
    // awaiting it would report the overlap as if Facebook had been slow.
    const r3started = Date.now();
    const r3Pending = round03Facebook(company)
      .then((value) => ({ ok: true as const, value, ms: Date.now() - r3started }))
      .catch((error: unknown) => ({ ok: false as const, error: error as Error, ms: Date.now() - r3started }));

    try {
      // Do not pin to the mini: it is opportunistic capacity and can be offline.
      // The gateway chooses a live mini when present and otherwise a ready container.
      const r1 = await ask('pi', round01Prompt(company), 420_000);
      if (r1.parsed) {
        for (const row of [...rows(r1.parsed.contacts), ...rows(r1.parsed.people), ...rows(r1.parsed.candidate_people), ...rows(r1.parsed.signals)]) row._round = 'round01';
        parsedForLedger.push(r1.parsed);
        produced += 1;
      } else failures.push(r1.parse_error ?? 'Round 01 returned no JSON object.');
      await db.saveRound(reportId, 'round01', r1, r1.parsed ? 'completed' : 'invalid_output', { model: r1.model, engine: r1.engine, ms: r1.ms, queued_ms: r1.queued_ms, wall_ms: r1.wall_ms });
    } catch (err) {
      failures.push((err as Error).message ?? String(err));
      await db.saveRound(reportId, 'round01', { error: (err as Error).message }, 'failed', { model: 'pi' });
    }

    const r1Context = parsedForLedger[0] ?? { contacts: [], people: [], signals: [] };
    const round02: Record<string, unknown> = { calls: {} };
    const KINDS = ['contacts', 'people', 'signals'] as const;
    // The three audits read the same Round 01 context and write nothing the other
    // two read, so they go out together. Pi's lane is wide enough (PI_MAX_CONCURRENT)
    // for all three at once.
    const settled = await Promise.all(KINDS.map(async (kind) => {
      try {
        return { kind, call: await ask('pi', round02Prompt(kind, company, r1Context), 300_000) };
      } catch (err) {
        return { kind, error: err as Error };
      }
    }));
    // Collected in KINDS order, not completion order. `buildLedger` dedupes across
    // sources and first-seen wins, so letting whichever call finished first land
    // first would make the published rows depend on network timing.
    for (const outcome of settled) {
      const { kind } = outcome;
      if (outcome.error) {
        failures.push(outcome.error.message ?? String(outcome.error));
        object(round02.calls)[kind] = { error: outcome.error.message };
        continue;
      }
      const call = outcome.call;
      object(round02.calls)[kind] = call;
      if (call.parsed) {
        for (const row of [...rows(call.parsed[kind]), ...(kind === 'people' ? rows(call.parsed.candidate_people) : [])]) row._round = 'round02';
        parsedForLedger.push(call.parsed);
        produced += 1;
      } else failures.push(call.parse_error ?? 'Round 02 ' + kind + ' returned no JSON object.');
    }
    // Was triggered the moment the people audit landed, to overlap the signals
    // call. All three now finish together, so there is no longer an earlier
    // moment to seize -- it still starts before the company report completes.
    await triggerAutoPersonResearch();
    const r2Ok = Object.values(object(round02.calls)).some((v) => object(v).parsed);
    await db.saveRound(reportId, 'round02', round02, r2Ok ? (failures.length ? 'partial' : 'completed') : 'failed', { model: 'pi', split_calls: 3 });

    // Collected, not started, here: by now it has usually already finished.
    const r3Settled = await r3Pending;
    if (r3Settled.ok) {
      const r3 = r3Settled.value;
      // Reaching a verdict is this round doing its job, so a confirmed "this
      // business has no Facebook page" counts as output exactly as a page full of
      // contacts does. Only a lane that was not there to ask produces nothing.
      if (r3.status !== 'skipped') produced += 1;
      if (r3.parsed) parsedForLedger.push(r3.parsed);
      else if (r3.status === 'skipped') failures.push(str(r3.artifact.access_evidence));
      await db.saveRound(reportId, 'round03', r3.artifact, r3.status, {
        model: 'fb.company@mini', engine: 'fb-recon', ms: r3Settled.ms,
        access_mode: str(r3.artifact.access_mode) || null,
      });
    } else {
      failures.push(r3Settled.error.message ?? String(r3Settled.error));
      // A failed round is a round: it gets the same shape as a successful one.
      // This used to store `{ error }` alone -- five frames of our own rethrow
      // chain and nothing about the cause -- while round01 and round04 stored
      // ms, model and engine beside their output.
      await db.saveRound(reportId, 'round03', {
        error: r3Settled.error.message,
        error_code: (r3Settled.error as Error & { code?: string }).code ?? null,
        failed_at: new Date().toISOString(),
      }, 'failed', { model: 'fb.company@mini', engine: 'fb-recon', ms: r3Settled.ms });
    }

    const ledger = buildLedger(company, parsedForLedger);
    let finalReport: Record<string, unknown> = { ...ledger, summary: null, outreach_angles: [], synthesis_mode: 'validated_ledger_fallback' };
    let r4Artifact: Record<string, unknown>;
    try {
      const r4 = await ask('pi', round04Prompt(ledger), 420_000);
      // Repair formatting, then judge integrity, then publish the repaired
      // object -- not the raw one, and not nothing.
      const r4Final = r4.parsed ? normaliseUrls(r4.parsed) : null;
      const fidelityErrors = r4Final ? validateFinal(r4Final, ledger) : [r4.parse_error ?? 'invalid final output'];
      if (r4Final && !fidelityErrors.length) {
        finalReport = { ...r4Final, synthesis_mode: 'pi_validated' };
        produced += 1;
      } else {
        // The rows stay canonical -- an integrity failure means the model altered
        // the record, and the ledger is what we trust. But its PROSE is not the
        // record, and deleting the summary as collateral left the reader with a
        // wall of rows and no reading of them. Keep it, labelled unverified,
        // beside the errors that made it unverified.
        if (r4Final) {
          finalReport = {
            ...finalReport,
            summary: r4Final.summary ?? null,
            outreach_angles: r4Final.outreach_angles ?? [],
            synthesis_mode: 'validated_ledger_with_unverified_summary',
            synthesis_warning: 'Rows below are the validated ledger. The summary and outreach angles come from a synthesis that failed fidelity checks and are unverified: '
              + fidelityErrors.join('; '),
            synthesis_fidelity_errors: fidelityErrors,
          };
        }
        failures.push('Final synthesis rejected: ' + fidelityErrors.join(', ') + '.');
      }
      r4Artifact = { ...r4, fidelity_errors: fidelityErrors, fallback_used: fidelityErrors.length > 0 };
      await db.saveRound(reportId, 'round04', r4Artifact, fidelityErrors.length ? 'rejected_fallback_used' : 'completed', { model: r4.model, engine: r4.engine, ms: r4.ms, queued_ms: r4.queued_ms, wall_ms: r4.wall_ms });
    } catch (err) {
      failures.push((err as Error).message ?? String(err));
      r4Artifact = { error: (err as Error).message, fallback_used: true };
      await db.saveRound(reportId, 'round04', r4Artifact, 'failed_fallback_used', { model: 'pi' });
    }
    if (autoPersonResearch) finalReport = { ...finalReport, auto_person_research: autoPersonResearch };
    await db.saveFinal(reportId, ledger, finalReport);

    // PUBLISH HERE. The English dossier is finished, validated and saved at this
    // line; everything below it is the Chinese edition, which is a second
    // document and not a precondition for reading the first.
    //
    // It used to be awaited before the report ever left `running`, and on run
    // 2rO7nzyANyjYDpfOf0mQ that was 232 seconds -- 28% of the run -- during
    // which a complete dossier sat in the database while the portal showed a
    // spinner, and at the end of which the translation failed anyway. Nobody
    // waiting for a company report is waiting for the translation of it.
    const englishOutcome = publishOutcome(produced, failures);
    await db.updateReport(publicId, {
      status: englishOutcome.status, result: finalReport, error: englishOutcome.error, completed: true,
    });
    published = true;

    try {
      const cn = await translateChinese(finalReport);
      await db.saveTranslation(reportId, cn.translated, {
        language: 'zh-CN', model: cn.model, ms: cn.ms,
        status: cn.validation_errors.length ? 'completed_with_discrepancies' : 'completed',
        ...(cn.validation_errors.length ? { validation_errors: cn.validation_errors } : {}),
      });
      // Publishing an imperfect translation is not the same as publishing a clean
      // one, so the report says so -- but the Chinese text is delivered either way.
      if (cn.validation_errors.length) {
        failures.push('Chinese translation published with discrepancies: ' + cn.validation_errors.join('; '));
      }
    } catch (err) {
      // Do not silently label an English-only dossier as bilingual. The English
      // evidence report stays publishable, but callers receive a visible gap and
      // the durable run records why Chinese content is not present.
      //
      // Recorded as a `failures` entry rather than a `hadFailure` flag so it runs
      // through publishOutcome with every other gap: a missing translation is a
      // reason for `partial`, and only "no round produced anything" is `failed`.
      failures.push('Chinese translation failed: ' + ((err as Error).message ?? String(err)));
      await db.saveTranslation(reportId, {}, {
        language: 'zh-CN', model: process.env.TRANSLATION_MODEL?.trim() || 'pi',
        status: 'failed', error: (err as Error).message ?? String(err),
      });
    }
    // Re-grade only if the translation added a gap. The report is already
    // published and already readable; this is the status catching up with what
    // happened after it was, and it is deliberately not allowed to promote a
    // report -- `failures` only ever grows.
    const outcome = publishOutcome(produced, failures);
    if (outcome.status !== englishOutcome.status || outcome.error !== englishOutcome.error) {
      await db.updateReport(publicId, {
        status: outcome.status, result: finalReport, error: outcome.error, completed: true,
      });
    }
  } catch (err) {
    // Only before the dossier is out. Once the report is published, a throw from
    // the translation phase below it is a missing Chinese edition -- overwriting
    // a finished report with `status: failed` on the strength of that would
    // destroy the thing the run exists to produce.
    if (published) return;
    await db.updateReport(publicId, { status: 'failed', error: (err as Error).message ?? String(err), completed: true }).catch(() => {});
  } finally {
    active.delete(publicId);
  }
}

/**
 * Ads research -- what a company is actually advertising, on Facebook and Google.
 *
 * The capture is done by the `ads.*` worker at home, which drives ego lite; nothing
 * here calls a model. A network that is offline or returns nothing is recorded and the
 * run continues, because half a report is worth more than none.
 */
async function runAdsResearch(
  publicId: string,
  reportId: string,
  request: Record<string, unknown>,
): Promise<void> {
  if (active.has(publicId)) return;
  active.add(publicId);
  try {
    await db.updateReport(publicId, { status: 'running', error: null });
    await db.initAdsResearchRun(reportId);

    const name = str(request.name);
    const payload = {
      name,
      region: str(request.region) || 'MY',
      fbMax: num(request.fbMax, 0),
      gMax: num(request.gMax, 30),
      timeoutMs: 900_000,
    };

    // A type no lane is claiming would leave the job pending until it timed out.
    // Saying so up front costs the run nothing and reads honestly in the report.
    if (!jobs.liveTypes().includes('ads.company')) {
      // FAILED, not partial, and no ads array at all. A `partial` report holding
      // an empty list is indistinguishable from "this advertiser runs no ads" --
      // which is exactly how four mega-advertiser reports once came back reading
      // as true negatives. A machine that is not plugged in is an error.
      await db.saveAdsResearchRun(reportId, {
        status: { ads: 'worker_offline' },
        finalReport: { company: name, unavailable: true,
          note: 'No worker is claiming ads.company, so no ad library was opened. This is a capture failure, not a finding about this company.' },
        completed: true,
      });
      await db.updateReport(publicId, {
        status: 'failed',
        error: 'No worker is claiming ads.company — the ads crawler on the mini is offline. Nothing was captured; this says nothing about whether the company advertises.',
      });
      return;
    }

    let captured: Record<string, unknown> = {};
    let failure: string | null = null;
    try {
      // runJob already unwraps to the worker's return value (see its last line), and
      // ads.mjs returns a FLAT record -- unlike fb.mjs, which returns an envelope with
      // its own nested `result`. Reading `.result` here gave undefined, so a crawl that
      // found 13 ads with 13 creatives was stored as {} / {} / [] and published as a
      // clean "0 ads" report. The empty-is-a-finding rule made the bug invisible.
      captured = await runJob('ads.company', payload, 900_000);
    } catch (err) {
      failure = (err as Error).message ?? String(err);
    }

    if (failure) {
      await db.saveAdsResearchRun(reportId, {
        status: { ads: 'failed' },
        finalReport: { company: name, unavailable: true, note: 'The ads crawl failed: ' + failure },
        completed: true,
      });
      await db.updateReport(publicId, { status: 'failed', error: 'ads crawl failed: ' + failure });
      return;
    }

    const facebook = object(captured.facebook);
    const google = object(captured.google);
    const ads = rows(captured.ads);
    const status = {
      ads: 'completed',
      facebook: facebook.error ? str(facebook.error) : 'completed',
      google: google.error ? str(google.error) : 'completed',
    };

    const final = {
      company: name,
      region: payload.region,
      ad_count: ads.length,
      networks: { facebook: num(facebook.ads_found, 0), google: num(google.ads_found, 0) },
      creatives: num(captured.creatives_ok, 0),
      creatives_skipped: num(captured.creatives_skipped, 0),
      ads,
    };

    await db.saveAdsResearchRun(reportId, {
      facebook, google, ads: { items: ads },
      status,
      metadata: { worker: 'ads.company', region: payload.region },
      finalReport: final,
      completed: true,
    });
    // Zero ads AFTER a real crawl is a genuine finding, so it completes.
    await db.updateReport(publicId, {
      status: ads.length ? 'completed' : 'partial', error: null,
      result: final, completed: true,
    });
  } catch (err) {
    await db.updateReport(publicId, { status: 'failed', error: (err as Error).message ?? String(err) });
  } finally {
    active.delete(publicId);
  }
}

/**
 * Country name -> Ad Library region code. The form offers a country; the library
 * takes ISO-3166 alpha-2. An unknown name falls back to MY rather than erroring:
 * the default is Malaysia and a typo should not lose the run.
 */
function countryToRegion(input: string): string {
  const raw = str(input).trim();
  if (!raw) return 'MY';
  if (/^[A-Za-z]{2}$/.test(raw)) return raw.toUpperCase();
  const map: Record<string, string> = {
    malaysia: 'MY', singapore: 'SG', indonesia: 'ID', thailand: 'TH', philippines: 'PH',
    vietnam: 'VN', 'viet nam': 'VN', brunei: 'BN', cambodia: 'KH', myanmar: 'MM',
    'hong kong': 'HK', taiwan: 'TW', china: 'CN', japan: 'JP', 'south korea': 'KR',
    india: 'IN', australia: 'AU', 'new zealand': 'NZ', 'united kingdom': 'GB', uk: 'GB',
    'united states': 'US', usa: 'US', us: 'US', canada: 'CA',
  };
  return map[raw.toLowerCase()] ?? 'MY';
}

/**
 * Keyword market research: fetch every live ad matching the keywords, then write
 * one report from the rollup.
 *
 * TWO STAGES, REPORTED SEPARATELY. The crawl is ~90s and the write is ~95s, and
 * they fail for completely different reasons -- a browser lock on the mini versus
 * a model call. Collapsing them into one status makes a failed WRITE look like a
 * failed capture, and the captured ads are the expensive half. So a run whose
 * fetch succeeded and whose report failed is `partial` with the digest intact,
 * never `failed`: the numbers are all there and only the prose is missing.
 */
async function runAdsMarket(
  publicId: string,
  reportId: string,
  request: Record<string, unknown>,
): Promise<void> {
  if (active.has(publicId)) return;
  active.add(publicId);
  try {
    // NOT rows(): that helper keeps only objects, so an array of plain strings
    // comes back empty. Caught in production on the first real request -- the row
    // stored keywords [] and the job would have been dispatched with none.
    const keywords = Array.isArray(request.keywords)
      ? request.keywords.map((k) => str(k).trim()).filter(Boolean)
      : [];
    const region = str(request.region) || 'MY';
    await db.updateReport(publicId, { status: 'running', error: null });
    await db.initAdsMarketRun(reportId, keywords, region);

    // A type no lane is claiming would sit pending until it timed out. Say so now.
    if (!jobs.liveTypes().includes('ads.market')) {
      await db.saveAdsMarketRun(reportId, {
        status: { fetch: 'worker_offline' },
        adsTotal: 0,
        completed: true,
      });
      await db.updateReport(publicId, {
        status: 'failed',
        error: 'No worker is claiming ads.market — the ads crawler on the mini is offline. Nothing was captured; this says nothing about whether this market is advertised in.',
      });
      return;
    }

    const payload = {
      keywords,
      region,
      pages: num(request.pages, 12),
      effort: str(request.effort) || 'high',
      timeoutMs: 1_500_000,
    };

    let captured: Record<string, unknown> = {};
    try {
      // ads.mjs returns a FLAT record, not an envelope with a nested `result` --
      // the same shape ads.company returns, and the same place a previous version
      // of this feature silently stored {} by reading `.result`.
      captured = await runJob('ads.market', payload, 1_500_000);
    } catch (err) {
      const failure = (err as Error).message ?? String(err);
      await db.saveAdsMarketRun(reportId, {
        status: { fetch: 'failed' }, adsTotal: 0, completed: true,
      });
      await db.updateReport(publicId, { status: 'failed', error: 'ads market crawl failed: ' + failure });
      return;
    }

    const digest = object(captured.digest);
    const totals = object(digest.totals);
    const fetchStats = object(captured.fetch_stats);
    const reportHtml = str(captured.report_html) || null;
    const adsTotal = num(totals.ads, 0);
    // Truncated is per keyword in the worker's stats; ANY keyword hitting its cap
    // means the market is bigger than what was captured.
    const truncated = Object.values(fetchStats).some(
      (v) => object(v as Record<string, unknown>).truncated === true,
    );

    const final = {
      keywords,
      region,
      country: str(request.country) || 'Malaysia',
      ads: adsTotal,
      ads_on_topic: num(totals.on_topic_ads, 0),
      advertisers: num(totals.advertisers, 0),
      unique_creatives: num(totals.unique_creatives, 0),
      truncated,
      has_page: !!reportHtml,
      engine: str(captured.report_engine) || null,
      model: str(captured.report_model) || null,
      // The digest travels with the report so the page can draw its own tables
      // and a reader can check any number in the prose against it.
      digest,
    };

    await db.saveAdsMarketRun(reportId, {
      fetchStats, digest, reportHtml,
      reportEngine: str(captured.report_engine) || null,
      reportModel: str(captured.report_model) || null,
      adsTotal,
      adsOnTopic: num(totals.on_topic_ads, 0),
      advertisers: num(totals.advertisers, 0),
      uniqueCreatives: num(totals.unique_creatives, 0),
      truncated,
      status: { fetch: adsTotal ? 'completed' : 'no_results', report: reportHtml ? 'completed' : 'failed' },
      metadata: { worker: 'ads.market', region, keywords },
      completed: true,
    });

    // Zero ads after a real crawl is a genuine finding about the market, so it
    // completes rather than failing. A missing report over real ads is partial.
    await db.updateReport(publicId, {
      status: adsTotal && reportHtml ? 'completed' : 'partial',
      error: adsTotal && !reportHtml ? 'the ads were captured but the teardown page failed to build — the digest and counts are intact' : null,
      result: final,
      completed: true,
    });
  } catch (err) {
    await db.updateReport(publicId, { status: 'failed', error: (err as Error).message ?? String(err) });
  } finally {
    active.delete(publicId);
  }
}

async function runPersonResearch(
  publicId: string,
  reportId: string,
  company: Record<string, unknown>,
  person: Record<string, unknown>,
  identityHints: PersonIdentityHints = {},
): Promise<void> {
  if (active.has(publicId)) return;
  active.add(publicId);
  let hadFailure = false;
  const parsedForLedger: Record<string, unknown>[] = [];
  try {
    await db.updateReport(publicId, { status: 'running', error: null });
    await db.initPersonResearchRun(reportId);
    let discoveryMetadata: Record<string, unknown> = { status: 'failed', model: process.env.VIP_RESEARCH_MODEL?.trim() || 'pi' };
    try {
      const discovery = await ask(process.env.VIP_RESEARCH_MODEL?.trim() || 'pi', personDiscoveryPrompt(company, person, identityHints), 420_000);
      if (discovery.parsed) {
        const redacted = redactIdentityHintsFromDiscovery(discovery.parsed, identityHints);
        for (const row of [...rows(redacted.contacts), ...rows(redacted.facts), ...rows(redacted.signals)]) row._round = 'person_discovery';
        parsedForLedger.push(redacted);
        discoveryMetadata = { status: 'completed', model: discovery.model, engine: discovery.engine, ms: discovery.ms };
      } else hadFailure = true;
      if (!discovery.parsed) discoveryMetadata = { status: 'invalid_output', model: discovery.model, engine: discovery.engine, ms: discovery.ms };
    } catch (err) {
      hadFailure = true;
      discoveryMetadata = { status: 'failed', model: process.env.VIP_RESEARCH_MODEL?.trim() || 'pi', error: (err as Error).message ?? String(err) };
    }

    const [facebookScout, xScout] = await Promise.all([
      runPersonScout('facebook', company, person),
      runPersonScout('x', company, person),
    ]);
    for (const [round, scout] of [['facebook_scout', facebookScout], ['xai_x_scout', xScout]] as const) {
      if (scout.failed) hadFailure = true;
      if (!scout.parsed) continue;
      for (const row of [...rows(scout.parsed.contacts), ...rows(scout.parsed.facts), ...rows(scout.parsed.signals)]) row._round = round;
      parsedForLedger.push(scout.parsed);
    }

    let auditMetadata: Record<string, unknown> = { status: 'failed', model: 'pi' };
    try {
      const audit = await ask('pi', personAuditPrompt(company, person, parsedForLedger[0] ?? {}), 300_000);
      if (audit.parsed) {
        const redacted = redactIdentityHintsFromDiscovery(audit.parsed, identityHints);
        for (const row of [...rows(redacted.contacts), ...rows(redacted.facts), ...rows(redacted.signals)]) row._round = 'person_independent_audit';
        parsedForLedger.push(redacted);
        auditMetadata = { status: 'completed', model: audit.model, engine: audit.engine, ms: audit.ms };
      } else hadFailure = true;
      if (!audit.parsed) auditMetadata = { status: 'invalid_output', model: audit.model, engine: audit.engine, ms: audit.ms };
    } catch (err) {
      hadFailure = true;
      auditMetadata = { status: 'failed', model: 'pi', error: (err as Error).message ?? String(err) };
    }

    const ledger = buildPersonLedger(company, person, parsedForLedger);
    await db.savePersonResearchRun(reportId, {
      discovery: { contacts: ledger.contacts, facts: ledger.facts, signals: ledger.signals },
      ledger,
      status: { discovery: discoveryMetadata.status, facebook_scout: facebookScout.metadata.status, xai_x_scout: xScout.metadata.status, independent_audit: auditMetadata.status },
      metadata: { discovery: discoveryMetadata, facebook_scout: facebookScout.metadata, xai_x_scout: xScout.metadata, independent_audit: auditMetadata },
    });
    let finalReport: Record<string, unknown> = { ...ledger, summary: null, research_angles: [], synthesis_mode: 'validated_ledger_fallback' };
    let synthesisMetadata: Record<string, unknown> = { status: 'failed', model: 'pi' };
    try {
      const synthesis = await ask('pi', personSynthesisPrompt(ledger), 300_000);
      // Repair formatting, then judge integrity, then publish the repaired
      // object -- not the raw one, and not nothing.
      const personFinal = synthesis.parsed ? normaliseUrls(synthesis.parsed) : null;
      const fidelityErrors = personFinal ? validatePersonFinal(personFinal, ledger) : [synthesis.parse_error ?? 'invalid final output'];
      if (personFinal && !fidelityErrors.length) {
        finalReport = { ...personFinal, synthesis_mode: 'pi_validated' };
      } else {
        hadFailure = true;
        // Same as the company report: keep the validated rows, keep the prose,
        // and say which of the two is unverified rather than binning the prose.
        if (personFinal) {
          finalReport = {
            ...finalReport,
            summary: personFinal.summary ?? null,
            research_angles: personFinal.research_angles ?? [],
            synthesis_mode: 'validated_ledger_with_unverified_summary',
            synthesis_warning: 'Facts and contacts below are the validated ledger. The summary and research angles come from a synthesis that failed fidelity checks and are unverified: '
              + fidelityErrors.join('; '),
            synthesis_fidelity_errors: fidelityErrors,
          };
        }
      }
      synthesisMetadata = { status: fidelityErrors.length ? 'rejected_fallback_used' : 'completed', model: synthesis.model, engine: synthesis.engine, ms: synthesis.ms, fidelity_errors: fidelityErrors };
    } catch (err) {
      hadFailure = true;
      synthesisMetadata = { status: 'failed', model: 'pi', error: (err as Error).message ?? String(err) };
    }
    await db.savePersonResearchRun(reportId, {
      synthesis: { synthesis_mode: finalReport.synthesis_mode, contact_count: rows(finalReport.contacts).length, fact_count: rows(finalReport.facts).length, signal_count: rows(finalReport.signals).length },
      ledger,
      finalReport,
      status: { discovery: discoveryMetadata.status, facebook_scout: facebookScout.metadata.status, xai_x_scout: xScout.metadata.status, independent_audit: auditMetadata.status, synthesis: synthesisMetadata.status },
      metadata: { discovery: discoveryMetadata, facebook_scout: facebookScout.metadata, xai_x_scout: xScout.metadata, independent_audit: auditMetadata, synthesis: synthesisMetadata },
      completed: true,
    });
    await db.updateReport(publicId, {
      status: hadFailure ? 'partial' : 'completed', result: finalReport,
      error: hadFailure ? 'VIP brief completed with a research or validation gap; only validated public-professional evidence is published.' : null,
      completed: true,
    });
  } catch (err) {
    await db.updateReport(publicId, { status: 'failed', error: (err as Error).message ?? String(err), completed: true }).catch(() => {});
  } finally {
    active.delete(publicId);
  }
}

async function runContactResearch(
  publicId: string,
  reportId: string,
  company: Record<string, unknown>,
  request: Record<string, unknown> = {},
): Promise<void> {
  if (active.has(publicId)) return;
  active.add(publicId);
  if (request.provider !== 'parallel') activeContact.add(publicId);
  try {
    await db.initContactResearchRun(reportId);

    if (request.provider === 'parallel') {
      await db.updateReport(publicId, { status: 'running', error: null });
      try {
        const found = await searchParallelPeople(company, str(request.targetRole) || null);
        const discovery = { decision_makers: found.people, phone_contacts: [], email_contacts: [], entity_set_id: found.response.entity_set_id };
        const ledger = buildContactLedger(company, discovery);
        await db.saveContactResearchRun(reportId, {
          discovery, ledger, finalReport: ledger,
          status: { discovery: 'completed' },
          metadata: { discovery: { engine: 'parallel', endpoint: 'entity-search', entity_set_id: found.response.entity_set_id, returned: Array.isArray(found.response.entities) ? found.response.entities.length : 0, accepted: found.people.length } },
          completed: true,
        });
        await db.updateReport(publicId, { status: 'completed', result: ledger, error: null, completed: true });
      } catch (err) {
        await db.updateReport(publicId, { status: 'failed', error: (err as Error).message ?? String(err), completed: true });
      }
      return;
    }

    const model = process.env.CONTACT_RESEARCH_MODEL?.trim() || 'research.contact';
    const targetRole = str(request.targetRole || request.persona) || null;

    let discoveryRaw: Record<string, unknown> | null = null;
    let discoveryMeta: Record<string, unknown> = { model, engine: autoContact.contactResearchJobType(), status: 'failed' };

    try {
      const jobType = autoContact.contactResearchJobType();
      if (jobs.isDurableContactJob(jobType)) {
        const website = str(company.website);
        const payload = {
          reportId,
          name: str(company.name),
          ...(website && !/google\.[^/]+\/(?:search|searchviewer)/i.test(website) ? { website } : {}),
          location: str(company.address),
          ...(str(company.maps_url) ? { extraUrls: [str(company.maps_url)] } : {}),
          ...(jobType === 'research.contact.cloud' ? { prompt: cloudContactResearchPrompt(company, targetRole) } : {}),
        };
        // The report is the durable slot. Store the job id before the broker
        // makes it claimable, then wait without a report deadline. The worker's
        // result route writes directly to this row, including after a restart.
        const job = jobs.create(jobType, payload, 0, false);
        try {
          await db.updateReport(publicId, { jobId: job.id });
        } catch (error) {
          jobs.cancel(job.id, 'could not link contact job to its saved report');
          throw error;
        }
        jobs.activate(job.id);
        await jobs.wait(job.id, 0);
        return;
      }
      throw new Error('contact research needs a live contact worker');
    } catch (err) {
      discoveryMeta.status = 'failed';
      discoveryMeta.error = (err as Error).message ?? String(err);
    }

    let fbData: Record<string, unknown> | null = null;
    const website = str(company.website);
    if (website.includes('facebook.com') && jobs.liveTypes().includes('fb.company')) {
      try {
        const fbLookup = await runJob('fb.company', { ...company, timeoutMs: 30_000 }, 30_000);
        fbData = object(fbLookup.result);
      } catch {
        // Opportunistic Facebook extraction; ignore error if worker unavailable
      }
    }

    const ledger = buildContactLedger(company, discoveryRaw, fbData);

    await db.saveContactResearchRun(reportId, {
      discovery: discoveryRaw ?? {},
      ledger,
      finalReport: ledger,
      status: { discovery: discoveryMeta.status },
      metadata: { discovery: discoveryMeta },
      completed: true,
    });

    const status = discoveryRaw ? 'completed' : 'failed';
    const error = discoveryRaw ? null : (str(discoveryMeta.error) || 'Contact research returned no valid findings.');

    await db.updateReport(publicId, {
      status,
      result: ledger,
      error,
      completed: true,
    });
  } catch (err) {
    await db.updateReport(publicId, { status: 'failed', error: (err as Error).message ?? String(err), completed: true }).catch(() => {});
  } finally {
    active.delete(publicId);
    activeContact.delete(publicId);
  }
}

/** Persist a worker answer against its pre-created report, independent of broker memory. */
export async function acceptContactResult(
  reportId: string,
  jobId: string,
  ok: boolean,
  raw: unknown,
  workerError: string | null,
  worker: string,
): Promise<void> {
  const report = await db.getReportById(reportId);
  if (!report || report.report_type !== 'contact_research') throw new Error('contact report slot is missing');
  if (report.job_id !== jobId) throw new Error('contact result job id does not match its report slot');
  if (report.status === 'completed') return;

  if (!ok && /individual quota reached|rate_limit_error|token plan usage|high demand|(?:^|\W)429(?:\W|$)|(?:^|\W)503(?:\W|$)|(?:^|\W)timeout(?:\W|$)|timed out|upstream error/i.test(workerError ?? '')) {
    if (await db.deferContactResult(reportId, jobId)) {
      await db.logEvent({ reportId, publicId: report.public_id, jobId, stage: 'research.contact',
        event: 'contact.deferred', detail: { worker, reason: workerError } }).catch(() => {});
    }
    return;
  }

  const company = (report.company_id ? await db.getCompany(report.company_id) : null)
    ?? object(report.request.companySnapshot);
  const discovery = ok && raw && typeof raw === 'object' && !Array.isArray(raw)
    ? object(raw) : null;
  const ledger = buildContactLedger(company, discovery);
  const succeeded = ok && discovery !== null;
  const error = succeeded ? null : (workerError || 'Worker returned no contact research result.');
  if (await db.finalizeContactResult({ reportId, jobId, discovery: discovery ?? {},
    ledger, succeeded, error, worker })) {
    await db.logEvent({ reportId, publicId: report.public_id, jobId, stage: 'research.contact',
      event: succeeded ? 'contact.completed' : 'contact.failed',
      detail: { worker, error } }).catch(() => {});
  }
}

/** Reattach saved contact reports to the live broker, at worker capacity. */
/**
 * Open contact reports whose broker job is gone.
 *
 * Broker jobs live in memory, so a hub restart erases every job a `running`
 * report was waiting on. Recovery only re-runs `queued` reports, and the
 * auto-queue counts `queued` and `running` reports as work in flight, so before
 * this, 27 orphans sat at `running` for two days and kept the auto-queue at zero
 * while 10,938 leads waited. A report is orphaned when no run in this process
 * owns it and its job is missing or finished; a `queued` report with no job is
 * already waiting for recovery and is left alone.
 */
export function orphanedContactReports(
  open: Array<{ public_id: string; job_id: string | null; status: string }>,
  active: Set<string>,
  getJob: (id: string) => { status: string } | null,
): string[] {
  return open.filter((report) => {
    if (active.has(report.public_id)) return false;
    if (report.status === 'queued' && !report.job_id) return false;
    const job = report.job_id ? getJob(report.job_id) : null;
    return !job || (job.status !== 'pending' && job.status !== 'running');
  }).map((report) => report.public_id);
}

/** Recovery runs as many reports at once as the contact worker has lanes. */
const CONTACT_RECOVERY_WIDTH = contactWorker.resolveConfig().lanes;

export async function resumeContactResearch(maxConcurrent = CONTACT_RECOVERY_WIDTH): Promise<number> {
  if (recoveringContact || !jobs.liveTypes().includes(autoContact.contactResearchJobType())) return 0;
  recoveringContact = true;
  try {
    // Two minutes of grace: a report links its job id a moment after the job is created.
    const orphans = orphanedContactReports(await db.openContactReports(2), activeContact, jobs.get);
    if (orphans.length) {
      const requeued = await db.requeueContactReports(orphans);
      console.log(`[contact] requeued ${requeued} report(s) whose job was lost`);
    }
    const slots = Math.max(0, maxConcurrent - activeContact.size);
    if (!slots) return 0;
    const pending = await db.recoverableContactReports(slots, [...activeContact]);
    for (const report of pending) {
      const company = (report.company_id ? await db.getCompany(report.company_id) : null)
        ?? object(report.request.companySnapshot);
      if (!str(company.name)) {
        await db.updateReport(report.public_id, { status: 'failed', error: 'Company data missing; cannot resume contact research.', completed: true });
        continue;
      }
      void runContactResearch(report.public_id, report.id, company, report.request);
    }
    return pending.length;
  } finally {
    recoveringContact = false;
  }
}

async function publicDetail(report: db.PublishedReport): Promise<Record<string, unknown>> {
  if (report.report_type === 'business_search') {
    const search = report.source_search_report_id ? await db.searchResult(report.source_search_report_id) : null;
    return { report, search: search?.report ?? report.result?.search ?? null, companies: search?.companies ?? report.result?.companies ?? [] };
  }
  if (report.report_type === 'contact_research') {
    const run = await db.contactResearchRun(report.id);
    return { report, final: report.result, contact_run: run };
  }
  const run = report.report_type === 'company_research' ? await db.researchRun(report.id) : null;
  const chinese = object(run?.translated_report);
  return {
    report,
    final: report.result,
    // Kept separate from final so existing EN clients retain their exact shape.
    final_cn: Object.keys(chinese).length ? chinese : null,
    translation: report.report_type === 'company_research' ? object(run?.translation_metadata) : null,
  };
}

async function contactComparisonId(companyId: string, raw: unknown): Promise<string | null> {
  const publicId = str(raw).trim();
  if (!/^[A-Za-z0-9_-]{20}$/.test(publicId)) return null;
  const previous = await db.getReport(publicId);
  return previous?.report_type === 'contact_research' && previous.company_id === companyId
    ? previous.public_id : null;
}

async function personResearchInput(report: db.PublishedReport): Promise<{ company: Record<string, unknown>; person: Record<string, unknown> } | null> {
  const request = object(report.request);
  const sourceId = str(request.sourceReportId);
  const personId = str(request.personId);
  if (!sourceId || !personId || !report.company_id) return null;
  const [source, company] = await Promise.all([db.getReport(sourceId), db.getCompany(report.company_id)]);
  if (!source || source.report_type !== 'company_research' || !company) return null;
  const person = rows(source.result?.people).find((row) => first(row, ['id']) === personId) ?? object(request.personSnapshot);
  if (first(person, ['id']) !== personId || !first(person, ['name']) || !first(person, ['role', 'current_role', 'position'])) return null;
  return person ? { company, person } : null;
}

/** A requester opening/polling a queued report also revives work after a deploy. */
async function ensureRunning(report: db.PublishedReport): Promise<void> {
  if ((report.status !== 'queued' && report.status !== 'running') || active.has(report.public_id)) return;
  if (report.report_type === 'business_search') {
    void runBusinessSearch(report.public_id, report.id, object(report.request));
    return;
  }
  if (report.report_type === 'person_research') {
    const input = await personResearchInput(report);
    if (input) void runPersonResearch(report.public_id, report.id, input.company, input.person);
    return;
  }
  if (report.report_type === 'contact_research') {
    // A claimed contact job may still be running on a PC after this hub restarts.
    // Opening its report must never replace its job id and reject that late result.
    if (report.status === 'running') return;
    const company = report.company_id ? await db.getCompany(report.company_id) : object(object(report.request).companySnapshot);
    if (company) void runContactResearch(report.public_id, report.id, company, object(report.request));
    return;
  }
  if (report.company_id) {
    const company = await db.getCompany(report.company_id);
    if (company) void runCompanyResearch(report.public_id, report.id, company, object(report.request));
  }
}

/** handlePublic sits outside the authed router, so it has no Ctx to answer with. */
function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

/** Same reason, for the request side. Capped because this route is unauthenticated. */
async function readBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > 8192) throw new Error('request body too large');
    chunks.push(c as Buffer);
  }
  if (!chunks.length) return {};
  try {
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export async function handlePublic(req: http.IncomingMessage, res: http.ServerResponse, url: URL): Promise<boolean> {
  const p = url.pathname;
  const pageMatch = /^\/r\/([A-Za-z0-9_-]{20})$/.exec(p);
  // The trail is part of the report, so it lives behind the same capability: the
  // opaque id IS the permission, exactly as for the report page itself.
  const logMatch = /^\/r\/([A-Za-z0-9_-]{20})\/log$/.exec(p);
  const jsonMatch = /^\/public\/reports\/([A-Za-z0-9_-]{20})$/.exec(p);
  const researchMatch = /^\/public\/reports\/([A-Za-z0-9_-]{20})\/research$/.exec(p);
  const contactResearchMatch = /^\/public\/reports\/([A-Za-z0-9_-]{20})\/contact-research$/.exec(p);
  const parallelContactMatch = /^\/public\/reports\/([A-Za-z0-9_-]{20})\/parallel-contact-research$/.exec(p);

  // Start contact research from the shared report page.
  if ((req.method ?? 'GET') === 'POST' && (contactResearchMatch || parallelContactMatch)) {
    if (!db.configured()) return sendJson(res, 503, { error: 'reports are not configured' }), true;
    if (parallelContactMatch && !(await secrets.load(), secrets.get('parallel'))) return sendJson(res, 503, { error: 'No Parallel key: add one on /workers' }), true;
    const parent = await db.getReport((contactResearchMatch || parallelContactMatch)![1]!);
    if (!parent || parent.report_type !== 'business_search') {
      return sendJson(res, 404, { error: 'report not found' }), true;
    }
    const body = await readBody(req);
    const companyId = str(body.companyId || body.company_id).trim();
    const listed = parent.source_search_report_id
      ? await db.searchResult(parent.source_search_report_id)
      : null;
    // The page falls back to the snapshot the report published with when the
    // search row is gone (see the GET branch below) — validate against that
    // same list, or every button it rendered would 404 here.
    const company = (listed?.companies ?? rows(parent.result?.companies)).find((c) => String(c.id) === companyId);
    if (!company) {
      return sendJson(res, 404, { error: 'that company is not listed in this report', companyId }), true;
    }
    const provider = parallelContactMatch ? 'parallel' : 'legacy';
    const existing = await db.findContactReport(companyId, provider);
    if (existing) return sendJson(res, 200, { report: envelope(req, existing) }), true;
    const compareToReportId = await contactComparisonId(companyId, body.compareToReportId);
    const request = { companyId, name: str(company.name), requesterId: 'report:' + parent.public_id, provider, compareToReportId };
    const report = await db.createReport({
      type: 'contact_research', title: str(company.name, 'Company') + (provider === 'parallel' ? ' — Parallel contact research' : ' — contact & telemarketing research'),
      userId: request.requesterId, request, companyId,
    });
    void runContactResearch(report.public_id, report.id, company, request);
    return sendJson(res, 202, { report: envelope(req, report) }), true;
  }

  // Start a company dossier from the shared report page.
  //
  // WHY THIS IS NOT /api/company-research. That route is behind the bearer gate,
  // and this page is deliberately outside it — the opaque id IS the capability.
  // Putting LAB_TOKEN in a public page to reach the authed route would hand a
  // root shell on the lab to anyone holding a share link.
  //
  // The capability is scoped instead of borrowed: the companyId must already be
  // one this report lists. Holding the link lets you research the businesses in
  // it, and nothing else — an arbitrary id from elsewhere is refused.
  if ((req.method ?? 'GET') === 'POST' && researchMatch) {
    if (!db.configured()) return sendJson(res, 503, { error: 'reports are not configured' }), true;
    const parent = await db.getReport(researchMatch[1]!);
    if (!parent || parent.report_type !== 'business_search') {
      return sendJson(res, 404, { error: 'report not found' }), true;
    }
    const body = await readBody(req);
    const companyId = str(body.companyId || body.company_id).trim();
    const listed = parent.source_search_report_id
      ? await db.searchResult(parent.source_search_report_id)
      : null;
    // Same snapshot fallback as the contact route and the GET page above: the
    // buttons a reader can see are exactly the companies this validates.
    const company = (listed?.companies ?? rows(parent.result?.companies)).find((c) => String(c.id) === companyId);
    if (!company) {
      return sendJson(res, 404, { error: 'that company is not listed in this report', companyId }), true;
    }
    // One dossier per company per report. A second click — or a shared link
    // opened by three people at once — should land on the run already going,
    // not start a fourth costing four more rounds of deep research.
    const existing = await db.findCompanyReport(companyId);
    if (existing) return sendJson(res, 200, { report: envelope(req, existing) }), true;
    const request = { companyId, requesterId: 'report:' + parent.public_id };
    const report = await db.createReport({
      type: 'company_research', title: str(company.name, 'Company') + ' intelligence report',
      userId: request.requesterId, request, companyId,
    });
    void runCompanyResearch(report.public_id, report.id, company);
    return sendJson(res, 202, { report: envelope(req, report) }), true;
  }

  if ((req.method ?? 'GET') === 'GET' && logMatch) {
    if (!db.configured()) return sendJson(res, 503, { error: 'reports are not configured' }), true;
    const report = await db.getReport(logMatch[1]!);
    if (!report) {
      res.writeHead(404, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      res.end(ui.notFoundPage());
      return true;
    }
    const events = await db.listEvents({ reportId: report.id }).catch(() => []);
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex, nofollow' });
    res.end(ui.logPage(report, events));
    return true;
  }

  if ((req.method ?? 'GET') !== 'GET' || (!pageMatch && !jsonMatch)) return false;
  if (!db.configured()) {
    res.writeHead(503, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    res.end(ui.notFoundPage());
    return true;
  }
  const report = await db.getReport((pageMatch ?? jsonMatch)![1]!);
  if (!report) {
    if (jsonMatch) {
      res.writeHead(404, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      res.end(JSON.stringify({ error: 'report not found' }));
    } else {
      res.writeHead(404, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      res.end(ui.notFoundPage());
    }
    return true;
  }
  await ensureRunning(report);
  if (jsonMatch) {
    const payload = JSON.stringify(await publicDetail(report));
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(payload);
    return true;
  }
  let html: string;
  if (report.report_type === 'business_search') {
    const search = report.source_search_report_id ? await db.searchResult(report.source_search_report_id) : null;
    html = ui.searchPage(report, { report: search?.report ?? object(report.result?.search), companies: search?.companies ?? rows(report.result?.companies) });
  } else if (report.report_type === 'contact_research') html = ui.contactPage(report);
  else if (report.report_type === 'person_research') html = ui.personPage(report);
  else if (report.report_type === 'ads_research') html = ui.adsPage(report);
  else if (report.report_type === 'ads_market') {
    // The teardown IS the page. kw builds a complete self-contained document --
    // inline styles, no assets but Google Fonts -- so serving it verbatim is the
    // whole job. ui.adsMarketPage is the fallback for a run whose page failed to
    // build, so the counts still reach the reader instead of a blank screen.
    const run = await db.adsMarketRun(report.id);
    const page = run && typeof run.report_html === 'string' ? run.report_html : '';
    html = page.trim() ? page : ui.adsMarketPage(report);
  }
  else {
    const run = await db.researchRun(report.id);
    const chinese = object(run?.translated_report);
    // Which people already have a VIP brief, so the page shows a link to it
    // rather than a button that would start one.
    const briefs = await db.listPersonBriefs(report.public_id).catch(() => ({}));
    const adsReport = report.company_id ? await db.findAdsReport(report.company_id) : null;
    html = ui.companyPage(report, Object.keys(chinese).length ? chinese : null, briefs, adsReport);
  }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex, nofollow' });
  res.end(html);
  return true;
}

/**
 * Create — or find the run already in flight for — one company's contact
 * research report, and start the run in the background. Shared by the portal's
 * POST route and the auto contact research queue so both get the same per-company
 * dedupe, the same title and the same event trail. `autoQueued` marks reports
 * the queue started; the lifetime counters read exactly that flag.
 */
export async function launchContactResearch(
  company: Record<string, unknown>,
  opts: {
    provider?: 'legacy' | 'parallel';
    targetRole?: string | null;
    requesterId?: string | null;
    compareToReportId?: unknown;
    autoQueued?: boolean;
  } = {},
): Promise<{ report: db.PublishedReport; alreadyRunning: boolean }> {
  const provider = opts.provider === 'parallel' ? 'parallel' : 'legacy';
  const resolvedCompanyId = String(company.id ?? '');
  const running = await db.findContactReport(resolvedCompanyId, provider);
  if (running) return { report: running, alreadyRunning: true };
  const compareToReportId = await contactComparisonId(resolvedCompanyId, opts.compareToReportId);
  const request = {
    companyId: resolvedCompanyId,
    name: str(company.name),
    targetRole: str(opts.targetRole).trim() || null,
    requesterId: opts.requesterId ?? null,
    provider,
    compareToReportId,
    ...(opts.autoQueued === true ? { autoQueued: 'true' } : {}),
    companySnapshot: {
      id: resolvedCompanyId,
      name: company.name,
      phone: company.phone,
      website: company.website,
      address: company.address,
    },
  };
  const report = await db.createReport({
    type: 'contact_research',
    title: str(company.name, 'Company') + (provider === 'parallel' ? ' — Parallel contact research' : ' — contact & telemarketing research'),
    userId: request.requesterId,
    request,
    companyId: resolvedCompanyId,
  });
  if (provider === 'parallel') void runContactResearch(report.public_id, report.id, company, request);
  else void resumeContactResearch();
  return { report, alreadyRunning: false };
}

function extractTelemarketerUid(req: http.IncomingMessage, url: URL, body?: Record<string, unknown>, isOperator?: boolean): string {
  // 1. Header: X-Telemarketer-UID, X-Telemarketer-Id, X-Agent-Uid, X-API-Key
  const headerUid = req.headers['x-telemarketer-uid']
    || req.headers['x-telemarketer-id']
    || req.headers['x-agent-uid']
    || req.headers['x-api-key'];
  if (typeof headerUid === 'string' && headerUid.trim()) return headerUid.trim();

  // 2. Query params: ?uid=... or ?telemarketer_uid=... or ?assignedTo=... or ?telemarketer=... or ?agent=... or ?name=... or ?id=...
  const queryUid = url.searchParams.get('uid')
    || url.searchParams.get('telemarketer_uid')
    || url.searchParams.get('telemarketerUid')
    || url.searchParams.get('agent_uid')
    || url.searchParams.get('assignedTo')
    || url.searchParams.get('assigned_to')
    || url.searchParams.get('telemarketer')
    || url.searchParams.get('agent')
    || url.searchParams.get('name')
    || url.searchParams.get('id')
    || url.searchParams.get('key');
  if (queryUid && queryUid.trim()) return queryUid.trim();

  // 3. Request body: body.uid or body.telemarketer_uid or body.assignedTo etc.
  if (body) {
    const bodyUid = body.uid || body.telemarketer_uid || body.telemarketerUid || body.agent_uid
      || body.assignedTo || body.assigned_to || body.telemarketer || body.agent || body.name || body.id || body.key;
    if (typeof bodyUid === 'string' && bodyUid.trim()) return bodyUid.trim();
    if (typeof bodyUid === 'number') return String(bodyUid);
  }

  // 4. Authorization header: Bearer <uid> ONLY IF NOT an operator token
  const authHeader = req.headers.authorization ?? '';
  if (authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7).trim();
    if (token && !isOperator) return token;
  }

  return '';
}

function isLeadAssignedToAgent(
  lead: { assigned_to?: string | null; telemarketer_uid?: string | null },
  agent: { uid?: string | null; name: string }
): boolean {
  if (agent.uid && lead.telemarketer_uid) {
    const cleanAgentUid = agent.uid.replace(/^uid:/, '');
    const cleanLeadUid = lead.telemarketer_uid.replace(/^uid:/, '');
    return cleanAgentUid === cleanLeadUid;
  }
  const norm = (s?: string | null) => (s || '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (lead.assigned_to && agent.name) {
    if (norm(lead.assigned_to) === norm(agent.name)) return true;
  }
  if (agent.uid && lead.assigned_to) {
    const cleanAgentUid = agent.uid.replace(/^uid:/, '');
    const cleanLeadAssigned = lead.assigned_to.replace(/^uid:/, '');
    if (cleanAgentUid === cleanLeadAssigned) return true;
  }
  return false;
}

/**
 * Dedicated Telemarketer API.
 * Authenticated directly by Telemarketer UID (no operator key needed).
 * Allows telemarketers to read their assigned leads and update lead status / notes.
 */
export async function handleTelemarketerApi(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url: URL,
  ctx: Ctx,
): Promise<boolean> {
  const p = url.pathname;
  const method = req.method ?? 'GET';

  if (p.startsWith('/api/telemarketers')) return false;
  if (!p.startsWith('/api/telemarketer/') && p !== '/api/telemarketer' && !p.startsWith('/api/tm/') && p !== '/api/tm') return false;

  const dbi = { ...db, ...(ctx.db || {}) };

  // Normalize /api/tm/ to /api/telemarketer/
  const subPath = p.replace(/^\/api\/tm/, '/api/telemarketer');

  // 0. Active Telemarketer Roster / Directory: GET /api/telemarketer/roster or /agents or /list
  if (method === 'GET' && (subPath === '/api/telemarketer/roster' || subPath === '/api/telemarketer/agents' || subPath === '/api/telemarketer/list')) {
    const [telemarketers, agents, stats] = await Promise.all([
      dbi.listTelemarketers().catch(() => []),
      dbi.getTelemarketerDetails().catch(() => []),
      dbi.getLeadStats().catch(() => null),
    ]);
    const cleanAgents = agents.filter((a) => a.active).map((a) => ({
      ...a,
      api_url: `/api/telemarketer/${encodeURIComponent(a.uid || a.name)}/leads`,
    }));
    ctx.json(res, 200, { ok: true, telemarketers, agents: cleanAgents, stats });
    return true;
  }

  // Parse body for write methods
  let body: Record<string, unknown> = {};
  if (method === 'PATCH' || method === 'POST') {
    try {
      body = await ctx.readJson(req);
    } catch {
      body = {};
    }
  }

  // Check for path patterns:
  // 1. /api/telemarketer/:uid/leads
  // 2. /api/telemarketer/:uid/leads/:id
  // 3. /api/telemarketer/leads
  // 4. /api/telemarketer/leads/:id or /api/telemarketer/leads/:uid
  // 5. /api/telemarketer/me or /api/telemarketer/:uid/profile
  let pathUid = '';
  let leadId = '';

  const pathWithUidMatch = /^\/api\/telemarketer\/([^/]+)\/leads(?:\/(\d+))?$/.exec(subPath);
  if (pathWithUidMatch && pathWithUidMatch[1] !== 'leads') {
    pathUid = decodeURIComponent(pathWithUidMatch[1]!).replace(/^[=:]+/, '');
    leadId = pathWithUidMatch[2] || '';
  } else {
    // Alternative path /api/telemarketer/leads/:param
    const leadsParamMatch = /^\/api\/telemarketer\/leads\/([^/]+)$/.exec(subPath);
    if (leadsParamMatch) {
      const rawParam = decodeURIComponent(leadsParamMatch[1]!).replace(/^[=:]+/, '');
      if (rawParam === 'roster' || rawParam === 'list' || rawParam === 'agents') {
        const [telemarketers, agents, stats] = await Promise.all([
          dbi.listTelemarketers().catch(() => []),
          dbi.getTelemarketerDetails().catch(() => []),
          dbi.getLeadStats().catch(() => null),
        ]);
        const cleanAgents = agents.filter((a) => a.active).map((a) => ({
          ...a,
          api_url: `/api/telemarketer/${encodeURIComponent(a.uid || a.name)}/leads`,
        }));
        ctx.json(res, 200, { ok: true, telemarketers, agents: cleanAgents, stats });
        return true;
      }
      if (/\D/.test(rawParam)) {
        // Non-digits (e.g. TM-SARAH, user_5e0dc2eb25600001, 1739157684995x634812576206372600) -> telemarketer UID
        pathUid = rawParam;
      } else {
        // Pure digits: could be lead ID or telemarketer ID
        const explicitUid = extractTelemarketerUid(req, url, body, ctx.isOperator);
        if (explicitUid) {
          leadId = rawParam;
        } else {
          const candidate = await dbi.getTelemarketerByUid(rawParam).catch(() => null);
          if (candidate) {
            pathUid = rawParam;
          } else {
            leadId = rawParam;
          }
        }
      }
    }
  }

  const isOperator = !!ctx.isOperator;
  const suppliedUid = pathUid || extractTelemarketerUid(req, url, body, isOperator);

  // If operator is authenticated and no specific telemarketer was requested (or uid=all)
  if (isOperator && (!suppliedUid || suppliedUid === 'all')) {
    if (method === 'GET' && !leadId) {
      const rawStatus = url.searchParams.get('status');
      const search = url.searchParams.get('search');
      const sort = url.searchParams.get('sort');
      const limit = Number(url.searchParams.get('limit') ?? 50);
      const offset = Number(url.searchParams.get('offset') ?? 0);
      let statusFilter = rawStatus ? rawStatus.trim() : undefined;
      if (statusFilter) {
        const lower = statusFilter.toLowerCase();
        if (lower === 'pending' || lower === 'to_call' || lower === 'to call') statusFilter = 'assigned';
        else if (lower === 'dnc') statusFilter = 'do_not_call';
        else if (lower === 'not-interested' || lower === 'not interested') statusFilter = 'not_interested';
      }
      const [leadRes, stats] = await Promise.all([
        dbi.listLeads({
          status: statusFilter,
          search,
          limit,
          offset,
          sort,
        }),
        dbi.getLeadStats().catch(() => null),
      ]);
      ctx.json(res, 200, {
        ok: true,
        operator: true,
        stats,
        leads: leadRes.leads,
        total: leadRes.total,
        limit: leadRes.limit,
        offset: leadRes.offset,
      });
      return true;
    }
  }

  if (!suppliedUid) {
    ctx.json(res, 401, {
      ok: false,
      error: 'Telemarketer UID is required. Provide it via ?uid=<UID>, X-Telemarketer-UID header, Authorization: Bearer <UID>, or /api/telemarketer/:uid/leads',
    });
    return true;
  }

  if (!dbi.configured()) {
    ctx.json(res, 503, { ok: false, error: 'database is not configured' });
    return true;
  }

  const agent = await dbi.getTelemarketerByUid(suppliedUid);
  if (!agent) {
    ctx.json(res, 403, {
      ok: false,
      error: 'Invalid or inactive telemarketer UID: ' + suppliedUid,
    });
    return true;
  }

  // 1. Telemarketer Profile & Workload: GET /api/telemarketer/me or /api/telemarketer/profile
  if (method === 'GET' && (subPath === '/api/telemarketer/me' || subPath === '/api/telemarketer/profile' || /^\/api\/telemarketer\/[^/]+\/profile$/.test(subPath))) {
    const stats = await dbi.getTelemarketerStatsByUid(agent.uid || agent.name);
    ctx.json(res, 200, {
      ok: true,
      telemarketer: {
        id: agent.id,
        uid: agent.uid,
        name: agent.name,
        phone: agent.phone,
        email: agent.email,
        notes: agent.notes,
      },
      stats,
    });
    return true;
  }

  // 2. Read leads list: GET /api/telemarketer/leads or GET /api/telemarketer/:uid/leads
  if (method === 'GET' && !leadId && (subPath === '/api/telemarketer/leads' || pathWithUidMatch || /^\/api\/telemarketer\/leads\/[^/]+$/.test(subPath))) {
    const rawStatus = url.searchParams.get('status');
    const search = url.searchParams.get('search');
    const sort = url.searchParams.get('sort');
    const limit = Number(url.searchParams.get('limit') ?? 50);
    const offset = Number(url.searchParams.get('offset') ?? 0);

    // Normalize status filter if given
    let statusFilter = rawStatus ? rawStatus.trim() : undefined;
    if (statusFilter) {
      const lower = statusFilter.toLowerCase();
      if (lower === 'pending' || lower === 'to_call' || lower === 'to call') statusFilter = 'assigned';
      else if (lower === 'dnc') statusFilter = 'do_not_call';
      else if (lower === 'not-interested' || lower === 'not interested') statusFilter = 'not_interested';
      else if (lower === 'all') statusFilter = undefined;
    }

    const leadType = url.searchParams.get('leadType') || url.searchParams.get('type');
    if (leadType === 'ads' || subPath.includes('/ads-leads')) {
      const [adsRes, stats] = await Promise.all([
        dbi.listAtapSolarRegistrations({
          assignedTo: agent.uid ? 'uid:' + agent.uid : agent.name,
          status: statusFilter,
          search,
          limit,
          offset,
          sort,
        }),
        dbi.getTelemarketerStatsByUid(agent.uid || agent.name),
      ]);
      ctx.json(res, 200, {
        ok: true,
        telemarketer: {
          id: agent.id,
          uid: agent.uid,
          name: agent.name,
          phone: agent.phone,
          email: agent.email,
        },
        stats,
        leads: adsRes.leads,
        total: adsRes.total,
        limit: adsRes.limit,
        offset: adsRes.offset,
      });
      return true;
    }

    const [leadRes, stats] = await Promise.all([
      dbi.listLeads({
        assignedTo: agent.uid ? 'uid:' + agent.uid : agent.name,
        status: statusFilter,
        search,
        limit,
        offset,
        sort,
      }),
      dbi.getTelemarketerStatsByUid(agent.uid || agent.name),
    ]);

    ctx.json(res, 200, {
      ok: true,
      telemarketer: {
        id: agent.id,
        uid: agent.uid,
        name: agent.name,
        phone: agent.phone,
        email: agent.email,
      },
      stats,
      leads: leadRes.leads,
      total: leadRes.total,
      limit: leadRes.limit,
      offset: leadRes.offset,
    });
    return true;
  }

  // 3. Read single lead detail: GET /api/telemarketer/leads/:id or GET /api/telemarketer/:uid/leads/:id
  if (method === 'GET' && leadId) {
    const lead = await dbi.getLeadById(leadId);
    if (!lead) {
      ctx.json(res, 404, { ok: false, error: 'Lead not found: ' + leadId });
      return true;
    }

    // Ownership check: if lead is assigned to someone else and caller is not operator, reject
    if (!isOperator && lead.assigned_to && !isLeadAssignedToAgent(lead, agent)) {
      ctx.json(res, 403, {
        ok: false,
        error: 'This lead is assigned to another telemarketer (' + lead.assigned_to + ')',
      });
      return true;
    }

    ctx.json(res, 200, { ok: true, lead });
    return true;
  }

  // 4. Update lead status & notes: PATCH or POST /api/telemarketer/leads/:id
  if ((method === 'PATCH' || method === 'POST') && leadId) {
    const lead = await dbi.getLeadById(leadId);
    if (!lead) {
      ctx.json(res, 404, { ok: false, error: 'Lead not found: ' + leadId });
      return true;
    }

    // Ownership check: if assigned to another agent and caller is not operator, prevent unauthorized modification
    if (!isOperator && lead.assigned_to && !isLeadAssignedToAgent(lead, agent)) {
      ctx.json(res, 403, {
        ok: false,
        error: 'This lead is assigned to another telemarketer (' + lead.assigned_to + ')',
      });
      return true;
    }

    const validStatuses = new Map<string, db.LeadStatus>([
      ['assigned', 'assigned'],
      ['to_call', 'assigned'],
      ['to call', 'assigned'],
      ['pending', 'assigned'],
      ['new', 'assigned'],
      ['contacted', 'contacted'],
      ['called', 'contacted'],
      ['interested', 'interested'],
      ['warm', 'interested'],
      ['hot', 'interested'],
      ['won', 'interested'],
      ['not_interested', 'not_interested'],
      ['not interested', 'not_interested'],
      ['not-interested', 'not_interested'],
      ['rejected', 'not_interested'],
      ['lost', 'not_interested'],
      ['do_not_call', 'do_not_call'],
      ['do not call', 'do_not_call'],
      ['do-not-call', 'do_not_call'],
      ['dnc', 'do_not_call'],
      ['blacklisted', 'do_not_call'],
      ['unassigned', 'unassigned'],
    ]);

    const rawStatus = (body.leadStatus || body.lead_status || body.status || '') as string;
    let newStatus: db.LeadStatus | undefined;
    if (rawStatus && typeof rawStatus === 'string') {
      const normalized = validStatuses.get(rawStatus.trim().toLowerCase());
      if (!normalized) {
        ctx.json(res, 400, {
          ok: false,
          error: 'Invalid status: "' + rawStatus + '". Allowed values: assigned, contacted, interested, not_interested, do_not_call, unassigned (or aliases: dnc, pending, to_call)',
        });
        return true;
      }
      newStatus = normalized;
    }

    const rawNotes = (body.notes != null ? body.notes : body.lead_notes) as string | null | undefined;
    const appendNote = (body.appendNotes || body.append_notes || body.addNote || body.add_note) as string | undefined;

    if (newStatus === undefined && rawNotes === undefined && !appendNote) {
      ctx.json(res, 400, {
        ok: false,
        error: 'At least one field to update is required: leadStatus (or status), notes (or lead_notes), or appendNotes',
      });
      return true;
    }

    let finalNotes: string | undefined;
    if (appendNote && typeof appendNote === 'string' && appendNote.trim()) {
      const existing = lead.lead_notes ? lead.lead_notes.trim() : '';
      const datePrefix = new Date().toISOString().slice(0, 10);
      const noteToAdd = `[${datePrefix}] ${appendNote.trim()}`;
      finalNotes = existing ? `${existing}\n${noteToAdd}` : noteToAdd;
    } else if (rawNotes !== undefined) {
      finalNotes = rawNotes == null ? null : String(rawNotes);
    }

    const patch: Parameters<typeof db.updateLead>[1] = {};
    if (newStatus) patch.leadStatus = newStatus;
    if (finalNotes !== undefined) patch.notes = finalNotes;

    // If the lead was unassigned, claim it for this agent
    if (!lead.assigned_to) {
      patch.assignedTo = agent.uid ? `uid:${agent.uid}` : agent.name;
    }

    const updated = await dbi.updateLead(leadId, patch);
    ctx.json(res, 200, {
      ok: true,
      message: 'Lead updated successfully',
      lead: updated,
    });
    return true;
  }

  return false;
}

/** Authenticated product API routes. */
export async function handleApi(req: http.IncomingMessage, res: http.ServerResponse, url: URL, ctx: Ctx): Promise<boolean> {
  const p = url.pathname;
  const method = req.method ?? 'GET';
  if (!p.startsWith('/api/business-search') && !p.startsWith('/api/company-research') && !p.startsWith('/api/contact-research') && !p.startsWith('/api/parallel-contact-research') && !p.startsWith('/api/person-research') && !p.startsWith('/api/ads-research') && !p.startsWith('/api/ads-market') && !p.startsWith('/api/reports') && !p.startsWith('/api/leads') && !p.startsWith('/api/ads-leads') && !p.startsWith('/api/telemarketers') && !p.startsWith('/api/territories') && !p.startsWith('/api/contacts') && !p.startsWith('/api/lead-activity')) return false;
  if (!db.configured()) {
    ctx.json(res, 503, { error: 'report database is not configured; link DATABASE_URL to the Railway service' });
    return true;
  }

  // ---- Telemarketing territory / lead-map --------------------------------
  if (method === 'GET' && p === '/api/territories') {
    const state = url.searchParams.get('state') || 'johor';
    const [scans, assignments, contactPending, discovered] = await Promise.all([
      db.getTerritoryScanStats().catch(() => []),
      db.getTamanAssignments(state).catch(() => ({})),
      db.getTamanContactPending().catch(() => ({})),
      db.listDiscoveredTamans(state).catch(() => []),
    ]);
    const result = territories.buildTerritoryResponse(state, scans, assignments, contactPending, discovered);
    ctx.json(res, 200, result);
    return true;
  }

  if (method === 'GET' && p === '/api/territories/auto-scan') {
    ctx.json(res, 200, await autoScan.status());
    return true;
  }

  // The missing-taman finder runs from a person's machine (scripts/find-tamans.ts).
  // After a town's result is approved there, it is saved here: the tamans, and the
  // town's run, which marks it checked. Body: { run: FinderTownRun, tamans: DiscoveredTaman[] }.
  if (method === 'POST' && p === '/api/territories/finder') {
    const body = await ctx.readJson(req);
    const run = object(body.run) as unknown as db.FinderTownRun;
    if (!str(run.state) || !str(run.district) || !str(run.town)) {
      ctx.json(res, 400, { error: 'run.state, run.district and run.town are required' });
      return true;
    }
    const tamans = rows(body.tamans).map((t) => ({
      state: str(t.state), district: str(t.district), name: str(t.name), name_key: str(t.name_key),
      query_place: str(t.query_place), evidence_url: str(t.evidence_url) || null,
      maps_name: str(t.maps_name) || null, maps_address: str(t.maps_address) || null, verified: true,
    })).filter((t) => t.name && t.name_key && t.query_place);
    const added = await db.saveDiscoveredTamans(tamans);
    const recorded = await db.recordFinderTown({ ...run, added });
    console.log(`[taman-finder] saved ${run.town}, ${run.district}: ${added} tamans added${recorded ? '' : ' (town was already recorded)'}`);
    ctx.json(res, 200, { added, recorded });
    return true;
  }

  if (method === 'GET' && p === '/api/territories/finder') {
    ctx.json(res, 200, { towns: await db.listFinderTowns() });
    return true;
  }

  if (method === 'GET' && p === '/api/territories/discovered') {
    const state = url.searchParams.get('state')?.trim().toLowerCase() || undefined;
    const rows = await db.listDiscoveredTamans(state);
    ctx.json(res, 200, {
      verified: rows.filter((r) => r.verified).length,
      total: rows.length,
      tamans: rows,
    });
    return true;
  }

  if (method === 'POST' && p === '/api/territories/assign') {
    const body = await ctx.readJson(req);
    const taman = str(body.taman || body.name).trim();
    const assignedTo = str(body.assignedTo || body.assigned_to).trim();
    if (!taman) {
      ctx.json(res, 400, { error: 'taman is required' });
      return true;
    }
    if (!assignedTo || assignedTo === 'unassigned') {
      const result = await db.unassignTamanLeads({
        state: str(body.state || 'johor').trim(),
        taman,
        queryPlace: str(body.queryPlace || body.query_place).trim() || undefined,
        publicId: str(body.publicId || body.public_id).trim() || undefined,
      });
      ctx.json(res, 200, result);
      return true;
    }
    const result = await db.assignTamanLeads({
      state: str(body.state || 'johor').trim(),
      district: str(body.district).trim() || undefined,
      town: str(body.town).trim() || undefined,
      taman,
      queryPlace: str(body.queryPlace || body.query_place).trim() || undefined,
      publicId: str(body.publicId || body.public_id).trim() || undefined,
      assignedTo,
      notes: str(body.notes).trim() || null,
    });
    ctx.json(res, 200, result);
    return true;
  }

  // One click on Lead Assignment: unassigned leads at assigned tamans go to the
  // taman's telemarketer. Body: { state? } — every state when left out.
  if (method === 'POST' && p === '/api/territories/assign-owners') {
    const body = await ctx.readJson(req);
    const result = await db.assignTamanLeadsToOwners(str(body.state).trim() || undefined);
    console.log(`[territories] assigned ${result.updated} leads across ${result.tamans} tamans to their owners${result.skipped.length ? `, ${result.skipped.length} tamans skipped` : ''}`);
    ctx.json(res, 200, result);
    return true;
  }

  if (method === 'POST' && p === '/api/territories/contact-research') {
    const body = await ctx.readJson(req);
    const taman = str(body.taman || body.name).trim();
    if (!taman) {
      ctx.json(res, 400, { error: 'taman is required' });
      return true;
    }
    const requesterId = str(body.requesterId || body.userId).trim() || 'telemarketing';
    await db.applyLeadBlacklist();
    const ids = await db.tamanContactPendingCompanyIds({
      taman,
      queryPlace: str(body.queryPlace || body.query_place).trim() || undefined,
    });
    let queued = 0;
    let alreadyRunning = 0;
    let failed = 0;
    for (const id of ids) {
      try {
        const company = await db.getCompany(id);
        if (!company) {
          failed++;
          continue;
        }
        const launched = await launchContactResearch(company, { provider: 'legacy', requesterId });
        if (launched.alreadyRunning) alreadyRunning++;
        else queued++;
      } catch {
        failed++;
      }
    }
    ctx.json(res, 200, { ok: true, pending: ids.length, queued, alreadyRunning, failed });
    return true;
  }

  if (method === 'POST' && p === '/api/territories/unassign') {
    const body = await ctx.readJson(req);
    const taman = str(body.taman || body.name).trim();
    if (!taman) {
      ctx.json(res, 400, { error: 'taman is required' });
      return true;
    }
    const result = await db.unassignTamanLeads({
      state: str(body.state || 'johor').trim(),
      taman,
      queryPlace: str(body.queryPlace || body.query_place).trim() || undefined,
      publicId: str(body.publicId || body.public_id).trim() || undefined,
    });
    ctx.json(res, 200, result);
    return true;
  }

  // ---- Lead distribution & telemarketer assignment -----------------------
  if (method === 'GET' && p === '/api/leads/export') {
    const search = url.searchParams.get('search');
    const status = url.searchParams.get('status');
    const assignedTo = url.searchParams.get('assignedTo') || url.searchParams.get('assigned_to');
    const researchStatus = url.searchParams.get('researchStatus') || url.searchParams.get('research_status');
    const result = await db.listLeads({ search, status, assignedTo, researchStatus, limit: 1000, offset: 0 });
    const escapeCsv = (val: unknown) => {
      const s = String(val == null ? '' : val);
      return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const header = [
      'ID', 'Company Name', 'Category', 'Phone', 'Address', 'Website', 'Maps URL',
      'Rating', 'Reviews', 'Lead Status', 'Assigned To', 'Assigned At',
      'Research Dossier ID', 'Research Status',
      'Contact Sheet ID', 'Contact Status', 'Contact Phones Count', 'Decision Makers Count',
      'Notes',
    ];
    const lines = [header.join(',')];
    for (const lead of result.leads) {
      lines.push([
        escapeCsv(lead.id),
        escapeCsv(lead.name),
        escapeCsv(lead.category),
        escapeCsv(lead.phone),
        escapeCsv(lead.address),
        escapeCsv(lead.website),
        escapeCsv(lead.maps_url),
        escapeCsv(lead.rating),
        escapeCsv(lead.reviews),
        escapeCsv(lead.lead_status),
        escapeCsv(lead.assigned_to),
        escapeCsv(lead.assigned_at),
        escapeCsv(lead.research_public_id),
        escapeCsv(lead.research_status),
        escapeCsv(lead.contact_public_id),
        escapeCsv(lead.contact_status),
        escapeCsv(lead.contact_phones_count),
        escapeCsv(lead.contact_decision_makers_count),
        escapeCsv(lead.lead_notes),
      ].join(','));
    }
    const csvData = lines.join('\r\n');
    res.writeHead(200, {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="leads-${new Date().toISOString().slice(0, 10)}.csv"`,
      'cache-control': 'no-store',
    });
    res.end(csvData);
    return true;
  }

  if (method === 'GET' && p === '/api/leads') {
    const search = url.searchParams.get('search');
    const nameKeyword = url.searchParams.get('nameKeyword');
    const status = url.searchParams.get('status');
    const assignedTo = url.searchParams.get('assignedTo') || url.searchParams.get('assigned_to');
    const researchStatus = url.searchParams.get('researchStatus') || url.searchParams.get('research_status');
    const limit = Number(url.searchParams.get('limit') ?? 50);
    const offset = Number(url.searchParams.get('offset') ?? 0);
    const sort = url.searchParams.get('sort');
    const result = await db.listLeads({ search, nameKeyword, status, assignedTo, researchStatus, limit, offset, sort });
    ctx.json(res, 200, result);
    return true;
  }

  if (method === 'POST' && p === '/api/leads/assign') {
    const body = await ctx.readJson(req);
    const rawIds = Array.isArray(body.companyIds) ? body.companyIds : [body.companyId];
    const companyIds = rawIds.map((id: unknown) => String(id)).filter(Boolean);
    const assignedTo = str(body.assignedTo || body.assigned_to).trim();
    const notes = str(body.notes).trim() || null;
    if (!companyIds.length) {
      ctx.json(res, 400, { error: 'companyIds is required' });
      return true;
    }
    if (!assignedTo) {
      ctx.json(res, 400, { error: 'assignedTo is required' });
      return true;
    }
    const result = await db.assignLeads(companyIds, assignedTo, notes);
    ctx.json(res, 200, { ok: true, ...result, assignedTo });
    return true;
  }

  if (method === 'POST' && p === '/api/leads/unassign') {
    const body = await ctx.readJson(req);
    const rawIds = Array.isArray(body.companyIds) ? body.companyIds : [body.companyId];
    const companyIds = rawIds.map((id: unknown) => String(id)).filter(Boolean);
    if (!companyIds.length) {
      ctx.json(res, 400, { error: 'companyIds is required' });
      return true;
    }
    const result = await db.unassignLeads(companyIds);
    ctx.json(res, 200, { ok: true, ...result });
    return true;
  }

  const leadMatch = /^\/api\/leads\/(\d+)$/.exec(p);
  if (method === 'PATCH' && leadMatch) {
    const companyId = leadMatch[1]!;
    const body = await ctx.readJson(req);
    const validStatuses = new Set(['unassigned', 'assigned', 'contacted', 'interested', 'not_interested', 'do_not_call']);
    const rawStatus = str(body.leadStatus || body.lead_status || body.status).trim();
    const leadStatus = validStatuses.has(rawStatus) ? rawStatus as db.LeadStatus : undefined;
    const patch: Parameters<typeof db.updateLead>[1] = {};
    if (leadStatus) patch.leadStatus = leadStatus;
    if (Object.prototype.hasOwnProperty.call(body, 'assignedTo') || Object.prototype.hasOwnProperty.call(body, 'assigned_to')) {
      patch.assignedTo = body.assignedTo == null && body.assigned_to == null ? null : str(body.assignedTo || body.assigned_to).trim() || null;
    }
    if (Object.prototype.hasOwnProperty.call(body, 'notes') || Object.prototype.hasOwnProperty.call(body, 'lead_notes')) {
      patch.notes = body.notes == null && body.lead_notes == null ? null : str(body.notes || body.lead_notes);
    }
    if (Object.prototype.hasOwnProperty.call(body, 'isHidden') || Object.prototype.hasOwnProperty.call(body, 'is_hidden')) {
      patch.isHidden = Boolean(body.isHidden ?? body.is_hidden);
    }
    const updated = await db.updateLead(companyId, patch);
    if (!updated) {
      ctx.json(res, 404, { error: 'company not found or merged into another entity', companyId });
      return true;
    }
    ctx.json(res, 200, { ok: true, lead: updated });
    return true;
  }

  if (method === 'POST' && p === '/api/leads/hide') {
    const body = await ctx.readJson(req);
    const rawIds = Array.isArray(body.companyIds) ? body.companyIds : (body.companyId != null ? [body.companyId] : []);
    const companyIds = rawIds.map((id: unknown) => String(id)).filter(Boolean);
    const hide = body.hide !== undefined ? Boolean(body.hide) : (body.isHidden !== undefined ? Boolean(body.isHidden) : (body.is_hidden !== undefined ? Boolean(body.is_hidden) : true));
    if (!companyIds.length) {
      ctx.json(res, 400, { error: 'companyIds is required' });
      return true;
    }
    const result = await db.hideLeads(companyIds, hide);
    ctx.json(res, 200, { ok: true, hide, ...result });
    return true;
  }

  const keywordStatusStatuses = new Set(['unassigned', 'assigned', 'contacted', 'interested', 'not_interested', 'do_not_call']);
  if (method === 'GET' && p === '/api/leads/keyword-status/preview') {
    const keyword = str(url.searchParams.get('keyword')).trim();
    if (keyword.length < 3) {
      ctx.json(res, 400, { error: 'keyword must be at least 3 characters' });
      return true;
    }
    const result = await db.previewLeadsByNameKeyword(keyword);
    ctx.json(res, 200, { ok: true, keyword, ...result });
    return true;
  }

  if (method === 'POST' && p === '/api/leads/keyword-status') {
    const body = await ctx.readJson(req);
    const keyword = str(body.keyword).trim();
    const rawStatus = str(body.leadStatus || body.lead_status || body.status).trim();
    if (keyword.length < 3) {
      ctx.json(res, 400, { error: 'keyword must be at least 3 characters' });
      return true;
    }
    if (!keywordStatusStatuses.has(rawStatus)) {
      ctx.json(res, 400, { error: 'leadStatus is invalid' });
      return true;
    }
    const result = await db.setLeadStatusByNameKeyword(keyword, rawStatus as db.LeadStatus);
    ctx.json(res, 200, { ok: true, keyword, leadStatus: rawStatus, ...result });
    return true;
  }

  // ---- Ads & Form Submissions Leads (atap_solar_registrations) ------------
  if (method === 'GET' && p === '/api/ads-leads/stats') {
    const stats = await db.getAtapSolarRegistrationStats();
    ctx.json(res, 200, { ok: true, stats });
    return true;
  }

  if (method === 'GET' && p === '/api/ads-leads/export') {
    const search = url.searchParams.get('search');
    const status = url.searchParams.get('status');
    const assignedTo = url.searchParams.get('assignedTo') || url.searchParams.get('assigned_to');
    const source = url.searchParams.get('source');
    const state = url.searchParams.get('state');
    const result = await db.listAtapSolarRegistrations({ search, status, assignedTo, source, state, limit: 1000, offset: 0 });
    const escapeCsv = (val: unknown) => {
      const s = String(val == null ? '' : val);
      return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [
      [
        'ID',
        'Lead ID',
        'Full Name',
        'Phone Number',
        'TNB Account No',
        'Area / Address',
        'State',
        'Property Type',
        'Monthly Bill (RM)',
        'System Size',
        'Estimated Savings',
        'Roof Type',
        'Email',
        'Lead Status',
        'Assigned To',
        'Assigned At',
        'Source',
        'UTM Source',
        'UTM Medium',
        'UTM Campaign',
        'Lead Notes',
        'Submission Date',
      ].map(escapeCsv).join(','),
    ];
    for (const lead of result.leads) {
      lines.push([
        escapeCsv(lead.id),
        escapeCsv(lead.lead_id),
        escapeCsv(lead.full_name),
        escapeCsv(lead.phone_number),
        escapeCsv(lead.tnb_account_no),
        escapeCsv(lead.area),
        escapeCsv(lead.state),
        escapeCsv(lead.property_type),
        escapeCsv(lead.monthly_bill),
        escapeCsv(lead.system_size),
        escapeCsv(lead.estimated_savings),
        escapeCsv(lead.roof_type),
        escapeCsv(lead.email),
        escapeCsv(lead.lead_status),
        escapeCsv(lead.assigned_to),
        escapeCsv(lead.assigned_at),
        escapeCsv(lead.source),
        escapeCsv(lead.utm_source),
        escapeCsv(lead.utm_medium),
        escapeCsv(lead.utm_campaign),
        escapeCsv(lead.lead_notes),
        escapeCsv(lead.created_at),
      ].join(','));
    }
    const csvData = lines.join('\r\n');
    res.writeHead(200, {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="ads-leads-${new Date().toISOString().slice(0, 10)}.csv"`,
      'cache-control': 'no-store',
    });
    res.end(csvData);
    return true;
  }

  if (method === 'GET' && p === '/api/ads-leads') {
    const search = url.searchParams.get('search');
    const status = url.searchParams.get('status');
    const assignedTo = url.searchParams.get('assignedTo') || url.searchParams.get('assigned_to');
    const source = url.searchParams.get('source');
    const state = url.searchParams.get('state');
    const limit = Number(url.searchParams.get('limit') ?? 50);
    const offset = Number(url.searchParams.get('offset') ?? 0);
    const sort = url.searchParams.get('sort');
    const result = await db.listAtapSolarRegistrations({ search, status, assignedTo, source, state, limit, offset, sort });
    ctx.json(res, 200, result);
    return true;
  }

  if (method === 'POST' && p === '/api/ads-leads/assign') {
    const body = await ctx.readJson(req);
    const rawIds = Array.isArray(body.registrationIds) ? body.registrationIds : (Array.isArray(body.ids) ? body.ids : [body.id || body.registrationId]);
    const registrationIds = rawIds.map((id: unknown) => Number(id)).filter((n: number) => Number.isFinite(n) && n > 0);
    const assignedTo = str(body.assignedTo || body.assigned_to).trim();
    const notes = str(body.notes).trim() || null;
    if (!registrationIds.length) {
      ctx.json(res, 400, { error: 'registrationIds is required' });
      return true;
    }
    if (!assignedTo) {
      ctx.json(res, 400, { error: 'assignedTo is required' });
      return true;
    }
    const result = await db.assignAtapSolarRegistrations(registrationIds, assignedTo, notes);
    ctx.json(res, 200, { ok: true, ...result, assignedTo });
    return true;
  }

  if (method === 'POST' && p === '/api/ads-leads/unassign') {
    const body = await ctx.readJson(req);
    const rawIds = Array.isArray(body.registrationIds) ? body.registrationIds : (Array.isArray(body.ids) ? body.ids : [body.id || body.registrationId]);
    const registrationIds = rawIds.map((id: unknown) => Number(id)).filter((n: number) => Number.isFinite(n) && n > 0);
    if (!registrationIds.length) {
      ctx.json(res, 400, { error: 'registrationIds is required' });
      return true;
    }
    const result = await db.unassignAtapSolarRegistrations(registrationIds);
    ctx.json(res, 200, { ok: true, ...result });
    return true;
  }

  if (method === 'POST' && p === '/api/ads-leads/hide') {
    const body = await ctx.readJson(req);
    const rawIds = Array.isArray(body.registrationIds) ? body.registrationIds : (Array.isArray(body.ids) ? body.ids : [body.id || body.registrationId]);
    const registrationIds = rawIds.map((id: unknown) => Number(id)).filter((n: number) => Number.isFinite(n) && n > 0);
    const hide = body.hide !== undefined ? Boolean(body.hide) : (body.isHidden !== undefined ? Boolean(body.isHidden) : (body.is_hidden !== undefined ? Boolean(body.is_hidden) : true));
    if (!registrationIds.length) {
      ctx.json(res, 400, { error: 'registrationIds is required' });
      return true;
    }
    const result = await db.hideAtapSolarRegistrations(registrationIds, hide);
    ctx.json(res, 200, { ok: true, hide, ...result });
    return true;
  }

  const adsLeadMatch = /^\/api\/ads-leads\/(\d+)$/.exec(p);
  if (adsLeadMatch) {
    const regId = adsLeadMatch[1]!;
    if (method === 'GET') {
      const lead = await db.getAtapSolarRegistrationById(regId);
      if (!lead) {
        ctx.json(res, 404, { error: 'lead registration not found', id: regId });
        return true;
      }
      ctx.json(res, 200, { ok: true, lead });
      return true;
    }
    if (method === 'PATCH') {
      const body = await ctx.readJson(req);
      const validStatuses = new Set(['unassigned', 'assigned', 'contacted', 'interested', 'not_interested', 'do_not_call']);
      const rawStatus = str(body.leadStatus || body.lead_status || body.status).trim();
      const leadStatus = validStatuses.has(rawStatus) ? rawStatus as db.LeadStatus : undefined;
      const patch: Parameters<typeof db.updateAtapSolarRegistration>[1] = {};
      if (leadStatus) patch.leadStatus = leadStatus;
      if (Object.prototype.hasOwnProperty.call(body, 'assignedTo') || Object.prototype.hasOwnProperty.call(body, 'assigned_to')) {
        patch.assignedTo = body.assignedTo == null && body.assigned_to == null ? null : str(body.assignedTo || body.assigned_to).trim() || null;
      }
      if (Object.prototype.hasOwnProperty.call(body, 'notes') || Object.prototype.hasOwnProperty.call(body, 'lead_notes')) {
        patch.notes = body.notes == null && body.lead_notes == null ? null : str(body.notes || body.lead_notes);
      }
      if (Object.prototype.hasOwnProperty.call(body, 'isHidden') || Object.prototype.hasOwnProperty.call(body, 'is_hidden')) {
        patch.isHidden = Boolean(body.isHidden ?? body.is_hidden);
      }
      const updated = await db.updateAtapSolarRegistration(regId, patch);
      if (!updated) {
        ctx.json(res, 404, { error: 'lead registration not found', id: regId });
        return true;
      }
      ctx.json(res, 200, { ok: true, lead: updated });
      return true;
    }
  }

  // ---- Master People & Contact Directory ----------------------------------
  if (method === 'GET' && p === '/api/contacts/export') {
    const search = url.searchParams.get('search');
    const filter = url.searchParams.get('filter') || url.searchParams.get('type');
    const assignedTo = url.searchParams.get('assignedTo') || url.searchParams.get('assigned_to');
    const rows = await db.getCompanyContactRows({ search, assignedTo, researchedOnly: filter === 'researched' });
    const result = contacts.buildMasterContactsResponse(rows, { search, filter, limit: 10000 });
    const csvData = contacts.generateContactsCsv(result.groups);
    res.writeHead(200, {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="contacts-master-${new Date().toISOString().slice(0, 10)}.csv"`,
      'cache-control': 'no-store',
    });
    res.end(csvData);
    return true;
  }

  // ---- Email marketing list: every email, one row per company + email -------
  if (method === 'GET' && (p === '/api/contacts/emails' || p === '/api/contacts/emails/export')) {
    const rows = await emailList.allRows(url.searchParams.get('fresh') === '1');
    const shown = emailList.filter(rows, { search: url.searchParams.get('search'), source: url.searchParams.get('source') });
    if (p.endsWith('/export')) {
      res.writeHead(200, {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="email-list-${new Date().toISOString().slice(0, 10)}.csv"`,
        'cache-control': 'no-store',
      });
      res.end(emailList.toCsv(shown));
      return true;
    }
    const limit = Math.min(Math.max(Math.round(Number(url.searchParams.get('limit') ?? 50) || 50), 1), 200);
    const offset = Math.max(Math.round(Number(url.searchParams.get('offset') ?? 0) || 0), 0);
    ctx.json(res, 200, { stats: emailList.stats(rows), total: shown.length, limit, offset, rows: shown.slice(offset, offset + limit) });
    return true;
  }

  if (method === 'GET' && p === '/api/contacts') {
    const search = url.searchParams.get('search');
    const filter = url.searchParams.get('filter') || url.searchParams.get('type');
    const assignedTo = url.searchParams.get('assignedTo') || url.searchParams.get('assigned_to');
    const limit = Number(url.searchParams.get('limit') ?? 25);
    const offset = Number(url.searchParams.get('offset') ?? 0);
    const rows = await db.getCompanyContactRows({ search, assignedTo, researchedOnly: filter === 'researched' });
    const result = contacts.buildMasterContactsResponse(rows, { search, filter, assignedTo, limit, offset });
    ctx.json(res, 200, result);
    return true;
  }

  if (method === 'POST' && p === '/api/leads/dedup') {
    const result = await db.dedupCompanies();
    ctx.json(res, 200, { ok: true, ...result });
    return true;
  }

  if (method === 'GET' && p === '/api/telemarketers') {
    const [telemarketers, agents, stats] = await Promise.all([
      db.listTelemarketers().catch(() => []),
      db.getTelemarketerDetails().catch(() => []),
      db.getLeadStats().catch(() => null),
    ]);
    ctx.json(res, 200, { telemarketers, agents, stats });
    return true;
  }

  // Pull the sales roster from calculator.atap.solar and match agents by
  // the source user's Bubble UID. The request cannot supply replacement UIDs.
  if (method === 'POST' && p === '/api/telemarketers/import') {
    try {
      const result = await importSalesAgents();
      ctx.json(res, 200, { ok: true, ...result });
    } catch (err) {
      ctx.json(res, 502, { error: (err as Error).message });
    }
    return true;
  }

  if (method === 'POST' && p === '/api/telemarketers') {
    const body = await ctx.readJson(req);
    const name = str(body.name).trim();
    if (!name) {
      ctx.json(res, 400, { error: 'name is required' });
      return true;
    }
    const agent = await db.addTelemarketer(name, {
      phone: typeof body.phone === 'string' ? body.phone : null,
      email: typeof body.email === 'string' ? body.email : null,
      notes: typeof body.notes === 'string' ? body.notes : null,
      active: typeof body.active === 'boolean' ? body.active : true,
    });
    ctx.json(res, 201, { ok: true, name: agent.name, agent });
    return true;
  }

  const teleIdMatch = /^\/api\/telemarketers\/(\d+)$/.exec(p);
  if (method === 'PATCH' && teleIdMatch) {
    const id = parseInt(teleIdMatch[1]!, 10);
    const body = await ctx.readJson(req);
    const agent = await db.updateTelemarketer(id, {
      name: typeof body.name === 'string' ? body.name.trim() : undefined,
      phone: typeof body.phone === 'string' ? body.phone.trim() : undefined,
      email: typeof body.email === 'string' ? body.email.trim() : undefined,
      notes: typeof body.notes === 'string' ? body.notes.trim() : undefined,
      active: typeof body.active === 'boolean' ? body.active : undefined,
    });
    if (!agent) {
      ctx.json(res, 404, { error: 'telemarketer not found' });
      return true;
    }
    ctx.json(res, 200, { ok: true, agent });
    return true;
  }

  if (method === 'DELETE' && teleIdMatch) {
    const id = parseInt(teleIdMatch[1]!, 10);
    const unassign = url.searchParams.get('unassign') !== 'false';
    const ok = await db.deleteTelemarketer(id, unassign);
    if (!ok) {
      ctx.json(res, 404, { error: 'telemarketer not found' });
      return true;
    }
    ctx.json(res, 200, { ok: true, deleted: true });
    return true;
  }

  // ---- Lead Activity & Presentation Operations -----------------------------
  if (method === 'GET' && p === '/api/lead-activity/stats') {
    try {
      const days = parseInt(url.searchParams.get('days') || '7', 10);
      const startDate = url.searchParams.get('startDate') || url.searchParams.get('from') || undefined;
      const endDate = url.searchParams.get('endDate') || url.searchParams.get('to') || undefined;
      const telemarketer = url.searchParams.get('telemarketer') || undefined;
      const sortBy = (url.searchParams.get('sortBy') || undefined) as any;
      const limit = parseInt(url.searchParams.get('limit') || '10', 10);
      const stats = await db.getLeadActivityStats({
        days: isNaN(days) ? 7 : days,
        startDate,
        endDate,
        telemarketer,
        sortBy,
        limit: isNaN(limit) ? 10 : limit,
      });
      ctx.json(res, 200, { ok: true, stats });
    } catch (err: any) {
      console.error('[lead-activity/stats] endpoint error:', err);
      ctx.json(res, 200, {
        ok: true,
        stats: {
          kpis: { totalActivities: 0, processedToday: 0, processedYesterday: 0, totalContacted: 0, totalInterested: 0, conversionRate: 0, activeTelemarketers: 0, totalLeadsInPool: 0 },
          dailyLeadProcessed: [],
          progressByStatus: [],
          perTelemarketerSummary: [],
          topLeaders: [],
          dateRange: { startDate: '', endDate: '', days: 7 },
        },
        error: String(err?.message || err),
      });
    }
    return true;
  }

  if (method === 'GET' && p === '/api/lead-activity/leaderboard') {
    try {
      const days = parseInt(url.searchParams.get('days') || '7', 10);
      const startDate = url.searchParams.get('startDate') || url.searchParams.get('from') || undefined;
      const endDate = url.searchParams.get('endDate') || url.searchParams.get('to') || undefined;
      const sortBy = (url.searchParams.get('sortBy') || 'interested') as any;
      const limit = parseInt(url.searchParams.get('limit') || '10', 10);
      const result = await db.getTopTelemarketersLeaderboard({
        days: isNaN(days) ? 7 : days,
        startDate,
        endDate,
        sortBy,
        limit: isNaN(limit) ? 10 : limit,
      });
      ctx.json(res, 200, result);
    } catch (err: any) {
      console.error('[lead-activity/leaderboard] endpoint error:', err);
      ctx.json(res, 200, {
        ok: false,
        dateRange: { startDate: '', endDate: '', days: 7 },
        sortBy: 'interested',
        total: 0,
        leaders: [],
        error: String(err?.message || err),
      });
    }
    return true;
  }

  if (method === 'GET' && p === '/api/lead-activity/log') {
    try {
      const limit = parseInt(url.searchParams.get('limit') || '50', 10);
      const offset = parseInt(url.searchParams.get('offset') || '0', 10);
      const telemarketer = url.searchParams.get('telemarketer') || undefined;
      const status = url.searchParams.get('status') || undefined;
      const search = url.searchParams.get('search') || undefined;
      const result = await db.listLeadActivities({
        limit: isNaN(limit) ? 50 : limit,
        offset: isNaN(offset) ? 0 : offset,
        telemarketer,
        status,
        search,
      });
      ctx.json(res, 200, { ok: true, ...result });
    } catch (err: any) {
      console.error('[lead-activity/log] endpoint error:', err);
      ctx.json(res, 200, { ok: true, activities: [], total: 0, error: String(err?.message || err) });
    }
    return true;
  }

  if (method === 'POST' && p === '/api/lead-activity/mock-generate') {
    const body = await ctx.readJson(req).catch(() => ({}));
    const leadCount = typeof body.leadCount === 'number' ? body.leadCount : (typeof body.count === 'number' ? body.count : 80);
    const daysSpan = typeof body.daysSpan === 'number' ? body.daysSpan : (typeof body.days === 'number' ? body.days : 7);
    const clearFirst = body.clearFirst !== undefined ? Boolean(body.clearFirst) : true;
    const result = await db.generateMockLeadData({ leadCount, daysSpan, clearFirst });
    ctx.json(res, 200, result);
    return true;
  }

  if (method === 'POST' && p === '/api/lead-activity/reset-progress') {
    const result = await db.clearMockLeadProgress();
    ctx.json(res, 200, result);
    return true;
  }

  if (method === 'POST' && p === '/api/lead-activity/record') {
    const body = await ctx.readJson(req);
    const companyId = body.companyId || body.company_id;
    const status = (body.status || body.leadStatus || body.lead_status) as db.LeadStatus;
    if (!companyId || !status) {
      ctx.json(res, 400, { error: 'companyId and status are required' });
      return true;
    }
    const result = await db.addManualLeadActivity({
      companyId,
      status,
      telemarketerName: body.telemarketer || body.telemarketerName || body.telemarketer_name,
      notes: body.notes || body.lead_notes,
      actionDate: body.actionDate || body.action_date,
    });
    ctx.json(res, 200, result);
    return true;
  }

  // The trail as JSON, for anything that wants to read a run without a browser.
  const eventsMatch = /^\/api\/reports\/([A-Za-z0-9_-]{20})\/events$/.exec(p);
  if (method === 'GET' && eventsMatch) {
    const report = await db.getReport(eventsMatch[1]!);
    if (!report) {
      ctx.json(res, 404, { error: 'report not found', id: eventsMatch[1] });
      return true;
    }
    const events = await db.listEvents({ reportId: report.id });
    ctx.json(res, 200, {
      report: { id: report.public_id, type: report.report_type, status: report.status, title: report.title },
      events,
      view_url: 'https://' + (req.headers.host ?? 'ee-auto.up.railway.app') + '/r/' + report.public_id + '/log',
    });
    return true;
  }

  const repairMatch = /^\/api\/reports\/([A-Za-z0-9_-]{20})\/repair$/.exec(p);
  if (method === 'POST' && repairMatch) {
    const publicId = repairMatch[1]!;
    const report = await db.getReport(publicId);
    if (!report) { ctx.json(res, 404, { error: 'report not found' }); return true; }
    const body = await ctx.readJson(req);
    const uploaded = object(body.snapshot);
    const hasUpload = Object.keys(uploaded).length > 0;
    if (hasUpload) {
      const supplied = str(req.headers.authorization).replace(/^Bearer\s+/i, '');
      const expected = process.env.LAB_TOKEN ?? '';
      const digest = (value: string) => crypto.createHash('sha256').update(value).digest();
      if (!expected || !crypto.timingSafeEqual(digest(supplied), digest(expected))) {
        ctx.json(res, 403, { error: 'worker snapshot upload requires LAB_TOKEN' });
        return true;
      }
    }
    let snapshot = hasUpload ? uploaded : object(report.result);
    if (!hasUpload && !Array.isArray(snapshot.companies) && report.job_id) {
      try {
        const workerSaved = await db.searchResultForJob(report.job_id);
        if (workerSaved) snapshot = { search: workerSaved.report, companies: workerSaved.companies, scan_metadata: { restored_from_worker_database: true } };
      } catch (err) {
        const detail = (err as Error).message ?? String(err);
        console.error(`[business_search.repair_lookup_failed] report=${publicId}: ${detail}`);
        ctx.json(res, 500, { error: detail });
        return true;
      }
    }
    if (report.report_type !== 'business_search' || !(report.status === 'partial' || report.status === 'failed' || hasUpload && report.status === 'running') || active.has(publicId) || !Array.isArray(snapshot.companies)) {
      ctx.json(res, 409, { error: 'report has no captured business list available for repair' });
      return true;
    }
    active.add(publicId);
    try {
      if (hasUpload) {
        await db.updateReport(publicId, { status: 'partial', result: snapshot, error: 'Worker recovery copy loaded; database repair in progress' });
        await db.logEvent({ reportId: report.id, publicId, jobId: report.job_id, stage: 'business_search', event: 'business_search.snapshot_restored', detail: { companies: rows(snapshot.companies).length } });
      }
      const { updated, saved } = await completeFromSnapshot(publicId, snapshot);
      await db.logEvent({ reportId: report.id, publicId, jobId: report.job_id, stage: 'business_search', event: 'business_search.repair_completed', detail: { companies: saved.companies, linked: saved.linked } });
      ctx.json(res, 200, { report: envelope(req, updated), saved });
    } catch (err) {
      const detail = (err as Error).message ?? String(err);
      console.error(`[business_search.repair_failed] report=${publicId}: ${(err as Error).stack ?? String(err)}`);
      await db.logEvent({ reportId: report.id, publicId, jobId: report.job_id, stage: 'business_search', event: 'business_search.repair_failed', detail: { error: detail } });
      await db.updateReport(publicId, { status: 'partial', error: `Database repair failed: ${detail}` }).catch(() => {});
      ctx.json(res, 500, { error: detail });
    } finally {
      active.delete(publicId);
    }
    return true;
  }

  const retryMatch = /^\/api\/reports\/([A-Za-z0-9_-]{20})\/retry$/.exec(p);
  if (method === 'POST' && retryMatch) {
    const publicId = retryMatch[1]!;
    const original = await db.getReport(publicId);
    if (!original) {
      ctx.json(res, 404, { error: 'report not found' });
      return true;
    }
    if (original.status !== 'failed' || active.has(publicId)) {
      ctx.json(res, 409, { error: 'report is not ready to retry' });
      return true;
    }
    const request = object(original.request);
    const company = original.company_id ? await db.getCompany(original.company_id) : null;
    const personInput = original.report_type === 'person_research' ? await personResearchInput(original) : null;
    if ((original.report_type === 'company_research' || original.report_type === 'contact_research') && !company
      || original.report_type === 'person_research' && !personInput
      || original.report_type === 'ads_research' && !str(request.name)
      || original.report_type === 'ads_market' && !Array.isArray(request.keywords)
      || original.report_type === 'business_search' && !str(request.keyword) && !str(request.place)) {
      ctx.json(res, 409, { error: 'original report inputs are no longer available' });
      return true;
    }
    const report = await db.retryFailedReport(publicId);
    if (!report) {
      ctx.json(res, 409, { error: 'report was already retried' });
      return true;
    }
    if (report.report_type === 'business_search') void runBusinessSearch(publicId, report.id, request);
    else if (report.report_type === 'company_research') void runCompanyResearch(publicId, report.id, company!, request);
    else if (report.report_type === 'contact_research') void runContactResearch(publicId, report.id, company!, request);
    else if (report.report_type === 'person_research') void runPersonResearch(publicId, report.id, personInput!.company, personInput!.person);
    else if (report.report_type === 'ads_research') void runAdsResearch(publicId, report.id, request);
    else if (report.report_type === 'ads_market') void runAdsMarket(publicId, report.id, request);
    ctx.json(res, 202, { report: envelope(req, report) });
    return true;
  }

  // Permanent removal. One report per call, addressed by its opaque public id:
  // there is deliberately no bulk form of this, so "flush everything" stays a
  // sequence of visible, individually confirmed deletions rather than one query.
  const deleteMatch = /^\/api\/reports\/([A-Za-z0-9_-]{20})$/.exec(p);
  if (method === 'DELETE' && deleteMatch) {
    const report = await db.getReport(deleteMatch[1]!);
    if (!report) {
      ctx.json(res, 404, { error: 'report not found', id: deleteMatch[1] });
      return true;
    }
    await db.deleteReport(report.public_id);
    ctx.json(res, 200, { deleted: true, id: report.public_id, type: report.report_type, title: report.title });
    return true;
  }

  if (method === 'GET' && p === '/api/reports') {
    const rawType = url.searchParams.get('type');
    const rawStatus = url.searchParams.get('status');
    const type = rawType === 'business_search' || rawType === 'company_research' || rawType === 'contact_research' || rawType === 'person_research' || rawType === 'ads_research' || rawType === 'ads_market' ? rawType : null;
    const allowedStatuses = new Set(['queued', 'running', 'completed', 'partial', 'failed']);
    const status = allowedStatuses.has(rawStatus ?? '') ? rawStatus as db.ReportStatus : null;
    const limit = Math.min(Math.max(Math.round(Number(url.searchParams.get('limit') ?? 40) || 40), 1), 100);
    const offset = Math.max(Math.round(Number(url.searchParams.get('offset') ?? 0) || 0), 0);
    const listed = await db.listReports({ type, status, limit, offset });
    const reports = listed.reports.map((report) => {
      const result = object(report.result);
      const finalEntity = object(result.entity);
      const companies = rows(result.companies);
      return {
        ...envelope(req, report),
        repairable: report.report_type === 'business_search' && (report.status === 'partial' || report.status === 'failed') && (Array.isArray(result.companies) || Boolean(report.job_id)),
        preview: report.report_type === 'company_research' ? {
          company_id: report.company_id,
          entity: finalEntity,
          summary: str(result.summary) || null,
          contacts: rows(result.contacts).length,
          people: rows(result.people).length,
          signals: rows(result.signals ?? result.business_signals).length,
        } : report.report_type === 'contact_research' ? {
          company_id: report.company_id,
          entity: finalEntity,
          cheat_sheet: object(result.cheat_sheet),
          decision_makers: rows(result.decision_makers).length,
          phones: rows(result.phone_contacts).length,
          emails: rows(result.email_contacts).length,
        } : report.report_type === 'person_research' ? {
          company_id: report.company_id,
          person: object(result.person),
          summary: str(result.summary) || null,
          facts: rows(result.facts).length,
          signals: rows(result.signals).length,
        } : {
          keyword: str(object(report.request).keyword) || null,
          place: str(object(report.request).place) || null,
          companies: companies.length || Number(object(result.search).found ?? 0) || null,
        },
      };
    });
    ctx.json(res, 200, { reports, total: listed.total, limit, offset });
    return true;
  }

  if (method === 'POST' && p === '/api/business-search') {
    const body = await ctx.readJson(req);
    const keyword = str(body.keyword).trim();
    const place = str(body.place || body.location).trim();
    if (!keyword && !place) {
      ctx.json(res, 400, { error: 'keyword or place/location is required' });
      return true;
    }
    const report = await launchBusinessSearch({
      keyword, place, max: body.max, userId: str(body.requesterId || body.userId) || null, timeoutMs: body.timeoutMs,
    });
    ctx.json(res, 202, { report: envelope(req, report) });
    return true;
  }

  if (method === 'GET' && p === '/api/contact-research/auto-queue') {
    ctx.json(res, 200, await autoContact.status());
    return true;
  }

  if (method === 'POST' && p === '/api/contact-research/recover-abandoned') {
    const body = await ctx.readJson(req);
    const since = str(body.since);
    const parsed = Date.parse(since);
    if (!since || !Number.isFinite(parsed)) {
      ctx.json(res, 400, { error: 'since must be an ISO timestamp' });
      return true;
    }
    const requeued = await db.requeueAbandonedContactReports(new Date(parsed).toISOString());
    void resumeContactResearch();
    ctx.json(res, 200, { requeued });
    return true;
  }

  if (method === 'POST' && (p === '/api/contact-research' || p === '/api/parallel-contact-research')) {
    if (p === '/api/parallel-contact-research' && !(await secrets.load(), secrets.get('parallel'))) {
      ctx.json(res, 503, { error: 'No Parallel key: add one on /workers' });
      return true;
    }
    const body = await ctx.readJson(req);
    const companyId = str(body.companyId || body.company_id).trim();
    const name = str(body.name || body.companyName || body.company).trim();
    if (!companyId && !name) {
      ctx.json(res, 400, { error: 'companyId or company name is required' });
      return true;
    }
    let company: Record<string, unknown> | null = null;
    if (companyId) {
      if (!/^\d+$/.test(companyId)) {
        ctx.json(res, 400, { error: 'companyId must be a numeric company id' });
        return true;
      }
      company = await db.getCompany(companyId);
      if (!company) {
        ctx.json(res, 404, { error: 'company not found', companyId });
        return true;
      }
    } else {
      company = await db.findOrCreateCompany({
        name,
        address: str(body.address) || null,
        phone: str(body.phone) || null,
        website: str(body.website) || null,
        category: str(body.category) || null,
      });
    }
    const { report, alreadyRunning } = await launchContactResearch(company, {
      provider: p === '/api/parallel-contact-research' ? 'parallel' : 'legacy',
      targetRole: str(body.targetRole || body.role || body.persona).trim() || null,
      requesterId: str(body.requesterId || body.userId) || null,
      compareToReportId: body.compareToReportId,
    });
    // 200 not 202 when one was already in flight: nothing new was queued, this
    // is a pointer to the run that exists.
    ctx.json(res, alreadyRunning ? 200 : 202, { report: envelope(req, report) });
    return true;
  }

  if (method === 'POST' && p === '/api/company-research') {
    const body = await ctx.readJson(req);
    const companyId = str(body.companyId || body.company_id).trim();
    if (!/^\d+$/.test(companyId)) {
      ctx.json(res, 400, { error: 'companyId is required and must be a company id returned by a business-search report' });
      return true;
    }
    const company = await db.getCompany(companyId);
    if (!company) {
      ctx.json(res, 404, { error: 'company not found', companyId });
      return true;
    }
    const request = { companyId, requesterId: str(body.requesterId || body.userId) || null };
    const report = await db.createReport({
      type: 'company_research', title: str(company.name, 'Company') + ' intelligence report',
      userId: str(request.requesterId) || null, request, companyId,
    });
    void runCompanyResearch(report.public_id, report.id, company, request);
    ctx.json(res, 202, { report: envelope(req, report) });
    return true;
  }

  if (method === 'POST' && p === '/api/ads-research') {
    const body = await ctx.readJson(req);
    const name = str(body.name || body.company).trim();
    if (!name) {
      ctx.json(res, 400, { error: 'name is required' });
      return true;
    }
    const companyId = str(body.companyId || body.company_id).trim();
    // Ads change week to week, so re-running is legitimate and a completed report is
    // never a reason to refuse. A capture still IN FLIGHT is a different matter: the
    // dossier button would otherwise start a second crawl of the same advertiser.
    if (companyId) {
      const running = await db.findAdsReport(companyId);
      if (running && (running.status === 'queued' || running.status === 'running')) {
        ctx.json(res, 200, { report: envelope(req, running) });
        return true;
      }
    }
    const request = {
      name,
      region: (str(body.region).trim() || 'MY').toUpperCase(),
      fbMax: num(body.fbMax, 0),
      gMax: num(body.gMax, 30),
      requesterId: str(body.requesterId || body.userId) || null,
    };
    const report = await db.createReport({
      type: 'ads_research', title: name + ' ads',
      userId: str(request.requesterId) || null, request,
      companyId: companyId || null,
    });
    void runAdsResearch(report.public_id, report.id, request);
    ctx.json(res, 202, { report: envelope(req, report) });
    return true;
  }

  if (method === 'POST' && p === '/api/ads-market') {
    const body = await ctx.readJson(req);
    // The form sends ONE product keyword. The pipeline is built around several,
    // fetched concurrently, so accept both shapes and always store an array.
    const raw = Array.isArray(body.keywords) ? body.keywords : [body.keyword ?? body.product ?? body.query];
    const keywords = raw.map((k: unknown) => str(k).trim()).filter(Boolean).slice(0, 8);
    if (!keywords.length) {
      ctx.json(res, 400, { error: 'keyword is required' });
      return true;
    }
    // The form offers a country name; the Ad Library takes a 2-letter region.
    const region = countryToRegion(str(body.country || body.region));
    const request = {
      keywords,
      region,
      country: str(body.country).trim() || 'Malaysia',
      pages: Math.min(Math.max(num(body.pages, 12), 1), 40),
      effort: ['low', 'medium', 'high'].includes(str(body.effort)) ? str(body.effort) : 'high',
      requesterId: str(body.requesterId || body.userId) || null,
    };
    // A market moves week to week, so a COMPLETED report never blocks a re-run.
    // One already in flight for the same keywords does: the crawl is ~90s of a
    // single browser lock on the mini, and two of them would just queue and
    // fight over it.
    const running = await db.findAdsMarketReport(keywords, region);
    if (running) {
      ctx.json(res, 200, { report: envelope(req, running) });
      return true;
    }
    const report = await db.createReport({
      type: 'ads_market',
      title: keywords[0] + ' — ads market (' + region + ')',
      userId: str(request.requesterId) || null,
      request,
    });
    void runAdsMarket(report.public_id, report.id, request);
    ctx.json(res, 202, { report: envelope(req, report) });
    return true;
  }

  if (method === 'POST' && p === '/api/person-research') {
    const body = await ctx.readJson(req);
    const sourceReportId = str(body.companyResearchId || body.company_research_id).trim();
    const personId = str(body.personId || body.person_id).trim();
    const email = str(body.email).trim();
    const mobile = str(body.mobile ?? body.mobileNumber ?? body.phone).trim();
    if (!/^[A-Za-z0-9_-]{20}$/.test(sourceReportId) || !personId) {
      ctx.json(res, 400, { error: 'companyResearchId and personId from a completed company report are required' });
      return true;
    }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      ctx.json(res, 400, { error: 'email must be a valid optional identity hint' });
      return true;
    }
    if (mobile && !normalizeMobileHint(mobile)) {
      ctx.json(res, 400, { error: 'mobile must contain 7 to 15 digits and may use +, spaces, parentheses, periods, or hyphens' });
      return true;
    }
    const source = await db.getReport(sourceReportId);
    if (!source || source.report_type !== 'company_research' || (source.status !== 'completed' && source.status !== 'partial') || !source.company_id) {
      ctx.json(res, 404, { error: 'completed company research report not found', companyResearchId: sourceReportId });
      return true;
    }
    const person = rows(source.result?.people).find((row) => first(row, ['id']) === personId);
    const company = await db.getCompany(source.company_id);
    if (!person || !company) {
      ctx.json(res, 404, { error: 'validated person or source company not found', personId });
      return true;
    }
    // One brief per person per company report. The portal shows a VIP button on
    // every validated person, and P01 already has an automatic brief -- so the
    // first thing most people click is a person who is already being researched.
    // Joining that run is right; starting a second four-round pass is not.
    const running = await db.findPersonBrief(sourceReportId, personId);
    if (running) {
      ctx.json(res, 200, { report: envelope(req, running) });
      return true;
    }
    const report = await launchPersonResearch({
      sourceReportId,
      company,
      person,
      requesterId: str(body.requesterId || body.userId) || null,
      identityHints: { ...(email ? { email } : {}), ...(mobile ? { mobile } : {}) },
      autoTriggered: false,
    });
    ctx.json(res, 202, { report: envelope(req, report) });
    return true;
  }

  const one = /^\/api\/(business-search|company-research|contact-research|parallel-contact-research|person-research|ads-research|ads-market)\/([A-Za-z0-9_-]{20})$/.exec(p);
  if (method === 'GET' && one) {
    const report = await db.getReport(one[2]!);
    const expected = one[1] === 'business-search' ? 'business_search'
      : one[1] === 'person-research' ? 'person_research'
      : one[1] === 'ads-research' ? 'ads_research'
      : one[1] === 'ads-market' ? 'ads_market'
      : one[1] === 'contact-research' || one[1] === 'parallel-contact-research' ? 'contact_research' : 'company_research';
    if (!report || report.report_type !== expected) {
      ctx.json(res, 404, { error: 'report not found' });
      return true;
    }
    await ensureRunning(report);
    const detail = await publicDetail(report);
    const run = report.report_type === 'company_research'
      ? await db.researchRun(report.id)
      : report.report_type === 'person_research' ? await db.personResearchRun(report.id)
      : report.report_type === 'contact_research' ? await db.contactResearchRun(report.id)
      : report.report_type === 'ads_research' ? await db.adsResearchRun(report.id)
      : report.report_type === 'ads_market' ? await db.adsMarketRun(report.id) : null;
    ctx.json(res, 200, { report: envelope(req, report), data: detail, research_run: run });
    return true;
  }

  ctx.json(res, 405, { error: 'method not allowed' });
  return true;
}
