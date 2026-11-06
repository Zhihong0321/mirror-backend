import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getLlmLanes, type ChatMessage } from './cloud.ts';
import type { RawResearchCheckpoint } from './research.ts';
import { tidyCheckpoint } from './tidy.ts';
import { judgeTidy, type Lane } from './judge.ts';
import type { RejectedFinding } from './check-findings.ts';
import { recheckTidy, type RecheckResult } from './recheck.ts';
import { saveBenchRow, type BenchRow } from './bench-db.ts';

export type AnalysisStatus = 'analyzed' | 'skipped' | 'failed';

export type FindingType =
  | 'contradiction'
  | 'outdated'
  | 'unproven'
  | 'missed_advantage'
  | 'profile_drift'
  | 'staff_review_risk'
  | 'disciplinary_warning'
  | 'other';

export type FindingCategory =
  | 'contact'
  | 'identity'
  | 'licence'
  | 'awards'
  | 'reputation'
  | 'registration';

export type FindingConfidence = 'high' | 'medium';

export type AnalysisFinding = {
  id: string;
  type: FindingType;
  category: FindingCategory;
  title: string;
  claim: string;
  outside_source: string;
  source_name: string;
  source_url: string;
  quoted_text: string;
  confidence: FindingConfidence;
  identity_justification: string;
  /** Tidy run: the evidence item (E#, R#, LINKEDIN, OFFICIAL) the finding rests on. */
  evidence_id?: string;
};

export type DroppedNamesake = {
  name: string;
  url: string;
  snippet: string;
  reason_dropped: string;
  evidence_id?: string;
};

export type CouldNotCheck = {
  target: string;
  reason: string;
};

export type AnalysisBaseline = {
  official_domain: string;
  pages_present: string[];
  brand_names: string[];
  legal_names: string[];
  phones: string[];
  addresses: string[];
  claimed_credentials?: string[];
};

export type Step2AnalysisOutput = {
  version: '2.1';
  stage: 2;
  created_at: string;
  input: {
    company: string;
    country: string;
    industry: string;
    website?: string;
  };
  status: AnalysisStatus;
  skip_reason?: string | null;
  error?: string | null;
  baseline: AnalysisBaseline;
  findings: AnalysisFinding[];
  dropped_namesakes: DroppedNamesake[];
  could_not_check: CouldNotCheck[];
  stats: {
    findings_count: number;
    /** Tidy path: findings the plain-code check refused (kept in rejected_findings). */
    rejected_count?: number;
    dropped_namesakes_count: number;
    could_not_check_count: number;
    llm_calls: number;
    duration_ms: number;
  };
  /** Tidy path only, kept so runs can be benchmarked and re-checked later. */
  rejected_findings?: RejectedFinding[];
  meta?: { prompt: string; lane: string | null; model: string | null; attempts: Array<{ lane: string; model: string; ms: number; error?: string }> };
  llm_raw?: string | null;
  /** Stage 3: the recheck of the judge's findings (the findings above are the rechecked ones). */
  recheck?: RecheckResult;
  /** Rows written to the benchmark store (bench-db.ts), or why not. */
  bench?: { judge_id: number | null; recheck_id: number | null; error: string | null };
};

function cleanDomain(rawUrl: string): string {
  try {
    let u = rawUrl.trim();
    if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
    return new URL(u).hostname.replace(/^www\./i, '').toLowerCase();
  } catch {
    return '';
  }
}

function isOwnDomain(url: string, officialDomain: string): boolean {
  if (!url || !officialDomain) return false;
  const d = cleanDomain(url);
  const target = officialDomain.toLowerCase();
  return d === target || d.endsWith('.' + target);
}

/** Extract condensed text from an official page to capture identity, contact info, footer, and claims. */
function condensePageMarkdown(markdown: string, maxChars = 2000): string {
  if (!markdown) return '';
  const cleaned = markdown
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '') // remove images
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // flatten links
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  if (cleaned.length <= maxChars) return cleaned;
  // Keep start (headline/intro) and end (footer with address, reg no, copyright, contacts)
  const headSize = Math.floor(maxChars * 0.5);
  const tailSize = Math.floor(maxChars * 0.5);
  return cleaned.slice(0, headSize) + '\n\n[... content omitted ...]\n\n' + cleaned.slice(-tailSize);
}

