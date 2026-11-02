# Must-fix checklist

Status: open unless ticked. Evidence is what was seen on the live hub on 2026-11-02.

## Final plan (owner, 2026-11-02): read this first

**Order of work: design first, then fixes.**

1. [x] **Next session: a design review from first principles.** Review this plan, the bugs, the problems and the current design from a bigger perspective. Question: is the current pipeline, logic and architecture a good, optimized design, or are there still design mistakes? Not the UI. **Fix the design before fixing problems.**
   - **Done 2026-11-02, checked twice: see "Design review" below.** The owner mostly agreed. The four agreed designs point the right way, but are not yet solid as a set. 12 design problems found.
2. **Then build the agreed designs, the way set in "How we build" below** (one module at a time, beside the old code, proven live):
   - LLM plan: a time gate, weighted task categories, nothing killed but more calls may fire ([docs/llm-wait-policy.md](docs/llm-wait-policy.md)).
   - Weighted job queue: preview 1, dive-deeper 50 ([docs/job-queue-weights.md](docs/job-queue-weights.md)).
   - Research storage: company → report → research call ([docs/research-storage-design.md](docs/research-storage-design.md)).
   - Modular dive-deeper: 6 modules, pipeline built per company from the prompt database by country and industry ([docs/divedeeper-modular-design.md](docs/divedeeper-modular-design.md)).
3. **Then the fix stage.**

**Decisions recorded on 2026-11-02:**

| Topic | Decision |
|---|---|
| Report quality (client-facing) | **Add one LLM round that rechecks and improves the report** (write once, check and improve once). Give it the stored research calls as evidence. Keep a fixed privacy scrub rule as the main guard (G3); the recheck is a second net. Old reports: save the final page at delivery so it never changes (D3), and decide about live reports built on bad data (J1). Still open: preview, paid report, or both. |
| Local workers (I1–I10, worker-side code) | **Off the table. Get the cloud hub working perfectly first.** Hub-side checks on what workers return (don't trust "success" with empty pages, treat blocked as couldn't check) count as cloud work. |
| Run status bugs | **Obvious bugs: fix at the fix stage, no discussion needed.** Fix directly: E1/E2, E6, E7, E9, E10, J2. Leave for the redesigns: E4 and E8 (research storage, one owner per report) and E11 (LLM plan). |
| Pipeline concurrency | Set by each API provider's real rate limit, the hard limit. Find those limits first. |
| Full company dive page (G1) | Stays open until just before launch, then disabled for everyone. |
| Lead import (A1–A3) | Plan approved below. Deadline 2026-11-06 (source token expires). |
| Questions the owner did not answer | **Not important now.** (The old app ee-auto turn-off, Google reviews, country "ready" status, company dive quality items, operations.) Exception: `railway.json` stops working on 2026-12-01 (J11). |

## Design review from first principles (2026-11-02; checked twice; owner mostly agreed)

**The business, as the design must serve it.** The hub finds small businesses on Google Maps, contacts them,
sends a free preview of an online presence audit (company dive, `/dp/`), and sells the full audit
(dive-deeper, `/dd/`), whose action plan leads into paid work (website, social media, IT).
**What is sold is credibility.** The reader knows their own company better than anyone, so one false claim
loses the sale and the brand. Priorities: paid report = correct, then fast. Free preview = correct, then cheap.

**Verdict.** Each agreed design is right in direction. As a set they are not solid yet: they are four views of
one missing component (1), and three foundations are untouched: what a check result is (2), who the company
is (3), and what the preview promises (10).

**Kept as designed:** research isolated per report and saved at once, one owner per report; race a second call
instead of killing; paid work first; prompts as data, picked by a plain lookup, never falling back to Malaysia;
the delivered page saved for good (D3); the hub does not trust a worker's "success".

### The problems, most important first

- [ ] **R1. The four designs describe one missing component four times: a durable step scheduler.**
  - Weights in every queue, one owner per report, a retry that reuses stored work, modules in parallel, resume
    after a restart: all are properties of one scheduler. Today there are at least seven, each with its own
    queue and retry rules: the company dive's 3-slot memory queue (`companydive.ts:909-1054`), dive-deeper's one
    slot (`divedeeper.ts:134-252`), the preview writers (`:282-315`), two retry sweeps, two boot resumes,
    `jobs.ts`, and the contact worker's pause (`contact-worker.ts:1031`).
  - **Design:** one Postgres table of steps: report UID, step name, depends on, weight, status, lease (owner and
    expiry), tries, output. A worker claims with `order by weight desc, created_at ... for update skip locked`.
    A step whose inputs are not ready is not claimed, so nothing holds a slot while it waits (E5).
  - Closes, or makes trivial: E1, E4, E5, E6, E8, J2, the lane files on disk, and the per-queue weight work.
    E10 needs one rule on top: one active paid report per company dive.

- [ ] **R2. "Complete" means the wrong thing. Our failure and the world's answer are mixed.**
  - A warning today is either our failure (an LLM lane down, a key out of credit) or the world's answer (the
    site blocks bots, a register is unreachable, DNS times out). Both stop the report: any warning makes the
    whole company dive run again from nothing (`companydive.ts:1000`), and any failed lane holds back the paid
    report (`divedeeper.ts:220`).
  - Mixing them gives both kinds of error: E3 (a site that blocks bots never gets a report) and C1–C6
    ("couldn't check" printed as "not found").
  - The agreed designs put "couldn't check" on the raw API call (storage) and on a prompt entry (modular), but not
    on the run gate and not on the finding: `Finding` holds only title, detail and severity (`divedeeper/lib.ts:107`).
  - **Design:** a typed check result: check id, outcome (found / not found / couldn't check), and the ids of the
    stored calls behind it. Every finding points to a check. "Not found" is allowed only when the lookup itself
    succeeded. Our failure retries that one step. The world's answer is an outcome, and the report goes on and
    says so. The gate becomes: **every planned check has an outcome**, not "every check succeeded".
  - Business bonus: "your site blocks automated visitors, so AI search cannot read you" is a finding worth selling.

- [ ] **R3. The company's identity is guessed by the LLM, then used as the key.**
  - A lead comes from a Maps listing and already holds place id, name, address, phone, website and category
    (`company_data`, `reportdb.ts:1370`). The dive is started with the name only (`company-page.ts:223`; the
    POST uses `website` for the UID and never passes it to the research, B4). Triage then works the identity out
    from snippets and never checks it (B5). The UID is made from triage's first domain (`giveUid`,
    `companydive.ts:934`), and the `company` table is keyed on one `domain unique` (`company-uid.ts:55-58`).
  - That chain causes B1–B3, B6, B8–B10, C2 and the bad reports in J1.
  - **Design:** (a) the dive takes every anchor already known about the company, and triage confirms them
    instead of discovering them; (b) a company is one entity with many identifiers (registration number
    strongest, then place id, domains, phone), not one domain; (c) the industry for the modular pick comes from
    the Maps category plus the dive. Without this, the modular design's "the industry must be right" (note 4) has
    no reliable input, and the storage design's company level splits (B1).

- [ ] **R4. Weights alone do not give "paid never waits".**
  - Priority without pre-emption only reorders work that is waiting. Two places it cannot help:
    - Hive lanes: 3 slots each (`core/llm.ts:54`). A company dive call can hold a slot for minutes (95% within
      118 s, longest 348 s). When previews fill every slot, a paid call waits for one to free.
    - The "use first" lane (Vectide) takes every call with no slot limit (`core/llm.ts`, rule 2). There is no
      line to cut: the real queue is the provider's own rate limit, and a paid call gets the same 429 as every
      preview (about 100 429s logged).
  - **Design:** keep capacity in reserve, not just order: previews may use at most N−k slots, or part of each
    provider's rate budget; the rest is only for weight 50 and its racing calls.
  - Every other user of the LLM router needs a weight: contact research, email replies, the gateway
    (`core/llm.ts:1-4`). The contact worker's `diveRunning()` pause is a second, conflicting priority system;
    it goes.
  - The weight must be able to change: when a client pays, a company dive their report needs that is still
    retrying moves up to 50.

