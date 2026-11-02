// The check a country pack must pass before review (src/countries/README.md).
//
//   node scripts/check-country.ts <CC>
//   node scripts/check-country.ts SG
//
// 1. Only src/countries/<CC>/ changed: any other changed file in the repo fails the check.
// 2. pack.json is valid and no other pack claims its country names.
// 3. research.md exists and every section of the template is in it.
// 4. The country tests pass (Malaysia unchanged, every pack valid).
// 5. Prints what the pack will add to a dive, so it can be read before a test run.
// Exit 0 when all pass, 1 when one fails. Changes nothing.
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import * as countries from '../src/countries.ts';

const cc = (process.argv[2] ?? '').toUpperCase();
if (!/^[A-Z]{2}$/.test(cc)) { console.error('usage: node scripts/check-country.ts <CC>   (e.g. SG)'); process.exit(2); }

const LAB = path.join(import.meta.dirname, '..');
const ROOT = path.join(LAB, '..');
const FOLDER = path.join(countries.DIR, cc);
const ALLOWED = `agy-lab/src/countries/${cc}/`;
let failed = 0;
const ok = (msg: string) => console.log(`  ok    ${msg}`);
const bad = (msg: string) => { failed++; console.log(`  FAIL  ${msg}`); };

console.log(`\n1. Only ${ALLOWED} changed`);
const git = (...a: string[]) => execFileSync('git', a, { cwd: ROOT, encoding: 'utf8' });
const changed = git('status', '--porcelain', '--untracked-files=all').split('\n').filter(Boolean)
  .map((l) => l.slice(3).replace(/^"|"$/g, '').split(' -> ').pop()!.replace(/\\/g, '/'));
const outside = changed.filter((f) => !f.startsWith(ALLOWED));
if (outside.length) bad(`these files are outside ${ALLOWED} and must be put back:\n          ${outside.join('\n          ')}`);
else ok(`${changed.length} changed file(s), all inside ${ALLOWED}`);

console.log('\n2. pack.json');
let raw: unknown = null;
try { raw = JSON.parse(fs.readFileSync(path.join(FOLDER, 'pack.json'), 'utf8')); } catch (err) { bad(`pack.json: ${(err as Error).message}`); }
if (raw) {
  const errs = countries.validate(raw, cc);
  const loaded = countries.loadAll();
  const clash = (loaded.problems[cc] ?? []).filter((e) => e.includes('already used'));
  for (const e of [...errs, ...clash]) bad(e);
  if (!errs.length && !clash.length) ok(`valid (status ${(raw as countries.Pack).status})`);
}

console.log('\n3. research.md');
const template = fs.readFileSync(path.join(countries.DIR, '_template', 'research.md'), 'utf8');
let research = '';
try { research = fs.readFileSync(path.join(FOLDER, 'research.md'), 'utf8'); } catch { bad('research.md is missing'); }
if (research) {
  const sections = [...template.matchAll(/^## (.+)$/gm)].map((m) => m[1]);
  const missing = sections.filter((s) => !research.includes(`## ${s}`));
  if (missing.length) bad(`missing sections: ${missing.join('; ')}`);
  else ok(`all ${sections.length} sections are there`);
  if (/<Country>|YYYY-MM-DD/.test(research)) bad('template placeholders (<Country>, YYYY-MM-DD) are still in it');
}

console.log('\n4. Country tests (Malaysia unchanged, every pack valid)');
const t = spawnSync(process.execPath, ['--test', 'src/countries.test.ts'], { cwd: LAB, encoding: 'utf8' });
const summary = (t.stdout ?? '').split('\n').filter((l) => /^ℹ (pass|fail)|^✖ /.test(l)).join('\n          ');
if (t.status === 0) ok(summary || 'passed');
else bad(`tests failed:\n          ${summary}`);

if (raw && !countries.validate(raw, cc).length) {
  const pack = { ...(raw as countries.Pack), search: (raw as countries.Pack).search ?? {}, discover: (raw as countries.Pack).discover ?? [], walled: (raw as countries.Pack).walled ?? [], notes: (raw as countries.Pack).notes ?? {} };
  console.log('\n5. What this pack adds to a dive on "Example Company Pte. Ltd."');
  console.log(`  codes   Brave ${pack.search.brave_country ?? '(default)'}, Tavily ${pack.search.tavily_country ?? '(default)'}, Exa ${pack.search.exa_location ?? 'MY (default)'}`);
  for (const [label, query, kind] of countries.discoverQueries(pack, { company: 'Example Company Pte. Ltd.', short: 'Example Company', country: pack.country })) console.log(`  brave   ${label} (${kind}): ${query}`);
  if (pack.walled.length) console.log(`  walled  ${pack.walled.join(', ')}`);
  for (const step of countries.NOTE_STEPS) {
    const added = countries.withNotes(pack, step, 'Answer with ONLY').replace(/Answer with ONLY$/, '').trim();
    if (added) console.log(`\n  --- ${step} prompt gets:\n  ${added.replace(/\n/g, '\n  ')}`);
  }
}

console.log(failed ? `\n${failed} check(s) FAILED. Fix them, then run this again.\n` : `\nAll checks passed. ${cc} is ready for review.\n`);
process.exit(failed ? 1 : 0);
