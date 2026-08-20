const db = require("../db");
const { randomUUID: uuid } = require("crypto");
const displayIdService = require("./displayId.service");
const { ISSUE_STATUS_VALUES, DOMAIN_METADATA } = require("../domain/catalog");
const { normalizeReferenceList } = require("../utils/externalReferences");

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
  "root_cause"
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
  feedback.status,
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

const normalizeStatus = (value) => {
  if (value === undefined || value === null || value === "") {
    return DEFAULT_ISSUE_STATUS;
  }

  const normalized = String(value).trim();

  if (!normalized) {
    return DEFAULT_ISSUE_STATUS;
  }

  if (!ISSUE_STATUS_VALUES.includes(normalized)) {
    throw new Error("Invalid issue status");
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

const normalizeList = (value) => normalizeReferenceList(Array.isArray(value) ? value : []);

const syncIssueLinks = async (issueId, { linked_test_case_ids = [], linked_requirement_ids = [] } = {}) => {
  const testCaseIds = normalizeList(linked_test_case_ids);
  const requirementIds = normalizeList(linked_requirement_ids);
  const transaction = db.transaction(async () => {
    await db.prepare("DELETE FROM test_case_defects WHERE issue_id = ? AND link_source = 'manual'").run(issueId);
    await db.prepare("DELETE FROM requirement_defects WHERE issue_id = ? AND link_source = 'manual'").run(issueId);
    for (const testCaseId of testCaseIds) {
      const exists = await db.prepare("SELECT id FROM test_cases WHERE id = ?").get(testCaseId);
      if (exists) {
        await db.prepare(`INSERT INTO test_case_defects (test_case_id, issue_id, link_source) VALUES (?, ?, 'manual') ON CONFLICT (test_case_id, issue_id) DO UPDATE SET link_source = 'manual'`).run(testCaseId, issueId);
      }
    }
    for (const requirementId of requirementIds) {
      const exists = await db.prepare("SELECT id FROM requirements WHERE id = ?").get(requirementId);
      if (exists) {
        await db.prepare(`INSERT INTO requirement_defects (requirement_id, issue_id, link_source) VALUES (?, ?, 'manual') ON CONFLICT (requirement_id, issue_id) DO UPDATE SET link_source = 'manual'`).run(requirementId, issueId);
      }
    }
  });
  await transaction();
};

exports.createIssue = async ({ project_id, user_id, title, message, status, linked_test_case_ids, linked_test_suite_ids, linked_module_ids, linked_requirement_ids, labels, ...details }) => {
  if (!project_id || !user_id || !title || !message) {
    throw new Error("Missing required fields");
  }

  await validateUser(user_id, "User not found");
  await validateUser(details.assignee_id, "Assignee not found");

  const id = uuid();
  const display_id = await displayIdService.createDisplayId("issue");

  const project = await db.prepare("SELECT id FROM projects WHERE id = ?").get(project_id);
  if (!project) throw new Error("Project not found");

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
	      status
	    )
	    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
    normalizeList(linked_module_ids),
    normalizeList(linked_requirement_ids),
    normalizeList(labels),
    ...buildDetailValues(details).slice(9),
    normalizeStatus(status)
  );

  await syncIssueLinks(id, { linked_test_case_ids, linked_requirement_ids });

  return { id, display_id };
};

exports.getIssues = async ({ project_id, user_id, status, viewer_id, viewer_is_admin = false } = {}) => {
  let query = `
	    SELECT
	      ${ISSUE_SELECT_COLUMNS},
	      reporter.name AS user_name,
	      reporter.email AS user_email,
      assignee.name AS assignee_name,
      assignee.email AS assignee_email
    FROM feedback
    JOIN users reporter ON reporter.id = feedback.user_id
    LEFT JOIN users assignee ON assignee.id = feedback.assignee_id
    WHERE 1 = 1
  `;
  const params = [];

  if (project_id) {
    query += ` AND feedback.project_id = ?`;
    params.push(project_id);
  } else if (!viewer_is_admin) {
    query += ` AND feedback.project_id IN (SELECT project_id FROM project_members WHERE user_id = ?)`;
    params.push(viewer_id);
  }

  if (user_id) {
    query += ` AND feedback.user_id = ?`;
    params.push(user_id);
  }

  if (status) {
    query += ` AND feedback.status = ?`;
    params.push(status);
  }

  query += ` ORDER BY feedback.created_at DESC`;

  return db.prepare(query).all(...params);
};

exports.getIssueItem = async (id) => {
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
    WHERE feedback.id = ?
  `).get(id);

  if (!item) {
    throw new Error("Issue not found");
  }

  return item;
};

exports.updateIssue = async (id, data) => {
  const existing = await exports.getIssueItem(id);

  if (data.user_id && data.user_id !== existing.user_id) {
    await validateUser(data.user_id, "User not found");
  }

  if (Object.prototype.hasOwnProperty.call(data, "assignee_id")) {
    await validateUser(data.assignee_id, "Assignee not found");
  }

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
	        status = ?,
	        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(
    data.project_id ?? existing.project_id,
    data.user_id ?? existing.user_id,
    data.title ?? existing.title,
    data.message ?? existing.message,
    ...buildDetailValues(data, existing).slice(0, 9),
    Object.prototype.hasOwnProperty.call(data, "linked_test_case_ids") ? normalizeList(data.linked_test_case_ids) : normalizeList(existing.linked_test_case_ids),
    Object.prototype.hasOwnProperty.call(data, "linked_test_suite_ids") ? normalizeList(data.linked_test_suite_ids) : normalizeList(existing.linked_test_suite_ids),
    Object.prototype.hasOwnProperty.call(data, "linked_module_ids") ? normalizeList(data.linked_module_ids) : normalizeList(existing.linked_module_ids),
    Object.prototype.hasOwnProperty.call(data, "linked_requirement_ids") ? normalizeList(data.linked_requirement_ids) : normalizeList(existing.linked_requirement_ids),
    Object.prototype.hasOwnProperty.call(data, "labels") ? normalizeList(data.labels) : normalizeList(existing.labels),
    ...buildDetailValues(data, existing).slice(9),
    data.status !== undefined ? normalizeStatus(data.status) : existing.status,
    id
  );

  if (Object.prototype.hasOwnProperty.call(data, "linked_test_case_ids") || Object.prototype.hasOwnProperty.call(data, "linked_requirement_ids")) {
    await syncIssueLinks(id, {
      linked_test_case_ids: data.linked_test_case_ids ?? existing.linked_test_case_ids,
      linked_requirement_ids: data.linked_requirement_ids ?? existing.linked_requirement_ids
    });
  }

  return { updated: true };
};

exports.deleteIssue = async (id) => {
  await exports.getIssueItem(id);

  await db.prepare(`
    DELETE FROM feedback
    WHERE id = ?
  `).run(id);

  return { deleted: true };
};
