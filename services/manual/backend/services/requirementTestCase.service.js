const db = require("@hellotest/platform/backend/src/db");
const requirementDefectService = require("./requirementDefect.service");
const testCaseScopes = require("@hellotest/testing/backend/services/testCaseScope.service");

const scopeError = (message, statusCode) => Object.assign(new Error(message), { statusCode });
const mappingIds = (values) => {
  if (!Array.isArray(values) || values.some((value) => typeof value !== "string" || !value.trim())) {
    throw scopeError("Mapping IDs must be non-empty strings", 400);
  }
  return [...new Set(values.map((value) => value.trim()))];
};

const assertCaseProject = (testCase, projectId) => {
  if (!testCase) throw scopeError("Test Case not found", 404);
  if (testCase.project_ids.length !== 1) {
    throw scopeError("The Test Case does not have a single project scope", 409);
  }
  if (testCase.project_ids[0] !== projectId) {
    throw scopeError("Story and Test Case must belong to the same project", 403);
  }
};

const listForRequirement = db.prepare(`
  SELECT test_case_id
  FROM requirement_test_cases
  WHERE requirement_id = ?
  ORDER BY test_case_id ASC
`);

const listForTestCase = db.prepare(`
  SELECT requirement_id
  FROM requirement_test_cases
  WHERE test_case_id = ?
  ORDER BY requirement_id ASC
`);

const deleteForRequirement = db.prepare(`
  DELETE FROM requirement_test_cases
  WHERE requirement_id = ?
`);

const deleteForTestCase = db.prepare(`
  DELETE FROM requirement_test_cases
  WHERE test_case_id = ?
`);

const insertMapping = db.prepare(`
  INSERT INTO requirement_test_cases (requirement_id, test_case_id)
  VALUES (?, ?)
  ON CONFLICT DO NOTHING
`);

exports.getTestCaseIdsForRequirement = async (requirementId) => {
  return (await listForRequirement.all(requirementId)).map((row) => row.test_case_id);
};

exports.getRequirementIdsForTestCase = async (testCaseId) => {
  return (await listForTestCase.all(testCaseId)).map((row) => row.requirement_id);
};

exports.listMappings = async ({ requirement_id, test_case_id }) => {
  let query = `
    SELECT requirement_id, test_case_id
    FROM requirement_test_cases
    WHERE 1 = 1
  `;
  const params = [];

  if (requirement_id) {
    query += ` AND requirement_id = ?`;
    params.push(requirement_id);
  }

  if (test_case_id) {
    query += ` AND test_case_id = ?`;
    params.push(test_case_id);
  }

  query += ` ORDER BY requirement_id ASC, test_case_id ASC`;

  return db.prepare(query).all(...params);
};

exports.replaceMappingsForRequirement = async (requirementId, testCaseIds = []) => {
  const uniqueIds = mappingIds(testCaseIds);
  const syncLegacyRequirement = db.prepare(`
    UPDATE test_cases
    SET requirement_id = ?
    WHERE id = ?
  `);

  const transaction = db.transaction(async () => {
    const requirement = await db.prepare(`
      SELECT id, project_id FROM requirements WHERE id = ? FOR UPDATE
    `).get(requirementId);
    if (!requirement) throw scopeError("Story not found", 404);
    if (uniqueIds.length) {
      // Prevent a case moving application/project during the scope check.
      await db.prepare(`SELECT id FROM test_cases WHERE id IN (${uniqueIds.map(() => "?").join(",")}) ORDER BY id FOR SHARE`).all(...uniqueIds);
      const cases = new Map((await testCaseScopes.resolveTestCaseScopes(uniqueIds)).map((row) => [row.id, row]));
      for (const testCaseId of uniqueIds) assertCaseProject(cases.get(testCaseId), requirement.project_id);
    }
    await deleteForRequirement.run(requirementId);
    await db.prepare(`
      UPDATE test_cases
      SET requirement_id = NULL
      WHERE requirement_id = ?
    `).run(requirementId);

    for (const testCaseId of uniqueIds) {
      await insertMapping.run(requirementId, testCaseId);
      await syncLegacyRequirement.run(requirementId, testCaseId);
    }
  });

  await transaction();
  await requirementDefectService.syncAutomaticDefectsForRequirement(requirementId);

  return { updated: true, mapped: uniqueIds.length };
};

exports.syncMappingsForTestCase = async (testCaseId, requirementIds = []) => {
  const uniqueIds = mappingIds(requirementIds);

  const updateLegacyRequirement = db.prepare(`
    UPDATE test_cases
    SET requirement_id = ?
    WHERE id = ?
  `);

  const transaction = db.transaction(async () => {
    const caseRow = await db.prepare("SELECT id FROM test_cases WHERE id = ? FOR UPDATE").get(testCaseId);
    if (!caseRow) throw scopeError("Test Case not found", 404);
    const [testCase] = await testCaseScopes.resolveTestCaseScopes([testCaseId]);
    if (uniqueIds.length) {
      const requirements = await db.prepare(`
        SELECT id, project_id FROM requirements WHERE id IN (${uniqueIds.map(() => "?").join(",")}) ORDER BY id FOR SHARE
      `).all(...uniqueIds);
      const byId = new Map(requirements.map((row) => [row.id, row]));
      for (const requirementId of uniqueIds) {
        const requirement = byId.get(requirementId);
        if (!requirement) throw scopeError("Story not found", 404);
        assertCaseProject(testCase, requirement.project_id);
      }
    }
    await deleteForTestCase.run(testCaseId);

    for (const requirementId of uniqueIds) {
      await insertMapping.run(requirementId, testCaseId);
    }

    await updateLegacyRequirement.run(uniqueIds[0] || null, testCaseId);
  });

  await transaction();
  await requirementDefectService.syncAutomaticDefectsForTestCase(testCaseId, []);
};
