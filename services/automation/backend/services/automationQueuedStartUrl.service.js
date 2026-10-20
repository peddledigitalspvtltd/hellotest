const db = require('@hellotest/platform/backend/src/db');

const changed = () => Object.assign(new Error('The automation target changed after this build was queued. Review the current Start URL and start a new build.'), {
  statusCode: 409, code: 'AUTOMATION_START_URL_CHANGED', nonRetryable: true
});

function captureStartUrlReview(source, preparedTarget) {
  const target = source.automated === 'yes' ? source : preparedTarget;
  return {
    source_test_case_id: source.id,
    automation_test_case_id: target?.id ?? null,
    automation_start_url: target?.automation_start_url ?? null
  };
}

function createQueuedStartUrlReviewGuard(database = db) {
  return async ({ sourceCaseId, appTypeId, review, desiredStartUrl, required = false }) => {
    if (!review && !required) return;
    if (!review || review.source_test_case_id !== sourceCaseId
      || !Object.hasOwn(review, 'automation_test_case_id') || !Object.hasOwn(review, 'automation_start_url')) throw changed();
    const source = await database.prepare('SELECT id,app_type_id,automated,automation_start_url FROM test_cases WHERE id=?').get(sourceCaseId);
    if (!source || appTypeId && source.app_type_id !== appTypeId) throw changed();
    const target = source.automated === 'yes' ? source : await database.prepare(`SELECT id,automation_start_url FROM test_cases
      WHERE app_type_id=? AND source_idempotency_key=? AND automated='yes'`).get(source.app_type_id, `automation-builder:${source.id}`);
    const current = captureStartUrlReview(source, target);
    const sameTarget = review.automation_test_case_id === current.automation_test_case_id;
    const sameSavedUrl = review.automation_start_url === current.automation_start_url;
    // A prior attempt may already have saved its immutable desired target.
    // Reusing that exact mapping performs no conflicting URL overwrite.
    const sameDesiredUrl = typeof desiredStartUrl === 'string' && current.automation_start_url === desiredStartUrl;
    const equivalentPreparation = review.automation_test_case_id === null && current.automation_test_case_id !== null && sameDesiredUrl;
    if (!(sameTarget && (sameSavedUrl || sameDesiredUrl) || equivalentPreparation)) throw changed();
  };
}

module.exports = { captureStartUrlReview, createQueuedStartUrlReviewGuard, assertQueuedStartUrlReview: createQueuedStartUrlReviewGuard() };
