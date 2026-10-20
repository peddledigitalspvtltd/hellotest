const db = require("@hellotest/platform/backend/src/db");
const { normalizeStoredReferenceList } = require("@hellotest/platform/backend/src/utils/externalReferences");

const normalizePageSize = (value) => Math.max(
  1,
  Math.min(200, Number.parseInt(String(value || 50), 10) || 50)
);

const list = async ({ projectId, appTypeId, requirementId, testCaseId, pageSize }) => {
  const conditions = ["executions.project_id = ?"];
  const params = [projectId];
  if (appTypeId) {
    conditions.push("execution_results.app_type_id = ?");
    params.push(appTypeId);
  }
  if (testCaseId) {
    conditions.push("execution_results.test_case_id = ?");
    params.push(testCaseId);
  }
  if (requirementId) {
    conditions.push("EXISTS (SELECT 1 FROM requirement_test_cases WHERE requirement_test_cases.requirement_id = ? AND requirement_test_cases.test_case_id = execution_results.test_case_id)");
    params.push(requirementId);
  }

  const rows = await db.prepare(`
    SELECT execution_results.id, executions.id AS execution_id, NULL::text AS execution_display_id,
      executions.name AS execution_name, executions.status AS execution_status, executions.trigger,
      COALESCE((SELECT jsonb_agg(membership.suite_id) FROM execution_suites membership WHERE membership.execution_id=executions.id),'[]'::jsonb) AS suite_ids, execution_results.test_case_id,
      execution_results.result_origin,execution_results.derived,execution_results.source_result_id,execution_results.source_test_case_id,execution_results.source_display_id,execution_results.covers_entire_case,execution_results.effective_at,execution_results.source_results,execution_results.source_duration_ms,
      COALESCE(execution_results.test_case_title, test_cases.title) AS test_case_title,
      execution_results.status AS result_status, execution_results.defects,
      execution_results.created_at AS result_created_at,
      executions.started_at, executions.ended_at, executions.release, executions.sprint, executions.build
    FROM test_case_effective_results AS execution_results
    JOIN executions ON executions.id = execution_results.execution_id
    LEFT JOIN test_cases ON test_cases.id = execution_results.test_case_id
    WHERE ${conditions.join(" AND ")}
    ORDER BY execution_results.effective_at DESC,execution_results.derived ASC,execution_results.id DESC
    LIMIT ?
  `).all(...params, normalizePageSize(pageSize));

  return rows.map((row) => ({
    ...row,
    defects: normalizeStoredReferenceList(row.defects),
    suite_ids: normalizeStoredReferenceList(row.suite_ids)
  }));
};

module.exports = {
  list,
  normalizePageSize
};
