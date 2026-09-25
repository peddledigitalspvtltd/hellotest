const { normalizeParameterLayer, normalizeParameterKey } = require('./stepParameterResolution');
const { collectCaseParameterNames } = require('./parameterNames');

function normalizeDataOptions(value = {}) {
  if (typeof value === 'string') { try { value = JSON.parse(value); } catch { value = {}; } }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Object.assign(new Error('Test data options must be an object.'), { statusCode: 400 });
  const result = {};
  for (const key of ['override_lower_scopes', 'override_shared_steps', 'override_test_case_data', 'override_suite_data']) {
    if (value[key] !== undefined && typeof value[key] !== 'boolean') throw Object.assign(new Error(`Test data option ${key} must be true or false.`), { statusCode: 400 });
    result[key] = value[key] === undefined && ['override_test_case_data', 'override_suite_data'].includes(key) ? value.override_lower_scopes !== false : value[key] !== false;
  }
  return result;
}

function sharedParameterNames(steps = []) {
  const shared = steps.filter(step => step.reusable_group_id || step.group_kind === 'reusable');
  return new Set(shared.flatMap(step => [...collectCaseParameterNames({ authoring_mode: /^\s*(Given|When|Then|And|But)\b/i.test(step.action || '') ? 'gherkin' : 'structured' }, [step]),
    ...Object.keys(step.shared_parameter_values || {}).map(key => normalizeParameterKey(key))]));
}

function dataRows(data, scope = 'r') {
  if (!data) return [];
  const rows = typeof data.rows === 'string' ? JSON.parse(data.rows) : data.rows || [];
  return data.mode === 'key_value'
    ? [normalizeParameterLayer(Object.fromEntries(rows.filter(row => row?.key).map(row => [row.key, row.value])), scope)]
    : rows.map(row => normalizeParameterLayer(row, scope));
}

function allowsDataParameter(name, scope, options, sharedNames = new Set()) {
  const key = normalizeParameterKey(name, scope);
  const normalized = normalizeDataOptions(options);
  return (normalized.override_test_case_data || !key.startsWith('t.'))
    && (scope !== 'r' || normalized.override_suite_data || !key.startsWith('s.'))
    && (normalized.override_shared_steps || !sharedNames.has(key));
}

