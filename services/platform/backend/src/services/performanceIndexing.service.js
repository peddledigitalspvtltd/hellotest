const crypto = require("node:crypto");

// Only this deployment-owned catalog can become SQL. The API accepts no SQL,
// relation names, or index definitions from callers.
const INDEX_CATALOG = Object.freeze([
  { name: "idx_hellotest_perf_users_email", table: "users", definition: "(lower(email))", label: "Email sign-in lookup" },
  { name: "idx_hellotest_perf_users_username", table: "users", definition: "(lower(COALESCE(username, ''::text)))", label: "Administrator sign-in lookup" },
  { name: "idx_hellotest_perf_members_user_project", table: "project_members", definition: "(user_id, project_id)", label: "Project membership lookup" },
  { name: "idx_hellotest_perf_app_types_project", table: "app_types", definition: "(project_id)", label: "Application scope lookup" },
  { name: "idx_hellotest_perf_notifications_user_latest", table: "notifications", definition: "(user_id, created_at DESC, id DESC)", label: "Recent user notifications" },
  { name: "idx_hellotest_perf_executions_project_latest", table: "executions", definition: "(project_id, created_at DESC NULLS LAST, id DESC)", label: "Recent project runs" },
  { name: "idx_hellotest_perf_results_terminal_execution", table: "execution_results", definition: "(execution_id) WHERE (lower(status) = ANY (ARRAY['passed'::text, 'failed'::text, 'blocked'::text]))", label: "Completed project run outcomes" },
  { name: "idx_hellotest_perf_results_case_latest", table: "execution_results", definition: "(test_case_id, created_at DESC, id DESC) INCLUDE (status, duration_ms)", label: "Latest test case outcomes" },
  { name: "idx_hellotest_perf_requirements_catalog", table: "requirements", definition: "(project_id, (COALESCE(updated_at, created_at)) DESC NULLS LAST, created_at DESC NULLS LAST, id DESC)", label: "Story catalog pagination" },
  { name: "idx_hellotest_perf_test_cases_catalog", table: "test_cases", definition: "(app_type_id, (COALESCE(updated_at, created_at)) DESC NULLS LAST, id DESC)", label: "Test case catalog pagination" },
  { name: "idx_hellotest_perf_feedback_catalog", table: "feedback", definition: "(project_id, created_at DESC NULLS LAST, id DESC)", label: "Defect catalog pagination" }
].map(index => Object.freeze(index)));
const STATE_KEY = "admin_performance_indexing";
const LOCK_NAMESPACE = 1213485393;
const LOCK_ID = 41;
const normalizeDefinition = value => String(value)
  // pg_get_indexdef removes the outer parentheses of these catalog expressions.
  .replace(/\(COALESCE\(updated_at,\s*created_at\)\)/gi, "COALESCE(updated_at, created_at)")
  .replace(/\s+/g, " ").trim().toLowerCase();
const catalogView = () => INDEX_CATALOG.map(({ name, label }) => ({ name, label }));
const statusSql = `SELECT
  (SELECT value FROM app_settings WHERE key = $1) AS job,
  EXISTS (SELECT 1 FROM pg_locks WHERE locktype = 'advisory'
    AND database = (SELECT oid FROM pg_database WHERE datname = current_database())
    AND classid = $2::oid AND objid = $3::oid AND objsubid = 2 AND granted) AS running`;

