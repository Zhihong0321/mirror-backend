import { countryIndustryPage } from './country-industry-page.ts';
// agy-lab: the HTTP surface.
//
// This binds 0.0.0.0 because Railway requires it, and it exposes a shell endpoint
// because finding out where a credential lands is not a thing you can do through
// a fixed API. Those two facts together are why LAB_TOKEN is mandatory and the
// process refuses to start without it. There is no "dev mode" that skips it: an
// open /api/exec on a public hostname is a root shell for whoever scans the port
// first, and this container holds API keys.
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { exec } from 'node:child_process';
import { llm as extractLlm, pi, secrets } from './core/index.ts';
import * as gateway from './gateway.ts';
import * as jobs from './jobs.ts';
import * as queue from './queue.ts';
import * as log from './logstore.ts';
import * as intel from './intel.ts';
import * as reportdb from './reportdb.ts';
import * as autoContact from './autocontact.ts';
import * as autoScan from './autoscan.ts';
import * as contactWorker from './contact-worker.ts';
import * as mapsWorker from './maps-worker.ts';
import * as gmapWorker from './gmap-worker.ts';
import * as countryResearch from './country-research.ts';
import * as searchList from './search-list.ts';
import * as companies from './company-uid.ts';
import * as listStep2 from './list-step2.ts';
import { searchListPage } from './search-list-page.ts';
import { researchLeadsPage } from './research-leads-page.ts';
import * as contactKeys from './contact-keys.ts';
import * as companyDive from './companydive.ts';
import * as companyDivePeople from './companydive-people.ts';
import { page as companyDivePage } from './companydive-page.ts';
import * as diveDeeper from './divedeeper.ts';
import * as siteEmails from './site-emails.ts';
import * as emailMarketing from './email-marketing.ts';
import * as emailReplies from './email-replies.ts';
import * as contactFormDelivery from './contact-form-delivery.ts';
import { page as emailMarketingPage } from './email-marketing-page.ts';
import { page } from './ui.ts';
import { page as docsPage } from './docs.ts';
import { document as openApiDocument } from './openapi.ts';
import { page as portalPage } from './portal.ts';
import { page as guidePage } from './guide.ts';
import { page as workersPage } from './workers.ts';
import * as autoQueuePage from './autoqueue.ts';
import { missingPage } from './nav.ts';

const PORT = Number(process.env.PORT ?? 8080);
const HOME = process.env.HOME ?? '/data';

/** Container memory from cgroup v2, plus this process's own RSS. */
function memory(): Record<string, unknown> {
  const read = (p: string): number | null => {
    try {
      return Number(fs.readFileSync(p, 'utf8').trim());
    } catch {
      return null;
    }
  };
  const mb = (n: number | null) => (n === null || !Number.isFinite(n) ? null : Math.round(n / 1024 / 1024));
  return {
    containerUsedMb: mb(read('/sys/fs/cgroup/memory.current')),
    containerLimitMb: mb(read('/sys/fs/cgroup/memory.max')),
    rssMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
  };
}
const TOKEN = process.env.LAB_TOKEN ?? '';
const PORTAL_TOKEN = process.env.PORTAL_TOKEN?.trim() ?? '';

if (TOKEN.length < 16) {
  console.error('LAB_TOKEN is missing or shorter than 16 characters. Refusing to start.');
  console.error('Set it in the Railway service variables, then redeploy.');
  process.exit(1);
}

const STARTED_AT = new Date().toISOString();
/** Survives only until the next restart, which is exactly the window it describes. */
let lastCrash: { kind: string; message: string; at: string } | null = null;

/**
 * Stay up, and say what happened.
 *
 * An unhandled rejection is fatal by default in modern Node, and this process
 * drives browsers whose pages close under it at unpredictable moments — so the
 * default turns "a screenshot lost its page" into "the container restarted and
 * every endpoint 502s". Surviving is the right trade here: this is a research
 * harness whose job is to still be answering when something else broke, and a
 * recorded crash you can read beats a clean exit you cannot.
 */
for (const kind of ['unhandledRejection', 'uncaughtException'] as const) {
  process.on(kind, (err: unknown) => {
    const message = (err as Error)?.stack ?? String(err);
    lastCrash = { kind, message: message.slice(0, 2000), at: new Date().toISOString() };
    console.error(`[${kind}] ${message}`);
  });
}

