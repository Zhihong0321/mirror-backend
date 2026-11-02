# Wave 0 contracts: the three seams (T1, T2, T3)

**Status: draft for the owner's approval (2026-11-02).** Part of T5. Plan: [../overhaul-plan.md](../overhaul-plan.md).

Rules for all three:

- **No behaviour change at all.** Code is moved, never rewritten: every moved function, constant and type keeps its body
  byte for byte. Only `import`/`export` lines change. No switch is needed, because nothing changes.
- **The public surface stays the same.** The old file stays as a facade that re-exports exactly its old exported
  names (an explicit list, not `export *`), so `server.ts`, the tests and every importer are untouched.
- **Module state moves whole.** Each mutable value (`waiting`, `active`, `tableReady`, timers, sets) lives in exactly one
  new file; nothing is duplicated.
- Builders never deploy, never touch Railway, the production database or `D:\Tools\my-vault`.
- Builds run in parallel (different files). Deploys go one at a time, only after T0 (the lead import) has finished.

How Claude checks each diff (a guard, never the proof):
1. Every changed file is in the task's owned list.
2. **Pure-move check:** the old file's code, minus import/export lines, equals the new files' code joined, minus
   import/export lines (a script compares them; the only allowed difference is the `export` keyword on a helper that
   now crosses files).
3. `npm test` passes as before, and each new module plus the facade imports cleanly in Node 24.

---

## T1: seam for the company dive (`companydive.ts`, 1,231 lines)

**Builder:** grok-4.7. **Reviewer:** codex (gpt-6.1-terra).

**Owned files:** `agy-lab/src/companydive.ts` (becomes the facade); new `agy-lab/src/companydive/pipeline.ts`,
`runner.ts`, `http.ts`, `store.ts`. Nothing else.

**What moves where** (line numbers from main at 3d2b24b):

| New file | Takes | Lines |
|---|---|---|
| `companydive/pipeline.ts` | the research: types (`Source`, `Fact`, `Identity`, `DiveResult`, `Progress`, `TavilyCall`, `LlmUse`, `Warn`, `DiveStats`, `Alongside`, `DiveOut`), `MAX_TAVILY_CALLS`, `Budget`, `BudgetSpent`, `budgetedCall`, `ask`, `askJson`, `parseJson`, `stripThinking`, the name/url helpers, `liveDomains`, `Ledger`, `corpus`, the prompts, `discoveryQueries`, `run`, `dive` | 55–825 |
| `companydive/store.ts` | the table and its rows: `DiveRow`, `tableReady`, `ensureTable`, `newPublicId`, `updateRow` | 829–880, 896–905 |
| `companydive/runner.ts` | queue, tries, resume: `waiting`, `active`, `CONCURRENCY`, `finishedHooks`, `onFinished`, `RETRY_AFTER_MS`, `MAX_TRIES`, `nextTry`, `DIVE_LIMIT_MS`, `giveUid`, `notComplete`, `execute`, `runningSince`, `pump`, `LANE_HOLD_MS`, `diveRunning`, `setRunningForTests`, `queue`, `resumeInterrupted` (with its `setInterval`), `retryDue` | 907–1109 |
| `companydive/http.ts` | API and pages: `origin`, `links`, `Ctx`, `handle`, `publicView`, `handlePublic` | 882–894, 1113–1231 |
| `companydive.ts` | facade: re-exports the 38 names it exports today, nothing else | — |

Lines 1–54 (header comment, imports, config) go to whichever file uses them; a constant used by two files lives in
the lower one (pipeline < store < runner < http) and is imported. If the code does not fit this table (a hidden
dependency that would need a rewrite), the builder stops and reports instead of redesigning.

**Live proof (after T0, one deploy):**
- Before the deploy: one company dive on a real company the owner picks; save its row (stages, log, result keys,
  warnings, status) and its `/dp/` page.
