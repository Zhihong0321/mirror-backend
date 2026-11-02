import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { JOHOR_TERRITORY, SELANGOR_TERRITORY, buildTerritoryResponse } from './territories.ts';
import * as db from './reportdb.ts';
import { page } from './portal.ts';
import * as intel from './intel.ts';

test('Johor territory dataset contains all 10 districts, towns and tamans', () => {
  assert.equal(JOHOR_TERRITORY.state, 'Johor');
  assert.equal(JOHOR_TERRITORY.districts.length, 10);

  const districtNames = JOHOR_TERRITORY.districts.map((d) => d.name);
  assert.ok(districtNames.includes('Johor Bahru'));
  assert.ok(districtNames.includes('Kulai'));
  assert.ok(districtNames.includes('Batu Pahat'));
  assert.ok(districtNames.includes('Kluang'));
  assert.ok(districtNames.includes('Muar'));
  assert.ok(districtNames.includes('Pontian'));
  assert.ok(districtNames.includes('Kota Tinggi'));
  assert.ok(districtNames.includes('Segamat'));
  assert.ok(districtNames.includes('Tangkak'));
  assert.ok(districtNames.includes('Mersing'));

  // Test Johor Jaya and Ros Merah
  const jb = JOHOR_TERRITORY.districts.find((d) => d.name === 'Johor Bahru');
  assert.ok(jb);
  const jj = jb.towns.find((t) => t.name.includes('Johor Jaya'));
  assert.ok(jj);
  const rosMerah = jj.tamans.find((tm) => tm.name.includes('Ros Merah'));
  assert.ok(rosMerah);
  assert.ok(rosMerah.queryPlace.includes('Ros Merah'));
  assert.ok(rosMerah.queryPlace.includes('Johor Jaya'));
});

test('Selangor territory dataset contains all 9 districts, towns and tamans', () => {
  assert.equal(SELANGOR_TERRITORY.state, 'Selangor');
  assert.equal(SELANGOR_TERRITORY.districts.length, 9);

  const districtNames = SELANGOR_TERRITORY.districts.map((d) => d.name);
  assert.ok(districtNames.includes('Petaling'));
  assert.ok(districtNames.includes('Klang'));
  assert.ok(districtNames.includes('Hulu Langat'));
  assert.ok(districtNames.includes('Gombak'));
  assert.ok(districtNames.includes('Sepang'));
  assert.ok(districtNames.includes('Kuala Langat'));
  assert.ok(districtNames.includes('Kuala Selangor'));
  assert.ok(districtNames.includes('Hulu Selangor'));
  assert.ok(districtNames.includes('Sabak Bernam'));

  // Test Damansara & Bandar Utama
  const petaling = SELANGOR_TERRITORY.districts.find((d) => d.name === 'Petaling');
  assert.ok(petaling);
  const damansara = petaling.towns.find((t) => t.name === 'Damansara');
  assert.ok(damansara);
  const bu = damansara.tamans.find((tm) => tm.name.includes('Bandar Utama'));
  assert.ok(bu);
  assert.ok(bu.queryPlace.includes('Damansara'));
  assert.ok(bu.queryPlace.includes('Selangor'));

  // Test Cyberjaya in Sepang
  const sepang = SELANGOR_TERRITORY.districts.find((d) => d.name === 'Sepang');
  assert.ok(sepang);
  const cyber = sepang.towns.find((t) => t.name === 'Cyberjaya');
  assert.ok(cyber);
  const c10 = cyber.tamans.find((tm) => tm.name.includes('Cyber 10'));
  assert.ok(c10);
});

test('buildTerritoryResponse supports Selangor state parameter', () => {
  const dummyScans = [
    {
      public_id: 'report_bandar_utama_123',
      status: 'completed',
      place: 'bandar utama, damansara, selangor',
      keyword: 'business',
      company_count: 95,
      contact_count: 60,
      created_at: new Date().toISOString(),
    },
  ];

  const res = buildTerritoryResponse('selangor', dummyScans);
  assert.equal(res.state, 'Selangor');
  assert.equal(res.stats.totalDistricts, 9);
  assert.equal(res.stats.totalTowns, 55);
  assert.equal(res.stats.totalTamans, 1060);
  assert.equal(res.stats.scannedTamans, 1);
  assert.equal(res.stats.totalLeads, 95);
  assert.equal(res.stats.totalContacts, 60);

  const petaling = res.districts.find((d) => d.name === 'Petaling');
  const damansara = petaling?.towns.find((t) => t.name === 'Damansara');
  const bu = damansara?.tamans.find((tm) => tm.name.includes('Bandar Utama'));
  assert.ok(bu);
  assert.equal(bu.scan?.status, 'completed');
  assert.equal(bu.scan?.count, 95);
  assert.equal(bu.scan?.contacts, 60);
});

test('buildTerritoryResponse aggregates stats and attaches scan metadata', () => {
  const dummyScans = [
    {
      public_id: 'report_ros_merah_123',
      status: 'completed',
      place: 'ros merah, johor jaya, johor',
      keyword: 'business',
      company_count: 142,
      contact_count: 87,
      created_at: new Date().toISOString(),
    },
    {
      public_id: 'report_mount_austin_456',
      status: 'running',
      place: 'taman mount austin, tebrau, johor',
      keyword: 'cafe',
      company_count: 0,
      contact_count: 0,
      created_at: new Date().toISOString(),
    },
  ];

  const res = buildTerritoryResponse('johor', dummyScans);
  assert.equal(res.state, 'Johor');
  assert.equal(res.stats.totalDistricts, 10);
  assert.equal(res.stats.totalTowns, 70);
  assert.equal(res.stats.totalTamans, 771);
  assert.equal(res.stats.scannedTamans, 1);
  assert.equal(res.stats.totalLeads, 142);
  assert.equal(res.stats.totalContacts, 87);

  const jb = res.districts.find((d) => d.name === 'Johor Bahru');
  assert.ok(jb);
  const jj = jb.towns.find((t) => t.name.includes('Johor Jaya'));
  assert.ok(jj);
  const rosMerah = jj.tamans.find((tm) => tm.name.includes('Ros Merah'));
  assert.ok(rosMerah);
  assert.ok(rosMerah.scan);
  assert.equal(rosMerah.scan?.status, 'completed');
  assert.equal(rosMerah.scan?.count, 142);
  assert.equal(rosMerah.scan?.contacts, 87);
  assert.equal(rosMerah.scan?.publicId, 'report_ros_merah_123');
});

