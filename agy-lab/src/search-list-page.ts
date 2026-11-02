import { navHtml, OPERATOR_NAV } from './nav.ts';

/** Operator page for search lists. The shell is public; every call sends LAB_TOKEN. */
export function searchListPage(): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark"><title>Search lists</title><style>
:root{--bg:#10151d;--panel:#18222d;--ink:#edf2f1;--muted:#a5b5bc;--line:#33434d;--accent:#82d2b1;--warn:#f0c57d;--bad:#ef9a89}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.55 system-ui,-apple-system,sans-serif}.wrap{max-width:1080px;margin:auto;padding:24px 16px 60px}.nav{display:flex;flex-wrap:wrap;gap:5px;padding-bottom:18px;border-bottom:1px solid var(--line)}.nav a{font-size:13px;color:var(--muted);text-decoration:none;padding:6px 10px;border-radius:7px}.nav a:hover,.nav a[aria-current=page]{color:var(--ink);background:#24313b}h1{font:normal clamp(30px,5vw,44px)/1.1 Georgia,serif;margin:36px 0 10px}.lead{color:var(--muted);max-width:700px}.card{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:20px;margin-top:16px}label{display:block;font-size:13px;font-weight:650;margin:12px 0 6px}input{width:100%;background:#0f171e;color:var(--ink);border:1px solid #40515d;border-radius:7px;padding:10px 12px;font:inherit}button{font:inherit;border:0;border-radius:7px;background:var(--accent);color:#10251c;font-weight:700;padding:9px 14px;cursor:pointer}button.ghost{background:#24313b;color:var(--ink)}button:disabled{opacity:.5;cursor:not-allowed}.row{display:flex;flex-wrap:wrap;gap:8px;margin-top:14px}.head{display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap}.head h2{margin:0;font-size:17px}.status{font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted)}.status.running{color:var(--accent)}.status.done{color:var(--accent)}.meter{margin-top:14px}.meter .label{display:flex;justify-content:space-between;font-size:13px;color:var(--muted)}.track{height:6px;background:#0e171d;border-radius:8px;overflow:hidden;margin-top:6px}.fill{height:100%;background:var(--accent)}.facts{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin-top:14px}.fact b{display:block;font-size:20px}.fact span{font-size:12px;color:var(--muted)}.muted{color:var(--muted);font-size:13px}.error{color:var(--bad);font-size:13px;white-space:pre-wrap;margin-top:10px}
</style></head><body><div class="wrap">
<nav class="nav" aria-label="Site">${navHtml(OPERATOR_NAV, '/search-lists')}</nav>
<h1>Search lists</h1>
<p class="lead">Upload a CSV of Google Maps searches with the columns country, city, industry, search_keyword. The hub sends each search to whichever Maps worker is free (the Mac mini, scraper.tech, a Windows PC), saves every business it finds, and checks each business's website for emails, phones, social links and people. Every finished search and website check is saved as it lands, so a pause or a redeploy picks up where it stopped. A new list starts paused.</p>
<div class="card"><h2 style="margin:0;font-size:17px">Add a list</h2>
<label for="name">Name</label><input id="name" placeholder="e.g. 25 countries, 5 industries">
<label for="file">CSV file</label><input id="file" type="file" accept=".csv,text/csv">
<div class="row"><button id="add" type="button">Add list</button><button id="token" class="ghost" type="button">Change operator token</button></div>
<div class="error" id="add-error"></div></div>
<div id="runs"></div>
</div><script>
let token=localStorage.getItem('labToken')||'';
const $=id=>document.getElementById(id);
const esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
function askToken(){const t=prompt('Operator token (LAB_TOKEN)',token);if(t!==null){token=t.trim();localStorage.setItem('labToken',token);load();}}
async function api(path,opts={}){const r=await fetch(path,{...opts,headers:{authorization:'Bearer '+token,'content-type':'application/json',...(opts.headers||{})}});if(r.status===401){askToken();throw new Error('bad or missing token');}const b=await r.json().catch(()=>({}));if(!r.ok)throw new Error(b.error||('HTTP '+r.status));return b;}
const pct=(a,b)=>b?Math.round(a/b*1000)/10:0;
const meter=(label,done,total)=>'<div class="meter"><div class="label"><span>'+label+'</span><span>'+done.toLocaleString()+' / '+total.toLocaleString()+' ('+pct(done,total)+'%)</span></div><div class="track"><div class="fill" style="width:'+pct(done,total)+'%"></div></div></div>';
function card(r){const s=r.searches,p=r.places;const workers=Object.entries(r.searchesByWorker||{}).map(([w,n])=>esc(w)+' '+n).join(' · ')||'none yet';
return '<div class="card" data-id="'+r.id+'"><div class="head"><h2>'+esc(r.name)+'</h2><span class="status '+esc(r.status)+'">'+esc(r.status)+'</span></div>'
+meter('Maps searches',s.done+s.failed,s.total)+meter('Websites checked',p.checked,p.places)
+'<div class="facts"><div class="fact"><b>'+p.places.toLocaleString()+'</b><span>businesses</span></div><div class="fact"><b>'+p.with_email.toLocaleString()+'</b><span>with an email</span></div><div class="fact"><b>'+p.with_website.toLocaleString()+'</b><span>with a website</span></div><div class="fact"><b>'+s.failed+'</b><span>failed searches</span></div><div class="fact"><b>'+p.contact_failed.toLocaleString()+'</b><span>failed website checks</span></div></div>'
+'<p class="muted">Searches by worker: '+workers+'</p>'
+'<div class="row">'+(r.status==='running'?'<button class="ghost" data-act="pause">Pause</button>':r.status==='done'?'':'<button data-act="start">Start</button>')
+'<button class="ghost" data-act="retry"'+(s.failed||p.contact_failed?'':' disabled')+'>Retry failures</button><button class="ghost" data-act="csv">Download CSV</button></div><div class="error"></div></div>';}
async function load(){if(!token)return askToken();try{const {runs}=await api('/api/search-lists');$('runs').innerHTML=runs.length?runs.map(card).join(''):'<p class="muted" style="margin-top:16px">No lists yet.</p>';}catch(e){$('runs').innerHTML='<p class="error">'+esc(e.message)+'</p>';}}
async function download(id,el){const r=await fetch('/api/search-lists/'+id+'/companies.csv',{headers:{authorization:'Bearer '+token}});if(!r.ok)throw new Error('HTTP '+r.status);const url=URL.createObjectURL(await r.blob());const a=document.createElement('a');a.href=url;a.download='search-list-'+id+'.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);}
$('runs').addEventListener('click',async e=>{const b=e.target.closest('button[data-act]');if(!b)return;const c=b.closest('.card'),id=c.dataset.id,act=b.dataset.act;b.disabled=true;try{if(act==='csv')await download(id);else{await api('/api/search-lists/'+id+'/'+act,{method:'POST',body:'{}'});await load();}}catch(err){c.querySelector('.error').textContent=err.message;}finally{b.disabled=false;}});
$('add').onclick=async()=>{$('add-error').textContent='';const f=$('file').files[0];if(!f)return $('add-error').textContent='Choose a CSV file.';$('add').disabled=true;try{await api('/api/search-lists',{method:'POST',body:JSON.stringify({name:$('name').value,csv:await f.text()})});$('file').value='';$('name').value='';await load();}catch(e){$('add-error').textContent=e.message;}finally{$('add').disabled=false;}};
$('token').onclick=askToken;
load();setInterval(()=>{if(token&&document.visibilityState==='visible')load();},10000);
</script></body></html>`;
}
