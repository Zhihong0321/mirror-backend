import test from 'node:test';
import assert from 'node:assert/strict';
import { ask, chat, config, lanesFor, pool, resetForTests, restingUntilFor, setLanesForTests } from './llm.ts';

const cfg = { url: 'https://llm.example/v1', key: 'k', model: 'deepseek-v4.1-flash-1017' };
const reply = (status: number, body: unknown) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

test('config needs all three variables', () => {
  assert.equal(config({}), null);
  assert.equal(config({ CONTACT_LLM_URL: 'https://llm.example/v1/', CONTACT_LLM_KEY: 'k' }), null);
  assert.deepEqual(config({ CONTACT_LLM_URL: 'https://llm.example/v1/', CONTACT_LLM_KEY: ' k ', CONTACT_LLM_MODEL: 'deepseek-v4.1-flash-1017' }), cfg);
});

test('one chat call returns the answer', async () => {
  let sent: Record<string, unknown> = {};
  const fetchImpl = (async (url: string, init: RequestInit) => {
    assert.equal(url, 'https://llm.example/v1/chat/completions');
    sent = JSON.parse(String(init.body));
    return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: ' {"people":[]} ' } }] }));
  }) as unknown as typeof fetch;
  const out = await ask('read this', { maxTokens: 8192 }, cfg, fetchImpl);
  assert.equal(out.answer, '{"people":[]}');
  assert.equal(sent.model, 'deepseek-v4.1-flash-1017');
  assert.equal(sent.max_tokens, 8192);
  assert.equal(sent.temperature, 0);
});

test('half an emoji left by a page cut is replaced, not sent', async () => {
  let body = '';
  const fetchImpl = (async (_url: string, init: RequestInit) => {
    body = String(init.body);
    return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: '{}' } }] }));
  }) as unknown as typeof fetch;
  await ask('call us 📞'.slice(0, -1), {}, cfg, fetchImpl);
  assert.doesNotMatch(body, /\\ud83d/i);
  assert.equal(JSON.parse(body).messages[0].content, 'call us �');
});

test('failures carry the codes the extract retry and lane cooldown read', async () => {
  const code = async (fetchImpl: typeof fetch) => {
    try { await ask('x', { maxTokens: 10 }, cfg, fetchImpl); return 'ok'; } catch (e) { return (e as { code?: string }).code; }
  };
  assert.equal(await code(reply(429, { error: 'slow down' })), 'rate_limit');
  assert.equal(await code(reply(500, { error: 'down' })), 'failed');
  assert.equal(await code(reply(200, { choices: [{ finish_reason: 'length', message: { content: '' } }] })), 'length');
  assert.equal(await code(reply(200, { choices: [{ finish_reason: 'stop', message: { content: '' } }] })), 'empty');
  assert.equal(await code((async () => { throw Object.assign(new Error('t'), { name: 'TimeoutError' }); }) as unknown as typeof fetch), 'timeout');
  assert.equal(await ask('x', {}, null).catch((e) => e.code), 'not_configured');
});

test('Hive keys join the pool after Vectide, on the deepseek model', () => {
  const env = { CONTACT_LLM_URL: 'https://llm.example/v1', CONTACT_LLM_KEY: 'k', CONTACT_LLM_MODEL: 'deepseek-v4.1-flash-1017', CONTACT_LLM_HIVE_KEYS: ' h1, h2 ,,h3' };
  assert.deepEqual(pool(env).map((c) => [c.url, c.key, c.model]), [
    ['https://llm.example/v1', 'k', 'deepseek-v4.1-flash-1017'],
    ['https://api.thehive.ai/api/v3', 'h1', 'deepseek-ai/deepseek-v4.1-flash-1017'],
    ['https://api.thehive.ai/api/v3', 'h2', 'deepseek-ai/deepseek-v4.1-flash-1017'],
    ['https://api.thehive.ai/api/v3', 'h3', 'deepseek-ai/deepseek-v4.1-flash-1017'],
  ]);
  assert.equal(config({ CONTACT_LLM_HIVE_KEYS: 'h1' })?.key, 'h1');
});

