// The handler probe harness. For every task in probe/tasks.json a Claude Haiku agent writes a handler for one site,
// then THIS script checks the handler itself (the agent's word is never trusted) and writes the verdict w1.json that
// scripts/import-handlers.mjs reads. Everything lands under data/probe/<id>/.
//
//   node probe/run-probe.mjs [--countries TH] [--max N] [--only ID] [--concurrency 3] [--agent-timeout 900]
//   node probe/run-probe.mjs --status            done and pending per country
//   create the file probe/STOP (or press Ctrl-C) to stop after the running tasks finish; run again to resume.
//
// State: probe/state.json (one record per task), log: probe/log.jsonl, lock: probe/RUN.lock. Nothing in here ever
// throws a task out of the run: a failed task is recorded and labelled, and the next task goes on.
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(HERE, '..', 'data');
const PROBE = path.join(DATA, 'probe');
const TASKS = path.join(HERE, 'tasks.json');
const STATE = path.join(HERE, 'state.json');
const LOG = path.join(HERE, 'log.jsonl');
const LOCK = path.join(HERE, 'RUN.lock');
const STOP = path.join(HERE, 'STOP');
const RUNNER = path.join(HERE, 'runner.mjs');
const TEMPLATE = path.join(HERE, 'agent-prompt.md');
const EXAMPLE_HANDLER = process.env.EXAMPLE_HANDLER ?? 'G:/local-gmap-worker/handlers/AU/AU-abr.business.gov.au.w1.mjs';
const EXAMPLE_VERDICT = path.join(PROBE, 'AU-abr.business.gov.au', 'w1.json');
const MODEL = 'claude-haiku-5-5';
const REPAIR_ROUNDS = 2;
const TIER4_REASONS = new Set(['blocked', 'no_data', 'down']);

const argv = process.argv.slice(2);
const arg = (name, fallback = null) => { const i = argv.indexOf(name); return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : fallback; };
const has = (name) => argv.includes(name);
const countries = arg('--countries')?.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean) ?? null;
const max = arg('--max') ? Number(arg('--max')) : Infinity;
const only = arg('--only');
const concurrency = Math.max(1, Number(arg('--concurrency', 3)) || 3);
const agentTimeoutMs = (Number(arg('--agent-timeout', 900)) || 900) * 1000;

// ---------- small helpers (all crash-proof) ----------
const now = () => new Date().toISOString();
const readJson = (f, fallback) => { try { return JSON.parse(fs.readFileSync(f, 'utf8').replace(/^\uFEFF/, '')); } catch { return fallback; } };
const writeJson = (f, obj) => { const t = f + '.tmp'; fs.writeFileSync(t, JSON.stringify(obj, null, 2) + '\n'); fs.renameSync(t, f); };
const log = (event, task = '', note = '') => {
  try { fs.appendFileSync(LOG, JSON.stringify({ at: now(), event, task, note: String(note).slice(0, 400) }) + '\n'); } catch {}
  console.log(`${new Date().toLocaleTimeString()}  ${task ? task + '  ' : ''}${event}${note ? ' · ' + String(note).slice(0, 160) : ''}`);
};
const str = (v) => (typeof v === 'string' ? v : '');
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
const killTree = (pid) => { try { spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { timeout: 15000, windowsHide: true }); } catch {} };

const state = readJson(STATE, {});
const saveState = () => { try { writeJson(STATE, state); } catch (e) { console.error('could not save state: ' + e); } };
const setState = (id, patch) => { state[id] = { ...(state[id] ?? { id, status: 'queued', attempts: 0, tier: null, started: null, finished: null }), ...patch }; saveState(); };

function loadTasks() {
  const t = readJson(TASKS, { tasks: [] });
  return Array.isArray(t.tasks) ? t.tasks : [];
}

