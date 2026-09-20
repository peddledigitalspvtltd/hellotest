const assert = require("node:assert/strict");
const { readFile } = require("node:fs/promises");
const path = require("node:path");
const test = require("node:test");
const { paginate, shouldPaginate } = require("../src/utils/pagination");
const { requirementMetadata, issueMetadata } = require("../src/utils/nativeIssueMetadata");
const { assertExpectedRevision, normalizeExpectedRevision } = require("../src/utils/revision");
const { ROUTE_PERMISSIONS } = require("../src/security/permissions.catalog");
const { validateInput } = require("../src/plugins/validator");

const readSource = (relativePath) => readFile(path.join(__dirname, relativePath), "utf8");

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

test("native Story and Bug metadata preserves the reference UI field contract", async (t) => {
  t.mock.method(require("../src/services/dropdownCatalog.service"), "getOptions", async () => []);
  const project = { id: "project-1", display_id: "QA" };
  const story = requirementMetadata({ project, mode: "edit", currentValues: { status: "open" } });
  const bug = await issueMetadata({ project });

  assert.equal(story.issue_type_name, "Story");
  assert.equal(story.project_key, "QA");
  assert.equal(story.workflow_statuses.statuses.some((status) => status.current), true);
  assert.equal(story.core_fields.some((item) => item.id === "summary" && item.required), true);
  assert.equal(bug.issue_type_name, "Defect");
  assert.equal(bug.core_fields.some((item) => item.id === "assignee"), true);
  assert.match(story.strategy.requirements_source, /PostgreSQL/);
});

test("Bug classification metadata includes active custom choices and only the saved retired value", async (t) => {
  t.mock.method(require("../src/services/dropdownCatalog.service"), "getOptions", async (key, options) => {
    assert.deepEqual(options, { includeInactive: true });
    return [
      { value: `${key}-active`, label: "Custom active classification", active: true },
      { value: `${key}-retired`, label: "Retired classification", active: false },
      { value: `${key}-other-retired`, label: "Other retired classification", active: false }
    ];
  });
  const project = { id: "project" };
  const created = await issueMetadata({ project });
  for (const field of created.core_fields.filter(field => ["root_cause", "qa_root_cause", "bug_type"].includes(field.id))) {
    assert.equal(field.allowed_values.length, 1);
    assert.equal(field.allowed_values[0].label, "Custom active classification");
  }
  const edited = await issueMetadata({ project, mode: "edit", currentValues: { root_cause: "issues.root_causes-retired", qa_root_cause: "Legacy cause" } });
  assert.deepEqual(edited.core_fields.find(field => field.id === "root_cause").allowed_values.map(option => option.value), ["issues.root_causes-active", "issues.root_causes-retired"]);
  assert.equal(edited.core_fields.find(field => field.id === "root_cause").allowed_values[1].inactive, true);
  const legacy = edited.core_fields.find(field => field.id === "qa_root_cause").allowed_values.find(option => option.value === "Legacy cause");
  assert.equal(legacy.current, true);
  assert.equal(legacy.inactive, true);
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

test("Complete Story keeps external pointers and validated image context end to end", async () => {
  const [routeSource, serviceSource] = await Promise.all([
    readSource("../src/routes/requirements.routes.js"),
    readSource("../src/services/requirement.service.js")
  ]);

  assert.match(routeSource, /external_links: \{ required: false, type: "array", items: "string", maxItems: 20 \}/);
  assert.match(routeSource, /images: \{ required: false, type: "array", maxItems: 6 \}/);
  assert.match(routeSource, /external_links: req\.body\?\.external_links/);
  assert.match(routeSource, /images: req\.body\?\.images/);

  for (const contractMarker of [
    "(?:png|jpe?g|webp)",
    "INVALID_AI_REFERENCE_IMAGE",
    "REQUIREMENT_AI_REFERENCE_IMAGE_TOTAL_CHARS",
    'type: "image_url"',
    "External URLs are opaque pointers only. Their page contents were not fetched.",
    "not analyzed by the deterministic fallback"
  ]) {
    assert.equal(serviceSource.includes(contractMarker), true, contractMarker);
  }
});

test("Test Improve accepts pointer-only links and validated image context without widening step rephrase", async () => {
  const [routeSource, serviceSource] = await Promise.all([
    readSource("../src/routes/testCases.routes.js"),
    readSource("../src/services/aiCaseAuthoring.service.js")
  ]);
  const improveRoute = routeSource.slice(
    routeSource.indexOf('fastify.post("/test-cases/ai-authoring-preview"'),
    routeSource.indexOf('fastify.post("/test-cases/ai-step-rephrase"')
  );
  const stepRoute = routeSource.slice(
    routeSource.indexOf('fastify.post("/test-cases/ai-step-rephrase"'),
    routeSource.indexOf('fastify.post("/test-cases/design-test-cases-accept"')
  );
  const stepService = serviceSource.slice(serviceSource.indexOf("exports.rephraseTestStep"));

  assert.match(improveRoute, /external_links: \{ required: false, type: "array", items: "string", maxItems: 20 \}/);
  assert.match(improveRoute, /images: \{ required: false, type: "array", maxItems: 6 \}/);
  assert.match(improveRoute, /external_links: req\.body\.external_links/);
  assert.match(improveRoute, /images: req\.body\.images/);
  assert.doesNotMatch(stepRoute, /external_links|images/);
  assert.doesNotMatch(stepService, /external_links|safeImages/);

  for (const contractMarker of [
    "(?:png|jpe?g|webp)",
    "INVALID_AI_REFERENCE_IMAGE",
    "TEST_CASE_AI_REFERENCE_IMAGE_TOTAL_CHARS",
    'type: "image_url"',
    "External URLs are opaque pointers only. Their page contents were not fetched.",
    "requestChatCompletion({ integration, prompt, images: safeImages, fallbackContent, contextState })"
  ]) {
    assert.equal(serviceSource.includes(contractMarker), true, contractMarker);
  }
});

test("AI Bug drafting keeps pointer links, validated image data, and canonical Bug priorities", async () => {
  const [routeSource, serviceSource] = await Promise.all([
    readSource("../src/routes/issues.routes.js"),
    readSource("../src/services/aiBugDraft.service.js")
  ]);

  assert.match(routeSource, /external_links: \{ required: false, type: "array", items: "string", maxItems: 12 \}/);
  assert.match(routeSource, /reference_photos: \{ required: false, type: "array", maxItems: 6 \}/);

  for (const contractMarker of [
    "IMAGE_DATA_URL_PATTERN",
    'type: "image_url"',
    "External links are pointers only; their contents were not fetched.",
    'p1: "Highest"',
    'priority (Highest|High|Medium|Low|Lowest)',
    "reference_photos: imageAssets.map",
    'capability: "ai-bug-draft"'
  ]) {
    assert.equal(serviceSource.includes(contractMarker), true, contractMarker);
  }
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