test('calls take turns, and a 429 moves the call to the next provider', async () => {
  resetForTests();
  const providers = ['a', 'b', 'c'].map((key) => ({ url: 'https://llm.example/v1', key, model: 'm' }));
  const seen: string[] = [];
  const fetchImpl = (async (_url: string, init: RequestInit) => {
    const key = String((init.headers as Record<string, string>).authorization).slice(7);
    seen.push(key);
    if (key === 'a') return new Response('busy', { status: 429 });
    return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: key } }] }));
  }) as unknown as typeof fetch;
  assert.equal((await ask('x', {}, providers, fetchImpl)).answer, 'b');
  assert.equal((await ask('x', {}, providers, fetchImpl)).answer, 'b');
  assert.equal((await ask('x', {}, providers, fetchImpl)).answer, 'c');
  assert.equal((await ask('x', {}, providers, fetchImpl)).answer, 'b', 'a rests after its 429');
  assert.deepEqual(seen, ['a', 'b', 'b', 'c', 'b']);
});

test('an empty answer moves the call on without resting the provider', async () => {
  resetForTests();
  const providers = ['a', 'b'].map((key) => ({ url: 'https://llm.example/v1', key, model: 'm' }));
  const seen: string[] = [];
  const fetchImpl = (async (_url: string, init: RequestInit) => {
    const key = String((init.headers as Record<string, string>).authorization).slice(7);
    seen.push(key);
    const content = key === 'a' && seen.length === 1 ? '' : key;
    return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content } }] }));
  }) as unknown as typeof fetch;
  assert.equal((await ask('x', {}, providers, fetchImpl)).answer, 'b');
  assert.equal((await ask('x', {}, providers, fetchImpl)).answer, 'b');
  assert.equal((await ask('x', {}, providers, fetchImpl)).answer, 'a', 'a was not rested');
  assert.deepEqual(seen, ['a', 'b', 'b', 'a']);
  const all = providers.map((p) => ({ ...p }));
  const empty = (async () => new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: '' } }] }))) as unknown as typeof fetch;
  assert.equal(await ask('x', {}, all, empty).catch((e) => e.code), 'empty', 'every provider empty still reports empty');
});

test('a lane marked first takes every call; the others rotate behind it', async () => {
  resetForTests();
  const lanes = [
    { url: 'https://a.example/v1', key: 'a', model: 'm' },
    { url: 'https://p.example/v1', key: 'p', model: 'm', first: true },
    { url: 'https://b.example/v1', key: 'b', model: 'm' },
  ];
  const hits: string[] = [];
  let busy = false;
  const fetchImpl = (async (url: string) => {
    hits.push(new URL(url).host[0]!);
    if (busy && url.startsWith('https://p.')) return new Response('{}', { status: 429 });
    return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: 'ok' } }] }));
  }) as unknown as typeof fetch;
  for (let i = 0; i < 3; i++) await ask('x', {}, lanes, fetchImpl);
  assert.deepEqual(hits, ['p', 'p', 'p']);
  hits.length = 0;
  busy = true;
  await ask('x', {}, lanes, fetchImpl);
  await ask('x', {}, lanes, fetchImpl);
  // The first lane answered 429 and rests; the next calls rotate over the others.
  assert.equal(hits[0], 'p');
  assert.deepEqual(hits.slice(1).sort(), ['a', 'b']);
});

const okAnswer = (text: string) => new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: text } }], usage: { prompt_tokens: 3, completion_tokens: 1 } }));

test('chat streams: content deltas joined, reasoning dropped, tokens read, no max_tokens sent', async () => {
  resetForTests();
  let sent: Record<string, unknown> = {};
  const sse = [
    'data: {"choices":[{"delta":{"reasoning_content":"thinking..."}}]}',
    'data: {"choices":[{"delta":{"content":"{\\"ok\\""}}]}',
    ': keep-alive',
    'data: {"choices":[{"delta":{"content":": true}"}}]}',
    'data: {"choices":[],"usage":{"prompt_tokens":12,"completion_tokens":34}}',
    'data: [DONE]',
    '',
  ].join('\n');
  const fake = (async (_url: string, init: RequestInit) => {
    sent = JSON.parse(String(init.body));
    const bytes = new TextEncoder().encode(sse);
    const body = new ReadableStream({ start(c) { c.enqueue(bytes.slice(0, 40)); c.enqueue(bytes.slice(40)); c.close(); } });
    return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
  }) as typeof fetch;
  const log: import('../cost.ts').ApiCall[] = [];
  setLanesForTests([{ ...cfg, label: 'Vectide coding plan' }]);
  const out = await chat('hi', { step: 'triage', fetchImpl: fake, log, fallback: false });
  assert.equal(out.answer, '{"ok": true}');
  assert.deepEqual([out.tokensIn, out.tokensOut], [12, 34]);
  assert.deepEqual(sent.stream_options, { include_usage: true });
  assert.equal(sent.stream, true);
  assert.equal('max_tokens' in sent, false);
  assert.equal(log.length, 1);
  assert.deepEqual([log[0].what, log[0].provider, log[0].model, log[0].tokensIn, log[0].ok], ['triage', 'Vectide coding plan', 'deepseek-v4.1-flash-1017', 12, true]);
});

