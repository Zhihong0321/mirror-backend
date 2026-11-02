// The public company-dive report at /d/:publicId.
//
// One URL for the whole life of a report. While the research runs, it shows the
// stages and the live log, polling /d/:publicId/data every few seconds. Once the
// dossier is written the page reloads into the report, rendered here on the
// server in the Eternalgy corporate-profile style shared with the dive-deeper
// report (divedeeper/report-html.ts): a dark cover, the numbers at a glance, one
// chapter per dossier section, the linked people and the sources. Desktop,
// mobile and A4 versions of one document; print is always A4. While the people
// step is still finishing, its page polls and reloads when it is done.

import { partnersHtml } from './divedeeper/partners.ts';
import { esc, md, shell } from './divedeeper/report-html.ts';

type View = Record<string, any> | null;

const STAGES: Array<[string, string]> = [
  ['discover', 'Discovering sources'],
  ['triage', 'Sorting what is relevant'],
  ['read', 'Reading pages'],
  ['analyse', 'Analysing'],
  ['fill', 'Filling gaps'],
  ['reflect', 'Double-checking'],
  ['write', 'Writing the report'],
  ['people', 'Finding linked people'],
];

/** What this page adds to the shared report style: progress, people cards, readable chapter text. */
const CSS = `
.chap { display:grid; gap:12px; max-width:52em; } .chap p { max-width:44em; } .chap h5, .chap h6 { font-size:15px; margin-top:6px; }
.chap ul.plain, .chap ol.plain { gap:5px; } .chap .band { margin:4px 0; }
.lede { font-size:15.5px; line-height:1.55; }
.dark a.cite { color:var(--on-dark-2); }
.people { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:10px; }
.people .box .role { color:var(--grey); } .people .tags { display:flex; flex-wrap:wrap; gap:4px; } .people .ev a { color:var(--grey); overflow-wrap:anywhere; }
.steps { list-style:none; margin:0; padding:0; display:grid; gap:2px; }
.steps li { display:flex; align-items:center; gap:12px; padding:8px 12px; background:var(--band); color:var(--muted); }
.steps li.done { color:var(--ink); } .steps li.now { background:var(--dark2); color:var(--on-dark); font-weight:600; }
.steps .dot { width:18px; height:18px; flex:none; border:2px solid var(--none); display:grid; place-items:center; font-size:11px; font-weight:700; }
.steps li.done .dot { background:var(--ink); border-color:var(--ink); color:#fff; }
.steps li.now .dot { border-color:#fff; border-top-color:transparent; border-radius:50%; animation:spin .9s linear infinite; }
@keyframes spin { to { transform:rotate(360deg); } }
.progress { display:block; height:6px; background:var(--band); } .progress i { display:block; height:100%; background:var(--ink); transition:width .6s ease; }
.logbox { background:var(--band); padding:12px 14px; max-height:280px; overflow:auto; font:11.5px/1.55 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace; color:var(--grey); white-space:pre-wrap; overflow-wrap:anywhere; }
.logbox b { color:var(--ink); font-weight:600; }
.pulse { display:inline-block; width:8px; height:8px; border-radius:50%; background:var(--ink); margin-right:6px; vertical-align:1px; animation:pulse 1.6s ease-in-out infinite; }
@keyframes pulse { 50% { opacity:.25; } }
.alert { border-left:3px solid var(--urgent); background:var(--urgent-bg); color:var(--urgent); padding:12px 16px; }
@media screen {
  .v-desktop .lede { font-size:19px; } .v-desktop .chap { font-size:16px; } .v-desktop .chap h5 { font-size:18px; } .v-desktop .people .box { font-size:14px; }
  .v-mobile .people { grid-template-columns:1fr; } .v-mobile .chap { font-size:15.5px; } .v-mobile .lede { font-size:16.5px; }
  .v-mobile .band td[data-label]::before { content:attr(data-label); display:block; font-size:10px; font-weight:600; letter-spacing:.08em; text-transform:uppercase; color:var(--muted); margin-top:4px; }
  .v-mobile .band tr td:first-child { font-weight:600; } .v-mobile .band tr td:first-child::before { display:none; }
}
`;

const dateOf = (iso: unknown) => {
  const t = Date.parse(String(iso ?? ''));
  return Number.isFinite(t) ? new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : '';
};
const hostOf = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; } };
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n).replace(/\s+\S*$/, '') + ' …' : s);
const plainText = (s: string) => s.replace(/\[\d+\]/g, '').replace(/\*\*/g, '').replace(/\s+/g, ' ').trim();

