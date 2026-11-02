// The report as one standalone HTML document of A4 pages, from data alone (no network, no files).
// Styled after the Eternalgy corporate profile: two-tone headlines, dark pages for the numbers,
// banded tables. On screen the pages stack like sheets; Print / Save as PDF gives clean A4.
// One document, three versions: on screen ?view=desktop|mobile|a4 (or the screen width) picks
// the layout and a switcher changes it; printing always gives the A4 pages.
//   cover        company, title, the homepage on a phone
//   at a glance  five measured numbers, the status of each area, the verdict
//   fix first    the three problems costing the most customers
//   chapters     the six research parts, each opening with why it matters today, then what we found
//   analysis     one full analysis across all six parts: verdict, part by part, what ties it together
//   stranger     what a customer, bank or tender officer learns in 10 minutes
//   plan         the action plan: one task list per department (website, social media, IT, other)
//   ready to use homepage copy, pages, review replies, AI plan, FAQ, business data
//   appendix     every finding in plain words, the background research, sources, method
// Numbers come from editor.ts resolve(); plain titles from the S3 editor lane, the analysis from S4,
// the action plan from S5, each when it ran, else built in here. Used by the hub (divedeeper.ts) and by scripts/dive-deeper/report.ts.
// A missing lane only drops its block; the report still builds.
import { AREAS, DEPTS, deptOf, resolve, type Item } from './editor.ts';
import { PARTNERS_CSS, partnersHtml } from './partners.ts';
import { isPrivateUrl, publicSources, scrub } from './privacy.ts';

/** Why each area matters, said once for every client. No market statistics we cannot source. */
export const OPENERS: Record<string, { q: [string, string]; body: (t: { trade: string; town: string }) => string }> = {
  reputation: {
    q: ['Do reviews still decide', 'who gets the call?'],
    body: ({ trade }) => `Before a customer phones a ${trade}, they read its Google reviews. They read the bad ones first, and then they read what the owner wrote back. A reply shows a stranger how you behave when something goes wrong, which is exactly what they are trying to find out before they hire you. Silence reads as the answer.`,
  },
  findability: {
    q: ['When a customer searches,', 'do they find you?'],
    body: ({ trade, town }) => `Customers do not search for your company name. They search for what they need and where, such as “${trade} in ${town}”, and most of them call one of the first few names Google Maps shows. Where you appear on that list depends on your reviews, on how complete and consistent your listing is, and on whether you have a listing in every town you serve.`,
  },
  ai: {
    q: ['How important is an AI recommendation', 'in today’s market?'],
    body: ({ trade, town }) => `More and more customers now ask an AI assistant, such as ChatGPT, Gemini or DeepSeek, who to hire instead of comparing websites themselves. The assistant replies with a short list of names. A business that is not on that list never gets the chance to quote for the job, and one the assistant describes wrongly loses the customer’s trust before the first call. We asked the assistants what a customer looking for a ${trade} in ${town} would ask, and what they would ask about you by name.`,
  },
  website: {
    q: ['Does your website win the customer,', 'or lose them?'],
    body: () => 'Your website is where a customer goes to check you before they call. A dead link, an empty page or a phone number that does not connect tells them the business is careless, and they move on to the next name. We read every page of your sites and tested every link, phone number and WhatsApp link the way a customer would.',
  },
  credentials: {
    q: ['Can a stranger verify', 'what you claim?'],
    body: () => 'Banks, tender officers and larger clients check a contractor’s licences and awards before they sign. We looked up each claim on your sites in the issuing body’s own register, the same check a careful buyer makes. A claim the register confirms builds trust; one it contradicts, or one nobody can check, raises a question you will not be there to answer.',
  },
};
/** The five parts of the malaysia-deeper-dive report, each opening with why it matters. */
export const PART_OPENERS: Record<string, { q: [string, string]; body: (t: { trade: string; town: string }) => string }> = {
  contact: {
    q: ['When a customer reaches out,', 'does it reach you?'],
    body: () => 'Your phone numbers, emails and WhatsApp links are copied onto directories, old listings and staff profiles, and they stay there long after they change. A customer who rings a number that left with a former employee, or emails a mailbox nobody reads, does not try twice. We gathered every contact detail published about you and checked where each one really leads.',
  },
  understanding: {
    q: ['Does the internet understand', 'what you sell, and why you?'],
    body: ({ trade, town }) => `A buyer looking for a ${trade} in ${town} meets your business in pieces: a search result, a Maps listing, a directory, an AI assistant’s summary, then your homepage. Each piece either tells the same clear story about what you sell and why you are the better choice, or it does not. We read every piece the way a buyer would, from a marketing point of view.`,
  },
  voice: {
    q: ['What do people say about you', 'when you are not in the room?'],
    body: () => 'Reviews, forum threads, social posts and news stories are what strangers trust most, because you did not write them. They cover your company, your brand and the people who run it. We read your Google reviews and searched the news, forums and social media for what is said about you and your key people.',
  },
  credibility: {
    q: ['Can a stranger verify', 'that you are who you say you are?'],
    body: () => 'Banks, tender panels and larger clients check before they sign: the regulators’ alert lists, the courts, insolvency notices, government records and the licences you claim. We ran the same checks a careful buyer runs, in the official sources themselves, so you know what they will find before they do.',
  },
  assets: {
    q: ['Who really holds the keys', 'to your name online?'],
    body: () => 'Your domains, email and website sit with registrars, hosting companies and whoever set them up. A domain that expires, is registered in someone else’s name, or lets anyone send email as you can take the business offline or be used against your customers. All of it can be traced from the public internet, so we traced it.',
  },
  speed: {
    q: ['How does Google rate', 'your website?'],
    body: () => 'Google runs its own test on every page it lists: how fast it shows on a phone and a computer, whether everyone can use it, whether it follows good practice, and whether Google can read it. A slow phone page loses visitors before it finishes loading, and Google counts speed when it decides who to show first. We ran Google’s own test, PageSpeed Insights, on your official homepages, and read what real Chrome visitors experienced over the last 28 days.',
  },
};
export const CHAPTER_ORDER = ['contact', 'understanding', 'voice', 'credibility', 'assets', 'speed'] as const;
export const CHAPTER_EYEBROW: Record<string, string> = {
  contact: 'Contact and reachability', understanding: 'How the internet understands you', voice: 'Reviews, discussion and news', credibility: 'Credibility and official records', assets: 'Digital assets', speed: 'Website speed and quality',
  // Topics inside the parts (the preview names them on their own).
  reputation: 'Reputation', findability: 'Search and Maps', ai: 'AI assistants', website: 'Your websites', credentials: 'Licences and awards',
};

/** Research and editor text set like print: curly quotes and apostrophes, real dashes and ellipses, and no
 *  line break between a number and its unit or currency ("RM 1.2 million", "10.75 MWp", "435 days"). */
