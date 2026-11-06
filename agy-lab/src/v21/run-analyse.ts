import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyseRunDirectory, type Step2AnalysisOutput } from './analyse.ts';
import { runFailureTests } from './step2-failure-tests.ts';
import { benchReport, importOldSqlite } from './bench-db.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const runsDir = path.resolve(here, 'runs');

const TARGET_RUNS: Record<string, string> = {
  // Malaysia
  'yyc-advisors': '2026-11-04T03-19-48_yyc-advisors',
  'dezeno': '2026-11-04T02-16-50_dezeno',
  'kingdom-digital': '2026-11-04T05-10-08_kingdom-digital',
  'dne-logistics': '2026-11-03T14-40-39_dne-logistics',
  'o2o-digital': '2026-11-03T14-40-59_o2o-digital',

  // Singapore
  'rsm-singapore': '2026-11-04T02-11-43_rsm-singapore',
  'oom-pte-ltd': '2026-11-04T05-11-13_oom-pte-ltd',
  'makoto-ya-singapore': '2026-11-03T15-23-30_makoto-ya-singapore',
  'space-factor': '2026-11-03T15-08-03_space-factor',
  'verz-design': '2026-11-03T15-08-23_verz-design',

  // Australia
  'pitcher-partners': '2026-11-04T03-18-47_pitcher-partners',
  'digital-next': '2026-11-03T16-52-03_digital-next',
  'magellan-logistics': '2026-11-03T16-52-19_magellan-logistics',
  'alexander-co': '2026-11-03T16-52-35_alexander-co',
  'chromatix': '2026-11-04T05-12-08_chromatix',

  // South Korea
  '세무법인-혜움': '2026-11-04T08-10-23_세무법인-혜움',
  '애드이피션시': '2026-11-04T07-51-53_애드이피션시',
  '한국동지무역-주': '2026-11-04T07-53-21_한국동지무역-주',
  '은민에스엔디': '2026-11-04T07-53-40_은민에스엔디',
  '주-플랜아이': '2026-11-04T07-54-03_주-플랜아이',

  // Skipped
  '이상한-마케팅': '2026-11-04T07-06-24_이상한-마케팅',
  '제이엘무역': '2026-11-04T07-08-02_제이엘무역',
  'nonexistent-widget': '2026-11-03T13-16-17_nonexistent-widget-trading-sdn-bhd',
};

const BATCHES: Record<string, string[]> = {
  my: ['yyc-advisors', 'dezeno', 'kingdom-digital', 'dne-logistics', 'o2o-digital'],
  sg: ['rsm-singapore', 'oom-pte-ltd', 'makoto-ya-singapore', 'space-factor', 'verz-design'],
  au: ['pitcher-partners', 'digital-next', 'magellan-logistics', 'alexander-co', 'chromatix'],
  kr: ['세무법인-혜움', '애드이피션시', '한국동지무역-주', '은민에스엔디', '주-플랜아이'],
  skipped: ['이상한-마케팅', '제이엘무역', 'nonexistent-widget'],
};

function printResult(out: Step2AnalysisOutput) {
  console.log(`\n========================================================================`);
  console.log(`[STAGE 2 RESULT] ${out.input.company} (${out.input.country}) | Status: ${out.status.toUpperCase()}`);
  console.log(`Duration: ${(out.stats.duration_ms / 1000).toFixed(1)}s | LLM calls: ${out.stats.llm_calls}`);
  console.log(`Official domain: ${out.baseline.official_domain || 'N/A'} (pages: ${out.baseline.pages_present.join(', ') || 'none'})`);

  if (out.status === 'skipped') {
    console.log(`Skipped reason: ${out.skip_reason}`);
    return;
  }
  if (out.status === 'failed') {
    console.log(`Error: ${out.error}`);
    return;
  }

  console.log(`\nFindings (${out.findings.length}):`);
  if (out.findings.length === 0) {
    console.log(`  (No findings detected)`);
  }
  for (const f of out.findings) {
    console.log(`  * [${f.type.toUpperCase()}] ${f.title}`);
    console.log(`    - Claim on site:   ${f.claim}`);
    console.log(`    - Outside source:  ${f.outside_source} (${f.source_name} - ${f.source_url})`);
    console.log(`    - Quoted text:     "${f.quoted_text}"`);
    console.log(`    - Confidence:      ${f.confidence} | Justification: ${f.identity_justification}`);
  }

  console.log(`\nDropped Namesakes (${out.dropped_namesakes.length}):`);
  if (out.dropped_namesakes.length === 0) {
    console.log(`  (None dropped)`);
  }
  for (const n of out.dropped_namesakes) {
    console.log(`  * Dropped: "${n.name}" (${n.url})`);
    console.log(`    Reason: ${n.reason_dropped}`);
  }

  if (out.rejected_findings) {
    console.log(`\nRejected by the check (${out.rejected_findings.length}):`);
    for (const r of out.rejected_findings) console.log(`  * ${String(r.finding.title ?? '')} -> ${r.reasons.join('; ')}`);
  }

  if (out.recheck) {
    const rc = out.recheck;
    console.log(`\nRecheck: ${rc.status}${rc.error ? ` (${rc.error})` : ''} ${(rc.meta.duration_ms / 1000).toFixed(1)}s`);
    for (const r of rc.reviews) console.log(`  * ${r.verdict.toUpperCase()} ${r.finding_id}${r.problems.length ? `: ${r.problems.join(' | ')}` : ''}`);
    for (const a of rc.added) console.log(`  * ADDED ${a}`);
    for (const r of rc.rejected) console.log(`  * REFUSED ${String(r.finding.title ?? '')}: ${r.reasons.join('; ')}`);
  }
  if (out.bench) console.log(`Bench rows: judge #${out.bench.judge_id ?? '-'} recheck #${out.bench.recheck_id ?? '-'}${out.bench.error ? ` (${out.bench.error})` : ''}`);

  console.log(`\nCould Not Check (${out.could_not_check.length}):`);
  for (const c of out.could_not_check) {
    console.log(`  * ${c.target}: ${c.reason}`);
  }
  console.log(`========================================================================\n`);
}

