import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPrompt, cleanDraft, latestInbound, messageKey, type Message } from './email-replies.ts';

const msg = (inbound: boolean, body: string, over: Partial<Message> = {}): Message =>
  ({ inbound, stats_id: 's1', message_id: null, time: '2026-11-04T09:00:00Z', subject: null, body, body_html: '<p>' + body + '</p>', ...over });

test('the draft answers the lead\'s latest message, not ours', () => {
  const thread = [msg(false, 'intro'), msg(true, 'how much?', { message_id: '<a@x>' }), msg(false, 'we replied'), msg(true, 'and installment?', { message_id: '<b@x>' })];
  assert.equal(latestInbound(thread)?.body, 'and installment?');
  assert.equal(latestInbound([msg(false, 'only us')]), null);
  assert.equal(messageKey(latestInbound(thread)!), '<b@x>');
  assert.equal(messageKey(msg(true, 'x', { message_id: null, stats_id: null })), '2026-11-04T09:00:00Z');
});

test('the prompt carries the thread, the company and the rules that keep it honest', () => {
  const p = buildPrompt({ company: 'Lim Hardware', category: 'Hardware store', campaign: 'Johor SME', messages: [msg(false, 'intro'), msg(true, 'how much for 50kW?')], instruction: 'in Malay' });
  assert.match(p, /Lim Hardware \(Hardware store\)/);
  assert.match(p, /THEM \(the lead\)[^\n]*\nhow much for 50kW\?/);
  assert.match(p, /Never invent prices/);
  assert.match(p, /language they wrote in/);
  assert.match(p, /Extra instruction from the sender: in Malay/);
  assert.doesNotMatch(buildPrompt({ company: null, category: null, campaign: null, messages: [msg(true, 'hi')] }), /Extra instruction/);
});

test('a draft loses fences, a subject line and a signature the model added', () => {
  assert.equal(cleanDraft('```\nSubject: Re: solar\n\nHi there,\n\nYes we can.\n```'), 'Hi there,\n\nYes we can.');
  assert.equal(cleanDraft('Yes we can.\n\nBest regards,\nGan Zhi Hong\nEternalgy Sdn Bhd'), 'Yes we can.');
  assert.equal(cleanDraft('Thanks, we will call.\n\nRegards,\nthe team at your bank'), 'Thanks, we will call.\n\nRegards,\nthe team at your bank');
});
