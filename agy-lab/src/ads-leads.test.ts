import test from 'node:test';
import assert from 'node:assert/strict';
import { page } from './portal.ts';
import * as db from './reportdb.ts';

test('ads leads UI is integrated in portal desktop and mobile navigation', () => {
  const html = page();
  // Desktop navigation button
  assert.match(html, /<button class="nav-button" data-view="adsLeads" onclick="switchView\('adsLeads'\)">⚡ Ads Leads<\/button>/);
  // Mobile tab navigation
  assert.match(html, /<button class="mobile-tab" data-view="adsLeads" onclick="switchView\('adsLeads'\)"><span><\/span>Ads<\/button>/);
  // switchView router supports adsLeads and cleans up timer
  assert.match(html, /else if\(name==='adsLeads'\)loadAdsLeadsView\(\);/);
  assert.match(html, /clearInterval\(adsLeadState\.autoRefreshTimer\)/);
});

test('ads leads view has full metric cards, filters, and bulk action controls', () => {
  const html = page();

  // Container and hero description
  assert.match(html, /id="adsLeadsView"/);
  assert.match(html, /Ads &amp; Landing Page Leads/);
  assert.match(html, /atap_solar_registrations/);
  assert.match(html, /onclick="loadAdsLeads\(\)"/);
  assert.match(html, /onclick="exportAdsLeadsCsv\(\)"/);

  // Summary metric cards
  assert.match(html, /id="statAdsTotal"/);
  assert.match(html, /id="statAdsUnassigned"/);
  assert.match(html, /id="statAdsAssigned"/);
  assert.match(html, /id="statAdsContacted"/);
  assert.match(html, /id="statAdsInterested"/);
  assert.match(html, /id="statAdsLost"/);

  // Status filter buttons
  assert.match(html, /data-ads-status="all"/);
  assert.match(html, /data-ads-status="unassigned"/);
  assert.match(html, /data-ads-status="assigned"/);
  assert.match(html, /data-ads-status="contacted"/);
  assert.match(html, /data-ads-status="interested"/);
  assert.match(html, /data-ads-status="not_interested"/);
  assert.match(html, /data-ads-status="do_not_call"/);
  assert.match(html, /data-ads-status="hidden"/);

  // Filter toolbar inputs
  assert.match(html, /id="adsLeadSearch"/);
  assert.match(html, /id="adsLeadTeleFilter"/);
  assert.match(html, /id="adsLeadStateFilter"/);
  assert.match(html, /id="adsLeadSourceFilter"/);

  // Bulk actions bar
  assert.match(html, /id="bulkAdsBar"/);
  assert.match(html, /id="selectAllAdsPage"/);
  assert.match(html, /id="bulkAdsAssignSelect"/);
  assert.match(html, /bulkAssignAdsSelected\(\)/);
  assert.match(html, /bulkUnassignAdsSelected\(\)/);
  assert.match(html, /bulkHideAdsSelected\(true\)/);
  assert.match(html, /bulkHideAdsSelected\(false\)/);

  // Table wrapper and pagination
  assert.match(html, /id="adsLeadTableWrapper"/);
  assert.match(html, /id="adsLeadPagination"/);
  assert.match(html, /id="btnPrevAdsLeads"/);
  assert.match(html, /id="btnNextAdsLeads"/);

  // Raw JSON tracking modal
  assert.match(html, /id="adsRawModal"/);
  assert.match(html, /id="adsRawContent"/);
  assert.match(html, /closeAdsRawModal\(\)/);
});

