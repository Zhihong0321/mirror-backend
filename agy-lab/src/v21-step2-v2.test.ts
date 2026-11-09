// V2.1 Step 2 rules v2: the plain-code check and the recheck merge, each failure path made to fail on purpose.
import test from 'node:test';
import assert from 'node:assert/strict';
import { applyRecheckV2, checkV2, judgeV2, recheckV2, type Step2V2Output } from './v21/step2-v2.ts';
import { stripMarkdown, cleanText, type TidyData } from './v21/tidy.ts';

const tidy: TidyData = {
  version: '2.1',
  stage: 1.5,
  input: { company: 'Acme Solar Sdn Bhd', country: 'Malaysia', industry: 'Solar PV company' },
  official: {
    domain: 'acme.me',
    site_wide: 'Acme Solar Sdn Bhd · 202301000001 · +60 11-2100 0099',
    pages: [{ label: 'home', url: 'https://acme.me', text: 'HQ: 01-23, Jalan Mutiara, 81100 Johor Bahru\n62 people across five offices', cut_chars: 0 }],
    other_own_pages: [],
  },
  own_linkedin: { linkedin_url: 'https://www.linkedin.com/company/acme/', company_size: '13 employees' },
  evidence: [
    { id: 'E1', kind: 'google_maps', source_name: 'Google Maps', url: 'https://maps/acme', text: 'Name: Acme Solar Sdn Bhd | Address: 23-01, Jalan Mutiara, 81100 Johor Bahru | Phone: 011-2067 2895' },
    { id: 'E2', kind: 'search', source_name: 'Domain Security & Assets', url: 'https://acme.me', text: '[CRITICAL] Domain acme.solar expires in 28 days.' },
    { id: 'E3', kind: 'search', source_name: 'other.com', url: 'https://other.com/acme-trading', text: 'Acme Trading Pte Ltd, Singapore, wins award' },
  ],
  registers: [],
  could_not_check: [],
};

const contradiction = {
  id: 'c9', topic: 'contact', title: 'Two HQ addresses',
  versions: [
    { source: 'acme.me', value: '01-23, Jalan Mutiara', evidence_id: 'O1', quoted_text: 'HQ: 01-23, Jalan Mutiara' },
    { source: 'Google Maps', value: '23-01, Jalan Mutiara', evidence_id: 'E1', quoted_text: 'Address: 23-01, Jalan Mutiara' },
  ],
};
const finding = { id: 'f7', kind: 'problem', topic: 'email', title: 'Email domain expires', evidence: [{ evidence_id: 'E2', quoted_text: 'Domain acme.solar expires in 28 days' }] };

test('rules v2: valid items are kept, renumbered, with the source URL taken from the input', () => {
  const out = checkV2({ conclusive_findings: [finding], contradictions: [contradiction], suggestions: [{ action: 'Renew acme.solar', based_on: ['f7', 'c9'] }] }, tidy);
  assert.equal(out.rejected.length, 0, JSON.stringify(out.rejected));
  assert.equal(out.conclusive_findings[0].id, 'f1');
  assert.equal(out.contradictions[0].id, 'c1');
  assert.deepEqual(out.suggestions[0].based_on, ['f1', 'c1']);
  assert.equal(out.contradictions[0].versions[1].source_url, 'https://maps/acme');
});

test('rules v2: a quote not in the cited item is rejected, with the reason', () => {
  const bad = { ...finding, evidence: [{ evidence_id: 'E2', quoted_text: 'expires in 3 days' }] };
  const out = checkV2({ conclusive_findings: [bad] }, tidy);
  assert.equal(out.conclusive_findings.length, 0);
  assert.match(out.rejected[0].reasons.join(), /quoted_text is not in E2/);
});

test('rules v2: an unknown evidence id is rejected', () => {
  const out = checkV2({ conclusive_findings: [{ ...finding, evidence: [{ evidence_id: 'E99', quoted_text: 'anything at all' }] }] }, tidy);
  assert.match(out.rejected[0].reasons.join(), /"E99" is not an item/);
});

