# Overhaul plan: step by step, in parallel where files allow

**Status: approved by the owner on 2026-11-02. Wave 0 done: T0–T3 proven live and ticked by the owner on 2026-11-03 (evidence: [contracts/wave0-seams.md](contracts/wave0-seams.md), "Live proof results"); T4 (provider limits) is parked for the future by the owner: not a bug, every lane works; do not raise it again. Wave 1 not started: it starts only when the owner says so.**
The owner's open points (section 9) are still open; none of them blocks wave 0. It follows the rules in must-fix-checklist.md,
"How we build" (beside the old code, behind a switch, one module per task, proven live with real data), and
builds the fixes for the design review (R1–R12).

## 1. The shape of the plan

**Build in parallel, prove in series.**

- Coding can run in parallel when two tasks never edit the same file. Each task gets its own git worktree
  and its own builder.
- Proof cannot run in parallel. There is one production service and no staging, so every task goes through
  one line: merge → deploy → live run with its switch on → owner ticks it. One task per deploy, so a failure
  always points at one change.
- So the plan is a set of **tracks** (each owns its files) moving through **waves** (a wave starts when what it
  needs is merged and proven).

**Why the plan starts with seams.** Three files are shared by almost every fix: `companydive.ts` (pipeline,
runner and HTTP in one 1,231-line file), `divedeeper.ts` (runner, preview writer and HTTP), and 13 section
files that read each other's output straight from disk (`OUT/*.json`). While they stay whole, every task
collides with every other one. Wave 0 cuts them along their existing lines, with **no change in behaviour**.
After that, most tasks own their files alone and can run side by side.

## 2. Who does what

| Role | Who | Does |
|---|---|---|
| Owner | you | approves each contract, each merge, each live proof; picks the real companies; decides the open points |
| Orchestrator | Claude (this app) | writes each task's contract and prompt, makes the worktree, starts the builder, reviews the diff, merges, deploys, runs the live proof, reports with evidence |
| Builders | `grok-4.7` (Grok CLI), `gpt-6.1-terra` (Codex CLI), `gemini-3.8-flash-high` (agy) | write the code for one task, inside its worktree, inside its owned files |
| Reviewer | always a **different vendor** from the builder | reads the diff against the contract before Claude does: anything outside the owned files, any behaviour change in a seam, any invented test data |

Who builds what:

- **grok-4.7** (strongest, 4 at once): concurrency and core: evidence store, check type, limiter, step table,
  racing calls, the company dive runner.
- **gpt-6.1-terra** (6 at once): bounded feature tasks: identity, preview editor, the dive-deeper runner, writing stages.
  Note: the Codex catalog lists terra at low effort only. If its diffs are weak, switch that task to `gpt-6.1-sol` at high.
- **gemini-3.8-flash-high** (2 at once): research and mechanical work: provider limits, switch wiring, the simpler lane rollouts.

Live proof, deploys and the lead import are never handed to a sub-agent: they act on production.

## 3. The tracks and the files each owns

| Track | Owns | Tasks |
|---|---|---|
| **S** Seams | the three shared files, cut apart | T1, T2, T3 |
| **P** Providers (core) | `core/*.ts`, `cost.ts`, new `core/limiter.ts` | T7 (core part), T11, T20 |
| **E** Evidence | new `evidence/` | T7 |
| **I** Identity | `company-uid.ts`, `company-page.ts`, `companydive/pipeline.ts`, `companydive/http.ts` | T8, T19 |
| **C** Checks | new `checks/`, `divedeeper/sections/*` one file per task | T9, T13–T18 |
| **R** Run control | new `steps/`, `companydive/runner.ts`, `divedeeper/run.ts`, `divedeeper/preview-writer.ts` | T12, T21, T22 |
| **W** Writing | `preview-editor.ts`, `privacy.ts`, `preview-html.ts`, `editor.ts`, `report-html.ts`, `S2`–`S5` | T10, T24–T27 |
| **O** Ops | `scripts/import-from-pg2nd.ts`, Railway | T0 |

A file belongs to one task at a time. When two tasks need the same file, they run one after the other, and the
order is in the table below.

## 4. The tasks

Proof is always live, on real companies, with the task's switch on for that run only; "switch off" must give
the old behaviour. Where a failure path is new, it is made to fail on purpose live.

### Wave 0: start now, all in parallel (no code is deployed while T0 runs)

