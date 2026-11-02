import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { normalizePayload, run, type Deps } from './country-research.ts';
// @ts-ignore: plain .mjs from the pipeline repo
import { parseCountryCsv, countQualifiedLeads } from './country-industry-csv.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'country-run-'));
const biz = (id: string, website: string | null = null) => ({ name: 'Co ' + id, place_id: 'ChIJ' + id, address: id + ' Jalan', phone: '07-1', website, category: 'Agency', mapsUrl: null });

function deps(dir: string, over: Partial<Deps> = {}): Deps & { searched: string[]; seen: Array<Record<string, unknown>> } {
  const searched: string[] = [];
  const seen: Array<Record<string, unknown>> = [];
  return {
    dir, searched, seen,
    progress: (p: Record<string, unknown>) => { seen.push(p); },
    cities: async () => ['Ipoh, Perak, Malaysia', 'Kuantan, Pahang, Malaysia'],
    search: async (p) => {
      searched.push(String(p.place));
      const rows = String(p.place).startsWith('Ipoh') ? [biz('1', 'https://one.example'), biz('2')] : [biz('2'), biz('3', 'https://three.example')];
      return { businesses: rows, found: rows.length, blocked: false, worker: String(p.place).startsWith('Ipoh') ? 'pc-test' : 'scraper-tech-maps' };
    },
    research: async ({ website }) => ({ website, status: 'ok', emails: [{ email: 'hi@' + new URL(website).hostname, source: website }], phones: [], people: [], links: [], pages: [website], errors: [] }),
    ...over,
  } as never;
}

test('a country job runs the pipeline with its Maps searches on the queue', async () => {
  const d = deps(tmp());
  const out = await run({ country: 'Malaysia', industry: 'advertising agency' }, d);
  assert.deepEqual(d.searched.sort(), ['Ipoh, Perak, Malaysia', 'Kuantan, Pahang, Malaysia']);
  const rows = parseCountryCsv(out.csv as string);
  assert.deepEqual(rows[0]!.slice(0, 6), ['name', 'category', 'address', 'phone', 'website', 'emails']);
  assert.equal(rows.length - 1, 3, 'Co 2, found in both cities, is one row');
  assert.equal(countQualifiedLeads(rows), 2);
  const two = rows.find((r: string[]) => r[0] === 'Co 2')!;
  assert.equal(two[rows[0]!.indexOf('search_locations')], 'Ipoh, Perak, Malaysia; Kuantan, Pahang, Malaysia');
  const s = out.summary as Record<string, unknown>;
  assert.equal(s.processed, 3);
  assert.equal(s.withEmail, 2);
  assert.deepEqual(s.searchesByWorker, { 'pc-test': 1, 'scraper-tech-maps': 1 });
  assert.ok(d.seen.some((p) => p.phase === 'maps' && p.completed === 2 && p.total === 2));
  assert.ok(d.seen.some((p) => p.phase === 'contacts' && p.completed === 3 && p.total === 3));
});

test('a failed search is asked again, and one that keeps failing does not stop the run', async () => {
  let ipoh = 0;
  const base = deps(tmp());
  const d = deps(base.dir, {
    search: async (p) => {
      if (String(p.place).startsWith('Ipoh') && ++ipoh === 1) throw new Error('worker went away');
      if (String(p.place).startsWith('Kuantan')) return { businesses: [], blocked: true, blockedReason: 'captcha' };
      return { businesses: [biz('9')], found: 1, worker: 'm4-mini' };
    },
  });
  const out = await run({ country: 'Malaysia', industry: 'printing' }, d);
  const s = out.summary as Record<string, unknown>;
  assert.equal(ipoh, 2);
  assert.equal(s.failedSearches, 1);
  assert.equal(s.processed, 1);
});

test('a resumed job keeps finished searches and website checks', async () => {
  const dir = tmp();
  await run({ country: 'Malaysia', industry: 'advertising agency' }, deps(dir));
  const again = deps(dir, {
    cities: async () => { throw new Error('city list must come from the checkpoint'); },
    search: async () => { throw new Error('no search should run again'); },
    research: async () => { throw new Error('no website should be read again'); },
  });
  const out = await run({ country: 'Malaysia', industry: 'advertising agency' }, again);
  assert.equal((out.summary as Record<string, unknown>).withEmail, 2);
});

test('the payload needs a country and an industry', () => {
  assert.throws(() => normalizePayload({ country: 'Malaysia' }), /country and industry/);
  assert.deepEqual(normalizePayload({ country: ' Malaysia ', industry: ' printing ' }), { country: 'Malaysia', industry: 'printing' });
});
