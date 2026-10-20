const { toolArgumentIssues } = require('@hellotest/platform/backend/src/utils/toolArgumentValidation');
const { browserReceipt } = require('./automationInteractiveEvidence');

const textEntryTypes = new Set(['', 'text', 'search', 'email', 'password', 'tel', 'url', 'number', 'date', 'datetime-local', 'month', 'week', 'time']);

function isNativeTextEntryControl(element) {
  const tag = typeof element?.tag === 'string' ? element.tag.toLowerCase() : '';
  if (tag === 'textarea') return true;
  if (tag !== 'input' || element.truncated_attributes?.includes('type')) return false;
  const type = element.attributes?.type;
  return (type === undefined || typeof type === 'string') && textEntryTypes.has((type || '').toLowerCase());
}

function advertisesValueMode(schema, depth = 0) {
  if (!schema || typeof schema !== 'object' || depth > 12) return false;
  const rule = schema.properties?.assertion;
  if (rule?.const === 'value' || Array.isArray(rule?.enum) && rule.enum.includes('value')) return true;
  return ['allOf', 'anyOf', 'oneOf'].some(key => Array.isArray(schema[key]) && schema[key].some(item => advertisesValueMode(item, depth + 1)));
}

function valueContract(inputSchema, request) {
  if (!advertisesValueMode(inputSchema)) return undefined;
  // Discovery remains authoritative. Probe the advertised mode without changing
  // or executing the real request; derive its required fields from validation.
  const probe = { assertion: 'value', locator: request.arguments.locator, value: request.arguments.value };
  if (toolArgumentIssues(inputSchema, probe).length) return undefined;
  const required = Object.keys(probe).filter(field => {
    const omitted = { ...probe };delete omitted[field];
    return toolArgumentIssues(inputSchema, omitted).some(issue => issue.missing_property === field);
  });
  return { assertion: 'value', required_arguments: required };
}

/** Positive UI-text predicates cannot check entered native input content. This
 * correction chooses no value, rewrites no predicate, and proves no outcome.
 * Explicit DOM text_content predicates remain available for default/child text. */
function browserAssertionSubjectFeedback({ request, snapshot, inputSchema, stepId } = {}) {
  const args = request?.arguments;
  if (request?.name !== 'browser_assert' || !['text', 'text_contains'].includes(args?.assertion)
    || typeof args.value !== 'string' || typeof args.locator !== 'string'
    || snapshot?.tool !== 'browser_snapshot' || snapshot.result?.isError) return null;
  const page = browserReceipt(snapshot);
  const matches = Array.isArray(page?.elements) ? page.elements.filter(element => element?.locators_validated === true
    && Array.isArray(element.locator_candidates) && element.locator_candidates.includes(args.locator)) : [];
  if (matches.length !== 1 || !isNativeTextEntryControl(matches[0])) return null;
  const target = matches[0], contract = valueContract(inputSchema, request);
  return {
    code: 'AUTOMATION_BROWSER_ASSERTION_SUBJECT_MISMATCH', step_id: stepId, tool: 'browser_assert',
    assertion_subject: 'input_value', attempted_assertion: args.assertion,
    observed_target: { tag: target.tag.toLowerCase(), ...(typeof target.attributes?.type === 'string' ? { input_type: target.attributes.type.slice(0, 30) } : {}) },
    ...(contract ? { value_assertion_contract: contract } : {}),
    action_outcome: 'not_attempted', retry_safe: true,
    remaining_contract: 'check_the_native_control_value_with_the_discovered_schema_and_original_task_data',
    message: 'The current target is a native text-entry control. Its entered content is its value; text and text_contains inspect visible inner text and do not verify that entered value. No assertion was attempted. '
      + (contract ? 'Choose the advertised value assertion using the original configured data or exact parameter reference, and retain every other expected-result clause. '
        : 'Use only a native-value check supported by the discovered schema, or report that this check is unavailable; retain every expected-result clause. ')
      + 'Do not repeat the completed fill. Explicit text_content checks for DOM/default text keep their separate meaning.'
  };
}

module.exports = { browserAssertionSubjectFeedback, isNativeTextEntryControl };
