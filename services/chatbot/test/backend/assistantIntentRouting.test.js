const test = require('node:test');
const assert = require('node:assert/strict');
const { planContext } = require('../../../ai/backend/services/aiContextOrchestrator.service');
const contracts = require('../../../knowledge/backend/services/knowledgeContracts.service');
const engine = require('../../../knowledge/backend/services/knowledgeContextEngine.service');
const catalog = require('../../../knowledge/backend/services/knowledgeProductCatalog.service');

for (const question of [
  'How do I create a Gherkin Test Case?',
  'How do I configure my Sprint Automator?',
  'Show me how to create a test case in our project',
  'Where can I view failed runs?',
  'How does For Each work?',
  'Explain the MCP server',
  'What is a Test Case?',
  'What are workflows?',
  'Guide me through Sprint Automator',
  'What features does the chatbot have?'
]) test(`usage intent retrieves a Product guide: ${question}`, () => {
  const route = planContext({ prompt: question });
  assert.equal(route.query_category, 'tool_help');
  assert.deepEqual(route.live_scopes, []);
  assert.deepEqual(route.indexed_source_kinds, ['product_help']);
  assert.ok(route.outcome_sections.includes('ordered usage steps'));
});

test('a standalone usage question starts a product guide after an earlier project analysis', () => {
  const route = planContext({ prompt: 'Where can I view failed runs?', history: [{ role: 'user', content: 'Summarize our current sprint' }] });
  assert.equal(route.query_category, 'tool_help');
  assert.equal(route.conversation_reference_used, false);
  assert.deepEqual(route.live_scopes, []);
  const followUp = planContext({ prompt: 'Which of those failed?', history: [{ role: 'user', content: 'Show current Test Runs' }] });
  assert.equal(followUp.conversation_reference_used, true);
  assert.ok(followUp.live_scopes.includes('runs'));
});

for (const [question, category, scope] of [
  ['Which Defects are open in the current project?', 'project_facts', 'bugs'],
  ['Summarize our current sprint', 'project_analysis', 'stories'],
  ['Give me project quality insights', 'project_analysis', 'runs'],
  ['What is the release approval requirement?', 'project_knowledge', 'stories'],
  ['How do I improve the failed Runs in my project?', 'mixed', 'runs'],
  ['How do I create a run, and which tests failed today?', 'mixed', 'runs'],
  ['Where is STORY-123?', 'mixed', 'stories']
]) test(`project intent retrieves current evidence: ${question}`, () => {
  const route = planContext({ prompt: question });
  assert.equal(route.query_category, category);
  assert.ok(route.live_scopes.includes(scope));
});

test('product guides cannot be widened into project reads by model planning or default scope selection', async () => {
  const searches = [];
  const dependencies = {
    planContext,
    search: async input => { searches.push(input); return { results: [], errors: [] }; },
    liveEvidence: async () => assert.fail('Product usage does not require current project records'),
    merge: () => [], assess: () => ({ requires_more_context: false }),
    authorize: async hits => ({ allowed: hits, denied_ids: [], partial: false })
  };
  for (const filters of [{}, { requested_scopes: ['stories', 'test-cases', 'runs', 'knowledge'] }]) {
    const result = await engine.retrieve({
      request: contracts.buildRetrievalRequest({ projectId: 'project', query: 'How do I configure my Sprint Automator?', filters, budgets: { max_rounds: 1 } }),
      user: { id: 'user' },
      intentPlan: { source_kinds: ['requirement', 'execution', 'bug'], queries: ['Sprint Automator setup'], information_needs: ['Product workflow'] },
      dependencies
    });
    assert.equal(result.route.query_category, 'tool_help');
    assert.deepEqual(result.route.live_scopes, []);
    assert.deepEqual(result.route.indexed_source_kinds, ['product_help']);
  }
  assert.equal(searches.length, 2);
  assert.ok(searches.every(input => input.filters.source_kinds.join() === 'product_help'));
});

test('explicit source domains cannot be bypassed by a product guidance route', async () => {
  const result = await engine.retrieve({
    request: contracts.buildRetrievalRequest({ projectId: 'project', query: 'How do I create a run?', filters: { requested_scopes: ['runs'] }, budgets: { max_rounds: 1 } }),
    user: { id: 'user' }, dependencies: {
      planContext, search: async () => assert.fail('Knowledge domain was not selected'),
      liveEvidence: async () => assert.fail('A usage question does not read run records'),
      merge: () => [], assess: () => ({ requires_more_context: false }), authorize: async hits => ({ allowed: hits, denied_ids: [] })
    }
  });
  assert.equal(result.hits.length, 0);
});

for (const [question, id] of [
  ['How do I configure Sprint Automator?', 'sprint-automator'],
  ['How does For Each loop Continue and Done work?', 'workflows-foreach'],
  ['How do I enable MCP server tools?', 'mcp-servers'],
  ['How do I visualize the Knowledge Graph and Context Graph?', 'knowledge-context-graphs']
]) test(`product catalog supplies feature-specific evidence: ${id}`, () => {
  assert.equal(catalog.rankProductHelpSections(question)[0].id, id);
});
