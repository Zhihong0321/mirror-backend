// /tools: one page with the live state of every outside tool the hub uses. Nothing hidden: a tool that is out of credit,
// resting, switched off or not answering is shown as such, with its reason and its last real call.
// It only READS. It never stops, skips or blocks a run; the pipeline keeps going on whatever still works.
//   GET /tools              the page (public shell, like /workers; it asks for the LAB_TOKEN and keeps it in the browser)
//   GET /api/tools-health   the rows (behind the operator token)
import type http from 'node:http';
import { health, secrets } from './core/index.ts';
import { callTallies, type CallTally } from './cost.ts';
import { secret } from './divedeeper/lib.ts';

type Row = health.Row & { last?: { calls: number; failed: number; lastOkAt: string | null; lastFailAt: string | null; lastError: string | null } };
type Ctx = { json: (res: http.ServerResponse, status: number, body: unknown) => void };

const when = (iso: string | null | undefined) => (iso ? iso.replace('T', ' ').slice(0, 16) + ' UTC' : '');
const ago = (iso: string | null | undefined) => {
  if (!iso) return '';
  const min = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  return min < 1 ? 'just now' : min < 120 ? `${min} min ago` : `${Math.round(min / 60)} h ago`;
};

async function getJson(url: string, headers: Record<string, string>): Promise<any> {
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(15_000) });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 160)}`);
  return JSON.parse(text);
}

/** The cloud Antigravity hub (Gemini with web search): each account, and whether its last job hit a quota. */
async function agyRows(): Promise<Row[]> {
  await secrets.load();
  const token = secret('AGY_REMOTE_TOKEN') || secret('AGY_WEB_CLOUD');
  const base = (process.env.AGY_REMOTE_URL ?? 'https://my-agy.up.railway.app').replace(/\/+$/, '');
  if (!token) return [{ group: 'Gemini (agy hub)', tool: 'Antigravity hub', state: 'down', summary: 'no hub token saved: G-search and G-recommend cannot ask Gemini', details: [] }];
  const h = { authorization: `Bearer ${token}` };
  const [status, jobs] = await Promise.all([getJson(`${base}/api/status`, h), getJson(`${base}/api/jobs`, h).catch(() => ({ jobs: [] }))]);
  const list: any[] = (jobs?.jobs ?? []).slice().sort((a: any, b: any) => (b.finished ?? b.created ?? 0) - (a.finished ?? a.created ?? 0));
  const rows: Row[] = Object.entries(status?.accounts ?? {}).map(([name, a]: [string, any]) => {
    if (a?.enabled === false) return { group: 'Gemini (agy hub)', tool: name, state: 'off', summary: 'switched off on the hub', details: [] };
    const mine = list.filter((j) => j.account === name && (j.status === 'done' || j.status === 'failed'));
    const last = mine[0];
    const lastOk = mine.find((j) => j.status === 'done');
    const isQuota = (j: any) => /quota reached|RESOURCE_EXHAUSTED/i.test(String(j?.error ?? ''));
    // Out of quota when a job hit the quota and no job has answered since (a later, different failure must not hide it).
    const quotaJob = mine.find(isQuota);
    const quota = !!quotaJob && !(lastOk && (lastOk.finished ?? 0) > (quotaJob.finished ?? 0));
    const err = String((quota ? quotaJob : last)?.error ?? '');
    const reset = err.match(/Resets in ([0-9hms]+)/)?.[1];
    const iso = (s: number | undefined) => (s ? new Date(s * 1000).toISOString() : null);
    const state: health.State = !last ? 'unknown' : last.status === 'done' ? 'ok' : quota || last.auth_failure ? 'down' : 'warn';
    const summary = !last ? 'no job in the hub\'s recent list'
      : last.status === 'done' ? `last job answered ${ago(iso(last.finished))}`
      : quota ? `out of quota${reset ? `, resets in ${reset}` : ''}`
      : last.auth_failure ? `the hub flagged its last job (${ago(iso(last.finished))}) as a login problem; exit code ${last.exit ?? '?'}`
      : `last job failed ${ago(iso(last.finished))}`;
    const failed = mine.filter((j) => j.status === 'failed').length;
    const details = [
      `${mine.length} recent jobs: ${mine.length - failed} answered, ${failed} failed${lastOk ? `; last answer ${when(iso(lastOk.finished))}` : ''}`,
      ...(last && last.status === 'failed' && !quota ? [`its message: ${err.replace(/\s+/g, ' ').slice(0, 200)}`] : []),
    ];
    return { group: 'Gemini (agy hub)', tool: name, state, summary, details };
  });
  return rows;
}

/** myworker: the worker PCs (page reads, Google Maps, ChatGPT tabs) and how much work is waiting. */
async function myworkerRows(): Promise<Row[]> {
  const base = (process.env.V21_DEEPER_WORKER_URL ?? process.env.GMAP_API_URL ?? 'https://myworker.up.railway.app').replace(/\/+$/, '');
  const key = secret('GMAP_API_KEY');
  if (!key) return [{ group: 'myworker', tool: 'myworker', state: 'down', summary: 'GMAP_API_KEY is missing: page reads, Maps and ChatGPT cannot run', details: [] }];
  const h = { authorization: `Bearer ${key}` };
  const [workers, pending] = await Promise.all([getJson(`${base}/api/workers`, h), getJson(`${base}/api/scans?status=pending`, h).catch((e) => ({ error: String(e) }))]);
  const rows: Row[] = (workers?.workers ?? []).map((w: any) => {
    const seenMin = (Date.now() - Date.parse(w.lastSeen ?? 0)) / 60_000;
    const cooling = w.coolUntil && Date.parse(w.coolUntil) > Date.now();
    const chat = Array.isArray(w.chatBrowsers) && w.chatBrowsers.length;
    const canChat = (w.types ?? []).includes('chat.ask');
    const state: health.State = seenMin > 5 ? 'down' : cooling ? 'warn' : canChat && !chat ? 'warn' : 'ok';
    const summary = [
      seenMin > 5 ? `not seen for ${Math.round(seenMin)} min` : 'online',
      cooling ? `cooling until ${when(w.coolUntil)}${w.coolReason ? ` (${w.coolReason})` : ''}` : '',
      canChat ? (chat ? `ChatGPT tab ready (${w.chatBrowsers.join(', ')})` : 'takes ChatGPT jobs but has NO ChatGPT tab connected') : '',
    ].filter(Boolean).join(' · ');
    return { group: 'myworker', tool: w.name, state, summary, details: [`done ${w.done ?? 0}, failed ${w.failed ?? 0} · jobs: ${(w.types ?? []).join(', ')}`] };
  });
  if (!rows.length) rows.push({ group: 'myworker', tool: 'worker PCs', state: 'down', summary: 'no worker PC connected: page reads, Maps and ChatGPT wait', details: [] });
  const jobs: any[] = (pending as any)?.jobs ?? [];
  const by = new Map<string, number>();
  for (const j of jobs) by.set(`${j.callerId ?? 'unknown'} ${j.type}`, (by.get(`${j.callerId ?? 'unknown'} ${j.type}`) ?? 0) + 1);
  const oldest = jobs.map((j) => j.createdAt).filter(Boolean).sort()[0];
  const waitMin = oldest ? Math.round((Date.now() - Date.parse(oldest)) / 60_000) : 0;
  rows.push({
    group: 'myworker', tool: 'Job queue', state: (pending as any)?.error ? 'unknown' : waitMin > 15 ? 'warn' : 'ok',
    summary: (pending as any)?.error ? `could not read: ${(pending as any).error}` : `${jobs.length}${jobs.length >= 200 ? '+ (list is capped at 200)' : ''} jobs waiting${oldest ? `, oldest waiting ${waitMin} min` : ''}`,
    details: [...by].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${n} × ${k}`),
  });
  return rows;
}

