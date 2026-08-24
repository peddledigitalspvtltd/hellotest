const db = require("../db");

const FEATURE_FLAGS_SETTINGS_KEY = "feature_flags";

const PERMISSION_FEATURES = {
  "dashboard.view": ["hellotest.analytics.dashboards"],
  "dashboard.manage": ["hellotest.analytics.dashboards"],
  "quality_insight.view": ["hellotest.ai.quality_insights"],
  "project.view": ["hellotest.ops.projects"],
  "project.create": ["hellotest.ops.projects"],
  "project.update": ["hellotest.ops.projects"],
  "project.delete": ["hellotest.ops.projects"],
  "project.sync": ["hellotest.ops.projects"],
  "settings.manage": ["hellotest.ops.admin"],
  "workspace_preferences.manage": ["hellotest.ops.admin"],
  "api_key.manage": ["hellotest.api.keys"],
  "localization.manage": ["hellotest.ops.admin"],
  "ai_prompt.manage": ["hellotest.ai.prompt_mapping"],
  "feature_flag.manage": ["hellotest.ops.admin"],
  "user.view": ["hellotest.ops.admin"],
  "user.manage": ["hellotest.ops.admin"],
  "user.import": ["hellotest.ops.admin"],
  "role.view": ["hellotest.ops.admin"],
  "role.manage": ["hellotest.ops.admin"],
  "project_member.view": ["hellotest.ops.admin"],
  "project_member.manage": ["hellotest.ops.admin"],
  "requirement.view": ["hellotest.manual.requirements"],
  "requirement.create": ["hellotest.manual.requirements"],
  "requirement.import": ["hellotest.manual.requirements"],
  "requirement.export": ["hellotest.manual.requirements"],
  "requirement.update": ["hellotest.manual.requirements"],
  "requirement.delete": ["hellotest.manual.requirements"],
  "requirement.ai": ["hellotest.ai.requirement_design"],
  "requirement_iteration.view": ["hellotest.manual.requirements"],
  "requirement_iteration.create": ["hellotest.manual.requirements"],
  "requirement_iteration.update": ["hellotest.manual.requirements"],
  "requirement_iteration.delete": ["hellotest.manual.requirements"],
  "testcase.view": ["hellotest.manual.test_cases"],
  "testcase.create": ["hellotest.manual.test_cases"],
  "testcase.import": ["hellotest.manual.test_cases"],
  "testcase.update": ["hellotest.manual.test_cases"],
  "testcase.delete": ["hellotest.manual.test_cases"],
  "testcase.export": ["hellotest.manual.test_cases"],
  "testcase.ai": ["hellotest.ai.test_authoring"],
  "step.manage": ["hellotest.manual.test_cases"],
  "shared_step.view": ["hellotest.manual.suites"],
  "shared_step.manage": ["hellotest.manual.suites"],
  "suite.view": ["hellotest.manual.suites"],
  "suite.create": ["hellotest.manual.suites"],
  "suite.update": ["hellotest.manual.suites"],
  "suite.delete": ["hellotest.manual.suites"],
  "plan.view": ["hellotest.manual.plans"],
  "plan.create": ["hellotest.manual.plans"],
  "plan.update": ["hellotest.manual.plans"],
  "plan.delete": ["hellotest.manual.plans"],
  "quality_gate.view": ["hellotest.manual.quality_gates"],
  "quality_gate.create": ["hellotest.manual.quality_gates"],
  "quality_gate.update": ["hellotest.manual.quality_gates"],
  "quality_gate.delete": ["hellotest.manual.quality_gates"],
  "quality_gate.ai": ["hellotest.ai.quality_insights"],
  "automation.view": ["hellotest.automation.workspace"],
  "automation.asset.create": ["hellotest.automation.assets"],
  "automation.asset.update": ["hellotest.automation.assets"],
  "automation.asset.delete": ["hellotest.automation.assets"],
  "automation.repository.manage": ["hellotest.automation.object_repository"],
  "automation.repository.import": ["hellotest.automation.object_repository"],
  "automation.repository.export": ["hellotest.automation.object_repository"],
  "automation.build": ["hellotest.automation.builder"],
  "automation.ai": ["hellotest.ai.automation"],
  "content.ai": ["hellotest.ai.content_rephrase"],
  "automation.recorder": ["hellotest.automation.step_recording"],
  "automation.code.view": ["hellotest.automation.step_code"],
  "automation.run.local": ["hellotest.automation.local_execution"],
  "automation.run.remote": ["hellotest.automation.remote_execution"],
  "automation.run.parallel": ["hellotest.automation.parallel_execution"],
  "automation.analytics.view": ["hellotest.automation.analytics"],
  "automation.preview": ["hellotest.automation.preview"],
  "agentic_workflow.view": ["hellotest.ai.agentic_workflows"],
  "agentic_workflow.manage": ["hellotest.ai.agentic_workflows"],
  "agentic_workflow.run": ["hellotest.ai.agentic_workflows"],
  "run.create": ["hellotest.manual.runs"],
  "run.update": ["hellotest.manual.runs"],
  "run.execute": ["hellotest.manual.runs"],
  "run.delete": ["hellotest.manual.runs"],
  "run.ai": ["hellotest.ai.execution_analysis"],
  "run.report.export": ["hellotest.manual.runs"],
  "run.report.share": ["hellotest.manual.runs"],
  "result.view": ["hellotest.manual.runs"],
  "result.manage": ["hellotest.manual.runs"],
  "schedule.view": ["hellotest.automation.batch_process"],
  "schedule.create": ["hellotest.automation.batch_process"],
  "schedule.update": ["hellotest.automation.batch_process"],
  "schedule.run": ["hellotest.automation.batch_process"],
  "schedule.delete": ["hellotest.automation.batch_process"],
  "environment.view": ["hellotest.manual.environments"],
  "environment.manage": ["hellotest.manual.environments"],
  "configuration.view": ["hellotest.manual.environments"],
  "configuration.manage": ["hellotest.manual.environments"],
  "data.view": ["hellotest.manual.test_data"],
  "data.manage": ["hellotest.manual.test_data"],
  "data.import": ["hellotest.manual.test_data"],
  "data.export": ["hellotest.manual.test_data"],
  "data.ai": ["hellotest.ai.test_data_generation"],
  "mobile.view": ["hellotest.mobile.appium"],
  "mobile.manage": ["hellotest.mobile.appium"],
  "app_type.view": ["hellotest.mobile.appium"],
  "app_type.manage": ["hellotest.mobile.appium"],
  "integration.view": ["hellotest.api.integrations"],
  "integration.manage": ["hellotest.api.integrations"],
  "integration.import_export": ["hellotest.api.integrations"],
  "knowledge.view": ["hellotest.ai.knowledge"],
  "knowledge.manage": ["hellotest.ai.knowledge"],
  "prompt_template.view": ["hellotest.ai.test_authoring"],
  "prompt_template.manage": ["hellotest.ai.test_authoring"],
  "transaction.view": ["hellotest.ops.background_jobs"],
  "transaction.manage": ["hellotest.ops.background_jobs"],
  "transaction.artifact.download": ["hellotest.ops.background_jobs"],
  "notification.view": ["hellotest.ops.notifications"],
  "notification.manage": ["hellotest.ops.notifications"],
  "feedback.view": ["hellotest.manual.bugs"],
  "feedback.manage": ["hellotest.manual.bugs"],
  "ops.view": ["hellotest.ops.telemetry"],
  "ops.manage": ["hellotest.ops.telemetry"]
};

