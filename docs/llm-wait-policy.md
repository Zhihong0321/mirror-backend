# LLM wait policy: company dive vs dive-deeper

Owner's rule, set 2026-11-02. It overrides any earlier reading of "slow LLM" in this repo,
including the keep-alive diagnosis in commit `7a99e30`. Any change to `agy-lab/src/core/llm.ts`
(timeouts, idle checks, retries, lane choice) must follow it.

The two products have opposite needs. One timeout rule for both is wrong.

## 1. Company dive: the free preview. It may take as long as it needs; it must finish.

- What it is: the first report, sent to a potential client before they buy. The owner runs many
  dives at once.
- **Speed does not matter. Finishing does.** A slow call that is still working is fine.
  Never kill it just for being slow.
- "Can wait forever" means *still deliver a result*. It never means waiting on a dead end. A call
  that will never answer (a dead connection, a stream with no answer in it, a lane that hangs)
  must be noticed and the work carried on until there is a result.
- Throughput comes from running many dives at once, not from making each call fast.

## 2. Dive-deeper: the paid full report. It cannot wait.

- What it is: what runs when a client buys the full report.
- **A long wait hurts the business's reputation.** Speed is the priority here.
- Every LLM call needs an **automatic retry, done by racing calls (a hedge)**:
  - When a call is slow, **fire a second call for the same task** (on another lane), and
    **keep the first one running**.
  - **Use whichever answers first**, then cancel the other.
- **Do NOT "kill the slow call, start a new one".** That throws away the first call's progress
  and resets the clock. It is the wrong pattern (the owner's words: stupid).

## The plan (owner, 2026-11-02; not built yet)

1. **A reasonable time gate,** set from real call times: dive-deeper about 45–60 s, company dive about
   6–8 min. No answer has ever arrived after 348 s (must-fix-checklist, Discovery).
2. **Weighted task categories:** dive-deeper work (paid) is processed first. See below.
3. **Nothing is killed; more new calls may fire.** Past the time gate, a new call for the same task
   fires on another lane and the old one keeps running. The first answer is used.

## Paid work goes first in every queue

The same reason (a paid report cannot wait) gives the weighted job queue: dive-deeper work has weight
50 and free previews weight 1, so paid work goes ahead in every queue. See
[job-queue-weights.md](job-queue-weights.md).

## What this means for the code today (not yet changed)

- `llm.ts` rule 6 plus `idle.ts` cancel a stream after `IDLE_MS` (120 s) with no answer, then try
  the next lane. That is "kill and start new":
  - For the **dive** it may kill a slow call that was still working. It should only catch real
    dead ends, then keep going until there is a result.
  - For the **dive-deeper** it is the forbidden pattern. It needs racing calls instead.
- `chat()` has no notion of which product is calling. The caller (dive vs dive-deeper) has to
  choose the policy.

## Open questions for the owner

- Dive-deeper: how many seconds without an answer before the second call fires? Is a third call
  ever allowed?
- Paying for the losing call's tokens on dive-deeper is accepted as the price of speed. Is that right?
- Dive: what counts as a "dead end" (no bytes at all, no answer data, a closed connection)? After how long?

## Design review, 2026-11-02 (must-fix-checklist, "Design review")

- **R5:** a paid report's wait is mostly structure (one run slot, an unlimited wait for the dive, lane sleeps of
  1 and 3 min, 30-min resumes, S2–S5 in a row), not LLM speed. Racing calls is needed but is the smaller part.
- **R6:** once calls race here, the lane limit (15 min) and the try limit (40 min) go. They never cancel the work
  they give up on. The idle limit does cancel (`core/idle.ts`), but it is the forbidden kill-and-restart.
- **R4:** a racing call needs capacity kept for it. The "use first" lane has no slot limit, so its only queue is
  the provider's own 429.
