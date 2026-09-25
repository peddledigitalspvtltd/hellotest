const { randomUUID: uuid } = require("crypto");
const db = require("@hellotest/platform/backend/src/db");

const FIELD_LABELS = {
  project_id: "Project",
  user_id: "Reporter",
  title: "Title",
  message: "Description",
  steps_to_reproduce: "Steps to Reproduce",
  expected_result: "Expected Result",
  actual_result: "Actual Result",
  status: "Status",
  severity: "Severity",
  priority: "Priority",
  environment: "Environment",
  build: "Build",
  jira_bug_key: "External Defect Key",
  linked_test_run_id: "Linked Test Run",
  linked_test_case_ids: "Linked Test Cases",
  linked_test_suite_ids: "Linked Test Suites",
  linked_module_ids: "Linked Modules",
  linked_requirement_ids: "Linked Stories",
  labels: "Labels",
  sprint: "Sprint",
  fix_version: "Fix Version",
  release: "Release",
  assignee_id: "Assignee",
  root_cause: "Primary Root Cause",
  qa_root_cause: "QA Root Cause",
  bug_type: "Defect Type",
  regression: "Regression"
};

const REFERENCES = {
  project_id: ["projects", "name"],
  user_id: ["users", "name"],
  assignee_id: ["users", "name"],
  linked_test_run_id: ["executions", "name"],
  linked_test_case_ids: ["test_cases", "title"],
  linked_test_suite_ids: ["test_suites", "name"],
  linked_module_ids: ["test_case_modules", "name"],
  linked_requirement_ids: ["requirements", "title"]
};

const normalizedValue = (value) => {
  if (Array.isArray(value)) return [...new Set(value)].sort();
  return value === undefined || value === "" ? null : value;
};

const buildChanges = (before, after) => Object.entries(FIELD_LABELS).flatMap(([field, label]) => {
  const oldValue = normalizedValue(before?.[field]);
  const newValue = normalizedValue(after?.[field]);
  return JSON.stringify(oldValue) === JSON.stringify(newValue)
    ? []
    : [{ field, label, old_value: oldValue, new_value: newValue }];
});

const displayReferences = async (change) => {
  const reference = REFERENCES[change.field];
  if (!reference) return change;
  const ids = [...new Set([change.old_value, change.new_value].flat().filter(Boolean))];
  if (!ids.length) return change;
  const [table, labelColumn] = reference;
  // Table/column names come exclusively from the static field allowlist above.
  const rows = await db.prepare(`SELECT id, ${labelColumn} AS label FROM ${table} WHERE id IN (${ids.map(() => "?").join(",")})`).all(...ids);
  const labels = new Map(rows.map((row) => [row.id, row.label || row.id]));
  const display = (value) => Array.isArray(value)
    ? value.map((id) => labels.get(id) || id).join(", ")
    : value ? labels.get(value) || value : null;
  return { ...change, old_display: display(change.old_value), new_display: display(change.new_value) };
};

// Called inside the same transaction as the issue mutation, so an edit and its
// history either both commit or both roll back. Names are captured at edit time.
const record = async ({ issueId, actorId, before = null, after }) => {
  const changes = buildChanges(before, after);
  if (before && !changes.length) return;
  const actor = actorId
    ? await db.prepare("SELECT id, name, email FROM users WHERE id = ?").get(actorId)
    : null;
  const recordedChanges = [];
  for (const change of changes) recordedChanges.push(await displayReferences(change));
  await db.prepare(`
    INSERT INTO issue_history (id, issue_id, actor_id, actor_name, actor_email, action, changes)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(uuid(), issueId, actor?.id || null, actor?.name || actor?.email || "System", actor?.email || null, before ? "updated" : "created", recordedChanges);
};

const list = async (issue) => {
  const rows = await db.prepare(`
    SELECT id, issue_id, actor_id, actor_name, actor_email, action, changes, created_at
    FROM issue_history
    WHERE issue_id = ?
    ORDER BY created_at DESC, id DESC
  `).all(issue.id);
  if (!rows.some((row) => row.action === "created")) {
    rows.push({
      id: `created:${issue.id}`,
      issue_id: issue.id,
      actor_id: issue.user_id,
      actor_name: issue.user_name || issue.user_email || "Unknown user",
      actor_email: issue.user_email || null,
      action: "created",
      changes: [],
      created_at: issue.created_at,
      legacy: true
    });
  }
  return rows;
};

module.exports = { record, list, buildChanges };
