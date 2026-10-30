const { randomUUID } = require("crypto");
const {normalizeDataOptions}=require('./scopedTestData');
const { resolveAutomationCaseType } = require('./automationCaseType');

const buildAutomationCaseBlueprint = ({ source, steps = [], createdBy, createGroupId = randomUUID }) => {
  const groups = new Map();
  const sourceDataOptions=normalizeDataOptions(source.test_data_options||{},"steps");
  const blueprint = {
    app_type_id: source.app_type_id,
    title: `${source.title} · Automation`,
    description: source.description || "",
    external_references: source.external_references || [],
    labels: source.labels || [],
    // Linked manual values remain live defaults; only user-authored AT keys
    // belong here, otherwise later manual edits would be shadowed forever.
    parameter_values: {},
    test_data_options: normalizeDataOptions({...sourceDataOptions,override_shared_sections:sourceDataOptions.override_shared_steps},"sections"),
    automated: "yes",
    automation_case_type: resolveAutomationCaseType(source, { steps }),
    automation_status: "incomplete",
    manual_test_case_ids: [source.id],
    requirement_ids: source.requirement_ids?.length ? source.requirement_ids : [source.requirement_id].filter(Boolean),
    suite_ids: source.suite_ids?.length ? source.suite_ids : [source.suite_id].filter(Boolean),
    test_data_set_ids: source.test_data_set_ids || [],
    authoring_mode: source.authoring_mode || "structured",
    gherkin_document: source.gherkin_document || null,
    test_case_type: source.test_case_type || "functional",
    priority: source.priority ?? 3,
    status: "draft",
    created_by: createdBy,
    source_idempotency_key: `automation-builder:${source.id}`,
    steps: steps.map((step, index) => {
      if (step.group_id && !groups.has(step.group_id)) groups.set(step.group_id, createGroupId());
      return {
        step_order: index + 1,
        action: step.action || "",
        expected_result: step.expected_result || "",
        step_type: step.step_type || "web",
        automation_code: step.automation_code || null,
        api_request: step.api_request || null,
        group_id: step.group_id ? groups.get(step.group_id) : null,
        group_name: step.group_name || null,
        group_kind: step.group_kind || null,
        reusable_group_id: step.reusable_group_id || null
      };
    })
  };
  if (blueprint.gherkin_document) {
    blueprint.gherkin_document = blueprint.gherkin_document.replace(/(# (?:End )?Shared Step Group \[)([^\]]+)(\])/g, (_match, prefix, id, suffix) => `${prefix}${groups.get(id) || id}${suffix}`);
  }
  return blueprint;
};

module.exports = { buildAutomationCaseBlueprint };
