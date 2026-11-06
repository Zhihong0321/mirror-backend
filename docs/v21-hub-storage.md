# V2.1 on the hub: raw data in the database, Step 2 online

Decided 2026-11-06. Follows [research-storage-design.md](research-storage-design.md) (company → report → research call),
built for V2.1 only, as its own module that touches no other table.

## What is stored (Postgres, `src/v21-store.ts`)

| Table | One row per | Holds |
|---|---|---|
| `v21_report` | V2.1 dive | report UID (issued before the first call), company, country, industry, website, `company_id` (reserved, set where known), `step1_status`, `step2_status` + errors |
| `v21_raw` | stored result | report UID, step (1/2), kind, `run_id`, status, `payload` jsonb. Written once, never updated or deleted |

Kinds:

- **Step 1** (run_id = report UID): `checkpoint` (the whole raw research: searches, page text, probes with their lookup
  results, Maps, LinkedIn) and `log`.
- **Step 2** (one run_id per run): `tidy` (the exact input the judge got), `judge` and `recheck` (each with its raw model
  answer and every lane attempt), `result` (the final output).

Read by report UID only: `GET /api/v21/report/{id}` (rows, no payload), `GET /api/v21/report/{id}/raw/{rowId}` (payload).

## Routes

- `POST /api/v21/step1` creates the report row first and returns `report_id` (same value as `id`); the checkpoint and log
  are written when the run ends. `GET /api/v21/step1/{id}` answers from the database after a restart.
- `POST /api/v21/step2 { report_id, recheck? }` reads the checkpoint from the database, runs tidy → judge → recheck, writes
  each row the moment it exists. `GET /api/v21/step2/{report_id}?run_id=` returns the status and the final result.
  Refused with 404 (no such report), 409 (no checkpoint yet, or Step 2 already running; a "running" older than 1 hour counts
  as abandoned).

## Not done yet (stated, not hidden)

- Step 1 writes its checkpoint **when the run ends**, not call by call. A crash mid-run loses that run's paid searches.
  Call-by-call writing means changing `research.ts` and is a later stage.
- Step 1 still also writes its checkpoint file to the `/data` volume. The database copy is the one to read; the file is a
  second copy and should go once the database copy is proven.
- Reports are not linked to a company UID yet (`company_id` stays empty) and do not use the old `reports` table.
- The PC benchmark table `step2_bench_run` stays as it is; hub Step 2 runs are compared from `v21_raw` rows.
- One owner per report is a status check, not a lease: two hub containers during a deploy could still both run it.
