// Boundary checks for T6 switches: reads real source files, no invented data.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = path.dirname(fileURLToPath(import.meta.url));

test('switches helper has no app-layer imports', () => {
  const file = path.join(SRC, 'switches.ts');
  const text = fs.readFileSync(file, 'utf8');
  const imports = [...text.matchAll(/^\s*import\s+.*?from\s+['"]([^'"]+)['"]/gm)].map((m) => m[1]);
  // switches.ts must have no app-layer, database, HTTP or provider imports
  const forbidden = imports.filter((specifier) =>
    specifier.startsWith('.') ||
    specifier.includes('reportdb') ||
    specifier.includes('http') ||
    specifier.includes('core')
  );
  assert.deepEqual(forbidden, [], 'switches.ts must have no app-layer imports');
});

test('both start handlers use the shared parser', () => {
  const cdHttp = fs.readFileSync(path.join(SRC, 'companydive', 'http.ts'), 'utf8');
  const ddHttp = fs.readFileSync(path.join(SRC, 'divedeeper', 'http.ts'), 'utf8');

  assert.match(cdHttp, /import\s+{[^}]*\bparseSwitches\b[^}]*}\s+from\s+['"]\.\.\/switches\.ts['"]/, 'companydive/http.ts must import parseSwitches from ../switches.ts');
  assert.match(cdHttp, /\bparseSwitches\s*\(\s*body\.switches\s*\)/, 'companydive/http.ts must parse switches with parseSwitches');

  assert.match(ddHttp, /import\s+{[^}]*\bparseSwitches\b[^}]*}\s+from\s+['"]\.\.\/switches\.ts['"]/, 'divedeeper/http.ts must import parseSwitches from ../switches.ts');
  assert.match(ddHttp, /\bparseSwitches\s*\(\s*body\.switches\s*\)/, 'divedeeper/http.ts must parse switches with parseSwitches');
});
