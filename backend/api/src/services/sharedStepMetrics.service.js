const db = require('../db');

// Repository rows and observed execution instances are deliberately separate
// units. We count one latest outcome per run/case/data row/step, not retries,
// and take group identity from the frozen snapshot, never today's case links.
const evidenceCtes = `
  WITH scope_groups AS MATERIALIZED (SELECT id, name, app_type_id FROM shared_step_groups WHERE app_type_id = ?),
  snapshots AS MATERIALIZED (
    SELECT s.* FROM execution_step_snapshots s
    JOIN scope_groups g ON g.id = s.reusable_group_id
    JOIN executions e ON e.id = s.execution_id AND e.project_id = ?
      AND (e.app_type_id IS NULL OR e.app_type_id = g.app_type_id)
  ), native_records AS MATERIALIZED (
    SELECT s.reusable_group_id AS group_id, s.execution_id, s.test_case_id, s.snapshot_step_id,
      sr.status, COALESCE(sr.finished_at,sr.started_at,sr.created_at) AS observed_at,
      sr.created_at, sr.id, cr.data_set_iteration_index AS iteration_index, cr.data_set_iteration_key AS iteration_key,
      COALESCE('index:' || cr.data_set_iteration_index::text, 'key:' || cr.data_set_iteration_key, 'default') AS row_identity,
      COALESCE('index:' || cr.data_set_iteration_index::text, 'key:' || cr.data_set_iteration_key, 'legacy:' || COALESCE(sr.test_case_run_id,'')) AS native_identity
    FROM step_runs sr JOIN snapshots s ON s.execution_id = sr.run_id AND s.snapshot_step_id = sr.step_id
    LEFT JOIN test_case_runs cr ON cr.id = sr.test_case_run_id
    WHERE COALESCE(sr.finished_at,sr.started_at,sr.created_at) >= ?::timestamptz
      AND (sr.test_case_run_id IS NULL OR (cr.run_id = s.execution_id AND cr.test_case_id = s.test_case_id))
  ), native_outcomes AS MATERIALIZED (
    SELECT DISTINCT ON (execution_id,test_case_id,snapshot_step_id,native_identity)
      group_id,execution_id,test_case_id,snapshot_step_id,status,observed_at,row_identity,iteration_index,iteration_key
    FROM native_records
    ORDER BY execution_id,test_case_id,snapshot_step_id,native_identity,created_at DESC,id DESC
  ), latest_results AS MATERIALIZED (
    SELECT DISTINCT ON (r.execution_id,r.test_case_id,COALESCE('index:' || r.data_set_iteration_index::text,'key:' || r.data_set_iteration_key,'default'))
      r.id,r.execution_id,r.test_case_id,r.created_at,r.logs,
      r.data_set_iteration_index AS iteration_index,r.data_set_iteration_key AS iteration_key,
      COALESCE('index:' || r.data_set_iteration_index::text,'key:' || r.data_set_iteration_key,'default') AS row_identity
    FROM execution_results r
    WHERE r.created_at >= ?::timestamptz
      AND r.app_type_id = (SELECT app_type_id FROM scope_groups LIMIT 1)
      AND EXISTS (SELECT 1 FROM snapshots s WHERE s.execution_id = r.execution_id AND s.test_case_id = r.test_case_id)
    ORDER BY r.execution_id,r.test_case_id,COALESCE('index:' || r.data_set_iteration_index::text,'key:' || r.data_set_iteration_key,'default'),r.created_at DESC,r.id DESC
  ), manual_outcomes AS MATERIALIZED (
    SELECT s.reusable_group_id AS group_id,r.execution_id,r.test_case_id,s.snapshot_step_id,
      LOWER(status.value) AS status,r.created_at AS observed_at,r.row_identity,r.iteration_index,r.iteration_key
    FROM latest_results r
    CROSS JOIN LATERAL jsonb_each_text(shared_step_statuses(r.logs)) status
    JOIN snapshots s ON s.execution_id = r.execution_id AND s.test_case_id = r.test_case_id AND s.snapshot_step_id = status.key
  ), ambiguous_native AS (
    SELECT n.group_id,n.execution_id,n.test_case_id,n.snapshot_step_id
    FROM native_outcomes n WHERE n.row_identity = 'default'
    GROUP BY n.group_id,n.execution_id,n.test_case_id,n.snapshot_step_id
    HAVING COUNT(*) > 1 OR (
      EXISTS (SELECT 1 FROM manual_outcomes m WHERE m.execution_id = n.execution_id AND m.test_case_id = n.test_case_id AND m.snapshot_step_id = n.snapshot_step_id AND m.row_identity <> 'default')
      AND NOT EXISTS (SELECT 1 FROM manual_outcomes m WHERE m.execution_id = n.execution_id AND m.test_case_id = n.test_case_id AND m.snapshot_step_id = n.snapshot_step_id AND m.row_identity = 'default')
    )
  ), outcomes AS MATERIALIZED (
    SELECT * FROM native_outcomes
    UNION ALL
    SELECT m.* FROM manual_outcomes m
    WHERE NOT EXISTS (SELECT 1 FROM native_outcomes n
      WHERE n.execution_id = m.execution_id AND n.test_case_id = m.test_case_id AND n.snapshot_step_id = m.snapshot_step_id
        AND ((n.iteration_index IS NOT NULL AND m.iteration_index IS NOT NULL AND n.iteration_index = m.iteration_index)
          OR ((n.iteration_index IS NULL OR m.iteration_index IS NULL) AND n.iteration_key IS NOT NULL AND n.iteration_key = m.iteration_key)
          OR (n.row_identity = 'default' AND m.row_identity = 'default')))
  ), run_outcomes AS (
    SELECT group_id,execution_id,MAX(observed_at) AS created_at,
      CASE WHEN BOOL_OR(status = 'failed') THEN 'failed'
           WHEN BOOL_OR(status = 'blocked') THEN 'blocked'
           WHEN BOOL_AND(status = 'passed') THEN 'passed' ELSE 'running' END AS status,
      BOOL_AND(status IN ('passed','failed')) AS finalized
    FROM outcomes GROUP BY group_id,execution_id
  )`;

