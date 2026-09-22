const db = require('../db');
const { createHash } = require('crypto');
const { normalizeStoredReferenceList } = require('../utils/externalReferences');

const yes = (value) => value === true || value === 'true';
const selectedIds = (value, field) => {
  if (value === undefined) return null;
  const values = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : null;
  if (!values || values.some(id => typeof id !== 'string' || id.trim().length > 255)) {
    throw Object.assign(new Error(`${field} must contain comma-separated record IDs.`), { statusCode: 400 });
  }
  const ids = [...new Set(values.map(id => id.trim()).filter(Boolean))].sort();
  if (ids.length > 200) throw Object.assign(new Error(`${field} accepts at most 200 IDs per request.`), { statusCode: 400 });
  return ids;
};
const latestStatusSql = `(SELECT status FROM execution_results er WHERE er.test_case_id = tc.id ORDER BY er.created_at DESC, er.id DESC LIMIT 1)`;
const aiPendingSql = alias => `(NULLIF(${alias}.ai_generation_source, '') IS NOT NULL AND ${alias}.ai_generation_review_status = 'pending')`;
const pendingReviewSql = alias => `(${alias}.review_status = 'pending' OR (${aiPendingSql(alias)} AND COALESCE(${alias}.review_status, 'not_requested') NOT IN ('accepted', 'changes_requested')))`;
const workflowStatusSql = (includeExecution) => `CASE
  WHEN ${aiPendingSql('tc')} AND ${pendingReviewSql('tc')} THEN 'ai-generated'
  WHEN tc.review_status = 'pending' THEN 'pending-review'
  ${includeExecution ? `WHEN ${latestStatusSql} IN ('failed', 'blocked') THEN 'failed' WHEN ${latestStatusSql} = 'passed' THEN 'passed'` : ''}
  WHEN tc.automated = 'yes' THEN 'automated'
  ELSE COALESCE(tc.status, 'active') END`;

