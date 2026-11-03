// Research tracker: a local page where 125 (country, industry) research runs are monitored, and where
// an outside AI tool (an IDE, a CLI) submits its JSON answer for each pass.
//
// Run from agy-lab/:   node research-tracker/server.mjs      then open http://127.0.0.1:4777
// Listens on 127.0.0.1 only, so it is not reachable from other machines.
// Nothing here touches the hub: no shared code, no shared data, no deploy.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const DATA = process.env.TRACKER_DATA ?? path.join(here, 'data');
const PORT = Number(process.env.TRACKER_PORT ?? 4777);
const HOST = '127.0.0.1';
const MAX_BODY = 1024 * 1024;

const pairs = JSON.parse(fs.readFileSync(path.join(here, 'pairs.json'), 'utf8'));
const pairById = new Map(pairs.map((p) => [p.id, p]));
const briefTemplate = fs.readFileSync(path.join(here, 'brief.md'), 'utf8');
const S = JSON.parse(fs.readFileSync(path.join(here, 'schema.json'), 'utf8'));
fs.mkdirSync(DATA, { recursive: true });

// ---------- storage: one folder per pair; round1.json and round2.json hold only accepted answers ----------

const roundFile = (id, n) => path.join(DATA, id, `round${n}.json`);
const readRound = (id, n) => {
  const f = roundFile(id, n);
  return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null;
};
const logLine = (entry) => fs.appendFileSync(path.join(DATA, 'log.jsonl'), JSON.stringify({ at: new Date().toISOString(), ...entry }) + '\n');
const rejectedCount = (id, n) => {
  const f = path.join(DATA, 'log.jsonl');
  if (!fs.existsSync(f)) return 0;
  return fs.readFileSync(f, 'utf8').split('\n').filter((l) => l && l.includes(`"pair":"${id}"`) && l.includes(`"round":${n}`) && l.includes('"result":"rejected"')).length;
};

// The last three rejected submissions for a pair, with their errors, so the monitor can say why.
function recentRejections(id) {
  const f = path.join(DATA, 'log.jsonl');
  if (!fs.existsSync(f)) return [];
  return fs.readFileSync(f, 'utf8').split('\n').filter((l) => l && l.includes(`"pair":"${id}"`) && l.includes('"result":"rejected"'))
    .slice(-3).map((l) => JSON.parse(l));
}

function pairStatus(id) {
  const r1 = readRound(id, 1);
  const r2 = readRound(id, 2);
  return {
    round1: r1 ? 'accepted' : 'todo',
    round2: r2 ? 'accepted' : r1 ? 'todo' : 'locked',
    rejected: rejectedCount(id, 1) + rejectedCount(id, 2),
    prompts1: r1 ? r1.prompts.length : 0,
    prompts2: r2 ? r2.prompts.length : 0,
    submitted_at: { round1: r1?._received_at ?? null, round2: r2?._received_at ?? null },
  };
}

// ---------- validation: the answer must match schema.json and the brief's rules ----------

function validate(body) {
  const errs = [];
  const str = (v) => typeof v === 'string' && v.trim().length > 0;
  if (!body || typeof body !== 'object' || Array.isArray(body)) return ['the body must be one JSON object'];
  if (!Array.isArray(body.test_firms) || body.test_firms.length < 3 || !body.test_firms.every(str)) {
    errs.push('test_firms: name at least 3 real businesses that the prompts were tested on');
  }
  if (!Array.isArray(body.prompts) || body.prompts.length < 1 || body.prompts.length > 12) {
    errs.push('prompts: a list of 1 to 12 prompts');
    return errs;
  }
  const ranks = new Set();
  body.prompts.forEach((p, i) => {
    const at = `prompts[${i}]`;
    if (!p || typeof p !== 'object' || Array.isArray(p)) { errs.push(`${at}: must be an object`); return; }
    if (!Number.isInteger(p.rank) || p.rank < 1 || p.rank > 12 || ranks.has(p.rank)) errs.push(`${at}.rank: a unique whole number from 1 to 12`);
    else ranks.add(p.rank);
    if (!S.categories.includes(p.category)) errs.push(`${at}.category: must be one of ${S.categories.join(', ')}`);
    if (!Array.isArray(p.problem_type) || p.problem_type.length < 1 || !p.problem_type.every((x) => S.problem_types.includes(x))) {
      errs.push(`${at}.problem_type: one or more of ${S.problem_types.join(', ')}`);
    }
    if (!str(p.question) || p.question.trim().length < 15) errs.push(`${at}.question: a specific question, at least 15 characters`);
    if (!str(p.why_it_matters)) errs.push(`${at}.why_it_matters: required`);
    const src = p.source && typeof p.source === 'object' ? p.source : {};
    if (!str(src.name)) errs.push(`${at}.source.name: required`);
    if (typeof src.url !== 'string' || !/^https?:\/\/\S+$/.test(src.url)) errs.push(`${at}.source.url: a real http or https address`);
    if (!S.access.includes(src.access)) errs.push(`${at}.source.access: one of ${S.access.join(', ')}`);
    if (!str(src.language)) errs.push(`${at}.source.language: required`);
    if (!str(p.how_to_query)) errs.push(`${at}.how_to_query: required`);
    for (const k of ['found_when', 'not_found_when', 'couldnt_check_when']) {
      if (!str(p[k])) errs.push(`${at}.${k}: required (say when a lookup finds nothing, and when it cannot be checked)`);
    }
    if (!S.used_in.includes(p.used_in)) errs.push(`${at}.used_in: one of ${S.used_in.join(', ')}`);
    if (!S.confidence.includes(p.confidence)) errs.push(`${at}.confidence: one of ${S.confidence.join(', ')}`);
    if (!Array.isArray(p.tested) || p.tested.length < 1 ||
        p.tested.some((t) => !t || !str(t.firm) || !/^\d{4}-\d{2}-\d{2}$/.test(t.date ?? '') || !str(t.result))) {
      errs.push(`${at}.tested: at least one {firm, date as YYYY-MM-DD, result}`);
    }
  });
  if (body.sources_rejected !== undefined && !Array.isArray(body.sources_rejected)) errs.push('sources_rejected: a list');
  if (body.open_questions !== undefined && !Array.isArray(body.open_questions)) errs.push('open_questions: a list');
  return errs;
}

