# gpt-6.1-sol latency and time-to-first-token: Vectide token plan vs lingsuan

Run on the hub, 2026-11-13, bench `05668d61-2bed-4fb4-84d5-634af6ad7a68`. Test only; nothing reached a report.
Raw data with every answer: [bench-llm-sol-raw.json](bench-llm-sol-raw.json). Earlier terra vs deepseek run: [bench-llm-eternalgy.md](bench-llm-eternalgy.md).

**Setup.** Same real Step 3 prompt (Eternalgy, report 8ded6f62) to the same model, `gpt-6.1-sol`, on two providers, fired in
the same instant, effort `high`, temperature 0.1, JSON mode, streamed, no retry. 3 rounds.

## Speed (seconds)

| Round | Vectide token plan: total | first byte | first answer text | lingsuan: total | first byte | first answer text |
|---|---|---|---|---|---|---|
| 1 | 112.7 | 15.9 | 93.9 | 74.5 | 3.5 | 64.2 |
| 2 | 79.8 | 21.9 | 78.8 | 67.1 | 2.7 | 54.9 |
| 3 | 61.1 | 14.3 | 47.3 | 72.8 | 3.8 | 63.0 |
| **average** | **84.5** | **17.4** | **73.3** | **71.5** | **3.3** | **60.7** |

- **First byte** (the server starts answering): lingsuan about 3 s, Vectide 14 to 22 s. Vectide is about 5x slower to start, every round.
- **First answer text** (what TTFT means for a writing call): 47 to 94 s on Vectide, 55 to 64 s on lingsuan. Sol thinks for most of the call on
  both; reasoning text starts streaming at 13 to 77 s, so it is not a quick-start model at `high`.
- **Total:** lingsuan steady at 67 to 75 s. Vectide 61 to 113 s, falling each round (112.7, 79.8, 61.1), so it varies a lot.
- Neither call came near the 8-minute dead line.

## Quality, as Step 3's own check scored it

All 6 calls: 0 rejected, 24 of 24 titles kept, email body 2 of 2 kept, summary 2 or 3 sentences all kept, proof item f4 every time.
I did not read the wording of these answers; this is the rule check only.

## Other numbers

- Vectide counted 10,805 input tokens for the same prompt that lingsuan counted as 7,886: about 2,900 more, which suggests Vectide
  adds hidden text to the request. A bare "Say OK" call on Vectide counted 4,393 input tokens and took 25.5 s to first byte.
- Output tokens: Vectide 2,160 to 4,862, lingsuan 2,444 to 2,633.

## Against the earlier bench (same prompt, different runs)

| Model | Total time |
|---|---|
| gpt-6.1-terra (lingsuan) | 9 to 10 s |
| deepseek v4.1 (Vectide) | 33 to 64 s |
| gpt-6.1-sol (lingsuan) | 67 to 75 s |
| gpt-6.1-sol (Vectide token plan) | 61 to 113 s |

Sol is the slowest of the four on this prompt. Those earlier rows were separate runs, not fired together with sol.

## Limits

One company, one prompt, 3 rounds. Vectide's spread (61 to 113 s) means 3 samples do not give a typical figure. Cost not measured.
