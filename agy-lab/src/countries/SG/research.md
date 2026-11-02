# Singapore: company research playbook

| | |
|---|---|
| Code | SG |
| Researched by | Codex, 2026-11-01 |
| Reviewed by | |
| Status | draft; research incomplete |

## 1. Language and company names

English; Latin script. Examples of legal suffixes include Pte. Ltd. and Ltd. Other name forms: unknown.

## 2. Company identity number

UEN (Unique Entity Number). Issuer and complete format: unknown. Example: DBS Group Holdings Ltd 199901152M, from the directory in section 4. Website or invoice display obligation, law and usual website location: unknown.

## 3. Official company register

| Register | URL | Free or paid | Lookup | Record | Tested |
|---|---|---|---|---|---|
| ACRA Bizfile | https://www.bizfile.gov.sg/ | Basic lookup according to ACRA guidance; profiles paid | JavaScript required in the available reader; search not tested | Status and address according to guidance | 2026-11-01: page only reports JavaScript required. Guidance opened: https://www.acra.gov.sg/resources/guides-forms/using-bizfiles-search-functions/ |

## 4. Business information sites

| Site | URL | What it shows | Free? | Readable without login? | Search tip | Tested |
|---|---|---|---|---|---|---|
| Companies.sg | https://www.companies.sg/ | UEN, status, address and compiled public records | Basic pages free; reports offered | Yes for sample pages | `site:companies.sg` exact name or UEN | 2026-11-01: home and DBS, AEM and Tiong Bahru Bakery records opened; third-party data may be stale. |

## 5. Reputation and reviews

| Site | URL | What it shows | Readable without login? | Tested |
|---|---|---|---|---|
| Indeed | https://sg.indeed.com/cmp/Aem-Singapore | Employee reviews | Sample page yes | 2026-11-01: AEM employee reviews readable. Other companies not yet tested. |

## 6. Jobs and headcount

| Site | URL | What it shows | Readable without login? | Tested |
|---|---|---|---|---|
| MyCareersFuture | https://www.mycareersfuture.gov.sg/ | Jobs | unknown | 2026-11-01: reader returned only logo; search not tested. |

## 7. News

| Source | URL | Language | Tested |
|---|---|---|---|
| CNA | https://www.channelnewsasia.com/ | English | 2026-11-01: homepage readable; individual sample company searches incomplete. |

## 8. Credibility checks (for the full report later)

| Check | Source | URL | Free or paid | How to check | Tested |
|---|---|---|---|---|---|
| Regulator alerts | MAS | https://www.mas.gov.sg/investor-alert-list | unknown | Search list | 2026-11-01: page opened; company lookup not tested. |
| Stock exchange | SGX | https://www.sgx.com/ | unknown | unknown | 2026-11-01: homepage opened; lookup not tested. |
| Government tenders | GeBIZ | https://www.gebiz.gov.sg/ | unknown | Supplier directory / opportunities | 2026-11-01: homepage opened, lookup not tested. |
| Trademarks | IPOS | https://www.ipos.gov.sg/ | unknown | unknown | 2026-11-01: homepage opened, register not tested. |
| Court judgments | unknown | unknown | unknown | unknown | not tested |
| Insolvency and bankruptcy | unknown | unknown | unknown | unknown | not tested |
| Sanctions or blacklists | unknown | unknown | unknown | unknown | not tested |

## 9. Website rules (for the full report later)

Legal notice, privacy requirements, domain WHOIS, phone patterns and currency notation: unknown; research outstanding.

## 10. Walled and paid: never checked automatically

Bizfile paid profiles: not purchased. Other walls: unknown.

## 11. Sample companies tested

| Company | Size | Which sources above found it | Notes |
|---|---|---|---|
| DBS Group Holdings Ltd | listed | Companies.sg | 199901152M; other sources not tested. |
| AEM Singapore Pte. Ltd. | unknown | Companies.sg, Indeed | 199200362M; subsidiary of listed AEM Holdings. Size not verified. |
| Tiong Bahru Bakery Pte. Ltd. | unknown | Companies.sg | 201133471H; size not verified. |

A possible test dive is Megawatts Engineering Services Pte Ltd; its website https://www.megawatts.com.sg/about-us/company-profile/ says over 100 Singapore employees, but entity association needs verification. Opened 2026-11-01.

## 12. What went into pack.json, and why

- company-directory: section 4.
- uen: sections 2–4.
- sg-directors: sections 1 and 4; specific people sources remain to be verified.
- triage: sections 2 and 11.
- analyse: sections 3 and 4.
- reflect: empty; no specific verified instruction.
- facts: empty; no specific verified instruction.
- write: section 2.
- people: sections 1 and 11.

## 13. Review and test log

| Date | Pack version (commit) | Company | Result with pack vs. without | Decision |
|---|---|---|---|---|
| 2026-11-01 | draft, uncommitted (reviewer removed `brave_country: SG`, which Brave refuses) | Megawatts Engineering Services Pte Ltd | With pack: identity complete, UEN 199603082W (via sgpbusiness.com and sgpgrid.com, not in this research). Without: identity empty (UEN only inside the facts), every one of 142 sources counted relevant. Facts 79 vs 74, people 61 vs 45, cited sources 49 vs 77 (inflated by the fallback). The 3 extra Brave queries found 4 new sources, none cited. Not a fair comparison: the no-pack run's triage got an LLM content refusal and fell back | Back to draft: research incomplete, extra queries add nothing yet |

## Notes for the reviewer

Research is incomplete: the three samples have not been looked up across every source; size classifications and credibility and website checks require further research. Do not promote or treat this draft as ready for review.
