import test from 'node:test';
import assert from 'node:assert/strict';
import { page } from './portal.ts';
import * as db from './reportdb.ts';
import { handleApi } from './intel.ts';

test('Lead Activity UI is fully integrated into portal navigation, views, charts and modals', () => {
  const html = page();

  // 1. Navigation items
  assert.match(html, />Lead Activity<\/button>/);
  assert.match(html, /data-view="activity"/);
  assert.match(html, /switchView\('activity'\)/);
  assert.match(html, /<button class="mobile-tab" data-view="activity"/);

  // 2. View container & hero
  assert.match(html, /id="activityView"/);
  assert.match(html, /Real-Time Operations &amp; Presentation Intelligence|Real-Time Operations & Presentation Intelligence/);
  assert.match(html, /Lead activity &amp; daily progress\.|Lead activity & daily progress\./);

  // 3. Top Toolbar & Quick Actions
  assert.match(html, /id="activityDaysSelect"/);
  assert.match(html, /id="activityTeleFilter"/);
  assert.match(html, /openMockDataModal\(\)/);
  assert.match(html, /openManualActivityModal\(\)/);
  assert.match(html, /openResetProgressModal\(\)/);

  // 4. KPI Summary Cards
  assert.match(html, /id="actKpiProcessed"/);
  assert.match(html, /id="actKpiToday"/);
  assert.match(html, /id="actKpiContacted"/);
  assert.match(html, /id="actKpiInterested"/);
  assert.match(html, /id="actKpiConversion"/);
  assert.match(html, /id="actKpiAgents"/);

  // 5. Section 1: Daily Lead Processed
  assert.match(html, /Daily Leads Processed \(With Status Changed\)/);
  assert.match(html, /id="activityDailyChartContainer"/);

  // 6. Section 2: Lead Progress per Day per Status Type
  assert.match(html, /Lead Progress Per Day Per Status Type/);
  assert.match(html, /id="activityProgressContainer"/);

  // 7. Section 3: Per-Telemarketer Activity Summary
  assert.match(html, /Per-Telemarketer Activity Summary/);
  assert.match(html, /id="activityTeleSummaryContainer"/);

  // 8. Section 4: Real-time Activity Feed / Audit Trail
  assert.match(html, /Live Call &amp; Activity Feed|Live Call & Activity Feed/);
  assert.match(html, /id="activitySearchInput"/);
  assert.match(html, /id="activityLogStatusFilter"/);
  assert.match(html, /id="activityLogFeedWrapper"/);
  assert.match(html, /id="activityLogPagination"/);

  // 9. Section 5: Presentation View 04 - Top 10 Telemarketer Leaderboard
  assert.match(html, /Presentation View 04/);
  assert.match(html, /Top 10 Telemarketer Leaderboard/);
  assert.match(html, /id="activityCustomDateInputs"/);
  assert.match(html, /id="actStartDate"/);
  assert.match(html, /id="actEndDate"/);
  assert.match(html, /id="btnSortInterested"/);
  assert.match(html, /id="btnSortProcessed"/);
  assert.match(html, /id="btnSortConversion"/);
  assert.match(html, /id="btnSortContacted"/);
  assert.match(html, /id="leaderboardDateInfo"/);
  assert.match(html, /id="leaderboardPodiumContainer"/);
  assert.match(html, /id="leaderboardTableContainer"/);

  // 10. Modals for Mock Generation, Reset, and Manual Entry
  assert.match(html, /id="mockDataModal"/);
  assert.match(html, /id="mockLeadCount"/);
  assert.match(html, /id="mockDaysSpan"/);
  assert.match(html, /id="mockClearFirst"/);
  assert.match(html, /id="btnSubmitMock"/);

  assert.match(html, /id="resetProgressModal"/);
  assert.match(html, /id="btnConfirmReset"/);

  assert.match(html, /id="manualActivityModal"/);
  assert.match(html, /id="manualActCompanyId"/);
  assert.match(html, /id="manualActStatus"/);
  assert.match(html, /id="manualActTele"/);
  assert.match(html, /id="manualActNotes"/);

  // 11. Client-side functions validation in <script>
  assert.match(html, /function onActivityTimeframeChange\(\)/);
  assert.match(html, /function setLeaderboardSort\(/);
  assert.match(html, /function renderLeaderboard\(/);
  assert.match(html, /function loadActivityView\(\)/);
  assert.match(html, /function loadActivityStats\(\)/);
  assert.match(html, /function renderActivityKPIs\(/);
  assert.match(html, /function renderDailyProcessedChart\(/);
  assert.match(html, /function renderProgressByStatus\(/);
  assert.match(html, /function renderTelemarketerActivitySummary\(/);
  assert.match(html, /function loadActivityLog\(/);
  assert.match(html, /function renderActivityLog\(/);
  assert.match(html, /function openMockDataModal\(\)/);
  assert.match(html, /function submitMockData\(/);
  assert.match(html, /function openResetProgressModal\(\)/);
  assert.match(html, /function submitResetProgress\(\)/);
  assert.match(html, /function openManualActivityModal\(\)/);
  assert.match(html, /function submitManualActivity\(/);

  // Script compiles with zero syntax errors
  const script = /<script>([\s\S]*)<\/script>/.exec(html)?.[1];
  assert.ok(script);
  assert.doesNotThrow(() => new Function(script));
});

test('reportdb exports lead activity and presentation management interfaces', () => {
  assert.equal(typeof db.recordLeadActivity, 'function');
  assert.equal(typeof db.getLeadActivityStats, 'function');
  assert.equal(typeof db.getTopTelemarketersLeaderboard, 'function');
  assert.equal(typeof db.listLeadActivities, 'function');
  assert.equal(typeof db.generateMockLeadData, 'function');
  assert.equal(typeof db.clearMockLeadProgress, 'function');
  assert.equal(typeof db.addManualLeadActivity, 'function');
});

test('generateMockLeadData strictly preserves real company contact data and only simulates progress', async () => {
  const previousFetch = globalThis.fetch;
  const previousEnv = {
    DATABASE_URL: process.env.DATABASE_URL,
    PG_PROXY_URL: process.env.PG_PROXY_URL,
    PG_DB_NAME: process.env.PG_DB_NAME,
    PG_PROXY_TOKEN: process.env.PG_PROXY_TOKEN,
  };
  process.env.DATABASE_URL = '';
  process.env.PG_PROXY_URL = 'http://fake-proxy';
  process.env.PG_DB_NAME = 'test';
  process.env.PG_PROXY_TOKEN = 'test';

  const realCompanies = [
    {
      id: 1001,
      name: 'Real Construction Sdn Bhd',
      phone: '012-3456789',
      address: '123 Jalan Ampang, Kuala Lumpur',
      category: 'Construction',
      website: 'https://realconstruction.com.my',
      maps_url: 'https://maps.google.com/?cid=12345',
      rating: 4.6,
      reviews: 42,
      lead_status: 'unassigned',
      assigned_to: null,
    },
    {
      id: 1002,
      name: 'Southern Logistics Enterprise',
      phone: '019-8765432',
      address: '45 Jalan Ros Merah, Johor Bahru',
      category: 'Logistics',
      website: 'https://southernlogistics.com',
      maps_url: 'https://maps.google.com/?cid=67890',
      rating: 4.8,
      reviews: 18,
      lead_status: 'unassigned',
      assigned_to: null,
    },
  ];

  const executedSql: { sql: string; params: any[] }[] = [];

  globalThis.fetch = async (_url, options) => {
    const { sql, params } = JSON.parse(String(options?.body));
    executedSql.push({ sql, params });

    // Handle migrations
    if (sql.includes('create table') || sql.includes('create index') || sql.includes('alter table')) {
      return Response.json({ rows: [], rowCount: 0 });
    }

    // Handle active telemarketer query
    if (sql.includes('from telemarketer where active = true')) {
      return Response.json({
        rows: [
          { name: 'Sarah Wong', uid: 'tm_sarah' },
          { name: 'Ahmad Faris', uid: 'tm_ahmad' },
        ],
        rowCount: 2,
      });
    }

    // Handle selecting companies for mock simulation
    if (sql.includes('from company_data') && sql.includes('limit $1')) {
      return Response.json({
        rows: realCompanies,
        rowCount: realCompanies.length,
      });
    }

    // Handle updating company lead status
    if (sql.startsWith('update company_data set')) {
      return Response.json({ rows: [], rowCount: 1 });
    }

    // Handle activity log inserts
    if (sql.includes('insert into lead_activity_log')) {
      return Response.json({ rows: [], rowCount: 1 });
    }

    // Handle reset delete / update
    if (sql.includes('delete from lead_activity_log') || sql.includes('update company_data set lead_status = \'unassigned\'')) {
      return Response.json({ rows: [], rowCount: 2 });
    }

    return Response.json({ rows: [], rowCount: 0 });
  };

  try {
    const result = await db.generateMockLeadData({
      leadCount: 2,
      daysSpan: 3,
      clearFirst: true,
    });

    assert.equal(result.ok, true);
    assert.equal(result.assignedCount, 2);
    assert.ok(result.activitiesCount >= 2);

    // Verify SQL commands:
    // 1. Ensure updates NEVER touched name, phone, address, website, maps_url, category, rating, reviews
    const updateStatements = executedSql.filter((item) => item.sql.startsWith('update company_data set'));
    for (const statement of updateStatements) {
      assert.doesNotMatch(statement.sql, /\bname\s*=/i, 'Must NEVER update real company name');
      assert.doesNotMatch(statement.sql, /\bphone\s*=/i, 'Must NEVER update real company phone');
      assert.doesNotMatch(statement.sql, /\baddress\s*=/i, 'Must NEVER update real company address');
      assert.doesNotMatch(statement.sql, /\bcategory\s*=/i, 'Must NEVER update real company category');
      assert.doesNotMatch(statement.sql, /\bwebsite\s*=/i, 'Must NEVER update real company website');
      assert.doesNotMatch(statement.sql, /\bmaps_url\s*=/i, 'Must NEVER update real company maps_url');
      assert.doesNotMatch(statement.sql, /\brating\s*=/i, 'Must NEVER update real company rating');
      assert.doesNotMatch(statement.sql, /\breviews\s*=/i, 'Must NEVER update real company reviews');

      // Must only update assignment and contact progress
      if (statement.sql.includes('where id = $7')) {
        assert.match(statement.sql, /assigned_to = \$1/);
        assert.match(statement.sql, /lead_status = \$4/);
        assert.match(statement.sql, /lead_notes = \$5/);
      }
    }

    // 2. Ensure clearMockLeadProgress only resets progress columns and clears log
    executedSql.length = 0;
    const clearResult = await db.clearMockLeadProgress();
    assert.equal(clearResult.ok, true);

    const resetSql = executedSql.find((item) => item.sql.includes('update company_data set') && item.sql.includes("'do_not_call'"));
    assert.ok(resetSql, 'Should have executed reset update on company_data');
    assert.match(resetSql.sql, /case when coalesce\(lead_status, 'unassigned'\) = 'do_not_call' then 'do_not_call' else 'unassigned' end/);
    assert.match(resetSql.sql, /assigned_to = null/);
    assert.match(resetSql.sql, /telemarketer_uid = null/);
    assert.doesNotMatch(resetSql.sql, /lead_notes\s*=/);
    // Again confirm real data is never wiped
    assert.doesNotMatch(resetSql.sql, /\bphone\s*=/i);
    assert.doesNotMatch(resetSql.sql, /\baddress\s*=/i);

    const deleteLogSql = executedSql.find((item) => item.sql.includes('delete from lead_activity_log'));
    assert.ok(deleteLogSql, 'Should have deleted from lead_activity_log');
  } finally {
    globalThis.fetch = previousFetch;
    process.env.DATABASE_URL = previousEnv.DATABASE_URL;
    process.env.PG_PROXY_URL = previousEnv.PG_PROXY_URL;
    process.env.PG_DB_NAME = previousEnv.PG_DB_NAME;
    process.env.PG_PROXY_TOKEN = previousEnv.PG_PROXY_TOKEN;
  }
});

test('Lead Activity API endpoints in intel.ts handle stats, logs, mock generation, reset, and recording', async () => {
  const previousFetch = globalThis.fetch;
  const previousEnv = {
    DATABASE_URL: process.env.DATABASE_URL,
    PG_PROXY_URL: process.env.PG_PROXY_URL,
    PG_DB_NAME: process.env.PG_DB_NAME,
    PG_PROXY_TOKEN: process.env.PG_PROXY_TOKEN,
  };
  process.env.DATABASE_URL = '';
  process.env.PG_PROXY_URL = 'http://fake-proxy';
  process.env.PG_DB_NAME = 'test';
  process.env.PG_PROXY_TOKEN = 'test';

  globalThis.fetch = async (_url, options) => {
    const { sql } = JSON.parse(String(options?.body));

    // Handle migrations
    if (sql.includes('create table') || sql.includes('create index') || sql.includes('alter table')) {
      return Response.json({ rows: [], rowCount: 0 });
    }

    if (sql.includes('from company_data c') && sql.includes('count(*) filter')) {
      return Response.json({
        rows: [
          {
            total_leads: '150',
            unassigned: '50',
            assigned: '30',
            contacted: '40',
            interested: '15',
            not_interested: '10',
            do_not_call: '5',
          },
        ],
        rowCount: 1,
      });
    }

    if (sql.includes('from lead_activity_log') && sql.includes('distinct_agents')) {
      return Response.json({
        rows: [
          {
            total_act: '70',
            today_act: '12',
            yesterday_act: '18',
            distinct_agents: '3',
          },
        ],
        rowCount: 1,
      });
    }

    if (sql.includes('from lead_activity_log') && (sql.includes('date_trunc') || sql.includes('to_char'))) {
      return Response.json({
        rows: [
          {
            day: '2026-09-24',
            total: '25',
            contacted: '10',
            interested: '5',
            not_interested: '6',
            do_not_call: '2',
            assigned: '2',
          },
        ],
        rowCount: 1,
      });
    }

    if (sql.includes('period_stats') || sql.includes('log_period') || (sql.includes('roster') && sql.includes('processed_count'))) {
      return Response.json({
        rows: [
          {
            name: 'Sarah Wong',
            uid: 'tm_sarah',
            total_assigned: '40',
            contacted_count: '15',
            interested_count: '8',
            not_interested_count: '9',
            dnc_count: '3',
            processed_count: '35',
            total_activities: '35',
            last_active: '2026-09-25T10:00:00Z',
          },
          {
            name: 'Ahmad Faris',
            uid: 'tm_ahmad',
            total_assigned: '30',
            contacted_count: '10',
            interested_count: '5',
            not_interested_count: '7',
            dnc_count: '2',
            processed_count: '24',
            total_activities: '24',
            last_active: '2026-09-25T09:00:00Z',
          },
          {
            name: 'Chloe Tan',
            uid: 'tm_chloe',
            total_assigned: '25',
            contacted_count: '8',
            interested_count: '3',
            not_interested_count: '5',
            dnc_count: '1',
            processed_count: '17',
            total_activities: '17',
            last_active: '2026-09-25T08:30:00Z',
          },
        ],
        rowCount: 3,
      });
    }

    if (sql.includes('from lead_activity_log') && sql.includes('telemarketer_name') && sql.includes('group by')) {
      return Response.json({
        rows: [
          {
            agent_name: 'Sarah Wong',
            agent_uid: 'tm_sarah',
            total_processed: '35',
            contacted: '15',
            interested: '8',
            not_interested: '9',
            do_not_call: '3',
            assigned_leads: '40',
            last_active: '2026-09-25T10:00:00Z',
          },
        ],
        rowCount: 1,
      });
    }

    if (sql.includes('from lead_activity_log l') && sql.includes('order by l.created_at desc')) {
      return Response.json({
        rows: [
          {
            id: 1,
            company_id: 101,
            company_name: 'Solar Corp',
            company_phone: '012-3456789',
            action: 'status_change',
            previous_status: 'assigned',
            new_status: 'interested',
            telemarketer_name: 'Sarah Wong',
            telemarketer_uid: 'tm_sarah',
            notes: 'Follow up next week',
            is_mock: false,
            created_at: '2026-09-25T10:00:00Z',
          },
        ],
        rowCount: 1,
      });
    }

    if (sql.includes('count(*)::text as cnt') && sql.includes('lead_activity_log')) {
      return Response.json({ rows: [{ cnt: '1' }], rowCount: 1 });
    }

    // Mock company select for generate / update
    if (sql.includes('from telemarketer where active = true')) {
      return Response.json({
        rows: [{ name: 'Sarah Wong', uid: 'tm_sarah' }],
        rowCount: 1,
      });
    }

    if (sql.includes('from company_data') && sql.includes('limit $1')) {
      return Response.json({
        rows: [{ id: 101, name: 'Solar Corp', category: 'Energy', phone: '012-3456789', address: 'JB' }],
        rowCount: 1,
      });
    }

    if (sql.startsWith('update company_data set')) {
      return Response.json({ rows: [{ id: 101, name: 'Solar Corp', lead_status: 'interested' }], rowCount: 1 });
    }

    if (sql.includes('delete from lead_activity_log') || sql.includes('update company_data set lead_status = \'unassigned\'')) {
      return Response.json({ rows: [], rowCount: 1 });
    }

    if (sql.includes('insert into lead_activity_log')) {
      return Response.json({
        rows: [{ id: 1, company_id: 101, new_status: 'interested', is_mock: false }],
        rowCount: 1,
      });
    }

    return Response.json({ rows: [], rowCount: 0 });
  };

  const makeCtx = (body: any = {}) => {
    let statusCode = 200;
    let responseBody: any = null;
    return {
      ctx: {
        json: (_res: any, code: number, data: any) => {
          statusCode = code;
          responseBody = data;
        },
        readJson: async () => body,
      },
      getStatus: () => statusCode,
      getBody: () => responseBody,
    };
  };

  try {
    // 1. GET /api/lead-activity/stats (with custom date range)
    {
      const req: any = { method: 'GET', headers: {} };
      const res: any = {};
      const url = new URL('http://localhost/api/lead-activity/stats?startDate=2026-09-01&endDate=2026-09-25&sortBy=interested');
      const { ctx, getStatus, getBody } = makeCtx();
      const handled = await handleApi(req, res, url, ctx as any);
      assert.equal(handled, true);
      assert.equal(getStatus(), 200);
      assert.equal(getBody().ok, true);
      assert.ok(getBody().stats);
      assert.ok(Array.isArray(getBody().stats.dailyLeadProcessed));
      assert.ok(Array.isArray(getBody().stats.progressByStatus));
      assert.ok(Array.isArray(getBody().stats.perTelemarketerSummary));
      assert.ok(Array.isArray(getBody().stats.topLeaders));
      assert.equal(getBody().stats.topLeaders.length, 3);
      assert.equal(getBody().stats.dateRange.startDate, '2026-09-01');
      assert.equal(getBody().stats.dateRange.endDate, '2026-09-25');
      assert.equal(getBody().stats.kpis.totalLeadsInPool, 150);
    }

    // 1b. GET /api/lead-activity/leaderboard (Top 10 Leaderboard)
    {
      const req: any = { method: 'GET', headers: {} };
      const res: any = {};
      const url = new URL('http://localhost/api/lead-activity/leaderboard?sortBy=interested&limit=10');
      const { ctx, getStatus, getBody } = makeCtx();
      const handled = await handleApi(req, res, url, ctx as any);
      assert.equal(handled, true);
      assert.equal(getStatus(), 200);
      assert.equal(getBody().ok, true);
      assert.equal(getBody().sortBy, 'interested');
      assert.ok(Array.isArray(getBody().leaders));
      assert.equal(getBody().leaders.length, 3);

      const top1 = getBody().leaders[0];
      assert.equal(top1.rank, 1);
      assert.equal(top1.name, 'Sarah Wong');
      assert.equal(top1.tier, 'champion');
      assert.equal(top1.tier_label, '🥇 Champion');
      assert.equal(top1.interested, 8);

      const top2 = getBody().leaders[1];
      assert.equal(top2.rank, 2);
      assert.equal(top2.name, 'Ahmad Faris');
      assert.equal(top2.tier, 'top_performer');
      assert.equal(top2.tier_label, '🥈 2nd Place');

      const top3 = getBody().leaders[2];
      assert.equal(top3.rank, 3);
      assert.equal(top3.name, 'Chloe Tan');
      assert.equal(top3.tier, 'top_performer');
      assert.equal(top3.tier_label, '🥉 3rd Place');
    }

    // 2. GET /api/lead-activity/log
    {
      const req: any = { method: 'GET', headers: {} };
      const res: any = {};
      const url = new URL('http://localhost/api/lead-activity/log?limit=10&status=interested');
      const { ctx, getStatus, getBody } = makeCtx();
      const handled = await handleApi(req, res, url, ctx as any);
      assert.equal(handled, true);
      assert.equal(getStatus(), 200);
      assert.equal(getBody().ok, true);
      assert.equal(getBody().total, 1);
      assert.equal(getBody().activities[0].company_name, 'Solar Corp');
      assert.equal(getBody().activities[0].new_status, 'interested');
    }

    // 3. POST /api/lead-activity/mock-generate
    {
      const req: any = { method: 'POST', headers: {} };
      const res: any = {};
      const url = new URL('http://localhost/api/lead-activity/mock-generate');
      const { ctx, getStatus, getBody } = makeCtx({ count: 10, days: 5 });
      const handled = await handleApi(req, res, url, ctx as any);
      assert.equal(handled, true);
      assert.equal(getStatus(), 200);
      assert.equal(getBody().ok, true);
    }

    // 4. POST /api/lead-activity/reset-progress
    {
      const req: any = { method: 'POST', headers: {} };
      const res: any = {};
      const url = new URL('http://localhost/api/lead-activity/reset-progress');
      const { ctx, getStatus, getBody } = makeCtx();
      const handled = await handleApi(req, res, url, ctx as any);
      assert.equal(handled, true);
      assert.equal(getStatus(), 200);
      assert.equal(getBody().ok, true);
    }

    // 5. POST /api/lead-activity/record (validation error)
    {
      const req: any = { method: 'POST', headers: {} };
      const res: any = {};
      const url = new URL('http://localhost/api/lead-activity/record');
      const { ctx, getStatus, getBody } = makeCtx({ notes: 'missing company and status' });
      const handled = await handleApi(req, res, url, ctx as any);
      assert.equal(handled, true);
      assert.equal(getStatus(), 400);
      assert.match(getBody().error, /companyId and status are required/i);
    }

    // 6. POST /api/lead-activity/record (success)
    {
      const req: any = { method: 'POST', headers: {} };
      const res: any = {};
      const url = new URL('http://localhost/api/lead-activity/record');
      const { ctx, getStatus, getBody } = makeCtx({
        companyId: 101,
        status: 'interested',
        telemarketer: 'Sarah Wong',
        notes: 'Director requested quotation.',
      });
      const handled = await handleApi(req, res, url, ctx as any);
      assert.equal(handled, true);
      assert.equal(getStatus(), 200);
      assert.equal(getBody().ok, true);
    }
  } finally {
    globalThis.fetch = previousFetch;
    process.env.DATABASE_URL = previousEnv.DATABASE_URL;
    process.env.PG_PROXY_URL = previousEnv.PG_PROXY_URL;
    process.env.PG_DB_NAME = previousEnv.PG_DB_NAME;
    process.env.PG_PROXY_TOKEN = previousEnv.PG_PROXY_TOKEN;
  }
});

test('getTopTelemarketersLeaderboard calculates date-bounded metrics, win rates, and ranks', async () => {
  const previousFetch = globalThis.fetch;
  const previousEnv = {
    DATABASE_URL: process.env.DATABASE_URL,
    PG_PROXY_URL: process.env.PG_PROXY_URL,
    PG_DB_NAME: process.env.PG_DB_NAME,
    PG_PROXY_TOKEN: process.env.PG_PROXY_TOKEN,
  };
  process.env.DATABASE_URL = '';
  process.env.PG_PROXY_URL = 'http://fake-proxy';
  process.env.PG_DB_NAME = 'test';
  process.env.PG_PROXY_TOKEN = 'test';

  globalThis.fetch = async (_url, options) => {
    const { sql } = JSON.parse(String(options?.body));

    if (sql.includes('create table') || sql.includes('create index') || sql.includes('alter table')) {
      return Response.json({ rows: [], rowCount: 0 });
    }

    if (sql.includes('period_stats') || sql.includes('log_period') || (sql.includes('roster') && sql.includes('contacted_count'))) {
      return Response.json({
        rows: [
          {
            name: 'Agent Fast',
            uid: 'tm_fast',
            total_assigned: '50',
            contacted_count: '20',
            interested_count: '2',
            not_interested_count: '15',
            dnc_count: '5',
            processed_count: '42',
            total_activities: '42',
            last_active: '2026-09-20T12:00:00Z',
          },
          {
            name: 'Agent Closer',
            uid: 'tm_closer',
            total_assigned: '20',
            contacted_count: '5',
            interested_count: '10',
            not_interested_count: '2',
            dnc_count: '1',
            processed_count: '18',
            total_activities: '18',
            last_active: '2026-09-20T11:00:00Z',
          },
          {
            name: 'Agent Solid',
            uid: 'tm_solid',
            total_assigned: '35',
            contacted_count: '12',
            interested_count: '6',
            not_interested_count: '8',
            dnc_count: '2',
            processed_count: '28',
            total_activities: '28',
            last_active: '2026-09-20T10:00:00Z',
          },
        ],
        rowCount: 3,
      });
    }

    return Response.json({ rows: [], rowCount: 0 });
  };

  try {
    // 1. Sort by default (interested / won deals)
    const resWon = await db.getTopTelemarketersLeaderboard({
      startDate: '2026-09-10',
      endDate: '2026-09-20',
      sortBy: 'interested',
      limit: 10,
    });

    assert.equal(resWon.ok, true);
    assert.equal(resWon.dateRange.startDate, '2026-09-10');
    assert.equal(resWon.dateRange.endDate, '2026-09-20');
    assert.equal(resWon.leaders.length, 3);

    // Agent Closer has 10 interested -> Rank 1 (Champion)
    assert.equal(resWon.leaders[0].name, 'Agent Closer');
    assert.equal(resWon.leaders[0].rank, 1);
    assert.equal(resWon.leaders[0].tier, 'champion');
    assert.equal(resWon.leaders[0].tier_label, '🥇 Champion');
    assert.equal(resWon.leaders[0].conversion_rate, Math.round((10 / 18) * 1000) / 10);

    // Agent Solid has 6 interested -> Rank 2 (2nd Place)
    assert.equal(resWon.leaders[1].name, 'Agent Solid');
    assert.equal(resWon.leaders[1].rank, 2);
    assert.equal(resWon.leaders[1].tier, 'top_performer');

    // Agent Fast has 2 interested -> Rank 3 (3rd Place)
    assert.equal(resWon.leaders[2].name, 'Agent Fast');
    assert.equal(resWon.leaders[2].rank, 3);
    assert.equal(resWon.leaders[2].tier, 'top_performer');

    // 2. Sort by call volume (processed)
    const resProcessed = await db.getTopTelemarketersLeaderboard({
      days: 7,
      sortBy: 'processed',
    });
    assert.equal(resProcessed.leaders[0].name, 'Agent Fast');
    assert.equal(resProcessed.leaders[0].total_processed, 42);

    // 3. Sort by conversion rate %
    const resConv = await db.getTopTelemarketersLeaderboard({
      days: 7,
      sortBy: 'conversion',
    });
    assert.equal(resConv.leaders[0].name, 'Agent Closer');
    assert.ok(resConv.leaders[0].conversion_rate > resConv.leaders[1].conversion_rate);
  } finally {
    globalThis.fetch = previousFetch;
    process.env.DATABASE_URL = previousEnv.DATABASE_URL;
    process.env.PG_PROXY_URL = previousEnv.PG_PROXY_URL;
    process.env.PG_DB_NAME = previousEnv.PG_DB_NAME;
    process.env.PG_PROXY_TOKEN = previousEnv.PG_PROXY_TOKEN;
  }
});