// The highest selected scope drives iteration count. Scoped overrides align
// rows by position; a single lower row acts as defaults for every iteration.
// Reject mismatched multi-row sources rather than silently dropping rows or
// multiplying executions. The result is frozen and consumed by every engine.
function composeLegacyTestData({ caseData, suiteData, runData, caseOptions, suiteOptions, runOptions, sharedNames = new Set(), composeTemplates = true, composeShared = true }) {
  const normalizedCase = normalizeDataOptions(caseOptions);
  const normalizedRun = normalizeDataOptions(runOptions);
  if (runData && normalizedRun.override_lower_scopes && normalizedRun.override_shared_steps) return { snapshot: runData, source: 'run' };
  let selected = caseData || null;
  let rows = dataRows(caseData);
  let source = caseData ? 'test_case' : null;
  let changed = false;
  for (const [data, scope, rawOptions, sourceName] of [[suiteData, 's', suiteOptions, 'suite'], [runData, 'r', runOptions, 'run']]) {
    if (!data) continue;
    const options = normalizeDataOptions(rawOptions);
    // Legacy/default behavior is intentionally unchanged, including unscoped
    // column names. Suite templates now explicitly write their @s namespace.
    const incoming = dataRows(data);
    const retained = rows.map(row => Object.fromEntries(Object.entries(row).filter(([key]) =>
      !options.override_lower_scopes || (!options.override_shared_steps && sharedNames.has(key)))));
    const preserveRows = retained.some(row => Object.keys(row).length > 0);
    if (preserveRows && retained.length > 1 && retained.length !== incoming.length) {
      throw Object.assign(new Error(`${sourceName === 'run' ? 'Run' : 'Suite'} data has ${incoming.length} rows but inherited data has ${retained.length}. Use matching row counts or one inherited default row for scoped overrides.`), { statusCode: 422, code: 'TEST_DATA_ROW_MISMATCH' });
    }
    rows = incoming.map((row, index) => ({
      ...(preserveRows ? retained[retained.length === 1 ? 0 : index] : {}),
      ...Object.fromEntries(Object.entries(row).filter(([key]) => allowsDataParameter(key, scope, options, sharedNames)))
    }));
    changed ||= !options.override_lower_scopes || !options.override_shared_steps;
    selected = data; source = sourceName;
  }
  if (!selected) return { snapshot: null, source: null };
  if (composeShared && caseData && !normalizedCase.override_shared_steps && sharedNames.size) {
    const protectedRows = data => dataRows(data).map(row => Object.fromEntries(Object.entries(row).filter(([key]) => !sharedNames.has(key))));
    const protect = data => data ? { ...data, mode: 'table', rows: protectedRows(data),
      sensitive_names: data.sensitive_names || (data.mode === 'key_value' ? (data.rows || []).filter(row => row.is_secret).map(row => normalizeParameterKey(row.key)) : []),
      template_rows: data.template_rows ? protectedRows({ ...data, rows: data.template_rows }) : undefined } : null;
    const shared = composeLegacyTestData({ caseData: protect(caseData), suiteData, runData, suiteOptions, runOptions, sharedNames, composeShared: false });
    const ordinary = composeLegacyTestData({ caseData, suiteData, runData, suiteOptions, runOptions, sharedNames, composeTemplates, composeShared: false });
    return { snapshot: { ...ordinary.snapshot, shared_rows: dataRows(shared.snapshot),
      shared_template_rows: shared.snapshot?.template_rows ? dataRows({ ...shared.snapshot, rows: shared.snapshot.template_rows }) : undefined,
      sensitive_names: [...new Set([...(ordinary.snapshot.sensitive_names || []), ...(shared.snapshot?.sensitive_names || []), ...[caseData, suiteData, runData].flatMap(data => data?.mode === "key_value" ? (data.rows || []).filter(row => row.is_secret).map(row => normalizeParameterKey(row.key)) : [])])],
      data_scope_policy: { ...(ordinary.snapshot.data_scope_policy || {}), case: normalizedCase } }, source };
  }
  if (!changed) return { snapshot: selected, source };
  const sensitiveNames = [...new Set([caseData, suiteData, runData].flatMap(data => data?.sensitive_names || (data?.mode === "key_value" ? (data.rows || []).filter(row => row.is_secret).map(row => normalizeParameterKey(row.key)) : [])))];
  const columns = [...new Set(rows.flatMap(row => Object.keys(row)))].sort();
  const templates = data => data ? { ...data, rows: data.template_rows || data.rows, template_rows: undefined } : data;
  const templateRows = composeTemplates && [caseData, suiteData, runData].some(data => Array.isArray(data?.template_rows))
    ? composeLegacyTestData({ caseData: templates(caseData), suiteData: templates(suiteData), runData: templates(runData),
      caseOptions, suiteOptions, runOptions, sharedNames, composeTemplates: false, composeShared }).snapshot.rows : undefined;
  return { snapshot: { ...selected, mode: 'table', columns, rows, sensitive_names: sensitiveNames, template_rows: templateRows, data_scope_policy: {
    row_strategy: 'highest_scope', suite: normalizeDataOptions(suiteOptions), run: normalizeDataOptions(runOptions)
  } }, source };
}