/** A headline in the profile's two tones: "Identity and registration" → ink "Identity", grey "and registration." */
function twoTone(h: string): string {
  const m = h.match(/^(.+?)\s+(and|&)\s+(.+)$/i);
  return m ? `${esc(m[1])}<br><span class="g">${esc(m[2])} ${esc(m[3])}.</span>` : `${esc(h)}<span class="g">.</span>`;
}

/** The dossier markdown as its opening paragraphs and one {title, body} per "## " section. */
function sections(dossier: string): { lede: string; list: Array<{ title: string; body: string }> } {
  const parts = dossier.replace(/^\s*#\s+[^\n]*\n/, '').split(/^##\s+/m);
  const lede = parts.shift() ?? '';
  return { lede: lede.trim(), list: parts.map((p) => { const nl = p.indexOf('\n'); return { title: (nl < 0 ? p : p.slice(0, nl)).trim(), body: nl < 0 ? '' : p.slice(nl + 1).trim() }; }) };
}

/** The first sentence of a section's first paragraph, for the chapter list on the glance page. */
function gist(body: string): string {
  const para = body.split('\n').find((l) => l.trim() && !/^[|#>\-*\d]/.test(l.trim())) ?? '';
  const first = plainText(para).match(/^.+?[.!?](?=\s|$)/)?.[0] ?? plainText(para);
  return clip(first, 120);
}

function peopleBlock(p: any): string {
  if (!p || p.status === 'running') return '<div class="box"><p><span class="pulse"></span>Still searching for people linked to the company. This page updates by itself.</p></div>';
  const list: any[] = p.people ?? [];
  if (!list.length) return '<p class="note">No linked people were found beyond those named in the chapters.</p>';
  return `<p class="lead" style="max-width:40em">${list.length} ${list.length === 1 ? 'person is' : 'people are'} tied to the company by their own profiles, the company site or registries${p.rejected ? `; ${p.rejected} people at companies with similar names were left out` : ''}.</p>
  <div class="people">${list.map((x) => {
    const tags = `<span class="pill info">${esc(x.relation)}</span>${x.current === false ? '<span class="pill fix">former</span>' : x.current === true ? '<span class="pill good">current</span>' : ''}${x.confidence === 'low' ? '<span class="pill urgent">low confidence</span>' : x.confidence === 'medium' ? '<span class="pill info">medium confidence</span>' : ''}`;
    const ev = (x.evidence ?? []).slice(0, 3).map((e: any) => `<li><a href="${esc(e.url)}" target="_blank" rel="noopener" title="${esc(e.quote)}">${esc(hostOf(e.url))}</a></li>`).join('');
    return `<div class="box"><h4>${esc(x.name)}</h4><p class="role">${esc(x.role)}</p><div class="tags">${tags}</div>${x.notes ? `<p class="note">${esc(x.notes)}</p>` : ''}${ev ? `<ul class="ev small">${ev}</ul>` : ''}</div>`;
  }).join('')}</div>`;
}

function reportBody(d: Record<string, any>): string {
  const id = d.identity ?? {};
  const stats = d.stats ?? {};
  const name = String(id.legal_name || d.company);
  const year = String(d.finished_at || d.created_at || '').slice(0, 4);
  const { lede, list } = sections(String(d.dossier ?? ''));
  const peopleList: any[] | null = d.people && d.people.status !== 'running' ? d.people.people ?? [] : null;
  // "1523087A" and "1523087-A" are one number written two ways.
  const seen = new Set<string>();
  const reg = (id.registration_numbers ?? []).filter((n: string) => { const k = String(n).replace(/[^a-z0-9]/gi, '').toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 2).join(' / ');
  const domains: string[] = id.official_domains ?? [];
  const big: [string, string][] = ([
    stats.facts ? [String(stats.facts), 'facts found about the company'] : null,
    stats.sources_cited ? [String(stats.sources_cited), 'sources cited in this report'] : null,
    stats.sources_found ? [String(stats.sources_found), 'public pages found and sorted'] : null,
    peopleList ? [String(peopleList.length), 'people linked to the company'] : null,
    list.length ? [String(list.length), 'chapters, from registration to red flags'] : null,
  ].filter(Boolean) as [string, string][]);
  let pageNo = 0;
  const foot = () => `<footer class="pf"><span>${esc(name)} · Company dossier ${esc(year)}</span><span>${++pageNo}</span></footer>`;
  const chapId = (i: number) => `ch-${i + 1}`;

  return `<section class="page dark cover">
  <div class="cover-top"><b>Eternalgy</b><span>Company dossier ${esc(year)}</span></div>
  <div class="cover-mid"><h1>${esc(name)}<br><span class="g">Company dossier.</span></h1></div>
  <div class="cover-bot"><div><b>${esc(id.industry || d.country || 'Company research')}</b>${[reg ? `Reg. ${reg}` : '', d.country, domains.join(', ')].filter(Boolean).map((x) => esc(x)).join(' · ')}</div><div><b>Researched ${esc(dateOf(d.finished_at || d.created_at))}</b>${stats.sources_found ? `${esc(stats.sources_found)} public pages read · ` : ''}every fact cited to its source</div></div>
</section>

<nav class="chapnav" aria-label="Sections"><a href="#glance">At a glance</a>${list.map((s, i) => `<a href="#${chapId(i)}">${esc(s.title)}</a>`).join('')}<a href="#people">People</a><a href="#sources">Sources</a></nav>

<section class="page dark" id="glance">
  <p class="eyebrow">At a glance</p>
  <h2 class="display">What the public record says<br><span class="g">about ${esc(name)}.</span></h2>
  ${big.length ? `<div class="stats">${big.map(([v, l]) => `<div><b>${esc(v)}</b><span>${esc(l)}</span></div>`).join('')}</div>` : ''}
  ${lede ? `<div class="verdict chap" style="margin-top:14px">${md(lede)}</div>` : ''}
  ${d.status === 'partial' ? '<p class="note" style="color:var(--on-dark-2)">Some research steps used fallbacks in this run.</p>' : ''}
  <div class="rows" style="margin-top:auto">${list.map((s, i) => `<a href="#${chapId(i)}"><b>${esc(s.title)}</b><span>${esc(gist(s.body))}</span><span>${String(i + 1).padStart(2, '0')}</span></a>`).join('')}</div>
  ${foot()}
</section>

${list.map((s, i) => {
  const html = md(s.body).replace(/^<p>/, '<p class="lede">');
  return `<section class="page" id="${chapId(i)}">
  <p class="eyebrow">Chapter ${i + 1}</p>
  <h2 class="display">${twoTone(s.title)}</h2>
  <div class="chap">${html}</div>
  ${foot()}
</section>`;
}).join('\n')}

<section class="page" id="people">
  <p class="eyebrow">People</p>
  <h2 class="display">Who is linked<br><span class="g">to the company.</span></h2>
  <div id="people-block">${peopleBlock(d.people)}</div>
  ${foot()}
</section>

<section class="page" id="sources">
  <p class="eyebrow">Sources</p>
  <h2 class="display">Every claim,<br><span class="g">traced to its source.</span></h2>
  ${(d.sources ?? []).length ? `<ol class="sources">${d.sources.map((s: any) => `<li id="src-${esc(s.id)}" value="${esc(s.id)}"><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(clip(String(s.title || hostOf(s.url)), 90))}</a> · ${esc(hostOf(s.url))}</li>`).join('')}</ol>` : '<p class="note">No sources were cited.</p>'}
  <div class="note" style="margin-top:8px"><p class="lbl">How this was researched</p><p>Public sources were found with Brave and Tavily${stats.tavily_calls ? ` (${esc(stats.tavily_calls)} Tavily calls)` : ''}${d.people?.exa_calls ? `, and linked people with Exa (${esc(d.people.exa_calls)} calls)` : ''}. The report was written by an AI model and every fact is cited to its source in square brackets. Check anything important against the source before relying on it.</p></div>
  ${partnersHtml()}
  ${foot()}
</section>
`;
}

/** The waiting page: stages, live log, failure or not-found. The client script keeps it current. */
function progressBody(d: Record<string, any> | null): string {
  return `<section class="page" id="progress">
  <p class="eyebrow" id="p-eyebrow">${d ? 'Generating report' : 'Not found'}</p>
  <h2 class="display" id="p-title">${d ? `${esc(d.company)}<br><span class="g">Company dossier.</span>` : 'This report<br><span class="g">does not exist.</span>'}</h2>
  <div id="p-body">${d ? '' : '<p class="lead">Check the link. Report links are the full address you were given.</p>'}</div>
</section>`;
}

const SCRIPT = String.raw`
(function () {
  var el = document.getElementById('cd');
  var publicId = el.getAttribute('data-id');
  var data = JSON.parse(document.getElementById('initial').textContent || 'null');
  var STAGES = JSON.parse(document.getElementById('stages').textContent);
  var rendered = el.getAttribute('data-mode');

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function time(s) { try { return new Date(s).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' }); } catch (e) { return ''; } }
  function finished(d) { return d.status === 'done' || d.status === 'partial' || d.status === 'failed'; }
  function stageIndex(stage) { for (var i = 0; i < STAGES.length; i++) if (STAGES[i][0] === stage) return i; return 0; }

  function renderProgress(d) {
    var body = document.getElementById('p-body');
    if (!body || !d) return;
    var failed = d.status === 'failed';
    var idx = d.status === 'queued' ? -1 : stageIndex(d.stage);
    var pct = d.status === 'queued' ? 3 : Math.max(6, Math.round(((idx + 0.5) / STAGES.length) * 100));
    var started = d.created_at ? Math.max(0, Math.round((Date.now() - Date.parse(d.created_at)) / 60000)) : 0;
    var steps = STAGES.map(function (s, i) {
      return '<li class="' + (i < idx ? 'done' : i === idx ? 'now' : '') + '"><span class="dot">' + (i < idx ? '&#10003;' : '') + '</span>' + esc(s[1]) + '</li>';
    }).join('');
    var lines = (d.log || []).slice(-60).map(function (l) { return '<b>' + esc(time(l.at)) + '</b>  ' + esc(l.msg); }).join('\n');
    document.getElementById('p-eyebrow').textContent = failed ? 'Report failed' : 'Generating report';
    body.innerHTML =
      (failed
        ? '<div class="alert">' + esc(d.error || 'The research stopped before the report was written.') + '</div>'
        : '<p class="lead">' + (d.status === 'queued' ? 'Waiting for the research slot. ' : '') + 'This usually takes 5 to 10 minutes' + (started ? ' (started ' + started + ' min ago)' : '') + '. This page updates by itself, so you can leave it open or come back to the same link.</p>' +
          '<span class="progress"><i style="width:' + pct + '%"></i></span><ol class="steps">' + steps + '</ol>') +
      '<p class="lbl">' + (finished(d) ? 'Log' : '<span class="pulse"></span>Live log') + (d.log && d.log.length ? ' · updated ' + esc(time(d.log[d.log.length - 1].at)) : '') + '</p>' +
      '<div class="logbox" id="logbox">' + (lines || 'Starting…') + '</div>';
    var box = document.getElementById('logbox');
    if (box) box.scrollTop = box.scrollHeight;
    document.title = (failed ? 'Failed: ' : 'Generating: ') + d.company;
  }

  // The report itself is drawn on the server; reload into it once there is something new to show.
  function needsReload(d) {
    if (!d) return false;
    if (rendered === 'progress') return !!d.dossier;
    return rendered === 'report-waiting' && !!d.people && d.people.status !== 'running';
  }
  function keepPolling(d) { return d && (rendered === 'report-waiting' || !finished(d)); }

  function tick(d) {
    if (needsReload(d)) { location.reload(); return; }
    if (rendered === 'progress') renderProgress(d);
    if (keepPolling(d)) setTimeout(poll, 4000);
  }
  function poll() {
    fetch('/d/' + publicId + '/data', { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(tick)
      .catch(function () { setTimeout(poll, 8000); });
  }
  if (data && rendered === 'progress') renderProgress(data);
  if (keepPolling(data)) setTimeout(poll, 4000);
})();
`;

export function reportPage(view: View, publicId: string): string {
  // </script> inside the data would end the tag early.
  const blob = JSON.stringify(view).replace(/</g, '\\u003c');
  const name = view ? String(view.identity?.legal_name || view.company) : '';
  const title = view ? (view.dossier ? `${name} — Company dossier` : `Generating: ${view.company}`) : 'Report not found';
  const mode = view?.dossier ? (view.people && view.people.status === 'running' ? 'report-waiting' : 'report') : 'progress';
  return shell(title, `<div id="cd" data-id="${esc(publicId)}" data-mode="${mode}">
${view?.dossier ? reportBody(view) : progressBody(view)}
</div>
<script type="application/json" id="initial">${blob}</script>
<script type="application/json" id="stages">${JSON.stringify(STAGES)}</script>
<script>${SCRIPT}</script>`, CSS).replace('<meta name="viewport"', '<meta name="robots" content="noindex, nofollow">\n<meta name="viewport"');
}
