const db = require("../db");
const { assertExpectedRevision } = require("../utils/revision");

const getSuite = db.prepare(`
  SELECT id, app_type_id
  FROM test_suites
  WHERE id = ?
`);

const getTestCase = db.prepare(`
  SELECT id
  FROM test_cases
  WHERE id = ?
`);

const getTestCaseAppTypes = db.prepare(`
  SELECT DISTINCT test_suites.app_type_id
  FROM suite_test_cases
  JOIN test_suites ON test_suites.id = suite_test_cases.suite_id
  WHERE suite_test_cases.test_case_id = ?
`);

const getMappingsForSuite = db.prepare(`
  SELECT suite_test_cases.suite_id, suite_test_cases.test_case_id, suite_test_cases.sort_order
  FROM suite_test_cases
  WHERE suite_test_cases.suite_id = ?
  ORDER BY suite_test_cases.sort_order ASC, suite_test_cases.test_case_id ASC
`);

const getSuiteIdsForCase = db.prepare(`
  SELECT suite_id
  FROM suite_test_cases
  WHERE test_case_id = ?
  ORDER BY sort_order ASC, suite_id ASC
`);

exports.getSuiteIdsForTestCase = async (testCaseId) => {
  return (await getSuiteIdsForCase.all(testCaseId)).map((row) => row.suite_id);
};

exports.listMappings = async ({ suite_id, test_case_id }) => {
  let query = `
    SELECT suite_test_cases.suite_id, suite_test_cases.test_case_id, suite_test_cases.sort_order
    FROM suite_test_cases
    WHERE 1=1
  `;
  const params = [];

  if (suite_id) {
    query += ` AND suite_test_cases.suite_id = ?`;
    params.push(suite_id);
  }

  if (test_case_id) {
    query += ` AND suite_test_cases.test_case_id = ?`;
    params.push(test_case_id);
  }

  query += ` ORDER BY suite_test_cases.suite_id ASC, suite_test_cases.sort_order ASC`;

  return db.prepare(query).all(...params);
};

exports.replaceMappingsForSuite = async (suiteId, testCaseIds = [], { append = false, expectedRevision } = {}) => {
  const transaction = db.transaction(async () => {
    const suite = await db.prepare(`SELECT id, app_type_id, revision FROM test_suites WHERE id = ? FOR UPDATE`).get(suiteId);
    if (!suite) throw new Error("Test suite not found");
    const currentRevision = assertExpectedRevision(suite.revision, expectedRevision, "Test suite");
    const existingIds = append ? (await getMappingsForSuite.all(suiteId)).map((row) => row.test_case_id) : [];
    const uniqueIds = [...new Set([...existingIds, ...testCaseIds])];

    for (const testCaseId of uniqueIds) {
      const testCase = await getTestCase.get(testCaseId);

      if (!testCase) {
        throw new Error(`Test case not found: ${testCaseId}`);
      }

      const appTypes = (await getTestCaseAppTypes.all(testCaseId)).map((row) => row.app_type_id);

      if (appTypes.length && appTypes.some((appTypeId) => appTypeId !== suite.app_type_id)) {
        throw new Error("Test case suites must belong to the same app type");
      }
    }

    const removeSuiteMappings = db.prepare(`
      DELETE FROM suite_test_cases
      WHERE suite_id = ?
    `);

    const addSuiteMapping = db.prepare(`
      INSERT INTO suite_test_cases (suite_id, test_case_id, sort_order)
      VALUES (?, ?, ?)
    `);

    const updateLegacySuite = db.prepare(`
      UPDATE test_cases
      SET suite_id = ?
      WHERE id = ?
    `);

    await removeSuiteMappings.run(suiteId);

    for (const [index, testCaseId] of uniqueIds.entries()) {
      await addSuiteMapping.run(suiteId, testCaseId, index + 1);
      await updateLegacySuite.run(suiteId, testCaseId);
    }

    await db.prepare(`UPDATE test_suites SET revision = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(currentRevision + 1, suiteId);
    return { updated: true, assigned: uniqueIds.length, revision: currentRevision + 1 };
  });

  return transaction();
};

exports.syncMappingsForTestCase = async (testCaseId, suiteIds = []) => {
  const uniqueSuiteIds = [...new Set(suiteIds)];

  for (const suiteId of uniqueSuiteIds) {
    const suite = await getSuite.get(suiteId);
    if (!suite) {
      throw new Error(`Test suite not found: ${suiteId}`);
    }
  }

  const suites = await Promise.all(uniqueSuiteIds.map((suiteId) => getSuite.get(suiteId)));
  const appTypes = suites.map((suite) => suite?.app_type_id).filter(Boolean);
  const firstAppTypeId = appTypes[0];

  if (appTypes.some((appTypeId) => appTypeId !== firstAppTypeId)) {
    throw new Error("All assigned suites must belong to the same app type");
  }

  const removeMappings = db.prepare(`
    DELETE FROM suite_test_cases
    WHERE test_case_id = ?
  `);

  const addMapping = db.prepare(`
    INSERT INTO suite_test_cases (suite_id, test_case_id, sort_order)
    VALUES (?, ?, ?)
  `);

  const updateLegacySuite = db.prepare(`
    UPDATE test_cases
    SET suite_id = ?
    WHERE id = ?
  `);

  const transaction = db.transaction(async () => {
    await removeMappings.run(testCaseId);

    for (const [index, suiteId] of uniqueSuiteIds.entries()) {
      await addMapping.run(suiteId, testCaseId, index + 1);
    }

    await updateLegacySuite.run(uniqueSuiteIds[0] || null, testCaseId);
  });

  await transaction();
};

exports.reorderMappingsForSuite = async (suiteId, testCaseIds = [], { expectedRevision } = {}) => {
  const transaction = db.transaction(async () => {
    const suite = await db.prepare(`SELECT id, revision FROM test_suites WHERE id = ? FOR UPDATE`).get(suiteId);
    if (!suite) throw new Error("Test suite not found");
    const currentRevision = assertExpectedRevision(suite.revision, expectedRevision, "Test suite");
    const existingIds = (await getMappingsForSuite.all(suiteId)).map((row) => row.test_case_id);
    const uniqueIds = [...new Set(testCaseIds)];

    if (existingIds.length !== uniqueIds.length) {
      throw new Error("test_case_ids must include every test case in the suite");
    }

    const sortedExisting = [...existingIds].sort();
    const sortedIncoming = [...uniqueIds].sort();

    if (sortedExisting.some((value, index) => value !== sortedIncoming[index])) {
      throw new Error("test_case_ids must match the test cases currently assigned to the suite");
    }

    const updateOrder = db.prepare(`
      UPDATE suite_test_cases
      SET sort_order = ?
      WHERE suite_id = ? AND test_case_id = ?
    `);

    for (const [index, testCaseId] of uniqueIds.entries()) {
      await updateOrder.run(index + 1, suiteId, testCaseId);
    }

    await db.prepare(`UPDATE test_suites SET revision = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(currentRevision + 1, suiteId);
    return { reordered: true, revision: currentRevision + 1 };
  });

  return transaction();
};
