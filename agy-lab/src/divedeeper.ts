// Dive-deeper: the paid stage after a company-dive (docs/dive-deeper-plan.md, step 5).
//
// This is the malaysia-deeper-dive pipeline (docs/country-deeper-dive-plan.md): Malaysian
// registers, regulators, courts and phone formats. One run per company: the company-dive first
// (started through its own public API, never touched), then stage 1, whose lanes feed the report's
// six research parts (contact and reachability; how the internet understands the brand; reviews,
// discussion and news; credibility and official records; digital assets; website speed and quality
// from Google PageSpeed Insights), stage 2 (the ready-to-use drafts), stage 3 (the editor's plain
// titles and screenshots), stage 4 (one full analysis across all six parts) and stage 5 (the action
// plan, one task list per department), then one report stored in the dive_deeper table and served at /dd/<public id>.
//
// Isolation from company-dive (plan §2): own files, own table, own queue (one run at a time,
// never in company-dive's queue), read-only on company_dive (plain selects). Everything here
// is off unless DIVE_DEEPER_ENABLED is set: with it off, every handler declines and the hub
// behaves exactly as before.
//
// No kill gates: no timeouts or token caps; a lane that fails comes back partial and the run
// still finishes with a report.
import http from 'node:http';
import crypto from 'node:crypto';
import * as reportdb from './reportdb.ts';
import { makeCtx } from './divedeeper/lib.ts';
import { runLane, stageDive, type LaneResult } from './divedeeper/runner.ts';
import { buildReport } from './divedeeper/report-html.ts';
import { buildPreview, type Offer } from './divedeeper/preview-html.ts';
import { editPreview } from './divedeeper/preview-editor.ts';
import { addMeter, emptyUsage, price, type ApiCall } from './cost.ts';
import { page as browsePage } from './divedeeper-page.ts';
import * as companyDive from './companydive.ts';

export const enabled = (env: NodeJS.ProcessEnv = process.env): boolean => /^(1|true|on|yes)$/i.test(String(env.DIVE_DEEPER_ENABLED ?? '').trim());

// Section G on the hub asks deepseek only (the gpt router key has no credit; decided 2026-10-26).
process.env.DD_G_MODELS ??= 'deepseek-v4.1-flash-1017';
process.env.DD_G_JUDGE ??= 'deepseek-v4.1-flash-1017';

/** The order lanes run in. E-maps reuses H-maps' listings and C-merged its Maps phones, so both wait for H-maps.
 *  The last three read what the others found: R-contacts (C-merged's and H-maps' contacts), A-assets
 *  (C-merged's domains and email addresses), B-brand (C-merged's pages, H-web's results, G-fixed's answers). S2 reads everything. */
export const STAGE1_FIRST = [['H', 'maps'], ['H', 'web'], ['D', 'registry'], ['G', 'fixed'], ['G', 'grounded'], ['K', 'credibility'], ['N', 'news'], ['W', 'speed']] as const;
export const STAGE1_AFTER_H = [['E', 'maps'], ['C', 'merged']] as const;
export const STAGE1_LAST = [['R', 'contacts'], ['A', 'assets'], ['B', 'brand']] as const;
export const STAGE2 = ['S2', 'consult'] as const;
/** The editor reads everything, S2 included, and writes the report's plain titles and screenshots. */
export const STAGE3 = ['S3', 'editor'] as const;
/** One full analysis, read across every part. */
export const STAGE4 = ['S4', 'analysis'] as const;
/** The action plan: every urgent and needs-work finding as a task for the department that does it. */
export const STAGE5 = ['S5', 'plan'] as const;

type Row = {
  id: number; public_id: string; company: string; dive_id: number | null;
  status: string; stage: string; log: Array<{ at: string; stage: string; msg: string }>;
  lanes: Record<string, LaneResult>; report_html: string | null; error: string | null;
  created_at: string; finished_at: string | null;
};

