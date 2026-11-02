// Build the free preview for one company from its company-dive alone.
//
//   node scripts/dive-deeper/preview.ts <diveId> [out.html] [--fresh]
//
// One LLM pass writes the preview's hook, what we know and the warning signs (preview-editor.ts);
// it is cached in out/preview-<diveId>.json and reused unless --fresh. Writes one standalone HTML
// file (default docs/dive-preview-<brand>.html). The hub serves the same page at /dp/<public id>.
import fs from 'node:fs';
import path from 'node:path';
import { OUT, makeCtx } from '../../src/divedeeper/lib.ts';
import { editPreview } from '../../src/divedeeper/preview-editor.ts';
import { buildPreview } from '../../src/divedeeper/preview-html.ts';

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const fresh = process.argv.includes('--fresh');
const diveId = args[0];
if (!diveId) { console.error('usage: node scripts/dive-deeper/preview.ts <diveId> [out.html] [--fresh]'); process.exit(2); }
const read = (f: string) => { try { return JSON.parse(fs.readFileSync(path.join(OUT, f), 'utf8')); } catch { return null; } };
const dive = read(`dive-${diveId}.json`);
if (!dive) { console.error(`out/dive-${diveId}.json not found; run a lane once to cache the dive`); process.exit(2); }

let notes = fresh ? null : read(`preview-${diveId}.json`);
if (!notes) {
  const ctx = makeCtx(diveId, 'P', 'preview');
  notes = await editPreview(dive, (p) => ctx.llm(p), ctx.parseJson, ctx.warn);
  if (notes) fs.writeFileSync(path.join(OUT, `preview-${diveId}.json`), JSON.stringify(notes, null, 2));
  console.log(notes ? `preview notes: ${notes.known?.length ?? 0} known, ${notes.warnings?.length ?? 0} warnings` : 'preview notes failed; the page uses the dive\'s own contradictions and gaps');
}

const name = String(dive.result?.identity?.legal_name ?? dive.company);
const brand = name.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').trim().split(/\s+/)[0] || 'company';
const outFile = args[1] ?? path.join(import.meta.dirname, '..', '..', '..', 'docs', `dive-preview-${brand}.html`);
const html = buildPreview(dive, { price: process.env.DD_PREVIEW_PRICE, contact: process.env.DD_PREVIEW_CONTACT, order_url: process.env.DD_PREVIEW_ORDER_URL }, notes);
fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, html);
console.log(`wrote ${outFile} (${(html.length / 1024).toFixed(0)} KB)`);
