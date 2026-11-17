const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../../../platform/backend/src/db');
const executions = require('../../backend/services/execution.service');

// Deleting a run that has recorded results is refused as a conflict the person can act on.
// It used to surface as an unexplained 500 INTERNAL_ERROR because a plain Error was thrown.
const withDatabase = (t, { hasResults }) => {
  const statements = [];
  t.mock.method(executions, 'getExecution', async id => ({ id }));
  t.mock.method(db, 'prepare', sql => ({
    get: async () => (/FROM execution_results/.test(sql) && hasResults ? { id: 'result-1' } : undefined),
    run: async (...values) => { statements.push({ sql: sql.replace(/\s+/g, ' ').trim(), values }); }
  }));
  return statements;
};

test('a run with results is refused with a 409 and guidance, and nothing is deleted', async t => {
  const statements = withDatabase(t, { hasResults: true });
  await assert.rejects(executions.deleteExecution('run-1'), error => {
    assert.equal(error.statusCode, 409, 'a conflict, not a server error');
    assert.equal(error.code, 'EXECUTION_HAS_RESULTS');
    assert.match(error.message, /recorded results/);
    assert.match(error.message, /Abort it/);
    return true;
  });
  assert.deepEqual(statements, [], 'no snapshot, suite or run row was touched');
});

test('a run without results is deleted together with its snapshots', async t => {
  const statements = withDatabase(t, { hasResults: false });
  assert.deepEqual(await executions.deleteExecution('run-2'), { deleted: true });
  assert.deepEqual(statements.map(entry => entry.sql.match(/DELETE FROM (\w+)/)[1]),
    ['execution_step_snapshots', 'execution_case_snapshots', 'execution_suites', 'executions']);
  assert.ok(statements.every(entry => entry.values[0] === 'run-2'));
});
