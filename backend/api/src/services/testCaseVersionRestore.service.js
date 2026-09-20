const { randomUUID: uuid } = require("crypto");
const db = require("../db");
const testCaseService = require("./testCase.service");
const testCaseVersionService = require("./testCaseVersion.service");
const workspaceTransactionService = require("./workspaceTransaction.service");

const createRestoreVersion = ({
  database = db,
  testCases = testCaseService,
  versions = testCaseVersionService,
  transactions = workspaceTransactionService,
  createId = uuid,
  now = () => new Date().toISOString(),
  warn = (...args) => console.warn(...args)
} = {}) => async ({ testCaseId, revision, userId, expectedRevision }) => {
  const version = await versions.get(testCaseId, revision);
  const existing = await testCases.getTestCase(testCaseId);
  await testCases.updateTestCase(testCaseId, {
    ...version.content,
    test_data_options: version.content?.test_data_options || {},
    test_data_set_ids: Array.isArray(version.content?.test_data_set_ids)
      ? version.content.test_data_set_ids.slice(0, 1)
      : [],
    expected_revision: expectedRevision,
    reviewer_id: existing.reviewer_id || userId,
    review_status: "pending",
    updated_by: userId
  }, {
    reviewHistoryEntry: {
        id: createId(),
        status: "pending",
        comment: `Restored from revision ${Number(revision)}; human review is required.`,
        user_id: userId,
        created_at: now()
    }
  });

  const versionHistory = await versions.list(testCaseId);
  const appType = existing.app_type_id
    ? await database.prepare("SELECT id, project_id FROM app_types WHERE id = ?").get(existing.app_type_id)
    : null;

  await transactions.createTransaction({
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
      revision: versionHistory.current_revision
    },
    related_kind: "test_case",
    related_id: testCaseId,
    created_by: userId,
    completed_at: now()
  }).catch((error) => {
    warn("Unable to record test case version restore audit", { testCaseId, message: error.message });
  });

  return {
    restored: true,
    restored_from_revision: Number(revision),
    revision: versionHistory.current_revision,
    test_case: await testCases.getTestCase(testCaseId)
  };
};

module.exports = {
  createRestoreVersion,
  restore: createRestoreVersion()
};
