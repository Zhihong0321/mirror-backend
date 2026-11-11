// G / search — how an AI assistant WITH web search sees the company (docs/g-search-lane-design.md).
// It replaces G-fixed (DeepSeek from memory) and G-grounded (Exa pasted into DeepSeek). The assistant is Gemini on the
// cloud Antigravity hub (my-agy), which searches the web by itself. No judge: the assistant's answer is the answer.
//
//   Prompt A  the 9 company questions in one prompt, "max 50 words", reply is JSON {id: {answer, sources}}
//   Prompt B  the 2 trade questions in their own prompt, the company's name appears nowhere in it; reply also names companies
//   Prompt C  one comparison prompt that names no competitor: the assistant says who the closest ones are
// Each prompt is sent REPEAT times (default 3), each copy to a different hub worker, all at once.
//
// LLM wait rule (owner): a slow call is never killed and restarted. When a call has run longer than SLOW_SEC, an idle worker
// is given the same prompt and the first valid answer is used; the first call keeps running and is simply not waited for.
// A worker that errors (quota, auth, not JSON) is skipped for that prompt and the next worker is tried.
import { secrets } from '../../core/index.ts';
import { parseJson, secret, type Ctx, type Finding } from '../lib.ts';
import { profileOf, type Profile } from './G-shared.ts';

const REPEAT = Math.max(1, Number(process.env.DD_G_REPEAT ?? 3) || 1);
const SLOW_SEC = Math.max(1, Number(process.env.DD_G_SLOW_SEC ?? 240) || 240);
export const ASSISTANT = 'Gemini (web search)';

export type Prompt = { id: string; kind: 'company' | 'trade' | 'compare'; text: string };

/** The eleven fixed questions (the same templates G-fixed used), then the comparison. */
export function questions(p: Profile): Prompt[] {
  return [
    { id: 'what', kind: 'company', text: `What is ${p.name}?` },
    { id: 'reliable', kind: 'company', text: `Is ${p.name} in ${p.area} a reliable ${p.trade}? Would you recommend them?` },
    { id: 'phone', kind: 'company', text: `What is the phone number of ${p.name}?` },
    { id: 'website', kind: 'company', text: `What is the official website of ${p.name}?` },
    { id: 'address', kind: 'company', text: `Where is the office of ${p.name}? Please give the address.` },
    { id: 'founded', kind: 'company', text: `When was ${p.name} founded, and who owns or runs it?` },
    { id: 'services', kind: 'company', text: `What products and services does ${p.name} offer?` },
    { id: 'licences', kind: 'company', text: `What licences, registrations or certifications does ${p.name} hold?` },
    { id: 'complaints', kind: 'company', text: `Has ${p.name} had any complaints, scams or legal problems?` },
    { id: 'best', kind: 'trade', text: `Who are the best ${p.trades} in ${p.area}? Please name specific companies.` },
    { id: 'hire', kind: 'trade', text: `I live in ${p.area}, ${p.state} and I want to ${p.job}. Which companies should I contact?` },
    { id: 'compare', kind: 'compare', text: `I live in ${p.area}, ${p.state} and I want to ${p.job}. Who are the closest competitors of ${p.name}, and how does ${p.name} compare with them?` },
  ];
}

const LINES = (qs: Prompt[]) => qs.map((q) => `- ${q.id}: ${q.text}`).join('\n');
const SEARCH = 'Search the web as needed.';
const WORDS = 'max 50 words';

export function promptA(qs: Prompt[]): string {
  return `Answer each question below as you would to a customer.\n${LINES(qs.filter((q) => q.kind === 'company'))}\n\n${SEARCH} Reply with ONLY one JSON object, no other text, where each key is the question id and each value is {"answer": "${WORDS}", "sources": ["URLs you used, or an empty list if you did not search"]}.`;
}
export function promptB(qs: Prompt[]): string {
  return `Answer each question below as you would to a customer.\n${LINES(qs.filter((q) => q.kind === 'trade'))}\n\n${SEARCH} Reply with ONLY one JSON object, no other text, where each key is the question id and each value is {"answer": "${WORDS}", "companies": ["the names of the businesses you name or recommend"], "sources": ["URLs you used, or an empty list if you did not search"]}.`;
}
export function promptC(qs: Prompt[]): string {
  const q = qs.find((x) => x.kind === 'compare')!;
  return `${q.text}\n\n${SEARCH} Reply with ONLY one JSON object, no other text, with the keys "closest_competitors" (a list of business names), "reputation", "services", "credentials", "price_signals", "recommend" and "weakest" (each ${WORDS}: "weakest" is what makes the company asked about look weaker than the others online), and "sources" (a list of URLs you used).`;
}

