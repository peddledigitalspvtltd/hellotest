const assert = require("node:assert/strict");
const { readFile } = require("node:fs/promises");
const path = require("node:path");
const test = require("node:test");

process.env.NODE_ENV = "test";
const db = require("../src/db");
const requirementWorkspaceService = require("../src/services/requirementWorkspace.service");
const queueInternals = requirementWorkspaceService.__storyGenerationJobInternals;

const readSource = (relativePath) => readFile(path.join(__dirname, relativePath), "utf8");

test("expired Story generation leases recover and a conditional claim has one winner", async () => {
  const originalPrepare = db.prepare;
  const originalTransaction = db.transaction;
  const row = {
    id: "job-after-crash",
    project_id: "project-1",
    status: "running",
    input_payload: { project_id: "project-1", additional_context: "Persisted input" },
    result_payload: {},
    created_by: "user-1",
    created_at: "2026-01-01T00:00:00.000Z",
    attempts: 1,
    lease_owner: "stopped-worker",
    lease_expires_at: "2026-01-01T00:01:00.000Z"
  };

  db.transaction = (callback) => async (...args) => callback(...args);
  db.prepare = (sql) => {
    if (sql.includes("FOR UPDATE SKIP LOCKED")) return {
      get: async () => row.status === "queued" || (row.status === "running" && Date.parse(row.lease_expires_at || 0) <= Date.now())
        ? { id: row.id }
        : undefined
    };
    if (sql.includes("attempts = attempts + 1")) return {
      get: async (resultPayload, leaseOwner, leaseSeconds, id) => {
        const claimable = id === row.id && (row.status === "queued" || (row.status === "running" && Date.parse(row.lease_expires_at || 0) <= Date.now()));
        if (!claimable) return undefined;
        Object.assign(row, {
          status: "running",
          result_payload: resultPayload,
          attempts: row.attempts + 1,
          lease_owner: leaseOwner,
          lease_expires_at: new Date(Date.now() + leaseSeconds * 1000).toISOString()
        });
        return { ...row };
      }
    };
    throw new Error(`Unexpected Story queue SQL: ${sql}`);
  };

  try {
    const [first, second] = await Promise.all([
      queueInternals.claimGenerationJob({ workerId: "replica-a", leaseSeconds: 60 }),
      queueInternals.claimGenerationJob({ workerId: "replica-b", leaseSeconds: 60 })
    ]);
    const winners = [first, second].filter(Boolean);
    assert.equal(winners.length, 1, "the conditional update must reject the losing replica even after both observed a candidate");
    assert.match(winners[0].lease_owner, /^replica-[ab]$/);
    assert.equal(winners[0].attempts, 2);
    assert.notEqual(winners[0].lease_owner, "stopped-worker");
  } finally {
    db.prepare = originalPrepare;
    db.transaction = originalTransaction;
  }
});

