// Proof screenshots for the report: open a page in a headless browser, outline the problem
// text in red, scroll it into view and keep the viewport as a JPEG (base64, embedded in the report).
//
// The browser is whatever this machine has: CHROME_PATH, the hub image's /usr/bin/chromium, or
// Chrome / Edge on Windows. No browser, a crash or a page that will not load: that shot is
// skipped with a warning and the report goes without it (no kill gates, no timeouts).
import fs from 'node:fs';

export type ShotAsk = { key: string; url: string; find?: string | null; caption: string; mobile?: boolean };
export type Shot = ShotAsk & { img: string; found: boolean; taken_at: string };

const CANDIDATES = [
  process.env.CHROME_PATH,
  '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].filter(Boolean) as string[];

export function browserPath(): string | null {
  return CANDIDATES.find((p) => { try { return fs.existsSync(p); } catch { return false; } }) ?? null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** One browser for all the shots, closed at the end. Never throws. */
export async function takeShots(asks: ShotAsk[], warn: (m: string) => void): Promise<Shot[]> {
  const exe = browserPath();
  if (!asks.length) return [];
  if (!exe) { warn('no browser on this machine; the report goes without screenshots'); return []; }
  let browser: any = null;
  const out: Shot[] = [];
  try {
    const { default: puppeteer } = await import('puppeteer-core');
    browser = await puppeteer.launch({
      executablePath: exe, headless: true, protocolTimeout: 0,
      args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--hide-scrollbars', '--lang=en-GB'],
    });
    for (const a of asks) {
      const page = await browser.newPage();
      try {
        await page.setViewport(a.mobile ? { width: 390, height: 780, deviceScaleFactor: 2, isMobile: true, hasTouch: true } : { width: 1280, height: 760, deviceScaleFactor: 1 });
        const res = await page.goto(a.url, { waitUntil: 'load', timeout: 0 });
        await sleep(1500);
        const found = a.find ? await page.evaluate((needle: string) => {
          const want = needle.toLowerCase().replace(/\s+/g, ' ').slice(0, 60);
          const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
          let n: Node | null;
          while ((n = walk.nextNode())) {
            if (!(n.nodeValue ?? '').toLowerCase().replace(/\s+/g, ' ').includes(want)) continue;
            const el = (n as Text).parentElement;
            if (!el || !el.getClientRects().length) continue;
            el.style.outline = '4px solid #e11d48';
            el.style.outlineOffset = '4px';
            el.style.background = 'rgba(225, 29, 72, 0.10)';
            el.scrollIntoView({ block: 'center' });
            return true;
          }
          return false;
        }, a.find) : false;
        if (a.find && !found) warn(`shot ${a.key}: "${a.find.slice(0, 40)}" not visible on ${a.url}; kept the top of the page`);
        await sleep(400);
        const img = await page.screenshot({ type: 'jpeg', quality: 72, encoding: 'base64' });
        out.push({ ...a, img: String(img), found, taken_at: new Date().toISOString() });
        if (res && res.status() >= 400 && a.find) warn(`shot ${a.key}: ${a.url} answered ${res.status()}`);
      } catch (e) {
        warn(`shot ${a.key} failed on ${a.url}: ${(e as Error).message}`);
      } finally {
        await page.close().catch(() => {});
      }
    }
  } catch (e) {
    warn(`browser failed to start (${exe}): ${(e as Error).message}`);
  } finally {
    await browser?.close().catch(() => {});
  }
  return out;
}