async function runOne(folderName: string, options: { forcedLlmError?: boolean; forcedMalformedJson?: boolean; tidy?: boolean; outName?: string; recheck?: boolean } = {}) {
  const dirPath = path.join(runsDir, folderName);
  if (!fs.existsSync(dirPath)) {
    console.error(`Directory not found: ${dirPath}`);
    return;
  }
  console.log(`Running Step 2 on: ${folderName}...`);
  const res = await analyseRunDirectory(dirPath, options);
  printResult(res);
  return res;
}

async function main() {
  const args = process.argv.slice(2);
  let batch = '';
  let runFolder = '';
  let company = '';
  let testFailures = false;
  // Stage 1 fix: --tidy feeds Step 2 the tidy data and new prompt; --out writes to another file so run 1 is kept.
  let tidy = false;
  let outName = "";
  // Stage 3: --recheck adds the LLM recheck (needs --tidy); --bench prints the benchmark store and exits.
  let recheck = false;
  let showBench = false;
  let benchImport = false; // copy the first local SQLite rows to the hub once

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--batch' && args[i + 1]) batch = args[++i];
    else if (args[i] === '--run' && args[i + 1]) runFolder = args[++i];
    else if (args[i] === '--company' && args[i + 1]) company = args[++i];
    else if (args[i] === '--test-failures') testFailures = true;
    else if (args[i] === '--tidy') tidy = true;
    else if (args[i] === '--recheck') recheck = true;
    else if (args[i] === '--bench') showBench = true;
    else if (args[i] === '--bench-import') benchImport = true;
    else if (args[i] === '--out' && args[i + 1]) outName = args[++i];
  }

  if (testFailures) {
    // Tidy-path failure tests on a temporary copy of a real run (the real folder is checked unchanged).
    const ok = await runFailureTests(path.join(runsDir, TARGET_RUNS[company || 'dne-logistics'] ?? TARGET_RUNS['dne-logistics']));
    process.exitCode = ok ? 0 : 1;
    return;
  }

  if (benchImport) {
    console.log(await importOldSqlite());
    return;
  }
  if (showBench) {
    console.log(await benchReport());
    return;
  }
  const runOpts = { tidy, outName: outName || undefined, recheck };

  if (runFolder) {
    await runOne(runFolder, runOpts);
    return;
  }

  if (company) {
    for (const key of company.split(',')) {
      const folder = TARGET_RUNS[key];
      if (!folder) {
        console.error(`Unknown company key: "${key}". Available: ${Object.keys(TARGET_RUNS).join(', ')}`);
        continue;
      }
      await runOne(folder, runOpts);
    }
    return;
  }

  if (batch) {
    const list = batch === 'all'
      ? Object.keys(TARGET_RUNS)
      : (BATCHES[batch] || []);

    if (list.length === 0) {
      console.error(`Unknown batch: "${batch}". Available: my, sg, au, kr, skipped, all`);
      return;
    }

    console.log(`Starting batch: "${batch}" (${list.length} companies)...`);
    for (const key of list) {
      const folder = TARGET_RUNS[key];
      if (folder) {
        await runOne(folder, runOpts);
      }
    }
    return;
  }

  console.log('Usage:');
  console.log('  node src/v21/run-analyse.ts --batch <my|sg|au|kr|skipped|all>');
  console.log('  node src/v21/run-analyse.ts --company <company_key>');
  console.log('  node src/v21/run-analyse.ts --run <folder_name>');
  console.log('  node src/v21/run-analyse.ts --test-failures');
}

main().catch((err) => {
  console.error('Fatal runner error:', err);
  process.exit(1);
});
