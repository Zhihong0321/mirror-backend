// Google PageSpeed Insights, the one client for it (the dive-deeper speed lane).
//
// Auth: a Google service account, the whole JSON, read here (on /workers via
// core/secrets.ts; GOOGLE_PAGESPEED_SERVICE_ACCOUNT env or the vault otherwise). A
// JWT signed with its key and scope "openid" buys an access token (the
// cloud-platform scope is refused, and an x-goog-user-project header gives
// 403). The token is kept until a minute before it expires. Free: every call is
// logged at $0. A 429 or 5xx is asked again once after 10s.
import crypto from 'node:crypto';
import { startCall, type ApiCall } from '../cost.ts';
import * as secrets from './secrets.ts';

const API = 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed';
const b64url = (b: Buffer | string) => Buffer.from(b).toString('base64url');

let cached: { token: string; until: number } | null = null;

/** An access token for the saved service account (core/secrets.ts), or '' with the reason passed to `warn`. */
export async function token(warn: (m: string) => void, log?: ApiCall[]): Promise<string> {
  if (cached && Date.now() < cached.until) return cached.token;
  await secrets.load();
  let sa: any;
  try { sa = JSON.parse(secrets.get('pagespeed')); } catch { warn('GOOGLE_PAGESPEED_SERVICE_ACCOUNT is missing or not JSON'); return ''; }
  const c = startCall('web', 'Google token for PageSpeed', { provider: 'google' });
  try {
    const now = Math.floor(Date.now() / 1000);
    const head = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: sa.private_key_id }));
    const body = b64url(JSON.stringify({ iss: sa.client_email, aud: sa.token_uri, scope: 'openid', iat: now, exp: now + 3600 }));
    const sig = crypto.createSign('RSA-SHA256').update(`${head}.${body}`).sign(sa.private_key).toString('base64url');
    const res = await fetch(sa.token_uri, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${head}.${body}.${sig}` }) });
    const j = await res.json() as any;
    if (!res.ok || !j.access_token) {
      log?.push(c.done({ ok: false, note: `HTTP ${res.status}` }));
      warn(`Google token HTTP ${res.status}: ${String(j.error_description ?? j.error ?? '').slice(0, 160)}`);
      return '';
    }
    log?.push(c.done({ ok: true }));
    cached = { token: j.access_token, until: Date.now() + (Number(j.expires_in ?? 3600) - 60) * 1000 };
    return cached.token;
  } catch (e) {
    log?.push(c.done({ ok: false, note: (e as Error).message.slice(0, 200) }));
    warn(`Google token failed: ${(e as Error).message}`);
    return '';
  }
}

/** One page on one device; returns Google's whole answer, or throws with the last error. */
export async function run(url: string, strategy: 'mobile' | 'desktop', accessToken: string, opts: { log?: ApiCall[] } = {}): Promise<any> {
  const q = new URLSearchParams({ url, strategy });
  for (const c of ['performance', 'accessibility', 'best-practices', 'seo']) q.append('category', c);
  let last = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    const c = startCall('web', `PageSpeed ${strategy} ${url}`, { provider: 'google' });
    try {
      const res = await fetch(`${API}?${q}`, { headers: { authorization: `Bearer ${accessToken}` } });
      const d = await res.json() as any;
      if (res.ok && d.lighthouseResult) { opts.log?.push(c.done({ ok: true })); return d; }
      last = `HTTP ${res.status}: ${String(d.error?.message ?? 'no Lighthouse result').slice(0, 200)}`;
      opts.log?.push(c.done({ ok: false, note: last }));
      if (res.status !== 429 && res.status < 500) break;
      await new Promise((r) => setTimeout(r, 10_000));
    } catch (e) {
      last = (e as Error).message;
      opts.log?.push(c.done({ ok: false, note: last.slice(0, 200) }));
    }
  }
  throw new Error(last);
}
