// Find tamans the territory list misses, from this machine, one town at a time,
// with a person approving each town's names before anything is saved.
//
//   node scripts/find-tamans.ts status [state]
//   node scripts/find-tamans.ts check <state> <district> [town]   read, print, write a review file
//   node scripts/find-tamans.ts save <review.json> [--only 1,3] [--skip 2]
//
// `check` sends nothing to the hub: it runs seven Google Maps list searches per
// town plus the hub's saved leads, and prints every area name with how many
// addresses carry it (taman-finder.ts). `save` posts the approved names; the hub
// saves them as verified tamans and records the town, so `check` skips it from
// then on. Env: LAB_TOKEN, SCRAPER_TECH_KEY, optional LAB_URL.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MIN_ADDRESSES, pendingTowns, runTown, townId, type Deps, type TownOutcome } from '../src/taman-finder.ts';
import { resolveConfig, searchMaps } from '../src/maps-worker.ts';
import { ALL_TERRITORIES } from '../src/territories.ts';

const LAB = (process.env.LAB_URL ?? 'https://ee-auto.up.railway.app').replace(/\/+$/, '');
const TOKEN = process.env.LAB_TOKEN ?? '';
const REVIEW_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'finder-review');

async function lab(pathname: string, init: RequestInit = {}): Promise<any> {
  const res = await fetch(LAB + pathname, { ...init, headers: { authorization: 'Bearer ' + TOKEN, 'content-type': 'application/json', ...init.headers } });
  const body = await res.text();
  if (!res.ok) throw new Error(`${pathname}: HTTP ${res.status} ${body.slice(0, 200)}`);
  return JSON.parse(body);
}

async function checkedTowns(): Promise<Array<{ state: string; district: string; town: string; status: string; added: number; finished_at: string }>> {
  return (await lab('/api/territories/finder')).towns;
}

/** Saved leads whose address names the town, through the hub's lead search. */
async function leadAddresses(town: string): Promise<string[]> {
  const out: string[] = [];
  for (let offset = 0; offset < 20_000; offset += 100) {
    const page = await lab(`/api/leads?search=${encodeURIComponent(town)}&limit=100&offset=${offset}`);
    for (const lead of page.leads ?? []) if (lead.address) out.push(lead.address);
    if ((page.leads ?? []).length < 100) break;
  }
  return out;
}

function print(out: TownOutcome, file: string): void {
  console.log(`\n=== ${out.town}, ${out.district}, ${out.state}: ${out.status} | ${out.addresses_read} addresses | ${out.maps_requests} Maps requests`);
  if (out.error) console.log(`    failures: ${out.error}`);
  console.log(`\nNEW, named in ${MIN_ADDRESSES}+ addresses here and not on the daerah list:`);
  out.found.forEach((e, i) => console.log(`  ${String(i + 1).padStart(2)}. ${e.name.padEnd(34)} ${String(e.addresses).padStart(3)} addresses   e.g. ${e.sample.slice(0, 80)}`));
  if (!out.found.length) console.log('  (none)');
  console.log(`\nalready listed: ${out.listed.map((e) => e.name).join(', ') || '-'}`);
  console.log(`too vague:      ${out.vague.map((e) => e.name).join(', ') || '-'}`);
  console.log(`one address:    ${out.thin.map((e) => e.name).join(', ') || '-'}`);
  console.log(`\nreview file: ${file}`);
}

