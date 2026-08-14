const { REQUIREMENT_STATUS_OPTIONS, ISSUE_STATUS_OPTIONS, PRIORITY_SCALE } = require("../domain/catalog");

const field = (id, name, { required = false, type = "string", allowedValues } = {}) => ({
  id,
  key: id,
  name,
  required,
  has_default_value: !required,
  schema: { type },
  operations: ["set"],
  ...(allowedValues ? { allowed_values: allowedValues } : {})
});

const priorityValues = PRIORITY_SCALE.map((value) => ({ id: String(value), value: String(value), name: `P${value}`, label: `P${value}` }));
const statuses = (options, currentStatus) => options.map((option) => ({
  value: option.value,
  label: option.label,
  description: option.description,
  current: option.value === currentStatus,
  can_transition: true,
  transition_id: option.value
}));

const build = ({ project, kind, mode = "create", currentValues = {} }) => {
  const isRequirement = kind === "requirement";
  const statusOptions = isRequirement ? REQUIREMENT_STATUS_OPTIONS : ISSUE_STATUS_OPTIONS;
  const defaultStatus = isRequirement ? "open" : "open";
  const coreFields = [
    field("summary", "Title", { required: true }),
    field("description", "Description"),
    field("priority", "Priority", { type: "number", allowedValues: priorityValues }),
    field("labels", "Labels", { type: "array" }),
    field("sprint", "Iteration / Sprint"),
    field("fixVersions", "Fix version / Release"),
    field("status", "Status", { allowedValues: statuses(statusOptions, currentValues.status).map((item) => ({ value: item.value, name: item.label, label: item.label })) })
  ];
  if (!isRequirement) coreFields.push(field("assignee", "Assignee"));

  return {
    mode,
    project_id: project.id,
    project_key: project.display_id || project.id,
    issue_type_id: isRequirement ? "qaira-story" : "qaira-bug",
    issue_type_name: isRequirement ? "Story" : "Bug",
    qaira_core_field_ids: coreFields.map((item) => item.id),
    required_fields: [],
    core_fields: coreFields,
    fields: [],
    current_values: mode === "edit" ? currentValues : undefined,
    current_status: mode === "edit" ? statuses(statusOptions, currentValues.status).find((item) => item.current) || null : null,
    workflow_statuses: {
      source: "qaira-project-workflow",
      issue_type_id: isRequirement ? "qaira-story" : "qaira-bug",
      issue_type_name: isRequirement ? "Story" : "Bug",
      default_status: defaultStatus,
      current_status: mode === "edit" ? statuses(statusOptions, currentValues.status).find((item) => item.current) || null : null,
      statuses: statuses(statusOptions, currentValues.status)
    },
    strategy: {
      requirements_source: "HelloTest PostgreSQL requirements",
      bugs_source: "HelloTest PostgreSQL issues",
      synced_fields: coreFields.map((item) => item.id),
      note: "Fields are validated and persisted by HelloTest's native workflow service."
    }
  };
};

module.exports = {
  requirementMetadata: (input) => build({ ...input, kind: "requirement" }),
  issueMetadata: (input) => build({ ...input, kind: "issue" })
};
