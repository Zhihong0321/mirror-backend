import test from 'node:test';
import assert from 'node:assert/strict';
import { page } from './docs.ts';
import { document } from './openapi.ts';
import { resolveModel } from './gateway.ts';

test('served docs explain the complete search-to-research handoff', () => {
  const html = page();
  assert.match(html, /EE Business Intelligence API/);
  assert.match(html, /POST \/api\/business-search/);
  assert.match(html, /Location-only searches are valid/);
  assert.match(html, /data\.companies\[\]\.id/);
  assert.match(html, /POST \/api\/company-research/);
  assert.match(html, /\/api\/person-research/);
  assert.match(html, /person_research_run/);
  assert.match(html, /fb\.person/);
  assert.match(html, /x\.subject/);
  assert.match(html, /identical Pi, social-scout, audit, and validation flow/);
  assert.match(html, /research_run\.round01/);
  assert.match(html, /GET \/public\/reports\/:reportId/);
  assert.match(html, /Telemarketer API/);
  assert.match(html, /\/api\/telemarketer\/leads/);
  assert.match(html, /\/api\/telemarketer\/me/);
  assert.match(html, /\/openapi\.json/);
  assert.ok(!process.env.LAB_TOKEN || !html.includes(process.env.LAB_TOKEN), 'the operator token never reaches a served page');
});

test('served docs introduce the social research workers and their honesty contract', () => {
  const html = page();
  // The X worker reaches x.com only through Grok, and the page has to say so: a reader
  // who thinks this crawls X will reason wrongly about rate limits, sessions and risk.
  assert.match(html, /Social\s+research/);
  assert.match(html, /grok\.com/);
  assert.match(html, /never\s+visits\s+x\.com/);
  assert.match(html, /x\.subject/);
  assert.match(html, /x\.probe/);
  assert.match(html, /fb\.company/);
  // `cited` is the only check on a fabricated permalink. If this guidance ever falls
  // out of the page, callers start trusting urls Grok never opened.
  assert.match(html, /Read\s+<code>cited<\/code>/);
  // gated and logged_out send a human to different fixes; collapsing them is the bug.
  assert.match(html, /<code>gated<\/code>/);
  assert.match(html, /age\s+attestation/);
});

test('OpenAPI contract exposes each research workflow and resolves local references', () => {
  assert.equal(document.openapi, '3.1.0');
  assert.ok(document.paths['/api/business-search'].post);
  assert.ok(document.paths['/api/reports'].get);
  assert.ok(document.paths['/api/business-search/{reportId}'].get);
  assert.ok(document.paths['/api/company-research'].post);
  assert.ok(document.paths['/api/company-research/{reportId}'].get);
  assert.ok(document.paths['/api/person-research'].post);
  assert.ok(document.paths['/api/person-research/{reportId}'].get);
  assert.ok(document.paths['/api/contact-research'].post);
  assert.ok(document.paths['/api/contact-research/{reportId}'].get);
  assert.ok(document.paths['/public/reports/{reportId}'].get);
  assert.deepEqual(document.paths['/public/reports/{reportId}'].get.security, []);
  assert.ok(document.paths['/api/telemarketer/leads'].get);
  assert.ok(document.paths['/api/telemarketer/{uid}/leads'].get);
  assert.ok(document.paths['/api/telemarketer/leads/{id}'].get);
  assert.ok(document.paths['/api/telemarketer/leads/{id}'].patch);
  assert.ok(document.paths['/api/telemarketer/me'].get);
  assert.deepEqual(document.paths['/api/telemarketer/leads'].get.security, []);
  const searchRequest = document.components.schemas.BusinessSearchRequest;
  assert.deepEqual(searchRequest.anyOf, [
    { required: ['keyword'] }, { required: ['place'] }, { required: ['location'] },
  ]);
  assert.equal(searchRequest.required, undefined);
  const personRequest = document.components.schemas.PersonResearchRequest;
  assert.ok(personRequest.properties.mobile);
  assert.ok(personRequest.properties.mobileNumber);
  assert.match(document.paths['/api/person-research'].post.description, /identifier-assisted discovery/);
  assert.match(document.components.schemas.CompanyResearchRequest.description, /identical current VIP pipeline/);
  assert.deepEqual(resolveModel('gemini@container'), { engine: 'pi', model: 'pi', location: 'container' });
  assert.deepEqual(resolveModel('pi'), { engine: 'pi', model: 'pi', location: 'container' });
  // The removed browser engines' names still route, to Pi, so a hard-coded caller keeps working.
  for (const old of ['chatgpt', 'chatgpt:openai-main', 'gpt-4o', 'o3-mini', 'meta', 'llama-3'])
    assert.deepEqual(resolveModel(old), { engine: 'pi', model: 'pi', location: 'container' }, old);
  assert.throws(() => resolveModel('chatgpt@mini'), (e: { status?: number }) => e.status === 404);

  const root = document as unknown as Record<string, unknown>;
  const refs: string[] = [];
  const visit = (value: unknown): void => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) return value.forEach(visit);
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (key === '$ref' && typeof child === 'string') refs.push(child);
      else visit(child);
    }
  };
  visit(root);
  for (const ref of refs) {
    assert.match(ref, /^#\//);
    let current: unknown = root;
    for (const token of ref.slice(2).split('/')) current = (current as Record<string, unknown>)[token];
    assert.notEqual(current, undefined, `unresolved OpenAPI reference: ${ref}`);
  }
});

test('the re-run workflow is documented for API consumers and the guide page', () => {
  const html = page();
  // The docs route table has to name the endpoint, not just the OpenAPI path --
  // a reader scanning the table is how most callers find a route at all.
  assert.match(html, /POST \/api\/reports\/:reportId\/retry/);
  assert.match(html, /Re-queue a <code>failed<\/code> report in place/);
  assert.match(html, /409<\/code> when the report is not failed/);

  const retry = document.paths['/api/reports/{reportId}/retry'].post;
  assert.equal(retry.operationId, 'retryReport');
  assert.ok(retry.responses['202'], 'claiming a rerun answers 202');
  assert.ok(retry.responses['404']);
  // 409 is the load-bearing status: not failed, already claimed by a racing
  // caller, or the original inputs are gone. Documenting it is what stops a
  // client from treating a refusal as a transient error and looping.
  assert.ok(retry.responses['409'], 'a refused rerun answers 409');
  assert.match(retry.description ?? '', /compare-and-swap/);
  assert.match(retry.description ?? '', /never an overwrite/);
});

test('company dive is on the served docs and in the OpenAPI contract', () => {
  const html = page();
  assert.match(html, /href="#company-dive"/);
  assert.match(html, /POST<\/span><code class="path">\/api\/company-dive<\/code>/);
  assert.match(html, /\/d\/:publicId\/data/);
  assert.ok(document.paths['/api/company-dive'].post);
  assert.ok(document.paths['/api/company-dive'].get);
  assert.ok(document.paths['/api/company-dive/{diveId}'].get);
  assert.ok(document.paths['/api/company-dive/{diveId}/people'].post);
  assert.deepEqual(document.paths['/d/{publicId}/data'].get.security, []);
  assert.deepEqual(document.paths['/d/{publicId}'].get.security, []);
  assert.ok(document.components.schemas.CompanyDivePublic);
});
