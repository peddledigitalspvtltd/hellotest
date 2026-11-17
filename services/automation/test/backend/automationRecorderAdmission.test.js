const test = require('node:test');
const assert = require('node:assert/strict');
const { createRecorderImport } = require('../../backend/services/builder/recorderImport');

function fixture({ busy = false, startError, receiptError = false, stopError } = {}) {
  const calls = [], patches = [];
  let reserving = false;
  const testCase = { id: 'case', app_type_id: 'app', project_id: 'project', title: 'Recorder admission', app_type_kind: 'web' };
  const ports = {
    exports: {}, obsDb: { prepare: () => ({ all: async () => [] }) },
    require: id => {
      if (id.endsWith('/automationAuthoringAdmission.service')) return { withRecorder: async (input, reserve) => {
        assert.equal(input.testCase.id, 'case');calls.push('admission');
        if (busy) throw Object.assign(new Error('Automation is building.'), { code: 'AUTOMATION_AUTHORING_BUSY', statusCode: 409 });
        reserving = true;
        try { return await reserve(); } finally { reserving = false; }
      } };
      if (id.endsWith('/automationRecorderPlan')) return require('../../backend/lib/recording/automationRecorderPlan');
      throw new Error(`Unexpected recorder dependency ${id}`);
    },
    normalizeText: value => String(value || '').trim(), selectCaseWithScope: { get: async () => testCase },
    selectStepsForCase: { all: async () => [] }, resolveAutomationCaseSteps: () => ({ automation_case_type: 'web', steps: [], allowed_step_types: ['web'] }),
    resolveBuildContext: async () => ({}), resolveTestEngineIntegration: async () => ({ base_url: 'https://engine.example.test', config: {} }),
    isMobileAppType: () => false, isMobileRecorderTarget: () => false, resolveMobileEngineBaseUrl: () => '',
    resolveRecorderPublicBaseUrl: () => 'https://engine.example.test', buildEngineUrl: (base, value) => value ? new URL(value, base).toString() : null, summarizeStep: step => step,
    workspaceTransactionService: {
      createTransaction: async input => { assert.equal(reserving, true);calls.push('reserve');patches.push(input);return { id: 'activity' }; },
      updateTransaction: async (id, input) => {
        assert.equal(reserving, false);assert.equal(id, 'activity');calls.push('status');patches.push(input);
        if (receiptError && input.metadata?.current_phase === 'recorder.running') throw new Error('Receipt update unavailable');
        return { id, ...input };
      }
    },
    readEngineJson: async (url, init) => {
      assert.equal(reserving, false, 'Browser/device calls must not run inside admission transactions.');
      assert.equal(init.method, 'POST');
      if (url.endsWith('/stop')) { calls.push('stop');if (stopError) throw stopError;return { status: 'stopped' }; }
      calls.push('start');if (startError) throw startError;
      return { id: 'session', started_at: '2026-11-17T00:00:00Z' };
    }, appendEvent: async () => { calls.push('event'); }
  };
  createRecorderImport(ports);
  return { start: () => ports.exports.startRecorderSession({ test_case_id: 'case', created_by: 'author' }), calls, patches };
}

test('recorder startup rejects active build admission before starting a browser or reserving a second activity', async () => {
  const f = fixture({ busy: true });
  await assert.rejects(f.start(), { code: 'AUTOMATION_AUTHORING_BUSY' });
  assert.deepEqual(f.calls, ['admission']);
});

test('recorder startup reserves ownership before the engine POST and leaves the admission transaction before network work', async () => {
  const f = fixture(), result = await f.start();
  assert.deepEqual(f.calls, ['admission', 'reserve', 'start', 'status', 'event']);
  assert.equal(result.transaction_id, 'activity');assert.equal(result.id, 'session');
  assert.equal(f.patches[0].metadata.current_phase, 'recorder.starting');
  assert.equal(f.patches[1].metadata.current_phase, 'recorder.running');
});

test('definite recorder rejections release admission while an uncertain POST retains an explicit unknown reservation', async () => {
  for (const error of [Object.assign(new Error('Rejected'), { upstreamStatus: 403 }), Object.assign(new Error('Circuit'), { code: 'DEPENDENCY_CIRCUIT_OPEN' })]) {
    const f = fixture({ startError: error });await assert.rejects(f.start(), candidate => candidate === error);
    assert.equal(f.patches.at(-1).status, 'failed');assert.ok(f.patches.at(-1).completed_at);
  }
  const f = fixture({ startError: new Error('Transport acknowledgement lost') });
  await assert.rejects(f.start(), error => error.code === 'AUTOMATION_RECORDER_START_UNKNOWN' && error.nonRetryable === true && error.details.activity_id === 'activity');
  assert.equal(f.patches.at(-1).status, 'running');assert.equal(f.patches.at(-1).metadata.current_phase, 'recorder.start_unknown');
  assert.equal(f.calls.filter(value => value === 'start').length, 1);
});

test('an ownership receipt failure releases a confirmed stop but preserves ownership when stopping is uncertain', async () => {
  for (const stopError of [undefined, new Error('Stop acknowledgement lost')]) {
    const f = fixture({ receiptError: true, stopError });await assert.rejects(f.start(), /Receipt update unavailable/);
    assert.equal(f.calls.filter(value => value === 'stop').length, 1);
    assert.equal(f.patches.at(-1).status, stopError ? 'running' : 'failed');
    if (stopError) assert.equal(f.patches.at(-1).metadata.recorder_session_id, 'session');
  }
});
