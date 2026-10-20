const { parameterReference, referenceKey } = require('./automationBrowserParameters');
const { validateAutomationParameterBindings } = require('./automationParameterBindings');
const { browserReceipt } = require('./automationInteractiveEvidence');
const { isNativeTextEntryControl } = require('./automationBrowserAssertionSubject');
const { recordedSectionRequests } = require('./automationBrowserRecording');
const { isNavigationPrerequisite } = require('./automationActionReconciliation');

const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const invalid = () => Object.assign(new Error('The current input could not be bound to its original manual parameters.'), {
  code: 'AUTOMATION_INPUT_PARAMETER_BINDING_INVALID', statusCode: 422, nonRetryable: true
});

/** Bind inputs from original active-obligation provenance, never a global
 * reverse-value lookup. Values remain host-private and are frozen per build. */
function createAutomationInputParameterBinding({ stepId, obligations, bindings, parameterValues, privateParameterNames = [] } = {}) {
  if (typeof stepId !== 'string' || !stepId || !Array.isArray(obligations) || !obligations.some(row => row?.id === stepId && row.source === 'section')
    || new Set(obligations.map(row => row?.id)).size !== obligations.length || !record(parameterValues)
    || !Array.isArray(privateParameterNames) || privateParameterNames.some(name => typeof name !== 'string')) throw invalid();
  let selected;
  try { selected = validateAutomationParameterBindings({ bindings, obligations, values: parameterValues }); }
  catch { throw invalid(); }
  const privateNames = new Set(privateParameterNames), publicValues = new Map();
  const actionNames = new Set(selected.flatMap(row => row.action_parameters));
  const expectedNames = new Set(selected.flatMap(row => row.action_parameters.filter(name => row.expected_result_parameters.includes(name))));
  for (const name of actionNames) if (!privateNames.has(name) && typeof parameterValues[name] === 'string') publicValues.set(name, parameterValues[name]);
  const bind = (request, name) => ({ ...request, arguments: { ...request.arguments, value: parameterReference(name) } });

  function canonicalize(request, { snapshot, observations = [] } = {}) {
    const args = request?.arguments;
    if (!record(args) || typeof args.value !== 'string' || args.value.length > 2000 || referenceKey(args.value)
      || typeof args.locator !== 'string' || (!['browser_fill', 'browser_select_option'].includes(request.name) && !(request.name === 'browser_assert' && args.assertion === 'value'))
      || snapshot?.tool !== 'browser_snapshot' || snapshot.result?.isError) return request;
    const page = browserReceipt(snapshot);
    const matches = Array.isArray(page?.elements) ? page.elements.filter(element => element?.locators_validated === true
      && Array.isArray(element.locator_candidates) && element.locator_candidates.includes(args.locator)) : [];
    if (matches.length !== 1) return request;
    const select = String(matches[0].tag || '').toLowerCase() === 'select';
    const inputTool = select ? 'browser_select_option' : 'browser_fill';
    if ((!select && !isNativeTextEntryControl(matches[0])) || (request.name !== 'browser_assert' && request.name !== inputTool)) return request;

    if (request.name === inputTool) {
      const names = [...publicValues].filter(([, value]) => value === args.value).map(([name]) => name);
      return names.length === 1 ? bind(request, names[0]) : request;
    }

    // A content oracle can vary only with an explicitly authored expected-result
    // binding and that same field's latest actual fill/selection. Generic
    // outcome prose, proposed inputs, copied receipts and another field supply
    // no such grant. An old textbox fill cannot bind a newly rendered select.
    if (!Array.isArray(observations)) return request;
    const transition = observations.findLastIndex(isNavigationPrerequisite);
    const recorded = recordedSectionRequests(observations.slice(transition + 1), stepId);
    const navigation = recorded.findLastIndex(operation => operation.name === 'browser_navigate');
    const aliases = new Set(matches[0].locator_candidates);
    const input = recorded.slice(navigation + 1).findLast(operation => operation.name === inputTool && aliases.has(operation.arguments.locator));
    const name = input ? referenceKey(input.arguments.value) : null;
    return name && expectedNames.has(name) && publicValues.has(name) && publicValues.get(name) === args.value ? bind(request, name) : request;
  }
  return Object.freeze({ canonicalize });
}

module.exports = { createAutomationInputParameterBinding };
