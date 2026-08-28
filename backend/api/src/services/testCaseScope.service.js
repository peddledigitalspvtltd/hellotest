const db = require("../db");

const uniqueIds = (values) => [...new Set((Array.isArray(values) ? values : [values])
  .map((value) => String(value || "").trim())
  .filter(Boolean))];

const getAppTypeScope = (id) => db.prepare(`
  SELECT id AS app_type_id, project_id
  FROM app_types
  WHERE id = ?
`).get(id);

const getSuiteScope = (id) => db.prepare(`
  SELECT test_suites.id, test_suites.app_type_id, app_types.project_id
  FROM test_suites
  JOIN app_types ON app_types.id = test_suites.app_type_id
  WHERE test_suites.id = ?
`).get(id);

const getRequirementScope = (id) => db.prepare(`
  SELECT id, project_id
  FROM requirements
  WHERE id = ?
`).get(id);

const getModuleScope = (id) => db.prepare(`
  SELECT test_case_modules.id, test_case_modules.app_type_id, app_types.project_id
  FROM test_case_modules
  JOIN app_types ON app_types.id = test_case_modules.app_type_id
  WHERE test_case_modules.id = ?
`).get(id);

const resolveListProjectId = async ({ project_id, app_type_id, suite_id, requirement_id, module_id } = {}) => {
  if (project_id) return project_id;
  if (app_type_id) return (await getAppTypeScope(app_type_id))?.project_id || null;
  if (suite_id) return (await getSuiteScope(suite_id))?.project_id || null;
  if (requirement_id) return (await getRequirementScope(requirement_id))?.project_id || null;
  if (module_id) return (await getModuleScope(module_id))?.project_id || null;
  return null;
};

const resolveTestCaseProjectIds = async (testCaseId) => {
  const rows = await db.prepare(`
    SELECT DISTINCT project_id
    FROM (
      SELECT app_types.project_id
      FROM test_cases
      JOIN app_types ON app_types.id = test_cases.app_type_id
      WHERE test_cases.id = ?
      UNION
      SELECT requirements.project_id
      FROM requirement_test_cases
      JOIN requirements ON requirements.id = requirement_test_cases.requirement_id
      WHERE requirement_test_cases.test_case_id = ?
      UNION
      SELECT requirements.project_id
      FROM test_cases
      JOIN requirements ON requirements.id = test_cases.requirement_id
      WHERE test_cases.id = ?
      UNION
      SELECT app_types.project_id
      FROM suite_test_cases
      JOIN test_suites ON test_suites.id = suite_test_cases.suite_id
      JOIN app_types ON app_types.id = test_suites.app_type_id
      WHERE suite_test_cases.test_case_id = ?
      UNION
      SELECT app_types.project_id
      FROM test_cases
      JOIN test_suites ON test_suites.id = test_cases.suite_id
      JOIN app_types ON app_types.id = test_suites.app_type_id
      WHERE test_cases.id = ?
    ) AS test_case_scopes
    WHERE project_id IS NOT NULL
  `).all(testCaseId, testCaseId, testCaseId, testCaseId, testCaseId);

  return rows.map((row) => row.project_id);
};

const resolveSuiteScopes = async (suiteIds) => {
  const ids = uniqueIds(suiteIds);
  if (!ids.length) return [];
  return db.prepare(`
    SELECT test_suites.id, test_suites.app_type_id, app_types.project_id
    FROM test_suites
    JOIN app_types ON app_types.id = test_suites.app_type_id
    WHERE test_suites.id IN (${ids.map(() => "?").join(", ")})
  `).all(...ids);
};

module.exports = {
  getAppTypeScope,
  getModuleScope,
  getRequirementScope,
  getSuiteScope,
  resolveListProjectId,
  resolveSuiteScopes,
  resolveTestCaseProjectIds,
  uniqueIds
};
