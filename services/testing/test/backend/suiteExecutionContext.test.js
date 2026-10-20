const test = require("node:test");
const assert = require("node:assert/strict");
const db = require("../../../platform/backend/src/db");
const { loadSuiteContexts } = require("../../backend/services/suiteExecutionContext.service");

test("suite use case accepts a repository port and enforces application scope without SQL", async () => {
  const { createSuiteExecutionContext } = require("../../backend/services/suiteExecutionContext.service");
  const calls = [];
  const service = createSuiteExecutionContext({
    async findDescendants(ids) { calls.push(ids); return [{ id: "suite", app_type_id: "app" }, { id: "child", app_type_id: "app" }]; },
    async findAncestors() { return [{ id: "suite", app_type_id: "app", project_id: "project", test_data_set_id: "data" }]; },
    async findDataSets() { return [{ id: "data", app_type_id: "other-app", project_id: "project" }]; }
  });
  assert.deepEqual(await service.expandSuiteSelection(["suite", "suite"], "app"), ["suite", "child"]);
  assert.deepEqual(calls, [["suite"]]);
  await assert.rejects(service.expandSuiteSelection(["suite"], "other-app"), { statusCode: 400 });
  await assert.rejects(service.expandSuiteSelection(["missing"], "app"), { statusCode: 400 });
  assert.equal((await service.loadSuiteContexts(["suite"])).get("suite").dataSet, null);
});

test("selected ancestry shares one dataset load while preserving nearest overrides", async (context) => {
  const rows = [
    { id: "parent", app_type_id: "app", project_id: "project", parameter_values: { tenant: "parent" }, test_data_set_id: "shared" },
    { id: "child", parent_id: "parent", app_type_id: "app", project_id: "project", parameter_values: { tenant: "child" }, test_data_set_id: "shared" },
    { id: "leaf", parent_id: "child", app_type_id: "app", project_id: "project", test_data_set_id: "leaf-data" }
  ];
  const shared = { id: "shared", project_id: "project", app_type_id: null, rows: [{ customer: "shared row" }] };
  const leaf = { id: "leaf-data", project_id: "project", app_type_id: "app", rows: [{ customer: "leaf row" }] };
  const calls = [];
  context.mock.method(db, "prepare", sql => ({ all: async (...args) => {
    calls.push({ sql, args });
    return calls.length === 1 ? rows : [shared, leaf];
  } }));
  const result = await loadSuiteContexts(["child", "leaf", "child"]);
  assert.equal(calls.length, 2);
  assert.match(calls[0].sql, /WITH RECURSIVE ancestry/);
  assert.doesNotMatch(calls[0].sql, /UNION ALL|row_to_json|data\.rows/);
  assert.deepEqual(calls[0].args, ["child", "leaf"]);
  assert.deepEqual(calls[1].args, ["shared", "leaf-data"], "Shared dataset is fetched once, not once per suite.");
  assert.deepEqual(result.get("child"), { dataOptions: { override_lower_scopes: true, override_shared_steps: true, override_shared_sections: true, override_test_case_data: true, override_suite_data: true }, parameters: { "s.tenant": "child" }, dataSet: shared });
  assert.deepEqual(result.get("leaf"), { dataOptions: { override_lower_scopes: true, override_shared_steps: true, override_shared_sections: true, override_test_case_data: true, override_suite_data: true }, parameters: { "s.tenant": "child" }, dataSet: leaf });
});

test("a batched dataset authorized for one suite cannot cross another app or project", async (context) => {
  const rows = [
    { id: "valid", app_type_id: "app-a", project_id: "project-a", test_data_set_id: "data" },
    { id: "wrong-app", app_type_id: "app-b", project_id: "project-a", test_data_set_id: "data" },
    { id: "wrong-project", app_type_id: "app-c", project_id: "project-b", test_data_set_id: "data" }
  ];
  let reads = 0;
  context.mock.method(db, "prepare", () => ({ all: async () => ++reads === 1 ? rows
    : [{ id: "data", app_type_id: "app-a", project_id: "project-a", rows: [{ token: "app-a-only" }] }] }));
  const result = await loadSuiteContexts(rows.map(row => row.id));
  assert.equal(result.get("valid").dataSet.rows[0].token, "app-a-only");
  assert.equal(result.get("wrong-app").dataSet, null);
  assert.equal(result.get("wrong-project").dataSet, null);
});

test("empty selection and ancestry without data never dispatch a dataset query", async (context) => {
  let reads = 0;
  context.mock.method(db, "prepare", () => ({ all: async () => {
    reads++;
    return [{ id: "a", parent_id: "b", app_type_id: "app", project_id: "project", parameter_values: { tenant: "a" } },
      { id: "b", parent_id: "a", app_type_id: "app", project_id: "project", parameter_values: { tenant: "b" } }];
  } }));
  assert.equal((await loadSuiteContexts([])).size, 0);
  assert.equal(reads, 0);
  const result = await loadSuiteContexts(["a", "missing"]);
  assert.equal(reads, 1);
  assert.deepEqual(result.get("a"), { dataOptions: { override_lower_scopes: true, override_shared_steps: true, override_shared_sections: true, override_test_case_data: true, override_suite_data: true }, parameters: { "s.tenant": "a" }, dataSet: null });
  assert.deepEqual(result.get("missing"), { dataOptions: { override_lower_scopes: true, override_shared_steps: true, override_shared_sections: true, override_test_case_data: true, override_suite_data: true }, parameters: {}, dataSet: null });
});

test('suite policies inherit without data and explicit child overrides remain independent', () => {
  const { resolveSuiteContexts } = require('../../backend/services/suiteExecutionContext.service');
  const rows=[{id:'parent',app_type_id:'app',test_data_options:{override_test_case_data:false,override_shared_steps:false}},
    {id:'child',parent_id:'parent',app_type_id:'app',test_data_options:{}},
    {id:'override',parent_id:'parent',app_type_id:'app',test_data_options:{override_test_case_data:true,override_shared_steps:false}}];
  const contexts=resolveSuiteContexts(rows,['child','override']);
  assert.equal(contexts.get('child').dataOptions.override_test_case_data,false);
  assert.equal(contexts.get('child').dataOptions.override_shared_steps,false);
  assert.equal(contexts.get('override').dataOptions.override_test_case_data,true);
  assert.equal(contexts.get('override').dataOptions.override_shared_steps,false);
});
