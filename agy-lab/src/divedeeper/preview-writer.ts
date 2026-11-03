import * as reportdb from '../reportdb.ts';
import { switchOn } from '../switches.ts';
import { runWithReport } from '../evidence/context.ts';
import { settle, watchRun } from '../evidence/store.ts';
import { makeCtx } from './lib.ts';
import { type Offer } from './preview-html.ts';
import { editPreview } from './preview-editor.ts';
import * as companyDive from '../companydive.ts';
import { enabled } from './stages.ts';
import { ensureTable } from './store.ts';

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
      const dive = (await reportdb.sql(`select c.id, c.public_id, c.company, c.status, c.options, c.result, c.dossier, c.finished_at from company_dive c
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

/** What the preview's order page shows; set on the hub, all optional. */
export const offer = (): Offer => ({ price: process.env.DD_PREVIEW_PRICE, contact: process.env.DD_PREVIEW_CONTACT, order_url: process.env.DD_PREVIEW_ORDER_URL });

/** Company-dives whose preview notes are being written in this process right now. */
export const editing = new Set<number>();

/** The preview write as it was before evidence: one try, then drop the editing flag. Never throws. */
async function writePreviewPlain(dive: any): Promise<void> {
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

/** Same write, under the report context, settling before the preview row is saved. */
async function writePreviewOn(dive: any, uid: string): Promise<void> {
  editing.add(Number(dive.id));
  try {
    const ctx = makeCtx(String(dive.id), 'P', 'preview');
    const notes = await editPreview(dive, (p) => ctx.llm(p), ctx.parseJson, ctx.warn);
    await settle(uid, 10_000);
    await reportdb.sql(`insert into dive_preview (dive_id, notes, meter) values ($1, $2::jsonb, $3::jsonb) on conflict (dive_id) do update set notes = excluded.notes, meter = excluded.meter, created_at = now()`,
      [dive.id, JSON.stringify(notes ?? {}), JSON.stringify(ctx.meter)]);
  } catch (err) {
    console.error(`[dive-preview ${dive.id}] notes failed`, err);
  } finally {
    editing.delete(Number(dive.id));
  }
}

/** Writes the preview's notes once and keeps them; a failed pass is kept as {} so the page falls back. Never throws. */
export async function writePreviewNotes(dive: any): Promise<void> {
  const evidenceOn = switchOn(dive.options, 'evidence') && Boolean(dive.public_id);
  if (!evidenceOn) return writePreviewPlain(dive);
  const uid = String(dive.public_id);
  // This process may not have run the company dive, so arm evidence_fail here before the preview runs.
  watchRun(uid, switchOn(dive.options, 'evidence_fail'));
  try {
    await runWithReport({
      reportUid: uid, parentReportUid: null, kind: 'preview', step: 'P-preview', weight: 1, on: true,
    }, () => writePreviewOn(dive, uid));
  } finally {
    await settle(uid, 10_000);
  }
}
