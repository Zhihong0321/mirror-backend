// R / contacts — contact and reachability (part 1 of the malaysia-deeper-dive report).
//
// Every way a customer can reach the company, gathered in one inventory:
//   - phones, emails and WhatsApp numbers on the official sites (C-merged's crawl and its
//     WhatsApp and MX checks), on the Google Maps listings (H-maps), and in the dive's research;
//   - the addresses on the Maps listings and in the research.
// Then each phone and email is searched on the web (Brave, country MY) to see where else it is
// published, under whose name, and whether other businesses use it. The dive's people step says
// who works there now; an email or WhatsApp name that matches someone who has left, or a person
// the research does not know, is looked up once more (Exa, LinkedIn-style profiles).
// One LLM call then settles each point: current, outdated, belongs to someone else, a staff
// member's personal line, broken, or unclear, with the fix. Deterministic checks (placeholder
// numbers, impossible Malaysian numbers, free mail, no mail server) need no LLM.
// No kill gates: a failed search or an unparsed answer leaves that point "unclear".
import dnsp from 'node:dns/promises';
import { readLane, nameOf, type Ctx, type Finding } from '../lib.ts';

const FREE_MAIL = /@(gmail|googlemail|yahoo|ymail|hotmail|outlook|live|icloud|aol|proton|protonmail|qq|163|126)\./i;
const ROLE_BOX = /^(info|sales|enquir(y|ies)|inquir(y|ies)|admin|hr|support|contact|marketing|accounts?|office|hello|cs|service|customerservice|orders?|billing|finance|careers?|jobs|recruit(ment)?|general|enquiry|mail|team|project|projects|purchas(e|ing)|procurement|export|import|quotation|quote|booking|reservations?|help|noreply|no-reply|webmaster)\d*$/i;

/** 60xxxxxxxxx for a Malaysian number written any common way; '' when it is not one. */
export function normPhone(raw: string): string {
  let d = String(raw).replace(/\D/g, '');
  if (d.startsWith('0060')) d = d.slice(2);
  if (d.startsWith('60')) return d;
  if (d.startsWith('0')) return '6' + d;
  if (/^1[0-9]{8,9}$/.test(d)) return '60' + d;
  return '';
}

/** 011-2067 2895 / 03-1234 5678 / 1300-88-1234, the way Malaysians print it. */
export function showPhone(n: string): string {
  const nat = n.slice(2);
  if (/^1[38]00/.test(nat)) return `${nat.slice(0, 4)}-${nat.slice(4, 6)}-${nat.slice(6)}`;
  const l = '0' + nat;
  if (/^01/.test(l)) return `${l.slice(0, 3)}-${l.slice(3, l.length - 4)} ${l.slice(-4)}`;
  if (/^03/.test(l)) return `03-${l.slice(2, 6)} ${l.slice(6)}`;
  // Sabah and Sarawak use three-digit area codes (082-089), the rest two (04-09).
  const area = /^08[2-9]/.test(l) ? 3 : 2;
  return `${l.slice(0, area)}-${l.slice(area)}`;
}

/** Why a number cannot be a working Malaysian line, or null when it can. */
export function badPhone(n: string): string | null {
  const nat = n.slice(2);
  if (/(\d)\1{5,}|12345678|23456789|87654321/.test(nat)) return 'it looks like a placeholder, not a real number';
  if (/^1[38]00/.test(nat)) return /^1[38]00\d{6}$/.test(nat) ? null : 'a 1-300 or 1-800 number has 10 digits; this one does not';
  if (/^1[0-9]/.test(nat)) return /^(11\d{8}|1[02-9]\d{7})$/.test(nat) ? null : 'a Malaysian mobile number has 10 or 11 digits; this one does not';
  if (/^3\d{8}$/.test(nat)) return null;
  if (/^[4-9]\d{7}$/.test(nat)) return null;
  return 'it does not have the right number of digits for a Malaysian line';
}

type Point = {
  id: string; kind: 'phone' | 'email' | 'whatsapp' | 'address'; value: string; key: string;
  where: string[]; on_site: boolean; on_maps: boolean; in_research: boolean;
  whatsapp_name?: string | null; mx?: string[] | null; problem?: string | null;
  web?: { title: string; url: string; snippet: string; own: boolean; names_company: boolean }[];
};

