const assert = require("node:assert/strict");
const test = require("node:test");
const Fastify = require("fastify");
const db = require("../src/db");
const permissionService = require("../services/permission.service");
const projectService = require("../services/project.service");
const issueService = require("../../../testing/backend/services/issues.service");
const draftService = require("../../../ai/backend/services/aiBugDraft.service");
const flags = require("../services/featureFlag.service");
const { requireEntityPermission } = require("../services/entityScope.service");

const reporter = { id: "reporter", role: "member", status: "active" };
const headers = { authorization: "Bearer reporter-fixture" };
const bug = { project_id: "project-a", title: "Checkout fails", message: "Payment submission fails." };
const reporterPermissions = ["feedback.view", "feedback.create", "attachment.view", "attachment.create", "comment.view", "comment.create"];

async function fixture(t, { permissions = reporterPermissions, apiKeyScope, featuresEnabled = true } = {}) {
  const grants = new Set(permissions);
  const writes = [];
  const previews = [];
  const checks = [];
  // Exercise the real permission resolver, including the one-way compatibility
  // fallback, while keeping every database read/write inside this fixture.
  t.mock.method(db, "prepare", (sql) => ({
    get: async (...args) => {
      if (sql.includes("FROM project_deletion_jobs")) return { active: false };
      if (sql.includes("role_permissions")) {
        const permission = args.at(-1);
        const projectId = sql.includes("project_members.project_id = ?") ? args[1] : null;
        const isWorkspace = sql.includes("FROM users");
        checks.push({ permission, projectId });
        return { allowed: !isWorkspace && (!projectId || projectId === "project-a") && grants.has(permission) };
      }
      if (sql === "SELECT id, project_id FROM feedback WHERE id = ?") {
        return { id: args[0], project_id: args[0] === "foreign-bug" ? "project-b" : "project-a" };
      }
      if (sql.includes("INSERT INTO entity_comments")) {
        writes.push({ kind: "comment", args });
        return { id: args[0], project_id: args[1], entity_type: args[2], entity_id: args[3], body: args[4], created_by: args[5] };
      }
      assert.fail(`Unexpected database query: ${sql}`);
    }
  }));
  t.mock.method(projectService, "getProject", async (projectId, userId) => {
    if (projectId !== "project-a" || ![reporter.id, "project-colleague"].includes(userId)) throw Object.assign(new Error("Project access denied"), { statusCode: 403 });
    return { id: projectId };
  });
  t.mock.method(issueService, "getIssueItem", async (id) => ({ id, project_id: id === "foreign-bug" ? "project-b" : "project-a", user_id: "another-reporter" }));
  t.mock.method(issueService, "createIssue", async (input, context) => { writes.push({ kind: "create", input, context }); return { id: "new-bug", ...input }; });
  t.mock.method(issueService, "updateIssue", async () => { writes.push({ kind: "update" }); return {}; });
  t.mock.method(issueService, "deleteIssue", async () => { writes.push({ kind: "delete" }); return {}; });
  t.mock.method(draftService, "preview", async (input) => { previews.push(input); return { draft: { title: input.intent } }; });
  t.mock.method(flags, "areEnabled", async () => featuresEnabled);
  t.mock.method(flags, "isEnabled", async () => featuresEnabled);

  const app = Fastify({ logger: false });
  t.after(() => app.close());
  await app.register(require("../src/plugins/errorHandler"));
  await app.register(require("../src/plugins/validator"));
  await app.register(require("../src/plugins/accessControl"));
  app.addHook("onRequest", async (req) => {
    if (req.headers.authorization !== headers.authorization) return;
    req.user = { ...reporter };
    if (apiKeyScope) req.apiKey = { scope: apiKeyScope };
  });
  await app.register(require("../../../testing/backend/routes/issues.routes"));
  await app.register(require("../routes/comments.routes"));
  await app.ready();
  return { app, grants, writes, previews, checks };
}

test("Reporter can create Bugs through both route aliases using the authenticated author", async (t) => {
  const { app, writes } = await fixture(t);
  for (const url of ["/issues", "/feedback"]) {
    const response = await app.inject({ method: "POST", url, headers, payload: bug });
    assert.equal(response.statusCode, 200, response.body);
    assert.equal(response.json().user_id, reporter.id);
  }
  assert.equal(writes.length, 2);
  assert.ok(writes.every(({ input }) => input.project_id === "project-a" && input.user_id === reporter.id));
});

test("Selecting another reporter requires member access, project membership and preserves the authenticated creator", async (t) => {
  const { app, writes, grants } = await fixture(t);
  for (const url of ["/issues", "/feedback"]) {
    grants.delete("project_member.view");
    let response = await app.inject({ method: "POST", url, headers, payload: { ...bug, user_id: "project-colleague" } });
    assert.equal(response.statusCode, 403, response.body);
    grants.add("project_member.view");
    for (const user_id of ["outside-project", " ", null]) {
      response = await app.inject({ method: "POST", url, headers, payload: { ...bug, user_id } });
      assert.equal(response.statusCode, 400, response.body);
    }
    response = await app.inject({ method: "POST", url, headers, payload: { ...bug, user_id: "project-colleague", actorId: "forged" } });
    assert.equal(response.statusCode, 200, response.body);
    assert.equal(writes.at(-1).input.user_id, "project-colleague");
    assert.equal(writes.at(-1).context.actorId, reporter.id);
  }
  assert.equal(writes.length, 2);
});

