const test = require("node:test");
const assert = require("node:assert/strict");
const db = require("../src/db");
const obsDb = require("../src/obsDb");
const snapshots = require("../../../testing/backend/services/executionSnapshot.repository");
const knowledge = require("../../../knowledge/backend/services/aiKnowledge.service");
const permissions = require("../services/permission.service");

test("1,000 case and 5,000 step snapshots use 24 bounded inserts preserving every value", async t => {
  const statements = [];
  t.mock.method(db, "prepare", sql => ({ run: async (...values) => { statements.push({ sql, values }); } }));
  const caseSnapshots = Array.from({ length: 1000 }, (_, index) => ({ execution_id: "run", test_case_id: `case-${index}`,
    test_case_title: `Case ${index}`, sort_order: index + 1, parameter_values: { answer: index }, assigned_to: "actor" }));
  const stepSnapshots = Array.from({ length: 5000 }, (_, index) => ({ execution_id: "run", test_case_id: `case-${Math.floor(index / 5)}`,
    snapshot_step_id: `step-${index}`, step_order: index % 5 + 1, api_request: { method: "GET", url: `https://example.test/${index}` } }));
  await snapshots.persist({ caseSnapshots, stepSnapshots });
  assert.equal(statements.length, 24);
  assert.ok(statements.every(statement => statement.values.length <= 6000));
  const readRows = statement => {
    const columns = statement.sql.match(/\(([^)]+)\)/)[1].split(/,\s*/);
    const rows = [];
    for (let offset = 0; offset < statement.values.length; offset += columns.length) {
      rows.push(Object.fromEntries(columns.map((column, index) => [column, statement.values[offset + index]])));
    }
    return rows;
  };
  const cases = statements.filter(statement => /execution_case_snapshots/.test(statement.sql)).flatMap(readRows);
  assert.deepEqual(cases.map(row => row.test_case_id), caseSnapshots.map(row => row.test_case_id));
  assert.deepEqual(cases[999].parameter_values, { answer: 999 });
  assert.deepEqual(cases[999].parameter_template_values, { answer: 999 });
  assert.deepEqual(cases[999].test_data_options, {});
  assert.equal(cases[999].sort_order, 1000);
  assert.deepEqual(cases[999].assigned_to_ids, ['actor']);
  const steps = statements.filter(statement => /execution_step_snapshots/.test(statement.sql)).flatMap(readRows);
  assert.equal(steps.at(-1).api_request.url, "https://example.test/4999");
  assert.deepEqual(steps.at(-1).shared_parameter_values, {});
  assert.deepEqual(steps.at(-1).shared_parameter_sensitive_names, []);
  t.diagnostic("Snapshot writes: 6000 -> 24 (99.6% fewer database round trips), max 6000 bind parameters.");
});

test("snapshot failure rolls back the owning transaction without submitting later chunks", async t => {
  const calls = [];
  const failure = Object.assign(new Error("storage unavailable"), { code: "XX000" });
  let inserts = 0;
  const query = async statement => {
    const sql = typeof statement === "string" ? statement : statement.text;
    calls.push(sql);
    if (sql.startsWith("INSERT") && ++inserts === 2) throw failure;
    return { rows: [], rowCount: 1 };
  };
  t.mock.method(db.pool, "connect", async () => ({ query, release() {} }));
  await assert.rejects(db.transaction(() => snapshots.persist({
    caseSnapshots: Array.from({ length: 600 }, (_, index) => ({ execution_id: "run", test_case_id: String(index) })),
    stepSnapshots: [{ execution_id: "run", test_case_id: "0", snapshot_step_id: "step" }]
  }))(), error => error === failure);
  assert.equal(inserts, 2);
  assert.ok(calls.some(sql => sql === "ROLLBACK"));
  assert.equal(calls.some(sql => /execution_step_snapshots/.test(sql)), false);
});

