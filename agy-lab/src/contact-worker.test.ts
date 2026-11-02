import test from 'node:test';
import assert from 'node:assert/strict';
import * as jobs from './jobs.ts';
import * as pi from './core/pi.ts';
import {
  JOB_TYPE,
  WORKER_NAME,
  contactText,
  createKeyPool,
  extractContactsPrompt,
  laneName,
  preparePages,
  readPages,
  research,
  resolveConfig,
  targetFromPayload,
  tavilySearch,
  toResearchResult,
  linkedinSearch,
  unusablePhone,
  unusableEmail,
  printedName,
  groundExtracted,
  extractContactsPrompt as promptFor,
  pickGeneral,
} from './contact-worker.ts';
import * as exaApi from './core/exa.ts';
import * as tavilyApi from './core/tavily.ts';

// Search keys come from core, as on the hub. Each search gets keys of its own,
// so a key one test rests never carries into the next.
let keyN = 0;
function freshKeys(withExa = false): void {
  keyN++;
  tavilyApi.setKeysForTests([`tvly-test-${keyN}`]);
  exaApi.setKeysForTests(withExa ? [`exa-test-${keyN}`] : []);
}

test('pi contact lanes register under the hub worker name', () => {
  assert.equal(JOB_TYPE, 'research.contact.pi');
  assert.equal(laneName(0), WORKER_NAME);
  assert.equal(laneName(1), 'pi-contact-2');
  assert.equal(resolveConfig({ CONTACT_LANES: '2' }).lanes, 2);
  assert.equal(resolveConfig({}).lanes, 8);
});

test('extract prompt keeps a printed title for any business and carries the page text', () => {
  const prompt = extractContactsPrompt(
    targetFromPayload({ name: 'Acme Bakery', location: 'Johor Bahru' }),
    [{ url: 'https://acme-bakery.example/about', text: 'Siti Aminah, Owner' }],
  );
  assert.match(prompt, /Head of Purchasing/);
  assert.match(prompt, /<page url="https:\/\/acme-bakery\.example\/about">\nSiti Aminah, Owner\n<\/page>/);
  assert.doesNotMatch(prompt, /lawyer|advocate|solicitor/i);
});

test('the hub gives a pi contact job to the pi worker', async () => {
  jobs.touch('local-research', '203.0.113.8', ['research.contact']);
  jobs.touch(WORKER_NAME, '127.0.0.1', [JOB_TYPE]);
  const job = jobs.create(JOB_TYPE, { name: 'Acme Bakery', reportId: 'report-1' }, 0);
  assert.equal(await jobs.take('local-research', { types: ['research.contact'], waitMs: 0 }), null);
  const claimed = await jobs.take(WORKER_NAME, { types: [JOB_TYPE], waitMs: 0 });
  assert.equal(claimed?.id, job.id);
  assert.equal(claimed?.worker, WORKER_NAME);
  assert.equal(jobs.liveTypes().includes(JOB_TYPE), true);
  jobs.finish(job.id, true, { ok: true }, null);
});

test('each tavily key runs at most two calls at once', async () => {
  const pool = createKeyPool();
  pool.setKeys(['key-a', 'key-b']);
  let highest = 0;
  const active = new Map<string, number>();
  await Promise.all(Array.from({ length: 8 }, async () => {
    const lease = await pool.acquire();
    const now = (active.get(lease.secret) ?? 0) + 1;
    active.set(lease.secret, now);
    highest = Math.max(highest, now);
    await new Promise((resolve) => setTimeout(resolve, 20));
    active.set(lease.secret, (active.get(lease.secret) ?? 1) - 1);
    lease.release();
  }));
  assert.equal(highest, 2);
});

