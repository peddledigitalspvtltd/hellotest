const db = require("@hellotest/platform/backend/src/db");
const { groupRows, placeholdersFor } = require("@hellotest/platform/backend/src/utils/batchHydration");

// Keep snapshot persistence separate from parameter generation and run lifecycle.
// The caller owns the transaction so every chunk rolls back with the run.
const BATCH_SIZE = 250;
const CASE_COLUMNS = [
  "execution_id", "test_case_id", "test_case_title", "test_case_description", "automated", "external_references",
  "suite_id", "suite_name", "module_id", "module_name", "priority", "status", "parameter_values",
  "parameter_template_values", "test_data_options", "execution_hooks", "suite_parameter_values", "suite_parameter_template_values",
  "test_data_set_id", "test_data_set_name", "test_data_set_snapshot", "data_set_source", "sort_order",
  "assigned_to", "assigned_to_ids", "assignment_source", "requirement_snapshots"
];
const STEP_COLUMNS = [
  "execution_id", "test_case_id", "snapshot_step_id", "step_order", "action", "expected_result",
  "step_type", "automation_code", "api_request", "group_id", "group_name", "group_kind", "reusable_group_id", "shared_parameter_values", "shared_parameter_template_values", "shared_parameter_sensitive_names"
];

const caseValues = (snapshot) => {
  const normalized = {
    ...snapshot,
    automated: snapshot.automated === 'yes' ? 'yes' : snapshot.automated === 'no' ? 'no' : null,
    external_references: snapshot.external_references || [],
    parameter_values: snapshot.parameter_values || {},
    test_data_options: snapshot.test_data_options || {},
    execution_hooks: snapshot.execution_hooks || [],
    parameter_template_values: snapshot.parameter_template_values || snapshot.parameter_values || {},
    suite_parameter_values: snapshot.suite_parameter_values || {},
    suite_parameter_template_values: snapshot.suite_parameter_template_values || snapshot.suite_parameter_values || {},
    test_data_set_id: snapshot.test_data_set_id || null,
    test_data_set_name: snapshot.test_data_set_name || null,
    test_data_set_snapshot: snapshot.test_data_set_snapshot || null,
    data_set_source: snapshot.data_set_source || null,
    assigned_to: snapshot.assigned_to || null,
    assigned_to_ids: snapshot.assigned_to_ids || (snapshot.assigned_to ? [snapshot.assigned_to] : []),
    assignment_source: snapshot.assignment_source || null,
    requirement_snapshots: snapshot.requirement_snapshots ?? null
  };
  return CASE_COLUMNS.map(column => normalized[column]);
};

async function insertRows(table, columns, rows, valuesFor) {
  const placeholders = `(${columns.map(() => "?").join(", ")})`;
  const rowBatchSize = Math.min(BATCH_SIZE, Math.floor(6000 / columns.length));
  for (let offset = 0; offset < rows.length; offset += rowBatchSize) {
    const chunk = rows.slice(offset, offset + rowBatchSize);
    await db.prepare(`INSERT INTO ${table} (${columns.join(", ")})
      VALUES ${chunk.map(() => placeholders).join(", ")}`)
      .run(...chunk.flatMap(valuesFor));
  }
}

async function freezeStoryLinks(caseSnapshots) {
  const fresh=caseSnapshots.filter(snapshot=>!Object.hasOwn(snapshot,'requirement_snapshots'));
  const byRun=groupRows(fresh,'execution_id');
  for(const [executionId,snapshots] of byRun){
    const ids=snapshots.map(snapshot=>snapshot.test_case_id);
    const links=await db.prepare(`WITH linked AS (
      SELECT mapping.test_case_id,mapping.requirement_id FROM requirement_test_cases mapping
      WHERE mapping.test_case_id IN (SELECT jsonb_array_elements_text(?::jsonb))
      UNION SELECT id,requirement_id FROM test_cases WHERE id IN (SELECT jsonb_array_elements_text(?::jsonb)) AND requirement_id IS NOT NULL
    ) SELECT linked.test_case_id,story.id,story.display_id,story.title FROM linked
      JOIN requirements story ON story.id=linked.requirement_id JOIN executions run ON run.id=? AND run.project_id=story.project_id
      ORDER BY linked.test_case_id,story.id`).all(ids,ids,executionId);
    const byCase=groupRows(links,'test_case_id');
    for(const snapshot of snapshots)snapshot.requirement_snapshots=(byCase.get(snapshot.test_case_id)||[]).map(({id,display_id,title})=>({id,display_id,title}));
  }
  return caseSnapshots;
}
async function persist({ caseSnapshots = [], stepSnapshots = [] }) {
  await freezeStoryLinks(caseSnapshots);
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
