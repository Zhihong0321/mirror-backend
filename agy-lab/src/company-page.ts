// /companies and /companies/<uid>: every report run for a company, under one page.
//
// A company UID (company-uid.ts) is the one id a company keeps across Maps runs, so
// it is also the key the reports hang from: one company can have many dives and
// deeper dives, run on different dates. /companies lists the companies that have
// at least one report; /companies/<uid> is the timeline of all of them, newest
// first, each dive with the deeper-dive runs made from it, and a button to run
// another.
//
// Same token as the other console pages: the operator token in localStorage
// ('labToken'), asked for once if it is not there. Every value that reaches the DOM
// goes through esc(); no row is ever written with innerHTML as it came.
import { OPERATOR_NAV, navHtml } from './nav.ts';

const STYLE = `
:root { --bg:#111317; --card:#181b21; --ink:#e8e9ec; --muted:#9aa0aa; --line:#2a2f38; --accent:#4cc79a; --bad:#f2786d; --warn:#e0b25a; color-scheme:dark; }
* { box-sizing: border-box; }
body { margin:0; background:var(--bg); color:var(--ink); font:15px/1.55 system-ui, -apple-system, "Segoe UI", sans-serif; }
.sitenav { display:flex; flex-wrap:wrap; gap:4px; margin:0 0 20px; padding-bottom:16px; border-bottom:1px solid var(--line); }
.sitenav a { color:var(--muted); font-size:13px; font-weight:550; padding:5px 10px; border:1px solid transparent; border-radius:8px; text-decoration:none; }
.sitenav a:hover, .sitenav a[aria-current="page"] { color:var(--ink); background:#1e222a; border-color:var(--line); }
.wrap { max-width:1100px; margin:0 auto; padding:24px 16px 0; }
main { max-width:1100px; margin:0 auto; padding:0 16px 64px; }
h1 { font-size:20px; margin:0 0 4px; }
h2 { font-size:16px; margin:20px 0 10px; }
.card { background:var(--card); border:1px solid var(--line); border-radius:10px; padding:16px; margin-bottom:14px; }
input, button { font:inherit; padding:8px 10px; border-radius:8px; border:1px solid var(--line); background:var(--bg); color:var(--ink); }
button { background:var(--accent); color:#fff; border:0; cursor:pointer; font-weight:600; }
button:disabled { opacity:.5; cursor:default; }
a { color:var(--accent); }
.muted { color:var(--muted); font-size:13px; }
.bad { color:var(--bad); }
.uid { font:12px/1.4 ui-monospace, Menlo, Consolas, monospace; color:var(--muted); }
table { border-collapse:collapse; width:100%; }
th, td { border-bottom:1px solid var(--line); padding:8px 10px; text-align:left; vertical-align:top; }
th { color:var(--muted); font-size:12px; font-weight:600; text-transform:uppercase; letter-spacing:.04em; }
td.num, th.num { text-align:right; white-space:nowrap; }
tr.link { cursor:pointer; }
tr.link:hover td { background:#1c2027; }
.bar { display:flex; gap:8px; flex-wrap:wrap; align-items:center; margin-bottom:14px; }
.bar input[type=search] { flex:1; min-width:220px; }
.head { display:flex; gap:12px; flex-wrap:wrap; align-items:baseline; }
.badge { display:inline-block; font-size:12px; font-weight:600; padding:1px 8px; border-radius:99px; border:1px solid var(--line); color:var(--muted); }
.badge.done { color:var(--accent); border-color:var(--accent); }
.badge.partial { color:var(--warn); border-color:var(--warn); }
.badge.failed { color:var(--bad); border-color:var(--bad); }
.badge.busy { color:#7aa2f7; border-color:#7aa2f7; }
.dive { border-left:3px solid var(--line); padding:2px 0 2px 14px; margin:0 0 16px; }
.dive .top { display:flex; flex-wrap:wrap; gap:8px 14px; align-items:center; }
.deeper { margin:8px 0 0 12px; padding:8px 12px; background:var(--bg); border:1px solid var(--line); border-radius:8px; }
.deeper .top { display:flex; flex-wrap:wrap; gap:8px 14px; align-items:center; }
.run { display:flex; flex-wrap:wrap; gap:8px; align-items:center; }
.run input[type=text] { min-width:220px; }
.run label { display:flex; gap:6px; align-items:center; font-size:13px; color:var(--muted); }
.run input[type=checkbox] { padding:0; }
details summary { cursor:pointer; font-weight:600; margin:4px 0; }
.listings li { margin:4px 0; word-break:break-word; }
`;

