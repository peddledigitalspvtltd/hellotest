const db = require("../db");
const requirementDefectService = require("./requirementDefect.service");

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
  const requirement = await db.prepare(`
    SELECT id
    FROM requirements
    WHERE id = ?
  `).get(requirementId);

  if (!requirement) {
    throw new Error("Requirement not found");
  }

  const uniqueIds = [...new Set(testCaseIds.filter(Boolean))];
  const selectTestCase = db.prepare(`
    SELECT id
    FROM test_cases
    WHERE id = ?
  `);
  const syncLegacyRequirement = db.prepare(`
    UPDATE test_cases
    SET requirement_id = ?
    WHERE id = ?
  `);

  for (const testCaseId of uniqueIds) {
    const testCase = await selectTestCase.get(testCaseId);

    if (!testCase) {
      throw new Error(`Test case not found: ${testCaseId}`);
    }
  }

  const transaction = db.transaction(async () => {
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
  const uniqueIds = [...new Set(requirementIds.filter(Boolean))];
  const selectRequirement = db.prepare(`
    SELECT id
    FROM requirements
    WHERE id = ?
  `);

  for (const requirementId of uniqueIds) {
    const requirement = await selectRequirement.get(requirementId);

    if (!requirement) {
      throw new Error(`Requirement not found: ${requirementId}`);
    }
  }

  const updateLegacyRequirement = db.prepare(`
    UPDATE test_cases
    SET requirement_id = ?
    WHERE id = ?
  `);

  const transaction = db.transaction(async () => {
    await deleteForTestCase.run(testCaseId);

    for (const requirementId of uniqueIds) {
      await insertMapping.run(requirementId, testCaseId);
    }

    await updateLegacyRequirement.run(uniqueIds[0] || null, testCaseId);
  });

  await transaction();
  await requirementDefectService.syncAutomaticDefectsForTestCase(testCaseId, []);
};
