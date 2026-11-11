// G / recommend — how AI sees you, how it rates you, and whether it recommends you over your competitors.
// Two assistants that search the web are asked the same customer questions, in a customer's own words:
//   ChatGPT  web ChatGPT on a Local Gmap Worker PC (myworker /api/chat): every prompt is a new UNPERSONALIZED
//            temporary chat, so the account's memory and custom instructions never steer the answer; default model.
//   Gemini   the cloud Antigravity hub (my-agy), the same route G-search uses.
// Prompts:
//   find 1-4  the customer wants a trade in a town and does NOT name the company: is it named, and in what place?
//   rate      the company is named: its score out of 10, and the scores of the competitors the assistant picks itself
//   pick      the company is named: would it recommend it, or tell the customer to choose another company?
// Each prompt is asked REPEAT times per assistant. ChatGPT runs one prompt at a time (one browser tab); Gemini runs on
// every hub worker at once. The answers stay as the assistants wrote them. Whether the company is named is a plain
// name match on the answer text; a cheap extractor (temperature 0) only COPIES the list order, the scores and the pick
// out of each answer. It never judges whether the answer is right: this is what a customer asking that assistant is told.
import type { Ctx, Finding } from '../lib.ts';
import { chat } from '../v21/myworker.ts';
import { liveHub, runJobs, type Hub } from './G-search.ts';
import { profileOf, type Profile } from './G-shared.ts';

const REPEAT = Math.max(1, Number(process.env.DD_R_REPEAT ?? 2) || 1);
export const CHATGPT = 'ChatGPT';
export const GEMINI = 'Gemini';
export const ASSISTANTS = [CHATGPT, GEMINI] as const;

export type Ask = { id: string; kind: 'find' | 'rate' | 'pick'; text: string };

const WEB = ' Please check the web for current information.';
export function asks(p: Profile): Ask[] {
  return [
    { id: 'best', kind: 'find', text: `Who are the best ${p.trades} in ${p.area}? Please name specific companies.${WEB}` },
    { id: 'hire', kind: 'find', text: `I live in ${p.area}, ${p.state} and I want to ${p.job}. Which companies should I contact?${WEB}` },
    { id: 'top5', kind: 'find', text: `I'm getting quotes from ${p.trades} in ${p.area}. Give me your top 5 companies, ranked, with one reason for each.${WEB}` },
    { id: 'trust', kind: 'find', text: `Which ${p.trades} in ${p.state} have the best reputation? I want one I can trust.${WEB}` },
    { id: 'rate', kind: 'rate', text: `Rate ${p.name} in ${p.area} as a ${p.trade} out of 10. Then rate its closest competitors out of 10 the same way, and explain the scores briefly.${WEB}` },
    { id: 'pick', kind: 'pick', text: `I'm considering ${p.name} to ${p.job} in ${p.area}. Would you recommend them, or is there a better company I should choose instead? Tell me the one company you would pick.${WEB}` },
  ];
}

export const norm = (s: string) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
/** The words that mean "this company" in an answer: its name without Sdn Bhd, its brand, its aliases, its domain labels. */
export function nameKeys(p: Profile, domains: string[] = []): string[] {
  const strip = (s: string) => norm(s).replace(/\b(sdn|bhd|berhad|plt|enterprise|holdings?)\b/g, ' ').replace(/\s+/g, ' ').trim();
  const keys = [p.name, p.brand, ...(p.aliases ?? []), ...domains.map((d) => String(d).replace(/^www\./, '').split('.')[0])].map(strip);
  return [...new Set(keys.filter((k) => k.length >= 4))];
}
export const mentions = (text: string, keys: string[]) => { const t = ` ${norm(text)} `; return keys.some((k) => t.includes(` ${k} `)); };

export type Read = {
  companies: string[]; target_position: number | null; target_score: number | null;
  scores: { name: string; score: number }[]; pick: string | null;
  recommends_target: 'yes' | 'no' | 'depends' | 'not_mentioned'; summary: string;
};

