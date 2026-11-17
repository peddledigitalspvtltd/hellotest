const { normalizeAutomationStartUrl, requiresAutomationStartUrl } = require('@hellotest/platform/backend/src/utils/automationStartUrl');
const { getOptionalEvidenceAccess } = require('@hellotest/platform/backend/services/optionalEvidenceAccess.service');
const cases = require('@hellotest/testing/backend/services/testCase.service');
const { resolveAutomationCaseSteps } = require('@hellotest/platform/backend/src/utils/automationCaseType');

const changedTarget = () => Object.assign(new Error('Start URL changed after this build was reviewed. Existing instructions were retained; submit a new build with the current target.'), { statusCode: 409, code: 'AUTOMATION_START_URL_CHANGED' });

/** A reviewed request target wins; saving it uses ordinary versioned case access. */
async function resolveBuildStartUrl({ testCase, steps, startUrl, userId, startUrlReview }) {
  const platform = resolveAutomationCaseSteps(testCase, steps, { appTypeKind: testCase.app_type_kind });
  const required = requiresAutomationStartUrl({ appTypeKind: platform.automation_case_type, steps: platform.steps });
  const url = normalizeAutomationStartUrl(startUrl != null ? startUrl : testCase.automation_start_url, { required });
  const current = await cases.getTestCase(testCase.id);
  if (current.app_type_id !== testCase.app_type_id) throw Object.assign(new Error('The automation case application changed before saving Start URL.'), { statusCode: 409, code: 'AUTOMATION_TARGET_CHANGED' });
  let savedStartUrl = current.automation_start_url || null;
  if (startUrlReview) {
    if (startUrlReview.automation_test_case_id) {
      if (current.id !== startUrlReview.automation_test_case_id || savedStartUrl !== (startUrlReview.automation_start_url || null) && savedStartUrl !== url) throw changedTarget();
    } else if (current.source_idempotency_key !== `automation-builder:${startUrlReview.source_test_case_id}` || savedStartUrl !== url) {
      // Preparation can create a target for a queued manual case. A competing
      // preparation is equivalent only when its source and reviewed URL agree.
      throw changedTarget();
    }
  }
  if (startUrl != null && url && testCase.automated === 'yes' && url !== savedStartUrl) {
    const access = await getOptionalEvidenceAccess({ id: userId }, testCase.project_id, ['testcase.update']);
    if (access['testcase.update']) {
      await cases.updateTestCase(current.id, {
        automation_start_url: url, expected_revision: current.revision, updated_by: userId
      }, { syncSharedGroups: false, expectedAutomationStartUrl: savedStartUrl });
      savedStartUrl = url;
    }
  }
  // Retain this exact baseline for final apply, rather than adopting an edit
  // made during the subsequent case reload or provider request.
  return { url, savedStartUrl };
}
module.exports = { resolveBuildStartUrl };
