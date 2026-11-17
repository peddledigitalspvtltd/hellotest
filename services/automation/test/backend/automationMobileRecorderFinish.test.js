const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { AsyncLocalStorage } = require('node:async_hooks');
const { createRecordingImportService } = require('../../backend/services/recordingImport.service');
const { persistMobileRecorderPlan } = require('../../backend/services/mobileRecorderPersistence.service');
const { recorderPlanFingerprint } = require("../../backend/lib/recording/automationRecorderPlan");
const source = fs.readFileSync(require.resolve('../../backend/services/builder/recorderImport'), 'utf8');
const finishSource = source.slice(source.indexOf('exports.finishRecorderSession ='), source.indexOf('return { selectStaleRecorderTransactions'));
const copy = value => structuredClone(value);

/** Execute the actual finish orchestration, receipt service, native persistence,
 * compiler and readiness helper against transactional storage ports. HTTP,
 * repository preparation and optional activity/learning are observed ports. */
function fixture(options = {}) {
  const context = new AsyncLocalStorage(), calls = [];
  const testCase = { id: 'native-case', project_id: 'project', app_type_id: 'app', app_type_kind: 'unified', title: 'Native recording', automation_status: 'not_automated' };
  let state = { cases: [testCase], steps: copy(options.steps || [{ id: 'native-step', test_case_id: testCase.id, step_order: 1, step_type: 'ios', action: 'Manual native action', expected_result: 'Manual expectation', automation_code: '' }]), receipts: [], nextId: 1 };
  let queue = Promise.resolve();
  const failures = { receipt: false, readiness: false, learning: false, status: false, event: false, ...options.failures };
  const metadata = { test_case_id: testCase.id, recorder_session_id: 'session', recorder_target: 'mobile', platform_name: 'ios',
    engine_base_url: 'https://engine.example.test', mobile_engine_base_url: 'https://native.example.test', recorder_plan_key: recorderPlanFingerprint(state.steps) };
  const session = { id: 'session', status: 'stopped', platform: 'ios', actions: copy(options.actions || [{ index: 1, type: 'tap', locator: '~Continue' }]), network: [] };
  session.action_count = session.actions.length;
  const inside = () => Boolean(context.getStore());
  const outside = label => { assert.equal(inside(), false, `${label} must run outside the plan/receipt transaction.`);calls.push(label); };
  const transactional = async callback => {
    const before = copy(state);
    try { return await callback(); }
    catch (error) { state = before;throw error; }
  };
  const db = {
    transaction: callback => (...args) => {
      if (inside()) return transactional(() => callback(...args));
      const result = queue.then(() => context.run(true, () => transactional(() => callback(...args))));
      queue = result.catch(() => undefined);
      return result;
    },
    prepare: sql => ({
      get: async value => {
        if (sql.startsWith('SELECT input_sha256,result')) return copy(state.receipts.find(row => row.id === value));
        assert.match(sql, /SELECT id FROM test_cases/);assert.equal(inside(), true);
        return state.cases.find(row => row.id === value) ? { id: value } : undefined;
      },
      all: async caseId => {
        assert.match(sql, /SELECT \* FROM test_steps/);assert.equal(inside(), true);
        return copy(state.steps.filter(row => row.test_case_id === caseId));
      },
      run: async (...values) => {
        assert.match(sql, /INSERT INTO automation_recording_imports/);assert.equal(inside(), true);
        calls.push('receipt');
        if (failures.receipt) throw new Error('Receipt storage rejected');
        state.receipts.push({ id: values[0], input_sha256: values[6], result: copy(values[7]) });
        return { changes: 1 };
      }
    })
  };
  const imports = createRecordingImportService({ db });
  const selectedCase = () => state.cases.find(row => row.id === testCase.id);
  const deps = {
    exports: {}, normalizeText: value => String(value || '').trim(),
    selectCaseWithScope: { get: async id => copy(state.cases.find(row => row.id === id)) },
    selectStepsForCase: { all: async id => copy(state.steps.filter(row => row.test_case_id === id)) },
    workspaceTransactionService: {
      getTransaction: async () => ({ id: 'transaction', created_by: 'author', project_id: 'project', action: 'test_case_recorder', metadata }),
      updateTransaction: async () => { outside('status');if (failures.status) throw new Error('Optional activity status unavailable'); }
    },
    parseTransactionMetadata: transaction => transaction?.metadata || {},
    require: id => {
      if (id.endsWith('/recordingImport.service')) return imports;
      if (id.endsWith('/automationRecorderPlan')) return { recorderPlanFingerprint };
      if (id.endsWith('/mobileRecorderPlan')) return require('../../backend/domain/mobileRecorderPlan');
      if (id.endsWith('/automationRecorderReadiness')) return require("../../backend/lib/recording/automationRecorderReadiness");
      throw new Error(`Unexpected finish dependency ${id}`);
    },
    resolveTestEngineIntegration: async () => { outside('integration');return { base_url: 'https://engine.example.test', config: {} }; },
    resolveAutomationCaseSteps: (_case, steps) => ({ automation_case_type: 'unified', allowed_step_types: ['web', 'api', 'android', 'ios'], steps }),
    resolveMobileRecorderPlatform: require('../../backend/domain/mobileRecorderPlan').resolveMobileRecorderPlatform,
    isMobileRecorderTarget: value => value === 'mobile', isMobileAppType: value => ['android', 'ios'].includes(value),
    mobileFeatureService: { assertMobileFeatureEnabled: async () => { outside('feature'); } },
    getOptionalEvidenceAccess: async () => ({ 'mobile.manage': true }),
    resolveMobileEngineBaseUrl: () => 'https://native.example.test',
    readMobileEngineJson: async () => { outside('engine');return copy(session); },
    normalizeCapturedActions: actions => actions, normalizeCapturedNetwork: network => network, MAX_CAPTURED_ACTIONS: 180,
    automationCasePreparationService: { prepareAutomationTarget: async () => { outside('prepare');return { test_case_id: testCase.id, source_test_case_id: null, target_step_id: null }; } },
    buildRecorderRepositoryModel: async () => { outside('repository');await options.beforeRepository?.({ state, calls });return { byActionIndex: new Map(), repository_warning: options.repositoryWarning }; },
    persistMobileRecorderPlan, db,
    testStepService: {
      updateTestStep: async (id, input, settings) => {
        assert.equal(inside(), true);assert.equal(settings.syncSharedGroup, false);calls.push('write');
        Object.assign(state.steps.find(row => row.id === id), copy(input));
      },
      createTestStep: async (input, settings) => {
        assert.equal(inside(), true);assert.equal(settings.syncSharedGroup, false);calls.push('write');
        const id = `created-${state.nextId++}`;state.steps.push({ id, ...copy(input) });return { id };
      }
    },
    markTestCaseAutomationIncomplete: { run: async () => {
      assert.equal(inside(), true);calls.push('incomplete');if (failures.readiness) throw new Error('Readiness storage rejected');selectedCase().automation_status = 'incomplete';
    } },
    markTestCaseAutomationReady: { run: async (user, id) => {
      assert.equal(inside(), true);assert.equal(user, 'author');assert.equal(id, testCase.id);calls.push('ready');
      if (failures.readiness) throw new Error('Readiness storage rejected');selectedCase().automation_status = 'ready';
    } },
    persistLearning: async () => { outside('learning');if (failures.learning) throw new Error('Optional learning unavailable');return 2; },
    appendEvent: async () => { outside('event');if (failures.event) throw new Error('Optional activity event unavailable'); }
  };
  new Function("ports", ...Object.keys(deps), finishSource)(deps, ...Object.values(deps));
  const request = { test_case_id: testCase.id, recorder_session_id: 'session', transaction_id: 'transaction', created_by: 'author' };
  return { finish: input => deps.exports.finishRecorderSession({ ...request, ...input }), calls, failures,
    get state() { return state; }, metadata };
}

