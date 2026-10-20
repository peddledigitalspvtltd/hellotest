const test = require('node:test');
const assert = require('node:assert/strict');
const { FLOW_PLANNING_READ_TOOLS, createAutomationFlowPlanningProtocol } = require('../../backend/lib/automationFlowPlanningProtocol');

test('planner schema separates manual proposals from discovered read-only inspection requests', () => {
  const protocol = createAutomationFlowPlanningProtocol({ allowedTypes: ['web', 'api'], toolNames: ['browser_snapshot', 'browser_fill', 'browser_navigate'] });
  assert.equal(protocol.phase, 'flow_plan');
  const [plan, inspection] = protocol.response_schema.oneOf;
  assert.deepEqual(plan.required, ['flow_steps']);
  assert.deepEqual(plan.properties.flow_steps.items.properties.step_type.enum, ['web', 'api']);
  assert.equal(plan.properties.flow_steps.maxItems, 40);
  assert.deepEqual(inspection.required, ['tool_calls']);
  assert.deepEqual(inspection.properties.tool_calls.items.properties.name.enum, ['browser_navigate', 'browser_snapshot']);
  assert.equal(inspection.properties.tool_calls.maxItems, 4);
  assert.equal(plan.additionalProperties, false); assert.equal(inspection.additionalProperties, false);
  assert.match(protocol.instructions, /Never mix flow_steps with tool_calls/);
  assert.match(protocol.instructions, /Do not return steps, automation_code/);
  assert.doesNotMatch(JSON.stringify(protocol.response_schema), /browser_fill|browser_click/);
  assert.ok(FLOW_PLANNING_READ_TOOLS.every(name => name !== 'browser_fill'));
});

test('planning without browser discovery advertises only the manual-flow proposal schema', () => {
  const protocol = createAutomationFlowPlanningProtocol();
  assert.deepEqual(protocol.response_schema.required, ['flow_steps']);
  assert.equal(protocol.response_schema.oneOf, undefined);
  assert.equal(protocol.response_schema.properties.tool_calls, undefined);
});

test('invalid allowed runtimes fail before inference and each returned schema is isolated', () => {
  for (const allowedTypes of [[], ['unknown'], ['web', 'web'], 'web']) {
    assert.throws(() => createAutomationFlowPlanningProtocol({ allowedTypes }), error => error.code === 'AUTOMATION_FLOW_PLAN_INVALID' && error.nonRetryable === true);
  }
  const first = createAutomationFlowPlanningProtocol();
  first.response_schema.properties.flow_steps.items.properties.step_type.enum.push('invented');
  assert.deepEqual(createAutomationFlowPlanningProtocol().response_schema.properties.flow_steps.items.properties.step_type.enum, ['web']);
});