let tableReady: Promise<unknown> | null = null;
function ensureTable(): Promise<unknown> {
  tableReady ??= reportdb.sql(`
    create table if not exists dive_deeper (
      id bigserial primary key,
      public_id text not null unique,
      company text not null,
      dive_id bigint,
      status text not null default 'queued',
      stage text not null default '',
      log jsonb not null default '[]',
      lanes jsonb not null default '{}',
      report_html text,
      error text,
      created_at timestamptz not null default now(),
      finished_at timestamptz
    );
    create index if not exists dive_deeper_created_idx on dive_deeper (created_at desc);
    create table if not exists dive_preview (
      dive_id bigint primary key,
      notes jsonb not null default '{}',
      created_at timestamptz not null default now()
    );
    -- What writing the preview used (one LLM pass), for its cost.
    alter table dive_preview add column if not exists meter jsonb;
  `).catch((err) => { tableReady = null; throw err; });
  return tableReady;
}

const newPublicId = () => crypto.randomBytes(15).toString('base64url');

async function update(id: number, fields: Partial<Omit<Row, 'id' | 'created_at'>>): Promise<void> {
  const keys = Object.keys(fields);
  if (!keys.length) return;
  const json = new Set(['log', 'lanes']);
  const sets = keys.map((k, i) => `${k} = $${i + 2}${json.has(k) ? '::jsonb' : ''}`).join(', ');
  const values = keys.map((k) => (json.has(k) ? JSON.stringify((fields as any)[k]) : (fields as any)[k]));
  await reportdb.sql(`update dive_deeper set ${sets} where id = $1`, [id, ...values]);
}

// ---------------------------------------------------------------- keys and the dive

// Keys and LLM lanes are not picked here: every lane calls the app's core
// (core/README.md), which uses the hub's lanes on /workers and its key pools.

async function diveRow(diveId: number): Promise<any | null> {
  return (await reportdb.sql(`select * from company_dive where id = $1`, [diveId])).rows[0] ?? null;
}

