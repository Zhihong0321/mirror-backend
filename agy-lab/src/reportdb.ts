// Durable storage for published search and company-intelligence reports.
//
// Railway should provide DATABASE_URL by linking the Postgres service. The HTTP
// pg-proxy remains a supported fallback for the existing deployment, but its
// bearer is short-lived and therefore not the preferred production path.
import crypto from 'node:crypto';
import pg from 'pg';
import { blacklistReason } from './lead-blacklist.ts';

const { Pool } = pg;

export interface QueryResult<T = Record<string, unknown>> {
  rows: T[];
  rowCount: number | null;
}

let pool: InstanceType<typeof Pool> | null = null;
let migrated: Promise<void> | null = null;

function directConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL?.trim());
}

function proxyConfigured(): boolean {
  return Boolean(process.env.PG_PROXY_URL?.trim() && process.env.PG_DB_NAME?.trim() && process.env.PG_PROXY_TOKEN?.trim());
}

export function configured(): boolean {
  return directConfigured() || proxyConfigured();
}

function directPool(): InstanceType<typeof Pool> {
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: Number(process.env.REPORT_DB_POOL_MAX ?? 4),
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
    });
  }
  return pool;
}

/**
 * Stringify a value for a ::jsonb parameter, with lone surrogates repaired.
 *
 * Postgres REJECTS a lone surrogate in json. JSON.stringify escapes one as
 * "\ud83c", which is legal JSON syntax and illegal json data, and the error that
 * comes back is the bare "invalid input syntax for type json" -- naming no column,
 * no value and no row.
 *
 * They arrive from any pipeline that slices scraped text at a fixed length: an
 * emoji is a surrogate PAIR, so `body.slice(0, 420)` can cut one in half. Measured
 * on one 576-ad capture: 20 slices ended on a split emoji. It is invisible in
 * testing because writing a lone surrogate to a UTF-8 file silently replaces it --
 * only the database ever sees the broken half.
 *
 * toWellFormed() replaces each with U+FFFD. Applied through a replacer so it
 * reaches every nested string, not just the top level.
 */
const jsonParam = (value: unknown): string =>
  JSON.stringify(value ?? null, (_k, v) => (typeof v === 'string' ? v.toWellFormed() : v)) ?? 'null';

export async function sql<T = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<QueryResult<T>> {
  if (directConfigured()) {
    const out = await directPool().query(text, params);
    return { rows: out.rows as T[], rowCount: out.rowCount };
  }
  if (!proxyConfigured()) {
    throw new Error('report database is not configured; link DATABASE_URL or set PG_PROXY_URL, PG_DB_NAME and PG_PROXY_TOKEN');
  }
  const base = process.env.PG_PROXY_URL!.replace(/\/+$/, '');
  const response = await fetch(base + '/api/sql', {
    method: 'POST',
    headers: {
      authorization: 'Bearer ' + process.env.PG_PROXY_TOKEN,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ db_name: process.env.PG_DB_NAME, sql: text, params }),
    signal: AbortSignal.timeout(30_000),
  });
  const body = await response.text();
  if (!response.ok) throw new Error('pg-proxy ' + response.status + ': ' + body.slice(0, 300));
  const out = JSON.parse(body) as QueryResult<T>;
  return { rows: out.rows ?? [], rowCount: out.rowCount ?? out.rows?.length ?? 0 };
}

/**
 * The company-identity rule, in SQL, kept as constants for two reasons.
 *
 * One: worker/db.mjs implements the same rule in JavaScript and the two must not
 * drift — placeKey() there, these two here.
 *
 * Two: NO BACKSLASHES. An earlier version of this migration spelled the regexes
 * `\s+` and `(^|\s)` inside a JS template literal, where `\s` is not an escape
 * sequence and collapses to a bare `s`. Postgres received `'s+'` and `'(^|s)'`,
 * matched nothing, and every merge statement silently updated zero rows. POSIX
 * classes say the same thing with no character a template literal can eat.
 */
const nameKeySql = (col = 'name') =>
  "regexp_replace(regexp_replace(lower(btrim(" + col + ")), '[.,''\"`]', '', 'g'), '[[:space:]]+', ' ', 'g')";
export const NAME_KEY_SQL = nameKeySql();

/** Suffixes a company registry issues. A storefront name carries none of them. */
export const REGISTERED_SQL =
  "~* '(^|[[:space:]])(sdn[[:space:]]*bhd|sendirian[[:space:]]+berhad|berhad|bhd|plt|llp|pte[[:space:]]*ltd|ltd|limited|inc|incorporated|corp|corporation|gmbh|pty)$'";

export type GeminiKeyKind = 'grounding' | 'official' | 'tavily' | 'exa' | 'exa_proxy' | 'brave' | 'minimax' | 'scraper_tech' | 'parallel' | 'smartlead' | 'pagespeed';
const KEY_KINDS: readonly string[] = ['grounding', 'official', 'tavily', 'exa', 'exa_proxy', 'brave', 'minimax', 'scraper_tech', 'parallel', 'smartlead', 'pagespeed'];

export async function listGeminiContactKeys(): Promise<Array<{ id: number; kind: GeminiKeyKind; secret: string }>> {
  await migrate();
  const out = await sql(`select id, kind, secret from gemini_contact_key order by kind, id`);
  return out.rows.map((row) => ({
    id: Number(row.id),
    kind: (KEY_KINDS.includes(row.kind) ? row.kind : 'grounding') as GeminiKeyKind,
    secret: String(row.secret ?? ''),
  }));
}

export async function replaceGeminiContactKeys(kind: GeminiKeyKind, secrets: string[]): Promise<void> {
  await migrate();
  const clean = [...new Set(secrets.map((secret) => secret.trim()).filter((secret) => secret.length >= 10))];
  await sql(`delete from gemini_contact_key where kind = $1`, [kind]);
  for (const secret of clean) {
    await sql(`insert into gemini_contact_key (kind, secret) values ($1, $2) on conflict (kind, secret) do nothing`, [kind, secret]);
  }
}

export type ProviderStats = {
  provider: string; jobs: number; withPhone: number; withPerson: number; withEmail: number;
  phones: number; people: number; emails: number;
};

/**
 * How much each search provider dug up, over the last `days`. A job counts under
 * the provider that ran its general searches; found_by says whose search page
 * each contact came from ('page' for the website or map pin we opened ourselves).
 */
export async function contactProviderStats(days: number): Promise<{
  providers: ProviderStats[];
  foundBy: Array<{ kind: string; foundBy: string; count: number }>;
}> {
  await migrate();
  const recent = `with r as (
      select r.discovery d from contact_research_run r join published_report p on p.id = r.report_id
      where p.report_type = 'contact_research' and r.updated_at > now() - make_interval(days => $1::int)
        and r.discovery->'research_meta'->>'general_provider' is not null)`;
  const providers = await sql(`${recent}
    select d->'research_meta'->>'general_provider' as provider,
      count(*)::int as jobs,
      count(*) filter (where exists (select 1 from jsonb_array_elements(coalesce(d->'phone_contacts', '[]')) e
        where coalesce(e->>'label', '') !~* 'google maps'))::int as with_phone,
      count(*) filter (where jsonb_array_length(coalesce(d->'decision_makers', '[]')) > 0)::int as with_person,
      count(*) filter (where jsonb_array_length(coalesce(d->'email_contacts', '[]')) > 0)::int as with_email,
      coalesce(sum(jsonb_array_length(coalesce(d->'phone_contacts', '[]'))), 0)::int as phones,
      coalesce(sum(jsonb_array_length(coalesce(d->'decision_makers', '[]'))), 0)::int as people,
      coalesce(sum(jsonb_array_length(coalesce(d->'email_contacts', '[]'))), 0)::int as emails
    from r group by 1 order by 1`, [Math.max(1, Math.floor(days))]);
  const foundBy = await sql(`${recent}
    select x.kind, coalesce(x.e->>'found_by', 'page') as found_by, count(*)::int as n
    from r cross join lateral (
      select 'phone' as kind, e from jsonb_array_elements(coalesce(r.d->'phone_contacts', '[]')) e
      union all select 'email', e from jsonb_array_elements(coalesce(r.d->'email_contacts', '[]')) e
      union all select 'person', e from jsonb_array_elements(coalesce(r.d->'decision_makers', '[]')) e
    ) x
    group by 1, 2 order by 1, 2`, [Math.max(1, Math.floor(days))]);
  return {
    providers: providers.rows.map((row) => ({
      provider: String(row.provider), jobs: Number(row.jobs), withPhone: Number(row.with_phone),
      withPerson: Number(row.with_person), withEmail: Number(row.with_email),
      phones: Number(row.phones), people: Number(row.people), emails: Number(row.emails),
    })),
    foundBy: foundBy.rows.map((row) => ({ kind: String(row.kind), foundBy: String(row.found_by), count: Number(row.n) })),
  };
}

/** Apply only the report-owned schema. The historical core schema remains in schema.sql. */
export function migrate(): Promise<void> {
  if (migrated) return migrated;
  migrated = (async () => {
    await sql(`
      create table if not exists gemini_contact_key (
        id bigserial primary key,
        kind text not null,
        secret text not null,
        created_at timestamptz not null default now(),
        unique (kind, secret)
      );
    `);
    await sql(`alter table gemini_contact_key drop constraint if exists gemini_contact_key_kind_check;`).catch(() => {});
    await sql(`alter table gemini_contact_key add constraint gemini_contact_key_kind_check check (kind in ('grounding', 'official', 'tavily', 'exa', 'exa_proxy', 'brave', 'minimax', 'scraper_tech', 'parallel', 'smartlead', 'pagespeed'));`).catch(() => {});
    await sql(`
      create table if not exists published_report (
        id bigserial primary key,
        public_id text not null unique,
        report_type text not null check (report_type in ('business_search', 'company_research', 'person_research', 'ads_research', 'ads_market', 'contact_research')),
        status text not null default 'queued'
          check (status in ('queued', 'running', 'completed', 'partial', 'failed')),
        title text,
        user_id text,
        request jsonb not null default '{}'::jsonb,
        source_search_report_id bigint references search_report(id) on delete set null,
        company_id bigint references company_data(id) on delete set null,
        job_id text,
        result jsonb,
        error text,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        completed_at timestamptz
      );
      create index if not exists published_report_type_idx on published_report (report_type, created_at desc);
      create index if not exists published_report_user_idx on published_report (user_id, created_at desc);
      create index if not exists published_report_search_idx on published_report (source_search_report_id);
      create index if not exists published_report_company_idx on published_report (company_id);
      create unique index if not exists published_report_auto_person_unique_idx
        on published_report ((request->>'sourceReportId'), (request->>'personId'))
        where report_type = 'person_research' and request->>'autoTriggered' = 'true';
      alter table published_report drop constraint if exists published_report_report_type_check;
      alter table published_report add constraint published_report_report_type_check
        check (report_type in ('business_search', 'company_research', 'person_research', 'ads_research', 'ads_market', 'contact_research'));
      create table if not exists company_research_run (
        report_id bigint primary key references published_report(id) on delete cascade,
        round01 jsonb,
        round02 jsonb,
        round03 jsonb,
        round04 jsonb,
        validated_ledger jsonb,
        final_report jsonb,
        translated_report jsonb,
        translation_metadata jsonb not null default '{}'::jsonb,
        round_status jsonb not null default '{}'::jsonb,
        engine_metadata jsonb not null default '{}'::jsonb,
        started_at timestamptz,
        completed_at timestamptz,
        updated_at timestamptz not null default now()
      );
      create table if not exists person_research_run (
        report_id bigint primary key references published_report(id) on delete cascade,
        discovery jsonb,
        synthesis jsonb,
        validated_ledger jsonb,
        final_report jsonb,
        run_status jsonb not null default '{}'::jsonb,
        engine_metadata jsonb not null default '{}'::jsonb,
        started_at timestamptz,
        completed_at timestamptz,
        updated_at timestamptz not null default now()
      );
      create table if not exists contact_research_run (
        report_id bigint primary key references published_report(id) on delete cascade,
        discovery jsonb,
        ledger jsonb,
        final_report jsonb,
        run_status jsonb not null default '{}'::jsonb,
        engine_metadata jsonb not null default '{}'::jsonb,
        started_at timestamptz,
        completed_at timestamptz,
        updated_at timestamptz not null default now()
      );
      create table if not exists ads_research_run (
        report_id bigint primary key references published_report(id) on delete cascade,
        facebook jsonb,
        google jsonb,
        ads jsonb,
        final_report jsonb,
        run_status jsonb not null default '{}'::jsonb,
        engine_metadata jsonb not null default '{}'::jsonb,
        started_at timestamptz,
        completed_at timestamptz,
        updated_at timestamptz not null default now()
      );
    `);
    // Keyword MARKET research, which is a different question from ads_research
    // above. That one is one COMPANY across two networks; this is one MARKET
    // across many advertisers, Facebook only -- the Google Ads Transparency
    // Center has no keyword search of ad content, only advertiser and website
    // lookup, so there is no Google half to store.
    await sql(`
      create table if not exists ads_market_run (
        report_id bigint primary key references published_report(id) on delete cascade,
        -- Plural even though the form takes one product keyword: the crawler
        -- fetches keywords concurrently and expanding one term into variants is
        -- the obvious next step. A single text column would need a migration the
        -- first time that happens.
        keywords text[] not null default '{}',
        region text not null default 'MY',
        -- What the fetch actually got, per keyword, before any interpretation:
        -- pages, ads, whether the cap bit, errors, timings.
        fetch_stats jsonb,
        -- The deterministic SQL rollup the report was written from. Every number
        -- in report_md comes from here, so keeping it is what makes the report
        -- auditable and lets the report page draw its tables without a model.
        digest jsonb,
        report_md text,
        -- The finished teardown page: one self-contained HTML document, inline
        -- styles, no assets but Google Fonts. Stored here so /r/:id can serve it
        -- directly rather than standing up a second host for one file.
        report_html text,
        report_engine text,
        report_model text,
        -- Promoted out of digest so the library can sort and filter without
        -- parsing jsonb, and so a truncated run is visible in a LIST rather than
        -- only after somebody opens it.
        ads_total integer,
        ads_on_topic integer,
        advertisers integer,
        unique_creatives integer,
        truncated boolean not null default false,
        run_status jsonb not null default '{}'::jsonb,
        engine_metadata jsonb not null default '{}'::jsonb,
        started_at timestamptz,
        completed_at timestamptz,
        updated_at timestamptz not null default now(),
        -- Same shape of rule as search_report.blocked_scan_has_no_count: a run
        -- that claims it finished must carry the counts that say what it covered.
        constraint ads_market_completed_has_counts
          check (completed_at is null or ads_total is not null)
      )
    `);
    await sql(`create index if not exists ads_market_run_keywords_idx on ads_market_run using gin (keywords)`);
    await sql(`alter table ads_market_run add column if not exists report_html text`);
    // There is deliberately NO spend, impressions or reach column. Those fields
    // are null on 100% of Malaysian commercial ads in the Ad Library -- measured
    // over 672 -- and a nullable column is an invitation to read null as zero
    // later. A column that does not exist cannot be misread.
    await sql(`
      comment on column ads_market_run.ads_on_topic is
        'Ads whose own copy contains the topic terms. Facebook keyword_unordered matches loosely (98 of 576 measured), so this, not ads_total, is the real market size.'
    `);
    await sql(`
      comment on column ads_market_run.truncated is
        'A per-keyword page cap was hit, so more ads exist than were captured. Surfaced at list level because a capped run must never read as a complete market.'
    `);
    await sql(`
      do $$
      declare report_type_constraint text;
      begin
        select conname into report_type_constraint
        from pg_constraint
        where conrelid = 'published_report'::regclass
          and contype = 'c'
          and pg_get_constraintdef(oid) like '%report_type%';
        if report_type_constraint is not null then
          execute format('alter table published_report drop constraint %I', report_type_constraint);
        end if;
        alter table published_report add constraint published_report_report_type_check
          check (report_type in ('business_search', 'company_research', 'person_research', 'ads_research', 'ads_market', 'contact_research'));
      end $$;
    `);
    // ------------------------------------------------------------------ the run log
    // ONE APPEND-ONLY TRAIL PER RUN, and it lives in Postgres rather than in a
    // process, a file on the mini, or a Railway stdout buffer.
    //
    // Before this table there were four separate recording systems and no id
    // joining them: the worker log knew a job id, fb-recon knew a run directory,
    // company_research_run knew a report id, and the container's stdout knew
    // nothing at all. Answering "where did this run stop" meant matching wall
    // clock timestamps across three machines by hand.
    //
    // Append-only and written as it happens, because the failure that started
    // this -- the gateway restarting mid-job and answering the worker's result
    // with "no such job -- it was evicted" -- destroys anything held in memory
    // and anything assembled at the end. A row already committed survives it.
    await sql(`
      create table if not exists run_event (
        id bigserial primary key,
        at timestamptz not null default now(),
        report_id bigint references published_report(id) on delete cascade,
        public_id text,
        job_id text,
        stage text,
        event text not null,
        detail jsonb not null default '{}'::jsonb
      );
      create index if not exists run_event_report_idx on run_event (report_id, id);
      create index if not exists run_event_public_idx on run_event (public_id, id);
      create index if not exists run_event_at_idx on run_event (at desc);
    `);
    // Existing deployments already have company_research_run, so these must be
    // additive migrations rather than part of the CREATE TABLE definition only.
    // ------------------------------------------------------------------ company identity
    // A REGISTERED COMPANY NAME IS THE IDENTITY. Google issues a place id per
    // BRANCH, so one legal entity arrives as several rows: "ERS Energy Sdn Bhd"
    // is the KL head office (03-3099 1468) and "ERS Energy Sdn. Bhd." is the
    // Johor branch (07-361 1468), and researching one could not see the other.
    // Eternalgy Sdn Bhd was the same, split across a 21 Aug feed scan and a
    // 23 Aug place-card scan, with three dossiers on one row and one on the other.
    //
    // Storefront names are NOT unique and are left alone: this table holds five
    // separate "The Store" branches on five phone numbers. worker/db.mjs decides
    // which is which; NAME_KEY_SQL / REGISTERED_SQL below are the same rule in SQL.
    //
    // NOTHING IS DELETED. The superseded rows keep their own address and phone
    // and gain `merged_into`, pointing at the row that now carries the identity.
    await sql(`
      alter table company_data add column if not exists merged_into bigint
        references company_data(id) on delete set null;
      comment on column company_data.merged_into is
        'Set when this row is a branch of a registered company that another row now represents. Kept, never deleted; scans and research follow the target.';
      create index if not exists company_data_merged_idx on company_data (merged_into);
    `);
    // The oldest row of each registered name wins, because its id is the one
    // already cited by existing reports.
    await sql(`
      with registered as (
        select id, ${NAME_KEY_SQL} as k from company_data
        where merged_into is null and ${NAME_KEY_SQL} ${REGISTERED_SQL}
      ),
      groups as (
        select k, min(id) as keep from registered group by k having count(*) > 1
      )
      update company_data c set merged_into = g.keep
      from registered r join groups g on g.k = r.k
      where c.id = r.id and r.id <> g.keep;
    `);
    // Follow the merge everywhere a company is referenced, so no report and no
    // scan link is left pointing at a row that no longer carries the identity.
    await sql(`
      update published_report p set company_id = c.merged_into
      from company_data c where p.company_id = c.id and c.merged_into is not null;
    `);
    await carryMergedLeadStateToKeepers();
    // Collapse the scan links BEFORE remapping them, and collapse them against
    // where every row is ABOUT to point, not only against where rows already
    // point.
    //
    // The first version of this deleted a link only when the merge target was
    // already linked to the same report. That misses the case that actually
    // happens on a wide scan: one report links to X and to Y, both of which merge
    // into Z, and neither is Z. Nothing is deleted, both are then updated to Z,
    // and the update violates search_report_company_pkey -- which takes down
    // migrate(), and migrate() runs at the top of every query, so the entire
    // report API answers `duplicate key value violates unique constraint
    // "search_report_company_pkey"` until someone redeploys with a fix. Seen in
    // production on 24 Aug after a 117-company scan of "solar installer in
    // malaysia" produced two branches of one registered name.
    //
    // So: resolve every row on a report to its final company, and where several
    // resolve to the same one, keep the lowest company_id and drop the rest. A
    // dropped row is a duplicate link, never a lost one -- the survivor names the
    // same company on the same report.
    await sql(`
      delete from search_report_company a
      using company_data ca
      where ca.id = a.company_id
        and exists (
          select 1
          from search_report_company b
          join company_data cb on cb.id = b.company_id
          where b.report_id = a.report_id
            and b.company_id <> a.company_id
            and coalesce(cb.merged_into, cb.id) = coalesce(ca.merged_into, ca.id)
            and b.company_id < a.company_id
        );
    `);
    await sql(`
      update search_report_company a set company_id = c.merged_into
      from company_data c where a.company_id = c.id and c.merged_into is not null;
    `);
    // Adopt the registry name as the dedupe key, so the NEXT scan of any branch
    // updates this row instead of opening a third one. Survivors only, and only
    // where no other row already holds that key.
    await sql(`
      update company_data c set place_id = 'name:' || ${NAME_KEY_SQL}
      where c.merged_into is null
        and c.place_id not like 'name:%'
        and ${NAME_KEY_SQL} ${REGISTERED_SQL}
        and not exists (
          select 1 from company_data d
          where d.id <> c.id and d.place_id = 'name:' || ${nameKeySql('c.name')}
        );
    `);

    // Researching a company again produces a NEW report, not a replacement: the
    // findings are a snapshot of what the public web said on a given day, and the
    // previous snapshot is the only thing a later one can be read against. Four
    // Eternalgy Sdn Bhd dossiers existed under one identical title before this,
    // three of them on the same company id, with nothing to tell them apart.
    await sql(`alter table published_report add column if not exists version integer;`);
    // Self-healing rather than run-once: it renumbers any company whose reports
    // do not already carry distinct versions. That covers the first backfill
    // (every version still null) AND the case above, where merging two company
    // rows brings two V1 dossiers together under one id. Once a company is
    // numbered correctly the group is skipped, so re-running costs nothing.
    await sql(`
      with dupes as (
        select report_type, company_id from published_report
        where company_id is not null
        group by report_type, company_id
        having count(*) <> count(distinct version)
      ),
      ranked as (
        select p.id, row_number() over (
                 partition by p.report_type, p.company_id order by p.created_at, p.id
               ) as rn
        from published_report p
        join dupes d on d.report_type = p.report_type and d.company_id = p.company_id
      )
      update published_report p set version = r.rn from ranked r where p.id = r.id;
    `);
    await sql(`update published_report set version = 1 where version is null;`);
    await sql(`
      alter table published_report alter column version set default 1;
      alter table published_report alter column version set not null;
      comment on column published_report.version is
        'Nth research pass on this company_id. V1 is the first; a re-run is V2, V3, ... Never overwritten.';
    `);
    await sql(`
      create index if not exists published_report_company_version_idx
        on published_report (company_id, report_type, version desc);
    `);
    await sql(`
      alter table company_research_run add column if not exists translated_report jsonb;
      alter table company_research_run add column if not exists translation_metadata jsonb not null default '{}'::jsonb;
      comment on column company_research_run.translated_report is 'Chinese (zh-CN) translation of final_report. URLs, IDs and contact values remain canonical.';
    `);
    await sql(`
      alter table company_data add column if not exists lead_status text not null default 'unassigned';
      alter table company_data add column if not exists assigned_to text;
      alter table company_data add column if not exists assigned_at timestamptz;
      alter table company_data add column if not exists lead_notes text;
      alter table company_data add column if not exists is_hidden boolean not null default false;
      alter table company_data add column if not exists lead_updated_at timestamptz default now();
      alter table company_data add column if not exists blacklist_reason text;
      alter table company_data add column if not exists blacklist_checked_at timestamptz;
      comment on column company_data.blacklist_reason is 'lead-blacklist.ts group that keeps this lead out of contact research; null when it may be researched';
      alter table company_data add column if not exists site_email_checked_at timestamptz;
      alter table company_data add column if not exists site_email_status text;
      alter table company_data add column if not exists site_email_error text;
      comment on column company_data.site_email_status is 'site-emails.ts outcome: checking, found, none, unreachable or no_site';

      create table if not exists company_email (
        company_id bigint not null references company_data(id) on delete cascade,
        email      text not null,
        source     text not null default 'website',
        source_url text,
        found_at   timestamptz not null default now(),
        primary key (company_id, email)
      );
      create index if not exists company_email_email_idx on company_email (email);

      create table if not exists email_marketing_lead (
        campaign_id   bigint not null,
        email         text not null,
        company_id    bigint,
        campaign_name text,
        pushed_at     timestamptz not null default now(),
        primary key (campaign_id, email)
      );
      comment on table email_marketing_lead is 'email-marketing.ts: which lead email the hub sent into which Smartlead campaign';
      create index if not exists email_marketing_lead_email_idx on email_marketing_lead (email);
      alter table email_marketing_lead add column if not exists last_event text;
      alter table email_marketing_lead add column if not exists last_event_at timestamptz;
      alter table email_marketing_lead add column if not exists opened_at timestamptz;
      alter table email_marketing_lead add column if not exists replied_at timestamptz;
      alter table email_marketing_lead add column if not exists bounced_at timestamptz;
      alter table email_marketing_lead add column if not exists unsubscribed_at timestamptz;
      alter table email_marketing_lead add column if not exists category text;

      create table if not exists email_marketing_event (
        id          bigserial primary key,
        campaign_id bigint,
        email       text,
        event_type  text not null,
        at          timestamptz not null default now(),
        payload     jsonb not null,
        received_at timestamptz not null default now()
      );
      comment on table email_marketing_event is 'email-marketing.ts: every Smartlead webhook call, raw';
      create index if not exists email_marketing_event_email_idx on email_marketing_event (email);
      create index if not exists email_marketing_event_received_idx on email_marketing_event (received_at desc);
      -- Events saved before secret_key was dropped on arrival.
      update email_marketing_event set payload = payload - 'secret_key' - 'webhook_url' where payload ? 'secret_key' or payload ? 'webhook_url';

      create table if not exists maps_usage (
        month text primary key,
        requests integer not null default 0,
        updated_at timestamptz not null default now()
      );
      comment on table maps_usage is 'scraper.tech Maps requests spent per calendar month (UTC), counted by maps-worker.ts after each scan';

      create table if not exists search_key_spend (
        kind text not null,
        secret text not null,
        calls integer not null default 0,
        dollars numeric not null default 0,
        failures integer not null default 0,
        last_ok_at timestamptz,
        last_error text,
        last_error_at timestamptz,
        since timestamptz not null default now(),
        primary key (kind, secret)
      );
      comment on table search_key_spend is 'What each search key spent, counted by the hub from each answer (Exa has no usage endpoint); apart from gemini_contact_key so saving keys does not reset it';

      create table if not exists territory_discovered (
        id bigserial primary key,
        state text not null,
        district text not null,
        name text not null,
        name_key text not null,
        query_place text not null,
        evidence_url text,
        maps_name text,
        maps_address text,
        verified boolean not null default false,
        created_at timestamptz not null default now(),
        unique (state, district, name_key)
      );
      comment on table territory_discovered is 'Tamans missing from territories.ts, found by taman-finder.ts from Google Maps address evidence';

      create table if not exists taman_finder_town (
        id bigserial primary key,
        state text not null,
        district text not null,
        town text not null,
        status text not null,
        started_at timestamptz not null,
        finished_at timestamptz not null default now(),
        maps_requests integer not null default 0,
        addresses_read integer not null default 0,
        names_seen integer not null default 0,
        added integer not null default 0,
        detail jsonb not null default '{}'::jsonb,
        error text,
        unique (state, district, town)
      );
      comment on table taman_finder_town is 'One row per town the missing-taman finder has checked, done or failed: a town is checked once';
      create index if not exists company_data_lead_status_idx on company_data (lead_status);
      create index if not exists company_data_assigned_to_idx on company_data (assigned_to);
      create index if not exists company_data_is_hidden_idx on company_data (is_hidden);

      create table if not exists telemarketer (
        id serial primary key,
        name text not null unique,
        active boolean not null default true,
        created_at timestamptz not null default now()
      );
      alter table telemarketer add column if not exists phone text;
      alter table telemarketer add column if not exists email text;
      alter table telemarketer add column if not exists notes text;
      alter table telemarketer add column if not exists updated_at timestamptz default now();
      alter table telemarketer add column if not exists uid text;
      alter table telemarketer drop constraint if exists telemarketer_name_key;
      create unique index if not exists telemarketer_uid_key on telemarketer (uid);
      alter table company_data add column if not exists telemarketer_uid text;
      create index if not exists company_data_telemarketer_uid_idx on company_data (telemarketer_uid);
      do $$ begin
        if not exists (select 1 from pg_constraint where conname = 'company_data_telemarketer_uid_fkey') then
          alter table company_data add constraint company_data_telemarketer_uid_fkey
            foreign key (telemarketer_uid) references telemarketer(uid) on delete set null;
        end if;
      end $$;

      create table if not exists taman_assignment (
        id bigserial primary key,
        state text not null default 'johor',
        district text,
        town text,
        taman text not null,
        query_place text,
        assigned_to text not null,
        telemarketer_uid text,
        assigned_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        constraint taman_assignment_state_taman_key unique (state, taman)
      );
      create index if not exists taman_assignment_taman_idx on taman_assignment (taman);
      create index if not exists taman_assignment_assigned_to_idx on taman_assignment (assigned_to);

      update company_data c set telemarketer_uid = t.uid
      from telemarketer t
      where c.telemarketer_uid is null and c.assigned_to is not null
        and t.uid is not null and lower(trim(c.assigned_to)) = lower(trim(t.name));

      update taman_assignment a set telemarketer_uid = t.uid
      from telemarketer t
      where a.telemarketer_uid is null and a.assigned_to is not null
        and t.uid is not null and lower(trim(a.assigned_to)) = lower(trim(t.name));

      update company_data c
      set assigned_to = a.assigned_to,
          telemarketer_uid = a.telemarketer_uid,
          assigned_at = coalesce(c.assigned_at, now()),
          lead_status = case when coalesce(c.lead_status, 'unassigned') = 'unassigned' then 'assigned' else c.lead_status end,
          lead_updated_at = now()
      from taman_assignment a
      join published_report r on (
        r.report_type = 'business_search'
        and (
          (a.query_place is not null and lower(trim(coalesce(r.request->>'place', ''))) = lower(trim(a.query_place)))
          or lower(trim(coalesce(r.request->>'place', ''))) = lower(trim(a.taman))
        )
      )
      join search_report_company sc on (sc.report_id = r.id or sc.report_id = r.source_search_report_id)
      where c.id = sc.company_id
        and c.merged_into is null
        and (c.assigned_to is null or trim(c.assigned_to) = '')
        and c.blacklist_checked_at is not null and c.blacklist_reason is null
        and coalesce(c.lead_status, 'unassigned') <> 'do_not_call';

      insert into telemarketer (uid, name, phone, email, notes, active)
      values ('TM-SARAH', 'Sarah Tan', '+6012-3456789', 'sarah@example.com', 'Demo telemarketer for API testing and documentation', true)
      on conflict (uid) do nothing;

      update company_data set
        assigned_to = 'Sarah Tan',
        telemarketer_uid = 'TM-SARAH',
        assigned_at = now(),
        lead_status = 'assigned',
        lead_notes = 'Assigned for daily call queue. Target decision-maker.'
      where id in (
        select id from company_data
        where merged_into is null and (assigned_to is null or trim(assigned_to) = '')
          and not exists (select 1 from company_data where telemarketer_uid = 'TM-SARAH')
        order by id asc
        limit 2
      );

      create table if not exists lead_activity_log (
        id bigserial primary key,
        company_id bigint references company_data(id) on delete cascade,
        telemarketer_name text,
        telemarketer_uid text,
        action text not null default 'status_change',
        previous_status text,
        new_status text,
        notes text,
        is_mock boolean not null default false,
        created_at timestamptz not null default now()
      );
      create index if not exists lead_activity_log_company_idx on lead_activity_log (company_id);
      create index if not exists lead_activity_log_created_at_idx on lead_activity_log (created_at desc);
      create index if not exists lead_activity_log_tele_idx on lead_activity_log (telemarketer_name);
      create index if not exists lead_activity_log_new_status_idx on lead_activity_log (new_status);

      create table if not exists atap_solar_registrations (
        id serial primary key,
        lead_id varchar(50) not null,
        full_name varchar(255),
        phone_number varchar(50),
        tnb_account_no varchar(50),
        area varchar(255) not null,
        state varchar(100) not null,
        property_type varchar(100) default 'Residential',
        monthly_bill numeric(10, 2),
        email varchar(255),
        roof_type varchar(100),
        system_size varchar(50),
        estimated_savings varchar(100),
        source text,
        utm_source text,
        utm_medium text,
        utm_campaign text,
        notes text,
        raw_data jsonb,
        created_at timestamptz default current_timestamp
      );
      alter table atap_solar_registrations add column if not exists lead_status text not null default 'unassigned';
      alter table atap_solar_registrations add column if not exists assigned_to text;
      alter table atap_solar_registrations add column if not exists telemarketer_uid text;
      alter table atap_solar_registrations add column if not exists assigned_at timestamptz;
      alter table atap_solar_registrations add column if not exists lead_notes text;
      alter table atap_solar_registrations add column if not exists lead_updated_at timestamptz default now();
      alter table atap_solar_registrations add column if not exists is_hidden boolean not null default false;

      create index if not exists atap_reg_lead_id_idx on atap_solar_registrations (lead_id);
      create index if not exists atap_reg_lead_status_idx on atap_solar_registrations (lead_status);
      create index if not exists atap_reg_assigned_to_idx on atap_solar_registrations (assigned_to);
      create index if not exists atap_reg_telemarketer_uid_idx on atap_solar_registrations (telemarketer_uid);
      create index if not exists atap_reg_created_at_idx on atap_solar_registrations (created_at desc);
      create index if not exists atap_reg_source_idx on atap_solar_registrations (source);
      create index if not exists atap_reg_state_idx on atap_solar_registrations (state);

      alter table lead_activity_log add column if not exists registration_id integer;
      alter table lead_activity_log add column if not exists lead_type text not null default 'gmap';
      create index if not exists lead_activity_log_reg_idx on lead_activity_log (registration_id);
    `);
  })().catch((err) => {
    migrated = null;
    throw err;
  });
  return migrated;
}

