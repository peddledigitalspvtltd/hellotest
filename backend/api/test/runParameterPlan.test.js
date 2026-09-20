const test = require("node:test");
const assert = require("node:assert/strict");
const { collectCaseParameterNames } = require("../src/services/runParameterPlan.service");
const { resolveSuiteContexts } = require("../src/services/suiteExecutionContext.service");
const { resolveParameterLayers, matchesParameterIteration } = require("../src/utils/stepParameterResolution");
const { preserveFrozenRunParameters } = require("../src/utils/frozenRunParameterCompatibility");

test("run is the unscoped default and explicit namespaces never overlap", () => {
  const values = resolveParameterLayers({ caseValues: { name: "case default", "t.name": "test" }, suiteValues: { "r.name": "suite override", name: "suite" },
    runValues: { name: "run" }, dataSet: { mode: "table", rows: [{ "@name": "row", "@t.name": "", "s.name": "suite row" }] } });
  assert.deepEqual(values, { "r.name": "row", "t.name": "", "s.name": "suite row" });
});

test("captured credentials from another data row or data set never enter this instance", () => {
  const current = { test_data_set_id: "customers", data_set_iteration_index: 0 };
  assert.equal(matchesParameterIteration(current, current), true);
  assert.equal(matchesParameterIteration({ ...current, data_set_iteration_index: 1 }, current), false);
  assert.equal(matchesParameterIteration({ ...current, test_data_set_id: "other" }, current), false);
  assert.equal(matchesParameterIteration({}, current), false);
  assert.equal(matchesParameterIteration({}, {}), true);
});

test("template collects Gherkin, API and saved declarations but excludes tags, XML and captured-only outputs", () => {
  const names = collectCaseParameterNames({ title: "Checkout @customer", authoring_mode: "gherkin", parameter_values: { "s.tenant": "hidden default" },
    gherkin_document: "@smoke\nScenario: Checkout <region>\n Given @t.email and @r.build" }, [
    { action: "When @s.currency is used", api_request: { url: "@base/orders", body: "<xml>@t.payload</xml>", headers: [{ key: "@header", value: "@s.key" }], captures: [{ parameter: "@r.token" }] } }
  ]);
  assert.deepEqual(names.sort(), ["r.base", "r.build", "r.customer", "r.header", "r.region", "s.currency", "s.key", "s.tenant", "t.email", "t.payload"]);
});

test("nearest suite data wins, parent parameters remain inherited, cycles terminate", () => {
  const rows = [
    { id: "parent", app_type_id: "app", parameter_values: { tenant: "parent", "t.name": "parent" }, data_set: { id: "parent-data" } },
    { id: "child", parent_id: "parent", app_type_id: "app", parameter_values: { tenant: "child" } },
    { id: "leaf", parent_id: "child", app_type_id: "app", data_set: { id: "child-data" } }
  ];
  const contexts = resolveSuiteContexts(rows, ["child", "leaf"]);
  assert.deepEqual(contexts.get("child"), { dataOptions: { override_lower_scopes: true, override_shared_steps: true, override_test_case_data: true, override_suite_data: true }, parameters: { "s.tenant": "child", "t.name": "parent" }, dataSet: { id: "parent-data" } });
  assert.equal(contexts.get("leaf").dataSet.id, "child-data");
  assert.doesNotThrow(() => resolveSuiteContexts(rows.map(row => row.id === "parent" ? { ...row, parent_id: "leaf" } : row), ["leaf"]));
});

test("legacy frozen runs preserve test-default semantics without mutating their stored evidence", () => {
  const old = { parameter_scope_default: "t", case_snapshots: [{ test_case_id: "case", test_case_title: "Case @email", parameter_values: { email: "old" }, test_data_set_snapshot: { mode: "table", columns: ["email"], rows: [{ email: "old row" }] } }],
    step_snapshots: [{ test_case_id: "case", action: "Given @email and <name> with @r.build", api_request: { body: "<xml>@email</xml>" } }] };
  const original = structuredClone(old), next = preserveFrozenRunParameters(old);
  assert.equal(next.step_snapshots[0].action, "Given @t.email and <t.name> with @r.build");
  assert.equal(next.step_snapshots[0].api_request.body, "<xml>@t.email</xml>");
  assert.deepEqual(next.case_snapshots[0].parameter_values, { "t.email": "old" });
  assert.deepEqual(next.case_snapshots[0].test_data_set_snapshot.rows, [{ "t.email": "old row" }]);
  assert.deepEqual(old, original);
  assert.deepEqual(preserveFrozenRunParameters(next), next, "compatibility hydration is idempotent");
  assert.strictEqual(preserveFrozenRunParameters({ ...old, parameter_scope_default: "r" }).step_snapshots, old.step_snapshots);
});