/** Starts a company-dive through the hub's own public API, exactly as any caller would. */
async function startDive(company: string): Promise<{ id: number } | { error: string }> {
  const port = Number(process.env.PORT ?? 8080);
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/company-dive`, {
      method: 'POST',
      headers: { authorization: 'Bearer ' + (process.env.LAB_TOKEN ?? ''), 'content-type': 'application/json' },
      body: JSON.stringify({ company, country: 'Malaysia' }),
    });
    const body = await res.json() as any;
    return res.ok && body.id ? { id: Number(body.id) } : { error: body.error ?? `company-dive answered HTTP ${res.status}` };
  } catch (e) {
    return { error: `could not start the company-dive: ${(e as Error).message}` };
  }
}

// ---------------------------------------------------------------- the run

const waiting: number[] = [];
let active = false;
const DIVE_POLL_MS = 20_000;

async function execute(id: number): Promise<void> {
  const row = (await reportdb.sql<Row>(`select * from dive_deeper where id = $1`, [id])).rows[0];
  if (!row) return;
  const log = row.log ?? [];
  const say = async (stage: string, msg: string, extra: Partial<Row> = {}) => {
    log.push({ at: new Date().toISOString(), stage, msg });
    console.log(`[dive-deeper ${id}] ${stage}: ${msg}`);
    await update(id, { stage, log, ...extra }).catch((err) => console.error(`[dive-deeper ${id}] log write failed`, err));
  };
  try {
    if (!row.dive_id) throw new Error('no company-dive linked to this run');

    // 1. Wait for the company-dive (it runs in its own queue, one at a time).
    let dive = await diveRow(row.dive_id);
    if (dive && !['done', 'partial', 'failed'].includes(dive.status)) {
      await say('waiting_dive', `Waiting for company-dive #${row.dive_id} to finish`, { status: 'waiting_dive' });
      while (dive && !['done', 'partial', 'failed'].includes(dive.status)) {
        await new Promise((r) => setTimeout(r, DIVE_POLL_MS));
        dive = await diveRow(row.dive_id);
      }
    }
    if (!dive) throw new Error(`company-dive #${row.dive_id} not found`);
    if (dive.status === 'failed' || !dive.result) throw new Error(`company-dive #${row.dive_id} ${dive.status}: ${dive.error ?? 'no research saved'}`);

    // 2. Stage 1, then stage 2. Each lane's result is saved as soon as it lands.
    const diveKey = String(row.dive_id);
    stageDive(diveKey, dive);
    const lanes: Record<string, LaneResult> = {};
    await say('stage1', `Company-dive #${row.dive_id} is ${dive.status}; running stage 1`, { status: 'running', lanes });
    const one = async (section: string, lane: string) => {
      const r = await runLane(section, lane, diveKey, dive);
      lanes[`${section}-${lane}`] = r;
      await say('stage1', `${section}-${lane}: ${r.findings_count} findings${r.warnings.length ? `, ${r.warnings.length} warnings` : ''}`, { lanes });
    };
    const hMaps = one('H', 'maps');
    await Promise.all([
      hMaps,
      ...STAGE1_FIRST.filter(([s, l]) => !(s === 'H' && l === 'maps')).map(([s, l]) => one(s, l)),
      hMaps.then(() => Promise.all(STAGE1_AFTER_H.map(([s, l]) => one(s, l)))),
    ]);
    await Promise.all(STAGE1_LAST.map(([s, l]) => one(s, l)));
    await say('stage2', 'Writing the consultation');
    const s2 = await runLane(STAGE2[0], STAGE2[1], diveKey, dive);
    lanes['S2-consult'] = s2;
    await say('stage3', 'Editing the report and taking screenshots');
    lanes['S3-editor'] = await runLane(STAGE3[0], STAGE3[1], diveKey, dive);
    await say('stage4', 'Writing the full analysis');
    lanes['S4-analysis'] = await runLane(STAGE4[0], STAGE4[1], diveKey, dive);
    await say('stage5', 'Compiling the action plan');
    lanes['S5-plan'] = await runLane(STAGE5[0], STAGE5[1], diveKey, dive);

    // 3. The report.
    const html = buildReport(dive, lanes);
    const partial = Object.values(lanes).some((l) => l.status === 'partial');
    await say('done', `Report ready${partial ? ' (some sections partial)' : ''}`, {
      status: partial ? 'partial' : 'done', lanes, report_html: html, finished_at: new Date().toISOString(),
    });
  } catch (err) {
    console.error(`[dive-deeper ${id}] failed`, err);
    log.push({ at: new Date().toISOString(), stage: 'failed', msg: (err as Error).message });
    await update(id, { status: 'failed', stage: 'failed', error: (err as Error).message, log, finished_at: new Date().toISOString() });
  }
}

function pump(): void {
  if (active || !waiting.length) return;
  active = true;
  const id = waiting.shift()!;
  execute(id).finally(() => { active = false; pump(); });
}

/** Runs live only in this process, so one cut off by a restart is marked failed; Retry starts it again. */
export async function failInterrupted(): Promise<void> {
  if (!enabled() || !reportdb.configured()) return;
  await ensureTable();
  await reportdb.sql(`update dive_deeper set status = 'failed', stage = 'failed', error = 'interrupted by a restart', finished_at = now()
                       where status in ('queued', 'waiting_dive', 'running')`);
}

// ---------------------------------------------------------------- previews, written on their own

/** On unless DD_PREVIEW_AUTO says off: every finished company-dive gets its preview written, nobody has to open it first. */
export const previewAuto = (env: NodeJS.ProcessEnv = process.env): boolean => !/^(0|false|off|no)$/i.test(String(env.DD_PREVIEW_AUTO ?? '').trim());
const PREVIEW_SWEEP_MS = 120_000;
/** Previews written at once, as many as the company-dives that run at once. */
const PREVIEW_WRITERS = 3;
let writers = 0;

/** Starts the writers that are missing; each takes finished company-dives without a preview, newest first. Never throws. */
function previewSweep(): void {
  if (!enabled() || !previewAuto() || !reportdb.configured()) return;
  while (writers < PREVIEW_WRITERS) {
    writers++;
    void previewWriter().finally(() => { writers--; });
  }
}

