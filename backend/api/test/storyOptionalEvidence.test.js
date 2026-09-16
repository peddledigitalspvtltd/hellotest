const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");
const permissionService = require("../src/services/permission.service");
const featureFlagService = require("../src/services/featureFlag.service");
const { getOptionalEvidenceAccess } = require("../src/services/optionalEvidenceAccess.service");

const project = { id: "project-one", display_id: "PRJ_1", name: "Story project" };
const member = { id: "author", role: "member" };
const story = {
  id: "story-one", project_id: project.id, display_id: "STORY_1", title: "Review a report",
  description: "As a reviewer, I want to inspect a report so that I can decide its next state.",
  status: "draft", priority: 3, external_references: [], labels: [], revision: 1
};

// Load the real service with an isolated database so even module-level prepared
// statements remain observable. All authorization/evidence code stays real.
function loadService(name, overrides) {
  const filename = path.resolve(__dirname, `../src/services/${name}.service.js`);
  const localRequire = createRequire(filename);
  const module = { exports: {} };
  new Function("require", "module", "exports", fs.readFileSync(filename, "utf8"))(
    id => Object.hasOwn(overrides, id) ? overrides[id] : localRequire(id), module, module.exports
  );
  return module.exports;
}

function accessFixture(t, { grants = [], disabled = [], actor = member } = {}) {
  const checked = [];
  t.mock.method(featureFlagService, "getDisabledPermissionCodes", async codes => codes.filter(code => disabled.includes(code)));
  t.mock.method(permissionService, "hasPermission", async (user, code, projectId) => {
    checked.push({ user, code, projectId });
    return user === actor && projectId === project.id && grants.includes(code);
  });
  return checked;
}

test("optional evidence requires the actual project grant and an enabled feature, even for admin actors", async t => {
  const actor = { id: "admin", role: "admin" };
  const checked = accessFixture(t, { actor, grants: ["testcase.view", "feedback.view"], disabled: ["testcase.view"] });
  assert.deepEqual(await getOptionalEvidenceAccess(actor, project.id, ["testcase.view", "feedback.view", "comment.view", "feedback.view"]), {
    "testcase.view": false, "feedback.view": true, "comment.view": false
  });
  assert.deepEqual(checked.map(item => item.code), ["feedback.view", "comment.view"]);
  assert.ok(checked.every(item => item.user === actor && item.projectId === project.id));
  assert.deepEqual(await getOptionalEvidenceAccess(actor, "foreign-project", ["feedback.view"]), { "feedback.view": false });
});

test("missing actor or project never reads permissions or features for optional evidence", async t => {
  t.mock.method(featureFlagService, "getDisabledPermissionCodes", async () => { assert.fail("Unexpected feature read"); });
  t.mock.method(permissionService, "hasPermission", async () => { assert.fail("Unexpected permission read"); });
  for (const [actor, projectId] of [[null, project.id], [{}, project.id], [member, null]]) {
    assert.deepEqual(await getOptionalEvidenceAccess(actor, projectId, ["testcase.view"]), { "testcase.view": false });
  }
});

function optimizationFixture({ permittedCases = false, provider = false } = {}) {
  const queries = [];
  const knowledgeRequests = [];
  const prompts = [];
  const db = { prepare(sql) {
    return {
      async get(...args) {
        queries.push({ sql, args });
        assert.match(sql, /SELECT \* FROM requirements WHERE id = \?/);
        assert.deepEqual(args, [story.id]);
        return { ...story, labels: '["review"]', external_references: '[]' };
      },
      async all(...args) {
        assert.ok(permittedCases, "Unavailable Test Case evidence must never be read");
        queries.push({ sql, args });
        assert.match(sql, /app_types\.project_id = requirements\.project_id/);
        assert.deepEqual(args, [story.id]);
        return [{ id: "case-one", title: "PERMITTED_CASE_SENTINEL", description: "Report review coverage", status: "ready" }];
      }
    };
  } };
  const service = loadService("requirement", {
    "../db": db,
    "./aiKnowledge.service": { async buildKnowledgeContextPackage(projectId, options) { knowledgeRequests.push({ projectId, options }); return { knowledge: [], access_restricted: true }; } },
    "./aiLlmSelection.service": { async resolveLlmIntegrationForUsage() { return provider ? { id: "llm", type: "llm", name: "Fixture reviewer", model: "fixture", is_active: true, base_url: "https://llm.invalid/v1" } : null; } },
    "../utils/llmHttpClient": { async fetchLlmWithRetry(_url, options) {
      prompts.push(JSON.parse(options.body));
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ title: story.title, description: story.description, priority: story.priority, status: story.status, evidence_refs: [`story:${story.id}`], field_evidence: { title: [`story:${story.id}`], description: [`story:${story.id}`] } }) } }] }), { status: 200, headers: { "content-type": "application/json" } });
    } }
  });
  return { service, queries, knowledgeRequests, prompts };
}

