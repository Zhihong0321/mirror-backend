// Runs the country-layer research (pass 1) on the agy cloud hub, one AGY session per country, two turns each:
//   call 1  = the tracker's pass 1 brief
//   call 2  = the SAME session (same account, --conversation), told to go deeper on what is left; the earlier turns
//             are read from the hub's cache, so it is cheap
// The result (the second answer when it parsed, else the first) is posted to the tracker as pass 1.
//
// Before anything runs, the hub accounts are probed (agy_cloud.py --quota) and only the USABLE ones are used.
// Countries are pulled from one shared queue by the accounts, so a country that fails on one account (quota, 503
// "no capacity", timeout) goes back in the queue for another account, up to 3 attempts.
//
// Needs: the tracker running (node research-tracker/server.mjs), and a hub that supports --conversation.
//   node research-tracker/run-countries.mjs --dry                 show the plan, call nothing
//   node research-tracker/run-countries.mjs --only MY,SG          just these countries
//   node research-tracker/run-countries.mjs --accounts a,b,c      restrict to these hub accounts (still probed)
//   node research-tracker/run-countries.mjs --model gemini-3.8-flash-high   default is flash-medium
//   node research-tracker/run-countries.mjs --force               redo countries that already have a pass 1
// Nothing here drops an answer: whatever came back is stored, and labelled when it was not clean (_agy).
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const TRACKER = process.env.TRACKER_URL ?? 'http://127.0.0.1:4777';
const AGY = process.env.AGY_CLOUD_PY ?? path.join(os.homedir(), '.claude', 'skills', 'multi-cli-subagent', 'agy_cloud.py');
const CALL_TIMEOUT_S = 900;
const MAX_ATTEMPTS = 3;
const RUNS = path.join(process.env.TRACKER_DATA ?? path.join(here, 'data'), '_agy-runs');

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(`--${n}`);
const opt = (n) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined; };
const MODEL = opt('model') ?? 'gemini-3.8-flash-medium';

const SECOND_CALL = (country) => `Look again at ${country}. What did you miss, and what is left to find? Search further than before: the local language, local job portals, B2B and business directories, forums and local social media, chambers of commerce, trade associations, business news and startup portals, and any register, licence or certification site you did not list. Return the FULL updated JSON list in exactly the same format as before (every earlier source kept, new ones added), not a diff. JSON only, nothing around it.`;