const FEATURE_PERMISSION_CODES = Object.entries(PERMISSION_FEATURES).reduce((features, [permissionCode, featureKeys]) => {
  for (const featureKey of featureKeys) {
    if (!features[featureKey]) {
      features[featureKey] = [];
    }

    features[featureKey].push(permissionCode);
  }

  return features;
}, {});

const FEATURE_GROUPS = [
  {
    key: "manual_testing",
    label: "Manual Testing",
    description: "Requirements, manual cases, suites, shared steps, manual execution, and evidence review.",
    features: [
      { key: "hellotest.manual.requirements", label: "Product Management", routes: ["/backlog", "/sprints", "/releases"] },
      { key: "hellotest.manual.test_cases", label: "Test cases", routes: ["/test-cases", "/shared-steps", "/design"] },
      { key: "hellotest.manual.suites", label: "Suites and shared steps", routes: ["/design", "/shared-steps"] },
      { key: "hellotest.manual.runs", label: "Manual runs and reports", routes: ["/executions"] },
      { key: "hellotest.manual.bugs", label: "Bugs", routes: ["/issues", "/feedback"] },
      { key: "hellotest.manual.plans", label: "Test plans", routes: ["/test-plans"] },
      { key: "hellotest.manual.quality_gates", label: "Quality gates", routes: ["/quality-gates"] },
      { key: "hellotest.manual.environments", label: "Environments and configurations", routes: ["/test-environments", "/test-configurations"] },
      { key: "hellotest.manual.test_data", label: "Test data", routes: ["/test-data"] }
    ]
  },
  {
    key: "analytics",
    label: "Analytics",
    description: "Project-scoped quality analytics and configurable dashboards.",
    features: [
      { key: "hellotest.analytics.dashboards", label: "Quality and custom dashboards", routes: ["/"] }
    ]
  },
  {
    key: "automation",
    label: "Automation",
    description: "Automation authoring, object repository, recorder capture, step code, local/remote execution, and batch process operations.",
    features: [
      { key: "hellotest.automation.workspace", label: "Automation workspace", routes: ["/automation"] },
      { key: "hellotest.automation.preview", label: "Run step automation preview", routes: ["/executions", "/test-cases"], permissions: ["automation.preview"], default_enabled: false },
      { key: "hellotest.automation.analytics", label: "Automation quality analytics", routes: ["/"], permissions: ["automation.analytics.view", "dashboard.view"], default_enabled: false },
      { key: "hellotest.automation.assets", label: "Automation assets", routes: ["/automation-assets"] },
      { key: "hellotest.automation.object_repository", label: "Object repository", routes: ["/object-repository"] },
      { key: "hellotest.automation.builder", label: "Automation builder", routes: ["/test-cases", "/automation"] },
      { key: "hellotest.automation.step_code", label: "Auto test and step-level code", routes: ["/test-cases", "/automation", "/executions"] },
      { key: "hellotest.automation.step_recording", label: "Step-level recording", routes: ["/test-cases", "/automation", "/object-repository"] },
      { key: "hellotest.automation.local_execution", label: "Local Playwright and local runs", routes: ["/test-cases", "/automation", "/executions"] },
      { key: "hellotest.automation.remote_execution", label: "Remote automation runs", routes: ["/test-cases", "/automation", "/executions"] },
      { key: "hellotest.automation.parallel_execution", label: "Parallel automation execution", routes: ["/design", "/test-cases", "/executions"] },
      { key: "hellotest.automation.batch_process", label: "Batch process", routes: ["/testops"] }
    ]
  },
  {
    key: "ai",
    label: "AI",
    description: "AI requirement design, test generation, automation repair, execution analysis, knowledge, and agents.",
    features: [
      { key: "hellotest.ai.requirement_design", label: "Requirement design", routes: ["/requirements", "/design"] },
      { key: "hellotest.ai.test_authoring", label: "Test-case AI mapping and step rephrase", routes: ["/test-cases"] },
      { key: "hellotest.ai.test_data_generation", label: "Synthetic test data generation", routes: ["/test-data"] },
      { key: "hellotest.ai.content_rephrase", label: "Rich-text AI rephrase", routes: ["/projects", "/requirements", "/test-cases", "/design", "/issues", "/automation", "/shared-steps", "/test-environments", "/test-data"] },
      { key: "hellotest.ai.bug_triage", label: "AI-assisted Bug drafting and triage", routes: ["/issues", "/feedback"], permissions: ["feedback.manage"] },
      { key: "hellotest.ai.quality_insights", label: "Quality insights", routes: ["/", "/quality-gates"], permissions: ["quality_insight.view", "quality_gate.ai", "dashboard.view"] },
      { key: "hellotest.ai.automation", label: "Automation AI", routes: ["/automation", "/object-repository"] },
      { key: "hellotest.ai.execution_analysis", label: "Execution analysis", routes: ["/executions"] },
      { key: "hellotest.ai.knowledge", label: "Knowledge repo", routes: ["/knowledge-repo"] },
      { key: "hellotest.ai.agentic_workflows", label: "Agentic workflows", routes: ["/agentic-workflows"] },
      { key: "hellotest.ai.prompt_mapping", label: "AI prompt key mapping", routes: ["/admin-space"] }
    ]
  },
  {
    key: "api",
    label: "API",
    description: "API testing, API request previews, integrations, scoped API keys, and external automation clients.",
    features: [
      { key: "hellotest.api.testing", label: "API test steps", routes: ["/test-cases", "/automation"] },
      { key: "hellotest.api.preview", label: "API previews", routes: ["/automation"] },
      { key: "hellotest.api.keys", label: "Scoped API keys", routes: ["/admin-space"] },
      { key: "hellotest.api.integrations", label: "API integrations", routes: ["/integrations", "/admin-space"] }
    ]
  },
  {
    key: "mobile",
    label: "Mobile",
    description: "Android, iOS, Appium, mobile recorder, and mobile execution capabilities.",
    features: [
      { key: "hellotest.mobile.android", label: "Android testing", routes: ["/automation", "/test-environments"] },
      { key: "hellotest.mobile.ios", label: "iOS testing", routes: ["/automation", "/test-environments"] },
      { key: "hellotest.mobile.recorder", label: "Mobile recorder", routes: ["/automation"] },
      { key: "hellotest.mobile.appium", label: "Appium execution", routes: ["/test-environments", "/executions"] }
    ]
  },
  {
    key: "operations",
    label: "Operations",
    description: "Background jobs, local agents, OPS telemetry, traces, notifications, and audit controls.",
    features: [
      { key: "hellotest.ops.background_jobs", label: "Background jobs", routes: ["/testops"] },
      { key: "hellotest.ops.telemetry", label: "OPS telemetry", routes: ["/ops-telemetry", "/traces"] },
      { key: "hellotest.ops.notifications", label: "Notifications", routes: ["/notifications"] },
      { key: "hellotest.ops.projects", label: "Projects and application types", routes: ["/projects"] },
      { key: "hellotest.ops.settings", label: "Workspace settings", routes: ["/settings"] },
      { key: "hellotest.ops.admin", label: "Administration", routes: ["/admin-space", "/people"] }
    ]
  }
];

