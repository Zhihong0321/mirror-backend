import test from 'node:test';
import assert from 'node:assert/strict';
import { companyDomain, newUid } from './company-uid.ts';

test('listings are grouped by their own website host', () => {
  assert.equal(companyDomain('https://www.abc-plumbing.com.my/contact'), 'abc-plumbing.com.my');
  assert.equal(companyDomain('abc-plumbing.com.my'), 'abc-plumbing.com.my');
  assert.equal(companyDomain('HTTP://WWW.ABC-Plumbing.com.my.'), 'abc-plumbing.com.my');
  assert.equal(companyDomain('https://shop.abc.sg/'), 'shop.abc.sg');
  assert.equal(companyDomain('https://abc.wixsite.com/home'), 'abc.wixsite.com');
});

test('no website, or one many businesses share, is a company of its own', () => {
  for (const site of [undefined, null, '', '   ', 'not a url at all', 'http://192.168.1.10/', 'localhost',
    'https://www.facebook.com/abcplumbing', 'https://m.facebook.com/abc', 'https://business.facebook.com/x',
    'https://instagram.com/abc', 'https://wa.me/60123456789', 'https://api.whatsapp.com/send?phone=6012',
    'https://linktr.ee/abc', 'https://sites.google.com/view/abc', 'https://shopee.com.my/abc', 'https://g.page/abc', 'https://yellow.local.ch/de/abc', 'https://blog.naver.com/abc']) {
    assert.equal(companyDomain(site), null, String(site));
  }
});

test('a UID is co_ and 12 hex characters', () => {
  assert.match(newUid(), /^co_[a-f0-9]{12}$/);
  assert.notEqual(newUid(), newUid());
});