test('portal script includes client-side ads leads state and renderer with zero syntax errors', () => {
  const html = page();
  const script = /<script>([\s\S]*)<\/script>/.exec(html)?.[1];
  assert.ok(script, 'portal script must be present');

  // Validate script syntax
  assert.doesNotThrow(() => new Function(script));

  // Validate functions exist in script
  assert.match(script, /var adsLeadState=\{/);
  assert.match(script, /async function loadAdsLeadsView\(/);
  assert.match(script, /async function loadAdsLeads\(/);
  assert.match(script, /function renderAdsLeadsSummary\(/);
  assert.match(script, /function renderAdsLeads\(/);
  assert.match(script, /function viewAdsLeadRawData\(/);
  assert.match(script, /function exportAdsLeadsCsv\(/);
});

test('renderAdsLeads renders lead cards with consumer solar info, WhatsApp links, and raw JSON modal', () => {
  const html = page();
  const script = /<script>([\s\S]*)<\/script>/.exec(html)?.[1];
  assert.ok(script);

  const sampleLead = {
    id: 7,
    lead_id: 'LEAD-ATAP-1380',
    full_name: 'Tan Ah Huat',
    phone_number: '012-345 6789',
    tnb_account_no: '220133334444',
    area: 'No. 55, Jalan Bunga Raya',
    state: 'Kuala Lumpur',
    property_type: 'Residential',
    monthly_bill: 450.00,
    email: 'tan@example.com',
    roof_type: 'Clay Tile',
    system_size: '6.5 kWp',
    estimated_savings: 'RM 350 - RM 400 / bln',
    source: 'google_ads',
    utm_source: 'google_ads',
    utm_medium: 'cpc',
    utm_campaign: 'solar_atap_promo',
    lead_status: 'unassigned',
    assigned_to: null,
    telemarketer_uid: null,
    lead_notes: 'Customer interested in 6.5kWp system',
    raw_data: { lead_id: 'LEAD-ATAP-1380', source: 'google_ads' },
    is_hidden: false,
    // Keep the fixture recent so the NEW INCOMING assertion does not expire.
    created_at: new Date().toISOString()
  };

  const hiddenLead = {
    id: 8,
    lead_id: 'LEAD-ATAP-1381',
    full_name: 'Hidden Customer',
    phone_number: '016-9998888',
    area: 'Johor Bahru',
    state: 'Johor',
    lead_status: 'do_not_call',
    is_hidden: true,
    created_at: '2026-09-28T07:00:00.000Z'
  };

  let capturedHtml = '';
  const adsLeadState = { selected: {}, statusFilter: 'all' };
  const leadState = { telemarketers: [{ id: 1, name: 'Siti Aminah', uid: 'tele-01', active: true }] };
  const el = (id: string) => ({
    set innerHTML(val: string) { capturedHtml = val; },
    get innerHTML() { return capturedHtml; },
  });
  const esc = (s: any) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const attr = (s: any) => String(s == null ? '' : s).replace(/"/g, '&quot;');
  const date = (s: any) => '28 Sep 2026';
  const agentValue = (a: any) => a.uid ? 'uid:' + a.uid : a.name;
  const agentLabel = (a: any) => a.uid ? a.name + ' (' + a.uid + ')' : a.name;

  const timeAgo = (s: any) => '2m ago';

  const renderAdsLeadsMatch = /function renderAdsLeads\(leads\)[\s\S]*?(?=\nasync function loadLeads)/.exec(script);
  assert.ok(renderAdsLeadsMatch, 'found renderAdsLeads in script');

  const runner = new Function(
    'leads', 'adsLeadState', 'leadState', 'el', 'esc', 'attr', 'date', 'timeAgo', 'agentValue', 'agentLabel',
    `
    ${renderAdsLeadsMatch[0]}
    return renderAdsLeads(leads);
    `
  );

  runner([sampleLead, hiddenLead], adsLeadState, leadState, el, esc, attr, date, timeAgo, agentValue, agentLabel);

  // Check lead 1 rendering
  assert.match(capturedHtml, /Tan Ah Huat/);
  assert.match(capturedHtml, /LEAD-ATAP-1380/);
  assert.match(capturedHtml, /⚡ NEW INCOMING/);
  assert.match(capturedHtml, /No\. 55, Jalan Bunga Raya, Kuala Lumpur/);
  assert.match(capturedHtml, /RM 450\.00/);
  assert.match(capturedHtml, /Size: <strong>6\.5 kWp<\/strong>/);
  assert.match(capturedHtml, /Clay Tile/);
  assert.match(capturedHtml, /TNB Acc: <strong>220133334444<\/strong>/);
  assert.match(capturedHtml, /href="tel:0123456789"/);
  assert.match(capturedHtml, /href="https:\/\/wa\.me\/60123456789\?text=/);
  assert.match(capturedHtml, /kalkulator%20solar/);
  assert.match(capturedHtml, /2m ago/);
  assert.match(capturedHtml, /href="mailto:tan@example\.com"/);
  assert.match(capturedHtml, /onclick="viewAdsLeadRawData\(7\)"/);
  assert.match(capturedHtml, /Siti Aminah \(tele-01\)/);
  assert.match(capturedHtml, /Customer interested in 6\.5kWp system/);

  // Check hide/unhide toggles
  assert.match(capturedHtml, /toggleHideAdsLead\(7, true\)/);
  assert.match(capturedHtml, />🚫 Hide<\/button>/);
  assert.match(capturedHtml, /toggleHideAdsLead\(8, false\)/);
  assert.match(capturedHtml, />👁️ Unhide<\/button>/);
});

test('page("registrations") renders dedicated incoming registrations portal', () => {
  const html = page('registrations');
  assert.match(html, /<body data-portal="registrations">/);
  assert.match(html, /<title>Incoming Registrations · Atap Solar Leads<\/title>/);
  assert.match(html, /<section id="adsLeadsView" class="view active">/);
  assert.match(html, /id="adsLiveBanner"/);
  assert.match(html, /Live Ingestion Stream Active/);
  assert.match(html, /id="adsNewAlert"/);
  assert.match(html, /id="adsNewAlertText"/);
  assert.match(html, /id="adsNewCounter"/);
  assert.match(html, /id="btnToggleAutoRefresh"/);
});

test('reportdb exports all atap_solar_registrations database interface functions', () => {
  assert.equal(typeof db.getAtapSolarRegistrationStats, 'function');
  assert.equal(typeof db.listAtapSolarRegistrations, 'function');
  assert.equal(typeof db.getAtapSolarRegistrationById, 'function');
  assert.equal(typeof db.updateAtapSolarRegistration, 'function');
  assert.equal(typeof db.assignAtapSolarRegistrations, 'function');
  assert.equal(typeof db.unassignAtapSolarRegistrations, 'function');
  assert.equal(typeof db.hideAtapSolarRegistrations, 'function');
});

