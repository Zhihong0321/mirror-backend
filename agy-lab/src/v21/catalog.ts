import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
// The research tracker's answers on the PC that runs the tracker; on the hub (no tracker), the snapshot in
// catalog-data/ that ships with the code. Refresh the snapshot when the tracker gets new answers:
//   cd agy-lab && for f in research-tracker/data/*/round[12].json; do ... cp to src/v21/catalog-data/<pair>/; done
const trackerDataDir = fs.existsSync(path.resolve(here, '../../research-tracker/data'))
  ? path.resolve(here, '../../research-tracker/data')
  : path.resolve(here, 'catalog-data');
const fallbackPromptsPath = path.resolve(here, '../companydive/v2-prompts.json');

const COUNTRY_MAP: Record<string, string> = {
  malaysia: 'MY',
  my: 'MY',
  singapore: 'SG',
  sg: 'SG',
  australia: 'AU',
  au: 'AU',
  'south korea': 'KR',
  korea: 'KR',
  kr: 'KR',
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
  /** How the source answers: site_search (a site: search on source.url's host), url_template (query_url with
   *  {company}; older prompts may carry {reg_no}), static_list (query_url is the whole list), manual (older prompts
   *  only: cannot be fetched; manual_reason says why). The oldest prompts have none and run as site_search. */
  query_type?: 'site_search' | 'url_template' | 'static_list' | 'manual';
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
  /** The industry's prompts first, then the country layer's. */
  prompts: ResearchPrompt[];
  /** How many of the prompts (the last ones) are the country layer's. */
  countryLayerCount: number;
};

const COUNTRY_NAMES: Record<string, string> = { MY: 'Malaysia', SG: 'Singapore', AU: 'Australia', KR: 'South Korea' };

/** The newest accepted answer among the given files of one tracker pair folder (whichever round it is: round 1 can
 *  be re-answered after round 2). Null when none has prompts or none can be read. */
function newestPrompts(folder: string, files: string[]): ResearchPrompt[] | null {
  const rounds = files
    .map((file) => {
      try {
        return JSON.parse(fs.readFileSync(path.join(folder, file), 'utf8'));
      } catch {
        return null;
      }
    })
    .filter((data) => Array.isArray(data?.prompts) && data.prompts.length)
    .sort((a, b) => String(b._received_at ?? '').localeCompare(String(a._received_at ?? '')));
  return rounds.length ? rounds[0].prompts : null;
}

/** On with V21_COUNTRY_LAYER=on (owner, 2026-11-06); off, Step 1 loads the industry's prompts only, as before. */
export const countryLayerOn = (): boolean => (process.env.V21_COUNTRY_LAYER ?? '').trim().toLowerCase() === 'on';

/** The country layer: checks that apply to every company of the country, whatever its industry (tracker pair
 *  <CC>-country-layer, brief 1 round1/round2 or brief 2 b2-round1/b2-round2, the newest answer wins). */
export function loadCountryLayer(countryCode: string): ResearchPrompt[] {
  return newestPrompts(path.join(trackerDataDir, `${countryCode}-country-layer`), ['round1.json', 'round2.json', 'b2-round1.json', 'b2-round2.json']) ?? [];
}

function industryPrompts(cCode: string, indKey: string): ResearchPrompt[] | null {
  const found = newestPrompts(path.join(trackerDataDir, `${cCode}-${indKey}`), ['round1.json', 'round2.json']);
  if (found) return found;

  // Fallback to v2-prompts.json
  if (fs.existsSync(fallbackPromptsPath)) {
    try {
      const cat = JSON.parse(fs.readFileSync(fallbackPromptsPath, 'utf8'));
      const cKey = cCode === 'MY' ? 'malaysia' : cCode === 'SG' ? 'singapore' : '';
      const item = cat[cKey]?.[indKey];
      if (item && Array.isArray(item.prompts)) return item.prompts;
    } catch {}
  }
  return null;
}

/** The industry's prompts plus (switch on) the country layer's. A company of an industry with no catalog still gets
 *  the country layer. Null when there is neither. */
export function loadChecklist(country: string, industry: string): IndustryChecklist | null {
  const normCountry = country.trim().toLowerCase();
  const cCode = COUNTRY_MAP[normCountry];
  if (!cCode) return null;

  const normIndustry = industry.trim().toLowerCase().replace(/\s+/g, ' ');
  const indKey = INDUSTRY_MAP[normIndustry] ?? normIndustry.replace(/\s+/g, '-');

  const own = industryPrompts(cCode, indKey) ?? [];
  const layer = countryLayerOn() ? loadCountryLayer(cCode) : [];
  if (!own.length && !layer.length) return null;
  return {
    countryCode: cCode,
    country: COUNTRY_NAMES[cCode] ?? country,
    industry,
    industryKey: indKey,
    prompts: [...own, ...layer],
    countryLayerCount: layer.length,
  };
}
