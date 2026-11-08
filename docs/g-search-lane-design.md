# G-search lane: how an AI assistant WITH web search sees the company

Status: BUILT 2026-11-08, NOT YET RUN ON THE HUB. Unit tests pass with a fake hub; the live proof (one run on Eternalgy on the hub) is still to do.

## Build notes (2026-11-08)

- New: `agy-lab/src/divedeeper/sections/G-search.ts`, tests in `agy-lab/src/g-search.test.ts`.
- Deleted: `sections/G-fixed.ts`, `sections/G-grounded.ts`. No switch, no fallback.
- Readers changed: `B-brand.ts`, `S2-consult.ts`, `editor.ts`, `report-html.ts` (also `S4-analysis.ts`, which fed the old fields to its prompt),
  and the lane lists in `stages.ts` and `v21/run.ts`. The judge-based pieces are gone: the "right / wrong / unknown" bars, "None of
  these is correct", the "wrong details" action, and the fake-domain DNS check.
- Kept on purpose: `G-shared.ts` and `G-free.ts` (the G-free script lane and the company profile `profileOf` use them; `profileOf` now
  reuses the profile of the last G-search run). B-brand still has its own LLM comparison of the assistant's answer with the company's
  pages ("ai: right / vague / wrong / missing" per line of business); that is B-brand's analysis, not a judge of the G lane.
