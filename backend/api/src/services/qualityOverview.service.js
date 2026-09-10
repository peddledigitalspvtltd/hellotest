const db = require('../db');

const DAY_MS = 86_400_000;
const TERMINAL_RUNS = new Set(['passed', 'completed', 'failed', 'blocked', 'skipped', 'aborted', 'cancelled', 'partially_completed']);
const ACTIVE_RUNS = new Set(['running', 'retrying', 'paused']);
const number = (value) => Math.max(0, Number(value) || 0);
const text = (value) => String(value || '').trim();
const validTime = (value) => { const time = value ? new Date(value).getTime() : NaN; return Number.isFinite(time) ? time : null; };
const evidenceTime = (result) => {
  const history = Array.isArray(result.lifecycle_history) ? result.lifecycle_history : [];
  let latest = null;
  for (const value of [result.created_at, result.started_at, result.timer_started_at, result.ended_at, result.lifecycle_updated_at]) {
    const time = validTime(value);
    if (time !== null && (latest === null || time > latest)) latest = time;
  }
  for (const event of history) {
    const time = validTime(event?.at);
    if (time !== null && (latest === null || time > latest)) latest = time;
  }
  return latest === null ? null : new Date(latest).toISOString();
};
const windowFor = (days = 30, now = Date.now()) => {
  if (![14, 30, 90].includes(Number(days))) throw Object.assign(new Error('Choose a 14, 30 or 90 day analytics window.'), { statusCode: 400, code: 'INVALID_ANALYTICS_WINDOW' });
  const to = new Date(now);
  const from = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate()) - (Number(days) - 1) * DAY_MS);
  return { days: Number(days), from: from.toISOString(), to: to.toISOString() };
};

// Bound the result in SQL to one row per run, rather than transferring every historical attempt.
// Frozen data rows contribute separately; retries replace only the same run/case/row attempt.
const RUN_SUMMARY_SQL = `
  WITH scoped_runs AS (
    SELECT id, name, status, started_at, ended_at, created_at, test_data_set_snapshot,
      COALESCE(ended_at, started_at, created_at) AS activity_at, ?::timestamptz AS evaluated_at
    FROM executions WHERE project_id = ?
      AND COALESCE(ended_at, started_at, created_at) >= ?::timestamptz
      AND COALESCE(ended_at, started_at, created_at) <= ?::timestamptz
  ), ranked_results AS (
    SELECT result.*, ROW_NUMBER() OVER (
      PARTITION BY result.execution_id, result.test_case_id, COALESCE(result.data_set_iteration_index::text, result.data_set_iteration_key, 'default')
      ORDER BY result.created_at DESC, result.id DESC
    ) AS attempt_rank
    FROM execution_results result JOIN scoped_runs ON scoped_runs.id = result.execution_id
    WHERE result.created_at <= scoped_runs.evaluated_at
  ), case_results AS (
    SELECT execution_id, test_case_id, COUNT(*) AS observed,
      COUNT(*) FILTER (WHERE status = 'passed') AS passed,
      COUNT(*) FILTER (WHERE status = 'failed') AS failed,
      COUNT(*) FILTER (WHERE status = 'blocked') AS blocked,
      COUNT(*) FILTER (WHERE status IN ('skipped', 'aborted', 'cancelled')) AS other,
      MAX(GREATEST(created_at, started_at, timer_started_at, ended_at)) AS latest_evidence_at,
      MAX(lifecycle_history->-1->>'at') AS latest_lifecycle_at
    FROM ranked_results WHERE attempt_rank = 1 GROUP BY execution_id, test_case_id
  ), frozen_cases AS (
    SELECT snapshot.execution_id, snapshot.test_case_id,
      CASE WHEN snapshot.test_data_set_snapshot IS NOT NULL OR snapshot.test_data_set_id IS NOT NULL
        THEN snapshot.test_data_set_snapshot ELSE scoped_runs.test_data_set_snapshot END AS data_snapshot
    FROM execution_case_snapshots snapshot JOIN scoped_runs ON scoped_runs.id = snapshot.execution_id
  ), planned_cases AS (
    SELECT execution_id, test_case_id,
      CASE WHEN data_snapshot->>'mode' = 'key_value' THEN 1
        WHEN jsonb_typeof(data_snapshot->'rows') = 'array' THEN GREATEST(1, jsonb_array_length(data_snapshot->'rows'))
        WHEN jsonb_typeof(data_snapshot->'template_rows') = 'array' THEN GREATEST(1, jsonb_array_length(data_snapshot->'template_rows'))
        ELSE 1 END AS expected
    FROM frozen_cases
  ), run_cases AS (
    SELECT COALESCE(planned.execution_id, observed.execution_id) AS execution_id,
      GREATEST(COALESCE(planned.expected, 0), COALESCE(observed.observed, 0)) AS total,
      COALESCE(observed.passed, 0) AS passed, COALESCE(observed.failed, 0) AS failed,
      COALESCE(observed.blocked, 0) AS blocked, COALESCE(observed.other, 0) AS other,
      observed.latest_evidence_at, observed.latest_lifecycle_at
    FROM planned_cases planned FULL OUTER JOIN case_results observed
      ON observed.execution_id = planned.execution_id AND observed.test_case_id = planned.test_case_id
  ), totals AS (
    SELECT execution_id, SUM(total) AS total, SUM(passed) AS passed, SUM(failed) AS failed,
      SUM(blocked) AS blocked, SUM(other) AS other, MAX(latest_evidence_at) AS latest_evidence_at,
      MAX(latest_lifecycle_at) AS latest_lifecycle_at
    FROM run_cases GROUP BY execution_id
  )
  SELECT scoped_runs.id, scoped_runs.name, scoped_runs.status, scoped_runs.started_at, scoped_runs.ended_at, scoped_runs.created_at, scoped_runs.activity_at, COALESCE(totals.total, 0) AS total, COALESCE(totals.passed, 0) AS passed,
    COALESCE(totals.failed, 0) AS failed, COALESCE(totals.blocked, 0) AS blocked,
    COALESCE(totals.other, 0) AS other, totals.latest_evidence_at, totals.latest_lifecycle_at
  FROM scoped_runs LEFT JOIN totals ON totals.execution_id = scoped_runs.id
  ORDER BY scoped_runs.activity_at DESC, scoped_runs.id DESC
`;

