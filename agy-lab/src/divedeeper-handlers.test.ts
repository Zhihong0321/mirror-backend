// Offline lane tests: no hub, paid search keys, production access or live worker.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { makeCtx, writeLane, laneFile } from './divedeeper/lib.ts';
import { lookupCompany } from './divedeeper/site-handlers.ts';
import { run as credibility } from './divedeeper/sections/K-credibility.ts';
import { run as news } from './divedeeper/sections/N-news.ts';
import { run as registry } from './divedeeper/sections/D-registry.ts';

const K_IDS = ['MY-bnm.gov.my/w1', 'MY-bnm.gov.my/w2', 'MY-bnm.gov.my/w3', 'MY-sc.com.my/w2',
  'MY-kehakiman.gov.my/w1', 'MY-myprocurement.treasury.gov.my/w1', 'MY-eperolehan.gov.my/w1', 'MY-ransomlook.io/w1'];
const LOWYAT = 'MY-forum.lowyat.net/w1';
const LEGAL = 'Acme Logistics Sdn Bhd';
function dive() {
  return { company: 'Acme', result: { identity: { legal_name: LEGAL, aliases: ['Acme'], industry: 'Logistics', address: 'Johor', official_domains: ['acme.test'], registration_numbers: [] },
    facts: [], sources: [], people: { people: [{ name: 'Known Person', role: 'Director' }] } },
    v21: { lookups: {} as Record<string, any>, claims: { claimed_credentials: [] as string[], claimed_numbers: [] as string[] }, pages: [{ url: 'https://acme.test/', text: 'Saved official page' }] } };
}
function context(v21 = true) {
  const ctx = makeCtx(randomUUID(), 'test', 'handlers', v21 ? { worker: 'myworker' } : undefined);
  ctx.log = () => {};
  ctx.warn = (s) => { ctx.warnings.push(s); };
  ctx.exa = async () => [];
  ctx.brave = async () => [];
  ctx.page = async () => assert.fail('unexpected direct register or official page read');
  ctx.read = async () => assert.fail('unexpected worker page read');
  ctx.lookup = async () => assert.fail('unexpected lookup');
  ctx.llm = async () => assert.fail('unexpected LLM call');
  return ctx;
}
function answer(handler: string, status = 'found', extra: Record<string, unknown> = {}) {
  return { handler, version: 'test', status, reason: '', source_url: `https://${handler.slice(3).split('/')[0]}/`,
    records: status === 'found' ? [{ company: LEGAL, record: 'WORKER RECORD' }] : [], excerpt: '', ...extra };
}
// V2.1 uses the key people from Step 2's people list (owner, 2026-11-11): the fixture has one, so no skip warning.
const hasPeopleWarning = (warnings: string[]) => assert.equal(warnings.filter((w) => /person searches are skipped/.test(w)).length, 0);

