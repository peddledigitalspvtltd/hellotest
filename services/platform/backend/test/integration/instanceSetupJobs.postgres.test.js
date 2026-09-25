const assert = require("node:assert/strict");
const test = require("node:test");

test("durable instance setup admission, ownership, checkpoints and recovery", {
  skip: process.env.INSTANCE_SETUP_JOBS_POSTGRES !== "1", timeout: 90_000
}, async t => {
  const url = new URL(process.env.DATABASE_URL);
  assert.match(url.pathname, /^\/agent_verify_instance_setup_[a-z0-9_]+$/);
  process.env.POSTGRES_URL = url.toString();
  const { Client } = require("pg");
  const db = require("../../src/db");
  const { createInstanceSetupService } = require("../../services/instanceSetup.service");
  const services = [];
  const files = [
    { key: "projects", path: "foundation/projects.json", module: "foundation" },
    { key: "stories", path: "stories/stories.json", module: "stories" }
  ];
  const plan = {
    selection: { requested: ["stories"], installed: ["foundation", "stories"], dependencies_added: ["foundation"] },
    manifest_hash: "a".repeat(64), dataset_version: 5, files, total_files: files.length
  };
  const complete = async input => {
    for (const [index, file] of files.entries()) {
      await input.onProgress({ phase: "installing", current_file: file.key,
        files: files.map((value, position) => ({ ...value, status: position <= index ? "completed" : "pending", attempts: position <= index ? 1 : 0, inserted_records: position <= index ? 1 : 0 })) });
    }
    await input.onProgress({ phase: "verifying", current_file: null });
    return { idempotent: true, installed_modules: plan.selection.installed, file_results: files.map(file => ({ ...file, status: "completed" })) };
  };
  const createService = overrides => {
    const service = createInstanceSetupService({ db, getInstallPlan: () => plan, install: complete, logger: { error() {} },
      connect: async () => {
        const client = new Client({ connectionString: url.toString(), statement_timeout: 5000, connectionTimeoutMillis: 3000 });
        client.on("error", () => {});
        await client.connect();
        return client;
      }, ...overrides });
    services.push(service);
    return service;
  };
  const enqueue = service => service.start({ modules: ["stories"], actorId: "administrator", ipAddress: "127.0.0.1" });
  const clear = () => db.query("DELETE FROM instance_setup_jobs");
  const advanceRetry = () => db.query("UPDATE instance_setup_jobs SET next_attempt_at=CURRENT_TIMESTAMP");
  try {
    assert.equal((await db.prepare("SELECT to_regclass('public.instance_setup_jobs') AS name").get()).name, null);
    for (let repeat = 0; repeat < 2; repeat++) for (const statement of require("../../src/db/instanceSetupSchema")) await db.query(statement);

    await t.test("enqueue is fast, durable and deduplicates concurrent administrator requests", async () => {
      let installed = 0;
      const service = createService({ install: async input => { installed++; return complete(input); } });
      assert.deepEqual(await service.getStatus(), { running: false, job: null });
      const accepted = await Promise.all(Array.from({ length: 12 }, () => enqueue(service)));
      assert.equal(new Set(accepted.map(result => result.job.id)).size, 1);
      assert.ok(accepted.every(result => result.running && result.job.status === "queued"));
      assert.equal(installed, 0, "POST admission must not run installer work");
      assert.deepEqual(accepted[0].job.files.map(file => file.status), ["pending", "pending"]);
      assert.equal(accepted[0].job.result, null);
      assert.equal("requested_by" in accepted[0].job, false);
      await assert.rejects(enqueue(createService({ getInstallPlan: () => { throw Object.assign(new Error("Invalid module"), { statusCode: 400 }); } })), { statusCode: 400 });
      await service.processNext();
      const finished = await service.getStatus();
      assert.equal(finished.running, false);
      assert.equal(finished.job.status, "completed");
      assert.equal(finished.job.completed_files, 2);
      assert.equal(finished.job.attempts, 1);
      assert.ok(finished.job.finished_at);
      assert.ok(finished.job.result.idempotent);
      assert.equal(installed, 1);
      await assert.rejects(service.getStatus({ jobId: [] }), { statusCode: 400 });
      await assert.rejects(service.getStatus({ jobId: "unknown" }), { statusCode: 404 });
      await clear();
    });

    await t.test("independent API replicas cannot process the same live job", async () => {
      let entered;
      let release;
      const started = new Promise(resolve => { entered = resolve; });
      const gate = new Promise(resolve => { release = resolve; });
      let calls = 0;
      const install = async input => { calls++; entered(); await gate; return complete(input); };
      const first = createService({ install });
      const second = createService({ install });
      await enqueue(first);
      const processing = first.processNext();
      try {
        await started;
        assert.equal(first.processNext(), processing, "A process shares its current worker promise");
        await second.processNext();
        assert.equal(calls, 1);
        assert.equal((await first.getStatus()).job.status, "running");
      } finally { release(); await processing; }
      assert.equal((await first.getStatus()).job.status, "completed");
      await clear();
    });

    await t.test("a restarted worker receives completed checkpoints and exact manifest hash", async () => {
      const service = createService({ install: async input => {
        assert.equal(input.expectedManifestHash, plan.manifest_hash);
        assert.equal(input.checkpoints[0].status, "completed");
        assert.equal(input.checkpoints[0].inserted_records, 4);
        assert.equal(input.checkpoints[1].status, "running");
        return complete(input);
      } });
      const accepted = await enqueue(service);
      await db.prepare("UPDATE instance_setup_jobs SET status='running', attempts=1, files=? WHERE id=?").run([
        { ...files[0], status: "completed", attempts: 1, inserted_records: 4 },
        { ...files[1], status: "running", attempts: 1 }
      ], accepted.job.id);
      await service.processNext();
      assert.equal((await service.getStatus()).job.attempts, 2);
      assert.equal((await service.getStatus()).job.status, "completed");
      await clear();
    });

    await t.test("transient failures have bounded durable retries and explicit retry resets the budget", async () => {
      let unavailable = true;
      const service = createService({ install: async input => {
        if (unavailable) throw Object.assign(new Error("private SQL with credentials"), { code: "40001" });
        return complete(input);
      } });
      const accepted = await enqueue(service);
      for (let attempt = 1; attempt <= 3; attempt++) {
        await service.processNext();
        const current = (await service.getStatus()).job;
        assert.equal(current.attempts, attempt);
        assert.equal(current.status, attempt === 3 ? "failed" : "queued");
        assert.equal(current.result, null);
        assert.doesNotMatch(current.error.message, /private SQL|credentials/);
        await advanceRetry();
      }
      await service.processNext();
      assert.equal((await service.getStatus()).job.attempts, 3);
      unavailable = false;
      assert.equal((await service.retry({ jobId: accepted.job.id, actorId: "another-admin" })).job.attempts, 0);
      await service.processNext();
      assert.equal((await service.getStatus()).job.status, "completed");
      assert.equal((await service.retry({ jobId: accepted.job.id, actorId: "administrator" })).job.status, "completed");
      await clear();
    });

    await t.test("final audit failure cannot report success even after every file is complete", async () => {
      const service = createService({ install: async input => { await complete(input); throw Object.assign(new Error("audit denied"), { code: "42501" }); } });
      await enqueue(service);
      await service.processNext();
      const failed = (await service.getStatus()).job;
      assert.equal(failed.status, "failed");
      assert.equal(failed.completed_files, 2);
      assert.equal(failed.result, null);
      assert.ok(failed.finished_at);
      await clear();
    });

    await t.test("partial or invalid progress never passes setup", async () => {
      const service = createService({ install: async input => {
        await input.onProgress({ phase: "installing", current_file: files[0].key,
          files: [{ ...files[0], status: "completed", attempts: 1 }, { ...files[1], status: "pending", attempts: 0 }] });
        return { idempotent: true };
      } });
      const accepted = await enqueue(service);
      await service.processNext();
      const failed = (await service.getStatus()).job;
      assert.equal(failed.status, "failed");
      assert.equal(failed.completed_files, 1);
      assert.equal(failed.error.code, "INSTANCE_SETUP_INCOMPLETE");
      assert.equal(failed.result, null);
      await assert.rejects(createService({ getInstallPlan: () => ({ ...plan, manifest_hash: "b".repeat(64) }) })
        .retry({ jobId: accepted.job.id, actorId: "administrator" }), { code: "INSTANCE_SETUP_DATASET_CHANGED" });
      await clear();
    });

    await t.test("shutdown preserves a running checkpoint and resumes without duplicate completion", async () => {
      let entered;
      const started = new Promise(resolve => { entered = resolve; });
      const first = createService({ install: async input => {
        await input.onProgress({ phase: "installing", current_file: files[1].key,
          files: [{ ...files[0], status: "completed", attempts: 1 }, { ...files[1], status: "running", attempts: 1 }] });
        entered();
        await new Promise((_, reject) => input.signal.addEventListener("abort", () => reject(input.signal.reason), { once: true }));
      } });
      const accepted = await enqueue(first);
      const processing = first.processNext();
      await started;
      await first.close();
      await processing;
      const interrupted = (await first.getStatus()).job;
      assert.equal(interrupted.status, "running");
      assert.equal(interrupted.completed_files, 1);
      assert.equal(interrupted.result, null);
      await assert.rejects(enqueue(first), { statusCode: 503 });
      const second = createService();
      await second.processNext();
      assert.equal((await second.getStatus({ jobId: accepted.job.id })).job.status, "completed");
      await clear();
    });

    await t.test("repeated process crashes stop automatically until an administrator retries", async () => {
      let calls = 0;
      const service = createService({ install: async input => { calls++; return complete(input); } });
      const accepted = await enqueue(service);
      await db.prepare("UPDATE instance_setup_jobs SET status='running', attempts=3 WHERE id=?").run(accepted.job.id);
      await service.processNext();
      const failed = (await service.getStatus()).job;
      assert.equal(failed.status, "failed");
      assert.equal(failed.error.code, "INSTANCE_SETUP_INTERRUPTED");
      assert.equal(calls, 0);
      await service.retry({ jobId: accepted.job.id, actorId: "administrator" });
      await service.processNext();
      assert.equal((await service.getStatus()).job.status, "completed");
      assert.equal(calls, 1);
      await clear();
    });

    await t.test("status restores an older retried active receipt ahead of a newer completed receipt", async () => {
      const service = createService();
      const previous = await enqueue(service);
      await db.prepare("UPDATE instance_setup_jobs SET status='failed' WHERE id=?").run(previous.job.id);
      const newer = await enqueue(service);
      await service.processNext();
      assert.equal((await service.getStatus()).job.id, newer.job.id);
      await service.retry({ jobId: previous.job.id, actorId: "administrator" });
      assert.equal((await service.getStatus()).job.id, previous.job.id);
      assert.equal((await service.getStatus()).running, true);
      assert.equal((await service.getStatus({ jobId: newer.job.id })).job.status, "completed");
      await assert.rejects(db.prepare(`INSERT INTO instance_setup_jobs
        (id,dataset_version,manifest_hash,requested_by) VALUES ('invalid-second-active',5,'hash','admin')`).run(), { code: "23505" });
      await service.processNext();
      await clear();
    });

    await t.test("file inserts and receipt counts commit or roll back in the same transaction", async () => {
      await db.query('CREATE TABLE checkpoint_example (id TEXT PRIMARY KEY)');
      let interrupt = true;
      const service = createService({ install: async input => {
        await db.transaction(async () => {
          await db.prepare('INSERT INTO checkpoint_example(id) VALUES (?)').run('created-with-checkpoint');
          await input.onCheckpoint({ phase: 'installing', current_file: files[0].key,
            files: [{ ...files[0], status: 'completed', attempts: 1, inserted_records: 1, existing_records: 0, total_records: 1, administrator_memberships: 2 },
              { ...files[1], status: 'pending', attempts: 0 }] });
          if (interrupt) throw Object.assign(new Error('Simulated file interruption after checkpoint'), { code: 'P0001' });
        })();
        const committed = await db.prepare('SELECT files,completed_files FROM instance_setup_jobs WHERE status=\'running\'').get();
        assert.equal(committed.completed_files, 1);
        assert.equal(committed.files[0].inserted_records, 1);
        assert.equal(committed.files[0].administrator_memberships, 2);
        return complete(input);
      } });
      const accepted = await enqueue(service);
      await service.processNext();
      const failed = (await service.getStatus()).job;
      assert.equal(failed.status, 'failed');
      assert.equal(failed.completed_files, 0);
      assert.equal(failed.files[0].status, 'pending');
      assert.equal((await db.prepare('SELECT COUNT(*)::int AS count FROM checkpoint_example').get()).count, 0);
      interrupt = false;
      await service.retry({ jobId: accepted.job.id, actorId: 'administrator' });
      await service.processNext();
      assert.equal((await service.getStatus()).job.status, 'completed');
      assert.equal((await db.prepare('SELECT COUNT(*)::int AS count FROM checkpoint_example').get()).count, 1);
    });
  } finally {
    await Promise.allSettled(services.map(service => service.close()));
    await db.close();
  }
});
