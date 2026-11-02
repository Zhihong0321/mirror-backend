// The last fallback for keys, after the hub database and the environment: the
// local credential vault (VAULT_PATH, default D:/Tools/my-vault/vault.json). It
// serves a run on a dev machine with no hub database, such as dive-deeper from
// the command line. The hub has no such file, so there every lookup answers ''.
// Off under `node --test`, so no test ever picks up a real key.
import fs from 'node:fs';

const VAULT = process.env.VAULT_PATH ?? 'D:/Tools/my-vault/vault.json';

type Cred = { name: string; secret: string; baseUrl?: string };
let cache: Cred[] | null = null;

function entries(): Cred[] {
  if (process.env.NODE_TEST_CONTEXT) return [];
  if (cache) return cache;
  try {
    const v = JSON.parse(fs.readFileSync(VAULT, 'utf8'));
    cache = Array.isArray(v) ? v : (v.credentials ?? v.items ?? Object.values(v));
  } catch {
    cache = [];
  }
  return cache!;
}

/** A vault entry by name, or null. */
export function entry(name: string): Cred | null {
  return entries().find((c) => c?.name === name) ?? null;
}

/** A vault secret by name, '' when there is none. */
export function secret(name: string): string {
  return String(entry(name)?.secret ?? '').trim();
}
