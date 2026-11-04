import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const trackerDataDir = path.resolve(here, '../../research-tracker/data');
const fallbackPromptsPath = path.resolve(here, '../companydive/v2-prompts.json');

const COUNTRY_MAP: Record<string, string> = {
  malaysia: 'MY',
  my: 'MY',
  singapore: 'SG',
  sg: 'SG',
  australia: 'AU',
  au: 'AU',
};

const INDUSTRY_MAP: Record<string, string> = {
  'accounting firm': 'accounting-firm',
  'accounting-firm': 'accounting-firm',
  'digital marketing agency': 'digital-marketing-agency',
  'digital-marketing-agency': 'digital-marketing-agency',
  'import export company': 'import-export-company',
  'import-export-company': 'import-export-company',
  'interior designer': 'interior-designer',
  'interior-designer': 'interior-designer',
  'web design company': 'web-design-company',
  'web-design-company': 'web-design-company',
};

export type ResearchPrompt = {
  rank: number;
  category: string;
  problem_type: string[];
  question: string;
  why_it_matters: string;
  source: {
    name: string;
    url: string;
    type: string;
    access?: string;
    language?: string;
  };
  how_to_query: string;
  /** How the source answers: url_template (query_url with {company} or {reg_no}), static_list (query_url is the
   *  whole list), manual (cannot be fetched; manual_reason says why). Older prompts have none. */
  query_type?: 'url_template' | 'static_list' | 'manual';
  query_url?: string;
  manual_reason?: string;
  applies_when?: string;
  found_when?: string;
  not_found_when?: string;
  couldnt_check_when?: string;
  used_in?: string;
  confidence?: string;
};

export type IndustryChecklist = {
  countryCode: string;
  country: string;
  industry: string;
  industryKey: string;
  prompts: ResearchPrompt[];
};

export function loadChecklist(country: string, industry: string): IndustryChecklist | null {
  const normCountry = country.trim().toLowerCase();
  const cCode = COUNTRY_MAP[normCountry];
  if (!cCode) return null;

  const normIndustry = industry.trim().toLowerCase().replace(/\s+/g, ' ');
  const indKey = INDUSTRY_MAP[normIndustry] ?? normIndustry.replace(/\s+/g, '-');

  // The newest answer wins, whichever round it is: round 1 can be re-answered after round 2.
  const pairFolder = path.join(trackerDataDir, `${cCode}-${indKey}`);
  const rounds = ['round1.json', 'round2.json']
    .map((file) => {
      try {
        return JSON.parse(fs.readFileSync(path.join(pairFolder, file), 'utf8'));
      } catch {
        return null;
      }
    })
    .filter((data) => Array.isArray(data?.prompts) && data.prompts.length)
    .sort((a, b) => String(b._received_at ?? '').localeCompare(String(a._received_at ?? '')));

  if (rounds.length) {
    return {
      countryCode: cCode,
      country: cCode === 'MY' ? 'Malaysia' : cCode === 'SG' ? 'Singapore' : 'Australia',
      industry,
      industryKey: indKey,
      prompts: rounds[0].prompts,
    };
  }

  // Fallback to v2-prompts.json
  if (fs.existsSync(fallbackPromptsPath)) {
    try {
      const cat = JSON.parse(fs.readFileSync(fallbackPromptsPath, 'utf8'));
      const cKey = cCode === 'MY' ? 'malaysia' : cCode === 'SG' ? 'singapore' : '';
      const item = cat[cKey]?.[indKey];
      if (item && Array.isArray(item.prompts)) {
        return {
          countryCode: cCode,
          country: cCode === 'MY' ? 'Malaysia' : 'Singapore',
          industry,
          industryKey: indKey,
          prompts: item.prompts,
        };
      }
    } catch {}
  }

  return null;
}