async function previewWriter(): Promise<void> {
  try {
    await ensureTable();
    for (;;) {
      const dive = (await reportdb.sql(`select c.id, c.public_id, c.company, c.status, c.result, c.dossier, c.finished_at from company_dive c
                                          left join dive_preview p on p.dive_id = c.id
                                         where p.dive_id is null and c.status in ('done', 'partial') and c.result is not null
                                           and not (c.id = any($1::bigint[]))
                                         order by c.finished_at desc nulls last limit 1`, [[...editing]])).rows[0] as any;
      if (!dive) break;
      // Another writer took it between the query and here; the next query skips it.
      if (editing.has(Number(dive.id))) continue;
      console.log(`[dive-preview ${dive.id}] writing the preview for ${dive.company}`);
      await writePreviewNotes(dive);
      // A failed write leaves no row; stop this writer so the next sweep retries instead of looping.
      const saved = (await reportdb.sql(`select 1 from dive_preview where dive_id = $1`, [dive.id])).rows[0];
      if (!saved) break;
    }
  } catch (err) {
    console.warn(`[dive-preview] sweep failed: ${(err as Error).message}`);
  }
}

/** Starts the preview writer: a sweep now, one the moment each company-dive's research is saved, and one every two minutes. */
export function startPreviewWorker(): void {
  if (!enabled() || !reportdb.configured()) return;
  previewSweep();
  companyDive.onFinished(() => previewSweep());
  setInterval(() => previewSweep(), PREVIEW_SWEEP_MS).unref();
}

// ---------------------------------------------------------------- HTTP

type Ctx = {
  json: (res: http.ServerResponse, status: number, body: unknown) => void;
  readJson: (req: http.IncomingMessage) => Promise<Record<string, unknown>>;
};

function links(req: http.IncomingMessage, publicId: string, divePublicId?: string | null): Record<string, string> {
  const proto = String(req.headers['x-forwarded-proto'] ?? 'https').split(',')[0];
  const base = `${proto}://${req.headers['x-forwarded-host'] ?? req.headers.host}`;
  return { report_url: `${base}/dd/${publicId}`, ...(divePublicId ? { dive_report_url: `${base}/d/${divePublicId}`, preview_url: `${base}/dp/${divePublicId}` } : {}) };
}

/** What the preview's order page shows; set on the hub, all optional. */
const offer = (): Offer => ({ price: process.env.DD_PREVIEW_PRICE, contact: process.env.DD_PREVIEW_CONTACT, order_url: process.env.DD_PREVIEW_ORDER_URL });

/** Company-dives whose preview notes are being written in this process right now. */
const editing = new Set<number>();

/** Writes the preview's notes once and keeps them; a failed pass is kept as {} so the page falls back. Never throws. */
async function writePreviewNotes(dive: any): Promise<void> {
  editing.add(Number(dive.id));
  try {
    const ctx = makeCtx(String(dive.id), 'P', 'preview');
    const notes = await editPreview(dive, (p) => ctx.llm(p), ctx.parseJson, ctx.warn);
    await reportdb.sql(`insert into dive_preview (dive_id, notes, meter) values ($1, $2::jsonb, $3::jsonb) on conflict (dive_id) do update set notes = excluded.notes, meter = excluded.meter, created_at = now()`,
      [dive.id, JSON.stringify(notes ?? {}), JSON.stringify(ctx.meter)]);
  } catch (err) {
    console.error(`[dive-preview ${dive.id}] notes failed`, err);
  } finally {
    editing.delete(Number(dive.id));
  }
}

/** /dp/<company-dive public id>: the free preview, built from the company-dive alone, before anything is paid for.
 *  The first open writes its notes (one LLM pass, about a minute) behind a page that refreshes itself. */
