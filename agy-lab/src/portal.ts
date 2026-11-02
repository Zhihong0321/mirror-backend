// End-user business-intelligence workspace.
//
// The shell is public, but it contains no credential. Users enter a scoped
// PORTAL_TOKEN which is kept by eeKey (see tokenstore.ts) and sent only as a
// bearer header. Entered once, it survives new tabs and browser restarts -- the
// portal and every report page read the same store, so nobody is asked twice.
// The same page also accepts LAB_TOKEN for owner testing.
import { TOKEN_STORE_JS } from './tokenstore.ts';

export type PageKind = 'research' | 'telemarketing' | 'registrations';

// The calling floor gets the same workspace, minus the surfaces that are not
// part of calling: Home's discovery chooser, the report library and the guide.
// They are hidden rather than deleted, so the two pages cannot drift apart, and
// a report link opened from the floor still resolves to the same viewer.
const TELEMARKETING_CSS =
  '.telemarketing .nav-button[data-view="discover"],' +
  '.telemarketing .nav-button[data-view="library"],' +
  '.telemarketing .nav-button[href="/guide"],' +
  '.telemarketing .mobile-tab[data-view="discover"],' +
  '.telemarketing .mobile-tab[data-view="library"],' +
  '.telemarketing .mobile-tab[href="/guide"],' +
  '.telemarketing .gate-help{display:none}';

function telemarketing(html: string): string {
  return html
    .replace('<body>', '<body data-portal="telemarketing">')
    .replace('<title>EE Business Intelligence</title>', '<title>Telemarketing · EE Business Intelligence</title>')
    .replace('<div id="portalApp" class="app"', '<div id="portalApp" class="app telemarketing"')
    .replace('<section id="discoverView" class="view active">', '<section id="discoverView" class="view">')
    .replace('<section id="telemarketingView" class="view">', '<section id="telemarketingView" class="view active">')
    .replace('class="mobile-tab active" data-view="discover"', 'class="mobile-tab" data-view="discover"')
    .replace('class="mobile-tab" data-view="telemarketing"', 'class="mobile-tab active" data-view="telemarketing"')
    .replace('</style>', TELEMARKETING_CSS + '</style>')
    // The wordmark is the one nav affordance that is not a link, so it is the
    // one that has to be re-pointed: on the floor it opens the map, not the
    // discovery chooser it would otherwise reveal.
    .replace("switchView('discover')", "switchView('telemarketing')");
}

const REGISTRATIONS_CSS =
  '.registrations .nav-button[data-view="discover"],' +
  '.registrations .nav-button[data-view="library"],' +
  '.registrations .nav-button[href="/guide"],' +
  '.registrations .mobile-tab[data-view="discover"],' +
  '.registrations .mobile-tab[data-view="library"],' +
  '.registrations .mobile-tab[href="/guide"],' +
  '.registrations .gate-help{display:none}';

function registrations(html: string): string {
  return html
    .replace('<body>', '<body data-portal="registrations">')
    .replace('<title>EE Business Intelligence</title>', '<title>Incoming Registrations · Atap Solar Leads</title>')
    .replace('<div id="portalApp" class="app"', '<div id="portalApp" class="app registrations"')
    .replace('<section id="discoverView" class="view active">', '<section id="discoverView" class="view">')
    .replace('<section id="adsLeadsView" class="view">', '<section id="adsLeadsView" class="view active">')
    .replace('class="nav-button active" data-view="discover"', 'class="nav-button" data-view="discover"')
    .replace('class="nav-button" data-view="adsLeads"', 'class="nav-button active" data-view="adsLeads"')
    .replace('class="mobile-tab active" data-view="discover"', 'class="mobile-tab" data-view="discover"')
    .replace('class="mobile-tab" data-view="adsLeads"', 'class="mobile-tab active" data-view="adsLeads"')
    .replace('</style>', REGISTRATIONS_CSS + '</style>')
    .replace("switchView('discover')", "switchView('adsLeads')");
}
export function page(kind: PageKind = 'research'): string {
  const html = String.raw`<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#151515"><title>EE Business Intelligence</title>
<style>
:root{--paper:#f3f0e8;--sheet:#fbfaf6;--ink:#151515;--muted:#6c6a64;--faint:#9b988f;--line:#cbc6ba;--soft:#e6e1d6;--accent:#2759ff;--accent-dark:#1741d0;--ok:#15785a;--warn:#a36b00;--bad:#9e382f;--display:"Iowan Old Style","Palatino Linotype",Palatino,Georgia,serif;--sans:Inter,"Helvetica Neue",Arial,sans-serif;--mono:"SFMono-Regular",Consolas,"Liberation Mono",monospace}
*{box-sizing:border-box}html{background:var(--paper);scroll-behavior:smooth}body{margin:0;background:var(--paper);color:var(--ink);font:15px/1.5 var(--sans);-webkit-font-smoothing:antialiased}button,input,select{font:inherit}button,a{-webkit-tap-highlight-color:transparent}.hidden{display:none!important}
.app{min-height:100vh}.mast{height:68px;background:var(--ink);color:var(--sheet)}.mast-inner{height:100%;max-width:1180px;margin:auto;padding:0 28px;display:flex;align-items:center;justify-content:space-between}.brand{display:flex;align-items:center;gap:12px;border:0;background:transparent;color:inherit;padding:0;font:750 11px/1 var(--sans);letter-spacing:.13em;text-transform:uppercase;cursor:pointer}.mark{display:grid;place-items:center;width:30px;height:30px;background:var(--sheet);color:var(--ink);font:850 10px/1 var(--sans)}.desktop-nav{display:flex;align-items:center;gap:6px}.nav-button{border:0;background:transparent;color:#aaa79f;min-height:42px;padding:0 14px;font:700 10px/1 var(--sans);text-transform:uppercase;letter-spacing:.11em;cursor:pointer}.nav-button.active{color:#fff}.access{display:flex;align-items:center;gap:9px;margin-left:16px;padding-left:18px;border-left:1px solid #3b3b38;color:#c9c6be;font:600 10px/1 var(--mono);text-transform:uppercase}.access-dot{width:7px;height:7px;border-radius:50%;background:#50d09d}.signout{border:0;background:transparent;color:#85837d;padding:8px;cursor:pointer;font:600 10px/1 var(--mono)}
.content{max-width:1180px;margin:auto;padding:0 28px 96px}.view{display:none}.view.active{display:block}.hero{position:relative;margin:0 -28px;padding:64px max(28px,calc((100vw - 1180px)/2 + 28px)) 118px;background:var(--ink);color:var(--sheet);overflow:hidden}.hero:after{content:"EE / FIELD INTELLIGENCE";position:absolute;right:30px;bottom:23px;color:#41413e;font:600 9px/1 var(--mono);letter-spacing:.16em}.eyebrow{display:flex;align-items:center;gap:10px;color:#91a8ff;font:700 10px/1 var(--sans);letter-spacing:.17em;text-transform:uppercase}.eyebrow:before{content:"";width:30px;height:2px;background:var(--accent)}.hero h1{max-width:820px;margin:18px 0 18px;font:400 clamp(48px,7vw,86px)/.92 var(--display);letter-spacing:-.055em;text-wrap:balance}.hero p{max-width:610px;margin:0;color:#aaa9a4;font-size:15px;line-height:1.65}.search-sheet{position:relative;margin:-72px 0 0;background:var(--sheet);border:1px solid var(--ink);padding:28px;box-shadow:0 18px 50px rgba(20,20,20,.09)}.search-grid{display:grid;grid-template-columns:1.3fr 1fr 110px auto;align-items:end;gap:18px}.field label{display:block;margin:0 0 8px;font:750 9px/1 var(--sans);letter-spacing:.13em;text-transform:uppercase;color:var(--muted)}.input{width:100%;height:49px;border:0;border-bottom:1px solid var(--ink);border-radius:0;background:transparent;color:var(--ink);padding:0 2px;font-size:16px;outline:none}.input:focus{border-bottom:2px solid var(--accent)}.input::placeholder{color:#aaa69d}.select{appearance:none;background-image:linear-gradient(45deg,transparent 50%,var(--ink) 50%),linear-gradient(135deg,var(--ink) 50%,transparent 50%);background-position:calc(100% - 14px) 21px,calc(100% - 9px) 21px;background-size:5px 5px;background-repeat:no-repeat}.primary{height:49px;border:1px solid var(--accent);background:var(--accent);color:#fff;padding:0 24px;font:800 10px/1 var(--sans);letter-spacing:.11em;text-transform:uppercase;cursor:pointer;white-space:nowrap}.primary:hover{background:var(--accent-dark)}.primary:disabled{opacity:.48;cursor:wait}.form-note{margin:15px 0 0;color:var(--muted);font-size:11px}
.workspace{padding-top:44px}.section-head{display:flex;align-items:end;justify-content:space-between;gap:24px;margin-bottom:18px}.section-head h2{margin:0;font:400 clamp(28px,4vw,42px)/1 var(--display);letter-spacing:-.035em}.section-note{max-width:420px;text-align:right;color:var(--muted);font-size:12px}.rule{border-top:1px solid var(--ink)}
.jobs{border-top:1px solid var(--ink);margin-bottom:50px}.job{display:grid;grid-template-columns:125px minmax(0,1fr) auto;gap:20px;align-items:center;min-height:84px;border-bottom:1px solid var(--line)}.job-type{font:700 9px/1 var(--sans);letter-spacing:.12em;text-transform:uppercase;color:var(--accent)}.job-title{font-weight:650;letter-spacing:-.015em}.job-meta{margin-top:5px;font:500 10px/1.4 var(--mono);color:var(--muted);text-transform:uppercase}.job-action{display:flex;align-items:center;gap:12px}.pulse{width:7px;height:7px;border-radius:50%;background:#d29a27;box-shadow:0 0 0 5px rgba(210,154,39,.12);animation:pulse 1.8s infinite}.pulse.done{background:var(--ok);box-shadow:none;animation:none}.pulse.bad{background:var(--bad);box-shadow:none;animation:none}@keyframes pulse{50%{opacity:.38}}.text-action{display:inline-flex;align-items:center;gap:5px;border:0;border-bottom:1px solid currentColor;background:transparent;color:var(--ink);padding:8px 0;text-decoration:none;font:750 10px/1 var(--sans);letter-spacing:.09em;text-transform:uppercase;cursor:pointer}.text-action span{color:var(--accent)}
.result-summary{display:grid;grid-template-columns:repeat(4,1fr);border-top:1px solid var(--ink);border-bottom:1px solid var(--ink);margin-bottom:26px}.metric{padding:20px 18px 18px 0;min-width:0}.metric+.metric{border-left:1px solid var(--line);padding-left:18px}.metric strong{display:block;overflow:hidden;text-overflow:ellipsis;font:400 34px/1 var(--display);letter-spacing:-.04em}.metric span{display:block;margin-top:8px;color:var(--muted);font:750 8px/1.2 var(--sans);letter-spacing:.13em;text-transform:uppercase}.company-list{border-top:1px solid var(--ink)}.company{display:grid;grid-template-columns:50px minmax(180px,.9fr) minmax(230px,1fr) minmax(270px,1fr);gap:20px;align-items:start;padding:25px 0;border-bottom:1px solid var(--line)}.number{font:550 11px/1 var(--mono);color:var(--accent)}.company h3{margin:0;font-size:17px;line-height:1.2;letter-spacing:-.02em}.meta{margin-top:6px;color:var(--muted);font-size:11px}.address{color:var(--muted);font-size:12.5px}.company-contact{display:grid;gap:13px}.phone{font:500 14px/1.2 var(--mono)}.company-actions{display:flex;align-items:center;gap:13px;flex-wrap:wrap}.research{min-height:41px;border:1px solid var(--ink);background:var(--ink);color:#fff;padding:0 14px;font:750 9px/1 var(--sans);letter-spacing:.09em;text-transform:uppercase;cursor:pointer}.research:hover{background:var(--accent);border-color:var(--accent)}.research:disabled{opacity:.42;cursor:wait}.source-link{color:var(--ink);text-decoration:none;border-bottom:1px solid currentColor;padding:6px 0;font:700 9px/1 var(--sans);letter-spacing:.08em;text-transform:uppercase}.source-link:after{content:" ↗";color:var(--accent)}
.library-hero{padding:64px 0 38px;border-bottom:1px solid var(--ink)}.library-hero h1{margin:12px 0 14px;font:400 clamp(45px,7vw,78px)/.92 var(--display);letter-spacing:-.05em}.library-hero p{max-width:600px;color:var(--muted)}.filters{display:flex;gap:8px;flex-wrap:wrap;margin:25px 0 34px}.filter{min-height:38px;padding:0 14px;border:1px solid var(--line);background:transparent;color:var(--muted);font:700 9px/1 var(--sans);text-transform:uppercase;letter-spacing:.1em;cursor:pointer}.filter.active{background:var(--ink);border-color:var(--ink);color:#fff}.report-list{border-top:1px solid var(--ink)}.report{display:grid;grid-template-columns:130px minmax(0,1fr) 190px auto;gap:22px;padding:27px 0;border-bottom:1px solid var(--line);align-items:start}.report-kind{font:700 9px/1.3 var(--sans);color:var(--accent);letter-spacing:.12em;text-transform:uppercase}.report-date{display:block;margin-top:8px;color:var(--faint);font:500 9px/1 var(--mono)}.report h3{margin:0;font-size:18px;line-height:1.2;letter-spacing:-.02em}.report-summary{margin:8px 0 0;max-width:650px;color:var(--muted);font-size:12.5px}.report-stats{font:500 10px/1.65 var(--mono);color:var(--muted);text-transform:uppercase}.status{display:inline-flex;align-items:center;gap:7px;font:700 9px/1 var(--sans);letter-spacing:.08em;text-transform:uppercase}.status:before{content:"";width:7px;height:7px;border-radius:50%;background:#d29a27}.status.completed:before,.status.partial:before{background:var(--ok)}.status.failed:before{background:var(--bad)}.empty{padding:62px 20px;text-align:center;color:var(--muted);border-bottom:1px solid var(--line)}
.mobile-nav{display:none}.gate{position:fixed;inset:0;z-index:50;display:grid;place-items:center;background:rgba(18,18,18,.92);padding:20px}.gate-panel{width:min(440px,100%);background:var(--sheet);border:1px solid #fff;padding:34px}.gate-mark{display:grid;place-items:center;width:34px;height:34px;background:var(--ink);color:#fff;font:800 10px/1 var(--sans)}.gate h1{margin:32px 0 12px;font:400 42px/.95 var(--display);letter-spacing:-.045em}.gate p{color:var(--muted);font-size:13px}.gate-form{display:grid;grid-template-columns:1fr auto;gap:10px;margin-top:24px}.gate input{height:48px;min-width:0;border:1px solid var(--ink);border-radius:0;background:#fff;padding:0 13px}.gate button{height:48px}.gate-error{min-height:20px;margin:10px 0 0;color:var(--bad)!important;font-size:11px!important}.toast{position:fixed;z-index:60;right:20px;bottom:20px;max-width:380px;background:var(--ink);color:#fff;padding:14px 17px;font-size:12px;box-shadow:0 15px 45px rgba(0,0,0,.2);transform:translateY(140%);transition:transform .24s}.toast.show{transform:translateY(0)}
:focus-visible{outline:2px solid var(--accent);outline-offset:3px}@media(prefers-reduced-motion:reduce){*{scroll-behavior:auto!important;animation:none!important;transition:none!important}}
@media(max-width:820px){body{padding-bottom:72px}.mast{height:60px}.mast-inner{padding:0 18px}.desktop-nav{display:none}.content{padding:0 18px 44px}.hero{margin:0 -18px;padding:30px 18px 84px}.hero:after{right:18px}.hero h1{margin:14px 0 14px;font-size:clamp(34px,9.6vw,50px)}.hero p{font-size:13.5px}.search-sheet{margin-top:-58px;padding:22px 18px}.search-grid{grid-template-columns:1fr 1fr;gap:18px 14px}.field.keyword{grid-column:1/-1}.search-grid .primary{grid-column:1/-1}.workspace{padding-top:36px}.section-head{display:block}.section-note{text-align:left;margin-top:8px}.job{grid-template-columns:1fr auto;gap:8px 12px;padding:18px 0}.job-type{grid-column:1/-1}.job-action{justify-self:end}.result-summary{grid-template-columns:repeat(2,1fr)}.metric:nth-child(3){border-left:0;border-top:1px solid var(--line);padding-left:0}.metric:nth-child(4){border-top:1px solid var(--line)}.metric strong{font-size:31px}.company{grid-template-columns:35px 1fr;gap:14px 10px;padding:23px 0}.address,.company-contact{grid-column:2}.company-actions{gap:12px}.research{min-height:46px}.library-hero{padding:44px 0 30px}.library-hero h1{font-size:54px}.report{grid-template-columns:1fr auto;gap:12px;padding:23px 0}.report-kind{grid-column:1/-1}.report-stats{grid-column:1}.report>.text-action{grid-column:2;grid-row:2;align-self:end}.mobile-nav{position:fixed;z-index:35;left:0;right:0;bottom:0;display:grid;grid-template-columns:repeat(3,1fr);height:68px;padding-bottom:env(safe-area-inset-bottom);background:var(--ink);border-top:1px solid #343431}.mobile-tab{border:0;background:transparent;color:#8f8d87;font:700 9px/1 var(--sans);letter-spacing:.11em;text-transform:uppercase}.mobile-tab.active{color:#fff}.mobile-tab span{display:block;width:5px;height:5px;margin:0 auto 8px;border-radius:50%;background:transparent}.mobile-tab.active span{background:var(--accent)}.toast{left:14px;right:14px;bottom:82px;max-width:none}.gate-panel{padding:28px 22px}.gate-form{grid-template-columns:1fr}.gate-form button{width:100%}}
.company-actions .research{display:inline-flex;align-items:center;justify-content:center;min-height:44px;border-color:var(--accent);background:var(--accent);padding:0 17px;font-weight:800;font-size:10px;letter-spacing:.1em;text-decoration:none}.company-actions .research:hover{background:var(--accent-dark);border-color:var(--accent-dark)}.company-actions .research:disabled{opacity:.54}.company-actions .research:before{content:"Direct ";color:#cfd9ff}.company-actions .view-report:before{content:none}.company-actions .view-report{background:var(--ink);border-color:var(--ink)}.company-actions .view-report:hover{background:var(--accent-dark);border-color:var(--accent-dark)}
.ads-grid{grid-template-columns:1.4fr 1fr 1fr auto}.company-grid{grid-template-columns:1.3fr 1fr auto}
.report-actions{display:grid;gap:11px;justify-items:end}.people-panel{grid-column:1/-1;margin-top:14px;padding-top:16px;border-top:1px solid var(--soft)}.people-head{margin:0 0 4px;color:var(--muted);font:750 9px/1.3 var(--sans);letter-spacing:.13em;text-transform:uppercase}.people-head+.person-row{border-top:0}.person-row{display:grid;grid-template-columns:36px minmax(0,1fr) auto;gap:16px;align-items:start;padding:13px 0;border-bottom:1px solid var(--soft)}.person-row:last-child{border-bottom:0}.person-rank{font:550 10px/1.6 var(--mono);color:var(--accent)}.person-name{font-weight:650;letter-spacing:-.015em}.person-role{margin-top:3px;color:var(--muted);font-size:12.5px}.person-note{display:inline-block;margin-top:5px;color:var(--faint);font:500 9px/1.4 var(--mono);text-transform:uppercase;text-decoration:none}a.person-note{color:var(--muted);border-bottom:1px solid currentColor}
.vip{display:inline-flex;align-items:center;gap:6px;min-height:38px;border:1px solid var(--ink);background:transparent;color:var(--ink);padding:0 13px;font:750 9px/1 var(--sans);letter-spacing:.09em;text-transform:uppercase;white-space:nowrap;text-decoration:none;cursor:pointer}.vip:hover{background:var(--ink);color:#fff}.vip:disabled{opacity:.45;cursor:wait}
@media(max-width:820px){.ads-grid{grid-template-columns:1fr}.company-grid{grid-template-columns:1fr}.report-actions{grid-column:2;grid-row:2;align-self:end;gap:9px}.person-row{grid-template-columns:30px minmax(0,1fr);gap:8px 12px}.person-row .vip{grid-column:2;justify-self:start;min-height:44px}}
.chooser{position:relative;margin:-72px 0 0;display:grid;grid-template-columns:repeat(3,1fr);gap:1px;background:var(--ink);border:1px solid var(--ink);box-shadow:0 18px 50px rgba(20,20,20,.09)}.choice{display:flex;flex-direction:column;align-items:flex-start;gap:11px;min-height:212px;margin:0;border:0;background:var(--sheet);color:var(--ink);padding:28px 24px 24px;text-align:left;cursor:pointer;transition:background .18s,color .18s}.choice:hover,.choice:focus-visible{background:var(--ink);color:var(--sheet);outline:0}.choice-no{font:550 10px/1 var(--mono);color:var(--accent);letter-spacing:.1em}.choice h2{margin:0;font:400 30px/1.02 var(--display);letter-spacing:-.04em}.choice-copy{margin:0;color:var(--muted);font-size:12.5px;line-height:1.55}.choice:hover .choice-copy,.choice:focus-visible .choice-copy{color:#a9a7a4}.choice-go{margin-top:auto;padding-top:14px;font:800 9px/1 var(--sans);letter-spacing:.13em;text-transform:uppercase;color:var(--accent)}.choice:hover .choice-go,.choice:focus-visible .choice-go{color:#91a8ff}.sheet-head{display:flex;align-items:center;gap:16px;margin:-4px 0 24px;padding-bottom:13px;border-bottom:1px solid var(--soft)}.back{border:0;background:transparent;color:var(--muted);padding:6px 0;font:750 9px/1 var(--sans);letter-spacing:.12em;text-transform:uppercase;cursor:pointer}.back:hover{color:var(--accent)}.sheet-title{font:750 9px/1 var(--sans);letter-spacing:.13em;text-transform:uppercase}@media(max-width:820px){.chooser{grid-template-columns:1fr;margin-top:-58px}.choice{min-height:0;padding:22px 18px 20px}.choice h2{font-size:27px}.choice-go{padding-top:11px}}
a.nav-button{display:inline-flex;align-items:center;text-decoration:none}.gate-help{margin:16px 0 0;font-size:11px}.gate-help a{color:var(--muted);text-decoration:none;border-bottom:1px solid var(--line)}.gate-help a:hover{color:var(--accent);border-color:var(--accent)}a.mobile-tab{display:grid;place-content:center;text-decoration:none}
.text-action.danger{color:var(--bad)}.text-action.danger span{color:var(--bad)}.text-action.danger:disabled{opacity:.45;cursor:wait}
.library-tools{display:flex;align-items:center;gap:16px;flex-wrap:wrap;margin:25px 0 0}.library-tools .primary{height:42px}.retry-note{color:var(--muted);font:600 11px/1.4 var(--mono)}
.lead-row{display:grid;grid-template-columns:32px minmax(200px,1.2fr) minmax(180px,1fr) minmax(170px,.9fr) auto;gap:18px;align-items:start;padding:22px 0;border-bottom:1px solid var(--line);transition:background .15s}
.lead-row.has-contact-research{background:#e8f5e9;margin:0 -14px;padding:22px 14px;border:1px solid #c8e6c9;border-left:5px solid #2e7d32;border-radius:6px;box-shadow:0 1px 4px rgba(46,125,50,.1)}
.lead-row.contact-running{background:#fffdf0;margin:0 -14px;padding:22px 14px;border-left:4px solid var(--warn);border-radius:5px}
.lead-row.is-hidden{background:#fbfbfb;opacity:.9}
.contact-pill{display:inline-flex;align-items:center;gap:6px;padding:3px 9px;background:#e6f7ef;border:1px solid #b7ebd3;border-radius:4px;font:700 11px/1.3 var(--sans);color:var(--ok);margin-top:6px;white-space:nowrap}
.contact-pill.running{background:#fff8e6;border-color:#f5d085;color:var(--warn)}
.contact-pill strong{color:var(--ok);font-weight:800}
.company.has-contact-research{background:#e8f5e9;margin:0 -14px;padding:25px 14px;border:1px solid #c8e6c9;border-left:5px solid #2e7d32;border-radius:5px}
.vip.contact-vip{background:#0a6b47;color:#fff;border-color:#0a6b47;font-weight:750}
.vip.contact-vip:hover{background:#085739;border-color:#085739}
.result-summary.lead-summary-grid{grid-template-columns:repeat(6,1fr)}
#leadsSummary.result-summary.lead-summary-grid{grid-template-columns:repeat(7,1fr)}
.lead-check{width:18px;height:18px;margin-top:3px;cursor:pointer;accent-color:var(--accent)}
.branch-tag{display:inline-block;padding:2px 6px;margin-left:6px;font:600 9px/1 var(--mono);background:var(--soft);color:var(--muted);border-radius:3px;text-transform:uppercase}
.status-select{height:34px;padding:0 8px;font:700 9px/1 var(--sans);letter-spacing:.08em;text-transform:uppercase;border:1px solid var(--line);background:var(--sheet);border-radius:3px;cursor:pointer}
.status-select.unassigned{color:var(--muted);border-color:var(--line)}
.status-select.assigned{color:var(--accent);border-color:var(--accent)}
.status-select.contacted{color:var(--warn);border-color:var(--warn)}
.status-select.interested{color:var(--ok);border-color:var(--ok);background:#ecfdf5}
.status-select.not_interested{color:var(--bad);border-color:var(--bad)}
.status-select.do_not_call{color:#fff;background:var(--bad);border-color:var(--bad)}
.tele-select{height:34px;padding:0 8px;font:600 11px/1 var(--sans);border:1px solid var(--line);background:var(--sheet);border-radius:3px;cursor:pointer;max-width:180px}
.district-card{border:1px solid var(--line);background:var(--sheet);margin-bottom:14px;border-radius:6px;overflow:hidden;transition:border-color .15s}
.district-head{display:flex;align-items:center;justify-content:space-between;padding:16px 20px;cursor:pointer;user-select:none;background:var(--sheet)}
.district-head:hover{background:#f4f5f7}
.district-title{display:flex;align-items:center;gap:12px}
.district-title h3{margin:0;font-size:18px;font-weight:700;letter-spacing:-.015em}
.district-badge{font:650 10px/1 var(--mono);background:#e0e7ff;color:var(--accent);padding:3px 8px;border-radius:4px;text-transform:uppercase}
.district-chevron{font-size:14px;color:var(--muted);transition:transform .2s}
.district-card.expanded .district-chevron{transform:rotate(180deg)}
.district-body{display:none;padding:12px 18px 20px;border-top:1px solid var(--soft);background:#fafbfc}
.district-card.expanded .district-body{display:block}
.town-block{margin-top:14px;padding:14px 16px;background:#fff;border:1px solid var(--line);border-radius:6px}
.town-head{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;margin-bottom:12px}
.town-title{font-size:15px;font-weight:700;color:var(--ink)}
.taman-scan-group{display:flex;flex-wrap:wrap;gap:4px}
.taman-grid{display:flex;flex-wrap:wrap;gap:8px}
.taman-pill{display:inline-flex;align-items:center;gap:8px;padding:6px 11px;background:#f8f9fa;border:1px solid var(--line);border-radius:4px;font-size:12.5px;color:var(--ink)}
.taman-pill.scanned{border-color:var(--ok);background:#f4fbf7}
.taman-pill.scanning{border-color:var(--warn);background:#fffdf0}
.taman-pip{width:7px;height:7px;border-radius:50%;background:#b4b2ac;flex-shrink:0}
.taman-pip.scanned{background:var(--ok)}
.taman-pip.scanning{background:var(--warn);animation:pulse 1.8s infinite}
.taman-name{font-weight:550}
.taman-link{color:var(--ok);font:600 11px/1 var(--mono);text-decoration:none}
.taman-link:hover{text-decoration:underline}
.taman-scan-action{border:0;background:var(--ink);color:#fff;font:700 9px/1 var(--sans);letter-spacing:.05em;text-transform:uppercase;padding:4px 8px;border-radius:3px;cursor:pointer}
.taman-scan-action:hover{background:var(--accent)}
.taman-scan-action:disabled{opacity:.5;cursor:wait}
.taman-assign-btn{border:1px dashed #b8b5ad;background:#fff;color:#555;font:600 11px/1 var(--sans);padding:3px 7px;border-radius:3px;cursor:pointer;display:inline-flex;align-items:center;gap:4px;white-space:nowrap;transition:all .15s}
.taman-assign-btn:hover{border-color:var(--accent);color:var(--accent);background:#f0f4ff}
.taman-assign-btn.assigned{border:1px solid #93c5fd;background:#eff6ff;color:#1d4ed8;font-weight:650}
.taman-assign-btn.assigned:hover{border-color:#3b82f6;background:#dbeafe}
.modal-backdrop{position:fixed;inset:0;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;z-index:9999;padding:16px}
.modal-backdrop.hidden{display:none}
.modal-dialog{background:#fff;border-radius:8px;box-shadow:0 10px 25px rgba(0,0,0,.15);max-width:440px;width:100%;padding:22px 24px;border:1px solid var(--line)}
.modal-head{display:flex;align-items:start;justify-content:space-between;gap:12px;border-bottom:1px solid var(--soft);padding-bottom:12px}
@media(max-width:820px){
  .result-summary.lead-summary-grid,#leadsSummary.result-summary.lead-summary-grid{grid-template-columns:repeat(2,1fr)}
  .lead-row{grid-template-columns:26px 1fr;gap:12px 10px;padding:18px 0}
  .lead-row.has-contact-research{margin:0 -8px;padding:18px 8px}
  .lead-row>div:nth-child(3),.lead-row>div:nth-child(4),.lead-row>div:nth-child(5){grid-column:2}
}
.agent-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(330px,1fr));gap:16px}
.agent-card{background:#fff;border:1px solid var(--line);border-radius:6px;padding:20px;display:flex;flex-direction:column;gap:14px;box-shadow:0 1px 3px rgba(0,0,0,.04);position:relative}
.agent-card.inactive{opacity:.65;background:#fdfdfd}
.agent-card-head{display:flex;align-items:start;justify-content:space-between;gap:10px}
.agent-avatar{width:38px;height:38px;border-radius:50%;background:var(--accent);color:#fff;display:grid;place-items:center;font-weight:700;font-size:14px;flex-shrink:0}
.agent-meta-block{flex:1;min-width:0}
.agent-name{margin:0;font-size:17px;font-weight:700;color:var(--ink);letter-spacing:-.015em;display:flex;align-items:center;gap:8px}
.agent-contact-line{margin-top:4px;font-size:12.5px;color:var(--muted);display:flex;flex-wrap:wrap;gap:10px}
.agent-notes-box{font-size:12px;color:var(--muted);background:#f8f9fa;border:1px solid var(--soft);border-radius:4px;padding:6px 10px;line-height:1.4}
.agent-metrics-row{display:grid;grid-template-columns:repeat(4,1fr);background:#fafbfc;border:1px solid var(--soft);border-radius:4px;text-align:center;padding:8px 4px}
.agent-metric-item{padding:2px 4px}
.agent-metric-item+.agent-metric-item{border-left:1px solid var(--soft)}
.agent-metric-num{font:700 15px/1 var(--mono);color:var(--ink)}
.agent-metric-lbl{margin-top:4px;font:700 7.5px/1 var(--sans);letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}
.agent-actions-row{display:flex;align-items:center;gap:8px;margin-top:auto;padding-top:10px;border-top:1px solid var(--soft);flex-wrap:wrap}
.contact-group-card{background:#fff;border:1px solid var(--line);border-radius:6px;padding:20px;margin-bottom:18px;box-shadow:0 1px 3px rgba(0,0,0,.03);display:flex;flex-direction:column;gap:16px}
.contact-group-card:hover{border-color:#b4b2ac}
.contact-group-head{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;flex-wrap:wrap;border-bottom:1px solid var(--soft);padding-bottom:14px}
.contact-group-title{font-size:18px;font-weight:700;color:var(--ink);margin:0 0 4px}
.contact-group-meta{font-size:12.5px;color:var(--muted);display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.contact-pill-tag{font:700 10.5px/1 var(--sans);letter-spacing:.04em;padding:4px 8px;border-radius:4px;display:inline-flex;align-items:center;gap:4px}
.contact-pill-tag.dm{background:#eff6ff;color:#1e40af;border:1px solid #bfdbfe}
.contact-pill-tag.mobile{background:#ecfdf5;color:#065f46;border:1px solid #a7f3d0}
.contact-pill-tag.phone{background:#f3f4f6;color:#374151;border:1px solid #e5e7eb}
.contact-subhead{font:700 11px/1 var(--sans);letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin:0 0 10px;display:flex;align-items:center;gap:8px}
.contact-person-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:10px}
.contact-person-box{background:#f9fafb;border:1px solid var(--line);border-radius:5px;padding:10px 12px;display:flex;flex-direction:column;gap:6px}
.contact-person-box.primary-person{background:#f0f7ff;border-color:#93c5fd}
.contact-person-name{font-size:14px;font-weight:700;color:var(--ink);display:flex;align-items:center;justify-content:space-between;gap:6px}
.contact-person-role{font-size:12px;color:var(--muted);font-weight:500}
.contact-phone-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:10px}
.contact-phone-box{background:#f9fafb;border:1px solid var(--line);border-radius:5px;padding:9px 12px;display:flex;align-items:center;justify-content:space-between;gap:8px}
.contact-phone-box.mobile-box{background:#f0fdf4;border-color:#bbf7d0}
.contact-phone-val{font:700 13.5px/1 var(--mono);color:var(--ink)}
.contact-person-table{width:100%;border-collapse:collapse;font-size:13.5px}
.contact-person-table th{text-align:left;font:750 9px/1.2 var(--sans);letter-spacing:.11em;text-transform:uppercase;color:var(--muted);padding:0 12px 10px;border-bottom:1px solid var(--ink);white-space:nowrap}
.contact-person-table td{padding:13px 12px;border-bottom:1px solid var(--soft);vertical-align:top}
.contact-person-table tr:last-child td{border-bottom:0}
.contact-person-table tr.primary-person td{background:#f0f7ff}
.contact-person-table .person-name{font-weight:700;color:var(--ink);letter-spacing:-.01em}
.contact-person-table .person-name.unnamed{font-weight:500;color:var(--muted);font-style:italic}
.contact-person-table .person-position{color:var(--ink)}
.contact-person-table .person-contact{display:flex;flex-direction:column;gap:6px}
.contact-person-table .person-source{font-size:12px;color:var(--muted);word-break:break-word}
.contact-person-table .person-source a{color:var(--accent);text-decoration:none;border-bottom:1px solid currentColor}
.contact-empty-people{padding:18px 4px;color:var(--muted);font-size:13px}
@media(max-width:820px){
  .contact-person-table thead{display:none}
  .contact-person-table,.contact-person-table tbody,.contact-person-table tr,.contact-person-table th,.contact-person-table td{display:block;width:100%}
  .contact-person-table tr{padding:14px 0;border-bottom:1px solid var(--line)}
  .contact-person-table tr:last-child{border-bottom:0}
  .contact-person-table td{padding:5px 0;border:0}
  .contact-person-table td:before{content:attr(data-label);display:block;margin-bottom:3px;font:750 8px/1 var(--sans);letter-spacing:.12em;text-transform:uppercase;color:var(--muted)}
  .contact-person-table tr.primary-person td{background:transparent}
  .contact-person-table tr.primary-person{background:#f0f7ff;margin:0 -12px;padding:14px 12px}
}
.contact-action-btn{display:inline-flex;align-items:center;gap:4px;height:26px;padding:0 8px;font:700 9.5px/1 var(--sans);letter-spacing:.04em;text-transform:uppercase;border-radius:3px;text-decoration:none;cursor:pointer;border:1px solid var(--line);background:#fff;color:var(--ink);transition:all .15s}
.contact-action-btn:hover{background:var(--soft)}
.contact-action-btn.call-btn{background:#0a6b47;color:#fff;border-color:#0a6b47}
.contact-action-btn.call-btn:hover{background:#085438}
.contact-action-btn.wa-btn{background:#25d366;color:#fff;border-color:#25d366}
.contact-action-btn.wa-btn:hover{background:#20ba5a}
.contact-action-btn.copy-btn{background:#f3f4f6;color:var(--ink)}
.contact-cheatsheet-box{background:#fffbeb;border:1px solid #fde68a;border-radius:5px;padding:10px 14px;font-size:12px;color:#92400e;line-height:1.45}
.assign-roster-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:14px;margin-bottom:24px}
.assign-agent-card{background:#fff;border:1px solid var(--line);border-radius:6px;padding:16px;display:flex;flex-direction:column;gap:12px;cursor:pointer;transition:all .15s;position:relative}
.assign-agent-card:hover{border-color:var(--accent);box-shadow:0 3px 12px rgba(0,0,0,.06)}
.assign-agent-card.active{border-color:var(--accent);background:#f0f5ff;box-shadow:0 0 0 2px var(--accent)}
.assign-agent-card.inactive{opacity:.65;background:#fdfdfd}
.assign-agent-head{display:flex;align-items:center;justify-content:space-between;gap:10px}
.assign-agent-info{display:flex;align-items:center;gap:10px;min-width:0}
.assign-agent-avatar{width:36px;height:36px;border-radius:50%;background:var(--accent);color:#fff;display:grid;place-items:center;font-weight:700;font-size:13px;flex-shrink:0}
.assign-agent-name{font-size:15px;font-weight:700;color:var(--ink);letter-spacing:-.01em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.assign-agent-total{display:flex;align-items:baseline;justify-content:space-between;padding:10px 12px;background:#fafbfc;border:1px solid var(--soft);border-radius:5px}
.assign-agent-card.active .assign-agent-total{background:#fff;border-color:#bfdbfe}
.assign-total-num{font:700 24px/1 var(--mono);color:var(--ink)}
.assign-total-lbl{font:700 8.5px/1 var(--sans);letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}
.assign-breakdown-row{display:grid;grid-template-columns:repeat(4,1fr);gap:4px;text-align:center}
.assign-breakdown-cell{background:#fafbfc;border:1px solid var(--soft);border-radius:4px;padding:6px 2px}
.assign-agent-card.active .assign-breakdown-cell{background:#fff;border-color:#bfdbfe}
.assign-breakdown-val{font:700 12px/1 var(--mono);color:var(--ink)}
.assign-breakdown-lbl{margin-top:3px;font:700 7px/1 var(--sans);letter-spacing:.06em;text-transform:uppercase;color:var(--muted)}
.assign-progress-bar{height:6px;border-radius:3px;background:#e5e7eb;overflow:hidden;display:flex}
.assign-bar-part{height:100%}
.assign-bar-contacted{background:var(--warn)}
.assign-bar-interested{background:var(--ok)}
.assign-bar-lost{background:var(--bad)}
.assign-bar-pending{background:#93c5fd}
.assign-active-badge{display:none;position:absolute;top:10px;right:10px;font:750 8.5px/1 var(--sans);letter-spacing:.08em;text-transform:uppercase;color:var(--accent);background:#dbeafe;padding:3px 7px;border-radius:3px}
.assign-agent-card.active .assign-active-badge{display:inline-block}
.assign-roster-grid.view-list{display:block;margin-bottom:0}
.assign-roster-grid.view-cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:14px;margin-bottom:24px}
.assign-roster-table-wrap{width:100%;max-height:480px;overflow-y:auto;overflow-x:auto;border:1px solid var(--line);border-radius:6px;background:#fff;margin-bottom:12px;box-shadow:0 1px 3px rgba(0,0,0,.03)}
.assign-roster-table-wrap.expanded{max-height:none}
.assign-roster-table{width:100%;border-collapse:collapse;font-size:13px;text-align:left}
.assign-roster-table thead th{position:sticky;top:0;z-index:3;background:#f8f9fa;font:750 9px/1.2 var(--sans);letter-spacing:.1em;text-transform:uppercase;color:var(--muted);padding:11px 14px;border-bottom:2px solid var(--ink);white-space:nowrap;user-select:none}
.assign-roster-table thead th.sortable{cursor:pointer;transition:color .15s,background .15s}
.assign-roster-table thead th.sortable:hover{color:var(--ink);background:#f1f2f4}
.assign-roster-row{border-bottom:1px solid var(--soft);cursor:pointer;transition:background .15s}
.assign-roster-row:hover{background:#f8fafc}
.assign-roster-row.active{background:#eff6ff!important;border-left:3px solid var(--accent)}
.assign-roster-row.inactive{opacity:.75}
.assign-roster-row td{padding:10px 14px;vertical-align:middle}
.assign-roster-row.system-row{background:#fafbfc;border-bottom:1px solid var(--line)}
.assign-roster-row.system-row:hover{background:#f1f5f9}
.assign-roster-row.unassigned-row{background:#fffdf5}
.assign-roster-row.unassigned-row:hover{background:#fef9c3}
.assign-roster-row.unassigned-row.active{background:#fffbeb!important;border-left:3px solid #f59e0b}
.assign-num-bold{font:700 15px/1 var(--mono);color:var(--ink)}
.assign-num-cell{font:600 13px/1 var(--mono);color:var(--ink)}
.assign-num-cell.pending{color:#2563eb}
.assign-num-cell.contacted{color:var(--warn)}
.assign-num-cell.interested{color:var(--ok);font-weight:700}
.assign-num-cell.lost{color:var(--muted)}
.assign-active-badge-sm{font:750 8px/1 var(--sans);letter-spacing:.08em;text-transform:uppercase;color:var(--accent);background:#dbeafe;padding:2px 6px;border-radius:3px;display:inline-block}
.assign-roster-footer{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;padding:9px 14px;background:#f9fafb;border:1px solid var(--line);border-radius:5px;font:500 11.5px/1 var(--sans);color:var(--muted);margin-bottom:24px}
.assign-mini-bar{display:flex;height:6px;width:100%;max-width:130px;border-radius:3px;background:#e5e7eb;overflow:hidden}
.assign-mini-seg{height:100%}
.assign-mini-seg.pending{background:#93c5fd}
.assign-mini-seg.contacted{background:var(--warn)}
.assign-mini-seg.interested{background:var(--ok)}
.assign-mini-seg.lost{background:#d1d5db}
.act-chart-wrap{display:flex;align-items:flex-end;gap:14px;min-height:220px;padding:24px 12px 10px;overflow-x:auto}
.act-bar-col{flex:1;min-width:64px;display:flex;flex-direction:column;align-items:center;gap:8px}
.act-bar-val{font:700 12px/1 var(--mono);color:var(--ink)}
.act-bar-stack{width:100%;max-width:44px;min-height:4px;border-radius:4px 4px 0 0;overflow:hidden;display:flex;flex-direction:column-reverse;background:#f3f4f6}
.act-bar-seg{width:100%;transition:height .2s}
.act-bar-lbl{font:650 9px/1.2 var(--sans);color:var(--muted);text-transform:uppercase;letter-spacing:.05em;text-align:center;word-break:keep-all}
.act-legend{display:flex;flex-wrap:wrap;gap:14px;align-items:center;padding-top:16px;border-top:1px solid var(--soft);margin-top:14px}
.act-legend-item{display:inline-flex;align-items:center;gap:6px;font:650 11px/1 var(--sans);color:var(--muted)}
.act-legend-pip{width:9px;height:9px;border-radius:2px}
.act-table{width:100%;border-collapse:collapse;font-size:13px;margin-top:12px}
.act-table th{text-align:left;font:750 9px/1.2 var(--sans);letter-spacing:.11em;text-transform:uppercase;color:var(--muted);padding:8px 12px;border-bottom:1px solid var(--ink)}
.act-table td{padding:12px;border-bottom:1px solid var(--soft);vertical-align:middle}
.act-table tr:hover td{background:#fafafa}
.act-progress-row{margin-bottom:14px}
.act-progress-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;font-size:12.5px}
.act-progress-bar{height:10px;border-radius:5px;background:#e5e7eb;overflow:hidden;display:flex}
.act-trans-pill{display:inline-flex;align-items:center;gap:6px;font:700 9px/1 var(--sans);letter-spacing:.06em;text-transform:uppercase;padding:4px 8px;border-radius:3px}
.act-note-bubble{background:#f8f9fa;border:1px solid var(--soft);border-radius:4px;padding:8px 12px;font-size:12.5px;color:var(--ink);line-height:1.45;margin-top:6px}
.act-podium{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:16px;margin:18px 0 24px}
.act-podium-card{background:#fff;border:1px solid var(--line);border-radius:8px;padding:20px;display:flex;flex-direction:column;position:relative;box-shadow:0 1px 3px rgba(0,0,0,.04);transition:transform .15s,box-shadow .15s}
.act-podium-card:hover{transform:translateY(-2px);box-shadow:0 4px 12px rgba(0,0,0,.08)}
.act-podium-card.rank-1{border-color:#f59e0b;background:linear-gradient(180deg,#fffbeb 0%,#fff 45%)}
.act-podium-card.rank-2{border-color:#94a3b8;background:linear-gradient(180deg,#f8fafc 0%,#fff 45%)}
.act-podium-card.rank-3{border-color:#d97706;background:linear-gradient(180deg,#fff7ed 0%,#fff 45%)}
.act-rank-tag{display:inline-flex;align-items:center;gap:4px;font:750 11px/1 var(--mono);padding:4px 8px;border-radius:4px;width:max-content}
.act-rank-tag.gold{background:#fef3c7;color:#92400e;border:1px solid #fde68a}
.act-rank-tag.silver{background:#f1f5f9;color:#334155;border:1px solid #e2e8f0}
.act-rank-tag.bronze{background:#ffedd5;color:#9a3412;border:1px solid #fed7aa}
.act-rank-tag.default{background:#f3f4f6;color:#4b5563}
.new-incoming-pill{display:inline-flex;align-items:center;gap:4px;font:750 9px/1 var(--sans);letter-spacing:.06em;text-transform:uppercase;padding:3px 7px;border-radius:3px;background:#ecfdf5;color:#065f46;border:1px solid #6ee7b7;animation:incomingPulse 2s infinite}
@keyframes incomingPulse{0%,100%{box-shadow:0 0 0 0 rgba(16,185,129,.4)}50%{box-shadow:0 0 0 4px rgba(16,185,129,.15)}}
.live-monitor-banner{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 16px;background:#ecfdf5;border:1px solid #a7f3d0;border-radius:6px;margin:20px 0 16px;font-size:12.5px;color:#065f46;flex-wrap:wrap}
.new-lead-alert{background:#fef3c7;border:1px solid #fde68a;color:#92400e;padding:10px 14px;border-radius:6px;margin-bottom:14px;font-size:13px;display:flex;align-items:center;justify-content:space-between}
</style></head><body>
<div id="accessGate" class="gate"><div class="gate-panel"><div class="gate-mark">EE</div><h1>Private intelligence workspace.</h1><p>Enter the access key supplied by the workspace owner. You enter it once: it stays in this browser and is never added to a report link.</p><form class="gate-form" onsubmit="connect(event)"><input id="accessKey" type="password" autocomplete="current-password" placeholder="Workspace access key" aria-label="Workspace access key"><button id="connectButton" class="primary" type="submit">Enter</button></form><p id="gateError" class="gate-error" role="alert"></p><p class="gate-help"><a href="/guide" target="_blank" rel="noopener">New here? Read the guide first ↗ · 新手指南</a></p></div></div>
<div id="portalApp" class="app" aria-hidden="true" inert>
  <header class="mast"><div class="mast-inner"><button type="button" class="brand" aria-label="Home" onclick="switchView('discover')"><span class="mark">EE</span><span>Business intelligence</span></button><nav class="desktop-nav" aria-label="Workspace"><button class="nav-button active" data-view="discover" onclick="switchView('discover')">Home</button><button class="nav-button" data-view="telemarketing" onclick="switchView('telemarketing')">Telemarketing</button><button class="nav-button" data-view="assignment" onclick="switchView('assignment')">Lead Assignment</button><button class="nav-button" data-view="activity" onclick="switchView('activity')">Lead Activity</button><button class="nav-button" data-view="leads" onclick="switchView('leads')">Leads Master</button><button class="nav-button" data-view="adsLeads" onclick="switchView('adsLeads')">⚡ Ads Leads</button><button class="nav-button" data-view="contacts" onclick="switchView('contacts')">Contacts Master</button><button class="nav-button" data-view="email" onclick="switchView('email')">Email Marketing</button><button class="nav-button" data-view="agents" onclick="switchView('agents')">Telemarketers</button><button class="nav-button" data-view="library" onclick="switchView('library')">Reports</button><a class="nav-button" href="/guide" target="_blank" rel="noopener">Guide</a><span class="access"><span class="access-dot"></span>Connected</span><button class="signout" onclick="disconnect()">Sign out</button></nav><button class="signout" onclick="disconnect()">Exit</button></div></header>
  <main class="content">
    <section id="discoverView" class="view active">
      <div class="hero"><div class="eyebrow" id="heroEyebrow">Live market discovery</div><h1 id="heroTitle">Find the companies worth knowing.</h1><p id="heroCopy">Pick one. Nothing is researched until you say so.</p></div>
      <div id="chooser" class="chooser" role="group" aria-label="Choose a tool"><button type="button" class="choice" data-mode="market" onclick="choose('market')"><span class="choice-no">01</span><h2>Business list</h2><p class="choice-copy">Scan a market on Google Maps. A ranked list of businesses with phones, websites, and deep research one click from every row.</p><span class="choice-go">Open →</span></button><button type="button" class="choice" data-mode="company" onclick="choose('company')"><span class="choice-no">02</span><h2>Company research</h2><p class="choice-copy">You already know the name. Confirm the Maps listing, then run the evidence-guarded dossier on that one company.</p><span class="choice-go">Open →</span></button><button type="button" class="choice" data-mode="adsmarket" onclick="choose('adsmarket')"><span class="choice-no">03</span><h2>Ads market research</h2><p class="choice-copy">Give a product keyword. Every live Facebook ad in that market, rolled up into who is advertising, what they offer, and where the gaps are.</p><span class="choice-go">Open \u2192</span></button><button type="button" class="choice" data-choice="reports" onclick="choose('reports')"><span class="choice-no">04</span><h2>Completed report</h2><p class="choice-copy">Every business list, company dossier, VIP brief and ads capture, on permanent links that keep refreshing while a run is live.</p><span class="choice-go">Open →</span></button></div>
      <form id="searchForm" class="search-sheet hidden" onsubmit="startSearch(event)"><div class="sheet-head"><button type="button" class="back" onclick="goHome()">← All tools</button><span class="sheet-title" id="sheetTitle">Business list</span></div><div class="search-grid" id="marketGrid"><div class="field keyword"><label for="keyword">Business or service <span>(optional)</span></label><input class="input" id="keyword" placeholder="e.g. solar installer"></div><div class="field"><label for="place">Location <span>(optional)</span></label><input class="input" id="place" placeholder="e.g. Kuala Lumpur"></div><div class="field"><label for="maxResults">Results</label><select class="input select" id="maxResults"><option value="200" selected>200</option><option value="400">400</option><option value="600">600</option><option value="2000">All (2000)</option></select></div><button id="searchButton" class="primary" type="submit">Search market</button></div><div class="search-grid company-grid hidden" id="companyGrid"><div class="field keyword"><label for="companyName">Company name</label><input class="input" id="companyName" placeholder="e.g. Solarvest Holdings Berhad"></div><div class="field"><label for="companyPlace">Location <span>(optional, narrows the match)</span></label><input class="input" id="companyPlace" placeholder="e.g. Petaling Jaya"></div><button id="lookupButton" class="primary" type="submit">Find company</button></div><div class="search-grid ads-grid hidden" id="adsGrid"><div class="field keyword"><label for="adsKeyword">Product keyword</label><input class="input" id="adsKeyword" placeholder="e.g. solar panel"></div><div class="field"><label for="adsCountry">Country</label><select class="input select" id="adsCountry"><option value="Malaysia" selected>Malaysia</option><option value="Singapore">Singapore</option><option value="Indonesia">Indonesia</option><option value="Thailand">Thailand</option><option value="Philippines">Philippines</option><option value="Vietnam">Vietnam</option></select></div><div class="field"><label for="adsPages">Depth</label><select class="input select" id="adsPages"><option value="8">Up to 240 ads</option><option value="12" selected>Up to 360 ads</option><option value="20">Up to 600 ads</option></select></div><button id="adsButton" class="primary" type="submit">Research market</button></div><p class="form-note" id="formNote">Enter a business, a location, or both. A stable report link is created immediately.</p></form>
      <div class="workspace">
        <section id="activeSection" class="hidden"><div class="section-head"><h2>Active work</h2><span class="section-note">Research continues in the background. You may switch views safely.</span></div><div id="jobs" class="jobs"></div></section>
        <section id="searchOutput" class="hidden"><div class="section-head"><h2 id="resultTitle">Search results</h2><span id="resultNote" class="section-note"></span></div><div id="resultSummary" class="result-summary"></div><div id="companies" class="company-list"></div></section>
        <section id="discoverEmpty"><div class="empty">Your latest business list will appear here.</div></section>
      </div>
    </section>
    <section id="telemarketingView" class="view">
      <div class="library-hero">
        <div class="eyebrow">Territory Coverage & Market Scans</div>
        <h1>Telemarketing Lead Map.</h1>
        <p>Systematically blanket commercial zones and neighborhoods across Johor and Selangor. Drill down by District, Town, and Taman to dispatch Google Maps business market scans.</p>
      </div>
      <div class="result-summary" style="margin-top:24px;">
        <div class="metric"><strong id="teleDistrictsCount">10</strong><span>Districts</span></div>
        <div class="metric"><strong id="teleTownsCount">70</strong><span>Towns & Zones</span></div>
        <div class="metric"><strong id="teleTamansCount">771</strong><span>Total Tamans</span></div>
        <div class="metric"><strong id="teleScannedCount" style="color:var(--ok);">0</strong><span>Tamans Scanned</span></div>
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:12px;align-items:center;justify-content:space-between;margin:24px 0 20px;padding:16px 20px;background:#f8f9fa;border:1px solid var(--line);border-radius:6px;">
        <div style="display:flex;flex-wrap:wrap;gap:10px;align-items:center;flex:1;min-width:280px;">
          <div style="display:flex;flex-direction:column;gap:3px;">
            <span style="font:var(--micro);text-transform:uppercase;color:var(--muted);letter-spacing:var(--track)">State</span>
            <select class="input select" id="teleStateSelect" onchange="onTeleStateChange()" style="height:38px;font-size:13px;font-weight:600;min-width:110px;">
              <option value="johor" selected>Johor</option>
              <option value="selangor">Selangor</option>
            </select>
          </div>
          <div style="display:flex;flex-direction:column;gap:3px;">
            <span style="font:var(--micro);text-transform:uppercase;color:var(--muted);letter-spacing:var(--track)">Max Results</span>
            <select class="input select" id="teleMaxResults" style="height:38px;font-size:13px;width:110px;">
              <option value="2000" selected>All (up to 2000)</option>
              <option value="200">200 leads</option>
              <option value="400">400 leads</option>
              <option value="600">600 leads</option>
              <option value="100">100 leads</option>
            </select>
          </div>
          <div style="display:flex;flex-direction:column;gap:3px;flex:1;min-width:180px;">
            <span style="font:var(--micro);text-transform:uppercase;color:var(--muted);letter-spacing:var(--track)">Filter Territory</span>
            <input class="input" id="teleFilterInput" oninput="filterTerritoryCards()" placeholder="Search town or taman (e.g. Ros Merah, Austin)..." style="height:38px;font-size:13.5px;">
          </div>
        </div>
        <div style="display:flex;gap:8px;align-items:flex-end;">
          <button class="filter" type="button" onclick="expandAllDistricts(true)">Expand All</button>
          <button class="filter" type="button" onclick="expandAllDistricts(false)">Collapse All</button>
          <button class="primary" type="button" onclick="loadTelemarketingView()" style="height:38px;padding:0 14px;">Refresh</button>
        </div>
      </div>
      <div id="teleTerritoryContainer">
        <div class="empty">Loading Johor territory directory…</div>
      </div>
      <div id="tamanAssignModal" class="modal-backdrop hidden" onclick="if(event.target===this)closeTamanAssignModal()">
        <div class="modal-dialog" role="dialog" aria-labelledby="tamanModalTitle">
          <div class="modal-head">
            <div>
              <span class="sheet-title" id="tamanModalTitle">Assign Taman Leads</span>
              <p class="modal-sub" id="tamanModalSub" style="margin:4px 0 0;font-size:12.5px;color:var(--muted);"></p>
            </div>
            <button type="button" class="back" onclick="closeTamanAssignModal()">✕</button>
          </div>
          <form onsubmit="submitTamanAssign(event)">
            <input type="hidden" id="tamanAssignTaman" value="">
            <input type="hidden" id="tamanAssignQueryPlace" value="">
            <input type="hidden" id="tamanAssignPublicId" value="">
            <input type="hidden" id="tamanAssignTown" value="">
            <input type="hidden" id="tamanAssignDistrict" value="">
            <div class="field" style="margin:16px 0 12px;">
              <label for="tamanAssignTeleSelect" style="font-weight:600;font-size:12px;margin-bottom:6px;display:block;">Assign to Telemarketer *</label>
              <select class="input select" id="tamanAssignTeleSelect" required style="width:100%;height:40px;font-size:13.5px;">
                <option value="">Choose telemarketer...</option>
              </select>
            </div>
            <div id="tamanModalCurrentAssignee" style="display:none;margin-bottom:14px;padding:8px 12px;background:#f0f4ff;border:1px solid #c7d2fe;border-radius:4px;font-size:12px;color:#1e40af;">
              Currently assigned to: <strong id="tamanCurrentAssigneeName"></strong>
            </div>
            <div style="display:flex;gap:10px;margin-top:20px;align-items:center;justify-content:space-between;flex-wrap:wrap;">
              <div style="display:flex;gap:8px;">
                <button class="primary" type="submit" id="tamanAssignSubmitBtn" style="height:36px;padding:0 16px;">Assign All Leads</button>
                <button class="filter" type="button" onclick="closeTamanAssignModal()" style="height:36px;padding:0 14px;">Cancel</button>
              </div>
              <button class="filter" type="button" id="tamanUnassignBtn" onclick="submitTamanUnassign()" style="display:none;height:36px;padding:0 12px;color:var(--bad);border-color:#fca5a5;">Unassign</button>
            </div>
          </form>
        </div>
      </div>
    </section>
    <section id="assignmentView" class="view">
      <div class="library-hero">
        <div class="eyebrow">Lead Allocation & Workload Distribution</div>
        <h1>Telemarketer Lead Assignment.</h1>
        <p>Monitor lead allocation per telemarketer, filter assigned queues, inspect conversion counts, and reassign leads across your team.</p>
      </div>

      <div class="result-summary lead-summary-grid" style="margin-top:24px;">
        <div class="metric"><strong id="assignStatTotal">0</strong><span>Total Leads Pool</span></div>
        <div class="metric"><strong id="assignStatAssigned" style="color:var(--accent);">0</strong><span>Assigned Leads</span></div>
        <div class="metric"><strong id="assignStatUnassigned" style="color:var(--warn);">0</strong><span>Unassigned Leads</span></div>
        <div class="metric"><strong id="assignStatAgents" style="color:var(--ok);">0</strong><span>Active Telemarketers</span></div>
        <div class="metric"><strong id="assignStatContacted">0</strong><span>Contacted Leads</span></div>
        <div class="metric"><strong id="assignStatInterested" style="color:var(--ok);">0</strong><span>Interested Leads</span></div>
      </div>

      <div style="margin:28px 0 12px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;">
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
          <div style="font:700 12px/1 var(--sans);letter-spacing:.08em;text-transform:uppercase;color:var(--muted);display:flex;align-items:center;gap:8px;">
            <span>Telemarketer Workload & Quota Breakdown</span>
            <span style="font-size:11px;font-weight:500;text-transform:none;color:var(--muted);">(Click any row to filter leads)</span>
          </div>
          <span id="assignRosterCountBadge" style="font:700 10px/1 var(--mono);background:var(--soft);color:var(--ink);padding:4px 8px;border-radius:12px;">0 Agents</span>
        </div>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
          <div style="position:relative;display:flex;align-items:center;">
            <input class="input" id="assignRosterSearch" placeholder="Filter agents by name / phone..." oninput="onAssignRosterSearch(this.value)" style="height:32px;font-size:12px;width:220px;padding-right:24px;">
            <span style="position:absolute;right:8px;color:var(--muted);font-size:11px;pointer-events:none;">🔍</span>
          </div>
          <div style="display:inline-flex;border:1px solid var(--line);border-radius:3px;overflow:hidden;">
            <button class="filter active" id="btnRosterViewList" type="button" onclick="setAssignRosterView('list')" title="Row-by-row table view" style="height:32px;padding:0 10px;font-size:9.5px;border:0;border-right:1px solid var(--line);">☰ List</button>
            <button class="filter" id="btnRosterViewCards" type="button" onclick="setAssignRosterView('cards')" title="Card grid view" style="height:32px;padding:0 10px;font-size:9.5px;border:0;">⊞ Cards</button>
          </div>
          <button class="filter" type="button" onclick="selectAssignmentTele('all')" style="height:32px;padding:0 10px;font-size:9.5px;">Show All Leads</button>
          <button class="filter" type="button" onclick="selectAssignmentTele('unassigned')" style="height:32px;padding:0 10px;font-size:9.5px;color:var(--warn);border-color:var(--warn);background:#fffbeb;">View Unassigned →</button>
          <button class="filter" id="assignOwnersBtn" type="button" onclick="assignTamanLeadsToOwners()" title="Give every unassigned lead at an assigned taman to that taman's telemarketer" style="height:32px;padding:0 10px;font-size:9.5px;color:var(--accent);border-color:var(--accent);">🏘️ Assign Taman Leads to Owners</button>
        </div>
      </div>

      <div id="assignRosterGrid" class="assign-roster-grid view-list">
        <div class="empty">Loading telemarketer assignments…</div>
      </div>

      <div style="display:flex;flex-wrap:wrap;gap:12px;align-items:center;justify-content:space-between;margin:24px 0 16px;padding:16px 20px;background:#f8f9fa;border:1px solid var(--line);border-radius:6px;">
        <div style="display:flex;flex-wrap:wrap;gap:10px;align-items:center;flex:1;min-width:280px;">
          <div style="display:flex;flex-direction:column;gap:3px;">
            <span style="font:var(--micro);text-transform:uppercase;color:var(--muted);letter-spacing:var(--track)">Filter By Telemarketer</span>
            <select class="input select" id="assignTeleFilter" onchange="onAssignTeleFilterChange()" style="height:38px;font-size:13px;font-weight:600;min-width:240px;">
              <option value="all">👥 All Telemarketers</option>
              <option value="unassigned">📋 Unassigned Leads Only</option>
            </select>
          </div>
          <div style="display:flex;flex-direction:column;gap:3px;">
            <span style="font:var(--micro);text-transform:uppercase;color:var(--muted);letter-spacing:var(--track)">Search Company / Phone / Address</span>
            <input class="input" id="assignSearchInput" placeholder="Search company, phone, category..." style="height:38px;font-size:13.5px;width:240px;" onkeydown="if(event.key==='Enter')applyAssignmentFilter()">
          </div>
          <button class="primary" type="button" onclick="applyAssignmentFilter()" style="height:38px;padding:0 16px;align-self:flex-end;">Filter</button>
        </div>
        <div style="display:flex;gap:8px;align-items:center;align-self:flex-end;">
          <button class="filter" type="button" onclick="switchView('telemarketing')" title="Open Lead Map to scan tamans and assign bulk territories">🗺️ Lead Map →</button>
          <button class="filter" type="button" onclick="switchView('agents')" title="Manage telemarketer team accounts and notes">👥 Telemarketers →</button>
          <button class="filter" type="button" onclick="loadAssignmentView()" style="height:38px;">Refresh</button>
        </div>
      </div>

      <div id="assignActiveBanner" class="search-sheet hidden" style="margin:0 0 18px;padding:14px 18px;background:#eff6ff;border-color:#93c5fd;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;">
        <div style="display:flex;align-items:center;gap:10px;">
          <span style="font-size:18px;">👤</span>
          <div>
            <strong id="assignBannerTitle" style="font-size:14px;color:var(--ink);">Telemarketer Queue</strong>
            <div id="assignBannerSubtitle" style="font-size:12px;color:var(--muted);margin-top:2px;">Showing assigned leads</div>
          </div>
        </div>
        <div style="display:flex;gap:8px;align-items:center;">
          <button class="filter" type="button" onclick="selectAssignmentTele('all')" style="height:32px;padding:0 12px;font-size:9.5px;background:#fff;">Clear Filter (Show All)</button>
        </div>
      </div>

      <div class="filters" role="group" aria-label="Assignment status filters" style="margin:16px 0 20px;">
        <button class="filter active" data-assign-status="all" onclick="setAssignmentStatusFilter('all')">All Leads (<span id="assignCountAll">0</span>)</button>
        <button class="filter" data-assign-status="assigned" onclick="setAssignmentStatusFilter('assigned')">⏳ Pending to Call (<span id="assignCountAssigned">0</span>)</button>
        <button class="filter" data-assign-status="contacted" onclick="setAssignmentStatusFilter('contacted')">📞 Contacted (<span id="assignCountContacted">0</span>)</button>
        <button class="filter" data-assign-status="interested" onclick="setAssignmentStatusFilter('interested')">⭐ Interested (<span id="assignCountInterested">0</span>)</button>
        <button class="filter" data-assign-status="not_interested" onclick="setAssignmentStatusFilter('not_interested')">Not Interested (<span id="assignCountNotInterested">0</span>)</button>
        <button class="filter" data-assign-status="do_not_call" onclick="setAssignmentStatusFilter('do_not_call')">⛔ DNC (<span id="assignCountDnc">0</span>)</button>
      </div>

      <div id="assignBulkBar" class="search-sheet hidden" style="margin:0 0 20px;padding:14px 18px;border-color:var(--accent);background:#f0f4ff;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;">
        <div style="display:flex;align-items:center;gap:14px;">
          <strong style="font-size:13px;color:var(--ink);"><span id="assignBulkCount">0</span> selected</strong>
          <label style="display:flex;align-items:center;gap:6px;font-size:12px;cursor:pointer;user-select:none;">
            <input type="checkbox" id="assignSelectAllPage" onchange="toggleAssignSelectAllPage(this.checked)"> Select all on this page
          </label>
        </div>
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
          <select class="input select" id="assignBulkTargetSelect" style="height:36px;font-size:13px;background-color:#fff;min-width:200px;">
            <option value="">Choose telemarketer...</option>
          </select>
          <button class="primary" type="button" onclick="bulkAssignFromAssignmentView()" style="height:36px;padding:0 14px;">Assign Selected</button>
          <button class="filter" type="button" onclick="bulkUnassignFromAssignmentView()" style="height:36px;">Unassign Selected</button>
        </div>
      </div>

      <div id="assignmentLeadsWrapper" class="company-list">
        <div class="empty">Loading leads…</div>
      </div>

      <div id="assignPagination" style="display:flex;align-items:center;justify-content:space-between;padding:24px 0 32px;border-top:1px solid var(--line);margin-top:20px;">
        <span id="assignPageInfo" style="font:500 12px/1 var(--mono);color:var(--muted);">Showing 0 of 0</span>
        <div style="display:flex;gap:8px;">
          <button id="btnPrevAssign" class="filter" type="button" onclick="prevAssignPage()" disabled>&larr; Previous</button>
          <button id="btnNextAssign" class="filter" type="button" onclick="nextAssignPage()" disabled>Next &rarr;</button>
        </div>
      </div>
    </section>
    <section id="activityView" class="view">
      <div class="library-hero">
        <div class="eyebrow">Real-Time Operations & Presentation Intelligence</div>
        <h1>Lead activity & daily progress.</h1>
        <p>Interactive presentation dashboard tracking daily outreach processing, pipeline progress by status type, per-telemarketer performance summaries, and live call logs.</p>
      </div>

      <!-- Action bar with presentation tools -->
      <div style="display:flex;flex-wrap:wrap;gap:12px;align-items:center;justify-content:space-between;margin:24px 0 20px;padding:16px 20px;background:#f8f9fa;border:1px solid var(--line);border-radius:6px;">
        <div style="display:flex;flex-wrap:wrap;gap:10px;align-items:center;">
          <div style="display:flex;flex-direction:column;gap:3px;">
            <span style="font:var(--micro);text-transform:uppercase;color:var(--muted);letter-spacing:var(--track)">Timeframe</span>
            <select class="input select" id="activityDaysSelect" onchange="onActivityTimeframeChange()" style="height:38px;font-size:13px;font-weight:600;min-width:140px;">
              <option value="7" selected>Last 7 Days</option>
              <option value="14">Last 14 Days</option>
              <option value="30">Last 30 Days</option>
              <option value="3">Last 3 Days</option>
              <option value="1">Today</option>
              <option value="yesterday">Yesterday</option>
              <option value="this_month">This Month</option>
              <option value="custom">📅 Custom Date Range...</option>
            </select>
          </div>
          <div id="activityCustomDateInputs" class="hidden" style="display:flex;align-items:flex-end;gap:6px;">
            <div style="display:flex;flex-direction:column;gap:3px;">
              <span style="font:var(--micro);text-transform:uppercase;color:var(--muted);letter-spacing:var(--track)">From</span>
              <input type="date" class="input" id="actStartDate" style="height:38px;font-size:13px;padding:0 8px;">
            </div>
            <div style="display:flex;flex-direction:column;gap:3px;">
              <span style="font:var(--micro);text-transform:uppercase;color:var(--muted);letter-spacing:var(--track)">To</span>
              <input type="date" class="input" id="actEndDate" style="height:38px;font-size:13px;padding:0 8px;">
            </div>
            <button class="filter" type="button" onclick="loadActivityView()" style="height:38px;padding:0 12px;">Apply 🔍</button>
          </div>
          <div style="display:flex;flex-direction:column;gap:3px;">
            <span style="font:var(--micro);text-transform:uppercase;color:var(--muted);letter-spacing:var(--track)">Telemarketer</span>
            <select class="input select" id="activityTeleFilter" onchange="loadActivityView()" style="height:38px;font-size:13px;font-weight:600;min-width:180px;">
              <option value="all">👥 All Telemarketers</option>
            </select>
          </div>
        </div>
        <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;">
          <button class="primary" type="button" onclick="openMockDataModal()" style="height:38px;padding:0 16px;background:#2759ff;" title="Generate realistic mock presentation data (contact info is 100% safe)">⚡ Generate Mock Data</button>
          <button class="filter" type="button" onclick="openManualActivityModal()" style="height:38px;padding:0 12px;" title="Manually record a call note or update lead status">➕ Log Activity</button>
          <button class="filter" type="button" onclick="openResetProgressModal()" style="height:38px;padding:0 12px;color:var(--bad);border-color:#fca5a5;background:#fff5f5;" title="Reset all mock lead assignments, statuses and notes back to default">🧹 Clear / Reset Progress</button>
          <button class="filter" type="button" onclick="loadActivityView()" style="height:38px;">Refresh</button>
        </div>
      </div>

      <!-- Top KPI Metric Cards -->
      <div class="result-summary lead-summary-grid" style="margin-top:10px;">
        <div class="metric"><strong id="actKpiProcessed">0</strong><span>Total Activities</span></div>
        <div class="metric"><strong id="actKpiToday" style="color:var(--accent);">0</strong><span>Processed Today</span></div>
        <div class="metric"><strong id="actKpiContacted" style="color:var(--warn);">0</strong><span>Leads Contacted</span></div>
        <div class="metric"><strong id="actKpiInterested" style="color:var(--ok);">0</strong><span>Interested ⭐</span></div>
        <div class="metric"><strong id="actKpiConversion" style="color:var(--ok);">0%</strong><span>Interest Rate</span></div>
        <div class="metric"><strong id="actKpiAgents">0</strong><span>Active Telemarketers</span></div>
      </div>

      <!-- Presentation Item 1: Daily Lead Processed (with status changed) -->
      <div style="margin:36px 0 16px;">
        <div class="section-head">
          <div>
            <div class="eyebrow">Presentation View 01</div>
            <h2 style="margin:4px 0 0;">Daily Leads Processed (With Status Changed)</h2>
          </div>
          <span class="section-note">Daily volume of processed leads with status changes. Demonstrates team velocity and pipeline activity.</span>
        </div>
        <div id="activityDailyChartContainer" style="background:#fff;border:1px solid var(--line);border-radius:6px;padding:24px;margin-bottom:24px;">
          <div class="empty">Loading daily processed volume…</div>
        </div>
      </div>

      <!-- Presentation Item 2: Lead Progress Per Day Per Status Type -->
      <div style="margin:36px 0 16px;">
        <div class="section-head">
          <div>
            <div class="eyebrow">Presentation View 02</div>
            <h2 style="margin:4px 0 0;">Lead Progress Per Day Per Status Type</h2>
          </div>
          <span class="section-note">Daily breakdown across Contacted, Interested, Not Interested, Do Not Call, and Assigned.</span>
        </div>
        <div id="activityProgressContainer" style="background:#fff;border:1px solid var(--line);border-radius:6px;padding:24px;margin-bottom:24px;">
          <div class="empty">Loading progress breakdown…</div>
        </div>
      </div>

      <!-- Presentation Item 3: Per Telemarketer Activity Summary -->
      <div style="margin:36px 0 16px;">
        <div class="section-head">
          <div>
            <div class="eyebrow">Presentation View 03</div>
            <h2 style="margin:4px 0 0;">Per-Telemarketer Activity Summary</h2>
          </div>
          <span class="section-note">Individual caller quotas, throughput, win rate conversions, and daily outreach velocity.</span>
        </div>
        <div id="activityTeleSummaryContainer" class="agent-grid" style="margin-bottom:24px;">
          <div class="empty">Loading telemarketer summaries…</div>
        </div>
      </div>

      <!-- Presentation Item 4: Top 10 Telemarketer Leaderboard (Select by Date Range) -->
      <div style="margin:36px 0 16px;">
        <div class="section-head">
          <div>
            <div class="eyebrow">Presentation View 04</div>
            <h2 style="margin:4px 0 0;">🏆 Top 10 Telemarketer Leaderboard</h2>
          </div>
          <span class="section-note">Ranked telemarketer performance, client conversions (⭐ Interested), and call velocity across the selected date range.</span>
        </div>

        <!-- Leaderboard Toolbar: Date range & Metric sorting -->
        <div style="display:flex;flex-wrap:wrap;gap:12px;align-items:center;justify-content:space-between;margin:0 0 16px;padding:12px 16px;background:#f8f9fa;border:1px solid var(--line);border-radius:6px;">
          <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;">
            <span style="font:600 11px/1 var(--sans);color:var(--muted);text-transform:uppercase;letter-spacing:.05em;">Rank By:</span>
            <div style="display:inline-flex;border:1px solid var(--line);border-radius:4px;overflow:hidden;background:#fff;">
              <button type="button" class="filter active" id="btnSortInterested" onclick="setLeaderboardSort('interested')" style="border:none;border-radius:0;height:32px;font-size:12px;padding:0 12px;">⭐ Conversions (Wins)</button>
              <button type="button" class="filter" id="btnSortProcessed" onclick="setLeaderboardSort('processed')" style="border:none;border-left:1px solid var(--line);border-radius:0;height:32px;font-size:12px;padding:0 12px;">📞 Call Volume</button>
              <button type="button" class="filter" id="btnSortConversion" onclick="setLeaderboardSort('conversion')" style="border:none;border-left:1px solid var(--line);border-radius:0;height:32px;font-size:12px;padding:0 12px;">📈 Win Rate %</button>
              <button type="button" class="filter" id="btnSortContacted" onclick="setLeaderboardSort('contacted')" style="border:none;border-left:1px solid var(--line);border-radius:0;height:32px;font-size:12px;padding:0 12px;">💬 Contacted</button>
            </div>
          </div>
          <div id="leaderboardDateInfo" style="font:600 12px/1 var(--mono);color:var(--accent);">
            Showing Last 7 Days
          </div>
        </div>

        <!-- Top 3 Podium Highlights -->
        <div id="leaderboardPodiumContainer" class="act-podium"></div>

        <!-- Top 10 Ranked Leaderboard Table -->
        <div id="leaderboardTableContainer" style="background:#fff;border:1px solid var(--line);border-radius:6px;padding:20px;margin-bottom:24px;overflow-x:auto;">
          <div class="empty">Loading leaderboard…</div>
        </div>
      </div>

      <!-- Real-Time Activity Feed -->
      <div style="margin:36px 0 16px;">
        <div class="section-head">
          <div>
            <div class="eyebrow">Audit Stream</div>
            <h2 style="margin:4px 0 0;">Live Call & Activity Feed</h2>
          </div>
          <span class="section-note">Searchable audit trail of status updates, assignment events, and call feedback.</span>
        </div>
        <div style="display:flex;flex-wrap:wrap;gap:12px;align-items:center;justify-content:space-between;margin:0 0 16px;padding:14px 18px;background:#f8f9fa;border:1px solid var(--line);border-radius:6px;">
          <div style="display:flex;flex-wrap:wrap;gap:10px;align-items:center;flex:1;min-width:280px;">
            <input class="input" id="activitySearchInput" placeholder="Search company, phone, notes…" style="max-width:280px;height:38px;font-size:13.5px;" onkeydown="if(event.key==='Enter')loadActivityLog()">
            <select class="input select" id="activityLogStatusFilter" onchange="loadActivityLog()" style="max-width:180px;height:38px;font-size:13px;">
              <option value="all">All Outcomes</option>
              <option value="interested">⭐ Interested</option>
              <option value="contacted">📞 Contacted</option>
              <option value="assigned">⏳ Assigned</option>
              <option value="not_interested">❌ Not Interested</option>
              <option value="do_not_call">⛔ Do Not Call</option>
            </select>
            <button class="primary" type="button" onclick="loadActivityLog()" style="height:38px;padding:0 14px;">Filter</button>
          </div>
        </div>
        <div id="activityLogFeedWrapper" class="company-list">
          <div class="empty">Loading activities…</div>
        </div>
        <div id="activityLogPagination" style="display:flex;align-items:center;justify-content:space-between;padding:20px 0;border-top:1px solid var(--line);margin-top:16px;">
          <span id="actPageInfo" style="font:500 12px/1 var(--mono);color:var(--muted);">Showing 0 of 0 activities</span>
          <div style="display:flex;gap:8px;">
            <button id="btnPrevAct" class="filter" type="button" onclick="prevActPage()" disabled>&larr; Previous</button>
            <button id="btnNextAct" class="filter" type="button" onclick="nextActPage()" disabled>Next &rarr;</button>
          </div>
        </div>
      </div>

      <!-- Modal 1: Generate Mock Presentation Data -->
      <div id="mockDataModal" class="modal-backdrop hidden" onclick="if(event.target===this)closeMockDataModal()">
        <div class="modal-dialog" role="dialog" aria-labelledby="mockModalTitle" style="max-width:500px;">
          <div class="modal-head">
            <div>
              <span class="sheet-title" id="mockModalTitle" style="font-size:15px;">⚡ Generate Mock Presentation Data</span>
              <p style="margin:4px 0 0;font-size:12px;color:var(--muted);">Simulate realistic outreach for client presentations.</p>
            </div>
            <button type="button" class="back" onclick="closeMockDataModal()">✕</button>
          </div>
          <form onsubmit="submitMockData(event)">
            <div style="margin:16px 0;padding:12px 14px;background:#ecfdf5;border:1px solid #a7f3d0;border-radius:6px;font-size:12px;color:#065f46;line-height:1.45;">
              <strong>🛡️ Real Data Safety Guarantee:</strong>
              <div style="margin-top:4px;">All real company names, phone numbers, addresses, ratings, and research dossiers are <strong>100% safe and untouched</strong>. Only lead assignment, status transitions, and call notes will be simulated.</div>
            </div>
            <div class="field" style="margin-bottom:14px;">
              <label for="mockLeadCount" style="font-weight:600;font-size:12px;margin-bottom:6px;display:block;">Number of Leads to Process</label>
              <select class="input select" id="mockLeadCount" style="width:100%;height:38px;font-size:13.5px;">
                <option value="50">50 Leads (Quick Demo)</option>
                <option value="80" selected>80 Leads (Balanced Portfolio)</option>
                <option value="150">150 Leads (Deep Campaign)</option>
                <option value="300">300 Leads (High Volume Enterprise)</option>
              </select>
            </div>
            <div class="field" style="margin-bottom:14px;">
              <label for="mockDaysSpan" style="font-weight:600;font-size:12px;margin-bottom:6px;display:block;">Spread Over Historical Days</label>
              <select class="input select" id="mockDaysSpan" style="width:100%;height:38px;font-size:13.5px;">
                <option value="7" selected>Last 7 Days (Recommended)</option>
                <option value="14">Last 14 Days</option>
                <option value="3">Last 3 Days</option>
              </select>
            </div>
            <div style="margin-bottom:18px;">
              <label style="display:flex;align-items:center;gap:8px;font-size:12.5px;cursor:pointer;">
                <input type="checkbox" id="mockClearFirst" checked>
                <span>Reset previous mock progress before generating fresh run</span>
              </label>
            </div>
            <div style="display:flex;gap:10px;justify-content:flex-end;">
              <button class="filter" type="button" onclick="closeMockDataModal()" style="height:38px;padding:0 14px;">Cancel</button>
              <button class="primary" type="submit" id="btnSubmitMock" style="height:38px;padding:0 18px;background:#2759ff;">Generate Presentation Data</button>
            </div>
          </form>
        </div>
      </div>

      <!-- Modal 2: Reset / Clear Mock Progress -->
      <div id="resetProgressModal" class="modal-backdrop hidden" onclick="if(event.target===this)closeResetProgressModal()">
        <div class="modal-dialog" role="dialog" aria-labelledby="resetModalTitle" style="max-width:480px;">
          <div class="modal-head">
            <div>
              <span class="sheet-title" id="resetModalTitle" style="font-size:15px;color:var(--bad);">🧹 Reset / Clear Lead Progress</span>
              <p style="margin:4px 0 0;font-size:12px;color:var(--muted);">Post-presentation teardown & cleanup.</p>
            </div>
            <button type="button" class="back" onclick="closeResetProgressModal()">✕</button>
          </div>
          <div style="margin:16px 0;padding:14px;background:#fff5f5;border:1px solid #fecaca;border-radius:6px;font-size:12.5px;color:#991b1b;line-height:1.5;">
            <strong>⚠️ What will be reset:</strong>
            <ul style="margin:6px 0 0;padding-left:18px;">
              <li>Call statuses will reset to <code>unassigned</code>, except do-not-call leads, which stay blacklisted</li>
              <li>All telemarketer assignments will be removed</li>
              <li>Call notes and remarks are kept</li>
              <li>Activity entries without a remark will be wiped</li>
            </ul>
            <div style="margin-top:10px;font-weight:700;color:var(--ok);">
              ✓ Real company data, contacts, phones, and research dossiers remain 100% untouched.
            </div>
          </div>
          <div style="display:flex;gap:10px;justify-content:flex-end;">
            <button class="filter" type="button" onclick="closeResetProgressModal()" style="height:38px;padding:0 14px;">Cancel</button>
            <button class="primary" type="button" id="btnConfirmReset" onclick="submitResetProgress()" style="height:38px;padding:0 18px;background:var(--bad);border-color:var(--bad);">Confirm Reset (Clean Slate)</button>
          </div>
        </div>
      </div>

      <!-- Modal 3: Manual Activity / Call Log -->
      <div id="manualActivityModal" class="modal-backdrop hidden" onclick="if(event.target===this)closeManualActivityModal()">
        <div class="modal-dialog" role="dialog" aria-labelledby="manualModalTitle" style="max-width:480px;">
          <div class="modal-head">
            <div>
              <span class="sheet-title" id="manualModalTitle" style="font-size:15px;">➕ Log Lead Activity</span>
              <p style="margin:4px 0 0;font-size:12px;color:var(--muted);">Update lead status and record call outcome.</p>
            </div>
            <button type="button" class="back" onclick="closeManualActivityModal()">✕</button>
          </div>
          <form onsubmit="submitManualActivity(event)">
            <div class="field" style="margin-bottom:12px;">
              <label for="manualActCompanyId" style="font-weight:600;font-size:12px;margin-bottom:6px;display:block;">Select Company *</label>
              <select class="input select" id="manualActCompanyId" required style="width:100%;height:38px;font-size:13px;">
                <option value="">Choose company...</option>
              </select>
            </div>
            <div class="field" style="margin-bottom:12px;">
              <label for="manualActTele" style="font-weight:600;font-size:12px;margin-bottom:6px;display:block;">Telemarketer / Agent</label>
              <select class="input select" id="manualActTele" style="width:100%;height:38px;font-size:13px;">
                <option value="">Choose telemarketer...</option>
              </select>
            </div>
            <div class="field" style="margin-bottom:12px;">
              <label for="manualActStatus" style="font-weight:600;font-size:12px;margin-bottom:6px;display:block;">New Status / Outcome *</label>
              <select class="input select" id="manualActStatus" required style="width:100%;height:38px;font-size:13px;">
                <option value="contacted">📞 Contacted (Spoke with PIC / In Progress)</option>
                <option value="interested">⭐ Interested (Won / High Potential Lead)</option>
                <option value="not_interested">❌ Not Interested (Declined)</option>
                <option value="do_not_call">⛔ Do Not Call (DNC / Invalid line)</option>
                <option value="assigned">⏳ Assigned (Queue for calling)</option>
              </select>
            </div>
            <div class="field" style="margin-bottom:14px;">
              <label for="manualActNotes" style="font-weight:600;font-size:12px;margin-bottom:6px;display:block;">Call Notes & Remarks</label>
              <textarea class="input" id="manualActNotes" placeholder="Enter conversation details, requested WhatsApp proposal, objections, etc..." style="width:100%;height:75px;padding:8px 10px;font-size:13px;border:1px solid var(--line);border-radius:4px;resize:vertical;"></textarea>
            </div>
            <div style="display:flex;gap:10px;justify-content:flex-end;">
              <button class="filter" type="button" onclick="closeManualActivityModal()" style="height:38px;padding:0 14px;">Cancel</button>
              <button class="primary" type="submit" id="btnSubmitManualAct" style="height:38px;padding:0 18px;">Save Activity</button>
            </div>
          </form>
        </div>
      </div>
    </section>
    <section id="leadsView" class="view">
      <div class="library-hero">
        <div class="eyebrow">Master Company Directory & Lead Distribution</div>
        <h1>Leads master list.</h1>
        <p>Deduplicated master list of all discovered companies. Assign leads to telemarketers, track contact outcomes, and inspect deep research dossiers.</p>
      </div>
      <div id="leadsSummary" class="result-summary lead-summary-grid" style="margin-top:24px;">
        <div class="metric"><strong id="statTotal">0</strong><span>Total Companies</span></div>
        <div class="metric"><strong id="statUnassigned" style="color:var(--accent);">0</strong><span>Unassigned Leads</span></div>
        <div class="metric"><strong id="statAssigned">0</strong><span>Assigned</span></div>
        <div class="metric"><strong id="statContacted" style="color:var(--ok);">0</strong><span>Contacted / Won</span></div>
        <div class="metric" onclick="setLeadResearchFilter('contacts_found')" style="cursor:pointer;" title="Leads with a phone from Google Maps, or a phone or email found by contact research"><strong id="statContacts" style="color:var(--ok);">0</strong><span>Contacts Found →</span></div>
        <div class="metric" onclick="switchView('contacts')" style="cursor:pointer;" title="Leads whose deep contact research finished; opens the Contacts Master list"><strong id="statDeepResearched">0</strong><span>Deep Contact Research Run →</span></div>
        <div class="metric" onclick="setLeadStatusFilter('hidden')" style="cursor:pointer;" title="View hidden companies"><strong id="statHidden" style="color:var(--muted);">0</strong><span>Hidden Leads</span></div>
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:12px;align-items:center;justify-content:space-between;margin:24px 0 16px;">
        <div style="display:flex;flex-wrap:wrap;gap:10px;align-items:center;flex:1;min-width:280px;">
          <input class="input" id="leadSearch" placeholder="Search company, phone, location, category…" style="max-width:320px;height:40px;font-size:14px;" onkeydown="if(event.key==='Enter')applyLeadFilter()">
          <button class="primary" type="button" onclick="applyLeadFilter()" style="height:40px;padding:0 16px;">Search</button>
          <select class="input select" id="leadTeleFilter" onchange="applyLeadFilter()" style="max-width:180px;height:40px;font-size:13px;">
            <option value="all">All Telemarketers</option>
            <option value="unassigned">Unassigned Only</option>
          </select>
          <select class="input select" id="leadResearchFilter" onchange="applyLeadFilter()" style="max-width:190px;height:40px;font-size:13px;">
            <option value="all">All Research</option>
            <option value="contacts_found">📞 Contacts Found (Maps or research)</option>
            <option value="deep_researched">Deep Contact Research Run</option>
            <option value="no_contacts">No Deep Contact Research</option>
            <option value="researched">Dossier Ready</option>
            <option value="unresearched">No Dossier</option>
          </select>
        </div>
        <div style="display:flex;gap:8px;align-items:center;">
          <button class="filter" type="button" onclick="switchView('contacts')">Contacts Master →</button>
          <button class="filter" type="button" onclick="switchView('agents')">Manage Agents →</button>
          <button class="filter" type="button" onclick="runDedupAction()" title="Merge duplicate branches and duplicate phone contacts">Run Dedup</button>
          <button class="filter" type="button" onclick="exportLeadsCsv()">Export CSV</button>
          <button class="filter" type="button" id="btnQueueContacts" onclick="queueContactAll(this)" style="color:var(--ok);border-color:var(--ok);background:#ecfdf5;" title="Queue contact research for every company on this page that has none yet">Contacts ⚡ Queue all</button>
        </div>
      </div>
      <div id="keywordRule" class="search-sheet" style="margin:0 0 16px;padding:14px 20px;box-shadow:none;display:flex;align-items:center;flex-wrap:wrap;gap:10px;">
        <strong style="font-size:13px;color:var(--ink);">Keyword rule</strong>
        <span style="font-size:12px;color:var(--muted);">Company name contains</span>
        <input class="input" id="keywordRuleInput" placeholder="e.g. Bank" maxlength="60" oninput="keywordRuleChanged()" style="max-width:200px;height:38px;font-size:13px;">
        <span style="font-size:12px;color:var(--muted);">set status to</span>
        <select class="input select" id="keywordRuleStatus" onchange="keywordRuleChanged()" style="height:38px;font-size:13px;min-width:200px;background-color:#fff;">
          <option value="do_not_call" selected>Blacklist (do not call)</option>
          <option value="unassigned">Unassigned</option>
          <option value="assigned">Assigned</option>
          <option value="contacted">Contacted</option>
          <option value="interested">Interested</option>
          <option value="not_interested">Not interested</option>
        </select>
        <button class="filter" type="button" onclick="previewKeywordRule()" style="height:38px;">Preview matches</button>
        <button class="primary" type="button" id="btnApplyKeywordRule" onclick="applyKeywordRule()" style="height:38px;" disabled>Apply to matches</button>
        <div id="keywordRuleResult" style="flex-basis:100%;font-size:12px;color:var(--muted);"></div>
      </div>
      <div class="filters" role="group" aria-label="Lead status" style="margin:16px 0 20px;">
        <button class="filter active" data-lead-status="all" onclick="setLeadStatusFilter('all')">All (<span id="countAll">0</span>)</button>
        <button class="filter" data-lead-status="unassigned" onclick="setLeadStatusFilter('unassigned')">Unassigned (<span id="countUnassigned">0</span>)</button>
        <button class="filter" data-lead-status="assigned" onclick="setLeadStatusFilter('assigned')">Assigned (<span id="countAssigned">0</span>)</button>
        <button class="filter" data-lead-status="contacted" onclick="setLeadStatusFilter('contacted')">Contacted (<span id="countContacted">0</span>)</button>
        <button class="filter" data-lead-status="interested" onclick="setLeadStatusFilter('interested')">Interested (<span id="countInterested">0</span>)</button>
        <button class="filter" data-lead-status="not_interested" onclick="setLeadStatusFilter('not_interested')">Not Interested (<span id="countNotInterested">0</span>)</button>
        <button class="filter" data-lead-status="do_not_call" onclick="setLeadStatusFilter('do_not_call')">DNC (<span id="countDnc">0</span>)</button>
        <button class="filter" data-lead-status="hidden" onclick="setLeadStatusFilter('hidden')">🚫 Hidden (<span id="countHidden">0</span>)</button>
      </div>
      <div id="bulkBar" class="search-sheet hidden" style="margin:0 0 20px;padding:16px 20px;box-shadow:none;border-color:var(--accent);background:#f0f4ff;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;">
        <div style="display:flex;align-items:center;gap:14px;">
          <strong style="font-size:13px;color:var(--ink);"><span id="bulkCount">0</span> selected</strong>
          <label style="display:flex;align-items:center;gap:6px;font-size:12px;cursor:pointer;user-select:none;">
            <input type="checkbox" id="selectAllPage" onchange="toggleSelectAllPage(this.checked)"> Select all on this page
          </label>
        </div>
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
          <select class="input select" id="bulkAssignSelect" style="height:38px;font-size:13px;background-color:#fff;min-width:180px;">
            <option value="">Choose telemarketer...</option>
          </select>
          <button class="primary" type="button" onclick="bulkAssignSelected()" style="height:38px;padding:0 16px;">Assign Selected</button>
          <button class="filter" type="button" onclick="bulkUnassignSelected()" style="height:38px;">Unassign</button>
          <button class="filter" id="btnBulkHide" type="button" onclick="bulkHideSelected(true)" style="height:38px;color:var(--muted);" title="Hide selected companies from master list">🚫 Hide Selected</button>
          <button class="filter" id="btnBulkUnhide" type="button" onclick="bulkHideSelected(false)" style="height:38px;color:var(--ok);border-color:var(--ok);background:#ecfdf5;" title="Unhide and restore selected companies">👁️ Unhide Selected</button>
        </div>
      </div>
      <div id="leadTableWrapper" class="company-list">
        <div class="empty">Loading company master list…</div>
      </div>
      <div id="leadPagination" style="display:flex;align-items:center;justify-content:space-between;padding:24px 0 32px;border-top:1px solid var(--line);margin-top:20px;">
        <span id="pageInfo" style="font:500 12px/1 var(--mono);color:var(--muted);">Showing 0 of 0</span>
        <div style="display:flex;gap:8px;">
          <button id="btnPrevLeads" class="filter" type="button" onclick="prevLeadsPage()" disabled>&larr; Previous</button>
          <button id="btnNextLeads" class="filter" type="button" onclick="nextLeadsPage()" disabled>Next &rarr;</button>
        </div>
      </div>
    </section>
    <section id="adsLeadsView" class="view">
      <div class="library-hero">
        <div class="eyebrow">Paid acquisition &amp; customer signups</div>
        <h1>Ads &amp; Landing Page Leads.</h1>
        <p>Direct consumer and business solar inquiries submitted via Google Ads, Facebook Ads campaigns, and landing page calculator forms (<code>atap_solar_registrations</code>). Kept strictly isolated from Google Maps scout data.</p>
        <div class="library-tools" style="display:flex;gap:10px;align-items:center;">
          <button class="primary" type="button" onclick="loadAdsLeads()" style="height:38px;padding:0 16px;">Refresh ↻</button>
          <button class="filter" type="button" onclick="exportAdsLeadsCsv()" style="height:38px;padding:0 16px;">Export CSV ↗</button>
        </div>
      </div>

      <div id="adsLeadSummary" class="result-summary lead-summary-grid" style="margin-top:24px;">
        <div class="metric"><strong id="statAdsTotal">0</strong><span>Total Ads Leads</span></div>
        <div class="metric"><strong id="statAdsUnassigned" style="color:var(--warn);">0</strong><span>Unassigned</span></div>
        <div class="metric"><strong id="statAdsAssigned" style="color:var(--accent);">0</strong><span>Assigned</span></div>
        <div class="metric"><strong id="statAdsContacted" style="color:var(--ok);">0</strong><span>Contacted</span></div>
        <div class="metric"><strong id="statAdsInterested" style="color:var(--ok);">0</strong><span>Interested ⭐</span></div>
        <div class="metric"><strong id="statAdsLost" style="color:var(--bad);">0</strong><span>Lost / DNC</span></div>
      </div>

      <div class="live-monitor-banner" id="adsLiveBanner">
        <div style="display:flex;align-items:center;gap:10px;">
          <span class="pulse done" style="width:9px;height:9px;"></span>
          <strong>Live Ingestion Stream Active</strong>
          <span style="color:var(--muted);font-size:12px;">Auto-checking for incoming Google Ads &amp; form registrations every 15s</span>
        </div>
        <div style="display:flex;align-items:center;gap:12px;">
          <span id="adsNewCounter" style="font:700 11px/1 var(--mono);background:#d1fae5;color:#065f46;padding:3px 8px;border-radius:4px;">Live Stream Active</span>
          <button class="filter" id="btnToggleAutoRefresh" type="button" onclick="toggleAdsAutoRefresh()" style="height:28px;padding:0 10px;font-size:9.5px;background:#fff;">⏸ Pause</button>
        </div>
      </div>
      <div id="adsNewAlert" class="new-lead-alert hidden">
        <span id="adsNewAlertText">🔔 New registration received!</span>
        <button class="filter" type="button" onclick="dismissAdsAlert()" style="height:26px;padding:0 8px;font-size:9px;">Dismiss ✕</button>
      </div>

      <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:24px 0 16px;">
        <button class="filter active" data-ads-status="all" onclick="setAdsLeadStatusFilter('all')">All (<span id="countAdsAll">0</span>)</button>
        <button class="filter" data-ads-status="unassigned" onclick="setAdsLeadStatusFilter('unassigned')">Unassigned (<span id="countAdsUnassigned">0</span>)</button>
        <button class="filter" data-ads-status="assigned" onclick="setAdsLeadStatusFilter('assigned')">Assigned (<span id="countAdsAssigned">0</span>)</button>
        <button class="filter" data-ads-status="contacted" onclick="setAdsLeadStatusFilter('contacted')">Contacted (<span id="countAdsContacted">0</span>)</button>
        <button class="filter" data-ads-status="interested" onclick="setAdsLeadStatusFilter('interested')">Interested (<span id="countAdsInterested">0</span>)</button>
        <button class="filter" data-ads-status="not_interested" onclick="setAdsLeadStatusFilter('not_interested')">Not Interested (<span id="countAdsNotInterested">0</span>)</button>
        <button class="filter" data-ads-status="do_not_call" onclick="setAdsLeadStatusFilter('do_not_call')">DNC (<span id="countAdsDnc">0</span>)</button>
        <button class="filter" data-ads-status="hidden" onclick="setAdsLeadStatusFilter('hidden')">Hidden (<span id="countAdsHidden">0</span>)</button>
      </div>

      <div style="display:flex;flex-wrap:wrap;gap:12px;align-items:center;justify-content:space-between;margin:0 0 16px;">
        <div style="display:flex;flex-wrap:wrap;gap:10px;align-items:center;flex:1;min-width:280px;">
          <input class="input" id="adsLeadSearch" placeholder="Search name, phone, email, lead ID, area, TNB..." style="max-width:320px;height:40px;font-size:14px;" onkeydown="if(event.key==='Enter')applyAdsLeadFilter()">
          <select class="input select" id="adsLeadTeleFilter" onchange="applyAdsLeadFilter()" style="max-width:200px;height:40px;font-size:13px;">
            <option value="all">All Telemarketers</option>
            <option value="unassigned">Unassigned Only</option>
          </select>
          <select class="input select" id="adsLeadStateFilter" onchange="applyAdsLeadFilter()" style="max-width:160px;height:40px;font-size:13px;">
            <option value="all">All States</option>
            <option value="Kuala Lumpur">Kuala Lumpur</option>
            <option value="Selangor">Selangor</option>
            <option value="Johor">Johor</option>
            <option value="Pulau Pinang">Pulau Pinang</option>
            <option value="Perak">Perak</option>
            <option value="Melaka">Melaka</option>
            <option value="Negeri Sembilan">Negeri Sembilan</option>
            <option value="Kedah">Kedah</option>
            <option value="Pahang">Pahang</option>
          </select>
          <select class="input select" id="adsLeadSourceFilter" onchange="applyAdsLeadFilter()" style="max-width:160px;height:40px;font-size:13px;">
            <option value="all">All Sources</option>
            <option value="google_ads">Google Ads</option>
            <option value="facebook_ads">Facebook Ads</option>
            <option value="direct">Direct</option>
          </select>
          <button class="primary" type="button" onclick="applyAdsLeadFilter()" style="height:40px;padding:0 16px;">Filter</button>
        </div>
      </div>

      <div id="bulkAdsBar" class="bulk-bar hidden" style="margin-bottom:16px;">
        <div style="display:flex;align-items:center;gap:12px;">
          <label style="display:flex;align-items:center;gap:6px;font-size:13px;font-weight:600;cursor:pointer;">
            <input type="checkbox" id="selectAllAdsPage" onchange="toggleSelectAllAdsPage(this.checked)">
            <span><span id="bulkAdsCount">0</span> selected</span>
          </label>
        </div>
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
          <select class="input select" id="bulkAdsAssignSelect" style="height:38px;font-size:13px;background-color:#fff;min-width:180px;">
            <option value="">Choose telemarketer...</option>
          </select>
          <button class="primary" type="button" onclick="bulkAssignAdsSelected()" style="height:38px;padding:0 16px;">Assign Selected</button>
          <button class="filter" type="button" onclick="bulkUnassignAdsSelected()" style="height:38px;">Unassign</button>
          <button class="filter" id="btnBulkAdsHide" type="button" onclick="bulkHideAdsSelected(true)" style="height:38px;color:var(--muted);" title="Hide selected leads">🚫 Hide Selected</button>
          <button class="filter" id="btnBulkAdsUnhide" type="button" onclick="bulkHideAdsSelected(false)" style="height:38px;color:var(--ok);border-color:var(--ok);background:#ecfdf5;" title="Unhide selected leads">👁️ Unhide Selected</button>
        </div>
      </div>

      <div id="adsLeadTableWrapper" class="company-list">
        <div class="empty">Loading ads leads…</div>
      </div>

      <div id="adsLeadPagination" style="display:flex;align-items:center;justify-content:space-between;padding:24px 0 32px;border-top:1px solid var(--line);margin-top:20px;">
        <span id="adsPageInfo" style="font:500 12px/1 var(--mono);color:var(--muted);">Showing 0 of 0</span>
        <div style="display:flex;gap:8px;">
          <button id="btnPrevAdsLeads" class="filter" type="button" onclick="prevAdsLeadsPage()" disabled>&larr; Previous</button>
          <button id="btnNextAdsLeads" class="filter" type="button" onclick="nextAdsLeadsPage()" disabled>Next &rarr;</button>
        </div>
      </div>
    </section>

    <!-- Modal: Ads Lead Raw Data / Tracking Inspector -->
    <div id="adsRawModal" class="modal-backdrop hidden" onclick="if(event.target===this)closeAdsRawModal()">
      <div class="modal-dialog" role="dialog" aria-labelledby="adsRawModalTitle" style="max-width:680px;">
        <div class="modal-head">
          <div>
            <span class="sheet-title" id="adsRawModalTitle">Raw Tracking &amp; Submission Data</span>
            <p id="adsRawModalSub" style="margin:4px 0 0;font-size:12px;color:var(--muted);"></p>
          </div>
          <button type="button" class="back" onclick="closeAdsRawModal()">✕</button>
        </div>
        <div style="margin:16px 0 12px;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
            <span style="font:700 11px/1 var(--mono);color:var(--muted);text-transform:uppercase;">JSON Payload</span>
            <button class="filter" type="button" onclick="copyText(el('adsRawContent').textContent, 'Raw Lead JSON')" style="height:28px;padding:0 8px;font-size:9.5px;">Copy JSON</button>
          </div>
          <pre id="adsRawContent" style="background:#1e1e1e;color:#d4d4d4;padding:16px;border-radius:6px;font:12px/1.5 var(--mono);max-height:420px;overflow:auto;white-space:pre-wrap;word-break:break-all;"></pre>
        </div>
        <div style="display:flex;justify-content:flex-end;">
          <button class="primary" type="button" onclick="closeAdsRawModal()">Close</button>
        </div>
      </div>
    </div>
    <section id="contactsView" class="view">
      <div class="library-hero">
        <div class="eyebrow">People, grouped by company</div>
        <h1>Contacts master list.</h1>
        <p>Every named person we have found, listed under their company — name, position, contact details, and the source of that information.</p>
      </div>
      <div id="contactsSummary" class="result-summary lead-summary-grid" style="margin-top:24px;">
        <div class="metric"><strong id="statContactsTotalCompanies">0</strong><span>Companies with People</span></div>
        <div class="metric"><strong id="statContactsTotalDMs" style="color:var(--accent);">0</strong><span>People</span></div>
        <div class="metric"><strong id="statContactsTotalPhones" style="color:var(--ok);">0</strong><span>Total Phones</span></div>
        <div class="metric"><strong id="statContactsTotalMobile" style="color:var(--ok);">0</strong><span>WhatsApp / Mobile</span></div>
        <div class="metric"><strong id="statContactsTotalEmails">0</strong><span>Direct Emails</span></div>
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:12px;align-items:center;justify-content:space-between;margin:24px 0 16px;">
        <div style="display:flex;flex-wrap:wrap;gap:10px;align-items:center;flex:1;min-width:280px;">
          <input class="input" id="contactsSearch" placeholder="Search person name, title, company, phone, email..." style="max-width:320px;height:40px;font-size:14px;" onkeydown="if(event.key==='Enter')applyContactsFilter()">
          <button class="primary" type="button" onclick="applyContactsFilter()" style="height:40px;padding:0 16px;">Search</button>
          <select class="input select" id="contactsTypeFilter" onchange="applyContactsFilter()" style="max-width:200px;height:40px;font-size:13px;">
            <option value="all" selected>All contacts</option>
            <option value="has_decision_makers">Named people only</option>
            <option value="has_mobile">💬 Has WhatsApp / Mobile</option>
            <option value="has_email">✉️ Has Direct Email</option>
            <option value="researched_only">⚡ Researched Only</option>
          </select>
          <select class="input select" id="contactsTeleFilter" onchange="applyContactsFilter()" style="max-width:180px;height:40px;font-size:13px;">
            <option value="all">All Telemarketers</option>
          </select>
        </div>
        <div style="display:flex;gap:8px;align-items:center;">
          <button class="filter" type="button" onclick="loadContactsView()">Refresh</button>
          <button class="filter" type="button" onclick="exportContactsCsv()">Export Contacts CSV</button>
        </div>
      </div>
      <div id="contactsContainer" class="company-list">
        <div class="empty">Loading contacts master list…</div>
      </div>
      <div id="contactsPagination" style="display:flex;align-items:center;justify-content:space-between;padding:24px 0 32px;border-top:1px solid var(--line);margin-top:20px;">
        <span id="contactsPageInfo" style="font:500 12px/1 var(--mono);color:var(--muted);">Showing 0 of 0 companies</span>
        <div style="display:flex;gap:8px;">
          <button id="btnPrevContacts" class="filter" type="button" onclick="prevContactsPage()" disabled>&larr; Previous</button>
          <button id="btnNextContacts" class="filter" type="button" onclick="nextContactsPage()" disabled>Next &rarr;</button>
        </div>
      </div>
    </section>
    <section id="emailView" class="view">
      <div class="library-hero">
        <div class="eyebrow">Email marketing</div>
        <h1>Email list.</h1>
        <p>Every email we hold, one row per company and email: from contact research and from the company's own website.</p>
      </div>
      <div class="result-summary lead-summary-grid" style="margin-top:24px;">
        <div class="metric"><strong id="statEmailDistinct">0</strong><span>Different emails</span></div>
        <div class="metric"><strong id="statEmailCompanies">0</strong><span>Companies</span></div>
        <div class="metric"><strong id="statEmailPerson" style="color:var(--accent);">0</strong><span>With person name</span></div>
        <div class="metric"><strong id="statEmailResearch">0</strong><span>From research</span></div>
        <div class="metric"><strong id="statEmailWebsite">0</strong><span>From website</span></div>
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:12px;align-items:center;justify-content:space-between;margin:24px 0 16px;">
        <div style="display:flex;flex-wrap:wrap;gap:10px;align-items:center;flex:1;min-width:280px;">
          <input class="input" id="emailSearch" placeholder="Search email, company, person..." style="max-width:320px;height:40px;font-size:14px;" onkeydown="if(event.key==='Enter')applyEmailFilter()">
          <button class="primary" type="button" onclick="applyEmailFilter()" style="height:40px;padding:0 16px;">Search</button>
          <select class="input select" id="emailSourceFilter" onchange="applyEmailFilter()" style="max-width:200px;height:40px;font-size:13px;">
            <option value="all" selected>All emails</option>
            <option value="person">With person name</option>
            <option value="research">From research</option>
            <option value="website">From website</option>
          </select>
        </div>
        <div style="display:flex;gap:8px;align-items:center;">
          <button class="filter" type="button" onclick="loadEmailList(true)">Refresh</button>
          <button class="filter" type="button" onclick="exportEmailCsv()">Export CSV</button>
        </div>
      </div>
      <div id="emailContainer" style="overflow-x:auto;"><div class="empty">Loading email list…</div></div>
      <div style="display:flex;align-items:center;justify-content:space-between;padding:24px 0 32px;border-top:1px solid var(--line);margin-top:20px;">
        <span id="emailPageInfo" style="font:500 12px/1 var(--mono);color:var(--muted);">Showing 0 of 0 emails</span>
        <div style="display:flex;gap:8px;">
          <button id="btnPrevEmail" class="filter" type="button" onclick="emailPage(-1)" disabled>&larr; Previous</button>
          <button id="btnNextEmail" class="filter" type="button" onclick="emailPage(1)" disabled>Next &rarr;</button>
        </div>
      </div>
    </section>
    <section id="agentsView" class="view">
      <div class="library-hero">
        <div class="eyebrow">Telemarketer Team & Lead Allocation</div>
        <h1>Manage Telemarketers.</h1>
        <p>Register telemarketer agents, track active assignments, monitor calling conversion rates, and manage individual queues.</p>
      </div>
      <div class="result-summary" style="margin-top:24px;">
        <div class="metric"><strong id="agentsTotalCount">0</strong><span>Total Agents</span></div>
        <div class="metric"><strong id="agentsActiveCount" style="color:var(--ok);">0</strong><span>Active Agents</span></div>
        <div class="metric"><strong id="agentsTotalLeadsCount">0</strong><span>Leads Assigned</span></div>
        <div class="metric"><strong id="agentsContactedCount" style="color:var(--warn);">0</strong><span>Contacted Leads</span></div>
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:12px;align-items:center;justify-content:space-between;margin:24px 0 20px;padding:16px 20px;background:#f8f9fa;border:1px solid var(--line);border-radius:6px;">
        <div style="display:flex;flex-wrap:wrap;gap:10px;align-items:center;flex:1;min-width:280px;">
          <input class="input" id="agentFilterInput" oninput="filterAgents()" placeholder="Search agents by name, phone, or notes..." style="height:38px;font-size:13.5px;max-width:320px;">
          <select class="input select" id="agentStatusFilter" onchange="filterAgents()" style="height:38px;font-size:13px;width:130px;">
            <option value="all" selected>All Status</option>
            <option value="active">Active Only</option>
            <option value="inactive">Inactive Only</option>
          </select>
          <select class="input select" id="agentRoleFilter" onchange="filterAgents()" style="height:38px;font-size:13px;width:190px;" title="Filter by access tag imported from atap.solar">
            <option value="all" selected>All Access Tags</option>
          </select>
        </div>
        <div style="display:flex;gap:8px;">
          <button class="primary" type="button" onclick="toggleCreateAgentForm(true)" style="height:38px;padding:0 14px;">+ New Telemarketer</button>
          <button class="filter" type="button" id="importAgentsBtn" onclick="importAgentsFromAtap(this)" style="height:38px;padding:0 14px;" title="Pull sales agents from calculator.atap.solar into the roster">⤓ Import from atap.solar</button>
          <button class="filter" type="button" onclick="loadAgentsView()" style="height:38px;padding:0 14px;">Refresh</button>
        </div>
      </div>

      <form id="agentFormSheet" class="search-sheet hidden" onsubmit="saveAgentForm(event)" style="margin:0 0 24px;border-radius:6px;">
        <div class="sheet-head" style="margin-bottom:16px;">
          <span class="sheet-title" id="agentFormTitle">Create New Telemarketer</span>
          <button type="button" class="back" onclick="toggleCreateAgentForm(false)">Cancel ✕</button>
        </div>
        <input type="hidden" id="agentFormId" value="">
        <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(220px, 1fr));gap:16px;">
          <div class="field">
            <label for="agentFormName">Agent Name *</label>
            <input class="input" id="agentFormName" placeholder="e.g. Sarah Tan, John Lee" required>
          </div>
          <div class="field">
            <label for="agentFormPhone">Phone / WhatsApp</label>
            <input class="input" id="agentFormPhone" placeholder="e.g. +6012-3456789">
          </div>
          <div class="field">
            <label for="agentFormEmail">Email Address</label>
            <input class="input" id="agentFormEmail" type="email" placeholder="e.g. sarah@company.com">
          </div>
          <div class="field">
            <label for="agentFormStatus">Account Status</label>
            <select class="input select" id="agentFormStatus">
              <option value="true" selected>Active (Can Receive Leads)</option>
              <option value="false">Inactive</option>
            </select>
          </div>
        </div>
        <div class="field" style="margin-top:16px;">
          <label for="agentFormNotes">Focus Notes / Territory Specialization</label>
          <input class="input" id="agentFormNotes" placeholder="e.g. Specializes in Johor Bahru cafes & F&B leads">
        </div>
        <div style="display:flex;gap:10px;margin-top:20px;align-items:center;">
          <button class="primary" type="submit" id="agentFormSubmitBtn">Save Telemarketer</button>
          <button class="filter" type="button" onclick="toggleCreateAgentForm(false)">Cancel</button>
        </div>
      </form>

      <div id="agentsContainer" class="agent-grid">
        <div class="empty">Loading telemarketers roster…</div>
      </div>
    </section>
    <section id="libraryView" class="view"><div class="library-hero"><div class="eyebrow">Persistent knowledge base</div><h1>Research library.</h1><p>Browse every market scan, company dossier and VIP brief in one place. Completed public reports keep the same permanent link.</p><div class="library-tools"><button id="retryFailedButton" class="primary" type="button" onclick="retryFailedReports(this)">Re-run all failed reports</button><span id="retryFailedNote" class="retry-note" role="status" aria-live="polite"></span></div></div><div class="filters" role="group" aria-label="Report type"><button class="filter active" data-filter="all" onclick="setFilter('all')">All reports</button><button class="filter" data-filter="company_research" onclick="setFilter('company_research')">Company research</button><button class="filter" data-filter="contact_research" onclick="setFilter('contact_research')">Contacts</button><button class="filter" data-filter="person_research" onclick="setFilter('person_research')">VIP briefs</button><button class="filter" data-filter="ads_research" onclick="setFilter('ads_research')">Ads</button><button class="filter" data-filter="ads_market" onclick="setFilter('ads_market')">Ads market</button><button class="filter" data-filter="business_search" onclick="setFilter('business_search')">Business lists</button></div><div id="reportList" class="report-list"><div class="empty">Loading research library…</div></div></section>
  </main>
  <nav class="mobile-nav" aria-label="Workspace"><button class="mobile-tab active" data-view="discover" onclick="switchView('discover')"><span></span>Home</button><button class="mobile-tab" data-view="telemarketing" onclick="switchView('telemarketing')"><span></span>Map</button><button class="mobile-tab" data-view="assignment" onclick="switchView('assignment')"><span></span>Assign</button><button class="mobile-tab" data-view="activity" onclick="switchView('activity')"><span></span>Activity</button><button class="mobile-tab" data-view="leads" onclick="switchView('leads')"><span></span>Leads</button><button class="mobile-tab" data-view="adsLeads" onclick="switchView('adsLeads')"><span></span>Ads</button><button class="mobile-tab" data-view="contacts" onclick="switchView('contacts')"><span></span>Contacts</button><button class="mobile-tab" data-view="email" onclick="switchView('email')"><span></span>Email</button><button class="mobile-tab" data-view="agents" onclick="switchView('agents')"><span></span>Agents</button><button class="mobile-tab" data-view="library" onclick="switchView('library')"><span></span>Reports</button><a class="mobile-tab" href="/guide" target="_blank" rel="noopener"><span></span>Guide</a></nav>
</div><div id="toast" class="toast" role="status"></div>
<script>
'use strict';
${TOKEN_STORE_JS}
var state={token:'',jobs:{},reports:[],filter:'all',mode:'market',toastTimer:null};
var terminal=['completed','partial','failed'];
function el(id){return document.getElementById(id)}
function esc(value){return String(value==null?'':value).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
function attr(value){return esc(value)}
function safeId(value){return /^[A-Za-z0-9_-]{20}$/.test(String(value==null?'':value))?String(value):''}
function safeUrl(value){try{var u=new URL(String(value));return u.protocol==='https:'||u.protocol==='http:'?u.href:''}catch(e){return ''}}
function date(value){try{return new Intl.DateTimeFormat('en',{day:'2-digit',month:'short',year:'numeric'}).format(new Date(value))}catch(e){return 'Undated'}}
function showToast(message){var node=el('toast');node.textContent=message;node.classList.add('show');clearTimeout(state.toastTimer);state.toastTimer=setTimeout(function(){node.classList.remove('show')},3600)}
function copyText(text,label){if(!text)return;if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(text).then(function(){showToast('Copied: '+(label||text))}).catch(function(){fallbackCopy(text,label)})}else{fallbackCopy(text,label)}}
function fallbackCopy(text,label){var ta=document.createElement('textarea');ta.value=text;ta.style.position='fixed';ta.style.opacity='0';document.body.appendChild(ta);ta.select();try{document.execCommand('copy');showToast('Copied: '+(label||text))}catch(e){showToast('Failed to copy')}finally{document.body.removeChild(ta)}}
async function api(path,options){options=options||{};var headers=Object.assign({'Authorization':'Bearer '+state.token},options.headers||{});if(options.body)headers['Content-Type']='application/json';var response=await fetch(path,Object.assign({},options,{headers:headers}));var text=await response.text();var body={};try{body=text?JSON.parse(text):{}}catch(e){body={error:text||'Invalid server response'}}if(!response.ok){var message=typeof body.error==='string'?body.error:(body.error&&body.error.message)||('Request failed: '+response.status);var error=new Error(message);error.status=response.status;throw error}return body}
async function connect(event){if(event)event.preventDefault();var key=el('accessKey').value.trim();if(!key)return;state.token=key;el('connectButton').disabled=true;el('gateError').textContent='';try{await api('/api/reports?limit=1');eeKey.save(key);el('accessGate').classList.add('hidden');el('portalApp').removeAttribute('inert');el('portalApp').setAttribute('aria-hidden','false');await loadLibrary();if(document.body.getAttribute('data-portal')==='registrations')switchView('adsLeads');else if(document.body.getAttribute('data-portal')==='telemarketing')switchView('telemarketing');showToast('Workspace connected')}catch(error){state.token='';el('gateError').textContent=error.status===401?'Access key not accepted.':error.message}finally{el('connectButton').disabled=false}}
function disconnect(){eeKey.clear();state.token='';location.reload()}
function authLost(error){if(error&&error.status===401){eeKey.clear();state.token='';el('accessGate').classList.remove('hidden');el('gateError').textContent='Your access expired. Enter the workspace key again.';return true}return false}
function switchView(name){if(name!=='adsLeads'&&typeof adsLeadState!=='undefined'&&adsLeadState.autoRefreshTimer){clearInterval(adsLeadState.autoRefreshTimer);adsLeadState.autoRefreshTimer=null}document.querySelectorAll('.view').forEach(function(node){node.classList.toggle('active',node.id===name+'View')});document.querySelectorAll('[data-view]').forEach(function(node){node.classList.toggle('active',node.getAttribute('data-view')===name)});if(name==='library')loadLibrary();else if(name==='activity')loadActivityView();else if(name==='assignment')loadAssignmentView();else if(name==='leads')loadLeadsView();else if(name==='adsLeads')loadAdsLeadsView();else if(name==='contacts')loadContactsView();else if(name==='email')loadEmailView();else if(name==='telemarketing')loadTelemarketingView();else if(name==='agents')loadAgentsView();else goHome();window.scrollTo({top:0,behavior:'smooth'})}
function upsertJob(report,kind){state.jobs[report.id]=Object.assign({},state.jobs[report.id]||{},{report:report,kind:kind});renderJobs()}
function renderJobs(){var values=Object.keys(state.jobs).map(function(key){return state.jobs[key]});el('activeSection').classList.toggle('hidden',values.length===0);el('jobs').innerHTML=values.map(function(job){var r=job.report;var done=terminal.indexOf(r.status)>=0;var pulse=r.status==='failed'?'bad':done?'done':'';var label=job.kind==='search'?'Market scan':job.kind==='lookup'?'Company lookup':job.kind==='vip'?'VIP brief':job.kind==='ads'?'Ads':job.kind==='contact'?'Contact research':'Company research';var open=safeUrl(r.view_url);return '<article class="job"><div class="job-type">'+label+'</div><div><div class="job-title">'+esc(r.title)+'</div><div class="job-meta">'+esc(r.status)+' · '+esc(r.id)+'</div></div><div class="job-action"><span class="pulse '+pulse+'"></span>'+(open?'<a class="text-action" target="_blank" rel="noopener" href="'+attr(open)+'">View <span>↗</span></a>':'')+'</div></article>'}).join('')}
function poll(report,kind){upsertJob(report,kind);if(terminal.indexOf(report.status)>=0)return;setTimeout(async function(){try{var body=await api(report.api_url);upsertJob(body.report,kind);if(terminal.indexOf(body.report.status)<0){poll(body.report,kind);return}await loadLibrary();if((kind==='search'||kind==='lookup')&&body.report.status!=='failed'){renderSearch(body,kind)}if(kind==='deep'){showToast(body.report.status==='failed'?'Company research failed':'Company dossier is ready')}if(kind==='vip'){showToast(body.report.status==='failed'?'VIP brief failed':'VIP brief is ready')}if(kind==='adsmarket'){showToast(body.report.status==='failed'?'Ads market research failed':'Ads market report is ready')}if(kind==='contact'){showToast(body.report.status==='failed'?'Contact research failed':'Contact details are ready')}if(body.report.status==='failed')showToast(body.report.error||'Research failed')}catch(error){if(!authLost(error)){showToast(error.message);if(error.status===404){forgetReport(report.id)}else{poll(report,kind)}}}},5000)}
var HOME={eyebrow:'Live market discovery',title:'Find the companies worth knowing.',copy:'Pick one. Nothing is researched until you say so.'};
function choose(choice){if(choice==='reports')return switchView('library');el('chooser').classList.add('hidden');el('searchForm').classList.remove('hidden');el('discoverEmpty').classList.add('hidden');setMode(choice)}
function goHome(){el('searchForm').classList.add('hidden');el('chooser').classList.remove('hidden');el('heroEyebrow').textContent=HOME.eyebrow;el('heroTitle').textContent=HOME.title;el('heroCopy').textContent=HOME.copy;window.scrollTo({top:0,behavior:'smooth'})}
var MODES={market:{eyebrow:'Market discovery',title:'Build a business list.',copy:'Scan a market from the residential Google Maps scout. Every business comes back with its contact points and a deep-research button.',sheet:'Business list',note:'Enter a business, a location, or both. A stable report link is created immediately.',focus:'keyword'},company:{eyebrow:'One company, four rounds',title:'Research one company.',copy:'The name is matched on Google Maps first. You pick the right listing, and only then does research start.',sheet:'Company research',note:'The name is looked up on Google Maps and the matches come back for you to confirm. Nothing is researched until you pick one.',focus:'companyName'},adsmarket:{eyebrow:'Every advertiser in one market',title:'See what the market is advertising.',copy:'One product keyword returns every live Facebook ad in that market \u2014 who is running them, what they offer, how long each has survived, and what nobody is saying.',sheet:'Ads market research',note:'The Facebook Ad Library carries no spend or impression data, so advertisers are ranked by ad count, distinct creatives and how long an ad has run.',focus:'adsKeyword'}};
function setMode(mode){state.mode=mode;document.querySelectorAll('[data-mode]').forEach(function(node){node.classList.toggle('active',node.getAttribute('data-mode')===mode)});el('marketGrid').classList.toggle('hidden',mode!=='market');el('companyGrid').classList.toggle('hidden',mode!=='company');el('adsGrid').classList.toggle('hidden',mode!=='adsmarket');var m=MODES[mode]||MODES.market;el('heroEyebrow').textContent=m.eyebrow;el('heroTitle').textContent=m.title;el('heroCopy').textContent=m.copy;el('sheetTitle').textContent=m.sheet;el('formNote').textContent=m.note;setTimeout(function(){var node=el(m.focus);if(node)node.focus()},40)}
async function startLookup(){var name=el('companyName').value.trim();if(!name){showToast('Enter the company name.');el('companyName').focus();return}var place=el('companyPlace').value.trim();var button=el('lookupButton');button.disabled=true;button.textContent='Looking up…';try{var body=await api('/api/business-search',{method:'POST',body:JSON.stringify({keyword:name,place:place||undefined,max:10,requesterId:'portal:company-lookup'})});el('discoverEmpty').classList.add('hidden');upsertJob(body.report,'lookup');poll(body.report,'lookup');showToast('Looking up '+name+' on Google Maps')}catch(error){if(!authLost(error))showToast(error.message)}finally{button.disabled=false;button.textContent='Find company'}}
async function startAdsMarket(){var keyword=el('adsKeyword').value.trim();if(!keyword){showToast('Enter a product keyword.');el('adsKeyword').focus();return}var button=el('adsButton');button.disabled=true;button.textContent='Starting\u2026';try{var body=await api('/api/ads-market',{method:'POST',body:JSON.stringify({keyword:keyword,country:el('adsCountry').value,pages:Number(el('adsPages').value),requesterId:'portal'})});el('discoverEmpty').classList.add('hidden');upsertJob(body.report,'adsmarket');poll(body.report,'adsmarket');showToast('Ads market research started')}catch(error){if(!authLost(error))showToast(error.message)}finally{button.disabled=false;button.textContent='Research market'}}
async function startSearch(event){event.preventDefault();if(state.mode==='adsmarket')return startAdsMarket();if(state.mode==='company')return startLookup();var keyword=el('keyword').value.trim();var place=el('place').value.trim();if(!keyword&&!place){showToast('Enter a business, a location, or both.');el('keyword').focus();return}var button=el('searchButton');button.disabled=true;button.textContent='Starting…';try{var body=await api('/api/business-search',{method:'POST',body:JSON.stringify({keyword:keyword||undefined,place:place||undefined,max:Number(el('maxResults').value),requesterId:'portal'})});el('discoverEmpty').classList.add('hidden');upsertJob(body.report,'search');poll(body.report,'search');showToast('Market search started')}catch(error){if(!authLost(error))showToast(error.message)}finally{button.disabled=false;button.textContent='Search market'}}
function renderSearch(body,kind){var lookup=kind==='lookup';var companies=(body.data&&body.data.companies)||[];var report=body.report||{};var request=(body.data&&body.data.report&&body.data.report.request)||{};el('searchOutput').classList.remove('hidden');el('discoverEmpty').classList.add('hidden');el('resultTitle').textContent=lookup?'Which one is yours?':(report.title||'Business list');el('resultNote').textContent=lookup?(companies.length+' Google Maps matches · pick the right listing to start deep research on it'):(companies.length+' businesses · use Direct Deep Research to investigate any company');var phones=companies.filter(function(c){return c.phone}).length;var sites=companies.filter(function(c){return c.website}).length;el('resultSummary').innerHTML=metric(companies.length,'Businesses')+metric(phones,'Phone contacts')+metric(sites,'Websites')+metric(report.status==='partial'?'Partial':'Ready','Report status');el('companies').innerHTML=companies.length?companies.map(companyRow).join(''):'<div class="empty">No businesses returned.</div>';setTimeout(function(){el('searchOutput').scrollIntoView({behavior:'smooth',block:'start'})},120)}
function metric(value,label){return '<div class="metric"><strong>'+esc(value)+'</strong><span>'+esc(label)+'</span></div>'}
function companyRow(company,index){var website=safeUrl(company.website);var maps=safeUrl(company.maps_url||company.mapsUrl);var phone=company.phone||'';var rating=company.rating?(' · ★ '+company.rating+(company.reviews?' / '+company.reviews+' reviews':'')):'';var hasContact=Boolean(company.contact_public_id&&(company.contact_status==='completed'||company.contact_status==='partial'));var contactPhones=Number(company.contact_phones_count)||0;var contactDMs=Number(company.contact_decision_makers_count)||0;var contactPill=hasContact?('<div class="contact-pill">📞 <strong>'+contactPhones+' Contact Number'+(contactPhones===1?'':'s')+' Found</strong>'+(contactDMs>0?(' · '+contactDMs+' Leader'+(contactDMs===1?'':'s')):'')+'</div>'):'';var contactAction=hasContact?('<a class="research view-report" style="background:#0a6b47;border-color:#0a6b47" target="_blank" rel="noopener" href="/r/'+attr(company.contact_public_id)+'">Contacts ('+contactPhones+' phones) ↗</a>'):('<button class="research" style="background:#0a6b47;border-color:#0a6b47" data-company="'+attr(company.id)+'" data-name="'+attr(company.name||'Company')+'" aria-label="Start contact research for '+attr(company.name||'Company')+'" onclick="startContact(this)">Contacts ⚡</button>');var rerunAction=hasContact?('<button class="research" data-company="'+attr(company.id)+'" data-name="'+attr(company.name||'Company')+'" data-previous-report="'+attr(company.contact_public_id)+'" onclick="rerunOriginalContact(this)">Rerun original contacts ↻</button>'):'';return '<article class="company'+(hasContact?' has-contact-research':'')+'"><div class="number">'+String(company.rank||index+1).padStart(2,'0')+'</div><div><h3>'+esc(company.name||'Unnamed business')+'</h3><div class="meta">'+esc(company.category||'Business')+esc(rating)+'</div>'+contactPill+'</div><div class="address">'+esc(company.address||'Address not published')+'</div><div class="company-contact"><div class="phone">'+esc(phone||'Phone not published')+'</div><div class="company-actions"><button class="research" data-company="'+attr(company.id)+'" data-name="'+attr(company.name||'Company')+'" aria-label="Start deep research for '+attr(company.name||'Company')+'" onclick="startResearch(this)">Deep research →</button>'+contactAction+rerunAction+'<button class="research" data-company="'+attr(company.id)+'" data-name="'+attr(company.name||'Company')+'" onclick="startParallelContact(this)">Parallel contacts ↗</button>'+(phone?'<a class="source-link" href="tel:'+attr(String(phone).replace(/[^+\d]/g,''))+'">Call</a>':'')+(website?'<a class="source-link" target="_blank" rel="noopener" href="'+attr(website)+'">Website</a>':'')+(maps?'<a class="source-link" target="_blank" rel="noopener" href="'+attr(maps)+'">Maps</a>':'')+'</div></div></article>'}
async function startResearch(button){var companyId=button.getAttribute('data-company')||'';var name=button.getAttribute('data-name')||'Company';if(!companyId)return;button.disabled=true;button.textContent='Starting…';try{var body=await api('/api/company-research',{method:'POST',body:JSON.stringify({companyId:companyId,requesterId:'portal'})});var view=safeUrl(body.report&&body.report.view_url);if(view){button.outerHTML='<a class="research view-report" target="_blank" rel="noopener" href="'+attr(view)+'" aria-label="Open research report for '+attr(name)+'">Open report <span>↗</span></a>'}else{button.textContent='Research underway'}upsertJob(body.report,'deep');poll(body.report,'deep');showToast('Deep research started for '+name+'. Open report any time to follow progress.')}catch(error){button.disabled=false;button.textContent='Deep research →';if(!authLost(error))showToast(error.message)}}
async function startContact(button,quiet){var compareToReportId=button.getAttribute('data-previous-report')||null;var originalLabel=button.textContent;var companyId=button.getAttribute('data-company')||'';var name=button.getAttribute('data-name')||'Company';if(!companyId)return false;button.disabled=true;button.textContent='Starting…';try{var body=await api('/api/contact-research',{method:'POST',body:JSON.stringify({companyId:companyId,requesterId:'portal',compareToReportId:compareToReportId||null})});var view=safeUrl(body.report&&body.report.view_url);if(view){button.outerHTML='<a class="research view-report" target="_blank" rel="noopener" href="'+attr(view)+'" aria-label="Open contact report for '+attr(name)+'">'+(compareToReportId?'Open new original report':'Open contacts')+' <span>↗</span></a>'}else{button.textContent='Contacts underway'}upsertJob(body.report,'contact');poll(body.report,'contact');if(!quiet)showToast('Contact research started for '+name+'. Open report any time to follow progress.');return true}catch(error){button.disabled=false;button.textContent=originalLabel;var lost=authLost(error);if(!quiet&&!lost)showToast(error.message);return false}}
async function startParallelContact(button){var companyId=button.getAttribute('data-company')||'';var name=button.getAttribute('data-name')||'Company';if(!companyId)return;button.disabled=true;button.textContent='Starting…';try{var body=await api('/api/parallel-contact-research',{method:'POST',body:JSON.stringify({companyId:companyId,requesterId:'portal'})});var view=safeUrl(body.report&&body.report.view_url);if(view){button.outerHTML='<a class="research view-report" target="_blank" rel="noopener" href="'+attr(view)+'">Open Parallel contacts ↗</a>'}else{button.textContent='Parallel underway'}upsertJob(body.report,'contact');poll(body.report,'contact');showToast('Parallel contact research started for '+name)}catch(error){button.disabled=false;button.textContent='Parallel contacts ↗';if(!authLost(error))showToast(error.message)}}
function rerunOriginalContact(button){return startContact(button,false)}
// One click queues contact research for every row on the current page.
//
// It walks the live DOM rather than leadState.leads so it can reuse
// startContact and get the same row-swap, job registration and poll per
// company — a second code path would drift from what a single click does.
// The walk is sequential on purpose: 30 parallel POSTs would race the
// per-company dedupe on /api/contact-research and let two versions of the
// same company's report through. Rows are already deduped server-side, so
// re-running after a failure only links reports that are already going.
async function queueContactAll(button){var pending=[].slice.call(document.querySelectorAll('#leadTableWrapper button[onclick*="startContact"]'));if(!pending.length){showToast('Nothing to queue — every company on this page already has contact research.');return}if(!window.confirm('Queue contact research for all '+pending.length+' companies on this page?\n\nThey run through the queue one after another.'))return;var was=button.textContent;button.disabled=true;var queued=0,failed=0,i=0;for(;i<pending.length;i++){if(!state.token)break;button.textContent='Queueing '+(i+1)+'/'+pending.length+'…';if(await startContact(pending[i],true))queued++;else failed++}var stopped=!state.token&&i<pending.length;if(stopped)failed+=pending.length-i;button.disabled=false;button.textContent=was;showToast(stopped?('Access expired — '+queued+' queued, '+(pending.length-queued)+' not attempted. Sign in and queue again.'):(failed?(queued+' queued · '+failed+' failed — reload and queue again; reports already running are only linked, never restarted'):(queued+' queued for contact research')))}
// One map from report type to the Active-work label, shared by every caller that
// starts a poll. Inlined ternaries in three places were three chances to disagree
// about what an ads_market row is called.
function kindFor(report){return report.type==='business_search'?'search':report.type==='person_research'?'vip':report.type==='ads_research'?'ads':report.type==='ads_market'?'adsmarket':report.type==='contact_research'?'contact':'deep'}
async function loadLibrary(){if(!state.token)return;var path='/api/reports?limit=100';if(state.filter!=='all')path+='&type='+encodeURIComponent(state.filter);try{var body=await api(path);state.reports=body.reports||[];renderLibrary();state.reports.forEach(function(report){if(terminal.indexOf(report.status)<0&&!state.jobs[report.id])poll(report,kindFor(report))});if(el('telemarketingView').classList.contains('active'))await loadTelemarketingView()}catch(error){if(!authLost(error))showToast(error.message)}}
function setFilter(filter){state.filter=filter;document.querySelectorAll('[data-filter]').forEach(function(node){node.classList.toggle('active',node.getAttribute('data-filter')===filter)});loadLibrary()}
function renderLibrary(){var list=state.reports;el('reportList').innerHTML=list.length?list.map(reportRow).join(''):'<div class="empty">No reports in this view yet.</div>'}
async function retryFailedReports(button){if(!state.token)return;button.disabled=true;var note=el('retryFailedNote');note.textContent='Finding failed reports…';try{var failed=[],offset=0,total=0;do{var page=await api('/api/reports?status=failed&limit=100&offset='+offset);failed=failed.concat(page.reports||[]);total=page.total||0;offset+=100}while(offset<total);if(!failed.length){note.textContent='No failed reports to re-run.';return}if(!window.confirm('Re-run all '+failed.length+' failed reports? They will queue with their original inputs and keep their report links.')){note.textContent='';return}var queued=0,errors=[];for(var i=0;i<failed.length;i++){if(!state.token)break;note.textContent='Queueing '+(i+1)+' of '+failed.length+'…';try{var body=await api('/api/reports/'+encodeURIComponent(failed[i].id)+'/retry',{method:'POST'});queued++;if(body.report)poll(body.report,kindFor(body.report))}catch(error){errors.push((failed[i].title||failed[i].id)+': '+error.message);if(authLost(error))break}}await loadLibrary();note.textContent=queued+' queued'+(errors.length?' · '+errors.length+' could not be queued':'')+(state.token?'':' · access expired');if(errors.length)showToast(errors[0]+(errors.length>1?' (and '+(errors.length-1)+' more)':''))}catch(error){note.textContent='Could not load failed reports: '+error.message;if(!authLost(error))showToast(error.message)}finally{button.disabled=false}}
function reportRow(report){var deep=report.type==='company_research';var vip=report.type==='person_research';var contact=report.type==='contact_research';var ready=deep&&(report.status==='completed'||report.status==='partial');var preview=report.preview||{};var view=safeUrl(report.view_url);var summary=deep?(preview.summary||'Company intelligence report'):vip?(preview.summary||'Public-professional VIP brief'):contact?(preview.cheat_sheet&&preview.cheat_sheet.primary_decision_maker?'Target: '+preview.cheat_sheet.primary_decision_maker:'Telemarketing contact intelligence'):(preview.keyword?('Market scan for '+preview.keyword+(preview.place?' in '+preview.place:'')):'Business discovery report');var stats=deep?((preview.contacts||0)+' contacts<br>'+(preview.people||0)+' people<br>'+(preview.signals||0)+' signals'):vip?((preview.facts||0)+' facts<br>'+(preview.signals||0)+' signals'):contact?((preview.decision_makers||0)+' leaders<br>'+(preview.phones||0)+' phones<br>'+(preview.emails||0)+' emails'):((preview.companies==null?'—':preview.companies)+' companies');return '<article class="report"><div class="report-kind">'+(deep?'Company dossier':vip?'VIP brief':contact?'Contact research':'Business list')+'<span class="report-date">'+date(report.created_at)+'</span></div><div><h3>'+esc(report.title)+'</h3><p class="report-summary">'+esc(summary)+'</p>'+(report.type==='business_search'&&report.status==='partial'&&report.error?'<p class="report-summary" style="color:var(--bad)">Save issue: '+esc(report.error)+'</p>':'')+'</div><div class="report-stats"><span class="status '+attr(report.status)+'">'+esc(report.status)+'</span><br>'+stats+'</div><div class="report-actions">'+(view?'<a class="text-action" target="_blank" rel="noopener" href="'+attr(view)+'">Open report <span>↗</span></a>':'')+(deep&&ready?'<button class="text-action" data-report="'+attr(report.id)+'" aria-expanded="false" onclick="togglePeople(this)">People <span>+</span></button>':'')+(deep&&ready?'<button class="text-action" data-report="'+attr(report.id)+'" data-company="'+attr(report.company_id||'')+'" data-name="'+attr(companyName(report))+'" onclick="startAds(this)">Ads research <span>\u2192</span></button>':'')+(report.status==='failed'?'<button class="text-action" data-report="'+attr(report.id)+'" data-title="'+attr(report.title||'Report')+'" aria-label="Re-run report '+attr(report.title||'')+'" onclick="retryReport(this)">Re-run <span>\u21bb</span></button>':'')+(report.repairable?'<button class="text-action" data-report="'+attr(report.id)+'" onclick="repairReport(this)">Repair save <span>↻</span></button>':'')+'<button class="text-action danger" data-report="'+attr(report.id)+'" data-title="'+attr(report.title||'Report')+'" aria-label="Delete report '+attr(report.title||'')+'" onclick="deleteReport(this)">Delete <span>\u00d7</span></button>'+'</div>'+(deep&&ready?'<div class="people-panel hidden" id="people-'+attr(report.id)+'"></div>':'')+'</article>'}
async function togglePeople(button){var id=button.getAttribute('data-report')||'';var panel=el('people-'+id);if(!panel)return;var open=panel.classList.contains('hidden');panel.classList.toggle('hidden',!open);button.setAttribute('aria-expanded',open?'true':'false');button.innerHTML='People <span>'+(open?'\u2212':'+')+'</span>';if(!open||panel.getAttribute('data-loaded')==='1')return;panel.innerHTML='<div class="empty">Loading people\u2026</div>';try{var body=await api('/api/company-research/'+encodeURIComponent(id));panel.innerHTML=peopleHtml(id,(body.data&&body.data.final)||{});panel.setAttribute('data-loaded','1')}catch(error){panel.innerHTML='<div class="empty">'+esc(error.message)+'</div>';if(authLost(error))panel.classList.add('hidden')}}
function peopleHtml(reportId,final){var people=final.people||[];var candidates=final.candidate_people||[];var auto=final.auto_person_research||{};var autoReport=safeId(auto.report_id);var autoPerson=String(auto.person_id==null?'':auto.person_id);var out='';if(people.length){out+='<p class="people-head">Validated people \u00b7 start a VIP brief</p>'+people.map(function(row,i){var pid=String(row.id==null?'':row.id);var role=row.role||row.current_role||row.position||'Role not stated';var evidence=safeUrl(row.role_url||row.role_evidence_url||row.evidence_url);var action;if(pid&&pid===autoPerson&&autoReport){action='<a class="vip" target="_blank" rel="noopener" href="/r/'+attr(autoReport)+'">Open brief <span>\u2197</span></a>'}else if(pid){action='<button class="vip" data-report="'+attr(reportId)+'" data-person="'+attr(pid)+'" aria-label="Start a VIP brief for '+attr(row.name||'this person')+'" onclick="startVip(this)">VIP brief \u2192</button>'}else{action='<span class="person-note">No id \u00b7 cannot be researched</span>'}return '<div class="person-row"><div class="person-rank">P'+String(i+1).padStart(2,'0')+'</div><div><div class="person-name">'+esc(row.name||'Unnamed')+'</div><div class="person-role">'+esc(role)+'</div>'+(evidence?'<a class="person-note" target="_blank" rel="noopener" href="'+attr(evidence)+'">Role evidence \u2197</a>':'<span class="person-note">Role evidence not linked</span>')+'</div>'+action+'</div>'}).join('')}
if(candidates.length){out+='<p class="people-head">Leads to verify \u00b7 role not yet evidenced</p>'+candidates.map(function(row){var source=safeUrl(row.source_url);return '<div class="person-row"><div class="person-rank">\u2014</div><div><div class="person-name">'+esc(row.name||'Unnamed')+'</div><div class="person-role">'+esc(row.role||row.current_role||row.position||'Role not stated')+'</div>'+'<span class="person-note">Named by '+esc(row.source_name||'a public source')+' \u00b7 confirm the role before a brief</span></div>'+(source?'<a class="vip" target="_blank" rel="noopener" href="'+attr(source)+'">Source <span>\u2197</span></a>':'')+'</div>'}).join('')}
return out||'<div class="empty">This dossier validated no people.</div>'}
function companyName(report){var t=String(report.title||'');return t.replace(/\s+intelligence report$/i,'').replace(/\s+ads$/i,'').trim()||t}
async function startAds(button){var name=button.getAttribute('data-name')||'';var companyId=button.getAttribute('data-company')||'';if(!name)return;var markup=button.innerHTML;button.disabled=true;button.textContent='Starting\u2026';try{var body=await api('/api/ads-research',{method:'POST',body:JSON.stringify({name:name,companyId:companyId||undefined,requesterId:'portal'})});var view=safeUrl(body.report&&body.report.view_url);if(view){button.outerHTML='<a class="text-action" target="_blank" rel="noopener" href="'+attr(view)+'">Open ads <span>\u2197</span></a>'}else{button.textContent='Ads underway'}if(body.report)poll(body.report,'ads')}catch(error){button.disabled=false;button.innerHTML=markup;if(!authLost(error))showToast(error.message)}}
async function startVip(button){var reportId=button.getAttribute('data-report')||'';var personId=button.getAttribute('data-person')||'';if(!reportId||!personId)return;button.disabled=true;button.textContent='Starting\u2026';try{var body=await api('/api/person-research',{method:'POST',body:JSON.stringify({companyResearchId:reportId,personId:personId,requesterId:'portal'})});var view=safeUrl(body.report&&body.report.view_url);if(view){button.outerHTML='<a class="vip" target="_blank" rel="noopener" href="'+attr(view)+'">Open brief <span>\u2197</span></a>'}else{button.textContent='Brief underway'}upsertJob(body.report,'vip');poll(body.report,'vip');showToast('VIP brief started. Follow it in Active work.')}catch(error){button.disabled=false;button.textContent='VIP brief \u2192';if(!authLost(error))showToast(error.message)}}
function forgetReport(id){delete state.jobs[id];renderJobs();state.reports=state.reports.filter(function(r){return r.id!==id});renderLibrary()}
async function deleteReport(button){var id=button.getAttribute('data-report')||'';var title=button.getAttribute('data-title')||'this report';if(!id)return;if(!window.confirm('Delete "'+title+'" permanently?\n\nThe report link stops working and its research data and run trail are removed. A run still going is deleted too. This cannot be undone.'))return;button.disabled=true;button.textContent='Deleting…';try{await api('/api/reports/'+encodeURIComponent(id),{method:'DELETE'});forgetReport(id);showToast('Report deleted')}catch(error){if(error.status===404){forgetReport(id);showToast('Report was already deleted');return}button.disabled=false;button.innerHTML='Delete <span>×</span>';if(!authLost(error))showToast(error.message)}}
// One failed row, re-run in place. No confirm: it is one report, it keeps its
// link, and Delete two buttons away is the destructive one. On success the
// library reload flips the row out of failed; the button state is rebuilt
// with the HTML, so only the error path has to put the label back.
async function retryReport(button){var id=button.getAttribute('data-report')||'';var title=button.getAttribute('data-title')||'this report';if(!id)return;button.disabled=true;button.textContent='Queueing…';try{var body=await api('/api/reports/'+encodeURIComponent(id)+'/retry',{method:'POST'});if(body.report)poll(body.report,kindFor(body.report));await loadLibrary();showToast('Re-run queued for "'+title+'" — same report link, follow it in Active work.')}catch(error){button.disabled=false;button.innerHTML='Re-run <span>↻</span>';if(!authLost(error))showToast(error.message)}}
async function repairReport(button){var id=button.getAttribute('data-report')||'';if(!id)return;button.disabled=true;button.textContent='Repairing…';try{var body=await api('/api/reports/'+encodeURIComponent(id)+'/repair',{method:'POST'});await loadLibrary();showToast('Saved '+(body.saved&&body.saved.linked||0)+' businesses from the existing report. No new scan was needed.')}catch(error){button.disabled=false;button.innerHTML='Repair save <span>↻</span>';if(!authLost(error))showToast('Repair failed: '+error.message)}}
function agentValue(a){return a.uid?(a.uid.startsWith('uid:')?a.uid:'uid:'+a.uid):a.name}
function agentLabel(a){return a.uid?a.name+' ('+a.uid+')':a.name}

var assignState={agents:[],leads:[],selected:{},stats:null,teleFilter:'all',statusFilter:'all',search:'',page:0,limit:30,total:0,rosterViewMode:'list',rosterSearch:'',rosterSortField:'total',rosterSortDir:'desc',rosterExpanded:false};
try{if(typeof localStorage!=='undefined'){var savedView=localStorage.getItem('tele_roster_view');if(savedView==='cards'||savedView==='list')assignState.rosterViewMode=savedView;}}catch(e){}

function setAssignRosterView(mode){
  assignState.rosterViewMode=mode;
  try{if(typeof localStorage!=='undefined')localStorage.setItem('tele_roster_view',mode)}catch(e){}
  renderAssignTelemarketerCards();
}

function onAssignRosterSearch(val){
  assignState.rosterSearch=val;
  renderAssignTelemarketerCards();
}

function clearAssignRosterSearch(){
  assignState.rosterSearch='';
  var s=el('assignRosterSearch');
  if(s)s.value='';
  renderAssignTelemarketerCards();
}

function sortAssignRoster(field){
  if(assignState.rosterSortField===field){
    assignState.rosterSortDir=(assignState.rosterSortDir==='asc'?'desc':'asc');
  }else{
    assignState.rosterSortField=field;
    assignState.rosterSortDir=(field==='name'?'asc':'desc');
  }
  renderAssignTelemarketerCards();
}

function toggleAssignRosterExpand(){
  assignState.rosterExpanded=!assignState.rosterExpanded;
  renderAssignTelemarketerCards();
}

async function loadAssignmentView(){
  if(!state.token)return;
  await loadAssignmentAgents();
  await loadAssignmentLeads();
}

async function assignTamanLeadsToOwners(){
  if(!confirm('Assign every unassigned lead at an assigned taman to that taman\'s telemarketer? Leads already with someone are not changed.'))return;
  var btn=el('assignOwnersBtn');
  var label=btn?btn.textContent:'';
  if(btn){btn.disabled=true;btn.textContent='Assigning…'}
  try{
    var res=await api('/api/territories/assign-owners',{method:'POST',body:JSON.stringify({})});
    var who=Object.keys(res.byAgent||{}).map(function(k){return k+' '+res.byAgent[k]}).join(', ');
    var msg=res.updated?('Assigned '+res.updated+' leads across '+res.tamans+' tamans'+(who?' ('+who+')':'')):'No unassigned leads at assigned tamans.';
    if(res.skipped&&res.skipped.length)msg+=' · '+res.skipped.length+' tamans skipped: '+res.skipped.map(function(s){return s.taman}).join(', ');
    showToast(msg);
    await loadAssignmentView();
  }catch(err){
    if(!authLost(err))showToast('Failed to assign taman leads: '+err.message);
  }finally{
    if(btn){btn.disabled=false;btn.textContent=label}
  }
}

async function loadAssignmentAgents(){
  try{
    var body=await api('/api/telemarketers');
    assignState.agents=body.agents||[];
    assignState.stats=body.stats||null;
    renderAssignStats(body.stats||{});
    renderAssignTelemarketerCards();
    renderAssignTeleSelectors();
  }catch(err){
    if(!authLost(err))showToast('Failed to load telemarketers: '+err.message);
  }
}

function renderAssignStats(stats){
  var sTotal=el('assignStatTotal');
  var sAssigned=el('assignStatAssigned');
  var sUnassigned=el('assignStatUnassigned');
  var sAgents=el('assignStatAgents');
  var sContacted=el('assignStatContacted');
  var sInterested=el('assignStatInterested');

  var totalAssigned=(stats.assigned||0)+(stats.contacted||0)+(stats.interested||0)+(stats.not_interested||0)+(stats.do_not_call||0);
  var activeAgents=(assignState.agents||[]).filter(function(a){return a.active}).length;

  if(sTotal)sTotal.textContent=stats.total||0;
  if(sAssigned)sAssigned.textContent=totalAssigned;
  if(sUnassigned)sUnassigned.textContent=stats.unassigned||0;
  if(sAgents)sAgents.textContent=activeAgents;
  if(sContacted)sContacted.textContent=stats.contacted||0;
  if(sInterested)sInterested.textContent=stats.interested||0;
}

function renderAssignTelemarketerCards(){
  var cont=el('assignRosterGrid');
  if(!cont)return;
  var agents=assignState.agents||[];
  var stats=assignState.stats||{};

  var countBadge=el('assignRosterCountBadge');
  if(countBadge)countBadge.textContent=agents.length+' Agents';

  var btnList=el('btnRosterViewList');
  var btnCards=el('btnRosterViewCards');
  var viewMode=assignState.rosterViewMode||'list';
  if(btnList)btnList.classList.toggle('active',viewMode==='list');
  if(btnCards)btnCards.classList.toggle('active',viewMode==='cards');

  var totalAllAssigned=(stats.assigned||0)+(stats.contacted||0)+(stats.interested||0)+(stats.not_interested||0)+(stats.do_not_call||0);
  var isAllActive=(assignState.teleFilter==='all');
  var isUnassignedActive=(assignState.teleFilter==='unassigned');

  if(viewMode==='cards'){
    cont.className='assign-roster-grid view-cards';
    renderAssignTelemarketerCardsGrid(cont, agents, stats, totalAllAssigned, isAllActive, isUnassignedActive);
  }else{
    cont.className='assign-roster-grid view-list';
    renderAssignTelemarketerTableView(cont, agents, stats, totalAllAssigned, isAllActive, isUnassignedActive);
  }
}

function renderAssignTelemarketerTableView(cont, agents, stats, totalAllAssigned, isAllActive, isUnassignedActive){
  var search=(assignState.rosterSearch||'').trim().toLowerCase();
  var sortField=assignState.rosterSortField||'total';
  var sortDir=assignState.rosterSortDir||'desc';
  var isExpanded=Boolean(assignState.rosterExpanded);

  var visibleAgents=agents.slice();
  if(search){
    visibleAgents=visibleAgents.filter(function(a){
      var n=(a.name||'').toLowerCase();
      var p=(a.phone||'').toLowerCase();
      var e=(a.email||'').toLowerCase();
      var u=(a.uid||'').toLowerCase();
      return n.indexOf(search)>=0 || p.indexOf(search)>=0 || e.indexOf(search)>=0 || u.indexOf(search)>=0;
    });
  }

  visibleAgents.sort(function(a, b){
    var mult=(sortDir==='asc'?1:-1);
    if(sortField==='name'){
      return mult * (a.name||'').localeCompare(b.name||'');
    }
    if(sortField==='pending'){
      var pA=a.pending_count!=null?Number(a.pending_count):Math.max(0,(Number(a.total_assigned)||0)-((Number(a.contacted_count)||0)+(Number(a.interested_count)||0)+(Number(a.not_interested_count)||0)+(Number(a.dnc_count)||0)));
      var pB=b.pending_count!=null?Number(b.pending_count):Math.max(0,(Number(b.total_assigned)||0)-((Number(b.contacted_count)||0)+(Number(b.interested_count)||0)+(Number(b.not_interested_count)||0)+(Number(b.dnc_count)||0)));
      return mult * (pA - pB);
    }
    if(sortField==='contacted'){
      return mult * ((Number(a.contacted_count)||0) - (Number(b.contacted_count)||0));
    }
    if(sortField==='interested'){
      return mult * ((Number(a.interested_count)||0) - (Number(b.interested_count)||0));
    }
    if(sortField==='lost'){
      var lA=(Number(a.not_interested_count)||0)+(Number(a.dnc_count)||0);
      var lB=(Number(b.not_interested_count)||0)+(Number(b.dnc_count)||0);
      return mult * (lA - lB);
    }
    var tA=Number(a.total_assigned)||0;
    var tB=Number(b.total_assigned)||0;
    if(tA!==tB) return mult * (tA - tB);
    return (a.name||'').localeCompare(b.name||'');
  });

  function sortArrow(field){
    if(sortField!==field) return '<span style="opacity:.3;margin-left:4px;">↕</span>';
    return '<span style="color:var(--accent);margin-left:4px;">'+(sortDir==='asc'?'▲':'▼')+'</span>';
  }

  function renderBar(tot, pend, cont, inter, lst){
    if(!tot) return '<div class="assign-mini-bar" title="No leads assigned"><div style="width:100%;height:100%;background:#e5e7eb;"></div></div>';
    var pP=Math.round((pend/tot)*100);
    var pC=Math.round((cont/tot)*100);
    var pI=Math.round((inter/tot)*100);
    var pL=Math.max(0,100-(pP+pC+pI));
    return '<div class="assign-mini-bar" title="'+pend+' pending · '+cont+' contacted · '+inter+' interested · '+lst+' lost">'
      +'<div class="assign-mini-seg pending" style="width:'+pP+'%"></div>'
      +'<div class="assign-mini-seg contacted" style="width:'+pC+'%"></div>'
      +'<div class="assign-mini-seg interested" style="width:'+pI+'%"></div>'
      +'<div class="assign-mini-seg lost" style="width:'+pL+'%"></div>'
      +'</div>';
  }

  var html='<div class="assign-roster-table-wrap '+(isExpanded?'expanded':'')+'">'
    +'<table class="assign-roster-table">'
    +'<thead><tr>'
    +'<th class="sortable" onclick="sortAssignRoster(\'name\')">Telemarketer '+sortArrow('name')+'</th>'
    +'<th style="width:90px;">Status</th>'
    +'<th class="sortable" style="text-align:right;width:110px;" onclick="sortAssignRoster(\'total\')">Total Leads '+sortArrow('total')+'</th>'
    +'<th class="sortable" style="text-align:right;width:95px;" onclick="sortAssignRoster(\'pending\')">To Call '+sortArrow('pending')+'</th>'
    +'<th class="sortable" style="text-align:right;width:95px;" onclick="sortAssignRoster(\'contacted\')">Contacted '+sortArrow('contacted')+'</th>'
    +'<th class="sortable" style="text-align:right;width:95px;" onclick="sortAssignRoster(\'interested\')">Interested '+sortArrow('interested')+'</th>'
    +'<th class="sortable" style="text-align:right;width:95px;" onclick="sortAssignRoster(\'lost\')">Lost / DNC '+sortArrow('lost')+'</th>'
    +'<th style="width:140px;">Workload Breakdown</th>'
    +'<th style="text-align:right;width:110px;">Action</th>'
    +'</tr></thead>'
    +'<tbody>';

  // 1. All Telemarketers row
  var allLost=((stats.not_interested||0)+(stats.do_not_call||0));
  html+='<tr class="assign-roster-row system-row '+(isAllActive?'active':'')+'" onclick="selectAssignmentTele(\'all\')">'
    +'<td>'
    +'<div style="display:flex;align-items:center;gap:10px;">'
    +'<div class="assign-agent-avatar" style="width:30px;height:30px;font-size:12px;background:var(--ink);flex-shrink:0;">👥</div>'
    +'<div style="min-width:0;">'
    +'<div style="font-weight:700;color:var(--ink);display:flex;align-items:center;gap:6px;">'
    +'All Telemarketers'
    +(isAllActive?'<span class="assign-active-badge-sm">✓ Filtered</span>':'')
    +'</div>'
    +'<div class="meta" style="margin:0;font-size:11px;">Entire workspace pool</div>'
    +'</div></div></td>'
    +'<td><span class="status completed" style="font-size:8.5px;">'+agents.length+' AGENTS</span></td>'
    +'<td style="text-align:right;"><span class="assign-num-bold">'+totalAllAssigned+'</span></td>'
    +'<td style="text-align:right;"><span class="assign-num-cell pending">'+(stats.assigned||0)+'</span></td>'
    +'<td style="text-align:right;"><span class="assign-num-cell contacted">'+(stats.contacted||0)+'</span></td>'
    +'<td style="text-align:right;"><span class="assign-num-cell interested">'+(stats.interested||0)+'</span></td>'
    +'<td style="text-align:right;"><span class="assign-num-cell lost">'+allLost+'</span></td>'
    +'<td>'+renderBar(totalAllAssigned, (stats.assigned||0), (stats.contacted||0), (stats.interested||0), allLost)+'</td>'
    +'<td style="text-align:right;">'
    +'<button class="'+(isAllActive?'primary':'filter')+'" type="button" style="height:26px;padding:0 8px;font-size:9px;">'+(isAllActive?'Viewing All':'Filter All →')+'</button>'
    +'</td>'
    +'</tr>';

  // 2. Unassigned Leads row
  html+='<tr class="assign-roster-row system-row unassigned-row '+(isUnassignedActive?'active':'')+'" onclick="selectAssignmentTele(\'unassigned\')">'
    +'<td>'
    +'<div style="display:flex;align-items:center;gap:10px;">'
    +'<div class="assign-agent-avatar" style="width:30px;height:30px;font-size:12px;background:#f59e0b;flex-shrink:0;">📋</div>'
    +'<div style="min-width:0;">'
    +'<div style="font-weight:700;color:var(--ink);display:flex;align-items:center;gap:6px;">'
    +'Unassigned Leads'
    +(isUnassignedActive?'<span class="assign-active-badge-sm" style="color:var(--warn);background:#fef3c7;">✓ Filtered</span>':'')
    +'</div>'
    +'<div class="meta" style="margin:0;font-size:11px;">Waiting to be allocated</div>'
    +'</div></div></td>'
    +'<td><span class="status" style="color:var(--warn);background:#fffbeb;border:1px solid #fde68a;padding:2px 6px;border-radius:3px;font-size:8.5px;">UNALLOCATED</span></td>'
    +'<td style="text-align:right;"><span class="assign-num-bold" style="color:var(--warn);">'+(stats.unassigned||0)+'</span></td>'
    +'<td style="text-align:right;"><span class="assign-num-cell" style="color:var(--warn);">'+(stats.unassigned||0)+'</span></td>'
    +'<td style="text-align:right;color:var(--muted);font-family:var(--mono);font-size:12px;">—</td>'
    +'<td style="text-align:right;color:var(--muted);font-family:var(--mono);font-size:12px;">—</td>'
    +'<td style="text-align:right;color:var(--muted);font-family:var(--mono);font-size:12px;">—</td>'
    +'<td><span style="font-size:11px;color:var(--warn);font-weight:500;">'+(stats.unassigned||0)+' leads waiting</span></td>'
    +'<td style="text-align:right;">'
    +'<button class="'+(isUnassignedActive?'primary':'filter')+'" type="button" style="height:26px;padding:0 8px;font-size:9px;color:var(--warn);border-color:var(--warn);background:#fff;">'+(isUnassignedActive?'Viewing':'Assign →')+'</button>'
    +'</td>'
    +'</tr>';

  // 3. Telemarketers rows
  if(!visibleAgents.length){
    if(search){
      html+='<tr><td colspan="9" style="text-align:center;padding:32px 16px;color:var(--muted);font-size:13px;">'
        +'No telemarketer found matching "<strong>'+esc(search)+'</strong>". '
        +'<button class="filter" type="button" onclick="clearAssignRosterSearch()" style="height:26px;padding:0 8px;font-size:9px;margin-left:8px;">Clear Search</button>'
        +'</td></tr>';
    }else{
      html+='<tr><td colspan="9" style="text-align:center;padding:32px 16px;color:var(--muted);font-size:13px;">'
        +'No telemarketers registered yet. <a href="javascript:void(0)" onclick="switchView(\'agents\')">Add telemarketers</a> or import from atap.solar.'
        +'</td></tr>';
    }
  }else{
    visibleAgents.forEach(function(agent){
      var val=agentValue(agent);
      var isActive=(assignState.teleFilter===val||assignState.teleFilter===agent.name||(agent.name&&assignState.teleFilter.toLowerCase()===agent.name.toLowerCase())||(agent.uid&&assignState.teleFilter==='uid:'+agent.uid)||(agent.uid&&assignState.teleFilter===agent.uid));
      var initials=agent.name.split(/\s+/).map(function(w){return w[0]}).slice(0,2).join('').toUpperCase()||'TM';
      var statusBadge=agent.active?'<span class="status completed" style="font-size:8.5px;">Active</span>':'<span class="status" style="color:var(--muted);font-size:8.5px;">Inactive</span>';

      var total=Number(agent.total_assigned)||0;
      var contacted=Number(agent.contacted_count)||0;
      var interested=Number(agent.interested_count)||0;
      var lost=(Number(agent.not_interested_count)||0)+(Number(agent.dnc_count)||0);
      var pending=agent.pending_count!=null?Number(agent.pending_count):Math.max(0,total-(contacted+interested+lost));

      html+='<tr class="assign-roster-row '+(isActive?'active':'')+' '+(agent.active?'':'inactive')+'" id="assignCard-'+attr(agent.id)+'" data-agent="'+attr(val)+'" onclick="selectAssignmentTele(\''+attr(val)+'\')">'
        +'<td>'
        +'<div style="display:flex;align-items:center;gap:10px;">'
        +'<div class="assign-agent-avatar" style="width:30px;height:30px;font-size:11px;background:'+(isActive?'var(--accent)':'#4b5563')+';flex-shrink:0;">'+esc(initials)+'</div>'
        +'<div style="min-width:0;">'
        +'<div style="font-weight:700;color:var(--ink);display:flex;align-items:center;gap:6px;" title="'+attr(agent.name)+'">'
        +'<span style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:180px;">'+esc(agent.name)+'</span>'
        +(isActive?'<span class="assign-active-badge-sm">✓ Filtered</span>':'')
        +'</div>'
        +'<div class="meta" style="margin:0;font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:180px;">'
        +(agent.phone?esc(agent.phone):(agent.email?esc(agent.email):(agent.uid?esc(agent.uid):'Telemarketer')))
        +'</div>'
        +'</div></div></td>'
        +'<td>'+statusBadge+'</td>'
        +'<td style="text-align:right;"><span class="assign-num-bold">'+total+'</span></td>'
        +'<td style="text-align:right;"><span class="assign-num-cell pending">'+pending+'</span></td>'
        +'<td style="text-align:right;"><span class="assign-num-cell contacted">'+contacted+'</span></td>'
        +'<td style="text-align:right;"><span class="assign-num-cell interested">'+interested+'</span></td>'
        +'<td style="text-align:right;"><span class="assign-num-cell lost">'+lost+'</span></td>'
        +'<td>'+renderBar(total, pending, contacted, interested, lost)+'</td>'
        +'<td style="text-align:right;">'
        +'<button class="'+(isActive?'primary':'filter')+'" type="button" style="height:26px;padding:0 8px;font-size:9px;">'+(isActive?'Filtered':'Filter Leads →')+'</button>'
        +'</td>'
        +'</tr>';
    });
  }

  html+='</tbody></table></div>';

  var activeCount=agents.filter(function(a){return a.active}).length;
  html+='<div class="assign-roster-footer">'
    +'<div>Showing <strong>'+visibleAgents.length+'</strong> of <strong>'+agents.length+'</strong> telemarketers ('+activeCount+' active)'
    +(search?' · Filtered by "'+esc(search)+'" <a href="javascript:void(0)" onclick="clearAssignRosterSearch()" style="margin-left:4px;color:var(--accent);text-decoration:none;">✕ Clear</a>':'')
    +'</div>'
    +'<div style="display:flex;align-items:center;gap:8px;">'
    +(agents.length>10?('<button class="filter" type="button" onclick="toggleAssignRosterExpand()" style="height:26px;padding:0 8px;font-size:9px;">'+(isExpanded?'↕ Collapse View':'↕ Expand Table ('+agents.length+' rows)')+'</button>'):'')
    +'</div>'
    +'</div>';

  cont.innerHTML=html;
}

function renderAssignTelemarketerCardsGrid(cont, agents, stats, totalAllAssigned, isAllActive, isUnassignedActive){
  var html='';

  // 1. All Telemarketers card
  html+='<article class="assign-agent-card '+(isAllActive?'active':'')+'" onclick="selectAssignmentTele(\'all\')">'
    +'<span class="assign-active-badge">✓ Filtered</span>'
    +'<div class="assign-agent-head">'
    +'<div class="assign-agent-info">'
    +'<div class="assign-agent-avatar" style="background:var(--ink);">👥</div>'
    +'<div><div class="assign-agent-name">All Telemarketers</div><div class="meta">Entire workspace pool</div></div>'
    +'</div>'
    +'<span class="status completed">'+agents.length+' Agents</span>'
    +'</div>'
    +'<div class="assign-agent-total">'
    +'<div><div class="assign-total-num">'+totalAllAssigned+'</div><div class="assign-total-lbl">Total Leads Assigned</div></div>'
    +'<button class="primary" type="button" style="height:28px;padding:0 10px;font-size:9.5px;">'+(isAllActive?'Viewing All':'Filter All →')+'</button>'
    +'</div>'
    +'<div class="assign-breakdown-row">'
    +'<div class="assign-breakdown-cell"><div class="assign-breakdown-val">'+(stats.assigned||0)+'</div><div class="assign-breakdown-lbl">To Call</div></div>'
    +'<div class="assign-breakdown-cell"><div class="assign-breakdown-val" style="color:var(--warn);">'+(stats.contacted||0)+'</div><div class="assign-breakdown-lbl">Contacted</div></div>'
    +'<div class="assign-breakdown-cell"><div class="assign-breakdown-val" style="color:var(--ok);">'+(stats.interested||0)+'</div><div class="assign-breakdown-lbl">Interested</div></div>'
    +'<div class="assign-breakdown-cell"><div class="assign-breakdown-val" style="color:var(--bad);">'+((stats.not_interested||0)+(stats.do_not_call||0))+'</div><div class="assign-breakdown-lbl">Lost/DNC</div></div>'
    +'</div>'
    +'</article>';

  // 2. Unassigned Leads card
  html+='<article class="assign-agent-card '+(isUnassignedActive?'active':'')+'" onclick="selectAssignmentTele(\'unassigned\')">'
    +'<span class="assign-active-badge">✓ Filtered</span>'
    +'<div class="assign-agent-head">'
    +'<div class="assign-agent-info">'
    +'<div class="assign-agent-avatar" style="background:#f59e0b;">📋</div>'
    +'<div><div class="assign-agent-name">Unassigned Leads</div><div class="meta">Waiting to be allocated</div></div>'
    +'</div>'
    +'<span class="status" style="color:var(--warn);background:#fffbeb;border:1px solid #fde68a;padding:2px 6px;border-radius:3px;">Unallocated</span>'
    +'</div>'
    +'<div class="assign-agent-total">'
    +'<div><div class="assign-total-num" style="color:var(--warn);">'+(stats.unassigned||0)+'</div><div class="assign-total-lbl">Leads Waiting Assignment</div></div>'
    +'<button class="filter" type="button" style="height:28px;padding:0 10px;font-size:9.5px;color:var(--warn);border-color:var(--warn);background:#fff;">'+(isUnassignedActive?'Viewing':'Assign →')+'</button>'
    +'</div>'
    +'<div style="font-size:11.5px;color:var(--muted);line-height:1.4;background:#fafbfc;border:1px solid var(--soft);border-radius:4px;padding:8px 10px;">'
    +'Select this card to view and bulk-assign waiting leads to your telemarketers.'
    +'</div>'
    +'</article>';

  // 3. Telemarketers cards
  if(!agents.length){
    html+='<div class="empty" style="grid-column:1/-1;">No telemarketers registered yet. <a href="javascript:void(0)" onclick="switchView(\'agents\')">Add telemarketers</a> or import from atap.solar.</div>';
  }else{
    agents.forEach(function(agent){
      var val=agentValue(agent);
      var isActive=(assignState.teleFilter===val||assignState.teleFilter===agent.name||(agent.name&&assignState.teleFilter.toLowerCase()===agent.name.toLowerCase())||(agent.uid&&assignState.teleFilter==='uid:'+agent.uid)||(agent.uid&&assignState.teleFilter===agent.uid));
      var initials=agent.name.split(/\s+/).map(function(w){return w[0]}).slice(0,2).join('').toUpperCase()||'TM';
      var statusBadge=agent.active?'<span class="status completed">Active</span>':'<span class="status" style="color:var(--muted);">Inactive</span>';

      var total=Number(agent.total_assigned)||0;
      var contacted=Number(agent.contacted_count)||0;
      var interested=Number(agent.interested_count)||0;
      var lost=(Number(agent.not_interested_count)||0)+(Number(agent.dnc_count)||0);
      var pending=agent.pending_count!=null?Number(agent.pending_count):Math.max(0,total-(contacted+interested+lost));

      var pPending=total>0?Math.round((pending/total)*100):0;
      var pContacted=total>0?Math.round((contacted/total)*100):0;
      var pInterested=total>0?Math.round((interested/total)*100):0;
      var pLost=total>0?Math.max(0,100-(pPending+pContacted+pInterested)):0;

      html+='<article class="assign-agent-card '+(isActive?'active':'')+' '+(agent.active?'':'inactive')+'" id="assignCard-'+attr(agent.id)+'" data-agent="'+attr(val)+'" onclick="selectAssignmentTele(\''+attr(val)+'\')">'
        +'<span class="assign-active-badge">✓ Filtered</span>'
        +'<div class="assign-agent-head">'
        +'<div class="assign-agent-info">'
        +'<div class="assign-agent-avatar">'+esc(initials)+'</div>'
        +'<div style="min-width:0;"><div class="assign-agent-name" title="'+attr(agent.name)+'">'+esc(agent.name)+'</div>'
        +(agent.phone?'<div class="meta">'+esc(agent.phone)+'</div>':(agent.email?'<div class="meta">'+esc(agent.email)+'</div>':'<div class="meta">Telemarketer</div>'))
        +'</div>'
        +'</div>'
        +statusBadge
        +'</div>'
        +'<div class="assign-agent-total">'
        +'<div><div class="assign-total-num">'+total+'</div><div class="assign-total-lbl">Total Leads Assigned</div></div>'
        +'<button class="primary" type="button" style="height:28px;padding:0 10px;font-size:9.5px;">'+(isActive?'Filtered':'Filter Leads →')+'</button>'
        +'</div>'
        +'<div class="assign-breakdown-row">'
        +'<div class="assign-breakdown-cell"><div class="assign-breakdown-val">'+pending+'</div><div class="assign-breakdown-lbl">To Call</div></div>'
        +'<div class="assign-breakdown-cell"><div class="assign-breakdown-val" style="color:var(--warn);">'+contacted+'</div><div class="assign-breakdown-lbl">Contacted</div></div>'
        +'<div class="assign-breakdown-cell"><div class="assign-breakdown-val" style="color:var(--ok);">'+interested+'</div><div class="assign-breakdown-lbl">Interested</div></div>'
        +'<div class="assign-breakdown-cell"><div class="assign-breakdown-val" style="color:var(--bad);">'+lost+'</div><div class="assign-breakdown-lbl">Lost/DNC</div></div>'
        +'</div>'
        +(total>0?('<div class="assign-progress-bar" title="'+pending+' to call · '+contacted+' contacted · '+interested+' interested · '+lost+' lost">'
          +'<div class="assign-bar-part assign-bar-pending" style="width:'+pPending+'%"></div>'
          +'<div class="assign-bar-part assign-bar-contacted" style="width:'+pContacted+'%"></div>'
          +'<div class="assign-bar-part assign-bar-interested" style="width:'+pInterested+'%"></div>'
          +'<div class="assign-bar-part assign-bar-lost" style="width:'+pLost+'%"></div>'
          +'</div>'):'')
        +'</article>';
    });
  }

  cont.innerHTML=html;
}

function renderAssignTeleSelectors(){
  var filterSelect=el('assignTeleFilter');
  var bulkSelect=el('assignBulkTargetSelect');
  var stats=assignState.stats||{};
  var agents=assignState.agents||[];

  if(filterSelect){
    var cur=assignState.teleFilter||filterSelect.value||'all';
    var opts='<option value="all">👥 All Telemarketers</option>'
      +'<option value="unassigned">📋 Unassigned Leads Only ('+(stats.unassigned||0)+' leads)</option>';
    agents.forEach(function(a){
      var v=agentValue(a);
      var count=(a.total_assigned||0);
      var sel=(cur===v||cur===a.name||(a.name&&cur.toLowerCase()===a.name.toLowerCase())||(a.uid&&cur==='uid:'+a.uid)||(a.uid&&cur===a.uid))?' selected':'';
      opts+='<option value="'+attr(v)+'"'+sel+'>👤 '+esc(a.name)+' ('+count+' leads assigned)</option>';
    });
    filterSelect.innerHTML=opts;
    filterSelect.value=cur;
  }

  if(bulkSelect){
    var bOpts='<option value="">Choose telemarketer...</option>';
    agents.filter(function(a){return a.active}).forEach(function(a){
      bOpts+='<option value="'+attr(agentValue(a))+'">👤 '+esc(agentLabel(a))+'</option>';
    });
    bulkSelect.innerHTML=bOpts;
  }
}

async function selectAssignmentTele(agentVal){
  assignState.teleFilter=agentVal;
  assignState.page=0;
  var sel=el('assignTeleFilter');
  if(sel)sel.value=agentVal;
  renderAssignTelemarketerCards();
  await loadAssignmentLeads();
}

async function onAssignTeleFilterChange(){
  var sel=el('assignTeleFilter');
  if(!sel)return;
  assignState.teleFilter=sel.value;
  assignState.page=0;
  renderAssignTelemarketerCards();
  await loadAssignmentLeads();
}

async function applyAssignmentFilter(){
  var sInput=el('assignSearchInput');
  assignState.search=sInput?sInput.value.trim():'';
  assignState.page=0;
  await loadAssignmentLeads();
}

async function setAssignmentStatusFilter(status){
  assignState.statusFilter=status;
  assignState.page=0;
  document.querySelectorAll('[data-assign-status]').forEach(function(node){
    node.classList.toggle('active',node.getAttribute('data-assign-status')===status);
  });
  await loadAssignmentLeads();
}

async function loadAssignmentLeads(){
  if(!state.token)return;
  var wrapper=el('assignmentLeadsWrapper');
  if(!wrapper)return;
  wrapper.innerHTML='<div class="empty">Loading assigned leads…</div>';

  var q='/api/leads?limit='+assignState.limit+'&offset='+(assignState.page*assignState.limit);
  if(assignState.statusFilter!=='all')q+='&status='+encodeURIComponent(assignState.statusFilter);
  if(assignState.search)q+='&search='+encodeURIComponent(assignState.search);
  if(assignState.teleFilter!=='all')q+='&assignedTo='+encodeURIComponent(assignState.teleFilter);

  try{
    var body=await api(q);
    assignState.leads=body.leads||[];
    assignState.total=body.total||0;

    renderAssignActiveBanner();
    renderAssignStatusCounts(body.stats||{});
    renderAssignmentLeads(body.leads||[]);
    renderAssignPagination(body.total||0);
  }catch(err){
    wrapper.innerHTML='<div class="empty error">'+esc(err.message)+'</div>';
    if(!authLost(err))showToast(err.message);
  }
}

function renderAssignActiveBanner(){
  var banner=el('assignActiveBanner');
  var bTitle=el('assignBannerTitle');
  var bSub=el('assignBannerSubtitle');
  if(!banner)return;

  var filter=assignState.teleFilter||'all';
  if(filter==='all'){
    banner.classList.add('hidden');
    return;
  }
  banner.classList.remove('hidden');

  if(filter==='unassigned'){
    if(bTitle)bTitle.textContent='📋 Unassigned Leads Pool';
    if(bSub)bSub.textContent='Showing '+assignState.total+' leads waiting to be assigned to a telemarketer.';
    return;
  }

  var agent=assignState.agents.find(function(a){
    return agentValue(a)===filter||a.name===filter||(a.name&&filter.toLowerCase()===a.name.toLowerCase())||(a.uid&&filter==='uid:'+a.uid)||(a.uid&&filter===a.uid)||(a.uid&&filter.replace(/^uid:/,'')===a.uid.replace(/^uid[-:]/,''));
  });

  if(agent){
    var total=agent.total_assigned||0;
    var pending=agent.pending_count!=null?agent.pending_count:Math.max(0,total-((agent.contacted_count||0)+(agent.interested_count||0)+(agent.not_interested_count||0)+(agent.dnc_count||0)));
    if(bTitle)bTitle.textContent='👤 '+agent.name+' · '+total+' Total Leads Assigned';
    if(bSub)bSub.textContent=pending+' pending to call · '+(agent.contacted_count||0)+' contacted · '+(agent.interested_count||0)+' interested · '+((agent.not_interested_count||0)+(agent.dnc_count||0))+' lost/dnc';
  }else{
    if(bTitle)bTitle.textContent='👤 Filter: '+filter+' ('+assignState.total+' leads)';
    if(bSub)bSub.textContent='Showing assigned leads matching current filter.';
  }
}

function renderAssignStatusCounts(stats){
  var cAll=el('assignCountAll');
  var cAssigned=el('assignCountAssigned');
  var cContacted=el('assignCountContacted');
  var cInterested=el('assignCountInterested');
  var cNot=el('assignCountNotInterested');
  var cDnc=el('assignCountDnc');

  var filter=assignState.teleFilter||'all';
  var agent=(filter!=='all'&&filter!=='unassigned')?assignState.agents.find(function(a){
    return agentValue(a)===filter||a.name===filter||(a.name&&filter.toLowerCase()===a.name.toLowerCase())||(a.uid&&filter==='uid:'+a.uid)||(a.uid&&filter===a.uid)||(a.uid&&filter.replace(/^uid:/,'')===a.uid.replace(/^uid[-:]/,''));
  }):null;

  if(agent){
    var total=agent.total_assigned||0;
    var pending=agent.pending_count!=null?agent.pending_count:Math.max(0,total-((agent.contacted_count||0)+(agent.interested_count||0)+(agent.not_interested_count||0)+(agent.dnc_count||0)));
    if(cAll)cAll.textContent=total;
    if(cAssigned)cAssigned.textContent=pending;
    if(cContacted)cContacted.textContent=agent.contacted_count||0;
    if(cInterested)cInterested.textContent=agent.interested_count||0;
    if(cNot)cNot.textContent=agent.not_interested_count||0;
    if(cDnc)cDnc.textContent=agent.dnc_count||0;
  }else if(filter==='unassigned'){
    if(cAll)cAll.textContent=stats.unassigned||0;
    if(cAssigned)cAssigned.textContent=stats.unassigned||0;
    if(cContacted)cContacted.textContent=0;
    if(cInterested)cInterested.textContent=0;
    if(cNot)cNot.textContent=0;
    if(cDnc)cDnc.textContent=0;
  }else{
    if(cAll)cAll.textContent=stats.total||0;
    if(cAssigned)cAssigned.textContent=stats.assigned||0;
    if(cContacted)cContacted.textContent=stats.contacted||0;
    if(cInterested)cInterested.textContent=stats.interested||0;
    if(cNot)cNot.textContent=stats.not_interested||0;
    if(cDnc)cDnc.textContent=stats.do_not_call||0;
  }
}

function renderAssignmentLeads(leads){
  var wrapper=el('assignmentLeadsWrapper');
  if(!wrapper)return;
  if(!leads.length){
    if(assignState.teleFilter==='unassigned'){
      wrapper.innerHTML='<div class="empty">🎉 No unassigned leads! All leads have been allocated to telemarketers.</div>';
    }else if(assignState.teleFilter!=='all'){
      wrapper.innerHTML='<div class="empty">No leads found for this telemarketer with the current status filter.<br><br><button class="filter" type="button" onclick="selectAssignmentTele(\'unassigned\')">View Unassigned Leads to Allocate →</button></div>';
    }else{
      wrapper.innerHTML='<div class="empty">No leads found matching filter.</div>';
    }
    return;
  }

  wrapper.innerHTML=leads.map(function(lead){
    var checked=Boolean(assignState.selected[lead.id]);
    var phone=lead.phone||'';
    var website=safeUrl(lead.website);
    var maps=safeUrl(lead.maps_url);
    var rating=lead.rating?(' · ★ '+lead.rating+(lead.reviews?' / '+lead.reviews:'')):'';
    var branchBadge=lead.branch_count>0?(' <span class="branch-tag" title="'+lead.branch_count+' branches consolidated">'+lead.branch_count+' branch'+(lead.branch_count>1?'es':'')+'</span>'):'';

    var contactPhones=Number(lead.contact_phones_count)||0;
    var contactDMs=Number(lead.contact_decision_makers_count)||0;
    var hasContact=Boolean(lead.contact_public_id||contactPhones>0||contactDMs>0);
    var contactPill='';
    if(hasContact){
      contactPill='<div class="contact-pill" title="'+contactPhones+' phone route'+(contactPhones===1?'':'s')+' and '+contactDMs+' decision maker'+(contactDMs===1?'':'s')+' identified">📞 <strong>'+contactPhones+' Contact Number'+(contactPhones===1?'':'s')+' Found</strong>'+(contactDMs>0?(' · 👤 '+contactDMs+' Leader'+(contactDMs===1?'':'s')):'')+'</div>';
    }

    var dossierLink=lead.research_public_id?('<a class="vip" target="_blank" rel="noopener" href="/r/'+attr(lead.research_public_id)+'">Dossier V'+(lead.research_version||1)+' ↗</a>'):'';
    var contactLink=lead.contact_public_id?('<a class="vip contact-vip" target="_blank" rel="noopener" href="/r/'+attr(lead.contact_public_id)+'">📞 Contacts ('+contactPhones+' phones) ↗</a>'):'';

    var teleOpts='<option value="">(Unassigned)</option>';
    (assignState.agents||[]).forEach(function(a){
      var value=agentValue(a);
      var sel=((a.uid&&(lead.telemarketer_uid===a.uid||lead.telemarketer_uid==='uid:'+a.uid||lead.assigned_to===a.uid))||(lead.assigned_to&&lead.assigned_to.toLowerCase()===a.name.toLowerCase()))?' selected':'';
      teleOpts+='<option value="'+attr(value)+'"'+sel+'>'+esc(agentLabel(a))+'</option>';
    });

    var statuses=['unassigned','assigned','contacted','interested','not_interested','do_not_call'];
    var statusOpts=statuses.map(function(s){
      var sel=(lead.lead_status===s)?' selected':'';
      var lbl=s==='do_not_call'?'DNC':s.replace('_',' ');
      return '<option value="'+s+'"'+sel+'>'+lbl+'</option>';
    }).join('');

    var notesSnippet=lead.lead_notes?(esc(lead.lead_notes.slice(0,60))+(lead.lead_notes.length>60?'…':'')):'Add notes';

    return '<article class="lead-row '+(hasContact?'has-contact-research':'')+'">'
      +'<div><input type="checkbox" id="assignCheck-'+attr(lead.id)+'" class="lead-check" '+(checked?'checked ':'')+'onchange="toggleAssignSelectLead(\''+attr(lead.id)+'\', this.checked)"></div>'
      +'<div>'
      +'<h3>'+esc(lead.name)+branchBadge+'</h3>'
      +'<div class="meta">'+esc(lead.category||'Business')+esc(rating)+'</div>'
      +'<div class="address" style="margin-top:4px;">'+esc(lead.address||'Address not published')+'</div>'
      +contactPill
      +'</div>'
      +'<div class="company-contact">'
      +'<div class="phone">'+(phone?('<a class="source-link" href="tel:'+attr(phone.replace(/[^+\d]/g,''))+'" style="font-size:13px;">'+esc(phone)+'</a>'):'<span class="meta">No phone</span>')+'</div>'
      +'<div class="actions" style="display:flex;gap:8px;margin-top:4px;">'+(website?('<a class="source-link" target="_blank" rel="noopener" href="'+attr(website)+'">Web</a>'):'')+(maps?('<a class="source-link" target="_blank" rel="noopener" href="'+attr(maps)+'">Maps</a>'):'')+'</div>'
      +'<div style="margin-top:8px;display:flex;flex-direction:column;gap:6px;align-items:flex-start;">'+contactLink+dossierLink+'</div>'
      +'</div>'
      +'<div style="display:grid;gap:8px;">'
      +'<div>'
      +'<label style="display:block;font:700 8px/1 var(--sans);letter-spacing:.1em;text-transform:uppercase;color:var(--muted);margin-bottom:4px;">Assigned to</label>'
      +'<select class="tele-select" onchange="updateAssignLeadAssignee(\''+attr(lead.id)+'\', this)">'+teleOpts+'</select>'
      +'</div>'
      +'<div>'
      +'<label style="display:block;font:700 8px/1 var(--sans);letter-spacing:.1em;text-transform:uppercase;color:var(--muted);margin-bottom:4px;">Status</label>'
      +'<select class="status-select '+attr(lead.lead_status||'unassigned')+'" onchange="updateAssignLeadStatus(\''+attr(lead.id)+'\', this)">'+statusOpts+'</select>'
      +'</div>'
      +'</div>'
      +'<div style="display:grid;gap:6px;align-content:start;">'
      +'<div style="display:flex;gap:6px;align-items:center;">'
      +'<button class="filter" type="button" style="min-height:30px;padding:0 8px;font-size:9px;white-space:nowrap;" data-id="'+attr(lead.id)+'" data-notes="'+attr(lead.lead_notes||'')+'" onclick="promptLeadNotes(this)">📝 '+(lead.lead_notes?'Notes':'+ Note')+'</button>'
      +'</div>'
      +(lead.lead_notes?('<span style="font-size:11px;color:var(--muted);max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="'+attr(lead.lead_notes)+'">'+notesSnippet+'</span>'):'')
      +'</div>'
      +'</article>';
  }).join('');
}

async function updateAssignLeadAssignee(companyId,selectEl){
  var assignee=selectEl.value.trim();
  try{
    await api('/api/leads/'+encodeURIComponent(companyId),{
      method:'PATCH',
      body:JSON.stringify({assignedTo:assignee||null,leadStatus:assignee?'assigned':'unassigned'})
    });
    showToast(assignee?'Assigned to '+assignee:'Lead unassigned');
    await loadAssignmentAgents();
    await loadAssignmentLeads();
  }catch(err){
    if(!authLost(err))showToast('Failed to update assignment: '+err.message);
  }
}

async function updateAssignLeadStatus(companyId,selectEl){
  var status=selectEl.value;
  selectEl.className='status-select '+status;
  try{
    await api('/api/leads/'+encodeURIComponent(companyId),{
      method:'PATCH',
      body:JSON.stringify({leadStatus:status})
    });
    showToast('Status updated to '+status);
    await loadAssignmentAgents();
  }catch(err){
    if(!authLost(err))showToast('Failed to update status: '+err.message);
  }
}

function updateAssignBulkBar(){
  var keys=Object.keys(assignState.selected).filter(function(k){return assignState.selected[k]});
  var bulkBar=el('assignBulkBar');
  var bulkCount=el('assignBulkCount');
  if(bulkBar)bulkBar.classList.toggle('hidden',keys.length===0);
  if(bulkCount)bulkCount.textContent=keys.length;
}

function toggleAssignSelectLead(id,checked){
  assignState.selected[id]=checked;
  updateAssignBulkBar();
}

function toggleAssignSelectAllPage(checked){
  assignState.leads.forEach(function(lead){
    assignState.selected[lead.id]=checked;
    var cb=el('assignCheck-'+lead.id);
    if(cb)cb.checked=checked;
  });
  updateAssignBulkBar();
}

async function bulkAssignFromAssignmentView(){
  var keys=Object.keys(assignState.selected).filter(function(k){return assignState.selected[k]});
  var bulkSelect=el('assignBulkTargetSelect');
  var tele=bulkSelect?bulkSelect.value.trim():'';
  if(!keys.length){showToast('No companies selected.');return}
  if(!tele){showToast('Choose a telemarketer to assign to.');return}
  try{
    var res=await api('/api/leads/assign',{method:'POST',body:JSON.stringify({companyIds:keys,assignedTo:tele})});
    showToast('Assigned '+(res.updated||keys.length)+' companies to '+tele);
    assignState.selected={};
    updateAssignBulkBar();
    var allCb=el('assignSelectAllPage');
    if(allCb)allCb.checked=false;
    await loadAssignmentAgents();
    await loadAssignmentLeads();
  }catch(err){
    if(!authLost(err))showToast('Failed to assign: '+err.message);
  }
}

async function bulkUnassignFromAssignmentView(){
  var keys=Object.keys(assignState.selected).filter(function(k){return assignState.selected[k]});
  if(!keys.length){showToast('No companies selected.');return}
  if(!window.confirm('Unassign '+keys.length+' selected companies?'))return;
  try{
    var res=await api('/api/leads/unassign',{method:'POST',body:JSON.stringify({companyIds:keys})});
    showToast('Unassigned '+(res.updated||keys.length)+' companies');
    assignState.selected={};
    updateAssignBulkBar();
    var allCb=el('assignSelectAllPage');
    if(allCb)allCb.checked=false;
    await loadAssignmentAgents();
    await loadAssignmentLeads();
  }catch(err){
    if(!authLost(err))showToast('Failed to unassign: '+err.message);
  }
}

function prevAssignPage(){
  if(assignState.page>0){
    assignState.page--;
    loadAssignmentLeads();
  }
}

function nextAssignPage(){
  if((assignState.page+1)*assignState.limit<assignState.total){
    assignState.page++;
    loadAssignmentLeads();
  }
}

function renderAssignPagination(total){
  var start=assignState.page*assignState.limit+(total>0?1:0);
  var end=Math.min((assignState.page+1)*assignState.limit,total);
  var pageInfo=el('assignPageInfo');
  var btnPrev=el('btnPrevAssign');
  var btnNext=el('btnNextAssign');
  if(pageInfo)pageInfo.textContent='Showing '+start+'–'+end+' of '+total+' companies';
  if(btnPrev)btnPrev.disabled=assignState.page===0;
  if(btnNext)btnNext.disabled=end>=total;
}

var leadState={leads:[],selected:{},telemarketers:[],statusFilter:'all',search:'',nameKeyword:'',teleFilter:'all',researchFilter:'all',page:0,limit:30,total:0};
async function loadLeadsView(){if(!state.token)return;await loadTelemarketers();await loadLeads()}
async function loadTelemarketers(){try{var body=await api('/api/telemarketers');leadState.telemarketers=(body.agents||[]).filter(function(a){return a.active});renderTelemarketerSelectors()}catch(err){if(!authLost(err))showToast('Failed to load telemarketers: '+err.message)}}
function renderTelemarketerSelectors(){
  var filterSelect=el('leadTeleFilter');
  var bulkSelect=el('bulkAssignSelect');
  var adsFilterSelect=el('adsLeadTeleFilter');
  var adsBulkSelect=el('bulkAdsAssignSelect');
  if(filterSelect){
    var cur=filterSelect.value;
    var opts='<option value="all">All Telemarketers</option><option value="unassigned">Unassigned Only</option>';
    leadState.telemarketers.forEach(function(a){opts+='<option value="'+attr(agentValue(a))+'">'+esc(agentLabel(a))+'</option>'});
    filterSelect.innerHTML=opts;
    filterSelect.value=cur||'all';
  }
  if(bulkSelect){
    var bOpts='<option value="">Choose telemarketer...</option>';
    leadState.telemarketers.forEach(function(a){bOpts+='<option value="'+attr(agentValue(a))+'">'+esc(agentLabel(a))+'</option>'});
    bulkSelect.innerHTML=bOpts;
  }
  if(adsFilterSelect){
    var adsCur=adsFilterSelect.value;
    var adsOpts='<option value="all">All Telemarketers</option><option value="unassigned">Unassigned Only</option>';
    leadState.telemarketers.forEach(function(a){adsOpts+='<option value="'+attr(agentValue(a))+'">'+esc(agentLabel(a))+'</option>'});
    adsFilterSelect.innerHTML=adsOpts;
    adsFilterSelect.value=adsCur||'all';
  }
  if(adsBulkSelect){
    var bAdsOpts='<option value="">Choose telemarketer...</option>';
    leadState.telemarketers.forEach(function(a){bAdsOpts+='<option value="'+attr(agentValue(a))+'">'+esc(agentLabel(a))+'</option>'});
    adsBulkSelect.innerHTML=bAdsOpts;
  }
}

var adsLeadState={
  leads:[],
  selected:{},
  statusFilter:'all',
  search:'',
  teleFilter:'all',
  sourceFilter:'all',
  stateFilter:'all',
  page:0,
  limit:30,
  total:0,
  lastMaxId:0,
  autoRefreshTimer:null
};

function timeAgo(dateVal){
  if(!dateVal)return'';
  try{
    var ms=Date.now()-new Date(dateVal).getTime();
    if(isNaN(ms))return date(dateVal);
    var mins=Math.floor(ms/60000);
    if(mins<1)return'Just now';
    if(mins<60)return mins+'m ago';
    var hrs=Math.floor(mins/60);
    if(hrs<24)return hrs+'h ago';
    var days=Math.floor(hrs/24);
    if(days<7)return days+'d ago';
    return date(dateVal);
  }catch(e){
    return date(dateVal);
  }
}

function toggleAdsAutoRefresh(){
  var btn=el('btnToggleAutoRefresh');
  if(adsLeadState.autoRefreshTimer){
    clearInterval(adsLeadState.autoRefreshTimer);
    adsLeadState.autoRefreshTimer=null;
    if(btn){btn.textContent='▶ Resume';btn.style.background='#fef3c7';}
    showToast('Live stream paused');
  }else{
    adsLeadState.autoRefreshTimer=setInterval(function(){
      var v=el('adsLeadsView');
      if(v&&v.classList.contains('active'))loadAdsLeads(true);
    },15000);
    if(btn){btn.textContent='⏸ Pause';btn.style.background='#fff';}
    showToast('Live stream active (every 15s)');
    loadAdsLeads(true);
  }
}

function dismissAdsAlert(){
  var alertEl=el('adsNewAlert');
  if(alertEl)alertEl.classList.add('hidden');
}

async function loadAdsLeadsView(){
  if(!state.token)return;
  await loadTelemarketers();
  await loadAdsLeads();
  if(!adsLeadState.autoRefreshTimer){
    adsLeadState.autoRefreshTimer=setInterval(function(){
      var v=el('adsLeadsView');
      if(v&&v.classList.contains('active'))loadAdsLeads(true);
    },15000);
  }
}

async function loadAdsLeads(quiet){
  if(!state.token)return;
  var wrapper=el('adsLeadTableWrapper');
  if(!wrapper)return;
  if(!quiet)wrapper.innerHTML='<div class="empty">Loading ads leads…</div>';
  var q='/api/ads-leads?limit='+adsLeadState.limit+'&offset='+(adsLeadState.page*adsLeadState.limit);
  if(adsLeadState.statusFilter!=='all')q+='&status='+encodeURIComponent(adsLeadState.statusFilter);
  if(adsLeadState.search)q+='&search='+encodeURIComponent(adsLeadState.search);
  if(adsLeadState.teleFilter!=='all')q+='&assignedTo='+encodeURIComponent(adsLeadState.teleFilter);
  if(adsLeadState.sourceFilter!=='all')q+='&source='+encodeURIComponent(adsLeadState.sourceFilter);
  if(adsLeadState.stateFilter!=='all')q+='&state='+encodeURIComponent(adsLeadState.stateFilter);

  try{
    var body=await api(q);
    var newLeads=body.leads||[];

    if(newLeads.length){
      var maxId=Math.max.apply(null,newLeads.map(function(l){return l.id||0}));
      if(adsLeadState.lastMaxId && maxId>adsLeadState.lastMaxId){
        var fresh=newLeads.filter(function(l){return l.id>adsLeadState.lastMaxId});
        if(fresh.length){
          var alertEl=el('adsNewAlert');
          var alertTxt=el('adsNewAlertText');
          if(alertEl&&alertTxt){
            alertTxt.textContent='🔔 '+fresh.length+' new incoming registration'+(fresh.length===1?'':'s')+' received: '+(fresh[0].full_name||fresh[0].lead_id)+' ('+(fresh[0].area||fresh[0].state)+')';
            alertEl.classList.remove('hidden');
          }
          showToast('⚡ '+fresh.length+' new registration(s) received!');
        }
      }
      adsLeadState.lastMaxId=Math.max(adsLeadState.lastMaxId||0,maxId);
    }

    adsLeadState.leads=newLeads;
    adsLeadState.total=body.total||0;
    renderAdsLeadsSummary(body.stats||{});

    var counterBadge=el('adsNewCounter');
    if(counterBadge){
      var unassignedCount=(body.stats&&body.stats.unassigned)||0;
      counterBadge.textContent=unassignedCount+' unassigned incoming';
    }

    renderAdsLeads(newLeads);
    renderAdsLeadsPagination(body.total||0);
  }catch(err){
    if(!quiet&&wrapper)wrapper.innerHTML='<div class="empty error">'+esc(err.message)+'</div>';
    if(!authLost(err)&&!quiet)showToast(err.message);
  }
}

function renderAdsLeadsSummary(stats){
  var sTotal=el('statAdsTotal');
  var sUnassigned=el('statAdsUnassigned');
  var sAssigned=el('statAdsAssigned');
  var sContacted=el('statAdsContacted');
  var sInterested=el('statAdsInterested');
  var sLost=el('statAdsLost');

  if(sTotal)sTotal.textContent=stats.total||0;
  if(sUnassigned)sUnassigned.textContent=stats.unassigned||0;
  if(sAssigned)sAssigned.textContent=stats.assigned||0;
  if(sContacted)sContacted.textContent=stats.contacted||0;
  if(sInterested)sInterested.textContent=stats.interested||0;
  if(sLost)sLost.textContent=(stats.not_interested||0)+(stats.do_not_call||0);

  var cAll=el('countAdsAll');
  var cUn=el('countAdsUnassigned');
  var cAss=el('countAdsAssigned');
  var cCon=el('countAdsContacted');
  var cInt=el('countAdsInterested');
  var cNot=el('countAdsNotInterested');
  var cDnc=el('countAdsDnc');
  var cHid=el('countAdsHidden');

  if(cAll)cAll.textContent=stats.total||0;
  if(cUn)cUn.textContent=stats.unassigned||0;
  if(cAss)cAss.textContent=stats.assigned||0;
  if(cCon)cCon.textContent=stats.contacted||0;
  if(cInt)cInt.textContent=stats.interested||0;
  if(cNot)cNot.textContent=stats.not_interested||0;
  if(cDnc)cDnc.textContent=stats.do_not_call||0;
  if(cHid)cHid.textContent=stats.hidden||0;
}

function setAdsLeadStatusFilter(status){
  adsLeadState.statusFilter=status;
  adsLeadState.page=0;
  document.querySelectorAll('[data-ads-status]').forEach(function(node){
    node.classList.toggle('active',node.getAttribute('data-ads-status')===status);
  });
  loadAdsLeads();
}

function applyAdsLeadFilter(){
  var searchInput=el('adsLeadSearch');
  var teleSelect=el('adsLeadTeleFilter');
  var stateSelect=el('adsLeadStateFilter');
  var sourceSelect=el('adsLeadSourceFilter');
  adsLeadState.search=searchInput?searchInput.value.trim():'';
  adsLeadState.teleFilter=teleSelect?teleSelect.value:'all';
  adsLeadState.stateFilter=stateSelect?stateSelect.value:'all';
  adsLeadState.sourceFilter=sourceSelect?sourceSelect.value:'all';
  adsLeadState.page=0;
  loadAdsLeads();
}

function prevAdsLeadsPage(){
  if(adsLeadState.page>0){
    adsLeadState.page--;
    loadAdsLeads();
  }
}

function nextAdsLeadsPage(){
  if((adsLeadState.page+1)*adsLeadState.limit<adsLeadState.total){
    adsLeadState.page++;
    loadAdsLeads();
  }
}

function renderAdsLeadsPagination(total){
  var start=adsLeadState.page*adsLeadState.limit+(total>0?1:0);
  var end=Math.min((adsLeadState.page+1)*adsLeadState.limit,total);
  var pageInfo=el('adsPageInfo');
  var btnPrev=el('btnPrevAdsLeads');
  var btnNext=el('btnNextAdsLeads');
  if(pageInfo)pageInfo.textContent='Showing '+start+'–'+end+' of '+total+' inquiries';
  if(btnPrev)btnPrev.disabled=adsLeadState.page===0;
  if(btnNext)btnNext.disabled=end>=total;
}

function updateAdsBulkBar(){
  var keys=Object.keys(adsLeadState.selected).filter(function(k){return adsLeadState.selected[k]});
  var bulkBar=el('bulkAdsBar');
  var bulkCount=el('bulkAdsCount');
  if(bulkBar)bulkBar.classList.toggle('hidden',keys.length===0);
  if(bulkCount)bulkCount.textContent=keys.length;
}

function toggleSelectAdsLead(id,checked){
  adsLeadState.selected[id]=checked;
  updateAdsBulkBar();
}

function toggleSelectAllAdsPage(checked){
  adsLeadState.leads.forEach(function(lead){
    adsLeadState.selected[lead.id]=checked;
    var cb=el('adsLeadCheck-'+lead.id);
    if(cb)cb.checked=checked;
  });
  updateAdsBulkBar();
}

async function bulkAssignAdsSelected(){
  var keys=Object.keys(adsLeadState.selected).filter(function(k){return adsLeadState.selected[k]}).map(Number);
  var bulkSelect=el('bulkAdsAssignSelect');
  var tele=bulkSelect?bulkSelect.value.trim():'';
  if(!keys.length){showToast('No leads selected.');return}
  if(!tele){showToast('Choose a telemarketer to assign to.');return}
  try{
    var res=await api('/api/ads-leads/assign',{method:'POST',body:JSON.stringify({ids:keys,assignedTo:tele})});
    showToast('Assigned '+(res.updated||keys.length)+' leads to '+tele);
    adsLeadState.selected={};
    updateAdsBulkBar();
    var allCb=el('selectAllAdsPage');
    if(allCb)allCb.checked=false;
    await loadAdsLeads();
  }catch(err){
    if(!authLost(err))showToast('Failed to assign: '+err.message);
  }
}

async function bulkUnassignAdsSelected(){
  var keys=Object.keys(adsLeadState.selected).filter(function(k){return adsLeadState.selected[k]}).map(Number);
  if(!keys.length){showToast('No leads selected.');return}
  if(!window.confirm('Unassign '+keys.length+' selected leads?'))return;
  try{
    var res=await api('/api/ads-leads/unassign',{method:'POST',body:JSON.stringify({ids:keys})});
    showToast('Unassigned '+(res.updated||keys.length)+' leads');
    adsLeadState.selected={};
    updateAdsBulkBar();
    var allCb=el('selectAllAdsPage');
    if(allCb)allCb.checked=false;
    await loadAdsLeads();
  }catch(err){
    if(!authLost(err))showToast('Failed to unassign: '+err.message);
  }
}

async function bulkHideAdsSelected(hide){
  var keys=Object.keys(adsLeadState.selected).filter(function(k){return adsLeadState.selected[k]}).map(Number);
  if(!keys.length){showToast('No leads selected.');return}
  var actionName=hide?'Hide':'Unhide';
  if(!window.confirm(actionName+' '+keys.length+' selected leads?'))return;
  try{
    var res=await api('/api/ads-leads/hide',{method:'POST',body:JSON.stringify({ids:keys,hide:hide})});
    showToast((hide?'Hidden ':'Restored ')+(res.updated||keys.length)+' leads');
    adsLeadState.selected={};
    updateAdsBulkBar();
    var allCb=el('selectAllAdsPage');
    if(allCb)allCb.checked=false;
    await loadAdsLeads();
  }catch(err){
    if(!authLost(err))showToast('Failed to update leads: '+err.message);
  }
}

async function toggleHideAdsLead(id,hide){
  try{
    await api('/api/ads-leads/'+encodeURIComponent(id),{method:'PATCH',body:JSON.stringify({isHidden:hide})});
    showToast(hide?'Lead hidden':'Lead restored to active list');
    await loadAdsLeads();
  }catch(err){
    if(!authLost(err))showToast('Failed to update lead: '+err.message);
  }
}

async function updateAdsLeadStatus(id,selectEl){
  var status=selectEl.value;
  selectEl.className='status-select '+status;
  try{
    await api('/api/ads-leads/'+encodeURIComponent(id),{method:'PATCH',body:JSON.stringify({leadStatus:status})});
    showToast('Status updated to '+status);
  }catch(err){
    if(!authLost(err))showToast('Failed to update status: '+err.message);
  }
}

async function updateAdsLeadAssignee(id,selectEl){
  var assignee=selectEl.value.trim();
  try{
    await api('/api/ads-leads/'+encodeURIComponent(id),{method:'PATCH',body:JSON.stringify({assignedTo:assignee||null,leadStatus:assignee?'assigned':'unassigned'})});
    showToast(assignee?'Assigned to '+assignee:'Lead unassigned');
    await loadAdsLeads();
  }catch(err){
    if(!authLost(err))showToast('Failed to update assignment: '+err.message);
  }
}

async function editAdsLeadNotes(id,currentNotes){
  var note=window.prompt('Ads Lead notes / feedback:',currentNotes||'');
  if(note==null)return;
  try{
    await api('/api/ads-leads/'+encodeURIComponent(id),{method:'PATCH',body:JSON.stringify({leadNotes:note.trim()})});
    showToast('Notes saved');
    await loadAdsLeads();
  }catch(err){
    if(!authLost(err))showToast('Failed to save notes: '+err.message);
  }
}

function promptAdsLeadNotes(btn){
  var id=btn.getAttribute('data-id');
  var notes=btn.getAttribute('data-notes')||'';
  return editAdsLeadNotes(id,notes);
}

function viewAdsLeadRawData(id){
  var lead=adsLeadState.leads.find(function(l){return l.id===id});
  if(!lead)return;
  var modal=el('adsRawModal');
  var title=el('adsRawModalTitle');
  var sub=el('adsRawModalSub');
  var content=el('adsRawContent');
  if(title)title.textContent='Raw Tracking & Ingest Data: '+lead.lead_id;
  if(sub)sub.textContent=(lead.full_name||'Applicant')+' · '+lead.area+', '+lead.state+' ('+date(lead.created_at)+')';
  var payload=lead.raw_data||{
    lead_id:lead.lead_id,
    full_name:lead.full_name,
    phone_number:lead.phone_number,
    tnb_account_no:lead.tnb_account_no,
    area:lead.area,
    state:lead.state,
    property_type:lead.property_type,
    monthly_bill:lead.monthly_bill,
    email:lead.email,
    roof_type:lead.roof_type,
    system_size:lead.system_size,
    estimated_savings:lead.estimated_savings,
    source:lead.source,
    utm_source:lead.utm_source,
    utm_medium:lead.utm_medium,
    utm_campaign:lead.utm_campaign,
    created_at:lead.created_at
  };
  if(content)content.textContent=JSON.stringify(payload,null,2);
  if(modal)modal.classList.remove('hidden');
}

function closeAdsRawModal(){
  var modal=el('adsRawModal');
  if(modal)modal.classList.add('hidden');
}

function exportAdsLeadsCsv(){
  var q='/api/ads-leads/export?token='+encodeURIComponent(state.token);
  if(adsLeadState.statusFilter!=='all')q+='&status='+encodeURIComponent(adsLeadState.statusFilter);
  if(adsLeadState.search)q+='&search='+encodeURIComponent(adsLeadState.search);
  if(adsLeadState.teleFilter!=='all')q+='&assignedTo='+encodeURIComponent(adsLeadState.teleFilter);
  if(adsLeadState.sourceFilter!=='all')q+='&source='+encodeURIComponent(adsLeadState.sourceFilter);
  if(adsLeadState.stateFilter!=='all')q+='&state='+encodeURIComponent(adsLeadState.stateFilter);
  window.open(q,'_blank');
}

function renderAdsLeads(leads){
  var wrapper=el('adsLeadTableWrapper');
  if(!wrapper)return;
  if(!leads.length){
    wrapper.innerHTML='<div class="empty">No ads or form submission leads found matching the filter.</div>';
    return;
  }
  wrapper.innerHTML=leads.map(function(lead){
    var checked=Boolean(adsLeadState.selected[lead.id]);
    var phone=lead.phone_number||'';
    var waDigits=phone.replace(/\D/g,'');
    if(waDigits.startsWith('0'))waDigits='60'+waDigits.slice(1);

    var custName=lead.full_name||'Tuan/Puan';
    var loc=lead.area?(lead.area+(lead.state?(', '+lead.state):'')):(lead.state||'Malaysia');
    var billPart=lead.monthly_bill!=null?(' (anggaran bil RM '+lead.monthly_bill+'/bln)'):'';
    var sizePart=lead.system_size?(' dan saiz sistem '+lead.system_size):'';
    var waMsg='Hi '+custName+', saya dari Atap Solar berkenaan pendaftaran kalkulator solar anda untuk premis di '+loc+billPart+'. Adakah ini masa yang sesuai untuk kami terangkan anggaran penjimatan'+sizePart+'?';
    var waHref=waDigits?'https://wa.me/'+waDigits+'?text='+encodeURIComponent(waMsg):'';

    var isHidden=Boolean(lead.is_hidden||adsLeadState.statusFilter==='hidden');
    var isRecent=false;
    if(lead.created_at){
      var createdMs=new Date(lead.created_at).getTime();
      if(!isNaN(createdMs)&&(Date.now()-createdMs)<24*3600*1000){
        isRecent=true;
      }
    }
    var recentPill=isRecent?'<span class="new-incoming-pill">⚡ NEW INCOMING</span>':'';
    var timeAgoText=lead.created_at?(' ('+timeAgo(lead.created_at)+')'):'';

    var teleOpts='<option value="">(Unassigned)</option>';
    leadState.telemarketers.forEach(function(a){
      var value=agentValue(a);
      var sel=(a.uid?lead.telemarketer_uid===a.uid:(lead.assigned_to&&lead.assigned_to.toLowerCase()===a.name.toLowerCase()))?' selected':'';
      teleOpts+='<option value="'+attr(value)+'"'+sel+'>'+esc(agentLabel(a))+'</option>';
    });

    var statuses=['unassigned','assigned','contacted','interested','not_interested','do_not_call'];
    var statusOpts=statuses.map(function(s){
      var sel=(lead.lead_status===s)?' selected':'';
      var lbl=s==='do_not_call'?'DNC':s.replace('_',' ');
      return '<option value="'+s+'"'+sel+'>'+lbl+'</option>';
    }).join('');

    var billTag=lead.monthly_bill!=null?('⚡ Bill: <strong>RM '+Number(lead.monthly_bill).toFixed(2)+'</strong>'):'';
    var systemTag=lead.system_size?(' · Size: <strong>'+esc(lead.system_size)+'</strong>'):'';
    var savingsTag=lead.estimated_savings?(' · Est: '+esc(lead.estimated_savings)):'';
    var roofTag=lead.roof_type?(' · Roof: '+esc(lead.roof_type)):'';
    var propTag=lead.property_type?(' <span style="font-size:11px;color:var(--muted);background:#f3f4f6;padding:1px 5px;border-radius:3px;">'+esc(lead.property_type)+'</span>'):'';

    var utmSummary=[];
    if(lead.source)utmSummary.push(lead.source);
    if(lead.utm_campaign)utmSummary.push(lead.utm_campaign);
    else if(lead.utm_source)utmSummary.push(lead.utm_source);
    var utmText=utmSummary.length?'['+utmSummary.join(' · ')+']':'';

    var notesSnippet=lead.lead_notes?(esc(lead.lead_notes.slice(0,60))+(lead.lead_notes.length>60?'…':'')):'Add notes';
    var hideBtn=isHidden?'<button class="filter" type="button" style="min-height:30px;padding:0 8px;font-size:9px;white-space:nowrap;border-color:var(--ok);color:var(--ok);background:#ecfdf5;" title="Restore lead to active list" onclick="toggleHideAdsLead('+lead.id+', false)">👁️ Unhide</button>':'<button class="filter" type="button" style="min-height:30px;padding:0 8px;font-size:9px;white-space:nowrap;color:var(--muted);" title="Hide lead from master list" onclick="toggleHideAdsLead('+lead.id+', true)">🚫 Hide</button>';

    return '<article class="lead-row '+(isHidden?'is-hidden':'')+'">'
      +'<div><input type="checkbox" id="adsLeadCheck-'+attr(lead.id)+'" class="lead-check" '+(checked?'checked ':'')+'onchange="toggleSelectAdsLead('+lead.id+', this.checked)"></div>'
      +'<div>'
      +'<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">'
      +'<h3 style="margin:0;">'+esc(lead.full_name||'Anonymous Applicant')+'</h3>'
      +'<span style="font:700 10.5px/1 var(--mono);background:#e0e7ff;color:var(--accent);padding:2px 6px;border-radius:3px;">'+esc(lead.lead_id)+'</span>'
      +recentPill
      +propTag
      +'</div>'
      +'<div class="meta" style="margin-top:4px;">'+esc(lead.area||'Area not specified')+(lead.state?(', '+esc(lead.state)):'')+'</div>'
      +'<div class="contact-pill" style="margin-top:6px;background:#ecfdf5;border-color:#a7f3d0;color:#065f46;">'
      +billTag+systemTag+savingsTag+roofTag
      +'</div>'
      +(lead.tnb_account_no?('<div style="font:500 11px/1 var(--mono);color:var(--muted);margin-top:4px;">TNB Acc: <strong>'+esc(lead.tnb_account_no)+'</strong></div>'):'')
      +'</div>'
      +'<div class="company-contact">'
      +'<div class="phone">'+(phone?('<a class="source-link" href="tel:'+attr(phone.replace(/[^+\d]/g,''))+'" style="font-size:13px;font-weight:600;">'+esc(phone)+'</a>'):'<span class="meta">No phone</span>')+'</div>'
      +(lead.email?('<div style="margin-top:2px;"><a class="source-link" href="mailto:'+attr(lead.email)+'" style="font-size:11.5px;color:var(--muted);">'+esc(lead.email)+'</a></div>'):'')
      +'<div class="actions" style="display:flex;gap:6px;margin-top:6px;align-items:center;flex-wrap:wrap;">'
      +(phone?('<a class="contact-action-btn call-btn" href="tel:'+attr(phone.replace(/[^+\d]/g,''))+'">Call</a>'):'')
      +(waHref?('<a class="contact-action-btn wa-btn" target="_blank" rel="noopener" href="'+attr(waHref)+'">WhatsApp</a>'):'')
      +'<button class="filter" type="button" style="min-height:26px;padding:0 8px;font-size:8.5px;" onclick="viewAdsLeadRawData('+lead.id+')">🔍 Raw Payload</button>'
      +'</div>'
      +(utmText?('<div style="font:600 10px/1 var(--mono);color:var(--accent);margin-top:6px;">'+esc(utmText)+'</div>'):'')
      +'<div style="font:500 10.5px/1 var(--mono);color:var(--faint);margin-top:2px;">Submitted: '+date(lead.created_at)+timeAgoText+'</div>'
      +'</div>'
      +'<div style="display:grid;gap:8px;">'
      +'<div>'
      +'<label style="display:block;font:700 8px/1 var(--sans);letter-spacing:.1em;text-transform:uppercase;color:var(--muted);margin-bottom:4px;">Assigned to</label>'
      +'<select class="tele-select" onchange="updateAdsLeadAssignee('+lead.id+', this)">'+teleOpts+'</select>'
      +'</div>'
      +'<div>'
      +'<label style="display:block;font:700 8px/1 var(--sans);letter-spacing:.1em;text-transform:uppercase;color:var(--muted);margin-bottom:4px;">Status</label>'
      +'<select class="status-select '+attr(lead.lead_status||'unassigned')+'" onchange="updateAdsLeadStatus('+lead.id+', this)">'+statusOpts+'</select>'
      +'</div>'
      +'</div>'
      +'<div style="display:grid;gap:6px;align-content:start;">'
      +'<div style="display:flex;gap:6px;align-items:center;">'
      +'<button class="filter" type="button" style="min-height:30px;padding:0 8px;font-size:9px;white-space:nowrap;" data-id="'+lead.id+'" data-notes="'+attr(lead.lead_notes||'')+'" onclick="promptAdsLeadNotes(this)">📝 '+(lead.lead_notes?'Notes':'+ Note')+'</button>'
      +hideBtn
      +'</div>'
      +(lead.lead_notes?('<span style="font-size:11px;color:var(--muted);max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="'+attr(lead.lead_notes)+'">'+notesSnippet+'</span>'):'')
      +'</div>'
      +'</article>';
  }).join('');
}
async function loadLeads(){if(!state.token)return;var wrapper=el('leadTableWrapper');if(!wrapper)return;var q='/api/leads?limit='+leadState.limit+'&offset='+(leadState.page*leadState.limit);if(leadState.statusFilter!=='all')q+='&status='+encodeURIComponent(leadState.statusFilter);if(leadState.search)q+='&search='+encodeURIComponent(leadState.search);if(leadState.nameKeyword)q+='&nameKeyword='+encodeURIComponent(leadState.nameKeyword);if(leadState.teleFilter!=='all')q+='&assignedTo='+encodeURIComponent(leadState.teleFilter);if(leadState.researchFilter!=='all')q+='&researchStatus='+encodeURIComponent(leadState.researchFilter);wrapper.innerHTML='<div class="empty">Loading company master list…</div>';try{var body=await api(q);leadState.leads=body.leads||[];leadState.total=body.total||0;renderLeadsSummary(body.stats||{});renderLeads(body.leads||[]);renderLeadsPagination(body.total||0)}catch(err){wrapper.innerHTML='<div class="empty error">'+esc(err.message)+'</div>';if(!authLost(err))showToast(err.message)}}
function renderLeadsSummary(stats){var sTotal=el('statTotal');var sUnassigned=el('statUnassigned');var sAssigned=el('statAssigned');var sContacted=el('statContacted');var sContacts=el('statContacts');var sHidden=el('statHidden');if(sTotal)sTotal.textContent=stats.total||0;if(sUnassigned)sUnassigned.textContent=stats.unassigned||0;if(sAssigned)sAssigned.textContent=stats.assigned||0;if(sContacted)sContacted.textContent=(stats.contacted||0)+(stats.interested||0);if(sContacts)sContacts.textContent=stats.contacts_found||0;var sDeep=el('statDeepResearched');if(sDeep)sDeep.textContent=stats.deep_researched||0;if(sHidden)sHidden.textContent=stats.hidden||0;var cAll=el('countAll');var cUn=el('countUnassigned');var cAss=el('countAssigned');var cCon=el('countContacted');var cInt=el('countInterested');var cNot=el('countNotInterested');var cDnc=el('countDnc');var cHid=el('countHidden');if(cAll)cAll.textContent=stats.total||0;if(cUn)cUn.textContent=stats.unassigned||0;if(cAss)cAss.textContent=stats.assigned||0;if(cCon)cCon.textContent=stats.contacted||0;if(cInt)cInt.textContent=stats.interested||0;if(cNot)cNot.textContent=stats.not_interested||0;if(cDnc)cDnc.textContent=stats.do_not_call||0;if(cHid)cHid.textContent=stats.hidden||0}
function setLeadStatusFilter(status){leadState.statusFilter=status;leadState.page=0;document.querySelectorAll('[data-lead-status]').forEach(function(node){node.classList.toggle('active',node.getAttribute('data-lead-status')===status)});loadLeads()}
function setLeadResearchFilter(value){var researchSelect=el('leadResearchFilter');if(researchSelect)researchSelect.value=value;applyLeadFilter()}
function applyLeadFilter(){var searchInput=el('leadSearch');var teleSelect=el('leadTeleFilter');var researchSelect=el('leadResearchFilter');leadState.search=searchInput?searchInput.value.trim():'';leadState.teleFilter=teleSelect?teleSelect.value:'all';leadState.researchFilter=researchSelect?researchSelect.value:'all';leadState.page=0;loadLeads()}
function prevLeadsPage(){if(leadState.page>0){leadState.page--;loadLeads()}}
function nextLeadsPage(){if((leadState.page+1)*leadState.limit<leadState.total){leadState.page++;loadLeads()}}
function renderLeadsPagination(total){var start=leadState.page*leadState.limit+(total>0?1:0);var end=Math.min((leadState.page+1)*leadState.limit,total);var pageInfo=el('pageInfo');var btnPrev=el('btnPrevLeads');var btnNext=el('btnNextLeads');if(pageInfo)pageInfo.textContent='Showing '+start+'–'+end+' of '+total+' companies';if(btnPrev)btnPrev.disabled=leadState.page===0;if(btnNext)btnNext.disabled=end>=total}
function updateBulkBar(){var keys=Object.keys(leadState.selected).filter(function(k){return leadState.selected[k]});var bulkBar=el('bulkBar');var bulkCount=el('bulkCount');if(bulkBar)bulkBar.classList.toggle('hidden',keys.length===0);if(bulkCount)bulkCount.textContent=keys.length}
function toggleSelectLead(id,checked){leadState.selected[id]=checked;updateBulkBar()}
function toggleSelectAllPage(checked){leadState.leads.forEach(function(lead){leadState.selected[lead.id]=checked;var cb=el('leadCheck-'+lead.id);if(cb)cb.checked=checked});updateBulkBar()}
async function bulkAssignSelected(){var keys=Object.keys(leadState.selected).filter(function(k){return leadState.selected[k]});var bulkSelect=el('bulkAssignSelect');var tele=bulkSelect?bulkSelect.value.trim():'';if(!keys.length){showToast('No companies selected.');return}if(!tele){showToast('Choose a telemarketer to assign to.');return}try{var res=await api('/api/leads/assign',{method:'POST',body:JSON.stringify({companyIds:keys,assignedTo:tele})});showToast('Assigned '+(res.updated||keys.length)+' companies to '+tele);leadState.selected={};updateBulkBar();var allCb=el('selectAllPage');if(allCb)allCb.checked=false;await loadLeads()}catch(err){if(!authLost(err))showToast('Failed to assign: '+err.message)}}
async function bulkUnassignSelected(){var keys=Object.keys(leadState.selected).filter(function(k){return leadState.selected[k]});if(!keys.length){showToast('No companies selected.');return}if(!window.confirm('Unassign '+keys.length+' selected companies?'))return;try{var res=await api('/api/leads/unassign',{method:'POST',body:JSON.stringify({companyIds:keys})});showToast('Unassigned '+(res.updated||keys.length)+' companies');leadState.selected={};updateBulkBar();var allCb=el('selectAllPage');if(allCb)allCb.checked=false;await loadLeads()}catch(err){if(!authLost(err))showToast('Failed to unassign: '+err.message)}}
async function toggleHideLead(companyId,hide){try{await api('/api/leads/'+encodeURIComponent(companyId),{method:'PATCH',body:JSON.stringify({isHidden:hide})});showToast(hide?'Company marked as hidden':'Company restored to active list');await loadLeads()}catch(err){if(!authLost(err))showToast('Failed to update lead: '+err.message)}}
async function bulkHideSelected(hide){var keys=Object.keys(leadState.selected).filter(function(k){return leadState.selected[k]});if(!keys.length){showToast('No companies selected.');return}var actionName=hide?'Hide':'Unhide';if(!window.confirm(actionName+' '+keys.length+' selected companies?'))return;try{var res=await api('/api/leads/hide',{method:'POST',body:JSON.stringify({companyIds:keys,hide:hide})});showToast((hide?'Hidden ':'Restored ')+(res.updated||keys.length)+' companies');leadState.selected={};updateBulkBar();var allCb=el('selectAllPage');if(allCb)allCb.checked=false;await loadLeads()}catch(err){if(!authLost(err))showToast('Failed to update companies: '+err.message)}}
var keywordRuleState={preview:null};
function clearKeywordPreview(){keywordRuleState.preview=null;var result=el('keywordRuleResult');if(result)result.textContent='';var apply=el('btnApplyKeywordRule');if(apply)apply.disabled=true}
function keywordRuleChanged(){clearKeywordPreview();if(leadState.nameKeyword){leadState.nameKeyword='';leadState.page=0;loadLeads()}}
async function previewKeywordRule(){var input=el('keywordRuleInput');var keyword=input?input.value.trim():'';if(keyword.length<3){showToast('Enter at least 3 characters.');return}try{var res=await api('/api/leads/keyword-status/preview?keyword='+encodeURIComponent(keyword));keywordRuleState.preview=res;leadState.nameKeyword=keyword;leadState.page=0;loadLeads();var result=el('keywordRuleResult');if(result){var names=(res.sample||[]).map(function(n){return esc(n)}).join(', ');result.innerHTML='<strong>'+res.count+'</strong> companies match "'+esc(keyword)+'"'+(names?' &middot; e.g. '+names:'')}var apply=el('btnApplyKeywordRule');if(apply)apply.disabled=!res.count}catch(err){if(!authLost(err))showToast('Preview failed: '+err.message)}}
async function applyKeywordRule(){var input=el('keywordRuleInput');var keyword=input?input.value.trim():'';var preview=keywordRuleState.preview;if(!preview||preview.keyword!==keyword){showToast('Preview the matches before applying.');return}var select=el('keywordRuleStatus');var status=select?select.value:'do_not_call';var label=select?select.options[select.selectedIndex].text:status;if(!window.confirm('Set '+preview.count+' companies whose name contains "'+keyword+'" to '+label+'? Companies already at that status are left as they are.'))return;try{var res=await api('/api/leads/keyword-status',{method:'POST',body:JSON.stringify({keyword:keyword,leadStatus:status})});showToast('Updated '+res.updated+' companies to '+label);clearKeywordPreview();await loadLeads()}catch(err){if(!authLost(err))showToast('Failed to apply keyword rule: '+err.message)}}
async function updateLeadStatus(companyId,selectEl){var status=selectEl.value;selectEl.className='status-select '+status;try{await api('/api/leads/'+encodeURIComponent(companyId),{method:'PATCH',body:JSON.stringify({leadStatus:status})});showToast('Status updated to '+status)}catch(err){if(!authLost(err))showToast('Failed to update status: '+err.message)}}
async function updateLeadAssignee(companyId,selectEl){var assignee=selectEl.value.trim();try{await api('/api/leads/'+encodeURIComponent(companyId),{method:'PATCH',body:JSON.stringify({assignedTo:assignee||null,leadStatus:assignee?'assigned':'unassigned'})});showToast(assignee?'Assigned to '+assignee:'Lead unassigned');await loadLeads()}catch(err){if(!authLost(err))showToast('Failed to update assignment: '+err.message)}}
async function editLeadNotes(companyId,currentNotes){var note=window.prompt('Lead notes / telemarketer feedback:',currentNotes||'');if(note==null)return;try{await api('/api/leads/'+encodeURIComponent(companyId),{method:'PATCH',body:JSON.stringify({notes:note.trim()})});showToast('Notes saved');await loadLeads()}catch(err){if(!authLost(err))showToast('Failed to save notes: '+err.message)}}
function promptLeadNotes(btn){var id=btn.getAttribute('data-id');var notes=btn.getAttribute('data-notes')||'';return editLeadNotes(id,notes)}
function promptAddTelemarketer(){switchView('agents');toggleCreateAgentForm(true)}
var emailState={search:'',source:'all',page:0,limit:50,total:0}
function loadEmailView(){if(!state.token)return;loadEmailList(false)}
async function loadEmailList(fresh){var cont=el('emailContainer');if(cont)cont.innerHTML='<div class="empty">Loading email list…</div>';var q='/api/contacts/emails?limit='+emailState.limit+'&offset='+(emailState.page*emailState.limit)+'&source='+encodeURIComponent(emailState.source);if(emailState.search)q+='&search='+encodeURIComponent(emailState.search);if(fresh)q+='&fresh=1';try{var res=await api(q);emailState.total=res.total||0;var st=res.stats||{};el('statEmailDistinct').textContent=(st.distinctEmails||0).toLocaleString();el('statEmailCompanies').textContent=(st.companies||0).toLocaleString();el('statEmailPerson').textContent=(st.withPerson||0).toLocaleString();el('statEmailResearch').textContent=(st.research||0).toLocaleString();el('statEmailWebsite').textContent=(st.website||0).toLocaleString();renderEmailRows(res.rows||[]);var start=emailState.total?emailState.page*emailState.limit+1:0;var end=Math.min((emailState.page+1)*emailState.limit,emailState.total);el('emailPageInfo').textContent='Showing '+start+'–'+end+' of '+emailState.total.toLocaleString()+' emails';el('btnPrevEmail').disabled=emailState.page===0;el('btnNextEmail').disabled=end>=emailState.total}catch(err){if(authLost(err))return;if(cont)cont.innerHTML='<div class="empty error">'+esc(err.message)+'</div>'}}
function renderEmailRows(rows){var cont=el('emailContainer');if(!rows.length){cont.innerHTML='<div class="empty">No emails match.</div>';return}cont.innerHTML='<table class="contact-person-table"><thead><tr><th>Email</th><th>Company</th><th>Person</th><th>Source</th><th>Lead status</th></tr></thead><tbody>'+rows.map(function(r){var src=safeUrl(r.source_url);var person=r.person_name?esc(r.person_name)+(r.person_role?'<div class="person-note">'+esc(r.person_role)+'</div>':''):'<span class="person-note">—</span>';return '<tr><td><a href="mailto:'+attr(r.email)+'">'+esc(r.email)+'</a></td><td>'+esc(r.company_name)+(r.category?'<div class="person-note">'+esc(r.category)+'</div>':'')+'</td><td>'+person+'</td><td>'+esc(r.sources.join(' + '))+(src?' <a class="person-note" target="_blank" rel="noopener" href="'+attr(src)+'">page ↗</a>':'')+'</td><td>'+esc(r.lead_status||'')+(r.assigned_to?'<div class="person-note">'+esc(r.assigned_to)+'</div>':'')+'</td></tr>'}).join('')+'</tbody></table>'}
function applyEmailFilter(){emailState.search=el('emailSearch').value.trim();emailState.source=el('emailSourceFilter').value;emailState.page=0;loadEmailList(false)}
function emailPage(step){var next=emailState.page+step;if(next<0||next*emailState.limit>=emailState.total)return;emailState.page=next;loadEmailList(false)}
function exportEmailCsv(){var q='/api/contacts/emails/export?token='+encodeURIComponent(state.token)+'&source='+encodeURIComponent(emailState.source);if(emailState.search)q+='&search='+encodeURIComponent(emailState.search);window.open(q,'_blank')}
var contactsState={groups:[],telemarketers:[],search:'',typeFilter:'all',teleFilter:'all',page:0,limit:20,total:0,stats:null};
async function loadContactsView(){if(!state.token)return;await loadContactsTelemarketers();await loadContacts()}
async function loadContactsTelemarketers(){try{var body=await api('/api/telemarketers');contactsState.telemarketers=body.telemarketers||[];var sel=el('contactsTeleFilter');if(sel){var cur=sel.value;var opts='<option value="all">All Telemarketers</option>';contactsState.telemarketers.forEach(function(t){opts+='<option value="'+attr(t)+'">'+esc(t)+'</option>'});sel.innerHTML=opts;sel.value=cur||'all'}}catch(err){}}
async function loadContacts(){if(!state.token)return;var cont=el('contactsContainer');if(cont&&!contactsState.groups.length)cont.innerHTML='<div class="empty">Loading contacts master list…</div>';var q='/api/contacts?limit='+contactsState.limit+'&offset='+(contactsState.page*contactsState.limit);if(contactsState.typeFilter!=='all')q+='&filter='+encodeURIComponent(contactsState.typeFilter);if(contactsState.search)q+='&search='+encodeURIComponent(contactsState.search);if(contactsState.teleFilter!=='all')q+='&assignedTo='+encodeURIComponent(contactsState.teleFilter);try{var res=await api(q);contactsState.groups=res.groups||[];contactsState.total=res.totalCompanies||res.total||0;contactsState.stats=res.stats||{};renderContactsSummary(res.stats||{});renderContactsCards(contactsState.groups);renderContactsPagination(contactsState.total)}catch(err){if(cont)cont.innerHTML='<div class="empty error">'+esc(err.message)+'</div>';if(!authLost(err))showToast('Failed to load contacts: '+err.message)}}
function renderContactsSummary(stats){var cEl=el('statContactsTotalCompanies');var dEl=el('statContactsTotalDMs');var pEl=el('statContactsTotalPhones');var mEl=el('statContactsTotalMobile');var eEl=el('statContactsTotalEmails');if(cEl)cEl.textContent=stats.totalCompaniesWithContacts||0;if(dEl)dEl.textContent=stats.totalDecisionMakers||0;if(pEl)pEl.textContent=stats.totalPhones||stats.totalDialablePhones||0;if(mEl)mEl.textContent=stats.totalMobileWhatsapp||stats.totalMobilePhones||0;if(eEl)eEl.textContent=stats.totalEmails||stats.totalDirectEmails||0}
function applyContactsFilter(){var sInput=el('contactsSearch');var tSel=el('contactsTypeFilter');var teleSel=el('contactsTeleFilter');contactsState.search=sInput?sInput.value.trim():'';contactsState.typeFilter=tSel?tSel.value:'all';contactsState.teleFilter=teleSel?teleSel.value:'all';contactsState.page=0;loadContacts()}
function prevContactsPage(){if(contactsState.page>0){contactsState.page--;loadContacts()}}
function nextContactsPage(){if((contactsState.page+1)*contactsState.limit<contactsState.total){contactsState.page++;loadContacts()}}
function renderContactsPagination(total){var start=contactsState.page*contactsState.limit+(total>0?1:0);var end=Math.min((contactsState.page+1)*contactsState.limit,total);var pInfo=el('contactsPageInfo');var btnPrev=el('btnPrevContacts');var btnNext=el('btnNextContacts');if(pInfo)pInfo.textContent='Showing '+start+'–'+end+' of '+total+' companies';if(btnPrev)btnPrev.disabled=contactsState.page===0;if(btnNext)btnNext.disabled=end>=total}
function exportContactsCsv(){var q='/api/contacts/export?token='+encodeURIComponent(state.token);if(contactsState.typeFilter!=='all')q+='&filter='+encodeURIComponent(contactsState.typeFilter);if(contactsState.search)q+='&search='+encodeURIComponent(contactsState.search);if(contactsState.teleFilter!=='all')q+='&assignedTo='+encodeURIComponent(contactsState.teleFilter);window.open(q,'_blank')}
function renderContactsCards(groups){
var cont=el('contactsContainer');
if(!cont)return;
if(!groups||!groups.length){
  cont.innerHTML='<div class="empty">No people found in this view. Run contact or company research, or switch the filter to All Companies with Contacts.</div>';
  return;
}
function contactCell(p, companyPhone, companyName){
  var bits=[];
  var dPhone=p.direct_phone||p.directPhone||'';
  var dEmail=p.direct_email||p.directEmail||'';
  var wa=p.whatsapp_url||p.whatsappUrl||'';
  if(dPhone){
    var digits=String(dPhone).replace(/\D/g,'');
    var waHref=safeUrl(wa)||(digits?('https://wa.me/'+digits):'');
    bits.push('<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;"><span class="contact-phone-val">'+esc(dPhone)+'</span><a class="contact-action-btn call-btn" href="tel:'+attr(digits)+'">Call</a>'+(waHref?'<a class="contact-action-btn wa-btn" target="_blank" rel="noopener" href="'+attr(waHref)+'">WhatsApp</a>':'')+'<button class="contact-action-btn copy-btn" type="button" onclick="copyText(\''+attr(dPhone)+'\', \''+attr(p.name)+' Phone\')">Copy</button></div>');
  }
  if(dEmail){
    bits.push('<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;"><a class="source-link" href="mailto:'+attr(dEmail)+'">'+esc(dEmail)+'</a><button class="contact-action-btn copy-btn" type="button" onclick="copyText(\''+attr(dEmail)+'\', \''+attr(p.name)+' Email\')">Copy</button></div>');
  }
  if(!dPhone && !dEmail && companyPhone){
    var cDigits=String(companyPhone).replace(/\D/g,'');
    bits.push('<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;"><span class="meta">Company line</span><span class="contact-phone-val">'+esc(companyPhone)+'</span><a class="contact-action-btn call-btn" href="tel:'+attr(cDigits)+'">Call</a><button class="contact-action-btn copy-btn" type="button" onclick="copyText(\''+attr(companyPhone)+'\', \''+attr(companyName)+' Phone\')">Copy</button></div>');
  }
  return bits.length?bits.join(''):'<span class="meta">No contact published</span>';
}
function sourceCell(p){
  var label=p.source||'';
  var url=safeUrl(p.evidence_url||p.evidenceUrl||p.profile_url||p.profileUrl||'');
  if(url) return '<a class="person-source" target="_blank" rel="noopener" href="'+attr(url)+'">'+(esc(label||'View source'))+' ↗</a>';
  return label?'<span class="person-source">'+esc(label)+'</span>':'<span class="meta">Source not linked</span>';
}
cont.innerHTML=groups.map(function(grp){
  var cId=grp.company_id||(grp.company&&grp.company.id)||'';
  var cName=grp.company_name||(grp.company&&grp.company.name)||'Company';
  var cAddress=grp.address||(grp.company&&grp.company.address)||'';
  var cCategory=grp.category||(grp.company&&grp.company.category)||'Business';
  var cRating=grp.rating!=null?grp.rating:(grp.company&&grp.company.rating);
  var cReviews=grp.reviews!=null?grp.reviews:(grp.company&&grp.company.reviews);
  var website=safeUrl(grp.website||(grp.company&&grp.company.website));
  var maps=safeUrl(grp.maps_url||(grp.company&&grp.company.mapsUrl));
  var cAssigned=grp.assigned_to||(grp.company&&grp.company.assignedTo)||'';
  var cStatus=grp.lead_status||(grp.company&&grp.company.leadStatus)||'unassigned';
  var contactPid=grp.contact_public_id||(grp.reports&&grp.reports.contactPublicId)||'';
  var researchPid=grp.research_public_id||(grp.reports&&grp.reports.researchPublicId)||'';
  var people=grp.people||grp.decisionMakers||[];
  var phones=grp.phones||[];
  var emails=grp.emails||[];
  var companyPhone=grp.primary_phone||(grp.company&&grp.company.phone)||'';
  if(!people.length){
    phones.forEach(function(ph){
      people.push({name:'',role:ph.label||'Company line',direct_phone:ph.number_e164||ph.number||ph.phone||'',whatsapp_url:ph.whatsapp_url||'',evidence_url:ph.evidence_url||maps,source:ph.label||'Google Maps',unnamed:true,is_primary:false});
    });
    emails.forEach(function(em){
      people.push({name:'',role:em.label||'Company email',direct_email:em.email||'',evidence_url:em.evidence_url||'',source:em.label||'Company email',unnamed:true,is_primary:false});
    });
    if(!people.length && companyPhone){
      people.push({name:'',role:'Company line',direct_phone:companyPhone,evidence_url:maps,source:'Google Maps',unnamed:true,is_primary:false});
    }
  }
  var rating=cRating?(' · ★ '+cRating+(cReviews?' / '+cReviews:'')):'';
  var reportLinks='';
  if(contactPid) reportLinks+='<a class="vip contact-vip" target="_blank" rel="noopener" href="/r/'+attr(contactPid)+'">Contacts dossier ↗</a>';
  if(researchPid) reportLinks+='<a class="vip" target="_blank" rel="noopener" href="/r/'+attr(researchPid)+'">Company dossier ↗</a>';
  var assignedBadge=cAssigned?('<span class="contact-pill-tag phone">'+esc(cAssigned)+'</span>'):'<span class="meta">(Unassigned)</span>';
  var statusBadge=cStatus?('<span class="status '+attr(cStatus)+'">'+esc(String(cStatus).replace('_',' '))+'</span>'):'';
  var peopleHtml;
  if(!people.length){
    peopleHtml='<div class="contact-empty-people">No named person for this company yet.</div>';
  } else {
    peopleHtml='<table class="contact-person-table"><thead><tr><th>Name</th><th>Position</th><th>Contact info</th><th>Source</th></tr></thead><tbody>'+people.map(function(p){
      var unnamed=Boolean(p.unnamed)||!String(p.name||'').trim();
      var isPri=!unnamed&&Boolean(p.is_primary||p.isPrimary);
      var role=p.role||p.position||p.current_role||(unnamed?'Company line':'Role not stated');
      var badge=isPri?' <span class="contact-pill-tag dm">Target</span>':'';
      var nameHtml=unnamed?'<div class="person-name unnamed">Not identified</div>':'<div class="person-name">'+esc(p.name)+badge+'</div>';
      return '<tr class="'+(isPri?'primary-person':'')+'"><td data-label="Name">'+nameHtml+'</td><td data-label="Position" class="person-position">'+esc(role)+'</td><td data-label="Contact info" class="person-contact">'+contactCell(p, unnamed?'':companyPhone, cName)+'</td><td data-label="Source">'+sourceCell(p)+'</td></tr>';
    }).join('')+'</tbody></table>';
  }
  var namedCount=people.filter(function(p){return String(p.name||'').trim()&&!p.unnamed}).length;
  var contactBadge=namedCount?('<span class="contact-pill-tag dm">'+namedCount+' '+(namedCount===1?'person':'people')+'</span>'):(people.length?('<span class="contact-pill-tag phone">'+people.length+' company line'+(people.length===1?'':'s')+'</span>'):'');
  return '<article class="contact-group-card" id="contactGroup-'+attr(cId)+'"><div class="contact-group-head"><div style="flex:1;min-width:0;"><h3 class="contact-group-title">'+esc(cName)+'</h3><div class="contact-group-meta"><span>'+esc(cCategory)+rating+'</span><span>·</span><span>'+esc(cAddress||'Address not published')+'</span></div><div style="display:flex;gap:8px;align-items:center;margin-top:8px;flex-wrap:wrap;">'+assignedBadge+statusBadge+contactBadge+'</div></div><div style="display:flex;gap:6px;flex-wrap:wrap;align-items:flex-start;">'+reportLinks+(website?'<a class="source-link" target="_blank" rel="noopener" href="'+attr(website)+'">Web</a>':'')+(maps?'<a class="source-link" target="_blank" rel="noopener" href="'+attr(maps)+'">Maps</a>':'')+'</div></div>'+peopleHtml+'</article>';
}).join('');
}
var agentState={agents:[],filter:'',statusFilter:'all',roleFilter:'all'};
// Imported agents carry their atap.solar access tags in the notes line
// "Imported from calculator.atap.solar · roles: sales, team-jb". Parsing the
// tags back out of the notes keeps this a pure client-side filter -- no schema
// change, and manually created agents without the marker simply never match.
function agentRoleTags(agent){
  var m=/roles:\s*(.+)$/i.exec(String(agent.notes||''));
  if(!m)return[];
  return m[1].split(',').map(function(t){return t.trim().toLowerCase()}).filter(Boolean);
}
// One click syncs the whole sales roster from calculator.atap.solar. Existing
// Imported telemarketers are matched by their Atap user UID.
async function importAgentsFromAtap(button){
  if(!window.confirm('Import sales agents from calculator.atap.solar as telemarketers using their Atap user UID?'))return;
  var was=button.textContent;
  button.disabled=true;button.textContent='Importing…';
  try{
    var res=await api('/api/telemarketers/import',{method:'POST',body:JSON.stringify({})});
    showToast('Imported '+res.imported+' sales agent'+(res.imported===1?'':'s')+' ('+res.created+' new · '+res.updated+' updated · '+res.skipped+' non-sales skipped)');
    await loadAgentsView();
  }catch(err){
    if(!authLost(err))showToast('Import failed: '+err.message);
  }finally{
    button.disabled=false;button.textContent=was;
  }
}
async function loadAgentsView(){
  if(!state.token)return;
  var cont=el('agentsContainer');
  if(cont&&!agentState.agents.length)cont.innerHTML='<div class="empty">Loading telemarketers roster…</div>';
  try{
    var res=await api('/api/telemarketers');
    agentState.agents=res.agents||[];
    renderAgentRoleFilter();
    renderAgentsSummary(agentState.agents);
    renderAgents();
  }catch(err){
    if(cont)cont.innerHTML='<div class="empty error">'+esc(err.message)+'</div>';
    if(!authLost(err))showToast('Failed to load telemarketers: '+err.message);
  }
}
function renderAgentsSummary(agents){
  var total=agents.length;
  var active=agents.filter(function(a){return a.active}).length;
  var totalLeads=agents.reduce(function(acc,a){return acc+(a.total_assigned||0)},0);
  var contacted=agents.reduce(function(acc,a){return acc+(a.contacted_count||0)},0);
  var tEl=el('agentsTotalCount');var aEl=el('agentsActiveCount');
  var lEl=el('agentsTotalLeadsCount');var cEl=el('agentsContactedCount');
  if(tEl)tEl.textContent=total;
  if(aEl)aEl.textContent=active;
  if(lEl)lEl.textContent=totalLeads;
  if(cEl)cEl.textContent=contacted;
}
// Rebuild the tag dropdown from the live roster on every load, preserving the
// current selection when the chosen tag still exists.
function renderAgentRoleFilter(){
  var sel=el('agentRoleFilter');
  if(!sel)return;
  var tags={};
  agentState.agents.forEach(function(a){agentRoleTags(a).forEach(function(t){tags[t]=true})});
  var curated=Object.keys(tags).sort();
  var cur=sel.value||'all';
  var html='<option value="all">All Access Tags</option>'+curated.map(function(t){
    return '<option value="'+attr(t)+'">'+esc(t)+'</option>';
  }).join('');
  sel.innerHTML=html;
  sel.value=curated.indexOf(cur)>=0?cur:'all';
}
function filterAgents(){
  var input=el('agentFilterInput');
  var sel=el('agentStatusFilter');
  var roleSel=el('agentRoleFilter');
  agentState.filter=input?input.value.trim().toLowerCase():'';
  agentState.statusFilter=sel?sel.value:'all';
  agentState.roleFilter=roleSel?roleSel.value:'all';
  renderAgents();
}
function renderAgents(){
  var cont=el('agentsContainer');
  if(!cont)return;
  var list=agentState.agents||[];
  var f=agentState.filter;
  var sf=agentState.statusFilter;
  var rf=agentState.roleFilter;
  if(sf==='active')list=list.filter(function(a){return a.active});
  else if(sf==='inactive')list=list.filter(function(a){return !a.active});
  if(rf&&rf!=='all')list=list.filter(function(a){return agentRoleTags(a).indexOf(rf)>=0});
  if(f){
    list=list.filter(function(a){
      if(a.name.toLowerCase().indexOf(f)>=0)return true;
      if(a.phone&&a.phone.toLowerCase().indexOf(f)>=0)return true;
      if(a.email&&a.email.toLowerCase().indexOf(f)>=0)return true;
      if(a.notes&&a.notes.toLowerCase().indexOf(f)>=0)return true;
      if(a.uid&&a.uid.toLowerCase().indexOf(f)>=0)return true;
      return false;
    });
  }
  if(!list.length){
    cont.innerHTML='<div class="empty">No telemarketers found matching filter.</div>';
    return;
  }
  cont.innerHTML=list.map(function(agent){
    var initials=agent.name.split(/\s+/).map(function(w){return w[0]}).slice(0,2).join('').toUpperCase()||'TM';
    var statusBadge=agent.active?'<span class="status completed">Active</span>':'<span class="status" style="color:var(--muted)">Inactive</span>';
    var phoneLink=agent.phone?('<a class="source-link" href="tel:'+attr(agent.phone.replace(/[^+\d]/g,''))+'">'+esc(agent.phone)+'</a>'):'<span class="meta">No phone</span>';
    var emailLink=agent.email?('<a class="source-link" href="mailto:'+attr(agent.email)+'">'+esc(agent.email)+'</a>'):'';
    var waLink='';
    if(agent.phone){
      var digits=agent.phone.replace(/\D/g,'');
      if(digits)waLink='<a class="source-link" target="_blank" rel="noopener" href="https://wa.me/'+attr(digits)+'">WhatsApp</a>';
    }
    return '<article class="agent-card '+(agent.active?'':'inactive')+'" id="agentCard-'+attr(agent.id)+'">'
      +'<div class="agent-card-head">'
      +'<div style="display:flex;gap:12px;align-items:start;flex:1;min-width:0;">'
      +'<div class="agent-avatar">'+esc(initials)+'</div>'
      +'<div class="agent-meta-block">'
      +'<div class="agent-name"><span>'+esc(agent.name)+'</span> '+statusBadge+'</div>'
      +(agent.uid?'<div class="meta">UID: '+esc(agent.uid)+'</div>':'')
      +'<div class="agent-contact-line">'+phoneLink+(emailLink?' · '+emailLink:'')+(waLink?' · '+waLink:'')+'</div>'
      +'</div>'
      +'</div>'
      +'</div>'
      +(agent.notes?('<div class="agent-notes-box">'+esc(agent.notes)+'</div>'):'')
      +'<div class="agent-metrics-row">'
      +'<div class="agent-metric-item"><div class="agent-metric-num">'+(agent.total_assigned||0)+'</div><div class="agent-metric-lbl">Assigned</div></div>'
      +'<div class="agent-metric-item"><div class="agent-metric-num" style="color:var(--warn);">'+(agent.contacted_count||0)+'</div><div class="agent-metric-lbl">Contacted</div></div>'
      +'<div class="agent-metric-item"><div class="agent-metric-num" style="color:var(--ok);">'+(agent.interested_count||0)+'</div><div class="agent-metric-lbl">Interested</div></div>'
      +'<div class="agent-metric-item"><div class="agent-metric-num" style="color:var(--bad);">'+((agent.not_interested_count||0)+(agent.dnc_count||0))+'</div><div class="agent-metric-lbl">Lost/DNC</div></div>'
      +'</div>'
      +'<div class="agent-actions-row">'
      +'<button class="primary" type="button" style="height:32px;padding:0 10px;font-size:9.5px;" data-name="'+attr(agent.name)+'" onclick="viewAgentLeads(this.getAttribute(\'data-name\'))">View Leads ('+(agent.total_assigned||0)+') →</button>'
      +'<button class="filter" type="button" style="height:32px;padding:0 8px;font-size:9px;" data-id="'+attr(agent.id)+'" onclick="editAgent(Number(this.getAttribute(\'data-id\')))">Edit</button>'
      +'<button class="filter" type="button" style="height:32px;padding:0 8px;font-size:9px;" data-id="'+attr(agent.id)+'" data-active="'+(agent.active?'false':'true')+'" onclick="toggleAgentActive(Number(this.getAttribute(\'data-id\')),this.getAttribute(\'data-active\')===\'true\')">'+(agent.active?'Deactivate':'Activate')+'</button>'
      +'<button class="text-action danger" type="button" style="padding:0;font-size:9px;margin-left:auto;" data-id="'+attr(agent.id)+'" data-name="'+attr(agent.name)+'" data-count="'+(agent.total_assigned||0)+'" onclick="deleteAgentPrompt(this)">Delete ×</button>'
      +'</div>'
      +'</article>';
  }).join('');
}
function viewAgentLeads(agentName){
  leadState.teleFilter=agentName;
  var sel=el('leadTeleFilter');
  if(sel)sel.value=agentName;
  switchView('leads');
}
function toggleCreateAgentForm(show){
  var sheet=el('agentFormSheet');
  if(!sheet)return;
  if(show===undefined)show=sheet.classList.contains('hidden');
  sheet.classList.toggle('hidden',!show);
  if(show){
    el('agentFormTitle').textContent='Create New Telemarketer';
    el('agentFormSubmitBtn').textContent='Save Telemarketer';
    el('agentFormId').value='';
    el('agentFormName').value='';
    el('agentFormPhone').value='';
    el('agentFormEmail').value='';
    el('agentFormNotes').value='';
    el('agentFormStatus').value='true';
    el('agentFormName').focus();
    sheet.scrollIntoView({behavior:'smooth',block:'start'});
  }
}
function editAgent(agentId){
  var agent=(agentState.agents||[]).find(function(a){return a.id===agentId});
  if(!agent)return;
  toggleCreateAgentForm(true);
  el('agentFormTitle').textContent='Edit Telemarketer: '+agent.name;
  el('agentFormSubmitBtn').textContent='Update Telemarketer';
  el('agentFormId').value=String(agent.id);
  el('agentFormName').value=agent.name||'';
  el('agentFormPhone').value=agent.phone||'';
  el('agentFormEmail').value=agent.email||'';
  el('agentFormNotes').value=agent.notes||'';
  el('agentFormStatus').value=String(agent.active);
}
async function saveAgentForm(event){
  event.preventDefault();
  var id=el('agentFormId').value;
  var name=el('agentFormName').value.trim();
  var phone=el('agentFormPhone').value.trim();
  var email=el('agentFormEmail').value.trim();
  var notes=el('agentFormNotes').value.trim();
  var active=el('agentFormStatus').value==='true';
  if(!name){showToast('Agent name is required');return}
  var btn=el('agentFormSubmitBtn');
  btn.disabled=true;
  try{
    if(id){
      await api('/api/telemarketers/'+encodeURIComponent(id),{
        method:'PATCH',
        body:JSON.stringify({name:name,phone:phone||null,email:email||null,notes:notes||null,active:active})
      });
      showToast('Updated '+name);
    }else{
      await api('/api/telemarketers',{
        method:'POST',
        body:JSON.stringify({name:name,phone:phone||null,email:email||null,notes:notes||null,active:active})
      });
      showToast('Created telemarketer agent '+name);
    }
    toggleCreateAgentForm(false);
    await loadAgentsView();
    await loadTelemarketers();
  }catch(err){
    if(!authLost(err))showToast('Failed to save agent: '+err.message);
  }finally{
    btn.disabled=false;
  }
}
async function toggleAgentActive(id,newActive){
  try{
    await api('/api/telemarketers/'+encodeURIComponent(id),{
      method:'PATCH',
      body:JSON.stringify({active:newActive})
    });
    showToast(newActive?'Agent activated':'Agent deactivated');
    await loadAgentsView();
    await loadTelemarketers();
  }catch(err){
    if(!authLost(err))showToast('Failed to toggle agent status: '+err.message);
  }
}
async function deleteAgentPrompt(btn){
  var id=btn.getAttribute('data-id');
  var name=btn.getAttribute('data-name');
  var count=Number(btn.getAttribute('data-count'))||0;
  var msg='Delete telemarketer '+name+'?';
  if(count>0){
    msg+='\n\nThis will unassign '+count+' leads currently allocated to this agent back to unassigned leads pool.';
  }
  if(!window.confirm(msg))return;
  try{
    await api('/api/telemarketers/'+encodeURIComponent(id)+'?unassign=true',{
      method:'DELETE'
    });
    showToast('Deleted agent '+name);
    await loadAgentsView();
    await loadTelemarketers();
  }catch(err){
    if(!authLost(err))showToast('Failed to delete agent: '+err.message);
  }
}
async function runDedupAction(){if(!window.confirm('Run deduplication pass across company registry?\n\nThis merges duplicate company branches and duplicate phone contacts into their canonical primary record.'))return;try{var res=await api('/api/leads/dedup',{method:'POST'});showToast('Dedup completed: '+(res.merged||0)+' duplicates consolidated');await loadLeads()}catch(err){if(!authLost(err))showToast('Dedup failed: '+err.message)}}
function exportLeadsCsv(){var q='/api/leads/export?token='+encodeURIComponent(state.token);if(leadState.statusFilter!=='all')q+='&status='+encodeURIComponent(leadState.statusFilter);if(leadState.search)q+='&search='+encodeURIComponent(leadState.search);if(leadState.teleFilter!=='all')q+='&assignedTo='+encodeURIComponent(leadState.teleFilter);if(leadState.researchFilter!=='all')q+='&researchStatus='+encodeURIComponent(leadState.researchFilter);window.open(q,'_blank')}
function renderLeads(leads){var wrapper=el('leadTableWrapper');if(!wrapper)return;if(!leads.length){wrapper.innerHTML='<div class="empty">No companies found matching the filter.</div>';return}wrapper.innerHTML=leads.map(function(lead){var checked=Boolean(leadState.selected[lead.id]);var phone=lead.phone||'';var website=safeUrl(lead.website);var maps=safeUrl(lead.maps_url);var rating=lead.rating?(' · ★ '+lead.rating+(lead.reviews?' / '+lead.reviews:'')):'';var branchBadge=lead.branch_count>0?(' <span class="branch-tag" title="'+lead.branch_count+' branches consolidated">'+lead.branch_count+' branch'+(lead.branch_count>1?'es':'')+'</span>'):'';var isHidden=Boolean(lead.is_hidden||leadState.statusFilter==='hidden');var hasContact=Boolean((lead.contact_public_id&&(lead.contact_status==='completed'||lead.contact_status==='partial'))||(lead.research_public_id&&(lead.research_status==='completed'||lead.research_status==='partial'))||Number(lead.contact_phones_count)>0||Number(lead.contact_decision_makers_count)>0);var isContactRunning=Boolean(lead.contact_status==='running'||lead.contact_status==='queued');var contactPhones=Number(lead.contact_phones_count)||0;var contactDMs=Number(lead.contact_decision_makers_count)||0;var contactPill='';if(hasContact){contactPill='<div class="contact-pill" title="'+contactPhones+' phone route'+(contactPhones===1?'':'s')+' and '+contactDMs+' decision maker'+(contactDMs===1?'':'s')+' identified">📞 <strong>'+contactPhones+' Contact Number'+(contactPhones===1?'':'s')+' Found</strong>'+(contactDMs>0?(' · 👤 '+contactDMs+' Leader'+(contactDMs===1?'':'s')):'')+'</div>'}else if(isContactRunning){contactPill='<div class="contact-pill running">⏳ Contact research in progress…</div>'}var contactControl='';if(lead.contact_public_id){contactControl='<a class="vip contact-vip" target="_blank" rel="noopener" href="/r/'+attr(lead.contact_public_id)+'">📞 Contacts ('+contactPhones+' phones) ↗</a>'}else{contactControl='<button class="research" style="background:#0a6b47;border-color:#0a6b47;min-height:36px;" data-company="'+attr(lead.id)+'" data-name="'+attr(lead.name)+'" onclick="startContact(this)">Contacts ⚡</button>'}var rerunActionLead=lead.contact_public_id&&(lead.contact_status==='completed'||lead.contact_status==='partial')?('<button class="research" data-company="'+attr(lead.id)+'" data-name="'+attr(lead.name)+'" data-previous-report="'+attr(lead.contact_public_id)+'" onclick="rerunOriginalContact(this)">Rerun original contacts ↻</button>'):'';var dossierControl='';if(lead.research_public_id){dossierControl='<a class="vip" target="_blank" rel="noopener" href="/r/'+attr(lead.research_public_id)+'">Dossier V'+(lead.research_version||1)+' ↗</a>'}else{dossierControl='<button class="research" data-company="'+attr(lead.id)+'" data-name="'+attr(lead.name)+'" onclick="startResearch(this)">Research →</button>'}var teleOpts='<option value="">(Unassigned)</option>';leadState.telemarketers.forEach(function(a){var value=agentValue(a);var sel=(a.uid?lead.telemarketer_uid===a.uid:lead.assigned_to===a.name)?' selected':'';teleOpts+='<option value="'+attr(value)+'"'+sel+'>'+esc(agentLabel(a))+'</option>'});var statuses=['unassigned','assigned','contacted','interested','not_interested','do_not_call'];var statusOpts=statuses.map(function(s){var sel=(lead.lead_status===s)?' selected':'';var lbl=s==='do_not_call'?'DNC':s.replace('_',' ');return '<option value="'+s+'"'+sel+'>'+lbl+'</option>'}).join('');var notesSnippet=lead.lead_notes?(esc(lead.lead_notes.slice(0,60))+(lead.lead_notes.length>60?'…':'')):'Add notes';var hideBtn=isHidden?'<button class="filter" type="button" style="min-height:30px;padding:0 8px;font-size:9px;white-space:nowrap;border-color:var(--ok);color:var(--ok);background:#ecfdf5;" title="Restore company to active list" onclick="toggleHideLead(\''+attr(lead.id)+'\', false)">👁️ Unhide</button>':'<button class="filter" type="button" style="min-height:30px;padding:0 8px;font-size:9px;white-space:nowrap;color:var(--muted);" title="Hide company from master list" onclick="toggleHideLead(\''+attr(lead.id)+'\', true)">🚫 Hide</button>';var rowClasses='lead-row'+(hasContact?' has-contact-research':'')+(isContactRunning?' contact-running':'')+(isHidden?' is-hidden':'');return '<article class="'+rowClasses+'">'+'<div><input type="checkbox" id="leadCheck-'+attr(lead.id)+'" class="lead-check" '+(checked?'checked ':'')+'onchange="toggleSelectLead(\''+attr(lead.id)+'\', this.checked)"></div>'+'<div>'+'<h3>'+esc(lead.name)+branchBadge+'</h3>'+'<div class="meta">'+esc(lead.category||'Business')+esc(rating)+'</div>'+'<div class="address" style="margin-top:4px;">'+esc(lead.address||'Address not published')+'</div>'+contactPill+'</div>'+'<div class="company-contact">'+'<div class="phone">'+(phone?('<a class="source-link" href="tel:'+attr(phone.replace(/[^+\d]/g,''))+'" style="font-size:13px;">'+esc(phone)+'</a>'):'<span class="meta">No phone</span>')+'</div>'+'<div class="actions" style="display:flex;gap:8px;margin-top:4px;">'+(website?('<a class="source-link" target="_blank" rel="noopener" href="'+attr(website)+'">Web</a>'):'')+(maps?('<a class="source-link" target="_blank" rel="noopener" href="'+attr(maps)+'">Maps</a>'):'')+'</div>'+'<div style="margin-top:8px;display:flex;flex-direction:column;gap:6px;align-items:flex-start;">'+contactControl+rerunActionLead+'<button class="research" data-company="'+attr(lead.id)+'" data-name="'+attr(lead.name)+'" onclick="startParallelContact(this)">Parallel contacts ↗</button>'+dossierControl+'</div>'+'</div>'+'<div style="display:grid;gap:8px;">'+'<div>'+'<label style="display:block;font:700 8px/1 var(--sans);letter-spacing:.1em;text-transform:uppercase;color:var(--muted);margin-bottom:4px;">Assigned to</label>'+'<select class="tele-select" onchange="updateLeadAssignee(\''+attr(lead.id)+'\', this)">'+teleOpts+'</select>'+'</div>'+'<div>'+'<label style="display:block;font:700 8px/1 var(--sans);letter-spacing:.1em;text-transform:uppercase;color:var(--muted);margin-bottom:4px;">Status</label>'+'<select class="status-select '+attr(lead.lead_status||'unassigned')+'" onchange="updateLeadStatus(\''+attr(lead.id)+'\', this)">'+statusOpts+'</select>'+'</div>'+'</div>'+'<div style="display:grid;gap:6px;align-content:start;">'+'<div style="display:flex;gap:6px;align-items:center;">'+'<button class="filter" type="button" style="min-height:30px;padding:0 8px;font-size:9px;white-space:nowrap;" data-id="'+attr(lead.id)+'" data-notes="'+attr(lead.lead_notes||'')+'" onclick="promptLeadNotes(this)">📝 '+(lead.lead_notes?'Notes':'+ Note')+'</button>'+hideBtn+'</div>'+(lead.lead_notes?('<span style="font-size:11px;color:var(--muted);max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="'+attr(lead.lead_notes)+'">'+notesSnippet+'</span>'):'')+'</div>'+'</article>'}).join('')}
var teleState={data:null,expanded:{},filter:'',queueingTown:false};
function onTeleStateChange(){
  teleState.expanded={};
  if(el('teleFilterInput'))el('teleFilterInput').value='';
  teleState.filter='';
  loadTelemarketingView();
}
async function loadTelemarketingView(){
  if(!state.token)return;
  var cont=el('teleTerritoryContainer');
  if(cont&&!teleState.data)cont.innerHTML='<div class="empty">Loading territory directory…</div>';
  var stateVal=el('teleStateSelect')?el('teleStateSelect').value:'johor';
  try{
    loadTelemarketers();
    var body=await api('/api/territories?state='+encodeURIComponent(stateVal));
    teleState.data=body;
    renderTeleSummary(body.stats||{});
    renderTerritoryCards();
  }catch(err){
    if(cont)cont.innerHTML='<div class="empty error">'+esc(err.message)+'</div>';
    if(!authLost(err))showToast('Failed to load territories: '+err.message);
  }
}
function renderTeleSummary(stats){
  var d=el('teleDistrictsCount');var tw=el('teleTownsCount');var tm=el('teleTamansCount');var sc=el('teleScannedCount');
  if(d)d.textContent=stats.totalDistricts||10;
  if(tw)tw.textContent=stats.totalTowns||70;
  if(tm)tm.textContent=stats.totalTamans||771;
  if(sc)sc.textContent=(stats.scannedTamans||0)+' ('+(stats.totalLeads||0)+' businesses found · '+(stats.totalContacts||0)+' with phone)';
}
function expandAllDistricts(expand){
  if(!teleState.data||!teleState.data.districts)return;
  teleState.data.districts.forEach(function(d){teleState.expanded[d.id]=expand});
  renderTerritoryCards();
}
function filterTerritoryCards(){
  var input=el('teleFilterInput');
  teleState.filter=input?input.value.trim().toLowerCase():'';
  if(teleState.filter&&teleState.data&&teleState.data.districts){
    teleState.data.districts.forEach(function(d){teleState.expanded[d.id]=true});
  }
  renderTerritoryCards();
}
function toggleDistrict(id){
  teleState.expanded[id]=!teleState.expanded[id];
  var card=el('distCard-'+id);
  if(card)card.classList.toggle('expanded',teleState.expanded[id]);
}
function toggleDistrictCard(headEl){
  var card=headEl.closest('.district-card');
  if(card){
    var id=card.getAttribute('data-dist-id');
    if(id){
      teleState.expanded[id]=!teleState.expanded[id];
      card.classList.toggle('expanded',Boolean(teleState.expanded[id]));
    }
  }
}
function renderTerritoryCards(){
  var cont=el('teleTerritoryContainer');
  if(!cont||!teleState.data)return;
  var districts=teleState.data.districts||[];
  var f=teleState.filter;
  var html='';
  districts.forEach(function(d){
    var filteredTowns=d.towns;
    if(f){
      filteredTowns=d.towns.filter(function(t){
        if(t.name.toLowerCase().indexOf(f)>=0)return true;
        return t.tamans.some(function(tm){
          return tm.name.toLowerCase().indexOf(f)>=0 || (tm.assignedTo && tm.assignedTo.toLowerCase().indexOf(f)>=0);
        });
      });
      if(!filteredTowns.length&&d.name.toLowerCase().indexOf(f)<0)return;
    }
    var isExpanded=f?true:!!teleState.expanded[d.id];
    var scannedRatio=(d.scannedTamans||0)+'/'+(d.totalTamans||d.towns.reduce(function(a,t){return a+t.tamans.length},0))+' scanned';
    html+='<div class="district-card '+(isExpanded?'expanded':'')+'" id="distCard-'+attr(d.id)+'" data-dist-id="'+attr(d.id)+'">';
    html+='<div class="district-head" onclick="toggleDistrictCard(this)">';
    html+='<div class="district-title"><h3>'+esc(d.num)+'. Daerah '+esc(d.name)+'</h3><span class="district-badge">'+esc(scannedRatio)+'</span></div>';
    html+='<span class="district-chevron">&#9660;</span></div>';
    html+='<div class="district-body">';
    var townsToRender=f&&filteredTowns.length?filteredTowns:d.towns;
    townsToRender.forEach(function(t){
      var filteredTamans=t.tamans;
      if(f&&t.name.toLowerCase().indexOf(f)<0){
        filteredTamans=t.tamans.filter(function(tm){
          return tm.name.toLowerCase().indexOf(f)>=0 || (tm.assignedTo && tm.assignedTo.toLowerCase().indexOf(f)>=0);
        });
      }
      var tScan=t.scan;
      var tScanned=tScan&&(tScan.status==='completed'||(tScan.status==='partial'&&tScan.count>0));
      var tScanning=tScan&&terminal.indexOf(tScan.status)<0;
      html+='<div class="town-block"><div class="town-head">';
      html+='<div style="display:flex;align-items:center;gap:10px;"><div class="town-title">'+esc(t.name)+'</div>';
      if(tScanned){html+='<a class="taman-link" target="_blank" rel="noopener" href="/r/'+attr(tScan.publicId)+'">&#9679; '+esc(tScan.count)+(tScan.status==='partial'?' businesses · partial':' leads')+'<span title="Leads where a phone number was found"> · '+esc(tScan.contacts)+' contacts</span> &#8599;</a>'}
      else if(tScanning){html+='<span style="font-size:11px;color:var(--warn);">&#9679; Scanning...</span>'}
      html+='</div>';
      html+='</div>';
      html+='<div class="taman-grid">';
      filteredTamans.forEach(function(tm){
        var scan=tm.scan;
        var isScanned=scan&&(scan.status==='completed'||(scan.status==='partial'&&scan.count>0));
        var isScanning=scan&&terminal.indexOf(scan.status)<0;
        var pillClass=isScanned?'scanned':isScanning?'scanning':'';
        var pipClass=isScanned?'scanned':isScanning?'scanning':'';
        var assignedTo=tm.assignedTo||(scan&&scan.assignedTo)||'';
        var leadCount=scan?scan.count:0;
        html+='<div class="taman-pill '+pillClass+'">';
        html+='<span class="taman-pip '+pipClass+'"></span>';
        html+='<span class="taman-name">'+esc(tm.name)+'</span>';
        if(assignedTo){
          html+='<button class="taman-assign-btn assigned" type="button" data-taman="'+attr(tm.name)+'" data-town="'+attr(t.name)+'" data-dist="'+attr(d.name)+'" data-place="'+attr(tm.queryPlace)+'" data-public-id="'+attr(scan?scan.publicId:'')+'" data-count="'+attr(leadCount)+'" data-assigned="'+attr(assignedTo)+'" onclick="openTamanAssignModal(this)" title="Assigned to '+esc(assignedTo)+' (click to reassign or unassign)">&#128100; '+esc(assignedTo)+'</button>';
        }else{
          html+='<button class="taman-assign-btn" type="button" data-taman="'+attr(tm.name)+'" data-town="'+attr(t.name)+'" data-dist="'+attr(d.name)+'" data-place="'+attr(tm.queryPlace)+'" data-public-id="'+attr(scan?scan.publicId:'')+'" data-count="'+attr(leadCount)+'" onclick="openTamanAssignModal(this)" title="Assign leads in '+esc(tm.name)+' to a telemarketer">+ Assign</button>';
        }
        if(isScanned){
          html+='<a class="taman-link" target="_blank" rel="noopener" href="/r/'+attr(scan.publicId)+'" title="Open search report">'+esc(scan.count)+(scan.status==='partial'?' businesses · partial':' leads')+'<span title="Leads where a phone number was found"> · '+esc(scan.contacts)+' contacts</span> &#8599;</a>';
        }else if(isScanning){
          html+='<span style="font-size:11px;color:var(--warn);">Scanning...</span>';
        }
        var pendingResearch=tm.contactPending||0;
        if(pendingResearch>0){html+='<button class="taman-scan-action taman-research-action" type="button" data-place="'+attr(tm.queryPlace)+'" onclick="runTamanContactResearchFromBtn(this)" title="Leads at this taman still waiting for contact research">&#128269; Research '+pendingResearch+' pending</button>'}
        else if(isScanned){html+='<span class="taman-research-done">&#10003; All researched</span>'}
        html+='<div class="taman-scan-group">';
        html+='<button class="taman-scan-action" type="button" data-place="'+attr(tm.queryPlace)+'" data-keywords="business" onclick="queueTamanScanFromBtn(this)">&#9889; Business</button>';
        html+='<button class="taman-scan-action" type="button" data-place="'+attr(tm.queryPlace)+'" data-keywords="factory" onclick="queueTamanScanFromBtn(this)">&#9889; Factory</button>';
        html+='<button class="taman-scan-action" type="button" data-place="'+attr(tm.queryPlace)+'" data-keywords="shop" onclick="queueTamanScanFromBtn(this)">&#9889; Shop</button>';
        html+='</div>';
        html+='</div>';
      });
      html+='</div></div>';
    });
    html+='</div></div>';
  });
  cont.innerHTML=html||'<div class="empty">No territories matching filter.</div>';
}
function findTaman(place){
  var found=null;
  (teleState.data&&teleState.data.districts||[]).some(function(d){return (d.towns||[]).some(function(t){found=(t.tamans||[]).find(function(tm){return tm.queryPlace===place})||null;return !!found})});
  return found;
}
// A keyword is skipped only while its own scan for this taman is queued or running.
function tamanKeywordActive(tm,keyword){
  var scan=tm.scanByKeyword&&tm.scanByKeyword[keyword];
  return !!scan&&(scan.status==='queued'||scan.status==='running');
}
async function runTamanContactResearchFromBtn(btn){
  if(teleState.queueingTown||!teleState.data)return;
  var tm=findTaman(btn.getAttribute('data-place'));
  if(!tm)return;
  var n=tm.contactPending||0;
  if(!n){showToast('Nothing to research at '+tm.name+'.');return}
  if(!window.confirm('Run contact research for '+n+' leads in '+tm.name+'? They run through the queue one after another.'))return;
  var origText=btn.textContent;
  teleState.queueingTown=true;
  btn.disabled=true;
  btn.textContent='Queueing\u2026';
  try{
    var body=await api('/api/territories/contact-research',{method:'POST',body:JSON.stringify({state:el('teleStateSelect')?el('teleStateSelect').value:'johor',taman:tm.name,queryPlace:tm.queryPlace,requesterId:'telemarketing:'+tm.name})});
    showToast('Queued '+body.queued+' contact research for '+tm.name+(body.alreadyRunning?' · '+body.alreadyRunning+' already running':'')+(body.failed?' · '+body.failed+' failed':''));
    await loadTelemarketingView();
  }catch(err){
    if(!authLost(err))showToast('Failed to start research: '+err.message);
  }finally{teleState.queueingTown=false;btn.disabled=false;btn.textContent=origText}
}
async function queueTamanScanFromBtn(btn){
  if(teleState.queueingTown||!teleState.data)return;
  var tm=findTaman(btn.getAttribute('data-place'));
  if(!tm)return;
  var keywords=(btn.getAttribute('data-keywords')||'business').split(',').filter(function(kw){return !tamanKeywordActive(tm,kw)});
  if(!keywords.length){showToast(tm.name+' is already scanning for that.');return}
  var maxInput=el('teleMaxResults');
  var maxCount=maxInput?Number(maxInput.value)||2000:2000;
  var group=btn.parentNode&&btn.parentNode.querySelectorAll?btn.parentNode.querySelectorAll('.taman-scan-action'):[btn];
  var origText=btn.textContent;
  teleState.queueingTown=true;
  Array.prototype.forEach.call(group,function(b){b.disabled=true});
  var queued=0,failed=0;
  try{
    for(var i=0;i<keywords.length;i++){
      if(!state.token)break;
      btn.textContent='Queueing…';
      try{
        var body=await api('/api/business-search',{method:'POST',body:JSON.stringify({keyword:keywords[i],place:tm.queryPlace,max:maxCount,requesterId:'telemarketing:'+tm.name})});
        queued++;
        upsertJob(body.report,'search');
        poll(body.report,'search');
      }catch(err){
        failed++;
        if(authLost(err))break;
      }
    }
    btn.textContent=origText;
    await loadTelemarketingView();
    showToast('Queued '+keywords.join(' + ')+' scan for '+tm.name+(failed?' · '+failed+' failed to queue':'')+(state.token?'':' · access expired'));
  }finally{teleState.queueingTown=false;btn.textContent=origText;Array.prototype.forEach.call(group,function(b){b.disabled=false})}
}
async function openTamanAssignModal(btn){
  var taman=btn.getAttribute('data-taman')||'';
  var town=btn.getAttribute('data-town')||'';
  var dist=btn.getAttribute('data-dist')||'';
  var place=btn.getAttribute('data-place')||'';
  var pId=btn.getAttribute('data-public-id')||'';
  var count=Number(btn.getAttribute('data-count'))||0;
  var currentAssigned=btn.getAttribute('data-assigned')||'';

  var modal=el('tamanAssignModal');
  if(!modal)return;
  el('tamanAssignTaman').value=taman;
  el('tamanAssignTown').value=town;
  el('tamanAssignDistrict').value=dist;
  el('tamanAssignQueryPlace').value=place;
  el('tamanAssignPublicId').value=pId;

  el('tamanModalTitle').textContent=(currentAssigned?'Reassign':'Assign')+' Leads · '+taman;
  var subText=town+(dist?' ('+dist+')':'');
  if(count>0) subText+=' · '+count+' lead'+(count===1?'':'s')+' will be assigned';
  else subText+=' · 0 leads scanned yet (will auto-assign upon scan)';
  el('tamanModalSub').textContent=subText;

  var curBox=el('tamanModalCurrentAssignee');
  var curName=el('tamanCurrentAssigneeName');
  var unassignBtn=el('tamanUnassignBtn');
  if(currentAssigned){
    if(curBox)curBox.style.display='block';
    if(curName)curName.textContent=currentAssigned;
    if(unassignBtn)unassignBtn.style.display='inline-block';
    el('tamanAssignSubmitBtn').textContent='Update Assignment';
  }else{
    if(curBox)curBox.style.display='none';
    if(unassignBtn)unassignBtn.style.display='none';
    el('tamanAssignSubmitBtn').textContent=count>0?'Assign '+count+' Leads':'Assign Taman';
  }

  if(!leadState.telemarketers||!leadState.telemarketers.length){
    await loadTelemarketers();
  }
  var sel=el('tamanAssignTeleSelect');
  if(sel){
    var opts='<option value="">Choose telemarketer...</option>';
    (leadState.telemarketers||[]).forEach(function(a){
      var val=agentValue(a);
      var selected=(currentAssigned && (a.name.toLowerCase()===currentAssigned.toLowerCase() || (a.uid && currentAssigned==='uid:'+a.uid)))?' selected':'';
      opts+='<option value="'+attr(val)+'"'+selected+'>'+esc(agentLabel(a))+'</option>';
    });
    sel.innerHTML=opts;
  }
  modal.classList.remove('hidden');
}
function closeTamanAssignModal(){
  var modal=el('tamanAssignModal');
  if(modal)modal.classList.add('hidden');
}
async function submitTamanAssign(e){
  if(e&&e.preventDefault)e.preventDefault();
  var taman=el('tamanAssignTaman').value;
  var town=el('tamanAssignTown').value;
  var dist=el('tamanAssignDistrict').value;
  var place=el('tamanAssignQueryPlace').value;
  var pId=el('tamanAssignPublicId').value;
  var sel=el('tamanAssignTeleSelect');
  var tele=sel?sel.value.trim():'';
  if(!tele){showToast('Please select a telemarketer.');return}
  var btn=el('tamanAssignSubmitBtn');
  if(btn){btn.disabled=true;btn.textContent='Assigning…'}
  try{
    var res=await api('/api/territories/assign',{
      method:'POST',
      body:JSON.stringify({
        state:el('teleStateSelect')?el('teleStateSelect').value:'johor',
        taman:taman,
        town:town,
        district:dist,
        queryPlace:place,
        publicId:pId,
        assignedTo:tele
      })
    });
    var assignedName=res.assignedTo||tele;
    if(teleState.data&&teleState.data.districts){
      teleState.data.districts.forEach(function(d){
        (d.towns||[]).forEach(function(t){
          (t.tamans||[]).forEach(function(tm){
            if(tm.name===taman||tm.queryPlace===place){
              tm.assignedTo=assignedName;
              if(tm.scan)tm.scan.assignedTo=assignedName;
            }
          });
        });
      });
    }
    closeTamanAssignModal();
    renderTerritoryCards();
    showToast('Assigned '+(res.updated||0)+' leads in '+taman+' to '+assignedName);
  }catch(err){
    if(!authLost(err))showToast('Failed to assign: '+err.message);
  }finally{
    if(btn){btn.disabled=false;btn.textContent='Assign All Leads'}
  }
}
async function submitTamanUnassign(){
  var taman=el('tamanAssignTaman').value;
  var place=el('tamanAssignQueryPlace').value;
  var pId=el('tamanAssignPublicId').value;
  if(!window.confirm('Unassign leads in '+taman+'?'))return;
  var btn=el('tamanUnassignBtn');
  if(btn){btn.disabled=true;btn.textContent='Unassigning…'}
  try{
    var res=await api('/api/territories/unassign',{
      method:'POST',
      body:JSON.stringify({
        state:el('teleStateSelect')?el('teleStateSelect').value:'johor',
        taman:taman,
        queryPlace:place,
        publicId:pId
      })
    });
    if(teleState.data&&teleState.data.districts){
      teleState.data.districts.forEach(function(d){
        (d.towns||[]).forEach(function(t){
          (t.tamans||[]).forEach(function(tm){
            if(tm.name===taman||tm.queryPlace===place){
              delete tm.assignedTo;
              if(tm.scan)delete tm.scan.assignedTo;
            }
          });
        });
      });
    }
    closeTamanAssignModal();
    renderTerritoryCards();
    showToast('Unassigned leads in '+taman);
  }catch(err){
    if(!authLost(err))showToast('Failed to unassign: '+err.message);
  }finally{
    if(btn){btn.disabled=false;btn.textContent='Unassign'}
  }
}
var activityState = {
  days: 7,
  startDate: '',
  endDate: '',
  sortBy: 'interested',
  teleFilter: 'all',
  logLimit: 25,
  logOffset: 0,
  logTotal: 0,
  search: '',
  statusFilter: 'all',
  agents: [],
  stats: null,
  log: []
};

function onActivityTimeframeChange(){
  var dSel = el('activityDaysSelect');
  if(!dSel) return;
  var val = dSel.value;
  var cInputs = el('activityCustomDateInputs');

  if(val === 'custom'){
    if(cInputs) cInputs.classList.remove('hidden');
    var sInput = el('actStartDate');
    var eInput = el('actEndDate');
    var now = new Date();
    var todayStr = now.getFullYear() + '-' + ('0' + (now.getMonth() + 1)).slice(-2) + '-' + ('0' + now.getDate()).slice(-2);
    if(sInput && !sInput.value){
      var d7 = new Date(Date.now() - 6 * 86400000);
      sInput.value = d7.getFullYear() + '-' + ('0' + (d7.getMonth() + 1)).slice(-2) + '-' + ('0' + d7.getDate()).slice(-2);
    }
    if(eInput && !eInput.value){
      eInput.value = todayStr;
    }
    activityState.startDate = (sInput && sInput.value) || '';
    activityState.endDate = (eInput && eInput.value) || '';
    loadActivityView();
    return;
  }

  if(cInputs) cInputs.classList.add('hidden');

  if(val === 'yesterday'){
    var yest = new Date(Date.now() - 86400000);
    var yStr = yest.getFullYear() + '-' + ('0' + (yest.getMonth() + 1)).slice(-2) + '-' + ('0' + yest.getDate()).slice(-2);
    activityState.startDate = yStr;
    activityState.endDate = yStr;
    activityState.days = 1;
    loadActivityView();
    return;
  }

  if(val === 'this_month'){
    var now = new Date();
    var mStart = now.getFullYear() + '-' + ('0' + (now.getMonth() + 1)).slice(-2) + '-01';
    var todayStr = now.getFullYear() + '-' + ('0' + (now.getMonth() + 1)).slice(-2) + '-' + ('0' + now.getDate()).slice(-2);
    activityState.startDate = mStart;
    activityState.endDate = todayStr;
    loadActivityView();
    return;
  }

  // Numeric days: 1, 3, 7, 14, 30
  activityState.startDate = '';
  activityState.endDate = '';
  activityState.days = Number(val) || 7;
  loadActivityView();
}

async function loadActivityView(){
  if(!state.token) return;
  var dSel = el('activityDaysSelect');
  var mode = dSel ? dSel.value : '7';
  if(mode === 'custom'){
    var sInput = el('actStartDate');
    var eInput = el('actEndDate');
    if(sInput && sInput.value) activityState.startDate = sInput.value;
    if(eInput && eInput.value) activityState.endDate = eInput.value;
  }
  var tSel = el('activityTeleFilter');
  if(tSel) activityState.teleFilter = tSel.value || 'all';

  await Promise.all([
    loadActivityStats(),
    loadActivityLog()
  ]);
}

async function loadActivityStats(){
  try{
    var q = '/api/lead-activity/stats?sortBy=' + encodeURIComponent(activityState.sortBy || 'interested');
    if(activityState.startDate && activityState.endDate){
      q += '&startDate=' + encodeURIComponent(activityState.startDate) + '&endDate=' + encodeURIComponent(activityState.endDate);
    } else {
      q += '&days=' + activityState.days;
    }
    if(activityState.teleFilter && activityState.teleFilter !== 'all'){
      q += '&telemarketer=' + encodeURIComponent(activityState.teleFilter);
    }
    var body = await api(q);
    if(body && body.stats){
      activityState.stats = body.stats;
      renderActivityKPIs(body.stats.kpis || {});
      renderDailyProcessedChart(body.stats.dailyLeadProcessed || []);
      renderProgressByStatus(body.stats.dailyLeadProcessed || [], body.stats.progressByStatus || []);
      renderTelemarketerActivitySummary(body.stats.perTelemarketerSummary || []);
      renderLeaderboard(body.stats.topLeaders || [], body.stats.dateRange || {});
      populateActivityTeleSelectors(body.stats.perTelemarketerSummary || []);
    }
  }catch(err){
    if(!authLost(err)) showToast('Failed to load activity stats: ' + err.message);
  }
}

function renderActivityKPIs(kpis){
  var eProc = el('actKpiProcessed');
  var eToday = el('actKpiToday');
  var eCont = el('actKpiContacted');
  var eInt = el('actKpiInterested');
  var eConv = el('actKpiConversion');
  var eAgents = el('actKpiAgents');

  if(eProc) eProc.textContent = kpis.totalActivities || 0;
  if(eToday) eToday.textContent = kpis.processedToday || 0;
  if(eCont) eCont.textContent = kpis.totalContacted || 0;
  if(eInt) eInt.textContent = kpis.totalInterested || 0;
  if(eConv) eConv.textContent = (kpis.conversionRate || 0) + '%';
  if(eAgents) eAgents.textContent = kpis.activeTelemarketers || 0;
}

function renderDailyProcessedChart(daily){
  var cont = el('activityDailyChartContainer');
  if(!cont) return;
  if(!daily || !daily.length){
    cont.innerHTML = '<div class="empty">No activity records found in this timeframe. Click "⚡ Generate Mock Data" to populate realistic presentation statistics.</div>';
    return;
  }

  var maxTotal = 1;
  var sumTotal = 0;
  daily.forEach(function(d){
    if(d.total > maxTotal) maxTotal = d.total;
    sumTotal += d.total;
  });

  if(sumTotal === 0){
    cont.innerHTML = '<div style="padding:28px 24px;text-align:center;background:#f8faff;border:1px dashed #93c5fd;border-radius:8px;margin-bottom:12px;">'
      + '<div style="font-size:26px;margin-bottom:8px;">⚡</div>'
      + '<div style="font-weight:700;font-size:16px;color:#1e40af;margin-bottom:6px;">No Presentation Mock Data Active Yet</div>'
      + '<p style="font-size:13px;color:#3b82f6;max-width:540px;margin:0 auto 16px;line-height:1.45;">'
      + 'The database starts in a clean default state to keep all real leads 100% safe. Click the button below to generate realistic outreach volume, pipeline progress, and telemarketer velocity for your presentation.'
      + '</p>'
      + '<button class="primary" type="button" onclick="openMockDataModal()" style="height:40px;padding:0 22px;background:#2563eb;font-weight:600;font-size:13.5px;box-shadow:0 2px 4px rgba(37,99,235,0.2);">⚡ Generate Mock Data Now</button>'
      + '</div>';
    return;
  }

  var avgDaily = Math.round((sumTotal / Math.max(daily.length, 1)) * 10) / 10;

  var html = '<div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;margin-bottom:18px;">'
    + '<div style="font:600 13px/1 var(--sans);color:var(--ink);">'
    + 'Campaign Outreach Volume: <strong style="font-size:16px;color:var(--accent);">' + sumTotal + ' leads processed</strong>'
    + ' <span style="color:var(--muted);font-size:12px;">(Avg ' + avgDaily + ' leads / day)</span>'
    + '</div>'
    + '<div class="act-legend">'
    + '<span class="act-legend-item"><span class="act-legend-pip" style="background:#15785a;"></span> Interested</span>'
    + '<span class="act-legend-item"><span class="act-legend-pip" style="background:#d97706;"></span> Contacted</span>'
    + '<span class="act-legend-item"><span class="act-legend-pip" style="background:#dc2626;"></span> Not Interested</span>'
    + '<span class="act-legend-item"><span class="act-legend-pip" style="background:#4b5563;"></span> DNC</span>'
    + '<span class="act-legend-item"><span class="act-legend-pip" style="background:#2563eb;"></span> Assigned</span>'
    + '</div>'
    + '</div>';

  html += '<div class="act-chart-wrap">';
  var chronDaily = daily.slice().reverse();
  chronDaily.forEach(function(d){
    var pctHeight = Math.max(Math.round((d.total / maxTotal) * 160), 6);
    var pInt = d.total > 0 ? (d.interested / d.total) * pctHeight : 0;
    var pCont = d.total > 0 ? (d.contacted / d.total) * pctHeight : 0;
    var pNotInt = d.total > 0 ? (d.not_interested / d.total) * pctHeight : 0;
    var pDnc = d.total > 0 ? (d.do_not_call / d.total) * pctHeight : 0;
    var pAss = d.total > 0 ? (d.assigned / d.total) * pctHeight : 0;

    html += '<div class="act-bar-col">'
      + '<span class="act-bar-val">' + d.total + '</span>'
      + '<div class="act-bar-stack" style="height:' + pctHeight + 'px;" title="' + attr(d.displayDate) + ': ' + d.total + ' leads processed (' + d.interested + ' interested, ' + d.contacted + ' contacted)">'
      + (pAss > 0 ? '<div class="act-bar-seg" style="height:' + pAss + 'px;background:#2563eb;"></div>' : '')
      + (pDnc > 0 ? '<div class="act-bar-seg" style="height:' + pDnc + 'px;background:#4b5563;"></div>' : '')
      + (pNotInt > 0 ? '<div class="act-bar-seg" style="height:' + pNotInt + 'px;background:#dc2626;"></div>' : '')
      + (pCont > 0 ? '<div class="act-bar-seg" style="height:' + pCont + 'px;background:#d97706;"></div>' : '')
      + (pInt > 0 ? '<div class="act-bar-seg" style="height:' + pInt + 'px;background:#15785a;"></div>' : '')
      + '</div>'
      + '<span class="act-bar-lbl">' + esc(d.displayDate.split(' ')[0]) + '</span>'
      + '</div>';
  });
  html += '</div>';

  cont.innerHTML = html;
}

function renderProgressByStatus(daily, statusOverview){
  var cont = el('activityProgressContainer');
  if(!cont) return;
  if(!daily || !daily.length){
    cont.innerHTML = '<div class="empty">No progress data to display.</div>';
    return;
  }

  var html = '<div style="margin-bottom:20px;">'
    + '<div style="font:700 11px/1 var(--sans);letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin-bottom:12px;">Overall Lead Pipeline Status Breakdown</div>'
    + '<div class="act-progress-bar" style="height:14px;border-radius:7px;margin-bottom:14px;">';

  statusOverview.forEach(function(s){
    if(s.percentage > 0){
      html += '<div style="width:' + s.percentage + '%;background:' + s.color + ';" title="' + attr(s.label) + ': ' + s.count + ' (' + s.percentage + '%)"></div>';
    }
  });
  html += '</div>';

  html += '<div style="display:flex;flex-wrap:wrap;gap:12px 20px;">';
  statusOverview.forEach(function(s){
    html += '<div style="display:flex;align-items:center;gap:8px;font-size:12.5px;">'
      + '<span style="width:10px;height:10px;border-radius:2px;background:' + s.color + ';"></span>'
      + '<span style="color:var(--muted);">' + esc(s.label) + ':</span>'
      + '<strong>' + s.count + '</strong>'
      + '<span style="color:var(--faint);font-size:11px;">(' + s.percentage + '%)</span>'
      + '</div>';
  });
  html += '</div></div>';

  html += '<div style="margin-top:24px;overflow-x:auto;">'
    + '<div style="font:700 11px/1 var(--sans);letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin-bottom:10px;">Daily Progress Per Day Per Status Type</div>'
    + '<table class="act-table">'
    + '<thead><tr>'
    + '<th>Date</th>'
    + '<th style="text-align:center;">Total</th>'
    + '<th style="text-align:center;color:#d97706;">📞 Contacted</th>'
    + '<th style="text-align:center;color:#15785a;">⭐ Interested</th>'
    + '<th style="text-align:center;color:#dc2626;">❌ Not Interested</th>'
    + '<th style="text-align:center;color:#4b5563;">⛔ DNC</th>'
    + '<th style="text-align:center;color:#2563eb;">⏳ Assigned</th>'
    + '<th style="text-align:right;">Win Rate</th>'
    + '</tr></thead><tbody>';

  var totAll = 0, totCont = 0, totInt = 0, totNot = 0, totDnc = 0, totAss = 0;
  daily.forEach(function(row){
    totAll += row.total;
    totCont += row.contacted;
    totInt += row.interested;
    totNot += row.not_interested;
    totDnc += row.do_not_call;
    totAss += row.assigned;

    var proc = row.contacted + row.interested + row.not_interested + row.do_not_call;
    var wr = proc > 0 ? (Math.round((row.interested / proc) * 1000) / 10) + '%' : '0%';

    html += '<tr>'
      + '<td><strong>' + esc(row.displayDate) + '</strong> <span style="font-size:11px;color:var(--muted);">(' + esc(row.date) + ')</span></td>'
      + '<td style="text-align:center;font-weight:700;">' + row.total + '</td>'
      + '<td style="text-align:center;color:#d97706;font-weight:600;">' + row.contacted + '</td>'
      + '<td style="text-align:center;color:#15785a;font-weight:700;">' + row.interested + '</td>'
      + '<td style="text-align:center;color:#dc2626;">' + row.not_interested + '</td>'
      + '<td style="text-align:center;color:#4b5563;">' + row.do_not_call + '</td>'
      + '<td style="text-align:center;color:#2563eb;">' + row.assigned + '</td>'
      + '<td style="text-align:right;font-weight:700;color:' + (row.interested > 0 ? 'var(--ok)' : 'var(--muted)') + ';">' + wr + '</td>'
      + '</tr>';
  });

  var grandProc = totCont + totInt + totNot + totDnc;
  var grandWr = grandProc > 0 ? (Math.round((totInt / grandProc) * 1000) / 10) + '%' : '0%';
  html += '<tr style="background:#f8f9fa;font-weight:700;border-top:2px solid var(--ink);">'
    + '<td>Campaign Total</td>'
    + '<td style="text-align:center;">' + totAll + '</td>'
    + '<td style="text-align:center;color:#d97706;">' + totCont + '</td>'
    + '<td style="text-align:center;color:#15785a;">' + totInt + '</td>'
    + '<td style="text-align:center;color:#dc2626;">' + totNot + '</td>'
    + '<td style="text-align:center;color:#4b5563;">' + totDnc + '</td>'
    + '<td style="text-align:center;color:#2563eb;">' + totAss + '</td>'
    + '<td style="text-align:right;color:var(--ok);">' + grandWr + '</td>'
    + '</tr>';

  html += '</tbody></table></div>';
  cont.innerHTML = html;
}

function renderTelemarketerActivitySummary(summary){
  var cont = el('activityTeleSummaryContainer');
  if(!cont) return;
  if(!summary || !summary.length){
    cont.innerHTML = '<div class="empty">No telemarketer performance records available.</div>';
    return;
  }

  var html = '';
  summary.forEach(function(ag){
    var initials = (ag.name || 'TM').split(' ').map(function(s){return s[0]}).join('').slice(0, 2).toUpperCase();
    var convColor = ag.conversion_rate >= 15 ? 'var(--ok)' : ag.conversion_rate > 5 ? 'var(--accent)' : 'var(--muted)';
    var pInt = ag.total_processed > 0 ? (ag.interested / ag.total_processed) * 100 : 0;
    var pCont = ag.total_processed > 0 ? (ag.contacted / ag.total_processed) * 100 : 0;
    var pNotInt = ag.total_processed > 0 ? (ag.not_interested / ag.total_processed) * 100 : 0;
    var pDnc = ag.total_processed > 0 ? (ag.do_not_call / ag.total_processed) * 100 : 0;

    html += '<article class="agent-card" style="padding:18px;">'
      + '<div class="agent-card-head">'
      + '<div class="agent-avatar" style="background:var(--ink);">' + esc(initials) + '</div>'
      + '<div class="agent-meta-block">'
      + '<div class="agent-name">' + esc(ag.name)
      + (ag.uid ? '<span style="font:600 9px/1 var(--mono);background:#e0e7ff;color:var(--accent);padding:2px 6px;border-radius:3px;">' + esc(ag.uid) + '</span>' : '')
      + '</div>'
      + '<div style="font-size:12px;color:var(--muted);margin-top:3px;">'
      + 'Assigned: <strong>' + ag.total_assigned + ' leads</strong> · Velocity: <strong>' + ag.daily_avg + ' calls/day</strong>'
      + '</div>'
      + '</div>'
      + '<div style="text-align:right;">'
      + '<div style="font:750 14px/1 var(--mono);color:' + convColor + ';">' + ag.conversion_rate + '%</div>'
      + '<div style="font:700 7.5px/1 var(--sans);text-transform:uppercase;color:var(--muted);margin-top:3px;">Win Rate</div>'
      + '</div>'
      + '</div>'
      + '<div style="margin:10px 0 6px;">'
      + '<div class="act-progress-bar" style="height:8px;border-radius:4px;">'
      + '<div style="width:' + pInt + '%;background:#15785a;" title="Interested: ' + ag.interested + '"></div>'
      + '<div style="width:' + pCont + '%;background:#d97706;" title="Contacted: ' + ag.contacted + '"></div>'
      + '<div style="width:' + pNotInt + '%;background:#dc2626;" title="Not Interested: ' + ag.not_interested + '"></div>'
      + '<div style="width:' + pDnc + '%;background:#4b5563;" title="DNC: ' + ag.do_not_call + '"></div>'
      + '</div>'
      + '</div>'
      + '<div class="agent-metrics-row">'
      + '<div class="agent-metric-item"><div class="agent-metric-num" style="color:var(--ok);">' + ag.interested + '</div><div class="agent-metric-lbl">⭐ Won</div></div>'
      + '<div class="agent-metric-item"><div class="agent-metric-num" style="color:var(--warn);">' + ag.contacted + '</div><div class="agent-metric-lbl">📞 In Prog</div></div>'
      + '<div class="agent-metric-item"><div class="agent-metric-num">' + ag.pending + '</div><div class="agent-metric-lbl">⏳ Queue</div></div>'
      + '<div class="agent-metric-item"><div class="agent-metric-num" style="color:var(--bad);">' + ag.not_interested + '</div><div class="agent-metric-lbl">❌ Lost</div></div>'
      + '</div>'
      + (ag.last_active ? '<div style="font-size:11px;color:var(--faint);margin-top:4px;">Last active: ' + date(ag.last_active) + '</div>' : '')
      + '</article>';
  });

  cont.innerHTML = html;
}

function populateActivityTeleSelectors(summary){
  var tSel = el('activityTeleFilter');
  var mSel = el('manualActTele');
  if(!tSel) return;
  var curVal = tSel.value || 'all';

  var opts = '<option value="all">👥 All Telemarketers</option>';
  var mOpts = '<option value="">Choose telemarketer...</option>';
  summary.forEach(function(ag){
    var sel = (ag.name === curVal) ? ' selected' : '';
    opts += '<option value="' + attr(ag.name) + '"' + sel + '>' + esc(ag.name) + ' (' + ag.total_processed + ' calls)</option>';
    mOpts += '<option value="' + attr(ag.name) + '">' + esc(ag.name) + '</option>';
  });

  tSel.innerHTML = opts;
  if(mSel) mSel.innerHTML = mOpts;
}

function setLeaderboardSort(sortBy){
  activityState.sortBy = sortBy;
  var btns = {
    'interested': 'btnSortInterested',
    'processed': 'btnSortProcessed',
    'conversion': 'btnSortConversion',
    'contacted': 'btnSortContacted'
  };
  Object.keys(btns).forEach(function(k){
    var b = el(btns[k]);
    if(b){
      if(k === sortBy) b.classList.add('active');
      else b.classList.remove('active');
    }
  });
  loadActivityStats();
}

function renderLeaderboard(leaders, dateRange){
  var dInfo = el('leaderboardDateInfo');
  if(dInfo){
    if(dateRange && dateRange.startDate && dateRange.endDate){
      dInfo.textContent = '📅 ' + dateRange.startDate + ' to ' + dateRange.endDate + ' (' + dateRange.days + ' days)';
    } else {
      dInfo.textContent = '📅 Last ' + activityState.days + ' Days';
    }
  }

  var podCont = el('leaderboardPodiumContainer');
  var tblCont = el('leaderboardTableContainer');
  if(!tblCont) return;

  if(!leaders || !leaders.length){
    if(podCont) podCont.innerHTML = '';
    tblCont.innerHTML = '<div class="empty">No telemarketer outreach records found for this date range. Click "⚡ Generate Mock Data" to populate realistic leaderboard rankings.</div>';
    return;
  }

  // 1. Render Top 3 Podium
  if(podCont){
    var top3 = leaders.slice(0, 3);
    var podHtml = '';
    top3.forEach(function(ag){
      var rClass = ag.rank === 1 ? 'rank-1' : (ag.rank === 2 ? 'rank-2' : 'rank-3');
      var tagClass = ag.rank === 1 ? 'gold' : (ag.rank === 2 ? 'silver' : 'bronze');
      var initials = (ag.name || 'TM').split(' ').map(function(s){return s[0]}).join('').slice(0, 2).toUpperCase();
      var avatarBg = ag.rank === 1 ? '#b45309' : (ag.rank === 2 ? '#475569' : '#c2410c');

      podHtml += '<div class="act-podium-card ' + rClass + '">'
        + '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;">'
        + '<span class="act-rank-tag ' + tagClass + '">' + esc(ag.tier_label || ('#' + ag.rank)) + '</span>'
        + '<span style="font:700 12px/1 var(--mono);color:var(--muted);">Rank #' + ag.rank + '</span>'
        + '</div>'
        + '<div style="display:flex;align-items:center;gap:12px;margin-bottom:16px;">'
        + '<div class="agent-avatar" style="background:' + avatarBg + ';color:#fff;width:44px;height:44px;font-size:16px;">' + esc(initials) + '</div>'
        + '<div style="flex:1;min-width:0;">'
        + '<div style="font-weight:750;font-size:15px;color:var(--ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + esc(ag.name) + '</div>'
        + (ag.uid ? '<div style="font:600 10px/1 var(--mono);color:var(--accent);margin-top:3px;">' + esc(ag.uid) + '</div>' : '')
        + '</div>'
        + '</div>'
        + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;padding:12px;background:rgba(255,255,255,0.7);border:1px solid rgba(0,0,0,0.06);border-radius:6px;margin-bottom:12px;">'
        + '<div>'
        + '<div style="font:700 18px/1 var(--mono);color:var(--ok);">' + ag.interested + '</div>'
        + '<div style="font:700 8.5px/1 var(--sans);color:var(--muted);text-transform:uppercase;margin-top:3px;">⭐ Won Leads</div>'
        + '</div>'
        + '<div>'
        + '<div style="font:700 18px/1 var(--mono);color:var(--accent);">' + ag.conversion_rate + '%</div>'
        + '<div style="font:700 8.5px/1 var(--sans);color:var(--muted);text-transform:uppercase;margin-top:3px;">📈 Win Rate</div>'
        + '</div>'
        + '<div>'
        + '<div style="font:700 15px/1 var(--mono);color:var(--ink);">' + ag.total_processed + '</div>'
        + '<div style="font:700 8.5px/1 var(--sans);color:var(--muted);text-transform:uppercase;margin-top:3px;">📞 Calls Made</div>'
        + '</div>'
        + '<div>'
        + '<div style="font:700 15px/1 var(--mono);color:var(--warn);">' + ag.contacted + '</div>'
        + '<div style="font:700 8.5px/1 var(--sans);color:var(--muted);text-transform:uppercase;margin-top:3px;">💬 Contacted</div>'
        + '</div>'
        + '</div>'
        + '<div style="font-size:11.5px;color:var(--muted);display:flex;justify-content:space-between;margin-top:auto;">'
        + '<span>Velocity: <strong>' + ag.daily_avg + ' calls/day</strong></span>'
        + (ag.last_active ? '<span>Active ' + date(ag.last_active) + '</span>' : '')
        + '</div>'
        + '</div>';
    });
    podCont.innerHTML = podHtml;
  }

  // 2. Render Ranked Table (Ranks 1 to 10)
  var tblHtml = '<table class="act-table">'
    + '<thead><tr>'
    + '<th style="width:60px;text-align:center;">Rank</th>'
    + '<th>Telemarketer</th>'
    + '<th style="text-align:center;color:#15785a;">⭐ Conversions (Wins)</th>'
    + '<th style="text-align:center;color:#d97706;">📞 Contacted</th>'
    + '<th style="text-align:center;">Total Calls Processed</th>'
    + '<th style="text-align:center;">Win Rate %</th>'
    + '<th style="text-align:center;">Daily Velocity</th>'
    + '<th style="text-align:center;">Assigned Queue</th>'
    + '<th style="text-align:right;">Performance Tier</th>'
    + '</tr></thead><tbody>';

  leaders.forEach(function(ag){
    var tagClass = ag.rank === 1 ? 'gold' : (ag.rank === 2 ? 'silver' : (ag.rank === 3 ? 'bronze' : 'default'));
    var rankDisplay = ag.rank === 1 ? '🥇 #1' : (ag.rank === 2 ? '🥈 #2' : (ag.rank === 3 ? '🥉 #3' : '#' + ag.rank));
    var convColor = ag.conversion_rate >= 15 ? 'var(--ok)' : (ag.conversion_rate > 5 ? 'var(--accent)' : 'var(--muted)');
    var initials = (ag.name || 'TM').split(' ').map(function(s){return s[0]}).join('').slice(0, 2).toUpperCase();

    tblHtml += '<tr>'
      + '<td style="text-align:center;font-weight:750;font-family:var(--mono);font-size:13px;">' + rankDisplay + '</td>'
      + '<td>'
      + '<div style="display:flex;align-items:center;gap:10px;">'
      + '<div class="agent-avatar" style="width:28px;height:28px;font-size:11px;background:var(--ink);">' + esc(initials) + '</div>'
      + '<div>'
      + '<div style="font-weight:700;color:var(--ink);font-size:13.5px;">' + esc(ag.name) + '</div>'
      + (ag.uid ? '<div style="font:600 9.5px/1 var(--mono);color:var(--muted);margin-top:2px;">' + esc(ag.uid) + '</div>' : '')
      + '</div>'
      + '</div>'
      + '</td>'
      + '<td style="text-align:center;font-weight:750;font-size:14px;color:#15785a;">' + ag.interested + '</td>'
      + '<td style="text-align:center;font-weight:600;color:#d97706;">' + ag.contacted + '</td>'
      + '<td style="text-align:center;font-weight:600;">' + ag.total_processed + '</td>'
      + '<td style="text-align:center;font-weight:750;font-family:var(--mono);color:' + convColor + ';">' + ag.conversion_rate + '%</td>'
      + '<td style="text-align:center;font-size:12.5px;">' + ag.daily_avg + ' /day</td>'
      + '<td style="text-align:center;color:var(--muted);">' + ag.total_assigned + '</td>'
      + '<td style="text-align:right;"><span class="act-rank-tag ' + tagClass + '" style="font-size:10px;">' + esc(ag.tier_label || 'Outreach Agent') + '</span></td>'
      + '</tr>';
  });

  tblHtml += '</tbody></table>';
  tblCont.innerHTML = tblHtml;
}

async function loadActivityLog(){
  try{
    var sInput = el('activitySearchInput');
    var sFilter = el('activityLogStatusFilter');
    var search = sInput ? sInput.value.trim() : '';
    var status = sFilter ? sFilter.value : 'all';

    var q = '/api/lead-activity/log?limit=' + activityState.logLimit + '&offset=' + activityState.logOffset;
    if(activityState.teleFilter && activityState.teleFilter !== 'all') q += '&telemarketer=' + encodeURIComponent(activityState.teleFilter);
    if(status && status !== 'all') q += '&status=' + encodeURIComponent(status);
    if(search) q += '&search=' + encodeURIComponent(search);

    var body = await api(q);
    activityState.log = body.activities || [];
    activityState.logTotal = body.total || 0;
    renderActivityLog(activityState.log);

    var pInfo = el('actPageInfo');
    if(pInfo){
      var from = activityState.logTotal ? activityState.logOffset + 1 : 0;
      var to = Math.min(activityState.logOffset + activityState.logLimit, activityState.logTotal);
      pInfo.textContent = 'Showing ' + from + ' - ' + to + ' of ' + activityState.logTotal + ' activities';
    }
    var bPrev = el('btnPrevAct');
    var bNext = el('btnNextAct');
    if(bPrev) bPrev.disabled = (activityState.logOffset <= 0);
    if(bNext) bNext.disabled = (activityState.logOffset + activityState.logLimit >= activityState.logTotal);
  }catch(err){
    if(!authLost(err)) showToast('Failed to load activity feed: ' + err.message);
  }
}

function prevActPage(){
  if(activityState.logOffset > 0){
    activityState.logOffset = Math.max(0, activityState.logOffset - activityState.logLimit);
    loadActivityLog();
  }
}

function nextActPage(){
  if(activityState.logOffset + activityState.logLimit < activityState.logTotal){
    activityState.logOffset += activityState.logLimit;
    loadActivityLog();
  }
}

function renderActivityLog(activities){
  var cont = el('activityLogFeedWrapper');
  if(!cont) return;
  if(!activities || !activities.length){
    cont.innerHTML = '<div class="empty">No call or status activities found. Click "⚡ Generate Mock Data" or "➕ Log Activity".</div>';
    return;
  }

  var html = '';
  activities.forEach(function(act){
    var pillColor = act.new_status === 'interested' ? 'background:#ecfdf5;color:#065f46;border:1px solid #a7f3d0;'
      : act.new_status === 'contacted' ? 'background:#fffbeb;color:#92400e;border:1px solid #fde68a;'
      : act.new_status === 'not_interested' ? 'background:#fef2f2;color:#991b1b;border:1px solid #fecaca;'
      : act.new_status === 'do_not_call' ? 'background:#f3f4f6;color:#374151;border:1px solid #d1d5db;'
      : 'background:#eff6ff;color:#1e40af;border:1px solid #bfdbfe;';

    var prevLabel = act.previous_status || 'unassigned';
    var newLabel = act.new_status || 'assigned';

    html += '<article class="lead-row" style="grid-template-columns:36px minmax(200px,1.2fr) minmax(180px,1fr) minmax(200px,1.2fr) auto;padding:16px 0;">'
      + '<div style="font:600 12px/1 var(--mono);color:var(--muted);padding-top:2px;">#' + act.id + '</div>'
      + '<div>'
      + '<h3 style="margin:0;font-size:15.5px;font-weight:700;">' + esc(act.company_name || 'Company #' + act.company_id) + '</h3>'
      + '<div class="meta">' + esc(act.company_category || 'Commercial Lead') + (act.company_phone ? ' · 📞 ' + esc(act.company_phone) : '') + '</div>'
      + (act.notes ? '<div class="act-note-bubble">' + esc(act.notes) + '</div>' : '')
      + '</div>'
      + '<div>'
      + '<div style="font-weight:700;font-size:13.5px;color:var(--ink);">' + esc(act.telemarketer_name || 'System / Auto') + '</div>'
      + '<div style="font:500 11px/1.4 var(--mono);color:var(--muted);margin-top:3px;">' + date(act.created_at) + '</div>'
      + '</div>'
      + '<div>'
      + '<span class="act-trans-pill" style="' + pillColor + '">'
      + esc(prevLabel) + ' → ' + esc(newLabel)
      + '</span>'
      + (act.is_mock ? '<span style="display:inline-block;margin-left:6px;font:650 8.5px/1 var(--sans);color:var(--accent);background:#eff6ff;padding:2px 5px;border-radius:3px;text-transform:uppercase;">Mock</span>' : '')
      + '</div>'
      + '<div class="company-actions">'
      + '<button class="filter" type="button" onclick="selectCompanyForManualAct(\'' + attr(act.company_id) + '\',\'' + attr(act.company_name || '') + '\')" style="height:32px;padding:0 10px;font-size:10px;">Update →</button>'
      + '</div>'
      + '</article>';
  });

  cont.innerHTML = html;
}

function openMockDataModal(){
  var m = el('mockDataModal');
  if(m) m.classList.remove('hidden');
}

function closeMockDataModal(){
  var m = el('mockDataModal');
  if(m) m.classList.add('hidden');
}

async function submitMockData(event){
  if(event) event.preventDefault();
  var count = Number(el('mockLeadCount').value) || 80;
  var days = Number(el('mockDaysSpan').value) || 7;
  var clearFirst = Boolean(el('mockClearFirst').checked);

  var btn = el('btnSubmitMock');
  if(btn){ btn.disabled = true; btn.textContent = 'Generating Simulation…'; }
  try{
    var res = await api('/api/lead-activity/mock-generate', {
      method: 'POST',
      body: JSON.stringify({ leadCount: count, daysSpan: days, clearFirst: clearFirst })
    });
    closeMockDataModal();
    showToast(res.message || 'Mock presentation data generated successfully!');
    await loadActivityView();
  }catch(err){
    if(!authLost(err)) showToast('Error generating mock data: ' + err.message);
  }finally{
    if(btn){ btn.disabled = false; btn.textContent = 'Generate Presentation Data'; }
  }
}

function openResetProgressModal(){
  var m = el('resetProgressModal');
  if(m) m.classList.remove('hidden');
}

function closeResetProgressModal(){
  var m = el('resetProgressModal');
  if(m) m.classList.add('hidden');
}

async function submitResetProgress(){
  var btn = el('btnConfirmReset');
  if(btn){ btn.disabled = true; btn.textContent = 'Wiping Progress…'; }
  try{
    var res = await api('/api/lead-activity/reset-progress', { method: 'POST' });
    closeResetProgressModal();
    showToast(res.message || 'Assignments and call statuses were reset. Do-not-call leads and remarks were kept.');
    await loadActivityView();
  }catch(err){
    if(!authLost(err)) showToast('Error resetting progress: ' + err.message);
  }finally{
    if(btn){ btn.disabled = false; btn.textContent = 'Confirm Reset (Clean Slate)'; }
  }
}

async function openManualActivityModal(){
  var m = el('manualActivityModal');
  if(!m) return;
  m.classList.remove('hidden');

  var cSel = el('manualActCompanyId');
  if(cSel && cSel.options.length <= 1){
    try{
      var body = await api('/api/leads?limit=100');
      var list = body.leads || [];
      var html = '<option value="">Choose company...</option>';
      list.forEach(function(l){
        html += '<option value="' + attr(l.id) + '">' + esc(l.name) + (l.phone ? ' (' + esc(l.phone) + ')' : '') + '</option>';
      });
      cSel.innerHTML = html;
    }catch(e){}
  }
}

function selectCompanyForManualAct(companyId, companyName){
  openManualActivityModal();
  setTimeout(function(){
    var cSel = el('manualActCompanyId');
    if(cSel){
      var opt = document.createElement('option');
      opt.value = companyId;
      opt.textContent = companyName || ('Company #' + companyId);
      opt.selected = true;
      cSel.appendChild(opt);
      cSel.value = companyId;
    }
  }, 50);
}

function closeManualActivityModal(){
  var m = el('manualActivityModal');
  if(m) m.classList.add('hidden');
}

async function submitManualActivity(event){
  if(event) event.preventDefault();
  var cId = el('manualActCompanyId').value;
  var status = el('manualActStatus').value;
  var tele = el('manualActTele').value;
  var notes = el('manualActNotes').value;

  if(!cId){
    showToast('Please select a company.');
    return;
  }
  var btn = el('btnSubmitManualAct');
  if(btn){ btn.disabled = true; btn.textContent = 'Saving…'; }
  try{
    await api('/api/lead-activity/record', {
      method: 'POST',
      body: JSON.stringify({ companyId: cId, status: status, telemarketer: tele, notes: notes })
    });
    closeManualActivityModal();
    showToast('Lead activity recorded successfully!');
    if(el('manualActNotes')) el('manualActNotes').value = '';
    await loadActivityView();
  }catch(err){
    if(!authLost(err)) showToast('Error saving activity: ' + err.message);
  }finally{
    if(btn){ btn.disabled = false; btn.textContent = 'Save Activity'; }
  }
}
(function boot(){var saved=eeKey.read();if(saved){el('accessKey').value=saved;connect()}else{setTimeout(function(){el('accessKey').focus()},80)}})();
</script></body></html>`;
  return kind === 'telemarketing' ? telemarketing(html) : kind === 'registrations' ? registrations(html) : html;
}
