// GET/POST /api/contact-keys: the search keys contact research rotates through,
// Tavily and Exa, each shown in full with its quota state, and the Brave keys
// company and deeper dives search with, and the one-key providers' keys (secrets:
// MiniMax, scraper.tech, Parallel, Smartlead, PageSpeed). Behind LAB_TOKEN.
// GET/POST /api/llm-lanes: the extract model lanes (extract-llm.ts), kept in llm_lane.
import * as db from './reportdb.ts';
import { brave, exa, llm as extractLlm, secrets, tavily } from './core/index.ts';

type Ctx = { json: (res: unknown, status: number, body: unknown) => void; readJson: (req: unknown) => Promise<Record<string, unknown>> };

export async function handleKeys(req: { method?: string }, res: unknown, url: URL, ctx: Ctx): Promise<boolean> {
  // Which search provider digs up more: per provider over the last ?days= (default 7).
  if (url.pathname === '/api/contact-stats' && (req.method ?? 'GET') === 'GET') {
    const days = Number(url.searchParams.get('days')) || 7;
    ctx.json(res, 200, { days, ...(await db.contactProviderStats(days)) });
    return true;
  }
  if (url.pathname === '/api/llm-lanes') {
    const method = req.method ?? 'GET';
    if (method !== 'GET' && method !== 'POST') {
      ctx.json(res, 405, { error: 'method not allowed' });
      return true;
    }
    if (method === 'POST') {
      const body = await ctx.readJson(req);
      if (!Array.isArray(body.lanes)) {
        ctx.json(res, 400, { error: 'lanes needs [{label, url, key, model, enabled}]' });
        return true;
      }
      await extractLlm.replaceLanes(body.lanes as Array<Partial<extractLlm.LlmLane>>);
    }
    const lanes = await extractLlm.refresh();
    ctx.json(res, 200, {
      lanes: lanes.map((l) => ({ ...l, restingUntil: extractLlm.restingUntilFor(l.key) })),
      // Empty table: calls still run on these CONTACT_LLM_* lanes.
      fromEnv: lanes.some((l) => l.enabled) ? [] : extractLlm.pool().map((c) => ({ url: c.url, model: c.model })),
    });
    return true;
  }
  if (url.pathname !== '/api/contact-keys' && url.pathname !== '/api/gemini-contact-keys') return false;
  const method = req.method ?? 'GET';
  if (method === 'GET') {
    const [tavilyKeys, exaKeys, braveKeys] = await Promise.all([tavily.refresh(), exa.refresh(), brave.refresh(), secrets.refresh()]);
    const kinds = Object.keys(secrets.KINDS) as secrets.Kind[];
    ctx.json(res, 200, {
      tavilyKeys,
      braveKeys,
      // Each one-key provider's saved key, and whether calls fall back to its Railway variable.
      secrets: Object.fromEntries(kinds.map((k) => [k, secrets.fromDb(k)])),
      secretsFromEnv: kinds.filter((k) => !secrets.fromDb(k) && secrets.get(k)),
      tavily: tavily.pool.stats(),
      exaKeys,
      exa: exa.pool.stats(),
      exaProxy: exa.proxy() ? { url: exa.proxy()!.url, tokenSet: true } : null,
      step1Slots: tavily.pool.slots(),
      exaSlots: exa.pool.slots(),
    });
    return true;
  }
  if (method === 'POST') {
    const body = await ctx.readJson(req);
    if (Array.isArray(body.tavily)) await db.replaceGeminiContactKeys('tavily', body.tavily.map(String));
    if (Array.isArray(body.exa)) await db.replaceGeminiContactKeys('exa', body.exa.map(String));
    if (Array.isArray(body.brave)) await db.replaceGeminiContactKeys('brave', body.brave.map(String));
    // {secrets: {minimax: '...'}}: one key per kind, kept whole (the PageSpeed one is JSON); '' removes it.
    if (body.secrets && typeof body.secrets === 'object') {
      for (const [kind, value] of Object.entries(body.secrets as Record<string, unknown>)) {
        if (kind in secrets.KINDS && typeof value === 'string') await db.replaceGeminiContactKeys(kind as secrets.Kind, value.trim() ? [value] : []);
      }
    }
    // The US proxy that "us:" Exa keys go through: {url, token}, or null to remove it.
    if (body.exaProxy !== undefined) {
      const proxy = body.exaProxy === null ? null : exa.parseProxy(body.exaProxy);
      if (body.exaProxy !== null && !proxy) {
        ctx.json(res, 400, { error: 'exaProxy needs {url: "https://...", token: "..."}' });
        return true;
      }
      await db.replaceGeminiContactKeys('exa_proxy', proxy ? [JSON.stringify(proxy)] : []);
    }
    await Promise.all([tavily.refresh(), exa.refresh(), brave.refresh(), secrets.refresh()]);
    ctx.json(res, 200, { ok: true, step1Slots: tavily.pool.slots(), exaSlots: exa.pool.slots() });
    return true;
  }
  ctx.json(res, 405, { error: 'method not allowed' });
  return true;
}
