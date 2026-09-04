-- =========================
-- USERS & ROLES
-- =========================

CREATE TABLE roles (
  id TEXT PRIMARY KEY,
  name TEXT UNIQUE NOT NULL
);

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  name TEXT,
  avatar_data_url TEXT,
  is_workspace_admin BOOLEAN NOT NULL DEFAULT FALSE,
  default_role_id TEXT REFERENCES roles(id),
  auth_provider TEXT NOT NULL DEFAULT 'local',
  google_sub TEXT UNIQUE,
  email_verified BOOLEAN NOT NULL DEFAULT FALSE,
  username TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  must_change_password BOOLEAN NOT NULL DEFAULT FALSE,
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX idx_users_username_unique
  ON users (LOWER(username)) WHERE username IS NOT NULL;

ALTER TABLE users ADD COLUMN IF NOT EXISTS default_role_id TEXT REFERENCES roles(id);

CREATE TABLE password_reset_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE(user_id)
);

-- =========================
-- PROJECTS & ACCESS
-- =========================

CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  display_id TEXT UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  visibility TEXT NOT NULL DEFAULT 'public' CHECK (visibility IN ('private', 'public')),
  created_by TEXT,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (created_by) REFERENCES users(id)
);

CREATE TABLE project_members (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role_id TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (project_id) REFERENCES projects(id),
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (role_id) REFERENCES roles(id),
  UNIQUE(project_id, user_id)
);

CREATE INDEX idx_project_members_project_user
  ON project_members (project_id, user_id);

