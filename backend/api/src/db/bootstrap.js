const db = require("./index");
const {
  INTEGRATION_TYPE_VALUES
} = require("../domain/catalog");

let bootstrapPromise = null;

const sqlEnum = (values) => values.map((value) => `'${String(value).replace(/'/g, "''")}'`).join(", ");

const statements = [
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
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS auth_provider TEXT NOT NULL DEFAULT 'local'`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS google_sub TEXT`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified BOOLEAN NOT NULL DEFAULT FALSE`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_data_url TEXT`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS is_workspace_admin BOOLEAN NOT NULL DEFAULT FALSE`,
  `UPDATE users SET auth_provider = 'local' WHERE auth_provider IS NULL OR TRIM(auth_provider) = ''`,
  `
    UPDATE users
    SET is_workspace_admin = TRUE
    WHERE COALESCE(is_workspace_admin, FALSE) = FALSE
      AND EXISTS (
        SELECT 1
        FROM project_members
        JOIN roles ON roles.id = project_members.role_id
        WHERE project_members.user_id = users.id
          AND LOWER(roles.name) = 'admin'
      )
  `,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_users_google_sub_unique ON users (google_sub) WHERE google_sub IS NOT NULL`,
  `ALTER TABLE feedback DROP CONSTRAINT IF EXISTS feedback_user_id_fkey`,
  `ALTER TABLE feedback ADD CONSTRAINT feedback_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE`,
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
  `ALTER TABLE test_configurations ADD COLUMN IF NOT EXISTS variables JSONB NOT NULL DEFAULT '[]'::jsonb`,
  `ALTER TABLE test_configurations ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP`,
  `CREATE INDEX IF NOT EXISTS idx_test_configurations_project_scope ON test_configurations (project_id, app_type_id)`,
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
  `ALTER TABLE executions ADD COLUMN IF NOT EXISTS execution_hooks JSONB NOT NULL DEFAULT '[]'::jsonb`,
  `ALTER TABLE executions ADD COLUMN IF NOT EXISTS parallel_enabled BOOLEAN NOT NULL DEFAULT FALSE`,
  `ALTER TABLE executions ADD COLUMN IF NOT EXISTS parallel_count INTEGER NOT NULL DEFAULT 1`,
  `ALTER TABLE executions ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP`,
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
      assigned_to TEXT,
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
  `ALTER TABLE execution_schedules ADD COLUMN IF NOT EXISTS assigned_to TEXT`,
  `ALTER TABLE execution_schedules ADD COLUMN IF NOT EXISTS created_by TEXT`,
  `ALTER TABLE execution_schedules ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE`,
  `ALTER TABLE execution_schedules ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP`,
  `ALTER TABLE execution_schedules ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP`,
  `ALTER TABLE requirements ADD COLUMN IF NOT EXISTS created_by TEXT`,
  `ALTER TABLE requirements ADD COLUMN IF NOT EXISTS updated_by TEXT`,
  `ALTER TABLE requirements ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP`,
  `ALTER TABLE requirements ADD COLUMN IF NOT EXISTS external_references JSONB`,
  `UPDATE requirements SET external_references = '[]'::jsonb WHERE external_references IS NULL`,
  `ALTER TABLE requirements ALTER COLUMN external_references SET DEFAULT '[]'::jsonb`,
  `ALTER TABLE requirements ALTER COLUMN external_references SET NOT NULL`,
  `UPDATE requirements SET updated_at = COALESCE(updated_at, created_at, CURRENT_TIMESTAMP)`,
  `ALTER TABLE test_suites ADD COLUMN IF NOT EXISTS created_by TEXT`,
  `ALTER TABLE test_suites ADD COLUMN IF NOT EXISTS updated_by TEXT`,
  `ALTER TABLE test_suites ADD COLUMN IF NOT EXISTS parameter_values JSONB`,
  `ALTER TABLE test_suites ADD COLUMN IF NOT EXISTS parallel_enabled BOOLEAN`,
  `ALTER TABLE test_suites ADD COLUMN IF NOT EXISTS parallel_count INTEGER`,
  `UPDATE test_suites SET parameter_values = '{}'::jsonb WHERE parameter_values IS NULL`,
  `ALTER TABLE test_suites ALTER COLUMN parameter_values SET DEFAULT '{}'::jsonb`,
  `ALTER TABLE test_suites ALTER COLUMN parameter_values SET NOT NULL`,
  `ALTER TABLE test_suites ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP`,
  `UPDATE test_suites SET updated_at = COALESCE(updated_at, created_at, CURRENT_TIMESTAMP)`,
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
      status TEXT NOT NULL DEFAULT 'queued',
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
  `ALTER TABLE ai_test_case_generation_jobs ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'queued'`,
  `ALTER TABLE ai_test_case_generation_jobs ADD COLUMN IF NOT EXISTS total_requirements INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE ai_test_case_generation_jobs ADD COLUMN IF NOT EXISTS processed_requirements INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE ai_test_case_generation_jobs ADD COLUMN IF NOT EXISTS generated_cases_count INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE ai_test_case_generation_jobs ADD COLUMN IF NOT EXISTS error TEXT`,
  `ALTER TABLE ai_test_case_generation_jobs ADD COLUMN IF NOT EXISTS created_by TEXT`,
  `ALTER TABLE ai_test_case_generation_jobs ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP`,
  `ALTER TABLE ai_test_case_generation_jobs ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ`,
  `ALTER TABLE ai_test_case_generation_jobs ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ`,
  `ALTER TABLE ai_test_case_generation_jobs ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP`,
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
      priority INTEGER,
      status TEXT,
      parameter_values JSONB NOT NULL DEFAULT '{}'::jsonb,
      suite_parameter_values JSONB NOT NULL DEFAULT '{}'::jsonb,
      sort_order INTEGER NOT NULL DEFAULT 1,
      assigned_to TEXT,
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
  `ALTER TABLE execution_case_snapshots ADD COLUMN IF NOT EXISTS assigned_to TEXT`,
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
      steps JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    )
  `,
  `ALTER TABLE shared_step_groups ADD COLUMN IF NOT EXISTS app_type_id TEXT`,
  `ALTER TABLE shared_step_groups ADD COLUMN IF NOT EXISTS name TEXT`,
  `ALTER TABLE shared_step_groups ADD COLUMN IF NOT EXISTS description TEXT`,
  `ALTER TABLE shared_step_groups ADD COLUMN IF NOT EXISTS steps JSONB NOT NULL DEFAULT '[]'::jsonb`,
  `ALTER TABLE shared_step_groups ADD COLUMN IF NOT EXISTS parameter_values JSONB`,
  `UPDATE shared_step_groups SET parameter_values = '{}'::jsonb WHERE parameter_values IS NULL`,
  `ALTER TABLE shared_step_groups ALTER COLUMN parameter_values SET DEFAULT '{}'::jsonb`,
  `ALTER TABLE shared_step_groups ALTER COLUMN parameter_values SET NOT NULL`,
  `ALTER TABLE shared_step_groups ADD COLUMN IF NOT EXISTS created_by TEXT`,
  `ALTER TABLE shared_step_groups ADD COLUMN IF NOT EXISTS updated_by TEXT`,
  `ALTER TABLE shared_step_groups ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP`,
  `ALTER TABLE shared_step_groups ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP`,
  `UPDATE shared_step_groups SET updated_at = COALESCE(updated_at, created_at, CURRENT_TIMESTAMP)`,
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
  `CREATE INDEX IF NOT EXISTS idx_shared_step_groups_app_type ON shared_step_groups (app_type_id, updated_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_test_steps_case_group ON test_steps (test_case_id, group_id, step_order)`,
  `ALTER TABLE execution_results DROP CONSTRAINT IF EXISTS execution_results_status_check`,
  `ALTER TABLE execution_results ADD CONSTRAINT execution_results_status_check CHECK (status IN ('running', 'passed', 'failed', 'blocked'))`,
  `CREATE INDEX IF NOT EXISTS idx_execution_results_execution_created_at ON execution_results (execution_id, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_execution_results_case_created_at ON execution_results (test_case_id, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_execution_results_app_type_created_at ON execution_results (app_type_id, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_suite_test_cases_test_case_sort ON suite_test_cases (test_case_id, sort_order)`,
  `CREATE INDEX IF NOT EXISTS idx_requirement_test_cases_test_case ON requirement_test_cases (test_case_id)`,
  `CREATE INDEX IF NOT EXISTS idx_project_members_project_user ON project_members (project_id, user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_execution_suites_execution_suite ON execution_suites (execution_id, suite_id)`,
  `CREATE INDEX IF NOT EXISTS idx_ai_test_case_generation_jobs_scope_status ON ai_test_case_generation_jobs (app_type_id, status, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_ai_test_case_generation_jobs_project_created ON ai_test_case_generation_jobs (project_id, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_test_cases_app_status_created ON test_cases (app_type_id, status, created_at DESC)`,
  `ALTER TABLE execution_results ADD COLUMN IF NOT EXISTS external_references JSONB`,
  `UPDATE execution_results SET external_references = '[]'::jsonb WHERE external_references IS NULL`,
  `ALTER TABLE execution_results ALTER COLUMN external_references SET DEFAULT '[]'::jsonb`,
  `ALTER TABLE execution_results ALTER COLUMN external_references SET NOT NULL`,
  `ALTER TABLE execution_results ADD COLUMN IF NOT EXISTS defects JSONB`,
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
  `ALTER TABLE test_cases ADD COLUMN IF NOT EXISTS ai_generated_at TIMESTAMPTZ`,
  `ALTER TABLE test_cases ADD COLUMN IF NOT EXISTS created_by TEXT`,
  `ALTER TABLE test_cases ADD COLUMN IF NOT EXISTS updated_by TEXT`,
  `ALTER TABLE test_cases ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP`,
  `ALTER TABLE test_cases ADD COLUMN IF NOT EXISTS external_references JSONB`,
  `ALTER TABLE test_cases ADD COLUMN IF NOT EXISTS automation_status TEXT NOT NULL DEFAULT 'not_automated'`,
  `UPDATE test_cases SET external_references = '[]'::jsonb WHERE external_references IS NULL`,
  `ALTER TABLE test_cases ALTER COLUMN external_references SET DEFAULT '[]'::jsonb`,
  `ALTER TABLE test_cases ALTER COLUMN external_references SET NOT NULL`,
  `UPDATE test_cases SET updated_at = COALESCE(updated_at, created_at, CURRENT_TIMESTAMP)`,
  `
    UPDATE test_cases
    SET automated = CASE
      WHEN automated IS NULL OR BTRIM(automated) = '' THEN 'no'
      WHEN LOWER(BTRIM(automated)) IN ('yes', 'y', 'true', '1') THEN 'yes'
      ELSE 'no'
    END
  `,
  `
    UPDATE test_cases
    SET automation_status = CASE
      WHEN automated = 'yes' AND automation_status = 'not_automated' THEN 'ready'
      WHEN automated <> 'yes' THEN 'not_automated'
      ELSE automation_status
    END
  `,
  `ALTER TABLE test_cases DROP CONSTRAINT IF EXISTS test_cases_automated_check`,
  `ALTER TABLE test_cases ADD CONSTRAINT test_cases_automated_check CHECK (automated IN ('yes', 'no'))`,
  `ALTER TABLE test_cases DROP CONSTRAINT IF EXISTS test_cases_automation_status_check`,
  `ALTER TABLE test_cases ADD CONSTRAINT test_cases_automation_status_check CHECK (automation_status IN ('not_automated', 'ready', 'incomplete'))`,
  `ALTER TABLE test_cases DROP CONSTRAINT IF EXISTS test_cases_ai_generation_source_check`,
  `ALTER TABLE test_cases ADD CONSTRAINT test_cases_ai_generation_source_check CHECK (ai_generation_source IS NULL OR ai_generation_source IN ('scheduler'))`,
  `ALTER TABLE test_cases DROP CONSTRAINT IF EXISTS test_cases_ai_generation_review_status_check`,
  `ALTER TABLE test_cases ADD CONSTRAINT test_cases_ai_generation_review_status_check CHECK (ai_generation_review_status IS NULL OR ai_generation_review_status IN ('pending', 'accepted'))`,
  `CREATE INDEX IF NOT EXISTS idx_test_cases_ai_generation_review ON test_cases (app_type_id, ai_generation_source, ai_generation_review_status, created_at DESC)`,
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
  `ALTER TABLE batch_process_jobs ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ`,
  `ALTER TABLE batch_process_jobs ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ`,
  `ALTER TABLE batch_process_jobs ADD COLUMN IF NOT EXISTS last_error TEXT`,
  `ALTER TABLE batch_process_jobs ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP`,
  `ALTER TABLE batch_process_jobs ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP`,
  `UPDATE batch_process_jobs SET operation = 'unknown' WHERE operation IS NULL OR BTRIM(operation) = ''`,
  `UPDATE batch_process_jobs SET status = 'queued' WHERE status IS NULL OR BTRIM(status) = ''`,
  `ALTER TABLE batch_process_jobs ALTER COLUMN transaction_id SET NOT NULL`,
  `ALTER TABLE batch_process_jobs ALTER COLUMN operation SET NOT NULL`,
  `ALTER TABLE batch_process_jobs DROP CONSTRAINT IF EXISTS batch_process_jobs_status_check`,
  `ALTER TABLE batch_process_jobs ADD CONSTRAINT batch_process_jobs_status_check CHECK (status IN ('queued', 'running', 'completed', 'failed'))`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_batch_process_jobs_transaction ON batch_process_jobs (transaction_id)`,
  `CREATE INDEX IF NOT EXISTS idx_batch_process_jobs_queue ON batch_process_jobs (status, created_at ASC)`,
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
  `ALTER TABLE test_engine_jobs ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ`,
  `ALTER TABLE test_engine_jobs ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ`,
  `ALTER TABLE test_engine_jobs ADD COLUMN IF NOT EXISTS last_error TEXT`,
  `ALTER TABLE test_engine_jobs ADD COLUMN IF NOT EXISTS created_by TEXT`,
  `ALTER TABLE test_engine_jobs ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP`,
  `ALTER TABLE test_engine_jobs ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP`,
  `UPDATE test_engine_jobs SET payload = '{}'::jsonb WHERE payload IS NULL`,
  `UPDATE test_engine_jobs SET runtime_state = '{}'::jsonb WHERE runtime_state IS NULL`,
  `UPDATE test_engine_jobs SET status = 'queued' WHERE status IS NULL OR BTRIM(status) = ''`,
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
  `
    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value JSONB NOT NULL DEFAULT '{}'::jsonb,
      updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    )
  `,
  `ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS value JSONB NOT NULL DEFAULT '{}'::jsonb`,
  `ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP`,
  `ALTER TABLE projects ADD COLUMN IF NOT EXISTS display_id TEXT`,
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
    WITH numbered AS (
      SELECT id, ROW_NUMBER() OVER (ORDER BY created_at ASC NULLS LAST, id ASC) AS seq
      FROM projects
      WHERE display_id IS NULL
    )
    UPDATE projects
    SET display_id = 'PROJ-' || numbered.seq
    FROM numbered
    WHERE projects.id = numbered.id
  `,
  `
    WITH numbered AS (
      SELECT id, ROW_NUMBER() OVER (ORDER BY created_at ASC NULLS LAST, id ASC) AS seq
      FROM requirements
      WHERE display_id IS NULL
    )
    UPDATE requirements
    SET display_id = 'RC_' || numbered.seq
    FROM numbered
    WHERE requirements.id = numbered.id
  `,
  `
    WITH numbered AS (
      SELECT id, ROW_NUMBER() OVER (ORDER BY created_at ASC NULLS LAST, id ASC) AS seq
      FROM test_cases
      WHERE display_id IS NULL
    )
    UPDATE test_cases
    SET display_id = 'TC_' || numbered.seq
    FROM numbered
    WHERE test_cases.id = numbered.id
  `,
  `
    WITH numbered AS (
      SELECT id, ROW_NUMBER() OVER (ORDER BY created_at ASC NULLS LAST, id ASC) AS seq
      FROM test_suites
      WHERE display_id IS NULL
    )
    UPDATE test_suites
    SET display_id = 'TS-' || numbered.seq
    FROM numbered
    WHERE test_suites.id = numbered.id
  `,
  `
    WITH numbered AS (
      SELECT id, ROW_NUMBER() OVER (ORDER BY created_at ASC NULLS LAST, id ASC) AS seq
      FROM shared_step_groups
      WHERE display_id IS NULL
    )
    UPDATE shared_step_groups
    SET display_id = 'SG-' || numbered.seq
    FROM numbered
    WHERE shared_step_groups.id = numbered.id
  `
];

const ensureRuntimeSchema = async () => {
  if (!bootstrapPromise) {
    bootstrapPromise = (async () => {
      for (const statement of statements) {
        await db.query(statement);
      }
    })().catch((error) => {
      bootstrapPromise = null;
      throw error;
    });
  }

  return bootstrapPromise;
};

module.exports = {
  ensureRuntimeSchema
};
