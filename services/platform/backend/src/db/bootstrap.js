const db = require("./index");
const {
  INTEGRATION_TYPE_VALUES
} = require("../domain/catalog");
const { DEFAULT_ROLE_PERMISSIONS, PERMISSIONS } = require("../security/permissions.catalog");
const { ensureSetupRoles } = require("@hellotest/platform/backend/services/rolePreset.service");

let bootstrapPromise = null;
const SCHEMA_LOCK_KEY = "hellotest:main-runtime-schema:v1";

const sqlEnum = (values) => values.map((value) => `'${String(value).replace(/'/g, "''")}'`).join(", ");
const sqlValue = (value) => `'${String(value).replace(/'/g, "''")}'`;
const RETIRED_PRODUCT_NAMES = [
  [["QAI", "RA"].join(""), "HELLOTEST"],
  [["QAI", "ra"].join(""), "HelloTest"],
  [["QA", "ira"].join(""), "HelloTest"],
  [["Q", "aira"].join(""), "HelloTest"],
  [["qai", "ra"].join(""), "hellotest"]
];
const rebrandJsonColumn = (table, column) => {
  const migratedJson = RETIRED_PRODUCT_NAMES.reduce(
    (expression, [retiredName, currentName]) => `replace(${expression}, ${sqlValue(retiredName)}, ${sqlValue(currentName)})`,
    `${column}::text`
  );
  const retiredNamespace = RETIRED_PRODUCT_NAMES.at(-1)[0];

  return `
    UPDATE ${table}
    SET ${column} = (${migratedJson})::jsonb
    WHERE POSITION(${sqlValue(retiredNamespace)} IN LOWER(${column}::text)) > 0
  `;
};
const permissionSeedValues = PERMISSIONS
  .map((permission) => `(${sqlValue(permission.id)}, ${sqlValue(permission.code)}, ${sqlValue(permission.description)})`)
  .join(",\n      ");
const rolePermissionSeedStatements = Object.entries(DEFAULT_ROLE_PERMISSIONS).map(([roleName, permissionCodes]) => `
    INSERT INTO role_permissions (role_id, permission_id)
    SELECT roles.id, permissions.id
    FROM roles
    JOIN permissions ON permissions.code IN (${permissionCodes.map(sqlValue).join(", ")})
    WHERE LOWER(roles.name) = ${sqlValue(roleName.toLowerCase())}
    ON CONFLICT (role_id, permission_id) DO NOTHING
  `);

