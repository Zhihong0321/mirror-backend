import test from 'node:test';
import assert from 'node:assert/strict';
import { areaNames, FAMILIES, familyFor, inArea, resolveConfig, scan, searchMaps, streetsOf, toBusiness } from './maps-worker.ts';
import { scanPlaceKey } from './reportdb.ts';

const config = { key: 'k123', baseUrl: 'https://mcp.example', lanes: 1 };

function row(i: number, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    business_id: `0x${i}:0x${i}`, place_id: `ChIJplace${i}`, name: `Biz ${i} Sdn Bhd Trading`,
    full_address: `${i}, Jalan Sagu 18, Taman Daya, 81100 Johor Bahru, Johor`,
    phone_number: '+6071234567', website: null, rating: 4.5, review_count: 12,
    types: ['Hardware store', 'Store'], place_link: `https://www.google.com/maps/place/data=!1s0x${i}`,
    is_permanently_closed: false, ...extra,
  };
}

/** A fetch that answers search_maps like scraper.tech, from a query → rows table. */
function fakeFetch(answer: (query: string, limit: string) => unknown, calls: Array<Record<string, string>> = []): typeof fetch {
  return (async (url: string, init: RequestInit) => {
    assert.equal(url, 'https://mcp.example/k123');
    const args = JSON.parse(String(init.body)).params.arguments as Record<string, string>;
    calls.push(args);
    const data = answer(args.query!, args.limit!);
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: JSON.stringify(data) }] } }));
  }) as unknown as typeof fetch;
}

test('config reads the vault key name and stays idle without it', () => {
  assert.equal(resolveConfig({}).key, '');
  assert.equal(resolveConfig({ SCRAPER_TECH_KEY: ' abc ' }).key, 'abc');
  assert.equal(resolveConfig({}).baseUrl, 'https://mcp.scraper.tech');
});

test('a row maps onto the gmap.mjs business shape and keys on place_id', () => {
  const b = toBusiness(row(7));
  assert.deepEqual(b, {
    name: 'Biz 7 Sdn Bhd Trading', rating: 4.5, reviews: 12, category: 'Hardware store',
    address: '7, Jalan Sagu 18, Taman Daya, 81100 Johor Bahru, Johor', phone: '+6071234567',
    website: null, mapsUrl: 'https://www.google.com/maps/place/data=!1s0x7', place_id: 'ChIJplace7',
  });
  assert.equal(scanPlaceKey(b), 'ChIJplace7');
});

test('a keyword search is one call with the limit capped at 500', async () => {
  const calls: Array<Record<string, string>> = [];
  const result = await scan({ keyword: 'solar installer', place: 'Taman Daya, Tebrau, Johor', max: 900 }, config,
    fakeFetch(() => ({ status: 'ok', data: [row(1), row(2), row(2), row(3, { is_permanently_closed: true })] }), calls));
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.query, 'solar installer in Taman Daya, Tebrau, Johor');
  assert.equal(calls[0]!.limit, '500');
  assert.equal(calls[0]!.country, 'my');
  assert.equal(result.found, 2, 'duplicates and closed places are dropped');
  assert.equal(result.blocked, false);
  assert.equal(result.requests, 1);
  assert.equal(result.storage, 'hub');
});

test('no rows is found 0, not a block', async () => {
  const result = await scan({ keyword: 'solar installer', place: 'Eco Business Park II' }, config,
    fakeFetch(() => ({ status: 'ok', data: [] })));
  assert.equal(result.found, 0);
  assert.equal(result.blocked, false);
  assert.deepEqual(result.businesses, []);
});

test('a location-only search sweeps keywords until max is reached', async () => {
  const calls: Array<Record<string, string>> = [];
  let next = 0;
  // Each keyword returns 60 places, 10 of them already seen.
  const result = await scan({ keyword: 'Taman Daya, Tebrau, Johor', searchMode: 'location_only', originalPlace: 'Taman Daya, Tebrau, Johor', max: 300 }, config,
    fakeFetch(() => {
      const rows = Array.from({ length: 50 }, () => row(next++));
      return { status: 'ok', data: [...rows, ...Array.from({ length: 10 }, (_, i) => row(i))] };
    }, calls));
  assert.equal(calls[0]!.query, `${FAMILIES.business![0]} in Taman Daya, Tebrau, Johor`);
  assert.ok(calls.every((c) => c.limit === '500'));
  // 6 keywords per batch, 50 new each: the first batch reaches 300.
  assert.equal(calls.length, 6);
  assert.equal(result.found, 300);
  assert.equal(result.capped, true);
  assert.equal(result.place, 'Taman Daya, Tebrau, Johor');
  assert.equal(result.keyword, '');
  assert.equal((result.categories as unknown[]).length, 6);
});

