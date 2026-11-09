// PL26: accuracy per generator version and section, from the owner's labels and exported report JSON. Offline only.
//   node scripts/golden-score.ts [golden-dir]   -> prints the table, writes <golden-dir>/accuracy.html
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export type Label = { report_id?: string; id: string; section: string; verdict: 'true' | 'false' | 'unsure'; note?: string };
export type Cell = { yes: number; no: number; unsure: number };
export type Scores = { versions: string[]; sections: string[]; cells: Record<string, Record<string, Cell>> };

const readJson = (file: string) => JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
const dirs = (dir: string) => (existsSync(dir) ? readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort() : []);

/** The ids of every item in a saved report: any object with a string id inside a top-level list. */
export function itemIds(report: any): Set<string> {
  const ids = new Set<string>();
  for (const value of Object.values(report ?? {})) {
    if (Array.isArray(value)) for (const x of value) if (x && typeof x === 'object' && typeof x.id === 'string') ids.add(x.id);
  }
  return ids;
}

export function scoreGolden(dir: string): Scores {
  const labelDir = join(dir, 'labels');
  const files = existsSync(labelDir) ? readdirSync(labelDir).filter((f) => f.endsWith('.json')).sort() : [];
  const versions = dirs(join(dir, 'reports'));
  const cells: Scores['cells'] = {};
  const sections = new Set<string>();
  for (const version of versions) {
    cells[version] = {};
    for (const file of files) {
      const labels: Label[] = readJson(join(labelDir, file)).items ?? [];
      const reportFile = join(dir, 'reports', version, file);
      if (!labels.length || !existsSync(reportFile)) continue;
      const report = readJson(reportFile);
      const ids = itemIds(report);
      for (const l of labels) {
        if (!ids.has(l.id) || (l.report_id && report.report_id && l.report_id !== report.report_id)) continue;
        sections.add(l.section);
        const cell = (cells[version][l.section] ??= { yes: 0, no: 0, unsure: 0 });
        if (l.verdict === 'true') cell.yes++; else if (l.verdict === 'false') cell.no++; else cell.unsure++;
      }
    }
  }
  return { versions, sections: [...sections].sort(), cells };
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const percent = (c?: Cell) => (c && c.yes + c.no ? `${Math.round((100 * c.yes) / (c.yes + c.no))}%` : '-');

export function renderTable(s: Scores): string {
  const head = `<tr><th>Version</th>${s.sections.map((x) => `<th>${esc(x)}</th>`).join('')}</tr>`;
  const rows = s.versions.map((v) => `<tr><th>${esc(v)}</th>${s.sections.map((x) => {
    const c = s.cells[v][x];
    return `<td>${percent(c)}<small> n=${c ? c.yes + c.no : 0}</small></td>`;
  }).join('')}</tr>`).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Golden set accuracy</title>
<style>body{font-family:system-ui,sans-serif;margin:24px}table{border-collapse:collapse}th,td{border:1px solid #ccc;padding:6px 12px;text-align:right}th:first-child{text-align:left}small{color:#666}</style></head>
<body><h1>Golden set accuracy</h1><p>Share of labelled items that are true, per generator version and section (unsure labels left out).</p>
<table>${head}${rows}</table></body></html>`;
}

export function run(dir: string): Scores {
  const s = scoreGolden(dir);
  writeFileSync(join(dir, 'accuracy.html'), renderTable(s));
  console.log(['version', ...s.sections].join('\t'));
  for (const v of s.versions) console.log([v, ...s.sections.map((x) => `${percent(s.cells[v][x])} (n=${s.cells[v][x] ? s.cells[v][x].yes + s.cells[v][x].no : 0})`)].join('\t'));
  return s;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  run(process.argv[2] ?? fileURLToPath(new URL('../golden', import.meta.url)));
}
