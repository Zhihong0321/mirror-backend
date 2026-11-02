import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formsInHtml, formVerdict, pageCaptcha, mxProvider, countryCode, typePhone, whatsappNumber, socialUrl,
  bestContactMethod, processLead, type Deps,
} from './list-step2.ts';

const CF7 = `<html><head><title>Contact</title></head><body>
  <form action="/contact/#wpcf7-f1" method="post" class="wpcf7-form">
    <input type="hidden" name="_wpcf7" value="1">
    <label for="n">Your name *</label><input id="n" name="your-name" required>
    <label>Your email <input type="email" name="your-email" required></label>
    <textarea name="your-message" placeholder="Message"></textarea>
    <input type="submit" value="Send">
  </form></body></html>`;
const NEWSLETTER = `<form><input type="email" name="EMAIL" placeholder="Email"><button>Subscribe</button></form>`;

test('a plain contact form in the HTML is one a bot can submit', () => {
  const [form] = formsInHtml(CF7);
  assert.deepEqual(form!.fields.map((f) => f.type), ['text', 'email', '']);
  assert.equal(form!.fields[0]!.label, 'Your name *');
  assert.equal(form!.submitText, 'Send');
  const v = formVerdict([{ url: 'https://a.example/contact', html: CF7 }]);
  assert.equal(v.status, 'bot_can_submit');
  assert.equal(v.url, 'https://a.example/contact');
});

test('a captcha on the form or the page means the bot leaves it', () => {
  const onForm = CF7.replace('<textarea', '<div class="g-recaptcha" data-sitekey="x"></div><textarea');
  assert.equal(formVerdict([{ url: 'u', html: onForm }]).status, 'captcha');
  const onPage = CF7.replace('</head>', '<script src="https://www.google.com/recaptcha/api.js"></script></head>');
  assert.equal(formVerdict([{ url: 'u', html: onPage }]).detail, 'reCAPTCHA');
  const quiz = CF7.replace('<textarea', '<label>What is 3 + 4 = ?</label><input name="q"><textarea');
  assert.equal(formVerdict([{ url: 'u', html: quiz }]).status, 'captcha');
  assert.equal(pageCaptcha('<title>Just a moment...</title>'), 'a Cloudflare check guards the page');
});

test('a newsletter box is no contact form; a script-drawn form is reported as such', () => {
  assert.equal(formVerdict([{ url: 'u', html: NEWSLETTER }]).status, 'no_form');
  const wix = '<html><script src="https://static.parastorage.com/x.js"></script><body>Contact us</body></html>';
  assert.equal(formVerdict([{ url: 'u', html: wix }]).status, 'script_form');
});

test('the first page with a contact form decides, as delivery reads them', () => {
  const v = formVerdict([{ url: 'home', html: NEWSLETTER }, { url: 'contact', html: CF7 }]);
  assert.equal(v.url, 'contact');
});

test('MX hosting: the most preferred host names the provider; others are unknown; none is none', () => {
  assert.deepEqual(mxProvider([{ exchange: 'alt1.aspmx.l.google.com', priority: 5 }, { exchange: 'aspmx.l.google.com', priority: 1 }]).mx_provider, 'Google');
  assert.equal(mxProvider([{ exchange: 'acme-com.mail.protection.outlook.com', priority: 0 }]).mx_provider, 'Microsoft');
  assert.equal(mxProvider([{ exchange: 'mx.zoho.com', priority: 10 }]).mx_provider, 'Zoho');
  assert.equal(mxProvider([{ exchange: 'mxbiz1.qq.com', priority: 5 }]).mx_provider, 'Tencent');
  assert.equal(mxProvider([{ exchange: 'mail.acme.com.my', priority: 10 }]).mx_class, 'unknown');
  assert.equal(mxProvider([{ exchange: 'us-smtp-inbound-1.mimecast.com', priority: 10 }]).mx_class, 'unknown');
  assert.equal(mxProvider([{ exchange: '', priority: 0 }]).mx_class, 'none');
  assert.equal(mxProvider([]).mx_class, 'none');
  // A look-alike host is not Google.
  assert.equal(mxProvider([{ exchange: 'mx.notgoogle.com', priority: 1 }]).mx_class, 'unknown');
});