test("snapshot steps batch 1,000 selected cases into four reads while retaining case grouping", async t => {
  const calls = [];
  t.mock.method(db, "prepare", sql => ({ all: async (...ids) => {
    calls.push({ sql, ids });
    return ids.flatMap(id => [1, 2].map(step_order => ({ test_case_id: id, id: `${id}:${step_order}`, step_order })));
  } }));
  const ids = Array.from({ length: 1000 }, (_, index) => `case-${index}`);
  const result = await snapshots.loadSteps([...ids, "case-0", null]);
  assert.equal(calls.length, 4);
  assert.deepEqual(calls.flatMap(call => call.ids), ids);
  assert.deepEqual(result.get("case-999").map(step => step.id), ["case-999:1", "case-999:2"]);
  assert.equal(result.size, 1000);
  assert.ok(calls.every(call => /ORDER BY test_case_id ASC, step_order ASC, (?:test_steps\.)?id ASC/.test(call.sql)));
  assert.equal((await snapshots.loadSteps([])).size, 0);
  assert.equal(calls.length, 4);
});

test("relation authorization checks each canonical type once and refreshes every read", async t => {
  const calls = [];
  let allowCases = true;
  t.mock.method(permissions, "hasPermission", async (user, permission, project) => {
    calls.push({ user, permission, project });
    return permission !== "feedback.view" && (permission !== "testcase.view" || allowCases);
  });
  const user = { id: "reader" };
  const rows = Array.from({ length: 1000 }, (_, id) => ({ id, source_type: id % 2 ? "story" : "requirement", target_type: "test-case" }));
  rows.push({ id: "hidden", source_type: "run", target_type: "bug" }, { id: "unknown", source_type: "invalid", target_type: "story" });
  assert.equal((await knowledge._internals.filterRelationsForUser("project", rows, user)).length, 1000);
  assert.equal(calls.length, 4);
  assert.ok(calls.every(call => call.user === user && call.project === "project"));
  allowCases = false;
  assert.deepEqual(await knowledge._internals.filterRelationsForUser("project", rows, user), []);
  assert.equal(calls.length, 8);
  assert.deepEqual(await knowledge._internals.filterRelationsForUser("project", rows, null), []);
});

test("relation authorization propagates unavailable permission storage instead of granting access", async t => {
  t.mock.method(permissions, "hasPermission", async () => { throw new Error("Permission storage unavailable"); });
  await assert.rejects(knowledge._internals.filterRelationsForUser("project", [{ source_type: "story", target_type: "story" }], { id: "reader" }), /Permission storage unavailable/);
});

test("workflow lists reconcile at most four runs at a time and retain newest-first order", async t => {
  const workflows = require("../../../agentic/backend/services/agenticWorkflow.service");
  const runtime = require("../../../agentic/backend/services/agenticWorkflowExecution.service");
  const rows = Array.from({ length: 100 }, (_, index) => ({ id: `run-${index}`, status: "running", node_results: [] }));
  t.mock.method(db, "prepare", () => ({ all: async () => rows }));
  let active = 0;
  let peak = 0;
  t.mock.method(runtime, "reconcile", async run => {
    peak = Math.max(peak, ++active);
    await new Promise(resolve => setImmediate(resolve));
    active--;
    return { ...run, status: "interrupted" };
  });
  const actual = await workflows.listWorkflowRuns({ user: { id: "admin", role: "admin" } });
  assert.equal(peak, 4);
  assert.deepEqual(actual.map(run => run.id), rows.map(row => row.id));
});

test("rerun route stamps the authenticated actor instead of a submitted identity", async t => {
  const executions = require("../../../testing/backend/services/execution.service");
  t.mock.method(executions, "getExecution", async () => ({ id: "run", project_id: "project" }));
  t.mock.method(require("../services/project.service"), "getProject", async () => ({}));
  t.mock.method(require("../services/mobileFeature.service"), "executionUsesMobile", async () => false);
  t.mock.method(executions, "rerunExecution", async (_id, input) => { assert.equal(input.created_by, "actual-user"); return { id: "rerun" }; });
  const routes = new Map();
  await require("../../../testing/backend/routes/executions.routes")({
    get() {}, put() {}, delete() {}, post: (path, handler) => routes.set(path, handler),
    authenticate: async () => {}, validate() {}, requirePermission: () => async () => {}
  });
  await routes.get("/executions/:id/rerun")({ params: { id: "run" }, user: { id: "actual-user" }, body: { created_by: "another-user" } });
});

