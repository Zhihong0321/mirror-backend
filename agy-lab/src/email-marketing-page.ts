// /email-marketing: the email hub, built for a phone first.
// Dashboard (leads, sending numbers, the last 14 days), Replies (the ones waiting for
// an answer), one screen per reply (read it, check the drafted answer, Approve & send),
// Chats (every thread where the lead replied), Campaigns and Leads. It uses the
// operator token the other console pages keep in localStorage ('labToken').
import { OPERATOR_NAV, navHtml } from './nav.ts';

export function page(): string {
  return String.raw`<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="color-scheme" content="dark"><meta name="theme-color" content="#0f1115"><title>Email hub · agy-lab</title>
<style>
:root{--bg:#0f1115;--card:#171a20;--card2:#13161b;--ink:#e8eaed;--muted:#9aa3af;--line:#262b33;--ok:#4ade9f;--bad:#ff8b80;--warn:#f0c065;--accent:#7aa2f7}
*{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 ui-sans-serif,-apple-system,"Segoe UI",system-ui,sans-serif}
.wrap{max-width:1100px;margin:0 auto;padding:16px 16px 96px}
header{display:flex;align-items:center;gap:10px;margin-bottom:14px}header h1{font-size:20px;margin:0;letter-spacing:-.02em;flex:1}
details.site summary{list-style:none;cursor:pointer;color:var(--muted);font-size:13px;padding:6px 10px;border:1px solid var(--line);border-radius:8px}details.site summary::-webkit-details-marker{display:none}
.sitenav{display:flex;flex-wrap:wrap;gap:4px;margin:10px 0}.sitenav a{color:var(--muted);font-size:13px;padding:5px 10px;border:1px solid var(--line);border-radius:8px;text-decoration:none}.sitenav a[aria-current="page"]{color:var(--ink);background:#1e222a}
h2{font-size:16px;margin:0 0 10px}h3{font-size:12px;margin:16px 0 8px;color:var(--muted);text-transform:uppercase;letter-spacing:.06em}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:14px;margin-bottom:12px}
.row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}.grow{flex:1;min-width:0}
button,input,select,textarea{font:inherit;border-radius:10px}
button{font-weight:600;padding:10px 14px;border:1px solid var(--line);background:#1e222a;color:var(--ink);cursor:pointer;min-height:42px}button:disabled{opacity:.45}
button.primary{background:var(--accent);border-color:var(--accent);color:#0f1115}button.go{background:var(--ok);border-color:var(--ok);color:#0b1f16}button.danger{color:var(--bad)}button.small{min-height:32px;padding:5px 10px;font-size:13px}button.block{width:100%}
input,select,textarea{background:#0f1115;color:var(--ink);border:1px solid var(--line);padding:10px 12px;font-size:16px;min-width:0}textarea{width:100%;min-height:200px;resize:vertical;line-height:1.55}
.tiles{display:grid;grid-template-columns:repeat(2,1fr);gap:8px}.tile{background:var(--card2);border:1px solid var(--line);border-radius:12px;padding:10px 12px}
.tile .n{font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--muted)}.tile .v{font-size:22px;font-weight:700;line-height:1.25;font-variant-numeric:tabular-nums}.tile .s{font-size:12px;color:var(--muted)}
.waiting{display:flex;align-items:center;gap:14px;text-decoration:none;color:inherit;border-color:#2f4a7a;background:#141a26}.waiting .big{font-size:34px;font-weight:800;color:var(--accent);line-height:1}
.bars .b{display:grid;grid-template-columns:52px 1fr 70px;gap:8px;align-items:center;font-size:12px;margin:3px 0}.bars .t{height:10px;border-radius:5px;background:#262b33;overflow:hidden;position:relative}.bars .t i{position:absolute;left:0;top:0;bottom:0;background:var(--accent)}.bars .t i.r{background:var(--ok)}
.muted{color:var(--muted)}.small{font-size:13px}.tiny{font-size:12px}.ok{color:var(--ok)}.bad{color:var(--bad)}.warn{color:var(--warn)}a{color:var(--accent)}
.pill{display:inline-block;font-size:11.5px;padding:1px 8px;border-radius:999px;border:1px solid var(--line);color:var(--muted);margin:0 4px 3px 0;white-space:nowrap}.pill.ok{color:var(--ok);border-color:#285c45}.pill.warn{color:var(--warn);border-color:#5c4b25}.pill.bad{color:var(--bad);border-color:#5c2a30}.pill.blue{color:var(--accent);border-color:#2f4a7a}
.empty{padding:22px 10px;text-align:center;color:var(--muted)}
.msg{display:none;border-radius:10px;padding:10px 12px;margin-bottom:12px;white-space:pre-wrap}.msg.show{display:block}.msg.error{color:var(--bad);background:#28191c;border:1px solid #5c2a30}.msg.info{color:var(--ok);background:#15241e;border:1px solid #285c45}
.item{display:block;text-decoration:none;color:inherit;padding:12px 2px;border-bottom:1px solid var(--line)}.item:last-child{border-bottom:0}.item .top{display:flex;gap:8px;align-items:baseline}.item .who{font-weight:650;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.item .when{font-size:12px;color:var(--muted);white-space:nowrap}.item .sub{font-size:12.5px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.item .pre{font-size:13.5px;margin-top:3px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.bubble{border:1px solid var(--line);border-radius:12px;padding:10px 12px;margin:0 0 10px;background:var(--card2);white-space:pre-wrap;word-break:break-word;font-size:14px}.bubble.in{border-color:#2f4a7a;background:#141a26}.bubble .meta{font-size:12px;color:var(--muted);margin-bottom:6px;white-space:normal}
.their{font-size:16px;line-height:1.6;white-space:pre-wrap;word-break:break-word}
.sticky{position:sticky;bottom:72px;background:var(--bg);padding:10px 0 4px;z-index:2}
.table-wrap{overflow-x:auto;-webkit-overflow-scrolling:touch}table{width:100%;border-collapse:collapse;font-size:13px}th{text-align:left;color:var(--muted);font-size:11.5px;font-weight:600;padding:7px 8px;border-bottom:1px solid var(--line);white-space:nowrap}td{padding:8px;border-bottom:1px solid #1e222a;vertical-align:top}td.num,th.num{text-align:right;font-variant-numeric:tabular-nums}tr.click{cursor:pointer}
.step{border:1px solid var(--line);border-radius:12px;padding:10px;margin-bottom:10px;background:var(--card2)}.step .row{margin-bottom:8px}
.days label{display:inline-flex;gap:4px;align-items:center;margin:0 10px 6px 0;font-size:14px}
.hint{font-size:12.5px;color:var(--muted);margin:6px 0 0}.hint code{color:var(--accent)}
.check{display:flex;gap:10px;padding:8px 0;border-bottom:1px solid var(--line);font-size:14px}.check:last-child{border-bottom:0}.check b{min-width:16px}
nav.tabs{position:fixed;left:0;right:0;bottom:0;display:grid;grid-template-columns:repeat(5,1fr);background:#12151a;border-top:1px solid var(--line);padding-bottom:env(safe-area-inset-bottom);z-index:5}
nav.tabs a{display:flex;flex-direction:column;align-items:center;gap:2px;padding:9px 0 8px;color:var(--muted);text-decoration:none;font-size:11.5px;font-weight:600;position:relative}nav.tabs a .ic{font-size:19px;line-height:1}nav.tabs a[aria-current="page"]{color:var(--accent)}
nav.tabs .badge{position:absolute;top:4px;left:calc(50% + 6px);background:var(--bad);color:#1a0d0c;font-size:10.5px;font-weight:800;border-radius:999px;padding:0 5px;min-width:17px;text-align:center}
[hidden]{display:none!important}
@media(min-width:800px){
  .wrap{padding:24px 24px 40px}.tiles{grid-template-columns:repeat(4,1fr)}
  nav.tabs{position:static;display:flex;gap:4px;background:none;border:0;margin-bottom:14px;padding:0}nav.tabs a{flex-direction:row;gap:6px;padding:8px 14px;border:1px solid transparent;border-radius:10px;font-size:14px}nav.tabs a[aria-current="page"]{background:#1e222a;border-color:var(--line);color:var(--ink)}nav.tabs .badge{position:static}
  .sticky{bottom:0}
}
</style></head><body><div class="wrap">
<header><h1>Email hub</h1><details class="site"><summary>Pages ▾</summary></details></header>
<nav class="sitenav" id="siteNav" aria-label="Site" hidden>${navHtml(OPERATOR_NAV, '/email-marketing')}</nav>
<nav class="tabs" id="tabs" aria-label="Email hub">
<a href="#dashboard" data-view="dashboard"><span class="ic">▦</span>Home</a>
<a href="#replies" data-view="replies"><span class="ic">✉</span>Replies<span class="badge" id="badge" hidden></span></a>
<a href="#chats" data-view="chats"><span class="ic">☰</span>Chats</a>
<a href="#campaigns" data-view="campaigns"><span class="ic">➤</span>Campaigns</a>
<a href="#leads" data-view="leads"><span class="ic">◉</span>Leads</a>
</nav>
<div class="card" id="tokenCard" hidden><div class="row"><input id="token" class="grow" type="password" placeholder="LAB_TOKEN" autocomplete="current-password"><button class="primary" id="saveToken">Save</button></div></div>
<div id="error" class="msg error" role="alert"></div><div id="info" class="msg info" role="status"></div>

<section id="v-dashboard">
<a class="card waiting" href="#replies" id="waitCard"><div class="big" id="waitN">–</div><div><b>replies waiting for you</b><div class="muted small" id="waitSub"></div></div></a>
<div class="card"><h2>Leads</h2><div class="tiles" id="leadTiles"></div></div>
<div class="card"><h2>Sending</h2><div class="tiles" id="sendTiles"></div><p class="hint" id="sendNote"></p></div>
<div class="card"><h2>Last 14 days</h2><div class="bars" id="bars"></div><p class="hint">Blue: emails sent. Green: replies. From the Smartlead webhook.</p></div>
<div class="card"><h2>Campaigns</h2><div id="campCards"></div></div>
<details class="card"><summary><b>Setup checks</b></summary><div id="checks" style="margin-top:8px"></div><h3>Sending mailboxes</h3><div class="table-wrap" id="mailboxes"></div></details>
</section>

<section id="v-replies" hidden>
<div class="card"><div class="row"><h2 class="grow" style="margin:0">Waiting for a reply</h2><button class="small" id="repRefresh">Refresh</button></div><div id="repList"><div class="empty">Loading…</div></div></div>
</section>

<section id="v-chats" hidden>
<div class="card"><div class="row" style="margin-bottom:6px"><h2 class="grow" style="margin:0">Conversations</h2><button class="small" id="chatRefresh">Refresh</button></div>
<p class="muted tiny" style="margin:0 0 6px">Only threads where the lead wrote back.</p>
<input id="chatSearch" placeholder="Search company or email" style="width:100%;margin-bottom:6px"><div id="chatList"><div class="empty">Loading…</div></div>
<div class="row" style="margin-top:10px"><input id="threadEmail" class="grow" placeholder="Open any lead by email"><button id="threadGo" class="small">Open</button></div></div>
</section>

<section id="v-reply" hidden>
<div class="row" style="margin-bottom:10px"><button class="small" id="rBack">‹ Back</button><span class="grow"></span><span class="muted tiny" id="rPos"></span><button class="small" id="rPrev">‹</button><button class="small" id="rNext">›</button></div>
<div id="rBody"><div class="empty">Loading…</div></div>
</section>

<section id="v-campaigns" hidden>
<div class="card"><div class="row" style="margin-bottom:8px"><h2 class="grow" style="margin:0">Campaigns</h2><button class="primary small" id="newCampaign">New</button></div>
<div class="table-wrap"><table><thead><tr><th>Name</th><th>Status</th><th class="num">Leads</th><th class="num">Sent</th><th class="num">Replied</th></tr></thead><tbody id="campRows"><tr><td colspan="5" class="empty">Loading…</td></tr></tbody></table></div></div>
<div class="card" id="campDetail" hidden>
<div class="row" style="margin-bottom:6px"><h2 style="margin:0" class="grow" id="cdName"></h2><span id="cdStatus"></span></div>
<div class="row" style="margin-bottom:6px"><button id="cdStart" class="go small">Start</button><button id="cdPause" class="small">Pause</button><button id="cdStop" class="small">Stop</button><button id="cdDelete" class="danger small">Delete</button></div>
<p class="muted small" id="cdStats"></p>
<h3>Emails</h3><div id="steps"></div><button id="addStep" class="small">+ Follow-up</button>
<p class="hint">Plain text. Blank lines make paragraphs. Fields: <code>{{company_name}}</code> <code>{{first_name}}</code> <code>{{category}}</code> <code>{{role}}</code>. Most leads are company inboxes with no person name, so lead with <code>{{company_name}}</code>. An empty follow-up subject replies in the same thread.</p>
<h3>Schedule</h3>
<div class="row"><input id="tz" value="Asia/Kuala_Lumpur" class="grow"><input id="startH" type="time" value="09:00"><span class="muted">to</span><input id="endH" type="time" value="17:00"></div>
<div class="row" style="margin-top:8px"><label class="small muted">Minutes apart</label><input id="gap" type="number" min="3" value="10" style="width:80px"><label class="small muted">New per day</label><input id="perDay" type="number" min="1" value="15" style="width:80px"></div>
<div class="days" id="days" style="margin-top:8px"></div>
<h3>Send from</h3><div id="campBoxes" class="small"></div>
<div class="row" style="margin-top:14px"><button class="primary" id="saveCampaign">Save campaign</button><span class="muted small" id="saveNote"></span></div>
<div id="campExtra">
<h3>Test email</h3><div class="row"><input id="testTo" class="grow" placeholder="you@yourcompany.com"><select id="testSeq"></select><button id="sendTest" class="small">Send test</button></div>
<h3>Leads in this campaign</h3><div class="table-wrap"><table><thead><tr><th>Company</th><th>Email</th><th>Status</th><th></th></tr></thead><tbody id="campLeads"></tbody></table></div>
<div class="row" style="margin-top:10px"><button id="clPrev" class="small">Previous</button><button id="clNext" class="small">Next</button><span class="muted small" id="clPage"></span></div>
</div></div>
</section>

<section id="v-leads" hidden>
<div class="card">
<input id="leadSearch" placeholder="Search company, email or person" style="width:100%;margin-bottom:8px">
<div class="row"><select id="leadSource" class="grow"><option value="all">All sources</option><option value="research">Contact research</option><option value="website">Website</option><option value="person">Has a person name</option></select>
<select id="leadStatus" class="grow"><option value="new">Not in a campaign yet</option><option value="pushed">In a campaign</option><option value="replied">Replied</option><option value="stopped">Bounced or unsubscribed</option><option value="all">All</option></select></div>
<div class="row" style="margin-top:8px"><span class="muted small grow" id="leadCount"></span></div>
<div class="row" style="margin-top:8px"><select id="pushCampaign" class="grow"><option value="">Choose a campaign…</option></select></div>
<div class="row" style="margin-top:8px"><button id="pushSelected" class="grow" disabled>Add selected</button><button id="pushAll" class="primary grow" disabled>Add all matching</button></div>
</div>
<div class="card"><div class="table-wrap"><table><thead><tr><th><input type="checkbox" id="checkAll"></th><th>Company</th><th>Email</th><th>Campaigns</th></tr></thead><tbody id="leadRows"><tr><td colspan="4" class="empty">Loading…</td></tr></tbody></table></div>
<div class="row" style="margin-top:10px"><button id="leadPrev" class="small">Previous</button><button id="leadNext" class="small">Next</button><span class="muted small" id="leadPage"></span></div></div>
</section>
</div>
<script>
(function(){
  var $=function(id){return document.getElementById(id)};
  var esc=function(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})};
  var num=function(n){return Number(n||0).toLocaleString()};
  var pct=function(r){return r==null?'—':(r*100).toFixed(r<0.1?1:0)+'%'};
  var when=function(iso){if(!iso)return '';var d=new Date(iso);if(isNaN(d))return esc(iso);return d.toLocaleDateString(undefined,{month:'short',day:'numeric'})+' '+d.toLocaleTimeString(undefined,{hour:'2-digit',minute:'2-digit'})};
  var ago=function(iso){if(!iso)return '';var s=(Date.now()-new Date(iso).getTime())/1000;if(isNaN(s))return '';if(s<3600)return Math.max(1,Math.round(s/60))+'m';if(s<86400)return Math.round(s/3600)+'h';return Math.round(s/86400)+'d'};
  var token=function(){try{return localStorage.getItem('labToken')||''}catch(e){return ''}};
  var DAYS=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  var S={status:null,campaigns:[],cats:[],convos:[],queue:[],leadOffset:0,leadTotal:0,leadRows:[],picked:{},camp:null,clOffset:0,reply:null};

  function show(id,text){var el=$(id);el.textContent=text||'';el.className='msg '+(id==='error'?'error':'info')+(text?' show':'');if(text)window.scrollTo({top:0,behavior:'smooth'})}
  function api(path,opts){
    opts=opts||{};
    var h={authorization:'Bearer '+token()};if(opts.body)h['content-type']='application/json';
    return fetch(path,{method:opts.method||'GET',headers:h,body:opts.body?JSON.stringify(opts.body):undefined}).then(function(r){
      return r.json().catch(function(){return {}}).then(function(j){
        if(r.status===401){$('tokenCard').hidden=false;throw new Error('Enter the LAB_TOKEN to use this page.')}
        if(!r.ok)throw new Error(j.error||('HTTP '+r.status));return j});
    });
  }
  function fail(e){show('error',e.message||String(e))}
  function catName(id){if(id==null)return '';for(var i=0;i<S.cats.length;i++)if(S.cats[i].id==id)return S.cats[i].name;return '#'+id}
  function statusPill(s){s=String(s||'').toUpperCase();var cls=s==='ACTIVE'||s==='INPROGRESS'?'ok':s==='PAUSED'||s==='DRAFTED'||s==='STARTED'?'warn':s==='STOPPED'||s==='BLOCKED'?'bad':'';return '<span class="pill '+cls+'">'+esc(s||'—')+'</span>'}
  function replyHref(c){return '#reply/'+c.campaign_id+'/'+encodeURIComponent(c.email)}
  document.querySelector('details.site').addEventListener('toggle',function(){$('siteNav').hidden=!this.open});

  // ---- routing ----
  var VIEWS=['dashboard','replies','chats','reply','campaigns','leads'];
  function route(){
    show('error');show('info');
    var h=location.hash.replace(/^#/,'')||'dashboard';var parts=h.split('/');var v=VIEWS.indexOf(parts[0])>=0?parts[0]:'dashboard';
    VIEWS.forEach(function(x){$('v-'+x).hidden=x!==v});
    var tab=v==='reply'?'replies':v;
    document.querySelectorAll('#tabs a').forEach(function(a){if(a.dataset.view===tab)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current')});
    if(v==='dashboard')loadDashboard();
    if(v==='replies')loadConvos().then(renderQueue);
    if(v==='chats')loadConvos().then(renderChats);
    if(v==='reply')openReply(Number(parts[1])||null,decodeURIComponent(parts.slice(2).join('/')));
    if(v==='campaigns')loadStatus().then(renderCampaigns);
    if(v==='leads'){loadStatus();if(!S.leadRows.length)loadLeads()}
    window.scrollTo(0,0);
  }
  window.addEventListener('hashchange',route);

  // ---- dashboard ----
  function tile(n,v,s){return '<div class="tile"><div class="n">'+esc(n)+'</div><div class="v">'+v+'</div>'+(s?'<div class="s">'+s+'</div>':'')+'</div>'}
  function loadDashboard(){
    return api('/api/email-marketing/dashboard').then(function(d){
      var L=d.leads,G=d.sending;
      setBadge(d.replies.waiting);
      $('waitN').textContent=num(d.replies.waiting);$('waitSub').textContent=num(d.replies.total)+' conversations in all'+(d.model?' · drafts by '+d.model:'');
      $('leadTiles').innerHTML=tile('Lead emails',num(L.emails),num(L.companies)+' companies')+tile('In a campaign',num(L.in_campaign))+tile('Not yet emailed',num(L.not_yet))+tile('Replied',num(G.replied));
      $('sendTiles').innerHTML=tile('Sent',num(G.sent),num(G.sent_today)+' today of '+num(G.daily_capacity)+' a day')+tile('Opened',num(G.opened),pct(G.open_rate))+tile('Replied',num(G.replied),pct(G.reply_rate))+tile('Interested',num(G.interested))+
        tile('Bounced',num(G.bounced),pct(G.bounce_rate))+tile('Unsubscribed',num(G.unsubscribed))+tile('Campaigns',num(G.campaigns),num(G.active)+' sending')+tile('Mailboxes',num(G.mailboxes));
      $('sendNote').textContent=G.bounce_rate!=null&&G.bounce_rate>0.03?'Bounce rate is over 3%: pause and clean the list before it hurts the mailbox.':'';
      var max=Math.max.apply(null,d.daily.map(function(x){return x.sent}).concat([1]));
      $('bars').innerHTML=d.daily.map(function(x){var dt=new Date(x.day+'T00:00:00');return '<div class="b"><span class="muted">'+dt.toLocaleDateString(undefined,{day:'numeric',month:'short'})+'</span><span class="t"><i style="width:'+(x.sent*100/max)+'%"></i><i class="r" style="width:'+(x.replied*100/max)+'%"></i></span><span class="tiny">'+num(x.sent)+(x.replied?' · <b class="ok">'+num(x.replied)+'</b>':'')+'</span></div>'}).reverse().join('');
      $('campCards').innerHTML=d.campaigns.length?d.campaigns.map(function(c){return '<a class="item" href="#campaigns" data-camp="'+c.id+'"><div class="top"><span class="who">'+esc(c.name)+'</span>'+statusPill(c.status)+'</div><div class="sub">'+num(c.leads)+' leads · '+num(c.sent)+' sent · '+num(c.opened)+' opened · '+num(c.replied)+' replied · '+num(c.bounced)+' bounced</div></a>'}).join(''):'<div class="empty">No campaigns yet. Campaigns → New.</div>';
    }).then(loadStatus).then(renderChecks).catch(fail);
  }
  $('campCards').addEventListener('click',function(e){var a=e.target.closest('[data-camp]');if(a){S.openCamp=Number(a.dataset.camp)}});
  function setBadge(n){$('badge').hidden=!n;$('badge').textContent=n>99?'99+':String(n)}
  function loadStatus(){
    return Promise.all([api('/api/email-marketing/status'),api('/api/email-marketing/campaigns').catch(function(){return {campaigns:[]}})]).then(function(r){
      S.status=r[0];S.cats=r[0].categories||[];S.campaigns=r[1].campaigns||[];fillCampaignSelects();
    });
  }
  function renderChecks(){
    var st=S.status||{},boxes=st.mailboxes||[],w=st.webhook;
    var check=function(ok,t,d){return '<div class="check"><b class="'+(ok?'ok':'bad')+'">'+(ok?'✓':'✕')+'</b><div>'+t+(d?'<div class="muted tiny">'+d+'</div>':'')+'</div></div>'};
    var active=S.campaigns.filter(function(c){return c.status==='ACTIVE'}).length;
    $('checks').innerHTML=check(st.configured,'Smartlead connected')+
      check(boxes.length>0,boxes.length+' sending mailbox'+(boxes.length===1?'':'es'),boxes.length?'':'Connect one in Smartlead → Email Accounts.')+
      check(S.campaigns.length>0,S.campaigns.length+' campaign'+(S.campaigns.length===1?'':'s'))+
      check(active>0,active+' sending',active?'':'Open a campaign and press Start.')+
      (w?check(w.ready&&!(w.errors||[]).length,'Webhook on '+num(w.with_webhook)+' of '+num(w.campaigns)+' campaigns',(w.errors||[]).length?w.errors.join('; '):(w.last_event_at?'Last event '+when(w.last_event_at):'No event yet.')):'');
    $('mailboxes').innerHTML=boxes.length?'<table><thead><tr><th>Mailbox</th><th class="num">Per day</th><th class="num">Today</th><th>Status</th></tr></thead><tbody>'+boxes.map(function(m){return '<tr><td>'+esc(m.email)+'<div class="muted tiny">'+esc(m.name||'')+' · '+esc(m.type||'')+'</div></td><td class="num">'+esc(m.daily_limit)+'</td><td class="num">'+esc(m.sent_today)+'</td><td>'+(m.smtp_ok===false||m.imap_ok===false?'<span class="pill bad">failing</span>':'<span class="pill ok">ok</span>')+'</td></tr>'}).join('')+'</tbody></table>':'<div class="empty">No mailbox yet.</div>';
  }

  // ---- conversations ----
  function loadConvos(){
    return api('/api/email-marketing/conversations').then(function(r){S.convos=r.rows||[];S.queue=S.convos.filter(function(c){return c.needs_reply});setBadge(r.waiting);return S.convos}).catch(function(e){fail(e);return []});
  }
  function draftPill(c){
    if(c.answered_at&&!c.needs_reply)return '<span class="pill ok">answered</span>';
    if(c.draft_status==='dismissed')return '<span class="pill">no reply needed</span>';
    if(c.draft_status==='ready')return '<span class="pill blue">draft ready</span>';
    if(c.draft_status==='drafting')return '<span class="pill warn">writing…</span>';
    if(c.draft_status==='failed')return '<span class="pill bad">draft failed</span>';
    return '<span class="pill warn">waiting</span>';
  }
  function itemHtml(c){return '<a class="item" href="'+replyHref(c)+'"><div class="top"><span class="who">'+esc(c.company||c.email)+'</span><span class="when">'+ago(c.replied_at)+'</span></div><div class="sub">'+esc(c.email)+' · '+esc(c.campaign_name||'')+'</div><div class="pre">'+esc(c.preview||'')+'</div><div style="margin-top:4px">'+draftPill(c)+'</div></a>'}
  function renderQueue(){$('repList').innerHTML=S.queue.length?S.queue.map(itemHtml).join(''):'<div class="empty">Nothing waiting. Every reply has an answer.</div>'}
  function renderChats(){
    var q=$('chatSearch').value.trim().toLowerCase();
    var rows=S.convos.filter(function(c){return !q||(c.email+' '+(c.company||'')).toLowerCase().indexOf(q)>=0});
    $('chatList').innerHTML=rows.length?rows.map(itemHtml).join(''):'<div class="empty">'+(S.convos.length?'No match.':'No lead has replied yet.')+'</div>';
  }
  $('chatSearch').oninput=renderChats;
  $('repRefresh').onclick=function(){loadConvos().then(renderQueue)};
  $('chatRefresh').onclick=function(){loadConvos().then(renderChats)};
  $('threadGo').onclick=function(){var em=$('threadEmail').value.trim().toLowerCase();if(em)location.hash='#reply/0/'+encodeURIComponent(em)};

  // ---- one reply ----
  function neighbours(campaignId,email){
    var list=S.queue.length?S.queue:S.convos;var i=-1;
    for(var k=0;k<list.length;k++)if(list[k].email===email&&(!campaignId||list[k].campaign_id===campaignId)){i=k;break}
    return {list:list,i:i};
  }
  function openReply(campaignId,email){
    S.reply={campaignId:campaignId,email:email};
    var go=function(){
      var n=neighbours(campaignId,email);
      $('rPos').textContent=n.i>=0?(n.i+1)+' of '+n.list.length:'';
      $('rPrev').disabled=n.i<=0;$('rNext').disabled=n.i<0||n.i>=n.list.length-1;
      $('rPrev').onclick=function(){if(n.i>0)location.hash=replyHref(n.list[n.i-1])};
      $('rNext').onclick=function(){if(n.i>=0&&n.i<n.list.length-1)location.hash=replyHref(n.list[n.i+1])};
    };
    (S.convos.length?Promise.resolve():loadConvos()).then(go);
    $('rBody').innerHTML='<div class="empty">Loading the conversation with '+esc(email)+'…</div>';
    api('/api/email-marketing/response?email='+encodeURIComponent(email)+(campaignId?'&campaign_id='+campaignId:'')).then(function(r){
      if(S.reply.email!==email)return;
      S.reply.data=r;renderReply();
      if(r.target&&!r.draft&&!r.drafting)writeDraft(null);
      else if(r.drafting||(r.draft&&r.draft.status==='drafting'))setTimeout(function(){if(S.reply.email===email)openReply(campaignId,email)},4000);
    }).catch(function(e){$('rBody').innerHTML='<div class="card"><div class="empty bad">'+esc(e.message)+'</div></div>'});
  }
  function renderReply(){
    var r=S.reply.data,L=r.lead,t=r.thread,msgs=t.messages||[],target=r.target,d=r.draft;
    var company=(r.company&&r.company.name)||L.company_name||L.email;
    var earlier=msgs.filter(function(m){return m!==target&&!(target&&m.time===target.time&&m.inbound)});
    var html='<div class="card"><h2 style="margin-bottom:2px">'+esc(company)+'</h2><div class="muted small">'+esc(L.email)+(r.company&&r.company.category?' · '+esc(r.company.category):'')+'</div><div class="muted tiny">'+esc(t.campaign_name||'')+(L.unsubscribed?' · <span class="bad">unsubscribed</span>':'')+'</div>'+
      '<div class="row" style="margin-top:8px"><select id="rCat" class="grow"><option value="">No category</option>'+S.cats.map(function(c){return '<option value="'+c.id+'"'+(c.id==t.category_id?' selected':'')+'>'+esc(c.name)+'</option>'}).join('')+'</select></div></div>';
    if(target){
      html+='<div class="card" style="border-color:#2f4a7a"><div class="muted tiny" style="margin-bottom:6px">↙ Their reply · '+when(target.time)+(target.subject?' · '+esc(target.subject):'')+'</div><div class="their">'+esc(target.body)+'</div></div>';
    }else html+='<div class="card"><div class="empty">They have not replied in this campaign yet.</div></div>';
    if(earlier.length)html+='<details class="card"><summary class="small"><b>Earlier in the thread</b> ('+earlier.length+')</summary><div style="margin-top:10px">'+earlier.map(function(m){return '<div class="bubble'+(m.inbound?' in':'')+'"><div class="meta">'+(m.inbound?'↙ Them':'↗ Us')+(m.seq?' · email '+esc(m.seq):'')+' · '+when(m.time)+(m.subject?'<br><b>'+esc(m.subject)+'</b>':'')+'</div>'+esc(m.body)+'</div>'}).join('')+'</div></details>';
    if(target){
      var sent=d&&d.status==='sent';
      html+='<div class="card"><div class="row" style="margin-bottom:6px"><h2 class="grow" style="margin:0">'+(sent?'Sent':'Our reply')+'</h2><span class="muted tiny" id="rDraftNote"></span></div>';
      if(sent)html+='<div class="bubble">'+esc(d.sent_body)+'</div><div class="muted tiny">Sent '+when(d.sent_at)+'</div>';
      else{
        html+='<textarea id="rText" placeholder="Writing the reply…"'+(d&&d.status==='drafting'?' disabled':'')+'>'+esc(d&&d.draft||'')+'</textarea>'+
          (d&&d.status==='failed'?'<p class="bad tiny">The draft failed: '+esc(d.error)+'. Write it yourself or tap Rewrite.</p>':'')+
          (d&&d.status==='dismissed'?'<p class="muted tiny">Marked as needing no reply. You can still send one.</p>':'')+
          '<div class="row" style="margin-top:8px"><input id="rHint" class="grow" placeholder="Rewrite with a note, e.g. shorter, in Malay, ask for the bill"><button class="small" id="rRewrite">Rewrite</button></div>'+
          '<div class="sticky"><button class="go block" id="rSend">Approve &amp; send</button><div class="row" style="margin-top:6px"><button class="small grow" id="rDismiss">No reply needed</button></div></div>';
      }
      html+='</div>';
    }
    $('rBody').innerHTML=html;
    var note=$('rDraftNote');
    if(note&&d&&!sent)note.textContent=d.status==='drafting'?'writing with '+(d.model||r.model||'deepseek')+'…':(d.model?'drafted by '+d.model+' · '+when(d.updated_at):'');
    if(note&&!d&&target)note.textContent='writing with '+(r.model||'deepseek')+'…';
    $('rCat').onchange=function(){api('/api/email-marketing/campaigns/'+t.campaign_id+'/leads/'+L.id+'/category',{method:'POST',body:{category_id:this.value||null}}).then(function(){show('info','Category saved.')}).catch(fail)};
    if($('rRewrite'))$('rRewrite').onclick=function(){writeDraft($('rHint').value.trim()||null)};
    if($('rSend'))$('rSend').onclick=sendReply;
    if($('rDismiss'))$('rDismiss').onclick=dismissReply;
  }
  function writeDraft(hint){
    var R=S.reply,r=R.data;if(!r)return;
    if($('rText')){$('rText').disabled=true;$('rText').value='';$('rText').placeholder='Writing the reply…'}
    if($('rDraftNote'))$('rDraftNote').textContent='writing with '+(r.model||'deepseek')+'…';
    if($('rSend'))$('rSend').disabled=true;
    api('/api/email-marketing/drafts',{method:'POST',body:{email:R.email,campaign_id:r.thread.campaign_id,instruction:hint}}).then(function(x){
      if(S.reply!==R)return;r.draft=x.draft;renderReply();
    }).catch(function(e){if(S.reply!==R)return;fail(e);renderReply()});
  }
  function sendReply(){
    var R=S.reply,r=R.data,d=r.draft,text=$('rText').value.trim();
    if(!text)return show('error','The reply is empty.');
    if(!d)return show('error','Wait for the draft, or tap Rewrite.');
    if(!confirm('Send this reply to '+R.email+'?'))return;
    $('rSend').disabled=true;$('rSend').textContent='Sending…';
    api('/api/email-marketing/drafts/'+d.id+'/send',{method:'POST',body:{body:text}}).then(function(){
      show('info','Sent to '+R.email+'.');nextAfter(R);
    }).catch(function(e){fail(e);$('rSend').disabled=false;$('rSend').textContent='Approve & send'});
  }
  function dismissReply(){
    var R=S.reply,d=R.data.draft;if(!d)return show('error','Wait for the draft first.');
    api('/api/email-marketing/drafts/'+d.id+'/dismiss',{method:'POST',body:{}}).then(function(){nextAfter(R)}).catch(fail);
  }
  function nextAfter(R){
    var n=neighbours(R.campaignId||R.data.thread.campaign_id,R.email);
    loadConvos().then(function(){
      var next=S.queue.filter(function(c){return c.email!==R.email})[Math.max(0,n.i)]||S.queue.filter(function(c){return c.email!==R.email})[0];
      location.hash=next?replyHref(next):'#replies';
    });
  }

  // ---- campaigns ----
  function renderCampaigns(){
    $('campRows').innerHTML=S.campaigns.length?S.campaigns.map(function(c){return '<tr class="click" data-id="'+c.id+'"><td>'+esc(c.name)+'</td><td>'+statusPill(c.status)+'</td><td class="num">'+num(c.leads)+'</td><td class="num">'+num(c.sent)+'</td><td class="num">'+num(c.replied)+'</td></tr>'}).join(''):'<tr><td colspan="5" class="empty">No campaigns yet.</td></tr>';
    if(S.openCamp){var id=S.openCamp;S.openCamp=null;openCampaign(id)}
  }
  function fillCampaignSelects(){
    var keep=$('pushCampaign').value;
    $('pushCampaign').innerHTML='<option value="">Choose a campaign…</option>'+S.campaigns.map(function(c){return '<option value="'+c.id+'">'+esc(c.name)+' ('+esc(c.status)+')</option>'}).join('');$('pushCampaign').value=keep;syncPush();
  }
  $('campRows').onclick=function(e){var tr=e.target.closest('tr[data-id]');if(tr)openCampaign(Number(tr.dataset.id))};
  function stepHtml(s,i){
    return '<div class="step" data-i="'+i+'"><div class="row"><b class="small">'+(i===0?'Email 1':'Follow-up '+i)+'</b>'+(i>0?'<span class="small muted">wait</span><input type="number" min="1" class="delay" value="'+(s.delay_days||3)+'" style="width:70px"><span class="small muted">days</span>':'')+'<span class="grow"></span>'+(i>0?'<button class="small danger rm">Remove</button>':'')+'</div>'+
      '<input class="subj" style="width:100%;margin-bottom:8px" placeholder="'+(i===0?'Subject':'Subject (empty = same thread)')+'" value="'+esc(s.subject||'')+'"><textarea class="body" style="min-height:160px" placeholder="Hi {{company_name}} team,">'+esc(s.body||'')+'</textarea></div>';
  }
  function renderSteps(steps){$('steps').innerHTML=steps.map(stepHtml).join('');$('testSeq').innerHTML=steps.map(function(_,i){return '<option value="'+(i+1)+'">Email '+(i+1)+'</option>'}).join('')}
  function readSteps(){return Array.prototype.map.call(document.querySelectorAll('#steps .step'),function(el,i){return {subject:el.querySelector('.subj').value,body:el.querySelector('.body').value,delay_days:i?Number(el.querySelector('.delay').value)||1:0}})}
  $('steps').onclick=function(e){if(e.target.classList.contains('rm')){var st=readSteps();st.splice(Number(e.target.closest('.step').dataset.i),1);renderSteps(st)}};
  $('addStep').onclick=function(){var st=readSteps();st.push({subject:'',body:'',delay_days:3});renderSteps(st)};
  function renderDays(days){$('days').innerHTML=DAYS.map(function(d,i){return '<label><input type="checkbox" value="'+i+'"'+(days.indexOf(i)>=0?' checked':'')+'>'+d+'</label>'}).join('')}
  function renderBoxes(chosen){var boxes=(S.status&&S.status.mailboxes)||[];$('campBoxes').innerHTML=boxes.length?boxes.map(function(m){return '<label style="display:block;padding:4px 0"><input type="checkbox" value="'+m.id+'"'+(chosen.indexOf(m.id)>=0?' checked':'')+'> '+esc(m.email)+'</label>'}).join(''):'<span class="warn">No mailbox connected in Smartlead yet.</span>'}
  function editorBody(){
    return {name:$('cdName').dataset.name,steps:readSteps(),
      schedule:{timezone:$('tz').value.trim(),days:Array.prototype.map.call(document.querySelectorAll('#days input:checked'),function(i){return Number(i.value)}),start_hour:$('startH').value,end_hour:$('endH').value,min_gap_minutes:Number($('gap').value),max_new_per_day:Number($('perDay').value)},
      mailbox_ids:Array.prototype.map.call(document.querySelectorAll('#campBoxes input:checked'),function(i){return Number(i.value)})};
  }
  $('newCampaign').onclick=function(){
    var name=prompt('Campaign name','Solar for '+new Date().toLocaleDateString(undefined,{month:'short',year:'numeric'}));if(!name)return;
    S.camp={id:null};$('campDetail').hidden=false;$('campExtra').hidden=true;
    $('cdName').textContent=name;$('cdName').dataset.name=name;$('cdStatus').innerHTML=statusPill('NEW');$('cdStats').textContent='Not saved yet.';
    ['cdStart','cdPause','cdStop','cdDelete'].forEach(function(b){$(b).hidden=true});
    var boxes=(S.status&&S.status.mailboxes)||[];
    renderSteps([{subject:'',body:'',delay_days:0},{subject:'',body:'',delay_days:3}]);renderDays([1,2,3,4,5]);renderBoxes(boxes.map(function(m){return m.id}));
    $('campDetail').scrollIntoView({behavior:'smooth'});
  };
  function openCampaign(id){
    show('error');$('campDetail').hidden=false;$('cdName').textContent='Loading…';
    return api('/api/email-marketing/campaigns/'+id).then(function(r){
      var c=r.campaign;S.camp={id:id,data:r};S.clOffset=0;
      $('cdName').textContent=c.name;$('cdName').dataset.name=c.name;$('cdStatus').innerHTML=statusPill(c.status);
      $('cdStats').textContent=num(c.leads)+' leads · '+num(c.not_started)+' not started · '+num(c.sent)+' sent · '+num(c.opened)+' opened · '+num(c.replied)+' replied · '+num(c.bounced)+' bounced · '+num(c.unsubscribed)+' unsubscribed';
      ['cdStart','cdPause','cdStop','cdDelete'].forEach(function(b){$(b).hidden=false});
      $('cdStart').textContent=c.status==='PAUSED'?'Resume':'Start';
      renderSteps(r.steps.length?r.steps:[{subject:'',body:'',delay_days:0}]);
      var sc=r.schedule||{};$('tz').value=sc.timezone||'Asia/Kuala_Lumpur';$('startH').value=sc.start_hour||'09:00';$('endH').value=sc.end_hour||'17:00';$('gap').value=sc.min_gap_minutes||10;$('perDay').value=sc.max_new_per_day||15;
      renderDays(sc.days&&sc.days.length?sc.days:[1,2,3,4,5]);renderBoxes((r.mailboxes||[]).map(function(m){return m.id}));
      $('campExtra').hidden=false;loadCampLeads();$('campDetail').scrollIntoView({behavior:'smooth'});
    }).catch(fail);
  }
  $('saveCampaign').onclick=function(){
    var body=editorBody();if(!body.steps[0]||!body.steps[0].subject.trim()||!body.steps[0].body.trim())return show('error','Email 1 needs a subject and a body.');
    $('saveCampaign').disabled=true;$('saveNote').textContent='Saving…';
    var call=S.camp&&S.camp.id?api('/api/email-marketing/campaigns/'+S.camp.id+'/setup',{method:'POST',body:body}):api('/api/email-marketing/campaigns',{method:'POST',body:body});
    call.then(function(r){
      if(r.errors&&r.errors.length)show('error','Saved, with problems:\n'+r.errors.join('\n'));else show('info','Campaign saved.');
      return loadStatus().then(renderCampaigns).then(function(){return openCampaign(r.id)});
    }).catch(fail).then(function(){$('saveCampaign').disabled=false;$('saveNote').textContent=''});
  };
  function setStatus(st,label,done){
    if(!S.camp||!S.camp.id||!confirm(label+' "'+$('cdName').dataset.name+'"?'))return;
    api('/api/email-marketing/campaigns/'+S.camp.id+'/status',{method:'POST',body:{status:st}}).then(function(){show('info','Campaign '+done+'.');return loadStatus().then(renderCampaigns).then(function(){return openCampaign(S.camp.id)})}).catch(fail);
  }
  $('cdStart').onclick=function(){setStatus('START',this.textContent,'started: Smartlead sends inside the schedule')};
  $('cdPause').onclick=function(){setStatus('PAUSED','Pause','paused')};
  $('cdStop').onclick=function(){setStatus('STOPPED','Stop','stopped')};
  $('cdDelete').onclick=function(){
    if(!S.camp||!S.camp.id||!confirm('Delete "'+$('cdName').dataset.name+'" in Smartlead? Its leads and stats there go with it.'))return;
    api('/api/email-marketing/campaigns/'+S.camp.id,{method:'DELETE'}).then(function(){show('info','Campaign deleted.');$('campDetail').hidden=true;S.camp=null;return loadStatus().then(renderCampaigns)}).catch(fail);
  };
  $('sendTest').onclick=function(){
    var to=$('testTo').value.trim();if(!to)return;
    api('/api/email-marketing/campaigns/'+S.camp.id+'/test',{method:'POST',body:{email:to,sequence:Number($('testSeq').value)||1}}).then(function(r){show('info','Test email '+$('testSeq').value+' sent to '+r.to+', filled in as '+r.as_lead+'.')}).catch(fail);
  };
  function loadCampLeads(){
    if(!S.camp||!S.camp.id)return;
    $('campLeads').innerHTML='<tr><td colspan="4" class="empty">Loading…</td></tr>';
    api('/api/email-marketing/campaigns/'+S.camp.id+'/leads?limit=50&offset='+S.clOffset).then(function(r){
      $('campLeads').innerHTML=r.rows.length?r.rows.map(function(l){
        var paused=String(l.status).toUpperCase()==='PAUSED';
        return '<tr><td>'+esc(l.company||'')+'</td><td><a href="#reply/'+S.camp.id+'/'+encodeURIComponent(l.email)+'">'+esc(l.email)+'</a></td><td>'+statusPill(l.status)+(l.category_id?'<span class="pill">'+esc(catName(l.category_id))+'</span>':'')+'</td>'+
          '<td><button class="small" data-lead="'+l.lead_id+'" data-act="'+(paused?'resume':'pause')+'">'+(paused?'Resume':'Pause')+'</button></td></tr>'}).join(''):'<tr><td colspan="4" class="empty">No leads yet. Add them from Leads.</td></tr>';
      var end=Math.min(S.clOffset+50,r.total);$('clPage').textContent=r.total?(S.clOffset+1)+'–'+end+' of '+num(r.total):'';
      $('clPrev').disabled=S.clOffset===0;$('clNext').disabled=end>=r.total;
    }).catch(fail);
  }
  $('campLeads').onclick=function(e){var lid=e.target.dataset.lead;if(lid)api('/api/email-marketing/campaigns/'+S.camp.id+'/leads/'+lid+'/'+e.target.dataset.act,{method:'POST',body:{}}).then(loadCampLeads).catch(fail)};
  $('clPrev').onclick=function(){S.clOffset=Math.max(0,S.clOffset-50);loadCampLeads()};
  $('clNext').onclick=function(){S.clOffset+=50;loadCampLeads()};

  // ---- leads ----
  var LIMIT=100;
  function leadQuery(){return 'search='+encodeURIComponent($('leadSearch').value.trim())+'&source='+$('leadSource').value+'&status='+$('leadStatus').value}
  function loadLeads(){
    $('leadRows').innerHTML='<tr><td colspan="4" class="empty">Loading…</td></tr>';
    return api('/api/email-marketing/leads?limit='+LIMIT+'&offset='+S.leadOffset+'&'+leadQuery()).then(function(r){
      S.leadRows=r.rows||[];S.leadTotal=r.total||0;
      $('leadCount').textContent=num(S.leadTotal)+' matching';
      $('leadRows').innerHTML=S.leadRows.length?S.leadRows.map(function(x){
        return '<tr><td><input type="checkbox" data-key="'+esc(x.key)+'"'+(S.picked[x.key]?' checked':'')+'></td><td>'+esc(x.company_name)+'<div class="muted tiny">'+esc([x.category,x.person_name].filter(Boolean).join(' · '))+'</div></td><td>'+esc(x.email)+'</td><td>'+(x.campaigns.length?x.campaigns.map(function(c){
          var st=c.bounced_at?['bad','bounced']:c.unsubscribed_at?['bad','unsubscribed']:c.replied_at?['ok','replied']:c.opened_at?['warn','opened']:c.last_event==='EMAIL_SENT'?['','sent']:['','added'];
          return '<span class="pill '+st[0]+'">'+esc(c.name||('#'+c.id))+' · '+st[1]+'</span>'}).join(''):'<span class="muted tiny">none</span>')+'</td></tr>'}).join(''):'<tr><td colspan="4" class="empty">No lead emails match.</td></tr>';
      var end=Math.min(S.leadOffset+LIMIT,S.leadTotal);
      $('leadPage').textContent=S.leadTotal?(S.leadOffset+1)+'–'+end+' of '+num(S.leadTotal):'';
      $('leadPrev').disabled=S.leadOffset===0;$('leadNext').disabled=end>=S.leadTotal;$('checkAll').checked=false;syncPush();
    }).catch(fail);
  }
  function pickedKeys(){return Object.keys(S.picked).filter(function(k){return S.picked[k]})}
  function syncPush(){var c=$('pushCampaign').value;var n=pickedKeys().length;$('pushSelected').disabled=!c||!n;$('pushSelected').textContent='Add selected ('+n+')';$('pushAll').disabled=!c||!S.leadTotal;$('pushAll').textContent='Add all '+num(S.leadTotal)}
  $('leadRows').addEventListener('change',function(e){var k=e.target.dataset&&e.target.dataset.key;if(k){S.picked[k]=e.target.checked;syncPush()}});
  $('checkAll').onchange=function(){var on=this.checked;S.leadRows.forEach(function(x){S.picked[x.key]=on});document.querySelectorAll('#leadRows input[data-key]').forEach(function(i){i.checked=on});syncPush()};
  $('leadSearch').onkeydown=function(e){if(e.key==='Enter'){S.leadOffset=0;loadLeads()}};
  $('leadSource').onchange=$('leadStatus').onchange=function(){S.leadOffset=0;loadLeads()};
  $('leadPrev').onclick=function(){S.leadOffset=Math.max(0,S.leadOffset-LIMIT);loadLeads()};
  $('leadNext').onclick=function(){S.leadOffset+=LIMIT;loadLeads()};
  $('pushCampaign').onchange=syncPush;
  function pushLeads(body,label){
    var id=$('pushCampaign').value;if(!id)return;
    var name=$('pushCampaign').selectedOptions[0].textContent;
    if(!confirm('Add '+label+' to "'+name+'"?'))return;
    show('error');show('info','Adding '+label+' to Smartlead…');$('pushAll').disabled=$('pushSelected').disabled=true;
    api('/api/email-marketing/campaigns/'+id+'/leads',{method:'POST',body:body}).then(function(r){
      S.picked={};
      show('info','Sent '+num(r.sent)+' to "'+name+'": '+num(r.added)+' added, '+num(r.duplicates)+' already there, '+num(r.in_other_campaign)+' in another campaign, '+num(r.invalid)+' invalid, '+num(r.blocked)+' blocked.'+(r.do_not_email?' '+num(r.do_not_email)+' left out: bounced or unsubscribed before.':'')+(r.failed?'\n'+num(r.failed)+' failed: '+r.errors.join('; '):''));
      loadLeads();
    }).catch(function(e){fail(e);syncPush()});
  }
  $('pushSelected').onclick=function(){var k=pickedKeys();pushLeads({keys:k},k.length+' selected lead email'+(k.length===1?'':'s'))};
  $('pushAll').onclick=function(){pushLeads({all:true,search:$('leadSearch').value.trim(),source:$('leadSource').value,status:$('leadStatus').value},num(S.leadTotal)+' matching lead emails')};

  // ---- start ----
  $('saveToken').onclick=function(){try{localStorage.setItem('labToken',$('token').value.trim())}catch(e){}$('tokenCard').hidden=true;route()};
  if(!token())$('tokenCard').hidden=false;
  route();
  setInterval(function(){if(!document.hidden&&token())api('/api/email-marketing/conversations?filter=waiting').then(function(r){setBadge(r.waiting)}).catch(function(){})},120000);
})();
</script>
</body></html>`;
}
