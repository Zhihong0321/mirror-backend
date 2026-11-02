import http from 'node:http';
import * as reportdb from '../reportdb.ts';
import { type LaneResult } from './runner.ts';
import { buildReport } from './report-html.ts';
import { buildPreview } from './preview-html.ts';
import { addMeter, emptyUsage, price, type ApiCall } from '../cost.ts';
import { page as browsePage } from '../divedeeper-page.ts';
import { enabled } from './stages.ts';
import { ensureTable, newPublicId, update, diveRow, type Row } from './store.ts';
import { startDive, waiting, active, queue } from './run.ts';
import { previewAuto, offer, editing, writePreviewNotes } from './preview-writer.ts';

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
<body><h1>${esc(row.company)}</h1><p><b>${row.status === 'incomplete' ? 'The report is not complete yet.' : live ? 'The report is being prepared.' : 'This run failed.'}</b> ${row.status === 'incomplete' ? esc(row.error) : live ? 'This page refreshes every 20 seconds.' : esc(row.error)}</p>
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
    const companyUid = (await diveRow(diveId!))?.company_uid ?? null;
    const out = await reportdb.sql<{ id: string }>(
      `insert into dive_deeper (public_id, company, dive_id, company_uid) values ($1, $2, $3, $4) returning id`, [publicId, name, diveId, companyUid]);
    const id = Number(out.rows[0].id);
    queue(id);
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

  // Retry: an incomplete run resumes with the lanes it has; a failed one starts over, reusing its
  // company-dive when that finished, else starting a new one.
  const retry = p.match(/^\/api\/dive-deeper\/(\d+)\/retry$/);
  if (retry && method === 'POST') {
    const id = Number(retry[1]);
    const row = (await reportdb.sql<Row>(`select id, company, dive_id, status from dive_deeper where id = $1`, [id])).rows[0];
    if (!row) { ctx.json(res, 404, { error: 'no such run' }); return true; }
    if (row.status === 'incomplete') {
      await update(id, { status: 'queued', stage: '', retry_at: null });
      queue(id);
      ctx.json(res, 202, { id, status: 'queued', resumes_from_saved_lanes: true });
      return true;
    }
    if (row.status !== 'failed') { ctx.json(res, 409, { error: `run is ${row.status}, not failed or incomplete` }); return true; }
    let diveId = row.dive_id;
    const d = diveId ? await diveRow(diveId) : null;
    if (!d || d.status === 'failed') {
      const started = await startDive(row.company);
      if ('error' in started) { ctx.json(res, 502, { error: started.error }); return true; }
      diveId = started.id;
    }
    await update(id, { status: 'queued', stage: '', error: null, dive_id: diveId, lanes: {}, report_html: null, finished_at: null, log: [], resumes: 0, retry_at: null });
    queue(id);
    ctx.json(res, 202, { id, status: 'queued', dive_id: diveId });
    return true;
  }

  ctx.json(res, 404, { error: 'not found', path: p });
  return true;
}
