# core: the app's one door to outside APIs

Every call this hub makes to an LLM, a search API or a paid data API goes through
`src/core/`. Features (company-dive, dive-deeper, contact research, email replies,
the gateway, the Maps worker, the key health page) import `src/core/index.ts` and
nothing else of this folder. Nothing outside `src/core/` sends a request to one of
these services itself.

`core-door.test.ts` enforces it: the build fails when a file outside `src/core/`
names one of these API hosts, opens `/chat/completions`, or imports a core module
other than `index.ts`.

## Why

Until 2026-10-31 each feature had its own client. The deepseek lanes on /workers
took turns only inside contact research; company-dive used the first lane alone
and dive-deeper one fixed Vectide key, so one busy lane sent everything to MiniMax
while four paid lanes sat idle. One router, one rule set, one log fixes that for
every feature at once, and a fix made here reaches all of them.

## What is here

| Module | Service | Keys come from |
|---|---|---|
| `llm.ts` | every LLM call | the `llm_lane` table, edited on /workers (`/api/llm-lanes`); `CONTACT_LLM_*` only when the table is empty |
| `pi.ts` | MiniMax through the Pi agent SDK (the last-resort engine, and the agent with web tools) | `secrets.ts` (kind `minimax`) |
| `tavily.ts` | Tavily search and map (extract and crawl are refused: pages are read by the fetch workers, `../pagefetch.ts`) | `gemini_contact_key` (kind `tavily`), edited on /auto-queue |
| `exa.ts` | Exa search and contents | `gemini_contact_key` (kind `exa`), plus the US proxy as one source (`proxy.ts`) |
| `search.ts` | web search for pipelines: Tavily and Exa, turns between them, key rotation and provider fallback inside | the two pools above |
| `proxy.ts` | the US proxy (G:\exa-api-proxy), which holds its own Exa and Tavily keys | `gemini_contact_key` (kind `exa_proxy`: url and token) |
| `brave.ts` | Brave Search | `gemini_contact_key` (kind `brave`), edited on /workers |
| `maps.ts` | scraper.tech Google Maps tools | `secrets.ts` (kind `scraper_tech`) |
| `pagespeed.ts` | Google PageSpeed Insights | `secrets.ts` (kind `pagespeed`) |
| `parallel.ts` | Parallel's FindAll entity search (person research) | `secrets.ts` (kind `parallel`) |
| `smartlead.ts` | Smartlead, the cold-email platform | `secrets.ts` (kind `smartlead`) |

`secrets.ts` holds the one-key providers' keys (`gemini_contact_key`, edited on
/workers under "Other API keys"). Every module falls back to its Railway variable
when the database has nothing, and then to the local vault (`vault.ts`), which
only a dev machine has.

Free, keyless lookups (a company's own web pages, WHOIS, RDAP, DNS, crt.sh,
LanguageTool's public API) stay in the lanes that use them. They are not
services we hold keys or pay for, and they are logged through the lane's
`ctx.call` all the same.

## The LLM router rules (`llm.ts`)

1. **One pool.** A call asks for a model family (deepseek unless it says
   otherwise) and may use every enabled lane serving it: today the Vectide coding
   plan, the Vectide token plan and three Hive accounts.
2. **Order.** Lanes marked "use first" (the Vectide 5-hour coding plan, whose
   quota does not carry over) take every call, however many run at once. The
   other lanes serve only while it rests after a 429, or when it failed that
   call; they take turns, starting one further along with each call.
3. **Parallel.** Any other lane serves at most `LLM_LANE_CONCURRENCY` calls at
   once (3). A call takes the first lane in its order with a free slot.
4. **429.** The lane rests (a minute; a "use first" lane 10s) and the call
   moves to the next lane at once. Any other failure (5xx, HTTP 400, an empty
   answer, a dropped connection) also moves it to the next lane.
5. **Patience, then MiniMax.** When every lane failed, `chat()` waits and goes
   round again (5s, 15s, 30s, 60s, 120s). MiniMax is the last resort, from the
   second round on, never instead of a lane that would answer.
6. **No kill gates.** No timeout and no max_tokens of ours unless the caller
   already passes one. Answers stream, so a model that is still thinking keeps
   the connection alive.
7. **Clean input.** Half an emoji left by a page cut is replaced before sending
   (Vectide answers HTTP 400 to it).
8. **One log.** Every attempt is one `ApiCall` in the caller's log: the lane that
   served it, model, tokens in and out, USD, time, ok or failed.

Three entry points:

- `llm.chat(prompt, { step, log, ... })`: the full rules above. Company-dive and
  dive-deeper use it.
- `llm.ask(prompt, { step, log, ... })`: one pass over the lanes, no waits, the
  last lane's error code intact; MiniMax only when no lane is saved at all. For
  callers with their own retry and cooldown (contact research, email replies).
- `llm.agent(prompt, { tools, log, ... })`: Pi on MiniMax with web_search and
  web_fetch, for the reports and the gateway. The lanes have no tools.

## The per-call log (`ApiCall`, defined in `cost.ts`)

Every module takes an optional `log: ApiCall[]` and pushes one record per
request, retries and refused keys included:

`at, api, what, provider (lane or key pool), model, tokensIn, tokensOut, credits, results, ms, ok, usd, note`

`usd` is fixed when the call is made from the prices in `cost.ts`; `null` means no
per-call price is known (MiniMax's token plan, Hive). A failed call that did no
billable work costs 0. Company-dive keeps the log in its `result`, dive-deeper in
each lane's `meter.calls`; `GET /api/company-dive/:id` and
`GET /api/dive-deeper/:id` return it as `calls`.

## Adding a service or a caller

- A new API gets a module here, exported from `index.ts`, taking `log`, and its
  host goes in the list `core-door.test.ts` checks.
- A new feature imports `./core/index.ts` and calls it. It never sends a
  request to a model or a search API itself, and never picks, holds, rests or
  counts a key, or hands core a key or a lane: it says what it wants (`search.web`,
  `exa.request`, `tavily.request`, `llm.chat`) and core does the rest.
  `core-door.test.ts` fails the build when a file does.
- A new key or lane is added on /workers or /auto-queue (the app database),
  not as a Railway variable.
