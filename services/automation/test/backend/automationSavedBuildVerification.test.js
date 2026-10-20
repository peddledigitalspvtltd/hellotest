const test = require('node:test');
const assert = require('node:assert/strict');
const { verifySavedBuild } = require('../../backend/services/automationSavedBuildVerification.service');
const { compileRecordedProgram } = require('../../backend/lib/automationRecordedProgram');

function fixture(mode = 'verify') {
  const source = compileRecordedProgram([
    {name: 'browser_fill', arguments: {locator: '#old', value: '@r.name'}},
    {name: 'browser_assert', arguments: {assertion: 'value', locator: '#old', value: '@r.name'}}
  ]).source;
  const input = {
    activityId: 'activity', options: {verification_mode: mode, verification_driver: 'native'},
    testCase: {id: 'case', project_id: 'project', app_type_id: 'app'}, startUrl: 'https://example.test',
    state: {steps: [{id: 'step', step_type: 'web', step_order: 1, action: 'Enter name', expected_result: 'Name is entered', automation_code: source}],
      parameter_context_key: 'parameters', input_context: {source_key: 'inputs', selection: {}}},
    parameterResolver: {resolve: (_name, args) => ({...args, value: 'PRIVATE_INPUT'})},
    manualLinkIds: ['manual'], manualContext: [{id: 'manual', expected_result: 'Name is entered'}]
  };
  const store = {testCase: {...input.testCase, title: 'Case', execution_hooks: []}, steps: input.state.steps,
    links: ['manual'], manual: input.manualContext, parameterKey: 'parameters', inputKey: 'inputs'};
  const calls = {runs: 0, commits: 0, diagnoses: 0, access: 0, diagnostics: []};
  const events = [];
  let clock = 0;
  const passed = request => ({schema_version: 1, verification_id: request.verification_id, execution_driver: 'native', browser: 'chromium',
    status: 'passed', verification_status: 'verified', replay_safe: false, completed_operations: 2,
    completed_interactions: 1, assertion_count: 1, duration_ms: 12});
  const ports = {
    now: () => ++clock,
    assertAccess: async () => { calls.access++; },
    readCase: async () => store.testCase,
    readSteps: async () => store.steps,
    readManualLinkIds: async () => store.links,
    readManualContext: async () => store.manual,
    manualContextKey: value => JSON.stringify(value),
    readParameters: async () => ({source_key: store.parameterKey}),
    readInputs: async () => ({inputSourceKey: store.inputKey}),
    run: async request => { calls.runs++; return passed(request); },
    diagnose: async () => { calls.diagnoses++; return {step_id: 'step', operation_index: 1, locator: '#new'}; },
    commitRepair: async candidate => {
      calls.commits++;
      store.steps = input.state.steps.map(step => ({...step, automation_code: candidate.after.find(row => row.step_id === step.id).automation_code}));
      return {...input.state, steps: store.steps};
    },
    onProgress: async event => { events.push(event); },
    reportDiagnosticFailure: event => calls.diagnostics.push(event)
  };
  return {input, store, calls, ports, events, passed};
}

test('save-only generation never loads verification state, data or browser adapters', async () => {
  const result = await verifySavedBuild({options: {verification_mode: 'generate_only'}}, new Proxy({}, {get: () => assert.fail('save-only requested a verification dependency')}));
  assert.equal(result.status, 'not_requested');
});

test('exact saved build verification reports bounded source-check timing without data or source', async () => {
  const {input, ports, calls, events} = fixture();
  const result = await verifySavedBuild(input, ports);
  assert.equal(result.status, 'passed'); assert.equal(calls.runs, 1);
  assert.equal(result.source_check_count, 3); assert.ok(result.source_check_duration_ms > 0);
  assert.ok(result.preparation_duration_ms > 0);
  assert.doesNotMatch(JSON.stringify(events), /PRIVATE_INPUT|automation_code|parameter_context_key/);
});

test('linked cases and reusable groups stop before compiling or dispatching a partial verification', async () => {
  for (const kind of ['hooks', 'shared']) {
    const {input, ports, store, calls} = fixture();
    if (kind === 'hooks') store.testCase.execution_hooks = [{phase: 'pre', target_id: 'setup'}];
    else input.state.steps[0].reusable_group_id = 'group';
    const result = await verifySavedBuild(input, ports);
    assert.equal(result.status, 'blocked'); assert.equal(calls.runs, 0);
    assert.equal(result.error_code, kind === 'hooks' ? 'AUTOMATION_VERIFICATION_LINKED_CASES_REQUIRED' : 'AUTOMATION_VERIFICATION_UNSUPPORTED');
  }
});