test('K uses the eight handler ids, reuses Step 1, retries only name misses, and classifies worker evidence', async () => {
  const d = dive(), ctx = context();
  d.v21.lookups[K_IDS[0]] = answer(K_IDS[0], 'not_found');
  const calls: string[][] = [], prompts: string[] = [], reads: string[] = [];
  ctx.lookup = async (id, keyword) => {
    calls.push([id, keyword]);
    if (id === K_IDS[1]) return answer(id, 'couldnt_check', { reason: 'regulator blocked' });
    if (id === K_IDS[4]) throw new Error('court worker offline');
    if (id === K_IDS[5] && keyword === LEGAL || id === K_IDS[6]) return answer(id, 'not_found');
    return answer(id);
  };
  ctx.brave = async (q) => {
    assert.equal(q, `"${LEGAL}" site:gov.my`);
    return [{ url: 'https://ministry.gov.my/award', description: 'SEARCH SNIPPET POISON', extra_snippets: ['EXTRA POISON'] },
      { url: 'https://ministry.gov.my/unread', description: 'SEARCH SNIPPET POISON' }];
  };
  ctx.read = async (url) => { reads.push(url); return { url, finalUrl: url, status: url.endsWith('unread') ? 503 : 200, text: 'Acme: WORKER GOVERNMENT PAGE', via: 'test-worker' }; };
  ctx.llm = async (prompt) => {
    prompts.push(prompt);
    assert.doesNotMatch(prompt, /POISON/);
    assert.match(prompt, /WORKER RECORD/);
    assert.match(prompt, /WORKER GOVERNMENT PAGE/);
    return JSON.stringify({ items: [...prompt.matchAll(/^#(\d+) \[([^\]]+)\]/gm)].map((m) => ({ i: Number(m[1]), about: 'company',
      category: m[2] === 'security' ? 'security' : m[2] === 'sc' ? 'licence' : m[2] === 'bnm-consumer' ? 'alert' : 'government',
      outcome: 'Worker evidence names Acme', sentiment: 'neutral', year: '2026' })) });
  };
  const out = await credibility(ctx, d);
  assert.deepEqual(calls, [
    [K_IDS[1], LEGAL], [K_IDS[2], LEGAL], [K_IDS[3], LEGAL], [K_IDS[4], LEGAL],
    [K_IDS[5], LEGAL], [K_IDS[5], 'Acme'], [K_IDS[6], LEGAL], [K_IDS[6], 'Acme'], [K_IDS[7], LEGAL],
  ]);
  assert.equal(reads.length, 2);
  assert.equal(prompts.length, 1);
  const checks = out.notes.checks as any[];
  assert.equal(checks.find((c) => c.id === 'bnm').result, 'clear');
  for (const id of ['fca', 'court', 'gov']) assert.equal(checks.find((c) => c.id === id).result, 'could_not_check');
  assert.match(checks.find((c) => c.id === 'fca').detail, /can't check automatically.*regulator blocked/);
  assert.match(checks.find((c) => c.id === 'court').detail, /can't check automatically.*court worker offline/);
  assert.match(checks.find((c) => c.id === 'bursa').detail, /skipped.*Sdn Bhd/);
  for (const id of ['insolvency', 'trademark']) assert.equal(out.findings.filter((f) => f.check === `cred-${id}`).length, 1);
  assert.ok(out.findings.some((f) => f.check === 'cred-security'));
  assert.ok(out.findings.some((f) => f.check === 'cred-licence'));
  assert.deepEqual(out.notes.people, out.notes.people.length && typeof out.notes.people[0] === 'string' ? ['Known Person'] : [{ name: 'Known Person', role: 'Director' }]);
  hasPeopleWarning(ctx.warnings);
});

test('K never calls a Step 1 handler again, including empty and failed checks', async () => {
  const d = dive(), ctx = context();
  K_IDS.forEach((id, i) => { d.v21.lookups[id] = answer(id, i % 2 ? 'couldnt_check' : 'not_found', { reason: 'saved check blocked' }); });
  const out = await credibility(ctx, d);
  assert.equal((out.notes.handler_results as any[]).length, 8);
  assert.ok(out.findings.some((f) => /CAN'T CHECK AUTOMATICALLY/.test(f.title)));
});

test('N reads at most twenty unique addresses, ranks recent relevant pages, adds Lowyat and validates quotes against worker text', async () => {
  const d = dive(), ctx = context(), reads: string[] = [], queries: string[] = [];
  d.v21.lookups[LOWYAT] = answer(LOWYAT, 'found', { records: [{ url: 'https://forum.lowyat.net/topic/1', title: 'Acme dispute', record: 'WORKER FORUM RECORD' }] });
  const rows = Array.from({ length: 25 }, (_, i) => ({ url: `https://news.test/${i + 1}`, title: `Search title for Acme page ${i + 1}`, text: 'EXA POISON',
    publishedDate: `2026-10-${String(i + 1).padStart(2, '0')}` }));
  ctx.exa = async (q, opts) => { queries.push(q); assert.equal(opts?.text, undefined); assert.equal(opts?.category, 'news'); return rows; };
  ctx.brave = async (q) => { queries.push(q); return [{ ...rows[0], description: 'BRAVE POISON', extra_snippets: ['EXTRA POISON'] }, { url: 'https://acme.test/own', title: 'Acme' }]; };
  ctx.read = async (url) => { reads.push(url); return { url, finalUrl: url, status: 200, text: `Acme: WORKER PAGE ${url}. Worker quote for Acme.`, via: 'test-worker' }; };
  ctx.llm = async (prompt) => {
    assert.doesNotMatch(prompt, /POISON/);
    assert.match(prompt, /WORKER PAGE/);
    return JSON.stringify({ items: [...prompt.matchAll(/^#(\d+) \| (.*?) \| (.*?) \|/gm)].map((m) => ({
      i: Number(m[1]), about: 'company', kind: 'news', sentiment: 'neutral', date: '2026-10-25', summary: 'Read page mentions Acme',
      quote: m[3] === 'https://news.test/25' ? m[2] : 'Worker quote for Acme.',
    })) });
  };
  const out = await news(ctx, d);
  assert.equal(reads.length, 20);
  assert.equal(new Set(reads).size, 20);
  assert.deepEqual(reads.slice(0, 3), ['https://forum.lowyat.net/topic/1', 'https://news.test/25', 'https://news.test/24']);
  assert.ok(queries.some((q) => q.includes('Known Person')));
  const items = out.notes.items as any[];
  assert.equal(items.find((x) => x.url === 'https://forum.lowyat.net/topic/1').kind, 'forum');
  assert.equal(items.find((x) => x.url === 'https://news.test/25').quote, '', 'a search title cannot pass the quote check');
  assert.ok(items.some((x) => x.quote === 'Worker quote for Acme.'));
  assert.equal(out.notes.unjudged, 6);
  assert.deepEqual(out.notes.people, out.notes.people.length && typeof out.notes.people[0] === 'string' ? ['Known Person'] : [{ name: 'Known Person', role: 'Director' }]);
  hasPeopleWarning(ctx.warnings);
});

test('N fetches Lowyat with the legal then short name only on a miss', async () => {
  const d = dive(), ctx = context(), calls: string[][] = [];
  ctx.lookup = async (id, keyword) => { calls.push([id, keyword]); return answer(id, 'not_found'); };
  await news(ctx, d);
  assert.deepEqual(calls, [[LOWYAT, LEGAL], [LOWYAT, 'Acme']]);
});

test('N reports saved could-not-check and fresh handler failures without absence claims', async () => {
  for (const saved of [true, false]) {
    const d = dive(), ctx = context();
    if (saved) d.v21.lookups[LOWYAT] = answer(LOWYAT, 'couldnt_check', { reason: 'forum blocked' });
    else ctx.lookup = async () => { throw new Error('forum offline'); };
    const out = await news(ctx, d);
    assert.ok(out.findings.some((f) => /CAN'T CHECK AUTOMATICALLY/.test(f.title) && /forum (blocked|offline)/.test(f.detail)));
    assert.ok(!out.findings.some((f) => /No news|Nobody discusses/.test(f.title)));
    hasPeopleWarning(ctx.warnings);
  }
});

test('N reports unread pages and discards their snippets instead of feeding them to the judge', async () => {
  const d = dive(), ctx = context();
  d.v21.lookups[LOWYAT] = answer(LOWYAT, 'not_found');
  ctx.brave = async () => [{ url: 'https://news.test/failed', title: 'Acme', description: 'POISON' }];
  ctx.read = async (url) => ({ url, finalUrl: url, status: 0, text: '', error: 'worker offline', via: 'test-worker' });
  const out = await news(ctx, d);
  assert.equal(out.notes.unjudged, 1);
  assert.deepEqual(out.notes.items, []);
  assert.match(ctx.warnings.join(' '), /can't check automatically.*worker offline/);
  assert.ok(!out.findings.some((f) => /No news|Nobody discusses/.test(f.title)));
});

test('D uses saved claims, selects handlers once, reuses checks and compares only scrubbed worker records', async () => {
  const d = dive(), ctx = context(), calls: string[][] = [], prompts: string[] = [];
  d.v21.claims = { claimed_credentials: ['Customs forwarding licence', 'FMFF membership', 'ISO certified', 'Capital Markets licence', 'CIDB G7', 'MyIPO trademark', 'SC registered person'], claimed_numbers: ['500 projects'] };
  d.v21.lookups['MY-customs.gov.my/w1'] = answer('MY-customs.gov.my/w1', 'found', {
    records: [{ company: LEGAL, licence: 'WORKER CUSTOMS LICENCE', mykad: '901010101234', email: 'staff@private.test', mobile: '0123456789', contact_name: 'Private Contact' }],
    excerpt: 'WORKER EXCERPT, staff@private.test, 901010-10-1234',
  });
  const choices = [
    ['CUSTOMS', 'MY-customs.gov.my/w1'], ['FMFF', 'MY-fmff.net/w1'], ['ISO', null], ['SC', 'MY-sc.com.my/w2'],
    ['CIDB', 'MY-missing-register/w1'], ['MYIPO', 'MY-myipo.gov.my/w1'], ['SC', 'MY-sc.com.my/w2'], ['SELF_COUNT', null],
  ];
  ctx.lookup = async (id, keyword) => {
    calls.push([id, keyword]);
    if (id === 'MY-fmff.net/w1') return answer(id, 'couldnt_check', { reason: 'membership page blocked' });
    if (id === 'MY-sc.com.my/w2') throw new Error('licence worker offline');
    assert.fail(`unexpected handler ${id}`);
  };
  ctx.llm = async (prompt) => {
    prompts.push(prompt);
    assert.doesNotMatch(prompt, /Saved official page|901010|staff@private|Private Contact|0123456789/);
    if (prompts.length === 1) {
      assert.match(prompt, /ISO certified/);
      assert.match(prompt, /500 projects/);
      assert.match(prompt, /MY-customs.gov.my\/w1/);
      assert.match(prompt, /Customs Agent License/);
      return JSON.stringify({ claims: choices.map(([issuer, handler], i) => ({ id: `C${String(i + 1).padStart(2, '0')}`, issuer, handler, reason: handler ? '' : 'no matching public handler', value: '' })) });
    }
    assert.match(prompt, /WORKER CUSTOMS LICENCE/);
    assert.match(prompt, /WORKER EXCERPT/);
    assert.doesNotMatch(prompt, /membership page blocked|licence worker offline/);
    return JSON.stringify({ results: [{ id: 'C01', verdict: 'verified', why: 'Customs record confirms the licence', disagreements: [] }] });
  };
  const out = await registry(ctx, d);
  assert.equal(prompts.length, 2);
  assert.deepEqual(calls, [['MY-fmff.net/w1', LEGAL], ['MY-sc.com.my/w2', LEGAL]]);
  const claims = out.findings.filter((f) => f.claim_id);
  assert.equal(claims[0].verdict, 'verified');
  assert.ok(claims.slice(1).every((f) => f.verdict === "can't check automatically"));
  assert.match(String(claims[4].detail), /no site handler exists/);
  assert.match(String(claims[5].detail), /blocked|login|account/i);
  assert.doesNotMatch(JSON.stringify(out), /901010|staff@private|Private Contact|0123456789/);
  assert.ok(out.findings.some((f) => f.private === true));
  assert.deepEqual(out.notes.pages_read, []);
  hasPeopleWarning(ctx.warnings);
});

test('D distinguishes explicit not-found, contradiction and missing comparison', async () => {
  for (const verdict of ['contradicted', 'cant_check', 'bad-json', 'omitted', 'not_found']) {
    const d = dive(), ctx = context();
    d.v21.claims.claimed_credentials = ['SC Capital Markets licence'];
    d.v21.lookups['MY-sc.com.my/w2'] = answer('MY-sc.com.my/w2', verdict === 'not_found' ? 'not_found' : 'found');
    let n = 0;
    ctx.llm = async () => ++n === 1 ? JSON.stringify({ claims: [{ id: 'C01', issuer: 'SC', handler: 'MY-sc.com.my/w2' }] })
      : verdict === 'bad-json' ? 'not json' : JSON.stringify({ results: verdict === 'omitted' ? [] : [{ id: 'C01', verdict, why: 'Record comparison' }] });
    const out = await registry(ctx, d);
    assert.equal(out.findings[0].verdict, verdict === 'contradicted' ? 'contradicted' : verdict === 'not_found' ? 'not found' : "can't check automatically");
    assert.equal(n, verdict === 'not_found' ? 1 : 2);
  }
});

test('D handles a malformed handler-selection answer without a new site read', async () => {
  const d = dive(), ctx = context();
  d.v21.claims.claimed_credentials = ['Unknown award'];
  ctx.llm = async () => '{"claims":{}}';
  const out = await registry(ctx, d);
  assert.equal(out.findings[0].verdict, "can't check automatically");
});

test('shared checks deduplicate calls across lanes and respect legal-name-only questions', async () => {
  const d = dive(), ctx = context(), calls: string[][] = [];
  ctx.lookup = async (id, keyword) => { calls.push([id, keyword]); return answer(id, 'not_found'); };
  await Promise.all([lookupCompany(ctx, d, K_IDS[5]), lookupCompany(ctx, d, K_IDS[5])]);
  await lookupCompany(ctx, d, K_IDS[5]);
  await lookupCompany(ctx, d, 'MY-ssmsearch.com/w1');
  assert.deepEqual(calls, [[K_IDS[5], LEGAL], [K_IDS[5], 'Acme'], ['MY-ssmsearch.com/w1', LEGAL]]);
});

test('legacy K and N retain snippet evidence and person searches and never call a handler', async () => {
  for (const lane of [credibility, news]) {
    const d = dive(), ctx = context(false), queries: string[] = [], prompts: string[] = [];
    ctx.page = async (url) => ({ url, finalUrl: url, status: 200, html: 'Acme homepage', headers: {}, redirects: [], ms: 0 });
    ctx.exa = async (q, opts) => { queries.push(q); assert.equal(opts?.text, 2500); return [{ url: 'https://outside.test/story', title: 'Acme', text: 'LEGACY SEARCH TEXT: Acme' }]; };
    ctx.brave = async (q) => { queries.push(q); return [{ url: 'https://outside.test/story', title: 'Acme', description: 'LEGACY SEARCH TEXT: Acme' }]; };
    ctx.llm = async (prompt) => { prompts.push(prompt); return '{"items":[]}'; };
    const out = await lane(ctx, d);
    assert.ok(queries.some((q) => q.includes('Known Person')));
    assert.ok(prompts.length);
    assert.ok(prompts.every((p) => p.includes('LEGACY SEARCH TEXT')));
    assert.equal(ctx.warnings.length, 0);
    assert.ok(!Object.hasOwn(out.notes, 'handler_results') && !Object.hasOwn(out.notes, 'lowyat'));
  }
});

test('legacy D uses the claim cache and its register POST form, without a handler or Step 2 claims', async () => {
  const d = dive(), ctx = context(false), pages: { url: string; method?: string }[] = [];
  d.v21.claims.claimed_credentials = ['V21 CLAIM MUST NOT BE USED'];
  const cache = { claims: [{ id: 'C01', claim: 'Legacy insurance cover', kind: 'certificate', issuer: 'INSURER', value: '', where: [], quote: '' }], pages: [], selfGrades: [] };
  const previous = { only: process.env.D_ONLY, fresh: process.env.D_FRESH_CLAIMS };
  delete process.env.D_ONLY;
  delete process.env.D_FRESH_CLAIMS;
  writeLane(ctx.diveId, 'D-claims', cache, 2);
  try {
    ctx.page = async (url, init) => { pages.push({ url, method: init?.method }); return { url, finalUrl: url, status: 200, html: '', headers: {}, redirects: [], ms: 0 }; };
    const out = await registry(ctx, d);
    assert.ok(pages.some((p) => /cims.cidb.gov.my/.test(p.url) && p.method === 'POST'));
    assert.deepEqual(out.notes.claims, cache.claims);
    assert.ok(out.findings.some((f) => f.claim === 'Legacy insurance cover'));
    assert.doesNotMatch(JSON.stringify(out), /V21 CLAIM MUST NOT BE USED/);
    assert.equal(ctx.warnings.length, 0);
  } finally {
    await fs.unlink(laneFile(ctx.diveId, 'D-claims'));
    for (const [name, value] of [['D_ONLY', previous.only], ['D_FRESH_CLAIMS', previous.fresh]]) {
      if (value === undefined) delete process.env[name!]; else process.env[name!] = value;
    }
  }
});
