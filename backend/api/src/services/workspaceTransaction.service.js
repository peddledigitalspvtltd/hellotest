const db = require("../db");
const obsDb = require("../obsDb");
const { randomUUID: uuid } = require("crypto");
const notificationService = require("./notification.service");
const { placeholdersFor } = require("../utils/batchHydration");

const WORKSPACE_TRANSACTION_STATUSES = new Set(["queued", "running", "completed", "failed"]);
const WORKSPACE_TRANSACTION_EVENT_LEVELS = new Set(["info", "success", "warning", "error"]);

const selectTransaction = obsDb.prepare(`
  SELECT
    workspace_transactions.*,
    (
      SELECT COUNT(*)
      FROM workspace_transaction_events
      WHERE workspace_transaction_events.transaction_id = workspace_transactions.id
    ) AS event_count,
    (
      SELECT MAX(created_at)
      FROM workspace_transaction_events
      WHERE workspace_transaction_events.transaction_id = workspace_transactions.id
    ) AS latest_event_at
  FROM workspace_transactions
  WHERE workspace_transactions.id = ?
`);

const selectTransactionByRelated = obsDb.prepare(`
  SELECT
    workspace_transactions.*,
    (
      SELECT COUNT(*)
      FROM workspace_transaction_events
      WHERE workspace_transaction_events.transaction_id = workspace_transactions.id
    ) AS event_count,
    (
      SELECT MAX(created_at)
      FROM workspace_transaction_events
      WHERE workspace_transaction_events.transaction_id = workspace_transactions.id
    ) AS latest_event_at
  FROM workspace_transactions
  WHERE workspace_transactions.related_kind = ?
    AND workspace_transactions.related_id = ?
  ORDER BY workspace_transactions.created_at DESC, workspace_transactions.id DESC
  LIMIT 1
`);

