const windowDays = 30;
const maxAttempts = 5000;
const percent = (count, sample) => sample ? Math.round(100 * count / sample) : null;
const number = value => Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : null;

function summarize(rows) {
  const durations = [], failures = new Map();
  let generated = 0, firstPassed = 0, checkedFirstRuns = 0, repaired = 0;
  for (const row of rows) {
    if (row.status === 'generated') generated++;
    const verification = row.verification || {};
    const attempts = Number(verification.attempts);
    const firstStatus = verification.first_attempt_status || (attempts === 1 ? verification.execution_status : attempts === 2 && Number(verification.repair_count) > 0 ? 'failed' : undefined);
    if (firstStatus === 'passed' || firstStatus === 'failed') {
      checkedFirstRuns++;
      if (firstStatus === 'passed') firstPassed++;
      if (Number(verification.repair_count) > 0) repaired++;
    }
    const duration = row.duration_ms == null ? null : number(row.duration_ms);
    if (duration !== null) durations.push(duration);
    if (row.status !== 'generated' && /^[A-Z][A-Z0-9_]{1,99}$/.test(row.failure_code || '')) {
      failures.set(row.failure_code, (failures.get(row.failure_code) || 0) + 1);
    }
  }
  durations.sort((a, b) => a - b);
  const middle = Math.floor(durations.length / 2);
  const median = durations.length % 2 ? durations[middle] : (durations[middle - 1] + durations[middle]) / 2;
  return {
    attempted: rows.length, generated, build_success_rate: percent(generated, rows.length),
    first_run_sample: checkedFirstRuns, first_run_pass_rate: percent(firstPassed, checkedFirstRuns),
    repair_rate: percent(repaired, checkedFirstRuns), timed_attempts: durations.length,
    median_duration_ms: durations.length ? Math.round(median) : null,
    top_failure_codes: [...failures].map(([code, count]) => ({ code, count }))
      .sort((a, b) => b.count - a.count || a.code.localeCompare(b.code)).slice(0, 5)
  };
}

async function load({projectId, canViewEnvironments}) {
  const obsDb = require('@hellotest/platform/backend/src/obsDb');
  const db = require('@hellotest/platform/backend/src/db');
  const rows = await obsDb.prepare(`
    SELECT activity.metadata->>'test_environment_id' AS environment_id, outcome->>'status' AS status,
      COALESCE(outcome->'verification',activity.metadata->'verification_by_case'->(outcome->>'test_case_id')) AS verification,
      COALESCE(outcome->>'error_code',outcome->>'code') AS failure_code,
      CASE WHEN outcome->>'duration_ms' IS NOT NULL THEN outcome->>'duration_ms'
        WHEN activity.metadata->>'total_items'='1' AND activity.started_at IS NOT NULL
        THEN (EXTRACT(EPOCH FROM (activity.completed_at-activity.started_at))*1000)::text END AS duration_ms
    FROM workspace_transactions activity
    CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(activity.metadata->'case_outcomes')='array'
      THEN activity.metadata->'case_outcomes' ELSE '[]'::jsonb END) WITH ORDINALITY outcomes(outcome,position)
    WHERE activity.project_id=? AND activity.category='automation_build' AND activity.metadata->>'agent_activity'='true'
      AND activity.status IN('completed','failed') AND activity.metadata->>'cancelled' IS DISTINCT FROM 'true'
      AND activity.completed_at>=?
      AND outcome->>'status' IN ('generated','failed','incomplete')
    ORDER BY activity.completed_at DESC,activity.id DESC,outcomes.position DESC LIMIT ?`).all(
      projectId, new Date(Date.now()-windowDays*86_400_000).toISOString(), maxAttempts+1
    );
  const sample = rows.slice(0, maxAttempts);
  const groups = new Map();
  if (canViewEnvironments) for (const row of sample) {
    const key = row.environment_id || null;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  const environments = groups.size ? await db.prepare('SELECT id,name FROM test_environments WHERE project_id=?').all(projectId) : [];
  const names = new Map(environments.map(environment => [environment.id, environment.name]));
  return {
    window_days: windowDays, sampled: rows.length > maxAttempts, project: summarize(sample),
    environments: [...groups].map(([id, attempts]) => ({
      id, name: id ? names.get(id) || 'Unavailable environment' : 'No environment selected', ...summarize(attempts)
    })).sort((a, b) => b.attempted - a.attempted || a.name.localeCompare(b.name))
  };
}

module.exports = { load, summarize };
