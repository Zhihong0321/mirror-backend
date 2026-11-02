// The reply side of /email-marketing: every lead reply gets a drafted answer from the
// contact model (CONTACT_LLM_*: Vectide deepseek-v4.1-flash), the operator reads it,
// edits it if needed, and Approve & send posts it into the same Smartlead thread.
//
// A reply is drafted as soon as its webhook lands, so it is usually ready by the time
// the page opens; opening a reply with no draft writes one on the spot. Drafts live in
// email_marketing_draft, one per lead message answered.
import type http from 'node:http';
import * as db from './reportdb.ts';
import { llm } from './core/index.ts';
import { smartlead as sl } from './core/index.ts';
import { campaignRow, htmlToText, leads, pick, stripQuoted, textToHtml, threads, webhookEvent } from './email-marketing.ts';

type Ctx = {
  json: (res: http.ServerResponse, status: number, body: unknown) => void;
  readJson: (req: http.IncomingMessage) => Promise<Record<string, unknown>>;
};

/** Who is writing, and what Eternalgy sells, for the model. The mailbox adds the signature. */
const SENDER = process.env.EMAIL_REPLY_SENDER?.trim() || [
  'You write as Gan Zhi Hong, Marketing Manager at Eternalgy Sdn Bhd.',
  'Eternalgy is a Malaysian solar PV company: engineering, procurement and construction (EPC), installation, maintenance and distribution of solar systems for commercial, industrial and home roofs. It is a SEDA-registered PV service provider and PV investor, based in Johor Bahru.',
  'WhatsApp for a faster chat: +60 11-2100 0099.',
].join('\n');

export interface Message { inbound: boolean; stats_id: string | null; message_id: string | null; time: string | null; subject: string | null; body: string; body_html: string }

export interface Draft {
  id: string; campaign_id: string; email: string; company_id: string | null;
  reply_message_id: string; reply_stats_id: string | null; reply_time: string | null; reply_html: string | null; reply_text: string | null;
  draft: string | null; status: 'drafting' | 'ready' | 'failed' | 'sent' | 'dismissed'; error: string | null; model: string | null;
  instruction: string | null; created_at: string; updated_at: string; sent_at: string | null; sent_body: string | null;
}

async function migrate(): Promise<void> {
  await db.migrate();
  await db.sql(`
    create table if not exists email_marketing_draft (
      id               bigserial primary key,
      campaign_id      bigint not null,
      email            text not null,
      company_id       bigint,
      reply_message_id text not null,
      reply_stats_id   text,
      reply_time       text,
      reply_html       text,
      reply_text       text,
      draft            text,
      status           text not null default 'drafting',
      error            text,
      model            text,
      instruction      text,
      created_at       timestamptz not null default now(),
      updated_at       timestamptz not null default now(),
      sent_at          timestamptz,
      sent_body        text,
      unique (campaign_id, email, reply_message_id)
    );
    comment on table email_marketing_draft is 'email-replies.ts: the drafted answer to one lead reply, and whether it was sent';
    create index if not exists email_marketing_draft_email_idx on email_marketing_draft (email);
  `);
}
let migrated: Promise<void> | null = null;
const ready = () => (migrated ??= migrate().catch((err) => { migrated = null; throw err; }));

/** The message a draft answers: the lead's latest. */
export function latestInbound(messages: Message[]): Message | null {
  for (let i = messages.length - 1; i >= 0; i--) if (messages[i].inbound) return messages[i];
  return null;
}

/** Messages carry no id in some Smartlead builds; the time keeps one reply apart from the next. */
export const messageKey = (m: Message) => String(m.message_id || m.stats_id || m.time || 'reply');

