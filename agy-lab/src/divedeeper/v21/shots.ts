import type { Ctx } from '../lib.ts';
import type { Shot, ShotAsk } from '../shots.ts';

/** One worker shot per ask. A failed proof is optional, just as in the old editor. */
export async function takeWorkerShots(ctx: Ctx, asks: ShotAsk[]): Promise<Shot[]> {
  const shots: Shot[] = [];
  for (const ask of asks) {
    try {
      const out = await ctx.shot({ url: ask.url, device: ask.mobile ? 'mobile' : 'desktop', ...(ask.find ? { find: ask.find } : {}) });
      // A screenshot of a missing page is valid proof for an ask with no text to find.
      if ('error' in out || out.blocked || (out.status >= 400 && !(out.status === 404 && !ask.find)) || typeof out.image !== 'string' || !out.image) {
        ctx.warn(`shot ${ask.key} skipped on ${ask.url}: ${'error' in out ? out.error : out.blocked ? 'blocked' : `HTTP ${out.status}, or no image`}`);
        continue;
      }
      // Workers may include a data URL prefix; the report adds its own JPEG prefix.
      const img = out.image.replace(/^data:image\/jpeg;base64,/i, '');
      if (/^data:/i.test(img)) { ctx.warn(`shot ${ask.key} skipped: the worker did not return a JPEG`); continue; }
      if (ask.find && !out.found) ctx.warn(`shot ${ask.key}: requested text was not found on ${ask.url}`);
      shots.push({ ...ask, img, found: Boolean(out.found), taken_at: new Date().toISOString() });
    } catch (err) {
      ctx.warn(`shot ${ask.key} failed on ${ask.url}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return shots;
}