// ---------- --status ----------
function printStatus() {
  const tasks = loadTasks();
  const rows = new Map();
  for (const t of tasks) {
    const r = rows.get(t.country_code) ?? { total: 0, done: 0, running: 0, failed: 0, queued: 0, tiers: [0, 0, 0, 0] };
    rows.set(t.country_code, r);
    const s = state[t.id]?.status ?? 'queued';
    r.total++; r[s === 'done' ? 'done' : s === 'running' ? 'running' : s === 'failed' ? 'failed' : 'queued']++;
    if (s === 'done' && state[t.id].tier >= 1 && state[t.id].tier <= 4) r.tiers[state[t.id].tier - 1]++;
  }
  console.log('country  total  done  pending  (running failed queued)  tier1 tier2 tier3 tier4');
  const sum = { total: 0, done: 0, pending: 0, tiers: [0, 0, 0, 0] };
  for (const [cc, r] of [...rows].sort()) {
    const pending = r.total - r.done;
    console.log(`${cc.padEnd(7)}  ${String(r.total).padStart(5)}  ${String(r.done).padStart(4)}  ${String(pending).padStart(7)}  (${r.running} ${r.failed} ${r.queued})`.padEnd(58) + r.tiers.map((n) => String(n).padStart(5)).join(' '));
    sum.total += r.total; sum.done += r.done; sum.pending += pending; r.tiers.forEach((n, i) => { sum.tiers[i] += n; });
  }
  console.log(`${'all'.padEnd(7)}  ${String(sum.total).padStart(5)}  ${String(sum.done).padStart(4)}  ${String(sum.pending).padStart(7)}`.padEnd(58) + sum.tiers.map((n) => String(n).padStart(5)).join(' '));
  let lock = null; try { lock = Number(fs.readFileSync(LOCK, 'utf8')); } catch {}
  console.log(lock && alive(lock) ? `run in progress (pid ${lock})${fs.existsSync(STOP) ? ', STOP file present: stopping' : ''}` : 'no run in progress');
}
if (has('--status')) { printStatus(); process.exit(0); }

// ---------- the one running instance ----------
try {
  const old = Number(fs.readFileSync(LOCK, 'utf8'));
  if (old && old !== process.pid && alive(old)) { console.error(`another run is in progress (pid ${old}). Create probe/STOP to stop it, then start again.`); process.exit(1); }
} catch {}
fs.writeFileSync(LOCK, String(process.pid));
const releaseLock = () => { try { if (Number(fs.readFileSync(LOCK, 'utf8')) === process.pid) fs.rmSync(LOCK); } catch {} };
let stopping = false;
const requestStop = (why) => { if (!stopping) { stopping = true; log('stop_requested', '', why); } };
process.on('SIGINT', () => { if (stopping) { releaseLock(); process.exit(130); } requestStop('Ctrl-C: finishing the running tasks (press again to quit now; they are requeued on resume)'); });
process.on('uncaughtException', (e) => log('harness_error', '', e?.stack ?? e));
process.on('unhandledRejection', (e) => log('harness_error', '', e?.stack ?? e));

// ---------- the agent ----------
const countryNames = Object.fromEntries(readJson(path.join(HERE, '..', 'pairs.json'), []).map((p) => [p.country_code, p.country]));

function prepareFolder(task, dir) {
  fs.mkdirSync(path.join(dir, '_tools'), { recursive: true });
  fs.mkdirSync(path.join(dir, '_example'), { recursive: true });
  fs.copyFileSync(RUNNER, path.join(dir, '_tools', 'try.mjs'));
  try { fs.copyFileSync(EXAMPLE_HANDLER, path.join(dir, '_example', 'handler.mjs')); } catch {}
  const ex = readJson(EXAMPLE_VERDICT, null);
  if (ex) { // the verdict shape, without the long page text
    const { want, tier, method, pdf, canary, handler_file, tried, notes } = ex;
    fs.writeFileSync(path.join(dir, '_example', 'verdict.json'), JSON.stringify({ want, tier, method, pdf, canary, handler_file, tried, notes }, null, 2));
  }
  const w = task.wants[0];
  const prompt = fs.readFileSync(TEMPLATE, 'utf8')
    .replaceAll('{{COUNTRY_CODE}}', task.country_code).replaceAll('{{COUNTRY}}', countryNames[task.country_code] ?? task.country_code)
    .replaceAll('{{SOURCE_NAME}}', str(w.source_name)).replaceAll('{{SOURCE_URL}}', str(w.source_url))
    .replaceAll('{{WHAT_TO_SEE}}', str(w.question)).replaceAll('{{TASK_ID}}', task.id);
  fs.writeFileSync(path.join(dir, 'PROMPT.md'), prompt);
}

