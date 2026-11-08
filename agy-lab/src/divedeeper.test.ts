import test from 'node:test';
import assert from 'node:assert/strict';
import { enabled, handle, handlePage, handlePublic, previewAuto } from './divedeeper.ts';
import { buildReport } from './divedeeper/report-html.ts';
import { buildPreview } from './divedeeper/preview-html.ts';
import { editPreview } from './divedeeper/preview-editor.ts';
import fs from 'node:fs';
import path from 'node:path';
import { runLane, serviceFailures } from './divedeeper/runner.ts';
import { SECTIONS, makeCtx } from './divedeeper/lib.ts';
import { resolve } from './divedeeper/editor.ts';
import { badPhone, normPhone, showPhone } from './divedeeper/sections/R-contacts.ts';

const fakeReq = (method: string, path: string) => ({ method, url: path, headers: { host: 'x' } }) as any;
const fakeRes = () => ({ writeHead() {}, end() {} }) as any;

test('dive-deeper is off unless DIVE_DEEPER_ENABLED says on', () => {
  assert.equal(enabled({}), false);
  assert.equal(enabled({ DIVE_DEEPER_ENABLED: '0' }), false);
  assert.equal(enabled({ DIVE_DEEPER_ENABLED: 'true' }), true);
  assert.equal(enabled({ DIVE_DEEPER_ENABLED: '1' }), true);
});

test('previews are written automatically unless DD_PREVIEW_AUTO says off', () => {
  assert.equal(previewAuto({}), true);
  assert.equal(previewAuto({ DD_PREVIEW_AUTO: 'on' }), true);
  assert.equal(previewAuto({ DD_PREVIEW_AUTO: 'off' }), false);
  assert.equal(previewAuto({ DD_PREVIEW_AUTO: '0' }), false);
});

test('with the switch off every handler declines, so the hub behaves as before', async () => {
  const before = process.env.DIVE_DEEPER_ENABLED;
  delete process.env.DIVE_DEEPER_ENABLED;
  try {
    const ctx = { json: () => assert.fail('must not answer'), readJson: async () => ({}) };
    assert.equal(await handle(fakeReq('GET', '/api/dive-deeper'), fakeRes(), new URL('http://x/api/dive-deeper'), ctx), false);
    assert.equal(handlePage(fakeReq('GET', '/dive-deeper'), fakeRes(), new URL('http://x/dive-deeper')), false);
    assert.equal(await handlePublic(fakeReq('GET', '/dd/abcdefghijklmnopqrst'), fakeRes(), new URL('http://x/dd/abcdefghijklmnopqrst')), false);
    assert.equal(await handlePublic(fakeReq('GET', '/dp/abcdefghijklmnopqrst'), fakeRes(), new URL('http://x/dp/abcdefghijklmnopqrst')), false);
  } finally {
    if (before !== undefined) process.env.DIVE_DEEPER_ENABLED = before;
  }
});