test("sync workers skip transactions claimed by another replica before loading provider credentials", async t => {
  const sync = require("../../../integration/backend/services/projectSync.service");
  const statements = [];
  t.mock.method(obsDb.pool, "query", async statement => {
    const sql = statement.text || statement;
    statements.push(sql);
    return { rows: sql.includes("SELECT *") ? [{ id: "claimed-elsewhere" }] : [], rowCount: 0 };
  });
  t.mock.method(require("../../../integration/backend/services/integration.service"), "getIntegration", async () => assert.fail("A losing worker must not call the provider"));
  await sync.processQueuedSyncs();
  assert.equal(statements.length, 2);
  assert.match(statements[1], /UPDATE workspace_transactions/);
  assert.match(statements[1], /status = 'queued'/);
});

test("quality traceability counts a defect linked through several paths once and ignores archived cases", async t => {
  const analytics = require("../../../dashboard/backend/services/qualityAnalytics.service");
  const stories = Array.from({ length: 1000 }, (_, index) => ({ id: `story-${index}`, title: `Story ${index}`, priority: 1,
    test_case_ids: [`case-${index}`, `case-${index + 1}`, "archived-case"] }));
  let linkReads = 0;
  const issues = Array.from({ length: 1000 }, (_, index) => ({ id: `issue-${index}`, status: "open",
    get linked_requirement_ids() { linkReads++; return [`story-${index}`]; },
    get linked_test_case_ids() { linkReads++; return [`case-${index}`, `case-${index + 1}`]; }
  }));
  issues.push({ id: "closed", status: "closed", linked_requirement_ids: ["story-0"] });
  t.mock.method(db, "prepare", sql => ({
    get: async () => ({ id: "project", name: "Project" }),
    all: async () => {
      if (sql.includes("FROM requirements WHERE")) return stories;
      if (sql.includes("FROM test_cases LEFT JOIN")) return Array.from({ length: 1001 }, (_, index) => ({ id: `case-${index}` }));
      if (sql.includes("FROM feedback")) return issues;
      return [];
    }
  }));
  const result = await analytics.qualityInsights({ projectId: "project" });
  const first = result.traceability.find(row => row.id === "story-0");
  assert.equal(first.test_case_count, 2);
  assert.equal(first.open_defect_count, 2, "issue-0 links directly and through both cases; issue-1 links through case-1");
  assert.equal(first.risk_score, 40);
  assert.ok(linkReads <= 6000, `Expected linear index building, observed ${linkReads} link reads`);
  assert.equal(stories[0].test_case_ids.length, 3, "Source records are not mutated");
  t.diagnostic(`1,000 stories and 1,000 defects: ${linkReads} relationship-field reads instead of at least 2,000,000 repeated joins.`);
});

test("automation generator cannot restart an active job or bypass its lease owner", async t => {
  const generator = require("../../../automation/backend/services/automationGenerator.service");
  const builder = require("../../../automation/backend/services/aiAutomationBuilder.service");
  t.mock.method(builder, "buildAutomationForCase", async () => assert.fail("Invalid leases must not start a build"));
  let status = "running";
  t.mock.method(generator, "getJob", async () => ({ id: "job", status, leased_by: "owner", payload: {} }));
  const queries = [];
  t.mock.method(obsDb.pool, "query", async statement => { queries.push(statement); return { rows: [], rowCount: 0 }; });
  await assert.rejects(generator.runLeasedJob({ job_id: "job", worker_id: "owner" }), { statusCode: 409 });
  assert.equal(queries.length, 0);
  status = "leased";
  await assert.rejects(generator.runLeasedJob({ job_id: "job", worker_id: "other-worker" }), { statusCode: 409 });
  assert.equal(queries.length, 1);
  assert.deepEqual(queries[0].values.slice(-2), ["job", "other-worker"]);
  assert.match(queries[0].text, /status = 'leased' AND leased_by =/);
  assert.match(queries[0].text, /lease_expires_at > CURRENT_TIMESTAMP/);
});
