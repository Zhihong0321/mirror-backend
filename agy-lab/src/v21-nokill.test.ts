// No kill gates (2026-11-11): text around the JSON, a rejected email subject and a failed writing call never take
// away the answer, the email or the report page. Fake lanes, no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseAnswer, type Lane } from './v21/judge.ts';
import { writeStep3, reportPage } from './v21/step3.ts';

const s2: any = {
  rules: 'v2', status: 'analyzed',
  input: { company: 'Acme Bhd', country: 'Malaysia', industry: 'Solar' },
  baseline: { websites: ['acme.example'] },
  conclusive_findings: [
    { id: 'f1', kind: 'strength', topic: 'awards', title: 'S', statement: 'Won an award', evidence: [], why_it_matters: '', identity: 'x', confidence: 'high' },
    { id: 'f2', kind: 'problem', topic: 'contact', title: 'P', statement: 'Phone differs', evidence: [], why_it_matters: '', identity: 'x', confidence: 'high' },
  ],
  contradictions: [], take_note: [], suggestions: [], dropped_namesakes: [], rejected: [],
};

const lane: Lane = { label: 'fake', url: 'http://fake/1', key: 'k', model: 'm' };
function fakeLane(content: string | null) {
  const orig = globalThis.fetch;
  globalThis.fetch = (async () => content === null
    ? { ok: false, status: 500, text: async () => 'down', json: async () => ({}) }
    : { ok: true, status: 200, text: async () => '', json: async () => ({ choices: [{ message: { content }, finish_reason: 'stop' }] }) }) as any;
  return () => { globalThis.fetch = orig; };
}

test('parseAnswer: text around the JSON object is set aside, the answer is kept', () => {
  assert.deepEqual(parseAnswer('Here is the JSON you asked for:\n{"a": 1, "b": {"c": [2]}}\nHope this helps.'), { a: 1, b: { c: [2] } });
  assert.deepEqual(parseAnswer('```json\n{"a": 1}\n```'), { a: 1 });
  assert.throws(() => parseAnswer('no json here'), /not a JSON object/);
});

test('Step 3: a subject that fails the check does not blank the email; the model words are kept and labelled', async () => {
  const answer = JSON.stringify({
    summary: [{ text: 'Your phone differs.', cites: ['f2'] }],
    titles: [], proof: { id: 'f2' },
    email: { subject: { text: 'We found 7 problems', cites: ['zz'] }, body: [{ text: 'Your phone differs between pages.', cites: ['f2'] }] },
  });
  const restore = fakeLane(answer);
  try {
    const { report, email } = await writeStep3(s2, { row_id: 1, run_id: 'r' }, 'https://x/r/1', { lanes: [lane] });
    assert.equal(report.status, 'ok');
    assert.equal(email.status, 'ok');
    assert.match(email.unchecked ?? '', /subject failed the check/);
    assert.equal(email.subject?.text, 'We found 7 problems');
    assert.match(email.text, /Subject: We found 7 problems/);
    assert.match(email.text, /Your phone differs between pages/);
    assert.ok(email.rejected.some((r) => r.part === 'subject'));
  } finally { restore(); }
});

test('Step 3: every lane down -> the email still has the greeting and link, and the failed report row still draws a page', async () => {
  const restore = fakeLane(null);
  try {
    const { report, email } = await writeStep3(s2, { row_id: 1, run_id: 'r' }, 'https://x/r/1', { lanes: [lane] });
    assert.equal(report.status, 'failed');
    assert.ok(email.text.includes('https://x/r/1'));
    const html = reportPage(report, s2, { now: new Date('2026-11-11T00:00:00Z') });
    assert.ok(html.length > 1000);
    assert.match(html, /Acme Bhd/);
  } finally { restore(); }
});

test('tidy: on a long register the company entry comes first, and passages over the limit are counted, not cut silently', async () => {
  const { tidyCheckpoint } = await import('./v21/tidy.ts');
  const filler = 'x'.repeat(2000);
  const page = [...Array.from({ length: 10 }, (_, i) => `Bright Solar Works ${i} ${filler}`), 'ACME SOLAR SDN BHD licence 12345'].join(' ');
  const cp: any = {
    input: { company: 'Acme Solar Sdn Bhd', country: 'Malaysia', industry: 'Solar' },
    official_site: { domain: '', resolved_url: '', tried: [], pages: [], not_confirmed: 'No official site confirmed. Tried: no candidates' },
    third_party_discoveries: [], search_errors: ['Brave "Acme": HTTP 402'],
    probes: [{ rank: 1, category: 'licence', question: 'Licensed?', source: { name: 'Register', url: 'https://reg' }, query: 'https://reg', evidence_urls: ['https://reg'], snippets: [], page: { url: 'https://reg', status: 'ok', charCount: page.length, text: page }, found_when: '', not_found_when: '' }],
  };
  const t: any = tidyCheckpoint(cp, null);
  const m: string[] = t.registers[0].mentions;
  assert.ok(m.some((x) => /ACME SOLAR SDN BHD licence 12345/.test(x)), 'the full-name entry is shown');
  assert.match(m[m.length - 1], /more passages hold only part of the name/);
  assert.ok(t.could_not_check.some((c: any) => c.target === 'Official website'));
  assert.ok(t.could_not_check.some((c: any) => c.target === 'Web search' && /402/.test(c.reason)));
});
