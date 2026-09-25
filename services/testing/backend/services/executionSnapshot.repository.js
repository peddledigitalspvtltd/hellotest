const db = require("@hellotest/platform/backend/src/db");
const { groupRows, placeholdersFor } = require("@hellotest/platform/backend/src/utils/batchHydration");

// Keep snapshot persistence separate from parameter generation and run lifecycle.
// The caller owns the transaction so every chunk rolls back with the run.
const BATCH_SIZE = 250;
const CASE_COLUMNS = [
  "execution_id", "test_case_id", "test_case_title", "test_case_description", "external_references",
  "suite_id", "suite_name", "module_id", "module_name", "priority", "status", "parameter_values",
  "parameter_template_values", "test_data_options", "suite_parameter_values", "suite_parameter_template_values",
  "test_data_set_id", "test_data_set_name", "test_data_set_snapshot", "data_set_source", "sort_order",
  "assigned_to", "assigned_to_ids", "assignment_source"
];
const STEP_COLUMNS = [
  "execution_id", "test_case_id", "snapshot_step_id", "step_order", "action", "expected_result",
  "step_type", "automation_code", "api_request", "group_id", "group_name", "group_kind", "reusable_group_id", "shared_parameter_values", "shared_parameter_template_values", "shared_parameter_sensitive_names"
];

const caseValues = (snapshot) => {
  const normalized = {
    ...snapshot,
    external_references: snapshot.external_references || [],
    parameter_values: snapshot.parameter_values || {},
    test_data_options: snapshot.test_data_options || {},
    parameter_template_values: snapshot.parameter_template_values || snapshot.parameter_values || {},
    suite_parameter_values: snapshot.suite_parameter_values || {},
    suite_parameter_template_values: snapshot.suite_parameter_template_values || snapshot.suite_parameter_values || {},
    test_data_set_id: snapshot.test_data_set_id || null,
    test_data_set_name: snapshot.test_data_set_name || null,
    test_data_set_snapshot: snapshot.test_data_set_snapshot || null,
    data_set_source: snapshot.data_set_source || null,
    assigned_to: snapshot.assigned_to || null,
    assigned_to_ids: snapshot.assigned_to_ids || (snapshot.assigned_to ? [snapshot.assigned_to] : []),
    assignment_source: snapshot.assignment_source || null
  };
  return CASE_COLUMNS.map(column => normalized[column]);
};

async function insertRows(table, columns, rows, valuesFor) {
  const placeholders = `(${columns.map(() => "?").join(", ")})`;
  for (let offset = 0; offset < rows.length; offset += BATCH_SIZE) {
    const chunk = rows.slice(offset, offset + BATCH_SIZE);
    await db.prepare(`INSERT INTO ${table} (${columns.join(", ")})
      VALUES ${chunk.map(() => placeholders).join(", ")}`)
      .run(...chunk.flatMap(valuesFor));
  }
}

async function persist({ caseSnapshots = [], stepSnapshots = [] }) {
  await insertRows("execution_case_snapshots", CASE_COLUMNS, caseSnapshots, caseValues);
  await insertRows("execution_step_snapshots", STEP_COLUMNS, stepSnapshots, snapshot => STEP_COLUMNS.map(column => snapshot[column] ?? (column === "shared_parameter_sensitive_names" ? [] : column.startsWith("shared_parameter_") ? {} : null)));
}

async function loadSteps(testCaseIds) {
  const ids = [...new Set(testCaseIds.filter(Boolean))];
  const rows = [];
  for (let offset = 0; offset < ids.length; offset += BATCH_SIZE) {
    const chunk = ids.slice(offset, offset + BATCH_SIZE);
    rows.push(...await db.prepare(`SELECT test_steps.test_case_id, test_steps.id, step_order, action, expected_result, step_type,
      automation_code, api_request, group_id, group_name, group_kind, reusable_group_id, test_cases.app_type_id
      FROM test_steps JOIN test_cases ON test_cases.id = test_steps.test_case_id WHERE test_case_id IN (${placeholdersFor(chunk)})
      ORDER BY test_case_id ASC, step_order ASC, test_steps.id ASC`).all(...chunk));
  }
  return groupRows(await require("./sharedStepDataSnapshot.service").freezeSharedStepData(rows), "test_case_id");
}

module.exports = { persist, loadSteps, BATCH_SIZE };
