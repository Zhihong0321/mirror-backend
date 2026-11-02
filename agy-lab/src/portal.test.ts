import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { page } from './portal.ts';

test('end-user portal combines discovery, deep research, and report library', () => {
  const html = page();
  assert.match(html, /width=device-width/);
  assert.match(html, /Find the companies worth knowing/);
  assert.match(html, /Research library/);
  assert.match(html, />Reports<\/button>/);
  assert.match(html, /\/api\/business-search/);
  assert.match(html, /\/api\/company-research/);
  assert.match(html, /person_research/);
  assert.match(html, /VIP briefs/);
  assert.match(html, /person_research/);
  assert.match(html, /\/api\/reports\?limit=/);
  assert.match(html, /Deep research →/);
  assert.match(html, /aria-label="Start deep research for /);
  assert.match(html, /Research underway/);
  assert.match(html, /Open research report for /);
  assert.match(html, /Open report any time to follow progress/);
  assert.match(html, /Enter a business, a location, or both/);
  assert.match(html, /if\(!keyword&&!place\)/);
  assert.doesNotMatch(html, /id="keyword" required/);
  // The key is entered once. A per-tab store meant every report link opened in a
  // new tab asked again, so the durable copy is a cookie mirrored to localStorage.
  assert.match(html, /document\.cookie/);
  assert.match(html, /eeKey\.read\(\)/);
  assert.doesNotMatch(html, /sessionStorage\.getItem\('ee_portal_token'\)/);
  assert.ok(!process.env.LAB_TOKEN || !html.includes(process.env.LAB_TOKEN), 'the operator token never reaches a served page');
  const script = /<script>([\s\S]*)<\/script>/.exec(html)?.[1];
  assert.ok(script);
  assert.doesNotThrow(() => new Function(script));
});

test('the telemarketing page is the workspace with the calling floor only', () => {
  const html = page('telemarketing');
  assert.match(html, /<body data-portal="telemarketing">/);
  assert.match(html, /id="portalApp" class="app telemarketing"/);
  assert.match(html, /Telemarketing Lead Map/);
  assert.match(html, /class="brand" aria-label="Home" onclick="switchView\('telemarketing'\)"/);
  assert.match(html, /switchView\('telemarketing'\);showToast\('Workspace connected'\)/);
  assert.match(html, /\.telemarketing \.nav-button\[data-view="discover"\]/);
  assert.match(html, /\.telemarketing \.nav-button\[data-view="library"\]/);
  assert.match(html, /\.telemarketing \.nav-button\[href="\/guide"\]/);
  assert.match(html, /\.telemarketing \.mobile-tab\[data-view="discover"\]/);
  assert.match(html, /\.telemarketing \.mobile-tab\[data-view="library"\]/);
  assert.match(html, /\.telemarketing \.mobile-tab\[href="\/guide"\]/);
  // The full markup stays shared so /telemarketing cannot drift from /research.
  // What differs is only that the non-calling affordances are hidden.
  assert.match(html, /id="discoverView"/);
  assert.match(html, /id="libraryView"/);
  assert.match(html, /href="\/guide"/);
});

test('portal uses a mobile bottom navigation and scoped access gate', () => {
  const html = page();
  assert.match(html, /class="mobile-nav"/);
  assert.match(html, /@media\(max-width:820px\)/);
  assert.match(html, /Workspace access key/);
  assert.match(html, /never added to a report link/);
  assert.match(html, /You enter it once/);
});

test('the front page is four named choices, and each one opens its own form', () => {
  const html = page();
  // The landing used to be a market form with the company lookup hidden behind a
  // tab -- two of the three things the workspace does were invisible on arrival.
  assert.match(html, /id="chooser"/);
  assert.match(html, />Business list<\/h2>/);
  assert.match(html, />Company research<\/h2>/);
  assert.match(html, />Ads market research<\/h2>/);
  assert.match(html, />Completed report<\/h2>/);
  // The form is not on screen until a choice is made, and the third choice is
  // the library rather than a form.
  assert.match(html, /id="searchForm" class="search-sheet hidden"/);
  assert.match(html, /id="maxResults"><option value="200" selected>200<\/option><option value="400">400<\/option><option value="600">600<\/option>/);
  assert.match(html, /function choose\(choice\)\{if\(choice==='reports'\)return switchView\('library'\)/);
  assert.match(html, /function goHome\(\)/);
  assert.doesNotMatch(html, /class="mode-tab/);
});

test('a company can be researched by name, after the operator confirms the Maps match', () => {
  const html = page();
  // The market scan was once the only way in, so a user who knew exactly which
  // company they wanted had to search a category and hunt.
  assert.match(html, /data-mode="market"/);
  assert.match(html, /data-mode="company"/);
  assert.match(html, /id="companyName"/);
  assert.match(html, />Find company</);
  // The name is a Maps lookup whose matches the user picks from -- never an
  // auto-pick, because the wrong branch costs a full four-round research run.
  assert.match(html, /Which one is yours\?/);
  assert.match(html, /Nothing is researched until you pick one/);
  assert.match(html, /state\.mode==='company'\)return startLookup\(\)/);
  assert.match(html, /keyword:name,place:place\|\|undefined,max:10/);
});

test('every validated person in a dossier can be sent to VIP research', () => {
  const html = page();
  assert.match(html, /\/api\/person-research/);
  assert.match(html, /companyResearchId:reportId,personId:personId/);
  assert.match(html, /VIP brief \\u2192/);
  assert.match(html, /Validated people/);
  // P01 already has an automatic brief. Offering "start" there would either
  // duplicate a four-round run or dead-end on the server's dedup.
  assert.match(html, /pid===autoPerson&&autoReport/);
  assert.match(html, /Open brief/);
  // Candidate people have no id the person-research route accepts, and their
  // role is unevidenced -- they are shown as leads, never as a launch button.
  assert.match(html, /Leads to verify/);
  assert.match(html, /confirm the role before a brief/);
  // Only a finished dossier has people to offer.
  assert.match(html, /var ready=deep&&\(report\.status==='completed'\|\|report\.status==='partial'\)/);
});

test('a company dossier offers ads research, and links an existing run instead', async () => {
  const ui = await import('./reportui.ts');
  const base = {
    public_id: 'AAAAAAAAAAAAAAAAAAAA', report_type: 'company_research', title: 'Solarvest',
    company_id: '42', error: null, created_at: '', updated_at: '',
    result: { entity: { name: 'SOLARVEST ENERGY SDN BHD' }, summary: 'x', people: [], contacts: [] },
  } as never;

  const done = ui.companyPage({ ...(base as object), status: 'completed' } as never, null, {}, null);
  assert.match(done, /data-ads="1"/);
  assert.match(done, /\/api\/ads-research/);
  // The crawl is keyed by the company's own name, not the report title.
  assert.match(done, /data-name="SOLARVEST ENERGY SDN BHD"/);

  // A dossier still running has nothing to advertise-research against yet.
  const running = ui.companyPage({ ...(base as object), status: 'running' } as never, null, {}, null);
  assert.doesNotMatch(running, /data-ads="1"/);

  // An existing capture is linked, never offered again -- the same rule the VIP
  // button follows, so a second crawl of one advertiser cannot be started by clicking.
  const linked = ui.companyPage(
    { ...(base as object), status: 'completed' } as never, null, {},
    { public_id: 'BBBBBBBBBBBBBBBBBBBB', status: 'completed' },
  );
  assert.match(linked, /\/r\/BBBBBBBBBBBBBBBBBBBB/);
  assert.doesNotMatch(linked, /data-ads="1"/);
});

test('ads market research takes a product keyword and defaults to Malaysia', () => {
  const html = page();
  assert.match(html, /id="adsGrid"/);
  assert.match(html, /<label for="adsKeyword">Product keyword<\/label>/);
  // Malaysia is the default and must be the SELECTED option, not merely first in
  // the list -- a country picker that quietly starts somewhere else would send
  // every run to the wrong ad library region.
  assert.match(html, /<option value="Malaysia" selected>Malaysia<\/option>/);
  assert.match(html, /\/api\/ads-market/);
  // The form must route to its own starter; falling through to startLookup would
  // run a Google Maps search instead of an ad library crawl.
  assert.match(html, /if\(state\.mode==='adsmarket'\)return startAdsMarket\(\)/);
  assert.match(html, /data-filter="ads_market"/);
});

test('the portal itself offers ads research on a finished dossier', () => {
  const html = page();
  // The portal renders its OWN dossier card, separate from the /r/:id report page.
  // Shipping the button on only one of the two surfaces is how this was missed once.
  assert.match(html, /Ads research/);
  assert.match(html, /async function startAds/);
  assert.match(html, /'\/api\/ads-research'/);
  // Only a finished company dossier -- not a business list, not a run still going.
  assert.match(html, /deep&&ready\?'<button class="text-action"/);
  // The crawl is keyed by the company name, with the report-title suffix stripped.
  assert.match(html, /function companyName/);
  assert.match(html, /intelligence report\$/);
});

test('the run trail renders every event in order, and marks the ones that failed', async () => {
  const ui = await import('./reportui.ts');
  const report = {
    public_id: 'BBBBBBBBBBBBBBBBBBBB', report_type: 'company_research', status: 'partial',
    title: 'Newpages Network Sdn Bhd intelligence report', company_id: '1042',
    error: null, created_at: '', updated_at: '',
  } as never;

  const html = ui.logPage(report, [
    { id: 1, at: '2026-08-23T16:14:37.024Z', stage: 'report', event: 'report.created', job_id: null, detail: { type: 'company_research' } },
    { id: 2, at: '2026-08-23T16:14:37.042Z', stage: 'fb.company', event: 'job.created', job_id: 'd58d1a7b4dea', detail: { type: 'fb.company' } },
    { id: 3, at: '2026-08-23T16:14:52.053Z', stage: 'fb.company', event: 'job.failed', job_id: 'd58d1a7b4dea', detail: { error: 'claude exited 1', ms: 14802 } },
    { id: 4, at: '2026-08-23T16:20:25.148Z', stage: 'final', event: 'final.saved', job_id: null, detail: { contacts: 24, people: 12 } },
  ] as never);

  // Order is the point: the trail is read top to bottom.
  assert.ok(html.indexOf('report.created') < html.indexOf('job.failed'));
  assert.ok(html.indexOf('job.failed') < html.indexOf('final.saved'));
  // Elapsed offsets from the first event, so a five-minute gap is visible at a glance.
  assert.match(html, /\+0s/);
  assert.match(html, /\+348s/);
  // A failure is tinted, not just spelled.
  assert.match(html, /<tr class="error">[\s\S]*?job\.failed/);
  // The detail of a failure is the failure, not the exit code alone.
  assert.match(html, /claude exited 1/);
  assert.match(html, /d58d1a7b4dea/);
  // And a way back to the report it describes.
  assert.match(html, /href="\/r\/BBBBBBBBBBBBBBBBBBBB"/);
});

test('a run with no trail says so instead of rendering an empty table', async () => {
  const ui = await import('./reportui.ts');
  const report = {
    public_id: 'CCCCCCCCCCCCCCCCCCCC', report_type: 'company_research', status: 'completed',
    title: 'Older run', company_id: '1', error: null, created_at: '', updated_at: '',
  } as never;
  const html = ui.logPage(report, []);
  assert.match(html, /No events recorded for this run/);
});

test('any report can be deleted from the library, behind a confirm', () => {
  const html = page();
  // The button is on every row unconditionally -- any type, any status. A run
  // still going is deletable too; the poll handler is what cleans up after it.
  assert.match(html, /onclick="deleteReport\(this\)"/);
  assert.match(html, /async function deleteReport/);
  assert.match(html, /'\/api\/reports\/'\+encodeURIComponent\(id\),\{method:'DELETE'\}/);
  // Deletion is permanent and one click away from every report, so it does not
  // happen without the user reading what they are about to lose.
  assert.match(html, /window\.confirm/);
  assert.match(html, /cannot be undone/);
  // A 404 means someone else already deleted it -- the row disappears rather
  // than erroring, and a poll that hits 404 stops instead of retrying forever.
  assert.match(html, /function forgetReport/);
  assert.match(html, /error\.status===404/);
});

test('a failed report can be re-run in place, and the bulk button counts before it asks', () => {
  const html = page();
  // Per-row: only a failed row is offered a re-run, and it posts to that
  // report's own retry route -- the row is reused, never duplicated, so the
  // public /r/:id link a caller already holds stays the valid one.
  assert.match(html, /onclick="retryReport\(this\)"/);
  assert.match(html, /async function retryReport/);
  assert.match(html, /report\.status==='failed'\?'<button class="text-action"/);
  assert.match(html, /'\+encodeURIComponent\(id\)\+'\/retry',\{method:'POST'\}/);

  // The bulk button walks every failed report first, shows the human the exact
  // count, and only queues after they confirm -- no silent fleet restart.
  assert.match(html, /onclick="retryFailedReports\(this\)"/);
  assert.match(html, /Re-run all failed reports/);
  assert.match(html, /status=failed&limit=100&offset=/);
  assert.match(html, /window\.confirm\('Re-run all '\+failed\.length\+' failed reports\?/);

  // Every poll starts through the one type->kind map, so the Active work label
  // cannot drift from what loadLibrary would have picked for the same row.
  assert.match(html, /function kindFor\(report\)/);
  assert.match(html, /poll\(report,kindFor\(report\)\)/);
  assert.match(html, /poll\(body\.report,kindFor\(body\.report\)\)/);
});

test('the portal script has no undefined identifiers in its job renderer', () => {
  const html = page();
  // A bare `kind` inside renderJobs (where the variable is `job.kind`) threw
  // "kind is not defined" on every render of the Active work panel, which took
  // out company research entirely. The label chain must read job.kind throughout.
  assert.doesNotMatch(html, /[^.\w]kind==='ads'/);
  assert.match(html, /job\.kind==='ads'\?'Ads'/);

  // And the whole inline script must actually parse. new Function does not run it,
  // it only compiles - which is exactly the check that was missing.
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  assert.ok(scripts.length > 0, 'portal ships an inline script');
  for (const src of scripts) {
    assert.doesNotThrow(() => new Function(src), 'portal inline script must parse');
  }
});

test('a partial business list offers saved-data repair and displays its save error', () => {
  const html = page();
  assert.match(html, /Repair save/);
  assert.match(html, /function repairReport\(button\)/);
  assert.match(html, /\/api\/reports\/.*\/repair/);
  assert.match(html, /Save issue:/);
});

function tamanScanContext(towns: unknown[], requests: { keyword: string; place: string }[], toasts: string[]) {
  return {
    teleState: { data: { districts: [{ towns }] }, queueingTown: false },
    state: { token: 'test' },
    el: () => ({ value: '200' }),
    api: async (_path: string, options: { body: string }) => {
      const body = JSON.parse(options.body);
      requests.push({ keyword: body.keyword, place: body.place });
      return { report: { id: body.place } };
    },
    upsertJob: () => {},
    poll: () => {},
    authLost: () => false,
    showToast: (message: string) => toasts.push(message),
    loadTelemarketingView: async () => {},
  };
}

function tamanScanRun(html: string, towns: unknown[], requests: { keyword: string; place: string }[], toasts: string[]) {
  const start = html.indexOf('function findTaman');
  const end = html.indexOf('async function openTamanAssignModal', start);
  assert.ok(start > 0 && end > start);
  return vm.runInNewContext(html.slice(start, end) + '; queueTamanScanFromBtn', tamanScanContext(towns, requests, toasts));
}

function scanButton(place: string, keywords: string) {
  return { getAttribute: (name: string) => name === 'data-place' ? place : keywords, disabled: false, textContent: 'Scan' };
}

test('a taman scan button queues its keyword even when that keyword already has leads (explicit re-scan)', async () => {
  const html = page();
  const requests: { keyword: string; place: string }[] = [];
  const toasts: string[] = [];
  const towns = [{ name: 'Example Town', tamans: [
    { name: 'Has leads', queryPlace: 'Has leads, Example Town', scanByKeyword: { business: { status: 'completed', count: 5 } } },
  ] }];
  const run = tamanScanRun(html, towns, requests, toasts);
  const button = scanButton('Has leads, Example Town', 'business');
  await run(button);
  assert.deepEqual(requests, [{ keyword: 'business', place: 'Has leads, Example Town' }]);
  assert.equal(button.disabled, false);
});

test('a taman scan is skipped for a keyword that is already queued or running on that taman', async () => {
  const html = page();
  const requests: { keyword: string; place: string }[] = [];
  const toasts: string[] = [];
  const towns = [{ name: 'Example Town', tamans: [
    { name: 'Running', queryPlace: 'Running, Example Town', scanByKeyword: { business: { status: 'running', count: 0 } } },
  ] }];
  const run = tamanScanRun(html, towns, requests, toasts);
  await run(scanButton('Running, Example Town', 'business'));
  assert.deepEqual(requests, []);
  assert.deepEqual(toasts, ['Running is already scanning for that.']);
});

test('scan all on a taman queues each keyword that is not already active there', async () => {
  const html = page();
  const requests: { keyword: string; place: string }[] = [];
  const toasts: string[] = [];
  const towns = [{ name: 'Example Town', tamans: [
    { name: 'Factory running', queryPlace: 'Factory running, Example Town', scanByKeyword: { factory: { status: 'queued', count: 0 } } },
    { name: 'New', queryPlace: 'New, Example Town' },
  ] }];
  const run = tamanScanRun(html, towns, requests, toasts);
  await run(scanButton('New, Example Town', 'business,factory'));
  await run(scanButton('Factory running, Example Town', 'business,factory'));
  assert.deepEqual(requests, [
    { keyword: 'business', place: 'New, Example Town' },
    { keyword: 'factory', place: 'New, Example Town' },
    { keyword: 'business', place: 'Factory running, Example Town' },
  ]);
});

test('scan page has business, factory and shop buttons on each taman and no town-level scan', () => {
  const html = page();
  assert.match(html, /data-keywords="business"/);
  assert.match(html, /data-keywords="factory"/);
  assert.match(html, /data-keywords="shop"/);
  // Business already sweeps every factory and shop word, so a combined button would only pay twice.
  assert.doesNotMatch(html, /data-keywords="business,factory"/);
  assert.match(html, /onclick="queueTamanScanFromBtn\(this\)"/);
  assert.doesNotMatch(html, /queueWholeTownFromBtn/);
  assert.doesNotMatch(html, /town-scan/);
});

test('contact research button queues research for the pending leads of one taman after confirmation', async () => {
  const html = page();
  const start = html.indexOf('function findTaman');
  const end = html.indexOf('async function openTamanAssignModal', start);
  assert.ok(start > 0 && end > start);
  const requests: { path: string; body: { taman: string; queryPlace: string } }[] = [];
  const toasts: string[] = [];
  const towns = [{ name: 'Example Town', tamans: [
    { name: 'Pending', queryPlace: 'Pending, Example Town', contactPending: 3 },
    { name: 'Done', queryPlace: 'Done, Example Town', contactPending: 0 },
  ] }];
  const context = {
    teleState: { data: { districts: [{ towns }] }, queueingTown: false },
    state: { token: 'test' },
    window: { confirm: () => true },
    el: () => ({ value: 'johor' }),
    api: async (path: string, options: { body: string }) => {
      requests.push({ path, body: JSON.parse(options.body) });
      return { queued: 3, alreadyRunning: 0, failed: 0 };
    },
    authLost: () => false,
    showToast: (message: string) => toasts.push(message),
    loadTelemarketingView: async () => {},
  };
  const run = vm.runInNewContext(html.slice(start, end) + '; runTamanContactResearchFromBtn', context);
  const button = { getAttribute: () => 'Pending, Example Town', disabled: false, textContent: 'Research 3 pending' };
  await run(button);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].path, '/api/territories/contact-research');
  assert.equal(requests[0].body.taman, 'Pending');
  assert.equal(requests[0].body.queryPlace, 'Pending, Example Town');
  assert.deepEqual(toasts, ['Queued 3 contact research for Pending']);

  await run({ getAttribute: () => 'Done, Example Town', disabled: false, textContent: 'x' });
  assert.equal(requests.length, 1);
  assert.deepEqual(toasts.at(-1), 'Nothing to research at Done.');
});
