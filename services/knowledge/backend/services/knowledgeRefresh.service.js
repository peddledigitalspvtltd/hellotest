// Incremental, project-scoped refresh. One bounded batch per worker tick; the
// database lock also prevents duplicate work across replicas and manual starts.
const db = require("@hellotest/platform/backend/src/db");
const permissions = require("@hellotest/platform/backend/services/permission.service");
const flags = require("@hellotest/platform/backend/services/featureFlag.service");
const rag = require("./knowledgeRag.service");
const BATCH_SIZE = 30;
const MIN_INTERVAL_MS = 5000;
const MAX_INTERVAL_MS = 86400000;
const fail = (message, statusCode = 400) =>
  Object.assign(new Error(message), { statusCode, publicMessage: message });
const defaults = (projectId) => ({
  project_id: projectId,
  enabled: false,
  interval_ms: 300000,
  status: "idle",
  requested: false,
  last_result: {},
  last_error: null,
});
const get = async (projectId) =>
  (await db
    .prepare(
      "SELECT project_id, enabled, interval_ms, status, requested, next_at, last_started_at, last_completed_at, last_result, last_error FROM ai_knowledge_refresh WHERE project_id = ?",
    )
    .get(projectId)) || defaults(projectId);
async function authorize(user, projectId) {
  if (
    !user?.id ||
    !(await permissions.hasPermission(user, "knowledge.manage", projectId))
  )
    throw fail("Permission required: knowledge.manage", 403);
  if (
    !(await flags.areEnabled(
      flags.getFeatureKeysForPermission("knowledge.manage"),
      { user },
    ))
  )
    throw fail("Knowledge Repo is disabled.", 403);
}
const interval = (value) => {
  const ms = Number(value);
  if (!Number.isInteger(ms) || ms < MIN_INTERVAL_MS || ms > MAX_INTERVAL_MS)
    throw fail(
      `Refresh interval must be ${MIN_INTERVAL_MS}–${MAX_INTERVAL_MS} milliseconds.`,
    );
  return ms;
};
async function configure(projectId, input, user) {
  await authorize(user, projectId);
  if (typeof input.enabled !== "boolean")
    throw fail("Choose whether automatic refresh is enabled.");
  const ms = interval(input.interval_ms);
  await db
    .prepare(
      `INSERT INTO ai_knowledge_refresh(project_id, enabled, interval_ms, created_by, next_at)
    VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP) ON CONFLICT(project_id) DO UPDATE SET
    enabled = EXCLUDED.enabled, interval_ms = EXCLUDED.interval_ms, created_by = EXCLUDED.created_by,
    next_at = CURRENT_TIMESTAMP, last_error = NULL, updated_at = CURRENT_TIMESTAMP`,
    )
    .run(projectId, input.enabled, ms, user.id);
  return get(projectId);
}
async function request(projectId, user) {
  await authorize(user, projectId);
  await db
    .prepare(
      `INSERT INTO ai_knowledge_refresh(project_id, created_by, requested, status, next_at)
    VALUES (?, ?, TRUE, 'queued', CURRENT_TIMESTAMP) ON CONFLICT(project_id) DO UPDATE SET
    requested = TRUE, created_by = EXCLUDED.created_by,
    cursor = CASE WHEN ai_knowledge_refresh.requested THEN ai_knowledge_refresh.cursor ELSE '' END,
    last_result = CASE WHEN ai_knowledge_refresh.requested THEN ai_knowledge_refresh.last_result ELSE '{}'::jsonb END,
    status = 'queued', next_at = CURRENT_TIMESTAMP, last_error = NULL, updated_at = CURRENT_TIMESTAMP`,
    )
    .run(projectId, user.id);
  return get(projectId);
}
const RECORDS_SQL = `WITH records AS (
  SELECT 'requirement' AS kind, id, project_id FROM requirements
  UNION ALL SELECT 'test_case', c.id, a.project_id FROM test_cases c JOIN app_types a ON a.id = c.app_type_id
  UNION ALL SELECT 'bug', id, project_id FROM feedback
) SELECT kind, id, kind || ':' || id AS cursor FROM records
 WHERE project_id = ? AND kind || ':' || id > ? ORDER BY kind, id LIMIT ?`;
