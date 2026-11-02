// The free preview, as a landing page that sells the full report. Built from the company-dive
// alone, plus the preview editor's notes when they exist (preview-editor.ts). Two hooks:
//   1. it is about this company and nobody else: what public sources already say about them
//   2. warning signs we found (contradictions, missing, outdated and wrong details), some shown,
//      the rest and each part's headline number kept locked for the full report
// Then what is inside the full report, part by part as the malaysia-deeper-dive report reads
// (docs/country-deeper-dive-plan.md), with placeholder versions of its visuals: 1 contact and
// reachability, 2 how the internet understands you (AI and search lead), 3 reviews, discussion
// and news, 4 credibility and official records (the official sources, then this company's claims
// and warning signs), 5 digital assets (domains, hosting, email and its reputation), 6 website
// speed and quality (Google PageSpeed), 7 the full analysis across all six, 8 the action plan by
// department with the work written for you. Then how it works, and the order panel.
// Same look as the full report (Inter, two-tone headlines, near-black bands), laid out as one
// responsive page rather than A4 sheets.
//
// It sits on a public link and goes to someone who has not paid, so it names only the company and
// its publicly named leadership: no staff names, no phone numbers, no private document links, and
// no research write-up (privacy.ts). Sources are the ones the company-dive judged to be about them.
import { CHAPTER_EYEBROW, CHAPTER_ORDER, NB, OPENERS, PART_OPENERS, esc, tie, typeset } from './report-html.ts';
import { PARTNERS_CSS, partnersHtml } from './partners.ts';
import { isLeadership, publicSources, scrub } from './privacy.ts';
import type { PreviewNotes } from './preview-editor.ts';

/** What the seller shows on the order panel; every field optional. */
export type Offer = { price?: string; contact?: string; order_url?: string };

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n).replace(/\s+\S*$/, '') + ' …' : s);
const hostOf = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };
const dateOf = (iso: string | undefined | null) => (iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '');
// "July 2023 in [1][3] vs …" reads as "July 2023 vs …": the citation and the word that led into it go.
const noCites = (s: string) => s.replace(/(?:\s+(?:in|on|from|per|by|at))?\s*(?:\[\d+\])+/g, '').replace(/\s+([.,;:)])/g, '$1').replace(/\s+/g, ' ').trim();
/** A string for a CSS `content:` value. */
const cssStr = (s: string) => `"${s.replace(/[\\"]/g, '\\$&').replace(/[\r\n<>]+/g, ' ')}"`;
const shortName = (n: string) => n.replace(/\s+(Sdn\.?\s*Bhd\.?|Berhad|Bhd\.?|Enterprise|PLT|Pte\.?\s*Ltd\.?)$/i, '').trim() || n;
const CLAIM = /\b(CIDB|SEDA|MyHIJAU|MyHijau|ISO|certif|accredit|licen[cs]|grade|award|member|partner|distributor|approved|appointed)\b/i;

const TYPE: Record<string, [string, string]> = {
  contradiction: ['Contradiction', 'contra'], missing: ['Missing', 'missing'], outdated: ['Outdated', 'outdated'], wrong: ['Wrong information', 'wrong'],
};

/** Warnings the page shows when the preview editor has not run: the dive's own contradictions and gaps. */
function fallbackWarnings(r: any): NonNullable<PreviewNotes['warnings']> {
  const split = (s: string) => { const m = s.match(/^([^:]{3,60}):\s*(.+)$/); return m ? [m[1], m[2]] : [clip(s, 70), s]; };
  return [
    ...(r.contradictions ?? []).map((c: string) => { const [t, d] = split(noCites(c)); return { type: 'contradiction' as const, title: `Sources disagree on: ${t.toLowerCase()}`, detail: d, risk: 'A customer or bank comparing sources sees two stories and starts to doubt both.' }; }),
    ...(r.gaps ?? []).map((g: string) => ({ type: 'missing' as const, title: clip(noCites(g), 80), detail: noCites(g), risk: 'When the record is silent, a careful buyer fills the gap with doubt.' })),
  ];
}