function json(res: http.ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body, null, 2);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'authorization, content-type, x-telemarketer-uid, x-telemarketer-id, x-agent-uid, x-api-key, accept',
    'access-control-allow-methods': 'GET, POST, PATCH, PUT, DELETE, OPTIONS',
  });
  res.end(payload);
}

/** Hash both sides first, so timingSafeEqual never sees mismatched lengths. */
function authorized(req: http.IncomingMessage, url: URL): boolean {
  const header = req.headers.authorization ?? '';
  const supplied = header.startsWith('Bearer ') ? header.slice(7) : (url.searchParams.get('token') ?? '');
  const digest = (value: string): Buffer => crypto.createHash('sha256').update(value).digest();
  if (crypto.timingSafeEqual(digest(supplied), digest(TOKEN))) return true;
  const productRoute = url.pathname.startsWith('/api/reports')
    || url.pathname.startsWith('/api/business-search')
    || url.pathname.startsWith('/api/company-research')
    || url.pathname.startsWith('/api/company-dive')
    || url.pathname.startsWith('/api/contact-research')
    || url.pathname.startsWith('/api/person-research')
    // Ads market research is a /research workspace tool with its own form, so an
    // end user holding only PORTAL_TOKEN has to be able to start one. Its cost
    // profile is the same as business-search: one paced crawl on the mini.
    //
    // NOTE: /api/ads-research is deliberately NOT added here. It is missing from
    // this list today, which means the portal's ads button already requires
    // LAB_TOKEN, and quietly widening an existing route's audience is not this
    // change's business.
    || url.pathname.startsWith('/api/ads-market')
    || url.pathname.startsWith('/api/parallel-contact-research')
    || url.pathname.startsWith('/api/leads')
    || url.pathname.startsWith('/api/ads-leads')
    || url.pathname.startsWith('/api/telemarketers')
    || url.pathname.startsWith('/api/telemarketer')
    || url.pathname.startsWith('/api/tm')
    || url.pathname.startsWith('/api/territories')
    || url.pathname.startsWith('/api/contacts')
    || url.pathname.startsWith('/api/lead-activity');
  return productRoute && PORTAL_TOKEN.length >= 16
    && crypto.timingSafeEqual(digest(supplied), digest(PORTAL_TOKEN));
}

// 1 MB is the right cap for a prompt or a lead. It is the wrong cap for a worker
// handing back a finished crawl: ads research returns its creatives inline, because
// the images live on the mini's disk and there is no blob store between the two.
// Only the result route gets the larger ceiling, and only workers can reach it.
const RESULT_ROUTE = /^\/api\/jobs\/[^/]+\/result(\?|$)/;
const REPAIR_ROUTE = /^\/api\/reports\/[^/]+\/repair(\?|$)/;
const BODY_LIMIT = 1 << 20;
const RESULT_LIMIT = Number(process.env.RESULT_BODY_LIMIT ?? 32 << 20);

async function readJson(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  const cap = RESULT_ROUTE.test(req.url ?? '') || REPAIR_ROUTE.test(req.url ?? '') ? RESULT_LIMIT : BODY_LIMIT;
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > cap) throw new Error(`body too large (over ${Math.round(cap / (1 << 20))}MB)`);
    chunks.push(c as Buffer);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
  } catch {
    throw new Error('body is not valid JSON');
  }
}

const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback);
const num = (v: unknown, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);

const server = http.createServer((req, res) => {
  void handle(req, res).catch((err: unknown) => {
    console.error(`[http ${req.method ?? 'GET'} ${(req.url ?? '/').split('?')[0]}] ${(err as Error).stack ?? String(err)}`);
    json(res, 500, { error: (err as Error).message ?? String(err) });
  });
});