| Task | What | Builder / reviewer | Live proof |
|---|---|---|---|
| ✅ **T0** Country-industry research copy | from ee-auto, ONLY its country-industry research (owner, 2026-11-03: its leads are unrelated; the lead import was wrong data); deadline 2026-11-06 | Claude + owner | every ee-auto country job shows on the hub with the same CSV |
| ✅ **T1** Seam: company dive | split `companydive.ts` into `companydive/pipeline.ts` (the research), `runner.ts` (queue, tries, resume), `http.ts` (API and pages), `store.ts` (table, row updates). The old file stays as a facade that re-exports, so `server.ts` and every importer are untouched. Pure move | grok / codex | one live dive: same stages, same log lines, same result fields as before the deploy |
| ✅ **T2** Seam: dive-deeper | split `divedeeper.ts` into `divedeeper/run.ts` (execute, queue, resume), `preview-writer.ts`, `http.ts`, `stages.ts` (the lane order lists). Facade stays. Pure move | codex / grok | one live dive-deeper and one preview: same as before |
| ✅ **T3** Seam: lane input and output | every section that reads or writes `OUT/*.json` itself goes through two helpers in `divedeeper/lib.ts`, `readLane(diveId, key)` and `writeLane(...)`, with the same paths. 13 section files, mechanical | gemini / grok | one live dive-deeper: same lane files, same report |
| **T4** Provider limits (read only) | the real rate limit of each provider, per key and per account (LLM lanes, MiniMax, Tavily, Exa, Brave, PageSpeed, Gmap and fetch workers), from their docs and the hub's own 429s. Writes `docs/provider-limits.md` | gemini / Claude | the owner confirms the accounts and plans |
| **T5** Contracts | the contract for each wave-1 task: interface, tables, owned files, switch name, live proof | Claude, owner approves | — |

T1, T2 and T3 touch different files, so they build at the same time; they deploy one at a time.

### Wave 1: after T1–T3 are proven

