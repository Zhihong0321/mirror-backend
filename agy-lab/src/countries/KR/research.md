# South Korea: company research playbook

| | |
|---|---|
| Code | KR |
| Researched by | Grok, 2026-11-01 |
| Reviewed by | |
| Status | draft |

Rules for this file:

- Every source in a table has a URL that you **opened yourself**, and the "Tested" column says what you saw and on which date.
- Write "unknown" if you could not find out. Never guess.
- Never get past a CAPTCHA, a login or a paywall. If one is in the way, write it down: the pipeline will report "not checked" for that source.
- Write in English. Put local-language words in their original script with the English after them, e.g. 대표이사 (CEO).

## 1. Language and company names

- Languages business information is published in: Korean and English. Filings, registers and company footers are in Korean. Listed companies also print an English name.
- Script(s): Hangul. English names use Latin letters. The country-code domain can also be the Korean word 한국.
- Legal forms and their suffixes, as they appear in names: 주식회사 (stock company) and the short form (주), either after the name, as in 삼성전자(주), or before it, as in (주)한컴. 주식회사 라움 puts the full word first. English forms seen on the same records: SAMSUNG ELECTRONICS CO,.LTD (DART prints the comma), HANCOM INC., and RAUM. Other forms such as 유한회사 (limited company) were not on the records opened, so how they are abbreviated is unknown.
- How the same company's name usually differs between English and the local language: DART stores both. 삼성전자(주) is SAMSUNG ELECTRONICS CO,.LTD. (주)한컴 is HANCOM INC. The stock-market short name drops the legal form: 삼성전자, 한컴. A dive typed in English still needs the Hangul name, because the register search is in Hangul.

## 2. Company identity number

