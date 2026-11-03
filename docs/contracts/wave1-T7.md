# T7: Evidence store

**Status: draft for the owner's approval (2026-11-03).** Design: `docs/research-storage-design.md`. R9: raw calls are evidence. Resume stays on the step table (T12).

**Builder:** grok-4.7. **Reviewer:** codex (gpt-6.1-terra).

## What it is for

A company dive, a dive-deeper, and its preview each write one row when a provider call returns, success or failure, under that run's `public_id`. The write does not depend on `opts.log`. Rows only: no reuse, no check outcome (T9, R2).

## Owned files

| Path under `agy-lab/src/` | What |
|---|---|
| `evidence/context.ts` | new. `AsyncLocalStorage` |
| `evidence/store.ts` | new. table, insert, read |
| `evidence-door.test.ts` | boundary check |
| `core/{llm,tavily,exa,brave,pagespeed,parallel}.ts` | record at each return |
| `divedeeper/lib.ts` | `ctx.call` stores a clone of the body |
| `companydive/runner.ts`, `divedeeper/run.ts`, `divedeeper/preview-writer.ts` | open the report context |

Nothing else: not `cost.ts`, `switches.ts`, either `http.ts`, `pipeline.ts`, either `store.ts`, `companydive-people.ts`, the lane files, `pagefetch.ts`, `pi.ts`, `search.ts`, `proxy.ts`, `smartlead.ts`, or `Finding`.

## Dependencies

T6 merges first and owns `switchOn`, the global-off env, and the preview sweep's read of `company_dive.options` (`preview-writer.ts:31` has no `c.options`). T7 does not add it. Missing `options` leaves that preview off. T8 rebases `runner.ts` after T7. T9 follows on `lib.ts` and owns `Finding`.

## Switch `evidence`

Call `switchOn(options, 'evidence')`. On only when that is true and `public_id` is non-empty, in both `execute`s and on the preview options T6 attached. A preview uses the company dive's `public_id`. Off, or no context: `record` returns at once (no serialize, no clone, no row). Same returns, logs, and `ms`.

`evidence_fail` is proof-only, sent only as `switches` on `POST /api/company-dive` or `POST /api/dive-deeper` (`divedeeper/http.ts:88`). Not an env setting. T6 stores it on the run. Inserts then throw before the query: the run finishes, zero rows, one warning, later throws quiet. The same task deletes it from `options.switches`.

## Table `evidence_call`

Index `evidence_call_report_idx` on `(report_uid, at)`. Retries append.

```sql
create table if not exists evidence_call (
  id bigserial primary key,
  report_uid text not null,
  parent_report_uid text,
  kind text not null,
  step text not null,
  provider text not null,
  api text not null,
  what text not null,
  request jsonb,
  raw jsonb,
  status text not null,
  ok boolean not null,
  at timestamptz not null,
  ms int not null,
  model text,
  usd numeric,
  note text)
```

`report_uid` is `public_id`; parent on a dive-deeper only. `kind`: `company_dive`, `dive_deeper`, `preview`. `step`: `research`, `people`, the lane key, or `P-preview`. `provider` defaults to `api`. `request`: query, URL, or messages. `raw`: the clone. `at` and `ms` come from the `ApiCall`. No header, key, JWT, or token (`token` stores none; `run` stores `{ url, strategy }` and `d`). Cap at 8 MiB UTF-8; above that `{ omitted: true, bytes }`, and the row is still inserted. HTML and Lighthouse JSON stay whole under the cap.

## Signatures

```ts
export type ReportCtx = {
  reportUid: string; parentReportUid: string | null;
  kind: 'company_dive' | 'dive_deeper' | 'preview';
  step: string; weight: number; on: boolean };
export type CallStatus = 'found' | 'not found' | "couldn't check" | 'failed';
export function runWithReport<T>(ctx: ReportCtx, fn: () => Promise<T>): Promise<T>
export function step<T>(name: string, fn: () => Promise<T>): Promise<T>
export function current(): ReportCtx | undefined
export function record(call: ApiCall, raw: unknown): void
export function callsForReport(reportUid: string): Promise<EvidenceCall[]>
export function statusOf(call: { ok: boolean; results?: number; note?: string }): CallStatus
export function settle(reportUid: string, maxMs: number): Promise<void>   // never throws
```

No `setStep`. `step(name, fn)` runs `fn` on a child store `{ ...parent, step: name }` and does not write the parent. `cost.ts` `done` is unchanged. `record` returns before serialization when off or with no context. Lookup, serialization, the cap, and the insert cannot throw into the caller and do not delay it. One warning per run.

**Nothing changes a call.** If `runWithReport` or `step` cannot set up the context, `fn` runs without one (no rows for it). If cloning or reading a body fails, the row gets `raw = { unreadable: true, note }`; the response the caller reads is never touched.

**Durability.** Each insert joins a per-run pending set. Each run's `execute` (company dive, dive-deeper, preview), in its `finally` after success, failure or the time limit, awaits `settle(reportUid, 10_000)` before the run row is marked final. The live proof reads rows only after the row is final. A call that returns after `settle` still writes its own row with its own `report_uid` and `at` (later than `finished_at`: counted as late in the proof).