export function buildPrompt(input: { company: string | null; category: string | null; campaign: string | null; messages: Message[]; instruction?: string | null }): string {
  const thread = input.messages.map((m) =>
    `--- ${m.inbound ? 'THEM (the lead)' : 'US (Eternalgy)'}${m.time ? ' · ' + m.time : ''}${m.subject ? ' · subject: ' + m.subject : ''}\n${m.body.trim() || '(empty)'}`).join('\n\n');
  return [
    SENDER,
    '',
    `The lead: ${input.company || 'unknown company'}${input.category ? ` (${input.category})` : ''}. Campaign: ${input.campaign || 'cold email'}.`,
    '',
    'The email thread, oldest first:',
    thread,
    '',
    'Write our reply to their latest message.',
    '- Reply in the language they wrote in (English, Malay or Chinese).',
    '- Answer what they actually asked or said, first. Keep it short: under 120 words, 2 to 4 short paragraphs.',
    '- If they are interested or asking questions, move to one clear next step: a short call or a free site visit / roof assessment, and offer WhatsApp.',
    '- Never invent prices, savings figures, specifications, timelines or promises. If they ask for something you cannot know, say you will confirm it or work it out after seeing their roof and electricity bill.',
    '- If they are not interested or ask to stop, write one or two polite lines that close the conversation and say they will not be emailed again.',
    '- If it is an auto-reply or out-of-office, write a one-line note saying you will follow up later.',
    '- Do not mention links, booking pages, attachments or brochures: the email carries none. Ask them to reply with a good time, or WhatsApp.',
    '- Plain text only. No subject line, no "Dear [Name]" placeholders, no signature (it is added automatically), no markdown.',
    input.instruction ? `\nExtra instruction from the sender: ${input.instruction}` : '',
    '',
    'Output only the email body.',
  ].join('\n');
}

/** What the model returns, without fences, a subject line or a signature it added anyway. */
export function cleanDraft(answer: string): string {
  return answer
    .replace(/^```[a-z]*\s*|\s*```$/gi, '')
    .replace(/^subject:.*\n+/i, '')
    .replace(/\n+(best regards|regards|thank you|thanks|sincerely|warm regards|cheers),?\s*\n[\s\S]{0,200}$/i, (m) => (/gan zhi hong|eternalgy/i.test(m) ? '' : m))
    .trim();
}

async function companyFor(email: string, campaignId: number): Promise<{ id: string | null; name: string | null; category: string | null }> {
  const out = await db.sql<{ id: string | null; name: string | null; category: string | null }>(
    `select c.id::text, c.name, c.category from email_marketing_lead l left join company_data c on c.id = l.company_id
      where l.email = $1 order by (l.campaign_id = $2) desc limit 1`, [email, campaignId]);
  return out.rows[0] ?? { id: null, name: null, category: null };
}

/** The thread for this lead in this campaign (or its first campaign with a reply). */
async function loadThread(email: string, campaignId: number | null) {
  const t = await threads(email, campaignId);
  const thread = t.threads.find((x) => !campaignId || x.campaign_id === campaignId) ?? t.threads.find((x) => x.messages.some((m: Message) => m.inbound)) ?? t.threads[0] ?? null;
  return { lead: t.lead, thread };
}

const pending = new Map<string, Promise<Draft>>();

/**
 * Drafts the answer to the lead's latest message. One run per reply at a time: the
 * webhook and an opening page asking together share it. A failed model call is kept
 * as a failed draft with its reason; Rewrite tries again.
 */
