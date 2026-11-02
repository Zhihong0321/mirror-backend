// Smartlead (cold email) API client: campaigns, sequences, leads, master inbox.
//
// Key: on /workers (core/secrets.ts; SMARTLEAD_API_KEY only when none is saved). Smartlead takes
// it as an ?api_key= query parameter, so it is added here and never logged.
//
// Smartlead allows 10 requests per 2 seconds per key. Every call goes through one
// queue spaced 220 ms apart, and a 429 waits and goes again instead of failing.
import * as secrets from './secrets.ts';

const BASE = (process.env.SMARTLEAD_BASE_URL ?? 'https://server.smartlead.ai/api/v1').replace(/\/+$/, '');
const GAP_MS = 220;

export function configured(): boolean {
  return Boolean(secrets.get('smartlead'));
}

export class SmartleadError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

let queue: Promise<unknown> = Promise.resolve();
let lastAt = 0;

function paced<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(async () => {
    const wait = lastAt + GAP_MS - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastAt = Date.now();
    return task();
  });
  queue = run.catch(() => {});
  return run;
}

export async function call<T = any>(method: string, path: string, body?: unknown): Promise<T> {
  await secrets.load();
  if (!configured()) throw new SmartleadError(503, 'No Smartlead key: add one on /workers');
  const url = BASE + path + (path.includes('?') ? '&' : '?') + 'api_key=' + encodeURIComponent(secrets.get('smartlead'));
  for (let attempt = 0; ; attempt++) {
    const res = await paced(() => fetch(url, {
      method,
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    }));
    const text = await res.text();
    if (res.status === 429 && attempt < 5) {
      await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
      continue;
    }
    let data: any = text;
    try { data = text ? JSON.parse(text) : null; } catch { /* plain text answer */ }
    if (!res.ok) {
      const msg = typeof data === 'object' && data ? (data.message ?? data.error ?? JSON.stringify(data)) : String(text);
      throw new SmartleadError(res.status, `Smartlead ${method} ${path.split('?')[0]} ${res.status}: ${String(msg).slice(0, 300)}`);
    }
    return data as T;
  }
}

// ---- typed wrappers for the calls the hub makes --------------------------------

export interface Step { subject: string; body: string; delay_days: number }
export interface Schedule {
  timezone: string;
  days: number[];
  start_hour: string;
  end_hour: string;
  min_gap_minutes: number;
  max_new_per_day: number;
}
export interface LeadIn {
  email: string;
  first_name?: string;
  last_name?: string;
  company_name: string;
  custom_fields?: Record<string, string>;
}

export const listCampaigns = () => call<any[]>('GET', '/campaigns/');
export const getCampaign = (id: number) => call('GET', `/campaigns/${id}`);
export const campaignAnalytics = (id: number) => call('GET', `/campaigns/${id}/analytics`);
export const campaignSequences = (id: number) => call<any[]>('GET', `/campaigns/${id}/sequences`);
export const campaignMailboxes = (id: number) => call<any[]>('GET', `/campaigns/${id}/email-accounts`);
export const listMailboxes = () => call<any[]>('GET', '/email-accounts/?offset=0&limit=100');
export const leadCategories = () => call<any[]>('GET', '/leads/fetch-categories');

export async function createCampaign(name: string): Promise<number> {
  const out = await call<{ id: number }>('POST', '/campaigns/create', { name });
  return out.id;
}

export const deleteCampaign = (id: number) => call('DELETE', `/campaigns/${id}`);

/** Replaces the campaign's steps. Step 1 sends on day 0; each later step waits delay_days after the one before. */
export function saveSequences(id: number, steps: Step[]) {
  return call('POST', `/campaigns/${id}/sequences`, {
    sequences: steps.map((s, i) => ({
      seq_number: i + 1,
      subject: i === 0 ? s.subject : (s.subject || ''),
      email_body: s.body,
      seq_delay_details: { delay_in_days: i === 0 ? 0 : Math.max(1, Math.round(s.delay_days)) },
    })),
  });
}

