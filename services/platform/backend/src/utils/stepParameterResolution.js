// Scope identifies a namespace; the supplying layer decides precedence.
const normalizeParameterKey = (key, fallbackScope = "r") => {
  const source = String(key ?? "").trim().replace(/^@+/, "");
  if (!source) return "";
  const scoped = source.match(/^([tsr])\.(.+)$/i);
  const raw = (scoped ? scoped[2] : source).replace(/^\[((?:\\.|[^\]\\])+)\]$/, (_, name) => name.replace(/\\([\\\]])/g, "$1")).trim();
  return raw ? `${scoped ? scoped[1].toLowerCase() : fallbackScope}.${raw.toLowerCase()}` : "";
};

const normalizeParameterLayer = (values = {}, scope = "r") => Object.fromEntries(
  Object.entries(values || {}).flatMap(([key, value]) => {
    const name = normalizeParameterKey(key, scope);
    return name ? [[name, String(value ?? "")]] : [];
  })
);

const variableValues = (entries = []) => Object.fromEntries(entries.filter((entry) => entry?.key).map((entry) => [entry.key, entry.value]));

const dataSetParameterValues = (dataSet, rowIndex = 0) => {
  const rows = Array.isArray(dataSet?.rows) ? dataSet.rows : [];
  return normalizeParameterLayer(dataSet?.mode === "key_value"
    ? Object.fromEntries(rows.filter((row) => row?.key).map((row) => [row.key, row.value]))
    : rows[rowIndex] || {}, "r");
};

// Frozen values are never re-generated here. An absent cell does not override;
// a present empty cell does. The same order is used by frontend and Test Engine.
const resolveParameterLayers = ({ caseValues, suiteValues, environmentVariables, configurationVariables, runValues, dataSet, rowIndex = 0, capturedValues, sharedValues, isSharedStep = false, dataPolicy } = {}) => {
  const policy = dataPolicy || dataSet?.data_scope_policy;
  if (policy?.version === 2) return resolveHierarchicalLayers({ caseValues, suiteValues, environmentVariables, configurationVariables, runValues, dataSet, rowIndex, capturedValues, sharedValues, isSharedStep, policy });
  return ({
  ...normalizeParameterLayer(sharedValues, "r"),
  ...normalizeParameterLayer(caseValues, "r"),
  ...normalizeParameterLayer(suiteValues, "s"),
  ...normalizeParameterLayer(variableValues(environmentVariables), "r"),
  ...normalizeParameterLayer(variableValues(configurationVariables), "r"),
  ...normalizeParameterLayer(runValues, "r"),
  ...dataSetParameterValues(isSharedStep && Array.isArray(dataSet?.shared_rows) ? { ...dataSet, mode: "table", rows: dataSet.shared_rows } : dataSet, rowIndex),
  ...normalizeParameterLayer(capturedValues, "r")
});
};

// Runtime order belongs to the supplying layer, not the variable namespace.
function resolveHierarchicalLayers({ caseValues, suiteValues, environmentVariables, configurationVariables, runValues, dataSet, rowIndex, capturedValues, sharedValues, isSharedStep, policy }) {
  const layers = dataSet?.parameter_data_layers || {};
  const row = layer => { const rows = layers[layer]?.rows || []; return rows[rows.length === 1 ? 0 : rowIndex] || {}; };
  const shared = normalizeParameterLayer(sharedValues);
  const caseLayer = { ...normalizeParameterLayer(caseValues), ...row('case') };
  const suiteLayer = { ...normalizeParameterLayer(suiteValues, 's'), ...row('suite') };
  const runLayer = { ...normalizeParameterLayer(variableValues(environmentVariables)), ...normalizeParameterLayer(variableValues(configurationVariables)), ...normalizeParameterLayer(runValues), ...row('run') };
  const sharedKeys = new Set(Object.keys(shared));
  const caseKeys = new Set(Object.keys(caseLayer));
  const suiteKeys = new Set();
  const result = { ...shared };
  const apply = (values, options, scope) => {
    for (const [key,value] of Object.entries(values)) {
      if (isSharedStep && options?.override_shared_steps === false && sharedKeys.has(key)) continue;
      if (scope !== 'case' && options?.override_test_case_data === false && (key.startsWith('t.') || caseKeys.has(key)) && !(isSharedStep && sharedKeys.has(key) && policy.case?.override_shared_steps === false)) continue;
      if (scope === 'run' && options?.override_suite_data === false && (key.startsWith('s.') || suiteKeys.has(key))) continue;
      result[key] = value;
      if (scope === 'suite') suiteKeys.add(key);
    }
  };
  apply(caseLayer, policy.case, 'case');
  apply(suiteLayer, policy.suite, 'suite');
  apply(runLayer, policy.run, 'run');
  // Reviewed automation inputs are authored case overrides, not copies of
  // inherited defaults. Keep their exact values against selected source data.
  // A later explicit run input or captured output remains authoritative.
  const authored=normalizeParameterLayer(caseValues),explicitRun=normalizeParameterLayer(runValues);
  for(const name of policy.case?.parameter_overrides||[]){
    const key=normalizeParameterKey(name,'t');
    if(!Object.hasOwn(authored,key)||isSharedStep&&policy.case?.override_shared_steps===false&&sharedKeys.has(key))continue;
    result[key]=authored[key];
    if(Object.hasOwn(explicitRun,key)&&!(policy.run?.override_test_case_data===false&&(key.startsWith('t.')||caseKeys.has(key)))&&!(policy.run?.override_suite_data===false&&(key.startsWith('s.')||suiteKeys.has(key))))result[key]=explicitRun[key];
  }
  return { ...result, ...normalizeParameterLayer(capturedValues) };
}

const collectPriorParameterCaptures = (snapshots, currentCaseId, capturesByCaseId) => {
  const current = snapshots.find((snapshot) => snapshot.test_case_id === currentCaseId);
  if (!current) return {};
  const result = {};
  for (const snapshot of snapshots.filter((item) => item.test_case_id !== currentCaseId && Number(item.sort_order) < Number(current.sort_order)).sort((left, right) => Number(left.sort_order) - Number(right.sort_order))) {
    for (const [key, value] of Object.entries(normalizeParameterLayer(capturesByCaseId[snapshot.test_case_id]))) {
      if (key.startsWith("r.") || (key.startsWith("s.") && current.suite_id && snapshot.suite_id === current.suite_id)) result[key] = value;
    }
  }
  return result;
};

const matchesParameterIteration = (row, iteration = {}) => {
  const rowIndex = Number.isInteger(row?.data_set_iteration_index) ? row.data_set_iteration_index : null;
  const selectedIndex = Number.isInteger(iteration.data_set_iteration_index) ? iteration.data_set_iteration_index : null;
  return rowIndex === selectedIndex && (row?.test_data_set_id || null) === (iteration.test_data_set_id || null);
};

module.exports = { normalizeParameterKey, normalizeParameterLayer, dataSetParameterValues, resolveParameterLayers, collectPriorParameterCaptures, matchesParameterIteration };