test("Story queue SQL, background registration, and accepted-job HTTP contract stay aligned", async () => {
  const [service, backgroundTasks, bootstrap, schema, routes, openapi] = await Promise.all([
    readSource("../src/services/requirementWorkspace.service.js"),
    readSource("../src/plugins/backgroundTasks.js"),
    readSource("../src/db/bootstrap.js"),
    readSource("../../db/schema.sql"),
    readSource("../src/routes/requirements.routes.js"),
    readSource("../../../openapi.yaml")
  ]);

  assert.match(service, /FOR UPDATE SKIP LOCKED/);
  assert.match(service, /status = 'running'[\s\S]*lease_expires_at IS NULL OR lease_expires_at <= CURRENT_TIMESTAMP/);
  assert.match(service, /attempts = attempts \+ 1/);
  assert.match(service, /WHERE id = \?[\s\S]*status = 'running'[\s\S]*lease_owner = \?[\s\S]*lease_expires_at > CURRENT_TIMESTAMP/);
  assert.match(service, /schedule\(\(\) => exports\.processQueuedGenerationJobs\(\{ limit: 1 \}\)\)/);
  assert.doesNotMatch(service, /schedule\(\(\) => runGenerationJob/);

  const storyTask = backgroundTasks.slice(backgroundTasks.indexOf("Unable to process queued Story AI generation jobs"));
  assert.match(storyTask.slice(0, 300), /processQueuedGenerationJobs/);
  assert.match(storyTask.slice(0, 300), /runImmediately: false/);

  const createRoute = routes.slice(routes.indexOf('fastify.post("/requirements/ai-create-jobs"'), routes.indexOf('fastify.get("/requirements/ai-create-jobs/:jobId"'));
  assert.match(createRoute, /reply\.code\(202\)/);
  assert.match(createRoute, /reply\.header\("Location"/);
  assert.match(createRoute, /reply\.header\("Retry-After", "2"\)/);
  const createPath = openapi.slice(openapi.indexOf("  /requirements/ai-create-jobs:"), openapi.indexOf("  /requirements/ai-create-jobs/{jobId}:"));
  assert.match(createPath, /"202":/);
  assert.match(createPath, /Location:/);
  assert.match(createPath, /Retry-After:/);

  for (const source of [bootstrap, schema]) {
    assert.match(source, /CREATE TABLE IF NOT EXISTS ai_requirement_generation_jobs/);
    assert.match(source, /attempts INTEGER NOT NULL DEFAULT 0/);
    assert.match(source, /lease_owner TEXT/);
    assert.match(source, /lease_expires_at TIMESTAMPTZ/);
    assert.match(source, /heartbeat_at TIMESTAMPTZ/);
    assert.match(source, /idx_ai_requirement_generation_jobs_queue/);
  }
});

test("public Story generation job responses do not expose worker lease internals", () => {
  const shaped = queueInternals.shapeJob({
    id: "job-1",
    project_id: "project-1",
    status: "running",
    input_payload: {},
    result_payload: {
      lease_owner: "model-supplied-worker-token",
      lease_expires_at: "2027-01-01T00:00:00.000Z",
      heartbeat_at: "2027-01-01T00:00:00.000Z"
    },
    attempts: 1,
    lease_owner: "private-worker-token",
    lease_expires_at: "2026-01-01T00:00:00.000Z",
    heartbeat_at: "2026-01-01T00:00:00.000Z"
  });
  assert.equal(shaped.lease_owner, undefined);
  assert.equal(shaped.lease_expires_at, undefined);
  assert.equal(shaped.heartbeat_at, undefined);
  assert.equal(shaped.result_payload.lease_owner, undefined);
  assert.equal(shaped.result_payload.lease_expires_at, undefined);
  assert.equal(shaped.result_payload.heartbeat_at, undefined);
});

test("canonical schema includes every runtime bootstrap-only AI and API-key table", async () => {
  const [bootstrap, schema] = await Promise.all([
    readSource("../src/db/bootstrap.js"),
    readSource("../../db/schema.sql")
  ]);
  const tables = [
    "ai_prompt_templates",
    "agentic_workflows",
    "agentic_workflow_runs",
    "automation_generator_jobs",
    "user_api_keys",
    "ai_requirement_generation_jobs"
  ];

  for (const table of tables) {
    const tablePattern = new RegExp(`CREATE TABLE IF NOT EXISTS ${table}\\s*\\(`);
    assert.match(bootstrap, tablePattern, `${table} must remain in runtime bootstrap`);
    assert.match(schema, tablePattern, `${table} must be installable from canonical schema`);
  }

  assert.match(schema, /agentic_workflows[\s\S]*status IN \('draft', 'active', 'paused', 'archived'\)/);
  assert.match(schema, /agentic_workflow_runs[\s\S]*status IN \('queued', 'running', 'completed', 'failed', 'aborted'\)/);
  assert.match(schema, /automation_generator_jobs[\s\S]*status IN \('queued', 'leased', 'running', 'completed', 'failed', 'cancelled'\)/);
  assert.match(schema, /user_api_keys[\s\S]*REFERENCES users\(id\) ON DELETE CASCADE/);
  assert.match(schema, /ai_requirement_generation_jobs[\s\S]*REFERENCES projects\(id\) ON DELETE CASCADE/);
});
