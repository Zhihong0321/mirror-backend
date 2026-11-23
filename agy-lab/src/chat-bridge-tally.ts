// The hub's ChatGPT bridge: calls it makes to a worker PC's chat.ask (divedeeper/v21/myworker.ts chat()), counted since
// this hub started. GET /api/workers/health reads it. Recording never throws and never changes what a caller gets back.
const since = new Date(Date.now() - process.uptime() * 1000).toISOString();
let calls = 0;
let failed = 0;
let lastOkAt: string | null = null;
let lastFailAt: string | null = null;
let lastError: string | null = null;

export function noteChat(ok: boolean, error: string | null): void {
  const at = new Date().toISOString();
  calls += 1;
  if (ok) {
    lastOkAt = at;
    return;
  }
  failed += 1;
  lastFailAt = at;
  lastError = error ? error.slice(0, 200) : null;
}

export function chatTally() {
  return { since, calls, failed, lastOkAt, lastFailAt, lastError };
}