test('research runs tavily find, reads the pages, then pi extracts with no tools', async () => {
  const tavilyQueries: string[] = [];
  const fetched: string[] = [];
  const fetchMock: typeof fetch = async (url, init) => {
    const href = String(url);
    if (href.includes('api.tavily.com')) {
      tavilyQueries.push(JSON.parse(String(init?.body ?? '{}')).query);
      return new Response(JSON.stringify({
        results: [
          { title: 'Acme Bakery About Us', url: 'https://acme-bakery.example/about', content: 'Acme Bakery in Johor Bahru. Siti Aminah is Owner.' },
          { title: 'Jobstreet', url: 'https://www.jobstreet.com.my/job/9', content: 'Ad' },
        ],
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    fetched.push(href);
    return new Response('<html><body><h1>About</h1><p>Siti Aminah, Owner. Mobile 07-555 0101. hello@acme-bakery.example</p><script>x()</script></body></html>', {
      status: 200, headers: { 'content-type': 'text/html' },
    });
  };
  const prompts: Array<{ prompt: string; tools: boolean }> = [];
  pi.setRunnerForTests(async (prompt, opts) => {
    prompts.push({ prompt, tools: opts.tools });
    return '{"people":[{"name":"Siti Aminah","position":"Owner","evidence_url":"https://acme-bakery.example/about"}],"phones":[{"number":"07-555 0101","label":"Siti Aminah mobile","evidence_url":"https://acme-bakery.example/contact"}],"emails":[{"email":"hello@acme-bakery.example","label":"General","evidence_url":"https://acme-bakery.example/contact"}]}';
  });
  try {
    freshKeys();
    const result = await research({
      name: 'Acme Bakery',
      location: '12 Jalan Example, Johor Bahru',
      website: 'https://acme-bakery.example/contact',
    }, { fetchImpl: fetchMock });

    assert.equal(tavilyQueries.length, 2);
    assert.match(tavilyQueries[0]!, /Acme Bakery.*Johor Bahru/);
    assert.match(tavilyQueries[1]!, /phone email contact/);
    assert.deepEqual(fetched.sort(), ['https://acme-bakery.example/about', 'https://acme-bakery.example/contact']);
    assert.equal(prompts.length, 1);
    assert.equal(prompts[0]!.tools, false);
    assert.match(prompts[0]!.prompt, /Siti Aminah, Owner\. Mobile 07-555 0101/);
    assert.doesNotMatch(prompts[0]!.prompt, /x\(\)/);

    const people = result.decision_makers as Array<Record<string, unknown>>;
    assert.equal(people[0]?.name, 'Siti Aminah');
    assert.equal(people[0]?.role, 'Owner');
    assert.equal(people[0]?.direct_phone, '07-555 0101');
    assert.equal((result.email_contacts as Array<Record<string, unknown>>)[0]?.email, 'hello@acme-bakery.example');
    const meta = result.research_meta as Record<string, unknown>;
    assert.match(String(meta.engine), /tavily \+ pi\//);
  } finally {
    pi.setRunnerForTests(null);
  }
});

test('a key rests below one job of credits and wakes when Tavily reports credits again', async () => {
  const pool = createKeyPool({ concurrency: 1 });
  pool.setKeys(['key-a', 'key-b']);
  pool.setUsage('key-a', 990, 1000);
  pool.setUsage('key-b', 0, 1000);
  assert.equal(pool.slots(), 2);

  // key-a spends to 997: three credits left, less than one contact job.
  pool.spend('key-a', 7);
  assert.equal(pool.slots(), 1);
  const lease = await pool.acquire();
  assert.equal(lease.secret, 'key-b');
  lease.release();

  // A 432 rests key-b too: nothing is left to hand out.
  const quota = await pool.acquire();
  quota.release(0, true);
  assert.equal(pool.slots(), 0);
  assert.deepEqual(pool.stats().map((s) => s.resting), [true, true]);

  // A later /usage read after Tavily's reset wakes the key.
  pool.setUsage('key-b', 0, 1000);
  assert.equal(pool.slots(), 1);
  assert.equal((await pool.acquire()).secret, 'key-b');
});

test('a key with no limit on its plan never rests', () => {
  const pool = createKeyPool({ concurrency: 1 });
  pool.setKeys(['paid']);
  pool.setUsage('paid', 50_000, null);
  pool.spend('paid', 1_000);
  assert.equal(pool.slots(), 1);
});
test('tavily search handles rate limits and quota exceeded error', async () => {
  const fetch429: typeof fetch = async () => new Response('{"error":"usage_limit_reached"}', { status: 429 });
  await assert.rejects(
    () => (freshKeys(), tavilySearch({ name: 'Acme', location: '', website: '', extraUrls: [] }, fetch429)),
    (err: unknown) => {
      assert.match(String(err), /quota/);
      assert.equal((err as { code?: string }).code, 'quota');
      return true;
    },
  );
  const fetchRate: typeof fetch = async () => new Response('{"detail":"too many requests"}', { status: 429 });
  await assert.rejects(
    () => (freshKeys(), tavilySearch({ name: 'Acme', location: '', website: '', extraUrls: [] }, fetchRate)),
    (err: unknown) => (err as { code?: string }).code === 'rate_limit',
  );
  const fetch432: typeof fetch = async () => new Response('{"detail":{"error":"This request exceeds your plan\'s set usage limit."}}', { status: 432 });
  await assert.rejects(
    () => (freshKeys(), tavilySearch({ name: 'Acme', location: '', website: '', extraUrls: [] }, fetch432)),
    (err: unknown) => (err as { code?: string }).code === 'quota',
  );
});

test('tavily search results that mention credit or quota are not a quota error', async () => {
  const fetchOk: typeof fetch = async () => new Response(JSON.stringify({
    query: 'Acme',
    results: [{ url: 'https://www.ctoscredit.com.my/acme', title: 'Acme credit report', content: 'Import quota and credit terms for Acme Sdn Bhd' }],
  }), { status: 200 });
  const out = await (freshKeys(), tavilySearch({ name: 'Acme', location: '', website: '', extraUrls: [] }, fetchOk));
  assert.equal(out.sources.length, 1);
  assert.equal(out.sources[0]?.url, 'https://www.ctoscredit.com.my/acme');
});


test('a returned name, phone, and email are kept even when the citation is not an exact page match', () => {
  const result = toResearchResult(
    { name: 'Kedai', website: '', extraUrls: [], location: 'Johor Bahru' },
    {
      people: [
        { name: '黄文福', position: '东主', evidence_url: 'https://shop.example/about' },
        { name: 'Ali bin Abu', position: 'Manager', evidence_url: 'https://other.example/team' },
      ],
      phones: [{ number: '012-3456789', label: 'Office', evidence_url: 'https://not-listed.example/x' }],
      emails: [{ email: 'ali@shop.example', label: 'Ali', evidence_url: '' }],
    },
    ['https://shop.example/about'],
  );
  const people = result.decision_makers as Array<Record<string, unknown>>;
  assert.deepEqual(people.map((person) => person.name).sort(), ['Ali bin Abu', '黄文福'].sort());
  assert.equal((result.phone_contacts as Array<Record<string, unknown>>)[0]?.number_raw, '012-3456789');
  assert.equal((result.email_contacts as Array<Record<string, unknown>>)[0]?.email, 'ali@shop.example');
});

const boilerplate = Array.from({ length: 40 }, (_, i) => `Clause ${i + 1}. The user agrees that the content of this directory is provided as it is, without warranty of any kind.`);

test('a long page keeps its contact lines and a short page goes whole', () => {
  const long = ['Acme Bakery | Contact', ...boilerplate.slice(0, 20), 'Siti Aminah', 'Owner', 'Tel: 07-555 0101', ...boilerplate.slice(20)].join('\n');
  const cut = contactText(long);
  assert.match(cut, /^Acme Bakery \| Contact/);
  assert.match(cut, /Siti Aminah\nOwner\nTel: 07-555 0101/);
  assert.ok(cut.length < long.length / 3, `cut to ${cut.length} of ${long.length}`);
  assert.equal(contactText('Siti Aminah, Owner. 07-555 0101'), 'Siti Aminah, Owner. 07-555 0101');
});

test('pages sent to pi drop repeated lines, unreadable charsets and pages with nothing new', () => {
  const pages = preparePages([
    { url: 'https://acme.example/', text: 'Acme Bakery home\nCall us on 07-555 0101 today' },
    { url: 'https://www.acme.example/', text: 'Acme Bakery home\nCall us on 07-555 0101 today' },
    { url: 'https://acme.example/contact', text: '������ menu\nCall us on 07-555 0101 today\nhello@acme.example sales desk' },
  ]);
  assert.deepEqual(pages.map((page) => page.url), ['https://acme.example/', 'https://acme.example/contact']);
  assert.equal(pages[1]!.text, 'hello@acme.example sales desk');
});

test('the smaller page set puts pages that print a phone or email first', () => {
  const pages = preparePages([
    { url: 'https://news.example/a', text: 'Acme Bakery wins a local award for its bread' },
    { url: 'https://dir.example/acme', text: 'Acme Bakery listing, telephone 07-555 0101' },
    { url: 'https://acme.example/contact', text: 'Write to hello@acme.example' },
  ], { maxPages: 2 });
  assert.deepEqual(pages.map((page) => page.url), ['https://dir.example/acme', 'https://acme.example/contact']);
});

function extractFixture() {
  const fetchMock: typeof fetch = async (url) => {
    const href = String(url);
    if (href.includes('api.tavily.com')) {
      return new Response(JSON.stringify({
        results: Array.from({ length: 6 }, (_, i) => ({
          title: `Page ${i}`, url: `https://dir${i}.example/acme`, content: `Acme Bakery listing ${i}`,
        })),
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    const n = /dir(\d)/.exec(href)?.[1] ?? 'x';
    const body = n === '0' ? 'Acme Bakery, telephone 07-555 0101' : `Acme Bakery review number ${n}, lovely bread`;
    return new Response(`<html><body><p>${body}</p></body></html>`, { status: 200, headers: { 'content-type': 'text/html' } });
  };
  return { fetchMock, payload: { name: 'Acme Bakery', location: 'Johor Bahru' } };
}

const answerJson = '{"people":[],"phones":[{"number":"07-555 0101","label":"","evidence_url":"https://dir0.example/acme"}],"emails":[]}';

test('an extract that thinks past its output cap is retried once on fewer pages with minimal thinking', async () => {
  const { fetchMock, payload } = extractFixture();
  const calls: Array<{ prompt: string; opts: Required<pi.AskOptions> }> = [];
  pi.setRunnerForTests(async (prompt, opts) => {
    calls.push({ prompt, opts });
    if (calls.length === 1) throw Object.assign(new Error('Pi used its 8192 output tokens thinking and gave no answer.'), { code: 'length' });
    return answerJson;
  });
  try {
    const result = await (freshKeys(), research(payload, { fetchImpl: fetchMock, env: { CONTACT_TIMEOUT_MS: '100000' } }));
    assert.equal(calls.length, 2);
    assert.equal(calls[0]!.opts.tools, false);
    assert.equal(calls[0]!.opts.maxTokens, 8192);
    assert.equal(calls[0]!.opts.timeoutMs, 50_000);
    assert.equal(calls[1]!.opts.thinking, 'minimal');
    assert.ok(calls[1]!.opts.timeoutMs >= 30_000);
    const pagesIn = (prompt: string) => prompt.match(/<page url=/g)?.length ?? 0;
    assert.equal(pagesIn(calls[0]!.prompt), 6);
    assert.equal(pagesIn(calls[1]!.prompt), 4);
    assert.match(calls[1]!.prompt, /<page url="https:\/\/dir0\.example\/acme">\nAcme Bakery, telephone 07-555 0101/);
    assert.equal((result.phone_contacts as Array<Record<string, unknown>>)[0]?.number_raw, '07-555 0101');
    assert.equal((result.research_meta as { sources: string[] }).sources.length, 4);
  } finally {
    pi.setRunnerForTests(null);
  }
});

test('an extract that fails twice reports both, and a rate limit is not retried', async () => {
  const { fetchMock, payload } = extractFixture();
  let calls = 0;
  pi.setRunnerForTests(async () => {
    calls++;
    throw Object.assign(new Error('Pi gave no answer within 90s.'), { code: 'timeout' });
  });
  try {
    await assert.rejects(
      () => (freshKeys(), research(payload, { fetchImpl: fetchMock })),
      (err: unknown) => {
        assert.equal((err as { code?: string }).code, 'timeout');
        assert.match(String(err), /retry after: pi extract step failed/);
        return true;
      },
    );
    assert.equal(calls, 2);

    calls = 0;
    pi.setRunnerForTests(async () => {
      calls++;
      throw Object.assign(new Error('MiniMax rate limit: 429'), { code: 'rate_limit' });
    });
    await assert.rejects(
      () => (freshKeys(), research(payload, { fetchImpl: fetchMock })),
      (err: unknown) => (err as { code?: string }).code === 'rate_limit',
    );
    assert.equal(calls, 1);
  } finally {
    pi.setRunnerForTests(null);
  }
});

test('the LinkedIn search asks Exa for linkedin.com only and keeps title and snippet', async () => {
  let sent: Record<string, unknown> = {};
  const fetchMock: typeof fetch = async (url, init) => {
    assert.equal(String(url), 'https://api.exa.ai/search');
    assert.match((init?.headers as Record<string, string>)['x-api-key'], /^exa-test-/);
    sent = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({ results: [
      { url: 'https://my.linkedin.com/in/tan-ah-kow', title: 'Tan Ah Kow - Managing Director - Acme Sdn Bhd', highlights: ['Managing Director at Acme Sdn Bhd'] },
    ] }), { status: 200 });
  };
  const target = targetFromPayload({ name: 'Acme Sdn Bhd' });
  const out = await (freshKeys(true), linkedinSearch(target, fetchMock));
  assert.deepEqual(sent.includeDomains, ['linkedin.com']);
  assert.match(String(sent.query), /^Acme Sdn Bhd director manager owner$/);
  assert.equal(out.sources[0]?.title, 'Tan Ah Kow - Managing Director - Acme Sdn Bhd');
  assert.equal(out.sources[0]?.kind, 'social');
  // No key or a failed call costs nothing and stops nothing.
  assert.deepEqual((await (freshKeys(), linkedinSearch(target, fetchMock))).sources, []);
  const down: typeof fetch = async () => new Response('busy', { status: 503 });
  assert.deepEqual((await (freshKeys(true), linkedinSearch(target, down))).sources, []);
});

test('the prompt hands Pi the search snippets beside the pages', () => {
  const prompt = promptFor(
    targetFromPayload({ name: 'Acme Sdn Bhd' }),
    [{ url: 'https://acme.example/contact', text: 'Tel 07-355 1234' }],
    [{ url: 'https://my.linkedin.com/in/tan-ah-kow', kind: 'social', title: 'Tan Ah Kow - Managing Director - Acme Sdn Bhd', why: 'Managing Director at Acme' }],
  );
  assert.match(prompt, /<result url="https:\/\/my\.linkedin\.com\/in\/tan-ah-kow">Tan Ah Kow - Managing Director - Acme Sdn Bhd — Managing Director at Acme<\/result>/);
  assert.match(prompt, /Copy each name exactly as printed/);
  assert.match(prompt, /Never write "Key Contact"/);
});

test('masked, cut and placeholder numbers and emails are dropped', () => {
  for (const bad of ['016-709 82**', '07-356 2\XX', '07-356 2XXX', '+60370000000', '+60 3-7000 0000', '012-1111111', '1234567']) {
    assert.equal(unusablePhone(bad), true, bad);
  }
  for (const good of ['07-288 2888', '+6012-3197772', '012 - 701 9192', '1300-88-1234', '72882999']) {
    assert.equal(unusablePhone(good), false, good);
  }
  assert.equal(unusableEmail('s*****@ksl.net.my'), true);
  assert.equal(unusableEmail('info@ksl.my'), false);
});

test('a name is kept only as printed in what Pi read', () => {
  const text = 'Board: KHOO CHENG HAI @ KU CHENG HAI, Director. Tan  Swee Geok, Director.';
  assert.equal(printedName('Khoo Cheng Hai @ Ku Cheng Hai', text), 'KHOO CHENG HAI @ KU CHENG HAI');
  assert.equal(printedName('Tan Swee Geok', text), 'Tan Swee Geok');
  assert.equal(printedName('Khao Cheng Hai', text), null);
  assert.equal(printedName('Tan', 'Tank Engineering'), null);

  const grounded = groundExtracted(
    {
      people: [{ name: 'Khoo Cheng Hai @ Ku Cheng Hai', position: 'Director' }, { name: 'Khao Lee Feng', position: 'Director' }],
      phones: [{ number: '07-288 2888' }, { number: '016-709 82**' }],
      emails: [{ email: 'info@ksl.my' }, { email: 's*****@ksl.net.my' }],
    },
    [{ url: 'https://ksl.my/board', text }],
    [],
  );
  assert.deepEqual((grounded.people as Array<{ name: string }>).map((p) => p.name), ['KHOO CHENG HAI @ KU CHENG HAI']);
  assert.deepEqual((grounded.phones as Array<{ number: string }>).map((p) => p.number), ['07-288 2888']);
  assert.deepEqual((grounded.emails as Array<{ email: string }>).map((e) => e.email), ['info@ksl.my']);
});

test('general searches take turns between Tavily and Exa while both have credits', () => {
  const both = [pickGeneral(true, true), pickGeneral(true, true), pickGeneral(true, true), pickGeneral(true, true)];
  assert.deepEqual(new Set(both), new Set(['tavily', 'exa']));
  assert.equal(pickGeneral(true, false), 'tavily');
  assert.equal(pickGeneral(false, true), 'exa');
  assert.equal(pickGeneral(false, false), null);
});

test('an Exa job records who searched and which provider found each contact', async () => {
  const exaBodies: Array<Record<string, unknown>> = [];
  const fetchMock: typeof fetch = async (url, init) => {
    const href = String(url);
    if (href === 'https://api.exa.ai/search') {
      const body = JSON.parse(String(init?.body));
      exaBodies.push(body);
      const results = body.includeDomains
        ? [{ url: 'https://my.linkedin.com/in/siti', title: 'Siti Aminah - Owner - Acme Bakery', highlights: ['Owner at Acme Bakery'] }]
        : [{ url: 'https://acme-bakery.example/about', title: 'About Acme Bakery', highlights: ['Call 07-555 0101'] }];
      return new Response(JSON.stringify({ results }), { status: 200 });
    }
    return new Response('<p>Acme Bakery. Call 07-555 0101.</p>', { status: 200, headers: { 'content-type': 'text/html' } });
  };
  pi.setRunnerForTests(async () => '{"people":[{"name":"Siti Aminah","position":"Owner","evidence_url":"https://my.linkedin.com/in/siti"}],"phones":[{"number":"07-555 0101","label":"office","evidence_url":"https://acme-bakery.example/about"}],"emails":[]}');
  try {
    const result = await (freshKeys(true), research({ name: 'Acme Bakery', location: 'Johor Bahru' }, { fetchImpl: fetchMock, provider: 'exa' }));
    assert.equal(exaBodies.length, 3, 'two general searches and one LinkedIn search');
    const meta = result.research_meta as Record<string, unknown>;
    assert.equal(meta.general_provider, 'exa');
    assert.deepEqual((meta.search as Array<Record<string, unknown>>).map((row) => `${row.provider}:${row.purpose}`).sort(), ['exa:general', 'exa:general', 'exa:linkedin']);
    assert.equal((result.decision_makers as Array<Record<string, unknown>>)[0]?.found_by, 'exa');
    assert.equal((result.phone_contacts as Array<Record<string, unknown>>)[0]?.found_by, 'exa');
    assert.match(String(meta.engine), /^exa \+ exa linkedin \+ pi\//);
  } finally {
    pi.setRunnerForTests(null);
  }
});

test('an Exa key rests an hour when Exa refuses it and a minute on a rate limit', async () => {
  const refused: typeof fetch = async () => new Response('{"error":"insufficient credits"}', { status: 402 });
  await assert.rejects(() => exaApi.searchWithKey('q', 'k', { fetchImpl: refused }), (err: unknown) => (err as { code?: string }).code === 'quota');
  const limited: typeof fetch = async () => new Response('slow down', { status: 429 });
  await assert.rejects(() => exaApi.searchWithKey('q', 'k', { fetchImpl: limited }), (err: unknown) => (err as { code?: string }).code === 'rate_limit');
  const pool = createKeyPool({ concurrency: 1 });
  pool.setKeys(['exa-a']);
  const cools: number[] = [];
  exaApi.releaseFor({ secret: 'exa-a', release: (ms = 0) => { cools.push(ms); } }, { code: 'quota' });
  exaApi.releaseFor({ secret: 'exa-a', release: (ms = 0) => { cools.push(ms); } }, { code: 'rate_limit' });
  assert.deepEqual(cools, [60 * 60_000, 60_000]);
});

// ---------------------------------------------------------------- readPages

/** A page source, as a search would have produced it. */
const src = (url: string, why: string) => ({ url, kind: 'page', why } as const);

/** A fetchImpl standing in for this container's own reading. */
function container(pages: Record<string, string>) {
  const asked: string[] = [];
  const impl = (async (url: string | URL) => {
    const href = String(url);
    asked.push(href);
    const body = pages[href];
    if (body === undefined) return new Response('nope', { status: 404 });
    return new Response(`<html><body>${body}</body></html>`, { headers: { 'content-type': 'text/html' } });
  }) as unknown as typeof fetch;
  return { impl, asked };
}

/** The mini, answering in pagefetch's shape. */
const mini = (pages: Record<string, string>) => async (urls: string[]) => ({
  results: urls.filter((u) => pages[u] !== undefined).map((u) => ({ url: u, raw_content: pages[u]! })),
  failed_results: urls.filter((u) => pages[u] === undefined).map((u) => ({ url: u, error: 'not read' })),
  usage: { credits: 0 },
  worker: 'mini-fetch-1',
});

test('a page the mini read is used, and this container is never asked for it', async () => {
  const c = container({ 'https://a.example/': 'from the container' });
  const pages = await readPages(['https://a.example/'], [], c.impl, mini({ 'https://a.example/': 'from the mini' }));
  assert.deepEqual(pages, [{ url: 'https://a.example/', text: 'from the mini' }]);
  assert.deepEqual(c.asked, [], 'the container did no fetching');
});

test('a page the mini could not read is read by this container instead', async () => {
  const c = container({ 'https://b.example/': 'container read this' });
  const pages = await readPages(['https://a.example/', 'https://b.example/'], [],
    c.impl, mini({ 'https://a.example/': 'mini read this' }));
  assert.deepEqual(pages.map((p) => p.text), ['mini read this', 'container read this']);
  assert.deepEqual(c.asked, ['https://b.example/'], 'only the one the mini missed');
});

test('with no mini at all, step 2 still reads every page here', async () => {
  const c = container({ 'https://a.example/': 'container read this' });
  const down = async () => { throw Object.assign(new Error('no fetch.pages worker has checked in'), { code: 'not_installed' }); };
  const pages = await readPages(['https://a.example/'], [], c.impl, down);
  assert.deepEqual(pages, [{ url: 'https://a.example/', text: 'container read this' }]);
});

test('a page neither reader could load falls back to its search snippet', async () => {
  const c = container({});
  const pages = await readPages(['https://a.example/'], [src('https://a.example/', 'the snippet')],
    c.impl, mini({}));
  assert.equal(pages.length, 1);
  assert.match(pages[0]!.text, /search snippet; the page itself did not load.*the snippet/);
});

test('a page nothing could read and that has no snippet is dropped', async () => {
  const pages = await readPages(['https://a.example/'], [], container({}).impl, mini({}));
  assert.deepEqual(pages, []);
});

test("the mini's page is cut to this step's own character cap", async () => {
  const long = 'x'.repeat(50_000);
  const pages = await readPages(['https://a.example/'], [], container({}).impl, mini({ 'https://a.example/': long }));
  assert.ok(pages[0]!.text.length < long.length, 'it was cut');
  assert.ok(pages[0]!.text.length <= 6_000, `6000 is this step's cap, got ${pages[0]!.text.length}`);
});

test('the mini is asked once for the batch, not once per page', async () => {
  let calls = 0;
  const reader = async (urls: string[]) => { calls++; return mini({})(urls); };
  await readPages(['https://a.example/', 'https://b.example/', 'https://c.example/'], [], container({}).impl, reader);
  assert.equal(calls, 1);
});
