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

exports.getTestSuites = async ({ project_id, app_type_id, parent_id, projection, case_search, module_id, requirement_id, label, shared_step_group_id } = {}) => {
  const picker = projection === 'picker';
  const summary = projection === 'summary';
  const membership = `(tc.suite_id = test_suites.id OR EXISTS (SELECT 1 FROM suite_test_cases link WHERE link.suite_id = test_suites.id AND link.test_case_id = tc.id))`;
  let query = `SELECT ${picker ? 'id, display_id, app_type_id, name, parent_id, labels, parallel_enabled, parallel_count, created_at, updated_at' : 'test_suites.*'} FROM test_suites WHERE 1=1`;
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

  const hasCaseFilters = Boolean(String(case_search || '').trim() || module_id || requirement_id || shared_step_group_id);
  if (hasCaseFilters || label) {
    const scope = require('./testCaseCatalog.service').buildScope({ projection: 'picker', search: case_search, module_id, requirement_id, shared_step_group_id });
    const labelClause = label ? ` AND (COALESCE(test_suites.labels, '[]'::jsonb) @> ?::jsonb OR COALESCE(tc.labels, '[]'::jsonb) @> ?::jsonb)` : '';
    const matchingCases = `EXISTS (SELECT 1 FROM test_cases tc WHERE tc.app_type_id = test_suites.app_type_id AND ${membership} AND ${scope.where}${labelClause})`;
    if (!hasCaseFilters && label) {
      query += ` AND (COALESCE(test_suites.labels, '[]'::jsonb) @> ?::jsonb OR ${matchingCases})`;
      params.push(JSON.stringify([label]));
    } else query += ` AND ${matchingCases}`;
    params.push(...scope.params, ...(label ? [JSON.stringify([label]), JSON.stringify([label])] : []));
  }

  if (picker || summary) {
    // Resolve membership once for all selected Suites, instead of scanning the
    // application's entire case catalog separately for each Suite and metric.
    query = `WITH scoped_suites AS MATERIALIZED (${query}), members AS MATERIALIZED (
      SELECT suite.id AS suite_id, tc.id AS test_case_id, tc.app_type_id, tc.automated, tc.requirement_id
      FROM scoped_suites suite JOIN suite_test_cases link ON link.suite_id = suite.id
      JOIN test_cases tc ON tc.id = link.test_case_id AND tc.app_type_id = suite.app_type_id
      UNION
      SELECT suite.id, tc.id, tc.app_type_id, tc.automated, tc.requirement_id
      FROM scoped_suites suite JOIN test_cases tc ON tc.suite_id = suite.id AND tc.app_type_id = suite.app_type_id
    )${summary ? `, member_cases AS MATERIALIZED (
      SELECT DISTINCT test_case_id, app_type_id, automated, requirement_id FROM members
    ), steps AS (
      SELECT member.test_case_id, COUNT(*)::INTEGER AS step_count
      FROM member_cases member JOIN test_steps step ON step.test_case_id = member.test_case_id GROUP BY member.test_case_id
    ), covered AS (
      SELECT member.test_case_id FROM member_cases member JOIN app_types app ON app.id = member.app_type_id
      JOIN requirements story ON story.id = member.requirement_id AND story.project_id = app.project_id
      UNION
      SELECT member.test_case_id FROM member_cases member JOIN app_types app ON app.id = member.app_type_id
      JOIN requirement_test_cases link ON link.test_case_id = member.test_case_id
      JOIN requirements story ON story.id = link.requirement_id AND story.project_id = app.project_id
    )` : ''}, totals AS (
      SELECT member.suite_id, COUNT(*)::INTEGER AS test_case_count${summary ? `,
        COUNT(*) FILTER (WHERE member.automated = 'yes')::INTEGER AS automated_case_count,
        COALESCE(SUM(steps.step_count), 0)::INTEGER AS step_count,
        COUNT(covered.test_case_id)::INTEGER AS story_linked_case_count` : ''}
      FROM members member${summary ? ` LEFT JOIN steps ON steps.test_case_id = member.test_case_id
        LEFT JOIN covered ON covered.test_case_id = member.test_case_id` : ''} GROUP BY member.suite_id
    ) SELECT suite.*, COALESCE(totals.test_case_count, 0) AS test_case_count${summary ? `,
      COALESCE(totals.automated_case_count, 0) AS automated_case_count,
      COALESCE(totals.step_count, 0) AS step_count,
      COALESCE(totals.story_linked_case_count, 0) AS story_linked_case_count` : ''}
    FROM scoped_suites suite LEFT JOIN totals ON totals.suite_id = suite.id
    ORDER BY COALESCE(suite.updated_at, suite.created_at) DESC, suite.created_at DESC`;
  } else query += ` ORDER BY COALESCE(updated_at, created_at) DESC, created_at DESC`;

  const suites = await db.prepare(query).all(...params);
  return suites.map((suite) => picker
    ? { ...suite, labels: normalizeStoredReferenceList(suite.labels), detail_complete: false }
    : { ...shapeSuite(suite), ...(summary ? { total_step_count: suite.step_count } : {}) });
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
