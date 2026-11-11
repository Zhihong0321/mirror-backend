# Step 1.6 people test: Eternalgy Sdn Bhd (prod, 2026-11-10)

Run on company-diver-production, report `7d671bd1-9bdc-4c45-975b-fa0089b4eb44`, run `1fedda0e-0aeb-499b-b5bc-d8c2b940cb37`, status: **rounds 0-2 saved; round 3 was still running when this report was made** (row `round`).

## Answer: how many calls are needed

- Calls made: **51** (2 failed). Exa cost reported: $0.537. LLM reads: 127 (0 failed).
- People and contacts found beyond what Step 1 already had: **64**.
- The same 64 items come from only **15 call(s)**: `R2N8w` exa-web ""Gan Zhi Hong" Eternalgy" (+40); `P1` exa-people "people who work at Eternalgy, Solar PV company, Malaysia" (+6); `W1` exa-web "Eternalgy Sdn Bhd director founder" (+4); `R2N13p` exa-people "Adam Hafiz Eternalgy Malaysia" (+2); `R2N13w` exa-web ""Adam Hafiz" Eternalgy" (+2); `B2` brave ""Eternalgy" Solar PV company Malaysia" (+1); `P2` exa-people "Eternalgy Sdn Bhd founder director CEO" (+1); `T1` tavily "Eternalgy Sdn Bhd Malaysia founder news" (+1); `P4` exa-people "Eternalgy engineer technician project manager Malaysia" (+1); `R2N6w` exa-web ""Safwan Nazri" Eternalgy" (+1); `R2N12w` exa-web ""Muhammad Ukail Akmal" Eternalgy" (+1); `R2N1w` exa-web ""Ahmad Safwan bin Ahmad Nazri" Eternalgy" (+1); `R2N5w` exa-web ""lai soon gan" Eternalgy" (+1); `R2N8p` exa-people "Gan Zhi Hong Eternalgy Malaysia" (+1); `R2N1p` exa-people "Ahmad Safwan bin Ahmad Nazri Eternalgy Malaysia" (+1).
- Calls that found nothing new: **18** of 51.


## Verdict: 51 calls is too many; about 12 do the job

- **41 of the 64 items came from Eternalgy's own site** (llms.txt, agent pages, the 2026 profile PDF), found through one Exa web search (R2N8w). The free worker can read those pages directly, with no search call.
- **The other 23 are from outside the site.** 4 broad calls found 11 of them: P1 Exa people (staff profiles), P2 Exa people (leaders), W1 Exa web (founder/GM), T1 Tavily (news).
- **The per-name round (32 calls) added 12 outside items:** mostly contact strings, plus a few profiles at other companies (namesakes).
- **Brave: 12 calls, nothing that another call didn't also find.** That includes the 4 per-contact searches. Drop Brave from this step, which also saves its limited credit.
- **ChatGPT and Gemini both failed on prod** (no ChatGPT tab on the worker; Gemini quota used up). Leave them out until they work.
- **The LLM reading every hit is the slow part.** The step took over 30 minutes; round 2 alone was about 38 minutes of LLM time across 4 lanes. Read only hits that carry the brand word.

Proposed set per company: P1, P2, W1, T1 + Exa web per new name from brand hits (up to 8) + a free worker read of the site's llms.txt / sitemap / profile PDF. That is about 12 paid calls instead of 51.

This is one company. Check it on 3 to 5 more before fixing the numbers.

## By tool

| Tool | Calls | Failed | Found something new | Items only this tool's calls found |
|---|---|---|---|---|
| chatgpt | 1 | 1 | 0 | 0 |
| brave | 12 | 0 | 3 | 0 |
| exa-web | 17 | 0 | 14 | 43 |
| exa-people | 19 | 0 | 15 | 6 |
| tavily | 1 | 0 | 1 | 1 |
| gemini | 1 | 1 | 0 | 0 |

## Every call

