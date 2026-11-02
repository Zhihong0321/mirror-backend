// The /auto-queue page: one place that shows whether the automatic queues are
// actually doing work, hour by hour, and every error they hit.
//
// Every number comes from what the runs saved (published_report, run_event,
// taman_finder_town), never from the loops' own counters, so a queue that says
// it is fine but finishes nothing shows up as a row of zeros and a red verdict.
import { OPERATOR_NAV, navHtml } from './nav.ts';
import * as jobs from './jobs.ts';
import * as db from './reportdb.ts';
import * as autoScan from './autoscan.ts';
import * as autoContact from './autocontact.ts';
import * as keyHealth from './keyhealth.ts';

const MIN = 60_000;
/** A Maps scan job times out at 20 minutes; past 30 it is stuck. */
const SCAN_STUCK_MS = 30 * MIN;
/** A contact report that has not finished in an hour is stuck. */
const CONTACT_STUCK_MS = 60 * MIN;
/** The scan loop ticks every 2 minutes, the contact loop every minute. */
const TICK_LATE_MS = 10 * MIN;

export type Level = 'ok' | 'warn' | 'bad';
export interface Verdict { level: Level; headline: string; reasons: string[] }

export interface HourRow {
  hour: string;
  maps: { queued: number; completed: number; partial: number; failed: number; companies: number; requests: number; skipped: number; avgSec: number };
  contact: { queued: number; completed: number; failed: number; withPhone: number; people: number; deferred: number; avgSec: number };
  finder: { done: number; failed: number; added: number; requests: number };
  /** Failures that need a look: failed or partial runs, failed towns, tick and save failures. */
  errors: number;
}

const iso = (v: unknown): string | null => (v == null ? null : new Date(v as string).toISOString());
const ageMs = (v: string | null, now: number): number => (v ? now - Date.parse(v) : Infinity);
const mins = (ms: number): string => (ms === Infinity ? 'never' : ms < 90 * MIN ? `${Math.round(ms / MIN)} min` : `${(ms / 3_600_000).toFixed(1)} h`);

/** Hour starts (UTC ISO), newest first, covering the last `hours` hours including this one. */
export function hourSlots(hours: number, now = Date.now()): string[] {
  const top = Math.floor(now / 3_600_000) * 3_600_000;
  return Array.from({ length: hours }, (_, i) => new Date(top - i * 3_600_000).toISOString().replace('.000Z', 'Z'));
}

export function hourly(slots: string[], data: Awaited<ReturnType<typeof db.autoQueueHourly>>): HourRow[] {
  const rows = new Map(slots.map((hour) => [hour, {
    hour,
    maps: { queued: 0, completed: 0, partial: 0, failed: 0, companies: 0, requests: 0, skipped: 0, avgSec: 0 },
    contact: { queued: 0, completed: 0, failed: 0, withPhone: 0, people: 0, deferred: 0, avgSec: 0 },
    finder: { done: 0, failed: 0, added: 0, requests: 0 },
    errors: 0,
  } as HourRow]));
  for (const s of data.started) {
    const row = rows.get(s.hour);
    if (!row) continue;
    if (s.kind === 'business_search') row.maps.queued += s.n; else row.contact.queued += s.n;
  }
  const seconds = new Map<string, { maps: number; contact: number }>();
  for (const f of data.finished) {
    const row = rows.get(f.hour);
    if (!row) continue;
    const sec = seconds.get(f.hour) ?? { maps: 0, contact: 0 };
    if (f.kind === 'business_search') {
      if (f.status === 'completed') row.maps.completed += f.n;
      else if (f.status === 'partial') row.maps.partial += f.n;
      else row.maps.failed += f.n;
      row.maps.companies += f.companies;
      row.maps.requests += f.requests;
      row.maps.skipped += f.skipped;
      sec.maps += f.avg_sec * f.n;
    } else {
      if (f.status === 'completed') row.contact.completed += f.n; else row.contact.failed += f.n;
      row.contact.withPhone += f.with_phone;
      row.contact.people += f.people;
      sec.contact += f.avg_sec * f.n;
    }
    if (f.status !== 'completed') row.errors += f.n;
    seconds.set(f.hour, sec);
  }
  for (const row of rows.values()) {
    const sec = seconds.get(row.hour);
    const mapsN = row.maps.completed + row.maps.partial + row.maps.failed;
    const contactN = row.contact.completed + row.contact.failed;
    if (sec && mapsN) row.maps.avgSec = Math.round(sec.maps / mapsN);
    if (sec && contactN) row.contact.avgSec = Math.round(sec.contact / contactN);
  }
  for (const t of data.finder) {
    const row = rows.get(t.hour);
    if (!row) continue;
    if (t.status === 'done') row.finder.done += t.n; else { row.finder.failed += t.n; row.errors += t.n; }
    row.finder.added += t.added;
    row.finder.requests += t.requests;
  }
  for (const e of data.events) {
    const row = rows.get(e.hour);
    if (!row) continue;
    if (e.event === 'contact.deferred') row.contact.deferred += e.n;
    else if (e.event === 'auto.tick_failed' || e.event === 'business_search.save_failed') row.errors += e.n;
  }
  return slots.map((hour) => rows.get(hour)!);
}

