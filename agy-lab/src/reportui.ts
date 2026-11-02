import type { PublishedReport } from './reportdb.ts';
import { TOKEN_STORE_JS } from './tokenstore.ts';
import { CLIENT_NAV, navHtml } from './nav.ts';

const esc = (value: unknown): string => String(value ?? '').replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c]!));

const arr = (value: unknown): Record<string, unknown>[] =>
  Array.isArray(value) ? value.filter((v) => v && typeof v === 'object') as Record<string, unknown>[] : [];

const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string' && Boolean(v.trim())) : [];

const obj = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};

const value = (row: Record<string, unknown>, ...keys: string[]): string => {
  for (const key of keys) if (row[key] != null && row[key] !== '') return String(row[key]);
  return '';
};

const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : Number(String(v ?? '').replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? n : 0;
};

/**
 * The smallest markdown renderer that does this job, and it escapes FIRST.
 *
 * This text was written by a model. Escaping every character before a single
 * formatting rule runs means no combination of what it wrote can produce a tag --
 * the alternative is auditing a renderer for injection, forever, on input nobody
 * controls. Formatting is then applied to already-safe text.
 */
function markdown(src: unknown): string {
  const lines = esc(String(src ?? '')).split('\n');
  const inline = (t: string) => t
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');
  const out: string[] = [];
  let list = false, table = false, para: string[] = [];
  const flushPara = () => { if (para.length) { out.push('<p>' + inline(para.join(' ')) + '</p>'); para = []; } };
  const flushList = () => { if (list) { out.push('</ul>'); list = false; } };
  const flushTable = () => { if (table) { out.push('</tbody></table>'); table = false; } };
  const flushAll = () => { flushPara(); flushList(); flushTable(); };

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) { flushAll(); continue; }
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) { flushAll(); const n = Math.min(h[1]!.length + 1, 6); out.push(`<h${n}>${inline(h[2]!)}</h${n}>`); continue; }
    // A separator row (|---|---|) is what turns the previous row into a header.
    if (/^\|[\s:|-]+\|$/.test(line) && table) continue;
    if (line.startsWith('|') && line.endsWith('|')) {
      const cells = line.slice(1, -1).split('|').map((c) => inline(c.trim()));
      if (!table) { flushPara(); flushList(); out.push('<table class="data"><tbody>'); table = true; }
      out.push('<tr>' + cells.map((c) => `<td>${c}</td>`).join('') + '</tr>');
      continue;
    }
    flushTable();
    const li = /^[-*]\s+(.*)$/.exec(line);
    if (li) { flushPara(); if (!list) { out.push('<ul>'); list = true; } out.push(`<li>${inline(li[1]!)}</li>`); continue; }
    flushList();
    if (/^-{3,}$/.test(line)) { flushPara(); continue; }
    para.push(line);
  }
  flushAll();
  return out.join('');
}

const reportDate = (report: PublishedReport): string => {
  const raw = report.completed_at ?? report.updated_at ?? report.created_at;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? 'Undated' : new Intl.DateTimeFormat('en', {
    day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC',
  }).format(date);
};

const rank = (n: unknown): string => String(n ?? '—').padStart(2, '0');

function link(url: unknown, label: string, className = 'text-link'): string {
  const href = typeof url === 'string' && /^https?:\/\//i.test(url) ? url : '';
  return href ? `<a class="${className}" href="${esc(href)}" target="_blank" rel="noopener">${esc(label)}<span aria-hidden="true">↗</span></a>` : '';
}

/**
 * Wire the per-company Research buttons on a shared market scan.
 *
 * Posts to the report-scoped public route rather than /api/company-research:
 * this page carries no token by design, and the report's own id is what proves
 * the caller may research the businesses listed in it.
 *
 * A dossier takes minutes, so the button hands over a link the moment the run
 * is accepted instead of pretending to wait. A company already being researched
 * comes back 200 with the existing report — the button then points at that,
 * which is why a second click is harmless.
 */
/**
 * The evidence grade, shown where the reader can act on it.
 *
 * `classifyEvidence` stopped deleting weakly-sourced rows and started tagging
 * them instead -- but the page rendered every row identically, so the judgement
 * the grade exists to support never actually reached the reader. A `domain_only`
 * row cites a homepage rather than a page that states the fact. It is worth
 * publishing, and it is worth publishing as weaker.
 *
 * Rows without the field (candidate people carry `verification_status`, and
 * conflicts are not evidence rows) render exactly as before.
 */
const GRADES: Record<string, { en: string; zh: string; weight: string }> = {
  direct_page: { en: 'Direct page', zh: '直接页面', weight: 'strong' },
  domain_only: { en: 'Domain only', zh: '仅域名', weight: 'weak' },
  insecure_page: { en: 'Direct page · http', zh: '直接页面 · http', weight: 'weak' },
  insecure_domain: { en: 'Domain only · http', zh: '仅域名 · http', weight: 'weak' },
  search_result: { en: 'Search result', zh: '搜索结果', weight: 'thin' },
  unsourced: { en: 'Unsourced', zh: '无来源', weight: 'thin' },
};

/**
 * The zh-CN translation pass rewrites some of these values into Chinese -- 7 of
 * 39 on run `4RIySbBlPLYHJRlJ_KQ8`. That is a defect in the translator, which
 * should leave an enum alone, but the reader should not lose a badge over it, so
 * the translated forms map back to their canonical grade.
 */
const GRADE_ALIASES: Record<string, string> = Object.fromEntries(
  Object.entries(GRADES).flatMap(([key, g]) => [[g.zh, key], [g.en, key]]),
);

function grade(row: Record<string, unknown>, zh = false): string {
  const raw = value(row, 'evidence_strength');
  if (!raw) return '';
  const found = GRADES[raw] ?? GRADES[GRADE_ALIASES[raw] ?? ''];
  // An unrecognised grade is still information the research produced. Show it
  // plainly rather than dropping the row's only sourcing signal.
  if (!found) return `<span class="grade">${esc(raw)}</span>`;
  return `<span class="grade ${found.weight}">${esc(zh ? found.zh : found.en)}</span>`;
}

/**
 * The evidence tally, stated on the report itself.
 *
 * The ledger computes this, but Round 04's synthesis returns its own empty
 * `validation` object and that output becomes the published final -- so the
 * count never reached the page. It is recomputed from the published rows here,
 * which is both simpler and truer: it counts what the reader is actually
 * looking at rather than what an earlier stage said it would be.
 */
function evidenceTally(collections: Record<string, unknown>[][], zh = false): string {
  const tally = new Map<string, number>();
  for (const rows of collections) {
    for (const row of rows) {
      const raw = value(row, 'evidence_strength');
      if (!raw) continue;
      const key = GRADES[raw] ? raw : GRADE_ALIASES[raw] ?? raw;
      tally.set(key, (tally.get(key) ?? 0) + 1);
    }
  }
  if (!tally.size) return '';
  const order = Object.keys(GRADES);
  const items = [...tally.entries()]
    .sort((a, b) => (order.indexOf(a[0]) + 1 || 99) - (order.indexOf(b[0]) + 1 || 99))
    .map(([key, n]) => {
      const found = GRADES[key];
      const label = found ? (zh ? found.zh : found.en) : key;
      return `<span class="grade ${found?.weight ?? ''}">${n} · ${esc(label)}</span>`;
    }).join('');
  const note = zh
    ? '每一行研究结果均予保留并标注来源强度；“直接页面”指链接直达陈述该事实的页面，“仅域名”指仅链接到主页。'
    : 'Every row the research returned is kept and labelled. Direct page links to a page stating the fact; domain only links just to a homepage.';
  return `<section class="breakdown"><div class="breakdown-label">${zh ? '证据强度' : 'Evidence quality'}</div><div><div class="breakdown-badges">${items}</div><p class="breakdown-note">${esc(note)}</p></div></section>`;
}

function researchScript(publicId: string): string {
  return `<script>
(function(){
  var id=${JSON.stringify(publicId)};
  // One row's queue attempt, shared by the single button and the queue-all
  // walk below. Resolves true when a report was started or found already
  // running, false when there was nothing to do; rejects only on failure, with
  // the row restored so a retry is possible.
  function startContact(cb){
    var parallel=cb.hasAttribute('data-parallel-contact');
    var rerun=cb.hasAttribute('data-rerun-contact');
    var cid=cb.getAttribute(parallel?'data-parallel-contact':rerun?'data-rerun-contact':'data-contact');
    var compareToReportId=rerun?cb.getAttribute('data-previous-report'):null;
    if(!cid||cb.disabled)return Promise.resolve(false);
    cb.disabled=true;var cwas=cb.textContent;cb.textContent='Starting\\u2026';
    return fetch('/public/reports/'+id+'/'+(parallel?'parallel-contact-research':'contact-research'),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({companyId:cid,compareToReportId:compareToReportId})})
      .then(function(r){return r.json().then(function(j){if(!r.ok)throw new Error(j.error||('HTTP '+r.status));return j})})
      .then(function(j){
        var link=j.report&&j.report.view_url;
        if(!link){throw new Error('no report link returned')}
        // A just-queued run opens as research in progress, not as a finished
        // dossier — the same label the server renders for a reloaded page, so
        // the button's state survives a reload instead of reverting.
        var st=j.report.status;
        var go=st==='queued'||st==='running';
        var a=document.createElement('a');
        a.className='button';
        a.style.background=go?'#fff7e6':'#0a6b47';
        a.style.color=go?'#a15c07':'#fff';
        a.style.borderColor=go?'#f0d68a':'#0a6b47';
        a.style.fontWeight='700';
        a.href=link;
        a.textContent=rerun?'Open new original report ↗':go?'\\u23f3 Researching\\u2026':'Open contacts \\u2197';
        a.setAttribute('target','_blank');a.setAttribute('rel','noopener');
        cb.replaceWith(a);
        return true;
      })
      .catch(function(e){cb.disabled=false;cb.textContent=cwas;throw e});
  }
  document.addEventListener('click',function(ev){
    var qa=ev.target.closest&&ev.target.closest('button[data-contact-all]');
    if(qa&&!qa.disabled){
      var pending=[].slice.call(document.querySelectorAll('button[data-contact]'));
      if(!pending.length){qa.disabled=true;qa.textContent='Nothing to queue';return}
      if(!confirm('Queue contact research for all '+pending.length+' businesses? They run through the queue one after another.'))return;
      qa.disabled=true;
      var queued=0,failed=0,i=0;
      (function step(){
        if(i>=pending.length){
          qa.textContent=failed?(queued+' queued \\u00b7 '+failed+' failed \\u26a0'):(queued+' queued \\u2713');
          if(failed)alert(failed+' of '+pending.length+' rows could not be queued. Reload the page and queue again \u2014 rows already running are only linked, never restarted.');
          return;
        }
        qa.textContent='Queueing '+(i+1)+'/'+pending.length+'\\u2026';
        startContact(pending[i++])
          .then(function(ok){if(ok)queued++},function(){failed++})
          .then(step);
      })();
      return;
    }
    var cb=ev.target.closest&&ev.target.closest('button[data-contact]');
    if(cb&&!cb.disabled){
      startContact(cb).catch(function(e){alert('Could not start contact research: '+e.message)});
      return;
    }
    var rb=ev.target.closest&&ev.target.closest('button[data-rerun-contact]');
    if(rb&&!rb.disabled){
      startContact(rb).catch(function(e){alert('Could not rerun original contact research: '+e.message)});
      return;
    }
    var pb=ev.target.closest&&ev.target.closest('button[data-parallel-contact]');
    if(pb&&!pb.disabled){
      startContact(pb).catch(function(e){alert('Could not start Parallel contact research: '+e.message)});
      return;
    }
    var b=ev.target.closest&&ev.target.closest('button.research');
    if(!b||b.disabled)return;
    var company=b.getAttribute('data-company');
    if(!company)return;
    b.disabled=true;var was=b.textContent;b.textContent='Starting\\u2026';
    fetch('/public/reports/'+id+'/research',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({companyId:company})})
      .then(function(r){return r.json().then(function(j){if(!r.ok)throw new Error(j.error||('HTTP '+r.status));return j})})
      .then(function(j){
        var link=j.report&&j.report.view_url;
        if(!link){throw new Error('no report link returned')}
        var a=document.createElement('a');
        a.className='button';a.href=link;a.textContent='Open dossier \\u2192';
        a.setAttribute('target','_blank');a.setAttribute('rel','noopener');
        b.replaceWith(a);
      })
      .catch(function(e){b.disabled=false;b.textContent=was;alert('Could not start research: '+e.message)});
  });
})();
</script>`;
}