// EXISTS keeps one row per case even when a case has several Stories or Suites.
const buildScope = (query = {}) => {
  const picker = query.projection === 'picker';
  const where = ['1 = 1'];
  const params = [];
  if (query.review_queue !== undefined) {
    if (query.review_queue !== 'mine' || typeof query.review_user_id !== 'string' || !query.review_user_id.trim()) {
      throw Object.assign(new Error('review_queue must be mine and requires an authenticated reviewer.'), { statusCode: 400 });
    }
    // Only the authenticated route supplies review_user_id. Explicit reviewer
    // assignments win over creator fallback for older unassigned AI drafts.
    where.push(pendingReviewSql('tc'));
    where.push(`(tc.reviewer_id = ? OR (NULLIF(tc.reviewer_id, '') IS NULL AND ${aiPendingSql('tc')} AND tc.created_by = ?))`);
    params.push(query.review_user_id, query.review_user_id);
  }
  for (const [field, expression] of [
    ['app_type_id', 'tc.app_type_id = ?'],
    ['project_id', 'tc.app_type_id IN (SELECT id FROM app_types WHERE project_id = ?)'],
    ['suite_id', '(tc.suite_id = ? OR EXISTS (SELECT 1 FROM suite_test_cases m WHERE m.test_case_id = tc.id AND m.suite_id = ?))'],
    ['requirement_id', '(tc.requirement_id = ? OR EXISTS (SELECT 1 FROM requirement_test_cases m WHERE m.test_case_id = tc.id AND m.requirement_id = ?))'],
    ['module_id', 'EXISTS (SELECT 1 FROM test_case_effective_module_cases m WHERE m.test_case_id = tc.id AND m.module_id = ?)'],
    ['status', 'tc.status = ?'],
    ['priority', 'COALESCE(tc.priority, 3) = ?']
  ]) {
    if (query[field] !== undefined && query[field] !== '' && query[field] !== 'all') {
      where.push(expression);
      params.push(query[field]);
      if (field === 'requirement_id' || field === 'suite_id') params.push(query[field]);
    }
  }
  for (const field of ['ids', 'suite_ids']) {
    const ids = selectedIds(query[field], field);
    if (ids === null) continue;
    if (!ids.length) { where.push('false'); continue; }
    const placeholders = ids.map(() => '?').join(',');
    where.push(field === 'ids' ? `tc.id IN (${placeholders})`
      : `(tc.suite_id IN (${placeholders}) OR EXISTS (SELECT 1 FROM suite_test_cases m WHERE m.test_case_id = tc.id AND m.suite_id IN (${placeholders})))`);
    params.push(...ids, ...(field === 'suite_ids' ? ids : []));
  }
  if (query.automated !== undefined && query.automated !== '' && query.automated !== 'all') {
    if (!['yes', 'no'].includes(query.automated)) throw Object.assign(new Error('automated must be yes or no.'), { statusCode: 400 });
    where.push('tc.automated = ?'); params.push(query.automated);
  }
  if (query.label && query.label !== 'all') { where.push("COALESCE(tc.labels, '[]'::jsonb) @> ?::jsonb"); params.push(JSON.stringify([query.label])); }
  if (query.shared_step_group_id && query.shared_step_group_id !== 'all') {
    where.push('EXISTS (SELECT 1 FROM test_steps step WHERE step.test_case_id = tc.id AND step.reusable_group_id = ?)');
    params.push(query.shared_step_group_id);
  }
  if (!query.module_id && yes(query.unassigned_module)) where.push('NOT EXISTS (SELECT 1 FROM test_case_effective_module_cases m WHERE m.test_case_id = tc.id)');
  if (yes(query.exclude_automated)) where.push("COALESCE(tc.automated, 'no') <> 'yes'");
  if (query.workflow_status && query.workflow_status !== 'all') {
    where.push(`${workflowStatusSql(!picker && yes(query.include_execution))} = ?`);
    params.push(query.workflow_status);
  }
  if (!picker && ['with-steps', 'no-steps'].includes(query.step_filter)) where.push(`${query.step_filter === 'no-steps' ? 'NOT ' : ''}EXISTS (SELECT 1 FROM test_steps s WHERE s.test_case_id = tc.id)`);
  if (!picker && ['with-runs', 'no-runs'].includes(query.run_filter) && yes(query.include_execution)) where.push(`${query.run_filter === 'no-runs' ? 'NOT ' : ''}EXISTS (SELECT 1 FROM execution_results r WHERE r.test_case_id = tc.id)`);
  const search = String(query.search || '').trim();
  if (search) {
    const pattern = `%${search.replace(/[\\%_]/g, '\\$&')}%`;
    where.push(`(concat_ws(' ', tc.id, tc.display_id, tc.title, tc.description, tc.labels::text,
      tc.external_references::text, tc.review_status, replace(${workflowStatusSql(!picker && yes(query.include_execution))}, '-', ' ')) ILIKE ? ESCAPE '\\'
      OR EXISTS (SELECT 1 FROM test_case_effective_module_cases m JOIN test_case_modules mo ON mo.id = m.module_id WHERE m.test_case_id = tc.id AND mo.name ILIKE ? ESCAPE '\\')
      OR EXISTS (SELECT 1 FROM requirement_test_cases m JOIN requirements r ON r.id = m.requirement_id WHERE m.test_case_id = tc.id AND concat_ws(' ', r.id, r.display_id, r.title) ILIKE ? ESCAPE '\\')
      OR EXISTS (SELECT 1 FROM requirements r WHERE r.id = tc.requirement_id AND concat_ws(' ', r.id, r.display_id, r.title) ILIKE ? ESCAPE '\\')
      OR EXISTS (SELECT 1 FROM test_suites suite WHERE suite.app_type_id = tc.app_type_id AND (suite.id = tc.suite_id OR EXISTS (SELECT 1 FROM suite_test_cases m WHERE m.test_case_id = tc.id AND m.suite_id = suite.id)) AND concat_ws(' ', suite.id, suite.display_id, suite.name) ILIKE ? ESCAPE '\\')
      OR EXISTS (SELECT 1 FROM test_steps step JOIN shared_step_groups shared ON shared.id = step.reusable_group_id AND shared.app_type_id = tc.app_type_id WHERE step.test_case_id = tc.id AND concat_ws(' ', shared.id, shared.display_id, shared.name) ILIKE ? ESCAPE '\\')
      OR EXISTS (SELECT 1 FROM users u WHERE u.id = tc.reviewer_id AND concat_ws(' ', u.name, u.email) ILIKE ? ESCAPE '\\'))`);
    params.push(...Array(7).fill(pattern));
  }
  return { where: where.join(' AND '), params };
};