test('the report builds the parts, the full analysis and the action plan from data alone, and survives missing lanes', () => {
  const dive = {
    company: 'Acme Sdn Bhd', finished_at: '2026-10-25T10:00:00Z',
    dossier: '# Acme\n\n## Identity\n\nAcme makes widgets [1].\n\n| Item | Detail |\n|---|---|\n| Name | Acme |',
    result: { identity: { legal_name: 'Acme Sdn Bhd', official_domains: ['acme.my'], registration_numbers: ['202301000001'] }, facts: [], sources: [{ id: 1, url: 'https://acme.my/', title: 'Acme' }], contradictions: [], gaps: [], people: { people: [] } },
  };
  const lanes = {
    'N-news': { ran_at: '2026-10-26T01:00:00Z', findings: [{ title: '1★ review with no reply', detail: 'x', severity: 'high', source: 'https://maps.example/' }] },
    'S4-analysis': { notes: { verdict: 'Short summary.', parts: [{ theme: 'voice', assessment: 'Nobody answers the reviews.' }], threads: [{ title: 'Nobody owns the listing', body: 'b', themes: ['voice'] }], strengths: ['A 4.7 rating'] } },
    'S5-plan': { notes: { depts: [{ dept: 'social', tasks: [{ dept: 'social', task: 'Reply to reviews', why: 'none answered', how: 'h', when: 'week', effort: '1 hour', impact: 'high', theme: 'voice', ready: 'replies', items: ['N-news#0'] }], also: [] }], ready: { replies: 'the review replies, ready to post' } } },
  };
  const html = buildReport(dive, lanes).replace(/\u00a0|&nbsp;/g, ' ');
  for (const part of ['id="stories"', 'Short summary.', 'Nobody answers the reviews.', 'Nobody owns the listing', 'What you can build on', 'Your action plan', 'Social media', 'This week', 'Done for you: the review replies', 'Nothing for this department right now.', 'What a stranger sees', 'The full checklist', 'Background research', '1★ review with no reply', 'Reply to reviews', 'id="src-1"']) assert.ok(html.includes(part), part);
  assert.ok(!/undefined|\[object Object\]|NaN/.test(html.replace(/<style[\s\S]*?<\/style>/, '')));
});

test('the report speaks the editor\'s plain words and never shows the lanes\' machine labels', () => {
  const dive = { company: 'Acme Sdn Bhd', finished_at: '2026-10-25T10:00:00Z', dossier: '', result: { identity: { legal_name: 'Acme Sdn Bhd' } } };
  const lanes = {
    'D-registry': { ran_at: '2026-10-26T01:00:00Z', findings: [{ title: 'CONTRADICTED: CIDB Grade G3', detail: 'register says G7', severity: 'high', verdict: 'contradicted', direction: 'undersell', source: 'https://cims.cidb.gov.my/' }] },
    'G-search': { ran_at: '2026-10-26T01:00:00Z', findings: [{ title: 'gpt-6.1-sol, asked "Where?": 1 wrong claim about you. [2 of 3 asks; others: doesnt_know]', detail: 'Outcomes: what=correct', severity: 'high', source: null }] },
    'S3-editor': { notes: {
      plain: { 'G-search#0': { title: 'An AI assistant gives customers the wrong office address', why: 'They may turn up at the wrong place.' } },
      verdict: 'You are better than your website says.',
      stories: [{ theme: 'understanding', headline: 'AI assistants send customers to the wrong address', body: 'b', cost: 'c', fix: 'f' }],
    } },
  };
  const html = buildReport(dive, lanes).replace(/<style[\s\S]*?<\/style>/, '').replace(/\u00a0|&nbsp;/g, ' ');
  for (const s of ['An AI assistant gives customers the wrong office address', 'AI assistants send customers to the wrong address', 'You are better than your website says.', 'Better than you claim']) assert.ok(html.includes(s), s);
  for (const bad of ['CONTRADICTED:', 'doesnt_know', 'gpt-6.1-sol', 'what=correct']) assert.ok(!html.includes(bad), bad);
  // Without S5, every urgent finding still lands under the department that does it.
  assert.ok(/id="plan-website"[\s\S]*An AI assistant gives customers the wrong office address/.test(html), 'unplanned finding listed under its department');
});