async function handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://' + (req.headers.host ?? 'localhost'));
  const p = url.pathname;
  const method = req.method ?? 'GET';

  // Handle CORS preflight for browser clients
  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'access-control-allow-origin': '*',
      'access-control-allow-headers': 'authorization, content-type, x-telemarketer-uid, x-telemarketer-id, x-agent-uid, x-api-key, accept',
      'access-control-allow-methods': 'GET, POST, PATCH, PUT, DELETE, OPTIONS',
      'access-control-max-age': '86400',
    });
    return void res.end();
  }

  // Railway's healthcheck has no token and must never be given one.
  if (p === '/healthz') return json(res, 200, { ok: true, at: new Date().toISOString() });

  // The shell is public; every byte of data behind it is not. The page prompts for
  // the token and sends it with each call.
  if (method === 'GET' && (p === '/' || p === '/index.html')) {
    const html = page();
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    return void res.end(html);
  }

  // The API reference, served by the deploy it documents so the two cannot drift.
  // Public for the same reason the console is: it describes the surface, and the
  // token is what actually guards it.
  if (method === 'GET' && (p === '/docs' || p === '/docs.html')) {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    return void res.end(docsPage());
  }

  if (method === 'GET' && (p === '/research' || p === '/research/' || p === '/portal')) {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex, nofollow' });
    return void res.end(portalPage('research'));
  }

  if (method === 'GET' && (p === '/telemarketing' || p === '/telemarketing/')) {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex, nofollow' });
    return void res.end(portalPage('telemarketing'));
  }

  if (method === 'GET' && (
    p === '/registrations' || p === '/registrations/' ||
    p === '/ads-leads' || p === '/ads-leads/' ||
    p === '/atap-leads' || p === '/atap-leads/' ||
    p === '/atap-registrations' || p === '/atap-registrations/'
  )) {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex, nofollow' });
    return void res.end(portalPage('registrations'));
  }

  if (method === 'GET' && (p === '/auto-queue' || p === '/auto-queue/')) {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex, nofollow' });
    return void res.end(autoQueuePage.page());
  }

  if (method === 'GET' && (p === '/country-industry' || p === '/country-industry/')) {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex, nofollow' });
    return void res.end(countryIndustryPage());
  }

  if (method === 'GET' && (p === '/search-lists' || p === '/search-lists/')) {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex, nofollow' });
    return void res.end(searchListPage());
  }

  if (method === 'GET' && (p === '/research-leads' || p === '/research-leads/')) {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex, nofollow' });
    return void res.end(researchLeadsPage());
  }

  if (method === 'GET' && (p === '/company-dive' || p === '/company-dive/')) {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex, nofollow' });
    return void res.end(companyDivePage());
  }

  if (method === 'GET' && (p === '/email-marketing' || p === '/email-marketing/')) {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex, nofollow' });
    return void res.end(emailMarketingPage());
  }

  // Dive-deeper's console page; declines (falls through) while DIVE_DEEPER_ENABLED is off.
  if (diveDeeper.handlePage(req, res, url)) return;

  if (method === 'GET' && (p === '/workers' || p === '/workers.html')) {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex, nofollow' });
    return void res.end(workersPage());
  }

  // The end-user guide. Public like the portal shell it explains, and for the same
  // reason: it holds no credential, and it is the page you send someone *before*
  // they have a key. noindex because the workspace it describes is private.
  if (method === 'GET' && (p === '/guide' || p === '/guide.html')) {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex, nofollow' });
    return void res.end(guidePage());
  }

  if (method === 'GET' && p === '/openapi.json') {
    return json(res, 200, openApiDocument);
  }

  // Published reports are deliberately outside the bearer-token gate. Their
  // opaque 20-character id is the share capability, and the page contains only
  // public business evidence. The authenticated API below creates and inspects
  // them; requesters can send the /r/:id link without also leaking LAB_TOKEN.
  if (await intel.handlePublic(req, res, url)) return;
  if (await companyDive.handlePublic(req, res, url)) return;
  if (await diveDeeper.handlePublic(req, res, url)) return;

  // /v1/* is the gateway - the OpenAI-shaped surface other tools point at. It sits
  // behind the same token because a bearer header is exactly what an OpenAI client
  // already sends, so pointing one here costs a base URL and nothing else.
  // A mistyped path answered {"error":"not found"} to a browser, which is both
  // true and a dead end -- there is nothing on that response to click. A caller
  // asking for JSON still gets JSON; a person gets the same fact with the four
  // real pages listed under it.
  if (!p.startsWith('/api/') && !p.startsWith('/v1/')) {
    if (method === 'GET' && (req.headers.accept ?? '').includes('text/html')) {
      res.writeHead(404, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      return void res.end(missingPage(p));
    }
    return json(res, 404, { error: 'not found' });
  }

  // Log from here down, before the auth gate, so a rejected token is recorded too:
  // a 401 nobody can see is how a misconfigured client stays misconfigured. The
  // record closes itself when the response does, whatever route handled it.
  //
  // The worker's own bookkeeping is the exception. Its long-poll is one request
  // every 25s, forever, from a machine that is supposed to be idle most of the
  // time, and its heartbeat is one more every 30s for as long as a job runs —
  // logged, they would be thousands of records a day burying every request
  // anyone actually cares about. Result posts and failures still land in the log.
  const workerChatter = (method === 'GET' && p === '/api/jobs/next')
    || (method === 'POST' && p === '/api/jobs/heartbeat');
  if (!workerChatter) {
    log.begin(req, url);
    res.on('finish', () => log.end(req, res.statusCode));
    res.on('close', () => log.end(req, res.statusCode));
  }

  // Telemarketer API: authenticated by Telemarketer UID directly (no operator key needed), or operator token
  if (!p.startsWith('/api/telemarketers') && (p.startsWith('/api/telemarketer/') || p === '/api/telemarketer' || p.startsWith('/api/tm/') || p === '/api/tm')) {
    if (await intel.handleTelemarketerApi(req, res, url, { json, readJson, isOperator: authorized(req, url) })) return;
  }

  // Smartlead's webhook carries its own key in the URL; it never holds LAB_TOKEN.
  if (await emailMarketing.handleWebhook(req, res, url, { json, readJson })) return;

  // A Gmap Local Worker PC holds a key derived from LAB_TOKEN that reaches its
  // own routes and nothing else: claiming, beating and answering gmap.scan and
  // fetch.pages (gmapWorker.JOB_TYPES), and fetching the sweep words. See
  // gmap-worker.ts.
  if (!authorized(req, url)) {
    const header = req.headers.authorization ?? '';
    if (header.startsWith('Bearer ') && gmapWorker.isWorkerKey(header.slice(7))) {
      if (p.startsWith('/api/gmap-worker/') && await gmapWorker.handle(req, res, url, { json }, 'worker')) return;
      if (gmapWorker.isJobRoute(method, p)
        && await jobs.handle(req, res, url, { json, readJson, scope: { types: gmapWorker.JOB_TYPES } })) return;
      // The step-2 worker on a PC: take a batch of leads, send back each result (list-step2.ts).
      if (p.startsWith('/api/list-step2/worker/') && await listStep2.handleWorker(req, res, url, { json, readJson })) return;
      return json(res, 403, { error: 'the Gmap worker key only reaches the worker routes' });
    }
  }

  if (!authorized(req, url)) {
    // An OpenAI client parses the error envelope and prints its message; a bare
    // {error: string} shows up there as [object Object].
    return p.startsWith('/v1/')
      ? json(res, 401, { error: { message: 'bad or missing token', type: 'invalid_request_error', code: 'invalid_api_key' } })
      : json(res, 401, { error: 'bad or missing token' });
  }

  // ---- the /auto-queue dashboard ------------------------------------------
  if (method === 'GET' && p === '/api/auto-queue/dashboard') {
    if (!reportdb.configured()) return json(res, 503, { error: 'no report database configured' });
    const hours = Math.min(168, Math.max(1, Math.round(Number(url.searchParams.get('hours')) || 24)));
    return json(res, 200, await autoQueuePage.snapshot(hours));
  }

  // ---- business intelligence product API -------------------------------
  if (await intel.handleApi(req, res, url, { json, readJson })) return;

  // ---- the gateway ------------------------------------------------------
  // Before everything else, because this is the surface that has consumers: a
  // route added below must never shadow one that other tools are calling.
  if (await gateway.handle(req, res, url, { json, readJson })) return;

  // ---- the job broker -----------------------------------------------------
  // Work handed to a machine this service cannot reach. The Mac mini long-polls
  // /api/jobs/next from home, runs the job on a residential IP, and posts the
  // result back. See jobs.ts for why the direction is inverted.
  if (p === '/api/jobs' || p.startsWith('/api/jobs/')) {
    if (await jobs.handle(req, res, url, { json, readJson })) return;
  }

  // ---- search lists: a CSV of Maps searches, run to the end by the hub -------
  if (await searchList.handle(req, res, url, { json, readJson })) return;

  // ---- list processing step 2: each found business's best contact method ----
  if (await listStep2.handle(req, res, url, { json, readJson })) return;
  if (await companies.handle(req, res, url, { json })) return;

  // ---- the Gmap Local Worker package, engine and sweep words ---------------
  if (p.startsWith('/api/gmap-worker/') && await gmapWorker.handle(req, res, url, { json }, 'operator')) return;

  // ---- company deep dive (Brave + at most 15 Tavily calls + deepseek) ------
  // /:id/people first: the dive's own handler would answer it 404.
  if (await companyDivePeople.handle(req, res, url, { json })) return;
  if (await companyDive.handle(req, res, url, { json, readJson })) return;

  // ---- dive-deeper (the paid stage after a company-dive; off unless DIVE_DEEPER_ENABLED) ----
  if (await diveDeeper.handle(req, res, url, { json, readJson })) return;

  // ---- website email lane (no LLM; off unless SITE_EMAIL_AUTO or /api/site-emails/start) ----
  if (await siteEmails.handle(req, res, url, { json, readJson })) return;

  // ---- email marketing: lead emails into Smartlead campaigns, replies back --------
  if (await emailReplies.handle(req, res, url, { json, readJson })) return;
  if (await emailMarketing.handle(req, res, url, { json, readJson })) return;

  // ---- contact-form delivery: one lead's message through its website contact form ----
  if (await contactFormDelivery.handle(req, res, url, { json, readJson })) return;

  if (p === '/api/contact-keys' || p === '/api/gemini-contact-keys' || p === '/api/contact-stats' || p === '/api/llm-lanes') {
    if (await contactKeys.handleKeys(req, res, url, { json, readJson })) return;
  }

  // ---- logs ---------------------------------------------------------------
  // One record per request, newest first. ?errors=1 (or /api/logs/errors) is the
  // error log: everything that answered 4xx/5xx or recorded a failure.
  if (method === 'GET' && (p === '/api/logs' || p === '/api/logs/errors')) {
    const q = url.searchParams;
    const asNumber = (v: string | null): number | undefined => (v && Number.isFinite(Number(v)) ? Number(v) : undefined);
    try {
      return json(res, 200, {
        ...log.read({
          limit: asNumber(q.get('limit')),
          errorsOnly: p.endsWith('/errors') || q.get('errors') === '1',
          engine: q.get('engine') ?? undefined,
          status: asNumber(q.get('status')),
          since: q.get('since') ?? undefined,
          date: q.get('date') ?? undefined,
          path: q.get('path') ?? undefined,
        }),
        days: log.days(),
      });
    } catch (err) {
      return json(res, 400, { error: (err as Error).message });
    }
  }

  // ---- state -------------------------------------------------------------
  if (method === 'GET' && p === '/api/status') {
    return json(res, 200, {
      home: HOME,
      pi: pi.status(),
      memory: memory(),
      startedAt: STARTED_AT,
      uptimeSec: Math.round(process.uptime()),
      lastCrash,
      queue: queue.snapshot(),
      logs: log.stats(),
    });
  }

  // ---- research ----------------------------------------------------------
  if (method === 'POST' && p === '/api/exec') {
    const body = await readJson(req);
    const cmd = str(body.cmd).trim();
    if (!cmd) return json(res, 400, { error: 'cmd is required' });
    const timeout = num(body.timeoutMs, 60_000);
    return await new Promise<void>((resolve) => {
      exec(cmd, { timeout, maxBuffer: 8 << 20, cwd: HOME, env: process.env }, (err, stdout, stderr) => {
        json(res, 200, {
          cmd,
          code: err ? ((err as { code?: number | string }).code ?? 1) : 0,
          killed: Boolean((err as { killed?: boolean } | null)?.killed),
          stdout,
          stderr,
        });
        resolve();
      });
    });
  }

  json(res, 404, { error: 'not found', path: p });
}

