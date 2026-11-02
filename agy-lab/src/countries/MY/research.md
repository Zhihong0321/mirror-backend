# Malaysia: company research playbook (the baseline)

| | |
|---|---|
| Code | MY |
| Status | live |

Malaysia is where the pipeline was built, so its sources are written into the code itself
(`companydive.ts`, `divedeeper/sections/*`), not into `pack.json`. **Its `pack.json` is empty
on purpose**: a Malaysian dive must stay exactly as it is. `countries.test.ts` fails if the
Malaysia pack changes a single Brave query or prompt.

Use this file as the example of what the pipeline already knows for one country. A new
country's `research.md` should find the same kinds of sources.

## 1. Language and company names

- English for most business information; also Malay and Chinese.
- Legal forms: Sdn. Bhd., Berhad (Bhd.), Enterprise, PLT, Trading. `shortName()` strips the common ones.

## 2. Company identity number

- SSM registration number, issued by Suruhanjaya Syarikat Malaysia (Companies Commission).
- New format: 12 digits (e.g. 201901012345). Old format: digits with a check letter (e.g. 1234567-A).
- The full report checks whether the company's website shows it (`sections/C-merged.ts`).

## 3. Official company register

| Register | URL | Free or paid | How the pipeline uses it |
|---|---|---|---|
| SSM e-Info | https://www.ssm-einfo.my/ | paid per document | Not checked. The report says so. |

## 4. Business information sites

- CTOS (ctoscredit.com.my): walled, snippets only (`WALLED` in `companydive.ts`).
- Facebook and LinkedIn: walled. Brave `site:` queries collect their snippets.

## 8. Credibility checks (built into the full report)

From `sections/K-credibility.ts` and `sections/D-registry.ts`:

| Check | Source |
|---|---|
| Regulator alerts | Bank Negara Financial Consumer Alert list, Securities Commission investor alerts (searched through Exa and Brave, restricted to the regulator's own domain) |
| Court judgments | kehakiman.gov.my, CommonLII, CLJ, LawNet, eLaw |
| Insolvency | MDI insolvency search (paid, not checked), winding-up notices in published sources |
| Stock exchange | Bursa Malaysia |
| Government | .gov.my tender awards, vendor lists, grants, penalties |
| Trademark | MyIPO (needs a login, so not searched) |
| Industry registers | CIDB contractors, SEDA PV providers and investors, MyHIJAU, MPSEA members (solar and construction) |

## 9. Website rules (built into the full report)

- ccTLD .my, with .com.my, .net.my and .org.my. WHOIS: MYNIC (port 43).
- Phone: +60, e.g. 012-716 5685. Currency: RM.

## 10. Walled and paid: never checked automatically

SSM e-Info, CTOS, CCRIS, MDI insolvency search, PDRM Semak Mule, MyIPO.
