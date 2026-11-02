import test from 'node:test';
import assert from 'node:assert/strict';
import { page as guidePage } from './guide.ts';
import { page as portalPage } from './portal.ts';

test('the guide teaches all four tools in both languages', () => {
  const html = guidePage();
  for (const name of ['Business list', 'Company research', 'VIP brief', 'Ads research']) {
    assert.match(html, new RegExp(name));
  }
  for (const name of ['商家名单', '公司深度研究', 'VIP 人物简报', '广告研究']) {
    assert.match(html, new RegExp(name));
  }
  // Both languages ship in the markup and are toggled with a class, so the page is
  // complete before any script runs.
  assert.match(html, /class="lang lang-en"/);
  assert.match(html, /class="lang lang-zh"/);
  assert.match(html, /data-set-lang="zh"/);
  assert.match(html, /html\[data-lang="en"\] \.lang-zh/);
});

test('the guide states the prerequisite chain that the home screen hides', () => {
  const html = guidePage();
  // reportRow() only draws People + and Ads research on a finished company dossier.
  // A reader who misses that never finds two of the four tools at all.
  assert.match(html, /Needs 02 finished/);
  assert.match(html, /需要 02 先跑完/);
  assert.match(html, /People \+/);
  assert.match(html, /VIP brief →/);
  assert.match(html, /Ads research →/);
  assert.match(html, /Deep research →/);
  // Both doors into company research, or half the users go looking for a search box.
  assert.match(html, /Find company/);
  assert.match(html, /Search market/);
});

test('the guide keeps the honesty contract the reports depend on', () => {
  const html = guidePage();
  // Two lists in the People panel. Only one has a button; collapsing them turns an
  // unevidenced lead into a researched fact.
  assert.match(html, /Validated people/);
  assert.match(html, /Leads to verify/);
  // X is reached through Grok. A reader who thinks this crawls x.com reasons wrongly
  // about what the brief proves.
  assert.match(html, /Grok/);
  assert.match(html, /never opens x\.com/);
  assert.match(html, /从不直接访问 x\.com/);
  assert.match(html, /<b>cited<\/b>/);
  // failed ads capture means the mini was offline, NOT that the company runs no ads.
  assert.match(html, /does <b>not<\/b> mean the company runs no ads/);
  assert.match(html, /不是<\/b>「这家公司没投广告」/);
  // partial is a usable report, in both languages.
  assert.match(html, /<b>partial<\/b> is not a failure/);
  assert.match(html, /<b>partial<\/b> 不代表失败/);
});

test('the guide carries no credential and never asks for one', () => {
  const html = guidePage();
  assert.ok(!process.env.LAB_TOKEN || !html.includes(process.env.LAB_TOKEN), 'the operator token never reaches a served page');
  assert.doesNotMatch(html, /LAB_TOKEN|PORTAL_TOKEN/);
  assert.doesNotMatch(html, /type="password"/);
  // It is a static page: no bearer header, no fetch, nothing to authorize.
  assert.doesNotMatch(html, /Authorization/i);
  assert.doesNotMatch(html, /fetch\(/);
});

test('the portal points at the guide on every surface a newcomer lands on', () => {
  const html = portalPage();
  // The gate is the only screen a first-time user is guaranteed to see.
  assert.match(html, /class="gate-help"><a href="\/guide"/);
  // Desktop nav and mobile nav, for the user who already has a key.
  assert.match(html, /<a class="nav-button" href="\/guide"/);
  assert.match(html, /<a class="mobile-tab" href="\/guide"/);
  // The mobile bar grew a third cell to hold it.
  assert.match(html, /\.mobile-nav\{[^}]*grid-template-columns:repeat\(3,1fr\)/);
});
