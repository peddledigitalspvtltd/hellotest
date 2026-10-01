const issueLinks = require("./issueLink.service");
const db = require("@hellotest/platform/backend/src/db");
const { randomUUID: uuid, createHash } = require("crypto");
const displayIdService = require("@hellotest/platform/backend/services/displayId.service");
const { ISSUE_STATUS_VALUES, DOMAIN_METADATA } = require("@hellotest/platform/backend/src/domain/catalog");
const { normalizeReferenceList } = require("@hellotest/platform/backend/src/utils/externalReferences");
const issueHistory = require("./issueHistory.service");
const dropdownCatalog = require("@hellotest/platform/backend/services/dropdownCatalog.service");

const DEFAULT_ISSUE_STATUS = DOMAIN_METADATA.issues.default_status;

const ISSUE_DETAIL_FIELDS = [
  "steps_to_reproduce",
  "expected_result",
  "actual_result",
  "severity",
  "priority",
  "environment",
  "build",
  "jira_bug_key",
  "linked_test_run_id",
  "sprint",
  "fix_version",
  "release",
  "assignee_id",
  "root_cause",
  "qa_root_cause",
  "bug_type"
];

const ISSUE_SELECT_COLUMNS = `
  feedback.id,
  feedback.display_id,
  feedback.project_id,
  feedback.user_id,
  feedback.title,
  feedback.message,
  feedback.steps_to_reproduce,
  feedback.expected_result,
  feedback.actual_result,
  feedback.severity,
  feedback.priority,
  feedback.environment,
  feedback.build,
  feedback.jira_bug_key,
  feedback.linked_test_run_id,
  feedback.linked_test_case_ids,
  feedback.linked_test_suite_ids,
  feedback.linked_module_ids,
  feedback.linked_requirement_ids,
  feedback.labels,
  feedback.sprint,
  feedback.fix_version,
  feedback.release,
  feedback.assignee_id,
  feedback.root_cause,
  feedback.qa_root_cause,
  feedback.bug_type,
  feedback.regression,
  feedback.status,
  EXISTS (
    SELECT 1 FROM test_cases converted_case
    JOIN app_types converted_app ON converted_app.id = converted_case.app_type_id
    WHERE converted_case.source_issue_id = feedback.id
      AND converted_app.project_id = feedback.project_id
  ) AS has_converted_test_cases,
  feedback.created_at,
  feedback.updated_at
`;

const normalizeText = (value) => {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized || null;
};

const validateClassifications = async (input, existing = {}) => {
  const validated = { ...input };
  for (const [field, key] of [["root_cause", "issues.root_causes"], ["qa_root_cause", "issues.qa_root_causes"], ["bug_type", "issues.bug_types"]]) {
    if (Object.prototype.hasOwnProperty.call(input, field)) {
      validated[field] = await dropdownCatalog.validateValue(key, input[field], { existingValue: existing[field] });
    }
  }
  return validated;
};

const normalizeStatus = (value) => {
  if (value === undefined || value === null || value === "") {
    return DEFAULT_ISSUE_STATUS;
  }

  const normalized = String(value).trim();

  if (!normalized) {
    return DEFAULT_ISSUE_STATUS;
  }

  if (!ISSUE_STATUS_VALUES.includes(normalized)) {
    throw new Error("Invalid defect status");
  }

  return normalized;
};

async function validateUser(userId, errorMessage) {
  const normalizedUserId = normalizeText(userId);

  if (!normalizedUserId) {
    return null;
  }

  const user = await db.prepare(`
    SELECT id
    FROM users
    WHERE id = ?
  `).get(normalizedUserId);

  if (!user) {
    throw new Error(errorMessage);
  }

  return normalizedUserId;
}

function buildDetailValues(input = {}, fallback = {}) {
  return ISSUE_DETAIL_FIELDS.map((field) =>
    Object.prototype.hasOwnProperty.call(input, field)
      ? normalizeText(input[field])
      : fallback[field] ?? null
  );
}

const normalizeLabels = value => [...new Set((Array.isArray(value) ? value : []).filter(item => typeof item === "string").map(item => item.trim()).filter(Boolean))];