// Shared by both pages: the token, the fetch, and the formatting of dates and money.
const COMMON = `
const $ = (id) => document.getElementById(id);
let token = '';
try { token = localStorage.getItem('labToken') || ''; } catch {}
function ask() {
  token = prompt('Operator token (LAB_TOKEN)') || '';
  try { localStorage.setItem('labToken', token); } catch {}
}
if (!token) ask();
// One retry after a 401: the token was wrong or rotated, so ask again and send the same request.
async function api(path, opts = {}, retried = false) {
  const res = await fetch(path, { ...opts, headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' } });
  if (res.status === 401 && !retried) { ask(); return api(path, opts, true); }
  let body = null;
  try { body = await res.json(); } catch {}
  return { status: res.status, ok: res.ok, body };
}
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
// A link from the API is used only when it is a web address or a path on this site.
const safe = (u) => { const s = String(u ?? ''); return /^(https?:\\/\\/|\\/)/i.test(s) ? esc(s) : ''; };
const money = (x) => x == null || isNaN(Number(x)) ? '' : '$' + (Number(x) < 0.01 ? Number(x).toFixed(4) : Number(x).toFixed(3));
function ago(iso) {
  const t = Date.parse(iso || '');
  if (!t) return '';
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (s < 90) return 'just now';
  if (s < 5400) return Math.round(s / 60) + ' min ago';
  if (s < 129600) return Math.round(s / 3600) + ' h ago';
  if (s < 2592000) return Math.round(s / 86400) + ' days ago';
  return Math.round(s / 2592000) + ' months ago';
}
function when(iso) {
  const t = Date.parse(iso || '');
  return t ? new Date(t).toLocaleString() + ' (' + ago(iso) + ')' : '';
}
const busy = (s) => s === 'queued' || s === 'running' || s === 'waiting_dive';
const badge = (s) => '<span class="badge ' + (busy(s) ? 'busy' : esc(s)) + '">' + esc(s || 'unknown') + '</span>';
`;

const head = (title: string, current: string): string => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>${STYLE}</style>
</head>
<body>
<div class="wrap"><nav class="sitenav" aria-label="Site">${navHtml(OPERATOR_NAV, current)}</nav></div>
`;

/** /companies: the companies that have at least one report. */
export const indexPage = (): string => `${head('Companies', '/companies')}<main>
  <h1>Companies</h1>
  <p class="muted">Every company that has a report, by its company UID. Open one to see all of its reports, newest first.</p>
  <div class="bar">
    <input id="q" type="search" placeholder="Search by name, website or UID" autocomplete="off">
    <span class="muted" id="count"></span>
  </div>
  <div class="card">
    <table>
      <thead><tr><th>Company</th><th>UID</th><th class="num">Reports</th><th>Last report</th></tr></thead>
      <tbody id="rows"><tr><td colspan="4" class="muted">Loading</td></tr></tbody>
    </table>
  </div>
</main>
<script>
${COMMON}
let typing = 0;
async function load() {
  const q = $('q').value.trim();
  const out = await api('/api/companies?reports=1&limit=100' + (q ? '&q=' + encodeURIComponent(q) : ''));
  if (!out.ok) { $('rows').innerHTML = '<tr><td colspan="4" class="bad">' + esc((out.body && out.body.error) || ('HTTP ' + out.status)) + '</td></tr>'; return; }
  const list = (out.body && out.body.companies) || [];
  $('count').textContent = list.length ? list.length + (list.length === 100 ? '+' : '') + ' companies' : '';
  $('rows').innerHTML = list.length ? list.map((c) =>
    '<tr class="link" data-uid="' + esc(c.uid) + '"><td><a href="/companies/' + esc(c.uid) + '"><b>' + esc(c.name || c.domain || c.uid) + '</b></a>'
    + (c.name && c.domain ? '<br><span class="muted">' + esc(c.domain) + '</span>' : '') + '</td>'
    + '<td class="uid">' + esc(c.uid) + '</td><td class="num">' + esc(c.reports) + '</td>'
    + '<td>' + esc(when(c.last_report_at)) + '</td></tr>').join('')
    : '<tr><td colspan="4" class="muted">No company with a report' + (q ? ' matches that search' : ' yet') + '.</td></tr>';
}
$('rows').addEventListener('click', (e) => {
  const tr = e.target.closest && e.target.closest('tr[data-uid]');
  if (tr && !(e.target.closest && e.target.closest('a'))) location.href = '/companies/' + tr.dataset.uid;
});
$('q').addEventListener('input', () => { clearTimeout(typing); typing = setTimeout(load, 250); });
load();
</script>
</body>
</html>`;

/** /companies/<uid>: one company, with every dive and deeper dive run for it. */
export const detailPage = (): string => `${head('Company', '/companies')}<main>
  <p class="muted"><a href="/companies">&larr; All companies</a></p>
  <div id="view"><p class="muted">Loading</p></div>
</main>
<script>
${COMMON}
const uid = decodeURIComponent(location.pathname.replace(/\\/+$/, '').split('/').pop() || '');
let data = null, timer = 0;

function deeperHtml(d) {
  const link = d.report_url ? '<a href="' + safe(d.report_url) + '" target="_blank" rel="noopener">Deeper dive report</a>' : '<span class="muted">Deeper dive</span>';
  return '<div class="deeper"><div class="top">' + link + badge(d.status)
    + (d.stage && busy(d.status) ? '<span class="muted">' + esc(d.stage) + '</span>' : '')
    + (d.cost_usd != null ? '<span class="muted">' + esc(money(d.cost_usd)) + '</span>' : '')
    + '<span class="muted">' + esc(when(d.created_at)) + '</span></div></div>';
}

