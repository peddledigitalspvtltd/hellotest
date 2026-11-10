const test = require('node:test');
const assert = require('node:assert/strict');
const generator = require('../../backend/workflows/testDataGenerator');
const automationInputs = require('../../backend/workflows/automationNodeInputs');
const dataSets = require('@hellotest/testing/backend/services/testDataSet.service');
const synthetic = require('@hellotest/ai/backend/services/aiTestDataGeneration.service');

const story = { id: 'story-1', title: 'Create an employee' };
const packet = { story_id: story.id, story_revision: 7 };
const run = (nodes = []) => ({ project_id: 'project-1', app_type_id: 'app-1', input_payload: {}, workflow_snapshot: { nodes } });

test('dataset mode maps case parameters by name without exposing dataset values', async t => {
  t.mock.method(dataSets, 'getTestDataSet', async id => ({ id, project_id: 'project-1', app_type_id: 'app-1', name: 'HR fixtures', mode: 'table',
    rows: [{ username: 'fictional-user', password: 'private-secret', department: 'Mumbai Engineering Center' }] }));
  const accessCalls = [];
  const draft = { client_id: 'case-1', title: 'Employee onboarding', parameter_values: {}, steps: [
    { action: 'Enter @t.username and @t.password', expected_result: 'The employee workspace is shown.' },
    { action: 'Select @t.department', expected_result: 'The department is selected.' },
  ] };
  const result = await generator.prepareCase({ run: run(), node: { data: { testDataSource: 'dataset', testDataSetId: 'data-1' } },
    user: { id: 'actor-1' }, access: async (...args) => accessCalls.push(args), story, packet, draft, caseIndex: 0, steps: draft.steps });
  assert.deepEqual(accessCalls, [[{ id: 'actor-1' }, 'project-1', ['data.view']]]);
  assert.equal(result.status, 'ready');
  assert.equal(result.test_data_set_id, 'data-1');
  assert.deepEqual(result.private_parameter_names.sort(), ['r.department', 'r.password', 'r.username']);
  assert.deepEqual(result.parameter_values, {});
  assert.deepEqual(result.parameter_bindings, { 't.department': 'r.department', 't.password': 'r.password', 't.username': 'r.username' });
  assert.equal(JSON.stringify(result).includes('private-secret'), false);
  assert.equal(JSON.stringify(result).includes('fictional-user'), false);
  const automationDraft = generator.automationDraftWithData(draft, result);
  assert.deepEqual(automationDraft.test_data_set_ids, ['data-1']);
  assert.equal(automationDraft.parameter_values['t.password'], undefined);
  assert.match(automationDraft.steps[0].action, /@r.username and @r.password/);
  assert.deepEqual(automationDraft.test_data_options.private_parameter_names, result.private_parameter_names);
});

test('synthetic mode uses deterministic safe fallback when the generator is unavailable', async t => {
  const prompts=[];
  t.mock.method(synthetic, 'preview', async input => { prompts.push(input); throw new Error('provider unavailable'); });
  const draft = { client_id: 'case-2', title: 'Add a department', parameter_values: {}, steps: [
    { action: 'Enter @t.department_name', expected_result: 'The department is saved.' },
  ] };
  const result = await generator.prepareCase({ run: run(), node: { data: { testDataSource: 'synthetic' } }, user: { id: 'actor-1' },
    access: async () => {}, story, packet, draft, caseIndex: 0, steps: draft.steps });
  assert.equal(result.status, 'ready');
  assert.equal(result.parameter_sources['t.department_name'].source, 'deterministic_fallback');
  assert.equal(synthetic._internals.isSafeSyntheticValue(result.parameter_values['t.department_name']), true);
  assert.equal(result.deterministic_fallbacks.length, 1);
  assert.match(prompts[0].promptInstruction,/Workspace specialist skill:/);
  assert.match(prompts[0].promptInstruction,/never generate passwords, tokens or secrets/i);
});

test('synthetic generation never invents authentication credentials', async t => {
  let calls = 0;
  t.mock.method(synthetic, 'preview', async () => { calls++; return { suggestions: [{ value: 'invented-password' }] }; });
  const draft = { client_id: 'case-3', title: 'Sign in', parameter_values: {}, steps: [
    { action: 'Enter @t.username and @t.password, then sign in', expected_result: 'The dashboard is displayed.' },
  ] };
  const result = await generator.prepareCase({ run: run(), node: { data: { testDataSource: 'synthetic' } }, user: { id: 'actor-1' },
    access: async () => {}, story, packet, draft, caseIndex: 0, steps: draft.steps });
  assert.equal(calls, 0);
  assert.equal(result.status, 'needs_input');
  assert.deepEqual(result.missing_parameters.sort(), ['t.password', 't.username']);
  assert.equal(JSON.stringify(result).includes('invented-password'), false);
});

