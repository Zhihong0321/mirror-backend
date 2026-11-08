export const enabled = (env: NodeJS.ProcessEnv = process.env): boolean => /^(1|true|on|yes)$/i.test(String(env.DIVE_DEEPER_ENABLED ?? '').trim());

/** The order lanes run in. C-merged reuses H-maps' Maps phones, so it waits for H-maps.
 *  E-maps (Google review text) is gone: it read reviews from scraper.tech, and the Gmap workers return no reviews.
 *  The last three read what the others found: R-contacts (C-merged's and H-maps' contacts), A-assets
 *  (C-merged's domains and email addresses), B-brand (C-merged's pages, H-web's results, G-search's answers). S2 reads everything.
 *  G-search asks an AI assistant that searches the web (Gemini on the cloud Antigravity hub); it replaced G-fixed and G-grounded. */
export const STAGE1_FIRST = [['H', 'maps'], ['H', 'web'], ['D', 'registry'], ['G', 'search'], ['K', 'credibility'], ['N', 'news'], ['W', 'speed']] as const;
export const STAGE1_AFTER_H = [['C', 'merged']] as const;
export const STAGE1_LAST = [['R', 'contacts'], ['A', 'assets'], ['B', 'brand']] as const;
export const STAGE2 = ['S2', 'consult'] as const;
/** The editor reads everything, S2 included, and writes the report's plain titles and screenshots. */
export const STAGE3 = ['S3', 'editor'] as const;
/** One full analysis, read across every part. */
export const STAGE4 = ['S4', 'analysis'] as const;
/** The action plan: every urgent and needs-work finding as a task for the department that does it. */
export const STAGE5 = ['S5', 'plan'] as const;