// Prefer explicit execution-result step links. Legacy run/case links may
// supply evidence only when no exact step link exists for that defect/context.
// Neither relation proves root cause, and a later pass does not close a defect.
const openDefectEvidenceSql = `
  WITH scope_groups AS MATERIALIZED (
    SELECT id, name, app_type_id FROM shared_step_groups WHERE app_type_id = ?
  ), open_defects AS MATERIALIZED (
    SELECT id, display_id, title, status, linked_test_run_id, linked_test_case_ids, created_at
    FROM feedback WHERE project_id = ?
      AND LOWER(TRIM(COALESCE(status, 'open'))) NOT IN ('closed', 'resolved', 'done', 'accepted')
  ), defect_cases AS MATERIALIZED (
    SELECT f.id AS issue_id, l.test_case_id FROM open_defects f
    JOIN test_case_defects l ON l.issue_id = f.id
    UNION
    SELECT f.id, links.test_case_id FROM open_defects f
    CROSS JOIN LATERAL jsonb_array_elements_text(
      CASE WHEN jsonb_typeof(f.linked_test_case_ids) = 'array' THEN f.linked_test_case_ids ELSE '[]'::jsonb END
    ) links(test_case_id)
  ), linked_steps AS MATERIALIZED (
    SELECT f.id AS issue_id, s.reusable_group_id AS group_id, s.execution_id, s.test_case_id, s.snapshot_step_id
    FROM open_defects f JOIN defect_cases c ON c.issue_id = f.id
    JOIN executions e ON e.id = f.linked_test_run_id AND e.project_id = ?
      AND (e.app_type_id IS NULL OR e.app_type_id = ?)
    JOIN execution_step_snapshots s ON s.execution_id = e.id AND s.test_case_id = c.test_case_id
    JOIN scope_groups g ON g.id = s.reusable_group_id
    WHERE NOT EXISTS (
      SELECT 1 FROM execution_results exact_result
      CROSS JOIN LATERAL jsonb_each(CASE WHEN jsonb_typeof(exact_result.step_defects) = 'object' THEN exact_result.step_defects ELSE '{}'::jsonb END) exact_step
      WHERE exact_result.execution_id = e.id AND exact_result.test_case_id = c.test_case_id
        AND jsonb_typeof(exact_step.value) = 'array' AND exact_step.value @> jsonb_build_array(f.id)
    )
    UNION
    SELECT f.id, s.reusable_group_id, s.execution_id, s.test_case_id, s.snapshot_step_id
    FROM execution_results r
    JOIN execution_step_snapshots s ON s.execution_id = r.execution_id AND s.test_case_id = r.test_case_id
    JOIN scope_groups g ON g.id = s.reusable_group_id AND g.app_type_id = r.app_type_id
    JOIN executions e ON e.id = r.execution_id AND (e.app_type_id IS NULL OR e.app_type_id = g.app_type_id)
    JOIN app_types a ON a.id = g.app_type_id AND a.project_id = e.project_id
    CROSS JOIN LATERAL jsonb_array_elements_text(
      CASE WHEN jsonb_typeof(r.step_defects -> s.snapshot_step_id) = 'array' THEN r.step_defects -> s.snapshot_step_id ELSE '[]'::jsonb END
    ) exact_link(issue_id)
    JOIN open_defects f ON f.id = exact_link.issue_id
  ), failed_links AS MATERIALIZED (
    SELECT l.* FROM linked_steps l
    WHERE EXISTS (
      SELECT 1 FROM step_runs sr LEFT JOIN test_case_runs cr ON cr.id = sr.test_case_run_id
      WHERE sr.run_id = l.execution_id AND sr.step_id = l.snapshot_step_id AND LOWER(sr.status) = 'failed'
        AND (sr.test_case_run_id IS NULL OR (cr.run_id = l.execution_id AND cr.test_case_id = l.test_case_id))
    ) OR EXISTS (
      SELECT 1 FROM execution_results r
      WHERE r.execution_id = l.execution_id AND r.test_case_id = l.test_case_id AND r.app_type_id = ?
        AND LOWER(shared_step_statuses(r.logs) ->> l.snapshot_step_id) = 'failed'
    )
  ), defect_groups AS MATERIALIZED (
    SELECT DISTINCT group_id, issue_id FROM failed_links
  ), evidence AS (
    SELECT DISTINCT ON (l.issue_id) f.id AS issue_id, f.display_id, f.title, f.status, f.created_at,
      l.group_id, g.name AS group_name, l.execution_id, l.test_case_id, l.snapshot_step_id
    FROM failed_links l JOIN open_defects f ON f.id = l.issue_id JOIN scope_groups g ON g.id = l.group_id
    ORDER BY l.issue_id, g.name, l.group_id, l.test_case_id, l.snapshot_step_id
  )
  SELECT (SELECT COUNT(DISTINCT issue_id)::int FROM defect_groups) AS open_defect_count,
    COALESCE((SELECT jsonb_agg(d) FROM (
      SELECT * FROM evidence ORDER BY created_at DESC, issue_id LIMIT 10
    ) d), '[]'::jsonb) AS open_defect_evidence,
    COALESCE((SELECT jsonb_agg(g) FROM (
      SELECT group_id, COUNT(*)::int AS open_defect_count FROM defect_groups GROUP BY group_id
    ) g), '[]'::jsonb) AS groups
`;