test('phones: country names to regions, mobile told from landline, WhatsApp numbers', () => {
  assert.equal(countryCode('Malaysia'), 'MY');
  assert.equal(countryCode('South Korea'), 'KR');
  assert.equal(countryCode('United Kingdom'), 'GB');
  assert.equal(typePhone('012-345 6789', 'MY', 'maps').type, 'MOBILE');
  assert.equal(typePhone('012-345 6789', 'MY', 'maps').e164, '+60123456789');
  assert.equal(typePhone('03-2161 1234', 'MY', 'maps').type, 'FIXED_LINE');
  assert.equal(typePhone('+14167388065', undefined, 'maps').type, 'FIXED_LINE_OR_MOBILE');
  assert.equal(typePhone('12', 'MY', 'x').type, 'unparsed');
  assert.equal(whatsappNumber('https://wa.me/60123456789?text=hi'), '+60123456789');
  assert.equal(whatsappNumber('https://api.whatsapp.com/send?phone=6591234567'), '+6591234567');
  assert.equal(whatsappNumber('https://wa.me/'), null);
});

test('social links: company pages kept, share buttons dropped', () => {
  assert.equal(socialUrl('https://www.facebook.com/acme'), 'https://www.facebook.com/acme');
  assert.equal(socialUrl('https://www.facebook.com/sharer/sharer.php?u=x'), null);
  assert.equal(socialUrl('https://twitter.com/intent/tweet?url=x'), null);
  assert.equal(socialUrl('https://discord.gg/abc'), 'https://discord.gg/abc');
  assert.equal(socialUrl('https://discord.com/channels/1'), null);
  assert.equal(socialUrl('https://instagram.com/'), null);
  assert.equal(socialUrl('https://acme.com/facebook'), null);
});

test('best_contact_method follows the priority order', () => {
  const base = { form: { status: 'no_form' as const, url: null, detail: '' }, emails: [], phones: [], social: [] };
  const email = (mx_class: 'major' | 'unknown' | 'none') => ({ email: 'a@b.c', domain: 'b.c', source: '', mx_class, mx_provider: null, mx: [] });
  assert.equal(bestContactMethod(base), 'no-viable-contact-method');
  assert.equal(bestContactMethod({ ...base, social: ['https://facebook.com/a'] }), 'social-media');
  assert.equal(bestContactMethod({ ...base, social: ['x'], phones: [{ phone: '1', e164: '+1', type: 'MOBILE', source: '' }] }), 'mobile-phone');
  assert.equal(bestContactMethod({ ...base, phones: [{ phone: '1', e164: '+1', type: 'FIXED_LINE', source: '' }] }), 'no-viable-contact-method');
  assert.equal(bestContactMethod({ ...base, emails: [email('none')] }), 'no-viable-contact-method');
  assert.equal(bestContactMethod({ ...base, emails: [email('major')] }), 'major-brand-email-hosting');
  assert.equal(bestContactMethod({ ...base, emails: [email('major'), email('unknown')] }), 'unknown-hosting-email');
  assert.equal(bestContactMethod({ ...base, emails: [email('unknown')], form: { status: 'bot_can_submit', url: 'u', detail: '' } }), 'contact-via-website');
});

const fakeDeps = (pages: Record<string, string>, mx: Record<string, string>): Deps => ({
  fetchPage: async (url) => {
    if (!(url in pages)) throw new Error('HTTP 404');
    return { url, html: pages[url]! };
  },
  resolveMx: async (domain) => {
    if (!(domain in mx)) throw Object.assign(new Error('no'), { code: 'ENOTFOUND' });
    return [{ exchange: mx[domain]!, priority: 10 }];
  },
});

