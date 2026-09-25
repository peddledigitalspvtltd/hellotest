const assert = require("node:assert/strict");
const { readFile } = require("node:fs/promises");
const path = require("node:path");
const test = require("node:test");

const restoreService = require("../../backend/services/testCaseVersionRestore.service");
const readSource = (relativePath) => readFile(path.join(__dirname, relativePath), "utf8");

test("test case restore orchestration keeps version persistence dependencies acyclic", async () => {
  const [testCases, versions, restore, routes] = await Promise.all([
    readSource("../../backend/services/testCase.service.js"),
    readSource("../../backend/services/testCaseVersion.service.js"),
    readSource("../../backend/services/testCaseVersionRestore.service.js"),
    readSource("../../backend/routes/testCases.routes.js")
  ]);

  assert.match(testCases, /require\("\.\/testCaseVersion\.service"\)/);
  assert.doesNotMatch(versions, /require\("\.\/testCase\.service"\)/);
  assert.match(restore, /require\("\.\/testCase\.service"\)/);
  assert.match(restore, /require\("\.\/testCaseVersion\.service"\)/);
  assert.match(routes, /testCaseVersionRestoreService\.restore\(/);
  assert.doesNotMatch(routes, /testCaseVersionService\.restore\(/);
});

test("test case restore preserves review history, dataset limits, revision checks, and audit metadata", async () => {
  const calls = [];
  let loadCount = 0;
  const existing = {
    id: "case-1",
    app_type_id: "app-1",
    display_id: "TC-42",
    reviewer_id: "assigned-reviewer",
    review_history: [{ id: "review-1", status: "accepted" }]
  };
  const restored = { ...existing, title: "Restored checkout" };
  const restore = restoreService.createRestoreVersion({
    database: {
      prepare: (sql) => ({
        get: async (appTypeId) => {
          calls.push(["load-app", sql, appTypeId]);
          return { id: "app-1", project_id: "project-1" };
        }
      })
    },
    testCases: {
      getTestCase: async (testCaseId) => {
        calls.push(["load-case", testCaseId]);
        loadCount += 1;
        return loadCount === 1 ? existing : restored;
      },
      updateTestCase: async (testCaseId, payload, options) => {
        calls.push(["update-case", testCaseId, payload, options]);
      }
    },
    versions: {
      get: async (testCaseId, revision) => {
        calls.push(["load-version", testCaseId, revision]);
        return {
          content: {
            title: "Restored checkout",
            test_data_set_ids: ["dataset-1", "dataset-2"]
          }
        };
      },
      list: async (testCaseId) => {
        calls.push(["list-versions", testCaseId]);
        return { current_revision: 8 };
      }
    },
    transactions: {
      createTransaction: async (payload) => {
        calls.push(["audit", payload]);
      }
    },
    createId: () => "review-restore-1",
    now: () => "2026-08-28T12:00:00.000Z"
  });

  const result = await restore({
    testCaseId: "case-1",
    revision: 6,
    userId: "user-1",
    expectedRevision: 7
  });

  const update = calls.find(([name]) => name === "update-case");
  assert.deepEqual(update.slice(1), ["case-1", {
    title: "Restored checkout",
    test_data_set_ids: ["dataset-1"],
    test_data_options: {},
    expected_revision: 7,
    reviewer_id: "assigned-reviewer",
    review_status: "pending",
    updated_by: "user-1"
  }, {
    reviewHistoryEntry: {
      id: "review-restore-1",
      status: "pending",
      comment: "Restored from revision 6; human review is required.",
      user_id: "user-1",
      created_at: "2026-08-28T12:00:00.000Z"
    }
  }]);

  const audit = calls.find(([name]) => name === "audit")[1];
  assert.equal(audit.project_id, "project-1");
  assert.equal(audit.action, "restore-version");
  assert.deepEqual(audit.metadata, {
    test_case_id: "case-1",
    display_id: "TC-42",
    restored_from_revision: 6,
    revision: 8
  });
  assert.deepEqual(result, {
    restored: true,
    restored_from_revision: 6,
    revision: 8,
    test_case: restored
  });
});
