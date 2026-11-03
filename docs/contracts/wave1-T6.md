# T6 contract: switches

**Status: draft for the owner's approval (2026-11-03).** Part of T5. Plan: `docs/overhaul-plan.md`, T6 and sections 6–7.

**Builder:** agy (gemini-3.8-flash-high). **Reviewer:** codex.

**What it is for.** Give each company dive and dive-deeper run its own list of switches. One environment setting turns every new switch off. This supplies the “beside the old code, behind a switch” rule in “How we build”; T6 has no R-item of its own.

**Owned files:** new `agy-lab/src/switches.ts`, new `agy-lab/src/switches.test.ts` (boundary check only); `agy-lab/src/companydive/store.ts`, `agy-lab/src/companydive/http.ts`, `agy-lab/src/divedeeper/store.ts`, `agy-lab/src/divedeeper/http.ts`, and in `agy-lab/src/divedeeper/preview-writer.ts`
only the preview sweep's read of the company dive's `options` (so T10 can check `preview2`). Nothing else.

**What goes where:**

| File | Takes |
|---|---|
| `switches.ts` | Parsing, the shared options type, the effective switch check and the global off setting. No database, HTTP or provider imports. |
| `companydive/store.ts` | Extend `DiveRow.options` with optional switches; keep `people` and null compatibility. Serialize options as JSON when updated. |
| `divedeeper/store.ts` | Add the options column and `Row.options`; include options in the update helper's JSON serialization. Keep the existing table-ready retry. |
| Both `http.ts` files | Accept top-level `switches` on POST start, validate it and persist it before queuing. |
| `divedeeper/preview-writer.ts` | The sweep's SELECT (`:31`) also reads `company_dive.options` and hands it to the writer, unused until T10. |
| `switches.test.ts` | Read real source: both start handlers use the shared parser; the helper has no app-layer imports. |

**Interface: storage.** No new table or index. Exact column shapes:

| Table | SQL shape |
|---|---|
| `company_dive` | Existing: `options jsonb NOT NULL DEFAULT '{}'::jsonb`. Keep it. |
| `dive_deeper` | Add in `ensureTable`: `ALTER TABLE dive_deeper ADD COLUMN IF NOT EXISTS options jsonb NOT NULL DEFAULT '{}'::jsonb;` |

Options contain an optional `switches` array of strings. Company options also retain `people`. Existing deeper rows read as empty options. Do not backfill company options or replace unrelated option keys.

**Interface: exports from `switches.ts`.**

| Export signature | Contract |
|---|---|
| `export type SwitchOptions = { switches?: string[] };` | Shared part of either run's options. |
| `export function parseSwitches(value: unknown): string[];` | Missing value returns an empty list. Otherwise require an array of lowercase names matching `^[a-z][a-z0-9_]*$`. Remove duplicates, keeping first order. Invalid input throws `TypeError`. |
| `export function switchOn(options: SwitchOptions \| null \| undefined, name: string, env?: NodeJS.ProcessEnv): boolean;` | Defaults to current `process.env`. True only for exact list membership with global off inactive. Missing or malformed stored switches fail closed. Never mutate options. |

Accept valid names without a central allow-list, including `evidence`, `identity`, `preview2`. A name enables behaviour only when its owning module checks it.

**Switch name and old callers.** `options.switches` is the mechanism. `OVERHAUL_SWITCHES_OFF`, trimmed and case-insensitive, disables every switch for `1`, `true`, `on`, or `yes`; other values leave per-run selection active. Evaluate it on each check. Keep requested lists stored when global off is active, so rollback does not erase intent. It does not cancel calls already running.

Both start handlers parse before creating any run or starting a dependent company dive. Malformed lists return HTTP 400 with `error: 'invalid switches'`. Missing or empty lists keep today's company options and use deeper's empty default. Persist nonempty lists with parameterized JSON writes. Preserve response shapes: no new top-level fields, and no change
at all when the list is absent. (`GET /api/company-dive/:id` already returns the whole row, `select *` and `...row` at
`companydive/http.ts:83–85`, so a stored list shows up inside `options` there; that is expected, not a proof failure.)
Preserve `people`, queue order and retry selections. Retries keep stored options. Switch off = byte-for-byte the old behaviour, apart from the declared additive storage. Existing environment switches retain their meanings.

**Live proof (after T1–T2, one deploy, owner OK).**

- Owner picks a real company; suggest Synapse Comms. For each start API, run once with `evidence` selected and once without. Save rows, request/response bodies, stages, logs, result fields, reports and previews. Compare line by line; explain IDs, times and provider variation. Only selected rows contain the list. T6 alone changes no research output.
- Against those real rows in the deployed runtime, evaluate `switchOn`: selected true, unselected false. Set global off and repeat: both false, stored lists intact. Restore the setting. Save command output and deployment evidence.
- Intentionally send malformed lists to both live APIs. Confirm 400 and no new run, dependent dive or queued work.

**Out of scope.** No feature consumers, R-item fixes, scheduler, evidence store, identity work, preview rewrite or deployment by the builder. Local checks are guards only; never invent test data or call tests proof. Stop and report if the contract does not fit.

**Notes for Claude.** Rechecked the T6 facts against current code; no discrepancy found. `startDive(company)` in `divedeeper/run.ts:8` sends no switches. Run selection is independent: T6 does not propagate a deeper list to its company dive. Later propagation needs that file's owner. T7 owns execution-context hooks. The list GETs, `publicView` and `company-uid.ts` `reports` omit options; T6 leaves them so. The preview sweep's read of
options is T6's (decided by Claude for T10; grok's review, 2026-11-03). Builder must not deploy, access production/Railway or read `D:\Tools\my-vault`. Merge, deploy and proof remain Claude's work after owner approval.

---

## Live proof result (deployed 2026-11-03 04:28 UTC, merge `3e4d574`, live 04:29:20)

1. **Malformed lists, on purpose:** `"evidence"`, `null`, `["Bad!"]` and `["evidence",1]` on both `POST /api/company-dive`
   and `POST /api/dive-deeper`: all 8 answered `400 {"error":"invalid switches"}`; the newest ids stayed company dive 39
   and dive-deeper 17, so nothing was created or queued.
2. **Same company with and without `evidence`** (Synapse Comms): company dive #40 (with) vs #41 (without), dive-deeper
   #18 (with) vs #19 (without) on dive #38, compared with `dive-snapshot.ts` and `deeper-snapshot.ts`: identical except
   the follow-up searches the LLM picks in `fill` / `reflect` (company dive) and the finishing order of the parallel
   stage-1 lanes (dive-deeper). Same status, stages, fields, counters, dossier, preview, 16 lanes and report.
3. **Stored options on the real rows:** #40 `{"people":true,"switches":["evidence"]}`, #41 `{"people":true}` (exactly
   as before T6), #18 `{"switches":["evidence"]}`, #19 `{}`. `switchOn(evidence)`: true only for #40 and #18; with
   `OVERHAUL_SWITCHES_OFF=yes` false for all four, the stored lists untouched.

**Ticked by the owner on 2026-11-03.**
