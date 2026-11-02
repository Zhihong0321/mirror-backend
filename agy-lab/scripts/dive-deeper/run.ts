// Run one dive-deeper section lane on one finished company-dive, from this machine.
//
//   node scripts/dive-deeper/run.ts <section> <lane> <diveId>
//   node scripts/dive-deeper/run.ts H maps 4
//
// The lanes live in src/divedeeper/sections (the hub runs the same code). Output goes to
// out/<section>-<lane>-<diveId>.json with the findings, the meter (requests, LLM
// chars/tokens, time) and every warning. Nothing is sent to the hub.
import path from 'node:path';
import { OUT, loadDive } from '../../src/divedeeper/lib.ts';
import { runLane } from '../../src/divedeeper/runner.ts';

const [section, lane, diveId] = process.argv.slice(2);
if (!section || !lane || !diveId) {
  console.error('usage: node scripts/dive-deeper/run.ts <section> <lane> <diveId>');
  process.exit(2);
}

const dive = await loadDive(diveId, process.argv.includes('--fresh'));
console.log(`=== ${section}/${lane} on dive ${diveId} (${dive.company})`);
const r = await runLane(section, lane, diveId, dive);
const m = r.meter as any;
console.log(`\n${r.findings.length} findings in ${(r.ms / 1000).toFixed(1)}s | llm ${m.llm.calls} (${m.llm.tokensIn}/${m.llm.tokensOut} tok) | maps ${m.maps.calls} | exa ${m.exa.calls} | brave ${m.brave.calls} | http ${m.http.calls} | warnings ${r.warnings.length}`);
r.findings.forEach((f, i) => console.log(`${String(i + 1).padStart(2)}. [${f.severity}] ${f.title}\n    ${f.detail}${f.source ? `\n    ${f.source}` : ''}`));
console.log(`\n-> ${path.join(OUT, `${section}-${lane}-${diveId}.json`)}`);
