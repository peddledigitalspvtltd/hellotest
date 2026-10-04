module.exports = [
  `CREATE TABLE IF NOT EXISTS workflow_delivery_outbox (
    id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    run_id TEXT NOT NULL, command TEXT NOT NULL CHECK(command IN ('start','cancel')),
    payload JSONB NOT NULL, delivered_at TIMESTAMPTZ, attempts INTEGER NOT NULL DEFAULT 0,
    last_error TEXT, next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE INDEX IF NOT EXISTS idx_workflow_delivery_pending ON workflow_delivery_outbox(next_attempt_at) WHERE delivered_at IS NULL`,
  `CREATE TABLE IF NOT EXISTS workflow_node_receipts (
    run_id TEXT NOT NULL, node_id TEXT NOT NULL, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    request_hash TEXT NOT NULL, state TEXT NOT NULL CHECK(state IN ('in_flight','recorded')),
    result JSONB, result_hash TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMPTZ, PRIMARY KEY(run_id,node_id)
  )`
];