test('telemarketing Lead-Map is integrated into portal navigation and UI', () => {
  const html = page();

  // Navigation tabs
  assert.match(html, /<button class="nav-button" data-view="telemarketing"/);
  assert.match(html, /<button class="mobile-tab" data-view="telemarketing"/);

  // View section & metrics
  assert.match(html, /id="telemarketingView"/);
  assert.match(html, /id="teleDistrictsCount"/);
  assert.match(html, /id="teleTownsCount"/);
  assert.match(html, /id="teleTamansCount"/);
  assert.match(html, /id="teleScannedCount"/);

  // Controls
  assert.match(html, /id="teleStateSelect"/);
  assert.match(html, /value="selangor"/);
  assert.doesNotMatch(html, /id="teleCategory"/);
  assert.match(html, /id="teleMaxResults"/);
  assert.match(html, /id="teleFilterInput"/);
  assert.match(html, /id="teleTerritoryContainer"/);

  // Client-side methods exist
  assert.match(html, /function loadTelemarketingView\(\)/);
  assert.match(html, /function onTeleStateChange\(\)/);
  assert.match(html, /function renderTerritoryCards\(\)/);
  assert.match(html, /function queueTamanScanFromBtn\(/);
  assert.doesNotMatch(html, /function queueTerritoryFromBtn\(/);
  assert.match(html, /function promptLeadNotes\(/);
  assert.match(html, /data-place="/);
});

test('buildTerritoryResponse prioritizes active running scan over completed scan', () => {
  const scans = [
    {
      public_id: 'report_old_completed',
      status: 'completed',
      place: 'taman mount austin, tebrau, johor',
      keyword: 'business',
      company_count: 88,
      created_at: '2026-09-19T10:00:00Z',
    },
    {
      public_id: 'report_new_running',
      status: 'running',
      place: 'taman mount austin, tebrau, johor',
      keyword: 'cafe',
      company_count: 0,
      created_at: '2026-09-21T10:00:00Z',
    },
  ];

  const res = buildTerritoryResponse('johor', scans);
  const jb = res.districts.find((d) => d.name === 'Johor Bahru');
  const tebrau = jb?.towns.find((t) => t.name.includes('Tebrau'));
  const austin = tebrau?.tamans.find((tm) => tm.name === 'Taman Mount Austin');
  assert.ok(austin);
  assert.equal(austin.scan?.status, 'running');
  assert.equal(austin.scan?.publicId, 'report_new_running');
});

test('partial business lists with companies appear as scanned tamans', () => {
  const scans = [
    { public_id: 'sentosa-retry-failed', status: 'failed', place: 'Taman Sentosa, Johor Bahru City Centre, Johor', keyword: 'business', company_count: 0, contact_count: 0, created_at: '2026-09-24T10:00:00Z' },
    { public_id: 'sentosa', status: 'partial', place: 'Taman Sentosa, Johor Bahru City Centre, Johor', keyword: 'business', company_count: 76, contact_count: 41, created_at: '2026-09-23T10:00:00Z' },
    { public_id: 'mount-austin', status: 'partial', place: 'Taman Mount Austin, Tebrau, Johor', keyword: 'business', company_count: 120, contact_count: 64, created_at: '2026-09-23T11:00:00Z' },
  ];

  const result = buildTerritoryResponse('johor', scans);
  const jb = result.districts.find((d) => d.name === 'Johor Bahru');
  const sentosa = jb?.towns.find((t) => t.name === 'Johor Bahru City Centre')?.tamans.find((tm) => tm.name === 'Taman Sentosa');
  const austin = jb?.towns.find((t) => t.name === 'Tebrau')?.tamans.find((tm) => tm.name === 'Taman Mount Austin');

  assert.equal(sentosa?.scan?.publicId, 'sentosa');
  assert.equal(sentosa?.scan?.count, 76);
  assert.equal(sentosa?.scan?.contacts, 41);
  assert.equal(austin?.scan?.publicId, 'mount-austin');
  assert.equal(austin?.scan?.count, 120);
  assert.equal(austin?.scan?.contacts, 64);
  assert.equal(jb?.scannedTamans, 2);
  assert.equal(result.stats.scannedTamans, 2);
  assert.equal(result.stats.totalLeads, 196);
  assert.equal(result.stats.totalContacts, 105);

  const html = page();
  assert.match(html, /tScan\.status==='partial'&&tScan\.count>0/);
  assert.match(html, /scan\.status==='partial'&&scan\.count>0/);
  assert.match(html, /businesses · partial/);
  // Taman and town chips expose how many leads have a phone number found.
  assert.match(html, /esc\(scan\.contacts\)\+' contacts/);
  assert.match(html, /esc\(tScan\.contacts\)\+' contacts/);
  assert.match(html, /stats\.totalContacts\|\|0/);
});

test('buildTerritoryResponse incorporates taman assignment and exposes assigned telemarketer', () => {
  const scans = [
    {
      public_id: 'report_pelangi',
      status: 'completed',
      place: 'taman pelangi, johor bahru city centre, johor',
      keyword: 'business',
      company_count: 120,
      contact_count: 112,
      created_at: new Date().toISOString(),
      assigned_to: 'Sarah Tan',
    },
    {
      public_id: 'report_sentosa',
      status: 'completed',
      place: 'taman sentosa, johor bahru city centre, johor',
      keyword: 'business',
      company_count: 120,
      contact_count: 68,
      created_at: new Date().toISOString(),
    },
  ];

  const assignments = {
    'Taman Sentosa': {
      assigned_to: 'John Lee',
      telemarketer_uid: 'uid-john',
      assigned_at: new Date().toISOString(),
    },
    'Taman Kebun Teh': 'Alice Wong',
  };

  const res = buildTerritoryResponse('johor', scans, assignments);
  const jb = res.districts.find((d) => d.name === 'Johor Bahru');
  const cityCentre = jb?.towns.find((t) => t.name.includes('Johor Bahru City Centre'));
  assert.ok(cityCentre);

  // Pelangi gets assignedTo from scan's assigned_to
  const pelangi = cityCentre.tamans.find((tm) => tm.name === 'Taman Pelangi');
  assert.ok(pelangi);
  assert.equal(pelangi.assignedTo, 'Sarah Tan');
  assert.equal(pelangi.scan?.assignedTo, 'Sarah Tan');

  // Sentosa gets assignedTo from assignments override
  const sentosa = cityCentre.tamans.find((tm) => tm.name === 'Taman Sentosa');
  assert.ok(sentosa);
  assert.equal(sentosa.assignedTo, 'John Lee');
  assert.equal(sentosa.scan?.assignedTo, 'John Lee');

  // Kebun Teh (unscanned) gets assignedTo from assignments
  const kebunTeh = cityCentre.tamans.find((tm) => tm.name === 'Taman Kebun Teh');
  assert.ok(kebunTeh);
  assert.equal(kebunTeh.assignedTo, 'Alice Wong');
  assert.equal(kebunTeh.scan, undefined);
});

test('Lead Map page UI includes taman assignment button, telemarketer indicator, and assignment modal', () => {
  const html = page();

  // Modal dialog elements
  assert.match(html, /id="tamanAssignModal"/);
  assert.match(html, /id="tamanModalTitle"/);
  assert.match(html, /id="tamanAssignTeleSelect"/);
  assert.match(html, /id="tamanAssignSubmitBtn"/);
  assert.match(html, /id="tamanUnassignBtn"/);

  // Assignment buttons and styles
  assert.match(html, /\.taman-assign-btn/);
  assert.match(html, /\.taman-assign-btn\.assigned/);
  assert.match(html, /openTamanAssignModal/);
  assert.match(html, /closeTamanAssignModal/);
  assert.match(html, /submitTamanAssign/);
  assert.match(html, /submitTamanUnassign/);

  // Endpoint calls
  assert.match(html, /\/api\/territories\/assign/);
  assert.match(html, /\/api\/territories\/unassign/);
});

test('reportdb exports taman assignment interfaces', () => {
  assert.equal(typeof db.getTamanAssignments, 'function');
  assert.equal(typeof db.findTamanCompanyIds, 'function');
  assert.equal(typeof db.assignTamanLeads, 'function');
  assert.equal(typeof db.unassignTamanLeads, 'function');
});

test('submitTamanAssign and submitTamanUnassign update local state and call territories API', async () => {
  const html = page();
  const start = html.indexOf('async function submitTamanAssign');
  const end = html.indexOf('(function boot', start);
  assert.ok(start > 0 && end > start);

  const apiCalls: { path: string; body: any }[] = [];
  const town = {
    id: 'town-1',
    name: 'Johor Bahru City Centre',
    tamans: [
      { name: 'Taman Pelangi', queryPlace: 'Taman Pelangi, Johor Bahru City Centre, Johor', assignedTo: undefined as string | undefined }
    ]
  };

  const formValues: Record<string, string> = {
    tamanAssignTaman: 'Taman Pelangi',
    tamanAssignTown: 'Johor Bahru City Centre',
    tamanAssignDistrict: 'Johor Bahru',
    tamanAssignQueryPlace: 'Taman Pelangi, Johor Bahru City Centre, Johor',
    tamanAssignPublicId: 'scan-1',
    tamanAssignTeleSelect: 'Sarah Tan',
    teleStateSelect: 'johor',
  };

  const context: Record<string, any> = {
    teleState: { data: { districts: [{ id: 'dist-1', towns: [town] }] } },
    el: (id: string) => {
      if (id === 'tamanAssignModal') return { classList: { add: () => {}, remove: () => {} } };
      if (id === 'tamanAssignSubmitBtn') return { disabled: false, textContent: '' };
      if (id === 'tamanUnassignBtn') return { disabled: false, textContent: '' };
      return { value: formValues[id] || '' };
    },
    api: async (path: string, options: { body: string }) => {
      const body = JSON.parse(options.body);
      apiCalls.push({ path, body });
      return { ok: true, updated: 120, assignedTo: body.assignedTo || 'Sarah Tan' };
    },
    renderTerritoryCards: () => {},
    closeTamanAssignModal: () => {},
    showToast: () => {},
    authLost: () => false,
    window: { confirm: () => true },
  };

  const script = html.slice(start, end) + '; ({ submitTamanAssign, submitTamanUnassign })';
  const fns = vm.runInNewContext(script, context);

  // 1. Test assigning
  await fns.submitTamanAssign({ preventDefault: () => {} });
  assert.equal(apiCalls.length, 1);
  assert.equal(apiCalls[0].path, '/api/territories/assign');
  assert.equal(apiCalls[0].body.taman, 'Taman Pelangi');
  assert.equal(apiCalls[0].body.assignedTo, 'Sarah Tan');
  assert.equal(town.tamans[0].assignedTo, 'Sarah Tan');

  // 2. Test unassigning
  await fns.submitTamanUnassign();
  assert.equal(apiCalls.length, 2);
  assert.equal(apiCalls[1].path, '/api/territories/unassign');
  assert.equal(apiCalls[1].body.taman, 'Taman Pelangi');
  assert.equal(town.tamans[0].assignedTo, undefined);
});

test('Lead assignment page UI is integrated into portal navigation and views', () => {
  const html = page();

  // Navigation tabs
  assert.match(html, /<button class="nav-button" data-view="assignment"/);
  assert.match(html, /<button class="mobile-tab" data-view="assignment"/);

  // Assignment view container & stats
  assert.match(html, /id="assignmentView"/);
  assert.match(html, /id="assignStatTotal"/);
  assert.match(html, /id="assignStatAssigned"/);
  assert.match(html, /id="assignStatUnassigned"/);
  assert.match(html, /id="assignStatAgents"/);

  // Telemarketer cards & filters
  assert.match(html, /id="assignRosterGrid"/);
  assert.match(html, /id="assignRosterSearch"/);
  assert.match(html, /id="btnRosterViewList"/);
  assert.match(html, /id="btnRosterViewCards"/);
  assert.match(html, /id="assignTeleFilter"/);
  assert.match(html, /id="assignSearchInput"/);
  assert.match(html, /id="assignActiveBanner"/);
  assert.match(html, /id="assignBulkBar"/);
  assert.match(html, /id="assignmentLeadsWrapper"/);
  assert.match(html, /id="assignPagination"/);

  // Client-side functions exist
  assert.match(html, /function loadAssignmentView\(\)/);
  assert.match(html, /function loadAssignmentAgents\(\)/);
  assert.match(html, /function renderAssignTelemarketerCards\(\)/);
  assert.match(html, /function selectAssignmentTele\(/);
  assert.match(html, /function setAssignRosterView\(/);
  assert.match(html, /function onAssignRosterSearch\(/);
  assert.match(html, /function sortAssignRoster\(/);
  assert.match(html, /function toggleAssignRosterExpand\(\)/);
  assert.match(html, /function onAssignTeleFilterChange\(\)/);
  assert.match(html, /function loadAssignmentLeads\(\)/);
  assert.match(html, /function renderAssignmentLeads\(/);
  assert.match(html, /function updateAssignLeadAssignee\(/);
  assert.match(html, /function bulkAssignFromAssignmentView\(\)/);
});

test('reportdb exports and executes getLeadStats and listLeads without error', async () => {
  assert.equal(typeof db.getLeadStats, 'function');
  assert.equal(typeof db.getTelemarketerDetails, 'function');
  assert.equal(typeof db.listLeads, 'function');
  assert.equal(typeof db.assignLeads, 'function');
  assert.equal(typeof db.unassignLeads, 'function');

  // Verify direct invocation returns valid stats shape without throwing ReferenceError
  const stats = await db.getLeadStats();
  assert.equal(typeof stats, 'object');
  assert.equal(typeof stats.total, 'number');
  assert.equal(typeof stats.unassigned, 'number');

  const leadResult = await db.listLeads({ assignedTo: 'uid:sarah' });
  assert.equal(typeof leadResult, 'object');
  assert.ok(Array.isArray(leadResult.leads));
  assert.equal(typeof leadResult.total, 'number');
  assert.equal(typeof leadResult.stats, 'object');
  assert.equal(typeof leadResult.stats.total, 'number');
});

test('Lead assignment client-side logic renders telemarketer cards with total leads and handles filtering', async () => {
  const html = page();
  const start = html.indexOf('function agentValue');
  const end = html.indexOf('var leadState={', start);
  assert.ok(start > 0 && end > start);

  const elements: Record<string, any> = {
    assignStatTotal: { textContent: '' },
    assignStatAssigned: { textContent: '' },
    assignStatUnassigned: { textContent: '' },
    assignStatAgents: { textContent: '' },
    assignStatContacted: { textContent: '' },
    assignStatInterested: { textContent: '' },
    assignRosterGrid: { innerHTML: '' },
    assignTeleFilter: { value: 'all', innerHTML: '' },
    assignBulkTargetSelect: { innerHTML: '' },
    assignSearchInput: { value: '' },
    assignActiveBanner: { classList: { add: () => {}, remove: () => {}, contains: () => false } },
    assignBannerTitle: { textContent: '' },
    assignBannerSubtitle: { textContent: '' },
    assignCountAll: { textContent: '' },
    assignCountAssigned: { textContent: '' },
    assignCountContacted: { textContent: '' },
    assignCountInterested: { textContent: '' },
    assignCountNotInterested: { textContent: '' },
    assignCountDnc: { textContent: '' },
    assignmentLeadsWrapper: { innerHTML: '' },
    assignPageInfo: { textContent: '' },
    btnPrevAssign: { disabled: false },
    btnNextAssign: { disabled: false },
    assignBulkBar: { classList: { add: () => {}, remove: () => {}, toggle: () => {} } },
    assignBulkCount: { textContent: '' },
    assignSelectAllPage: { checked: false },
    assignCountAll: { textContent: '' },
    assignCountAssigned: { textContent: '' },
    assignCountContacted: { textContent: '' },
    assignCountInterested: { textContent: '' },
    assignCountNotInterested: { textContent: '' },
    assignCountDnc: { textContent: '' },
    toast: { textContent: '', classList: { add: () => {}, remove: () => {} } },
  };

  const sampleAgents = [
    {
      id: 1,
      uid: 'uid-sarah',
      name: 'Sarah Tan',
      phone: '+6012-3456789',
      email: 'sarah@example.com',
      active: true,
      total_assigned: 45,
      pending_count: 20,
      contacted_count: 15,
      interested_count: 7,
      not_interested_count: 2,
      dnc_count: 1,
    },
    {
      id: 2,
      uid: 'uid-john',
      name: 'John Lee',
      phone: '+6017-9876543',
      email: 'john@example.com',
      active: true,
      total_assigned: 30,
      pending_count: 10,
      contacted_count: 12,
      interested_count: 5,
      not_interested_count: 2,
      dnc_count: 1,
    },
  ];

  const sampleStats = {
    total: 200,
    unassigned: 125,
    assigned: 30,
    contacted: 27,
    interested: 12,
    not_interested: 4,
    do_not_call: 2,
    contacts_found: 85,
    hidden: 0,
  };

  const sampleLeads = [
    {
      id: 'c1',
      name: 'Alpha Engineering Sdn Bhd',
      category: 'Engineering Contractor',
      phone: '+607-1234567',
      address: 'Jalan Ros Merah, Johor Jaya',
      lead_status: 'assigned',
      assigned_to: 'Sarah Tan',
      telemarketer_uid: 'uid-sarah',
      contact_phones_count: 2,
      contact_decision_makers_count: 1,
    },
  ];

  let lastApiQuery = '';
  const context = {
    state: { token: 'mock-token', jobs: {}, reports: [] },
    el: (id: string) => elements[id] || null,
    document: {
      querySelectorAll: () => [],
      getElementById: (id: string) => elements[id] || null,
    },
    api: async (path: string) => {
      lastApiQuery = path;
      if (path === '/api/telemarketers') {
        return { agents: sampleAgents, telemarketers: ['Sarah Tan', 'John Lee'], stats: sampleStats };
      }
      if (path.startsWith('/api/leads')) {
        return { leads: sampleLeads, total: 1, stats: sampleStats };
      }
      return {};
    },
    showToast: () => {},
    authLost: () => false,
    esc: (v: any) => String(v ?? ''),
    attr: (v: any) => String(v ?? ''),
    safeUrl: (v: any) => String(v ?? ''),
  };

  const script = html.slice(start, end) + '; ({ assignState, loadAssignmentView, selectAssignmentTele, renderAssignTelemarketerCards, setAssignRosterView, onAssignRosterSearch, clearAssignRosterSearch, sortAssignRoster, toggleAssignRosterExpand })';
  const fns = vm.runInNewContext(script, context);

  // Test loading the assignment view
  await fns.loadAssignmentView();

  // Verify telemarketers were loaded with stats
  assert.equal(fns.assignState.agents.length, 2);
  assert.equal(elements.assignStatTotal.textContent, 200);
  assert.equal(elements.assignStatUnassigned.textContent, 125);
  assert.equal(elements.assignStatAssigned.textContent, 75); // 30+27+12+4+2
  assert.equal(elements.assignStatAgents.textContent, 2);

  // Verify telemarketer list table view was rendered by default
  assert.equal(fns.assignState.rosterViewMode, 'list');
  const gridHtml = elements.assignRosterGrid.innerHTML;
  assert.ok(gridHtml.includes('assign-roster-table'));
  assert.ok(gridHtml.includes('Sarah Tan'));
  assert.ok(gridHtml.includes('45')); // Total assigned to Sarah
  assert.ok(gridHtml.includes('John Lee'));
  assert.ok(gridHtml.includes('30')); // Total assigned to John
  assert.ok(gridHtml.includes('Unassigned Leads'));
  assert.ok(gridHtml.includes('125')); // Unassigned count

  // Test searching telemarketer roster
  fns.onAssignRosterSearch('John');
  assert.equal(fns.assignState.rosterSearch, 'John');
  const searchHtml = elements.assignRosterGrid.innerHTML;
  assert.ok(searchHtml.includes('John Lee'));
  assert.ok(!searchHtml.includes('Sarah Tan')); // Sarah is filtered out
  fns.clearAssignRosterSearch();
  assert.equal(fns.assignState.rosterSearch, '');
  assert.ok(elements.assignRosterGrid.innerHTML.includes('Sarah Tan'));

  // Test sorting telemarketer roster
  fns.sortAssignRoster('name');
  assert.equal(fns.assignState.rosterSortField, 'name');
  fns.sortAssignRoster('total');
  assert.equal(fns.assignState.rosterSortField, 'total');

  // Test expand / collapse toggle
  assert.equal(fns.assignState.rosterExpanded, false);
  fns.toggleAssignRosterExpand();
  assert.equal(fns.assignState.rosterExpanded, true);
  fns.toggleAssignRosterExpand();
  assert.equal(fns.assignState.rosterExpanded, false);

  // Test view switcher (cards <-> list)
  fns.setAssignRosterView('cards');
  assert.equal(fns.assignState.rosterViewMode, 'cards');
  assert.ok(elements.assignRosterGrid.innerHTML.includes('assign-agent-card'));
  fns.setAssignRosterView('list');
  assert.equal(fns.assignState.rosterViewMode, 'list');
  assert.ok(elements.assignRosterGrid.innerHTML.includes('assign-roster-table'));

  // Test filtering by a specific telemarketer
  await fns.selectAssignmentTele('uid:sarah');
  assert.equal(fns.assignState.teleFilter, 'uid:sarah');
  assert.ok(lastApiQuery.includes('assignedTo=uid%3Asarah') || lastApiQuery.includes('assignedTo=uid:sarah'));
  assert.equal(elements.assignTeleFilter.value, 'uid:sarah');

  // Verify the active banner shows Sarah Tan and her 45 assigned leads
  assert.ok(elements.assignBannerTitle.textContent.includes('Sarah Tan'));
  assert.ok(elements.assignBannerTitle.textContent.includes('45'));

  // Verify per-telemarketer status pill counts without throwing ReferenceError
  assert.equal(elements.assignCountAll.textContent, 45);
  assert.equal(elements.assignCountAssigned.textContent, 20); // pending
  assert.equal(elements.assignCountContacted.textContent, 15);
  assert.equal(elements.assignCountInterested.textContent, 7);
  assert.equal(elements.assignCountNotInterested.textContent, 2);
  assert.equal(elements.assignCountDnc.textContent, 1);

  // Test selecting unassigned pool
  await fns.selectAssignmentTele('unassigned');
  assert.equal(elements.assignCountAll.textContent, 125);
  assert.equal(elements.assignCountAssigned.textContent, 125);
  assert.equal(elements.assignCountContacted.textContent, 0);

  // Test selecting all telemarketers
  await fns.selectAssignmentTele('all');
  assert.equal(elements.assignCountAll.textContent, 200);
  assert.equal(elements.assignCountAssigned.textContent, 30);
  assert.equal(elements.assignCountContacted.textContent, 27);
});

test('Telemarketer API endpoints handle auth by Telemarketer UID, lead reading, and lead updating', async () => {
  let lastUpdatedPatch: any = null;
  const mockDb: any = {
    configured: () => true,
    getTelemarketerByUid: async (uid: string) => {
      const clean = uid.toLowerCase();
      if (clean === 'uid-sarah' || clean === 'sarah' || clean === 'tm-sarah' || clean === 'sarah tan') {
        return {
          id: 1,
          uid: 'uid-sarah',
          name: 'Sarah Tan',
          phone: '+6012-3456789',
          email: 'sarah@example.com',
          active: true,
          total_assigned: 45,
          created_at: new Date().toISOString(),
        };
      }
      return null;
    },
    listTelemarketers: async () => ['Sarah Tan', 'Vincent Tan'],
    getTelemarketerDetails: async () => [
      { id: 1, uid: 'uid-sarah', name: 'Sarah Tan', active: true, total_assigned: 45 },
      { id: 2, uid: 'uid-vincent', name: 'Vincent Tan', active: true, total_assigned: 20 },
    ],
    getLeadStats: async () => ({ total: 65, assigned: 65 }),
    getTelemarketerStatsByUid: async () => ({
      total: 45,
      pending: 20,
      contacted: 15,
      interested: 7,
      not_interested: 2,
      do_not_call: 1,
    }),
    listLeads: async (opts: any) => ({
      leads: [
        {
          id: '101',
          name: 'Solar Future Sdn Bhd',
          phone: '+607-5551234',
          lead_status: 'assigned',
          assigned_to: 'Sarah Tan',
          telemarketer_uid: 'uid-sarah',
          contact_phones_count: 2,
          contact_decision_makers_count: 1,
        },
      ],
      total: 1,
      stats: { total: 45, unassigned: 0, assigned: 20, contacted: 15, interested: 7, not_interested: 2, do_not_call: 1, contacts_found: 1, hidden: 0 },
      limit: opts.limit ?? 50,
      offset: opts.offset ?? 0,
    }),
    getLeadById: async (id: string | number) => {
      if (String(id) === '101') {
        return {
          id: '101',
          name: 'Solar Future Sdn Bhd',
          category: 'Solar Energy',
          phone: '+607-5551234',
          address: 'Jalan Molek, Taman Molek',
          lead_status: 'assigned',
          assigned_to: 'Sarah Tan',
          telemarketer_uid: 'uid-sarah',
          lead_notes: 'Initial scan lead',
          decision_makers: [{ name: 'Tan Boon Lee', title: 'Director', phone: '+6019-7112233' }],
          phone_contacts: [{ phone: '+607-5551234', type: 'office' }, { phone: '+6019-7112233', type: 'mobile_whatsapp' }],
        };
      }
      if (String(id) === '999') {
        return {
          id: '999',
          name: 'Other Company Sdn Bhd',
          assigned_to: 'John Lee',
          telemarketer_uid: 'uid-john',
          lead_status: 'assigned',
        };
      }
      return null;
    },
    updateLead: async (id: string | number, patch: any) => {
      lastUpdatedPatch = patch;
      return {
        id: String(id),
        name: 'Solar Future Sdn Bhd',
        lead_status: patch.leadStatus ?? 'assigned',
        lead_notes: patch.notes ?? '',
        assigned_to: 'Sarah Tan',
        telemarketer_uid: 'uid-sarah',
        lead_updated_at: new Date().toISOString(),
      };
    },
  };

  const makeCtx = (dbOverride?: any) => {
    let statusCode = 200;
    let responseBody: any = null;
    return {
      ctx: {
        json: (_res: any, code: number, data: any) => {
          statusCode = code;
          responseBody = data;
        },
        readJson: async (_req: any) => (_req as any)._body || {},
        db: dbOverride !== undefined ? dbOverride : mockDb,
      },
      getStatus: () => statusCode,
      getBody: () => responseBody,
    };
  };

  // 1. Missing UID should return 401
  {
    const req: any = { method: 'GET', headers: {} };
    const res: any = {};
    const url = new URL('http://localhost/api/telemarketer/leads');
    const { ctx, getStatus, getBody } = makeCtx();
    const handled = await intel.handleTelemarketerApi(req, res, url, ctx as any);
    assert.equal(handled, true);
    assert.equal(getStatus(), 401);
    assert.equal(getBody().ok, false);
    assert.match(getBody().error, /UID is required/i);
  }

  // 2. Non-telemarketer route should return false
  {
    const req: any = { method: 'GET', headers: {} };
    const res: any = {};
    const url = new URL('http://localhost/api/other');
    const { ctx } = makeCtx();
    const handled = await intel.handleTelemarketerApi(req, res, url, ctx as any);
    assert.equal(handled, false);
  }

  // 3a. Unknown UID should return 403
  {
    const req: any = { method: 'GET', headers: { 'x-telemarketer-uid': 'non-existent-uid' } };
    const res: any = {};
    const url = new URL('http://localhost/api/telemarketer/leads');
    const { ctx, getStatus, getBody } = makeCtx();
    const handled = await intel.handleTelemarketerApi(req, res, url, ctx as any);
    assert.equal(handled, true);
    assert.equal(getStatus(), 403);
    assert.match(getBody().error, /invalid or inactive/i);
  }

  // 4a. Read leads list via ?uid=
  {
    const req: any = { method: 'GET', headers: {} };
    const res: any = {};
    const url = new URL('http://localhost/api/telemarketer/leads?uid=uid-sarah');
    const { ctx, getStatus, getBody } = makeCtx();
    const handled = await intel.handleTelemarketerApi(req, res, url, ctx as any);
    assert.equal(handled, true);
    assert.equal(getStatus(), 200);
    assert.equal(getBody().ok, true);
    assert.equal(getBody().telemarketer.name, 'Sarah Tan');
    assert.equal(getBody().stats.total, 45);
    assert.equal(getBody().leads.length, 1);
    assert.equal(getBody().leads[0].name, 'Solar Future Sdn Bhd');
  }

  // 4b. Read leads list via path /api/telemarketer/:uid/leads
  {
    const req: any = { method: 'GET', headers: {} };
    const res: any = {};
    const url = new URL('http://localhost/api/telemarketer/uid-sarah/leads');
    const { ctx, getStatus, getBody } = makeCtx();
    const handled = await intel.handleTelemarketerApi(req, res, url, ctx as any);
    assert.equal(handled, true);
    assert.equal(getStatus(), 200);
    assert.equal(getBody().telemarketer.name, 'Sarah Tan');
    assert.equal(getBody().leads[0].id, '101');
  }

  // 4c. Read single lead detail by ID with decision makers and phone contacts
  {
    const req: any = { method: 'GET', headers: { 'x-telemarketer-uid': 'uid-sarah' } };
    const res: any = {};
    const url = new URL('http://localhost/api/telemarketer/leads/101');
    const { ctx, getStatus, getBody } = makeCtx();
    const handled = await intel.handleTelemarketerApi(req, res, url, ctx as any);
    assert.equal(handled, true);
    assert.equal(getStatus(), 200);
    assert.equal(getBody().lead.id, '101');
    assert.equal(getBody().lead.decision_makers.length, 1);
    assert.equal(getBody().lead.decision_makers[0].name, 'Tan Boon Lee');
    assert.equal(getBody().lead.phone_contacts.length, 2);
  }

  // 4d. Update lead status and notes via PATCH
  {
    const req: any = {
      method: 'PATCH',
      headers: { 'x-telemarketer-uid': 'uid-sarah' },
      _body: {
        leadStatus: 'contacted',
        notes: 'Spoke with Boon Lee, sending solar proposal.',
      },
    };
    const res: any = {};
    const url = new URL('http://localhost/api/telemarketer/leads/101');
    const { ctx, getStatus, getBody } = makeCtx();
    const handled = await intel.handleTelemarketerApi(req, res, url, ctx as any);
    assert.equal(handled, true);
    assert.equal(getStatus(), 200);
    assert.equal(getBody().ok, true);
    assert.equal(lastUpdatedPatch.leadStatus, 'contacted');
    assert.equal(lastUpdatedPatch.notes, 'Spoke with Boon Lee, sending solar proposal.');
  }

  // 4e. Append notes with status alias via POST
  {
    const req: any = {
      method: 'POST',
      headers: { 'authorization': 'Bearer uid-sarah' },
      _body: {
        status: 'interested',
        appendNotes: 'Client confirmed 10kW quota inquiry.',
      },
    };
    const res: any = {};
    const url = new URL('http://localhost/api/telemarketer/leads/101');
    const { ctx, getStatus, getBody } = makeCtx();
    const handled = await intel.handleTelemarketerApi(req, res, url, ctx as any);
    assert.equal(handled, true);
    assert.equal(getStatus(), 200);
    assert.equal(lastUpdatedPatch.leadStatus, 'interested');
    assert.ok(lastUpdatedPatch.notes.includes('Initial scan lead'));
    assert.ok(lastUpdatedPatch.notes.includes('Client confirmed 10kW quota inquiry.'));
  }

  // 4f. Attempt to modify lead assigned to another telemarketer returns 403
  {
    const req: any = {
      method: 'PATCH',
      headers: { 'x-telemarketer-uid': 'uid-sarah' },
      _body: { leadStatus: 'interested' },
    };
    const res: any = {};
    const url = new URL('http://localhost/api/telemarketer/leads/999');
    const { ctx, getStatus, getBody } = makeCtx();
    const handled = await intel.handleTelemarketerApi(req, res, url, ctx as any);
    assert.equal(handled, true);
    assert.equal(getStatus(), 403);
    assert.match(getBody().error, /assigned to another telemarketer/i);
  }

  // 4g. Attempt to submit invalid status returns 400
  {
    const req: any = {
      method: 'PATCH',
      headers: { 'x-telemarketer-uid': 'uid-sarah' },
      _body: { leadStatus: 'some_random_status' },
    };
    const res: any = {};
    const url = new URL('http://localhost/api/telemarketer/leads/101');
    const { ctx, getStatus, getBody } = makeCtx();
    const handled = await intel.handleTelemarketerApi(req, res, url, ctx as any);
    assert.equal(handled, true);
    assert.equal(getStatus(), 400);
    assert.match(getBody().error, /Invalid status/i);
  }

  // 4h. Telemarketer profile endpoint GET /api/telemarketer/me
  {
    const req: any = { method: 'GET', headers: { 'authorization': 'Bearer uid-sarah' } };
    const res: any = {};
    const url = new URL('http://localhost/api/telemarketer/me');
    const { ctx, getStatus, getBody } = makeCtx();
    const handled = await intel.handleTelemarketerApi(req, res, url, ctx as any);
    assert.equal(handled, true);
    assert.equal(getStatus(), 200);
    assert.equal(getBody().telemarketer.name, 'Sarah Tan');
    assert.equal(getBody().stats.total, 45);
  }

  // 4i. Operator telemarketers routes (/api/telemarketers) must NEVER be hijacked by handleTelemarketerApi
  {
    const reqGet: any = { method: 'GET', headers: { 'authorization': 'Bearer operator-test-token' } };
    const resGet: any = {};
    const urlGet = new URL('http://localhost/api/telemarketers');
    const { ctx: ctxGet } = makeCtx();
    const handledGet = await intel.handleTelemarketerApi(reqGet, resGet, urlGet, ctxGet as any);
    assert.equal(handledGet, false, 'handleTelemarketerApi must ignore /api/telemarketers (operator route)');

    const reqPost: any = { method: 'POST', headers: { 'authorization': 'Bearer operator-test-token' } };
    const resPost: any = {};
    const urlPost = new URL('http://localhost/api/telemarketers/import');
    const { ctx: ctxPost } = makeCtx();
    const handledPost = await intel.handleTelemarketerApi(reqPost, resPost, urlPost, ctxPost as any);
    assert.equal(handledPost, false, 'handleTelemarketerApi must ignore /api/telemarketers/import (operator route)');
  }

  // 4j. Active telemarketer roster discovery: GET /api/telemarketer/roster
  {
    const req: any = { method: 'GET', headers: {} };
    const res: any = {};
    const url = new URL('http://localhost/api/telemarketer/roster');
    const { ctx, getStatus, getBody } = makeCtx();
    const handled = await intel.handleTelemarketerApi(req, res, url, ctx as any);
    assert.equal(handled, true);
    assert.equal(getStatus(), 200);
    assert.equal(getBody().ok, true);
    assert.ok(Array.isArray(getBody().agents));
    assert.equal(getBody().agents.length, 2);
    assert.equal(getBody().agents[0].name, 'Sarah Tan');
    assert.equal(getBody().agents[0].api_url, '/api/telemarketer/uid-sarah/leads');
  }

  // 4k. Alternative path formats: GET /api/telemarketer/leads/:uid and /api/telemarketer/:uid/leads
  {
    const req1: any = { method: 'GET', headers: {} };
    const res1: any = {};
    const url1 = new URL('http://localhost/api/telemarketer/leads/uid-sarah');
    const { ctx: ctx1, getStatus: getStatus1, getBody: getBody1 } = makeCtx();
    const handled1 = await intel.handleTelemarketerApi(req1, res1, url1, ctx1 as any);
    assert.equal(handled1, true);
    assert.equal(getStatus1(), 200);
    assert.equal(getBody1().telemarketer.name, 'Sarah Tan');
    assert.equal(getBody1().leads.length, 1);

    const req2: any = { method: 'GET', headers: {} };
    const res2: any = {};
    const url2 = new URL('http://localhost/api/telemarketer/leads/=TM-SARAH');
    const { ctx: ctx2, getStatus: getStatus2, getBody: getBody2 } = makeCtx();
    const handled2 = await intel.handleTelemarketerApi(req2, res2, url2, ctx2 as any);
    assert.equal(handled2, true);
    assert.equal(getStatus2(), 200);
    assert.equal(getBody2().telemarketer.name, 'Sarah Tan');
  }

  // 4l. Query by ?assignedTo=, ?telemarketer=, ?name=
  {
    const req: any = { method: 'GET', headers: {} };
    const res: any = {};
    const url = new URL('http://localhost/api/telemarketer/leads?assignedTo=Sarah%20Tan');
    const { ctx, getStatus, getBody } = makeCtx();
    const handled = await intel.handleTelemarketerApi(req, res, url, ctx as any);
    assert.equal(handled, true);
    assert.equal(getStatus(), 200);
    assert.equal(getBody().telemarketer.name, 'Sarah Tan');
  }

  // 4m. Operator bearer token does NOT collide with UID and allows operator to read all leads or agent leads
  {
    const reqAll: any = { method: 'GET', headers: { 'authorization': 'Bearer operator-test-token' } };
    const resAll: any = {};
    const urlAll = new URL('http://localhost/api/telemarketer/leads');
    const { ctx: ctxAll, getStatus: getStatusAll, getBody: getBodyAll } = makeCtx();
    (ctxAll as any).isOperator = true;
    const handledAll = await intel.handleTelemarketerApi(reqAll, resAll, urlAll, ctxAll as any);
    assert.equal(handledAll, true);
    assert.equal(getStatusAll(), 200);
    assert.equal(getBodyAll().operator, true);
    assert.equal(getBodyAll().leads.length, 1);

    // Operator querying specific telemarketer via ?uid=
    const reqAgent: any = { method: 'GET', headers: { 'authorization': 'Bearer operator-test-token' } };
    const resAgent: any = {};
    const urlAgent = new URL('http://localhost/api/telemarketer/leads?uid=uid-sarah');
    const { ctx: ctxAgent, getStatus: getStatusAgent, getBody: getBodyAgent } = makeCtx();
    (ctxAgent as any).isOperator = true;
    const handledAgent = await intel.handleTelemarketerApi(reqAgent, resAgent, urlAgent, ctxAgent as any);
    assert.equal(handledAgent, true);
    assert.equal(getStatusAgent(), 200);
    assert.equal(getBodyAgent().telemarketer.name, 'Sarah Tan');
  }

  // 4n. TM-SARAH demo fallback in reportdb
  {
    const demoAgent = await db.getTelemarketerByUid('TM-SARAH');
    assert.ok(demoAgent);
    assert.equal(demoAgent.name, 'Sarah Tan');
    const demoStats = await db.getTelemarketerStatsByUid('TM-SARAH');
    assert.ok(demoStats.total >= 0);
  }
});


test('taman scans are grouped by keyword so a factory scan does not hide the business scan', () => {
  const scans = [
    { public_id: 'austin-business', status: 'completed', place: 'Taman Mount Austin, Tebrau, Johor', keyword: 'Business', company_count: 120, contact_count: 64, created_at: '2026-09-23T11:00:00Z' },
    { public_id: 'austin-factory', status: 'partial', place: 'Taman Mount Austin, Tebrau, Johor', keyword: 'factory', company_count: 9, contact_count: 2, created_at: '2026-09-25T11:00:00Z' },
  ];

  const result = buildTerritoryResponse('johor', scans);
  const austin = result.districts.find((d) => d.name === 'Johor Bahru')?.towns.find((t) => t.name === 'Tebrau')?.tamans.find((tm) => tm.name === 'Taman Mount Austin');

  assert.deepEqual(Object.keys(austin?.scanByKeyword ?? {}).sort(), ['business', 'factory']);
  assert.equal(austin?.scanByKeyword?.business?.publicId, 'austin-business');
  assert.equal(austin?.scanByKeyword?.business?.count, 120);
  assert.equal(austin?.scanByKeyword?.factory?.publicId, 'austin-factory');
  assert.equal(austin?.scanByKeyword?.factory?.count, 9);
});

test('buildTerritoryResponse attaches the leads still waiting for contact research per taman', () => {
  const austin = buildTerritoryResponse('johor').districts
    .find((d) => d.name === 'Johor Bahru')?.towns.find((t) => t.name === 'Tebrau')?.tamans.find((tm) => tm.name === 'Taman Mount Austin');
  assert.ok(austin);
  const res = buildTerritoryResponse('johor', [], {}, { [austin.queryPlace.trim().toLowerCase()]: 5 });
  const withCount = res.districts.find((d) => d.name === 'Johor Bahru')?.towns.find((t) => t.name === 'Tebrau')?.tamans.find((tm) => tm.name === 'Taman Mount Austin');
  assert.equal(withCount?.contactPending, 5);
  const other = res.districts.flatMap((d) => d.towns).flatMap((t) => t.tamans).find((tm) => tm.name !== 'Taman Mount Austin');
  assert.equal(other?.contactPending, 0);
});