CREATE TABLE project_favorites (
  project_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (project_id, user_id),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX idx_project_favorites_user_created
  ON project_favorites (user_id, created_at DESC);

CREATE TABLE permissions (
  id TEXT PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE role_permissions (
  role_id TEXT NOT NULL,
  permission_id TEXT NOT NULL,
  PRIMARY KEY (role_id, permission_id),
  FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE,
  FOREIGN KEY (permission_id) REFERENCES permissions(id) ON DELETE CASCADE
);

CREATE INDEX idx_role_permissions_permission
  ON role_permissions (permission_id);

-- =========================
-- APP TYPES (DESIGN BOUNDARY)
-- =========================

CREATE TABLE app_types (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  name TEXT NOT NULL,
  type TEXT CHECK(type IN ('web','api','android','ios','unified')),
  is_unified BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (project_id) REFERENCES projects(id)
);

-- =========================
-- AI KNOWLEDGE REPO
-- =========================

CREATE TABLE ai_knowledge_repo (
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
  content_type TEXT NOT NULL DEFAULT 'text' CHECK(content_type IN ('text', 'url', 'video_url', 'file', 'pdf', 'image', 'markdown')),
  content TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  linked_test_cases JSONB NOT NULL DEFAULT '[]'::jsonb,
  embedding JSONB,
  source_uri TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (project_id) REFERENCES projects(id),
  FOREIGN KEY (app_type_id) REFERENCES app_types(id)
);

CREATE INDEX idx_ai_knowledge_repo_scope
  ON ai_knowledge_repo (project_id, app_type_id, is_active, created_at DESC);
CREATE INDEX idx_ai_knowledge_repo_asset_type
  ON ai_knowledge_repo (project_id, asset_type, item_status, is_active);
CREATE INDEX idx_ai_knowledge_repo_module_feature
  ON ai_knowledge_repo (project_id, module_name, feature_name, is_active);
CREATE INDEX idx_ai_knowledge_repo_source
  ON ai_knowledge_repo (project_id, source, is_active);
CREATE INDEX idx_ai_knowledge_repo_priority
  ON ai_knowledge_repo (project_id, priority, is_active);
CREATE INDEX idx_ai_knowledge_repo_linked_test_cases
  ON ai_knowledge_repo USING GIN (linked_test_cases);

CREATE TABLE ai_knowledge_relations (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  source_id TEXT NOT NULL,
  source_type TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  relation_type TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_ai_knowledge_relations_source
  ON ai_knowledge_relations (project_id, source_id, source_type);
CREATE INDEX idx_ai_knowledge_relations_target
  ON ai_knowledge_relations (project_id, target_id, target_type);

-- Knowledge RAG uses PostgreSQL as the durable source of truth. pgvector is
-- enabled when the extension is installed and this database role is allowed
-- to create it; JSONB embeddings plus PostgreSQL full-text search remain a
-- deploy-safe fallback when it is not available.
DO $$
BEGIN
  BEGIN
    CREATE EXTENSION IF NOT EXISTS vector;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'pgvector is unavailable; HelloTest will use JSONB cosine and PostgreSQL full-text search';
  END;
END $$;

CREATE TABLE ai_knowledge_collections (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  app_type_id TEXT REFERENCES app_types(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  description TEXT,
  color TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'archived')),
  retrieval_config JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_ai_knowledge_collections_project
  ON ai_knowledge_collections (project_id, status, updated_at DESC);

CREATE TABLE ai_knowledge_sources (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  app_type_id TEXT REFERENCES app_types(id) ON DELETE SET NULL,
  app_scope_key TEXT NOT NULL DEFAULT '',
  source_kind TEXT NOT NULL CHECK(source_kind IN ('requirement', 'test_case', 'execution', 'bug', 'knowledge_item', 'text', 'chat', 'file', 'url')),
  source_ref_id TEXT,
  title TEXT NOT NULL,
  source_uri TEXT,
  file_name TEXT,
  mime_type TEXT,
  size_bytes BIGINT,
  attachment_id TEXT,
  checksum_sha256 TEXT,
  revision_token TEXT NOT NULL,
  required_permission TEXT CHECK(required_permission IS NULL OR required_permission IN ('requirement.view', 'testcase.view', 'run.view', 'feedback.view')),
  extraction_status TEXT NOT NULL DEFAULT 'pending' CHECK(extraction_status IN ('pending', 'processing', 'ready', 'needs_extraction', 'failed', 'archived')),
  extraction_strategy TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  risk_flags JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_ai_knowledge_sources_project
  ON ai_knowledge_sources (project_id, extraction_status, updated_at DESC);
CREATE INDEX idx_ai_knowledge_sources_reference
  ON ai_knowledge_sources (project_id, source_kind, source_ref_id);
CREATE UNIQUE INDEX idx_ai_knowledge_sources_stable_reference
  ON ai_knowledge_sources (project_id, source_kind, source_ref_id)
  WHERE source_ref_id IS NOT NULL;
CREATE UNIQUE INDEX idx_ai_knowledge_sources_content_hash
  ON ai_knowledge_sources (project_id, app_scope_key, source_kind, checksum_sha256)
  WHERE source_ref_id IS NULL AND checksum_sha256 IS NOT NULL;

CREATE TABLE ai_knowledge_documents (
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
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT ai_knowledge_documents_source_version_key UNIQUE(source_id, version)
);

CREATE INDEX idx_ai_knowledge_documents_source
  ON ai_knowledge_documents (project_id, source_id, is_active, updated_at DESC);
CREATE UNIQUE INDEX idx_ai_knowledge_documents_one_active_source
  ON ai_knowledge_documents (source_id) WHERE is_active = TRUE;

CREATE TABLE ai_knowledge_chunks (
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
);

CREATE INDEX idx_ai_knowledge_chunks_project
  ON ai_knowledge_chunks (project_id, created_at DESC);
CREATE INDEX idx_ai_knowledge_chunks_search
  ON ai_knowledge_chunks USING GIN (search_vector);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector') THEN
    ALTER TABLE ai_knowledge_chunks ADD COLUMN IF NOT EXISTS embedding_vector vector;
  END IF;
END $$;

CREATE TABLE ai_knowledge_collection_sources (
  collection_id TEXT NOT NULL REFERENCES ai_knowledge_collections(id) ON DELETE CASCADE,
  source_id TEXT NOT NULL REFERENCES ai_knowledge_sources(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (collection_id, source_id)
);

CREATE INDEX idx_ai_knowledge_collection_sources_source
  ON ai_knowledge_collection_sources (source_id, collection_id);

CREATE TABLE ai_knowledge_ingestion_jobs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  collection_id TEXT REFERENCES ai_knowledge_collections(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued', 'running', 'completed', 'completed_with_warnings', 'failed')),
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
);

CREATE INDEX idx_ai_knowledge_ingestion_jobs_project
  ON ai_knowledge_ingestion_jobs (project_id, created_at DESC);
CREATE UNIQUE INDEX idx_ai_knowledge_ingestion_jobs_idempotency
  ON ai_knowledge_ingestion_jobs (project_id, created_by, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE TABLE ai_knowledge_ingestion_inputs (
  job_id TEXT NOT NULL REFERENCES ai_knowledge_ingestion_jobs(id) ON DELETE CASCADE,
  input_index INTEGER NOT NULL,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (job_id, input_index)
);

-- Durable, data-minimized provenance remains after transient queued payloads are scrubbed.
CREATE TABLE ai_knowledge_ingestion_results (
  job_id TEXT NOT NULL REFERENCES ai_knowledge_ingestion_jobs(id) ON DELETE CASCADE,
  input_index INTEGER NOT NULL,
  source_id TEXT REFERENCES ai_knowledge_sources(id) ON DELETE SET NULL,
  document_id TEXT REFERENCES ai_knowledge_documents(id) ON DELETE SET NULL,
  outcome TEXT NOT NULL CHECK(outcome IN ('indexed', 'reused', 'needs_extraction', 'failed')),
  reused BOOLEAN NOT NULL DEFAULT FALSE,
  warning_codes JSONB NOT NULL DEFAULT '[]'::jsonb,
  error_fingerprint TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (job_id, input_index)
);

CREATE INDEX idx_ai_knowledge_ingestion_results_source
  ON ai_knowledge_ingestion_results (source_id, job_id);

-- Legacy Knowledge CRUD writes only this transactional outbox marker. Embedding and
-- chunking are performed by the leased background worker after the mutation commits.
CREATE TABLE ai_knowledge_sync_outbox (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  source_ref_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK(action IN ('upsert', 'archive')),
  status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued', 'running', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  requested_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  lease_owner TEXT,
  lease_expires_at TIMESTAMPTZ,
  error_fingerprint TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(project_id, source_ref_id)
);

CREATE INDEX idx_ai_knowledge_sync_outbox_queue
  ON ai_knowledge_sync_outbox (status, created_at ASC);

CREATE TABLE ai_knowledge_assistant_sessions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  app_type_id TEXT REFERENCES app_types(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'archived')),
  filters JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_ai_knowledge_assistant_sessions_project
  ON ai_knowledge_assistant_sessions (project_id, created_by, updated_at DESC);

CREATE TABLE ai_knowledge_assistant_messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES ai_knowledge_assistant_sessions(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK(role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'answered' CHECK(status IN ('pending', 'answered', 'insufficient_context', 'refused', 'provider_unavailable', 'error')),
  citations JSONB NOT NULL DEFAULT '[]'::jsonb,
  retrieval JSONB NOT NULL DEFAULT '{}'::jsonb,
  safety JSONB NOT NULL DEFAULT '{}'::jsonb,
  provider TEXT,
  model TEXT,
  client_turn_id TEXT,
  content_fingerprint TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_ai_knowledge_assistant_messages_session
  ON ai_knowledge_assistant_messages (session_id, created_at ASC);
CREATE UNIQUE INDEX idx_ai_knowledge_assistant_messages_turn_role
  ON ai_knowledge_assistant_messages (session_id, client_turn_id, role)
  WHERE client_turn_id IS NOT NULL;

-- =========================
-- REQUIREMENTS
-- =========================

CREATE TABLE requirements (
  id TEXT PRIMARY KEY,
  display_id TEXT UNIQUE,
  project_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  gherkin_scenarios JSONB NOT NULL DEFAULT '[]'::jsonb,
  additional_fields JSONB NOT NULL DEFAULT '{}'::jsonb,
  ai_review JSONB,
  external_references JSONB NOT NULL DEFAULT '[]'::jsonb,
  labels JSONB NOT NULL DEFAULT '[]'::jsonb,
  sprint TEXT,
  fix_version TEXT,
  release TEXT,
  iteration_id TEXT,
  dev_completion_target_date TIMESTAMPTZ,
  qa_completion_target_date TIMESTAMPTZ,
  scrum_team TEXT,
  specification_format TEXT NOT NULL DEFAULT 'gherkin' CHECK (specification_format IN ('gherkin', 'speckit')),
  specification_content TEXT,
  revision INTEGER NOT NULL DEFAULT 1,
  priority INTEGER DEFAULT 3,
  status TEXT,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (project_id) REFERENCES projects(id)
);

CREATE TABLE feedback (
  id TEXT PRIMARY KEY,
  display_id TEXT UNIQUE,
  project_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  steps_to_reproduce TEXT,
  expected_result TEXT,
  actual_result TEXT,
  severity TEXT,
  priority TEXT,
  environment TEXT,
  build TEXT,
  jira_bug_key TEXT,
  linked_test_run_id TEXT,
  linked_test_case_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  linked_test_suite_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  linked_module_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  linked_requirement_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  labels JSONB NOT NULL DEFAULT '[]'::jsonb,
  sprint TEXT,
  fix_version TEXT,
  release TEXT,
  assignee_id TEXT,
  root_cause TEXT,
  bug_type TEXT,
  regression BOOLEAN NOT NULL DEFAULT FALSE,
  retest_result TEXT,
  status TEXT DEFAULT 'open',
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (assignee_id) REFERENCES users(id) ON DELETE SET NULL
);

ALTER TABLE feedback ADD COLUMN IF NOT EXISTS steps_to_reproduce TEXT;
ALTER TABLE feedback ADD COLUMN IF NOT EXISTS display_id TEXT;
ALTER TABLE feedback ADD COLUMN IF NOT EXISTS expected_result TEXT;
ALTER TABLE feedback ADD COLUMN IF NOT EXISTS actual_result TEXT;
ALTER TABLE feedback ADD COLUMN IF NOT EXISTS severity TEXT;
ALTER TABLE feedback ADD COLUMN IF NOT EXISTS priority TEXT;
ALTER TABLE feedback ADD COLUMN IF NOT EXISTS environment TEXT;
ALTER TABLE feedback ADD COLUMN IF NOT EXISTS build TEXT;
ALTER TABLE feedback ADD COLUMN IF NOT EXISTS jira_bug_key TEXT;
ALTER TABLE feedback ADD COLUMN IF NOT EXISTS linked_test_run_id TEXT;
ALTER TABLE feedback ADD COLUMN IF NOT EXISTS project_id TEXT;
ALTER TABLE feedback ADD COLUMN IF NOT EXISTS linked_test_case_ids JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE feedback ADD COLUMN IF NOT EXISTS linked_test_suite_ids JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE feedback ADD COLUMN IF NOT EXISTS linked_module_ids JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE feedback ADD COLUMN IF NOT EXISTS linked_requirement_ids JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE feedback ADD COLUMN IF NOT EXISTS labels JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE feedback ADD COLUMN IF NOT EXISTS sprint TEXT;
ALTER TABLE feedback ADD COLUMN IF NOT EXISTS fix_version TEXT;
ALTER TABLE feedback ADD COLUMN IF NOT EXISTS release TEXT;
ALTER TABLE feedback ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP;
CREATE UNIQUE INDEX IF NOT EXISTS idx_feedback_display_id ON feedback (display_id) WHERE display_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS requirement_iterations (
  id TEXT PRIMARY KEY,
  display_id TEXT UNIQUE,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  goal TEXT,
  labels JSONB NOT NULL DEFAULT '[]'::jsonb,
  external_references JSONB NOT NULL DEFAULT '[]'::jsonb,
  state TEXT NOT NULL DEFAULT 'future' CHECK (state IN ('future', 'active', 'closed')),
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
);

-- Native Story-to-Sprint scope is persisted by id. The Sprint table is
-- declared after Stories, so install the referential contract here rather
-- than on the initial requirements declaration.
ALTER TABLE requirements ADD COLUMN IF NOT EXISTS iteration_id TEXT;
UPDATE requirements
SET iteration_id = NULL
WHERE iteration_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM requirement_iterations
    WHERE requirement_iterations.id = requirements.iteration_id
  );
ALTER TABLE requirements DROP CONSTRAINT IF EXISTS requirements_iteration_id_fkey;
ALTER TABLE requirements
  ADD CONSTRAINT requirements_iteration_id_fkey
  FOREIGN KEY (iteration_id) REFERENCES requirement_iterations(id) ON DELETE SET NULL;

ALTER TABLE requirement_iterations ADD COLUMN IF NOT EXISTS goal TEXT;
ALTER TABLE requirement_iterations ADD COLUMN IF NOT EXISTS labels JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE requirement_iterations ADD COLUMN IF NOT EXISTS external_references JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE requirement_iterations ADD COLUMN IF NOT EXISTS state TEXT NOT NULL DEFAULT 'future';
ALTER TABLE requirement_iterations ADD COLUMN IF NOT EXISTS start_date TIMESTAMPTZ;
ALTER TABLE requirement_iterations ADD COLUMN IF NOT EXISTS end_date TIMESTAMPTZ;
ALTER TABLE requirement_iterations ADD COLUMN IF NOT EXISTS assignee_id TEXT;
ALTER TABLE requirement_iterations ADD COLUMN IF NOT EXISTS effort_points INTEGER;
ALTER TABLE requirement_iterations ADD COLUMN IF NOT EXISTS original_dev_id TEXT;
ALTER TABLE requirement_iterations ADD COLUMN IF NOT EXISTS original_qa_id TEXT;
ALTER TABLE feedback ADD COLUMN IF NOT EXISTS assignee_id TEXT;
ALTER TABLE feedback ADD COLUMN IF NOT EXISTS root_cause TEXT;
ALTER TABLE feedback ADD COLUMN IF NOT EXISTS bug_type TEXT;
ALTER TABLE feedback ADD COLUMN IF NOT EXISTS regression BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE feedback ADD COLUMN IF NOT EXISTS retest_result TEXT;

CREATE TABLE requirement_defects (
  requirement_id TEXT NOT NULL,
  issue_id TEXT NOT NULL,
  link_source TEXT NOT NULL DEFAULT 'manual' CHECK(link_source IN ('manual','automatic')),
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (requirement_id, issue_id),
  FOREIGN KEY (requirement_id) REFERENCES requirements(id) ON DELETE CASCADE,
  FOREIGN KEY (issue_id) REFERENCES feedback(id) ON DELETE CASCADE
);

CREATE TABLE integrations (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK(type IN ('llm','jira','email','google_auth','google_drive','github','testengine','local-desktop','cloudrun','ops')),
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
);

CREATE TABLE auth_verification_codes (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  purpose TEXT NOT NULL CHECK(purpose IN ('signup','password_reset')),
  code_hash TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_auth_verification_codes_lookup
  ON auth_verification_codes (email, purpose, created_at DESC);

-- =========================
-- TEST DESIGN
-- =========================

CREATE TABLE test_suites (
  id TEXT PRIMARY KEY,
  display_id TEXT UNIQUE,
  app_type_id TEXT NOT NULL,
  name TEXT NOT NULL,
  parent_id TEXT,
  labels JSONB NOT NULL DEFAULT '[]'::jsonb,
  revision INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (app_type_id) REFERENCES app_types(id),
  FOREIGN KEY (parent_id) REFERENCES test_suites(id)
);

CREATE TABLE test_cases (
  id TEXT PRIMARY KEY,
  display_id TEXT UNIQUE,
  app_type_id TEXT,
  suite_id TEXT,
  title TEXT NOT NULL,
  description TEXT,
  external_references JSONB NOT NULL DEFAULT '[]'::jsonb,
  labels JSONB NOT NULL DEFAULT '[]'::jsonb,
  parameter_values JSONB NOT NULL DEFAULT '{}'::jsonb,
  automated TEXT NOT NULL DEFAULT 'no' CHECK(automated IN ('yes','no')),
  automation_status TEXT NOT NULL DEFAULT 'not_automated' CHECK(automation_status IN ('not_automated','ready','incomplete')),
  manual_test_case_id TEXT,
  authoring_mode TEXT NOT NULL DEFAULT 'structured' CHECK(authoring_mode IN ('structured','gherkin')),
  test_case_type TEXT NOT NULL DEFAULT 'functional' CHECK(test_case_type IN ('functional','regression','smoke','integration','acceptance','exploratory','performance','security','accessibility','ios')),
  gherkin_document TEXT,
  priority INTEGER DEFAULT 3,
  status TEXT DEFAULT 'active',
  requirement_id TEXT,
  reviewer_id TEXT,
  review_status TEXT NOT NULL DEFAULT 'not_requested' CHECK(review_status IN ('not_requested','pending','accepted','changes_requested')),
  review_history JSONB NOT NULL DEFAULT '[]'::jsonb,
  ai_quality_score INTEGER CHECK(ai_quality_score IS NULL OR (ai_quality_score >= 0 AND ai_quality_score <= 100)),
  author_id TEXT,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (app_type_id) REFERENCES app_types(id),
  FOREIGN KEY (suite_id) REFERENCES test_suites(id),
  FOREIGN KEY (requirement_id) REFERENCES requirements(id),
  FOREIGN KEY (manual_test_case_id) REFERENCES test_cases(id) ON DELETE SET NULL,
  FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE automation_case_links (
  automation_test_case_id TEXT NOT NULL,
  manual_test_case_id TEXT NOT NULL,
  is_primary BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (automation_test_case_id, manual_test_case_id),
  FOREIGN KEY (automation_test_case_id) REFERENCES test_cases(id) ON DELETE CASCADE,
  FOREIGN KEY (manual_test_case_id) REFERENCES test_cases(id) ON DELETE CASCADE,
  CHECK (automation_test_case_id <> manual_test_case_id)
);

CREATE INDEX idx_automation_case_links_manual
  ON automation_case_links (manual_test_case_id, automation_test_case_id);
CREATE UNIQUE INDEX idx_automation_case_links_primary
  ON automation_case_links (automation_test_case_id)
  WHERE is_primary;

CREATE TABLE requirement_test_cases (
  requirement_id TEXT NOT NULL,
  test_case_id TEXT NOT NULL,
  PRIMARY KEY (requirement_id, test_case_id),
  FOREIGN KEY (requirement_id) REFERENCES requirements(id) ON DELETE CASCADE,
  FOREIGN KEY (test_case_id) REFERENCES test_cases(id) ON DELETE CASCADE
);

CREATE TABLE suite_test_cases (
  suite_id TEXT NOT NULL,
  test_case_id TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (suite_id, test_case_id),
  FOREIGN KEY (suite_id) REFERENCES test_suites(id) ON DELETE CASCADE,
  FOREIGN KEY (test_case_id) REFERENCES test_cases(id) ON DELETE CASCADE
);

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
);

CREATE TABLE IF NOT EXISTS test_case_module_cases (
  module_id TEXT NOT NULL REFERENCES test_case_modules(id) ON DELETE CASCADE,
  test_case_id TEXT NOT NULL REFERENCES test_cases(id) ON DELETE CASCADE,
  sort_order INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (module_id, test_case_id)
);

CREATE TABLE IF NOT EXISTS test_case_module_requirements (
  module_id TEXT NOT NULL REFERENCES test_case_modules(id) ON DELETE CASCADE,
  requirement_id TEXT NOT NULL REFERENCES requirements(id) ON DELETE CASCADE,
  sort_order INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (module_id, requirement_id)
);

CREATE INDEX IF NOT EXISTS idx_test_case_module_requirements_module_sort
  ON test_case_module_requirements (module_id, sort_order, requirement_id);

CREATE TABLE IF NOT EXISTS test_case_defects (
  test_case_id TEXT NOT NULL REFERENCES test_cases(id) ON DELETE CASCADE,
  issue_id TEXT NOT NULL REFERENCES feedback(id) ON DELETE CASCADE,
  link_source TEXT NOT NULL DEFAULT 'manual' CHECK(link_source IN ('manual', 'automatic')),
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (test_case_id, issue_id)
);

CREATE TABLE test_steps (
  id TEXT PRIMARY KEY,
  test_case_id TEXT NOT NULL,
  step_order INTEGER NOT NULL,
  action TEXT,
  expected_result TEXT,
  step_type TEXT,
  automation_code TEXT,
  api_request JSONB,
  group_id TEXT,
  group_name TEXT,
  group_kind TEXT,
  reusable_group_id TEXT,
  FOREIGN KEY (test_case_id) REFERENCES test_cases(id)
);

CREATE TABLE shared_step_groups (
  id TEXT PRIMARY KEY,
  display_id TEXT UNIQUE,
  app_type_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  authoring_mode TEXT NOT NULL DEFAULT 'structured' CHECK(authoring_mode IN ('structured', 'gherkin')),
  gherkin_document TEXT,
  steps JSONB NOT NULL DEFAULT '[]'::jsonb,
  parameter_values JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (app_type_id) REFERENCES app_types(id) ON DELETE CASCADE
);

CREATE INDEX idx_shared_step_groups_app_type
  ON shared_step_groups (app_type_id, updated_at DESC);

CREATE INDEX idx_test_steps_case_group
  ON test_steps (test_case_id, group_id, step_order);

CREATE TABLE test_environments (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  app_type_id TEXT,
  name TEXT NOT NULL,
  description TEXT,
  base_url TEXT,
  browser TEXT,
  notes TEXT,
  variables JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (app_type_id) REFERENCES app_types(id) ON DELETE CASCADE
);

CREATE INDEX idx_test_environments_project_scope
  ON test_environments (project_id, app_type_id);

CREATE TABLE test_configurations (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  app_type_id TEXT,
  name TEXT NOT NULL,
  description TEXT,
  browser TEXT,
  mobile_os TEXT,
  platform_version TEXT,
  targets JSONB NOT NULL DEFAULT '[]'::jsonb CONSTRAINT test_configurations_targets_array_check CHECK (jsonb_typeof(targets) = 'array'),
  variables JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (app_type_id) REFERENCES app_types(id) ON DELETE CASCADE
);

CREATE INDEX idx_test_configurations_project_scope
  ON test_configurations (project_id, app_type_id);

CREATE TABLE test_data_sets (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  app_type_id TEXT,
  name TEXT NOT NULL,
  description TEXT,
  mode TEXT NOT NULL CHECK(mode IN ('key_value', 'table')),
  columns JSONB NOT NULL DEFAULT '[]'::jsonb,
  rows JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (app_type_id) REFERENCES app_types(id) ON DELETE CASCADE
);

CREATE INDEX idx_test_data_sets_project_scope
  ON test_data_sets (project_id, app_type_id);

CREATE TABLE test_case_data_sets (
  test_case_id TEXT NOT NULL,
  test_data_set_id TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (test_case_id, test_data_set_id),
  FOREIGN KEY (test_case_id) REFERENCES test_cases(id) ON DELETE CASCADE,
  FOREIGN KEY (test_data_set_id) REFERENCES test_data_sets(id) ON DELETE CASCADE
);

CREATE TABLE test_case_data_set_link_archive (
  test_case_id TEXT NOT NULL,
  test_data_set_id TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 1,
  original_created_at TIMESTAMPTZ,
  archived_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  archive_reason TEXT NOT NULL DEFAULT 'single-data-set-enforcement',
  PRIMARY KEY (test_case_id, test_data_set_id)
);

CREATE INDEX idx_test_case_data_sets_case_order
  ON test_case_data_sets (test_case_id, sort_order, test_data_set_id);

CREATE UNIQUE INDEX idx_test_case_data_sets_one_per_case
  ON test_case_data_sets (test_case_id);

-- =========================
-- EXECUTION
-- =========================

CREATE TABLE executions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  app_type_id TEXT,
  name TEXT,
  trigger TEXT CHECK(trigger IN ('manual','ci','local')),
  status TEXT CHECK(status IN ('queued','running','passed','failed','skipped','blocked','retrying','cancelled','aborted','partially_completed','completed')),
  execution_mode TEXT NOT NULL DEFAULT 'remote' CHECK(execution_mode IN ('local','remote','scheduled')),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  worker_id TEXT,
  duration_ms INTEGER,
  test_environment_id TEXT,
  test_environment_name TEXT,
  test_environment_snapshot JSONB,
  test_configuration_id TEXT,
  test_configuration_name TEXT,
  test_configuration_snapshot JSONB,
  test_data_set_id TEXT,
  test_data_set_name TEXT,
  test_data_set_snapshot JSONB,
  release TEXT,
  sprint TEXT,
  build TEXT,
  assigned_to TEXT,
  assigned_to_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  suite_assignments JSONB NOT NULL DEFAULT '{}'::jsonb,
  module_assignments JSONB NOT NULL DEFAULT '{}'::jsonb,
  case_assignments JSONB NOT NULL DEFAULT '{}'::jsonb,
  execution_hooks JSONB NOT NULL DEFAULT '[]'::jsonb,
  source_idempotency_key TEXT,
  revision INTEGER NOT NULL DEFAULT 1,
  created_by TEXT,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  started_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  FOREIGN KEY (project_id) REFERENCES projects(id),
  FOREIGN KEY (app_type_id) REFERENCES app_types(id),
  FOREIGN KEY (created_by) REFERENCES users(id)
);

CREATE TABLE execution_suites (
  execution_id TEXT NOT NULL,
  suite_id TEXT NOT NULL,
  suite_name TEXT,
  PRIMARY KEY (execution_id, suite_id),
  FOREIGN KEY (execution_id) REFERENCES executions(id) ON DELETE CASCADE
);

CREATE INDEX idx_execution_suites_execution_suite
  ON execution_suites (execution_id, suite_id);

CREATE TABLE execution_case_snapshots (
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
  parameter_template_values JSONB NOT NULL DEFAULT '{}'::jsonb,
  suite_parameter_values JSONB NOT NULL DEFAULT '{}'::jsonb,
  suite_parameter_template_values JSONB NOT NULL DEFAULT '{}'::jsonb,
  test_data_set_id TEXT,
  test_data_set_name TEXT,
  test_data_set_snapshot JSONB,
  data_set_source TEXT CHECK(data_set_source IS NULL OR data_set_source IN ('run','test_case')),
  sort_order INTEGER NOT NULL DEFAULT 1,
  assigned_to TEXT,
  assigned_to_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  assignment_source TEXT CHECK(assignment_source IN ('run','suite','module','case')),
  PRIMARY KEY (execution_id, test_case_id),
  FOREIGN KEY (execution_id) REFERENCES executions(id) ON DELETE CASCADE
);

CREATE TABLE execution_step_snapshots (
  execution_id TEXT NOT NULL,
  test_case_id TEXT NOT NULL,
  snapshot_step_id TEXT NOT NULL,
  step_order INTEGER NOT NULL,
  action TEXT,
  expected_result TEXT,
  step_type TEXT,
  automation_code TEXT,
  api_request JSONB,
  group_id TEXT,
  group_name TEXT,
  group_kind TEXT,
  reusable_group_id TEXT,
  PRIMARY KEY (execution_id, snapshot_step_id),
  FOREIGN KEY (execution_id) REFERENCES executions(id) ON DELETE CASCADE
);

CREATE INDEX idx_execution_case_snapshots_execution_id
  ON execution_case_snapshots (execution_id, sort_order);

CREATE INDEX idx_execution_step_snapshots_execution_case
  ON execution_step_snapshots (execution_id, test_case_id, step_order);

CREATE TABLE execution_results (
  id TEXT PRIMARY KEY,
  execution_id TEXT NOT NULL,
  test_case_id TEXT NOT NULL,
  test_case_title TEXT,
  suite_id TEXT,
  suite_name TEXT,
  app_type_id TEXT NOT NULL,
  status TEXT CHECK(status IN ('running','passed','failed','blocked')),
  duration_ms INTEGER,
  error TEXT,
  logs TEXT,
  test_data_set_id TEXT,
  test_data_set_name TEXT,
  data_set_iteration_index INTEGER,
  data_set_iteration_key TEXT,
  data_set_row_snapshot JSONB,
  external_references JSONB NOT NULL DEFAULT '[]'::jsonb,
  defects JSONB NOT NULL DEFAULT '[]'::jsonb,
  step_defects JSONB NOT NULL DEFAULT '{}'::jsonb,
  case_defects JSONB NOT NULL DEFAULT '[]'::jsonb,
  revision INTEGER NOT NULL DEFAULT 1,
  executed_by TEXT,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (execution_id) REFERENCES executions(id),
  FOREIGN KEY (app_type_id) REFERENCES app_types(id),
  FOREIGN KEY (executed_by) REFERENCES users(id)
);

CREATE TABLE suite_runs (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  suite_id TEXT,
  parent_id TEXT,
  status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','running','passed','failed','skipped','blocked','retrying','cancelled','aborted','partially_completed')),
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  duration_ms INTEGER,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  worker_id TEXT,
  execution_mode TEXT NOT NULL DEFAULT 'remote' CHECK(execution_mode IN ('local','remote','scheduled')),
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (run_id) REFERENCES executions(id) ON DELETE CASCADE
);

CREATE INDEX idx_suite_runs_run
  ON suite_runs (run_id, status);

CREATE TABLE test_case_runs (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  suite_run_id TEXT,
  test_case_id TEXT,
  parent_id TEXT,
  status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','running','passed','failed','skipped','blocked','retrying','cancelled','aborted','partially_completed')),
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  duration_ms INTEGER,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  worker_id TEXT,
  execution_mode TEXT NOT NULL DEFAULT 'remote' CHECK(execution_mode IN ('local','remote','scheduled')),
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (run_id) REFERENCES executions(id) ON DELETE CASCADE,
  FOREIGN KEY (suite_run_id) REFERENCES suite_runs(id) ON DELETE CASCADE
);

CREATE INDEX idx_test_case_runs_suite
  ON test_case_runs (suite_run_id, status);

CREATE INDEX idx_test_case_runs_run_case
  ON test_case_runs (run_id, test_case_id);

CREATE TABLE step_runs (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  test_case_run_id TEXT,
  step_id TEXT,
  parent_id TEXT,
  status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','running','passed','failed','skipped','blocked','retrying','cancelled','aborted','partially_completed')),
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  duration_ms INTEGER,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  worker_id TEXT,
  execution_mode TEXT NOT NULL DEFAULT 'remote' CHECK(execution_mode IN ('local','remote','scheduled')),
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (run_id) REFERENCES executions(id) ON DELETE CASCADE,
  FOREIGN KEY (test_case_run_id) REFERENCES test_case_runs(id) ON DELETE CASCADE
);

CREATE INDEX idx_step_runs_case
  ON step_runs (test_case_run_id, status);

CREATE TABLE execution_capacity (
  engine_type TEXT PRIMARY KEY CHECK(engine_type IN ('api','web','android')),
  max_parallel INTEGER NOT NULL DEFAULT 1,
  current_running INTEGER NOT NULL DEFAULT 0,
  queued_count INTEGER NOT NULL DEFAULT 0,
  healthy_workers INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE worker_heartbeat (
  worker_id TEXT PRIMARY KEY,
  engine_type TEXT CHECK(engine_type IS NULL OR engine_type IN ('api','web','android')),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  current_job_id TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX idx_worker_heartbeat_seen
  ON worker_heartbeat (last_seen_at DESC);

CREATE TABLE notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  session_id TEXT,
  project_id TEXT,
  run_id TEXT,
  target_url TEXT,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'unread' CHECK(status IN ('unread','read')),
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (run_id) REFERENCES executions(id) ON DELETE CASCADE
);

CREATE INDEX idx_notifications_user_status
  ON notifications (user_id, status, created_at DESC);

CREATE TABLE workspace_transactions (
  id TEXT PRIMARY KEY,
  project_id TEXT,
  app_type_id TEXT,
  category TEXT NOT NULL,
  action TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('queued','running','completed','failed')),
  title TEXT NOT NULL,
  description TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  related_kind TEXT,
  related_id TEXT,
  created_by TEXT,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (app_type_id) REFERENCES app_types(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(id)
);

CREATE INDEX idx_workspace_transactions_scope
  ON workspace_transactions (project_id, app_type_id, created_at DESC);

CREATE TABLE app_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE admin_audit_log (
  id TEXT PRIMARY KEY,
  actor_id TEXT,
  action TEXT NOT NULL,
  target_type TEXT,
  target_id TEXT,
  summary TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  ip_address TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_admin_audit_log_created
  ON admin_audit_log (created_at DESC);

-- =========================
-- LATEST RUNTIME CONTRACT
-- =========================

ALTER TABLE integrations DROP CONSTRAINT IF EXISTS integrations_type_check;
ALTER TABLE integrations
  ADD CONSTRAINT integrations_type_check
  CHECK (type IN ('llm', 'jira', 'email', 'google_auth', 'google_drive', 'github', 'testengine', 'ops'));

CREATE INDEX IF NOT EXISTS idx_integrations_type_active
  ON integrations (type, is_active);

ALTER TABLE requirements ADD COLUMN IF NOT EXISTS created_by TEXT;
ALTER TABLE requirements ADD COLUMN IF NOT EXISTS updated_by TEXT;
ALTER TABLE requirements ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE requirements ADD COLUMN IF NOT EXISTS gherkin_scenarios JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE requirements ADD COLUMN IF NOT EXISTS additional_fields JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE requirements ADD COLUMN IF NOT EXISTS ai_review JSONB;
ALTER TABLE requirements ADD COLUMN IF NOT EXISTS external_references JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE requirements ADD COLUMN IF NOT EXISTS labels JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE requirements ADD COLUMN IF NOT EXISTS sprint TEXT;
ALTER TABLE requirements ADD COLUMN IF NOT EXISTS fix_version TEXT;
ALTER TABLE requirements ADD COLUMN IF NOT EXISTS release TEXT;
ALTER TABLE requirements ADD COLUMN IF NOT EXISTS dev_completion_target_date TIMESTAMPTZ;
ALTER TABLE requirements ADD COLUMN IF NOT EXISTS qa_completion_target_date TIMESTAMPTZ;
ALTER TABLE requirements ADD COLUMN IF NOT EXISTS scrum_team TEXT;
ALTER TABLE requirements ADD COLUMN IF NOT EXISTS specification_format TEXT NOT NULL DEFAULT 'gherkin';
ALTER TABLE requirements ADD COLUMN IF NOT EXISTS specification_content TEXT;
ALTER TABLE requirements ADD COLUMN IF NOT EXISTS revision INTEGER NOT NULL DEFAULT 1;
CREATE INDEX IF NOT EXISTS idx_requirements_iteration
  ON requirements (iteration_id, updated_at DESC);

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
  state TEXT NOT NULL DEFAULT 'planned' CHECK (state IN ('planned', 'in_progress', 'released')),
  sprint_ids JSONB NOT NULL DEFAULT '[]'::jsonb
    CONSTRAINT requirement_releases_sprint_ids_array_check CHECK (jsonb_typeof(sprint_ids) = 'array'),
  created_by TEXT,
  updated_by TEXT,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS requirement_release_items (
  release_id TEXT NOT NULL REFERENCES requirement_releases(id) ON DELETE CASCADE,
  requirement_id TEXT NOT NULL REFERENCES requirements(id) ON DELETE CASCADE,
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'sprint')),
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (release_id, requirement_id)
);

CREATE INDEX IF NOT EXISTS idx_requirement_releases_project
  ON requirement_releases (project_id, target_date, updated_at DESC);
ALTER TABLE requirement_releases ADD COLUMN IF NOT EXISTS plan_date TIMESTAMPTZ;
UPDATE requirement_releases
SET sprint_ids = '[]'::jsonb
WHERE sprint_ids IS NULL OR jsonb_typeof(sprint_ids) <> 'array';
ALTER TABLE requirement_releases DROP CONSTRAINT IF EXISTS requirement_releases_sprint_ids_array_check;
ALTER TABLE requirement_releases
  ADD CONSTRAINT requirement_releases_sprint_ids_array_check
  CHECK (jsonb_typeof(sprint_ids) = 'array');
CREATE INDEX IF NOT EXISTS idx_requirement_releases_sprint_ids
  ON requirement_releases USING GIN (sprint_ids);
CREATE INDEX IF NOT EXISTS idx_requirement_release_items_requirement
  ON requirement_release_items (requirement_id, release_id);

CREATE TABLE IF NOT EXISTS requirement_relations (
  requirement_id TEXT NOT NULL REFERENCES requirements(id) ON DELETE CASCADE,
  related_requirement_id TEXT NOT NULL REFERENCES requirements(id) ON DELETE CASCADE,
  relation TEXT NOT NULL DEFAULT 'relates to',
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (requirement_id, related_requirement_id),
  CHECK (requirement_id <> related_requirement_id)
);

CREATE INDEX IF NOT EXISTS idx_requirement_relations_reverse
  ON requirement_relations (related_requirement_id, requirement_id);

CREATE TABLE IF NOT EXISTS requirement_defects (
  requirement_id TEXT NOT NULL,
  issue_id TEXT NOT NULL,
  link_source TEXT NOT NULL DEFAULT 'manual' CHECK(link_source IN ('manual','automatic')),
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (requirement_id, issue_id),
  FOREIGN KEY (requirement_id) REFERENCES requirements(id) ON DELETE CASCADE,
  FOREIGN KEY (issue_id) REFERENCES feedback(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_requirement_defects_issue
  ON requirement_defects (issue_id);

ALTER TABLE test_suites ADD COLUMN IF NOT EXISTS parameter_values JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE test_suites ADD COLUMN IF NOT EXISTS labels JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE test_suites ADD COLUMN IF NOT EXISTS parallel_enabled BOOLEAN;
ALTER TABLE test_suites ADD COLUMN IF NOT EXISTS parallel_count INTEGER;
ALTER TABLE test_suites ADD COLUMN IF NOT EXISTS created_by TEXT;
ALTER TABLE test_suites ADD COLUMN IF NOT EXISTS updated_by TEXT;
ALTER TABLE test_suites ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE test_suites ADD COLUMN IF NOT EXISTS revision INTEGER NOT NULL DEFAULT 1;
UPDATE test_suites SET labels = '[]'::jsonb WHERE labels IS NULL;

ALTER TABLE test_cases ADD COLUMN IF NOT EXISTS ai_generation_source TEXT;
ALTER TABLE test_cases ADD COLUMN IF NOT EXISTS ai_generation_review_status TEXT;
ALTER TABLE test_cases ADD COLUMN IF NOT EXISTS ai_generation_job_id TEXT;
ALTER TABLE test_cases ADD COLUMN IF NOT EXISTS source_idempotency_key TEXT;
ALTER TABLE test_cases ADD COLUMN IF NOT EXISTS ai_generated_at TIMESTAMPTZ;
ALTER TABLE test_cases ADD COLUMN IF NOT EXISTS created_by TEXT;
ALTER TABLE test_cases ADD COLUMN IF NOT EXISTS author_id TEXT;
ALTER TABLE test_cases ADD COLUMN IF NOT EXISTS updated_by TEXT;
ALTER TABLE test_cases ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE test_cases ADD COLUMN IF NOT EXISTS external_references JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE test_cases ADD COLUMN IF NOT EXISTS labels JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE test_cases ADD COLUMN IF NOT EXISTS automation_status TEXT NOT NULL DEFAULT 'not_automated';
ALTER TABLE test_cases ADD COLUMN IF NOT EXISTS manual_test_case_id TEXT REFERENCES test_cases(id) ON DELETE SET NULL;
ALTER TABLE test_cases ADD COLUMN IF NOT EXISTS authoring_mode TEXT NOT NULL DEFAULT 'structured';
ALTER TABLE test_cases ADD COLUMN IF NOT EXISTS gherkin_document TEXT;
ALTER TABLE test_cases ADD COLUMN IF NOT EXISTS reviewer_id TEXT;
ALTER TABLE test_cases ADD COLUMN IF NOT EXISTS review_status TEXT NOT NULL DEFAULT 'not_requested';
ALTER TABLE test_cases ADD COLUMN IF NOT EXISTS review_history JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE test_cases ADD COLUMN IF NOT EXISTS ai_quality_score INTEGER;
CREATE UNIQUE INDEX IF NOT EXISTS idx_test_cases_source_idempotency
  ON test_cases (app_type_id, source_idempotency_key)
  WHERE source_idempotency_key IS NOT NULL;

UPDATE test_cases SET author_id = created_by WHERE author_id IS NULL AND created_by IS NOT NULL;
UPDATE test_cases
SET author_id = NULL
WHERE author_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM users WHERE users.id = test_cases.author_id);
ALTER TABLE test_cases DROP CONSTRAINT IF EXISTS test_cases_author_id_fkey;
ALTER TABLE test_cases
  ADD CONSTRAINT test_cases_author_id_fkey
  FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE SET NULL;
UPDATE test_cases SET labels = '[]'::jsonb WHERE labels IS NULL;
UPDATE test_cases SET review_status = 'not_requested' WHERE review_status IS NULL OR BTRIM(review_status) = '';
UPDATE test_cases SET review_history = '[]'::jsonb WHERE review_history IS NULL;

UPDATE test_cases
SET automation_status = CASE
  WHEN automated = 'yes' AND automation_status = 'not_automated' THEN 'ready'
  WHEN automated <> 'yes' THEN 'not_automated'
  ELSE automation_status
END;

ALTER TABLE test_cases DROP CONSTRAINT IF EXISTS test_cases_automated_check;
ALTER TABLE test_cases
  ADD CONSTRAINT test_cases_automated_check
  CHECK (automated IN ('yes', 'no'));

ALTER TABLE test_cases DROP CONSTRAINT IF EXISTS test_cases_automation_status_check;
ALTER TABLE test_cases
  ADD CONSTRAINT test_cases_automation_status_check
  CHECK (automation_status IN ('not_automated', 'ready', 'incomplete'));

ALTER TABLE test_cases DROP CONSTRAINT IF EXISTS test_cases_authoring_mode_check;
ALTER TABLE test_cases
  ADD CONSTRAINT test_cases_authoring_mode_check
  CHECK (authoring_mode IN ('structured', 'gherkin'));

DROP INDEX IF EXISTS idx_test_cases_one_automation_per_manual;

CREATE TABLE IF NOT EXISTS automation_case_links (
  automation_test_case_id TEXT NOT NULL REFERENCES test_cases(id) ON DELETE CASCADE,
  manual_test_case_id TEXT NOT NULL REFERENCES test_cases(id) ON DELETE CASCADE,
  is_primary BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (automation_test_case_id, manual_test_case_id),
  CHECK (automation_test_case_id <> manual_test_case_id)
);
CREATE INDEX IF NOT EXISTS idx_automation_case_links_manual
  ON automation_case_links (manual_test_case_id, automation_test_case_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_automation_case_links_primary
  ON automation_case_links (automation_test_case_id)
  WHERE is_primary;
INSERT INTO automation_case_links (automation_test_case_id, manual_test_case_id, is_primary)
SELECT id, manual_test_case_id, TRUE
FROM test_cases
WHERE automated = 'yes' AND manual_test_case_id IS NOT NULL
ON CONFLICT (automation_test_case_id, manual_test_case_id) DO NOTHING;

ALTER TABLE test_cases DROP CONSTRAINT IF EXISTS test_cases_ai_generation_source_check;
ALTER TABLE test_cases
  ADD CONSTRAINT test_cases_ai_generation_source_check
  CHECK (ai_generation_source IS NULL OR ai_generation_source IN ('scheduler'));

ALTER TABLE test_cases DROP CONSTRAINT IF EXISTS test_cases_ai_generation_review_status_check;
ALTER TABLE test_cases
  ADD CONSTRAINT test_cases_ai_generation_review_status_check
  CHECK (ai_generation_review_status IS NULL OR ai_generation_review_status IN ('pending', 'accepted'));

ALTER TABLE test_cases DROP CONSTRAINT IF EXISTS test_cases_review_status_check;
ALTER TABLE test_cases
  ADD CONSTRAINT test_cases_review_status_check
  CHECK (review_status IN ('not_requested', 'pending', 'accepted', 'changes_requested'));

ALTER TABLE test_cases DROP CONSTRAINT IF EXISTS test_cases_ai_quality_score_check;
ALTER TABLE test_cases
  ADD CONSTRAINT test_cases_ai_quality_score_check
  CHECK (ai_quality_score IS NULL OR (ai_quality_score >= 0 AND ai_quality_score <= 100));

CREATE INDEX IF NOT EXISTS idx_test_cases_app_status_created
  ON test_cases (app_type_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_test_cases_ai_generation_review
  ON test_cases (app_type_id, ai_generation_source, ai_generation_review_status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_test_cases_reviewer_status
  ON test_cases (reviewer_id, review_status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_test_case_modules_app_type
  ON test_case_modules (app_type_id, updated_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_test_case_module_cases_case
  ON test_case_module_cases (test_case_id);

CREATE INDEX IF NOT EXISTS idx_test_case_module_cases_module_sort
  ON test_case_module_cases (module_id, sort_order);

CREATE INDEX IF NOT EXISTS idx_test_case_defects_issue
  ON test_case_defects (issue_id);

ALTER TABLE shared_step_groups ADD COLUMN IF NOT EXISTS created_by TEXT;
ALTER TABLE shared_step_groups ADD COLUMN IF NOT EXISTS updated_by TEXT;

ALTER TABLE executions
  ADD COLUMN IF NOT EXISTS assigned_to TEXT;
ALTER TABLE executions ADD COLUMN IF NOT EXISTS assigned_to_ids JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE executions ADD COLUMN IF NOT EXISTS suite_assignments JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE executions ADD COLUMN IF NOT EXISTS module_assignments JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE executions ADD COLUMN IF NOT EXISTS case_assignments JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE executions ADD COLUMN IF NOT EXISTS release TEXT;
ALTER TABLE executions ADD COLUMN IF NOT EXISTS sprint TEXT;
ALTER TABLE executions ADD COLUMN IF NOT EXISTS build TEXT;
ALTER TABLE executions ADD COLUMN IF NOT EXISTS execution_hooks JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE executions ADD COLUMN IF NOT EXISTS source_idempotency_key TEXT;
ALTER TABLE executions ADD COLUMN IF NOT EXISTS revision INTEGER NOT NULL DEFAULT 1;
CREATE UNIQUE INDEX IF NOT EXISTS idx_executions_source_idempotency
  ON executions (project_id, source_idempotency_key)
  WHERE source_idempotency_key IS NOT NULL;
UPDATE executions
SET assigned_to_ids = CASE
  WHEN assigned_to IS NULL OR BTRIM(assigned_to) = '' THEN '[]'::jsonb
  ELSE jsonb_build_array(assigned_to)
END
WHERE assigned_to_ids IS NULL OR assigned_to_ids = '[]'::jsonb;
ALTER TABLE executions ADD COLUMN IF NOT EXISTS parallel_enabled BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE executions ADD COLUMN IF NOT EXISTS parallel_count INTEGER NOT NULL DEFAULT 1;

ALTER TABLE executions DROP CONSTRAINT IF EXISTS executions_trigger_check;
ALTER TABLE executions
  ADD CONSTRAINT executions_trigger_check
  CHECK (trigger IN ('manual', 'ci', 'local'));

ALTER TABLE executions DROP CONSTRAINT IF EXISTS executions_status_check;
ALTER TABLE executions
  ADD CONSTRAINT executions_status_check
  CHECK (status IN ('queued', 'running', 'passed', 'failed', 'skipped', 'blocked', 'retrying', 'cancelled', 'aborted', 'partially_completed', 'completed'));

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
  created_by TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE execution_schedules ADD COLUMN IF NOT EXISTS release TEXT;
ALTER TABLE execution_schedules ADD COLUMN IF NOT EXISTS sprint TEXT;
ALTER TABLE execution_schedules ADD COLUMN IF NOT EXISTS build TEXT;
ALTER TABLE execution_schedules ADD COLUMN IF NOT EXISTS assigned_to_ids JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE execution_schedules ADD COLUMN IF NOT EXISTS lease_owner TEXT;
ALTER TABLE execution_schedules ADD COLUMN IF NOT EXISTS lease_expires_at TIMESTAMPTZ;
ALTER TABLE execution_schedules ADD COLUMN IF NOT EXISTS heartbeat_at TIMESTAMPTZ;
ALTER TABLE execution_schedules ADD COLUMN IF NOT EXISTS failure_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE execution_schedules ADD COLUMN IF NOT EXISTS last_error TEXT;
UPDATE execution_schedules
SET assigned_to_ids = CASE
  WHEN assigned_to IS NULL OR BTRIM(assigned_to) = '' THEN '[]'::jsonb
  ELSE jsonb_build_array(assigned_to)
END
WHERE assigned_to_ids IS NULL OR assigned_to_ids = '[]'::jsonb;

ALTER TABLE execution_schedules DROP CONSTRAINT IF EXISTS execution_schedules_cadence_check;
ALTER TABLE execution_schedules
  ADD CONSTRAINT execution_schedules_cadence_check
  CHECK (cadence IN ('once', 'daily', 'weekly', 'monthly'));

CREATE INDEX IF NOT EXISTS idx_execution_schedules_project_next_run
  ON execution_schedules (project_id, next_run_at ASC);
CREATE INDEX IF NOT EXISTS idx_execution_schedules_due_claim
  ON execution_schedules (is_active, next_run_at, lease_expires_at)
  WHERE is_active = TRUE AND next_run_at IS NOT NULL;

ALTER TABLE execution_case_snapshots ADD COLUMN IF NOT EXISTS suite_parameter_values JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE execution_case_snapshots ADD COLUMN IF NOT EXISTS parameter_template_values JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE execution_case_snapshots ADD COLUMN IF NOT EXISTS suite_parameter_template_values JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE execution_case_snapshots ADD COLUMN IF NOT EXISTS test_data_set_id TEXT;
ALTER TABLE execution_case_snapshots ADD COLUMN IF NOT EXISTS test_data_set_name TEXT;
ALTER TABLE execution_case_snapshots ADD COLUMN IF NOT EXISTS test_data_set_snapshot JSONB;
ALTER TABLE execution_case_snapshots ADD COLUMN IF NOT EXISTS data_set_source TEXT;
UPDATE execution_case_snapshots SET data_set_source = NULL WHERE data_set_source IS NOT NULL AND data_set_source NOT IN ('run', 'test_case');
ALTER TABLE execution_case_snapshots DROP CONSTRAINT IF EXISTS execution_case_snapshots_data_set_source_check;
ALTER TABLE execution_case_snapshots ADD CONSTRAINT execution_case_snapshots_data_set_source_check CHECK (data_set_source IS NULL OR data_set_source IN ('run', 'test_case'));
ALTER TABLE execution_case_snapshots ADD COLUMN IF NOT EXISTS assigned_to TEXT;
ALTER TABLE execution_case_snapshots ADD COLUMN IF NOT EXISTS assigned_to_ids JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE execution_case_snapshots ADD COLUMN IF NOT EXISTS assignment_source TEXT;
UPDATE execution_case_snapshots
SET assigned_to_ids = jsonb_build_array(assigned_to), assignment_source = COALESCE(assignment_source, 'run')
WHERE assigned_to IS NOT NULL AND BTRIM(assigned_to) <> '' AND assigned_to_ids = '[]'::jsonb;
ALTER TABLE execution_case_snapshots ADD COLUMN IF NOT EXISTS external_references JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE execution_case_snapshots ADD COLUMN IF NOT EXISTS module_id TEXT;
ALTER TABLE execution_case_snapshots ADD COLUMN IF NOT EXISTS module_name TEXT;

ALTER TABLE execution_results ADD COLUMN IF NOT EXISTS external_references JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE execution_results ADD COLUMN IF NOT EXISTS defects JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE execution_results ADD COLUMN IF NOT EXISTS step_defects JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE execution_results ADD COLUMN IF NOT EXISTS case_defects JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE execution_results ADD COLUMN IF NOT EXISTS revision INTEGER NOT NULL DEFAULT 1;
ALTER TABLE test_case_module_cases ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP;

CREATE INDEX IF NOT EXISTS idx_suite_test_cases_test_case_sort
  ON suite_test_cases (test_case_id, sort_order);

CREATE INDEX IF NOT EXISTS idx_requirement_test_cases_test_case
  ON requirement_test_cases (test_case_id);

CREATE INDEX IF NOT EXISTS idx_execution_results_execution_created_at
  ON execution_results (execution_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_execution_results_case_created_at
  ON execution_results (test_case_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_execution_results_app_type_created_at
  ON execution_results (app_type_id, created_at DESC);

CREATE TABLE IF NOT EXISTS test_engine_jobs (
  id TEXT PRIMARY KEY,
  engine_run_id TEXT NOT NULL UNIQUE,
  integration_id TEXT,
  project_id TEXT NOT NULL,
  app_type_id TEXT,
  app_type_kind TEXT NOT NULL DEFAULT 'web',
  engine_class TEXT NOT NULL DEFAULT 'web' CHECK (engine_class IN ('api', 'web', 'android')),
  engine_max_workers INTEGER NOT NULL DEFAULT 1,
  execution_id TEXT NOT NULL,
  test_case_id TEXT NOT NULL,
  test_case_title TEXT NOT NULL,
  transaction_id TEXT,
  engine_host TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  runtime_state JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'leased', 'running', 'completed', 'failed', 'aborted')),
  attempts INTEGER NOT NULL DEFAULT 0,
  leased_by TEXT,
  lease_expires_at TIMESTAMPTZ,
  heartbeat_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  last_error TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (app_type_id) REFERENCES app_types(id) ON DELETE CASCADE,
  FOREIGN KEY (execution_id) REFERENCES executions(id) ON DELETE CASCADE,
  FOREIGN KEY (test_case_id) REFERENCES test_cases(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_test_engine_jobs_queue
  ON test_engine_jobs (status, engine_class, app_type_kind, engine_host, created_at ASC);

CREATE INDEX IF NOT EXISTS idx_test_engine_jobs_execution_case
  ON test_engine_jobs (execution_id, test_case_id);

CREATE INDEX IF NOT EXISTS idx_test_engine_jobs_execution_created_at
  ON test_engine_jobs (execution_id, created_at DESC);

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
  created_by TEXT,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE ai_test_case_generation_jobs
  ADD COLUMN IF NOT EXISTS authoring_mode TEXT NOT NULL DEFAULT 'structured';
ALTER TABLE ai_test_case_generation_jobs ADD COLUMN IF NOT EXISTS idempotency_key TEXT;
ALTER TABLE ai_test_case_generation_jobs ADD COLUMN IF NOT EXISTS request_fingerprint TEXT;
ALTER TABLE ai_test_case_generation_jobs ADD COLUMN IF NOT EXISTS lease_owner TEXT;
ALTER TABLE ai_test_case_generation_jobs ADD COLUMN IF NOT EXISTS lease_expires_at TIMESTAMPTZ;
ALTER TABLE ai_test_case_generation_jobs ADD COLUMN IF NOT EXISTS heartbeat_at TIMESTAMPTZ;
UPDATE ai_test_case_generation_jobs
SET lease_expires_at = CURRENT_TIMESTAMP
WHERE status = 'running' AND lease_expires_at IS NULL;

ALTER TABLE ai_test_case_generation_jobs DROP CONSTRAINT IF EXISTS ai_test_case_generation_jobs_authoring_mode_check;
ALTER TABLE ai_test_case_generation_jobs
  ADD CONSTRAINT ai_test_case_generation_jobs_authoring_mode_check
  CHECK (authoring_mode IN ('structured', 'gherkin'));

ALTER TABLE ai_test_case_generation_jobs DROP CONSTRAINT IF EXISTS ai_test_case_generation_jobs_status_check;
ALTER TABLE ai_test_case_generation_jobs
  ADD CONSTRAINT ai_test_case_generation_jobs_status_check
  CHECK (status IN ('queued', 'running', 'completed', 'failed'));

CREATE INDEX IF NOT EXISTS idx_ai_test_case_generation_jobs_scope_status
  ON ai_test_case_generation_jobs (app_type_id, status, next_run_at, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_test_case_generation_jobs_project_created
  ON ai_test_case_generation_jobs (project_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_test_case_generation_jobs_queue_claim
  ON ai_test_case_generation_jobs (status, next_run_at, lease_expires_at, created_at ASC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_test_case_generation_jobs_idempotency
  ON ai_test_case_generation_jobs (project_id, created_by, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

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
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (app_type_id) REFERENCES app_types(id) ON DELETE CASCADE,
  FOREIGN KEY (test_case_id) REFERENCES test_cases(id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_automation_learning_cache_unique
  ON automation_learning_cache (app_type_id, page_key, locator_intent, locator);

CREATE INDEX IF NOT EXISTS idx_automation_learning_cache_scope
  ON automation_learning_cache (project_id, app_type_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_workspace_transactions_related
  ON workspace_transactions (related_kind, related_id, created_at DESC);

CREATE TABLE IF NOT EXISTS batch_process_jobs (
  id TEXT PRIMARY KEY,
  transaction_id TEXT NOT NULL UNIQUE,
  operation TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  result JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'completed', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  next_run_at TIMESTAMPTZ,
  lease_owner TEXT,
  lease_expires_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (transaction_id) REFERENCES workspace_transactions(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_batch_process_jobs_transaction
  ON batch_process_jobs (transaction_id);

CREATE INDEX IF NOT EXISTS idx_batch_process_jobs_queue
  ON batch_process_jobs (status, next_run_at, created_at ASC);

CREATE TABLE IF NOT EXISTS workspace_transaction_events (
  id TEXT PRIMARY KEY,
  transaction_id TEXT NOT NULL,
  level TEXT NOT NULL DEFAULT 'info',
  phase TEXT,
  message TEXT NOT NULL,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (transaction_id) REFERENCES workspace_transactions(id) ON DELETE CASCADE
);

ALTER TABLE workspace_transaction_events DROP CONSTRAINT IF EXISTS workspace_transaction_events_level_check;
ALTER TABLE workspace_transaction_events
  ADD CONSTRAINT workspace_transaction_events_level_check
  CHECK (level IN ('info', 'success', 'warning', 'error'));

CREATE INDEX IF NOT EXISTS idx_workspace_transaction_events_lookup
  ON workspace_transaction_events (transaction_id, created_at ASC);

CREATE TABLE IF NOT EXISTS workspace_transaction_artifacts (
  id TEXT PRIMARY KEY,
  transaction_id TEXT NOT NULL,
  file_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (transaction_id) REFERENCES workspace_transactions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_workspace_transaction_artifacts_lookup
  ON workspace_transaction_artifacts (transaction_id, created_at DESC);

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
);

CREATE INDEX IF NOT EXISTS idx_attachments_entity
  ON attachments (entity_type, entity_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_attachments_project
  ON attachments (project_id, created_at DESC);

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
);

CREATE INDEX IF NOT EXISTS idx_entity_comments_entity
  ON entity_comments (entity_type, entity_id, created_at ASC);

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
);

CREATE INDEX IF NOT EXISTS idx_test_case_versions_case
  ON test_case_versions (test_case_id, revision DESC);

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
);

CREATE INDEX IF NOT EXISTS idx_quality_dashboards_project
  ON quality_dashboards (project_id, updated_at DESC);

-- =========================
-- AI WORKSPACES & DURABLE JOBS
-- =========================

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
);

CREATE INDEX IF NOT EXISTS idx_ai_prompt_templates_scope
  ON ai_prompt_templates (project_id, app_type_id, scope, is_active, updated_at DESC);

CREATE TABLE IF NOT EXISTS agentic_workflows (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  app_type_id TEXT,
  name TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'paused', 'archived')),
  trigger_kind TEXT NOT NULL DEFAULT 'manual',
  nodes JSONB NOT NULL DEFAULT '[]'::jsonb,
  edges JSONB NOT NULL DEFAULT '[]'::jsonb,
  settings JSONB NOT NULL DEFAULT '{}'::jsonb,
  n8n_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by TEXT,
  updated_by TEXT,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_agentic_workflows_scope
  ON agentic_workflows (project_id, app_type_id, status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_agentic_workflows_created_by
  ON agentic_workflows (project_id, created_by, created_at DESC);

CREATE TABLE IF NOT EXISTS agentic_workflow_runs (
  id TEXT PRIMARY KEY,
  workflow_id TEXT,
  project_id TEXT NOT NULL,
  app_type_id TEXT,
  workflow_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'completed', 'failed', 'aborted')),
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
);

CREATE INDEX IF NOT EXISTS idx_agentic_workflow_runs_scope
  ON agentic_workflow_runs (project_id, app_type_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_agentic_workflow_runs_workflow
  ON agentic_workflow_runs (workflow_id, created_at DESC);

CREATE TABLE IF NOT EXISTS automation_generator_jobs (
  id TEXT PRIMARY KEY,
  transaction_id TEXT NOT NULL UNIQUE,
  project_id TEXT,
  app_type_id TEXT,
  test_case_id TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  runtime_state JSONB NOT NULL DEFAULT '{}'::jsonb,
  result JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'leased', 'running', 'completed', 'failed', 'cancelled')),
  attempts INTEGER NOT NULL DEFAULT 0,
  leased_by TEXT,
  lease_expires_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  last_error TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_automation_generator_jobs_transaction
  ON automation_generator_jobs (transaction_id);

CREATE INDEX IF NOT EXISTS idx_automation_generator_jobs_queue
  ON automation_generator_jobs (status, lease_expires_at, created_at ASC);

CREATE INDEX IF NOT EXISTS idx_automation_generator_jobs_case
  ON automation_generator_jobs (test_case_id, created_at DESC);

CREATE TABLE IF NOT EXISTS user_api_keys (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE,
  key_prefix TEXT NOT NULL,
  scope TEXT NOT NULL DEFAULT 'user' CHECK (scope IN ('user', 'read', 'design', 'automation', 'runs', 'environment', 'integrations', 'admin')),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  last_used_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_api_keys_hash_unique
  ON user_api_keys (key_hash);

CREATE INDEX IF NOT EXISTS idx_user_api_keys_user_active
  ON user_api_keys (user_id, is_active, created_at DESC);

CREATE TABLE IF NOT EXISTS ai_requirement_generation_jobs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'completed', 'failed')),
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
);

CREATE INDEX IF NOT EXISTS idx_ai_requirement_generation_jobs_project
  ON ai_requirement_generation_jobs (project_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_requirement_generation_jobs_queue
  ON ai_requirement_generation_jobs (status, lease_expires_at, created_at ASC);