// ---------- the brief for one pass ----------

function briefFor(pair, n) {
  let text = briefTemplate.replaceAll('{{COUNTRY}}', pair.country).replaceAll('{{INDUSTRY}}', pair.industry);
  if (n === 2) {
    const r1 = readRound(pair.id, 1);
    if (!r1) return null;
    // Drop the tracker's own fields (_received_at, _pair, _round): the AI answers only the brief's fields.
    const pass1 = Object.fromEntries(Object.entries(r1).filter(([k]) => !k.startsWith('_')));
    text += `\n\n## Round 2: check and improve your own first pass\n\n` +
      `Below is the answer you gave in round 1, as accepted. Re-open each source yourself. Then:\n` +
      `- drop any prompt that did not work on the test businesses, or that asks something a register does not show;\n` +
      `- replace weak prompts with sharper ones that name a specific body, register field or page;\n` +
      `- add prompts for gaps the first pass left, but still at most 12 in total;\n` +
      `- keep a prompt unchanged only if you re-tested it this round, and record the new test.\n` +
      `Return the full round 2 answer in the same JSON format, not a diff.\n\n` +
      `Round 1 answer:\n\`\`\`json\n${JSON.stringify(pass1, null, 2)}\n\`\`\`\n`;
  }
  return text;
}

// ---------- HTTP ----------

const send = (res, code, body, type = 'application/json; charset=utf-8') => {
  res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(typeof body === 'string' ? body : JSON.stringify(body, null, 2));
};

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject(new Error('body over 1 MB')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${HOST}`);
  const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
  try {
    if (req.method === 'GET' && parts.length === 0) {
      return send(res, 200, fs.readFileSync(path.join(here, 'index.html'), 'utf8'), 'text/html; charset=utf-8');
    }
    if (req.method === 'GET' && url.pathname === '/api/pairs') {
      return send(res, 200, pairs.map((p) => ({ ...p, ...pairStatus(p.id) })));
    }
    if (parts[0] === 'api' && parts[1] === 'pairs' && parts[2]) {
      const pair = pairById.get(parts[2]);
      if (!pair) return send(res, 404, { error: `no pair ${parts[2]}` });

      // GET /api/pairs/:id : pair, status, and both accepted answers
      if (req.method === 'GET' && parts.length === 3) {
        // Status keys (round1, round2) are strings; the stored answers are under answer1 and answer2.
        return send(res, 200, { ...pair, ...pairStatus(pair.id), answer1: readRound(pair.id, 1), answer2: readRound(pair.id, 2), rejections: recentRejections(pair.id) });
      }
      // GET /api/pairs/:id/brief/:n : the text an outside tool should answer (plain text)
      if (req.method === 'GET' && parts[3] === 'brief' && (parts[4] === '1' || parts[4] === '2')) {
        const text = briefFor(pair, Number(parts[4]));
        if (text === null) return send(res, 409, { error: 'round 1 is not accepted yet, so round 2 is locked' }, 'application/json; charset=utf-8');
        return send(res, 200, text, 'text/plain; charset=utf-8');
      }
      // POST /api/pairs/:id/round/:n : submit an answer; only a valid one is stored
      if (req.method === 'POST' && parts[3] === 'round' && (parts[4] === '1' || parts[4] === '2')) {
        const n = Number(parts[4]);
        if (n === 2 && !readRound(pair.id, 1)) return send(res, 409, { error: 'round 1 is not accepted yet, so round 2 is locked' });
        let body;
        try { body = JSON.parse(await readBody(req)); } catch (err) {
          logLine({ pair: pair.id, round: n, result: 'rejected', errors: [`not valid JSON: ${err.message}`] });
          return send(res, 400, { accepted: false, errors: [`not valid JSON: ${err.message}`] });
        }
        const errors = validate(body);
        if (errors.length) {
          logLine({ pair: pair.id, round: n, result: 'rejected', errors });
          return send(res, 422, { accepted: false, errors });
        }
        fs.mkdirSync(path.join(DATA, pair.id), { recursive: true });
        const stored = { ...body, _received_at: new Date().toISOString(), _pair: pair.id, _round: n };
        fs.writeFileSync(roundFile(pair.id, n), JSON.stringify(stored, null, 2) + '\n');
        logLine({ pair: pair.id, round: n, result: 'accepted', prompts: body.prompts.length });
        return send(res, 200, { accepted: true, pair: pair.id, round: n, prompts: body.prompts.length });
      }
    }
    return send(res, 404, { error: 'not found' });
  } catch (err) {
    return send(res, 500, { error: err.message });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Research tracker: http://${HOST}:${PORT}  (${pairs.length} pairs)`);
});
