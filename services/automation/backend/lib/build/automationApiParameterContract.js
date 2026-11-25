const { collectCaseParameterNames, tokenFor } = require('@hellotest/platform/backend/src/utils/parameterNames');
const { normalizeParameterKey } = require('@hellotest/platform/backend/src/utils/stepParameterResolution');
const { parseJsonValue } = require('@hellotest/platform/backend/src/utils/testStepAutomation');

function references(value, { scopedOnly = false } = {}) {
  const names = new Set();
  const visit = item => {
    if (typeof item === 'string') for (const name of collectCaseParameterNames({}, [{action:item}], {scopedOnly})) names.add(name);
    else if (Array.isArray(item)) item.forEach(visit);
    else if (item && typeof item === 'object') Object.values(item).forEach(visit);
  };
  visit(value);
  return names;
}

function authoredBindings(value, supplied, structured) {
  const bindings = structured ? references(value, { scopedOnly: true }) : new Set();
  for (const name of references(value)) if (supplied.has(name)) bindings.add(name);
  return bindings;
}

function apiParameterBindingContext(step, parameterValues) {
  const supplied = new Set(Object.keys(parameterValues || {}).map(name=>normalizeParameterKey(name,'t')));
  const bound = (value, structured = false) => [...authoredBindings(value, supplied, structured)].map(tokenFor).sort();
  const request = parseJsonValue(step.api_request, {}) || {};
  return { action:bound(step.action), expected_result:bound(step.expected_result), api_request:{
    url:bound(request.url,true),body:bound(request.body,true),authentication_headers_query_cookies:bound({headers:request.headers,query_params:request.query_params,cookies:request.cookies,auth:request.auth},true)
  } };
}

/** Require source-owned input references on their corresponding executable
 * surfaces. A current literal value cannot replace a mutable test binding. */
function assertApiParameterBindings(step, request, parameterValues) {
  const supplied = new Set(Object.keys(parameterValues || {}).map(name=>normalizeParameterKey(name,'t')));
  const original = parseJsonValue(step.api_request, {}) || {};
  const headerContext = value => ({headers:value.headers,query_params:value.query_params,cookies:value.cookies,auth:value.auth});
  const groups = [
    ['URL', original.url, request.url, true],
    ['body', original.body, request.body, true],
    ['authentication, headers, query or cookies', headerContext(original), headerContext(request), true],
    ['request action', step.action, request],
    ['expected-result assertions', step.expected_result, request.validations]
  ];
  const missing = [];
  for (const [field, source, output, structured] of groups) {
    const actual = references(output);
    const explicitInputs = structured ? references(source, {scopedOnly:true}) : new Set();
    const explicitOutput = explicitInputs.size ? references(output, {scopedOnly:true}) : new Set();
    for (const name of authoredBindings(source, supplied, structured)) {
      if (!(explicitInputs.has(name) ? explicitOutput : actual).has(name)) missing.push({field,parameter_reference:tokenFor(name)});
    }
  }
  if (!missing.length) return;
  throw Object.assign(new Error(`Step ${step.step_order || 1} dropped mutable test parameter bindings. Preserve ${missing.map(item=>`${item.parameter_reference} in ${item.field}`).join('; ')}. Use the exact scoped references instead of their current literal values.`), {
    statusCode:422,code:'AUTOMATION_API_PARAMETER_BINDING_DROPPED',missing_parameter_bindings:missing
  });
}

module.exports = { assertApiParameterBindings, apiParameterBindingContext };
