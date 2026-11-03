// evidence/ may depend on cost.ts for the ApiCall type only, and on nothing
// in companydive, divedeeper, contact, checks, steps, or core. It names no
// provider host. A file that breaks this fails the build here.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const EVIDENCE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'evidence');

/** Every API host only core/ may name. */
const HOST = /api\.tavily\.com|api\.exa\.ai|api\.search\.brave\.com|mcp\.scraper\.tech|thehive\.ai|vectide\.cn|api\.minimax\.io|asiasouth\.up\.railway\.app|pagespeedonline|api\.parallel\.ai|smartlead\.ai|\/chat\/completions/;

const ALLOWED_COST = "import type { ApiCall } from '../cost.ts';";

function sources(): string[] {
  return fs.readdirSync(EVIDENCE)
    .filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'))
    .map((name) => path.join(EVIDENCE, name));
}

function specifiers(text: string): string[] {
  return [...text.matchAll(/(?:from|import\()\s*['"]([^'"]+)['"]/g)].map((m) => m[1]);
}

test('evidence/ depends on cost.ts only as a type import of ApiCall', () => {
  const hits = sources().flatMap((file) => {
    const text = fs.readFileSync(file, 'utf8');
    return specifiers(text)
      .filter((spec) => spec.includes('cost.ts'))
      .map((spec) => ({ file: path.basename(file), spec, text }));
  });
  assert.equal(hits.length, 1, 'exactly one cost.ts import');
  const lines = hits[0].text.split('\n').filter((line) => line.includes('cost.ts'));
  assert.deepEqual(lines, [ALLOWED_COST]);
});

test('evidence/ does not import companydive, divedeeper, contact, checks, steps, or core', () => {
  const banned = /(?:^|\/)(companydive|divedeeper|contact|checks|steps|core)(?:\/|$|\.)/;
  const offenders = sources().flatMap((file) => specifiers(fs.readFileSync(file, 'utf8'))
    .filter((spec) => banned.test(spec))
    .map((spec) => `${path.basename(file)}: ${spec}`));
  assert.deepEqual(offenders, []);
});

test('evidence/ names no provider host', () => {
  const offenders = sources().flatMap((file) => fs.readFileSync(file, 'utf8').split('\n')
    .flatMap((line, i) => (HOST.test(line) ? [`${path.basename(file)}:${i + 1}: ${line.trim().slice(0, 120)}`] : [])));
  assert.deepEqual(offenders, []);
});