export const NB = '\u00a0';
export const typeset = (s: string) => s
  .replace(/\.{3}/g, '…')
  .replace(/(\S)\s+--?\s+(?=\S)/g, `$1${NB}– `)
  .replace(/(\w)--(\w)/g, '$1—$2')
  .replace(/\b((?:19|20)\d{2})-((?:19|20)\d{2})\b/g, '$1–$2')
  .replace(/(\w)'(\w)/g, '$1’$2')
  .replace(/(^|[\s(\[—–])'/g, '$1‘').replace(/'/g, '’')
  .replace(/(^|[\s(\[—–])"/g, '$1“').replace(/"/g, '”')
  .replace(/\b(RM|USD|SGD|SSM|No\.)\s+(?=\d)/g, `$1${NB}`)
  .replace(/(\d)\s+(?=%|(?:MWp|kWp|kW|MW|GWh|MWh|kWh|km|sq\.? ?ft|mil|million|billion|days?|weeks?|months?|years?|hours?|reviews?|projects?|plants?|staff)\b)/g, `$1${NB}`);
/** Ties the last two words of a short line together, so a title never ends on one word alone. */
export const tie = (s: string) => s.replace(/\s+(\S{1,14})$/, `${NB}$1`);
/** typeset() through every string of a lane's notes, leaving links, slugs, ids and code alone. */
export const typesetAll = (v: any, key = ''): any => (typeof v === 'string'
  ? (/^(url|source|slug|href|img|key|theme|dept|when|ready|id|items|jsonld|effort|impact)$/i.test(key) || /^https?:\/\//.test(v) ? v : typeset(v))
  : Array.isArray(v) ? v.map((x) => typesetAll(x, key))
  : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, k === 'jsonld' ? x : typesetAll(x, k)]))
  : v);

export const esc = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Markdown of the company-dive dossier to HTML: headings, tables, lists, bold, [n] citations. */
export function md(src: string): string {
  const inline = (s: string) => esc(typeset(s)).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/\[(\d+)\]/g, '<a class="cite" href="#src-$1">[$1]</a>');
  const out: string[] = [];
  const lines = src.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];
    if (/^#\s/.test(ln)) continue;
    const h = ln.match(/^(#{2,4})\s+(.*)/);
    if (h) { out.push(`<h${h[1].length + 2}>${inline(h[2])}</h${h[1].length + 2}>`); continue; }
    if (/^\|/.test(ln)) {
      const rows: string[] = [];
      while (i < lines.length && /^\|/.test(lines[i])) rows.push(lines[i++]);
      i--;
      const cells = (row: string) => row.replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
      const body = rows.filter((x) => !/^\|[\s:|-]+\|$/.test(x));
      // Each cell carries its column name, for pages that stack rows into labelled cards on phones.
      const heads = cells(body[0]);
      out.push(`<table class="band"><thead><tr>${heads.map((c) => `<th>${inline(c)}</th>`).join('')}</tr></thead><tbody>${body.slice(1).map((row) => `<tr>${cells(row).map((c, j) => `<td${heads[j] ? ` data-label="${esc(heads[j])}"` : ''}>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`);
      continue;
    }
    if (/^\s*[-*]\s+/.test(ln) || /^\s*\d+\.\s+/.test(ln)) {
      const ordered = /^\s*\d+\./.test(ln);
      const list: string[] = [];
      while (i < lines.length && (/^\s*[-*]\s+/.test(lines[i]) || /^\s*\d+\.\s+/.test(lines[i]))) list.push(lines[i++].replace(/^\s*([-*]|\d+\.)\s+/, ''));
      i--;
      out.push(`<${ordered ? 'ol' : 'ul'} class="plain">${list.map((x) => `<li>${inline(x)}</li>`).join('')}</${ordered ? 'ol' : 'ul'}>`);
      continue;
    }
    if (ln.trim()) out.push(`<p>${inline(ln)}</p>`);
  }
  return out.join('\n');
}

/** The A4 / desktop / mobile stylesheet shared by the full report and the preview. */
const CSS = `/* A4 sheets in the Eternalgy corporate-profile style: ink and grey type, near-black feature pages,
   grey-banded tables, square panels. Colour is kept for status only. */
:root { --ink:#111418; --grey:#5c636d; --muted:#8a9099; --line:#e6e8eb; --band:#f2f3f5; --paper:#ffffff; --desk:#d9dcdf;
  --dark:#0e1013; --dark2:#1b2129; --on-dark:#f3f4f6; --on-dark-2:#9aa1ab;
  --urgent:#b42318; --urgent-bg:#fdecea; --fix:#a15c07; --fix-bg:#fdf3e2; --good:#067647; --good-bg:#e6f4ec; --info:#5c636d; --info-bg:#eef0f2; --none:#cfd3d8;
  --display:"Inter Tight","Inter",system-ui,sans-serif; --body:"Inter",system-ui,sans-serif; }
* { box-sizing:border-box; }
html { -webkit-print-color-adjust:exact; print-color-adjust:exact; }
body { margin:0; background:var(--desk); color:var(--ink); font-family:var(--body); font-size:13.5px; line-height:1.55; }
.page { position:relative; width:210mm; min-height:297mm; margin:24px auto; background:var(--paper); padding:20mm 18mm 24mm; box-shadow:0 2px 18px rgba(0,0,0,.12); display:flex; flex-direction:column; gap:16px; }
.page.dark { background:var(--dark); color:var(--on-dark); }
.pf { position:absolute; left:18mm; right:18mm; bottom:9mm; display:flex; justify-content:space-between; font-size:9px; color:var(--muted); }
.dark .pf { color:var(--on-dark-2); }
h1,h2,h3,h4 { font-family:var(--display); font-weight:600; margin:0; letter-spacing:-0.025em; line-height:1.05; }
.display { font-size:40px; line-height:1.04; max-width:15em; } .display .g, h1 .g { color:var(--grey); } .dark .display .g, .dark h1 .g { color:var(--on-dark-2); }
p { margin:0; } a { color:inherit; } .muted { color:var(--muted); } .small { font-size:11.5px; }
.eyebrow { font-size:10.5px; font-weight:600; letter-spacing:.12em; text-transform:uppercase; color:var(--muted); }
.lead { font-size:15.5px; line-height:1.5; } .body { font-size:13.5px; max-width:44em; }
.sub { font-size:22px; margin-top:12px; } .kicker { font-family:var(--display); font-size:17px; font-weight:500; letter-spacing:-0.01em; color:var(--grey); max-width:34em; }
.lbl { font-size:10px; font-weight:600; letter-spacing:.1em; text-transform:uppercase; color:var(--muted); margin-bottom:4px; }
.note { font-size:11.5px; color:var(--muted); }
.opener { display:grid; grid-template-columns:minmax(0,1.7fr) minmax(0,1fr); gap:28px; align-items:start; margin-top:4px; }
.aside { border-left:1px solid var(--line); padding-left:18px; display:grid; gap:6px; justify-items:start; } .aside .big { font-family:var(--display); font-size:19px; font-weight:600; letter-spacing:-0.015em; line-height:1.2; }
/* cover */
.cover { padding:0; overflow:hidden; display:grid; grid-template-rows:auto 1fr auto; }
.cover-top { display:flex; justify-content:space-between; align-items:center; padding:16mm 18mm 0; font-size:11px; letter-spacing:.14em; text-transform:uppercase; color:var(--on-dark-2); } .cover-top b { color:var(--on-dark); letter-spacing:.06em; font-size:15px; text-transform:none; }
.cover-mid { display:grid; grid-template-columns:minmax(0,1fr) auto; gap:24px; align-items:end; padding:0 18mm; }
.cover h1 { font-size:54px; line-height:1.02; letter-spacing:-0.035em; }
.cover-bot { display:grid; grid-template-columns:1fr 1fr; gap:16px; padding:0 18mm 16mm; font-size:12px; color:var(--on-dark-2); } .cover-bot b { color:var(--on-dark); font-weight:500; display:block; font-size:14px; }
.phone { width:58mm; border-radius:22px; border:6px solid #2a3038; overflow:hidden; background:#000; } .phone img { display:block; width:100%; }
.phone-cap { font-size:10px; color:var(--on-dark-2); text-align:center; margin-top:6px; }
/* glance */
.stats { display:grid; grid-template-columns:repeat(auto-fit,minmax(28mm,1fr)); gap:14px; margin-top:10px; }
.stats div { display:grid; gap:4px; align-content:start; } .stats b { font-family:var(--display); font-size:44px; font-weight:500; letter-spacing:-0.04em; line-height:1; } .stats span { font-size:10.5px; color:var(--on-dark-2); line-height:1.35; }
.small-stats b { font-size:26px; color:var(--ink); } .small-stats span { color:var(--muted); }
.rows { display:grid; gap:3px; } .rows a { display:grid; grid-template-columns:42mm minmax(0,1fr) auto; gap:14px; align-items:center; background:var(--dark2); padding:9px 12px; text-decoration:none; font-size:12px; }
.rows a b { font-weight:600; } .rows a span { color:var(--on-dark-2); }
.verdict { font-size:15px; line-height:1.55; color:var(--on-dark); max-width:42em; }
/* fix first */
.three { display:grid; gap:10px; } .three .item { display:grid; grid-template-columns:16mm minmax(0,1fr); gap:14px; padding:16px; background:var(--band); }
.three .item:first-child { background:var(--dark2); color:var(--on-dark); } .three .item:first-child .muted, .three .item:first-child .lbl { color:var(--on-dark-2); }
.three .n { font-family:var(--display); font-size:34px; font-weight:500; letter-spacing:-0.04em; line-height:1; }
.three h3 { font-size:19px; letter-spacing:-0.02em; line-height:1.15; } .three .cols { display:grid; grid-template-columns:1fr 1fr; gap:14px; margin-top:8px; font-size:12px; }
/* tables */
table { width:100%; border-collapse:collapse; } th { text-align:left; font-size:10px; font-weight:500; color:var(--muted); padding:6px 10px; }
.band td { padding:8px 10px; vertical-align:top; font-size:12px; } .band tbody tr:nth-child(odd) td { background:var(--band); }
.band .t { font-weight:600; } .band .w { color:var(--grey); font-size:11.5px; margin-top:2px; } .band .where { white-space:nowrap; text-align:right; font-size:11px; color:var(--grey); } .st-cell { width:24mm; }
a.see { text-decoration:none; color:var(--grey); } a.see:hover { color:var(--ink); }
.pill { display:inline-block; font-size:9.5px; font-weight:600; letter-spacing:.06em; text-transform:uppercase; padding:3px 7px; white-space:nowrap; }
.pill.urgent { color:var(--urgent); background:var(--urgent-bg); } .pill.fix { color:var(--fix); background:var(--fix-bg); } .pill.good { color:var(--good); background:var(--good-bg); } .pill.info { color:var(--info); background:var(--info-bg); }
.dark .pill.urgent { color:#ffb4ab; background:#3a1714; } .dark .pill.fix { color:#fdd38a; background:#33240b; } .dark .pill.good { color:#8ee0b0; background:#0f2a1d; }
.tbl-h { font-size:14px; letter-spacing:-0.01em; margin-top:6px; }
/* charts */
figure { margin:0; } .chart { display:grid; gap:6px; } figcaption { font-size:10.5px; color:var(--muted); }
svg { width:100%; height:auto; display:block; } svg text { font-family:var(--body); font-size:11px; fill:var(--muted); } svg .ann { fill:var(--ink); font-weight:600; font-size:12px; }
.axis { stroke:var(--line); } .b-norm { fill:var(--ink); opacity:.75; } .b-spike { fill:var(--fix); } .b-low { fill:var(--urgent); stroke:var(--paper); stroke-width:2; }
.k { display:inline-block; width:9px; height:9px; vertical-align:-1px; margin:0 2px 0 6px; } .k-spike { background:var(--fix); } .k-low { background:var(--urgent); border-radius:50%; }
.s-good { background:var(--good); } .s-fix { background:var(--fix); } .s-urgent { background:var(--urgent); } .s-none { background:var(--none); }
.board td { padding:6px 10px; font-size:12px; border-bottom:1px solid var(--line); } .board thead th { border-bottom:1px solid var(--ink); }
.board .rk { font-family:var(--display); font-weight:600; width:14mm; } .board .num { text-align:right; color:var(--grey); white-space:nowrap; width:1%; } .board .barc { width:38%; }
.board tr.me td { background:var(--dark2); color:var(--on-dark); font-weight:600; } .board tr.me .num, .board tr.me .muted { color:var(--on-dark-2); }
.board tr.gap td { color:var(--muted); font-size:10.5px; letter-spacing:.1em; text-align:center; }
.bar { display:block; height:6px; background:var(--band); } .bar i { display:block; height:100%; background:var(--grey); } tr.me .bar { background:#2c3440; } tr.me .bar i { background:#fff; }
.stack { display:flex; height:10px; gap:2px; } .stack i { display:block; height:100%; }
.gcard { border:1px solid var(--line); padding:12px 14px; display:grid; gap:8px; } .gtop { display:flex; gap:10px; align-items:center; font-size:12px; }
.av { width:28px; height:28px; border-radius:50%; background:var(--grey); color:#fff; display:grid; place-items:center; font-weight:600; flex:none; }
.stars { color:#e6a700; letter-spacing:1px; } blockquote { margin:0; font-size:12.5px; } .noreply { font-size:11px; color:var(--urgent); font-weight:600; }
.shots { display:grid; grid-template-columns:repeat(auto-fit,minmax(55mm,1fr)); gap:10px; } .shot { display:grid; gap:5px; } .shot img { width:100%; border:1px solid var(--line); display:block; }
/* panels */
.pair { display:grid; grid-template-columns:1fr 1fr; gap:10px; }
.panel { padding:14px 16px; display:grid; gap:6px; align-content:start; } .panel.dark { background:var(--dark2); color:var(--on-dark); } .panel.dark .lbl { color:var(--on-dark-2); } .panel.light { background:var(--band); }
.panel .quote { font-size:12.5px; }
/* plan, drafts */
.fixes { counter-reset:fx; display:grid; gap:4px; } .fixes > div { counter-increment:fx; display:grid; grid-template-columns:12mm minmax(0,1fr) auto; gap:12px; padding:10px 12px; background:var(--band); align-items:start; }
.fixes > div::before { content:counter(fx, decimal-leading-zero); font-family:var(--display); font-size:20px; font-weight:500; color:var(--grey); }
.fixes h4 { font-size:13.5px; letter-spacing:-0.005em; line-height:1.3; } .fixes .w { color:var(--grey); font-size:11.5px; margin-top:2px; } .fixes .tags { display:grid; gap:4px; justify-items:end; }
.depts { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:6px; } .depts a { background:var(--band); padding:12px 14px; display:grid; gap:3px; align-content:start; text-decoration:none; font-size:11.5px; }
.depts a:first-child { background:var(--dark2); color:var(--on-dark); } .depts a:first-child .muted { color:var(--on-dark-2); } .depts b { font-family:var(--display); font-size:30px; font-weight:500; letter-spacing:-0.04em; line-height:1; } .depts span:nth-of-type(1) { font-weight:600; }
.dept { display:grid; gap:6px; } .deptc { font-family:var(--body); font-size:11px; font-weight:400; letter-spacing:0; }
.tasks .cb { width:7mm; font-size:15px; line-height:1.1; color:var(--grey); } .tasks .tg { width:34mm; } .tasks .tg div { display:grid; gap:4px; justify-items:end; font-size:11px; }
.weeks { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:8px; } .weeks > div { background:var(--band); padding:12px; } .weeks > div:first-child { background:var(--dark2); color:var(--on-dark); }
.weeks h4 { font-size:14px; margin-bottom:6px; } .weeks ul { margin:0; padding-left:15px; font-size:11px; display:grid; gap:4px; }
.hero { background:var(--dark2); color:var(--on-dark); padding:18px; display:grid; gap:8px; } .hero .hl { font-family:var(--display); font-size:24px; font-weight:600; letter-spacing:-0.02em; line-height:1.12; }
.hero ul { margin:0; padding-left:16px; color:var(--on-dark-2); font-size:12px; } .hero .btn { justify-self:start; background:#fff; color:var(--ink); font-weight:600; padding:6px 12px; font-size:12px; }
.grid2 { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:10px; } .grid3 { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:10px; }
.box { background:var(--band); padding:12px 14px; display:grid; gap:5px; align-content:start; font-size:12px; } .box h4 { font-size:13.5px; letter-spacing:-0.005em; line-height:1.25; } .box code { font-size:10.5px; color:var(--grey); overflow-wrap:anywhere; }
.box ul, ul.plain, ol.plain { margin:0; padding-left:16px; display:grid; gap:3px; }
.reply { display:grid; grid-template-columns:minmax(0,1fr) minmax(0,1.2fr); gap:14px; padding:10px 0; border-bottom:1px solid var(--line); font-size:12px; }
.reply .q { color:var(--grey); font-style:italic; } .reply .a { border-left:2px solid var(--ink); padding-left:10px; }
pre { margin:0; background:var(--band); padding:12px; overflow-x:auto; font-size:10px; line-height:1.45; white-space:pre-wrap; overflow-wrap:anywhere; }
.idtable td:first-child { color:var(--grey); width:42mm; }
.quotes { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:10px; } .quotes blockquote { background:var(--band); padding:12px; font-size:11.5px; } .quotes cite { display:block; margin-top:6px; font-style:normal; font-size:10px; color:var(--muted); }
.private { border-left:3px solid var(--urgent); background:var(--urgent-bg); padding:12px 16px; display:grid; gap:6px; font-size:12px; }
.dossier { display:grid; gap:8px; font-size:11.5px; } .dossier h4, .dossier h5, .dossier h6 { font-family:var(--display); font-size:14px; margin-top:8px; letter-spacing:-0.01em; }
a.cite { font-size:.75em; text-decoration:none; vertical-align:super; color:var(--grey); }
details > summary { cursor:pointer; font-family:var(--display); font-weight:600; font-size:15px; padding:10px 0; border-top:1px solid var(--line); }
ol.sources { padding-left:28px; display:grid; gap:2px; font-size:10px; color:var(--grey); } ol.sources li { overflow-wrap:anywhere; }
/* the craft layer: type set like print, figures that line up, a running foot on every sheet */
body { font-kerning:normal; text-rendering:optimizeLegibility; font-feature-settings:"kern","calt"; }
.dark, .panel.dark, .three .item:first-child, .rows a, .hero, .board tr.me td, .depts a:first-child, .weeks > div:first-child { -webkit-font-smoothing:antialiased; -moz-osx-font-smoothing:grayscale; }
h1, h2, h3, h4, .kicker { text-wrap:balance; } p, li, figcaption, blockquote, .verdict { text-wrap:pretty; }
.lead, .verdict, blockquote, .quote, .reply .q { hanging-punctuation:first allow-end; }
.stats b, .board, .band, .depts b, .three .n, .fixes > div::before, .aside .big, .pf, .colophon, ol.sources { font-variant-numeric:tabular-nums lining-nums; }
::selection { background:var(--ink); color:#fff; } .dark ::selection, .panel.dark ::selection { background:#fff; color:var(--ink); }
a:focus-visible { outline:2px solid currentColor; outline-offset:2px; }
.pf { border-top:1px solid var(--line); padding-top:5px; } .dark .pf { border-top-color:#2a3038; } .pf .sec { margin-right:12px; } .pf b { font-weight:600; color:var(--ink); } .dark .pf b { color:var(--on-dark); }
.aside .checked { font-size:10px; color:var(--muted); }
.empty { background:var(--band); border-left:3px solid var(--good); padding:10px 14px; font-size:12px; color:var(--grey); } .empty b { color:var(--ink); font-weight:600; }
.quotes cite::before { content:"— "; }
.colophon { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:12px; border-top:1px solid var(--ink); padding-top:10px; margin-top:10px; font-size:11.5px; } .colophon p:not(.lbl) { color:var(--ink); }
.method { max-width:62em; }
/* Three versions of one document. The base above is the A4 sheet; on screen the <html> class picks
   v-a4 (sheets on a desk), v-desktop (wide sections) or v-mobile (one column). Print is always A4. */
.viewbar, .chapnav { display:none; }
@media screen {
  .viewbar { display:flex; position:fixed; z-index:20; right:16px; bottom:16px; gap:2px; background:var(--dark); padding:4px; box-shadow:0 6px 24px rgba(0,0,0,.25); font-size:12px; }
  .viewbar button { font:inherit; color:var(--on-dark-2); background:none; border:0; padding:7px 11px; cursor:pointer; white-space:nowrap; }
  .viewbar button[aria-pressed="true"] { background:#fff; color:var(--ink); font-weight:600; } .viewbar button:focus-visible { outline:2px solid #fff; outline-offset:1px; }

  .v-desktop body, .v-mobile body { background:var(--paper); }
  .v-desktop .pf, .v-mobile .pf { display:none; }
  .v-desktop .chapnav, .v-mobile .chapnav { display:flex; position:sticky; top:0; z-index:10; background:rgba(255,255,255,.94); backdrop-filter:blur(8px); border-bottom:1px solid var(--line); overflow-x:auto; scrollbar-width:none; }
  .v-desktop .page, .v-mobile .page { scroll-margin-top:44px; }
  .v-desktop .chapnav { padding:0 max(34px, calc((100vw - 1120px) / 2 - 14px)); }
  .chapnav a { flex:none; padding:12px 14px; font-size:12.5px; color:var(--grey); text-decoration:none; white-space:nowrap; } .chapnav a:hover { color:var(--ink); }

  /* desktop: wide sections, bigger type, dark pages as full-width bands */
  .v-desktop body { font-size:16px; }
  .v-desktop .page { width:auto; min-height:0; margin:0; box-shadow:none; padding:88px max(48px, calc((100vw - 1120px) / 2)); gap:22px; border-bottom:1px solid var(--line); }
  .v-desktop .page.dark { border-bottom:0; }
  .v-desktop .display { font-size:clamp(44px,4.6vw,64px); } .v-desktop .lead { font-size:19px; } .v-desktop .body { font-size:16px; } .v-desktop .kicker { font-size:21px; } .v-desktop .sub { font-size:28px; margin-top:24px; }
  .v-desktop .cover { min-height:min(100vh,860px); padding:0; } .v-desktop .cover-top, .v-desktop .cover-mid, .v-desktop .cover-bot { padding-left:max(48px, calc((100vw - 1120px) / 2)); padding-right:max(48px, calc((100vw - 1120px) / 2)); }
  .v-desktop .cover-top { padding-top:48px; } .v-desktop .cover-bot { padding-bottom:48px; font-size:14px; } .v-desktop .cover h1 { font-size:clamp(56px,6.4vw,92px); } .v-desktop .phone { width:250px; }
  .v-desktop .stats b { font-size:68px; } .v-desktop .stats span { font-size:13px; } .v-desktop .verdict { font-size:19px; } .v-desktop .rows a { font-size:14px; padding:13px 16px; grid-template-columns:260px minmax(0,1fr) auto; }
  .v-desktop .band td, .v-desktop .board td { font-size:14px; padding:11px 14px; } .v-desktop .band .w { font-size:13px; } .v-desktop th { font-size:11px; }
  .v-desktop .three h3 { font-size:24px; } .v-desktop .three .cols { font-size:14px; } .v-desktop .three .item { padding:22px; }
  .v-desktop .panel { padding:20px 22px; font-size:15px; } .v-desktop .box { font-size:14px; padding:16px 18px; } .v-desktop .box h4 { font-size:16px; }
  .v-desktop .fixes > div { padding:14px 16px; } .v-desktop .fixes h4 { font-size:16px; } .v-desktop .fixes .w { font-size:13.5px; }
  .v-desktop .depts a { font-size:14px; padding:16px 18px; } .v-desktop .depts b { font-size:44px; } .v-desktop .deptc { font-size:13px; } .v-desktop .tasks .tg div { font-size:13px; }
  .v-desktop .weeks ul { font-size:13px; } .v-desktop .reply { font-size:14px; } .v-desktop blockquote { font-size:14.5px; }
  .v-desktop .opener { gap:56px; } .v-desktop .aside .big { font-size:24px; } .v-desktop figcaption, .v-desktop .note { font-size:12.5px; }
  .v-desktop .shots { grid-template-columns:repeat(auto-fit,minmax(320px,1fr)); gap:18px; } .v-desktop .hero .hl { font-size:32px; }
  .v-desktop .colophon { font-size:14px; } .v-desktop .empty { font-size:14.5px; padding:14px 18px; } .v-desktop .aside .checked { font-size:12px; }

  /* mobile: one column, thumb-sized type; on a wide screen it previews at phone width */
  .v-mobile body { font-size:16px; max-width:480px; margin:0 auto; box-shadow:0 0 0 1px var(--line); }
  .v-mobile .viewbar { right:auto; left:50%; transform:translateX(-50%); bottom:12px; } .v-mobile .viewbar button { padding:7px 10px; }
  .v-mobile .page { width:auto; min-height:0; margin:0; padding:40px 18px 48px; box-shadow:none; border-bottom:1px solid var(--line); gap:16px; }
  .v-mobile .page.dark { border-bottom:0; }
  .v-mobile .display { font-size:32px; } .v-mobile .lead { font-size:16.5px; } .v-mobile .body { font-size:15.5px; } .v-mobile .kicker { font-size:18px; } .v-mobile .sub { font-size:22px; }
  .v-mobile .opener, .v-mobile .pair, .v-mobile .cover-mid, .v-mobile .cover-bot, .v-mobile .three .cols, .v-mobile .grid2, .v-mobile .grid3, .v-mobile .quotes, .v-mobile .reply { grid-template-columns:1fr; }
  .v-mobile .depts { grid-template-columns:1fr 1fr; } .v-mobile .tasks .cb { display:none !important; } .v-mobile .tasks .tg { width:auto; } .v-mobile .tasks .tg div { display:flex; flex-wrap:wrap; gap:6px; justify-items:start; font-size:13px; }
  .v-mobile .weeks { grid-template-columns:1fr; } .v-mobile .aside { border-left:0; padding-left:0; border-top:1px solid var(--line); padding-top:12px; } .v-mobile .aside .big { font-size:21px; }
  .v-mobile .cover { min-height:100svh; padding:0; } .v-mobile .cover-top, .v-mobile .cover-mid, .v-mobile .cover-bot { padding-left:18px; padding-right:18px; } .v-mobile .cover-top { padding-top:28px; } .v-mobile .cover-bot { padding-bottom:84px; font-size:13px; }
  .v-mobile .cover h1 { font-size:42px; } .v-mobile .phone { width:min(62vw,240px); justify-self:center; }
  .v-mobile .stats { grid-template-columns:1fr 1fr; gap:18px; } .v-mobile .stats b { font-size:44px; } .v-mobile .stats span { font-size:12.5px; } .v-mobile .verdict { font-size:16.5px; }
  .v-mobile .rows a { grid-template-columns:minmax(0,1fr) auto; font-size:13.5px; padding:12px; } .v-mobile .rows a span:nth-child(2) { grid-column:1/-1; grid-row:2; }
  .v-mobile .three .item { grid-template-columns:1fr; gap:6px; } .v-mobile .three h3 { font-size:20px; } .v-mobile .three .cols { font-size:14px; }
  .v-mobile .band tr { display:block; } .v-mobile .band tbody tr { padding:10px 12px; } .v-mobile .band td { display:block; padding:2px 0; background:none !important; font-size:14px; }
  .v-mobile .band tbody tr:nth-child(odd) { background:var(--band); } .v-mobile .band thead { display:none; } .v-mobile .band .where { text-align:left; white-space:normal; }
  .v-mobile .st-cell { width:auto; } .v-mobile .pill { white-space:normal; } .v-mobile .band td, .v-mobile .board td { overflow-wrap:anywhere; }
  .v-mobile .board .barc { display:none; } .v-mobile .board td { font-size:13.5px; padding:9px 6px; }
  .v-mobile .fixes > div { grid-template-columns:1fr; gap:6px; } .v-mobile .fixes .tags { justify-items:start; display:flex; gap:6px; } .v-mobile .fixes h4 { font-size:15px; }
  .v-mobile .box, .v-mobile .panel { font-size:14.5px; } .v-mobile .hero .hl { font-size:24px; } .v-mobile figcaption, .v-mobile .note { font-size:12.5px; }
  .v-mobile .colophon { grid-template-columns:1fr 1fr; font-size:13.5px; } .v-mobile .empty { font-size:14px; }
  .v-mobile .gtop { flex-wrap:wrap; } .v-mobile pre { font-size:11px; } .v-mobile .small { font-size:14px; } .v-desktop .small { font-size:14px; }
}
/* A4 on a small screen: the sheets scroll sideways inside the desk instead of breaking. */
@media screen and (max-width:840px) { .v-a4 body { overflow-x:auto; } .v-a4 .page { margin:12px; } }
@page { size:A4; margin:0; }
@media print {
  .viewbar, .chapnav { display:none !important; }
  body { background:none; } .page { margin:0; box-shadow:none; width:210mm; min-height:297mm; break-after:page; -webkit-box-decoration-break:clone; box-decoration-break:clone; }
  .page:last-child { break-after:auto; } .band tr, .box, .panel, figure, .fixes > div, .depts, .gcard, .reply, .three .item, .weeks, .hero, .pair, .opener, pre { break-inside:avoid; }
  h2, h3, h4, .sub, .tbl-h, .kicker, .lbl { break-after:avoid; }
  thead { display:table-header-group; } .board tr, .tasks tr, .quotes blockquote, .colophon, .aside, .empty { break-inside:avoid; } p, li { orphans:3; widows:3; }
  details > :not(summary) { display:block; } details::details-content { display:block; content-visibility:visible; } details > summary { list-style:none; }
}
${PARTNERS_CSS}`;

/** One standalone document: the shared style (plus any page-specific css), the version switcher and the given pages. */
export function shell(title: string, body: string, css = ''): string {
  return `<!doctype html>
<html lang="en" class="v-desktop">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter+Tight:wght@500;600&family=Inter:wght@400;500;600&display=swap">
<style>
${CSS}${css}</style>
<script>
// Pick the version before first paint: ?view=a4|desktop|mobile wins, else the screen width decides.
(function () {
  var q = new URLSearchParams(location.search).get('view');
  var v = /^(a4|desktop|mobile)$/.test(q || '') ? q : (window.matchMedia('(max-width: 760px)').matches ? 'mobile' : 'desktop');
  document.documentElement.className = 'v-' + v;
})();
</script>
</head>
<body>
<nav class="viewbar" aria-label="Report version"><button type="button" data-v="desktop">Desktop</button><button type="button" data-v="mobile">Mobile</button><button type="button" data-v="a4">A4</button><button type="button" data-print>Print / PDF</button></nav>

${body}
<script>
// The version switcher: same document, three layouts. Print always uses the A4 layout.
(function () {
  var root = document.documentElement;
  var bar = document.querySelector('.viewbar');
  var mark = function () { bar.querySelectorAll('[data-v]').forEach(function (b) { b.setAttribute('aria-pressed', root.className === 'v-' + b.dataset.v ? 'true' : 'false'); }); };
  bar.addEventListener('click', function (e) {
    var b = e.target.closest('button');
    if (!b) return;
    if (b.hasAttribute('data-print')) { window.print(); return; }
    root.className = 'v-' + b.dataset.v;
    try { var u = new URL(location.href); u.searchParams.set('view', b.dataset.v); history.replaceState(null, '', u); } catch (err) {}
    mark();
  });
  mark();
})();
</script>
</body>
</html>
`;
}

/** lanes: { "E-maps": laneResult, …, "S2-consult": …, "S3-editor": … } as runLane returns them. */
export function buildReport(dive: any, L: Record<string, any>): string {
  const r = dive.result ?? {};
  const R = resolve(dive, L);
  const name = R.name;
  const s2 = L['S2-consult']?.notes ?? {};
  const ed = L['S3-editor']?.notes ?? {};
  // Runs before S4 kept the verdict, the stories and the mismatches in the editor's notes.
  const an = typesetAll(L['S4-analysis']?.notes ?? ed);
  const plain: Record<string, { title: string; why: string }> = typesetAll(ed.plain ?? {});
  const shots: any[] = ed.shots ?? [];
  const trade = String((R.plan?.trades ?? [])[0] ?? 'business like yours');
  const town = String(R.hq ?? (R.plan?.areas ?? [])[0] ?? 'your town');

  // ---------- helpers ----------
  const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n).replace(/\s+\S*$/, '') + ' …' : s);
  const hostOf = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };
  const pathOf = (u: string) => { try { const p = new URL(u).pathname; return p === '/' ? '' : p; } catch { return ''; } };
  /** Links read as where they go ("See it on Google Maps"), never as the raw URL. */
  const seeIt = (u: string | null | undefined) => {
    if (!u || !/^https?:\/\//.test(u) || isPrivateUrl(u)) return '';
    const h = hostOf(u);
    const where = /google\.[a-z.]+$/.test(h) && /\/maps/.test(u) ? 'Google Maps' : /search\.brave\.com/.test(h) ? 'search results' : h;
    return `<a class="see" href="${esc(u)}" target="_blank" rel="noopener">${esc(where)}&nbsp;↗</a>`;
  };
  const dateOf = (iso: string | undefined | null) => (iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '');
  const monthOf = (ym: string) => new Date(ym + '-01T00:00:00Z').toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' });
  const sevRank: Record<string, number> = { high: 0, medium: 1, low: 2, info: 3 };
  // The lanes use "info" for good news and plain notes alike, so it reads as a neutral note.
  const sevClass = (s: string) => (s === 'high' ? 'urgent' : s === 'medium' ? 'fix' : 'info');
  const sevWord = (s: string) => (s === 'high' ? 'Urgent' : s === 'medium' ? 'Needs work' : s === 'low' ? 'Minor' : 'Note');
  /** The lane's machine labels, stripped, for when the editor did not run. */
  const rawTitle = (t: string) => t.replace(/^(VERIFIED|CONTRADICTED|NOT FOUND|CAN'T CHECK AUTOMATICALLY|PRIVATE):\s*/i, '').replace(/\s*\[\d+ of \d+ asks[^\]]*\]/g, '').replace(/deepseek-v[\d.]+-flash(-\d+)?/gi, 'DeepSeek').replace(/gpt-[\d.]+-?\w*/gi, 'GPT');
  /** Stage-2 text built from raw finding titles keeps their machine bits; strip them for print (and any private link). */
  const tidy = (t: unknown) => scrub(rawTitle(String(t ?? ''))).replace(/\s*\((?:DNS )?ENOTFOUND\)/g, '').replace(/doesnt_know/g, "don't know").replace(/\s*;?\s*others: [a-z_]+/g, '').replace(/\s{2,}/g, ' ');
  const T = (x: Item) => typeset(scrub(plain[x.key]?.title || rawTitle(x.title)));
  const why = (x: Item) => typeset(scrub(plain[x.key]?.why || ''));
  const stars = (n: number) => '★★★★★'.slice(0, Math.max(0, Math.min(5, n))) + '☆☆☆☆☆'.slice(0, 5 - Math.max(0, Math.min(5, n)));
  const areaOf = (id: string) => R.areas.find((a) => a.id === id);
  const byArea = (id: string) => R.items.filter((x) => x.area === id).sort((a, b) => (sevRank[a.severity] ?? 9) - (sevRank[b.severity] ?? 9));
  /** A headline in the profile's two tones: the first clause in ink, the rest in grey. */
  const twoTone = (a: string, b?: string) => {
    if (b === undefined) {
      const m = a.match(/^(.{12,70}?[,;:—])\s+(.{8,})$/);
      if (m) { a = m[1].replace(/[;:]$/, m[1].endsWith(':') ? ':' : ','); b = m[2]; }
    }
    return `${esc(a)}${b ? `<br><span class="g">${esc(b)}</span>` : ''}`;
  };
  /** Finding rows in a banded table: status, finding with what it means, where we saw it. */
  const itemRows = (list: Item[]) => list.length ? `<table class="band items"><tbody>${list.map((x) => `<tr><td class="st-cell"><span class="pill ${sevClass(x.severity)}">${esc(sevWord(x.severity))}</span></td><td><p class="t">${esc(T(x))}</p>${why(x) ? `<p class="w">${esc(why(x))}</p>` : ''}</td><td class="where">${seeIt(x.source)}</td></tr>`).join('')}</tbody></table>` : '';
  let pageNo = 0;
  const foot = (section = '') => `<footer class="pf"><span>${esc(name)} · Online Presence Audit ${esc(R.checked_on.slice(0, 4))}</span><span>${section ? `<span class="sec">${esc(section)}</span>` : ''}<b>${String(++pageNo).padStart(2, '0')}</b></span></footer>`;

  // ---------- visuals ----------
  /** Google-style card for an unanswered bad review. */
  const reviewCard = (x: any) => `<figure class="gcard"><div class="gtop"><span class="av" aria-hidden="true">${esc(String(x.author ?? '?').trim().charAt(0).toUpperCase())}</span><div><b>${esc(x.author)}</b> <span class="stars">${stars(x.stars)}</span><span class="muted"> · ${esc(dateOf(x.date))} · ${esc(x.listing)}</span></div></div>
    ${x.text ? `<blockquote>“${esc(typeset(clip(String(x.text), 420)))}”</blockquote>` : '<p class="muted">(a star rating with no text)</p>'}
    <p class="noreply">No reply from the owner${x.days_open != null ? ` for ${esc(x.days_open)} days` : ''}</p></figure>`;

  /** Reviews a month, with the spike and the 1★ months marked. */
  function timeline(): string {
    const m = R.reviews.monthly;
    if (m.length < 3) return '';
    const W = 720, H = 170, pad = 24, bw = (W - pad * 2) / m.length;
    const max = Math.max(...m.map((x) => x.n), 1);
    const burstMonths = new Set(R.reviews.bursts.map((b: any) => String(b.day).slice(0, 7)));
    const y = (n: number) => H - pad - (n / max) * (H - pad * 2);
    const bars = m.map((x, i) => {
      const h = Math.max(x.n ? 3 : 0, H - pad - y(x.n));
      return `<g><title>${esc(monthOf(x.month))}: ${x.n} review${x.n === 1 ? '' : 's'}${x.low ? `, ${x.low} of them 1–2★` : ''}</title>
        <rect class="${burstMonths.has(x.month) ? 'b-spike' : 'b-norm'}" x="${(pad + i * bw + 1).toFixed(1)}" y="${(H - pad - h).toFixed(1)}" width="${Math.max(2, bw - 2).toFixed(1)}" height="${h.toFixed(1)}" rx="1.5"/>
        ${x.low ? `<circle class="b-low" cx="${(pad + i * bw + bw / 2).toFixed(1)}" cy="${(H - pad - h - 8).toFixed(1)}" r="4"/>` : ''}</g>`;
    }).join('');
    const ticks = m.map((x, i) => (i === 0 || i === m.length - 1 || x.month.endsWith('-01')) ? `<text x="${(pad + i * bw + bw / 2).toFixed(1)}" y="${H - 6}" text-anchor="middle">${esc(monthOf(x.month))}</text>` : '').join('');
    const peak = m.reduce((a, b) => (b.n > a.n ? b : a));
    const px = pad + m.indexOf(peak) * bw;
    const right = px < W / 2;
    const spike = burstMonths.has(peak.month) ? `<text class="ann" x="${(right ? px + bw + 6 : px - 6).toFixed(1)}" y="${(y(peak.n) + 12).toFixed(1)}" text-anchor="${right ? 'start' : 'end'}">${esc(peak.n)} reviews in ${esc(monthOf(peak.month))}</text>` : '';
    return `<figure class="chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Reviews per month"><line class="axis" x1="${pad}" x2="${W - pad}" y1="${H - pad}" y2="${H - pad}"/>${bars}${ticks}${spike}</svg>
      <figcaption>Google reviews each month, all your listings. <span class="k k-spike"></span> a month with a one-day spike Google may read as a review drive · <span class="k k-low"></span> a 1–2★ review</figcaption></figure>`;
  }

  /** The Maps result a customer sees in the main town, with you in it. */
  function mapsBoard(): string {
    const a = R.maps.by_area[0];
    if (!a || !a.top.length) return '';
    const us = R.maps.our;
    const max = Math.max(...a.top.map((t: any) => t.reviews ?? 0), us?.reviews ?? 0, 1);
    const row = (rank: string, n: string, rating: number | null, reviews: number | null, me = false) => `<tr class="${me ? 'me' : ''}"><td class="rk">${esc(rank)}</td><td>${esc(n)}${rating ? ` <span class="muted">${esc(rating)}★</span>` : ''}</td><td class="barc"><span class="bar"><i style="width:${(((reviews ?? 0) / max) * 100).toFixed(1)}%"></i></span></td><td class="num">${reviews ?? '–'}</td></tr>`;
    const top = a.top.slice(0, 5).map((t: any, i: number) => row(`#${i + 1}`, t.name.replace(/\s*[-–|].*$/, ''), t.rating, t.reviews)).join('');
    const gap = (a.best_rank ?? 99) > 6 ? `<tr class="gap"><td></td><td colspan="3">${a.best_rank ? `${a.best_rank - 6} more businesses` : 'everyone else on the list'}</td></tr>` : '';
    const me = row(a.best_rank ? `#${a.best_rank}` : '—', us ? `You · ${us.name}` : 'You', us?.rating ?? null, us?.reviews ?? null, true);
    const towns = R.maps.by_area.slice(1);
    return `<figure class="chart"><table class="board"><thead><tr><th>Rank</th><th>Business</th><th colspan="2">Google reviews</th></tr></thead><tbody>${top}${gap}${me}</tbody></table>
      <figcaption>Google Maps, searching “${esc(a.query)}”.</figcaption></figure>
      ${towns.length ? `<div class="stats small-stats">${towns.map((t) => `<div><b>${t.best_rank ? `#${esc(t.best_rank)}` : '—'}</b><span>${esc(t.area)}${t.best_rank ? ` · of ${esc(t.of)}` : ` · not in top ${esc(t.of || 20)}`}</span></div>`).join('')}</div>` : ''}`;
  }

  /** Who AI assistants name when a customer asks for a recommendation, and you. */
  function aiVoice(): string {
    if (!R.ai.trade_answers) return '';
    const max = Math.max(...R.ai.share.map((s) => s.n), R.ai.named_us, 1);
    const row = (n: string, c: number, me = false) => `<tr class="${me ? 'me' : ''}"><td>${esc(n)}</td><td class="barc"><span class="bar"><i style="width:${((c / max) * 100).toFixed(1)}%"></i></span></td><td class="num">${c} of ${R.ai.trade_answers}</td></tr>`;
    return `<figure class="chart"><table class="board"><thead><tr><th>Business named</th><th colspan="2">How often</th></tr></thead><tbody>${R.ai.share.map((s) => row(s.name, s.n)).join('')}${row('You', R.ai.named_us, true)}</tbody></table>
      <figcaption>A customer asks: “${esc(R.ai.trade_question ?? 'Who is the best?')}” Names given across ${R.ai.trade_answers} answers.</figcaption></figure>`;
  }

  /** Right, wrong and "don't know" when customers ask AI about you by name: from memory, then with a web search. */
  function aiAccuracy(): string {
    const modes = [R.ai.memory, R.ai.search].filter(Boolean) as any[];
    if (!modes.length) return '';
    const bar = (m: any) => {
      const t = m.right + m.mixed + m.wrong + m.dont_know || 1;
      const seg = (n: number, cls: string, label: string) => (n ? `<i class="${cls}" style="width:${((n / t) * 100).toFixed(1)}%" title="${esc(label)}: ${n}"></i>` : '');
      return `<tr><td>${esc(m.model)}</td><td class="barc"><span class="stack">${seg(m.right, 's-good', 'Right')}${seg(m.mixed, 's-fix', 'Partly right')}${seg(m.wrong, 's-urgent', 'Wrong')}${seg(m.dont_know, 's-none', "Didn't know you")}</span></td><td class="num">${m.right} right · ${m.wrong} wrong · ${m.dont_know} unknown</td></tr>`;
    };
    return `<figure class="chart"><table class="board">${modes.map((md) => `<thead><tr><th colspan="3">${esc(md.label)}</th></tr></thead><tbody>${md.models.map(bar).join('')}</tbody>`).join('')}</table>
      <figcaption>Questions about you by name: phone, address, website, licences, reputation. <span class="k s-good"></span> right <span class="k s-fix"></span> partly right <span class="k s-urgent"></span> wrong <span class="k s-none"></span> did not know you</figcaption></figure>
      ${(R.ai.memory?.wrong_examples ?? []).length ? `<div class="panel dark"><p class="lbl">What an assistant told a customer about you</p>${R.ai.memory!.wrong_examples.slice(0, 3).map((w: any) => `<p class="quote">“${esc(typeset(clip(w.claim, 140)))}”</p>`).join('')}<p class="small">None of these is correct.</p></div>` : ''}`;
  }

  const shotFig = (s: any) => `<figure class="shot"><img src="data:image/jpeg;base64,${s.img}" alt="${esc(s.caption)}" loading="lazy"><figcaption><b>${esc(s.caption)}.</b> ${esc(hostOf(s.url))}${esc(pathOf(s.url))} · ${esc(dateOf(s.taken_at))}</figcaption></figure>`;
  const proofShots = shots.filter((s) => s.key !== 'cover');
  const coverShot = shots.find((s) => s.key === 'cover');

  // Credentials as a banded table: what the official register says about each claim.
  const credLabel = (c: any) => (c.verdict === 'contradicted' && c.direction === 'undersell' ? ['good', 'Better than you claim'] : c.verdict === 'verified' ? ['good', 'Confirmed'] : c.verdict === 'contradicted' ? ['urgent', 'Register says otherwise'] : c.verdict === 'not found' ? ['fix', 'Not found'] : ['info', 'No public register']);
  const credTable = (list: any[]) => list.length ? `<table class="band"><thead><tr><th>Your claim</th><th>Register</th><th>Result</th></tr></thead><tbody>${list.map((c: any) => { const [cls, lbl] = credLabel(c); return `<tr><td>${esc(clip(c.claim, 120))}</td><td class="where">${seeIt(c.source) || '–'}</td><td><span class="pill ${cls}">${esc(lbl)}</span></td></tr>`; }).join('')}</tbody></table>` : '';
  const creds = R.credentials.list.filter((c: any) => c.verdict !== "can't check automatically");
  const credUnchecked = R.credentials.list.filter((c: any) => c.verdict === "can't check automatically");

  // ---------- part visuals ----------
  const KIND: Record<string, string> = { phone: 'Phone', whatsapp: 'WhatsApp', email: 'Email', address: 'Address' };
  const CONTACT_PILL: Record<string, [string, string]> = { current: ['good', 'Reaches you'], outdated: ['fix', 'Out of date'], someone_else: ['urgent', 'Someone else’s'], personal: ['fix', 'A staff member’s own'], broken: ['urgent', 'Does not work'], unclear: ['info', 'Unclear'] };
  const CONTACT_ORDER = ['broken', 'someone_else', 'personal', 'outdated', 'unclear', 'current'];
  const placeOf = (w: string) => w.replace(/^your website: https?:\/\/(www\.)?/, 'your site: ').replace(/\s*\([^)]*\)$/, '').replace(/\/$/, '');
  /** Every contact point, where it is published and where it really leads. */
  function contactTable(): string {
    const pts = [...R.contact.points].sort((a: any, b: any) => CONTACT_ORDER.indexOf(a.status) - CONTACT_ORDER.indexOf(b.status)).slice(0, 16);
    if (!pts.length) return '';
    return `<table class="band"><thead><tr><th>Contact</th><th>Published on</th><th>Where it leads</th></tr></thead><tbody>${pts.map((p: any) => {
      const [cls, lbl] = p.left ? ['urgent', 'Someone who has left'] : CONTACT_PILL[p.status] ?? CONTACT_PILL.unclear;
      return `<tr><td><span class="muted">${esc(KIND[p.kind] ?? p.kind)}</span><br><b>${esc(clip(String(p.value), 70))}</b></td><td class="small">${esc(clip([...new Set(p.where.map(placeOf))].slice(0, 3).join(' · '), 150))}${p.also_on ? ` <span class="muted">+${esc(p.also_on)} other pages</span>` : ''}</td><td><span class="pill ${cls}">${esc(lbl)}</span>${p.owner && p.status !== 'current' ? `<p class="small muted">${esc(clip(String(p.owner), 60))}</p>` : ''}</td></tr>`;
    }).join('')}</tbody></table>`;
  }
  const PILL3: Record<string, [string, string]> = { 'well covered': ['good', 'Well covered'], mentioned: ['fix', 'Mentioned'], missing: ['urgent', 'Missing'], right: ['good', 'Right'], vague: ['fix', 'Vague'], wrong: ['urgent', 'Wrong'] };
  /** How a stranger reads the brand: the answer to "why you", the five-second test, the offer as others see it. */
  function brandPanel(): string {
    const b = R.brand_view;
    if (b.score == null && !b.offer.length) return '';
    const pill = (v: string) => { const [c, l] = PILL3[String(v)] ?? ['info', String(v || '–')]; return `<span class="pill ${c}">${esc(l)}</span>`; };
    return `<div class="pair"><div class="panel dark"><p class="lbl">Why choose you, as a stranger reads it</p><p class="quote">${b.why ? `“${esc(typeset(clip(String(b.why), 220)))}”` : 'Nothing online answers it.'}</p></div>
      <div class="panel light"><p class="lbl">The five-second test of your homepage</p><p><b>${b.five?.pass === false ? 'Fails.' : b.five?.pass ? 'Passes.' : '–'}</b> ${esc(typeset(clip(String(b.five?.understood ?? ''), 160)))}${b.five?.problem ? ` ${esc(clip(String(b.five.problem), 160))}` : ''}</p></div></div>
      ${b.offer.length ? `<table class="band"><thead><tr><th>What you sell</th><th>Outside your site</th><th>AI assistants</th></tr></thead><tbody>${b.offer.slice(0, 8).map((o: any) => `<tr><td>${esc(clip(String(o.item), 90))}</td><td>${pill(o.outside)}</td><td>${pill(o.ai)}</td></tr>`).join('')}</tbody></table>` : ''}
      ${b.missing.length ? `<p class="note"><b>Questions buyers ask that nothing online answers:</b> ${esc(typeset(b.missing.slice(0, 6).join('; ')))}.</p>` : ''}`;
  }
  const SENT: Record<string, [string, string]> = { positive: ['good', 'Positive'], neutral: ['info', 'Neutral'], negative: ['urgent', 'Negative'] };
  /** News, forum and social mentions of the company and its people, the negative ones first. */
  function newsTable(): string {
    const list = [...R.news.items].sort((a: any, b: any) => Number(b.sentiment === 'negative') - Number(a.sentiment === 'negative') || String(b.date).localeCompare(String(a.date))).slice(0, 10);
    if (!list.length) return R.news.counts ? '<p class="note">No news story, forum thread or public post about you or your key people turned up.</p>' : '';
    return `<table class="band"><thead><tr><th>When</th><th>What is said</th><th></th></tr></thead><tbody>${list.map((x: any) => {
      const [c, l] = SENT[x.sentiment] ?? SENT.neutral;
      return `<tr><td class="small">${esc(x.date || '–')}<br><span class="muted">${esc(x.host)}</span></td><td><p class="t">${x.about === 'person' && x.person ? `<b>${esc(x.person)}:</b> ` : ''}${esc(typeset(clip(String(x.summary ?? x.title), 200)))}</p>${x.quote ? `<p class="w">“${esc(clip(String(x.quote), 180))}”</p>` : ''}</td><td><span class="pill ${c}">${esc(l)}</span>${seeIt(x.url)}</td></tr>`;
    }).join('')}</tbody></table>`;
  }
  const CHECK_PILL: Record<string, [string, string]> = { signals: ['good', 'Signals found'], conflict: ['urgent', 'Possible conflict'], none: ['info', 'Nothing found'], clear: ['good', 'Clear'], found: ['urgent', 'Found'], public: ['good', 'Public'], not_public: ['info', 'Not public'], not_checked: ['info', 'Not checked'], could_not_check: ['info', 'Could not check'] };
  /** The official and public records a buyer checks, one row each. */
  function checksTable(): string {
    const cs = R.records.checks;
    if (!cs.length) return '';
    return `<table class="band"><thead><tr><th>Record</th><th>What it shows</th><th>Result</th></tr></thead><tbody>${cs.map((c: any) => {
      const [cls, lbl] = c.id === 'gov' && c.result === 'found' ? ['good', 'On record'] : CHECK_PILL[c.result] ?? CHECK_PILL.not_checked;
      return `<tr><td><b>${esc(c.label)}</b>${c.where ? `<br><span class="muted small">${esc(c.where)}</span>` : ''}</td><td class="small">${esc(typeset(clip(String(c.detail ?? ''), 220)))}</td><td><span class="pill ${cls}">${esc(lbl)}</span>${seeIt(c.source)}</td></tr>`;
    }).join('')}</tbody></table>`;
  }
  /** How the world's mail systems see each email domain: blacklists, then the records that prove mail is really yours. */
  function emailTable(): string {
    const es = R.assets.email;
    if (!es.length) return '';
    const lists = R.assets.blacklists.filter((b: any) => b.working);
    const yes = (ok: boolean, good: string, bad: string, cls = 'fix') => `<span class="pill ${ok ? 'good' : cls}">${esc(ok ? good : bad)}</span>`;
    return `<h4 class="tbl-h">How the world’s mail systems see your email</h4><table class="band"><thead><tr><th>Email domain</th><th>Spam blacklists</th><th>SPF</th><th>DKIM</th><th>DMARC</th></tr></thead><tbody>${es.map((e: any) => {
      const hit = lists.filter((b: any) => e.lists[b.id]?.listed?.length);
      // A lookup that timed out is not a clean result; say how much was checked.
      const partly = lists.some((b: any) => e.lists[b.id]?.failed > 0);
      const bl = !lists.length ? '<span class="pill info">Not checked</span>' : hit.length ? `<span class="pill urgent">Listed: ${esc(hit.map((b: any) => b.name).join(', '))}</span>` : partly ? '<span class="pill good">Clear</span> <span class="muted small">some lookups unanswered</span>' : '<span class="pill good">Clear</span>';
      const spf = !e.spf.record ? '<span class="pill fix">Missing</span>' : e.spf.records > 1 || e.spf.all === '+all' ? '<span class="pill urgent">Broken</span>' : e.spf.lookups > 10 ? '<span class="pill fix">Over limit</span>' : '<span class="pill good">Set</span>';
      const dmarc = !e.dmarc ? '<span class="pill fix">Missing</span>' : /none/i.test(e.dmarc) ? '<span class="pill fix">Watching only</span>' : '<span class="pill good">Enforced</span>';
      return `<tr><td><b>@${esc(e.domain)}</b><br><span class="muted small">${esc(e.mx.slice(0, 2).join(', '))}</span></td><td>${bl}</td><td>${spf}</td><td>${yes(e.dkim.length > 0, 'Found', 'Not found')}</td><td>${dmarc}</td></tr>`;
    }).join('')}</tbody></table>
      <p class="note">The servers that receive your mail (for most hosting mail, the same ones that send it) were checked against ${esc(lists.map((b: any) => b.name).join(' and ') || 'no blacklist (none answered)')}. Spamhaus, the list most mail systems use, needs a paid licence and was not checked. Gmail and Yahoo have required SPF, DKIM and DMARC from bulk senders since 2024; mail without them lands in spam more often.</p>`;
  }
  /** Every domain traced to the company: who holds it, until when, where it runs, who carries its email. */
  function assetTable(): string {
    const ds = R.assets.domains;
    if (!ds.length) return '';
    const left = (d: string | null) => (d ? Math.floor((Date.parse(d) - Date.parse(R.checked_on)) / 86_400_000) : null);
    const live = R.assets.subdomains.filter((x: any) => x.status);
    return `<table class="band"><thead><tr><th>Domain</th><th>Registered</th><th>Website</th><th>Email</th></tr></thead><tbody>${ds.map((d: any) => {
      const l = left(d.expires);
      const reg = `${esc(d.registrar ?? 'registrar unknown')}${d.registrant ? `<br>in the name of ${esc(d.registrant)}` : ''}${d.expires ? `<br>renews by ${esc(dateOf(d.expires))}${l !== null && l <= 90 ? ` <span class="pill ${l <= 30 ? 'urgent' : 'fix'}">${esc(l)} days</span>` : ''}` : ''}`;
      const web = d.site ? `${d.site.parked ? '<span class="pill urgent">Parked</span> ' : d.site.status >= 400 || !d.site.status ? '<span class="pill urgent">Does not open</span> ' : ''}${esc(d.host ?? '')}${d.site.cms ? `<br>${esc(d.site.cms)}${d.site.version ? ' ' + esc(d.site.version) : ''}` : ''}${d.cert?.valid_to ? `<br>certificate to ${esc(dateOf(d.cert.valid_to))}` : ''}` : '<span class="muted">no website</span>';
      const mail = d.mail ? `${esc(d.mail)}<br>${d.dmarc && d.dmarc !== 'none' ? '<span class="pill good">Protected</span>' : `<span class="pill fix">${d.dmarc ? 'Watching only' : 'Can be faked'}</span>`}` : '<span class="muted">no email</span>';
      return `<tr><td><b>${esc(d.domain)}</b><br><span class="muted small">${esc(d.why.join(', '))}</span></td><td class="small">${reg}</td><td class="small">${web}</td><td class="small">${mail}</td></tr>`;
    }).join('')}</tbody></table>
      ${emailTable()}
      ${live.length ? `<p class="note">The public certificate logs also show ${esc(live.length)} live subdomain${live.length === 1 ? '' : 's'}: ${esc(live.slice(0, 6).map((x: any) => x.name).join(', '))}.</p>` : ''}`;
  }
  /** Google's four scores for each official homepage, on mobile and desktop, and what real visitors saw. */
  function speedTable(): string {
    const ps = R.speed.pages;
    if (!ps.length) return '';
    const cell = (n: number | undefined) => (n == null ? '<td class="num">–</td>' : `<td class="num"><span class="pill ${n >= 90 ? 'good' : n >= 50 ? 'fix' : 'urgent'}">${esc(n)}</span></td>`);
    const real = ps.filter((p: any) => p.field && Object.keys(p.field.metrics).length);
    return `<table class="band"><thead><tr><th>Homepage</th><th>Speed</th><th>Accessibility</th><th>Best practices</th><th>SEO</th></tr></thead><tbody>${ps.map((p: any) => `<tr><td><b>${esc(p.site)}</b><br><span class="muted small">${p.strategy === 'mobile' ? 'on a phone' : 'on a computer'}${p.lab?.['Main content shown'] ? ` · main content in ${esc(p.lab['Main content shown'])}` : ''}</span></td>${cell(p.scores?.performance)}${cell(p.scores?.accessibility)}${cell(p.scores?.['best-practices'])}${cell(p.scores?.seo)}</tr>`).join('')}</tbody></table>
      ${ps.filter((p: any) => p.fixes?.length && (p.scores?.performance ?? 100) < 90).map((p: any) => `<h4 class="tbl-h">Google’s top fixes for ${esc(p.site)} ${p.strategy === 'mobile' ? 'on a phone' : 'on a computer'}</h4><table class="band"><tbody>${p.fixes.map((f: any) => `<tr><td>${esc(f.title)}</td><td class="where">${esc(f.saving)}</td></tr>`).join('')}</tbody></table>`).join('')}
      <p class="note">Google’s scores out of 100: <span class="pill good">90+</span> good, <span class="pill fix">50–89</span> needs work, <span class="pill urgent">under 50</span> poor. ${real.length ? `Real Chrome visitors over the last 28 days: ${esc(real.map((p: any) => `${p.site} on ${p.strategy === 'mobile' ? 'phones' : 'computers'} rated ${p.field.overall || 'unrated'}`).join('; '))}.` : 'Google has too few real visitors on record to rate your sites’ real-world speed.'}</p>`;
  }
  /** A topic inside a part, headed by its own question. */
  const topic = (id: string, inner: string) => (inner.trim() ? `<h4 class="tbl-h">${esc(OPENERS[id].q[0])} ${esc(OPENERS[id].q[1])}</h4>${inner}` : '');

  function visual(theme: string): string {
    if (theme === 'contact') return contactTable();
    if (theme === 'understanding') return `${brandPanel()}${topic('findability', mapsBoard())}${topic('ai', aiVoice() + aiAccuracy())}${topic('website', proofShots.length ? `<div class="shots">${proofShots.slice(0, 3).map(shotFig).join('')}</div>` : '')}`;
    if (theme === 'voice') { const n = newsTable(); return `${topic('reputation', `${R.reviews.unanswered_low.slice(-2).reverse().map(reviewCard).join('')}${timeline()}`)}${n ? `<h4 class="tbl-h">In the news, on forums and on social media</h4>${n}` : ''}`; }
    if (theme === 'credibility') return `${checksTable()}${creds.length || credUnchecked.length ? `<h4 class="tbl-h">${esc(OPENERS.credentials.q[0])} ${esc(OPENERS.credentials.q[1])}</h4>${credTable(creds)}${credUnchecked.length ? `<p class="note">No public register exists for ${credUnchecked.length} other claim${credUnchecked.length === 1 ? '' : 's'} (${esc(credUnchecked.slice(0, 4).map((c: any) => clip(c.claim, 40)).join('; '))}${credUnchecked.length > 4 ? '; …' : ''}), so a stranger has to take your word for them.</p>` : ''}` : ''}`;
    if (theme === 'assets') return assetTable();
    if (theme === 'speed') return speedTable();
    return '';
  }

  // ---------- stories: the editor's, or built here from the numbers ----------
  const fallback: Record<string, () => any> = {
    contact: () => ({ headline: `${R.contact.bad} of the ${R.contact.total} contact details published about you lead the wrong way`, body: R.contact.summary ?? 'Old numbers, personal lines and mailboxes are still published where customers find them.', cost: 'A customer who reaches a dead line or the wrong person does not try a second time.', fix: 'Correct or remove every contact marked in this part, starting with Google Maps and the directories.' }),
    understanding: () => ({ headline: R.brand_view.score != null ? `The internet understands your business ${R.brand_view.score} out of 100` : `AI assistants recommended you in ${R.ai.named_us} of ${R.ai.trade_answers} answers`, body: R.brand_view.summary ?? `When a customer asks an AI assistant who to hire, it names ${R.ai.share.slice(0, 3).map((s) => s.name).join(', ')} instead.`, cost: 'A buyer who cannot tell what you sell, or why you are better, moves on to a business that says it plainly.', fix: R.brand_view.why ? 'Put your reason to be chosen, with proof, at the top of your homepage and in every listing.' : 'Write one sentence on why customers choose you, with proof, and use it everywhere.' }),
    voice: () => ({ headline: R.reviews.total ? `${R.reviews.replied} of your ${R.reviews.total} Google reviews have a reply from you` : `${R.news.counts?.news ?? 0} news articles name you`, body: R.reviews.unanswered_low.length ? `${R.reviews.unanswered_low.length} review${R.reviews.unanswered_low.length === 1 ? '' : 's'} of 1–2★ sit on your listing with no answer, the oldest for ${R.reviews.unanswered_low[0].days_open} days.` : 'What strangers say about you is the part of your reputation you do not write yourself.', cost: 'A complaint with no answer is the first thing a careful customer reads, and it reads as if nobody is listening.', fix: 'Reply publicly to every 1–2★ review this week, then to the rest.' }),
    credibility: () => ({ headline: `${R.records.risky.filter((c: any) => c.result === 'clear').length} of ${R.records.risky.length} public risk checks come back clear`, body: 'Alert lists, court judgments and insolvency notices are what a bank or tender panel checks first.', cost: 'One unexplained record can end a tender or a credit application before anyone asks you about it.', fix: 'Have a short explanation ready for anything found here, and show the records that work in your favour.' }),
    speed: () => ({ headline: R.speed.main_mobile ? `Google scores your homepage ${R.speed.main_mobile.scores.performance} out of 100 for speed on a phone` : 'Google could not score your homepage', body: 'Most customers open your site on a phone first. Google measures how long the page takes to show and to respond, and uses it when it ranks you.', cost: 'Visitors who wait for a slow page leave before they see what you offer.', fix: 'Hand Google’s top fixes in this part to your web developer, starting with the biggest saving.' }),
    assets: () => ({ headline: `${R.assets.issues} risks in the domains and email that carry your name`, body: 'Expiring domains, domains held in someone else’s name, and email anyone can fake.', cost: 'A lapsed domain takes your website and every email address down at once.', fix: 'Turn on auto-renew, move every domain into the company’s name, and add SPF and DMARC to your email domain.' }),
  };
  const themes = [...CHAPTER_ORDER] as string[];
  const edStories: any[] = (an.stories ?? []).filter((s: any) => themes.includes(s.theme));
  const stories: any[] = typesetAll((edStories.length ? edStories : themes.filter((t) => areaOf(t)?.ran && areaOf(t)?.status[0] !== 'good').slice(0, 3).map((t) => ({ theme: t, ...fallback[t]() })))
    .map((s: any) => ({ ...fallback[s.theme](), ...Object.fromEntries(Object.entries(s).filter(([, v]) => typeof v === 'string' && v.trim())) })));
  const storyOf = (t: string) => stories.find((s: any) => s.theme === t);
  // The speed part shows only when Google scored a homepage; without its key the run has nothing to say there.
  const chapters = CHAPTER_ORDER.filter((id) => areaOf(id)?.ran && (id !== 'speed' || R.speed.pages.length > 0));
  const chapterNo = (id: string) => chapters.indexOf(id as any) + 1;

  const verdict = an.verdict ?? '';
  const site = typesetAll(s2.site ?? null);
  const ai = typesetAll(s2.ai ?? null);
  const replies = typesetAll(s2.replies ?? null);
  const targets: any[] = s2.reply_targets ?? [];
  // The client's own report may name their staff, but lists no private document and no source the dive judged unrelated.
  const sources = publicSources(r.sources) as any[];

  // The five measured numbers on the dark "at a glance" page.
  const okClaims = R.credentials.list.filter((c: any) => c.verdict === 'verified' || c.direction === 'undersell').length;
  const checkable = R.credentials.list.filter((c: any) => !/can't check/.test(c.verdict)).length;
  const big: [string, string, string][] = ([
    areaOf('contact')?.ran && R.contact.judged ? ['contact', `${R.contact.ok}/${R.contact.total}`, 'contact details that reach you'] : null,
    areaOf('understanding')?.ran && R.brand_view.score != null ? ['understanding', `${R.brand_view.score}`, 'out of 100: how well the internet understands you'] : areaOf('understanding')?.ran && R.ai.trade_answers ? ['understanding', `${R.ai.named_us}/${R.ai.trade_answers}`, 'AI answers that recommend you'] : null,
    areaOf('voice')?.ran && R.reviews.total ? ['voice', `${R.reviews.replied}/${R.reviews.total}`, 'Google reviews with a reply from you'] : null,
    areaOf('credibility')?.ran && R.records.risky.length ? ['credibility', `${R.records.risky.filter((c: any) => c.result === 'clear').length}/${R.records.risky.length}`, 'public risk checks clear'] : areaOf('credibility')?.ran && checkable ? ['credibility', `${okClaims}/${checkable}`, 'claims the official registers confirm'] : null,
    areaOf('assets')?.ran && R.assets.domains.length ? ['assets', String(R.assets.issues), `risks across your ${R.assets.domains.length} domains`] : null,
    areaOf('speed')?.ran && R.speed.main_mobile ? ['speed', String(R.speed.main_mobile.scores.performance), `out of 100: Google’s speed score for your homepage on a phone`] : null,
  ].filter(Boolean) as [string, string, string][]);

  // Private alerts: register data exposing personal IDs, plus private documents a search engine indexed.
  const privateItems: string[] = [];
  for (const f of L['D-registry']?.findings ?? []) if (/^PRIVATE/i.test(f.title)) privateItems.push(`<b>${esc(f.title.replace(/^PRIVATE:\s*/i, ''))}.</b> ${esc(typeset(clip(String(f.detail ?? ''), 300)))}`);
  const searched = [
    ...Object.values(L['G-grounded']?.notes?.search_results ?? {}).flatMap((v: any) => (Array.isArray(v) ? v : v?.rows ?? []).map((x: any) => x.url ?? x)),
    ...(L['H-web']?.notes?.nameRows ?? []).map((x: any) => x.url),
  ].filter((u: any) => typeof u === 'string');
  const docs = [...new Set(searched.filter((u: string) => /proposal|invoice|\/inv[-/]|[?&]uid=|quotation/i.test(u)))];
  if (docs.length) privateItems.push(`<b>Search engines have indexed ${docs.length} private document link${docs.length === 1 ? '' : 's'}</b> (proposals or invoices meant for one customer). Put these behind a login or mark them no-index.`);

  const mismatch: any[] = an.mismatch?.length ? an.mismatch : (r.contradictions ?? []).slice(0, 5).map((c: string) => ({ issue: typeset(c.replace(/\[\d+\]/g, '').replace(/\s+/g, ' ').trim()), settled: null }));
  const checkedOn = dateOf(R.checked_on);
  const refNo = dive?.id != null && /^\d+$/.test(String(dive.id)) ? `No.${NB}${String(dive.id).padStart(4, '0')}` : '';
  // The assistants section G actually asked (the hub asks DeepSeek only), named for the method note.
  const modelNames = [...new Set(['G-fixed', 'G-grounded'].flatMap((l) => L[l]?.notes?.models ?? []).map((m: string) => (/deepseek/i.test(m) ? 'DeepSeek V4.1 Flash' : /gpt-6\.1/i.test(m) ? 'GPT-6.1' : m)))];
  const aiModels = modelNames.length ? modelNames.join(' and ') : 'AI assistants';

  // ---------- one chapter per area ----------
  function chapter(id: string): string {
    const a = areaOf(id)!;
    const op = PART_OPENERS[id];
    const s = storyOf(id);
    const list = byArea(id).filter((x) => x.severity === 'high' || x.severity === 'medium');
    const rest = byArea(id).length - Math.min(list.length, 6);
    const n = chapterNo(id);
    const subtitle = s?.headline ?? '';
    return `<section class="page" id="ch-${id}">
  <p class="eyebrow">Part ${n} · ${esc(CHAPTER_EYEBROW[id])}</p>
  <h2 class="display">${twoTone(op.q[0], op.q[1])}</h2>
  <div class="opener"><p class="lead">${esc(op.body({ trade, town }))}</p>
    <div class="aside"><p class="lbl">What we measured</p><p class="big">${esc(a.metric ?? 'Not measured in this run')}</p><span class="pill ${a.status[0]}">${esc(a.status[1])}</span><p class="checked">Checked ${esc(checkedOn)}</p></div></div>
  <h3 class="sub">What we found</h3>
  ${subtitle ? `<p class="kicker">${esc(subtitle)}</p>` : ''}
  ${s?.body ? `<p class="body">${esc(s.body)}</p>` : ''}
  ${visual(id)}
  ${s ? `<div class="pair"><div class="panel dark"><p class="lbl">What it costs you</p><p>${esc(s.cost)}</p></div><div class="panel light"><p class="lbl">Do this first</p><p>${esc(s.fix)}</p></div></div>` : ''}
  ${list.length ? `<h4 class="tbl-h">The items that matter most</h4>${itemRows(list.slice(0, 6))}` : `<p class="empty"><b>Nothing in this part is urgent or needs work.</b>${byArea(id).length ? ` Every check we ran here is in the <a href="#appx-${id}">full checklist</a>.` : ' Nothing turned up for the checklist either.'}</p>`}
  ${rest > 0 ? `<p class="note">${rest} more finding${rest === 1 ? '' : 's'} in this part ${rest === 1 ? 'is' : 'are'} in the <a href="#appx-${id}">full checklist</a>.</p>` : ''}
  ${foot(`Part ${n} · ${CHAPTER_EYEBROW[id]}`)}
</section>`;
  }

  const count = (n: number) => ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight'][n] ?? String(n);
  const partsOf = (themes: string[]) => themes.filter((t) => chapters.includes(t as any)).map((t) => `<a class="see" href="#ch-${t}">Part ${chapterNo(t)}</a>`).join(', ');

  // ---------- the full analysis: one read across every part ----------
  function analysis(): string {
    const assess = (id: string) => (an.parts ?? []).find((p: any) => p.theme === id)?.assessment ?? '';
    const threads: any[] = an.threads ?? [];
    const lists: [string, string[]][] = [['What you can build on', an.strengths ?? []], ['If nothing changes', an.risks ?? []], ['What you could win', an.opportunities ?? []]];
    return `<section class="page" id="analysis">
  <p class="eyebrow">Part ${chapters.length + 1} · Full analysis</p>
  <h2 class="display">What it all means,<br><span class="g">read across all ${count(chapters.length)} parts.</span></h2>
  ${verdict ? `<p class="lead" style="max-width:40em">${esc(verdict)}</p>` : ''}
  <h3 class="sub">Part by part</h3>
  <table class="band items"><tbody>${chapters.map((id) => { const a = areaOf(id)!; return `<tr><td class="st-cell"><span class="pill ${a.status[0]}">${esc(a.status[1])}</span></td><td><p class="t"><a class="see" href="#ch-${id}">Part ${chapterNo(id)} · ${esc(CHAPTER_EYEBROW[id])}</a></p>${assess(id) ? `<p class="w">${esc(assess(id))}</p>` : ''}</td><td class="where">${esc(a.metric ?? '–')}</td></tr>`; }).join('')}</tbody></table>
  ${threads.length ? `<h3 class="sub">What ties it together</h3><div class="grid2">${threads.map((t: any) => `<div class="box"><h4>${esc(t.title)}</h4><p>${esc(t.body)}</p>${partsOf(t.themes ?? []) ? `<p class="small muted">Seen in ${partsOf(t.themes ?? [])}</p>` : ''}</div>`).join('')}</div>` : ''}
  ${lists.some(([, l]) => l.length) ? `<div class="grid3">${lists.filter(([, l]) => l.length).map(([h, l]) => `<div class="box"><h4>${esc(h)}</h4><ul>${l.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>`).join('')}</div>` : ''}
  ${!verdict && !(an.parts ?? []).length ? '<p class="note">The full analysis was not written in this run; each part above carries its own findings.</p>' : ''}
  ${foot(`Part ${chapters.length + 1} · Full analysis`)}
</section>`;
  }

  // ---------- the action plan: one task list per department ----------
  const WHEN: Record<string, [string, string]> = { week: ['urgent', 'This week'], month: ['fix', 'This month'], quarter: ['info', 'Within 3 months'] };
  const READY_AT: Record<string, string> = { homepage: 'd-site', fixes: 'd-site', pages: 'd-pages', replies: 'd-reviews', ask: 'd-reviews', faq: 'd-ai', ai: 'd-ai', jsonld: 'd-jsonld' };
  const itemByKey = new Map(R.items.map((x) => [x.key, x]));
  // Without S5 every urgent and needs-work finding still lands under the department that does it.
  const plan: any[] = typesetAll(L['S5-plan']?.notes?.depts) ?? DEPTS.map((d) => ({ dept: d.id, tasks: [], also: R.items.filter((x) => (x.severity === 'high' || x.severity === 'medium') && deptOf(x) === d.id).map((x) => ({ key: x.key, theme: x.area })) }));
  const readyWords: Record<string, string> = L['S5-plan']?.notes?.ready ?? {};
  function actionPlan(): string {
    const n = chapters.length + 2;
    const tasks = plan.reduce((t, d) => t + d.tasks.length, 0);
    const rows = (d: any) => d.tasks.map((t: any) => `<tr><td class="cb" aria-hidden="true">☐</td><td><p class="t">${esc(t.task)}</p>${t.why ? `<p class="w">${esc(t.why)}</p>` : ''}${t.how ? `<p class="small">${esc(t.how)}</p>` : ''}${t.ready && READY_AT[t.ready] ? `<p class="small"><a class="see" href="#${READY_AT[t.ready]}">Done for you: ${esc(readyWords[t.ready] ?? 'a draft')}&nbsp;↓</a></p>` : ''}</td><td class="tg"><div><span class="pill ${(WHEN[t.when] ?? WHEN.month)[0]}">${esc((WHEN[t.when] ?? WHEN.month)[1])}</span>${t.effort ? `<span class="pill info">${esc(t.effort)}</span>` : ''}${t.theme && chapters.includes(t.theme) ? partsOf([t.theme]) : ''}</div></td></tr>`).join('');
    const also = (d: any) => d.also.map((a: any) => itemByKey.get(a.key)).filter(Boolean) as Item[];
    return `<section class="page" id="plan">
  <p class="eyebrow">Part ${n} · Action plan</p>
  <h2 class="display">Your action plan,<br><span class="g">department by department.</span></h2>
  <p class="lead" style="max-width:40em">${tasks ? `${tasks} task${tasks === 1 ? '' : 's'}, compiled from all ${count(chapters.length)} parts and the analysis.` : 'Every urgent and needs-work finding, sorted by who does the work.'} Hand each list to the people who do the work, and tick each task off as it is done.</p>
  <div class="depts">${DEPTS.map((d) => { const p = plan.find((x) => x.dept === d.id) ?? { tasks: [], also: [] }; const week = p.tasks.filter((t: any) => t.when === 'week').length; return `<a href="#plan-${d.id}"><b>${p.tasks.length || p.also.length}</b><span>${esc(d.title)}</span><span class="muted">${p.tasks.length ? (week ? `${week} this week` : 'none this week') : `${p.also.length ? 'findings' : 'nothing'} to fix`}</span></a>`; }).join('')}</div>
  ${DEPTS.map((d) => { const p = plan.find((x) => x.dept === d.id) ?? { tasks: [], also: [] }; const more = also(p); return `<div class="dept" id="plan-${d.id}"><h3 class="sub">${esc(d.title)} <span class="muted deptc">${esc(d.covers)}</span></h3><p class="note"><b>Who does it:</b> ${esc(d.who)}</p>
  ${p.tasks.length ? `<table class="band tasks"><tbody>${rows(p)}</tbody></table>` : ''}
  ${more.length ? `<p class="lbl">${p.tasks.length ? 'Also on this list' : 'To fix'}</p><ul class="plain small">${more.map((x) => `<li>${esc(T(x))} ${partsOf([x.area])}</li>`).join('')}</ul>` : ''}
  ${!p.tasks.length && !more.length ? '<p class="empty"><b>Nothing for this department right now.</b> No finding in this report needs its work.</p>' : ''}</div>`; }).join('')}
  ${foot(`Part ${n} · Action plan`)}
</section>`;
  }

  return shell(`${name}: Online Presence Audit`, `<section class="page dark cover">
  <div class="cover-top"><b>${esc(name)}</b><span>Online Presence Audit ${esc(R.checked_on.slice(0, 4))}${refNo ? ` · ${esc(refNo)}` : ''}</span></div>
  <div class="cover-mid">
    <h1>How customers, Google and AI<br><span class="g">see, reach and check your business.</span></h1>
    ${coverShot ? `<div><div class="phone"><img src="data:image/jpeg;base64,${coverShot.img}" alt="${esc(name)} homepage on a phone"></div><p class="phone-cap">${esc(hostOf(coverShot.url))} on a phone</p></div>` : ''}
  </div>
  <div class="cover-bot"><div><b>Prepared for ${esc(name)}</b>${esc([R.identity.ssm ? `SSM${NB}${R.identity.ssm}` : '', R.identity.domains.join(', ')].filter(Boolean).join(' · '))}</div><div><b>Checked ${esc(checkedOn)}</b>${R.reviews.total ? `${esc(R.reviews.total)} reviews read · ` : ''}${R.ai.trade_answers ? `${esc((R.ai.memory?.models ?? []).concat(R.ai.search?.models ?? []).reduce((t: number, m: any) => t + m.asked + m.trade_asked, 0))} AI answers checked · ` : ''}every page of your sites tested</div></div>
</section>

<nav class="chapnav" aria-label="Sections"><a href="#glance">At a glance</a>${stories.length ? '<a href="#stories">Fix first</a>' : ''}${chapters.map((id) => `<a href="#ch-${id}">${esc(CHAPTER_EYEBROW[id])}</a>`).join('')}<a href="#analysis">Full analysis</a><a href="#stranger">Trust</a><a href="#plan">Action plan</a><a href="#ready">Ready to use</a><a href="#appendix">Checklist</a></nav>

<section class="page dark" id="glance">
  <p class="eyebrow">At a glance</p>
  <h2 class="display">Where you stand,<br><span class="g">in ${['no', 'one', 'two', 'three', 'four', 'five', 'six'][big.length] ?? big.length} numbers.</span></h2>
  ${big.length ? `<div class="stats">${big.map(([id, v, l]) => `<div><b>${esc(v)}</b><span>${esc(l)}</span></div>`).join('')}</div>` : ''}
  ${verdict ? `<p class="verdict" style="margin-top:14px">${esc(verdict)}</p>` : ''}
  <div class="rows" style="margin-top:auto">${chapters.map((id) => { const a = areaOf(id)!; return `<a href="#ch-${id}"><b>${esc(a.title)}</b><span>${esc(a.metric ?? '')}</span><span class="pill ${a.status[0]}">${esc(a.status[1])}</span></a>`; }).join('')}</div>
  ${foot('At a glance')}
</section>

${stories.length ? `<section class="page" id="stories">
  <p class="eyebrow">Fix these first</p>
  <h2 class="display">${stories.length === 1 ? 'One problem' : `${['', 'One', 'Two', 'Three'][stories.length]} problems`}<br><span class="g">are costing you the most customers.</span></h2>
  <p class="lead" style="max-width:40em">Out of ${R.items.length} things we checked, these ${stories.length === 1 ? 'is the one' : `are the ${stories.length}`} that turn the most customers away. Each has its own part with the evidence.</p>
  <div class="three">${stories.map((s: any, i: number) => `<div class="item"><span class="n">${String(i + 1).padStart(2, '0')}</span><div><p class="lbl">${esc(CHAPTER_EYEBROW[s.theme])} · Part ${chapterNo(s.theme)}</p><h3>${esc(tie(s.headline))}</h3>
    <div class="cols"><div><p class="lbl">What it costs you</p><p>${esc(s.cost)}</p></div><div><p class="lbl">Do this first</p><p>${esc(s.fix)}</p></div></div></div></div>`).join('')}</div>
  ${foot('Fix these first')}
</section>` : ''}

${chapters.map(chapter).join('\n')}

${analysis()}

<section class="page" id="stranger">
  <p class="eyebrow">Part ${chapters.length + 1} · Full analysis · What a stranger sees</p>
  <h2 class="display">What a customer, bank or tender officer<br><span class="g">learns about you in ten minutes.</span></h2>
  <table class="band idtable"><tbody>
    <tr><td>Company</td><td><b>${esc(name)}</b></td></tr>
    <tr><td>Registration</td><td>${R.identity.ssm ? esc(R.identity.ssm) : '<span class="muted">Not found in any public record we checked</span>'}</td></tr>
    ${R.credentials.cidb_grade ? `<tr><td>CIDB grade (official register)</td><td>${esc(R.credentials.cidb_grade)}</td></tr>` : ''}
    ${R.maps.our ? `<tr><td>Google rating</td><td>${esc(R.maps.our.rating)}★ from ${esc(R.maps.our.reviews)} reviews</td></tr>` : ''}
    ${R.identity.address ? `<tr><td>Address</td><td>${esc(R.identity.address)}</td></tr>` : ''}
    ${R.identity.domains.length ? `<tr><td>Websites</td><td>${esc(R.identity.domains.join(', '))}</td></tr>` : ''}
  </tbody></table>
  ${mismatch.length ? `<h3 class="sub">What does not add up</h3><table class="band"><tbody>${mismatch.map((m: any) => `<tr><td><p class="t">${esc(m.issue)}</p>${m.settled ? `<p class="w">The official register ${esc(m.settled)}</p>` : ''}</td><td class="where">${m.source ? seeIt(m.source) : ''}</td></tr>`).join('')}</tbody></table>` : ''}
  ${R.reviews.good_quotes.length ? `<h3 class="sub">What your customers say, in their words</h3><div class="quotes">${R.reviews.good_quotes.map((q: any) => `<blockquote>“${esc(typeset(clip(String(q.text), 260)))}”<cite>${esc(q.author)} · ${esc(dateOf(q.date))}</cite></blockquote>`).join('')}</div>${R.reviews.praise.length ? `<p class="note">Praised most for: ${esc(R.reviews.praise.map(([p, n]) => `${p} (${n})`).join(', '))}. None of this appears on your website yet.</p>` : ''}` : ''}
  ${privateItems.length ? `<div class="private"><p class="lbl" style="color:var(--urgent)">Private: for you only</p><ul class="plain">${privateItems.map((x) => `<li>${x}</li>`).join('')}</ul></div>` : ''}
  ${foot(`Part ${chapters.length + 1} · What a stranger sees`)}
</section>

${actionPlan()}

<section class="page" id="ready">
  <p class="eyebrow">Part ${chapters.length + 2} · Action plan · Ready to use</p>
  <h2 class="display">Done for you:<br><span class="g">copy, replies and pages.</span></h2>
  <p class="lead" style="max-width:40em">The drafts the action plan points to, written only from facts we verified. Read each one before you publish it.</p>
  <h3 class="sub" id="d-site">Your homepage, rewritten</h3>
  ${site ? `<p class="body">${esc(site.verdict)}</p>${site.one_site_or_two ? `<p class="body"><b>One site or two?</b> ${esc(site.one_site_or_two)}</p>` : ''}
  ${site.homepage ? `<div class="hero"><div class="hl">${esc(site.homepage.headline)}</div><p>${esc(site.homepage.subheadline)}</p>${(site.homepage.proof_points ?? []).length ? `<ul>${site.homepage.proof_points.map((p: string) => `<li>${esc(p)}</li>`).join('')}</ul>` : ''}<span class="btn">${esc(site.homepage.cta)}</span></div>
  <div class="grid3">${(site.homepage.sections ?? []).map((x: any) => `<div class="box"><h4>${esc(x.title)}</h4><p>${esc(x.body)}</p></div>`).join('')}</div>` : ''}
  ${(site.pages_to_fix ?? []).length ? `<h4 class="tbl-h">Pages to fix</h4><table class="band"><thead><tr><th>Page</th><th>Problem</th><th>Fix</th></tr></thead><tbody>${site.pages_to_fix.map((p: any) => `<tr><td>${esc(p.page)}</td><td>${esc(p.problem)}</td><td>${esc(p.fix)}</td></tr>`).join('')}</tbody></table>` : ''}` : '<p class="note">The website plan was not written in this run.</p>'}
  ${(site?.pages_to_add ?? []).length ? `<h3 class="sub" id="d-pages">Pages to add, town by town</h3><div class="grid3">${site.pages_to_add.map((p: any) => `<div class="box"><code>${esc(p.slug)}</code><h4>${esc(p.title)}</h4><p class="muted">${esc(p.why)}</p><ul>${(p.outline ?? []).map((o: string) => `<li>${esc(o)}</li>`).join('')}</ul></div>`).join('')}</div>` : ''}
  <h3 class="sub" id="d-reviews">Review replies, ready to post</h3>
  ${(replies?.replies ?? []).length ? `${replies.replies.map((x: any) => { const t = targets[x.i] ?? {}; return `<div class="reply"><div><p class="small"><span class="stars">${stars(Number(t.stars) || 0)}</span> <span class="muted">${esc(t.author ?? '')} · ${esc(dateOf(t.date))}</span></p>${t.text ? `<p class="q">${esc(typeset(clip(String(t.text), 260)))}</p>` : '<p class="q">(star rating only)</p>'}</div><div><p class="a">${esc(x.reply)}</p>${x.reply_en ? `<p class="a muted">${esc(x.reply_en)}</p>` : ''}${x.note ? `<p class="small muted" style="margin-top:4px"><b>Before posting:</b> ${esc(x.note)}</p>` : ''}</div></div>`; }).join('')}
  <div class="grid2" style="margin-top:6px">${replies.template_5star ? `<div class="box"><h4>Thank-you reply for 5★ reviews</h4><p>${esc(replies.template_5star)}</p></div>` : ''}${replies.ask_message ? `<div class="box"><h4>WhatsApp message asking for a review</h4><p>${esc(replies.ask_message)}</p></div>` : ''}</div>` : '<p class="note">No unanswered reviews needed a draft.</p>'}
  <h3 class="sub" id="d-ai">Getting recommended by AI assistants</h3>
  ${ai ? `${(ai.actions ?? []).length ? `<div class="fixes">${ai.actions.map((a: any) => `<div><div><h4>${esc(tidy(a.action))}</h4><p class="w">${esc(tidy(a.why))}</p><p class="small" style="margin-top:3px">${esc(tidy(a.how))}</p></div><div class="tags"><span class="pill info">${esc(a.effort)}</span><span class="pill ${a.impact === 'high' ? 'urgent' : 'fix'}">${esc(a.impact)} impact</span></div></div>`).join('')}</div>` : ''}
  ${(ai.faq ?? []).length ? `<h4 class="tbl-h">FAQ for your website</h4><div class="grid2">${ai.faq.map((x: any) => `<div class="box"><h4>${esc(x.q)}</h4><p>${esc(x.a)}</p></div>`).join('')}</div>` : ''}
  ${ai.measure ? `<p class="note"><b>How to track it:</b> ${esc(tidy(ai.measure))}</p>` : ''}` : '<p class="note">The AI plan was not written in this run.</p>'}
  ${s2.jsonld ? `<h4 class="tbl-h" id="d-jsonld">Business details for Google and AI</h4><p class="note">Ask your web developer to paste this into the &lt;head&gt; of every page, after checking the phone and address are the ones you want everywhere.</p><pre>${esc('<script type="application/ld+json">\n' + JSON.stringify(s2.jsonld, null, 2) + '\n</script>')}</pre>` : ''}
  ${foot(`Part ${chapters.length + 2} · Ready to use`)}
</section>

<section class="page" id="appendix">
  <p class="eyebrow">Appendix</p>
  <h2 class="display">The full checklist.<br><span class="g">Every finding, part by part.</span></h2>
  ${AREAS.filter((a) => byArea(a.id).length).map((a) => { const list = byArea(a.id); return `<div id="appx-${a.id}"><h3 class="sub" style="font-size:17px">${esc(a.title)} <span class="muted" style="font-family:var(--body);font-size:11px;font-weight:400;letter-spacing:0">${list.filter((x) => x.severity === 'high').length} urgent · ${list.filter((x) => x.severity === 'medium').length} need work · ${list.length} in all</span></h3>${itemRows(list)}</div>`; }).join('')}
  <details><summary>Background research on the company</summary><p class="note" style="margin:4px 0 10px">Written from public sources on ${esc(dateOf(dive.finished_at))}, before the checks in this report. Where they differ, the checks are newer and win.</p><div class="dossier">${md(scrub(dive.dossier))}</div></details>
  ${sources.length ? `<details><summary>Sources <span class="muted">(${sources.length})</span></summary><ol class="sources">${sources.map((s: any) => `<li id="src-${esc(s.id)}" value="${esc(s.id)}">${/^https?:\/\//.test(s.url) ? `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(typeset(clip(String(s.title || hostOf(s.url)), 90)))}</a> · ${esc(hostOf(s.url))}` : esc(typeset(String(s.title ?? '')))}</li>`).join('')}</ol></details>` : ''}
  <div class="colophon">
    <div><p class="lbl">Prepared for</p><p>${esc(name)}</p></div>
    <div><p class="lbl">Checked</p><p>${esc(checkedOn)}</p></div>
    <div><p class="lbl">Background research</p><p>${esc(dateOf(dive.finished_at))}${sources.length ? `, from ${esc(sources.length)}${NB}public source${sources.length === 1 ? '' : 's'}` : ''}</p></div>
    <div><p class="lbl">Report</p><p>Online Presence Audit ${esc(R.checked_on.slice(0, 4))}${refNo ? ` · ${esc(refNo)}` : ''}</p></div>
  </div>
  <div class="note method" style="margin-top:8px"><p class="lbl">How we checked</p><p>Every phone number, email and WhatsApp link published about you was searched on the web and traced to where it leads. Your homepage and service pages were compared with what search results, independent pages and AI assistants say about you. News, forums and social media were searched for your company and its key people. Bank Negara and Securities Commission alert lists, published court judgments, insolvency notices, Bursa Malaysia, government websites and trademark listings were searched for your name; the MyIPO trademark register needs a login and was not searched; paid registers (SSM documents, CTOS, CCRIS) were not bought. Each domain was looked up in its registry (MYNIC or RDAP), its DNS, its hosting network and the public certificate logs; each mail server was checked against the Barracuda and SpamCop spam blacklists, and each email domain’s SPF, DKIM and DMARC records were read. Each official homepage was tested with Google PageSpeed Insights on mobile and desktop. Every Google review on your Maps listings was read. Maps ranks come from Google Maps searches without a phone’s location, so a customer nearby may see a slightly different order; web ranks come from Brave Search set to Malaysia. Each licence and award was looked up in its issuer’s own register. Every page of your websites was read and its links and numbers tested. AI answers come from ${esc(aiModels)}, asked each question several times, from memory and with a web search. The ready-to-use drafts were written with AI from these findings. Checked ${esc(checkedOn)}; background research from ${esc(dateOf(dive.finished_at))}.</p></div>
  ${partnersHtml()}
  ${foot('Appendix')}
</section>

`);
}