const readCursor = (cursor, scope) => {
  if (!cursor) return null;
  try {
    const value = JSON.parse(Buffer.from(String(cursor), 'base64url').toString('utf8'));
    if (value.scope !== scope || typeof value.id !== 'string' || (value.activity !== null && (typeof value.activity !== 'string' || !Number.isFinite(Date.parse(value.activity)))) || !Number.isSafeInteger(value.offset) || value.offset < 0) throw new Error();
    return value;
  } catch {
    throw Object.assign(new Error('The pagination cursor is invalid for these filters.'), { statusCode: 400 });
  }
};

const PICKER_FIELDS = `tc.id, tc.display_id, tc.app_type_id, tc.suite_id, tc.title,
  LEFT(tc.description, 240) AS description, tc.labels, tc.priority, tc.status, tc.automated,
  tc.automation_status, tc.authoring_mode, tc.test_case_type, tc.requirement_id,
  tc.review_status, tc.created_at, tc.updated_at`;

// Membership display metadata is resolved only after the requested page is fixed.
// No authoring steps, execution history, coverage counts or metric payloads are read.
const pickerPageSql = (pageSql) => `WITH picker_page AS MATERIALIZED (${pageSql})
  SELECT p.*, COALESCE(suites.ids, '[]'::jsonb) AS suite_ids, COALESCE(suites.names, '[]'::jsonb) AS suite_names,
    COALESCE(requirements.ids, '[]'::jsonb) AS requirement_ids, COALESCE(requirements.names, '[]'::jsonb) AS requirement_titles,
    COALESCE(modules.ids, '[]'::jsonb) AS module_ids, COALESCE(modules.names, '[]'::jsonb) AS module_names,
    COALESCE(shared.ids, '[]'::jsonb) AS shared_step_group_ids, COALESCE(shared.names, '[]'::jsonb) AS shared_step_group_names
  FROM picker_page p
  LEFT JOIN LATERAL (
    SELECT jsonb_agg(linked.id ORDER BY linked.id) AS ids, jsonb_agg(linked.name ORDER BY linked.id) AS names
    FROM (SELECT suite.id, suite.name FROM test_suites suite WHERE suite.id = p.suite_id AND suite.app_type_id = p.app_type_id
      UNION SELECT suite.id, suite.name FROM suite_test_cases link JOIN test_suites suite ON suite.id = link.suite_id
      WHERE link.test_case_id = p.id AND suite.app_type_id = p.app_type_id) linked
  ) suites ON TRUE
  LEFT JOIN LATERAL (
    SELECT jsonb_agg(linked.id ORDER BY linked.id) AS ids, jsonb_agg(linked.title ORDER BY linked.id) AS names
    FROM (SELECT story.id, story.title FROM requirements story JOIN app_types app ON app.project_id = story.project_id
      WHERE story.id = p.requirement_id AND app.id = p.app_type_id
      UNION SELECT story.id, story.title FROM requirement_test_cases link JOIN requirements story ON story.id = link.requirement_id
      JOIN app_types app ON app.project_id = story.project_id WHERE link.test_case_id = p.id AND app.id = p.app_type_id) linked
  ) requirements ON TRUE
  LEFT JOIN LATERAL (
    SELECT jsonb_agg(module.id ORDER BY module.id) AS ids, jsonb_agg(module.name ORDER BY module.id) AS names
    FROM test_case_effective_module_cases link JOIN test_case_modules module ON module.id = link.module_id
    WHERE link.test_case_id = p.id AND module.app_type_id = p.app_type_id
  ) modules ON TRUE
  LEFT JOIN LATERAL (
    SELECT jsonb_agg(linked.id ORDER BY linked.id) AS ids, jsonb_agg(linked.name ORDER BY linked.id) AS names
    FROM (SELECT DISTINCT group_record.id, group_record.name FROM test_steps step
      JOIN shared_step_groups group_record ON group_record.id = step.reusable_group_id
      WHERE step.test_case_id = p.id AND group_record.app_type_id = p.app_type_id) linked
  ) shared ON TRUE
  ORDER BY COALESCE(p.updated_at, p.created_at) DESC NULLS LAST, p.id DESC`;