/** The hub's own record of its calls, attached to the matching tool. */
function withCalls(rows: health.Row[], tallies: CallTally[]): Row[] {
  return rows.map((r) => {
    if (!r.match) return r;
    const mine = tallies.filter((t) => t.api === r.match!.api && (!r.match!.provider || t.provider === r.match!.provider));
    if (!mine.length) return r;
    const latest = (k: 'lastOkAt' | 'lastFailAt') => mine.map((t) => t[k]).filter(Boolean).sort().pop() ?? null;
    const lastFailAt = latest('lastFailAt');
    const lastError = mine.find((t) => t.lastFailAt === lastFailAt)?.lastError ?? null;
    return { ...r, last: { calls: mine.reduce((n, t) => n + t.calls, 0), failed: mine.reduce((n, t) => n + t.failed, 0), lastOkAt: latest('lastOkAt'), lastFailAt, lastError } };
  });
}

export async function rows(): Promise<Row[]> {
  const [core, agy, worker] = await Promise.all([
    health.snapshot().catch((e) => [{ group: 'Hub', tool: 'core tools', state: 'unknown' as const, summary: `could not read: ${String(e).slice(0, 200)}`, details: [] }]),
    health.guard('Gemini (agy hub)', 'Antigravity hub', agyRows),
    health.guard('myworker', 'myworker', myworkerRows),
  ]);
  let tallies: CallTally[] = [];
  try { tallies = callTallies(); } catch { /* shown without call counts */ }
  return withCalls([...core, ...agy, ...worker], tallies);
}

