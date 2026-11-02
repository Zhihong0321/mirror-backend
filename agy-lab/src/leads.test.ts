import test from 'node:test';
import assert from 'node:assert/strict';
import { page } from './portal.ts';
import * as db from './reportdb.ts';

test('leads master UI is integrated in portal navigation and views', () => {
  const html = page();
  // Navigation
  assert.match(html, />Leads Master<\/button>/);
  assert.match(html, /data-view="leads"/);
  assert.match(html, /switchView\('leads'\)/);

  // View container & hero
  assert.match(html, /id="leadsView"/);
  assert.match(html, /Leads master list/);
  assert.match(html, /Deduplicated master list of all discovered companies/);

  // Metrics summary
  assert.match(html, /id="statTotal"/);
  assert.match(html, /id="statUnassigned"/);
  assert.match(html, /id="statAssigned"/);
  assert.match(html, /id="statContacted"/);
  assert.match(html, /id="statHidden"/);

  // Filtering & controls
  assert.match(html, /id="leadSearch"/);
  assert.match(html, /id="leadTeleFilter"/);
  assert.match(html, /id="leadResearchFilter"/);
  assert.match(html, /data-lead-status="all"/);
  assert.match(html, /data-lead-status="unassigned"/);
  assert.match(html, /data-lead-status="assigned"/);
  assert.match(html, /data-lead-status="contacted"/);
  assert.match(html, /data-lead-status="hidden"/);

  // Bulk assignment & hide bar
  assert.match(html, /id="bulkBar"/);
  assert.match(html, /id="bulkAssignSelect"/);
  assert.match(html, /bulkAssignSelected\(\)/);
  assert.match(html, /bulkUnassignSelected\(\)/);
  assert.match(html, /bulkHideSelected\(true\)/);
  assert.match(html, /bulkHideSelected\(false\)/);

  // Table wrapper & pagination
  assert.match(html, /id="leadTableWrapper"/);
  assert.match(html, /id="leadPagination"/);
  assert.match(html, /btnPrevLeads/);
  assert.match(html, /btnNextLeads/);

  // Client-side script validates with no syntax errors
  const script = /<script>([\s\S]*)<\/script>/.exec(html)?.[1];
  assert.ok(script);
  assert.doesNotThrow(() => new Function(script));
});

test('reportdb exports lead distribution, hide and dedup interfaces', () => {
  assert.equal(typeof db.listLeads, 'function');
  assert.equal(typeof db.assignLeads, 'function');
  assert.equal(typeof db.unassignLeads, 'function');
  assert.equal(typeof db.hideLeads, 'function');
  assert.equal(typeof db.updateLead, 'function');
  assert.equal(typeof db.listTelemarketers, 'function');
  assert.equal(typeof db.addTelemarketer, 'function');
  assert.equal(typeof db.dedupCompanies, 'function');
});

