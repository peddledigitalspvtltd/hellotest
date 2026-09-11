const db = require("../db");
const { randomUUID: uuid } = require("crypto");
const suiteTestCaseService = require("./suiteTestCase.service");
const displayIdService = require("./displayId.service");
const { normalizeReferenceList, normalizeStoredReferenceList } = require("../utils/externalReferences");
const { assertExpectedRevision } = require("../utils/revision");

const normalizeParameterName = (value) => {
  const normalized = String(value || "").trim().replace(/^@+/, "").toLowerCase();
  return normalized || null;
};

const normalizeParameterValues = (values = {}) => {
  if (!values || typeof values !== "object" || Array.isArray(values)) {
    return {};
  }

  return Object.entries(values).reduce((next, [key, value]) => {
    const normalizedKey = normalizeParameterName(key);

    if (!normalizedKey) {
      return next;
    }

    next[normalizedKey] = value === undefined || value === null ? "" : String(value);
    return next;
  }, {});
};

const normalizeBoolean = (value, fallback = false) => {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number") {
    return value === 1;
  }

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes", "on"].includes(normalized)) return true;
    if (["false", "0", "no", "off"].includes(normalized)) return false;
  }

  return fallback;
};

const normalizeParallelCount = (value, fallback = 1) => {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Math.max(1, Math.min(50, Number.isFinite(parsed) ? parsed : fallback));
};

const shapeSuite = (suite) => ({
  ...suite,
  labels: normalizeStoredReferenceList(suite.labels),
  parameter_values: normalizeParameterValues(suite.parameter_values),
  parallel_enabled: suite.parallel_enabled === null || suite.parallel_enabled === undefined ? null : normalizeBoolean(suite.parallel_enabled),
  parallel_count: suite.parallel_count === null || suite.parallel_count === undefined ? null : normalizeParallelCount(suite.parallel_count)
});

const assertParentHierarchy = async (suiteId, parentId, appTypeId) => {
  const ancestors = await db.prepare(`
    WITH RECURSIVE ancestors AS (
      SELECT id, parent_id, app_type_id, ARRAY[id] AS path, FALSE AS cyclic
      FROM test_suites WHERE id = ?
      UNION ALL
      SELECT parent.id, parent.parent_id, parent.app_type_id,
        ancestors.path || parent.id, parent.id = ANY(ancestors.path)
      FROM test_suites parent
      JOIN ancestors ON parent.id = ancestors.parent_id
      WHERE NOT ancestors.cyclic
    )
    SELECT id, app_type_id, cyclic FROM ancestors
  `).all(parentId);
  if (!ancestors.length) throw new Error("Parent test suite not found");
  if (ancestors.some((ancestor) => ancestor.id === suiteId || ancestor.cyclic)) {
    throw Object.assign(new Error("A test suite cannot be moved beneath itself or a descendant"), {
      statusCode: 409, code: "SUITE_HIERARCHY_CYCLE"
    });
  }
  if (ancestors.some((ancestor) => ancestor.app_type_id !== appTypeId)) {
    throw new Error("Parent suite must belong to the same app type");
  }
};

const validateSuiteDataSet = async (appTypeId, dataSetId) => {
  if (!dataSetId) return null;
  const data = await db.prepare(`SELECT data.id FROM test_data_sets data JOIN app_types app ON app.id = ?
    WHERE data.id = ? AND data.project_id = app.project_id AND (data.app_type_id IS NULL OR data.app_type_id = app.id)`)
    .get(appTypeId, dataSetId);
  if (!data) throw Object.assign(new Error("Suite test data must belong to the same project and application, or be shared with the project."), { statusCode: 400 });
  return data.id;
};

exports.createTestSuite = async ({ app_type_id, name, description, parent_id, labels, parameter_values, test_data_set_id, parallel_enabled, parallel_count, created_by }) => {
  if (!app_type_id || !name) {
    throw new Error("Missing required fields");
  }

  const appType = await db.prepare(`
    SELECT id FROM app_types WHERE id = ?
  `).get(app_type_id);

  if (!appType) throw new Error("App type not found");

  if (parent_id) {
    const parentSuite = await db.prepare(`
      SELECT id, app_type_id FROM test_suites WHERE id = ?
    `).get(parent_id);

    if (!parentSuite) throw new Error("Parent test suite not found");
    if (parentSuite.app_type_id !== app_type_id) {
      throw new Error("Parent suite must belong to the same app type");
    }
  }

  const dataSetId = await validateSuiteDataSet(app_type_id, test_data_set_id);
  const id = uuid();
  const display_id = await displayIdService.createDisplayId("test_suite");

  await db.prepare(`
    INSERT INTO test_suites (id, display_id, app_type_id, name, description, parent_id, labels, parameter_values, test_data_set_id, parallel_enabled, parallel_count, created_by, updated_by, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  `).run(
    id,
    display_id,
    app_type_id,
    name,
    description || null,
    parent_id || null,
    normalizeReferenceList(labels),
    normalizeParameterValues(parameter_values),
    dataSetId,
    parallel_enabled === undefined ? null : normalizeBoolean(parallel_enabled),
    parallel_enabled === undefined ? null : normalizeParallelCount(parallel_count),
    created_by || null,
    created_by || null
  );

  return { id };
};

