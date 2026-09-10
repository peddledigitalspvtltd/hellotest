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
  "settings.view": ["hellotest.ops.settings"],
  "settings.manage": ["hellotest.ops.settings", "hellotest.ops.admin"],
  "workspace_preferences.manage": ["hellotest.ops.settings", "hellotest.ops.admin"],
  "api_key.manage": ["hellotest.api.keys"],
  "localization.manage": ["hellotest.ops.settings", "hellotest.ops.admin"],
  "ai_prompt.manage": ["hellotest.ai.prompt_mapping"],
  "feature_flag.manage": ["hellotest.ops.admin"],
  "user.view": ["hellotest.ops.admin"],
  "user.manage": ["hellotest.ops.admin"],
  "user.import": ["hellotest.ops.admin"],
  "role.view": ["hellotest.ops.admin"],
  "role.manage": ["hellotest.ops.admin"],
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
  "run.view": ["hellotest.manual.runs"],
  "run.create": ["hellotest.manual.runs"],
  "run.update": ["hellotest.manual.runs"],
  "run.execute": ["hellotest.manual.runs"],
  "run.delete": ["hellotest.manual.runs"],
  "run.ai": ["hellotest.ai.execution_analysis"],
  "run.report.export": ["hellotest.manual.runs"],
  "run.report.share": ["hellotest.manual.runs"],
  "result.view": ["hellotest.manual.runs"],
  "result.manage": ["hellotest.manual.runs"],
  "schedule.view": ["hellotest.manual.runs"],
  "schedule.create": ["hellotest.manual.runs"],
  "schedule.update": ["hellotest.manual.runs"],
  "schedule.run": ["hellotest.manual.runs"],
  "schedule.delete": ["hellotest.manual.runs"],
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
  // Application scopes are core project metadata used by Stories, Test Cases,
  // Runs, and other non-mobile surfaces. Only their administration belongs to
  // the Projects feature; mobile.* remains independently Appium-gated.
  "app_type.manage": ["hellotest.ops.projects"],
  "integration.view": ["hellotest.api.integrations"],
  "integration.manage": ["hellotest.api.integrations"],
  "integration.import_export": ["hellotest.api.integrations"],
  "knowledge.view": ["hellotest.ai.knowledge"],
  "knowledge.manage": ["hellotest.ai.knowledge"],
  "prompt_template.view": ["hellotest.ai.test_authoring"],
  "prompt_template.manage": ["hellotest.ai.test_authoring"],
  "transaction.view": ["hellotest.ops.background_jobs", "hellotest.automation.batch_process"],
  "transaction.manage": ["hellotest.ops.background_jobs", "hellotest.automation.batch_process"],
  "transaction.artifact.download": ["hellotest.ops.background_jobs", "hellotest.automation.batch_process"],
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
    description: "Stories, delivery planning, manual cases, suites, Shared Step Groups, execution, and evidence review.",
    features: [
      {
        key: "hellotest.manual.requirements",
        label: "Product Management — Stories, Sprints, and Releases",
        description: "Manage Stories, backlog, Sprints, and Releases. This also supplies the editable Release and Sprint choices used by creation dialogs.",
        routes: ["/requirements", "/stories", "/backlog", "/sprints", "/releases"]
      },
      {
        key: "hellotest.manual.test_cases",
        label: "Test cases",
        description: "Author test cases with selectable ownership. Delivery planning adds requirement-linked modules and Story/Release/Sprint context; Test data and datasets add dataset links.",
        routes: ["/test-cases", "/shared-steps", "/design"]
      },
      {
        key: "hellotest.manual.suites",
        label: "Suites and Shared Step Groups",
        description: "Organize cases into suites and maintain reusable Shared Step Groups for consistent manual authoring.",
        routes: ["/design", "/shared-steps"]
      },
      {
        key: "hellotest.manual.runs",
        label: "Runs, schedules, and reports",
        description: "Create manual and scheduled runs and review reports. Delivery planning adds editable Release/Sprint context; Test data and datasets expand linked rows into case instances.",
        routes: ["/executions"]
      },
      {
        key: "hellotest.manual.bugs",
        label: "Bugs",
        description: "Create and triage Bugs, with populated and editable Release/Sprint context when delivery planning is available.",
        routes: ["/issues", "/feedback"]
      },
      { key: "hellotest.manual.plans", label: "Test plans", routes: ["/test-plans"] },
      { key: "hellotest.manual.quality_gates", label: "Quality gates", routes: ["/quality-gates"] },
      { key: "hellotest.manual.environments", label: "Environments and configurations", routes: ["/test-environments", "/test-configurations"] },
      {
        key: "hellotest.manual.test_data",
        label: "Test data and datasets",
        description: "Create reusable datasets, manage static or generated values, and link one dataset with one or many rows to a test case.",
        routes: ["/test-data", "/test-cases"]
      }
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
      {
        key: "hellotest.automation.preview",
        label: "API request validation previews",
        description: "Validate API request contracts and inspect approved response evidence from Test Case, Shared Step Group, and Automation editors.",
        routes: ["/test-cases", "/shared-steps", "/automation"],
        permissions: ["automation.preview"],
        default_enabled: false
      },
      { key: "hellotest.automation.analytics", label: "Automation quality analytics", routes: ["/"], permissions: ["automation.analytics.view", "dashboard.view"], default_enabled: false },
      { key: "hellotest.automation.assets", label: "Automation assets", routes: ["/automation-assets"] },
      { key: "hellotest.automation.object_repository", label: "Object repository", routes: ["/object-repository"] },
      { key: "hellotest.automation.builder", label: "Automation builder", routes: ["/test-cases", "/automation"] },
      { key: "hellotest.automation.step_code", label: "Auto test and step-level code", routes: ["/test-cases", "/automation", "/executions"] },
      { key: "hellotest.automation.step_recording", label: "Step-level recording", routes: ["/test-cases", "/automation", "/object-repository"] },
      { key: "hellotest.automation.local_execution", label: "Local Playwright and local runs", routes: ["/test-cases", "/automation", "/executions"] },
      { key: "hellotest.automation.remote_execution", label: "Remote automation runs", routes: ["/test-cases", "/automation", "/executions"] },
      { key: "hellotest.automation.parallel_execution", label: "Parallel automation execution", routes: ["/design", "/test-cases", "/executions"] },
      {
        key: "hellotest.automation.batch_process",
        label: "Batch processing jobs",
        description: "Operate background batch jobs in TestOps. Scheduled test runs are governed by Runs, schedules, and reports.",
        routes: ["/testops"]
      }
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
      {
        key: "hellotest.ai.knowledge",
        label: "Knowledge Repo and grounded assistant",
        description: "Build project-scoped context from HelloTest records, text, chat, and governed files; search it with citations and use the guarded floating Knowledge Assistant.",
        routes: ["/knowledge-repo"]
      },
      { key: "hellotest.ai.agentic_workflows", label: "Agentic workflows", routes: ["/agentic-workflows"] },
      { key: "hellotest.ai.prompt_mapping", label: "AI prompt key mapping", routes: ["/admin-space"] }
    ]
  },
  {
    key: "api",
    label: "API",
    description: "API integrations, scoped API keys, and external automation clients.",
    features: [
      { key: "hellotest.api.keys", label: "Scoped API keys", routes: ["/admin-space"] },
      { key: "hellotest.api.integrations", label: "API integrations", routes: ["/integrations", "/admin-space"] }
    ]
  },
  {
    key: "mobile",
    label: "Mobile",
    description: "Supported Android authoring, configuration, recording, and execution through Appium.",
    features: [
      {
        key: "hellotest.mobile.appium",
        label: "Android and Appium",
        description: "Enable supported Android Appium authoring, recorder, configuration, and execution controls.",
        routes: ["/automation", "/test-cases", "/test-environments", "/executions", "/integrations"]
      }
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
      {
        key: "hellotest.ops.settings",
        label: "Workspace settings",
        description: "Provide personal workspace preferences and the Settings surface. Workspace-wide policy changes also require the Administration feature.",
        routes: ["/settings"]
      },
      {
        key: "hellotest.ops.admin",
        label: "Administration",
        description: "Govern people, permissions, integrations, feature availability, localization, and workspace-wide policy.",
        routes: ["/admin-space", "/people"]
      }
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

// A child capability cannot be called directly after its workspace is disabled.
// Preview and step-code are intentionally independent: manual editors use them
// without requiring the Automation workspace.
const FEATURE_DEPENDENCIES = {
  "hellotest.automation.assets": ["hellotest.automation.workspace"],
  "hellotest.automation.object_repository": ["hellotest.automation.workspace"],
  "hellotest.automation.builder": ["hellotest.automation.workspace"],
  "hellotest.automation.local_execution": ["hellotest.automation.workspace"],
  "hellotest.automation.remote_execution": ["hellotest.automation.workspace"],
  "hellotest.automation.parallel_execution": ["hellotest.automation.workspace"]
};

const ROUTE_FEATURES = new Map([
  ["GET /test-cases/automation/learning-cache", ["hellotest.automation.object_repository"]],
  ["GET /test-cases/automation/repository-context", ["hellotest.automation.object_repository"]],
  ["GET /test-cases/automation/learning-cache/:id/usage", ["hellotest.automation.object_repository"]],
  ["GET /test-cases/automation/learning-cache/screens/:screenName/usage", ["hellotest.automation.object_repository"]],
  ["POST /test-cases/automation/learning-cache/:id/ai-improve", ["hellotest.automation.object_repository"]]
]);

const normalizeObject = (value) => value && typeof value === "object" && !Array.isArray(value) ? value : {};

const normalizeBooleanFlagMap = (input) => {
  const rawFlags = normalizeObject(input.flags || input);
  return Object.fromEntries(
    FEATURE_DEFINITIONS.map((feature) => [
      feature.key,
      Object.hasOwn(rawFlags, feature.key) ? rawFlags[feature.key] === true : DEFAULT_FEATURE_FLAGS[feature.key]
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
  if (!flags || typeof flags !== "object" || Array.isArray(flags)) {
    throw Object.assign(new Error("Feature changes must be an object of known boolean flags."), { statusCode: 400, code: "INVALID_FEATURE_FLAGS" });
  }
  for (const [key, value] of Object.entries(flags)) {
    if (!Object.hasOwn(DEFAULT_FEATURE_FLAGS, key) || typeof value !== "boolean") {
      throw Object.assign(new Error(`Invalid feature flag: ${key}. Use a known flag with a boolean value.`), { statusCode: 400, code: "INVALID_FEATURE_FLAGS" });
    }
  }
  if (!Object.keys(flags).length) return getStoredFlags();

  // Merge in PostgreSQL rather than read/replace in JavaScript. Independent
  // administrator edits remain intact even when they arrive concurrently.
  const row = await db.prepare(`
    INSERT INTO app_settings (key, value, updated_at)
    VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT (key)
    DO UPDATE SET value = jsonb_set(
      CASE WHEN jsonb_typeof(app_settings.value) = 'object' THEN app_settings.value ELSE '{}'::jsonb END,
      '{flags}',
      (CASE
        WHEN jsonb_typeof(app_settings.value->'flags') = 'object' THEN app_settings.value->'flags'
        WHEN jsonb_typeof(app_settings.value) = 'object' THEN app_settings.value
        ELSE '{}'::jsonb
      END) || ?::jsonb,
      true
    ), updated_at = CURRENT_TIMESTAMP
    RETURNING value
  `).get(FEATURE_FLAGS_SETTINGS_KEY, { flags: normalizeBooleanFlagMap({ flags }) }, flags);

  return normalizeBooleanFlagMap(normalizeObject(row?.value));
};

const evaluateLocalFlags = (localFlags) => Object.fromEntries(
  FEATURE_DEFINITIONS.map((feature) => [feature.key,
    localFlags[feature.key] === true
    && (FEATURE_DEPENDENCIES[feature.key] || []).every((key) => localFlags[key] === true)
  ])
);
const evaluateFlags = async () => evaluateLocalFlags(await getStoredFlags());

exports.FEATURE_GROUPS = FEATURE_GROUPS_WITH_PERMISSIONS;
exports.FEATURE_DEFINITIONS = FEATURE_DEFINITIONS;
exports.FEATURE_DEPENDENCIES = FEATURE_DEPENDENCIES;
exports.getFeatureKeysForRoute = (method, routeUrl) => ROUTE_FEATURES.get(`${String(method).toUpperCase() === "HEAD" ? "GET" : String(method).toUpperCase()} ${routeUrl}`) || [];

exports.getSnapshot = async () => {
  const localFlags = await getStoredFlags();
  return {
    groups: FEATURE_GROUPS_WITH_PERMISSIONS,
    flags: evaluateLocalFlags(localFlags),
    local_flags: localFlags,
    dependencies: FEATURE_DEPENDENCIES,
    provider: { type: "local", configured: true, connected: true }
  };
};

exports.updateLocalFlags = async (flags) => ({
  updated: true,
  flags: await saveStoredFlags(flags)
});

exports.isEnabled = async (featureKey, { user } = {}) => {
  if (typeof featureKey !== "string" || !Object.hasOwn(DEFAULT_FEATURE_FLAGS, featureKey)) return false;
  const flags = await evaluateFlags({ user });
  return Object.hasOwn(flags, featureKey) && flags[featureKey] === true;
};

exports.areEnabled = async (featureKeys = [], { user } = {}) => {
  if (!Array.isArray(featureKeys)) return false;
  const keys = featureKeys;
  if (keys.some((key) => typeof key !== "string" || !Object.hasOwn(DEFAULT_FEATURE_FLAGS, key))) return false;

  if (!keys.length) {
    return true;
  }

  const flags = await evaluateFlags({ user });
  return keys.every((featureKey) => typeof featureKey === "string" && Object.hasOwn(flags, featureKey) && flags[featureKey] === true);
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
    return featureKeys.some((featureKey) => flags[featureKey] !== true);
  });
};

exports.filterPermissionsByEnabledFeatures = async (permissions = []) => {
  const disabledCodes = new Set(await exports.getDisabledPermissionCodes(permissions.map((permission) => permission.code)));
  return permissions.filter((permission) => !disabledCodes.has(permission.code));
};

exports.filterPermissionGroupsByEnabledFeatures = async (permissionGroups = []) => {
  const codes = permissionGroups.flatMap((group) => group.permissions.map((permission) => Array.isArray(permission) ? permission[0] : permission.code));
  const disabledCodes = new Set(await exports.getDisabledPermissionCodes(codes));
  const filteredGroups = permissionGroups.map((group) => ({
    ...group,
    permissions: group.permissions.filter((permission) => !disabledCodes.has(Array.isArray(permission) ? permission[0] : permission.code))
  }));

  return filteredGroups.filter((group) => group.permissions.length);
};
