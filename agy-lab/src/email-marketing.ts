// /api/email-marketing: the hub's lead emails, sent and answered through Smartlead.
//
// Leads are email-list.ts rows that carry both a company name and a usable email.
// Pushing them into a Smartlead campaign is recorded in email_marketing_lead, so the
// lead list shows which campaign each email is already in and a second push skips it.
// Campaigns, sending, replies and the inbox live in Smartlead; these routes read and
// drive them so the whole loop runs from /email-marketing.
//
// Every campaign carries a hub webhook (added when the hub creates a campaign, and by
// a sync every 30 minutes for campaigns made in Smartlead itself). Its events land in
// email_marketing_event; replies, bounces, unsubscribes and category changes are also
// written to the lead's lead_activity_log, so the telemarketer sees them.
import type http from 'node:http';
import crypto from 'node:crypto';
import * as db from './reportdb.ts';
import * as emailList from './email-list.ts';
import { smartlead as sl } from './core/index.ts';

type Ctx = {
  json: (res: http.ServerResponse, status: number, body: unknown) => void;
  readJson: (req: http.IncomingMessage) => Promise<Record<string, unknown>>;
};

const BATCH = 100;
const VALID_EMAIL = /^[^@\s<>"',;]+@[a-z0-9.-]+\.[a-z]{2,}$/i;
const NOT_A_MAILBOX = /\.(png|jpe?g|gif|webp|svg|css|js)$/i;

export interface MarketingLead extends emailList.EmailRow {
  key: string;
  campaigns: {
    id: number; name: string | null; pushed_at: string; last_event: string | null; last_event_at: string | null;
    opened_at: string | null; replied_at: string | null; bounced_at: string | null; unsubscribed_at: string | null; category: string | null;
  }[];
}

/** An address that bounced or unsubscribed is never sent to again. */
export const doNotEmail = (r: MarketingLead) => r.campaigns.some((c) => c.bounced_at || c.unsubscribed_at);

export function eligible(row: emailList.EmailRow): boolean {
  return Boolean(row.company_name?.trim()) && VALID_EMAIL.test(row.email) && !NOT_A_MAILBOX.test(row.email);
}

async function pushedByEmail(): Promise<Map<string, MarketingLead['campaigns']>> {
  await db.migrate();
  const out = await db.sql<Omit<MarketingLead['campaigns'][number], 'id'> & { email: string; campaign_id: string }>(
    `select email, campaign_id::text, campaign_name as name, pushed_at, last_event, last_event_at, opened_at, replied_at, bounced_at, unsubscribed_at, category
       from email_marketing_lead order by pushed_at`);
  const map = new Map<string, MarketingLead['campaigns']>();
  for (const { email, campaign_id, ...rest } of out.rows) {
    const list = map.get(email) ?? [];
    list.push({ ...rest, id: Number(campaign_id) });
    map.set(email, list);
  }
  return map;
}

/** status: all | new (in no campaign yet) | pushed | replied | stopped (bounced or unsubscribed). */
export async function leads(options: { search?: string | null; source?: string | null; status?: string | null; fresh?: boolean }): Promise<{ all: MarketingLead[]; shown: MarketingLead[] }> {
  const [rows, pushed] = await Promise.all([emailList.allRows(options.fresh), pushedByEmail()]);
  const all = rows.filter(eligible).map((r) => ({ ...r, key: r.company_id + '|' + r.email, campaigns: pushed.get(r.email) ?? [] }));
  const status = options.status || 'all';
  const shown = (emailList.filter(all, options) as MarketingLead[])
    .filter((r) => status === 'all'
      || (status === 'new' && r.campaigns.length === 0)
      || (status === 'pushed' && r.campaigns.length > 0)
      || (status === 'replied' && r.campaigns.some((c) => c.replied_at))
      || (status === 'stopped' && doNotEmail(r)));
  return { all, shown };
}

function splitName(name: string | null): { first_name?: string; last_name?: string } {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return {};
  return { first_name: parts[0], last_name: parts.slice(1).join(' ') || undefined };
}

/**
 * The name as it reads inside an email. Maps titles carry emoji and taglines
 * ("️ ️ AK Freight Sdn Bhd | logistics Service Provider | Malaysia"); {{company_name}}
 * should say "AK Freight Sdn Bhd".
 */
export function mailName(name: string): string {
  const clean = name.replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}\u{200B}]/gu, '').replace(/\s+/g, ' ').trim();
  const first = clean.split(/\s+[|•·–—]\s+|\s+-\s+/)[0].trim();
  return first || clean;
}