const normalizeList = (value) => normalizeReferenceList(Array.isArray(value) ? value : []);

const deriveTestCaseImpactScope = async ({ projectId, testCaseIds = [] } = {}) => {
  const normalizedCaseIds = normalizeList(testCaseIds);
  if (!projectId || !normalizedCaseIds.length) {
    return { moduleIds: [], requirementIds: [] };
  }

  const placeholders = normalizedCaseIds.map(() => "?").join(",");
  const [moduleRows, requirementRows, legacyRequirementRows] = await Promise.all([
    db.prepare(`
      SELECT DISTINCT test_case_module_cases.module_id
      FROM test_case_module_cases
      INNER JOIN test_case_modules ON test_case_modules.id = test_case_module_cases.module_id
      INNER JOIN app_types ON app_types.id = test_case_modules.app_type_id
      WHERE test_case_module_cases.test_case_id IN (${placeholders})
        AND app_types.project_id = ?
    `).all(...normalizedCaseIds, projectId),
    db.prepare(`
      SELECT DISTINCT requirement_test_cases.requirement_id
      FROM requirement_test_cases
      INNER JOIN requirements ON requirements.id = requirement_test_cases.requirement_id
      WHERE requirement_test_cases.test_case_id IN (${placeholders})
        AND requirements.project_id = ?
    `).all(...normalizedCaseIds, projectId),
    db.prepare(`
      SELECT DISTINCT test_cases.requirement_id
      FROM test_cases
      INNER JOIN requirements ON requirements.id = test_cases.requirement_id
      WHERE test_cases.id IN (${placeholders})
        AND requirements.project_id = ?
        AND test_cases.requirement_id IS NOT NULL
    `).all(...normalizedCaseIds, projectId)
  ]);

  return {
    moduleIds: normalizeList(moduleRows.map((row) => row.module_id)),
    requirementIds: normalizeList([...requirementRows, ...legacyRequirementRows].map((row) => row.requirement_id))
  };
};