test('rules v2: a contradiction with one version, or two equal values, is rejected', () => {
  const one = { ...contradiction, versions: [contradiction.versions[0]] };
  const same = { ...contradiction, versions: [contradiction.versions[0], { ...contradiction.versions[1], value: '01-23, Jalan Mutiara' }] };
  const out = checkV2({ contradictions: [one, same] }, tidy);
  assert.equal(out.contradictions.length, 0);
  assert.match(out.rejected[0].reasons.join(), /at least two versions/);
  assert.match(out.rejected[1].reasons.join(), /do not give different values/);
});

test('rules v2: a strength resting only on the official site is rejected', () => {
  const s = { kind: 'strength', title: 'Big team', evidence: [{ evidence_id: 'O1', quoted_text: '62 people across five offices' }] };
  const out = checkV2({ conclusive_findings: [s] }, tidy);
  assert.match(out.rejected[0].reasons.join(), /strength must rest on an outside item/);
});

test('rules v2: citing an item the same answer dropped as a namesake is rejected', () => {
  const f = { kind: 'strength', title: 'Award', evidence: [{ evidence_id: 'E3', quoted_text: 'Acme Trading Pte Ltd, Singapore, wins award' }] };
  const out = checkV2({ conclusive_findings: [f], dropped_namesakes: [{ evidence_id: 'E3', name: 'Acme Trading', reason_dropped: 'Singapore company' }] }, tidy);
  assert.match(out.rejected[0].reasons.join(), /dropped_namesakes/);
});

test('rules v2: a suggestion resting on nothing kept is rejected', () => {
  const out = checkV2({ suggestions: [{ action: 'Do something', based_on: ['f1'] }] }, tidy);
  assert.equal(out.suggestions.length, 0);
  assert.match(out.rejected[0].reasons.join(), /based_on names no kept/);
});

test('rules v2 recheck: a removed item takes its suggestion with it; a missed item passes the same check', () => {
  const judged = checkV2({ conclusive_findings: [finding], contradictions: [contradiction], suggestions: [{ action: 'Fix the address', based_on: ['c9'] }] }, tidy);
  const judge = { ...judged, status: 'analyzed', stats: { llm_calls: 1, duration_ms: 1 } } as unknown as Step2V2Output;
  const applied = applyRecheckV2(
    judge,
    {
      reviews: [{ id: 'c1', verdict: 'remove', problems: ['branch, not HQ'] }],
      missed: { take_note: [{ id: 'mn1', title: 'Headcount', note: 'LinkedIn counts 13', evidence: [{ evidence_id: 'LINKEDIN', quoted_text: 'company_size: 13 employees' }] }] },
    },
    tidy,
  );
  assert.equal(applied.lists.contradictions.length, 0);
  assert.equal(applied.lists.suggestions.length, 0);
  assert.match(applied.rejected.map((r) => r.reasons.join()).join(), /based_on names no kept/);
  assert.equal(applied.lists.take_note.length, 1);
  assert.equal(applied.lists.conclusive_findings.length, 1);
  assert.equal(applied.removed[0].id, 'c1');
});

test('rules v2: every lane dead -> status failed with each attempt recorded; the recheck is skipped', async () => {
  const dead = [{ label: 'dead-port', url: 'http://127.0.0.1:9', key: 'x', model: 'none' }];
  const judged = await judgeV2(tidy, { lanes: dead });
  assert.equal(judged.status, 'failed');
  assert.match(judged.error ?? '', /All LLM lanes failed/);
  assert.equal(judged.meta.attempts.length, 1);
  const rechecked = await recheckV2(tidy, judged, { lanes: dead });
  assert.equal(rechecked.recheck?.status, 'skipped');
});

test('rules v2: a lane that answers with something that is not JSON fails over and is recorded', async () => {
  const http = await import('node:http');
  const server = http.createServer((_req, res) => {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ choices: [{ message: { content: 'sorry, no' }, finish_reason: 'stop' }] }));
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const port = (server.address() as any).port;
  try {
    const judged = await judgeV2(tidy, { lanes: [{ label: 'not-json', url: `http://127.0.0.1:${port}`, key: 'x', model: 'm' }] });
    assert.equal(judged.status, 'failed');
    assert.match(judged.meta.attempts[0].error ?? '', /not a JSON object/);
  } finally {
    server.close();
  }
});