- [ ] **R5. A paid report's wait is mostly structure, not LLM speed.**
  - Racing a second LLM call saves seconds to minutes. The measured waits come from structure: run #8 took
    48 min, mostly waiting behind #7 in the one slot; the wait for the company dive has no limit; a failed lane
    sleeps 1 and then 3 min (`divedeeper.ts:139`), then the run resumes after 30 min (`:141`); S2 → S3 → S4 → S5
    run strictly one after another.
  - **Design:** set a delivery target ("paid report ready within X min of the start") and work backwards from it.
  - The decision "concurrency set from the tightest provider" is at the wrong level. Put each provider's real
    limit on that provider (a weighted limiter per provider). Then the pipeline can run as many reports as it
    likes and run slots matter only for memory. One global number from the tightest provider leaves every other
    provider idle.

- [ ] **R6. Time limits that stop nothing.**
  - Two of the three limits race a timer against the work and never cancel the loser: the lane limit
    (`runner.ts:65-70`) and the try limit (`companydive.ts:994-998`). The losing work keeps running and spending (E4).
  - Correction from the second check: the LLM idle limit does cancel (`core/idle.ts`, AbortController and
    `reader.cancel`). It is still the kill-and-restart the wait policy forbids.
  - **Design:** once calls race at the bottom (wait policy) and steps have leases (R1), delete the lane and try
    limits. Any limit that stays must pass an `AbortSignal` down to the calls.

- [ ] **R7. The preview is built to produce warnings.**
  - The preview editor asks for "5 or 6" warnings using "at least three different types"
    (`divedeeper/preview-editor.ts`). When the research found two, the model must make up three or four.
  - The dive's gaps (what 15 searches did not find) become "missing: no public source shows" warnings
    (`preview-html.ts` `fallbackWarnings`). That is the "couldn't check" mistake in the first contact.
  - **Design:** preview warnings come only from typed checks (R2), and the number shown is what was found.
  - **The recheck round (decision above) should only verify:** it may drop or downgrade a claim that its cited
    evidence does not support, never add or rewrite one. "Check and improve" in one pass lets an unsupported
    claim back in. Style edits, if wanted, come before the check.
  - **Privacy:** the scrub is a blocklist and blocklists leak (G3). The preview editor is given the whole identity
    and every fact. Build the preview's input from an allow-list (company identity, leadership, public facts
    without contact details), so the LLM never sees what it must not print. The scrub stays as the second net.

- [ ] **R8. The modular design: modules are not the report's parts, and some lanes are not prompts.**
  - The report has six parts by topic; the modules are six sources. The writing stages read lanes by file name
    (S5 reads `STAGE1_LANES` from `out/`).
  - Several lanes are measurements, not search prompts: G-* (asks AI engines about the company, the whole of
    part 2), W-speed (PageSpeed), C-merged (crawls the company's own site), A-assets (DNS, TLS, whois). They do
    not fit "pick prompts by country and industry".
  - **Design:** two kinds of module: fixed measurements that always run (own website, domains and email, speed,
    AI answers) and prompt-driven searches (broad, people, government, industry, Maps). The typed finding
    (check id, report part, outcome, evidence) is the contract: the writing stages read findings by report part,
    never lane files.
  - Module 5 (reviews) has no data source. Until one exists, the report and the preview stop promising it
    (C10 already claims "every review was read").

- [ ] **R9. The storage design names two different things as one.**
  - The raw call log is evidence. A step checkpoint is what resumes a run. "A retry reuses the calls already
    stored" works only when the retry sends the same requests, and LLM prompts built from earlier outputs will not.
  - **Design:** resume from stored step outputs (report UID + step, R1). Keep the raw calls as evidence for
    citations, the recheck and "couldn't check".
  - A dive-deeper report names its parent report (the company dive) explicitly. Otherwise "read only by report
    UID" stops it reading the dive it is built on.

- [ ] **R10. (Found in the second check.) What the preview promises is fixed; what the paid report delivers will vary.**
  - The preview's "what the full report gives you" list is the same for everyone and Malaysian
    (`preview-html.ts:100-112`): Bank Negara and Securities Commission lists, unanswered reviews, complaints in
    English and Malay, Maps rank in every town. With the modular design, the paid report runs only the checks
    that fit the company, and reviews have no source. A client can buy what will not be delivered.
  - **Design:** the pick step (a cheap lookup) runs at preview time. The preview promises exactly the checks
    that company's paid report will run, and the paid run uses that same plan.

- [ ] **R11. (Found in the second check.) Every free preview pays for the dossier only the paid report uses, and a
  dossier failure re-runs the whole research.**
  - The dossier is written for every company dive, though only the paid report's appendix shows it
    (`companydive.ts:777-778`), and `/d/` closes at launch. A dossier that falls back makes the dive incomplete
    (`:1018-1021`), so the whole research runs again, after the preview was already written from it.
  - **Design:** the dossier is a step of the paid report, written when a report is ordered, from the stored research.

- [ ] **R12. (Found in the second check.) The paid run starts by hand, so its clock starts with a person.**
  - There is no order or payment step in the hub. The preview says "reply to the message ... and we will start
    your full audit" (`preview-html.ts:632`, `:656`), and the run is started from the console (`POST /api/dive-deeper`,
    token only). A client who says yes at 11 pm waits until someone presses start.
  - **To decide:** where the "paid cannot wait" clock starts. If from the client's yes, the order needs its own
    path that starts the run (or at least alerts at once). The pipeline speed work (R4, R5, wait policy) only
    counts from the press of the button.

The build order is in "How we build", below.

## How we build (owner, 2026-11-02; agreed)

**Why:** in two years of AI coding, 10 out of 10 big overhauls burned down a working project. This project works
now and must keep working. Local tests with fake data or simulations give fake status; in a long session that
misinformation gets buried and becomes the killswitch for the whole project.

### The rules

1. **Beside the old code, never a rewrite.** The working pipeline keeps serving. Each new module is built next to
   the old code, behind a switch that is off. Switch off = the old behaviour, so every step can be undone. The old
   code is deleted only after the new module replaced it on live runs, and only when the owner says so.
2. **One module per session.** Before any code, a short contract is agreed: what the module owns, its inputs and
   outputs, the only files it may touch, and how it will be proven. The change stays inside those files: no
   "while I'm here". Each session ends with a commit, a deploy and live evidence, then stops for the owner's OK.
3. **Proof is live, with real data.** There is no staging (one Railway service, one replica), so the test ground is
   production with a switch turned on **for one run at a time**. The owner picks real companies; old and new
   output for the same company are compared side by side. Every other run stays on the old code. Failure paths are
   made to fail on purpose live too (a register that cannot be reached, a dead LLM lane).
4. **A local test is never the proof.** Two narrow uses only: structure checks that read the real code (like
   `core/core-door.test.ts`: this module must not import that one), and, once the evidence store exists, guards that
   replay real responses recorded from live runs, never invented data. No status is ever reported from a local test.
5. **Modular monolith, separation of concerns.** One app, with modules that own their data and talk through a
   stated interface. Each module has a boundary check.

### The module map (target)

| Module | Owns |
|---|---|
| core | the outside providers: LLM, Tavily, Exa, Brave, page reads, Maps jobs (exists) |
| evidence | every research call's result, stored by report UID |
| steps | the step table: weights, leases, tries, step outputs |
| identity | the company and all its identifiers |
| checks | what a check result and a finding are (outcome, evidence) |
| research | the company dive, and the dive-deeper modules |
| writing | the preview and the report; reads findings only |