const statements = [
  ...require('@hellotest/agentic/backend/agents/schema'),
  ...require('./projectDeletionSchema'),
  ...require('./instanceSetupSchema'),
  `
    CREATE TABLE IF NOT EXISTS integrations (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      name TEXT NOT NULL,
      base_url TEXT,
      api_key TEXT,
      model TEXT,
      project_key TEXT,
      username TEXT,
      config JSONB NOT NULL DEFAULT '{}'::jsonb,
      is_active BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    )
  `,
  `ALTER TABLE integrations ADD COLUMN IF NOT EXISTS type TEXT`,
  `ALTER TABLE integrations ADD COLUMN IF NOT EXISTS name TEXT`,
  `ALTER TABLE integrations ADD COLUMN IF NOT EXISTS base_url TEXT`,
  `ALTER TABLE integrations ADD COLUMN IF NOT EXISTS api_key TEXT`,
  `ALTER TABLE integrations ADD COLUMN IF NOT EXISTS model TEXT`,
  `ALTER TABLE integrations ADD COLUMN IF NOT EXISTS project_key TEXT`,
  `ALTER TABLE integrations ADD COLUMN IF NOT EXISTS username TEXT`,
  `ALTER TABLE integrations ADD COLUMN IF NOT EXISTS config JSONB NOT NULL DEFAULT '{}'::jsonb`,
  `ALTER TABLE integrations ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE`,
  `ALTER TABLE integrations ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP`,
  `ALTER TABLE integrations ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP`,
  `ALTER TABLE integrations DROP CONSTRAINT IF EXISTS integrations_type_check`,
  `ALTER TABLE integrations ADD CONSTRAINT integrations_type_check CHECK (type IN (${sqlEnum(INTEGRATION_TYPE_VALUES)}))`,
  `CREATE INDEX IF NOT EXISTS idx_integrations_type_active ON integrations (type, is_active)`,
  `
    CREATE TABLE IF NOT EXISTS ai_knowledge_repo (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      app_type_id TEXT,
      asset_type TEXT NOT NULL DEFAULT 'unknown',
      module_name TEXT,
      feature_name TEXT,
      priority TEXT,
      item_version TEXT,
      item_status TEXT,
      source TEXT,
      title TEXT NOT NULL,
      description TEXT,
      content_type TEXT NOT NULL DEFAULT 'text',
      content TEXT NOT NULL,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      linked_test_cases JSONB NOT NULL DEFAULT '[]'::jsonb,
      embedding JSONB,
      source_uri TEXT,
      is_active BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    )
  `,
  `ALTER TABLE ai_knowledge_repo ADD COLUMN IF NOT EXISTS project_id TEXT`,
  `ALTER TABLE ai_knowledge_repo ADD COLUMN IF NOT EXISTS app_type_id TEXT`,
  `ALTER TABLE ai_knowledge_repo ADD COLUMN IF NOT EXISTS asset_type TEXT NOT NULL DEFAULT 'unknown'`,
  `ALTER TABLE ai_knowledge_repo ADD COLUMN IF NOT EXISTS module_name TEXT`,
  `ALTER TABLE ai_knowledge_repo ADD COLUMN IF NOT EXISTS feature_name TEXT`,
  `ALTER TABLE ai_knowledge_repo ADD COLUMN IF NOT EXISTS priority TEXT`,
  `ALTER TABLE ai_knowledge_repo ADD COLUMN IF NOT EXISTS item_version TEXT`,
  `ALTER TABLE ai_knowledge_repo ADD COLUMN IF NOT EXISTS item_status TEXT`,
  `ALTER TABLE ai_knowledge_repo ADD COLUMN IF NOT EXISTS source TEXT`,
  `ALTER TABLE ai_knowledge_repo ADD COLUMN IF NOT EXISTS title TEXT`,
  `ALTER TABLE ai_knowledge_repo ADD COLUMN IF NOT EXISTS description TEXT`,
  `ALTER TABLE ai_knowledge_repo ADD COLUMN IF NOT EXISTS content_type TEXT NOT NULL DEFAULT 'text'`,
  `ALTER TABLE ai_knowledge_repo ADD COLUMN IF NOT EXISTS content TEXT`,
  `ALTER TABLE ai_knowledge_repo ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb`,
  `ALTER TABLE ai_knowledge_repo ADD COLUMN IF NOT EXISTS linked_test_cases JSONB NOT NULL DEFAULT '[]'::jsonb`,
  `ALTER TABLE ai_knowledge_repo ADD COLUMN IF NOT EXISTS embedding JSONB`,
  `ALTER TABLE ai_knowledge_repo ADD COLUMN IF NOT EXISTS source_uri TEXT`,
  `ALTER TABLE ai_knowledge_repo ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE`,
  `ALTER TABLE ai_knowledge_repo ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP`,
  `ALTER TABLE ai_knowledge_repo ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP`,
  `UPDATE ai_knowledge_repo SET title = 'Untitled knowledge item' WHERE title IS NULL OR BTRIM(title) = ''`,
  `UPDATE ai_knowledge_repo SET content = '' WHERE content IS NULL`,
  `UPDATE ai_knowledge_repo SET content_type = 'text' WHERE content_type IS NULL OR BTRIM(content_type) = ''`,
  `UPDATE ai_knowledge_repo SET metadata = '{}'::jsonb WHERE metadata IS NULL`,
  `ALTER TABLE ai_knowledge_repo ALTER COLUMN title SET NOT NULL`,
  `ALTER TABLE ai_knowledge_repo ALTER COLUMN content SET NOT NULL`,
  `ALTER TABLE ai_knowledge_repo ALTER COLUMN content_type SET DEFAULT 'text'`,
  `ALTER TABLE ai_knowledge_repo ALTER COLUMN content_type SET NOT NULL`,
  `ALTER TABLE ai_knowledge_repo ALTER COLUMN metadata SET DEFAULT '{}'::jsonb`,
  `ALTER TABLE ai_knowledge_repo ALTER COLUMN metadata SET NOT NULL`,
  `ALTER TABLE ai_knowledge_repo DROP CONSTRAINT IF EXISTS ai_knowledge_repo_content_type_check`,
  `ALTER TABLE ai_knowledge_repo ADD CONSTRAINT ai_knowledge_repo_content_type_check CHECK (content_type IN ('text', 'url', 'video_url', 'file', 'pdf', 'image', 'markdown'))`,
  `CREATE INDEX IF NOT EXISTS idx_ai_knowledge_repo_scope ON ai_knowledge_repo (project_id, app_type_id, is_active, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_ai_knowledge_repo_asset_type ON ai_knowledge_repo (project_id, asset_type, item_status, is_active)`,
  `CREATE INDEX IF NOT EXISTS idx_ai_knowledge_repo_module_feature ON ai_knowledge_repo (project_id, module_name, feature_name, is_active)`,
  `CREATE INDEX IF NOT EXISTS idx_ai_knowledge_repo_source ON ai_knowledge_repo (project_id, source, is_active)`,
  `CREATE INDEX IF NOT EXISTS idx_ai_knowledge_repo_priority ON ai_knowledge_repo (project_id, priority, is_active)`,
  `CREATE INDEX IF NOT EXISTS idx_ai_knowledge_repo_linked_test_cases ON ai_knowledge_repo USING GIN (linked_test_cases)`,
  `
    DO $$
    BEGIN
      BEGIN
        CREATE EXTENSION IF NOT EXISTS vector;
      EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'pgvector unavailable; using JSONB cosine and PostgreSQL full-text search';
      END;
    END $$
  `,
  `
    CREATE TABLE IF NOT EXISTS ai_knowledge_collections (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      app_type_id TEXT REFERENCES app_types(id) ON DELETE SET NULL,
      name TEXT NOT NULL,
      description TEXT,
      color TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      retrieval_config JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `,
  `ALTER TABLE ai_knowledge_collections DROP CONSTRAINT IF EXISTS ai_knowledge_collections_status_check`,
  `ALTER TABLE ai_knowledge_collections ADD CONSTRAINT ai_knowledge_collections_status_check CHECK(status IN ('active', 'archived'))`,
  `CREATE INDEX IF NOT EXISTS idx_ai_knowledge_collections_project ON ai_knowledge_collections (project_id, status, updated_at DESC)`,
  `
    CREATE TABLE IF NOT EXISTS ai_knowledge_sources (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      app_type_id TEXT REFERENCES app_types(id) ON DELETE SET NULL,
      app_scope_key TEXT NOT NULL DEFAULT '',
      source_kind TEXT NOT NULL,
      source_ref_id TEXT,
      title TEXT NOT NULL,
      source_uri TEXT,
      file_name TEXT,
      mime_type TEXT,
      size_bytes BIGINT,
      attachment_id TEXT,
      checksum_sha256 TEXT,
      revision_token TEXT,
      required_permission TEXT,
      extraction_status TEXT NOT NULL DEFAULT 'pending',
      extraction_strategy TEXT,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      risk_flags JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `,
  `ALTER TABLE ai_knowledge_sources DROP CONSTRAINT IF EXISTS ai_knowledge_sources_source_kind_check`,
  `ALTER TABLE ai_knowledge_sources ADD CONSTRAINT ai_knowledge_sources_source_kind_check CHECK(source_kind IN ('requirement', 'test_case', 'execution', 'bug', 'knowledge_item', 'text', 'chat', 'file', 'url'))`,
  `ALTER TABLE ai_knowledge_sources ADD COLUMN IF NOT EXISTS required_permission TEXT`,
  `ALTER TABLE ai_knowledge_sources ADD COLUMN IF NOT EXISTS app_scope_key TEXT`,
  `UPDATE ai_knowledge_sources SET app_scope_key = COALESCE(app_type_id, '') WHERE app_scope_key IS NULL`,
  `ALTER TABLE ai_knowledge_sources ALTER COLUMN app_scope_key SET DEFAULT ''`,
  `ALTER TABLE ai_knowledge_sources ALTER COLUMN app_scope_key SET NOT NULL`,
  `ALTER TABLE ai_knowledge_sources ADD COLUMN IF NOT EXISTS revision_token TEXT`,
  `UPDATE ai_knowledge_sources SET revision_token = id || ':' || EXTRACT(EPOCH FROM updated_at)::TEXT WHERE revision_token IS NULL`,
  `ALTER TABLE ai_knowledge_sources ALTER COLUMN revision_token SET NOT NULL`,
  `UPDATE ai_knowledge_sources SET required_permission = CASE source_kind WHEN 'requirement' THEN 'requirement.view' WHEN 'test_case' THEN 'testcase.view' WHEN 'execution' THEN 'run.view' WHEN 'bug' THEN 'feedback.view' ELSE NULL END`,
  `ALTER TABLE ai_knowledge_sources DROP CONSTRAINT IF EXISTS ai_knowledge_sources_required_permission_check`,
  `ALTER TABLE ai_knowledge_sources ADD CONSTRAINT ai_knowledge_sources_required_permission_check CHECK(required_permission IS NULL OR required_permission IN ('requirement.view', 'testcase.view', 'run.view', 'feedback.view'))`,
  `ALTER TABLE ai_knowledge_sources DROP CONSTRAINT IF EXISTS ai_knowledge_sources_extraction_status_check`,
  `ALTER TABLE ai_knowledge_sources ADD CONSTRAINT ai_knowledge_sources_extraction_status_check CHECK(extraction_status IN ('pending', 'processing', 'ready', 'needs_extraction', 'failed', 'archived'))`,
  `CREATE INDEX IF NOT EXISTS idx_ai_knowledge_sources_project ON ai_knowledge_sources (project_id, extraction_status, updated_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_ai_knowledge_sources_reference ON ai_knowledge_sources (project_id, source_kind, source_ref_id)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_knowledge_sources_stable_reference ON ai_knowledge_sources (project_id, source_kind, source_ref_id) WHERE source_ref_id IS NOT NULL`,
  `DROP INDEX IF EXISTS idx_ai_knowledge_sources_content_hash`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_knowledge_sources_content_hash ON ai_knowledge_sources (project_id, app_scope_key, source_kind, checksum_sha256) WHERE source_ref_id IS NULL AND checksum_sha256 IS NOT NULL`,
  `
    CREATE TABLE IF NOT EXISTS ai_knowledge_documents (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      source_id TEXT NOT NULL REFERENCES ai_knowledge_sources(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      language TEXT NOT NULL DEFAULT 'en',
      version INTEGER NOT NULL DEFAULT 1,
      token_count INTEGER NOT NULL DEFAULT 0,
      char_count INTEGER NOT NULL DEFAULT 0,
      checksum_sha256 TEXT NOT NULL,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `,
  `CREATE INDEX IF NOT EXISTS idx_ai_knowledge_documents_source ON ai_knowledge_documents (project_id, source_id, is_active, updated_at DESC)`,
  `WITH ranked AS (
     SELECT id, ROW_NUMBER() OVER (PARTITION BY source_id ORDER BY created_at ASC, id ASC)::INTEGER AS next_version
     FROM ai_knowledge_documents
   )
   UPDATE ai_knowledge_documents documents
   SET version = ranked.next_version
   FROM ranked WHERE documents.id = ranked.id AND documents.version <> ranked.next_version`,
  `ALTER TABLE ai_knowledge_documents DROP CONSTRAINT IF EXISTS ai_knowledge_documents_source_version_key`,
  `ALTER TABLE ai_knowledge_documents ADD CONSTRAINT ai_knowledge_documents_source_version_key UNIQUE(source_id, version)`,
  `WITH ranked_active AS (
     SELECT id, ROW_NUMBER() OVER (PARTITION BY source_id ORDER BY version DESC, updated_at DESC, id DESC) AS active_rank
     FROM ai_knowledge_documents WHERE is_active = TRUE
   )
   UPDATE ai_knowledge_documents documents
   SET is_active = FALSE, updated_at = CURRENT_TIMESTAMP
   FROM ranked_active WHERE documents.id = ranked_active.id AND ranked_active.active_rank > 1`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_knowledge_documents_one_active_source ON ai_knowledge_documents (source_id) WHERE is_active = TRUE`,
  `ALTER TABLE ai_knowledge_documents ADD COLUMN IF NOT EXISTS effective_from TIMESTAMPTZ`,
  `ALTER TABLE ai_knowledge_documents ADD COLUMN IF NOT EXISTS effective_to TIMESTAMPTZ`,
  `WITH revisions AS (
    SELECT id, created_at, LEAD(created_at) OVER (PARTITION BY source_id ORDER BY version) AS next_revision_at
    FROM ai_knowledge_documents
  ) UPDATE ai_knowledge_documents documents SET effective_from = revisions.created_at,
    effective_to = CASE WHEN documents.is_active THEN NULL ELSE revisions.next_revision_at END
    FROM revisions WHERE documents.id = revisions.id AND documents.effective_from IS NULL`,
  `ALTER TABLE ai_knowledge_documents ALTER COLUMN effective_from SET DEFAULT CURRENT_TIMESTAMP`,
  `ALTER TABLE ai_knowledge_documents ALTER COLUMN effective_from SET NOT NULL`,
  `
    CREATE TABLE IF NOT EXISTS ai_knowledge_chunks (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      document_id TEXT NOT NULL REFERENCES ai_knowledge_documents(id) ON DELETE CASCADE,
      source_id TEXT NOT NULL REFERENCES ai_knowledge_sources(id) ON DELETE CASCADE,
      chunk_index INTEGER NOT NULL,
      heading TEXT,
      content TEXT NOT NULL,
      token_count INTEGER NOT NULL DEFAULT 0,
      char_start INTEGER NOT NULL DEFAULT 0,
      char_end INTEGER NOT NULL DEFAULT 0,
      search_vector TSVECTOR NOT NULL DEFAULT to_tsvector('simple', ''),
      embedding JSONB,
      fallback_embedding JSONB,
      embedding_model TEXT,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(document_id, chunk_index)
    )
  `,
  `ALTER TABLE ai_knowledge_chunks ADD COLUMN IF NOT EXISTS fallback_embedding JSONB`,
  `CREATE INDEX IF NOT EXISTS idx_ai_knowledge_chunks_project ON ai_knowledge_chunks (project_id, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_ai_knowledge_chunks_search ON ai_knowledge_chunks USING GIN (search_vector)`,
  `
    DO $$
    BEGIN
      IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector') THEN
        ALTER TABLE ai_knowledge_chunks ADD COLUMN IF NOT EXISTS embedding_vector vector;
      END IF;
    END $$
  `,
  `
    CREATE TABLE IF NOT EXISTS ai_knowledge_index_states (
      document_id TEXT PRIMARY KEY REFERENCES ai_knowledge_documents(id) ON DELETE CASCADE,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      source_id TEXT NOT NULL REFERENCES ai_knowledge_sources(id) ON DELETE CASCADE,
      document_version INTEGER NOT NULL,
      is_current BOOLEAN NOT NULL DEFAULT FALSE,
      lexical_state TEXT NOT NULL DEFAULT 'pending',
      dense_state TEXT NOT NULL DEFAULT 'pending',
      vector_provider TEXT NOT NULL DEFAULT 'postgresql',
      embedding_model TEXT,
      embedding_dimensions INTEGER,
      indexed_chunk_count INTEGER NOT NULL DEFAULT 0,
      error_fingerprint TEXT,
      indexed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `,
  `ALTER TABLE ai_knowledge_index_states DROP CONSTRAINT IF EXISTS ai_knowledge_index_states_lexical_state_check`,
  `ALTER TABLE ai_knowledge_index_states ADD CONSTRAINT ai_knowledge_index_states_lexical_state_check CHECK(lexical_state IN ('pending', 'ready', 'degraded', 'failed'))`,
  `ALTER TABLE ai_knowledge_index_states DROP CONSTRAINT IF EXISTS ai_knowledge_index_states_dense_state_check`,
  `ALTER TABLE ai_knowledge_index_states ADD CONSTRAINT ai_knowledge_index_states_dense_state_check CHECK(dense_state IN ('pending', 'ready', 'degraded', 'failed', 'not_configured'))`,
  `CREATE INDEX IF NOT EXISTS idx_ai_knowledge_index_states_current ON ai_knowledge_index_states (project_id, source_id, is_current, updated_at DESC)`,
  `ALTER TABLE ai_knowledge_index_states ADD COLUMN IF NOT EXISTS required_indexes_ready BOOLEAN NOT NULL DEFAULT FALSE`,
  `UPDATE ai_knowledge_index_states SET required_indexes_ready = TRUE
    WHERE is_current = TRUE AND lexical_state = 'ready' AND dense_state IN ('ready', 'degraded', 'not_configured')`,
  `INSERT INTO ai_knowledge_index_states
    (document_id, project_id, source_id, document_version, is_current, lexical_state, dense_state,
      vector_provider, embedding_model, indexed_chunk_count, required_indexes_ready, indexed_at)
    SELECT documents.id, documents.project_id, documents.source_id, documents.version, documents.is_active,
      'ready', CASE WHEN BOOL_AND(chunks.embedding IS NOT NULL OR chunks.fallback_embedding IS NOT NULL) THEN 'ready' ELSE 'not_configured' END,
      'postgresql', MAX(chunks.embedding_model), COUNT(*)::INTEGER, TRUE, CURRENT_TIMESTAMP
    FROM ai_knowledge_documents documents JOIN ai_knowledge_chunks chunks ON chunks.document_id = documents.id
    GROUP BY documents.id ON CONFLICT (document_id) DO NOTHING`,
  `CREATE TABLE IF NOT EXISTS ai_knowledge_security_bindings (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    source_id TEXT NOT NULL REFERENCES ai_knowledge_sources(id) ON DELETE CASCADE,
    document_id TEXT REFERENCES ai_knowledge_documents(id) ON DELETE CASCADE,
    chunk_id TEXT REFERENCES ai_knowledge_chunks(id) ON DELETE CASCADE,
    principal_type TEXT NOT NULL CHECK(principal_type IN ('PROJECT', 'USER', 'ROLE', 'EVERYONE')),
    principal_id TEXT NOT NULL,
    permission TEXT NOT NULL DEFAULT 'READ' CHECK(permission = 'READ'),
    effect TEXT NOT NULL CHECK(effect IN ('ALLOW', 'DENY')),
    inherited BOOLEAN NOT NULL DEFAULT FALSE,
    policy_version TEXT NOT NULL DEFAULT '1',
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE INDEX IF NOT EXISTS idx_ai_knowledge_security_bindings_scope ON ai_knowledge_security_bindings (project_id, source_id, document_id, chunk_id)`,
  `INSERT INTO ai_knowledge_security_bindings (id, project_id, source_id, principal_type, principal_id, effect, inherited)
    SELECT id || ':project-read', project_id, id, 'PROJECT', project_id, 'ALLOW', TRUE
    FROM ai_knowledge_sources ON CONFLICT (id) DO NOTHING`,
  `
    CREATE TABLE IF NOT EXISTS ai_knowledge_collection_sources (
      collection_id TEXT NOT NULL REFERENCES ai_knowledge_collections(id) ON DELETE CASCADE,
      source_id TEXT NOT NULL REFERENCES ai_knowledge_sources(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (collection_id, source_id)
    )
  `,
  `CREATE INDEX IF NOT EXISTS idx_ai_knowledge_collection_sources_source ON ai_knowledge_collection_sources (source_id, collection_id)`,
  `
    CREATE TABLE IF NOT EXISTS ai_knowledge_ingestion_jobs (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      collection_id TEXT REFERENCES ai_knowledge_collections(id) ON DELETE SET NULL,
      status TEXT NOT NULL DEFAULT 'queued',
      input_count INTEGER NOT NULL DEFAULT 0,
      processed_count INTEGER NOT NULL DEFAULT 0,
      failed_count INTEGER NOT NULL DEFAULT 0,
      chunk_count INTEGER NOT NULL DEFAULT 0,
      warnings JSONB NOT NULL DEFAULT '[]'::jsonb,
      errors JSONB NOT NULL DEFAULT '[]'::jsonb,
      config JSONB NOT NULL DEFAULT '{}'::jsonb,
      idempotency_key TEXT,
      lease_owner TEXT,
      lease_expires_at TIMESTAMPTZ,
      heartbeat_at TIMESTAMPTZ,
      created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      started_at TIMESTAMPTZ,
      completed_at TIMESTAMPTZ,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `,
  `ALTER TABLE ai_knowledge_ingestion_jobs DROP CONSTRAINT IF EXISTS ai_knowledge_ingestion_jobs_status_check`,
  `ALTER TABLE ai_knowledge_ingestion_jobs ADD COLUMN IF NOT EXISTS idempotency_key TEXT`,
  `ALTER TABLE ai_knowledge_ingestion_jobs ADD COLUMN IF NOT EXISTS lease_owner TEXT`,
  `ALTER TABLE ai_knowledge_ingestion_jobs ADD COLUMN IF NOT EXISTS lease_expires_at TIMESTAMPTZ`,
  `ALTER TABLE ai_knowledge_ingestion_jobs ADD COLUMN IF NOT EXISTS heartbeat_at TIMESTAMPTZ`,
  `ALTER TABLE ai_knowledge_ingestion_jobs ADD CONSTRAINT ai_knowledge_ingestion_jobs_status_check CHECK(status IN ('queued', 'running', 'completed', 'completed_with_warnings', 'failed'))`,
  `CREATE INDEX IF NOT EXISTS idx_ai_knowledge_ingestion_jobs_project ON ai_knowledge_ingestion_jobs (project_id, created_at DESC)`,
  `DROP INDEX IF EXISTS idx_ai_knowledge_ingestion_jobs_idempotency`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_knowledge_ingestion_jobs_idempotency ON ai_knowledge_ingestion_jobs (project_id, created_by, idempotency_key) WHERE idempotency_key IS NOT NULL`,
  `
    CREATE TABLE IF NOT EXISTS ai_knowledge_ingestion_inputs (
      job_id TEXT NOT NULL REFERENCES ai_knowledge_ingestion_jobs(id) ON DELETE CASCADE,
      input_index INTEGER NOT NULL,
      payload JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (job_id, input_index)
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS ai_knowledge_ingestion_results (
      job_id TEXT NOT NULL REFERENCES ai_knowledge_ingestion_jobs(id) ON DELETE CASCADE,
      input_index INTEGER NOT NULL,
      source_id TEXT REFERENCES ai_knowledge_sources(id) ON DELETE SET NULL,
      document_id TEXT REFERENCES ai_knowledge_documents(id) ON DELETE SET NULL,
      outcome TEXT NOT NULL,
      reused BOOLEAN NOT NULL DEFAULT FALSE,
      warning_codes JSONB NOT NULL DEFAULT '[]'::jsonb,
      error_fingerprint TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (job_id, input_index)
    )
  `,
  `ALTER TABLE ai_knowledge_ingestion_results DROP CONSTRAINT IF EXISTS ai_knowledge_ingestion_results_outcome_check`,
  `ALTER TABLE ai_knowledge_ingestion_results ADD CONSTRAINT ai_knowledge_ingestion_results_outcome_check CHECK(outcome IN ('indexed', 'reused', 'needs_extraction', 'failed'))`,
  `CREATE INDEX IF NOT EXISTS idx_ai_knowledge_ingestion_results_source ON ai_knowledge_ingestion_results (source_id, job_id)`,
  `
    CREATE TABLE IF NOT EXISTS ai_knowledge_sync_outbox (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      source_ref_id TEXT NOT NULL,
      action TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'queued',
      attempts INTEGER NOT NULL DEFAULT 0,
      requested_by TEXT REFERENCES users(id) ON DELETE SET NULL,
      lease_owner TEXT,
      lease_expires_at TIMESTAMPTZ,
      error_fingerprint TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(project_id, source_ref_id)
    )
  `,
  `ALTER TABLE ai_knowledge_sync_outbox DROP CONSTRAINT IF EXISTS ai_knowledge_sync_outbox_action_check`,
  `ALTER TABLE ai_knowledge_sync_outbox ADD CONSTRAINT ai_knowledge_sync_outbox_action_check CHECK(action IN ('upsert', 'archive'))`,
  `ALTER TABLE ai_knowledge_sync_outbox DROP CONSTRAINT IF EXISTS ai_knowledge_sync_outbox_status_check`,
  `ALTER TABLE ai_knowledge_sync_outbox ADD CONSTRAINT ai_knowledge_sync_outbox_status_check CHECK(status IN ('queued', 'running', 'failed'))`,
  `CREATE INDEX IF NOT EXISTS idx_ai_knowledge_sync_outbox_queue ON ai_knowledge_sync_outbox (status, created_at ASC)`,
  `
    CREATE TABLE IF NOT EXISTS ai_knowledge_assistant_sessions (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      app_type_id TEXT REFERENCES app_types(id) ON DELETE SET NULL,
      title TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      filters JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `,
  `ALTER TABLE ai_knowledge_assistant_sessions DROP CONSTRAINT IF EXISTS ai_knowledge_assistant_sessions_status_check`,
  `ALTER TABLE ai_knowledge_assistant_sessions ADD CONSTRAINT ai_knowledge_assistant_sessions_status_check CHECK(status IN ('active', 'archived'))`,
  `CREATE INDEX IF NOT EXISTS idx_ai_knowledge_assistant_sessions_project ON ai_knowledge_assistant_sessions (project_id, created_by, updated_at DESC)`,
  `
    CREATE TABLE IF NOT EXISTS ai_knowledge_assistant_messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES ai_knowledge_assistant_sessions(id) ON DELETE CASCADE,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'answered',
      citations JSONB NOT NULL DEFAULT '[]'::jsonb,
      retrieval JSONB NOT NULL DEFAULT '{}'::jsonb,
      safety JSONB NOT NULL DEFAULT '{}'::jsonb,
      provider TEXT,
      model TEXT,
      client_turn_id TEXT,
      content_fingerprint TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `,
  `ALTER TABLE ai_knowledge_assistant_messages ADD COLUMN IF NOT EXISTS client_turn_id TEXT`,
  `ALTER TABLE ai_knowledge_assistant_messages ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP`,
  `ALTER TABLE ai_knowledge_assistant_messages DROP CONSTRAINT IF EXISTS ai_knowledge_assistant_messages_role_check`,
  `ALTER TABLE ai_knowledge_assistant_messages ADD CONSTRAINT ai_knowledge_assistant_messages_role_check CHECK(role IN ('user', 'assistant'))`,
  `ALTER TABLE ai_knowledge_assistant_messages DROP CONSTRAINT IF EXISTS ai_knowledge_assistant_messages_status_check`,
  `ALTER TABLE ai_knowledge_assistant_messages ADD CONSTRAINT ai_knowledge_assistant_messages_status_check CHECK(status IN ('pending', 'answered', 'insufficient_context', 'refused', 'provider_unavailable', 'error'))`,
  `CREATE INDEX IF NOT EXISTS idx_ai_knowledge_assistant_messages_session ON ai_knowledge_assistant_messages (session_id, created_at ASC)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_knowledge_assistant_messages_turn_role ON ai_knowledge_assistant_messages (session_id, client_turn_id, role) WHERE client_turn_id IS NOT NULL`,
  `UPDATE ai_knowledge_assistant_sessions SET status = 'archived', updated_at = CURRENT_TIMESTAMP WHERE created_by IS NULL AND status = 'active'`,
  `
    CREATE TABLE IF NOT EXISTS ai_knowledge_relations (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      source_id TEXT NOT NULL,
      source_type TEXT NOT NULL,
      target_type TEXT NOT NULL,
      target_id TEXT NOT NULL,
      relation_type TEXT NOT NULL,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    )
  `,
  `ALTER TABLE ai_knowledge_relations ADD COLUMN IF NOT EXISTS project_id TEXT`,
  `ALTER TABLE ai_knowledge_relations ADD COLUMN IF NOT EXISTS source_id TEXT`,
  `ALTER TABLE ai_knowledge_relations ADD COLUMN IF NOT EXISTS source_type TEXT`,
  `ALTER TABLE ai_knowledge_relations ADD COLUMN IF NOT EXISTS target_type TEXT`,
  `ALTER TABLE ai_knowledge_relations ADD COLUMN IF NOT EXISTS target_id TEXT`,
  `ALTER TABLE ai_knowledge_relations ADD COLUMN IF NOT EXISTS relation_type TEXT`,
  `ALTER TABLE ai_knowledge_relations ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb`,
  `ALTER TABLE ai_knowledge_relations ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP`,
  `DELETE FROM ai_knowledge_relations relations WHERE relations.project_id IS NULL OR NOT EXISTS (SELECT 1 FROM projects WHERE projects.id = relations.project_id)`,
  `UPDATE ai_knowledge_relations SET created_at = CURRENT_TIMESTAMP WHERE created_at IS NULL`,
  `ALTER TABLE ai_knowledge_relations ALTER COLUMN project_id SET NOT NULL`,
  `ALTER TABLE ai_knowledge_relations ALTER COLUMN created_at SET NOT NULL`,
  `ALTER TABLE ai_knowledge_relations DROP CONSTRAINT IF EXISTS ai_knowledge_relations_project_id_fkey`,
  `ALTER TABLE ai_knowledge_relations ADD CONSTRAINT ai_knowledge_relations_project_id_fkey FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE`,
  `CREATE INDEX IF NOT EXISTS idx_ai_knowledge_relations_source ON ai_knowledge_relations (project_id, source_id, source_type)`,
  `CREATE INDEX IF NOT EXISTS idx_ai_knowledge_relations_target ON ai_knowledge_relations (project_id, target_id, target_type)`,
  `
    CREATE TABLE IF NOT EXISTS ai_prompt_templates (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      app_type_id TEXT,
      scope TEXT NOT NULL DEFAULT 'test_case_generation',
      name TEXT NOT NULL,
      description TEXT,
      goal TEXT,
      state TEXT NOT NULL DEFAULT 'future',
      start_date DATE,
      end_date DATE,
      domain TEXT,
      role TEXT,
      test_type TEXT,
      test_format TEXT,
      test_count INTEGER,
      prompt_text TEXT NOT NULL,
      applies_to JSONB NOT NULL DEFAULT '["requirements", "test_cases"]'::jsonb,
      tags JSONB NOT NULL DEFAULT '[]'::jsonb,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_by TEXT,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    )
  `,
  `ALTER TABLE ai_prompt_templates ADD COLUMN IF NOT EXISTS project_id TEXT`,
  `ALTER TABLE ai_prompt_templates ADD COLUMN IF NOT EXISTS app_type_id TEXT`,
  `ALTER TABLE ai_prompt_templates ADD COLUMN IF NOT EXISTS scope TEXT NOT NULL DEFAULT 'test_case_generation'`,
  `ALTER TABLE ai_prompt_templates ADD COLUMN IF NOT EXISTS name TEXT`,
  `ALTER TABLE ai_prompt_templates ADD COLUMN IF NOT EXISTS description TEXT`,
  `ALTER TABLE ai_prompt_templates ADD COLUMN IF NOT EXISTS domain TEXT`,
  `ALTER TABLE ai_prompt_templates ADD COLUMN IF NOT EXISTS role TEXT`,
  `ALTER TABLE ai_prompt_templates ADD COLUMN IF NOT EXISTS test_type TEXT`,
  `ALTER TABLE ai_prompt_templates ADD COLUMN IF NOT EXISTS test_format TEXT`,
  `ALTER TABLE ai_prompt_templates ADD COLUMN IF NOT EXISTS test_count INTEGER`,
  `ALTER TABLE ai_prompt_templates ADD COLUMN IF NOT EXISTS prompt_text TEXT`,
  `ALTER TABLE ai_prompt_templates ADD COLUMN IF NOT EXISTS applies_to JSONB NOT NULL DEFAULT '["requirements", "test_cases"]'::jsonb`,
  `ALTER TABLE ai_prompt_templates ADD COLUMN IF NOT EXISTS tags JSONB NOT NULL DEFAULT '[]'::jsonb`,
  `ALTER TABLE ai_prompt_templates ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE`,
  `ALTER TABLE ai_prompt_templates ADD COLUMN IF NOT EXISTS created_by TEXT`,
  `ALTER TABLE ai_prompt_templates ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP`,
  `ALTER TABLE ai_prompt_templates ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP`,
  `UPDATE ai_prompt_templates SET scope = 'test_case_generation' WHERE scope IS NULL OR BTRIM(scope) = ''`,
  `UPDATE ai_prompt_templates SET name = 'Untitled prompt template' WHERE name IS NULL OR BTRIM(name) = ''`,
  `UPDATE ai_prompt_templates SET prompt_text = '' WHERE prompt_text IS NULL`,
  `UPDATE ai_prompt_templates SET applies_to = '["requirements", "test_cases"]'::jsonb WHERE applies_to IS NULL`,
  `UPDATE ai_prompt_templates SET tags = '[]'::jsonb WHERE tags IS NULL`,
  `ALTER TABLE ai_prompt_templates ALTER COLUMN project_id SET NOT NULL`,
  `ALTER TABLE ai_prompt_templates ALTER COLUMN scope SET NOT NULL`,
  `ALTER TABLE ai_prompt_templates ALTER COLUMN name SET NOT NULL`,
  `ALTER TABLE ai_prompt_templates ALTER COLUMN prompt_text SET NOT NULL`,
  `ALTER TABLE ai_prompt_templates ALTER COLUMN applies_to SET DEFAULT '["requirements", "test_cases"]'::jsonb`,
  `ALTER TABLE ai_prompt_templates ALTER COLUMN applies_to SET NOT NULL`,
  `ALTER TABLE ai_prompt_templates ALTER COLUMN tags SET DEFAULT '[]'::jsonb`,
  `ALTER TABLE ai_prompt_templates ALTER COLUMN tags SET NOT NULL`,
  `ALTER TABLE ai_prompt_templates ALTER COLUMN is_active SET DEFAULT TRUE`,
  `ALTER TABLE ai_prompt_templates ALTER COLUMN is_active SET NOT NULL`,
  `CREATE INDEX IF NOT EXISTS idx_ai_prompt_templates_scope ON ai_prompt_templates (project_id, app_type_id, scope, is_active, updated_at DESC)`,
  `
    CREATE TABLE IF NOT EXISTS agentic_workflows (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      app_type_id TEXT,
      name TEXT NOT NULL,
      description TEXT,
      status TEXT NOT NULL DEFAULT 'draft',
      trigger_kind TEXT NOT NULL DEFAULT 'manual',
      nodes JSONB NOT NULL DEFAULT '[]'::jsonb,
      edges JSONB NOT NULL DEFAULT '[]'::jsonb,
      settings JSONB NOT NULL DEFAULT '{}'::jsonb,
      n8n_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_by TEXT,
      updated_by TEXT,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    )
  `,
  `ALTER TABLE agentic_workflows ADD COLUMN IF NOT EXISTS project_id TEXT`,
  `ALTER TABLE agentic_workflows ADD COLUMN IF NOT EXISTS app_type_id TEXT`,
  `ALTER TABLE agentic_workflows ADD COLUMN IF NOT EXISTS name TEXT`,
  `ALTER TABLE agentic_workflows ADD COLUMN IF NOT EXISTS description TEXT`,
  `ALTER TABLE agentic_workflows ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'draft'`,
  `ALTER TABLE agentic_workflows ADD COLUMN IF NOT EXISTS trigger_kind TEXT NOT NULL DEFAULT 'manual'`,
  `ALTER TABLE agentic_workflows ADD COLUMN IF NOT EXISTS nodes JSONB NOT NULL DEFAULT '[]'::jsonb`,
  `ALTER TABLE agentic_workflows ADD COLUMN IF NOT EXISTS edges JSONB NOT NULL DEFAULT '[]'::jsonb`,
  `ALTER TABLE agentic_workflows ADD COLUMN IF NOT EXISTS settings JSONB NOT NULL DEFAULT '{}'::jsonb`,
  `ALTER TABLE agentic_workflows ADD COLUMN IF NOT EXISTS n8n_payload JSONB NOT NULL DEFAULT '{}'::jsonb`,
  `ALTER TABLE agentic_workflows ADD COLUMN IF NOT EXISTS created_by TEXT`,
  `ALTER TABLE agentic_workflows ADD COLUMN IF NOT EXISTS updated_by TEXT`,
  `ALTER TABLE agentic_workflows ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP`,
  `ALTER TABLE agentic_workflows ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP`,
  `UPDATE agentic_workflows SET name = 'Untitled agentic workflow' WHERE name IS NULL OR BTRIM(name) = ''`,
  `UPDATE agentic_workflows SET status = 'draft' WHERE status IS NULL OR BTRIM(status) = ''`,
  `UPDATE agentic_workflows SET trigger_kind = 'manual' WHERE trigger_kind IS NULL OR BTRIM(trigger_kind) = ''`,
  `UPDATE agentic_workflows SET nodes = '[]'::jsonb WHERE nodes IS NULL`,
  `UPDATE agentic_workflows SET edges = '[]'::jsonb WHERE edges IS NULL`,
  `UPDATE agentic_workflows SET settings = '{}'::jsonb WHERE settings IS NULL`,
  `UPDATE agentic_workflows SET n8n_payload = '{}'::jsonb WHERE n8n_payload IS NULL`,
  `ALTER TABLE agentic_workflows ALTER COLUMN project_id SET NOT NULL`,
  `ALTER TABLE agentic_workflows ALTER COLUMN name SET NOT NULL`,
  `ALTER TABLE agentic_workflows ALTER COLUMN status SET DEFAULT 'draft'`,
  `ALTER TABLE agentic_workflows ALTER COLUMN status SET NOT NULL`,
  `ALTER TABLE agentic_workflows ALTER COLUMN trigger_kind SET DEFAULT 'manual'`,
  `ALTER TABLE agentic_workflows ALTER COLUMN trigger_kind SET NOT NULL`,
  `ALTER TABLE agentic_workflows ALTER COLUMN nodes SET DEFAULT '[]'::jsonb`,
  `ALTER TABLE agentic_workflows ALTER COLUMN nodes SET NOT NULL`,
  `ALTER TABLE agentic_workflows ALTER COLUMN edges SET DEFAULT '[]'::jsonb`,
  `ALTER TABLE agentic_workflows ALTER COLUMN edges SET NOT NULL`,
  `ALTER TABLE agentic_workflows ALTER COLUMN settings SET DEFAULT '{}'::jsonb`,
  `ALTER TABLE agentic_workflows ALTER COLUMN settings SET NOT NULL`,
  `ALTER TABLE agentic_workflows ALTER COLUMN n8n_payload SET DEFAULT '{}'::jsonb`,
  `ALTER TABLE agentic_workflows ALTER COLUMN n8n_payload SET NOT NULL`,
  `ALTER TABLE agentic_workflows DROP CONSTRAINT IF EXISTS agentic_workflows_status_check`,
  `ALTER TABLE agentic_workflows ADD CONSTRAINT agentic_workflows_status_check CHECK (status IN ('draft', 'active', 'paused', 'archived'))`,
  `CREATE INDEX IF NOT EXISTS idx_agentic_workflows_scope ON agentic_workflows (project_id, app_type_id, status, updated_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_agentic_workflows_created_by ON agentic_workflows (project_id, created_by, created_at DESC)`,
  `
    CREATE TABLE IF NOT EXISTS agentic_workflow_runs (
      id TEXT PRIMARY KEY,
      workflow_id TEXT,
      project_id TEXT NOT NULL,
      app_type_id TEXT,
      workflow_name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'queued',
      trigger_kind TEXT NOT NULL DEFAULT 'manual',
      input_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      output_payload JSONB,
      workflow_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
      node_results JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_by TEXT,
      started_at TIMESTAMPTZ,
      completed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    )
  `,
  `ALTER TABLE agentic_workflow_runs ADD COLUMN IF NOT EXISTS workflow_id TEXT`,
  `ALTER TABLE agentic_workflow_runs ADD COLUMN IF NOT EXISTS project_id TEXT`,
  `ALTER TABLE agentic_workflow_runs ADD COLUMN IF NOT EXISTS app_type_id TEXT`,
  `ALTER TABLE agentic_workflow_runs ADD COLUMN IF NOT EXISTS workflow_name TEXT`,
  `ALTER TABLE agentic_workflow_runs ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'queued'`,
  `ALTER TABLE agentic_workflow_runs ADD COLUMN IF NOT EXISTS trigger_kind TEXT NOT NULL DEFAULT 'manual'`,
  `ALTER TABLE agentic_workflow_runs ADD COLUMN IF NOT EXISTS input_payload JSONB NOT NULL DEFAULT '{}'::jsonb`,
  `ALTER TABLE agentic_workflow_runs ADD COLUMN IF NOT EXISTS output_payload JSONB`,
  `ALTER TABLE agentic_workflow_runs ADD COLUMN IF NOT EXISTS workflow_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb`,
  `ALTER TABLE agentic_workflow_runs ADD COLUMN IF NOT EXISTS node_results JSONB NOT NULL DEFAULT '[]'::jsonb`,
  `ALTER TABLE agentic_workflow_runs ADD COLUMN IF NOT EXISTS created_by TEXT`,
  `ALTER TABLE agentic_workflow_runs ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ`,
  `ALTER TABLE agentic_workflow_runs ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ`,
  `ALTER TABLE agentic_workflow_runs ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP`,
  `ALTER TABLE agentic_workflow_runs ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP`,
  `UPDATE agentic_workflow_runs SET workflow_name = 'Agentic workflow run' WHERE workflow_name IS NULL OR BTRIM(workflow_name) = ''`,
  `UPDATE agentic_workflow_runs SET status = 'queued' WHERE status IS NULL OR BTRIM(status) = ''`,
  `UPDATE agentic_workflow_runs SET trigger_kind = 'manual' WHERE trigger_kind IS NULL OR BTRIM(trigger_kind) = ''`,
  `UPDATE agentic_workflow_runs SET input_payload = '{}'::jsonb WHERE input_payload IS NULL`,
  `UPDATE agentic_workflow_runs SET workflow_snapshot = '{}'::jsonb WHERE workflow_snapshot IS NULL`,
  `UPDATE agentic_workflow_runs SET node_results = '[]'::jsonb WHERE node_results IS NULL`,
  `ALTER TABLE agentic_workflow_runs ALTER COLUMN project_id SET NOT NULL`,
  `ALTER TABLE agentic_workflow_runs ALTER COLUMN workflow_name SET NOT NULL`,
  `ALTER TABLE agentic_workflow_runs ALTER COLUMN status SET DEFAULT 'queued'`,
  `ALTER TABLE agentic_workflow_runs ALTER COLUMN status SET NOT NULL`,
  `ALTER TABLE agentic_workflow_runs ALTER COLUMN trigger_kind SET DEFAULT 'manual'`,
  `ALTER TABLE agentic_workflow_runs ALTER COLUMN trigger_kind SET NOT NULL`,
  `ALTER TABLE agentic_workflow_runs ALTER COLUMN input_payload SET DEFAULT '{}'::jsonb`,
  `ALTER TABLE agentic_workflow_runs ALTER COLUMN input_payload SET NOT NULL`,
  `ALTER TABLE agentic_workflow_runs ALTER COLUMN workflow_snapshot SET DEFAULT '{}'::jsonb`,
  `ALTER TABLE agentic_workflow_runs ALTER COLUMN workflow_snapshot SET NOT NULL`,
  `ALTER TABLE agentic_workflow_runs ALTER COLUMN node_results SET DEFAULT '[]'::jsonb`,
  `ALTER TABLE agentic_workflow_runs ALTER COLUMN node_results SET NOT NULL`,
  `ALTER TABLE agentic_workflow_runs DROP CONSTRAINT IF EXISTS agentic_workflow_runs_status_check`,
  `ALTER TABLE agentic_workflow_runs ADD CONSTRAINT agentic_workflow_runs_status_check CHECK (status IN ('queued', 'running', 'completed', 'needs_review', 'failed', 'aborted', 'cancelled', 'interrupted'))`,
  `CREATE INDEX IF NOT EXISTS idx_agentic_workflow_runs_scope ON agentic_workflow_runs (project_id, app_type_id, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_agentic_workflow_runs_workflow ON agentic_workflow_runs (workflow_id, created_at DESC)`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS auth_provider TEXT NOT NULL DEFAULT 'local'`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS google_sub TEXT`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified BOOLEAN NOT NULL DEFAULT FALSE`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_data_url TEXT`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS is_workspace_admin BOOLEAN NOT NULL DEFAULT FALSE`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS default_role_id TEXT REFERENCES roles(id)`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS username TEXT`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active'`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT FALSE`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_unique ON users (LOWER(username)) WHERE username IS NOT NULL`,
  `ALTER TABLE users DROP CONSTRAINT IF EXISTS users_status_check`,
  `ALTER TABLE users ADD CONSTRAINT users_status_check CHECK (status IN ('active', 'suspended'))`,
  `UPDATE users
    SET default_role_id = (
      SELECT roles.id
      FROM roles
      WHERE LOWER(roles.name) = CASE
        WHEN COALESCE(users.is_workspace_admin, FALSE)
          OR (
            NOT EXISTS (
              SELECT 1
              FROM users workspace_admins
              WHERE COALESCE(workspace_admins.is_workspace_admin, FALSE) = TRUE
            )
            AND EXISTS (
              SELECT 1
              FROM project_members
              JOIN roles legacy_roles ON legacy_roles.id = project_members.role_id
              WHERE project_members.user_id = users.id
                AND LOWER(legacy_roles.name) = 'admin'
            )
          ) THEN 'admin'
        ELSE 'member'
      END
      LIMIT 1
    )
    WHERE users.default_role_id IS NULL`,
  `UPDATE users SET auth_provider = 'local' WHERE auth_provider IS NULL OR TRIM(auth_provider) = ''`,
  `
    UPDATE users
    SET is_workspace_admin = TRUE
    WHERE COALESCE(is_workspace_admin, FALSE) = FALSE
      AND default_role_id IN (
        SELECT roles.id
        FROM roles
        WHERE LOWER(roles.name) = 'admin'
      )
  `,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_users_google_sub_unique ON users (google_sub) WHERE google_sub IS NOT NULL`,
  `ALTER TABLE feedback DROP CONSTRAINT IF EXISTS feedback_user_id_fkey`,
  `ALTER TABLE feedback ADD CONSTRAINT feedback_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE`,
  `ALTER TABLE feedback ADD COLUMN IF NOT EXISTS display_id TEXT`,
  `
    WITH existing AS (
      SELECT COALESCE(MAX(NULLIF(regexp_replace(display_id, '\\D', '', 'g'), '')::INTEGER), 0) AS max_sequence
      FROM feedback
      WHERE display_id IS NOT NULL
    ), missing AS (
      SELECT id, ROW_NUMBER() OVER (ORDER BY created_at ASC, id ASC) AS sequence
      FROM feedback
      WHERE display_id IS NULL
    )
    UPDATE feedback
    SET display_id = 'BUG-' || (existing.max_sequence + missing.sequence)
    FROM existing, missing
    WHERE feedback.id = missing.id
  `,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_feedback_display_id ON feedback (display_id) WHERE display_id IS NOT NULL`,
  `ALTER TABLE feedback ADD COLUMN IF NOT EXISTS steps_to_reproduce TEXT`,
  `ALTER TABLE feedback ADD COLUMN IF NOT EXISTS expected_result TEXT`,
  `ALTER TABLE feedback ADD COLUMN IF NOT EXISTS actual_result TEXT`,
  `ALTER TABLE feedback ADD COLUMN IF NOT EXISTS severity TEXT`,
  `ALTER TABLE feedback ADD COLUMN IF NOT EXISTS priority TEXT`,
  `ALTER TABLE feedback ADD COLUMN IF NOT EXISTS environment TEXT`,
  `ALTER TABLE feedback ADD COLUMN IF NOT EXISTS build TEXT`,
  `ALTER TABLE feedback ADD COLUMN IF NOT EXISTS jira_bug_key TEXT`,
  `ALTER TABLE feedback ADD COLUMN IF NOT EXISTS linked_test_run_id TEXT`,
  `ALTER TABLE feedback ADD COLUMN IF NOT EXISTS project_id TEXT`,
  `
    UPDATE feedback
    SET project_id = (
      SELECT MIN(project_members.project_id)
      FROM project_members
      WHERE project_members.user_id = feedback.user_id
    )
    WHERE feedback.project_id IS NULL
      AND (
        SELECT COUNT(DISTINCT project_members.project_id)
        FROM project_members
        WHERE project_members.user_id = feedback.user_id
      ) = 1
  `,
  `ALTER TABLE feedback DROP CONSTRAINT IF EXISTS feedback_project_id_fkey`,
  `ALTER TABLE feedback ADD CONSTRAINT feedback_project_id_fkey FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE`,
  `ALTER TABLE feedback ADD COLUMN IF NOT EXISTS linked_test_case_ids JSONB NOT NULL DEFAULT '[]'::jsonb`,
  `ALTER TABLE feedback ADD COLUMN IF NOT EXISTS linked_test_suite_ids JSONB NOT NULL DEFAULT '[]'::jsonb`,
  `ALTER TABLE feedback ADD COLUMN IF NOT EXISTS linked_module_ids JSONB NOT NULL DEFAULT '[]'::jsonb`,
  `ALTER TABLE feedback ADD COLUMN IF NOT EXISTS linked_requirement_ids JSONB NOT NULL DEFAULT '[]'::jsonb`,
  `ALTER TABLE feedback ADD COLUMN IF NOT EXISTS labels JSONB NOT NULL DEFAULT '[]'::jsonb`,
  `ALTER TABLE feedback ADD COLUMN IF NOT EXISTS sprint TEXT`,
  `ALTER TABLE feedback ADD COLUMN IF NOT EXISTS fix_version TEXT`,
  `ALTER TABLE feedback ADD COLUMN IF NOT EXISTS release TEXT`,
  `ALTER TABLE feedback ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP`,
  `CREATE INDEX IF NOT EXISTS idx_feedback_project_created ON feedback (project_id, created_at DESC)`,
  `ALTER TABLE feedback ADD COLUMN IF NOT EXISTS assignee_id TEXT`,
  `ALTER TABLE feedback ADD COLUMN IF NOT EXISTS root_cause TEXT`,
  `ALTER TABLE feedback ADD COLUMN IF NOT EXISTS qa_root_cause TEXT`,
  `CREATE TABLE IF NOT EXISTS issue_history (
    id TEXT PRIMARY KEY,
    issue_id TEXT NOT NULL REFERENCES feedback(id) ON DELETE CASCADE,
    actor_id TEXT,
    actor_name TEXT NOT NULL,
    actor_email TEXT,
    action TEXT NOT NULL CHECK (action IN ('created', 'updated')),
    changes JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE INDEX IF NOT EXISTS idx_issue_history_issue_created ON issue_history (issue_id, created_at DESC, id DESC)`,
  `ALTER TABLE feedback ADD COLUMN IF NOT EXISTS bug_type TEXT`,
  `ALTER TABLE feedback ADD COLUMN IF NOT EXISTS regression BOOLEAN NOT NULL DEFAULT FALSE`,
  `
    CREATE TABLE IF NOT EXISTS auth_verification_codes (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      purpose TEXT NOT NULL,
      code_hash TEXT NOT NULL,
      payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      attempt_count INTEGER NOT NULL DEFAULT 0,
      expires_at TIMESTAMPTZ NOT NULL,
      consumed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    )
  `,
  `ALTER TABLE auth_verification_codes ADD COLUMN IF NOT EXISTS email TEXT`,
  `ALTER TABLE auth_verification_codes ADD COLUMN IF NOT EXISTS purpose TEXT`,
  `ALTER TABLE auth_verification_codes ADD COLUMN IF NOT EXISTS code_hash TEXT`,
  `ALTER TABLE auth_verification_codes ADD COLUMN IF NOT EXISTS payload JSONB NOT NULL DEFAULT '{}'::jsonb`,
  `ALTER TABLE auth_verification_codes ADD COLUMN IF NOT EXISTS attempt_count INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE auth_verification_codes ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ`,
  `ALTER TABLE auth_verification_codes ADD COLUMN IF NOT EXISTS consumed_at TIMESTAMPTZ`,
  `ALTER TABLE auth_verification_codes ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP`,
  `ALTER TABLE auth_verification_codes DROP CONSTRAINT IF EXISTS auth_verification_codes_purpose_check`,
  `ALTER TABLE auth_verification_codes ADD CONSTRAINT auth_verification_codes_purpose_check CHECK (purpose IN ('signup', 'password_reset'))`,
  `CREATE INDEX IF NOT EXISTS idx_auth_verification_codes_lookup ON auth_verification_codes (email, purpose, created_at DESC)`,
  `
    CREATE TABLE IF NOT EXISTS test_environments (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      app_type_id TEXT,
      name TEXT NOT NULL,
      description TEXT,
      base_url TEXT,
      browser TEXT,
      notes TEXT,
      variables JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    )
  `,
  `ALTER TABLE test_environments ADD COLUMN IF NOT EXISTS project_id TEXT`,
  `ALTER TABLE test_environments ADD COLUMN IF NOT EXISTS app_type_id TEXT`,
  `ALTER TABLE test_environments ADD COLUMN IF NOT EXISTS name TEXT`,
  `ALTER TABLE test_environments ADD COLUMN IF NOT EXISTS description TEXT`,
  `ALTER TABLE test_environments ADD COLUMN IF NOT EXISTS base_url TEXT`,
  `ALTER TABLE test_environments ADD COLUMN IF NOT EXISTS browser TEXT`,
  `ALTER TABLE test_environments ADD COLUMN IF NOT EXISTS notes TEXT`,
  `ALTER TABLE test_environments ADD COLUMN IF NOT EXISTS variables JSONB NOT NULL DEFAULT '[]'::jsonb`,
  `ALTER TABLE test_environments ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP`,
  `CREATE INDEX IF NOT EXISTS idx_test_environments_project_scope ON test_environments (project_id, app_type_id)`,
  `CREATE INDEX IF NOT EXISTS idx_test_environments_catalog_order ON test_environments (project_id, (app_type_id IS NOT NULL), name ASC, created_at DESC)`,
  `
    CREATE TABLE IF NOT EXISTS test_configurations (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      app_type_id TEXT,
      name TEXT NOT NULL,
      description TEXT,
      browser TEXT,
      mobile_os TEXT,
      platform_version TEXT,
      targets JSONB NOT NULL DEFAULT '[]'::jsonb,
      variables JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    )
  `,
  `ALTER TABLE test_configurations ADD COLUMN IF NOT EXISTS project_id TEXT`,
  `ALTER TABLE test_configurations ADD COLUMN IF NOT EXISTS app_type_id TEXT`,
  `ALTER TABLE test_configurations ADD COLUMN IF NOT EXISTS name TEXT`,
  `ALTER TABLE test_configurations ADD COLUMN IF NOT EXISTS description TEXT`,
  `ALTER TABLE test_configurations ADD COLUMN IF NOT EXISTS browser TEXT`,
  `ALTER TABLE test_configurations ADD COLUMN IF NOT EXISTS mobile_os TEXT`,
  `ALTER TABLE test_configurations ADD COLUMN IF NOT EXISTS platform_version TEXT`,
  `ALTER TABLE test_configurations ADD COLUMN IF NOT EXISTS targets JSONB NOT NULL DEFAULT '[]'::jsonb`,
  `ALTER TABLE test_configurations ADD COLUMN IF NOT EXISTS variables JSONB NOT NULL DEFAULT '[]'::jsonb`,
  `ALTER TABLE test_configurations ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP`,
  `UPDATE test_configurations SET targets = '[]'::jsonb WHERE targets IS NULL OR jsonb_typeof(targets) <> 'array'`,
  `ALTER TABLE test_configurations DROP CONSTRAINT IF EXISTS test_configurations_targets_array_check`,
  `ALTER TABLE test_configurations ADD CONSTRAINT test_configurations_targets_array_check CHECK (jsonb_typeof(targets) = 'array')`,
  `CREATE INDEX IF NOT EXISTS idx_test_configurations_project_scope ON test_configurations (project_id, app_type_id)`,
  `CREATE INDEX IF NOT EXISTS idx_test_configurations_catalog_order ON test_configurations (project_id, (app_type_id IS NOT NULL), name ASC, created_at DESC)`,
  `
    CREATE TABLE IF NOT EXISTS test_data_sets (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      app_type_id TEXT,
      name TEXT NOT NULL,
      description TEXT,
      mode TEXT NOT NULL DEFAULT 'key_value',
      columns JSONB NOT NULL DEFAULT '[]'::jsonb,
      rows JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    )
  `,
  `ALTER TABLE test_data_sets ADD COLUMN IF NOT EXISTS project_id TEXT`,
  `ALTER TABLE test_data_sets ADD COLUMN IF NOT EXISTS app_type_id TEXT`,
  `ALTER TABLE test_data_sets ADD COLUMN IF NOT EXISTS name TEXT`,
  `ALTER TABLE test_data_sets ADD COLUMN IF NOT EXISTS description TEXT`,
  `ALTER TABLE test_data_sets ADD COLUMN IF NOT EXISTS mode TEXT NOT NULL DEFAULT 'key_value'`,
  `ALTER TABLE test_data_sets ADD COLUMN IF NOT EXISTS columns JSONB NOT NULL DEFAULT '[]'::jsonb`,
  `ALTER TABLE test_data_sets ADD COLUMN IF NOT EXISTS rows JSONB NOT NULL DEFAULT '[]'::jsonb`,
  `ALTER TABLE test_data_sets ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP`,
  `CREATE INDEX IF NOT EXISTS idx_test_data_sets_project_scope ON test_data_sets (project_id, app_type_id)`,
  `CREATE INDEX IF NOT EXISTS idx_test_data_sets_catalog_order ON test_data_sets (project_id, (app_type_id IS NOT NULL), name ASC, created_at DESC)`,
  `ALTER TABLE test_cases ADD COLUMN IF NOT EXISTS test_case_type TEXT NOT NULL DEFAULT 'functional'`,
  `ALTER TABLE test_cases DROP CONSTRAINT IF EXISTS test_cases_test_case_type_check`,
  `ALTER TABLE test_cases ADD CONSTRAINT test_cases_test_case_type_check CHECK (test_case_type ~ '^[a-z][a-z0-9_-]{0,119}$')`,
  `
    CREATE TABLE IF NOT EXISTS test_case_data_sets (
      test_case_id TEXT NOT NULL,
      test_data_set_id TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 1,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (test_case_id, test_data_set_id),
      FOREIGN KEY (test_case_id) REFERENCES test_cases(id) ON DELETE CASCADE,
      FOREIGN KEY (test_data_set_id) REFERENCES test_data_sets(id) ON DELETE CASCADE
    )
  `,
  `CREATE INDEX IF NOT EXISTS idx_test_case_data_sets_case_order ON test_case_data_sets (test_case_id, sort_order, test_data_set_id)`,
  `
    CREATE TABLE IF NOT EXISTS test_case_data_set_link_archive (
      test_case_id TEXT NOT NULL,
      test_data_set_id TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 1,
      original_created_at TIMESTAMPTZ,
      archived_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      archive_reason TEXT NOT NULL DEFAULT 'single-data-set-enforcement',
      PRIMARY KEY (test_case_id, test_data_set_id)
    )
  `,
  `
    INSERT INTO test_case_data_set_link_archive (
      test_case_id,
      test_data_set_id,
      sort_order,
      original_created_at,
      archive_reason
    )
    SELECT
      test_case_id,
      test_data_set_id,
      sort_order,
      created_at,
      'single-data-set-enforcement'
    FROM (
      SELECT
        test_case_id,
        test_data_set_id,
        sort_order,
        created_at,
        ROW_NUMBER() OVER (PARTITION BY test_case_id ORDER BY sort_order ASC, test_data_set_id ASC) AS link_rank
      FROM test_case_data_sets
    ) AS ranked_links
    WHERE link_rank > 1
    ON CONFLICT (test_case_id, test_data_set_id) DO NOTHING
  `,
  `
    DELETE FROM test_case_data_sets
    WHERE (test_case_id, test_data_set_id) IN (
      SELECT test_case_id, test_data_set_id
      FROM (
        SELECT
          test_case_id,
          test_data_set_id,
          ROW_NUMBER() OVER (PARTITION BY test_case_id ORDER BY sort_order ASC, test_data_set_id ASC) AS link_rank
        FROM test_case_data_sets
      ) AS ranked_links
      WHERE link_rank > 1
    )
  `,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_test_case_data_sets_one_per_case ON test_case_data_sets (test_case_id)`,
  `ALTER TABLE executions ADD COLUMN IF NOT EXISTS parameter_scope_default TEXT NOT NULL DEFAULT 't' CHECK (parameter_scope_default IN ('t', 'r'))`,
  `ALTER TABLE executions ADD COLUMN IF NOT EXISTS test_environment_id TEXT`,
  `ALTER TABLE executions ADD COLUMN IF NOT EXISTS test_environment_name TEXT`,
  `ALTER TABLE executions ADD COLUMN IF NOT EXISTS test_environment_snapshot JSONB`,
  `ALTER TABLE executions ADD COLUMN IF NOT EXISTS test_configuration_id TEXT`,
  `ALTER TABLE executions ADD COLUMN IF NOT EXISTS test_configuration_name TEXT`,
  `ALTER TABLE executions ADD COLUMN IF NOT EXISTS test_configuration_snapshot JSONB`,
  `ALTER TABLE executions ADD COLUMN IF NOT EXISTS test_data_set_id TEXT`,
  `ALTER TABLE executions ADD COLUMN IF NOT EXISTS test_data_set_name TEXT`,
  `ALTER TABLE executions ADD COLUMN IF NOT EXISTS test_data_set_snapshot JSONB`,
  `ALTER TABLE executions ADD COLUMN IF NOT EXISTS assigned_to TEXT`,
  `ALTER TABLE executions ADD COLUMN IF NOT EXISTS assigned_to_ids JSONB`,
  `ALTER TABLE executions ADD COLUMN IF NOT EXISTS suite_assignments JSONB NOT NULL DEFAULT '{}'::jsonb`,
  `ALTER TABLE executions ADD COLUMN IF NOT EXISTS module_assignments JSONB NOT NULL DEFAULT '{}'::jsonb`,
  `ALTER TABLE executions ADD COLUMN IF NOT EXISTS case_assignments JSONB NOT NULL DEFAULT '{}'::jsonb`,
  `ALTER TABLE executions ADD COLUMN IF NOT EXISTS direct_test_case_ids JSONB`,
  `ALTER TABLE executions ADD COLUMN IF NOT EXISTS release TEXT`,
  `ALTER TABLE executions ADD COLUMN IF NOT EXISTS sprint TEXT`,
  `ALTER TABLE executions ADD COLUMN IF NOT EXISTS build TEXT`,
  `ALTER TABLE executions ADD COLUMN IF NOT EXISTS start_date DATE`,
  `ALTER TABLE executions ADD COLUMN IF NOT EXISTS end_date DATE`,
  `ALTER TABLE executions DROP CONSTRAINT IF EXISTS executions_planned_date_range_check`,
  `ALTER TABLE executions ADD CONSTRAINT executions_planned_date_range_check CHECK (end_date >= start_date)`,
  `ALTER TABLE executions ADD COLUMN IF NOT EXISTS execution_hooks JSONB NOT NULL DEFAULT '[]'::jsonb`,
  `ALTER TABLE executions ADD COLUMN IF NOT EXISTS source_idempotency_key TEXT`,
  `ALTER TABLE executions ADD COLUMN IF NOT EXISTS parallel_enabled BOOLEAN NOT NULL DEFAULT FALSE`,
  `ALTER TABLE executions ADD COLUMN IF NOT EXISTS parallel_count INTEGER NOT NULL DEFAULT 1`,
  `ALTER TABLE executions ADD COLUMN IF NOT EXISTS revision INTEGER NOT NULL DEFAULT 1`,
  `ALTER TABLE executions ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_executions_source_idempotency ON executions (project_id, source_idempotency_key) WHERE source_idempotency_key IS NOT NULL`,
  `UPDATE executions SET assigned_to_ids = CASE WHEN assigned_to IS NULL OR BTRIM(assigned_to) = '' THEN '[]'::jsonb ELSE jsonb_build_array(assigned_to) END WHERE assigned_to_ids IS NULL`,
  `ALTER TABLE executions ALTER COLUMN assigned_to_ids SET DEFAULT '[]'::jsonb`,
  `ALTER TABLE executions ALTER COLUMN assigned_to_ids SET NOT NULL`,
  `ALTER TABLE executions DROP CONSTRAINT IF EXISTS executions_trigger_check`,
  `ALTER TABLE executions ADD CONSTRAINT executions_trigger_check CHECK (trigger IN ('manual', 'ci', 'local'))`,
  `UPDATE executions SET created_at = COALESCE(created_at, started_at, ended_at, CURRENT_TIMESTAMP) WHERE created_at IS NULL`,
  `
    CREATE TABLE IF NOT EXISTS execution_schedules (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      app_type_id TEXT,
      name TEXT NOT NULL,
      cadence TEXT NOT NULL DEFAULT 'once',
      next_run_at TIMESTAMPTZ,
      last_run_at TIMESTAMPTZ,
      suite_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
      test_case_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
      test_environment_id TEXT,
      test_configuration_id TEXT,
      test_data_set_id TEXT,
      release TEXT,
      sprint TEXT,
      build TEXT,
      assigned_to TEXT,
      assigned_to_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
      lease_owner TEXT,
      lease_expires_at TIMESTAMPTZ,
      heartbeat_at TIMESTAMPTZ,
      failure_count INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      created_by TEXT NOT NULL,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    )
  `,
  `ALTER TABLE execution_schedules ADD COLUMN IF NOT EXISTS project_id TEXT`,
  `ALTER TABLE execution_schedules ADD COLUMN IF NOT EXISTS app_type_id TEXT`,
  `ALTER TABLE execution_schedules ADD COLUMN IF NOT EXISTS name TEXT`,
  `ALTER TABLE execution_schedules ADD COLUMN IF NOT EXISTS cadence TEXT NOT NULL DEFAULT 'once'`,
  `ALTER TABLE execution_schedules ADD COLUMN IF NOT EXISTS next_run_at TIMESTAMPTZ`,
  `ALTER TABLE execution_schedules ADD COLUMN IF NOT EXISTS last_run_at TIMESTAMPTZ`,
  `ALTER TABLE execution_schedules ADD COLUMN IF NOT EXISTS suite_ids JSONB NOT NULL DEFAULT '[]'::jsonb`,
  `ALTER TABLE execution_schedules ADD COLUMN IF NOT EXISTS test_case_ids JSONB NOT NULL DEFAULT '[]'::jsonb`,
  `ALTER TABLE execution_schedules ADD COLUMN IF NOT EXISTS test_environment_id TEXT`,
  `ALTER TABLE execution_schedules ADD COLUMN IF NOT EXISTS test_configuration_id TEXT`,
  `ALTER TABLE execution_schedules ADD COLUMN IF NOT EXISTS test_data_set_id TEXT`,
  `ALTER TABLE execution_schedules ADD COLUMN IF NOT EXISTS release TEXT`,
  `ALTER TABLE execution_schedules ADD COLUMN IF NOT EXISTS sprint TEXT`,
  `ALTER TABLE execution_schedules ADD COLUMN IF NOT EXISTS build TEXT`,
  `ALTER TABLE execution_schedules ADD COLUMN IF NOT EXISTS assigned_to TEXT`,
  `ALTER TABLE execution_schedules ADD COLUMN IF NOT EXISTS assigned_to_ids JSONB`,
  `UPDATE execution_schedules SET assigned_to_ids = CASE WHEN assigned_to IS NULL OR BTRIM(assigned_to) = '' THEN '[]'::jsonb ELSE jsonb_build_array(assigned_to) END WHERE assigned_to_ids IS NULL`,
  `ALTER TABLE execution_schedules ALTER COLUMN assigned_to_ids SET DEFAULT '[]'::jsonb`,
  `ALTER TABLE execution_schedules ALTER COLUMN assigned_to_ids SET NOT NULL`,
  `ALTER TABLE execution_schedules ADD COLUMN IF NOT EXISTS lease_owner TEXT`,
  `ALTER TABLE execution_schedules ADD COLUMN IF NOT EXISTS lease_expires_at TIMESTAMPTZ`,
  `ALTER TABLE execution_schedules ADD COLUMN IF NOT EXISTS heartbeat_at TIMESTAMPTZ`,
  `ALTER TABLE execution_schedules ADD COLUMN IF NOT EXISTS failure_count INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE execution_schedules ADD COLUMN IF NOT EXISTS last_error TEXT`,
  `ALTER TABLE execution_schedules ADD COLUMN IF NOT EXISTS created_by TEXT`,
  `ALTER TABLE execution_schedules ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE`,
  `ALTER TABLE execution_schedules ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP`,
  `ALTER TABLE execution_schedules ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP`,
  `ALTER TABLE requirements ADD COLUMN IF NOT EXISTS created_by TEXT`,
  `ALTER TABLE requirements ADD COLUMN IF NOT EXISTS updated_by TEXT`,
  `ALTER TABLE requirements ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP`,
  `ALTER TABLE requirements ADD COLUMN IF NOT EXISTS gherkin_scenarios JSONB NOT NULL DEFAULT '[]'::jsonb`,
  `ALTER TABLE requirements ADD COLUMN IF NOT EXISTS additional_fields JSONB NOT NULL DEFAULT '{}'::jsonb`,
  `ALTER TABLE requirements ADD COLUMN IF NOT EXISTS ai_review JSONB`,
  `ALTER TABLE requirements ADD COLUMN IF NOT EXISTS external_references JSONB`,
  `ALTER TABLE requirements ADD COLUMN IF NOT EXISTS labels JSONB`,
  `ALTER TABLE requirements ADD COLUMN IF NOT EXISTS sprint TEXT`,
  `ALTER TABLE requirements ADD COLUMN IF NOT EXISTS fix_version TEXT`,
  `ALTER TABLE requirements ADD COLUMN IF NOT EXISTS release TEXT`,
  `ALTER TABLE requirements ADD COLUMN IF NOT EXISTS dev_completion_target_date TIMESTAMPTZ`,
  `ALTER TABLE requirements ADD COLUMN IF NOT EXISTS qa_completion_target_date TIMESTAMPTZ`,
  `ALTER TABLE requirements ADD COLUMN IF NOT EXISTS scrum_team TEXT`,
  `ALTER TABLE requirements ADD COLUMN IF NOT EXISTS specification_format TEXT NOT NULL DEFAULT 'gherkin'`,
  `ALTER TABLE requirements ADD COLUMN IF NOT EXISTS specification_content TEXT`,
  `ALTER TABLE requirements ADD COLUMN IF NOT EXISTS iteration_id TEXT`,
  `ALTER TABLE requirements ADD COLUMN IF NOT EXISTS revision INTEGER NOT NULL DEFAULT 1`,
  `UPDATE requirements SET external_references = '[]'::jsonb WHERE external_references IS NULL`,
  `UPDATE requirements SET labels = '[]'::jsonb WHERE labels IS NULL`,
  `ALTER TABLE requirements ALTER COLUMN external_references SET DEFAULT '[]'::jsonb`,
  `ALTER TABLE requirements ALTER COLUMN external_references SET NOT NULL`,
  `ALTER TABLE requirements ALTER COLUMN labels SET DEFAULT '[]'::jsonb`,
  `ALTER TABLE requirements ALTER COLUMN labels SET NOT NULL`,
  `UPDATE requirements SET updated_at = COALESCE(updated_at, created_at, CURRENT_TIMESTAMP) WHERE updated_at IS NULL`,
  `
    CREATE TABLE IF NOT EXISTS requirement_iterations (
      id TEXT PRIMARY KEY,
      display_id TEXT UNIQUE,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      description TEXT,
      goal TEXT,
      labels JSONB NOT NULL DEFAULT '[]'::jsonb,
      external_references JSONB NOT NULL DEFAULT '[]'::jsonb,
      state TEXT NOT NULL DEFAULT 'future',
      start_date TIMESTAMPTZ,
      end_date TIMESTAMPTZ,
      assignee_id TEXT,
      effort_points INTEGER,
      original_dev_id TEXT,
      original_qa_id TEXT,
      created_by TEXT,
      updated_by TEXT,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    )
  `,
  `ALTER TABLE requirement_iterations ADD COLUMN IF NOT EXISTS display_id TEXT`,
  `ALTER TABLE requirement_iterations ADD COLUMN IF NOT EXISTS description TEXT`,
  `ALTER TABLE requirement_iterations ADD COLUMN IF NOT EXISTS goal TEXT`,
  `ALTER TABLE requirement_iterations ADD COLUMN IF NOT EXISTS labels JSONB NOT NULL DEFAULT '[]'::jsonb`,
  `ALTER TABLE requirement_iterations ADD COLUMN IF NOT EXISTS external_references JSONB NOT NULL DEFAULT '[]'::jsonb`,
  `ALTER TABLE requirement_iterations ADD COLUMN IF NOT EXISTS state TEXT NOT NULL DEFAULT 'future'`,
  `ALTER TABLE requirement_iterations ADD COLUMN IF NOT EXISTS start_date TIMESTAMPTZ`,
  `ALTER TABLE requirement_iterations ADD COLUMN IF NOT EXISTS end_date TIMESTAMPTZ`,
  `ALTER TABLE requirement_iterations ADD COLUMN IF NOT EXISTS assignee_id TEXT`,
  `ALTER TABLE requirement_iterations ADD COLUMN IF NOT EXISTS effort_points INTEGER`,
  `ALTER TABLE requirement_iterations ADD COLUMN IF NOT EXISTS original_dev_id TEXT`,
  `ALTER TABLE requirement_iterations ADD COLUMN IF NOT EXISTS original_qa_id TEXT`,
  `DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = 'requirement_iterations'
          AND column_name = 'start_date'
          AND data_type = 'date'
      ) THEN
        ALTER TABLE requirement_iterations
          ALTER COLUMN start_date TYPE TIMESTAMPTZ USING start_date::timestamp AT TIME ZONE 'UTC';
      END IF;
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = 'requirement_iterations'
          AND column_name = 'end_date'
          AND data_type = 'date'
      ) THEN
        ALTER TABLE requirement_iterations
          ALTER COLUMN end_date TYPE TIMESTAMPTZ USING end_date::timestamp AT TIME ZONE 'UTC';
      END IF;
    END $$`,
  `UPDATE requirement_iterations SET labels = '[]'::jsonb WHERE labels IS NULL`,
  `UPDATE requirement_iterations SET external_references = '[]'::jsonb WHERE external_references IS NULL`,
  `ALTER TABLE requirement_iterations DROP CONSTRAINT IF EXISTS requirement_iterations_state_check`,
  `ALTER TABLE requirement_iterations ADD CONSTRAINT requirement_iterations_state_check CHECK (state IN ('future', 'active', 'closed'))`,
  `ALTER TABLE requirement_iterations ADD COLUMN IF NOT EXISTS created_by TEXT`,
  `ALTER TABLE requirement_iterations ADD COLUMN IF NOT EXISTS updated_by TEXT`,
  `ALTER TABLE requirement_iterations ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP`,
  `ALTER TABLE requirement_iterations ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP`,
  `CREATE INDEX IF NOT EXISTS idx_requirement_iterations_project ON requirement_iterations (project_id, updated_at DESC)`,
  `
    UPDATE requirements
    SET iteration_id = NULL
    WHERE iteration_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM requirement_iterations
        WHERE requirement_iterations.id = requirements.iteration_id
      )
  `,
  `ALTER TABLE requirements DROP CONSTRAINT IF EXISTS requirements_iteration_id_fkey`,
  `ALTER TABLE requirements ADD CONSTRAINT requirements_iteration_id_fkey FOREIGN KEY (iteration_id) REFERENCES requirement_iterations(id) ON DELETE SET NULL`,
  `CREATE INDEX IF NOT EXISTS idx_requirements_iteration ON requirements (iteration_id, updated_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_requirements_project_activity ON requirements (project_id, (COALESCE(updated_at, created_at)) DESC, created_at DESC)`,
  `ALTER TABLE requirements DROP CONSTRAINT IF EXISTS requirements_specification_format_check`,
  `ALTER TABLE requirements ADD CONSTRAINT requirements_specification_format_check CHECK (specification_format IN ('gherkin', 'speckit'))`,
  `CREATE INDEX IF NOT EXISTS idx_requirements_delivery_targets ON requirements (project_id, dev_completion_target_date, qa_completion_target_date)`,
  `
    CREATE TABLE IF NOT EXISTS requirement_releases (
      id TEXT PRIMARY KEY,
      display_id TEXT UNIQUE,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      description TEXT,
      fix_version TEXT NOT NULL,
      target_date_label TEXT,
      plan_date TIMESTAMPTZ,
      target_date TIMESTAMPTZ,
      external_link TEXT,
      state TEXT NOT NULL DEFAULT 'planned',
      sprint_ids JSONB NOT NULL DEFAULT '[]'::jsonb
        CONSTRAINT requirement_releases_sprint_ids_array_check CHECK (jsonb_typeof(sprint_ids) = 'array'),
      created_by TEXT,
      updated_by TEXT,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    )
  `,
  `ALTER TABLE requirement_releases ADD COLUMN IF NOT EXISTS display_id TEXT`,
  `ALTER TABLE requirement_releases ADD COLUMN IF NOT EXISTS description TEXT`,
  `ALTER TABLE requirement_releases ADD COLUMN IF NOT EXISTS fix_version TEXT`,
  `ALTER TABLE requirement_releases ADD COLUMN IF NOT EXISTS target_date_label TEXT`,
  `ALTER TABLE requirement_releases ADD COLUMN IF NOT EXISTS plan_date TIMESTAMPTZ`,
  `ALTER TABLE requirement_releases ADD COLUMN IF NOT EXISTS target_date TIMESTAMPTZ`,
  `ALTER TABLE requirement_releases ADD COLUMN IF NOT EXISTS external_link TEXT`,
  `ALTER TABLE requirement_releases ADD COLUMN IF NOT EXISTS state TEXT NOT NULL DEFAULT 'planned'`,
  `ALTER TABLE requirement_releases ADD COLUMN IF NOT EXISTS sprint_ids JSONB NOT NULL DEFAULT '[]'::jsonb`,
  `ALTER TABLE requirement_releases ADD COLUMN IF NOT EXISTS created_by TEXT`,
  `ALTER TABLE requirement_releases ADD COLUMN IF NOT EXISTS updated_by TEXT`,
  `ALTER TABLE requirement_releases ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP`,
  `ALTER TABLE requirement_releases ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP`,
  `UPDATE requirement_releases SET sprint_ids = '[]'::jsonb WHERE sprint_ids IS NULL OR jsonb_typeof(sprint_ids) <> 'array'`,
  `ALTER TABLE requirement_releases DROP CONSTRAINT IF EXISTS requirement_releases_sprint_ids_array_check`,
  `ALTER TABLE requirement_releases ADD CONSTRAINT requirement_releases_sprint_ids_array_check CHECK (jsonb_typeof(sprint_ids) = 'array')`,
  `ALTER TABLE requirement_releases DROP CONSTRAINT IF EXISTS requirement_releases_state_check`,
  `ALTER TABLE requirement_releases ADD CONSTRAINT requirement_releases_state_check CHECK (state IN ('planned', 'in_progress', 'released'))`,
  `
    CREATE TABLE IF NOT EXISTS requirement_release_items (
      release_id TEXT NOT NULL REFERENCES requirement_releases(id) ON DELETE CASCADE,
      requirement_id TEXT NOT NULL REFERENCES requirements(id) ON DELETE CASCADE,
      source TEXT NOT NULL DEFAULT 'manual',
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (release_id, requirement_id)
    )
  `,
  `ALTER TABLE requirement_release_items DROP CONSTRAINT IF EXISTS requirement_release_items_source_check`,
  `ALTER TABLE requirement_release_items ADD CONSTRAINT requirement_release_items_source_check CHECK (source IN ('manual', 'sprint'))`,
  `CREATE INDEX IF NOT EXISTS idx_requirement_releases_project ON requirement_releases (project_id, target_date, updated_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_requirement_releases_sprint_ids ON requirement_releases USING GIN (sprint_ids)`,
  `CREATE INDEX IF NOT EXISTS idx_requirement_release_items_requirement ON requirement_release_items (requirement_id, release_id)`,
  `
    CREATE TABLE IF NOT EXISTS requirement_relations (
      requirement_id TEXT NOT NULL REFERENCES requirements(id) ON DELETE CASCADE,
      related_requirement_id TEXT NOT NULL REFERENCES requirements(id) ON DELETE CASCADE,
      relation TEXT NOT NULL DEFAULT 'relates to',
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (requirement_id, related_requirement_id),
      CHECK (requirement_id <> related_requirement_id)
    )
  `,
  `CREATE INDEX IF NOT EXISTS idx_requirement_relations_reverse ON requirement_relations (related_requirement_id, requirement_id)`,
  `ALTER TABLE test_suites ADD COLUMN IF NOT EXISTS created_by TEXT`,
  `ALTER TABLE test_suites ADD COLUMN IF NOT EXISTS updated_by TEXT`,
  `ALTER TABLE test_suites ADD COLUMN IF NOT EXISTS description TEXT`,
  `ALTER TABLE test_suites ADD COLUMN IF NOT EXISTS test_data_set_id TEXT REFERENCES test_data_sets(id) ON DELETE SET NULL`,
  `ALTER TABLE test_suites ADD COLUMN IF NOT EXISTS test_data_options JSONB NOT NULL DEFAULT '{}'::jsonb`,
  `ALTER TABLE executions ADD COLUMN IF NOT EXISTS test_data_options JSONB NOT NULL DEFAULT '{}'::jsonb`,
  `ALTER TABLE execution_schedules ADD COLUMN IF NOT EXISTS test_data_options JSONB NOT NULL DEFAULT '{}'::jsonb`,
  `ALTER TABLE test_suites ADD COLUMN IF NOT EXISTS parameter_values JSONB`,
  `ALTER TABLE test_suites ADD COLUMN IF NOT EXISTS labels JSONB`,
  `ALTER TABLE test_suites ADD COLUMN IF NOT EXISTS parallel_enabled BOOLEAN`,
  `ALTER TABLE test_suites ADD COLUMN IF NOT EXISTS parallel_count INTEGER`,
  `ALTER TABLE test_suites ADD COLUMN IF NOT EXISTS revision INTEGER NOT NULL DEFAULT 1`,
  `UPDATE test_suites SET parameter_values = '{}'::jsonb WHERE parameter_values IS NULL`,
  `UPDATE test_suites SET labels = '[]'::jsonb WHERE labels IS NULL`,
  `ALTER TABLE test_suites ALTER COLUMN parameter_values SET DEFAULT '{}'::jsonb`,
  `ALTER TABLE test_suites ALTER COLUMN parameter_values SET NOT NULL`,
  `ALTER TABLE test_suites ALTER COLUMN labels SET DEFAULT '[]'::jsonb`,
  `ALTER TABLE test_suites ALTER COLUMN labels SET NOT NULL`,
  `ALTER TABLE test_suites ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP`,
  `UPDATE test_suites SET updated_at = COALESCE(updated_at, created_at, CURRENT_TIMESTAMP) WHERE updated_at IS NULL`,
  `
    CREATE TABLE IF NOT EXISTS ai_test_case_generation_jobs (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      app_type_id TEXT NOT NULL,
      integration_id TEXT,
      requirement_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
      max_cases_per_requirement INTEGER NOT NULL DEFAULT 8,
      parallel_requirement_limit INTEGER NOT NULL DEFAULT 1,
      additional_context TEXT,
      external_links JSONB NOT NULL DEFAULT '[]'::jsonb,
      images JSONB NOT NULL DEFAULT '[]'::jsonb,
      authoring_mode TEXT NOT NULL DEFAULT 'structured',
      status TEXT NOT NULL DEFAULT 'queued',
      attempts INTEGER NOT NULL DEFAULT 0,
      max_attempts INTEGER NOT NULL DEFAULT 5,
      next_run_at TIMESTAMPTZ,
      idempotency_key TEXT,
      request_fingerprint TEXT,
      lease_owner TEXT,
      lease_expires_at TIMESTAMPTZ,
      heartbeat_at TIMESTAMPTZ,
      total_requirements INTEGER NOT NULL DEFAULT 0,
      processed_requirements INTEGER NOT NULL DEFAULT 0,
      generated_cases_count INTEGER NOT NULL DEFAULT 0,
      error TEXT,
      created_by TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      started_at TIMESTAMPTZ,
      completed_at TIMESTAMPTZ,
      updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    )
  `,
  `ALTER TABLE ai_test_case_generation_jobs ADD COLUMN IF NOT EXISTS project_id TEXT`,
  `ALTER TABLE ai_test_case_generation_jobs ADD COLUMN IF NOT EXISTS app_type_id TEXT`,
  `ALTER TABLE ai_test_case_generation_jobs ADD COLUMN IF NOT EXISTS integration_id TEXT`,
  `ALTER TABLE ai_test_case_generation_jobs ADD COLUMN IF NOT EXISTS requirement_ids JSONB NOT NULL DEFAULT '[]'::jsonb`,
  `ALTER TABLE ai_test_case_generation_jobs ADD COLUMN IF NOT EXISTS max_cases_per_requirement INTEGER NOT NULL DEFAULT 8`,
  `ALTER TABLE ai_test_case_generation_jobs ADD COLUMN IF NOT EXISTS parallel_requirement_limit INTEGER NOT NULL DEFAULT 1`,
  `ALTER TABLE ai_test_case_generation_jobs ADD COLUMN IF NOT EXISTS additional_context TEXT`,
  `ALTER TABLE ai_test_case_generation_jobs ADD COLUMN IF NOT EXISTS external_links JSONB NOT NULL DEFAULT '[]'::jsonb`,
  `ALTER TABLE ai_test_case_generation_jobs ADD COLUMN IF NOT EXISTS images JSONB NOT NULL DEFAULT '[]'::jsonb`,
  `ALTER TABLE ai_test_case_generation_jobs ADD COLUMN IF NOT EXISTS authoring_mode TEXT NOT NULL DEFAULT 'structured'`,
  `ALTER TABLE ai_test_case_generation_jobs ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'queued'`,
  `ALTER TABLE ai_test_case_generation_jobs ADD COLUMN IF NOT EXISTS attempts INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE ai_test_case_generation_jobs ADD COLUMN IF NOT EXISTS max_attempts INTEGER NOT NULL DEFAULT 5`,
  `ALTER TABLE ai_test_case_generation_jobs ADD COLUMN IF NOT EXISTS next_run_at TIMESTAMPTZ`,
  `ALTER TABLE ai_test_case_generation_jobs ADD COLUMN IF NOT EXISTS idempotency_key TEXT`,
  `ALTER TABLE ai_test_case_generation_jobs ADD COLUMN IF NOT EXISTS request_fingerprint TEXT`,
  `ALTER TABLE ai_test_case_generation_jobs ADD COLUMN IF NOT EXISTS lease_owner TEXT`,
  `ALTER TABLE ai_test_case_generation_jobs ADD COLUMN IF NOT EXISTS lease_expires_at TIMESTAMPTZ`,
  `ALTER TABLE ai_test_case_generation_jobs ADD COLUMN IF NOT EXISTS heartbeat_at TIMESTAMPTZ`,
  `ALTER TABLE ai_test_case_generation_jobs ADD COLUMN IF NOT EXISTS total_requirements INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE ai_test_case_generation_jobs ADD COLUMN IF NOT EXISTS processed_requirements INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE ai_test_case_generation_jobs ADD COLUMN IF NOT EXISTS generated_cases_count INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE ai_test_case_generation_jobs ADD COLUMN IF NOT EXISTS error TEXT`,
  `ALTER TABLE ai_test_case_generation_jobs ADD COLUMN IF NOT EXISTS created_by TEXT`,
  `ALTER TABLE ai_test_case_generation_jobs ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP`,
  `ALTER TABLE ai_test_case_generation_jobs ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ`,
  `ALTER TABLE ai_test_case_generation_jobs ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ`,
  `ALTER TABLE ai_test_case_generation_jobs ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP`,
  `UPDATE ai_test_case_generation_jobs SET attempts = 0 WHERE attempts IS NULL OR attempts < 0`,
  `UPDATE ai_test_case_generation_jobs SET max_attempts = 5 WHERE max_attempts IS NULL OR max_attempts < 1`,
  `ALTER TABLE ai_test_case_generation_jobs ALTER COLUMN attempts SET DEFAULT 0`,
  `ALTER TABLE ai_test_case_generation_jobs ALTER COLUMN attempts SET NOT NULL`,
  `ALTER TABLE ai_test_case_generation_jobs ALTER COLUMN max_attempts SET DEFAULT 5`,
  `ALTER TABLE ai_test_case_generation_jobs ALTER COLUMN max_attempts SET NOT NULL`,
  `UPDATE ai_test_case_generation_jobs SET lease_expires_at = CURRENT_TIMESTAMP WHERE status = 'running' AND lease_expires_at IS NULL`,
  `ALTER TABLE ai_test_case_generation_jobs DROP CONSTRAINT IF EXISTS ai_test_case_generation_jobs_authoring_mode_check`,
  `ALTER TABLE ai_test_case_generation_jobs ADD CONSTRAINT ai_test_case_generation_jobs_authoring_mode_check CHECK (authoring_mode IN ('structured', 'gherkin'))`,
  `ALTER TABLE ai_test_case_generation_jobs DROP CONSTRAINT IF EXISTS ai_test_case_generation_jobs_status_check`,
  `ALTER TABLE ai_test_case_generation_jobs ADD CONSTRAINT ai_test_case_generation_jobs_status_check CHECK (status IN ('queued', 'running', 'completed', 'failed'))`,
  `
    CREATE TABLE IF NOT EXISTS execution_case_snapshots (
      execution_id TEXT NOT NULL,
      test_case_id TEXT NOT NULL,
      test_case_title TEXT NOT NULL,
      test_case_description TEXT,
      external_references JSONB NOT NULL DEFAULT '[]'::jsonb,
      suite_id TEXT,
      suite_name TEXT,
      module_id TEXT,
      module_name TEXT,
      priority INTEGER,
      status TEXT,
      parameter_values JSONB NOT NULL DEFAULT '{}'::jsonb,
      suite_parameter_values JSONB NOT NULL DEFAULT '{}'::jsonb,
      test_data_set_id TEXT,
      test_data_set_name TEXT,
      test_data_set_snapshot JSONB,
      data_set_source TEXT,
      sort_order INTEGER NOT NULL DEFAULT 1,
      assigned_to TEXT,
      assigned_to_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
      assignment_source TEXT,
      PRIMARY KEY (execution_id, test_case_id)
    )
  `,
  `ALTER TABLE execution_case_snapshots ADD COLUMN IF NOT EXISTS parameter_values JSONB`,
  `UPDATE execution_case_snapshots SET parameter_values = '{}'::jsonb WHERE parameter_values IS NULL`,
  `ALTER TABLE execution_case_snapshots ALTER COLUMN parameter_values SET DEFAULT '{}'::jsonb`,
  `ALTER TABLE execution_case_snapshots ALTER COLUMN parameter_values SET NOT NULL`,
  `ALTER TABLE execution_case_snapshots ADD COLUMN IF NOT EXISTS parameter_template_values JSONB NOT NULL DEFAULT '{}'::jsonb`,
  `ALTER TABLE execution_case_snapshots ADD COLUMN IF NOT EXISTS external_references JSONB`,
  `UPDATE execution_case_snapshots SET external_references = '[]'::jsonb WHERE external_references IS NULL`,
  `ALTER TABLE execution_case_snapshots ALTER COLUMN external_references SET DEFAULT '[]'::jsonb`,
  `ALTER TABLE execution_case_snapshots ALTER COLUMN external_references SET NOT NULL`,
  `ALTER TABLE execution_case_snapshots ADD COLUMN IF NOT EXISTS suite_parameter_values JSONB`,
  `UPDATE execution_case_snapshots SET suite_parameter_values = '{}'::jsonb WHERE suite_parameter_values IS NULL`,
  `ALTER TABLE execution_case_snapshots ALTER COLUMN suite_parameter_values SET DEFAULT '{}'::jsonb`,
  `ALTER TABLE execution_case_snapshots ALTER COLUMN suite_parameter_values SET NOT NULL`,
  `ALTER TABLE execution_case_snapshots ADD COLUMN IF NOT EXISTS suite_parameter_template_values JSONB NOT NULL DEFAULT '{}'::jsonb`,
  `ALTER TABLE execution_case_snapshots ADD COLUMN IF NOT EXISTS test_data_set_id TEXT`,
  `ALTER TABLE execution_case_snapshots ADD COLUMN IF NOT EXISTS test_data_set_name TEXT`,
  `ALTER TABLE execution_case_snapshots ADD COLUMN IF NOT EXISTS test_data_set_snapshot JSONB`,
  `ALTER TABLE execution_case_snapshots ADD COLUMN IF NOT EXISTS data_set_source TEXT`,
  `UPDATE execution_case_snapshots SET data_set_source = NULL WHERE data_set_source IS NOT NULL AND data_set_source NOT IN ('run', 'suite', 'test_case')`,
  `ALTER TABLE execution_case_snapshots DROP CONSTRAINT IF EXISTS execution_case_snapshots_data_set_source_check`,
  `ALTER TABLE execution_case_snapshots ADD CONSTRAINT execution_case_snapshots_data_set_source_check CHECK (data_set_source IS NULL OR data_set_source IN ('run', 'suite', 'test_case'))`,
  `ALTER TABLE execution_case_snapshots ADD COLUMN IF NOT EXISTS assigned_to TEXT`,
  `ALTER TABLE execution_case_snapshots ADD COLUMN IF NOT EXISTS assigned_to_ids JSONB NOT NULL DEFAULT '[]'::jsonb`,
  `ALTER TABLE execution_case_snapshots ADD COLUMN IF NOT EXISTS assignment_source TEXT`,
  `UPDATE execution_case_snapshots SET assigned_to_ids = jsonb_build_array(assigned_to), assignment_source = COALESCE(assignment_source, 'run') WHERE assigned_to IS NOT NULL AND BTRIM(assigned_to) <> '' AND assigned_to_ids = '[]'::jsonb`,
  `ALTER TABLE execution_case_snapshots ADD COLUMN IF NOT EXISTS module_id TEXT`,
  `ALTER TABLE execution_case_snapshots ADD COLUMN IF NOT EXISTS module_name TEXT`,
  `
    CREATE TABLE IF NOT EXISTS execution_step_snapshots (
      execution_id TEXT NOT NULL,
      test_case_id TEXT NOT NULL,
      snapshot_step_id TEXT NOT NULL,
      step_order INTEGER NOT NULL,
      action TEXT,
      expected_result TEXT,
      PRIMARY KEY (execution_id, snapshot_step_id)
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS shared_step_groups (
      id TEXT PRIMARY KEY,
      app_type_id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      authoring_mode TEXT NOT NULL DEFAULT 'structured',
      gherkin_document TEXT,
      steps JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    )
  `,
  `ALTER TABLE shared_step_groups ADD COLUMN IF NOT EXISTS app_type_id TEXT`,
  `ALTER TABLE shared_step_groups ADD COLUMN IF NOT EXISTS name TEXT`,
  `ALTER TABLE shared_step_groups ADD COLUMN IF NOT EXISTS description TEXT`,
  `ALTER TABLE shared_step_groups ADD COLUMN IF NOT EXISTS authoring_mode TEXT NOT NULL DEFAULT 'structured'`,
  `ALTER TABLE shared_step_groups ADD COLUMN IF NOT EXISTS gherkin_document TEXT`,
  `UPDATE shared_step_groups SET authoring_mode = 'structured' WHERE authoring_mode IS NULL OR authoring_mode NOT IN ('structured', 'gherkin')`,
  `ALTER TABLE shared_step_groups ADD COLUMN IF NOT EXISTS steps JSONB NOT NULL DEFAULT '[]'::jsonb`,
  `ALTER TABLE shared_step_groups ADD COLUMN IF NOT EXISTS parameter_values JSONB`,
  `UPDATE shared_step_groups SET parameter_values = '{}'::jsonb WHERE parameter_values IS NULL`,
  `ALTER TABLE shared_step_groups ALTER COLUMN parameter_values SET DEFAULT '{}'::jsonb`,
  `ALTER TABLE shared_step_groups ALTER COLUMN parameter_values SET NOT NULL`,
  `ALTER TABLE shared_step_groups ADD COLUMN IF NOT EXISTS created_by TEXT`,
  `ALTER TABLE shared_step_groups ADD COLUMN IF NOT EXISTS updated_by TEXT`,
  `ALTER TABLE shared_step_groups ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP`,
  `ALTER TABLE shared_step_groups ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP`,
  `UPDATE shared_step_groups SET updated_at = COALESCE(updated_at, created_at, CURRENT_TIMESTAMP) WHERE updated_at IS NULL`,
  `ALTER TABLE test_steps ADD COLUMN IF NOT EXISTS step_type TEXT`,
  `ALTER TABLE test_steps ADD COLUMN IF NOT EXISTS automation_code TEXT`,
  `ALTER TABLE test_steps ADD COLUMN IF NOT EXISTS api_request JSONB`,
  `ALTER TABLE test_steps ADD COLUMN IF NOT EXISTS group_id TEXT`,
  `ALTER TABLE test_steps ADD COLUMN IF NOT EXISTS group_name TEXT`,
  `ALTER TABLE test_steps ADD COLUMN IF NOT EXISTS group_kind TEXT`,
  `ALTER TABLE test_steps ADD COLUMN IF NOT EXISTS reusable_group_id TEXT`,
  `ALTER TABLE execution_step_snapshots ADD COLUMN IF NOT EXISTS step_type TEXT`,
  `ALTER TABLE execution_step_snapshots ADD COLUMN IF NOT EXISTS automation_code TEXT`,
  `ALTER TABLE execution_step_snapshots ADD COLUMN IF NOT EXISTS api_request JSONB`,
  `ALTER TABLE execution_step_snapshots ADD COLUMN IF NOT EXISTS group_id TEXT`,
  `ALTER TABLE execution_step_snapshots ADD COLUMN IF NOT EXISTS group_name TEXT`,
  `ALTER TABLE execution_step_snapshots ADD COLUMN IF NOT EXISTS group_kind TEXT`,
  `ALTER TABLE execution_step_snapshots ADD COLUMN IF NOT EXISTS reusable_group_id TEXT`,
  `
    UPDATE test_steps
    SET step_type = CASE
      WHEN LOWER(COALESCE(BTRIM(test_steps.step_type), '')) IN ('web', 'api', 'android', 'ios') THEN LOWER(BTRIM(test_steps.step_type))
      WHEN LOWER(COALESCE(BTRIM(app_types.type), '')) = 'api' THEN 'api'
      WHEN LOWER(COALESCE(BTRIM(app_types.type), '')) = 'android' THEN 'android'
      WHEN LOWER(COALESCE(BTRIM(app_types.type), '')) = 'ios' THEN 'ios'
      ELSE 'web'
    END
    FROM test_cases
    LEFT JOIN app_types ON app_types.id = test_cases.app_type_id
    WHERE test_steps.test_case_id = test_cases.id
      AND (
        test_steps.step_type IS NULL
        OR BTRIM(test_steps.step_type) = ''
        OR LOWER(BTRIM(test_steps.step_type)) NOT IN ('web', 'api', 'android', 'ios')
      )
  `,
  `
    UPDATE execution_step_snapshots
    SET step_type = CASE
      WHEN LOWER(COALESCE(BTRIM(execution_step_snapshots.step_type), '')) IN ('web', 'api', 'android', 'ios') THEN LOWER(BTRIM(execution_step_snapshots.step_type))
      WHEN LOWER(COALESCE(BTRIM(app_types.type), '')) = 'api' THEN 'api'
      WHEN LOWER(COALESCE(BTRIM(app_types.type), '')) = 'android' THEN 'android'
      WHEN LOWER(COALESCE(BTRIM(app_types.type), '')) = 'ios' THEN 'ios'
      ELSE 'web'
    END
    FROM test_cases
    LEFT JOIN app_types ON app_types.id = test_cases.app_type_id
    WHERE execution_step_snapshots.test_case_id = test_cases.id
      AND (
        execution_step_snapshots.step_type IS NULL
        OR BTRIM(execution_step_snapshots.step_type) = ''
        OR LOWER(BTRIM(execution_step_snapshots.step_type)) NOT IN ('web', 'api', 'android', 'ios')
      )
  `,
  `CREATE INDEX IF NOT EXISTS idx_execution_case_snapshots_execution_id ON execution_case_snapshots (execution_id, sort_order)`,
  `CREATE INDEX IF NOT EXISTS idx_execution_step_snapshots_execution_case ON execution_step_snapshots (execution_id, test_case_id, step_order)`,
  `CREATE INDEX IF NOT EXISTS idx_execution_schedules_project_next_run ON execution_schedules (project_id, next_run_at ASC)`,
  `CREATE INDEX IF NOT EXISTS idx_execution_schedules_due_claim ON execution_schedules (is_active, next_run_at, lease_expires_at) WHERE is_active = TRUE AND next_run_at IS NOT NULL`,
  `CREATE INDEX IF NOT EXISTS idx_shared_step_groups_app_type ON shared_step_groups (app_type_id, updated_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_test_steps_case_group ON test_steps (test_case_id, group_id, step_order)`,
  `ALTER TABLE execution_results DROP CONSTRAINT IF EXISTS execution_results_status_check`,
  `ALTER TABLE execution_results ADD CONSTRAINT execution_results_status_check CHECK (status IN ('pending', 'running', 'paused', 'passed', 'failed', 'blocked', 'aborted', 'skipped'))`,
  `ALTER TABLE execution_results ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ`,
  `ALTER TABLE execution_results ADD COLUMN IF NOT EXISTS timer_started_at TIMESTAMPTZ`,
  `ALTER TABLE execution_results ADD COLUMN IF NOT EXISTS ended_at TIMESTAMPTZ`,
  `ALTER TABLE execution_results ADD COLUMN IF NOT EXISTS lifecycle_history JSONB NOT NULL DEFAULT '[]'::jsonb`,
  `ALTER TABLE execution_results ALTER COLUMN duration_ms TYPE BIGINT`,
  `CREATE INDEX IF NOT EXISTS idx_execution_results_execution_created_at ON execution_results (execution_id, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_execution_results_case_created_at ON execution_results (test_case_id, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_execution_results_app_type_created_at ON execution_results (app_type_id, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_executions_scope_activity ON executions (project_id, app_type_id, status, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_suite_test_cases_test_case_sort ON suite_test_cases (test_case_id, sort_order)`,
  `CREATE INDEX IF NOT EXISTS idx_requirement_test_cases_test_case ON requirement_test_cases (test_case_id)`,
  `
    CREATE TABLE IF NOT EXISTS requirement_defects (
      requirement_id TEXT NOT NULL,
      issue_id TEXT NOT NULL,
      link_source TEXT NOT NULL DEFAULT 'manual',
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (requirement_id, issue_id),
      FOREIGN KEY (requirement_id) REFERENCES requirements(id) ON DELETE CASCADE,
      FOREIGN KEY (issue_id) REFERENCES feedback(id) ON DELETE CASCADE
    )
  `,
  `ALTER TABLE requirement_defects ADD COLUMN IF NOT EXISTS link_source TEXT NOT NULL DEFAULT 'manual'`,
  `ALTER TABLE requirement_defects ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP`,
  `UPDATE requirement_defects SET link_source = 'manual' WHERE link_source IS NULL OR BTRIM(link_source) = ''`,
  `ALTER TABLE requirement_defects DROP CONSTRAINT IF EXISTS requirement_defects_link_source_check`,
  `ALTER TABLE requirement_defects ADD CONSTRAINT requirement_defects_link_source_check CHECK (link_source IN ('manual', 'automatic'))`,
  `CREATE INDEX IF NOT EXISTS idx_requirement_defects_issue ON requirement_defects (issue_id)`,
  `
    INSERT INTO requirement_defects (requirement_id, issue_id, link_source)
    SELECT DISTINCT derived.requirement_id, derived.issue_id, 'automatic'
    FROM (
      SELECT requirement_test_cases.requirement_id, feedback.id AS issue_id
      FROM requirement_test_cases
      JOIN execution_results ON execution_results.test_case_id = requirement_test_cases.test_case_id
      CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(execution_results.defects, '[]'::jsonb)) AS defect_ref(value)
      JOIN feedback ON feedback.id = defect_ref.value
      UNION
      SELECT test_cases.requirement_id, feedback.id AS issue_id
      FROM test_cases
      JOIN execution_results ON execution_results.test_case_id = test_cases.id
      CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(execution_results.defects, '[]'::jsonb)) AS defect_ref(value)
      JOIN feedback ON feedback.id = defect_ref.value
      WHERE test_cases.requirement_id IS NOT NULL
    ) AS derived
    ON CONFLICT (requirement_id, issue_id) DO NOTHING
  `,
  `CREATE INDEX IF NOT EXISTS idx_project_members_project_user ON project_members (project_id, user_id)`,
  `
    CREATE TABLE IF NOT EXISTS permissions (
      id TEXT PRIMARY KEY,
      code TEXT UNIQUE NOT NULL,
      description TEXT,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS role_permissions (
      role_id TEXT NOT NULL,
      permission_id TEXT NOT NULL,
      PRIMARY KEY (role_id, permission_id)
    )
  `,
  `CREATE INDEX IF NOT EXISTS idx_role_permissions_permission ON role_permissions (permission_id)`,
  `
    INSERT INTO permissions (id, code, description)
    VALUES
      ${permissionSeedValues}
    ON CONFLICT DO NOTHING
  `,
  `
    UPDATE permissions AS permission
    SET description = catalog.description
    FROM (VALUES
      ${permissionSeedValues}
    ) AS catalog(id, code, description)
    WHERE permission.code = catalog.code
      AND permission.description IS DISTINCT FROM catalog.description
  `,
  ...rolePermissionSeedStatements,
  `CREATE INDEX IF NOT EXISTS idx_execution_suites_execution_suite ON execution_suites (execution_id, suite_id)`,
  `DROP INDEX IF EXISTS idx_ai_test_case_generation_jobs_scope_status`,
  `CREATE INDEX IF NOT EXISTS idx_ai_test_case_generation_jobs_scope_status ON ai_test_case_generation_jobs (app_type_id, status, next_run_at, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_ai_test_case_generation_jobs_project_created ON ai_test_case_generation_jobs (project_id, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_ai_test_case_generation_jobs_queue_claim ON ai_test_case_generation_jobs (status, next_run_at, lease_expires_at, created_at ASC)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_test_case_generation_jobs_idempotency ON ai_test_case_generation_jobs (project_id, created_by, idempotency_key) WHERE idempotency_key IS NOT NULL`,
  `CREATE INDEX IF NOT EXISTS idx_test_cases_app_status_created ON test_cases (app_type_id, status, created_at DESC)`,
  `ALTER TABLE execution_results ADD COLUMN IF NOT EXISTS external_references JSONB`,
  `UPDATE execution_results SET external_references = '[]'::jsonb WHERE external_references IS NULL`,
  `ALTER TABLE execution_results ALTER COLUMN external_references SET DEFAULT '[]'::jsonb`,
  `ALTER TABLE execution_results ALTER COLUMN external_references SET NOT NULL`,
  `ALTER TABLE execution_results ADD COLUMN IF NOT EXISTS defects JSONB`,
  `ALTER TABLE execution_results ADD COLUMN IF NOT EXISTS test_data_set_id TEXT`,
  `ALTER TABLE execution_results ADD COLUMN IF NOT EXISTS test_data_set_name TEXT`,
  `ALTER TABLE execution_results ADD COLUMN IF NOT EXISTS data_set_iteration_index INTEGER`,
  `ALTER TABLE execution_results ADD COLUMN IF NOT EXISTS data_set_iteration_key TEXT`,
  `ALTER TABLE execution_results ADD COLUMN IF NOT EXISTS data_set_row_snapshot JSONB`,
  `CREATE INDEX IF NOT EXISTS idx_execution_results_case_iteration ON execution_results (execution_id, test_case_id, data_set_iteration_index, created_at DESC)`,
  `UPDATE execution_results SET defects = '[]'::jsonb WHERE defects IS NULL`,
  `ALTER TABLE execution_results ALTER COLUMN defects SET DEFAULT '[]'::jsonb`,
  `ALTER TABLE execution_results ALTER COLUMN defects SET NOT NULL`,
  `ALTER TABLE test_cases ADD COLUMN IF NOT EXISTS parameter_values JSONB`,
  `UPDATE test_cases SET parameter_values = '{}'::jsonb WHERE parameter_values IS NULL`,
  `ALTER TABLE test_cases ALTER COLUMN parameter_values SET DEFAULT '{}'::jsonb`,
  `ALTER TABLE test_cases ALTER COLUMN parameter_values SET NOT NULL`,
  `
    UPDATE execution_case_snapshots
    SET parameter_values = COALESCE(test_cases.parameter_values, '{}'::jsonb)
    FROM test_cases
    WHERE execution_case_snapshots.test_case_id = test_cases.id
      AND (execution_case_snapshots.parameter_values IS NULL OR execution_case_snapshots.parameter_values = '{}'::jsonb)
  `,
  `ALTER TABLE test_cases ADD COLUMN IF NOT EXISTS automated TEXT NOT NULL DEFAULT 'no'`,
  `ALTER TABLE test_cases ADD COLUMN IF NOT EXISTS ai_generation_source TEXT`,
  `ALTER TABLE test_cases ADD COLUMN IF NOT EXISTS ai_generation_review_status TEXT`,
  `ALTER TABLE test_cases ADD COLUMN IF NOT EXISTS ai_generation_job_id TEXT`,
  `ALTER TABLE test_cases ADD COLUMN IF NOT EXISTS source_idempotency_key TEXT`,
  `ALTER TABLE test_cases ADD COLUMN IF NOT EXISTS source_issue_id TEXT REFERENCES feedback(id) ON DELETE SET NULL`,
  `CREATE INDEX IF NOT EXISTS idx_test_cases_source_issue ON test_cases(source_issue_id) WHERE source_issue_id IS NOT NULL`,
  `ALTER TABLE test_cases ADD COLUMN IF NOT EXISTS ai_generated_at TIMESTAMPTZ`,
  `ALTER TABLE test_cases ADD COLUMN IF NOT EXISTS created_by TEXT`,
  `ALTER TABLE test_cases ADD COLUMN IF NOT EXISTS author_id TEXT`,
  `ALTER TABLE test_cases ADD COLUMN IF NOT EXISTS updated_by TEXT`,
  `ALTER TABLE test_cases ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP`,
  `ALTER TABLE test_cases ADD COLUMN IF NOT EXISTS external_references JSONB`,
  `ALTER TABLE test_cases ADD COLUMN IF NOT EXISTS labels JSONB`,
  `ALTER TABLE test_cases ADD COLUMN IF NOT EXISTS automation_status TEXT NOT NULL DEFAULT 'not_automated'`,
  `ALTER TABLE test_cases ADD COLUMN IF NOT EXISTS manual_test_case_id TEXT REFERENCES test_cases(id) ON DELETE SET NULL`,
  `ALTER TABLE test_cases ADD COLUMN IF NOT EXISTS authoring_mode TEXT NOT NULL DEFAULT 'structured'`,
  `ALTER TABLE test_cases ADD COLUMN IF NOT EXISTS gherkin_document TEXT`,
  `ALTER TABLE test_cases ADD COLUMN IF NOT EXISTS reviewer_id TEXT`,
  `ALTER TABLE test_cases ADD COLUMN IF NOT EXISTS review_status TEXT NOT NULL DEFAULT 'not_requested'`,
  `ALTER TABLE test_cases ADD COLUMN IF NOT EXISTS review_history JSONB NOT NULL DEFAULT '[]'::jsonb`,
  `ALTER TABLE test_cases ADD COLUMN IF NOT EXISTS ai_quality_score INTEGER`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_test_cases_source_idempotency ON test_cases (app_type_id, source_idempotency_key) WHERE source_idempotency_key IS NOT NULL`,
  `UPDATE test_cases SET author_id = created_by WHERE author_id IS NULL AND created_by IS NOT NULL`,
  `UPDATE test_cases SET author_id = NULL WHERE author_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM users WHERE users.id = test_cases.author_id)`,
  `ALTER TABLE test_cases DROP CONSTRAINT IF EXISTS test_cases_author_id_fkey`,
  `ALTER TABLE test_cases ADD CONSTRAINT test_cases_author_id_fkey FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE SET NULL`,
  `UPDATE test_cases SET external_references = '[]'::jsonb WHERE external_references IS NULL`,
  `UPDATE test_cases SET labels = '[]'::jsonb WHERE labels IS NULL`,
  `UPDATE test_cases SET review_status = 'not_requested' WHERE review_status IS NULL OR BTRIM(review_status) = ''`,
  `UPDATE test_cases SET review_history = '[]'::jsonb WHERE review_history IS NULL`,
  `ALTER TABLE test_cases ALTER COLUMN external_references SET DEFAULT '[]'::jsonb`,
  `ALTER TABLE test_cases ALTER COLUMN external_references SET NOT NULL`,
  `ALTER TABLE test_cases ALTER COLUMN labels SET DEFAULT '[]'::jsonb`,
  `ALTER TABLE test_cases ALTER COLUMN labels SET NOT NULL`,
  `UPDATE test_cases SET updated_at = COALESCE(updated_at, created_at, CURRENT_TIMESTAMP) WHERE updated_at IS NULL`,
  `
    UPDATE test_cases
    SET automated = CASE
      WHEN automated IS NULL OR BTRIM(automated) = '' THEN 'no'
      WHEN LOWER(BTRIM(automated)) IN ('yes', 'y', 'true', '1') THEN 'yes'
      ELSE 'no'
    END
    WHERE automated IS NULL OR automated NOT IN ('yes', 'no')
  `,
  `
    UPDATE test_cases
    SET automation_status = CASE
      WHEN automated = 'yes' AND automation_status = 'not_automated' THEN 'ready'
      WHEN automated <> 'yes' THEN 'not_automated'
      ELSE automation_status
    END
    WHERE (automated = 'yes' AND automation_status = 'not_automated')
      OR (automated <> 'yes' AND automation_status IS DISTINCT FROM 'not_automated')
  `,
  `ALTER TABLE test_cases DROP CONSTRAINT IF EXISTS test_cases_automated_check`,
  `ALTER TABLE test_cases ADD CONSTRAINT test_cases_automated_check CHECK (automated IN ('yes', 'no'))`,
  `ALTER TABLE test_cases DROP CONSTRAINT IF EXISTS test_cases_automation_status_check`,
  `ALTER TABLE test_cases ADD CONSTRAINT test_cases_automation_status_check CHECK (automation_status IN ('not_automated', 'ready', 'incomplete'))`,
  `ALTER TABLE test_cases DROP CONSTRAINT IF EXISTS test_cases_authoring_mode_check`,
  `ALTER TABLE test_cases ADD CONSTRAINT test_cases_authoring_mode_check CHECK (authoring_mode IN ('structured', 'gherkin'))`,
  `DROP INDEX IF EXISTS idx_test_cases_one_automation_per_manual`,
  `
    CREATE TABLE IF NOT EXISTS automation_case_links (
      automation_test_case_id TEXT NOT NULL REFERENCES test_cases(id) ON DELETE CASCADE,
      manual_test_case_id TEXT NOT NULL REFERENCES test_cases(id) ON DELETE CASCADE,
      is_primary BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (automation_test_case_id, manual_test_case_id),
      CHECK (automation_test_case_id <> manual_test_case_id)
    )
  `,
  `CREATE INDEX IF NOT EXISTS idx_automation_case_links_manual ON automation_case_links (manual_test_case_id, automation_test_case_id)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_automation_case_links_primary ON automation_case_links (automation_test_case_id) WHERE is_primary`,
  `
    INSERT INTO automation_case_links (automation_test_case_id, manual_test_case_id, is_primary)
    SELECT id, manual_test_case_id, TRUE
    FROM test_cases
    WHERE automated = 'yes' AND manual_test_case_id IS NOT NULL
    ON CONFLICT (automation_test_case_id, manual_test_case_id) DO NOTHING
  `,
  `ALTER TABLE test_cases DROP CONSTRAINT IF EXISTS test_cases_ai_generation_source_check`,
  `ALTER TABLE test_cases ADD CONSTRAINT test_cases_ai_generation_source_check CHECK (ai_generation_source IS NULL OR ai_generation_source IN ('scheduler', 'interactive', 'repository'))`,
  `ALTER TABLE test_cases DROP CONSTRAINT IF EXISTS test_cases_ai_generation_review_status_check`,
  `ALTER TABLE test_cases ADD CONSTRAINT test_cases_ai_generation_review_status_check CHECK (ai_generation_review_status IS NULL OR ai_generation_review_status IN ('pending', 'accepted', 'rejected'))`,
  `ALTER TABLE test_cases DROP CONSTRAINT IF EXISTS test_cases_review_status_check`,
  `ALTER TABLE test_cases ADD CONSTRAINT test_cases_review_status_check CHECK (review_status IN ('not_requested', 'pending', 'accepted', 'changes_requested'))`,
  `ALTER TABLE test_cases DROP CONSTRAINT IF EXISTS test_cases_ai_quality_score_check`,
  `ALTER TABLE test_cases ADD CONSTRAINT test_cases_ai_quality_score_check CHECK (ai_quality_score IS NULL OR (ai_quality_score >= 0 AND ai_quality_score <= 100))`,
  `CREATE INDEX IF NOT EXISTS idx_test_cases_ai_generation_review ON test_cases (app_type_id, ai_generation_source, ai_generation_review_status, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_test_cases_reviewer_status ON test_cases (reviewer_id, review_status, updated_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_test_cases_app_status_activity ON test_cases (app_type_id, status, (COALESCE(updated_at, created_at)) DESC, created_at DESC)`,
  `
    CREATE TABLE IF NOT EXISTS test_case_modules (
      id TEXT PRIMARY KEY,
      display_id TEXT UNIQUE,
      app_type_id TEXT NOT NULL REFERENCES app_types(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      description TEXT,
      created_by TEXT,
      updated_by TEXT,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    )
  `,
  `ALTER TABLE test_case_modules ADD COLUMN IF NOT EXISTS display_id TEXT`,
  `ALTER TABLE test_case_modules ADD COLUMN IF NOT EXISTS description TEXT`,
  `ALTER TABLE test_case_modules ADD COLUMN IF NOT EXISTS created_by TEXT`,
  `ALTER TABLE test_case_modules ADD COLUMN IF NOT EXISTS updated_by TEXT`,
  `ALTER TABLE test_case_modules ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP`,
  `ALTER TABLE test_case_modules ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP`,
  `CREATE INDEX IF NOT EXISTS idx_test_case_modules_app_type ON test_case_modules (app_type_id, updated_at DESC)`,
  `
    CREATE TABLE IF NOT EXISTS test_case_module_cases (
      module_id TEXT NOT NULL REFERENCES test_case_modules(id) ON DELETE CASCADE,
      test_case_id TEXT NOT NULL REFERENCES test_cases(id) ON DELETE CASCADE,
      sort_order INTEGER NOT NULL DEFAULT 1,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (module_id, test_case_id)
    )
  `,
  `ALTER TABLE test_case_module_cases ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_test_case_module_cases_case ON test_case_module_cases (test_case_id)`,
  `CREATE INDEX IF NOT EXISTS idx_test_case_module_cases_module_sort ON test_case_module_cases (module_id, sort_order)`,
  `
    CREATE TABLE IF NOT EXISTS test_case_module_requirements (
      module_id TEXT NOT NULL REFERENCES test_case_modules(id) ON DELETE CASCADE,
      requirement_id TEXT NOT NULL REFERENCES requirements(id) ON DELETE CASCADE,
      sort_order INTEGER NOT NULL DEFAULT 1,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (module_id, requirement_id)
    )
  `,
  `CREATE INDEX IF NOT EXISTS idx_test_case_module_requirements_module_sort ON test_case_module_requirements (module_id, sort_order, requirement_id)`,
  ...require('./testCaseModuleMembershipSchema'),
  `
    CREATE TABLE IF NOT EXISTS test_case_defects (
      test_case_id TEXT NOT NULL REFERENCES test_cases(id) ON DELETE CASCADE,
      issue_id TEXT NOT NULL REFERENCES feedback(id) ON DELETE CASCADE,
      link_source TEXT NOT NULL DEFAULT 'manual',
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (test_case_id, issue_id)
    )
  `,
  `ALTER TABLE test_case_defects ADD COLUMN IF NOT EXISTS link_source TEXT NOT NULL DEFAULT 'manual'`,
  `ALTER TABLE test_case_defects ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP`,
  `ALTER TABLE test_case_defects DROP CONSTRAINT IF EXISTS test_case_defects_link_source_check`,
  `ALTER TABLE test_case_defects ADD CONSTRAINT test_case_defects_link_source_check CHECK (link_source IN ('manual', 'automatic'))`,
  `CREATE INDEX IF NOT EXISTS idx_test_case_defects_issue ON test_case_defects (issue_id)`,
  `
    CREATE TABLE IF NOT EXISTS automation_learning_cache (
      id TEXT PRIMARY KEY,
      project_id TEXT,
      app_type_id TEXT,
      test_case_id TEXT,
      page_url TEXT,
      page_key TEXT NOT NULL,
      locator_intent TEXT NOT NULL,
      locator TEXT NOT NULL,
      locator_kind TEXT,
      confidence DOUBLE PRECISION NOT NULL DEFAULT 0,
      source TEXT NOT NULL DEFAULT 'ai_builder',
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      hit_count INTEGER NOT NULL DEFAULT 1,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    )
  `,
  `ALTER TABLE automation_learning_cache ADD COLUMN IF NOT EXISTS project_id TEXT`,
  `ALTER TABLE automation_learning_cache ADD COLUMN IF NOT EXISTS app_type_id TEXT`,
  `ALTER TABLE automation_learning_cache ADD COLUMN IF NOT EXISTS test_case_id TEXT`,
  `ALTER TABLE automation_learning_cache ADD COLUMN IF NOT EXISTS page_url TEXT`,
  `ALTER TABLE automation_learning_cache ADD COLUMN IF NOT EXISTS page_key TEXT`,
  `ALTER TABLE automation_learning_cache ADD COLUMN IF NOT EXISTS locator_intent TEXT`,
  `ALTER TABLE automation_learning_cache ADD COLUMN IF NOT EXISTS locator TEXT`,
  `ALTER TABLE automation_learning_cache ADD COLUMN IF NOT EXISTS locator_kind TEXT`,
  `ALTER TABLE automation_learning_cache ADD COLUMN IF NOT EXISTS confidence DOUBLE PRECISION NOT NULL DEFAULT 0`,
  `ALTER TABLE automation_learning_cache ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'ai_builder'`,
  `ALTER TABLE automation_learning_cache ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb`,
  `ALTER TABLE automation_learning_cache ADD COLUMN IF NOT EXISTS hit_count INTEGER NOT NULL DEFAULT 1`,
  `ALTER TABLE automation_learning_cache ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP`,
  `ALTER TABLE automation_learning_cache ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP`,
  `UPDATE automation_learning_cache SET page_key = COALESCE(NULLIF(page_key, ''), COALESCE(NULLIF(page_url, ''), 'unknown-page')) WHERE page_key IS NULL OR BTRIM(page_key) = ''`,
  `UPDATE automation_learning_cache SET locator_intent = 'unknown-intent' WHERE locator_intent IS NULL OR BTRIM(locator_intent) = ''`,
  `UPDATE automation_learning_cache SET locator = 'unknown-locator' WHERE locator IS NULL OR BTRIM(locator) = ''`,
  `UPDATE automation_learning_cache SET metadata = '{}'::jsonb WHERE metadata IS NULL`,
  `UPDATE automation_learning_cache SET hit_count = 1 WHERE hit_count IS NULL OR hit_count < 1`,
  `ALTER TABLE automation_learning_cache ALTER COLUMN page_key SET NOT NULL`,
  `ALTER TABLE automation_learning_cache ALTER COLUMN locator_intent SET NOT NULL`,
  `ALTER TABLE automation_learning_cache ALTER COLUMN locator SET NOT NULL`,
  `ALTER TABLE automation_learning_cache ALTER COLUMN metadata SET DEFAULT '{}'::jsonb`,
  `ALTER TABLE automation_learning_cache ALTER COLUMN metadata SET NOT NULL`,
  `ALTER TABLE automation_learning_cache ALTER COLUMN hit_count SET DEFAULT 1`,
  `ALTER TABLE automation_learning_cache ALTER COLUMN hit_count SET NOT NULL`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_automation_learning_cache_unique ON automation_learning_cache (app_type_id, page_key, locator_intent, locator)`,
  `CREATE INDEX IF NOT EXISTS idx_automation_learning_cache_scope ON automation_learning_cache (project_id, app_type_id, updated_at DESC)`,
  `
    CREATE TABLE IF NOT EXISTS workspace_transactions (
      id TEXT PRIMARY KEY,
      project_id TEXT,
      app_type_id TEXT,
      category TEXT NOT NULL,
      action TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'completed',
      title TEXT NOT NULL,
      description TEXT,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      related_kind TEXT,
      related_id TEXT,
      created_by TEXT,
      started_at TIMESTAMPTZ,
      completed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    )
  `,
  `ALTER TABLE workspace_transactions ADD COLUMN IF NOT EXISTS project_id TEXT`,
  `ALTER TABLE workspace_transactions ADD COLUMN IF NOT EXISTS app_type_id TEXT`,
  `ALTER TABLE workspace_transactions ADD COLUMN IF NOT EXISTS category TEXT`,
  `ALTER TABLE workspace_transactions ADD COLUMN IF NOT EXISTS action TEXT`,
  `ALTER TABLE workspace_transactions ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'completed'`,
  `ALTER TABLE workspace_transactions ADD COLUMN IF NOT EXISTS title TEXT`,
  `ALTER TABLE workspace_transactions ADD COLUMN IF NOT EXISTS description TEXT`,
  `ALTER TABLE workspace_transactions ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb`,
  `ALTER TABLE workspace_transactions ADD COLUMN IF NOT EXISTS related_kind TEXT`,
  `ALTER TABLE workspace_transactions ADD COLUMN IF NOT EXISTS related_id TEXT`,
  `ALTER TABLE workspace_transactions ADD COLUMN IF NOT EXISTS created_by TEXT`,
  `ALTER TABLE workspace_transactions ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ`,
  `ALTER TABLE workspace_transactions ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ`,
  `ALTER TABLE workspace_transactions ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP`,
  `ALTER TABLE workspace_transactions ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP`,
  `UPDATE workspace_transactions SET category = 'general' WHERE category IS NULL OR BTRIM(category) = ''`,
  `UPDATE workspace_transactions SET action = 'event' WHERE action IS NULL OR BTRIM(action) = ''`,
  `UPDATE workspace_transactions SET title = 'Workspace transaction' WHERE title IS NULL OR BTRIM(title) = ''`,
  `UPDATE workspace_transactions SET status = 'completed' WHERE status IS NULL OR BTRIM(status) = ''`,
  `ALTER TABLE workspace_transactions ALTER COLUMN category SET NOT NULL`,
  `ALTER TABLE workspace_transactions ALTER COLUMN action SET NOT NULL`,
  `ALTER TABLE workspace_transactions ALTER COLUMN title SET NOT NULL`,
  `ALTER TABLE workspace_transactions ALTER COLUMN metadata SET DEFAULT '{}'::jsonb`,
  `ALTER TABLE workspace_transactions ALTER COLUMN metadata SET NOT NULL`,
  `ALTER TABLE workspace_transactions DROP CONSTRAINT IF EXISTS workspace_transactions_status_check`,
  `ALTER TABLE workspace_transactions ADD CONSTRAINT workspace_transactions_status_check CHECK (status IN ('queued', 'running', 'completed', 'failed'))`,
  `CREATE INDEX IF NOT EXISTS idx_workspace_transactions_scope ON workspace_transactions (project_id, app_type_id, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_workspace_transactions_related ON workspace_transactions (related_kind, related_id, created_at DESC)`,
  `
    CREATE TABLE IF NOT EXISTS workspace_transaction_events (
      id TEXT PRIMARY KEY,
      transaction_id TEXT NOT NULL,
      level TEXT NOT NULL DEFAULT 'info',
      phase TEXT,
      message TEXT NOT NULL,
      details JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    )
  `,
  `ALTER TABLE workspace_transaction_events ADD COLUMN IF NOT EXISTS transaction_id TEXT`,
  `ALTER TABLE workspace_transaction_events ADD COLUMN IF NOT EXISTS level TEXT NOT NULL DEFAULT 'info'`,
  `ALTER TABLE workspace_transaction_events ADD COLUMN IF NOT EXISTS phase TEXT`,
  `ALTER TABLE workspace_transaction_events ADD COLUMN IF NOT EXISTS message TEXT`,
  `ALTER TABLE workspace_transaction_events ADD COLUMN IF NOT EXISTS details JSONB NOT NULL DEFAULT '{}'::jsonb`,
  `ALTER TABLE workspace_transaction_events ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP`,
  `UPDATE workspace_transaction_events SET level = 'info' WHERE level IS NULL OR BTRIM(level) = ''`,
  `UPDATE workspace_transaction_events SET message = 'Transaction event' WHERE message IS NULL OR BTRIM(message) = ''`,
  `ALTER TABLE workspace_transaction_events ALTER COLUMN level SET NOT NULL`,
  `ALTER TABLE workspace_transaction_events ALTER COLUMN message SET NOT NULL`,
  `ALTER TABLE workspace_transaction_events ALTER COLUMN details SET DEFAULT '{}'::jsonb`,
  `ALTER TABLE workspace_transaction_events ALTER COLUMN details SET NOT NULL`,
  `ALTER TABLE workspace_transaction_events DROP CONSTRAINT IF EXISTS workspace_transaction_events_level_check`,
  `ALTER TABLE workspace_transaction_events ADD CONSTRAINT workspace_transaction_events_level_check CHECK (level IN ('info', 'success', 'warning', 'error'))`,
  `CREATE INDEX IF NOT EXISTS idx_workspace_transaction_events_lookup ON workspace_transaction_events (transaction_id, created_at ASC)`,
  `
    CREATE TABLE IF NOT EXISTS batch_process_jobs (
      id TEXT PRIMARY KEY,
      transaction_id TEXT NOT NULL UNIQUE,
      operation TEXT NOT NULL,
      payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      result JSONB NOT NULL DEFAULT '{}'::jsonb,
      status TEXT NOT NULL DEFAULT 'queued',
      attempts INTEGER NOT NULL DEFAULT 0,
      started_at TIMESTAMPTZ,
      completed_at TIMESTAMPTZ,
      last_error TEXT,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    )
  `,
  `ALTER TABLE batch_process_jobs ADD COLUMN IF NOT EXISTS transaction_id TEXT`,
  `ALTER TABLE batch_process_jobs ADD COLUMN IF NOT EXISTS operation TEXT`,
  `ALTER TABLE batch_process_jobs ADD COLUMN IF NOT EXISTS payload JSONB NOT NULL DEFAULT '{}'::jsonb`,
  `ALTER TABLE batch_process_jobs ADD COLUMN IF NOT EXISTS result JSONB NOT NULL DEFAULT '{}'::jsonb`,
  `ALTER TABLE batch_process_jobs ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'queued'`,
  `ALTER TABLE batch_process_jobs ADD COLUMN IF NOT EXISTS attempts INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE batch_process_jobs ADD COLUMN IF NOT EXISTS max_attempts INTEGER NOT NULL DEFAULT 5`,
  `ALTER TABLE batch_process_jobs ADD COLUMN IF NOT EXISTS next_run_at TIMESTAMPTZ`,
  `ALTER TABLE batch_process_jobs ADD COLUMN IF NOT EXISTS lease_owner TEXT`,
  `ALTER TABLE batch_process_jobs ADD COLUMN IF NOT EXISTS lease_expires_at TIMESTAMPTZ`,
  `ALTER TABLE batch_process_jobs ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ`,
  `ALTER TABLE batch_process_jobs ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ`,
  `ALTER TABLE batch_process_jobs ADD COLUMN IF NOT EXISTS last_error TEXT`,
  `ALTER TABLE batch_process_jobs ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP`,
  `ALTER TABLE batch_process_jobs ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP`,
  `UPDATE batch_process_jobs SET operation = 'unknown' WHERE operation IS NULL OR BTRIM(operation) = ''`,
  `UPDATE batch_process_jobs SET status = 'queued' WHERE status IS NULL OR BTRIM(status) = ''`,
  `UPDATE batch_process_jobs SET max_attempts = 5 WHERE max_attempts IS NULL OR max_attempts < 1`,
  `ALTER TABLE batch_process_jobs ALTER COLUMN transaction_id SET NOT NULL`,
  `ALTER TABLE batch_process_jobs ALTER COLUMN operation SET NOT NULL`,
  `ALTER TABLE batch_process_jobs ALTER COLUMN max_attempts SET DEFAULT 5`,
  `ALTER TABLE batch_process_jobs ALTER COLUMN max_attempts SET NOT NULL`,
  `ALTER TABLE batch_process_jobs DROP CONSTRAINT IF EXISTS batch_process_jobs_status_check`,
  `ALTER TABLE batch_process_jobs ADD CONSTRAINT batch_process_jobs_status_check CHECK (status IN ('queued', 'running', 'completed', 'failed'))`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_batch_process_jobs_transaction ON batch_process_jobs (transaction_id)`,
  `DROP INDEX IF EXISTS idx_batch_process_jobs_queue`,
  `CREATE INDEX IF NOT EXISTS idx_batch_process_jobs_queue ON batch_process_jobs (status, next_run_at, created_at ASC)`,
  `
    CREATE TABLE IF NOT EXISTS automation_generator_jobs (
      id TEXT PRIMARY KEY,
      transaction_id TEXT NOT NULL UNIQUE,
      project_id TEXT,
      app_type_id TEXT,
      test_case_id TEXT NOT NULL,
      payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      runtime_state JSONB NOT NULL DEFAULT '{}'::jsonb,
      result JSONB NOT NULL DEFAULT '{}'::jsonb,
      status TEXT NOT NULL DEFAULT 'queued',
      attempts INTEGER NOT NULL DEFAULT 0,
      leased_by TEXT,
      lease_expires_at TIMESTAMPTZ,
      heartbeat_at TIMESTAMPTZ,
      started_at TIMESTAMPTZ,
      completed_at TIMESTAMPTZ,
      last_error TEXT,
      created_by TEXT,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    )
  `,
  `ALTER TABLE automation_generator_jobs ADD COLUMN IF NOT EXISTS transaction_id TEXT`,
  `ALTER TABLE automation_generator_jobs ADD COLUMN IF NOT EXISTS project_id TEXT`,
  `ALTER TABLE automation_generator_jobs ADD COLUMN IF NOT EXISTS app_type_id TEXT`,
  `ALTER TABLE automation_generator_jobs ADD COLUMN IF NOT EXISTS test_case_id TEXT`,
  `ALTER TABLE automation_generator_jobs ADD COLUMN IF NOT EXISTS payload JSONB NOT NULL DEFAULT '{}'::jsonb`,
  `ALTER TABLE automation_generator_jobs ADD COLUMN IF NOT EXISTS runtime_state JSONB NOT NULL DEFAULT '{}'::jsonb`,
  `ALTER TABLE automation_generator_jobs ADD COLUMN IF NOT EXISTS result JSONB NOT NULL DEFAULT '{}'::jsonb`,
  `ALTER TABLE automation_generator_jobs ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'queued'`,
  `ALTER TABLE automation_generator_jobs ADD COLUMN IF NOT EXISTS attempts INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE automation_generator_jobs ADD COLUMN IF NOT EXISTS leased_by TEXT`,
  `ALTER TABLE automation_generator_jobs ADD COLUMN IF NOT EXISTS lease_expires_at TIMESTAMPTZ`,
  `ALTER TABLE automation_generator_jobs ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ`,
  `ALTER TABLE automation_generator_jobs ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ`,
  `ALTER TABLE automation_generator_jobs ADD COLUMN IF NOT EXISTS last_error TEXT`,
  `ALTER TABLE automation_generator_jobs ADD COLUMN IF NOT EXISTS created_by TEXT`,
  `ALTER TABLE automation_generator_jobs ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP`,
  `ALTER TABLE automation_generator_jobs ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP`,
  `UPDATE automation_generator_jobs SET payload = '{}'::jsonb WHERE payload IS NULL`,
  `UPDATE automation_generator_jobs SET runtime_state = '{}'::jsonb WHERE runtime_state IS NULL`,
  `UPDATE automation_generator_jobs SET result = '{}'::jsonb WHERE result IS NULL`,
  `UPDATE automation_generator_jobs SET status = 'queued' WHERE status IS NULL OR BTRIM(status) = ''`,
  `ALTER TABLE automation_generator_jobs ALTER COLUMN transaction_id SET NOT NULL`,
  `ALTER TABLE automation_generator_jobs ALTER COLUMN test_case_id SET NOT NULL`,
  `ALTER TABLE automation_generator_jobs ALTER COLUMN payload SET DEFAULT '{}'::jsonb`,
  `ALTER TABLE automation_generator_jobs ALTER COLUMN payload SET NOT NULL`,
  `ALTER TABLE automation_generator_jobs ALTER COLUMN runtime_state SET DEFAULT '{}'::jsonb`,
  `ALTER TABLE automation_generator_jobs ALTER COLUMN runtime_state SET NOT NULL`,
  `ALTER TABLE automation_generator_jobs ALTER COLUMN result SET DEFAULT '{}'::jsonb`,
  `ALTER TABLE automation_generator_jobs ALTER COLUMN result SET NOT NULL`,
  `ALTER TABLE automation_generator_jobs DROP CONSTRAINT IF EXISTS automation_generator_jobs_status_check`,
  `ALTER TABLE automation_generator_jobs ADD CONSTRAINT automation_generator_jobs_status_check CHECK (status IN ('queued', 'leased', 'running', 'completed', 'failed', 'cancelled'))`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_automation_generator_jobs_transaction ON automation_generator_jobs (transaction_id)`,
  `CREATE INDEX IF NOT EXISTS idx_automation_generator_jobs_queue ON automation_generator_jobs (status, lease_expires_at, created_at ASC)`,
  `CREATE INDEX IF NOT EXISTS idx_automation_generator_jobs_case ON automation_generator_jobs (test_case_id, created_at DESC)`,
  `
    CREATE TABLE IF NOT EXISTS workspace_transaction_artifacts (
      id TEXT PRIMARY KEY,
      transaction_id TEXT NOT NULL,
      file_name TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    )
  `,
  `ALTER TABLE workspace_transaction_artifacts ADD COLUMN IF NOT EXISTS transaction_id TEXT`,
  `ALTER TABLE workspace_transaction_artifacts ADD COLUMN IF NOT EXISTS file_name TEXT`,
  `ALTER TABLE workspace_transaction_artifacts ADD COLUMN IF NOT EXISTS mime_type TEXT`,
  `ALTER TABLE workspace_transaction_artifacts ADD COLUMN IF NOT EXISTS content TEXT`,
  `ALTER TABLE workspace_transaction_artifacts ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP`,
  `UPDATE workspace_transaction_artifacts SET file_name = 'artifact.txt' WHERE file_name IS NULL OR BTRIM(file_name) = ''`,
  `UPDATE workspace_transaction_artifacts SET mime_type = 'text/plain' WHERE mime_type IS NULL OR BTRIM(mime_type) = ''`,
  `ALTER TABLE workspace_transaction_artifacts ALTER COLUMN transaction_id SET NOT NULL`,
  `ALTER TABLE workspace_transaction_artifacts ALTER COLUMN file_name SET NOT NULL`,
  `ALTER TABLE workspace_transaction_artifacts ALTER COLUMN mime_type SET NOT NULL`,
  `ALTER TABLE workspace_transaction_artifacts ALTER COLUMN content SET NOT NULL`,
  `CREATE INDEX IF NOT EXISTS idx_workspace_transaction_artifacts_lookup ON workspace_transaction_artifacts (transaction_id, created_at DESC)`,
  `
    CREATE TABLE IF NOT EXISTS test_engine_jobs (
      id TEXT PRIMARY KEY,
      engine_run_id TEXT NOT NULL,
      integration_id TEXT,
      project_id TEXT NOT NULL,
      app_type_id TEXT,
      app_type_kind TEXT NOT NULL DEFAULT 'web',
      engine_class TEXT NOT NULL DEFAULT 'web',
      engine_max_workers INTEGER NOT NULL DEFAULT 1,
      execution_id TEXT NOT NULL,
      test_case_id TEXT NOT NULL,
      test_case_title TEXT NOT NULL,
      transaction_id TEXT,
      engine_host TEXT,
      payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      runtime_state JSONB NOT NULL DEFAULT '{}'::jsonb,
      status TEXT NOT NULL DEFAULT 'queued',
      attempts INTEGER NOT NULL DEFAULT 0,
      leased_by TEXT,
      lease_expires_at TIMESTAMPTZ,
      started_at TIMESTAMPTZ,
      completed_at TIMESTAMPTZ,
      last_error TEXT,
      created_by TEXT,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    )
  `,
  `ALTER TABLE test_engine_jobs ADD COLUMN IF NOT EXISTS engine_run_id TEXT`,
  `ALTER TABLE test_engine_jobs ADD COLUMN IF NOT EXISTS integration_id TEXT`,
  `ALTER TABLE test_engine_jobs ADD COLUMN IF NOT EXISTS project_id TEXT`,
  `ALTER TABLE test_engine_jobs ADD COLUMN IF NOT EXISTS app_type_id TEXT`,
  `ALTER TABLE test_engine_jobs ADD COLUMN IF NOT EXISTS app_type_kind TEXT NOT NULL DEFAULT 'web'`,
  `ALTER TABLE test_engine_jobs ADD COLUMN IF NOT EXISTS engine_class TEXT NOT NULL DEFAULT 'web'`,
  `ALTER TABLE test_engine_jobs ADD COLUMN IF NOT EXISTS engine_max_workers INTEGER NOT NULL DEFAULT 1`,
  `ALTER TABLE test_engine_jobs ADD COLUMN IF NOT EXISTS execution_id TEXT`,
  `ALTER TABLE test_engine_jobs ADD COLUMN IF NOT EXISTS test_case_id TEXT`,
  `ALTER TABLE test_engine_jobs ADD COLUMN IF NOT EXISTS test_case_title TEXT`,
  `ALTER TABLE test_engine_jobs ADD COLUMN IF NOT EXISTS transaction_id TEXT`,
  `ALTER TABLE test_engine_jobs ADD COLUMN IF NOT EXISTS engine_host TEXT`,
  `ALTER TABLE test_engine_jobs ADD COLUMN IF NOT EXISTS payload JSONB NOT NULL DEFAULT '{}'::jsonb`,
  `ALTER TABLE test_engine_jobs ADD COLUMN IF NOT EXISTS runtime_state JSONB NOT NULL DEFAULT '{}'::jsonb`,
  `ALTER TABLE test_engine_jobs ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'queued'`,
  `ALTER TABLE test_engine_jobs ADD COLUMN IF NOT EXISTS attempts INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE test_engine_jobs ADD COLUMN IF NOT EXISTS leased_by TEXT`,
  `ALTER TABLE test_engine_jobs ADD COLUMN IF NOT EXISTS lease_expires_at TIMESTAMPTZ`,
  `ALTER TABLE test_engine_jobs ADD COLUMN IF NOT EXISTS heartbeat_at TIMESTAMPTZ`,
  `ALTER TABLE test_engine_jobs ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ`,
  `ALTER TABLE test_engine_jobs ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ`,
  `ALTER TABLE test_engine_jobs ADD COLUMN IF NOT EXISTS last_error TEXT`,
  `ALTER TABLE test_engine_jobs ADD COLUMN IF NOT EXISTS created_by TEXT`,
  `ALTER TABLE test_engine_jobs ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP`,
  `ALTER TABLE test_engine_jobs ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP`,
  `UPDATE test_engine_jobs SET payload = '{}'::jsonb WHERE payload IS NULL`,
  `UPDATE test_engine_jobs SET runtime_state = '{}'::jsonb WHERE runtime_state IS NULL`,
  `UPDATE test_engine_jobs SET status = 'queued' WHERE status IS NULL OR BTRIM(status) = ''`,
  `UPDATE test_engine_jobs SET status = 'leased' WHERE status = 'claimed'`,
  `UPDATE test_engine_jobs SET engine_class = 'android' WHERE (engine_class IS NULL OR BTRIM(engine_class) = '' OR engine_class NOT IN ('api', 'web', 'android')) AND app_type_kind = 'android'`,
  `UPDATE test_engine_jobs SET engine_class = 'api' WHERE (engine_class IS NULL OR BTRIM(engine_class) = '' OR engine_class NOT IN ('api', 'web', 'android')) AND app_type_kind = 'api'`,
  `UPDATE test_engine_jobs SET engine_class = 'web' WHERE engine_class IS NULL OR BTRIM(engine_class) = '' OR engine_class NOT IN ('api', 'web', 'android')`,
  `UPDATE test_engine_jobs SET engine_max_workers = 1 WHERE engine_max_workers IS NULL OR engine_max_workers < 1`,
  `ALTER TABLE test_engine_jobs ALTER COLUMN payload SET DEFAULT '{}'::jsonb`,
  `ALTER TABLE test_engine_jobs ALTER COLUMN payload SET NOT NULL`,
  `ALTER TABLE test_engine_jobs ALTER COLUMN runtime_state SET DEFAULT '{}'::jsonb`,
  `ALTER TABLE test_engine_jobs ALTER COLUMN runtime_state SET NOT NULL`,
  `ALTER TABLE test_engine_jobs DROP CONSTRAINT IF EXISTS test_engine_jobs_status_check`,
  `ALTER TABLE test_engine_jobs ADD CONSTRAINT test_engine_jobs_status_check CHECK (status IN ('queued', 'leased', 'running', 'completed', 'failed', 'aborted'))`,
  `ALTER TABLE test_engine_jobs DROP CONSTRAINT IF EXISTS test_engine_jobs_engine_class_check`,
  `ALTER TABLE test_engine_jobs ADD CONSTRAINT test_engine_jobs_engine_class_check CHECK (engine_class IN ('api', 'web', 'android'))`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_test_engine_jobs_engine_run_id ON test_engine_jobs (engine_run_id)`,
  `CREATE INDEX IF NOT EXISTS idx_test_engine_jobs_queue ON test_engine_jobs (status, engine_class, app_type_kind, engine_host, created_at ASC)`,
  `CREATE INDEX IF NOT EXISTS idx_test_engine_jobs_execution_case ON test_engine_jobs (execution_id, test_case_id)`,
  `CREATE INDEX IF NOT EXISTS idx_test_engine_jobs_execution_created_at ON test_engine_jobs (execution_id, created_at DESC)`,
  `DROP INDEX IF EXISTS idx_test_engine_jobs_exec`,
  `ALTER TABLE executions ADD COLUMN IF NOT EXISTS execution_mode TEXT NOT NULL DEFAULT 'remote'`,
  `ALTER TABLE executions ADD COLUMN IF NOT EXISTS attempt_count INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE executions ADD COLUMN IF NOT EXISTS worker_id TEXT`,
  `ALTER TABLE executions ADD COLUMN IF NOT EXISTS error_message TEXT`,
  `ALTER TABLE executions ADD COLUMN IF NOT EXISTS duration_ms INTEGER`,
  `ALTER TABLE executions DROP CONSTRAINT IF EXISTS executions_execution_mode_check`,
  `ALTER TABLE executions ADD CONSTRAINT executions_execution_mode_check CHECK (execution_mode IN ('local', 'remote', 'scheduled'))`,
  `ALTER TABLE executions DROP CONSTRAINT IF EXISTS executions_status_check`,
  `ALTER TABLE executions ADD CONSTRAINT executions_status_check CHECK (status IN ('queued', 'running', 'passed', 'failed', 'skipped', 'blocked', 'retrying', 'cancelled', 'aborted', 'partially_completed', 'completed'))`,
  `
    CREATE TABLE IF NOT EXISTS suite_runs (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      suite_id TEXT,
      parent_id TEXT,
      status TEXT NOT NULL DEFAULT 'queued',
      started_at TIMESTAMPTZ,
      finished_at TIMESTAMPTZ,
      duration_ms INTEGER,
      attempt_count INTEGER NOT NULL DEFAULT 0,
      error_message TEXT,
      worker_id TEXT,
      execution_mode TEXT NOT NULL DEFAULT 'remote',
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    )
  `,
  `ALTER TABLE suite_runs ADD COLUMN IF NOT EXISTS run_id TEXT`,
  `ALTER TABLE suite_runs ADD COLUMN IF NOT EXISTS suite_id TEXT`,
  `ALTER TABLE suite_runs ADD COLUMN IF NOT EXISTS parent_id TEXT`,
  `ALTER TABLE suite_runs ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'queued'`,
  `ALTER TABLE suite_runs ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ`,
  `ALTER TABLE suite_runs ADD COLUMN IF NOT EXISTS finished_at TIMESTAMPTZ`,
  `ALTER TABLE suite_runs ADD COLUMN IF NOT EXISTS duration_ms INTEGER`,
  `ALTER TABLE suite_runs ADD COLUMN IF NOT EXISTS attempt_count INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE suite_runs ADD COLUMN IF NOT EXISTS error_message TEXT`,
  `ALTER TABLE suite_runs ADD COLUMN IF NOT EXISTS worker_id TEXT`,
  `ALTER TABLE suite_runs ADD COLUMN IF NOT EXISTS execution_mode TEXT NOT NULL DEFAULT 'remote'`,
  `ALTER TABLE suite_runs DROP CONSTRAINT IF EXISTS suite_runs_status_check`,
  `ALTER TABLE suite_runs ADD CONSTRAINT suite_runs_status_check CHECK (status IN ('queued', 'running', 'passed', 'failed', 'skipped', 'blocked', 'retrying', 'cancelled', 'aborted', 'partially_completed'))`,
  `ALTER TABLE suite_runs DROP CONSTRAINT IF EXISTS suite_runs_execution_mode_check`,
  `ALTER TABLE suite_runs ADD CONSTRAINT suite_runs_execution_mode_check CHECK (execution_mode IN ('local', 'remote', 'scheduled'))`,
  `CREATE INDEX IF NOT EXISTS idx_suite_runs_run ON suite_runs (run_id, status)`,
  `
    CREATE TABLE IF NOT EXISTS test_case_runs (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      suite_run_id TEXT,
      test_case_id TEXT,
      parent_id TEXT,
      status TEXT NOT NULL DEFAULT 'queued',
      started_at TIMESTAMPTZ,
      finished_at TIMESTAMPTZ,
      duration_ms INTEGER,
      attempt_count INTEGER NOT NULL DEFAULT 0,
      error_message TEXT,
      worker_id TEXT,
      execution_mode TEXT NOT NULL DEFAULT 'remote',
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    )
  `,
  `ALTER TABLE test_case_runs ADD COLUMN IF NOT EXISTS run_id TEXT`,
  `ALTER TABLE test_case_runs ADD COLUMN IF NOT EXISTS suite_run_id TEXT`,
  `ALTER TABLE test_case_runs ADD COLUMN IF NOT EXISTS test_case_id TEXT`,
  `ALTER TABLE test_case_runs ADD COLUMN IF NOT EXISTS parent_id TEXT`,
  `ALTER TABLE test_case_runs ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'queued'`,
  `ALTER TABLE test_case_runs ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ`,
  `ALTER TABLE test_case_runs ADD COLUMN IF NOT EXISTS finished_at TIMESTAMPTZ`,
  `ALTER TABLE test_case_runs ADD COLUMN IF NOT EXISTS duration_ms INTEGER`,
  `ALTER TABLE test_case_runs ADD COLUMN IF NOT EXISTS attempt_count INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE test_case_runs ADD COLUMN IF NOT EXISTS error_message TEXT`,
  `ALTER TABLE test_case_runs ADD COLUMN IF NOT EXISTS worker_id TEXT`,
  `ALTER TABLE test_case_runs ADD COLUMN IF NOT EXISTS execution_mode TEXT NOT NULL DEFAULT 'remote'`,
  `ALTER TABLE test_case_runs DROP CONSTRAINT IF EXISTS test_case_runs_status_check`,
  `ALTER TABLE test_case_runs ADD CONSTRAINT test_case_runs_status_check CHECK (status IN ('queued', 'running', 'passed', 'failed', 'skipped', 'blocked', 'retrying', 'cancelled', 'aborted', 'partially_completed'))`,
  `ALTER TABLE test_case_runs DROP CONSTRAINT IF EXISTS test_case_runs_execution_mode_check`,
  `ALTER TABLE test_case_runs ADD CONSTRAINT test_case_runs_execution_mode_check CHECK (execution_mode IN ('local', 'remote', 'scheduled'))`,
  `CREATE INDEX IF NOT EXISTS idx_test_case_runs_suite ON test_case_runs (suite_run_id, status)`,
  `CREATE INDEX IF NOT EXISTS idx_test_case_runs_run_case ON test_case_runs (run_id, test_case_id)`,
  `
    CREATE TABLE IF NOT EXISTS step_runs (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      test_case_run_id TEXT,
      step_id TEXT,
      parent_id TEXT,
      status TEXT NOT NULL DEFAULT 'queued',
      started_at TIMESTAMPTZ,
      finished_at TIMESTAMPTZ,
      duration_ms INTEGER,
      attempt_count INTEGER NOT NULL DEFAULT 0,
      error_message TEXT,
      worker_id TEXT,
      execution_mode TEXT NOT NULL DEFAULT 'remote',
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    )
  `,
  `ALTER TABLE step_runs ADD COLUMN IF NOT EXISTS run_id TEXT`,
  `ALTER TABLE step_runs ADD COLUMN IF NOT EXISTS test_case_run_id TEXT`,
  `ALTER TABLE step_runs ADD COLUMN IF NOT EXISTS step_id TEXT`,
  `ALTER TABLE step_runs ADD COLUMN IF NOT EXISTS parent_id TEXT`,
  `ALTER TABLE step_runs ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'queued'`,
  `ALTER TABLE step_runs ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ`,
  `ALTER TABLE step_runs ADD COLUMN IF NOT EXISTS finished_at TIMESTAMPTZ`,
  `ALTER TABLE step_runs ADD COLUMN IF NOT EXISTS duration_ms INTEGER`,
  `ALTER TABLE step_runs ADD COLUMN IF NOT EXISTS attempt_count INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE step_runs ADD COLUMN IF NOT EXISTS error_message TEXT`,
  `ALTER TABLE step_runs ADD COLUMN IF NOT EXISTS worker_id TEXT`,
  `ALTER TABLE step_runs ADD COLUMN IF NOT EXISTS execution_mode TEXT NOT NULL DEFAULT 'remote'`,
  `ALTER TABLE step_runs DROP CONSTRAINT IF EXISTS step_runs_status_check`,
  `ALTER TABLE step_runs ADD CONSTRAINT step_runs_status_check CHECK (status IN ('queued', 'running', 'passed', 'failed', 'skipped', 'blocked', 'retrying', 'cancelled', 'aborted', 'partially_completed'))`,
  `ALTER TABLE step_runs DROP CONSTRAINT IF EXISTS step_runs_execution_mode_check`,
  `ALTER TABLE step_runs ADD CONSTRAINT step_runs_execution_mode_check CHECK (execution_mode IN ('local', 'remote', 'scheduled'))`,
  `CREATE INDEX IF NOT EXISTS idx_step_runs_case ON step_runs (test_case_run_id, status)`,
  `
    CREATE TABLE IF NOT EXISTS execution_capacity (
      engine_type TEXT PRIMARY KEY,
      max_parallel INTEGER NOT NULL DEFAULT 1,
      current_running INTEGER NOT NULL DEFAULT 0,
      queued_count INTEGER NOT NULL DEFAULT 0,
      healthy_workers INTEGER NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    )
  `,
  `ALTER TABLE execution_capacity DROP CONSTRAINT IF EXISTS execution_capacity_engine_type_check`,
  `ALTER TABLE execution_capacity ADD CONSTRAINT execution_capacity_engine_type_check CHECK (engine_type IN ('api', 'web', 'android'))`,
  `
    INSERT INTO execution_capacity (engine_type, max_parallel)
    VALUES ('api', 30), ('web', 5), ('android', 2)
    ON CONFLICT (engine_type) DO NOTHING
  `,
  `
    CREATE TABLE IF NOT EXISTS worker_heartbeat (
      worker_id TEXT PRIMARY KEY,
      engine_type TEXT,
      last_seen_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      current_job_id TEXT,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb
    )
  `,
  `ALTER TABLE worker_heartbeat DROP CONSTRAINT IF EXISTS worker_heartbeat_engine_type_check`,
  `ALTER TABLE worker_heartbeat ADD CONSTRAINT worker_heartbeat_engine_type_check CHECK (engine_type IS NULL OR engine_type IN ('api', 'web', 'android'))`,
  `CREATE INDEX IF NOT EXISTS idx_worker_heartbeat_seen ON worker_heartbeat (last_seen_at DESC)`,
  `
    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      session_id TEXT,
      project_id TEXT,
      run_id TEXT,
      target_url TEXT,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'unread',
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    )
  `,
  `ALTER TABLE notifications ADD COLUMN IF NOT EXISTS session_id TEXT`,
  `ALTER TABLE notifications ADD COLUMN IF NOT EXISTS project_id TEXT`,
  `ALTER TABLE notifications ADD COLUMN IF NOT EXISTS run_id TEXT`,
  `ALTER TABLE notifications ADD COLUMN IF NOT EXISTS target_url TEXT`,
  `ALTER TABLE notifications ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'unread'`,
  `ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_status_check`,
  `ALTER TABLE notifications ADD CONSTRAINT notifications_status_check CHECK (status IN ('unread', 'read'))`,
  `CREATE INDEX IF NOT EXISTS idx_notifications_user_status ON notifications (user_id, status, created_at DESC)`,
  `
    CREATE TABLE IF NOT EXISTS user_api_keys (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      key_hash TEXT NOT NULL UNIQUE,
      key_prefix TEXT NOT NULL,
      scope TEXT NOT NULL DEFAULT 'user',
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      last_used_at TIMESTAMPTZ,
      revoked_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    )
  `,
  `ALTER TABLE user_api_keys ADD COLUMN IF NOT EXISTS user_id TEXT`,
  `ALTER TABLE user_api_keys ADD COLUMN IF NOT EXISTS name TEXT`,
  `ALTER TABLE user_api_keys ADD COLUMN IF NOT EXISTS key_hash TEXT`,
  `ALTER TABLE user_api_keys ADD COLUMN IF NOT EXISTS key_prefix TEXT`,
  `ALTER TABLE user_api_keys ADD COLUMN IF NOT EXISTS scope TEXT NOT NULL DEFAULT 'user'`,
  `ALTER TABLE user_api_keys ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE`,
  `ALTER TABLE user_api_keys ADD COLUMN IF NOT EXISTS last_used_at TIMESTAMPTZ`,
  `ALTER TABLE user_api_keys ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ`,
  `ALTER TABLE user_api_keys ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP`,
  `ALTER TABLE user_api_keys ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP`,
  `UPDATE user_api_keys SET scope = 'user' WHERE scope IS NULL OR BTRIM(scope) = ''`,
  `UPDATE user_api_keys SET is_active = TRUE WHERE is_active IS NULL`,
  `ALTER TABLE user_api_keys ALTER COLUMN user_id SET NOT NULL`,
  `ALTER TABLE user_api_keys ALTER COLUMN name SET NOT NULL`,
  `ALTER TABLE user_api_keys ALTER COLUMN key_hash SET NOT NULL`,
  `ALTER TABLE user_api_keys ALTER COLUMN key_prefix SET NOT NULL`,
  `ALTER TABLE user_api_keys ALTER COLUMN scope SET DEFAULT 'user'`,
  `ALTER TABLE user_api_keys ALTER COLUMN scope SET NOT NULL`,
  `ALTER TABLE user_api_keys ALTER COLUMN is_active SET DEFAULT TRUE`,
  `ALTER TABLE user_api_keys ALTER COLUMN is_active SET NOT NULL`,
  `ALTER TABLE user_api_keys DROP CONSTRAINT IF EXISTS user_api_keys_scope_check`,
  `ALTER TABLE user_api_keys ADD CONSTRAINT user_api_keys_scope_check CHECK (scope IN ('user', 'read', 'design', 'automation', 'runs', 'environment', 'integrations', 'admin'))`,
  `ALTER TABLE user_api_keys DROP CONSTRAINT IF EXISTS user_api_keys_user_id_fkey`,
  `ALTER TABLE user_api_keys ADD CONSTRAINT user_api_keys_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_user_api_keys_hash_unique ON user_api_keys (key_hash)`,
  `CREATE INDEX IF NOT EXISTS idx_user_api_keys_user_active ON user_api_keys (user_id, is_active, created_at DESC)`,
  `
    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value JSONB NOT NULL DEFAULT '{}'::jsonb,
      updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    )
  `,
  `ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS value JSONB NOT NULL DEFAULT '{}'::jsonb`,
  `ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP`,
  `
    INSERT INTO app_settings (key, value, updated_at)
    SELECT
      'workspace_governed_preference:ai_metric_formula_values',
      value,
      COALESCE(updated_at, CURRENT_TIMESTAMP)
    FROM app_settings
    WHERE key = 'workspace_metric_formula_values'
    ON CONFLICT (key) DO NOTHING
  `,
  `
    WITH governed_preferences (preference_key) AS (
      VALUES
        ('ai_prompt_registry_overrides'),
        ('ai_prompt_registry_llm_overrides'),
        ('ai_metric_criteria_overrides'),
        ('ai_metric_formula_values')
    ),
    ranked_legacy_preferences AS (
      SELECT
        governed_preferences.preference_key,
        legacy_setting.value -> governed_preferences.preference_key AS preference_value,
        COALESCE(legacy_setting.updated_at, CURRENT_TIMESTAMP) AS preference_updated_at,
        ROW_NUMBER() OVER (
          PARTITION BY governed_preferences.preference_key
          ORDER BY legacy_setting.updated_at DESC NULLS LAST, legacy_setting.key ASC
        ) AS preference_rank
      FROM governed_preferences
      JOIN app_settings AS legacy_setting
        ON LEFT(legacy_setting.key, LENGTH('workspace_preferences:')) = 'workspace_preferences:'
        AND jsonb_typeof(legacy_setting.value) = 'object'
        AND jsonb_exists(legacy_setting.value, governed_preferences.preference_key)
    )
    INSERT INTO app_settings (key, value, updated_at)
    SELECT
      'workspace_governed_preference:' || preference_key,
      preference_value,
      preference_updated_at
    FROM ranked_legacy_preferences
    WHERE preference_rank = 1
    ON CONFLICT (key) DO NOTHING
  `,
  `
    UPDATE app_settings
    SET
      value = value
        - 'ai_prompt_registry_overrides'
        - 'ai_prompt_registry_llm_overrides'
        - 'ai_metric_criteria_overrides'
        - 'ai_metric_formula_values',
      updated_at = CURRENT_TIMESTAMP
    WHERE LEFT(key, LENGTH('workspace_preferences:')) = 'workspace_preferences:'
      AND jsonb_typeof(value) = 'object'
      AND (
        value ? 'ai_prompt_registry_overrides'
        OR value ? 'ai_prompt_registry_llm_overrides'
        OR value ? 'ai_metric_criteria_overrides'
        OR value ? 'ai_metric_formula_values'
      )
  `,
  `
    CREATE TABLE IF NOT EXISTS admin_audit_log (
      id TEXT PRIMARY KEY,
      actor_id TEXT,
      action TEXT NOT NULL,
      target_type TEXT,
      target_id TEXT,
      summary TEXT NOT NULL,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      ip_address TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `,
  `CREATE INDEX IF NOT EXISTS idx_admin_audit_log_created ON admin_audit_log (created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_admin_audit_log_actor ON admin_audit_log (actor_id, created_at DESC)`,
  `ALTER TABLE projects ADD COLUMN IF NOT EXISTS display_id TEXT`,
  `ALTER TABLE projects ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'public'`,
  `UPDATE projects SET visibility = 'public' WHERE visibility IS NULL OR visibility NOT IN ('private', 'public')`,
  `ALTER TABLE projects ALTER COLUMN visibility SET DEFAULT 'public'`,
  `ALTER TABLE projects ALTER COLUMN visibility SET NOT NULL`,
  `
    CREATE TABLE IF NOT EXISTS project_favorites (
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (project_id, user_id)
    )
  `,
  `CREATE INDEX IF NOT EXISTS idx_project_favorites_user_created ON project_favorites (user_id, created_at DESC)`,
  `ALTER TABLE requirements ADD COLUMN IF NOT EXISTS display_id TEXT`,
  `ALTER TABLE test_cases ADD COLUMN IF NOT EXISTS display_id TEXT`,
  `ALTER TABLE test_suites ADD COLUMN IF NOT EXISTS display_id TEXT`,
  `ALTER TABLE shared_step_groups ADD COLUMN IF NOT EXISTS display_id TEXT`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_display_id_unique ON projects (display_id) WHERE display_id IS NOT NULL`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_requirements_display_id_unique ON requirements (display_id) WHERE display_id IS NOT NULL`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_test_cases_display_id_unique ON test_cases (display_id) WHERE display_id IS NOT NULL`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_test_suites_display_id_unique ON test_suites (display_id) WHERE display_id IS NOT NULL`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_shared_step_groups_display_id_unique ON shared_step_groups (display_id) WHERE display_id IS NOT NULL`,
  `
    WITH existing AS (
      SELECT COALESCE(MAX(NULLIF(regexp_replace(display_id, '[^0-9]', '', 'g'), '')::NUMERIC), 0) AS max_sequence
      FROM projects
      WHERE display_id IS NOT NULL
    ), numbered AS (
      SELECT id, ROW_NUMBER() OVER (ORDER BY created_at ASC NULLS LAST, id ASC) AS seq
      FROM projects
      WHERE display_id IS NULL
    )
    UPDATE projects
    SET display_id = 'PROJ-' || (existing.max_sequence + numbered.seq)
    FROM numbered, existing
    WHERE projects.id = numbered.id
  `,
  `
    WITH existing AS (
      SELECT COALESCE(MAX(NULLIF(regexp_replace(display_id, '[^0-9]', '', 'g'), '')::NUMERIC), 0) AS max_sequence
      FROM requirements
      WHERE display_id IS NOT NULL
    ), numbered AS (
      SELECT id, ROW_NUMBER() OVER (ORDER BY created_at ASC NULLS LAST, id ASC) AS seq
      FROM requirements
      WHERE display_id IS NULL
    )
    UPDATE requirements
    SET display_id = 'RC_' || (existing.max_sequence + numbered.seq)
    FROM numbered, existing
    WHERE requirements.id = numbered.id
  `,
  `
    WITH existing AS (
      SELECT COALESCE(MAX(NULLIF(regexp_replace(display_id, '[^0-9]', '', 'g'), '')::NUMERIC), 0) AS max_sequence
      FROM test_cases
      WHERE display_id IS NOT NULL
    ), numbered AS (
      SELECT id, ROW_NUMBER() OVER (ORDER BY created_at ASC NULLS LAST, id ASC) AS seq
      FROM test_cases
      WHERE display_id IS NULL
    )
    UPDATE test_cases
    SET display_id = 'TC_' || (existing.max_sequence + numbered.seq)
    FROM numbered, existing
    WHERE test_cases.id = numbered.id
  `,
  `
    WITH existing AS (
      SELECT COALESCE(MAX(NULLIF(regexp_replace(display_id, '[^0-9]', '', 'g'), '')::NUMERIC), 0) AS max_sequence
      FROM test_suites
      WHERE display_id IS NOT NULL
    ), numbered AS (
      SELECT id, ROW_NUMBER() OVER (ORDER BY created_at ASC NULLS LAST, id ASC) AS seq
      FROM test_suites
      WHERE display_id IS NULL
    )
    UPDATE test_suites
    SET display_id = 'TS-' || (existing.max_sequence + numbered.seq)
    FROM numbered, existing
    WHERE test_suites.id = numbered.id
  `,
  `
    WITH existing AS (
      SELECT COALESCE(MAX(NULLIF(regexp_replace(display_id, '[^0-9]', '', 'g'), '')::NUMERIC), 0) AS max_sequence
      FROM shared_step_groups
      WHERE display_id IS NOT NULL
    ), numbered AS (
      SELECT id, ROW_NUMBER() OVER (ORDER BY created_at ASC NULLS LAST, id ASC) AS seq
      FROM shared_step_groups
      WHERE display_id IS NULL
    )
    UPDATE shared_step_groups
    SET display_id = 'SG-' || (existing.max_sequence + numbered.seq)
    FROM numbered, existing
    WHERE shared_step_groups.id = numbered.id
  `,
  `
    CREATE TABLE IF NOT EXISTS attachments (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      bucket_name TEXT NOT NULL,
      object_name TEXT NOT NULL UNIQUE,
      file_name TEXT NOT NULL,
      mime_type TEXT NOT NULL DEFAULT 'application/octet-stream',
      size_bytes BIGINT NOT NULL DEFAULT 0,
      stored_size_bytes BIGINT NOT NULL DEFAULT 0,
      compression TEXT NOT NULL DEFAULT 'none',
      etag TEXT,
      checksum_sha256 TEXT,
      created_by TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
    )
  `,
  `CREATE INDEX IF NOT EXISTS idx_attachments_entity ON attachments (entity_type, entity_id, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_attachments_project ON attachments (project_id, created_at DESC)`,
  `ALTER TABLE attachments ADD COLUMN IF NOT EXISTS stored_size_bytes BIGINT NOT NULL DEFAULT 0`,
  `ALTER TABLE attachments ADD COLUMN IF NOT EXISTS compression TEXT NOT NULL DEFAULT 'none'`,
  `
    CREATE TABLE IF NOT EXISTS entity_comments (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      body TEXT NOT NULL,
      created_by TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
    )
  `,
  `CREATE INDEX IF NOT EXISTS idx_entity_comments_entity ON entity_comments (entity_type, entity_id, created_at ASC)`,
  `
    CREATE TABLE IF NOT EXISTS test_case_versions (
      id TEXT PRIMARY KEY,
      test_case_id TEXT NOT NULL,
      revision INTEGER NOT NULL,
      snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
      change_summary TEXT,
      created_by TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (test_case_id) REFERENCES test_cases(id) ON DELETE CASCADE,
      FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
      UNIQUE (test_case_id, revision)
    )
  `,
  `CREATE INDEX IF NOT EXISTS idx_test_case_versions_case ON test_case_versions (test_case_id, revision DESC)`,
  `
    CREATE TABLE IF NOT EXISTS quality_dashboards (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      layout TEXT NOT NULL DEFAULT 'two-column',
      gadgets JSONB NOT NULL DEFAULT '[]'::jsonb,
      is_default BOOLEAN NOT NULL DEFAULT FALSE,
      created_by TEXT,
      updated_by TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
      FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
    )
  `,
  `CREATE INDEX IF NOT EXISTS idx_quality_dashboards_project ON quality_dashboards (project_id, updated_at DESC)`,
  `
    CREATE TABLE IF NOT EXISTS ai_requirement_generation_jobs (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'queued',
      input_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      result_payload JSONB,
      last_error TEXT,
      attempts INTEGER NOT NULL DEFAULT 0,
      lease_owner TEXT,
      lease_expires_at TIMESTAMPTZ,
      heartbeat_at TIMESTAMPTZ,
      created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      started_at TIMESTAMPTZ,
      completed_at TIMESTAMPTZ,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `,
  `ALTER TABLE ai_requirement_generation_jobs ADD COLUMN IF NOT EXISTS attempts INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE ai_requirement_generation_jobs ADD COLUMN IF NOT EXISTS lease_owner TEXT`,
  `ALTER TABLE ai_requirement_generation_jobs ADD COLUMN IF NOT EXISTS lease_expires_at TIMESTAMPTZ`,
  `ALTER TABLE ai_requirement_generation_jobs ADD COLUMN IF NOT EXISTS heartbeat_at TIMESTAMPTZ`,
  `UPDATE ai_requirement_generation_jobs SET attempts = 0 WHERE attempts IS NULL`,
  `ALTER TABLE ai_requirement_generation_jobs ALTER COLUMN attempts SET DEFAULT 0`,
  `ALTER TABLE ai_requirement_generation_jobs ALTER COLUMN attempts SET NOT NULL`,
  `ALTER TABLE ai_requirement_generation_jobs DROP CONSTRAINT IF EXISTS ai_requirement_generation_jobs_status_check`,
  `ALTER TABLE ai_requirement_generation_jobs ADD CONSTRAINT ai_requirement_generation_jobs_status_check CHECK (status IN ('queued', 'running', 'completed', 'failed'))`,
  `CREATE INDEX IF NOT EXISTS idx_ai_requirement_generation_jobs_project ON ai_requirement_generation_jobs (project_id, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_ai_requirement_generation_jobs_queue ON ai_requirement_generation_jobs (status, lease_expires_at, created_at ASC)`,
  `ALTER TABLE execution_results ADD COLUMN IF NOT EXISTS step_defects JSONB NOT NULL DEFAULT '{}'::jsonb`,
  `ALTER TABLE execution_results ADD COLUMN IF NOT EXISTS case_defects JSONB`,
  `
    UPDATE execution_results AS execution_result
    SET case_defects = COALESCE((
      SELECT jsonb_agg(remaining.defect_id ORDER BY remaining.defect_id)
      FROM (
        SELECT DISTINCT defect_value.value AS defect_id
        FROM jsonb_array_elements_text(COALESCE(execution_result.defects, '[]'::jsonb)) AS defect_value(value)
        WHERE NOT EXISTS (
          SELECT 1
          FROM jsonb_each(COALESCE(execution_result.step_defects, '{}'::jsonb)) AS step_entry
          CROSS JOIN LATERAL jsonb_array_elements_text(step_entry.value) AS step_value(value)
          WHERE step_value.value = defect_value.value
        )
      ) AS remaining
    ), '[]'::jsonb)
    WHERE execution_result.case_defects IS NULL
  `,
  `ALTER TABLE execution_results ALTER COLUMN case_defects SET DEFAULT '[]'::jsonb`,
  `ALTER TABLE execution_results ALTER COLUMN case_defects SET NOT NULL`,
  `ALTER TABLE execution_results ADD COLUMN IF NOT EXISTS revision INTEGER NOT NULL DEFAULT 1`,
  `CREATE INDEX IF NOT EXISTS idx_requirements_catalog_cursor ON requirements (project_id, (COALESCE(updated_at, created_at)) DESC NULLS LAST, created_at DESC NULLS LAST, id DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_requirements_iteration_cursor ON requirements (project_id, iteration_id, (COALESCE(updated_at, created_at)) DESC NULLS LAST, created_at DESC NULLS LAST, id DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_test_cases_catalog_cursor ON test_cases (app_type_id, (COALESCE(updated_at, created_at)) DESC NULLS LAST, id DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_feedback_catalog_cursor ON feedback (project_id, created_at DESC NULLS LAST, id DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_test_case_module_cases_cursor ON test_case_module_cases (module_id, sort_order, test_case_id)`,
  `CREATE INDEX IF NOT EXISTS idx_execution_results_case_latest ON execution_results (test_case_id, created_at DESC, id DESC) INCLUDE (status, duration_ms)`,
  rebrandJsonColumn("integrations", "config"),
  rebrandJsonColumn("app_settings", "value"),
  rebrandJsonColumn("quality_dashboards", "gadgets"),
  ...require('./projectDeletionGuardSchema'),
  ...require('./requirementBacklogHistorySchema'),
  ...require('./releaseRelationsSchema'),
  ...require('./sharedStepMetricsSchema'),
  ...require('./sharedStepDataSchema')
];

const executeStatements = () => db.transaction(async () => {
  // PostgreSQL DDL is transactional. The advisory transaction lock prevents
  // horizontally scaled API replicas from racing the same compatibility
  // migration while retaining an all-or-nothing schema outcome.
  await db.query("SET LOCAL lock_timeout = '60s'");
  await db.query("SELECT pg_advisory_xact_lock(hashtext(?))", [SCHEMA_LOCK_KEY]);
  for (const statement of statements) {
    await db.query(statement);
  }
  await ensureSetupRoles();
  await require("./schemaReadiness").recordSchema(db, "main");
})();

const ensureRuntimeSchema = async () => {
  if (!bootstrapPromise) {
    bootstrapPromise = executeStatements().catch((error) => {
      bootstrapPromise = null;
      throw error;
    });
  }
  return bootstrapPromise;
};

const reapplyRuntimeSchema = executeStatements;

module.exports = {
  ensureRuntimeSchema,
  reapplyRuntimeSchema
};
