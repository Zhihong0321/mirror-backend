import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { loadV21Dive, type Reader } from './adapter.ts';

function fixture() {
  const report = { company: 'Eternalgy Sdn Bhd', country: 'Malaysia', industry: 'Solar PV', company_uid: 'co_test', step1_status: 'done', step2_status: 'done' };
  const raw: Record<string, { id: number; payload: any } | null> = {
    checkpoint: { id: 1, payload: { official_site: { domain: 'WWW.ETERNALGY.ME' }, google_maps: { result: { businesses: [{ name: 'Eternalgy', place_id: 'kept' }] } } } },
    assets: { id: 2, payload: {} },
    tidy: { id: 3, payload: { official: { pages: [{ label: 'home', url: 'https://eternalgy.me/', text: 'a'.repeat(1700) }] } } },
    result: { id: 4, payload: { baseline: {
      legal_names: ['Eternalgy Sdn Bhd (Co. Reg. 202301000001) [HQ]'],
      brand_names: ['Eternalgy (brand)', 'eternalgy', 'Eternalgy Sdn Bhd'],
      addresses: ['HQ: 1 Jalan Satu, Johor Bahru (eternalgy.me)', 'KL: 2 Jalan Dua [branch]'],
      websites: ['https://WWW.ETERNALGY.COM/contact (canonical)', 'https://eternalgy.newpages.com.my', 'solarpanels.onesync.my', 'solarpanels.my'],
      official_domain: 'eternalgy.com.my (old site)',
      claimed_numbers: ['SSM 538624-w', '202301000001', '12 MWp', 'RM35000000', '0120250324-WP152634'],
    } } },
  };
  const reader: Reader = { getReport: async () => report, latestRaw: async (_id, kind) => raw[kind] };
  return { report, raw, reader };
}

test('adapter cleans notes, extracts SSM numbers, keeps brand domains and preserves own Maps rows', async () => {
  const { reader, raw } = fixture();
  const { dive, rows } = await loadV21Dive('report', reader);
  const identity = dive.result.identity;
  assert.equal(identity.legal_name, 'Eternalgy Sdn Bhd');
  assert.equal(identity.aliases.length, 1);
  assert.equal(identity.aliases[0].toLowerCase(), 'eternalgy');
  assert.deepEqual(identity.registration_numbers, ['202301000001', '538624-W']);
  assert.equal(identity.address, '1 Jalan Satu, Johor Bahru');
  assert.equal(identity.industry, 'Solar PV');
  assert.deepEqual(identity.official_domains, ['eternalgy.me', 'eternalgy.com', 'eternalgy.com.my']);
  assert.deepEqual(dive.result.facts, [
    { topic: 'footprint', fact: 'Office: 1 Jalan Satu, Johor Bahru', confidence: 'medium' },
    { topic: 'footprint', fact: 'Office: 2 Jalan Dua', confidence: 'medium' },
    ...raw.result!.payload.baseline.claimed_numbers.map((n: string) => ({ topic: 'identity', fact: `Official site claims: ${n}`, confidence: 'medium' })),
    { topic: 'products_services', fact: 'home: ' + 'a'.repeat(1700), confidence: 'medium' },
  ]);
  assert.deepEqual(dive.v21.pages, raw.tidy!.payload.official.pages);
  assert.equal(dive.result.identity.summary, ('home: ' + 'a'.repeat(1700)).slice(0, 1500));
  assert.deepEqual(dive.result.contradictions, []);
  assert.deepEqual(dive.result.sources, [{ id: 1, url: 'https://eternalgy.me/', title: 'home' }]);
  assert.strictEqual(dive.v21.maps_own, raw.checkpoint!.payload.google_maps.result.businesses);
  assert.deepEqual(rows, { checkpoint: 1, assets: 2, tidy: 3, result: 4 });
});

test('adapter names missing reports, unfinished steps, missing result and skipped checkpoint', async () => {
  const { reader, report, raw } = fixture();
  await assert.rejects(loadV21Dive('missing', { ...reader, getReport: async () => null }), /missing/);
  for (const step of [1, 2] as const) {
    report[`step${step}_status`] = 'running';
    await assert.rejects(loadV21Dive('report', reader), new RegExp(`Step ${step} is not done`));
    report[`step${step}_status`] = 'done';
  }
  const result = raw.result;
  raw.result = null;
  await assert.rejects(loadV21Dive('report', reader), /no result row/);
  raw.result = result;
  raw.checkpoint!.payload.skipped = true;
  await assert.rejects(loadV21Dive('report', reader), /checkpoint is skipped/);
});

test('optional assets and tidy can be absent; legal name falls back to the report', async () => {
  const { reader, raw } = fixture();
  raw.assets = raw.tidy = null;
  raw.result!.payload.baseline.legal_names = [];
  const { dive, rows } = await loadV21Dive('report', reader);
  assert.equal(dive.result.identity.legal_name, 'Eternalgy Sdn Bhd');
  assert.equal(rows.assets, null);
  assert.equal(rows.tidy, null);
  assert.deepEqual(dive.v21.pages, []);
});