### The order

**Detailed plan (approved by the owner 2026-11-02; not started until the owner says start): [docs/overhaul-plan.md](docs/overhaul-plan.md).** It breaks the steps below into
tasks T0–T30 in waves, with the files each task owns, what can be built at the same time, the builder for each
(Grok, Codex, agy sub-agents, Claude orchestrating), and each live proof. It adds a wave 0 of seams (splitting the
three shared files with no behaviour change) so most tasks can run side by side.

Each step is useful on its own and leaves the app working. Tick only with live evidence.

- [ ] **0. Lead import (A1–A3).** Outside the overhaul, and first: its source token expires on 2026-11-06.
- [ ] **1. Evidence store.** Only adds: every existing call also saves its result. No behaviour changes.
  Proof: a live dive's stored rows match its call log. It goes first because every later step compares against
  this real data.
- [ ] **2. Identity anchors (R3).** The dive starts from what the lead already knows; triage confirms it.
  Proven on the companies that went wrong: Signmastr, TS Media, Eternalgy.
- [ ] **3. Check outcome (R2).** The type, applied to one lane first (the CIDB check: C1, D1), then lane by lane.
- [ ] **4. Weighted limiter per provider, with reserved capacity (R4, R5).** In core, one provider at a time, the LLM first.
- [ ] **5. Step table (R1, R6, R9, R11).** The preview writer moves first (the smallest), then the company dive,
  then the dive-deeper.
- [ ] **6. LLM racing calls** ([docs/llm-wait-policy.md](docs/llm-wait-policy.md)).
- [ ] **7. Modular dive-deeper and the preview's promise (R8, R10, R7).** One lane at a time.
- R12 (the paid run starts by hand) is the owner's decision; it does not block any step.

## Root cause: the research pipeline was built around one test company (owner, 2026-11-02)

- [ ] **Serious design problem, not a set of bugs.** The whole research pipeline was shaped to serve the first test sample, Eternalgy Sdn Bhd, a Malaysian solar installer. Checks that fit that one company run for every company. Many items below are symptoms of this, not separate problems. Some examples:
  - The CIDB contractor sweep runs for every company, "whatever it claims" (`divedeeper/sections/D-registry.ts:113`, `:397`). Every non-contractor gets a "not in the CIDB register" finding (`:210`).
  - The solar and energy registers (SEDA, MPSEA) are part of the register checks.
  - S2's copy is hard-coded for a solar installer (F8).
  - Dive-deeper is Malaysia-only and has no country check (H1, H2).
- **The owner will give the fix later. Do not patch these one by one before then.**
- [ ] **The fix (owner, 2026-11-02; recorded, not built): a modular dive-deeper.** Six modules: broad search; people and social; government agencies (per country); industry-specific; Google Maps reviews; domain and digital assets. One simple step looks up the search prompt database by the company's country and industry and builds that company's pipeline. Design, reasons and review notes: [docs/divedeeper-modular-design.md](docs/divedeeper-modular-design.md).
  - Open: where the existing search prompt collection lives (not in this repo; only the company dive's country packs are).

## Design agreed: research storage, company → report → research call (2026-11-02; build later)

- [ ] **Every API call result is saved the moment it returns, with its report UID; research data is read only by report UID.** Company (UID) → report (own UID, holds company UID) → research call (holds report UID: query, provider, raw result, status). The company's report list is a lookup, not an array. No shared memory caches or disk files, one owner per report, and a retry reuses stored calls. Design and reasons: [docs/research-storage-design.md](docs/research-storage-design.md).
- **Why:** today research can leak between companies (D1, the CIDB and MyHijau caches). Lanes share disk files named by the company dive's id. Raw results are never stored, and the company dive saves nothing until it ends, so a crash loses paid research. This must come before the company dive quality fixes (B4, B6, F1).
- Needs with it: the report UID as the anchor from the first call, and one UID per company (B1).

## To discuss first

- [ ] **LLM super slow / "keep-alive" diagnosis.** Owner says my reading is wrong (missed the big picture). My change in commit `7a99e30` (only answer data counts as LLM stream progress) rests on that reading, so treat it as unconfirmed until we talk.
  - **Big picture now set by the owner (CRITICAL): [docs/llm-wait-policy.md](docs/llm-wait-policy.md).** Company dive = slow is fine but it must finish (catch only real dead ends). Dive-deeper = cannot wait: race a second call for the same task, keep the first running, use whichever answers first. Never kill-and-restart. `7a99e30`'s idle-kill is that pattern and must be redone to follow the policy.

## Plan for the LLM problem (owner, 2026-11-02; recorded only, not built)

1. [ ] **A reasonable time gate.** It is set from real call times (Discovery below), not guessed. Suggested: dive-deeper about 45–60 s (95% of its answers arrive within 54 s); company dive about 6–8 min (the longest real answer took 348 s). Confirm the numbers when building.
2. [ ] **Weighted task categories,** so a dive-deeper is processed first once payment is received. Free preview = 1, every dive-deeper task = 50, weight before arrival time in every queue ([docs/job-queue-weights.md](docs/job-queue-weights.md)).
3. [ ] **Nothing is killed. Firing more new calls is allowed.** When a call passes the time gate, a new call for the same task fires on another lane and the old one keeps running. The first answer is used ([docs/llm-wait-policy.md](docs/llm-wait-policy.md)).

## WRONG DATA: the lead import was a mistake (owner, 2026-11-03)

**From ee-auto, only the country-industry research belongs to company-diver.** ee-auto's companies and leads are
never related to this project. Everything below about the lead import (A1–A3, `pg2nd_archive`, the id counters,
the `IMPORT_IN_PROGRESS` switch) worked on the wrong data and is kept only as a record.

- [ ] **Copy the country-industry research** (the real T0).
  - **Done 2026-11-03 ~16:50 UTC, live:** ee-auto holds 4 `country.industry` jobs (its job ring holds 4 in all, so
    none was dropped). Three imported through the hub's `POST /api/jobs/import-country`: West Malaysia / advertising
    agency (857 rows), Brunei Darussalam / advertising agency (135), San Marino / advertising agency (117); CSV and
    summary read back from the hub identical to ee-auto's. Malaysia / web design (7,238 rows, 7.8 MB, over the hub's
    1 MB request cap) written as its job file to `/data/.agy-lab/country-jobs/8877c82a158d.json`, byte-identical
    (SHA-256 checked); **the hub loads it at its next restart**: tick after it shows on /country-industry.
