// Opt-in SQL smoke: copies the selected frozen run into a transaction-local
// schema and rolls back every change. No public run or evidence row is changed.
const test = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { readFileSync } = require("node:fs");
const { execFileSync } = require("node:child_process");

test("PostgreSQL lifecycle migrations and persisted timer transitions roll back cleanly", { skip: !process.env.CASE_LIFECYCLE_POSTGRES, timeout: 30000 }, async context => {
  if (process.env.CASE_LIFECYCLE_DOCKER_ENV) {
    const entries = JSON.parse(execFileSync("docker", ["inspect", process.env.CASE_LIFECYCLE_DOCKER_ENV, "--format", "{{json .Config.Env}}"], { encoding: "utf8" }));
    for (const name of ["POSTGRES_USER", "POSTGRES_PASSWORD", "POSTGRES_DB"]) {
      const entry = entries.find(value => value.startsWith(`${name}=`));
      if (entry) process.env[name] = entry.slice(name.length + 1);
    }
    process.env.POSTGRES_HOST = "127.0.0.1";
    process.env.APP_MODE = "local";
  }
  const db = require("../../src/db");
  const executions = require("../../src/services/execution.service");
  const results = require("../../src/services/executionResult.service");
  const lifecycle = require("../../src/services/executionCaseLifecycle.service");
  context.mock.method(require("../../src/services/opsTelemetry.service"), "emitExecutionHierarchyEvents", async () => undefined);
  const schema = `qa_case_lifecycle_${randomUUID().replaceAll("-", "")}`;
  const rollback = new Error("Expected smoke-test rollback");
  try {
    const source = await db.prepare(`SELECT executions.id, COALESCE(executions.created_by, executions.assigned_to) AS actor_id,
      md5(row_to_json(executions)::text) AS checksum FROM public.executions
      WHERE EXISTS (SELECT 1 FROM public.execution_case_snapshots WHERE execution_id = executions.id)
      ORDER BY executions.created_at DESC LIMIT 1`).get();
    assert.ok(source, "The smoke database needs a frozen run to copy");
    const actorId = source.actor_id || (await db.prepare(`SELECT id FROM public.users ORDER BY id LIMIT 1`).get()).id;
    const publicCount = (await db.prepare(`SELECT count(*)::int AS count FROM public.execution_results WHERE execution_id = ?`).get(source.id)).count;
    await assert.rejects(db.transaction(async () => {
      await db.query(`CREATE SCHEMA ${schema}`);
      await db.query(`SET LOCAL search_path = ${schema}, public`);
      for (const table of ["executions", "execution_results", "execution_case_snapshots", "execution_step_snapshots", "execution_suites", "requirement_defects", "test_case_defects"]) {
        await db.query(`CREATE TABLE ${schema}.${table} (LIKE public.${table} INCLUDING ALL)`);
      }
      const bootstrap = readFileSync(require.resolve("../../src/db/bootstrap"), "utf8");
      const migrations = [...bootstrap.matchAll(/`(ALTER TABLE execution_results [^`]+)`/g)].map(match => match[1]);
      assert.ok(migrations.some(sql => sql.includes("timer_started_at")));
      assert.ok(migrations.some(sql => sql.includes("'paused'")));
      for (const sql of migrations) await db.query(sql);
      await db.query(`INSERT INTO executions SELECT * FROM public.executions WHERE id = ?`, [source.id]);
      await db.query(`UPDATE executions SET status = 'running', trigger = 'manual', ended_at = NULL WHERE id = ?`, [source.id]);
      for (const table of ["execution_case_snapshots", "execution_step_snapshots", "execution_suites"]) await db.query(`INSERT INTO ${table} SELECT * FROM public.${table} WHERE execution_id = ?`, [source.id]);
      const frozenCase = await db.prepare(`SELECT test_case_id FROM execution_case_snapshots WHERE execution_id = ? ORDER BY sort_order LIMIT 1`).get(source.id);
      const identity = { execution_id: source.id, test_case_id: frozenCase.test_case_id };
      const pending = await lifecycle.ensureExecutionCaseResult(identity, actorId);
      assert.equal(pending.status, "pending");
      assert.equal(pending.timer_started_at, null);
      const started = await lifecycle.transitionExecutionCase({ ...identity, action: "start", expected_result_id: pending.id, expected_revision: pending.revision }, actorId);
      assert.equal(started.status, "running");
      assert.ok(started.timer_started_at);
      await db.query(`UPDATE execution_results SET timer_started_at = clock_timestamp() - interval '2 seconds' WHERE id = ?`, [started.id]);
      const paused = await lifecycle.transitionExecutionCase({ ...identity, action: "pause", expected_result_id: started.id, expected_revision: started.revision }, actorId);
      assert.equal(paused.status, "paused");
      assert.ok(paused.duration_ms >= 1900 && paused.duration_ms < 10000, `Recorded pause duration ${paused.duration_ms}`);
      assert.equal(typeof paused.duration_ms, "number", "BIGINT duration is shaped as a JSON number");
      assert.ok(paused.lifecycle_history[0].actor_name);
      const resumed = await lifecycle.transitionExecutionCase({ ...identity, action: "resume", expected_revision: paused.revision }, actorId);
      await db.query(`UPDATE execution_results SET timer_started_at = clock_timestamp() - interval '1 second' WHERE id = ?`, [resumed.id]);
      await results.updateExecutionResult(resumed.id, { status: "passed", require_explicit_start: true, actor_id: actorId });
      const passed = await results.getExecutionResult(resumed.id);
      assert.equal(passed.timer_started_at, null);
      assert.ok(passed.duration_ms > paused.duration_ms + 900);
      const reset = await lifecycle.transitionExecutionCase({ ...identity, action: "reset", expected_result_id: passed.id, expected_revision: passed.revision }, actorId);
      assert.notEqual(reset.id, passed.id);
      assert.equal(reset.status, "pending");
      assert.equal((await results.findLatestExecutionResult(reset)).id, reset.id);
      const run = await executions.getExecution(source.id, true);
      assert.ok(run.metrics.duration_ms >= passed.duration_ms);
      await lifecycle.transitionExecutionCase({ ...identity, action: "start" }, actorId);
      await executions.completeExecution(source.id, "completed", { completed_by: actorId });
      assert.equal((await results.getExecutionResult(reset.id)).status, "aborted");
      await assert.rejects(lifecycle.transitionExecutionCase({ ...identity, action: "resume" }, actorId), { code: "RUN_FINISHED" });
      assert.equal((await lifecycle.ensureExecutionCaseResult(identity, actorId)).id, reset.id);
      throw rollback;
    })(), error => error === rollback);
    const remaining = await db.prepare(`SELECT nspname FROM pg_namespace WHERE nspname = ?`).get(schema);
    assert.equal(remaining, undefined);
    const after = await db.prepare(`SELECT md5(row_to_json(executions)::text) AS checksum FROM public.executions WHERE id = ?`).get(source.id);
    assert.equal(after.checksum, source.checksum, "Public run data remains unchanged");
    assert.equal((await db.prepare(`SELECT count(*)::int AS count FROM public.execution_results WHERE execution_id = ?`).get(source.id)).count, publicCount);
  } finally {
    await db.pool.end();
  }
});
