import test from 'node:test';
import assert from 'node:assert/strict';
import { eligible, mailName, toSmartlead, textToHtml, htmlToText, inboxItem, threadMessage, stripQuoted, webhookEvent, activityNote, webhookKey, webhookUrl, doNotEmail, type MarketingLead } from './email-marketing.ts';
import { page } from './email-marketing-page.ts';
import type { EmailRow } from './email-list.ts';

const row = (over: Partial<EmailRow> = {}): EmailRow => ({
  email: 'sales@acme.com.my', company_id: '42', company_name: 'Acme Sdn Bhd', category: 'Factory',
  person_name: null, person_role: null, sources: ['website'], source_url: null, lead_status: null, assigned_to: null, ...over,
});

test('a lead needs a company name and a real mailbox', () => {
  assert.equal(eligible(row()), true);
  assert.equal(eligible(row({ company_name: '  ' })), false);
  assert.equal(eligible(row({ email: 'logo@2x.png' })), false);
  assert.equal(eligible(row({ email: 'no-at-sign.com' })), false);
});

test('a person name splits into first and last; the hub id rides along', () => {
  const lead = toSmartlead(row({ person_name: 'Tan Wei Ming', person_role: 'Director' }));
  assert.equal(lead.first_name, 'Tan');
  assert.equal(lead.last_name, 'Wei Ming');
  assert.deepEqual(lead.custom_fields, { hub_company_id: '42', category: 'Factory', role: 'Director' });
  assert.equal(toSmartlead(row()).first_name, undefined);
});

test('a Maps title loses its emoji and tagline before it goes into an email', () => {
  assert.equal(mailName('️ ️ AK Freight Sdn Bhd | logistics Service Provider | Malaysia'), 'AK Freight Sdn Bhd');
  assert.equal(mailName('Syarikat Lim & Sons - Solar Installer'), 'Syarikat Lim & Sons');
  assert.equal(mailName('Coca-Cola Bottlers (M) Sdn Bhd'), 'Coca-Cola Bottlers (M) Sdn Bhd');
  assert.equal(toSmartlead(row({ company_name: '🌞 Sun Power | Johor' })).company_name, 'Sun Power');
});

test('plain text becomes paragraphs and comes back the same', () => {
  const text = 'Hi {{company_name}} team,\n\nLine one\nline two <ok>';
  const html = textToHtml(text);
  assert.equal(html, '<p>Hi {{company_name}} team,</p><p>Line one<br>line two &lt;ok&gt;</p>');
  assert.equal(htmlToText(html), text);
});

test('inbox rows and thread messages read either field naming', () => {
  const a = inboxItem({ lead_email: 'x@y.com', email_campaign_id: 7, email_lead_id: 9, last_reply_time: 't', is_read: false });
  assert.deepEqual([a.email, a.campaign_id, a.lead_id, a.unread], ['x@y.com', 7, 9, true]);
  const b = inboxItem({ lead: { email: 'x@y.com', id: 9 }, campaign: { id: 7, name: 'C' }, last_message: { body: '<p>hello</p>' } });
  assert.deepEqual([b.email, b.campaign_id, b.lead_id, b.preview], ['x@y.com', 7, 9, 'hello']);
  const m = threadMessage({ type: 'REPLY', stats_id: 's', message_id: '<m>', time: 't', email_body: '<p>yes</p>' });
  assert.deepEqual([m.inbound, m.stats_id, m.body], [true, 's', 'yes']);
  assert.equal(threadMessage({ type: 'SENT' }).inbound, false);
});

