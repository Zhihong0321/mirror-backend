// The links that keep every page one click away from every other one.
//
// Four surfaces grew four mastheads and not one of them linked out. The report
// page is the worst of it: the portal opens /r/:id with target="_blank", so that
// tab has no Back button either -- the page was a genuine dead end, not merely an
// inconvenient one. A recipient who followed a shared link had nowhere to go at
// all, including when the link was dead and the page said so.
//
// Destinations live here rather than inline in four templates, so a renamed route
// cannot quietly fix three pages and leave the fourth pointing at a 404.
//
// Two sets, because the audiences differ. A report link is shared with people
// outside the workspace; the operator console and the API reference are noise to
// them. They get the workspace and the guide, which are the two pages that can
// actually help someone holding a report.

export interface NavLink {
  href: string;
  label: string;
  /** The same label in Chinese, for the pages that render both languages. */
  zh: string;
}

const CONSOLE: NavLink = { href: '/', label: 'Console', zh: '控制台' };
const WORKERS: NavLink = { href: '/workers', label: 'Workers', zh: '工作节点' };
const AUTO_QUEUE: NavLink = { href: '/auto-queue', label: 'Auto queue', zh: '自动队列' };
const COUNTRY_INDUSTRY: NavLink = { href: '/country-industry', label: 'Country research', zh: '国家行业研究' };
const SEARCH_LISTS: NavLink = { href: '/search-lists', label: 'Search lists', zh: '搜索清单' };
const RESEARCH_LEADS: NavLink = { href: '/research-leads', label: 'Research leads', zh: '研究线索' };
const COMPANY_DIVE: NavLink = { href: '/company-dive', label: 'Company dive', zh: '公司深挖' };
const EMAIL_MARKETING: NavLink = { href: '/email-marketing', label: 'Email marketing', zh: '邮件营销' };
const DOCS: NavLink = { href: '/docs', label: 'API docs', zh: 'API 文档' };
const WORKSPACE: NavLink = { href: '/research', label: 'Workspace', zh: '工作台' };
const GUIDE: NavLink = { href: '/guide', label: 'Guide', zh: '指南' };

/** Every surface, for the pages only someone holding LAB_TOKEN reaches. */
export const OPERATOR_NAV: NavLink[] = [CONSOLE, WORKERS, AUTO_QUEUE, COMPANY_DIVE, COUNTRY_INDUSTRY, SEARCH_LISTS, RESEARCH_LEADS, EMAIL_MARKETING, DOCS, WORKSPACE, GUIDE];

/** What a report recipient can use. */
export const CLIENT_NAV: NavLink[] = [WORKSPACE, GUIDE];

/**
 * One anchor per link, current page marked.
 *
 * The current page keeps its href: a nav where the active item goes dead is a
 * nav where clicking it feels broken, and reloading the page you are on is a
 * harmless thing to let someone do.
 */
export function navHtml(links: NavLink[], current: string, options: { bilingual?: boolean } = {}): string {
  return links.map((link) => {
    const label = options.bilingual
      ? `<span class="lang-en">${link.label}</span><span class="lang-zh">${link.zh}</span>`
      : link.label;
    return `<a href="${link.href}"${link.href === current ? ' aria-current="page"' : ''}>${label}</a>`;
  }).join('');
}

/**
 * The page for a URL that is not a page.
 *
 * A mistyped path used to answer `{"error":"not found"}` in a browser window --
 * true, and the end of the road, since there is nothing on it to click. This is
 * the same fact with the way out attached.
 *
 * It carries the operator set because the two surfaces in it that are not the
 * workspace, / and /docs, are already served without a token; naming them here
 * discloses nothing that a visitor could not already see.
 */
export function missingPage(path: string): string {
  const esc = path.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark"><title>Not found</title>
<style>
:root{--bg:#0f1115;--card:#171a20;--ink:#e8eaed;--muted:#9aa3af;--line:#262b33;--accent:#7aa2f7}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:grid;place-items:center;padding:28px;background:var(--bg);color:var(--ink);
  font:14px/1.55 ui-sans-serif,-apple-system,"Segoe UI",system-ui,sans-serif}
main{width:min(520px,100%)}
h1{margin:0 0 6px;font-size:20px;letter-spacing:-.01em}
p{margin:0 0 20px;color:var(--muted);font-size:13px}
code{font:12.5px/1.5 ui-monospace,Consolas,monospace;color:var(--accent);word-break:break-all}
nav{display:flex;flex-wrap:wrap;gap:6px;padding-top:18px;border-top:1px solid var(--line)}
nav a{padding:8px 13px;border:1px solid var(--line);border-radius:8px;background:var(--card);
  color:var(--ink);font-size:13px;font-weight:550;text-decoration:none}
nav a:hover{border-color:var(--muted)}
</style></head><body><main>
<h1>Not found</h1>
<p>There is nothing at <code>${esc}</code>. These are the pages this service serves:</p>
<nav aria-label="Site">${navHtml(OPERATOR_NAV, '')}</nav>
</main></body></html>`;
}