/** Runs the Haiku agent once in the task folder. Never throws; resolves { ok, ms, note }. */
function runAgent(dir, round, instruction) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    let out, err;
    try {
      out = fs.openSync(path.join(dir, `agent-${round}.json`), 'w');
      err = fs.openSync(path.join(dir, `agent-${round}.err`), 'w');
      const fake = process.env.PROBE_FAKE_AGENT; // test hook: a script that plays the agent, so the check paths can be proven offline
      const child = fake ? spawn(process.execPath, [fake, String(round)], { cwd: dir, stdio: ['ignore', out, err], windowsHide: true }) : spawn('claude', ['-p', instruction, '--model', MODEL, '--effort', 'high', '--permission-mode', 'bypassPermissions',
        '--setting-sources', '', '--strict-mcp-config', '--disable-slash-commands', '--no-session-persistence', '--output-format', 'json'],
      { cwd: dir, stdio: ['ignore', out, err], windowsHide: true });
      let done = false;
      const finish = (note) => { if (done) return; done = true; clearTimeout(timer); try { fs.closeSync(out); fs.closeSync(err); } catch {} resolve({ ms: Date.now() - t0, note }); };
      const timer = setTimeout(() => { killTree(child.pid); finish(`agent timed out after ${agentTimeoutMs / 1000}s`); }, agentTimeoutMs);
      child.on('error', (e) => finish('spawn error: ' + e.message));
      child.on('close', (code) => finish(`exit ${code}`));
    } catch (e) { try { fs.closeSync(out); fs.closeSync(err); } catch {} resolve({ ms: Date.now() - t0, note: 'spawn failed: ' + e.message }); }
  });
}

// ---------- the independent check ----------
/** Runs a handler like the worker PC does, with one keyword. Never throws. */
function runHandler(handlerFile, keyword) {
  const bad = (reason, excerpt) => ({ status: 'couldnt_check', reason, records: [], source_url: '', excerpt });
  try {
    const p = spawnSync(process.execPath, ['--permission', '--use-system-ca', `--allow-fs-read=${RUNNER}`, `--allow-fs-read=${handlerFile}`, RUNNER, handlerFile, keyword],
      { env: {}, encoding: 'utf8', timeout: 90_000, windowsHide: true, maxBuffer: 20 * 1024 * 1024 });
    const lines = str(p.stdout).trim().split('\n').filter(Boolean);
    try { return JSON.parse(lines[lines.length - 1]); } catch { return bad('other', `no JSON answer (exit ${p.status}) ${str(p.stderr).slice(0, 300)}`); }
  } catch (e) { return bad('other', 'could not run the handler: ' + e.message); }
}
const short = (r) => `${r?.status}/${r?.reason ?? ''}${Array.isArray(r?.records) ? ` records=${r.records.length}` : ''} ${str(r?.excerpt).slice(0, 160)}`;

/** Checks the draft and (tiers 1, 2) the handler. Returns { ok, failures[], draft, found, not_found }. */
function verify(dir) {
  const draft = readJson(path.join(dir, 'w1.draft.json'), null);
  if (!draft || typeof draft !== 'object') return { ok: false, failures: ['w1.draft.json is missing or is not valid JSON'], draft: null };
  const tier = Number(draft.tier);
  if (![1, 2, 3, 4].includes(tier)) return { ok: false, failures: [`w1.draft.json: tier must be 1, 2, 3 or 4, got ${JSON.stringify(draft.tier)}`], draft };
  if (tier === 3) {
    return str(draft.browser_steps).trim() ? { ok: true, failures: [], draft } : { ok: false, failures: ['tier 3 needs "browser_steps" as a non-empty string'], draft };
  }
  if (tier === 4) return { ok: true, failures: [], draft }; // reason and evidence are cleaned when the verdict is written
  const handler = path.join(dir, 'w1.handler.mjs');
  if (!fs.existsSync(handler)) return { ok: false, failures: ['tier 1/2 needs w1.handler.mjs but the file does not exist'], draft };
  const c = draft.canary;
  if (!c || !str(c.found).trim() || !str(c.not_found).trim() || c.found === c.not_found) return { ok: false, failures: ['"canary" needs two different non-empty names: found and not_found'], draft };
  const found = runHandler(handler, c.found);
  const notFound = runHandler(handler, c.not_found);
  const failures = [];
  if (draft.pdf === true) {
    if (found.status !== 'couldnt_check' || found.reason !== 'pdf') failures.push(`pdf handler, canary.found "${c.found}" must give couldnt_check with reason "pdf". Got: ${short(found)}`);
    if (notFound.status !== 'couldnt_check' || notFound.reason !== 'pdf') failures.push(`pdf handler, canary.not_found "${c.not_found}" must give couldnt_check with reason "pdf". Got: ${short(notFound)}`);
  } else {
    if (found.status !== 'found' || !Array.isArray(found.records) || found.records.length < 1) failures.push(`canary.found "${c.found}" must give status found with at least one record. Got: ${short(found)}`);
    if (notFound.status !== 'not_found') failures.push(`canary.not_found "${c.not_found}" must give status not_found. Got: ${short(notFound)}`);
  }
  return { ok: failures.length === 0, failures, draft, found, not_found: notFound };
}

