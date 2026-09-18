const obsDb = require("../obsDb");

const requireRow = (row, message) => {
  if (!row) {
    const error = new Error(message);
    error.statusCode = 404;
    throw error;
  }
  return row;
};

exports.claimRun = obsDb.transaction(async (engineId) => {
  const job = await obsDb.prepare(`
    SELECT id, engine_run_id, payload
    FROM test_engine_jobs
    WHERE status = 'queued'
    ORDER BY created_at ASC
    FOR UPDATE SKIP LOCKED
    LIMIT 1
  `).get();

  if (!job) {
    return null;
  }

  await obsDb.prepare(`
    UPDATE test_engine_jobs
    SET status = 'leased', leased_by = ?, lease_expires_at = NOW() + INTERVAL '2 minutes', updated_at = NOW()
    WHERE id = ?
  `).run(engineId, job.id);

  return {
    runId: job.engine_run_id,
    jobId: job.id,
    payload: job.payload
  };
});

exports.loadRunSnapshot = async (runId) => {
  const row = await obsDb.prepare(`
    SELECT payload
    FROM test_engine_jobs
    WHERE engine_run_id = ?
  `).get(runId);

  return requireRow(row, `Run snapshot not found for runId=${runId}`).payload;
};

exports.heartbeatRun = async (runId, engineId) => {
  const result = await obsDb.prepare(`
    UPDATE test_engine_jobs
    SET heartbeat_at = NOW(), lease_expires_at = NOW() + INTERVAL '2 minutes', updated_at = NOW()
    WHERE engine_run_id = ? AND leased_by = ?
      AND status IN ('leased', 'running') AND lease_expires_at > NOW()
    RETURNING engine_run_id, status, leased_by, heartbeat_at
  `).get(runId, engineId);

  return requireRow(result, `Run not found or heartbeat could not be stored for runId=${runId}`);
};

exports.getRunScope = async (runId) => {
  const row = await obsDb.prepare(`
    SELECT engine_run_id, project_id, execution_id, test_case_id
    FROM test_engine_jobs
    WHERE engine_run_id = ?
  `).get(runId);

  return requireRow(row, `Run not found for runId=${runId}`);
};

exports.getRunStatus = async (runId, projectId) => {
  const row = await obsDb.prepare(`
    SELECT engine_run_id, status, leased_by, lease_expires_at, started_at, completed_at, heartbeat_at, last_error, updated_at
    FROM test_engine_jobs
    WHERE engine_run_id = ? AND project_id = ?
  `).get(runId, projectId);

  return requireRow(row, `Run status not found for runId=${runId}`);
};

exports.getRunResults = async (runId, projectId) => {
  const row = await obsDb.prepare(`
    SELECT runtime_state
    FROM test_engine_jobs
    WHERE engine_run_id = ? AND project_id = ?
  `).get(runId, projectId);

  const data = requireRow(row, `Run results not found for runId=${runId}`);
  return data.runtime_state || {};
};

exports.getRunLogs = async (runId, projectId) => {
  const row = await obsDb.prepare(`
    SELECT runtime_state->'logs' AS logs
    FROM test_engine_jobs
    WHERE engine_run_id = ? AND project_id = ?
  `).get(runId, projectId);

  const data = requireRow(row, `Run logs not found for runId=${runId}`);
  return data.logs || {};
};

exports.getRunArtifacts = async (runId, projectId) => {
  const row = await obsDb.prepare(`
    SELECT runtime_state->'artifacts' AS artifacts
    FROM test_engine_jobs
    WHERE engine_run_id = ? AND project_id = ?
  `).get(runId, projectId);

  const data = requireRow(row, `Run artifacts not found for runId=${runId}`);
  return data.artifacts || [];
};
