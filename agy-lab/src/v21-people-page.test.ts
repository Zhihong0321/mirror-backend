// Step 1.6 people in the report (owner, 2026-11-11): Step 2 lists every person and contact tied to the brand, the free
// preview shows all of them half hidden. No network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { maskName, maskContact, reportPage } from './v21/step3.ts';
import { checkV2, applyRecheckV2 } from './v21/step2-v2.ts';

test('mask: half of a name and a contact hidden, in the owner\'s format', () => {
  assert.equal(maskName('GAN ZHI HONG'), 'G?? Z?? HON?');
  assert.equal(maskName('Amanda'), 'Ama???');
  assert.equal(maskContact('011-2100 0099'), '011??????99');
  assert.equal(maskContact('+60 11-2100 0099'), '+601???????99');
  assert.equal(maskContact('admin@eternalgy.com'), 'adm??@eternalgy.com');
  assert.equal(maskName(''), '');
});

const tidy: any = {
  input: { company: 'Acme Bhd', country: 'Malaysia', industry: 'Solar' },
  official: { domain: 'acme.example', site_wide: '', pages: [{ label: 'about', url: 'https://acme.example/about', text: 'Our team: Gan Zhi Hong, Director, 011-2100 0099', cut_chars: 0 }], other_own_pages: [] },
  own_linkedin: null, evidence: [], registers: [], could_not_check: [],
};

test('Step 2: people kept with their quotes; a bad quote goes alone; the recheck keeps the list', () => {
  const llm = { people: [
    { name: 'Gan Zhi Hong', role: 'Director', contact: '011-2100 0099', how_linked: 'named on the about page', evidence: [{ evidence_id: 'O1', quoted_text: 'Gan Zhi Hong, Director, 011-2100 0099' }, { evidence_id: 'O1', quoted_text: 'not on the page' }] },
    { name: 'Nobody', evidence: [{ evidence_id: 'O1', quoted_text: 'invented' }] },
  ] };
  const out = checkV2(llm, tidy);
  assert.equal(out.people.length, 1);
  assert.equal(out.people[0]!.evidence.length, 1);
  assert.ok(out.rejected.some((r) => r.list === 'people'));
  assert.ok(out.rejected.some((r) => r.list === 'people (quotes only)'));
  const judge: any = { ...out, conclusive_findings: [], contradictions: [], suggestions: [], take_note: [] };
  assert.equal(applyRecheckV2(judge, { reviews: [] }, tidy).lists.people.length, 1);
});

const s2: any = { input: { company: 'Acme Bhd', country: 'Malaysia', industry: 'Solar' }, baseline: {}, conclusive_findings: [], contradictions: [], take_note: [], suggestions: [], could_not_check: [],
  people: [{ id: 'p1', name: 'GAN ZHI HONG', role: 'Director', contact: '011-2100 0099', how_linked: '', evidence: [{ evidence_id: 'O1', quoted_text: 'x', source_url: 'https://acme.example/about', party: 'first' }] }] };
const report: any = { status: 'ok', language: 'en', summary: [], titles: {}, proof: null };

test('preview page: the people section lists everyone, half hidden, with the owner\'s heading', () => {
  const html = reportPage(report, s2, { now: new Date('2026-11-11T00:00:00Z') });
  assert.match(html, /All people and contacts associated with your brand directly\./);
  assert.match(html, /Do you know all of them\? Are they all legit\?/);
  assert.match(html, /G\?\? Z\?\? HON\?/);
  assert.match(html, /011\?\?\?\?\?\?99/);
  assert.doesNotMatch(html, /GAN ZHI HONG|2100 0099/);
  const none = reportPage(report, { ...s2, people: undefined, could_not_check: [{ target: 'People and contacts (Step 1.6)', reason: 'people step: did not run for this report' }] }, { now: new Date('2026-11-11T00:00:00Z') });
  assert.match(none, /The people search did not complete for this preview/);
});