test('mobile finish commits plan/readiness/receipt together and keeps preparation plus optional work outside the transaction', async () => {
  const f = fixture({ actions: [{ index: 1, type: 'type', locator: '~Name', value: 'captured-input-fixture' }] });
  const result = await f.finish();
  assert.equal(result.generated_step_count, 1);assert.equal(result.learned_locator_count, 2);
  assert.equal(f.state.cases[0].automation_status, 'ready');assert.equal(f.state.receipts.length, 1);
  assert.match(f.state.steps[0].automation_code, /element\.setValue/);
  assert.equal(f.state.steps[0].action, 'Manual native action');
  assert.ok(f.calls.indexOf('repository') < f.calls.indexOf('write'));
  assert.ok(f.calls.indexOf('ready') < f.calls.indexOf('receipt'));
  assert.ok(f.calls.indexOf('receipt') < f.calls.indexOf('learning'));
  assert.ok(!JSON.stringify(f.state.receipts).includes('captured-input-fixture'), 'Retry receipts do not duplicate captured input/source.');
  assert.ok(result.step_updates.every(step => !Object.hasOwn(step, 'automation_code')));
});

test('learning and activity failures return warnings after a durable native save; a lost response retries without changing later edits', async () => {
  const f = fixture({ failures: { learning: true, status: true, event: true } });
  const first = await f.finish();
  assert.equal(first.generated_step_count, 1);assert.equal(first.warnings.length, 3);
  assert.ok(first.warnings.every(warning => warning.startsWith('The recording was saved')));
  assert.equal(f.state.receipts.length, 1);assert.equal(f.state.cases[0].automation_status, 'ready');
  f.state.steps[0].automation_code = 'await ios.tap("~Later edit");';
  const edited = copy(f.state.steps), before = [...f.calls];
  const retry = await f.finish();
  assert.equal(retry.idempotent_replay, true);assert.deepEqual(retry.step_updates, first.step_updates);
  assert.deepEqual(f.state.steps, edited);assert.deepEqual(f.calls, before, 'A receipt replay does not call the engine or prepare/learn/save again.');
  await assert.rejects(f.finish({ included_action_indices: [1] }), { code: 'AUTOMATION_RECORDER_IMPORT_CONFLICT' });
  assert.deepEqual(f.state.steps, edited);
});