/** Run agy_cloud.py; resolves {code, out, err}. Never rejects. */
function agy(args) {
  return new Promise((resolve) => {
    const child = spawn('python', ['-X', 'utf8', AGY, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', (e) => resolve({ code: -1, out, err: String(e) }));
    child.on('close', (code) => resolve({ code, out, err }));
  });
}

/** The first JSON object in a text (the model may wrap it in a code fence). Null when none parses. */
export function extractJson(text) {
  const s = String(text ?? '');
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(s.slice(start, end + 1)); } catch { return null; }
}

/** The accounts whose real Flash probe answers right now (agy_cloud.py --quota). Every other account is left out. */
export function usableFrom(quotaOutput) {
  return String(quotaOutput ?? '').split('\n').map((l) => l.trim().split(/\s+/)).filter((c) => c.length > 1 && c[1] === 'USABLE').map((c) => c[0]);
}

const log = (entry) => {
  try { fs.mkdirSync(RUNS, { recursive: true }); fs.appendFileSync(path.join(RUNS, 'log.jsonl'), JSON.stringify({ at: new Date().toISOString(), ...entry }) + '\n'); } catch {}
  console.log(`[${new Date().toISOString().slice(11, 19)}] ${entry.pair ?? ''} ${entry.event}${entry.note ? ' · ' + entry.note : ''}`);
};

/** One agy turn. Returns {ok, answer, conversation, cache, note}. */
async function turn(prompt, account, conversation) {
  const args = ['-a', account, '-m', MODEL, '--timeout', String(CALL_TIMEOUT_S), '--json', '-p', prompt];
  args.push(...(conversation ? ['--conversation', conversation] : ['--session']));
  const r = await agy(args);
  if (r.code !== 0) return { ok: false, note: (r.err || '').trim().slice(-300) || `exit ${r.code}`, rawErr: r.err };
  try {
    const d = JSON.parse(r.out);
    return { ok: true, answer: String(d.answer ?? ''), conversation: d.conversation_id ?? null, cache: d.usage?.cache_read_tokens ?? null, finished: d.finished_reason ?? null };
  } catch { return { ok: true, answer: r.out, conversation: null, cache: null, note: 'result was not JSON' }; }
}

/** One country on one account: call 1, then call 2 in the same session, then store. True when stored. */
async function runCountry(pair, account) {
  const id = pair.id;
  const brief = await fetch(`${TRACKER}/api/pairs/${id}/brief/1`).then((r) => r.text()).catch(() => '');
  if (!brief) { log({ pair: id, event: 'no brief from the tracker', note: 'is it running?' }); return false; }

  log({ pair: id, event: 'call 1', note: account });
  const c1 = await turn(brief, account);
  if (!c1.ok) {
    log({ pair: id, event: 'call 1 failed', note: `${account}: ${c1.note.replace(/\s+/g, ' ').slice(0, 200)}` });
    // The hub error can carry the start of a real answer: keep it on disk, it is not thrown away.
    try { fs.mkdirSync(path.join(RUNS, id), { recursive: true }); fs.appendFileSync(path.join(RUNS, id, 'call1-failed.txt'), `--- ${new Date().toISOString()} ${account}\n${c1.rawErr ?? c1.note}\n`); } catch {}
    return false;
  }

  let c2 = { ok: false, note: 'no conversation id came back from call 1' };
  if (c1.conversation) {
    log({ pair: id, event: 'call 2 (same session)', note: account });
    c2 = await turn(SECOND_CALL(pair.country), account, c1.conversation);
    if (!c2.ok) log({ pair: id, event: 'call 2 failed', note: c2.note.replace(/\s+/g, ' ').slice(0, 200) });
  }

  try {
    fs.mkdirSync(path.join(RUNS, id), { recursive: true });
    fs.writeFileSync(path.join(RUNS, id, 'call1.txt'), c1.answer);
    if (c2.ok) fs.writeFileSync(path.join(RUNS, id, 'call2.txt'), c2.answer);
  } catch {}

  const j1 = extractJson(c1.answer);
  const j2 = c2.ok ? extractJson(c2.answer) : null;
  const chosen = j2 ?? j1 ?? { sources: [], raw_answer: c2.ok ? c2.answer : c1.answer };
  const body = {
    ...chosen,
    _agy: {
      account, model: MODEL, conversation: c1.conversation ?? null,
      first_pass_sources: Array.isArray(j1?.sources) ? j1.sources.length : null,
      second_pass: c2.ok ? (j2 ? 'ok' : 'answer was not parseable JSON, first pass kept') : `failed: ${String(c2.note).replace(/\s+/g, ' ').slice(0, 200)}`,
      cache_read_tokens_2nd_call: c2.cache ?? null,
      unparsed: !j1 && !j2,
    },
  };
  const res = await fetch(`${TRACKER}/api/pairs/${id}/round/1`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    .then((r) => r.json()).catch((e) => ({ accepted: false, errors: [String(e)] }));
  log({ pair: id, event: res.accepted ? 'stored' : 'NOT stored', note: `${res.prompts ?? 0} sources, 1st pass ${body._agy.first_pass_sources ?? '?'}, 2nd call cache_read=${body._agy.cache_read_tokens_2nd_call}, ${body._agy.second_pass}${res.accepted ? '' : ' ' + JSON.stringify(res.errors)}` });
  return Boolean(res.accepted);
}

async function main() {
  const pairs = await fetch(`${TRACKER}/api/pairs`).then((r) => r.json()).catch(() => null);
  if (!pairs) { console.error(`Cannot reach the tracker at ${TRACKER}. Start it: node research-tracker/server.mjs`); process.exit(1); }
  const only = (opt('only') ?? '').split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
  const todo = pairs.filter((p) => p.kind === 'country' && (!only.length || only.includes(p.country_code)) && (flag('force') || p.round1 !== 'accepted'));

  let accounts = (opt('accounts') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!accounts.length) {
    const st = await agy(['--status']);
    accounts = st.out.split('\n').filter((l) => /^ {2}\S/.test(l)).map((l) => l.trim().split(/\s+/)[0]);
  }
  if (!accounts.length) { console.error('No hub accounts found (agy_cloud.py --status). Pass --accounts a,b,c.'); process.exit(1); }

  // Preflight: a real probe of every account. Only the USABLE ones run.
  if (!flag('dry')) {
    console.log(`Probing ${accounts.length} account(s) (agy_cloud.py --quota)...`);
    const q = await agy(['--quota']);
    console.log(q.out.trim());
    const usable = usableFrom(q.out).filter((a) => accounts.includes(a));
    log({ event: 'preflight', note: `usable: ${usable.join(', ') || 'none'} of ${accounts.length}` });
    if (!usable.length) { console.error('No usable account right now. Nothing was started. Try again later.'); process.exit(1); }
    accounts = usable;
  }

  console.log(`${todo.length} country layer(s), ${accounts.length} account(s): ${accounts.join(', ')}, model ${MODEL}`);
  if (flag('dry')) return;

  // One shared queue; each account takes the next country when it is free. A failed country goes back for another
  // account (never the same one twice in a row), up to MAX_ATTEMPTS.
  const queue = todo.map((p) => ({ pair: p, attempts: 0, avoid: null }));
  const gaveUp = [];
  const pool = () => Promise.all(accounts.map(async (account) => {
    for (;;) {
      const i = queue.findIndex((q) => q.avoid !== account || accounts.length === 1);
      if (i < 0) return;
      const item = queue.splice(i, 1)[0];
      item.attempts++;
      let ok = false;
      try { ok = await runCountry(item.pair, account); } catch (e) { log({ pair: item.pair.id, event: 'error (continuing)', note: String(e?.message ?? e) }); }
      if (!ok) {
        if (item.attempts < MAX_ATTEMPTS) { item.avoid = account; queue.push(item); log({ pair: item.pair.id, event: 'back in the queue', note: `attempt ${item.attempts} of ${MAX_ATTEMPTS} failed on ${account}` }); }
        else { gaveUp.push(item.pair.id); log({ pair: item.pair.id, event: 'NOT DONE', note: `${MAX_ATTEMPTS} attempts failed` }); }
      }
    }
  }));
  await pool();
  // A country put back after every other account had already finished is still waiting: sweep until the queue is empty.
  for (let sweep = 0; queue.length && sweep < MAX_ATTEMPTS; sweep++) { queue.forEach((q) => { q.avoid = null; }); await pool(); }
  console.log(gaveUp.length ? `Done, but not done: ${gaveUp.join(', ')}` : 'Done.', 'Pass 2 (testing each source) is a separate run.');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) main();
