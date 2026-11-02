# Research storage: company → report → research call

Design agreed with the owner on 2026-11-02. Not built yet.

## The problem it solves

Found on 2026-11-02 by reading the code:

- **Research data can leak between companies.** Two module-level caches in the register checks keep the
  first company's answer until the hub restarts: the CIDB sweep and MyHijau
  (`divedeeper/sections/D-registry.ts:132`, `:291`). Company B's report can show company A's result.
- **Dive-deeper lanes pass data through files on disk named by the company dive's id, not the run's id**
  (`dive-<id>.json`, `H-plan-<id>.json`, `G-*-<id>.json`, `D-claims-<id>.json`, S2–S5). Two runs on the
  same company dive share them, and an old or fallback file beats fresh research.
- **A try that hits its time limit keeps running** and writes into the row the next try uses (checklist E4).
  **Old and new containers can both run the same run during a deploy** (E8).
- **What an API call returns is never stored.** Only a log line is kept (what was asked, lane, time,
  tokens, cost).
- **The company dive writes its research only at the end** (`companydive.ts` `execute`). A crash,
  timeout or restart loses everything already paid for, and the retry pays again from nothing (E3).

## The design: three levels

```
company        (company UID)
  └ report     (report UID; holds its company UID)
      └ research call   (holds its report UID): module, query, provider, raw result, status, time
```

1. **Company.** One row per company, with its UID. The `company` table exists (`company-uid.ts:55`).
2. **Report.** Every company dive and dive-deeper has its own report UID (today `public_id`) and stores its
   company UID. The company's list of reports is a lookup by company UID, shown as a list on the company
   page. It is not an array stored on the company: an array is a second copy of the link that can drift
   (two reports finishing at once overwrite each other; deleted or merged reports leave stale entries).
3. **Research call (new).** Every API call (LLM, Tavily, Exa, Brave, page read, Maps, registers, DNS) writes
   its result to the database **the moment it returns**, with its report UID. Status is one of found / not
   found / couldn't check / failed.

## The rules (these give "zero chance of polluting another company")

- **Research data is written only with a report UID and read only by report UID.** No module can see
  another report's data.
- **No research data in memory caches or disk files shared between runs.** A cache is keyed by report UID,
  or it holds genuinely public data and carries its date.
- **Modules read each other's results from the database by report UID**, not from disk files.
- **Each report has one owner** (a lease): only one process may write to it. This closes the deploy overlap
  and the background tries.
- **A retry reuses the calls already stored** instead of paying again. That fits "nothing is killed" and
  "the dive must finish" ([llm-wait-policy.md](llm-wait-policy.md)): progress is never lost.

## Points to settle when building

- **The report UID is the anchor from the first call.** Today a dive started with a bare name gets its
  company UID only after it finishes (`companydive.ts:935-942`, "set where empty" updates). The company
  link is added when known. The report UID never waits.
- **One company gets several UIDs (checklist B1).** A UID is keyed on one website domain, so Eternalgy has
  three (solarpanels.my, eternalgy.me, eternalgy.com). With the company UID at the top, this identity
  problem must be fixed too, or one company's reports split across several "companies".

## How it fits the other plans

- [divedeeper-modular-design.md](divedeeper-modular-design.md): all six modules write into the research call
  table.
- The report can point to the stored response behind every claim (helps with dead links shown as evidence).
  "Couldn't check" is a stored status, never guessed afterwards.
- [job-queue-weights.md](job-queue-weights.md): each stored call's weight comes from its report (preview 1,
  dive-deeper 50).

## Design review, 2026-11-02 (must-fix-checklist, "Design review")

- **R9:** two things, kept apart. The raw call log is evidence. A run resumes from stored step outputs
  (report UID + step); "reuse a stored call" only works when a retry sends the same request, and LLM prompts
  built from earlier outputs will not.
- **R2:** "couldn't check" belongs on the check and the finding too, not only on the raw call. A finding points
  to a check; the check points to its calls.
- **R3:** the company is one entity with many identifiers (registration number, place id, domains, phone), not one
  domain. The dive starts from the anchors the lead already holds.
- A dive-deeper report names its parent report (the company dive), so it may read it.
- **R1:** leases, retries and resume live in the same step table as the weights.
