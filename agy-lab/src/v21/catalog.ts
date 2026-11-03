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

  const pairFolder = path.join(trackerDataDir, `${cCode}-${indKey}`);
  const r2 = path.join(pairFolder, 'round2.json');
  const r1 = path.join(pairFolder, 'round1.json');

  if (fs.existsSync(r2)) {
    try {
      const data = JSON.parse(fs.readFileSync(r2, 'utf8'));
      if (Array.isArray(data.prompts) && data.prompts.length) {
        return {
          countryCode: cCode,
          country: cCode === 'MY' ? 'Malaysia' : cCode === 'SG' ? 'Singapore' : 'Australia',
          industry,
          industryKey: indKey,
          prompts: data.prompts,
        };
      }
    } catch {}
  }

  if (fs.existsSync(r1)) {
    try {
      const data = JSON.parse(fs.readFileSync(r1, 'utf8'));
      if (Array.isArray(data.prompts) && data.prompts.length) {
        return {
          countryCode: cCode,
          country: cCode === 'MY' ? 'Malaysia' : cCode === 'SG' ? 'Singapore' : 'Australia',
          industry,
          industryKey: indKey,
          prompts: data.prompts,
        };
      }
    } catch {}
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