test('one lead: the site read again, stored and new emails kept, each typed by its MX', async () => {
  const home = `<html><body><a href="/contact-us">Contact</a> sales@acme.my
    <a href="https://www.facebook.com/acmemy">fb</a><a href="https://wa.me/60123456789">WhatsApp</a></body></html>`;
  const deps = fakeDeps({ 'https://acme.my/': home, 'https://acme.my/contact-us': CF7 + ' boss@gmail.com' },
    { 'acme.my': 'mail.acme.my', 'gmail.com': 'gmail-smtp-in.l.google.com', 'old.acme.my': 'x.y' });
  const r = await processLead({
    business: { name: 'Acme', website: 'https://acme.my/', phone: '03-2161 1234' },
    contact: { emails: [{ email: 'info@old.acme.my', source: 'https://acme.my/' }], phones: [], links: [] },
    country: 'Malaysia',
  }, deps);
  assert.equal(r.best_contact_method, 'contact-via-website');
  assert.equal(r.form.url, 'https://acme.my/contact-us');
  assert.deepEqual(r.emails.map((e) => [e.email, e.mx_class, e.mx_provider]).sort(), [
    ['boss@gmail.com', 'major', 'Google'], ['info@old.acme.my', 'unknown', null], ['sales@acme.my', 'unknown', null]]);
  assert.deepEqual(r.phones.map((p) => p.type).sort(), ['FIXED_LINE', 'whatsapp']);
  assert.deepEqual(r.social, ['https://www.facebook.com/acmemy']);
});

test('one lead: no website, a Maps mobile phone', async () => {
  const r = await processLead({ business: { name: 'B', phone: '+60 12-345 6789' }, contact: null, country: 'Malaysia' }, fakeDeps({}, {}));
  assert.equal(r.form.status, 'no_website');
  assert.equal(r.best_contact_method, 'mobile-phone');
});

test('one lead: an unreachable site keeps what step 1 stored', async () => {
  const r = await processLead({
    business: { name: 'C', website: 'https://gone.example.org/' },
    contact: { emails: [{ email: 'hi@gone-co.com', source: 'x' }] }, country: null,
  }, fakeDeps({}, { 'gone-co.com': 'aspmx.l.google.com' }));
  assert.equal(r.form.status, 'unreachable');
  assert.equal(r.best_contact_method, 'major-brand-email-hosting');
});

test('one lead: a Facebook page as the website is social media', async () => {
  const r = await processLead({ business: { name: 'D', website: 'https://www.facebook.com/dshop' }, contact: null, country: 'Malaysia' }, fakeDeps({}, {}));
  assert.equal(r.form.status, 'not_own_site');
  assert.equal(r.best_contact_method, 'social-media');
});

test('a PC worker result that is not a step-2 result is refused before it reaches the database', async () => {
  const { saveFromWorker } = await import('./list-step2.ts');
  await assert.rejects(saveFromWorker('pc-test', 'a1e8dab86a1f', 'place:x', { best_contact_method: 'carrier-pigeon' }), /not a step-2 lead result/);
  await assert.rejects(saveFromWorker('pc-test', 'a1e8dab86a1f', 'place:x', null), /not a step-2 lead result/);
});

test('freak pages are read in linear time: a 300,000-digit run, 30,000 unclosed labels, an unclosed form', () => {
  const started = Date.now();
  formVerdict([
    { url: 'a', html: '<form><textarea></textarea><input type="email">' + '7'.repeat(300_000) + '</form>' },
    { url: 'b', html: '<form>' + '<label>x '.repeat(30_000) + '</form>' },
    { url: 'c', html: '<form><input type="email">' + 'y'.repeat(1_000_000) },
    { url: 'd', html: '<!--' + '<script>'.repeat(50_000) },
  ]);
  assert.ok(Date.now() - started < 3_000, `took ${Date.now() - started} ms`);
});
