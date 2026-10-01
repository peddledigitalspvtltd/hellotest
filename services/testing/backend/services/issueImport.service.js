const db = require("@hellotest/platform/backend/src/db");
const { createHash } = require("node:crypto");
const { ISSUE_STATUS_OPTIONS } = require("@hellotest/platform/backend/src/domain/catalog");
const dropdownCatalog = require("@hellotest/platform/backend/services/dropdownCatalog.service");
const transactions = require("@hellotest/platform/backend/services/workspaceTransaction.service");
const issues = require("./issues.service");

const MAX_ROWS = 500;
const fields = new Set(["title", "message", "steps_to_reproduce", "expected_result", "actual_result", "status", "severity", "priority", "environment", "build", "assignee_id", "user_id", "labels", "sprint", "release", "fix_version", "root_cause", "qa_root_cause", "bug_type", "regression", "jira_bug_key"]);
const fail = message => { throw Object.assign(new Error(message), { statusCode: 400 }); };
const key = value => String(value || "").trim().toLowerCase();
const classifications = [["root_cause", "issues.root_causes"], ["qa_root_cause", "issues.qa_root_causes"], ["bug_type", "issues.bug_types"]];
const resolveChoice = (value, choices, label) => {
  const found = choices.find(option => [option.value, option.label].some(candidate => key(candidate) === key(value)));
  if (!found) fail(`${label}: choose one of ${choices.map(option => option.label || option.value).join(", ")}.`);
  return found.value;
};
exports.validateRows = async ({ project_id, rows, created_by }) => {
  if (!Array.isArray(rows) || !rows.length || rows.length > MAX_ROWS) fail(`Provide between 1 and ${MAX_ROWS} bug rows.`);
  if (Buffer.byteLength(JSON.stringify(rows)) > 4 * 1024 * 1024) fail("The import exceeds 4 MB. Split it into smaller files.");
  const [people, catalogs] = await Promise.all([
    db.prepare(`SELECT DISTINCT users.id, users.name, users.email FROM users
      JOIN project_members ON project_members.user_id = users.id WHERE project_members.project_id = ?
      UNION SELECT id, name, email FROM users WHERE id = ?`).all(project_id, created_by),
    Promise.all(classifications.map(async ([field, catalog]) => [field, (await dropdownCatalog.getOptions(catalog)).filter(option => option.active !== false)]))
  ]);
  const choices = Object.fromEntries(catalogs);
  const resolvePerson = (value, label) => {
    const matches = people.filter(user => [user.id, user.email].some(candidate => key(candidate) === key(value)));
    const named = matches.length ? matches : people.filter(user => key(user.name) === key(value));
    if (named.length !== 1) fail(`${label}: use a unique project member name, email or user ID.`);
    return named[0].id;
  };
  const normalized = [];
  const errors = [];
  const seen = new Map();
  rows.forEach((input, index) => {
    try {
      if (!input || typeof input !== "object" || Array.isArray(input)) fail("Each bug must be an object.");
      const row = {};
      for (const [field, value] of Object.entries(input)) {
        if (!fields.has(field)) fail(`Unsupported field: ${field}. Use the Bug template.`);
        if (field === "labels") {
          if (!Array.isArray(value) || value.length > 50 || value.some(label => typeof label !== "string" || label.length > 100)) fail("Labels must be a list of up to 50 short text values.");
          row.labels = [...new Set(value.map(label => label.trim()).filter(Boolean))];
        } else if (field === "regression") {
          if (typeof value !== "boolean") fail("Regression must be true or false.");
          row.regression = value;
        } else {
          if (typeof value !== "string") fail(`${field} must be text.`);
          if (value.length > (field === "title" ? 500 : 50000)) fail(`${field} is too long.`);
          if (value.trim()) row[field] = value.trim();
        }
      }
      if (!row.title || row.title.length < 2 || !row.message || row.message.length < 2) fail("Title and Description must each contain at least two characters.");
      row.status = row.status ? resolveChoice(row.status, ISSUE_STATUS_OPTIONS, "Status") : "open";
      if (row.severity) row.severity = resolveChoice(row.severity, ["critical", "high", "medium", "low"].map(value => ({ value })), "Severity");
      if (row.priority) row.priority = resolveChoice(row.priority, ["Highest", "High", "Medium", "Low", "Lowest"].map(value => ({ value })), "Priority");
      for (const [field] of classifications) if (row[field]) row[field] = resolveChoice(row[field], choices[field], field);
      row.user_id = row.user_id ? resolvePerson(row.user_id, "Reported by") : created_by;
      if (row.assignee_id && key(row.assignee_id) !== "unassigned") row.assignee_id = resolvePerson(row.assignee_id, "Assignee");
      else delete row.assignee_id;
      const fingerprint = createHash("sha256").update(JSON.stringify(Object.keys(row).sort().map(field => [field, row[field]]))).digest("hex");
      if (seen.has(fingerprint)) fail(`Duplicate of row ${seen.get(fingerprint)}. Remove the repeated row.`);
      seen.set(fingerprint, index + 2);
      normalized.push(row);
    } catch (error) { errors.push({ row: index + 2, message: error.message }); }
  });
  return { rows: normalized, errors, total: rows.length };
};

// Stable IDs and a database lock make replay after a worker/network failure safe.
const importRowId = (transactionId, index) => {
  const hash = createHash("sha256").update(`bug-import:${transactionId}:${index}`).digest("hex");
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
};
exports.run = async ({ project_id, rows, created_by, transaction_id }) => {
  const preview = await exports.validateRows({ project_id, rows, created_by });
  if (preview.errors.length) fail(preview.errors.map(error => `Row ${error.row}: ${error.message}`).join("\n"));
  const results = [];
  for (const [index, row] of preview.rows.entries()) {
    const issueId = importRowId(transaction_id, index);
    const result = await db.transaction(async () => {
      await db.prepare("SELECT pg_advisory_xact_lock(hashtext(?))").get(issueId);
      const existing = await db.prepare("SELECT id, display_id FROM feedback WHERE id = ? AND project_id = ?").get(issueId, project_id);
      if (existing) return { ...existing, status: "imported" };
      const created = await issues.createIssue({ ...row, project_id }, { actorId: created_by, issueId });
      return { ...created, status: "imported" };
    })();
    results.push({ row: index + 2, title: row.title, ...result });
    if (results.length % 10 === 0 || results.length === rows.length) await transactions.updateTransaction(transaction_id, {
      metadata: { processed_items: results.length, imported: results.length, total_items: rows.length, progress_percent: Math.round(results.length / rows.length * 100), current_phase: "importing" }
    });
  }
  const artifact = await transactions.createTransactionArtifact(transaction_id, {
    file_name: "bug-import-results.json", mime_type: "application/json", content: JSON.stringify({ imported: results.length, rows: results }, null, 2)
  });
  await transactions.updateTransaction(transaction_id, {
    status: "completed", completed_at: new Date().toISOString(), description: `Imported ${results.length} bugs.`,
    metadata: { processed_items: results.length, imported: results.length, failed: 0, progress_percent: 100, current_phase: "completed" }
  });
  await transactions.appendTransactionEvent(transaction_id, { level: "success", phase: "complete", message: `Imported ${results.length} bugs.`, details: { artifact_id: artifact.id } });
  return { imported: results.length, artifact_id: artifact.id, rows: results };
};
exports.MAX_ROWS = MAX_ROWS;