/**
 * The report stylesheet. Every published report -- market scan, company dossier
 * and VIP brief alike -- renders through it, so a change here is a change to all
 * three. It replaced a serif-on-cream editorial sheet that was drawn for a wide
 * screen and read badly on the phone most of these links are opened on.
 */
const CSS = `/* Mobile-first, dense, minimal. Every rule here is the phone layout; the single
   min-width block at the bottom widens it for desktop. Inter is loaded in the
   head; the stack behind it only matters while the webfont is in flight. */
:root{--paper:#f2f4f6;--sheet:#ffffff;--ink:#111418;--ink-2:#1c2229;--muted:#5a6472;--faint:#8d97a4;--line:#dfe3e8;--soft:#eef1f4;--accent:#17356b;--accent-2:#2f5fb8;--danger:#b42318;--warning:#a15c07;--ok:#0a6b47;--sans:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;--mono:ui-monospace,"SFMono-Regular",Consolas,"Liberation Mono",monospace;--radius:2px;--micro:600 9px/1.3 var(--sans);--track:.14em}
*{box-sizing:border-box}html{background:var(--paper);scroll-behavior:smooth;-webkit-text-size-adjust:100%}body{margin:0;color:var(--ink);background:var(--paper);font:14px/1.5 var(--sans);font-variant-numeric:tabular-nums;-webkit-font-smoothing:antialiased}a{color:inherit}
.wrap{max-width:1120px;margin:0 auto;padding:0 16px 40px}

/* Market-report tables and rendered markdown. Wide tables scroll inside their own
   box: the market grids are 5 columns and the page these open on is a phone, so
   without this the whole document scrolls sideways. */
table.data{width:100%;border-collapse:collapse;font-size:14px;margin:8px 0;display:block;overflow-x:auto;white-space:nowrap}
table.data th,table.data td{border-bottom:1px solid var(--line);padding:7px 10px;text-align:left;vertical-align:top}
table.data th{font-weight:600;color:var(--muted);font-size:12px;text-transform:uppercase;letter-spacing:.04em}
table.data td.num,table.data th.num{text-align:right;font-variant-numeric:tabular-nums}
table.data tr:last-child td{border-bottom:none}
.markdown{font-size:15px;line-height:1.62}
.markdown h2{font-size:19px;margin:22px 0 6px}.markdown h3{font-size:16px;margin:18px 0 4px}
.markdown p{margin:0 0 10px}.markdown ul{margin:0 0 12px;padding-left:20px}.markdown li{margin:0 0 5px}
.markdown code{background:var(--soft);padding:1px 5px;border-radius:4px;font-size:13px}
.markdown table.data{white-space:normal}

/* Masthead: a full-width ink band, so the page opens as a document with a
   publisher rather than as a card on a white screen. */
.topbar{background:var(--ink);color:#fff}.topbar-in{display:flex;align-items:center;justify-content:space-between;gap:12px;max-width:1120px;margin:0 auto;padding:0 16px;height:46px}.wordmark{display:flex;align-items:center;gap:9px;font:var(--micro);letter-spacing:var(--track);text-transform:uppercase;color:#fff}.mark{display:grid;place-items:center;width:22px;height:22px;border-radius:var(--radius);background:#fff;color:var(--ink);font:700 9px/1 var(--sans);letter-spacing:.02em}.folio{font:500 9px/1.5 var(--mono);color:#93a0b1;text-align:right;text-transform:uppercase;letter-spacing:.06em}
/* The way out. A report tab is opened with target="_blank" and so has no Back
   button of its own; without these two links the page is terminal. */
.wordmark{text-decoration:none}.wordmark-text{display:none}
.topnav{display:flex;align-items:center;gap:13px;margin-right:auto;font:var(--micro);letter-spacing:var(--track);text-transform:uppercase}.topnav a{padding:2px 0;border-bottom:1px solid transparent;color:#93a0b1;text-decoration:none;white-space:nowrap}.topnav a:hover{color:#fff}.topnav a[aria-current="page"]{color:#fff;border-bottom-color:#fff}

.hero{display:grid;gap:16px;padding:22px 0 20px}.kicker{display:flex;align-items:center;gap:9px;font:var(--micro);letter-spacing:var(--track);text-transform:uppercase;color:var(--accent-2)}.kicker:before{content:"";width:18px;height:2px;background:var(--accent-2)}.hero h1{margin:0;font:600 clamp(24px,6.4vw,38px)/1.12 var(--sans);letter-spacing:-.028em;text-wrap:balance}.hero-copy{max-width:60ch;margin:0;font-size:13px;line-height:1.55;color:var(--muted)}
/* The run card. Status, issue date and round progress are the provenance of the
   page, so they sit in their own bordered block instead of loose in the header. */
.hero-meta{display:grid;gap:11px;padding:13px 14px;background:var(--sheet);border:1px solid var(--line);border-top:2px solid var(--accent);border-radius:var(--radius)}.status{display:inline-flex;align-items:center;gap:7px;justify-self:start;padding:4px 9px 4px 8px;border:1px solid var(--line);border-radius:999px;font:var(--micro);letter-spacing:.1em;text-transform:uppercase}.status-dot{width:6px;height:6px;border-radius:50%;background:#c98a12;box-shadow:0 0 0 3px rgba(201,138,18,.16)}.completed .status-dot,.partial .status-dot{background:var(--ok);box-shadow:0 0 0 3px rgba(10,107,71,.14)}.failed .status-dot{background:var(--danger);box-shadow:0 0 0 3px rgba(180,35,24,.14)}
.meta-line{display:grid;gap:5px;font:500 10px/1.35 var(--sans);letter-spacing:.05em;text-transform:uppercase;color:var(--muted)}.rounds{display:grid;grid-template-columns:repeat(4,1fr);gap:3px}.round{height:4px;background:var(--soft)}.round.on{background:var(--accent)}

/* Metrics read as a instrument strip: hairline-divided cells, tabular figures,
   and a short accent tick that marks each cell without boxing it in. */
.metrics{display:grid;grid-template-columns:repeat(2,1fr);gap:1px;background:var(--line);border:1px solid var(--line);border-radius:var(--radius)}.metric{position:relative;min-width:0;padding:14px 14px 12px;background:var(--sheet)}.metric:before{content:"";position:absolute;top:0;left:14px;width:16px;height:2px;background:var(--accent-2)}.metric strong{display:block;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;font:600 23px/1.1 var(--sans);letter-spacing:-.03em}.metric span{display:block;margin-top:5px;font:var(--micro);letter-spacing:.11em;text-transform:uppercase;color:var(--muted)}

/* Sections number themselves, the way a report's contents page would. */
.wrap{counter-reset:section}.section{padding-top:26px}.section-head{display:grid;gap:4px;padding-bottom:9px;margin-bottom:12px;border-bottom:1px solid var(--ink)}.section h2{counter-increment:section;margin:0;font:600 17px/1.25 var(--sans);letter-spacing:-.02em}.section h2:before{content:counter(section,decimal-leading-zero);display:block;margin-bottom:7px;font:var(--micro);letter-spacing:var(--track);color:var(--accent-2)}.section-note{font-size:12px;line-height:1.45;color:var(--muted)}
.sheet,.records,.contact-list,.people,.signal-list,.angles{background:var(--sheet);border:1px solid var(--line);border-radius:var(--radius)}
/* Ad cards. The creative arrives as a data URI on the ad itself -- the images are
   files on the mini's disk and there is no blob store between it and here -- so this
   is the surface where a captured ad finally becomes something a person can look at. */
.ad-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:16px;margin-top:18px}
.ad-card{background:var(--sheet);border:1px solid var(--line);border-radius:var(--radius);display:flex;flex-direction:column;overflow:hidden}
.ad-shot{background:#111;line-height:0}
.ad-shot img{width:100%;height:auto;max-height:320px;object-fit:contain;display:block}
.ad-shot.none{min-height:110px;display:flex;align-items:center;justify-content:center;padding:0 14px;text-align:center;background:repeating-linear-gradient(45deg,transparent,transparent 9px,rgba(128,128,128,.08) 9px,rgba(128,128,128,.08) 18px)}
.ad-shot.none span{font:500 11px/1.4 var(--mono);color:var(--muted)}
.ad-copy{padding:13px 14px;display:flex;flex-direction:column;gap:7px}
.ad-copy h3{margin:0;font-size:14px;line-height:1.35}
.ad-copy .body{margin:0;font-size:12.5px;white-space:pre-wrap;overflow-wrap:anywhere;max-height:14em;overflow:auto}
.ad-copy .nocopy{margin:0;font-size:12px;color:var(--muted);font-style:italic}
.empty,.message{padding:22px 16px;text-align:center;font-size:13px;color:var(--muted);background:var(--sheet);border:1px solid var(--line);border-radius:var(--radius)}.message.error{border-color:#e7bdb8;border-left:3px solid var(--danger);background:#fdf5f4;color:#8f2b21}.message.warning{padding:0;text-align:left;border-color:#e8cf9f;border-left:3px solid var(--warning);background:#fffbf3;color:#6f4a08}

/* Every list row carries a hover rail. It is the cheapest way to make a dense
   table feel handled rather than dumped. */
.company,.person,.contact,.signal{transition:background .14s,box-shadow .14s}.company:hover,.person:hover,.contact:hover,.signal:hover{background:#fafbfc;box-shadow:inset 2px 0 0 var(--accent-2)}
.records .company{display:grid;grid-template-columns:28px minmax(0,1fr);gap:4px 10px;padding:13px 14px;border-bottom:1px solid var(--line)}.company:last-child,.person:last-child,.contact:last-child,.signal:last-child{border-bottom:0}.record-no{font:600 10px/1.8 var(--sans);letter-spacing:.06em;color:var(--faint)}.company h3,.person h3{margin:0;font:600 15px/1.32 var(--sans);letter-spacing:-.012em}.record-meta{margin-top:3px;font-size:12px;color:var(--muted)}.record-address{grid-column:2;font-size:12px;line-height:1.45;color:var(--muted)}.record-contact{grid-column:2;display:grid;gap:9px;margin-top:2px}.phone{font:600 15px/1.2 var(--sans);letter-spacing:-.01em}
.records .company.has-contact-research{background:#f3fbf7;border-left:4px solid var(--ok)}
.contact-pill{display:inline-flex;align-items:center;gap:6px;padding:2px 8px;background:#e6f7ef;border:1px solid #b7ebd3;border-radius:3px;font:700 11px/1.3 var(--sans);color:var(--ok);margin-top:5px;width:fit-content}
.contact-pill strong{font-weight:800}
.contact-pill.running{background:#fff7e6;border-color:#f0d68a;color:var(--warning)}
.actions{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.button{display:inline-flex;align-items:center;justify-content:center;gap:6px;min-height:36px;padding:0 13px;border:1px solid var(--ink);border-radius:var(--radius);background:var(--ink);color:#fff;font:var(--micro);font-size:10px;letter-spacing:.1em;text-transform:uppercase;text-decoration:none;cursor:pointer;transition:background .15s,border-color .15s,color .15s}.button:hover{background:var(--accent);border-color:var(--accent)}
.text-link{display:inline-flex;align-items:center;gap:6px;min-height:36px;padding:0 11px;border:1px solid var(--line);border-radius:var(--radius);background:var(--sheet);color:var(--muted);font:var(--micro);font-size:10px;letter-spacing:.1em;text-transform:uppercase;text-decoration:none;transition:color .15s,border-color .15s,background .15s}.text-link:hover{color:var(--ink);border-color:var(--ink);background:var(--soft)}.text-link span{color:var(--accent-2)}.id-tag{font:500 9px/1 var(--mono);color:var(--faint);text-transform:uppercase}
.button.research{background:var(--sheet);color:var(--ink);border-color:var(--ink)}.button.research:hover{background:var(--accent);border-color:var(--accent);color:#fff}.button.research[disabled]{opacity:.5;cursor:default;background:var(--soft);color:var(--muted);border-color:var(--line)}

/* The executive brief is the one thing a reader must not skim past, so it is
   the one block that inverts. */
.brief{margin-top:18px;padding:16px;background:var(--ink);color:#fff;border-radius:var(--radius)}.brief-label{margin-bottom:8px;font:var(--micro);letter-spacing:var(--track);text-transform:uppercase;color:#8fa8d6}.brief p{max-width:76ch;margin:0;font:400 14.5px/1.62 var(--sans);color:#eef1f5}.brief+.brief{margin-top:10px}.brief.identity{background:var(--sheet);color:var(--ink);border:1px solid var(--line);border-left:3px solid var(--accent-2)}.brief.identity .brief-label{color:var(--accent-2)}.brief.identity p{font-weight:500;color:var(--ink)}

.contact{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:4px 12px;padding:13px 14px;border-bottom:1px solid var(--line)}.label{grid-column:1/-1;font:var(--micro);letter-spacing:.11em;text-transform:uppercase;color:var(--faint)}.contact-value{font:600 15px/1.35 var(--sans);letter-spacing:-.012em;word-break:break-word}.source{margin-top:5px;font-size:11.5px;line-height:1.5;color:var(--muted)}.source a{color:var(--accent-2);text-decoration:none;border-bottom:1px solid rgba(47,95,184,.35)}.source a:hover{border-bottom-color:currentColor}

/* People get a rank chip rather than a bare number: at a glance the reader can
   see P01 is a rank and VERIFY is not. */
.person{display:grid;grid-template-columns:50px minmax(0,1fr);gap:4px 10px;padding:13px 14px;border-bottom:1px solid var(--line)}.person h3{display:flex;flex-wrap:wrap;align-items:center;gap:8px}.priority{align-self:start;justify-self:start;padding:3px 6px;border:1px solid var(--line);border-radius:var(--radius);background:var(--soft);font:var(--micro);letter-spacing:.07em;text-transform:uppercase;color:var(--accent)}.role{margin-top:4px;font:var(--micro);font-size:10px;letter-spacing:.09em;text-transform:uppercase;color:var(--muted)}.person p{grid-column:2;margin:6px 0 0;font-size:12.5px;line-height:1.5;color:var(--muted)}.person .text-link{grid-column:2;justify-self:start;margin-top:9px}

.signal{display:grid;gap:4px;padding:13px 14px;border-bottom:1px solid var(--line)}.date{font:var(--micro);font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:var(--accent-2)}.signal strong{font:600 13.5px/1.45 var(--sans);letter-spacing:-.005em}.message.warning .signal{border-bottom-color:#e8cf9f}.message.warning .signal:hover{background:transparent;box-shadow:none}.message.warning .date{color:var(--warning)}.message.warning .source{color:#6f4a08}

/* Outreach angles are prompts, not data. Ghost numerals let them read as a
   numbered list without a second bordered table. */
.angles{counter-reset:angle;display:grid;overflow:hidden}.angle{counter-increment:angle;position:relative;padding:16px 14px 16px 52px;border-bottom:1px solid var(--line);font-size:13.5px;line-height:1.5}.angle:last-child{border-bottom:0}.angle:before{content:counter(angle,decimal-leading-zero);position:absolute;left:12px;top:12px;font:600 22px/1 var(--sans);letter-spacing:-.04em;color:var(--soft)}

.breakdown{display:grid;gap:9px;margin-top:18px;padding:14px;background:var(--sheet);border:1px solid var(--line);border-left:3px solid var(--accent-2);border-radius:var(--radius)}.breakdown-label{font:var(--micro);letter-spacing:var(--track);text-transform:uppercase;color:var(--accent-2)}.breakdown-badges{display:flex;flex-wrap:wrap;gap:6px}.breakdown-note{max-width:72ch;margin:8px 0 0;font-size:11.5px;line-height:1.5;color:var(--muted)}

/* An evidence grade is a verdict, so it gets a status dot like one. */
.grade{display:inline-flex;align-items:center;gap:5px;margin-right:6px;padding:3px 8px;border:1px solid var(--line);border-radius:999px;background:var(--sheet);font:var(--micro);letter-spacing:.07em;text-transform:uppercase;color:var(--muted);white-space:nowrap;vertical-align:middle}.grade:before{content:"";width:5px;height:5px;border-radius:50%;background:currentColor;flex:none}.grade.strong{border-color:#9fd3bd;background:#f0faf6;color:var(--ok)}.grade.weak{border-color:#e8cf9f;background:#fffbf3;color:var(--warning)}.grade.thin{border-color:#e7bdb8;background:#fdf5f4;color:var(--danger)}.person p .grade,.breakdown .grade{margin:0}

.language-switch{display:inline-flex;gap:2px;margin:18px 0 -8px;padding:3px;border:1px solid var(--line);border-radius:var(--radius);background:var(--sheet)}.language-button{min-height:30px;padding:0 14px;border:0;border-radius:var(--radius);background:transparent;color:var(--muted);font:var(--micro);font-size:10px;letter-spacing:.1em;text-transform:uppercase;cursor:pointer}.language-button[aria-pressed="true"]{background:var(--ink);color:#fff}.language-button:hover{color:var(--ink)}.language-button[aria-pressed="true"]:hover{color:#fff}

.foot{display:grid;gap:5px;margin-top:34px;padding-top:13px;border-top:2px solid var(--ink);font:var(--micro);letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}
:focus-visible{outline:2px solid var(--accent-2);outline-offset:2px}@media(prefers-reduced-motion:reduce){*{scroll-behavior:auto!important;transition:none!important}}
@media(hover:none){.company:hover,.person:hover,.contact:hover,.signal:hover{background:transparent;box-shadow:none}}

@media(min-width:760px){
.wrap{padding:0 28px 56px}.topbar-in{height:52px;padding:0 28px}.wordmark-text{display:inline}
.hero{grid-template-columns:minmax(0,1fr) 268px;gap:36px;padding:34px 0 28px}.hero-meta{align-self:start;padding:15px 16px}
.metrics{grid-template-columns:repeat(4,1fr)}.metric{padding:15px 16px 13px}.metric:before{left:16px}.metric strong{font-size:26px}
.section{padding-top:34px}.section-head{grid-template-columns:minmax(0,1fr) minmax(200px,340px);align-items:end;gap:24px}.section-note{text-align:right;padding-bottom:2px}
.records .company{grid-template-columns:32px minmax(170px,1.1fr) minmax(170px,1fr) minmax(230px,.9fr);gap:16px;align-items:start;padding:14px 16px}.record-address,.record-contact{grid-column:auto;margin-top:0}
.brief{display:grid;grid-template-columns:150px minmax(0,1fr);gap:22px;padding:20px}.brief-label{margin:3px 0 0}
.contact{grid-template-columns:165px minmax(0,1fr) auto;gap:16px;padding:14px 16px}.label{grid-column:auto;align-self:center}
.person{grid-template-columns:52px minmax(150px,.8fr) minmax(220px,1.2fr) auto;gap:16px;align-items:start;padding:14px 16px}.person p{grid-column:auto;margin-top:0}.person .text-link{grid-column:auto;margin-top:0}
.signal{grid-template-columns:150px minmax(0,1fr);gap:16px;padding:14px 16px}
.angles{grid-template-columns:repeat(2,1fr)}.angle:nth-child(odd){border-right:1px solid var(--line)}
.breakdown{grid-template-columns:150px minmax(0,1fr);gap:22px;padding:16px 18px}
.foot{display:flex;justify-content:space-between;gap:16px}
}`;

