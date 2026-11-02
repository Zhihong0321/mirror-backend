// Phase 1 check: does every API the three pipelines use answer from THIS service?
// Run inside the service: node scripts/phase1-check.ts
import pg from 'pg';
import { exa, tavily, brave, secrets } from '../src/core/index.ts';
import * as proxy from '../src/core/proxy.ts';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
const rows: Array<[string, string, string]> = [];
const rec = (name: string, ok: boolean, note: string) => { rows.push([name, ok ? 'OK' : 'FAIL', note.slice(0, 140)]); };
const guard = async (name: string, fn: () => Promise<string>) => {
  try { rec(name, true, await fn()); } catch (e) { rec(name, false, (e as Error).message); }
};

await Promise.all([exa.refresh(), tavily.refresh(), brave.refresh(), secrets.refresh()]);

const lanes = (await pool.query('select label, url, api_key, model, enabled from llm_lane order by id')).rows;
await Promise.all(lanes.map((l) => guard('llm lane ' + l.label + ' (' + l.model + ')' + (l.enabled ? '' : ' [disabled]'), async () => {
  const t = Date.now();
  const res = await fetch(String(l.url).replace(/\/+$/, '') + '/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + l.api_key },
    body: JSON.stringify({ model: l.model, messages: [{ role: 'user', content: 'Reply with the word ok.' }], max_tokens: 16 }),
    signal: AbortSignal.timeout(60_000),
  });
  const body = await res.text();
  if (!res.ok) throw new Error('HTTP ' + res.status + ' ' + body);
  return 'HTTP 200 in ' + (Date.now() - t) + ' ms';
})));

const px = proxy.proxy();
await guard('US proxy saved (exa_proxy row)', async () => { if (!px) throw new Error('no exa_proxy row'); return px.url; });
if (px) {
  await guard('US proxy /usage exa', async () => JSON.stringify(await proxy.usage('exa')).slice(0, 120));
  await guard('US proxy /usage tavily', async () => JSON.stringify(await proxy.usage('tavily')).slice(0, 120));
}
await guard('exa search (pool)', async () => { const h = await exa.search('Petronas Malaysia', { numResults: 2, timeoutMs: 40_000 }); if (!h.length) throw new Error('0 hits'); return h.length + ' hits'; });
await guard('tavily search (pool)', async () => { const h: any = await tavily.search('Petronas Malaysia', { maxResults: 2, timeoutMs: 40_000 }); const n = Array.isArray(h) ? h.length : (h?.results?.length ?? 0); if (!n) throw new Error('0 hits'); return n + ' hits'; });
await guard('brave search', async () => { const h = await brave.search('Petronas Malaysia'); if (!h.length) throw new Error('0 hits'); return h.length + ' hits'; });

const keys = (await pool.query('select kind, count(*)::int n from gemini_contact_key group by kind order by kind')).rows;
rows.push(['keys in DB', 'INFO', keys.map((k) => k.kind + ':' + k.n).join(' ')]);
console.log(rows.map((r) => r.join(' | ')).join('\n'));
await pool.end();
process.exit(0);
