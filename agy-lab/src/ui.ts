// The whole front end: one static shell, rendered client-side.
//
// No framework and no build step, which is durability rather than minimalism —
// this page has to work on the day the thing it is inspecting does not, and a
// page with no toolchain cannot break because a toolchain changed.
import { OPERATOR_NAV, navHtml } from './nav.ts';

export function page(): string {
  return String.raw`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>agy-lab</title>
<style>
  :root {
    --bg:#0f1115; --card:#171a20; --ink:#e8eaed; --muted:#9aa3af; --line:#262b33;
    --ok:#4ade9f; --bad:#ff8b80; --warn:#f0c065; --idk:#9aa3af; --accent:#7aa2f7;
  }
  * { box-sizing:border-box; }
  body { margin:0; padding:28px 20px 64px; background:var(--bg); color:var(--ink);
    font:14px/1.55 ui-sans-serif,-apple-system,"Segoe UI",system-ui,sans-serif; }
  .wrap { max-width:1080px; margin:0 auto; }
  h1 { font-size:20px; margin:0 0 2px; letter-spacing:-.01em; }
  .sub { color:var(--muted); font-size:13px; margin:0 0 22px; }
  /* Every surface, from every surface. The console used to name none of the
     other three, so /docs and /research were things you had to already know. */
  .sitenav { display:flex; flex-wrap:wrap; gap:4px; margin:0 0 20px; padding-bottom:16px;
    border-bottom:1px solid var(--line); }
  .sitenav a { color:var(--muted); font-size:13px; font-weight:550; padding:5px 10px;
    border:1px solid transparent; border-radius:8px; text-decoration:none; }
  .sitenav a:hover { color:var(--ink); background:#1e222a; border-color:var(--line); }
  .sitenav a[aria-current="page"] { color:var(--ink); background:#1e222a; border-color:var(--line); }
  .card { background:var(--card); border:1px solid var(--line); border-radius:12px; padding:16px 18px; margin-bottom:16px; }
  .card h2 { font-size:12px; text-transform:uppercase; letter-spacing:.08em; color:var(--muted); margin:0 0 12px; font-weight:600; }
  .row { display:flex; gap:8px; flex-wrap:wrap; align-items:center; }
  button { font:inherit; font-size:13px; font-weight:550; padding:7px 14px; border-radius:8px;
    border:1px solid var(--line); background:#1e222a; color:var(--ink); cursor:pointer; }
  button:hover:not(:disabled) { border-color:var(--muted); }
  button:disabled { opacity:.5; cursor:default; }
  button.primary { background:var(--accent); border-color:var(--accent); color:#0f1115; }
  input, textarea, select { font:inherit; font-size:13px; background:#0f1115; color:var(--ink);
    border:1px solid var(--line); border-radius:8px; padding:7px 10px; }
  input, textarea { width:100%; }
  textarea { font-family:ui-monospace,Consolas,monospace; resize:vertical; }
  pre { background:#0b0d11; border:1px solid var(--line); border-radius:8px; padding:12px;
    overflow:auto; max-height:420px; font:12px/1.5 ui-monospace,Consolas,monospace; white-space:pre-wrap;
    word-break:break-word; margin:12px 0 0; }
  .kv { display:grid; grid-template-columns:auto 1fr; gap:4px 14px; font-size:12.5px; }
  .kv b { font-weight:500; color:var(--muted); }
  .kv span { font-family:ui-monospace,Consolas,monospace; word-break:break-all; }
  .pill { font-size:11.5px; font-weight:600; padding:2px 9px; border-radius:999px; border:1px solid currentColor; }
  .ok { color:var(--ok); } .bad { color:var(--bad); }
  .not_installed { color:var(--warn); } .unknown { color:var(--idk); }
  a { color:var(--accent); word-break:break-all; }
  .hint { color:var(--muted); font-size:12px; margin:8px 0 0; }
  .grid2 { display:grid; grid-template-columns:1fr 1fr; gap:16px; }
  @media (max-width:820px) { .grid2 { grid-template-columns:1fr; } }
</style>
</head>
<body>
<div class="wrap">
  <h1>agy-lab</h1>
  <p class="sub">The research hub: the Pi worker (MiniMax) and contact research.</p>
  <nav class="sitenav" aria-label="Site">${navHtml(OPERATOR_NAV, '/')}</nav>

  <div class="card">
    <h2>Access</h2>
    <div class="row">
      <input id="token" type="password" placeholder="LAB_TOKEN" style="flex:1;min-width:220px">
      <button onclick="saveToken()">Save</button>
      <span id="authState" class="pill unknown">no token</span>
    </div>
    <p class="hint">Stored in this browser only. Sent as a bearer token with every call.</p>
  </div>

  <div class="card">
    <h2>Status</h2>
    <div class="kv" id="status"><b>loading</b><span>...</span></div>
    <div class="row" style="margin-top:14px">
      <button onclick="refresh()">Refresh</button>
    </div>
  </div>

  <div class="grid2">
    <div class="card">
      <h2>Ask Pi</h2>
      <textarea id="prompt" rows="3">Reply with exactly: OK</textarea>
      <div class="row" style="margin-top:8px">
        <button class="primary" onclick="run()">Ask</button>
        <span class="hint">Pi runs with web_search and web_fetch.</span>
      </div>
      <pre id="runOut" style="display:none"></pre>
    </div>

    <div class="card">
      <h2>Shell</h2>
      <textarea id="cmd" rows="3">ls -la $HOME</textarea>
      <div class="row" style="margin-top:8px"><button onclick="execCmd()">Exec</button></div>
      <pre id="execOut" style="display:none"></pre>
    </div>
  </div>

</div>

<script>
const $ = (id) => document.getElementById(id);
const tok = () => localStorage.getItem('labToken') || '';

function saveToken() {
  localStorage.setItem('labToken', $('token').value.trim());
  refresh();
}

async function api(path, opts = {}) {
  const res = await fetch(path, {
    ...opts,
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + tok() },
  });
  const body = await res.json().catch(() => ({ error: 'bad response' }));
  if (res.status === 401) {
    $('authState').className = 'pill bad';
    $('authState').textContent = 'token rejected';
  }
  return { status: res.status, body };
}

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

async function refresh() {
  const { status, body } = await api('/api/status');
  if (status !== 200) { $('status').innerHTML = '<b>error</b><span>' + (body.error || status) + '</span>'; return; }
  $('authState').className = 'pill ok';
  $('authState').textContent = 'token ok';
  const p = body.pi || {};
  const rows = [
    ['Pi worker', p.configured ? 'ready - ' + p.provider + '/' + p.model : 'NOT CONFIGURED - add a MiniMax key on /workers'],
    ['Pi calls', (p.inFlight || 0) + ' running, ' + (p.waiting || 0) + ' waiting, max ' + (p.max || '?')],
    ['HOME', body.home],
    ['memory', body.memory
      ? body.memory.containerUsedMb + ' / ' + body.memory.containerLimitMb + ' MB, node ' +
        body.memory.rssMb + ' MB'
      : '(unknown)'],
    ['uptime', body.uptimeSec != null ? Math.round(body.uptimeSec / 60) + 'm (since ' + body.startedAt + ')' : '(unknown)'],
  ];
  // A recent restart explains far more symptoms than it looks like it should.
  if (body.lastCrash) {
    rows.push(['LAST CRASH', body.lastCrash.kind + ' at ' + body.lastCrash.at + ' - ' +
      String(body.lastCrash.message).split('
')[0]]);
  }
  $('status').innerHTML = rows.map(([k, v]) => '<b>' + k + '</b><span>' + esc(v) + '</span>').join('');
}

async function run() {
  $('runOut').style.display = 'block';
  $('runOut').textContent = 'Asking Pi...';
  const { body } = await api('/api/ask', { method: 'POST', body: JSON.stringify({ model: 'pi', prompt: $('prompt').value }) });
  $('runOut').textContent = body.answer != null
    ? body.answer + '

(' + body.model + ', ' + Math.round((body.ms || 0) / 1000) + 's)'
    : JSON.stringify(body, null, 2);
}

async function execCmd() {
  const { body } = await api('/api/exec', { method: 'POST', body: JSON.stringify({ cmd: $('cmd').value }) });
  $('execOut').style.display = 'block';
  $('execOut').textContent = 'exit ' + body.code + '

' + (body.stdout || '') + (body.stderr || '');
}

$('token').value = tok();
refresh();
setInterval(refresh, 15000);
</script>
</body>
</html>`;
}
