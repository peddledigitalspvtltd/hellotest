const db = require('@hellotest/platform/backend/src/db');
const {shapeExecutionResult}=require('./executionResult.service');

exports.getCoverage = async testCaseId => {
  const count=await db.prepare(`SELECT COUNT(*)::int AS count FROM automation_case_links link
    JOIN test_cases automation ON automation.id=link.automation_test_case_id AND automation.automated='yes'
    JOIN test_cases manual ON manual.id=link.manual_test_case_id AND COALESCE(manual.automated,'no')='no' AND manual.app_type_id=automation.app_type_id
    WHERE manual.id=?`).get(testCaseId);
  const latest=await db.prepare(`SELECT id,execution_id,test_case_id,status,duration_ms,created_at,effective_at,
    result_origin,derived,source_result_id,source_test_case_id,source_display_id,covers_entire_case,source_results,source_duration_ms
    FROM test_case_effective_results WHERE test_case_id=? AND derived=TRUE ORDER BY effective_at DESC,id DESC LIMIT 1`).get(testCaseId);
  return {linked_case_count:Number(count?.count||0),status:latest?.status||null,latest_result:latest?shapeExecutionResult(latest):null};
};
