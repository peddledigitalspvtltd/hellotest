const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { recorderPlanFingerprint } = require('../../backend/lib/automationRecorderPlan');
const source = fs.readFileSync(require.resolve('../../backend/services/aiAutomationBuilder.service'), 'utf8');
const body = source.slice(source.indexOf('exports.finishRecorderSession ='), source.indexOf('exports.connectCaseBrowser ='));

function fixture({ stopped = false, changed = false, savedImport = null, owner = 'user' } = {}) {
  const testCase = { id: 'automation', project_id: 'project', app_type_id: 'app', automated: 'yes' };
  const steps = [{ id: 'manual-copy', step_order: 1, step_type: 'web', action: 'Prior manual action' }];
  const calls = [], finalizations = [];
  const metadata = { test_case_id: testCase.id, recorder_session_id: 'session', recorder_target: 'web', recorder_mode: 'remote',
    recorder_plan_key: recorderPlanFingerprint(steps), test_suite_id: 'original-suite', test_environment_id: 'original-environment', engine_base_url: 'https://engine.test' };
  if (changed) steps[0].action = 'Concurrent edit';
  const capture = { id: 'session', status: 'stopped', start_url: 'https://fixture.test/form', actions: [{ index: 1, type: 'fill', value: 'Exact final input', locator: '#name' }], network: [], action_count: 1 };
  const deps = { exports: {}, normalizeText: value => String(value || '').trim(), selectCaseWithScope: { get: async () => testCase },
    selectStepsForCase: { all: async () => steps }, resolveTestEngineIntegration: async () => ({ base_url: 'https://engine.test', config: {} }),
    workspaceTransactionService: { getTransaction: async () => ({ metadata, created_by: owner, project_id: 'project', action: 'test_case_recorder' }) }, parseTransactionMetadata: transaction => transaction?.metadata || {},
    require: id => {
      if (id.endsWith('/recordingImport.service')) return { load: async () => savedImport };
      assert.ok(id.endsWith('/automationRecorderPlan'));return { recorderPlanFingerprint };
    },
    resolveAutomationCaseSteps: () => ({ automation_case_type: 'web', allowed_step_types: ['web'], steps }),
    isMobileRecorderTarget: () => false, isMobileAppType: () => false, resolveMobileEngineBaseUrl: () => '',
    readEngineJson: async (url, options) => { calls.push([url, options?.method || 'GET']);return stopped || options?.method === 'POST' ? capture : { ...capture, status: 'running', actions: [], action_count: 0 }; },
    normalizeCapturedActions: actions => actions, normalizeCapturedNetwork: network => network, MAX_CAPTURED_ACTIONS: 180,
    automationCasePreparationService: { prepareAutomationTarget: async () => ({ test_case_id: testCase.id, source_test_case_id: null, target_step_id: null }) },
    finalizeRecorderBuild: async input => { finalizations.push(input);return { test_case_id: testCase.id, generated_step_count: input.capturedActions.length }; }
  };
  new Function(...Object.keys(deps), body)(...Object.values(deps));
  return { finish: deps.exports.finishRecorderSession, calls, finalizations };
}

test('finishing compiles the frozen stop response including the last input and original suite context', async () => {
  const f = fixture(), bindings = [{ source_action_index: 1, parameter_reference: '@s.name' }];
  const result = await f.finish({ test_case_id: 'automation', recorder_session_id: 'session', transaction_id: 'transaction', parameter_bindings: bindings, created_by: 'user' });
  assert.deepEqual(f.calls.map(call => call[1]), ['GET', 'POST']);
  assert.equal(result.generated_step_count, 1);assert.equal(f.finalizations[0].capturedActions[0].value, 'Exact final input');
  assert.deepEqual(f.finalizations[0].parameterBindings, bindings);
  assert.equal(f.finalizations[0].parameterSelection.test_suite_id, 'original-suite');
  assert.equal(f.finalizations[0].parameterSelection.test_environment_id, 'original-environment');
  assert.equal(f.finalizations[0].recordingImport.sourceCaseId, 'automation');
  assert.equal(f.finalizations[0].recordingImport.sessionId, 'session');
});

test('a saved import replays its durable receipt even after plan edits without reading the browser or rebuilding', async () => {
  const receipt = { test_case_id: 'automation', generated_step_count: 1, idempotent_replay: true };
  const f = fixture({ changed: true, savedImport: receipt });
  assert.deepEqual(await f.finish({ test_case_id: 'automation', recorder_session_id: 'session', transaction_id: 'transaction', created_by: 'user' }), receipt);
  assert.deepEqual(f.calls, []);assert.deepEqual(f.finalizations, []);
});

test('a complete recording cannot be redirected to a different section while saving', async () => {
  const f = fixture();
  await assert.rejects(f.finish({ test_case_id: 'automation', recorder_session_id: 'session', transaction_id: 'transaction', target_step_id: 'manual-copy', created_by: 'user' }), { code: 'AUTOMATION_RECORDER_TARGET_CHANGED' });
  assert.deepEqual(f.calls, []);assert.deepEqual(f.finalizations, []);
});

test('only the user who started the scoped recording can import it, and an initial import requires its receipt', async () => {
  const another = fixture({ owner: 'other-user' });
  await assert.rejects(another.finish({ test_case_id: 'automation', recorder_session_id: 'session', transaction_id: 'transaction', created_by: 'user' }), { code: 'AUTOMATION_RECORDER_SCOPE_MISMATCH' });
  assert.deepEqual(another.calls, []);
  const missing = fixture();
  await assert.rejects(missing.finish({ test_case_id: 'automation', recorder_session_id: 'session', created_by: 'user' }), { code: 'AUTOMATION_RECORDER_TRANSACTION_REQUIRED' });
  assert.deepEqual(missing.calls, []);
});

test('retrying a stopped recording reuses its capture and a concurrent plan edit fails before import', async () => {
  const f = fixture({ stopped: true });
  await f.finish({ test_case_id: 'automation', recorder_session_id: 'session', transaction_id: 'transaction', created_by: 'user' });
  assert.deepEqual(f.calls.map(call => call[1]), ['GET']);assert.equal(f.finalizations.length, 1);
  const changed = fixture({ changed: true });
  await assert.rejects(changed.finish({ test_case_id: 'automation', recorder_session_id: 'session', transaction_id: 'transaction', created_by: 'user' }), { code: 'AUTOMATION_RECORDER_CASE_CHANGED' });
  assert.deepEqual(changed.calls, []);assert.deepEqual(changed.finalizations, []);
});