export function saveSchedule(id: number, s: Schedule) {
  return call('POST', `/campaigns/${id}/schedule`, {
    timezone: s.timezone,
    days_of_the_week: s.days,
    start_hour: s.start_hour,
    end_hour: s.end_hour,
    min_time_btw_emails: s.min_gap_minutes,
    max_new_leads_per_day: s.max_new_per_day,
  });
}

/** Track opens and clicks; stop a lead's sequence once they reply. */
export function saveSettings(id: number) {
  return call('POST', `/campaigns/${id}/settings`, { track_settings: [], stop_lead_settings: 'REPLY_TO_AN_EMAIL', follow_up_percentage: 100 });
}

export const attachMailboxes = (id: number, ids: number[]) => call('POST', `/campaigns/${id}/email-accounts`, { email_account_ids: ids });

/** START, PAUSED or STOPPED. */
export const setStatus = (id: number, status: 'START' | 'PAUSED' | 'STOPPED') => call('POST', `/campaigns/${id}/status`, { status });

export interface UploadResult {
  upload_count?: number;
  duplicate_count?: number;
  invalid_email_count?: number;
  block_count?: number;
  skipped_in_other_campaign_count?: number;
  already_added_to_campaign?: number;
  unsubscribed_leads?: unknown[];
}

/** At most 100 per call; the caller batches. */
export function addLeads(id: number, leads: LeadIn[]) {
  return call<UploadResult>('POST', `/campaigns/${id}/leads`, {
    lead_list: leads,
    settings: { ignore_global_block_list: false, ignore_unsubscribe_list: false, ignore_duplicate_leads_in_other_campaign: false },
  });
}

export const campaignLeads = (id: number, offset: number, limit: number) =>
  call<{ total_leads: string; data: any[] }>('GET', `/campaigns/${id}/leads?offset=${offset}&limit=${limit}`);

export const messageHistory = (campaignId: number, leadId: number) =>
  call<{ history: any[] }>('GET', `/campaigns/${campaignId}/leads/${leadId}/message-history`);

export function inboxReplies(offset: number, limit: number, filters: Record<string, unknown> = {}) {
  return call<{ data: any[] }>('POST', '/master-inbox/inbox-replies?fetch_message_history=false', { offset, limit, filters, sortBy: 'REPLY_TIME_DESC' });
}

export interface ReplyIn {
  email_stats_id: string;
  email_body: string;
  reply_message_id?: string;
  reply_email_time?: string;
  reply_email_body?: string;
  cc?: string;
  bcc?: string;
}

export const reply = (campaignId: number, r: ReplyIn) =>
  call('POST', `/campaigns/${campaignId}/reply-email-thread`, { ...r, add_signature: true });

export const setCategory = (campaignId: number, leadId: number, categoryId: number | null) =>
  call('POST', `/campaigns/${campaignId}/leads/${leadId}/category`, { category_id: categoryId, pause_lead: false });

export const pauseLead = (campaignId: number, leadId: number) => call('POST', `/campaigns/${campaignId}/leads/${leadId}/pause`, {});
export const resumeLead = (campaignId: number, leadId: number) => call('POST', `/campaigns/${campaignId}/leads/${leadId}/resume`, {});

/** Webhooks are per campaign. Event names Smartlead accepts, checked live 2026-10-29. */
export const WEBHOOK_EVENTS = ['EMAIL_SENT', 'EMAIL_OPEN', 'EMAIL_LINK_CLICK', 'EMAIL_REPLY', 'EMAIL_BOUNCE', 'LEAD_UNSUBSCRIBED', 'LEAD_CATEGORY_UPDATED'];
export const campaignWebhooks = (campaignId: number) => call<any[]>('GET', `/campaigns/${campaignId}/webhooks`);
/** id null adds one; an existing id updates it. */
export const saveWebhook = (campaignId: number, w: { id: number | null; name: string; webhook_url: string }) =>
  call('POST', `/campaigns/${campaignId}/webhooks`, { ...w, event_types: WEBHOOK_EVENTS });

export const sendTest =(campaignId: number, leadId: number, sequenceNumber: number, to: string) =>
  call('POST', `/campaigns/${campaignId}/send-test-email`, { leadId, sequenceNumber, customEmailAddress: to });