function shell(report: PublishedReport, body: string): string {
  const active = report.status === 'queued' || report.status === 'running';
  const isSearch = report.report_type === 'business_search';
  const isPerson = report.report_type === 'person_research';
  const isAds = report.report_type === 'ads_research';
  const isContact = report.report_type === 'contact_research';
  const isParallelContact = isContact && report.request?.provider === 'parallel';
  const pendingOver24h = isContact && active
    && Date.now() - Date.parse(String(report.created_at)) >= 24 * 60 * 60_000;
  const statusLabel = report.status === 'completed' ? 'Research complete'
    : report.status === 'partial' ? 'Complete · noted gaps'
    : report.status === 'failed' ? 'Research failed'
    : pendingOver24h ? 'Pending >24 hours'
    : isContact ? 'Pending'
    : report.status;
  // How many of the four round pips are lit. Driven by status because this page
  // never loads round_status. `failed` lights none: the honest floor for a run
  // that produced nothing is nothing, and it used to light two.
  const roundsLit = report.status === 'failed' ? 0
    : report.status === 'completed' ? 4
    : report.status === 'partial' ? 3
    : report.status === 'queued' ? 1 : 2;
  const reportLabel = isSearch ? 'Company list' : isPerson ? 'Person research' : isAds ? 'Ads research' : isParallelContact ? 'Parallel contact research' : isContact ? 'Contact research' : 'Company dossier';
  // A re-researched company keeps every earlier dossier. Say which pass this is,
  // in the kicker and the masthead folio, so two open tabs are never ambiguous.
  const version = Number(report.version) > 1 ? 'V' + Number(report.version) : '';
  // The masthead sits outside the measure so its ink band runs the full width
  // of the viewport rather than stopping at the text column.
  const masthead = `<a class="wordmark" href="/research"><span class="mark">EE</span><span class="wordmark-text">Business intelligence</span></a><div class="topnav">${navHtml(CLIENT_NAV, '')}</div><div class="folio">${esc(reportLabel)}${version ? ' · ' + version : ''}<br>${esc(report.public_id)}</div>`;
  // Inter is the report typeface, not merely first in a fallback stack. The
  // stack in --sans only covers the moment before the webfont lands.
  const fonts = '<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap">';
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">${fonts}
<meta name="theme-color" content="#f2f4f6"><title>${esc(report.title ?? 'Business intelligence report')}</title>
<style>${CSS}</style></head><body class="${esc(report.report_type.replace('_', '-'))}"><div class="topbar"><nav class="topbar-in" aria-label="Site">${masthead}</nav></div><main class="wrap">
<header class="hero"><div><div class="kicker">${esc(reportLabel)} · ${esc(reportDate(report))}${version ? ' · ' + version : ''}</div><h1>${esc(report.title ?? 'Research report')}</h1><p class="hero-copy">${active ? 'Research is in progress. This permanent report link refreshes as verified findings arrive.' : report.error ? esc(report.error) : isSearch ? 'A ranked field scan of relevant businesses, with direct routes to source listings and published contact points.' : isAds ? 'Every ad the company is currently running, as published in the Facebook and Google ad libraries.' : isContact ? 'Telemarketing-focused decision maker and contact intelligence for outbound sales.' : 'A source-linked intelligence brief designed for qualification, outreach and informed decision-making.'}</p></div><aside class="hero-meta"><div class="status ${esc(report.status)}"><span class="status-dot"></span>${esc(statusLabel)}</div><div class="meta-line"><span>Issued ${esc(reportDate(report))}</span>${version ? `<span>Research pass ${esc(version)}</span>` : ''}<span>${isSearch ? 'Source / Google Maps' : isAds ? 'Source / Ad libraries' : 'Evidence / Public sources'}</span></div>${!isSearch && !isAds && !isContact ? `<div class="rounds" aria-label="Four research rounds">${[0, 1, 2, 3].map((i) => `<span class="round ${i < roundsLit ? 'on' : ''}"></span>`).join('')}</div>` : ''}</aside></header>
${body}<footer class="foot"><span>EE Business Intelligence · Confidential link</span><span>Evidence opens at its original public source</span></footer>
</main>${active ? '<script>setTimeout(()=>location.reload(),8000)</script>' : ''}${isSearch ? researchScript(report.public_id) : ''}</body></html>`;
}

/**
 * The run's trail, oldest first.
 *
 * This page exists because answering "where did this run stop" used to mean
 * joining a text file on the mini, a run directory on the mini, a Postgres row
 * and a Railway stdout buffer -- by wall-clock timestamp, by hand. One id, one
 * page, in order.
 */
export function logPage(report: PublishedReport, events: Record<string, unknown>[]): string {
  const t0 = events.length ? Date.parse(String(events[0]!.at)) : 0;
  const rows = events.map((e) => {
    const at = Date.parse(String(e.at));
    const offset = t0 ? Math.round((at - t0) / 1000) : 0;
    const event = String(e.event ?? '');
    const tone = /failed|evicted|error/.test(event) ? 'error'
      : /completed|done|saved/.test(event) ? 'ok' : '';
    const detail = obj(e.detail);
    const cells = Object.entries(detail)
      .filter(([, v]) => v !== null && v !== '' && !(Array.isArray(v) && !v.length))
      .map(([k, v]) => `<span class="kv"><b>${esc(k)}</b> ${esc(typeof v === 'object' ? JSON.stringify(v) : v)}</span>`)
      .join(' ');
    return `<tr class="${tone}">
      <td class="mono">+${esc(offset)}s</td>
      <td class="mono">${esc(String(e.at).slice(11, 19))}</td>
      <td>${esc(e.stage ?? '—')}</td>
      <td><strong>${esc(event)}</strong></td>
      <td class="mono">${esc(e.job_id ?? '')}</td>
      <td class="detail">${cells || '<span class="kv muted">—</span>'}</td>
    </tr>`;
  }).join('');

  const body = `<section class="section">
    <h2>Run trail</h2>
    <p class="section-note">${esc(events.length)} events, oldest first. Written as the run happened, not assembled at the end &mdash; so a run stopped by a restart still shows where it stopped.</p>
    <style>
      .trail{width:100%;border-collapse:collapse;font-size:13px;margin-top:16px}
      .trail th{text-align:left;padding:6px 10px;border-bottom:2px solid currentColor;opacity:.55;font-size:11px;letter-spacing:.08em;text-transform:uppercase}
      .trail td{padding:7px 10px;border-bottom:1px solid rgba(128,128,128,.22);vertical-align:top}
      .trail .mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;white-space:nowrap;opacity:.75}
      .trail tr.error td{background:rgba(200,40,40,.09)}
      .trail tr.error strong{color:#c02626}
      .trail tr.ok strong{color:#1a7f4b}
      .trail .detail{max-width:520px}
      .trail .kv{display:inline-block;margin:0 10px 3px 0;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11.5px;word-break:break-word}
      .trail .kv b{opacity:.55;font-weight:600}
      .trail .kv.muted{opacity:.4}
    </style>
    <table class="trail">
      <thead><tr><th>+</th><th>Time</th><th>Stage</th><th>Event</th><th>Job</th><th>Detail</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="6">No events recorded for this run. Runs started before the trail existed have none.</td></tr>'}</tbody>
    </table>
    <p class="section-note" style="margin-top:18px"><a class="text-link" href="/r/${esc(report.public_id)}">&larr; Back to the report</a></p>
  </section>`;
  return shell(report, body);
}

export function notFoundPage(): string {
  const fake = { public_id: '', report_type: 'business_search', status: 'failed', title: 'Report not found', error: 'This report link is invalid or no longer available.', created_at: new Date().toISOString(), updated_at: new Date().toISOString() } as PublishedReport;
  return shell(fake, '<section class="section"><div class="message error">Check that the complete report link was copied.</div></section>');
}

export function searchPage(report: PublishedReport, detail: { report?: Record<string, unknown>; companies?: Record<string, unknown>[] } | null): string {
  const request = obj(report.request);
  const scan = obj(detail?.report ?? report.result?.search);
  const companies = detail?.companies ?? arr(report.result?.companies);
  const keyword = value(request, 'keyword');
  const place = value(request, 'place', 'location');
  const stats = `<div class="metrics">
    <div class="metric"><strong>${esc(scan.found ?? companies.length ?? '—')}</strong><span>Businesses found</span></div>
    <div class="metric"><strong>${esc(companies.filter((c) => value(c, 'phone')).length)}</strong><span>Published phones</span></div>
    <div class="metric"><strong>${esc(companies.filter((c) => value(c, 'website')).length)}</strong><span>Direct websites</span></div>
    <div class="metric"><strong>${esc(place || 'Any')}</strong><span>Search geography</span></div>
  </div>`;
  const rows = companies.map((company, index) => {
    const name = value(company, 'name') || 'Unnamed business';
    const phone = value(company, 'phone');
    const rating = value(company, 'rating');
    const reviews = value(company, 'reviews');
    const website = value(company, 'website');
    const maps = value(company, 'maps_url', 'mapsUrl');
    const companyId = value(company, 'id');
    const contactPublicId = value(company, 'contact_public_id');
    const contactStatus = value(company, 'contact_status');
    const contactPhones = Number(company.contact_phones_count) || 0;
    const contactDMs = Number(company.contact_decision_makers_count) || 0;
    const hasContact = Boolean(contactPublicId && (contactStatus === 'completed' || contactStatus === 'partial'));
    // A queued or running report is not an untouched row: without this, a
    // reload after queue-all renders every one of them as a fresh Contacts
    // button — the walk looks like it did nothing, and the bulk count offers
    // to queue the same companies a second time.
    const contactUnderway = Boolean(contactPublicId && (contactStatus === 'queued' || contactStatus === 'running'));
    const contactPill = hasContact
      ? `<div class="contact-pill">📞 <strong>${contactPhones} Contact Number${contactPhones === 1 ? '' : 's'} Found</strong>${contactDMs > 0 ? ` · ${contactDMs} Leader${contactDMs === 1 ? '' : 's'}` : ''}</div>`
      : contactUnderway ? `<div class="contact-pill running">⏳ Contact research in progress…</div>` : '';
    const contactAction = hasContact
      ? `<a class="button" style="background:#0a6b47;color:#fff;border-color:#0a6b47;font-weight:700" target="_blank" rel="noopener" href="/r/${esc(contactPublicId)}">Contacts (${contactPhones} phones) ↗</a>`
      : contactUnderway
        ? `<a class="button" style="background:#fff7e6;color:#a15c07;border-color:#f0d68a;font-weight:700" target="_blank" rel="noopener" href="/r/${esc(contactPublicId)}">⏳ Researching…</a>`
        : (companyId ? `<button class="button" style="background:#0a6b47;color:#fff;border-color:#0a6b47" type="button" data-contact="${esc(companyId)}" data-name="${esc(name)}">Contacts ⚡</button>` : '');
    const rerunAction = hasContact && companyId
      ? `<button class="button" type="button" data-rerun-contact="${esc(companyId)}" data-previous-report="${esc(contactPublicId)}">Rerun original contacts ↻</button>`
      : '';
    return `<article class="company${hasContact ? ' has-contact-research' : ''}"><div class="record-no">${esc(rank(company.rank ?? index + 1))}</div><div><h3>${esc(name)}</h3><div class="record-meta">${esc(value(company, 'category') || 'Business')}${rating ? ` · ★ ${esc(rating)}${reviews ? ` / ${esc(reviews)} reviews` : ''}` : ''}</div>${contactPill}</div><div class="record-address">${esc(value(company, 'address') || 'Address not published')}</div><div class="record-contact">${phone ? `<div class="phone">${esc(phone)}</div>` : '<span class="record-meta">Phone not published</span>'}<div class="actions">${phone ? `<a class="button" href="tel:${esc(phone.replace(/[^+\d]/g, ''))}">Call now</a>` : ''}${link(website, 'Website')}${link(maps, 'Maps')}${companyId ? `<button class="button research" type="button" data-company="${esc(companyId)}" data-name="${esc(name)}">Research \u2192</button>` : ''}${contactAction}${rerunAction}${companyId ? `<button class="button" type="button" data-parallel-contact="${esc(companyId)}">Parallel contacts ↗</button>` : ''}</div></div></article>`;
  }).join('');
  // Rows still showing the per-row Contacts button — the ones one click can
  // queue. A list where every row already links to its dossier earns no bulk
  // button, because there would be nothing left for it to do.
  const pendingContacts = companies.filter((company) => {
    const status = value(company, 'contact_status');
    const publicId = value(company, 'contact_public_id');
    // Settled rows — finished, or already queued/running — render no Contacts
    // button, so the bulk count must skip them too: the count is the number of
    // data-contact buttons this page actually shows. A failed run still counts;
    // re-queueing it is a retry the server allows.
    const settled = publicId && (status === 'completed' || status === 'partial' || status === 'queued' || status === 'running');
    return Boolean(value(company, 'id')) && !settled;
  }).length;
  const queueAll = pendingContacts
    ? `<div class="actions" style="margin-bottom:12px"><button class="button" style="background:#0a6b47;color:#fff;border-color:#0a6b47;font-weight:700" type="button" data-contact-all="${pendingContacts}">Contacts ⚡ — queue all ${pendingContacts}</button></div>`
    : '';
  const body = report.status === 'failed'
    ? `<section class="section"><div class="message error">${esc(report.error ?? 'The search failed.')}</div></section>`
    : `${stats}<section class="section"><div class="section-head"><h2>${esc(keyword || 'Business')} directory</h2><span class="section-note">Ranked in the order returned by Google Maps. Each source opens independently.</span></div>${queueAll}<div class="records">${rows || '<div class="empty">Waiting for businesses…</div>'}</div></section>`;
  return shell(report, body);
}

function chineseCompanyVersion(translated: Record<string, unknown>, briefs: Record<string, { public_id: string; status: string }>, autoReportId: string, autoName: string, researchable: boolean): string {
  const contacts = arr(translated.contacts);
  const people = arr(translated.people);
  const candidatePeople = arr(translated.candidate_people);
  const signals = arr(translated.signals ?? translated.business_signals);
  const conflicts = arr(translated.conflicts_and_unknowns);
  const outreach = strings(translated.outreach_angles);
  const summary = value(translated, 'summary', 'executive_summary');
  const contactRows = contacts.map((row) => {
    const raw = value(row, 'value_as_published', 'raw_value', 'value', 'normalized_value');
    const evidence = value(row, 'evidence_url', 'evidence', 'source_url');
    return `<div class="contact"><div class="label">${esc(value(row, 'purpose', 'channel', 'type') || '联系方式')}</div><div><div class="contact-value">${esc(raw)}</div><div class="source">${grade(row, true)}${esc(value(row, 'status', 'current_status', 'evidence_class'))}${evidence ? ` · <a href="${esc(evidence)}" target="_blank" rel="noopener">查看来源 ↗</a>` : ''}</div></div></div>`;
  }).join('');
  const peopleRows = people.map((row, i) => {
    const personName = value(row, 'name');
    const personId = value(row, 'id');
    const isAuto = Boolean(autoReportId) && personName.trim().toLocaleLowerCase() === autoName;
    const existing = briefs[personId] ?? (isAuto && autoReportId ? { public_id: autoReportId, status: 'running' } : null);
    const control = existing
      ? ` <a class="button" href="/r/${esc(existing.public_id)}">${existing.status === 'completed' || existing.status === 'partial' ? '查看简报' : '简报进行中'} <span aria-hidden="true">&#8599;</span></a>`
      : personId && researchable
        ? ` <button class="button research" type="button" data-person="${esc(personId)}" data-name="${esc(personName)}">人物调研 <span aria-hidden="true">&rarr;</span></button>`
        : '';
    return `<article class="person"><span class="priority">P${esc(rank(row.priority ?? i + 1))}</span><div><h3>${esc(value(row, 'name'))}${control}</h3><div class="role">${esc(value(row, 'role', 'current_role', 'position'))}</div></div><p>${esc(value(row, 'relevance', 'domain', 'why_relevant'))}${grade(row, true)}</p>${link(value(row, 'role_url', 'source', 'evidence_url'), '来源')}</article>`;
  }).join('');
  const candidateRows = candidatePeople.map((row) => `<article class="person"><span class="priority">待核实</span><div><h3>${esc(value(row, 'name'))}</h3><div class="role">${esc(value(row, 'role', 'current_role'))}</div></div><p>${esc(value(row, 'verification_note', 'relevance'))}</p>${link(value(row, 'source_url'), '来源')}</article>`).join('');
  const signalRows = signals.map((row) => `<div class="signal"><div class="date">${esc(value(row, 'date') || '当前')}</div><div><strong>${esc(value(row, 'fact', 'description', 'signal'))}</strong><div class="source">${grade(row, true)}${esc(value(row, 'evidence_class', 'type', 'source_class'))} ${link(value(row, 'evidence_url', 'evidence', 'source_url'), '来源')}</div></div></div>`).join('');
  const conflictRows = conflicts.map((row) => `<div class="signal"><div class="date">需核实</div><div><strong>${esc(value(row, 'issue', 'field'))}</strong><div class="source">${esc(value(row, 'details', 'status', 'note'))}</div></div></div>`).join('');
  let body = `<section class="section" lang="zh-CN"><div class="section-head"><h2>中文报告</h2><span class="section-note">与英文版对应的简体中文翻译；来源、ID 和联系方式保持原样。</span></div></section>`;
  body += evidenceTally([contacts, people, signals], true);
  if (summary) body += `<section class="brief" lang="zh-CN"><div class="brief-label">执行摘要</div><p>${esc(summary)}</p></section>`;
  body += `<section class="section" lang="zh-CN"><div class="section-head"><h2>最佳联系渠道</h2><span class="section-note">仅展示经证据台账保留的联系方式。</span></div><div class="contact-list">${contactRows || '<div class="empty">暂无已验证的联系方式。</div>'}</div></section>`;
  body += `<section class="section" lang="zh-CN"><div class="section-head"><h2>关键相关人员</h2><span class="section-note">当前职位均需有直接来源支持。</span></div><div class="people">${peopleRows || '<div class="empty">暂无已验证的相关人员。</div>'}</div></section>`;
  if (candidatePeople.length) body += `<section class="section" lang="zh-CN"><div class="section-head"><h2>待核实人员线索</h2><span class="section-note">来自具名公开来源；在确认当前职位前请勿作为事实使用。</span></div><div class="people">${candidateRows}</div></section>`;
  if (outreach.length) body += `<section class="section" lang="zh-CN"><div class="section-head"><h2>沟通切入点</h2><span class="section-note">根据已验证研究得出的对话建议。</span></div><div class="angles">${outreach.map((item) => `<div class="angle">${esc(item)}</div>`).join('')}</div></section>`;
  body += `<section class="section" lang="zh-CN"><div class="section-head"><h2>业务动态</h2><span class="section-note">可能形成沟通理由的时效性证据。</span></div><div class="signal-list">${signalRows || '<div class="empty">暂无已验证的业务动态。</div>'}</div></section>`;
  if (conflictRows) body += `<section class="section" lang="zh-CN"><div class="section-head"><h2>冲突与未知项</h2></div><div class="message warning">${conflictRows}</div></section>`;
  return body;
}

