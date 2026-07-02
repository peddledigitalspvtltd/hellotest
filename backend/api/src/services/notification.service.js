const db = require("../db");
const { v4: uuid } = require("uuid");

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
  return db.prepare(query).all(...params);
};

exports.markRead = async (id, userId) => {
  const notification = await db.prepare(`SELECT * FROM notifications WHERE id = ?`).get(id);
  if (!notification) {
    throw new Error("Notification not found");
  }

  if (userId && notification.user_id !== userId) {
    throw new Error("Notification does not belong to the current user");
  }

  await db.prepare(`UPDATE notifications SET status = 'read' WHERE id = ?`).run(id);
  return { updated: true };
};

exports.clearForUser = async (userId) => {
  await db.prepare(`UPDATE notifications SET status = 'read' WHERE user_id = ?`).run(userId);
  return { updated: true };
};
