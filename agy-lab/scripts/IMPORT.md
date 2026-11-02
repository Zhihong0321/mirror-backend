# Copying agy-lab's data into company-diver

`scripts/import-from-pg2nd.ts` copies the tables the three pipelines use out of
`pg_2nd` (read-only, through the pg-proxy) into this service's own Postgres
(`DATABASE_URL`, MirrorDB). The source is never written.

## Tables copied (default `core` group, 160 rows in all)

| Table | Rows | Why |
|---|---:|---|
| `llm_lane` | 5 | LLM lanes edited on /workers; holds the lane API keys (`core/llm.ts`) |
| `gemini_contact_key` | 57 | The key pool: tavily, exa, exa_proxy, brave, minimax, scraper_tech, parallel, smartlead, pagespeed (`contact-keys.ts`, `reportdb.listGeminiContactKeys`) |
| `search_key_spend` | 44 | What each key in that pool has spent |
| `maps_usage` | 2 | Google Maps requests per month, written by `maps-worker.ts`, read by the auto-queue page |
| `company_dive` | 27 | Company dive runs, dossiers and public pages (`companydive*.ts`) |
| `dive_deeper` | 5 | Dive-deeper runs and `report_html` (`divedeeper.ts`) |
| `dive_preview` | 20 | Free preview per company dive (`divedeeper.ts`) |

**Country-industry research has no database table.** Its jobs are JSON snapshots on
the hub's `/data` volume (`country-job-store.ts`). Copy that folder separately if old
runs must be kept (see "Not in the database").

### Left out, on purpose

Other apps in `pg_2nd`: `agents`, `users`, `sessions`, `messages`, `orchestrator_*`,
`vault_*`, `schedules*`, `execution_*`, `settings`, `api_usage`, `activity_events`,
`debug_events` and the rest. Nothing in `agy-lab/src` reads them.

Lead pipeline (the six loops switched off in this fork's `server.ts`): `company_data`,
`search_report*`, `published_report`, `company_research_run`, `person_research_run`,
`contact_research_run`, `ads_*`, `run_event`, `company_email`, `telemarketer`,
`taman_*`, `territory_discovered`, `lead_activity_log`, `atap_solar_registrations`,
`company`, `company_place`, `search_list_*`, `list_step2_*`, `email_marketing_*`.
`--group leads` copies them anyway (about 1.5 million rows; `--resume` helps).
The company dive and dive-deeper code never reads them. `reportdb.migrate()` still
creates them empty on first start, because the fork keeps `reportdb.ts` whole.

## Run it

The script needs `DATABASE_URL` as the private Railway address, so run it inside the service.
The image must carry the script and `schema.sql`; add to the Dockerfile:

```
COPY agy-lab/scripts ./scripts
COPY agy-lab/schema.sql ./schema.sql
```

Service variables (already set on `company-diver`): `DATABASE_URL`,
`SRC_PG_PROXY_URL`, `SRC_PG_DB_NAME=pg_2nd`, `SRC_PG_PROXY_TOKEN`.

```bash
railway ssh --service company-diver
cd /app
node scripts/import-from-pg2nd.ts --dry-run     # reads the source only, writes nothing
node scripts/import-from-pg2nd.ts               # the copy
```

Order of work: apply `schema.sql`, run `reportdb.migrate()`, then per table: create it
from the source catalog if still missing, copy, create indexes, reset the id sequence,
and at the end add the foreign keys between copied tables. It ends with a per-table
source/target count and exits 1 if any table does not match.

Flags: `--tables a,b` · `--group core|leads|all` · `--truncate` (empty the selected tables
first, no CASCADE) · `--resume` (start after the last primary key already there; only
when nothing else has written to that table) · `--batch N` · `--skip-migrate` ·
`--schema PATH`.

Re-running is safe: rows go in with `ON CONFLICT DO NOTHING`. A table without a primary
key loads only while empty here. Run it **before** the new app takes traffic: it skips
nothing that exists, but a row the app already changed is not overwritten.

## What was tested (from this PC, source side only)

- `--dry-run` on the core and leads groups: every table found, counts match `pg_2nd`.
- For each core table the cast chain (read `::text`, send as JSON, cast back to the
  column type) was run on the source and compared with the original: lossless for jsonb,
  `timestamptz` (microseconds), `numeric`, `bigint`. Keyset paging checked.
- Found and fixed: `ORDER BY "id"` over a `"id"::text` output column sorts as text
  (10 before 6) and would have skipped and repeated rows. The reads now order by `t."id"`.
- The write side (DDL, insert, sequences, foreign keys) was **not** run: MirrorDB is not
  reachable from this PC. The first real run should be `--dry-run`, then the copy.

## Known limits

- The proxy corrupts multi-byte characters that straddle a chunk boundary in request
  bodies over about 64 KB, and returns 502 over about 1 MB. The import never sends data
  to the proxy (it only reads), so the copy is unaffected; the dry-run check only
  round-trips small rows and says so for the big ones (`dive_deeper.report_html`).
- Tables created from the source catalog keep columns, defaults, primary and unique
  keys, CHECK constraints and indexes. Foreign keys are added only between copied tables.
  A foreign key that existing rows break is added `NOT VALID` and reported.
- The read-only token expires 2026-11-06.

## Not in the database

Files on the ee-auto `/data` volume are not copied by this script: country-industry
job snapshots (`country-job-store.ts`) and the API call log (`logstore.ts`,
`api-YYYY-MM-DD.jsonl`).
