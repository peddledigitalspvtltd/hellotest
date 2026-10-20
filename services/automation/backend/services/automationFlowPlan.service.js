const db = require('@hellotest/platform/backend/src/db');
const { getOptionalEvidenceAccess } = require('@hellotest/platform/backend/services/optionalEvidenceAccess.service');
const testSteps = require('@hellotest/testing/backend/services/testStep.service');
const { normalizeFlowPlan } = require('../lib/automationFlowPlanning');

/** Persist only draft manual steps; code still requires the per-section execution/save gate. */
async function saveFlowPlan({ testCase, steps, userId, executionGuard, assertSources }) {
  const allowedTypes=testCase.app_type_kind==='unified'?['web','api','android','ios']:[testCase.app_type_kind||'web'];
  const proposed=normalizeFlowPlan({flow_steps:steps},{allowedTypes});
  return db.transaction(async () => {
    const permissions=['automation.ai','automation.build','testcase.update',...(proposed.some(step=>['android','ios'].includes(step.step_type))?['mobile.manage']:[])];
    const assertAccess=async()=>{
      await executionGuard?.ensureOwnership();
      const access=await getOptionalEvidenceAccess({id:userId},testCase.project_id,permissions);
      if(permissions.some(key=>!access[key]))throw Object.assign(new Error('Creating the manual flow requires automation build, test case update and the selected platform access.'),{statusCode:403});
    };
    await assertAccess();
    const current = await db.prepare('SELECT tc.*,app.project_id,COALESCE((SELECT MAX(version.revision) FROM test_case_versions version WHERE version.test_case_id=tc.id),0)+1 AS revision FROM test_cases tc JOIN app_types app ON app.id=tc.app_type_id WHERE tc.id=? FOR UPDATE OF tc FOR SHARE OF app').get(testCase.id);
    const existing = await db.prepare('SELECT id FROM test_steps WHERE test_case_id=? ORDER BY step_order,id FOR UPDATE').all(testCase.id);
    if (!current || current.automated !== 'yes' || current.app_type_id !== testCase.app_type_id || current.project_id !== testCase.project_id
      || Number(current.revision) !== Number(testCase.revision) || (current.automation_start_url || null) !== (testCase.automation_start_url || null) || existing.length) {
      throw Object.assign(new Error('The automation case changed while its manual flow was being planned. Existing edits were retained; refresh before building again.'), { code: 'AUTOMATION_FLOW_BASELINE_CHANGED', statusCode: 409, nonRetryable: true });
    }
    await assertSources?.();
    await assertAccess();
    await testSteps.createTestSteps({ test_case_id: testCase.id, insertion_index: 0, steps:proposed });
    await db.prepare("UPDATE test_cases SET automation_status='incomplete',updated_at=CURRENT_TIMESTAMP WHERE id=?").run(testCase.id);
    await assertAccess();
    return db.prepare('SELECT * FROM test_steps WHERE test_case_id=? ORDER BY step_order,id').all(testCase.id);
  })();
}

module.exports = { saveFlowPlan };