async function handlePreview(res: http.ServerResponse, publicId: string): Promise<void> {
  const dive = (await reportdb.sql(`select id, public_id, company, status, stage, result, dossier, finished_at from company_dive where public_id = $1`, [publicId])).rows[0] as any;
  const headers = { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex, nofollow' };
  if (!dive) { res.writeHead(404, headers); res.end('<!doctype html><title>Not found</title><p>No such preview.</p>'); return; }
  const ready = dive.result && ['done', 'partial'].includes(dive.status);
  if (ready) {
    const saved = (await reportdb.sql(`select notes from dive_preview where dive_id = $1`, [dive.id])).rows[0] as any;
    if (saved) { res.writeHead(200, headers); res.end(buildPreview(dive, offer(), saved.notes?.warnings ? saved.notes : null)); return; }
    if (!editing.has(Number(dive.id))) void writePreviewNotes(dive);
  }
  const live = dive.status !== 'failed';
  res.writeHead(200, headers);
  res.end(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">${live ? `<meta http-equiv="refresh" content="${ready ? 10 : 20}">` : ''}
<title>${esc(dive.company)} preview</title><style>body{font-family:system-ui,sans-serif;max-width:720px;margin:40px auto;padding:0 16px;line-height:1.5;color:#111418}</style></head>
<body><h1>${esc(dive.company)}</h1><p>${!live ? 'The research for this preview did not finish.' : ready ? 'Your preview is being written. This takes about a minute, and this page refreshes itself.' : 'Your preview is being prepared. This page refreshes every 20 seconds.'}</p>${ready ? '' : `<p style="color:#5c636d">${esc(dive.stage ?? dive.status)}</p>`}</body></html>`);
}

/** The console page at /dive-deeper (a shell; its data comes from the token-guarded API). */
export function handlePage(req: http.IncomingMessage, res: http.ServerResponse, url: URL): boolean {
  if (!enabled() || req.method !== 'GET' || (url.pathname !== '/dive-deeper' && url.pathname !== '/dive-deeper/')) return false;
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex, nofollow' });
  res.end(browsePage());
  return true;
}

const esc = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** /dd/<public id>: the report, or its live progress until it is ready. The opaque id is the share capability, like /d/. */
export async function handlePublic(req: http.IncomingMessage, res: http.ServerResponse, url: URL): Promise<boolean> {
  const pv = url.pathname.match(/^\/dp\/([A-Za-z0-9_-]{16,40})\/?$/);
  if (pv && enabled() && req.method === 'GET' && reportdb.configured()) { await ensureTable(); await handlePreview(res, pv[1]); return true; }
  const m = url.pathname.match(/^\/dd\/([A-Za-z0-9_-]{16,40})\/?$/);
  if (!enabled() || !m || req.method !== 'GET' || !reportdb.configured()) return false;
  await ensureTable();
  const row = (await reportdb.sql<Row>(`select id, public_id, company, dive_id, status, stage, log, report_html, error, created_at, finished_at from dive_deeper where public_id = $1`, [m[1]])).rows[0];
  const headers = { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex, nofollow' };
  if (!row) { res.writeHead(404, headers); res.end('<!doctype html><title>Not found</title><p>No such report.</p>'); return true; }
  if (row.report_html) {
    // Drawn again from the stored results on each visit, so report and privacy fixes reach reports
    // already delivered; the page saved when the run finished is the fallback.
    let html = row.report_html;
    try {
      const full = (await reportdb.sql<{ lanes: Record<string, LaneResult> }>(`select lanes from dive_deeper where id = $1`, [row.id])).rows[0];
      const dive = row.dive_id ? await diveRow(row.dive_id) : null;
      if (full?.lanes && dive?.result) html = buildReport(dive, full.lanes);
    } catch (err) {
      console.warn(`[dive-deeper ${row.id}] report redraw failed, serving the saved page: ${(err as Error).message}`);
    }
    res.writeHead(200, headers); res.end(html); return true;
  }
  const live = !['failed'].includes(row.status);
  res.writeHead(200, headers);
  res.end(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">${live ? '<meta http-equiv="refresh" content="20">' : ''}
<title>${esc(row.company)} report</title><style>body{font-family:system-ui,sans-serif;max-width:720px;margin:40px auto;padding:0 16px;line-height:1.5;color:#15201b;background:#f5f7f4}li{margin:4px 0}.s{color:#56635c;font-size:14px}</style></head>
<body><h1>${esc(row.company)}</h1><p><b>${live ? 'The report is being prepared.' : 'This run failed.'}</b> ${live ? 'This page refreshes every 20 seconds.' : esc(row.error)}</p>
<p class="s">Status: ${esc(row.status)} · ${esc(row.stage)}</p><ul>${(row.log ?? []).slice(-15).reverse().map((l) => `<li><span class="s">${esc(new Date(l.at).toLocaleTimeString('en-GB'))}</span> ${esc(l.msg)}</li>`).join('')}</ul></body></html>`);
  return true;
}

/** /api/dive-deeper routes, behind the operator token. Returns false for any other path or when switched off. */
export async function handle(req: http.IncomingMessage, res: http.ServerResponse, url: URL, ctx: Ctx): Promise<boolean> {
  const p = url.pathname;
  if (p !== '/api/dive-deeper' && !p.startsWith('/api/dive-deeper/')) return false;
  if (!enabled()) return false;
  if (!reportdb.configured()) { ctx.json(res, 503, { error: 'no report database configured' }); return true; }
  await ensureTable();
  const method = req.method ?? 'GET';

  // The whole pipeline per company: its company-dive, its preview, and its full report if ordered.
  if (p === '/api/dive-deeper/pipeline' && method === 'GET') {
    const out = await reportdb.sql(`
      select c.id as dive_id, c.public_id as dive_public_id, c.company, c.status as dive_status, c.finished_at as dive_finished_at,
             p.created_at as preview_written_at, (p.notes ? 'warnings') as preview_edited, p.meter as preview_meter,
             d.id as run_id, d.public_id as run_public_id, d.status as run_status, d.finished_at as run_finished_at, d.meters as run_meters
        from company_dive c
        left join dive_preview p on p.dive_id = c.id
        left join lateral (select id, public_id, status, finished_at, (select jsonb_agg(v->'meter') from jsonb_each(lanes) e(k, v)) as meters
                             from dive_deeper where dive_id = c.id order by id desc limit 1) d on true
       order by c.id desc limit 200`);
    const proto = String(req.headers['x-forwarded-proto'] ?? 'https').split(',')[0];
    const base = `${proto}://${req.headers['x-forwarded-host'] ?? req.headers.host}`;
    ctx.json(res, 200, {
      auto_preview: previewAuto(),
      companies: out.rows.map((r: any) => ({
        dive_id: Number(r.dive_id), company: r.company, dive_status: r.dive_status, dive_finished_at: r.dive_finished_at,
        preview: r.preview_written_at ? (r.preview_edited ? 'ready' : 'ready, fallback wording') : editing.has(Number(r.dive_id)) ? 'writing' : ['done', 'partial'].includes(r.dive_status) ? 'waiting' : 'no dive yet',
        preview_url: r.dive_public_id ? `${base}/dp/${r.dive_public_id}` : null,
        // Previews written before 2026-10-30 kept no meter, so their cost is unknown (null).
        preview_cost: r.preview_meter ? price(addMeter(emptyUsage(), r.preview_meter)) : null,
        report: r.run_id ? {
          run_id: Number(r.run_id), status: r.run_status, finished_at: r.run_finished_at, report_url: `${base}/dd/${r.run_public_id}`,
          cost: price((r.run_meters ?? []).reduce((u: ReturnType<typeof emptyUsage>, m: any) => addMeter(u, m), emptyUsage())),
        } : null,
      })),
    });
    return true;
  }

  if (p === '/api/dive-deeper' && method === 'GET') {
    const out = await reportdb.sql(`
      select d.id, d.public_id, d.company, d.dive_id, d.status, d.stage, d.error, d.created_at, d.finished_at,
             c.public_id as dive_public_id, c.status as dive_status
        from dive_deeper d left join company_dive c on c.id = d.dive_id
       order by d.id desc limit 200`);
    ctx.json(res, 200, { runs: out.rows.map((r: any) => ({ ...r, ...links(req, r.public_id, r.dive_public_id) })), active: active ? 1 : 0, queued: waiting.length });
    return true;
  }

  // Start a run: {company} starts a fresh company-dive first; {dive_id} reuses a finished one.
  if (p === '/api/dive-deeper' && method === 'POST') {
    const body = await ctx.readJson(req);
    const company = String(body.company ?? '').trim();
    let diveId = Number(body.dive_id ?? 0) || null;
    let name = company;
    if (diveId) {
      const d = await diveRow(diveId);
      if (!d) { ctx.json(res, 404, { error: `no company-dive #${diveId}` }); return true; }
      name = d.company;
    } else {
      if (company.length < 2 || company.length > 200) { ctx.json(res, 400, { error: 'company is required' }); return true; }
      const started = await startDive(company);
      if ('error' in started) { ctx.json(res, 502, { error: started.error }); return true; }
      diveId = started.id;
    }
    const publicId = newPublicId();
    const out = await reportdb.sql<{ id: string }>(
      `insert into dive_deeper (public_id, company, dive_id) values ($1, $2, $3) returning id`, [publicId, name, diveId]);
    const id = Number(out.rows[0].id);
    waiting.push(id);
    pump();
    ctx.json(res, 202, { id, public_id: publicId, company: name, dive_id: diveId, status: 'queued', queued_behind_another: waiting.includes(id), ...links(req, publicId) });
    return true;
  }

  const one = p.match(/^\/api\/dive-deeper\/(\d+)$/);
  if (one && method === 'GET') {
    const row = (await reportdb.sql<Row>(`select id, public_id, company, dive_id, status, stage, log, lanes, error, created_at, finished_at from dive_deeper where id = $1`, [Number(one[1])])).rows[0];
    if (!row) { ctx.json(res, 404, { error: 'no such run' }); return true; }
    const lanes = Object.fromEntries(Object.entries(row.lanes ?? {}).map(([k, v]) => [k, { status: v.status, findings: v.findings_count, warnings: v.warnings?.length ?? 0, first_warnings: (v.warnings ?? []).slice(0, 3).map((w) => w.slice(0, 240)), ms: v.ms, meter: v.meter && { ...(v.meter as object), calls: undefined } }]));
    const cost = price(Object.values(row.lanes ?? {}).reduce((u, v) => addMeter(u, v.meter as any), emptyUsage()));
    // Every lane's calls in one list, oldest first; runs before 2026-10-31 kept only totals, so theirs is empty.
    const calls = Object.entries(row.lanes ?? {}).flatMap(([lane, v]) => ((v.meter as { calls?: ApiCall[] } | undefined)?.calls ?? []).map((c) => ({ ...c, lane })))
      .sort((a, b) => a.at.localeCompare(b.at));
    ctx.json(res, 200, { ...row, lanes, cost, calls, ...links(req, row.public_id) });
    return true;
  }

  // Retry a failed run: reuses its company-dive when that finished, else starts a new one.
  const retry = p.match(/^\/api\/dive-deeper\/(\d+)\/retry$/);
  if (retry && method === 'POST') {
    const id = Number(retry[1]);
    const row = (await reportdb.sql<Row>(`select id, company, dive_id, status from dive_deeper where id = $1`, [id])).rows[0];
    if (!row) { ctx.json(res, 404, { error: 'no such run' }); return true; }
    if (row.status !== 'failed') { ctx.json(res, 409, { error: `run is ${row.status}, not failed` }); return true; }
    let diveId = row.dive_id;
    const d = diveId ? await diveRow(diveId) : null;
    if (!d || d.status === 'failed') {
      const started = await startDive(row.company);
      if ('error' in started) { ctx.json(res, 502, { error: started.error }); return true; }
      diveId = started.id;
    }
    await update(id, { status: 'queued', stage: '', error: null, dive_id: diveId, lanes: {}, report_html: null, finished_at: null, log: [] });
    waiting.push(id);
    pump();
    ctx.json(res, 202, { id, status: 'queued', dive_id: diveId });
    return true;
  }

  ctx.json(res, 404, { error: 'not found', path: p });
  return true;
}
