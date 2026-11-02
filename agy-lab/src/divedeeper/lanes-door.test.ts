// Outside src/divedeeper/lib.ts, no file reads from or writes to the lanes' disk files
// directly, and none builds a path from OUT. A file that breaks it fails the build here.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

function sources(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return sources(full);
    return e.name.endsWith('.ts') && !e.name.endsWith('.test.ts') && full !== path.join(HERE, 'lib.ts') ? [full] : [];
  });
}

/** Path construction from OUT, e.g. path.join(OUT, ...) or path.resolve(OUT, ...) or ${OUT} */
const OUT_PATH = /\bpath\.(?:join|resolve)\s*\([^)]*\bOUT\b|\$\{OUT\}/;

test('no file under divedeeper/ except lib.ts builds a path from OUT', () => {
  const offenders = sources(HERE).flatMap((file) => {
    const text = fs.readFileSync(file, 'utf8');
    return text.split('\n').flatMap((line, i) => (OUT_PATH.test(line) ? [`${path.relative(HERE, file)}:${i + 1}: ${line.trim().slice(0, 120)}`] : []));
  });
  assert.deepEqual(offenders, [], 'use readLane / writeLane from lib.ts instead');
});

test('no file under divedeeper/ except lib.ts imports OUT', () => {
  const offenders = sources(HERE).flatMap((file) => {
    const text = fs.readFileSync(file, 'utf8');
    const matches = [...text.matchAll(/import\s*\{[^}]*\bOUT\b[^}]*\}\s*from/g)];
    return matches.map(() => path.relative(HERE, file));
  });
  assert.deepEqual(offenders, [], 'readLane and writeLane handle OUT; OUT itself is private to lib.ts');
});
