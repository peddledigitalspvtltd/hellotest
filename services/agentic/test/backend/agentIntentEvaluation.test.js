const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { createRequire } = require('node:module');
const Ajv = require('ajv');
const profiles = require('../../shared/workflowSpecialists.json');
const contracts = require('../../backend/services/agentArtifacts');
const response = require('../../backend/services/agentResponseContract');
const policies = require('@hellotest/platform/shared/agentContextPolicies.json');
const features = require('@hellotest/platform/shared/aiFeatureCatalog.json');
const { planContext } = require('@hellotest/ai/backend/services/aiContextOrchestrator.service');
const validate = new Ajv({ strict: false }).compile(response.schema);
const citations = [{ id: 'evidence-1' }];
const targets = [{ id: 'case-1', kind: 'test_case', citation_id: 'evidence-1' }, { id: 'story-1', revision: 3, citation_id: 'evidence-1' }];
const base = { title: 'Checkout retry', description: 'Verify the supplied one-order retry contract.', priority: 'P2', citation_ids: ['evidence-1'], addressed_finding_ids: [] };
const drafts = {
  story: { ...base, kind: 'story', acceptance_criteria: ['Given an existing order, when checkout is retried, then one order remains.'] },
  test_case: { ...base, kind: 'test_case', test_case_type: 'functional', parameter_values: { 't.order': 'fixture-order' }, prerequisites: ['Create the approved fixture order.'], test_data: ['Use the synthetic order fixture.'], cleanup: ['Remove the fixture.'], steps: [{ action: 'Retry checkout for @t.order', expected_result: 'One order remains.' }] },
  run: { ...base, kind: 'run', test_case_ids: ['case-1'], exit_criteria: ['The selected retry case passes.'] },
  defect: { ...base, kind: 'defect', reproduction_steps: ['Retry the recorded checkout.'], expected_result: 'One order remains.', actual_result: 'The recorded result contains two orders.', severity: 'high' }
};
drafts.automation = { ...drafts.test_case, kind: 'automation', authoring_mode: 'structured', start_url: 'https://fixture.test/checkout', manual_test_case_ids: ['case-1'] };
const candidateFor = id => {
  const contract = contracts.outcomeContract(id);
  return { response: `Reviewed the supplied retry evidence for ${id}.`, findings: [], deliverables: [], artifacts: contract.mode === 'author' ? [structuredClone(drafts[contract.artifact_kinds[0]])] : [], evidence_gaps: [], citation_ids: ['evidence-1'] };
};

function requestFixture(candidate) {
  const filename = require.resolve('../../backend/services/agenticAssistant.service');
  const local = createRequire(filename), module = { exports: {} }, requests = [];
  const dependencies = {
    '@hellotest/platform/backend/services/permission.service': { hasPermission: async () => true },
    '@hellotest/platform/backend/src/utils/llmHttpClient': { fetchLlmWithRetry: async (url, init, options) => {
      await options.beforeDispatch();
      requests.push({ body: JSON.parse(init.body), options });
      return Response.json({ model: 'fixture-model', choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(candidate) } }] });
    } }
  };
  new Function('require', 'module', 'exports', fs.readFileSync(filename, 'utf8'))(id => dependencies[id] || local(id), module, module.exports);
  return { ...module.exports._internals, requests };
}

test('all 31 executable agent identities resolve a distinct feature and governed context policy', () => {
  const identities = [...Object.keys(profiles), ...require('../../backend/agents/catalog').AGENTS.map(item => item.id), ...require('../../backend/services/qualityAgentContracts').AGENTS.map(item => `browser-${item.id}`)];
  assert.deepEqual(identities.sort(), Object.keys(policies).sort());
  const featureIds = new Set();
  for (const id of identities) {
    const featureId = profiles[id] ? `ai.agentic.${id}` : id.startsWith('browser-') ? `ai.agentic.browser.${id.slice(8)}` : `ai.agentic.repository.${id}`;
    const feature = features.find(item => item.id === featureId);
    assert.ok(feature && feature.runtime_status !== 'reserved', id);
    featureIds.add(featureId);
    const route = planContext({ prompt: 'Review only the supplied checkout retry evidence.', agentId: id, mode: 'agent' });
    assert.deepEqual(new Set(route.live_scopes), new Set(policies[id].scopes.filter(scope => scope !== 'knowledge')), id);
    assert.equal(route.agent_id, id);
  }
  assert.equal(featureIds.size, identities.length);
});

