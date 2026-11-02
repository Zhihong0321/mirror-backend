import { OPERATOR_NAV, navHtml } from './nav.ts';

/** Operator view over the broker's live worker registry. */
export function page(): string {
  return String.raw`<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark"><title>Workers · agy-lab</title>
<style>
:root{--bg:#0f1115;--card:#171a20;--ink:#e8eaed;--muted:#9aa3af;--line:#262b33;--ok:#4ade9f;--bad:#ff8b80;--warn:#f0c065;--accent:#7aa2f7;--cool:#c6a5ff}
*{box-sizing:border-box}body{margin:0;padding:28px 20px 64px;background:var(--bg);color:var(--ink);font:14px/1.55 ui-sans-serif,-apple-system,"Segoe UI",system-ui,sans-serif}.wrap{max-width:1180px;margin:0 auto}h1{font-size:24px;margin:0 0 4px;letter-spacing:-.02em}.sub{color:var(--muted);font-size:13px;margin:0 0 22px}.sitenav{display:flex;flex-wrap:wrap;gap:4px;margin:0 0 20px;padding-bottom:16px;border-bottom:1px solid var(--line)}.sitenav a{color:var(--muted);font-size:13px;font-weight:550;padding:5px 10px;border:1px solid transparent;border-radius:8px;text-decoration:none}.sitenav a:hover,.sitenav a[aria-current="page"]{color:var(--ink);background:#1e222a;border-color:var(--line)}.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px 18px;margin-bottom:16px}.row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}button,input{font:inherit;font-size:13px;border-radius:8px}button{font-weight:550;padding:7px 14px;border:1px solid var(--line);background:#1e222a;color:var(--ink);cursor:pointer}button:hover:not(:disabled){border-color:var(--muted)}button:disabled{opacity:.5;cursor:default}button.primary{background:var(--accent);border-color:var(--accent);color:#0f1115}input{background:#0f1115;color:var(--ink);border:1px solid var(--line);padding:7px 10px}.token{flex:1;min-width:240px}.hint{color:var(--muted);font-size:12px;margin:8px 0 0}.pill{display:inline-flex;align-items:center;gap:6px;font-size:11px;font-weight:650;padding:3px 9px;border-radius:999px;border:1px solid currentColor}.pill:before{content:"";width:6px;height:6px;border-radius:50%;background:currentColor}.online,.busy{color:var(--ok)}.offline,.error{color:var(--bad)}.cooldown,.idle{color:var(--warn)}.unknown{color:var(--muted)}.summary{display:grid;grid-template-columns:repeat(6,1fr);gap:10px;margin-bottom:16px}.metric{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:14px 15px}.metric strong{display:block;font-size:25px;line-height:1.1}.metric span{display:block;margin-top:7px;color:var(--muted);font-size:10px;font-weight:700;letter-spacing:.1em;text-transform:uppercase}.section-head{display:flex;align-items:baseline;justify-content:space-between;gap:12px;margin:0 0 12px}.section-head h2{font-size:12px;letter-spacing:.1em;text-transform:uppercase;color:var(--muted);margin:0}.updated{color:var(--muted);font:11px ui-monospace,Consolas,monospace}.table-wrap{overflow:auto}table{width:100%;border-collapse:collapse;min-width:820px}th{text-align:left;color:var(--muted);font-size:10px;letter-spacing:.08em;text-transform:uppercase;font-weight:650;padding:9px 10px;border-bottom:1px solid var(--line)}td{padding:12px 10px;border-bottom:1px solid var(--line);vertical-align:top}tr:last-child td{border-bottom:0}.worker-name{font-weight:650}.mono{font:12px ui-monospace,Consolas,monospace;word-break:break-word}.small{color:var(--muted);font-size:11px;margin-top:4px}.types{color:var(--muted);font-size:11px;max-width:240px}.empty{padding:24px;text-align:center;color:var(--muted)}.queue-row{display:grid;grid-template-columns:130px 1fr auto;gap:14px;align-items:center;padding:11px 0;border-top:1px solid var(--line)}.queue-row:first-child{border-top:0}.queue-type{color:var(--accent);font:650 10px ui-monospace,Consolas,monospace;word-break:break-word}.error-box{display:none;color:var(--bad);background:#28191c;border:1px solid #5c2a30;border-radius:8px;padding:10px 12px;margin-bottom:16px}.error-box.show{display:block}@media(max-width:820px){body{padding:20px 14px 44px}.summary{grid-template-columns:repeat(2,1fr)}.summary .metric:last-child{grid-column:1/-1}.queue-row{grid-template-columns:1fr auto;gap:5px}.queue-type{grid-column:1/-1}}
</style></head><body><div class="wrap">
<h1>Worker control room</h1><p class="sub">Live lanes, claimed work, and queue pressure from the in-memory job broker.</p>
<nav class="sitenav" aria-label="Site">${navHtml(OPERATOR_NAV, '/workers')}</nav>
<div class="card"><div class="row"><input id="token" class="token" type="password" placeholder="LAB_TOKEN" autocomplete="current-password"><button class="primary" id="saveButton">Save and refresh</button><button id="refreshButton">Refresh</button><span id="authState" class="pill unknown">no token</span></div><p class="hint">The token stays in this browser and is sent only to the protected worker snapshot endpoint.</p></div>
<div class="card"><div class="section-head"><h2>Gmap Local Worker for Windows</h2><span id="gmapWorkerStatus" class="updated"></span></div><p class="hint">Turns a Windows 10 or 11 PC into a Google Maps scan worker on its own internet line. Its scans are free: they do not use the scraper.tech budget. Unzip it, double-click <strong>Start Gmap Worker.cmd</strong>, then <strong>Enable autostart.cmd</strong> so it starts at every sign-in. It shows up below as <span class="mono">pc-&lt;computer name&gt;</span>. No browser and nothing to install: it reads Google Maps' own result pages, so it uses almost no memory. The zip holds a key that can only take Maps jobs; keep it inside the team.</p><div class="row" style="margin-top:10px"><button class="primary" id="gmapWorkerDownload">Download GmapWorker.zip</button></div></div>
<div class="card"><div class="section-head"><h2>Contact research keys</h2><span id="keyStatus" class="updated">not loaded</span></div><p class="hint">Step 1 searches the web. Each job runs its two general searches on Tavily or Exa, taking turns while both have credits, and one LinkedIn search on Exa. Step 2 reads the pages found and asks an extract model lane (below) to pull out people, phones and emails. Keys rotate; a Tavily key rests at its monthly limit, an Exa key rests for a day when Exa refuses it. Saved keys are shown in full: edit them in place, one key per line, then press Save keys. An empty box is left unchanged; use Clear to remove its keys.</p><label class="hint" for="tavilyKeys">Tavily Search API keys (tvly-...)</label><textarea id="tavilyKeys" rows="3" spellcheck="false" autocomplete="off" style="width:100%;margin:6px 0 10px;background:#0f1115;color:var(--ink);border:1px solid var(--line);border-radius:8px;padding:8px;font:12px ui-monospace,Consolas,monospace"></textarea><label class="hint" for="exaKeys">Exa API keys</label><textarea id="exaKeys" rows="3" spellcheck="false" autocomplete="off" style="width:100%;margin:6px 0 10px;background:#0f1115;color:var(--ink);border:1px solid var(--line);border-radius:8px;padding:8px;font:12px ui-monospace,Consolas,monospace"></textarea><label class="hint" for="braveKeys">Brave Search API keys (BSA...), used by company and deeper dives; a key Brave refuses with 429 or 402 hands the query to the next</label><textarea id="braveKeys" rows="3" spellcheck="false" autocomplete="off" style="width:100%;margin:6px 0 10px;background:#0f1115;color:var(--ink);border:1px solid var(--line);border-radius:8px;padding:8px;font:12px ui-monospace,Consolas,monospace"></textarea><div class="row"><button class="primary" id="saveKeys">Save keys</button><button id="copyTavily">Copy Tavily keys</button><button id="copyExa">Copy Exa keys</button><button id="clearTavily">Clear Tavily keys</button><button id="clearExa">Clear Exa keys</button><button id="clearBrave">Clear Brave keys</button></div></div><div class="card"><div class="section-head"><h2>Other API keys</h2><span id="secretStatus" class="updated">not loaded</span></div><p class="hint">One key per provider, kept in the hub database. A key saved here is used within a minute; a provider with no key saved here falls back to its Railway variable. Edit in place, then press Save keys. To remove a key, empty its box and save.</p><label class="hint" for="secret_minimax">MiniMax API key (the LLM used when every deepseek lane has failed, and the Pi worker)</label><textarea id="secret_minimax" data-secret="minimax" rows="1" spellcheck="false" autocomplete="off" style="width:100%;margin:6px 0 10px;background:#0f1115;color:var(--ink);border:1px solid var(--line);border-radius:8px;padding:8px;font:12px ui-monospace,Consolas,monospace"></textarea><label class="hint" for="secret_scraper_tech">scraper.tech key (Google Maps: lead sweeps, taman scans, dive-deeper maps)</label><textarea id="secret_scraper_tech" data-secret="scraper_tech" rows="1" spellcheck="false" autocomplete="off" style="width:100%;margin:6px 0 10px;background:#0f1115;color:var(--ink);border:1px solid var(--line);border-radius:8px;padding:8px;font:12px ui-monospace,Consolas,monospace"></textarea><label class="hint" for="secret_parallel">Parallel API key (person research)</label><textarea id="secret_parallel" data-secret="parallel" rows="1" spellcheck="false" autocomplete="off" style="width:100%;margin:6px 0 10px;background:#0f1115;color:var(--ink);border:1px solid var(--line);border-radius:8px;padding:8px;font:12px ui-monospace,Consolas,monospace"></textarea><label class="hint" for="secret_smartlead">Smartlead API key (cold email)</label><textarea id="secret_smartlead" data-secret="smartlead" rows="1" spellcheck="false" autocomplete="off" style="width:100%;margin:6px 0 10px;background:#0f1115;color:var(--ink);border:1px solid var(--line);border-radius:8px;padding:8px;font:12px ui-monospace,Consolas,monospace"></textarea><label class="hint" for="secret_pagespeed">Google PageSpeed service account (the whole JSON)</label><textarea id="secret_pagespeed" data-secret="pagespeed" rows="4" spellcheck="false" autocomplete="off" style="width:100%;margin:6px 0 10px;background:#0f1115;color:var(--ink);border:1px solid var(--line);border-radius:8px;padding:8px;font:12px ui-monospace,Consolas,monospace"></textarea><div class="row"><button class="primary" id="saveSecrets">Save keys</button></div></div><div class="card"><div class="section-head"><h2>Extract model lanes</h2><span id="laneStatus" class="updated">not loaded</span></div><p class="hint">The model step 2 reads pages with, also used by company dives and email reply drafts. Any OpenAI-compatible endpoint: base URL, model and key. Each call takes the next lane that is on; a lane that answers 429 rests a minute and the call moves on, so every lane added lets more calls run at once. A lane ticked First (a plan whose unused tokens expire) gets every call before the others, which only take calls while it rests. Lanes are kept in the hub database, not in Railway variables. Edit in place, then press Save lanes.</p><div class="table-wrap"><table style="min-width:960px"><thead><tr><th>On</th><th>First</th><th>Label</th><th>Base URL</th><th>Model</th><th>API key</th><th>State</th><th></th></tr></thead><tbody id="lanes"><tr><td colspan="8" class="empty">Enter a LAB_TOKEN to load lanes.</td></tr></tbody></table></div><div class="row" style="margin-top:10px"><button id="addLane">Add lane</button><button class="primary" id="saveLanes">Save lanes</button></div></div><div class="card"><div class="section-head"><h2>Search providers, last 7 days</h2><span id="statsStatus" class="updated">not loaded</span></div><p class="hint">Jobs count under the provider that ran their two general searches. Found by says whose search turned up the page each contact came from; page means the website or map pin we opened ourselves.</p><div id="providerStats"></div></div>
<div id="error" class="error-box" role="alert"></div>
<div class="summary" aria-live="polite"><div class="metric"><strong id="mWorkers">—</strong><span>Workers</span></div><div class="metric"><strong id="mOnline">—</strong><span>Online</span></div><div class="metric"><strong id="mBusy">—</strong><span>Busy</span></div><div class="metric"><strong id="mIdle">—</strong><span>Idle</span></div><div class="metric"><strong id="mCooldown">—</strong><span>Quota cooldown</span></div><div class="metric"><strong id="mQueue">—</strong><span>Pending jobs</span></div></div>
<div class="card"><div class="section-head"><h2>Worker lanes</h2><span id="updated" class="updated">not loaded</span></div><div class="table-wrap"><table><thead><tr><th>Worker</th><th>Status</th><th>Current task</th><th>Last seen</th><th>Capabilities</th><th>Totals</th></tr></thead><tbody id="workers"><tr><td colspan="6" class="empty">Enter a LAB_TOKEN to load workers.</td></tr></tbody></table></div></div>
<div class="card"><div class="section-head"><h2>Pending queue</h2><span id="queueNote" class="updated"></span></div><div id="queue"><div class="empty">No queue data yet.</div></div></div>
</div><script>
(function(){
  var $=function(id){return document.getElementById(id)};
  var esc=function(value){return String(value==null?'':value).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})};
  var token=function(){return localStorage.getItem('labToken')||''};
  var ago=function(iso){if(!iso)return 'never';var seconds=Math.max(0,(Date.now()-new Date(iso).getTime())/1000);if(seconds<60)return Math.round(seconds)+'s ago';if(seconds<3600)return Math.round(seconds/60)+'m ago';return Math.round(seconds/3600)+'h ago'};
  var duration=function(iso){if(!iso)return '—';var seconds=Math.max(0,(Date.now()-new Date(iso).getTime())/1000);if(seconds<60)return Math.round(seconds)+'s';if(seconds<3600)return Math.floor(seconds/60)+'m '+Math.floor(seconds%60)+'s';return Math.floor(seconds/3600)+'h '+Math.floor(seconds%3600/60)+'m'};
  var countdown=function(iso){var ms=new Date(iso).getTime()-Date.now();if(!Number.isFinite(ms))return 'reset time unknown';if(ms<=0)return 'reset due — reconnecting';var s=Math.ceil(ms/1000),h=Math.floor(s/3600),m=Math.floor(s%3600/60);return h+'h '+String(m).padStart(2,'0')+'m '+String(s%60).padStart(2,'0')+'s'};
  var tick=function(){Array.prototype.forEach.call(document.querySelectorAll('[data-cooldown-until]'),function(el){el.textContent=countdown(el.getAttribute('data-cooldown-until'))})};
  var payloadSummary=function(payload){if(payload==null)return '';if(typeof payload!=='object')return String(payload).slice(0,160);var keys=Object.keys(payload);return keys.length?'payload: '+keys.slice(0,6).join(', ')+(keys.length>6?' …':''):''};
  var state=function(body){var running={};(body.jobs||[]).forEach(function(job){if(job.status==='running'&&job.worker)running[job.worker]=job});return {workers:(body.workers||[]).map(function(worker){return {worker:worker,job:running[worker.name]||null}}),pending:(body.jobs||[]).filter(function(job){return job.status==='pending'})}};
  var render=function(body){var joined=state(body), workers=joined.workers, counts={online:0,offline:0,cooldown:0,busy:0,idle:0};workers.forEach(function(item){var status=item.worker.status||'offline';if(counts[status]!=null)counts[status]++;if(item.job)counts.busy++;else if(status==='online')counts.idle++});$('mWorkers').textContent=workers.length;$('mOnline').textContent=counts.online;$('mBusy').textContent=counts.busy;$('mIdle').textContent=counts.idle;$('mCooldown').textContent=counts.cooldown;$('mQueue').textContent=joined.pending.length;
    $('workers').innerHTML=workers.length?workers.map(function(item){var w=item.worker,j=item.job,status=w.status||'offline',cooling=status==='cooldown',timer=cooling&&w.cooldownUntil?'<div class="small cooldown">Quota reached · waiting for refresh in <strong class="mono" data-cooldown-until="'+esc(w.cooldownUntil)+'">'+esc(countdown(w.cooldownUntil))+'</strong></div><div class="small">Reset at '+esc(new Date(w.cooldownUntil).toLocaleString())+'</div>':'',task=j?'<span class="mono">'+esc(j.type)+'</span><div class="small">job '+esc(j.id)+' · '+duration(j.startedAt)+'</div><div class="small">'+esc(payloadSummary(j.payload))+'</div>':cooling?'<span class="cooldown">Waiting for quota refresh</span>':'<span class="idle">No claimed job</span>';return '<tr><td><div class="worker-name">'+esc(w.name)+'</div><div class="small">'+esc(w.ip||'IP unavailable')+'</div></td><td><span class="pill '+esc(status)+'">'+(cooling?'quota cooldown':esc(status))+'</span>'+timer+(w.cooldownReason?'<div class="small">'+esc(w.cooldownReason)+'</div>':'')+'</td><td>'+task+'</td><td><span class="mono">'+esc(ago(w.lastSeenAt))+'</span><div class="small">'+esc(w.lastSeenAt||'')+'</div></td><td class="types">'+esc((w.types||[]).join(', ')||'No types reported')+'</td><td class="mono">taken '+esc(w.taken)+'<br>done '+esc(w.done)+'<br>failed '+esc(w.failed)+'</td></tr>'}).join(''):'<tr><td colspan="6" class="empty">No workers have checked in.</td></tr>';
    $('queueNote').textContent=joined.pending.length+' pending';$('queue').innerHTML=joined.pending.length?joined.pending.map(function(job){return '<div class="queue-row"><div class="queue-type">'+esc(job.type)+'</div><div><span class="mono">'+esc(job.id)+'</span><div class="small">created '+esc(ago(job.createdAt))+' · attempts '+esc(job.attempts)+'</div></div><div class="pill idle">pending</div></div>'}).join(''):'<div class="empty">No pending jobs.</div>';
    $('updated').textContent='updated '+new Date().toLocaleTimeString();
    tick();
  };
  var loadKeys=function(){
    if(!token())return;
    fetch('/api/contact-keys',{headers:{authorization:'Bearer '+token()}})
      .then(function(response){return response.json()})
      .then(function(body){
        if(!body||!body.tavilyKeys)return;
        var tails=function(rows){
          return (rows||[]).map(function(row){
            var extra = row.usedThisMonth!=null ? ' ('+row.usedThisMonth+'/'+row.monthlyLimit+(row.cooling?' cooling':'')+')' : '';
            return row.tail + extra;
          }).join(', ')||'none';
        };
        var resting=function(rows){return (rows||[]).filter(function(row){return row.cooling}).length};
        $('keyStatus').textContent='tavily '+(body.tavily||[]).length+' keys, '+resting(body.tavily)+' resting · exa '+(body.exa||[]).length+' keys, '+resting(body.exa)+' resting · brave '+(body.braveKeys||[]).length+' keys';
        fill('tavilyKeys',body.tavilyKeys);
        fill('exaKeys',body.exaKeys);
        fill('braveKeys',body.braveKeys);
        var secrets=body.secrets||{},fromEnv=body.secretsFromEnv||[];
        Object.keys(secrets).forEach(function(kind){fill('secret_'+kind,secrets[kind]?[secrets[kind]]:[])});
        $('secretStatus').textContent=Object.keys(secrets).filter(function(kind){return secrets[kind]}).length+' saved'+(fromEnv.length?' · from Railway: '+fromEnv.join(', '):'');
      }).catch(function(){});
  };
  var dirty={};
  var fill=function(id,list){if(!dirty[id]&&Array.isArray(list))$(id).value=list.join('\n')};
  var lines=function(id){return $(id).value.split(/\n/).map(function(line){return line.trim()}).filter(Boolean)};
  var copyKeys=function(id,button){
    var label=button.textContent,text=lines(id).join('\n');
    var done=function(note){button.textContent=note;setTimeout(function(){button.textContent=label},1500)};
    var fallback=function(){$(id).select();done(document.execCommand('copy')?'Copied':'Press Ctrl+C')};
    if(!text)return done('Nothing to copy');
    if(typeof navigator!=='undefined'&&navigator.clipboard&&navigator.clipboard.writeText)navigator.clipboard.writeText(text).then(function(){done('Copied')},fallback);
    else fallback();
  };
  var saveSecrets=function(){
    if(!token())return;
    var secrets={};
    Array.prototype.forEach.call(document.querySelectorAll('[data-secret]'),function(box){if(dirty[box.id])secrets[box.getAttribute('data-secret')]=box.value.trim()});
    fetch('/api/contact-keys',{method:'POST',headers:{authorization:'Bearer '+token(),'content-type':'application/json'},body:JSON.stringify({secrets:secrets})})
      .then(function(response){return response.json().then(function(payload){return {response:response,payload:payload}})})
      .then(function(result){
        if(!result.response.ok)throw new Error(result.payload.error||'save failed');
        Object.keys(dirty).forEach(function(id){if(id.indexOf('secret_')===0)delete dirty[id]});
        loadKeys();
      }).catch(function(error){$('error').textContent=error.message;$('error').className='error-box show'});
  };
  var saveKeys=function(kind){
    if(!token())return;
    var body={};
    if(kind==='clear'||$('tavilyKeys').value.trim())body.tavily=lines('tavilyKeys');
    if(kind==='clearExa'||$('exaKeys').value.trim())body.exa=lines('exaKeys');
    if(kind==='clearBrave'||$('braveKeys').value.trim())body.brave=lines('braveKeys');
    fetch('/api/contact-keys',{method:'POST',headers:{authorization:'Bearer '+token(),'content-type':'application/json'},body:JSON.stringify(body)})
      .then(function(response){return response.json().then(function(payload){return {response:response,payload:payload}})})
      .then(function(result){
        if(!result.response.ok)throw new Error(result.payload.error||'save failed');
        dirty={};
        loadKeys();
      }).catch(function(error){$('error').textContent=error.message;$('error').className='error-box show'});
  };
  var lanesDirty=false;
  var laneRow=function(l){
    var field=function(f,value,ph){return '<input data-f="'+f+'" value="'+esc(value)+'" placeholder="'+ph+'" spellcheck="false" autocomplete="off" style="width:100%'+(f==='key'||f==='url'?';font:12px ui-monospace,Consolas,monospace':'')+'">'};
    var state=!l.id?'<span class="small">not saved</span>':!l.enabled?'<span class="pill unknown">off</span>':l.restingUntil?'<span class="pill cooldown">resting</span><div class="small">until '+esc(new Date(l.restingUntil).toLocaleTimeString())+'</div>':'<span class="pill online">ready</span>';
    return '<tr><td><input type="checkbox" data-f="enabled"'+(l.enabled!==false?' checked':'')+'></td><td><input type="checkbox" data-f="first"'+(l.first?' checked':'')+'></td><td>'+field('label',l.label||'','Vectide plan 2')+'</td><td>'+field('url',l.url||'','https://<provider>/v1')+'</td><td>'+field('model',l.model||'','deepseek-v4.1-flash-1017')+'</td><td>'+field('key',l.key||'','sk-...')+'</td><td>'+state+'</td><td><button data-remove="1">Remove</button></td></tr>';
  };
  var loadLanes=function(){
    if(!token())return;
    fetch('/api/llm-lanes',{headers:{authorization:'Bearer '+token()}})
      .then(function(response){return response.json()})
      .then(function(body){
        if(!body||!Array.isArray(body.lanes))return;
        var on=body.lanes.filter(function(l){return l.enabled}).length,first=body.lanes.filter(function(l){return l.enabled&&l.first}).map(function(l){return l.label||l.model});
        $('laneStatus').textContent=body.lanes.length?on+' of '+body.lanes.length+' lanes on'+(first.length?' · first: '+first.join(', '):''):(body.fromEnv&&body.fromEnv.length?'no saved lanes · running on '+body.fromEnv.length+' from Railway variables':'no lanes');
        if(lanesDirty||$('lanes').contains(document.activeElement))return;
        $('lanes').innerHTML=body.lanes.length?body.lanes.map(laneRow).join(''):'<tr><td colspan="8" class="empty">No saved lanes. Add one, then Save lanes.</td></tr>';
      }).catch(function(){});
  };
  var saveLanes=function(){
    if(!token())return;
    var lanes=Array.prototype.map.call($('lanes').querySelectorAll('tr'),function(tr){
      var get=function(f){var el=tr.querySelector('[data-f="'+f+'"]');return el?(el.type==='checkbox'?el.checked:el.value.trim()):null};
      return {label:get('label'),url:get('url'),model:get('model'),key:get('key'),enabled:get('enabled'),first:get('first')};
    }).filter(function(l){return l.url!==null});
    $('saveLanes').disabled=true;
    fetch('/api/llm-lanes',{method:'POST',headers:{authorization:'Bearer '+token(),'content-type':'application/json'},body:JSON.stringify({lanes:lanes})})
      .then(function(response){return response.json().then(function(payload){return {response:response,payload:payload}})})
      .then(function(result){
        if(!result.response.ok)throw new Error(result.payload.error||'save failed');
        lanesDirty=false;
        if(document.activeElement)document.activeElement.blur();
        loadLanes();
      }).catch(function(error){$('error').textContent=error.message;$('error').className='error-box show'})
      .finally(function(){$('saveLanes').disabled=false});
  };
  var loadStats=function(){
    if(!token())return;
    fetch('/api/contact-stats?days=7',{headers:{authorization:'Bearer '+token()}})
      .then(function(response){return response.json()})
      .then(function(body){
        if(!body||!Array.isArray(body.providers))return;
        var pct=function(n,d){return d?Math.round(100*n/d)+'%':'-'};
        var rows=body.providers.map(function(p){
          return '<tr><td>'+esc(p.provider)+'</td><td>'+esc(p.jobs)+'</td><td>'+pct(p.withPhone,p.jobs)+'</td><td>'+pct(p.withPerson,p.jobs)+'</td><td>'+pct(p.withEmail,p.jobs)+'</td><td>'+esc(p.phones)+' / '+esc(p.people)+' / '+esc(p.emails)+'</td></tr>';
        }).join('');
        var by={};(body.foundBy||[]).forEach(function(f){(by[f.foundBy]=by[f.foundBy]||{})[f.kind]=f.count});
        var found=Object.keys(by).map(function(k){var b=by[k];return '<tr><td>'+esc(k)+'</td><td>'+(b.phone||0)+'</td><td>'+(b.person||0)+'</td><td>'+(b.email||0)+'</td></tr>'}).join('');
        $('providerStats').innerHTML=(rows?'<table><thead><tr><th>General searches by</th><th>Jobs</th><th>New phone</th><th>Person</th><th>Email</th><th>Phones / people / emails</th></tr></thead><tbody>'+rows+'</tbody></table>':'<p class="hint">No v2 jobs yet.</p>')
          +(found?'<table style="margin-top:10px"><thead><tr><th>Found by</th><th>Phones</th><th>People</th><th>Emails</th></tr></thead><tbody>'+found+'</tbody></table>':'');
        $('statsStatus').textContent='updated';
      }).catch(function(){});
  };
  var refresh=function(){if(refresh.running)return;refresh.running=true;$('refreshButton').disabled=true;$('saveButton').disabled=true;$('error').className='error-box';fetch('/api/jobs',{headers:{authorization:'Bearer '+token()}}).then(function(response){return response.json().catch(function(){return {error:'invalid response'}}).then(function(body){return {response:response,body:body}})}).then(function(result){if(!result.response.ok){$('authState').className='pill '+(result.response.status===401?'error':'unknown');$('authState').textContent=result.response.status===401?'token rejected':'error';throw new Error(result.body.error||('request failed ('+result.response.status+')'))}$('authState').className='pill online';$('authState').textContent='token ok';render(result.body);loadKeys();loadLanes();loadStats()}).catch(function(error){$('error').textContent=error.message;$('error').className='error-box show'}).finally(function(){refresh.running=false;$('refreshButton').disabled=false;$('saveButton').disabled=false})};
  var downloadWorker=function(){
    var button=$('gmapWorkerDownload');
    if(!token()){$('gmapWorkerStatus').textContent='enter a LAB_TOKEN first';return}
    button.disabled=true;$('gmapWorkerStatus').textContent='preparing…';
    fetch('/api/gmap-worker/package',{headers:{authorization:'Bearer '+token()}})
      .then(function(response){if(!response.ok)return response.json().then(function(body){throw new Error(body.error||('download failed ('+response.status+')'))});return response.blob()})
      .then(function(blob){var link=document.createElement('a');link.href=URL.createObjectURL(blob);link.download='GmapWorker.zip';document.body.appendChild(link);link.click();setTimeout(function(){URL.revokeObjectURL(link.href);link.remove()},1000);$('gmapWorkerStatus').textContent='downloaded'})
      .catch(function(error){$('gmapWorkerStatus').textContent=error.message})
      .finally(function(){button.disabled=false});
  };
  $('gmapWorkerDownload').onclick=downloadWorker;
  $('lanes').oninput=function(){lanesDirty=true};$('lanes').onchange=function(){lanesDirty=true};
  $('lanes').onclick=function(event){var button=event.target.closest&&event.target.closest('[data-remove]');if(!button)return;lanesDirty=true;button.closest('tr').remove()};
  $('addLane').onclick=function(){lanesDirty=true;var empty=$('lanes').querySelector('.empty');if(empty)empty.parentNode.remove();$('lanes').insertAdjacentHTML('beforeend',laneRow({enabled:true}));var inputs=$('lanes').querySelectorAll('tr:last-child input[data-f="label"]');if(inputs[0])inputs[0].focus()};
  $('saveLanes').onclick=saveLanes;
  $('token').value=token();$('refreshButton').onclick=refresh;$('saveButton').onclick=function(){localStorage.setItem('labToken',$('token').value.trim());refresh()};$('saveKeys').onclick=function(){saveKeys('save')};$('tavilyKeys').oninput=function(){dirty.tavilyKeys=true};$('copyTavily').onclick=function(){copyKeys('tavilyKeys',this)};$('copyExa').onclick=function(){copyKeys('exaKeys',this)};$('exaKeys').oninput=function(){dirty.exaKeys=true};$('clearExa').onclick=function(){$('exaKeys').value='';saveKeys('clearExa')};$('braveKeys').oninput=function(){dirty.braveKeys=true};$('clearBrave').onclick=function(){$('braveKeys').value='';saveKeys('clearBrave')};$('saveSecrets').onclick=saveSecrets;Array.prototype.forEach.call(document.querySelectorAll('[data-secret]'),function(box){box.oninput=function(){dirty[box.id]=true}});$('clearTavily').onclick=function(){$('tavilyKeys').value='';saveKeys('clear')};setInterval(refresh,5000);setInterval(tick,1000);if(token())refresh();
})();
</script></body></html>`;
}
