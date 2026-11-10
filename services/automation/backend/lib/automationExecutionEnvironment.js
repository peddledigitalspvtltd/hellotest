const db = require('@hellotest/platform/backend/src/db');
const evidenceAccess = require('@hellotest/platform/backend/services/optionalEvidenceAccess.service');

const failure = (message, statusCode, code) => Object.assign(new Error(message), { statusCode, code, publicMessage: message, nonRetryable: true });

// An explicitly selected Run owns its frozen environment. A case default is a
// reference only; authorize and freeze it at dispatch instead of copying its
// private variables into generated cases or workflow output.
async function executionWithCaseEnvironment({ execution, caseSnapshot, actorId, cache, database = db, access = evidenceAccess.getOptionalEvidenceAccess }) {
  if (execution.test_environment || execution.test_environment_id) return execution;
  let options = caseSnapshot?.test_data_options;
  if (typeof options === 'string') {
    try { options = JSON.parse(options); }
    catch { throw failure('The saved Test Environment reference is invalid. Select a Test Environment for this run.', 422, 'AUTOMATION_ENVIRONMENT_INVALID'); }
  }
  const environmentId = options?.test_environment_id;
  if (environmentId == null || environmentId === '') return execution;
  if (typeof environmentId !== 'string' || !/^[\w-]{1,160}$/.test(environmentId)) {
    throw failure('The saved Test Environment reference is invalid. Select a Test Environment for this run.', 422, 'AUTOMATION_ENVIRONMENT_INVALID');
  }
  const userId = actorId || execution.created_by;
  const appTypeId = execution.app_type_id || caseSnapshot.app_type_id || null;
  const key = JSON.stringify([execution.project_id, appTypeId, userId, environmentId]);
  const resolve = async () => {
    if (!userId || !(await access({ id: userId }, execution.project_id, ['environment.view']))['environment.view']) {
      throw failure('Viewing the case’s saved Test Environment is required before execution.', 403, 'AUTOMATION_ENVIRONMENT_ACCESS_REQUIRED');
    }
    const environment = await database.prepare('SELECT id, name, description, base_url, browser, notes, variables FROM test_environments WHERE id=? AND project_id=? AND (app_type_id IS NULL OR app_type_id=?)').get(environmentId.trim(), execution.project_id, appTypeId);
    if (!environment) throw failure('The case’s saved Test Environment is unavailable in this project and application. Select another environment for this run.', 404, 'AUTOMATION_ENVIRONMENT_UNAVAILABLE');
    return { id: environment.id, name: environment.name, snapshot: {
      ...environment, variables: typeof environment.variables === 'string' ? JSON.parse(environment.variables) : environment.variables || []
    } };
  };
  if (cache && !cache.has(key)) cache.set(key, resolve());
  const environment = await (cache ? cache.get(key) : resolve());
  return { ...execution, test_environment: environment };
}

module.exports = { executionWithCaseEnvironment };