// New runs freeze every supplying layer. This preserves absent lower columns,
// independent overrides, and group-specific defaults without a Cartesian product.
function composeScopedTestData(input) {
  const { caseData, suiteData, runData, caseOptions, suiteOptions, runOptions, sharedNames = new Set() } = input;
  if (!input.hierarchical) return composeLegacyTestData(input);
  const sources = [caseData, suiteData, runData];
  const selectedIndex = sources.findLastIndex(Boolean);
  if (selectedIndex < 0) return { snapshot: null, source: null };
  const selected = sources[selectedIndex];
  const layerRows = sources.map(data => dataRows(data));
  const iterations = Math.max(1, layerRows[selectedIndex].length);
  const policy = { version: 2, row_strategy: 'highest_scope', case: normalizeDataOptions(caseOptions), suite: normalizeDataOptions(suiteOptions), run: normalizeDataOptions(runOptions) };
  const names = new Set(sharedNames);
  const resolve = require('./stepParameterResolution').resolveParameterLayers;
  const caseNames = new Set(layerRows[0].flatMap(Object.keys));
  const retained = layerRows.map((rows, index) => rows.map(row => Object.fromEntries(Object.entries(row).filter(([key]) => {
    if (index === selectedIndex) return true;
    // Multirow sources matter only if at least one of their values survives.
    return !layerRows.slice(index + 1).some((higherRows, offset) => {
      const higherIndex = index + offset + 1;
      const options = higherIndex === 1 ? policy.suite : policy.run;
      const permitted = index === 0 ? options.override_test_case_data : options.override_suite_data;
      return higherRows.length && permitted
        && (options.override_test_case_data || !caseNames.has(key))
        && higherRows.every(candidate => Object.hasOwn(candidate, key))
        && allowsDataParameter(key, higherIndex === 1 ? 's' : 'r', options, names);
    });
  }))));
  retained.forEach((rows, index) => {
    if (index < selectedIndex && rows.length > 1 && rows.length !== iterations && rows.some(row => Object.keys(row).length)) {
      throw Object.assign(new Error(`Selected data has ${iterations} rows but inherited data has ${rows.length}. Use matching row counts or one inherited default row.`), { statusCode: 422, code: 'TEST_DATA_ROW_MISMATCH' });
    }
  });
  // Fully superseded rows cannot affect iteration values. Retaining one row
  // preserves parameter ownership for independent override checks at runtime.
  const layer = (data, rows) => data ? { rows: rows.length > 1 && rows.length !== iterations ? rows.slice(0, 1) : rows,
    template_rows: rows.length > 1 && rows.length !== iterations ? dataRows({ ...data, rows: data.template_rows || data.rows }).slice(0, 1) : dataRows({ ...data, rows: data.template_rows || data.rows }),
    sensitive_names: data.sensitive_names || (data.mode === 'key_value' ? (data.rows || []).filter(row => row.is_secret).map(row => normalizeParameterKey(row.key)) : []) } : null;
  const layers = Object.fromEntries(['case', 'suite', 'run'].map((name,index) => [name, layer(sources[index], layerRows[index], index)]));
  const base = { ...selected, mode: 'table', parameter_data_layers: layers, data_scope_policy: policy };
  const rows = Array.from({ length: iterations }, (_, rowIndex) => resolve({ dataSet: base, rowIndex }));
  const sharedRows = Array.from({ length: iterations }, (_, rowIndex) => resolve({ dataSet: base, rowIndex, isSharedStep: true, sharedValues: Object.fromEntries([...names].map(name => [name, ''])) }));
  // Actual shared defaults stay on each step; omitted shared cells fall back there.
  for (let i=0;i<sharedRows.length;i++) for (const key of names) if (sharedRows[i][key] === '' && !Object.hasOwn(rows[i],key)) delete sharedRows[i][key];
  return { snapshot: { ...base, columns: [...new Set(rows.flatMap(Object.keys))].sort(), rows, shared_rows: sharedRows,
    sensitive_names: [...new Set(Object.values(layers).flatMap(item => item?.sensitive_names || []))] }, source: ['test_case', 'suite', 'run'][selectedIndex] };
}

module.exports = { normalizeDataOptions, sharedParameterNames, allowsDataParameter, composeScopedTestData, dataRows };