test('the report reads in six research parts, each drawn from its own lanes', () => {
  const dive = { company: 'Acme Sdn Bhd', finished_at: '2026-10-25T10:00:00Z', dossier: '', result: { identity: { legal_name: 'Acme Sdn Bhd', official_domains: ['acme.my'] } } };
  const at = '2026-10-26T01:00:00Z';
  const lanes = {
    'R-contacts': { ran_at: at, findings: [{ title: 'Phone 012-345 6789 reaches Ali personally, who has left', detail: 'd', severity: 'high', source: null, check: 'contact-personal' }],
      notes: { judged: true, inventory: [{ kind: 'phone', value: '012-345 6789', where: ['Google Maps: Acme'], status: 'personal', left: true, owner: 'Ali', also_on: 2 }, { kind: 'email', value: 'info@acme.my', where: ['your website'], status: 'current' }] } },
    'B-brand': { ran_at: at, findings: [], notes: { coverage: { score: 42 }, why_choose_you: 'Fast installs across Johor.', five_second_test: { pass: false, understood: 'a widget firm', problem: 'no prices' }, offer: [{ item: 'Widget installation', outside: 'missing', ai: 'vague' }], missing: ['price range'] } },
    'N-news': { ran_at: at, findings: [], notes: { items: [{ url: 'https://news.example/acme', host: 'news.example', date: '2026-05-01', about: 'company', sentiment: 'negative', summary: 'A customer dispute over a late install.', quote: '' }], counts: { news: 1, negative: 1 } } },
    'K-credibility': { ran_at: at, findings: [], notes: { checks: [{ id: 'bnm', label: 'Bank Negara Financial Consumer Alert list', where: 'bnm.gov.my', result: 'clear', detail: 'not named' }, { id: 'court', label: 'Published court judgments and cases', where: '', result: 'found', detail: '1 case', source: 'https://court.example/' }, { id: 'trademark', label: 'Trademark signals on the public web', where: 'web search', result: 'conflict', detail: 'Acme Trading filed ACME in class 37', source: null }] } },
    'A-assets': { ran_at: at, findings: [{ title: 'acme.my expires in 20 days (2026-11-15)', detail: 'd', severity: 'high', source: null, check: 'expiry' }],
      notes: { domains: [{ domain: 'acme.my', why: ['official site'], registrar: 'Exabytes', expires: '2026-11-15', registrant: null, host: 'Google Cloud', mail: 'Google Workspace', dmarc: null, site: { status: 200 }, cert: { valid_to: '2027-01-01' } }], subdomains: [],
        blacklists: [{ id: 'barracuda', name: 'Barracuda', working: true }, { id: 'spamcop', name: 'SpamCop', working: true }],
        email: [{ domain: 'acme.my', mx: ['mail.acme.my'], ips: ['1.2.3.4'], lists: { barracuda: { listed: ['1.2.3.4'], checked: 1, failed: 0 }, spamcop: { listed: [], checked: 1, failed: 0 } }, spf: { records: 2, record: 'v=spf1 a mx ~all', lookups: 2, all: '~all' }, dkim: [], dmarc: null, mta_sts: false, tls_rpt: false }] } },
    'W-speed': { ran_at: at, findings: [{ title: 'Google scores your mobile homepage on acme.my 42 out of 100 for speed', detail: 'd', severity: 'high', source: null, check: 'psi-score' }],
      notes: { homes: [{ site: 'acme.my', url: 'https://acme.my/' }], pages: [{ ok: true, site: 'acme.my', strategy: 'mobile', scores: { performance: 42, accessibility: 91, 'best-practices': 77, seo: 85 }, lab: { 'Main content shown': '6.1 s' }, field: { scope: 'the whole site', overall: 'slow', metrics: { 'Main content shown': '4.2 s (slow)' } }, fixes: [], flags: [] }] } },
    'C-merged': { ran_at: at, findings: [{ title: 'Your SSM number is missing from the site', detail: 'd', severity: 'medium', source: null, check: 'ssm' }, { title: 'WhatsApp link does not open a chat', detail: 'd', severity: 'high', source: null, check: 'whatsapp' }] },
  };
  const html = buildReport(dive, lanes).replace(/<style[\s\S]*?<\/style>/, '').replace(/\u00a0|&nbsp;/g, ' ');
  for (const s of ['Part 1 · Contact and reachability', 'Part 2 · How the internet understands you', 'Part 3 · Reviews, discussion and news', 'Part 4 · Credibility and official records', 'Part 5 · Digital assets', 'Part 6 · Website speed and quality', 'Part 7 · Full analysis', 'Part 8 · Action plan', 'Google’s speed score',
    'Someone who has left', 'Fast installs across Johor.', 'Widget installation', 'A customer dispute over a late install.', 'Bank Negara Financial Consumer Alert list', 'Possible conflict', 'Acme Trading filed ACME in class 37', 'Exabytes', 'Can be faked', 'How the world’s mail systems see your email', 'Listed: Barracuda', 'Broken', '20 days']) assert.ok(html.includes(s), s);
  assert.ok(!/undefined|\[object Object\]|NaN/.test(html));
  // The website lane's checks land in the part they are about.
  const R = resolve(dive, lanes);
  assert.equal(R.items.find((x) => /SSM number/.test(x.title))?.area, 'credibility');
  assert.equal(R.items.find((x) => /WhatsApp link/.test(x.title))?.area, 'contact');
});

