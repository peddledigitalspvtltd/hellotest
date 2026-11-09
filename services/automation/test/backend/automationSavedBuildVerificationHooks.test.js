const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { createRequire } = require('node:module');
const { parse } = require('acorn');
const { createSavedBuildVerificationHooks } = require('../../backend/lib/automationSavedBuildVerificationHooks');
const { verifySavedBuild } = require('../../backend/services/automationSavedBuildVerification.service');
const { compileRecordedProgram } = require('../../backend/lib/automationRecordedProgram');

function fixture(mode = 'verify_repair') {
  const source = compileRecordedProgram([
    {name: 'browser_fill', arguments: {locator: '#old', value: '@r.name'}},
    {name: 'browser_assert', arguments: {assertion: 'value', locator: '#old', value: '@r.name'}}
  ]).source;
  const step = {id: 'upstream-step', step_type: 'web', step_order: 1, action: 'Enter @r.name', expected_result: 'Name retains @r.name', automation_code: source};
  const input = {options: {verification_mode: mode, verification_driver: 'native'}, testCase: {id: 'case', project_id: 'project', app_type_id: 'app'},
    startUrl: 'https://app.test', state: {steps: [step], parameter_context_key: 'parameters', input_context: {source_key: 'inputs', selection: {test_data_set_id: 'dataset'}}},
    manualLinkIds: ['manual-case'], manualContext: [{id: 'manual-case', steps: [{id: 'manual-step', action: step.action, expected_result: step.expected_result}]}]};
  const permissions = {'automation.run.local': true, 'run.create': true};
  const calls = {buildAccess: 0, access: [], models: [], runs: [], commits: []};
  let build = {updates: [{step, step_type: 'web', automation_code: source}], summary: 'Native source', browser_evidence: {transport: 'upstream_playwright_mcp'},
    learned_locators: [{locator: '#old'}, {locator: '#retained'}]};
  let savedSteps = input.state.steps;
  const resolver = {resolve: (_name, args) => ({...args, value: 'PRIVATE_VALUE'}),
    redactResult: value => JSON.parse(JSON.stringify(value).replaceAll('PRIVATE_VALUE', '[redacted]'))};
  input.parameterResolver = resolver;
  const hookOptions = {
    assertBuildAccess: async () => { calls.buildAccess++; },
    getVerificationAccess: async requested => { calls.access.push(requested); return permissions; },
    parameterResolver: resolver, featureKey: 'ai.agentic.automation-engineer', parseResponse: JSON.parse,
    completeRepair: async request => {
      calls.models.push(request);
      await request.beforeDispatch();
      const packet = JSON.parse(request.prompt.slice(request.prompt.lastIndexOf('\n\n') + 2));
      assert.doesNotMatch(request.prompt, /PRIVATE_VALUE|#new/);
      return JSON.stringify({step_id: 'upstream-step', operation_index: 1, locator: packet.current_snapshot.targets[0].ref});
    },
    getBuild: () => build,
    commitBuild: async repaired => {
      calls.commits.push(repaired);
      savedSteps = repaired.updates.map(update => ({...update.step, automation_code: update.automation_code}));
      input.state = {...input.state, steps: savedSteps};
      build = repaired;
      return input.state;
    }
  };
  const passed = request => ({schema_version: 1, verification_id: request.verification_id, execution_driver: 'native', browser: 'chromium',
    status: 'passed', verification_status: 'verified', replay_safe: false, completed_operations: 2, completed_interactions: 1, assertion_count: 1, duration_ms: 1});
  const failed = request => ({schema_version: 1, verification_id: request.verification_id, execution_driver: 'native', browser: 'chromium',
    status: 'failed', verification_status: 'unverified', replay_safe: true, completed_operations: 0, completed_interactions: 0, assertion_count: 0, duration_ms: 1,
    failure: {step_id: 'upstream-step', operation_index: 1, operation_kind: 'browser_fill', action_outcome: 'not_attempted', code: 'AUTOMATION_VERIFICATION_LOCATOR_UNRESOLVED'},
    snapshot: {source: 'playwright', observation_id: 'native-failed-capture', elements: [{tag: 'input', accessible_role: 'textbox', accessible_name: 'Name',
      text: 'PRIVATE_VALUE', displayed: true, disabled: false, in_viewport: true, locators_validated: true, locator_candidates: ['#new']}]}});
  const ports = {
    readCase: async () => ({...input.testCase, execution_hooks: []}), readSteps: async () => savedSteps,
    readManualLinkIds: async () => input.manualLinkIds, readManualContext: async () => input.manualContext,
    manualContextKey: JSON.stringify, readParameters: async () => ({source_key: 'parameters'}), readInputs: async () => ({inputSourceKey: 'inputs'}),
    run: async request => {calls.runs.push(request); return calls.runs.length === 1 ? failed(request) : passed(request);}
  };
  const verify = () => verifySavedBuild(input, {...ports, ...createSavedBuildVerificationHooks(hookOptions)});
  return {input, permissions, calls, hookOptions, ports, verify, source, passed, failed, build: () => build};
}

test('shared saved-build hooks commit one supported locator repair after the exact source and frozen data pass a fresh rerun', async () => {
  const f = fixture(), result = await f.verify();
  assert.equal(result.status, 'passed'); assert.equal(result.repair_count, 1);
  assert.equal(f.calls.runs.length, 2); assert.equal(f.calls.models.length, 1); assert.equal(f.calls.commits.length, 1);
  assert.equal(f.calls.models[0].generationScope, 'verification_repair'); assert.equal(f.calls.models[0].timeoutMs, 30_000);
  assert.equal(f.calls.models[0].sectionId, 'upstream-step');
  assert.equal(f.calls.runs[0].sections[0].automation_code, f.source);
  const [before, after] = f.calls.runs.map(request => request.sections[0]);
  assert.equal(after.operations[0].arguments.locator, '#new');
  assert.equal(after.operations[0].arguments.value, before.operations[0].arguments.value);
  assert.deepEqual(after.operations[1], before.operations[1], 'the original expected-result oracle remains exact');
  assert.deepEqual(f.calls.runs[0].parameters, {'r.name': 'PRIVATE_VALUE'});
  assert.deepEqual(f.calls.runs[1].parameters, f.calls.runs[0].parameters);
  assert.equal(f.build().updates[0].automation_code, after.automation_code);
  assert.equal(f.build().browser_evidence.transport, 'upstream_playwright_mcp');
  assert.deepEqual(f.build().learned_locators, [{locator: '#retained'}]);
  assert.ok(f.calls.access.length > 6);
  assert.ok(f.calls.access.every(keys => JSON.stringify(keys) === JSON.stringify(['automation.run.local', 'run.create'])));
});

test('current verification permissions stop revoked runs, model dispatch, reruns and source commits', async () => {
  for (const permission of ['automation.run.local', 'run.create']) {
    for (const boundary of ['before_run', 'transport', 'model_dispatch', 'after_diagnosis', 'rerun', 'commit']) {
      const f = fixture();
      if (boundary === 'before_run') f.permissions[permission] = false;
      if (boundary === 'transport') f.ports.prepareRun = async () => {f.permissions[permission] = false; return f.ports.run;};
      if (boundary === 'model_dispatch') {
        const complete = f.hookOptions.completeRepair;
        f.hookOptions.completeRepair = async request => {f.permissions[permission] = false; return complete(request);};
      }
      if (boundary === 'after_diagnosis') {
        const complete = f.hookOptions.completeRepair;
        f.hookOptions.completeRepair = async request => {const response = await complete(request); f.permissions[permission] = false; return response;};
      }
      if (boundary === 'rerun') f.ports.onProgress = async summary => {if (summary.phase === 'rerun') f.permissions[permission] = false;};
      if (boundary === 'commit') f.ports.run = async request => {
        f.calls.runs.push(request);
        if (f.calls.runs.length === 1) return f.failed(request);
        f.permissions[permission] = false;
        return f.passed(request);
      };
      await assert.rejects(f.verify(), {statusCode: 403}, `${permission}: ${boundary}`);
      assert.equal(f.calls.commits.length, 0, `${permission}: ${boundary}`);
      assert.equal(f.build().updates[0].automation_code, f.source);
      assert.equal(f.calls.runs.length, ['before_run', 'transport'].includes(boundary) ? 0 : boundary === 'commit' ? 2 : 1);
    }
  }
});

test('shared saved-build hooks cannot replay an unknown action or repair a failed assertion', async () => {
  for (const kind of ['unknown', 'assertion']) {
    const f = fixture();
    f.ports.run = async request => {
      f.calls.runs.push(request);
      const receipt = f.failed(request);
      if (kind === 'unknown') Object.assign(receipt, {status: 'unknown', replay_safe: false, failure: {...receipt.failure, action_outcome: 'unknown'}});
      else receipt.failure = {...receipt.failure, operation_index: 2, operation_kind: 'browser_assert', code: 'AUTOMATION_VERIFICATION_ASSERTION_FAILED'};
      return receipt;
    };
    const result = await f.verify();
    assert.equal(result.status, 'blocked'); assert.equal(f.calls.runs.length, 1);
    assert.equal(f.calls.models.length, 0); assert.equal(f.calls.commits.length, 0);
  }
});

test('generate-only native builds do not evaluate verification permissions or repair hooks', async () => {
  const f = fixture('generate_only'); f.permissions['run.create'] = false;
  const result = await f.verify();
  assert.equal(result.status, 'not_requested'); assert.equal(f.calls.buildAccess, 0);
  assert.equal(f.calls.access.length, 0); assert.equal(f.calls.models.length, 0); assert.equal(f.calls.runs.length, 0);
});

test('both actual builder branches wire shared hooks and the upstream repair adapter bounds and traces its provider call', async () => {
  const file = require.resolve('../../backend/services/aiAutomationBuilder.service'), source = fs.readFileSync(file, 'utf8');
  const factories = [], completions = [];
  const walk = node => {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'CallExpression' && node.callee?.property?.name === 'createSavedBuildVerificationHooks') factories.push(node);
    if (node.type === 'VariableDeclarator' && node.id?.name === 'complete' && source.slice(node.start, node.end).includes('generation_scope:phase')) completions.push(node.init);
    for (const value of Object.values(node)) if (Array.isArray(value)) value.forEach(walk); else if (value && typeof value === 'object') walk(value);
  };
  walk(parse(source, {ecmaVersion: 'latest'}));
  assert.equal(factories.length, 2); assert.equal(completions.length, 1);
  const trace = [], requests = [], access = [];
  const context = {assertAccess: async () => access.push('build'), knowledgeRows: {knowledge: [], context_transport: 'not_required'}, browserParameters: {redactUpstream: value => value.replaceAll('PRIVATE_VALUE', '[redacted]')},
    require: name => name.endsWith('llmTraceContext') ? {run: async (metadata, run) => {trace.push(metadata); return run();}} : createRequire(file)(name),
    testCase: {project_id: 'project'}, created_by: 'actor', transaction_id: null, test_case_id: 'case', automationCaseType: 'web',
    requestChatCompletion: async request => {requests.push(request); await request.beforeDispatch(); return '{}';}, integration: {}, buildFeature: () => 'feature', ai_feature: 'feature', execution_guard: undefined};
  const complete = new Function(...Object.keys(context), `return (${source.slice(completions[0].start, completions[0].end)});`)(...Object.values(context));
  await complete({prompt: 'PRIVATE_VALUE', phase: 'verification_repair', step: {id: 'upstream-step'}, timeoutMs: 90_000, beforeDispatch: async () => access.push('verification')});
  assert.equal(trace[0].generation_scope, 'verification_repair'); assert.deepEqual(trace[0].generation_section_ids, ['upstream-step']);
  assert.equal(requests[0].timeoutMs, 30_000); assert.equal(requests[0].maxAttempts, 1);
  assert.equal(requests[0].prompt, '[redacted]'); assert.deepEqual(access, ['build', 'verification']);
  assert.equal(requests[0].nativeTools, undefined); assert.equal(requests[0].browserActor, false);

  // Execute the real upstream factory/commit closure, rather than duplicating
  // its wiring in the test. applyBuild remains the domain persistence boundary.
  const f = fixture(), applied = [], state = f.input.state;
  const identity = {manual_context: f.input.manualContext, manual_link_ids: f.input.manualLinkIds,
    parameter_context_key: 'parameters', input_context: state.input_context, data_snapshot: {id: 'frozen-data'}};
  const guard = {signal: new AbortController().signal};
  const factoryContext = {require: createRequire(file), assertAccess: f.hookOptions.assertBuildAccess,
    getOptionalEvidenceAccess: async (principal, projectId, keys) => {
      assert.deepEqual(principal, {id: 'actor'}); assert.equal(projectId, 'project');
      return f.hookOptions.getVerificationAccess(keys);
    }, created_by: 'actor', testCase: f.input.testCase, browserParameters: f.input.parameterResolver,
    buildFeature: () => 'ai.agentic.automation-engineer', ai_feature: 'feature', execution_guard: guard,
    extractJsonPayload: JSON.parse,
    complete: ({prompt, phase, step, ...request}) => f.hookOptions.completeRepair({...request, prompt, generationScope: phase, sectionId: step.id}),
    result: f.build(), buildIdentity: identity, progressiveState: state,
    applyBuild: async value => {
      applied.push(value);
      const committed = await f.hookOptions.commitBuild(value.build);
      Object.assign(state, committed);
      return committed.steps;
    }};
  const actual = new Function(...Object.keys(factoryContext), `let stepUpdates; const hooks = ${source.slice(factories[0].start, factories[0].end)}; return {hooks, result:()=>result, updates:()=>stepUpdates};`)(...Object.values(factoryContext));
  const verification = await verifySavedBuild(f.input, {...f.ports, ...actual.hooks});
  assert.equal(verification.status, 'passed'); assert.equal(applied.length, 1);
  assert.equal(applied[0].executionGuard, guard); assert.equal(applied[0].createdBy, 'actor');
  assert.equal(applied[0].progressiveState, state); assert.equal(applied[0].build.data_snapshot, identity.data_snapshot);
  assert.equal(applied[0].build.manual_context, f.input.manualContext);
  assert.equal(actual.result().updates[0].automation_code, f.calls.runs[1].sections[0].automation_code);
  assert.equal(actual.updates()[0].automation_code, actual.result().updates[0].automation_code);
});