test('a passing worker receipt cannot accept changed source, manual requirements, hooks or data', async () => {
  const changes = [
    f => { f.store.testCase.execution_hooks.push({phase: 'post', target_id: 'cleanup'}); },
    f => { f.store.testCase.title = 'Changed'; },
    f => { f.store.steps[0].automation_code += '\nawait page.locator("#submit").click();'; },
    f => { f.store.links.push('different'); },
    f => { f.store.manual[0].expected_result = 'Changed'; },
    f => { f.store.parameterKey = 'new parameters'; },
    f => { f.store.inputKey = 'new inputs'; }
  ];
  for (const change of changes) {
    const f = fixture();
    f.ports.run = async request => { f.calls.runs++; change(f); return f.passed(request); };
    const result = await verifySavedBuild(f.input, f.ports);
    assert.equal(result.status, 'blocked'); assert.equal(f.calls.runs, 1); assert.equal(f.calls.commits, 0);
    assert.match(result.error_code, /^AUTOMATION_VERIFICATION_(SOURCE|DATA)_CHANGED$/);
  }
});

test('revoked access, cancellation and lost ownership cannot become optional diagnostic failures', async () => {
  for (const error of [Object.assign(new Error(), {statusCode: 403}), Object.assign(new Error(), {name: 'AbortError'}), Object.assign(new Error(), {code: 'BATCH_JOB_LEASE_LOST'})]) {
    const f = fixture(); f.ports.assertAccess = async () => { throw error; };
    await assert.rejects(verifySavedBuild(f.input, f.ports), value => value === error);
    assert.equal(f.calls.runs, 0);
  }
});

test('source or access changes during progress persistence and transport preparation stop before dispatch', async () => {
  for (const boundary of ['progress', 'transport']) {
    const f = fixture();
    if (boundary === 'progress') f.ports.onProgress = async summary => {
      if (summary.phase === 'verify') f.store.steps[0].automation_code += '\nawait page.locator("#other").click();';
    };
    else f.ports.prepareRun = async () => {
      f.store.testCase.execution_hooks.push({phase: 'pre', target_id: 'setup'});
      return f.ports.run;
    };
    const result = await verifySavedBuild(f.input, f.ports);
    assert.equal(result.status, 'blocked');
    assert.equal(result.error_code, 'AUTOMATION_VERIFICATION_SOURCE_CHANGED');
    assert.equal(f.calls.runs, 0);
  }
});

test('cancellation during transport preparation propagates its reason without dispatching or reporting a blocked build', async () => {
  const f = fixture(), controller = new AbortController(), reason = new Error('Cancelled by user');
  f.input.signal = controller.signal;
  f.ports.prepareRun = async () => { controller.abort(reason); return f.ports.run; };
  await assert.rejects(verifySavedBuild(f.input, f.ports), error => error === reason);
  assert.equal(f.calls.runs, 0);
  assert.ok(!f.events.some(event => event.status === 'blocked'));
});

test('optional progress storage failure leaves execution verified and records only a classified diagnostic', async () => {
  const f = fixture();
  f.ports.onProgress = async () => { throw Object.assign(new Error('PRIVATE_STORAGE_DETAIL'), {code: 'ECONNRESET'}); };
  const result = await verifySavedBuild(f.input, f.ports);
  assert.equal(result.status, 'passed'); assert.equal(f.calls.runs, 1);
  assert.ok(f.calls.diagnostics.length > 0);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_STORAGE_DETAIL/);
  const revoked = fixture(); revoked.ports.onProgress = async () => { throw Object.assign(new Error(), {statusCode: 403}); };
  await assert.rejects(verifySavedBuild(revoked.input, revoked.ports), {statusCode: 403});
  assert.equal(revoked.calls.runs, 0);
});

test('a verified locator repair advances the frozen source baseline only after the matching commit', async () => {
  for (const wrongCommit of [false, true]) {
    const f = fixture('verify_repair');
    f.ports.run = async request => {
      if (++f.calls.runs > 1) return f.passed(request);
      return {schema_version: 1, verification_id: request.verification_id, browser: 'chromium', status: 'failed', verification_status: 'unverified',
        replay_safe: true, completed_operations: 0, completed_interactions: 0, assertion_count: 0, duration_ms: 1,
        failure: {step_id: 'step', operation_index: 1, operation_kind: 'browser_fill', action_outcome: 'not_attempted', code: 'AUTOMATION_VERIFICATION_LOCATOR_UNRESOLVED'},
        snapshot: {elements: [{locators_validated: true, locator_candidates: ['#new']}]}};
    };
    const commit = f.ports.commitRepair;
    f.ports.commitRepair = async candidate => {
      const state = await commit(candidate);
      return wrongCommit ? {...state, steps: f.input.state.steps} : state;
    };
    const result = await verifySavedBuild(f.input, f.ports);
    assert.equal(result.status, wrongCommit ? 'blocked' : 'passed');
    assert.equal(f.calls.runs, 2); assert.equal(f.calls.commits, 1); assert.equal(f.calls.diagnoses, 1);
    if (wrongCommit) assert.equal(result.error_code, 'AUTOMATION_VERIFICATION_SOURCE_CHANGED');
  }
});