type Open = Awaited<ReturnType<typeof db.autoQueueState>>['open'][number];
type Latest = { last_queued: string | null; last_finished: string | null; last_completed: string | null } | undefined;

const verdictOf = (bad: string[], warn: string[], fine: string): Verdict =>
  bad.length ? { level: 'bad', headline: bad[0]!, reasons: [...bad, ...warn] }
    : warn.length ? { level: 'warn', headline: warn[0]!, reasons: warn }
    : { level: 'ok', headline: fine, reasons: [] };

/** Is the Maps auto-scan really working? */
export function mapsVerdict(input: {
  status: Record<string, unknown>; latest: Latest; open: Open[]; lastHour: HourRow | undefined; uptimeMs: number; now: number;
}): Verdict {
  const { status, latest, open, lastHour, now } = input;
  const bad: string[] = [];
  const warn: string[] = [];
  const holding = (status.holding as string | null) ?? null;
  const tickAge = ageMs((status.lastTickAt as string | null) ?? null, now);
  if (input.uptimeMs > TICK_LATE_MS && tickAge > TICK_LATE_MS) bad.push(`The scan loop has not ticked for ${mins(tickAge)}`);
  if (holding === 'no Maps worker is live') bad.push('No Maps worker is live, so nothing can scan');
  else if (holding?.startsWith('paused')) warn.push('Paused by hand (AUTO_SCAN_PAUSED)');
  else if (holding?.startsWith('monthly Maps budget')) warn.push('Stopped: ' + holding);
  else if (holding === 'every listed taman has a Business scan') warn.push('Finished: every listed taman has a Business scan');
  for (const r of open.filter((o) => o.kind === 'business_search' && o.status === 'running')) {
    const age = ageMs(iso(r.created_at), now);
    if (age > SCAN_STUCK_MS) bad.push(`${r.title ?? r.public_id} has been running ${mins(age)} (a scan times out at 20 min)`);
  }
  const quietFor = ageMs(iso(latest?.last_queued), now);
  if (!holding && !open.some((o) => o.kind === 'business_search') && quietFor > TICK_LATE_MS) {
    bad.push(`Nothing holds the queue, yet no scan was queued for ${mins(quietFor)}`);
  }
  if (lastHour) {
    const finished = lastHour.maps.completed + lastHour.maps.partial + lastHour.maps.failed;
    if (finished && lastHour.maps.failed === finished) bad.push(`Every scan that finished this hour failed (${finished})`);
    else if (lastHour.maps.failed) warn.push(`${lastHour.maps.failed} scan(s) failed this hour`);
    if (lastHour.maps.skipped) warn.push(`${lastHour.maps.skipped} Maps search(es) skipped this hour after two failed tries`);
  }
  const done = ageMs(iso(latest?.last_completed), now);
  return verdictOf(bad, warn, `Working. Last scan completed ${mins(done)} ago`);
}

/** Is the contact research auto-queue really working? */
export function contactVerdict(input: {
  status: Awaited<ReturnType<typeof autoContact.status>>; latest: Latest; open: Open[]; lastHour: HourRow | undefined; uptimeMs: number; now: number;
}): Verdict {
  const { status, latest, open, lastHour, now } = input;
  const bad: string[] = [];
  const warn: string[] = [];
  const tickAge = ageMs(status.lastTickAt, now);
  if (input.uptimeMs > TICK_LATE_MS && tickAge > TICK_LATE_MS) bad.push(`The contact loop has not ticked for ${mins(tickAge)}`);
  if (!status.workerAvailable) bad.push(`No live worker claims ${status.jobType}, so nothing can research`);
  if (status.pausedForQuota) bad.push('Stopped: every Tavily and Exa key is resting');
  if (status.paused) warn.push('Paused by hand (AUTO_CONTACT_PAUSED)');
  if (status.holding === 'no lead is waiting for contact research') warn.push('Finished: no lead is waiting for contact research');
  const mine = open.filter((o) => o.kind === 'contact_research');
  const stuck = mine.filter((o) => o.status === 'running' && ageMs(iso(o.created_at), now) > CONTACT_STUCK_MS);
  if (stuck.length) bad.push(`${stuck.length} contact report(s) running over ${mins(CONTACT_STUCK_MS)}`);
  const sinceDone = ageMs(iso(latest?.last_finished), now);
  if (mine.length && sinceDone > 30 * MIN && !status.paused) {
    bad.push(`${mine.length} report(s) open, yet none finished for ${mins(sinceDone)}`);
  }
  if (lastHour) {
    const finished = lastHour.contact.completed + lastHour.contact.failed;
    if (finished && lastHour.contact.failed === finished) bad.push(`Every contact report that finished this hour failed (${finished})`);
    else if (lastHour.contact.failed) warn.push(`${lastHour.contact.failed} contact report(s) failed this hour`);
    if (lastHour.contact.deferred) warn.push(`${lastHour.contact.deferred} contact job(s) deferred this hour (quota, timeout or upstream error)`);
  }
  return verdictOf(bad, warn, `Working. Last report finished ${mins(sinceDone)} ago`);
}