export function extractPrompt(p: Profile, ask: Ask, answer: string): string {
  return `An AI assistant gave the answer below to a customer. COPY facts out of it. Do not add anything you know yourself and do not judge whether it is right.\n` +
    `The customer asked: "${ask.text}"\nThe company we track: "${p.name}" (also called: ${[p.brand, ...(p.aliases ?? [])].filter(Boolean).join(', ') || 'no other names'}).\n\n` +
    `ANSWER:\n"""\n${answer.slice(0, 12_000)}\n"""\n\n` +
    `Return ONLY one JSON object:\n{"companies": [the business names the answer names or recommends, in the order it gives them, at most 10, the tracked company included if named],\n` +
    ` "target_position": the 1-based place of the tracked company in that list, or null,\n` +
    ` "target_score": the score out of 10 the answer gives the tracked company, or null,\n` +
    ` "scores": [{"name": business, "score": its score out of 10} for every OTHER business the answer scores],\n` +
    ` "pick": the one business the answer says it would choose, or null,\n` +
    ` "recommends_target": "yes" if the answer recommends the tracked company, "no" if it tells the customer to choose another company or warns against it, "depends" if it says it depends, "not_mentioned" if it does not talk about the tracked company,\n` +
    ` "summary": one sentence, at most 30 words, of what the answer says about the tracked company, or "" if it does not mention it}`;
}

const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) && n >= 0 && n <= 10 ? Math.round(n * 10) / 10 : null; };
export function readExtract(j: any): Read | null {
  if (!j || typeof j !== 'object' || Array.isArray(j)) return null;
  const companies = (Array.isArray(j.companies) ? j.companies : []).map((x: unknown) => String(x ?? '').trim()).filter(Boolean).slice(0, 10);
  const pos = Number(j.target_position);
  const rec = String(j.recommends_target ?? '').toLowerCase();
  return {
    companies,
    target_position: Number.isInteger(pos) && pos >= 1 && pos <= 20 ? pos : null,
    target_score: num(j.target_score),
    scores: (Array.isArray(j.scores) ? j.scores : []).map((s: any) => ({ name: String(s?.name ?? '').trim(), score: num(s?.score) }))
      .filter((s: any) => s.name && s.score != null) as { name: string; score: number }[],
    pick: j.pick ? String(j.pick).trim() : null,
    recommends_target: (['yes', 'no', 'depends', 'not_mentioned'].includes(rec) ? rec : 'not_mentioned') as Read['recommends_target'],
    summary: String(j.summary ?? '').trim(),
  };
}

/** Recommended OVER the others: the assistant's own pick is you, or it picked no one and said yes to you.
 *  "A good choice, but I would pick X" is not a recommendation over X. */
export const overOthers = (a: { picks_us: boolean; pick: string | null; recommends: string }) => a.picks_us || (!a.pick && a.recommends === 'yes');

export type Answer = {
  assistant: string; id: string; kind: Ask['kind']; sample: number; text: string; worker: string | null; ms: number | null;
  named: boolean; position: number | null; companies: string[]; target_score: number | null; scores: { name: string; score: number }[];
  pick: string | null; picks_us: boolean; recommends: Read['recommends_target']; summary: string; extracted: boolean;
};

type Deps = { hub?: Hub; profile?: Profile; chatgpt?: (prompt: string) => Promise<{ answer: string; tookMs: number | null; worker?: string } | { error: string }>; sleep?: (ms: number) => Promise<void> };

/** ChatGPT, one prompt at a time. A tab that had to reload asks for a resend; two prompts failing in a row stop ChatGPT. */
async function askChatGPT(ctx: Ctx, list: { key: string; ask: Ask; sample: number }[], deps: Deps) {
  const send = deps.chatgpt ?? ((prompt: string) => chat(prompt));
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const out = new Map<string, { text: string; worker: string | null; ms: number | null }>();
  const errors: string[] = [];
  let failedInRow = 0;
  for (const item of list) {
    if (failedInRow >= 2) { errors.push(`${item.key}: not asked, ChatGPT failed twice in a row`); continue; }
    let done = false;
    for (let attempt = 1; attempt <= 3 && !done; attempt++) {
      const r = await send(item.ask.text);
      if ('answer' in r) { out.set(item.key, { text: r.answer, worker: r.worker ?? null, ms: r.tookMs }); done = true; break; }
      errors.push(`${item.key} try ${attempt}: ${r.error}`.slice(0, 300));
      ctx.warn(`ChatGPT ${item.key} try ${attempt}: ${r.error.slice(0, 200)}`);
      await sleep(/send the prompt again|reload/i.test(r.error) ? 8_000 : 20_000);
    }
    failedInRow = done ? 0 : failedInRow + 1;
  }
  return { out, errors };
}

