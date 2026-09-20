const { randomUUID } = require("node:crypto");
const { Client } = require("pg");
const defaultDb = require("../db");
const permissions = require("./permission.service");
const defaultStorage = require("./objectStorage.service");
const { mapWithConcurrency } = require("../utils/boundedConcurrency");
const { ensureProjectDeletionIndexes } = require("./projectDeletionIndexes");

const LOCK_NAMESPACE = 1213485393;
const LOCK_ID = 42;
const ACTIVE_STATUSES = new Set(["queued", "running", "cleanup"]);
const error = (message, statusCode) => Object.assign(new Error(message), { statusCode });
const isAdmin = user => user?.role === "admin" || user?.is_workspace_admin === true;
const publicJob = row => row && ({
  id: row.id, project_id: row.project_id, project_name: row.project_name,
  status: row.status, phase: row.phase, processed_rows: Number(row.processed_rows || 0),
  attempts: row.attempts, error: row.error || null,
  created_at: row.created_at, updated_at: row.updated_at, completed_at: row.completed_at
});

function deletionClientOptions(options) {
  return {
    ...options, password: options.password,
    application_name: "hellotest-project-deletion",
    statement_timeout: 60_000, query_timeout: 65_000, lock_timeout: 3_000,
    connectionTimeoutMillis: 5_000
  };
}