export function buildPreview(dive: any, offer: Offer = {}, notes: PreviewNotes | null = null): string {
  const r = dive?.result ?? {};
  const id = r.identity ?? {};
  const name = String(id.legal_name ?? dive?.company ?? 'Your company');
  const short = shortName(name);
  const facts: any[] = r.facts ?? [];
  const sources: any[] = publicSources(r.sources);
  const contradictions: string[] = (r.contradictions ?? []).filter(Boolean);
  const gaps: string[] = (r.gaps ?? []).filter(Boolean);
  const everyone = (r.people?.people ?? []).filter((p: any) => p.name);
  const people = everyone.filter((p: any) => isLeadership(p.role));
  const staff = everyone.filter((p: any) => !isLeadership(p.role)).map((p: any) => String(p.name));
  /** Text written from the research, made fit for a public page. */
  const P = (t: unknown) => typeset(noCites(scrub(t, { phones: true, staff })));
  const domains: string[] = id.official_domains ?? [];
  const ssm = (id.registration_numbers ?? []).find((x: string) => /^\d{12}$/.test(x)) ?? (id.registration_numbers ?? [])[0] ?? null;
  const town = String(id.address ?? '').match(/\b\d{5}\s+([^,]+)/)?.[1]?.trim() ?? 'your town';
  // "Solar photovoltaic (PV) EPC, …" becomes "solar photovoltaic company", so the openers read as a sentence.
  const kind = String(id.industry ?? '').split(/[,(;]/)[0].trim().toLowerCase();
  const trade = !kind ? 'business like yours' : /\b(installer|contractor|company|firm|shop|clinic|agency|supplier|provider|consultant|service)s?$/.test(kind) ? kind : `${kind} company`;
  const claims = facts.filter((f) => CLAIM.test(String(f.fact ?? '')) && !/private limited/i.test(String(f.fact))).length;
  const made = dateOf(dive?.finished_at) || dateOf(new Date().toISOString());
  // finished_at may arrive as a Date, whose String() starts with the weekday.
  const year = String(new Date(dive?.finished_at ?? Date.now()).getFullYear());
  // The dive's number makes each preview a numbered edition, like a file reference.
  const ref = dive?.id != null && /^\d+$/.test(String(dive.id)) ? `No.${NB}${String(dive.id).padStart(4, '0')}` : '';
  const plural = (n: number, one: string, many = `${one}s`) => `${n}${NB}${n === 1 ? one : many}`;
  const srcN = plural(sources.length, 'public source');

  const known = notes?.known?.length ? notes.known : [
    id.industry && { label: 'What you do', value: clip(String(id.industry), 90) },
    id.address && { label: 'Head office', value: clip(String(id.address), 90) },
    ssm && { label: 'Registration', value: `SSM ${ssm}` },
    domains.length && { label: 'Websites', value: domains.join(', ') },
    (id.aliases ?? []).length && { label: 'Also known as', value: id.aliases.join(', ') },
    people[0] && { label: 'Leadership', value: `${people[0].name}${people[0].role ? `, ${people[0].role}` : ''}` },
  ].filter(Boolean) as { label: string; value: string }[];
  const warnings = (notes?.warnings?.length ? notes.warnings : fallbackWarnings(r)).map((w) => ({ ...w, title: P(w.title), detail: P(w.detail), risk: P(w.risk) }));
  const shown = warnings.slice(0, 5);
  // Every sign we hold beyond what this page shows stays locked for the full report.
  const moreSigns = Math.max(warnings.length - shown.length, contradictions.length + gaps.length - shown.length, 0);
  const typesFound = [...new Set(warnings.map((w) => w.type))];
  const signCount = Math.max(warnings.length, contradictions.length + gaps.length);
  const hook = notes?.hook ? P(notes.hook) : `This preview was prepared for ${name} alone, from ${sources.length} public sources. Here is what they say about you, and where they do not agree.`;

  const ctaHref = offer.order_url && /^https?:\/\//.test(offer.order_url) ? offer.order_url : '#order';
  const ctaAttrs = ctaHref === '#order' ? '' : ' target="_blank" rel="noopener"';
  const cta = (label: string, cls = 'btn') => `<a class="${cls}" href="${esc(ctaHref)}"${ctaAttrs}>${esc(label)}</a>`;

  // What each chapter of the full report unlocks for this company.
  const inside: Record<string, { know: string[]; locked: string }> = {
    reputation: { know: ['Which reviews still have no reply from you', 'Review spikes Google may hold back', 'What customers praise, ready for your website'], locked: '? of ? reviews answered' },
    findability: { know: ['What a search for your name shows: your own pages, third parties, outdated or negative results', 'Dead or broken pages of yours that search engines still index', `Your rank on Google Maps and in web search in ${town} and every town you serve`], locked: '#? on Google Maps' },
    ai: { know: ['How often AI assistants recommend you, and who instead', 'Every wrong phone, address or website they give out', 'The pages assistants read that list your rivals'], locked: '? of ? AI answers name you' },
    // The report's parts.
    contact: { know: ['Every phone, email and WhatsApp published about you, and where each one really leads', 'Old numbers, ex-staff lines and dead mailboxes still in public', 'Where Google Maps, directories and your site disagree'], locked: '? of ? contact details reach you' },
    understanding: { know: ['Whether a stranger can tell what you sell, and why you', 'What AI assistants and search engines get right, wrong or miss', 'Selling points nobody outside your site repeats'], locked: 'Understood ? out of 100' },
    voice: { know: ['Which reviews still have no reply from you', 'News, forum and social talk about you and your key people', 'What customers praise, ready for your website'], locked: '? of ? reviews answered' },
    credibility: { know: ['Bank Negara and Securities Commission alert lists', 'Court judgments and winding-up notices naming you', 'Your licences and awards, in their registers'], locked: '? of ? risk checks clear' },
    speed: { know: ['Google’s own speed, accessibility, best-practice and SEO scores for your homepage', 'How it does on a phone and on a computer, and what real visitors experienced', 'Google’s top fixes, biggest saving first'], locked: '? out of 100 on a phone' },
    assets: { know: ['Who holds each of your domains, and when it expires', 'Where your sites are hosted and who carries your email', 'Whether anyone can send email pretending to be you, and whether your mail servers are on spam blacklists', 'Forgotten subdomains, and lookalike domains held by someone else'], locked: '? risks across your domains' },
    news: { know: ['News stories and press that name you', 'Complaints and forum threads, in English and Malay', 'What is said about the people who run it'], locked: '? mentions, ? of them negative' },
    brand: { know: ['A score out of 100: how much of your offer an outsider learns without visiting your site', 'A five-second test of your homepage: can a first-time visitor tell what you sell?', 'Selling points nobody outside your site repeats, and details others have out of date'], locked: 'Understood ? out of 100' },
  };

  const css = `
:root { --ink:#111418; --grey:#5c636d; --muted:#8a9099; --line:#e6e8eb; --band:#f2f3f5; --paper:#fff; --dark:#0e1013; --dark2:#1b2129; --on-dark:#f3f4f6; --on-dark-2:#9aa1ab;
  --contra:#a15c07; --contra-bg:#fdf3e2; --missing:#475467; --missing-bg:#eef0f2; --outdated:#6941c6; --outdated-bg:#f1ecfd; --wrong:#b42318; --wrong-bg:#fdecea; --good:#067647;
  --display:"Inter Tight","Inter",system-ui,sans-serif; --body:"Inter",system-ui,sans-serif; --w:1120px; --gut:max(20px, calc((100vw - var(--w)) / 2)); }
* { box-sizing:border-box; } html { scroll-behavior:smooth; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
body { margin:0; background:var(--paper); color:var(--ink); font-family:var(--body); font-size:16px; line-height:1.55; }
h1,h2,h3,h4 { font-family:var(--display); font-weight:600; margin:0; letter-spacing:-0.025em; line-height:1.05; text-wrap:balance; } p { margin:0; } a { color:inherit; }
.g { color:var(--grey); } .dark .g { color:var(--on-dark-2); }
section { padding:96px var(--gut); scroll-margin-top:60px; } .dark { background:var(--dark); color:var(--on-dark); }
.eyebrow { font-size:12px; font-weight:600; letter-spacing:.14em; text-transform:uppercase; color:var(--muted); } .dark .eyebrow { color:var(--on-dark-2); }
h2 { font-size:clamp(34px,4.4vw,58px); max-width:16em; } .lead { font-size:19px; line-height:1.5; color:var(--grey); max-width:38em; } .dark .lead { color:var(--on-dark-2); }
.head { display:grid; gap:14px; margin-bottom:44px; }
.btn { display:inline-flex; align-items:center; gap:8px; background:#fff; color:var(--ink); font-weight:600; padding:14px 22px; text-decoration:none; font-size:15px; }
.btn.ink { background:var(--ink); color:#fff; } .btn.ghost { background:none; color:inherit; border:1px solid currentColor; opacity:.85; }
.btn:hover { opacity:.9; } .btn:focus-visible { outline:2px solid currentColor; outline-offset:3px; }
/* top bar */
.top { position:sticky; top:0; z-index:10; display:flex; justify-content:space-between; align-items:center; gap:16px; padding:10px var(--gut); background:rgba(14,16,19,.92); backdrop-filter:blur(10px); color:var(--on-dark); font-size:13px; }
.top b { font-weight:600; } .top span { color:var(--on-dark-2); } .top .btn { padding:9px 14px; font-size:13px; }
/* hero */
.hero { display:grid; grid-template-columns:minmax(0,1.35fr) minmax(0,1fr); gap:56px; align-items:center; padding-top:88px; padding-bottom:88px; }
.hero h1 { font-size:clamp(40px,5.6vw,76px); letter-spacing:-0.035em; line-height:1.02; margin-top:18px; }
.hero .lead { margin-top:22px; color:var(--on-dark); opacity:.86; } .ctas { display:flex; flex-wrap:wrap; gap:12px; margin-top:32px; }
.file { background:var(--paper); color:var(--ink); padding:26px; display:grid; gap:14px; box-shadow:0 30px 60px -30px rgba(0,0,0,.6); transform:rotate(1.2deg); }
.file .stamp { justify-self:start; font-size:11px; font-weight:700; letter-spacing:.12em; text-transform:uppercase; color:var(--wrong); border:2px solid var(--wrong); padding:3px 8px; transform:rotate(-3deg); }
.file h3 { font-size:24px; letter-spacing:-0.02em; } .file dl { margin:0; display:grid; gap:0; font-size:13.5px; }
.file dl div { display:grid; grid-template-columns:96px minmax(0,1fr); gap:10px; padding:7px 0; border-top:1px solid var(--line); } .file dt { color:var(--muted); } .file dd { margin:0; overflow-wrap:anywhere; }
.file .foot { font-size:12px; color:var(--muted); }
/* proof strip */
.strip { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:24px; padding:48px var(--gut); border-bottom:1px solid var(--line); }
.strip b { display:block; font-family:var(--display); font-size:clamp(40px,4.6vw,60px); font-weight:500; letter-spacing:-0.04em; line-height:1; } .strip span { font-size:14px; color:var(--grey); }
/* known */
.known { display:grid; grid-template-columns:repeat(auto-fill,minmax(240px,1fr)); gap:2px; background:var(--line); border:1px solid var(--line); }
.known div { background:var(--paper); padding:20px 22px; display:grid; gap:6px; align-content:start; } .known .k { font-size:12px; font-weight:600; letter-spacing:.1em; text-transform:uppercase; color:var(--muted); } .known .v { font-family:var(--display); font-size:19px; font-weight:500; letter-spacing:-0.01em; line-height:1.3; }
.people { display:flex; flex-wrap:wrap; gap:8px; margin-top:22px; } .people span { background:var(--band); padding:8px 12px; font-size:14px; } .people b { font-weight:600; }
.note { font-size:13px; color:var(--muted); margin-top:16px; }
/* warnings */
.warn-section { background:var(--band); }
.legend { display:flex; flex-wrap:wrap; gap:8px; margin-top:6px; }
.tag { display:inline-block; font-size:11px; font-weight:700; letter-spacing:.06em; text-transform:uppercase; padding:4px 9px; }
.tag.contra { color:var(--contra); background:var(--contra-bg); } .tag.missing { color:var(--missing); background:var(--missing-bg); } .tag.outdated { color:var(--outdated); background:var(--outdated-bg); } .tag.wrong { color:var(--wrong); background:var(--wrong-bg); }
.warns { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:14px; }
.warn { background:var(--paper); padding:24px; display:grid; gap:10px; align-content:start; border-top:3px solid var(--ink); }
.warn.contra { border-top-color:var(--contra); } .warn.missing { border-top-color:var(--missing); } .warn.outdated { border-top-color:var(--outdated); } .warn.wrong { border-top-color:var(--wrong); }
.warn h3 { font-size:21px; letter-spacing:-0.015em; line-height:1.2; } .warn .d { color:var(--grey); font-size:15px; } .warn .risk { font-size:14px; border-left:2px solid var(--ink); padding-left:10px; }
.warn.first { grid-column:1/-1; background:var(--dark); color:var(--on-dark); } .warn.first .d { color:var(--on-dark-2); } .warn.first .risk { border-left-color:#fff; } .warn.first h3 { font-size:clamp(24px,2.6vw,30px); }
.locked { background:var(--paper); padding:24px; display:grid; gap:12px; align-content:start; position:relative; overflow:hidden; border-top:3px solid var(--line); }
.locked .bar { height:12px; background:var(--band); } .locked .bar.s { width:62%; } .locked .bar.m { width:84%; }
.locked .lockmsg { position:absolute; inset:0; display:grid; place-content:center; text-align:center; gap:6px; background:linear-gradient(180deg, rgba(255,255,255,.2), rgba(255,255,255,.96) 55%); padding:20px; }
.locked .lockmsg b { font-family:var(--display); font-size:44px; font-weight:600; letter-spacing:-0.03em; line-height:1; } .locked .lockmsg span { font-size:14px; color:var(--grey); }
/* what has run: the surface scan behind this preview, then the deeper dive that has not */
.runs { display:grid; background:var(--paper); border:1px solid var(--line); margin-bottom:28px; }
.run { display:grid; grid-template-columns:40px minmax(0,1fr) 128px 200px; gap:18px; align-items:center; padding:14px 22px; border-top:1px solid var(--line); }
.run:first-child { border-top:0; } .run .rn { font-family:var(--display); font-size:15px; font-weight:600; color:var(--muted); }
.run .rw { display:grid; gap:2px; } .run .rw b { font-family:var(--display); font-size:17px; font-weight:600; letter-spacing:-0.01em; line-height:1.25; } .run .rw span { font-size:13.5px; color:var(--grey); }
.run .rs { justify-self:start; font-size:10.5px; font-weight:700; letter-spacing:.1em; text-transform:uppercase; color:var(--muted); border:1.5px dashed #b4bac2; padding:3px 8px; white-space:nowrap; }
.run .rc { display:grid; grid-template-columns:auto minmax(0,1fr); gap:10px; align-items:center; } .run .rc b { font-family:var(--display); font-size:30px; font-weight:600; letter-spacing:-0.03em; line-height:1; color:var(--muted); white-space:nowrap; } .run .rc span { font-size:12.5px; color:var(--grey); line-height:1.3; }
.run.done { background:var(--dark); color:var(--on-dark); border-top:0; } .run.done .rn, .run.done .rw span, .run.done .rc span { color:var(--on-dark-2); }
.run.done .rs { color:#8ee0b0; border:1.5px solid #8ee0b0; } .run.done .rc b { color:#ffb4ab; }
.run.step { background:#fafbfc; } .run.total { border-top:2px solid var(--ink); } .run.total .rc b { color:var(--ink); }
/* band */
.band-cta { display:grid; grid-template-columns:minmax(0,1fr) auto; gap:32px; align-items:center; padding-top:72px; padding-bottom:72px; }
.band-cta h2 { font-size:clamp(30px,3.4vw,46px); }
/* how it works */
.steps { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:14px; counter-reset:st; }
.steps div { counter-increment:st; display:grid; gap:6px; } .steps div::before { content:counter(st, decimal-leading-zero); font-family:var(--display); font-size:36px; font-weight:500; letter-spacing:-0.04em; color:var(--muted); }
.steps h3 { font-size:18px; } .steps p { font-size:14.5px; color:var(--grey); } .steps .now { color:var(--good); font-weight:600; font-size:12px; letter-spacing:.1em; text-transform:uppercase; }
.uses { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:14px; }
.uses div { background:var(--band); padding:22px; display:grid; gap:8px; align-content:start; border-top:3px solid var(--ink); }
.uses .un { font-family:var(--display); font-size:28px; font-weight:500; letter-spacing:-0.04em; line-height:1; color:var(--muted); }
.uses .ul { font-size:13px; font-weight:600; margin-top:6px; text-decoration:none; border-bottom:1px solid currentColor; justify-self:start; } .uses .ul:hover { opacity:.7; }
.thesis { text-align:center; display:grid; justify-items:center; gap:18px; padding-top:112px; padding-bottom:112px; border-bottom:1px solid var(--line); }
.thesis h2 { font-size:clamp(38px,5.4vw,72px); letter-spacing:-0.035em; max-width:none; } .thesis .lead { max-width:40em; }
.hero .anyone { margin-top:18px; font-size:13.5px; color:var(--on-dark-2); }
.uses h3 { font-size:19px; letter-spacing:-0.015em; line-height:1.2; } .uses p { font-size:14.5px; color:var(--grey); }
/* order */
.order { display:grid; grid-template-columns:minmax(0,1.2fr) minmax(0,1fr); gap:56px; align-items:center; }
.order .panel { background:var(--dark2); padding:32px; display:grid; gap:14px; } .order .price { font-family:var(--display); font-size:48px; font-weight:600; letter-spacing:-0.03em; line-height:1; }
.order ul { margin:0; padding-left:18px; color:var(--on-dark-2); display:grid; gap:6px; font-size:15px; }
footer { padding:48px var(--gut) 64px; font-size:13px; color:var(--grey); display:grid; gap:12px; }
details > summary { cursor:pointer; font-family:var(--display); font-weight:600; font-size:17px; padding:12px 0; border-top:1px solid var(--line); color:var(--ink); }
.dossier { display:grid; gap:8px; font-size:14px; color:var(--ink); max-width:72ch; } .dossier h4, .dossier h5, .dossier h6 { font-family:var(--display); font-size:16px; margin-top:10px; }
.dossier table { width:100%; border-collapse:collapse; font-size:13px; } .dossier td, .dossier th { padding:6px 8px; text-align:left; vertical-align:top; } .dossier tbody tr:nth-child(odd) td { background:var(--band); }
.plain { margin:0; padding-left:18px; display:grid; gap:4px; } a.cite { font-size:.75em; text-decoration:none; vertical-align:super; color:var(--grey); }
ol.sources { padding-left:28px; display:grid; gap:2px; font-size:12px; } ol.sources li { overflow-wrap:anywhere; }
/* inside the full report: the seven parts */
/* seven cards in rows of three: the last one runs the full row, its list in three columns */
.parts a.wide { grid-column:1 / -1; } .parts a.wide ul { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); column-gap:24px; }
.parts { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:14px; }
.parts a { background:var(--dark2); color:var(--on-dark); padding:28px; display:grid; gap:12px; align-content:start; text-decoration:none; border-top:3px solid #fff; }
.parts a:hover { background:#232a34; } .parts .n { font-family:var(--display); font-size:56px; font-weight:500; letter-spacing:-0.04em; line-height:1; color:var(--on-dark-2); }
.parts h3 { font-size:26px; letter-spacing:-0.02em; } .parts p { color:var(--on-dark-2); font-size:15px; }
.parts li.hl { color:#fff; font-weight:600; padding-left:12px; border-left:3px solid #fff; }
.parts ul { margin:0; padding:0; list-style:none; font-size:14px; } .parts li { padding:8px 0; border-top:1px solid rgba(255,255,255,.12); } .parts .go { font-size:13px; font-weight:600; margin-top:6px; }
.feats { display:grid; gap:64px; }
.feat { display:grid; grid-template-columns:minmax(0,1.1fr) minmax(0,1fr); gap:56px; align-items:center; } .feat:nth-child(even) .mock { order:2; }
.feat .txt { display:grid; gap:12px; align-content:start; } .feat .n { font-family:var(--display); font-size:15px; font-weight:600; color:var(--muted); }
.feat h3 { font-size:clamp(24px,2.6vw,32px); letter-spacing:-0.02em; line-height:1.15; } .feat .what { color:var(--grey); }
.feat ul { margin:0; padding:0; list-style:none; display:grid; gap:0; font-size:15px; } .feat li { padding:9px 0 9px 22px; border-top:1px solid var(--line); position:relative; } .feat li::before { content:"→"; position:absolute; left:0; color:var(--muted); }
.feat .hlb { display:inline-block; background:var(--ink); color:#fff; font-size:10.5px; font-weight:700; letter-spacing:.12em; text-transform:uppercase; padding:3px 8px; margin-right:10px; }
.feat .q { font-family:var(--display); font-size:17px; color:var(--grey); margin-top:-4px; } .feat.spot .mock { box-shadow:inset 0 3px 0 var(--ink); }
.m-serp { background:#fff; padding:14px 16px; display:grid; gap:10px; box-shadow:0 1px 3px rgba(0,0,0,.07); } .m-q { font-size:13px; border:1px solid var(--line); border-radius:20px; padding:6px 14px; justify-self:stretch; }
.m-hit { display:grid; grid-template-columns:minmax(0,1fr) auto; gap:4px 10px; align-items:center; } .m-hit .m-host { grid-column:1; } .m-hit .pill { grid-column:2; grid-row:1 / span 2; font-size:10px; }
.feat .lockline { font-size:12px; font-weight:700; letter-spacing:.1em; text-transform:uppercase; }
/* placeholder visuals, drawn like the full report's own */
.mock { background:var(--band); padding:28px; display:grid; gap:14px; position:relative; margin:0; align-content:start; }
.mock .cap, .tile .cap { font-size:12.5px; color:var(--muted); line-height:1.45; }
.m-lock { justify-self:start; font-size:10.5px; font-weight:700; letter-spacing:.12em; text-transform:uppercase; color:var(--grey); border:1px solid #c9ced4; padding:3px 8px; background:var(--paper); }
.rd { display:inline-block; height:9px; background:#d3d8de; border-radius:2px; vertical-align:middle; max-width:100%; }
.m-card { background:#fff; padding:16px 18px; display:grid; gap:9px; box-shadow:0 1px 3px rgba(0,0,0,.07); }
.m-top { display:flex; align-items:center; gap:10px; font-size:13px; } .m-av { flex:none; width:30px; height:30px; border-radius:50%; background:#c9ced4; display:grid; place-items:center; color:#fff; font-weight:700; font-size:13px; }
.m-stars { color:#e8a500; letter-spacing:1px; font-size:13px; } .m-stars i { color:#d3d8de; font-style:normal; }
.m-noreply { font-size:12px; font-weight:700; color:var(--wrong); }
.m-bars { display:flex; align-items:flex-end; gap:3px; height:72px; border-bottom:1px solid #c9ced4; } .m-bars i { flex:1; background:#bfc5cc; } .m-bars i.hot { background:var(--wrong); }
.m-board { width:100%; border-collapse:collapse; font-size:13.5px; background:#fff; } .m-board td { padding:10px 12px; border-top:1px solid var(--line); vertical-align:middle; }
.m-board .rk { width:48px; font-weight:600; color:var(--muted); } .m-board .num { width:64px; text-align:right; color:var(--muted); font-size:12.5px; white-space:nowrap; }
.m-board .me td { background:var(--ink); color:#fff; font-weight:600; } .m-board .me .rk, .m-board .me .num { color:#fff; }
.m-board .gap td { color:var(--muted); font-size:12px; text-align:center; background:var(--band); padding:6px; }
.m-meter { display:block; height:8px; background:var(--band); } .m-meter i { display:block; height:100%; background:#9aa1ab; }
.m-ask { background:#fff; padding:12px 16px; border-radius:16px 16px 16px 4px; font-size:14px; justify-self:start; max-width:92%; box-shadow:0 1px 3px rgba(0,0,0,.07); }
.m-stack { display:flex; height:14px; } .m-stack i { display:block; } .s-good { background:var(--good); } .s-fix { background:#e0a43a; } .s-urgent { background:var(--wrong); } .s-none { background:#bfc5cc; }
.kk { display:inline-block; width:9px; height:9px; margin:0 3px 0 8px; vertical-align:baseline; } .kk:first-child { margin-left:0; }
.m-browser { background:#fff; box-shadow:0 1px 3px rgba(0,0,0,.08); } .m-url { display:flex; gap:10px; align-items:center; padding:9px 12px; background:#e6e9ec; font-size:12px; color:var(--grey); overflow:hidden; white-space:nowrap; }
.m-url .dots { display:flex; gap:5px; } .m-url .dots i { width:9px; height:9px; border-radius:50%; background:#c4c9cf; }
.m-page { padding:20px; display:grid; gap:10px; position:relative; min-height:210px; align-content:start; } .m-boxes { display:grid; grid-template-columns:repeat(3,1fr); gap:8px; margin-top:10px; } .m-boxes span { height:62px; background:var(--band); }
.m-pin { position:absolute; background:var(--wrong); color:#fff; font-size:11px; font-weight:700; letter-spacing:.03em; padding:4px 8px; box-shadow:0 4px 10px -4px rgba(180,35,24,.6); }
.m-btn { justify-self:start; background:var(--ink); color:#fff; font-size:11px; font-weight:600; padding:7px 12px; }
/* the parts */
.pt { border-top:1px solid var(--line); }
.m-score { display:grid; grid-template-columns:1fr 1fr; gap:8px; } .m-score div { background:#fff; padding:14px 16px; display:grid; gap:4px; box-shadow:0 1px 3px rgba(0,0,0,.07); }
.m-score b { font-family:var(--display); font-size:34px; font-weight:600; letter-spacing:-0.03em; line-height:1; } .m-score small { font-size:14px; color:var(--muted); font-weight:500; } .m-score span { font-size:12px; color:var(--grey); }
.m-matrix { width:100%; border-collapse:collapse; background:#fff; font-size:12.5px; } .m-matrix th { font-size:10px; letter-spacing:.1em; text-transform:uppercase; color:var(--muted); font-weight:600; padding:9px 4px; text-align:center; }
.m-matrix td { padding:8px 4px; border-top:1px solid var(--line); text-align:center; } .m-matrix td:first-child { text-align:left; font-weight:500; padding-left:12px; }
.m-dot { display:inline-grid; place-items:center; width:20px; height:20px; border-radius:50%; background:var(--band); color:var(--muted); font-size:11px; font-weight:700; }
.m-dom { background:#fff; box-shadow:0 1px 3px rgba(0,0,0,.07); } .m-dom h4 { margin:0; padding:11px 16px; background:var(--ink); color:#fff; font-family:ui-monospace,SFMono-Regular,Consolas,monospace; font-size:13.5px; font-weight:600; letter-spacing:0; }
.m-dom dl { margin:0; font-size:12.5px; } .m-dom dl div { display:grid; grid-template-columns:minmax(0,1.15fr) minmax(0,1fr); gap:10px; padding:7px 16px; border-top:1px solid var(--line); align-items:center; } .m-dom dt { color:var(--grey); } .m-dom dd { margin:0; color:var(--muted); }
.m-look { display:flex; flex-wrap:wrap; gap:6px; } .m-look span { font-family:ui-monospace,SFMono-Regular,Consolas,monospace; font-size:12px; background:#fff; padding:6px 10px; border:1px dashed #b4bac2; }
.srcs { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:2px; background:var(--line); border:1px solid var(--line); }
.srcs div { background:var(--paper); padding:18px; display:grid; gap:8px; align-content:start; } .srcs b { font-family:var(--display); font-size:17px; font-weight:600; letter-spacing:-0.01em; line-height:1.25; }
.srcs span { font-size:13.5px; color:var(--grey); } .srcs .res { font-size:10.5px; font-weight:700; letter-spacing:.1em; text-transform:uppercase; color:var(--muted); border-top:1px solid var(--line); padding-top:8px; margin-top:4px; }
.sub3 { font-size:clamp(22px,2.2vw,28px); letter-spacing:-0.02em; margin:48px 0 18px; }
.nochk { margin-top:22px; padding:16px 18px; background:var(--paper); border-left:3px solid var(--muted); font-size:14px; color:var(--grey); max-width:60em; } .nochk b { color:var(--ink); font-weight:600; }
/* credibility ledger */
.cred { display:grid; grid-template-columns:minmax(0,1fr); gap:0; }
.ledger { width:100%; border-collapse:collapse; background:var(--paper); font-size:15px; }
.ledger th { text-align:left; font-size:11.5px; letter-spacing:.1em; text-transform:uppercase; color:var(--muted); padding:14px 20px; font-weight:600; border-bottom:2px solid var(--ink); }
.ledger td { padding:18px 20px; border-top:1px solid var(--line); vertical-align:top; } .ledger tr:first-child td { border-top:0; }
.ledger .said { display:grid; gap:6px; } .ledger .said b { font-weight:500; } .ledger .where { color:var(--grey); font-size:14px; width:30%; } .ledger .res { width:1%; white-space:nowrap; }
.ledger .src { font-size:10.5px; font-weight:700; letter-spacing:.1em; text-transform:uppercase; color:var(--muted); }
.ledger tr.hidden td { background:#fafbfc; }
.vstamp { display:inline-block; font-size:11px; font-weight:700; letter-spacing:.12em; text-transform:uppercase; border:2px dashed #b4bac2; color:var(--muted); padding:4px 9px; transform:rotate(-2deg); }
.outcomes { display:flex; flex-wrap:wrap; gap:8px; align-items:center; margin-top:20px; font-size:13px; color:var(--grey); }
.pill { display:inline-block; font-size:11px; font-weight:700; letter-spacing:.06em; text-transform:uppercase; padding:4px 9px; }
.pill.good { color:var(--good); background:#e5f4ec; } .pill.bad { color:var(--wrong); background:var(--wrong-bg); } .pill.amb { color:var(--contra); background:var(--contra-bg); } .pill.none { color:var(--missing); background:var(--missing-bg); }
/* analysis and suggestions */
.tiles { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:14px; }
.tile { background:var(--band); padding:24px; display:grid; gap:12px; align-content:start; } .tile.wide { grid-column:span 2; }
.tile h3 { font-size:20px; letter-spacing:-0.015em; } .tile > p { font-size:14.5px; color:var(--grey); }
.tile .in { background:#fff; padding:16px; display:grid; gap:9px; font-size:13px; box-shadow:0 1px 3px rgba(0,0,0,.07); }
.m-fix { display:grid; grid-template-columns:26px minmax(0,1fr) auto auto; gap:10px; align-items:center; padding:9px 0; border-top:1px solid var(--line); } .m-fix:first-child { border-top:0; }
.m-fix .no { font-family:var(--display); font-weight:600; color:var(--muted); } .m-pill { font-size:10px; font-weight:700; letter-spacing:.06em; text-transform:uppercase; padding:3px 7px; background:var(--band); color:var(--grey); white-space:nowrap; } .m-pill.hi { color:var(--wrong); background:var(--wrong-bg); }
.m-depts { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:12px; } .m-depts div { display:grid; gap:8px; align-content:start; } .m-depts b { font-size:10.5px; letter-spacing:.1em; text-transform:uppercase; }
.m-task { display:grid; grid-template-columns:12px minmax(0,1fr); gap:7px; align-items:center; } .m-task i { width:11px; height:11px; border:1.5px solid var(--muted); }
.m-reply { background:var(--ink); padding:12px 14px; border-radius:12px 12px 4px 12px; justify-self:end; width:86%; display:grid; gap:7px; } .m-reply .rd { background:rgba(255,255,255,.32); } .m-reply small { color:#c9ced4; font-size:10.5px; font-weight:600; letter-spacing:.1em; text-transform:uppercase; }
.m-slug { font-family:ui-monospace,SFMono-Regular,Consolas,monospace; font-size:12.5px; background:#fff; padding:9px 12px; border-left:3px solid var(--ink); overflow-wrap:anywhere; }
.m-code { margin:0; background:var(--dark); color:#c9d1d9; font-family:ui-monospace,SFMono-Regular,Consolas,monospace; font-size:12px; padding:16px; line-height:1.7; white-space:pre-wrap; overflow-wrap:anywhere; } .m-code .rd { background:rgba(255,255,255,.22); height:8px; }
.m-faq { display:grid; gap:6px; padding:9px 0; border-top:1px solid var(--line); } .m-faq:first-child { border-top:0; } .m-faq b { font-size:13px; }
/* the craft layer: type set like print, figures that line up, one label scale */
body { font-kerning:normal; text-rendering:optimizeLegibility; font-feature-settings:"kern","calt"; }
.dark, .order .panel, .parts a, .warn.first, .m-code, .m-board .me { -webkit-font-smoothing:antialiased; -moz-osx-font-smoothing:grayscale; }
p, li, dd, figcaption, .cap, .known .v { text-wrap:pretty; }
.lead, .m-ask, .warn .d, .warn .risk, .known .v { hanging-punctuation:first allow-end; }
.strip b, .run .rc b, .lockmsg b, .price, .m-board, .ledger, .m-score b, .steps div::before, .uses .un, .parts .n, .m-fix, .file dd, .fileno, ol.sources, .colophon { font-variant-numeric:tabular-nums lining-nums; }
::selection { background:var(--ink); color:#fff; } .dark ::selection, .order .panel ::selection { background:#fff; color:var(--ink); }
a:focus-visible { outline:2px solid currentColor; outline-offset:3px; }
.filehead { display:flex; justify-content:space-between; align-items:center; gap:12px; } .fileno { font-size:11px; font-weight:600; letter-spacing:.1em; text-transform:uppercase; color:var(--muted); }
.file dd.nf { color:var(--muted); font-style:italic; }
.empty { font-family:var(--display); font-size:21px; font-weight:500; letter-spacing:-0.01em; line-height:1.35; color:var(--grey); max-width:32em; padding:22px 24px; border-left:3px solid var(--ink); background:var(--band); }
.colophon { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:18px; padding-top:20px; margin-top:8px; border-top:1px solid var(--line); }
.colophon div { display:grid; gap:4px; align-content:start; } .colophon .k { font-size:11px; font-weight:600; letter-spacing:.1em; text-transform:uppercase; color:var(--muted); } .colophon span:not(.k) { color:var(--ink); font-size:13.5px; }
footer .muted { color:var(--muted); font-weight:500; }
@media (max-width:900px) {
  .colophon { grid-template-columns:1fr 1fr; }
  section { padding-top:64px; padding-bottom:64px; } .hero { grid-template-columns:1fr; gap:40px; padding-top:56px; } .file { transform:none; }
  .parts { grid-template-columns:1fr; } .parts a.wide ul { grid-template-columns:1fr; } .srcs { grid-template-columns:1fr 1fr; } .feat { grid-template-columns:1fr; gap:28px; } .feat:nth-child(even) .mock { order:0; } .tiles { grid-template-columns:1fr 1fr; }
  .strip { grid-template-columns:1fr 1fr; } .warns { grid-template-columns:1fr; } .band-cta, .order { grid-template-columns:1fr; }
  .uses { grid-template-columns:1fr 1fr; } .steps { grid-template-columns:1fr 1fr; } .top span.for { display:none; } .lead { font-size:17px; }
}
@media (max-width:700px) {
  .ledger thead { display:none; } .ledger tr { display:grid; gap:8px; padding:16px 18px; border-top:1px solid var(--line); } .ledger tr:first-child { border-top:0; }
  .ledger td { display:block; padding:0; border:0; width:auto !important; } .ledger .where::before { content:"Checked against: "; font-weight:600; color:var(--ink); }
  .run { grid-template-columns:28px minmax(0,1fr); gap:6px 12px; padding:14px 16px; } .run .rs, .run .rc { grid-column:2; } .run .rc b { font-size:24px; }
}
@media (max-width:560px) { .uses, .tiles, .srcs { grid-template-columns:1fr; } .tile.wide { grid-column:auto; } .m-depts { grid-template-columns:1fr 1fr; } .mock { padding:18px; } .m-fix { grid-template-columns:22px minmax(0,1fr) auto; } .m-fix .eff { display:none; } }
@page { size:A4; margin:14mm 12mm 16mm;
  @bottom-left { content:${cssStr(`${name} · Online Presence Audit ${year} · Preview`)}; font:500 8.5px/1 "Inter",system-ui,sans-serif; color:#8a9099; letter-spacing:.02em; }
  @bottom-right { content:counter(page) " / " counter(pages); font:500 8.5px/1 "Inter",system-ui,sans-serif; color:#8a9099; font-variant-numeric:tabular-nums; } }
@media print {
  .top, .ctas, .band-cta .btn, .parts .go, .uses .ul { display:none; }
  html { scroll-behavior:auto; } section { padding:32px 28px; } .hero, .thesis { padding-top:44px; padding-bottom:44px; }
  .file { transform:none; box-shadow:none; border:1px solid var(--line); }
  .head, h2, h3, .sub3, .eyebrow { break-after:avoid; } .head { break-inside:avoid; } p, li { orphans:3; widows:3; }
  .warn, .locked, .uses div, .feat, .mock, .tile, .parts a, .ledger tr, .known div, .srcs div, .steps div, .runs, .strip, .order .panel, .colophon { break-inside:avoid; }
  details > :not(summary) { display:block; } details::details-content { display:block; content-visibility:visible; } details > summary { list-style:none; }
  a.btn[href^="http"]::after { content:" · " attr(href); font-weight:400; }
}
${PARTNERS_CSS}`;

  const warnCard = (w: NonNullable<PreviewNotes['warnings']>[number], first = false) => {
    const [label, cls] = TYPE[w.type] ?? TYPE.contradiction;
    return `<article class="warn ${cls}${first ? ' first' : ''}"><span class="tag ${cls}">${esc(label)}</span><h3>${esc(tie(w.title))}</h3>${w.detail ? `<p class="d">${esc(w.detail)}</p>` : ''}${w.risk ? `<p class="risk">${esc(w.risk)}</p>` : ''}</article>`;
  };
  // ---------- inside the full report ----------
  // Placeholder versions of the full report's visuals: grey bars where this company's numbers go.
  const rd = (w: string) => `<span class="rd" style="width:${w}"></span>`;
  const site = domains[0] ?? 'your website';
  const sites = domains.length ? domains.join(', ') : 'your website';
  const leader = people[0]?.name ? String(people[0].name) : '';
  const word = String(domains[0] ?? '').split('.')[0];
  const lookalikes = word ? [`${word}.com`, `${word}.my`, `${word}.com.my`].filter((d) => !domains.includes(d)) : [];
  const query = `${kind || 'business'} ${town === 'your town' ? 'near me' : `in ${town}`}`;
  const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const pageSlug = `/${slug(kind.split(/\s+/).slice(-2).join(' ') || 'services')}${town === 'your town' ? '' : `-${slug(town)}`}`;

  const mocks: Record<string, string> = {
    reputation: `<figure class="mock" aria-label="Sample of the reviews chapter"><span class="m-lock">Your reviews go here</span>
      <div class="m-card"><div class="m-top"><span class="m-av">?</span><div style="display:grid;gap:6px;flex:1">${rd('38%')}<span class="m-stars">★<i>★★★★</i></span></div></div>${rd('96%')}${rd('88%')}${rd('62%')}<p class="m-noreply">No reply from the owner for ? days</p></div>
      <div class="m-bars" aria-hidden="true">${[22, 30, 18, 26, 40, 34, 28, 100, 36, 24, 30, 44, 38, 26, 32, 48, 30, 42].map((h, i) => `<i${i === 7 ? ' class="hot"' : ''} style="height:${h}%"></i>`).join('')}</div>
      <figcaption class="cap">Every Google review on your listings, month by month. Red marks a one-day spike Google may hold back.</figcaption></figure>`,
    findability: `<figure class="mock" aria-label="Sample of the search chapter"><span class="m-lock">Your search results go here</span>
      <div class="m-serp"><p class="m-q">${esc(short)}</p>${[['Your page', '', '70%'], ['Third party', 'amb', '58%'], ['Dead page, still indexed', 'bad', '64%']].map(([t, c, w]) => `<div class="m-hit"><span class="m-host">${rd('30%')}</span>${rd(w)}<span class="pill ${c || 'none'}">${t}</span></div>`).join('')}</div>
      <table class="m-board"><tbody>${[['62%', 92], ['48%', 74], ['55%', 60]].map(([w, m], i) => `<tr><td class="rk">#${i + 1}</td><td>${rd(String(w))}</td><td style="width:30%"><span class="m-meter"><i style="width:${m}%"></i></span></td><td class="num">? reviews</td></tr>`).join('')}
      <tr class="gap"><td colspan="4">? more businesses before you</td></tr>
      <tr class="me"><td class="rk">#?</td><td colspan="2">You · ${esc(short)}</td><td class="num">? reviews</td></tr></tbody></table>
      <figcaption class="cap">What a search for your name shows, then Google Maps and web search for “${esc(query)}” in every town you serve.</figcaption></figure>`,
    ai: `<figure class="mock" aria-label="Sample of the AI assistants chapter"><span class="m-lock">Your AI answers go here</span>
      <p class="m-ask">“Who is the best ${esc(query)}?”</p>
      <table class="m-board"><tbody>${[['44%', 88], ['58%', 66], ['36%', 40]].map(([w, m]) => `<tr><td>${rd(String(w))}</td><td style="width:34%"><span class="m-meter"><i style="width:${m}%"></i></span></td><td class="num">? of ?</td></tr>`).join('')}
      <tr class="me"><td>You · ${esc(short)}</td><td></td><td class="num">? of ?</td></tr></tbody></table>
      <span class="m-stack" aria-hidden="true"><i class="s-good" style="width:34%"></i><i class="s-fix" style="width:18%"></i><i class="s-urgent" style="width:22%"></i><i class="s-none" style="width:26%"></i></span>
      <figcaption class="cap">Asked about you by name: <span class="kk s-good"></span>right <span class="kk s-fix"></span>partly right <span class="kk s-urgent"></span>wrong <span class="kk s-none"></span>did not know you</figcaption></figure>`,
    contact: `<figure class="mock" aria-label="Sample of the contact part"><span class="m-lock">Your contact details go here</span>
      <table class="m-board"><tbody>${[['Phone', 'Your website', 'Reaches you', 'good'], ['WhatsApp', 'Google Maps', 'A staff member’s own', 'amb'], ['Phone', 'A directory', 'Another business uses it', 'bad'], ['Email', 'An old job ad', 'Someone who has left', 'bad'], ['Address', 'Maps vs your site', 'Out of date', 'amb']].map(([t, w, v, c], i) => `<tr><td class="rk" style="width:78px">${t}</td><td>${rd(['70%', '64%', '58%', '76%', '52%'][i])}<span class="cap" style="display:block;margin-top:5px">${w}</span></td><td class="num" style="width:auto"><span class="pill ${c}">${v}</span></td></tr>`).join('')}</tbody></table>
      <figcaption class="cap">Sample results. Each detail ends with one: reaches you, out of date, someone else’s, a staff member’s own or someone who left, or broken.</figcaption></figure>`,
    brand: `<figure class="mock" aria-label="Sample of how the internet understands you"><span class="m-lock">Your scores go here</span>
      <div class="m-score"><div><b>?<small>/100</small></b><span>how well the internet understands you</span></div><div><b>?</b><span>five-second test of your homepage</span></div></div>
      <table class="m-matrix"><thead><tr><th></th>${['Your site', 'Search', 'AI', 'Directories'].map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${['What you sell', 'Why choose you', 'Proof of your selling points', 'Up to date'].map((r) => `<tr><td>${r}</td>${'<td><span class="m-dot">?</span></td>'.repeat(4)}</tr>`).join('')}</tbody></table>
      <figcaption class="cap">Your offer, your reason to be chosen and its proof, as your own pages, search results, AI assistants and directories tell them.</figcaption></figure>`,
    news: `<figure class="mock" aria-label="Sample of the news and discussion part"><span class="m-lock">What people say goes here</span>
      <table class="m-board"><tbody>${[['News', 'Neutral', 'none'], ['Forum', 'Negative', 'bad'], ['Facebook', 'Positive', 'good'], [leader ? `About ${leader}` : 'About a director', '?', 'none']].map(([t, v, c], i) => `<tr><td class="rk" style="width:auto;max-width:130px">${esc(t)}</td><td>${rd(['84%', '70%', '62%', '76%'][i])}<span class="cap" style="display:block;margin-top:5px;white-space:nowrap">${rd('60px')} · date ?</span></td><td class="num" style="width:auto"><span class="pill ${c}">${v}</span></td></tr>`).join('')}</tbody></table>
      <figcaption class="cap">News, Lowyat, Reddit and Facebook threads, complaints and press about your company, your brand and the people who run it, each dated, with a quote.</figcaption></figure>`,
    assets: `<figure class="mock" aria-label="Sample of the digital assets part"><span class="m-lock">Your domains go here</span>
      ${(domains.length ? domains.slice(0, 2) : ['your-domain.my']).map((d) => `<div class="m-dom"><h4>${esc(d)}</h4><dl>${[['Registrar', rd('60%')], ['Expires', rd('40%')], ['Registered to', rd('70%')], ['Hosted by', rd('56%')], ['Email carried by', rd('50%')], ['Can anyone send email as you?', '<span class="pill none">?</span>'], ['Mail servers on spam blacklists', '<span class="pill none">?</span>'], ['Certificate and site software', rd('62%')], ['Subdomains in public logs', '? found']].map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl></div>`).join('')}
      ${lookalikes.length ? `<div class="m-look">${lookalikes.map((d) => `<span>${esc(d)} · ?</span>`).join('')}</div>` : ''}
      <figcaption class="cap">From MYNIC and the international registries, DNS, the hosting network, the Barracuda and SpamCop spam blacklists and public certificate logs${lookalikes.length ? ', plus the lookalike domains above: free, or held by someone else' : ''}.</figcaption></figure>`,
    speed: `<figure class="mock" aria-label="Sample of the website speed part"><span class="m-lock">Google’s scores go here</span>
      <div class="m-score">${[['Speed', 'on a phone'], ['Accessibility', 'can everyone use it'], ['Best practices', 'built to current standards'], ['SEO', 'can Google read it']].map(([k, v]) => `<div><b>?<small>/100</small></b><span><b style="font-size:12px;letter-spacing:0">${k}</b> · ${v}</span></div>`).join('')}</div>
      <table class="m-board"><tbody>${['70%', '56%', '64%'].map((w, i) => `<tr><td class="rk">${i + 1}</td><td>${rd(w)}</td><td class="num">saves ? s</td></tr>`).join('')}</tbody></table>
      <figcaption class="cap">Google PageSpeed Insights on ${esc(domains.length ? domains.join(', ') : 'your homepage')}, on a phone and a computer, with Google’s own top fixes, biggest saving first.</figcaption></figure>`,
  };
  const what: Record<string, string> = {
    reputation: 'We read every Google review on every listing you have, and every reply you wrote back.',
    findability: `We search your name and your trade the way a customer does, on the web and on Google Maps, in ${town} and every town you serve. You see what search engines hold about you, and who shows up before you.`,
    ai: 'We ask AI assistants the questions your customers ask, many times over: who to hire, and what they know about you by name, from memory and with a web search.',
    contact: 'We collect each phone, email, WhatsApp number and address from your sites, your Google Maps listings and the wider web, search each one to see where else it appears and under whose name, and test that it still works.',
    brand: `We read your own pitch on ${sites}, then what search results, independent pages and AI assistants say you do, and compare them as a marketer would. Every page of your site is opened too, so empty, dead and out-of-date pages show up here.`,
    news: `We search the news, forum threads and social posts for ${short}, in English and Malay, and for up to three of the people who run it. Namesakes are weeded out, and what remains is sorted positive, neutral or negative.`,
    assets: 'We look up each of your domains in the MYNIC and international registries, read its DNS, hosting and email set-up, check your mail servers against spam blacklists and read the SPF, DKIM and DMARC records that prove your email is really yours, test its certificate and website software, and search the public certificate logs for forgotten subdomains.',
    speed: `We run Google PageSpeed Insights, Google’s own test, on ${sites}, on a phone and on a computer, and read what real Chrome visitors experienced over the last 28 days, when Google has enough of them on record.`,
  };
  // AI and search lead part 2: they are where most customers now meet a business first.
  const spotlight: Record<string, string> = { ai: 'How top AI sees your brand', findability: 'How search engines index your company' };
  const title: Record<string, string> = { ...spotlight, reputation: 'Every Google review, and every reply', contact: 'Every way to reach you, traced', brand: 'Whether a stranger can tell what you sell, and why you', news: 'News, forums and social talk about you', assets: 'Every domain that carries your name', speed: 'Google’s own test of your website' };
  /** One topic of a part: its placeholder visual beside what it checks and what the report gives. */
  const feat = (c: string) => `<div class="feat${spotlight[c] ? ' spot' : ''}">${mocks[c]}<div class="txt"><span class="n">${spotlight[c] ? '<span class="hlb">Highlight</span>' : ''}${esc(CHAPTER_EYEBROW[c] ?? '')}</span><h3>${esc(tie(title[c]))}</h3>${OPENERS[c] ? `<p class="q">${esc(OPENERS[c].q[0])} ${esc(OPENERS[c].q[1])}</p>` : ''}<p class="what">${esc(what[c])}</p><ul>${inside[c].know.map((k) => `<li>${esc(k)}</li>`).join('')}</ul><p class="lockline">In your report: ${esc(inside[c].locked)}</p></div></div>`;
  const partHead = (n: number, id: string, lead: string) => `<div class="head"><p class="eyebrow">Part ${n} · ${esc(CHAPTER_EYEBROW[id])}</p><h2>${esc(PART_OPENERS[id].q[0])}<br><span class="g">${esc(PART_OPENERS[id].q[1])}</span></h2><p class="lead">${lead}</p></div>`;
  const officialSources: [string, string][] = [
    ['Bank Negara alert list', 'The Financial Consumer Alert list of unlicensed companies and schemes'],
    ['Securities Commission alerts', 'Investor alerts naming unauthorised firms'],
    ['Court judgments', 'Published judgments naming the company or its key people'],
    ['Winding-up and bankruptcy', 'Insolvency notices that name the company or its directors'],
    ['Bursa Malaysia', 'Whether you are listed, with public annual reports'],
    ['Government sites', '.gov.my tender awards, vendor lists, grants and penalties naming you'],
    ['Published financials', 'Revenue and other figures third parties publish about you'],
    ['Trademark signals', 'Filings and listings that mention your name, and anyone else using it'],
    ['Licence and award registers', claims > 1 ? `Each of your ${claims} licence and award claims, in its issuer’s register` : claims === 1 ? 'Your licence or award claim, in its issuer’s register' : 'Each licence and award you claim, in its issuer’s register'],
  ];

  // The credibility check: this company's own claims and warning signs, each with where it gets checked.
  const registerFor = (t: string) => /\bCIDB\b|\bG[1-7]\b|grade/i.test(t) ? 'CIDB contractor register'
    : /\bSEDA\b|RPVSP|RPVI/i.test(t) ? 'SEDA registered provider directories'
    : /MyHIJAU/i.test(t) ? 'MyHIJAU directory'
    : /award|winner/i.test(t) ? 'The award organiser’s list of winners'
    : /member|association/i.test(t) ? 'The association’s member list'
    : /ISO|certif|accredit/i.test(t) ? 'The certification body’s register'
    : 'The issuing body’s own register, where one exists';
  // Judged on the title first, so a detail that mentions "About page" or "links" does not decide it.
  const checkOne = (t: string) => /\b(CIDB|SEDA|MyHIJAU|ISO|licen[cs]e?d?|certif\w*|accredit\w*|award|member)\b/i.test(t) ? registerFor(t)
    : /\b(SSM|registration|registry|register(ed)?|incorporat\w*|directors?|owners?|ownership|shareholders?|capital|revenue|financ\w*|accounts|headcount|employees?|staff)\b/i.test(t) ? 'Company registers and public records'
    : /\b(reviews?|ratings?|stars?)\b/i.test(t) ? 'Every Google review on your listings'
    : /\b(AI|ChatGPT|assistants?)\b/i.test(t) ? 'AI assistants, asked about you by name'
    : /\b(maps|listings?|address(es)?|location|office|phones?|contact)\b/i.test(t) ? 'Google Maps, your websites and directories'
    : /\b(websites?|domains?|pages?|links?|site)\b/i.test(t) ? 'Every page of your websites'
    : '';
  const checkFor = (title: string, detail: string) => checkOne(title) || checkOne(detail) || 'Public registers and records';
  const claimRows = facts.map((f) => String(f.fact ?? '')).filter((f) => CLAIM.test(f) && !/private limited/i.test(f)).slice(0, 3)
    .map((f) => ({ src: 'Your claim', said: clip(P(f), 120), where: registerFor(f) }));
  const signRows = warnings.slice(0, Math.max(6 - claimRows.length, 3))
    .map((w) => ({ src: TYPE[w.type]?.[0] ?? 'Warning sign', said: w.title, where: checkFor(w.title, String(w.detail ?? '')) }));
  const ledgerRows = [...claimRows, ...signRows];
  const hiddenRows = Math.max(Math.max(warnings.length, contradictions.length + gaps.length) - signRows.length, 0) + Math.max(claims - claimRows.length, 0);

  /** The deeper dive's six research areas, one line each on what they check. */
  const SCAN: Record<string, string> = {
    contact: 'Every published phone, email, WhatsApp link and address, and where each one really leads',
    understanding: 'Search results, Maps, directories, AI assistants and your homepage, read as a buyer would',
    voice: 'Google reviews, forums, social posts and news about you and your key people',
    credibility: 'Regulator alert lists, courts, insolvency notices, registers, licence claims and trademarks',
    assets: 'Domain ownership and expiry, hosting, email spoofing and email reputation',
    speed: 'Google PageSpeed Insights, and what real Chrome visitors experienced',
  };
  const areaWord = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight'][CHAPTER_ORDER.length] ?? String(CHAPTER_ORDER.length);
  // The preview is only the surface scan. The deeper dive has not run, so its count is unknown, never a number.
  const runRow = (no: string, name: string, what: string, status: string, count: string, unit: string, cls = '') => `<div class="run${cls ? ` ${cls}` : ''}"><span class="rn">${no}</span><div class="rw"><b>${esc(name)}</b><span>${esc(what)}</span></div>${status ? `<span class="rs">${esc(status)}</span>` : '<span></span>'}<div class="rc"><b>${count}</b><span>${esc(unit)}</span></div></div>`;
  const runs = `<div class="runs" aria-label="What has run so far, and what has not">
    ${runRow('00', 'Surface scan', `${srcN} read, for this free preview`, 'Done', esc(signCount), signCount === 1 ? 'warning sign found' : 'warning signs found', 'done')}
    ${CHAPTER_ORDER.map((c, i) => runRow(String(i + 1).padStart(2, '0'), CHAPTER_EYEBROW[c], SCAN[c] ?? '', 'Not run yet', '?', 'problems to uncover')).join('')}
    ${runRow(String(CHAPTER_ORDER.length + 1).padStart(2, '0'), 'Full analysis', `All ${areaWord} areas read together, for the causes behind several problems at once`, 'Not run yet', '–', 'runs on what the areas find', 'step')}
    ${runRow(String(CHAPTER_ORDER.length + 2).padStart(2, '0'), 'Action plan', 'Every problem turned into a task, by department, with the work written for you', 'Not run yet', '–', 'one task for each problem', 'step')}
    ${runRow('', 'So far', 'Found by the surface scan alone. The rest can only be counted once the deeper dive runs.', '', `${esc(signCount)}&nbsp;+&nbsp;?`, 'problems in all', 'total')}
  </div>`;
  const lockedCard = (n: number) => `<article class="locked" aria-label="${n} more surface-scan warning signs, in the full report"><div class="bar s"></div><div class="bar m"></div><div class="bar"></div><div class="bar m"></div><div class="bar s"></div><div class="lockmsg"><b>+${n}</b><span>more from the surface scan,<br>shown in your full report</span></div></article>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${esc(short)}: your online presence preview</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter+Tight:wght@500;600&family=Inter:wght@400;500;600;700&display=swap">
<style>${css}</style>
</head>
<body>

<header class="top"><div><b>Online Presence Audit ${esc(year)}</b> <span class="for">· Prepared for ${esc(name)}</span></div>${cta('Get the full report')}</header>

<section class="dark hero">
  <div>
    <p class="eyebrow">Preview · prepared for ${esc(name)} · ${esc(made)}</p>
    <h1>${sources.length ? `We read ${esc(srcN)} about ${esc(short)}.` : `We searched the public record for ${esc(short)}.`}<br><span class="g">${warnings.length ? 'Not all of them tell the same story.' : 'Here is what they say.'}</span></h1>
    <p class="lead">${esc(hook)}</p>
    <div class="ctas">${cta('Get my full report')}<a class="btn ghost" href="#warnings">See the warning signs&nbsp;↓</a></div>
    <p class="anyone">Built from public sources only. Anyone can run this on you.</p>
  </div>
  <aside class="file" aria-label="Your file">
    <div class="filehead"><span class="stamp">Prepared for you</span>${ref ? `<span class="fileno">${esc(ref)}</span>` : ''}</div>
    <h3>${esc(name)}</h3>
    <dl>
      <div><dt>Registration</dt>${ssm ? `<dd>SSM&nbsp;${esc(ssm)}</dd>` : '<dd class="nf">Not in any public source we read</dd>'}</div>
      ${id.address ? `<div><dt>Head office</dt><dd>${esc(clip(String(id.address), 90))}</dd></div>` : ''}
      ${domains.length ? `<div><dt>Websites</dt><dd>${esc(domains.join(', '))}</dd></div>` : ''}
      ${people.length ? `<div><dt>Leadership</dt><dd>${esc(people.slice(0, 3).map((p: any) => p.name).join(', '))}</dd></div>` : ''}
      <div><dt>Surface scan</dt><dd>${signCount ? `<b style="color:var(--wrong)">${esc(plural(signCount, 'warning sign'))}</b> found` : 'No warning signs found'}</dd></div>
      <div><dt>Deeper dive</dt><dd>${esc(areaWord.replace(/^./, (c) => c.toUpperCase()))} research areas, the analysis and the action plan: <b>not run yet</b></dd></div>
    </dl>
    <p class="foot">Researched ${esc(made)} from ${esc(srcN)}</p>
  </aside>
</section>

<div class="strip">
  <div><b>${esc(sources.length)}</b><span>public source${sources.length === 1 ? '' : 's'} read about ${esc(short)}</span></div>
  <div><b>${esc(facts.length)}</b><span>fact${facts.length === 1 ? '' : 's'} on public record</span></div>
  <div><b>${esc(contradictions.length)}</b><span>${contradictions.length === 1 ? 'place' : 'places'} where those sources disagree</span></div>
  <div><b>${esc(gaps.length)}</b><span>${gaps.length === 1 ? 'question' : 'questions'} they cannot answer</span></div>
</div>

<section id="thesis" class="thesis">
  <p class="eyebrow">Why this matters</p>
  <h2>How good you are<br><span class="g">is how clearly the market sees it.</span></h2>
  <p class="lead">Customers, banks, tender panels and AI assistants rarely see your work first. They see what is published about you, and decide from that. A strong business the market reads wrongly loses to a weaker one it reads clearly.</p>
</section>

<section id="known">
  <div class="head"><p class="eyebrow">What we already know about you</p>
    <h2>Not a template.<br><span class="g">Every line here is about ${esc(short)}.</span></h2>
    <p class="lead">Before a customer calls, before a bank lends or a tender panel shortlists, this is what public sources tell them about you.</p></div>
  ${known.length ? `<div class="known">${known.map((k) => `<div><span class="k">${esc(k.label)}</span><span class="v">${esc(P(k.value))}</span></div>`).join('')}</div>
  <p class="note">As public sources stated them on ${esc(made)}. Where they disagree, the warning signs below say so.</p>` : `<p class="empty">Public sources say very little about ${esc(short)} yet. That is a finding in itself: a buyer who looks you up has almost nothing to go on.</p>`}
  ${people.length ? `<div class="people">${people.slice(0, 8).map((p: any) => `<span><b>${esc(p.name)}</b>${p.role ? ` · ${esc(clip(String(p.role), 40))}` : ''}</span>`).join('')}</div>` : ''}
</section>

<section id="warnings" class="warn-section">
  <div class="head"><p class="eyebrow">Surface scan · warning signs</p>
    ${signCount ? `<h2>The surface scan found ${esc(plural(signCount, 'warning sign'))}.<br><span class="g">The deeper dive has not run yet.</span></h2>
    <p class="lead">This free preview is one surface scan: ${esc(srcN)} read for ${esc(short)}, nothing more. The deeper dive runs ${esc(areaWord)} research areas, a full analysis and an action plan, and none of them has started. Nobody can say how many more problems they will uncover until they run, us included.</p>` : `<h2>The surface scan found no warning signs.<br><span class="g">The deeper dive has not run yet.</span></h2>
    <p class="lead">What public sources say about ${esc(short)} hangs together. The full audit checks what they cannot: your contact details, reviews, Google, AI assistants, the official registers, your domains and email, and Google’s own test of your website.</p>`}
    </div>
  ${runs}
  ${typesFound.length ? `<div class="legend" style="margin-bottom:14px">${typesFound.map((t) => `<span class="tag ${TYPE[t][1]}">${esc(TYPE[t][0])}</span>`).join('')}</div>` : ''}
  <div class="warns">${shown.map((w, i) => warnCard(w, i === 0)).join('')}${moreSigns ? lockedCard(moreSigns) : ''}</div>
  <p class="note">Every card here comes from the surface scan. What the deeper dive finds is not on this page, because it has not been looked for yet.</p>
</section>

<section class="dark band-cta">
  <div><p class="eyebrow">The full audit</p><h2>Read it before your competitors do.<br><span class="g">Fix it before your customers see it.</span></h2>
    <p class="lead" style="margin-top:16px">Everything on this page came from public sources. Anyone can find it, your rivals included.</p></div>
  ${cta('Get my full report')}
</section>

<section id="inside" class="dark" style="padding-top:0">
  <div class="head"><p class="eyebrow">Inside your full report</p>
    <h2>Eight parts, written for ${esc(short)}.<br><span class="g">Here is what each one shows you.</span></h2>
    <p class="lead">This preview read what public sources say. The full report goes further: it traces how customers reach you, measures how the internet understands you and what people say, checks the official records, maps the domains that carry your name, runs Google’s own test on your website, then reads all six together and hands each department its task list.</p></div>
  <div class="parts">
    <a href="#p-contact"><span class="n">01</span><h3>${esc(CHAPTER_EYEBROW.contact)}</h3><p>Every way a customer can reach you, and where each one really leads.</p>
      <ul>${inside.contact.know.map((k) => `<li>${esc(k)}</li>`).join('')}</ul><span class="go">See what it shows&nbsp;↓</span></a>
    <a href="#p-understanding"><span class="n">02</span><h3>${esc(CHAPTER_EYEBROW.understanding)}</h3><p>What AI assistants, search engines and your own pages say you sell, and why you.</p>
      <ul><li class="hl">${esc(spotlight.ai)}</li><li class="hl">${esc(spotlight.findability)}</li><li>Whether a stranger can tell what you sell, and why you</li></ul><span class="go">See what it shows&nbsp;↓</span></a>
    <a href="#p-voice"><span class="n">03</span><h3>${esc(CHAPTER_EYEBROW.voice)}</h3><p>What customers, forums and the news say about you and the people who run it.</p>
      <ul><li>Every Google review, and every reply</li><li>News, forum and social talk</li><li>What is said about your key people</li></ul><span class="go">See what it shows&nbsp;↓</span></a>
    <a href="#p-credibility"><span class="n">04</span><h3>${esc(CHAPTER_EYEBROW.credibility)}</h3><p>The official sources a bank or tender panel checks, and every claim and warning sign.</p>
      <ul><li>Regulator alert lists, courts, insolvency notices and trademark signals</li><li>Licences and awards, in their registers</li><li>The ${esc(signCount)} warning signs, settled</li></ul><span class="go">See what it shows&nbsp;↓</span></a>
    <a href="#p-assets"><span class="n">05</span><h3>${esc(CHAPTER_EYEBROW.assets)}</h3><p>Your domains, hosting and email, traced from the public internet.</p>
      <ul>${inside.assets.know.slice(0, 3).map((k) => `<li>${esc(k)}</li>`).join('')}</ul><span class="go">See what it shows&nbsp;↓</span></a>
    <a href="#p-speed"><span class="n">06</span><h3>${esc(CHAPTER_EYEBROW.speed)}</h3><p>Google’s own test of your official homepage, on a phone and a computer.</p>
      <ul>${inside.speed.know.map((k) => `<li>${esc(k)}</li>`).join('')}</ul><span class="go">See what it shows&nbsp;↓</span></a>
    <a href="#analysis"><span class="n">07</span><h3>Full analysis</h3><p>One read across all six parts: what it all means for your business.</p>
      <ul><li>Each part, assessed</li><li>The causes behind several problems at once</li><li>What to build on, the risks, what you could win</li></ul><span class="go">See what it shows&nbsp;↓</span></a>
    <a href="#advice" class="wide"><span class="n">08</span><h3>Action plan</h3><p>Every fix as a task, grouped by the department that does it.</p>
      <ul><li>Website: content, pages and speed</li><li>Social media: reviews, replies and listings</li><li>IT: domains and email</li><li>Other: legal, licences and records</li><li>When, effort and the part each task comes from</li><li>Copy, replies and pages, written for you</li></ul><span class="go">See what it shows&nbsp;↓</span></a>
  </div>
</section>

<section id="p-contact" class="pt">
  ${partHead(1, 'contact', `Phone numbers, emails and WhatsApp links get copied onto directories, old listings and staff profiles, and stay there long after they change. We gather every contact detail published about ${esc(short)} and check where each one leads today. The grey bars below are where your own details go.`)}
  <div class="feats">${feat('contact')}</div>
</section>

<section id="p-understanding" class="pt">
  ${partHead(2, 'understanding', `A buyer looking for ${/^[aeiou]/i.test(trade) ? 'an' : 'a'} ${esc(trade)} in ${esc(town)} meets you in pieces: an AI assistant’s answer, a search result, a Maps listing, a directory, then your homepage. We read every piece the way a buyer would, from a marketing point of view.`)}
  <div class="feats">${['ai', 'findability', 'brand'].map(feat).join('')}</div>
</section>

<section id="p-voice" class="pt">
  ${partHead(3, 'voice', 'Reviews, forum threads, social posts and news stories are what strangers trust most, because you did not write them. We read every Google review, and search the news, forums and social media for your company, your brand and the people who run it.')}
  <div class="feats">${['reputation', 'news'].map(feat).join('')}</div>
</section>

<section id="p-credibility" class="warn-section">
  ${partHead(4, 'credibility', 'Banks, tender panels and larger clients check before they sign. We run the same checks in the official sources themselves, so you know what they will find before they do.')}
  <div class="srcs">${officialSources.map(([t, d]) => `<div><b>${esc(t)}</b><span>${esc(d)}</span><p class="res">Result in full report</p></div>`).join('')}</div>
  <h3 class="sub3">Then every claim and warning sign about ${esc(short)}, settled</h3>
  <div class="cred"><table class="ledger"><thead><tr><th>What is said about ${esc(short)}</th><th>Checked against</th><th>Result</th></tr></thead><tbody>
    ${ledgerRows.map((r) => `<tr><td class="said"><span class="src">${esc(r.src)}</span><b>${esc(r.said)}</b></td><td class="where">${esc(r.where)}</td><td class="res"><span class="vstamp">In full report</span></td></tr>`).join('')}
    ${hiddenRows ? `<tr class="hidden"><td class="said"><span class="src">+${esc(hiddenRows)} more from the surface scan</span>${rd('72%')}${rd('48%')}</td><td class="where">${rd('80%')}</td><td class="res"><span class="vstamp">In full report</span></td></tr>` : ''}
    <tr class="hidden"><td class="said"><span class="src">? more · from the deeper dive</span><b>Whatever the ${esc(areaWord)} research areas uncover</b></td><td class="where">Each in its own official source</td><td class="res"><span class="vstamp">Not run yet</span></td></tr>
  </tbody></table></div>
  <div class="outcomes"><span>Each claim ends with one result:</span><span class="pill good">Confirmed</span><span class="pill good">Better than you claim</span><span class="pill bad">Register says otherwise</span><span class="pill amb">Not found</span><span class="pill none">No public register</span></div>
  <p class="nochk"><b>Said plainly in the report, never guessed:</b> paid or closed registers are not checked automatically. That means SSM e-Info documents, CTOS and CCRIS, the MDI insolvency search, PDRM Semak Mule, the MyIPO trademark register (it needs a login) and the Spamhaus blacklist (it needs a paid licence).</p>
</section>

<section id="p-assets" class="pt">
  ${partHead(5, 'assets', 'Your domains, email and website sit with registrars, hosting companies and whoever set them up. A domain that expires, sits in someone else’s name, or lets anyone send email as you can take the business offline. All of it can be traced from the public internet.')}
  <div class="feats">${feat('assets')}</div>
</section>

<section id="p-speed" class="pt">
  ${partHead(6, 'speed', `Most customers open your site on a phone first. A slow page loses them before it finishes loading, and Google counts speed when it decides who to show first. Google publishes its own test of every page; we run it on yours.`)}
  <div class="feats">${feat('speed')}</div>
</section>

<section id="analysis" class="pt">
  <div class="head"><p class="eyebrow">Part 7 · Full analysis</p>
    <h2>Six parts, read together.<br><span class="g">What it all means for ${esc(short)}.</span></h2>
    <p class="lead">One problem often shows up in several parts: two websites that disagree give customers the wrong number, confuse AI assistants and slow the phone page. The analysis finds those causes, so one fix solves several findings at once.</p></div>
  <div class="tiles">
    <div class="tile wide"><h3>Part by part</h3><p>Each part's number, its status, and what it says about the business.</p>
      <div class="in">${CHAPTER_ORDER.map((c, i) => `<div class="m-fix"><span class="no">${i + 1}</span><span>${esc(CHAPTER_EYEBROW[c])}</span><span class="m-pill">Locked</span></div>`).join('')}</div></div>
    <div class="tile"><h3>What ties it together</h3><p>The two to four causes behind the most findings, and the parts each one runs through.</p>
      <div class="in">${[0, 1].map(() => `<div class="m-faq"><b>→</b>${rd('82%')}${rd('60%')}</div>`).join('')}</div></div>
  </div>
</section>

<section id="advice" class="pt">
  <div class="head"><p class="eyebrow">Part 8 · Action plan</p>
    <h2>Not just what is wrong.<br><span class="g">Who fixes what, and when.</span></h2>
    <p class="lead">Every finding becomes a task for the department that does the work, with when to do it, how long it takes and the part it comes from. The work that can be written is written for you, so each team can start the same day.</p></div>
  <div class="tiles">
    <div class="tile wide"><h3>Your task list, by department</h3><p>One list each for your web developer, whoever runs your Google and social pages, your IT vendor, and a director.</p>
      <div class="in"><div class="m-depts">${['Website', 'Social media', 'IT', 'Other'].map((d, i) => `<div><b>${d}</b>${[0, 1, 2].slice(0, 3 - (i > 1 ? 1 : 0)).map((j) => `<span class="m-task"><i></i>${rd(['86%', '64%', '74%'][j])}</span>`).join('')}</div>`).join('')}</div></div></div>
    <div class="tile"><h3>When, and how long</h3><p>This week, this month or within three months, with an honest estimate for each task.</p>
      <div class="in">${[['This week', '1 hour'], ['This month', '2 days']].map(([w, e]) => `<div class="m-fix"><span class="no">☐</span>${rd('70%')}<span class="m-pill hi">${w}</span><span class="m-pill eff">${e}</span></div>`).join('')}</div></div>
    <div class="tile"><h3>Your homepage, rewritten</h3><p>A new headline, proof points and sections, built only from facts we verified.</p>
      <div class="m-browser"><div class="m-url"><span class="dots"><i></i><i></i><i></i></span>${esc(site)}</div><div class="m-page" style="min-height:0">${rd('86%')}${rd('60%')}${rd('74%')}<span class="m-btn">Your call to action</span></div></div></div>
    <div class="tile"><h3>Review replies, ready to post</h3><p>A reply for every unanswered complaint, and a WhatsApp message asking for reviews.</p>
      <div class="in"><span class="m-stars">★<i>★★★★</i></span>${rd('90%')}${rd('56%')}<div class="m-reply"><small>Your reply</small>${rd('94%')}${rd('70%')}</div></div></div>
    <div class="tile"><h3>Pages to add, town by town</h3><p>One page per service and town, outlined, so customers in each town find you.</p>
      <div class="in" style="background:none;box-shadow:none;padding:0"><span class="m-slug">${esc(pageSlug)}</span><span class="m-slug">${rd('62%')}</span><span class="m-slug">${rd('48%')}</span></div></div>
    <div class="tile"><h3>Getting recommended by AI</h3><p>The pages assistants read, the corrections they need, and an FAQ written for them to quote.</p>
      <div class="in">${[0, 1].map(() => `<div class="m-faq"><b>Q</b>${rd('80%')}${rd('64%')}</div>`).join('')}</div></div>
    <div class="tile wide"><h3>Business details for Google and AI</h3><p>Structured data your web developer pastes into every page, so search engines and assistants read the right name, address and phone.</p>
      <pre class="m-code">&lt;script type="application/ld+json"&gt;
{ "@type": "LocalBusiness",
  "name": "${esc(name)}",${domains.length ? `\n  "url": "https://${esc(domains[0])}",` : ''}
  "telephone": ${rd('120px')},
  "address": ${rd('220px')},
  "areaServed": ${rd('160px')} }
&lt;/script&gt;</pre></div>
  </div>
</section>

<section id="how" style="padding-top:0">
  <div class="head"><p class="eyebrow">How it works</p><h2>From this preview<br><span class="g">to your full report.</span></h2></div>
  <div class="steps">
    <div><h3>This preview</h3><p>${esc(srcN.replace(/^./, (c) => c.toUpperCase()))}, read for ${esc(short)}.</p><span class="now">Done</span></div>
    <div><h3>You order</h3><p>${offer.contact ? esc(offer.contact) : 'Reply to the message that brought you this preview.'}</p></div>
    <div><h3>We run the full audit</h3><p>Every contact detail, AI assistants, search and Maps, your reviews and the news, the official records, every domain and email address that carries your name, and Google’s own test of your website.</p></div>
    <div><h3>You get your report</h3><p>One link: desktop, mobile, and A4 to print or save as PDF.</p></div>
  </div>
</section>

<section id="protect" style="padding-top:0">
  <div class="head"><p class="eyebrow">One report, four uses</p><h2>Know first.<br><span class="g">Fix first.</span></h2>
    <p class="lead">The same research we ran on ${esc(short)} works on any Malaysian company you deal with.</p></div>
  <div class="uses">
    <div><span class="un">01</span><h3>Read it before your competitors do</h3><p>Everything in it is public. Know what a rival, a buyer or a bank can learn about ${esc(short)} before they use it.</p><a class="ul" href="#warnings">This is yours, above&nbsp;↑</a></div>
    <div><span class="un">02</span><h3>Fix it before your customers see it</h3><p>Old numbers, wrong AI answers, unanswered reviews: each one costs a sale quietly. The report puts them in order, with the fix written out.</p><a class="ul" href="#advice">See the fixes&nbsp;↑</a></div>
    <div><span class="un">03</span><h3>Read your competitors. Know what they don’t.</h3><p>How rivals show up to AI assistants, on Google and in reviews, where they are weak, and where you are already stronger.</p>${cta('Order one on a competitor', 'ul')}</div>
    <div><span class="un">04</span><h3>Choosing a supplier? Check them first.</h3><p>Before you sign or pay: their registration, regulator alerts, court records, licences, reviews and warning signs.</p>${cta('Check a supplier', 'ul')}</div>
  </div>
</section>

<section id="order" class="dark">
  <div class="order">
    <div><p class="eyebrow">Order your full report</p><h2>${esc(short)} deserves<br><span class="g">one story, told right.</span></h2>
      <p class="lead" style="margin-top:18px">You have seen what public sources say. The full audit traces how customers reach you, shows what they see and hear, settles every warning sign against the official records, traces the domains and email that carry your name, runs Google’s own test on your website, then reads it all together and hands each department its task list.</p></div>
    <div class="panel">
      ${offer.price ? `<p class="price">${esc(offer.price)}</p>` : ''}
      <ul><li>Contact and reachability: every phone, email and WhatsApp, traced</li><li>How top AI sees your brand, and how search engines index you</li><li>Reviews, news and forum talk about you and your key people</li><li>Credibility: regulator alerts, courts, insolvency and your licences</li><li>Digital assets: your domains, hosting and email</li><li>Website speed and quality: Google’s own test of your homepage</li><li>A full analysis that reads all six parts together</li><li>An action plan by department: website, social media, IT and other, with the work written for you</li><li>Desktop, mobile and A4 PDF</li></ul>
      ${ctaHref !== '#order' ? cta('Get my full report') : `<p>${esc(offer.contact || 'Reply to the message that brought you this preview, and we will start your full audit.')}</p>`}
      <p style="font-size:14px;color:var(--on-dark)">Need one on a competitor or a supplier? Same report, any Malaysian company.</p>
      <p style="font-size:13px;color:var(--on-dark-2)">This preview is yours to keep.</p>
    </div>
  </div>
</section>

<footer>
  ${sources.length ? `<details><summary>The public sources behind this preview <span class="muted">(${sources.length})</span></summary><ol class="sources">${sources.map((s: any) => `<li id="src-${esc(s.id)}" value="${esc(s.id)}">${/^https?:\/\//.test(s.url) ? `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(clip(String(s.title || hostOf(s.url)), 90))}</a> · ${esc(hostOf(s.url))}` : esc(s.title)}</li>`).join('')}</ol></details>` : ''}
  <div class="colophon">
    <div><span class="k">Prepared for</span><span>${esc(name)}</span></div>
    <div><span class="k">Researched</span><span>${esc(made)}, from ${esc(srcN)}</span></div>
    <div><span class="k">Edition</span><span>Preview${ref ? ` · ${esc(ref)}` : ''} · Online Presence Audit ${esc(year)}</span></div>
    <div><span class="k">Method</span><span>Web pages, directories, news and registers anyone can open. No paid register is used in a preview.</span></div>
  </div>
  <p>Online Presence Audit ${esc(year)} · Preview prepared for ${esc(name)}. Built from public sources only; nothing here has been checked against official registers yet.</p>
  ${partnersHtml()}
</footer>

</body>
</html>
`;
}
