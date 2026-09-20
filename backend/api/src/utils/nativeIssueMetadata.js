const { REQUIREMENT_STATUS_OPTIONS, ISSUE_STATUS_OPTIONS, PRIORITY_SCALE } = require("../domain/catalog");
const dropdownCatalog = require("../services/dropdownCatalog.service");

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

const build = ({ project, kind, mode = "create", currentValues = {}, classificationFields = [] }) => {
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
  if (isRequirement) coreFields.splice(2, 0, field("acceptance_criteria", "Acceptance Criteria", {type:"array"}));
  if (!isRequirement) coreFields.push(field("assignee", "Assignee"), ...classificationFields);

  return {
    mode,
    project_id: project.id,
    project_key: project.display_id || project.id,
    issue_type_id: isRequirement ? "hellotest-story" : "hellotest-bug",
    issue_type_name: isRequirement ? "Story" : "Defect",
    hellotest_core_field_ids: coreFields.map((item) => item.id),
    required_fields: [],
    core_fields: coreFields,
    fields: [],
    current_values: mode === "edit" ? currentValues : undefined,
    current_status: mode === "edit" ? statuses(statusOptions, currentValues.status).find((item) => item.current) || null : null,
    workflow_statuses: {
      source: "hellotest-project-workflow",
      issue_type_id: isRequirement ? "hellotest-story" : "hellotest-bug",
      issue_type_name: isRequirement ? "Story" : "Defect",
      default_status: defaultStatus,
      current_status: mode === "edit" ? statuses(statusOptions, currentValues.status).find((item) => item.current) || null : null,
      statuses: statuses(statusOptions, currentValues.status)
    },
    strategy: {
      requirements_source: "HelloTest PostgreSQL requirements",
      bugs_source: "HelloTest PostgreSQL defects",
      synced_fields: coreFields.map((item) => item.id),
      note: "Fields are validated and persisted by HelloTest's native workflow service."
    }
  };
};

module.exports = {
  requirementMetadata: (input) => build({ ...input, kind: "requirement" }),
  issueMetadata: async (input) => {
    const classificationFields = await Promise.all([
      ["root_cause", "Primary Root Cause", "issues.root_causes"],
      ["qa_root_cause", "QA Root Cause", "issues.qa_root_causes"],
      ["bug_type", "Defect Type", "issues.bug_types"]
    ].map(async ([id, name, key]) => {
      const current = input.mode === "edit" ? input.currentValues?.[id] : null;
      const options = await dropdownCatalog.getOptions(key, { includeInactive: true });
      const values = options.filter(option => option.active !== false || option.value === current)
        .map(option => ({ value: option.value, name: option.label, label: option.label,
          ...(option.value === current ? { current: true } : {}), ...(option.active === false ? { inactive: true } : {}) }));
      if (current && !values.some(option => option.value === current)) {
        values.push({ value: current, name: current, label: current, current: true, inactive: true });
      }
      return field(id, name, { allowedValues: values });
    }));
    return build({ ...input, kind: "issue", classificationFields });
  }
};
