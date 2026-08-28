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

exports.createTestSuite = async ({ app_type_id, name, parent_id, labels, parameter_values, parallel_enabled, parallel_count, created_by }) => {
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

  const id = uuid();
  const display_id = await displayIdService.createDisplayId("test_suite");

  await db.prepare(`
    INSERT INTO test_suites (id, display_id, app_type_id, name, parent_id, labels, parameter_values, parallel_enabled, parallel_count, created_by, updated_by, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  `).run(
    id,
    display_id,
    app_type_id,
    name,
    parent_id || null,
    normalizeReferenceList(labels),
    normalizeParameterValues(parameter_values),
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
    const existing = await db.prepare(`SELECT * FROM test_suites WHERE id = ? FOR UPDATE`).get(id);
    if (!existing) throw new Error("Test suite not found");
    const currentRevision = assertExpectedRevision(existing.revision, data.expected_revision, "Test suite");

    let parentId = data.parent_id;

    if (parentId === undefined) {
      parentId = existing.parent_id;
    }

    if (parentId === id) {
      throw new Error("A test suite cannot be its own parent");
    }

    if (parentId) {
      const parentSuite = await db.prepare(`
        SELECT id, app_type_id FROM test_suites WHERE id = ?
      `).get(parentId);

      if (!parentSuite) throw new Error("Parent test suite not found");
      if (parentSuite.app_type_id !== existing.app_type_id) {
        throw new Error("Parent suite must belong to the same app type");
      }
    }

    await db.prepare(`
      UPDATE test_suites
      SET name = ?, parent_id = ?, labels = ?, parameter_values = ?, parallel_enabled = ?, parallel_count = ?, updated_by = ?, updated_at = CURRENT_TIMESTAMP, revision = ?
      WHERE id = ?
    `).run(
      data.name ?? existing.name,
      parentId || null,
      data.labels !== undefined ? normalizeReferenceList(data.labels) : normalizeStoredReferenceList(existing.labels),
      data.parameter_values !== undefined ? normalizeParameterValues(data.parameter_values) : normalizeParameterValues(existing.parameter_values),
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