export function companyPage(
  report: PublishedReport,
  chinese: Record<string, unknown> | null = null,
  /** personId -> the VIP brief already started for them, from listPersonBriefs(). */
  briefs: Record<string, { public_id: string; status: string }> = {},
  /** The ads report already started for this company, from findAdsReport(). */
  adsReport: { public_id: string; status: string } | null = null,
): string {
  const final = obj(report.result);
  const entity = obj(final.entity);
  const contacts = arr(final.contacts);
  const people = arr(final.people);
  const candidatePeople = arr(final.candidate_people);
  const signals = arr(final.signals ?? final.business_signals);
  const conflicts = arr(final.conflicts_and_unknowns);
  const outreach = strings(final.outreach_angles);
  const summary = value(final, 'summary', 'executive_summary');
  const autoPerson = obj(final.auto_person_research);
  const autoPersonReportId = /^[A-Za-z0-9_-]{20}$/.test(value(autoPerson, 'report_id')) ? value(autoPerson, 'report_id') : '';
  const stats = `<div class="metrics">
    <div class="metric"><strong>${contacts.length || '—'}</strong><span>Contact routes</span></div>
    <div class="metric"><strong>${people.length || '—'}</strong><span>Relevant people</span></div>
    <div class="metric"><strong>${signals.length || '—'}</strong><span>Business signals</span></div>
    <div class="metric"><strong>${esc(value(entity, 'rating', 'maps_rating') || '—')}</strong><span>Maps rating</span></div>
  </div>`;
  const contactRows = contacts.map((row) => {
    const raw = value(row, 'value_as_published', 'raw_value', 'value', 'normalized_value');
    const normalized = value(row, 'normalized_value');
    const evidence = value(row, 'evidence_url', 'evidence', 'source_url');
    const action = /@/.test(raw) ? `<a class="button" href="mailto:${esc(raw)}">Email</a>` : /\d/.test(raw) ? `<a class="button" href="tel:${esc((normalized || raw).replace(/[^+\d]/g, ''))}">Call</a>` : link(raw, 'Open', 'button');
    return `<div class="contact"><div class="label">${esc(value(row, 'purpose', 'channel', 'type') || 'Contact')}</div><div><div class="contact-value">${esc(raw)}</div><div class="source">${grade(row)}${esc(value(row, 'status', 'current_status', 'evidence_class'))}${evidence ? ` · <a href="${esc(evidence)}" target="_blank" rel="noopener">view evidence ↗</a>` : ''}</div></div>${action}</div>`;
  }).join('');
  const autoPersonName = value(autoPerson, 'person_name').trim().toLocaleLowerCase();
  // Every validated person is one click from their own brief. Which control they
  // get depends only on whether a brief already exists: a link to it, or a button
  // that starts one. Before this, only P01 -- the person the pipeline researches
  // automatically -- had any control at all, and the other fifteen were dead text.
  const researchable = report.status === 'completed' || report.status === 'partial';
  const peopleRows = people.map((row, i) => {
    const personName = value(row, 'name');
    const personId = value(row, 'id');
    const isAutoPerson = Boolean(autoPersonReportId) && personName.trim().toLocaleLowerCase() === autoPersonName;
    const existing = briefs[personId] ?? (isAutoPerson && autoPersonReportId ? { public_id: autoPersonReportId, status: 'running' } : null);
    const control = existing
      ? ` <a class="button" href="/r/${esc(existing.public_id)}">${existing.status === 'completed' || existing.status === 'partial' ? 'Open brief' : 'Brief underway'} <span aria-hidden="true">↗</span></a>`
      : personId && researchable
        ? ` <button class="button research" type="button" data-person="${esc(personId)}" data-name="${esc(personName)}">Person research <span aria-hidden="true">→</span></button>`
        : '';
    return `<article class="person"><span class="priority">P${esc(rank(row.priority ?? i + 1))}</span><div><h3>${esc(personName)}${control}</h3><div class="role">${esc(value(row, 'role', 'current_role', 'position'))}</div></div><p>${esc(value(row, 'relevance', 'domain', 'why_relevant'))}${grade(row)}</p>${link(value(row, 'role_url', 'source', 'evidence_url'), 'Evidence')}</article>`;
  }).join('');
  const candidateRows = candidatePeople.map((row) => `<article class="person"><span class="priority">VERIFY</span><div><h3>${esc(value(row, 'name'))}</h3><div class="role">${esc(value(row, 'role', 'current_role'))}</div></div><p>${esc(value(row, 'verification_note', 'relevance'))}</p>${link(value(row, 'source_url'), 'Source')}</article>`).join('');
  const signalRows = signals.map((row) => `<div class="signal"><div class="date">${esc(value(row, 'date') || 'Current')}</div><div><strong>${esc(value(row, 'fact', 'description', 'signal'))}</strong><div class="source">${grade(row)}${esc(value(row, 'evidence_class', 'type', 'source_class'))} ${link(value(row, 'evidence_url', 'evidence', 'source_url'), 'Source')}</div></div></div>`).join('');
  const conflictRows = conflicts.map((row) => `<div class="signal"><div class="date">Review</div><div><strong>${esc(value(row, 'issue', 'field'))}</strong><div class="source">${esc(value(row, 'details', 'status', 'note'))}</div></div></div>`).join('');
  let body = stats + evidenceTally([contacts, people, signals]);
  if (summary) body += `<section class="brief"><div class="brief-label">Executive brief</div><p>${esc(summary)}</p></section>`;
  // One ads action for the company as a whole -- the dossier says who they are; this
  // says what they are currently telling the market. A run already started is linked
  // rather than offered again.
  const adsControl = adsReport
    ? `<a class="button" href="/r/${esc(adsReport.public_id)}">${adsReport.status === 'completed' || adsReport.status === 'partial' ? 'Open ads report' : 'Ads capture underway'} <span aria-hidden="true">↗</span></a>`
    : researchable
      ? `<button class="button research" type="button" data-ads="1" data-name="${esc(value(entity, 'name', 'legal_name', 'registered_name') || report.title || '')}">Research their ads <span aria-hidden="true">→</span></button>`
      : '';
  if (adsControl) body += `<section class="brief"><div class="brief-label">Advertising</div><p>Capture every ad this company is currently running on Facebook and Google. ${adsControl}</p></section>`;
  if (report.status === 'failed') body += `<section class="section"><div class="message error">${esc(report.error ?? 'Deep research failed.')}</div></section>`;
  else if (!contacts.length && !people.length && !candidatePeople.length && report.status !== 'completed' && report.status !== 'partial') body += '<section class="section"><div class="empty">The research rounds are running. Verified findings will appear here automatically.</div></section>';
  else {
    body += `<section class="section"><div class="section-head"><h2>Best contact routes</h2><span class="section-note">Only channels retained by the evidence ledger are shown.</span></div><div class="contact-list">${contactRows || '<div class="empty">No validated contacts.</div>'}</div></section>`;
    body += `<section class="section"><div class="section-head"><h2>Decision-relevant people</h2><span class="section-note">Current roles require a direct supporting source.</span></div><div class="people">${peopleRows || '<div class="empty">No validated people.</div>'}</div></section>`;
    if (candidatePeople.length) body += `<section class="section"><div class="section-head"><h2>People to verify</h2><span class="section-note">Named public-source leads. Confirm their current role before treating it as fact or starting VIP research.</span></div><div class="people">${candidateRows}</div></section>`;
    if (outreach.length) body += `<section class="section"><div class="section-head"><h2>Outreach angles</h2><span class="section-note">Conversation starters derived from the validated research set.</span></div><div class="angles">${outreach.map((item) => `<div class="angle">${esc(item)}</div>`).join('')}</div></section>`;
    body += `<section class="section"><div class="section-head"><h2>Business signals</h2><span class="section-note">Time-sensitive evidence that may create a reason to engage.</span></div><div class="signal-list">${signalRows || '<div class="empty">No validated signals.</div>'}</div></section>`;
    if (conflictRows) body += `<section class="section"><div class="section-head"><h2>Conflicts and unknowns</h2></div><div class="message warning">${conflictRows}</div></section>`;
  }
  // Same contract as the person button below: the button only posts, the server
  // decides. /api/ads-research joins a capture that is already running rather than
  // starting a second, so a double-click costs nothing.
  if (body.includes('data-ads="1"')) {
    body += `<script>(function(){
var button=document.querySelector('button.research[data-ads]');
if(!button)return;
${TOKEN_STORE_JS}
var COMPANY=${JSON.stringify(String(report.company_id ?? ''))};
function accessKey(){
  var stored=eeKey.read();
  if(stored)return stored;
  var typed=(window.prompt('Access key to capture their ads')||'').trim();
  return typed?eeKey.save(typed):'';
}
function restore(markup,message){button.disabled=false;button.innerHTML=markup;if(message)window.alert(message)}
button.addEventListener('click',function(){
  var markup=button.innerHTML;
  var key=accessKey();
  if(!key)return;
  button.disabled=true;button.textContent='Starting…';
  fetch('/api/ads-research',{
    method:'POST',
    headers:{'Authorization':'Bearer '+key,'Content-Type':'application/json'},
    body:JSON.stringify({name:button.getAttribute('data-name'),companyId:COMPANY,requesterId:'report'})
  }).then(function(response){
    return response.text().then(function(text){
      var payload={};
      try{payload=text?JSON.parse(text):{}}catch(err){payload={}}
      if(response.status===401||response.status===403){
        eeKey.clear();
        return restore(markup,'That access key was rejected. Try again.');
      }
      if(!response.ok)return restore(markup,(payload&&payload.error)||('Could not start ads capture: '+response.status));
      var view=payload.report&&payload.report.view_url;
      if(typeof view==='string'&&view.indexOf('http')===0){
        var open=document.createElement('a');
        open.className='button';
        open.href=view;
        open.textContent='Ads capture underway ↗';
        button.replaceWith(open);
      }else{button.disabled=true;button.textContent='Ads capture underway'}
    });
  }).catch(function(err){restore(markup,err.message||'Could not reach the server.')});
});
}())<\/script>`;
  }
  // The button only posts; the server decides. /api/person-research already
  // joins a brief that is running rather than starting a second four-round pass,
  // so a double-click costs nothing. The access key is the portal's own, read
  // through eeKey on the same origin and sent only as a bearer header -- never
  // put in the URL, never written to the page. It is asked for once, on the first
  // report where no key is stored yet, and only again if the server rejects it.
  if (peopleRows.includes('class="button research"')) {
    body += `<script>(function(){
var buttons=document.querySelectorAll('button.research[data-person]');
if(!buttons.length)return;
${TOKEN_STORE_JS}
var REPORT=${JSON.stringify(report.public_id)};
function accessKey(){
  var stored=eeKey.read();
  if(stored)return stored;
  var typed=(window.prompt('Access key to start VIP research')||'').trim();
  return typed?eeKey.save(typed):'';
}
function restore(button,markup,message){button.disabled=false;button.innerHTML=markup;if(message)window.alert(message)}
buttons.forEach(function(button){
  button.addEventListener('click',function(){
    var markup=button.innerHTML;
    var key=accessKey();
    if(!key)return;
    button.disabled=true;button.textContent='Starting…';
    fetch('/api/person-research',{
      method:'POST',
      headers:{'Authorization':'Bearer '+key,'Content-Type':'application/json'},
      body:JSON.stringify({companyResearchId:REPORT,personId:button.getAttribute('data-person'),requesterId:'report'})
    }).then(function(response){
      return response.text().then(function(text){
        var payload={};
        try{payload=text?JSON.parse(text):{}}catch(err){payload={}}
        if(response.status===401||response.status===403){
          eeKey.clear();
          return restore(button,markup,'That access key was rejected. Try again.');
        }
        if(!response.ok)return restore(button,markup,(payload&&payload.error)||('Could not start research: '+response.status));
        var view=payload.report&&payload.report.view_url;
        if(typeof view==='string'&&view.indexOf('http')===0){
          var open=document.createElement('a');
          open.className='button';
          open.href=view;
          open.textContent='Brief underway ↗';
          button.replaceWith(open);
        }else{button.disabled=true;button.textContent='Brief underway'}
      });
    }).catch(function(err){restore(button,markup,err.message||'Could not reach the server.')});
  });
});
}())<\/script>`;
  }
  if (chinese) {
    const englishBody = body;
    const chineseBody = chineseCompanyVersion(chinese, briefs, autoPersonReportId, autoPersonName, researchable);
    body = `<div class="language-switch" role="group" aria-label="Report language"><button class="language-button" type="button" data-report-language="en" aria-pressed="true">English</button><button class="language-button" type="button" data-report-language="zh-CN" aria-pressed="false">中文</button></div><div data-report-language-panel="en">${englishBody}</div><div data-report-language-panel="zh-CN" hidden>${chineseBody}</div><script>(function(){const buttons=document.querySelectorAll('[data-report-language]');const panels=document.querySelectorAll('[data-report-language-panel]');function select(language){buttons.forEach((button)=>button.setAttribute('aria-pressed',String(button.getAttribute('data-report-language')===language)));panels.forEach((panel)=>{panel.hidden=panel.getAttribute('data-report-language-panel')!==language;});}buttons.forEach((button)=>button.addEventListener('click',()=>select(button.getAttribute('data-report-language'))));}())</script>`;
  }
  return shell(report, body);
}