// ---------- verdicts ----------
function writeVerdict(task, dir, v) {
  writeJson(path.join(dir, 'w1.json'), { want: 'w1', ...v, _written_by: 'probe harness', _received_at: now() });
}
const pick = (o, ...keys) => Object.fromEntries(keys.filter((k) => o?.[k] !== undefined).map((k) => [k, o[k]]));

function verdictFromCheck(task, dir, res, rounds) {
  const d = res.draft; const tier = Number(d.tier);
  const common = { rounds, ...pick(d, 'tried', 'notes') };
  if (tier === 3) return { tier, browser_steps: str(d.browser_steps), ...common };
  if (tier === 4) {
    const t4 = d.tier4 && typeof d.tier4 === 'object' ? d.tier4 : {};
    return { tier, tier4: { reason: TIER4_REASONS.has(t4.reason) ? t4.reason : 'no_data', evidence: str(t4.evidence).trim() || '(the agent gave no evidence)' }, ...common };
  }
  return { tier, method: str(d.method) || 'other', pdf: d.pdf === true, canary: { found: d.canary.found, not_found: d.canary.not_found },
    handler_file: `probe/${task.id}/w1.handler.mjs`, verified: { at: now(), found: res.found, not_found: res.not_found }, ...common };
}

/** The handler never passed the check: label the site tier 4 with the evidence, keep the failed handler. */
function demote(task, dir, res, rounds) {
  const failed = path.join(dir, 'w1.handler.mjs');
  const kept = path.join(dir, 'w1.failed.handler.mjs');
  try { if (fs.existsSync(failed)) fs.renameSync(failed, kept); } catch {}
  const seen = [res.found, res.not_found].filter(Boolean);
  const reasons = seen.map((r) => r.reason);
  const reason = reasons.includes('blocked') ? 'blocked' : reasons.some((r) => r === 'http_error' || r === 'timeout') ? 'down' : 'no_data';
  const evidence = `A handler was written but did not pass the harness check after ${rounds} agent rounds, so this site is labelled tier 4 (auto-demoted, the handler is kept as w1.failed.handler.mjs). Last check: ${res.failures.join(' | ')}`;
  return { tier: 4, tier4: { reason, evidence: evidence.slice(0, 1500) }, demoted: true, rounds, ...pick(res.draft ?? {}, 'tried', 'notes') };
}

let backoffUntil = 0; let backoffStep = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const RATE = /rate.?limit|\b429\b|overloaded|usage limit|too many requests|\b529\b/i;