exports.listPage = async (query = {}) => {
  const picker = query.projection === 'picker';
  const { where, params } = buildScope(query);
  const scope = createHash('sha256').update(JSON.stringify(picker ? [where, params, 'picker'] : [where, params])).digest('hex').slice(0, 20);
  const cursor = readCursor(query.cursor, scope);
  const size = Math.min(picker ? 25 : 200, Math.max(1, Number.parseInt(query.page_size || query.limit, 10) || 25));
  const membership = !picker && (query.module_id || query.suite_id);
  const order = membership && query.module_id
    ? `(SELECT sort_order FROM test_case_effective_module_cases m WHERE m.test_case_id = tc.id AND m.module_id = ?) ASC, tc.title ASC, tc.id ASC`
    : membership && query.suite_id
      ? `(SELECT sort_order FROM suite_test_cases m WHERE m.test_case_id = tc.id AND m.suite_id = ?) ASC, tc.title ASC, tc.id ASC`
      : 'COALESCE(tc.updated_at, tc.created_at) DESC NULLS LAST, tc.id DESC';
  // A compact cursor carries an offset for explicitly ordered membership lists,
  // and an activity/id key for the main catalog to stay stable on concurrent inserts.
  const cursorCondition = cursor?.activity === null
    ? 'COALESCE(tc.updated_at, tc.created_at) IS NULL AND tc.id < ?'
    : '((COALESCE(tc.updated_at, tc.created_at), tc.id) < (?::timestamptz, ?) OR COALESCE(tc.updated_at, tc.created_at) IS NULL)';
  const pageWhere = cursor && !membership ? `${where} AND (${cursorCondition})` : where;
  const pageParams = [...params, ...(cursor && !membership ? (cursor.activity === null ? [cursor.id] : [cursor.activity, cursor.id]) : []), ...(membership ? [membership] : []), size + 1, ...(membership ? [cursor?.offset || 0] : [])];
  const projection = picker ? PICKER_FIELDS : query.projection === 'summary' ? `tc.id, tc.display_id, tc.app_type_id, tc.suite_id,
    tc.title, tc.description, tc.external_references, tc.labels, tc.automated, tc.automation_status,
    tc.manual_test_case_id, tc.authoring_mode, tc.test_case_type, tc.priority, tc.status, tc.requirement_id,
    tc.reviewer_id, tc.review_status, tc.ai_quality_score, tc.author_id, tc.source_issue_id,
    tc.ai_generation_source, tc.ai_generation_review_status, tc.ai_generation_job_id, tc.ai_generated_at,
    tc.created_by, tc.created_at, tc.updated_by, tc.updated_at` : 'tc.*';
  const includeTotal = picker ? yes(query.include_total) : query.include_total !== false && query.include_total !== 'false';
  const pageSql = `SELECT ${projection}, COALESCE(tc.updated_at, tc.created_at)::text AS cursor_activity FROM test_cases tc WHERE ${pageWhere} ORDER BY ${order} LIMIT ? ${membership ? 'OFFSET ?' : ''}`;
  const [rows, count] = await Promise.all([
    db.prepare(picker ? pickerPageSql(pageSql) : pageSql).all(...pageParams),
    includeTotal ? db.prepare(`SELECT COUNT(*)::int AS total FROM test_cases tc WHERE ${where}`).get(...params) : Promise.resolve(null)
  ]);
  const hasNext = rows.length > size;
  const pageRows = rows.slice(0, size);
  const ids = pageRows.map((row) => row.id);
  let summaries = [];
  if (!picker && ids.length) {
    // Revisions live in captured version history, not on test_cases. Resolve
    // the current revision only for this page, matching the review/edit guard.
    summaries = await db.prepare(`SELECT tc.id,
      (SELECT COALESCE(MAX(v.revision), 0) + 1 FROM test_case_versions v WHERE v.test_case_id = tc.id) AS revision,
      (SELECT COUNT(*)::int FROM test_steps s WHERE s.test_case_id = tc.id) AS step_count,
      COALESCE((SELECT jsonb_agg(m.suite_id ORDER BY m.sort_order, m.suite_id) FROM suite_test_cases m WHERE m.test_case_id = tc.id), '[]') AS suite_ids,
      COALESCE((SELECT jsonb_agg(m.requirement_id) FROM requirement_test_cases m WHERE m.test_case_id = tc.id), '[]') AS requirement_ids,
      COALESCE((SELECT jsonb_agg(linked ORDER BY linked.id) FROM (
        SELECT story.id, story.display_id, story.title FROM requirements story
        JOIN app_types app ON app.project_id = story.project_id AND app.id = tc.app_type_id
        WHERE story.id = tc.requirement_id OR EXISTS (SELECT 1 FROM requirement_test_cases link WHERE link.test_case_id = tc.id AND link.requirement_id = story.id)
      ) linked), '[]') AS linked_requirements,
      COALESCE((SELECT jsonb_agg(m.module_id ORDER BY m.is_explicit DESC, m.sort_order, m.module_id) FROM test_case_effective_module_cases m WHERE m.test_case_id = tc.id), '[]') AS module_ids,
      COALESCE((SELECT jsonb_agg(m.issue_id) FROM test_case_defects m WHERE m.test_case_id = tc.id), '[]') AS defect_ids,
      ${yes(query.include_execution) ? `(SELECT COUNT(*)::int FROM execution_results er WHERE er.test_case_id = tc.id)` : 'NULL'} AS run_count,
      ${yes(query.include_execution) ? `COALESCE((SELECT jsonb_agg(r) FROM (SELECT id, execution_id, test_case_id, app_type_id, status, duration_ms, created_at FROM execution_results er WHERE er.test_case_id = tc.id ORDER BY created_at DESC, id DESC LIMIT 10) r), '[]')` : "'[]'::jsonb"} AS recent_results
      FROM test_cases tc WHERE tc.id IN (${ids.map(() => '?').join(',')})`).all(...ids);
  }
  const byId = new Map(summaries.map((row) => [row.id, row]));
  const items = pageRows.map(({ cursor_activity, ...row }) => {
    if (picker) return { ...row, labels: normalizeStoredReferenceList(row.labels), detail_complete: false, summary_complete: false };
    const summary = byId.get(row.id) || {};
    const result = { ...row, ...summary, external_references: normalizeStoredReferenceList(row.external_references), labels: normalizeStoredReferenceList(row.labels), detail_complete: false, summary_complete: true };
    result.requirement_ids = [...new Set([row.requirement_id, ...(summary.requirement_ids || [])].filter(Boolean))];
    if (query.projection === 'summary') {
      for (const field of ['gherkin_document', 'parameter_values', 'review_history']) delete result[field];
    }
    return result;
  });
  const last = pageRows.at(-1);
  return { items, ...(includeTotal ? { total: Number(count?.total || 0) } : {}), is_last: !hasNext,
    next_cursor: hasNext && last ? Buffer.from(JSON.stringify({ scope, id: last.id, activity: last.cursor_activity === null ? null : String(last.cursor_activity), offset: (cursor?.offset || 0) + size })).toString('base64url') : null };
};

