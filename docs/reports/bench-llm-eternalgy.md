# Step 3 benchmark: gpt-6.1-terra (high) vs deepseek v4.1 on Vectide (high)

Run on the hub, 2026-11-13, bench `d6fdacce-3f3e-4fc6-a988-33d1591806f4`. Test only; nothing here reached a report.
Raw data, with both full answers per call: [bench-llm-eternalgy-raw.json](bench-llm-eternalgy-raw.json).

**Setup.** One company (Eternalgy Sdn Bhd, report 8ded6f62). The real Step 3 prompt (`step3-v4`, rebuilt from the stored
Step 2 result). Both models fired in the same instant, reasoning effort `high`, temperature 0.1, JSON mode, streamed,
one lane each, no retry. 2 rounds. Each answer was scored by Step 3's own code (the same check production runs).

## Speed

| Round | gpt-6.1-terra | deepseek v4.1 (Vectide) |
|---|---|---|
| 1 | **10.3 s** (first answer text at 4.6 s) | 32.7 s (first answer text at 26.1 s) |
| 2 | **9.3 s** (first answer text at 3.6 s) | 64.4 s (first answer text at 60.7 s) |

- Terra is 3x to 7x faster here and steady (10.3 vs 9.3 s). Deepseek doubled between rounds (33 s to 64 s).
- Deepseek thinks first (reasoning text at 3 s and 13 s, answer only at 26 s and 61 s) and wrote 4,941 and 12,173
  output tokens, mostly reasoning. Terra wrote about 1,200 tokens each time and streams no reasoning text.
- Neither call came near the 8-minute dead line.

## Quality, as Step 3's own check scored it

| | terra R1 | terra R2 | deepseek R1 | deepseek R2 |
|---|---|---|---|---|
| Summary sentences kept / written | 3 / 3 | 3 / 3 | 3 / 3 | 3 / 3 |
| Email body kept / written | 2 / 2 | 2 / 2 | 3 / 3 | **2 / 3** |
| Titles kept / written | 24 / 24 | 24 / 24 | **24 / 25** | 24 / 24 |
| Subject kept | yes | yes | yes | yes |
| Proof item picked (valid) | f4 | f4 | f3 | f3 |
| Rejected by the check | 0 | 0 | 1 | 1 |

- Deepseek's two rejections: round 1 wrote a title for an id that does not exist (f11); round 2 put a number ("3") in
  email paragraph 2 that is not in the cited items, so that paragraph was dropped. Terra had none in two rounds.
- Both models stayed inside the rules in what the check can see: ids cited, no values, no fixes, no full-report talk.

## What reads differently (my reading; not reviewed by you)

- **Deepseek writes richer copy.** Three email paragraphs, it sets the strength against the problem ("your incorporation
  details check out independently and your Google rating is strong, which is exactly why these gaps cost you"), and its
  sentences differ between summary and email.
- **Terra is plainer and repeats itself.** Its summary and its email say nearly the same two things in nearly the same words
  (grade differs, broken phone field). Correct and checkable, but less persuasive writing.
- **They pick a different proof item.** Terra picks f4 (the broken phone field, a one-minute check). Deepseek picks f3 (empty
  contractor portfolio against a long track record on the site). Which is the better proof item is your call.
- Both wrote all 24 titles at the right length with the consequence in them and no values.

## Limits of this bench

- One company, one prompt, 2 rounds. Deepseek's time doubled between rounds, so 2 samples do not give a typical speed.
  Quality differences of 1 rejection are small samples too.
- The prompt is the same text for both, but token counts differ (terra 7,886 in, deepseek 6,478 in) because the models count
  differently. Cost was not measured.
- Production Step 3 today calls without a reasoning effort and without streaming; this bench used `high` and streaming on both,
  as you asked, so deepseek's 33 to 64 s is not what production sees today.
- Writing quality is my reading of the text. Step 3's check only tests rule compliance.

## Not done

Nothing is wired into production. To use terra for Step 3, it would need to become a lane (chat-completions works on
lingsuan) and Step 3 would need to send the effort; the key lives only in the hub variable `BENCH_LINGSUAN_KEY`.