// ---------- one task ----------
async function processTask(task) {
  const id = task.id; const dir = path.join(PROBE, id);
  const started = now();
  setState(id, { status: 'running', attempts: (state[id]?.attempts ?? 0) + 1, started, finished: null, note: '' });
  log('task_start', id, task.wants[0].source_url);
  try {
    fs.mkdirSync(dir, { recursive: true });
    prepareFolder(task, dir);
    let res = null; let delivered = false; let roundsUsed = 0;
    for (let round = 0; round <= REPAIR_ROUNDS; round++) {
      roundsUsed = round + 1;
      if (round > 0) {
        fs.writeFileSync(path.join(dir, 'REPAIR.md'), `# Repair round ${round}\n\nThe harness checked your last answer and it failed:\n\n${res.failures.map((f) => '- ' + f).join('\n')}\n\nFix the handler (or change the verdict if the evidence says a handler is impossible, tier 3 or 4 with evidence), then deliver w1.handler.mjs and w1.draft.json again. Run \`node _tools/try.mjs w1.handler.mjs "NAME"\` for both canaries before you answer.\n`);
      }
      try { fs.rmSync(path.join(dir, 'w1.draft.json')); } catch {}
      log('agent_start', id, `round ${round}`);
      let a = null;
      for (let tries = 0; tries < 8; tries++) { // a rate limit or overload is waited out, never counted as a failed round
        while (Date.now() < backoffUntil && !stopping) await sleep(5000);
        if (stopping) { setState(id, { status: 'queued', note: 'stopped while waiting; requeued' }); return; }
        a = await runAgent(dir, round, round === 0 ? 'Read PROMPT.md and do what it says' : 'Read PROMPT.md, then REPAIR.md, and do what they say');
        const gave = fs.existsSync(path.join(dir, 'w1.draft.json'));
        const text = ['json', 'err'].map((x) => { try { return fs.readFileSync(path.join(dir, `agent-${round}.${x}`), 'utf8').slice(0, 4000); } catch { return ''; } }).join(' ');
        if (!gave && RATE.test(text)) {
          backoffStep = Math.min(backoffStep + 1, 6);
          const wait = Math.min(60 * 2 ** (backoffStep - 1), 900);
          backoffUntil = Math.max(backoffUntil, Date.now() + wait * 1000);
          log('rate_limited', id, `waiting ${wait}s before trying again (try ${tries + 1})`);
          continue;
        }
        backoffStep = Math.max(0, backoffStep - 1);
        break;
      }
      res = verify(dir);
      delivered = delivered || fs.existsSync(path.join(dir, 'w1.draft.json')) || fs.existsSync(path.join(dir, 'w1.handler.mjs'));
      log('verify', id, `round ${round}: ${res.ok ? 'passed' : 'failed'} (${a.note}, ${Math.round(a.ms / 1000)}s)${res.ok ? '' : ' ' + res.failures[0]}`);
      if (res.ok) break;
    }
    let verdict;
    if (res.ok) verdict = verdictFromCheck(task, dir, res, roundsUsed);
    else if (!delivered) {
      // the agent delivered nothing at all: no evidence to write a verdict from. Label it failed; a resume retries it.
      setState(id, { status: 'failed', finished: now(), note: 'the agent delivered no handler and no draft in any round' });
      log('task_failed', id, 'the agent delivered nothing');
      return;
    } else verdict = demote(task, dir, res, roundsUsed);
    writeVerdict(task, dir, verdict);
    setState(id, { status: 'done', tier: verdict.tier, finished: now(), note: verdict.demoted ? 'auto-demoted to tier 4 (failed the harness check)' : verdict.tier === 4 ? 'tier 4 ' + verdict.tier4.reason : '' });
    log('task_done', id, `tier ${verdict.tier}${verdict.demoted ? ' (demoted)' : ''}`);
  } catch (e) {
    setState(id, { status: 'failed', finished: now(), note: 'harness error: ' + String(e?.message ?? e).slice(0, 200) });
    log('task_failed', id, 'harness error: ' + (e?.stack ?? e));
  }
}

// ---------- the run ----------
async function main() {
  try { fs.rmSync(STOP, { force: true }); } catch {}
  let stale = 0;
  for (const s of Object.values(state)) if (s.status === 'running') { s.status = 'queued'; stale++; }
  if (stale) { saveState(); log('requeued_stale', '', `${stale} task(s) were left running by an earlier run`); }

  const queue = loadTasks().filter((t) => (!countries || countries.includes(t.country_code)) && (!only || t.id === only) && state[t.id]?.status !== 'done').slice(0, max);
  for (const t of queue) if (!state[t.id]) setState(t.id, { status: 'queued' });
  log('run_start', '', `${queue.length} task(s), concurrency ${concurrency}, model ${MODEL}`);
  const runQueue = async (list) => {
    let next = 0;
    const worker = async () => {
      while (!stopping) {
        if (fs.existsSync(STOP)) { requestStop('STOP file found: finishing the running tasks'); break; }
        const t = list[next++]; if (!t) break;
        await processTask(t);
      }
    };
    await Promise.all(Array.from({ length: concurrency }, worker));
  };
  await runQueue(queue);
  for (let pass = 1; pass <= 2 && !stopping; pass++) { // a site that failed is tried again, never dropped
    const again = queue.filter((t) => state[t.id]?.status === 'failed');
    if (!again.length) break;
    log('retry_failed', '', `pass ${pass}: ${again.length} site(s)`);
    await runQueue(again);
  }
  const left = queue.filter((t) => state[t.id]?.status !== 'done').length;
  log(stopping ? 'run_stopped' : 'run_end', '', `${queue.length - left} of ${queue.length} done, ${left} pending`);
  try { fs.rmSync(STOP, { force: true }); } catch {}
  releaseLock();
}
main().catch((e) => { log('harness_error', '', e?.stack ?? e); releaseLock(); });