export function finderVerdict(latest: string | null, rows: HourRow[], now: number): Verdict {
  const failed = rows.reduce((n, r) => n + r.finder.failed, 0);
  const warn = failed ? [`${failed} town(s) failed in this window`] : [];
  return verdictOf([], warn, latest ? `Last town checked ${mins(ageMs(latest, now))} ago` : 'No town checked yet');
}

/** Group errors with the same message (numbers ignored) so a repeated failure stands out. */
export function groupProblems(problems: db.AutoQueueProblem[]): Array<{ key: string; kind: string; source: string; message: string; count: number; last: string; first: string }> {
  const groups = new Map<string, { key: string; kind: string; source: string; message: string; count: number; last: string; first: string }>();
  for (const p of problems) {
    const key = p.source + '|' + p.kind + '|' + p.message.replace(/\d+/g, '#').slice(0, 160);
    const g = groups.get(key);
    if (g) { g.count++; if (p.at < g.first) g.first = p.at; if (p.at > g.last) g.last = p.at; }
    else groups.set(key, { key, kind: p.kind, source: p.source, message: p.message, count: 1, last: p.at, first: p.at });
  }
  return [...groups.values()].sort((a, b) => b.count - a.count || b.last.localeCompare(a.last));
}

export async function snapshot(hours: number): Promise<Record<string, unknown>> {
  const now = Date.now();
  const slots = hourSlots(hours, now);
  const since = slots[slots.length - 1]!;
  const [scan, contact, data, problems, state, mapsUsed, keys] = await Promise.all([
    autoScan.status(), autoContact.status(), db.autoQueueHourly(since), db.autoQueueProblems(since), db.autoQueueState(), db.mapsUsageThisMonth(),
    keyHealth.snapshot(),
  ]);
  const rows = hourly(slots, data);
  const latest = (kind: string): Latest => {
    const r = state.latest.find((l) => l.kind === kind);
    return r && { last_queued: iso(r.last_queued), last_finished: iso(r.last_finished), last_completed: iso(r.last_completed) };
  };
  const uptimeMs = process.uptime() * 1000;
  const workers = jobs.snapshot().workers;
  const lane = (type: string) => workers.filter((w) => (w.types ?? []).includes(type))
    .map((w) => ({ name: w.name, status: w.status, lastSeenAt: w.lastSeenAt, done: w.done, failed: w.failed, cooldownReason: w.cooldownReason }));
  const open = state.open.map((o) => ({ ...o, created_at: iso(o.created_at)!, updated_at: iso(o.updated_at)! }));
  return {
    at: new Date(now).toISOString(),
    hours,
    uptimeMs: Math.round(uptimeMs),
    maps: {
      verdict: mapsVerdict({ status: scan, latest: latest('business_search'), open, lastHour: rows[0], uptimeMs, now }),
      status: scan, latest: latest('business_search'), workers: lane('gmap.scan'), mapsRequestsThisMonth: mapsUsed,
    },
    contact: {
      verdict: contactVerdict({ status: contact, latest: latest('contact_research'), open, lastHour: rows[0], uptimeMs, now }),
      status: contact, latest: latest('contact_research'), workers: lane(contact.jobType),
    },
    finder: { verdict: finderVerdict(iso(state.finderLatest), rows, now), latest: iso(state.finderLatest) },
    hourly: rows,
    open,
    holds: state.holds.map((h) => ({ ...h, at: iso(h.at) })),
    problems,
    problemGroups: groupProblems(problems),
    keys,
  };
}