exports.createIssue = async ({ project_id, user_id, title, message, status, regression, linked_test_case_ids, linked_test_suite_ids, linked_module_ids, linked_requirement_ids, labels, ...details }, { actorId = user_id, issueId } = {}) => {
  if (!project_id || !user_id || !title || !message) {
    throw new Error("Missing required fields");
  }

  await validateUser(user_id, "User not found");
  await validateUser(details.assignee_id, "Assignee not found");
  details = await validateClassifications(details);

  const id = issueId || uuid();
  const display_id = await displayIdService.createDisplayId("issue");

  const project = await db.prepare("SELECT id FROM projects WHERE id = ?").get(project_id);
  if (!project) throw new Error("Project not found");
  const derivedImpact = await deriveTestCaseImpactScope({ projectId: project_id, testCaseIds: linked_test_case_ids });
  const resolvedModuleIds = normalizeList([...normalizeList(linked_module_ids), ...derivedImpact.moduleIds]);
  const resolvedRequirementIds = normalizeList([...normalizeList(linked_requirement_ids), ...derivedImpact.requirementIds]);

  const transaction = db.transaction(async () => {
    await db.prepare(`
      INSERT INTO feedback (
        id,
        display_id,
        project_id,
        user_id,
        title,
        message,
        steps_to_reproduce,
        expected_result,
        actual_result,
        severity,
        priority,
        environment,
        build,
        jira_bug_key,
        linked_test_run_id,
        linked_test_case_ids,
        linked_test_suite_ids,
        linked_module_ids,
        linked_requirement_ids,
        labels,
        sprint,
        fix_version,
        release,
        assignee_id,
        root_cause,
        qa_root_cause,
        bug_type,
        status,
        regression
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      display_id,
      project_id,
      user_id,
      title,
      message,
      ...buildDetailValues(details).slice(0, 9),
      normalizeList(linked_test_case_ids),
      normalizeList(linked_test_suite_ids),
      resolvedModuleIds,
      resolvedRequirementIds,
      normalizeLabels(labels),
      ...buildDetailValues(details).slice(9),
      normalizeStatus(status),
      Boolean(regression)
    );

    await issueLinks.replaceManualLinks({ issueId: id, projectId: project_id, testCaseIds: linked_test_case_ids, requirementIds: resolvedRequirementIds });
    await issueHistory.record({ issueId: id, actorId, after: await exports.getIssueItem(id) });
  });
  await transaction();

  return { id, display_id };
};

const issueCatalogScope = (filters = {}) => {
  const clauses = ["1 = 1"];
  const params = [];
  if (filters.project_id) {
    clauses.push("feedback.project_id = ?");
    params.push(filters.project_id);
  } else if (!filters.viewer_is_admin) {
    clauses.push("feedback.project_id IN (SELECT project_id FROM project_members WHERE user_id = ?)");
    params.push(filters.viewer_id);
  }
  for (const field of ["user_id", "status", "priority", "assignee_id"]) {
    const value = normalizeText(filters[field]);
    if (!value) continue;
    if (field === "assignee_id" && value === "__unassigned__") {
      clauses.push("NULLIF(TRIM(feedback.assignee_id), '') IS NULL");
    } else {
      clauses.push(`feedback.${field} = ?`);
      params.push(value);
    }
  }
  const search = String(filters.q || "").trim().toLowerCase();
  if (search) {
    // Literal substring search keeps %, _ and quotes in user text as text.
    clauses.push(`POSITION(? IN LOWER(CONCAT_WS(' ',
      feedback.id, feedback.display_id, feedback.title, feedback.message,
      feedback.status, feedback.severity, feedback.priority, feedback.environment,
      feedback.build, feedback.jira_bug_key, feedback.linked_test_run_id,
      linked_run.name, linked_run.status, linked_run.release, linked_run.build,
      feedback.assignee_id, assignee.name, assignee.email,
      feedback.steps_to_reproduce, feedback.expected_result, feedback.actual_result,
      feedback.root_cause, feedback.qa_root_cause, feedback.bug_type,
      reporter.name, reporter.email, feedback.user_id, feedback.labels::text,
      feedback.sprint, feedback.fix_version, feedback.release
    ))) > 0`);
    params.push(search);
  }
  const joins = `FROM feedback
    JOIN users reporter ON reporter.id = feedback.user_id
    LEFT JOIN users assignee ON assignee.id = feedback.assignee_id
    ${search ? "LEFT JOIN executions linked_run ON linked_run.id = feedback.linked_test_run_id AND linked_run.project_id = feedback.project_id" : ""}`;
  const where = clauses.join(" AND ");
  const scope = createHash("sha256").update(JSON.stringify([where, params])).digest("base64url");
  return { joins, where, params, scope };
};

const issueCatalogColumns = `${ISSUE_SELECT_COLUMNS},
  reporter.name AS user_name, reporter.email AS user_email,
  assignee.name AS assignee_name, assignee.email AS assignee_email`;

exports.getIssues = async (filters = {}) => {
  const { joins, where, params } = issueCatalogScope(filters);
  return db.prepare(`SELECT ${issueCatalogColumns} ${joins} WHERE ${where}
    ORDER BY feedback.created_at DESC NULLS LAST, feedback.id DESC`).all(...params);
};

exports.getIssuePage = async (filters = {}) => {
  const { joins, where, params, scope } = issueCatalogScope(filters);
  const requestedSize = Number.parseInt(filters.page_size ?? filters.limit, 10);
  const pageSize = Number.isFinite(requestedSize) && requestedSize > 0 ? Math.min(requestedSize, 200) : 25;
  let continuation = "";
  const pageParams = [...params];
  if (filters.cursor) {
    let cursor;
    try {
      cursor = JSON.parse(Buffer.from(String(filters.cursor), "base64url").toString("utf8"));
      if (cursor.scope !== scope || typeof cursor.id !== "string" || !cursor.id
        || !(cursor.created_at === null || (typeof cursor.created_at === "string" && Number.isFinite(Date.parse(cursor.created_at))))) throw new Error();
    } catch {
      throw Object.assign(new Error("The pagination cursor is invalid for this Defect catalog. Start from the first page."), { statusCode: 400 });
    }
    if (cursor.created_at === null) {
      continuation = " AND feedback.created_at IS NULL AND feedback.id < ?";
      pageParams.push(cursor.id);
    } else {
      continuation = " AND (feedback.created_at < ? OR (feedback.created_at = ? AND feedback.id < ?) OR feedback.created_at IS NULL)";
      pageParams.push(cursor.created_at, cursor.created_at, cursor.id);
    }
  }
  // Read one extra row to find continuation, without a full-catalog count.
  // Preserve PostgreSQL timestamp microseconds in cursors rather than Date's milliseconds.
  const rows = await db.prepare(`SELECT ${issueCatalogColumns},
    TO_CHAR(feedback.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS _cursor_created_at
    ${joins} WHERE ${where}${continuation}
    ORDER BY feedback.created_at DESC NULLS LAST, feedback.id DESC LIMIT ?`).all(...pageParams, pageSize + 1);
  const isLast = rows.length <= pageSize;
  const pageRows = rows.slice(0, pageSize);
  const last = pageRows[pageRows.length - 1];
  const result = {
    items: pageRows.map(({ _cursor_created_at, ...item }) => item),
    next_cursor: isLast || !last ? null : Buffer.from(JSON.stringify({ scope, id: last.id, created_at: last._cursor_created_at ?? null })).toString("base64url"),
    is_last: isLast
  };
  // Existing API consumers may request totals; the Bugs catalog obtains its
  // complete metrics separately and skips this query for every record page.
  if (filters.include_total !== false && filters.include_total !== "false") {
    const count = await db.prepare(`SELECT COUNT(*) AS total ${joins} WHERE ${where}`).get(...params);
    result.total = Number(count?.total || 0);
  }
  return result;
};

exports.getIssueMetrics = async (filters = {}) => {
  const { joins, where, params } = issueCatalogScope(filters);
  const open = "LOWER(TRIM(COALESCE(feedback.status, 'open'))) NOT IN ('closed', 'resolved', 'done', 'accepted')";
  const rows = await db.prepare(`SELECT COALESCE(feedback.status, 'open') AS status,
    COUNT(*)::INTEGER AS total,
    COUNT(*) FILTER (WHERE ${open})::INTEGER AS open,
    COUNT(*) FILTER (WHERE ${open} AND LOWER(TRIM(COALESCE(feedback.priority, ''))) IN ('highest', 'high'))::INTEGER AS priority_risks,
    COUNT(*) FILTER (WHERE ${open} AND NULLIF(TRIM(feedback.assignee_id), '') IS NULL)::INTEGER AS unassigned,
    COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM test_cases converted_case
      JOIN app_types converted_app ON converted_app.id = converted_case.app_type_id
      WHERE converted_case.source_issue_id = feedback.id AND converted_app.project_id = feedback.project_id))::INTEGER AS converted
    ${joins} WHERE ${where} GROUP BY feedback.status ORDER BY status`).all(...params);
  const metrics = { total: 0, open: 0, priority_risks: 0, unassigned: 0, converted: 0, statuses: {} };
  for (const row of rows) {
    for (const key of ["total", "open", "priority_risks", "unassigned", "converted"]) metrics[key] += Number(row[key] || 0);
    metrics.statuses[row.status] = (metrics.statuses[row.status] || 0) + Number(row.total || 0);
  }
  return metrics;
};

exports.getIssueItem = async (id, { project_id, resolveReference = false } = {}) => {
  const item = await db.prepare(`
	    SELECT
	      ${ISSUE_SELECT_COLUMNS},
	      reporter.name AS user_name,
	      reporter.email AS user_email,
      assignee.name AS assignee_name,
      assignee.email AS assignee_email
    FROM feedback
    JOIN users reporter ON reporter.id = feedback.user_id
    LEFT JOIN users assignee ON assignee.id = feedback.assignee_id
    WHERE ${resolveReference ? "(feedback.id = ? OR feedback.display_id = ? OR feedback.jira_bug_key = ?)" : "feedback.id = ?"}
      ${project_id ? "AND feedback.project_id = ?" : ""}
  `).get(...(resolveReference ? [id, id, id] : [id]), ...(project_id ? [project_id] : []));

  if (!item) {
    throw new Error("Defect not found");
  }

  return item;
};

exports.updateIssue = async (id, data, { actorId } = {}) => db.transaction(async () => {
  // Serialize updates before reading the previous values used by the audit log.
  await db.prepare("SELECT id FROM feedback WHERE id = ? FOR UPDATE").get(id);
  const existing = await exports.getIssueItem(id);
  data = await validateClassifications(data, existing);

  if (data.user_id && data.user_id !== existing.user_id) {
    await validateUser(data.user_id, "User not found");
  }

  if (Object.prototype.hasOwnProperty.call(data, "assignee_id")) {
    await validateUser(data.assignee_id, "Assignee not found");
  }
  const resolvedProjectId = data.project_id ?? existing.project_id;
  const resolvedTestCaseIds = Object.prototype.hasOwnProperty.call(data, "linked_test_case_ids") ? normalizeList(data.linked_test_case_ids) : normalizeList(existing.linked_test_case_ids);
  const derivedImpact = await deriveTestCaseImpactScope({ projectId: resolvedProjectId, testCaseIds: resolvedTestCaseIds });
  const resolvedModuleIds = normalizeList([
    ...(Object.prototype.hasOwnProperty.call(data, "linked_module_ids") ? normalizeList(data.linked_module_ids) : normalizeList(existing.linked_module_ids)),
    ...derivedImpact.moduleIds
  ]);
  const resolvedRequirementIds = normalizeList([
    ...(Object.prototype.hasOwnProperty.call(data, "linked_requirement_ids") ? normalizeList(data.linked_requirement_ids) : normalizeList(existing.linked_requirement_ids)),
    ...derivedImpact.requirementIds
  ]);

  await db.prepare(`
    UPDATE feedback
    SET project_id = ?,
        user_id = ?,
        title = ?,
        message = ?,
        steps_to_reproduce = ?,
        expected_result = ?,
        actual_result = ?,
        severity = ?,
        priority = ?,
        environment = ?,
        build = ?,
	        jira_bug_key = ?,
	        linked_test_run_id = ?,
	        linked_test_case_ids = ?,
	        linked_test_suite_ids = ?,
	        linked_module_ids = ?,
	        linked_requirement_ids = ?,
	        labels = ?,
	        sprint = ?,
	        fix_version = ?,
	        release = ?,
	        assignee_id = ?,
	        root_cause = ?,
	        qa_root_cause = ?,
	        bug_type = ?,
	        status = ?,
	        regression = ?,
	        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(
    data.project_id ?? existing.project_id,
    data.user_id ?? existing.user_id,
    data.title ?? existing.title,
    data.message ?? existing.message,
    ...buildDetailValues(data, existing).slice(0, 9),
    resolvedTestCaseIds,
    Object.prototype.hasOwnProperty.call(data, "linked_test_suite_ids") ? normalizeList(data.linked_test_suite_ids) : normalizeList(existing.linked_test_suite_ids),
    resolvedModuleIds,
    resolvedRequirementIds,
    Object.prototype.hasOwnProperty.call(data, "labels") ? normalizeLabels(data.labels) : normalizeLabels(existing.labels),
    ...buildDetailValues(data, existing).slice(9),
    data.status !== undefined ? normalizeStatus(data.status) : existing.status,
    data.regression !== undefined ? Boolean(data.regression) : Boolean(existing.regression),
    id
  );

  if (resolvedProjectId !== existing.project_id || Object.prototype.hasOwnProperty.call(data, "linked_test_case_ids") || Object.prototype.hasOwnProperty.call(data, "linked_requirement_ids")) {
    await issueLinks.replaceManualLinks({
      issueId: id, projectId: resolvedProjectId,
      testCaseIds: resolvedTestCaseIds, requirementIds: resolvedRequirementIds
    });
  }

  await issueHistory.record({ issueId: id, actorId, before: existing, after: await exports.getIssueItem(id) });
  return { updated: true };
})();

exports.getIssueHistory = async (id) => issueHistory.list(await exports.getIssueItem(id));

exports.deleteIssue = async (id) => {
  await exports.getIssueItem(id);

  await db.prepare(`
    DELETE FROM feedback
    WHERE id = ?
  `).run(id);

  return { deleted: true };
};
