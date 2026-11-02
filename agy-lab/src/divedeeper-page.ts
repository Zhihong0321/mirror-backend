// The /dive-deeper console page: start a run by company name (or from a finished
// company-dive) and browse every report. A shell like the other console pages: it holds no
// data, and calls the token-guarded /api/dive-deeper with the operator token kept in
// localStorage ('labToken'), asking for it once if it is not there.

export function page(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Dive-deeper Reports</title>
<style>
:root { --bg:#f5f7f4; --paper:#fff; --ink:#15201b; --muted:#56635c; --line:#d8dfd9; --accent:#0e5a52;
  --urgent:#b42318; --urgent-bg:#fdecea; --fix:#a15c07; --fix-bg:#fdf3e2; --good:#067647; --good-bg:#e6f4ec; --info:#475467; --info-bg:#eef1f4; }
@media (prefers-color-scheme: dark) { :root { --bg:#0f1513; --paper:#161e1b; --ink:#e6ece8; --muted:#9ba8a1; --line:#29342f; --accent:#5cc4b6;
  --urgent:#f97066; --urgent-bg:#3a1714; --fix:#fdb022; --fix-bg:#33240b; --good:#47cd89; --good-bg:#0f2a1d; --info:#b0bac4; --info-bg:#1d2428; color-scheme:dark; } }
* { box-sizing:border-box; }
body { margin:0; background:var(--bg); color:var(--ink); font:16px/1.5 "Segoe UI",system-ui,sans-serif; }
.wrap { max-width:1000px; margin:0 auto; padding:32px 16px 64px; display:grid; gap:24px; }
h1 { margin:0; font-size:28px; } p { margin:0; } a { color:var(--accent); }
.muted { color:var(--muted); font-size:14px; }
.card { background:var(--paper); border:1px solid var(--line); border-radius:8px; padding:16px; display:grid; gap:12px; }
form { display:flex; flex-wrap:wrap; gap:8px; align-items:center; }
input, select { font:inherit; padding:8px 10px; border:1px solid var(--line); border-radius:6px; background:var(--bg); color:var(--ink); min-width:0; }
input#company { flex:1 1 260px; } select#dive { flex:1 1 260px; }
button { font:inherit; font-weight:600; padding:8px 16px; border:0; border-radius:6px; background:var(--accent); color:var(--paper); cursor:pointer; }
button.ghost { background:transparent; color:var(--accent); border:1px solid var(--line); padding:4px 10px; font-weight:500; }
button:disabled { opacity:.5; cursor:default; }
#msg { font-size:14px; } #msg.err { color:var(--urgent); }
.tbl { overflow-x:auto; border:1px solid var(--line); border-radius:8px; background:var(--paper); }
table { width:100%; border-collapse:collapse; font-size:15px; }
th, td { text-align:left; padding:9px 12px; border-bottom:1px solid var(--line); vertical-align:top; white-space:nowrap; }
td.co { white-space:normal; min-width:180px; } th { font-size:12px; letter-spacing:.05em; text-transform:uppercase; color:var(--muted); font-weight:500; }
tr:last-child td { border-bottom:0; }
.chip { font-size:12px; letter-spacing:.04em; text-transform:uppercase; padding:2px 8px; border-radius:999px; }
.done { color:var(--good); background:var(--good-bg); } .partial { color:var(--fix); background:var(--fix-bg); }
.failed { color:var(--urgent); background:var(--urgent-bg); } .run { color:var(--info); background:var(--info-bg); }
</style>
</head>
<body>
<div class="wrap">
  <div><h1>Dive-deeper reports</h1><p class="muted">Each run does a company-dive first, then the deeper research and the consultation, and ends in one full report. One run at a time; about 15–25 minutes each.</p></div>

  <div class="card">
    <form id="byName"><input id="company" placeholder="Company name, e.g. Eternalgy Sdn Bhd" autocomplete="off" required><button id="go">Start a run</button></form>
    <form id="byDive"><select id="dive"><option value="">or reuse a finished company-dive…</option></select><button id="go2" class="ghost">Start from this dive</button></form>
    <p id="msg" class="muted"></p>
  </div>

  <div class="tbl"><table>
    <thead><tr><th>Company</th><th>Status</th><th>Started</th><th>Finished</th><th>Report</th><th>Company-dive</th><th></th></tr></thead>
    <tbody id="rows"><tr><td colspan="7" class="muted">Loading…</td></tr></tbody>
  </table></div>
</div>
<script>
let token = '';
try { token = localStorage.getItem('labToken') || ''; } catch {}
function ask() { token = prompt('Operator token (LAB_TOKEN)') || ''; try { localStorage.setItem('labToken', token); } catch {} }
if (!token) ask();
async function api(path, opts = {}) {
  const res = await fetch(path, { ...opts, headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' } });
  if (res.status === 401) { ask(); throw new Error('bad or missing token'); }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || ('HTTP ' + res.status));
  return body;
}
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const when = (t) => t ? new Date(t).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '–';
const msg = (text, err) => { const m = document.getElementById('msg'); m.textContent = text; m.className = err ? 'err' : 'muted'; };
const label = { queued: 'Queued', waiting_dive: 'Company-dive running', running: 'Researching', done: 'Done', partial: 'Done (partial)', failed: 'Failed' };
let timer = null;

async function load() {
  try {
    const { runs } = await api('/api/dive-deeper');
    const rows = document.getElementById('rows');
    rows.innerHTML = runs.length ? runs.map((r) => {
      const cls = r.status === 'done' ? 'done' : r.status === 'partial' ? 'partial' : r.status === 'failed' ? 'failed' : 'run';
      const report = (r.status === 'done' || r.status === 'partial') ? '<a href="' + esc(r.report_url) + '" target="_blank" rel="noopener">Open report</a>' : '<a href="' + esc(r.report_url) + '" target="_blank" rel="noopener">Progress</a>';
      const dive = r.dive_report_url ? '<a href="' + esc(r.dive_report_url) + '" target="_blank" rel="noopener">#' + esc(r.dive_id) + '</a> · <a href="' + esc(r.preview_url) + '" target="_blank" rel="noopener">Preview</a>' : (r.dive_id ? '#' + esc(r.dive_id) : '–');
      const retry = r.status === 'failed' ? '<button class="ghost" data-retry="' + esc(r.id) + '" title="' + esc(r.error) + '">Retry</button>' : '';
      return '<tr><td class="co">' + esc(r.company) + '</td><td><span class="chip ' + cls + '">' + esc(label[r.status] || r.status) + '</span></td><td>' + when(r.created_at) + '</td><td>' + when(r.finished_at) + '</td><td>' + report + '</td><td>' + dive + '</td><td>' + retry + '</td></tr>';
    }).join('') : '<tr><td colspan="7" class="muted">No runs yet. Type a company name above to start one.</td></tr>';
    const busy = runs.some((r) => !['done', 'partial', 'failed'].includes(r.status));
    clearTimeout(timer);
    if (busy) timer = setTimeout(load, 15000);
  } catch (e) { msg(e.message, true); }
}

async function loadDives() {
  try {
    const { dives } = await api('/api/company-dive');
    const sel = document.getElementById('dive');
    for (const d of dives.filter((d) => d.status === 'done' || d.status === 'partial')) {
      const o = document.createElement('option'); o.value = d.id; o.textContent = '#' + d.id + ' ' + d.company + ' (' + when(d.finished_at) + ')'; sel.appendChild(o);
    }
  } catch {}
}

async function start(body, btn) {
  btn.disabled = true;
  try {
    const r = await api('/api/dive-deeper', { method: 'POST', body: JSON.stringify(body) });
    msg('Started ' + r.company + (r.queued_behind_another ? ' (queued behind another run)' : '') + '.');
    await load();
  } catch (e) { msg(e.message, true); }
  btn.disabled = false;
}
document.getElementById('byName').addEventListener('submit', (e) => {
  e.preventDefault();
  const company = document.getElementById('company').value.trim();
  if (company) start({ company }, document.getElementById('go'));
});
document.getElementById('byDive').addEventListener('submit', (e) => {
  e.preventDefault();
  const id = document.getElementById('dive').value;
  if (id) start({ dive_id: Number(id) }, document.getElementById('go2')); else msg('Pick a company-dive first.', true);
});
document.getElementById('rows').addEventListener('click', async (e) => {
  const id = e.target.getAttribute && e.target.getAttribute('data-retry');
  if (!id) return;
  e.target.disabled = true;
  try { await api('/api/dive-deeper/' + id + '/retry', { method: 'POST' }); msg('Retrying.'); await load(); } catch (err) { msg(err.message, true); e.target.disabled = false; }
});
load(); loadDives();
</script>
</body>
</html>`;
}
