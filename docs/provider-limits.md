# Provider limits

**T4, 2026-11-02. Status: researched, not yet confirmed by the owner.** Drafted by agy (gemini-3.8-flash-high), every claim fact-checked against the provider's own page by codex (gpt-6.1-terra; 40 of 89 first-draft claims held), rewritten to keep only confirmed numbers; Smartlead re-checked by Claude. Every number links its source. Code defaults do not establish deployed values. A concurrency slot is not a request rate.

## Vectide

**Our setting.** An awake `first` lane bypasses the busy limit. Other lanes default to 3 concurrent calls per key; `LLM_LANE_CONCURRENCY` can change that. Lane classification comes from configuration, not necessarily the provider plan (`agy-lab/src/core/llm.ts:54`, `agy-lab/src/core/llm.ts:218`, `agy-lab/src/core/llm.ts:226`).

**Documented limit.** Paid CodingPlan windows reset at 00:00, 05:00, 10:00, 15:00 and 20:00; a weekly limit also applies. Free and team plans differ ([purchase page](https://vectide.cn/purchase.html)). A team example lists 20 concurrent requests and 60 RPM, with configurable additions; it is not a universal limit ([team page](https://vectide.cn/team.html)). The actual quota and scope are not documented in the checked sources (owner must confirm the plan and key scope).

**Signal and response.** The code checks HTTP 429 and rests a first lane for 10 seconds and other lanes for 60 seconds (`agy-lab/src/core/llm.ts:52`, `agy-lab/src/core/llm.ts:217`, `agy-lab/src/core/llm.ts:295`, `agy-lab/src/core/llm.ts:341`). Provider headers and quota signals are not documented in the checked sources (owner must confirm them).

**Owner must confirm.** Active plan, quota amounts, reset timezone, concurrency, and scope across keys.

**Gap.** The first lane has no busy cap. The internal checklist reports about 100 Vectide 429 responses (`must-fix-checklist.md:292`). It does not establish their cause.

## The Hive

**Our setting.** The default is 3 concurrent calls per lane/key, configurable with `LLM_LANE_CONCURRENCY`. The URL and model are also environment-configurable defaults (`agy-lab/src/core/llm.ts:50`, `agy-lab/src/core/llm.ts:54`, `agy-lab/src/core/llm.ts:73`).

**Documented limit.** The default is 5 requests per second ([Hive chat documentation](https://docs.thehive.ai/docs/chat-completions-openai-compatible-llms)). Its scope and any separate concurrency limit are not documented in the checked source (owner must confirm them).

**Signal and response.** The client checks HTTP 429 and rests a non-first lane for 60 seconds; it does not read rate-limit headers (`agy-lab/src/core/llm.ts:52`, `agy-lab/src/core/llm.ts:217`, `agy-lab/src/core/llm.ts:295`, `agy-lab/src/core/llm.ts:341`). Provider signalling details are not documented in the checked source (owner must confirm them).

**Owner must confirm.** Active keys, account limits, credit balance, and signal details.

**Gap.** Slots do not enforce requests per second. The checklist reports dropped connections and idle stalls; this is an internal report, not independent log verification (`must-fix-checklist.md:314`, `agy-lab/src/core/idle.ts:1`).

## ZM_AI

**Our setting.** When configured as a fallback, ZM_AI maps to `gpt-6.1-sol`. The normal lane default is 3 concurrent calls per key, configurable with `LLM_LANE_CONCURRENCY`; a first lane uses different selection rules (`agy-lab/src/core/llm.ts:54`, `agy-lab/src/core/llm.ts:73`, `agy-lab/src/core/llm.ts:83`, `agy-lab/src/core/llm.ts:226`).

**Documented limit.** Not documented (owner must confirm the gateway, provider and limits).

**Signal and response.** The generic client checks HTTP 429 and rests the lane (`agy-lab/src/core/llm.ts:217`, `agy-lab/src/core/llm.ts:295`, `agy-lab/src/core/llm.ts:341`). Gateway signalling is not documented (owner must confirm it).

**Owner must confirm.** Gateway identity, deployment use, limits and signals.

**Gap.** The provider and effective limits are unknown.

## MiniMax

**Our setting.** Pi defaults to 6 concurrent calls, configurable through `PI_MAX_CONCURRENT`; the slot guard enforces that value (`agy-lab/src/core/pi.ts:37`, `agy-lab/src/core/pi.ts:304`). The model is configurable and defaults to `MiniMax-M3.1-Flash-Preview` (`agy-lab/src/core/pi.ts:25`).

**Documented limit.** The standard LLM table lists 200 RPM and 10,000,000 tokens per minute for MiniMax-M3.1-Flash and MiniMax-M3 ([rate limits](https://platform.minimax.io/docs/guides/rate-limits)). The Coding Plan describes 5-hour rolling and weekly windows, and approximate peak guidance of 3–4 agents for Plus, 4–5 for Max, and 6–7 for Ultra. These are not hard API concurrency limits ([Coding Plan](https://platform.minimax.io/subscribe/coding-plan?code=CXWzfLSdF5&source=link)).

**Signal and response.** Provider error codes are not documented in the checked sources (owner must confirm them). Pi classifies messages matching 429, rate limit or quota terms as `rate_limit` (`agy-lab/src/core/pi.ts:260`). Fallback failure is recorded and outer-round waits apply; it does not rest an LLM lane (`agy-lab/src/core/llm.ts:401`, `agy-lab/src/core/llm.ts:414`).

**Owner must confirm.** Active plan, model-specific limits, quota amounts and error signals.

**Gap.** The configured slot count and approximate agent guidance measure different things. Their relationship for this account is unknown.

## Tavily

**Our setting.** The normal pool uses 2 concurrent requests per key. Usage refresh is demand-driven: a 10-minute stale threshold and a 15-minute error retry threshold apply (`agy-lab/src/core/tavily.ts:37`, `agy-lab/src/core/tavily.ts:40`, `agy-lab/src/core/tavily.ts:46`, `agy-lab/src/core/tavily.ts:210`).

**Documented limit.** Development is 100 RPM and production is 1,000 RPM; Crawl is 100 RPM in both ([rate limits](https://help.tavily.com/articles/3240802908-rate-limits)). Research and usage endpoint limits are not documented in the checked sources (owner must confirm them). Researcher includes 1,000 credits/month; the displayed Project default includes 4,000 credits/month for $30/month; pay-as-you-go is $0.008 per credit ([pricing](https://tavily.com/pricing)).

**Signal and response.** The code treats 429 as rate limiting and 432/433 as quota conditions. The normal pool rests a rate-limited key for 60 seconds and flags quota; proxy paths can differ (`agy-lab/src/core/tavily.ts:326`, `agy-lab/src/core/tavily.ts:345`, `agy-lab/src/core/tavily.ts:415`). It does not read provider `Retry-After` in the normal client. Provider header details are not documented in the checked sources (owner must confirm them).

**Owner must confirm.** Key environments, account plan, usage endpoint limit and scope, and actual key count.

**Gap.** Per-key slots do not enforce RPM. A code comment reports `/usage` returned 429 for every key; it does not establish why (`agy-lab/src/core/tavily.ts:43`).

## Exa

**Our setting.** The normal pool uses 2 slots per key, a 60-second rate-limit cooldown and a 1-hour cooldown for refused or spent keys (`agy-lab/src/core/exa.ts:16`, `agy-lab/src/core/exa.ts:19`, `agy-lab/src/core/exa.ts:24`, `agy-lab/src/core/exa.ts:177`, `agy-lab/src/core/exa.ts:243`).

**Documented limit.** Free includes 10 Search queries per second and 50 agent concurrency. Enterprise offers custom Search QPS and agent concurrency. Free includes $10 in monthly credits and a $10 onboarding bonus ([pricing](https://exa.ai/pricing)). Rate scope across keys and other endpoint limits are not documented in the checked sources (owner must confirm them).

**Signal and response.** The code classifies 429 as rate limiting and 401/402/403 as quota or refusal; normal-pool cooldowns are fixed (`agy-lab/src/core/exa.ts:177`, `agy-lab/src/core/exa.ts:243`). Provider header details are not documented in the checked sources (owner must confirm them).

**Owner must confirm.** Plan, Search and endpoint limits, key ownership, cross-key scope, and actual key count.

**Gap.** Slots per key do not enforce Search QPS. The checklist reports 20 US keys, but does not verify the current count or common ownership (`must-fix-checklist.md:295`).

## Brave Search

**Our setting.** The client attempts 100 ms spacing, but concurrent callers can race; this is not a strict global rate bound (`agy-lab/src/core/brave.ts:20`, `agy-lab/src/core/brave.ts:49`).

**Documented limit.** Search lists 50 queries per second and Answers lists 2 queries per second ([Brave Search API](https://brave.com/search/api/)). A current free-plan rate is not documented in the checked sources (owner must confirm the subscription). The Search plan has a $5 monthly credit and a $5 per 1,000 query price ([help](https://api-dashboard.search.brave.com/documentation/resources/help-feedback), [pricing](https://brave.com/search/api/)).

**Signal and response.** The code rotates keys on HTTP 429 or 402 and does not use rate-limit headers (`agy-lab/src/core/brave.ts:89`, `agy-lab/src/core/brave.ts:102`). Provider signal details are not documented in the checked sources (owner must confirm them).

**Owner must confirm.** Active plans, assigned rates and current keys.

**Gap.** Actual throughput and the effective key limits are unknown. The checklist reports two keys, not a verified live count (`must-fix-checklist.md:296`).

## Google PageSpeed Insights

**Our setting.** This client has a 180-second timeout and no local concurrency cap. It retries once after 10 seconds on 429 or 5xx (`agy-lab/src/core/pagespeed.ts:13`, `agy-lab/src/core/pagespeed.ts:52`, `agy-lab/src/core/pagespeed.ts:60`).

**Documented limit.** Project request and credit quotas are not documented in the checked source (owner must confirm the Cloud Console quotas).

**Signal and response.** The client checks 429 and 5xx; it does not use rate-limit headers (`agy-lab/src/core/pagespeed.ts:52`, `agy-lab/src/core/pagespeed.ts:60`). Provider signalling details are not documented in the checked source (owner must confirm them).

**Owner must confirm.** Project quotas and error signals.

**Gap.** The client does not pace requests against the project's actual quota.

## Parallel AI

**Our setting.** Entity Search defaults to a 90-second timeout, overridable per call. This client has no local concurrency cap or retry (`agy-lab/src/core/parallel.ts:8`, `agy-lab/src/core/parallel.ts:18`, `agy-lab/src/core/parallel.ts:20`).

**Documented limit.** Entity Search has a default quota of 600 POSTs per minute. The rate-limit page lists 300 FindAll generator runs per hour; GET requests do not count against the listed resource-creation quotas ([rate limits](https://docs.parallel.ai/getting-started/rate-limits)). The [pricing page](https://parallel.ai/pricing) lists 25 Find All per hour, so the applicable figure needs clarification. Scope and Entity Search credit quota are not documented in the checked sources (owner must confirm them).

**Signal and response.** The client throws on any non-2xx response, including 429, without a specific retry or header handling (`agy-lab/src/core/parallel.ts:20`). Provider signalling details are not documented in the checked sources (owner must confirm them).

**Owner must confirm.** Account limits, the FindAll page discrepancy, scope and balance.

**Gap.** No local pacing or retry is present; actual request volume is unknown.

## Smartlead

**Our setting.** A serialized queue spaces calls by at least 220 ms. On 429 it retries up to 5 times, with waits of 2, 4, 6, 8 and 10 seconds (`agy-lab/src/core/smartlead.ts:11`, `agy-lab/src/core/smartlead.ts:28`, `agy-lab/src/core/smartlead.ts:50`).

**Documented limit.** Standard is 60 requests/minute, 1,000/hour and a 10/second burst. Pro is 120/minute, 3,000/hour and a 20/second burst. Plan-wide limits are per API key. Three specified heavy endpoints have a 10 requests per 60 seconds limit per account ([rate-limit guide](https://api.smartlead.ai/guides/rate-limits)). Credit quotas are not documented in the checked source (owner must confirm any applicable quota).

**Signal and response.** The code checks HTTP 429 and uses fixed waits rather than reading retry headers or the response's retry value (`agy-lab/src/core/smartlead.ts:43`, `agy-lab/src/core/smartlead.ts:50`). Provider examples and endpoint-specific headers may differ ([rate-limit guide](https://api.smartlead.ai/guides/rate-limits)).

**Owner must confirm.** Active plan, key limits, endpoints used and any custom limits.

**Gap.** The queue does not enforce the documented minute, hour or endpoint windows. Actual traffic determines whether those windows are reached.

## Google Maps workers

**Our setting.** The sweep has a default maximum of 200 places, rather than a proven universal cap (`agy-lab/src/gmap-sweep.ts:15`, `agy-lab/src/gmap-sweep.ts:41`).

**Documented limit.** A fixed consumer Maps result or automation limit is not documented in the checked source (owner must confirm applicable limits).

**Signal and response.** Provider signals and the worker's handling are not established by the checked evidence (owner must confirm them).

**Owner must confirm.** Active workers, external IPs, applicable limits and block handling.

**Gap.** The checklist reports one scan per worker and two workers, but does not verify the live deployment or establish safe bounds (`must-fix-checklist.md:297`).

## Fetch workers

**Our setting.** Inputs are deduplicated and limited to 20 URLs per batch. The default batch timeout is 60 seconds plus 15 seconds per URL, capped at 600 seconds; a caller can override it. Worker liveness uses 90 seconds (`agy-lab/src/pagefetch.ts:30`, `agy-lab/src/pagefetch.ts:32`, `agy-lab/src/pagefetch.ts:67`, `agy-lab/src/pagefetch.ts:103`, `agy-lab/src/pagefetch.ts:111`).

**Documented limit.** Destination-specific request and credit limits are not documented (owner must confirm them for relevant sites).

**Signal and response.** Individual page failures are retained in `failed_results`; a missing lane, worker failure or batch timeout can fail the batch (`agy-lab/src/pagefetch.ts:87`, `agy-lab/src/pagefetch.ts:115`). Destination signals vary and are not documented in the checked evidence (owner must confirm relevant signals).

**Owner must confirm.** Active workers and destination-specific limits and signals.

**Gap.** The batch size does not establish that destinations will accept the traffic.

## Summary

Rates, concurrent slots and quotas are separate measures. Provider values apply only to the stated plan or example.

| Provider | Request rates | Concurrent slots or guidance | Credit or usage quotas |
|---|---|---|---|
| Vectide | Team example: 60 RPM ([source](https://vectide.cn/team.html)) | Team example: 20; our non-first default: 3, configurable (`agy-lab/src/core/llm.ts:54`) | Paid fixed reset windows and weekly limit; amounts unknown ([source](https://vectide.cn/purchase.html)) |
| Hive | Default 5/second ([source](https://docs.thehive.ai/docs/chat-completions-openai-compatible-llms)) | Our default: 3/lane, configurable (`agy-lab/src/core/llm.ts:54`) | Not documented (owner must confirm) |
| ZM_AI | Not documented (owner must confirm) | Our default: 3/lane, configurable (`agy-lab/src/core/llm.ts:54`) | Not documented (owner must confirm) |
| MiniMax | Listed models: 200 RPM and 10 million tokens/minute ([source](https://platform.minimax.io/docs/guides/rate-limits)) | Our default: 6, configurable (`agy-lab/src/core/pi.ts:37`); approximate agent guidance varies by tier ([source](https://platform.minimax.io/subscribe/coding-plan?code=CXWzfLSdF5&source=link)) | 5-hour rolling and weekly windows; amounts unknown ([source](https://platform.minimax.io/subscribe/coding-plan?code=CXWzfLSdF5&source=link)) |
| Tavily | Development 100 RPM; production 1,000 RPM; Crawl 100 RPM ([source](https://help.tavily.com/articles/3240802908-rate-limits)) | Our normal pool: 2/key (`agy-lab/src/core/tavily.ts:37`) | Researcher 1,000/month; Project default 4,000/month ([source](https://tavily.com/pricing)) |
| Exa | Free Search 10 QPS ([source](https://exa.ai/pricing)) | Free: 50 agent concurrency ([source](https://exa.ai/pricing)); our pool: 2/key (`agy-lab/src/core/exa.ts:16`) | Free: $10/month plus $10 onboarding ([source](https://exa.ai/pricing)) |
| Brave | Search 50 QPS; Answers 2 QPS ([source](https://brave.com/search/api/)) | Not documented (owner must confirm) | Search $5 monthly credit ([source](https://api-dashboard.search.brave.com/documentation/resources/help-feedback)) |
| PageSpeed | Not documented (owner must confirm project quota) | No local cap (`agy-lab/src/core/pagespeed.ts:52`) | Not documented (owner must confirm) |
| Parallel | Entity Search 600/min; FindAll 300/hour, conflicting with pricing's 25/hour ([limits](https://docs.parallel.ai/getting-started/rate-limits), [pricing](https://parallel.ai/pricing)) | No local cap (`agy-lab/src/core/parallel.ts:8`) | Not documented (owner must confirm) |
| Smartlead | Standard 60/min, 1,000/hour, burst 10/second; Pro 120/min, 3,000/hour, burst 20/second; specified endpoints 10/60 seconds ([source](https://api.smartlead.ai/guides/rate-limits)) | Serialized client queue (`agy-lab/src/core/smartlead.ts:28`) | Not documented (owner must confirm) |
| Maps workers | Not documented (owner must confirm) | Live worker count unverified (`must-fix-checklist.md:297`) | Not documented (owner must confirm) |
| Fetch workers | Destination-specific; not documented (owner must confirm) | Live worker count unverified | Batch input maximum 20 URLs, a code setting, not a provider quota (`agy-lab/src/pagefetch.ts:30`) |

## Owner must confirm

- Active plans, deployed settings, keys, account scope and balances for each provider.
- Actual request, concurrency and quota limits, reset times and signals, including Tavily usage and Exa cross-key scope.
- Parallel's conflicting FindAll limits; PageSpeed project quotas; ZM_AI identity and deployment.
- Active Maps and fetch workers, relevant destination limits and block handling.
