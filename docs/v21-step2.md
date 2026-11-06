# Company Dive V2.1 — Step 2 Design (Analyse)

## 1. What Step 2 Does

Step 2 takes what Step 1 gathered and **judges** it. It does not gather new data (Step 1) and does not write the client report (Step 3).

The company dive is free bait for a $59 report. The owner knows their business; the bait is the gap between what the company says (official site, own LinkedIn) and what the internet says in places they do not watch:
- Different phones, addresses, and legal names in directories, Maps, and registers.
- Renamed, stale, or conflicting profiles (profile drift).
- Accreditations, awards, or directory recognitions they earned but do not display (missed advantages).
- Regulatory listings, sanctions, or warnings.
- Staff and customer review signals (low ratings, unmonitored review volumes, workplace complaints).

Step 2's hardest job is discipline: **never treat "a search found nothing" as a finding**, and **drop namesakes** before they pollute the report.

---

## 2. Input

Step 2 reads `step1_research.json` (`RawResearchCheckpoint`):
- `input`: company, country, industry, website.
- `skipped`: string if Step 1 skipped the company (no official site confirmed).
- `official_site`: domain, resolved URL, tried candidates, and `pages` (`home`, `about`, `contact` with full text).
- `third_party_discoveries`: search hits (URL, title, snippets, query).
- `probes`: catalog checks with queries, evidence URLs, snippets, or static pages read.
- `google_maps`: raw worker search with `businesses` array or error.
- `linkedin`: raw worker company read with `data` (website, phone, HQ, founded, company_type, size, about) or error/not_run.
- `naver_place` (South Korea only): raw Place results (`name`, `category`, `address`, `roadAddress`, `phone`, `visitorReviewCount`, `blogCafeReviewCount`).

---

## 3. Output JSON Shape (`step2_analysis.json`)

Saved next to `step1_research.json` in each run folder:

```json
{
  "version": "2.1",
  "stage": 2,
  "created_at": "2026-11-04T12:00:00.000Z",
  "input": {
    "company": "DNE Logistics",
    "country": "Malaysia",
    "industry": "Freight forwarder",
    "website": "dnelogistics.com.my"
  },
  "status": "analyzed", // "analyzed" | "skipped" | "failed"
  "skip_reason": null,
  "error": null,
  "baseline": {
    "official_domain": "dnelogistics.com.my",
    "pages_present": ["home", "about", "contact"],
    "brand_names": ["DNE Logistics", "DNE Group"],
    "legal_names": ["DNE Forwarding (M) Sdn Bhd"],
    "phones": ["03-3324 2868"],
    "addresses": ["53, Persiaran Pegaga, Taman Bayu Perdana, 41200 Klang, Selangor"]
  },
  "findings": [
    {
      "id": "f1",
      "type": "contradiction", // "contradiction" | "outdated" | "unproven" | "missed_advantage" | "profile_drift" | "staff_review_risk" | "disciplinary_warning"
      "category": "contact", // "contact" | "identity" | "licence" | "awards" | "reputation"
      "title": "Directory carries outdated phone and address",
      "claim": "Official site lists 03-3324 2868 at 53 Persiaran Pegaga, Klang",
      "outside_source": "MyPages Malaysia directory lists phone 03-3324 4027 at No. 2A, Jalan Batu Unjur 1, Klang",
      "source_name": "MyPages Malaysia",
      "source_url": "https://mypages.my/listing/dne-logistics-sdn-bhd/",
      "quoted_text": "Address : No. 2A, Jalan Batu Unjur 1, Bayu Perdana, Klang, 41200... Phone : 03-3324 4027",
      "confidence": "high", // "high" | "medium"
      "identity_justification": "Matches company registration id my5590 and Bayu Perdana Klang locality."
    }
  ],
  "dropped_namesakes": [
    {
      "name": "DNE Express Logistics Ltd",
      "url": "https://www.dneexpresslogisticsltd.com",
      "snippet": "DNE Express Logistics Ltd is a licensed Customs Broker...",
      "reason_dropped": "Independent international entity with different domain and corporate registration; not the Malaysian SME."
    }
  ],
  "could_not_check": [
    {
      "target": "LinkedIn",
      "reason": "Not run in this batch run."
    }
  ],
  "stats": {
    "findings_count": 1,
    "dropped_namesakes_count": 1,
    "could_not_check_count": 1,
    "llm_calls": 1,
    "duration_ms": 4200
  }
}
```

---

## 4. The Rules

### Rule 1: "Not found is not a finding"
- A probe or search returning 0 hits (e.g. `evidence_urls: []`, empty snippets) is **never** a finding.
- A company not appearing on a generic regulatory sanctions list (e.g. AOB sanctions, MIA disciplinary) means clean record; it is **never** a negative finding.
- The only time an absence is a finding is when:
  1. The official site explicitly claims an accreditation, registration, or award, AND
  2. The authoritative registry was read whole and the company is demonstrably absent (`unproven`).
- If not claimed and not found, ignore it or record under `could_not_check`.

### Rule 2: Drop namesakes (Strict Entity Resolution)
- Search engines match keywords, not legal entities. Step 2 must drop:
  - Different countries (e.g. `digitalnext.co.uk` vs Australian Digital Next; UK Companies House for Chromatix).
  - Different domains / business lines (e.g. `planiedu.co.kr` education app vs `plani.co.kr` IT solution provider; `V. Alexander & Co.` US customs broker vs `Alexander &CO.` Sydney architecture).
