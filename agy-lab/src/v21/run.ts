import { runStep1Research, type ResearchInput } from './research.ts';

function parseArgs(): {
  company: string;
  country: string;
  industry: string;
  website?: string;
  stage: number;
  batch?: string;
} {
  const args = process.argv.slice(2);
  const out: any = { stage: 1 };

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--company' && args[i + 1]) out.company = args[++i];
    else if (a === '--country' && args[i + 1]) out.country = args[++i];
    else if (a === '--industry' && args[i + 1]) out.industry = args[++i];
    else if (a === '--website' && args[i + 1]) out.website = args[++i];
    else if (a === '--stage' && args[i + 1]) out.stage = parseInt(args[++i], 10);
    else if (a === '--batch' && args[i + 1]) out.batch = args[++i];
  }

  return out;
}

const SAMPLE_BATCH: ResearchInput[] = [
  { company: 'YYC Advisors', country: 'Malaysia', industry: 'Accounting firm', website: 'https://www.yycadvisors.com' },
  { company: 'Dezeno', country: 'Malaysia', industry: 'Interior designer', website: 'https://dezeno.com.my' },
  { company: 'Kingdom Digital', country: 'Malaysia', industry: 'Digital marketing agency', website: 'https://www.kingdomdigital.com.my' },
  { company: 'DNE Logistics', country: 'Malaysia', industry: 'Import export company', website: 'https://dnelogistics.com' },
  { company: 'O2O Digital', country: 'Malaysia', industry: 'Web design company', website: 'https://o2o.my' },
];

async function main() {
  const opts = parseArgs();

  console.log('====================================================');
  console.log('  Company Dive V2.1 Pipeline Runner');
  console.log('  Stage Execution: Step 1 (Research Only)');
  console.log('====================================================\n');

  if (opts.batch) {
    console.log(`Running sample batch of ${SAMPLE_BATCH.length} companies:\n`);
    for (let i = 0; i < SAMPLE_BATCH.length; i++) {
      const item = SAMPLE_BATCH[i];
      console.log(`\n>>> [${i + 1}/${SAMPLE_BATCH.length}] Processing "${item.company}"...`);
      try {
        const { checkpointPath } = await runStep1Research(item);
        console.log(`>>> Checkpoint written: ${checkpointPath}`);
      } catch (err: any) {
        console.error(`>>> Failed "${item.company}":`, err.message);
      }
    }
    console.log('\nBatch run complete!');
    return;
  }

  if (!opts.company || !opts.country || !opts.industry) {
    console.log('Usage:');
    console.log('  node --experimental-strip-types src/v21/run.ts --company <name> --country <country> --industry <industry> [--website <url>] [--stage 1]');
    console.log('  node --experimental-strip-types src/v21/run.ts --batch sample\n');
    console.log('Example:');
    console.log('  node --experimental-strip-types src/v21/run.ts --company "Dezeno" --country "Malaysia" --industry "Interior designer"\n');
    process.exit(1);
  }

  try {
    const res = await runStep1Research({
      company: opts.company,
      country: opts.country,
      industry: opts.industry,
      website: opts.website,
    });
    console.log('\nSUCCESS! Checkpoint file ready:');
    console.log(res.checkpointPath);
  } catch (err: any) {
    console.error('\nRun failed:', err.message);
    process.exit(1);
  }
}

main().catch(console.error);
