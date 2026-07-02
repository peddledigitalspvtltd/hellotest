const db = require("../db");

const FEATURE_FLAGS_SETTINGS_KEY = "feature_flags";

const PERMISSION_FEATURES = {
  "requirement.view": ["qaira.manual.requirements"],
  "requirement.create": ["qaira.manual.requirements"],
  "requirement.update": ["qaira.manual.requirements"],
  "requirement.delete": ["qaira.manual.requirements"],
  "requirement.ai": ["qaira.ai.requirement_design"],
  "testcase.view": ["qaira.manual.test_cases"],
  "testcase.create": ["qaira.manual.test_cases"],
  "testcase.update": ["qaira.manual.test_cases"],
  "testcase.delete": ["qaira.manual.test_cases"],
  "testcase.export": ["qaira.manual.test_cases"],
  "step.manage": ["qaira.manual.test_cases"],
  "shared_step.view": ["qaira.manual.suites"],
  "shared_step.manage": ["qaira.manual.suites"],
  "suite.view": ["qaira.manual.suites"],
  "suite.create": ["qaira.manual.suites"],
  "suite.update": ["qaira.manual.suites"],
  "suite.delete": ["qaira.manual.suites"],
  "automation.view": ["qaira.automation.workspace"],
  "automation.repository.manage": ["qaira.automation.object_repository"],
  "automation.build": ["qaira.automation.workspace"],
  "automation.recorder": ["qaira.automation.recorder"],
  "automation.preview": ["qaira.api.preview"],
  "agentic_workflow.view": ["qaira.ai.agentic_workflows"],
  "agentic_workflow.manage": ["qaira.ai.agentic_workflows"],
  "agentic_workflow.run": ["qaira.ai.agentic_workflows"],
  "run.view": ["qaira.manual.runs"],
  "run.create": ["qaira.manual.runs"],
  "run.update": ["qaira.manual.runs"],
  "run.execute": ["qaira.manual.runs"],
  "run.delete": ["qaira.manual.runs"],
  "run.report.share": ["qaira.manual.runs"],
  "result.view": ["qaira.manual.runs"],
  "result.manage": ["qaira.manual.runs"],
  "schedule.view": ["qaira.automation.batch_process"],
  "schedule.create": ["qaira.automation.batch_process"],
  "schedule.update": ["qaira.automation.batch_process"],
  "schedule.run": ["qaira.automation.batch_process"],
  "schedule.delete": ["qaira.automation.batch_process"],
  "integration.view": ["qaira.api.integrations"],
  "integration.manage": ["qaira.api.integrations"],
  "knowledge.view": ["qaira.ai.knowledge"],
  "knowledge.manage": ["qaira.ai.knowledge"],
  "prompt_template.view": ["qaira.ai.test_authoring"],
  "prompt_template.manage": ["qaira.ai.test_authoring"],
  "transaction.view": ["qaira.ops.background_jobs"],
  "transaction.manage": ["qaira.ops.background_jobs"],
  "ops.view": ["qaira.ops.telemetry"],
  "ops.manage": ["qaira.ops.telemetry"]
};

