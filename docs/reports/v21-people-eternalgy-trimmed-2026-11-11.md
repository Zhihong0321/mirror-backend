# Step 1.6 people test: Eternalgy Sdn Bhd (prod, 2026-11-10)

Run on company-diver-production, report `7d671bd1-9bdc-4c45-975b-fa0089b4eb44`, run `065254e5-97b8-4958-aad5-49ec9bb537f0`, status **done**.

## Trimmed vs full run (same company, both on prod)

| | Full run (2026-11-10) | Trimmed run |
|---|---|---|
| Paid search calls | 51 | 14 |
| Exa cost | $0.54 | $0.11 |
| Time | over 30 min (cut at round 3) | 15 min, of which 12 min was one failed read of llms.txt |
| Outside items found (not on eternalgy.me) | 23 | 14 of those 23, plus new ones (another staff name, admin@eternalgy.com, another company phone) |

Real losses: one staff profile (a senior design engineer, found only by the dropped "engineer technician" Exa people search)
and one phone variant (found only by Brave). The other 7 "missed" items were either found in a different form, or were
people at other companies (namesakes).

Two bugs in the trimmed step:
1. Reading llms.txt failed: the file lists about 40 agents, and the answer ran past the token limit on every lane. That
   cost 12 minutes, and a paid search was needed to find the same file again. Fix: read long own-site files in chunks.
2. The same person was searched 3 times under different spellings ("Gan Lai Soon", "Mr.Gan LaiSoon", "lai soon gan").
   Fix: match names on their sorted letters, so each person is searched once.

## Answer: how many calls are needed

- Calls made: **14** (0 failed). Exa cost reported: $0.114. LLM reads: 21 (1 failed).
- People and contacts found beyond what Step 1 already had: **60**.
- The same 60 items come from only **8 call(s)**: `R3N1` exa-web ""GAN LAI HOCK" Eternalgy" (+40); `P1` exa-people "people who work at Eternalgy, Solar PV company, Malaysia" (+6); `R2N7` exa-web ""lai soon gan" Eternalgy" (+5); `R2N8` exa-web ""safwan nazri" Eternalgy" (+3); `O1` own-site "(llms.txt and linked PDFs on the official site, free worker read)" (+2); `P2` exa-people "Eternalgy Sdn Bhd founder director CEO" (+2); `T1` tavily "Eternalgy Sdn Bhd Malaysia founder news" (+1); `R2N1` exa-web ""Ahmad Safwan bin Ahmad Nazri" Eternalgy" (+1).
- Calls that found nothing new: **1** of 14.

## By tool

| Tool | Calls | Failed | Found something new | Items only this tool's calls found |
|---|---|---|---|---|
| own-site | 1 | 0 | 1 | 1 |
| exa-web | 10 | 0 | 9 | 44 |
| exa-people | 2 | 0 | 2 | 5 |
| tavily | 1 | 0 | 1 | 1 |

## Every call

| Call | Round | Tool | Query | Hits | Hits naming the brand | Items | New vs Step 1 | Only this call | Error |
|---|---|---|---|---|---|---|---|---|---|
| S1 | 0 | step1-pages | (pages Step 1 read) | 19 | 16 | 9 | 0 | 0 |  |
| O1 | 0 | own-site | (llms.txt and linked PDFs on the official site, free worker read) | 2 | 2 | 5 | 2 | 1 |  |
| W1 | 1 | exa-web | Eternalgy Sdn Bhd director founder | 10 | 9 | 8 | 5 | 0 |  |
| P1 | 1 | exa-people | people who work at Eternalgy, Solar PV company, Malaysia | 25 | 6 | 6 | 6 | 3 |  |
| P2 | 1 | exa-people | Eternalgy Sdn Bhd founder director CEO | 25 | 4 | 5 | 5 | 2 |  |
| T1 | 1 | tavily | Eternalgy Sdn Bhd Malaysia founder news | 10 | 10 | 4 | 1 | 1 |  |
| R2N4 | 2 | exa-web | "MISS Khoo" Eternalgy | 10 | 0 | 0 | 0 | 0 |  |
| R2N2 | 2 | exa-web | "Ahmad Faruoqi bin Ibrahim" Eternalgy | 10 | 4 | 4 | 1 | 0 |  |
| R2N5 | 2 | exa-web | "Mr.Gan LaiSoon" Eternalgy | 3 | 3 | 2 | 1 | 0 |  |
| R2N8 | 2 | exa-web | "safwan nazri" Eternalgy | 10 | 5 | 7 | 4 | 3 |  |
| R2N1 | 2 | exa-web | "Ahmad Safwan bin Ahmad Nazri" Eternalgy | 5 | 4 | 5 | 2 | 1 |  |
| R2N6 | 2 | exa-web | "Mr. Lim Kim Chang" Eternalgy | 3 | 2 | 4 | 1 | 0 |  |
| R2N3 | 2 | exa-web | "Mr. Gan Lai Soon" Eternalgy | 10 | 4 | 5 | 4 | 0 |  |
| R2N7 | 2 | exa-web | "lai soon gan" Eternalgy | 10 | 10 | 8 | 7 | 1 |  |
| R3N1 | 3 | exa-web | "GAN LAI HOCK" Eternalgy | 10 | 9 | 40 | 40 | 39 |  |