const withPermissionCodes = (feature) => ({
  ...feature,
  permissions: [...new Set([...(feature.permissions || []), ...(FEATURE_PERMISSION_CODES[feature.key] || [])])].sort()
});

const FEATURE_GROUPS_WITH_PERMISSIONS = FEATURE_GROUPS.map((group) => ({
  ...group,
  features: group.features.map(withPermissionCodes)
}));

const FEATURE_DEFINITIONS = FEATURE_GROUPS_WITH_PERMISSIONS.flatMap((group) =>
  group.features.map((feature) => ({
    ...feature,
    group: group.key,
    group_label: group.label
  }))
);

const DEFAULT_FEATURE_FLAGS = Object.fromEntries(FEATURE_DEFINITIONS.map((feature) => [feature.key, feature.default_enabled !== false]));

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

exports.FEATURE_GROUPS = FEATURE_GROUPS_WITH_PERMISSIONS;
exports.FEATURE_DEFINITIONS = FEATURE_DEFINITIONS;

exports.getSnapshot = async ({ user } = {}) => ({
  groups: FEATURE_GROUPS_WITH_PERMISSIONS,
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

exports.getDisabledPermissionCodes = async (permissionCodes = []) => {
  const codes = Array.isArray(permissionCodes) ? [...new Set(permissionCodes.filter(Boolean))] : [];

  if (!codes.length) {
    return [];
  }

  const flags = await evaluateFlags();

  return codes.filter((permissionCode) => {
    const featureKeys = exports.getFeatureKeysForPermission(permissionCode);
    return featureKeys.some((featureKey) => flags[featureKey] === false);
  });
};

exports.filterPermissionsByEnabledFeatures = async (permissions = []) => {
  const disabledCodes = new Set(await exports.getDisabledPermissionCodes(permissions.map((permission) => permission.code)));
  return permissions.filter((permission) => !disabledCodes.has(permission.code));
};

exports.filterPermissionGroupsByEnabledFeatures = async (permissionGroups = []) => {
  const filteredGroups = await Promise.all(
    permissionGroups.map(async (group) => ({
      ...group,
      permissions: (await exports.filterPermissionsByEnabledFeatures(
        group.permissions.map((permission) => Array.isArray(permission)
          ? { code: permission[0], description: permission[1], tuple: permission }
          : permission
        )
      )).map((permission) => permission.tuple || permission)
    }))
  );

  return filteredGroups.filter((group) => group.permissions.length);
};
