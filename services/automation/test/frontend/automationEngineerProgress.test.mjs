import test from 'node:test';
import assert from 'node:assert/strict';
import { engineerProgressFrontier } from '../../frontend/lib/automationEngineerProgress.ts';

test('live progression requires performed, generated and durably saved completion before revealing the next step', () => {
  const pending = { instruction_status: 'pending' };
  for (const current of [
    { instruction_status: 'requested' },
    { instruction_status: 'validated', development_status: 'completed' },
    { instruction_status: 'saved' },
    { instruction_status: 'saved', development_status: 'in_progress' }
  ]) assert.equal(engineerProgressFrontier([current, pending], true), 0);
  assert.equal(engineerProgressFrontier([{ instruction_status: 'saved', development_status: 'completed' }, pending], true), 1);
});

test('an out-of-order cursor or later saved receipt cannot bypass an unfinished earlier step', () => {
  const done = { instruction_status: 'saved', development_status: 'completed' };
  assert.equal(engineerProgressFrontier([{ instruction_status: 'requested' }, done, done], true), 0);
  assert.equal(engineerProgressFrontier([done, { instruction_status: 'validated' }, done], true), 1);
  assert.equal(engineerProgressFrontier([done, done, done], true), 2);
  assert.equal(engineerProgressFrontier([], true), 0);
});

test('legacy saved history remains navigable while validated-only legacy drafts do not unlock the next step', () => {
  assert.equal(engineerProgressFrontier([{ instruction_status: 'saved' }, {}], false), 1);
  assert.equal(engineerProgressFrontier([{ instruction_status: 'validated_not_saved' }, {}], false), 0);
});
