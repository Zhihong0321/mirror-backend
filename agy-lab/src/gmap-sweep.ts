// The sweep strategy the Gmap workers (PC worker.ps1, Mac mini) read from the hub
// (gmap-worker.ts strategy route). Measured on the 2026-10-24 sweeps.
//
// One Maps search tops out around 150-190 places, which is Google's ceiling, so
// the three territory keywords (business, factory, shop) and a location-only
// search become a keyword sweep: "<word> in <place>" for each word of the
// keyword's family until `max` places are in hand. Any other keyword (a company
// name, "solar installer") is one search.
//
// A Business sweep then searches street by street. Measured on six Taman Daya
// streets, the 48-word sweep had found 204 of the 257 businesses on them (79%);
// the rest are niche shops no common keyword reaches. "shop in <street>" found
// the most new ones and "company in <street>" most of the remainder.

export const DEFAULT_MAX = 200;
export const STREET_FORMS = ['shop', 'company'];
/** Below this share of rows naming the place, the place is not how Google writes addresses there: keep everything. */
export const AREA_MATCH_FLOOR = 0.3;

/**
 * Keyword families, each ordered by how many new in-area places a word added in
 * the 2026-10-24 sweeps of Kawasan Perindustrian Tebrau (industrial) and Taman
 * Daya (mixed). Near-synonyms that added almost nothing are left out:
 * "industrial" (+0/+4), "pharmacy" (+0).
 */
const FACTORY = [
  'factory', 'sdn bhd', 'food', 'company', 'manufacturer', 'manufacturing', 'construction',
  'engineering', 'warehouse', 'trading', 'furniture', 'wholesale', 'logistics', 'plastic',
  'machinery', 'steel', 'printing', 'packaging', 'supplier',
];
const SHOP = [
  'shop', 'restaurant', 'salon', 'car', 'store', 'laundry', 'clinic', 'bakery', 'kedai',
  'electronics', 'hardware', 'cafe', 'retail', 'mart', 'tyre', 'spa',
];
/** Every kind of business: the categories that each added most in Taman Daya, then both families. */
const BUSINESS = [...new Set([
  'restaurant', 'salon', 'factory', 'company', 'business', 'sdn bhd', 'construction', 'tuition',
  'car', 'shop', 'property', 'trading', 'services', 'wholesale', 'manufacturer', 'office',
  'workshop', 'agency', 'laundry', 'hotel', 'contractor', 'kindergarten', ...FACTORY, ...SHOP,
])];
export const FAMILIES: Record<string, string[]> = { business: BUSINESS, factory: FACTORY, shop: SHOP };
