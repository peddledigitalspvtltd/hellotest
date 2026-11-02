const { createHash } = require('node:crypto');
const scopes = require('@hellotest/platform/backend/src/utils/agentEvidenceScopeSql');
const LIMIT = 30;

// Run proposals need exact authorized case identities even when optional RAG
// spends its context budget on run history. This is a bounded native selection
// snapshot, not a similarity result or permission inferred from supplied IDs.
function createRunSelectionLoader({ db, hasPermission }) {
  return async ({ agentId, featureId, projectId, appTypeId, user, inputs = {}, sourceIds = [], proposalCandidates = false }) => {
    if (agentId !== 'run-planner' && featureId !== 'F07' && !proposalCandidates) return null;
    if (Array.isArray(sourceIds) && sourceIds.length) return null;
    if (!await hasPermission(user, 'testcase.view', projectId)) return null;
    const scope = scopes.predicate('test_case', 't', inputs);
    const records = await db.prepare(`SELECT t.id,t.title,
      COALESCE((SELECT MAX(version.revision) FROM test_case_versions version WHERE version.test_case_id=t.id),0)+1 AS revision,t.status,t.automated
      FROM test_cases t JOIN app_types a ON a.id=t.app_type_id
      WHERE a.project_id=? AND (?='' OR t.app_type_id=?)${scope.sql}
      ORDER BY t.id LIMIT ${LIMIT + 1}`).all(projectId, appTypeId || '', appTypeId || '', ...scope.params);
    const omitted = records.length > LIMIT;
    const projection = { evidence_type: 'authoritative_live_test_case_snapshot', evidence_permissions: ['testcase.view'],
      records: records.slice(0, LIMIT), returned_records: Math.min(records.length, LIMIT), selection_complete: !omitted,
      limitations: [omitted ? 'Selection exceeds 30 candidates. Only these exact returned identities may be proposed; narrow the scope to assess the omitted cases.' : 'These are saved case identities and versions. Selection does not establish execution, duration estimates, assertion coverage, or release readiness.'] };
    const id = 'K-run-selection-' + createHash('sha256').update(JSON.stringify({ projectId, appTypeId, scope: scope.scope, projection })).digest('hex').slice(0, 16);
    return { id, title: 'Authorized Run selection candidates', source_kind: 'live_project', content: JSON.stringify(projection), citation: { id, label: 'Authorized Run selection candidates', source_kind: 'live_project' } };
  };
}
async function loadRunSelectionEvidence(input) {
  return createRunSelectionLoader({ db: require('@hellotest/platform/backend/src/db'), hasPermission: require('@hellotest/platform/backend/services/permission.service').hasPermission })(input);
}
module.exports = { createRunSelectionLoader, loadRunSelectionEvidence };
