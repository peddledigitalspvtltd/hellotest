const test = require("node:test");
const assert = require("node:assert/strict");
const Fastify = require("fastify");
const groups = require("../src/services/sharedStepGroup.service");
const appTypes = require("../src/services/appType.service");
const projects = require("../src/services/project.service");

const setup = async (context, denied = "data.view") => {
  const group = { id: "group", app_type_id: "app", name: "Login", test_data_set_id: "data", test_data_row_index: 1,
    test_data_set: { id: "data", name: "Private credentials", rows: [{ username: "private" }] } };
  context.mock.method(groups, "listSharedStepGroups", async () => [group]);
  context.mock.method(groups, "getSharedStepGroup", async () => group);
  context.mock.method(appTypes, "getAppType", async () => ({ id: "app", project_id: "project", type: "web" }));
  context.mock.method(projects, "getProject", async () => ({ id: "project" }));
  const writes = [];
  context.mock.method(groups, "createSharedStepGroup", async payload => { writes.push(payload); return { id: "new" }; });
  context.mock.method(groups, "updateSharedStepGroup", async (id, payload) => { writes.push(payload); return { updated: true }; });
  const app = Fastify();
  context.after(() => app.close());
  app.decorate("authenticate", async req => { req.user = { id: "user" }; });
  app.decorate("validate", require("../src/plugins/validator").validateInput);
  app.decorate("requirePermission", permission => async () => {
    if (permission === denied) throw Object.assign(new Error("Denied"), { statusCode: 403 });
  });
  await app.register(require("../src/routes/sharedStepGroups.routes"));
  return { app, writes };
};

test("shared group reads omit linked data contents without data access", async context => {
  const { app } = await setup(context);
  for (const url of ["/shared-step-groups?app_type_id=app", "/shared-step-groups/group"]) {
    const response = await app.inject(url);
    assert.equal(response.statusCode, 200, response.body);
    assert.doesNotMatch(response.body, /Private credentials|private|test_data_set\"/);
  }
});

test("shared group dataset linking, row changes and unlinking require data access", async context => {
  const { app, writes } = await setup(context);
  for (const payload of [{ test_data_set_id: "data" }, { test_data_set_id: null }, { test_data_row_index: 0 }]) {
    const response = await app.inject({ method: "PUT", url: "/shared-step-groups/group", payload });
    assert.equal(response.statusCode, 403, response.body);
  }
  const create = await app.inject({ method: "POST", url: "/shared-step-groups", payload: { app_type_id: "app", name: "Login", test_data_set_id: "data" } });
  assert.equal(create.statusCode, 403, create.body);
  assert.equal(writes.length, 0);
  const metadata = await app.inject({ method: "PUT", url: "/shared-step-groups/group", payload: { description: "Updated steps" } });
  assert.equal(metadata.statusCode, 200, metadata.body);
  assert.equal(writes.length, 1);
});

test("authorized dataset edits preserve the selected single row in service input", async context => {
  const { app, writes } = await setup(context, null);
  const response = await app.inject({ method: "PUT", url: "/shared-step-groups/group", payload: { test_data_set_id: "data", test_data_row_index: 3 } });
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(writes[0].test_data_row_index, 3);
});