// A cwd that does not exist makes every exec fail with a bare ENOENT that reads
// like a missing binary. Cheap to rule out at boot rather than debug later.
fs.mkdirSync(HOME, { recursive: true });

// Run outside the container and HOME is a real person's home directory, where
// browser profiles and Pi's working folder would land beside their own files.
// Loud, because it is not obvious until something has already been overwritten.
if (HOME !== '/data') {
  console.warn('WARNING: HOME is ' + HOME + ', not /data.');
  console.warn('This writes to a real home directory. Set HOME=/data unless you mean it.');
}

// Without this a bind failure is an unhandled 'error' event and a stack trace.
// Railway shows the last line of the log when a deploy fails to become healthy,
// so that line should say what went wrong rather than name a file in node:net.
server.on('error', (err: NodeJS.ErrnoException) => {
  console.error('Could not start: ' + err.message);
  process.exit(1);
});

/**
 * Nothing survives a restart mid-run, so say so instead of leaving the report at
 * `running` forever. See reportdb.reapAbandoned -- the restart that stranded
 * these runs is the same restart that gets here.
 */
function reapAbandonedRuns(staleMinutes: number): void {
  if (!reportdb.configured()) return;
  void reportdb.reapAbandoned(staleMinutes, intel.activeReports())
    .then((n) => { if (n) console.log('reaped ' + n + ' abandoned run(s) that no process was still working on'); })
    .catch((err: Error) => console.warn('could not reap abandoned runs: ' + err.message));
}

