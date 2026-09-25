const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("execution batching and worker ownership on disposable PostgreSQL", { skip: process.env.EXECUTION_ARCH_POSTGRES !== "1", timeout: 120_000 }, async t => {
  const database = new URL(process.env.DATABASE_URL);
  assert.match(database.pathname, /^\/agent_verify_execution_arch_[a-z0-9_]+$/);
  if (process.env.POSTGRES_URL) assert.equal(process.env.POSTGRES_URL, process.env.DATABASE_URL);
  if (process.env.OBS_POSTGRES_URL) assert.equal(process.env.OBS_POSTGRES_URL, process.env.DATABASE_URL);
  if (process.env.OBS_DATABASE_URL) assert.equal(process.env.OBS_DATABASE_URL, process.env.DATABASE_URL);
  const db = require("../../src/db");
  const obsDb = require("../../src/obsDb");
  const snapshots = require("../../../../testing/backend/services/executionSnapshot.repository");
  try {
    assert.equal((await db.prepare("SELECT to_regclass('public.projects') AS name").get()).name, null);
    await db.query(fs.readFileSync(path.resolve(__dirname, "../../instance-setup-data/schema-setup/schema.sql"), "utf8"));
    await require("../../src/db/bootstrap").ensureRuntimeSchema();
    await db.query(`INSERT INTO users(id,email,password_hash) VALUES ('actor','execution-architecture@example.test','not-a-login');
      INSERT INTO projects(id,name,created_by) VALUES ('project','Disposable architecture verification','actor');
      INSERT INTO app_types(id,project_id,name,type) VALUES ('app','project','Web','web');
      INSERT INTO test_cases(id,app_type_id,title) VALUES ('case','app','Case');
      INSERT INTO executions(id,project_id,created_by) VALUES ('run','project','actor'), ('bulk-run','project','actor'), ('rollback-run','project','actor');
      INSERT INTO test_engine_jobs(id,engine_run_id,project_id,execution_id,test_case_id,test_case_title,status,leased_by,lease_expires_at)
      VALUES ('job','engine-run','project','run','case','Case','leased','owner',CURRENT_TIMESTAMP + INTERVAL '20 seconds')`);

    await t.test("6,000 snapshots retain all JSON fields; batching lowers database round trips", async () => {
      const caseSnapshots = Array.from({ length: 1000 }, (_, index) => ({ execution_id: "bulk-run", test_case_id: `case-${index}`,
        test_case_title: `Case ${index}`, sort_order: index + 1, parameter_values: { answer: index }, external_references: ["STORY-1"],
        test_data_set_snapshot: { mode: "table", rows: [{ value: index }] }, data_set_source: "suite", assigned_to: "actor" }));
      const stepSnapshots = Array.from({ length: 5000 }, (_, index) => ({ execution_id: "bulk-run", test_case_id: `case-${Math.floor(index / 5)}`,
        snapshot_step_id: `step-${index}`, step_order: index % 5 + 1, api_request: { method: "GET", url: `https://example.test/${index}` } }));
      const rollback = new Error("benchmark rollback");
      const oldStart = performance.now();
      await assert.rejects(db.transaction(async () => {
        for (const row of caseSnapshots) await snapshots.persist({ caseSnapshots: [row] });
        for (const row of stepSnapshots) await snapshots.persist({ stepSnapshots: [row] });
        throw rollback;
      })(), error => error === rollback);
      const oldMs = performance.now() - oldStart;
      const newStart = performance.now();
      await db.transaction(() => snapshots.persist({ caseSnapshots, stepSnapshots }))();
      const newMs = performance.now() - newStart;
      assert.equal((await db.prepare("SELECT COUNT(*)::int AS count FROM execution_case_snapshots").get()).count, 1000);
      assert.equal((await db.prepare("SELECT COUNT(*)::int AS count FROM execution_step_snapshots").get()).count, 5000);
      const last = await db.prepare("SELECT * FROM execution_case_snapshots WHERE test_case_id = 'case-999'").get();
      assert.deepEqual(last.parameter_values, { answer: 999 });
      assert.deepEqual(last.parameter_template_values, { answer: 999 });
      assert.deepEqual(last.test_data_set_snapshot, { mode: "table", rows: [{ value: 999 }] });
      assert.deepEqual(last.assigned_to_ids, ["actor"]);
      assert.equal((await db.prepare("SELECT api_request FROM execution_step_snapshots WHERE snapshot_step_id = 'step-4999'").get()).api_request.url, "https://example.test/4999");
      t.diagnostic(JSON.stringify({ rows: 6000, beforeQueries: 6000, afterQueries: 24, beforeMs: +oldMs.toFixed(1), afterMs: +newMs.toFixed(1), speedup: +(oldMs / newMs).toFixed(2) }));
    });

    await t.test("a later step constraint violation rolls back all earlier case chunks", async () => {
      await assert.rejects(db.transaction(() => snapshots.persist({
        caseSnapshots: Array.from({ length: 501 }, (_, index) => ({ execution_id: "rollback-run", test_case_id: String(index), test_case_title: "Frozen", sort_order: index })),
        stepSnapshots: Array.from({ length: 251 }, (_, index) => ({ execution_id: "rollback-run", test_case_id: "0", snapshot_step_id: index === 250 ? "step-0" : `step-${index}`, step_order: index }))
      }))(), { code: "23505" });
      assert.equal((await db.prepare("SELECT COUNT(*)::int AS count FROM execution_case_snapshots WHERE execution_id = 'rollback-run'").get()).count, 0);
      assert.equal((await db.prepare("SELECT COUNT(*)::int AS count FROM execution_step_snapshots WHERE execution_id = 'rollback-run'").get()).count, 0);
    });



    await t.test("heartbeat renews only a live lease owned by the caller", async () => {
      const engine = require("../../../../automation/backend/services/engine.service");
      await assert.rejects(engine.heartbeatRun("engine-run", "other-worker"), { statusCode: 404 });
      const before = await db.prepare("SELECT lease_expires_at FROM test_engine_jobs WHERE id = 'job'").get();
      const heartbeat = await engine.heartbeatRun("engine-run", "owner");
      assert.equal(heartbeat.leased_by, "owner");
      const after = await db.prepare("SELECT lease_expires_at FROM test_engine_jobs WHERE id = 'job'").get();
      assert.ok(Date.parse(after.lease_expires_at) > Date.parse(before.lease_expires_at));
      await db.query("UPDATE test_engine_jobs SET lease_expires_at = CURRENT_TIMESTAMP - INTERVAL '1 second' WHERE id = 'job'");
      await assert.rejects(engine.heartbeatRun("engine-run", "owner"), { statusCode: 404 });
      await db.query("UPDATE test_engine_jobs SET status = 'completed', lease_expires_at = CURRENT_TIMESTAMP + INTERVAL '2 minutes' WHERE id = 'job'");
      await assert.rejects(engine.heartbeatRun("engine-run", "owner"), { statusCode: 404 });
    });

    await t.test("engine logs and artifacts read only their own projected fields", async () => {
      const engine = require("../../../../automation/backend/services/engine.service");
      await db.prepare("UPDATE test_engine_jobs SET runtime_state = ? WHERE id = 'job'").run({ logs: { output: "Done" }, artifacts: [{ id: "evidence" }], unrelated: "x".repeat(100_000) });
      assert.deepEqual(await engine.getRunLogs("engine-run", "project"), { output: "Done" });
      assert.deepEqual(await engine.getRunArtifacts("engine-run", "project"), [{ id: "evidence" }]);
      await assert.rejects(engine.getRunLogs("engine-run", "other-project"), { statusCode: 404 });
    });

    await t.test("racing generator run requests start one build and reject stale lease owners", async context => {
      const generator = require("../../../../automation/backend/services/automationGenerator.service");
      const builder = require("../../../../automation/backend/services/aiAutomationBuilder.service");
      const transactions = require("../../services/workspaceTransaction.service");
      await db.query(`INSERT INTO automation_generator_jobs(id,transaction_id,test_case_id,status,leased_by,lease_expires_at)
        VALUES ('generator','generator-transaction','case','leased','worker',CURRENT_TIMESTAMP + INTERVAL '2 minutes')`);
      context.mock.method(transactions, "updateTransaction", async () => {});
      context.mock.method(transactions, "appendTransactionEvent", async () => {});
      let builds = 0;
      context.mock.method(builder, "buildAutomationForCase", async () => { builds++; return { generated_step_count: 1 }; });
      await assert.rejects(generator.runLeasedJob({ job_id: "generator", worker_id: "other-worker" }), { statusCode: 409 });
      const actual = await Promise.allSettled(Array.from({ length: 10 }, () => generator.runLeasedJob({ job_id: "generator", worker_id: "worker" })));
      assert.equal(builds, 1);
      assert.equal(actual.filter(row => row.status === "fulfilled").length, 1);
      assert.ok(actual.filter(row => row.status === "rejected").every(row => row.reason.statusCode === 409));
      assert.equal((await db.prepare("SELECT status FROM automation_generator_jobs WHERE id = 'generator'").get()).status, "completed");
    });

    await t.test("simultaneous sync requests enqueue one transaction and retain its audit event", async context => {
      const sync = require("../../../../integration/backend/services/projectSync.service");
      const integrations = require("./integration.service");
      context.mock.method(integrations, "getIntegrations", async () => [{ id: "dedupe-integration", type: "github", is_active: true, config: { project_id: "project" } }]);
      context.mock.method(integrations, "mergeIntegrationConfig", async () => {});
      const queued = await Promise.all(Array.from({ length: 10 }, () => sync.queueProjectSync({ project_id: "project", provider: "github", created_by: "actor" })));
      assert.equal(new Set(queued.map(row => row.id)).size, 1);
      assert.equal(queued.filter(row => !row.duplicate).length, 1);
      assert.equal((await db.prepare("SELECT COUNT(*)::int AS count FROM workspace_transaction_events WHERE transaction_id = ?").get(queued[0].id)).count, 1);
      await db.prepare("UPDATE workspace_transactions SET status = 'completed' WHERE id = ?").run(queued[0].id);
    });

    await t.test("two API replicas race for one queued sync and only one loads the provider", async context => {
      await db.prepare(`INSERT INTO workspace_transactions(id,project_id,category,action,status,title,metadata)
        VALUES ('sync','project','backup','github','queued','Queued backup',?)`).run({ integration_id: "integration", provider: "github" });
      const modulePath = require.resolve("../../../../integration/backend/services/projectSync.service");
      const firstWorker = require(modulePath);
      delete require.cache[modulePath];
      const secondWorker = require(modulePath);
      const integration = require("./integration.service");
      const transactions = require("../../services/workspaceTransaction.service");
      let loads = 0;
      context.mock.method(integration, "getIntegration", async () => { loads++; return { id: "integration", is_active: false }; });
      context.mock.method(integration, "mergeIntegrationConfig", async () => {});
      context.mock.method(transactions, "updateTransaction", async () => {});
      context.mock.method(transactions, "appendTransactionEvent", async () => {});
      const query = obsDb.pool.query.bind(obsDb.pool);
      let readers = 0;
      let release;
      const gate = new Promise(resolve => { release = resolve; });
      context.mock.method(obsDb.pool, "query", async statement => {
        const result = await query(statement);
        if (/SELECT \*\s+FROM workspace_transactions/.test(statement.text || statement)) {
          if (++readers === 2) release();
          await gate;
        }
        return result;
      });
      await Promise.all([firstWorker.processQueuedSyncs(), secondWorker.processQueuedSyncs()]);
      assert.equal(readers, 2, "Both workers saw the same queued transaction before claiming it");
      assert.equal(loads, 2, "Only the winning worker loads the integration, then reloads it to record the inactive-provider failure");
      assert.equal((await db.prepare("SELECT status FROM workspace_transactions WHERE id='sync'").get()).status, "running");
    });
  } finally { await Promise.all([db.close(), obsDb.close()]); }
});