test('adapter gives the G judge phones, credentials, full official text and both sides of contradictions', async () => {
  const { reader, raw } = fixture();
  raw.result!.payload.baseline.phones = ['07-1234567'];
  raw.result!.payload.baseline.claimed_credentials = ['SEDA registered'];
  raw.tidy!.payload.official.site_wide = 'Founded in 2018. Director: A Person.';
  raw.result!.payload.findings = [
    { type: 'contradiction', claim: 'Phone 07-1234567', outside_source: 'Phone 07-7654321', source_name: 'Directory', source_url: 'https://directory.test' },
    { type: 'profile_drift', claim: 'Private company', outside_source: 'Public company', source_name: 'LinkedIn' },
    { type: 'missed_advantage', claim: 'Award absent', outside_source: 'Won an award' },
  ];
  const { dive } = await loadV21Dive('report', reader);
  const sheet = dive.result.facts.map((f) => f.fact).join('\n');
  assert.match(sheet, /Official phone: 07-1234567/);
  assert.match(sheet, /Official site claims: SEDA registered/);
  assert.match(sheet, /Founded in 2018. Director: A Person/);
  assert.equal(dive.v21.site_wide, raw.tidy!.payload.official.site_wide);
  assert.equal(dive.result.contradictions.length, 2);
  assert.match(dive.result.contradictions[0], /07-1234567.*07-7654321/);
});

test('adapter reads every report in V21_DEEPER_ROWS without a database', { skip: !process.env.V21_DEEPER_ROWS }, async (t) => {
  const folder = process.env.V21_DEEPER_ROWS!;
  const entries = (await fs.readdir(folder, { withFileTypes: true })).filter((entry) => entry.isDirectory());
  assert.ok(entries.length, 'saved report folder must not be empty');
  for (const entry of entries) await t.test(entry.name, async () => {
    const dir = path.join(folder, entry.name);
    const { report } = JSON.parse(await fs.readFile(path.join(dir, 'report.json'), 'utf8'));
    const raw = await Promise.all((await fs.readdir(dir)).filter((file) => /^row-.*\.json$/.test(file))
      .map(async (file) => JSON.parse(await fs.readFile(path.join(dir, file), 'utf8'))));
    const reader: Reader = {
      getReport: async () => report,
      latestRaw: async (_id, kind) => raw.filter((r) => r.kind === kind).sort((a, b) => Number(b.id) - Number(a.id))[0] ?? null,
    };
    const { dive, rows } = await loadV21Dive(report.report_id, reader);
    // Notes in brackets go; a bracket that is part of the registered name stays.
    assert.doesNotMatch(dive.result.identity.legal_name.replace(/\((M|Malaysia)\)(?= Sdn Bhd)/, ''), /[()[\]]/);
    if (/DNE/i.test(report.company)) {
      assert.ok(dive.result.identity.registration_numbers.includes('538624-W'));
      assert.equal(dive.result.identity.legal_name, 'DNE Forwarding (M) Sdn Bhd');
    }
    const checkpoint = await reader.latestRaw(report.report_id, 'checkpoint');
    assert.ok(dive.result.identity.official_domains.includes(checkpoint!.payload.official_site.domain.toLowerCase().replace(/^www\./, '')));
    assert.ok(dive.result.identity.official_domains.every((d) => !/(?:newpages\.com\.my|onesync\.my|contact\.page)$/.test(d)), 'no directory hosts');
    assert.ok(dive.result.identity.address);
    assert.doesNotMatch(dive.result.identity.address, /[()[\]]|^(?:HQ|KL):/);
    assert.ok(dive.result.facts.length);
    assert.deepEqual(dive.v21.maps_own, checkpoint!.payload.google_maps.result.businesses);
    const tidy = await reader.latestRaw(report.report_id, 'tidy');
    assert.deepEqual(dive.v21.pages, (tidy?.payload?.official?.pages ?? []).map((p: any) => ({ label: p.label ?? 'Official page', url: p.url ?? '', text: p.text ?? '' })));
    assert.ok(dive.result.facts.every((f) => f.confidence === 'medium'));
    assert.equal(typeof dive.result.identity.summary, 'string');
    assert.ok(Array.isArray(dive.result.contradictions));
    for (const kind of ['checkpoint', 'assets', 'tidy', 'result'] as const) assert.equal(rows[kind], (await reader.latestRaw(report.report_id, kind))?.id ?? null);
    await assert.rejects(loadV21Dive(report.report_id, { ...reader, getReport: async () => ({ ...report, step2_status: 'running' }) }), /Step 2 is not done/);
    await assert.rejects(loadV21Dive(report.report_id, { ...reader, latestRaw: async (id, kind) => {
      const row = await reader.latestRaw(id, kind);
      return row && kind === 'checkpoint' ? { ...row, payload: { ...row.payload, skipped: true } } : row;
    } }), /checkpoint is skipped/);
  });
});
