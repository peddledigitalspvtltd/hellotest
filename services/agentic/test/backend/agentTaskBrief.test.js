const test = require('node:test');
const assert = require('node:assert/strict');
const { suppliedTaskContext } = require('../../backend/services/agentTaskBrief');

test('successor task carryover cannot copy broader parent retrieval or computed authority', () => {
  const context = {
    workflow_input: [{ id: 'workflow', content: 'Unverified caller request', citation: { id: 'workflow', source_kind: 'workflow_input' } }],
    reviewed_context: [{ id: 'reviewed', content: 'Unverified user focus' }],
    knowledge: [{ id: 'parent-only', content: 'Source outside successor selection', citation: { id: 'parent-only', source_id: 'private-source' } }],
    live_project: [{ id: 'parent-native', content: 'Parent source with different permitted domains' }],
    quality_checks: [{ id: 'parent-checks', content: 'Earlier computed assessment' }],
    case_intent: [{ id: 'parent-case', content: 'Native case must be independently authorized' }]
  };
  const carried = suppliedTaskContext(context);
  assert.deepEqual(Object.keys(carried), ['workflow_input', 'reviewed_context']);
  assert.deepEqual(carried.workflow_input, context.workflow_input);
  assert.notEqual(carried.workflow_input[0], context.workflow_input[0]);
  assert.equal(Object.values(carried).flat().some(item => item.citation?.source_id), false);
});