export function adsPage(report: PublishedReport): string {
  const final = obj(report.result);
  const ads = arr(final.ads);
  const networks = obj(final.networks);
  const fb = ads.filter((row) => value(row, 'network') === 'facebook');
  const gg = ads.filter((row) => value(row, 'network') === 'google');
  const stats = `<div class="metrics">
    <div class="metric"><strong>${ads.length || '—'}</strong><span>Live ads</span></div>
    <div class="metric"><strong>${fb.length || '—'}</strong><span>Facebook</span></div>
    <div class="metric"><strong>${gg.length || '—'}</strong><span>Google</span></div>
    <div class="metric"><strong>${esc(value(final, 'region') || '—')}</strong><span>Region</span></div>
  </div>`;

  // Google publishes no ad text, so its rows carry no headline or body. Say that on
  // the row rather than rendering a blank that reads as a capture failure.
  //
  // The creative arrives as a data URI on the ad itself: the images are files on
  // the mini's disk and there is no blob store between it and here, so the worker
  // downscales each one and carries it inside the job result. Without this the
  // report is text ABOUT ads that nobody can see, which is what shipped first.
  const row = (ad: Record<string, unknown>) => {
    const net = value(ad, 'network');
    const headline = value(ad, 'headline');
    const body = value(ad, 'body');
    const cta = value(ad, 'cta');
    const when = value(ad, 'started_running') || value(ad, 'last_shown');
    const url = value(ad, 'library_url');
    const copy = headline || body
      ? `<strong>${esc(headline || '')}</strong>${body ? `<div class="source">${esc(body.slice(0, 300))}</div>` : ''}`
      : `<strong>${esc(value(ad, 'format') || 'Ad')}</strong><div class="source">${net === 'google' ? 'Google publishes no ad text — the wording is inside the creative.' : 'No text on this ad.'}</div>`;
    const img = typeof ad.image === 'string' && ad.image.startsWith('data:')
      ? `<div class="ad-shot"><img loading="lazy" src="${esc(ad.image)}" alt=""></div>`
      : `<div class="ad-shot none"><span>${esc(value(ad, 'image_error') || 'creative not captured')}</span></div>`;
    return `<div class="ad-card">${img}<div class="ad-copy">${copy}<div class="source">${esc(net)}${cta ? ' · ' + esc(cta) : ''}${when ? ' · ' + esc(when) : ''} ${link(url, 'View in ad library')}</div></div></div>`;
  };

  let out = stats;
  out += `<section class="brief"><div class="brief-label">What they are advertising</div><p>${esc(value(final, 'company') || report.title || '')} — ${ads.length} live ad${ads.length === 1 ? '' : 's'} across Facebook and Google.</p></section>`;
  if (final.unavailable) out += `<section class="section"><div class="message error"><strong>No ads were captured.</strong> ${esc(value(final, 'note'))}</div></section>`;
  else if (value(final, 'note')) out += `<section class="section"><div class="message error">${esc(value(final, 'note'))}</div></section>`;
  if (report.status === 'failed') out += `<section class="section"><div class="message error">${esc(report.error ?? 'The ads capture failed.')}</div></section>`;
  else if (!ads.length && report.status !== 'completed' && report.status !== 'partial') out += '<section class="section"><div class="empty">Ads capture is running. This report will refresh automatically.</div></section>';
  else {
    out += `<section class="section"><div class="section-head"><h2>Facebook Ad Library</h2><span class="section-note">${networks.facebook ?? fb.length} ad(s), copy as published.</span></div><div class="ad-grid">${fb.map(row).join('') || '<div class="empty">No Facebook ads found.</div>'}</div></section>`;
    out += `<section class="section"><div class="section-head"><h2>Google Ads Transparency</h2><span class="section-note">${networks.google ?? gg.length} ad(s) — Google publishes no ad copy as text.</span></div><div class="ad-grid">${gg.map(row).join('') || '<div class="empty">No Google ads found.</div>'}</div></section>`;
  }
  return shell(report, out);
}