## What was found beyond Step 1 (raw; Step 2 judges)

| Type | Value | Role as written | Found by | Source |
|---|---|---|---|---|
| Person | Mr. Lim Kim Chang | General Manager | O1, W1, R2N6, R2N2, R2N1 | https://eternalgy.me/docs/eternalgy-corporate-profile-2026.pdf |
| Contact | +60 11-2100 0099; admin@eternalgy.com |  | O1 | https://eternalgy.me/docs/eternalgy-corporate-profile-2026.pdf |
| Person | MISS Khoo |  | T1 | https://www.facebook.com/eternalgy/videos/-congratulations-to-miss-khoo-for-choosing-etern |
| Person | Mr.Gan LaiSoon | Founder and Chief Executive Officer | W1, R2N5, R2N3, R2N7 | https://eternalgy.me/docs/eternalgy-corporate-profile-2026.pdf |
| Contact | 12729 9201; admin@eternalgy.my | Director | W1, R2N3, R2N7 | https://myhijau.veecotech.com.my/directory/print-product/16592 |
| Contact | 112100 0099; admin@eternalgy.my | Management | W1, R2N3, R2N7 | https://myhijau.veecotech.com.my/directory/print-product/16592 |
| Person | lai soon gan | Chief Executive Officer at Eternalgy | P2, P1, R2N7 | https://my.linkedin.com/in/lai-soon-gan-57277231a |
| Person | Safwan Nazri | Technical Sales Manager at Eternalgy Sdn Bhd | P2, P1, W1, R2N8 | https://linkedin.com/in/ahmadsafwan0305 |
| Person | MOCH YUSRON | Site Manager at Syntek Energy & Control | P2 | https://id.linkedin.com/in/moch-yusron-b5141b138 |
| Person | Adly Harith | Technical Manager (Power) at UEM Lestra Berhad | P2, P1 | https://my.linkedin.com/in/adly-harith-60312b127 |
| Person | Amanda Ching | team Beazley | P2 | https://my.linkedin.com/in/adly-harith-60312b127 |
| Person | Muhammad Ukail Akmal | Solar Design Engineer at Eternalgy Sdn Bhd / BE Electrical E | P1 | https://my.linkedin.com/in/muhammad-ukail-akmal-4023b4357 |
| Person | Adam Hafiz |  | P1 | https://my.linkedin.com/in/adam-hafiz-aaab20388 |
| Person | Yeap Elise | Human Resources at Eternalgy Sdn Bhd | P1 | https://my.linkedin.com/in/yeap-elise-3a07023b0 |
| Contact | 1523087 |  | R2N8 | https://my.linkedin.com/company/eternalgy-sdn-bhd |
| Contact | 202301029164 |  | R2N8 | https://my.linkedin.com/company/eternalgy-sdn-bhd |
| Contact | 01157681744/WhatsApp |  | R2N8 | https://www.linkedin.com/posts/ahmadsafwan0305_were-hiring-solar-wiring-team-join-activity |
| Contact | Telefon : 0127165685 E-mel : admin@eternalgy.my | Technical Officer | R2N1 | https://solardir.com/providers/eternalgy-sdn-bhd/ |
| Contact | 1120672895 |  | R2N3, R2N7 | https://myhijau.veecotech.com.my/directory/print-product/16592 |
| Contact | +6011-2067 2895; enquiry@eternalgy.me |  | R2N7 | https://www.newpages.com.my/v2/en/company/826360/Eternalgy-Sdn-Bhd.html |
| Person | GAN LAI HOCK | named area representative for this locality | R2N7, R3N1 | https://eternalgy.me/agent/selangor/bandar-sunway |
| Contact | +60 11-6878 0422 | ADMIN | R3N1 | https://eternalgy.me/llms.txt |
| Person | ANG KOK XING |  | R3N1 | https://eternalgy.me/llms.txt |
| Contact | +60 11-1098 8627 |  | R3N1 | https://eternalgy.me/llms.txt |
| Person | Azharuddin bin abdullah |  | R3N1 | https://eternalgy.me/llms.txt |
| Contact | +60 18-918 7004 |  | R3N1 | https://eternalgy.me/llms.txt |
| Person | Beckham Koh Pay Kern |  | R3N1 | https://eternalgy.me/llms.txt |
| Contact | +60 11-5588 1260 |  | R3N1 | https://eternalgy.me/llms.txt |
| Contact | +60 11-6367 2768 |  | R3N1 | https://eternalgy.me/llms.txt |
| Person | Brendon Lew Chok Yew |  | R3N1 | https://eternalgy.me/llms.txt |
| Contact | +60 16-620 9638 |  | R3N1 | https://eternalgy.me/llms.txt |
| Person | Carol Siow |  | R3N1 | https://eternalgy.me/llms.txt |
| Contact | +60 13-242 7568 |  | R3N1 | https://eternalgy.me/llms.txt |
| Person | Caryn Dong |  | R3N1 | https://eternalgy.me/llms.txt |
| Contact | +60 16-717 3533 |  | R3N1 | https://eternalgy.me/llms.txt |
| Person | CHAN WING ON |  | R3N1 | https://eternalgy.me/llms.txt |
| Contact | +60 10-718 7786 |  | R3N1 | https://eternalgy.me/llms.txt |
| Person | Chee Kai Kian |  | R3N1 | https://eternalgy.me/llms.txt |
| Contact | +60 17-750 6708 |  | R3N1 | https://eternalgy.me/llms.txt |
| Person | CHOONG YE HONG |  | R3N1 | https://eternalgy.me/llms.txt |
| Contact | +60 10-769 1033 |  | R3N1 | https://eternalgy.me/llms.txt |
| Person | DEAN WAI LEONG YEE |  | R3N1 | https://eternalgy.me/llms.txt |
| Contact | +60 10-760 0724 |  | R3N1 | https://eternalgy.me/llms.txt |
| Person | Desmond Kong |  | R3N1 | https://eternalgy.me/llms.txt |
| Contact | +60 11-6795 8775 |  | R3N1 | https://eternalgy.me/llms.txt |
| Person | Elaine Ng Yie Kie |  | R3N1 | https://eternalgy.me/llms.txt |
| Contact | +60 19-334 5208 |  | R3N1 | https://eternalgy.me/llms.txt |
| Person | FarishaAnum Hussin |  | R3N1 | https://eternalgy.me/llms.txt |
| Contact | +60 17-729 2457 |  | R3N1 | https://eternalgy.me/llms.txt |
| Person | FONG MEI TENG |  | R3N1 | https://eternalgy.me/llms.txt |
| Contact | +60 17-755 8599 |  | R3N1 | https://eternalgy.me/llms.txt |
| Contact | +60 16-720 3396 |  | R3N1 | https://eternalgy.me/llms.txt |
| Person | GAN ZHI HONG |  | R3N1 | https://eternalgy.me/llms.txt |
| Contact | +60 11-2100 0099 |  | R3N1 | https://eternalgy.me/llms.txt |
| Person | Gui choon fong |  | R3N1 | https://eternalgy.me/llms.txt |
| Contact | +60 16-723 4112 |  | R3N1 | https://eternalgy.me/llms.txt |
| Person | GUI KIAN WEE |  | R3N1 | https://eternalgy.me/llms.txt |
| Contact | +60 16-767 0234 |  | R3N1 | https://eternalgy.me/llms.txt |
| Contact | +60 18-781 3228 |  | R3N1 | https://eternalgy.me/llms.txt |
| Person | LAI HOCK | named area representative | R3N1 | https://eternalgy.me/agent/terengganu/marang |

Step 1 already had: Ahmad Safwan bin Ahmad Nazri; Ahmad Faruoqi bin Ibrahim; Mr. Gan Lai Soon; +6011-2067 2895; enquiry@eternalgy.me; 60143419327; 601156538147; support@newpages.com.my; 03-12345678.

Left unsearched at the round limit: MOCH YUSRON; Adly Harith; Amanda Ching; Muhammad Ukail Akmal; Adam Hafiz; Yeap Elise; ANG KOK XING; Azharuddin bin abdullah; Beckham Koh Pay Kern; Brendon Lew Chok Yew; Carol Siow; Caryn Dong; CHAN WING ON; Chee Kai Kian; CHOONG YE HONG; DEAN WAI LEONG YEE; Desmond Kong; Elaine Ng Yie Kie; FarishaAnum Hussin; FONG MEI TENG; GAN ZHI HONG; Gui choon fong; GUI KIAN WEE; LAI HOCK.

How an item is counted: it was read from a hit whose URL, title or text carries the brand word (eternalgy), or from Step 1's pages, or from an assistant answer. That is a mechanical count for this test, not Step 2's judgement.
