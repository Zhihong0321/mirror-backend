import test from 'node:test';
import assert from 'node:assert/strict';
import { page } from './portal.ts';
import * as db from './reportdb.ts';

test('telemarketer management UI is integrated in portal navigation, views and scripts', () => {
  const html = page();

  // Navigation
  assert.match(html, />Telemarketers<\/button>/);
  assert.match(html, /data-view="agents"/);
  assert.match(html, /switchView\('agents'\)/);
  assert.match(html, /<button class="mobile-tab" data-view="agents"/);

  // View container & hero
  assert.match(html, /id="agentsView"/);
  assert.match(html, /Manage Telemarketers/);
  assert.match(html, /Register telemarketer agents/);

  // Metric counters
  assert.match(html, /id="agentsTotalCount"/);
  assert.match(html, /id="agentsActiveCount"/);
  assert.match(html, /id="agentsTotalLeadsCount"/);
  assert.match(html, /id="agentsContactedCount"/);

  // Creation & edit form sheet
  assert.match(html, /id="agentFormSheet"/);
  assert.match(html, /id="agentFormTitle"/);
  assert.match(html, /id="agentFormName"/);
  assert.match(html, /id="agentFormPhone"/);
  assert.match(html, /id="agentFormEmail"/);
  assert.match(html, /id="agentFormStatus"/);
  assert.match(html, /id="agentFormNotes"/);
  assert.match(html, /id="agentFormSubmitBtn"/);

  // Agent cards container
  assert.match(html, /id="agentsContainer"/);

  // Client-side JavaScript methods
  assert.match(html, /function loadAgentsView\(\)/);
  assert.match(html, /function renderAgentsSummary\(/);
  assert.match(html, /function filterAgents\(\)/);
  assert.match(html, /function renderAgents\(\)/);
  assert.match(html, /function viewAgentLeads\(/);
  assert.match(html, /function toggleCreateAgentForm\(/);
  assert.match(html, /function editAgent\(/);
  assert.match(html, /function saveAgentForm\(/);
  assert.match(html, /function toggleAgentActive\(/);
  assert.match(html, /function deleteAgentPrompt\(/);
  // Atap Solar roster import
  assert.match(html, /id="importAgentsBtn"/);
  assert.match(html, /function importAgentsFromAtap\(/);
  assert.match(html, /\/api\/telemarketers\/import/);
  // Access-tag filter
  assert.match(html, /id="agentRoleFilter"/);
  assert.match(html, /function agentRoleTags\(/);
  assert.match(html, /function renderAgentRoleFilter\(/);

  // Script compiles with zero syntax errors
  const script = /<script>([\s\S]*)<\/script>/.exec(html)?.[1];
  assert.ok(script);
  assert.doesNotThrow(() => new Function(script));
});

test('reportdb exports telemarketer agent management interfaces', () => {
  assert.equal(typeof db.listTelemarketers, 'function');
  assert.equal(typeof db.getTelemarketerDetails, 'function');
  assert.equal(typeof db.addTelemarketer, 'function');
  assert.equal(typeof db.updateTelemarketer, 'function');
  assert.equal(typeof db.deleteTelemarketer, 'function');
});
