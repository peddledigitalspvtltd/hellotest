const assert = require("node:assert/strict");
const test = require("node:test");
const Fastify = require("fastify");
const routes = require("../src/routes/requirements.routes");
const validator = require("../src/plugins/validator");
const service = require("../src/services/requirement.service");
const projectService = require("../src/services/project.service");
const batchService = require("../src/services/batchProcess.service");

async function fixture(t, { denyScope = false, deniedPermission = null } = {}) {
  const calls = { permissions: [], writes: [] };
  t.mock.method(projectService, "getProject", async id => ({ id }));
  t.mock.method(service, "getRequirement", async id => ({ id, project_id: "project", iteration_id: "sprint" }));
  t.mock.method(service, "createRequirement", async input => { calls.writes.push(input); return { id: "story" }; });
  t.mock.method(service, "updateRequirement", async (id, input) => { calls.writes.push(input); return { updated: true }; });
  t.mock.method(service, "replaceRelatedRequirements", async (id, requirementIds) => { calls.writes.push({ id, requirementIds }); return { updated: true }; });
  t.mock.method(batchService, "queueRequirementImport", async input => { calls.writes.push(input); return { id: "job" }; });
  const app = Fastify();
  t.after(() => app.close());
  app.decorate("authenticate", async request => { request.user = { id: "actor" }; });
  app.decorate("requirePermission", (permission, { projectId }) => async () => {
    calls.permissions.push({ permission, projectId });
    if ((denyScope && permission === "requirement_iteration.update") || permission === deniedPermission) throw Object.assign(new Error("Forbidden"), { statusCode: 403 });
  });
  await app.register(validator);
  await app.register(routes);
  return { app, calls };
}

test("Story create passes a local Release assignment to the same write after project-scoped permission", async t => {
  const { app, calls } = await fixture(t);
  const response = await app.inject({ method: "POST", url: "/requirements", payload: { project_id: "project", title: "Story", release_id: "release" } });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(calls.permissions, [{ permission: "requirement.create", projectId: "project" }, { permission: "requirement_iteration.update", projectId: "project" }]);
  assert.equal(calls.writes[0].release_id, "release");
  assert.equal(calls.writes[0].created_by, "actor");
});

test("denied Release selection and removal never call Story persistence", async t => {
  const { app, calls } = await fixture(t, { denyScope: true });
  for (const request of [
    { method: "POST", url: "/requirements", payload: { project_id: "project", title: "Story", release_id: "release" } },
    { method: "PUT", url: "/requirements/story", payload: { release_id: "release" } },
    { method: "PUT", url: "/requirements/story", payload: { release_id: "" } },
    { method: "POST", url: "/requirements/import", payload: { project_id: "project", rows: [{ title: "Story", iteration_id: "sprint", release_id: "release" }] } }
  ]) assert.equal((await app.inject(request)).statusCode, 403);
  assert.equal(calls.writes.length, 0);
});

test("ordinary edits and legacy text imports preserve their existing permission requirements", async t => {
  const { app, calls } = await fixture(t, { denyScope: true });
  const edited = await app.inject({ method: "PUT", url: "/requirements/story", payload: { title: "Edited Story", iteration_id: "sprint" } });
  const imported = await app.inject({ method: "POST", url: "/requirements/import", payload: { project_id: "project", rows: [{ title: "Story", sprint: "Legacy text" }] } });
  assert.equal(edited.statusCode, 200);
  assert.equal(imported.statusCode, 200);
  assert.ok(calls.permissions.every(call => call.permission !== "requirement_iteration.update"));
  assert.equal(calls.writes.length, 2);
});

test("cross-project Story update checks planning grants in both source and target projects", async t => {
  const { app, calls } = await fixture(t);
  const response = await app.inject({ method: "PUT", url: "/requirements/story", payload: { project_id: "target", release_id: "target-release" } });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(calls.permissions.filter(call => call.permission === "requirement_iteration.update").map(call => call.projectId), ["project", "target"]);
});

test('Story imports cannot bypass edit or relationship permissions', async t => {
  for (const [permission, row] of [
    ['requirement.import',{title:'Story'}],
    ['requirement.update',{title:'Story',story_id:'saved',expected_revision:1}],
    ['testcase.update',{title:'Story',linked_test_cases:[]}],
    ['feedback.manage',{title:'Story',linked_bugs:[]}]
  ]) await t.test(permission, async scoped => {
    const {app,calls}=await fixture(scoped,{deniedPermission:permission});
    assert.equal((await app.inject({method:'POST',url:'/requirements/import',payload:{project_id:'project',rows:[row]}})).statusCode,403);
    assert.equal(calls.writes.length,0);
  });
});

test('replacing related Stories requires update permission in the owning project', async t => {
  await t.test('denied access prevents linking and unlinking', async scoped => {
    const { app, calls } = await fixture(scoped, { deniedPermission: 'requirement.update' });
    for (const requirement_ids of [[], ['other-story']]) {
      const response = await app.inject({ method: 'PUT', url: '/requirements/story/related-requirements', payload: { requirement_ids } });
      assert.equal(response.statusCode, 403);
    }
    assert.equal(calls.writes.length, 0);
    assert.deepEqual(calls.permissions, Array.from({ length: 2 }, () => ({ permission: 'requirement.update', projectId: 'project' })));
  });
  await t.test('authorized replacement passes the complete reviewed selection', async scoped => {
    const { app, calls } = await fixture(scoped);
    const response = await app.inject({ method: 'PUT', url: '/requirements/story/related-requirements', payload: { requirement_ids: ['incoming-story', 'new-story'] } });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(calls.permissions, [{ permission: 'requirement.update', projectId: 'project' }]);
    assert.deepEqual(calls.writes, [{ id: 'story', requirementIds: ['incoming-story', 'new-story'] }]);
  });
});