test('Automation Engineer takes a unique safe application URL from the pinned Story when no URL was configured', () => {
  assert.equal(automationInputs.storyStartUrl({ description: '<p>Use https://hr.example.test/client/ for this flow.</p>' }),
    'https://hr.example.test/client/');
  assert.equal(automationInputs.storyStartUrl({ description: 'Use https://one.example.test and https://two.example.test.' }), null);
  assert.equal(automationInputs.storyStartUrl({ description: 'Use https://user:password@hr.example.test/' }), null);
});

test('dataset readiness checks every runtime row and does not accept a missing marker as configured data', async t => {
  t.mock.method(dataSets, 'getTestDataSet', async id => ({ id, project_id: 'project-1', name: 'Incomplete fixtures', mode: 'table',
    rows: [{ department: 'Operations' }, { other: 'Missing department column' }] }));
  const draft = { client_id: 'case-incomplete', title: 'Choose a department', parameter_values: { 't.department': '[missing: department fixture]' },
    steps: [{ action: 'Choose @t.department', expected_result: 'The configured department is selected.' }] };
  const result = await generator.prepareCase({ run: run(), node: { data: { testDataSource: 'dataset', testDataSetId: 'data-1' } },
    user: { id: 'actor-1' }, access: async () => {}, story, packet, draft, steps: draft.steps });
  assert.equal(result.status, 'needs_input');
  assert.deepEqual(result.missing_parameters, ['t.department']);
  assert.equal(result.dataset_row_count, 2);
  assert.deepEqual(result.parameter_values, {});
});

test('synthetic preparation preserves authored empty values and reports placeholder credentials as missing', async t => {
  const model = t.mock.method(synthetic, 'preview', async () => { throw new Error('Auth and authored empty values must not be generated.'); });
  const draft = { client_id: 'negative-sign-in', title: 'Sign in with an empty username', parameter_values: { 't.username': '', 't.password': '[missing: reviewed password]' },
    steps: [{ action: 'Sign in using @t.username and @t.password', expected_result: 'The username is required.' }] };
  const result = await generator.prepareCase({ run: run(), node: { data: { testDataSource: 'synthetic' } }, user: { id: 'actor-1' },
    access: async () => {}, story, packet, draft, steps: draft.steps });
  assert.equal(model.mock.callCount(), 0);
  assert.equal(result.status, 'needs_input');
  assert.deepEqual(result.missing_parameters, ['t.password']);
  assert.deepEqual(result.parameter_values, {});
});

test('data preparation uses only connected Automation Engineer environment bindings', async t => {
  const environment = require('@hellotest/testing/backend/services/testEnvironment.service');
  t.mock.method(environment, 'getTestEnvironment', async id => { assert.equal(id, 'connected-env'); return { id, project_id: 'project-1', app_type_id: 'app-1',
    variables: [{ key: 'username', value: 'reviewed-user' }, { key: 'password', value: '', is_secret: true, has_stored_value: true }] }; });
  const model = t.mock.method(synthetic, 'preview', async () => { throw new Error('Selected environment credentials must remain protected references.'); });
  const dataNode = { id: 'data', data: { testDataSource: 'synthetic' } };
  const definition = run([{ id: 'unrelated', data: { kind: 'artifactTask', artifactTask: 'automation-engineer', testEnvironmentId: 'unrelated-env' } },
    { id: 'connected', data: { kind: 'artifactTask', artifactTask: 'automation-engineer', testEnvironmentId: 'connected-env' } }]);
  definition.workflow_snapshot.edges = [{ source: 'data', target: 'connected' }, { source: 'connected', target: 'loop', targetHandle: 'continue' }];
  const draft = { client_id: 'login', title: 'Sign in', parameter_values: { 't.username': '[missing: username]', 't.password': '[missing: password]' },
    steps: [{ action: 'Sign in using @t.username and @t.password', expected_result: 'The dashboard is shown.' }] };
  const result = await generator.prepareCase({ run: definition, node: dataNode, user: { id: 'actor-1' }, access: async () => {}, story, packet, draft, steps: draft.steps });
  assert.equal(model.mock.callCount(), 0);
  assert.equal(result.status, 'ready');
  assert.deepEqual(result.parameter_sources['t.password'], { source: 'automation_node' });
  assert.equal(JSON.stringify(result).includes('reviewed-user'), false);
});

test('synthetic preparation shares a bounded model-call budget and labels fallback values', async t => {
  const model = t.mock.method(synthetic, 'preview', async () => ({ suggestions: [{ value: 'Fictional department' }] }));
  const draft = { client_id: 'many-inputs', title: 'Create a department', parameter_values: {},
    steps: [{ action: 'Enter @t.department_a, @t.department_b, @t.department_c and @t.department_d', expected_result: 'The form is saved.' }] };
  const result = await generator.prepareCase({ run: run(), node: { data: { testDataSource: 'synthetic', aiConfiguration: { agent_execution: { max_model_calls: 2 } } } },
    user: { id: 'actor-1' }, access: async () => {}, story, packet, draft, steps: draft.steps });
  assert.equal(model.mock.callCount(), 2);
  assert.equal(result.model_calls_attempted, 2);
  assert.equal(result.deterministic_fallbacks.length, 2);
  assert.ok(result.deterministic_fallbacks.every(item => /budget/.test(item.reason)));
  assert.equal(Object.keys(result.parameter_values).length, 4);
});

