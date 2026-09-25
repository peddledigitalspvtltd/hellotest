// Keep explicit, movable module ownership intact. Story membership is derived
// relationally, so new/manual/AI cases and later link changes need no backfill
// or asynchronous fan-out, and stale memberships cannot survive an unlink.
module.exports = [
  `CREATE INDEX IF NOT EXISTS idx_module_requirements_story ON test_case_module_requirements (requirement_id, module_id)`,
  `CREATE OR REPLACE VIEW test_case_effective_module_cases AS
    SELECT module_id, test_case_id, MIN(sort_order)::integer AS sort_order,
      MIN(created_at) AS created_at, bool_or(is_explicit) AS is_explicit
    FROM (
      SELECT link.module_id, link.test_case_id, link.sort_order, link.created_at, TRUE AS is_explicit
      FROM test_case_module_cases link
      UNION ALL
      SELECT membership.module_id, tc.id, membership.sort_order, tc.created_at, FALSE
      FROM test_case_module_requirements membership
      JOIN test_case_modules module ON module.id = membership.module_id
      JOIN app_types app ON app.id = module.app_type_id
      JOIN requirements story ON story.id = membership.requirement_id AND story.project_id = app.project_id
      JOIN requirement_test_cases link ON link.requirement_id = story.id
      JOIN test_cases tc ON tc.id = link.test_case_id
      LEFT JOIN test_suites suite ON suite.id = tc.suite_id
      WHERE module.app_type_id = COALESCE(tc.app_type_id, suite.app_type_id)
      UNION ALL
      SELECT membership.module_id, tc.id, membership.sort_order, tc.created_at, FALSE
      FROM test_case_module_requirements membership
      JOIN test_case_modules module ON module.id = membership.module_id
      JOIN app_types app ON app.id = module.app_type_id
      JOIN requirements story ON story.id = membership.requirement_id AND story.project_id = app.project_id
      JOIN test_cases tc ON tc.requirement_id = story.id
      LEFT JOIN test_suites suite ON suite.id = tc.suite_id
      WHERE module.app_type_id = COALESCE(tc.app_type_id, suite.app_type_id)
    ) memberships GROUP BY module_id, test_case_id`
];
