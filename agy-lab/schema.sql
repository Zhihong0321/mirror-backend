-- gmap-recon storage. Verified against the live pg_2nd database, not written
-- from memory: every column, constraint and index below was read back out of
-- information_schema after the tables were created.
--
-- Apply it through the pg-proxy (or psql) against an empty database:
--   POST /api/sql  {"db_name":"pg_2nd","sql":"<this file>","params":[]}
-- Every statement is IF NOT EXISTS, so re-running it is safe.
--
-- WHY THIS FILE EXISTS. The tables were originally created by an ad-hoc script.
-- That meant the only description of the schema lived in a terminal that had
-- already scrolled away, and a wiped database would have had no way back. This
-- is the recreate path.

-- Companies found by a scan. One row per business, not one per sighting: the
-- same shop turns up in many searches and must not be copied each time.
create table if not exists company_data (
  id            bigserial primary key,
  -- Google's own id for the place, parsed out of the maps URL. This is the
  -- dedup key; without it a town rescanned weekly grows a duplicate set a week.
  place_id      text unique,
  name          text not null,
  rating        numeric(2,1),
  -- Null when Maps served a signed-out "limited view", which omits review
  -- counts entirely. Null here is missing data, never zero reviews.
  reviews       integer,
  category      text,
  address       text,
  phone         text,
  website       text,
  maps_url      text,
  source        text not null default 'gmap',
  first_seen_at timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  -- Lead distribution & telemarketer assignment
  lead_status   text not null default 'unassigned'
                  check (lead_status in ('unassigned', 'assigned', 'contacted', 'interested', 'not_interested', 'do_not_call')),
  assigned_to   text,
  assigned_at   timestamptz,
  lead_notes    text,
  is_hidden     boolean not null default false,
  lead_updated_at timestamptz not null default now()
);
create index if not exists company_data_name_idx  on company_data (lower(name));
create index if not exists company_data_phone_idx on company_data (phone);
create index if not exists company_data_lead_status_idx on company_data (lead_status);
create index if not exists company_data_assigned_to_idx on company_data (assigned_to);
create index if not exists company_data_is_hidden_idx on company_data (is_hidden);

