const db = require("@hellotest/platform/backend/src/db");
const { assertExpectedRevision } = require("@hellotest/platform/backend/src/utils/revision");

const mappingIds = (values) => {
  if (!Array.isArray(values) || values.some((value) => typeof value !== "string" || !value.trim())) {
    throw Object.assign(new Error("Mapping IDs must be non-empty strings"), { statusCode: 400 });
  }
  return [...new Set(values.map((value) => value.trim()))];
};

// One JSON parameter keeps query shape and database round trips independent of
// the selection size, while WITH ORDINALITY preserves the caller's order.
const selectedIdsSql = "SELECT value FROM jsonb_array_elements_text(?::jsonb) AS selected(value)";

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
    const suite = await db.prepare(`SELECT id, app_type_id, revision FROM test_suites WHERE id = ? FOR NO KEY UPDATE`).get(suiteId);
    if (!suite) throw new Error("Test suite not found");
    const currentRevision = assertExpectedRevision(suite.revision, expectedRevision, "Test suite");
    const existingIds = append ? (await getMappingsForSuite.all(suiteId)).map((row) => row.test_case_id) : [];
    const uniqueIds = [...new Set([...existingIds, ...mappingIds(testCaseIds)])];

    const encodedIds = JSON.stringify(uniqueIds);
    const cases = uniqueIds.length ? await db.prepare(`
      SELECT id, app_type_id FROM test_cases
      WHERE id IN (${selectedIdsSql}) ORDER BY id FOR UPDATE
    `).all(encodedIds) : [];
    const casesById = new Map(cases.map((row) => [row.id, row]));
    for (const testCaseId of uniqueIds) {
      const testCase = casesById.get(testCaseId);
      if (!testCase) throw Object.assign(new Error(`Test case not found: ${testCaseId}`), { statusCode: 404 });
      if (testCase.app_type_id !== suite.app_type_id) {
        throw Object.assign(new Error("Test case suites must belong to the same app type"), { statusCode: 403 });
      }
    }

    await db.prepare("DELETE FROM suite_test_cases WHERE suite_id = ?").run(suiteId);
    if (uniqueIds.length) {
      await db.prepare(`
        INSERT INTO suite_test_cases (suite_id, test_case_id, sort_order)
        SELECT ?, selected.value, selected.ordinality::integer
        FROM jsonb_array_elements_text(?::jsonb) WITH ORDINALITY AS selected(value, ordinality)
      `).run(suiteId, encodedIds);
    }
    // Removed cases must not retain a stale legacy primary suite. Retain any
    // other assignment, choosing the same stable order used by the catalog.
    await db.prepare(`
      UPDATE test_cases
      SET suite_id = (SELECT mapping.suite_id FROM suite_test_cases mapping
        WHERE mapping.test_case_id = test_cases.id
        ORDER BY mapping.sort_order, mapping.suite_id LIMIT 1)
      WHERE suite_id = ? AND id NOT IN (${selectedIdsSql})
    `).run(suiteId, encodedIds);
    if (uniqueIds.length) {
      await db.prepare(`UPDATE test_cases SET suite_id = ? WHERE id IN (${selectedIdsSql})`).run(suiteId, encodedIds);
    }

    await db.prepare(`UPDATE test_suites SET revision = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(currentRevision + 1, suiteId);
    return { updated: true, assigned: uniqueIds.length, revision: currentRevision + 1 };
  });

  return transaction();
};

exports.syncMappingsForTestCase = async (testCaseId, suiteIds = []) => {
  const uniqueSuiteIds = mappingIds(suiteIds);
  const transaction = db.transaction(async () => {
    const testCase = await db.prepare("SELECT id, app_type_id FROM test_cases WHERE id = ? FOR UPDATE").get(testCaseId);
    if (!testCase) throw Object.assign(new Error(`Test case not found: ${testCaseId}`), { statusCode: 404 });
    const encodedIds = JSON.stringify(uniqueSuiteIds);
    const suites = uniqueSuiteIds.length ? await db.prepare(`
      SELECT id, app_type_id FROM test_suites WHERE id IN (${selectedIdsSql}) ORDER BY id
    `).all(encodedIds) : [];
    const suitesById = new Map(suites.map((row) => [row.id, row]));
    for (const suiteId of uniqueSuiteIds) {
      const suite = suitesById.get(suiteId);
      if (!suite) throw Object.assign(new Error(`Test suite not found: ${suiteId}`), { statusCode: 404 });
      if (suite.app_type_id !== testCase.app_type_id) {
        throw Object.assign(new Error("Test case suites must belong to the same app type"), { statusCode: 403 });
      }
    }
    await db.prepare("DELETE FROM suite_test_cases WHERE test_case_id = ?").run(testCaseId);
    if (uniqueSuiteIds.length) {
      await db.prepare(`
        INSERT INTO suite_test_cases (suite_id, test_case_id, sort_order)
        SELECT selected.value, ?, selected.ordinality::integer
        FROM jsonb_array_elements_text(?::jsonb) WITH ORDINALITY AS selected(value, ordinality)
      `).run(testCaseId, encodedIds);
    }
    await db.prepare("UPDATE test_cases SET suite_id = ? WHERE id = ?").run(uniqueSuiteIds[0] || null, testCaseId);
  });
  await transaction();
};

exports.reorderMappingsForSuite = async (suiteId, testCaseIds = [], { expectedRevision } = {}) => {
  const transaction = db.transaction(async () => {
    const suite = await db.prepare(`SELECT id, revision FROM test_suites WHERE id = ? FOR NO KEY UPDATE`).get(suiteId);
    if (!suite) throw new Error("Test suite not found");
    const currentRevision = assertExpectedRevision(suite.revision, expectedRevision, "Test suite");
    const existingIds = (await getMappingsForSuite.all(suiteId)).map((row) => row.test_case_id);
    const uniqueIds = mappingIds(testCaseIds);

    if (existingIds.length !== uniqueIds.length) {
      throw new Error("test_case_ids must include every test case in the suite");
    }

    const sortedExisting = [...existingIds].sort();
    const sortedIncoming = [...uniqueIds].sort();

    if (sortedExisting.some((value, index) => value !== sortedIncoming[index])) {
      throw new Error("test_case_ids must match the test cases currently assigned to the suite");
    }

    if (uniqueIds.length) {
      await db.prepare(`
        UPDATE suite_test_cases SET sort_order = selected.ordinality::integer
        FROM jsonb_array_elements_text(?::jsonb) WITH ORDINALITY AS selected(value, ordinality)
        WHERE suite_test_cases.suite_id = ? AND suite_test_cases.test_case_id = selected.value
      `).run(JSON.stringify(uniqueIds), suiteId);
    }

    await db.prepare(`UPDATE test_suites SET revision = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(currentRevision + 1, suiteId);
    return { reordered: true, revision: currentRevision + 1 };
  });

  return transaction();
};
