import test from 'node:test';
import assert from 'node:assert/strict';
import { CLIENT_NAV, OPERATOR_NAV, missingPage, navHtml } from './nav.ts';
import { page as consolePage } from './ui.ts';
import { page as docsPage } from './docs.ts';
import { page as guidePage } from './guide.ts';
import { page as portalPage } from './portal.ts';
import { notFoundPage, searchPage } from './reportui.ts';
import type { PublishedReport } from './reportdb.ts';

function report(): PublishedReport {
  return {
    id: '1', public_id: 'abcdefghijklmnopqrst', report_type: 'business_search', status: 'completed',
    title: 'Mobile report', user_id: null, request: {}, source_search_report_id: null,
    company_id: null, job_id: null, result: {}, error: null,
    created_at: new Date().toISOString(), updated_at: new Date().toISOString(), completed_at: new Date().toISOString(),
  } as PublishedReport;
}

test('navHtml marks the page you are on and still lets you click it', () => {
  const html = navHtml(OPERATOR_NAV, '/docs');
  assert.match(html, /<a href="\/docs" aria-current="page">API docs<\/a>/);
  assert.match(html, /<a href="\/">Console<\/a>/);
  assert.equal((html.match(/aria-current/g) ?? []).length, 1);
});

test('the bilingual form carries both labels, switched by the page it sits in', () => {
  const html = navHtml(CLIENT_NAV, '/guide', { bilingual: true });
  assert.match(html, /<span class="lang-en">Workspace<\/span><span class="lang-zh">工作台<\/span>/);
});

// The bug this file exists for: four surfaces, four mastheads, and no links
// between them. A report opens with target="_blank", so that tab has no Back
// button either -- nothing on the page pointed anywhere at all.
test('every page carries a link out of itself', () => {
  const pages: [string, string][] = [
    ['console', consolePage()],
    ['docs', docsPage()],
    ['guide', guidePage()],
    ['report', searchPage(report(), { report: {}, companies: [] })],
    // The dead link is the case that matters most: whoever followed it is
    // looking at a page that says no, and needs somewhere to go from there.
    ['report 404', notFoundPage()],
  ];
  for (const [name, html] of pages) {
    assert.match(html, /href="\/research"|href="\/portal"/, name + ' has no route to the workspace');
    assert.match(html, /href="\/guide"/, name + ' has no route to the guide');
  }
});

// The portal is the workspace, so its way out is inward: the wordmark returns to
// the search view without reloading and losing the jobs it is polling in memory.
test('the workspace returns home from its own wordmark', () => {
  const html = portalPage();
  assert.match(html, /class="brand" aria-label="Home" onclick="switchView\('discover'\)"/);
  assert.match(html, /href="\/guide"/);
});

test('operator pages reach every surface; a shared report link does not', () => {
  for (const html of [consolePage(), docsPage()]) {
    for (const link of OPERATOR_NAV) assert.match(html, new RegExp('href="' + link.href + '"'));
  }
  // /r/:id is sent to people outside the workspace. The console and the API
  // reference are not theirs, and advertising them there is noise.
  assert.doesNotMatch(searchPage(report(), { report: {}, companies: [] }), /href="\/docs"/);
});

test('a mistyped URL lists the pages that do exist', () => {
  const html = missingPage('/reprots');
  assert.match(html, /There is nothing at <code>\/reprots<\/code>/);
  for (const link of OPERATOR_NAV) assert.match(html, new RegExp('href="' + link.href + '"'));
});

test('the 404 does not hand a crafted path back as markup', () => {
  assert.doesNotMatch(missingPage('/<script>alert(1)</script>'), /<script>/);
});