**Bodies.** Text bodies (`text/*`, JSON, XML, HTML) are stored as text under the cap. Any other content type (PDF, images, archives) stores only `{ content_type, bytes, sha256 }`, never the body.

`statusOf`: `results === 0` on ok is `not found`; other ok is `found`; timeout, unreachable, rate limit, 429, or blocked is `couldn't check`; else `failed`. Missing `results` is not zero.

## Handover

At each success and each failure: `const rec = call.done(...)`; push `rec` only when a log was passed; `record(rec, raw)` either way. `opts.log?.push(call.done(...))` skips `done` with no log (`exa.ts:135`, `llm.ts:337`). Same `ApiCall` clock.

Exa `requestWithKey` (`exa.ts:129`): `out` or the failure. People Exa (`companydive-people.ts:63`) has no log (unlogged; leave that file). LLM `round` (`llm.ts:326`): every attempt. `minimax` (`:414`) and `agent` (`:455`): one Pi outcome. Tavily `searchWithKey` (`:278`), pool `request` (`:363`, one row), `requestWithKey` (`:437`): both ways; no extract row. Brave `searchRaw` (`brave.ts:74`): each key after the `what` prefix (`:86`). PageSpeed `token` and `run`, and Parallel `entitySearch`: both ways; no token, JWT, or key.

`call` (`lib.ts:159`) pushes `meter.calls` on the first `done`. Raw is `response.clone()` of the `fetch` between `call()` and `done`, so the lane reads the original. `read` and `page` pass their text beside the `ApiCall`. **Known gap, by design:** lanes that call `fetch` themselves between `call()` and `done` (`A-assets.ts:322`,
`C-rules.ts:524`, `D-registry.ts:63`) never hand `ctx.call` their response, and T7 does not own those lane files. Their
row is written with `raw = null` and `note = 'lane-fetched: body captured by the lane task'`; T13–T18 capture those
bodies lane by lane. So T7 promises raw results for every core call and every `read` / `page`, not for lane-own
fetches. Off: no clone. Core records its own calls once.

Company dive (`runner.ts:69`): `company_dive`, weight 1, step `research`. People (`:87`) runs in `step('people', ...)`, beside research; `progress` (`:78`) does not set a step. Dive-deeper (`run.ts:45`): `dive_deeper`, weight 50, parent from `diveRow`, each `runLane` (`:84`) in its own `step`. No `enterWith`. Preview (`:65`): `preview`, weight 1, `P-preview`. `weight` is for T11. No flush after `Promise.race` (`runner.ts:97`): a late return writes its own row.

## Live proof

Suggest Synapse Comms. The owner picks the company. One deploy.

1. With `evidence`, one company dive, one dive-deeper, and that preview; then the same three without. Compare `agy-lab/scripts/dive-snapshot.ts` and `deeper-snapshot.ts` line by line. Explain ids, times, and provider variation. Snapshots match. On: every logged call has a row (LLM vs `result.llm` and `result.people.llm` on `at`, `what`, `ok`, `ms`; Brave vs `result.brave` on count, `at`, `ok`, `ms`; lane `calls` on that `public_id`, parent set; the preview meter). Unlogged rows, including people Exa, counted apart. Returned bodies are in `raw`. Off: no rows.
2. One operator-API company dive with `evidence` and `evidence_fail`. Inserts throw, the snapshot matches, zero rows, one warning, then this task deletes `evidence_fail`. Do not break Postgres or a key.

`node --test` is a guard. The door test allows `evidence/` exactly one dependency on `cost.ts`: `import type { ApiCall }`
(erased at run time). It fails on any other `cost.ts` import, or any import of `companydive/`, `divedeeper/`, `contact`, `checks/`, `steps/`, or `core/`, or names a provider host.

## Out of scope

Resume, leases, call reuse, steps, checks, `Finding`, identity, the limiter, queues, `mapsSearch`, `pagefetch.ts`, Pi turns, usage probes, `smartlead`, contacts, and `OUT/*.json`. No change to `ApiCall`, `startCall`, `diveCalls`, `meter.calls`, or a return value.

## Notes for Claude

Checked against the current code. Two codex reviews (2026-11-03); the second's open points (lane-own fetches, settle
before the run is final, setup and clone failures, the type-only `cost.ts` import, binary bodies) were settled by Claude
in this text.

## Build review decisions (Claude, 2026-11-03)

Codex reviewed the build twice. Fixed: the off path builds a call record only where the old code did (a log was
passed) or when evidence is active; no added `await`, wrapper or `finally` at the run starts; content types on an
allow-list; provider from the call; `evidence_fail` armed for previews; MiniMax builds its prompt inside its `try`.

**The bar for "switch off is identical":** same return values, same thrown error objects, same log lines, same order of
real operations (network calls, database writes, timers). Accepted as not behaviour: plain property reads on the app's
own request objects (no getters, no side effects) and the extra microtask ticks of an async step at the run starts.
Kept by the contract's design and commented in the code: lane-own fetches have no body to capture; a failed call
stores its error message.
