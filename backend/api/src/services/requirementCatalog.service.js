const db = require('../db');
const { createHash } = require('crypto');

const { latestFinalizedCaseResultsCte } = require('../utils/finalizedCaseMetrics');
const yes = (value) => value === true || value === 'true';
const NORMALIZED_STATUS = `LOWER(REGEXP_REPLACE(TRIM(COALESCE(r.status, '')), '[ _-]+', '_', 'g'))`;
const STATUS_RANK = `CASE ${NORMALIZED_STATUS} WHEN 'dev_ready' THEN 1 WHEN 'in_progress' THEN 2 WHEN 'blocked' THEN 2 WHEN 'dev_in_progress' THEN 2 WHEN 'dev_blocked' THEN 2 WHEN 'dev_done' THEN 3 WHEN 'ready' THEN 4 WHEN 'qa_ready' THEN 4 WHEN 'qa_in_progress' THEN 5 WHEN 'qa_blocked' THEN 5 WHEN 'qa_done' THEN 6 WHEN 'done' THEN 7 WHEN 'closed' THEN 7 WHEN 'resolved' THEN 7 WHEN 'accepted' THEN 7 WHEN 'complete' THEN 7 WHEN 'completed' THEN 7 ELSE 0 END`;
const ASSIGNED = `(r.iteration_id IS NOT NULL OR NULLIF(TRIM(r.sprint), '') IS NOT NULL)`;
// Empty rich-text markup and whitespace-only scenario entries do not document intent.
const hasText = (value) => `NULLIF(TRIM(REGEXP_REPLACE(REGEXP_REPLACE(REGEXP_REPLACE(COALESCE(${value}, ''), '<[^>]*>', '', 'g'), '&(nbsp|#160|#x0*a0);', ' ', 'gi'), '[[:space:] ]+', ' ', 'g')), '') IS NOT NULL`;
const SPECIFIED = `(EXISTS (SELECT 1 FROM jsonb_array_elements_text(CASE WHEN jsonb_typeof(r.gherkin_scenarios) = 'array' THEN r.gherkin_scenarios ELSE '[]'::jsonb END) scenario WHERE ${hasText('scenario')}) OR ${hasText('r.specification_content')})`;
const DESCRIBED = hasText('r.description');
// Targets are stored as UTC dates. The current due date has not been missed.
const overdue = (field) => `(${field} AT TIME ZONE 'UTC')::date < (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date`;
const SLIPPED = `((${overdue('r.dev_completion_target_date')} AND ${STATUS_RANK} < 3) OR (${overdue('r.qa_completion_target_date')} AND ${STATUS_RANK} < 6))`;
const CASE_LINKED = `(EXISTS (SELECT 1 FROM requirement_test_cases links JOIN test_cases tc ON tc.id = links.test_case_id LEFT JOIN app_types app ON app.id = tc.app_type_id WHERE links.requirement_id = r.id AND (tc.app_type_id IS NULL OR app.project_id = r.project_id)) OR EXISTS (SELECT 1 FROM test_cases tc LEFT JOIN app_types app ON app.id = tc.app_type_id WHERE tc.requirement_id = r.id AND (tc.app_type_id IS NULL OR app.project_id = r.project_id)))`;
const AUTOMATED = `(LOWER(TRIM(tc.automated)) = 'yes' OR LOWER(TRIM(tc.automation_status)) IN ('ready', 'automated', 'yes', 'covered'))`;
const BUG_CLOSED = `LOWER(TRIM(COALESCE(bug.status, ''))) IN ('closed', 'resolved', 'done', 'accepted', 'complete', 'completed', 'fixed', 'verified')`;