const strings = (v: unknown): string[] => (Array.isArray(v) ? v : []).map((x) => String(x ?? '').trim()).filter(Boolean);

/** A valid reply to A or B: an object with a non-empty answer for every expected id. Null when it is not. */
export function readAnswers(text: string, ids: string[]): Record<string, { answer: string; sources: string[]; companies: string[] }> | null {
  const j = parseJson<Record<string, any>>(text);
  if (!j || Array.isArray(j)) return null;
  const out: Record<string, { answer: string; sources: string[]; companies: string[] }> = {};
  for (const id of ids) {
    const answer = String(j[id]?.answer ?? '').trim();
    if (!answer) return null;
    out[id] = { answer, sources: strings(j[id]?.sources), companies: strings(j[id]?.companies) };
  }
  return out;
}

const COMPARE_KEYS = ['reputation', 'services', 'credentials', 'price_signals', 'recommend', 'weakest'] as const;
export type Compare = { closest_competitors: string[]; sources: string[] } & Record<(typeof COMPARE_KEYS)[number], string>;
/** A valid reply to C: the competitors it named and each text key. Null when it is not. */
export function readCompare(text: string): Compare | null {
  const j = parseJson<Record<string, any>>(text);
  if (!j || Array.isArray(j)) return null;
  const closest_competitors = strings(j.closest_competitors);
  if (!closest_competitors.length) return null;
  const out: any = { closest_competitors, sources: strings(j.sources) };
  for (const k of COMPARE_KEYS) {
    out[k] = String(j[k] ?? '').trim();
    if (!out[k]) return null;
  }
  return out;
}

// ---------------------------------------------------------------- the hub

/** The cloud Antigravity hub: worker names, and one prompt to one worker that resolves with the answer text. */
export type Hub = {
  workers(): Promise<string[]>;
  ask(prompt: string, account: string): Promise<string>;
};

/** Asked through POST /api/jobs and polled, so no request stays open long. A slow job is waited for, never cut. */
export function liveHub(): Hub {
  const base = (process.env.AGY_REMOTE_URL ?? 'https://my-agy.up.railway.app').replace(/\/+$/, '');
  // The hub database's saved token (/workers, "Antigravity hub token"), else the AGY_REMOTE_TOKEN variable, else the local vault.
  const readToken = async () => { await secrets.load(); return secret('AGY_REMOTE_TOKEN') || secret('AGY_WEB_CLOUD'); };
  const call = async (path: string, init?: { body?: unknown }) => {
    const token = await readToken();
    if (!token) throw new Error('no Antigravity hub token: save it on /workers ("Antigravity hub token") or set AGY_REMOTE_TOKEN');
    const res = await fetch(base + path, {
      method: init ? 'POST' : 'GET',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: init ? JSON.stringify(init.body) : undefined,
      signal: AbortSignal.timeout(45_000),
    });
    const text = await res.text();
    let json: any = null;
    try { json = JSON.parse(text); } catch { /* not JSON */ }
    return { status: res.status, json, text };
  };
  return {
    async workers() {
      const r = await call('/api/status');
      if (r.status !== 200 || !r.json?.accounts) throw new Error(`hub status HTTP ${r.status}: ${r.text.slice(0, 150)}`);
      return Object.entries(r.json.accounts).filter(([, a]: [string, any]) => a?.enabled !== false).map(([name]) => name);
    },
    async ask(prompt, account) {
      const sub = await call('/api/jobs', { body: { prompt, account, timeout: 3600 } });
      if (sub.status >= 300 || !sub.json?.job_id) throw new Error(`hub submit HTTP ${sub.status}: ${sub.text.slice(0, 150)}`);
      let failures = 0;
      for (;;) {
        let r: Awaited<ReturnType<typeof call>>;
        try { r = await call(`/api/jobs/${sub.json.job_id}?wait=20`); failures = 0; }
        catch (e) { if (++failures >= 6) throw new Error(`hub poll failed 6 times in a row: ${(e as Error).message}`); continue; }
        if (r.status === 404) throw new Error('hub job expired or unknown');
        if (r.status >= 500) { if (++failures >= 6) throw new Error(`hub poll HTTP ${r.status}`); continue; }
        const j = r.json ?? {};
        if (j.status === 'done' || j.status === 'failed') {
          if (j.ok === false || j.status === 'failed' || !j.answer) throw new Error(String(j.error ?? 'the worker returned no answer').slice(0, 200));
          return String(j.answer);
        }
      }
    },
  };
}

// ---------------------------------------------------------------- the scheduler

type Job<T> = {
  key: string; prompt: string; read: (text: string) => T | null;
  tried: Set<string>; running: Map<string, number>; errors: string[];
  done: { value: T; account: string; ms: number } | null; gaveUp: boolean;
};

