const { randomUUID } = require("node:crypto");
const { Client } = require("../src/db/postgresClient");
const defaultDb = require("../src/db");

const WORKER_LOCK = "hellotest:instance-setup:worker:v1";
const ADMISSION_LOCK = "hellotest:instance-setup:admission:v1";
const MAX_ATTEMPTS = 3;
const ACTIVE_STATUSES = new Set(["queued", "running"]);
const fail = (message, statusCode, code) => Object.assign(new Error(message), { statusCode, code });
const isTransient = error => ["40001", "40P01", "55P03", "57014", "57P01", "57P02", "57P03", "ECONNRESET", "ECONNREFUSED", "ETIMEDOUT"].includes(error?.code)
  || String(error?.code || "").startsWith("08") || error?.message === "Query read timeout";
const json = value => typeof value === "string" ? JSON.parse(value) : value;

const publicJob = row => row ? {
  id: row.id, status: row.status, phase: row.phase,
  requested_modules: json(row.requested_modules), installed_modules: json(row.installed_modules),
  dataset_version: Number(row.dataset_version), manifest_hash: row.manifest_hash,
  files: json(row.files), current_file: row.current_file || null,
  total_files: Number(row.total_files), completed_files: Number(row.completed_files), attempts: Number(row.attempts),
  error: json(row.error) || null, result: json(row.result) || null,
  created_at: row.created_at, started_at: row.started_at || null,
  finished_at: row.finished_at || null, updated_at: row.updated_at
} : null;
const snapshot = row => ({ running: ACTIVE_STATUSES.has(row?.status), job: publicJob(row) });

function setupClientOptions(options) {
  return { ...options, password: options.password, application_name: "hellotest-instance-setup",
    statement_timeout: 15_000, query_timeout: 20_000, lock_timeout: 3_000, connectionTimeoutMillis: 5_000 };
}