- NEEDED BEFORE THE HUB RUN: save the Antigravity hub token on the hub's `/workers` page, under "Other API keys", in the box
  "Antigravity hub token". It is stored in the hub database (key kind `agy_hub`, table `gemini_contact_key`; the table's allowed
  kinds are widened on the hub's next boot). The `AGY_REMOTE_TOKEN` Railway variable is the fallback when that box is empty, and
  the local vault on a dev machine. `AGY_REMOTE_URL` defaults to `https://my-agy.up.railway.app`. With no token the lane fails at
  once with "no Antigravity hub token". Deploy first: the box exists only in the new build.
- Not built: the spread across the 3 repeats is stored (every answer, with its worker) but the report shows only the first answer.
- Tunables: `DD_G_REPEAT` (default 3), `DD_G_SLOW_SEC` (default 240: after this a second copy goes to an idle worker).


## 1. Why

The V2.1 deeper dive asks DeepSeek from memory (lane G-fixed: 11 questions x 3 repeats x question + judge = 67 calls) and
DeepSeek with Exa results pasted in (G-grounded). A customer who asks a real assistant about a small Malaysian SME gets an
answer that comes from web search. Memory-only answers are a situation customers rarely meet, and one model family cannot
stand for "LLMs". On Eternalgy (run `aaacf31a`, report `a355101d`): DeepSeek from memory 3 right / 0 wrong / 22 unknown.

## 2. What the 2026-11-08 tests showed (Eternalgy, Gemini through the cloud hub `my-agy`)

| Test | Calls | Wall time | Result |
|---|---|---|---|
| 11 questions, one call each | 11 (4 workers) | 90 s | All answered, long (up to 1,840 chars) |
| 2 prompts: 9 company questions + 2 trade questions, 50 words max, JSON | 2 | 48 s | Clean JSON, every answer 13-41 words |
| 1 comparison prompt (Eternalgy vs Solana Tec, Amiya, Trexon) | 1 | 128 s | Clean JSON, 6 keys + sources |

Findings: with search the assistant knew the company (website, both phones, incorporation date, CEO, CIDB G7 / SEDA /
MyHIJAU). Eternalgy was NOT named in "best installers in JB" or "who should I contact" in 2 of 2 runs (4 answers).
The HQ unit number flipped between runs (01-23 then 23-01): the contradiction in the report shows up in AI answers.
Raw outputs: scratchpad `agy_answers.json`, `two_prompt.json`, `compare.json`.

## 3. Design

New lane `G-search` **replaces** G-fixed and G-grounded. Both are deleted in the same change (their lane files, their tests,
and any shared helper that nothing else uses). No switch, no fallback, no old code kept. Nothing in the report comes from
DeepSeek answering from memory: no memory block, no baseline line. The owner's ruling (2026-11-08): a model with no web
access cannot know a small SME, so its answers are meaningless however many questions are asked. G-grounded (Exa results
pasted into DeepSeek) was only a stand-in for search, and the hub's real search replaces it.

**Three prompts, each sent 3 times (9 calls), each repeat on a different hub worker, all in parallel:**

- **A, company facts.** The 9 company questions of today's fixed set in one prompt. "Max 50 words each." Reply is ONLY a JSON
  object `{id: {answer, sources[]}}`.
- **B, findability.** The 2 trade questions ("best installers in <area>", "I live in <area> and want <job>") in their own
  prompt. The company name appears nowhere in it, so the answer is not primed. We record whether the company is named.
- **C, comparison.** One prompt, and WE NAME NO COMPETITOR. The assistant is asked who the company's closest competitors
  are and how the company compares with them: keys `closest_competitors` (it names them), `reputation`, `services`,
  `credentials`, `price_signals`, `recommend`, `weakest`, `sources`, 50 words max each. Which competitors the assistant picks
  is part of the finding. (The 2026-11-08 test named three competitors for it, which was wrong: it steered the answer.)

Call path: the cloud hub (`AGY_WEB_CLOUD`), submit-and-poll (`POST /api/jobs`) so no HTTP request stays open long. The Gemini
model has built-in web search; the hub is the only route we have found that does.

**LLM wait policy** (project rule): a slow call is never killed and restarted. If a call has not answered after the lane's
"slow" mark, a second call for the same prompt goes to another worker and the first answer to arrive is used; the first
call keeps running. No lane time limit.

**No judge.** The owner's ruling (2026-11-08): the Gemini answer is the answer. No second model scores it, there are no
right / wrong / doesn't-know labels and no judge calls. The report shows what the assistant said, labelled as what it said,
with the raw text stored as evidence. This is what a customer who asks that assistant is told.

## 4. What goes in the report

- Every sentence cites stored evidence: the raw answer text is saved as evidence rows, so the existing quote check applies.
- Labels say exactly what was asked: "an AI assistant with web search", the date, the number of runs, and who it named.
  Never "AI doesn't recommend you". Example: "Asked for the best installers in Johor Bahru, it named Trexon, Solana Tec and
  Amiya, not Eternalgy (2 of 3 runs)."
- The spread across the 3 repeats is shown (for example the HQ unit number that changed).
- No "from memory" block and no "with / without search" comparison. Only answers from an assistant that searched.
- The "AI assistants" block, the brand-understanding section and the action plan read G-search instead (section 5b).
- Not-recommended results are reported as found. They are never hidden or reworded.

## 5. Cost and time (estimates from the tests, not measured on the hub)

- G-fixed is removed entirely: 67 LLM calls and about 340,000 tokens (37% of the dive's tokens) that produced nothing usable.
- Wall time about 2-3 minutes (the slowest of A, B or C, since the 9 calls run at once), against about 7 minutes for G-fixed.
- LLM tokens: no DeepSeek calls in this lane at all (G-fixed used about 340k tokens). The 9 Gemini calls draw on the 5 Google
  accounts' quota; the money cost is not known.
- Saved time buys prompt C and room for further prompts (more competitors, more questions).

## 5b. Everything that reads G-fixed today must read G-search (from the code, 2026-11-08)

- `divedeeper/sections/B-brand.ts:28` reads G-fixed answers for "what AI says it is and sells".
- `divedeeper/sections/S2-consult.ts:43,140` takes G-fixed and G-grounded findings into the consult.
- `divedeeper/editor.ts:14,165,166,184,185` lists both lanes under "understanding", builds the "Asked from memory" and "Asked
  with a web search" blocks, and finds the trade question and the "domain does not exist" finding.
- `divedeeper/report-html.ts:650` names the answer models on the page.
- The headline "understood N out of 100" comes from B-brand's coverage score, so it changes with B-brand's input.
With no judge, the readers also drop everything built on judge outcomes: the "N right / N wrong / N unknown" counts and the
"None of these is correct" line (`editor.ts` aiMode, `G-shared.ts` findingsFrom).
Build list: add the G-search lane; change these four readers to read it; delete G-fixed and G-grounded and their tests.
Change nothing else in the report.

## 6. Decisions for the owner

None open. Settled by the owner: G-fixed and G-grounded are deleted with this change; prompt C names no competitor; the
Gemini answer is the answer, with no judge.

## 7. Risks (open, none solved)

- ONE MODEL FAMILY. Gemini only. The owner's concern that one LLM is not enough stands. No other search-capable route is
  known; DeepSeek, Grok and the others on the vault's routes have no web search through their API (owner, 2026-11-08).
- Workers are unreliable: `masterkey` had its quota exhausted, `zhihong@eternalgy.me` timed out twice on 2026-11-05. The lane
  needs a spare worker and the second-call rule above.
- The `sources` list is the model's own claim. Some answers return opaque Google grounding redirects instead of page URLs.
- Answers differ between runs, so one run proves little: hence 3 repeats and showing the spread.
- A comparison from the model (prices, review counts) can be stale or wrong (it said "170+" Google reviews for Solana Tec;
  our Maps data says 204). It must not be printed as fact.

## 8. Proof plan (when the owner approves building)

The approach is already proven: the three live tests on the hub on 2026-11-08 (section 2) show that search answers are
accurate and quick. That proof is not repeated, and it does not hold up the deletion of the old lanes. What is left to
prove is only the new code: on the hub, on Eternalgy, run the G-search lane once and compare its report block with the
2026-11-07 report. A local fake test is not proof.

Failure paths made to fail on purpose, then shown live: a dead worker; a non-JSON reply; an answer over 50 words; a reply
missing a question id; all workers down (the lane must fail visibly, with the error, and not print empty text).

## Prompt merges and rechecks (2026-11-08, built, not yet run on the hub)

- Merged: C-merged reads the whole site in ONE call (was 1 per page plus 1 cross-page); S3 rewrites all findings in one call (was
  batches of 35); S2's website plan and FAQ share one call. S2's review replies stay separate on purpose: third-party review text
  is what trips the content filter, and one rude review must not take the website plan down. C-merged, S3 and the rechecks split a
  call that fails in half and ask again, because the filter can refuse a whole call over one phrase.
- S1-recheck (before S2): one prompt over the urgent and needs-work findings of the judging lanes (K, N, H-web, R-contacts, B-brand,
  C-merged copy-edit). Each is real, weak or false. editor.ts items() drops the false and lowers the weak. Mechanical lanes, register
  results and G-search are never sent.
- S6-check (after S5): one prompt over every statement S4 and S5 wrote, with the findings and measured facts as the only evidence.
  Unsupported statements are taken out when the report is built (check.ts applyCheck); a withdrawn task puts its findings back
  under its department.
- Guards for both: they only remove or lower; no answer changes nothing; "false" / "unsupported" needs a reason; a verdict set that
  condemns more than 40% (of 5 or more) is ignored with a warning.