exports.getTestSuites = async ({ project_id, app_type_id, parent_id }) => {
  let query = `SELECT * FROM test_suites WHERE 1=1`;
  const params = [];

  if (app_type_id) {
    query += ` AND app_type_id = ?`;
    params.push(app_type_id);
  }

  if (project_id) {
    query += ` AND app_type_id IN (SELECT id FROM app_types WHERE project_id = ?)`;
    params.push(project_id);
  }

  if (parent_id !== undefined) {
    if (parent_id === "null") {
      query += ` AND parent_id IS NULL`;
    } else {
      query += ` AND parent_id = ?`;
      params.push(parent_id);
    }
  }

  query += ` ORDER BY COALESCE(updated_at, created_at) DESC, created_at DESC`;

  const suites = await db.prepare(query).all(...params);
  return suites.map(shapeSuite);
};

exports.getTestSuite = async (id) => {
  const suite = await db.prepare(`
    SELECT * FROM test_suites WHERE id = ?
  `).get(id);

  if (!suite) throw new Error("Test suite not found");

  return shapeSuite(suite);
};

exports.updateTestSuite = async (id, data) => {
  const transaction = db.transaction(async () => {
    if (data.parent_id !== undefined) {
      // Serialize moves before locking individual suites. Otherwise concurrent
      // A→B and B→A requests can each validate an outdated, acyclic hierarchy.
      await db.prepare(`
        SELECT pg_advisory_xact_lock(hashtextextended('test-suite-hierarchy:' || app_type_id, 0))
        FROM test_suites WHERE id = ?
      `).get(id);
    }
    const existing = await db.prepare(`SELECT * FROM test_suites WHERE id = ? FOR UPDATE`).get(id);
    if (!existing) throw new Error("Test suite not found");
    const currentRevision = assertExpectedRevision(existing.revision, data.expected_revision, "Test suite");

    const dataSetId = data.test_data_set_id !== undefined ? await validateSuiteDataSet(existing.app_type_id, data.test_data_set_id) : existing.test_data_set_id;
    let parentId = data.parent_id;

    if (parentId === undefined) {
      parentId = existing.parent_id;
    }

    if (parentId) {
      await assertParentHierarchy(id, parentId, existing.app_type_id);
    }

    await db.prepare(`
      UPDATE test_suites
      SET name = ?, description = ?, parent_id = ?, labels = ?, parameter_values = ?, test_data_set_id = ?, parallel_enabled = ?, parallel_count = ?, updated_by = ?, updated_at = CURRENT_TIMESTAMP, revision = ?
      WHERE id = ?
    `).run(
      data.name ?? existing.name,
      data.description !== undefined ? data.description || null : existing.description,
      parentId || null,
      data.labels !== undefined ? normalizeReferenceList(data.labels) : normalizeStoredReferenceList(existing.labels),
      data.parameter_values !== undefined ? normalizeParameterValues(data.parameter_values) : normalizeParameterValues(existing.parameter_values),
      dataSetId || null,
      data.parallel_enabled !== undefined ? normalizeBoolean(data.parallel_enabled) : existing.parallel_enabled,
      data.parallel_enabled !== undefined || data.parallel_count !== undefined
        ? normalizeParallelCount(data.parallel_count, existing.parallel_count || 1)
        : existing.parallel_count,
      data.updated_by ?? existing.updated_by ?? existing.created_by ?? null,
      currentRevision + 1,
      id
    );

    return { updated: true, revision: currentRevision + 1 };
  });

  return transaction();
};

exports.assignTestCases = async (id, testCaseIds = [], { append = false, expectedRevision } = {}) => {
  return suiteTestCaseService.replaceMappingsForSuite(id, testCaseIds, { append, expectedRevision });
};

exports.deleteTestSuite = async (id) => {
  await exports.getTestSuite(id);

  const childSuite = await db.prepare(`
    SELECT id FROM test_suites WHERE parent_id = ?
  `).get(id);

  if (childSuite) {
    throw new Error("Cannot delete test suite with child suites");
  }

  const transaction = db.transaction(async () => {
    await db.prepare(`
      DELETE FROM suite_test_cases
      WHERE suite_id = ?
    `).run(id);

    // Keep the legacy column from blocking deletes while the mapping table is the source of truth.
    await db.prepare(`
      UPDATE test_cases
      SET suite_id = NULL
      WHERE suite_id = ?
    `).run(id);

    await db.prepare(`
      DELETE FROM test_suites WHERE id = ?
    `).run(id);
  });

  await transaction();

  return { deleted: true };
};
