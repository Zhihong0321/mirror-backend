# Dive-deeper: modular pipeline design

Owner's design, set 2026-11-02. Not built yet. It replaces the current dive-deeper, which was built
around one test company (Eternalgy Sdn Bhd, a Malaysian solar installer) and runs that company's
checks for everyone (must-fix-checklist, "Root cause").

## The design (owner's words, tidied)

The dive-deeper is built from six modules:

1. Broad search
2. People search, social media search
3. Government agency search prompts (different per country)
4. Industry-specific search prompts (researched ahead of time: what to search and check for each industry)
5. Google Maps review search
6. Domain and digital asset search

One simple step picks from the **search prompt database** and builds a dive-deeper pipeline for
the target company, based on its **country and industry**.

The homework is already done: a collection of "what question to ask, which website to check"
search prompts.

## Why

- Today every check is code, and it runs for every company. Checks that fit one solar installer
  produce noise or false findings for a clinic, a restaurant or a shop. Example: the CIDB sweep
  runs "whatever it claims" (`divedeeper/sections/D-registry.ts:113`).
- With this design a check is an entry in a database, chosen per company. A company only gets the
  checks that apply to its country and industry.
- Adding a country or an industry becomes research work, with no code change.

## Review notes (agreed for the build)

1. **The modules are fixed tools; the prompts are data.** Keep the six modules few and generic.
   All the variety lives in the database.
2. **Reuse the country-pack pattern** (`agy-lab/src/countries/`, README): data not code, only adds,
   validated, a broken entry is ignored, draft until tested.
3. **The pick step is a plain lookup** (country + industry → entries), not an LLM decision, so it is
   predictable and testable.
4. **The industry must be right.** Take it from the company dive's findings plus the Maps category.
   Allow more than one industry (a solar installer = construction + energy). When unsure, run only
   the general modules. The report shows which checks were chosen and why.
5. **Each prompt entry holds:** who it applies to (country, industry), the question, the sites or
   registers to check, and what counts as found / not found / couldn't check.
   **"Couldn't check" is never reported as "not found."** The module enforces this once, for every
   entry (most of the false claims in the 2026-11-02 audit, section C, are this mistake).
6. **When nothing matches:** modules 1, 2, 5 and 6 always run. Modules 3 and 4 run only with matching
   entries. Otherwise they are skipped and the report says so. Never fall back to Malaysian checks.
7. **Module 5 has no data source today.** The Gmap workers return no review text since E-maps was
   removed. It needs a reviews job on the workers first.
8. **The writing stages need the same treatment.** S2's consult copy is hard-coded for a solar
   installer (checklist F8). If only the search side becomes modular, the write-up still sounds
   like Eternalgy.
9. **It fits the other plans.** The modules are independent, so they run in parallel. Every call is
   weight 50 ([job-queue-weights.md](job-queue-weights.md)) and follows [llm-wait-policy.md](llm-wait-policy.md).

## Where today's code fits (for the migration)

| Module | Current sections |
|---|---|
| 1 Broad search | `H-web`, `N-news`, `K-credibility`, `G-*` |
| 2 People, social | company dive people step, `R-contacts` |
| 3 Government (per country) | `D-registry`, `D-web`, `D-common` (CIDB, SEDA, MPSEA become Malaysia entries for the industries they fit) |
| 4 Industry | nothing yet: industry-specific checks are hard-coded inside the sections above |
| 5 Maps reviews | `H-maps`, `H-plan` (no review text today) |
| 6 Domain, digital assets | `A-assets`, `W-speed`, `C-merged`, `C-rules`, `B-brand` |

## Open

- **Where the search prompt collection lives.** This repo holds only the company dive's country
  packs (MY, SG, KR). The MY pack is empty on purpose because the Malaysian rules are in code, and
  there are no industry prompts. The owner to point at the collection (a file, Notion, or the old service).

## Design review, 2026-11-02 (must-fix-checklist, "Design review")

- **R8:** modules are sources, the report's parts are topics. G-* (AI answers), W-speed, C-merged and A-assets are
  measurements, not prompts. Two kinds of module: fixed measurements that always run, and prompt-driven searches.
  The writing stages read typed findings (check id, report part, outcome, evidence) by part, never lane files.
- **R8:** module 5 (reviews) has no source; the report and the preview stop promising it until one exists.
- **R3:** the industry comes from the lead's Maps category plus the dive, not from triage alone.
- **R10:** the pick step runs at preview time, and the preview promises exactly the checks the paid report will run.
