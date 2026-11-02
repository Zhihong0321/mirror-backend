import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { classify, deliver, fillTemplate, invalid, pickForm, planFill, readOutcome, type DeliverInput, type Field, type FormInfo } from './contact-form-delivery.ts';
import { browserPath } from './divedeeper/shots.ts';

const f = (id: string, over: Partial<Field>): Field => ({ id, tag: 'input', type: 'text', name: '', label: '', required: false, ...over });
const input: DeliverInput = {
  lead: { company_name: 'Acme Ads', website: 'https://acme.my' },
  sender: { name: 'Nurul Huda', email: 'nurul@example.org', phone: '0123456789', company: 'Eternalgy' },
  subject: 'A report on {{company_name}}',
  message: 'Hi {{contact_name}}, we wrote a short profile of {{company_name}}.',
};

test('classify reads English and Malay labels', () => {
  assert.equal(classify(f('a', { type: 'email' })), 'email');
  assert.equal(classify(f('a', { label: 'Nama Penuh *' })), 'name');
  assert.equal(classify(f('a', { name: 'your-phone' })), 'phone');
  assert.equal(classify(f('a', { label: 'No. Telefon' })), 'phone');
  assert.equal(classify(f('a', { label: 'Company name' })), 'company');
  assert.equal(classify(f('a', { name: 'fname' })), 'first_name');
  assert.equal(classify(f('a', { label: 'Subject' })), 'subject');
  assert.equal(classify(f('a', { tag: 'textarea' })), 'message');
  assert.equal(classify(f('a', { type: 'checkbox', label: 'I agree to the privacy policy' })), 'consent');
  assert.equal(classify(f('a', { label: 'Favourite colour' })), null);
});

test('pickForm takes the contact form, never a newsletter, search or login form', () => {
  const newsletter: FormInfo = { id: 'n', fields: [f('n1', { type: 'email' })], submitText: 'Subscribe', captcha: null };
  const login: FormInfo = { id: 'l', fields: [f('l1', { type: 'email' }), f('l2', { type: 'password' }), f('l3', { tag: 'textarea' })], submitText: 'Log in', captcha: null };
  const contact: FormInfo = { id: 'c', fields: [f('c1', { label: 'Name' }), f('c2', { type: 'email' }), f('c3', { tag: 'textarea' })], submitText: 'Send', captcha: null };
  assert.equal(pickForm([newsletter, login, contact])?.id, 'c');
  assert.equal(pickForm([newsletter, login]), null);
});

test('planFill splits the name, fills the template, ticks consent and answers required unknowns', () => {
  const form: FormInfo = { id: 'c', submitText: 'Send', captcha: null, fields: [
    f('1', { name: 'first_name' }), f('2', { name: 'last_name' }), f('3', { type: 'email' }),
    f('4', { label: 'Subject' }), f('5', { tag: 'textarea' }), f('6', { label: 'How did you hear of us', required: true }),
    f('7', { type: 'checkbox', label: 'I agree to the terms' }), f('8', { label: 'Optional extra' }),
  ] };
  const steps = planFill(form, input);
  const by = Object.fromEntries(steps.map((s) => [s.id, s.value]));
  assert.equal(by['1'], 'Nurul');
  assert.equal(by['2'], 'Huda');
  assert.equal(by['3'], 'nurul@example.org');
  assert.equal(by['4'], 'A report on Acme Ads');
  assert.equal(by['5'], 'Hi there, we wrote a short profile of Acme Ads.');
  assert.equal(by['6'], 'Eternalgy');
  assert.equal(by['7'], 'on');
  assert.ok(!('8' in by), 'an optional box we cannot place stays empty');
});

test('readOutcome only trusts text the send added', () => {
  assert.equal(readOutcome('Home\nThank you, we will get back to you', 'Home', false, false).status, 'sent');
  assert.equal(readOutcome('Thank you for visiting\nContact', 'Thank you for visiting\nContact', false, false).status, 'submitted_unconfirmed');
  assert.equal(readOutcome('Please fill in all required fields', '', false, false).status, 'failed');
  assert.equal(readOutcome('same', 'same', true, false).status, 'sent');
});

test('fillTemplate and invalid', () => {
  assert.equal(fillTemplate('{{ company_name }} at {{website}}', input.lead), 'Acme Ads at https://acme.my');
  assert.equal(invalid(input), null);
  assert.match(invalid({ ...input, lead: { company_name: 'x' } })!, /website/);
  assert.match(invalid({ ...input, sender: { name: 'x', email: 'nope' } })!, /sender/);
});

const PAGES: Record<string, string> = {
  '/': '<html><body><h1>Acme</h1><a href="/contact-us">Contact Us</a></body></html>',
  '/contact-us': `<html><body><form method="post" action="/thanks">
    <label for="n">Your Name *</label><input id="n" name="your-name" required>
    <label for="e">Email *</label><input id="e" name="your-email" type="email" required>
    <label for="p">Phone</label><input id="p" name="phone" type="tel">
    <input name="website_hp" style="position:absolute;left:-9999px" tabindex="-1">
    <input type="hidden" name="token" value="abc">
    <label for="m">Message</label><textarea id="m" name="your-message"></textarea>
    <button type="submit">Send</button></form></body></html>`,
  '/guarded': `<html><head><script src="https://www.google.com/recaptcha/api.js"></script></head><body><form method="post" action="/thanks">
    <input name="name" placeholder="Name"><input name="email" type="email"><textarea name="msg"></textarea>
    <div class="g-recaptcha" data-sitekey="x"></div><button type="submit">Send</button></form></body></html>`,
};

test('deliver fills and sends a real form, skips the off-screen trap, and leaves captcha forms alone', { skip: !browserPath() && 'no browser here' }, async () => {
  const posts: string[] = [];
  const server = http.createServer((req, res) => {
    if (req.method === 'POST') {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => { posts.push(body); res.end('<html><body><h2>Thank you! We have received your message.</h2></body></html>'); });
      return;
    }
    const page = PAGES[(req.url ?? '/').split('?')[0]!];
    res.writeHead(page ? 200 : 404, { 'content-type': 'text/html' });
    res.end(page ?? 'not found');
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  try {
    const dry = await deliver({ ...input, lead: { ...input.lead, website: base + '/' }, dry_run: true });
    assert.equal(dry.status, 'dry_run', dry.detail);
    assert.equal(posts.length, 0, 'a dry run sends nothing');
    assert.ok(dry.screenshot?.startsWith('data:image/jpeg;base64,'));

    const sent = await deliver({ ...input, lead: { ...input.lead, website: base + '/' } });
    assert.equal(sent.status, 'sent', sent.detail);
    assert.equal(sent.form_url, base + '/contact-us');
    const form = new URLSearchParams(posts[0]);
    assert.equal(form.get('your-name'), 'Nurul Huda');
    assert.equal(form.get('your-email'), 'nurul@example.org');
    assert.equal(form.get('phone'), '0123456789');
    assert.equal(form.get('your-message'), 'Hi there, we wrote a short profile of Acme Ads.');
    assert.equal(form.get('website_hp'), '', 'the off-screen trap stays empty');

    const guarded = await deliver({ ...input, lead: { ...input.lead, website: base + '/guarded' } });
    assert.equal(guarded.status, 'captcha', guarded.detail);
    assert.equal(posts.length, 1, 'nothing was sent to the captcha form');
  } finally {
    server.close();
  }
});