test('cancelled or denied data generation cannot become fallback success or dispatch later parameters', async t => {
  const controller = new AbortController();
  const model = t.mock.method(synthetic, 'preview', async input => { assert.equal(input.signal, controller.signal); controller.abort(); return { suggestions: [{ value: 'Late value' }] }; });
  const draft = { client_id: 'cancel', title: 'Create a department', parameter_values: {},
    steps: [{ action: 'Enter @t.department_a and @t.department_b', expected_result: 'The form is saved.' }] };
  const input = { run: run(), node: { data: { testDataSource: 'synthetic' } }, user: { id: 'actor-1' }, access: async () => {}, story, packet, draft, steps: draft.steps };
  await assert.rejects(generator.prepareCase({ ...input, signal: controller.signal }), { statusCode: 499 });
  assert.equal(model.mock.callCount(), 1);
  model.mock.restore();
  t.mock.method(synthetic, 'preview', async () => { throw Object.assign(new Error('Access revoked'), { statusCode: 403 }); });
  await assert.rejects(generator.prepareCase(input), { statusCode: 403 });
});

test('parameter limits reject the complete case instead of silently preparing a prefix', async () => {
  const steps = [{ action: Array.from({ length: 101 }, (_, index) => `@t.field_${index}`).join(' '), expected_result: 'All configured inputs are present.' }];
  assert.throws(() => generator.caseParameterReferences({ parameter_values: {} }, steps), { code: 'TEST_DATA_PARAMETER_LIMIT' });
});

test('selected environment metadata supplies missing matching parameters without copying stored values or legacy credentials', async t => {
  const environment = require('@hellotest/testing/backend/services/testEnvironment.service');
  t.mock.method(environment, 'getTestEnvironment', async id => ({ id, project_id: 'project-1', app_type_id: 'app-1', base_url: 'https://app.example.test/',
    variables: [{ key: 'username', value: 'environment-user' }, { key: 'password', value: '', is_secret: true, has_stored_value: true },
      { key: 'unconfigured_secret', value: '', is_secret: true, has_stored_value: false }] }));
  const inputs = await automationInputs.resolveNodeInputs({ run: run(), node: { data: { testEnvironmentId: 'env', automationCredentialId: 'legacy-credential' } },
    user: { id: 'actor-1' }, access: async () => {} });
  assert.equal(inputs.credentialId, null);
  assert.deepEqual(inputs.environmentParameterNames, ['r.username', 'r.password']);
  const draft = { parameter_values: { username: 'case-user', password: '[missing: protected password]' } };
  const supplied = automationInputs.caseInputs(draft, [{ action: 'Enter @t.username and @t.password', expected_result: 'The dashboard is shown.' }], inputs);
  assert.equal(supplied.draft.parameter_values.username, 'case-user');
  assert.equal(supplied.publicInputs.parameter_values['t.username'], 'case-user');
  assert.equal(supplied.draft.parameter_values.password, undefined);
  assert.match(supplied.draft.steps[0].action, /@t.username and @r.password/);
  assert.equal(supplied.publicInputs.parameter_values['t.password'], undefined);
  assert.deepEqual(supplied.publicInputs.test_environment_parameter_bindings, { 't.password': 'r.password' });
  assert.equal(supplied.draft.test_data_options.test_environment_id, 'env');
  assert.deepEqual(supplied.availableParameterNames, ['r.username', 'r.password']);
  assert.equal(JSON.stringify(supplied.draft).includes('environment-user'), false);
});

test('source binding rewrites authored references once while all parameter values remain literal', () => {
  const draft = { parameter_values: { 't.password': '[missing: auth]', 't.note': '@t.password' },
    gherkin_document: 'Feature: Sign in\nScenario: Login\nWhen enter @t.password\nThen the session is ready' };
  const steps = [{ action: 'Fill @t.password, preserve user@t.password and use params["t.password"]', expected_result: 'The session is ready',
    api_request: { body: { password: '@t.password', note: 'literal marker example' } } }];
  const result = automationInputs.bindDraftParameters(draft, steps, { 't.password': 'r.password' });
  assert.equal(result.parameter_values['t.note'], '@t.password');
  assert.equal(result.parameter_values['t.password'], undefined);
  assert.equal(result.steps[0].action, 'Fill @r.password, preserve user@t.password and use params["r.password"]');
  assert.equal(result.steps[0].api_request.body.password, '@r.password');
  assert.match(result.gherkin_document, /enter @r.password/);
  assert.match(draft.gherkin_document, /enter @t.password/);
});
