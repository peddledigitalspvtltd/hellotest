const db=require('@hellotest/platform/backend/src/db');
const {placeholdersFor,groupRows}=require('@hellotest/platform/backend/src/utils/batchHydration');
async function loadExecutionMetrics(executionIds, summarizeExecutionMetrics) {
  if (!executionIds.length) return new Map();
  const placeholders = placeholdersFor(executionIds);
  const [caseRows, resultRows, storyRows, defectRows] = await Promise.all([
    db.prepare(`SELECT execution_id, test_case_id,
      CASE WHEN test_data_set_snapshot->>'mode' = 'key_value' OR jsonb_typeof(test_data_set_snapshot->'rows') IS DISTINCT FROM 'array'
        THEN 1 ELSE GREATEST(1, jsonb_array_length(test_data_set_snapshot->'rows')) END AS expected_iterations
      FROM execution_case_snapshots WHERE execution_id IN (${placeholders})`).all(...executionIds),
    db.prepare(`SELECT id, execution_id, test_case_id, status, defects, case_defects, step_defects,derived,covers_entire_case,
      data_set_iteration_index, data_set_iteration_key, created_at, duration_ms, timer_started_at FROM test_case_effective_results result
      WHERE execution_id IN (${placeholders}) AND (NOT derived OR EXISTS(SELECT 1 FROM execution_case_snapshots selected WHERE selected.execution_id=result.execution_id AND selected.test_case_id=result.test_case_id))`).all(...executionIds),
    db.prepare(`WITH run_cases AS (
        SELECT execution_id, test_case_id FROM execution_case_snapshots WHERE execution_id IN (${placeholders})
        UNION SELECT execution_id, test_case_id FROM execution_results WHERE execution_id IN (${placeholders})
      ), scoped_cases AS (SELECT DISTINCT test_case_id FROM run_cases), story_links AS (
        SELECT mapping.test_case_id, mapping.requirement_id FROM requirement_test_cases mapping
        JOIN scoped_cases ON scoped_cases.test_case_id = mapping.test_case_id
        UNION SELECT test_cases.id AS test_case_id, test_cases.requirement_id FROM test_cases
        JOIN scoped_cases ON scoped_cases.test_case_id = test_cases.id WHERE test_cases.requirement_id IS NOT NULL
      ) SELECT DISTINCT run_cases.execution_id, run_cases.test_case_id, story_links.requirement_id
      FROM run_cases JOIN executions ON executions.id = run_cases.execution_id
      JOIN story_links ON story_links.test_case_id = run_cases.test_case_id
      JOIN requirements ON requirements.id = story_links.requirement_id AND requirements.project_id = executions.project_id
    `).all(...executionIds, ...executionIds),
    require("./executionEvidenceProjection.service").loadRunDefects(executionIds)
  ]);
  const cases = groupRows(caseRows, "execution_id"), results = groupRows(resultRows, "execution_id"), stories = groupRows(storyRows, "execution_id"),
    linkedDefects = new Map([...defectRows].map(([id, rows]) => [id, rows.map(row => ({defect_id:row.id,display_id:row.display_id}))]));
  return new Map(executionIds.map((id) => [id, summarizeExecutionMetrics(cases.get(id), results.get(id), stories.get(id), linkedDefects.get(id))]));
}

module.exports={loadExecutionMetrics};