test('the page links out and calls only its own API', () => {
  const html = page();
  assert.match(html, /aria-current="page">Email marketing</);
  assert.doesNotMatch(html, /\$\{/);
  assert.doesNotMatch(html, /api_key=|server\.smartlead\.ai/i);
});

test('a webhook call reads either field naming and keeps the reply text', () => {
  const a = webhookEvent({
    event_type: 'EMAIL_REPLY', campaign_id: 7, campaign_name: 'Solar Q4', sl_lead_email: 'Boss@Acme.com',
    event_timestamp: '2026-10-29T06:00:00Z', reply_message: { html: '<p>Yes, call me</p>' }, lead_data: { custom_fields: { hub_company_id: '42' } },
  });
  assert.deepEqual([a.type, a.campaign_id, a.email, a.hub_company_id, a.at, a.text], ['EMAIL_REPLY', 7, 'boss@acme.com', 42, '2026-10-29T06:00:00.000Z', 'Yes, call me']);
  assert.equal(activityNote(a), 'Email reply from boss@acme.com (campaign "Solar Q4"): Yes, call me');
  const b = webhookEvent({ event: 'EMAIL_BOUNCE', campaign: { id: 7 }, lead: { email: 'x@y.com' }, timestamp: 'not a date' });
  assert.deepEqual([b.type, b.campaign_id, b.email], ['EMAIL_BOUNCE', 7, 'x@y.com']);
  assert.ok(!isNaN(new Date(b.at).getTime()));
  assert.match(activityNote(b), /bounced.*not be emailed again/);
});

test('the webhook key follows LAB_TOKEN and the URL uses the public domain', () => {
  const keep = { t: process.env.LAB_TOKEN, d: process.env.RAILWAY_PUBLIC_DOMAIN };
  process.env.LAB_TOKEN = 'a'.repeat(20); process.env.RAILWAY_PUBLIC_DOMAIN = 'hub.example.com';
  const k1 = webhookKey();
  assert.match(k1, /^[0-9a-f]{32}$/);
  assert.equal(webhookUrl(), 'https://hub.example.com/api/email-marketing/webhook?key=' + k1);
  process.env.LAB_TOKEN = 'b'.repeat(20);
  assert.notEqual(webhookKey(), k1);
  process.env.LAB_TOKEN = keep.t; process.env.RAILWAY_PUBLIC_DOMAIN = keep.d;
  if (keep.t === undefined) delete process.env.LAB_TOKEN;
  if (keep.d === undefined) delete process.env.RAILWAY_PUBLIC_DOMAIN;
});

test('an address that bounced or unsubscribed anywhere is never emailed again', () => {
  const lead = (c: Partial<MarketingLead['campaigns'][number]>) => ({ ...row(), key: 'k', campaigns: [{ id: 1, name: null, pushed_at: '', last_event: null, last_event_at: null, opened_at: null, replied_at: null, bounced_at: null, unsubscribed_at: null, category: null, ...c }] });
  assert.equal(doNotEmail(lead({})), false);
  assert.equal(doNotEmail(lead({ bounced_at: 't' })), true);
  assert.equal(doNotEmail(lead({ unsubscribed_at: 't' })), true);
});

test('a reply drops the email it quotes, in the forms mail apps use', () => {
  // The live test reply of 2026-10-29, as Smartlead returned it.
  const real = htmlToText('<p>my house RM380 average<br/>link terrace. nilai</p><p>On 10/29/2026, 3:31:42 PM, <a href="mailto:eternalgy@atap.solar">eternalgy@atap.solar</a> wrote:<br/>&gt; Hi Eternalgy Sdn Bhd team,<br/>&gt;<br/>&gt; This is a live test</p>');
  assert.equal(stripQuoted(real), 'my house RM380 average\nlink terrace. nilai');
  assert.equal(stripQuoted('Yes please\n\nOn Tue, 4 Nov 2026 at 10:00, Gan Zhi Hong <eternalgy@atap.solar>\nwrote:\n> hi'), 'Yes please');
  assert.equal(stripQuoted('Boleh\n\nPada 4 Nov 2026, Gan menulis:\n> hi'), 'Boleh');
  assert.equal(stripQuoted('可以\n\n在 2026年11月4日 Gan 写道：\n> hi'), '可以');
  assert.equal(stripQuoted('Ok\n\nFrom: Gan Zhi Hong <eternalgy@atap.solar>\nSent: Tuesday'), 'Ok');
  assert.equal(stripQuoted('> only a quote'), '> only a quote');
  assert.equal(threadMessage({ type: 'REPLY', email_body: '<p>Ok</p><p>On Mon, X wrote:<br>&gt; old</p>' }).body, 'Ok');
  assert.match(threadMessage({ type: 'SENT', email_body: '<p>Ok</p><p>On Mon, X wrote:</p>' }).body, /wrote:/);
});