/**
 * The market report page.
 *
 * Two things it must never do, both of which come from what the data actually is:
 *
 * 1. Never present ads_total as the market size. Facebook's keyword_unordered
 *    matches loosely -- 98 of 576 captured ads in the first real run were window
 *    tint, lighting and property listings that merely contained the word. The
 *    on-topic count is the honest figure and gets the prominent tile.
 * 2. Never render a truncated run as a whole market. If any keyword hit its page
 *    cap, that is a banner at the top, not a footnote.
 */
export function adsMarketPage(report: PublishedReport): string {
  const final = obj(report.result);
  const digest = obj(final.digest);
  const totals = obj(digest.totals);
  const dist = obj(digest.distributions);
  const advertisers = arr(digest.advertisers_top);
  const networks = arr(digest.advertiser_networks);
  const keywords = strings(final.keywords);
  const onTopic = num(final.ads_on_topic) || num(totals.on_topic_ads);
  const total = num(final.ads) || num(totals.ads);

  const stats = `<div class="metrics">
    <div class="metric"><strong>${onTopic || '—'}</strong><span>On-topic ads</span></div>
    <div class="metric"><strong>${num(final.advertisers) || '—'}</strong><span>Advertisers</span></div>
    <div class="metric"><strong>${num(final.unique_creatives) || '—'}</strong><span>Unique creatives</span></div>
    <div class="metric"><strong>${esc(value(final, 'region') || '—')}</strong><span>Region</span></div>
  </div>`;

  const table = (title: string, note: string, pairs: Array<[string, unknown]>) => pairs.length
    ? `<section class="section"><div class="section-head"><h2>${esc(title)}</h2><span class="section-note">${esc(note)}</span></div>
       <table class="data"><tbody>${pairs.slice(0, 12).map(([k, v]) =>
         `<tr><td>${esc(k)}</td><td class="num">${esc(String(v))}</td></tr>`).join('')}</tbody></table></section>`
    : '';

  let out = stats;
  out += `<section class="brief"><div class="brief-label">What was searched</div><p>${
    keywords.map((k) => '<strong>' + esc(k) + '</strong>').join(', ')} in ${esc(value(final, 'country') || value(final, 'region') || '')} — ${
    total} ads captured, ${onTopic} of them on topic across ${num(final.advertisers)} advertisers.</p></section>`;

  if (final.truncated) {
    out += `<section class="section"><div class="message error"><strong>This is a capped capture.</strong> At least one keyword hit its page limit, so more ads exist in this market than were captured. Treat every count below as a floor, not a total.</div></section>`;
  }
  // Stated on the page, not only in the prose: it is the single fact most likely
  // to be assumed the other way by someone skimming advertiser counts.
  out += `<section class="section"><div class="message"><strong>No spend, impressions or reach data exists here.</strong> Those fields are empty on every Malaysian commercial ad in the Ad Library. Ranking below is by ad count, unique creatives and days running — never by budget.</div></section>`;

  if (report.status === 'failed') {
    out += `<section class="section"><div class="message error">${esc(report.error ?? 'The market capture failed.')}</div></section>`;
    return shell(report, out);
  }
  if (!total && report.status !== 'completed' && report.status !== 'partial') {
    out += '<section class="section"><div class="empty">Market capture is running. This report will refresh automatically.</div></section>';
    return shell(report, out);
  }

  if (networks.length) {
    out += `<section class="section"><div class="section-head"><h2>Advertiser networks</h2><span class="section-note">One brand advertising from several Pages. A name match, not proof of common ownership.</span></div>
      <table class="data"><thead><tr><th>Brand</th><th class="num">Pages</th><th class="num">Ads</th><th class="num">Creatives</th></tr></thead><tbody>${
      networks.slice(0, 8).map((n) => `<tr><td>${esc(value(n, 'stem'))}</td><td class="num">${num(n.pages)}</td><td class="num">${num(n.total_ads)}</td><td class="num">${num(n.unique_creatives)}</td></tr>`).join('')
    }</tbody></table></section>`;
  }

  if (advertisers.length) {
    out += `<section class="section"><div class="section-head"><h2>Who is advertising</h2><span class="section-note">Top ${Math.min(advertisers.length, 20)} by ad count. "Creatives" is distinct copy — the gap from "Ads" is repetition.</span></div>
      <table class="data"><thead><tr><th>Advertiser</th><th class="num">Ads</th><th class="num">Creatives</th><th class="num">On topic</th><th class="num">Longest run</th></tr></thead><tbody>${
      advertisers.slice(0, 20).map((a) => `<tr><td>${esc(value(a, 'advertiser') || '—')}</td><td class="num">${num(a.ads)}</td><td class="num">${num(a.unique_creatives)}</td><td class="num">${num(a.on_topic_ads)}</td><td class="num">${num(a.max_days_running)}d</td></tr>`).join('')
    }</tbody></table></section>`;
  }

  out += table('Call to action', 'What the buttons say — how this market actually converts.', Object.entries(obj(dist.cta)));
  out += table('Landing destination', 'Where the click goes.', Object.entries(obj(dist.landing_domain)));
  out += table('Platform', 'Where the ads run.', Object.entries(obj(dist.platform)));

  const md = value(final, 'report_md');
  if (md) {
    out += `<section class="section"><div class="section-head"><h2>The report</h2><span class="section-note">${
      esc(value(final, 'model') || value(final, 'engine') || '')}</span></div><div class="markdown">${markdown(md)}</div></section>`;
  } else if (report.status === 'partial') {
    out += `<section class="section"><div class="message error"><strong>The ads were captured; the written report was not.</strong> Every number above is from the capture and is intact — only the prose is missing.</div></section>`;
  }
  return shell(report, out);
}

