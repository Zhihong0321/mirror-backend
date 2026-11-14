# Preview run analysis: wuuustudio.com (Malaysia, General business)

Report `ca01f3a2-38d5-4359-9234-772787bbd43d`, the hub's latest completed preview run (all steps `done`).
Source: hub `GET /api/v21/report/{id}` and its raw rows (read-only). Times UTC, 2026-11-14. Total wall clock **11 m 50 s**.
Prices come from the repo's own table, `agy-lab/src/cost.ts`.

## Per step: time, API used, tokens, cost

| Step | Time | API / service used | Tokens in / out | Cost |
|---|---|---|---|---|
| **1 Research** | 29.5 s | **Brave Search** (4 queries: brand, reviews, employee reviews, news); **Tavily** (1 query: "official website"); **Google Maps worker** (PC `pc-desktop-camhl16`, place lookup); **site-lookup workers** (4 catalog probes, PC `pc-desktop-tt6vuah`); **fetch worker** (own site 2 pages + 11 outside pages). No LLM. | 0 / 0 | Brave 4 x $0.005 = **$0.020**; Tavily 1 call = **$0.008** (assumes 1 credit, credits not recorded); workers $0 |
| **1.5 Assets** | 189.7 s | **Google PageSpeed Insights** (2 runs, mobile + desktop, vault service account); **RDAP / WHOIS / DNS** (domain checks, free); **local site audit worker** (SEO + GEO, PC `pc-desktop-tt6vuah`); **global handlers** (crt.sh, DNS, SSL) on PC `pc-desktop-camhl16`; **MY handlers** on Mac mini `mac-gans-mac-mini`; **Google Maps worker** (reviews, 12 calls). No LLM. | 0 / 0 | **$0** (all free or our own workers) |
| **1.6 People** | about 103 s (start inferred) | **Fetch worker** (own-site llms.txt, 404). Names read from Step 1 pages. No search API, no LLM. | 0 / 0 | **$0** |
| **2a Tidy** | under 1 s | none | 0 / 0 | $0 |
| **2b Judge** | 320.9 s | **LLM: deepseek-v4.1-flash via Hive account 1** (`api.thehive.ai`), won the race. Before it: Vectide plan 2 refused (429 weekly limit), Vectide plan 1 returned an empty answer after 212.8 s, Hive account 2 started late and was aborted. | 18,265 / 25,733 (reasoning 19,304) | **Unpriced**: Hive has no price on record in `cost.ts`, so not guessed |
| **2c Recheck** | 146.5 s | **LLM: deepseek-v4.1-flash via Vectide plan 1** (`vectide.cn`) | 24,521 / 29,311 (reasoning 26,227) | 53,832 tokens x $0.0139 per 1M = **$0.00075** |
| **3 Report + email** | 22.9 s | **LLM: deepseek-v4.1-flash via Vectide plan 1** | 5,706 / 4,356 (reasoning 3,252) | 10,062 tokens = **$0.00014** |

**Calls per LLM step** (from each row's `meta.attempts` and `stats.llm_calls`): Judge = 1 request sent to 4 lanes (4 API calls, 1 finished: Vectide 2 refused in 0.3 s, Vectide 1 empty after 212.8 s, Hive 1 won in 140.6 s, Hive 2 aborted after 108.1 s). Recheck = 1 API call. Step 3 = 1 API call. Whole run: 6 LLM API calls, 3 finished.

Vectide rate: CNY 100 per 1,000M tokens at 7.2 CNY/USD = $0.0139 per 1M tokens, input and output alike (our 1B-token pack).

## Totals

- Time: 11 m 50 s. Judge + recheck = 66% of it.
- LLM tokens: 48,492 in, 59,400 out, 107,892 total (all deepseek-v4.1-flash; 44k on Hive, 64k on Vectide). Reasoning is 82% of output. No cache hits.
- Priced cost: about **$0.029** (Brave $0.020 + Tavily $0.008 + Vectide LLM $0.0009). **Plus the judge's 43,998 Hive tokens, unpriced.** Everything else is $0.
- Not counted: the judge's failed attempts (Vectide plan 1 empty answer, Hive account 2 aborted). Usage was not recorded, so the token totals are a floor.

## What stands out

1. The judge lost about 3.5 minutes to dead calls. Vectide plan 2 hit its weekly limit; Vectide plan 1 spent 212.8 s on an empty answer; the race call (Hive 1) started near 180 s and won at 320.9 s. Without the empty answer the judge sits near 140 s.
2. The only paid APIs in the run are Brave, Tavily and the LLM lanes. Money is under 3 cents; the cost is time.
3. Step 1 is fast and nearly free. 6 of 11 outside pages came back empty (zoominfo, rocketreach, facebook): wasted reads, not money.
4. The Hive price is the one real gap: the largest LLM call has no price on record.