// Apply every catalog filter before LIMIT so matches beyond the loaded page remain discoverable.
function buildWhere(query = {}) {
  const clauses = ['1 = 1'];
  const params = [];
  const eq = (column, value) => { if (value !== undefined && value !== null && value !== '' && value !== 'all') { clauses.push(`${column} = ?`); params.push(value); } };
  eq('r.project_id', query.project_id);
  if (query.status && query.status !== 'all') { clauses.push(`${NORMALIZED_STATUS} = ?`); params.push(String(query.status).trim().toLowerCase().replace(/[ _-]+/g, '_')); }
  eq('COALESCE(r.priority, 3)', query.priority);
  if (query.sprint_id && query.sprint_id !== 'all') {
    clauses.push(`(r.iteration_id = ? OR (r.iteration_id IS NULL AND EXISTS (SELECT 1 FROM requirement_iterations i WHERE i.id = ? AND i.project_id = r.project_id AND LOWER(TRIM(i.name)) = LOWER(TRIM(r.sprint))) AND (SELECT COUNT(*) FROM requirement_iterations i WHERE i.project_id = r.project_id AND LOWER(TRIM(i.name)) = LOWER(TRIM(r.sprint))) = 1))`);
    params.push(query.sprint_id, query.sprint_id);
  }
  eq('r.fix_version', query.fix_version);
  eq('r.release', query.release);
  if (query.unassigned === true || query.unassigned === 'true') clauses.push(`NOT ${ASSIGNED}`);
  if (query.sprint && query.sprint !== 'all') { clauses.push('(r.sprint = ? OR EXISTS (SELECT 1 FROM requirement_iterations i WHERE i.id = r.iteration_id AND i.name = ?))'); params.push(query.sprint, query.sprint); }
  if (query.label && query.label !== 'all') { clauses.push('COALESCE(r.labels, \'[]\'::jsonb) @> ?::jsonb'); params.push(JSON.stringify([query.label])); }
  if (query.coverage === 'linked' || query.coverage === 'unlinked') clauses.push(`${query.coverage === 'unlinked' ? 'NOT ' : ''}${CASE_LINKED}`);
  if (String(query.search || '').trim()) {
    clauses.push(`(CONCAT_WS(' ', r.id, r.display_id, r.title, r.description, r.external_references::text, r.labels::text, r.sprint, r.fix_version, r.release, r.status, 'p' || COALESCE(r.priority, 3), 'priority ' || COALESCE(r.priority, 3)) ILIKE ? ESCAPE '\\'
      OR EXISTS (SELECT 1 FROM test_cases tc WHERE (tc.requirement_id = r.id OR EXISTS (SELECT 1 FROM requirement_test_cases links WHERE links.requirement_id = r.id AND links.test_case_id = tc.id)) AND tc.id ILIKE ? ESCAPE '\\')
      OR EXISTS (SELECT 1 FROM requirement_defects links JOIN feedback bug ON bug.id = links.issue_id WHERE links.requirement_id = r.id AND CONCAT_WS(' ', bug.id, bug.title, bug.status) ILIKE ? ESCAPE '\\')
      OR EXISTS (SELECT 1 FROM requirement_iterations i WHERE i.id = r.iteration_id AND i.name ILIKE ? ESCAPE '\\'))`);
    const term = `%${String(query.search).trim().replace(/[\\%_]/g, '\\$&')}%`;
    params.push(term, term, term, term);
  }
  return { sql: clauses.join(' AND '), params };
}

function pageOptions(query, scope) {
  const limit = Math.max(1, Math.min(200, Number.parseInt(String(query.page_size || query.limit || 25), 10) || 25));
  let cursor = null;
  if (query.cursor) {
    try {
      cursor = JSON.parse(Buffer.from(String(query.cursor), 'base64url').toString('utf8'));
      const validTimestamp = (value) => value === null || (typeof value === 'string' && Number.isFinite(Date.parse(value)));
      if (cursor.scope !== scope || typeof cursor.id !== 'string' || !cursor.id || !validTimestamp(cursor.activity) || !validTimestamp(cursor.created_at) || (cursor.activity === null && cursor.created_at !== null)) throw new Error('invalid');
    } catch { throw Object.assign(new Error('The pagination cursor is invalid for these filters.'), { statusCode: 400 }); }
  }
  return { limit, cursor };
}

