module.exports = [
  `CREATE TABLE IF NOT EXISTS quality_assertion_reviews (
    id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    story_id TEXT NOT NULL, obligation_id TEXT NOT NULL, story_revision TEXT NOT NULL,
    test_case_id TEXT NOT NULL, test_revision TEXT NOT NULL, step_id TEXT NOT NULL, assertion_hash TEXT NOT NULL,
    decision TEXT NOT NULL CHECK (decision IN ('approved','rejected','revoked')),
    rationale TEXT NOT NULL, reviewed_by TEXT REFERENCES users(id) ON DELETE SET NULL,
    verifier_version TEXT NOT NULL, request_hash TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE INDEX IF NOT EXISTS idx_quality_assertion_review_scope ON quality_assertion_reviews(project_id, story_id, test_case_id)`,
  `CREATE TABLE IF NOT EXISTS quality_graph_snapshots (
    id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    scope_key TEXT NOT NULL, scope JSONB NOT NULL, captured_by TEXT REFERENCES users(id) ON DELETE SET NULL,
    content_hash TEXT NOT NULL, observed_at TIMESTAMPTZ NOT NULL, complete BOOLEAN NOT NULL,
    limitations JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(project_id,id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_quality_graph_snapshot_scope ON quality_graph_snapshots(project_id,scope_key,observed_at DESC)`,
  `CREATE TABLE IF NOT EXISTS quality_graph_nodes (
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    entity_id TEXT NOT NULL, revision TEXT NOT NULL, kind TEXT NOT NULL, title TEXT NOT NULL,
    first_observed_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY(project_id,entity_id,revision)
  )`,
  `CREATE TABLE IF NOT EXISTS quality_graph_snapshot_nodes (
    project_id TEXT NOT NULL, snapshot_id TEXT NOT NULL, entity_id TEXT NOT NULL, revision TEXT NOT NULL,
    PRIMARY KEY(snapshot_id,entity_id),
    FOREIGN KEY(project_id,snapshot_id) REFERENCES quality_graph_snapshots(project_id,id) ON DELETE CASCADE,
    FOREIGN KEY(project_id,entity_id,revision) REFERENCES quality_graph_nodes(project_id,entity_id,revision)
  )`,
  `CREATE TABLE IF NOT EXISTS quality_graph_edges (
    project_id TEXT NOT NULL, snapshot_id TEXT NOT NULL, id TEXT NOT NULL,
    source_id TEXT NOT NULL, source_revision TEXT NOT NULL, target_id TEXT NOT NULL, target_revision TEXT NOT NULL,
    relation_type TEXT NOT NULL, origin TEXT NOT NULL, validation_state TEXT NOT NULL,
    evidence_ids JSONB NOT NULL, observed_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY(snapshot_id,id),
    FOREIGN KEY(project_id,snapshot_id) REFERENCES quality_graph_snapshots(project_id,id) ON DELETE CASCADE,
    FOREIGN KEY(project_id,source_id,source_revision) REFERENCES quality_graph_nodes(project_id,entity_id,revision),
    FOREIGN KEY(project_id,target_id,target_revision) REFERENCES quality_graph_nodes(project_id,entity_id,revision)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_quality_graph_outgoing ON quality_graph_edges(project_id,source_id,source_revision,relation_type)`,
  `CREATE INDEX IF NOT EXISTS idx_quality_graph_incoming ON quality_graph_edges(project_id,target_id,target_revision,relation_type)`,
  `CREATE TABLE IF NOT EXISTS quality_graph_tombstones (
    project_id TEXT NOT NULL, snapshot_id TEXT NOT NULL, entity_id TEXT NOT NULL, previous_revision TEXT NOT NULL,
    reason TEXT NOT NULL, observed_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY(snapshot_id,entity_id),
    FOREIGN KEY(project_id,snapshot_id) REFERENCES quality_graph_snapshots(project_id,id) ON DELETE CASCADE
  )`,
  ...require("./qualityReleasePolicySchema"),
  ...require("./automationRepairSchema"),
  ...require("./qualityGraphChangeSchema")
];
