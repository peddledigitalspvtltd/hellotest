UPDATE integrations
SET
  base_url = 'http://testengine:4301',
  config = jsonb_set(
    jsonb_set(
      jsonb_set(
        jsonb_set(
          jsonb_set(
            jsonb_set(
              jsonb_set(
                jsonb_set(
                  COALESCE(config, '{}'::jsonb),
                  '{recorder_public_base_url}',
                  '"http://localhost:4301"'::jsonb,
                  true
                ),
                '{ops_public_base_url}',
                '"http://localhost:4301"'::jsonb,
                true
              ),
              '{public_base_url}',
              '"http://localhost:4301"'::jsonb,
              true
            ),
            '{live_view_url}',
            '"http://localhost:4301"'::jsonb,
            true
          ),
          '{active_web_engine}',
          '"playwright"'::jsonb,
          true
        ),
        '{browser}',
        '"chromium"'::jsonb,
        true
      ),
      '{headless}',
      'true'::jsonb,
      true
    ),
    '{queue_poll_interval_minutes}',
    '0.5'::jsonb,
    true
  ),
  updated_at = CURRENT_TIMESTAMP
WHERE id = 'int_testengine_local';
