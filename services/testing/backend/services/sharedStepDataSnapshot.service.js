const db = require('@hellotest/platform/backend/src/db');
const { normalizeParameterLayer, dataSetParameterValues, normalizeParameterKey } = require('@hellotest/platform/backend/src/utils/stepParameterResolution');
const { materializeParameterValues } = require('@hellotest/platform/backend/src/utils/testDataGenerators');
const { placeholdersFor } = require('@hellotest/platform/backend/src/utils/batchHydration');

const parsed = (value, fallback) => typeof value === 'string' ? JSON.parse(value) : value || fallback;

// Resolve one row per reusable group, once when a new run freezes its steps.
// Values stay attached to each step so separate groups can use the same names.
async function freezeSharedStepData(steps, { materialize = true } = {}) {
  const ids = [...new Set(steps.map(step => step.reusable_group_id).filter(Boolean))];
  if (!ids.length) return steps;
  const groups = await db.prepare(`SELECT shared.id, shared.app_type_id, shared.parameter_values, shared.test_data_row_index,
      data.mode, data.rows
    FROM shared_step_groups shared JOIN app_types app ON app.id = shared.app_type_id
    LEFT JOIN test_data_sets data ON data.id = shared.test_data_set_id
      AND data.project_id = app.project_id AND (data.app_type_id IS NULL OR data.app_type_id = app.id)
    WHERE shared.id IN (${placeholdersFor(ids)})`).all(...ids);
  const defaults = new Map(groups.map(group => {
    const rows = parsed(group.rows, []);
    const templates = { ...normalizeParameterLayer(parsed(group.parameter_values, {})),
      ...dataSetParameterValues({ mode: group.mode, rows }, group.test_data_row_index || 0) };
    return [group.id, {
      app_type_id: group.app_type_id,
      shared_parameter_values: materialize ? materializeParameterValues(templates) : templates,
      shared_parameter_template_values: templates,
      shared_parameter_sensitive_names: group.mode === 'key_value' ? rows.filter(row => row.is_secret).map(row => normalizeParameterKey(row.key)).filter(Boolean) : []
    }];
  }));
  return steps.map(step => {
    const values = defaults.get(step.reusable_group_id);
    if (!values || (step.app_type_id && values.app_type_id !== step.app_type_id)) return step;
    const { app_type_id, ...frozen } = values;
    return { ...step, ...frozen };
  });
}

function redactSharedStepData(step) {
  const names = new Set(parsed(step.shared_parameter_sensitive_names, []));
  const redact = values => Object.fromEntries(Object.entries(parsed(values, {})).filter(([key]) => !names.has(normalizeParameterKey(key))));
  return { ...step, shared_parameter_values: redact(step.shared_parameter_values),
    shared_parameter_template_values: redact(step.shared_parameter_template_values), shared_parameter_sensitive_names: [...names] };
}

function regenerateSharedStepData(steps) {
  const generated = new Map();
  return steps.map(step => {
    const templates = parsed(step.shared_parameter_template_values || step.shared_parameter_values, {});
    const key = `${step.reusable_group_id || step.group_id || step.snapshot_step_id}:${JSON.stringify(templates)}`;
    if (!generated.has(key)) generated.set(key, materializeParameterValues(templates));
    return { ...step, shared_parameter_values: generated.get(key) };
  });
}

module.exports = { freezeSharedStepData, redactSharedStepData, regenerateSharedStepData };
