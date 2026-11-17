// Graph provenance shares the immutable PostgreSQL source/document/chunk ledger.
// Composite keys prevent a relationship from borrowing another project's proof.
const ontology = require('./services/knowledgeOntology');
const checks = ontology.checks();
const statements = [
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_knowledge_sources_graph_identity ON ai_knowledge_sources (id, project_id)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_knowledge_documents_graph_identity ON ai_knowledge_documents (id, project_id, source_id, version, checksum_sha256)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_knowledge_chunks_graph_identity ON ai_knowledge_chunks (id, project_id, document_id, source_id)`,
  `CREATE TABLE IF NOT EXISTS ai_knowledge_graph_nodes (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    source_id TEXT NOT NULL UNIQUE,
    entity_type TEXT NOT NULL,
    entity_key TEXT NOT NULL,
    title TEXT NOT NULL,
    aliases JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(aliases) = 'array'),
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    tombstoned_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK (id = source_id),
    ${checks.nodeKinds},
    UNIQUE (project_id, entity_type, entity_key), UNIQUE (id, project_id),
    FOREIGN KEY (source_id, project_id) REFERENCES ai_knowledge_sources(id, project_id) ON DELETE CASCADE
  )`,
  `CREATE INDEX IF NOT EXISTS idx_ai_knowledge_graph_nodes_project ON ai_knowledge_graph_nodes (project_id, entity_type, entity_key) WHERE tombstoned_at IS NULL`,
  `CREATE INDEX IF NOT EXISTS idx_ai_knowledge_graph_nodes_aliases ON ai_knowledge_graph_nodes USING GIN (aliases)`,
  `CREATE TABLE IF NOT EXISTS ai_knowledge_graph_edges (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    source_node_id TEXT NOT NULL,
    target_node_id TEXT NOT NULL,
    relation_type TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'CANDIDATE' ${checks.edgeStatuses},
    provenance_type TEXT NOT NULL ${checks.provenanceTypes},
    valid_from TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    valid_to TIMESTAMPTZ,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK (source_node_id <> target_node_id), CHECK (valid_to IS NULL OR valid_to >= valid_from),
    ${checks.relationTypes},
    CHECK (status <> 'ACTIVE' OR provenance_type <> 'LLM_CANDIDATE'),
    UNIQUE (project_id, source_node_id, relation_type, target_node_id), UNIQUE (id, project_id),
    FOREIGN KEY (source_node_id, project_id) REFERENCES ai_knowledge_graph_nodes(id, project_id) ON DELETE CASCADE,
    FOREIGN KEY (target_node_id, project_id) REFERENCES ai_knowledge_graph_nodes(id, project_id) ON DELETE CASCADE
  )`,
  `CREATE INDEX IF NOT EXISTS idx_ai_knowledge_graph_edges_out ON ai_knowledge_graph_edges (project_id, source_node_id, relation_type, id) WHERE status = 'ACTIVE' AND valid_to IS NULL`,
  `CREATE INDEX IF NOT EXISTS idx_ai_knowledge_graph_edges_in ON ai_knowledge_graph_edges (project_id, target_node_id, relation_type, id) WHERE status = 'ACTIVE' AND valid_to IS NULL`,
  `CREATE TABLE IF NOT EXISTS ai_knowledge_graph_edge_evidence (
    edge_id TEXT NOT NULL,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    chunk_id TEXT NOT NULL,
    document_id TEXT NOT NULL,
    source_id TEXT NOT NULL,
    document_version INTEGER NOT NULL CHECK (document_version > 0),
    version_hash TEXT NOT NULL,
    span_start INTEGER NOT NULL DEFAULT 0 CHECK (span_start >= 0),
    span_end INTEGER NOT NULL CHECK (span_end > span_start),
    provenance_type TEXT NOT NULL ${checks.provenanceTypes},
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (edge_id, chunk_id),
    FOREIGN KEY (edge_id, project_id) REFERENCES ai_knowledge_graph_edges(id, project_id) ON DELETE CASCADE,
    FOREIGN KEY (chunk_id, project_id, document_id, source_id) REFERENCES ai_knowledge_chunks(id, project_id, document_id, source_id) ON DELETE CASCADE,
    FOREIGN KEY (document_id, project_id, source_id, document_version, version_hash) REFERENCES ai_knowledge_documents(id, project_id, source_id, version, checksum_sha256) ON DELETE CASCADE
  )`,
  `CREATE INDEX IF NOT EXISTS idx_ai_knowledge_graph_evidence_document ON ai_knowledge_graph_edge_evidence (project_id, document_id, edge_id)`,
  `CREATE INDEX IF NOT EXISTS idx_ai_knowledge_graph_evidence_source ON ai_knowledge_graph_edge_evidence (project_id, source_id, edge_id)`,
  `CREATE TABLE IF NOT EXISTS ai_knowledge_graph_chunk_entities (
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    chunk_id TEXT NOT NULL,
    node_id TEXT NOT NULL,
    source_id TEXT NOT NULL,
    document_id TEXT NOT NULL,
    PRIMARY KEY (chunk_id, node_id),
    CHECK (node_id = source_id),
    FOREIGN KEY (node_id, project_id) REFERENCES ai_knowledge_graph_nodes(id, project_id) ON DELETE CASCADE,
    FOREIGN KEY (chunk_id, project_id, document_id, source_id) REFERENCES ai_knowledge_chunks(id, project_id, document_id, source_id) ON DELETE CASCADE
  )`,
  `CREATE INDEX IF NOT EXISTS idx_ai_knowledge_graph_chunk_entities_node ON ai_knowledge_graph_chunk_entities (project_id, node_id, document_id)`,
  `CREATE TABLE IF NOT EXISTS ai_knowledge_graph_projection_states (
    document_id TEXT PRIMARY KEY REFERENCES ai_knowledge_documents(id) ON DELETE CASCADE,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    unresolved_count INTEGER NOT NULL DEFAULT 0 CHECK (unresolved_count >= 0),
    projected_edge_count INTEGER NOT NULL DEFAULT 0 CHECK (projected_edge_count >= 0),
    reconciled_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    processing_version TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_ai_knowledge_graph_projection_pending ON ai_knowledge_graph_projection_states (next_attempt_at, document_id) WHERE unresolved_count > 0`,
  `CREATE TABLE IF NOT EXISTS ai_context_graph_schema_migrations (
    id TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS ai_context_graph_traces (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    actor_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    app_type_id TEXT REFERENCES app_types(id) ON DELETE SET NULL,
    feature_id TEXT NOT NULL,
    context_packet_id TEXT NOT NULL,
    task_ref TEXT,
    session_id TEXT,
    trace_ref TEXT,
    query_hash TEXT,
    selection_hash TEXT NOT NULL,
    selection JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(selection) = 'object'),
    evidence_refs JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(evidence_refs) = 'array' AND jsonb_array_length(evidence_refs) <= 30),
    coverage JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(coverage) = 'object'),
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMPTZ NOT NULL DEFAULT (CURRENT_TIMESTAMP + INTERVAL '90 days'),
    retention_policy TEXT NOT NULL DEFAULT 'standard-90d',
    UNIQUE (project_id, actor_id, context_packet_id, feature_id),
    UNIQUE (id, project_id, actor_id),
    CHECK (length(feature_id) BETWEEN 1 AND 160),
    CHECK (octet_length(evidence_refs::text) <= 49152)
  )`,
  `ALTER TABLE ai_context_graph_traces ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ`,
  `ALTER TABLE ai_context_graph_traces ADD COLUMN IF NOT EXISTS retention_policy TEXT NOT NULL DEFAULT 'standard-90d'`,
  `UPDATE ai_context_graph_traces SET expires_at = recorded_at + INTERVAL '90 days' WHERE expires_at IS NULL`,
  `ALTER TABLE ai_context_graph_traces ALTER COLUMN expires_at SET NOT NULL`,
  `ALTER TABLE ai_context_graph_traces ALTER COLUMN expires_at SET DEFAULT (CURRENT_TIMESTAMP + INTERVAL '90 days')`,
  `CREATE INDEX IF NOT EXISTS idx_ai_context_graph_traces_expiry ON ai_context_graph_traces (expires_at, id)`,
  `CREATE INDEX IF NOT EXISTS idx_ai_context_graph_traces_project_time ON ai_context_graph_traces (project_id, recorded_at DESC, id DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_ai_context_graph_traces_owner ON ai_context_graph_traces (project_id, actor_id, recorded_at DESC, id DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_ai_context_graph_traces_feature ON ai_context_graph_traces (project_id, actor_id, feature_id, recorded_at DESC, id DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_ai_context_graph_traces_session ON ai_context_graph_traces (project_id, actor_id, session_id, recorded_at DESC) WHERE session_id IS NOT NULL`,
  `CREATE TABLE IF NOT EXISTS ai_context_graph_events (
    id TEXT NOT NULL,
    trace_id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    actor_id TEXT NOT NULL,
    event_type TEXT NOT NULL CHECK (event_type IN ('REQUESTED','CONTEXT_SELECTED','CONTEXT_SENT','CITATIONS_RECORDED','POLICY_CHECKED','PROPOSAL_PREPARED','REVIEW_RECORDED','OPERATION_SUBMITTED','OUTCOME_RECORDED')),
    status TEXT NOT NULL,
    rationale TEXT,
    reference_id TEXT,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object' AND octet_length(metadata::text) <= 16384),
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    payload_hash TEXT NOT NULL,
    PRIMARY KEY (trace_id, id),
    FOREIGN KEY (trace_id, project_id, actor_id) REFERENCES ai_context_graph_traces(id, project_id, actor_id) ON DELETE CASCADE,
    CHECK (length(status) BETWEEN 1 AND 80), CHECK (rationale IS NULL OR length(rationale) <= 600)
  )`,
  `ALTER TABLE ai_context_graph_events ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb`,
  `DO $migration$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM ai_context_graph_schema_migrations WHERE id = 'context-trace-events-v2') THEN
        ALTER TABLE ai_context_graph_events DROP CONSTRAINT IF EXISTS ai_context_graph_events_event_type_check;
        ALTER TABLE ai_context_graph_events ADD CONSTRAINT ai_context_graph_events_event_type_check CHECK (event_type IN ('REQUESTED','CONTEXT_SELECTED','CONTEXT_SENT','CITATIONS_RECORDED','POLICY_CHECKED','PROPOSAL_PREPARED','REVIEW_RECORDED','OPERATION_SUBMITTED','OUTCOME_RECORDED'));
        ALTER TABLE ai_context_graph_events DROP CONSTRAINT IF EXISTS ai_context_graph_events_metadata_check;
        ALTER TABLE ai_context_graph_events ADD CONSTRAINT ai_context_graph_events_metadata_check CHECK (jsonb_typeof(metadata) = 'object' AND octet_length(metadata::text) <= 16384);
        INSERT INTO ai_context_graph_schema_migrations(id) VALUES ('context-trace-events-v2');
      END IF;
    END
  $migration$`,
  `CREATE INDEX IF NOT EXISTS idx_ai_context_graph_events_trace ON ai_context_graph_events (project_id, actor_id, trace_id, occurred_at, id)`,
  // Retention audit is deliberately aggregate-only: it records project, day,
  // reason and count, never actor IDs, trace IDs, query hashes or evidence.
  `CREATE TABLE IF NOT EXISTS ai_context_graph_retention_audit (
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    purged_on DATE NOT NULL DEFAULT CURRENT_DATE,
    reason TEXT NOT NULL CHECK (reason IN ('ttl','owner_quota','project_quota')),
    deleted_count BIGINT NOT NULL CHECK (deleted_count > 0),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (project_id, purged_on, reason)
  )`,
  // Display IDs (STORY-12, TC-45) resolve graph nodes. The expression matches the
  // exact-identifier lookup in search, so both read paths share this index.
  `CREATE INDEX IF NOT EXISTS idx_ai_knowledge_sources_display_id ON ai_knowledge_sources (project_id, (UPPER(COALESCE(metadata->>'display_id', ''))))`,
  // Relationship projection retries back off exponentially instead of every 60s.
  `ALTER TABLE ai_knowledge_graph_projection_states ADD COLUMN IF NOT EXISTS attempt_count INTEGER NOT NULL DEFAULT 0`,
  // Links whose target has not been indexed (or whose witness could not be found).
  // Recorded so the document can be re-queued the moment its target arrives.
  `CREATE TABLE IF NOT EXISTS ai_knowledge_graph_unresolved_refs (
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    document_id TEXT NOT NULL REFERENCES ai_knowledge_documents(id) ON DELETE CASCADE,
    target_kind TEXT NOT NULL,
    target_ref TEXT NOT NULL,
    reason TEXT NOT NULL DEFAULT 'target_not_indexed' CHECK (reason IN ('target_not_indexed','witness_missing','edge_rejected')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (document_id, target_kind, target_ref)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_ai_knowledge_graph_unresolved_target ON ai_knowledge_graph_unresolved_refs (project_id, target_kind, target_ref)`,
  // Existing databases pick up new node kinds / relation types exactly once per
  // ontology version (see knowledgeOntology.constraintMigrationStatements).
  ...ontology.constraintMigrationStatements()
];

module.exports = { statements, sql: statements.map(statement => `${statement};`).join('\n\n') };