/** Extracts candidate legal names, phones, and addresses from official pages using standard regex patterns. */
function extractBaselineHeuristics(pages: Array<{ label: string; markdown: string }>): {
  legalNames: string[];
  phones: string[];
  addresses: string[];
} {
  const text = pages.map((p) => p.markdown).join('\n');
  const legalNames = new Set<string>();
  const phones = new Set<string>();
  const addresses = new Set<string>();

  // Legal entities
  const legalRe = /([A-Z0-9가-힣][A-Za-z0-9가-힣&.,' ]{2,50}?(?:Sdn\.?\s*Bhd\.?|Bhd\.?|Pte\.?\s*Ltd\.?|Pty\.?\s*Ltd\.?|LLC|Inc\.?|㈜|\(주\)|주식회사|세무법인|회계법인))/g;
  for (const m of text.matchAll(legalRe)) {
    const val = m[1].replace(/[\n\r]/g, ' ').replace(/\s+/g, ' ').trim();
    if (val.length >= 4 && val.length <= 60) legalNames.add(val);
  }

  // Phones
  const phoneRe = /(?:\+?\d{1,3}[-.\s]?)?\(?\d{2,4}\)?[-.\s]?\d{3,4}[-.\s]?\d{3,4}/g;
  for (const m of text.matchAll(phoneRe)) {
    const val = m[0].trim();
    if (val.replace(/\D/g, '').length >= 7 && val.replace(/\D/g, '').length <= 13) phones.add(val);
  }

  return {
    legalNames: [...legalNames].slice(0, 5),
    phones: [...phones].slice(0, 8),
    addresses: [...addresses].slice(0, 5),
  };
}

/** Query hub LLM lanes robustly, skipping lanes that fail, time out, or return empty content. */
async function queryRobustLlmLanes(
  messages: ChatMessage[],
  options: { temperature?: number; json?: boolean; max_tokens?: number; timeoutMs?: number } = {},
): Promise<string> {
  const lanes = await getLlmLanes();
  let lastErr: Error | null = null;

  for (const lane of lanes) {
    try {
      const body: Record<string, any> = {
        model: lane.model,
        messages,
        temperature: options.temperature ?? 0.1,
      };
      if (options.max_tokens) body.max_tokens = options.max_tokens;
      if (options.json) body.response_format = { type: 'json_object' };

      const res = await fetch(`${lane.url}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${lane.key}`,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(options.timeoutMs ?? 60_000),
      });

      if (!res.ok) {
        lastErr = new Error(`LLM lane ${lane.label} error ${res.status}: ${(await res.text()).slice(0, 150)}`);
        continue;
      }

      const data = await res.json();
      const text = data.choices?.[0]?.message?.content;
      if (typeof text === 'string' && text.trim().length > 0) {
        return text.trim();
      }
    } catch (err: any) {
      lastErr = err;
    }
  }
  throw lastErr ?? new Error('All LLM lanes failed or returned empty content');
}

/** Step 2 core analysis logic for a single research checkpoint. */
export async function analyseStep1Checkpoint(
  checkpoint: RawResearchCheckpoint,
  options: { forcedLlmError?: boolean } = {},
): Promise<Step2AnalysisOutput> {
  const startMs = Date.now();
  const input = checkpoint.input;
  const officialDomain = checkpoint.official_site?.domain || cleanDomain(checkpoint.input.website || '');

  // 1. Check if Step 1 skipped the company
  if (checkpoint.skipped) {
    return {
      version: '2.1',
      stage: 2,
      created_at: new Date().toISOString(),
      input,
      status: 'skipped',
      skip_reason: checkpoint.skipped,
      error: null,
      baseline: {
        official_domain: officialDomain,
        pages_present: [],
        brand_names: [input.company],
        legal_names: [],
        phones: [],
        addresses: [],
      },
      findings: [],
      dropped_namesakes: [],
      could_not_check: [
        {
          target: 'Official Website & Public Profiles',
          reason: checkpoint.skipped,
        },
      ],
      stats: {
        findings_count: 0,
        dropped_namesakes_count: 0,
        could_not_check_count: 1,
        llm_calls: 0,
        duration_ms: Date.now() - startMs,
      },
    };
  }

  const couldNotCheck: CouldNotCheck[] = [];

  // 2. Track missing / failed modules in could_not_check
  // Google Maps
  if (!checkpoint.google_maps) {
    couldNotCheck.push({ target: 'Google Maps', reason: 'Not gathered in Step 1' });
  } else if (checkpoint.google_maps.status === 'failed') {
    couldNotCheck.push({ target: 'Google Maps', reason: checkpoint.google_maps.error || 'Maps worker failed' });
  }

  // LinkedIn
  if (!checkpoint.linkedin) {
    couldNotCheck.push({ target: 'LinkedIn company page', reason: 'Not gathered in Step 1' });
  } else if (checkpoint.linkedin.status === 'failed' || checkpoint.linkedin.status === 'not_run') {
    couldNotCheck.push({
      target: 'LinkedIn company page',
      reason: checkpoint.linkedin.error || (checkpoint.linkedin.status === 'not_run' ? 'No company page found' : 'Failed to read'),
    });
  }

  // Naver Place (South Korea)
  if (input.country.toLowerCase().includes('korea')) {
    if (!checkpoint.naver_place) {
      couldNotCheck.push({ target: 'Naver Place', reason: 'Not gathered in Step 1' });
    } else if (checkpoint.naver_place.status === 'failed') {
      couldNotCheck.push({ target: 'Naver Place', reason: checkpoint.naver_place.error || 'Naver Place search failed' });
    }
  }

  // Catalog probes that were not run or failed
  for (const p of checkpoint.probes || []) {
    if (p.not_run) {
      couldNotCheck.push({ target: p.source.name, reason: p.not_run });
    }
  }

  // 3. Build baseline data
  const officialPages = checkpoint.official_site?.pages || [];
  const pagesPresent = officialPages.map((p) => p.label);
  const heuristics = extractBaselineHeuristics(officialPages);

  // Filter third-party discoveries: remove own-site pages, duplicates, and limit repetitions per platform
  const seenUrls = new Set<string>();
  const domainCounts: Record<string, number> = {};
  const filteredDiscoveries: Array<{ url: string; title: string; snippets: string[]; source: string; query: string }> = [];

  for (const d of checkpoint.third_party_discoveries || []) {
    if (!d.url || isOwnDomain(d.url, officialDomain)) continue;
    if (seenUrls.has(d.url)) continue;
    seenUrls.add(d.url);

    const dom = cleanDomain(d.url);
    domainCounts[dom] = (domainCounts[dom] || 0) + 1;
    if (domainCounts[dom] > 2) continue; // Keep at most 2 hits per outside domain (avoids 7 duplicate Glassdoors)

    filteredDiscoveries.push(d);
    if (filteredDiscoveries.length >= 20) break;
  }

  // Filter probes: keep probes that returned evidence URLs/snippets or relevant static page text
  const relevantProbes: Array<{
    rank: number;
    category: string;
    question: string;
    source: string;
    url: string;
    evidence_urls: string[];
    snippets: string[];
    page_excerpt?: string;
  }> = [];

  for (const p of checkpoint.probes || []) {
    if (p.not_run) continue;

    // Check if probe has explicit evidence snippets/urls
    if ((p.evidence_urls && p.evidence_urls.length > 0) || (p.snippets && p.snippets.length > 0)) {
      relevantProbes.push({
        rank: p.rank,
        category: p.category,
        question: p.question,
        source: p.source.name,
        url: p.source.url,
        evidence_urls: p.evidence_urls || [],
        snippets: (p.snippets || []).filter(Boolean).slice(0, 2),
      });
      continue;
    }

    // Check if probe read a static page/list
    if (p.page?.text) {
      const brandLower = input.company.toLowerCase().replace(/[^a-z0-9가-힣]/g, '');
      const pageText = p.page.text;
      const cleanPageText = pageText.toLowerCase().replace(/[^a-z0-9가-힣]/g, '');

      // Only pass if company name actually appears on the list/page
      if (cleanPageText.includes(brandLower)) {
        // Find excerpt around company name
        const idx = pageText.toLowerCase().indexOf(input.company.toLowerCase());
        const start = Math.max(0, idx - 400);
        const end = Math.min(pageText.length, idx + 600);
        relevantProbes.push({
          rank: p.rank,
          category: p.category,
          question: p.question,
          source: p.source.name,
          url: p.page.url,
          evidence_urls: [p.page.url],
          snippets: [],
          page_excerpt: pageText.slice(start, end),
        });
      }
    }
  }

  // 4. Construct prompt for DeepSeek LLM
  const isKorean = input.country.toLowerCase().includes('korea');

  let promptBaseline = `### COMPANY BASELINE (What the Owner Claims)\n`;
  promptBaseline += `- Company Name: "${input.company}"\n`;
  promptBaseline += `- Country: ${input.country}\n`;
  promptBaseline += `- Industry: ${input.industry}\n`;
  promptBaseline += `- Official Domain: ${officialDomain || 'None'}\n`;
  promptBaseline += `- Official Pages Read: ${pagesPresent.join(', ') || 'None'}\n\n`;

  for (const p of officialPages) {
    promptBaseline += `#### Official Page [${p.label.toUpperCase()}]: ${p.url}\n`;
    promptBaseline += `${condensePageMarkdown(p.markdown)}\n\n`;
  }

  // Company's own LinkedIn
  if (checkpoint.linkedin?.status === 'done' && checkpoint.linkedin.result) {
    const lData = (checkpoint.linkedin.result as any)?.data;
    if (lData) {
      promptBaseline += `#### Company's Own LinkedIn Page (Evaluated for Profile Drift only)\n`;
      promptBaseline += `- LinkedIn URL: ${lData.linkedin_url || ''}\n`;
      promptBaseline += `- Name on LinkedIn: ${lData.name || ''}\n`;
      promptBaseline += `- Website field: ${lData.website || ''}\n`;
      promptBaseline += `- Phone field: ${lData.phone || ''}\n`;
      promptBaseline += `- Headquarters: ${lData.headquarters || ''}\n`;
      promptBaseline += `- Founded: ${lData.founded || ''}\n`;
      promptBaseline += `- Company Type: ${lData.company_type || ''}\n`;
      promptBaseline += `- Company Size: ${lData.company_size || ''}\n`;
      promptBaseline += `- About snippet: ${lData.about_us || ''}\n\n`;
    }
  }

  let promptOutside = `### OUTSIDE EVIDENCE (From the Internet)\n\n`;

  // Google Maps
  if (checkpoint.google_maps?.status === 'done' && checkpoint.google_maps.result) {
    const businesses = (checkpoint.google_maps.result as any)?.businesses || [];
    promptOutside += `#### Google Maps Listings (${businesses.length} found):\n`;
    for (const b of businesses) {
      promptOutside += `- Name: "${b.name}" | Rating: ${b.rating ?? 'N/A'}★ (${b.reviews ?? 0} reviews) | Category: ${b.category || 'N/A'}\n`;
      promptOutside += `  Address: ${b.address || 'N/A'}\n`;
      promptOutside += `  Phone: ${b.phone || 'N/A'}\n`;
      promptOutside += `  Website: ${b.website || 'N/A'}\n`;
      promptOutside += `  Place URL: ${b.mapsUrl || ''}\n`;
    }
    promptOutside += `\n`;
  }

  // Naver Place (South Korea)
  if (checkpoint.naver_place?.status === 'done' && checkpoint.naver_place.places?.length) {
    promptOutside += `#### Naver Place Listings (${checkpoint.naver_place.places.length} found):\n`;
    for (const np of checkpoint.naver_place.places) {
      promptOutside += `- Name: "${np.name}" | Category: ${np.category || 'N/A'} | Phone: ${np.phone || np.virtualPhone || 'N/A'}\n`;
      promptOutside += `  Address: ${np.roadAddress || np.address || 'N/A'}\n`;
      promptOutside += `  Reviews: Visitor ${np.visitorReviewCount || 0}, Blog/Cafe ${np.blogCafeReviewCount || 0}\n`;
    }
    promptOutside += `\n`;
  }

  // Third party discoveries
  promptOutside += `#### Third-Party Search Discoveries (${filteredDiscoveries.length} hits outside official site):\n`;
  for (const d of filteredDiscoveries) {
    promptOutside += `- [${d.source.toUpperCase()}] Title: "${d.title}"\n  URL: ${d.url}\n  Query: ${d.query}\n`;
    for (const s of d.snippets) {
      promptOutside += `  Snippet: "${s.replace(/\s+/g, ' ').trim()}"\n`;
    }
  }
  promptOutside += `\n`;

  // Catalog probes with evidence
  if (relevantProbes.length > 0) {
    promptOutside += `#### Catalog Probes with Matches (${relevantProbes.length} probes with hits):\n`;
    for (const p of relevantProbes) {
      promptOutside += `- [Probe ${p.rank} - ${p.category}] ${p.question}\n  Source: ${p.source} (${p.url})\n`;
      if (p.evidence_urls.length) promptOutside += `  Evidence URLs: ${p.evidence_urls.join(', ')}\n`;
      for (const s of p.snippets) {
        promptOutside += `  Snippet: "${s.replace(/\s+/g, ' ').trim()}"\n`;
      }
      if (p.page_excerpt) {
        promptOutside += `  Page excerpt: "${p.page_excerpt.replace(/\s+/g, ' ').trim()}"\n`;
      }
    }
    promptOutside += `\n`;
  }

  const systemPrompt = `You are Step 2 (Analyse / Judge) of Company Dive V2.1.
Your job is to judge the Step 1 research data for "${input.company}" in ${input.country} (${input.industry}).

THE BAIT GOAL:
The dive is free bait for a $59 report. The owner knows their own business; they do NOT know what the outside internet says about them in places they do not watch.
Find the real gap between what the company claims (official site, own LinkedIn) and what outside sources show.

HARD RULES:
1. "NOT FOUND IS NOT A FINDING":
   - An empty search, a search returning 0 hits, or absence from a generic sanctions/disciplinary list is NEVER a finding!
   - Absence is a finding ('unproven') ONLY if the official site specifically claimed an accreditation/award/licence AND the official registry was read and proves they do not have it.
   - If not claimed on the site and not found in search, DO NOT report it as a finding.
2. DROP NAMESAKES (Entity Resolution):
   - Search engines match keywords, not legal entities.
   - If an external hit belongs to a different company (e.g. different country like UK/US for an AU/MY company; different website; completely different industry like tutoring app for IT company; different director/owner), you MUST DROP IT.
   - Every dropped namesake must go into "dropped_namesakes" with name, url, snippet, and reason_dropped.
   - NEVER create a finding based on a namesake's data!
3. OWN-SITE FILTERING:
   - Do NOT treat pages from the company's own website as third-party contradictions.
   - The company's own LinkedIn page is evaluated ONLY for "profile_drift" (stale, forgotten, or contradictory claims like "Public Company", wrong founding year, broken website link).
4. FINDING TYPES (use only these exact strings):
   - "contradiction": Outside directory (LeadIQ, ZoomInfo, MyPages, RocketReach) or Google Maps lists a phone number, address, or legal name that differs from what the official contact page shows.
   - "outdated": Outside listing or registry has expired/stale records (e.g. expired licence, outdated premises).
   - "unproven": The site explicitly boasts a specific award/licence, but an authoritative registry checked proves it does not exist.
   - "missed_advantage": External authoritative sources (award registries like AWIA, GDWEB, Web Award Korea, d Awards, verified directory awards) confirm an award/honor they won, but their official site fails to showcase it.
   - "profile_drift": Company's own forgotten profile (LinkedIn) contradicts reality (e.g. listed as "Public Company" while private, dead link, wrong founding year).
   - "staff_review_risk": Public employee reviews (Glassdoor, JobStreet, JobPlanet, Indeed, SEEK) showing low ratings (<3.5), critical sub-scores (pay, management), or substantial unmonitored review volume.
   - "disciplinary_warning": Confirmed regulatory enforcement, sanctions, or warnings on official government/regulator lists.
5. QUALITY & EVIDENCE:
   - For every finding, provide:
     - claim: what the official site says (or "None claimed / Omitted from official site")
     - outside_source: what the outside source states
     - source_name: name of the source (e.g. "MyPages Malaysia", "Glassdoor", "Google Maps")
     - source_url: exact URL
     - quoted_text: exact verbatim snippet/text proving the finding
     - confidence: "high" or "medium"
     - identity_justification: why this evidence is definitely this exact company (e.g. matching address, phone, registration id, or domain)
6. CONCISE REASONING:
   - Think concisely and directly. Do not over-elaborate internal reasoning.
   - Focus directly on identifying 2 to 4 strongest, high-value findings and clear dropped namesakes.
   - Output valid JSON promptly without verbose fluff.
7. LANGUAGE:
   - ${isKorean ? 'This is a South Korean company. Evaluate and write findings, claims, and justifications in Korean. Preserve Korean quoted text verbatim.' : 'Evaluate and write in English. Preserve original quoted text verbatim.'}

OUTPUT FORMAT:
Respond with ONLY a single valid JSON object with this exact shape:
{
  "baseline_summary": {
    "brand_names": ["string"],
    "legal_names": ["string"],
    "phones": ["string"],
    "addresses": ["string"],
    "claimed_credentials": ["string"]
  },
  "findings": [
    {
      "id": "f1",
      "type": "contradiction",
      "category": "contact",
      "title": "Short 1-line description",
      "claim": "Official site says ...",
      "outside_source": "Outside directory lists ...",
      "source_name": "Source Name",
      "source_url": "https://...",
      "quoted_text": "Exact quote ...",
      "confidence": "high",
      "identity_justification": "Matches address and brand..."
    }
  ],
  "dropped_namesakes": [
    {
      "name": "Namesake Name",
      "url": "https://...",
      "snippet": "...",
      "reason_dropped": "Explanation of why this is a namesake and not the client..."
    }
  ]
}`;

  const userPrompt = `${promptBaseline}\n${promptOutside}\nJudge the evidence now. Apply all rules strictly. Return valid JSON only.`;

  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ];

  let llmCalls = 0;
  let parsedLlm: any = null;

  try {
    llmCalls++;
    if (options.forcedLlmError) {
      throw new Error('Forced LLM failure test triggered');
    }
    const rawResponse = await queryRobustLlmLanes(messages, {
      temperature: 0.1,
      json: true,
      max_tokens: 8192,
    });

    let cleaned = rawResponse.trim();
    if (cleaned.startsWith('```')) {
      cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
    }

    if (cleaned.startsWith('{') && cleaned.endsWith('}')) {
      try {
        parsedLlm = JSON.parse(cleaned);
      } catch (e: any) {
        console.error(`[JSON Parse Exception] ${e.message}. Tail: ${cleaned.slice(-300)}`);
        throw e;
      }
    } else {
      console.error(`[JSON Missing Braces] length: ${cleaned.length}, start: ${cleaned.slice(0, 50)}, tail: ${cleaned.slice(-100)}`);
      throw new Error(`LLM returned invalid or truncated JSON (length ${rawResponse.length})`);
    }
  } catch (err: any) {
    return {
      version: '2.1',
      stage: 2,
      created_at: new Date().toISOString(),
      input,
      status: 'failed',
      error: `LLM analysis failed: ${err.message}`,
      baseline: {
        official_domain: officialDomain,
        pages_present: pagesPresent,
        brand_names: [input.company],
        legal_names: heuristics.legalNames,
        phones: heuristics.phones,
        addresses: heuristics.addresses,
      },
      findings: [],
      dropped_namesakes: [],
      could_not_check: couldNotCheck,
      stats: {
        findings_count: 0,
        dropped_namesakes_count: 0,
        could_not_check_count: couldNotCheck.length,
        llm_calls: llmCalls,
        duration_ms: Date.now() - startMs,
      },
    };
  }

  // 5. Structure final findings and dropped namesakes
  const rawFindings: any[] = Array.isArray(parsedLlm?.findings) ? parsedLlm.findings : [];
  const validFindings: AnalysisFinding[] = [];

  rawFindings.forEach((f, idx) => {
    if (!f.title || !f.type) return;
    validFindings.push({
      id: f.id || `f${idx + 1}`,
      type: f.type,
      category: f.category || 'identity',
      title: String(f.title).trim(),
      claim: String(f.claim || '').trim(),
      outside_source: String(f.outside_source || '').trim(),
      source_name: String(f.source_name || '').trim(),
      source_url: String(f.source_url || '').trim(),
      quoted_text: String(f.quoted_text || '').trim(),
      confidence: f.confidence === 'medium' ? 'medium' : 'high',
      identity_justification: String(f.identity_justification || '').trim(),
    });
  });

  const rawNamesakes: any[] = Array.isArray(parsedLlm?.dropped_namesakes) ? parsedLlm.dropped_namesakes : [];
  const validNamesakes: DroppedNamesake[] = [];

  rawNamesakes.forEach((n) => {
    if (!n.name && !n.url) return;
    validNamesakes.push({
      name: String(n.name || 'Unknown entity').trim(),
      url: String(n.url || '').trim(),
      snippet: String(n.snippet || '').trim(),
      reason_dropped: String(n.reason_dropped || 'Namesake entity in another jurisdiction or sector').trim(),
    });
  });

  const baselineSummary = parsedLlm?.baseline_summary || {};

  return {
    version: '2.1',
    stage: 2,
    created_at: new Date().toISOString(),
    input,
    status: 'analyzed',
    skip_reason: null,
    error: null,
    baseline: {
      official_domain: officialDomain,
      pages_present: pagesPresent,
      brand_names: baselineSummary.brand_names || [input.company],
      legal_names: baselineSummary.legal_names?.length ? baselineSummary.legal_names : heuristics.legalNames,
      phones: baselineSummary.phones?.length ? baselineSummary.phones : heuristics.phones,
      addresses: baselineSummary.addresses?.length ? baselineSummary.addresses : heuristics.addresses,
      claimed_credentials: baselineSummary.claimed_credentials || [],
    },
    findings: validFindings,
    dropped_namesakes: validNamesakes,
    could_not_check: couldNotCheck,
    stats: {
      findings_count: validFindings.length,
      dropped_namesakes_count: validNamesakes.length,
      could_not_check_count: couldNotCheck.length,
      llm_calls: llmCalls,
      duration_ms: Date.now() - startMs,
    },
  };
}