test('leads with contact research are highlighted with contact numbers found', () => {
  const html = page();

  // Metrics summary includes statContacts
  assert.match(html, /id="statContacts"/);
  assert.match(html, /Contacts Found/);

  // Filter option includes contacts_found
  assert.match(html, /value="contacts_found"/);
  assert.match(html, /Contacts Found \(Maps or research\)/);
  // Deep research has its own tile and filter, so it is never passed off as contacts found
  assert.match(html, /id="statDeepResearched"/);
  assert.match(html, /value="deep_researched"/);

  // CSS classes for highlight and badge
  assert.match(html, /\.lead-row\.has-contact-research/);
  assert.match(html, /\.contact-pill/);
  assert.match(html, /\.vip\.contact-vip/);

  // Verify renderLeads formats contact research info correctly
  const script = /<script>([\s\S]*)<\/script>/.exec(html)?.[1];
  assert.ok(script);

  const leadResearched = {
    id: '101',
    name: 'E Cube Trading',
    category: 'Commercial Trading',
    address: 'Johor Bahru',
    phone: '012-3456789',
    website: 'https://ecube.example.com',
    maps_url: 'https://maps.google.com/?q=ecube',
    rating: 4.8,
    reviews: 24,
    lead_status: 'unassigned',
    assigned_to: null,
    lead_notes: null,
    branch_count: 0,
    research_public_id: null,
    contact_public_id: 'ct_report_99999',
    contact_status: 'completed',
    contact_phones_count: 5,
    contact_decision_makers_count: 3,
  };

  const leadUnresearched = {
    id: '102',
    name: 'Normal Business',
    category: 'Retail',
    address: 'Skudai',
    phone: '07-5551234',
    website: null,
    maps_url: null,
    rating: null,
    reviews: null,
    lead_status: 'unassigned',
    assigned_to: null,
    lead_notes: null,
    branch_count: 0,
    research_public_id: null,
    contact_public_id: null,
    contact_status: null,
    contact_phones_count: 0,
    contact_decision_makers_count: 0,
  };

  let capturedHtml = '';
  const leadState = { selected: {}, telemarketers: [] };
  const el = (id: string) => ({
    set innerHTML(val: string) { capturedHtml = val; },
    get innerHTML() { return capturedHtml; },
  });
  const esc = (s: any) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const attr = (s: any) => String(s == null ? '' : s).replace(/"/g, '&quot;');
  const safeUrl = (s: any) => s;

  const renderLeadsMatch = /function renderLeads\(leads\)\{([\s\S]*?)\}\nvar teleState/.exec(script);
  assert.ok(renderLeadsMatch, 'found renderLeads in script');

  const runner = new Function('leads', 'leadState', 'el', 'esc', 'attr', 'safeUrl', `
    ${renderLeadsMatch[0]}
    return renderLeads(leads);
  `);

  runner([leadResearched, leadUnresearched], leadState, el, esc, attr, safeUrl);

  // Researched lead row is highlighted
  assert.match(capturedHtml, /class="lead-row has-contact-research"/);
  assert.match(capturedHtml, /5 Contact Numbers Found/);
  assert.match(capturedHtml, /3 Leaders/);
  assert.match(capturedHtml, /href="\/r\/ct_report_99999"/);
  assert.match(capturedHtml, /class="vip contact-vip"/);

  // Unresearched lead row is not highlighted with has-contact-research
  assert.match(capturedHtml, /class="lead-row"/);
  assert.match(capturedHtml, /onclick="startContact\(this\)">Contacts ⚡<\/button>/);
});

test('leads master UI supports hide/unhide and separate hidden list', () => {
  const html = page();

  // Metric card for Hidden Leads
  assert.match(html, /id="statHidden"/);
  assert.match(html, /Hidden Leads/);

  // Status filter tab for Hidden Leads
  assert.match(html, /data-lead-status="hidden"/);
  assert.match(html, /id="countHidden"/);

  // Bulk action buttons for hide & unhide
  assert.match(html, /id="btnBulkHide"/);
  assert.match(html, /bulkHideSelected\(true\)/);
  assert.match(html, /id="btnBulkUnhide"/);
  assert.match(html, /bulkHideSelected\(false\)/);

  // Script functions exist
  const script = /<script>([\s\S]*)<\/script>/.exec(html)?.[1];
  assert.ok(script);
  assert.match(script, /function toggleHideLead\(/);
  assert.match(script, /function bulkHideSelected\(/);

  // Verify renderLeads formats Hide and Unhide buttons properly
  const leadNormal = {
    id: '201',
    name: 'Active Normal Shop',
    category: 'Cafe',
    address: 'Johor Bahru',
    phone: '012-1111111',
    website: null,
    maps_url: null,
    rating: null,
    reviews: null,
    lead_status: 'unassigned',
    assigned_to: null,
    lead_notes: null,
    branch_count: 0,
    is_hidden: false,
    research_public_id: null,
    contact_public_id: null,
    contact_status: null,
    contact_phones_count: 0,
    contact_decision_makers_count: 0,
  };

  const leadHidden = {
    id: '202',
    name: 'Hidden Old Business',
    category: 'Hardware',
    address: 'Kulai',
    phone: '07-6661234',
    website: null,
    maps_url: null,
    rating: null,
    reviews: null,
    lead_status: 'unassigned',
    assigned_to: null,
    lead_notes: null,
    branch_count: 0,
    is_hidden: true,
    research_public_id: null,
    contact_public_id: null,
    contact_status: null,
    contact_phones_count: 0,
    contact_decision_makers_count: 0,
  };

  let capturedHtml = '';
  const leadState = { selected: {}, telemarketers: [], statusFilter: 'all' };
  const el = (id: string) => ({
    set innerHTML(val: string) { capturedHtml = val; },
    get innerHTML() { return capturedHtml; },
  });
  const esc = (s: any) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const attr = (s: any) => String(s == null ? '' : s).replace(/"/g, '&quot;');
  const safeUrl = (s: any) => s;

  const renderLeadsMatch = /function renderLeads\(leads\)\{([\s\S]*?)\}\nvar teleState/.exec(script);
  assert.ok(renderLeadsMatch, 'found renderLeads in script');

  const runner = new Function('leads', 'leadState', 'el', 'esc', 'attr', 'safeUrl', `
    ${renderLeadsMatch[0]}
    return renderLeads(leads);
  `);

  runner([leadNormal, leadHidden], leadState, el, esc, attr, safeUrl);

  // Active lead has Hide button
  assert.match(capturedHtml, /toggleHideLead\('201', true\)/);
  assert.match(capturedHtml, />🚫 Hide<\/button>/);

  // Hidden lead has Unhide button
  assert.match(capturedHtml, /toggleHideLead\('202', false\)/);
  assert.match(capturedHtml, />👁️ Unhide<\/button>/);
});

test('leads master can blacklist every company whose name contains a keyword', () => {
  const html = page();
  const script = /<script>([\s\S]*)<\/script>/.exec(html)?.[1];
  assert.ok(script);

  assert.match(html, /id="keywordRuleInput"/);
  assert.match(html, /id="keywordRuleStatus"/);
  assert.match(html, /<option value="do_not_call" selected>Blacklist \(do not call\)<\/option>/);
  assert.match(html, /onclick="previewKeywordRule\(\)"/);
  assert.match(html, /id="btnApplyKeywordRule"[^>]*disabled/);
  assert.match(html, /onclick="applyKeywordRule\(\)"/);

  assert.match(script, /function previewKeywordRule\(/);
  assert.match(script, /function applyKeywordRule\(/);
  assert.match(script, /api\('\/api\/leads\/keyword-status\/preview\?keyword='/);
  assert.match(script, /api\('\/api\/leads\/keyword-status',\{method:'POST'/);
  assert.doesNotThrow(() => new Function(script));
});

test('reportdb exposes keyword-based lead status interfaces', () => {
  assert.equal(typeof db.previewLeadsByNameKeyword, 'function');
  assert.equal(typeof db.setLeadStatusByNameKeyword, 'function');
});

test('leads master can queue contact research for the whole page in one click', () => {
  const html = page();
  const script = /<script>([\s\S]*)<\/script>/.exec(html)?.[1];
  assert.ok(script);

  // The control sits with the other list-level actions.
  assert.match(html, /id="btnQueueContacts"/);
  assert.match(html, /queueContactAll\(this\)/);

  // The walk targets only rows still offering contact research — a row that
  // already links to its dossier must never be re-queued.
  assert.match(script, /function queueContactAll\(/);
  assert.match(script, /#leadTableWrapper button\[onclick\*="startContact"\]/);

  // Sequential, not parallel: the per-company dedupe on the endpoint is what
  // stops two versions of the same report, and parallel POSTs race it.
  assert.match(script, /for\(;i<pending\.length;i\+\+\)\{if\(!state\.token\)break;/);

  // A dead token aborts the walk instead of firing 30 failing requests.
  assert.match(script, /var stopped=!state\.token&&i<pending\.length;/);

  // startContact now reports success so the walk can tally it, and stays quiet
  // while walking so one summary toast replaces thirty.
  assert.match(script, /async function startContact\(button,quiet\)/);
  assert.match(script, /if\(!quiet\)showToast\('Contact research started for /);
});

test('unassigning leads resets call status but keeps do-not-call leads blacklisted', async () => {
  const source = (await import('node:fs')).readFileSync(new URL('./reportdb.ts', import.meta.url), 'utf8');
  const start = source.indexOf('export async function unassignLeads');
  const body = source.slice(start, source.indexOf('\n}\n', start));
  assert.match(body, /lead_status = case when coalesce\(lead_status, 'unassigned'\) = 'do_not_call' then 'do_not_call' else 'unassigned' end/);
});

test('blacklisted leads and remarks survive delete, merge and reset paths', async () => {
  const source = (await import('node:fs')).readFileSync(new URL('./reportdb.ts', import.meta.url), 'utf8');
  const fnBody = (name: string) => {
    const start = source.indexOf(name);
    assert.ok(start > 0, `${name} exists`);
    return source.slice(start, source.indexOf('\n}\n', start));
  };
  const keep = /case when coalesce\(lead_status, 'unassigned'\) = 'do_not_call' then 'do_not_call' else 'unassigned' end/;
  assert.match(fnBody('export async function deleteTelemarketer'), keep);
  assert.match(fnBody('export async function clearMockLeadProgress'), keep);
  assert.doesNotMatch(fnBody('export async function clearMockLeadProgress'), /lead_notes\s*=/);
  assert.match(fnBody('export async function clearMockLeadProgress'), /delete from lead_activity_log where coalesce\(notes, ''\) = ''/);
  assert.equal(source.split('await carryMergedLeadStateToKeepers();').length - 1, 2, 'called from migrate and dedupCompanies');
  assert.match(fnBody('export async function dedupCompanies'), /await carryMergedLeadStateToKeepers\(\);/);
  assert.match(fnBody('async function carryMergedLeadStateToKeepers'), /do_not_call/);
  assert.match(fnBody('async function carryMergedLeadStateToKeepers'), /string_agg\(distinct note/);
  assert.match(fnBody('export async function assignLeads'), /action = 'assignment' and coalesce\(notes, ''\) = ''/);
});
