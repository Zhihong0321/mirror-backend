// /company-dive: a form, the recent dives, and the selected dive's live log,
// dossier and sources. Each finished dive in the list carries its deeper dive:
// a Start button, or the run's status and report, plus the preview link, and
// what the dive, preview and deeper dive cost (LLM tokens and API calls, in USD).
// It uses the operator token the other console pages keep
// in localStorage ('labToken'), and asks for it once if it is not there.
import { OPERATOR_NAV, navHtml } from './nav.ts';

export const page = (): string => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Company Dive</title>
<script src="https://cdn.jsdelivr.net/npm/marked@12.0.2/marked.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/dompurify@3.1.6/dist/purify.min.js"></script>
<style>
:root { --bg:#111317; --card:#181b21; --ink:#e8e9ec; --muted:#9aa0aa; --line:#2a2f38; --accent:#4cc79a; --bad:#f2786d; color-scheme:dark; }
.sitenav { display:flex; flex-wrap:wrap; gap:4px; margin:0 0 20px; padding-bottom:16px; border-bottom:1px solid var(--line); }
.sitenav a { color:var(--muted); font-size:13px; font-weight:550; padding:5px 10px; border:1px solid transparent; border-radius:8px; text-decoration:none; }
.sitenav a:hover, .sitenav a[aria-current="page"] { color:var(--ink); background:#1e222a; border-color:var(--line); }
.wrap { max-width:1100px; margin:0 auto; padding:24px 16px 0; }
* { box-sizing: border-box; }
body { margin:0; background:var(--bg); color:var(--ink); font:15px/1.55 system-ui, -apple-system, "Segoe UI", sans-serif; }
main { max-width:1100px; margin:0 auto; padding:0 16px 64px; display:grid; grid-template-columns:280px 1fr; gap:20px; }
@media (max-width: 800px) { main { grid-template-columns:1fr; } }
h1 { font-size:20px; margin:0 0 12px; }
.card { background:var(--card); border:1px solid var(--line); border-radius:10px; padding:16px; }
form { display:grid; gap:8px; margin-bottom:16px; }
input, button { font:inherit; padding:8px 10px; border-radius:8px; border:1px solid var(--line); background:var(--bg); color:var(--ink); }
button { background:var(--accent); color:#fff; border:0; cursor:pointer; font-weight:600; }
.list .row { border-bottom:1px solid var(--line); padding-bottom:8px; }
.list .row.on { background:var(--bg); }
.list a.pick { display:block; padding:8px 6px 2px; color:inherit; text-decoration:none; }
.dd { display:flex; flex-wrap:wrap; gap:6px; align-items:center; padding:2px 6px 0; font-size:13px; }
.dd a { color:var(--accent); }
button.small { padding:3px 10px; font-size:12px; }
button:disabled { opacity:.5; cursor:default; }
.muted { color:var(--muted); font-size:13px; }
.bad { color:var(--bad); }
.log { font:12px/1.5 ui-monospace, Menlo, Consolas, monospace; max-height:260px; overflow:auto; white-space:pre-wrap; background:var(--bg); padding:10px; border-radius:8px; }
.dossier table { border-collapse:collapse; width:100%; display:block; overflow-x:auto; }
.dossier th, .dossier td { border:1px solid var(--line); padding:4px 8px; text-align:left; vertical-align:top; }
.dossier a.cite { font-size:11px; vertical-align:super; text-decoration:none; color:var(--accent); }
.sources li { margin:2px 0; word-break:break-all; }
.sources li:target { background:color-mix(in srgb, var(--accent) 18%, transparent); }
.stats { display:flex; gap:16px; flex-wrap:wrap; margin:8px 0 12px; }
details summary { cursor:pointer; font-weight:600; margin:12px 0 6px; }
</style>
</head>
<body>
<div class="wrap"><nav class="sitenav" aria-label="Site">${navHtml(OPERATOR_NAV, '/company-dive')}</nav></div>
<main>
  <section>
    <h1>Company Dive</h1>
    <form id="f" class="card">
      <input id="company" placeholder="Company name, e.g. Eternalgy Sdn Bhd" required>
      <input id="country" placeholder="Country" value="Malaysia">
      <button>Start dive</button>
      <span class="muted">Brave for discovery, up to 15 Tavily calls, deepseek for the thinking.</span>
    </form>
    <div class="card list" id="list"></div>
  </section>
  <section class="card" id="view"><p class="muted">Pick a dive or start one.</p></section>
</main>
<script>
const $ = (id) => document.getElementById(id);
let token = '';
try { token = localStorage.getItem('labToken') || ''; } catch {}
function ask() {
  token = prompt('Operator token (LAB_TOKEN)') || '';
  try { localStorage.setItem('labToken', token); } catch {}
}
if (!token) ask();
async function api(path, opts = {}) {
  const res = await fetch(path, { ...opts, headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' } });
  if (res.status === 401) { ask(); throw new Error('unauthorized'); }
  return res.json();
}
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;' }[c]));
let current = Number(location.hash.slice(1)) || 0, timer = 0, listTimer = 0;

// Deeper dive per company-dive id, from /api/dive-deeper/pipeline; null when that pipeline is switched off.
let pipe = null;
async function loadPipeline() {
  try {
    const res = await fetch('/api/dive-deeper/pipeline', { headers: { authorization: 'Bearer ' + token } });
    pipe = res.ok ? new Map(((await res.json()).companies || []).map((c) => [Number(c.dive_id), c])) : null;
  } catch { pipe = null; }
}

const ddLabel = { queued: 'Queued', waiting_dive: 'Waiting for the dive', running: 'Running', done: 'Report', partial: 'Report (partial)', failed: 'Failed' };
const ddBusy = (s) => s === 'queued' || s === 'waiting_dive' || s === 'running';

function deeperHtml(r) {
  if (!pipe || (r.status !== 'done' && r.status !== 'partial')) return '';
  const c = pipe.get(Number(r.id));
  const rep = c && c.report;
  let h = '<span class="muted">Deeper dive:</span> ';
  if (!rep) h += '<button class="small" data-deeper="' + r.id + '">Start</button>';
  else {
    h += '<a href="' + esc(rep.report_url) + '" target="_blank" rel="noopener">' + esc(ddLabel[rep.status] || rep.status) + '</a>';
    if (rep.status === 'failed') h += ' <button class="small" data-retry="' + rep.run_id + '">Retry</button>';
  }
  if (c && c.preview_url) h += '<span class="muted">·</span><a href="' + esc(c.preview_url) + '" target="_blank" rel="noopener">Preview</a>';
  return '<div class="dd">' + h + '</div>';
}

const money = (x) => '$' + (x < 0.01 ? x.toFixed(4) : x.toFixed(3));
// The dive's cost comes with the dive; the preview's and deeper dive's from the pipeline.
function costs(id, dive) {
  const c = pipe && pipe.get(Number(id));
  return [['Dive', dive], ['Preview', c && c.preview_cost], ['Deeper dive', c && c.report && c.report.cost]].filter((p) => p[1]);
}
const rough = (c) => c.estimated || c.unpriced.length > 0;

function costHtml(r) {
  const parts = costs(r.id, r.cost);
  if (!parts.length) return '';
  const total = parts.reduce((n, p) => n + p[1].usd, 0);
  return '<div class="dd muted">Cost ' + money(total) + (parts.some((p) => rough(p[1])) ? ' est.' : '') + (parts.length > 1 ? ' · ' + parts.map((p) => esc(p[0].toLowerCase()) + ' ' + money(p[1].usd)).join(' · ') : '') + '</div>';
}

function costTable(d) {
  const rows = costs(d.id, d.cost).map((p) => '<tr><th colspan="3">' + esc(p[0]) + ' · ' + money(p[1].usd) + (rough(p[1]) ? ' (estimate)' : '') + '</th></tr>'
    + p[1].lines.map((l) => '<tr><td>' + esc(l.item) + '</td><td class="muted">' + esc(l.detail) + (l.estimated ? ', tokens estimated from text length' : '') + '</td><td>' + (l.usd == null ? 'no price' : money(l.usd)) + '</td></tr>').join('')).join('');
  return rows ? '<details><summary>Cost</summary><div class="dossier"><table>' + rows + '</table></div></details>' : '';
}

async function loadList() {
  clearTimeout(listTimer);
  const [out] = await Promise.all([api('/api/company-dive'), loadPipeline()]);
  const rows = out.dives || [];
  $('list').innerHTML = rows.map((r) => '<div class="row' + (r.id === current ? ' on' : '') + '"><a class="pick" href="#' + r.id + '"><b>' + esc(r.company) + '</b><br><span class="muted">#' + r.id + ' · ' + esc(r.status) + (r.status === 'running' ? ' · ' + esc(r.stage) : '') + ' · ' + r.tavily_calls + ' Tavily</span></a>' + deeperHtml(r) + costHtml(r) + '</div>').join('') || '<p class="muted">No dives yet.</p>';
  if (pipe && [...pipe.values()].some((c) => c.report && ddBusy(c.report.status))) listTimer = setTimeout(loadList, 15000);
}

$('list').addEventListener('click', async (e) => {
  const b = e.target.closest && e.target.closest('button[data-deeper], button[data-retry]');
  if (!b) return;
  b.disabled = true;
  const dive = b.getAttribute('data-deeper');
  const out = dive
    ? await api('/api/dive-deeper', { method: 'POST', body: JSON.stringify({ dive_id: Number(dive) }) })
    : await api('/api/dive-deeper/' + b.getAttribute('data-retry') + '/retry', { method: 'POST' });
  if (out.error) { alert(out.error); b.disabled = false; return; }
  loadList();
});

async function show(id) {
  clearTimeout(timer);
  current = id;
  if (!id) return;
  const d = await api('/api/company-dive/' + id);
  const log = (d.log || []).map((l) => l.at.slice(11, 19) + '  ' + l.stage.padEnd(8) + ' ' + l.msg).join('\\n');
  let html = '<h1>' + esc(d.company) + ' <span class="muted">(' + esc(d.country) + ')</span></h1>'
    + '<div class="stats muted"><span>Status: <b class="' + (d.status === 'failed' ? 'bad' : '') + '">' + esc(d.status) + '</b></span>'
    + '<span>Tavily: ' + d.tavily_calls + ' calls / ' + d.tavily_credits + ' credits</span><span>Brave: ' + d.brave_calls + '</span><span>LLM: ' + d.llm_calls + '</span>'
    + (d.cost ? '<span>Cost: ' + money(d.cost.usd) + (rough(d.cost) ? ' est.' : '') + '</span>' : '') + '</div>' + costTable(d);
  if (d.report_url) html += '<p>Public report: <a href="' + esc(d.report_url) + '" target="_blank" rel="noopener">' + esc(d.report_url) + '</a></p>';
  if (d.error) html += '<p class="bad">' + esc(d.error) + '</p>';
  if (d.result && d.result.warnings && d.result.warnings.length) html += '<p class="bad">Finished with fallbacks:</p><ul>' + d.result.warnings.map((w) => '<li class="muted">' + esc(w) + '</li>').join('') + '</ul>';
  if (d.dossier) {
    const md = DOMPurify.sanitize(marked.parse(d.dossier));
    html += '<div class="dossier">' + md.replace(/\\[(\\d+)\\]/g, '<a class="cite" href="#src-$1" onclick="event.preventDefault();document.getElementById(\\'src-$1\\')?.scrollIntoView({block:\\'center\\'});">[$1]</a>') + '</div>';
  }
  const r = d.result;
  if (r) {
    const cited = new Set(r.facts.flatMap((f) => f.sources));
    html += '<details open><summary>Sources (' + cited.size + ' cited, ' + r.sources.length + ' found)</summary><ol class="sources">'
      + r.sources.filter((s) => cited.has(s.id)).map((s) => '<li id="src-' + s.id + '" value="' + s.id + '"><a href="' + esc(s.url) + '" target="_blank" rel="noopener">' + esc(s.title || s.url) + '</a> <span class="muted">' + esc(s.url) + ' · ' + esc(s.found.join(', ')) + '</span></li>').join('') + '</ol></details>';
    html += '<details><summary>Tavily calls</summary><ol>' + r.tavily.map((c) => '<li>/' + esc(c.path) + ' — ' + esc(c.label) + ' · ' + c.credits + ' credits · ' + (c.ms / 1000).toFixed(1) + 's' + (c.ok ? '' : ' · <span class="bad">' + esc(c.note) + '</span>') + '</li>').join('') + '</ol></details>';
    html += '<details><summary>LLM calls (' + r.llm.length + ')</summary><ol>' + r.llm.map((u) => '<li>' + esc(u.step) + ' — ' + esc(u.engine || '') + ' · ' + (u.ms / 1000).toFixed(0) + 's' + (u.tokensIn != null ? ' · ' + u.tokensIn + ' in / ' + u.tokensOut + ' out tokens' : '') + '</li>').join('') + '</ol></details>';
    html += '<details><summary>Facts (' + r.facts.length + ')</summary><ul>' + r.facts.map((f) => '<li><b>' + esc(f.topic) + '</b> ' + esc(f.fact) + ' <span class="muted">[' + f.sources.join(', ') + '] ' + esc(f.confidence) + '</span></li>').join('') + '</ul></details>';
  }
  if (r) html += peopleHtml(d);
  html += '<details ' + (d.status === 'running' || d.status === 'queued' ? 'open' : '') + '><summary>Log</summary><div class="log">' + esc(log) + '</div></details>';
  $('view').innerHTML = html;
  const peopleRunning = d.result && d.result.people && d.result.people.status === 'running';
  if (d.status === 'running' || d.status === 'queued' || peopleRunning) timer = setTimeout(() => { show(id); loadList(); }, 4000);
}

function peopleHtml(d) {
  const p = d.result.people;
  const canRun = (d.status === 'done' || d.status === 'partial') && !(p && p.status === 'running');
  let h = '<h2 style="margin-top:24px">People linked (Exa)</h2>';
  if (canRun) h += '<p><button onclick="findPeople(' + d.id + ')">' + (p ? 'Search Exa again' : 'Find linked people with Exa') + '</button> <span class="muted">Uses the saved research; nothing is re-run.</span></p>';
  if (!p) return h;
  const dollars = (p.exa || []).reduce((n, c) => n + (c.dollars || 0), 0);
  h += '<div class="stats muted"><span>Status: <b class="' + (p.status === 'failed' ? 'bad' : '') + '">' + esc(p.status) + '</b></span><span>Exa: ' + (p.exa || []).length + ' calls / $' + dollars.toFixed(3) + '</span><span>People: ' + (p.people || []).length + '</span></div>';
  if (p.error) h += '<p class="bad">' + esc(p.error) + '</p>';
  if ((p.people || []).length) {
    h += '<div class="dossier"><table><thead><tr><th>Name</th><th>Role</th><th>Link</th><th>Now?</th><th>Confidence</th><th>Evidence</th></tr></thead><tbody>'
      + p.people.map((x) => '<tr><td><b>' + esc(x.name) + '</b>' + (x.notes ? '<br><span class="muted">' + esc(x.notes) + '</span>' : '') + '</td><td>' + esc(x.role) + '</td><td>' + esc(x.relation) + '</td><td>' + (x.current === true ? 'yes' : x.current === false ? 'former' : '?') + '</td><td>' + esc(x.confidence) + '</td><td>'
        + (x.evidence || []).map((e) => '<a href="' + esc(e.url) + '" target="_blank" rel="noopener" title="' + esc(e.quote) + '">' + esc(e.url.replace(/^https?:\\/\\/(www\\.)?/, '').slice(0, 48)) + '</a>').join('<br>') + '</td></tr>').join('')
      + '</tbody></table></div>';
  }
  if ((p.rejected || []).length) h += '<details><summary>Rejected lookalikes (' + p.rejected.length + ')</summary><ul>' + p.rejected.map((x) => '<li>' + esc(x.name) + ' <span class="muted">' + esc(x.reason) + '</span></li>').join('') + '</ul></details>';
  if ((p.warnings || []).length) h += '<p class="bad">Finished with fallbacks:</p><ul>' + p.warnings.map((w) => '<li class="muted">' + esc(w) + '</li>').join('') + '</ul>';
  h += '<details ' + (p.status === 'running' ? 'open' : '') + '><summary>People log</summary><div class="log">' + esc((p.log || []).map((l) => l.at.slice(11, 19) + '  ' + l.msg).join('\\n')) + '</div></details>';
  return h;
}

async function findPeople(id) {
  const out = await api('/api/company-dive/' + id + '/people', { method: 'POST' });
  if (out.error) alert(out.error);
  show(id);
}

$('f').onsubmit = async (e) => {
  e.preventDefault();
  const out = await api('/api/company-dive', { method: 'POST', body: JSON.stringify({ company: $('company').value, country: $('country').value }) });
  if (out.id) location.hash = '#' + out.id;
  loadList();
};
window.onhashchange = () => { show(Number(location.hash.slice(1)) || 0); loadList(); };
// The list first, so the open dive's cost table has the preview and deeper dive too.
loadList().finally(() => show(current));
</script>
</body>
</html>`;
