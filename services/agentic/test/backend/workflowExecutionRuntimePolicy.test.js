const test = require('node:test');
const assert = require('node:assert/strict');
const { executionRuntimePolicy, assertExecutionRuntime } = require('../../backend/workflows/executionRuntimePolicy');

test('production workflow execution requires Temporal or an explicit local-development opt in', () => {
  for (const env of [{ NODE_ENV: 'production', APP_MODE: 'aws' }, { NODE_ENV: 'production' }, { APP_MODE: 'docker' }, {}]) {
    assert.equal(executionRuntimePolicy({ env }).available, false);
    assert.throws(() => assertExecutionRuntime({ env }), { statusCode: 503, code: 'WORKFLOW_DURABLE_RUNTIME_REQUIRED' });
    assert.equal(executionRuntimePolicy({ env, durable: true }).mode, 'temporal');
  }
});

test('local, test and explicitly enabled development queues remain available without claiming durability', () => {
  for (const env of [{ APP_MODE: 'local' }, { NODE_ENV: 'test' }, { NODE_ENV: 'development' }, { NODE_ENV: 'production', WORKFLOW_ALLOW_LOCAL_FALLBACK: 'true' }]) {
    assert.deepEqual(assertExecutionRuntime({ env }), { available: true, mode: 'development_fifo', durable: false });
  }
  for (const value of ['false', '1', 'yes', '']) assert.equal(executionRuntimePolicy({ env: { WORKFLOW_ALLOW_LOCAL_FALLBACK: value } }).available, false);
});
