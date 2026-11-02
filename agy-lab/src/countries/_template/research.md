# <Country>: company research playbook

| | |
|---|---|
| Code | XX |
| Researched by | Gemini (Antigravity), YYYY-MM-DD |
| Reviewed by | |
| Status | draft |

Rules for this file:

- Every source in a table has a URL that you **opened yourself**, and the "Tested" column says what you saw and on which date.
- Write "unknown" if you could not find out. Never guess.
- Never get past a CAPTCHA, a login or a paywall. If one is in the way, write it down: the pipeline will report "not checked" for that source.
- Write in English. Put local-language words in their original script with the English after them, e.g. 대표이사 (CEO).

## 1. Language and company names

- Languages business information is published in:
- Script(s):
- Legal forms and their suffixes, as they appear in names (e.g. Pte. Ltd., 주식회사 / (주), GmbH):
- How the same company's name usually differs between English and the local language:

## 2. Company identity number

| | |
|---|---|
| Name of the number | |
| Who issues it | |
| Format (pattern and a real example) | |
| Must companies show it on their website or invoices by law? | yes / no / unknown, and the law |
| Where it usually appears on a company website | |

## 3. Official company register

| Register | URL | Free or paid | How to look a company up (open page, search form, API, login, CAPTCHA) | What a record gives | Tested |
|---|---|---|---|---|---|
| | | | | | |

## 4. Business information sites

Third-party sites with directors, address, revenue, headcount or filings.

| Site | URL | What it shows | Free? | Readable without login? | Search tip (e.g. `site:` query) | Tested |
|---|---|---|---|---|---|---|
| | | | | | | |

## 5. Reputation and reviews

| Site | URL | What it shows | Readable without login? | Tested |
|---|---|---|---|---|
| | | | | |

## 6. Jobs and headcount

| Site | URL | What it shows (headcount, salary, employee reviews) | Readable without login? | Tested |
|---|---|---|---|---|
| | | | | |

## 7. News

| Source | URL | Language | Tested |
|---|---|---|---|
| | | | |

## 8. Credibility checks (for the full report later)

Not used by the pipeline yet. Collect them now so the full report can use them later.

| Check | Source | URL | Free or paid | How to check | Tested |
|---|---|---|---|---|---|
| Regulator warnings / alert lists | | | | | |
| Court judgments | | | | | |
| Insolvency and bankruptcy notices | | | | | |
| Sanctions or government blacklists | | | | | |
| Stock exchange (listed companies) | | | | | |
| Government tenders and awards | | | | | |
| Trademark office | | | | | |

## 9. Website rules (for the full report later)

- Legal notice pages companies must have (e.g. Impressum, mentions légales):
- Privacy law and what it requires on a website:
- Country domain (ccTLD), common second-level domains (e.g. .com.sg), and its WHOIS / RDAP server:
- Phone number format (country code, mobile and landline patterns):
- Currency, and how amounts are written:

## 10. Walled and paid: never checked automatically

| Site | Why (login, CAPTCHA, bot wall, paid) |
|---|---|
| | |

## 11. Sample companies tested

Three real companies: one listed, one mid-size, one small.

| Company | Size | Which sources above found it | Notes |
|---|---|---|---|
| | listed | | |
| | mid-size | | |
| | small | | |

## 12. What went into pack.json, and why

One line per `discover` query and per `notes` entry, naming the section above it comes from.

-

## 13. Review and test log

Filled in by the reviewer, never by the researcher. One row per test dive (SOP step 5).

| Date | Pack version (commit) | Company | Result with pack vs. without | Decision |
|---|---|---|---|---|
| | | | | |