test('the report is a working tool: real tick boxes, copy buttons, no repeated filler, the re-audit card, no invented sales figure', () => {
  const at = '2026-10-26T01:00:00Z';
  const dive = { company: 'Acme Sdn Bhd', finished_at: '2026-10-25T10:00:00Z', dossier: '', result: { identity: { legal_name: 'Acme Sdn Bhd', official_domains: ['acme.my'] }, contradictions: ['Head office is unit 01-23 on one site and 23-01 on another'] } };
  const same = 'This makes it harder for customers to verify your company status.';
  const lanes = {
    'R-contacts': { ran_at: at, findings: [], notes: { judged: true, inventory: [{ kind: 'phone', value: '012-345 6789', where: ['Google Maps: Acme'], status: 'personal', left: true, owner: 'Ali' }, { kind: 'email', value: 'info@acme.my', where: ['your website'], status: 'current' }] } },
    'N-news': { ran_at: at, findings: [0, 1, 2].map((i) => ({ title: `Problem number ${i}`, detail: 'd', severity: 'high', source: null })) },
    'S3-editor': { notes: { plain: Object.fromEntries([0, 1, 2].map((i) => [`N-news#${i}`, { title: `Problem number ${i}`, why: same }])) } },
    'S5-plan': { notes: { depts: [{ dept: 'website', tasks: [{ dept: 'website', task: 'Fix the contact page', why: 'w', how: 'h', when: 'week', effort: '1 hour', theme: 'contact' }], also: [] }] } },
    'S2-consult': { notes: {
      site: { verdict: 'v', homepage: { headline: 'Solar for factories', subheadline: 's', proof_points: ['p'], cta: 'Call us', sections: [{ title: 'T', body: 'B' }] } },
      replies: { replies: [{ i: 0, reply: 'We are sorry and will call you.' }], template_5star: 'Thank you!', ask_message: 'Could you leave a review?' },
      reply_targets: [{ stars: 1, author: 'Sam', date: at, text: 'Bad' }],
      ai: { actions: [], faq: [{ q: 'Do you install?', a: 'Yes.' }] },
      jsonld: { '@context': 'https://schema.org', '@type': 'Organization', name: 'Acme' },
    } },
  };
  const html = buildReport(dive, lanes);
  // The file is UTF-8 and says so; no legacy-codepage garble of the curly quotes, dashes and dots.
  assert.match(html, /<meta charset="utf-8">/);
  assert.ok(!/Ã|â€|Â|�/.test(html), 'mojibake');
  // The tick boxes are real inputs, one per task; the old text glyph is gone.
  assert.match(html, /<input type="checkbox" data-tick="website-0" aria-label="Done: Fix the contact page">/);
  assert.ok(!html.includes('☐'));
  // Copy buttons point at elements that exist.
  for (const id of ['schema-code', 'copy-home', 'reply-0', 'reply-5star', 'reply-ask', 'copy-faq']) {
    assert.ok(html.includes(`data-copy="${id}"`), `button for ${id}`);
    assert.ok(html.includes(`id="${id}"`), `target ${id}`);
  }
  // A consequence line shared by several findings is said once per table.
  const tables = html.match(/<table class="band items">[\s\S]*?<\/table>/g) ?? [];
  for (const t of tables) assert.ok(t.split(same).length - 1 <= 1, 'repeated filler in one table');
  assert.ok(html.includes(same), 'first occurrence kept');
  // The 30-day card names no price or address of its own; the leak strip counts, it does not estimate.
  assert.ok(html.includes('Verify your fixes in 30 days') && html.includes('reply to the email that sent you this report'));
  assert.ok(/id="plan"[\s\S]*class="followup"[\s\S]*id="ready"/.test(html), 'card closes the plan');
  assert.ok(html.includes('Where customers can slip away') && html.includes('lead the wrong way'));
  const leak = html.match(/<div class="leak">[\s\S]*?<\/div>/)?.[0] ?? '';
  assert.ok(leak && !/%|per ?cent/i.test(leak), 'no invented rate');
  // Every inline script is plain ASCII, so a wrong-charset reader cannot break it.
  for (const s of html.match(/<script>[\s\S]*?<\/script>/g) ?? []) assert.ok(/^[\x00-\x7f]*$/.test(s), 'ascii script');
  assert.ok(!/undefined|\[object Object\]|NaN/.test(html.replace(/<style[\s\S]*?<\/style>/, '')));
});

