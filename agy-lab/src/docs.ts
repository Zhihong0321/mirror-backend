// The API reference, served by the thing it documents.
//
// It lives here rather than in a README because a reference that ships with the
// service cannot drift from the deploy: the page a caller reads at /docs came out
// of the same image that is answering their requests. API.md stays as the source
// a reader browsing the repo finds; this is the one a consumer hits.
//
// body() is the page without the document wrapper, so the same markup can be
// published elsewhere. page() is what the server sends.
//
// Single palette, no light theme, on purpose: this is the console's own dark
// surface (the same tokens as ui.ts), and the page is read next to a terminal.
import { OPERATOR_NAV, navHtml } from './nav.ts';

export function body(): string {
  return String.raw`<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans:wght@400;500;600;700&display=swap">
<style>
  :root {
    --bg:#0f1115; --panel:#161920; --sunk:#0b0d11; --ink:#e9ecf1; --muted:#98a1ae;
    --faint:#6c7684; --line:#242932; --line-soft:#1c2027;
    --accent:#7aa2f7; --accent-sunk:#1b2537;
    --ok:#5fd4a0; --warn:#eec06a; --bad:#ff8b80;
    --sans:"IBM Plex Sans",ui-sans-serif,-apple-system,"Segoe UI",system-ui,sans-serif;
    --mono:"IBM Plex Mono",ui-monospace,Consolas,"SF Mono",monospace;
  }
  * { box-sizing:border-box; }
  html, body { max-width:100%; overflow-x:clip; }
  body { margin:0; background:var(--bg); color:var(--ink); font-family:var(--sans);
    font-size:15px; line-height:1.62; -webkit-font-smoothing:antialiased; }
  a { color:var(--accent); text-decoration:none; }
  a:hover { text-decoration:underline; }
  a:focus-visible, summary:focus-visible { outline:2px solid var(--accent); outline-offset:3px; border-radius:4px; }
  code { font-family:var(--mono); font-size:0.885em; }

  .doc { display:grid; grid-template-columns:236px minmax(0,1fr); gap:0; width:100%; max-width:1180px; margin:0 auto; overflow:hidden; }

  /* --- side nav ------------------------------------------------------- */
  .nav { position:sticky; top:0; align-self:start; height:100vh; overflow-y:auto;
    padding:34px 20px 40px; border-right:1px solid var(--line-soft); }
  .brand { font-family:var(--mono); font-size:13px; font-weight:600; letter-spacing:.02em;
    display:flex; align-items:center; gap:8px; }
  .brand .dot { width:7px; height:7px; border-radius:50%; background:var(--ok);
    box-shadow:0 0 0 3px rgba(95,212,160,.14); }
  .brand-sub { color:var(--faint); font-size:12px; margin:2px 0 22px 15px; }
  /* Cross-surface links, above the table of contents and looking unlike it:
     these leave the page, the anchors below do not. */
  .surfaces { display:flex; flex-direction:column; gap:1px; margin:0 0 6px;
    padding-bottom:14px; border-bottom:1px solid var(--line-soft); }
  .surfaces a { color:var(--ink); font-size:13.5px; font-weight:600; padding:4px 8px; border-radius:6px; }
  .surfaces a:hover { background:var(--panel); text-decoration:none; }
  .surfaces a[aria-current="page"] { color:var(--accent); }
  .nav nav { display:flex; flex-direction:column; gap:1px; }
  .nav nav a { color:var(--muted); font-size:13.5px; padding:4px 8px; border-radius:6px; }
  .nav nav a:hover { color:var(--ink); background:var(--panel); text-decoration:none; }
  .nav-label { font-family:var(--mono); font-size:10.5px; text-transform:uppercase;
    letter-spacing:.12em; color:var(--faint); margin:16px 0 5px 8px; }

  /* --- main ----------------------------------------------------------- */
  main { padding:34px 40px 100px; min-width:0; }
  section { padding-top:14px; margin-bottom:46px; scroll-margin-top:20px; }
  h1 { font-size:34px; line-height:1.15; font-weight:600; letter-spacing:-.022em; margin:6px 0 12px; text-wrap:balance; }
  h2 { font-size:21px; font-weight:600; letter-spacing:-.014em; margin:0 0 6px; text-wrap:balance;
    padding-bottom:9px; border-bottom:1px solid var(--line); }
  h3 { font-size:15px; font-weight:600; margin:26px 0 8px; letter-spacing:-.005em; }
  p { margin:11px 0; max-width:68ch; }
  .eyebrow { font-family:var(--mono); font-size:11px; text-transform:uppercase; letter-spacing:.14em;
    color:var(--faint); margin:0; }
  .lede { font-size:16.5px; color:var(--muted); max-width:64ch; }
  ul { margin:11px 0; padding-left:18px; max-width:68ch; }
  li { margin:5px 0; }
  li::marker { color:var(--faint); }
  strong { font-weight:600; }

  /* --- hero facts ----------------------------------------------------- */
  .facts { display:grid; grid-template-columns:repeat(auto-fit,minmax(250px,1fr)); gap:10px; margin:22px 0 4px; }
  .fact { background:var(--panel); border:1px solid var(--line); border-radius:10px; padding:12px 14px; }
  .fact .k { font-family:var(--mono); font-size:10.5px; text-transform:uppercase; letter-spacing:.12em;
    color:var(--faint); display:block; margin-bottom:5px; }
  .fact code { font-size:13px; color:var(--ink); word-break:break-all; }

  /* --- endpoint header ------------------------------------------------ */
  .ep { display:flex; align-items:center; gap:10px; flex-wrap:wrap; margin:24px 0 8px;
    padding:9px 12px; background:var(--panel); border:1px solid var(--line);
    border-left:3px solid var(--accent); border-radius:8px; }
  .ep .m { font-family:var(--mono); font-size:11px; font-weight:600; letter-spacing:.06em;
    padding:2px 7px; border-radius:5px; }
  .ep .m.get { color:var(--accent); background:var(--accent-sunk); }
  .ep .m.post { color:var(--ok); background:rgba(95,212,160,.12); }
  .ep .m.patch { color:var(--warn); background:rgba(238,192,106,.14); }
  .ep .path { font-size:14px; font-weight:500; color:var(--ink); }
  .ep .tag { font-size:12px; color:var(--faint); margin-left:auto; font-family:var(--mono); }

  /* --- tables --------------------------------------------------------- */
  .tbl { max-width:100%; overflow-x:auto; margin:14px 0; border:1px solid var(--line); border-radius:10px; }
  table { border-collapse:collapse; width:100%; font-size:13.5px; }
  th, td { text-align:left; padding:9px 13px; border-bottom:1px solid var(--line-soft); vertical-align:top; }
  th { font-family:var(--mono); font-size:10.5px; text-transform:uppercase; letter-spacing:.1em;
    color:var(--faint); font-weight:500; background:var(--sunk); white-space:nowrap; }
  tr:last-child td { border-bottom:none; }
  td code { color:var(--ink); white-space:nowrap; }
  td.num { font-variant-numeric:tabular-nums; white-space:nowrap; font-family:var(--mono); font-size:12.5px; }
  .req { font-family:var(--mono); font-size:10px; letter-spacing:.08em; color:var(--warn); }

  /* --- code ----------------------------------------------------------- */
  pre { max-width:100%; background:var(--sunk); border:1px solid var(--line); border-radius:10px;
    padding:14px 16px; overflow-x:auto; margin:14px 0; }
  pre code { font-size:12.6px; line-height:1.65; color:#c9d4e7; white-space:pre; }
  .cmt { color:var(--faint); }
  .str { color:#a3d9a5; }

  /* --- callouts ------------------------------------------------------- */
  .call { border:1px solid var(--line); border-left:3px solid var(--muted);
    background:var(--panel); border-radius:8px; padding:12px 15px; margin:16px 0; max-width:72ch; }
  .call p { margin:0; max-width:none; font-size:14px; }
  .call p + p { margin-top:8px; }
  .call .h { font-family:var(--mono); font-size:10.5px; text-transform:uppercase; letter-spacing:.12em;
    display:block; margin-bottom:5px; }
  .call.warn { border-left-color:var(--warn); } .call.warn .h { color:var(--warn); }
  .call.stop { border-left-color:var(--bad); } .call.stop .h { color:var(--bad); }
  .call.info { border-left-color:var(--accent); } .call.info .h { color:var(--accent); }

  .pill { font-family:var(--mono); font-size:11px; padding:2px 8px; border-radius:20px;
    border:1px solid var(--line); color:var(--muted); }
  .pill.ok { color:var(--ok); border-color:rgba(95,212,160,.35); }
  .pill.no { color:var(--bad); border-color:rgba(255,139,128,.35); }

  .flow { display:grid; grid-template-columns:repeat(4,1fr); gap:1px; margin:20px 0;
    border:1px solid var(--line); border-radius:10px; overflow:hidden; background:var(--line); }
  .flow-step { position:relative; background:var(--panel); padding:15px; min-height:112px; }
  .flow-step b { display:block; font-family:var(--mono); font-size:10px; letter-spacing:.12em;
    text-transform:uppercase; color:var(--accent); margin-bottom:8px; }
  .flow-step code { display:block; color:var(--ink); font-size:12px; line-height:1.5; }
  .flow-step p { margin:6px 0 0; color:var(--muted); font-size:12.5px; line-height:1.45; }
  .terminal { display:grid; grid-template-columns:repeat(5,minmax(0,1fr)); gap:6px; margin:14px 0; }
  .state { padding:9px 10px; border:1px solid var(--line); border-radius:7px; font-family:var(--mono);
    font-size:10.5px; text-align:center; color:var(--muted); }
  .state.done { color:var(--ok); border-color:rgba(95,212,160,.35); }
  .state.bad { color:var(--bad); border-color:rgba(255,139,128,.35); }

  footer { border-top:1px solid var(--line); padding-top:18px; color:var(--faint); font-size:13px; }

  @media (max-width:900px) {
    .doc { grid-template-columns:1fr; }
    .nav { position:static; height:auto; border-right:none; border-bottom:1px solid var(--line-soft);
      padding:20px 22px 16px; }
    .nav nav, .surfaces { flex-flow:row wrap; gap:2px 4px; }
    .surfaces { margin-bottom:10px; padding-bottom:10px; }
    .nav-label { display:none; }
    main { padding:26px 22px 70px; }
    h1 { font-size:28px; }
    .flow { grid-template-columns:1fr 1fr; }
    .terminal { grid-template-columns:repeat(2,1fr); }
  }
  @media (max-width:560px) { .flow { grid-template-columns:1fr; } }
  @media (prefers-reduced-motion:reduce) { * { animation:none !important; transition:none !important; } }
</style>

<div class="doc">
<aside class="nav">
  <div class="brand"><span class="dot"></span>EE Auto</div>
  <div class="brand-sub">business intelligence API</div>
  <div class="surfaces">${navHtml(OPERATOR_NAV, '/docs')}</div>
  <nav>
    <span class="nav-label">On this page</span>
    <a href="#start">Start here</a>
    <a href="#intel">Pipeline reference</a>
    <a href="#company-dive">Company dive</a>
    <a href="#telemarketing">Telemarketer API (Auth by UID)</a>
    <a href="#engines">The engine</a>
    <span class="nav-label">Gateway</span>
    <a href="#chat">Chat completions</a>
    <a href="#stream">Streaming</a>
    <a href="#models">Models</a>
    <a href="#ask">Native ask</a>
    <a href="#queue">Queue &amp; backpressure</a>
    <span class="nav-label">Engines</span>
    <a href="#pi">Pi</a>
    <span class="nav-label">Home worker</span>
    <a href="#jobs">Jobs</a>
    <a href="#social">Social research</a>
    <span class="nav-label">Operating it</span>
    <a href="#logs">Logs</a>
    <a href="#service">Service</a>
    <span class="nav-label">Reference</span>
    <a href="#errors">Errors</a>
    <a href="#limits">Limits</a>
    <a href="#env">Environment</a>
  </nav>
</aside>

<main>
<header>
  <p class="eyebrow">Business discovery &middot; company enrichment &middot; published reports</p>
  <h1>EE Business Intelligence API</h1>
  <p class="lede">Search a market, persist a ranked business list, enrich any returned
  company through four research rounds, and give the requester a durable mobile report.
  Social research runs alongside it: Facebook presence, and what X (x.com) is saying,
  read through Grok. The lower-level model gateway is documented on the same page for
  operators.</p>
  <div class="facts">
    <div class="fact"><span class="k">Production origin</span><code>https://ee-auto.up.railway.app</code></div>
    <div class="fact"><span class="k">Auth</span><code>Authorization: Bearer LAB_TOKEN</code></div>
    <div class="fact"><span class="k">OpenAPI 3.1</span><code><a href="/openapi.json">/openapi.json</a></code></div>
    <div class="fact"><span class="k">End-user workspace</span><code><a href="/research">/research</a></code></div>
  </div>
</header>

<section id="start">
  <h2>Start here</h2>
  <p>The product API is asynchronous. Creating work returns HTTP <code>202</code> with a
  stable report id, an authenticated polling URL and a public viewing URL. Your client
  does not keep the POST connection open while Google Maps or the research engines run.</p>

  <div class="flow">
    <div class="flow-step"><b>01 &middot; Discover</b><code>POST /api/business-search</code><p>Business keyword, location, or both.</p></div>
    <div class="flow-step"><b>02 &middot; Poll</b><code>GET report.api_url</code><p>Wait for a terminal status and read <code>data.companies</code>.</p></div>
    <div class="flow-step"><b>03 &middot; Enrich</b><code>POST /api/company-research</code><p>Pass one returned <code>company.id</code>.</p></div>
    <div class="flow-step"><b>04 &middot; Publish</b><code>GET report.view_url</code><p>Send the permanent mobile report to the requester.</p></div>
  </div>

<pre><code>export EE_AUTO_TOKEN='replace-with-service-token'

curl -sS https://ee-auto.up.railway.app/api/business-search \
  -H "Authorization: Bearer $EE_AUTO_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"keyword":"solar installer","place":"Kuala Lumpur","max":40,"requesterId":"crm-42"}'</code></pre>

  <div class="call info"><span class="h">Authentication boundary</span>
  <p>Everything under <code>/api</code> and <code>/v1</code> requires the bearer token.
  <code>/r/:id</code> and <code>/public/reports/:id</code> are deliberately public through an
  opaque 20-character id. Never append the token to a report link. The end-user
  <a href="/research">research workspace</a> accepts a scoped <code>PORTAL_TOKEN</code>
  which can call only business-intelligence routes.</p></div>

  <h3>Lifecycle</h3>
  <div class="terminal">
    <div class="state">queued</div><div class="state">running</div><div class="state done">completed</div>
    <div class="state done">partial</div><div class="state bad">failed</div>
  </div>
  <p><code>completed</code>, <code>partial</code> and <code>failed</code> are terminal. A
  <code>partial</code> company report is still publishable: at least one round had a gap,
  but only evidence-ledger fields were released. Read <code>report.error</code> and
  <code>research_run.round_status</code> to see what happened.</p>
</section>

<section id="intel">
  <h2>Pipeline reference</h2>

  <h3>1. Create a business search</h3>
  <div class="ep"><span class="m post">POST</span><code class="path">/api/business-search</code><span class="tag">Bearer &middot; returns 202</span></div>
  <p>Supply at least one of <code>keyword</code> or <code>place</code>/<code>location</code>. Location-only searches are valid.</p>
  <div class="tbl"><table><thead><tr><th>Field</th><th>Type</th><th>Required</th><th>Meaning</th></tr></thead><tbody>
    <tr><td><code>keyword</code></td><td>string</td><td>conditional</td><td>Business category, service or keyword. May be omitted when a location is supplied.</td></tr>
    <tr><td><code>place</code></td><td>string</td><td>conditional</td><td>City, district, state or country. May be omitted when a keyword is supplied; <code>location</code> is an alias.</td></tr>
    <tr><td><code>max</code></td><td>integer</td><td>no</td><td>1–2000; defaults to 200.</td></tr>
    <tr><td><code>requesterId</code></td><td>string</td><td>no</td><td>Your CRM/user/job correlation id. <code>userId</code> is accepted as an alias.</td></tr>
    <tr><td><code>timeoutMs</code></td><td>integer</td><td>no</td><td>Worker deadline; defaults to 1200000 (20 minutes, also the ceiling). It does not make the POST synchronous.</td></tr>
  </tbody></table></div>
<pre><code>curl -s https://ee-auto.up.railway.app/api/business-search \
  -H "Authorization: Bearer $EE_AUTO_TOKEN" -H 'content-type: application/json' \
  -d '{"keyword":"solar installer","place":"Kuala Lumpur","max":40,"requesterId":"crm-42"}'</code></pre>
<pre><code>HTTP/1.1 202 Accepted
{
  "report": {
    "id": "AbCdEfGhIjKlMnOpQrSt",
    "type": "business_search",
    "status": "queued",
    "title": "solar installer in Kuala Lumpur",
    "created_at": "2026-08-21T07:00:00.000Z",
    "updated_at": "2026-08-21T07:00:00.000Z",
    "completed_at": null,
    "view_url": "https://ee-auto.up.railway.app/r/AbCdEfGhIjKlMnOpQrSt",
    "api_url": "https://ee-auto.up.railway.app/api/business-search/AbCdEfGhIjKlMnOpQrSt",
    "error": null
  }
}</code></pre>

  <h3>2. Poll the business search</h3>
  <div class="ep"><span class="m get">GET</span><code class="path">/api/business-search/:reportId</code><span class="tag">Bearer &middot; returns 200</span></div>
<pre><code>curl -sS "$SEARCH_API_URL" \
  -H "Authorization: Bearer $EE_AUTO_TOKEN"</code></pre>
<pre><code>{
  "report": { "id":"AbCdEfGhIjKlMnOpQrSt", "status":"completed", "view_url":"https://.../r/AbCd...", "api_url":"https://.../api/business-search/AbCd...", "error":null, "...":"..." },
  "data": {
    "search": { "found":40, "blocked":false, "saved":{ "reportId":12, "companies":40, "linked":40 } },
    "companies": [{
      "id":"69", "place_id":"...", "name":"SOLS Energy Sdn Bhd",
      "rating":4.4, "reviews":275, "category":"Solar energy company",
      "address":"...", "phone":"018-399 9247",
      "website":"https://www.solsenergy.com/", "maps_url":"https://www.google.com/maps/...", "rank":2
    }]
  },
  "research_run": null
}</code></pre>
  <p>The important handoff is <code>data.companies[].id</code>. It is the persisted EE
  company id—not a Google place id and not the 20-character report id.</p>

  <h3>3. Create company deep research</h3>
  <div class="ep"><span class="m post">POST</span><code class="path">/api/company-research</code><span class="tag">Bearer &middot; returns 202</span></div>
  <div class="tbl"><table><thead><tr><th>Field</th><th>Type</th><th>Required</th><th>Meaning</th></tr></thead><tbody>
    <tr><td><code>companyId</code></td><td>numeric string</td><td><span class="req">yes</span></td><td><code>data.companies[].id</code> from a business-search response. <code>company_id</code> is accepted as an alias.</td></tr>
    <tr><td><code>requesterId</code></td><td>string</td><td>no</td><td>Your correlation id. <code>userId</code> is accepted as an alias.</td></tr>
  </tbody></table></div>
<pre><code>curl -s https://ee-auto.up.railway.app/api/company-research \
  -H "Authorization: Bearer $EE_AUTO_TOKEN" -H 'content-type: application/json' \
  -d '{"companyId":"69","requesterId":"crm-42"}'</code></pre>

  <h3>4. Poll the company research</h3>
  <div class="ep"><span class="m get">GET</span><code class="path">/api/company-research/:reportId</code><span class="tag">Bearer &middot; returns 200</span></div>
<pre><code>{
  "report": { "id":"XyZaBcDeFgHiJkLmNoPq", "status":"completed", "view_url":"https://.../r/XyZa...", "error":null, "...":"..." },
  "data": {
    "final": {
      "entity": { "name":"SOLS Energy Sdn Bhd", "company_id":"69", "...":"..." },
      "summary":"...", "contacts":[...], "people":[...], "candidate_people":[...], "signals":[...],
      "outreach_angles":[...], "conflicts_and_unknowns":[],
      "synthesis_mode":"pi_validated"
    },
    "final_cn": { "summary":"...", "contacts":[...], "people":[...], "candidate_people":[...], "signals":[...] },
    "translation": { "language":"zh-CN", "model":"pi", "status":"completed" }
  },
  "research_run": {
    "round01": {...}, "round02": {...}, "round03": {...}, "round04": {...},
    "validated_ledger": {...}, "final_report": {...},
    "round_status": { "round01":"completed", "round02":"completed", "round03":"completed", "round04":"completed" }
  }
}</code></pre>
  <p>The authenticated route exposes benchmark artifacts. The canonical English report is at
  <code>data.final</code>; the matching Simplified Chinese rendering is at <code>data.final_cn</code>.
  Chinese translation preserves evidence IDs, source URLs, email addresses, phone numbers and published contact values exactly.
  Raw rounds are at <code>research_run.round01</code> through <code>round04</code>:
  Pi discovery, three split Pi audits, the <a href="#social">Facebook crawl</a>,
  then Pi synthesis with fidelity validation. Contacts, people and signals need direct HTTPS
  evidence to enter the validated ledger; <code>candidate_people</code> retains named public-source
  leads separately and never qualifies for VIP research until verified.
  If final Pi synthesis changes a validated contact/person set or introduces a new URL,
  it is rejected and <code>synthesis_mode</code> becomes <code>validated_ledger_fallback</code>.</p>
  <p>As soon as the Round 02 people audit identifies the report's P01 person, the service
  creates a separate <code>person_research</code> report and starts it immediately. It runs
  concurrently while company signals, social checks, final synthesis, and Chinese translation
  continue. The child report is idempotent by source report and person id, and appears as its own
  line in the research library.</p>

  <h3>5. Create a VIP person brief</h3>
  <div class="ep"><span class="m post">POST</span><code class="path">/api/person-research</code><span class="tag">Bearer &middot; returns 202, or 200 when one exists</span></div>
  <p>Start only from a validated person in a completed company report with <code>POST /api/person-research</code>. Use
  <code>data.final.people[].id</code> as <code>personId</code>. Optional <code>email</code> and
  <code>mobile</code> values are transient identity resolvers: the first discovery pass uses them
  to find public professional pages for the already-scoped name and company, then an independent
  public-source audit extends and verifies the evidence. Neither value is written to the report
  request, audit record, or public output. An exact match to an individual resolver can validate a
  source-linked historical affiliation at another company; it is explicitly labelled historical and
  records only <code>exact_email_match</code> or <code>exact_mobile_match</code>, never the value.</p>
  <p>One brief per person per source report. If a brief for that person already exists &mdash; including the
  automatic P01 one the company run starts for itself &mdash; that report comes back with <code>200</code>
  rather than a second four-round pass being started. Treat <code>200</code> as success and follow the
  returned <code>id</code>.</p>
<pre><code>curl -s https://ee-auto.up.railway.app/api/person-research \
  -H "Authorization: Bearer $EE_AUTO_TOKEN" -H 'content-type: application/json' \
  -d '{"companyResearchId":"XyZaBcDeFgHiJkLmNoPq","personId":"person_abc123","email":"owner@example.com","mobile":"+60 12-345 6789"}'</code></pre>
  <p>Company research automatically launches this same VIP pipeline for its first validated P01
  person as soon as the people audit identifies one. The child reference appears at
  <code>data.final.auto_person_research</code>; poll its <code>report_id</code> with
  <code>GET /api/person-research/:reportId</code>. A caller-created VIP brief and an automatic P01
  brief share the identical Pi, social-scout, audit, and validation flow.</p>
  <p>Poll <code>GET /api/person-research/:reportId</code>. The authenticated response includes
  <code>research_run</code> from <code>person_research_run</code>, containing validated
  public-professional evidence, the final brief, and discovery/audit/synthesis metadata. It never
  retains caller-supplied identity resolvers or raw model text.</p>
  <p>VIP discovery combines the primary Pi web pass (<code>VIP_RESEARCH_MODEL</code>, default
  <code>pi</code>), an optional Facebook/Instagram/Threads
  scout, and an optional xAI/X scout. A social lane runs only when a live worker claims its job type:
  <code>fb.person</code> and <code>x.subject</code> by default. Set
  <code>VIP_FB_SCOUT_JOB_TYPE</code> or <code>VIP_XAI_SCOUT_JOB_TYPE</code> to match a worker that
  uses different names. Scouts receive only the validated public person/company baseline—not email
  or mobile resolvers—and may publish rows only when their direct evidence URL is on their own
  network. Per-lane status and job metadata are in <code>research_run.engine_metadata</code>.</p>
<pre><code>// x.subject worker evidence: only cited X permalinks enter the VIP ledger
{"result":{"threads":[{"url":"https://x.com/example/status/1","cited":true,"date":"2026-08-22","topic":"..."}]}}</code></pre>

  <h3>6. Capture the ads a company is running</h3>
  <div class="ep"><span class="m post">POST</span><code class="path">/api/ads-research</code><span class="tag">Bearer &middot; returns 202</span></div>
  <p>Captures every live ad for a company from the Facebook Ad Library and the Google Ads
  Transparency Center. This is a crawl, not a model call: the <code>ads.company</code> worker at
  home drives a real browser, so the run costs a crawl job and no tokens.</p>
  <p><strong>Google publishes no ad text.</strong> Its rows carry format, dates and a permalink only
  &mdash; the wording of a Google ad exists solely inside the creative image. That is not a capture
  failure, and no field will ever be populated for it. Facebook rows carry the full copy.</p>
<pre><code>curl -s https://ee-auto.up.railway.app/api/ads-research \
  -H "Authorization: Bearer $EE_AUTO_TOKEN" -H 'content-type: application/json' \
  -d '{"name":"Solarvest","region":"MY","gMax":30}'</code></pre>
  <p>Poll <code>GET /api/ads-research/:reportId</code>. The authenticated response includes
  <code>research_run</code> from <code>ads_research_run</code>, holding the raw per-network captures.
  When no worker is claiming <code>ads.company</code> the report finishes <code>partial</code> and
  says so, rather than hanging until the job times out.</p>
  <p>Every completed company dossier carries a <strong>Research their ads</strong> button that posts
  this endpoint with the dossier's <code>companyId</code>. That links the ads report to the company,
  so the dossier shows it from then on. Passing <code>companyId</code> also makes the call safe to
  repeat: a capture still in flight for that company comes back with <code>200</code> instead of a
  second crawl. A completed one does not block a new run &mdash; ads change week to week, so
  re-running is legitimate and the dossier links the newest.</p>

  <h3>6. Publish or consume the final report</h3>
  <div class="tbl"><table><thead><tr><th>Route</th><th>Auth</th><th>Use</th></tr></thead><tbody>
    <tr><td><code>GET /api/reports</code></td><td>Bearer</td><td>Combined paginated library. Filter with <code>type</code>, <code>status</code>, <code>limit</code>, and <code>offset</code>.</td></tr>
    <tr><td><code>POST /api/reports/:reportId/retry</code></td><td>Bearer</td><td>Re-queue a <code>failed</code> report in place: same public link, original inputs replayed. Answers <code>202</code> on claim; <code>409</code> when the report is not failed, was already claimed, or its inputs are gone. Finished reports are never re-run this way.</td></tr>
    <tr><td><code>GET /r/:reportId</code></td><td>none</td><td>Premium mobile HTML report for the requester.</td></tr>
    <tr><td><code>GET /public/reports/:reportId</code></td><td>none</td><td>Final public JSON. Search reports return <code>companies</code>; deep reports return English <code>final</code> plus <code>final_cn</code> when Chinese translation is complete. Raw rounds are excluded.</td></tr>
    <tr><td><code>GET /api/company-research/:reportId</code></td><td>Bearer</td><td>Private final output plus raw benchmark rounds.</td></tr>
    <tr><td><code>GET /api/person-research/:reportId</code></td><td>Bearer</td><td>Private VIP brief plus its validated-evidence audit record.</td></tr>
    <tr><td><code>GET /api/ads-research/:reportId</code></td><td>Bearer</td><td>Private ads report plus the raw per-network captures.</td></tr>
  </tbody></table></div>

  <h3>Reference polling helper</h3>
<pre><code><span class="cmt">// Node 18+ / TypeScript</span>
const origin = 'https://ee-auto.up.railway.app';
const headers = { Authorization: 'Bearer ' + EE_AUTO_TOKEN, 'Content-Type': 'application/json' };

async function waitForReport(apiUrl) {
  for (;;) {
    const response = await fetch(apiUrl, { headers });
    if (!response.ok) throw new Error('EE API ' + response.status + ': ' + await response.text());
    const body = await response.json();
    if (['completed', 'partial'].includes(body.report.status)) return body;
    if (body.report.status === 'failed') throw new Error(body.report.error || 'Research failed');
    await new Promise(resolve =&gt; setTimeout(resolve, 5000));
  }
}

const accepted = await fetch(origin + '/api/business-search', {
  method: 'POST', headers,
  body: JSON.stringify({ keyword:'solar installer', place:'Kuala Lumpur', max:40, requesterId:'crm-42' })
}).then(r =&gt; r.json());

const search = await waitForReport(accepted.report.api_url);
const companyId = search.data.companies[0].id;</code></pre>

  <div class="call warn"><span class="h">Operational expectation</span>
  <p>Poll every 5–10 seconds; do not retry the POST just because work is still running.
  A repeated POST creates a separate report. Keep the returned <code>report.id</code> and
  <code>api_url</code> in your own request record.</p></div>
</section>

<section id="company-dive">
  <h2>Company dive</h2>
  <p>Deep dive one company by name. One POST returns a public report link at once; the
  report takes 5&ndash;10 minutes. Brave finds the URLs (8 searches), Tavily reads the pages
  (at most 15 calls), deepseek does every thinking step (Pi on MiniMax if deepseek fails),
  and Exa finds the people linked to the company (at most 20 calls). The result is a cited
  dossier, people cards with evidence links, and a numbered source list. Accepts
  <code>LAB_TOKEN</code> or <code>PORTAL_TOKEN</code>.</p>

  <h3>1. Start a report</h3>
  <div class="ep"><span class="m post">POST</span><code class="path">/api/company-dive</code><span class="tag">Bearer &middot; returns 202</span></div>
  <div class="tbl"><table><thead><tr><th>Field</th><th>Type</th><th>Required</th><th>Meaning</th></tr></thead><tbody>
    <tr><td><code>company</code></td><td>string, 2&ndash;200 chars</td><td><span class="req">yes</span></td><td>The company's name. <code>name</code> is accepted as an alias.</td></tr>
    <tr><td><code>country</code></td><td>string</td><td>no</td><td>Defaults to <code>Malaysia</code>. Sets the search country for Brave and Tavily.</td></tr>
    <tr><td><code>people</code></td><td>boolean</td><td>no</td><td>Defaults to <code>true</code>: run the Exa people step after the research.</td></tr>
  </tbody></table></div>
<pre><code>curl -s https://ee-auto.up.railway.app/api/company-dive \
  -H "Authorization: Bearer $EE_AUTO_TOKEN" -H 'content-type: application/json' \
  -d '{"company":"Eternalgy Sdn Bhd","country":"Malaysia"}'

{
  "id": 4, "public_id": "sf9S9f84Sfi3cx0KGtBW", "status": "queued",
  "company": "Eternalgy Sdn Bhd", "country": "Malaysia", "people": true,
  "queued_behind_another": false,
  "report_url": "https://ee-auto.up.railway.app/d/sf9S9f84Sfi3cx0KGtBW",
  "status_url": "https://ee-auto.up.railway.app/d/sf9S9f84Sfi3cx0KGtBW/data",
  "api_url": "https://ee-auto.up.railway.app/api/company-dive/4",
  "expected_minutes": "5-10"
}</code></pre>
  <p>Hand <code>report_url</code> to people: it works from the first second. Reports run one
  at a time; <code>queued_behind_another: true</code> means this one waits its turn.</p>

  <h3>2. The report link</h3>
  <div class="ep"><span class="m get">GET</span><code class="path">/d/:publicId</code><span class="tag">no token &middot; HTML</span></div>
  <p>While the dive runs, the page shows the stages, a progress bar and the live log, and
  refreshes itself every 4 seconds. Once the dossier is written it renders the report in
  place; the people section fills in when that step ends. Mobile friendly, light and dark,
  with Print / PDF. The 20-character id is the permission, as for <code>/r/:id</code>.</p>

  <h3>3. Poll the status as JSON</h3>
  <div class="ep"><span class="m get">GET</span><code class="path">/d/:publicId/data</code><span class="tag">no token &middot; returns 200</span></div>
  <div class="tbl"><table><thead><tr><th>Field</th><th>Meaning</th></tr></thead><tbody>
    <tr><td><code>status</code></td><td><code>queued</code> &rarr; <code>running</code> &rarr; <code>done</code>, <code>partial</code> (finished, a step used a fallback) or <code>failed</code></td></tr>
    <tr><td><code>stage</code></td><td><code>discover</code>, <code>triage</code>, <code>read</code>, <code>analyse</code>, <code>fill</code>, <code>reflect</code>, <code>write</code>, <code>people</code>, then <code>done</code></td></tr>
    <tr><td><code>log</code></td><td><code>[{at, stage, msg}]</code>, oldest first</td></tr>
    <tr><td><code>dossier</code></td><td>Markdown with citations like <code>[12]</code>; present from the <code>people</code> stage on</td></tr>
    <tr><td><code>identity</code></td><td>Legal name, aliases, registration numbers, address, official domains, industry</td></tr>
    <tr><td><code>sources</code></td><td><code>[{id, title, url}]</code>: the cited sources, numbered as in the dossier</td></tr>
    <tr><td><code>people</code></td><td><code>{status, people:[{name, role, relation, current, confidence, evidence:[{url, quote}], notes}], rejected, exa_calls, log}</code></td></tr>
    <tr><td><code>stats</code></td><td>Tavily, Brave and LLM call counts; facts found; sources found and cited</td></tr>
  </tbody></table></div>

  <h3>4. Operator routes</h3>
  <div class="ep"><span class="m get">GET</span><code class="path">/api/company-dive</code><span class="tag">Bearer &middot; 50 newest, with their links</span></div>
  <div class="ep"><span class="m get">GET</span><code class="path">/api/company-dive/:id</code><span class="tag">Bearer &middot; full record incl. call details</span></div>
  <div class="ep"><span class="m post">POST</span><code class="path">/api/company-dive/:id/people</code><span class="tag">Bearer &middot; rerun people step &middot; 202 / 409</span></div>
  <div class="ep"><span class="m get">GET</span><code class="path">/api/company-dive/:id/people</code><span class="tag">Bearer &middot; people step in full</span></div>
  <p>The console page <a href="/company-dive">/company-dive</a> starts and watches dives too.</p>

  <div class="call warn"><span class="h">Operational expectation</span>
  <p>Poll <code>/d/:publicId/data</code> every 5&ndash;10 seconds; a repeated POST starts a
  second report. No step has a timeout: a step without a usable answer falls back and the
  report ends <code>partial</code>. A redeploy of ee-auto stops a running dive: after the
  dossier is written it is kept (rerun the people step), before that the dive ends
  <code>failed</code>. One report costs about USD 0.80 at list prices (Tavily 37 credits,
  Exa about USD 0.34, Brave 8 searches, deepseek about 220k tokens in).</p></div>
</section>

<section id="telemarketing">
  <h2>Telemarketer API</h2>
  <p class="lede">Dedicated endpoints for telemarketers and CRM integrations to read assigned leads and record call dispositions and notes. Authenticated directly by active <strong>Telemarketer UID</strong> or by operator bearer token (<code>$EE_AUTO_TOKEN</code>).</p>

  <div class="call"><span class="h">Authentication: Telemarketer UID or Operator Bearer</span>
  <p>Every telemarketer has a unique UID (e.g. <code>TM-SARAH</code> or <code>user_5e0dc2eb25600001</code>). You can authenticate by supplying it in any of the following formats:</p>
  <ul>
    <li>URL query param: <code>?uid=TM-SARAH</code> (also accepts <code>?assignedTo=Sarah Tan</code> or <code>?telemarketer=...</code>)</li>
    <li>Path prefix: <code>/api/telemarketer/TM-SARAH/leads</code> or <code>/api/telemarketer/leads/TM-SARAH</code></li>
    <li>HTTP header: <code>X-Telemarketer-UID: TM-SARAH</code></li>
    <li>Bearer Authorization: <code>Authorization: Bearer TM-SARAH</code> (or operator token <code>Authorization: Bearer $EE_AUTO_TOKEN</code>)</li>
    <li>JSON body: <code>{"uid": "TM-SARAH"}</code></li>
  </ul>
  </div>

  <h3>1. Discover active telemarketers roster</h3>
  <div class="ep"><span class="m get">GET</span><code class="path">/api/telemarketer/roster</code><span class="tag">Open / UID Auth &middot; returns 200</span></div>
  <p>Returns all active telemarketers with their unique UID, name, phone, email, and live pipeline status summary. Use this endpoint to discover telemarketer UIDs to fetch leads for each agent.</p>
<pre><code>curl -s "https://ee-auto.up.railway.app/api/telemarketer/roster"</code></pre>
<pre><code>{
  "ok": true,
  "telemarketers": ["Sarah Tan", "Tong Lip Jian", "Vincent Tan"],
  "agents": [
    {
      "id": 1,
      "uid": "TM-SARAH",
      "name": "Sarah Tan",
      "phone": "+6012-3456789",
      "email": "sarah@example.com",
      "total_assigned": 45,
      "pending_count": 20,
      "contacted_count": 15,
      "interested_count": 7,
      "not_interested_count": 2,
      "dnc_count": 1,
      "api_url": "/api/telemarketer/TM-SARAH/leads"
    }
  ]
}</code></pre>

  <h3>2. Read assigned leads for a telemarketer</h3>
  <div class="ep"><span class="m get">GET</span><code class="path">/api/telemarketer/leads</code><span class="tag">UID or Bearer &middot; returns 200</span></div>
  <p>Alternative paths: <code>/api/telemarketer/:uid/leads</code> or <code>/api/telemarketer/leads/:uid</code>. Returns the telemarketer's active profile, progress counters (<code>total</code>, <code>pending</code>, <code>contacted</code>, <code>interested</code>, <code>not_interested</code>, <code>do_not_call</code>), and the paginated list of leads assigned to this agent.</p>
  <div class="tbl"><table><thead><tr><th>Query Param</th><th>Type</th><th>Default</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>uid</code></td><td>string</td><td>none</td><td>Telemarketer UID, Name, or ID (e.g. <code>TM-SARAH</code>, <code>user_5e0dc2eb25600001</code>). Aliases: <code>assignedTo</code>, <code>telemarketer</code>.</td></tr>
    <tr><td><code>status</code></td><td>string</td><td>all</td><td>Filter by status: <code>all</code>, <code>assigned</code>, <code>contacted</code>, <code>interested</code>, <code>not_interested</code>, <code>do_not_call</code> (or aliases: <code>pending</code>, <code>to_call</code>, <code>dnc</code>).</td></tr>
    <tr><td><code>search</code></td><td>string</td><td>none</td><td>Search keyword matching company name, phone, address, or category.</td></tr>
    <tr><td><code>limit</code></td><td>integer</td><td>50</td><td>Page size (1&ndash;500).</td></tr>
    <tr><td><code>offset</code></td><td>integer</td><td>0</td><td>Pagination offset.</td></tr>
    <tr><td><code>sort</code></td><td>string</td><td>created_at</td><td>Sort column (prefix <code>-</code> for descending, e.g. <code>-created_at</code>).</td></tr>
  </tbody></table></div>
<pre><code>curl -s "https://ee-auto.up.railway.app/api/telemarketer/leads?uid=TM-SARAH"</code></pre>
<pre><code>{
  "ok": true,
  "telemarketer": { "id": 1, "uid": "TM-SARAH", "name": "Sarah Tan", "phone": "+6012-3456789", "email": "sarah@example.com" },
  "stats": { "total": 45, "pending": 20, "contacted": 15, "interested": 7, "not_interested": 2, "do_not_call": 1 },
  "leads": [{
    "id": "101",
    "name": "Solar Future Sdn Bhd",
    "phone": "+607-5551234",
    "address": "Jalan Molek 1/10, Taman Molek",
    "category": "Solar Energy",
    "lead_status": "assigned",
    "lead_notes": "Call after 2pm",
    "assigned_to": "Sarah Tan",
    "telemarketer_uid": "TM-SARAH",
    "contact_phones_count": 2,
    "contact_decision_makers_count": 1
  }],
  "total": 45,
  "limit": 50,
  "offset": 0
}</code></pre>

  <h3>3. Read single lead detail</h3>
  <div class="ep"><span class="m get">GET</span><code class="path">/api/telemarketer/leads/:id</code><span class="tag">UID Auth &middot; returns 200</span></div>
  <p>Alternative path: <code>/api/telemarketer/:uid/leads/:id</code>. Returns complete company details, address, website, notes, plus parsed <code>decision_makers</code> with direct WhatsApp links and categorized <code>phone_contacts</code>.</p>
<pre><code>curl -s -H "X-Telemarketer-UID: TM-SARAH" \
  "https://ee-auto.up.railway.app/api/telemarketer/leads/101"</code></pre>
<pre><code>{
  "ok": true,
  "lead": {
    "id": "101",
    "name": "Solar Future Sdn Bhd",
    "phone": "+607-5551234",
    "address": "Jalan Molek 1/10, Taman Molek",
    "lead_status": "assigned",
    "lead_notes": "Call after 2pm",
    "decision_makers": [
      { "name": "Tan Boon Lee", "role": "Director", "direct_phone": "+6019-7112233", "whatsapp_url": "https://wa.me/60197112233" }
    ],
    "phone_contacts": [
      { "number_raw": "+607-5551234", "type": "office", "dial_url": "tel:+6075551234" },
      { "number_raw": "+6019-7112233", "type": "mobile_whatsapp", "whatsapp_url": "https://wa.me/60197112233" }
    ]
  }
}</code></pre>

  <h3>4. Update lead status &amp; add / edit notes</h3>
  <div class="ep"><span class="m patch">PATCH</span><code class="path">/api/telemarketer/leads/:id</code><span class="tag">UID Auth &middot; returns 200</span></div>
  <p>Also accepts <code>POST</code>. Updates disposition status and notes. Enforces agent ownership: telemarketers cannot modify leads assigned to another agent.</p>
  <div class="tbl"><table><thead><tr><th>Field</th><th>Type</th><th>Required</th><th>Description</th></tr></thead><tbody>
    <tr><td><code>leadStatus</code></td><td>string</td><td>optional</td><td>New disposition status: <code>assigned</code>, <code>contacted</code>, <code>interested</code>, <code>not_interested</code>, <code>do_not_call</code>. (Alias <code>status</code> accepted).</td></tr>
    <tr><td><code>notes</code></td><td>string</td><td>optional</td><td>Replaces existing lead notes entirely. (Alias <code>lead_notes</code> accepted).</td></tr>
    <tr><td><code>appendNotes</code></td><td>string</td><td>optional</td><td>Appends text to existing notes with an automatic date prefix (e.g. <code>[2026-09-25] Spoke with director</code>). (Alias <code>addNote</code> accepted).</td></tr>
    <tr><td><code>uid</code></td><td>string</td><td>conditional</td><td>Telemarketer UID (if not supplied via query param or header).</td></tr>
  </tbody></table></div>
<pre><code>curl -s -X PATCH "https://ee-auto.up.railway.app/api/telemarketer/leads/101" \
  -H "X-Telemarketer-UID: TM-SARAH" \
  -H "Content-Type: application/json" \
  -d '{
    "status": "interested",
    "appendNotes": "Director confirmed 15kW quotation request. Send WhatsApp brochure."
  }'</code></pre>
<pre><code>{
  "ok": true,
  "message": "Lead updated successfully",
  "lead": {
    "id": "101",
    "name": "Solar Future Sdn Bhd",
    "lead_status": "interested",
    "lead_notes": "Call after 2pm\n[2026-09-25] Director confirmed 15kW quotation request. Send WhatsApp brochure.",
    "lead_updated_at": "2026-09-25T05:20:00.000Z"
  }
}</code></pre>

  <h3>5. Telemarketer profile &amp; workload summary</h3>
  <div class="ep"><span class="m get">GET</span><code class="path">/api/telemarketer/me</code><span class="tag">UID Auth &middot; returns 200</span></div>
  <p>Alternative path: <code>/api/telemarketer/:uid/profile</code>. Returns the telemarketer's profile and breakdown of assigned leads across all statuses.</p>
<pre><code>curl -s -H "Authorization: Bearer TM-SARAH" \
  "https://ee-auto.up.railway.app/api/telemarketer/me"</code></pre>
</section>

<section id="engines">
  <h2>The engine</h2>
  <p>One hosted model with two web tools. The ChatGPT and Meta AI browser engines were
  removed on 2026-10-26: Cloudflare began refusing ChatGPT chats from this container, and
  Meta AI was already region-blocked. Their model names still resolve, to Pi &mdash; see
  <a href="#models">Models</a>.</p>
  <div class="tbl"><table>
    <thead><tr><th>Model</th><th>What actually runs</th><th>Short answer</th><th>Streams</th></tr></thead>
    <tbody>
      <tr><td><code>pi</code></td><td>the Pi agent SDK in this process, on MiniMax (<code>MiniMax-M3.1-Flash-Preview</code>), with two tools: <code>web_search</code> (Tavily) and <code>web_fetch</code> (reads a public page). No shell, no files.</td><td class="num">2–15 s</td><td><span class="pill">one chunk</span></td></tr>
    </tbody>
  </table></div>
</section>

<section id="chat">
  <h2>Chat completions</h2>
  <div class="ep"><span class="m post">POST</span><code class="path">/v1/chat/completions</code><span class="tag">also /api/v1/chat/completions</span></div>
  <p>The OpenAI shape. What it accepts, and what it will not pretend to support:</p>
  <div class="tbl"><table>
    <thead><tr><th>Field</th><th>Type</th><th>Behaviour</th></tr></thead>
    <tbody>
      <tr><td><code>model</code> <span class="req">required</span></td><td>string</td><td>Routed as in <a href="#models">Models</a>. Empty or <code>auto</code> resolves to <code>DEFAULT_MODEL</code>.</td></tr>
      <tr><td><code>messages</code> <span class="req">required</span></td><td>array</td><td>Flattened into one prompt. <code>system</code> and <code>developer</code> parts come first verbatim, then <code>User:</code> / <code>Assistant:</code> / <code>Tool:</code> turns. A lone user message is passed through unlabelled.</td></tr>
      <tr><td><code>stream</code></td><td>boolean</td><td>Server-sent events. See <a href="#stream">Streaming</a>.</td></tr>
      <tr><td><code>timeoutMs</code></td><td>number</td><td>Per-call deadline. Defaults to 300000. <code>timeout_ms</code> is accepted too.</td></tr>
      <tr><td><code>tools</code></td><td><code>true</code></td><td><strong>Not OpenAI function calling.</strong> Ignored: <code>pi</code> always runs with its two web tools and nothing else. An OpenAI tools <em>array</em> does nothing — see the note below.</td></tr>
      <tr><td><code>n</code></td><td>number</td><td>Must be 1. Anything else is a 400: each call is one real model run, not a sample.</td></tr>
      <tr><td colspan="3" style="color:var(--faint)">Accepted, ignored, and listed back in <code>agy_lab.ignored</code>: <code>temperature</code>, <code>top_p</code>, <code>max_tokens</code>, <code>max_completion_tokens</code>, <code>presence_penalty</code>, <code>frequency_penalty</code>, <code>logprobs</code>, <code>logit_bias</code>, <code>seed</code>, <code>stop</code>, <code>tool_choice</code>, <code>response_format</code>.</td></tr>
    </tbody>
  </table></div>

  <div class="call stop"><span class="h">tools means something else here</span>
  <p>The Pi worker runs fixed settings, so
  sampling parameters cannot be honoured and are never approximated. They come back in
  <code>agy_lab.ignored</code> so a caller can see they had no effect. No function calling, no logprobs, no image input: an image part in a message
  is replaced with <code>[unsupported content part: image_url]</code> rather than dropped, so a
  prompt that depended on it fails visibly instead of quietly.</p></div>

  <h3>Response</h3>
  <div class="tbl"><table>
    <thead><tr><th>Field</th><th>Means</th></tr></thead>
    <tbody>
      <tr><td><code>model</code></td><td>The model that <em>actually ran</em>, — <code>pi</code>, whatever alias you asked for. Substitution is never silent.</td></tr>
      <tr><td><code>choices[0].finish_reason</code></td><td><code>stop</code></td></tr>
      <tr><td><code>usage</code></td><td>Characters &divide; 4, marked <code>"estimated": true</code>. No engine here reports real token usage.</td></tr>
      <tr><td><code>agy_lab</code></td><td>Non-standard block: <code>engine</code>, <code>ms</code>, <code>queuedMs</code>, <code>ignored</code>.</td></tr>
    </tbody>
  </table></div>
  <p>Every call is a fresh Pi session. There is no server-side conversation to continue, so
  send the history you want considered.</p>
</section>

<section id="stream">
  <h2>Streaming</h2>
  <p>Pi answers when its run is finished, so the answer arrives as a single content chunk.
  The stream is still worth using for long calls: a queued call narrates its wait, which
  keeps intermediaries from closing a silent socket.</p>
<pre><code>data: {"object":"chat.completion.chunk","choices":[{"delta":{"role":"assistant","content":""},...}]}
data: {"object":"chat.completion.chunk","choices":[{"delta":{"content":"one\ntwo\nthree"},...}]}
data: {"object":"chat.completion.chunk","choices":[{"delta":{},"finish_reason":"stop"}]}
data: {"object":"chat.completion.chunk","choices":[],"usage":{...},"agy_lab":{...}}
data: [DONE]</code></pre>
  <div class="call info"><span class="h">Failures arrive in-band</span>
  <p>Once a stream opens, the HTTP status is already sent, so an engine failure cannot be a
  status code. It arrives as a final <code>data: {"error":{...}}</code> chunk before
  <code>[DONE]</code>. A client that only watches the status line will see a 200 and an empty
  answer — read the chunks.</p>
  <p>Hanging up stops the work: the engine call is abandoned when the request closes,
  rather than running on into a dead socket.</p></div>
</section>

<section id="models">
  <h2>Models</h2>
  <div class="ep"><span class="m get">GET</span><code class="path">/v1/models</code><span class="tag">also /api/models</span></div>
  <p>Lists what this box can route to: <code>pi</code>, with whether its key is configured.</p>
  <div class="tbl"><table>
    <thead><tr><th>Name</th><th>Routes to</th></tr></thead>
    <tbody>
      <tr><td><code>pi</code>, <code>minimax</code></td><td>the Pi worker (MiniMax). <code>agy</code>, <code>gemini</code> and <code>google</code> still route here, for callers set up before the Gemini engine was removed.</td></tr>
      <tr><td><code>chatgpt</code>, <code>openai</code>, <code>gpt-*</code>, <code>o1*</code>, <code>o3*</code>, <code>o4*</code>, <code>meta</code>, <code>llama-*</code></td><td>Pi. These named the removed browser engines; they still route, so a tool that hard-coded one keeps working.</td></tr>
      <tr><td><em>empty</em>, <code>auto</code></td><td><code>DEFAULT_MODEL</code>, which is <code>pi</code> unless set</td></tr>
    </tbody>
  </table></div>
  <p><code>@container</code> is accepted and changes nothing; <code>@mini</code> is a 404, because
  nothing runs on the mini through this gateway any more.</p>
</section>

<section id="ask">
  <h2>Native ask</h2>
  <div class="ep"><span class="m post">POST</span><code class="path">/api/ask</code><span class="tag">no OpenAI envelope</span></div>
  <p>The honest shape for something written against this service directly: a prompt in, an
  answer out, no chat-completion wrapper to unpack.</p>
<pre><code>curl -s https://ee-auto.up.railway.app/api/ask \
  -H "Authorization: Bearer $LAB_TOKEN" -H 'content-type: application/json' \
  -d '{"model":"pi","prompt":"...","timeoutMs":240000}'

{"model":"pi","engine":"pi","answer":"...","ms":13024}</code></pre>
  <p>Takes <code>model</code> (or <code>engine</code>), <code>prompt</code> (or <code>messages</code>, flattened
  the same way), <code>timeoutMs</code> and <code>tools</code>.</p>
</section>

<section id="queue">
  <h2>Queue &amp; backpressure</h2>
  <p>Calls are admitted rather than accepted. Ten at once do not make ten answers arrive
  faster — past <code>PI_MAX_CONCURRENT</code> they only get the MiniMax account rate-limited.</p>
  <p><strong>A call that is admitted waits; it does not fail.</strong> An answer at +40 s
  is worth more than an error at +0 s, so the request is held. It is refused up front
  only when waiting would be worse than being told no.</p>

  <h3>Lanes</h3>
  <div class="tbl"><table>
    <thead><tr><th>Lane</th><th>Runs at once</th><th>Engines</th><th>Spacing</th></tr></thead>
    <tbody>
      <tr><td><code>pi</code></td><td class="num">6</td><td><code>pi</code></td><td class="num">none</td></tr>
    </tbody>
  </table></div>
  <p>Spacing (<code>PI_MIN_GAP_MS</code>) and an hourly cap (<code>PI_HOURLY_LIMIT</code>) exist
  and are off by default.</p>

  <h3>The three refusals</h3>
  <div class="tbl"><table>
    <thead><tr><th>type</th><th>Fires when</th><th>Retry-After</th></tr></thead>
    <tbody>
      <tr><td><code>rate_limit_exceeded</code></td><td>the engine's hourly cap is used up (off unless <code>*_HOURLY_LIMIT</code> is set)</td><td>when the oldest call ages out of the hour</td></tr>
      <tr><td><code>queue_full</code></td><td>more than <code>QUEUE_MAX_DEPTH</code> (10) are already waiting in that lane</td><td>the estimated drain time</td></tr>
      <tr><td><code>queue_too_slow</code></td><td>the queue is short but slow, and the estimate exceeds <code>QUEUE_MAX_WAIT_MS</code> (300 s)</td><td>the estimate</td></tr>
    </tbody>
  </table></div>
<pre><code>HTTP/1.1 429 Too Many Requests
retry-after: 47

{
  "error": { "message": "System busy: 10 calls are already waiting for Pi and the queue is capped at 10. Retry in about 47s.",
             "type": "queue_full", "code": 429, "retry_after": 47 },
  "queue": { "engine": "pi", "lane": "pi", "minGapMs": 0, "maxQueue": 10,
             "usedThisHour": 14, "estimatedWaitMs": 46800, "averageMs": 13100 }
}</code></pre>
  <p>Both numbers are on purpose: <code>retry-after</code> is what a client can act on
  without reading prose, and the <code>queue</code> block is what a person can. A response
  that waited reports it as <code>agy_lab.queuedMs</code> (native shape:
  <code>queuedMs</code>), present only when the wait was real.</p>

  <div class="call info"><span class="h">Streaming survives the wait</span>
  <p>A queued stream would otherwise sit silent long enough for an intermediary to
  assume it died. Instead it narrates, in SSE comment lines that every client ignores:</p>
<pre><code>: queued ahead=3 eta=41s
: waiting
: waiting
data: {"object":"chat.completion.chunk","choices":[{"delta":{"content":"..."}}]}</code></pre>
  <p>Hanging up during the wait cancels the work rather than leaving it to finish into
  a closed socket.</p></div>

  <div class="ep"><span class="m get">GET</span><code class="path">/api/queue</code></div>
  <p>Live: what is running, what is waiting, the rolling average per lane, and how much
  of each engine's hourly allowance is gone. The first thing to read when a call comes
  back 429 or takes a minute to start.</p>
</section>

<section id="pi">
  <h2>Pi</h2>
  <p>The Pi agent (<code>@earendil-works/pi-coding-agent</code>) embedded in this process through
  its SDK, running on MiniMax with <code>MINIMAX_API_KEY</code>. It replaced agy, the Antigravity
  CLI, after the Google accounts it ran on were banned. There is nothing to install or sign in:
  a missing key is the only way it is unavailable, and <code>GET /api/status</code> says so.</p>
  <p>Each call is a fresh in-memory session with exactly two tools: <code>web_search</code>
  (Tavily, the same rotating keys contact research uses) and <code>web_fetch</code> (a GET of a
  public page, reduced to text; private addresses are refused). No shell, no files, no project
  resources. Up to <code>PI_MAX_CONCURRENT</code> (6) run at once; contact research holds at most
  <code>CONTACT_LANES</code> (3) of them, so report rounds are not stuck behind its backlog. The rest queue.</p>
  <div class="tbl"><table>
    <thead><tr><th>Variable</th><th class="num">Default</th><th>Means</th></tr></thead>
    <tbody>
      <tr><td><code>MINIMAX_API_KEY</code></td><td class="num">&mdash;</td><td>MiniMax token-plan key. Required.</td></tr>
      <tr><td><code>PI_MODEL</code></td><td class="num">MiniMax-M3.1-Flash-Preview</td><td>MiniMax model id</td></tr>
      <tr><td><code>PI_THINKING</code></td><td class="num">low</td><td>thinking level; MiniMax-M3.1 refuses <code>off</code></td></tr>
      <tr><td><code>PI_MAX_CONCURRENT</code></td><td class="num">6</td><td>Pi runs in flight at once</td></tr>
    </tbody>
  </table></div>
  <p>Errors map to status codes the way a caller can act on: no key or a rejected key is 503
  <code>engine_unavailable</code>, a MiniMax rate limit is 503, a run past its deadline is 504.</p>
</section>

<section id="jobs">
  <h2>Jobs &mdash; work sent to a machine at home</h2>
  <p>Google Maps cannot be scanned from here. Google does not block a datacenter IP, it
  <strong>degrades</strong> it: the search that returns ~100 businesses from a home line
  returns ~60 from a rented one, with no error and no captcha. A scan run in this
  container is thin and looks complete.</p>
  <p>So the scan runs on a Mac mini at home, and this is the queue that reaches it. The
  mini is behind NAT with no public address, so the direction is inverted &mdash; it
  long-polls for work rather than being called. No tunnel, no port forwarding, no dynamic
  DNS.</p>
  <div class="tbl"><table>
    <thead><tr><th>Route</th><th>Does</th></tr></thead>
    <tbody>
      <tr><td><code>POST /api/jobs</code></td><td><code>{type, payload, timeoutMs}</code> &rarr; 201 with the job, status <code>pending</code></td></tr>
      <tr><td><code>GET /api/jobs/next?worker=&amp;wait=&amp;types=&amp;cooldownGroup=</code></td><td>the worker's claim. Held open up to 25s; <code>204</code> when idle or cooling down, <code>200</code> with a job. A cooldown response includes <code>X-Worker-Cooldown-Until</code>.</td></tr>
      <tr><td><code>POST /api/jobs/heartbeat</code></td><td><code>{worker, types, cooldownGroup}</code>. The worker's check-in while a job is in its hands. A claim is silent for as long as the handler runs, so without this a lane on a multi-minute research round ages out of the live table and the gateway refuses engines that machine is serving.</td></tr>
      <tr><td><code>POST /api/jobs/:id/result</code></td><td><code>{worker, ok, result, error}</code> &rarr; the job becomes <code>done</code> or <code>failed</code>. A quota failure includes <code>errorCode: "quota_reached"</code> and <code>retryAfterMs</code>; the broker returns <code>cooldownUntil</code>.</td></tr>
      <tr><td><code>GET /api/jobs/:id</code></td><td>status and result</td></tr>
      <tr><td><code>GET /api/jobs</code></td><td>the queue and each worker's status, last check-in, quota cooldown deadline, and remaining milliseconds</td></tr>
    </tbody>
  </table></div>
  <pre><code>ID=$(curl -s -X POST $LAB/api/jobs -H "authorization: Bearer $LAB_TOKEN" \
     -H 'content-type: application/json' -d '{"type":"ping"}' | jq -r .job.id)
curl -s $LAB/api/jobs/$ID -H "authorization: Bearer $LAB_TOKEN" | jq .job.result

{
  "hostname": "macmini",
  "platform": "darwin 24.5.0 arm64",
  "publicIp": "…the home line…"
}</code></pre>
  <p><code>publicIp</code> is the field worth reading: it is what the internet sees when
  that machine makes a request. A Railway address there would mean the job never left the
  container.</p>
  <h3>Job types</h3>
  <table>
    <tr><th>type</th><th>payload</th><th>returns</th></tr>
    <tr><td><code>ping</code></td><td>none</td><td><code>{hostname, platform, node, publicIp, uptimeSec, at}</code></td></tr>
    <tr><td><code>gmap.scan</code></td><td><code>{keyword, place?, max?, userId?}</code></td><td><code>{businesses[], found, capped, blocked, blockedReason, limitedView, saved}</code></td></tr>
    <tr><td><code>fb.company</code></td><td><code>{name, city?, phone?, website?, category?, budget?}</code></td><td><code>{engine, mode, lead, result, meta}</code> &mdash; the business's own Facebook Page</td></tr>
    <tr><td><code>fb.person</code></td><td><code>{person, company, city?, budget?}</code></td><td>the same envelope; that person's profile if it is publicly linked to the company</td></tr>
    <tr><td><code>fb.discover</code></td><td><code>{name, city?, budget?}</code></td><td>the same envelope, with <code>result.people[]</code></td></tr>
    <tr><td><code>fb.probe</code></td><td>none</td><td><code>{status, detail, ms}</code> &mdash; whether ego lite still holds a Facebook session</td></tr>
    <tr><td><code>x.subject</code></td><td><code>{subject, since?, lang?, max?, budget?}</code></td><td><code>{engine, mode, lead, result, meta}</code> &mdash; what X (x.com) is saying about the subject</td></tr>
    <tr><td><code>x.company</code></td><td><code>{name, city?, website?, phone?, since?, budget?}</code></td><td>the same envelope, shaped around a lead rather than a topic</td></tr>
    <tr><td><code>x.probe</code></td><td>none</td><td><code>{status, detail, account, ms}</code> &mdash; <code>ready</code>, <code>gated</code> or <code>logged_out</code> on grok.com</td></tr>
  </table>
  <pre><code>ID=$(curl -s -X POST $LAB/api/jobs -H "authorization: Bearer $LAB_TOKEN" \
     -H 'content-type: application/json' \
     -d '{"type":"gmap.scan","timeoutMs":600000,
          "payload":{"keyword":"aircon service","place":"Johor Bahru","max":40}}' \
     | jq -r .job.id)
curl -s $LAB/api/jobs/$ID -H "authorization: Bearer $LAB_TOKEN" | jq .job.result</code></pre>
  <p>A scan takes 12&ndash;60s depending on <code>max</code>, so pass a <code>timeoutMs</code>
  above the default; <code>600000</code> is the working figure. <code>max</code> defaults to 200.</p>
  <div class="call"><span class="h">Read <code>found</code>, not <code>businesses.length</code></span>
  <p><code>found</code> is <code>null</code> whenever <code>blocked</code> is true, and that is
  deliberate rather than missing. Google degrades a throttled search instead of erroring, so an
  empty feed and a town with no such trade are the same observation &mdash; recording either as
  <code>0</code> is the one thing that would quietly poison the dataset. A blocked scan therefore
  carries no count, and <code>blockedReason</code> names the signal that fired.
  <code>limitedView</code> marks a signed-out page, which is also why <code>reviews</code> comes
  back null.</p></div>
  <p>The worker writes each scan to Postgres itself &mdash; <code>company_data</code>,
  <code>search_report</code> and the link between them, deduped on Google's place id. The schema
  is checked in at <code>agy-lab/schema.sql</code>. <code>saved</code> reports what landed; when
  it is null, <code>saveError</code> says why and the rows still come back in the response.</p>
  <div class="call"><span class="h">In memory, and leased</span>
  <p>Jobs live in a Map and are lost on redeploy &mdash; about six minutes of exposure,
  accepted while the transport is being proven. Each job carries a lease instead: one that
  is still <code>running</code> past its <code>timeoutMs</code> goes back to
  <code>pending</code>, up to three times, then fails with a message saying so. A queue
  that strands work silently is worse than one that loses it visibly.</p></div>
  <div class="call"><span class="h">The social research types run on the mini</span>
  <p><code>fb.*</code> and <code>x.*</code> enrich a lead that came out of a scan &mdash; its
  Facebook presence, and what X is saying about it. Both live on the mini for the
  <code>gmap.scan</code> reason: the session is a login a human performed once in a browser
  profile on that machine, and there is no token to ship. Both are documented in
  <a href="#social">Social research</a> below.</p></div>
  <p>The long poll is not written to <a href="#logs">the request log</a>. One request every
  25 s forever would be ~3,500 records a day burying everything else; result posts and
  failures are still recorded.</p>
</section>

<section id="social">
  <h2>Social research &mdash; Facebook, and X through Grok</h2>
  <p>Two job families that take a lead out of a Maps scan and find what the social web
  already says about it. Both run on the machine at home, for the same reason
  <code>gmap.scan</code> does: the session is a login a human performed once, in a browser
  profile on that machine, and there is no token to ship to a container.</p>
  <p>Both answer in the same envelope &mdash; <code>{engine, mode, lead, result, meta}</code>
  &mdash; and both put a <code>confidence</code> of
  <code>confirmed&nbsp;|&nbsp;likely&nbsp;|&nbsp;weak&nbsp;|&nbsp;none</code> on the result.
  <b>Read that, not <code>found</code>.</b> The workers are instructed never to inflate it,
  because a <code>weak</code> honestly labelled is usable downstream and a wrong
  <code>likely</code> attached to a lead poisons everything built on it.
  <code>found: false</code> is a normal outcome, not a failure: plenty of real businesses
  have no Facebook page, and most are not discussed on X at all.</p>

  <h3><code>fb.*</code> &mdash; the business's own Facebook presence</h3>
  <p>A read-only crawler drives the browser and a model decides only <i>which rung of a
  search ladder to try next and when to stop</i>. The split is deliberate: the read-only
  contract &mdash; URL allowlist, click whitelist, never types into a field &mdash; lives
  inside the crawler, so it is enforced code rather than a hope about model behaviour. The
  model's entire tool surface is search / detail / posts, capped by a crawl budget.</p>
  <div class="tbl"><table>
    <thead><tr><th>Mode</th><th>Given</th><th>Finds</th></tr></thead>
    <tbody>
      <tr><td><code>fb.company</code></td><td>a business name, plus whatever the lead carries</td><td>its Page or Place: phone, email, website, address, followers, reviews</td></tr>
      <tr><td><code>fb.person</code></td><td>a person's name <b>and</b> their company</td><td>that person's profile, if it is publicly linked to the company</td></tr>
      <tr><td><code>fb.discover</code></td><td>a company name only</td><td>named humans on its public surface, in <code>result.people[]</code></td></tr>
      <tr><td><code>fb.probe</code></td><td>nothing</td><td>whether the browser still holds a Facebook session</td></tr>
    </tbody>
  </table></div>
  <div class="call"><span class="h">Half of the leads never reach a model</span>
  <p>An exact phone or website-domain match settles a company outright, and the deterministic
  scorer takes it: <code>meta.engine: "deterministic"</code>, <code>cost_usd: 0</code>,
  <code>turns: 0</code>, about 16 s instead of 40. The record is the same shape either way,
  so a caller never has to branch on which path ran. Model-ranked leads cost $0.05&ndash;0.15
  and carry <code>runners_up</code> explaining what lost.</p></div>
  <div class="call"><span class="h">Messenger links say where they came from</span>
  <p>A result with a profile carries <code>messenger_url</code> and
  <code>messenger_source</code>. <code>detected</code> means the page published an
  <code>m.me</code> link itself &mdash; the account stating it takes messages.
  <code>derived</code> means it was computed from the profile URL and is a <b>guess</b> that
  messages are accepted. Neither is verified: whether a link opens a normal thread or lands
  in Message Requests depends on the recipient's settings, and that is not observable
  read-only. The crawler cannot follow the link it emits &mdash; <code>m.me</code> fails its
  URL allowlist and <code>/messages/</code> is on its denylist &mdash; so this hands a human
  a link to click, it does not open conversations. Only a <code>detected</code> link is
  admitted to a research ledger.</p></div>
  <p>A lead is 16&ndash;120 s. <code>budget</code> is the cost dial: one unit is one page
  load plus a round of model context, default 10, two are enough for a company carrying a
  phone. This is also company research <b>Round 03</b> &mdash; the round that used to ask
  Meta AI what it could see now crawls the pages and reports the URL each field came from.</p>

  <h3><code>x.*</code> &mdash; what X is saying, asked through Grok</h3>
  <p>This one never visits x.com. It drives <b>grok.com</b> in the browser and lets Grok read
  X on our behalf, which buys a property a crawler cannot have: <b>no session it opens is
  ever on a page with a Like button</b>, so there is no code path by which it can repost,
  follow or reply.</p>
  <p>Grok is asked the question a person would ask &mdash; <i>what is being said on X about
  this, who is talking, what are the threads arguing about</i> &mdash; and answers in prose.
  A model then turns that reply into the record. The prompt is a frozen template inside the
  driver and the caller supplies only a subject string, so <b>&ldquo;search x.com and nothing
  else&rdquo; is a property of the code</b>, not a hope about model behaviour.</p>

  <div class="call"><span class="h">Read <code>cited</code>, not just <code>url</code></span>
  <p>Grok is a language model reading X, not a database of X, and it will occasionally
  produce a plausible status URL it never opened. The driver separates the permalinks Grok
  <i>rendered as links</i> &mdash; posts it actually opened, read off the page rather than
  off Grok's say-so &mdash; from those appearing only in its prose, and <code>cited</code>
  reflects that split. An uncited thread is not automatically wrong, but a result where
  <code>cited</code> is 0 of 12 is one to distrust, and the worker is told never to let
  uncited threads carry the confidence rating alone.</p></div>

  <pre><code>ID=$(curl -s -X POST $LAB/api/jobs -H "authorization: Bearer $LAB_TOKEN" \
     -H 'content-type: application/json' \
     -d '{"type":"x.subject","timeoutMs":600000,
          "payload":{"subject":"Grok 5 launch","since":"2026-06-01","budget":2}}' \
     | jq -r .job.id)
curl -s $LAB/api/jobs/$ID -H "authorization: Bearer $LAB_TOKEN" | jq .job.result</code></pre>

  <p><code>result.threads[]</code> carries <code>url</code>, <code>author</code>,
  <code>date</code>, <code>topic</code>, <code>stance</code>, <code>replies</code>,
  <code>excerpt</code> and <code>cited</code>; <code>result.accounts[]</code> carries the
  handles worth knowing about and why. <code>searches_run</code> and <code>reasoning</code>
  are the audit trail, and each run keeps the URL of the Grok conversation itself on the
  mini &mdash; open it and read the exchange when an answer looks wrong. That separates a
  bad answer from a bad question.</p>

  <div class="call"><span class="h">Three things that will bite you</span>
  <p><b>It is slow.</b> One Grok ask is 40&ndash;120s and the default budget is four of them,
  so a lead can run six minutes. Pass <code>timeoutMs</code> of <code>600000</code>; that is
  also the handler's own default. Measured: a two-ask subject lands in ~180s for $0.41.</p>
  <p><b><code>gated</code> is not <code>logged_out</code>.</b> <code>x.probe</code> answers
  <code>ready</code>, <code>gated</code> or <code>logged_out</code>, and the remedies differ.
  <code>gated</code> means the grok.com session is fine but a dialog &mdash; in practice an
  age confirmation &mdash; is in the way, and the driver will not click it: an age
  attestation is a statement about a person, not a checkbox a job may tick. A human clears
  it on the mini, once per browser task space, and it is a <b>two-step</b> dialog whose
  second step is easy to miss. It appears on send rather than on load, so a clean probe is
  evidence and not a guarantee.</p>
  <p><b>The empty case is free.</b> A subject with no post links at all on the first ask is
  settled without a model call &mdash; <code>engine: "deterministic"</code>,
  <code>cost_usd: 0</code>. A truncated or empty answer is deliberately <i>not</i> treated as
  absence: that is evidence the ask went wrong, and it goes to the model instead.</p></div>

  <p>Each family has its own lane and its own browser space, running one job at a time; a
  second arriving early fails with <code>busy</code> and is worth retrying.</p>
</section>

<section id="logs">
  <h2>Logs</h2>
  <div class="ep"><span class="m get">GET</span><code class="path">/api/logs</code><span class="tag">?limit= ?errors=1 ?engine= ?status= ?since= ?date= ?path=</span></div>
  <div class="ep"><span class="m get">GET</span><code class="path">/api/logs/errors</code><span class="tag">the same thing, pre-filtered</span></div>
  <p>One record per request, newest first. Two lifetimes, because two different
  questions are being asked: the last thousand calls stay in memory for
  <em>what just broke</em>, and every call is appended to
  <code>/data/logs/api-YYYY-MM-DD.jsonl</code> for <em>what happened on Tuesday</em>. Pass
  <code>date=</code> to read a day off the volume instead of memory; the response lists
  which days exist.</p>
  <div class="tbl"><table>
    <thead><tr><th>Field</th><th>Is</th></tr></thead>
    <tbody>
      <tr><td><code>at</code> <code>method</code> <code>path</code> <code>status</code> <code>ms</code></td><td>the request, and how it ended</td></tr>
      <tr><td><code>engine</code> <code>model</code> <code>stream</code></td><td>which engine ran, fully qualified</td></tr>
      <tr><td><code>queuedMs</code> <code>engineMs</code></td><td>time split between waiting for a turn and doing the work — the pair that says whether the gateway or the engine is slow</td></tr>
      <tr><td><code>promptChars</code> <code>promptHead</code> <code>answerChars</code></td><td>size, and the first 140 characters of the prompt</td></tr>
      <tr><td><code>error</code></td><td><code>{type, message}</code> when the call failed</td></tr>
      <tr><td><code>ip</code> <code>ua</code></td><td>from <code>x-forwarded-for</code> and the user agent</td></tr>
    </tbody>
  </table></div>
<pre><code>curl -s "https://ee-auto.up.railway.app/api/logs?errors=1&amp;limit=20" -H "Authorization: Bearer $LAB_TOKEN"

{"source":"memory","count":3,"entries":[
  {"id":214,"at":"2026-08-20T09:14:02.111Z","method":"POST","path":"/v1/chat/completions",
   "engine":"pi","model":"pi","promptChars":88,
   "queuedMs":41230,"ms":54900,"status":429,
   "error":{"type":"queue_full","message":"System busy: 10 calls are already waiting..."}}
]}</code></pre>
  <div class="call warn"><span class="h">What is not in the log</span>
  <p>The token. It arrives in a header and, for clients that cannot set one, in
  <code>?token=</code> — so the query string is stored with that parameter redacted. A log
  that leaks the credential is worse than no log.</p>
  <p>Records start <em>before</em> the auth check, so rejected tokens appear as 401s: a
  misconfigured client that nobody can see stays misconfigured. Set
  <code>LOG_PROMPTS=0</code> to keep sizes and drop prompt previews.</p></div>
  <p><code>GET /api/status</code> carries a summary — counts by status class, how many
  errors are in the ring, how many days are on disk, and any failure to write.</p>
</section>

<section id="service">
  <h2>Service</h2>
  <div class="tbl"><table>
    <thead><tr><th>Route</th><th>Does</th></tr></thead>
    <tbody>
      <tr><td><code>GET /healthz</code></td><td>unauthenticated liveness</td></tr>
      <tr><td><code>GET /api/status</code></td><td>Pi worker status, container memory, uptime, and the last crash it survived</td></tr>
      <tr><td><code>POST /api/exec</code></td><td>run a shell command in the container</td></tr>
      <tr><td><code>GET /</code></td><td>the operator console</td></tr>
    </tbody>
  </table></div>
  <div class="call stop"><span class="h">This token is a root shell</span>
  <p><code>/api/exec</code> runs arbitrary commands in a container holding API keys.
  <code>LAB_TOKEN</code> is not an API key in the ordinary sense — treat it as SSH access.
  The service refuses to start if it is shorter than 16 characters.</p></div>
</section>

<section id="errors">
  <h2>Errors</h2>
  <p>OpenAI's envelope: <code>{"error":{"message","type","code"}}</code>.</p>
  <div class="tbl"><table>
    <thead><tr><th>Status</th><th>type</th><th>Means</th></tr></thead>
    <tbody>
      <tr><td class="num">401</td><td><code>invalid_request_error</code></td><td>bad or missing token</td></tr>
      <tr><td class="num">400</td><td><code>invalid_request_error</code></td><td>a request the gateway will not fake — <code>n&gt;1</code>, empty messages, a prompt with no text</td></tr>
      <tr><td class="num">404</td><td><code>model_not_found</code></td><td>unknown model name or location</td></tr>
      <tr><td class="num">429</td><td><code>queue_full</code> &middot; <code>queue_too_slow</code> &middot; <code>rate_limit_exceeded</code></td><td>system busy — see <a href="#queue">Queue</a>. Carries <code>Retry-After</code> and a queue snapshot.</td></tr>
      <tr><td class="num">503</td><td><code>engine_unavailable</code></td><td>Pi has no key, or MiniMax is rate limiting</td></tr>
      <tr><td class="num">504</td><td><code>timeout</code></td><td>the engine ran past <code>timeoutMs</code></td></tr>
      <tr><td class="num">502</td><td><code>engine_error</code></td><td>it ran and failed — the message says how</td></tr>
    </tbody>
  </table></div>
  <p>In a stream, all of these arrive as a final error chunk instead, because the status line
  has already gone out.</p>
</section>

<section id="limits">
  <h2>Limits</h2>
  <p>Pi runs at most <code>PI_MAX_CONCURRENT</code> (6) calls at once; contact research holds up
  to <code>CONTACT_LANES</code> (3) of them. Everything past that queues &mdash; see
  <a href="#queue">Queue</a>.</p>
</section>

<section id="env">
  <h2>Environment</h2>
  <div class="tbl"><table>
    <thead><tr><th>Variable</th><th>Default</th><th></th></tr></thead>
    <tbody>
      <tr><td><code>LAB_TOKEN</code></td><td class="num">&mdash;</td><td>required, 16+ characters; the key for everything under <code>/api</code> and <code>/v1</code></td></tr>
      <tr><td><code>PORTAL_TOKEN</code></td><td class="num">unset</td><td>optional 16+ character end-user key; authorizes only report listing, business search, and company research routes</td></tr>
      <tr><td><code>DATABASE_URL</code></td><td class="num">&mdash;</td><td>preferred durable Postgres connection for published reports; link the Railway database service</td></tr>
      <tr><td><code>PG_PROXY_URL</code> &middot; <code>PG_DB_NAME</code> &middot; <code>PG_PROXY_TOKEN</code></td><td class="num">unset</td><td>HTTP database fallback; the token expires and is not preferred for production</td></tr>
      <tr><td><code>TRANSLATION_MODEL</code></td><td class="num">pi</td><td>engine for the Simplified Chinese company-report copy; any model this gateway serves. No separate endpoint or key any more &mdash; the translation goes through the same admission queue as every other call</td></tr>
      <tr><td><code>TRANSLATION_BATCH</code></td><td class="num">60</td><td>strings per translation call</td></tr>
      <tr><td><code>TRANSLATION_CONCURRENCY</code></td><td class="num">2</td><td>translation calls in flight; match it to the lanes serving <code>TRANSLATION_MODEL</code>, since wider only queues them one hop later</td></tr>
      <tr><td><code>DEFAULT_MODEL</code></td><td class="num">pi</td><td>what an empty or <code>auto</code> model resolves to</td></tr>
      <tr><td><code>MINIMAX_API_KEY</code></td><td class="num">&mdash;</td><td>the Pi worker's MiniMax key; see <a href="#pi">Pi</a> for the other <code>PI_*</code> settings</td></tr>
      <tr><td><code>PI_ASK_TIMEOUT_MS</code></td><td class="num">300000</td><td></td></tr>
      <tr><td><code>PI_MAX_CONCURRENT</code></td><td class="num">6</td><td>Pi runs in flight at once</td></tr>
      <tr><td><code>PI_MIN_GAP_MS</code></td><td class="num">0</td><td></td></tr>
      <tr><td><code>QUEUE_MAX_DEPTH</code></td><td class="num">10</td><td>waiting calls before 429 when <code>QUEUE_REJECT=true</code>; <code>PI_MAX_QUEUE</code> overrides it</td></tr>
      <tr><td><code>QUEUE_MAX_WAIT_MS</code></td><td class="num">300000</td><td>longest wait the gateway will promise; past it, 429</td></tr>
      <tr><td><code>PI_HOURLY_LIMIT</code></td><td class="num">off</td><td>calls per rolling hour</td></tr>
      <tr><td><code>LOG_MEMORY</code></td><td class="num">1000</td><td>records kept in memory for <code>/api/logs</code></td></tr>
      <tr><td><code>LOG_PROMPTS</code></td><td class="num">on</td><td><code>0</code> drops prompt previews from the log</td></tr>
    </tbody>
  </table></div>
</section>

<footer>
  <p>Served by the deploy it documents. The repo's <code>API.md</code> carries the detail behind
  every claim here.</p>
</footer>
</main>
</div>`;
}

/** The served document: the same markup, wrapped. */
export function page(): string {
  return String.raw`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark">
<title>EE Business Intelligence API</title>
</head>
<body>
` + body() + `
</body>
</html>`;
}