exports.getPage = async (query = {}, hydrate) => {
  const { sql, params } = buildWhere(query);
  const scope = createHash('sha256').update(JSON.stringify([sql, params])).digest('base64url');
  const { limit, cursor } = pageOptions(query, scope);
  const projection = query.projection === 'summary'
    ? `r.id, r.display_id, r.project_id, r.title, LEFT(r.description, 1600) AS description, r.priority, r.status, r.iteration_id, r.sprint, r.fix_version, r.release, r.labels, r.external_references, r.gherkin_scenarios, LEFT(r.specification_content, 1600) AS specification_content, r.specification_format, r.scrum_team, r.dev_completion_target_date, r.qa_completion_target_date, r.created_at, r.updated_at, r.created_by, r.updated_by, r.revision`
    : 'r.*';
  let pageWhere = sql;
  const pageParams = [...params];
  if (cursor) {
    const activity = 'COALESCE(r.updated_at, r.created_at)';
    if (cursor.activity === null) {
      // A null activity means both timestamp columns are null; IDs order this tail.
      pageWhere += ` AND ${activity} IS NULL AND r.id < ?`;
      pageParams.push(cursor.id);
    } else if (cursor.created_at === null) {
      pageWhere += ` AND (${activity} < ?::timestamptz OR ${activity} IS NULL OR (${activity} = ?::timestamptz AND r.created_at IS NULL AND r.id < ?))`;
      pageParams.push(cursor.activity, cursor.activity, cursor.id);
    } else {
      pageWhere += ` AND ((${activity}, r.created_at, r.id) < (?::timestamptz, ?::timestamptz, ?) OR ${activity} IS NULL OR (${activity} = ?::timestamptz AND r.created_at IS NULL))`;
      pageParams.push(cursor.activity, cursor.created_at, cursor.id, cursor.activity);
    }
  }
  pageParams.push(limit + 1);
  const includeTotal = query.include_total !== false && query.include_total !== 'false';
  const [rows, count] = await Promise.all([
    db.prepare(`SELECT ${projection}, COALESCE(r.updated_at, r.created_at)::text AS cursor_activity, r.created_at::text AS cursor_created_at FROM requirements r WHERE ${pageWhere} ORDER BY COALESCE(r.updated_at, r.created_at) DESC NULLS LAST, r.created_at DESC NULLS LAST, r.id DESC LIMIT ?`).all(...pageParams),
    includeTotal ? db.prepare(`SELECT COUNT(*)::INTEGER AS total FROM requirements r WHERE ${sql}`).get(...params) : Promise.resolve(null)
  ]);
  const hasNext = rows.length > limit;
  const pageRows = rows.slice(0, limit);
  const items = await exports.withCatalogMetrics(await hydrate(pageRows.map(({ cursor_activity, cursor_created_at, ...row }) => row)), query);
  const last = pageRows.at(-1);
  // PostgreSQL timestamp text retains microseconds that JS Date would truncate.
  const nextCursor = hasNext && last ? Buffer.from(JSON.stringify({ scope, id: last.id, activity: last.cursor_activity === null ? null : String(last.cursor_activity), created_at: last.cursor_created_at === null ? null : String(last.cursor_created_at) })).toString('base64url') : null;
  return { items: query.projection === 'summary' ? items.map((row) => ({ ...row, detail_complete: false })) : items, ...(includeTotal ? { total: Number(count?.total || 0) } : {}), next_cursor: nextCursor, is_last: !hasNext };
};

