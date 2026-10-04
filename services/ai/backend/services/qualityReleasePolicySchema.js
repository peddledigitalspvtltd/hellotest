module.exports=[
  `CREATE TABLE IF NOT EXISTS quality_release_policies (
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, version INTEGER NOT NULL,
    policy JSONB NOT NULL, policy_hash TEXT NOT NULL, approved_by TEXT REFERENCES users(id) ON DELETE SET NULL,
    rationale TEXT NOT NULL, approved_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY(project_id,version)
  )`,
  `CREATE TABLE IF NOT EXISTS quality_release_waivers (
    id TEXT PRIMARY KEY, project_id TEXT NOT NULL, policy_version INTEGER NOT NULL,
    release_id TEXT NOT NULL, build TEXT NOT NULL, environment_id TEXT NOT NULL, gate_id TEXT NOT NULL,
    evidence_hash TEXT NOT NULL, decision TEXT NOT NULL CHECK(decision IN ('approved','revoked')),
    rationale TEXT NOT NULL, reference TEXT NOT NULL, expires_at TIMESTAMPTZ NOT NULL,
    approved_by TEXT REFERENCES users(id) ON DELETE SET NULL, approved_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(project_id,policy_version) REFERENCES quality_release_policies(project_id,version) ON DELETE CASCADE
  )`,
  `CREATE INDEX IF NOT EXISTS idx_quality_release_waiver_scope ON quality_release_waivers(project_id,policy_version,release_id,build,environment_id,gate_id,approved_at DESC)`
];
