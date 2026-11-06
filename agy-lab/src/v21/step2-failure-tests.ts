// V2.1 Step 2 (tidy path) failure tests: every failure path is made to fail on purpose, on a real company's Step 1
// data, in a temporary copy of its run folder. The real run folder is hashed before and after and must not change.
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { analyseRunDirectory } from './analyse.ts';
import { checkJudgement } from './check-findings.ts';
import { envValue, getLlmLanes } from './cloud.ts';
import { parseAnswer, type Lane } from './judge.ts';
import type { TidyData } from './tidy.ts';
import { applyRecheck, recheckTidy } from './recheck.ts';

const DEAD_LANE: Lane = { label: 'dead-port', url: 'http://127.0.0.1:9', key: 'x', model: 'none' };

function hashDir(dir: string): string {
  const h = crypto.createHash('sha256');
  for (const f of fs.readdirSync(dir).sort()) h.update(f).update(fs.readFileSync(path.join(dir, f)));
  return h.digest('hex');
}

function copyRun(realDir: string): string {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'v21-step2-test-'));
  fs.copyFileSync(path.join(realDir, 'step1_research.json'), path.join(tmp, 'step1_research.json'));
  return tmp;
}

export async function runFailureTests(realDir: string): Promise<boolean> {
  const before = hashDir(realDir);
  const results: Array<{ name: string; pass: boolean; detail: string }> = [];
  const check = (name: string, pass: boolean, detail: string) => {
    results.push({ name, pass, detail });
    console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}\n      ${detail}`);
  };
  console.log(`Failure tests on a copy of ${path.basename(realDir)}\n`);

  // 1. Every lane refuses the connection.
  {
    const dir = copyRun(realDir);
    const r = await analyseRunDirectory(dir, { tidy: true, lanes: [DEAD_LANE], benchDb: false, recheck: true });
    const saved = JSON.parse(fs.readFileSync(path.join(dir, 'step2_analysis.json'), 'utf8'));
    check('all lanes dead -> status failed, saved, attempt recorded, recheck skipped with no LLM call',
      r.status === 'failed' && saved.status === 'failed' && r.meta?.attempts.length === 1 && !!r.meta.attempts[0].error && r.recheck?.status === 'skipped' && r.recheck.meta.attempts.length === 0,
      `status=${r.status} error="${r.error}" attempts=${JSON.stringify(r.meta?.attempts)}`);
  }

  // 2. A lane takes the call and never answers: caught as a dead call, not a hang.
  {
    const server = http.createServer(() => { /* never answer */ });
    await new Promise<void>((ok) => server.listen(0, '127.0.0.1', () => ok()));
    const port = (server.address() as any).port;
    const dir = copyRun(realDir);
    const t0 = Date.now();
    const r = await analyseRunDirectory(dir, {
      tidy: true,
      lanes: [{ label: 'silent', url: `http://127.0.0.1:${port}`, key: 'x', model: 'none' }],
      deadCallMs: 3000,
      benchDb: false,
    });
    server.closeAllConnections();
    server.close();
    const secs = (Date.now() - t0) / 1000;
    check('lane never answers -> given up as a dead call after the limit, status failed',
      r.status === 'failed' && /no answer in 3s/.test(r.error || '') && secs < 30,
      `status=${r.status} error="${r.error}" took=${secs.toFixed(1)}s`);
  }

  // 3. First lane dead, second answers with JSON cut off at the token limit, then the real hub lanes:
  //    both bad lanes are passed over and a real lane answers (live DeepSeek call).
  let live: any = null;
  let liveTidy: TidyData | null = null;
  {
    const cutOff = http.createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ finish_reason: 'length', message: { content: '{"findings": [{"title": "half' } }] }));
    });
    await new Promise<void>((ok) => cutOff.listen(0, '127.0.0.1', () => ok()));
    const port = (cutOff.address() as any).port;
    const dir = copyRun(realDir);
    const lanes = [DEAD_LANE, { label: 'cut-off', url: `http://127.0.0.1:${port}`, key: 'x', model: 'none' }, ...((await getLlmLanes()) as Lane[])];
    const r = await analyseRunDirectory(dir, { tidy: true, lanes, benchDb: false });
    cutOff.close();
    const a = r.meta?.attempts ?? [];
    check('dead lane, then cut-off answer -> both passed over, a real lane answers, all attempts recorded',
      r.status === 'analyzed' && a.length >= 3 && /fetch failed/.test(a[0].error || '') && /cut off/.test(a[1].error || '') && !a[a.length - 1].error && r.stats.llm_calls === a.length,
      `status=${r.status} error=${r.error ?? ''} lane=${r.meta?.lane} model=${r.meta?.model} attempts=${a.map((x) => `${x.lane}:${x.error ?? 'ok'}`).join(' | ')} findings=${r.findings.length} rejected=${r.stats.rejected_count}`);
    live = r;
    liveTidy = JSON.parse(fs.readFileSync(path.join(dir, 'step1_tidy.json'), 'utf8'));
  }

  // 4. Step 1 file truncated on disk.
  {
    const dir = copyRun(realDir);
    const p = path.join(dir, 'step1_research.json');
    fs.writeFileSync(p, fs.readFileSync(p, 'utf8').slice(0, 500));
    const r = await analyseRunDirectory(dir, { tidy: true, lanes: [DEAD_LANE], benchDb: false });
    check('truncated Step 1 file -> status failed, saved, no LLM call',
      r.status === 'failed' && /Malformed Step 1 JSON/.test(r.error || '') && fs.existsSync(path.join(dir, 'step2_analysis.json')),
      `status=${r.status} error="${r.error}"`);
  }

  // 5. The check refuses planted bad findings in the real answer from test 3, and keeps the real ones.
  let llm: any = null;
  try { llm = live?.llm_raw ? parseAnswer(live.llm_raw) : null; } catch { /* reported below */ }
  if (llm && liveTidy) {
    const realCount = checkJudgement(llm, liveTidy).findings.length;
    const e = liveTidy.evidence[0];
    const droppedId = (llm.dropped_namesakes ?? []).find((n: any) => liveTidy!.evidence.some((x) => x.id === n.evidence_id))?.evidence_id;
    const planted = [
      { why: 'evidence_id not in input', f: { type: 'contradiction', title: 'p1', evidence_id: 'E999', quoted_text: e.text.slice(0, 40) } },
      { why: 'quoted_text not in input', f: { type: 'contradiction', title: 'p2', evidence_id: e.id, quoted_text: 'Phone: +60 3-0000 1111 invented line' } },
      { why: 'type not allowed', f: { type: 'scandal', title: 'p3', evidence_id: e.id, quoted_text: e.text.slice(0, 40) } },
      { why: 'profile_drift not citing LINKEDIN', f: { type: 'profile_drift', title: 'p4', evidence_id: e.id, quoted_text: e.text.slice(0, 40) } },
      { why: 'disciplinary_warning not citing a register', f: { type: 'disciplinary_warning', title: 'p5', evidence_id: e.id, quoted_text: e.text.slice(0, 40) } },
      ...(droppedId
        ? [{ why: 'cites an item the same answer dropped', f: { type: 'contradiction', title: 'p6', evidence_id: droppedId, quoted_text: liveTidy.evidence.find((x) => x.id === droppedId)!.text.slice(0, 40) } }]
        : []),
    ];
    const out = checkJudgement({ ...llm, findings: [...(llm.findings ?? []), ...planted.map((p) => p.f)] }, liveTidy);
    const plantedRejected = planted.filter((p) => out.rejected.some((r) => r.finding.title === p.f.title));
    check(`checker refuses all ${planted.length} planted findings and keeps the ${realCount} real ones it kept before`,
      plantedRejected.length === planted.length && out.findings.length === realCount && out.findings.every((f) => !/^p\d$/.test(f.title)),
      planted.map((p) => `${p.why}: ${out.rejected.find((r) => r.finding.title === p.f.title)?.reasons.join('; ') ?? 'NOT REJECTED'}`).join('\n      '));
  } else {
    check('checker on planted findings', false, 'skipped: test 3 gave no readable live answer');
  }

  // 5b. profile_drift from a LinkedIn search hit (own LinkedIn read is off): accepted on linkedin.com/company only.
  {
    const ev = (id: string, url: string) => ({ id, kind: 'search', source_name: 'x', url, title: '', text: 'WhatsApp +6012 661 2139 for a quote', query: 'q' });
    const t = { evidence: [ev('E1', 'https://www.linkedin.com/company/dne-group'), ev('E2', 'https://my.linkedin.com/company/dne-group/'), ev('E3', 'https://example.com/company/linkedin.com/company/x'), ev('E4', 'https://www.linkedin.com/in/someone')], registers: [], own_linkedin: null } as unknown as TidyData;
    const mk = (id: string) => ({ type: 'profile_drift', title: `d-${id}`, evidence_id: id, quoted_text: 'WhatsApp +6012 661 2139' });
    const out = checkJudgement({ findings: ['E1', 'E2', 'E3', 'E4'].map(mk), dropped_namesakes: [] }, t);
    const kept = out.findings.map((f) => f.title);
    check('profile_drift: LinkedIn company search hits accepted, other URLs (a /in/ page, a lookalike path) refused',
      kept.length === 2 && kept.includes('d-E1') && kept.includes('d-E2') && out.rejected.length === 2,
      `kept=${kept} refused=${out.rejected.map((r) => `${r.finding.title}: ${r.reasons.join('; ')}`).join(' || ')}`);
  }

  // 6. Recheck: every lane dead -> recheck failed, the judge's live findings stand unchanged.
  if (live?.status === 'analyzed' && liveTidy) {
    const { result, findings } = await recheckTidy(liveTidy, live, { lanes: [DEAD_LANE] });
    check('recheck lanes dead -> recheck failed, judge findings stand unchanged',
      result.status === 'failed' && JSON.stringify(findings) === JSON.stringify(live.findings) && result.meta.attempts.length === 1,
      `recheck=${result.status} error="${result.error}" findings ${live.findings.length} -> ${findings.length}`);
  } else {
    check('recheck lanes dead', false, 'skipped: test 3 gave no live judge result');
  }

  // 7. Applying a bad recheck answer to the real judge findings: nothing malformed gets through.
  if (live?.status === 'analyzed' && liveTidy) {
    // Built from the live judge findings, whatever their number: a real one (or one made from a real item) plus a copy.
    const e = liveTidy.evidence[0];
    const a = live.findings[0] ?? { id: 'f1', type: 'contradiction', category: 'contact', title: 'from a real item', evidence_id: e.id, quoted_text: e.text.slice(0, 40), confidence: 'medium' };
    const b = { ...a, id: 'f2b', title: `${a.title} (copy)` };
    const judgeIn = { findings: [a, b], dropped_namesakes: live.dropped_namesakes };
    const bad = {
      reviews: [
        { finding_id: 'f99', verdict: 'remove', problems: ['no such finding'] },
        { finding_id: a.id, verdict: 'fix', problems: ['invented quote'], fixed: { quoted_text: 'a sentence that is nowhere in the input 12345' } },
        { finding_id: b.id, verdict: 'remove', problems: ['planted remove'] },
        { finding_id: b.id, verdict: 'keep', problems: [] }, // second review of the same finding: ignored
      ],
      missed: [
        { type: 'contradiction', title: 'planted missed, no such item', evidence_id: 'E999', quoted_text: 'x' },
        { type: 'contradiction', title: 'planted missed, real quote', evidence_id: e.id, quoted_text: e.text.slice(0, 40), category: 'contact' },
      ],
    };
    const out = applyRecheck(judgeIn, bad, liveTidy);
    const titles = out.findings.map((f) => f.title);
    const pass =
      out.reviews.length === 2 &&
      out.removed.length === 1 && out.removed[0].finding.id === b.id &&
      !titles.includes(a.title) && out.rejected.some((r) => r.finding.title === a.title && r.reasons.some((x) => /quoted_text/.test(x))) &&
      out.rejected.some((r) => r.finding.title === 'planted missed, no such item') &&
      out.added.length === 1 && out.added[0] === 'planted missed, real quote';
    check('bad recheck answer -> unknown id and duplicate ignored, invented fix refused by code, remove applied, only the provable missed finding added',
      pass,
      `reviews=${out.reviews.length} removed=${out.removed.map((r) => r.finding.id)} refused=${out.rejected.map((r) => `${r.finding.title}: ${r.reasons.join('; ')}`).join(' || ')} added=${JSON.stringify(out.added)}`);
  } else {
    check('bad recheck answer', false, 'skipped: test 3 gave no live judge result');
  }

  // 8. Benchmark store unreachable (hub URL that refuses connections): the run still finishes and saves its file.
  {
    const dir = copyRun(realDir);
    const r = await analyseRunDirectory(dir, { tidy: true, lanes: [DEAD_LANE], benchDb: 'http://127.0.0.1:9', recheck: true });
    check('bench store unreachable -> run finishes, file saved, error reported in output',
      fs.existsSync(path.join(dir, 'step2_analysis.json')) && !!r.bench?.error && r.bench.judge_id === null,
      `bench=${JSON.stringify(r.bench)}`);
  }

  // 9. Benchmark store on the live hub: one judge row and one recheck row pointing at it (run_folder = the temp copy).
  {
    const dir = copyRun(realDir);
    const r = await analyseRunDirectory(dir, { tidy: true, lanes: [DEAD_LANE], recheck: true });
    const hub = (process.env.LAB_URL ?? 'https://company-diver-production.up.railway.app').replace(/\/$/, '');
    const got: any = await fetch(`${hub}/api/v21/step2-bench?run_folder=${encodeURIComponent(path.basename(dir))}`, {
      headers: { authorization: `Bearer ${envValue('LAB_TOKEN')}` },
    }).then(async (x) => ({ status: x.status, body: await x.json().catch(() => null) }));
    const rows = ((got.body?.rows ?? []) as any[]).sort((a, b) => Number(a.id) - Number(b.id));
    check('bench store on the hub -> one judge row and one recheck row pointing at it',
      rows.length === 2 && rows[0].pass === 'judge' && rows[1].pass === 'recheck' && Number(rows[1].judge_id) === Number(rows[0].id) && r.bench?.recheck_id === Number(rows[1].id),
      `bench=${JSON.stringify(r.bench)} hub GET ${got.status} rows=${JSON.stringify(rows.map((x) => ({ id: x.id, pass: x.pass, judge_id: x.judge_id, status: x.status })))}`);
  }

  const after = hashDir(realDir);
  check('real run folder untouched', before === after, `sha256 before=${before.slice(0, 12)} after=${after.slice(0, 12)}`);

  const failed = results.filter((r) => !r.pass).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  return failed === 0;
}
