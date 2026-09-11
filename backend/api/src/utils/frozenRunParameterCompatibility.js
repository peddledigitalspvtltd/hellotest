const { normalizeParameterLayer, normalizeParameterKey } = require("./stepParameterResolution");
const REFERENCE = /(?<![A-Za-z0-9_])@(?:(t|s|r)\.)?(\[(?:\\.|[^\]\\\r\n])+\]|[A-Za-z][A-Za-z0-9_-]*)/gi;

function qualifyLegacyText(value, gherkin = false) {
  if (typeof value !== "string") return value;
  return value.split("\n").map(line => {
    if (gherkin && /^\s*[@#]/.test(line)) return line;
    const source = gherkin ? line.replace(/<([A-Za-z][A-Za-z0-9_.-]*)>/g, (token, name) => /^[tsr]\./i.test(name) ? token : `<t.${name}>`) : line;
    return source.replace(REFERENCE, (token, scope, name, offset, text) => scope || (/^[tsr]$/i.test(name) && text[offset + token.length] === ".") ? token : `@t.${name}`);
  }).join("\n");
}

function canonicalLegacyData(snapshot) {
  if (!snapshot) return snapshot;
  const convert = rows => (rows || []).map(row => snapshot.mode === "key_value" ? { ...row, key: normalizeParameterKey(row.key, "t") }
    : Object.fromEntries(Object.entries(row || {}).map(([key, value]) => [normalizeParameterKey(key, "t"), value])));
  return { ...snapshot, columns: snapshot.mode === "key_value" ? snapshot.columns : (snapshot.columns || []).map(key => normalizeParameterKey(key, "t")),
    rows: convert(snapshot.rows), ...(snapshot.template_rows ? { template_rows: convert(snapshot.template_rows) } : {}) };
}

// Captures persisted before the default changed may still have bare keys. They
// belonged to the test namespace and must never become run-wide exports. Keep
// newer explicitly scoped captures authoritative when old/raw aliases coexist.
function normalizeFrozenCapturedValues(values, defaultScope = "r") {
  if (defaultScope !== "t") return normalizeParameterLayer(values, "r");
  const entries = Object.entries(values || {});
  const scoped = key => /^@*[tsr]\./i.test(String(key).trim());
  return { ...normalizeParameterLayer(Object.fromEntries(entries.filter(([key]) => !scoped(key))), "t"),
    ...normalizeParameterLayer(Object.fromEntries(entries.filter(([key]) => scoped(key))), "t") };
}

function qualifyLegacyApi(api) {
  return api ? { ...api, url: qualifyLegacyText(api.url), body: qualifyLegacyText(api.body),
    headers: (api.headers || []).map(row => ({ ...row, key: qualifyLegacyText(row.key), value: qualifyLegacyText(row.value) })),
    validations: (api.validations || []).map(row => ({ ...row, target: qualifyLegacyText(row.target), expected: qualifyLegacyText(row.expected) })),
    captures: (api.captures || []).map(row => ({ ...row, parameter: `@${normalizeParameterKey(row.parameter, "t")}` })) } : api;
}

function preserveFrozenEngineEnvelope(envelope, defaultScope) {
  if (!envelope || defaultScope !== "t") return envelope;
  const convertSteps = steps => {
    const gherkin = (steps || []).some(step => /^\s*(Given|When|Then|And|But)\b/i.test(step.action || ""));
    return (steps || []).map(step => ({ ...step, action: qualifyLegacyText(step.action, gherkin),
      expected_result: qualifyLegacyText(step.expected_result, gherkin), automation_code: qualifyLegacyText(step.automation_code), api_request: qualifyLegacyApi(step.api_request) }));
  };
  const manual = envelope.manual_spec;
  return { ...envelope, parameter_scope_default: "t",
    case_parameters: normalizeParameterLayer(envelope.case_parameters, "t"),
    suite_parameters: normalizeParameterLayer(envelope.suite_parameters, "s"),
    data_set: canonicalLegacyData(envelope.data_set), steps: convertSteps(envelope.steps),
    hooks: (envelope.hooks || []).map(hook => ({ ...hook, steps: convertSteps(hook.steps) })),
    manual_spec: manual ? { ...manual, title: qualifyLegacyText(manual.title), intent: qualifyLegacyText(manual.intent),
      preconditions: (manual.preconditions || []).map(value => qualifyLegacyText(value)),
      steps: (manual.steps || []).map(value => qualifyLegacyText(value, true)),
      assertions: (manual.assertions || []).map(value => qualifyLegacyText(value, true)),
      detailed_steps: convertSteps(manual.detailed_steps), test_data: normalizeParameterLayer(manual.test_data, "t") } : manual };
}

// Existing runs are marked 't' by migration. New runs use 'r'. Canonicalize a
// legacy read in memory only: frozen database evidence and authoring stay intact.
function preserveFrozenRunParameters(execution) {
  if (!execution || execution.parameter_scope_default !== "t") return execution;
  const steps = execution.step_snapshots || [];
  const gherkinCases = new Set(steps.filter(step => /^\s*(Given|When|Then|And|But)\b/i.test(step.action || "")).map(step => step.test_case_id));
  return { ...execution,
    test_data_set: execution.test_data_set ? { ...execution.test_data_set, snapshot: canonicalLegacyData(execution.test_data_set.snapshot) } : execution.test_data_set,
    test_data_set_snapshot: canonicalLegacyData(execution.test_data_set_snapshot),
    case_snapshots: (execution.case_snapshots || []).map(row => ({ ...row,
      test_case_title: qualifyLegacyText(row.test_case_title, gherkinCases.has(row.test_case_id)),
      parameter_values: normalizeParameterLayer(row.parameter_values, "t"), parameter_template_values: normalizeParameterLayer(row.parameter_template_values, "t"),
      suite_parameter_values: normalizeParameterLayer(row.suite_parameter_values, "s"), suite_parameter_template_values: normalizeParameterLayer(row.suite_parameter_template_values, "s"),
      test_data_set_snapshot: canonicalLegacyData(row.test_data_set_snapshot) })),
    step_snapshots: steps.map(step => ({ ...step, action: qualifyLegacyText(step.action, gherkinCases.has(step.test_case_id)),
      expected_result: qualifyLegacyText(step.expected_result, gherkinCases.has(step.test_case_id)), automation_code: qualifyLegacyText(step.automation_code), api_request: qualifyLegacyApi(step.api_request) }))
  };
}

module.exports = { preserveFrozenRunParameters, preserveFrozenEngineEnvelope, normalizeFrozenCapturedValues, canonicalLegacyData, qualifyLegacyText };