export function personPage(report: PublishedReport): string {
  const final = obj(report.result);
  const person = obj(final.person);
  const contacts = arr(final.contacts);
  const facts = arr(final.facts);
  const signals = arr(final.signals);
  const angles = strings(final.research_angles);
  const name = value(person, 'name') || 'VIP brief';
  const role = value(person, 'current_role', 'role');
  const company = value(person, 'company_name');
  const summary = value(final, 'summary');
  const stats = `<div class="metrics">
    <div class="metric"><strong>${contacts.length || '—'}</strong><span>Business contacts</span></div>
    <div class="metric"><strong>${facts.length || '—'}</strong><span>Verified facts</span></div>
    <div class="metric"><strong>${signals.length || '—'}</strong><span>Business signals</span></div>
    <div class="metric"><strong>${esc(company || '—')}</strong><span>Company context</span></div>
  </div>`;
  const contactRows = contacts.map((row) => {
    const raw = value(row, 'value_as_published', 'value', 'normalized_value');
    const normalized = value(row, 'normalized_value') || raw;
    const evidence = value(row, 'evidence_url', 'source_url');
    const action = /@/.test(raw) ? `<a class="button" href="mailto:${esc(raw)}">Email</a>` : /\d/.test(raw) ? `<a class="button" href="tel:${esc(normalized.replace(/[^+\d]/g, ''))}">Call</a>` : link(raw, 'Open', 'button');
    return `<div class="contact"><div class="label">${esc(value(row, 'purpose') || 'Business contact')}</div><div><div class="contact-value">${esc(raw)}</div><div class="source">${grade(row)}${esc(value(row, 'evidence_class', 'current_status'))}${evidence ? ` · <a href="${esc(evidence)}" target="_blank" rel="noopener">view evidence ↗</a>` : ''}</div></div>${action}</div>`;
  }).join('');
  const factRows = facts.map((row) => `<div class="signal"><div class="date">${esc(value(row, 'category') || 'Professional fact')}</div><div><strong>${esc(value(row, 'fact', 'value', 'description'))}</strong><div class="source">${grade(row)}${esc(value(row, 'evidence_class', 'source_type'))} ${link(value(row, 'evidence_url', 'source_url'), 'Source')}</div></div></div>`).join('');
  const signalRows = signals.map((row) => `<div class="signal"><div class="date">${esc(value(row, 'date') || 'Current')}</div><div><strong>${esc(value(row, 'fact', 'description', 'signal'))}</strong><div class="source">${grade(row)}${esc(value(row, 'evidence_class', 'source_type'))} ${link(value(row, 'evidence_url', 'source_url'), 'Source')}</div></div></div>`).join('');
  let body = stats + evidenceTally([contacts, facts, signals]);
  body += `<section class="brief identity"><div class="brief-label">VIP profile</div><p>${esc([name, role, company].filter(Boolean).join(' · ') || 'Public-professional research only.')}</p></section>`;
  if (summary) body += `<section class="brief"><div class="brief-label">Qualification readout</div><p>${esc(summary)}</p></section>`;
  if (report.status === 'failed') body += `<section class="section"><div class="message error">${esc(report.error ?? 'The VIP brief failed.')}</div></section>`;
  else if (!facts.length && !signals.length && report.status !== 'completed' && report.status !== 'partial') body += '<section class="section"><div class="empty">Public-professional research is running. This report will refresh automatically.</div></section>';
  else {
    body += `<section class="section"><div class="section-head"><h2>Published business contacts</h2><span class="section-note">Company-wide and person-specific routes are labeled separately.</span></div><div class="contact-list">${contactRows || '<div class="empty">No validated public business contacts.</div>'}</div></section>`;
    body += `<section class="section"><div class="section-head"><h2>Verified professional facts</h2><span class="section-note">No private or sensitive-person data is included.</span></div><div class="signal-list">${factRows || '<div class="empty">No additional validated facts.</div>'}</div></section>`;
    if (angles.length) body += `<section class="section"><div class="section-head"><h2>Research angles</h2><span class="section-note">Use as prompts for informed qualification, not as asserted facts.</span></div><div class="angles">${angles.map((item) => `<div class="angle">${esc(item)}</div>`).join('')}</div></section>`;
    body += `<section class="section"><div class="section-head"><h2>Business signals</h2><span class="section-note">Dated, source-linked signals only.</span></div><div class="signal-list">${signalRows || '<div class="empty">No validated business signals.</div>'}</div></section>`;
  }
  return shell(report, body);
}