async function check(state: string, district: string, townName?: string): Promise<void> {
  const territory = ALL_TERRITORIES[state.toLowerCase()];
  const d = territory?.districts.find((x) => x.name.toLowerCase() === district.toLowerCase());
  if (!territory || !d) throw new Error(`unknown state or district: ${state} / ${district}`);
  const done = new Set((await checkedTowns()).map((r) => townId(r.state, r.district, r.town)));
  const towns = d.towns.filter((t) => !townName || t.name.toLowerCase() === townName.toLowerCase());
  if (!towns.length) throw new Error(`unknown town: ${townName} in ${d.name}`);
  const maps = resolveConfig();
  if (!maps.key) throw new Error('SCRAPER_TECH_KEY is not set');
  fs.mkdirSync(REVIEW_DIR, { recursive: true });
  for (const town of towns) {
    if (done.has(townId(territory.state, d.name, town.name))) {
      console.log(`\n${town.name}, ${d.name}: already checked, skipped`);
      continue;
    }
    let pending: { run: unknown; tamans: unknown[] } | null = null;
    const deps: Deps = {
      maps: (q) => searchMaps(maps, q, 500),
      leadAddresses,
      // Nothing is saved here: the run and its names go to the review file.
      save: async (rows) => { pending = { run: null, tamans: rows }; return rows.length; },
      record: async (run) => { pending = { run, tamans: pending?.tamans ?? [] }; return true; },
      log: () => {},
    };
    const out = await runTown(territory, d, town, deps);
    const file = path.join(REVIEW_DIR, `${territory.state}-${d.name}-${town.name}.json`.replace(/[^\w.-]+/g, '_'));
    const { found, listed, thin, vague, ...run } = out;
    fs.writeFileSync(file, JSON.stringify({ run, tamans: (pending as { tamans: unknown[] } | null)?.tamans ?? [], found, listed, thin, vague }, null, 2));
    print(out, file);
  }
}

async function save(file: string, args: string[]): Promise<void> {
  const review = JSON.parse(fs.readFileSync(file, 'utf8'));
  const pick = (flag: string) => {
    const i = args.indexOf(flag);
    return i < 0 ? null : new Set(String(args[i + 1] ?? '').split(',').map(Number).filter(Boolean));
  };
  const only = pick('--only');
  const skip = pick('--skip');
  const tamans = (review.tamans as Array<{ name: string }>).filter((_, i) => (!only || only.has(i + 1)) && !skip?.has(i + 1));
  const run = { ...review.run, detail: { ...review.run.detail, approved: tamans.map((t) => t.name), rejected: review.tamans.filter((t: { name: string }) => !tamans.includes(t)).map((t: { name: string }) => t.name) } };
  const result = await lab('/api/territories/finder', { method: 'POST', body: JSON.stringify({ run, tamans }) });
  console.log(`${review.run.town}, ${review.run.district}: saved ${result.added} of ${tamans.length} approved tamans${result.recorded ? ', town recorded as checked' : ' (town was already recorded)'}`);
  for (const t of tamans) console.log('  + ' + t.name);
}

async function status(state?: string): Promise<void> {
  const runs = await checkedTowns();
  const states = state ? [state.toLowerCase()] : Object.keys(ALL_TERRITORIES);
  const done = new Set(runs.map((r) => townId(r.state, r.district, r.town)));
  for (const key of states) {
    const t = ALL_TERRITORIES[key];
    if (!t) continue;
    console.log(`\n${t.state}`);
    for (const d of t.districts) {
      const checked = d.towns.filter((x) => done.has(townId(t.state, d.name, x.name)));
      const added = runs.filter((r) => r.state === t.state && r.district === d.name).reduce((n, r) => n + r.added, 0);
      console.log(`  ${d.name.padEnd(16)} ${checked.length}/${d.towns.length} towns checked, ${added} tamans added`);
    }
  }
  const next = pendingTowns(done, states).slice(0, 8);
  console.log(`\nnext towns, spread over the daerah: ${next.map((n) => `${n.town.name} (${n.district.name})`).join(', ')}`);
}

const [cmd, ...rest] = process.argv.slice(2);
if (!TOKEN) throw new Error('LAB_TOKEN is not set');
if (cmd === 'check') await check(rest[0] ?? '', rest[1] ?? '', rest[2]);
else if (cmd === 'save') await save(rest[0] ?? '', rest.slice(1));
else if (cmd === 'status') await status(rest[0]);
else console.log('usage: find-tamans.ts status [state] | check <state> <district> [town] | save <review.json> [--only 1,3] [--skip 2]');
