const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const { createRequire } = require('node:module');
const { sourceFile } = require('./helpers/sourceFile');

const appType = { id: 'billing-web', project_id: 'billing', name: 'Billing Web', type: 'web' };
const story = { id: 'invoice-approval', project_id: 'billing', title: 'Approve submitted invoices',
  description: 'A reviewer approves a submitted invoice and sees its approved status.',
  additional_fields: { acceptance_criteria: ['Approval records the reviewer and changes the status to approved.'] },
  specification_content: 'Only submitted invoices can be approved.', revision: 4 };
const draft = () => ({ title: 'Approve a submitted invoice', description: 'Use a supplied submitted invoice and confirm the final approval status.',
  priority: 2, test_case_type: 'functional', parameter_values: { reviewer_email: 'reviewer@example.test', invoice_id: '@s.submitted_invoice_id' }, requirement_refs: ['R1'],
  steps: [{ step_order: 1, step_type: 'web', action: 'Open the supplied invoice @t.invoice_id as reviewer @t.reviewer_email', expected_result: 'The submitted invoice is displayed.' },
    { step_order: 2, step_type: 'web', action: 'Approve the displayed invoice', expected_result: 'The invoice status is approved and the approving reviewer is recorded.' }] });

function load(name, overrides = {}, expose = '') {
  const filename = sourceFile(`${name}.js`, 'services');
  const localRequire = createRequire(filename), module = { exports: {} };
  new Function('require', 'module', 'exports', fs.readFileSync(filename, 'utf8') + expose)(id => {
    const key = Object.keys(overrides).find(candidate => candidate.split('/').pop() === id.split('/').pop());
    return key === undefined ? localRequire(id) : overrides[key];
  }, module, module.exports);
  return module.exports;
}

function fixture(output, extra = {}) {
  const calls = [], writes = [];
  const overrides = {
    './dropdownCatalog.service': { getField: async () => ({ default_value: 'functional', options: [{ value: 'functional', active: true }] }) },
    './aiLlmSelection.service': { resolveLlmIntegrationForUsage: async () => ({ id: 'model', type: 'llm', is_active: true, model: 'test-model', base_url: 'https://model.invalid/v1' }) },
    './aiKnowledge.service': { buildKnowledgeContextPackage: async () => ({ knowledge: [] }) },
    './testCase.service': { createTestCase: async input => { writes.push(input); return { id: `case-${writes.length}` }; } },
    '../utils/llmHttpClient': { fetchLlmWithRetry: async (_url, init, options) => {
      const content = options.featureKey === 'ai.authoring.request_validation'
        ? { decision: 'accept', explanation: 'The request is within the selected authoring intent.', suggestions: [] }
        : output;
      if (options.featureKey !== 'ai.authoring.request_validation') calls.push(JSON.parse(init.body));
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }] }), { headers: { 'content-type': 'application/json' } });
    } }, ...extra
  };
  return { calls, writes, overrides };
}

