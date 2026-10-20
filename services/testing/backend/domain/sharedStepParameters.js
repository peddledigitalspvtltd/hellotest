const { normalizeParameterLayer, normalizeParameterKey } = require("@hellotest/platform/backend/src/utils/stepParameterResolution");
const { parseJsonValue } = require("@hellotest/platform/backend/src/utils/testStepAutomation");
const { collectCaseParameterNames } = require("@hellotest/platform/backend/src/utils/parameterNames");

const normalizeSharedParameterValues = (values) => values && typeof values === "object" && !Array.isArray(values)
  ? normalizeParameterLayer(values) : {};

const sharedSensitiveParameterNames = (dataSet, parameterValues = {}) => {
  if (dataSet?.mode !== "key_value") return [];
  const values = normalizeSharedParameterValues(parameterValues);
  const names = new Set([
    ...parseJsonValue(dataSet.rows, []).filter(row => row?.is_secret === true).map(row => row.key),
    ...parseJsonValue(dataSet.sensitive_parameter_names, [])
  ].map(name => normalizeParameterKey(name)).filter(Boolean));
  const privateValues = new Set(Object.entries(values).filter(([name, value]) => names.has(name) && value !== "").map(([, value]) => value));
  for (const [name, value] of Object.entries(values)) if (value !== "" && privateValues.has(value)) names.add(name);
  return [...names].sort();
};

const publicSharedParameterValues = (values, sensitiveNames) => {
  const hidden = new Set(sensitiveNames);
  return Object.fromEntries(Object.entries(normalizeSharedParameterValues(values)).filter(([key]) => !hidden.has(key)));
};

const mergeSharedParameterValues = ({ values, previousValues, previousSensitiveNames, nextSensitiveNames, referencedNames }) => {
  const previous = normalizeSharedParameterValues(previousValues);
  const next = values === undefined ? { ...previous } : normalizeSharedParameterValues(values);
  const stillPrivate = new Set(nextSensitiveNames);
  const supplied = normalizeSharedParameterValues(values);
  for (const name of previousSensitiveNames) {
    if (!Object.hasOwn(previous, name)) continue;
    if (referencedNames && !referencedNames.has(name) && !Object.hasOwn(supplied, name)) {
      // An explicit definition-and-parameters save removes obsolete defaults,
      // matching the ordinary parameter editor without requiring their value.
      delete next[name];
      continue;
    }
    if (stillPrivate.has(name)) {
      if (!Object.hasOwn(supplied, name)) next[name] = previous[name];
    } else if (previous[name] !== "" && (!Object.hasOwn(supplied, name) || supplied[name] !== "")) {
      // There is no stored group-specific privacy policy. Changing the linked
      // policy cannot make a previously hidden fallback public implicitly.
      throw Object.assign(new Error("Clear the hidden group default before unlinking or changing its private Test Data parameter. Save the empty default first, then change the data link."), {
        statusCode: 409, code: "SHARED_PARAMETER_PRIVACY_CONFLICT"
      });
    }
  }
  return next;
};

const referencedSharedParameterNames = ({ steps, authoring_mode, gherkin_document }) => new Set(collectCaseParameterNames({ authoring_mode, gherkin_document }, steps));

const sharedDefaultsFromCase = (testCase, steps) => {
  const options = parseJsonValue(testCase.test_data_options, {});
  const values = normalizeSharedParameterValues(parseJsonValue(testCase.parameter_values, {}));
  const referenced = new Set(collectCaseParameterNames({ authoring_mode: testCase.authoring_mode }, steps.map(step => ({ ...step, api_request: parseJsonValue(step.api_request, null) }))));
  const hidden = new Set((options.private_parameter_names || []).map(name => normalizeParameterKey(name, "t")));
  // Historical unscoped defaults resolve in the run namespace. A case-private
  // declaration still protects that legacy alias during library extraction.
  for (const key of Object.keys(parseJsonValue(testCase.parameter_values, {}))) {
    if (!/^@?[tsr]\./i.test(key.trim()) && hidden.has(normalizeParameterKey(key, "t"))) hidden.add(normalizeParameterKey(key));
  }
  for (const name of Object.keys(values)) if (/password|secret|token|credential|api.?key|passcode|(?:^|[._ -])pin(?:$|[._ -])|otp|verification.?code|one.?time.?code/i.test(name)) hidden.add(name);
  const secretValues = new Set(Object.entries(values).filter(([name]) => hidden.has(name)).map(([, value]) => value).filter(Boolean));
  // A shared library has no case-owned privacy policy. Carry only explicit,
  // referenced public defaults; private inputs stay unfilled for the caller.
  return Object.fromEntries(Object.entries(values).filter(([name, value]) => referenced.has(name) && !hidden.has(name) && !secretValues.has(value)));
};

module.exports = { normalizeSharedParameterValues, sharedSensitiveParameterNames, publicSharedParameterValues, mergeSharedParameterValues, referencedSharedParameterNames, sharedDefaultsFromCase };
