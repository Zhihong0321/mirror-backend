// Assemble the full report for one company from what is already in out/ on this machine.
//
//   node scripts/dive-deeper/report.ts <diveId> [out.html]
//
// Writes one standalone HTML file (default docs/dive-deeper-report-<brand>.html). Makes no
// network calls. The page itself comes from src/divedeeper/report-html.ts, which the hub uses too.
import fs from 'node:fs';
import path from 'node:path';
import { OUT } from '../../src/divedeeper/lib.ts';
import { buildReport } from '../../src/divedeeper/report-html.ts';
import { STAGE1_LANES } from '../../src/divedeeper/editor.ts';

export const LANES = [...STAGE1_LANES, 'S2-consult', 'S3-editor', 'S4-analysis', 'S5-plan'];

const diveId = process.argv[2];
if (!diveId) { console.error('usage: node scripts/dive-deeper/report.ts <diveId> [out.html]'); process.exit(2); }
const read = (f: string) => { try { return JSON.parse(fs.readFileSync(path.join(OUT, f), 'utf8')); } catch { return null; } };
const dive = read(`dive-${diveId}.json`);
if (!dive) { console.error(`out/dive-${diveId}.json not found; run a lane once to cache the dive`); process.exit(2); }
const lanes = Object.fromEntries(LANES.map((l) => [l, read(`${l}-${diveId}.json`)]));

const name = String(dive.result?.identity?.legal_name ?? dive.company);
const brand = name.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').trim().split(/\s+/)[0] || 'company';
const outFile = process.argv[3] ?? path.join(import.meta.dirname, '..', '..', '..', 'docs', `dive-deeper-report-${brand}.html`);
const html = buildReport(dive, lanes);
fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, html);
const missing = Object.entries(lanes).filter(([, v]) => !v).map(([k]) => k);
console.log(`wrote ${outFile} (${(html.length / 1024).toFixed(0)} KB)${missing.length ? ` — missing: ${missing.join(', ')}` : ''}`);