export type ReportType = 'business_search' | 'company_research' | 'person_research' | 'ads_research' | 'ads_market' | 'contact_research';
export type ReportStatus = 'queued' | 'running' | 'completed' | 'partial' | 'failed';

export interface PublishedReport {
  id: string;
  public_id: string;
  report_type: ReportType;
  status: ReportStatus;
  title: string | null;
  user_id: string | null;
  request: Record<string, unknown>;
  source_search_report_id: string | null;
  company_id: string | null;
  job_id: string | null;
  result: Record<string, unknown> | null;
  error: string | null;
  version: number;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export async function createReport(input: {
  type: ReportType;
  title: string;
  userId?: string | null;
  request: Record<string, unknown>;
  companyId?: string | null;
}): Promise<PublishedReport> {
  await migrate();
  const publicId = crypto.randomBytes(15).toString('base64url');
  // The version is read and written inside one statement so two clicks arriving
  // together cannot both compute "V2". A report with no company (a business
  // search) is always V1 -- there is no earlier pass for it to follow.
  const out = await sql<PublishedReport>(
    `with v as (
       select case when $6::bigint is null then 1
              else (select coalesce(max(version), 0) + 1 from published_report
                    where report_type = $2 and company_id = $6::bigint)
              end as n
     )
     insert into published_report (public_id, report_type, title, user_id, request, company_id, version)
     select $1, $2, $3 || case when v.n > 1 then ' · V' || v.n else '' end,
            $4, $5::jsonb, $6, v.n
     from v
     returning *`,
    [publicId, input.type, input.title, input.userId ?? null, JSON.stringify(input.request), input.companyId ?? null],
  );
  const created = out.rows[0]!;
  await logEvent({
    reportId: created.id, publicId, stage: 'report', event: 'report.created',
    detail: { type: input.type, title: created.title, company_id: input.companyId ?? null, request: input.request },
  });
  return created;
}

export async function updateReport(publicId: string, patch: {
  status?: ReportStatus;
  title?: string;
  searchReportId?: string | null;
  companyId?: string | null;
  jobId?: string | null;
  result?: Record<string, unknown> | null;
  error?: string | null;
  completed?: boolean;
}): Promise<PublishedReport> {
  await migrate();
  const out = await sql<PublishedReport>(
    `update published_report set
       status = coalesce($2, status),
       title = coalesce($3, title),
       source_search_report_id = coalesce($4, source_search_report_id),
       company_id = coalesce($5, company_id),
       job_id = coalesce($6, job_id),
       result = case when $7::boolean then $8::jsonb else result end,
       error = case when $9::boolean then $10 else error end,
       completed_at = case when $11::boolean then now() else completed_at end,
       updated_at = now()
     where public_id = $1 returning *`,
    [
      publicId, patch.status ?? null, patch.title ?? null, patch.searchReportId ?? null,
      patch.companyId ?? null, patch.jobId ?? null,
      Object.prototype.hasOwnProperty.call(patch, 'result'), jsonParam(patch.result),
      Object.prototype.hasOwnProperty.call(patch, 'error'), patch.error ?? null, patch.completed === true,
    ],
  );
  if (!out.rows[0]) throw new Error('no published report ' + publicId);
  // Status is the one field worth a line of its own: `running` -> `partial` is
  // the transition a caller is waiting on, and until now nothing recorded when
  // it happened or what it was carrying. A patch that touches no status (a
  // jobId stamp, a heartbeat) is not an event.
  if (patch.status || patch.completed || patch.error) {
    await logEvent({
      reportId: out.rows[0].id, publicId, stage: 'report',
      event: 'report.' + (patch.status ?? (patch.completed ? 'completed' : 'error')),
      detail: {
        ...(patch.status ? { status: patch.status } : {}),
        ...(patch.completed ? { completed: true } : {}),
        ...(patch.error ? { error: String(patch.error).slice(0, 1_000) } : {}),
        ...(patch.jobId ? { job_id: patch.jobId } : {}),
      },
    });
  }
  return out.rows[0];
}

/** Claim one failed report for a fresh run while preserving its public URL and event trail. */
export async function retryFailedReport(publicId: string): Promise<PublishedReport | null> {
  await migrate();
  const out = await sql<PublishedReport>(
    `with claimed as (
       update published_report set status = 'queued', result = null, error = null,
         job_id = null, source_search_report_id = null, completed_at = null, updated_at = now()
       where public_id = $1 and status = 'failed' returning *
     ),
     company_clear as (delete from company_research_run where report_id in (select id from claimed)),
     person_clear as (delete from person_research_run where report_id in (select id from claimed)),
     contact_clear as (delete from contact_research_run where report_id in (select id from claimed)),
     ads_clear as (delete from ads_research_run where report_id in (select id from claimed)),
     market_clear as (delete from ads_market_run where report_id in (select id from claimed))
     select * from claimed`,
    [publicId],
  );
  const report = out.rows[0] ?? null;
  if (report) await logEvent({ reportId: report.id, publicId, stage: 'report', event: 'report.retried', detail: { status: 'queued' } });
  return report;
}

/**
 * Mark abandoned runs failed.
 *
 * A research run lives in this process. When the container restarts mid-run --
 * a deploy, an OOM, the 502s the workers logged on 22 Aug -- nothing is left to
 * finish the work or to write a terminal status, so the report sits at `running`
 * with `error: null` and no caller polling `api_url` ever gets the terminal
 * status the docs promise it.
 *
 * Two modes, because "stale" and "dead" are not the same claim:
 *
 *   staleMinutes 0 at boot. This process has just started and owns no run, so
 *   anything still non-terminal was stranded by the restart. No age test needed.
 *
 *   staleMinutes > 0 on the interval, for a run whose owner died without taking
 *   the process with it -- and never touching a run this process is still
 *   working on, which is what activePublicIds excludes. That guard matters:
 *   one company report legitimately ran 2h18m waiting behind a serial worker
 *   lane, and an age test alone would have killed it at 45 minutes.
 */
export async function reapAbandoned(staleMinutes: number, activePublicIds: string[] = []): Promise<number> {
  await migrate();
  const out = await sql<{ public_id: string }>(
    `update published_report
        set status = 'failed',
            error = 'This run was abandoned before it finished, most likely because the service restarted while it was working. Start it again.',
            completed_at = now(),
            updated_at = now()
      where status in ('queued','running')
        and not (report_type = 'contact_research' and coalesce(request->>'provider', 'legacy') <> 'parallel')
        and updated_at < now() - make_interval(mins => $1::int)
        and not (public_id = any($2::text[]))
      returning public_id`,
    [Math.max(0, Math.floor(staleMinutes)), activePublicIds],
  );
  return out.rowCount ?? 0;
}

export async function getReport(publicId: string): Promise<PublishedReport | null> {
  await migrate();
  const out = await sql<PublishedReport>('select * from published_report where public_id = $1', [publicId]);
  return out.rows[0] ?? null;
}

/**
 * Delete one report permanently. The ON DELETE CASCADE constraints take the
 * research runs and the run trail with it, and the public /r/:id link 404s from
 * this moment on. company_data and person_data are untouched: the report is a
 * rendering of the dataset, never the dataset itself. A run still in flight
 * survives the deletion harmlessly — its round updates match zero rows and
 * logEvent swallows the orphaned-trail insert.
 *
 * RETURNING rather than rowCount, because the pg-proxy fallback path is not
 * guaranteed to report a rowCount for statements that produce no rows.
 */
export async function deleteReport(publicId: string): Promise<boolean> {
  await migrate();
  const out = await sql<{ id: string }>('delete from published_report where public_id = $1 returning id', [publicId]);
  return out.rows.length > 0;
}

export async function findPersonResearchReport(sourceReportId: string, personId: string): Promise<PublishedReport | null> {
  await migrate();
  const out = await sql<PublishedReport>(
    `select * from published_report
     where report_type = 'person_research'
       and request->>'autoTriggered' = 'true'
       and request->>'sourceReportId' = $1
       and request->>'personId' = $2
     order by created_at desc limit 1`,
    [sourceReportId, personId],
  );
  return out.rows[0] ?? null;
}

/**
 * Any live brief for this person on this report, however it was started.
 *
 * findPersonResearchReport above is scoped to autoTriggered rows because the
 * unique index that protects the auto path is scoped that way too. This one is
 * for the portal button, which must join whatever brief already exists -- the
 * automatic P01 one included -- rather than start a second run of the same
 * person. A failed brief is not returned: that one deserves a retry.
 */
export async function findPersonBrief(sourceReportId: string, personId: string): Promise<PublishedReport | null> {
  await migrate();
  const out = await sql<PublishedReport>(
    `select * from published_report
     where report_type = 'person_research'
       and status <> 'failed'
       and request->>'sourceReportId' = $1
       and request->>'personId' = $2
     order by created_at desc limit 1`,
    [sourceReportId, personId],
  );
  return out.rows[0] ?? null;
}

/**
 * Every VIP brief already started from one company dossier, keyed by the person
 * it is about. The report page needs the whole set at once: a person who has a
 * brief gets a link to it, and only a person who does not gets a button that
 * would start one.
 */
/**
 * The ads report already started for this company, if any.
 *
 * The dossier shows one ads action for the company as a whole, so it needs to know
 * whether a run exists before deciding between a link and a button. Latest first:
 * ads change week to week, so re-running is legitimate and the newest one is the
 * one worth linking to.
 */
export async function findAdsReport(companyId: string | number): Promise<PublishedReport | null> {
  await migrate();
  const out = await sql<PublishedReport>(
    `select * from published_report
     where report_type = 'ads_research'
       and status <> 'failed'
       and company_id = $1::bigint
     order by created_at desc limit 1`,
    [String(companyId)],
  );
  return out.rows[0] ?? null;
}

export async function listPersonBriefs(sourceReportId: string): Promise<Record<string, PublishedReport>> {
  await migrate();
  const out = await sql<PublishedReport>(
    `select distinct on (request->>'personId') *
     from published_report
     where report_type = 'person_research'
       and status <> 'failed'
       and request->>'sourceReportId' = $1
     order by request->>'personId', created_at desc`,
    [sourceReportId],
  );
  const byPerson: Record<string, PublishedReport> = {};
  for (const row of out.rows) {
    const personId = String((row.request as Record<string, unknown>)?.personId ?? '');
    if (personId) byPerson[personId] = row;
  }
  return byPerson;
}

export async function listReports(options: {
  type?: ReportType | null;
  status?: ReportStatus | null;
  limit?: number;
  offset?: number;
} = {}): Promise<{ reports: PublishedReport[]; total: number }> {
  await migrate();
  const limit = Math.min(Math.max(Math.round(options.limit ?? 40), 1), 100);
  const offset = Math.max(Math.round(options.offset ?? 0), 0);
  const params = [options.type ?? null, options.status ?? null, limit, offset];
  const where = `where ($1::text is null or report_type = $1)
                   and ($2::text is null or status = $2)`;
  const [items, count] = await Promise.all([
    sql<PublishedReport>(
      `select * from published_report ${where}
       order by created_at desc limit $3 offset $4`,
      params,
    ),
    sql<{ total: string }>(`select count(*)::text as total from published_report ${where}`, params.slice(0, 2)),
  ]);
  return { reports: items.rows, total: Number(count.rows[0]?.total ?? 0) };
}

export async function getCompany(companyId: string): Promise<Record<string, unknown> | null> {
  await migrate();
  const out = await sql('select * from company_data where id = $1', [companyId]);
  return out.rows[0] ?? null;
}

/**
 * The dossier that already exists for this company, if there is one.
 *
 * The report page lets anyone holding the link press Research, so the same
 * company can be asked for three times in a minute. Each run is four rounds of
 * deep research against a worker that does them one at a time — so a repeat
 * click joins the run already going rather than queueing another behind it.
 * A failed run is not returned: that one deserves a retry.
 */
export async function findCompanyReport(companyId: string): Promise<PublishedReport | null> {
  await migrate();
  // Only a run that is STILL GOING. This guard exists so a double-click, or a
  // shared link opened by three people at once, lands on the run already in
  // flight instead of starting four twenty-minute dossiers -- and that is all it
  // is for. A company whose research has finished is allowed to be researched
  // again; that second pass is V2, not a duplicate. Returning the old terminal
  // report here is what made "research this company" silently do nothing.
  const out = await sql<PublishedReport>(
    `select * from published_report
     where company_id = $1 and report_type = 'company_research'
       and status in ('queued', 'running')
     order by id desc limit 1`,
    [companyId],
  );
  return out.rows[0] ?? null;
}

export async function findContactReport(companyId: string, provider: 'legacy' | 'parallel' = 'legacy'): Promise<PublishedReport | null> {
  await migrate();
  const out = await sql<PublishedReport>(
    `select * from published_report
     where company_id = $1 and report_type = 'contact_research'
       and (case when request->>'provider' = 'parallel' then 'parallel' else 'legacy' end) = $2
       and status in ('queued', 'running')
     order by id desc limit 1`,
    [companyId, provider],
  );
  return out.rows[0] ?? null;
}

export async function getReportById(reportId: string): Promise<PublishedReport | null> {
  await migrate();
  const out = await sql<PublishedReport>('select * from published_report where id = $1', [reportId]);
  return out.rows[0] ?? null;
}

export async function getContactReportByJobId(jobId: string): Promise<PublishedReport | null> {
  await migrate();
  const out = await sql<PublishedReport>(
    `select * from published_report where report_type = 'contact_research' and job_id = $1
     order by id desc limit 1`, [jobId]);
  return out.rows[0] ?? null;
}

export async function markContactClaimed(reportId: string, jobId: string): Promise<boolean> {
  await migrate();
  const out = await sql(
    `update published_report set status = 'running', updated_at = now()
     where id = $1 and report_type = 'contact_research' and job_id = $2
       and status in ('queued', 'running')`,
    [reportId, jobId],
  );
  return (out.rowCount ?? 0) > 0;
}

/** A temporary provider limit leaves the report in the durable queue. */
export async function deferContactResult(reportId: string, jobId: string): Promise<boolean> {
  await migrate();
  const out = await sql(
    `update published_report set status = 'queued', job_id = null, error = null,
       completed_at = null, updated_at = now()
     where id = $1 and report_type = 'contact_research' and job_id = $2
       and status <> 'completed'`,
    [reportId, jobId],
  );
  return (out.rowCount ?? 0) > 0;
}

/** Saved contact reports waiting for a dedicated research lane. */
export async function recoverableContactReports(limit: number, activePublicIds: string[]): Promise<PublishedReport[]> {
  await migrate();
  const out = await sql<PublishedReport>(
    `select * from published_report
     where report_type = 'contact_research'
       and status = 'queued'
       and coalesce(request->>'provider', 'legacy') <> 'parallel'
       and not (public_id = any($1::text[]))
     order by created_at asc
     limit $2`,
    [activePublicIds, Math.max(0, Math.floor(limit))],
  );
  return out.rows;
}

/** The in-process cloud worker stops with the hub, so a restart can safely retry its unfinished slots. */
export async function requeueInterruptedCloudContactReports(): Promise<number> {
  await migrate();
  const out = await sql(
    `update published_report set status = 'queued', job_id = null, error = null, updated_at = now()
     where report_type = 'contact_research' and status = 'running'
       and request->>'researchEngine' = 'agy-web'`,
  );
  return out.rowCount ?? 0;
}

/** Open contact reports untouched for staleMinutes, with the broker job each one is waiting on. */
export async function openContactReports(staleMinutes: number): Promise<Array<{ public_id: string; job_id: string | null; status: string }>> {
  await migrate();
  const out = await sql<{ public_id: string; job_id: string | null; status: string }>(
    `select public_id, job_id, status from published_report
     where report_type = 'contact_research'
       and status in ('queued', 'running')
       and coalesce(request->>'provider', 'legacy') <> 'parallel'
       and updated_at < now() - make_interval(mins => $1::int)`,
    [Math.max(0, Math.floor(staleMinutes))],
  );
  return out.rows;
}

/** Put contact reports back in the durable queue with no job, so recovery runs them again. */
export async function requeueContactReports(publicIds: string[]): Promise<number> {
  if (!publicIds.length) return 0;
  await migrate();
  const out = await sql(
    `update published_report set status = 'queued', job_id = null, error = null, completed_at = null, updated_at = now()
     where report_type = 'contact_research' and status in ('queued', 'running')
       and public_id = any($1::text[])`,
    [publicIds],
  );
  return out.rowCount ?? 0;
}

export async function pendingContactReportCount(): Promise<number> {
  await migrate();
  const out = await sql<{ total: string }>(
    `select count(*)::text as total from published_report
     where report_type = 'contact_research'
       and status in ('queued', 'running')
       and coalesce(request->>'provider', 'legacy') <> 'parallel'`,
  );
  return Number(out.rows[0]?.total ?? 0);
}

/** Explicitly recover reports lost by an earlier hub restart. */
export async function requeueAbandonedContactReports(since: string): Promise<number> {
  await migrate();
  const out = await sql<{ public_id: string }>(
    `update published_report
        set status = 'queued', error = null, job_id = null,
            completed_at = null, updated_at = now()
      where report_type = 'contact_research'
        and status = 'failed'
        and coalesce(request->>'provider', 'legacy') <> 'parallel'
        and error = 'This run was abandoned before it finished, most likely because the service restarted while it was working. Start it again.'
        and updated_at >= $1::timestamptz
      returning public_id`,
    [since],
  );
  return out.rowCount ?? 0;
}

/**
 * Classify leads against lead-blacklist.ts. `all` re-checks every lead (at boot,
 * so a changed rule reaches old leads); otherwise only leads never checked,
 * which is every lead a scan or lookup added since. The backlog only takes
 * checked leads, so an unchecked one cannot slip into research first.
 *
 * A new lead (never checked, nobody's, still unassigned) that is blacklisted
 * also becomes do-not-call, so it never reaches a telemarketer. Old leads keep
 * their status when a changed rule re-checks them.
 */
export async function applyLeadBlacklist(opts: { all?: boolean } = {}): Promise<{ checked: number; blacklisted: number; doNotCall: number }> {
  await migrate();
  const rows = await sql<{ id: string; name: string | null; category: string | null; fresh: boolean }>(
    `select id::text, name, category,
       (blacklist_checked_at is null and coalesce(lead_status, 'unassigned') = 'unassigned'
        and coalesce(trim(assigned_to), '') = '') as fresh
     from company_data
     where merged_into is null${opts.all ? '' : ' and blacklist_checked_at is null'}`,
  );
  let blacklisted = 0;
  let doNotCall = 0;
  for (let start = 0; start < rows.rows.length; start += 1000) {
    const batch = rows.rows.slice(start, start + 1000);
    const reasons = batch.map((r) => blacklistReason(r.name, r.category));
    blacklisted += reasons.filter(Boolean).length;
    const res = await sql<{ id: string; reason: string; made_dnc: boolean }>(
      `update company_data c set blacklist_reason = v.reason, blacklist_checked_at = now(),
         lead_status = case when v.dnc and c.blacklist_checked_at is null then 'do_not_call' else c.lead_status end,
         lead_updated_at = case when v.dnc and c.blacklist_checked_at is null then now() else c.lead_updated_at end
       from unnest($1::bigint[], $2::text[], $3::boolean[]) as v(id, reason, dnc)
       where c.id = v.id
       returning c.id::text as id, v.reason, (v.dnc and c.lead_status = 'do_not_call') as made_dnc`,
      [batch.map((r) => Number(r.id)), reasons, batch.map((r, i) => r.fresh && reasons[i] != null)],
    );
    const made = res.rows.filter((r) => r.made_dnc);
    doNotCall += made.length;
    if (made.length) {
      await sql(
        `insert into lead_activity_log (company_id, action, previous_status, new_status, notes, is_mock, created_at)
         select v.id, 'status_change', 'unassigned', 'do_not_call', 'Blacklist: ' || v.reason, false, now()
         from unnest($1::bigint[], $2::text[]) as v(id, reason)`,
        [made.map((r) => Number(r.id)), made.map((r) => r.reason)],
      ).catch(() => {});
    }
  }
  return { checked: rows.rows.length, blacklisted, doNotCall };
}

/**
 * Active, visible, non-DNC, non-blacklisted companies the auto-queue may research.
 * A lead qualifies when it has never had a legacy contact report, or when its
 * legacy contact reports are all failed. A queued, running, completed, or
 * partial report keeps the company out of the backlog.
 */
export async function contactResearchBacklog(limit: number): Promise<Record<string, unknown>[]> {
  await migrate();
  const out = await sql(
    `select c.*
     from company_data c
     where c.merged_into is null
       and coalesce(c.is_hidden, false) = false
       and coalesce(c.lead_status, 'unassigned') <> 'do_not_call'
       and c.blacklist_checked_at is not null
       and c.blacklist_reason is null
       and not exists (
         select 1 from published_report p
         where p.company_id = c.id
           and p.report_type = 'contact_research'
           and coalesce(p.request->>'provider', 'legacy') <> 'parallel'
           and p.status <> 'failed'
       )
     order by
       case when exists (
         select 1 from published_report p
         where p.company_id = c.id
           and p.report_type = 'contact_research'
           and p.status = 'failed'
       ) then 0 else 1 end,
       c.id asc
     limit $1`,
    [limit],
  );
  return out.rows;
}

/** Lifetime counts of contact-research reports the auto-queue started. */
export async function autoContactQueueTotals(): Promise<{ queued: number; running: number; completed: number; failed: number }> {
  await migrate();
  const out = await sql<{ queued: string; running: string; completed: string; failed: string }>(
    `select
       count(*) filter (where status = 'queued')::text as queued,
       count(*) filter (where status = 'running')::text as running,
       count(*) filter (where status = 'completed')::text as completed,
       count(*) filter (where status = 'failed')::text as failed
     from published_report
     where report_type = 'contact_research'
       and request->>'autoQueued' = 'true'`,
  );
  const row = out.rows[0];
  return {
    queued: Number(row?.queued ?? 0),
    running: Number(row?.running ?? 0),
    completed: Number(row?.completed ?? 0),
    failed: Number(row?.failed ?? 0),
  };
}

export async function findOrCreateCompany(data: {
  name: string;
  address?: string | null;
  phone?: string | null;
  website?: string | null;
  maps_url?: string | null;
  category?: string | null;
}): Promise<Record<string, unknown>> {
  await migrate();
  const name = (data.name || '').trim();
  const found = await sql('select * from company_data where lower(name) = lower($1) and merged_into is null order by id asc limit 1', [name]);
  if (found.rows[0]) return found.rows[0];
  const placeId = 'manual:' + crypto.randomBytes(8).toString('hex');
  const inserted = await sql(
    `insert into company_data (place_id, name, address, phone, website, maps_url, category, source)
     values ($1, $2, $3, $4, $5, $6, $7, 'manual')
     returning *`,
    [placeId, name, data.address || null, data.phone || null, data.website || null, data.maps_url || null, data.category || null],
  );
  return inserted.rows[0]!;
}

export async function searchResult(reportId: string): Promise<{ report: Record<string, unknown>; companies: Record<string, unknown>[] } | null> {
  await migrate();
  const report = (await sql('select * from search_report where id = $1', [reportId])).rows[0];
  if (!report) return null;
  const companies = (
    await sql(
      `select c.*, src.rank,
         crep.public_id as contact_public_id,
         crep.status as contact_status,
         coalesce(
           case
             when jsonb_typeof(crep.result->'phone_contacts') = 'array'
             then jsonb_array_length(crep.result->'phone_contacts')
             when jsonb_typeof(crep.result->'contacts') = 'array'
             then jsonb_array_length(crep.result->'contacts')
             when crep.result->'preview'->>'phones' is not null
             then (crep.result->'preview'->>'phones')::int
             else null
           end,
           0
         )::int as contact_phones_count,
         coalesce(
           case
             when jsonb_typeof(crep.result->'decision_makers') = 'array'
             then jsonb_array_length(crep.result->'decision_makers')
             when jsonb_typeof(crep.result->'people') = 'array'
             then jsonb_array_length(crep.result->'people')
             when crep.result->'preview'->>'decision_makers' is not null
             then (crep.result->'preview'->>'decision_makers')::int
             else null
           end,
           0
         )::int as contact_decision_makers_count
       from search_report_company src
       join company_data c on c.id = src.company_id
       left join lateral (
         select public_id, status, result
         from published_report
         where company_id = c.id and report_type = 'contact_research'
         order by version desc, created_at desc limit 1
       ) crep on true
       where src.report_id = $1 order by src.rank asc`,
      [reportId],
    )
  ).rows;
  return { report, companies };
}

export async function searchResultForJob(jobId: string): Promise<{ report: Record<string, unknown>; companies: Record<string, unknown>[] } | null> {
  await migrate();
  const found = await sql<{ id: string }>('select id from search_report where job_id = $1 order by id desc limit 1', [jobId]);
  return found.rows[0] ? searchResult(String(found.rows[0].id)) : null;
}

/** Same identity rule as worker/db.mjs. Replaying a saved scan must not create new leads. */
export function scanPlaceKey(b: Record<string, unknown>): string {
  const name = String(b.name ?? '').toLowerCase().replace(/[.,'"`’]/g, '').replace(/\s+/g, ' ').trim();
  if (/\b(?:sdn\.?\s*bhd|sendirian\s+berhad|berhad|bhd|plt|llp|pte\.?\s*ltd|ltd|limited|inc|incorporated|corp|corporation|gmbh|pty|gida)\.?$/i.test(name)) return 'name:' + name;
  if (typeof b.place_id === 'string' && b.place_id.trim()) return b.place_id;
  const mapsUrl = String(b.mapsUrl ?? b.maps_url ?? '');
  const mapsId = /!19s([A-Za-z0-9_-]+)/.exec(mapsUrl);
  return mapsId ? mapsId[1]! : 'name:' + name + '|' + String(b.address ?? '').toLowerCase().trim();
}

/** Replay a captured Maps result through the server's database connection, without rescanning. */
export async function persistBusinessScan(publicId: string, scan: Record<string, unknown>, businesses: Record<string, unknown>[], sourceWorker = 'hub-repair'): Promise<{ reportId: string; companies: number; linked: number }> {
  await migrate();
  const published = await getReport(publicId);
  if (!published || published.report_type !== 'business_search') throw new Error('business-list report not found');

  const byKey = new Map<string, Record<string, unknown>>();
  for (const business of businesses) {
    if (!String(business.name ?? '').trim()) continue;
    const key = scanPlaceKey(business);
    if (!byKey.has(key)) byKey.set(key, business);
  }

  const idByKey = new Map<string, string>();
  const entries = [...byKey];
  for (let start = 0; start < entries.length; start += 100) {
    const batch = entries.slice(start, start + 100);
    const values = batch.map((_, i) => '(' + Array.from({ length: 9 }, (_v, j) => '$' + (i * 9 + j + 1)).join(',') + ')').join(',');
    const params = batch.flatMap(([key, b]) => [
      key, String(b.name).toWellFormed(), b.rating ?? null, b.reviews ?? null,
      b.category == null ? null : String(b.category).toWellFormed(),
      b.address == null ? null : String(b.address).toWellFormed(),
      b.phone == null ? null : String(b.phone).toWellFormed(),
      b.website == null ? null : String(b.website).toWellFormed(),
      b.mapsUrl == null && b.maps_url == null ? null : String(b.mapsUrl ?? b.maps_url).toWellFormed(),
    ]);
    const inserted = await sql<{ id: string; place_id: string }>(
      `insert into company_data (place_id,name,rating,reviews,category,address,phone,website,maps_url)
       values ${values}
       on conflict (place_id) do update set
         name = excluded.name,
         rating = coalesce(excluded.rating, company_data.rating),
         reviews = coalesce(excluded.reviews, company_data.reviews),
         category = coalesce(excluded.category, company_data.category),
         address = case when length(coalesce(excluded.address, '')) > length(coalesce(company_data.address, '')) then excluded.address else company_data.address end,
         phone = coalesce(excluded.phone, company_data.phone),
         website = coalesce(excluded.website, company_data.website),
         maps_url = excluded.maps_url,
         last_seen_at = now()
       returning id, place_id`, params,
    );
    for (const row of inserted.rows) idByKey.set(row.place_id, String(row.id));
  }
  if (idByKey.size !== byKey.size) throw new Error(`saved ${idByKey.size} of ${byKey.size} businesses`);

  let reportId = published.source_search_report_id;
  if (!reportId && published.job_id) {
    const existing = await sql<{ id: string }>('select id from search_report where job_id = $1 order by id desc limit 1', [published.job_id]);
    reportId = existing.rows[0]?.id ?? null;
  }
  if (!reportId) {
    const found = scan.blocked ? null : typeof scan.found === 'number' && Number.isFinite(scan.found) ? scan.found : businesses.length;
    const inserted = await sql<{ id: string }>(
      `insert into search_report (user_id, keyword, place, query, found, blocked, blocked_reason, capped, limited_view, job_id, worker, took_ms)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) returning id`,
      [published.user_id, scan.keyword ?? null, scan.place ?? published.request.place ?? null,
       scan.query ?? null, found, Boolean(scan.blocked), scan.blockedReason ?? null,
       Boolean(scan.capped), scan.limitedView ?? null, published.job_id, sourceWorker, scan.tookMs ?? null],
    );
    reportId = inserted.rows[0]?.id ?? null;
  }
  if (!reportId) throw new Error('could not create search report for captured scan');

  const links = businesses.map((business, i) => [reportId, idByKey.get(scanPlaceKey(business)), i + 1]).filter((link) => link[1] != null);
  for (let start = 0; start < links.length; start += 100) {
    const batch = links.slice(start, start + 100);
    const values = batch.map((_, i) => '(' + Array.from({ length: 3 }, (_v, j) => '$' + (i * 3 + j + 1)).join(',') + ')').join(',');
    await sql(`insert into search_report_company (report_id, company_id, rank) values ${values} on conflict (report_id, company_id) do nothing`, batch.flat());
  }
  const verified = await sql<{ count: number }>('select count(*)::int as count from search_report_company where report_id = $1', [reportId]);
  const linked = Number(verified.rows[0]?.count ?? 0);
  if (linked < byKey.size) throw new Error(`linked ${linked} of ${byKey.size} businesses to search report ${reportId}`);
  return { reportId: String(reportId), companies: byKey.size, linked };
}

export async function initResearchRun(reportId: string): Promise<void> {
  await migrate();
  await sql(
    `insert into company_research_run (report_id, started_at)
     values ($1, now()) on conflict (report_id) do nothing`,
    [reportId],
  );
}

export async function saveRound(
  reportId: string,
  round: 'round01' | 'round02' | 'round03' | 'round04',
  artifact: Record<string, unknown>,
  status: string,
  engine: Record<string, unknown>,
): Promise<void> {
  await initResearchRun(reportId);
  // Column names come only from the closed union above, never from request data.
  await sql(
    `update company_research_run set
       ${round} = $2::jsonb,
       round_status = jsonb_set(round_status, $3::text[], to_jsonb($4::text), true),
       engine_metadata = jsonb_set(engine_metadata, $3::text[], $5::jsonb, true),
       updated_at = now()
     where report_id = $1`,
    [reportId, JSON.stringify(artifact), [round], status, JSON.stringify(engine)],
  );
  // The trail entry is written from here rather than from the fifteen call
  // sites in intel.ts, because every round transition in every report type
  // already passes through this function. One hook, total coverage.
  await logEvent({
    reportId, stage: round, event: 'round.' + status,
    detail: {
      ...engine,
      ...(artifact.error ? { error: String(artifact.error).slice(0, 1_000) } : {}),
      ...(artifact.error_code ? { error_code: artifact.error_code } : {}),
    },
  });
  // Heartbeat the published report too. Rounds used to write only to
  // company_research_run, so published_report.updated_at stayed frozen at the
  // moment the run started and could not tell a working run from a dead one --
  // and one company report legitimately took 2h18m waiting on a serial worker
  // lane. Anything that reaps on staleness needs this to be true first.
  await sql('update published_report set updated_at = now() where id = $1', [reportId]);
}

export async function saveFinal(
  reportId: string,
  ledger: Record<string, unknown>,
  finalReport: Record<string, unknown>,
): Promise<void> {
  await initResearchRun(reportId);
  await sql(
    `update company_research_run set validated_ledger=$2::jsonb, final_report=$3::jsonb,
       completed_at=now(), updated_at=now() where report_id=$1`,
    [reportId, JSON.stringify(ledger), JSON.stringify(finalReport)],
  );
  // The dossier now exists and is durable. On the Newpages run this moment was
  // 16:20:25 and the report did not go readable until 16:24:41 -- four minutes
  // in which the product was finished and the screen said nothing. The trail
  // says when the deliverable landed, separately from when it was published.
  await logEvent({
    reportId, stage: 'final', event: 'final.saved',
    detail: {
      contacts: Array.isArray(finalReport.contacts) ? finalReport.contacts.length : 0,
      people: Array.isArray(finalReport.people) ? finalReport.people.length : 0,
      signals: Array.isArray(finalReport.signals) ? finalReport.signals.length : 0,
      synthesis_mode: finalReport.synthesis_mode ?? null,
      has_summary: Boolean(finalReport.summary),
    },
  });
}

/** Store the Chinese render separately so the canonical English evidence ledger
 * remains machine-readable and existing API consumers keep their current shape. */
export async function saveTranslation(
  reportId: string,
  translatedReport: Record<string, unknown>,
  metadata: Record<string, unknown>,
): Promise<void> {
  await initResearchRun(reportId);
  await sql(
    `update company_research_run set translated_report=$2::jsonb, translation_metadata=$3::jsonb,
       updated_at=now() where report_id=$1`,
    [reportId, JSON.stringify(translatedReport), JSON.stringify(metadata)],
  );
  await logEvent({
    reportId, stage: 'translation', event: 'translation.' + (typeof metadata.status === 'string' && metadata.status ? metadata.status : 'saved'),
    detail: metadata,
  });
}

export async function researchRun(reportId: string): Promise<Record<string, unknown> | null> {
  await migrate();
  return (await sql('select * from company_research_run where report_id=$1', [reportId])).rows[0] ?? null;
}

export async function initPersonResearchRun(reportId: string): Promise<void> {
  await migrate();
  await sql(
    `insert into person_research_run (report_id, started_at)
     values ($1, now()) on conflict (report_id) do nothing`,
    [reportId],
  );
}

export async function savePersonResearchRun(reportId: string, patch: {
  discovery?: Record<string, unknown>;
  synthesis?: Record<string, unknown>;
  ledger?: Record<string, unknown>;
  finalReport?: Record<string, unknown>;
  status?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  completed?: boolean;
}): Promise<void> {
  await initPersonResearchRun(reportId);
  await sql(
    `update person_research_run set
       discovery = case when $2::boolean then $3::jsonb else discovery end,
       synthesis = case when $4::boolean then $5::jsonb else synthesis end,
       validated_ledger = case when $6::boolean then $7::jsonb else validated_ledger end,
       final_report = case when $8::boolean then $9::jsonb else final_report end,
       run_status = case when $10::boolean then $11::jsonb else run_status end,
       engine_metadata = case when $12::boolean then $13::jsonb else engine_metadata end,
       completed_at = case when $14::boolean then now() else completed_at end,
       updated_at = now() where report_id = $1`,
    [
      reportId,
      Object.prototype.hasOwnProperty.call(patch, 'discovery'), jsonParam(patch.discovery),
      Object.prototype.hasOwnProperty.call(patch, 'synthesis'), jsonParam(patch.synthesis),
      Object.prototype.hasOwnProperty.call(patch, 'ledger'), jsonParam(patch.ledger),
      Object.prototype.hasOwnProperty.call(patch, 'finalReport'), jsonParam(patch.finalReport),
      Object.prototype.hasOwnProperty.call(patch, 'status'), jsonParam(patch.status ?? {}),
      Object.prototype.hasOwnProperty.call(patch, 'metadata'), jsonParam(patch.metadata ?? {}),
      patch.completed === true,
    ],
  );
}

export async function personResearchRun(reportId: string): Promise<Record<string, unknown> | null> {
  await migrate();
  return (await sql('select * from person_research_run where report_id=$1', [reportId])).rows[0] ?? null;
}

export async function initContactResearchRun(reportId: string): Promise<void> {
  await migrate();
  await sql(
    `insert into contact_research_run (report_id, started_at)
     values ($1, now()) on conflict (report_id) do nothing`,
    [reportId],
  );
}

export async function saveContactResearchRun(reportId: string, patch: {
  discovery?: Record<string, unknown>;
  ledger?: Record<string, unknown>;
  finalReport?: Record<string, unknown>;
  status?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  completed?: boolean;
}): Promise<void> {
  await initContactResearchRun(reportId);
  await sql(
    `update contact_research_run set
       discovery = case when $2::boolean then $3::jsonb else discovery end,
       ledger = case when $4::boolean then $5::jsonb else ledger end,
       final_report = case when $6::boolean then $7::jsonb else final_report end,
       run_status = case when $8::boolean then $9::jsonb else run_status end,
       engine_metadata = case when $10::boolean then $11::jsonb else engine_metadata end,
       completed_at = case when $12::boolean then now() else completed_at end,
       updated_at = now() where report_id = $1`,
    [
      reportId,
      Object.prototype.hasOwnProperty.call(patch, 'discovery'), jsonParam(patch.discovery),
      Object.prototype.hasOwnProperty.call(patch, 'ledger'), jsonParam(patch.ledger),
      Object.prototype.hasOwnProperty.call(patch, 'finalReport'), jsonParam(patch.finalReport),
      Object.prototype.hasOwnProperty.call(patch, 'status'), jsonParam(patch.status ?? {}),
      Object.prototype.hasOwnProperty.call(patch, 'metadata'), jsonParam(patch.metadata ?? {}),
      patch.completed === true,
    ],
  );
}

export async function contactResearchRun(reportId: string): Promise<Record<string, unknown> | null> {
  await migrate();
  return (await sql('select * from contact_research_run where report_id=$1', [reportId])).rows[0] ?? null;
}

export async function initAdsResearchRun(reportId: string): Promise<void> {
  await migrate();
  await sql(
    `insert into ads_research_run (report_id, started_at)
     values ($1, now()) on conflict (report_id) do nothing`,
    [reportId],
  );
}

export async function saveAdsResearchRun(reportId: string, patch: {
  facebook?: Record<string, unknown>;
  google?: Record<string, unknown>;
  ads?: Record<string, unknown>;
  finalReport?: Record<string, unknown>;
  status?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  completed?: boolean;
}): Promise<void> {
  await initAdsResearchRun(reportId);
  await sql(
    `update ads_research_run set
       facebook = case when $2::boolean then $3::jsonb else facebook end,
       google = case when $4::boolean then $5::jsonb else google end,
       ads = case when $6::boolean then $7::jsonb else ads end,
       final_report = case when $8::boolean then $9::jsonb else final_report end,
       run_status = case when $10::boolean then $11::jsonb else run_status end,
       engine_metadata = case when $12::boolean then $13::jsonb else engine_metadata end,
       completed_at = case when $14::boolean then now() else completed_at end,
       updated_at = now() where report_id = $1`,
    [
      reportId,
      Object.prototype.hasOwnProperty.call(patch, 'facebook'), jsonParam(patch.facebook),
      Object.prototype.hasOwnProperty.call(patch, 'google'), jsonParam(patch.google),
      Object.prototype.hasOwnProperty.call(patch, 'ads'), jsonParam(patch.ads),
      Object.prototype.hasOwnProperty.call(patch, 'finalReport'), jsonParam(patch.finalReport),
      Object.prototype.hasOwnProperty.call(patch, 'status'), jsonParam(patch.status ?? {}),
      Object.prototype.hasOwnProperty.call(patch, 'metadata'), jsonParam(patch.metadata ?? {}),
      patch.completed === true,
    ],
  );
}

export async function adsResearchRun(reportId: string): Promise<Record<string, unknown> | null> {
  await migrate();
  return (await sql('select * from ads_research_run where report_id=$1', [reportId])).rows[0] ?? null;
}

export async function initAdsMarketRun(reportId: string, keywords: string[], region: string): Promise<void> {
  await migrate();
  await sql(
    `insert into ads_market_run (report_id, keywords, region, started_at)
     values ($1, $2::text[], $3, now()) on conflict (report_id) do nothing`,
    [reportId, keywords, region],
  );
}

/**
 * Patch a market run. Same has-own-property gate as saveAdsResearchRun: passing a
 * key writes it, omitting it leaves the stored value alone, so a later stage never
 * blanks an earlier one by not knowing about it.
 *
 * The counts are written from the digest by the caller rather than derived here --
 * the digest is the one place that counts, and a second implementation of the same
 * arithmetic is a second chance to disagree with it.
 */
export async function saveAdsMarketRun(reportId: string, patch: {
  fetchStats?: Record<string, unknown>;
  digest?: Record<string, unknown>;
  reportMd?: string | null;
  reportHtml?: string | null;
  reportEngine?: string | null;
  reportModel?: string | null;
  adsTotal?: number | null;
  adsOnTopic?: number | null;
  advertisers?: number | null;
  uniqueCreatives?: number | null;
  truncated?: boolean;
  status?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  completed?: boolean;
}): Promise<void> {
  await migrate();
  const has = (k: string) => Object.prototype.hasOwnProperty.call(patch, k);
  await sql(
    `update ads_market_run set
       fetch_stats = case when $2::boolean then $3::jsonb else fetch_stats end,
       digest = case when $4::boolean then $5::jsonb else digest end,
       report_md = case when $6::boolean then $7::text else report_md end,
       report_html = case when $27::boolean then $28::text else report_html end,
       report_engine = case when $8::boolean then $9::text else report_engine end,
       report_model = case when $10::boolean then $11::text else report_model end,
       ads_total = case when $12::boolean then $13::integer else ads_total end,
       ads_on_topic = case when $14::boolean then $15::integer else ads_on_topic end,
       advertisers = case when $16::boolean then $17::integer else advertisers end,
       unique_creatives = case when $18::boolean then $19::integer else unique_creatives end,
       truncated = case when $20::boolean then $21::boolean else truncated end,
       run_status = case when $22::boolean then $23::jsonb else run_status end,
       engine_metadata = case when $24::boolean then $25::jsonb else engine_metadata end,
       completed_at = case when $26::boolean then now() else completed_at end,
       updated_at = now() where report_id = $1`,
    [
      reportId,
      has('fetchStats'), jsonParam(patch.fetchStats),
      has('digest'), jsonParam(patch.digest),
      has('reportMd'), patch.reportMd == null ? null : patch.reportMd.toWellFormed(),
      has('reportEngine'), patch.reportEngine ?? null,
      has('reportModel'), patch.reportModel ?? null,
      has('adsTotal'), patch.adsTotal ?? null,
      has('adsOnTopic'), patch.adsOnTopic ?? null,
      has('advertisers'), patch.advertisers ?? null,
      has('uniqueCreatives'), patch.uniqueCreatives ?? null,
      has('truncated'), patch.truncated === true,
      has('status'), jsonParam(patch.status ?? {}),
      has('metadata'), jsonParam(patch.metadata ?? {}),
      patch.completed === true,
      has('reportHtml'), patch.reportHtml == null ? null : patch.reportHtml.toWellFormed(),
    ],
  );
}

export async function adsMarketRun(reportId: string): Promise<Record<string, unknown> | null> {
  await migrate();
  return (await sql('select * from ads_market_run where report_id=$1', [reportId])).rows[0] ?? null;
}

/**
 * An in-flight market run for the same keyword set and region.
 *
 * Only queued/running counts. A market moves week to week, so re-running a
 * finished keyword is legitimate and a completed report must never block one --
 * the same rule findAdsReport applies to advertisers.
 */
export async function findAdsMarketReport(keywords: string[], region: string): Promise<PublishedReport | null> {
  await migrate();
  const out = await sql<PublishedReport>(
    `select r.* from published_report r
     join ads_market_run m on m.report_id = r.id
     where r.report_type = 'ads_market'
       and r.status in ('queued', 'running')
       and m.region = $2
       and m.keywords @> $1::text[] and m.keywords <@ $1::text[]
     order by r.created_at desc limit 1`,
    [keywords, region],
  );
  return out.rows[0] ?? null;
}

/**
 * Append one line to a run's trail.
 *
 * NEVER THROWS. A logging layer that can kill the run it is describing is worse
 * than no logging layer, so every failure here is swallowed after being written
 * to stdout. The run is the product; this is the account of it.
 */
export async function logEvent(input: {
  reportId?: string | number | null;
  publicId?: string | null;
  jobId?: string | null;
  stage?: string | null;
  event: string;
  detail?: Record<string, unknown> | null;
}): Promise<void> {
  if (!configured()) return;
  try {
    // Bounded, because a round artifact can carry a whole crawl transcript and
    // the trail is meant to stay readable and cheap to write.
    const detail = JSON.stringify(input.detail ?? {}).slice(0, 8_000);
    await sql(
      `insert into run_event (report_id, public_id, job_id, stage, event, detail)
       values ($1, $2, $3, $4, $5, $6::jsonb)`,
      [
        input.reportId != null && String(input.reportId).trim() ? String(input.reportId) : null,
        input.publicId ?? null,
        input.jobId ?? null,
        input.stage ?? null,
        input.event,
        detail.startsWith('{') ? detail : '{}',
      ],
    );
  } catch (err) {
    console.error('[run_event] could not record "' + input.event + '": ' + ((err as Error).message ?? String(err)));
  }
}

/** Every event for one run, oldest first. Accepts either id form. */
export async function listEvents(key: { reportId?: string | number | null; publicId?: string | null }): Promise<Record<string, unknown>[]> {
  if (!configured()) return [];
  const { rows } = await sql<Record<string, unknown>>(
    `select id, at, report_id, public_id, job_id, stage, event, detail
       from run_event
      where ($1::bigint is null or report_id = $1::bigint)
        and ($2::text is null or public_id = $2::text)
      order by id asc
      limit 2000`,
    [
      key.reportId != null && String(key.reportId).trim() ? String(key.reportId) : null,
      key.publicId ?? null,
    ],
  );
  return rows;
}

export type LeadStatus = 'unassigned' | 'assigned' | 'contacted' | 'interested' | 'not_interested' | 'do_not_call';

export interface LeadItem {
  id: string;
  name: string;
  category: string | null;
  address: string | null;
  phone: string | null;
  website: string | null;
  maps_url: string | null;
  rating: number | null;
  reviews: number | null;
  lead_status: LeadStatus;
  assigned_to: string | null;
  telemarketer_uid: string | null;
  assigned_at: string | null;
  lead_notes: string | null;
  lead_updated_at: string | null;
  first_seen_at: string;
  last_seen_at: string;
  is_hidden: boolean;
  research_public_id: string | null;
  research_status: string | null;
  research_version: number | null;
  contact_public_id: string | null;
  contact_status: string | null;
  contact_version: number | null;
  contact_phones_count: number;
  contact_decision_makers_count: number;
  contact_emails_count: number;
  branch_count: number;
}

export interface LeadStats {
  total: number;
  unassigned: number;
  assigned: number;
  contacted: number;
  interested: number;
  not_interested: number;
  do_not_call: number;
  contacts_found: number;
  deep_researched: number;
  hidden: number;
}

/** A finished contact research report, `crep` being the latest one. */
const DEEP_RESEARCHED = `(crep.public_id is not null and crep.status in ('completed', 'partial'))`;
const jsonCount = (path: string) => `case when jsonb_typeof(${path}) = 'array' then jsonb_array_length(${path}) else 0 end`;
/**
 * A lead we can reach: the phone Maps gave us, or a phone or email that contact
 * research found. A finished report that found nothing is not a contact.
 */
const CONTACT_FOUND = `(nullif(trim(c.phone), '') is not null or (${DEEP_RESEARCHED} and (`
  + [`crep.result->'phone_contacts'`, `crep.result->'contacts'`, `crep.result->'email_contacts'`, `crep.result->'emails'`].map(jsonCount).join(' + ')
  + ` + coalesce((crep.result->'preview'->>'phones')::int, 0) + coalesce((crep.result->'preview'->>'emails')::int, 0)) > 0))`;

export async function getLeadStats(): Promise<LeadStats> {
  if (!configured()) {
    return {
      total: 0,
      unassigned: 0,
      assigned: 0,
      contacted: 0,
      interested: 0,
      not_interested: 0,
      do_not_call: 0,
      contacts_found: 0,
      deep_researched: 0,
      hidden: 0,
    };
  }
  await migrate();
  const statsRes = await sql<{
    total: string;
    unassigned: string;
    assigned: string;
    contacted: string;
    interested: string;
    not_interested: string;
    do_not_call: string;
    contacts_found: string;
    deep_researched: string;
    hidden: string;
  }>(
    `select
       count(*) filter (where coalesce(c.is_hidden, false) = false)::text as total,
       count(*) filter (where coalesce(c.is_hidden, false) = false and (c.assigned_to is null or trim(c.assigned_to) = '' or coalesce(c.lead_status, 'unassigned') = 'unassigned'))::text as unassigned,
       count(*) filter (where coalesce(c.is_hidden, false) = false and c.assigned_to is not null and trim(c.assigned_to) <> '' and coalesce(c.lead_status, 'assigned') = 'assigned')::text as assigned,
       count(*) filter (where coalesce(c.is_hidden, false) = false and c.lead_status = 'contacted')::text as contacted,
       count(*) filter (where coalesce(c.is_hidden, false) = false and c.lead_status = 'interested')::text as interested,
       count(*) filter (where coalesce(c.is_hidden, false) = false and c.lead_status = 'not_interested')::text as not_interested,
       count(*) filter (where coalesce(c.is_hidden, false) = false and c.lead_status = 'do_not_call')::text as do_not_call,
       count(*) filter (where coalesce(c.is_hidden, false) = false and ${CONTACT_FOUND})::text as contacts_found,
       count(*) filter (where coalesce(c.is_hidden, false) = false and ${DEEP_RESEARCHED})::text as deep_researched,
       count(*) filter (where coalesce(c.is_hidden, false) = true)::text as hidden
     from company_data c
     left join lateral (
       select public_id, status, result from published_report
       where company_id = c.id and report_type = 'contact_research'
       order by version desc, created_at desc limit 1
     ) crep on true
     where c.merged_into is null`,
  );
  const statsRow = statsRes.rows[0];
  return {
    total: Number(statsRow?.total ?? 0),
    unassigned: Number(statsRow?.unassigned ?? 0),
    assigned: Number(statsRow?.assigned ?? 0),
    contacted: Number(statsRow?.contacted ?? 0),
    interested: Number(statsRow?.interested ?? 0),
    not_interested: Number(statsRow?.not_interested ?? 0),
    do_not_call: Number(statsRow?.do_not_call ?? 0),
    contacts_found: Number(statsRow?.contacts_found ?? 0),
    deep_researched: Number(statsRow?.deep_researched ?? 0),
    hidden: Number(statsRow?.hidden ?? 0),
  };
}

function applyAssignedToFilter(whereConditions: string[], params: unknown[], assignedTo: string): void {
  const trimmed = assignedTo.trim().replace(/^[=:]+/, '');
  if (!trimmed || trimmed === 'all') return;
  if (trimmed === 'unassigned') {
    whereConditions.push(`(c.assigned_to is null or trim(c.assigned_to) = '' or coalesce(c.lead_status, 'unassigned') = 'unassigned')`);
    return;
  }

  const rawKey = trimmed.startsWith('uid:') ? trimmed.slice(4) : trimmed;
  const prefixedKey = trimmed.startsWith('uid:') ? trimmed : 'uid:' + trimmed;
  const numId = Number(rawKey);
  const isNumeric = Number.isFinite(numId) && numId > 0 && String(numId) === rawKey;

  params.push(rawKey);
  const pRaw = params.length;
  params.push(prefixedKey);
  const pPrefixed = params.length;
  params.push(trimmed);
  const pTrimmed = params.length;
  params.push(isNumeric);
  const pIsNum = params.length;
  params.push(isNumeric ? numId : 0);
  const pNumId = params.length;

  whereConditions.push(`(
    c.telemarketer_uid = $${pRaw}
    or c.telemarketer_uid = $${pPrefixed}
    or lower(trim(c.assigned_to)) = lower(trim($${pTrimmed}))
    or lower(trim(c.assigned_to)) = lower(trim($${pRaw}))
    or lower(trim(c.assigned_to)) = lower(trim($${pPrefixed}))
    or lower(regexp_replace(trim(coalesce(c.assigned_to, '')), '\\s+', ' ', 'g')) = lower(regexp_replace(trim($${pRaw}), '\\s+', ' ', 'g'))
    or c.telemarketer_uid in (
      select uid from telemarketer
      where uid = $${pRaw} or uid = $${pPrefixed}
        or lower(trim(name)) = lower(trim($${pTrimmed}))
        or lower(trim(name)) = lower(trim($${pRaw}))
        or lower(regexp_replace(trim(name), '\\s+', ' ', 'g')) = lower(regexp_replace(trim($${pRaw}), '\\s+', ' ', 'g'))
        or ($${pIsNum}::boolean and id = $${pNumId}::int)
    )
    or lower(trim(c.assigned_to)) in (
      select lower(trim(name)) from telemarketer
      where uid = $${pRaw} or uid = $${pPrefixed}
        or lower(trim(name)) = lower(trim($${pTrimmed}))
        or lower(trim(name)) = lower(trim($${pRaw}))
        or lower(regexp_replace(trim(name), '\\s+', ' ', 'g')) = lower(regexp_replace(trim($${pRaw}), '\\s+', ' ', 'g'))
        or ($${pIsNum}::boolean and id = $${pNumId}::int)
    )
  )`);
}

export async function listLeads(options: {
  search?: string | null;
  nameKeyword?: string | null;
  status?: string | null;
  assignedTo?: string | null;
  researchStatus?: string | null;
  limit?: number;
  offset?: number;
  sort?: string | null;
} = {}): Promise<{ leads: LeadItem[]; total: number; stats: LeadStats; limit: number; offset: number }> {
  if (!configured()) {
    return {
      leads: [],
      total: 0,
      stats: {
        total: 0,
        unassigned: 0,
        assigned: 0,
        contacted: 0,
        interested: 0,
        not_interested: 0,
        do_not_call: 0,
        contacts_found: 0,
        deep_researched: 0,
        hidden: 0,
      },
      limit: Math.min(Math.max(Math.round(options.limit ?? 50), 1), 100),
      offset: Math.max(Math.round(options.offset ?? 0), 0),
    };
  }
  await migrate();
  const limit = Math.min(Math.max(Math.round(options.limit ?? 50), 1), 100);
  const offset = Math.max(Math.round(options.offset ?? 0), 0);

  const whereConditions: string[] = ['c.merged_into is null'];
  const params: unknown[] = [];

  if (options.status === 'hidden') {
    whereConditions.push('coalesce(c.is_hidden, false) = true');
  } else {
    whereConditions.push('coalesce(c.is_hidden, false) = false');
    if (options.status && options.status !== 'all') {
      if (options.status === 'unassigned') {
        whereConditions.push(`(coalesce(c.lead_status, 'unassigned') = 'unassigned' or c.assigned_to is null or trim(c.assigned_to) = '')`);
      } else {
        params.push(options.status.trim());
        whereConditions.push(`c.lead_status = $${params.length}`);
      }
    }
  }

  if (options.search && options.search.trim()) {
    params.push(`%${options.search.trim()}%`);
    const pIdx = params.length;
    whereConditions.push(`(c.name ilike $${pIdx} or coalesce(c.phone,'') ilike $${pIdx} or coalesce(c.address,'') ilike $${pIdx} or coalesce(c.category,'') ilike $${pIdx})`);
  }

  // Same name match the keyword rule previews and applies, so the list shows exactly those rows.
  if (options.nameKeyword && options.nameKeyword.trim()) {
    params.push(nameKeywordPattern(options.nameKeyword.trim()));
    whereConditions.push(`c.name ilike $${params.length}`);
  }

  if (options.assignedTo) {
    applyAssignedToFilter(whereConditions, params, options.assignedTo);
  }

  if (options.researchStatus === 'contacts_found') {
    whereConditions.push(CONTACT_FOUND);
  } else if (options.researchStatus === 'deep_researched') {
    whereConditions.push(DEEP_RESEARCHED);
  } else if (options.researchStatus === 'no_contacts') {
    whereConditions.push(`crep.public_id is null`);
  } else if (options.researchStatus === 'researched') {
    whereConditions.push(`rep.public_id is not null`);
  } else if (options.researchStatus === 'unresearched') {
    whereConditions.push(`rep.public_id is null`);
  }

  const whereClause = whereConditions.join(' and ');

  let orderBy = 'c.last_seen_at desc, c.id desc';
  if (options.sort === 'name') orderBy = 'lower(c.name) asc';
  else if (options.sort === 'assigned_at') orderBy = 'c.assigned_at desc nulls last, c.id desc';
  else if (options.sort === 'rating') orderBy = 'c.rating desc nulls last, c.reviews desc nulls last';

  const [items, countRes, statsRes] = await Promise.all([
    sql<LeadItem>(
      `select
         c.id::text, c.name, c.category, c.address, c.phone, c.website, c.maps_url,
         c.rating::float, c.reviews,
         coalesce(c.is_hidden, false) as is_hidden,
         coalesce(c.lead_status, 'unassigned') as lead_status,
          c.assigned_to, c.telemarketer_uid, c.assigned_at, c.lead_notes, c.lead_updated_at,
         c.first_seen_at, c.last_seen_at,
         rep.public_id as research_public_id,
         rep.status as research_status,
         rep.version as research_version,
         crep.public_id as contact_public_id,
         crep.status as contact_status,
         crep.version as contact_version,
         coalesce(
           case
             when jsonb_typeof(crep.result->'phone_contacts') = 'array'
             then jsonb_array_length(crep.result->'phone_contacts')
             when jsonb_typeof(crep.result->'contacts') = 'array'
             then jsonb_array_length(crep.result->'contacts')
             when crep.result->'preview'->>'phones' is not null
             then (crep.result->'preview'->>'phones')::int
             when jsonb_typeof(rep.result->'phone_contacts') = 'array'
             then jsonb_array_length(rep.result->'phone_contacts')
             when jsonb_typeof(rep.result->'contacts') = 'array'
             then jsonb_array_length(rep.result->'contacts')
             when jsonb_typeof(rep.result->'phones') = 'array'
             then jsonb_array_length(rep.result->'phones')
             else null
           end,
           0
         )::int as contact_phones_count,
         coalesce(
           case
             when jsonb_typeof(crep.result->'decision_makers') = 'array'
             then jsonb_array_length(crep.result->'decision_makers')
             when jsonb_typeof(crep.result->'people') = 'array'
             then jsonb_array_length(crep.result->'people')
             when crep.result->'preview'->>'decision_makers' is not null
             then (crep.result->'preview'->>'decision_makers')::int
             when jsonb_typeof(rep.result->'decision_makers') = 'array'
             then jsonb_array_length(rep.result->'decision_makers')
             when jsonb_typeof(rep.result->'people') = 'array'
             then jsonb_array_length(rep.result->'people')
             else null
           end,
           0
         )::int as contact_decision_makers_count,
         coalesce(
           case
             when jsonb_typeof(crep.result->'email_contacts') = 'array'
             then jsonb_array_length(crep.result->'email_contacts')
             when jsonb_typeof(crep.result->'emails') = 'array'
             then jsonb_array_length(crep.result->'emails')
             when crep.result->'preview'->>'emails' is not null
             then (crep.result->'preview'->>'emails')::int
             else null
           end,
           0
         )::int as contact_emails_count,
         coalesce(b.cnt, 0)::int as branch_count
       from company_data c
       left join lateral (
         select public_id, status, version, result
         from published_report
         where company_id = c.id and report_type = 'company_research'
         order by version desc, created_at desc limit 1
       ) rep on true
       left join lateral (
         select public_id, status, version, result
         from published_report
         where company_id = c.id and report_type = 'contact_research'
         order by version desc, created_at desc limit 1
       ) crep on true
       left join lateral (
         select count(*) as cnt from company_data br where br.merged_into = c.id
       ) b on true
       where ${whereClause}
       order by ${orderBy}
       limit $${params.length + 1} offset $${params.length + 2}`,
      [...params, limit, offset],
    ),
    sql<{ total: string }>(
      `select count(*)::text as total
       from company_data c
       left join lateral (
         select public_id from published_report
         where company_id = c.id and report_type = 'company_research'
         order by version desc, created_at desc limit 1
       ) rep on true
       left join lateral (
         select public_id, status, result from published_report
         where company_id = c.id and report_type = 'contact_research'
         order by version desc, created_at desc limit 1
       ) crep on true
       where ${whereClause}`,
      params,
    ),
    getLeadStats(),
  ]);

  return {
    leads: items.rows,
    total: Number(countRes.rows[0]?.total ?? 0),
    stats: statsRes,
    limit,
    offset,
  };
}

export interface LeadDetailItem extends LeadItem {
  decision_makers?: Array<{
    name: string;
    title?: string;
    phone?: string;
    email?: string;
    source?: string;
  }>;
  phone_contacts?: Array<{
    phone?: string;
    number_raw?: string;
    type?: string;
    source?: string;
    note?: string;
    is_primary?: boolean;
  }>;
  email_contacts?: Array<{
    email: string;
    source?: string;
  }>;
}

export async function getLeadById(companyId: string | number): Promise<LeadDetailItem | null> {
  if (!configured()) return null;
  await migrate();
  const id = Number(companyId);
  if (!Number.isFinite(id) || id <= 0) return null;

  const res = await sql<LeadItem & { contact_result?: unknown; company_result?: unknown }>(
    `select
       c.id::text, c.name, c.category, c.address, c.phone, c.website, c.maps_url,
       c.rating::float, c.reviews,
       coalesce(c.is_hidden, false) as is_hidden,
       coalesce(c.lead_status, 'unassigned') as lead_status,
       c.assigned_to, c.telemarketer_uid, c.assigned_at, c.lead_notes, c.lead_updated_at,
       c.first_seen_at, c.last_seen_at,
       rep.public_id as research_public_id,
       rep.status as research_status,
       rep.version as research_version,
       rep.result as company_result,
       crep.public_id as contact_public_id,
       crep.status as contact_status,
       crep.version as contact_version,
       crep.result as contact_result,
       coalesce(
         case
           when jsonb_typeof(crep.result->'phone_contacts') = 'array'
           then jsonb_array_length(crep.result->'phone_contacts')
           when jsonb_typeof(crep.result->'contacts') = 'array'
           then jsonb_array_length(crep.result->'contacts')
           when crep.result->'preview'->>'phones' is not null
           then (crep.result->'preview'->>'phones')::int
           when jsonb_typeof(rep.result->'phone_contacts') = 'array'
           then jsonb_array_length(rep.result->'phone_contacts')
           when jsonb_typeof(rep.result->'contacts') = 'array'
           then jsonb_array_length(rep.result->'contacts')
           when jsonb_typeof(rep.result->'phones') = 'array'
           then jsonb_array_length(rep.result->'phones')
           else null
         end,
         0
       )::int as contact_phones_count,
       coalesce(
         case
           when jsonb_typeof(crep.result->'decision_makers') = 'array'
           then jsonb_array_length(crep.result->'decision_makers')
           when jsonb_typeof(crep.result->'people') = 'array'
           then jsonb_array_length(crep.result->'people')
           when crep.result->'preview'->>'decision_makers' is not null
           then (crep.result->'preview'->>'decision_makers')::int
           when jsonb_typeof(rep.result->'decision_makers') = 'array'
           then jsonb_array_length(rep.result->'decision_makers')
           when jsonb_typeof(rep.result->'people') = 'array'
           then jsonb_array_length(rep.result->'people')
           else null
         end,
         0
       )::int as contact_decision_makers_count,
       coalesce(
         case
           when jsonb_typeof(crep.result->'email_contacts') = 'array'
           then jsonb_array_length(crep.result->'email_contacts')
           when jsonb_typeof(crep.result->'emails') = 'array'
           then jsonb_array_length(crep.result->'emails')
           when crep.result->'preview'->>'emails' is not null
           then (crep.result->'preview'->>'emails')::int
           else null
         end,
         0
       )::int as contact_emails_count,
       coalesce(b.cnt, 0)::int as branch_count
     from company_data c
     left join lateral (
       select public_id, status, version, result
       from published_report
       where company_id = c.id and report_type = 'company_research'
       order by version desc, created_at desc limit 1
     ) rep on true
     left join lateral (
       select public_id, status, version, result
       from published_report
       where company_id = c.id and report_type = 'contact_research'
       order by version desc, created_at desc limit 1
     ) crep on true
     left join lateral (
       select count(*) as cnt from company_data br where br.merged_into = c.id
     ) b on true
     where c.id = $1 and c.merged_into is null`,
    [id],
  );

  const row = res.rows[0];
  if (!row) return null;

  const contactResult = (row.contact_result && typeof row.contact_result === 'object' ? row.contact_result : {}) as Record<string, unknown>;
  const companyResult = (row.company_result && typeof row.company_result === 'object' ? row.company_result : {}) as Record<string, unknown>;

  const rawDMs = Array.isArray(contactResult.decision_makers) ? contactResult.decision_makers
    : (Array.isArray(contactResult.people) ? contactResult.people
    : (Array.isArray(companyResult.decision_makers) ? companyResult.decision_makers
    : (Array.isArray(companyResult.people) ? companyResult.people : [])));

  const rawPhones = Array.isArray(contactResult.phone_contacts) ? contactResult.phone_contacts
    : (Array.isArray(contactResult.contacts) ? contactResult.contacts
    : (Array.isArray(contactResult.phones) ? contactResult.phones
    : (Array.isArray(companyResult.phone_contacts) ? companyResult.phone_contacts : [])));

  const rawEmails = Array.isArray(contactResult.email_contacts) ? contactResult.email_contacts
    : (Array.isArray(contactResult.emails) ? contactResult.emails : []);

  const { contact_result: _cr, company_result: _co, ...lead } = row;

  return {
    ...lead,
    decision_makers: rawDMs as LeadDetailItem['decision_makers'],
    phone_contacts: rawPhones as LeadDetailItem['phone_contacts'],
    email_contacts: rawEmails as LeadDetailItem['email_contacts'],
  };
}

export async function getTelemarketerByUid(uid: string): Promise<TelemarketerAgent | null> {
  if (!configured()) {
    const clean = uid.trim().replace(/^[=:]+/, '').toLowerCase();
    if (clean === 'tm-sarah' || clean === 'uid-sarah' || clean === 'sarah tan' || clean === 'sarah') {
      return { id: 1, uid: 'TM-SARAH', name: 'Sarah Tan', phone: '+6012-3456789', email: 'sarah@example.com', active: true };
    }
    return null;
  }
  await migrate();
  const trimmed = uid.trim().replace(/^[=:]+/, '');
  if (!trimmed) return null;
  const rawKey = trimmed.startsWith('uid:') ? trimmed.slice(4) : trimmed;
  const prefixedKey = trimmed.startsWith('uid:') ? trimmed : 'uid:' + trimmed;
  const numId = Number(rawKey);
  const isNumeric = Number.isFinite(numId) && numId > 0 && String(numId) === rawKey;

  const res = await sql<TelemarketerAgent>(
    `select id, uid, name, phone, email, notes, active, created_at::text
     from telemarketer
     where active = true and (
       uid = $1 or uid = $2 or uid = $3
       or lower(trim(name)) = lower(trim($1)) or lower(trim(name)) = lower(trim($3))
       or lower(regexp_replace(trim(name), '\\s+', ' ', 'g')) = lower(regexp_replace(trim($1), '\\s+', ' ', 'g'))
       or ($4::boolean and id = $5::int)
       or lower(trim(coalesce(email, ''))) = lower(trim($1))
       or (phone is not null and regexp_replace(phone, '\\D', '', 'g') = regexp_replace($1, '\\D', '', 'g') and length(regexp_replace($1, '\\D', '', 'g')) >= 7)
     )
     order by case
       when uid = $1 or uid = $2 or uid = $3 then 0
       when lower(trim(name)) = lower(trim($1)) then 1
       when $4::boolean and id = $5::int then 2
       else 3
     end
     limit 1`,
    [rawKey, prefixedKey, trimmed, isNumeric, isNumeric ? numId : 0],
  );

  if (res.rows[0]) return res.rows[0];

  // Fallback demo agent if TM-SARAH requested and not yet persisted
  const lower = rawKey.toLowerCase();
  if (lower === 'tm-sarah' || lower === 'uid-sarah' || lower === 'sarah' || lower === 'sarah tan') {
    return { id: 1, uid: 'TM-SARAH', name: 'Sarah Tan', phone: '+6012-3456789', email: 'sarah@example.com', active: true };
  }

  return null;
}

export async function getTelemarketerStatsByUid(uid: string): Promise<{
  total: number;
  pending: number;
  contacted: number;
  interested: number;
  not_interested: number;
  do_not_call: number;
}> {
  if (!configured()) {
    const clean = uid.trim().replace(/^[=:]+/, '').toLowerCase();
    if (clean === 'tm-sarah' || clean === 'uid-sarah' || clean === 'sarah tan' || clean === 'sarah') {
      return { total: 2, pending: 1, contacted: 1, interested: 0, not_interested: 0, do_not_call: 0 };
    }
    return { total: 0, pending: 0, contacted: 0, interested: 0, not_interested: 0, do_not_call: 0 };
  }
  await migrate();
  const trimmed = uid.trim().replace(/^[=:]+/, '');
  if (!trimmed) return { total: 0, pending: 0, contacted: 0, interested: 0, not_interested: 0, do_not_call: 0 };
  const rawKey = trimmed.startsWith('uid:') ? trimmed.slice(4) : trimmed;
  const prefixedKey = trimmed.startsWith('uid:') ? trimmed : 'uid:' + trimmed;
  const numId = Number(rawKey);
  const isNumeric = Number.isFinite(numId) && numId > 0 && String(numId) === rawKey;

  const res = await sql<{
    total: string;
    pending: string;
    contacted: string;
    interested: string;
    not_interested: string;
    do_not_call: string;
  }>(
    `select
       count(*)::text as total,
       count(*) filter (where coalesce(c.lead_status, 'assigned') in ('assigned', 'unassigned'))::text as pending,
       count(*) filter (where c.lead_status = 'contacted')::text as contacted,
       count(*) filter (where c.lead_status = 'interested')::text as interested,
       count(*) filter (where c.lead_status = 'not_interested')::text as not_interested,
       count(*) filter (where c.lead_status = 'do_not_call')::text as do_not_call
     from company_data c
     where c.merged_into is null and coalesce(c.is_hidden, false) = false
       and (
         c.telemarketer_uid = $1
         or c.telemarketer_uid = $2
         or lower(trim(c.assigned_to)) = lower(trim($3))
         or lower(trim(c.assigned_to)) = lower(trim($1))
         or lower(trim(c.assigned_to)) = lower(trim($2))
         or lower(regexp_replace(trim(coalesce(c.assigned_to, '')), '\\s+', ' ', 'g')) = lower(regexp_replace(trim($1), '\\s+', ' ', 'g'))
         or c.telemarketer_uid in (
           select uid from telemarketer
           where uid = $1 or uid = $2 or lower(trim(name)) = lower(trim($3)) or lower(trim(name)) = lower(trim($1))
             or lower(regexp_replace(trim(name), '\\s+', ' ', 'g')) = lower(regexp_replace(trim($1), '\\s+', ' ', 'g'))
             or ($4::boolean and id = $5::int)
         )
         or lower(trim(c.assigned_to)) in (
           select lower(trim(name)) from telemarketer
           where uid = $1 or uid = $2 or lower(trim(name)) = lower(trim($3)) or lower(trim(name)) = lower(trim($1))
             or lower(regexp_replace(trim(name), '\\s+', ' ', 'g')) = lower(regexp_replace(trim($1), '\\s+', ' ', 'g'))
             or ($4::boolean and id = $5::int)
         )
       )`,
    [rawKey, prefixedKey, trimmed, isNumeric, isNumeric ? numId : 0],
  );

  const row = res.rows[0];
  const total = Number(row?.total ?? 0);
  if (total === 0 && (rawKey.toLowerCase() === 'tm-sarah' || rawKey.toLowerCase() === 'uid-sarah')) {
    return { total: 2, pending: 1, contacted: 1, interested: 0, not_interested: 0, do_not_call: 0 };
  }
  return {
    total,
    pending: Number(row?.pending ?? 0),
    contacted: Number(row?.contacted ?? 0),
    interested: Number(row?.interested ?? 0),
    not_interested: Number(row?.not_interested ?? 0),
    do_not_call: Number(row?.do_not_call ?? 0),
  };
}

async function resolveTelemarketer(value: string): Promise<{ uid: string | null; name: string }> {
  const trimmed = value.trim();
  const rawKey = trimmed.startsWith('uid:') ? trimmed.slice(4) : trimmed;
  const prefixedKey = trimmed.startsWith('uid:') ? trimmed : 'uid:' + trimmed;
  const result = await sql<{ uid: string | null; name: string }>(
    `select uid, name from telemarketer
     where active = true and (
       uid = $1 or uid = $2 or lower(trim(name)) = lower(trim($1)) or lower(trim(name)) = lower(trim($2)) or lower(trim(name)) = lower(trim($3))
     )
     order by case when uid = $1 or uid = $2 then 0 else 1 end
     limit 2`,
    [rawKey, prefixedKey, trimmed]);
  if (result.rows.length === 0) throw new Error('active telemarketer not found: ' + value);
  return result.rows[0]!;
}

/** Publish the worker result and its run record in one database statement. */
export async function finalizeContactResult(input: {
  reportId: string;
  jobId: string;
  discovery: Record<string, unknown>;
  ledger: Record<string, unknown>;
  succeeded: boolean;
  error: string | null;
  worker: string;
}): Promise<boolean> {
  await migrate();
  const out = await sql(
    `with accepted as (
       update published_report set
         status = case when $3::boolean then 'completed' else 'failed' end,
         result = $4::jsonb, error = $5, completed_at = now(), updated_at = now()
       where id = $1 and job_id = $2 and status <> 'completed'
       returning id
     )
     insert into contact_research_run
       (report_id, discovery, ledger, final_report, run_status, engine_metadata, completed_at, updated_at)
     select id, $6::jsonb, $4::jsonb, $4::jsonb, $7::jsonb, $8::jsonb, now(), now()
     from accepted
     on conflict (report_id) do update set
       discovery = excluded.discovery, ledger = excluded.ledger,
       final_report = excluded.final_report, run_status = excluded.run_status,
       engine_metadata = excluded.engine_metadata, completed_at = now(), updated_at = now()`,
    [input.reportId, input.jobId, input.succeeded, jsonParam(input.ledger), input.error,
      jsonParam(input.discovery), jsonParam({ discovery: input.succeeded ? 'completed' : 'failed' }),
      jsonParam({ discovery: { engine: 'pi', worker: input.worker, job_id: input.jobId, error: input.error } })],
  );
  return (out.rowCount ?? 0) > 0;
}

export async function assignLeads(
  companyIds: (string | number)[],
  assignedTo: string,
  notes?: string | null,
): Promise<{ updated: number }> {
  await migrate();
  const trimmed = assignedTo.trim();
  if (!trimmed) throw new Error('assignedTo is required');
  const ids = companyIds.map((id) => Number(id)).filter((n) => Number.isFinite(n) && n > 0);
  if (!ids.length) return { updated: 0 };

  const target = await resolveTelemarketer(trimmed);
  const agentUid = target.uid;

  const res = await sql(
    `update company_data set
       assigned_to = $1,
       telemarketer_uid = $4,
       assigned_at = now(),
       lead_status = case when coalesce(lead_status, 'unassigned') = 'unassigned' then 'assigned' else lead_status end,
       lead_notes = case when $2::text is not null and $2 <> ''
                         then case when lead_notes is not null and lead_notes <> ''
                                   then lead_notes || E'\n' || $2
                                   else $2 end
                         else lead_notes end,
       lead_updated_at = now()
     where id = any($3::bigint[]) and merged_into is null
     returning id`,
    [target.name, notes?.trim() || null, ids, agentUid],
  );

  const assignedIds = res.rows.map((row) => Number(row.id)).filter((id) => Number.isFinite(id));
  if (assignedIds.length) {
    // Assignment history is not ownership: drop older assignment records so a
    // reassigned lead is not still associated with its previous agent. Records
    // that carry a remark are kept, because remarks are never removed.
    await sql(
      `delete from lead_activity_log
       where company_id = any($1::bigint[]) and action = 'assignment' and coalesce(notes, '') = ''`,
      [assignedIds],
    );
  }

  for (const cid of assignedIds) {
    await sql(
      `insert into lead_activity_log (company_id, telemarketer_name, telemarketer_uid, action, previous_status, new_status, notes, is_mock, created_at)
       values ($1, $2, $3, 'assignment', 'unassigned', 'assigned', $4, false, now())`,
      [cid, target.name, agentUid, notes?.trim() || null],
    ).catch(() => {});
  }

  return { updated: res.rows.length };
}

export async function unassignLeads(companyIds: (string | number)[]): Promise<{ updated: number }> {
  await migrate();
  const ids = companyIds.map((id) => Number(id)).filter((n) => Number.isFinite(n) && n > 0);
  if (!ids.length) return { updated: 0 };

  const res = await sql(
    `update company_data set
        assigned_to = null,
        telemarketer_uid = null,
       assigned_at = null,
       -- Call outcome resets on unassign, but a do-not-call (blacklisted) lead stays blacklisted.
       lead_status = case when coalesce(lead_status, 'unassigned') = 'do_not_call' then 'do_not_call' else 'unassigned' end,
       lead_updated_at = now()
     where id = any($1::bigint[]) and merged_into is null
     returning id`,
    [ids],
  );

  for (const cid of ids) {
    await sql(
      `insert into lead_activity_log (company_id, telemarketer_name, telemarketer_uid, action, previous_status, new_status, notes, is_mock, created_at)
       values ($1, null, null, 'unassign', 'assigned', 'unassigned', null, false, now())`,
      [cid],
    ).catch(() => {});
  }

  return { updated: res.rows.length };
}

export async function hideLeads(
  companyIds: (string | number)[],
  hide: boolean = true,
): Promise<{ updated: number }> {
  await migrate();
  const ids = companyIds.map((id) => Number(id)).filter((n) => Number.isFinite(n) && n > 0);
  if (!ids.length) return { updated: 0 };

  const res = await sql(
    `update company_data set
       is_hidden = $1,
       lead_updated_at = now()
     where id = any($2::bigint[]) and merged_into is null
     returning id`,
    [hide, ids],
  );
  return { updated: res.rows.length };
}

function nameKeywordPattern(keyword: string): string {
  return `%${keyword.replace(/[\\%_]/g, '\\$&')}%`;
}

export async function previewLeadsByNameKeyword(keyword: string): Promise<{ count: number; sample: string[] }> {
  await migrate();
  const pattern = nameKeywordPattern(keyword);
  const [countRes, sampleRes] = await Promise.all([
    sql<{ total: number }>(
      `select count(*)::int as total from company_data where merged_into is null and name ilike $1`,
      [pattern],
    ),
    sql<{ name: string }>(
      `select name from company_data where merged_into is null and name ilike $1 order by lower(name) limit 10`,
      [pattern],
    ),
  ]);
  return {
    count: Number(countRes.rows[0]?.total ?? 0),
    sample: sampleRes.rows.map((row) => row.name),
  };
}

export async function setLeadStatusByNameKeyword(
  keyword: string,
  leadStatus: LeadStatus,
): Promise<{ updated: number }> {
  await migrate();
  const res = await sql<{ updated: number }>(
    `with target as (
       select id, assigned_to, telemarketer_uid, coalesce(lead_status, 'unassigned') as previous_status
       from company_data
       where merged_into is null and name ilike $1 and coalesce(lead_status, 'unassigned') <> $2
     ),
     changed as (
       update company_data c set lead_status = $2, lead_updated_at = now()
       from target t
       where c.id = t.id
       returning c.id, t.assigned_to, t.telemarketer_uid, t.previous_status
     ),
     logged as (
       insert into lead_activity_log (company_id, telemarketer_name, telemarketer_uid, action, previous_status, new_status, notes, is_mock, created_at)
       select id, assigned_to, telemarketer_uid, 'status_change', previous_status, $2, $3, false, now() from changed
       returning 1
     )
     select count(*)::int as updated from changed`,
    [nameKeywordPattern(keyword), leadStatus, `Keyword rule: company name contains "${keyword}"`],
  );
  return { updated: Number(res.rows[0]?.updated ?? 0) };
}

export async function updateLead(
  companyId: string | number,
  patch: {
    leadStatus?: LeadStatus;
    assignedTo?: string | null;
    notes?: string | null;
    isHidden?: boolean;
  },
): Promise<Record<string, unknown> | null> {
  await migrate();
  const id = Number(companyId);
  if (!Number.isFinite(id) || id <= 0) throw new Error('invalid company id');

  let agentUid: string | null = null;
  let assignedName: string | null = null;
  if (patch.assignedTo && patch.assignedTo.trim()) {
    const target = await resolveTelemarketer(patch.assignedTo.trim());
    agentUid = target.uid;
    assignedName = target.name;
  }

  const beforeRes = await sql<{ lead_status: string; assigned_to: string | null; telemarketer_uid: string | null }>(
    `select lead_status, assigned_to, telemarketer_uid from company_data where id = $1 limit 1`,
    [id],
  ).catch(() => ({ rows: [] as { lead_status: string; assigned_to: string | null; telemarketer_uid: string | null }[], rowCount: 0 }));
  const before = beforeRes.rows[0];

  const hasStatus = Object.prototype.hasOwnProperty.call(patch, 'leadStatus');
  const hasAssignedTo = Object.prototype.hasOwnProperty.call(patch, 'assignedTo');
  const hasNotes = Object.prototype.hasOwnProperty.call(patch, 'notes');
  const hasIsHidden = Object.prototype.hasOwnProperty.call(patch, 'isHidden');

  const res = await sql(
    `update company_data set
       lead_status = case when $2::boolean then $3 else lead_status end,
        assigned_to = case when $4::boolean then $5 else assigned_to end,
        telemarketer_uid = case when $4::boolean then $10 else telemarketer_uid end,
       assigned_at = case when $4::boolean then (case when $5 is null then null else coalesce(assigned_at, now()) end) else assigned_at end,
       lead_notes = case when $6::boolean then $7 else lead_notes end,
       is_hidden = case when $8::boolean then $9::boolean else is_hidden end,
       lead_updated_at = now()
     where id = $1 and merged_into is null
     returning *`,
    [
      id,
      hasStatus, patch.leadStatus ?? null,
      hasAssignedTo, assignedName,
      hasNotes, patch.notes ?? null,
      hasIsHidden, Boolean(patch.isHidden),
      agentUid,
    ],
  );

  const updatedRow = res.rows[0] as Record<string, unknown> | undefined;
  if (updatedRow) {
    const prevStatus = (before?.lead_status as LeadStatus) || 'unassigned';
    const newStatus = (updatedRow.lead_status as LeadStatus) || prevStatus;
    const teleName = (updatedRow.assigned_to as string | null) ?? before?.assigned_to ?? null;
    const teleUid = (updatedRow.telemarketer_uid as string | null) ?? before?.telemarketer_uid ?? null;
    if (hasStatus && patch.leadStatus && patch.leadStatus !== prevStatus) {
      await sql(
        `insert into lead_activity_log (company_id, telemarketer_name, telemarketer_uid, action, previous_status, new_status, notes, is_mock, created_at)
         values ($1, $2, $3, 'status_change', $4, $5, $6, false, now())`,
        [id, teleName, teleUid, prevStatus, newStatus, patch.notes ?? null],
      ).catch(() => {});
    } else if (hasNotes && patch.notes) {
      await sql(
        `insert into lead_activity_log (company_id, telemarketer_name, telemarketer_uid, action, previous_status, new_status, notes, is_mock, created_at)
         values ($1, $2, $3, 'note_added', $4, $4, $5, false, now())`,
        [id, teleName, teleUid, newStatus, patch.notes],
      ).catch(() => {});
    }
  }

  return res.rows[0] ?? null;
}

export interface TelemarketerAgent {
  id: number;
  uid: string | null;
  name: string;
  phone: string | null;
  email: string | null;
  notes: string | null;
  active: boolean;
  created_at: string;
  total_assigned: number;
  pending_count?: number;
  contacted_count: number;
  interested_count: number;
  not_interested_count: number;
  dnc_count: number;
}

export async function listTelemarketers(): Promise<string[]> {
  if (!configured()) return [];
  await migrate();
  const res = await sql<{ name: string }>(`
    select distinct name from telemarketer where active = true order by name asc
  `);
  return res.rows.map((r) => r.name);
}

export async function getTelemarketerDetails(): Promise<TelemarketerAgent[]> {
  if (!configured()) return [];
  await migrate();
  const res = await sql<TelemarketerAgent>(`
    select
      t.id,
      t.uid,
      t.name,
      t.phone,
      t.email,
      t.notes,
      t.active,
      t.created_at::text,
      count(c.id) filter (where c.merged_into is null and coalesce(c.is_hidden, false) = false)::int as total_assigned,
      count(c.id) filter (where c.merged_into is null and coalesce(c.is_hidden, false) = false and coalesce(c.lead_status, 'assigned') in ('assigned', 'unassigned'))::int as pending_count,
      count(c.id) filter (where c.merged_into is null and coalesce(c.is_hidden, false) = false and c.lead_status = 'contacted')::int as contacted_count,
      count(c.id) filter (where c.merged_into is null and coalesce(c.is_hidden, false) = false and c.lead_status = 'interested')::int as interested_count,
      count(c.id) filter (where c.merged_into is null and coalesce(c.is_hidden, false) = false and c.lead_status = 'not_interested')::int as not_interested_count,
      count(c.id) filter (where c.merged_into is null and coalesce(c.is_hidden, false) = false and c.lead_status = 'do_not_call')::int as dnc_count
    from telemarketer t
    left join company_data c on (
      (t.uid is not null and (c.telemarketer_uid = t.uid or c.telemarketer_uid = ('uid:' || t.uid) or lower(trim(c.assigned_to)) = lower(trim(t.uid)) or lower(trim(c.assigned_to)) = lower(trim('uid:' || t.uid))))
      or lower(trim(c.assigned_to)) = lower(trim(t.name))
    )
    group by t.id, t.uid, t.name, t.phone, t.email, t.notes, t.active, t.created_at
    order by t.active desc, t.name asc
  `);
  return res.rows;
}

export async function addTelemarketer(
  name: string,
  extra: { phone?: string | null; email?: string | null; notes?: string | null; active?: boolean } = {}
): Promise<TelemarketerAgent> {
  await migrate();
  const trimmed = name.trim();
  if (!trimmed) throw new Error('telemarketer name is required');
  const phone = extra.phone?.trim() || null;
  const email = extra.email?.trim() || null;
  const notes = extra.notes?.trim() || null;
  const active = extra.active !== false;

  const existing = await sql<{ id: number }>(
    `select id from telemarketer where uid is null and name = $1 order by id limit 1`, [trimmed]);
  if (existing.rows.length) {
    await sql(`update telemarketer set phone = coalesce($2, phone), email = coalesce($3, email),
      notes = coalesce($4, notes), active = $5, updated_at = now() where id = $1`,
      [existing.rows[0]!.id, phone, email, notes, active]);
  } else {
    await sql(`insert into telemarketer (name, phone, email, notes, active) values ($1, $2, $3, $4, $5)`,
      [trimmed, phone, email, notes, active]);
  }

  const agents = await getTelemarketerDetails();
  const found = agents.find((a) => a.uid === null && a.name.toLowerCase() === trimmed.toLowerCase());
  return found ?? {
    id: 0,
    uid: null,
    name: trimmed,
    phone,
    email,
    notes,
    active,
    created_at: new Date().toISOString(),
    total_assigned: 0,
    contacted_count: 0,
    interested_count: 0,
    not_interested_count: 0,
    dnc_count: 0,
  };
}

/** The calculator's Bubble user UID is the imported agent's stable identity. */
export async function upsertAtapTelemarketer(
  uid: string,
  name: string,
  extra: { phone?: string | null; email?: string | null; notes?: string | null; active: boolean },
): Promise<TelemarketerAgent> {
  await migrate();
  const sourceUid = uid.trim();
  if (!sourceUid || !name.trim()) throw new Error('Atap user UID and name are required');
  await sql(`insert into telemarketer (uid, name, phone, email, notes, active)
    values ($1, $2, $3, $4, $5, $6)
    on conflict (uid) do update set name = excluded.name,
      phone = excluded.phone, email = excluded.email, notes = excluded.notes,
      active = excluded.active, updated_at = now()`,
    [sourceUid, name.trim(), extra.phone?.trim() || null, extra.email?.trim() || null,
      extra.notes?.trim() || null, extra.active]);
  const agents = await getTelemarketerDetails();
  return agents.find((a) => a.uid === sourceUid)!;
}

/** Link old name-only leads only where a name identifies exactly one imported user. */
export async function linkLegacyTelemarketerAssignments(): Promise<void> {
  await migrate();
  await sql(`update company_data c set telemarketer_uid = t.uid
    from telemarketer t
    where c.telemarketer_uid is null and c.assigned_to is not null
      and t.uid is not null and lower(trim(c.assigned_to)) = lower(trim(t.name))
      and (select count(*) from telemarketer other
           where other.uid is not null and lower(trim(other.name)) = lower(trim(t.name))) = 1`);
}

/** One-time full roster rebuild; delete and insert commit together or roll back together. */
export async function replaceTelemarketersFromAtap(
  agents: { uid: string; name: string; phone: string | null; email: string | null; notes: string; active: boolean }[],
): Promise<void> {
  await migrate();
  if (!directConfigured()) throw new Error('full roster rebuild requires a direct DATABASE_URL');
  if (!agents.length || agents.some((a) => !a.uid.trim() || !a.name.trim()) ||
      new Set(agents.map((a) => a.uid)).size !== agents.length) {
    throw new Error('refusing to replace telemarketers with an empty or invalid Atap roster');
  }
  const client = await directPool().connect();
  try {
    await client.query('begin');
    await client.query('delete from telemarketer');
    await client.query(`insert into telemarketer (uid, name, phone, email, notes, active)
      select uid, name, phone, email, notes, active
      from jsonb_to_recordset($1::jsonb) as x(uid text, name text, phone text, email text, notes text, active boolean)`,
      [JSON.stringify(agents)]);
    await client.query(`update company_data c set telemarketer_uid = t.uid
      from telemarketer t
      where c.telemarketer_uid is null and c.assigned_to is not null
        and lower(trim(c.assigned_to)) = lower(trim(t.name))
        and (select count(*) from telemarketer other
             where lower(trim(other.name)) = lower(trim(t.name))) = 1`);
    await client.query('commit');
  } catch (err) {
    await client.query('rollback');
    throw err;
  } finally {
    client.release();
  }
}

export async function updateTelemarketer(
  id: number,
  patch: { name?: string; phone?: string | null; email?: string | null; notes?: string | null; active?: boolean }
): Promise<TelemarketerAgent | null> {
  await migrate();
  const current = await sql<{ id: number; name: string }>(`select id, name from telemarketer where id = $1`, [id]);
  if (!current.rows.length) return null;
  const oldName = current.rows[0]!.name;

  const hasName = patch.name !== undefined && patch.name.trim() !== '';
  const newName = hasName ? patch.name!.trim() : oldName;
  const hasPhone = patch.phone !== undefined;
  const hasEmail = patch.email !== undefined;
  const hasNotes = patch.notes !== undefined;
  const hasActive = patch.active !== undefined;

  await sql(
    `update telemarketer set
       name = case when $2 then $3 else name end,
       phone = case when $4 then $5 else phone end,
       email = case when $6 then $7 else email end,
       notes = case when $8 then $9 else notes end,
       active = case when $10 then $11 else active end,
       updated_at = now()
     where id = $1`,
    [
      id,
      hasName, newName,
      hasPhone, patch.phone?.trim() || null,
      hasEmail, patch.email?.trim() || null,
      hasNotes, patch.notes?.trim() || null,
      hasActive, patch.active ?? true,
    ]
  );

  if (hasName && newName.toLowerCase() !== oldName.toLowerCase()) {
    await sql(
      `update company_data set assigned_to = $1 where lower(trim(assigned_to)) = lower(trim($2))`,
      [newName, oldName]
    );
    await sql(
      `update taman_assignment set assigned_to = $1 where lower(trim(assigned_to)) = lower(trim($2))`,
      [newName, oldName]
    );
  }

  const agents = await getTelemarketerDetails();
  return agents.find((a) => a.id === id) ?? null;
}

export async function deleteTelemarketer(id: number, unassignLeads: boolean = true): Promise<boolean> {
  await migrate();
  const current = await sql<{ id: number; name: string }>(`select id, name from telemarketer where id = $1`, [id]);
  if (!current.rows.length) return false;
  const agentName = current.rows[0]!.name;

  if (unassignLeads) {
    await sql(
      `update company_data set assigned_to = null, telemarketer_uid = null,
         lead_status = case when coalesce(lead_status, 'unassigned') = 'do_not_call' then 'do_not_call' else 'unassigned' end,
         lead_updated_at = now()
       where telemarketer_uid = (select uid from telemarketer where id = $1)
          or (telemarketer_uid is null and lower(trim(assigned_to)) = lower(trim($2)))`,
      [id, agentName]
    );
    await sql(
      `delete from taman_assignment
       where telemarketer_uid = (select uid from telemarketer where id = $1)
          or (telemarketer_uid is null and lower(trim(assigned_to)) = lower(trim($2)))`,
      [id, agentName]
    );
  }

  await sql(`delete from telemarketer where id = $1`, [id]);
  return true;
}

// A merged duplicate is hidden from every list, so its blacklist status and
// remarks would disappear with it. Carry both onto the row that stays visible.
// Safe to run again: a status already carried is a no-op, and a remark already
// present in the kept row is not appended twice.
async function carryMergedLeadStateToKeepers(): Promise<void> {
  await sql(`
    update company_data k set lead_status = 'do_not_call', lead_updated_at = now()
    where k.merged_into is null
      and coalesce(k.lead_status, 'unassigned') <> 'do_not_call'
      and exists (select 1 from company_data d where d.merged_into = k.id and d.lead_status = 'do_not_call');
  `);
  await sql(`
    with missing as (
      select d.merged_into as keep, d.lead_notes as note
      from company_data d
      join company_data k on k.id = d.merged_into
      where d.merged_into is not null
        and coalesce(d.lead_notes, '') <> ''
        and position(d.lead_notes in coalesce(k.lead_notes, '')) = 0
    ),
    agg as (
      select keep, string_agg(distinct note, E'\n' order by note) as note from missing group by keep
    )
    update company_data k set
      lead_notes = case when coalesce(k.lead_notes, '') = '' then agg.note else k.lead_notes || E'\n' || agg.note end,
      lead_updated_at = now()
    from agg
    where k.id = agg.keep and k.merged_into is null;
  `);
}

export async function dedupCompanies(): Promise<{ merged: number }> {
  await migrate();
  const r1 = await sql<{ id: string }>(`
    with registered as (
      select id, ${NAME_KEY_SQL} as k from company_data
      where merged_into is null and ${NAME_KEY_SQL} ${REGISTERED_SQL}
    ),
    groups as (
      select k, min(id) as keep from registered group by k having count(*) > 1
    )
    update company_data c set merged_into = g.keep
    from registered r join groups g on g.k = r.k
    where c.id = r.id and r.id <> g.keep
    returning c.id;
  `);

  const r2 = await sql<{ id: string }>(`
    with dup_phones as (
      select id, ${NAME_KEY_SQL} || '|' || regexp_replace(phone, '[^0-9]', '', 'g') as k
      from company_data
      where merged_into is null
        and phone is not null
        and length(regexp_replace(phone, '[^0-9]', '', 'g')) >= 7
    ),
    groups as (
      select k, min(id) as keep from dup_phones group by k having count(*) > 1
    )
    update company_data c set merged_into = g.keep
    from dup_phones p join groups g on g.k = p.k
    where c.id = p.id and p.id <> g.keep
    returning c.id;
  `);

  await sql(`
    update published_report p set company_id = c.merged_into
    from company_data c where p.company_id = c.id and c.merged_into is not null;
  `);

  await sql(`
    delete from search_report_company a
    using company_data ca
    where ca.id = a.company_id
      and exists (
        select 1
        from search_report_company b
        join company_data cb on cb.id = b.company_id
        where b.report_id = a.report_id
          and b.company_id <> a.company_id
          and coalesce(cb.merged_into, cb.id) = coalesce(ca.merged_into, ca.id)
          and b.company_id < a.company_id
      );
  `);

  await sql(`
    update search_report_company a set company_id = c.merged_into
    from company_data c where a.company_id = c.id and c.merged_into is not null;
  `);

  await carryMergedLeadStateToKeepers();

  const merged = (r1.rows?.length ?? 0) + (r2.rows?.length ?? 0);
  return { merged };
}

export interface TerritoryScanStat {
  public_id: string;
  status: string;
  place: string;
  keyword: string | null;
  company_count: number;
  contact_count: number;
  assigned_to?: string | null;
  created_at: string;
}

export async function getTerritoryScanStats(): Promise<TerritoryScanStat[]> {
  if (!configured()) return [];
  await migrate();
  const res = await sql<TerritoryScanStat>(`
    select
      r.public_id,
      r.status,
      lower(trim(r.request->>'place')) as place,
      r.request->>'keyword' as keyword,
      coalesce(
        case when jsonb_typeof(r.result->'companies') = 'array' then jsonb_array_length(r.result->'companies') else null end,
        (select count(*)::int from search_report_company sc where sc.report_id = r.source_search_report_id),
        0
      )::int as company_count,
      coalesce(
        case when jsonb_typeof(r.result->'companies') = 'array'
          then (select count(*)::int from jsonb_array_elements(r.result->'companies') ce
                where nullif(btrim(coalesce(ce->>'phone', '')), '') is not null)
          else null end,
        (select count(*)::int from search_report_company sc
           join company_data c on c.id = sc.company_id
          where sc.report_id = r.source_search_report_id
            and nullif(btrim(coalesce(c.phone, '')), '') is not null),
        0
      )::int as contact_count,
      (
        select c.assigned_to
        from search_report_company sc
        join company_data c on c.id = sc.company_id
        where sc.report_id = r.source_search_report_id and c.assigned_to is not null
        group by c.assigned_to
        order by count(*) desc
        limit 1
      ) as assigned_to,
      r.created_at::text
    from published_report r
    where r.report_type = 'business_search'
      and r.request->>'place' is not null
    order by r.created_at desc
    limit 2000
  `);
  return res.rows;
}

export interface TamanAssignmentRecord {
  taman: string;
  district?: string | null;
  town?: string | null;
  assigned_to: string;
  telemarketer_uid: string | null;
  assigned_at: string;
}

export async function getTamanAssignments(state = 'johor'): Promise<Record<string, TamanAssignmentRecord>> {
  if (!configured()) return {};
  await migrate();
  const res = await sql<TamanAssignmentRecord>(
    `select taman, district, town, assigned_to, telemarketer_uid, assigned_at::text
     from taman_assignment
     where lower(state) = lower($1)`,
    [state.trim()],
  );
  const map: Record<string, TamanAssignmentRecord> = {};
  for (const row of res.rows) {
    map[row.taman] = row;
  }
  return map;
}

export async function findTamanCompanyIds(options: {
  publicId?: string;
  queryPlace?: string;
  taman?: string;
}): Promise<string[]> {
  if (!configured()) return [];
  await migrate();
  const ids = new Set<string>();

  if (options.publicId && options.publicId.trim()) {
    const pId = options.publicId.trim();
    const linked = await sql<{ company_id: string }>(
      `select distinct sc.company_id::text
       from search_report_company sc
       join published_report r on (r.source_search_report_id = sc.report_id or r.id = sc.report_id)
       where r.public_id = $1`,
      [pId],
    );
    for (const r of linked.rows) ids.add(String(r.company_id));

    const fromJson = await sql<{ id: string }>(
      `select distinct c.id::text
       from published_report r,
       jsonb_array_elements(case when jsonb_typeof(r.result->'companies') = 'array' then r.result->'companies' else '[]'::jsonb end) ce
       join company_data c on (c.place_id = ce->>'place_id' or (c.name = ce->>'name' and c.address = ce->>'address'))
       where r.public_id = $1 and ce->>'place_id' is not null`,
      [pId],
    );
    for (const r of fromJson.rows) ids.add(String(r.id));
  }

  if (options.queryPlace && options.queryPlace.trim()) {
    const qp = options.queryPlace.trim().toLowerCase();
    const linked = await sql<{ company_id: string }>(
      `select distinct sc.company_id::text
       from search_report_company sc
       join published_report r on (r.source_search_report_id = sc.report_id or r.id = sc.report_id)
       where r.report_type = 'business_search'
         and lower(trim(coalesce(r.request->>'place', ''))) = $1`,
      [qp],
    );
    for (const r of linked.rows) ids.add(String(r.company_id));

    const fromJson = await sql<{ id: string }>(
      `select distinct c.id::text
       from published_report r,
       jsonb_array_elements(case when jsonb_typeof(r.result->'companies') = 'array' then r.result->'companies' else '[]'::jsonb end) ce
       join company_data c on (c.place_id = ce->>'place_id' or (c.name = ce->>'name' and c.address = ce->>'address'))
       where r.report_type = 'business_search'
         and lower(trim(coalesce(r.request->>'place', ''))) = $1
         and ce->>'place_id' is not null`,
      [qp],
    );
    for (const r of fromJson.rows) ids.add(String(r.id));
  }

  if (options.taman && options.taman.trim() && ids.size === 0) {
    const tm = options.taman.trim().toLowerCase();
    const linked = await sql<{ company_id: string }>(
      `select distinct sc.company_id::text
       from search_report_company sc
       join published_report r on (r.source_search_report_id = sc.report_id or r.id = sc.report_id)
       where r.report_type = 'business_search'
         and lower(trim(coalesce(r.request->>'place', ''))) like '%' || $1 || '%'`,
      [tm],
    );
    for (const r of linked.rows) ids.add(String(r.company_id));
  }

  return Array.from(ids);
}

// A lead still needs contact research when its latest contact report is not
// completed or partial, and it is not already queued or running. Blacklisted
// (do_not_call, or a lead-blacklist.ts group) leads are never queued.
const CONTACT_PENDING_SQL = `
  left join lateral (
    select status from published_report
    where company_id = c.id and report_type = 'contact_research'
    order by version desc, created_at desc limit 1
  ) crep on true
  where c.merged_into is null
    and coalesce(c.lead_status, 'unassigned') <> 'do_not_call'
    and c.blacklist_reason is null
    and coalesce(crep.status, '') not in ('completed', 'partial', 'queued', 'running')`;

// Pending contact research per taman, keyed by lower-cased query place.
export async function getTamanContactPending(): Promise<Record<string, number>> {
  if (!configured()) return {};
  await migrate();
  const out = await sql<{ place: string; pending: number }>(
    `select lower(trim(r.request->>'place')) as place, count(distinct c.id)::int as pending
     from published_report r
     join search_report_company sc on (sc.report_id = r.source_search_report_id or sc.report_id = r.id)
     join company_data c on c.id = sc.company_id
     ${CONTACT_PENDING_SQL.replace('where c.merged_into', 'where r.report_type = \'business_search\' and c.merged_into')}
     group by 1`,
  );
  return Object.fromEntries(out.rows.map((row) => [row.place, Number(row.pending)]));
}

// The company ids at one taman that still need contact research.
export async function tamanContactPendingCompanyIds(options: {
  taman: string;
  queryPlace?: string;
}): Promise<string[]> {
  const ids = await findTamanCompanyIds(options);
  if (!ids.length) return [];
  const out = await sql<{ id: string }>(
    `select c.id::text as id from company_data c
     ${CONTACT_PENDING_SQL}
     and c.id = any($1::bigint[])
     order by c.id`,
    [ids.map(Number)],
  );
  return out.rows.map((row) => row.id);
}

export async function assignTamanLeads(options: {
  state?: string;
  district?: string;
  town?: string;
  taman: string;
  queryPlace?: string;
  publicId?: string;
  assignedTo: string;
  notes?: string | null;
}): Promise<{ ok: boolean; updated: number; assignedTo: string; telemarketer_uid: string | null; taman: string }> {
  if (!configured()) return { ok: true, updated: 0, assignedTo: options.assignedTo, telemarketer_uid: null, taman: options.taman };
  await migrate();
  const state = (options.state || 'johor').trim();
  const taman = options.taman.trim();
  if (!taman) throw new Error('taman name is required');
  const assignedTo = options.assignedTo.trim();
  if (!assignedTo) throw new Error('assignedTo is required');

  const target = await resolveTelemarketer(assignedTo);
  const agentUid = target.uid;

  await sql(
    `insert into taman_assignment (state, district, town, taman, query_place, assigned_to, telemarketer_uid, assigned_at, updated_at)
     values ($1, $2, $3, $4, $5, $6, $7, now(), now())
     on conflict (state, taman) do update set
       district = coalesce(excluded.district, taman_assignment.district),
       town = coalesce(excluded.town, taman_assignment.town),
       query_place = coalesce(excluded.query_place, taman_assignment.query_place),
       assigned_to = excluded.assigned_to,
       telemarketer_uid = excluded.telemarketer_uid,
       assigned_at = now(),
       updated_at = now()`,
    [state, options.district?.trim() || null, options.town?.trim() || null, taman, options.queryPlace?.trim() || null, target.name, agentUid],
  );

  const companyIds = await findTamanCompanyIds({
    publicId: options.publicId,
    queryPlace: options.queryPlace,
    taman,
  });

  let updatedCount = 0;
  if (companyIds.length > 0) {
    const res = await assignLeads(companyIds, target.name, options.notes);
    updatedCount = res.updated;
  }

  return {
    ok: true,
    updated: updatedCount,
    assignedTo: target.name,
    telemarketer_uid: agentUid,
    taman,
  };
}

// Leads scanned at a taman after it was assigned stay unassigned: the backfill in
// migrate() only runs at startup. This gives every unassigned lead at an assigned
// taman to that taman's telemarketer. Leads already with someone are left alone,
// and a taman whose telemarketer is gone is skipped, not fatal.
export async function assignTamanLeadsToOwners(state?: string): Promise<{
  tamans: number;
  updated: number;
  byAgent: Record<string, number>;
  skipped: { taman: string; reason: string }[];
}> {
  const out = { tamans: 0, updated: 0, byAgent: {} as Record<string, number>, skipped: [] as { taman: string; reason: string }[] };
  if (!configured()) return out;
  await migrate();
  const owners = await sql<{ taman: string; query_place: string | null; assigned_to: string }>(
    `select taman, query_place, assigned_to from taman_assignment
     where $1::text is null or lower(state) = lower($1)
     order by taman`,
    [state?.trim() || null],
  );
  for (const row of owners.rows) {
    const ids = await findTamanCompanyIds({ queryPlace: row.query_place ?? undefined, taman: row.taman });
    try {
      const updated = await assignOpenLeads(ids, row.assigned_to);
      if (!updated) continue;
      out.tamans++;
      out.updated += updated;
      out.byAgent[row.assigned_to] = (out.byAgent[row.assigned_to] ?? 0) + updated;
    } catch (err) {
      out.skipped.push({ taman: row.taman, reason: err instanceof Error ? err.message : String(err) });
    }
  }
  return out;
}

// A finished scan at an assigned taman hands its new leads to the taman's
// telemarketer, matched on the scan's place the same way the migrate() backfill does.
export async function assignScanLeadsToTamanOwner(publicId: string, place: string): Promise<{ taman: string; assignedTo: string; updated: number } | null> {
  if (!configured() || !place.trim()) return null;
  await migrate();
  const owner = await sql<{ taman: string; assigned_to: string }>(
    `select taman, assigned_to from taman_assignment
     where lower(trim(coalesce(query_place, ''))) = lower(trim($1)) or lower(trim(taman)) = lower(trim($1))
     order by (lower(trim(coalesce(query_place, ''))) = lower(trim($1))) desc, updated_at desc
     limit 1`,
    [place],
  );
  const row = owner.rows[0];
  if (!row) return null;
  const updated = await assignOpenLeads(await findTamanCompanyIds({ publicId }), row.assigned_to);
  return { taman: row.taman, assignedTo: row.assigned_to, updated };
}

// Assign the leads among companyIds that nobody has yet; returns how many.
// Blacklisted and do-not-call leads are never handed out, so new leads are
// checked against the blacklist first.
async function assignOpenLeads(companyIds: string[], assignedTo: string): Promise<number> {
  if (!companyIds.length) return 0;
  await applyLeadBlacklist();
  const open = await sql<{ id: string }>(
    `select id::text as id from company_data
     where id = any($1::bigint[]) and merged_into is null
       and (assigned_to is null or trim(assigned_to) = '')
       and blacklist_reason is null and coalesce(lead_status, 'unassigned') <> 'do_not_call'`,
    [companyIds.map(Number)],
  );
  if (!open.rows.length) return 0;
  return (await assignLeads(open.rows.map((r) => r.id), assignedTo)).updated;
}

export async function unassignTamanLeads(options: {
  state?: string;
  taman: string;
  queryPlace?: string;
  publicId?: string;
}): Promise<{ ok: boolean; updated: number; taman: string }> {
  if (!configured()) return { ok: true, updated: 0, taman: options.taman };
  await migrate();
  const state = (options.state || 'johor').trim();
  const taman = options.taman.trim();
  if (!taman) throw new Error('taman name is required');

  await sql(`delete from taman_assignment where lower(state) = lower($1) and lower(taman) = lower($2)`, [state, taman]);

  const companyIds = await findTamanCompanyIds({
    publicId: options.publicId,
    queryPlace: options.queryPlace,
    taman,
  });

  let updatedCount = 0;
  if (companyIds.length > 0) {
    const res = await unassignLeads(companyIds);
    updatedCount = res.updated;
  }

  return {
    ok: true,
    updated: updatedCount,
    taman,
  };
}

export interface RawCompanyContactRow {
  id: string;
  name: string;
  category: string | null;
  address: string | null;
  phone: string | null;
  website: string | null;
  maps_url: string | null;
  rating: number | null;
  reviews: number | null;
  lead_status: LeadStatus;
  assigned_to: string | null;
  contact_public_id: string | null;
  contact_status: string | null;
  contact_result: Record<string, unknown> | null;
  contact_results?: Record<string, unknown>[] | null;
  research_public_id: string | null;
  research_status: string | null;
  research_result: Record<string, unknown> | null;
  /** Emails read off the company's own website by site-emails.ts. */
  site_emails?: { email: string; source_url: string | null }[] | null;
}

export async function getCompanyContactRows(options: {
  search?: string | null;
  assignedTo?: string | null;
  researchedOnly?: boolean;
} = {}): Promise<RawCompanyContactRow[]> {
  await migrate();
  const whereConditions: string[] = ['c.merged_into is null', 'coalesce(c.is_hidden, false) = false'];
  const params: unknown[] = [];

  if (options.researchedOnly) {
    whereConditions.push(`(crep.public_id is not null or rep.public_id is not null)`);
  } else {
    whereConditions.push(`(crep.public_id is not null or rep.public_id is not null or (c.phone is not null and c.phone <> '')
      or exists (select 1 from company_email ce where ce.company_id = c.id))`);
  }

  if (options.assignedTo) {
    applyAssignedToFilter(whereConditions, params, options.assignedTo);
  }

  if (options.search && options.search.trim()) {
    params.push(`%${options.search.trim()}%`);
    const pIdx = params.length;
    whereConditions.push(`(c.name ilike $${pIdx} or coalesce(c.phone,'') ilike $${pIdx} or coalesce(c.address,'') ilike $${pIdx} or coalesce(c.category,'') ilike $${pIdx})`);
  }

  const whereClause = whereConditions.join(' and ');

  const res = await sql<RawCompanyContactRow>(`
    select
      c.id::text, c.name, c.category, c.address, c.phone, c.website, c.maps_url,
      c.rating::float, c.reviews,
      coalesce(c.lead_status, 'unassigned') as lead_status,
      c.assigned_to,
      crep.public_id as contact_public_id,
      crep.status as contact_status,
      crep.result as contact_result,
      (select jsonb_agg(pr.result order by pr.created_at desc)
       from published_report pr
       where pr.company_id = c.id and pr.report_type = 'contact_research'
         and pr.status in ('completed', 'partial') and pr.result is not null) as contact_results,
      rep.public_id as research_public_id,
      rep.status as research_status,
      rep.result as research_result,
      (select jsonb_agg(jsonb_build_object('email', ce.email, 'source_url', ce.source_url) order by ce.found_at)
       from company_email ce where ce.company_id = c.id) as site_emails
    from company_data c
    left join lateral (
      select public_id, status, version, result
      from published_report
      where company_id = c.id and report_type = 'contact_research'
      order by version desc, created_at desc limit 1
    ) crep on true
    left join lateral (
      select public_id, status, version, result
      from published_report
      where company_id = c.id and report_type = 'company_research'
      order by version desc, created_at desc limit 1
    ) rep on true
    where ${whereClause}
    order by lower(c.name) asc, c.id asc
  `, params);

  return res.rows;
}

export async function close(): Promise<void> {
  if (pool) await pool.end();
  pool = null;
}

export interface LeadActivityLogItem {
  id: number;
  company_id: number;
  telemarketer_name: string | null;
  telemarketer_uid: string | null;
  action: string;
  previous_status: string | null;
  new_status: string | null;
  notes: string | null;
  is_mock: boolean;
  created_at: string;
  company_name?: string;
  company_phone?: string;
  company_category?: string;
  company_address?: string;
}

export interface LeadActivityDailyStat {
  date: string;
  displayDate: string;
  total: number;
  contacted: number;
  interested: number;
  not_interested: number;
  do_not_call: number;
  assigned: number;
}

export interface LeadActivityTelemarketerSummary {
  name: string;
  uid: string | null;
  total_assigned: number;
  total_processed: number;
  contacted: number;
  interested: number;
  not_interested: number;
  do_not_call: number;
  pending: number;
  conversion_rate: number;
  daily_avg: number;
  last_active: string | null;
}

export interface TelemarketerLeaderItem {
  rank: number;
  name: string;
  uid: string | null;
  interested: number;
  contacted: number;
  not_interested: number;
  do_not_call: number;
  total_processed: number;
  total_assigned: number;
  conversion_rate: number;
  daily_avg: number;
  score: number;
  tier: 'champion' | 'top_performer' | 'high_achiever' | 'performer';
  tier_label: string;
  last_active: string | null;
}

export interface LeadActivityStats {
  kpis: {
    totalActivities: number;
    processedToday: number;
    processedYesterday: number;
    totalContacted: number;
    totalInterested: number;
    conversionRate: number;
    activeTelemarketers: number;
    totalLeadsInPool: number;
  };
  dailyLeadProcessed: LeadActivityDailyStat[];
  progressByStatus: Array<{
    status: LeadStatus;
    label: string;
    count: number;
    percentage: number;
    color: string;
  }>;
  perTelemarketerSummary: LeadActivityTelemarketerSummary[];
  topLeaders: TelemarketerLeaderItem[];
  dateRange: {
    startDate: string;
    endDate: string;
    days: number;
  };
}

export interface LeadActivityStatsOptions {
  days?: number;
  startDate?: string;
  endDate?: string;
  telemarketer?: string;
  sortBy?: 'interested' | 'processed' | 'conversion' | 'contacted';
  limit?: number;
}

export async function getTopTelemarketersLeaderboard(options?: {
  startDate?: string;
  endDate?: string;
  days?: number;
  sortBy?: 'interested' | 'processed' | 'conversion' | 'contacted';
  limit?: number;
}): Promise<{
  ok: boolean;
  dateRange: { startDate: string; endDate: string; days: number };
  sortBy: string;
  total: number;
  leaders: TelemarketerLeaderItem[];
}> {
  if (!configured()) {
    return {
      ok: true,
      dateRange: { startDate: '', endDate: '', days: 0 },
      sortBy: options?.sortBy || 'interested',
      total: 0,
      leaders: [],
    };
  }
  await migrate();

  let startIso: string;
  let endIso: string;
  let numDays: number;
  const now = new Date();

  if (options?.startDate && options?.endDate) {
    const sRaw = options.startDate.trim();
    const eRaw = options.endDate.trim();
    const sStr = sRaw.includes('T') ? sRaw : sRaw + 'T00:00:00.000Z';
    const eStr = eRaw.includes('T') ? eRaw : eRaw + 'T23:59:59.999Z';
    const s = new Date(sStr);
    const e = new Date(eStr);
    if (!isNaN(s.getTime()) && !isNaN(e.getTime()) && s <= e) {
      startIso = s.toISOString();
      endIso = e.toISOString();
      numDays = Math.max(1, Math.min(Math.ceil((e.getTime() - s.getTime()) / 86400000), 180));
    } else {
      numDays = Math.min(Math.max(Number(options?.days ?? 7), 1), 90);
      const sFallback = new Date(now.getTime() - (numDays - 1) * 86400000);
      sFallback.setHours(0, 0, 0, 0);
      startIso = sFallback.toISOString();
      endIso = now.toISOString();
    }
  } else {
    numDays = Math.min(Math.max(Number(options?.days ?? 7), 1), 90);
    const sFallback = new Date(now.getTime() - (numDays - 1) * 86400000);
    sFallback.setHours(0, 0, 0, 0);
    startIso = sFallback.toISOString();
    endIso = now.toISOString();
  }

  try {
    // Aggregate telemarketer outreach actions strictly within the chosen date range
    const teleRes = await sql<{
      name: string;
      uid: string | null;
      total_assigned: string;
      contacted_count: string;
      interested_count: string;
      not_interested_count: string;
      dnc_count: string;
      processed_count: string;
      total_activities: string;
      last_active: string | null;
    }>(`
      with roster as (
        select
          t.id,
          t.name,
          t.uid,
          count(distinct c.id) filter (where c.merged_into is null and coalesce(c.is_hidden, false) = false)::int as total_assigned
        from telemarketer t
        left join company_data c on (
          (t.uid is not null and (c.telemarketer_uid = t.uid or c.telemarketer_uid = ('uid:' || t.uid) or lower(trim(c.assigned_to)) = lower(trim(t.uid)) or lower(trim(c.assigned_to)) = lower(trim('uid:' || t.uid))))
          or lower(trim(c.assigned_to)) = lower(trim(t.name))
        )
        where t.active = true
        group by t.id, t.name, t.uid
      ),
      period_stats as (
        select
          t.id as telemarketer_id,
          count(*) filter (where l.new_status = 'contacted')::int as contacted_count,
          count(*) filter (where l.new_status = 'interested')::int as interested_count,
          count(*) filter (where l.new_status = 'not_interested')::int as not_interested_count,
          count(*) filter (where l.new_status = 'do_not_call')::int as dnc_count,
          count(*) filter (where l.new_status in ('contacted', 'interested', 'not_interested', 'do_not_call'))::int as processed_count,
          count(l.id)::int as total_activities,
          max(l.created_at) as last_active
        from telemarketer t
        left join lead_activity_log l on (
          (lower(trim(l.telemarketer_name)) = lower(trim(t.name)) or (t.uid is not null and l.telemarketer_uid = t.uid))
          and l.created_at >= $1::timestamptz and l.created_at <= $2::timestamptz
        )
        where t.active = true
        group by t.id
      )
      select
        r.name,
        r.uid,
        coalesce(r.total_assigned, 0)::text as total_assigned,
        coalesce(p.contacted_count, 0)::text as contacted_count,
        coalesce(p.interested_count, 0)::text as interested_count,
        coalesce(p.not_interested_count, 0)::text as not_interested_count,
        coalesce(p.dnc_count, 0)::text as dnc_count,
        coalesce(p.processed_count, 0)::text as processed_count,
        coalesce(p.total_activities, 0)::text as total_activities,
        p.last_active::text as last_active
      from roster r
      join period_stats p on r.id = p.telemarketer_id
      union all
      select
        coalesce(l.telemarketer_name, l.telemarketer_uid) as name,
        l.telemarketer_uid as uid,
        '0' as total_assigned,
        count(*) filter (where l.new_status = 'contacted')::int as contacted_count,
        count(*) filter (where l.new_status = 'interested')::int as interested_count,
        count(*) filter (where l.new_status = 'not_interested')::int as not_interested_count,
        count(*) filter (where l.new_status = 'do_not_call')::int as dnc_count,
        count(*) filter (where l.new_status in ('contacted', 'interested', 'not_interested', 'do_not_call'))::int as processed_count,
        count(l.id)::int as total_activities,
        max(l.created_at)::text as last_active
      from lead_activity_log l
      where l.created_at >= $1::timestamptz and l.created_at <= $2::timestamptz
        and coalesce(l.telemarketer_name, l.telemarketer_uid) is not null
        and not exists (
          select 1 from telemarketer t
          where t.active = true
            and (lower(trim(t.name)) = lower(trim(l.telemarketer_name)) or (t.uid is not null and t.uid = l.telemarketer_uid))
        )
      group by coalesce(l.telemarketer_name, l.telemarketer_uid), l.telemarketer_uid
    `, [startIso, endIso]);

    const rawItems = teleRes.rows.map((row) => {
      const assigned = Number(row.total_assigned || 0);
      const contacted = Number(row.contacted_count || 0);
      const interested = Number(row.interested_count || 0);
      const notInterested = Number(row.not_interested_count || 0);
      const dnc = Number(row.dnc_count || 0);
      const processed = Number(row.processed_count || (contacted + interested + notInterested + dnc));
      const conv = processed > 0 ? Math.round((interested / processed) * 1000) / 10 : 0;
      const dailyAvg = Math.round((processed / Math.max(numDays, 1)) * 10) / 10;
      return {
        rank: 0,
        name: row.name,
        uid: row.uid,
        interested,
        contacted,
        not_interested: notInterested,
        do_not_call: dnc,
        total_processed: processed,
        total_assigned: assigned,
        conversion_rate: conv,
        daily_avg: dailyAvg,
        score: interested * 10 + contacted * 2 + processed,
        tier: 'performer' as const,
        tier_label: 'Outreach Agent',
        last_active: row.last_active,
      };
    });

    const sortBy = options?.sortBy || 'interested';
    rawItems.sort((a, b) => {
      if (sortBy === 'processed') {
        return b.total_processed - a.total_processed || b.interested - a.interested || b.conversion_rate - a.conversion_rate;
      }
      if (sortBy === 'conversion') {
        return b.conversion_rate - a.conversion_rate || b.interested - a.interested || b.total_processed - a.total_processed;
      }
      if (sortBy === 'contacted') {
        return b.contacted - a.contacted || b.interested - a.interested;
      }
      // default: by interested (conversions / sales leads won)
      return b.interested - a.interested || b.conversion_rate - a.conversion_rate || b.total_processed - a.total_processed || a.name.localeCompare(b.name);
    });

    const limit = Math.min(Math.max(Number(options?.limit ?? 10), 1), 50);
    const leaders: TelemarketerLeaderItem[] = rawItems.slice(0, limit).map((item, index) => {
      const rank = index + 1;
      let tier: TelemarketerLeaderItem['tier'] = 'performer';
      let tier_label = 'Outreach Agent';
      if (rank === 1 && item.interested > 0) {
        tier = 'champion';
        tier_label = '🥇 Champion';
      } else if (rank <= 3 && item.interested > 0) {
        tier = 'top_performer';
        tier_label = rank === 2 ? '🥈 2nd Place' : '🥉 3rd Place';
      } else if (rank <= 7 && (item.interested > 0 || item.total_processed > 0)) {
        tier = 'high_achiever';
        tier_label = '⭐ Top Achiever';
      }
      return {
        ...item,
        rank,
        tier,
        tier_label,
      };
    });

    return {
      ok: true,
      dateRange: {
        startDate: startIso.slice(0, 10),
        endDate: endIso.slice(0, 10),
        days: numDays,
      },
      sortBy,
      total: rawItems.length,
      leaders,
    };
  } catch (err) {
    console.error('[lead-activity] getTopTelemarketersLeaderboard failed:', err);
    return {
      ok: false,
      dateRange: {
        startDate: startIso ? startIso.slice(0, 10) : '',
        endDate: endIso ? endIso.slice(0, 10) : '',
        days: numDays || 7,
      },
      sortBy: options?.sortBy || 'interested',
      total: 0,
      leaders: [],
    };
  }
}

export async function getLeadActivityStats(options?: LeadActivityStatsOptions): Promise<LeadActivityStats> {
  const fallbackDateRange = {
    startDate: options?.startDate || '',
    endDate: options?.endDate || '',
    days: Number(options?.days) || 7,
  };
  const emptyStats: LeadActivityStats = {
    kpis: { totalActivities: 0, processedToday: 0, processedYesterday: 0, totalContacted: 0, totalInterested: 0, conversionRate: 0, activeTelemarketers: 0, totalLeadsInPool: 0 },
    dailyLeadProcessed: [],
    progressByStatus: [],
    perTelemarketerSummary: [],
    topLeaders: [],
    dateRange: fallbackDateRange,
  };

  if (!configured()) return emptyStats;

  try {
    await migrate();

    let startIso: string;
    let endIso: string;
    let numDays: number;
    const now = new Date();

    if (options?.startDate && options?.endDate) {
      const sRaw = options.startDate.trim();
      const eRaw = options.endDate.trim();
      const sStr = sRaw.includes('T') ? sRaw : sRaw + 'T00:00:00.000Z';
      const eStr = eRaw.includes('T') ? eRaw : eRaw + 'T23:59:59.999Z';
      const s = new Date(sStr);
      const e = new Date(eStr);
      if (!isNaN(s.getTime()) && !isNaN(e.getTime()) && s <= e) {
        startIso = s.toISOString();
        endIso = e.toISOString();
        numDays = Math.max(1, Math.min(Math.ceil((e.getTime() - s.getTime()) / 86400000), 180));
      } else {
        numDays = Math.min(Math.max(Number(options?.days ?? 7), 1), 90);
        const sFallback = new Date(now.getTime() - (numDays - 1) * 86400000);
        sFallback.setHours(0, 0, 0, 0);
        startIso = sFallback.toISOString();
        endIso = now.toISOString();
      }
    } else {
      numDays = Math.min(Math.max(Number(options?.days ?? 7), 1), 90);
      const sFallback = new Date(now.getTime() - (numDays - 1) * 86400000);
      sFallback.setHours(0, 0, 0, 0);
      startIso = sFallback.toISOString();
      endIso = now.toISOString();
    }

    const teleFilter = options?.telemarketer && options.telemarketer !== 'all' ? options.telemarketer.trim() : null;

    // 1. KPIs & Status Counts
    const statusRes = await sql<{
      total_leads: string;
      unassigned: string;
      assigned: string;
      contacted: string;
      interested: string;
      not_interested: string;
      do_not_call: string;
    }>(`
      select
        count(*)::text as total_leads,
        count(*) filter (where coalesce(c.lead_status, 'unassigned') = 'unassigned')::text as unassigned,
        count(*) filter (where c.lead_status = 'assigned')::text as assigned,
        count(*) filter (where c.lead_status = 'contacted')::text as contacted,
        count(*) filter (where c.lead_status = 'interested')::text as interested,
        count(*) filter (where c.lead_status = 'not_interested')::text as not_interested,
        count(*) filter (where c.lead_status = 'do_not_call')::text as do_not_call
      from company_data c
      where c.merged_into is null and coalesce(c.is_hidden, false) = false
    `);
    const sRow = statusRes.rows[0];
    const totalLeads = Number(sRow?.total_leads ?? 0);
    const totalContacted = Number(sRow?.contacted ?? 0);
    const totalInterested = Number(sRow?.interested ?? 0);
    const totalNotInterested = Number(sRow?.not_interested ?? 0);
    const totalDnc = Number(sRow?.do_not_call ?? 0);
    const totalAssigned = Number(sRow?.assigned ?? 0);
    const totalUnassigned = Number(sRow?.unassigned ?? 0);

    const processedTotal = totalContacted + totalInterested + totalNotInterested + totalDnc;
    const conversionRate = processedTotal > 0 ? Math.round((totalInterested / processedTotal) * 1000) / 10 : 0;

    // Activity counts
    const actRes = await sql<{
      total_act: string;
      today_act: string;
      yesterday_act: string;
      distinct_agents: string;
    }>(`
      select
        count(*)::text as total_act,
        count(*) filter (where created_at >= date_trunc('day', now()))::text as today_act,
        count(*) filter (where created_at >= date_trunc('day', now() - interval '1 day') and created_at < date_trunc('day', now()))::text as yesterday_act,
        count(distinct coalesce(telemarketer_name, telemarketer_uid)) filter (where telemarketer_name is not null)::text as distinct_agents
      from lead_activity_log
      where ($1::text is null or lower(trim(telemarketer_name)) = lower(trim($1::text)) or telemarketer_uid = $1::text)
    `, [teleFilter]);
    const aRow = actRes.rows[0];

    // 2. Daily Lead Processed (aggregated by date in the selected period)
    const dailyRes = await sql<{
      day: string;
      total: string;
      contacted: string;
      interested: string;
      not_interested: string;
      do_not_call: string;
      assigned: string;
    }>(`
      select
        to_char(created_at, 'YYYY-MM-DD') as day,
        count(*)::text as total,
        count(*) filter (where new_status = 'contacted')::text as contacted,
        count(*) filter (where new_status = 'interested')::text as interested,
        count(*) filter (where new_status = 'not_interested')::text as not_interested,
        count(*) filter (where new_status = 'do_not_call')::text as do_not_call,
        count(*) filter (where new_status = 'assigned')::text as assigned
      from lead_activity_log
      where created_at >= $1::timestamptz and created_at <= $2::timestamptz
        and ($3::text is null or lower(trim(telemarketer_name)) = lower(trim($3::text)) or telemarketer_uid = $3::text)
      group by to_char(created_at, 'YYYY-MM-DD')
      order by day desc
    `, [startIso, endIso, teleFilter]);

    const dailyMap = new Map<string, typeof dailyRes.rows[0]>();
    for (const r of dailyRes.rows) dailyMap.set(r.day, r);

    const dailyLeadProcessed: LeadActivityDailyStat[] = [];
    const endDateObj = new Date(endIso);
    for (let i = 0; i < numDays; i++) {
      const d = new Date(endDateObj.getTime() - i * 86400000);
      const dayStr = d.toISOString().slice(0, 10);
      const matched = dailyMap.get(dayStr);
      let displayDate = d.toLocaleDateString('en-US', { day: 'numeric', month: 'short' });
      const todayStr = now.toISOString().slice(0, 10);
      const yesterdayStr = new Date(now.getTime() - 86400000).toISOString().slice(0, 10);
      if (dayStr === todayStr) displayDate = 'Today (' + displayDate + ')';
      else if (dayStr === yesterdayStr) displayDate = 'Yesterday (' + displayDate + ')';

      dailyLeadProcessed.push({
        date: dayStr,
        displayDate,
        total: Number(matched?.total ?? 0),
        contacted: Number(matched?.contacted ?? 0),
        interested: Number(matched?.interested ?? 0),
        not_interested: Number(matched?.not_interested ?? 0),
        do_not_call: Number(matched?.do_not_call ?? 0),
        assigned: Number(matched?.assigned ?? 0),
      });
    }

    // 3. Progress by Status Type
    const statusItems: Array<{ status: LeadStatus; label: string; count: number; color: string }> = [
      { status: 'interested', label: '⭐ Interested / Won', count: totalInterested, color: '#15785a' },
      { status: 'contacted', label: '📞 Contacted / In Progress', count: totalContacted, color: '#d97706' },
      { status: 'assigned', label: '⏳ Assigned / Queue', count: totalAssigned, color: '#2563eb' },
      { status: 'not_interested', label: '❌ Not Interested', count: totalNotInterested, color: '#dc2626' },
      { status: 'do_not_call', label: '⛔ Do Not Call (DNC)', count: totalDnc, color: '#4b5563' },
      { status: 'unassigned', label: '📋 Unassigned Pool', count: totalUnassigned, color: '#9b988f' },
    ];
    const denom = Math.max(totalLeads, 1);
    const progressByStatus = statusItems.map((item) => ({
      ...item,
      percentage: Math.round((item.count / denom) * 1000) / 10,
    }));

    // 4. Per Telemarketer Activity Summary
    const teleRes = await sql<{
      name: string;
      uid: string | null;
      total_assigned: string;
      contacted_count: string;
      interested_count: string;
      not_interested_count: string;
      dnc_count: string;
      pending_count: string;
      total_activities: string;
      last_active: string | null;
    }>(`
      with roster as (
        select
          t.id,
          t.name,
          t.uid,
          count(distinct c.id) filter (where c.merged_into is null and coalesce(c.is_hidden, false) = false)::int as total_assigned,
          count(distinct c.id) filter (where c.merged_into is null and coalesce(c.is_hidden, false) = false and c.lead_status = 'contacted')::int as contacted_count,
          count(distinct c.id) filter (where c.merged_into is null and coalesce(c.is_hidden, false) = false and c.lead_status = 'interested')::int as interested_count,
          count(distinct c.id) filter (where c.merged_into is null and coalesce(c.is_hidden, false) = false and c.lead_status = 'not_interested')::int as not_interested_count,
          count(distinct c.id) filter (where c.merged_into is null and coalesce(c.is_hidden, false) = false and c.lead_status = 'do_not_call')::int as dnc_count,
          count(distinct c.id) filter (where c.merged_into is null and coalesce(c.is_hidden, false) = false and coalesce(c.lead_status, 'assigned') in ('assigned', 'unassigned'))::int as pending_count
        from telemarketer t
        left join company_data c on (
          (t.uid is not null and (c.telemarketer_uid = t.uid or c.telemarketer_uid = ('uid:' || t.uid) or lower(trim(c.assigned_to)) = lower(trim(t.uid)) or lower(trim(c.assigned_to)) = lower(trim('uid:' || t.uid))))
          or lower(trim(c.assigned_to)) = lower(trim(t.name))
        )
        where t.active = true
        group by t.id, t.name, t.uid
      ),
      act_summary as (
        select
          t.id as telemarketer_id,
          count(l.id)::int as total_activities,
          max(l.created_at) as last_active
        from telemarketer t
        left join lead_activity_log l on (
          lower(trim(l.telemarketer_name)) = lower(trim(t.name)) or (t.uid is not null and l.telemarketer_uid = t.uid)
        )
        where t.active = true
        group by t.id
      )
      select
        r.name,
        r.uid,
        coalesce(r.total_assigned, 0)::text as total_assigned,
        coalesce(r.contacted_count, 0)::text as contacted_count,
        coalesce(r.interested_count, 0)::text as interested_count,
        coalesce(r.not_interested_count, 0)::text as not_interested_count,
        coalesce(r.dnc_count, 0)::text as dnc_count,
        coalesce(r.pending_count, 0)::text as pending_count,
        coalesce(a.total_activities, 0)::text as total_activities,
        a.last_active::text as last_active
      from roster r
      left join act_summary a on r.id = a.telemarketer_id
      order by r.total_assigned desc, r.name asc
    `);

    const perTelemarketerSummary: LeadActivityTelemarketerSummary[] = teleRes.rows.map((row) => {
      const assigned = Number(row.total_assigned || 0);
      const contacted = Number(row.contacted_count || 0);
      const interested = Number(row.interested_count || 0);
      const notInterested = Number(row.not_interested_count || 0);
      const dnc = Number(row.dnc_count || 0);
      const pending = Number(row.pending_count || 0);
      const processed = contacted + interested + notInterested + dnc;
      const conv = processed > 0 ? Math.round((interested / processed) * 1000) / 10 : 0;
      const dailyAvg = Math.round((processed / Math.max(numDays, 1)) * 10) / 10;
      return {
        name: row.name,
        uid: row.uid,
        total_assigned: assigned,
        total_processed: processed,
        contacted,
        interested,
        not_interested: notInterested,
        do_not_call: dnc,
        pending,
        conversion_rate: conv,
        daily_avg: dailyAvg,
        last_active: row.last_active,
      };
    });

    // 5. Top 10 Telemarketer Leaderboard (for the selected period)
    const leaderboardResult = await getTopTelemarketersLeaderboard({
      startDate: options?.startDate,
      endDate: options?.endDate,
      days: numDays,
      sortBy: options?.sortBy,
      limit: options?.limit ?? 10,
    });

    return {
      kpis: {
        totalActivities: Number(aRow?.total_act ?? 0),
        processedToday: Number(aRow?.today_act ?? 0),
        processedYesterday: Number(aRow?.yesterday_act ?? 0),
        totalContacted,
        totalInterested,
        conversionRate,
        activeTelemarketers: Number(aRow?.distinct_agents || perTelemarketerSummary.length || 0),
        totalLeadsInPool: totalLeads,
      },
      dailyLeadProcessed,
      progressByStatus,
      perTelemarketerSummary,
      topLeaders: leaderboardResult.leaders,
      dateRange: leaderboardResult.dateRange,
    };
  } catch (err) {
    console.error('[lead-activity] getLeadActivityStats failed:', err);
    return emptyStats;
  }
}

export async function listLeadActivities(options?: {
  limit?: number;
  offset?: number;
  telemarketer?: string;
  status?: string;
  search?: string;
}): Promise<{ activities: LeadActivityLogItem[]; total: number }> {
  if (!configured()) return { activities: [], total: 0 };
  await migrate();
  const limit = Math.min(Math.max(Number(options?.limit ?? 50), 1), 200);
  const offset = Math.max(Number(options?.offset ?? 0), 0);
  const params: unknown[] = [];
  const where: string[] = ['1=1'];

  if (options?.telemarketer && options.telemarketer !== 'all') {
    params.push(options.telemarketer.trim());
    where.push(`(lower(trim(l.telemarketer_name)) = lower(trim($${params.length})) or l.telemarketer_uid = $${params.length})`);
  }
  if (options?.status && options.status !== 'all') {
    params.push(options.status.trim());
    where.push(`l.new_status = $${params.length}`);
  }
  if (options?.search && options.search.trim()) {
    params.push(`%${options.search.trim().toLowerCase()}%`);
    where.push(`(lower(c.name) like $${params.length} or lower(coalesce(c.phone,'')) like $${params.length} or lower(coalesce(l.notes,'')) like $${params.length})`);
  }

  const whereClause = where.join(' and ');
  const countRes = await sql<{ cnt: string }>(
    `select count(*)::text as cnt
     from lead_activity_log l
     left join company_data c on c.id = l.company_id
     where ${whereClause}`,
    params,
  );
  const total = Number(countRes.rows[0]?.cnt ?? 0);

  params.push(limit);
  const limitParam = params.length;
  params.push(offset);
  const offsetParam = params.length;

  const res = await sql<LeadActivityLogItem>(
    `select
       l.id,
       l.company_id,
       l.telemarketer_name,
       l.telemarketer_uid,
       l.action,
       l.previous_status,
       l.new_status,
       l.notes,
       l.is_mock,
       l.created_at::text,
       c.name as company_name,
       c.phone as company_phone,
       c.category as company_category,
       c.address as company_address
     from lead_activity_log l
     left join company_data c on c.id = l.company_id
     where ${whereClause}
     order by l.created_at desc, l.id desc
     limit $${limitParam} offset $${offsetParam}`,
    params,
  );

  return { activities: res.rows, total };
}

export async function generateMockLeadData(options?: {
  leadCount?: number;
  daysSpan?: number;
  clearFirst?: boolean;
}): Promise<{
  ok: boolean;
  message: string;
  assignedCount: number;
  activitiesCount: number;
  telemarketersUsed: string[];
  daysSpan: number;
}> {
  if (!configured()) throw new Error('database not configured');
  await migrate();

  const count = Math.min(Math.max(Number(options?.leadCount ?? 80), 5), 500);
  const days = Math.min(Math.max(Number(options?.daysSpan ?? 7), 1), 30);

  if (options?.clearFirst) {
    await clearMockLeadProgress();
  }

  // Ensure active telemarketers exist
  let teleList = await sql<{ name: string; uid: string }>(`select name, uid from telemarketer where active = true order by id asc`);
  if (teleList.rows.length < 10) {
    const defaults = [
      { name: 'Sarah Wong', uid: 'tm_sarah' },
      { name: 'Ahmad Faris', uid: 'tm_ahmad' },
      { name: 'Jason Tan', uid: 'tm_jason' },
      { name: 'Nurul Huda', uid: 'tm_nurul' },
      { name: 'David Lim', uid: 'tm_david' },
      { name: 'Siti Aisyah', uid: 'tm_siti' },
      { name: 'Kevin Chong', uid: 'tm_kevin' },
      { name: 'Priya Raman', uid: 'tm_priya' },
      { name: 'Hafiz Zulkifli', uid: 'tm_hafiz' },
      { name: 'Michelle Lee', uid: 'tm_michelle' },
      { name: 'Daniel Goh', uid: 'tm_daniel' },
      { name: 'Farhana Yusof', uid: 'tm_farhana' },
    ];
    for (const d of defaults) {
      await sql(
        `insert into telemarketer (name, uid, active, created_at)
         values ($1, $2, true, now())
         on conflict (name) do update set active = true, uid = coalesce(telemarketer.uid, excluded.uid)`,
        [d.name, d.uid],
      ).catch(() => {});
    }
    teleList = await sql<{ name: string; uid: string }>(`select name, uid from telemarketer where active = true order by id asc`);
  }

  const agents = teleList.rows;
  if (!agents.length) throw new Error('No active telemarketers available');

  // Fetch real leads from company_data
  let companies = await sql<{ id: number; name: string; category: string | null; phone: string | null; address: string | null }>(
    `select id, name, category, phone, address
     from company_data
     where merged_into is null and coalesce(is_hidden, false) = false
     order by id asc
     limit $1`,
    [count],
  );

  // If no companies exist in database, seed realistic demo businesses
  if (!companies.rows.length) {
    const demoBusinesses = [
      { name: 'Southern Solar Engineering Sdn Bhd', cat: 'Solar Energy Equipment', phone: '+60 7-351 2288', addr: 'Jalan Molek 1/29, Taman Molek, 81100 Johor Bahru' },
      { name: 'Austin Heights Medical Centre', cat: 'Medical Clinic', phone: '+60 7-360 8888', addr: 'Jalan Austin Heights 8/3, Taman Mount Austin, 81100 Johor Bahru' },
      { name: 'Tebrau Logistics Hub Sdn Bhd', cat: 'Freight Forwarding Service', phone: '+60 7-333 4455', addr: 'Kawasan Perindustrian Tebrau 4, 81100 Johor Bahru' },
      { name: 'Johor Cold Storage & Food Supply', cat: 'Wholesale Food Store', phone: '+60 7-388 9900', addr: 'Jalan Permas 9/3, Bandar Baru Permas Jaya, 81750 Masai' },
      { name: 'Mega Precision Machining Sdn Bhd', cat: 'Machining Manufacturer', phone: '+60 7-599 1234', addr: 'Kawasan Perindustrian Senai 2, 81400 Senai' },
      { name: 'Greenfield Eco Packaging Solution', cat: 'Packaging Supply Store', phone: '+60 7-555 6789', addr: 'Taman Universiti Industrial Park, 81300 Skudai' },
      { name: 'Pulai Spring Contractor & Engineering', cat: 'General Contractor', phone: '+60 7-521 3456', addr: 'Bandar Baru Kangkar Pulai, 81300 Johor Bahru' },
      { name: 'Setia Tropika Corporate Services', cat: 'Corporate Office', phone: '+60 7-238 7890', addr: 'Jalan Setia Tropika 1/14, 81200 Johor Bahru' },
      { name: 'Iskandar Clean Energy Technologies', cat: 'Renewable Energy', phone: '+60 7-560 2211', addr: 'Medini 7, Iskandar Puteri, 79250 Johor' },
      { name: 'Daiman Commercial Printing & Paper', cat: 'Commercial Printer', phone: '+60 7-355 4321', addr: 'Taman Johor Jaya, 81100 Johor Bahru' },
      { name: 'Kempas Hardware & Building Materials', cat: 'Building Materials', phone: '+60 7-236 1122', addr: 'Kawasan Perusahaan Kempas, 81200 Johor Bahru' },
      { name: 'Pasir Gudang Marine Services Sdn Bhd', cat: 'Marine Engineering', phone: '+60 7-251 7766', addr: 'Kawasan Perindustrian Pasir Gudang, 81700 Pasir Gudang' },
      { name: 'Bukit Indah Auto Parts & Tyre Centre', cat: 'Auto Repair Shop', phone: '+60 7-234 5566', addr: 'Jalan Indah 15/2, Taman Bukit Indah, 79100 Iskandar Puteri' },
      { name: 'Kulai Central Cold Storage & Warehouse', cat: 'Warehouse', phone: '+60 7-663 8899', addr: 'Kawasan Perindustrian Kelapa Sawit, 81000 Kulai' },
      { name: 'JB Metal Works & Fabrication', cat: 'Metal Fabricator', phone: '+60 7-386 2345', addr: 'Taman Perindustrian Kota Puteri, 81750 Masai' },
    ];
    for (const b of demoBusinesses) {
      await sql(
        `insert into company_data (name, category, phone, address, place_id, rating, reviews)
         values ($1, $2, $3, $4, $5, 4.5, 12)`,
        [b.name, b.cat, b.phone, b.addr, 'place_' + Math.random().toString(36).slice(2, 10)],
      ).catch(() => {});
    }
    companies = await sql<{ id: number; name: string; category: string | null; phone: string | null; address: string | null }>(
      `select id, name, category, phone, address
       from company_data
       where merged_into is null and coalesce(is_hidden, false) = false
       order by id asc
       limit $1`,
      [count],
    );
  }

  const leads = companies.rows;
  let activityCount = 0;
  const now = Date.now();

  const noteTemplates = {
    interested: [
      'Spoke with Managing Director Mr. Tan. Very interested in our proposal. Sent formal quotation on WhatsApp, scheduled follow-up call.',
      'Decision maker Dato\' Rahim requested formal quotation sent to his email. High interest in commercial cost savings package.',
      'Call answered by Owner Miss Lee. Positive feedback on commercial proposal, booked site visit / consultation next Tuesday.',
      'Reached General Manager. Requested corporate deck & pricing comparison. Expressed interest to present to Board of Directors.',
      'Key decision maker confirmed current power bill >RM15k/mo. Highly keen on energy audit proposal.',
      'Spoke with Finance Director. Budget allocated for Q4 facility upgrade. Requested callback tomorrow 2pm.',
    ],
    contacted: [
      'Spoke with receptionist. PIC currently in meeting, requested callback this Friday afternoon.',
      'Reached purchasing executive. Introduced company services. Sent PDF brochure via WhatsApp, follow-up scheduled.',
      'Followed up via phone. PIC acknowledged receipt of WhatsApp profile. Will discuss internally with management.',
      'Gatekeeper asked to send intro email to official mailbox. Scheduled follow-up next Monday.',
      'Call connected to Admin. Decision maker out of office until next week, left message.',
      'Left WhatsApp voice note and proposal catalog. Read receipts confirmed, pending response.',
    ],
    not_interested: [
      'Owner stated they recently signed a 3-year service contract with another vendor. Not looking to change.',
      'PIC stated company capex budget is frozen for 2026. Keep in touch next year.',
      'Premise is rented/short lease; management not authorized to install rooftop solar or structural upgrades.',
      'Spoke to manager. Stated company operations currently downsizing, no requirement at this stage.',
      'Management declined polite pitch; stated they already have in-house technical provider.',
    ],
    do_not_call: [
      'Number is disconnected or line busy permanently. Marked as invalid line.',
      'PIC strictly requested removal from telemarketing list (DNC). Respected and flagged.',
      'Wrong number, individual answered that business moved out 2 years ago.',
    ],
    assigned: [
      'Allocated to daily call queue. Priority target.',
      'Assigned for outreach batch. Contact card prepared.',
    ],
  };

  for (let i = 0; i < leads.length; i++) {
    const lead = leads[i]!;
    const agent = agents[i % agents.length]!;

    // Distribute outcomes
    // 20% interested, 48% contacted, 18% not_interested, 8% do_not_call, 6% assigned
    const rand = (i * 17 + 23) % 100;
    let targetStatus: LeadStatus = 'contacted';
    if (rand < 20) targetStatus = 'interested';
    else if (rand < 68) targetStatus = 'contacted';
    else if (rand < 86) targetStatus = 'not_interested';
    else if (rand < 94) targetStatus = 'do_not_call';
    else targetStatus = 'assigned';

    // Distribute across daysSpan
    const dayOffset = (i * 3 + 1) % days;
    const hour = 9 + ((i * 5) % 8); // 9am - 5pm
    const minute = (i * 11) % 60;
    const activityDate = new Date(now - dayOffset * 86400000);
    activityDate.setHours(hour, minute, Math.floor(Math.random() * 59), 0);

    const dateStr = activityDate.toISOString().slice(0, 10);
    const tmplList = noteTemplates[targetStatus] || noteTemplates.contacted;
    const noteBody = tmplList[i % tmplList.length]!;
    const finalNote = `[${dateStr}] ${noteBody}`;

    // UPDATE ONLY LEAD STATUS, ASSIGNMENT, AND NOTES.
    // CONTACT DETAILS & RESEARCH ARE 100% PRESERVED.
    await sql(
      `update company_data set
         assigned_to = $1,
         telemarketer_uid = $2,
         assigned_at = $3,
         lead_status = $4,
         lead_notes = $5,
         lead_updated_at = $3
       where id = $6`,
      [agent.name, agent.uid, activityDate.toISOString(), targetStatus, finalNote, lead.id],
    );

    // Initial assignment log
    await sql(
      `insert into lead_activity_log (company_id, telemarketer_name, telemarketer_uid, action, previous_status, new_status, notes, is_mock, created_at)
       values ($1, $2, $3, 'assignment', 'unassigned', 'assigned', null, true, $4)`,
      [lead.id, agent.name, agent.uid, new Date(activityDate.getTime() - 3600000).toISOString()],
    );
    activityCount++;

    // Status change log (if not just assigned)
    if (targetStatus !== 'assigned') {
      await sql(
        `insert into lead_activity_log (company_id, telemarketer_name, telemarketer_uid, action, previous_status, new_status, notes, is_mock, created_at)
         values ($1, $2, $3, 'status_change', 'assigned', $4, $5, true, $6)`,
        [lead.id, agent.name, agent.uid, targetStatus, finalNote, activityDate.toISOString()],
      );
      activityCount++;
    }
  }

  return {
    ok: true,
    message: `Generated mock presentation data for ${leads.length} leads across ${days} days assigned to ${agents.length} telemarketers. Real contact & company details remained completely safe.`,
    assignedCount: leads.length,
    activitiesCount: activityCount,
    telemarketersUsed: agents.map((a) => a.name),
    daysSpan: days,
  };
}

export async function clearMockLeadProgress(): Promise<{
  ok: boolean;
  message: string;
  clearedLeads: number;
  clearedActivities: number;
}> {
  if (!configured()) return { ok: true, message: 'Database not configured', clearedLeads: 0, clearedActivities: 0 };
  await migrate();

  // Reset assignments and call statuses. Blacklisted (do_not_call) leads keep their
  // status, and remarks are never cleared. Contact & research data is untouched.
  const leadRes = await sql(
    `update company_data set
       lead_status = case when coalesce(lead_status, 'unassigned') = 'do_not_call' then 'do_not_call' else 'unassigned' end,
       assigned_to = null,
       telemarketer_uid = null,
       assigned_at = null,
       lead_updated_at = now()
     where merged_into is null
       and (assigned_to is not null or coalesce(lead_status, 'unassigned') not in ('unassigned', 'do_not_call'))
     returning id`,
  );

  // Clear activity entries that carry no remark. Entries with a remark are kept.
  const actRes = await sql(
    `delete from lead_activity_log where coalesce(notes, '') = '' returning id`,
  );

  return {
    ok: true,
    message: `Assignments and call statuses were reset. Do-not-call leads and all remarks were kept. ${leadRes.rows.length} leads reset. ${actRes.rows.length} activity entries without remarks cleared. Contact & research data remain safe.`,
    clearedLeads: leadRes.rows.length,
    clearedActivities: actRes.rows.length,
  };
}

export async function addManualLeadActivity(input: {
  companyId: number | string;
  status: LeadStatus;
  telemarketerName?: string | null;
  notes?: string | null;
  actionDate?: string;
}): Promise<Record<string, unknown>> {
  if (!configured()) throw new Error('database not configured');
  await migrate();
  const id = Number(input.companyId);
  if (!Number.isFinite(id) || id <= 0) throw new Error('invalid company id');

  let agentName = input.telemarketerName ? input.telemarketerName.trim() : null;
  let agentUid: string | null = null;
  if (agentName) {
    const target = await resolveTelemarketer(agentName).catch(() => null);
    if (target) {
      agentName = target.name;
      agentUid = target.uid;
    }
  }

  const actionTime = input.actionDate ? new Date(input.actionDate).toISOString() : new Date().toISOString();
  const noteDate = actionTime.slice(0, 10);
  const cleanNote = input.notes?.trim() ? `[${noteDate}] ${input.notes.trim()}` : null;

  // Read current
  const beforeRes = await sql<{ lead_status: string; assigned_to: string | null; telemarketer_uid: string | null; lead_notes: string | null }>(
    `select lead_status, assigned_to, telemarketer_uid, lead_notes from company_data where id = $1 limit 1`,
    [id],
  );
  const before = beforeRes.rows[0];
  const prevStatus = (before?.lead_status as LeadStatus) || 'unassigned';
  const effectiveAgent = agentName || before?.assigned_to || null;
  const effectiveUid = agentUid || before?.telemarketer_uid || null;

  let combinedNotes = before?.lead_notes || null;
  if (cleanNote) {
    combinedNotes = combinedNotes ? `${combinedNotes}\n${cleanNote}` : cleanNote;
  }

  const updated = await sql(
    `update company_data set
       lead_status = $1,
       assigned_to = coalesce($2, assigned_to),
       telemarketer_uid = coalesce($3, telemarketer_uid),
       assigned_at = case when assigned_at is null and $2 is not null then $4::timestamptz else assigned_at end,
       lead_notes = $5,
       lead_updated_at = $4::timestamptz
     where id = $6
     returning *`,
    [input.status, agentName, agentUid, actionTime, combinedNotes, id],
  );

  const logRes = await sql(
    `insert into lead_activity_log (company_id, telemarketer_name, telemarketer_uid, action, previous_status, new_status, notes, is_mock, created_at)
     values ($1, $2, $3, 'status_change', $4, $5, $6, false, $7::timestamptz)
     returning *`,
    [id, effectiveAgent, effectiveUid, prevStatus, input.status, cleanNote, actionTime],
  );

  return {
    ok: true,
    lead: updated.rows[0],
    activity: logRes.rows[0],
  };
}

export const recordLeadActivity = addManualLeadActivity;

// ---------------------------------------------------------------------------
// Ads & Form Submissions (public.atap_solar_registrations)
// ---------------------------------------------------------------------------

export interface AtapSolarRegistrationLead {
  id: number;
  lead_id: string;
  full_name: string | null;
  phone_number: string | null;
  tnb_account_no: string | null;
  area: string;
  state: string;
  property_type: string | null;
  monthly_bill: number | null;
  email: string | null;
  roof_type: string | null;
  system_size: string | null;
  estimated_savings: string | null;
  source: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  notes: string | null;
  raw_data: Record<string, unknown> | null;
  created_at: string;
  lead_status: LeadStatus;
  assigned_to: string | null;
  telemarketer_uid: string | null;
  assigned_at: string | null;
  lead_notes: string | null;
  lead_updated_at: string | null;
  is_hidden: boolean;
}

export interface AtapSolarRegistrationStats {
  total: number;
  unassigned: number;
  assigned: number;
  contacted: number;
  interested: number;
  not_interested: number;
  do_not_call: number;
  hidden: number;
  google_ads: number;
  facebook_ads: number;
  other_sources: number;
}

function applyAdsAssignedToFilter(whereConditions: string[], params: unknown[], assignedTo: string): void {
  const trimmed = assignedTo.trim().replace(/^[=:]+/, '');
  if (!trimmed || trimmed === 'all') return;
  if (trimmed === 'unassigned') {
    whereConditions.push(`(assigned_to is null or trim(assigned_to) = '' or coalesce(lead_status, 'unassigned') = 'unassigned')`);
    return;
  }

  const rawKey = trimmed.startsWith('uid:') ? trimmed.slice(4) : trimmed;
  const prefixedKey = trimmed.startsWith('uid:') ? trimmed : 'uid:' + trimmed;
  const numId = Number(rawKey);
  const isNumeric = Number.isFinite(numId) && numId > 0 && String(numId) === rawKey;

  params.push(rawKey);
  const pRaw = params.length;
  params.push(prefixedKey);
  const pPrefixed = params.length;
  params.push(trimmed);
  const pTrimmed = params.length;
  params.push(isNumeric);
  const pIsNum = params.length;
  params.push(isNumeric ? numId : 0);
  const pNumId = params.length;

  whereConditions.push(`(
    telemarketer_uid = $${pRaw}
    or telemarketer_uid = $${pPrefixed}
    or lower(trim(assigned_to)) = lower(trim($${pTrimmed}))
    or lower(trim(assigned_to)) = lower(trim($${pRaw}))
    or lower(trim(assigned_to)) = lower(trim($${pPrefixed}))
    or lower(regexp_replace(trim(coalesce(assigned_to, '')), '\\s+', ' ', 'g')) = lower(regexp_replace(trim($${pRaw}), '\\s+', ' ', 'g'))
    or telemarketer_uid in (
      select uid from telemarketer
      where uid = $${pRaw} or uid = $${pPrefixed}
        or lower(trim(name)) = lower(trim($${pTrimmed}))
        or lower(trim(name)) = lower(trim($${pRaw}))
        or lower(regexp_replace(trim(name), '\\s+', ' ', 'g')) = lower(regexp_replace(trim($${pRaw}), '\\s+', ' ', 'g'))
        or ($${pIsNum}::boolean and id = $${pNumId}::int)
    )
    or lower(trim(assigned_to)) in (
      select lower(trim(name)) from telemarketer
      where uid = $${pRaw} or uid = $${pPrefixed}
        or lower(trim(name)) = lower(trim($${pTrimmed}))
        or lower(trim(name)) = lower(trim($${pRaw}))
        or lower(regexp_replace(trim(name), '\\s+', ' ', 'g')) = lower(regexp_replace(trim($${pRaw}), '\\s+', ' ', 'g'))
        or ($${pIsNum}::boolean and id = $${pNumId}::int)
    )
  )`);
}

export async function getAtapSolarRegistrationStats(): Promise<AtapSolarRegistrationStats> {
  if (!configured()) {
    return {
      total: 0,
      unassigned: 0,
      assigned: 0,
      contacted: 0,
      interested: 0,
      not_interested: 0,
      do_not_call: 0,
      hidden: 0,
      google_ads: 0,
      facebook_ads: 0,
      other_sources: 0,
    };
  }
  await migrate();
  const res = await sql<{
    total: string;
    unassigned: string;
    assigned: string;
    contacted: string;
    interested: string;
    not_interested: string;
    do_not_call: string;
    hidden: string;
    google_ads: string;
    facebook_ads: string;
    other_sources: string;
  }>(
    `select
       count(*) filter (where coalesce(is_hidden, false) = false)::text as total,
       count(*) filter (where coalesce(is_hidden, false) = false and (assigned_to is null or trim(assigned_to) = '' or coalesce(lead_status, 'unassigned') = 'unassigned'))::text as unassigned,
       count(*) filter (where coalesce(is_hidden, false) = false and assigned_to is not null and trim(assigned_to) <> '' and coalesce(lead_status, 'assigned') = 'assigned')::text as assigned,
       count(*) filter (where coalesce(is_hidden, false) = false and lead_status = 'contacted')::text as contacted,
       count(*) filter (where coalesce(is_hidden, false) = false and lead_status = 'interested')::text as interested,
       count(*) filter (where coalesce(is_hidden, false) = false and lead_status = 'not_interested')::text as not_interested,
       count(*) filter (where coalesce(is_hidden, false) = false and lead_status = 'do_not_call')::text as do_not_call,
       count(*) filter (where coalesce(is_hidden, false) = true)::text as hidden,
       count(*) filter (where coalesce(is_hidden, false) = false and lower(coalesce(source, utm_source, '')) ilike '%google%')::text as google_ads,
       count(*) filter (where coalesce(is_hidden, false) = false and lower(coalesce(source, utm_source, '')) ilike '%facebook%')::text as facebook_ads,
       count(*) filter (where coalesce(is_hidden, false) = false and lower(coalesce(source, utm_source, '')) not ilike '%google%' and lower(coalesce(source, utm_source, '')) not ilike '%facebook%')::text as other_sources
     from atap_solar_registrations`,
  );
  const row = res.rows[0];
  return {
    total: Number(row?.total ?? 0),
    unassigned: Number(row?.unassigned ?? 0),
    assigned: Number(row?.assigned ?? 0),
    contacted: Number(row?.contacted ?? 0),
    interested: Number(row?.interested ?? 0),
    not_interested: Number(row?.not_interested ?? 0),
    do_not_call: Number(row?.do_not_call ?? 0),
    hidden: Number(row?.hidden ?? 0),
    google_ads: Number(row?.google_ads ?? 0),
    facebook_ads: Number(row?.facebook_ads ?? 0),
    other_sources: Number(row?.other_sources ?? 0),
  };
}

export async function listAtapSolarRegistrations(options: {
  search?: string | null;
  status?: string | null;
  assignedTo?: string | null;
  source?: string | null;
  state?: string | null;
  limit?: number;
  offset?: number;
  sort?: string | null;
} = {}): Promise<{ leads: AtapSolarRegistrationLead[]; total: number; stats: AtapSolarRegistrationStats; limit: number; offset: number }> {
  if (!configured()) {
    return {
      leads: [],
      total: 0,
      stats: {
        total: 0,
        unassigned: 0,
        assigned: 0,
        contacted: 0,
        interested: 0,
        not_interested: 0,
        do_not_call: 0,
        hidden: 0,
        google_ads: 0,
        facebook_ads: 0,
        other_sources: 0,
      },
      limit: Math.min(Math.max(Math.round(options.limit ?? 50), 1), 100),
      offset: Math.max(Math.round(options.offset ?? 0), 0),
    };
  }
  await migrate();
  const limit = Math.min(Math.max(Math.round(options.limit ?? 50), 1), 100);
  const offset = Math.max(Math.round(options.offset ?? 0), 0);

  const whereConditions: string[] = [];
  const params: unknown[] = [];

  if (options.status === 'hidden') {
    whereConditions.push('coalesce(is_hidden, false) = true');
  } else {
    whereConditions.push('coalesce(is_hidden, false) = false');
    if (options.status && options.status !== 'all') {
      if (options.status === 'unassigned') {
        whereConditions.push(`(coalesce(lead_status, 'unassigned') = 'unassigned' or assigned_to is null or trim(assigned_to) = '')`);
      } else {
        params.push(options.status.trim());
        whereConditions.push(`lead_status = $${params.length}`);
      }
    }
  }

  if (options.search && options.search.trim()) {
    params.push(`%${options.search.trim()}%`);
    const pIdx = params.length;
    whereConditions.push(`(
      full_name ilike $${pIdx}
      or coalesce(phone_number, '') ilike $${pIdx}
      or coalesce(email, '') ilike $${pIdx}
      or area ilike $${pIdx}
      or state ilike $${pIdx}
      or lead_id ilike $${pIdx}
      or coalesce(tnb_account_no, '') ilike $${pIdx}
      or coalesce(notes, '') ilike $${pIdx}
      or coalesce(utm_campaign, '') ilike $${pIdx}
      or coalesce(source, '') ilike $${pIdx}
    )`);
  }

  if (options.assignedTo) {
    applyAdsAssignedToFilter(whereConditions, params, options.assignedTo);
  }

  if (options.source && options.source !== 'all') {
    params.push(`%${options.source.trim()}%`);
    const pIdx = params.length;
    whereConditions.push(`(source ilike $${pIdx} or utm_source ilike $${pIdx})`);
  }

  if (options.state && options.state !== 'all') {
    params.push(options.state.trim());
    const pIdx = params.length;
    whereConditions.push(`lower(state) = lower($${pIdx})`);
  }

  const whereClause = whereConditions.length > 0 ? whereConditions.join(' and ') : 'true';

  let orderBy = 'created_at desc, id desc';
  if (options.sort === 'name') orderBy = 'lower(coalesce(full_name, lead_id)) asc';
  else if (options.sort === 'bill') orderBy = 'monthly_bill desc nulls last, id desc';
  else if (options.sort === 'assigned_at') orderBy = 'assigned_at desc nulls last, id desc';

  const [items, countRes, statsRes] = await Promise.all([
    sql<AtapSolarRegistrationLead>(
      `select
         id, lead_id, full_name, phone_number, tnb_account_no, area, state,
         property_type, monthly_bill::float, email, roof_type, system_size, estimated_savings,
         source, utm_source, utm_medium, utm_campaign, notes, raw_data,
         created_at, coalesce(lead_status, 'unassigned') as lead_status,
         assigned_to, telemarketer_uid, assigned_at, lead_notes, lead_updated_at,
         coalesce(is_hidden, false) as is_hidden
       from atap_solar_registrations
       where ${whereClause}
       order by ${orderBy}
       limit $${params.length + 1} offset $${params.length + 2}`,
      [...params, limit, offset],
    ),
    sql<{ total: string }>(
      `select count(*)::text as total
       from atap_solar_registrations
       where ${whereClause}`,
      params,
    ),
    getAtapSolarRegistrationStats(),
  ]);

  return {
    leads: items.rows,
    total: Number(countRes.rows[0]?.total ?? 0),
    stats: statsRes,
    limit,
    offset,
  };
}

export async function getAtapSolarRegistrationById(registrationId: string | number): Promise<AtapSolarRegistrationLead | null> {
  await migrate();
  const id = Number(registrationId);
  if (!Number.isFinite(id) || id <= 0) return null;

  const res = await sql<AtapSolarRegistrationLead>(
    `select
       id, lead_id, full_name, phone_number, tnb_account_no, area, state,
       property_type, monthly_bill::float, email, roof_type, system_size, estimated_savings,
       source, utm_source, utm_medium, utm_campaign, notes, raw_data,
       created_at, coalesce(lead_status, 'unassigned') as lead_status,
       assigned_to, telemarketer_uid, assigned_at, lead_notes, lead_updated_at,
       coalesce(is_hidden, false) as is_hidden
     from atap_solar_registrations
     where id = $1
     limit 1`,
    [id],
  );
  return res.rows[0] ?? null;
}

export async function updateAtapSolarRegistration(
  registrationId: string | number,
  patch: {
    leadStatus?: LeadStatus;
    assignedTo?: string | null;
    notes?: string | null;
    isHidden?: boolean;
  },
): Promise<AtapSolarRegistrationLead | null> {
  await migrate();
  const id = Number(registrationId);
  if (!Number.isFinite(id) || id <= 0) throw new Error('invalid registration id');

  let agentUid: string | null = null;
  let assignedName: string | null = null;
  if (patch.assignedTo && patch.assignedTo.trim()) {
    const target = await resolveTelemarketer(patch.assignedTo.trim());
    agentUid = target.uid;
    assignedName = target.name;
  }

  const beforeRes = await sql<{ lead_status: string; assigned_to: string | null; telemarketer_uid: string | null; lead_notes: string | null }>(
    `select lead_status, assigned_to, telemarketer_uid, lead_notes from atap_solar_registrations where id = $1 limit 1`,
    [id],
  ).catch(() => ({ rows: [] as { lead_status: string; assigned_to: string | null; telemarketer_uid: string | null; lead_notes: string | null }[], rowCount: 0 }));
  const before = beforeRes.rows[0];

  const hasStatus = Object.prototype.hasOwnProperty.call(patch, 'leadStatus');
  const hasAssignedTo = Object.prototype.hasOwnProperty.call(patch, 'assignedTo');
  const hasNotes = Object.prototype.hasOwnProperty.call(patch, 'notes');
  const hasIsHidden = Object.prototype.hasOwnProperty.call(patch, 'isHidden');

  const res = await sql<AtapSolarRegistrationLead>(
    `update atap_solar_registrations set
       lead_status = case when $2::boolean then $3 else lead_status end,
       assigned_to = case when $4::boolean then $5 else assigned_to end,
       telemarketer_uid = case when $4::boolean then $10 else telemarketer_uid end,
       assigned_at = case when $4::boolean then (case when $5 is null then null else coalesce(assigned_at, now()) end) else assigned_at end,
       lead_notes = case when $6::boolean then $7 else lead_notes end,
       is_hidden = case when $8::boolean then $9::boolean else is_hidden end,
       lead_updated_at = now()
     where id = $1
     returning
       id, lead_id, full_name, phone_number, tnb_account_no, area, state,
       property_type, monthly_bill::float, email, roof_type, system_size, estimated_savings,
       source, utm_source, utm_medium, utm_campaign, notes, raw_data,
       created_at, coalesce(lead_status, 'unassigned') as lead_status,
       assigned_to, telemarketer_uid, assigned_at, lead_notes, lead_updated_at,
       coalesce(is_hidden, false) as is_hidden`,
    [
      id,
      hasStatus, patch.leadStatus ?? null,
      hasAssignedTo, assignedName,
      hasNotes, patch.notes ?? null,
      hasIsHidden, Boolean(patch.isHidden),
      agentUid,
    ],
  );

  const updatedRow = res.rows[0];
  if (updatedRow) {
    const prevStatus = (before?.lead_status as LeadStatus) || 'unassigned';
    const newStatus = (updatedRow.lead_status as LeadStatus) || prevStatus;
    const teleName = updatedRow.assigned_to ?? before?.assigned_to ?? null;
    const teleUid = updatedRow.telemarketer_uid ?? before?.telemarketer_uid ?? null;
    if (hasStatus && patch.leadStatus && patch.leadStatus !== prevStatus) {
      await sql(
        `insert into lead_activity_log (registration_id, lead_type, telemarketer_name, telemarketer_uid, action, previous_status, new_status, notes, is_mock, created_at)
         values ($1, 'ads', $2, $3, 'status_change', $4, $5, $6, false, now())`,
        [id, teleName, teleUid, prevStatus, newStatus, patch.notes ?? null],
      ).catch(() => {});
    } else if (hasNotes && patch.notes) {
      await sql(
        `insert into lead_activity_log (registration_id, lead_type, telemarketer_name, telemarketer_uid, action, previous_status, new_status, notes, is_mock, created_at)
         values ($1, 'ads', $2, $3, 'note_added', $4, $4, $5, false, now())`,
        [id, teleName, teleUid, newStatus, patch.notes],
      ).catch(() => {});
    }
  }

  return updatedRow ?? null;
}

export async function assignAtapSolarRegistrations(
  registrationIds: (string | number)[],
  assignedTo: string,
  notes?: string | null,
): Promise<{ updated: number }> {
  await migrate();
  const trimmed = assignedTo.trim();
  if (!trimmed) throw new Error('assignedTo is required');
  const ids = registrationIds.map((id) => Number(id)).filter((n) => Number.isFinite(n) && n > 0);
  if (!ids.length) return { updated: 0 };

  const target = await resolveTelemarketer(trimmed);
  const agentUid = target.uid;

  const res = await sql(
    `update atap_solar_registrations set
       assigned_to = $1,
       telemarketer_uid = $4,
       assigned_at = now(),
       lead_status = case when coalesce(lead_status, 'unassigned') = 'unassigned' then 'assigned' else lead_status end,
       lead_notes = case when $2::text is not null and $2 <> ''
                         then case when lead_notes is not null and lead_notes <> ''
                                   then lead_notes || E'\n' || $2
                                   else $2 end
                         else lead_notes end,
       lead_updated_at = now()
     where id = any($3::int[])
     returning id`,
    [target.name, notes?.trim() || null, ids, agentUid],
  );

  const assignedIds = res.rows.map((row) => Number(row.id)).filter((id) => Number.isFinite(id));
  if (assignedIds.length) {
    await sql(
      `delete from lead_activity_log
       where registration_id = any($1::int[]) and action = 'assignment'`,
      [assignedIds],
    ).catch(() => {});
  }

  for (const cid of assignedIds) {
    await sql(
      `insert into lead_activity_log (registration_id, lead_type, telemarketer_name, telemarketer_uid, action, previous_status, new_status, notes, is_mock, created_at)
       values ($1, 'ads', $2, $3, 'assignment', 'unassigned', 'assigned', $4, false, now())`,
      [cid, target.name, agentUid, notes?.trim() || null],
    ).catch(() => {});
  }

  return { updated: res.rows.length };
}

export async function unassignAtapSolarRegistrations(registrationIds: (string | number)[]): Promise<{ updated: number }> {
  await migrate();
  const ids = registrationIds.map((id) => Number(id)).filter((n) => Number.isFinite(n) && n > 0);
  if (!ids.length) return { updated: 0 };

  const res = await sql(
    `update atap_solar_registrations set
        assigned_to = null,
        telemarketer_uid = null,
        assigned_at = null,
        lead_status = 'unassigned',
        lead_updated_at = now()
     where id = any($1::int[])
     returning id`,
    [ids],
  );

  for (const cid of ids) {
    await sql(
      `insert into lead_activity_log (registration_id, lead_type, telemarketer_name, telemarketer_uid, action, previous_status, new_status, notes, is_mock, created_at)
       values ($1, 'ads', null, null, 'unassign', 'assigned', 'unassigned', null, false, now())`,
      [cid],
    ).catch(() => {});
  }

  return { updated: res.rows.length };
}

export async function hideAtapSolarRegistrations(
  registrationIds: (string | number)[],
  hide: boolean = true,
): Promise<{ updated: number }> {
  await migrate();
  const ids = registrationIds.map((id) => Number(id)).filter((n) => Number.isFinite(n) && n > 0);
  if (!ids.length) return { updated: 0 };

  const res = await sql(
    `update atap_solar_registrations set
       is_hidden = $2::boolean,
       lead_updated_at = now()
     where id = any($1::int[])
     returning id`,
    [ids, hide],
  );
  return { updated: res.rows.length };
}


// ---- Maps budget, taman auto-scan, discovered tamans ------------------------

const usageMonth = (at = new Date()): string => at.toISOString().slice(0, 7);

/** Add one scan's scraper.tech requests to this month's count. */
export async function addMapsUsage(requests: number): Promise<void> {
  if (!configured() || !Number.isFinite(requests) || requests <= 0) return;
  await migrate();
  await sql(
    `insert into maps_usage (month, requests) values ($1, $2)
     on conflict (month) do update set requests = maps_usage.requests + excluded.requests, updated_at = now()`,
    [usageMonth(), Math.round(requests)],
  );
}

/** Add one batch of calls to a search key's running spend. */
export async function addSearchKeySpend(kind: string, secret: string, t: {
  calls: number; dollars: number; failures: number; lastOkAt: string | null; lastError: string | null; lastErrorAt: string | null;
}): Promise<void> {
  if (!configured()) return;
  await migrate();
  await sql(
    `insert into search_key_spend (kind, secret, calls, dollars, failures, last_ok_at, last_error, last_error_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8)
     on conflict (kind, secret) do update set
       calls = search_key_spend.calls + excluded.calls,
       dollars = search_key_spend.dollars + excluded.dollars,
       failures = search_key_spend.failures + excluded.failures,
       last_ok_at = coalesce(excluded.last_ok_at, search_key_spend.last_ok_at),
       last_error = coalesce(excluded.last_error, search_key_spend.last_error),
       last_error_at = coalesce(excluded.last_error_at, search_key_spend.last_error_at)`,
    [kind, secret, t.calls, t.dollars, t.failures, t.lastOkAt, t.lastError, t.lastErrorAt],
  );
}

export async function listSearchKeySpend(kind: string): Promise<Array<{
  secret: string; calls: number; dollars: number; failures: number; last_ok_at: string | null; last_error: string | null; last_error_at: string | null; since: string;
}>> {
  if (!configured()) return [];
  await migrate();
  const out = await sql<{ secret: string; calls: number; dollars: string; failures: number; last_ok_at: string | null; last_error: string | null; last_error_at: string | null; since: string }>(
    `select secret, calls, dollars::text as dollars, failures, last_ok_at, last_error, last_error_at, since from search_key_spend where kind = $1`,
    [kind],
  );
  return out.rows.map((r) => ({ ...r, dollars: Number(r.dollars) }));
}

/** Maps requests the missing-taman finder spent this month from a PC; maps_usage counts only the hub's. */
export async function finderMapsRequestsThisMonth(): Promise<number> {
  if (!configured()) return 0;
  await migrate();
  const out = await sql<{ n: number }>(
    `select coalesce(sum(maps_requests), 0)::int as n from taman_finder_town where to_char(finished_at at time zone 'UTC', 'YYYY-MM') = $1`,
    [usageMonth()],
  );
  return Number(out.rows[0]?.n ?? 0);
}

export async function mapsUsageThisMonth(): Promise<number> {
  if (!configured()) return 0;
  await migrate();
  const out = await sql<{ requests: number }>('select requests from maps_usage where month = $1', [usageMonth()]);
  return Number(out.rows[0]?.requests ?? 0);
}

/**
 * Places that need no auto-scan: a Business scan since `since` that is queued,
 * running, completed, or partial with companies. Keyed by lower-cased place.
 * Also the number of auto-scans still in flight.
 */
export async function autoScanProgress(since: string, failuresSince = since): Promise<{ done: Set<string>; inFlight: number; gaveUp: Set<string> }> {
  await migrate();
  const out = await sql<{ place: string; status: string; auto: boolean }>(
    `select lower(trim(request->>'place')) as place, status, coalesce(request->>'autoQueued', '') = 'true' as auto
     from published_report
     where report_type = 'business_search'
       and lower(coalesce(request->>'keyword', '')) in ('business', '')
       and created_at >= $1
       and (status in ('queued', 'running', 'completed')
            or (status = 'partial' and jsonb_typeof(result->'companies') = 'array' and jsonb_array_length(result->'companies') > 0))`,
    [since],
  );
  // A place whose Business scan failed this many times is given up on, so one
  // bad taman cannot eat the budget. A run a restart abandoned is not its fault.
  const failed = await sql<{ place: string }>(
    `select lower(trim(request->>'place')) as place
     from published_report
     where report_type = 'business_search'
       and lower(coalesce(request->>'keyword', '')) in ('business', '')
       and created_at >= $1
       and status = 'failed'
       and coalesce(error, '') not like 'This run was abandoned%'
     group by 1
     having count(*) >= $2`,
    [failuresSince, AUTO_SCAN_MAX_FAILURES],
  );
  return {
    done: new Set(out.rows.map((r) => r.place)),
    inFlight: out.rows.filter((r) => r.auto && (r.status === 'queued' || r.status === 'running')).length,
    gaveUp: new Set(failed.rows.map((r) => r.place)),
  };
}

export const AUTO_SCAN_MAX_FAILURES = 3;

export type DiscoveredTaman = {
  state: string; district: string; name: string; query_place: string;
  evidence_url: string | null; maps_name: string | null; maps_address: string | null; verified: boolean;
};

/** Save found tamans; a name already saved for that district keeps its first record. */
export async function saveDiscoveredTamans(rows: Array<DiscoveredTaman & { name_key: string }>): Promise<number> {
  if (!rows.length) return 0;
  await migrate();
  let saved = 0;
  for (const r of rows) {
    const out = await sql(
      `insert into territory_discovered (state, district, name, name_key, query_place, evidence_url, maps_name, maps_address, verified)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9) on conflict (state, district, name_key) do nothing`,
      [r.state, r.district, r.name, r.name_key, r.query_place, r.evidence_url, r.maps_name, r.maps_address, r.verified],
    );
    saved += out.rowCount ?? 0;
  }
  return saved;
}

export async function listDiscoveredTamans(state?: string): Promise<DiscoveredTaman[]> {
  if (!configured()) return [];
  await migrate();
  const out = await sql<DiscoveredTaman>(
    `select state, district, name, query_place, evidence_url, maps_name, maps_address, verified
     from territory_discovered where ($1::text is null or lower(state) = lower($1)) order by state, district, name`,
    [state ?? null],
  );
  return out.rows;
}

export type FinderTownRun = {
  state: string; district: string; town: string; status: 'done' | 'failed'; started_at: string;
  maps_requests: number; addresses_read: number; names_seen: number; added: number;
  detail: Record<string, unknown>; error: string | null;
};

/** Record one town the finder checked. A town is checked once: a second record is ignored. */
export async function recordFinderTown(run: FinderTownRun): Promise<boolean> {
  await migrate();
  const out = await sql(
    `insert into taman_finder_town (state, district, town, status, started_at, maps_requests, addresses_read, names_seen, added, detail, error)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) on conflict (state, district, town) do nothing`,
    [run.state, run.district, run.town, run.status, run.started_at, run.maps_requests, run.addresses_read, run.names_seen, run.added, JSON.stringify(run.detail), run.error],
  );
  return (out.rowCount ?? 0) > 0;
}

export async function listFinderTowns(): Promise<Array<FinderTownRun & { finished_at: string }>> {
  if (!configured()) return [];
  await migrate();
  const out = await sql<FinderTownRun & { finished_at: string }>(
    `select state, district, town, status, started_at, finished_at, maps_requests, addresses_read, names_seen, added, detail, error
     from taman_finder_town order by finished_at desc`,
  );
  return out.rows;
}

/** Addresses of saved leads that name this town: free address evidence for the finder. */
export async function leadAddressesForTown(town: string): Promise<string[]> {
  if (!configured() || !town.trim()) return [];
  await migrate();
  const out = await sql<{ address: string }>(
    `select address from company_data
     where merged_into is null and address is not null and address ilike '%' || $1 || '%'
     limit 20000`,
    [town.trim()],
  );
  return out.rows.map((r) => r.address);
}

// ---- auto-queue dashboard ---------------------------------------------------
// Read straight from the saved runs, never from the queues' own counters, so the
// /auto-queue page shows what actually happened rather than what a loop believes.

const AUTO_RUN = `request->>'autoQueued' = 'true' and report_type in ('business_search', 'contact_research')`;
const HOUR = (col: string) => `to_char(date_trunc('hour', ${col} at time zone 'UTC'), 'YYYY-MM-DD"T"HH24":00:00Z"')`;
/** Hub events that mean an auto-run went wrong, or that a queue stopped or started again. */
export const AUTO_QUEUE_PROBLEM_EVENTS = ['contact.deferred', 'contact.failed', 'business_search.save_failed', 'auto.tick_failed', 'auto.hold'];

export type AutoQueueHourRow = {
  hour: string; kind: string; status: string; n: number;
  companies: number; requests: number; skipped: number; with_phone: number; people: number; avg_sec: number;
};

/** Per hour since `since`: auto-runs started, auto-runs finished by outcome, finder towns, problem events. */
export async function autoQueueHourly(since: string): Promise<{
  started: Array<{ hour: string; kind: string; n: number }>;
  finished: AutoQueueHourRow[];
  finder: Array<{ hour: string; status: string; n: number; added: number; requests: number }>;
  events: Array<{ hour: string; event: string; n: number }>;
}> {
  await migrate();
  const [started, finished, finder, events] = await Promise.all([
    sql<{ hour: string; kind: string; n: number }>(
      `select ${HOUR('created_at')} as hour, report_type as kind, count(*)::int as n
       from published_report where ${AUTO_RUN} and created_at >= $1 group by 1, 2`,
      [since],
    ),
    sql<AutoQueueHourRow>(
      `select ${HOUR('coalesce(completed_at, updated_at)')} as hour, report_type as kind, status, count(*)::int as n,
         coalesce(sum(case when jsonb_typeof(result->'companies') = 'array' then jsonb_array_length(result->'companies') end), 0)::int as companies,
         coalesce(sum(case when (result->'scan_metadata'->>'requests') ~ '^[0-9]+$' then (result->'scan_metadata'->>'requests')::int end), 0)::int as requests,
         coalesce(sum(case when jsonb_typeof(result->'scan_metadata'->'skipped_searches') = 'array' then jsonb_array_length(result->'scan_metadata'->'skipped_searches') end), 0)::int as skipped,
         (count(*) filter (where jsonb_typeof(result->'phone_contacts') = 'array' and jsonb_array_length(result->'phone_contacts') > 0))::int as with_phone,
         coalesce(sum(case when jsonb_typeof(result->'decision_makers') = 'array' then jsonb_array_length(result->'decision_makers') end), 0)::int as people,
         coalesce(round(avg(extract(epoch from coalesce(completed_at, updated_at) - created_at))), 0)::int as avg_sec
       from published_report
       where ${AUTO_RUN} and status in ('completed', 'partial', 'failed') and coalesce(completed_at, updated_at) >= $1
       group by 1, 2, 3`,
      [since],
    ),
    sql<{ hour: string; status: string; n: number; added: number; requests: number }>(
      `select ${HOUR('finished_at')} as hour, status, count(*)::int as n,
         coalesce(sum(added), 0)::int as added, coalesce(sum(maps_requests), 0)::int as requests
       from taman_finder_town where finished_at >= $1 group by 1, 2`,
      [since],
    ),
    sql<{ hour: string; event: string; n: number }>(
      `select ${HOUR('at')} as hour, event, count(*)::int as n
       from run_event where at >= $1 and event = any($2::text[]) group by 1, 2`,
      [since, AUTO_QUEUE_PROBLEM_EVENTS],
    ),
  ]);
  return { started: started.rows, finished: finished.rows, finder: finder.rows, events: events.rows };
}

export type AutoQueueProblem = {
  at: string; source: string; kind: string; title: string | null; message: string; public_id: string | null; detail?: unknown;
};

/** What went wrong since `since`, newest first: failed or partial auto-runs, skipped Maps searches, problem events, failed finder towns. */
export async function autoQueueProblems(since: string, limit = 300): Promise<AutoQueueProblem[]> {
  await migrate();
  const [reports, events, towns] = await Promise.all([
    sql<{ at: string; kind: string; status: string; title: string | null; error: string | null; public_id: string; skipped: string[] | null }>(
      `select coalesce(completed_at, updated_at) as at, report_type as kind, status, title, error, public_id,
         case when jsonb_typeof(result->'scan_metadata'->'skipped_searches') = 'array' then result->'scan_metadata'->'skipped_searches' end as skipped
       from published_report
       where ${AUTO_RUN} and coalesce(completed_at, updated_at) >= $1
         and (status in ('failed', 'partial') or jsonb_typeof(result->'scan_metadata'->'skipped_searches') = 'array')
       order by 1 desc limit $2`,
      [since, limit],
    ),
    sql<{ at: string; stage: string | null; event: string; public_id: string | null; detail: Record<string, unknown> }>(
      `select at, stage, event, public_id, detail from run_event
       where at >= $1 and event = any($2::text[]) order by at desc limit $3`,
      // contact.failed is the same failure as the failed report above; listing both doubles it.
      [since, AUTO_QUEUE_PROBLEM_EVENTS.filter((e) => e !== 'auto.hold' && e !== 'contact.failed'), limit],
    ),
    sql<{ at: string; state: string; district: string; town: string; error: string | null }>(
      `select finished_at as at, state, district, town, error from taman_finder_town
       where finished_at >= $1 and status <> 'done' order by finished_at desc limit $2`,
      [since, limit],
    ),
  ]);
  const out: AutoQueueProblem[] = [];
  for (const r of reports.rows) {
    const at = new Date(r.at).toISOString();
    if (r.status === 'failed' || r.status === 'partial') {
      out.push({ at, source: r.kind, kind: r.status, title: r.title, message: r.error || `${r.status} with no error text`, public_id: r.public_id });
    }
    if (r.skipped?.length) {
      out.push({ at, source: r.kind, kind: 'skipped_searches', title: r.title,
        message: `${r.skipped.length} Maps search(es) failed twice and were skipped`, public_id: r.public_id, detail: r.skipped.slice(0, 10) });
    }
  }
  for (const e of events.rows) {
    const d = e.detail ?? {};
    const message = String(d.error ?? d.reason ?? d.server_error ?? d.worker_error ?? e.event);
    out.push({ at: new Date(e.at).toISOString(), source: e.stage ?? 'hub', kind: e.event, title: null, message, public_id: e.public_id });
  }
  for (const t of towns.rows) {
    out.push({ at: new Date(t.at).toISOString(), source: 'taman_finder', kind: 'failed', title: `${t.town}, ${t.district}, ${t.state}`, message: t.error || 'failed with no error text', public_id: null });
  }
  return out.sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit);
}

/** Auto-runs still open, oldest first; when each queue last started and finished a run; the week's hold changes. */
export async function autoQueueState(): Promise<{
  open: Array<{ public_id: string; kind: string; status: string; title: string | null; created_at: string; updated_at: string }>;
  latest: Array<{ kind: string; last_queued: string | null; last_finished: string | null; last_completed: string | null }>;
  finderLatest: string | null;
  holds: Array<{ at: string; stage: string | null; reason: string | null }>;
}> {
  await migrate();
  const [open, latest, finder, holds] = await Promise.all([
    sql<{ public_id: string; kind: string; status: string; title: string | null; created_at: string; updated_at: string }>(
      `select public_id, report_type as kind, status, title, created_at, updated_at from published_report
       where ${AUTO_RUN} and status in ('queued', 'running') order by created_at limit 200`,
    ),
    sql<{ kind: string; last_queued: string | null; last_finished: string | null; last_completed: string | null }>(
      `select report_type as kind, max(created_at) as last_queued,
         max(coalesce(completed_at, updated_at)) filter (where status in ('completed', 'partial', 'failed')) as last_finished,
         max(completed_at) filter (where status = 'completed') as last_completed
       from published_report where ${AUTO_RUN} group by 1`,
    ),
    sql<{ at: string | null }>(`select max(finished_at) as at from taman_finder_town`),
    sql<{ at: string; stage: string | null; reason: string | null }>(
      `select at, stage, detail->>'reason' as reason from run_event
       where event = 'auto.hold' and at >= now() - interval '7 days' order by at desc limit 100`,
    ),
  ]);
  return { open: open.rows, latest: latest.rows, finderLatest: finder.rows[0]?.at ?? null, holds: holds.rows };
}
