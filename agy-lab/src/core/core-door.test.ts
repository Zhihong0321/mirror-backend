// The rule of core/README.md, checked: outside src/core/, no file talks to an
// LLM, a search API or a paid data API itself, and none imports a core module
// other than core/index.ts. A file that breaks it fails the build here.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Every API host and endpoint only core/ may call. */
const API = /api\.tavily\.com|api\.exa\.ai|api\.search\.brave\.com|mcp\.scraper\.tech|thehive\.ai|vectide\.cn|api\.minimax\.io|asiasouth\.up\.railway\.app|pagespeedonline|api\.parallel\.ai|smartlead\.ai|\/chat\/completions/;

/** The gateway serves (and the docs page describes) an OpenAI-shaped route of its own; serving it is not calling a model. */
const OWN_ROUTES = /\/(api\/)?v1\/chat\/completions/g;

function sources(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === 'core' && dir === SRC ? [] : sources(full);
    return e.name.endsWith('.ts') && !e.name.endsWith('.test.ts') ? [full] : [];
  });
}

test('no file outside core/ calls an LLM or a search or data API itself', () => {
  const offenders = sources(SRC).flatMap((file) => {
    const text = fs.readFileSync(file, 'utf8').replace(OWN_ROUTES, '');
    return text.split('\n').flatMap((line, i) => (API.test(line) ? [`${path.relative(SRC, file)}:${i + 1}: ${line.trim().slice(0, 120)}`] : []));
  });
  assert.deepEqual(offenders, [], 'call these through core/index.ts instead');
});

test('files outside core/ import core/index.ts and no other core module', () => {
  const offenders = sources(SRC).flatMap((file) => {
    const text = fs.readFileSync(file, 'utf8');
    return [...text.matchAll(/(?:from|import\()\s*'([^']*\/core\/[^']+)'/g)]
      .filter((m) => !m[1].endsWith('/core/index.ts'))
      .map((m) => `${path.relative(SRC, file)}: ${m[1]}`);
  });
  assert.deepEqual(offenders, []);
});

/** Key and lane handling only core/ may do: leasing, resting and counting a key, or handing core a key or lane. */
const KEY_WORK = /\b(searchWithKey|requestWithKey|releaseFor|setKeysForTests|setLanesForTests)\(|\.pool\.(acquire|spend|setKeys)\(|\bvaultLanes\b/;

test('no file outside core/ takes, rests or counts an API key, or hands core a key or lane', () => {
  const offenders = sources(SRC).flatMap((file) => fs.readFileSync(file, 'utf8').split('\n')
    .flatMap((line, i) => (KEY_WORK.test(line) ? [`${path.relative(SRC, file)}:${i + 1}: ${line.trim().slice(0, 120)}`] : [])));
  assert.deepEqual(offenders, [], 'ask core for the search or the answer; core picks the key');
});