exports.getSharedStepMetrics = async ({ app_type_id, project_id, include_execution = true, include_defects = true, now = new Date() }) => {
  const evaluatedAt = new Date(now).toISOString();
  const since = new Date(new Date(now).getTime() - 90 * 86400000).toISOString();
  const repository = await db.prepare(`
    SELECT COUNT(*)::int AS total_steps,
      COUNT(DISTINCT ts.test_case_id) FILTER (WHERE g.id IS NOT NULL)::int AS reused_case_count,
      COUNT(*) FILTER (WHERE g.id IS NOT NULL)::int AS shared_step_references
    FROM test_steps ts JOIN test_cases tc ON tc.id = ts.test_case_id
    LEFT JOIN shared_step_groups g ON g.id = ts.reusable_group_id AND g.app_type_id = tc.app_type_id
    WHERE tc.app_type_id = ?
  `).get(app_type_id);
  const usage = await db.prepare(`
    SELECT g.id, g.name, COUNT(DISTINCT ts.test_case_id)::int AS case_count
    FROM shared_step_groups g
    LEFT JOIN test_steps ts ON ts.reusable_group_id = g.id
      AND EXISTS (SELECT 1 FROM test_cases tc WHERE tc.id = ts.test_case_id AND tc.app_type_id = g.app_type_id)
    WHERE g.app_type_id = ? GROUP BY g.id,g.name ORDER BY g.name,g.id
  `).all(app_type_id);
  const measured = include_execution ? await db.prepare(`${evidenceCtes}
    SELECT g.id,
      (SELECT COUNT(*)::int FROM ambiguous_native a WHERE a.group_id = g.id) AS ambiguous_step_identity_count,
      COUNT(o.snapshot_step_id) FILTER (WHERE o.status IN ('passed','failed'))::int AS executed_steps,
      COUNT(o.snapshot_step_id) FILTER (WHERE o.status = 'passed')::int AS passed_steps,
      COUNT(o.snapshot_step_id) FILTER (WHERE o.status = 'failed')::int AS failed_steps,
      COUNT(DISTINCT o.test_case_id) FILTER (WHERE o.status = 'failed')::int AS failed_cases,
      COUNT(DISTINCT o.execution_id)::int AS run_count,
      COALESCE((SELECT jsonb_agg(h) FROM (
        SELECT execution_id,status,finalized AS "isFinalized",created_at FROM run_outcomes r
        WHERE r.group_id = g.id ORDER BY created_at DESC,execution_id DESC LIMIT 10
      ) h),'[]'::jsonb) AS history,
      COALESCE((SELECT jsonb_agg(f) FROM (
        SELECT execution_id,test_case_id,snapshot_step_id,observed_at FROM outcomes e
        WHERE e.group_id = g.id AND e.status = 'failed'
        ORDER BY observed_at DESC,execution_id,test_case_id,snapshot_step_id LIMIT 10
      ) f),'[]'::jsonb) AS failure_evidence
    FROM scope_groups g LEFT JOIN outcomes o ON o.group_id = g.id GROUP BY g.id
  `).all(app_type_id,project_id,since,since) : [];
  const identityReason = 'Some native step outcomes have no data-row identity and overlap other recorded outcomes. Unique executed, passed and failed step totals cannot be determined without that identity.';
  const byId = new Map(measured.map(group => [group.id, group.ambiguous_step_identity_count > 0
    ? { ...group, executed_steps: null, passed_steps: null, failed_steps: null, execution_evidence_reason: identityReason }
    : group]));
  const groups = usage.map(group => ({...group, ...(byId.get(group.id) || {}), execution_visible: include_execution}));
  const hasAmbiguousIdentity = measured.some(group => group.ambiguous_step_identity_count > 0);
  const executed = include_execution && !hasAmbiguousIdentity ? measured.reduce((sum,g) => sum + Number(g.executed_steps),0) : null;
  const defectsVisible = include_execution && include_defects;
  const defects = defectsVisible ? await db.prepare(openDefectEvidenceSql).get(app_type_id, project_id, project_id, app_type_id, app_type_id) : null;
  const defectsByGroup = new Map((defects?.groups || []).map(group => [group.group_id, group.open_defect_count]));
  return {
    evaluated_at: evaluatedAt, window_start: since, window_days: 90,
    execution_visible: include_execution,
    execution_evidence_reason: !include_execution ? 'Run and result access is required.' : hasAmbiguousIdentity ? identityReason : null,
    total_repository_steps: Number(repository.total_steps),
    reused_case_count: Number(repository.reused_case_count),
    shared_step_references: Number(repository.shared_step_references),
    shared_steps_executed: executed,
    reusability_index: executed !== null && repository.total_steps > 0 ? Math.round(executed / repository.total_steps * 1000) / 10 : null,
    failure_cluster_count: include_execution ? measured.filter(group => group.failed_cases >= 2).length : null,
    defects_visible: defectsVisible,
    open_defect_count: defectsVisible ? Number(defects.open_defect_count) : null,
    open_defect_evidence: defects?.open_defect_evidence || [],
    defect_evidence_reason: !include_execution ? 'Run and result access is required.' : !include_defects ? 'Defect access is required.' : null,
    mtti_ms: null, isolation_sample_count: 0,
    mtti_unavailable_reason: 'No recorded failure-to-isolation timestamp pairs are available. Case resolution and result edits are not isolation evidence.',
    groups: groups.map(group => ({ ...group, open_defect_count: defectsVisible ? (defectsByGroup.get(group.id) || 0) : null }))
  };
};