test("create-only Reporter cannot update, delete, bulk-delete or triage Bugs", async (t) => {
  const { app, writes } = await fixture(t);
  for (const base of ["/issues", "/feedback"]) {
    for (const [method, path, payload] of [
      ["PUT", "/existing-bug", { project_id: "project-a", title: "Changed" }],
      ["DELETE", "/existing-bug", undefined],
      ["DELETE", "/bulk-delete", { project_id: "project-a", issue_ids: ["existing-bug"] }],
      ["POST", "/ai-triage-preview", { project_id: "project-a", issue_ids: ["existing-bug"] }]
    ]) {
      const response = await app.inject({ method, url: base + path, headers, ...(payload ? { payload } : {}) });
      assert.equal(response.statusCode, 403, `${method} ${base + path}: ${response.body}`);
    }
  }
  assert.deepEqual(writes, []);
  assert.equal(await permissionService.hasPermission(reporter, "project.delete", "project-a"), false);
  assert.equal(await permissionService.hasPermission(reporter, "role.manage", "project-a"), false);
});

test("legacy feedback.manage still grants creation without giving a Reporter management permission", async (t) => {
  const { app, grants, checks } = await fixture(t, { permissions: ["feedback.manage"] });
  const response = await app.inject({ method: "POST", url: "/issues", headers, payload: bug });
  assert.equal(response.statusCode, 200, response.body);
  assert.ok(checks.some(check => check.permission === "feedback.manage" && check.projectId === "project-a"));
  grants.clear();
  grants.add("feedback.create");
  assert.equal(await permissionService.hasPermission(reporter, "feedback.manage", "project-a"), false);
  assert.equal(await permissionService.hasPermission(reporter, "feedback.create", "project-b"), false);
});

test("Reporter project grants cannot be reused to create in another project", async (t) => {
  const { app, writes } = await fixture(t);
  const response = await app.inject({ method: "POST", url: "/issues", headers, payload: { ...bug, project_id: "project-b" } });
  assert.equal(response.statusCode, 403);
  assert.deepEqual(writes, []);
});

test("Bugs viewers and anonymous callers cannot create or draft Bugs", async (t) => {
  const { app, writes, previews } = await fixture(t, { permissions: ["feedback.view"] });
  for (const [url, payload] of [
    ["/issues", bug],
    ["/feedback/ai-draft-preview", { project_id: "project-a", intent: "Checkout fails" }]
  ]) {
    const viewer = await app.inject({ method: "POST", url, headers, payload });
    assert.equal(viewer.statusCode, 403);
    const anonymous = await app.inject({ method: "POST", url, payload });
    assert.equal(anonymous.statusCode, 401);
  }
  assert.deepEqual(writes, []);
  assert.deepEqual(previews, []);
});

test("AI Bug drafts require create access and view access to every linked evidence type", async (t) => {
  const { app, grants, previews } = await fixture(t);
  for (const [field, value, permissions] of [
    ["linked_test_case_ids", ["case-a"], ["testcase.view"]],
    ["linked_requirement_ids", ["story-a"], ["requirement.view"]],
    ["linked_test_run_id", "run-a", ["run.view", "result.view"]]
  ]) {
    const payload = { project_id: "project-a", intent: "Checkout fails", [field]: value };
    const denied = await app.inject({ method: "POST", url: "/issues/ai-draft-preview", headers, payload });
    assert.equal(denied.statusCode, 403, denied.body);
    permissions.forEach(permission => grants.add(permission));
    const allowed = await app.inject({ method: "POST", url: "/issues/ai-draft-preview", headers, payload });
    assert.equal(allowed.statusCode, 200, allowed.body);
  }
  assert.equal(previews.length, 3);
  const foreign = await app.inject({ method: "POST", url: "/feedback/ai-draft-preview", headers, payload: { project_id: "project-b", intent: "Checkout fails" } });
  assert.equal(foreign.statusCode, 403);
  assert.equal(previews.length, 3);
});

test("Reporter may add comments and evidence in scope, but cannot remove evidence or cross project boundaries", async (t) => {
  const { app, writes } = await fixture(t);
  const response = await app.inject({ method: "POST", url: "/comments", headers, payload: { project_id: "project-a", entity_type: "issue", entity_id: "existing-bug", body: "Reproduced on staging" } });
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(response.json().author.id, reporter.id);
  assert.equal(writes[0].kind, "comment");
  await requireEntityPermission({ user: reporter, permissionCode: "attachment.create", entityType: "issue", entityId: "existing-bug", projectId: "project-a" });
  await assert.rejects(requireEntityPermission({ user: reporter, permissionCode: "attachment.delete", entityType: "issue", entityId: "existing-bug", projectId: "project-a" }), { statusCode: 403 });
  await assert.rejects(requireEntityPermission({ user: reporter, permissionCode: "attachment.create", entityType: "issue", entityId: "foreign-bug", projectId: "project-a" }), { statusCode: 403 });
});

for (const [label, options, expectedStatus] of [
  ["a disabled Bugs feature", { featuresEnabled: false }, 403],
  ["a read-only API key", { apiKeyScope: "read" }, 403],
  ["a Runs API key", { apiKeyScope: "runs" }, 200]
]) {
  test(`create-only Bug access respects ${label}`, async (t) => {
    const { app, writes } = await fixture(t, options);
    const response = await app.inject({ method: "POST", url: "/issues", headers, payload: bug });
    assert.equal(response.statusCode, expectedStatus, response.body);
    assert.equal(writes.length, expectedStatus === 200 ? 1 : 0);
  });
}
