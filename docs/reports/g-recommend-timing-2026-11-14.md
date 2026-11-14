# Why G-recommend takes 30-50 minutes (run 768cb5f4, Solana Tec, 2026-11-14)

Source: production hub `/api/v21/deeper/768cb5f4-...` and myworker `/api/scans` (ChatGPT jobs), read-only at 03:49 UTC.
Times are UTC.

## Short answer

1. **It started 3 min 45 s late.** It waited for G-search (03:00:23 → 03:04:08) only to reuse G-search's
   "trade / town" profile. Removed in local code (see the end). That is the only waiting on other lanes.
2. **ChatGPT is asked one question at a time.** 6 questions x 2 copies = 12 ChatGPT prompts, sent one after another.
   Each normal answer takes about **3 minutes** (174-234 s). 12 x 3 min = **36 minutes at best**, even with no errors.
   Two ChatGPT PCs were connected, but there was never more than one prompt in flight.
3. **3 timeouts cost about 13 minutes.** Three prompts went to `pc-desktop-camhl16`, ran the full 240 s and failed with
   "ChatGPT web timed out after 240 s". Each was then sent again from scratch after a 20 s pause.
   myworker's `/api/workers` shows that PC as `live: false, chatBrowsers: null`, yet it was still given chat jobs.

Gemini (the other half) runs in parallel on the agy cloud hub workers. In the 13 Nov runs no single Gemini answer took
more than 4 min 37 s, so Gemini is not what makes the lane long. Its numbers for this run are saved only when the lane ends.

## The questions (the "find" questions do not name the company)

| id | Prompt sent to ChatGPT and Gemini (each "Please check the web for current information.") |
|---|---|
| best | Who are the best solar system installers in Johor Bahru? Please name specific companies. |
| hire | I live in Johor Bahru, Johor and I want to install a solar system on my property. Which companies should I contact? |
| top5 | I'm getting quotes from solar system installers in Johor Bahru. Give me your top 5 companies, ranked, with one reason for each. |
| trust | Which solar system installers in Johor have the best reputation? I want one I can trust. |
| rate | Rate Solana Tec Sdn Bhd in Johor Bahru as a solar system installer out of 10. Then rate its closest competitors out of 10 the same way, and explain the scores briefly. |
| pick | (names the company; asks whether the assistant would recommend it or another company) |

Each is asked 2 times per assistant (`repeat: 2`).

## ChatGPT timeline, this run (myworker job list)

| Created | Finished | Took | Question | Result | PC |
|---|---|---|---|---|---|
| 03:04:08 | 03:07:21 | 191 s | best #0 | done | mac-gans-mac-mini |
| 03:07:21 | 03:10:21 | 177 s | best #1 | done | mac-gans-mac-mini |
| 03:10:21 | 03:13:21 | 180 s | hire #0 | done | mac-gans-mac-mini |
| 03:13:21 | 03:16:21 | 180 s | hire #1 | done | mac-gans-mac-mini |
| 03:16:21 | 03:19:21 | 180 s | top5 #0 | done | mac-gans-mac-mini |
| 03:19:21 | 03:23:22 | 241 s | top5 #1 | **failed: ChatGPT web timed out after 240 s** | pc-desktop-camhl16 |
| 03:23:42 | 03:27:27 | 225 s | top5 #1 (try 2) | done | pc-desktop-camhl16 |
| 03:27:27 | 03:30:21 | 174 s | trust #0 | done | mac-gans-mac-mini |
| 03:30:21 | 03:34:21 | 241 s | trust #1 | **failed: timed out after 240 s** | pc-desktop-camhl16 |
| 03:34:41 | 03:38:42 | 241 s | trust #1 (try 2) | **failed: timed out after 240 s** | pc-desktop-camhl16 |
| 03:39:02 | 03:42:27 | 205 s | trust #1 (try 3) | done | pc-desktop-camhl16 |
| 03:42:27 | 03:46:21 | 234 s | rate #0 | done | mac-gans-mac-mini |
| 03:46:21 | (running) | | rate #1 | running | pc-desktop-camhl16 |
| | | | pick #0, pick #1 | not sent yet | |

Each job waited 0-3 s in the myworker queue, so the queue is not the delay. The time is ChatGPT answering, one at a time.

Expected end of G-recommend: about **03:56-03:58**, so about 53 minutes for the lane. The writing stages S1-S6 start after it.

## Where the ~53 minutes go

| Part | Minutes |
|---|---|
| Waiting for G-search before starting | 3.7 |
| 12 ChatGPT answers, one at a time (~3 min each) | ~37 |
| 3 timed-out tries (4 min each) + 20 s pauses | ~13 |
| **Total** | **~53** |

## Same pattern in the 13 Nov runs (from the saved lane rows)

| Run | Lane total | ChatGPT answers (sum) | ChatGPT failed tries | Error |
|---|---|---|---|---|
| 54e339be Fenice | 45 min | 9 answers, 29 min | 17 | no active ChatGPT tab connected to local worker |
| 05c510b4 Eternalgy | 48 min | 12 answers, 40 min | 15 | no active ChatGPT tab connected to local worker |
| 5ebdaa48 Eternalgy | 35 min | 11 answers, 32 min | 7 | no active ChatGPT tab connected to local worker |

Every ChatGPT answer took 117-232 s. Every run asked ChatGPT one prompt at a time.

## What would cut the time (not done; owner's call)

1. **Ask ChatGPT on every connected ChatGPT PC at once**, like Gemini already does on every hub worker.
   With 2 PCs: about 37 → 19 minutes. With 3 PCs: about 13.
2. **myworker: give a chat job only to a PC whose ChatGPT tab is working.** This run lost ~13 min to
   `pc-desktop-camhl16` (reported `live: false`); 13 Nov lost many tries to "no active ChatGPT tab".
3. **The 240 s timeout then resend from scratch breaks the LLM wait rule** (race a second call, never kill and restart).
   A slow answer (230 s is normal here) should keep running while a second PC gets the same prompt; first answer wins.

## Changed in local code (not committed, not pushed, not deployed)

`agy-lab/src/divedeeper/v21/run.ts`: G-recommend no longer waits for G-search; it is first in the lane list and starts at
0:00. Its profile (trade, town, job) is built from the preview rows with one quick LLM call when no saved one exists.
`run.test.ts` updated to the new start order: 11 of 11 tests pass.
This only removes the 3.7 min wait. Points 1-3 above are what remove the rest.