server.listen(PORT, '0.0.0.0', () => {
  void secrets.refresh();
  void reportdb.requeueInterruptedCloudContactReports()
    .then((count) => { if (count) console.log(`[contact] requeued ${count} interrupted cloud report(s) onto the normal queue`); })
    .catch((error) => console.error('[contact] could not requeue interrupted cloud reports: ' + String(error)));
  console.log('agy-lab listening on :' + PORT);
  console.log('  HOME     ' + HOME);
  console.log('  pi       ' + (pi.config().apiKey ? pi.PROVIDER + '/' + pi.config().model : 'NOT CONFIGURED - add a MiniMax key on /workers'));
  console.log('  reports  ' + (process.env.DATABASE_URL?.trim() ? 'direct Postgres' : reportdb.configured() ? 'pg-proxy fallback (token can expire)' : 'NOT CONFIGURED'));
  // Age 0 at boot: this process owns no run yet, so anything non-terminal was
  // stranded by the restart that just happened.
  reapAbandonedRuns(0);
  void companyDive.failInterrupted()
    .then(() => companyDivePeople.failInterrupted())
    .catch((err: Error) => console.warn('could not close interrupted company dives: ' + err.message));
  void diveDeeper.failInterrupted()
    .catch((err: Error) => console.warn('could not close interrupted dive-deeper runs: ' + err.message))
    .finally(() => diveDeeper.startPreviewWorker());
  // Every lead, so a rule changed in this deploy reaches the ones already saved.
  if (reportdb.configured()) {
    void reportdb.applyLeadBlacklist({ all: true })
      .then((r) => console.log(`[blacklist] checked ${r.checked} leads, ${r.blacklisted} kept out of contact research`))
      .catch((err: Error) => console.warn('[blacklist] could not check leads: ' + err.message));
  }
  autoContact.init({ launch: intel.launchContactResearch });
  autoContact.start();
  autoScan.init({ launch: intel.launchBusinessSearch });
  autoScan.start();
  void siteEmails.start();
  emailMarketing.start();
  // Extract model lanes saved on /workers; until they load, calls use CONTACT_LLM_*.
  void extractLlm.refresh();
  contactWorker.start();
  mapsWorker.start();
  countryResearch.start();
  searchList.start();
  listStep2.start();
  // Broker jobs live only in memory. Refill it from saved contact reports after
  // a restart, with no more concurrent jobs than the research lanes can run.
  setInterval(() => {
    void intel.resumeContactResearch().catch((err: Error) =>
      console.warn('could not resume contact reports: ' + err.message));
  }, 5_000).unref();
  // On the interval an age test IS needed, and a generous one -- a company
  // report can legitimately run for hours behind a busy serial worker lane, and
  // rounds heartbeat published_report.updated_at so a working run stays fresh.
  // unref so this timer never holds the process open.
  setInterval(() => reapAbandonedRuns(180), 15 * 60_000).unref();
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
  });
}