test('a non-ok answer fails the scan instead of reading as zero', async () => {
  await assert.rejects(
    searchMaps(config, 'factory in Taman Daya', 500, fakeFetch(() => ({ status: 'error', message: 'quota exceeded' }))),
    /quota exceeded/,
  );
});

test('a dropped connection is retried once', async () => {
  let n = 0;
  const flaky = (async (url: string, init: RequestInit) => {
    if (n++ === 0) throw new TypeError('fetch failed');
    return fakeFetch(() => ({ status: 'ok', data: [row(1)] }))(url, init);
  }) as unknown as typeof fetch;
  assert.equal((await searchMaps(config, 'q', 500, flaky)).length, 1);
  assert.equal(n, 2);
});

test('an address that repeats the business name loses the prefix', () => {
  const b = toBusiness(row(3, { name: 'KULAI RS HARDWARE', full_address: 'KULAI RS HARDWARE, No.292, Jln Lagenda 20, 81000 Kulai, Johor' }));
  assert.equal(b.address, 'No.292, Jln Lagenda 20, 81000 Kulai, Johor');
});

test('business, factory and shop sweep their family; other keywords do not', () => {
  assert.equal(familyFor('Factory'), FAMILIES.factory);
  assert.equal(familyFor(' shop '), FAMILIES.shop);
  assert.equal(familyFor('business'), FAMILIES.business);
  assert.equal(familyFor(''), FAMILIES.business);
  assert.equal(familyFor('Zhin Heng Hardware Sdn Bhd'), null);
  for (const word of [...FAMILIES.factory!, ...FAMILIES.shop!]) assert.ok(FAMILIES.business!.includes(word), word);
  assert.equal(new Set(FAMILIES.business).size, FAMILIES.business!.length);
});

test('a factory scan runs the whole family and keeps only rows in the place', async () => {
  const calls: Array<Record<string, string>> = [];
  let next = 0;
  const result = await scan({ keyword: 'factory', place: 'Taman Daya, Tebrau, Johor', max: 2000 }, config,
    fakeFetch(() => ({ status: 'ok', data: [
      row(next++), row(next++),
      row(next++, { full_address: 'No 3, Jalan Molek 1, Taman Molek, 81100 Johor Bahru, Johor' }),
    ] }), calls));
  assert.equal(calls.length, FAMILIES.factory!.length);
  assert.deepEqual(calls.map((c) => c.query), FAMILIES.factory!.map((w) => `${w} in Taman Daya, Tebrau, Johor`));
  assert.equal(result.found, FAMILIES.factory!.length * 2);
  assert.equal(result.outsideArea, FAMILIES.factory!.length);
  assert.equal(result.requests, FAMILIES.factory!.length);
  assert.equal(result.query, 'factory in Taman Daya, Tebrau, Johor');
});

test('the area filter matches without spaces and backs off when the name is not used', () => {
  assert.deepEqual(areaNames('Wadi Hana / Bukit Chagar / Tanjung Puteri, Johor Bahru, Johor'), ['wadihana', 'bukitchagar', 'tanjungputeri']);
  const at = (address: string) => toBusiness(row(1, { full_address: address, name: 'X' }));
  const ss5 = inArea([at('14A, Jalan SS 5B/4, Petaling Jaya'), at('1, Jalan SS 7/26, Petaling Jaya')], 'SS5, Petaling Jaya Central, Selangor');
  assert.equal(ss5.kept.length, 1);
  assert.equal(ss5.outside, 1);
  // Only 1 of 4 names the place: Google does not write addresses with that name, keep all.
  const loose = inArea([at('Taman Daya'), at('Jalan A'), at('Jalan B'), at('Jalan C')], 'Taman Daya, Johor');
  assert.equal(loose.kept.length, 4);
  assert.equal(loose.outside, 0);
});

test('streets come from whole address segments, busiest first', () => {
  const at = (address: string) => toBusiness(row(1, { full_address: address, name: 'X' }));
  assert.deepEqual(streetsOf([
    at('2-10, Jln Sagu 29, Taman Daya, 81100 Johor Bahru'),
    at('6, Jalan Sagu 18, Taman Daya, 81100 Johor Bahru'),
    at('7, Jalan  Sagu 18, Taman Daya'),
    at('No 1, Taman Daya'),
  ]), ['Jalan Sagu 18', 'Jalan Sagu 29']);
});