// Case ownership exists in both legacy direct FKs and the many-to-many links.
// UNION prevents double counting when migrations or edits populate both paths.
const factsCte = (sql, includeExecution = false) => `WITH base AS MATERIALIZED (
  SELECT r.id, r.project_id,
    COALESCE(r.iteration_id, (SELECT MIN(i.id) FROM requirement_iterations i WHERE i.project_id = r.project_id AND LOWER(TRIM(i.name)) = LOWER(TRIM(r.sprint)) HAVING COUNT(*) = 1)) AS iteration_id,
    r.priority, r.status, r.scrum_team,
    ${STATUS_RANK} AS status_rank, ${ASSIGNED} AS assigned,
    ${SPECIFIED} AS specified, ${DESCRIBED} AS described,
    COALESCE(${SLIPPED}, false) AS slipped,
    (NULLIF(TRIM(r.fix_version), '') IS NOT NULL OR NULLIF(TRIM(r.release), '') IS NOT NULL
      OR EXISTS (SELECT 1 FROM requirement_release_items ri JOIN requirement_releases rel ON rel.id = ri.release_id WHERE ri.requirement_id = r.id AND rel.project_id = r.project_id)) AS release_scoped
  FROM requirements r WHERE ${sql}
), linked_cases AS (
  SELECT b.id AS requirement_id, b.project_id, tc.id AS test_case_id, ${AUTOMATED} AS automated
  FROM base b JOIN requirement_test_cases link ON link.requirement_id = b.id
  JOIN test_cases tc ON tc.id = link.test_case_id LEFT JOIN app_types app ON app.id = tc.app_type_id
  WHERE tc.app_type_id IS NULL OR app.project_id = b.project_id
  UNION
  SELECT b.id, b.project_id, tc.id, ${AUTOMATED}
  FROM base b JOIN test_cases tc ON tc.requirement_id = b.id LEFT JOIN app_types app ON app.id = tc.app_type_id
  WHERE tc.app_type_id IS NULL OR app.project_id = b.project_id
), linked_bugs AS (
  SELECT DISTINCT b.id AS requirement_id, bug.id AS issue_id, ${BUG_CLOSED} AS closed,
    (LOWER(TRIM(COALESCE(bug.priority, ''))) IN ('highest', 'high', 'p1', 'p2', '1', '2', 'critical')
      OR LOWER(TRIM(COALESCE(bug.severity, ''))) IN ('critical', 'high')) AS high_priority
  FROM base b JOIN requirement_defects link ON link.requirement_id = b.id
  JOIN feedback bug ON bug.id = link.issue_id AND bug.project_id = b.project_id
), ${includeExecution ? latestFinalizedCaseResultsCte(`SELECT er.id, er.execution_id, er.test_case_id, er.status, er.created_at, er.ended_at, er.data_set_iteration_index, er.data_set_iteration_key FROM execution_results er JOIN executions e ON e.id = er.execution_id WHERE EXISTS (SELECT 1 FROM linked_cases linked WHERE linked.test_case_id = er.test_case_id AND linked.project_id = e.project_id)`)
  : `latest_finalized AS (SELECT NULL::text AS test_case_id, NULL::text AS status WHERE false)`},
case_facts AS (
  SELECT linked.requirement_id, COUNT(*)::INTEGER AS linked_cases,
    COUNT(*) FILTER (WHERE linked.automated)::INTEGER AS automated_cases,
    COUNT(latest.test_case_id)::INTEGER AS executed_cases,
    COUNT(*) FILTER (WHERE latest.status = 'passed')::INTEGER AS passed_cases
  FROM linked_cases linked LEFT JOIN latest_finalized latest ON latest.test_case_id = linked.test_case_id
  GROUP BY linked.requirement_id
), bug_facts AS (
  SELECT requirement_id, COUNT(*)::INTEGER AS total_bugs,
    COUNT(*) FILTER (WHERE NOT closed)::INTEGER AS open_bugs,
    COUNT(*) FILTER (WHERE closed)::INTEGER AS closed_bugs,
    COUNT(*) FILTER (WHERE NOT closed AND high_priority)::INTEGER AS open_priority_bugs
  FROM linked_bugs GROUP BY requirement_id
), facts AS (
  SELECT b.*, (b.described AND b.specified AND b.priority BETWEEN 1 AND 5 AND NULLIF(TRIM(b.status), '') IS NOT NULL) AS groomed,
    COALESCE(c.linked_cases, 0) AS linked_cases, COALESCE(c.automated_cases, 0) AS automated_cases,
    COALESCE(c.executed_cases, 0) AS executed_cases, COALESCE(c.passed_cases, 0) AS passed_cases,
    COALESCE(bugs.total_bugs, 0) AS total_bugs, COALESCE(bugs.open_bugs, 0) AS open_bugs,
    COALESCE(bugs.closed_bugs, 0) AS closed_bugs, COALESCE(bugs.open_priority_bugs, 0) AS open_priority_bugs
  FROM base b LEFT JOIN case_facts c ON c.requirement_id = b.id LEFT JOIN bug_facts bugs ON bugs.requirement_id = b.id
)`;
const scopedCte = `, scoped AS (SELECT facts.*, scope.key FROM facts CROSS JOIN LATERAL (VALUES ('all'), (CASE WHEN assigned THEN 'sprints' ELSE 'backlog' END), (CASE WHEN iteration_id IS NOT NULL THEN 'iteration:' || iteration_id END)) scope(key) WHERE scope.key IS NOT NULL)`;
const EMPTY = { total: 0, mapped: 0, highPriority: 0, open: 0, completed: 0, qaTotal: 0, totalDefects: 0, completionPercent: 0, coveragePercent: 0, defectDensity: 0, groomed: 0, notGroomed: 0, described: 0, specified: 0, teamAssigned: 0, slipped: 0, onCourse: 0, sprintCommitted: 0, releaseScoped: 0, backlog: 0 };

exports.withCatalogMetrics = async (requirements, query = {}) => {
  if (!requirements.length) return requirements;
  const includeExecution = yes(query.include_execution);
  const ids = [...new Set(requirements.map((row) => row.id))];
  const rows = await db.prepare(`${factsCte(`r.id IN (${ids.map(() => '?').join(',')})`, includeExecution)}
    SELECT id, linked_cases, automated_cases, executed_cases, passed_cases, total_bugs, open_bugs, closed_bugs,
      described, specified, groomed, slipped, status_rank >= 6 AS completed
    FROM facts`).all(...ids);
  const byId = new Map(rows.map(({ id, ...row }) => [id, { ...row,
    executed_cases: includeExecution ? row.executed_cases : null,
    passed_cases: includeExecution ? row.passed_cases : null,
    execution_complete: includeExecution, automation_complete: true
  }]));
  return requirements.map((row) => ({ ...row, catalog_metrics: byId.get(row.id) }));
};