| | |
|---|---|
| Name of the number | Two numbers. 사업자등록번호 (business registration number) is the tax number. 법인등록번호 (corporate registration number) identifies the corporation. A 6-digit stock code, such as 005930, is neither. A 통신판매업 신고번호 (mail-order business report number) is a third number and only for sellers who file that report. |
| Who issues it | The business registration number is issued by the National Tax Service (국세청), through a district tax office. The corporate registration number is issued by the court registry. DART, run by the Financial Supervisory Service (금융감독원), displays both for companies that file there. It does not issue them. |
| Format (pattern and a real example) | Business registration number: 10 digits, shown as XXX-XX-XXXXX. Samsung Electronics on DART and on its own footer: 124-81-00998. Hancom: 107-81-52230. Raum: 121-86-39179. Corporate registration number: 13 digits, shown as XXXXXX-XXXXXXX. Samsung Electronics: 130111-0006246. Hancom: 110111-0725064. Raum: 120111-0739477. |
| Must companies show it on their website or invoices by law? | A cybermall operator must show it. On the statute page for the Act on Consumer Protection in Electronic Commerce (전자상거래 등에서의 소비자보호에 관한 법률), the block immediately before Article 11 lists, for the cybermall operator: 대표자 성명 (representative's name), the business address, telephone and email, and 사업자등록번호. Article 13 (제13조, identity and transaction terms) requires a mail-order seller's advertisement to include the trade name and representative's name, address, telephone and email, and the mail-order report number with the office that received it. Whether every company, including one with no online shop, must print the number on its website is unknown. Samsung's footer and Hancom's footer both print the business registration number. |
| Where it usually appears on a company website | The footer. Samsung's page at https://www.samsung.com/sec/info/legal/ was a not-found page on 2026-11-01, and the footer on that response still read: representatives 전영현, 노태문; business registration number 124-81-00998; mail-order report 2000-경기수원-0515; address 경기도 수원시 영통구 삼성로 129; phone 02-2255-0114. Hancom's home page footer (https://www.hancom.com/) reads: (주)한컴; representatives 변성준, 김연수; business registration number 107-81-52230; 2012-경기성남-1092; address 경기도 성남시 분당구 대왕판교로644번길 49 한컴타워 10층. |

## 3. Official company register

| Register | URL | Free or paid | How to look a company up (open page, search form, API, login, CAPTCHA) | What a record gives | Tested |
|---|---|---|---|---|---|
| DART 전자공시시스템 (electronic disclosure), company overview 기업개황 | https://dart.fss.or.kr/dsae001/main.do | Free | Open search form. Search by company name, business registration number or corporate registration number. No login and no CAPTCHA. Covers companies that file: KOSPI (유가증권), KOSDAQ (코스닥), KONEX (코넥스) and other filers (기타법인). It is not a register of every private company. | Korean name, English name, disclosure name, stock code, representatives, market, both numbers, address, homepage, phone, fax, industry, founding date, fiscal month | 2026-11-01. Searching 삼성전자 returned six names. Opening 삼성전자 showed 삼성전자(주), SAMSUNG ELECTRONICS CO,.LTD, stock code 005930, representatives 전영현 and 노태문, KOSPI, corporate number 130111-0006246, business number 124-81-00998, address 경기도 수원시 영통구 삼성로 129, homepage www.samsung.com/sec, phone 02-2255-0114, founded 1969-01-13. Searching 한글과컴퓨터 opened (주)한컴, HANCOM INC., 030520, representatives 변성준 and 김연수, KOSDAQ, 110111-0725064, 107-81-52230, 경기도 성남시 분당구 대왕판교로644번길 49, www.hancom.com, 031-627-7000, software, founded 1990-11-02. Searching 라움 opened 주식회사 라움, RAUM, no stock code, 기타법인, representatives 이진석 and 이현철, 120111-0739477, 121-86-39179, 인천광역시 서구 백범로 978, homepage blank, phone 0325722608, wood treatment, founded 2015-01-01. |
| KIND company list and company summary (Korea Exchange) | https://kind.krx.co.kr/corpgeneral/corpList.do?method=loadInitPage and https://kind.krx.co.kr/common/companysummary.do?method=searchCompanySummary | Free | The listed-company list is an open page with market, industry and name filters. A company summary opens from a name on that list. No login. Calling the list page's name search for 삼성전자 did not show Samsung; the summary itself was readable when opened from a list row. | Listed companies only. Summary: Korean and English name, standard code, stock code, founding date, market, representative, listing date, capital, headcount, phone, industry, products, address, homepage, name-change history, summary accounts | 2026-11-01. The list showed recent listings with industry, products, listing date, representative, homepage and region. The summary opened for 주식회사 인텔리빅스 (IntelliVIX): KOSDAQ, stock code 420610, representative 장정훈, listed 2026-10-30, 157 employees, phone 02-581-3883, homepage www.intellivix.ai, address in 서울특별시 서초구, and 2025 summary accounts. The accounts line says the figures are from NICE평가정보. |
| OpenDART, disclosure use desk | https://opendart.fss.or.kr/disclosureinfo/biz/main.do | Free to read the form. The API needs an authentication key from https://opendart.fss.or.kr/ | The use-desk form is open: company name, year, report name, and a tick list that includes 임원 현황 (officers) and 직원 현황 (staff). No login on that form. A search was not submitted, so a filled record was not seen. The API key page says a key must be applied for. | The form offers company overview items, officers, staff, major shareholders and audit opinion, for companies that filed a periodic report | 2026-11-01. Home and the use desk loaded without a login. No company result was opened. API key not applied for. |
| National Tax Service business-status service | Link labelled 사업자상태조회 on https://www.nts.go.kr/ points at Hometax. The public-data description is https://www.data.go.kr/data/15081808/openapi.do | The data.go.kr page says the API is free after an application. The Hometax form was not reached. | data.go.kr describes a REST API at api.odcloud.kr. Using it needs an application key, which was not requested. Opening the NTS "business status" link, and opening the Hometax path that is usually cited for the status form, both landed on the Hometax main page, which is a login shell. The status form was not shown. No CAPTCHA was shown. | The data.go.kr page says a status call, given only the 10-digit number, returns whether the business is suspended or closed, the tax type, and the closure date. That was read from the description. A live status for a real number was not retrieved. | 2026-11-01. nts.go.kr was readable and linked 사업자상태조회. Hometax main (https://hometax.go.kr/) showed login, membership and certificates, not a status result. data.go.kr page was readable. API not called. |
| Internet Registry Office, 인터넷등기소 (court corporate registry) | https://www.iros.go.kr/index.jsp | unknown. The alert that blocked the lookup mentioned payment. The fee was not shown. | The home page is readable and has a 법인 (corporation) section, including 법인 열람 (view a corporation). Choosing that raised an alert: a security program must be installed for safe payment, and confirming would open the install page. The browser then sat on the install page. The program was not installed. No company record was read. | unknown. The record itself was not opened. | 2026-11-01. Home page readable. Corporate view blocked by the security-program install. Not checked. |

## 4. Business information sites

Third-party sites with directors, address, revenue, headcount or filings.

| Site | URL | What it shows | Free? | Readable without login? | Search tip (e.g. `site:` query) | Tested |
|---|---|---|---|---|---|---|
| bizno | https://bizno.net/article/1248100998 | Business and corporate numbers, English name, industry, phone, size, tax type, status, representative, headcount, address, homepage, mail-order number. It says the status line is live from Hometax and that other fields are collected from public agencies and can be stale. | Free | Yes | `site:bizno.net "{short}"`. A known number opens as /article/ plus the 10 digits with no hyphens. | 2026-11-01. Samsung (1248100998): status 계속사업자 (continuing), representative 전영현, corporate number 130111-0006246, headcount 128094, address in 수원, homepage https://www.samsung.com. Phone on this page was 031-200-1114, while DART showed 02-2255-0114. Mail-order number on this page was 2008-경기수원-415, while the Samsung footer showed 2000-경기수원-0515. Hancom (1078152230): HANCOM INC., 중소기업 (SME), 405 employees, representatives 변성준, 김연수, phone 031-627-7000, homepage http://www.hancom.com/, status continuing. Its mail-order line said 강남-1967, while hancom.com prints 2012-경기성남-1092. Raum (1218639179): 29 employees, SME, representatives 이진석 이현철, phone 032-572-2608, status continuing, homepage http://woodandmaru.co.kr/ (that site was not opened). The address line said 서해구; DART said 서구. |
| Naver securities, Npay 증권 | https://stock.naver.com/domestic/stock/005930/price | Listed-company price, market cap, PER, EPS, PBR, dividend, foreign holding. No directors and no registration numbers on the page that was read. | Free | Yes | Search the 6-digit code. `site:stock.naver.com 005930` | 2026-11-01. Samsung Electronics, KOSPI, code 005930, price 220,500원, market cap 1,289조 1,044억. No login. |
| CompanyWise / WiseReport | https://comp.wisereport.co.kr/company/c1010001.aspx?cmp_cd=005930 | Listed-company price, shareholders, and a short business description. A banner offers a paid report subscription. | The page opened was free. Paid plans are advertised. | Yes for the company-status page | `site:comp.wisereport.co.kr "{short}"` or the stock code in cmp_cd | 2026-11-01. Samsung page showed price 225,000원, shareholders including 삼성생명보험 and 국민연금공단, and a Korean description of DX, DS, SDC and Harman. No login. |
| Saramin 사람인 | https://www.saramin.co.kr/zf_user/search?searchword=삼성전자 | Job ads and, for a group, a list of affiliate company names. | Free | Yes | `site:saramin.co.kr "{short}"` | 2026-11-01. Search 삼성전자: 1,885 results, and a group list that included 삼성전자(주), 삼성전자서비스(주) and 삼성전자판매(주). No CAPTCHA. |
| JobKorea 잡코리아 | https://www.jobkorea.co.kr/Search/?stext=삼성전자 | Job ads. Many hits are partners, shops and delivery contractors, not the company itself. | Free | Yes | `site:jobkorea.co.kr "{company}"` | 2026-11-01. The title said 2,072 results for 삼성전자. The first ads were a partner shop, a system-air-conditioning office and delivery jobs. No CAPTCHA. |
| Wanted 원티드 | https://www.wanted.co.kr/search?query=한글과컴퓨터 | A short company description and open jobs. | Free | Yes | `site:wanted.co.kr "{short}"` | 2026-11-01. 한글과컴퓨터 returned a company card "한컴", IT and contents, three open jobs, and a Korean description of Hancom as an office-software company. |
| THE VC 더브이씨 | https://thevc.kr/ | Startup investment totals by round and sector. Collections are marked as needing a login. | Home figures are free. Some collections say login is required. | Home yes. A company profile was not opened. | `site:thevc.kr "{short}"` | 2026-11-01. Home loaded in Korean with investment counts and a login link. No company page was opened, so what a startup profile shows is unknown. |
| KIPRIS (Korean Intellectual Property Office search) | https://www.kipris.or.kr/khome/main.do | Patents, utility models, designs and trademarks by applicant name. | Free | Yes | `site:kipris.or.kr "{short}"`, or the search box on the home page | 2026-11-01. Searching 삼성전자 opened a result page titled as that query and said 394,289 results. No login. Individual documents were not opened. |

## 5. Reputation and reviews

| Site | URL | What it shows | Readable without login? | Tested |
|---|---|---|---|---|
| Jobplanet 잡플래닛 | https://www.jobplanet.co.kr/companies/30139/reviews/삼성전자 | Employer score, recommendation rate, and review and salary counts. The keyword list and the review text are hidden. | The score page loads. The review text asks for a membership, for the reader to write a review, or for a partner university. | 2026-11-01. 삼성전자(주), manufacturing, score 3.8, 11,459 reviews, 75% would recommend. Keywords were shown as question marks. No CAPTCHA. |
| Naver news | https://search.naver.com/search.naver?where=news&query=삼성전자 | News headlines that name the company. Not a review site. Included here because the review sites below were not opened. | Yes | 2026-11-01. Headlines from 한국경제 (Korea Economic Daily), 연합뉴스 (Yonhap), 머니투데이 and 아시아경제, with short snippets. No login. |

Catch (catch.co.kr), Blind (teamblind.com) and map-review sites were not opened. What they show without a login is unknown.

## 6. Jobs and headcount

| Site | URL | What it shows (headcount, salary, employee reviews) | Readable without login? | Tested |
|---|---|---|---|---|
| bizno | https://bizno.net/ | A headcount figure, with a note that it is updated from pension and employment-insurance sources and can lag. | Yes | 2026-11-01. Samsung 128094명, Hancom 405명, Raum 29명. |
| KIND company summary | https://kind.krx.co.kr/common/companysummary.do?method=searchCompanySummary | 종업원수 (employee count) for a listed company, next to capital and industry. | Yes | 2026-11-01. IntelliVIX: 157명. Samsung and Hancom summaries were not opened on KIND. |
| Saramin, JobKorea, Wanted | See section 4 | Open jobs and, on Wanted, a one-paragraph company description. Not a headcount. | Yes | 2026-11-01, as in section 4. |
| Jobplanet | See section 5 | Review and salary counts, not a full salary table. | Score yes. Salary detail was not opened and the review text is gated. | 2026-11-01. Samsung showed 10,467 salary reviews as a count only. |

## 7. News

| Source | URL | Language | Tested |
|---|---|---|---|
| Naver news search | https://search.naver.com/search.naver?where=news&query=삼성전자 | Korean | 2026-11-01. Free headlines and snippets. Outlets named on the page included 한국경제, 연합뉴스, 머니투데이 and 아시아경제. |
| Korea Economic Daily, search | https://www.hankyung.com/search?query=한글과컴퓨터 | Korean | 2026-11-01. The URL returned an empty document (no title, no body). Not readable in this test. Whether that is a bot block or a failed load is unknown. A 한국경제 headline was readable through Naver news. |

## 8. Credibility checks (for the full report later)

Not used by the pipeline yet. Collect them now so the full report can use them later.

| Check | Source | URL | Free or paid | How to check | Tested |
|---|---|---|---|---|---|
| Regulator warnings / alert lists | Financial Supervisory Service, inspection sanctions. This list is financial companies, not every company. | https://www.fss.or.kr/fss/job/openInfo/list.do?menuNo=200476 | Free | Open list. Search by financial company name. An older list (2008-2010) is linked as 과거제재내용 공시. | 2026-11-01. The current list said 302 items and showed names such as 태성자산운용 주식회사, 농협은행주식회사 and DB손해보험주식회사, with a date and a "view content" link. A non-financial company blacklist was not found. unknown for ordinary companies. |
| Court judgments | Supreme Court site, case search | https://www.scourt.go.kr/ | Free menu. A judgment was not opened. | The home page links 사건검색 (case search), 나의 사건검색 (my case search) and 판례속보 (case-law news). | 2026-11-01. Home and the industry company-search page loaded. Case search itself was not opened, so whether a name search works without a case number is unknown. |
| Insolvency and bankruptcy notices | Supreme Court, rehabilitation and bankruptcy notices, and an industry list of companies in that process | https://www.scourt.go.kr/portal/notice/mainfo/MaSearch.work | Free | The page is a company-name box plus industry categories, under 회생·회사 M&A (rehabilitation and M&A). | 2026-11-01. The form was visible. Submitting 삼성전자 did not change the page, so no result was confirmed. DART filings can also disclose rehabilitation; a rehabilitation filing was not opened. |
| Sanctions or government blacklists | See the FSS row above. A government-wide company blacklist was not opened. | https://www.fss.or.kr/ | Free for the FSS list | Financial companies only, on the page that was opened. | 2026-11-01. No general blacklist page was found in this pass. unknown beyond the FSS financial-company list. |
| Stock exchange (listed companies) | KIND, and DART for filers | https://kind.krx.co.kr/ | Free | Section 3. | 2026-11-01. |
| Government tenders and awards | 나라장터 (KONEPS, the government procurement portal) | https://www.g2b.go.kr/ | Free to read notices | Home page lists bid notices and agency announcements. A search for one company's awards was not run. | 2026-11-01. Home page readable without login: bid notices, fraud warnings and agency announcements. Login exists for registered users. Award search for a named company: not checked. |
| Trademark office | KIPRIS | https://www.kipris.or.kr/khome/main.do | Free | Section 4. Applicant search. | 2026-11-01. 삼성전자 returned 394,289 results across intellectual-property types. A single trademark record was not opened. |

## 9. Website rules (for the full report later)

- Legal notice pages companies must have: There is no German-style Impressum page name. Online sellers print a footer block. The statute page (https://www.law.go.kr/LSW/lsInfoP.do?lsiSeq=282793&chrClsCd=010202&urlMode=lsInfoP&efYd=20260721&ancYnChk=0), Act title 전자상거래 등에서의 소비자보호에 관한 법률, in force 2026-07-21, law number 21312. The block immediately before Article 11 requires a cybermall operator to show the representative's name, business address, telephone, email and business registration number. Article 13 requires a mail-order seller's advertisement to show the trade name and representative, address, telephone, email, and the mail-order report number. Samsung and Hancom put that block in the footer. Companies with no online shop: unknown whether a footer is required.
- Privacy law and what it requires on a website: The privacy statute was not opened. unknown. Hancom's footer links a 개인정보처리방침 (privacy policy), and a notice on the home page said that policy changes on 2026-11-19. What the statute requires was not read.
- Country domain (ccTLD), common second-level domains (e.g. .com.sg), and its WHOIS / RDAP server: KISA WHOIS is https://whois.kr/ (also titled whois.kisa.or.kr). The page says .kr and .한국 domains can be searched, and shows examples kisa.or.kr, 한국인터넷진흥원.kr and 한국인터넷진흥원.한국. A company URL on bizno used .co.kr (woodandmaru.co.kr). samsung.com and hancom.com are .com. Searching samsung.co.kr on 2026-11-01 opened the result page and left the result frame blank, so the registrant record was not read. RDAP server: unknown.
- Phone number format (country code, mobile and landline patterns): The pages print domestic numbers, not an international prefix. Seoul 02-2255-0114 (Samsung on DART and its footer). Gyeonggi 031-627-7000 (Hancom). Incheon 032-572-2608 (Raum). Service numbers 1588-3366 on the Samsung footer and 1566-5192 on the Hancom footer. Mobile pattern: unknown; no mobile number was printed on the pages opened. The +82 form was not printed on those pages.
- Currency, and how amounts are written: 원 (won). Naver securities wrote Samsung's price as 220,500원 and its market cap as 1,289조 1,044억. 조 and 억 are the large-number units used on that page. The ISO code was not printed there.

## 10. Walled and paid: never checked automatically

| Site | Why (login, CAPTCHA, bot wall, paid) |
|---|---|
| iros.go.kr | Viewing a corporation asked for a security-program install and the alert mentioned payment. The record was not read. |
| cretop.com | Home page is a product advertisement with a login form. Company data was not readable without logging in. |
| hometax.go.kr | The business-status link from nts.go.kr landed on the Hometax main page, which is a login shell. The status form did not appear. |
| jobplanet.co.kr | Not fully walled: the score loads. The review text and keyword list need a membership or a review written by the reader. Treat the hidden text as not checked. |
| opendart.fss.or.kr API | The use-desk pages are open. The API needs a key. The key was not requested. |
| data.go.kr business-status API | The description page is open. Calling the API needs an application key. Not called. |
| hankyung.com search | The search URL returned an empty document on 2026-11-01. |

## 11. Sample companies tested

Three real companies: one listed, one mid-size, one small.

| Company | Size | Which sources above found it | Notes |
|---|---|---|---|
| 삼성전자(주) (Samsung Electronics Co., Ltd.) | listed | DART, Naver securities, WiseReport, bizno, JobKorea, Saramin, Jobplanet, KIPRIS, Naver news, the company footer | KOSPI 005930. Business number 124-81-00998. Corporate number 130111-0006246. Homepage www.samsung.com/sec. Representatives on DART: 전영현, 노태문. bizno's phone and mail-order number did not match DART and the footer. |
| (주)한컴 (Hancom Inc.) | mid-size | DART, bizno, Wanted, https://www.hancom.com/ | Also KOSDAQ, code 030520. bizno calls it 중소기업 (SME) and prints 405 employees. Business number 107-81-52230. Corporate number 110111-0725064. Representatives 변성준, 김연수. Footer address matches DART. Mail-order number on the footer (2012-경기성남-1092) does not match bizno (강남-1967). |
| 주식회사 라움 (RAUM) | small | DART, bizno | 기타법인 (a filer that is not listed). Business number 121-86-39179. Corporate number 120111-0739477. bizno prints 29 employees and 중소기업. DART homepage was blank. bizno lists http://woodandmaru.co.kr/, which was not opened. Representatives 이진석 and 이현철. Wood treatment, 인천광역시 서구 백범로 978 on DART. |

## 12. What went into pack.json, and why

- `names` includes south korea, korea, republic of korea, and shorter forms people type. From the README examples and section 1. `korea` is included because the task asked for it; a dive started with that word should still use this pack.
- `languages` `en` and `ko`: section 1. Korean is the language of the register and of company footers.
- `search.brave_country` KR, `search.tavily_country` south korea, `search.exa_location` KR: Brave and Exa use the two-letter code; Tavily's country list spells it south korea.
- `discover` `dart`: section 3. `site:dart.fss.or.kr` is the filing register that Brave can query by name.
- `discover` `bizno`: section 4. Finds private and listed companies, with both numbers, when DART has no file.
- `discover` `kind`: section 3. Listed-company summary: representative, headcount, address.
- `discover` `brn`: section 2. The footer and DART label the 10-digit number 사업자등록번호.
- `discover` `ceo`: sections 2 and 3. 대표이사 (representative director) is the word on DART, KIND and footers.
- `discover` `jobs-ko`: section 4. Saramin's search is readable and lists the company and its affiliates.
- `discover` `reviews-ko`: section 5. Jobplanet is the review site that loaded.
- `discover` `news-ko`: section 7. A news query with the short name and the country, because the Naver news search returned Korean coverage.
- `walled` `iros.go.kr`, `cretop.com`, `hometax.go.kr`: section 10.
- `notes.triage`: sections 1 and 2. Name forms, the two number formats, the stock code and the mail-order number, and the Samsung lookalikes.
- `notes.analyse`: sections 3 and 4. Which domains to pass as include_domains, and which hosts not to open.
- `notes.reflect`: section 2. Where to look again for a missing number, and not to confuse the mail-order number with it.
- `notes.facts`: section 11. Samsung and Hancom showed that bizno and the company site can disagree.
- `notes.write`: sections 2 and 3. What the identity section should name, and that the court extract was not read.
- `notes.people`: sections 3 and 5. Where representatives are printed, and that Jobplanet's review text is gated.

## 13. Review and test log

Filled in by the reviewer, never by the researcher. One row per test dive (SOP step 5).

| Date | Pack version (commit) | Company | Result with pack vs. without | Decision |
|---|---|---|---|---|
| | | | | |

## Notes for the reviewer

- The court registry (iros.go.kr) is the place that holds directors for a private company that does not file on DART. It could not be read without installing a security program. A pack cannot query it. If private-company directors matter, that needs a decision from the owner, not a change in this folder.
- Hometax business-status and the data.go.kr API confirm a 10-digit number only after a key or a form that did not load here. The pack tells the dive not to treat a missing status as a closed business.
- Suggested test dive: (주)한컴, Hancom Inc., website https://www.hancom.com/. Mid-size (bizno: 405 employees, SME), KOSDAQ, and the footer prints the business registration number.
- Catch, Blind, Rocketpunch and Moneypin were not opened.
