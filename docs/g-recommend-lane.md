# G-recommend: how AI sees you, rates you, and whether it recommends you over your competitors

Status: BUILT 2026-11-09. One live round on Eternalgy from a dev machine (ChatGPT worker PC + Gemini hub); the hub run is the proof.

## What it asks

Two assistants that search the web get the same six customer questions, in a customer's words:

| id | kind | The customer asks | Names the company? |
|---|---|---|---|
| best | find | Who are the best `<trades>` in `<area>`? Please name specific companies. | no |
| hire | find | I live in `<area>`, `<state>` and I want to `<job>`. Which companies should I contact? | no |
| top5 | find | I'm getting quotes from `<trades>` in `<area>`. Give me your top 5 companies, ranked, with one reason for each. | no |
| trust | find | Which `<trades>` in `<state>` have the best reputation? I want one I can trust. | no |
| rate | rate | Rate `<name>` in `<area>` as a `<trade>` out of 10. Then rate its closest competitors... | yes |
| pick | pick | I'm considering `<name>` to `<job>` in `<area>`. Would you recommend them, or is there a better company...? Tell me the one company you would pick. | yes |

Each ends "Please check the web for current information." Each is asked `DD_R_REPEAT` times (default 2) per assistant.
The trade, town and job come from G-search's company profile (G-recommend runs in stage 2, after G-search).

## The two assistants

- **ChatGPT**: web ChatGPT on a Local Gmap Worker PC, through myworker `POST /api/chat` (`divedeeper/v21/myworker.ts` `chat()`).
  The worker's Chrome extension opens every prompt in a new **unpersonalized temporary chat**: no earlier prompts, no account
  memory, no custom instructions, not saved to history. Default model; the service has no model choice. One prompt at a time
  (one browser tab). A "send the prompt again" failure (the tab reloaded) is retried; two prompts failing in a row stop ChatGPT.
  Proven on 2026-11-09: a code word given in one prompt was unknown in the next ("NONE"); "what do you know about me" gave
  "NOTHING" (the same account's personalized chat knows the owner is Eternalgy's CEO, so this matters).
- **Gemini**: the cloud Antigravity hub, `liveHub()` and `runJobs()` from G-search, all workers at once.

## How an answer is read

- **Named or not** is a plain name match on the answer text (legal name without Sdn Bhd, brand, aliases, domain labels).
- A cheap extractor (`ctx.llm`, temperature 0) only **copies** out of each answer: the companies in order, the company's place,
  scores out of 10, the one company it would pick, and whether it recommends the company. It does not judge whether the answer
  is right. If it fails, the name match still stands.
- "Recommended over the others" means its own pick is the company, or it picked no one and said yes. "A good choice, but I would
  pick X" counts as picking X.

## In the report

Its own page, `#ai-recommend`, after the six parts and before the full analysis, with a nav link "AI recommends you?":
named-without-your-name count (per assistant, per question, best place), who is named instead (board with your row), the score
table (you and the competitors the assistants chose), the "would you recommend them or another?" verdict per assistant, and every
answer word for word in a fold. Its three findings also go to the "How the internet understands you" checklist.

Lane failure: it fails only when neither assistant answered; one assistant down makes it partial, and the page shows the other.

## Time

One round (6 prompts x 1 per assistant) took 8.5 minutes from a dev machine, mostly ChatGPT one prompt at a time.
With the default 2 rounds expect about 15-20 minutes; it runs beside H-web, D-registry and C-merged in stage 2.