export function toSmartlead(r: emailList.EmailRow): sl.LeadIn {
  const custom: Record<string, string> = { hub_company_id: r.company_id };
  if (r.category) custom.category = r.category;
  if (r.person_role) custom.role = r.person_role;
  return { email: r.email, company_name: mailName(r.company_name), ...splitName(r.person_name), custom_fields: custom };
}

/**
 * Sends the chosen rows into a campaign, 100 per call. One email reaches a campaign
 * once even when two companies share it. A failed batch is reported and the rest
 * still go.
 */
export async function push(campaignId: number, campaignName: string | null, rows: MarketingLead[]) {
  const seen = new Set<string>();
  const stopped = rows.filter(doNotEmail);
  const unique = rows.filter((r) => !doNotEmail(r) && !r.campaigns.some((c) => c.id === campaignId) && !seen.has(r.email) && seen.add(r.email));
  const totals = { requested: rows.length, do_not_email: new Set(stopped.map((r) => r.email)).size, sent: 0, added: 0, duplicates: 0, invalid: 0, blocked: 0, in_other_campaign: 0, failed: 0, errors: [] as string[] };
  for (let i = 0; i < unique.length; i += BATCH) {
    const batch = unique.slice(i, i + BATCH);
    try {
      const out = await sl.addLeads(campaignId, batch.map(toSmartlead));
      totals.sent += batch.length;
      totals.added += out.upload_count ?? 0;
      totals.duplicates += (out.duplicate_count ?? 0) + (out.already_added_to_campaign ?? 0);
      totals.invalid += out.invalid_email_count ?? 0;
      totals.blocked += (out.block_count ?? 0) + (out.unsubscribed_leads?.length ?? 0);
      totals.in_other_campaign += out.skipped_in_other_campaign_count ?? 0;
      await db.sql(
        `insert into email_marketing_lead (campaign_id, email, company_id, campaign_name)
         select $1::bigint, e.email, e.company_id::bigint, $2
           from jsonb_to_recordset($3::jsonb) as e(email text, company_id text)
         on conflict (campaign_id, email) do nothing`,
        [campaignId, campaignName, JSON.stringify(batch.map((r) => ({ email: r.email, company_id: r.company_id })))]);
    } catch (err) {
      totals.failed += batch.length;
      totals.errors.push((err as Error).message);
    }
  }
  return totals;
}

// ---- campaign setup -----------------------------------------------------------

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** The page edits plain text; Smartlead stores HTML. Blank lines make paragraphs. */
export function textToHtml(text: string): string {
  return text.trim().split(/\r?\n\s*\r?\n/).map((p) => '<p>' + esc(p).replace(/\r?\n/g, '<br>') + '</p>').join('');
}