test("Story optimization calls its configured model while disabled or denied Test Cases remain unread", async t => {
  for (const scenario of ["disabled", "denied"]) await t.test(scenario, async t => {
    const actor = scenario === "disabled" ? { id: "admin", role: "admin" } : member;
    accessFixture(t, { actor, grants: scenario === "disabled" ? ["testcase.view"] : [], disabled: scenario === "disabled" ? ["testcase.view"] : [] });
    const { service, queries, knowledgeRequests, prompts } = optimizationFixture({ provider: true });
    const result = await service.previewRequirementOptimization({ id: story.id, user: actor });
    assert.equal(result.preview_only, true);
    assert.equal(result.generation_mode, "llm");
    assert.deepEqual(result.evidence.map(item => item.type), ["story"]);
    assert.ok(result.limitations.some(item => /Test Case evidence is unavailable/.test(item)));
    assert.equal(queries.length, 1, "Only the saved Story is queried; linked-record hydration must stay off");
    assert.equal(knowledgeRequests[0].options.user, actor, "Knowledge retains the full authenticated actor");
    assert.equal(knowledgeRequests[0].projectId, project.id);
    assert.equal(prompts.length, 1);
    assert.doesNotMatch(JSON.stringify(prompts), /PERMITTED_CASE_SENTINEL/);
  });
});

test("permitted linked Test Cases contribute evidence within the Story's project", async t => {
  accessFixture(t, { grants: ["testcase.view"] });
  const { service, queries } = optimizationFixture({ permittedCases: true });
  const result = await service.previewRequirementOptimization({ id: story.id, user: member });
  assert.equal(queries.length, 2);
  assert.ok(result.evidence.some(item => item.ref === "test-case:case-one" && item.title === "PERMITTED_CASE_SENTINEL"));
  assert.ok(!result.limitations.some(item => /Test Case evidence is unavailable/.test(item)));
});

function groomingFixture(allowedSources = []) {
  const queries = [];
  const sourceForSql = sql => /FROM entity_comments/.test(sql) ? "comment" : /FROM attachments/.test(sql) ? "attachment" : /FROM requirement_test_cases/.test(sql) ? "testcase" : /FROM requirement_defects/.test(sql) ? "feedback" : null;
  const db = { prepare(sql) {
    const source = sourceForSql(sql);
    assert.ok(source && allowedSources.includes(source), `Unexpected evidence query: ${sql}`);
    return {
      async all(...args) {
        queries.push({ sql, args, source, kind: "list" });
        if (source === "comment") return [{ id: "comment-one", body: "PERMITTED_COMMENT_SENTINEL" }];
        if (source === "attachment") return [{ id: "attachment-one", file_name: "PERMITTED_ATTACHMENT_SENTINEL", mime_type: "text/plain", size_bytes: 30 }];
        if (source === "testcase") return [{ id: "case-one", display_id: "TC_1", title: "PERMITTED_CASE_SENTINEL", status: "ready" }];
        return [{ id: "bug-one", jira_bug_key: "BUG_1", title: "PERMITTED_BUG_SENTINEL", status: "open" }];
      },
      async get(...args) { queries.push({ sql, args, source, kind: "count" }); return { count: 1 }; }
    };
  } };
  const service = loadService("requirementWorkspace", {
    "../db": db,
    "./aiLlmSelection.service": { resolveLlmIntegrationForUsage: async () => null }
  });
  return { service, queries };
}

test("Story grooming succeeds from core Story context without querying denied evidence or counts", async t => {
  accessFixture(t, { grants: ["testcase.view", "feedback.view"], disabled: ["testcase.view", "feedback.view"] });
  const { service, queries } = groomingFixture();
  const result = await service.previewGrooming({ requirement: story, project, user: member });
  assert.equal(result.preview_only, true);
  assert.equal(result.requirement.id, story.id);
  assert.equal(queries.length, 0);
  assert.deepEqual(result.context.sources.map(item => item.type), ["story"]);
  assert.deepEqual(result.context.unavailable_sources, ["comments", "attachments", "related_project_records", "linked_tickets"]);
  assert.equal(result.context.included.linked_tickets, 0);
  assert.equal(result.context.included.related_project_records, 0);
});

test("Story grooming reads only permitted collaborators and scopes linked records to its project", async t => {
  accessFixture(t, { grants: ["comment.view", "testcase.view"] });
  const { service, queries } = groomingFixture(["comment", "testcase"]);
  const result = await service.previewGrooming({ requirement: story, project, user: member });
  assert.equal(queries.length, 4, "One list and count per available evidence source");
  assert.deepEqual(result.context.sources.map(item => item.type), ["story", "comment", "related-project-record"]);
  assert.deepEqual(result.context.unavailable_sources, ["attachments", "linked_tickets"]);
  assert.doesNotMatch(JSON.stringify(result), /PERMITTED_BUG_SENTINEL|PERMITTED_ATTACHMENT_SENTINEL/);
  for (const query of queries.filter(item => item.source === "testcase")) {
    assert.match(query.sql, /app_types\.project_id = \?/);
    assert.deepEqual(query.args, [story.id, project.id]);
  }
});

test("Story grooming reads permitted Bugs with a project constraint", async t => {
  accessFixture(t, { grants: ["feedback.view"] });
  const { service, queries } = groomingFixture(["feedback"]);
  const result = await service.previewGrooming({ requirement: story, project, user: member });
  assert.equal(result.context.included.linked_tickets, 1);
  for (const query of queries) {
    assert.match(query.sql, /feedback\.project_id = \?/);
    assert.deepEqual(query.args, [story.id, project.id]);
  }
});