-- Telemarketer roster for lead assignment
create table if not exists telemarketer (
  id         serial primary key,
  name       text not null unique,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

-- Inbound solar customer registrations from Google Ads & landing page forms.
create table if not exists atap_solar_registrations (
  id                serial primary key,
  lead_id           varchar(50) not null,
  full_name         varchar(255),
  phone_number      varchar(50),
  tnb_account_no    varchar(50),
  area              varchar(255) not null,
  state             varchar(100) not null,
  property_type     varchar(100) default 'Residential',
  monthly_bill      numeric(10, 2),
  email             varchar(255),
  roof_type         varchar(100),
  system_size       varchar(50),
  estimated_savings varchar(100),
  source            text,
  utm_source        text,
  utm_medium        text,
  utm_campaign      text,
  notes             text,
  raw_data          jsonb,
  created_at        timestamptz default current_timestamp,
  lead_status       text not null default 'unassigned',
  assigned_to       text,
  telemarketer_uid  text,
  assigned_at       timestamptz,
  lead_notes        text,
  lead_updated_at   timestamptz default now(),
  is_hidden         boolean not null default false
);
create index if not exists atap_reg_lead_id_idx          on atap_solar_registrations (lead_id);
create index if not exists atap_reg_lead_status_idx      on atap_solar_registrations (lead_status);
create index if not exists atap_reg_assigned_to_idx      on atap_solar_registrations (assigned_to);
create index if not exists atap_reg_telemarketer_uid_idx on atap_solar_registrations (telemarketer_uid);
create index if not exists atap_reg_created_at_idx       on atap_solar_registrations (created_at desc);
create index if not exists atap_reg_source_idx           on atap_solar_registrations (source);
create index if not exists atap_reg_state_idx            on atap_solar_registrations (state);


-- People attached to a company. Created and indexed now; the research chain
-- (Phase 3) is what fills it. Nothing writes this table yet.
create table if not exists person_data (
  id         bigserial primary key,
  company_id bigint references company_data(id) on delete cascade,
  name       text,
  position   text,
  phone      text,
  email      text,
  address    text,
  -- jsonb rather than a column per network: a contact may have several, and
  -- which networks matter is not settled yet.
  messenger  jsonb,
  source     text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists person_data_company_idx on person_data (company_id);
create index if not exists person_data_email_idx   on person_data (lower(email));

-- One row per search a user ran.
create table if not exists search_report (
  id             bigserial primary key,
  -- Who asked. Nullable on purpose: the column is recorded now and populated
  -- later, so the history is not lost when user accounts do arrive.
  user_id        text,
  keyword        text not null,
  place          text,
  query          text not null,
  -- Null when the scan was blocked. See the constraint below — this is the
  -- single most important rule in the system.
  found          integer,
  blocked        boolean not null default false,
  blocked_reason text,
  capped         boolean not null default false,
  -- Maps serves a reduced page to signed-out sessions. Not a block by itself,
  -- but it is what separates two runs that otherwise look identical.
  limited_view   boolean,
  job_id         text,
  worker         text,
  took_ms        integer,
  created_at     timestamptz not null default now(),
  -- Google degrades rather than errors: a throttled search returns an empty or
  -- thin feed with no captcha and no error. Recording that as found = 0 writes
  -- a claim about the town that nothing downstream can tell from the truth, and
  -- afterwards a throttled town is indistinguishable from an empty one. So a
  -- blocked scan carries no count at all, and the database refuses one.
  constraint blocked_scan_has_no_count check (not blocked or found is null)
);
create index if not exists search_report_keyword_idx on search_report (lower(keyword), lower(coalesce(place, '')));
create index if not exists search_report_user_idx    on search_report (user_id);

-- Which companies a given search returned, and where they sat in the feed.
-- Many-to-many because a company appears in many searches over time; `rank` is
-- the feed position, the only ranking signal a scan actually observes.
create table if not exists search_report_company (
  report_id  bigint not null references search_report(id) on delete cascade,
  company_id bigint not null references company_data(id)  on delete cascade,
  rank       integer,
  primary key (report_id, company_id)
);
create index if not exists srcompany_company_idx on search_report_company (company_id);

comment on column search_report.user_id is 'Who asked for the scan. Nullable on purpose: the column is recorded now, populated later.';
comment on column search_report.found is 'Null when blocked. A soft-blocked scan is never written as 0 - see the blocked_scan_has_no_count constraint.';
comment on column company_data.reviews is 'Null when Maps served a signed-out limited view, which omits review counts. Null is missing data, not zero reviews.';

-- A stable public shell around either report workflow. The opaque public id is
-- the share token: report pages do not expose the API bearer token and cannot be
-- enumerated by sequential database ids.
create table if not exists published_report (
  id                      bigserial primary key,
  public_id               text not null unique,
  report_type             text not null check (report_type in ('business_search', 'company_research', 'person_research', 'ads_research', 'ads_market', 'contact_research')),
  status                  text not null default 'queued'
                                  check (status in ('queued', 'running', 'completed', 'partial', 'failed')),
  title                   text,
  user_id                 text,
  request                 jsonb not null default '{}'::jsonb,
  source_search_report_id bigint references search_report(id) on delete set null,
  company_id              bigint references company_data(id) on delete set null,
  job_id                  text,
  result                  jsonb,
  error                   text,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  completed_at            timestamptz
);
create index if not exists published_report_type_idx on published_report (report_type, created_at desc);
create index if not exists published_report_user_idx on published_report (user_id, created_at desc);
create index if not exists published_report_search_idx on published_report (source_search_report_id);
create index if not exists published_report_company_idx on published_report (company_id);
create unique index if not exists published_report_auto_person_unique_idx
  on published_report ((request->>'sourceReportId'), (request->>'personId'))
  where report_type = 'person_research' and request->>'autoTriggered' = 'true';

-- Every model round is retained independently for benchmarking. Each round is
-- JSON rather than text so it can carry raw output, parsed fields, validation
-- errors, model metadata and timing without adding a column for every detail.
-- The stable round01..round04 column identities are intentional requirements.
create table if not exists company_research_run (
  report_id        bigint primary key references published_report(id) on delete cascade,
  round01          jsonb,
  round02          jsonb,
  round03          jsonb,
  round04          jsonb,
  validated_ledger jsonb,
  final_report     jsonb,
  -- The English final_report is canonical. This holds the separate zh-CN
  -- rendering, preserving source URLs, identifiers and contact values exactly.
  translated_report jsonb,
  translation_metadata jsonb not null default '{}'::jsonb,
  round_status     jsonb not null default '{}'::jsonb,
  engine_metadata  jsonb not null default '{}'::jsonb,
  started_at       timestamptz,
  completed_at     timestamptz,
  updated_at       timestamptz not null default now()
);

create table if not exists person_research_run (
  report_id        bigint primary key references published_report(id) on delete cascade,
  discovery        jsonb,
  synthesis        jsonb,
  validated_ledger jsonb,
  final_report     jsonb,
  run_status       jsonb not null default '{}'::jsonb,
  engine_metadata  jsonb not null default '{}'::jsonb,
  started_at       timestamptz,
  completed_at     timestamptz,
  updated_at       timestamptz not null default now()
);

-- Fast telemarketing contact & decision-maker research run.
create table if not exists contact_research_run (
  report_id        bigint primary key references published_report(id) on delete cascade,
  discovery        jsonb,
  ledger           jsonb,
  final_report     jsonb,
  run_status       jsonb not null default '{}'::jsonb,
  engine_metadata  jsonb not null default '{}'::jsonb,
  started_at       timestamptz,
  completed_at     timestamptz,
  updated_at       timestamptz not null default now()
);

comment on column published_report.public_id is 'Opaque share id used by the public /r/:id report URL.';
comment on column company_research_run.round01 is 'Raw and parsed Gemini discovery artifact.';
comment on column company_research_run.round02 is 'Raw and parsed ChatGPT audit artifacts, split by contacts/people/signals.';
comment on column company_research_run.round03 is 'Facebook evidence from the read-only fb-recon crawler: access_mode, the raw fb.company / fb.discover envelopes, and the ledger rows built from them.';
comment on column company_research_run.round04 is 'Raw final Gemini synthesis plus fidelity validation.';
comment on column person_research_run.discovery is 'Validated public-professional evidence discovered across primary web, Facebook/Instagram/Threads, and xAI/X lanes for the VIP brief; caller-supplied email and mobile identity resolvers are never retained.';
comment on column person_research_run.synthesis is 'Final-synthesis acceptance metadata; raw model text is intentionally not retained.';
comment on column company_research_run.translated_report is 'Chinese (zh-CN) translation of final_report. URLs, IDs and contact values remain canonical.';

-- ---------------------------------------------------------------- ads
-- These two were previously only in reportdb.ts's migrate(), so this file --
-- which calls itself the recreate path -- could not actually recreate the
-- database. Added here so a wiped database has a way back for all of it.

-- One COMPANY's live ads, across Facebook and Google.
create table if not exists ads_research_run (
  report_id       bigint primary key references published_report(id) on delete cascade,
  facebook        jsonb,
  google          jsonb,
  ads             jsonb,
  final_report    jsonb,
  run_status      jsonb not null default '{}'::jsonb,
  engine_metadata jsonb not null default '{}'::jsonb,
  started_at      timestamptz,
  completed_at    timestamptz,
  updated_at      timestamptz not null default now()
);

-- One MARKET, from a product keyword: many advertisers, Facebook only. The
-- Google Ads Transparency Center has no keyword search of ad content -- only
-- advertiser and website lookup -- so there is no Google half to store here.
create table if not exists ads_market_run (
  report_id        bigint primary key references published_report(id) on delete cascade,
  -- Plural even though the form takes one product keyword: the crawler fetches
  -- keywords concurrently and expanding a term into variants is the obvious next
  -- step. A single text column would need a migration the first time that happens.
  keywords         text[] not null default '{}',
  region           text not null default 'MY',
  -- Per keyword: pages, ads, whether the cap bit, errors, timings. Before any
  -- interpretation, so a thin report can be told from a thin market.
  fetch_stats      jsonb,
  -- The deterministic rollup the report was written from. Every number in
  -- report_md comes from here, which is what makes the report auditable and lets
  -- the report page draw its tables without calling a model again.
  digest           jsonb,
  report_md        text,
  report_engine    text,
  report_model     text,
  -- Promoted out of digest so the library sorts and filters without parsing
  -- jsonb, and so a truncated run is visible in a LIST rather than only after
  -- somebody opens it.
  ads_total        integer,
  ads_on_topic     integer,
  advertisers      integer,
  unique_creatives integer,
  truncated        boolean not null default false,
  run_status       jsonb not null default '{}'::jsonb,
  engine_metadata  jsonb not null default '{}'::jsonb,
  started_at       timestamptz,
  completed_at     timestamptz,
  updated_at       timestamptz not null default now(),
  -- Same rule as search_report.blocked_scan_has_no_count: a run that claims it
  -- finished must carry the counts that say what it covered.
  constraint ads_market_completed_has_counts
    check (completed_at is null or ads_total is not null)
);
create index if not exists ads_market_run_keywords_idx on ads_market_run using gin (keywords);

-- There is deliberately NO spend, impressions or reach column. Measured over 672
-- ads on 2026-08-25: all three are null on 100% of Malaysian commercial ads --
-- they carry data only for political and issue ads under disclosure mandates. A
-- nullable column is an invitation to read null as zero later; a column that does
-- not exist cannot be misread.
comment on column ads_market_run.ads_on_topic is 'Ads whose own copy contains the topic terms. Facebook keyword_unordered matches loosely (98 of 576 measured), so this, not ads_total, is the real market size.';
comment on column ads_market_run.truncated is 'A per-keyword page cap was hit, so more ads exist than were captured. Surfaced at list level because a capped run must never read as a complete market.';
comment on column ads_market_run.digest is 'The SQL rollup the report was written from: totals, advertiser table, multi-Page networks, CTA/platform/domain distributions and the ad copy sample.';