test('a lane that answers 429 rests and the call moves to the next lane at once; every attempt is logged', async () => {
  resetForTests();
  const lanes = [
    { url: 'https://v.example/v1', key: 'v', model: 'deepseek-v4.1-flash-1017', label: 'Vectide', first: true },
    { url: 'https://h1.example/v1', key: 'h1', model: 'deepseek-ai/deepseek-v4.1-flash-1017', label: 'Hive 1' },
  ];
  const fetchImpl = (async (url: string) => url.startsWith('https://v.') ? new Response('{"error":"busy"}', { status: 429 }) : okAnswer('done')) as unknown as typeof fetch;
  setLanesForTests(lanes);
  const log: import('../cost.ts').ApiCall[] = [];
  const out = await chat('x', { step: 's', fetchImpl, log, fallback: false });
  assert.equal(out.answer, 'done');
  assert.equal(out.lane, 'Hive 1');
  assert.deepEqual(log.map((c) => [c.provider, c.ok]), [['Vectide', false], ['Hive 1', true]]);
  assert.ok(restingUntilFor('v'));
  assert.equal(restingUntilFor('h1'), null);
});

test('lanes serve calls in parallel: a busy lane hands the next call to a free one', async () => {
  resetForTests();
  const lanes = ['a', 'b', 'c'].map((k) => ({ url: `https://${k}.example/v1`, key: k, model: 'deepseek-v4.1-flash-1017' }));
  const served: string[] = [];
  const fetchImpl = (async (url: string) => {
    served.push(new URL(url).host[0]!);
    await new Promise((r) => setTimeout(r, 20));
    return okAnswer('ok');
  }) as unknown as typeof fetch;
  setLanesForTests(lanes);
  await Promise.all(Array.from({ length: 9 }, () => chat('x', { step: 's', fetchImpl, fallback: false })));
  assert.deepEqual(['a', 'b', 'c'].map((k) => served.filter((s) => s === k).length), [3, 3, 3]);
});

test('a use-first lane takes every parallel call; the others serve only once it answers 429', async () => {
  resetForTests();
  const lanes = [
    { url: 'https://h.example/v1', key: 'h', model: 'deepseek-v4.1-flash-1017' },
    { url: 'https://v.example/v1', key: 'v', model: 'deepseek-v4.1-flash-1017', first: true },
  ];
  const served: string[] = [];
  let limited = false;
  const fetchImpl = (async (url: string) => {
    served.push(new URL(url).host[0]!);
    if (limited && url.startsWith('https://v.')) return new Response('{}', { status: 429 });
    await new Promise((r) => setTimeout(r, 20));
    return okAnswer('ok');
  }) as unknown as typeof fetch;
  setLanesForTests(lanes);
  await Promise.all(Array.from({ length: 8 }, () => chat('x', { step: 's', fetchImpl, fallback: false })));
  assert.deepEqual(served, Array(8).fill('v'));
  served.length = 0;
  limited = true;
  await Promise.all(Array.from({ length: 4 }, () => chat('x', { step: 's', fetchImpl, fallback: false })));
  assert.equal(served.filter((s) => s === 'h').length, 4);
});

test('only lanes serving the asked model are used', () => {
  const lanes = [
    { url: 'https://v.example/v1', key: 'v', model: 'deepseek-v4.1-flash-1017' },
    { url: 'https://h.example/v1', key: 'h', model: 'deepseek-ai/deepseek-v4.1-flash-1017' },
    { url: 'https://z.example/v1', key: 'z', model: 'gpt-6.1-sol' },
  ];
  assert.deepEqual(lanesFor('deepseek', lanes).map((l) => l.key), ['v', 'h']);
  assert.deepEqual(lanesFor('deepseek-v4.1-flash-1017', lanes).map((l) => l.key), ['v', 'h']);
  assert.deepEqual(lanesFor('gpt-6.1-sol', lanes).map((l) => l.key), ['z']);
});

test('a timeout of 0 tells Pi to wait for the answer', async () => {
  const pi = await import('./pi.ts');
  let seen = -1;
  pi.setRunnerForTests(async (_prompt, opts) => { seen = opts.timeoutMs; return 'ok'; });
  try {
    assert.equal((await pi.ask('hi', { tools: false, timeoutMs: 0 })).answer, 'ok');
    assert.equal(seen, 0);
  } finally {
    pi.setRunnerForTests(null);
  }
});