export async function run(ctx: Ctx, dive: any, deps: Deps = {}): Promise<{ findings: Finding[]; notes: Record<string, unknown> }> {
  const profile = deps.profile ?? await profileOf(ctx, dive);
  const list = asks(profile);
  const keys = nameKeys(profile, dive?.result?.identity?.official_domains ?? []);
  ctx.log(`asking ${ASSISTANTS.join(' and ')} ${list.length} prompts x ${REPEAT}; company names matched: ${keys.join(', ')}`);
  const items = list.flatMap((ask) => Array.from({ length: REPEAT }, (_, sample) => ({ key: `${ask.id}#${sample}`, ask, sample })));

  // Gemini on every hub worker at once, while ChatGPT works through the same prompts one by one.
  const hub = deps.hub ?? liveHub();
  const gemini = (async () => {
    try {
      const workers = await hub.workers();
      if (!workers.length) throw new Error('the cloud Antigravity hub has no worker online');
      const jobs = items.map((i) => ({ key: i.key, prompt: i.ask.text, read: (t: string) => (t && t.trim() ? t.trim() : null) }));
      const done = await runJobs(jobs, workers, hub, { say: (m) => ctx.log(`Gemini ${m}`) });
      const out = new Map<string, { text: string; worker: string | null; ms: number | null }>();
      const errors: string[] = [];
      for (const [key, j] of done) {
        if (j.done) out.set(key, { text: j.done.value, worker: j.done.account, ms: j.done.ms });
        else errors.push(`${key}: ${j.errors.join(' | ')}`.slice(0, 300));
      }
      return { out, errors };
    } catch (e) {
      return { out: new Map<string, { text: string; worker: string | null; ms: number | null }>(), errors: [`Gemini: ${(e as Error).message}`] };
    }
  })();
  const [g, c] = await Promise.all([gemini, askChatGPT(ctx, items, deps)]);
  for (const e of g.errors) ctx.warn(`Gemini ${e}`);
  const raw: Record<string, typeof g.out> = { [CHATGPT]: c.out, [GEMINI]: g.out };
  if (!c.out.size && !g.out.size) throw new Error(`neither assistant answered: ${[...c.errors, ...g.errors].slice(0, 6).join(' | ')}`);
  if (!c.out.size) ctx.warn(`ChatGPT gave no answer: ${c.errors.slice(-2).join(' | ')}`);
  if (!g.out.size) ctx.warn(`Gemini gave no answer: ${g.errors.slice(-2).join(' | ')}`);

  // Copy the list order, scores and pick out of each answer, a few at a time.
  const todo = items.flatMap((i) => ASSISTANTS.filter((a) => raw[a].has(i.key)).map((a) => ({ ...i, assistant: a, got: raw[a].get(i.key)! })));
  const answers: Answer[] = [];
  for (let k = 0; k < todo.length; k += 6) {
    await Promise.all(todo.slice(k, k + 6).map(async (t) => {
      let read: Read | null = null;
      try { read = readExtract(ctx.parseJson(await ctx.llm(extractPrompt(profile, t.ask, t.got.text), { temperature: 0, label: 'G-recommend extract' }))); } catch { /* kept below */ }
      if (!read) ctx.warn(`${t.assistant} ${t.key}: the extractor gave no JSON; only the name match is used`);
      const named = mentions(t.got.text, keys);
      const pick = read?.pick ?? null;
      answers.push({
        assistant: t.assistant, id: t.ask.id, kind: t.ask.kind, sample: t.sample, text: t.got.text, worker: t.got.worker, ms: t.got.ms,
        named, position: named ? (read?.target_position ?? (read?.companies.findIndex((n) => mentions(n, keys)) ?? -1) + 1) || null : null,
        companies: read?.companies ?? [], target_score: read?.target_score ?? null, scores: read?.scores ?? [],
        pick, picks_us: !!pick && mentions(pick, keys), recommends: read?.recommends_target ?? (named ? 'depends' : 'not_mentioned'),
        summary: read?.summary ?? '', extracted: !!read,
      });
    }));
  }
  const order = (a: Answer) => list.findIndex((x) => x.id === a.id) * 100 + a.sample * 10 + ASSISTANTS.indexOf(a.assistant as any);
  answers.sort((a, b) => order(a) - order(b));

  // ---- findings: counted from the answers, never estimated ----
  const now = ctx.now();
  const day = now.slice(0, 10);
  const findings: Finding[] = [];
  const by = (a: string, kind: Ask['kind']) => answers.filter((x) => x.assistant === a && x.kind === kind);
  const asked = ASSISTANTS.filter((a) => by(a, 'find').length);
  if (asked.length) {
    const parts = asked.map((a) => `${a} named you in ${by(a, 'find').filter((x) => x.named).length} of ${by(a, 'find').length}`);
    const total = asked.reduce((n, a) => n + by(a, 'find').filter((x) => x.named).length, 0);
    const of = asked.reduce((n, a) => n + by(a, 'find').length, 0);
    const rivals = new Map<string, { name: string; n: number }>();
    for (const x of answers.filter((y) => y.kind === 'find')) for (const name of new Set(x.companies.filter((n) => !mentions(n, keys)))) {
      const t = norm(name).replace(/\b(sdn|bhd)\b/g, '').trim();
      const v = rivals.get(t) ?? { name, n: 0 };
      v.n++; rivals.set(t, v);
    }
    const top = [...rivals.values()].sort((a, b) => b.n - a.n).slice(0, 4).map((v) => `${v.name} (${v.n})`);
    findings.push({
      title: `Asked for a ${profile.trade} in ${profile.area} without your name, ${parts.join(' and ')} answers`,
      detail: `${top.length ? `Named most often instead: ${top.join(', ')}.` : 'No other company was named either.'} ${list.filter((x) => x.kind === 'find').length} customer questions, asked ${REPEAT === 1 ? 'once' : `${REPEAT} times`} each to each assistant with a web search, on ${day}.`,
      severity: total === 0 ? 'high' : total * 2 < of ? 'medium' : 'info', source: null, checked_at: now,
      evidence: answers.filter((x) => x.kind === 'find').map((x) => `${x.assistant} ${x.id}#${x.sample}: ${x.named ? `named, place ${x.position ?? '?'}` : 'not named'} | ${x.companies.join('; ')}`).join('\n'),
    });
  }
  const rate = answers.filter((x) => x.kind === 'rate' && x.target_score != null);
  if (rate.length) {
    const avg = (xs: number[]) => Math.round((xs.reduce((s, v) => s + v, 0) / xs.length) * 10) / 10;
    const ours = ASSISTANTS.map((a) => { const s = rate.filter((x) => x.assistant === a).map((x) => x.target_score!); return s.length ? `${a} ${avg(s)}/10` : ''; }).filter(Boolean);
    const theirs = rate.flatMap((x) => x.scores.map((s) => s.score));
    const us = avg(rate.map((x) => x.target_score!));
    const them = theirs.length ? avg(theirs) : null;
    findings.push({
      title: `Asked to rate you out of 10: ${ours.join(', ')}`,
      detail: them != null ? `The competitors it chose to compare you with averaged ${them}/10.` : 'It named no competitor scores.',
      severity: them != null && us < them ? 'medium' : 'info', source: null, checked_at: now,
      evidence: rate.map((x) => `${x.assistant} #${x.sample}: you ${x.target_score}; ${x.scores.map((s) => `${s.name} ${s.score}`).join(', ')}`).join('\n'),
    });
  }
  const pick = answers.filter((x) => x.kind === 'pick');
  if (pick.length) {
    const words = ASSISTANTS.map((a) => {
      const xs = pick.filter((x) => x.assistant === a);
      if (!xs.length) return '';
      const us = xs.filter(overOthers).length;
      const other = xs.find((x) => x.pick && !x.picks_us)?.pick;
      return `${a} recommends you in ${us} of ${xs.length}${other ? ` (it would pick ${other})` : ''}`;
    }).filter(Boolean);
    const yes = pick.filter(overOthers).length;
    findings.push({
      title: `Asked whether to choose you or another company, ${words.join('; ')}`,
      detail: pick.find((x) => x.summary)?.summary ?? '',
      severity: yes === 0 ? 'high' : yes * 2 < pick.length ? 'medium' : 'info', source: null, checked_at: now,
      evidence: pick.map((x) => `${x.assistant} #${x.sample}: ${x.recommends}; pick ${x.pick ?? '-'}; ${x.summary}`).join('\n'),
    });
  }
  ctx.meter.other['ChatGPT prompts'] = c.out.size;
  ctx.meter.other['Gemini prompts'] = g.out.size;
  return {
    findings,
    notes: {
      assistants: ASSISTANTS.filter((a) => raw[a].size), repeat: REPEAT, profile, keys, asks: list, answers,
      errors: { [CHATGPT]: c.errors, [GEMINI]: g.errors },
      // Describes only the assistants that answered: a ChatGPT that gave nothing is not described as asked.
      method: [
        raw[CHATGPT].size ? 'ChatGPT: web ChatGPT, default model, each prompt in a new unpersonalized temporary chat (no memory, no custom instructions).' : '',
        raw[GEMINI].size ? 'Gemini: Gemini on the cloud Antigravity hub, which searches the web.' : '',
        `Each prompt asked ${REPEAT === 1 ? 'once' : `${REPEAT} times`} per assistant.`,
      ].filter(Boolean).join(' '),
      limit: 'What the assistants said, not a check of whether it is right. Answers change between runs and between customers.',
    },
  };
}