export function htmlToText(html: string): string {
  return String(html ?? '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div)>\s*/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function readSteps(raw: unknown): sl.Step[] | null {
  if (!Array.isArray(raw)) return null;
  const steps = raw.map((s: any) => ({ subject: String(s?.subject ?? '').trim(), body: String(s?.body ?? ''), delay_days: Number(s?.delay_days) || 0 }))
    .filter((s) => s.body.trim());
  if (!steps.length) return null;
  if (!steps[0].subject) throw new Error('step 1 needs a subject');
  return steps.map((s) => ({ ...s, body: textToHtml(s.body) }));
}

function readSchedule(raw: any): sl.Schedule | null {
  if (!raw || typeof raw !== 'object') return null;
  const days = (Array.isArray(raw.days) ? raw.days : [1, 2, 3, 4, 5]).map(Number).filter((d: number) => d >= 0 && d <= 6);
  return {
    timezone: String(raw.timezone || 'Asia/Kuala_Lumpur'),
    days: days.length ? days : [1, 2, 3, 4, 5],
    start_hour: /^\d{2}:\d{2}$/.test(raw.start_hour) ? raw.start_hour : '09:00',
    end_hour: /^\d{2}:\d{2}$/.test(raw.end_hour) ? raw.end_hour : '17:00',
    min_gap_minutes: Math.max(3, Math.round(Number(raw.min_gap_minutes) || 10)),
    max_new_per_day: Math.max(1, Math.round(Number(raw.max_new_per_day) || 50)),
  };
}

/** Applies whichever of steps / schedule / mailboxes the body carries; each part runs even if another fails. */
async function setup(id: number, body: Record<string, unknown>, isNew: boolean): Promise<string[]> {
  const errors: string[] = [];
  const attempt = async (what: string, fn: () => Promise<unknown>) => {
    try { await fn(); } catch (err) { errors.push(what + ': ' + (err as Error).message); }
  };
  let steps: sl.Step[] | null = null;
  try { steps = readSteps(body.steps); } catch (err) { errors.push((err as Error).message); }
  if (steps) await attempt('sequence', () => sl.saveSequences(id, steps!));
  const schedule = readSchedule(body.schedule);
  if (schedule) await attempt('schedule', () => sl.saveSchedule(id, schedule));
  if (isNew) await attempt('settings', () => sl.saveSettings(id));
  if (isNew && webhookUrl()) await attempt('webhook', () => ensureWebhook(id));
  const mailboxes = Array.isArray(body.mailbox_ids) ? body.mailbox_ids.map(Number).filter(Boolean) : [];
  if (mailboxes.length) await attempt('mailboxes', () => sl.attachMailboxes(id, mailboxes));
  return errors;
}

// ---- inbox ---------------------------------------------------------------------

export const pick = (o: any, ...paths: string[]): any => {
  for (const p of paths) {
    const v = p.split('.').reduce((a, k) => (a == null ? a : a[k]), o);
    if (v != null && v !== '') return v;
  }
  return null;
};

/** One inbox row, whichever field names this Smartlead build answers with. */
export function inboxItem(m: any) {
  return {
    email: pick(m, 'lead_email', 'lead.email', 'to_email', 'email'),
    name: [pick(m, 'lead_first_name', 'lead.first_name'), pick(m, 'lead_last_name', 'lead.last_name')].filter(Boolean).join(' ') || null,
    company: pick(m, 'lead_company_name', 'company_name', 'lead.company_name', 'lead.company'),
    campaign_id: pick(m, 'email_campaign_id', 'campaign_id', 'campaign.id'),
    campaign_name: pick(m, 'email_campaign_name', 'campaign_name', 'campaign.name'),
    lead_id: pick(m, 'email_lead_id', 'lead_id', 'lead.id'),
    category_id: pick(m, 'lead_category_id', 'category.id'),
    time: pick(m, 'last_reply_time', 'reply_time', 'last_message.received_at', 'last_activity_at', 'updated_at'),
    subject: pick(m, 'last_reply.subject', 'last_message.subject', 'email_subject', 'subject'),
    preview: htmlToText(pick(m, 'last_reply.email_body', 'last_message.body', 'email_body', 'reply_body') ?? '').slice(0, 280),
    unread: pick(m, 'is_read') === false,
  };
}

/**
 * A reply without the email it quotes. Mail apps append the whole thread under
 * "On <date>, <sender> wrote:" (or the Malay, Chinese or Outlook form); the
 * reader and the model only need what the lead typed.
 */
export function stripQuoted(text: string): string {
  const lines = text.split('\n');
  const cut = lines.findIndex((l, i) =>
    /^\s*(on\b.{0,200}\bwrote:|pada\b.{0,200}\bmenulis:|-{2,}\s*original message\s*-{2,}|from:\s.+|发件人[:：]|.{0,120}(写道|寫道)[:：])\s*$/i.test(l)
    || (/^\s*on\b/i.test(l) && /wrote:\s*$/i.test(lines[i + 1] ?? ''))
    || (/^\s*>/.test(l) && lines.slice(i).every((x) => !x.trim() || /^\s*>/.test(x))));
  const kept = (cut > 0 ? lines.slice(0, cut) : lines).join('\n').trim();
  return kept || text.trim();
}

/** One message of a thread, normalised. */
export function threadMessage(h: any) {
  const type = String(pick(h, 'type', 'direction') ?? '').toUpperCase();
  const inbound = type === 'REPLY' || type === 'INBOUND';
  const text = htmlToText(String(pick(h, 'email_body', 'body') ?? ''));
  return {
    inbound,
    stats_id: pick(h, 'stats_id', 'email_stats_id'),
    message_id: pick(h, 'message_id', 'id'),
    time: pick(h, 'time', 'sent_at', 'received_at'),
    from: pick(h, 'from'),
    to: pick(h, 'to'),
    subject: pick(h, 'subject'),
    body_html: String(pick(h, 'email_body', 'body') ?? ''),
    body: inbound ? stripQuoted(text) : text,
    seq: pick(h, 'email_seq_number'),
  };
}

/** Every campaign thread with this email, found from Smartlead's lead record. */
export async function threads(email: string, onlyCampaign: number | null) {
  const lead = await sl.call('GET', '/leads/?email=' + encodeURIComponent(email)).catch(() => null);
  if (!lead?.id) return { lead: null, threads: [] };
  const camps: any[] = (lead.lead_campaign_data ?? []).filter((c: any) => !onlyCampaign || Number(c.campaign_id) === onlyCampaign);
  const out = [];
  for (const c of camps) {
    const h = await sl.messageHistory(Number(c.campaign_id), Number(lead.id)).catch((err) => ({ history: [], error: (err as Error).message }));
    out.push({
      campaign_id: Number(c.campaign_id), campaign_name: c.campaign_name, category_id: c.lead_category_id,
      last_sent_at: c.last_sent_at, last_reply_at: c.last_reply_at,
      messages: (h.history ?? []).map(threadMessage), error: (h as any).error ?? null,
    });
  }
  return {
    lead: { id: Number(lead.id), email: lead.email, first_name: lead.first_name, last_name: lead.last_name, company_name: lead.company_name, custom_fields: lead.custom_fields, unsubscribed: lead.is_unsubscribed },
    threads: out,
  };
}

// ---- webhook ---------------------------------------------------------------------

export const WEBHOOK_PATH = '/api/email-marketing/webhook';

/** Derived from LAB_TOKEN, so the hub needs no extra secret and a rotated token rotates it. */
export function webhookKey(): string {
  return crypto.createHash('sha256').update('smartlead-webhook:' + (process.env.LAB_TOKEN ?? '')).digest('hex').slice(0, 32);
}

export function webhookUrl(): string | null {
  const base = process.env.SMARTLEAD_WEBHOOK_BASE?.trim()
    || (process.env.RAILWAY_PUBLIC_DOMAIN ? 'https://' + process.env.RAILWAY_PUBLIC_DOMAIN : '');
  return base ? base.replace(/\/+$/, '') + WEBHOOK_PATH + '?key=' + webhookKey() : null;
}

/** Adds the hub webhook to a campaign, or repoints it when the URL changed. Returns whether it wrote. */
async function ensureWebhook(campaignId: number): Promise<boolean> {
  const want = webhookUrl();
  if (!want) return false;
  const hooks = (await sl.campaignWebhooks(campaignId)) ?? [];
  const ours = hooks.find((w) => String(w.webhook_url ?? '').includes(WEBHOOK_PATH));
  const complete = ours && sl.WEBHOOK_EVENTS.every((e) => (ours.event_types ?? []).includes(e));
  if (ours && ours.webhook_url === want && complete) return false;
  await sl.saveWebhook(campaignId, { id: ours?.id ?? null, name: 'ee-auto hub', webhook_url: want });
  return true;
}

export const webhookState = { last_sync: null as string | null, campaigns: 0, with_webhook: 0, added: 0, errors: [] as string[] };

export async function syncWebhooks(): Promise<typeof webhookState> {
  const list = (await sl.listCampaigns()) ?? [];
  let ok = 0, added = 0;
  const errors: string[] = [];
  for (const c of list) {
    try { if (await ensureWebhook(c.id)) added++; ok++; } catch (err) { errors.push(`${c.name}: ${(err as Error).message}`); }
  }
  Object.assign(webhookState, { last_sync: new Date().toISOString(), campaigns: list.length, with_webhook: ok, added: webhookState.added + added, errors });
  return webhookState;
}

/** Every 30 minutes, so a campaign made in Smartlead's own UI still reports back. */
export function start(): void {
  if (!sl.configured() || !webhookUrl()) return;
  const tick = () => void syncWebhooks()
    .then((s) => { if (s.errors.length) console.warn('[email-marketing] webhook sync: ' + s.errors.join('; ')); })
    .catch((err: Error) => console.warn('[email-marketing] webhook sync failed: ' + err.message));
  setTimeout(tick, 15_000);
  setInterval(tick, 30 * 60_000);
}

/** One webhook call, whichever field names this Smartlead build sends. */
export function webhookEvent(b: any) {
  const at = pick(b, 'event_timestamp', 'timestamp', 'reply_message.time', 'time');
  const parsed = at ? new Date(at) : null;
  return {
    type: String(pick(b, 'event_type', 'event', 'type') ?? '').toUpperCase(),
    campaign_id: Number(pick(b, 'campaign_id', 'email_campaign_id', 'campaign.id')) || null,
    campaign_name: pick(b, 'campaign_name', 'campaign.name') as string | null,
    email: String(pick(b, 'sl_lead_email', 'lead_email', 'lead.email', 'lead_data.email', 'to_email') ?? '').trim().toLowerCase() || null,
    hub_company_id: Number(pick(b, 'lead_data.custom_fields.hub_company_id', 'lead.custom_fields.hub_company_id', 'custom_fields.hub_company_id')) || null,
    at: parsed && !isNaN(parsed.getTime()) ? parsed.toISOString() : new Date().toISOString(),
    subject: pick(b, 'subject', 'reply_message.subject', 'reply.subject') as string | null,
    text: htmlToText(String(pick(b, 'reply_message.text', 'reply_message.html', 'reply.body', 'preview_text', 'reply_body') ?? '')).slice(0, 1500),
    category: pick(b, 'lead_category.new_name', 'lead_category.name', 'category.name', 'lead_category_name', 'category') as string | null,
  };
}

const ACTIVITY: Record<string, string> = {
  EMAIL_REPLY: 'email_replied', EMAIL_BOUNCE: 'email_bounced', LEAD_UNSUBSCRIBED: 'email_unsubscribed', LEAD_CATEGORY_UPDATED: 'email_category',
};

/** The line the telemarketer reads on the lead's activity. */
export function activityNote(e: ReturnType<typeof webhookEvent>): string {
  const camp = e.campaign_name ? ` (campaign "${e.campaign_name}")` : '';
  switch (e.type) {
    case 'EMAIL_REPLY': return `Email reply from ${e.email}${camp}: ${e.text || e.subject || '(no text)'}`;
    case 'EMAIL_BOUNCE': return `Email to ${e.email} bounced${camp}. It will not be emailed again.`;
    case 'LEAD_UNSUBSCRIBED': return `${e.email} unsubscribed from email${camp}. It will not be emailed again.`;
    default: return `${e.email} marked "${e.category ?? '?'}" in Smartlead${camp}.`;
  }
}

async function recordEvent(body: Record<string, unknown>): Promise<void> {
  await db.migrate();
  const e = webhookEvent(body);
  // Smartlead puts part of the API key (secret_key) and our keyed URL in every call; neither is kept.
  const { secret_key: _secret, webhook_url: _url, ...kept } = body;
  await db.sql(`insert into email_marketing_event (campaign_id, email, event_type, at, payload) values ($1, $2, $3, $4::timestamptz, $5::jsonb)`,
    [e.campaign_id, e.email, e.type || 'UNKNOWN', e.at, JSON.stringify(kept)]);
  if (!e.campaign_id || !e.email) return;
  const when = (type: string) => (e.type === type ? e.at : null);
  const row = await db.sql<{ company_id: string | null }>(
    `insert into email_marketing_lead (campaign_id, email, company_id, campaign_name, last_event, last_event_at, opened_at, replied_at, bounced_at, unsubscribed_at, category)
     values ($1, $2, $3, $4, $5, $6::timestamptz, $7::timestamptz, $8::timestamptz, $9::timestamptz, $10::timestamptz, $11)
     on conflict (campaign_id, email) do update set
       company_id      = coalesce(email_marketing_lead.company_id, excluded.company_id),
       campaign_name   = coalesce(excluded.campaign_name, email_marketing_lead.campaign_name),
       last_event      = excluded.last_event,
       last_event_at   = excluded.last_event_at,
       opened_at       = coalesce(email_marketing_lead.opened_at, excluded.opened_at),
       replied_at      = coalesce(excluded.replied_at, email_marketing_lead.replied_at),
       bounced_at      = coalesce(email_marketing_lead.bounced_at, excluded.bounced_at),
       unsubscribed_at = coalesce(email_marketing_lead.unsubscribed_at, excluded.unsubscribed_at),
       category        = coalesce(excluded.category, email_marketing_lead.category)
     returning company_id::text`,
    [e.campaign_id, e.email, e.hub_company_id, e.campaign_name, e.type, e.at,
      when('EMAIL_OPEN'), when('EMAIL_REPLY'), when('EMAIL_BOUNCE'), when('LEAD_UNSUBSCRIBED'), e.type === 'LEAD_CATEGORY_UPDATED' ? e.category : null]);
  const companyId = Number(row.rows[0]?.company_id) || null;
  // Smartlead's reply history can trail its webhook by a moment; the draft reads that history.
  if (e.type === 'EMAIL_REPLY') setTimeout(() => void import('./email-replies.ts').then((r) => r.draftSoon(e.email!, e.campaign_id)), 20_000);
  const status = ACTIVITY[e.type];
  if (!companyId || !status) return;
  // No telemarketer name: these are not agent work and must not count in agent stats.
  await db.sql(
    `insert into lead_activity_log (company_id, action, previous_status, new_status, notes, is_mock, created_at)
     select c.id, 'email_event', coalesce(c.lead_status, 'unassigned'), $2, $3, false, $4::timestamptz from company_data c where c.id = $1`,
    [companyId, status, activityNote(e), e.at]);
}

function sameKey(a: string, b: string): boolean {
  const d = (v: string) => crypto.createHash('sha256').update(v).digest();
  return crypto.timingSafeEqual(d(a), d(b));
}

/** POST /api/email-marketing/webhook?key=…, called by Smartlead; outside the LAB_TOKEN gate. */
export async function handleWebhook(req: http.IncomingMessage, res: http.ServerResponse, url: URL, ctx: Ctx): Promise<boolean> {
  if (url.pathname !== WEBHOOK_PATH) return false;
  if (req.method !== 'POST') { ctx.json(res, 405, { error: 'POST only' }); return true; }
  if (!sameKey(url.searchParams.get('key') ?? '', webhookKey())) { ctx.json(res, 401, { error: 'bad key' }); return true; }
  let body: Record<string, unknown>;
  try { body = await ctx.readJson(req); } catch { ctx.json(res, 400, { error: 'body is not JSON' }); return true; }
  try {
    await recordEvent(body);
    ctx.json(res, 200, { ok: true });
  } catch (err) {
    // 5xx so Smartlead sends it again rather than the event being lost.
    console.warn('[email-marketing] webhook not saved: ' + (err as Error).message);
    ctx.json(res, 500, { error: 'not saved' });
  }
  return true;
}

// ---- routes --------------------------------------------------------------------

let categoryCache: { at: number; list: any[] } | null = null;
async function categories() {
  if (!categoryCache || Date.now() - categoryCache.at > 3600_000) categoryCache = { at: Date.now(), list: await sl.leadCategories() };
  return categoryCache.list.map((c) => ({ id: c.id, name: c.name, sentiment: c.sentiment_type }));
}

export function campaignRow(c: any, a: any) {
  const n = (v: unknown) => Number(v ?? 0) || 0;
  return {
    id: c.id, name: c.name, status: c.status, created_at: c.created_at,
    leads: n(a?.campaign_lead_stats?.total), not_started: n(a?.campaign_lead_stats?.notStarted), in_progress: n(a?.campaign_lead_stats?.inprogress),
    completed: n(a?.campaign_lead_stats?.completed), interested: n(a?.campaign_lead_stats?.interested),
    sent: n(a?.unique_sent_count ?? a?.sent_count), opened: n(a?.unique_open_count ?? a?.open_count), clicked: n(a?.unique_click_count ?? a?.click_count),
    replied: n(a?.reply_count), bounced: n(a?.bounce_count), unsubscribed: n(a?.unsubscribed_count),
  };
}

const intParam = (url: URL, name: string, dflt: number, max: number) =>
  Math.min(Math.max(Math.round(Number(url.searchParams.get(name) ?? dflt) || dflt), 0), max);

export async function handle(req: http.IncomingMessage, res: http.ServerResponse, url: URL, ctx: Ctx): Promise<boolean> {
  const p = url.pathname;
  if (p !== '/api/email-marketing' && !p.startsWith('/api/email-marketing/')) return false;
  const method = req.method ?? 'GET';
  const send = (status: number, body: unknown) => { ctx.json(res, status, body); return true; };
  try {
    if (method === 'GET' && (p === '/api/email-marketing' || p === '/api/email-marketing/status')) {
      if (!sl.configured()) return send(200, { configured: false, mailboxes: [], categories: [] });
      const lastEvents = async () => {
        if (!db.configured()) return null;
        await db.migrate();
        const out = await db.sql<{ last: string | null; week: string }>(
          `select max(received_at) as last, count(*) filter (where received_at > now() - interval '7 days')::text as week from email_marketing_event`);
        return out.rows[0] ?? null;
      };
      const [mailboxes, cats, events] = await Promise.all([sl.listMailboxes(), categories(), lastEvents().catch(() => null)]);
      return send(200, {
        configured: true,
        categories: cats,
        webhook: { ready: Boolean(webhookUrl()), ...webhookState, last_event_at: events?.last ?? null, events_7d: Number(events?.week ?? 0) },
        mailboxes: (mailboxes ?? []).map((m: any) => ({
          id: m.id, email: pick(m, 'from_email', 'email'), name: pick(m, 'from_name', 'name'), type: pick(m, 'type'),
          daily_limit: pick(m, 'message_per_day', 'max_email_per_day'), sent_today: pick(m, 'daily_sent_count'),
          warmup: pick(m, 'warmup_details.status'), reputation: pick(m, 'warmup_details.warmup_reputation'),
          smtp_ok: pick(m, 'is_smtp_success'), imap_ok: pick(m, 'is_imap_success'),
        })),
      });
    }

    if (method === 'GET' && p === '/api/email-marketing/leads') {
      if (!db.configured()) return send(503, { error: 'no report database configured' });
      const { all, shown } = await leads({
        search: url.searchParams.get('search'), source: url.searchParams.get('source'),
        status: url.searchParams.get('status'), fresh: url.searchParams.get('fresh') === '1',
      });
      const limit = Math.max(1, intParam(url, 'limit', 50, 500));
      const offset = intParam(url, 'offset', 0, 1e9);
      return send(200, {
        stats: {
          eligible: all.length,
          emails: new Set(all.map((r) => r.email)).size,
          companies: new Set(all.map((r) => r.company_id)).size,
          with_person: all.filter((r) => r.person_name).length,
          in_campaign: all.filter((r) => r.campaigns.length).length,
          replied: all.filter((r) => r.campaigns.some((c) => c.replied_at)).length,
          do_not_email: all.filter(doNotEmail).length,
          not_yet: all.filter((r) => !r.campaigns.length).length,
        },
        total: shown.length, limit, offset, rows: shown.slice(offset, offset + limit),
      });
    }

    if (method === 'POST' && p === '/api/email-marketing/webhooks/sync') {
      if (!webhookUrl()) return send(503, { error: 'no public URL: set SMARTLEAD_WEBHOOK_BASE' });
      return send(200, await syncWebhooks());
    }

    if (method === 'GET' && p === '/api/email-marketing/events') {
      const out = await db.sql(`select id::text, campaign_id::text, email, event_type, at, received_at, payload from email_marketing_event order by received_at desc limit $1`,
        [Math.max(1, intParam(url, 'limit', 20, 200))]);
      return send(200, { rows: out.rows });
    }

    if (method === 'GET' && p === '/api/email-marketing/campaigns') {
      const list = (await sl.listCampaigns()) ?? [];
      const rows = await Promise.all(list.map(async (c) => campaignRow(c, await sl.campaignAnalytics(c.id).catch(() => null))));
      return send(200, { campaigns: rows.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))) });
    }

    if (method === 'POST' && p === '/api/email-marketing/campaigns') {
      const body = await ctx.readJson(req);
      const name = String(body.name ?? '').trim();
      if (!name) return send(400, { error: 'name is required' });
      const id = await sl.createCampaign(name);
      const errors = await setup(id, body, true);
      return send(200, { id, name, errors });
    }

    const camp = p.match(/^\/api\/email-marketing\/campaigns\/(\d+)(\/.*)?$/);
    if (camp) {
      const id = Number(camp[1]);
      const sub = camp[2] ?? '';
      if (method === 'GET' && sub === '') {
        const [c, a, seq, boxes] = await Promise.all([sl.getCampaign(id), sl.campaignAnalytics(id), sl.campaignSequences(id), sl.campaignMailboxes(id)]);
        const cron = c.scheduler_cron_value ?? {};
        return send(200, {
          campaign: campaignRow(c, a),
          schedule: { timezone: cron.tz ?? null, days: cron.days ?? [], start_hour: cron.startHour ?? null, end_hour: cron.endHour ?? null, min_gap_minutes: c.min_time_btwn_emails, max_new_per_day: c.max_leads_per_day },
          steps: (seq ?? []).sort((x: any, y: any) => x.seq_number - y.seq_number).map((s: any) => ({
            seq_number: s.seq_number, subject: s.subject || '', body: htmlToText(s.email_body), delay_days: s.seq_delay_details?.delay_in_days ?? 0,
          })),
          mailboxes: (boxes ?? []).map((m: any) => ({ id: m.id, email: m.from_email, name: m.from_name })),
        });
      }
      if (method === 'POST' && sub === '/setup') {
        return send(200, { id, errors: await setup(id, await ctx.readJson(req), false) });
      }
      if (method === 'POST' && sub === '/status') {
        const status = String((await ctx.readJson(req)).status ?? '').toUpperCase();
        if (!['START', 'PAUSED', 'STOPPED'].includes(status)) return send(400, { error: 'status is START, PAUSED or STOPPED' });
        await sl.setStatus(id, status as 'START');
        return send(200, { id, status });
      }
      if (method === 'DELETE' && sub === '') {
        await sl.deleteCampaign(id);
        await db.sql(`delete from email_marketing_lead where campaign_id = $1`, [id]).catch(() => {});
        return send(200, { id, deleted: true });
      }
      if (method === 'POST' && sub === '/leads') {
        if (!db.configured()) return send(503, { error: 'no report database configured' });
        const body = await ctx.readJson(req);
        const { all, shown } = await leads({ search: body.search as string, source: body.source as string, status: body.status as string });
        const keys = Array.isArray(body.keys) ? new Set(body.keys.map(String)) : null;
        const rows = keys ? all.filter((r) => keys.has(r.key)) : (body.all === true ? shown : []);
        if (!rows.length) return send(400, { error: 'no leads chosen: send keys[] or all:true with the filter' });
        const c = await sl.getCampaign(id);
        return send(200, await push(id, c?.name ?? null, rows));
      }
      if (method === 'GET' && sub === '/leads') {
        const out = await sl.campaignLeads(id, intParam(url, 'offset', 0, 1e9), Math.max(1, intParam(url, 'limit', 50, 100)));
        return send(200, {
          total: Number(out.total_leads ?? 0),
          rows: (out.data ?? []).map((d: any) => ({
            lead_id: d.lead?.id, email: d.lead?.email, name: [d.lead?.first_name, d.lead?.last_name].filter(Boolean).join(' ') || null,
            company: d.lead?.company_name, status: d.status, category_id: d.lead_category_id, added_at: d.created_at, unsubscribed: d.lead?.is_unsubscribed,
          })),
        });
      }
      if (method === 'POST' && sub === '/test') {
        const body = await ctx.readJson(req);
        const to = String(body.email ?? '').trim();
        if (!VALID_EMAIL.test(to)) return send(400, { error: 'a test address is required' });
        const first = await sl.campaignLeads(id, 0, 1);
        const leadId = first.data?.[0]?.lead?.id;
        if (!leadId) return send(400, { error: 'add at least one lead first: the test email fills its {{fields}} from a real lead' });
        await sl.sendTest(id, Number(leadId), Math.max(1, Number(body.sequence) || 1), to);
        return send(200, { sent: true, to, as_lead: first.data[0].lead.email });
      }
      const leadAction = sub.match(/^\/leads\/(\d+)\/(pause|resume|category)$/);
      if (method === 'POST' && leadAction) {
        const leadId = Number(leadAction[1]);
        if (leadAction[2] === 'pause') await sl.pauseLead(id, leadId);
        else if (leadAction[2] === 'resume') await sl.resumeLead(id, leadId);
        else {
          const cat = (await ctx.readJson(req)).category_id;
          await sl.setCategory(id, leadId, cat == null || cat === '' ? null : Number(cat));
        }
        return send(200, { ok: true });
      }
    }

    if (method === 'GET' && p === '/api/email-marketing/inbox') {
      const filters: Record<string, unknown> = {};
      const campaign = Number(url.searchParams.get('campaign_id'));
      if (campaign) filters.campaignId = [campaign];
      const out = await sl.inboxReplies(intParam(url, 'offset', 0, 1e9), Math.max(1, intParam(url, 'limit', 20, 20)), filters);
      const list: any[] = Array.isArray(out?.data) ? out.data : Array.isArray((out as any)?.messages) ? (out as any).messages : [];
      return send(200, { rows: list.map(inboxItem) });
    }

    if (method === 'GET' && p === '/api/email-marketing/thread') {
      const email = String(url.searchParams.get('email') ?? '').trim().toLowerCase();
      if (!email) return send(400, { error: 'email is required' });
      return send(200, await threads(email, Number(url.searchParams.get('campaign_id')) || null));
    }

    if (method === 'POST' && p === '/api/email-marketing/reply') {
      const body = await ctx.readJson(req);
      const campaignId = Number(body.campaign_id);
      const text = String(body.body ?? '').trim();
      if (!campaignId || !body.stats_id || !text) return send(400, { error: 'campaign_id, stats_id and body are required' });
      await sl.reply(campaignId, {
        email_stats_id: String(body.stats_id),
        email_body: textToHtml(text),
        reply_message_id: body.message_id ? String(body.message_id) : undefined,
        reply_email_time: body.time ? String(body.time) : undefined,
        reply_email_body: body.original_html ? String(body.original_html) : undefined,
        cc: body.cc ? String(body.cc) : undefined,
      });
      return send(200, { sent: true });
    }

    return send(404, { error: 'not found' });
  } catch (err) {
    const status = err instanceof sl.SmartleadError ? (err.status >= 500 ? 502 : err.status) : 500;
    return send(status, { error: (err as Error).message });
  }
}
