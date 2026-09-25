const db = require("../src/db");
const { randomUUID: uuid } = require("crypto");
const { getPaginationOptions, encodeCursor } = require("../src/utils/pagination");

const normalizeText = (value) => {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed || null;
};

exports.createNotification = async ({ user_id, session_id, project_id, run_id, target_url, type, title, message }) => {
  const resolvedUserId = normalizeText(user_id);
  const resolvedType = normalizeText(type);
  const resolvedTitle = normalizeText(title);
  const resolvedMessage = normalizeText(message);

  if (!resolvedUserId || !resolvedType || !resolvedTitle || !resolvedMessage) {
    throw new Error("Notification user, type, title, and message are required");
  }

  const user = await db.prepare(`SELECT id FROM users WHERE id = ?`).get(resolvedUserId);
  if (!user) {
    throw new Error("Notification user not found");
  }

  const id = uuid();
  await db.prepare(`
    INSERT INTO notifications (id, user_id, session_id, project_id, run_id, target_url, type, title, message)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    resolvedUserId,
    normalizeText(session_id),
    normalizeText(project_id),
    normalizeText(run_id),
    normalizeText(target_url),
    resolvedType,
    resolvedTitle,
    resolvedMessage
  );

  return { id };
};

const preferenceForType = (type) => {
  const normalized = String(type || "").toLowerCase();
  if (normalized.includes("fail")) return "executionFailures";
  if (normalized.includes("complete")) return "executionCompletions";
  if (normalized.includes("assign")) return "runAssignments";
  if (normalized.includes("issue") || normalized.includes("bug")) return "issueReports";
  if (normalized.includes("design")) return "aiDesign";
  if (normalized.includes("automation")) return "aiAutomation";
  if (normalized.includes("import") || normalized.includes("export")) return "importExport";
  if (normalized.includes("requirement")) return "requirementChanges";
  if (normalized.includes("test_case") || normalized.includes("test-case")) return "testCaseChanges";
  if (normalized.includes("integration")) return "integrationChanges";
  if (normalized.includes("role")) return "userRoleChanges";
  if (normalized.includes("member")) return "projectMembership";
  if (normalized.includes("schedule")) return "scheduledRuns";
  return "unspecified";
};

const shapeNotification = (notification) => ({
  ...notification,
  preference: preferenceForType(notification.type)
});

exports.getNotifications = async ({ user_id, status } = {}) => {
  let query = `SELECT * FROM notifications WHERE 1=1`;
  const params = [];

  if (user_id) {
    query += ` AND user_id = ?`;
    params.push(user_id);
  }

  if (status) {
    query += ` AND status = ?`;
    params.push(status);
  }

  query += ` ORDER BY created_at DESC`;
  return (await db.prepare(query).all(...params)).map(shapeNotification);
};

exports.getNotificationPage = async ({ user_id, status, ...query } = {}) => {
  if (!user_id) throw Object.assign(new Error("Notification user is required"), { statusCode: 400 });
  const { pageSize, offset } = getPaginationOptions(query);
  if (!Number.isSafeInteger(offset)) {
    throw Object.assign(new Error("The pagination cursor is invalid or expired."), { statusCode: 400 });
  }
  const predicate = `user_id = ?${status ? " AND status = ?" : ""}`;
  const params = status ? [user_id, status] : [user_id];
  const [summary, rows] = await Promise.all([
    db.prepare(`
      SELECT COUNT(*)::INTEGER AS total,
        COUNT(*) FILTER (WHERE status IS DISTINCT FROM 'read')::INTEGER AS unread_count
      FROM notifications WHERE ${predicate}
    `).get(...params),
    db.prepare(`
      SELECT * FROM notifications WHERE ${predicate}
      ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?
    `).all(...params, pageSize, offset)
  ]);
  const total = Number(summary?.total || 0);
  const nextOffset = offset + rows.length;
  const isLast = rows.length === 0 || nextOffset >= total;
  return {
    items: rows.map(shapeNotification), total,
    next_cursor: isLast ? null : encodeCursor(nextOffset), is_last: isLast,
    unread_count: Number(summary?.unread_count || 0)
  };
};

exports.getUnreadSummary = async (userId) => {
  const rows = await db.prepare(`
    SELECT type, COUNT(*)::INTEGER AS count
    FROM notifications
    WHERE user_id = ? AND status = 'unread'
    GROUP BY type
  `).all(userId);

  const byPreference = rows.reduce((summary, row) => {
    const preference = preferenceForType(row.type);
    summary[preference] = (summary[preference] || 0) + Number(row.count || 0);
    return summary;
  }, {});

  return {
    count: rows.reduce((total, row) => total + Number(row.count || 0), 0),
    by_preference: byPreference
  };
};

exports.markRead = async (id, userId) => {
  const result = await db.prepare(`UPDATE notifications SET status = 'read' WHERE id = ? AND user_id = ?`).run(id, userId);
  if (!result.changes) throw Object.assign(new Error("Notification not found"), { statusCode: 404 });
  return { updated: true };
};

exports.clearForUser = async (userId) => {
  const result = await db.prepare(`UPDATE notifications SET status = 'read' WHERE user_id = ? AND status = 'unread'`).run(userId);
  return { updated: true, count: result.changes, remaining: 0, has_more: false, failed_count: 0 };
};

exports.deleteForUser = async (id, userId) => {
  const result = await db.prepare(`DELETE FROM notifications WHERE id = ? AND user_id = ?`).run(id, userId);
  if (!result.changes) {
    const error = new Error("Notification not found");
    error.statusCode = 404;
    throw error;
  }
  return { deleted: true, id };
};

exports.deleteAllForUser = async (userId) => {
  const result = await db.prepare(`DELETE FROM notifications WHERE user_id = ?`).run(userId);
  return {
    deleted: true,
    count: result.changes,
    remaining: 0,
    has_more: false,
    failed_count: 0,
    before: new Date().toISOString()
  };
};