const percent = (n, total) => total ? Math.round(Number(n) / Number(total) * 100) : 0;
exports.getReviewSummary = async ({ project_id, app_type_id, review_user_id } = {}) => {
  if (typeof review_user_id !== 'string' || !review_user_id.trim()) {
    throw Object.assign(new Error('An authenticated reviewer is required.'), { statusCode: 400 });
  }
  // One scoped aggregate supplies the overall card and the personal review
  // action. Neither count depends on visible pages, search or module filters.
  const { where, params } = buildScope({ project_id, app_type_id });
  const row = await db.prepare(`SELECT COUNT(*)::int AS overall_pending,
    COUNT(*) FILTER (WHERE tc.reviewer_id = ? OR
      (NULLIF(tc.reviewer_id, '') IS NULL AND ${aiPendingSql('tc')} AND tc.created_by = ?))::int AS pending
    FROM test_cases tc WHERE ${where} AND ${pendingReviewSql('tc')}`).get(review_user_id, review_user_id, ...params);
  return { pending: Number(row?.pending || 0), overall_pending: Number(row?.overall_pending || 0) };
};
exports.getMetrics = async (query = {}) => {
  const { where, params } = buildScope(query);
  const execution = yes(query.include_execution);
  // Recent pass rate samples ten results; case health keeps the latest finalized
  // outcome across the full history so a queued/running retry cannot erase it.
  const rows = await db.prepare(`WITH scoped AS MATERIALIZED (
    SELECT tc.id, tc.priority, tc.automated, tc.review_status, tc.ai_generation_source, tc.ai_generation_review_status,
      ARRAY(SELECT module_id FROM test_case_effective_module_cases m WHERE m.test_case_id = tc.id) AS module_ids,
      (tc.requirement_id IS NOT NULL OR EXISTS (SELECT 1 FROM requirement_test_cases m WHERE m.test_case_id = tc.id)) AS covered,
      EXISTS (SELECT 1 FROM suite_test_cases m WHERE m.test_case_id = tc.id) AS with_suites,
      EXISTS (SELECT 1 FROM test_steps s WHERE s.test_case_id = tc.id) AS executable
    FROM test_cases tc WHERE ${where}
  ), facts AS (
    SELECT s.*, r.* FROM scoped s LEFT JOIN LATERAL (
      ${execution ? `SELECT COUNT(*)::int AS runs, COUNT(*) FILTER (WHERE status IN ('passed','failed','blocked'))::int AS finalized,
        COUNT(*) FILTER (WHERE status = 'passed')::int AS passed,
        SUM(duration_ms) FILTER (WHERE status IN ('passed','failed') AND duration_ms >= 0) AS duration_sum,
        COUNT(*) FILTER (WHERE status IN ('passed','failed') AND duration_ms >= 0)::int AS duration_count,
        (SELECT er.status FROM execution_results er WHERE er.test_case_id = s.id AND er.status IN ('passed','failed','blocked')
          ORDER BY er.created_at DESC NULLS LAST, er.id DESC LIMIT 1) AS latest_finalized
        FROM (SELECT id, status, duration_ms, created_at FROM execution_results er WHERE er.test_case_id = s.id ORDER BY created_at DESC, id DESC LIMIT 10) recent`
        : `SELECT 0 AS runs, 0 AS finalized, 0 AS passed, NULL::bigint AS duration_sum, 0 AS duration_count, NULL::text AS latest_finalized`}
    ) r ON TRUE
  ) , memberships AS (
    SELECT facts.*, scope.catalog, scope.module_id FROM facts
    CROSS JOIN LATERAL (
      SELECT 1 AS catalog, NULL::text AS module_id
      UNION ALL SELECT 0, unnest(CASE WHEN cardinality(facts.module_ids) = 0 THEN ARRAY[NULL::text] ELSE facts.module_ids END)
    ) scope
  ), rollups AS (SELECT catalog, module_id, COUNT(*)::int AS count,
    COUNT(*) FILTER (WHERE covered)::int AS covered, COUNT(*) FILTER (WHERE executable)::int AS executable,
    COUNT(*) FILTER (WHERE with_suites)::int AS with_suites,
    COUNT(*) FILTER (WHERE automated = 'yes')::int AS automated,
    COUNT(*) FILTER (WHERE automated IN ('yes','no'))::int AS automation_known,
    COUNT(*) FILTER (WHERE runs > 0)::int AS with_history,
    COUNT(*) FILTER (WHERE latest_finalized = 'blocked')::int AS blocked,
    COUNT(*) FILTER (WHERE latest_finalized = 'failed')::int AS failed,
    COUNT(*) FILTER (WHERE latest_finalized IS NOT NULL)::int AS executed,
    COUNT(*) FILTER (WHERE latest_finalized = 'passed')::int AS latest_passed,
    COALESCE(SUM(finalized),0)::int AS finalized, COALESCE(SUM(passed),0)::int AS passed,
    COALESCE(SUM(duration_sum),0)::float8 AS duration_sum, COALESCE(SUM(duration_count),0)::int AS duration_count,
    COUNT(*) FILTER (WHERE ${pendingReviewSql('f')})::int AS pending_review,
    COUNT(*) FILTER (WHERE NOT covered OR NOT executable OR latest_finalized IN ('failed','blocked') OR (COALESCE(priority,3) <= 2 AND automated = 'no'))::int AS risk
    FROM memberships f GROUP BY catalog, module_id)
    SELECT rollups.*, (SELECT COUNT(DISTINCT d.issue_id)::int FROM test_case_defects d JOIN scoped ds ON ds.id = d.test_case_id
      WHERE rollups.catalog = 1 OR rollups.module_id = ANY(ds.module_ids) OR (rollups.module_id IS NULL AND cardinality(ds.module_ids) = 0)) AS defects FROM rollups`).all(...params);
  const health = (row = {}) => ({
    count: Number(row.count || 0), traceabilityPercent: percent(row.covered, row.count), executablePercent: percent(row.executable, row.count),
    automationPercent: percent(row.automated, row.automation_known), summaryComplete: true, unknownSummaryCount: 0,
    executionPercent: percent(row.executed, row.count), passRatePercent: row.finalized ? percent(row.passed, row.finalized) : null,
    latestPassRatePercent: row.executed ? percent(row.latest_passed, row.executed) : null,
    stabilityPercent: row.finalized ? percent(row.passed, row.finalized) : null,
    averageExecutionMs: row.duration_count ? Math.round(row.duration_sum / row.duration_count) : null,
    executionDurationSampleCount: Number(row.duration_count || 0), pendingReviewCount: Number(row.pending_review || 0),
    defectCount: Number(row.defects || 0), defectDensity: row.count ? Number((row.defects / row.count).toFixed(2)) : 0, riskCount: Number(row.risk || 0)
  });
  const all = rows.find((row) => row.catalog === 1) || {};
  return {
    coverage: { total: Number(all.count || 0), covered: Number(all.covered || 0), automated: Number(all.automated || 0), automationKnown: Number(all.automation_known || 0), withHistory: Number(all.with_history || 0), withSuites: Number(all.with_suites || 0) },
    catalog: { total: Number(all.count || 0), automationPercent: percent(all.automated, all.automation_known), blocked: Number(all.blocked || 0), failed: Number(all.failed || 0), critical: Number(all.blocked || 0) + Number(all.failed || 0), averageExecutionMs: health(all).averageExecutionMs, executionDurationSampleCount: Number(all.duration_count || 0), finalizedResults: Number(all.finalized || 0), passedResults: Number(all.passed || 0), recentPassRate: all.finalized ? percent(all.passed, all.finalized) : null },
    modules: Object.fromEntries(rows.filter((row) => !row.catalog && row.module_id).map((row) => [row.module_id, health(row)])),
    unassigned: health(rows.find((row) => !row.catalog && !row.module_id))
  };
};
exports.buildScope = buildScope;
