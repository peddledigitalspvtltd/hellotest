module.exports=[
 `CREATE OR REPLACE VIEW suite_effective_test_cases AS
  SELECT suite_id,test_case_id,MIN(sort_order)::integer AS sort_order FROM (
    SELECT mapping.suite_id,mapping.test_case_id,mapping.sort_order FROM suite_test_cases mapping
    UNION ALL
    SELECT suite.id,member.test_case_id,(1000000+selected.position*10000+COALESCE(member.sort_order,0))::integer
    FROM test_suites suite
    CROSS JOIN LATERAL jsonb_array_elements_text(suite.module_ids) WITH ORDINALITY selected(module_id,position)
    JOIN test_case_modules module ON module.id=selected.module_id AND module.app_type_id=suite.app_type_id
    JOIN test_case_effective_module_cases member ON member.module_id=module.id
    JOIN test_cases ON test_cases.id=member.test_case_id AND test_cases.app_type_id=suite.app_type_id
    WHERE suite.module_membership='live'
  ) resolved GROUP BY suite_id,test_case_id`
];