export async function handle(req: http.IncomingMessage, res: http.ServerResponse, url: URL, ctx: Ctx): Promise<boolean> {
  if (url.pathname !== '/api/tools-health' || req.method !== 'GET') return false;
  const list = await rows();
  ctx.json(res, 200, { at: new Date().toISOString(), since: new Date(Date.now() - process.uptime() * 1000).toISOString(), rows: list });
  return true;
}

export function page(): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Tools health</title><style>
:root{--bg:#f6f7f9;--card:#fff;--ink:#14161a;--muted:#5d6470;--line:#e3e6eb;--ok:#137a3a;--okb:#e6f4ea;--warn:#8a5a00;--warnb:#fdf2dc;--down:#b3261e;--downb:#fbe4e2;--off:#5d6470;--offb:#eef0f3}
@media (prefers-color-scheme:dark){:root{--bg:#101215;--card:#181b20;--ink:#e8eaed;--muted:#9aa1ab;--line:#2a2f36;--ok:#7fd49b;--okb:#16301f;--warn:#f0c46a;--warnb:#33290f;--down:#ff8f86;--downb:#3a1714;--off:#9aa1ab;--offb:#23272d}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.45 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
main{max-width:1100px;margin:0 auto;padding:20px 16px 60px}h1{font-size:22px;margin:0 0 4px}.muted{color:var(--muted)}
.bar{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:14px 0}input{flex:1;min-width:200px;padding:8px 10px;border:1px solid var(--line);border-radius:8px;background:var(--card);color:var(--ink)}
button{padding:8px 14px;border:1px solid var(--line);border-radius:8px;background:var(--ink);color:var(--bg);font-weight:600;cursor:pointer}
.sum{display:flex;gap:8px;flex-wrap:wrap;margin:6px 0 16px}.chip{padding:4px 10px;border-radius:999px;font-weight:600;font-size:13px}
.ok{background:var(--okb);color:var(--ok)}.warn{background:var(--warnb);color:var(--warn)}.down{background:var(--downb);color:var(--down)}.off,.unknown{background:var(--offb);color:var(--off)}
section{background:var(--card);border:1px solid var(--line);border-radius:12px;margin:0 0 14px;overflow:hidden}section h2{font-size:15px;margin:0;padding:10px 14px;border-bottom:1px solid var(--line)}
.row{display:grid;grid-template-columns:90px 220px 1fr;gap:10px;padding:10px 14px;border-bottom:1px solid var(--line)}.row:last-child{border-bottom:0}
.row .tool{font-weight:600;overflow-wrap:anywhere}.row .det{color:var(--muted);font-size:12.5px;margin-top:3px;overflow-wrap:anywhere}
@media (max-width:640px){.row{grid-template-columns:1fr}}.err{color:var(--down);margin:10px 0}
</style></head><body><main>
<h1>Tools health</h1><p class="muted">Every outside tool the hub uses, read live. Down means it cannot do its work now; the pipeline still runs on what works. Refreshes every 30 seconds.</p>
<div class="bar"><input id="token" type="password" placeholder="LAB_TOKEN" autocomplete="off"><button id="save">Load</button><span id="at" class="muted"></span></div>
<div id="err" class="err"></div><div id="sum" class="sum"></div><div id="out"></div>
<script>
(function(){
var $=function(id){return document.getElementById(id)};
var get=function(){try{return localStorage.getItem('labToken')||''}catch(e){return ''}};
var esc=function(s){return String(s==null?'':s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]})};
var ago=function(iso){if(!iso)return '';var m=Math.round((Date.now()-Date.parse(iso))/60000);return m<1?'just now':m<120?m+' min ago':Math.round(m/60)+' h ago'};
var label={ok:'OK',warn:'Needs a look',down:'Down',off:'Off',unknown:'Unknown'};
function load(){
  var t=get();if(!t){$('err').textContent='Enter the LAB_TOKEN to load.';return}
  fetch('/api/tools-health',{headers:{authorization:'Bearer '+t}}).then(function(r){return r.json().then(function(b){if(!r.ok)throw new Error(b.error||('HTTP '+r.status));return b})}).then(function(b){
    $('err').textContent='';$('at').textContent='Read '+new Date(b.at).toLocaleTimeString()+' · call counts since the hub started '+ago(b.since);
    var n={ok:0,warn:0,down:0,off:0,unknown:0};b.rows.forEach(function(r){n[r.state]=(n[r.state]||0)+1});
    $('sum').innerHTML=['down','warn','unknown','off','ok'].filter(function(s){return n[s]}).map(function(s){return '<span class="chip '+s+'">'+n[s]+' '+label[s]+'</span>'}).join('');
    var groups=[];b.rows.forEach(function(r){var g=groups.filter(function(x){return x.name===r.group})[0];if(!g){g={name:r.group,rows:[]};groups.push(g)}g.rows.push(r)});
    var rank={down:0,warn:1,unknown:2,off:3,ok:4};
    $('out').innerHTML=groups.map(function(g){g.rows.sort(function(a,b){return rank[a.state]-rank[b.state]});return '<section><h2>'+esc(g.name)+'</h2>'+g.rows.map(function(r){
      var l=r.last,calls=l?'<div class="det">Hub calls: '+l.calls+' ('+l.failed+' failed)'+(l.lastOkAt?' · last success '+ago(l.lastOkAt):' · no success yet')+(l.lastFailAt?' · last failure '+ago(l.lastFailAt)+(l.lastError?': '+esc(l.lastError):''):'')+'</div>':'';
      return '<div class="row"><div><span class="chip '+r.state+'">'+label[r.state]+'</span></div><div class="tool">'+esc(r.tool)+'</div><div>'+esc(r.summary)+(r.details||[]).map(function(d){return '<div class="det">'+esc(d)+'</div>'}).join('')+calls+'</div></div>'}).join('')+'</section>'}).join('');
  }).catch(function(e){$('err').textContent='Could not load: '+e.message});
}
$('token').value=get();$('save').onclick=function(){try{localStorage.setItem('labToken',$('token').value.trim())}catch(e){}load()};
load();setInterval(load,30000);
})();
</script></main></body></html>`;
}
