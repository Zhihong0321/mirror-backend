// Guard on the real preview v2 source. The model sees only the allow-list, and the writer
// does not touch the old preview column. No fixture: production dives stay out of the repo.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const src = fs.readFileSync(new URL('./divedeeper/preview-v2.ts', import.meta.url), 'utf8');

test('the preview v2 prompt is built only from previewInput', () => {
  assert.match(src, /const input = previewInput\(/);
  assert.match(src, /const prompt = previewPrompt\(input\)/);
  const start = src.indexOf('function previewPrompt');
  const end = src.indexOf('export async function writePreviewV2');
  assert.ok(start >= 0 && end > start, 'previewPrompt sits in front of the writer');
  const body = src.slice(start, end);
  assert.doesNotMatch(body, /\b(dive|gaps|contradictions|registration_numbers|official_domains|identity|sourceUrls)\b/);
  assert.doesNotMatch(src, /from\s+'[^']*evidence/);
  assert.match(src, /sourceText:\s*\(url:\s*string\)\s*=>\s*Promise<string\s*\|\s*null>/);
  assert.match(src, /quoteOnPage\(/);
});

test('passages go through scrubPublic before they enter the prompt', () => {
  // Passages are scrubbed, then lose every sentence naming someone who is not leadership, before the prompt is built.
  assert.match(src, /passageWindow\(withoutBlocked\(scrubPublic\([\s\S]*const prompt = previewPrompt\(input\)/);
});

test('preview v2 never writes the notes column', () => {
  const queries = [...src.matchAll(/sql\(\s*`([^`]*)`/gs)].map((m) => m[1]);
  assert.ok(queries.some((q) => q.includes('notes_v2')), 'the writer stores notes_v2');
  for (const q of queries) assert.doesNotMatch(q.replaceAll('notes_v2', ''), /\bnotes\b/i, q);
});
