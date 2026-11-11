# Brief for Fable: redesign the V2.1 free preview report

2026-11-10. Written to be pasted as context. Sources: `docs/preview-writing-plan.md`, `docs/v21.md`, `agy-lab/src/v21/step3.ts`.

## 1. The business

Company Dive is a SaaS from Eternalgy. For one company (name, country, industry, website) it researches what the **public internet says about them** and sells a full report for **$59**.

- The **free preview** is bait at a loss. Its only job is to make the owner buy the full report (20+ min run, run only after payment).
- The owner knows their own business. What they don't know is **the gap between what they think customers see and what customers, banks and tender panels actually see**: stale phones in directories, a differing legal name, a licence near expiry, an award not shown, staff reviews they never read.
- Markets today: Malaysia, Singapore, Australia (English) and South Korea (Korean). Pages and emails come in EN and KO.
- Delivery: a public page `/v21/r/<uuid>` (noindex) plus an email with the link. There is no payment code; a buyer replies to the email and the team runs the full report by hand.

## 2. The problem to solve

Companies paste the preview into their own AI, and the AI says "no need to pay $59". The old preview showed ~25 complete findings with evidence and fixes, so it *was* the report.

**Goal:** after about 2 minutes, the CEO and their AI both conclude: *"These problems are real. This page doesn't say which competitors, which credential, which values, or how to fix them. Doing it ourselves takes [H] hours. $59 is cheaper."* The AI must be able to reach that honestly, because the answers really are not on the page.

## 3. The pipeline (V2.1: three steps, each reads the previous step's saved rows)

| Step | Job | Notes |
|---|---|---|
| 1 Research | Gather only, no judging | Official-site gate (no confirmed official site = company skipped). Reads own site, searches third-party sources by country (directories, review and employee-review sites, awards, news), catalog probes per country + industry (registers, lists), Google Maps and LinkedIn via a local worker PC, Naver Place for Korea. Output: raw checkpoint in hub Postgres (`v21_raw`) |
| 1.5 Technical audit | Deterministic, no LLM | PageSpeed (mobile/desktop, CrUX), SEO/GEO website score, domain expiry and transfer lock, SPF/DMARC (spoofable?), TLS cert |
| 2 Analyse | The only judge, 1 LLM call + recheck call, then a plain-code check | "Rules v2" returns four lists: `conclusive_findings` (problem or strength, with quotes), `contradictions` (sources disagree), `suggestions` (actions), `take_note` (signals, not proven). Rules: "not found is not a finding", drop namesakes, own-site filtered. Failed items are recorded in `rejected`, never silently deleted |
| 3 Write | Writes, never judges (`v21/step3.ts`) | One LLM call writes: 2-3 sentence summary, email subject + body, a consequence title for every non-proof item, and picks the one "proof" finding. Plain code checks every sentence (cited ids exist, numbers come from cited items) and **renders the page from the Step 2 items itself**, so nothing on the page can drift from Step 2 |

Urgency (Urgent / Important / Minor) is set by code from record type, confidence and days-to-expiry. Findings are grouped into business areas: getting found, getting reached, credibility, reputation, risks to your name.

## 4. The current page (built 2026-11-10, commit bfe7874; prompts `step3-v4` / `step3-refine-v3`)

Order: hero (headline = "N problems" + summary + "Action required" box) → what's at stake → **three questions** (who is taking my customers / would a bank or tender panel believe us / what do strangers see that I don't), each with a status and the answer locked → **one finding in full** (the proof, one evidence line) → every other finding as **consequence title + urgency only**, by business area → up to 3 strengths in full → "what this page does not tell you" → what the full report gives (5 items) → doing it yourself → price, guarantee, buy button.

Six rendered samples (HTML + JSON) are in `docs/reports/preview-v2-2026-11-10/`. Look at them before redesigning.

**Known gaps in the current page (stated honestly):**
- Question 1 and the headline cannot say who is taking customers: the AI-assistant test (`G-recommend`) and Maps rank (`H-maps`) are not in the free run yet, so Q1 always reads "not checked here". The headline is a problem count, not the planned "AI names N competitors, not you".
- No deal-value number ("one customer is worth X"); `stake` is generic text.
- "Doing it yourself" has no hour estimate; "what the full report gives" has no real counts from the run.
- Not deployed yet (as of the plan doc).

## 5. Fixed constraints

1. **Writing rules for every line:** (a) business cost first, detail second ("anyone can send email pretending to be you", never "DMARC p=none"); (b) show that a problem exists, never where, which value, or the fix (one exception: the proof finding); (c) every number comes from the preview run and the full report must repeat or exceed it; (d) every section has a "data missing" and a "good news" version.
2. **No kill gates (owner rule, critical).** Never design a check, filter or threshold whose result is "no report", a hidden section, or silently missing parts. A problem is recorded and labelled ("unconfirmed", "not checked in this preview"), never blocks or hides. A generated imperfect report beats a missing one.
3. Use "cannot be confirmed", never "is false". Never accuse a company on a namesake's data. Never print private people's names or personal phones.
4. Don't design around one sample report. Cover: strong company with few problems, company with many, missing data, Korean, no strengths, no proof candidate.
5. Guarantee (approved): refund if the full report has fewer than 10 findings not in the preview. Price is one USD figure from the hub, shown for every country.
6. Simple over complex: the owner has rejected added machinery before. Prefer removing to adding; keep Step 3 as "plain code renders, one LLM call writes".
7. Locked content must be absent from the HTML, not blurred (a CSS blur is still in the page source, and the AI reads source).

## 6. What I want from Fable

Redesign the free report so it persuades a CEO in ~2 minutes **and** reads, to a pasted-in AI, as "real problems, answers deliberately not here, paying is cheaper". Specifically:

1. The page structure and section order, and what each section says in the good-news and missing-data versions.
2. The headline and the three questions (what to show when AI-test and Maps data exist, and when they don't).
3. How to choose the one proof finding, and how to word consequence-only titles that leak no values.
4. The "what this does not tell you" and "doing it yourself" sections written for an AI reader.
5. Visual design (the current page is dark hero, Inter / Inter Tight, band sections) and the email that carries the link.
6. Which cheap checks (AI-assistant test, Maps rank, register check) are worth moving into the free run, ranked by persuasion per minute of run time.

Deliver wording and layout as a proposal. Do not assume any code will be changed until the owner approves.