export function page(): string {
  return String.raw`<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark"><title>Auto queue · agy-lab</title>
<style>
:root{--bg:#0f1115;--card:#171a20;--ink:#e8eaed;--muted:#9aa3af;--line:#262b33;--ok:#4ade9f;--bad:#ff8b80;--warn:#f0c065;--accent:#7aa2f7}
*{box-sizing:border-box}body{margin:0;padding:28px 20px 64px;background:var(--bg);color:var(--ink);font:14px/1.55 ui-sans-serif,-apple-system,"Segoe UI",system-ui,sans-serif}
.wrap{max-width:1280px;margin:0 auto}h1{font-size:24px;margin:0 0 4px;letter-spacing:-.02em}.sub{color:var(--muted);font-size:13px;margin:0 0 22px}
.sitenav{display:flex;flex-wrap:wrap;gap:4px;margin:0 0 20px;padding-bottom:16px;border-bottom:1px solid var(--line)}.sitenav a{color:var(--muted);font-size:13px;font-weight:550;padding:5px 10px;border:1px solid transparent;border-radius:8px;text-decoration:none}.sitenav a:hover,.sitenav a[aria-current="page"]{color:var(--ink);background:#1e222a;border-color:var(--line)}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px 18px;margin-bottom:16px}
.row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}button,input,select{font:inherit;font-size:13px;border-radius:8px}button{font-weight:550;padding:7px 14px;border:1px solid var(--line);background:#1e222a;color:var(--ink);cursor:pointer}button:hover{border-color:var(--muted)}button.primary{background:var(--accent);border-color:var(--accent);color:#0f1115}input,select{background:#0f1115;color:var(--ink);border:1px solid var(--line);padding:7px 10px}.token{flex:1;min-width:240px}
.updated{color:var(--muted);font:11px ui-monospace,Consolas,monospace}
h2{font-size:12px;letter-spacing:.1em;text-transform:uppercase;color:var(--muted);margin:0 0 12px}.section-head{display:flex;align-items:baseline;justify-content:space-between;gap:12px;flex-wrap:wrap}
.lanes{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:16px}
.lane{background:var(--card);border:1px solid var(--line);border-left:4px solid var(--muted);border-radius:12px;padding:14px 16px}
.lane.ok{border-left-color:var(--ok)}.lane.warn{border-left-color:var(--warn)}.lane.bad{border-left-color:var(--bad);background:#1f1517}
.lane h3{margin:0 0 6px;font-size:14px}.verdict{font-weight:650;margin:0 0 8px}.ok .verdict{color:var(--ok)}.warn .verdict{color:var(--warn)}.bad .verdict{color:var(--bad)}
.lane ul{margin:0 0 10px;padding-left:18px;font-size:12.5px}.lane li{margin:2px 0}
.kv{display:grid;grid-template-columns:auto 1fr;gap:2px 12px;font-size:12px;color:var(--muted)}.kv b{color:var(--ink);font-weight:550;font-variant-numeric:tabular-nums}
.table-wrap{overflow:auto}table{width:100%;border-collapse:collapse;font-variant-numeric:tabular-nums}
th{text-align:right;color:var(--muted);font-size:10px;letter-spacing:.06em;text-transform:uppercase;font-weight:650;padding:7px 8px;border-bottom:1px solid var(--line);white-space:nowrap}th:first-child,td:first-child{text-align:left}
th.grp{text-align:center;border-bottom:1px solid var(--line);color:var(--ink)}td{padding:6px 8px;border-bottom:1px solid var(--line);text-align:right;white-space:nowrap;font-size:12.5px}
tr.idle td{color:#5d6470}tr.err td{background:#24171a}td.z{color:#4a505a}td.bad{color:var(--bad);font-weight:700}td.warn{color:var(--warn);font-weight:650}td.good{color:var(--ok)}td.sep,th.sep{border-left:1px solid var(--line)}
.pill{display:inline-block;font-size:10.5px;font-weight:700;padding:1px 8px;border-radius:999px;border:1px solid currentColor;white-space:nowrap}.pill.bad{color:var(--bad)}.pill.warn{color:var(--warn)}.pill.ok{color:var(--ok)}.pill.muted{color:var(--muted)}
.err-item{display:grid;grid-template-columns:150px 130px 1fr;gap:10px;padding:8px 0;border-top:1px solid var(--line);font-size:12.5px}.err-item:first-child{border-top:0}
.err-item .msg{word-break:break-word}.err-item .t{color:var(--muted);font:11.5px ui-monospace,Consolas,monospace}.err-item a{color:var(--accent)}
.err-item.bad .msg{color:#ffc2bc}.small{color:var(--muted);font-size:11.5px}
.empty{padding:18px;text-align:center;color:var(--muted)}.error-box{display:none;color:var(--bad);background:#28191c;border:1px solid #5c2a30;border-radius:8px;padding:10px 12px;margin-bottom:16px}.error-box.show{display:block}
.legend{font-size:11.5px;color:var(--muted);margin:8px 0 0}
.tiles{display:grid;grid-template-columns:repeat(5,1fr);gap:10px}.tile{border:1px solid var(--line);border-left:4px solid var(--muted);border-radius:10px;padding:11px 13px;background:#13161b}
.tile.ok{border-left-color:var(--ok)}.tile.warn{border-left-color:var(--warn)}.tile.bad{border-left-color:var(--bad);background:#1f1517}
.tile .name{font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--muted)}.tile .big{font-size:21px;font-weight:700;line-height:1.2;margin:4px 0 2px;font-variant-numeric:tabular-nums}
.tile.ok .big{color:var(--ok)}.tile.warn .big{color:var(--warn)}.tile.bad .big{color:var(--bad)}.tile .line{font-size:11.5px;color:var(--muted)}
.bar{height:6px;border-radius:3px;background:#262b33;overflow:hidden;margin:6px 0 4px}.bar i{display:block;height:100%;background:var(--ok)}.bar i.warn{background:var(--warn)}.bar i.bad{background:var(--bad)}
.mono{font:12px ui-monospace,Consolas,monospace}details{margin-top:12px}summary{cursor:pointer;color:var(--muted);font-size:12.5px;font-weight:600}
@media(max-width:1100px){.tiles{grid-template-columns:repeat(2,1fr)}}
@media(max-width:900px){body{padding:20px 14px 44px}.lanes{grid-template-columns:1fr}.err-item{grid-template-columns:1fr}}
</style></head><body><div class="wrap">
<h1>Auto queue</h1><p class="sub">Every automatic queue and run, read from what the runs saved: the taman Maps auto-scan, the contact research auto-queue, and the missing-taman finder. Refreshes every minute.</p>
<nav class="sitenav" aria-label="Site">${navHtml(OPERATOR_NAV, '/auto-queue')}</nav>
<div class="card"><div class="row"><input id="token" class="token" type="password" placeholder="LAB_TOKEN" autocomplete="current-password"><button class="primary" id="save">Save and refresh</button><select id="hours"><option value="6">Last 6 hours</option><option value="24" selected>Last 24 hours</option><option value="48">Last 48 hours</option><option value="168">Last 7 days</option></select><button id="refresh">Refresh</button><span id="updated" class="updated">not loaded</span></div></div>
<div id="error" class="error-box" role="alert"></div>
<div class="lanes" id="lanes"></div>
<div class="card"><div class="section-head"><h2>API keys: quota left</h2><span class="updated">provider numbers refresh every 5 min</span></div><div class="tiles" id="keyTiles"></div><div id="keyDetail"></div></div>
<div class="card"><div class="section-head"><h2>Per hour</h2><span class="updated" id="hourNote"></span></div><div class="table-wrap"><table><thead>
<tr><th></th><th class="grp sep" colspan="7">Maps auto-scan (scraper.tech)</th><th class="grp sep" colspan="6">Contact research auto-queue</th><th class="grp sep" colspan="2">Taman finder</th><th class="sep"></th></tr>
<tr><th>Hour</th><th class="sep">Queued</th><th>Done</th><th>Partial</th><th>Failed</th><th>Companies</th><th>Requests</th><th>Skipped</th><th class="sep">Queued</th><th>Done</th><th>Failed</th><th>With phone</th><th>People</th><th>Deferred</th><th class="sep">Towns</th><th>Added</th><th class="sep">Errors</th></tr>
</thead><tbody id="hourly"><tr><td colspan="17" class="empty">Enter a LAB_TOKEN to load.</td></tr></tbody></table></div>
<p class="legend">Queued counts runs started in that hour; Done, Failed and the found counts are runs that finished in it. Grey rows did nothing at all. Red rows had errors. Requests are only known for scans saved after this page shipped.</p></div>
<div class="card"><div class="section-head"><h2>Error log</h2><span class="updated" id="errNote"></span></div><div id="groups"></div><h2 style="margin-top:18px">Every error, newest first</h2><div id="problems"></div></div>
<div class="card"><div class="section-head"><h2>Runs still open</h2><span class="updated" id="openNote"></span></div><div id="open"></div></div>
<div class="card"><div class="section-head"><h2>Queue stops and starts, last 7 days</h2></div><div id="holds"></div></div>
</div><script>
(function(){
  var $=function(id){return document.getElementById(id)};
  var esc=function(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})};
  var token=function(){return localStorage.getItem('labToken')||''};
  var ago=function(iso){if(!iso)return 'never';var s=Math.max(0,(Date.now()-new Date(iso).getTime())/1000);if(s<60)return Math.round(s)+'s ago';if(s<3600)return Math.round(s/60)+'m ago';if(s<172800)return (s/3600).toFixed(1)+'h ago';return Math.round(s/86400)+'d ago'};
  var when=function(iso){if(!iso)return '—';var d=new Date(iso);return d.toLocaleDateString(undefined,{month:'short',day:'numeric'})+' '+d.toLocaleTimeString(undefined,{hour:'2-digit',minute:'2-digit'})};
  var hourLabel=function(iso){var d=new Date(iso);return d.toLocaleDateString(undefined,{weekday:'short',day:'numeric'})+' '+String(d.getHours()).padStart(2,'0')+':00'};
  var dur=function(sec){if(!sec)return '';return sec<90?sec+'s':Math.round(sec/60)+'m'};
  var cell=function(n,cls,first){return '<td class="'+(first?'sep ':'')+(n?(cls||''):'z')+'">'+(n||'·')+'</td>'};
  var BAD={failed:1,'auto.tick_failed':1,'business_search.save_failed':1,'contact.failed':1};
  var SRC={business_search:'Maps scan',contact_research:'Contact research','auto-scan':'Maps auto-scan loop','auto-contact':'Contact auto-queue loop',taman_finder:'Taman finder','research.contact':'Contact research'};
  var KIND={failed:'failed',partial:'partial',skipped_searches:'searches skipped','contact.deferred':'deferred','contact.failed':'worker failed','business_search.save_failed':'save failed','auto.tick_failed':'loop error'};
  var lane=function(title,v,kv,extra){return '<div class="lane '+v.level+'"><h3>'+esc(title)+'</h3><p class="verdict">'+(v.level==='ok'?'✓ ':v.level==='warn'?'! ':'✕ ')+esc(v.headline)+'</p>'+(v.reasons.length>1?'<ul>'+v.reasons.slice(1).map(function(r){return '<li>'+esc(r)+'</li>'}).join('')+'</ul>':'')+'<div class="kv">'+kv.map(function(p){return '<span>'+esc(p[0])+'</span><b>'+esc(p[1])+'</b>'}).join('')+'</div>'+(extra||'')+'</div>'};
  var workers=function(list){if(!list||!list.length)return '<p class="small" style="margin:8px 0 0">No worker has claimed this job type.</p>';return '<p class="small" style="margin:8px 0 0">'+list.map(function(w){return '<span class="pill '+(w.status==='online'?'ok':w.status==='cooldown'?'warn':'bad')+'">'+esc(w.name)+' '+esc(w.status)+'</span>'}).join(' ')+'</p>'};

  var num=function(n){return n==null?'—':Number(n).toLocaleString()};
  var usd=function(n){return n==null?'—':'$'+Number(n).toFixed(2)};
  var lvl=function(share){return share==null?'':share<0.05?'bad':share<0.2?'warn':''};
  var bar=function(left,total){if(left==null||!total)return '';var s=Math.max(0,Math.min(1,left/total));return '<div class="bar"><i class="'+lvl(s)+'" style="width:'+(s*100).toFixed(1)+'%"></i></div>'};
  var until=function(iso){if(!iso)return '';var s=(new Date(iso).getTime()-Date.now())/1000;if(s<=0)return 'resetting';if(s<3600)return 'resets in '+Math.round(s/60)+'m';if(s<172800)return 'resets in '+(s/3600).toFixed(1)+'h';return 'resets '+when(iso)};
  var tile=function(name,level,big,lines,b){return '<div class="tile '+esc(level||'')+'"><div class="name">'+esc(name)+'</div><div class="big">'+esc(big)+'</div>'+(b||'')+lines.filter(Boolean).map(function(l){return '<div class="line">'+esc(l)+'</div>'}).join('')+'</div>'};
  var renderKeys=function(k){
    var t=k.tavily||{},e=k.exa||{},m=k.scraperTech||{},mm=k.minimax||{},x=k.extractLlm||{},w=(mm.windows||[])[0];
    $('keyTiles').innerHTML=
      tile('Tavily search',t.level,t.error?'error':t.keys&&!t.keysRead?'unknown':num(t.creditsLeft)+' left',[t.error||(t.keysRead?'of '+num(t.creditsTotal)+' credits this month ('+t.keysRead+' keys read)':'Tavily quota could not be read'),t.keys!=null?'SG '+t.usable+' of '+t.keys+' keys usable':'',t.readFailures?t.readFailures+' key(s) failed the quota read: '+t.readError:'',t.proxy?(t.proxy.reachable?'US proxy: '+t.proxy.usable+' of '+t.proxy.keys+' keys usable, '+num(t.proxy.spentCredits)+' credits spent, about '+num(t.proxy.estimatedLeftCredits)+' left':'US proxy unreachable: '+t.proxy.error):''],bar(t.creditsLeft,t.creditsTotal))+
      tile('Exa search',e.level,e.error?'error':e.usable+' of '+e.keys+' keys',[e.error||'usable now (a spent key rests a day)',e.us&&e.us.keys?'SG '+e.direct.usable+' of '+e.direct.keys+' · US proxy '+e.us.usable+' of '+e.us.keys:'',e.spentUsd!=null?usd(e.spentUsd)+' spent since counting began':'',e.proxy?(e.proxy.reachable?'US proxy: '+e.proxy.usable+' of '+e.proxy.keys+' keys usable, '+usd(e.proxy.spentUsd)+' spent, about '+usd(e.proxy.estimatedLeftUsd)+' left (assumes '+usd(e.proxy.creditAssumedUsd)+' each)':'US proxy unreachable: '+e.proxy.error):'Exa does not report credit left'])+
      tile('scraper.tech Maps',m.level,m.error?'error':num(m.left)+' left',[m.error||('of '+num(m.plan)+' requests this month'),m.used!=null?num(m.hub)+' hub + '+num(m.finder)+' finder used':'',m.resetsAt?until(m.resetsAt):''],bar(m.left,m.plan))+
      tile('MiniMax token plan',mm.level,mm.error?'error':!mm.configured?'not set':w?w.intervalLeftPct+'% left':'—',[mm.error||mm.note||(w?'this 5-hour window, '+until(w.intervalResetsAt):''),w?w.weekLeftPct+'% of the week left, '+until(w.weekResetsAt):''],w?bar(Math.min(w.intervalLeftPct,w.weekLeftPct),100):'')+
      tile('Contact extract LLM',x.level,x.error?'error':!x.configured?'not set':x.leftUsd!=null?usd(x.leftUsd)+' left':'—',[x.error||x.note||(x.limitUsd!=null?'of '+usd(x.limitUsd)+', '+usd(x.usedUsd)+' used':''),x.model?x.model+' on '+x.host:''],x.leftUsd!=null?bar(x.leftUsd,x.limitUsd):'');
    var tRows=(t.perKey||[]).map(function(r){var s=r.limit?r.left/r.limit:null;return '<tr class="'+(r.cooling?'err':'')+'"><td class="mono">'+esc(r.tail)+'</td><td>'+num(r.used)+' / '+num(r.limit)+'</td><td class="'+(lvl(s)||'good')+'">'+num(r.left)+'</td><td style="text-align:left"><span class="pill '+(r.resting?'bad':r.cooling?'warn':'ok')+'">'+(r.resting?'out of credits':r.cooling?'cooling':'usable')+'</span>'+(r.usageError?' <span class="small">quota read failed: '+esc(r.usageError)+'</span>':r.usageCheckedAt?' <span class="small">read '+esc(ago(r.usageCheckedAt))+'</span>':'')+'</td></tr>'}).join('');
    var eRows=(e.perKey||[]).map(function(r){return '<tr class="'+(r.cooling?'err':'')+'"><td class="mono">'+esc(r.tail)+'</td><td style="text-align:left">'+(r.via==='us'?'US proxy':'SG')+'</td><td style="text-align:left"><span class="pill '+(r.cooling?'bad':'ok')+'">'+(r.cooling?'resting':'usable')+'</span></td><td>'+usd(r.spentUsd)+'</td><td>'+num(r.calls)+'</td><td class="'+(r.failures?'warn':'z')+'">'+num(r.failures)+'</td><td>'+esc(ago(r.lastOkAt))+'</td><td style="text-align:left;white-space:normal;max-width:420px" class="small">'+(r.lastError?esc(ago(r.lastErrorAt))+': '+esc(r.lastError):'')+'</td></tr>'}).join('');
    $('keyDetail').innerHTML=
      '<details><summary>Tavily, per key ('+(t.keys||0)+')</summary><div class="table-wrap"><table><thead><tr><th>Key</th><th>Used / limit</th><th>Left</th><th style="text-align:left">State</th></tr></thead><tbody>'+(tRows||'<tr><td colspan="4" class="empty">No Tavily keys.</td></tr>')+'</tbody></table></div></details>'+
      '<details><summary>Exa, per key ('+(e.keys||0)+')</summary><div class="table-wrap"><table><thead><tr><th>Key</th><th style="text-align:left">From</th><th style="text-align:left">State</th><th>Spent</th><th>Calls</th><th>Failures</th><th>Last worked</th><th style="text-align:left">Last error</th></tr></thead><tbody>'+(eRows||'<tr><td colspan="8" class="empty">No Exa keys.</td></tr>')+'</tbody></table></div></details>';
  };
  var render=function(b){
    if(b.keys)renderKeys(b.keys);
    var m=b.maps,c=b.contact,f=b.finder,ms=m.status,cs=c.status,sum=function(k,g){return b.hourly.reduce(function(n,r){return n+r[g][k]},0)};
    $('lanes').innerHTML=
      lane('Taman Maps auto-scan',m.verdict,[['Holding',ms.holding||'no, running'],['Tamans scanned',ms.scanned+' of '+ms.tamans],['Scans in flight',ms.inFlight],['Maps requests this month',m.mapsRequestsThisMonth+' of '+ms.monthlyBudget],['Last queued',ago(m.latest&&m.latest.last_queued)],['Last completed',ago(m.latest&&m.latest.last_completed)],['Loop last ticked',ago(ms.lastTickAt)],['In window','queued '+sum('queued','maps')+', done '+sum('completed','maps')+', failed '+sum('failed','maps')+', '+sum('companies','maps')+' companies']],workers(m.workers))+
      lane('Contact research auto-queue',c.verdict,[['Holding',cs.holding||'no, running'],['Worker type',cs.jobType],['Open auto reports',cs.totals.queued+' queued, '+cs.totals.running+' running'],['All-time auto reports',cs.totals.completed+' done, '+cs.totals.failed+' failed'],['Last queued',ago(c.latest&&c.latest.last_queued)],['Last finished',ago(c.latest&&c.latest.last_finished)],['Loop last ticked',ago(cs.lastTickAt)],['In window','queued '+sum('queued','contact')+', done '+sum('completed','contact')+', failed '+sum('failed','contact')+', '+sum('withPhone','contact')+' with phone']],workers(c.workers))+
      lane('Missing-taman finder',f.verdict,[['Runs from','scripts/find-tamans.ts on a PC'],['Last town checked',ago(f.latest)],['In window',sum('done','finder')+' towns done, '+sum('failed','finder')+' failed, '+sum('added','finder')+' tamans added']]);
    $('hourly').innerHTML=b.hourly.map(function(r){var any=r.maps.queued+r.maps.completed+r.maps.partial+r.maps.failed+r.contact.queued+r.contact.completed+r.contact.failed+r.contact.deferred+r.finder.done+r.finder.failed;
      return '<tr class="'+(r.errors?'err':any?'':'idle')+'"><td>'+esc(hourLabel(r.hour))+'</td>'+cell(r.maps.queued,'',1)+cell(r.maps.completed,'good')+cell(r.maps.partial,'warn')+cell(r.maps.failed,'bad')+cell(r.maps.companies,'')+cell(r.maps.requests,'')+cell(r.maps.skipped,'warn')+cell(r.contact.queued,'',1)+cell(r.contact.completed,'good')+cell(r.contact.failed,'bad')+cell(r.contact.withPhone,'')+cell(r.contact.people,'')+cell(r.contact.deferred,'warn')+cell(r.finder.done,'',1)+cell(r.finder.added,'')+cell(r.errors,'bad',1)+'</tr>'}).join('');
    var idle=b.hourly.filter(function(r){return !(r.maps.completed+r.maps.failed+r.maps.partial+r.contact.completed+r.contact.failed)}).length;
    $('hourNote').textContent=b.hourly.length+' hours · '+idle+' with no finished auto-run';
    $('errNote').textContent=b.problems.length+' error(s) in window';
    $('groups').innerHTML=b.problemGroups.length?'<div class="table-wrap"><table><thead><tr><th>Error</th><th>Where</th><th>Kind</th><th>Times</th><th>Last seen</th></tr></thead><tbody>'+b.problemGroups.map(function(g){var bad=BAD[g.kind];return '<tr class="'+(bad?'err':'')+'"><td style="white-space:normal;text-align:left;max-width:640px" class="'+(bad?'':'')+'">'+esc(g.message)+'</td><td style="text-align:left">'+esc(SRC[g.source]||g.source)+'</td><td style="text-align:left"><span class="pill '+(bad?'bad':'warn')+'">'+esc(KIND[g.kind]||g.kind)+'</span></td><td class="'+(bad?'bad':'warn')+'">'+g.count+'</td><td>'+esc(ago(g.last))+'</td></tr>'}).join('')+'</tbody></table></div>':'<div class="empty">No errors in this window.</div>';
    $('problems').innerHTML=b.problems.length?b.problems.map(function(p){var bad=BAD[p.kind];return '<div class="err-item '+(bad?'bad':'')+'"><div class="t">'+esc(when(p.at))+'<br>'+esc(ago(p.at))+'</div><div><span class="pill '+(bad?'bad':'warn')+'">'+esc(KIND[p.kind]||p.kind)+'</span><div class="small">'+esc(SRC[p.source]||p.source)+'</div></div><div class="msg">'+(p.title?'<b>'+esc(p.title)+'</b> · ':'')+esc(p.message)+(p.detail?'<div class="small">'+esc([].concat(p.detail).join(' | '))+'</div>':'')+(p.public_id?' <a href="/r/'+esc(p.public_id)+'" target="_blank" rel="noopener">open</a>':'')+'</div></div>'}).join(''):'<div class="empty">Nothing failed.</div>';
    $('openNote').textContent=b.open.length+' open';
    $('open').innerHTML=b.open.length?'<div class="table-wrap"><table><thead><tr><th>Run</th><th>Type</th><th>Status</th><th>Started</th><th>Age</th></tr></thead><tbody>'+b.open.map(function(o){var age=(Date.now()-new Date(o.created_at).getTime())/60000,lim=o.kind==='business_search'?30:60,stuck=o.status==='running'&&age>lim;return '<tr class="'+(stuck?'err':'')+'"><td style="text-align:left;white-space:normal"><a style="color:var(--accent)" href="/r/'+esc(o.public_id)+'" target="_blank" rel="noopener">'+esc(o.title||o.public_id)+'</a></td><td style="text-align:left">'+esc(SRC[o.kind]||o.kind)+'</td><td style="text-align:left"><span class="pill '+(stuck?'bad':o.status==='running'?'ok':'muted')+'">'+esc(stuck?'stuck':o.status)+'</span></td><td>'+esc(when(o.created_at))+'</td><td class="'+(stuck?'bad':'')+'">'+Math.round(age)+' min</td></tr>'}).join('')+'</tbody></table></div>':'<div class="empty">No auto-run is open.</div>';
    $('holds').innerHTML=b.holds.length?b.holds.map(function(h){return '<div class="err-item"><div class="t">'+esc(when(h.at))+'<br>'+esc(ago(h.at))+'</div><div class="small">'+esc(SRC[h.stage]||h.stage)+'</div><div class="msg">'+(h.reason?'<span class="pill warn">stopped</span> '+esc(h.reason):'<span class="pill ok">running</span> queue started working again')+'</div></div>'}).join(''):'<div class="empty">No stop or start recorded yet (recording began with this page).</div>';
    $('updated').textContent='updated '+new Date().toLocaleTimeString()+' · hub up '+Math.round(b.uptimeMs/60000)+' min';
  };
  var load=function(){
    if(!token()){$('updated').textContent='no token';return}
    fetch('/api/auto-queue/dashboard?hours='+$('hours').value,{headers:{authorization:'Bearer '+token()}})
      .then(function(r){return r.json().then(function(b){if(!r.ok)throw new Error(b.error||('HTTP '+r.status));return b})})
      .then(function(b){$('error').className='error-box';render(b)})
      .catch(function(e){$('error').textContent='Could not load: '+e.message;$('error').className='error-box show'});
  };
  $('token').value=token();
  $('save').onclick=function(){localStorage.setItem('labToken',$('token').value.trim());load()};
  $('refresh').onclick=load;$('hours').onchange=load;
  load();setInterval(load,60000);
})();
</script></body></html>`;
}
