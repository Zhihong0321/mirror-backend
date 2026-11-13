import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { benchCall } from './llm.ts';

async function serve(handler: http.RequestListener): Promise<{ url: string; close: () => void }> {
  const server = http.createServer(handler);
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', () => ok()));
  return { url: `http://127.0.0.1:${(server.address() as any).port}`, close: () => server.close() };
}
const msgs = [{ role: 'user' as const, content: 'hi' }];

test('benchCall: times the first reasoning and the first answer, reads the usage, sends the effort', async () => {
  let body: any = null;
  const s = await serve((req, res) => {
    let raw = '';
    req.on('data', (d) => (raw += d)).on('end', () => {
      body = JSON.parse(raw);
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write('data: {"choices":[{"delta":{"reasoning_content":"thinking"}}]}\n\n');
      setTimeout(() => {
        res.write('data: {"choices":[{"delta":{"content":"{\\"a\\":1}"}}]}\n\n');
        res.write('data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":7,"completion_tokens":3}}\n\n');
        res.end('data: [DONE]\n\n');
      }, 60);
    });
  });
  try {
    const out = await benchCall({ url: s.url, key: 'k', model: 'm' }, msgs, { reasoningEffort: 'high', json: true });
    assert.equal(out.ok, true);
    assert.equal(out.answer, '{"a":1}');
    assert.equal(out.tokensIn, 7);
    assert.equal(out.tokensOut, 3);
    assert.equal(out.finish, 'stop');
    assert.ok(out.firstReasoningMs !== null && out.firstAnswerMs !== null && out.firstAnswerMs >= out.firstReasoningMs);
    assert.equal(body.reasoning_effort, 'high');
    assert.deepEqual(body.response_format, { type: 'json_object' });
  } finally { s.close(); }
});

test('benchCall: an HTTP error comes back ok:false with the reason, never thrown', async () => {
  const s = await serve((req, res) => { req.resume().on('end', () => { res.writeHead(500); res.end('boom'); }); });
  try {
    const out = await benchCall({ url: s.url, key: 'k', model: 'm' }, msgs);
    assert.equal(out.ok, false);
    assert.match(out.error ?? '', /HTTP 500/);
  } finally { s.close(); }
});

test('benchCall: a call with no finished answer by deadMs is dead and says so', async () => {
  const s = await serve((req, res) => { req.resume().on('end', () => { res.writeHead(200, { 'content-type': 'text/event-stream' }); res.write('data: {"choices":[{"delta":{"reasoning_content":"still thinking"}}]}\n\n'); }); });
  try {
    const out = await benchCall({ url: s.url, key: 'k', model: 'm' }, msgs, { deadMs: 300 });
    assert.equal(out.ok, false);
    assert.match(out.error ?? '', /dead/);
    assert.ok(out.ms < 5000);
  } finally { s.close(); }
});
