const test = require("node:test");
const assert = require("node:assert/strict");
const db = require("@hellotest/platform/backend/src/db");
const rag = require("../../backend/services/knowledgeRag.service");
const authorization = require("../../backend/services/knowledgeAuthorization.service");
const lifecycle = require("../../backend/services/knowledgeSourceLifecycle.service");
const permissions = require("@hellotest/platform/backend/services/permission.service");

test("indexed case context keeps steps and expected results without copying separately protected data or suite contents", async t => {
  const queries = [];
  t.mock.method(db, "prepare", sql => ({
    all: async () => {
      queries.push(sql);
      if (sql.includes("FROM test_steps")) return [{ step_order: 1, action: 'Submit payment with {{account}}', expected_result: 'Order is confirmed', step_type: 'web', total_step_count: 101 }];
      if (sql.includes("FROM requirement_test_cases")) return [{ requirement_id: 'story-1' }];
      if (sql.includes("FROM test_case_module_cases")) return [{ id: 'module-1', name: 'Checkout' }];
      throw new Error('Unexpected cross-permission read');
    },
    get: async () => assert.fail("Suite or data-set content must not be loaded")
  }));
  const snapshot = await rag._internals.serializeTestCase({ id: 'case-1', title: 'Checkout', suite_id: 'suite-1',
    parameter_values: { account: 'private-account-value', arbitrary: 'private-arbitrary-value' } });
  const serialized = JSON.stringify(snapshot);
  assert.match(snapshot.content, /Submit payment with \{\{account\}\}/);
  assert.match(snapshot.content, /Expected: Order is confirmed/);
  assert.match(snapshot.content, /Test parameter names:.*account/);
  assert.match(snapshot.content, /Requirement IDs: story-1/);
  assert.doesNotMatch(serialized, /private-account-value|private-arbitrary-value/);
  assert.ok(!queries.some(sql => /test_data_sets|test_suites/.test(sql)));
  assert.equal(snapshot.metadata.context_permission_profile, authorization.APPLICATION_CONTEXT_PROFILE);
  assert.equal(snapshot.metadata.step_count, 101);
  assert.equal(snapshot.metadata.indexed_step_count, 1);
  assert.equal(snapshot.metadata.steps_truncated, true);
  assert.match(snapshot.content, /first 1 of 101 steps/);
});

test("indexed run context retains current run facts and counts without copying result logs and execution snapshots", async t => {
  t.mock.method(db, "prepare", sql => ({ all: async () => {
    assert.match(sql, /COUNT\(\*\)/);
    assert.doesNotMatch(sql, /SELECT id, test_case_id/);
    return [{ status: 'failed', count: 2 }, { status: 'passed', count: 3 }];
  } }));
  const snapshot = await rag._internals.serializeExecution({ id: 'run-1', name: 'Payment regression', status: 'failed',
    build: 'release-42', test_environment_snapshot: { privateField: 'environment-private-value' },
    test_configuration_snapshot: { privateField: 'configuration-private-value' },
    test_data_set_snapshot: { account: 'dataset-private-value' } });
  assert.match(snapshot.content, /Payment regression/);
  assert.match(snapshot.content, /"failed":2/);
  assert.match(snapshot.content, /Build: release-42/);
  assert.doesNotMatch(JSON.stringify(snapshot), /environment-private-value|configuration-private-value|dataset-private-value/);
  assert.equal(snapshot.metadata.failed_or_blocked_count, 2);
  assert.equal(snapshot.metadata.context_permission_profile, authorization.APPLICATION_CONTEXT_PROFILE);
});

test("legacy application source fetches expose version metadata but withhold old cross-permission passages until refreshed", async t => {
  t.mock.method(permissions, 'hasPermission', async () => true);
  const source = { id: 'source-1', project_id: 'project-1', source_kind: 'test_case', extraction_status: 'ready', required_permission: 'testcase.view' };
  t.mock.method(db, 'prepare', sql => ({
    get: async () => {
      if (sql.includes('SELECT id, project_id, app_type_id')) return source;
      if (sql.includes('SELECT sources.id FROM ai_knowledge_sources')) return { id: source.id };
      if (sql.includes('SELECT documents.*')) return { id: 'revision-legacy', source_id: source.id, version: 1, is_active: true,
        content: 'private-cross-permission-value', metadata: {}, required_indexes_ready: true };
      if (sql.includes('SELECT jobs.id')) return undefined;
      assert.fail(`Unexpected read after legacy revision gate: ${sql}`);
    },
    all: async () => assert.fail('Legacy fragments must not be loaded')
  }));
  const result = await lifecycle.getDetail(source.id, { user: { id: 'reader' } });
  assert.equal(result.revision.id, 'revision-legacy');
  assert.deepEqual(result.fragments, []);
  assert.equal(result.knowledge_object, null);
  assert.equal(result.authorization.partial, true);
  assert.match(result.context_unavailable_reason, /Refresh or reingest/);
  assert.doesNotMatch(JSON.stringify(result), /private-cross-permission-value/);
});
