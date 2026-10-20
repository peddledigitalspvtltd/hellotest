const FLOW_PLANNING_READ_TOOLS = Object.freeze(['browser_navigate', 'browser_snapshot', 'browser_screenshot']);
const platformTypes = new Set(['web', 'api', 'android', 'ios']);

/** The host selects this phase. Its schema describes a proposal only; tool
 * permissions, arguments and browser results retain their separate authority. */
function createAutomationFlowPlanningProtocol({ allowedTypes = ['web'], toolNames = [] } = {}) {
  if (!Array.isArray(allowedTypes) || !allowedTypes.length || allowedTypes.length > 4 || new Set(allowedTypes).size !== allowedTypes.length || allowedTypes.some(type => !platformTypes.has(type))) {
    throw Object.assign(new Error('Manual-flow planning requires the application\'s allowed runtimes.'), { code: 'AUTOMATION_FLOW_PLAN_INVALID', statusCode: 422, nonRetryable: true });
  }
  const tools = FLOW_PLANNING_READ_TOOLS.filter(name => toolNames.includes(name));
  const plan = { type: 'object', additionalProperties: false, required: ['flow_steps'], properties: {
    flow_steps: { type: 'array', minItems: 1, maxItems: 40, items: { type: 'object', additionalProperties: false,
      required: ['action', 'expected_result', 'step_type'], properties: {
        action: { type: 'string', minLength: 1, maxLength: 3000 }, expected_result: { type: 'string', minLength: 1, maxLength: 3000 }, step_type: { type: 'string', enum: [...allowedTypes] }
      } } }
  } };
  const inspection = { type: 'object', additionalProperties: false, required: ['tool_calls'], properties: {
    tool_calls: { type: 'array', minItems: 1, maxItems: 4, items: { type: 'object', additionalProperties: false,
      required: ['name', 'arguments'], properties: { name: { type: 'string', enum: tools }, arguments: { type: 'object' } }
    } }
  } };
  return {
    phase: 'flow_plan',
    instructions: 'Return one JSON object matching the response_schema. Propose the requested ordered manual flow as flow_steps when the supplied evidence is sufficient. If a genuinely missing application fact requires inspection, return only tool_calls using the advertised read-only schemas; their results arrive before the next proposal. Never mix flow_steps with tool_calls. Do not return steps, automation_code, stage:act, completion claims or final case JSON. Browser inspection does not execute or verify the proposed manual flow. Preserve supplied parameter references and explicit empty inputs. Correct only the listed validation issue on a retry; do not repeat navigation or inspections just to reformat the same plan.',
    response_schema: tools.length ? { oneOf: [plan, inspection] } : plan
  };
}

module.exports = { FLOW_PLANNING_READ_TOOLS, createAutomationFlowPlanningProtocol };
