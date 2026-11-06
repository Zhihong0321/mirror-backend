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

const MY_SAMPLE_BATCH: ResearchInput[] = [
  { company: 'YYC Advisors', country: 'Malaysia', industry: 'Accounting firm', website: 'https://www.yycadvisors.com' },
  { company: 'Dezeno', country: 'Malaysia', industry: 'Interior designer', website: 'https://dezeno.com.my' },
  { company: 'Kingdom Digital', country: 'Malaysia', industry: 'Digital marketing agency', website: 'https://www.kingdomdigital.com.my' },
  { company: 'DNE Logistics', country: 'Malaysia', industry: 'Import export company', website: 'https://dnelogistics.com' },
  { company: 'O2O Digital', country: 'Malaysia', industry: 'Web design company', website: 'https://o2o.my' },
];

const SG_SAMPLE_BATCH: ResearchInput[] = [
  { company: 'RSM Singapore', country: 'Singapore', industry: 'Accounting firm', website: 'https://www.rsmsingapore.sg/' },
  { company: 'OOm Pte Ltd', country: 'Singapore', industry: 'Digital marketing agency', website: 'https://www.oom.com.sg/' },
  { company: 'Makoto-Ya Singapore', country: 'Singapore', industry: 'Import export company', website: 'https://www.makoto-ya.com.sg/' },
  { company: 'Space Factor', country: 'Singapore', industry: 'Interior designer', website: 'https://spacefactor.com.sg/' },
  { company: 'Verz Design', country: 'Singapore', industry: 'Web design company', website: 'https://www.verzdesign.com/' },
];

const AU_SAMPLE_BATCH: ResearchInput[] = [
  { company: 'Pitcher Partners', country: 'Australia', industry: 'Accounting firm', website: 'https://www.pitcher.com.au/' },
  { company: 'Digital Next', country: 'Australia', industry: 'Digital marketing agency', website: 'https://www.digitalnext.com.au/' },
  { company: 'Magellan Logistics', country: 'Australia', industry: 'Import export company', website: 'https://magellanlogistics.com.au/' },
  { company: 'Alexander &CO.', country: 'Australia', industry: 'Interior designer', website: 'https://alexanderand.co/' },
  { company: 'Chromatix', country: 'Australia', industry: 'Web design company', website: 'https://www.chromatix.com.au/' },
];

// South Korea: names as on Google Maps (the native-language search list), searched in Korean.
const KR_SAMPLE_BATCH: ResearchInput[] = [
  { company: '세무법인 혜움', country: 'South Korea', industry: 'Accounting firm', website: 'https://www.heumtax.com/' },
  // 이상한 마케팅 (isanghan.co.kr) was skipped by the gate on 2026-11-04: its site serves a script cookie check
  // that no reader got past. 애드이피션시 stands in for the industry.
  { company: '애드이피션시', country: 'South Korea', industry: 'Digital marketing agency', website: 'http://www.adef.co.kr/' },
  // 제이엘무역 (worldjltrade.com) was skipped by the gate on 2026-11-04: its site is all images (the name is only in
  // <title>), so there is no readable baseline. 한국동지무역 stands in for the industry.
  { company: '한국동지무역(주)', country: 'South Korea', industry: 'Import export company', website: 'http://www.dongjitrading.com/' },
  { company: '은민에스엔디', country: 'South Korea', industry: 'Interior designer', website: 'https://eunmin.co.kr/' },
  { company: '(주)플랜아이', country: 'South Korea', industry: 'Web design company', website: 'http://www.plani.co.kr/' },
];

async function main() {
  const opts = parseArgs();

  console.log('====================================================');
  console.log('  Company Dive V2.1 Pipeline Runner');
  console.log('  Stage Execution: Step 1 (Research Only)');
  console.log('====================================================\n');

  if (opts.batch) {
    const b = opts.batch.toLowerCase();
    const isSg = b.includes('sg');
    const isAu = b.includes('au');
    const isKr = b.includes('kr');
    const batchList = isKr ? KR_SAMPLE_BATCH : isAu ? AU_SAMPLE_BATCH : isSg ? SG_SAMPLE_BATCH : MY_SAMPLE_BATCH;
    const batchName = isKr ? 'South Korea' : isAu ? 'Australia' : isSg ? 'Singapore' : 'Malaysia';
    console.log(`Running ${batchName} batch of ${batchList.length} companies:\n`);
    for (let i = 0; i < batchList.length; i++) {
      const item = batchList[i];
      console.log(`\n>>> [${i + 1}/${batchList.length}] Processing "${item.company}"...`);
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
