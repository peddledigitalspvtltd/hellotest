const { randomUUID: uuid } = require("crypto");
const db = require("../db");
const workspaceTransactionService = require("./workspaceTransaction.service");

const MAX_RETAINED_VERSIONS = 20;

const normalizeRevision = (value) => {
  const revision = Number(value);
  if (!Number.isSafeInteger(revision) || revision < 1) {
    const error = new Error("Test case revision must be a positive integer.");
    error.statusCode = 400;
    throw error;
  }
  return revision;
};

const SNAPSHOT_FIELDS = [
  "app_type_id",
  "title",
  "description",
  "external_references",
  "labels",
  "parameter_values",
  "automated",
  "automation_status",
  "manual_test_case_id",
  "manual_test_case_ids",
  "authoring_mode",
  "test_case_type",
  "test_data_set_ids",
  "gherkin_document",
  "priority",
  "status",
  "requirement_ids",
  "suite_ids",
  "author_id",
  "reviewer_id",
  "review_status",
  "ai_quality_score"
];

const loadSteps = (testCaseId) => db.prepare(`
  SELECT step_order, action, expected_result, step_type, automation_code, api_request,
         group_id, group_name, group_kind, reusable_group_id
  FROM test_steps
  WHERE test_case_id = ?
  ORDER BY step_order ASC, id ASC
`).all(testCaseId);

const buildSnapshot = async (testCase) => {
  const snapshot = {};
  SNAPSHOT_FIELDS.forEach((field) => {
    snapshot[field] = field === "author_id"
      ? testCase.author_id || testCase.author?.id || testCase.created_by || null
      : testCase[field] ?? null;
  });
  snapshot.steps = await loadSteps(testCase.id);
  return snapshot;
};

const summarizeChanges = (previous, next) => {
  const changed = SNAPSHOT_FIELDS
    .filter((field) => JSON.stringify(previous[field] ?? null) !== JSON.stringify(next[field] ?? null))
    .map((field) => field.replace(/_/g, " "));
  const previousSteps = Array.isArray(previous.steps) ? previous.steps : [];
  const nextSteps = Array.isArray(next.steps) ? next.steps : [];
  if (JSON.stringify(previousSteps) !== JSON.stringify(nextSteps)) {
    changed.push(`steps (${previousSteps.length} → ${nextSteps.length})`);
  }
  return changed.length ? `Changed ${changed.join(", ")}.` : "Saved without material field changes.";
};

