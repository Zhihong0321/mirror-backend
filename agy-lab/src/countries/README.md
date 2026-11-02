# Country packs

Company dive was built for Malaysia. A **country pack** tells it how to research a company
in another country: which language to search in, where the critical information is, and
what to look for. It changes no tool and no API. It only changes the search instructions.

One folder per country, named by its two-letter code:

How the work is run (roles, steps, going live, what to do when something goes wrong):
**[SOP.md](SOP.md)**.

```
src/countries/
  README.md          this file
  SOP.md             the procedure for managing country packs
  _template/         copy this to start a country
    pack.json
    research.md
  MY/                Malaysia: the baseline. pack.json is empty on purpose
  SG/                one folder per country
    pack.json        what the pipeline reads (validated, additive only)
    research.md      the research behind it, with every source tested
```

- `research.md` is the research: every useful source for the country, each one opened and tested.
- `pack.json` is the small part of that research the dive uses now. Each entry in it must
  trace back to `research.md`.

## Why a pack cannot break the pipeline

1. **Data, not code.** A pack is a JSON file. The code that reads it (`src/countries.ts`) is
   fixed and is not part of a country's work.
2. **Only adds, in fixed slots.** A pack can add country codes, up to 8 extra Brave queries,
   unreadable hosts, and instructions in a few prompts. It cannot remove a query, change the
   15-call Tavily budget, change a stage, or call anything new.
3. **Malaysia cannot change.** `MY/pack.json` adds nothing, and `countries.test.ts` fails if a
   Malaysian dive's Brave queries, prompts, Exa location or log change by one character.
4. **One country at a time.** A pack is used only when the dive's country matches one of its
   `names`. A Singapore pack never sees a Malaysian dive.
5. **Broken means ignored.** A pack that fails validation is skipped whole. The dive runs as
   if there were no pack, and its log says why.
6. **Draft until tested.** A new pack starts as `"status": "draft"`. The hub ignores drafts;
   only the local test run (`scripts/country-dive.ts`) uses them. It goes `"live"` only after
   review and a test dive.
7. **Off switch.** `COUNTRY_PACKS=off` on the hub turns every pack off at once.
8. **Checked before review.** `node scripts/check-country.ts <CC>` fails if any file outside
   `src/countries/<CC>/` changed, or if the pack is invalid.

## pack.json

| Field | What it does | Without it |
|---|---|---|
| `code` | Two capital letters, same as the folder (`SG`) | required |
| `country` | English name, shown in the prompts (`Singapore`) | required |
| `status` | `draft` or `live` | required |
| `names` | Every lowercase spelling of the country a dive may be started with: `["south korea", "korea", "republic of korea"]` | required |
| `languages` | Languages business information is published in: `["en", "ko"]`. Any language other than `en` adds fixed instructions: read those sources, write the facts in English, plan some searches in that language | required |
| `search.brave_country` | Brave's country code | today's `COUNTRY_CODES` |
| `search.tavily_country` | Tavily's country name, lowercase | today's rule |
| `search.exa_location` | Exa's `userLocation` for the people step | `MY` |
| `discover` | Up to 8 extra Brave queries in step 1, after the dive's own 8. Placeholders: `{company}` (full name as typed), `{short}` (without Pte. Ltd., Sdn Bhd…), `{country}`. Each query must use `{company}` or `{short}`. `kind` is `web` or `news` | none |
| `walled` | Hosts whose pages need a login or block bots, so the dive uses their snippets and never tries to read them | none |
| `notes.triage` | Added to the triage prompt (which results are about the company): ID formats, name forms, lookalike traps | none |
| `notes.analyse` | Added to the analyse prompt (facts, gaps, and planning up to 8 Tavily searches): the registers and sites to search, with `include_domains` hints | none |
| `notes.reflect` | Added to the reflect prompt (the last reserve calls) | none |
| `notes.facts` | Added to the reserve-facts prompt | none |
| `notes.write` | Added to the dossier prompt: what the "Identity and registration" section should name | none |
| `notes.people` | Added to the people step's Exa search planning: where directors and staff are listed | none |

Each note is at most 3000 characters. Write notes as short instructions to a researcher.
Example (made up):

```json
"analyse": "The company number is the UEN (9 or 10 characters, e.g. 201912345K). Search include_domains [\"opengovsg.com\"] with the UEN or exact name for the registered address and status. For headcount search include_domains [\"mycareersfuture.gov.sg\"]."
```

## Workflow for one country

1. **Research (Gemini, in Antigravity).** Copy `_template/` to `src/countries/<CC>/`. Fill in
   `research.md`, testing every source. Write `pack.json` from it, with `"status": "draft"`.
   Change nothing else in the repo.
2. **Check.** `cd agy-lab` then `node scripts/check-country.ts <CC>`. All checks must pass.
3. **Review (Claude).** Read `research.md` and `pack.json`, then run a test dive on one real
   company with the pack, and the same company with `--no-pack`:
   `node scripts/country-dive.ts "<company>" "<Country>"` and add `--no-pack` for the comparison.
4. **Live.** If the pack dive is better, set `"status": "live"`, commit, and deploy.

## The 25 countries

| # | Code | Country | Languages | Status |
|---|---|---|---|---|
| 1 | MY | Malaysia | English | live (baseline, empty pack) |
| 2 | SG | Singapore | English | todo |
| 3 | PH | Philippines | English | todo |
| 4 | IN | India | English | todo |
| 5 | AU | Australia | English | todo |
| 6 | NZ | New Zealand | English | todo |
| 7 | CA | Canada | English | todo |
| 8 | US | United States | English | todo |
| 9 | GB | United Kingdom | English | todo |
| 10 | IE | Ireland | English | todo |
| 11 | AE | United Arab Emirates | English | todo |
| 12 | JP | Japan | English + Japanese (`ja`) | todo |
| 13 | KR | South Korea | English + Korean (`ko`) | todo |
| 14 | TW | Taiwan | English + Traditional Chinese (`zh-Hant`) | todo |
| 15 | TH | Thailand | English + Thai (`th`) | todo |
| 16 | VN | Vietnam | English + Vietnamese (`vi`) | todo |
| 17 | ID | Indonesia | English + Indonesian (`id`) | todo |
| 18 | BR | Brazil | English + Portuguese (`pt`) | todo |
| 19 | AR | Argentina | English + Spanish (`es`) | todo |
| 20 | ES | Spain | English + Spanish (`es`) | todo |
| 21 | FR | France | English + French (`fr`) | todo |
| 22 | DE | Germany | English + German (`de`) | todo |
| 23 | NL | Netherlands | English + Dutch (`nl`) | todo |
| 24 | RU | Russia | English + Russian (`ru`) | todo |
| 25 | CH | Switzerland | English + German / French / Italian (`de`, `fr`, `it`) | todo |

The reviewer updates the Status column. A country's own work never edits this file.

## What packs do not cover yet

The full report (dive-deeper) still uses its Malaysian sources: SSM, Bursa, Bank Negara,
MYNIC, `.gov.my` and the Malaysian phone format. `research.md` sections 8 and 9 collect the
same kinds of sources for each country, so the full report can use them later.