/**
 * Runs every job once. One loop per worker (a worker does one prompt at a time). A job goes to a worker that has not tried it.
 * A job whose only running call is older than slowMs is given to an idle worker too; the first valid answer wins and the
 * first call is left running. A job is given up only when every worker has tried it and none is still running it.
 */
export async function runJobs<T>(
  jobs: { key: string; prompt: string; read: (text: string) => T | null }[], workers: string[], hub: Hub,
  opts: { slowMs?: number; sleep?: (ms: number) => Promise<void>; now?: () => number; say?: (m: string) => void } = {},
): Promise<Map<string, Job<T>>> {
  const slowMs = opts.slowMs ?? SLOW_SEC * 1000;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = opts.now ?? Date.now;
  const say = opts.say ?? (() => {});
  const all = new Map<string, Job<T>>(jobs.map((j) => [j.key, { ...j, tried: new Set(), running: new Map(), errors: [], done: null, gaveUp: false }]));
  const settled = () => [...all.values()].every((j) => j.done || j.gaveUp);
  let finish!: () => void;
  const finished = new Promise<void>((r) => { finish = r; });
  const check = () => {
    for (const j of all.values()) if (!j.done && !j.gaveUp && !j.running.size && j.tried.size >= workers.length) j.gaveUp = true;
    if (settled()) finish();
  };
  const pick = (account: string): { job: Job<T>; copy: boolean } | null => {
    for (const j of all.values()) if (!j.done && !j.gaveUp && !j.running.size && !j.tried.has(account)) return { job: j, copy: false };
    for (const j of all.values()) {
      if (j.done || j.gaveUp || j.running.size !== 1 || j.running.has(account) || j.tried.has(account)) continue;
      if (now() - [...j.running.values()][0]! > slowMs) return { job: j, copy: true };
    }
    return null;
  };
  const loop = async (account: string) => {
    while (!settled()) {
      const p = pick(account);
      if (!p) { await sleep(1000); check(); continue; }
      const { job, copy } = p;
      const t = now();
      job.running.set(account, t);
      if (copy) say(`${job.key}: slow, a second copy goes to ${account}`);
      try {
        const value = job.read(await hub.ask(job.prompt, account));
        if (!value) throw new Error('the reply was not the JSON asked for');
        if (!job.done) job.done = { value, account, ms: now() - t };
      } catch (e) {
        job.tried.add(account);
        job.errors.push(`${account}: ${(e as Error).message}`.slice(0, 220));
      } finally {
        job.running.delete(account);
        check();
      }
    }
  };
  for (const w of workers) void loop(w).catch(() => {});
  check();
  await finished;
  return all;
}

// ---------------------------------------------------------------- the lane

const day = (iso: string) => iso.slice(0, 10);
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

