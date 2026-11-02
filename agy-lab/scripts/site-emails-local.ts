// Website email scrape, run from this PC. Reads the saved website list, opens the
// homepage and contact page of each lead with its own website, and keeps every
// email printed there. No LLM.
//
//   node scripts/site-emails-local.ts                 read every site not read yet
//   node scripts/site-emails-local.ts --limit 100     read 100 sites, then stop
//   node scripts/site-emails-local.ts --lanes 150
//
// Input: scripts/site-emails-out/websites-raw.json (one read-only SQL pull of company_data:
// id, name, category, website, lead_status, is_hidden, blacklist_reason, site_email_status).
// Output in scripts/site-emails-out/ (git-ignored), every file appended as each site finishes:
//   results.jsonl    one line per lead read, so a rerun skips it
//   site-emails.csv  company_id, company_name, website, email, source_url
//   errors.csv       every page that failed, with the reason
//   run.log          progress and any crash
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ownSiteUrl, scanSite, siteHost } from '../src/site-emails.ts';
import { blacklistReason } from '../src/lead-blacklist.ts';

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'site-emails-out');
const arg = (name: string, dflt: number) => { const i = process.argv.indexOf(name); return i > 0 ? Number(process.argv[i + 1]) : dflt; };
const LANES = arg('--lanes', 100);
const LIMIT = arg('--limit', Infinity);
const PAGE_WAIT_MS = 15_000;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const TRANSIENT = /^(EAI_AGAIN|ECONNRESET|ETIMEDOUT|ECONNREFUSED|UND_ERR_SOCKET|UND_ERR_CONNECT_TIMEOUT|TimeoutError)$/;

type Lead = { id: string; name: string; category: string | null; website: string | null; lead_status: string | null; is_hidden: boolean; blacklist_reason: string | null; site_email_status: string | null };

const file = (name: string) => path.join(OUT, name);
const csv = (cells: unknown[]) => cells.map((c) => '"' + String(c ?? '').replace(/"/g, '""') + '"').join(',');
/** Append-only CSV; the header is written once, when the file is new. */
function csvFile(name: string, header: string[]) {
  const p = file(name);
  if (!fs.existsSync(p)) fs.writeFileSync(p, '﻿' + csv(header) + '\r\n');
  return (cells: unknown[]) => fs.appendFileSync(p, csv(cells) + '\r\n');
}
const log = (line: string) => { console.log(line); fs.appendFileSync(file('run.log'), new Date().toISOString() + ' ' + line + '\n'); };

async function fetchOnce(url: string) {
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5', 'accept-language': 'en-MY,en;q=0.9,ms;q=0.8' },
      signal: AbortSignal.timeout(PAGE_WAIT_MS),
    });
    if (!res.ok) return { error: 'HTTP ' + res.status };
    const type = res.headers.get('content-type') ?? '';
    if (type && !/html|text\/plain|xml/i.test(type)) return { error: 'not html: ' + type };
    return { url: res.url || url, html: (await res.text()).slice(0, 2_000_000) };
  } catch (err) {
    const cause = (err as { cause?: NodeJS.ErrnoException }).cause;
    return { error: String(cause?.code ?? cause?.message ?? (err as Error).name ?? 'fetch failed') };
  }
}

async function fetchPage(url: string) {
  const first = await fetchOnce(url);
  if ('error' in first && TRANSIENT.test(first.error)) {
    await new Promise((r) => setTimeout(r, 1500));
    return fetchOnce(url);
  }
  return first;
}

async function main(): Promise<void> {
  const leads: Lead[] = JSON.parse(fs.readFileSync(file('websites-raw.json'), 'utf8')).rows;

  // A host on 3+ leads is a directory or a chain's head office, not the lead's own site.
  const hostCount = new Map<string, number>();
  for (const l of leads) { const h = siteHost(l.website); if (h) hostCount.set(h, (hostCount.get(h) ?? 0) + 1); }
  // site_email_status set = already read by the hub lane; its emails are in company_email.
  const todo = leads.filter((l) => ownSiteUrl(l.website) && !l.is_hidden && l.lead_status !== 'do_not_call'
    && !l.blacklist_reason && !blacklistReason(l.name, l.category) && !l.site_email_status
    && (hostCount.get(siteHost(l.website)!) ?? 0) < 3);

  const resultsFile = file('results.jsonl');
  const done = new Set<string>();
  if (fs.existsSync(resultsFile)) for (const line of fs.readFileSync(resultsFile, 'utf8').split('\n')) if (line) done.add(String(JSON.parse(line).id));
  const queue = todo.filter((l) => !done.has(String(l.id))).slice(0, LIMIT);
  log(`${todo.length} leads to read in all; ${done.size} already read; reading ${queue.length} with ${LANES} lanes`);

  const addEmail = csvFile('site-emails.csv', ['company_id', 'company_name', 'website', 'email', 'source_url']);
  const addError = csvFile('errors.csv', ['company_id', 'company_name', 'website', 'status', 'error']);
  const t1 = Date.now();
  let i = 0, read = 0, found = 0, emails = 0, unreachable = 0, crashed = 0;
  await Promise.all(Array.from({ length: LANES }, async () => {
    while (i < queue.length) {
      const lead = queue[i++];
      let r: Awaited<ReturnType<typeof scanSite>>;
      try {
        r = await scanSite(lead.website, fetchPage);
      } catch (err) {
        // A crash on one site is that site's error; the run goes on.
        crashed++;
        r = { status: 'unreachable', emails: [], pages: [], errors: ['crash: ' + ((err as Error)?.stack ?? String(err)).split('\n').slice(0, 3).join(' / ')] };
      }
      fs.appendFileSync(resultsFile, JSON.stringify({ id: lead.id, name: lead.name, website: lead.website, ...r }) + '\n');
      for (const e of r.emails) addEmail([lead.id, lead.name, lead.website, e.email, e.source_url]);
      for (const e of r.errors ?? []) addError([lead.id, lead.name, lead.website, r.status, e]);
      read++;
      if (r.status === 'found') { found++; emails += r.emails.length; }
      if (r.status === 'unreachable') unreachable++;
      if (read % 500 === 0) log(`  ${read}/${queue.length} read, ${found} with email, ${emails} emails, ${unreachable} unreachable, ${Math.round((Date.now() - t1) / 1000)} s`);
    }
  }));
  log(`read ${read} in ${Math.round((Date.now() - t1) / 1000)} s: ${found} with email, ${emails} emails, ${unreachable} unreachable, ${crashed} crashed`);
  log('output: ' + OUT);
}

fs.mkdirSync(OUT, { recursive: true });
process.on('unhandledRejection', (err) => log('unhandled: ' + ((err as Error)?.stack ?? String(err))));
await main().catch((err) => { log('run crashed: ' + ((err as Error)?.stack ?? String(err))); process.exitCode = 1; });
