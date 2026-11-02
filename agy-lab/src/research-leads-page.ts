import { navHtml, OPERATOR_NAV } from './nav.ts';

/** Operator page: every business the search lists found, filtered by its step-2 contact status. The shell is public; every call sends LAB_TOKEN. */
export function researchLeadsPage(): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark"><title>Research leads</title><style>
:root{--bg:#10151d;--panel:#18222d;--ink:#edf2f1;--muted:#a5b5bc;--line:#33434d;--accent:#82d2b1;--warn:#f0c57d;--bad:#ef9a89}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.55 system-ui,-apple-system,sans-serif}.wrap{max-width:1180px;margin:auto;padding:24px 16px 60px}.nav{display:flex;flex-wrap:wrap;gap:5px;padding-bottom:18px;border-bottom:1px solid var(--line)}.nav a{font-size:13px;color:var(--muted);text-decoration:none;padding:6px 10px;border-radius:7px}.nav a:hover,.nav a[aria-current=page]{color:var(--ink);background:#24313b}h1{font:normal clamp(30px,5vw,44px)/1.1 Georgia,serif;margin:36px 0 10px}.lead{color:var(--muted);max-width:720px}
.bar{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin-top:20px}select{background:#0f171e;color:var(--ink);border:1px solid #40515d;border-radius:7px;padding:8px 10px;font:inherit;max-width:100%}button{font:inherit;border:0;border-radius:7px;background:#24313b;color:var(--ink);padding:8px 12px;cursor:pointer}button:disabled{opacity:.4;cursor:not-allowed}button.go{background:var(--accent);color:#10251c;font-weight:700}.jobs{margin-top:12px;font-size:14px}.jobs .job{display:flex;flex-wrap:wrap;gap:4px 12px;align-items:center;margin-top:6px}.jobs .job b{font-weight:600}.ok{color:var(--accent);font-size:13px;margin-top:8px}
.chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:14px}.chip{font-size:13px;background:var(--panel);border:1px solid var(--line);color:var(--muted);padding:6px 10px;border-radius:999px}.chip b{color:var(--ink);font-weight:650;margin-left:4px}.chip[aria-pressed=true]{border-color:var(--accent);color:var(--ink);background:#1d3029}
.table{margin-top:16px;background:var(--panel);border:1px solid var(--line);border-radius:12px;overflow-x:auto}table{width:100%;border-collapse:collapse;min-width:640px}th,td{text-align:left;padding:10px 14px;border-bottom:1px solid var(--line);vertical-align:top}th{font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);font-weight:600}tr.lead-row{cursor:pointer}tr.lead-row:hover td{background:#1d2935}tr.open td{background:#1d2935}td.name b{font-weight:600}td.name span{display:block;font-size:12px;color:var(--muted)}td.uid{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12px;color:var(--muted);white-space:nowrap}
.tag{display:inline-block;font-size:12px;padding:2px 8px;border-radius:999px;background:#24313b;white-space:nowrap}.tag.contact-via-website{background:#1f4436;color:#bdf0d7}.tag.unknown-hosting-email{background:#3d3420;color:#f6dca5}.tag.major-brand-email-hosting{background:#2a3550;color:#c4d4fb}.tag.mobile-phone{background:#3a2a45;color:#e2c8f5}.tag.social-media{background:#203c47;color:#b8e4f2}.tag.no-viable-contact-method{background:#43282a;color:#f4bcb3}.tag.not-checked{color:var(--muted)}
.detail td{background:#131c25;font-size:14px}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:14px 24px}.grid h3{margin:0 0 4px;font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);font-weight:600}.grid ul{margin:0;padding-left:18px}.grid a{color:var(--accent);word-break:break-all}.muted{color:var(--muted);font-size:13px}.error{color:var(--bad);font-size:13px;white-space:pre-wrap;margin-top:12px}.pager{display:flex;gap:10px;align-items:center;justify-content:flex-end;margin-top:12px}
</style></head><body><div class="wrap">
<nav class="nav" aria-label="Site">${navHtml(OPERATOR_NAV, '/research-leads')}</nav>
<h1>Research leads</h1>
<p class="lead">Every business the country-industry search lists found on Google Maps, with the best way to contact it from list processing step 2. Pick a contact status to filter; open a row for its emails, phones, form and social links. Step 2 reads each website once and checks email hosting; it uses no paid service.</p>
<div class="bar"><select id="run" aria-label="Search list"><option value="">All search lists</option></select><button id="step2" class="go" type="button">Run step 2 on unchecked leads</button><button id="token" type="button">Change operator token</button></div>
<div class="jobs" id="jobs"></div><div class="ok" id="ok"></div>
<div class="chips" id="chips"></div>
<div class="table"><table><thead><tr><th>UID</th><th>Company</th><th>Industry</th><th>Country</th><th>Contact status</th></tr></thead><tbody id="rows"><tr><td colspan="5" class="muted">Loading…</td></tr></tbody></table></div>
<div class="pager"><span class="muted" id="range"></span><button id="prev" type="button">Previous</button><button id="next" type="button">Next</button></div>
<div class="error" id="error"></div>
</div><script>
let token=localStorage.getItem('labToken')||'';
const $=id=>document.getElementById(id);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const STATUSES=[['contact-via-website','Contact form'],['unknown-hosting-email','Email, unknown hosting'],['major-brand-email-hosting','Email, major provider'],['mobile-phone','Mobile phone'],['social-media','Social media'],['no-viable-contact-method','No viable contact'],['not-checked','Not checked yet']];
const label=Object.fromEntries(STATUSES);
const params=new URLSearchParams(location.search);
const state={run:params.get('run')||'',status:params.get('status')||'',offset:Number(params.get('offset'))||0};
let leads=[],lastCounts={},running=false;
function askToken(){const t=prompt('Operator token (LAB_TOKEN)',token);if(t!==null){token=t.trim();localStorage.setItem('labToken',token);load();}}
async function api(path,opts={}){const r=await fetch(path,{...opts,headers:{authorization:'Bearer '+token,'content-type':'application/json'}});if(r.status===401){askToken();throw new Error('bad or missing token');}const b=await r.json().catch(()=>({}));if(!r.ok)throw new Error(b.error||('HTTP '+r.status));return b;}
const link=u=>{const s=String(u||'');return /^https?:\\/\\//i.test(s)?'<a href="'+esc(s)+'" target="_blank" rel="noopener noreferrer">'+esc(s)+'</a>':esc(s);};
const list=items=>items.length?'<ul>'+items.map(x=>'<li>'+x+'</li>').join('')+'</ul>':'<span class="muted">none</span>';
const join=a=>(a||[]).filter(Boolean).join(', ');
function detail(l){const b=l.business||{},f=l.form;
return '<tr class="detail"><td colspan="5"><div class="grid">'
+'<div><h3>Business</h3>'+(b.category?esc(b.category)+'<br>':'')+(b.address?esc(b.address)+'<br>':'')+(b.website?link(b.website)+'<br>':'<span class="muted">no website</span><br>')+(b.phone?'Maps phone '+esc(b.phone)+'<br>':'')+(b.mapsUrl?'<a href="'+esc(b.mapsUrl)+'" target="_blank" rel="noopener noreferrer">Google Maps</a>':'')+'</div>'
+'<div><h3>Contact form</h3>'+(f?esc(f.status)+(f.detail?': '+esc(f.detail):'')+(f.url?'<br>'+link(f.url):''):'<span class="muted">not checked yet</span>')+'</div>'
+'<div><h3>Emails</h3>'+(l.emails?list(l.emails.map(e=>esc(e.email)+' <span class="muted">'+esc(e.mx_provider||e.mx_class)+'</span>')):'<span class="muted">not checked yet</span>')+'</div>'
+'<div><h3>Phones</h3>'+(l.phones?list(l.phones.map(p=>esc(p.e164||p.phone)+' <span class="muted">'+esc(p.type)+'</span>')):'<span class="muted">not checked yet</span>')+'</div>'
+'<div><h3>Social</h3>'+(l.social?list(l.social.map(link)):'<span class="muted">not checked yet</span>')+'</div>'
+(l.checked_at?'<div><h3>Checked</h3>'+esc(new Date(l.checked_at).toLocaleString())+'</div>':'')
+'</div></td></tr>';}
function row(l,i){const b=l.business||{},s=l.best_contact_method||'not-checked';
return '<tr class="lead-row" data-i="'+i+'"><td class="uid">'+esc(l.company_uid||'')+'</td><td class="name"><b>'+esc(b.name)+'</b><span>'+esc(b.category||'')+'</span></td><td>'+esc(join(l.industries))+'</td><td>'+esc(join(l.countries))+'</td><td><span class="tag '+esc(s)+'">'+esc(label[s]||s)+'</span></td></tr>';}
function chips(counts){const all=Object.values(counts).reduce((a,n)=>a+n,0);
$('chips').innerHTML='<button class="chip" data-s="" aria-pressed="'+(!state.status)+'">All<b>'+all.toLocaleString()+'</b></button>'+STATUSES.map(([k,t])=>'<button class="chip" data-s="'+k+'" title="'+k+'" aria-pressed="'+(state.status===k)+'">'+esc(t)+'<b>'+(counts[k]||0).toLocaleString()+'</b></button>').join('');}
async function load(){if(!token)return askToken();$('error').textContent='';
const q=new URLSearchParams();if(state.run)q.set('run',state.run);if(state.status)q.set('status',state.status);if(state.offset)q.set('offset',state.offset);
history.replaceState(null,'','?'+q.toString());
try{const d=await api('/api/list-step2/browse?'+q.toString());
const sel=$('run');if(sel.options.length===1)for(const r of d.runs){const o=document.createElement('option');o.value=r.id;o.textContent=r.name+' ('+r.id+')';sel.appendChild(o);}sel.value=state.run;
chips(d.counts);lastCounts=d.counts;leads=d.leads;
$('rows').innerHTML=leads.length?leads.map(row).join(''):'<tr><td colspan="5" class="muted">No leads with this status.</td></tr>';
$('range').textContent=d.total?(d.offset+1).toLocaleString()+'–'+(d.offset+leads.length).toLocaleString()+' of '+d.total.toLocaleString():'';
$('prev').disabled=d.offset<=0;$('next').disabled=d.offset+leads.length>=d.total;
}catch(e){$('error').textContent=e.message;}}
$('rows').addEventListener('click',e=>{const tr=e.target.closest('tr.lead-row');if(!tr||e.target.closest('a'))return;const next=tr.nextElementSibling;
if(next&&next.classList.contains('detail')){next.remove();tr.classList.remove('open');return;}tr.classList.add('open');tr.insertAdjacentHTML('afterend',detail(leads[Number(tr.dataset.i)]));});
$('chips').addEventListener('click',e=>{const c=e.target.closest('.chip');if(!c)return;state.status=c.dataset.s;state.offset=0;load();});
$('run').onchange=()=>{state.run=$('run').value;state.offset=0;load();};
$('prev').onclick=()=>{state.offset=Math.max(0,state.offset-100);load();window.scrollTo(0,0);};
$('next').onclick=()=>{state.offset+=100;load();window.scrollTo(0,0);};
async function loadJobs(){if(!token)return;try{const {jobs}=await api('/api/list-step2');
const active=jobs.filter(j=>j.status==='running'||(j.status==='paused'&&j.leads.done<j.leads.total));running=active.some(j=>j.status==='running');
$('jobs').innerHTML=active.map(j=>'<div class="job"><b>Step 2 '+esc(j.status)+'</b><span>'+esc(j.name)+'</span><span class="muted">'+j.leads.done.toLocaleString()+' / '+j.leads.total.toLocaleString()+' leads done</span>'+(j.status==='running'?'<button type="button" data-pause="'+esc(j.id)+'">Pause</button>':'')+'</div>').join('');
}catch(e){$('error').textContent=e.message;}}
$('jobs').addEventListener('click',async e=>{const b=e.target.closest('button[data-pause]');if(!b)return;b.disabled=true;try{await api('/api/list-step2/'+b.dataset.pause+'/pause',{method:'POST',body:'{}'});await loadJobs();}catch(err){$('error').textContent=err.message;}});
$('step2').onclick=async()=>{const sel=$('run'),list=state.run?sel.options[sel.selectedIndex].textContent:'all search lists',n=lastCounts['not-checked']||0;
if(!confirm('Run step 2 on the unchecked leads of '+list+'? Up to '+n.toLocaleString()+' leads (only ones whose website check from step 1 is finished). Paused step-2 jobs carry on too. It reads each website once, uses no paid service, and a full list takes most of a day. You can pause it here.'))return;
$('step2').disabled=true;$('ok').textContent='';$('error').textContent='';
try{const r=await api('/api/list-step2/run-unchecked',{method:'POST',body:JSON.stringify({run:state.run||undefined})});
const added=r.created.reduce((a,c)=>a+c.leads,0);
$('ok').textContent=(added?'Started step 2 on '+added.toLocaleString()+' leads.':'No new unchecked leads to add.')+(r.resumed?' Resumed '+r.resumed+' paused job(s).':'');
await loadJobs();}catch(e){$('error').textContent=e.message;}finally{$('step2').disabled=false;}};
$('token').onclick=askToken;
load();loadJobs();setInterval(()=>{if(token&&running&&document.visibilityState==='visible'){loadJobs();load();}},20000);
</script></body></html>`;
}
