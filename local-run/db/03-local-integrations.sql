INSERT INTO integrations (
  id,
  type,
  name,
  base_url,
  api_key,
  model,
  project_key,
  username,
  config,
  is_active
)
VALUES
(
  'edff6911-be06-405b-8c88-261ba8bb962e',
  'testengine',
  'Test Engine',
  'http://testengine:4301',
  NULL,
  NULL,
  NULL,
  NULL,
  '{
    "project_id":null,
    "runner":"hybrid",
    "dispatch_mode":"hellotest-pull",
    "execution_scope":"api+web",
    "active_web_engine":"playwright",
    "browser":"chromium",
    "headless":true,
    "healing_enabled":false,
    "max_repair_attempts":0,
    "trace_mode":"off",
    "video_mode":"retain-on-failure",
    "capture_console":true,
    "capture_network":true,
    "artifact_retention_days":7,
    "run_timeout_seconds":1800,
    "navigation_timeout_ms":30000,
    "action_timeout_ms":5000,
    "assertion_timeout_ms":10000,
    "recovery_wait_ms":750,
    "max_video_attachment_mb":25,
    "queue_poll_interval_minutes":0.5,
    "hellotest_api_base_url":"http://api:3000",
    "promote_healed_patches":"review",
    "public_base_url":"http://localhost:4301",
    "recorder_public_base_url":"http://localhost:4301",
    "ops_public_base_url":"http://localhost:4301",
    "live_view_url":"http://localhost:4301/api/v1/live-session?provider=playwright",
    "mobile_engine_url":"http://localhost:4312",
    "mobile_engine_internal_url":"http://mobile-engine:4312",
    "appium_server_url":"http://host.docker.internal:4723"
  }'::jsonb,
  TRUE
),
(
  '382a96b2-fbed-4e1a-9a7a-50c0b399df60',
  'google_auth',
  'HelloTest',
  'https://api.openai.com/v1',
  NULL,
  NULL,
  NULL,
  NULL,
  '{"client_id":"918974800113-i8i5r0im3705u8gceqbploemv3oeg32i.apps.googleusercontent.com"}'::jsonb,
  TRUE
),
(
  '08f12517-6229-4e4c-a6d2-4f88145fbff1',
  'ops',
  'HelloTest',
  'http://testengine:4301',
  NULL,
  NULL,
  NULL,
  NULL,
  '{
    "project_id":null,
    "events_path":"/api/v1/events",
    "health_path":"/health",
    "api_key_header":"Authorization",
    "api_key_prefix":"Bearer",
    "service_name":"hellotest-testengine",
    "environment":"local",
    "timeout_ms":4000,
    "emit_step_events":true,
    "emit_case_events":true,
    "emit_suite_events":true,
    "emit_run_events":true
  }'::jsonb,
  TRUE
),
(
  '17fa4724-6516-4ff2-b2aa-e7d27fe605b3',
  'llm',
  'Open AI',
  'https://api.openai.com/v1',
  NULL,
  'gpt-5.4-mini',
  NULL,
  NULL,
  '{}'::jsonb,
  FALSE
),
(
  'df45e7d9-5167-4b30-a766-3c92a2a27a99',
  'email',
  'HelloTest',
  'https://api.openai.com/v1',
  NULL,
  NULL,
  NULL,
  'contact@qualipal.in',
  '{
    "host":"smtp.hostinger.com",
    "port":587,
    "secure":false,
    "password":"********",
    "sender_email":"contact@qualipal.in",
    "sender_name":"HelloTest Support"
  }'::jsonb,
  TRUE
),
(
  '3078d5bf-993d-4aeb-9ff2-e2ea0d93c42a',
  'llm',
  'grok',
  'https://api.groq.com/openai/v1',
  NULL,
  'openai/gpt-oss-20b',
  NULL,
  NULL,
  '{}'::jsonb,
  FALSE
)
ON CONFLICT (id) DO UPDATE SET
  type = EXCLUDED.type,
  name = EXCLUDED.name,
  base_url = EXCLUDED.base_url,
  api_key = COALESCE(NULLIF(EXCLUDED.api_key, '********'), integrations.api_key, EXCLUDED.api_key),
  model = EXCLUDED.model,
  project_key = EXCLUDED.project_key,
  username = EXCLUDED.username,
  config = EXCLUDED.config,
  is_active = CASE
    WHEN EXCLUDED.type = 'llm' AND EXCLUDED.api_key IS NULL THEN
      CASE
        WHEN integrations.api_key IS NOT NULL
          AND BTRIM(integrations.api_key) <> ''
          AND BTRIM(integrations.api_key) !~ '^(\*{6,}|[•●]{6,})$'
          THEN integrations.is_active
        ELSE FALSE
      END
    ELSE EXCLUDED.is_active
  END,
  updated_at = CURRENT_TIMESTAMP;

DELETE FROM integrations
WHERE id IN ('int_testengine_local', 'int_ops_local');