function diveHtml(r) {
  const report = r.report_url || r.dive_report_url;
  const link = report ? '<a href="' + safe(report) + '" target="_blank" rel="noopener"><b>Company dive</b></a>' : '<b>Company dive</b>';
  const deeper = (r.deeper || []).slice().sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  return '<div class="dive"><div class="top">' + link + badge(r.status)
    + (r.stage && busy(r.status) ? '<span class="muted">' + esc(r.stage) + '</span>' : '')
    + (r.cost_usd != null ? '<span class="muted">' + esc(money(r.cost_usd)) + '</span>' : '')
    + (r.preview_url ? '<a href="' + safe(r.preview_url) + '" target="_blank" rel="noopener">Preview</a>' : '')
    + '<span class="muted">' + esc(when(r.created_at)) + '</span>'
    + '<span class="muted">#' + esc(r.dive_id) + '</span></div>'
    + deeper.map(deeperHtml).join('') + '</div>';
}

function render() {
  const c = data;
  const reports = (c.reports || []).slice().sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  const listings = c.listings || [];
  const title = c.name || c.domain || c.uid;
  document.title = title + ' | Companies';
  $('view').innerHTML =
    '<div class="card"><div class="head"><h1>' + esc(title) + '</h1><span class="uid">' + esc(c.uid) + '</span></div>'
    + '<p class="muted">' + [c.domain ? '<a href="' + safe('https://' + c.domain) + '" target="_blank" rel="noopener">' + esc(c.domain) + '</a>' : '', c.country ? esc(c.country) : '', reports.length + (reports.length === 1 ? ' report' : ' reports')]
        .filter(Boolean).join(' &middot; ') + '</p>'
    + '<div class="run"><input type="text" id="name" value="' + esc(c.name || c.domain || '') + '" aria-label="Company name">'
    + '<input type="text" id="country" value="' + esc(c.country || '') + '" placeholder="Country" aria-label="Country">'
    + '<label><input type="checkbox" id="deeper" checked> also run the deeper dive</label>'
    + '<button id="run">Run a new report</button><span class="muted" id="msg"></span></div></div>'
    + '<h2>Reports</h2><div class="card">' + (reports.length ? reports.map(diveHtml).join('') : '<p class="muted">No report has been run for this company yet.</p>') + '</div>'
    + '<details class="card"><summary>Google Maps listings (' + listings.length + ')</summary><ul class="listings">'
    + listings.map((l) => '<li><b>' + esc(l.name || l.place_key) + '</b>' + (l.address ? '<br><span class="muted">' + esc(l.address) + '</span>' : '')
        + (l.website ? '<br><a href="' + safe(l.website) + '" target="_blank" rel="noopener">' + esc(l.website) + '</a>' : '')
        + ((l.runs || []).length ? '<br><span class="muted">runs ' + esc((l.runs || []).join(', ')) + '</span>' : '') + '</li>').join('')
    + '</ul></details>';
  $('run').addEventListener('click', run);
  clearTimeout(timer);
  const live = reports.some((r) => busy(r.status) || (r.deeper || []).some((d) => busy(d.status)));
  if (live) timer = setTimeout(load, 15000);
}

async function load() {
  const out = await api('/api/companies/' + encodeURIComponent(uid));
  if (out.status === 404) { $('view').innerHTML = '<div class="card"><h1>No such company</h1><p class="muted">Nothing has the UID <span class="uid">' + esc(uid) + '</span>.</p></div>'; return; }
  if (!out.ok) { $('view').innerHTML = '<div class="card bad">' + esc((out.body && out.body.error) || ('HTTP ' + out.status)) + '</div>'; return; }
  data = out.body;
  render();
}

async function run() {
  const name = $('name').value.trim(), country = $('country').value.trim() || 'Malaysia', both = $('deeper').checked;
  if (!name) { $('msg').textContent = 'Enter the company name.'; return; }
  $('run').disabled = true;
  $('msg').textContent = 'Starting the dive';
  const dive = await api('/api/company-dive', { method: 'POST', body: JSON.stringify({ company: name, country, company_uid: uid }) });
  if (!dive.ok || !dive.body || !dive.body.id) {
    $('msg').textContent = 'Could not start: ' + ((dive.body && dive.body.error) || ('HTTP ' + dive.status));
    $('run').disabled = false;
    return;
  }
  if (both) {
    $('msg').textContent = 'Dive started; queuing the deeper dive';
    const deeper = await api('/api/dive-deeper', { method: 'POST', body: JSON.stringify({ dive_id: dive.body.id }) });
    if (!deeper.ok) { await load(); const m = $('msg'); if (m) m.textContent = 'Dive started, but the deeper dive could not be queued: ' + ((deeper.body && deeper.body.error) || ('HTTP ' + deeper.status)); return; }
  }
  await load();
}

load();
</script>
</body>
</html>`;
