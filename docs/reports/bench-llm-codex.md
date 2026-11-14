# gpt-6.1-terra (high) through the Codex CLI service vs direct on lingsuan

Run 2026-11-13. Only the Codex service (`codex-lab-production.up.railway.app`) was called; the comparison figures are the
earlier hub bench ([bench-llm-eternalgy.md](bench-llm-eternalgy.md)), not re-run. Raw data: [bench-llm-codex-raw.json](bench-llm-codex-raw.json).

**Setup.** The same Eternalgy Step 3 prompt (`step3-v4`, rebuilt from the same stored Step 2 result), system and user text sent as one
prompt, model `gpt-6.1-terra`, effort `high`, 2 rounds one after the other. Scored by Step 3's own check, as before.
The Codex call has no streaming, so there is no time-to-first-token figure.

## Speed

| | Codex service | direct, lingsuan (earlier bench) |
|---|---|---|
| Round 1 | **28.3 s** (service 27.3 s) | 10.3 s |
| Round 2 | **25.6 s** (service 25.1 s) | 9.3 s |

Through Codex the same model is about 2.7x slower than the direct call. The service itself spends nearly all of that time; the
network adds about 1 s.

## Tokens

| | Codex | direct |
|---|---|---|
| Input | 21,833 / 21,835 (12,032 and 14,720 cached) | 7,886 |
| Output | 1,285 / 1,222 (reasoning part reported: 124 / 106) | 1,206 / 1,237 |

Codex sends about 14,000 more input tokens than the direct call: its own agent instructions around the prompt. Part of that is
cached. The output is the same size, so Codex is not writing more.

## Quality, as Step 3's own check scored it

| | Codex R1 | Codex R2 | direct R1 | direct R2 |
|---|---|---|---|---|
| Summary kept / written | 3 / 3 | 3 / 3 | 3 / 3 | 3 / 3 |
| Email body kept / written | 2 / 2 | 2 / 2 | 2 / 2 | 2 / 2 |
| Titles kept / written | 24 / 24 | 24 / 24 | 24 / 24 | 24 / 24 |
| Rejected | 0 | 0 | 0 | 0 |
| Proof item picked | f1 | f4 | f4 | f4 |

- The check finds no difference. Zero rejected in all 4 calls.
- Wording (my reading, not reviewed by you): same plain style as direct terra, with the same habit of repeating the summary's points
  in the email. Round 1 led with the expiring email domain (f1) and chose it as the proof item; round 2 led with the contractor grade and
  picked f4, the same as direct terra both times. So Codex varied its lead between rounds; direct terra did not.

## Limits

One company, 2 rounds, one prompt. The direct figures come from a different run an hour earlier, not fired at the same moment. Whether
Codex's extra time is its agent wrapper or the subscription route is not something this test can tell.
