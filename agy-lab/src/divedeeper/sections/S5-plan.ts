// S5 / plan — dive-deeper stage 5: the action plan, one task list grouped by department.
//
//   node scripts/dive-deeper/run.ts S5 plan <diveId>
//
// Reads every stage-1 lane, S2 (the drafts that are ready), S3 (plain titles) and S4 (the
// analysis) from out/. One LLM call compiles the urgent and needs-work findings into tasks, each
// for one department (editor.ts DEPTS: website, social media, IT, other), with when, effort and the
// draft that does it for them. Code then checks the list is complete: every urgent or needs-work
// finding no task covers is listed under its department, so nothing found drops off the plan.
// No LLM answer builds the plan in code from the findings themselves.
import fs from 'node:fs';
import path from 'node:path';
import { OUT, type Ctx, type Finding } from '../lib.ts';
import { AREAS, DEPTS, STAGE1_LANES, deptOf, resolve, type Dept, type Item } from '../editor.ts';

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n) + ' …' : s);
const WHEN = ['week', 'month', 'quarter'] as const;
const IMPACT = ['high', 'medium', 'low'] as const;

function stage(diveId: string, lane: string): any | null {
  const file = path.join(OUT, `${lane}-${diveId}.json`);
  try { return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null; } catch { return null; }
}

async function askJson(ctx: Ctx, prompt: string, label: string): Promise<any> {
  for (let attempt = 1; attempt <= 2; attempt++) {
    const got = ctx.parseJson(await ctx.llm(prompt, { label }));
    if (got) return got;
    ctx.warn(`${label} did not parse (attempt ${attempt})`);
  }
  return null;
}

export type Task = { dept: Dept; task: string; why: string; how: string; when: typeof WHEN[number]; effort: string; impact: typeof IMPACT[number]; theme: string | null; ready: string | null; items: string[] };

