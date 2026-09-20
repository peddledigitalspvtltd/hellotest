const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

test("durable project deletion queue, admission and cleanup on disposable PostgreSQL", {
  skip: process.env.PROJECT_DELETION_QUEUE_POSTGRES !== "1", timeout: 120_000
}, async t => {
  const url = new URL(process.env.DATABASE_URL);
  assert.match(url.pathname, /^\/agent_verify_project_deletion_queue_[a-z0-9_]+$/);
  process.env.POSTGRES_URL = process.env.OBS_DATABASE_URL = process.env.OBS_POSTGRES_URL = url.toString();
  const { Client } = require("pg");
  const db = require("../../src/db");
  const obsDb = require("../../src/obsDb");
  const { createProjectDeletionService } = require("../../src/services/projectDeletion.service");
  const services = [];
  const actor = { id: "deletion-owner", role: "member" };
  const other = { id: "deletion-other", role: "member" };
  const admin = { id: "deletion-admin", role: "admin" };
  const silent = { error() {} };
  const connect = async () => {
    const client = new Client({ connectionString: url.toString(), statement_timeout: 5000, lock_timeout: 1000 });
    client.on("error", () => {});
    await client.connect();
    return client;
  };
  const createService = (overrides = {}) => {
    const service = createProjectDeletionService({ db, connect, logger: silent, storage: { removeObject: async () => {} }, vectors: { isConfigured: () => false }, ...overrides });
    services.push(service);
    return service;
  };
  const seedProject = async (id, objectCount = 0) => {
    await db.prepare("INSERT INTO projects(id,name,created_by) VALUES (?,?,'deletion-owner')").run(id, `Project ${id}`);
    await db.prepare("INSERT INTO project_members(id,project_id,user_id,role_id) VALUES (?,?,'deletion-owner','deletion-role')").run(`${id}-member`, id);
    for (let index = 0; index < objectCount; index++) {
      await db.prepare(`INSERT INTO attachments(id,project_id,entity_type,entity_id,bucket_name,object_name,file_name)
        VALUES (?,?,'project',?,'test-only',?,'file.txt')`).run(`${id}-attachment-${index}`, id, id, `${id}/object-${String(index).padStart(3, "0")}`);
    }
  };
  const deleteRepository = {
    async deleteProjectData({ client, projectId, onProgress }) {
      const result = await client.query("DELETE FROM attachments WHERE project_id = $1", [projectId]);
      await onProgress?.({ phase: "Deleting project records", totalRows: result.rowCount, rows: result.rowCount });
      await client.query("DELETE FROM project_members WHERE project_id = $1", [projectId]);
      await client.query("DELETE FROM projects WHERE id = $1", [projectId]);
      return { deleted: true, deleted_rows: result.rowCount + 1, counts: { attachments: result.rowCount, projects: 1 } };
    }
  };
  const job = projectId => db.prepare("SELECT * FROM project_deletion_jobs WHERE project_id = ?").get(projectId);
  const pendingObjects = id => db.prepare("SELECT * FROM project_deletion_objects WHERE job_id = ? ORDER BY object_name").all(id);
  try {
    assert.equal((await db.prepare("SELECT to_regclass('public.projects') AS name").get()).name, null, "An empty disposable database is required");
    await db.query(fs.readFileSync(path.resolve(__dirname, "../../../db/schema.sql"), "utf8"));
    await require("../../src/db/bootstrap").ensureRuntimeSchema();
    await db.query(`INSERT INTO users(id,email,password_hash) VALUES
      ('deletion-owner','deletion-owner@example.test','not-a-login'),
      ('deletion-other','deletion-other@example.test','not-a-login'),
      ('deletion-admin','deletion-admin@example.test','not-a-login');
      INSERT INTO roles(id,name) VALUES ('deletion-role','Deletion verifier');
      INSERT INTO role_permissions(role_id,permission_id)
        SELECT 'deletion-role',id FROM permissions WHERE code='project.delete';`);

    await t.test("schema is repeatable and cleanup ledger has no project or requester foreign key", async () => {
      for (let repeat = 0; repeat < 2; repeat++) for (const statement of require("../../src/db/projectDeletionSchema")) await db.query(statement);
      await db.query(`INSERT INTO project_deletion_jobs(id,project_id,project_name,requested_by)
        VALUES ('independent','already-deleted-project','Deleted project','already-deleted-user');
        INSERT INTO project_deletion_objects(job_id,bucket_name,object_name) VALUES ('independent','test-only','retained-object');`);
      await assert.rejects(db.query("UPDATE project_deletion_jobs SET status='invalid' WHERE id='independent'"), { code: "23514" });
      await assert.rejects(db.query("UPDATE project_deletion_objects SET attempts=-1 WHERE job_id='independent'"), { code: "23514" });
      await db.query("DELETE FROM project_deletion_jobs WHERE id='independent'");
      assert.deepEqual(await pendingObjects("independent"), []);
    });

    await t.test("concurrent enqueue is idempotent and status remains private after project membership disappears", async () => {
      await seedProject("idempotent");
      const service = createService({ repository: deleteRepository });
      const accepted = await Promise.all(Array.from({ length: 12 }, () => service.enqueue("idempotent", actor)));
      assert.equal(new Set(accepted.map(result => result.job.id)).size, 1);
      assert.ok(accepted.every(result => result.accepted && result.job.status === "queued"));
      await assert.rejects(service.getStatus("idempotent", other), { statusCode: 404 });
      await assert.rejects(service.enqueue("idempotent", other), { statusCode: 403 });
      await assert.rejects(service.getStatus("idempotent", null), { statusCode: 401 });
      await assert.rejects(service.getStatus("missing", actor), { statusCode: 404 });
      assert.equal((await service.getStatus("idempotent", admin)).id, accepted[0].job.id);
      await service.processNext();
      assert.equal((await service.getStatus("idempotent", actor)).status, "completed");
      assert.equal((await service.enqueue("idempotent", actor)).job.id, accepted[0].job.id);
      await assert.rejects(service.enqueue("idempotent", other), { statusCode: 404 });
      await assert.rejects(service.getStatus("idempotent", other), { statusCode: 404 });
    });

    await t.test("two API worker instances cannot execute the same live deletion", async () => {
      await seedProject("replicas");
      let entered;
      const started = new Promise(resolve => { entered = resolve; });
      let release;
      const gate = new Promise(resolve => { release = resolve; });
      let deletes = 0;
      const repository = { async deleteProjectData(input) { deletes++; entered(); await gate; return deleteRepository.deleteProjectData(input); } };
      const first = createService({ repository });
      const second = createService({ repository });
      await first.enqueue("replicas", actor);
      const processing = first.processNext();
      try {
        await started;
        await second.processNext();
        assert.equal(deletes, 1);
        assert.equal((await job("replicas")).status, "running");
      } finally { release(); await processing; }
      assert.equal((await job("replicas")).status, "completed");
    });

    await t.test("a restarted process resumes a durable running job without a stale lease wait", async () => {
      await seedProject("restart");
      const service = createService({ repository: deleteRepository });
      await service.enqueue("restart", actor);
      await db.query("UPDATE project_deletion_jobs SET status='running' WHERE project_id='restart'");
      await service.processNext();
      assert.equal((await job("restart")).status, "completed");
    });

    await t.test("failed SQL deletion rolls back project rows and its object outbox before a successful retry", async () => {
      await seedProject("rollback", 1);
      const removed = [];
      let fail = true;
      const service = createService({
        repository: { async deleteProjectData(input) {
          const result = await deleteRepository.deleteProjectData(input);
          if (fail) throw new Error("Injected SQL deletion failure with private implementation detail");
          return result;
        } },
        storage: { removeObject: async ({ bucket, objectName }) => removed.push({ bucket, objectName }) }
      });
      const accepted = await service.enqueue("rollback", actor);
      await service.processNext();
      assert.equal((await job("rollback")).status, "failed");
      assert.doesNotMatch((await job("rollback")).error, /private implementation detail/);
      assert.ok(await db.prepare("SELECT id FROM projects WHERE id='rollback'").get());
      assert.equal((await db.prepare("SELECT count(*)::int AS count FROM attachments WHERE project_id='rollback'").get()).count, 1);
      assert.deepEqual(await pendingObjects(accepted.job.id), []);
      assert.deepEqual(removed, []);
      fail = false;
      assert.equal((await service.enqueue("rollback", actor)).job.status, "queued");
      await service.processNext();
      assert.equal((await job("rollback")).status, "completed");
      assert.deepEqual(removed, [{ bucket: "test-only", objectName: "rollback/object-000" }]);
    });

    await t.test("durable cleanup retries failed objects after project rows disappear and keeps other projects intact", async () => {
      await seedProject("storage-failure", 2);
      await seedProject("retained", 1);
      let unavailable = true;
      const removals = [];
      const service = createService({ repository: deleteRepository, storage: { async removeObject(object) {
        assert.equal(await db.prepare("SELECT id FROM projects WHERE id='storage-failure'").get(), undefined, "Never delete files before SQL commit");
        removals.push(object.objectName);
        if (unavailable && object.objectName.endsWith("001")) throw new Error("Storage temporarily unavailable");
      } } });
      const accepted = await service.enqueue("storage-failure", actor);
      await service.processNext();
      assert.equal((await job("storage-failure")).status, "cleanup");
      assert.equal((await pendingObjects(accepted.job.id)).length, 1);
      assert.equal((await pendingObjects(accepted.job.id))[0].attempts, 1);
      for (let attempt = 0; attempt < 2; attempt++) {
        await db.query("UPDATE project_deletion_jobs SET next_attempt_at=CURRENT_TIMESTAMP WHERE project_id='storage-failure'");
        await service.processNext();
      }
      assert.equal((await job("storage-failure")).status, "failed");
      assert.equal((await service.getStatus("storage-failure", actor)).status, "failed");
      unavailable = false;
      assert.equal((await service.enqueue("storage-failure", actor)).job.status, "cleanup");
      await service.processNext();
      assert.equal((await job("storage-failure")).status, "completed");
      assert.deepEqual(await pendingObjects(accepted.job.id), []);
      assert.equal(removals.filter(name => name.endsWith("000")).length, 1, "Successful object cleanup is not replayed");
      assert.ok(await db.prepare("SELECT id FROM projects WHERE id='retained'").get());
      assert.equal((await db.prepare("SELECT count(*)::int AS count FROM attachments WHERE project_id='retained'").get()).count, 1);
    });

    await t.test("object cleanup uses bounded pages and at most four storage operations", async () => {
      await seedProject("storage-pages", 103);
      let active = 0, maxActive = 0, removed = 0;
      const service = createService({ repository: deleteRepository, storage: { async removeObject() {
        active++;
        maxActive = Math.max(maxActive, active);
        await new Promise(resolve => setImmediate(resolve));
        removed++;
        active--;
      } } });
      const accepted = await service.enqueue("storage-pages", actor);
      await service.processNext();
      assert.equal(removed, 100);
      assert.equal((await job("storage-pages")).status, "cleanup");
      assert.equal((await pendingObjects(accepted.job.id)).length, 3);
      await service.processNext();
      assert.equal(removed, 103);
      assert.equal(maxActive, 4);
      assert.equal((await job("storage-pages")).status, "completed");
    });

    await t.test("an uncertain COMMIT acknowledgement follows the durable cleanup state", async () => {
      await seedProject("commit-ack", 1);
      let deletes = 0, removed = 0;
      const service = createService({
        connect: async () => {
          const client = await connect();
          const query = client.query.bind(client);
          client.query = async (...args) => {
            const result = await query(...args);
            if (args[0] === "COMMIT") throw Object.assign(new Error("COMMIT acknowledgement lost"), { code: "ECONNRESET" });
            return result;
          };
          return client;
        },
        repository: { async deleteProjectData(input) { deletes++; return deleteRepository.deleteProjectData(input); } },
        storage: { async removeObject() { removed++; } }
      });
      await service.enqueue("commit-ack", actor);
      await service.processNext();
      assert.equal((await job("commit-ack")).status, "completed");
      assert.equal(deletes, 1);
      assert.equal(removed, 1);
    });

    await t.test("service write validation rejects a project queued for deletion", async () => {
      await seedProject("admission");
      const service = createService({ repository: deleteRepository });
      await service.enqueue("admission", actor);
      const scopes = require("../../src/services/projectScope.service");
      await assert.rejects(scopes.validateProjectAppTypeScope("admission", null), { statusCode: 409, code: "PROJECT_DELETING" });
      assert.deepEqual(await scopes.validateProjectAppTypeScope("retained", null), { project_id: "retained", app_type_id: null });
      await service.processNext();
    });

    await t.test("index preflight reuses an equivalent index and repairs its own interrupted concurrent build", async () => {
      const { ensureProjectDeletionIndexes } = require("../../src/services/projectDeletionIndexes");
      const client = await connect();
      try {
        await client.query(`CREATE TABLE project_deletion_index_probe (id TEXT, foreign_id TEXT);
          INSERT INTO project_deletion_index_probe VALUES ('duplicate','a'),('duplicate','b');
          CREATE INDEX existing_deletion_scope ON project_deletion_index_probe(foreign_id,id)`);
        const equivalent = { name: "idx_delete_probe_scope", table: "project_deletion_index_probe", columns: ["foreign_id"],
          sql: "CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_delete_probe_scope ON project_deletion_index_probe(foreign_id)" };
        await ensureProjectDeletionIndexes(client, [equivalent]);
        assert.equal((await client.query("SELECT to_regclass('idx_delete_probe_scope') AS name")).rows[0].name, null, "Do not build redundant indexes");
        await assert.rejects(client.query("CREATE UNIQUE INDEX CONCURRENTLY idx_delete_probe_id ON project_deletion_index_probe(id)"), { code: "23505" });
        assert.equal((await client.query("SELECT indisvalid FROM pg_index WHERE indexrelid='idx_delete_probe_id'::regclass")).rows[0].indisvalid, false);
        await ensureProjectDeletionIndexes(client, [{ name: "idx_delete_probe_id", table: "project_deletion_index_probe", columns: ["id"],
          sql: "CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_delete_probe_id ON project_deletion_index_probe(id)" }]);
        assert.equal((await client.query("SELECT indisvalid FROM pg_index WHERE indexrelid='idx_delete_probe_id'::regclass")).rows[0].indisvalid, true);
      } finally { await client.end(); }
    });

    await t.test("actual repository and index preflight delete all related data and retain durable archive/vector cleanup", async () => {
      await seedProject("actual-repository", 1);
      await db.query(`INSERT INTO app_types(id,project_id,name,type) VALUES ('actual-app','actual-repository','Web','web');
        INSERT INTO test_cases(id,app_type_id,title)
          SELECT 'actual-case-'||id,'actual-app','Case '||id FROM generate_series(1,200) id;
        INSERT INTO test_steps(id,test_case_id,step_order,action)
          SELECT 'actual-step-'||id,'actual-case-'||id,1,'Verify' FROM generate_series(1,200) id;
        INSERT INTO executions(id,project_id,app_type_id,created_by)
          VALUES ('actual-execution','actual-repository','actual-app','deletion-owner');
        INSERT INTO test_engine_jobs(id,engine_run_id,project_id,app_type_id,execution_id,test_case_id,test_case_title)
          VALUES ('actual-engine','actual-engine-run','actual-repository','actual-app','actual-execution','actual-case-1','Case 1');
        INSERT INTO automation_generator_jobs(id,project_id,app_type_id,test_case_id,transaction_id)
          VALUES ('actual-generator','actual-repository','actual-app','actual-case-1','actual-transaction');
        INSERT INTO automation_generator_jobs(id,project_id,app_type_id,test_case_id,transaction_id,status,leased_by,lease_expires_at)
          VALUES ('actual-leased-generator','actual-repository','actual-app','actual-case-1','actual-leased-transaction',
            'leased','test-worker',CURRENT_TIMESTAMP + INTERVAL '1 minute');
        INSERT INTO repository_agent_runs(id,project_id,app_type_id,agent_type,status,compiler_version,input)
          VALUES ('actual-analysis','actual-repository','actual-app','repository_knowledge','completed','test',
            '{"archive":{"bucket":"test-only","objectName":"actual-source.zip"}}');`);
      const removed = [];
      let vectorAttempts = 0;
      let id;
      const service = createService({
        storage: { async removeObject({ bucket, objectName, signal }) {
          assert.ok(signal instanceof AbortSignal);
          assert.equal(await db.prepare("SELECT id FROM projects WHERE id='actual-repository'").get(), undefined);
          assert.ok((await pendingObjects(id)).length > 0, "Object cleanup is durable after the domain transaction commits");
          removed.push({ bucket, objectName });
        } },
        vectors: {
          isConfigured: () => true,
          async deleteProject({ projectId, signal }) {
            assert.equal(projectId, "actual-repository");
            assert.ok(signal instanceof AbortSignal);
            if (++vectorAttempts === 1) throw new Error("Injected vector provider outage");
          }
        }
      });
      const accepted = await service.enqueue("actual-repository", actor);
      id = accepted.job.id;
      assert.equal(await require("../../src/services/engine.service").claimRun("test-worker"), null);
      const generator = require("../../src/services/automationGenerator.service");
      assert.equal(await generator.leaseNextJob({ worker_id: "test-worker" }), null);
      await assert.rejects(generator.runLeasedJob({ job_id: "actual-leased-generator", worker_id: "test-worker" }), { statusCode: 409 });
      await service.processNext();
      assert.equal((await job("actual-repository")).status, "cleanup");
      assert.ok(Number((await job("actual-repository")).processed_rows) >= 400);
      assert.deepEqual(removed.sort((left, right) => left.objectName.localeCompare(right.objectName)), [
        { bucket: "test-only", objectName: "actual-repository/object-000" },
        { bucket: "test-only", objectName: "actual-source.zip" }
      ]);
      const outstanding = await pendingObjects(id);
      assert.equal(outstanding.length, 1);
      assert.equal(outstanding[0].kind, "knowledge_vectors");
      assert.equal(outstanding[0].object_name, "actual-repository");
      for (const table of ["test_cases", "test_steps", "executions", "test_engine_jobs", "automation_generator_jobs", "repository_agent_runs"]) {
        assert.equal((await db.query(`SELECT count(*)::int AS count FROM ${table} WHERE id LIKE 'actual-%'`)).rows[0].count, 0, table);
      }
      assert.ok(await db.prepare("SELECT id FROM projects WHERE id='retained'").get());
      assert.ok(await db.prepare("SELECT id FROM attachments WHERE project_id='retained'").get());
      await db.query("UPDATE project_deletion_jobs SET next_attempt_at=CURRENT_TIMESTAMP WHERE project_id='actual-repository'");
      await service.processNext();
      assert.equal((await job("actual-repository")).status, "completed");
      assert.equal(vectorAttempts, 2);
      assert.equal(removed.length, 2, "Vector retry must not replay successful object cleanup");
    });

    await t.test("a recreated project ID gets a new receipt and requester authorization", async () => {
      const previous = await job("idempotent");
      assert.equal(previous.status, "completed");
      await seedProject("idempotent", 1);
      await db.query(`INSERT INTO project_members(id,project_id,user_id,role_id)
        VALUES ('idempotent-other','idempotent','deletion-other','deletion-role')`);
      const service = createService({ repository: deleteRepository });
      const accepted = await service.enqueue("idempotent", other);
      assert.notEqual(accepted.job.id, previous.id);
      assert.equal(accepted.job.status, "queued");
      assert.equal((await job("idempotent")).requested_by, other.id);
      await service.processNext();
      assert.equal((await service.getStatus("idempotent", other)).status, "completed");
      await assert.rejects(service.getStatus("idempotent", actor), { statusCode: 404 });
    });

    await t.test("legacy writer admission drains open transactions and prevents late orphan inserts or updates", async () => {
      await seedProject("write-fence");
      await db.query(`INSERT INTO ai_knowledge_repo(id,project_id,title,content)
        VALUES ('existing-fenced-knowledge','write-fence','Original','Original content')`);
      const writer = await connect();
      let processing;
      let workerPid;
      const service = createService({ connect: async () => {
        const client = await connect();
        workerPid = Number((await client.query("SELECT pg_backend_pid() AS pid")).rows[0].pid);
        return client;
      } });
      try {
        const writerPid = Number((await writer.query("SELECT pg_backend_pid() AS pid")).rows[0].pid);
        await writer.query("BEGIN");
        await writer.query(`INSERT INTO ai_knowledge_repo(id,project_id,title,content)
          VALUES ('admitted-fenced-knowledge','write-fence','Admitted writer','Uncommitted content')`);
        await service.enqueue("write-fence", actor);
        await assert.rejects(db.query("UPDATE ai_knowledge_repo SET content='Late mutation' WHERE id='existing-fenced-knowledge'"), { code: "PJD01" });
        await assert.rejects(db.query(`INSERT INTO ai_knowledge_repo(id,project_id,title,content)
          VALUES ('rejected-fenced-knowledge','write-fence','Late writer','Must fail')`), { code: "PJD01" });
        processing = service.processNext();
        let blockedByWriter = false;
        for (let attempt = 0; attempt < 200 && !blockedByWriter; attempt++) {
          if (workerPid) {
            const blockers = (await db.query("SELECT pg_blocking_pids($1) AS ids", [workerPid])).rows[0].ids;
            blockedByWriter = blockers.includes(writerPid);
          }
          if (!blockedByWriter) await new Promise(resolve => setTimeout(resolve, 5));
        }
        assert.equal(blockedByWriter, true, "Deletion's root-row lock must wait for an admitted writer transaction");
        await writer.query("COMMIT");
        await processing;
        assert.equal((await job("write-fence")).status, "completed");
        assert.equal((await db.query("SELECT count(*)::int AS count FROM ai_knowledge_repo WHERE project_id='write-fence'")).rows[0].count, 0);
        await assert.rejects(db.query(`INSERT INTO ai_knowledge_repo(id,project_id,title,content)
          VALUES ('orphan-fenced-knowledge','write-fence','Late provider result','Must not recreate an orphan')`), { code: "23503" });
        await db.query(`INSERT INTO ai_knowledge_repo(id,project_id,title,content)
          VALUES ('retained-live-knowledge','retained','Unrelated project','Writable');
          INSERT INTO automation_generator_jobs(id,project_id,test_case_id,transaction_id)
            VALUES ('null-scope-generator',NULL,'legacy-unscoped-case','null-scope-transaction')`);
        assert.ok(await db.prepare("SELECT id FROM ai_knowledge_repo WHERE id='retained-live-knowledge'").get());
        assert.ok(await db.prepare("SELECT id FROM automation_generator_jobs WHERE id='null-scope-generator'").get());
      } finally {
        await writer.query("ROLLBACK").catch(() => {});
        await writer.end();
        if (processing) await processing;
      }
    });

    await t.test("idle polling avoids a dedicated connection and a stopped service rejects new requests", async () => {
      const service = createService({ repository: deleteRepository, connect: async () => assert.fail("Idle polls must not dial a dedicated database session") });
      await service.processNext();
      await service.close();
      await service.processNext();
      await assert.rejects(service.enqueue("retained", actor), { statusCode: 503 });
    });

    await t.test("a known deletion rejects a late writer before waiting for the locked project root", async () => {
      await seedProject("early-rejection");
      const service = createService();
      await service.enqueue("early-rejection", actor);
      const deleter = await connect();
      try {
        await deleter.query("BEGIN");
        await deleter.query("SELECT id FROM projects WHERE id='early-rejection' FOR UPDATE");
        await assert.rejects(db.query(`INSERT INTO ai_knowledge_repo(id,project_id,title,content)
          VALUES ('late-locked-knowledge','early-rejection','Late writer','Reject without waiting for the project lock')`), { code: "PJD01" });
      } finally {
        await deleter.query("ROLLBACK");
        await deleter.end();
      }
      await service.processNext();
      assert.equal((await job("early-rejection")).status, "completed");
    });
  } finally {
    await Promise.allSettled(services.map(service => service.close()));
    await Promise.all([db.close(), obsDb.close()]);
  }
});