- [ ] **Lead data the wrong import left in the hub: owner decides** (nothing deleted without the owner's word): the
  `public` lead tables filled by the first import (2026-11-02 04:03–05:35 UTC), the `pg2nd_archive` schema, and the
  variables `IMPORT_IN_PROGRESS=0`, `AUTO_SCAN_PAUSED=1`, `AUTO_CONTACT_PAUSED=1`, `SITE_EMAIL_AUTO=0`.


## Plan for the lead import, A1–A3 (rewritten by the owner's rule, 2026-11-03)

**Rule (owner, 2026-11-03): keep the old data, never the old schema.** pg_2nd's ids and row shapes are the old
design. They are not preserved, not mapped, not protected. Rows in the hub follow the redesign: a company is its
UID and its anchors (R3: place id, domain, phone, registration), a report is its report UID, a research result is an
evidence row (research storage). **Deadline: the source's read-only token expires 2026-11-06.**

1. [ ] **Archive the source, untouched, before the deadline.** Every lead table copied as-is into the schema
   `pg2nd_archive` of the hub's database (`import-from-pg2nd.ts --group leads --target-schema pg2nd_archive`). The
   app's `public` tables are not touched, so no old id can clash with a hub row. Run detached (`nohup`), no pushes while
   it runs. Proof: per-table counts equal the source at the moment it ran. A top-up run after ee-auto stops (or just
   before 2026-11-06) catches what ee-auto wrote since.
   - **Run live 2026-11-02 16:14 → 16:21 UTC:** 27 tables, 0 rows skipped, no errors; `public` untouched (proven first
     on `telemarketer`: public's 34 tables, 92 indexes, 258 constraints, 16 sequences unchanged). Completeness,
     `agy-lab/scripts/archive-diff.ts` (every source primary key looked up in the archive): archive + missing = source,
     table by table, and every missing row is newer than the copy (ee-auto still writes). **Top-up proven** (same
     command again): it inserted exactly those rows (`company_data` 866, `search_report_company` 1,636, `search_report`
     1, `published_report` 1, `run_event` 7, `lead_activity_log` 234); the check after it again shows only the newest
     writes (`company_data` 579 from id 582,015; new search 652). **Not ticked:** complete only after a final top-up
     once ee-auto has stopped, or on 2026-11-05 at the latest.
2. [ ] **Stop ee-auto writing the source** (the owner). Until then the archive is a snapshot of a moving source.
3. [ ] **Move the archive into the redesign** (its own task and contract, after T8 identity anchors and T7 evidence
   exist): leads by place id into companies with anchors, reports by public id / report UID, research results as
   evidence. Old integer ids are dropped. Rows the hub already copied into `public` from the first import are part of
   this move, not a separate fix.
4. [ ] **Drop the archive** only after the move is proven live and the owner says so.

**What happened before the rule (2026-11-02, kept as a record):**

- (old step 1) **Find out why the import stopped** (last log write 05:35 UTC, `/data/import-leads2.log`). Likely a redeploy or the `railway ssh` session closing, since it runs inside the service container. Unconfirmed. **No deploys while it runs**, and run it detached (`nohup … &`) so a closed session cannot kill it.
   - **Seen live 2026-11-02 14:39 UTC (Claude, read only):** the log ends mid-line at 05:35:02 inside `published_report` (46,826 of 56,502), with no error and no exit line, so the process was killed from outside. No import process runs now. The container was replaced since (current one started 09:06:47 UTC, 36 s after commit `7a99e30`: this service redeploys within a minute of a push). Commit `6bdc318` landed at 05:25 UTC, ten minutes before the stop, so a redeploy is the likeliest cause; a closed `railway ssh` session is not ruled out (deploy history needs `railway deployment list`). Either way the fix is the same: detached, and no pushes while it runs.
   - **Counts, hub vs source, same moment:** `company_data` 172,120 vs 188,526; `published_report` 46,905 vs 56,613; `search_report_company` 91,014 vs 563,313; `run_event` 974 vs 244,928; `company_email` 5,862 vs 23,951; `lead_activity_log` 541 vs 23,244; `contact_research_run` 0 vs 55,411; `company` 100,401 vs 100,388 (the hub has 13 of its own). The source grew since the import's start (`company_data` 171,300 → 188,526; `published_report` 56,502 → 56,613): ee-auto still writes it (A3 confirmed). Four `published_report` rows were skipped on a foreign key (ids 120, 2095, 4610, 4611).
- (old step 2) **Stop everything that writes the lead tables**, on the new hub *and* on the old app (ee-auto). ee-auto still writes the source, so the copy chases a moving target (A3).
   - Switches that exist: `AUTO_SCAN_PAUSED=1`, `AUTO_CONTACT_PAUSED=1`, `SITE_EMAIL_AUTO` off. The contact worker is already off in production (`contact-worker.ts:1050`).
   - **No switch:** search-list, list-step2, email-marketing sync, the contact-resume timer (every 5 s), the abandoned-run reaper, and the boot blacklist and company-UID backfill (`server.ts:536-566`). Add one shared "import in progress" switch that holds them all, or accept that these write during the copy.
   - **Done on the hub, 2026-11-02 (owner chose the switch):** `IMPORT_IN_PROGRESS=1` holds every background loop, including dive resumes, the preview writer and country research (codex's review found they write `company` and `run_event`); the hub only serves HTTP. Set with `AUTO_SCAN_PAUSED=1`, `AUTO_CONTACT_PAUSED=1`, `SITE_EMAIL_AUTO=0` (`--skip-deploys`), then one push (`eee37a8`, 15:20:51 UTC). **Live:** the boot log prints "every background loop held … HTTP only"; no lead table changed in 90 s (15:22:52 → 15:24:22 UTC); every id counter still past the source after the boot migration. **Still open: ee-auto (the owner's) still writes the source** (`company_data` source max 568,082 → 571,279 in about an hour).
   - Changing Railway variables redeploys the service, so set them **before** starting the import, never during.
- (old step 3) **Measure the damage already done (A2) before copying more.**
   - **Measured live 2026-11-02 ~15:35 UTC (read only, `agy-lab/scripts/id-collisions.ts`):** a hub row sitting on an id the source uses for a different row, judged by `public_id` / `place_id` / `created_at` / `at`. `published_report` 1 (id 120; plus 2095, 4610, 4611 skipped on a foreign key); `search_report` 71; `company_data` 1,298; `run_event` 858 (the hub's own trail rows). None in `lead_activity_log`, `telemarketer`, `territory_discovered`, `atap_solar_registrations`, `email_marketing_event`, `taman_*`. Every other hub row at a source id is the same row (e.g. `published_report` 46,822 of 46,905). Not yet measured: source rows dropped because their `place_id` is already here under another id (the re-copy's skip lines will show them). The hub wrote `published_report` rows with ids 1–112 while the import ran. A source row with one of those ids was dropped without a message, and source child rows (`run_event`, `contact_research_run`, `company_research_run`) point at that id, now a different report. Compare ids 1–112 with the source (company and created_at). List every collision and decide per row: move the hub row to a new id, then copy the source row.
- (old step 4) **Re-copy the gaps, not only the tail (A3).** `--resume` starts after the highest id here, so rows skipped below it (foreign-key or `place_id` clashes) are never retried. Run per table **without** `--resume` (rows already here are skipped by `on conflict do nothing`), parents first: `company_data`, `company`, `company_place` before `published_report`, then its children. Read every "row skipped" line.
- (old step 5) **Then move every id counter past the source's highest id** (A1), not just past today's 46,911, plus margin.
   - **Moved first instead, owner approved 2026-11-02:** moving the counters past the *source's* highest id (not ours) cannot hand the import's ids to hub rows, and it also covers writers no switch can stop (workers reporting jobs, the Smartlead webhook, operator clicks). `agy-lab/scripts/bump-sequences.ts --apply`, run live 15:2x UTC: all 11 lead-table counters set to max(source, hub) + 1,000,000 and read back (e.g. `published_report` 266 → 1,056,700; `run_event` 985 → 1,245,084; `company_data` 533,370 → 1,568,082). The hub's `published_report` counter had been at 266, inside the source's range: that is how hub rows took source ids. The import's own `resetSequences` at the end stays safe (`max(id) + 1`). Still to do after the copy: check all counters again. The script does this itself only for a table that copied cleanly (`resetSequences`, `import-from-pg2nd.ts:354`). Check all 16 counters afterwards.
- (old step 6) **Prove it.** Source/target counts per table match (the script prints them and exits 1 on any mismatch). No `published_report_pkey` error in the log. One auto-scan tick saves a new report.
- (old step 7) **Restart the loops.** Then decide when ee-auto is turned off for good (handoff fix 6), so the two apps stop sharing Maps and email budgets.

## To discuss: pipeline concurrency, set by each API provider's rate limit (owner, 2026-11-02)

- [ ] **Paid runs go one at a time today** (`divedeeper.ts:135`, `:248`, one slot). The slot also covers waiting for the company dive (E5). Live: run #8 was ordered at 04:33, two minutes after #7. #7 took 44 min, so #8 took 48 min, mostly waiting. Paid runs take 8–52 min each. The weighted queue changes the order, not how many run at once.
- [ ] **Rule: how many runs go at once is decided by the rate limit of every specific API provider. That is the hard limit.** Next step: find each provider's real limit (per key and per account), then set the pipeline's concurrency from the tightest one.
- The code's current settings, for the discussion. **These are our guesses, not the providers' real limits:**

  | Provider | What the code sets today |
  |---|---|
  | LLM lanes (Vectide ×2, Hive ×3) | 3 calls at once per lane (`LLM_LANE_CONCURRENCY`); "use first" lane unlimited; a 429 rests a lane 60 s (10 s for "use first") (`core/llm.ts:52-54`). Vectide answered about 100 times with 429 in the logged calls. |
  | MiniMax (Pi) | 6 at once (`PI_MAX_CONCURRENT`, `core/pi.ts:37`) |
  | Tavily | 2 at once per key (`core/tavily.ts:37`) |
  | Exa | 2 at once per key; a 429 rests the key 60 s, out of credit 1 h (`core/exa.ts:16-20`); 20 US keys via the proxy |
  | Brave | 100 ms between calls (`core/brave.ts:20`); 2 keys |
  | Maps (Gmap workers) | one scan per worker at a time; 2 workers |
  | Page reads (fetch workers) | up to 20 URLs a batch (`pagefetch.ts:30`) |
  | Run slots | company dive 3 at once (`companydive.ts:912`); dive-deeper 1 |

## Discovery: how long LLM calls really take (2026-11-02, no fix yet; plan it later)

Source: every LLM call logged on the live hub (`company-diver-production`): 1,594 calls from 34 company dives and 14 dive-deeper runs, read through `/api/company-dive/<id>` and `/api/dive-deeper/<id>`. Script: `calls.mjs` (session scratchpad).

- [ ] **The longest call that came back with an answer took 348 s** (dive #23, Vectide plan 1, "analyse"). **No answer has ever arrived after 6 minutes.** A call still waiting past that is a dead end, not a slow answer.

  | Successful calls | Calls | Half done within | 95% done within | Longest |
  |---|---|---|---|---|
  | Company dive | 227 | 33 s | 118 s | 348 s |
  | Dive-deeper | 1,161 | 6 s | 54 s | 162 s |
  | All | 1,388 | 8 s | 78 s | 348 s |

  Over 60 s: 101 calls. Over 2 min: 14. Over 3 min: 4. Over 5 min: 1. Over 6 min: 0.
- [ ] **By lane.** Hive (3 accounts): half answer within 5–6 s, 99% within about 110 s, longest 170 s. Vectide has the long tail (269 s, 348 s) and nearly all the failures: 429 "too many requests" (about 100), "content can't be processed" refusals (about 30), and one call that ran 468 s and then came back empty.
- [ ] **The Hive 60 s cutoffs happened 4 times** (dive-deeper #13 ×3, #14 ×1). In those same runs Hive also gave answers of 65–110 s, so it is not a fixed 60 s limit. Those 4 were dropped connections.
- [ ] **Blind spot: a call is logged only when it ends.** The 15+ minute stalls (dive-deeper #11, #13, dive #35) never ended, so they are missing from these numbers. The times also leave out any wait for a free lane slot before a call starts (`startCall` runs after `take()` in `core/llm.ts`).
- What this suggests for the later fix (not decided): dive-deeper fires its second call at about 45–60 s (95% of answers arrive within 54 s). The company dive treats a call as a dead end after about 6–8 min, comfortably past the longest real answer.

## Design decided: weighted job queue (owner, 2026-11-02; build later)

Full design and reasons: [docs/job-queue-weights.md](docs/job-queue-weights.md).

- [ ] **Every queue serves by weight first, then by time.** Today every queue is first come, first served.
  - Free preview (company dive) = **weight 1**.
  - Everything a dive-deeper does = **weight 50**: LLM, Tavily, Exa, Brave, page reads, Maps jobs, its run slot.
  - Weight 50 always goes ahead of weight 1 in every queue ("cuts the line"). Two weight-50 jobs: the one that arrived first goes first.
- **Why:** many free previews run at once and fill every slot, so a paid dive-deeper waits behind them. A paid report that waits hurts the business's reputation (see the wait policy).

## Serious

- [ ] **Auto-scan keeps failing on insert.** Log: `[auto-scan] tick failed: duplicate key value violates unique constraint "published_report_pkey"`, 7 times in a row before one scan got through. **Confirmed (A1):** the id sequence stands at 112 while copied rows go up to id 46,911.
- [ ] **Lead import stopped, not finished.** Stopped at 46,826 / 56,502 `published_report` rows (log `/data/import-leads2.log`, last write 05:35 UTC). Still short: `search_report_company`, `contact_research_run` (0 / 55,411), `run_event`, `company_email`, `taman_assignment`, `territory_discovered`.
- [ ] **Dive-deeper accepts any country but is Malaysia-only.** Still open from the handoff (fix 1). Runs #7 (Korea) and #8 (Singapore) not marked invalid.
- [ ] **No explicit "ready" per country and stage** (MY = dive + deeper, SG = dive, KR = dive). Still open from the handoff (fix 2).
- [ ] **Dive-deeper report does not link to its company page.** `/dd/NypFVPVxKvB6mueoLFyl` has no link to `/companies/co_2bb39722f88b`.
- [ ] **Dead links shown as evidence.** The same report cites 5 links on the dead `signmastr.com`, taken from third-party listings.
- [ ] **Fetch worker reads nothing on some sites.** Mac mini Crawl4AI: `Unexpected error in _crawl_web` on every signmastr.com.my page (dive #34 read 0 of 13 official pages). The re-run (#36) read 12 of 15, so it is intermittent or depends on the worker.
- [ ] **Hive LLM calls cut off at exactly 60 s** (`answer cut off: terminated`, 3 times in run #13). Cause unknown. Update: 4 times in all (also #14), and Hive answered 65–110 s calls in the same runs, so it is not a fixed limit (see Discovery above).
- [ ] **Google Maps name search returns nothing.** On the Gmap workers, a search for the exact company name found 0 (TS Media), so the listing was found only through the trade searches. A company that does not rank in those would get a false "no listing".
- [ ] **Google review analysis is gone.** E-maps was removed with scraper.tech. The Gmap workers return no review text. Decide: build a reviews job on the workers, or drop the feature.
- [ ] **Old app (ee-auto) still runs in parallel** with its own auto-scan and loops against the same Maps and email budgets. Decide when to turn it off (handoff fix 6).
- [ ] **Country-industry research snapshots not copied** from the old service's `/data` (handoff fix 7).

## Review

- [ ] **Complexity added on 2026-11-02:** lane retries, "incomplete" status, automatic resume and the restart resume, in both the company dive and the dive-deeper. Review whether each piece earns its place once the root causes above are settled.
- [ ] **Resume after a restart while a run is going** has not been shown live. The redeploy for that test was blocked.
- [ ] **Mac mini workers `-fb`, `-x`, `-ads`** still loaded, claiming nothing. Unload them.

---

# Full audit, 2026-11-02 (read-only)

Method: four code audits (company dive; dive-deeper lanes; writing stages, pages and run control; workers, queue and data import), plus a check of live data (every run in MirrorDB, all 16 id sequences).
**[V]** = verified by me in the code or on live data. **[A]** = found by a code audit; the cited lines exist, but I have not re-checked the reasoning. Paths are under `agy-lab/src/` unless shown in full.

## A. Data import and database (affects leads and auto-scan)

- [ ] **A1 [V] CRITICAL: the `published_report` id sequence is behind the copied data** (next id 112, max id 46,911). Every new report insert collides: auto-scan, business search, contact research. The import resets a sequence only after a table copies cleanly (`scripts/import-from-pg2nd.ts:354-358`, called at :434). This copy stopped part way, so the reset never ran. The other 15 sequences are fine (checked live).
- [ ] **A2 [A] CRITICAL: the import ran while the hub was writing to the same tables.** The rows went in with `on conflict do nothing` (`import-from-pg2nd.ts:238-241`). A clash on any unique key drops the source row silently. Child rows (`run_event`, `contact_research_run`, `company_research_run`) can then attach to an unrelated hub row with the same id. The doc says the loops were off (`scripts/IMPORT.md:29`), but `server.ts:546-556` starts every loop at boot [V].
- [ ] **A3 [A] HIGH: the `published_report` rows skipped for a foreign key are missing parent `company_data` rows.** Causes: a live source copied table by table, and `place_id` clashes dropping companies. `--resume` restarts after the highest id, so rows skipped below it are never retried (`import-from-pg2nd.ts:321-325`). The source token expires 2026-11-06.
- [ ] **A4 [A] MEDIUM: imported rows that were mid-run are picked up and run again** (contact research: `reportdb.ts:1167-1217`) or marked failed as abandoned (`server.ts:567`).
- [ ] **A5 [A] MEDIUM: imported company dives carry `company_uid` values, but the `company` table was not copied** (`company-uid.ts:229` join), so those dives are hidden from company pages.
- [ ] **A6 [A] MEDIUM: every boot assigns two real leads to the demo telemarketer "Sarah Tan"** (`reportdb.ts:702-718`).
- [ ] **A7 [A] LOW: the boot migration runs heavy full-table updates before any query can run** (`reportdb.ts:401-476`, `686-700`) on about 1.5 million imported rows.

## B. Company identity and the company UID

- [ ] **B1 [V] HIGH: one company gets several UIDs.** Eternalgy has `co_e899c1aee3fa` (solarpanels.my), `co_db11e5b48700` (eternalgy.me) and `co_dbd920cda1f6` (eternalgy.com). A UID is keyed on one domain, and each dive lists its domains in a different order (`company-uid.ts` resolve/backfill).
- [ ] **B2 [V] HIGH: a dead domain became Signmastr's UID** (`signmastr.com`). The record was corrected by hand to `signmastr.com.my`, and dive #34 and dive-deeper #13 were built on the dead domain. Code fixed in `7a99e30` (liveDomains), but see B3.
- [ ] **B3 [A] MEDIUM: an official domain is accepted if it merely resolves,** so `facebook.com` or `linkedin.com` can become the official domain (`companydive.ts:292-303`). The Facebook and LinkedIn searches add many URLs, which pushes them up the ranking.
- [ ] **B4 [A] HIGH: a website the user supplies is dropped before the research starts** (`companydive.ts:536` plainName; POST stores it nowhere). Triage can then pick a lookalike company's domain, and the report describes another company under the right UID.
- [ ] **B5 [A] HIGH: the company's identity (legal name, registration number, domains) comes only from triage, from snippets, and is never re-checked.** It is printed on the cover as fact (`companydive.ts:635`; `companydive-report.ts:100-122`).
- [ ] **B6 [A] HIGH: every page a gap search returns is marked "about the company"**, overriding triage's rejection of lookalikes (`companydive.ts:731-732`, `765-766`).
- [ ] **B7 [V] HIGH: "(M)" in a Malaysian legal name breaks the search name.** "Rienzo (M) Sdn Bhd" becomes "rienzo m" (`divedeeper/lib.ts:416`), so news, risk checks and the SEDA, MPSEA and SHRDC registers find nothing and report "clear" or "NOT FOUND" [A].
- [ ] **B8 [A] HIGH: H-maps matches its own listing badly in both directions** (`sections/H-maps.ts` isUs): it misses short or holding names, and it matches generic first words ("Klinik", "Kedai") and other businesses.
- [ ] **B9 [A] HIGH: every non-free email domain on the site is treated as the company's own** (`sections/A-assets.ts:234`), e.g. the web agency in the footer. The report then flags SPF, DMARC and "registered to someone else" for the agency's domain.
- [ ] **B10 [A] HIGH: a domain the company also owns, but which is missing from the dive, is reported as an impersonator** (`A-assets.ts:348-356`).
- [ ] **B11 [V] MEDIUM: a non-Latin name is lost when the run is started.** Dive #26's Korean name is stored as `(?)??`. Nothing checks the input encoding.

## C. "Not found" published when the lookup itself failed (false claims in paid reports)

- [ ] **C1 [A] CRITICAL: an unreachable CIDB register becomes "not in the CIDB register" plus "CONTRADICTED (overclaim)" (high)** (`sections/D-registry.ts:152`, `210-211`). The lane is only "partial", so it publishes.
- [ ] **C2 [V] HIGH: a name search that returns only other businesses becomes "0 Google Maps listings carry your name" plus "No Google Maps listing in <town>" (high)** (`H-maps.ts:77` `if (own)`; town check :128-131 compares against feed addresses that hold only a street [A]).
- [ ] **C3 [A] CRITICAL: a site the hub cannot read (WAF or 403 to Railway's IP) produces a cascade of claims:** "your website shows no phone", "nothing answers why choose you", "fails the five-second test", "does not open" (`C-merged.ts:184`; `R-contacts.ts:184`; `B-brand.ts:42-82`; `A-assets.ts:289`).
- [ ] **C4 [A] HIGH: a DNS timeout or a missing MX record becomes "emails bounce", "does not point anywhere", "no SPF"** (`C-merged.ts:508-510`; `R-contacts.ts:103`; `A-assets.ts:100`, `280-284`). A DNS error in G becomes "that domain does not exist" (`G-shared.ts:333-346`).
- [ ] **C5 [A] HIGH: an incomplete certificate chain is reported as an untrusted SSL certificate (high),** although browsers accept it (`C-merged.ts:251-253`, `341`; `A-assets.ts:127-132`, `294`).
- [ ] **C6 [A] HIGH: bot blocks and 429/503 rate limits are reported as broken pages and dead sites** (`C-merged.ts:358`, `479`; `A-assets.ts:289`).
- [ ] **C7 [A] HIGH: register lookups default to "VERIFIED" when the judging LLM's answer does not parse** (`D-registry.ts:430-441`). Weak or guessed lookups give "NOT FOUND" (Golden Bull :326, MPSEA :348, SHRDC :371).
- [ ] **C8 [A] HIGH: the CIDB search reads only the first page of 50 and stops searching longer names once a shorter alias matched,** so the company's own row can be missed (`D-registry.ts:143`, `158`, `170`).
- [ ] **C9 [A] HIGH: a failed people step shows as "no people found".** Its status and warnings are never checked (`companydive-people.ts:194-242`; `companydive.ts:989-993`).
- [ ] **C10 [V] HIGH: the report still claims "every Google review was read" and "no unanswered reviews needed a draft",** though reviews are no longer collected (E-maps removed) (`divedeeper/report-html.ts:57`, `788`, `809`; `preview-html.ts:101-107`). S4 is still fed "answered: 0 of 0 reviews" next to a listing showing N reviews [A] (`S4-analysis.ts:38-39`).
- [ ] **C11 [A] HIGH: the G judge marks a true answer "wrong" when the detail is missing from the dive's fact sheet** (`G-shared.ts:210-211`). Unjudged answers count as "not named" (`:370-373`), and the wording assumes two models (`:364`, `:381`) when one runs.
- [ ] **C12 [A] HIGH: an old-format SSM number on the site (1234567-A) is reported as "a different company's number" (high)** (`C-merged.ts:418`). A unit number on the same road is reported as "address differs" (high) (`:461`).
- [ ] **C13 [A] MEDIUM: Malaysian vanity numbers and foreign numbers are reported as numbers that "cannot work" or "cannot exist" (high)** (`R-contacts.ts:46-48`; `C-merged.ts:496`, `501`).
- [ ] **C14 [A] MEDIUM: any ® on the homepage (e.g. "Huawei®") triggers a Trademarks Act warning** (`K-credibility.ts:77`, `161`). Any "alert" hit is labelled the Securities Commission's alert list (`:149`).
- [ ] **C15 [A] MEDIUM: other absence claims rest on one engine's top results:** "no reviews of you" (`H-web.ts:86`), "no directory mentions" (`B-brand.ts:88`), "web search returns 0 of your pages" from 6 Exa results (`G-grounded.ts:111`).
- [ ] **C16 [V] MEDIUM: the report cites dead links as evidence** (5 links to `signmastr.com` in `/dd/NypFVPVxKvB6mueoLFyl`).

## D. One run's data leaking into another; stale caches

- [ ] **D1 [V] CRITICAL: one company's CIDB sweep and MyHijau result are reused for every later company in the same hub process** (`D-registry.ts:132-135` `sweepOnce`, `:291-298` `myhijauCache`; module-level, never reset). Run B can show "CIDB sweep: <company A> is registered".
- [ ] **D2 [A] HIGH: a failed LLM call's fallback search plan and AI profile are written to cache, so the retry reads them and is marked "done" with the wrong trades and areas** (`H-plan.ts:13-36`; `G-shared.ts:118-125`). H-maps and H-web can also each build a different plan at the same time (`:13`).
- [ ] **D3 [A] MEDIUM: delivered reports are redrawn with the current code on every visit,** so old reports change (E-maps items vanish while the stored S4 text still talks about reviews) (`divedeeper.ts:398-405`).

## E. Run control, status and recovery

- [ ] **E1 [V] CRITICAL: a company dive is set "done" before its dossier is written.** A restart, timeout or database error during writing leaves "done" with no dossier for good. Live: dives #20 and #23 (`companydive.ts:1004-1026`; resume picks only queued and running :1093).
- [ ] **E2 [A] HIGH: the public `/d/` page stops polling when it sees "done" without a dossier**, and never shows the report (`companydive-report.ts:184`, `214-217`).
- [ ] **E3 [A] CRITICAL: a company whose own site cannot be read can never get a report.** All 6 tries fail the same way, each re-runs the whole dive from nothing (up to about 90 Tavily calls), and then it is "failed" (`companydive.ts:681-683`, `998-1000`). Introduced on 2026-11-02.
- [ ] **E4 [A] HIGH: when a time limit fires, the old try or lane keeps running in the background.** It spends money and overwrites the log and stage of the next try; two or three copies of a lane can run at once (`companydive.ts:994-998`; `divedeeper/runner.ts:65-70`). Introduced on 2026-11-02.
- [ ] **E5 [A] HIGH: dive-deeper waits for its company dive without a limit, inside its only run slot,** so one slow or stuck company dive blocks every paid run (`divedeeper.ts:171-177`).
- [ ] **E6 [A] HIGH: if the final database write fails, the run stays "running" with nothing behind it;** Retry then answers 409 (`divedeeper.ts:161`, `226-238`, `521`). The same applies to the company dive (`companydive.ts:971-976`, `1038`, `1052`).
- [ ] **E7 [A] MEDIUM: a render error marks the run "failed", and Retry for "failed" throws away every lane already paid for** (`divedeeper.ts:231-238`, `529`).
- [ ] **E8 [A] MEDIUM: during a deploy the old and new containers overlap, so the same paid run can execute twice** (`divedeeper.ts:259`; there is no owner or lease column).
- [ ] **E9 [A] MEDIUM: one failed preview write fixes that preview on fallback wording for good** (`divedeeper.ts:349-351`).
- [ ] **E10 [A] LOW: double clicks start double runs; there is no active-run check** (`divedeeper.ts:470-491`; `company-page.ts:223-232`).
- [ ] **E11 [V] POLICY CONFLICT: the kill-and-restart behaviour added on 2026-11-02 breaks [docs/llm-wait-policy.md](docs/llm-wait-policy.md):** the idle kill in `core/llm.ts` + `core/idle.ts`, the 15-minute lane limit then retry (`runner.ts`), and the 40-minute try limit then a full re-run (`companydive.ts`).

## F. Report content quality

- [ ] **F1 [A] CRITICAL: the analysis step sees the company's own pages last, so the 120k-character cap can drop them entirely** (`companydive.ts:351-357`, `697`). Each page is clipped to its first 6,000 characters, which cuts the footer where the SSM number and phone usually are (`:352`).
- [ ] **F2 [A] HIGH: triage never sees the text of the Tavily T1 results, only their titles** (`companydive.ts:571`, `384`).
- [ ] **F3 [A] HIGH: the people-list prompt has no size cap** (up to about 20×25 hits), so it can exceed the model context and fall back to an empty list (`companydive-people.ts:87`, `114`, `223`).
- [ ] **F4 [A] HIGH: an LLM answer cut short by the token limit (`finish_reason: length`) passes as complete,** e.g. a dossier missing its last chapters (`core/llm.ts:320`).
- [ ] **F5 [A] HIGH: a stage whose LLM answer does not parse still publishes as "Report ready: every lane ran",** with no analysis or website plan (`S4-analysis.ts:83`; `divedeeper.ts:232`). A lane that ran with warnings ("partial") is treated as complete, and the report never shows that a part is degraded (`editor.ts:248`).
- [ ] **F6 [A] MEDIUM: a part with no data shows "Good"** (`editor.ts:79`, `248-250`). Fallback headlines show false zeros ("0 news articles", "0 of 0 checks clear") (`report-html.ts:601-603`). An empty S4 "mismatch" list is replaced by raw contradictions (`:646`). An expired CIDB grade is shown as the official grade (`editor.ts:188-189`).
- [ ] **F7 [A] MEDIUM: S3 maps plain titles onto findings by the LLM's numbering,** so one skipped entry shifts every later title onto the wrong finding (`S3-editor.ts:80-83`). Stories can point to a "Part 0" that does not exist (`report-html.ts:613-614`, `748`).
- [ ] **F8 [A] MEDIUM: drafts claim to be "written only from facts we verified"** but are briefed with unverified dive facts (`S2-consult.ts:102`, `121-126`; `report-html.ts:779`). S2's copy is hard-coded for a solar installer (`S2-consult.ts:142-163`).
- [ ] **F9 [A] MEDIUM: B-brand presents LLM opinions as measurements** ("understands your business N out of 100", "fails the five-second test") (`B-brand.ts:78-88`).
- [ ] **F10 [A] MEDIUM: fact and people citations are not checked against the sources the model was actually shown** (`companydive.ts:364-377`; `companydive-people.ts:232`). Dossier citations are never checked (`report-html.ts:105`).
- [ ] **F11 [A] MEDIUM: bot-challenge, 404 and cookie-wall pages count as pages read** (`local-fetch-worker/worker.ts:146-150`; `pagefetch.ts:83`).
- [ ] **F12 [A] MEDIUM: falling back to another search engine changes what a finding means** (Exa's semantic order reported as "top 20 for customer searches"; `site:` queries returning other sites) (`divedeeper/lib.ts` exa and brave fallbacks; `H-web.ts:30-35`; `K-credibility.ts:60`). Introduced on 2026-11-02.
- [ ] **F13 [A] LOW: the cover claims "every page of your sites tested"** (C-merged caps at 50 pages) (`report-html.ts:730`). Any registration number is labelled "SSM" (`editor.ts:255`).

## G. Access and privacy

- [ ] **G1 [V] HIGH: a preview link `/dp/<id>` gives access to the full, unscrubbed company dive at `/d/<id>`,** because both use the same id (`divedeeper.ts:362`; `companydive.ts:1223`). The full page shows staff names, phone numbers and private document links.
  - **Owner decision 2026-11-02: leave it open until just before launch.** It is easier for the owner to check runs that way. **Fix at launch:** the full company dive page (`/d/<id>`) is not viewable at all, by anyone, under any circumstances. The full company dive was never meant to be shown. It is internal material: it is what the preview is written from, and it is the foundation the dive-deeper runs on. Only the preview (`/dp/`) and the paid report (`/dd/`) are for clients.
- [ ] **G2 [V] HIGH: no report links to its company page** (`report-html.ts` and `companydive-report.ts` have no `/companies/` link). `/companies/<uid>` also asks for LAB_TOKEN, so a client following such a link would hit a token prompt [A] (`company-page.ts:63-69`).
- [ ] **G3 [A] MEDIUM: the preview scrub misses email addresses, landlines written +603-, non-Malaysian numbers and staff not in the people list** (`divedeeper/privacy.ts:21-35`). "Art Director" and "Principal Engineer" count as leadership (`:16`).
- [ ] **G4 [A] LOW: the public `/dd` progress page shows internal error text and log lines** (`divedeeper.ts:413-416`).

## H. Country scope

- [ ] **H1 [V] HIGH: dive-deeper has no country check at any entry point** (API, both consoles, preview writer). Runs #5 and #8 (Singapore) and #7 (Korea) ran Malaysian checks on them. Retry on a non-Malaysian run starts a Malaysian dive (`divedeeper.ts:123` hard-codes `country: 'Malaysia'`).
- [ ] **H2 [A] MEDIUM: Malaysian defaults remain in the company dive for countries without a pack:** people search location MY, the hard-coded Johor example, the triage skip list, and no country-name synonyms ("USA", "UK", "Korea") (`companydive-people.ts:106`, `170`; `companydive.ts:100-104`, `401`).

## I. Workers and job queue

- [ ] **I1 [V] HIGH: the rule that keeps the Mac mini off business scans never applies.** It matches only workers named `m4-mini…` (`jobs.ts:170`, `186`), and the worker is `Gans-Mac-mini-diver`. Live, it ran taman scans returning 1, 2 and capped-at-120 results (`limitedView: true`), and each one marks the taman as done for good.
- [ ] **I2 [V] HIGH: the fetch worker reports success even when every page failed** (`local-fetch-worker/worker.ts:254-255`). Its health check never touches the browser [A] (`crawl4ai_server.py:173-174`).
- [ ] **I3 [V] HIGH: the Gmap worker always sends `blocked = $false`** (`local-worker/worker.ps1:382`). A scan Google cut short counts as complete, and only search-list reads `stoppedEarly` [A].
- [ ] **I4 [A] HIGH: job waits count from creation, not from when a worker claims the job,** so a finished scan is thrown away after queueing behind others. This hits Maps reports, country research, search lists, dive-deeper Maps (8 at once on 2 workers) and page reads (`intel.ts:1711-1723`; `divedeeper/lib.ts:214-215`; `pagefetch.ts:111-119`).
- [ ] **I5 [A] HIGH: a scan that finishes after its lease ran out is refused with 403, then scanned again** (`jobs.ts:765`; `worker.ps1:407-425`). The heartbeat never extends a gmap.scan lease (`jobs.ts:681`).
- [ ] **I6 [A] HIGH: the Gmap worker sends no heartbeat while resting, retrying or backing off,** so it can look offline for about 40 minutes (`worker.ps1:171-175`, `401-404`, `477-481`). Live: offline 14:34–15:15.
- [ ] **I7 [A] HIGH: a contact-research job whose worker dies holds its slot until the next restart** (`intel.ts:2609` waits with no limit; `jobs.ts:250`).
- [ ] **I8 [A] MEDIUM: every job except country research is lost on restart** (`jobs.ts:101`). Pending jobs never expire and are never cancelled (`:247`, `274-277`, `512-528`). Three restarts fail a running country job (`:258`). A Google block counts as one of a taman's 3 strikes (`reportdb.ts:5141-5152`).
- [ ] **I9 [A] MEDIUM: the exact-name Maps search returns 0 because the PC worker parses only list answers, not a single place card** (`worker.ps1:214-217`). Every search is centred on Kuala Lumpur (`:97`). The Mac worker reports an empty feed as blocked [A] (`worker/gmap.mjs:401`).
- [ ] **I10 [A] MEDIUM: raw-socket calls (whois, TLS) have no timeout** (`A-assets.ts:31-39`, `127`; `C-merged.ts:251`).

## J. Seen on 2026-11-02 but not recorded until now

- [ ] **J1 HIGH: reports built on bad data are still live and not marked:**
  - Company dive #34 and dive-deeper #13 were built on the dead domain `signmastr.com` and superseded by #36 and #14.
  - Dive-deeper #10 (TS Media) says 7 times that there is "no Google Maps listing" (it has 4.9★ from 289 reviews). Superseded by #12.
  - Dive-deeper #5 and #8 (Singapore) and #7 (Korea) ran the Malaysia-only pipeline.
  - Company dives #28, #31, #32 and #33 were started as "Name (website)" before the fix, so 4 of their 8 Brave searches came back empty.
- [ ] **J2 MEDIUM: runs cut off by restarts were never re-run.** Company dives #9, #10, #14, #19, #21, #22 and dive-deeper #4 and #11 are still `failed: interrupted by a restart`.
- [ ] **J3 MEDIUM: dive #2 failed outright on an LLM answer that was not valid JSON** (`unterminated JSON in answer`).
- [ ] **J4 MEDIUM: the lead import process stopped at 05:35 UTC with no restart behind it.** The cause is unknown; most likely the shell session that started it ended.
- [ ] **J5 MEDIUM: right after a deploy the database connection timed out** (`timeout exceeded when trying to connect`), and `/dd/<id>` answered HTTP 500 for a few seconds.
- [ ] **J6 MEDIUM: every provider failed at once from 04:56 to 05:06 UTC during dive-deeper #7** (handoff item 8). The cause is unknown.
- [ ] **J7 MEDIUM: this PC (DESKTOP-CAMHL16):**
  - Both workers could not resolve the hub's address from 15:11 to 15:15 local time.
  - Before that, the Gmap worker logged nothing from 14:33 to 15:11, and the hub showed it offline.
  - The cause of the silence is unknown; I6 covers only the heartbeat part.
- [ ] **J8 MEDIUM: behaviour changes I made while removing scraper.tech, to review:**
  - Search lists run 2 searches at once instead of 5 (`search-list.ts` SEARCHES_IN_FLIGHT).
  - Auto-scan's monthly Maps budget hold is gone.
  - The scraper.tech key box and the key-health tile are gone.
- [ ] **J9 LOW: old dive-deeper runs #1 to #3 carry many lane warnings** (#1 G-fixed alone has 94). Never investigated.
- [ ] **J10 LOW: `scripts/find-tamans.ts` still points at the old hub by default** (`LAB_URL` falls back to `https://ee-auto.up.railway.app`).
- [ ] **J11 LOW: Railway warns that `railway.json` (config as code) stops working on 2026-12-01.** It must be migrated before then.
- [ ] **J12 LOW: the Mac mini `-probe` worker is a leftover** (handoff).
- [ ] **J13 LOW: files left uncommitted in the working tree:** `.gitignore` (modified), `.ignore`, `dive-run-my.log`, `dive-run-rest.log`, `dive-run-sgkr.log`, `push-after-runs.log`.
