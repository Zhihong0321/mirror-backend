# Weighted job queue

Owner's design, set 2026-11-02. Not built yet. This doc records what was decided and why, so
the build later follows it. It goes with [llm-wait-policy.md](llm-wait-policy.md).

## The rule

Every queue in the hub serves waiting work **by weight first, then by arrival time**.

| Work | Weight |
|---|---|
| Company dive for a free preview | 1 |
| Every task of a dive-deeper (paid full report) | 50 |

- "Every task" means every kind of call a dive-deeper makes: LLM, Tavily, Exa, Brave, page reads on
  the fetch workers, Maps jobs on the Gmap workers, and the dive-deeper run slot itself.
- Weight 50 always goes ahead of weight 1, whatever arrived first. It "cuts the line" in every queue.
- Two items with the same weight (for example two dive-deeper runs that collide): **the one that
  arrived first goes first.**

Today every queue is first come, first served. That is what this replaces.

## Why

- The owner runs **many free previews at once** to get first reports out to potential clients.
  Those previews fill every LLM lane slot, the Tavily, Exa and Brave limits, and the worker job queues.
- A client who **buys the full report** starts a dive-deeper. With first come, first served, its
  calls wait behind every preview already in line.
- The wait policy says a preview may be slow but a paid report may not: **a long wait on a paid
  report hurts the business's reputation.** A preview loses nothing by waiting a little longer.
- So the free preview must never block a dive-deeper. Weight puts paid work at the front everywhere.
  Racing a second call (wait policy) only helps once a call has started. The weights get it
  started at once.

## How many run at once (owner, 2026-11-02; to discuss)

Weights decide the **order**. They do not decide **how many** run at once. That number comes from the
**rate limit of every specific API provider (LLM lanes, MiniMax, Tavily, Exa, Brave, Maps workers, fetch
workers). Those are the hard limits.** Find each provider's real limit first, then set the pipeline's
concurrency from the tightest one. Today dive-deeper runs one at a time, so a second paid order waits
for the whole first run (live: run #8 waited behind #7, 48 min in total). The code's current settings
are listed in must-fix-checklist.md, "Pipeline concurrency".

## Where work waits in line today (found 2026-11-02, for the build)

- LLM lane slots: `agy-lab/src/core/llm.ts` `take()`/`give()`. When a slot frees, every waiter is woken
  and whichever grabs it first wins. There is no order at all.
- MiniMax: `core/pi.ts:305`, first in, first out.
- Exa and Tavily concurrency limits: `core/exa.ts`, `core/tavily.ts`.
- Worker jobs (page reads, Gmap scans): `jobs.ts`.
- Run slots: company dive, 3 at once, first in, first out (`companydive.ts:912`, `:1048`).
  Dive-deeper, 1 at a time, first in, first out (`divedeeper.ts:248`).
- The old admission queue in `queue.ts` (Pi only).

## Points to settle when building

- **The weight goes with the work.** A dive-deeper started with only a company name first starts a
  company dive (`divedeeper.ts` POST, `startDive`). That dive and every call it makes must carry
  weight 50, not 1. Otherwise the paid run waits behind the previews at its first step.
- Assumed, to confirm: "cutting the line" moves ahead of *waiting* work only. A preview call already
  running is not stopped (that would be kill-and-restart, which the wait policy forbids).
- Weight-1 work can wait a long time while paid work keeps coming. The wait policy accepts this for
  previews: they may be slow, as long as they finish.

## Design review, 2026-11-02 (must-fix-checklist, "Design review")

- **R1:** build the weights once, in one durable step table that every pipeline uses, not in each of today's queues.
- **R4:** order alone does not stop a paid call waiting. Previews hold slots for minutes, and the "use first"
  lane has no queue to cut (its queue is the provider's 429). Keep capacity (slots or rate budget) for weight 50.
  Contact research, email replies and the gateway need weights too; the contact worker's `diveRunning()` pause goes.
  A weight can rise: when a client pays, the dive their report needs moves up to 50.
- **R5:** the concurrency limit belongs on each provider, not on the pipeline. One global number from the
  tightest provider leaves every other provider idle.
- **R12:** the paid run starts by hand today, so "paid cannot wait" counts only from the press of the button.