export function generate(email: string, campaignId: number | null, instruction: string | null = null): Promise<Draft> {
  const key = email + '|' + (campaignId ?? '');
  const running = pending.get(key);
  if (running && !instruction) return running;
  const job = (async () => {
    await ready();
    const { lead, thread } = await loadThread(email, campaignId);
    if (!lead || !thread) throw Object.assign(new Error(`${email} has no Smartlead thread`), { status: 404 });
    const messages = thread.messages as Message[];
    const target = latestInbound(messages);
    if (!target) throw Object.assign(new Error(`${email} has not replied in "${thread.campaign_name}"`), { status: 404 });
    const company = await companyFor(email, thread.campaign_id);
    const ident = [thread.campaign_id, email, messageKey(target)];
    const existing = await db.sql<Draft>(`select * from email_marketing_draft where campaign_id = $1 and email = $2 and reply_message_id = $3`, ident);
    if (existing.rows[0]?.status === 'sent') return existing.rows[0];
    await db.sql(
      `insert into email_marketing_draft (campaign_id, email, company_id, reply_message_id, reply_stats_id, reply_time, reply_html, reply_text, status, instruction)
       values ($1, $2, $4, $3, $5, $6, $7, $8, 'drafting', $9)
       on conflict (campaign_id, email, reply_message_id) do update set status = 'drafting', error = null, instruction = excluded.instruction, updated_at = now()`,
      [...ident, company.id, target.stats_id, target.time, target.body_html, target.body, instruction]);
    let draft: string | null = null, error: string | null = null, model: string | null = null;
    try {
      // No cutoff of our own: the draft is worth waiting for, and the page shows it is writing.
      const out = await llm.ask(buildPrompt({ company: company.name ?? lead.company_name, category: company.category, campaign: thread.campaign_name, messages, instruction }), { timeoutMs: 30 * 60_000, step: 'email reply' });
      draft = cleanDraft(out.answer);
      model = out.model;
    } catch (err) {
      error = (err as Error).message;
    }
    const saved = await db.sql<Draft>(
      `update email_marketing_draft set draft = coalesce($4, draft), status = $5, error = $6, model = coalesce($7, model), updated_at = now()
        where campaign_id = $1 and email = $2 and reply_message_id = $3 returning *`,
      [...ident, draft, draft ? 'ready' : 'failed', error, model]);
    return saved.rows[0];
  })().finally(() => pending.delete(key));
  pending.set(key, job);
  return job;
}

/** The webhook's hook: draft in the background, never holding up Smartlead's call. */
export function draftSoon(email: string, campaignId: number | null): void {
  if (!llm.config()) return;
  void generate(email, campaignId).catch((err: Error) => console.warn(`[email-replies] no draft for ${email}: ${err.message}`));
}

export async function send(draftId: number, body: string): Promise<Draft> {
  await ready();
  const out = await db.sql<Draft>(`select * from email_marketing_draft where id = $1`, [draftId]);
  const d = out.rows[0];
  if (!d) throw Object.assign(new Error('no such draft'), { status: 404 });
  if (d.status === 'sent') throw Object.assign(new Error(`already sent ${d.sent_at}`), { status: 409 });
  if (!d.reply_stats_id) throw Object.assign(new Error('Smartlead gave this reply no stats id, so it cannot be answered in the thread'), { status: 422 });
  const text = body.trim();
  if (!text) throw Object.assign(new Error('the reply is empty'), { status: 400 });
  // Claim it first, so a double tap on a phone sends once.
  const claim = await db.sql(`update email_marketing_draft set status = 'sent', sent_at = now(), sent_body = $2, updated_at = now() where id = $1 and status <> 'sent' returning id`, [draftId, text]);
  if (!claim.rowCount) throw Object.assign(new Error('already sent'), { status: 409 });
  try {
    await sl.reply(Number(d.campaign_id), {
      email_stats_id: d.reply_stats_id,
      email_body: textToHtml(text),
      // reply_message_id doubles as the draft's key and can be a stats id or a time; only a real Message-ID goes on.
      reply_message_id: /[@<]/.test(d.reply_message_id) ? d.reply_message_id : undefined,
      reply_email_time: d.reply_time ?? undefined,
      reply_email_body: d.reply_html ?? undefined,
    });
  } catch (err) {
    await db.sql(`update email_marketing_draft set status = 'ready', sent_at = null, error = $2, updated_at = now() where id = $1`, [draftId, (err as Error).message]);
    throw err;
  }
  if (d.company_id) {
    await db.sql(
      `insert into lead_activity_log (company_id, action, previous_status, new_status, notes, is_mock, created_at)
       select c.id, 'email_event', coalesce(c.lead_status, 'unassigned'), 'email_answered', $2, false, now() from company_data c where c.id = $1`,
      [d.company_id, `Email reply sent to ${d.email}: ${text.slice(0, 600)}`]).catch(() => {});
  }
  return (await db.sql<Draft>(`select * from email_marketing_draft where id = $1`, [draftId])).rows[0];
}