test('concurrent mobile finishes write the native plan once and return identical row receipts', async () => {
  let arrivals = 0, release;
  const both = new Promise(resolve => { release = resolve; });
  const f = fixture({ beforeRepository: async () => { if (++arrivals === 2) release();await both; } });
  const results = await Promise.all([f.finish(), f.finish()]);
  assert.equal(f.calls.filter(call => call === 'write').length, 1);
  assert.equal(f.calls.filter(call => call === 'learning').length, 1);
  assert.equal(f.state.receipts.length, 1);assert.equal(results.filter(result => result.idempotent_replay).length, 1);
  assert.deepEqual(results[0].step_updates, results[1].step_updates);
});

test('receipt or readiness storage rejection rolls back native plan/readiness and permits a clean retry', async () => {
  for (const failure of ['receipt', 'readiness']) {
    const f = fixture({ failures: { [failure]: true } }), before = copy(f.state);
    await assert.rejects(f.finish(), /storage rejected/);
    assert.deepEqual(f.state, before);assert.equal(f.calls.includes('learning'), false);
    f.failures[failure] = false;
    const result = await f.finish();
    assert.equal(result.generated_step_count, 1);assert.equal(f.state.receipts.length, 1);
    assert.equal(f.state.cases[0].automation_status, 'ready');
  }
});

test('a plan edited during repository preparation is preserved by the locked native save', async () => {
  const f = fixture({ beforeRepository: ({ state }) => { state.steps[0].automation_code = 'await ios.tap("~Concurrent edit");'; } });
  await assert.rejects(f.finish(), { code: 'AUTOMATION_RECORDER_CASE_CHANGED' });
  assert.equal(f.state.receipts.length, 0);assert.equal(f.calls.includes('write'), false);
  assert.equal(f.state.steps[0].automation_code, 'await ios.tap("~Concurrent edit");');
});

test('unsupported native input fails the domain preflight before target creation or repository work', async () => {
  for (const action of [{ index: 1, type: 'swipe' }, { index: 1, type: 'tap', x: null, y: null }, { index: 1, type: 'pressback' }]) {
    const f = fixture({ actions: [action] }), before = copy(f.state);
    await assert.rejects(f.finish(), { code: 'AUTOMATION_RECORDER_INPUT_INVALID' });
    assert.deepEqual(f.state, before);assert.equal(f.calls.includes('prepare'), false);
    assert.equal(f.calls.includes('repository'), false);assert.equal(f.calls.includes('write'), false);
  }
});

test('saved native instructions cannot mark another unmapped runtime ready and the readiness warning survives receipt replay', async () => {
  const f = fixture({ steps: [
    { id: 'web', test_case_id: 'native-case', step_order: 1, step_type: 'web', automation_code: '' },
    { id: 'native-step', test_case_id: 'native-case', step_order: 2, step_type: 'ios', action: 'Native action', automation_code: '' }
  ] });
  const first = await f.finish();
  assert.equal(f.state.cases[0].automation_status, 'incomplete');
  assert.ok(first.warnings.some(warning => warning.includes('Complete these instructions before running')));
  assert.deepEqual((await f.finish()).warnings, first.warnings);
});
