const assert = require("node:assert/strict");
const test = require("node:test");
const { paginate, shouldPaginate } = require("../src/utils/pagination");
const { requirementMetadata, issueMetadata } = require("../src/utils/nativeIssueMetadata");
const { assertExpectedRevision, normalizeExpectedRevision } = require("../src/utils/revision");
const { ROUTE_PERMISSIONS } = require("../src/security/permissions.catalog");
const { validateInput } = require("../src/plugins/validator");

test("reference workspaces use bounded cursor pagination", () => {
  const first = paginate(["a", "b", "c", "d"], { page_size: "2" });
  assert.deepEqual(first.items, ["a", "b"]);
  assert.equal(first.total, 4);
  assert.equal(first.is_last, false);
  assert.ok(first.next_cursor);

  const second = paginate(["a", "b", "c", "d"], { page_size: 2, cursor: first.next_cursor });
  assert.deepEqual(second.items, ["c", "d"]);
  assert.equal(second.next_cursor, null);
  assert.equal(second.is_last, true);
  assert.equal(shouldPaginate({ include_page: "true" }), true);
  assert.throws(() => paginate([], { cursor: "not-a-valid-cursor" }), /cursor is invalid/);
});

test("native Story and Bug metadata preserves the reference UI field contract", () => {
  const project = { id: "project-1", display_id: "QA" };
  const story = requirementMetadata({ project, mode: "edit", currentValues: { status: "open" } });
  const bug = issueMetadata({ project });

  assert.equal(story.issue_type_name, "Story");
  assert.equal(story.project_key, "QA");
  assert.equal(story.workflow_statuses.statuses.some((status) => status.current), true);
  assert.equal(story.core_fields.some((item) => item.id === "summary" && item.required), true);
  assert.equal(bug.issue_type_name, "Bug");
  assert.equal(bug.core_fields.some((item) => item.id === "assignee"), true);
  assert.match(story.strategy.requirements_source, /PostgreSQL/);
});

test("revision contracts reject stale writes with a conflict response", () => {
  assert.equal(normalizeExpectedRevision(undefined), null);
  assert.equal(assertExpectedRevision(4, "4", "Story"), 4);
  assert.throws(() => normalizeExpectedRevision(0), (error) => error.statusCode === 400);
  assert.throws(
    () => assertExpectedRevision(5, 4, "Story"),
    (error) => error.statusCode === 409 && error.code === "REVISION_CONFLICT" && error.current_revision === 5
  );
});

test("request contracts enforce bounded text and collection sizes", () => {
  assert.doesNotThrow(() => validateInput({ values: { type: "array", maxItems: 2 } }, { values: ["a", "b"] }));
  assert.throws(
    () => validateInput({ values: { type: "array", maxItems: 2 } }, { values: ["a", "b", "c"] }),
    /at most 2 items/
  );
  assert.throws(
    () => validateInput({ prompt: { type: "string", maxLength: 4 } }, { prompt: "12345" }),
    /at most 4 characters/
  );
});

test("every reference UI backend capability is protected by an explicit permission", () => {
  const expected = new Map([
    ["GET /admin/health", "ops.view"],
    ["POST /requirements/:id/ai-groom-preview", "requirement.ai"],
    ["POST /requirements/export", "requirement.export"],
    ["POST /test-steps/bulk", "step.manage"],
    ["PUT /test-suites/:id/assign-test-cases", "suite.update"],
    ["POST /test-data-sets/ai-generate-preview", "data.ai"],
    ["GET /executions/history", "run.view"],
    ["GET /executions/:id/cases/:testCaseId/report.pdf", "run.report.export"],
    ["GET /execution-results/release-readiness", "result.view"],
    ["PUT /execution-results/:id/defect-links", "result.manage"],
    ["GET /notifications/unread-count", "notification.view"],
    ["DELETE /notifications/:id", "notification.manage"]
  ]);

  for (const [route, permission] of expected) {
    assert.equal(ROUTE_PERMISSIONS.get(route), permission, route);
  }
});
