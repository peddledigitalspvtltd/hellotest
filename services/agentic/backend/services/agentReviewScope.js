const { getOptionalEvidenceAccess } = require("@hellotest/platform/backend/services/optionalEvidenceAccess.service");
const evidenceScopes = require("@hellotest/platform/backend/src/utils/agentEvidenceScopeSql");
const agentContract = require("../agents/agentDefinition");

const agentError = (message, statusCode) => Object.assign(new Error(message), { statusCode, publicMessage: message });

async function resolveCaseEvidenceInput({ inputs, user, projectId, appTypeId }) {
  if (!/^(?:AT[_-][0-9]+|TC[_-]?[0-9]+)$/i.test(inputs.test_case_id || '')) return inputs;
  const access = await getOptionalEvidenceAccess(user, projectId, ['testcase.view']);
  if (!access['testcase.view']) throw agentError('Test Case evidence access is required to resolve this case reference.', 403);
  const scoped = await require('@hellotest/platform/backend/services/entityScope.service').resolveEntityScope({
    entityType: 'test_case', entityId: inputs.test_case_id, projectId, appTypeId, allowDisplayId: true
  });
  return { ...inputs, test_case_id: scoped.entityId };
}
async function assertPinnedCaseScope({ projectId, appTypeId, evidenceScope }) {
  if (!evidenceScope.test_case_id || Object.keys(evidenceScope).length < 2) return;
  const filter = evidenceScopes.predicate('test_case', 't', evidenceScope);
  const row = await require('@hellotest/platform/backend/src/db').prepare(`SELECT t.id FROM test_cases t JOIN app_types a ON a.id = t.app_type_id
    WHERE a.project_id = ? AND (? = '' OR t.app_type_id = ?)${filter.sql} LIMIT 1`).get(projectId, appTypeId || '', appTypeId || '', ...filter.params);
  if (!row) throw agentContract.fail('The selected Test Case does not belong to the combined evidence scope. Choose matching records.', 'AGENT_EVIDENCE_SCOPE_MISMATCH');
}

async function assertTaskEnvironment({ environmentId, projectId, appTypeId, user }) {
  const access = await getOptionalEvidenceAccess(user, projectId, ['environment.view']);
  if (!access['environment.view']) throw agentError('Test Environment access is required for the selected input.', 403);
  const environment = await require('@hellotest/testing/backend/services/testEnvironment.service').getTestEnvironment(environmentId).catch(() => null);
  if (!environment || environment.project_id !== projectId || (appTypeId && environment.app_type_id && appTypeId !== environment.app_type_id)) {
    throw agentContract.fail('Choose a Test Environment in this project and application.', 'AGENT_INPUT_INVALID');
  }
}

module.exports = { resolveCaseEvidenceInput, assertPinnedCaseScope, assertTaskEnvironment };