test('a business scan searches each street it found, twice, and only business does', async () => {
  const calls: Array<Record<string, string>> = [];
  let next = 0;
  const answer = (query: string) => {
    if (/^(shop|company) in Jalan /.test(query)) return { status: 'ok', data: [row(1000 + next++, { full_address: `9, ${query.split(' in ')[1]!.split(',')[0]}, Taman Daya, Johor` })] };
    return { status: 'ok', data: [row(1), row(2, { full_address: '2, Jln Sagu 29, Taman Daya, Johor' })] };
  };
  const result = await scan({ keyword: 'business', place: 'Taman Daya, Tebrau, Johor', max: 2000 }, config, fakeFetch(answer, calls));
  const streetCalls = calls.filter((c) => / in Jalan /.test(c.query!));
  // row(1) is on Jalan Sagu 18 and row(2) on Jalan Sagu 29: two streets, two forms each.
  assert.deepEqual(streetCalls.map((c) => c.query).sort(), [
    'company in Jalan Sagu 18, Taman Daya, Tebrau, Johor', 'company in Jalan Sagu 29, Taman Daya, Tebrau, Johor',
    'shop in Jalan Sagu 18, Taman Daya, Tebrau, Johor', 'shop in Jalan Sagu 29, Taman Daya, Tebrau, Johor',
  ]);
  assert.deepEqual(result.streets, { total: 2, searched: 2, added: 4 });
  assert.equal(result.found, 6);
  assert.equal(result.requests, FAMILIES.business!.length + 4);

  const factoryCalls: Array<Record<string, string>> = [];
  const factory = await scan({ keyword: 'factory', place: 'Taman Daya, Tebrau, Johor', max: 2000 }, config, fakeFetch(answer, factoryCalls));
  assert.equal(factory.streets, null);
  assert.equal(factoryCalls.length, FAMILIES.factory!.length);
});

test('the street pass stops at the deadline and keeps what it has', async () => {
  const calls: Array<Record<string, string>> = [];
  const result = await scan({ keyword: 'business', place: 'Taman Daya, Tebrau, Johor', max: 2000 }, config,
    fakeFetch(() => ({ status: 'ok', data: [row(1)] }), calls), { deadline: Date.now() - 1 });
  assert.equal(calls.length, FAMILIES.business!.length);
  assert.deepEqual(result.streets, { total: 1, searched: 0, added: 0 });
  assert.equal(result.found, 1);
});

test('a sweep retries a failed search once, then skips it and keeps the scan', async () => {
  const tries = new Map<string, number>();
  const result = await scan({ keyword: 'factory', place: 'Taman Daya, Tebrau, Johor', max: 2000 }, config, fakeFetch((query) => {
    tries.set(query, (tries.get(query) ?? 0) + 1);
    return query.startsWith('steel in') ? { status: 'failed', data: [] } : { status: 'ok', data: [row(1)] };
  }));
  assert.equal(tries.get('steel in Taman Daya, Tebrau, Johor'), 2);
  assert.deepEqual(result.skippedSearches, ['steel in Taman Daya, Tebrau, Johor']);
  assert.equal(result.found, 1);
  // Every call counts toward the budget, the retry included.
  assert.equal(result.requests, FAMILIES.factory!.length + 1);
});

test('a sweep where too many searches fail fails, and says how many requests it spent', async () => {
  let err: { message?: string; requests?: number } | null = null;
  try {
    await scan({ keyword: 'factory', place: 'Taman Daya, Tebrau, Johor', max: 2000 }, config,
      fakeFetch(() => ({ status: 'failed', data: [] })));
  } catch (e) {
    err = e as { message?: string; requests?: number };
  }
  assert.match(String(err?.message), /searches failed/);
  // The first batch of 6 words, each tried twice.
  assert.equal(err?.requests, 12);
});

test('a rate limit stops the sweep at once instead of being skipped', async () => {
  const limited = (async () => new Response('slow down', { status: 429 })) as unknown as typeof fetch;
  await assert.rejects(scan({ keyword: 'factory', place: 'Taman Daya, Tebrau, Johor', max: 2000 }, config, limited), (e: { code?: string }) => e.code === 'rate_limit');
});

test('garbled street segments are not searched', () => {
  const at = (address: string) => toBusiness(row(1, { full_address: address, name: 'X' }));
  assert.deepEqual(streetsOf([
    at('5, Jalan Bukit Perdana 2/5, Taman Bukit Perdana, 83000 Batu Pahat, Johor'),
    at('Jalan bukit perdana 2/573 jalan bukit perdana 2/5邮政编码: 83000, Taman Bukit Perdana'),
    at('Jalan Bukit Perdana 2/3Taman Bukit Perdana邮政编码: 86000'),
  ]), ['Jalan Bukit Perdana 2/5']);
});