for (const operation of ['generate', 'improve']) {
  test(`${operation} requires complete model fields without reusing existing draft content`, async () => {
    for (const missing of ['title', 'description', 'parameter_values']) {
      const incomplete = draft(); delete incomplete[missing];
      const current = fixture(operation === 'generate' ? { testCases: [incomplete] } : incomplete);
      const service = load(operation === 'generate' ? 'requirementDesign.service' : 'aiCaseAuthoring.service', current.overrides);
      const input = { appType, requirement: story, requirements: [story], test_case: draft(), max_cases: 1 };
      await assert.rejects(operation === 'generate' ? service.previewRequirementsTestCases(input) : service.previewCaseAuthoring(input), error => {
        assert.equal(error.code, 'AI_NATIVE_CONTRACT_INVALID');
        assert.ok(error.validation_errors.some(item => item.field === missing));
        return true;
      });
      assert.equal(current.calls.length, 1);
      assert.deepEqual(current.writes, []);
    }
  });

  test(`${operation} requires each step's result and every referenced case parameter`, async () => {
    for (const output of [
      { ...draft(), steps: [{ action: 'Approve the invoice', expected_result: '' }] },
      { ...draft(), parameter_values: {} },
      { ...draft(), parameter_values: { reviewer_email: '@t.email', email: '@t.reviewer_email', invoice_id: '@s.submitted_invoice_id' } }
    ]) {
      const current = fixture(operation === 'generate' ? { testCases: [output] } : output);
      const service = load(operation === 'generate' ? 'requirementDesign.service' : 'aiCaseAuthoring.service', current.overrides);
      const input = { appType, requirement: story, requirements: [story], test_case: draft(), max_cases: 1 };
      await assert.rejects(operation === 'generate' ? service.previewRequirementsTestCases(input) : service.previewCaseAuthoring(input), { code: 'AI_NATIVE_CONTRACT_INVALID' });
      assert.deepEqual(current.writes, []);
    }
  });

  test(`${operation} sends the current linked Story body and retains concrete synthetic data and private dependencies`, async () => {
    const output = draft(), current = fixture(operation === 'generate' ? { testCases: [output] } : output);
    const service = load(operation === 'generate' ? 'requirementDesign.service' : 'aiCaseAuthoring.service', current.overrides);
    const input = { appType, requirement: story, requirements: [story], test_case: output, max_cases: 1, additional_context: 'Keep the approved-status assertion and supplied data references.' };
    const result = operation === 'generate' ? await service.previewRequirementsTestCases(input) : await service.previewCaseAuthoring(input);
    const prompt = JSON.parse(current.calls[0].messages[1].content), selected = operation === 'generate' ? prompt.stories[0] : prompt.story;
    assert.equal(selected.id, story.id);
    assert.equal(selected.title, story.title);
    assert.equal(selected.description, story.description);
    assert.deepEqual(selected.acceptance_criteria, story.additional_fields.acceptance_criteria);
    assert.match(prompt.generation_request.user_request, /supplied data references/);
    const proposed = operation === 'generate' ? result.cases[0] : result.case;
    assert.deepEqual(proposed.parameter_values, output.parameter_values);
    assert.deepEqual(proposed.steps.map(step => step.expected_result), output.steps.map(step => step.expected_result));
    if (operation === 'generate') assert.deepEqual(proposed.requirement_ids, [story.id]);
  });
}

test('selected Gherkin output is never synthesized from an omitted model document', async () => {
  const current = fixture({ testCases: [draft()] }), service = load('requirementDesign.service', current.overrides);
  await assert.rejects(service.previewRequirementsTestCases({ appType, requirements: [story], max_cases: 1, authoring_mode: 'gherkin' }), /Feature.*Scenario/);
  assert.deepEqual(current.writes, []);
});

test('Library acceptance validates every edited draft and exact Story identity before any writes', async () => {
  for (const invalid of [
    { ...draft(), description: '' },
    { ...draft(), parameter_values: {} },
    { ...draft(), steps: [{ action: 'Approve', expected_result: '' }] },
    { ...draft(), requirement_ids: ['foreign-story'] },
    { ...draft(), requirement_ids: [story.id], requirement_refs: ['R99'] },
    { ...draft(), requirement_refs: ['R99'] }
  ]) {
    const current = fixture(null), service = load('requirementDesign.service', current.overrides);
    await assert.rejects(service.acceptGeneratedTestCases({ appType, requirements: [story], cases: [draft(), invalid], created_by: 'author' }), { code: 'AI_NATIVE_CONTRACT_INVALID' });
    assert.deepEqual(current.writes, []);
  }
});

test('Story project scope is checked before provider calls or Library writes', async () => {
  const foreignStory = { ...story, project_id: 'another-project' };
  for (const mode of ['generate', 'improve', 'accept']) {
    const current = fixture(mode === 'generate' ? { testCases: [draft()] } : draft());
    const service = load(mode === 'improve' ? 'aiCaseAuthoring.service' : 'requirementDesign.service', current.overrides);
    const input = { appType, requirements: [foreignStory], requirement: foreignStory, test_case: draft(), cases: [draft()] };
    await assert.rejects(mode === 'improve' ? service.previewCaseAuthoring(input) : mode === 'accept' ? service.acceptGeneratedTestCases(input) : service.previewRequirementsTestCases(input), { code: 'AI_STORY_SCOPE_INVALID', statusCode: 403 });
    assert.deepEqual(current.calls, []);
    assert.deepEqual(current.writes, []);
  }
});