const capture = async ({ testCase, createdBy, nextSnapshot }) => {
  const snapshot = await buildSnapshot(testCase);
  const latest = await db.prepare(`
    SELECT revision, snapshot
    FROM test_case_versions
    WHERE test_case_id = ?
    ORDER BY revision DESC
    LIMIT 1
  `).get(testCase.id);
  const revision = Number(latest?.revision || 0) + 1;
  const changeSummary = nextSnapshot
    ? summarizeChanges(snapshot, nextSnapshot)
    : revision === 1 ? "Initial captured version." : "Saved test case version.";

  await db.prepare(`
    INSERT INTO test_case_versions (id, test_case_id, revision, snapshot, change_summary, created_by)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(uuid(), testCase.id, revision, snapshot, changeSummary, createdBy || null);
  await db.prepare(`
    DELETE FROM test_case_versions
    WHERE test_case_id = ?
      AND revision NOT IN (
        SELECT revision FROM test_case_versions
        WHERE test_case_id = ?
        ORDER BY revision DESC
        LIMIT ${MAX_RETAINED_VERSIONS}
      )
  `).run(testCase.id, testCase.id);
  return { revision, snapshot, change_summary: changeSummary };
};

const list = async (testCaseId) => {
  const rows = await db.prepare(`
  SELECT test_case_versions.id, test_case_versions.test_case_id, test_case_versions.revision,
         test_case_versions.snapshot, test_case_versions.change_summary, test_case_versions.created_by,
         test_case_versions.created_at, users.name AS created_by_name, users.email AS created_by_email
  FROM test_case_versions
  LEFT JOIN users ON users.id = test_case_versions.created_by
  WHERE test_case_versions.test_case_id = ?
  ORDER BY test_case_versions.revision DESC
  `).all(testCaseId);
  return {
    current_revision: Number(rows[0]?.revision || 0) + 1,
    retained_limit: MAX_RETAINED_VERSIONS,
    versions: rows.map((row) => ({
      revision: Number(row.revision),
      captured_at: row.created_at || null,
      captured_by: row.created_by_name || row.created_by_email || row.created_by || null,
      reason: row.change_summary || "Saved test case version.",
      title: row.snapshot?.title || "Untitled test case",
      status: row.snapshot?.status || null,
      step_count: Array.isArray(row.snapshot?.steps) ? row.snapshot.steps.length : 0
    }))
  };
};

const get = async (testCaseId, revision) => {
  const normalizedRevision = normalizeRevision(revision);
  const row = await db.prepare(`
    SELECT test_case_versions.*, users.name AS created_by_name, users.email AS created_by_email
    FROM test_case_versions
    LEFT JOIN users ON users.id = test_case_versions.created_by
    WHERE test_case_versions.test_case_id = ? AND test_case_versions.revision = ?
  `).get(testCaseId, normalizedRevision);
  if (!row) {
    const error = new Error("Test case version not found.");
    error.statusCode = 404;
    throw error;
  }
  return {
    schema: "hellotest.testCaseVersion.v1",
    revision: Number(row.revision),
    captured_at: row.created_at,
    captured_by: row.created_by_name || row.created_by_email || row.created_by || null,
    reason: row.change_summary || "Saved test case version.",
    content: row.snapshot
  };
};

const currentRevision = async (testCaseId) => {
  const row = await db.prepare("SELECT COALESCE(MAX(revision), 0) + 1 AS revision FROM test_case_versions WHERE test_case_id = ?").get(testCaseId);
  return Number(row?.revision || 1);
};

const assertExpectedRevision = async (testCaseId, expectedRevision) => {
  if (expectedRevision === undefined || expectedRevision === null) return;
  const normalized = Number(expectedRevision);
  if (!Number.isSafeInteger(normalized) || normalized < 1) {
    const error = new Error("expected_revision must be a positive integer.");
    error.statusCode = 400;
    throw error;
  }
  const current = await currentRevision(testCaseId);
  if (current !== normalized) {
    const error = new Error("This test case changed after version history was loaded. Refresh and retry.");
    error.statusCode = 409;
    error.code = "REVISION_CONFLICT";
    throw error;
  }
};

const restore = async ({ testCaseId, revision, userId, expectedRevision }) => {
  const version = await get(testCaseId, revision);
  const testCaseService = require("./testCase.service");
  const existing = await testCaseService.getTestCase(testCaseId);
  await testCaseService.updateTestCase(testCaseId, {
    ...version.content,
    test_data_set_ids: Array.isArray(version.content?.test_data_set_ids)
      ? version.content.test_data_set_ids.slice(0, 1)
      : [],
    expected_revision: expectedRevision,
    review_status: "not_requested",
    review_history: [
      ...(Array.isArray(existing.review_history) ? existing.review_history : []),
      {
        id: uuid(),
        status: "changes_requested",
        comment: `Restored from revision ${Number(revision)}; human review is required.`,
        user_id: userId,
        created_at: new Date().toISOString()
      }
    ],
    updated_by: userId
  });
  const versions = await list(testCaseId);
  const appType = existing.app_type_id
    ? await db.prepare("SELECT id, project_id FROM app_types WHERE id = ?").get(existing.app_type_id)
    : null;
  await workspaceTransactionService.createTransaction({
    project_id: appType?.project_id || null,
    app_type_id: appType?.id || null,
    category: "test_management",
    action: "restore-version",
    status: "completed",
    title: `Restored ${existing.display_id || existing.title || testCaseId} from revision ${Number(revision)}`,
    description: "The displaced content was retained and the restored case requires human review.",
    metadata: {
      test_case_id: testCaseId,
      display_id: existing.display_id || null,
      restored_from_revision: Number(revision),
      revision: versions.current_revision
    },
    related_kind: "test_case",
    related_id: testCaseId,
    created_by: userId,
    completed_at: new Date().toISOString()
  }).catch((error) => {
    console.warn("Unable to record test case version restore audit", { testCaseId, message: error.message });
  });
  return {
    restored: true,
    restored_from_revision: Number(revision),
    revision: versions.current_revision,
    test_case: await testCaseService.getTestCase(testCaseId)
  };
};

module.exports = {
  assertExpectedRevision,
  buildSnapshot,
  capture,
  currentRevision,
  get,
  list,
  normalizeRevision,
  restore,
  summarizeChanges
};