export async function run(ctx: Ctx, dive: any): Promise<{ findings: Finding[]; notes: Record<string, unknown> }> {
  const r = dive.result ?? {};
  const N = nameOf(dive);
  const C = readLane(ctx.diveId, 'C-merged')?.notes ?? {};
  const H = readLane(ctx.diveId, 'H-maps')?.notes ?? {};
  if (!Object.keys(C).length) ctx.warn('C-merged output missing: website contacts come from the research only');
  if (!Object.keys(H).length) ctx.warn('H-maps output missing: no Google Maps contacts');
  const findings: Finding[] = [];
  const add = (f: Omit<Finding, 'checked_at'>) => findings.push({ ...f, checked_at: ctx.now() } as Finding);

  // ---- 1. The inventory. ----
  const points = new Map<string, Point>();
  const put = (kind: Point['kind'], value: string, key: string, where: string, flag: 'site' | 'maps' | 'research') => {
    if (!key) return;
    const id = `${kind}:${key}`;
    const p = points.get(id) ?? { id, kind, value, key, where: [], on_site: false, on_maps: false, in_research: false };
    if (!p.where.includes(where)) p.where.push(where);
    if (flag === 'site') p.on_site = true; else if (flag === 'maps') p.on_maps = true; else p.in_research = true;
    points.set(id, p);
  };
  for (const [ph, where] of Object.entries(C.sitePhones ?? {}) as [string, string[]][]) for (const w of where.slice(0, 4)) put('phone', ph, normPhone(ph), `your website: ${w}`, 'site');
  for (const l of H.listings ?? []) {
    if (l.phone) put('phone', l.phone, normPhone(l.phone), `Google Maps: ${l.name}`, 'maps');
    if (l.address) put('address', l.address, l.address.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(), `Google Maps: ${l.name}${l.closed ? ' (marked closed)' : ''}`, 'maps');
  }
  const factText = (r.facts ?? []).map((f: any) => f.fact).join('\n');
  for (const m of factText.matchAll(/\+?6?0\s?1\d[\d\s-]{7,11}\d|\+?6?0\s?[3-9][\d\s-]{6,10}\d|\b1[38]00[\s-]?\d{2}[\s-]?\d{4}\b/g)) put('phone', m[0].trim(), normPhone(m[0]), 'background research', 'research');
  for (const [, list] of Object.entries(C.emails ?? {}) as [string, string[]][]) for (const e of list) put('email', e.toLowerCase(), e.toLowerCase(), 'your website', 'site');
  for (const m of factText.matchAll(/[a-z0-9._%+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+/gi)) put('email', m[0].toLowerCase(), m[0].toLowerCase(), 'background research', 'research');
  if (N.address) put('address', N.address, N.address.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(), 'background research', 'research');
  for (const w of C.waStatus ?? []) {
    const key = normPhone(w.number);
    put('whatsapp', showPhone(key || w.number), key, 'your website (WhatsApp link)', 'site');
    const p = points.get(`whatsapp:${key}`);
    if (p) { p.whatsapp_name = w.business ?? null; if (!w.valid) p.problem = 'the WhatsApp link does not open a chat'; }
  }
  for (const p of points.values()) if (p.kind === 'phone' || p.kind === 'whatsapp') { p.value = showPhone(p.key); p.problem ??= badPhone(p.key); }

  // ---- 2. Email checks: mail server, free mail, a person's own mailbox. ----
  const mailStatus = new Map<string, string[]>((C.mailStatus ?? []).map((x: any) => [String(x.email).toLowerCase(), x.mx ?? []]));
  for (const p of [...points.values()].filter((x) => x.kind === 'email')) {
    const dom = p.key.split('@')[1];
    p.mx = mailStatus.get(p.key) ?? (await dnsp.resolveMx(dom).then((x) => x.map((m) => m.exchange)).catch(() => []));
    if (!p.mx.length) p.problem = `${dom} has no mail server, so email to it bounces`;
  }

  // ---- 3. Where else each number and address is published. ----
  const phones = [...points.values()].filter((p) => (p.kind === 'phone' || p.kind === 'whatsapp') && !badPhone(p.key));
  const uniqPhones = [...new Map(phones.map((p) => [p.key, p])).values()].slice(0, 10);
  const emails = [...points.values()].filter((p) => p.kind === 'email').slice(0, 6);
  const snippet = (x: any) => String(x.description ?? '').replace(/<[^>]+>/g, '');
  await Promise.all([
    ...uniqPhones.map(async (p) => {
      const local = '0' + p.key.slice(2);
      const rows = await ctx.brave(`"${showPhone(p.key)}" OR "${local}" OR "+${p.key}"`, { count: 15 });
      const tail = p.key.slice(-7);
      const web = rows.filter((x: any) => (x.title + snippet(x) + x.url).replace(/\D/g, '').includes(tail)).map((x: any) => ({ title: x.title, url: x.url, snippet: snippet(x).slice(0, 240), own: N.own(x.url), names_company: N.mentions(x.title + ' ' + snippet(x)) }));
      for (const q of phones.filter((y) => y.key === p.key)) q.web = web;
    }),
    ...emails.map(async (p) => {
      const rows = await ctx.brave(`"${p.key}"`, { count: 15 });
      p.web = rows.filter((x: any) => (x.title + snippet(x)).toLowerCase().includes(p.key)).map((x: any) => ({ title: x.title, url: x.url, snippet: snippet(x).slice(0, 240), own: N.own(x.url), names_company: N.mentions(x.title + ' ' + snippet(x)) }));
    }),
  ]);

  // ---- 4. Who the people behind personal mailboxes and WhatsApp names are. ----
  const people: any[] = (r.people?.people ?? []).map((p: any) => ({ name: p.name, role: p.role, current: p.current, relation: p.relation }));
  const personal = [...points.values()].flatMap((p) => {
    if (p.kind === 'email' && !ROLE_BOX.test(p.key.split('@')[0])) return [{ point: p.id, hint: p.key.split('@')[0].replace(/[._-]+/g, ' ') }];
    if (p.kind === 'whatsapp' && p.whatsapp_name && !N.mentions(p.whatsapp_name) && !(N.brand && p.whatsapp_name.toLowerCase().includes(N.brand))) return [{ point: p.id, hint: p.whatsapp_name }];
    return [];
  });
  const lookups: Record<string, any[]> = {};
  for (const x of personal.slice(0, 4)) {
    const known = people.find((p) => p.name && x.hint.length >= 3 && p.name.toLowerCase().includes(x.hint.toLowerCase().split(' ')[0]));
    if (known && known.current !== undefined) continue;
    const rows = await ctx.exa(`${x.hint} ${N.short} Malaysia`, { numResults: 5, text: 600 });
    lookups[x.point] = rows.map((y: any) => ({ title: y.title, url: y.url, text: String(y.text ?? '').slice(0, 400) }));
  }

  // ---- 5. One judgement over the whole inventory. ----
  const list = [...points.values()];
  const brief = list.map((p) => ({
    id: p.id, kind: p.kind, value: p.value, published_on: p.where.slice(0, 6), on_official_site: p.on_site, on_google_maps: p.on_maps, only_in_research: !p.on_site && !p.on_maps,
    whatsapp_registered_name: p.whatsapp_name, mail_servers: p.mx, known_problem: p.problem ?? null,
    other_pages: (p.web ?? []).filter((w) => !w.own).slice(0, 8).map((w) => `${w.title} | ${w.url} | ${w.snippet}`),
    person_lookup: lookups[p.id]?.map((y) => `${y.title} | ${y.url} | ${y.text}`) ?? undefined,
  }));
  const verdict = list.length ? ctx.parseJson(await ctx.llm(
    `You are checking how customers can reach ${N.legal} (${N.industry}; address on record: ${N.address || 'unknown'}). Official domains: ${N.domains.join(', ') || 'none'}.\n` +
    `People the research found (current=false means they have left):\n${JSON.stringify(people.slice(0, 30))}\n\n` +
    `Every contact point we found, with where it is published and what a web search for it shows:\n${JSON.stringify(brief)}\n\n` +
    `For EACH contact point decide its status:\n` +
    `- current: the company's working, official contact (on its own site or Maps, and nothing suggests otherwise)\n` +
    `- outdated: an old number, email or address still published somewhere (directories, old listings) that the official site no longer uses\n` +
    `- someone_else: other pages show it belongs to a different business or person\n` +
    `- personal: a named staff member's own mobile, WhatsApp or mailbox used as the company contact (say who, and whether the research shows they have LEFT)\n` +
    `- broken: cannot work (known_problem says why)\n` +
    `- unclear: not enough evidence\n` +
    `Rules: only use the evidence given. "personal" needs a person's name in the email, WhatsApp name or pages. Say "left" only if people says current=false or a lookup page shows them working elsewhere now.\n` +
    `Also list "inconsistent": places where customers get different contact details for the same thing (e.g. Maps phone differs from the website).\n` +
    `Return JSON only: {"points":[{"id":"","status":"","owner":"who this reaches (company / person name / other business)","left":true|false|null,"reason":"1 sentence with the evidence","fix":"1 sentence"}],"inconsistent":[{"what":"","fix":""}],"summary":"2 sentences for the owner"}`,
  )) : null;
  if (list.length && !verdict) ctx.warn('contact judgement did not parse; points stay unclear');
  const judged = new Map<string, any>((verdict?.points ?? []).map((x: any) => [x.id, x]));

  // ---- 6. Findings. ----
  const label = (p: Point) => (p.kind === 'phone' ? 'Phone' : p.kind === 'whatsapp' ? 'WhatsApp' : p.kind === 'email' ? 'Email' : 'Address');
  const sourceOf = (p: Point) => (p.web ?? []).find((w) => !w.own)?.url ?? null;
  for (const p of list) {
    const j = judged.get(p.id);
    const status = p.problem && (!j || j.status === 'unclear') ? 'broken' : String(j?.status ?? 'unclear');
    (p as any).status = status; (p as any).owner = j?.owner ?? null; (p as any).reason = j?.reason ?? p.problem ?? null; (p as any).fix = j?.fix ?? null; (p as any).left = j?.left ?? null;
    if (status === 'current' || status === 'unclear') continue;
    const sev = status === 'broken' && (p.on_site || p.on_maps) ? 'high' : status === 'someone_else' ? 'high' : status === 'personal' && j?.left ? 'high' : status === 'outdated' ? 'medium' : status === 'personal' ? 'medium' : 'low';
    const head = status === 'broken' ? `${label(p)} ${p.value} cannot work` : status === 'outdated' ? `An old ${label(p).toLowerCase()} is still published: ${p.value}` : status === 'someone_else' ? `${label(p)} ${p.value} is also used by ${j?.owner ?? 'someone else'}` : `${label(p)} ${p.value} reaches ${j?.owner ?? 'a staff member'} personally${j?.left ? ', who has left' : ''}`;
    add({ title: head, detail: `${j?.reason ?? p.problem ?? ''} Published on: ${p.where.slice(0, 4).join('; ')}.${j?.fix ? ' ' + j.fix : ''}`, severity: sev, source: sourceOf(p), check: `contact-${status}`, point: p.id });
  }
  for (const x of verdict?.inconsistent ?? []) if (x?.what) add({ title: `Customers get different contact details: ${String(x.what).slice(0, 140)}`, detail: String(x.fix ?? ''), severity: 'medium', source: null, check: 'contact-inconsistent' });
  const free = list.filter((p) => p.kind === 'email' && FREE_MAIL.test(p.key) && p.on_site);
  for (const p of free) add({ title: `Your website gives a free email address: ${p.key}`, detail: 'A free mailbox looks less established than one on your own domain, and it stays with whoever set it up if they leave.', severity: 'low', source: null, check: 'contact-free-mail' });
  const kinds = new Set(list.filter((p) => p.on_site).map((p) => p.kind));
  for (const [k, word] of [['phone', 'a phone number'], ['email', 'an email address'], ['whatsapp', 'a WhatsApp link']] as const) {
    if (C.sitePhones && !kinds.has(k)) add({ title: `Your website shows no ${word.replace(/^an? /, '')}`, detail: `A customer who prefers ${word} has no way to reach you from the site.`, severity: k === 'phone' ? 'high' : 'low', source: N.domains[0] ? `https://${N.domains[0]}/` : null, check: 'contact-missing' });
  }
  const ok = list.filter((p) => (p as any).status === 'current').length;
  if (verdict) add({ title: `${ok} of ${list.length} contact points we found reach you as they should`, detail: verdict.summary ?? '', severity: 'info', source: null, check: 'contact-summary' });

  return {
    findings,
    notes: {
      inventory: list.map((p: any) => ({ id: p.id, kind: p.kind, value: p.value, where: p.where, on_site: p.on_site, on_maps: p.on_maps, status: p.status, owner: p.owner, left: p.left, reason: p.reason, fix: p.fix, also_on: (p.web ?? []).filter((w: any) => !w.own).length })),
      judged: !!verdict, summary: verdict?.summary ?? null, inconsistent: verdict?.inconsistent ?? [], lookups,
    },
  };
}