test('Malaysian phone numbers are read the way they are printed, and impossible ones are caught', () => {
  assert.equal(normPhone('+6011-2067 2895'), '601120672895');
  assert.equal(showPhone(normPhone('011-2067 2895')), '011-2067 2895');
  assert.equal(showPhone(normPhone('07-2345678')), '07-2345678');
  assert.equal(showPhone(normPhone('088-123456')), '088-123456');
  assert.equal(badPhone(normPhone('1300-88-1234')), null);
  assert.match(String(badPhone(normPhone('03-1234 5678'))), /placeholder/);
  assert.match(String(badPhone(normPhone('012-34567'))), /digits/);
});

test('a lane that cannot load comes back failed instead of throwing', async () => {
  const r = await runLane('Z', 'missing', 'test-0', { company: 'Acme' });
  assert.equal(r.status, 'failed');
  assert.match(String(r.failure), /no lane file/);
});

test('a lane past its time limit fails and names the call it was still waiting on', async () => {
  const file = path.join(SECTIONS, 'Ztest-hang.ts');
  fs.writeFileSync(file, "export async function run(ctx) { await ctx.track('page https://slow.example/', new Promise(() => {})); return { findings: [] }; }\n");
  try {
    const r = await runLane('Ztest', 'hang', 'test-1', { company: 'Acme' }, 50);
    assert.equal(r.status, 'failed');
    assert.match(String(r.failure), /did not finish within .*still waiting on page https:\/\/slow\.example\//);
  } finally {
    fs.rmSync(file, { force: true });
  }
});

test('a lane whose outside service failed after every backup counts as failed; notes alone do not', () => {
  const ctx = makeCtx('test-2', 'Z', 'meter');
  assert.equal(serviceFailures(ctx.meter), null);
  ctx.meter.llm.failed = 1;
  ctx.meter.brave.failed = 2;
  assert.match(String(serviceFailures(ctx.meter)), /1 LLM call\(s\) failed on every lane; 2 search\(es\) failed on every engine/);
});

test('the preview landing page builds from the company-dive alone, uses the editor notes, and shows the deeper dive as not run yet', () => {
  const dive = {
    company: 'Acme Sdn Bhd', finished_at: '2026-10-25T10:00:00Z', dossier: '## Identity\n\nAcme makes widgets [1].',
    result: {
      identity: { legal_name: 'Acme Sdn Bhd', address: '1 Jalan Satu, 81100 Johor Bahru, Johor', official_domains: ['acme.my'], registration_numbers: ['202301000001'], industry: 'Widget installation' },
      facts: [{ fact: 'Claims CIDB Grade G7 registration [2].' }], sources: [{ id: 1, url: 'https://acme.my/', title: 'Acme' }],
      contradictions: ['Founding month: July 2023 in [1] vs September 2023 in [2].'], gaps: ['Directors are not named.'], people: { people: [{ name: 'Ali', role: 'CEO' }] },
    },
  };
  // Non-breaking spaces from the typesetting read as plain spaces here.
  const html = buildPreview(dive, { price: 'RM 990' }).replace(/<style[\s\S]*?<\/style>/, '').replace(/\u00a0|&nbsp;/g, ' ');
  for (const s of ['Prepared for Acme Sdn Bhd', 'July 2023 vs September 2023.', 'Directors are not named.', 'Contradiction', 'Missing', 'Surface scan', 'Not run yet', 'problems to uncover', 'RM 990', 'How important is an AI recommendation', 'id="src-1"']) assert.ok(html.includes(s), s);
  assert.ok(!/undefined|\[object Object\]|NaN/.test(html));
  assert.ok(!/\[\d+\]/.test(html.replace(/<details[\s\S]*<\/details>/g, '')), 'no [n] citations outside the research appendix');
  assert.ok(buildPreview({ company: 'Empty' }).includes('Empty'), 'a dive with no result still builds');
  // What the full report holds, in its six parts, with the company's own claims mapped to their register.
  for (const s of ['Contact and reachability', 'Digital assets', 'Part 1 · Contact and reachability', 'Part 2 · How the internet understands you', 'Part 3 · Reviews, discussion and news', 'Part 5 · Digital assets', 'Bank Negara alert list', 'is how clearly the market sees it.', 'Read it before your competitors do.', 'Fix it before your customers see it.', 'Choosing a supplier? Check them first.', 'SSM e-Info documents', 'acme.com.my · ?', 'About Ali', 'Part 4 · Credibility and official records', 'Part 6 · Website speed and quality', 'Part 7 · Full analysis', 'Part 8 · Action plan', 'Social media: reviews, replies and listings', 'Eight parts, written for', 'How top AI sees your brand', 'How search engines index your company', 'Claims CIDB Grade G7 registration.', 'CIDB contractor register', 'acme.my', 'in Johor Bahru']) assert.ok(html.includes(s), s);
  assert.ok(buildPreview({ ...dive, finished_at: new Date('2026-10-25T10:00:00Z') }).includes('Online Presence Audit 2026'), 'a Date finished_at still gives the year');
  const edited = buildPreview(dive, {}, { hook: 'Your award label is a year out.', known: [{ label: 'Founded', value: 'July 2023' }], warnings: [{ type: 'outdated', title: 'Award label still says 2024', detail: 'd', risk: 'r' }] }).replace(/\u00a0|&nbsp;/g, ' ');
  for (const s of ['Your award label is a year out.', 'Award label still says 2024', 'Outdated', 'July 2023']) assert.ok(edited.includes(s), s);
});

test('the public preview names only leadership and shows no phone, private document or unrelated source', () => {
  const dive = {
    company: 'Acme Sdn Bhd', finished_at: '2026-10-25T10:00:00Z', dossier: '| Phone | +60 11-2341 1550 (Ali Staff) | [3] |',
    result: {
      identity: { legal_name: 'Acme Sdn Bhd', official_domains: ['acme.my'] },
      people: { people: [{ name: 'Boss Bin Owner', role: 'CEO & Founder' }, { name: 'Ali Staff', role: 'Site manager, phone +60 11-2341 1550' }] },
      sources: [{ id: 1, url: 'https://acme.my/', title: 'Acme', relevant: true }, { id: 2, url: 'https://quote-app.example/proposal?uid=abc', title: 'Proposal', relevant: true }, { id: 3, url: 'https://eternally.example/', title: 'Eternally', relevant: false }],
      contradictions: ['Phone: Ali Staff gives +60 11-2341 1550 vs 012-7165685 on the site.'], gaps: [],
    },
  };
  const notes = { hook: 'Ali Staff answers on +60 11-2341 1550.', known: [{ label: 'Team', value: 'Ali Staff runs sites' }], warnings: [{ type: 'missing' as const, title: 'See ee-proposal-production.up.railway.app?uid=abc', detail: 'Ali Staff, 012-7165685', risk: 'r' }] };
  for (const html of [buildPreview(dive), buildPreview(dive, {}, notes)]) {
    for (const bad of ['Ali Staff', '2341', '7165685', 'uid=', 'proposal-production', 'quote-app.example', 'eternally.example']) assert.ok(!html.includes(bad), bad);
    assert.ok(html.includes('Boss Bin Owner'), 'leadership stays');
    assert.ok(html.replace(/\u00a0/g, ' ').includes('We read 1 public source about'), 'only relevant, non-private sources are counted');
  }
});

test('the full report lists no private document or unrelated source, and its write-up hides private links', () => {
  const dive = {
    company: 'Acme Sdn Bhd', finished_at: '2026-10-25T10:00:00Z', dossier: '| Proposal app | ee-proposal-production.up.railway.app, one per customer via uid | [2] |',
    result: { identity: { legal_name: 'Acme Sdn Bhd' }, sources: [{ id: 1, url: 'https://acme.my/', title: 'Acme', relevant: true }, { id: 2, url: 'https://x.example/inv-m2/123', title: 'Invoice', relevant: true }, { id: 3, url: 'https://other.example/', title: 'Other', relevant: false }] },
  };
  const html = buildReport(dive, {});
  for (const bad of ['ee-proposal-production', 'inv-m2', 'other.example']) assert.ok(!html.includes(bad), bad);
  assert.ok(html.includes('a private customer document') && html.includes('acme.my'));
});

test('every report ends with the technology partner strip, one mark per partner', async () => {
  const { reportPage } = await import('./companydive-report.ts');
  const { PARTNERS } = await import('./divedeeper/partners.ts');
  const dossier = reportPage({ company: 'Acme Sdn Bhd', status: 'done', dossier: '## Overview\nAcme sells solar panels [1].', sources: [{ id: 1, url: 'https://acme.my', title: 'Acme' }] }, 'abcdefghijklmnopqrst');
  for (const html of [buildReport({ company: 'Acme' }, {}), buildPreview({ company: 'Acme' }), dossier]) {
    assert.equal(html.match(/class="partners"/g)?.length, 1);
    assert.match(html, /Technology partner/);
    for (const p of PARTNERS) assert.ok(html.includes(`<span>${p.name}</span>`), p.name);
  }
  assert.deepEqual(PARTNERS.map((p) => p.name), ['Tavily', 'Brave Search', 'Exa', 'Google Maps', 'Google PageSpeed Insights', 'DeepSeek', 'OpenAI']);
});

test('the preview editor reads the research, not the dossier, so it can start before the dossier is written', async () => {
  const dive = { company: 'Acme Sdn Bhd', dossier: 'DOSSIER-TEXT', result: { identity: { legal_name: 'Acme Sdn Bhd' }, facts: [{ fact: 'Acme makes widgets' }], contradictions: [], gaps: [] } };
  let prompt = '';
  const notes = await editPreview(dive, async (p) => { prompt = p; return '{"hook":"h","known":[],"warnings":[{"type":"missing","title":"No SSM number","detail":"d","risk":"r"}]}'; }, JSON.parse, () => {});
  assert.ok(prompt.includes('Acme makes widgets'));
  assert.ok(!prompt.includes('DOSSIER-TEXT'));
  assert.equal(notes?.warnings?.length, 1);
});