export interface Conversation {
  email: string; campaign_id: number; campaign_name: string | null; company: string | null; category: string | null;
  replied_at: string | null; preview: string; draft_status: Draft['status'] | null; answered_at: string | null; needs_reply: boolean;
}

/**
 * Every thread where the lead replied: the webhook's record first, then Smartlead's
 * master inbox for anything that replied before the webhook existed.
 */
export async function conversations(): Promise<Conversation[]> {
  await ready();
  const local = await db.sql<{ email: string; campaign_id: string; campaign_name: string | null; replied_at: string; company: string | null; category: string | null }>(`
    select l.email, l.campaign_id::text, l.campaign_name, l.replied_at, c.name as company, c.category
      from email_marketing_lead l left join company_data c on c.id = l.company_id
     where l.replied_at is not null`);
  const lastReply = await db.sql<{ email: string; campaign_id: string; payload: unknown }>(`
    select distinct on (campaign_id, email) email, campaign_id::text, payload
      from email_marketing_event where event_type = 'EMAIL_REPLY' and email is not null
     order by campaign_id, email, received_at desc`);
  const drafts = await db.sql<{ email: string; campaign_id: string; status: Draft['status']; sent_at: string | null; updated_at: string }>(`
    select distinct on (campaign_id, email) email, campaign_id::text, status, sent_at, updated_at
      from email_marketing_draft order by campaign_id, email, created_at desc`);
  const key = (e: string, c: string | number) => c + '|' + e;
  const previews = new Map(lastReply.rows.map((r) => [key(r.email, r.campaign_id), webhookEvent(r.payload).text]));
  const draftOf = new Map(drafts.rows.map((r) => [key(r.email, r.campaign_id), r]));
  const byKey = new Map<string, Conversation>();
  const add = (c: Omit<Conversation, 'draft_status' | 'answered_at' | 'needs_reply'>) => {
    const k = key(c.email, c.campaign_id);
    const have = byKey.get(k);
    if (have) {
      if (!have.preview && c.preview) have.preview = c.preview;
      if (c.replied_at && (!have.replied_at || c.replied_at > have.replied_at)) have.replied_at = c.replied_at;
      return;
    }
    const d = draftOf.get(k);
    // pg hands timestamptz back as a Date; compared with the ISO replied_at it is never later.
    const answered = d?.status === 'sent' && d.sent_at ? new Date(d.sent_at).toISOString() : null;
    byKey.set(k, { ...c, draft_status: d?.status ?? null, answered_at: answered, needs_reply: false });
  };
  for (const r of local.rows) {
    add({ email: r.email, campaign_id: Number(r.campaign_id), campaign_name: r.campaign_name, company: r.company, category: r.category,
      replied_at: new Date(r.replied_at).toISOString(), preview: previews.get(key(r.email, r.campaign_id)) ?? '' });
  }
  if (sl.configured()) {
    for (let offset = 0; offset < 200; offset += 20) {
      const page = await sl.inboxReplies(offset, 20).catch(() => null);
      const rows: any[] = Array.isArray(page?.data) ? page!.data : [];
      for (const m of rows) {
        const email = String(pick(m, 'lead_email', 'lead.email', 'to_email', 'email') ?? '').toLowerCase();
        const campaign = Number(pick(m, 'email_campaign_id', 'campaign_id', 'campaign.id'));
        if (!email || !campaign) continue;
        const when = pick(m, 'last_reply_time', 'reply_time', 'last_message.received_at');
        add({ email, campaign_id: campaign, campaign_name: pick(m, 'email_campaign_name', 'campaign_name', 'campaign.name'),
          company: pick(m, 'lead_company_name', 'company_name', 'lead.company_name', 'lead.company'), category: null,
          replied_at: when ? new Date(when).toISOString() : null,
          preview: stripQuoted(htmlToText(pick(m, 'last_reply.email_body', 'last_message.body', 'email_body', 'reply_body') ?? '')) });
      }
      if (rows.length < 20) break;
    }
  }
  const list = [...byKey.values()];
  for (const c of list) {
    c.preview = c.preview.slice(0, 240);
    c.needs_reply = c.draft_status !== 'dismissed' && !(c.answered_at && (!c.replied_at || c.answered_at >= c.replied_at));
  }
  return list.sort((a, b) => String(b.replied_at ?? '').localeCompare(String(a.replied_at ?? '')));
}