function createPerformanceIndexingService({ query, connect, schedule = setImmediate }) {
  const clients = new Set();
  let stopping = false;
  const closeClient = async client => {
    try { await client.end(); } catch { /* A broken connection is already closed. */ }
    finally { clients.delete(client); }
  };
  const save = (client, job) => client.query(`INSERT INTO app_settings (key, value, updated_at)
    VALUES ($1, $2::jsonb, CURRENT_TIMESTAMP)
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP`, [STATE_KEY, JSON.stringify(job)]);
  const audit = (client, job, action, summary) => client.query(`INSERT INTO admin_audit_log
    (id, actor_id, action, target_type, target_id, summary, metadata, ip_address)
    VALUES ($1, $2, $3, 'database', $4, $5, $6::jsonb, $7)`,
  [crypto.randomUUID(), job.actor_id, action, job.id, summary, JSON.stringify({ status: job.status, indexes: job.indexes }), job.ip_address]);
  const publicJob = job => {
    if (!job) return null;
    const { ip_address, ...visible } = job;
    return visible;
  };
  const snapshot = (job, running) => ({ running, job: publicJob(job), catalog: catalogView() });

  async function status() {
    const { rows: [row] } = await query(statusSql, [STATE_KEY, LOCK_NAMESPACE, LOCK_ID]);
    let job = row?.job || null;
    if (job?.status === "running" && !row.running) {
      job = { ...job, status: "interrupted", error: "The indexing worker stopped. Run performance indexing again to resume safely." };
    }
    return snapshot(job, Boolean(row?.running));
  }

  async function buildIndex(client, index) {
    const { rows } = await client.query(`SELECT c.relname AS name, i.indisvalid AS valid,
      pg_get_indexdef(i.indexrelid) AS definition
      FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
      WHERE i.indrelid = to_regclass($1)`, [`public.${index.table}`]);
    const wanted = normalizeDefinition(index.definition);
    const equivalent = rows.find(row => row.valid && normalizeDefinition(row.definition.split(" USING btree ")[1]) === wanted);
    if (equivalent) return { status: "existing", existing_name: equivalent.name };

    const owned = rows.find(row => row.name === index.name);
    if (owned && (owned.valid || normalizeDefinition(owned.definition.split(" USING btree ")[1]) !== wanted)) {
      throw new Error("An index with this name has a different definition; review the database index before retrying.");
    }
    if (owned) {
      // PostgreSQL can leave an invalid index after an interrupted concurrent
      // build. Repair only a name from our reserved catalog on its own table.
      await client.query(`DROP INDEX CONCURRENTLY IF EXISTS public.${index.name}`);
    }
    await client.query(`CREATE INDEX CONCURRENTLY IF NOT EXISTS ${index.name} ON public.${index.table} USING btree ${index.definition}`);
    const { rows: [verified] } = await client.query(`SELECT i.indisvalid AS valid FROM pg_index i
      WHERE i.indexrelid = to_regclass($1) AND i.indrelid = to_regclass($2)`, [`public.${index.name}`, `public.${index.table}`]);
    if (!verified?.valid) throw new Error("The index did not finish successfully. Run performance indexing again to retry.");
    return { status: "created" };
  }

  async function run(client, job) {
    try {
      for (let position = 0; position < INDEX_CATALOG.length; position += 1) {
        if (stopping) return;
        const index = INDEX_CATALOG[position];
        job.indexes[position].status = "running";
        await save(client, job);
        try {
          Object.assign(job.indexes[position], await buildIndex(client, index));
        } catch (error) {
          Object.assign(job.indexes[position], { status: "failed", error: error.code === "55P03"
            ? "Database is busy. Retry when the competing schema operation finishes."
            : error.code === "57014" ? "Index build exceeded its time limit. Retry during a quieter period."
              : error.code === "42P01" ? "Required table is unavailable. Validate the schema, then retry."
                : error.code ? `Index build failed (${error.code}). Review database logs and retry.` : error.message });
        }
        job.completed = position + 1;
        await save(client, job);
      }
      job.status = job.indexes.some(index => index.status === "failed") ? "partial" : "completed";
      job.finished_at = new Date().toISOString();
      await save(client, job);
      await audit(client, job, "schema.performance_indexing.finish", "Completed the performance index checks.");
    } catch {
      job.status = "failed";
      job.finished_at = new Date().toISOString();
      job.error = "Indexing could not continue. Check database availability and run it again.";
      await save(client, job).catch(() => {});
    } finally {
      // Closing this dedicated session releases the cross-instance advisory
      // lock, even if persisting progress or an index build failed.
      await closeClient(client);
    }
  }

  async function start({ actorId, ipAddress = null }) {
    if (stopping) throw Object.assign(new Error("The API is stopping. Retry indexing after it restarts."), { statusCode: 503 });
    const client = await connect();
    clients.add(client);
    let transferred = false;
    try {
      if (stopping) throw Object.assign(new Error("The API is stopping. Retry indexing after it restarts."), { statusCode: 503 });
      const { rows: [lock] } = await client.query("SELECT pg_try_advisory_lock($1, $2) AS acquired", [LOCK_NAMESPACE, LOCK_ID]);
      if (!lock?.acquired) return { ...await status(), running: true };
      const job = {
        id: crypto.randomUUID(), status: "running", actor_id: actorId, ip_address: ipAddress,
        started_at: new Date().toISOString(), finished_at: null, completed: 0,
        indexes: catalogView().map(index => ({ ...index, status: "pending" }))
      };
      await audit(client, job, "schema.performance_indexing.start", "Started the performance index checks.");
      await save(client, job);
      schedule(() => { void run(client, job); });
      transferred = true;
      return snapshot(job, true);
    } finally {
      if (!transferred) await closeClient(client);
    }
  }

  async function close() {
    stopping = true;
    // pg.Client.end destroys an active query's socket. PostgreSQL then releases
    // the session lock and the next status read reports an interrupted job.
    await Promise.allSettled([...clients].map(closeClient));
  }

  return { start, status, close };
}

function indexingClientOptions(poolOptions) {
  return {
    ...poolOptions,
    // pg-pool intentionally makes this property non-enumerable.
    password: poolOptions.password,
    application_name: "hellotest-performance-indexing",
    statement_timeout: 15 * 60_000,
    query_timeout: 0,
    lock_timeout: 5_000
  };
}

const service = createPerformanceIndexingService({
  query: (...args) => require("../db").pool.query(...args),
  connect: async () => {
    const { Client } = require("pg");
    const client = new Client(indexingClientOptions(require("../db").pool.options));
    // Connection errors also reject the active query; keep the worker's catch
    // path responsible for completion instead of crashing the API process.
    client.on("error", () => {});
    try { await client.connect(); return client; }
    catch (error) { await client.end().catch(() => {}); throw error; }
  }
});

module.exports = { ...service, INDEX_CATALOG, createPerformanceIndexingService, indexingClientOptions };
