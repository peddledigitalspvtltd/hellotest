const assert = require("node:assert/strict");
const test = require("node:test");
const { Client } = require("pg");
const { setTimeout: delay } = require("node:timers/promises");
const { createPerformanceIndexingService, INDEX_CATALOG } = require("../../src/services/performanceIndexing.service");

test("PostgreSQL builds the allowlisted indexes concurrently and reuses existing bootstrap definitions", {
  skip: process.env.PERFORMANCE_INDEXING_POSTGRES !== "1", timeout: 30000
}, async () => {
  const url = new URL(process.env.DATABASE_URL);
  assert.match(url.pathname.slice(1), /^agent_verify_performance_indexing_[a-z0-9_]+$/);
  const options = { connectionString: url.toString() };
  const db = new Client(options); await db.connect();
  const clients = [];
  try {
    assert.equal((await db.query("SELECT to_regclass('public.users') AS name")).rows[0].name, null, "Requires an empty disposable database");
    await db.query(`CREATE TABLE app_settings(key text PRIMARY KEY,value jsonb,updated_at timestamptz);
      CREATE TABLE admin_audit_log(id text PRIMARY KEY,actor_id text,action text,target_type text,target_id text,summary text,metadata jsonb,ip_address text);
      CREATE TABLE users(id text,email text,username text);
      CREATE TABLE project_members(user_id text,project_id text);
      CREATE TABLE app_types(id text,project_id text);
      CREATE TABLE notifications(id text,user_id text,created_at timestamptz);
      CREATE TABLE executions(id text,project_id text,created_at timestamptz);
      CREATE TABLE execution_results(id text,test_case_id text,execution_id text,created_at timestamptz,status text,duration_ms integer);
      CREATE TABLE requirements(id text,project_id text,updated_at timestamptz,created_at timestamptz);
      CREATE TABLE test_cases(id text,app_type_id text,updated_at timestamptz,created_at timestamptz);
      CREATE TABLE feedback(id text,project_id text,created_at timestamptz);
      CREATE INDEX idx_execution_results_case_latest ON execution_results (test_case_id,created_at DESC,id DESC) INCLUDE(status,duration_ms);
      CREATE INDEX idx_test_cases_catalog_cursor ON test_cases (app_type_id,(COALESCE(updated_at,created_at)) DESC NULLS LAST,id DESC);
      INSERT INTO users(id,email,username) VALUES('retained-user','retained@example.test','retained');`);
    const tasks = [];
    const factory = () => createPerformanceIndexingService({
      query: (...args) => db.query(...args),
      connect: async () => { const client = new Client(options); await client.connect(); clients.push(client); return client; },
      schedule: task => tasks.push(task)
    });
    const service = factory();
    for (const run of [1, 2]) {
      const started = await service.start({ actorId: "test-admin" });
      assert.equal(started.running, true);
      const concurrent = await factory().start({ actorId: "second-admin" });
      assert.equal(concurrent.job.id, started.job.id);
      assert.equal(tasks.length, 1);
      tasks.shift()();
      let state;
      for (let attempt = 0; attempt < 100; attempt += 1) {
        state = await service.status();
        if (!state.running) break;
        await delay(50);
      }
      assert.equal(state.job.status, "completed", JSON.stringify(state.job));
      assert.equal(state.job.completed, INDEX_CATALOG.length);
      assert.equal(state.job.indexes.filter(index => index.status === "existing").length, run === 1 ? 2 : INDEX_CATALOG.length);
    }
    assert.equal((await db.query("SELECT COUNT(*)::integer AS total FROM admin_audit_log")).rows[0].total, 4);
    assert.equal((await db.query("SELECT COUNT(*)::integer AS total FROM users WHERE id='retained-user'")).rows[0].total, 1);
  } finally {
    await Promise.allSettled(clients.map(client => client.end()));
    await db.end();
  }
});