/** Reads step1_research.json from a run folder, executes Step 2 analysis, and writes step2_analysis.json. */
export async function analyseRunDirectory(
  runDir: string,
  options: {
    forcedLlmError?: boolean;
    forcedMalformedJson?: boolean;
    /** Stage 1 switch: tidy the Step 1 data (saved as step1_tidy.json) and judge it with judge.ts. */
    tidy?: boolean;
    /** Write to this file instead of step2_analysis.json (keeps earlier runs for benchmarking). */
    outName?: string;
    /** Tidy path: lanes to use instead of the hub's, and the dead-call limit (failure tests). */
    lanes?: Lane[];
    deadCallMs?: number;
    /** Stage 3 switch: recheck the judge's findings with a second LLM call. */
    recheck?: boolean;
    /** Benchmark store: the hub URL to post rows to (tests), or false to write none. Default: the hub (LAB_URL). */
    benchDb?: string | false;
  } = {},
): Promise<Step2AnalysisOutput> {
  const step1Path = path.join(runDir, 'step1_research.json');
  const step2Path = path.join(runDir, options.outName || 'step2_analysis.json');

  if (!fs.existsSync(step1Path)) {
    const failedOutput: Step2AnalysisOutput = {
      version: '2.1',
      stage: 2,
      created_at: new Date().toISOString(),
      input: { company: path.basename(runDir), country: 'Unknown', industry: 'Unknown' },
      status: 'failed',
      error: `File not found: ${step1Path}`,
      baseline: { official_domain: '', pages_present: [], brand_names: [], legal_names: [], phones: [], addresses: [] },
      findings: [],
      dropped_namesakes: [],
      could_not_check: [],
      stats: { findings_count: 0, dropped_namesakes_count: 0, could_not_check_count: 0, llm_calls: 0, duration_ms: 0 },
    };
    fs.writeFileSync(step2Path, JSON.stringify(failedOutput, null, 2), 'utf8');
    return failedOutput;
  }

  let checkpoint: RawResearchCheckpoint;
  try {
    if (options.forcedMalformedJson) {
      throw new Error('Unexpected token in JSON at position 0 (forced test)');
    }
    const raw = fs.readFileSync(step1Path, 'utf8');
    checkpoint = JSON.parse(raw);
  } catch (err: any) {
    const failedOutput: Step2AnalysisOutput = {
      version: '2.1',
      stage: 2,
      created_at: new Date().toISOString(),
      input: { company: path.basename(runDir), country: 'Unknown', industry: 'Unknown' },
      status: 'failed',
      error: `Malformed Step 1 JSON: ${err.message}`,
      baseline: { official_domain: '', pages_present: [], brand_names: [], legal_names: [], phones: [], addresses: [] },
      findings: [],
      dropped_namesakes: [],
      could_not_check: [],
      stats: { findings_count: 0, dropped_namesakes_count: 0, could_not_check_count: 0, llm_calls: 0, duration_ms: 0 },
    };
    fs.writeFileSync(step2Path, JSON.stringify(failedOutput, null, 2), 'utf8');
    return failedOutput;
  }

  let result: Step2AnalysisOutput;
  if (options.tidy && !checkpoint.skipped) {
    const tidy = tidyCheckpoint(checkpoint);
    fs.writeFileSync(path.join(runDir, 'step1_tidy.json'), JSON.stringify(tidy, null, 2), 'utf8');
    const llmOpts = { lanes: options.lanes, deadCallMs: options.deadCallMs };
    result = await judgeTidy(tidy, llmOpts);
    // Benchmark store: a failed write is reported in the output and never stops the run.
    const bench: NonNullable<Step2AnalysisOutput['bench']> = { judge_id: null, recheck_id: null, error: null };
    const runFolder = path.basename(runDir);
    const save = async (row: BenchRow): Promise<number | null> => {
      if (options.benchDb === false) return null;
      try {
        return await saveBenchRow(row, options.benchDb || undefined);
      } catch (err: any) {
        bench.error = `bench store: ${err?.message ?? err}`;
        console.error(`[step2] ${bench.error}`);
        return null;
      }
    };
    bench.judge_id = await save({
      run_folder: runFolder, company: tidy.input.company, country: tidy.input.country, pass: 'judge',
      prompt: result.meta?.prompt ?? '', model: result.meta?.model ?? null, lane: result.meta?.lane ?? null,
      status: result.status, error: result.error ?? null, duration_ms: result.stats.duration_ms, llm_calls: result.stats.llm_calls,
      findings: result.findings, rejected: result.rejected_findings ?? [], dropped_namesakes: result.dropped_namesakes,
      attempts: result.meta?.attempts ?? [], llm_raw: result.llm_raw ?? null,
    });
    if (options.recheck) {
      const { result: rc, findings } = await recheckTidy(tidy, result, llmOpts);
      bench.recheck_id = await save({
        run_folder: runFolder, company: tidy.input.company, country: tidy.input.country, pass: 'recheck', judge_id: bench.judge_id,
        prompt: rc.meta.prompt, model: rc.meta.model, lane: rc.meta.lane, status: rc.status, error: rc.error,
        duration_ms: rc.meta.duration_ms, llm_calls: rc.meta.attempts.length, findings, rejected: rc.rejected,
        reviews: rc.reviews, removed: rc.removed, added: rc.added, attempts: rc.meta.attempts, llm_raw: rc.llm_raw,
      });
      result = {
        ...result,
        findings,
        stats: { ...result.stats, findings_count: findings.length, llm_calls: result.stats.llm_calls + rc.meta.attempts.length },
        recheck: rc,
      };
    }
    result = { ...result, bench };
  } else {
    result = await analyseStep1Checkpoint(checkpoint, { forcedLlmError: options.forcedLlmError });
  }
  fs.writeFileSync(step2Path, JSON.stringify(result, null, 2), 'utf8');
  return result;
}