exports.getMetrics = async (query = {}) => {
  const { sql, params } = buildWhere(query);
  const includeExecution = yes(query.include_execution);
  const includeSprints = yes(query.include_sprints);
  const cte = factsCte(sql, includeExecution && includeSprints) + scopedCte;
  // Group facts before linking: shared cases and Bugs count once in each scope.
  const [counts, options, iterations] = await Promise.all([
    db.prepare(`${cte}, case_totals AS (
      SELECT s.key, COUNT(DISTINCT c.test_case_id)::INTEGER AS linked_cases,
        COUNT(DISTINCT latest.test_case_id)::INTEGER AS executed_linked_cases,
        COUNT(DISTINCT latest.test_case_id) FILTER (WHERE latest.status = 'passed')::INTEGER AS passed_cases
      FROM scoped s JOIN linked_cases c ON c.requirement_id = s.id LEFT JOIN latest_finalized latest ON latest.test_case_id = c.test_case_id GROUP BY s.key
    ), bug_totals AS (
      SELECT s.key, COUNT(DISTINCT bug.issue_id)::INTEGER AS total_bugs,
        COUNT(DISTINCT bug.issue_id) FILTER (WHERE NOT bug.closed AND bug.high_priority)::INTEGER AS open_p1_p2_bugs
      FROM scoped s JOIN linked_bugs bug ON bug.requirement_id = s.id GROUP BY s.key
    ), totals AS (SELECT s.key, COUNT(*)::INTEGER AS total,
      COUNT(*) FILTER (WHERE s.linked_cases > 0)::INTEGER AS mapped,
      COUNT(*) FILTER (WHERE s.priority BETWEEN 1 AND 2)::INTEGER AS "highPriority",
      COUNT(*) FILTER (WHERE s.status_rank < 6)::INTEGER AS open,
      COUNT(*) FILTER (WHERE s.status_rank >= 6 AND (s.key <> 'all' OR s.assigned))::INTEGER AS completed,
      COUNT(*) FILTER (WHERE s.key <> 'all' OR s.assigned)::INTEGER AS "qaTotal",
      COUNT(*) FILTER (WHERE s.groomed)::INTEGER AS groomed,
      COUNT(*) FILTER (WHERE s.described)::INTEGER AS described,
      COUNT(*) FILTER (WHERE s.specified)::INTEGER AS specified,
      COUNT(*) FILTER (WHERE NULLIF(TRIM(s.scrum_team), '') IS NOT NULL)::INTEGER AS "teamAssigned",
      COUNT(*) FILTER (WHERE s.slipped)::INTEGER AS slipped,
      COUNT(*) FILTER (WHERE LOWER(s.status) LIKE '%blocked%')::INTEGER AS blocked_stories,
      SUM((SELECT COUNT(*) FROM entity_comments comments WHERE comments.project_id = s.project_id AND comments.entity_type = 'requirement' AND comments.entity_id = s.id))::INTEGER AS comment_count,
      COUNT(*) FILTER (WHERE s.slipped OR LOWER(s.status) LIKE '%blocked%' OR (s.priority BETWEEN 1 AND 2 AND s.linked_cases = 0))::INTEGER AS at_risk,
      COUNT(*) FILTER (WHERE s.assigned)::INTEGER AS "sprintCommitted",
      COUNT(*) FILTER (WHERE s.release_scoped)::INTEGER AS "releaseScoped",
      COUNT(*) FILTER (WHERE NOT s.assigned)::INTEGER AS backlog
      FROM scoped s GROUP BY s.key)
    SELECT totals.*, COALESCE(b.total_bugs, 0) AS total_bugs, COALESCE(b.open_p1_p2_bugs, 0) AS open_p1_p2_bugs,
      COALESCE(c.linked_cases, 0) AS linked_cases, COALESCE(c.executed_linked_cases, 0) AS executed_linked_cases,
      COALESCE(c.passed_cases, 0) AS passed_cases
    FROM totals LEFT JOIN case_totals c USING (key) LEFT JOIN bug_totals b USING (key)`).all(...params),
    db.prepare(`SELECT COALESCE(jsonb_agg(DISTINCT status) FILTER (WHERE status IS NOT NULL), '[]'::jsonb) AS statuses, COALESCE(jsonb_agg(DISTINCT sprint) FILTER (WHERE NULLIF(sprint, '') IS NOT NULL), '[]'::jsonb) AS sprints, COALESCE(jsonb_agg(DISTINCT fix_version) FILTER (WHERE NULLIF(fix_version, '') IS NOT NULL), '[]'::jsonb) AS fix_versions, COALESCE(jsonb_agg(DISTINCT release) FILTER (WHERE NULLIF(release, '') IS NOT NULL), '[]'::jsonb) AS releases, COALESCE((SELECT jsonb_agg(DISTINCT label) FROM requirements rr CROSS JOIN LATERAL jsonb_array_elements_text(CASE WHEN jsonb_typeof(rr.labels) = 'array' THEN rr.labels ELSE '[]'::jsonb END) label WHERE rr.project_id = ?), '[]'::jsonb) AS labels FROM requirements WHERE project_id = ?`).get(query.project_id, query.project_id),
    includeSprints ? db.prepare('SELECT id, name, state FROM requirement_iterations WHERE project_id = ?').all(query.project_id) : Promise.resolve([])
  ]);
  const evidenceByKey = new Map(counts.map((row) => [row.key, row]));
  const scopes = new Map(counts.map(({ key, total_bugs: totalDefects, linked_cases, executed_linked_cases, passed_cases, open_p1_p2_bugs, ...row }) => [key, { ...EMPTY, ...row, totalDefects,
    completionPercent: row.qaTotal ? Math.round(row.completed / row.qaTotal * 100) : 0,
    coveragePercent: row.total ? Math.round(row.mapped / row.total * 100) : 0,
    defectDensity: row.total ? totalDefects / row.total : 0,
    notGroomed: row.total - row.groomed, onCourse: row.total - row.slipped
  }]));
  const percent = (n, d) => d ? Math.round(n / d * 1000) / 10 : null;
  const sprint_health = iterations.map((iteration) => {
    const key = `iteration:${iteration.id}`;
    const row = scopes.get(key) || EMPTY;
    const evidence = evidenceByKey.get(key) || { linked_cases: 0, executed_linked_cases: 0, passed_cases: 0, open_p1_p2_bugs: 0, blocked_stories: 0, comment_count: 0 };
    const health = { iteration_id: iteration.id, jira_sprint_id: null, name: iteration.name, state: iteration.state,
      total_stories: row.total, completed_stories: row.completed, completed_percent: percent(row.completed, row.total),
      covered_stories: row.mapped, coverage_percent: percent(row.mapped, row.total), linked_cases: evidence.linked_cases,
      executed_linked_cases: includeExecution ? evidence.executed_linked_cases : null,
      passed_cases: includeExecution ? evidence.passed_cases : null,
      pass_percent: includeExecution ? percent(evidence.passed_cases, evidence.executed_linked_cases) : null,
      at_risk_stories: row.at_risk || 0, slippage_stories: row.slipped, on_course_stories: row.onCourse,
      blocked_stories: evidence.blocked_stories, comment_count: evidence.comment_count,
      open_p1_p2_bugs: evidence.open_p1_p2_bugs, total_bugs: row.totalDefects };
    const exactFields = Object.keys(health).filter((field) => includeExecution || !['executed_linked_cases', 'passed_cases', 'pass_percent'].includes(field));
    return { ...health, exact_fields: exactFields, observed: { ...health, stories_scanned: row.total },
      completeness: { complete: includeExecution, partial: !includeExecution, reasons: includeExecution ? [] : ['Execution metrics require result access.'], exact_fields: exactFields,
        stories: { state: 'complete', scanned: row.total, limit: row.total },
        executions: { state: includeExecution ? 'complete' : 'unavailable', linked_cases_scoped: evidence.linked_cases, runs_scanned: 0, results_scanned: includeExecution ? evidence.executed_linked_cases : 0, case_limit: evidence.linked_cases, run_limit: 0, result_limit: includeExecution ? evidence.executed_linked_cases : 0 },
        bugs: { state: 'complete', bugs_scanned: row.totalDefects, limit: row.totalDefects } } };
  });
  return { all: scopes.get('all') || { ...EMPTY }, backlog: scopes.get('backlog') || { ...EMPTY }, sprints: scopes.get('sprints') || { ...EMPTY }, sprint_health, filter_options: options, generated_at: new Date().toISOString() };
};

exports.buildWhere = buildWhere;
exports.pageOptions = pageOptions;
