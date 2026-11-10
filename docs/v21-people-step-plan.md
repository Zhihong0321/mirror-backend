# V2.1 People step: plan (2026-11-10, not built)

One job: **find every person and contact linked to the target company, as deep as the tools allow.** Gather only. It
does not decide who is "really" linked, who is current, or what is a problem. Step 2 does that.

## Owner decisions needed before building

1. **What the people list is for: REPORT MATERIAL (owner, 2026-11-10).** Not sales leads. The step looks for what
   strangers see about the company's people that the owner may not know, for example:
   - former staff still listed as the company's contact (directories, Maps, old listings, staff profiles);
   - a founder/director named differently, or a different set of directors, across sources;
   - a contact (email, phone) tied to a person that the site no longer shows, or that another company also uses;
   - key people in news, court/scam/forum posts, or employee reviews naming managers;
   - staff profiles describing the company in ways that clash with the site (job titles, services, location);
   - missed advantages: key people quoted in press, speaking, or on award pages the site does not mention.
   So the step keeps a contact only when a source ties it to the company or to one of its people; it does not
   harvest personal contacts for outreach.
2. **Where it runs: V2.1 STEP 1.6 (owner, 2026-11-10).** Beside Step 1.5, reading `step1_research.json`, saving to
   the same `v21_raw` store. Not a deeper-dive lane.
3. **Personal contact data.** Personal mobile numbers and private emails of staff fall under PDPA (MY) and the Privacy
   Act (AU/SG equivalents). Recommended: keep any contact the source publishes, record whether it is on a company
   domain/line, and never print a private person's personal number in a report (Step 3 rule 11 already says so).

## Tools and the one thing each does

| Tool | Role | Why |
|---|---|---|
| Exa, `category: people` | **Main people source.** Profile index (LinkedIn-style job history) without reading LinkedIn. | LinkedIn reads on the worker are blocked (403); Exa's index is the way round it. |
| Exa, web | Names in news, interviews, award pages, registries. | Search for unknown URLs: allowed. |
| Brave | Few targeted queries only (directors, `"<name>" <company>`). | Credit is limited. |
| Tavily | Same queries when Brave/Exa fail; `topic: news` for named people in press. | Fallback search. |
| ChatGPT ask, Gemini (cloud hub) | **Lead source only.** "Who founded / runs / works at X?" Their names are leads, not evidence: every name they give is then searched for a URL. | They browse and recall well but invent people. |
| Local worker (free) | Read every page found: team, about, contact, news, directory entries. | Paid APIs = web search only. |

## How it digs (snowball, rounds until nothing new)

- **Round 0, seeds (no API cost).** From Step 1: legal name, trade names, domain, registration no., town, industry,
  and every name, email and phone already on pages Step 1 read (site, directories, Maps).
- **Round 1, broad.** Exa people: "people who work at <name>, <industry> in <town>, <country>" per name variant and
  per role (founder, director, sales, engineer, HR, manager). Exa web + Brave: directors / shareholders / founder /
  interview / award. ChatGPT + Gemini: the same three questions, in parallel.
- **Round 2, per person.** Each new name gets `"<name>" "<company>"` (Exa web) and `"<name>" <company>` (Exa people),
  to find their profile, other roles, and published contacts.
- **Round 3, per contact.** Each email/phone found is searched as a string: where else is it published (directories,
  old listings, other companies). Emails on the company domain give the address format (`firstname@domain`); recorded
  as a pattern, never used to invent addresses.
- **Round 4+, repeat** rounds 2-3 on names first seen in the last round.
- **Reading.** Every new URL from any round goes to the local worker to read the full page (team pages, articles).
- **Stop** when a round adds no new name or contact, or the call budget is used. Hitting the budget is recorded with
  the leads left unsearched; it never ends the step without output.

## What it saves (`step1_6_people.json`)

- Every query run: tool, text, round, why (which seed or name), hits count, cost, error if any.
- Every hit raw: URL, title, snippet/highlights, page text when read, Exa profile fields (name, location, jobs).
- **Mentions** (LLM extraction, no judging): each person name, role text and contact string seen, with the URL and
  the exact quote. Same name from two URLs = two mentions; merging and namesake rejection are Step 2.
- Assistant answers (ChatGPT, Gemini) raw, marked as leads.
- No found/not-found, no "linked/not linked", no confidence. (Per Step 1 SOP; the old V2 `findPeople` mixed these in.)

## Step 2 / Step 3 use (later, separate change)

Step 2 judges the mentions: same person merges, namesakes out, current vs former, which contacts disagree with the
site. Step 3 writes only from Step 2's findings and keeps rule 11 (no private names or personal numbers).

## Zero kill gates

- Any tool failing = one recorded line; the round goes on with the other tools.
- Exa, Brave, Tavily, ChatGPT, Gemini, worker all down = the file is still saved, with seeds from Step 1 as mentions
  and every failure listed.
- The step failing never stops Step 2/3: Step 2 runs without people and says "people step: failed (reason)".
- Every field from an LLM or API is guarded (`clean()`, array checks), as in `companydive-people.ts`.

## Build (after decisions; one change per deploy)

1. `agy-lab/src/v21/people.ts`: new file beside the old, behind `V21_PEOPLE=on`. Reuse `bodyFor`/`toHit` shape from
   `companydive-people.ts`, `core/exa.ts`, `core/brave.ts`, `core/tavily.ts`, the `askChatGPT` / Gemini hub calls from
   `divedeeper/sections/G-recommend.ts`, and the worker reader.
2. Hook it in `v21/run.ts` as stage 1.6; save to the same `v21_raw` store as Step 1.5.
3. Prove the new part only: 5 real companies across MY/SG/AU (not one sample), plus each failure path on purpose
   (Exa key bad, worker down, ChatGPT down, budget 0) showing the file still saves.
4. Step 2 reading the people file: a separate, later change.

## Rough cost per company (to confirm in the test)

~15-30 Exa calls, ≤5 Brave, 0-5 Tavily (fallback), 6 assistant asks, 3-6 LLM extraction calls, worker reads free.