for (const [id, profile] of Object.entries(profiles)) test(`${id}: actual request retains exact intent, native output and one bounded provider dispatch`, async () => {
  const candidate = candidateFor(id), fixture = requestFixture(candidate);
  assert.equal(validate(candidate), true, JSON.stringify(validate.errors));
  const prompt = 'Review only checkout retry behavior; preserve हिन्दी and the final obligation. Do not add sign-in coverage.';
  const budget = { used: 0, max: 1 };
  const agent = { name: profile.name, objective: profile.description, configurationKey: `ai.agentic.${id}`, acceptance: { require_evidence: true }, limits: { max_output_tokens: 4096 } };
  const route = planContext({ prompt, agentId: id, mode: 'agent' });
  const output = await fixture.requestLlmResult({ user: { id: 'actor' }, projectId: 'project', integration: { model: 'fixture-model', base_url: 'https://model.invalid' }, agent, mode: 'agent', prompt,
    context: { workflow_input: [{ id: 'evidence-1', content: JSON.stringify({ final_obligation: 'One order remains after retry.' }), citation: citations[0] }] }, citations, history: [], contextRoute: route, budget });
  assert.equal(fixture.requests.length, 1);
  assert.equal(budget.used, 1);
  const request = fixture.requests[0], task = JSON.parse(request.body.messages.at(-1).content);
  assert.equal(task.request, prompt);
  assert.equal(task.context_route.agent_id, id);
  assert.ok(request.body.messages[0].content.includes(JSON.stringify(response.schema)));
  assert.equal(request.options.featureKey, `ai.agentic.${id}`);
  assert.equal(request.options.maxAttempts, 1);
  assert.equal(request.options.contextFallback, false);
  assert.equal(request.options.mcpContextHandled.evidence_count, 0);
  assert.equal(output.response, candidate.response);
  const fallback = { evaluation: { grounding: 0, completeness: 0, traceability: 0, risk_control: 0, maturity_score: 0 } };
  const normalized = fixture.normalizeResult(output, fallback, citations, { requireMetadata: true, artifactTargets: targets });
  assert.notEqual(normalized, fallback);
  assert.deepEqual(contracts.outcomeIssues(normalized, contracts.outcomeContract(id)), []);
  assert.equal(fixture.normalizeResult({ ...candidate, citation_ids: ['invented-source'] }, fallback, citations), fallback);
});

test('advertised native schemas include every supported artifact field and reject incomplete authoring', () => {
  const properties = response.schema.properties.artifacts.items.properties;
  for (const draft of Object.values(drafts)) {
    for (const key of Object.keys(draft)) assert.ok(Object.hasOwn(properties, key), `${draft.kind}.${key} is absent from the model contract`);
    for (const key of { story: ['acceptance_criteria'], test_case: ['steps', 'test_case_type', 'parameter_values'], automation: ['start_url', 'steps'], defect: ['actual_result', 'reproduction_steps', 'severity'], run: ['test_case_ids', 'exit_criteria'] }[draft.kind]) {
      const missing = structuredClone(draft); delete missing[key];
      assert.equal(validate({ ...candidateFor('quality-orchestrator'), artifacts: [missing] }), false, `${draft.kind}.${key}`);
    }
  }
  for (const patch of [{requirement_ids:Array(17).fill('story-1')},{addressed_finding_ids:Array(21).fill('finding-1')}]) assert.equal(validate({ ...candidateFor('test-designer'), artifacts: [{ ...drafts.test_case, ...patch }] }), false);
  const gherkin = { ...drafts.test_case, authoring_mode: 'gherkin', gherkin_document: 'Feature: Checkout\nScenario: Retry\n Given an order\n When checkout is retried\n Then one order remains', steps: [] };
  assert.equal(validate({ ...candidateFor('test-designer'), artifacts: [gherkin] }), true, JSON.stringify(validate.errors));
  assert.equal(contracts.normalizeArtifacts([gherkin], citations, targets, { requireMetadata: true })[0].gherkin_document, gherkin.gherkin_document);
  for (const document of [
    'Feature: Checkout\nScenario: Missing action\n Given an order\n Then one order remains',
    gherkin.gherkin_document + '\nScenario: Incomplete second scenario\n When checkout is retried',
    'Feature: Checkout\nScenario: Reversed outcome\n Then one order remains\n When checkout is retried'
  ]) assert.throws(() => contracts.normalizeArtifacts([{ ...gherkin, gherkin_document: document }], citations, targets, { requireMetadata: true }), error => error.code === 'AI_INVALID_RESPONSE' && error.validation_path === 'artifacts[0].gherkin_document');
});

test('model-visible report and typed repair schemas match native display and patch contracts', () => {
  const report = { ...candidateFor('risk-prediction'), sections: [{ title: 'Observed risk', body: 'Only the recorded retry is assessed.', citation_ids: ['evidence-1'] }], tables: [{ title: 'Recorded results', columns: ['Case', 'Count'], rows: [['Retry', '2']], citation_ids: ['evidence-1'] }], charts: [{ title: 'Recorded count', type: 'bar', unit: 'orders', series: [{ label: 'Retry', value: 2 }], citation_ids: ['evidence-1'] }] };
  assert.equal(validate(report), true, JSON.stringify(validate.errors));
  assert.deepEqual(require('../../backend/services/agentOutcomePresentation').presentationIssues(report, citations), []);
  for (const automation_repair of [null, { kind: 'replace_locator', step_id: 'step-1', new_locator: '#observed', rationale: 'The current authorized observation identifies this selector.' }, { kind: 'replace_instructions', step_id: 'step-1', automation_code: 'await web.click("#observed");', rationale: 'Retains every saved action and assertion in the section.' }]) assert.equal(validate({ ...report, automation_repair }), true, JSON.stringify(validate.errors));
  assert.equal(validate({ ...report, automation_repair: { kind: 'run_script', command: 'unavailable' } }), false);
});

test.after(() => require('@hellotest/platform/backend/src/db').close());