export async function run(ctx: Ctx, dive: any, deps: { hub?: Hub; profile?: Profile } = {}): Promise<{ findings: Finding[]; notes: Record<string, unknown> }> {
  const profile = deps.profile ?? await profileOf(ctx, dive);
  const hub = deps.hub ?? liveHub();
  const qs = questions(profile);
  const idsOf = (kind: Prompt['kind']) => qs.filter((q) => q.kind === kind).map((q) => q.id);
  const workers = await hub.workers();
  if (!workers.length) throw new Error('the cloud Antigravity hub has no worker online');
  ctx.log(`asking ${ASSISTANT}: 3 prompts x ${REPEAT} on ${workers.length} workers (${workers.join(', ')})`);

  const aIds = idsOf('company'), bIds = idsOf('trade');
  const jobs: { key: string; prompt: string; read: (t: string) => any }[] = [];
  for (let k = 0; k < REPEAT; k++) {
    jobs.push({ key: `A#${k}`, prompt: promptA(qs), read: (t) => readAnswers(t, aIds) });
    jobs.push({ key: `B#${k}`, prompt: promptB(qs), read: (t) => readAnswers(t, bIds) });
    jobs.push({ key: `C#${k}`, prompt: promptC(qs), read: readCompare });
  }
  const done = await runJobs(jobs, workers, hub, { say: (m) => ctx.log(m) });
  ctx.meter.other['agy hub calls'] = [...done.values()].reduce((n, j) => n + j.tried.size + (j.done ? 1 : 0), 0);
  ctx.meter.other['agy hub failed'] = [...done.values()].reduce((n, j) => n + j.errors.length, 0);

  const kindOf = new Map(qs.map((q) => [q.id, q.kind] as const));
  const brand = norm(profile.brand || profile.name);
  const answers: any[] = [];
  const compare: any[] = [];
  const runs = { A: { ok: 0, asked: REPEAT }, B: { ok: 0, asked: REPEAT }, C: { ok: 0, asked: REPEAT } };
  for (const [key, j] of done) {
    const [part, s] = key.split('#') as ['A' | 'B' | 'C', string];
    const sample = Number(s);
    if (!j.done) { ctx.warn(`prompt ${key} failed on every worker: ${j.errors.join(' | ')}`); continue; }
    runs[part].ok++;
    if (part === 'C') { compare.push({ sample, worker: j.done.account, ...j.done.value }); continue; }
    for (const [id, a] of Object.entries(j.done.value as Record<string, { answer: string; sources: string[]; companies: string[] }>)) {
      const named = kindOf.get(id) === 'trade' ? [a.answer, ...a.companies].some((t) => norm(t).includes(brand)) : null;
      answers.push({ id, sample, model: ASSISTANT, worker: j.done.account, answer: a.answer, sources: a.sources, searched: a.sources.length > 0, ...(named === null ? {} : { companies: a.companies, named }) });
      const words = a.answer.split(/\s+/).length;
      if (words > 80) ctx.warn(`${key} ${id}: the answer is ${words} words (50 asked); kept as given`);
    }
  }
  answers.sort((a, b) => a.sample - b.sample || qs.findIndex((q) => q.id === a.id) - qs.findIndex((q) => q.id === b.id));
  compare.sort((a, b) => a.sample - b.sample);
  // The lane fails, visibly and with the reasons, when a whole prompt got no answer at all. C alone only makes it partial.
  for (const part of ['A', 'B'] as const) {
    if (!runs[part].ok) throw new Error(`${ASSISTANT}: prompt ${part} got no valid answer from any worker: ${[...done].filter(([k]) => k.startsWith(part)).flatMap(([, j]) => j.errors).slice(0, 6).join(' | ')}`);
  }
  if (!runs.C.ok) ctx.warn('the comparison prompt got no valid answer from any worker');

  const now = ctx.now();
  const findings: Finding[] = [];
  const tradeText = new Map(qs.filter((q) => q.kind === 'trade').map((q) => [q.id, q.text]));
  const trade = answers.filter((a) => a.named !== undefined);
  if (trade.length) {
    const named = trade.filter((a) => a.named).length;
    const other = new Map<string, { name: string; n: number }>();
    for (const a of trade) for (const c of a.companies as string[]) {
      const t = norm(c);
      if (!t || t.includes(brand)) continue;
      const v = other.get(t) ?? { name: c, n: 0 };
      v.n++;
      other.set(t, v);
    }
    const top = [...other.values()].sort((a, b) => b.n - a.n).slice(0, 5).map((v) => v.name);
    findings.push({
      title: `An AI assistant with web search names you in ${named} of ${trade.length} answers`,
      detail: `${top.length ? `Companies they name instead: ${top.join(', ')}.` : 'It named no company.'} Asked ${[...tradeText.values()].map((t) => `"${t}"`).join(' and ')}, ${REPEAT} times each, on ${day(now)}.`,
      severity: named === 0 ? 'high' : named < trade.length ? 'medium' : 'info',
      source: null, checked_at: now, check: 'ai-share', evidence: trade.map((a) => `${a.id}#${a.sample}: ${a.answer}`).join('\n'),
    });
  }
  const rivals = new Map<string, { name: string; n: number }>();
  for (const c of compare) for (const name of c.closest_competitors as string[]) {
    const t = norm(name);
    if (!t || t.includes(brand)) continue;
    const v = rivals.get(t) ?? { name, n: 0 };
    v.n++;
    rivals.set(t, v);
  }
  const closest = [...rivals.values()].sort((a, b) => b.n - a.n).slice(0, 3);
  if (closest.length) {
    const first = compare[0];
    findings.push({
      title: `An AI assistant with web search names ${closest.map((v) => v.name).join(', ')} as your closest competitors`,
      detail: `Weakest point it gives for you: ${first.weakest} It would recommend: ${first.recommend}`,
      severity: 'info', source: null, checked_at: now, evidence: JSON.stringify(compare[0]),
    });
  }

  // The list pages the assistant read for the trade questions: S2 and the privacy check read them from here.
  const searchResults: Record<string, { url: string }[]> = {};
  for (const [id, text] of tradeText) {
    const urls = [...new Set(answers.filter((a) => a.id === id).flatMap((a) => a.sources as string[]))];
    searchResults[text] = urls.map((url) => ({ url }));
  }
  return {
    findings,
    notes: {
      assistant: ASSISTANT, models: [ASSISTANT], profile, repeat: REPEAT, workers, runs,
      prompts: qs, answers, compare, search_results: searchResults,
      limit: 'One assistant family (Gemini on the Antigravity hub). Its source lists are its own claim; some are Google redirect links. Answers differ between runs.',
    },
  };
}
