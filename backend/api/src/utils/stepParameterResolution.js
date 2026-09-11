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
const resolveParameterLayers = ({ caseValues, suiteValues, environmentVariables, configurationVariables, runValues, dataSet, rowIndex = 0, capturedValues } = {}) => ({
  ...normalizeParameterLayer(caseValues, "r"),
  ...normalizeParameterLayer(suiteValues, "s"),
  ...normalizeParameterLayer(variableValues(environmentVariables), "r"),
  ...normalizeParameterLayer(variableValues(configurationVariables), "r"),
  ...normalizeParameterLayer(runValues, "r"),
  ...dataSetParameterValues(dataSet, rowIndex),
  ...normalizeParameterLayer(capturedValues, "r")
});

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