async function processDue() {
  let projectId;
  try {
    return await db.transaction(async () => {
      const row = await db
        .prepare(
          `SELECT * FROM ai_knowledge_refresh WHERE (enabled OR requested)
      AND next_at <= CURRENT_TIMESTAMP ORDER BY next_at, project_id LIMIT 1 FOR UPDATE SKIP LOCKED`,
        )
        .get();
      if (!row) return null;
      projectId = row.project_id;
      const user = await db
        .prepare("SELECT id, is_workspace_admin FROM users WHERE id = ?")
        .get(row.created_by);
      try {
        await authorize(user, row.project_id);
      } catch {
        await db
          .prepare(
            `UPDATE ai_knowledge_refresh SET enabled = FALSE, requested = FALSE, status = 'blocked',
      last_error = 'The refresh owner no longer has permission or Knowledge Repo is disabled.', updated_at = CURRENT_TIMESTAMP WHERE project_id = ?`,
          )
          .run(row.project_id);
        return { status: "blocked" };
      }
      // Backpressure: do not accumulate more jobs while this project's pipeline is busy.
      const pending = await db
        .prepare(
          `SELECT id FROM ai_knowledge_ingestion_jobs WHERE project_id = ? AND status IN ('queued', 'running') LIMIT 1`,
        )
        .get(row.project_id);
      if (pending) {
        await db
          .prepare(
            `UPDATE ai_knowledge_refresh SET status = 'waiting', next_at = CURRENT_TIMESTAMP + INTERVAL '5 seconds' WHERE project_id = ?`,
          )
          .run(row.project_id);
        return { status: "waiting" };
      }
      const records = await db
        .prepare(RECORDS_SQL)
        .all(row.project_id, row.cursor || "", BATCH_SIZE);
      const totals = row.cursor
        ? { ...row.last_result }
        : { scanned: 0, queued: 0, unchanged: 0, inaccessible: 0 };
      const inputs = [];
      const access = {};
      for (const record of records) {
        const permission = {
          requirement: "requirement.view",
          test_case: "testcase.view",
          bug: "feedback.view",
        }[record.kind];
        access[permission] ??=
          (await permissions.hasPermission(user, permission, row.project_id)) &&
          (await flags.areEnabled(
            flags.getFeatureKeysForPermission(permission),
            { user },
          ));
        totals.scanned++;
        if (!access[permission]) {
          totals.inaccessible++;
          continue;
        }
        if (
          await rag.isApplicationRecordIndexed(
            row.project_id,
            record.kind,
            record.id,
          )
        ) {
          totals.unchanged++;
          continue;
        }
        inputs.push({ kind: record.kind, entity_id: record.id });
      }
      if (inputs.length) {
        const accepted = await rag.enqueueIngestion({
          projectId: row.project_id,
          title: "Project context refresh",
          inputs,
          user,
        });
        totals.queued += inputs.length;
        totals.last_job_id = accepted.job.id;
      }
      const more = records.length === BATCH_SIZE;
      await db
        .prepare(
          `UPDATE ai_knowledge_refresh SET cursor = ?, requested = ?, status = ?, last_result = ?, last_error = NULL,
      last_started_at = CASE WHEN cursor = '' THEN CURRENT_TIMESTAMP ELSE last_started_at END,
      last_completed_at = CASE WHEN ? THEN last_completed_at ELSE CURRENT_TIMESTAMP END,
      next_at = CURRENT_TIMESTAMP + (?::INTEGER * INTERVAL '1 millisecond'), updated_at = CURRENT_TIMESTAMP WHERE project_id = ?`,
        )
        .run(
          more ? records.at(-1).cursor : "",
          more,
          more ? "scanning" : "completed",
          totals,
          more,
          more ? MIN_INTERVAL_MS : row.interval_ms,
          row.project_id,
        );
      return { project_id: row.project_id, ...totals, more };
    })();
  } catch (error) {
    if (projectId)
      await db
        .prepare(
          `UPDATE ai_knowledge_refresh SET status = 'failed',
      last_error = 'Refresh could not complete. Check processing activity or retry.',
      next_at = CURRENT_TIMESTAMP + INTERVAL '1 minute' WHERE project_id = ?`,
        )
        .run(projectId);
    throw error;
  }
}
module.exports = {
  get,
  configure,
  request,
  processDue,
  _internals: { interval, RECORDS_SQL, BATCH_SIZE },
};