- Every dropped item is recorded in `dropped_namesakes` with URL and reason. Never accuse the client of a namesake's data.

### Rule 3: Own-site filtering
- URLs from the company's own domain (`dnelogistics.com.my`, `chromatix.com.au`) are filtered out of third-party evidence.
- Company's own LinkedIn page is evaluated exclusively for **Profile Drift** (stale data they published and forgot), not as a third-party discovery.

### Rule 4: Contradictions & Outdated Claims
- **Phone / Address drift**: Outside directories (LeadIQ, ZoomInfo, MyPages, RocketReach) or Maps listings displaying numbers/addresses not on the official contact page.
- **Legal name discrepancy**: Site footer vs Google Maps vs directory listings (e.g. YYC Holdings Sdn Bhd vs YYC Advisors Sdn Bhd; DNE Forwarding vs DNE Logistics).
- **Licence expiry**: Expired or nearing expiration dates (e.g. Dezeno CIDB registration).

### Rule 5: Missed Advantages
- External authoritative registers or award lists confirm an award or recognition (e.g. Australian Web Awards, d Awards, GDWEB, Web Award Korea) that is **not** showcased on the official site.
- High-value positive bait: "You won this, but customers searching your site cannot see it."

### Rule 6: Staff & Review Signals
- Public employee reviews (Glassdoor, JobStreet, JobPlanet, Indeed, SEEK) showing low ratings (<3.5), poor sub-scores (pay, management), or high review counts the owner may not track.
- Customer review gaps: low scores or platform discrepancies (ProvenExpert recommendation rate, Google Maps vs website testimonials).

### Rule 7: Disambiguate multi-branch listings
- Multiple Google Maps or Naver Place listings (e.g. Pitcher Partners 7 offices; 혜움 5 branches; YYC 2 offices) are matched against official site locations:
  - Valid branch offices are recognized as part of the business, not dropped as namesakes.
  - Ratings and details per branch are judged for consistency.

---

## 5. Where LLM is Used vs Where Plain Code is Enough

Keep it simple: **one consolidated LLM call per company**.

### Plain Code handles:
1. **Skipped check**: If `checkpoint.skipped`, write `status: "skipped"` immediately (0 LLM calls).
2. **Missing data recording**: If Maps, LinkedIn, or Naver Place failed/missing, record in `could_not_check`.
3. **Own-site URL stripping**: Filter out URLs matching `official_site.domain`.
4. **Empty probe stripping**: Remove probes with 0 hits / empty snippets / not_run.
5. **Prompt assembly**: Consolidate official baseline + valid third-party hits + non-empty probes into a single clean prompt.
6. **Output validation**: Validate LLM JSON output against schema.

### The Single LLM Call handles:
- Cross-references baseline vs outside evidence.
- Entity resolution: filters namesakes into `dropped_namesakes`.
- Identifies true findings with exact `quoted_text`, `claim`, and `identity_justification`.
- Respects Korean language: evaluates Korean runs in Korean and preserves original Korean quotes.

Why 1 LLM call:
- Fast (~5-15s), minimal token cost, minimal failure surfaces.
- Avoids fragile multi-step loops or prompt cascades.

---

## 6. Failure Handling

1. **Step 1 Skipped**: Clean exit, `status: "skipped"`, `findings: []`, no error.
2. **Step 1 Corrupted / Missing**: Catch JSON parse error, write `status: "failed"` with `error: "Malformed Step 1 JSON"`, runner proceeds.
3. **LLM Lane Failure / Timeout**:
   - `deepseekChat` retries across all enabled hub lanes with 60s timeout.
   - If all lanes fail, catch error, write `status: "failed"` with `error: "All LLM lanes failed"`. The runner logs the error and moves to the next company.
4. **Partial Data**:
   - Missing LinkedIn, failed Maps, or missing Naver Place are recorded in `could_not_check` and do not block analysis of remaining sources.
5. **No Big-Bang / No Aborts**: A failure on one company never stops batch execution.

---

## 7. Test Plan

### Phase A: 20 Real Companies (4 Countries, 5 Industries)
- **Malaysia**: YYC Advisors, Dezeno, Kingdom Digital, DNE Logistics, O2O Digital
- **Singapore**: RSM Singapore, OOm, Makoto-Ya, Space Factor, Verz Design
- **Australia**: Pitcher Partners, Digital Next, Magellan Logistics, Alexander &CO., Chromatix
- **South Korea**: 세무법인 혜움, 애드이피션시, 한국동지무역(주), 은민에스엔디, (주)플랜아이
*(Note: Use `2026-11-04T07-54-03_주-플랜아이` for 플랜아이, skipping the forced-failure folder)*

### Phase B: 3 Skipped Companies
- `이상한 마케팅`, `제이엘무역`, `Nonexistent Widget Trading`
- Verify clean output: `status: "skipped"`, no error, 0 findings, 0 LLM calls.

### Phase C: Forced Failure Verification (Prove before done)
1. **Forced LLM Lane Failure**: Run with dummy lane URL/token; verify `status: "failed"` is cleanly saved and execution continues.
2. **Malformed File**: Run with invalid/truncated JSON; verify `status: "failed"` is cleanly saved.
3. **Forced Naver Failure**: Run on `2026-11-04T07-54-47_주-플랜아이` (Naver failed on purpose); verify Naver recorded in `could_not_check` while remaining sources are analysed cleanly.
