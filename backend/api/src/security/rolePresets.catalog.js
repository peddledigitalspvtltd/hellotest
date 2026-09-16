// Project personas are deliberately separate from the legacy admin/member
// compatibility grants. Setup creates missing roles; it never resets a role.
const codes = (...groups) => Object.freeze([...new Set(groups.flat())].sort());
const navigation = [
  "workspace.view", "settings.view", "project.view", "app_type.view",
  "dashboard.view", "notification.view"
];
const evidence = ["attachment.view", "comment.view"];
const collaboration = ["attachment.create", "comment.create", "notification.manage"];
const deliveryRead = [
  "requirement.view", "requirement_iteration.view", "testcase.view",
  "shared_step.view", "suite.view", "plan.view", "quality_gate.view",
  "run.view", "result.view", "feedback.view", "environment.view",
  "configuration.view", "data.view", "project_member.view"
];
const manualTesting = codes(navigation, evidence, collaboration, deliveryRead, [
  "testcase.create", "testcase.import", "testcase.update", "testcase.export",
  "testcase.ai", "step.manage", "shared_step.manage", "suite.create", "suite.update",
  "run.gherkin.view", "run.create", "run.update", "run.execute", "run.ai",
  "run.report.export", "result.manage", "feedback.create", "feedback.manage",
  "content.ai", "integration.view", "prompt_template.view",
  "transaction.view", "transaction.artifact.download"
]);
const scheduleAuthoring = ["schedule.view", "schedule.create", "schedule.update", "schedule.run"];
const preset = (key, name, description, permission_codes) => Object.freeze({ key, name, description, permission_codes });

const DEFAULT_ROLE_PRESETS = Object.freeze([
  preset("product-owner", "Product Owner",
    "Own Story authoring, Backlog refinement, Sprint and Release planning, and review delivery evidence. Access administration stays with administrators.",
    codes(navigation, evidence, collaboration, deliveryRead, [
      "requirement.create", "requirement.import", "requirement.export", "requirement.update", "requirement.delete", "requirement.ai",
      "requirement_iteration.create", "requirement_iteration.update", "requirement_iteration.delete", "feedback.create",
      "dashboard.manage", "quality_insight.view", "quality_gate.ai", "run.report.export",
      "content.ai", "integration.view", "prompt_template.view", "user.view",
      "transaction.view", "transaction.artifact.download"
    ])),
  preset("qa-lead", "QA Lead",
    "Coordinate manual test design, plans, quality gates, execution and schedules, with Story planning and delivery reporting. This role cannot assign access or administer the workspace.",
    codes(manualTesting, scheduleAuthoring, [
      "requirement.create", "requirement.import", "requirement.export", "requirement.update", "requirement.ai",
      "requirement_iteration.create", "requirement_iteration.update", "plan.create", "plan.update",
      "quality_gate.create", "quality_gate.update", "quality_gate.ai", "quality_insight.view",
      "testcase.delete", "suite.delete", "plan.delete", "quality_gate.delete", "run.delete", "schedule.delete",
      "dashboard.manage", "run.report.share", "user.view"
    ])),
  preset("qa-member", "QA Member",
    "Author and import manual test cases, maintain steps and suites, execute runs, record results and collaborate on Bugs. Automation code and runner control require a separate role.",
    manualTesting),
  preset("automation-engineer", "Automation Engineer",
    "Build and maintain automation assets and object repositories, inspect code, run local or remote automation, and configure test execution resources and schedules.",
    codes(manualTesting, scheduleAuthoring, [
      "automation.view", "automation.asset.create", "automation.asset.update", "automation.asset.delete",
      "automation.repository.manage", "automation.repository.import", "automation.repository.export",
      "automation.build", "automation.ai", "automation.recorder", "automation.code.view",
      "automation.run.local", "automation.run.remote", "automation.run.parallel",
      "automation.preview", "automation.analytics.view", "environment.manage",
      "configuration.manage", "data.manage", "data.import", "data.export", "data.ai",
      "mobile.view", "mobile.manage", "ops.view"
    ])),
  preset("ai-engineer", "AI Engineer",
    "Develop project AI workflows, knowledge and prompt templates, review generated Stories and test cases, and build automation drafts. Runner and workspace administration remain separate.",
    codes(manualTesting, [
      "requirement.create", "requirement.update", "requirement.ai", "user.view",
      "agentic_workflow.view", "agentic_workflow.manage", "agentic_workflow.run",
      "knowledge.view", "knowledge.manage", "prompt_template.manage",
      "automation.view", "automation.asset.create", "automation.asset.update",
      "automation.repository.manage", "automation.repository.import", "automation.repository.export",
      "automation.build", "automation.ai", "automation.code.view",
      "data.manage", "data.import", "data.export", "data.ai",
      "quality_insight.view", "quality_gate.ai", "dashboard.manage"
    ])),
  preset("reporter", "Reporter",
    "Report new Bugs with comments and attachments and read their linked project, Story, test case and execution context. Existing Bugs cannot be edited or deleted.",
    codes(navigation, evidence, collaboration, [
      "requirement.view", "requirement_iteration.view", "testcase.view", "suite.view",
      "run.view", "result.view", "feedback.view", "feedback.create", "environment.view",
      "project_member.view"
    ])),
  preset("viewer", "Viewer",
    "Read project delivery, test coverage, runs and supporting evidence without changing product records or starting execution.",
    codes(navigation, evidence, deliveryRead))
]);

const normalizePresetRoleName = (name) => String(name || "").trim().toLowerCase();
const findDefaultRolePreset = (name) => DEFAULT_ROLE_PRESETS.find(role => normalizePresetRoleName(role.name) === normalizePresetRoleName(name));

module.exports = { DEFAULT_ROLE_PRESETS, findDefaultRolePreset, normalizePresetRoleName };
