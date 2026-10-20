const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeSharedSteps, sharedStepsWithIds, reconcileSharedStepIds, sharedStepsFromReference } = require('../../backend/domain/sharedStepDefinition');

test('shared step definitions preserve legacy aliases, code and API content while ordering usable steps', () => {
  const input = [
    { step_order: 9, action: ' Send request ', stepType: 'api', apiRequest: { url: 'https://example.test', method: 'post' } },
    { step_order: 2, expectedResult: ' Receipt appears ', automationCode: '  click()\r\n  verify()\r\n' },
    null, { action: ' ' }
  ];
  const before = structuredClone(input);
  const steps = normalizeSharedSteps(input);
  assert.deepEqual(input, before);
  assert.deepEqual(steps.map(step => step.step_order), [1, 2]);
  assert.equal(steps[0].expected_result, 'Receipt appears');
  assert.equal(steps[0].automation_code, '  click()\n  verify()\n');
  assert.equal(steps[0].step_type, 'web');
  assert.equal(steps[1].action, 'Send request');
  assert.equal(steps[1].step_type, 'api');
  assert.equal(steps[1].api_request.method, 'POST');
  assert.equal(steps[1].api_request.url, 'https://example.test');
  for (const malformed of [null, undefined, {}, 'steps']) assert.deepEqual(normalizeSharedSteps(malformed), []);
});

test('shared sections retain group-owned identity across legacy hydration, reorder and new drafts', () => {
  const source = [{ action: 'Open sign in' }, { action: 'Enter credentials' }];
  const existing = sharedStepsWithIds(source, 'group');
  assert.deepEqual(sharedStepsWithIds(source, 'group'), existing);
  assert.notEqual(sharedStepsWithIds(source, 'other-group')[0].id, existing[0].id);
  const reordered = reconcileSharedStepIds([{ ...existing[1], step_order: 1 }, { id: 'local-draft', action: 'Submit', step_order: 2 }, { ...existing[0], step_order: 3 }], existing, 'group');
  assert.equal(reordered[0].id, existing[1].id);
  assert.equal(reordered[2].id, existing[0].id);
  assert.notEqual(reordered[1].id, 'local-draft');
  assert.equal(new Set(reordered.map(step => step.id)).size, 3);
  assert.throws(() => reconcileSharedStepIds([{ ...existing[0], step_order: 1 }, { ...existing[0], step_order: 2 }], existing, 'group'), { code: 'SHARED_SECTION_ID_DUPLICATE' });
  assert.deepEqual(source, [{ action: 'Open sign in' }, { action: 'Enter credentials' }]);
});

test('reference synchronization uses the previous row identity and preserves legacy exact matches', () => {
  const previous = sharedStepsWithIds([{ action: 'First' }, { action: 'Second' }], 'group');
  const rows = [{ id: 'case-first', action: 'First' }, { id: 'case-second', action: 'Second' }];
  const current = [{ id: 'case-second', action: 'Edited second', step_order: 1 }, { id: 'case-first', action: 'First', step_order: 2 }];
  const resolved = sharedStepsFromReference(current, previous, 'group', rows);
  assert.deepEqual(resolved.map(step => step.id), [previous[1].id, previous[0].id]);
  const legacy = sharedStepsFromReference([{ action: 'Second', step_order: 1 }, { action: 'First', step_order: 2 }], previous, 'group');
  assert.deepEqual(legacy.map(step => step.id), [previous[1].id, previous[0].id]);
});