const FEATURE_GROUPS = [
  {
    key: "manual_testing",
    label: "Manual Testing",
    description: "Requirements, manual cases, suites, shared steps, manual execution, and evidence review.",
    features: [
      { key: "qaira.manual.requirements", label: "Requirements", routes: ["/requirements"] },
      { key: "qaira.manual.test_cases", label: "Test cases", routes: ["/test-cases", "/shared-steps", "/design"] },
      { key: "qaira.manual.suites", label: "Suites and shared steps", routes: ["/design", "/shared-steps"] },
      { key: "qaira.manual.runs", label: "Manual runs and reports", routes: ["/executions"] }
    ]
  },
  {
    key: "automation",
    label: "Automation",
    description: "Automation authoring, object repository, recorder capture, generators, and batch process operations.",
    features: [
      { key: "qaira.automation.workspace", label: "Automation workspace", routes: ["/automation"] },
      { key: "qaira.automation.object_repository", label: "Object repository", routes: ["/object-repository"] },
      { key: "qaira.automation.recorder", label: "Recorder and inspect", routes: ["/automation", "/object-repository"] },
      { key: "qaira.automation.batch_process", label: "Batch process", routes: ["/testops"] }
    ]
  },
  {
    key: "ai",
    label: "AI",
    description: "AI requirement design, test generation, automation repair, execution analysis, knowledge, and agents.",
    features: [
      { key: "qaira.ai.requirement_design", label: "Requirement design", routes: ["/requirements", "/design"] },
      { key: "qaira.ai.test_authoring", label: "Test authoring", routes: ["/test-cases"] },
      { key: "qaira.ai.automation", label: "Automation AI", routes: ["/automation", "/object-repository"] },
      { key: "qaira.ai.execution_analysis", label: "Execution analysis", routes: ["/executions"] },
      { key: "qaira.ai.knowledge", label: "Knowledge repo", routes: ["/knowledge-repo"] },
      { key: "qaira.ai.agentic_workflows", label: "Agentic workflows", routes: ["/agentic-workflows"] }
    ]
  },
  {
    key: "api",
    label: "API",
    description: "API testing, API request previews, integrations, scoped API keys, and external automation clients.",
    features: [
      { key: "qaira.api.testing", label: "API test steps", routes: ["/test-cases", "/automation"] },
      { key: "qaira.api.preview", label: "API previews", routes: ["/automation"] },
      { key: "qaira.api.keys", label: "Scoped API keys", routes: ["/admin-space"] },
      { key: "qaira.api.integrations", label: "API integrations", routes: ["/integrations", "/admin-space"] }
    ]
  },
  {
    key: "mobile",
    label: "Mobile",
    description: "Android, iOS, Appium, mobile recorder, and mobile execution capabilities.",
    features: [
      { key: "qaira.mobile.android", label: "Android testing", routes: ["/automation", "/test-environments"] },
      { key: "qaira.mobile.ios", label: "iOS testing", routes: ["/automation", "/test-environments"] },
      { key: "qaira.mobile.recorder", label: "Mobile recorder", routes: ["/automation"] },
      { key: "qaira.mobile.appium", label: "Appium execution", routes: ["/test-environments", "/executions"] }
    ]
  },
  {
    key: "operations",
    label: "Operations",
    description: "Background jobs, local agents, OPS telemetry, traces, notifications, and audit controls.",
    features: [
      { key: "qaira.ops.background_jobs", label: "Background jobs", routes: ["/testops"] },
      { key: "qaira.ops.telemetry", label: "OPS telemetry", routes: ["/ops-telemetry", "/traces"] },
      { key: "qaira.ops.notifications", label: "Notifications", routes: ["/notifications"] },
      { key: "qaira.ops.admin", label: "Administration", routes: ["/admin-space", "/people"] }
    ]
  }
];

const FEATURE_DEFINITIONS = FEATURE_GROUPS.flatMap((group) =>
  group.features.map((feature) => ({
    ...feature,
    group: group.key,
    group_label: group.label
  }))
);

const DEFAULT_FEATURE_FLAGS = Object.fromEntries(FEATURE_DEFINITIONS.map((feature) => [feature.key, true]));

const normalizeObject = (value) => value && typeof value === "object" && !Array.isArray(value) ? value : {};

const normalizeBooleanFlagMap = (input) => {
  const rawFlags = normalizeObject(input.flags || input);
  return Object.fromEntries(
    FEATURE_DEFINITIONS.map((feature) => [
      feature.key,
      typeof rawFlags[feature.key] === "boolean" ? rawFlags[feature.key] : DEFAULT_FEATURE_FLAGS[feature.key]
    ])
  );
};

const getStoredFlags = async () => {
  const row = await db.prepare(`
    SELECT value
    FROM app_settings
    WHERE key = ?
  `).get(FEATURE_FLAGS_SETTINGS_KEY);

  return normalizeBooleanFlagMap(normalizeObject(row?.value));
};

const saveStoredFlags = async (flags) => {
  const normalizedFlags = normalizeBooleanFlagMap({ flags });

  await db.prepare(`
    INSERT INTO app_settings (key, value, updated_at)
    VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT (key)
    DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP
  `).run(FEATURE_FLAGS_SETTINGS_KEY, { flags: normalizedFlags });

  return normalizedFlags;
};

const evaluateFlags = async () => {
  const localFlags = await getStoredFlags();

  return Object.fromEntries(
    FEATURE_DEFINITIONS.map((feature) => {
      const locallyEnabled = localFlags[feature.key] !== false;
      return [feature.key, locallyEnabled];
    })
  );
};

exports.FEATURE_GROUPS = FEATURE_GROUPS;
exports.FEATURE_DEFINITIONS = FEATURE_DEFINITIONS;

exports.getSnapshot = async ({ user } = {}) => ({
  groups: FEATURE_GROUPS,
  flags: await evaluateFlags({ user }),
  local_flags: await getStoredFlags(),
  provider: {
    type: "local",
    configured: true,
    connected: true
  }
});

exports.updateLocalFlags = async (flags) => ({
  updated: true,
  flags: await saveStoredFlags(flags)
});

exports.isEnabled = async (featureKey, { user } = {}) => {
  const flags = await evaluateFlags({ user });
  return flags[featureKey] !== false;
};

exports.areEnabled = async (featureKeys = [], { user } = {}) => {
  const keys = Array.isArray(featureKeys) ? featureKeys.filter(Boolean) : [];

  if (!keys.length) {
    return true;
  }

  const flags = await evaluateFlags({ user });
  return keys.every((featureKey) => flags[featureKey] !== false);
};

exports.getFeatureKeysForPermission = (permissionCode) => PERMISSION_FEATURES[permissionCode] || [];