function createProjectDeletionService({
  db = defaultDb,
  connect = async () => {
    const client = new Client(deletionClientOptions(db.pool.options));
    client.on("error", () => {});
    try { await client.connect(); return client; }
    catch (failure) { await client.end().catch(() => {}); throw failure; }
  },
  repository,
  storage = defaultStorage,
  vectors = require("./knowledgeVectorStore.service"),
  hasPermission = permissions.hasPermission,
  logger = console,
  now = Date.now
} = {}) {
  let stopping = false;
  let pending = null;
  const clients = new Set();
  const shutdown = new AbortController();
  const repo = () => repository || require("./projectDeletion.repository");
  const findJob = projectId => db.prepare("SELECT * FROM project_deletion_jobs WHERE project_id = ?").get(projectId);
  const findProject = projectId => db.prepare("SELECT id, name FROM projects WHERE id = ?").get(projectId);
  const assertAuthenticated = user => { if (!user?.id) throw error("Authentication required", 401); };
  const canInspect = async (job, user) => isAdmin(user) || job.requested_by === user.id
    || await hasPermission(user, "project.delete", job.project_id);

  async function getStatus(projectId, user) {
    assertAuthenticated(user);
    const job = await findJob(projectId);
    if (!job || !await canInspect(job, user)) throw error("Project deletion was not found", 404);
    return publicJob(job);
  }

  async function enqueue(projectId, user, { authorize } = {}) {
    assertAuthenticated(user);
    if (stopping) throw error("The API is restarting. Retry shortly.", 503);
    const [project, existing] = await Promise.all([findProject(projectId), findJob(projectId)]);
    if (project) {
      // Routes provide their normal grant/feature/API-key guard. Direct service
      // callers still require the same persisted project permission.
      if (authorize) await authorize();
      else if (!await hasPermission(user, "project.delete", projectId)) throw error("Permission required: project.delete", 403);
    } else if (!existing || !(isAdmin(user) || existing.requested_by === user.id)) {
      throw error("Project not found", 404);
    }
    if (existing) {
      // Sample import and restore can legitimately reuse a previously deleted
      // project id. A new explicit deletion must receive a fresh receipt.
      if (existing.status === "completed" && project) {
        await db.prepare(`UPDATE project_deletion_jobs SET id = ?, project_name = ?, requested_by = ?,
          status = 'queued', phase = 'Queued', processed_rows = 0, attempts = 0, error = NULL,
          created_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP, started_at = NULL,
          completed_at = NULL, next_attempt_at = CURRENT_TIMESTAMP
          WHERE project_id = ? AND status = 'completed'`).run(randomUUID(), project.name, user.id, projectId);
      } else if (existing.status === "failed") {
        await db.prepare(`UPDATE project_deletion_jobs SET status = ?, phase = ?, error = NULL,
          attempts = 0, next_attempt_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
          WHERE id = ? AND status = 'failed'`).run(project ? "queued" : "cleanup", project ? "Queued" : "Deleting stored files", existing.id);
      }
      return { accepted: true, job: publicJob(await findJob(projectId)) };
    }
    await db.prepare(`INSERT INTO project_deletion_jobs
      (id, project_id, project_name, requested_by, status, phase)
      VALUES (?, ?, ?, ?, 'queued', 'Queued') ON CONFLICT (project_id) DO NOTHING`)
      .run(randomUUID(), projectId, project.name, user.id);
    return { accepted: true, job: publicJob(await findJob(projectId)) };
  }

  async function recordFailure(job, failure, cleanup = false) {
    if (stopping) return; // The session is closed; PostgreSQL rolls back and the next process resumes.
    const transient = cleanup || ["40001", "40P01", "55P03", "57014", "57P01", "ECONNRESET", "ECONNREFUSED"].includes(failure?.code)
      || String(failure?.code || "").startsWith("08") || failure?.message === "Query read timeout";
    const retry = transient && Number(job.attempts) < 3;
    const message = cleanup
      ? "Project records were deleted, but some stored files could not be removed. Retry cleanup."
      : failure?.code === "PROJECT_DELETION_SCOPE_CONFLICT"
        ? "Another project has conflicting references to this project's data. Repair those references before retrying deletion."
      : "Project deletion could not finish. The database changes were rolled back. Retry deletion.";
    logger.error?.({ code: failure?.code || "PROJECT_DELETION_FAILED", jobId: job.id }, "Project deletion needs retry");
    await db.prepare(`UPDATE project_deletion_jobs SET status = ?, error = ?,
      next_attempt_at = CURRENT_TIMESTAMP + INTERVAL '10 seconds', updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND status <> 'completed'`).run(retry ? cleanup ? "cleanup" : "queued" : "failed", message, job.id);
  }

  async function cleanupObjects(client, job) {
    const { rows } = await client.query(`SELECT bucket_name, object_name, kind FROM project_deletion_objects
      WHERE job_id = $1 ORDER BY bucket_name, object_name LIMIT 100`, [job.id]);
    let failed = false;
    // Small pages and four live operations bound storage traffic and JS memory.
    await mapWithConcurrency(rows, 4, async row => {
      try {
        if (row.kind === "knowledge_vectors") {
          await vectors.deleteProject({ projectId: row.object_name, signal: shutdown.signal });
        } else {
          const remove = storage.removeObjectBounded || storage.removeObject;
          await remove({ bucket: row.bucket_name, objectName: row.object_name, signal: shutdown.signal });
        }
        await db.prepare(`DELETE FROM project_deletion_objects WHERE job_id = ? AND bucket_name = ? AND object_name = ?`)
          .run(job.id, row.bucket_name, row.object_name);
      } catch (failure) {
        failed = true;
        await db.prepare(`UPDATE project_deletion_objects SET attempts = attempts + 1, error = 'Storage cleanup failed'
          WHERE job_id = ? AND bucket_name = ? AND object_name = ?`).run(job.id, row.bucket_name, row.object_name);
      }
    });
    if (failed) {
      await recordFailure(job, { code: "STORAGE_UNAVAILABLE" }, true);
      return;
    }
    await client.query(`UPDATE project_deletion_jobs SET
      status = CASE WHEN EXISTS (SELECT 1 FROM project_deletion_objects WHERE job_id = $1) THEN 'cleanup' ELSE 'completed' END,
      phase = CASE WHEN EXISTS (SELECT 1 FROM project_deletion_objects WHERE job_id = $1) THEN 'Deleting stored files' ELSE 'Completed' END,
      completed_at = CASE WHEN EXISTS (SELECT 1 FROM project_deletion_objects WHERE job_id = $1) THEN NULL ELSE CURRENT_TIMESTAMP END,
      attempts = 0, error = NULL, next_attempt_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = $1`, [job.id]);
  }

  async function runNext() {
    if (stopping) return;
    // Idle polling uses the existing pool. Only actual queued work opens the
    // extra session required for advisory ownership and long-running deletion.
    const available = await db.prepare(`SELECT id FROM project_deletion_jobs
      WHERE status IN ('queued', 'running', 'cleanup') AND next_attempt_at <= CURRENT_TIMESTAMP LIMIT 1`).get();
    if (!available || stopping) return;
    const client = await connect();
    clients.add(client);
    let job;
    let committed = false;
    try {
      // A session lock covers SQL, progress writes and external cleanup. It is
      // released by disconnection, so replicas cannot steal a slow live worker.
      const { rows: [lock] } = await client.query("SELECT pg_try_advisory_lock($1, $2) AS acquired", [LOCK_NAMESPACE, LOCK_ID]);
      if (!lock.acquired || stopping) return;
      const { rows: [candidate] } = await client.query(`SELECT * FROM project_deletion_jobs
        WHERE status IN ('queued', 'running', 'cleanup') AND next_attempt_at <= CURRENT_TIMESTAMP
        ORDER BY created_at, id LIMIT 1`);
      if (!candidate) return;
      job = candidate;
      job.attempts = Number(job.attempts) + 1;
      await client.query(`UPDATE project_deletion_jobs SET status = $2, attempts = $3,
        started_at = COALESCE(started_at, CURRENT_TIMESTAMP), error = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
      [job.id, job.status === "cleanup" ? "cleanup" : "running", job.attempts]);

      if (job.status !== "cleanup") {
        await db.prepare("UPDATE project_deletion_jobs SET phase = 'Preparing deletion', processed_rows = 0 WHERE id = ?").run(job.id);
        if (repo().ensureDeletionIndexes) await repo().ensureDeletionIndexes(client);
        else if (repo().PROJECT_DELETION_INDEXES) await ensureProjectDeletionIndexes(client, repo().PROJECT_DELETION_INDEXES);
        if (stopping) return;
        let lastProgress = 0;
        const onProgress = async ({ phase, totalRows = 0 }) => {
          if (stopping) throw error("Deletion worker is stopping", 503);
          if (now() - lastProgress < 500) return;
          lastProgress = now();
          await db.prepare("UPDATE project_deletion_jobs SET phase = ?, processed_rows = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
            .run(phase || "Deleting project records", totalRows, job.id);
        };
        await client.query("BEGIN");
        try {
          const { rows: [project] } = await client.query("SELECT id FROM projects WHERE id = $1 FOR UPDATE", [job.project_id]);
          if (project) {
            // The durable outbox and all project rows commit together. Never
            // remove external objects before the SQL deletion commits.
            await client.query(`INSERT INTO project_deletion_objects(job_id, bucket_name, object_name)
              SELECT $1, bucket_name, object_name FROM attachments WHERE project_id = $2
              ON CONFLICT DO NOTHING`, [job.id, job.project_id]);
            await client.query(`INSERT INTO project_deletion_objects(job_id, bucket_name, object_name)
              SELECT $1, input->'archive'->>'bucket', input->'archive'->>'objectName'
              FROM repository_agent_runs WHERE project_id = $2
                AND COALESCE(input->'archive'->>'bucket', '') <> ''
                AND COALESCE(input->'archive'->>'objectName', '') <> ''
              ON CONFLICT DO NOTHING`, [job.id, job.project_id]);
            if (vectors.isConfigured()) await client.query(`INSERT INTO project_deletion_objects(job_id, bucket_name, object_name, kind)
              VALUES ($1, '__knowledge_vectors__', $2, 'knowledge_vectors') ON CONFLICT DO NOTHING`, [job.id, job.project_id]);
            const result = await repo().deleteProjectData({ client, projectId: job.project_id, onProgress });
            await db.prepare("UPDATE project_deletion_jobs SET processed_rows = ? WHERE id = ?").run(result?.deleted_rows || 0, job.id);
          }
          await client.query(`UPDATE project_deletion_jobs SET status = 'cleanup', phase = 'Deleting stored files',
            error = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = $1`, [job.id]);
          await client.query("COMMIT");
          committed = true;
        } catch (failure) {
          await client.query("ROLLBACK").catch(() => {});
          // A lost COMMIT response has an uncertain outcome. Read durable
          // state before deciding whether data needs another deletion attempt.
          const saved = await findJob(job.project_id);
          if (saved?.status === "cleanup" || saved?.status === "completed") committed = true;
          else throw failure;
        }
      } else committed = true;
      if (!stopping) await cleanupObjects(client, job);
    } catch (failure) {
      if (job) await recordFailure(job, failure, committed || job.status === "cleanup");
      else if (!stopping) throw failure;
    } finally {
      clients.delete(client);
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
    shutdown.abort(new Error("Project deletion worker is stopping"));
    await Promise.allSettled([...clients].map(client => client.end()));
    if (pending) await pending.catch(() => {});
  }

  return { enqueue, getStatus, processNext, close };
}

module.exports = { ...createProjectDeletionService(), createProjectDeletionService, deletionClientOptions, ACTIVE_STATUSES };