/** The numbers the dashboard opens on. */
export async function dashboard() {
  const [leadSet, campaigns, mailboxes, convos, daily] = await Promise.all([
    db.configured() ? leads({}) : Promise.resolve({ all: [], shown: [] }),
    sl.configured() ? sl.listCampaigns().then((list) => Promise.all((list ?? []).map(async (c) => campaignRow(c, await sl.campaignAnalytics(c.id).catch(() => null))))) : [],
    sl.configured() ? sl.listMailboxes().catch(() => []) : [],
    conversations().catch(() => []),
    db.sql<{ day: string; sent: string; opened: string; replied: string; bounced: string }>(`
      select to_char(d, 'YYYY-MM-DD') as day,
             count(e.id) filter (where e.event_type = 'EMAIL_SENT')::text as sent,
             count(e.id) filter (where e.event_type = 'EMAIL_OPEN')::text as opened,
             count(e.id) filter (where e.event_type = 'EMAIL_REPLY')::text as replied,
             count(e.id) filter (where e.event_type = 'EMAIL_BOUNCE')::text as bounced
        from generate_series(date_trunc('day', now() at time zone 'Asia/Kuala_Lumpur') - interval '13 days', date_trunc('day', now() at time zone 'Asia/Kuala_Lumpur'), interval '1 day') d
        left join email_marketing_event e on date_trunc('day', e.at at time zone 'Asia/Kuala_Lumpur') = d
       group by d order by d`).then((r) => r.rows).catch(() => []),
  ]);
  const all = leadSet.all;
  const sum = (k: keyof ReturnType<typeof campaignRow>) => campaigns.reduce((n, c) => n + (Number(c[k]) || 0), 0);
  const sent = sum('sent');
  return {
    leads: {
      emails: new Set(all.map((r) => r.email)).size,
      companies: new Set(all.map((r) => r.company_id)).size,
      // Unique addresses, like emails above: one address can belong to two companies.
      in_campaign: new Set(all.filter((r) => r.campaigns.length).map((r) => r.email)).size,
      not_yet: new Set(all.filter((r) => !r.campaigns.length).map((r) => r.email)).size,
    },
    sending: {
      campaigns: campaigns.length, active: campaigns.filter((c) => c.status === 'ACTIVE').length,
      leads: sum('leads'), sent, opened: sum('opened'), clicked: sum('clicked'), replied: sum('replied'),
      bounced: sum('bounced'), unsubscribed: sum('unsubscribed'), interested: sum('interested'),
      open_rate: sent ? sum('opened') / sent : null, reply_rate: sent ? sum('replied') / sent : null, bounce_rate: sent ? sum('bounced') / sent : null,
      sent_today: (mailboxes ?? []).reduce((n: number, m: any) => n + (Number(m.daily_sent_count) || 0), 0),
      daily_capacity: (mailboxes ?? []).reduce((n: number, m: any) => n + (Number(m.message_per_day) || 0), 0),
      mailboxes: (mailboxes ?? []).length,
    },
    replies: { total: convos.length, waiting: convos.filter((c) => c.needs_reply).length },
    daily: daily.map((d) => ({ day: d.day, sent: Number(d.sent), opened: Number(d.opened), replied: Number(d.replied), bounced: Number(d.bounced) })),
    campaigns: campaigns.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))),
    model: llm.config()?.model ?? null,
  };
}

