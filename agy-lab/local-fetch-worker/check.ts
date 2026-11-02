// Does this mini actually read pages? Run it on the mini, against the live
// Crawl4AI container, before trusting the worker with a dive:
//
//   node agy-lab/local-fetch-worker/check.ts
//   node agy-lab/local-fetch-worker/check.ts https://some-site.example/ ...
//
// It uses the worker's own readPage, so a pass here means the worker's half of
// the job works: the container is up, the token in worker.env is the one it
// wants, and a page comes back as text. It never touches the hub.
//
// The default list is deliberately mixed: two real company sites, one host with
// no DNS record (which must come back as a clean error, not a crash) and one
// page that is mostly chrome (raw keeps it all; a dive gets what Tavily gave it).
import { readPage, plainError } from './worker.ts';

const DEFAULT_URLS = [
  'https://solarvest.my',
  'https://www.samaiden.com.my',
  'https://www.maybank.com/en/about-us.page',
  'https://plussolar.com.my/about',
];

const urls = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT_URLS;

// A dead host must read like a dead host, not like a blocked router.
const sample = plainError('URL blocked (SSRF protection): URL blocked');
if (/SSRF/.test(sample)) {
  console.error('plainError is not translating crawl4ai\'s SSRF wording: ' + sample);
  process.exit(1);
}

let read = 0;
let failed = 0;
for (const url of urls) {
  const at = Date.now();
  const out = await readPage(url);
  const ms = Date.now() - at;
  if ('markdown' in out) {
    read++;
    const head = out.markdown.replace(/\s+/g, ' ').slice(0, 90);
    console.log(`  read  ${out.markdown.length.toString().padStart(6)} chars  ${String(ms).padStart(5)}ms  ${url}\n        ${head}…`);
  } else {
    failed++;
    console.log(`  FAIL  ${''.padStart(6)}        ${String(ms).padStart(5)}ms  ${url}\n        ${out.error}`);
  }
}

console.log(`\n${read} read, ${failed} failed, of ${urls.length}`);
// Every page failing means the container, not the web: that is worth an exit code.
process.exit(read ? 0 : 1);