test('Step 1.5: a transfer lock counts in WHOIS and RDAP spelling; no lock status is no lock', async () => {
  const { isTransferLocked } = await import('./v21/assets.ts');
  assert.equal(isTransferLocked(['client transfer prohibited']), true); // RDAP (atap.solar, 2026-11-06)
  assert.equal(isTransferLocked(['clientTransferProhibited https://icann.org/epp#clientTransferProhibited']), true); // WHOIS
  assert.equal(isTransferLocked(['server transfer prohibited']), true);
  assert.equal(isTransferLocked(['active', 'client delete prohibited']), false);
  assert.equal(isTransferLocked([]), false);
});

test('stripMarkdown: formatting marks go, the same characters used as text stay', () => {
  // bold, including bold glued to words or numbers (a space goes in only where two words would join) and bold-italic
  assert.equal(stripMarkdown('services in **accounting**, **auditing** and more'), 'services in accounting, auditing and more');
  assert.equal(stripMarkdown('35**RM million+** in projects'), '35RM million+ in projects');
  assert.equal(stripMarkdown('1,100**+** sites'), '1,100+ sites');
  assert.equal(stripMarkdown('Residential**Jendela Residences, KLGCC**Renovation'), 'Residential Jendela Residences, KLGCC Renovation');
  assert.equal(stripMarkdown('1. 01**Consult**Free consult'), '1. 01 Consult Free consult');
  assert.equal(stripMarkdown('* **T**02.6930.2300 / * **F**02.6930.2391'), '* T 02.6930.2300 / * F 02.6930.2391');
  assert.equal(stripMarkdown('**Media & partnership opportunities: **IreneYap@rsm.sg'), 'Media & partnership opportunities: IreneYap@rsm.sg');
  assert.equal(stripMarkdown('***Our story***'), 'Our story');
  assert.equal(stripMarkdown('Chromatix ***saved us $15,000-$20,000*** a year'), 'Chromatix saved us $15,000-$20,000 a year');
  assert.equal(stripMarkdown('__Contact us__ today'), 'Contact us today');
  // italic
  assert.equal(stripMarkdown('Your space, *thoughtfully built*.'), 'Your space, thoughtfully built.');
  assert.equal(stripMarkdown('Introducing our _Business Resilience Programme_ , today'), 'Introducing our Business Resilience Programme , today');
  // headings: line start (any language) and flattened mid-line
  assert.equal(stripMarkdown('##### Awards'), 'Awards');
  assert.equal(stripMarkdown('## 회사 소개'), '회사 소개');
  assert.equal(stripMarkdown('LinkedIn. ### How much revenue'), 'LinkedIn. How much revenue');
  assert.equal(stripMarkdown('13 reviews #### 4.5#### Canty Digital'), '13 reviews 4.5 Canty Digital');
  assert.equal(stripMarkdown('[...] ## #1 Websites That Make Your Phone Ring'), '[...] #1 Websites That Make Your Phone Ring');
  assert.equal(stripMarkdown('노하우를 전수해드리겠습니다. [#### 아카데미의 실력?'), '노하우를 전수해드리겠습니다. [아카데미의 실력?');
  // escapes
  assert.equal(stripMarkdown('@kikumasamune\\_official'), '@kikumasamune_official');
  // lone marks are text: masked phones (also two on one line, also a bold word after a mask), hashtags, ranks, C#,
  // snake_case, star ratings, unit numbers
  assert.equal(stripMarkdown('CALL 03-7971 9**XX · WhatsApp 03-3324 4**XX'), 'CALL 03-7971 9**XX · WhatsApp 03-3324 4**XX');
  assert.equal(stripMarkdown('Call · 03-3324 4**XX · **Fax** · 012-345 6***'), 'Call · 03-3324 4**XX · Fax · 012-345 6***');
  assert.equal(stripMarkdown('#1 in Malaysia #solar C# developer my_var_name'), '#1 in Malaysia #solar C# developer my_var_name');
  assert.equal(stripMarkdown('Lot # 12, a 5* hotel'), 'Lot # 12, a 5* hotel');
  // cleanText (snippets, passages, reviews) strips them too
  assert.equal(cleanText('<b>Home</b> ### **Awards** &amp; more'), 'Home Awards & more');
});