| Task | What (R-items) | Needs | Builder / reviewer | Live proof |
|---|---|---|---|---|
| **T6** Switches | `switches.ts`: a run's `options.switches` list (a column is added to `dive_deeper`), plus one env setting that turns every switch off. The two `http.ts` files accept `switches` on start | T1, T2 | gemini / codex | a run started with a switch shows it on its row; without it, nothing changes |
| **T7** Evidence store | `evidence/`: one table, a row per call, written when the call returns, with report UID, step, provider, request, raw result, status. Each core call site hands its raw result to it. The report UID travels with the work through Node's `AsyncLocalStorage`, set where a run starts (`companydive/runner.ts`, `divedeeper/run.ts`, `preview-writer.ts`). Only adds | T1, T2, T6 | grok / codex | one dive and one dive-deeper with the switch: stored rows equal the call log, raw results present; a run without the switch stores nothing |
| **T8** Identity anchors (R3) | a `company_identifier` table (uid, kind, value: domain, place id, registration number, phone); resolve by any of them. `company-page.ts` and `http.ts` pass the lead's anchors (`company_data`: place id, website, phone, address, category); triage confirms them instead of guessing. Only adds: existing duplicate UIDs are merged later, as a data step the owner approves | T1, T6 | codex / grok | Signmastr, TS Media and Eternalgy with the switch: right domain, one UID, the category carried |
| **T9** Check outcome, first lane (R2) | `checks/`: the check result (check id, outcome found / not found / couldn't check, evidence call ids) and the finding that points to it; `Finding` gains `check`. `D-registry.ts` adopts it, and its two shared caches (CIDB sweep, MyHijau) are keyed by report (D1) | T3, T6 | grok / codex | a non-contractor company: no "not in the CIDB register"; the CIDB site made unreachable on purpose: "couldn't check"; two companies in a row: no leak |
| **T10** Preview editor (R7) | the preview editor gets an allow-list input (identity, leadership, public facts with no contact details); no quota of warnings; gaps are not shown as "missing" | — (own files) | codex / gemini | five real dives' previews written again with the switch, old and new side by side: every warning traces to a source, no contact details |

T7 is merged before T9, because both touch `divedeeper/lib.ts` (T7: the call hook; T9: the `Finding` type).

### Wave 2

| Task | What (R-items) | Needs | Builder / reviewer | Live proof |
|---|---|---|---|---|
| **T11** Weighted limiter per provider (R4, R5) | `core/limiter.ts`: per provider, weight then time, capacity kept for weight 50 (slots or rate budget). Replaces `take()`/`give()` in `core/llm.ts` and the Tavily, Exa, Brave and MiniMax limits. The weight comes from the report context (T7). Contact research, email replies and the gateway get their own weights; the contact worker's `diveRunning()` pause goes | T4, T7 | grok / codex | start many previews on purpose, then one paid run: its calls' waits, read from the evidence rows, stay near zero |
| **T12** Step table, first user (R1) | `steps/`: report UID, step, depends on, weight, status, lease, tries, output; claimed with `order by weight desc, created_at for update skip locked`. The preview writer moves onto it first (the smallest scheduler) | T2, T6 | grok / codex | previews written through steps; a redeploy in the middle of one: it resumes once, never twice |
| **T13–T18** Check outcome, lane by lane (R2) | one task per lane file: H-maps (C2, B8), C-merged (C3–C6, C12), A-assets (B9, B10, C4, C5), R-contacts (C13), K-credibility (C14), H-web + B-brand + G-grounded (C15). Up to 4 at once | T9 | mixed; never the same vendor as the reviewer | per lane: chosen real companies plus one forced failure (a blocked site, a DNS timeout) |
| **T19** Company dive gate (R2) | the pipeline marks each warning as ours (retry the step) or the world's answer (an outcome, e.g. site unreadable). A site that blocks bots gets a preview that says so (E3) | T8 (same file) | grok / codex | a company whose site blocks bots: the dive finishes and says so |

### Wave 3

| Task | What (R-items) | Needs | Builder / reviewer | Live proof |
|---|---|---|---|---|
| **T20** LLM racing calls (wait policy, R6) | in `core/llm.ts`: past the time gate a second call fires on another lane and takes reserved capacity (T11); the first answer wins; the idle kill goes. The dive's gate: a real dead end only | T11 | grok / codex | a lane slowed on purpose: the paid call answers from the second lane, the first is cancelled after; the preview still finishes |
| **T21** Company dive on the step table (R1, R6, R9, R11) | each stage a step with its stored output; a retry runs only the failed step; the 40-min try limit goes; the dossier becomes a step of the paid report | T12, T19 | grok / codex | a redeploy mid-dive: it resumes at the step it was on; no Tavily call is paid twice (evidence rows) |
| **T22** Dive-deeper on the step table (R1, R5, R6, R9) | each lane a step; `readLane` and `writeLane` (T3) read and write the step outputs, so lanes stop sharing disk files; S-stages that do not need each other run together; the 15-min lane limit goes; the wait for the company dive is a dependency, not a held slot; a client's payment lifts its dive to weight 50 | T12, T13–T18 | codex / grok | two paid runs at once on the same company dive: separate data, both finish; total time against the delivery target |

### Wave 4

| Task | What (R-items) | Needs | Builder / reviewer |
|---|---|---|---|
| **T23** Catalog and pick step (R8) | the search prompt database (the owner's collection) and the plain lookup by country and industry; fixed measurement modules vs prompt modules | owner: where the collection is; T9 | grok / codex |
| **T24–T27** Writing reads findings by part (R8) | one task per file: `editor.ts`, `S2-consult.ts` (no solar copy, F8), `S3`/`S4`/`S5`, `report-html.ts`. Parallel | T13–T18 | mixed |
| **T28** The preview promises the plan (R10) | the pick step runs at preview time; the preview lists exactly the checks the paid report will run; reviews are not promised while there is no source | T23, T10 | codex / gemini |
| **T29** Verify-only recheck round | reads each claim in the paid report against its stored evidence; can drop or downgrade, never add | T7, T24–T27 | grok / codex |
| **T30** Delete the old paths | one module at a time, only on the owner's word | each module proven | Claude |

## 5. What runs at the same time

```
Wave 0   T0 import ─────────────────────────────┐ (no deploys while it runs)
         T1 seam dive │ T2 seam deeper │ T3 seam lanes │ T4 limits │ T5 contracts
Wave 1   T6 switches → T7 evidence ─┬→ T9 checks (first lane)
                     T8 identity    │  T10 preview editor
Wave 2   T11 limiter │ T12 step table │ T13–T18 lanes (4 at once) │ T19 dive gate
Wave 3   T20 racing calls │ T21 dive on steps │ T22 deeper on steps
Wave 4   T23 catalog │ T24–T27 writing (parallel) │ T28 preview promise │ T29 recheck │ T30 delete old
```

Builders at once: wave 0 three (plus Claude on T0 and T5), wave 1 up to four, wave 2 up to seven (the CLI limits
allow grok 4, codex 6, agy 2). Proof stays one task per deploy throughout.

## 6. One task, start to finish

1. **Contract** (Claude writes, owner approves): what it owns, interface, switch name, owned files, live proof.
2. **Worktree** for the task, from the current main.
3. **Build** (the sub-agent), with the prompt rules below.
4. **Cross-review** by the other vendor: diff against the contract.
5. **Claude checks:** the diff stays inside the owned files; type check; the existing tests and the boundary checks
   still pass (a guard only, never the proof); a seam changes no behaviour.
6. **Owner OK → merge → deploy → live proof** with the switch on, on the owner's companies. Failure paths fail on purpose.
7. **Tick** in the checklist, with the evidence link. Then that task's file lock is released.

## 7. Rules in every builder's prompt

- Work only in this worktree, only in these files. Touch nothing else.
- Change no behaviour outside the switch. A seam task changes no behaviour at all.
- Never write a test with invented data and never report a test as proof. Report what you changed and what you
  could not do.
- Never deploy, never connect to the production database or Railway, never read `D:\Tools\my-vault`, never put a key in a prompt.
- Stop and report when the contract does not fit the code. Do not redesign.

Claude never trusts an exit code: sub-agents exit 0 when they refused or gave up. The diff is read every time.

## 8. Before wave 0

- Claude Code's auto mode blocked a direct `codex exec` with the bypass flag on 2026-11-02. Allow the three CLIs in
  the Bash permissions (`Bash(codex exec:*)`, `Bash(grok -p:*)`, `Bash(agy:*)`) before the first task.
- `agy --version` first: it updates itself.
- Commit the current docs and checklist, so every worktree starts from them.

## 9. Open for the owner

- The paid run starts by hand (R12): where the "cannot wait" clock starts, and the delivery target (T22 measures against it).
- Where the search prompt collection lives (T23).
- Reviews: build a reviews job on the workers, or drop the feature (T28 and the report).
- Merging Eternalgy's three UIDs and other duplicates after T8 (a data change on production).
