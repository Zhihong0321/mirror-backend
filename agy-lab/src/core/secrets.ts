// The one-key providers' keys: MiniMax, scraper.tech Maps, Parallel, Smartlead and
// the PageSpeed service account. They live in the hub database (gemini_contact_key,
// one row per kind, edited on /workers under "Other API keys"); the Railway
// variable of the same name only serves a hub whose row is empty, and the local
// vault (core/vault.ts) a dev machine with neither.
//
// get() is sync and answers from the last load, starting a reload in the background
// when that load is over a minute old; load() waits for it, so an async caller
// sees a key saved on /workers a minute ago even in a fresh process.
import * as db from '../reportdb.ts';
import * as vault from './vault.ts';

export const KINDS = {
  minimax: 'MINIMAX_API_KEY',
  scraper_tech: 'SCRAPER_TECH_KEY',
  parallel: 'PARALLEL_API_KEY',
  smartlead: 'SMARTLEAD_API_KEY',
  pagespeed: 'GOOGLE_PAGESPEED_SERVICE_ACCOUNT',
} as const;

export type Kind = keyof typeof KINDS;

const RELOAD_MS = 60_000;
let saved: Partial<Record<Kind, string>> = {};
let loadedAt = 0;
let loading: Promise<void> | null = null;

/** Reload every kind from the database (nothing to do without one). */
export async function refresh(): Promise<void> {
  if (!db.configured()) return;
  loading ??= (async () => {
    try {
      const rows = await db.listGeminiContactKeys();
      const next: Partial<Record<Kind, string>> = {};
      for (const row of rows) if (row.kind in KINDS) next[row.kind as Kind] = row.secret;
      saved = next;
    } catch { /* database down: keep the last load, env fills the rest */ }
    loadedAt = Date.now();
  })().finally(() => { loading = null; });
  return loading;
}

/** Wait for a fresh load when the last one is over a minute old. */
export async function load(): Promise<void> {
  if (Date.now() - loadedAt > RELOAD_MS) await refresh();
}

/** The key the database holds for this kind, '' when it holds none. */
export function fromDb(kind: Kind): string {
  return saved[kind] ?? '';
}

/** The key calls use: the database's, else the Railway variable. */
export function get(kind: Kind, env: NodeJS.ProcessEnv = process.env): string {
  if (Date.now() - loadedAt > RELOAD_MS) void refresh();
  return (saved[kind] || env[KINDS[kind]] || vault.secret(KINDS[kind])).trim();
}

/** The database's key by its variable name (MINIMAX_API_KEY...), '' when it holds none or the name is not one of these. */
export function fromDbByEnvName(name: string): string {
  const kind = (Object.keys(KINDS) as Kind[]).find((k) => KINDS[k] === name);
  if (kind && Date.now() - loadedAt > RELOAD_MS) void refresh();
  return kind ? fromDb(kind).trim() : '';
}
