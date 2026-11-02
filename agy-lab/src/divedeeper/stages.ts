export const enabled = (env: NodeJS.ProcessEnv = process.env): boolean => /^(1|true|on|yes)$/i.test(String(env.DIVE_DEEPER_ENABLED ?? '').trim());

// Section G on the hub asks deepseek only (the gpt router key has no credit; decided 2026-10-26).
process.env.DD_G_MODELS ??= 'deepseek-v4.1-flash-1017';
process.env.DD_G_JUDGE ??= 'deepseek-v4.1-flash-1017';

/** The order lanes run in. C-merged reuses H-maps' Maps phones, so it waits for H-maps.
 *  E-maps (Google review text) is gone: it read reviews from scraper.tech, and the Gmap workers return no reviews.
 *  The last three read what the others found: R-contacts (C-merged's and H-maps' contacts), A-assets
 *  (C-merged's domains and email addresses), B-brand (C-merged's pages, H-web's results, G-fixed's answers). S2 reads everything. */
export const STAGE1_FIRST = [['H', 'maps'], ['H', 'web'], ['D', 'registry'], ['G', 'fixed'], ['G', 'grounded'], ['K', 'credibility'], ['N', 'news'], ['W', 'speed']] as const;
export const STAGE1_AFTER_H = [['C', 'merged']] as const;
export const STAGE1_LAST = [['R', 'contacts'], ['A', 'assets'], ['B', 'brand']] as const;
export const STAGE2 = ['S2', 'consult'] as const;
/** The editor reads everything, S2 included, and writes the report's plain titles and screenshots. */
export const STAGE3 = ['S3', 'editor'] as const;
/** One full analysis, read across every part. */
export const STAGE4 = ['S4', 'analysis'] as const;
/** The action plan: every urgent and needs-work finding as a task for the department that does it. */
export const STAGE5 = ['S5', 'plan'] as const;
