import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanEmail, contactLinks, decodeCfEmail, extractEmails, ownSiteUrl, scanSite, siteHost } from './site-emails.ts';
import { extractCompanyContacts } from './contacts.ts';

test('ownSiteUrl keeps company domains and drops social pages and marketplaces', () => {
  assert.equal(ownSiteUrl('acmesolar.com.my'), 'https://acmesolar.com.my/');
  assert.equal(ownSiteUrl('http://www.acme.my/home'), 'http://www.acme.my/home');
  assert.equal(ownSiteUrl('https://www.facebook.com/acme'), null);
  assert.equal(ownSiteUrl('https://shopee.com.my/acme'), null);
  assert.equal(ownSiteUrl('wa.me/60123456789'), null);
  assert.equal(ownSiteUrl(''), null);
  assert.equal(ownSiteUrl(null), null);
  assert.equal(siteHost('http://www.myinfo.my/ce/index.php?x=1'), 'myinfo.my');
  assert.equal(siteHost('https://facebook.com/acme'), null);
});

test('extractEmails reads mailto links, visible text, entities, Cloudflare and [at] spellings', () => {
  const cf = '42' + [...'hr@acme.my'].map((c) => (c.charCodeAt(0) ^ 0x42).toString(16).padStart(2, '0')).join('');
  assert.equal(decodeCfEmail(cf), 'hr@acme.my');
  const html = `
    <a href="mailto:Sales@Acme.my?subject=Hi">Email us</a>
    <p>Accounts: accounts&#64;acme.my</p>
    <span class="__cf_email__" data-cfemail="${cf}">[email protected]</span>
    <p>Support: support [at] acme [dot] my</p>
    <img src="logo@2x.png"><script>dsn="https://0123456789abcdef0123456789abcdef@o1.ingest.sentry.io"</script>
    <p>you@example.com</p>`;
  assert.deepEqual(extractEmails(html).sort(), ['accounts@acme.my', 'hr@acme.my', 'sales@acme.my', 'support@acme.my']);
});

test('cleanEmail rejects file names and template placeholders', () => {
  assert.equal(cleanEmail('icon@2x.png'), null);
  assert.equal(cleanEmail('name@domain.com'), null);
  assert.equal(cleanEmail('mailto:info@acme.com.my'), 'info@acme.com.my');
});

test('contactLinks finds same-site contact pages before about pages', () => {
  const html = `<a href="/about-us">About</a><a href="https://other.com/contact">x</a>
    <a href="/hubungi-kami">Hubungi Kami</a><a href="/p?id=3"><span>Contact Us</span></a><a href="tel:123">Call</a>`;
  assert.deepEqual(contactLinks(html, 'https://www.acme.my/'), [
    'https://www.acme.my/hubungi-kami', 'https://www.acme.my/p?id=3',
  ]);
});

test('scanSite reads the homepage and its contact page and records where each email came from', async () => {
  const pages: Record<string, string> = {
    'https://acme.my/': '<a href="/contact">Contact</a><footer>info@acme.my</footer>',
    'https://acme.my/contact': '<a href="mailto:sales@acme.my">sales</a> info@acme.my',
  };
  const asked: string[] = [];
  const result = await scanSite('acme.my', async (url) => { asked.push(url); return pages[url] ? { url, html: pages[url] } : null; });
  assert.equal(result.status, 'found');
  assert.deepEqual(asked, ['https://acme.my/', 'https://acme.my/contact']);
  assert.deepEqual(result.emails, [
    { email: 'info@acme.my', source_url: 'https://acme.my/' },
    { email: 'sales@acme.my', source_url: 'https://acme.my/contact' },
  ]);
});

test('scanSite falls back to http, guesses /contact-us when nothing is linked, and reports dead sites', async () => {
  const asked: string[] = [];
  const result = await scanSite('acme.my', async (url) => {
    asked.push(url);
    if (url === 'http://acme.my/') return { url, html: '<p>No email here</p>' };
    if (url === 'http://acme.my/contact-us') return { url, html: 'hello@acme.my' };
    return null;
  });
  assert.deepEqual(asked, ['https://acme.my/', 'http://acme.my/', 'http://acme.my/contact-us', 'http://acme.my/contact']);
  assert.deepEqual(result.emails, [{ email: 'hello@acme.my', source_url: 'http://acme.my/contact-us' }]);
  assert.equal((await scanSite('dead.my', async () => null)).status, 'unreachable');
  assert.equal((await scanSite('https://facebook.com/acme', async () => null)).status, 'no_site');
});

test('website emails join the Contacts Master list once, labelled Website', () => {
  const group = extractCompanyContacts({
    id: '7', name: 'Acme', category: null, address: null, phone: null, website: 'acme.my', maps_url: null,
    rating: null, reviews: null, lead_status: 'unassigned', assigned_to: null,
    contact_public_id: null, contact_status: null, contact_result: null,
    research_public_id: null, research_status: null, research_result: null,
    site_emails: [{ email: 'info@acme.my', source_url: 'https://acme.my/' }, { email: 'INFO@acme.my', source_url: null }],
  });
  assert.deepEqual(group.emails, [{ email: 'info@acme.my', label: 'Website', evidence_url: 'https://acme.my/' }]);
  assert.equal(group.total_emails, 1);
});