const insertTransaction = obsDb.prepare(`
  INSERT INTO workspace_transactions (
    id,
    project_id,
    app_type_id,
    category,
    action,
    status,
    title,
    description,
    metadata,
    related_kind,
    related_id,
    created_by,
    started_at,
    completed_at
  )
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const updateTransaction = obsDb.prepare(`
  UPDATE workspace_transactions
  SET project_id = ?,
      app_type_id = ?,
      category = ?,
      action = ?,
      status = ?,
      title = ?,
      description = ?,
      metadata = ?,
      related_kind = ?,
      related_id = ?,
      created_by = ?,
      started_at = ?,
      completed_at = ?,
      updated_at = CURRENT_TIMESTAMP
  WHERE id = ?
`);

const insertTransactionEvent = obsDb.prepare(`
  INSERT INTO workspace_transaction_events (
    id,
    transaction_id,
    level,
    phase,
    message,
    details
  )
  VALUES (?, ?, ?, ?, ?, ?)
`);

const selectTransactionEvents = obsDb.prepare(`
  SELECT *
  FROM workspace_transaction_events
  WHERE transaction_id = ?
  ORDER BY created_at ASC, id ASC
`);

const insertTransactionArtifact = obsDb.prepare(`
  INSERT INTO workspace_transaction_artifacts (
    id,
    transaction_id,
    file_name,
    mime_type,
    content
  )
  VALUES (?, ?, ?, ?, ?)
`);

const selectTransactionArtifacts = obsDb.prepare(`
  SELECT id, transaction_id, file_name, mime_type, created_at
  FROM workspace_transaction_artifacts
  WHERE transaction_id = ?
  ORDER BY created_at DESC, id DESC
`);

const selectTransactionArtifact = obsDb.prepare(`
  SELECT *
  FROM workspace_transaction_artifacts
  WHERE id = ?
`);

const deleteTransactionEvents = obsDb.prepare(`
  DELETE FROM workspace_transaction_events
  WHERE transaction_id = ?
`);

const deleteTransactionArtifacts = obsDb.prepare(`
  DELETE FROM workspace_transaction_artifacts
  WHERE transaction_id = ?
`);

const deleteBatchJob = obsDb.prepare(`
  DELETE FROM batch_process_jobs
  WHERE transaction_id = ?
`);

const deleteTransactionById = obsDb.prepare(`
  DELETE FROM workspace_transactions
  WHERE id = ?
`);

const normalizeText = (value) => {
  if (value === undefined) {
    return undefined;
  }

  if (value === null) {
    return null;
  }

  const normalized = String(value).trim();
  return normalized || null;
};

const normalizeMetadata = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return Object.entries(value).reduce((accumulator, [key, entry]) => {
    const normalizedKey = String(key || "").trim();

    if (!normalizedKey) {
      return accumulator;
    }

    accumulator[normalizedKey] = entry;
    return accumulator;
  }, {});
};

const normalizeStatus = (value, fallback = "completed") => {
  const normalized = String(value || "").trim().toLowerCase();
  return WORKSPACE_TRANSACTION_STATUSES.has(normalized) ? normalized : fallback;
};

const normalizeEventLevel = (value, fallback = "info") => {
  const normalized = String(value || "").trim().toLowerCase();
  return WORKSPACE_TRANSACTION_EVENT_LEVELS.has(normalized) ? normalized : fallback;
};

const normalizeTimestamp = (value) => {
  if (value === undefined) {
    return undefined;
  }

  if (value === null) {
    return null;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
};

const parseJsonValue = (value, fallback) => {
  if (value === null || value === undefined || value === "") {
    return fallback;
  }

  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return fallback;
    }
  }

  return value;
};

const hydrateTransactions = async (transactions) => {
  const userIds = [...new Set(transactions
    .filter((transaction) => transaction?.created_by && !transaction.created_user_email)
    .map((transaction) => transaction.created_by))];
  const userRows = userIds.length
    ? await db.prepare(`
        SELECT id, email, name, avatar_data_url
        FROM users
        WHERE id IN (${placeholdersFor(userIds)})
      `).all(...userIds)
    : [];
  const usersById = new Map(userRows.map((user) => [user.id, user]));

  return transactions.map((transaction) => {
    if (!transaction) return null;
    const createdUser = usersById.get(transaction.created_by);
    const createdUserEmail = transaction.created_user_email || createdUser?.email;
    const createdUserName = transaction.created_user_name || createdUser?.name || null;
    const createdUserAvatar = transaction.created_user_avatar_data_url || createdUser?.avatar_data_url || null;

    return {
      ...transaction,
      metadata: parseJsonValue(transaction.metadata, {}),
      event_count: Number(transaction.event_count) || 0,
      created_user: transaction.created_by
        ? {
            id: transaction.created_by,
            email: createdUserEmail,
            name: createdUserName,
            avatar_data_url: createdUserAvatar
          }
        : null
    };
  });
};

const hydrateTransaction = async (transaction) => {
  if (!transaction) return null;
  return (await hydrateTransactions([transaction]))[0];
};

const hydrateTransactionEvent = (event) => {
  if (!event) {
    return null;
  }

  return {
    ...event,
    level: normalizeEventLevel(event.level),
    details: parseJsonValue(event.details, {})
  };
};

const buildBatchProcessUrl = (transactionId) => `/testops?process=${encodeURIComponent(transactionId)}`;

exports.createTransaction = async (input = {}) => {
  const id = uuid();

  await insertTransaction.run(
    id,
    normalizeText(input.project_id) || null,
    normalizeText(input.app_type_id) || null,
    normalizeText(input.category) || "general",
    normalizeText(input.action) || "event",
    normalizeStatus(input.status, "completed"),
    normalizeText(input.title) || "Workspace transaction",
    normalizeText(input.description) || null,
    normalizeMetadata(input.metadata),
    normalizeText(input.related_kind) || null,
    normalizeText(input.related_id) || null,
    normalizeText(input.created_by) || null,
    normalizeTimestamp(input.started_at) || null,
    normalizeTimestamp(input.completed_at) || null
  );

  return { id };
};

exports.getTransaction = async (id) => {
  const transaction = await selectTransaction.get(id);

  if (!transaction) {
    throw new Error("Workspace transaction not found");
  }

  return await hydrateTransaction(transaction);
};

exports.findTransactionByRelated = async ({ related_kind, related_id }) => {
  if (!related_kind || !related_id) {
    return null;
  }

  return await hydrateTransaction(await selectTransactionByRelated.get(related_kind, related_id));
};

exports.updateTransaction = async (id, updates = {}) => {
  const existing = await exports.getTransaction(id);
  const metadata =
    updates.metadata === undefined
      ? existing.metadata
      : { ...existing.metadata, ...normalizeMetadata(updates.metadata) };

  await updateTransaction.run(
    normalizeText(updates.project_id) ?? existing.project_id,
    normalizeText(updates.app_type_id) ?? existing.app_type_id,
    normalizeText(updates.category) ?? existing.category,
    normalizeText(updates.action) ?? existing.action,
    updates.status !== undefined ? normalizeStatus(updates.status, existing.status) : existing.status,
    normalizeText(updates.title) ?? existing.title,
    normalizeText(updates.description) ?? existing.description,
    metadata,
    normalizeText(updates.related_kind) ?? existing.related_kind,
    normalizeText(updates.related_id) ?? existing.related_id,
    normalizeText(updates.created_by) ?? existing.created_by,
    normalizeTimestamp(updates.started_at) ?? existing.started_at,
    normalizeTimestamp(updates.completed_at) ?? existing.completed_at,
    id
  );

  return exports.getTransaction(id);
};

exports.appendTransactionEvent = async (transactionId, input = {}) => {
  const transaction = await exports.getTransaction(transactionId);
  const message = normalizeText(input.message) || "Transaction event";

  await insertTransactionEvent.run(
    uuid(),
    transaction.id,
    normalizeEventLevel(input.level),
    normalizeText(input.phase),
    message,
    normalizeMetadata(input.details)
  );

  if (input.description !== undefined || input.status !== undefined || input.metadata !== undefined) {
    await exports.updateTransaction(transaction.id, {
      description: input.description,
      status: input.status,
      metadata: input.metadata
    });
  }

  return exports.getTransaction(transaction.id);
};

exports.listTransactionEvents = async (transactionId) => {
  await exports.getTransaction(transactionId);
  const rows = await selectTransactionEvents.all(transactionId);
  return rows.map(hydrateTransactionEvent);
};

exports.createTransactionArtifact = async (transactionId, input = {}) => {
  const transaction = await exports.getTransaction(transactionId);
  const fileName = normalizeText(input.file_name || input.fileName) || "artifact.txt";
  const mimeType = normalizeText(input.mime_type || input.mimeType) || "text/plain";
  const content = input.content === undefined || input.content === null ? "" : String(input.content);
  const id = uuid();

  await insertTransactionArtifact.run(id, transaction.id, fileName, mimeType, content);

  return { id, transaction_id: transaction.id, file_name: fileName, mime_type: mimeType };
};

exports.createTransactionNotification = async (transactionId, input = {}) => {
  const transaction = await exports.getTransaction(transactionId);

  if (!transaction.created_by) {
    return null;
  }

  try {
    return await notificationService.createNotification({
      user_id: transaction.created_by,
      project_id: transaction.project_id || undefined,
      target_url: buildBatchProcessUrl(transaction.id),
      type: normalizeText(input.type) || `batch_process.${transaction.status}`,
      title: normalizeText(input.title) || transaction.title,
      message: normalizeText(input.message) || transaction.description || "Batch process status changed."
    });
  } catch {
    return null;
  }
};

exports.listTransactionArtifacts = async (transactionId) => {
  await exports.getTransaction(transactionId);
  return selectTransactionArtifacts.all(transactionId);
};

exports.getTransactionArtifact = async (artifactId) => {
  const artifact = await selectTransactionArtifact.get(artifactId);

  if (!artifact) {
    throw new Error("Workspace transaction artifact not found");
  }

  return artifact;
};

exports.deleteTransaction = async (id) => {
  const existing = await exports.getTransaction(id);

  const transaction = obsDb.transaction(async () => {
    await deleteTransactionEvents.run(id);
    await deleteTransactionArtifacts.run(id);
    await deleteBatchJob.run(id);
    await deleteTransactionById.run(id);
  });

  await transaction();
  return { deleted: true };
};

exports.listTransactions = async ({
  project_id,
  app_type_id,
  category,
  include_global = false,
  limit = 20
} = {}) => {
  let query = `
    SELECT
      workspace_transactions.*,
      (
        SELECT COUNT(*)
        FROM workspace_transaction_events
        WHERE workspace_transaction_events.transaction_id = workspace_transactions.id
      ) AS event_count,
      (
        SELECT MAX(created_at)
        FROM workspace_transaction_events
        WHERE workspace_transaction_events.transaction_id = workspace_transactions.id
      ) AS latest_event_at
    FROM workspace_transactions
    WHERE 1 = 1
  `;
  const params = [];

  if (project_id) {
    query += include_global
      ? ` AND (workspace_transactions.project_id = ? OR workspace_transactions.project_id IS NULL)`
      : ` AND workspace_transactions.project_id = ?`;
    params.push(project_id);
  }

  if (app_type_id) {
    query += include_global
      ? ` AND (workspace_transactions.app_type_id = ? OR workspace_transactions.app_type_id IS NULL)`
      : ` AND workspace_transactions.app_type_id = ?`;
    params.push(app_type_id);
  }

  if (category) {
    query += ` AND workspace_transactions.category = ?`;
    params.push(category);
  }

  query += ` ORDER BY COALESCE(workspace_transactions.updated_at, workspace_transactions.created_at) DESC, workspace_transactions.id DESC LIMIT ?`;
  params.push(Math.max(1, Math.min(500, Number(limit) || 20)));

  const rows = await obsDb.prepare(query).all(...params);
  return hydrateTransactions(rows);
};