/** /api/email-marketing/{dashboard,conversations,response,drafts}, behind the operator token. */
export async function handle(req: http.IncomingMessage, res: http.ServerResponse, url: URL, ctx: Ctx): Promise<boolean> {
  const p = url.pathname;
  const method = req.method ?? 'GET';
  const send_ = (status: number, body: unknown) => { ctx.json(res, status, body); return true; };
  const routes = ['/api/email-marketing/dashboard', '/api/email-marketing/conversations', '/api/email-marketing/response', '/api/email-marketing/drafts'];
  if (!routes.some((r) => p === r || p.startsWith(r + '/'))) return false;
  if (!db.configured()) return send_(503, { error: 'no report database configured' });
  try {
    if (method === 'GET' && p === '/api/email-marketing/dashboard') return send_(200, await dashboard());

    if (method === 'GET' && p === '/api/email-marketing/conversations') {
      const list = await conversations();
      const filter = url.searchParams.get('filter') ?? 'all';
      return send_(200, { total: list.length, waiting: list.filter((c) => c.needs_reply).length, rows: filter === 'waiting' ? list.filter((c) => c.needs_reply) : list });
    }

    // One response, read on its own: the thread, the message being answered, and its draft.
    if (method === 'GET' && p === '/api/email-marketing/response') {
      await ready();
      const email = String(url.searchParams.get('email') ?? '').trim().toLowerCase();
      const campaignId = Number(url.searchParams.get('campaign_id')) || null;
      if (!email) return send_(400, { error: 'email is required' });
      const { lead, thread } = await loadThread(email, campaignId);
      if (!lead || !thread) return send_(404, { error: `${email} has no Smartlead thread` });
      const target = latestInbound(thread.messages as Message[]);
      const company = await companyFor(email, thread.campaign_id);
      const draft = target ? (await db.sql<Draft>(`select * from email_marketing_draft where campaign_id = $1 and email = $2 and reply_message_id = $3`,
        [thread.campaign_id, email, messageKey(target)])).rows[0] ?? null : null;
      return send_(200, { lead, company, thread, target, draft, drafting: pending.has(email + '|' + (campaignId ?? '')) || pending.has(email + '|' + thread.campaign_id), model: llm.config()?.model ?? null });
    }

    if (method === 'POST' && p === '/api/email-marketing/drafts') {
      if (!llm.config()) return send_(503, { error: 'no extract model lane is saved on /workers' });
      const body = await ctx.readJson(req);
      const email = String(body.email ?? '').trim().toLowerCase();
      if (!email) return send_(400, { error: 'email is required' });
      const instruction = String(body.instruction ?? '').trim() || null;
      return send_(200, { draft: await generate(email, Number(body.campaign_id) || null, instruction) });
    }

    const one = p.match(/^\/api\/email-marketing\/drafts\/(\d+)\/(send|dismiss)$/);
    if (method === 'POST' && one) {
      const id = Number(one[1]);
      if (one[2] === 'send') return send_(200, { draft: await send(id, String((await ctx.readJson(req)).body ?? '')) });
      await ready();
      const out = await db.sql<Draft>(`update email_marketing_draft set status = 'dismissed', updated_at = now() where id = $1 and status <> 'sent' returning *`, [id]);
      return send_(out.rowCount ? 200 : 409, out.rowCount ? { draft: out.rows[0] } : { error: 'already sent' });
    }
    return send_(404, { error: 'not found' });
  } catch (err) {
    const status = (err as { status?: number }).status ?? (err instanceof sl.SmartleadError ? (err.status >= 500 ? 502 : err.status) : 500);
    return send_(status, { error: (err as Error).message });
  }
}