function createInstanceSetupService({
  db = defaultDb,
  getInstallPlan = modules => require("./sampleData").getInstallPlan(modules),
  install = input => require("./adminPortal.service").runSampleDataInstall(input),
  connect = async () => {
    const client = new Client(setupClientOptions(db.pool.options));
    client.on("error", () => {});
    try { await client.connect(); return client; }
    catch (error) { await client.end().catch(() => {}); throw error; }
  },
  logger = console
} = {}) {
  let stopping = false;
  let pending = null;
  let activeController = null;
  const findJob = id => db.prepare("SELECT * FROM instance_setup_jobs WHERE id = ?").get(id);
  const findActive = () => db.prepare("SELECT * FROM instance_setup_jobs WHERE status IN ('queued', 'running') LIMIT 1").get();
  const assertAccepting = () => {
    if (stopping) throw fail("The API is restarting. Retry setup shortly.", 503, "INSTANCE_SETUP_RESTARTING");
  };

  async function getStatus({ jobId } = {}) {
    if (jobId != null && (typeof jobId !== "string" || !jobId.trim() || jobId.length > 100)) {
      throw fail("A valid setup job ID is required.", 400, "INSTANCE_SETUP_JOB_INVALID");
    }
    const row = jobId ? await findJob(jobId) : await db.prepare(`SELECT * FROM instance_setup_jobs
      ORDER BY CASE WHEN status IN ('queued', 'running') THEN 0 ELSE 1 END,
        updated_at DESC, created_at DESC, id DESC LIMIT 1`).get();
    if (jobId && !row) throw fail("Instance setup job was not found.", 404, "INSTANCE_SETUP_JOB_NOT_FOUND");
    return snapshot(row);
  }

  async function start({ modules, actorId, ipAddress, once = false } = {}) {
    assertAccepting();
    if (!actorId) throw fail("An administrator is required to start instance setup.", 401, "INSTANCE_SETUP_ACTOR_REQUIRED");
    // The plan validates repository metadata without touching sample records.
    const plan = await getInstallPlan(modules);
    return db.transaction(async () => {
      await db.query("SET LOCAL lock_timeout = '3s'");
      await db.query("SELECT pg_advisory_xact_lock(hashtext(?))", [ADMISSION_LOCK]);
      const existing = await findActive();
      if (existing) return snapshot(existing);
      // Startup uses the same admission lock as administrator requests. Retain
      // failed receipts too: restarting a replica must not bypass retry limits.
      if (once) {
        const receipt = await db.prepare(`SELECT * FROM instance_setup_jobs
          WHERE manifest_hash = ? AND installed_modules @> ?::jsonb
          ORDER BY created_at DESC, id DESC LIMIT 1`).get(plan.manifest_hash, plan.selection.installed);
        if (receipt) return snapshot(receipt);
      }
      const id = randomUUID();
      const files = plan.files.map(file => ({ ...file, status: "pending", attempts: 0 }));
      await db.prepare(`INSERT INTO instance_setup_jobs
        (id, requested_modules, installed_modules, dataset_version, manifest_hash, files, total_files, requested_by, ip_address)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(id, plan.selection.requested, plan.selection.installed, plan.dataset_version, plan.manifest_hash,
          files, files.length, actorId, ipAddress || null);
      return snapshot(await findJob(id));
    })();
  }

  async function startConfigured(value = process.env.HELLOTEST_INSTANCE_SETUP_MODULES) {
    const selection = String(value || "").trim();
    if (!selection) return null;
    const modules = selection === "all" ? undefined : selection.split(",").map(item => item.trim());
    // Validate before resolving the actor; no synthetic users or fixed demo credentials.
    await getInstallPlan(modules);
    const actor = await db.prepare(`SELECT id FROM users
      WHERE is_workspace_admin = TRUE AND status = 'active'
      ORDER BY created_at, id LIMIT 1`).get();
    if (!actor) throw fail("Create an active workspace administrator before starting instance setup.", 409, "INSTANCE_SETUP_ACTOR_REQUIRED");
    return start({ modules, actorId: actor.id, once: true });
  }

  async function retry({ jobId, actorId, ipAddress } = {}) {
    assertAccepting();
    if (!actorId) throw fail("An administrator is required to retry instance setup.", 401, "INSTANCE_SETUP_ACTOR_REQUIRED");
    if (typeof jobId !== "string" || !jobId.trim() || jobId.length > 100) throw fail("A valid setup job ID is required.", 400, "INSTANCE_SETUP_JOB_INVALID");
    return db.transaction(async () => {
      await db.query("SET LOCAL lock_timeout = '3s'");
      await db.query("SELECT pg_advisory_xact_lock(hashtext(?))", [ADMISSION_LOCK]);
      const row = await findJob(jobId);
      if (!row) throw fail("Instance setup job was not found.", 404, "INSTANCE_SETUP_JOB_NOT_FOUND");
      if (ACTIVE_STATUSES.has(row.status) || row.status === "completed") return snapshot(row);
      const active = await findActive();
      if (active) throw fail("Another instance setup is already running. Wait for it to finish before retrying.", 409, "INSTANCE_SETUP_ALREADY_RUNNING");
      const plan = await getInstallPlan(json(row.requested_modules));
      if (plan.manifest_hash !== row.manifest_hash) {
        throw fail("The setup files have changed. Start a new setup to validate the updated dataset; existing records will be preserved.", 409, "INSTANCE_SETUP_DATASET_CHANGED");
      }
      await db.prepare(`UPDATE instance_setup_jobs SET status = 'queued', error = NULL, result = NULL,
        attempts = 0, requested_by = ?, ip_address = ?, finished_at = NULL,
        next_attempt_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
        .run(actorId, ipAddress || null, jobId);
      return snapshot(await findJob(jobId));
    })();
  }

  const safeError = (error, currentFile) => {
    const code = String(error?.code || "INSTANCE_SETUP_FAILED").slice(0, 100);
    const trusted = code.startsWith("INSTANCE_SETUP_") && !isTransient(error);
    return {
      code,
      message: String(error?.publicMessage || (trusted ? error.message : "Instance setup could not finish. Completed files are saved; retry to continue safely.")).slice(0, 800),
      ...(error?.file || currentFile ? { file: String(error?.file || currentFile).slice(0, 250) } : {}),
      retryable: error?.retryable !== false
    };
  };

  async function runNext() {
    if (stopping) return;
    const candidateExists = await db.prepare(`SELECT id FROM instance_setup_jobs
      WHERE status IN ('queued', 'running') AND next_attempt_at <= CURRENT_TIMESTAMP LIMIT 1`).get();
    if (!candidateExists || stopping) return;
    const client = await connect();
    const controller = new AbortController();
    activeController = controller;
    let job;
    let progress;
    // Session ownership is retained through all file transactions and audit.
    // Disconnect aborts the installer instead of letting a second worker race it.
    const onDisconnect = () => controller.abort(fail("Setup worker lost its database connection.", 503, "INSTANCE_SETUP_WORKER_DISCONNECTED"));
    client.on("error", onDisconnect);
    client.on("end", onDisconnect);
    try {
      const { rows: [lock] } = await client.query("SELECT pg_try_advisory_lock(hashtext($1)) AS acquired", [WORKER_LOCK]);
      if (!lock.acquired || stopping) return;
      const { rows: [candidate] } = await client.query(`SELECT * FROM instance_setup_jobs
        WHERE status IN ('queued', 'running') AND next_attempt_at <= CURRENT_TIMESTAMP
        ORDER BY created_at, id LIMIT 1`);
      if (!candidate) return;
      job = candidate;
      progress = publicJob(job);
      if (Number(job.attempts) >= MAX_ATTEMPTS) {
        throw fail("Instance setup was interrupted repeatedly. Review the saved progress and retry to continue.", 409, "INSTANCE_SETUP_INTERRUPTED");
      }
      job.attempts = Number(job.attempts) + 1;
      await client.query(`UPDATE instance_setup_jobs SET status = 'running', attempts = $2, error = NULL,
        started_at = COALESCE(started_at, CURRENT_TIMESTAMP), updated_at = CURRENT_TIMESTAMP WHERE id = $1`, [job.id, job.attempts]);
      const persistProgress = async (update, executor) => {
        controller.signal.throwIfAborted();
        const files = update.files || progress.files;
        const total = update.total_files ?? progress.total_files;
        if (!Array.isArray(files) || files.length !== total
          || (update.manifest_hash && update.manifest_hash !== job.manifest_hash)) {
          throw fail("Setup progress did not match the validated dataset.", 500, "INSTANCE_SETUP_PROGRESS_INVALID");
        }
        const completed = files.filter(file => file.status === "completed").length;
        progress = { ...progress, ...update, files, total_files: total, completed_files: completed };
        await executor.query(`UPDATE instance_setup_jobs SET phase = $2, files = $3::jsonb, current_file = $4,
          total_files = $5, completed_files = $6, updated_at = CURRENT_TIMESTAMP WHERE id = $1 AND status = 'running'`,
        [job.id, progress.phase, JSON.stringify(files), progress.current_file || null, total, completed]);
        controller.signal.throwIfAborted();
      };
      const onProgress = update => persistProgress(update, client);
      // Called from the installer's per-file transaction. The main adapter's
      // AsyncLocalStorage context makes the receipt commit atomically with the
      // inserted rows and administrator memberships, including their counts.
      // Ordinary progress stays on the ownership session after the commit.
      const onCheckpoint = update => persistProgress(update, db);
      const result = await install({
        modules: json(job.requested_modules), actorId: job.requested_by, ipAddress: job.ip_address,
        onProgress, onCheckpoint, checkpoints: json(job.files), expectedManifestHash: job.manifest_hash, signal: controller.signal
      });
      controller.signal.throwIfAborted();
      if (!result || progress.completed_files !== progress.total_files || progress.files.some(file => file.status !== "completed")) {
        throw fail("Setup verification did not confirm every file. Retry to recheck the saved records.", 500, "INSTANCE_SETUP_INCOMPLETE");
      }
      await client.query(`UPDATE instance_setup_jobs SET status = 'completed', phase = 'verifying',
        current_file = NULL, error = NULL, result = $2::jsonb, finished_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP WHERE id = $1 AND status = 'running'`, [job.id, JSON.stringify(result)]);
    } catch (error) {
      if (stopping || controller.signal.aborted) return; // Durable running checkpoint resumes after ownership is released.
      if (!job) throw error;
      const retrying = isTransient(error) && Number(job.attempts) < MAX_ATTEMPTS;
      const publicError = safeError(error, progress?.current_file);
      logger.error?.({ code: publicError.code, jobId: job.id, file: publicError.file }, "Instance setup needs retry");
      await client.query(`UPDATE instance_setup_jobs SET status = $2, error = $3::jsonb, result = NULL,
        finished_at = CASE WHEN $2 = 'failed' THEN CURRENT_TIMESTAMP ELSE NULL END,
        next_attempt_at = CURRENT_TIMESTAMP + INTERVAL '5 seconds', updated_at = CURRENT_TIMESTAMP
        WHERE id = $1 AND status <> 'completed'`, [job.id, retrying ? "queued" : "failed", JSON.stringify(publicError)]);
    } finally {
      client.removeListener("error", onDisconnect);
      client.removeListener("end", onDisconnect);
      activeController = null;
      await client.end().catch(() => {});
    }
  }

  function processNext() {
    if (stopping) return Promise.resolve();
    if (!pending) pending = runNext().finally(() => { pending = null; });
    return pending;
  }

  async function close() {
    stopping = true;
    activeController?.abort(fail("Instance setup will resume after the API restarts.", 503, "INSTANCE_SETUP_RESTARTING"));
    if (pending) await pending.catch(() => {});
  }

  return { start, startConfigured, retry, getStatus, processNext, close };
}

module.exports = { ...createInstanceSetupService(), createInstanceSetupService, setupClientOptions, publicJob, isTransient };
