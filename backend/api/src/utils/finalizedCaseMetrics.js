// A case with several Data Set rows has one outcome, not one outcome per row.
// Callers scope eligible executions before these CTEs (project, Release, etc.).
// The input must expose id, execution_id, test_case_id, status, created_at,
// ended_at, data_set_iteration_index and data_set_iteration_key.
exports.latestFinalizedCaseResultsCte = (eligibleResultsSql) => `
  eligible_results AS (${eligibleResultsSql}),
  observed_iterations AS (
    SELECT execution_id, test_case_id,
      COUNT(DISTINCT COALESCE(data_set_iteration_index::text, data_set_iteration_key, 'default')) AS expected_iterations
    FROM eligible_results GROUP BY execution_id, test_case_id
  ),
  current_iterations AS (
    SELECT DISTINCT ON (execution_id, test_case_id,
      COALESCE(data_set_iteration_index::text, data_set_iteration_key, 'default'))
      id, execution_id, test_case_id, LOWER(TRIM(status)) AS status,
      COALESCE(ended_at, created_at) AS outcome_at
    FROM eligible_results
    WHERE LOWER(TRIM(status)) IN ('passed', 'failed', 'blocked')
    ORDER BY execution_id, test_case_id,
      COALESCE(data_set_iteration_index::text, data_set_iteration_key, 'default'),
      created_at DESC NULLS LAST, id DESC
  ), finalized_case_runs AS (
    SELECT i.execution_id, i.test_case_id,
      CASE WHEN BOOL_OR(i.status = 'failed') THEN 'failed'
           WHEN BOOL_OR(i.status = 'blocked') THEN 'blocked' ELSE 'passed' END AS status,
      MAX(i.outcome_at) AS outcome_at
    FROM current_iterations i
    JOIN observed_iterations observed
      ON observed.execution_id = i.execution_id AND observed.test_case_id = i.test_case_id
    LEFT JOIN execution_case_snapshots snapshot
      ON snapshot.execution_id = i.execution_id AND snapshot.test_case_id = i.test_case_id
    GROUP BY i.execution_id, i.test_case_id
    HAVING BOOL_AND(COALESCE(i.status IN ('passed', 'failed', 'blocked'), false))
      AND COUNT(*) >= MAX(observed.expected_iterations)
      AND COUNT(*) >= MAX(CASE
        WHEN snapshot.test_data_set_snapshot->>'mode' = 'key_value' THEN 1
        WHEN jsonb_typeof(snapshot.test_data_set_snapshot->'rows') = 'array'
          THEN GREATEST(1, jsonb_array_length(snapshot.test_data_set_snapshot->'rows'))
        ELSE 1 END)
  ), latest_finalized AS (
    SELECT DISTINCT ON (test_case_id) test_case_id, execution_id, status, outcome_at
    FROM finalized_case_runs
    ORDER BY test_case_id, outcome_at DESC NULLS LAST, execution_id DESC
  )`;
