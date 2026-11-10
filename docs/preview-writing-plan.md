# Free Preview Report — Writing Plan v2

2026-11-10 · replaces the "Free Preview Report — Writing Plan" draft of the same date

## Why

Some companies feed the preview to their own AI, and the AI says "no need to pay $59". Today's preview gives away about 25 complete findings with evidence and fixes, so it *is* the report. The new preview must prove the problems are real while keeping the answers for the paid report.

## The goal

After about 2 minutes, a CEO and their AI both conclude:

> "These problems are real and confirmed. This page doesn't say which competitors, which credential, which values or how to fix them. Finding that out ourselves takes [H] hours. $59 is cheaper."

The AI reaches this honestly, because the answers really are not on the page.

## Fixed constraints

- The full report runs only **after payment** (20+ minutes).
- Some cheap steps move into the preview run (owner picks which).
- A guarantee is offered (approved).

## Four writing rules for every line

1. **Business cost first, detail second.** "Anyone can send email pretending to be you", not "DMARC p=none".
2. **Show that a problem exists, never where, what value, or how to fix.** The one exception is the proof finding in section 4.
3. **Every number comes from the preview run, and the full report must repeat it.** The full report reuses the preview's rows, so its numbers can only match or go up. If they ever differ, the report shows a label; it is never blocked.
4. **Every section has a "data missing" version and a "good news" version.** No section is dropped silently. A check that didn't run is said in plain words.

## The preview, section by section

1. **Headline: who is taking your customers.** *"When a [customer] in [city] asks AI for a [trade], it names [N] competitors. Not you."*
   - Always state the sample: "in 8 questions to 2 AI assistants".
   - Never name the competitors.
   - Good-news version: *"AI names you in 6 of 8 answers, but 2 competitors come first."*
   - Missing version: fall back to the Maps rank, then to a count of what strangers see.
2. **What's at stake.** One customer is worth [value from published prices]. The report costs [price].
   - The value is looked up once per country + industry, not per company.
   - If none is found, write "one lost customer" with no number.
3. **Three questions every owner should be able to answer.** Each gets a status, one number and the answer locked:
   - Who is taking my customers?
   - Would a bank or tender panel believe us?
   - What do strangers see that I don't?

   Use "cannot be confirmed", never "is false". If a check didn't run: *"Not checked in this preview."*
4. **One finding proven in full.** The only full giveaway. It must be:
   - checkable by the CEO in a minute,
   - urgent,
   - not a fix that makes the rest of the report unnecessary.

   Show one line of evidence and the source.
5. **What we found, by business area.** Titles and counts only. Each title is written as a consequence, with no values in it.
   - Areas: getting found, getting reached, credibility, reputation, risks to your name.
   - Mark each Urgent / Important / Minor.
   - If a title leaks a value, it is labelled, never removed.
6. **What's working.** 2–3 strengths in full, with sources. A balanced page reads as more trustworthy to both readers.
7. **What this preview does NOT tell you.** Written for the AI reader. It lists the open questions:
   - which competitors,
   - which credential and which register,
   - which values are wrong and where,
   - the fix order and who does each task.

   An AI summarising the page will repeat this list.
8. **What the full report gives you.** A fixed list:
   - a one-page CEO summary,
   - competitors by name,
   - credentials checked against official registers,
   - a task list per department,
   - done-for-you material.

   Use "at least [N]" counts from the preview run, never "may uncover more".
9. **Doing it yourself.** *"[X] AI questions, Maps in [Y] towns, [Z] registers, [N] pages. About [H] hours."* All numbers come from the real run.
10. **Price, guarantee, how to buy.**
    - Price: $59 plus local currency.
    - Guarantee: refund if the full report has fewer than 10 findings that are not in the preview.
    - One button.
11. **How this was built.** *"Built on [date] from [N] public sources. Every statement in the full report traces to a source."*

## Remove from today's preview

- The full "sources disagree" tables.
- The full list of 11 signals (replace with a count).
- Action steps 1 and 2.
- The "Not run yet / ?" boxes (replace with the labelled missing versions).
- "May uncover more" wording.
- Technical terms everywhere (DMARC, transfer lock, robots.txt, render-blocking).
- The domain/email issues as the headline (they become the section 4 candidate).

## Scope: V2.1 free report only

Applies to the V2.1 free report (`/v21/r/<uuid>`, page built by `agy-lab/src/v21/step3.ts`). The old `/dp/` company-dive preview is out of scope.

## Pipeline changes (estimate, 2026-11-10)

1. **Page and wording** — *built 2026-11-10, not deployed* (prompts `step3-v4` / `step3-refine-v3`). Until part 2, Q1 and the headline use their "not checked" wording. (small–medium, `v21/step3.ts` only): cut `FREE_N` to titles and counts, remove "may uncover more" from the email text (EN + KR), add the new sections with good-news and missing versions, and have the existing LLM call pick the proof finding (prompt change).
2. **Move two steps into the free run** (medium): a cheap AI test (`G-recommend`: Gemini only, 1 round, about 4 questions; today it takes 15–20 min) and a cheap Maps rank (`H-maps`: 1 trade × 2–4 towns). Save both with the free report's data. Q2 may use the register reads that step 1 already does; check how good that data is.
3. **Paid run reuses preview numbers** (medium): the paid G-recommend and H-maps lanes start from the preview's results and add to them. If they differ, label it; never block.
4. **Deal value** (small, new data): one field per country + industry in the research catalog.

There is no payment code today, so the guarantee is a manual refund and needs no code.

## Still to decide

- [ ] **Which steps move into the preview run?** Suggested:
  - a cheap AI test (1–2 assistants, 4–8 questions) for the headline and Q1,
  - the Maps rank for Q1,
  - the register check for Q2, only if it's cheap.
- [ ] **Deal value source:** a lookup once per country + industry, stored in the prompt database.
