const db = require("../db");
const { v4: uuid } = require("uuid");
const { ISSUE_STATUS_VALUES, DOMAIN_METADATA } = require("../domain/catalog");

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
  "assignee_id",
  "root_cause"
];

const ISSUE_SELECT_COLUMNS = `
  feedback.id,
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
  feedback.assignee_id,
  feedback.root_cause,
  feedback.status,
  feedback.created_at
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

exports.createIssue = async ({ user_id, title, message, status, ...details }) => {
  if (!user_id || !title || !message) {
    throw new Error("Missing required fields");
  }

  await validateUser(user_id, "User not found");
  await validateUser(details.assignee_id, "Assignee not found");

  const id = uuid();

  await db.prepare(`
    INSERT INTO feedback (
      id,
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
	      assignee_id,
	      root_cause,
	      status
	    )
	    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    user_id,
    title,
    message,
    ...buildDetailValues(details),
    normalizeStatus(status)
  );

  return { id };
};

exports.getIssues = async ({ user_id, status } = {}) => {
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
    SET user_id = ?,
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
	        assignee_id = ?,
	        root_cause = ?,
	        status = ?
    WHERE id = ?
  `).run(
    data.user_id ?? existing.user_id,
    data.title ?? existing.title,
    data.message ?? existing.message,
    ...buildDetailValues(data, existing),
    data.status !== undefined ? normalizeStatus(data.status) : existing.status,
    id
  );

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