export function contactPage(report: PublishedReport): string {
  const final = obj(report.result);
  const entity = obj(final.entity);
  const cheatSheet = obj(final.cheat_sheet);
  const decisionMakers = arr(final.decision_makers);
  const phoneContacts = arr(final.phone_contacts);
  const emailContacts = arr(final.email_contacts);

  const stats = `<div class="metrics">
    <div class="metric"><strong>${decisionMakers.length || '—'}</strong><span>Decision makers</span></div>
    <div class="metric"><strong>${phoneContacts.length || '—'}</strong><span>Phone routes</span></div>
    <div class="metric"><strong>${emailContacts.length || '—'}</strong><span>Email channels</span></div>
    <div class="metric"><strong>${esc(value(cheatSheet, 'primary_channel') || 'Phone')}</strong><span>Best outreach</span></div>
  </div>`;

  const previousReportId = value(obj(report.request), 'compareToReportId');
  const comparison = /^[A-Za-z0-9_-]{20}$/.test(previousReportId)
    ? `<section class="section"><div class="section-head"><h2>Compare contact research</h2><span class="section-note">Open the earlier report beside this run.</span></div><a class="button" href="/r/${esc(previousReportId)}" target="_blank" rel="noopener">Previous contact report ↗</a></section>`
    : '';
  let body = stats + comparison;

  if (report.status === 'failed') {
    body += `<section class="section"><div class="message error">${esc(report.error ?? 'Contact research failed to produce findings.')}</div></section>`;
    return shell(report, body);
  }

  if (!decisionMakers.length && !phoneContacts.length && report.status !== 'completed' && report.status !== 'partial') {
    body += '<section class="section"><div class="empty">Telemarketing contact research is running. This report will refresh automatically.</div></section>';
    return shell(report, body);
  }

  // 1. Cheat Sheet Card
  const primaryDM = value(cheatSheet, 'primary_decision_maker') || 'Decision Maker';
  const primaryPhone = value(cheatSheet, 'primary_phone');
  const gatekeeper = value(cheatSheet, 'gatekeeper_phrase');
  const dialUrl = value(cheatSheet, 'dial_url') || (primaryPhone ? `tel:${primaryPhone.replace(/[^+\d]/g, '')}` : '');
  const waUrl = value(cheatSheet, 'whatsapp_url');

  body += `<section class="section">
    <div class="section-head">
      <h2>Telemarketer Call Cheat Sheet</h2>
      <span class="section-note">Key decision maker, best direct number, and receptionist gatekeeper script.</span>
    </div>
    <div class="sheet" style="padding:16px 18px;display:grid;gap:12px;background:#fff;border-left:4px solid var(--accent-2)">
      <div style="display:flex;flex-wrap:wrap;align-items:baseline;justify-content:space-between;gap:8px">
        <div>
          <span style="font:var(--micro);text-transform:uppercase;color:var(--muted);letter-spacing:var(--track)">Target Person</span>
          <div style="font-size:18px;font-weight:600;margin-top:2px">${esc(primaryDM)}</div>
        </div>
        ${primaryPhone ? `
        <div style="text-align:right">
          <span style="font:var(--micro);text-transform:uppercase;color:var(--muted);letter-spacing:var(--track)">Dial Direct</span>
          <div style="font-size:18px;font-weight:700;color:var(--accent);margin-top:2px">${esc(primaryPhone)}</div>
        </div>` : ''}
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;padding:10px 0;border-top:1px solid var(--line);border-bottom:1px solid var(--line)">
        ${dialUrl ? `<a class="button" href="${esc(dialUrl)}" style="background:var(--accent);color:#fff;font-weight:600;padding:6px 14px">📞 Call Now</a>` : ''}
        ${waUrl ? `<a class="button" href="${esc(waUrl)}" target="_blank" rel="noopener" style="background:#0a6b47;color:#fff;font-weight:600;padding:6px 14px">💬 WhatsApp</a>` : ''}
        ${primaryPhone ? `<button class="button" type="button" onclick="navigator.clipboard.writeText('${esc(primaryPhone)}');this.textContent='Copied!'">Copy Phone</button>` : ''}
      </div>
      ${gatekeeper ? `
      <div>
        <span style="font:var(--micro);text-transform:uppercase;color:var(--muted);letter-spacing:var(--track)">Receptionist / Gatekeeper Script</span>
        <blockquote style="margin:6px 0 0;padding:8px 12px;background:var(--soft);border-left:3px solid var(--accent);border-radius:var(--radius);font-style:italic;font-size:13.5px">
          "${esc(gatekeeper)}"
        </blockquote>
      </div>` : ''}
    </div>
  </section>`;

  // 2. Decision Makers List
  const dmRows = decisionMakers.map((row) => {
    const name = value(row, 'name');
    const role = value(row, 'role');
    const seniority = value(row, 'seniority');
    const directPhone = value(row, 'direct_phone');
    const directEmail = value(row, 'direct_email');
    const profileUrl = value(row, 'profile_url');
    const evidence = value(row, 'role_evidence_url');

    return `<div class="person" style="display:grid;grid-template-columns:1fr auto;gap:12px;padding:12px 14px;border-bottom:1px solid var(--line)">
      <div>
        <div style="font-size:15px;font-weight:600">${esc(name)} <span style="font-size:12px;font-weight:500;color:var(--muted);background:var(--soft);padding:2px 6px;border-radius:3px">Seniority: ${esc(seniority || '—')}</span></div>
        <div style="color:var(--accent-2);font-weight:500;margin-top:2px">${esc(role)}</div>
        <div style="font-size:12.5px;color:var(--muted);margin-top:4px">
          ${directPhone ? `<span>Direct Phone: <strong>${esc(directPhone)}</strong></span>` : ''}
          ${directEmail ? ` · <span>Direct Email: <strong>${esc(directEmail)}</strong></span>` : ''}
        </div>
        ${evidence ? `<div style="font-size:11.5px;color:var(--faint);margin-top:3px"><a href="${esc(evidence)}" target="_blank" rel="noopener">Role evidence ↗</a></div>` : ''}
      </div>
      <div style="display:flex;flex-direction:column;gap:5px;align-items:flex-end">
        ${directPhone ? `<a class="button" href="tel:${esc(directPhone.replace(/[^+\d]/g, ''))}">Call</a>` : ''}
        ${directEmail ? `<a class="button" href="mailto:${esc(directEmail)}">Email</a>` : ''}
        ${profileUrl ? `<a class="button" href="${esc(profileUrl)}" target="_blank" rel="noopener">LinkedIn ↗</a>` : ''}
      </div>
    </div>`;
  }).join('');

  body += `<section class="section">
    <div class="section-head">
      <h2>Decision Makers & Leadership</h2>
      <span class="section-note">Ranked by seniority for outbound qualification and cold outreach.</span>
    </div>
    <div class="people">${dmRows || '<div class="empty">No specific decision makers identified. Use switchboard.</div>'}</div>
  </section>`;

  // 3. Dialable Phone Contacts
  const phoneRows = phoneContacts.map((row) => {
    const raw = value(row, 'number_raw');
    const e164 = value(row, 'number_e164') || raw;
    const type = value(row, 'type');
    const label = value(row, 'label') || (type === 'mobile_whatsapp' ? 'Mobile / WhatsApp' : 'Office Phone');
    const wa = value(row, 'whatsapp_url');
    const evidence = value(row, 'evidence_url');

    return `<div class="contact" style="display:grid;grid-template-columns:auto 1fr auto;gap:12px;align-items:center;padding:10px 14px;border-bottom:1px solid var(--line)">
      <div style="font:var(--micro);text-transform:uppercase;padding:3px 7px;border-radius:3px;background:${type === 'mobile_whatsapp' ? '#e6f4ea;color:#0a6b47' : 'var(--soft);color:var(--muted)'}">
        ${esc(label)}
      </div>
      <div>
        <div style="font-size:15px;font-weight:600;letter-spacing:.02em">${esc(raw)}${e164 && e164 !== raw ? ` <span style="font-size:12px;color:var(--muted)">(${esc(e164)})</span>` : ''}</div>
        ${evidence ? `<div class="source"><a href="${esc(evidence)}" target="_blank" rel="noopener">evidence source ↗</a></div>` : ''}
      </div>
      <div style="display:flex;gap:6px">
        <a class="button" href="tel:${esc(e164.replace(/[^+\d]/g, ''))}">Call</a>
        ${wa ? `<a class="button" href="${esc(wa)}" target="_blank" rel="noopener" style="background:#0a6b47;color:#fff">WhatsApp</a>` : ''}
        <button class="button" type="button" onclick="navigator.clipboard.writeText('${esc(e164)}');this.textContent='Copied!'">Copy</button>
      </div>
    </div>`;
  }).join('');

  body += `<section class="section">
    <div class="section-head">
      <h2>Dialable Phone Numbers</h2>
      <span class="section-note">Verified office desk lines, switchboard lines, and WhatsApp mobile routes.</span>
    </div>
    <div class="contact-list">${phoneRows || '<div class="empty">No verified phone numbers found.</div>'}</div>
  </section>`;

  // 4. Email Contacts
  if (emailContacts.length) {
    const emailRows = emailContacts.map((row) => {
      const email = value(row, 'email');
      const label = value(row, 'label') || 'Email';
      const evidence = value(row, 'evidence_url');
      return `<div class="contact" style="display:grid;grid-template-columns:auto 1fr auto;gap:12px;align-items:center;padding:10px 14px;border-bottom:1px solid var(--line)">
        <div style="font:var(--micro);text-transform:uppercase;padding:3px 7px;border-radius:3px;background:var(--soft);color:var(--muted)">${esc(label)}</div>
        <div>
          <div style="font-size:14.5px;font-weight:600">${esc(email)}</div>
          ${evidence ? `<div class="source"><a href="${esc(evidence)}" target="_blank" rel="noopener">evidence source ↗</a></div>` : ''}
        </div>
        <a class="button" href="mailto:${esc(email)}">Send Email</a>
      </div>`;
    }).join('');

    body += `<section class="section">
      <div class="section-head">
        <h2>Email Channels</h2>
        <span class="section-note">Direct personal emails and general inquiry channels.</span>
      </div>
      <div class="contact-list">${emailRows}</div>
    </section>`;
  }

  // 5. Company Details
  body += `<section class="section">
    <div class="section-head">
      <h2>Company Baseline</h2>
    </div>
    <div class="sheet" style="padding:14px 16px;display:grid;gap:6px;font-size:13.5px">
      <div><strong>Company:</strong> ${esc(value(entity, 'name'))}</div>
      ${value(entity, 'address') ? `<div><strong>Address:</strong> ${esc(value(entity, 'address'))}</div>` : ''}
      ${value(entity, 'website') ? `<div><strong>Website:</strong> <a href="${esc(value(entity, 'website'))}" target="_blank" rel="noopener">${esc(value(entity, 'website'))} ↗</a></div>` : ''}
      ${value(entity, 'maps_url') ? `<div><strong>Google Maps:</strong> <a href="${esc(value(entity, 'maps_url'))}" target="_blank" rel="noopener">View Google Maps listing ↗</a></div>` : ''}
    </div>
  </section>`;

  return shell(report, body);
}
