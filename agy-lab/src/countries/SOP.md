# SOP: managing per-country research profiles

How a country gets its research profile (its "country pack"), how the profile is checked,
tested and made live, how it is changed later, and what to do when something goes wrong.

How the packs work technically: `README.md` in this folder.
The researcher's step-by-step: `.agents/skills/country-pack/SKILL.md`.

---

## 1. Purpose

Company dive was built for Malaysia. For each of the 25 countries we sell in, we want it
to search the right language, look in the right official and business sources, and know
what the critical information looks like there (company number, register, directors).

A country's profile holds exactly that, and **nothing else**: search instructions, places
to look, and search language. The tools, the APIs and the pipeline's stages never change
per country.

## 2. The rules that never bend

1. **Malaysia's pack stays empty.** `MY/pack.json` adds nothing, so a Malaysian dive runs
   exactly as it always has. A test fails if it changes.
2. **One country, one folder.** Work on a country touches only `src/countries/<CC>/`.
   `scripts/check-country.ts` fails on any other changed file.
3. **Nothing is guessed.** Every source in `research.md` was opened and tested, with the date.
   "Unknown" is a correct answer.
4. **No CAPTCHA, login or paywall is ever bypassed.** Write it down as "not checked".
5. **Draft until tested.** A new pack is `draft`. The hub ignores drafts. Only a reviewed pack
   that passed a test dive goes `live`.
6. **Reports stay in English.** Sources can be in any language; the facts and the dossier
   are written in English.

## 3. Roles

| Role | Who | Does | May edit |
|---|---|---|---|
| Owner | you | Picks the next country, starts the researcher, approves going live | anything |
| Researcher | Gemini, in Antigravity | Researches one country, writes its `research.md` and `pack.json` | only `src/countries/<CC>/` |
| Reviewer | Claude | Reviews the research, runs the test dives, records the result, prepares the change | the country folder, this folder's `README.md` status column |
| Code owner | Claude, only when asked | Changes `countries.ts` or the pipeline, when a country needs something packs cannot do | code, with its own tests |

The researcher never changes code. If a country needs something a pack cannot express (a
register that needs its own lookup code, a new slot), the researcher writes it under
"Notes for the reviewer" at the end of `research.md`, and the owner decides.

## 4. Where everything is

| What | Where |
|---|---|
| Working folder for country work | `E:\000\automation-tools-countries` (git worktree, branch `countries`) |
| Live hub code | `E:\000\automation-tools` (branch `main`, deployed to Railway service `ee-auto`) |
| One country's profile | `agy-lab/src/countries/<CC>/pack.json` and `research.md` |
| Status of all 25 countries | the table in `agy-lab/src/countries/README.md` |
| Test dive results (local only, not committed) | `agy-lab/scripts/country-dive-out/` |

Country work happens in the `countries` worktree, never in the live checkout. Nothing there
reaches the hub until it is merged into `main` and deployed.

## 5. The life of a country profile

```
todo ──▶ draft ──▶ checked ──▶ reviewed ──▶ tested ──▶ live
          (1)        (2)          (3)          (4)       (5)
                                   │            │
                                   └── back to draft with feedback
```

| Stage | Done when | `status` in pack.json |
|---|---|---|
| todo | Nobody has started | (no folder) |
| draft | The researcher has written both files | `draft` |
| checked | `check-country.ts` ends with "All checks passed" | `draft` |
| reviewed | The reviewer accepts the research (checklist in step 3) | `draft` |
| tested | The test dive with the pack beats the one without (step 4) | `draft` |
| live | Committed with `live`, merged and deployed | `live` |

### Step 1: Start a country (owner)

1. Pick the next country from the README table. Suggested order:
   - **Singapore**: English only, the pilot.
   - **South Korea**: the first local-language country.
   - **Germany**: strict register, legal notice pages.
   - The rest in order of sales priority.
2. Open `E:\000\automation-tools-countries` in Antigravity.
3. Paste the prompt from Appendix A, with the country filled in.
4. Wait for Gemini's hand-over reply. It must quote the checker's last line,
   "All checks passed. <CC> is ready for review.", and name a suggested test company.

### Step 2: Check (researcher, then owner confirms)

From `agy-lab/`:

```
node scripts/check-country.ts <CC>
```

| Check | What it guards |
|---|---|
| 1. Only `src/countries/<CC>/` changed | The pipeline, the tests and other countries are untouched |
| 2. `pack.json` is valid | Only allowed fields, at most 8 queries, notes at most 3000 characters, names no other pack claims |
| 3. `research.md` has every section | Nothing was skipped |
| 4. Country tests pass | Malaysia is unchanged; every pack loads |
| 5. Printout | Shows exactly what the pack adds to a dive, for a human to read |

If check 1 fails, the researcher puts the listed files back. Never accept a country's work
with files changed outside its folder.

### Step 3: Review (reviewer)

Tell Claude: "Review the <Country> pack." The reviewer goes through this list:

- [ ] Every source has a URL and a "Tested" entry with a date
- [ ] The register and the company number format are right (checked against a real company)
- [ ] Section 11 has three real companies, and the sources found them
- [ ] Every `discover` query and every note traces back to a section (section 12)
- [ ] The queries use `{short}` or `{company}`, and would not mostly find lookalike companies
- [ ] The notes are short, concrete instructions, not essays, and repeat nothing the prompts already say
- [ ] `walled` lists the login and bot-wall sites from section 10
- [ ] `languages` matches the README table
- [ ] Nothing in it asks the dive to pass a CAPTCHA, a login or a paywall

If any item fails, the reviewer writes what to fix, and the owner sends that back to Gemini.
The pack stays `draft`.

### Step 4: Test dive (reviewer)

Pick one real company in that country: mid-size, with a website, ideally Gemini's
suggestion. The reviewer runs it twice, from `agy-lab/` in the `countries` worktree:

```
node scripts/country-dive.ts "<Company>" "<Country>"
node scripts/country-dive.ts "<Company>" "<Country>" --no-pack
```

Both runs are on this machine, use real API calls (about 15 Tavily, 8 to 16 Brave, up to
20 Exa and 10 to 15 LLM calls each), and write nothing to the hub or its database.

**Pass when, compared with `--no-pack`:**

| Measure | Must be |
|---|---|
| Right company (legal name, official domain) | the same or better |
| Company number found (`registration`) | found, if section 2 says it is public |
| Facts | the same or more |
| Cited sources | the same or more, with official or local sources among them |
| People linked | the same or more, with no lookalike company's people |
| Warnings | no new ones |
| Calls | Tavily at most 15, Brave at most 16 |
| Dossier | in English, no untranslated local text except names |

The reviewer writes one row in section 13 of `research.md`. If it passes, go to step 5. If
it fails, the reviewer writes why, and it goes back to Gemini.

### Step 5: Go live (owner approves, reviewer does it)

1. Set `"status": "live"` in `pack.json`, and set the README table row to `live`.
2. Commit on the `countries` branch: `feat(countries): <Country> pack live`.
3. Merge `countries` into `main` and push. Railway deploys the hub.
4. Watch the first real dive for that country. Its log must say
   `Country pack <CC> (live) applied`.
5. Run one Malaysian dive and confirm it looks as it always does.

## 6. Changing a live profile

A source moved, a register changed, or a test showed a gap.

1. Make the change in the `countries` worktree, in that country's folder only.
2. Run steps 2 to 4 again. The pack can stay `live` while you test: the local test run
   reads the local file, and the hub only gets the change at the next deploy.
3. Add a row to section 13 saying what changed and why.
4. Commit `fix(countries): <Country> <what changed>`, merge and deploy (step 5).

## 7. When something goes wrong

| Symptom | Do this |
|---|---|
| Dives for one country got worse after its pack went live | Set that pack's `status` to `draft`, commit, deploy. Its dives run as before the pack. Then fix it with section 6 |
| Dives for many countries look wrong, or you are not sure which pack | On Railway, service `ee-auto`, set the variable `COUNTRY_PACKS=off` and redeploy. Every pack is off at once, Malaysia included (Malaysia's is empty anyway). Remove the variable to turn them back on |
| A dive log says `Country pack <CC> is ignored: …` | The pack is broken; the dive ran without it. Run `check-country.ts <CC>` and fix what it reports |
| A Malaysian dive changed | Should be impossible: the tests guard it. Set `COUNTRY_PACKS=off`, then ask the code owner to investigate |
| Gemini changed a file outside its country folder | Do not accept the work. Put the file back (`git checkout -- <file>`), and send the rule from the skill back to Gemini |

## 8. Keeping profiles fresh

- **Every 6 months**, per live country: re-open the sources in sections 3 and 4, update
  "Tested", and run one test dive (step 4).
- **At once**, when a dive log shows a source failing again and again, or a register moves.
- The README table's Status column is the one list of where each country stands.

## Appendix A: the prompt to give Gemini

```
Build the country pack for <Country> (code <CC>).

Use the country-pack skill: .agents/skills/country-pack/SKILL.md.
Read agy-lab/src/countries/README.md and agy-lab/src/countries/SOP.md first.

Create and edit files ONLY inside agy-lab/src/countries/<CC>/.
Do not edit any other file. Do not commit, push or switch branches.

Open and test every source yourself. Never pass a CAPTCHA, a login or a paywall.
Write "unknown" instead of guessing.

When done, run (from agy-lab/):  node scripts/check-country.ts <CC>
and repeat until it says "All checks passed".
Then reply with the checker's last line, your 3 sample companies,
and one mid-size company with a website for the test dive.
```

To send work back after a review:

```
The reviewer's feedback on the <Country> pack is below. Fix it, inside
agy-lab/src/countries/<CC>/ only, then run node scripts/check-country.ts <CC> again.

<paste the feedback>
```

## Appendix B: commands

All from `E:\000\automation-tools-countries\agy-lab`.

| Purpose | Command |
|---|---|
| Check one country | `node scripts/check-country.ts <CC>` |
| Test dive with the pack | `node scripts/country-dive.ts "<Company>" "<Country>"` |
| The same company without packs | `node scripts/country-dive.ts "<Company>" "<Country>" --no-pack` |
| Skip the people step (cheaper) | add `--no-people` |
| Country tests only | `node --test src/countries.test.ts` |
| Every test | `npm test` |
