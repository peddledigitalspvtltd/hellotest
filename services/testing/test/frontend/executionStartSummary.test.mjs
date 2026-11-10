import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeExecutionStart } from '../../frontend/lib/executionStartSummary.ts';

test('execution summaries describe local starts and remote handoffs with their respective counts', () => {
  const local = summarizeExecutionStart({ started: true, execution_mode: 'local', local_run_count: 1, queued_for_engine_count: 0 });
  assert.equal(local, 'Run started. 1 automated case started locally.');
  assert.doesNotMatch(local, /queued to Test Engine/);
  assert.equal(summarizeExecutionStart({ started: true, local_run_count: 3, manual_case_count: 1 }),
    'Run started. 3 automated cases started locally. 1 manual case ready in HelloTest.');
  assert.equal(summarizeExecutionStart({ started: true, execution_mode: 'remote', queued_for_engine_count: 2 }),
    'Run started. 2 automated cases queued to Test Engine.');
});

test('execution summaries retain dispatch warnings and avoid claiming rejected automation became manual', () => {
  const result = summarizeExecutionStart({ started: true, unsupported_automated_case_count: 1, warnings: ['A saved section has no executable code.'] });
  assert.equal(result, 'Run started. 1 automated case could not be dispatched. A saved section has no executable code.');
  assert.doesNotMatch(result, /kept manual|only web and API/);
  assert.equal(summarizeExecutionStart({ started: false }, 'Run saved.'), 'Run saved.');
});