- After the deploy: the same company again. Compare line by line: the same stage sequence, the same log message
  shapes (wording may differ only where the LLM's text is quoted), the same result fields, status complete, the
  dossier written, the preview writer started by `onFinished`, the `/dp/` page renders.
- Boot log after the deploy shows the resume sweep starting as before; the contact worker still sees `diveRunning()`.

---

## T2: seam for the dive-deeper (`divedeeper.ts`, 537 lines)

**Builder:** codex (gpt-6.1-terra; switch to gpt-6.1-sol high if the diff is weak). **Reviewer:** grok-4.7.

**Owned files:** `agy-lab/src/divedeeper.ts` (becomes the facade); new `agy-lab/src/divedeeper/run.ts`,
`preview-writer.ts`, `http.ts`, `stages.ts`, `store.ts`. Nothing else, and in particular not the existing
`divedeeper/runner.ts` (it runs one lane; T3 owns it).

**One change to the plan, for your OK:** the plan names four new files. The table code (`Row`, `ensureTable`,
`update`) is used by the runner, the preview writer and the API alike, so it gets a fifth file, `store.ts`, the same
cut as T1. Otherwise one of the three would import the table from another for no reason.

**What moves where** (line numbers from main at 3d2b24b):

| New file | Takes | Lines |
|---|---|---|
| `divedeeper/stages.ts` | `enabled`, the lane order lists `STAGE1_FIRST`, `STAGE1_AFTER_H`, `STAGE1_LAST`, `STAGE2`–`STAGE5` | 31–50 |
| `divedeeper/store.ts` | `Row`, `tableReady`, `ensureTable`, `newPublicId`, `update`, `diveRow` | 52–114 |
| `divedeeper/run.ts` | execute, queue, resume: `startDive`, `waiting`, `active`, the run constants, `sleep`, `clock`, `execute`, `queue`, `pump`, `resumeInterrupted` (with its `setInterval`), `resumeDue` | 116–274 |
| `divedeeper/preview-writer.ts` | `previewAuto`, `writers`, `previewSweep`, `previewWriter`, `startPreviewWorker` (with its `onFinished` hook and `setInterval`), `offer`, `editing`, `writePreviewNotes` | 276–357 |
| `divedeeper/http.ts` | `Ctx`, `links`, `handlePreview`, `handlePage`, `esc`, `handlePublic`, `handle` | 325–537 (minus what the preview writer takes) |
| `divedeeper.ts` | facade: re-exports its 14 exported names today, nothing else | — |

**Live proof (after T1 is proven, one deploy):**
- Before the deploy: one dive-deeper and one preview on a real company the owner picks; save the run row (stages,
  log, lane statuses), the lane files' names, and the `/dd/` page and preview.
- After the deploy: the same company again. Compare line by line: the same stage and lane order, the same log
  message shapes, every lane status, a report published, the `/dd/` page and the preview page render.
- Boot log: the resume sweep and the preview sweep start as before.

---

## T3: seam for the lanes' disk files (`OUT/*.json`)

**Builder:** agy (gemini-3.8-flash-high). **Reviewer:** grok-4.7.

**What the code does today.** Lanes pass data to each other through files in `OUT`. `lib.ts` already has
`readLane(diveId, lane)` (line 407), but 11 section files open the files themselves, and `runner.ts` writes them.
The plan said 13 sections; the code has 11 (B-brand and W-speed only matched the search by accident).

**Owned files:** `agy-lab/src/divedeeper/lib.ts`, `agy-lab/src/divedeeper/runner.ts`, and these sections:
`C-merged.ts`, `C-rules.ts`, `D-common.ts`, `G-free.ts`, `G-grounded.ts`, `G-shared.ts`, `H-plan.ts`, `S2-consult.ts`,
`S3-editor.ts`, `S4-analysis.ts`, `S5-plan.ts`. Nothing else.

**What changes:**
- `lib.ts` gains `writeLane(diveId, name, data)`: `mkdir OUT -p`, then write `OUT/<name>-<diveId>.json` with the same
  `JSON.stringify` spacing the caller used before (two callers write pretty JSON, `stageDive` writes compact: the
  helper takes the spacing as an argument, so every file's bytes stay the same).
- Every section's own `fs.readFileSync(path.join(OUT, ...))` becomes `readLane(...)`, and every write becomes
  `writeLane(...)`, with the same file names. The four S-stage copies of `readLane` are deleted in favour of the one
  in `lib.ts` (they are identical).
- **Kept exactly, at each call site:** what happens when a file is missing or broken. Today some readers warn
  (`C-merged`, `C-rules`: "Maps phones NOT checked"), some fall through to a fresh run (`G-*`, `D-common`, `H-plan`), and
  some return null. `readLane` returns null for both a missing and a broken file, which is what every `catch` does today;
  each caller keeps its own warning and fallback on null.
- `D_FRESH_CLAIMS` and every other env check stay where they are.
- After T3, no file under `divedeeper/` except `lib.ts` builds a path from `OUT`. A boundary check (in the style of
  `core/core-door.test.ts`) that reads the real code and fails if one does is the only new test.

**Live proof (after T2 is proven, one deploy):**
- One dive-deeper on a real company after the deploy, compared with the T2 proof run: the same lane file names in `OUT`,
  C-merged and C-rules get the Maps listings (no "no H-maps" warning when H-maps ran), the G lanes and `H-plan` reuse
  their saved output on a resume, a report is published.
- The missing-file path: T3 adds no new failure path, it only moves the existing one. That path (H-maps' file
  missing, so C-merged warns "Maps phones NOT checked") fires live only when H-maps did not save a file, and causing
  that on purpose would damage a real paid run. So it is checked in the diff review: every `null` branch keeps its old
  warning word for word. **Your call:** accept that, or name a way to make H-maps fail on purpose live.
