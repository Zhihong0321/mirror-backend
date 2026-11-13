// Builds probe/tasks.json (the format scripts/import-handlers.mjs reads) from the country-layer answers.
//   node probe/make-tasks.mjs [--countries TH,MY] [--max 20] [--groups public_business_info,large_business_data]
// One task per host per country (host = hostname without "www."), first source of that host wins. Order inside a
// country and across countries: public_business_info, large_business_data, business_portal, local_social_forum, then the answer's own order.
// Hosts that already have data/probe/<id>/w1.json, or are already in G:/local-gmap-worker/handlers/index.json, are
// skipped. An existing tasks.json is merged into, never replaced: tasks already in it are kept as they are.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(HERE, '..', 'data');
const PROBE = path.join(DATA, 'probe');
const TASKS = path.join(HERE, 'tasks.json');
const LIBRARY_INDEX = process.env.HANDLERS_INDEX ?? 'G:/local-gmap-worker/handlers/index.json';
const GROUP_ORDER = ['public_business_info', 'large_business_data', 'business_portal', 'local_social_forum'];

const arg = (name) => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : null; };
const countries = arg('--countries')?.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean) ?? null;
const groups = arg('--groups')?.split(',').map((s) => s.trim()).filter(Boolean) ?? null;
const max = arg('--max') ? Number(arg('--max')) : Infinity;

const readJson = (f, fallback) => { try { return JSON.parse(fs.readFileSync(f, 'utf8').replace(/^\uFEFF/, '')); } catch { return fallback; } };
const hostOf = (url) => { try { return new URL(url).hostname.replace(/^www\./i, '').toLowerCase(); } catch { return null; } };

const existing = readJson(TASKS, { tasks: [] });
const tasks = Array.isArray(existing.tasks) ? existing.tasks : [];
const have = new Set(tasks.map((t) => t.id));
const inLibrary = new Set((readJson(LIBRARY_INDEX, { handlers: [] }).handlers ?? []).map((h) => h.task));

const answerDirs = fs.readdirSync(DATA).filter((d) => d.endsWith('-country-layer')).sort();
const fresh = []; let added = 0; const skipped = { done: 0, library: 0, exists: 0, badUrl: 0 };
for (const dir of answerDirs) {
  const cc = dir.slice(0, 2);
  if (countries && !countries.includes(cc)) continue;
  const answer = readJson(path.join(DATA, dir, 'round1.json'), null);
  const sources = Array.isArray(answer?.sources) ? answer.sources : [];
  const ordered = sources.map((s, i) => ({ s, i }))
    .filter(({ s }) => !groups || groups.includes(s.group))
    .sort((a, b) => (GROUP_ORDER.indexOf(a.s.group) + 1 || 99) - (GROUP_ORDER.indexOf(b.s.group) + 1 || 99) || a.i - b.i);
  const seen = new Set(); let n = 0;
  for (const { s } of ordered) {
    const host = hostOf(s.url);
    if (!host) { skipped.badUrl++; continue; }
    if (seen.has(host)) continue;
    seen.add(host);
    const id = `${cc}-${host}`;
    if (have.has(id)) { skipped.exists++; continue; }
    if (fs.existsSync(path.join(PROBE, id, 'w1.json'))) { skipped.done++; continue; }
    if (inLibrary.has(id)) { skipped.library++; continue; }
    if (n >= max) continue;
    fresh.push({ id, country_code: cc, host, group: s.group ?? null,
      wants: [{ want: 'w1', source_name: s.name ?? host, source_url: s.url, question: s.what_to_see ?? '' }] });
    have.add(id); n++; added++;
  }
}
// whole queue by value: every country's public_business_info first, then large_business_data, business_portal, local_social_forum
const rank = (t) => (GROUP_ORDER.indexOf(t.group) + 1 || 99);
fresh.map((t, i) => [t, i]).sort((a, b) => rank(a[0]) - rank(b[0]) || a[1] - b[1]).forEach(([t]) => tasks.push(t));
const tmp = TASKS + '.tmp';
fs.writeFileSync(tmp, JSON.stringify({ tasks }, null, 2) + '\n');
fs.renameSync(tmp, TASKS);
console.log(`tasks.json: ${tasks.length} tasks (+${added} new). skipped: ${skipped.exists} already in tasks.json, ${skipped.done} already have a verdict, ${skipped.library} already in the handler library, ${skipped.badUrl} bad url`);