| Call | Round | Tool | Query | Hits | Hits naming the brand | Items | New vs Step 1 | Only this call | Error |
|---|---|---|---|---|---|---|---|---|---|
| S1 | 0 | step1-pages | (pages Step 1 read) | 19 | 16 | 10 | 0 | 0 |  |
| C1 | 1 | chatgpt | who runs and works at the company | 0 | 0 | 0 | 0 | 0 | no active ChatGPT tab connected to local worker on https://chatgpt.com |
| B2 | 1 | brave | "Eternalgy" Solar PV company Malaysia | 19 | 18 | 3 | 1 | 0 |  |
| W2 | 1 | exa-web | Eternalgy Malaysia CEO interview | 10 | 10 | 4 | 3 | 0 |  |
| B1 | 1 | brave | "Eternalgy Sdn Bhd" director OR founder OR CEO | 18 | 4 | 1 | 0 | 0 |  |
| P2 | 1 | exa-people | Eternalgy Sdn Bhd founder director CEO | 25 | 3 | 3 | 3 | 1 |  |
| T1 | 1 | tavily | Eternalgy Sdn Bhd Malaysia founder news | 10 | 10 | 5 | 2 | 1 |  |
| P4 | 1 | exa-people | Eternalgy engineer technician project manager Malaysia | 25 | 2 | 2 | 2 | 0 |  |
| W1 | 1 | exa-web | Eternalgy Sdn Bhd director founder | 10 | 9 | 8 | 5 | 0 |  |
| P1 | 1 | exa-people | people who work at Eternalgy, Solar PV company, Malaysia | 25 | 6 | 6 | 6 | 1 |  |
| P3 | 1 | exa-people | Eternalgy sales consultant agent Malaysia | 25 | 1 | 1 | 1 | 0 |  |
| G1 | 1 | gemini | who runs and works at the company | 0 | 0 | 0 | 0 | 0 | error: Individual quota reached. Please upgrade your subscription to increase yo |
| R2N6w | 2 | exa-web | "Safwan Nazri" Eternalgy | 10 | 5 | 2 | 2 | 1 |  |
| R2K4 | 2 | brave | "601156538147" | 1 | 0 | 0 | 0 | 0 |  |
| R2N12w | 2 | exa-web | "Muhammad Ukail Akmal" Eternalgy | 10 | 9 | 5 | 2 | 1 |  |
| R2N7w | 2 | exa-web | "MOCH YUSRON" Eternalgy | 10 | 0 | 0 | 0 | 0 |  |
| R2N11w | 2 | exa-web | "Mr. Lim Kim Chang" Eternalgy | 3 | 2 | 4 | 1 | 0 |  |
| R2K9 | 2 | brave | "12729 9201; admin@eternalgy.my" | 0 | 0 | 0 | 0 | 0 |  |
| R2K10 | 2 | brave | "112100 0099; admin@eternalgy.my" | 0 | 0 | 0 | 0 | 0 |  |
| R2K2 | 2 | brave | "enquiry@eternalgy.me" | 8 | 8 | 3 | 1 | 0 |  |
| R2N15w | 2 | exa-web | "Adly Harith" Eternalgy | 10 | 0 | 0 | 0 | 0 |  |
| R2K1 | 2 | brave | "+60 1120 672 895" | 0 | 0 | 0 | 0 | 0 |  |
| R2K7 | 2 | brave | "60173230707" | 1 | 0 | 0 | 0 | 0 |  |
| R2N8w | 2 | exa-web | "Gan Zhi Hong" Eternalgy | 10 | 9 | 40 | 40 | 38 |  |
| R2K6 | 2 | brave | "03-12345678" | 19 | 0 | 0 | 0 | 0 |  |
| R2K3 | 2 | brave | "60143419327" | 1 | 1 | 0 | 0 | 0 |  |
| R2K5 | 2 | brave | "support@newpages.com.my" | 12 | 0 | 0 | 0 | 0 |  |
| R2N13p | 2 | exa-people | Adam Hafiz Eternalgy Malaysia | 25 | 3 | 4 | 4 | 2 |  |
| R2N1w | 2 | exa-web | "Ahmad Safwan bin Ahmad Nazri" Eternalgy | 5 | 4 | 5 | 2 | 1 |  |
| R2N9w | 2 | exa-web | "MISS Khoo" Eternalgy | 10 | 0 | 0 | 0 | 0 |  |
| R2N2w | 2 | exa-web | "Ahmad Faruoqi Bin Ibrahim" Eternalgy | 10 | 4 | 4 | 1 | 0 |  |
| R2K8 | 2 | brave | "+6011-2067 2875" | 3 | 3 | 2 | 1 | 0 |  |
| R2N13w | 2 | exa-web | "Adam Hafiz" Eternalgy | 10 | 3 | 4 | 3 | 2 |  |
| R2N10w | 2 | exa-web | "Nurul Ain Hashamuddin Amir" Eternalgy | 3 | 1 | 1 | 1 | 0 |  |
| R2N3p | 2 | exa-people | Mr. Gan Lai Soon Eternalgy Malaysia | 25 | 2 | 2 | 2 | 0 |  |
| R2N4p | 2 | exa-people | Mr.Gan LaiSoon Eternalgy Malaysia | 25 | 1 | 1 | 1 | 0 |  |
| R2N14w | 2 | exa-web | "Yeap Elise" Eternalgy | 10 | 1 | 1 | 1 | 0 |  |
| R2N2p | 2 | exa-people | Ahmad Faruoqi Bin Ibrahim Eternalgy Malaysia | 25 | 0 | 0 | 0 | 0 |  |
| R2N5w | 2 | exa-web | "lai soon gan" Eternalgy | 10 | 10 | 9 | 6 | 0 |  |
| R2N9p | 2 | exa-people | MISS Khoo Eternalgy Malaysia | 25 | 0 | 0 | 0 | 0 |  |
| R2N14p | 2 | exa-people | Yeap Elise Eternalgy Malaysia | 25 | 1 | 1 | 1 | 0 |  |
| R2N8p | 2 | exa-people | Gan Zhi Hong Eternalgy Malaysia | 25 | 1 | 1 | 1 | 1 |  |
| R2N10p | 2 | exa-people | Nurul Ain Hashamuddin Amir Eternalgy Malaysia | 25 | 0 | 0 | 0 | 0 |  |
| R2N6p | 2 | exa-people | Safwan Nazri Eternalgy Malaysia | 25 | 2 | 2 | 2 | 0 |  |
| R2N4w | 2 | exa-web | "Mr.Gan LaiSoon" Eternalgy | 2 | 2 | 2 | 1 | 0 |  |
| R2N1p | 2 | exa-people | Ahmad Safwan bin Ahmad Nazri Eternalgy Malaysia | 25 | 3 | 3 | 3 | 1 |  |
| R2N11p | 2 | exa-people | Mr. Lim Kim Chang Eternalgy Malaysia | 25 | 1 | 1 | 1 | 0 |  |
| R2N12p | 2 | exa-people | Muhammad Ukail Akmal Eternalgy Malaysia | 25 | 1 | 1 | 1 | 0 |  |
| R2N5p | 2 | exa-people | lai soon gan Eternalgy Malaysia | 25 | 2 | 2 | 2 | 0 |  |
| R2N7p | 2 | exa-people | MOCH YUSRON Eternalgy Malaysia | 25 | 0 | 0 | 0 | 0 |  |
| R2N3w | 2 | exa-web | "Mr. Gan Lai Soon" Eternalgy | 10 | 4 | 5 | 4 | 0 |  |
| R2N15p | 2 | exa-people | Adly Harith Eternalgy Malaysia | 25 | 1 | 1 | 1 | 0 |  |