export async function run(ctx: Ctx, dive: any): Promise<{ findings: Finding[]; notes: Record<string, unknown> }> {
  const L = Object.fromEntries([...STAGE1_LANES, 'S2-consult', 'S3-editor', 'S4-analysis'].map((l) => [l, stage(ctx.diveId, l)]));
  for (const [l, v] of Object.entries(L)) if (!v) ctx.warn(`${l}-${ctx.diveId}.json missing; the plan skips what it covers`);
  const R = resolve(dive, L);
  const plain: Record<string, { title: string; why: string }> = L['S3-editor']?.notes?.plain ?? {};
  const T = (x: Item) => plain[x.key]?.title ?? x.title;
  const W = (x: Item) => plain[x.key]?.why ?? '';
  const s2 = L['S2-consult']?.notes ?? {};
  const an = L['S4-analysis']?.notes ?? {};

  // Urgent first, then needs work: the findings the plan has to cover, numbered for the LLM.
  const todo = R.items.filter((x) => x.severity === 'high').concat(R.items.filter((x) => x.severity === 'medium'));
  const ref = new Map(todo.map((x, i) => [`F${i + 1}`, x]));
  // The drafts S2 wrote, so a task can point at the one that does it for them.
  const ready: Record<string, string> = {};
  if (s2.site?.homepage) ready.homepage = 'the homepage, rewritten';
  if ((s2.site?.pages_to_add ?? []).length) ready.pages = 'the pages to add, town by town';
  if ((s2.site?.pages_to_fix ?? []).length) ready.fixes = 'the pages to fix, with the fix for each';
  if ((s2.replies?.replies ?? []).length) ready.replies = 'the review replies, ready to post';
  if (s2.replies?.ask_message) ready.ask = 'the WhatsApp message asking for a review';
  if ((s2.ai?.faq ?? []).length) ready.faq = 'the FAQ for the website';
  if ((s2.ai?.actions ?? []).length) ready.ai = 'the plan for getting recommended by AI assistants';
  if (s2.jsonld) ready.jsonld = 'the business details for Google and AI, ready to paste';

  const got = todo.length ? await askJson(ctx,
    `You are compiling the action plan of an online presence audit for the owner of ${R.name} (${R.identity.industry}). Turn the findings below into a task list the owner can hand out, one list per department.\n` +
    `Departments:\n${DEPTS.map((d) => `- ${d.id}: ${d.title} (${d.covers}); done by ${d.who.toLowerCase()}`).join('\n')}\n\n` +
    `Findings to cover (urgent first, then needs work), as id | part | severity | finding | what it means:\n` +
    todo.map((x, i) => `F${i + 1} | ${x.area} | ${x.severity} | ${clip(T(x), 200)} | ${clip(W(x) || x.detail, 160)}`).join('\n') + '\n\n' +
    `What the analysis says ties them together:\n${(an.threads ?? []).map((t: any) => `- ${t.title}: ${t.body}`).join('\n') || '(none)'}\n` +
    `The three problems costing the most customers:\n${(an.stories ?? []).map((s: any) => `- ${s.headline}: ${s.fix}`).join('\n') || '(none)'}\n\n` +
    `Drafts already written for the owner (a task may point at one): ${Object.entries(ready).map(([k, v]) => `${k} = ${v}`).join('; ') || '(none)'}\n\n` +
    `Return JSON only:\n{"tasks": [{"dept": "one of ${DEPTS.map((d) => d.id).join(', ')}", "task": "at most 14 words, starts with a verb", "why": "1 sentence with the evidence, real numbers", "how": "1-2 sentences: the concrete steps", ` +
    `"when": "week (do this week) | month (this month) | quarter (within 3 months)", "effort": "a short estimate like 1 hour or 2 days", "impact": "high | medium | low", ` +
    `"theme": "the part it comes from: one of ${AREAS.map((a) => a.id).join(', ')}", "ready": "the key of the draft that does it, or null", "items": ["the F-ids this task closes"]}]}\n` +
    `Rules: one task may close several findings that need the same work; group them. Every urgent finding must be in a task. Each task has one department: the one whose people do the work. ` +
    `Order each department's tasks by when, then by impact. Use only what the findings say; never invent numbers. British English.`,
  'action plan') : null;
  if (todo.length && !got) ctx.warn('action plan did not parse; the plan is built from the findings themselves');

  const tasks: Task[] = (Array.isArray(got?.tasks) ? got.tasks : []).filter((t: any) => typeof t?.task === 'string' && t.task.trim()).map((t: any): Task => {
    const items = (Array.isArray(t.items) ? t.items : []).map((s: unknown) => String(s).trim().toUpperCase()).filter((s: string) => ref.has(s));
    const first = items.length ? ref.get(items[0])! : null;
    return {
      dept: DEPTS.some((d) => d.id === t.dept) ? t.dept : first ? deptOf(first) : 'other',
      task: t.task.trim(), why: String(t.why ?? '').trim(), how: String(t.how ?? '').trim(),
      when: WHEN.includes(t.when) ? t.when : 'month', effort: String(t.effort ?? '').trim(), impact: IMPACT.includes(t.impact) ? t.impact : 'medium',
      theme: AREAS.some((a) => a.id === t.theme) ? t.theme : first?.area ?? null,
      ready: typeof t.ready === 'string' && ready[t.ready] ? t.ready : null,
      items: items.map((id: string) => ref.get(id)!.key),
    };
  });
  // Without the LLM, every urgent finding becomes its own task.
  if (!tasks.length) for (const x of todo.filter((x) => x.severity === 'high')) {
    tasks.push({ dept: deptOf(x), task: T(x), why: W(x), how: '', when: 'week', effort: '', impact: 'high', theme: x.area, ready: null, items: [x.key] });
  }
  const covered = new Set(tasks.flatMap((t) => t.items));
  const also = todo.filter((x) => !covered.has(x.key)).map((x) => ({ dept: deptOf(x), key: x.key, severity: x.severity, theme: x.area }));
  const rank = (t: Task) => WHEN.indexOf(t.when) * 3 + IMPACT.indexOf(t.impact);
  const byDept = DEPTS.map((d) => ({ dept: d.id, tasks: tasks.filter((t) => t.dept === d.id).sort((a, b) => rank(a) - rank(b)), also: also.filter((x) => x.dept === d.id) }));
  ctx.log(`plan: ${tasks.length} tasks covering ${covered.size} of ${todo.length} findings; ${also.length} more listed under their department`);

  return {
    findings: [{ title: 'Action plan compiled', detail: `${tasks.length} tasks (${byDept.map((d) => `${d.dept} ${d.tasks.length}`).join(', ')}); ${covered.size} of ${todo.length} urgent or needs-work findings in a task, ${also.length} more listed`, severity: 'info', source: null, checked_at: ctx.now() }],
    notes: { depts: byDept, ready, covered: covered.size, total: todo.length },
  };
}