const getOverview = async ({ projectId, project, days = 30, visibility, now = Date.now() }) => {
  const window = windowFor(days, now);
  const visible = Object.fromEntries(['stories', 'cases', 'suites', 'runs', 'bugs', 'automation'].map(key => [key, visibility?.[key] === true]));
  visible.automation = visible.automation && visible.cases;
  const [stories, cases, suites, bugs, runs] = await Promise.all([
    visible.stories ? db.prepare(`SELECT COUNT(*) AS stories, ${visible.cases ? `COUNT(*) FILTER (WHERE EXISTS (
      SELECT 1 FROM requirement_test_cases mapping JOIN test_cases linked_case ON linked_case.id = mapping.test_case_id
      JOIN app_types app ON app.id = linked_case.app_type_id
      WHERE mapping.requirement_id = requirements.id AND app.project_id = requirements.project_id
    ) OR EXISTS (
      SELECT 1 FROM test_cases linked_case JOIN app_types app ON app.id = linked_case.app_type_id
      WHERE linked_case.requirement_id = requirements.id AND app.project_id = requirements.project_id
    ))` : 'NULL'} AS covered_stories FROM requirements WHERE project_id = ?`).get(projectId) : null,
    visible.cases ? db.prepare(`SELECT COUNT(*) AS cases,
      COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM test_steps WHERE test_steps.test_case_id = test_cases.id)) AS designed_cases,
      ${visible.automation ? "COUNT(*) FILTER (WHERE test_cases.automated = 'yes')" : 'NULL'} AS automated_cases
      FROM test_cases JOIN app_types ON app_types.id = test_cases.app_type_id WHERE app_types.project_id = ?`).get(projectId) : null,
    visible.suites ? db.prepare('SELECT COUNT(*) AS suites FROM test_suites JOIN app_types ON app_types.id = test_suites.app_type_id WHERE app_types.project_id = ?').get(projectId) : null,
    visible.bugs ? db.prepare(`SELECT COUNT(*) FILTER (WHERE LOWER(TRIM(COALESCE(status, ''))) NOT IN ('closed', 'resolved', 'done', 'accepted', 'cancelled', 'canceled')) AS open_defects
      FROM feedback WHERE project_id = ?`).get(projectId) : null,
    visible.runs ? db.prepare(RUN_SUMMARY_SQL).all(window.to, projectId, window.from, window.to) : []
  ]);
  const inventory = {
    stories: visible.stories ? number(stories?.stories) : null,
    covered_stories: visible.stories && visible.cases ? number(stories?.covered_stories) : null,
    cases: visible.cases ? number(cases?.cases) : null,
    designed_cases: visible.cases ? number(cases?.designed_cases) : null,
    suites: visible.suites ? number(suites?.suites) : null,
    automated_cases: visible.automation ? number(cases?.automated_cases) : null,
    open_defects: visible.bugs ? number(bugs?.open_defects) : null
  };
  const execution = { passed: null, failed: null, blocked: null, pending: null, other: null, total: null, latest_evidence_at: null, completed_runs: null, active_runs: null };
  const trend = [];
  const recentRuns = [];
  if (visible.runs) {
    for (const key of Object.keys(execution)) if (key !== 'latest_evidence_at') execution[key] = 0;
    for (let index = 0; index < window.days; index++) trend.push({ date: new Date(new Date(window.from).getTime() + index * DAY_MS).toISOString().slice(0, 10), runs: 0, passed: 0, failed: 0, blocked: 0 });
    const buckets = new Map(trend.map(bucket => [bucket.date, bucket]));
    for (const run of runs) {
      const counts = Object.fromEntries(['passed', 'failed', 'blocked', 'other', 'total'].map(key => [key, number(run[key])]));
      counts.pending = Math.max(0, counts.total - counts.passed - counts.failed - counts.blocked - counts.other);
      for (const [key, count] of Object.entries(counts)) execution[key] += count;
      const status = text(run.status).toLowerCase();
      if (TERMINAL_RUNS.has(status) && validTime(run.ended_at) !== null) execution.completed_runs++;
      if (ACTIVE_RUNS.has(status)) execution.active_runs++;
      const times = [run.latest_evidence_at, run.latest_lifecycle_at].map(validTime).filter(time => time !== null && time <= now);
      const time = times.length ? Math.max(...times) : null;
      if (time !== null && time > (validTime(execution.latest_evidence_at) || 0)) execution.latest_evidence_at = new Date(time).toISOString();
      const activity = validTime(run.activity_at);
      const bucket = activity === null ? null : buckets.get(new Date(activity).toISOString().slice(0, 10));
      if (bucket) { bucket.runs++; for (const key of ['passed', 'failed', 'blocked']) bucket[key] += counts[key]; }
      if (recentRuns.length < 10) recentRuns.push({ id: run.id, name: run.name || 'Untitled run', status: run.status || 'pending', started_at: run.started_at || null, ended_at: run.ended_at || null, ...counts });
    }
  }
  const attention = [];
  const addAttention = (count, id, type, title, detail, to, tone) => { if (count > 0) attention.push({ id, type, title, detail, to, tone }); };
  addAttention(execution.failed, 'failed-results', 'runs', `${execution.failed} failed test instances`, 'Review failures in the selected window and retain the execution evidence.', '/executions', 'danger');
  addAttention(execution.blocked, 'blocked-results', 'runs', `${execution.blocked} blocked test instances`, 'Resolve the blockers before treating this work as validated.', '/executions', 'warning');
  addAttention(inventory.open_defects, 'open-defects', 'bugs', `${inventory.open_defects} open defects`, 'Confirm severity, ownership and regression coverage.', '/issues', 'warning');
  addAttention(inventory.covered_stories === null ? 0 : inventory.stories - inventory.covered_stories, 'coverage-gaps', 'stories', `${inventory.stories - inventory.covered_stories} stories need test links`, 'Current project stories without a linked case in this project.', '/stories', 'warning');
  addAttention(inventory.designed_cases === null ? 0 : inventory.cases - inventory.designed_cases, 'design-gaps', 'cases', `${inventory.cases - inventory.designed_cases} cases have no steps`, 'Add executable steps and expected outcomes before scheduling these cases.', '/test-cases', 'warning');
  addAttention(execution.pending, 'pending-results', 'runs', `${execution.pending} test instances remain unfinished`, 'Includes planned rows without a result and pending, paused or running outcomes.', '/executions', 'info');
  return {
    project: { id: projectId, key: project?.display_id || project?.key || projectId, name: project?.name || projectId },
    evaluated_at: new Date(now).toISOString(), window, visibility: visible, inventory, execution, trend,
    recent_runs: recentRuns, attention: attention.slice(0, 8),
    evidence: { complete: true, latest_at: execution.latest_evidence_at, limitations: Object.entries(visible).filter(([, allowed]) => !allowed).map(([source]) => `${source} evidence is unavailable under the current permissions or feature policy.`) },
    methodology: {
      inventory: 'Current project inventory, independent of the selected execution window. Story coverage counts links to existing cases in this project. Designed cases contain at least one saved step.',
      execution: 'Latest attempt per run, test case and data row. Frozen planned rows without a result remain pending. N/A and aborted outcomes are shown separately from passed, failed and blocked results.',
      trend: 'UTC calendar days; each run is grouped by its end, start or creation date, in that order. Points show the latest outcomes for runs in that bucket, not a historical status snapshot.',
      availability: 'Unavailable source counts are null, not zero. Request failures are reported as errors, not partial success. No approval or predictive confidence score is calculated.'
    }
  };
};

module.exports = { getOverview, windowFor, evidenceTime, RUN_SUMMARY_SQL };