test('generation without a selected Story rejects invented traceability instead of silently discarding it', async () => {
  const current = fixture({ testCases: [draft()] }), service = load('requirementDesign.service', current.overrides);
  await assert.rejects(service.previewRequirementsTestCases({ appType, requirements: [], max_cases: 1, additional_context: 'Create invoice approval coverage from the supplied invoice behavior.' }), { code: 'AI_NATIVE_CONTRACT_INVALID' });
  assert.deepEqual(current.writes, []);
});

test('step improvement cannot mask a missing model action or result with the existing step', async () => {
  for (const output of [{ action: 'Approve the invoice' }, { expected_result: 'The invoice is approved.' }]) {
    const current = fixture(output), service = load('aiCaseAuthoring.service', current.overrides);
    await assert.rejects(service.rephraseTestStep({ appType, requirement: story, test_case: draft(), step: draft().steps[0] }), { code: 'AI_NATIVE_CONTRACT_INVALID' });
    assert.equal(current.calls.length, 1);
  }
});

test('selected-step improvement uses the same private-data projection as the surrounding case', async () => {
  const current = fixture({ action: 'Fill @t.password in the password field', expected_result: 'The supplied credential is entered.' });
  const service = load('aiCaseAuthoring.service', current.overrides);
  const privateValue = 'PRIVATE_CREDENTIAL_SENTINEL';
  await service.rephraseTestStep({ appType, requirement: story,
    test_case: { ...draft(), parameter_values: { password: privateValue }, test_data_options: { private_parameter_names: ['t.password'] } },
    step: { action: `Fill ${privateValue} in the password field`, expected_result: 'The supplied credential is entered.' } });
  const prompt = JSON.stringify(current.calls[0]);
  assert.doesNotMatch(prompt, /PRIVATE_CREDENTIAL_SENTINEL/);
  assert.match(prompt, /@t.password/);
});

test('scheduled generation loads full current Story evidence and preserves the selected Story link', async () => {
  const queries = [], previews = [], writes = [];
  const database = { transaction: fn => fn, prepare: sql => {
    queries.push(sql);
    return /FROM requirements\s+WHERE id/.test(sql) ? { get: async id => id === story.id ? story : { ...story, project_id: 'foreign-project' } } : {};
  } };
  const service = load('aiTestCaseGeneration.service', {
    '../db': database,
    './requirementDesign.service': { previewRequirementTestCases: async input => { previews.push(input); return { cases: [{ ...draft(), requirement_ids: [story.id] }] }; } },
    './testCase.service': { createTestCase: async input => { writes.push(input); return { id: 'generated' }; } },
    './workspaceTransaction.service': {}
  }, '\nmodule.exports.verifyScheduled = { resolveScopedRequirements, generateCasesForRequirement };');
  const [selected] = await service.verifyScheduled.resolveScopedRequirements([story.id], appType.project_id);
  await service.verifyScheduled.generateCasesForRequirement({ job: { id: 'job', created_by: 'author', max_cases_per_requirement: 1 }, requirement: selected, appType });
  const projection = queries.find(sql => /FROM requirements/.test(sql));
  for (const column of ['title', 'description', 'additional_fields', 'specification_content', 'gherkin_scenarios', 'external_references', 'revision']) assert.match(projection, new RegExp(`\\b${column}\\b`));
  assert.equal(previews[0].requirement.title, story.title);
  assert.equal(previews[0].requirement.description, story.description);
  assert.deepEqual(previews[0].requirement.additional_fields.acceptance_criteria, story.additional_fields.acceptance_criteria);
  assert.deepEqual(writes[0].requirement_ids, [story.id]);
  await assert.rejects(service.verifyScheduled.resolveScopedRequirements(['foreign-story'], appType.project_id), /same project/);
  assert.equal(previews.length, 1, 'Foreign Story data never reaches the model');
});