## What was found beyond Step 1 (raw; Step 2 judges)

| Type | Value | Role as written | Found by | Source |
|---|---|---|---|---|
| Contact | +6011-2067 2875 |  | B2, R2K2, R2K8 | https://www.newpages.com.my/v2/en/company/826360/index.html |
| Person | Mr.Gan LaiSoon | Founder and Chief Executive Officer | W2, W1, R2N5w, R2N4w, R2N3w | https://eternalgy.me/docs/eternalgy-corporate-profile-2026.pdf |
| Contact | 12729 9201; admin@eternalgy.my | Director | W2, W1, R2N5w, R2N3w | https://myhijau.veecotech.com.my/directory/print-product/16592 |
| Contact | 112100 0099; admin@eternalgy.my | Management | W2, W1, R2N5w, R2N3w | https://myhijau.veecotech.com.my/directory/print-product/16592 |
| Person | lai soon gan | Chief Executive Officer at Eternalgy | P2, P1, R2N3p, R2N4p, R2N5w, R2N5p | https://my.linkedin.com/in/lai-soon-gan-57277231a |
| Person | Safwan Nazri | Solar Engineer / OSH Coordinator | P2, P4, W1, P1, P3, R2N6w, R2N13p, R2N3p, R2N6p, R2N1p, R2N5p, R2N15p, R2N11p | https://linkedin.com/in/ahmadsafwan0305 |
| Person | MOCH YUSRON | Site Manager at Syntek Energy & Control | P2 | https://id.linkedin.com/in/moch-yusron-b5141b138 |
| Person | Gan Zhi Hong |  | T1, R2N8w | https://x.com/eternalgymy |
| Person | MISS Khoo |  | T1 | https://www.facebook.com/eternalgy/videos/-congratulations-to-miss-khoo-for-choosing-etern |
| Person | Nurul Ain Hashamuddin Amir | Senior Design Engineer | P4, R2N10w | https://my.linkedin.com/in/ainhashamuddin |
| Person | Mr. Lim Kim Chang | General Manager | W1, R2N11w, R2N1w, R2N2w | https://eternalgy.me/docs/eternalgy-corporate-profile-2026.pdf |
| Person | Muhammad Ukail Akmal | Solar Design Engineer at Eternalgy Sdn Bhd | P1, R2N12w, R2N12p | https://my.linkedin.com/in/muhammad-ukail-akmal-4023b4357 |
| Person | Adam Hafiz | at Eternalgy Sdn Bhd (? to now) | P1, R2N13p, R2N13w, R2N6p, R2N1p | https://my.linkedin.com/in/adam-hafiz-aaab20388 |
| Person | Yeap Elise | Human Resources at Eternalgy Sdn Bhd | P1, R2N14w, R2N14p | https://my.linkedin.com/in/yeap-elise-3a07023b0 |
| Person | Adly Harith | Technical Manager (Power) at UEM Lestra Berhad | P1 | https://my.linkedin.com/in/adly-harith-60312b127 |
| Contact | Tel: + ... -2067 2895 Email: enquiry ... |  | R2N12w | https://www.newpages.com.my/v2/en/company/826360/Eternalgy-Sdn-Bhd.html |
| Contact | 01157681744/WhatsApp |  | R2N6w | https://www.linkedin.com/posts/ahmadsafwan0305_were-hiring-solar-wiring-team-join-activity |
| Contact | +60 11-6878 0422 | ADMIN | R2N8w | https://eternalgy.me/llms.txt |
| Person | ANG KOK XING |  | R2N8w | https://eternalgy.me/llms.txt |
| Contact | +60 11-1098 8627 |  | R2N8w | https://eternalgy.me/llms.txt |
| Person | Azharuddin bin abdullah |  | R2N8w | https://eternalgy.me/llms.txt |
| Contact | +60 18-918 7004 |  | R2N8w | https://eternalgy.me/llms.txt |
| Person | Beckham Koh Pay Kern |  | R2N8w | https://eternalgy.me/llms.txt |
| Contact | +60 11-5588 1260 |  | R2N8w | https://eternalgy.me/llms.txt |
| Contact | +60 11-6367 2768 |  | R2N8w | https://eternalgy.me/llms.txt |
| Person | Brendon Lew Chok Yew |  | R2N8w | https://eternalgy.me/llms.txt |
| Contact | +60 16-620 9638 |  | R2N8w | https://eternalgy.me/llms.txt |
| Person | Carol Siow |  | R2N8w | https://eternalgy.me/llms.txt |
| Contact | +60 13-242 7568 |  | R2N8w | https://eternalgy.me/llms.txt |
| Person | Caryn Dong |  | R2N8w | https://eternalgy.me/llms.txt |
| Contact | +60 16-717 3533 |  | R2N8w | https://eternalgy.me/llms.txt |
| Person | CHAN WING ON |  | R2N8w | https://eternalgy.me/llms.txt |
| Contact | +60 10-718 7786 |  | R2N8w | https://eternalgy.me/llms.txt |
| Person | Chee Kai Kian |  | R2N8w | https://eternalgy.me/llms.txt |
| Contact | +60 17-750 6708 |  | R2N8w | https://eternalgy.me/llms.txt |
| Person | CHOONG YE HONG |  | R2N8w | https://eternalgy.me/llms.txt |
| Contact | +60 10-769 1033 |  | R2N8w | https://eternalgy.me/llms.txt |
| Person | DEAN WAI LEONG YEE |  | R2N8w | https://eternalgy.me/llms.txt |
| Contact | +60 10-760 0724 |  | R2N8w | https://eternalgy.me/llms.txt |
| Person | Desmond Kong |  | R2N8w | https://eternalgy.me/llms.txt |
| Contact | +60 11-6795 8775 |  | R2N8w | https://eternalgy.me/llms.txt |
| Person | Elaine Ng Yie Kie |  | R2N8w | https://eternalgy.me/llms.txt |
| Contact | +60 19-334 5208 |  | R2N8w | https://eternalgy.me/llms.txt |
| Person | FarishaAnum Hussin |  | R2N8w | https://eternalgy.me/llms.txt |
| Contact | +60 17-729 2457 |  | R2N8w | https://eternalgy.me/llms.txt |
| Person | FONG MEI TENG |  | R2N8w | https://eternalgy.me/llms.txt |
| Contact | +60 17-755 8599 |  | R2N8w | https://eternalgy.me/llms.txt |
| Person | GAN LAI HOCK |  | R2N8w, R2N5w | https://eternalgy.me/llms.txt |
| Contact | +60 16-720 3396 |  | R2N8w | https://eternalgy.me/llms.txt |
| Contact | +60 11-2100 0099 |  | R2N8w | https://eternalgy.me/llms.txt |
| Person | Gui choon fong |  | R2N8w | https://eternalgy.me/llms.txt |
| Contact | +60 16-723 4112 |  | R2N8w | https://eternalgy.me/llms.txt |
| Person | GUI KIAN WEE |  | R2N8w | https://eternalgy.me/llms.txt |
| Contact | +60 16-767 0234 |  | R2N8w | https://eternalgy.me/llms.txt |
| Contact | +60 18-781 3228 |  | R2N8w | https://eternalgy.me/llms.txt |
| Person | GAN ZHI ... | representative for this locality | R2N8w | https://eternalgy.me/agent/terengganu/bukit-payung |
| Contact | 0127165685; admin@eternalgy.my | Technical Officer | R2N1w | https://solardir.com/providers/eternalgy-sdn-bhd/ |
| Person | Pradeep Kumar |  | R2N13p | https://my.linkedin.com/in/adam-hafiz-aaab20388 |
| Contact | 017-726 6916 |  | R2N13w | https://www.linkedin.com/posts/adam-hafiz-aaab20388_we-are-hiring-company-eternalgy-sdn-ac |
| Contact | 1523087, +60-143419327, +6011-2067 2895, 202301029164 |  | R2N13w | https://my.linkedin.com/company/eternalgy-sdn-bhd |
| Person | HAKIM RAIMI | Electrical Technician at CPF Group | R2N13p | https://my.linkedin.com/in/hakim-raimi-833029385 |
| Contact | 1120672895 |  | R2N5w, R2N3w | https://myhijau.veecotech.com.my/directory/print-product/16592 |
| Person | Zhi Hong Gan | Retail Sales Manager at Eternalgy Sdn Bhd | R2N8p | https://my.linkedin.com/in/zhi-hong-gan-a93a51415 |
| Person | Nur Anisah Mohd Razali | Records and Projects Communication Manager at ERS Energy Sdn | R2N1p | https://my.linkedin.com/in/nur-anisah-mohd-razali-219784136 |

Step 1 already had: Ahmad Safwan bin Ahmad Nazri; Ahmad Faruoqi bin Ibrahim; Mr. Gan Lai Soon; +6011-2067 2895; enquiry@eternalgy.me; 60143419327; 601156538147; support@newpages.com.my; 03-12345678; 60173230707.

Left unsearched at the round limit: none.

How an item is counted: it was read from a hit whose URL, title or text carries the brand word (eternalgy), or from Step 1's pages, or from an assistant answer. That is a mechanical count for this test, not Step 2's judgement.
