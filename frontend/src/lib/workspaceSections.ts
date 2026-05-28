export type WorkspaceSectionItem = {
  to: string;
  label: string;
  shortLabel?: string;
  icon?:
    | "requirements"
    | "cases"
    | "shared"
    | "suites"
    | "executions"
    | "automation"
    | "repository"
    | "playwright"
    | "ops"
    | "telemetry"
    | "traces"
    | "environments"
    | "data"
    | "configurations";
};

export const TEST_AUTHORING_SECTION_ITEMS: WorkspaceSectionItem[] = [
  { to: "/requirements", label: "Requirements", shortLabel: "Reqs", icon: "requirements" },
  { to: "/test-cases", label: "Test Cases", shortLabel: "Cases", icon: "cases" },
  { to: "/shared-steps", label: "Shared Steps", shortLabel: "Shared", icon: "shared" },
  { to: "/design", label: "Test Suites", shortLabel: "Suites", icon: "suites" }
];

export const TEST_ENVIRONMENT_SECTION_ITEMS: WorkspaceSectionItem[] = [
  { to: "/test-environments", label: "Environments", shortLabel: "Env", icon: "environments" },
  { to: "/test-data", label: "Test Data", shortLabel: "Data", icon: "data" },
  { to: "/test-configurations", label: "Configurations", shortLabel: "Config", icon: "configurations" }
];

export const AUTOMATION_SECTION_ITEMS: WorkspaceSectionItem[] = [
  { to: "/automation", label: "Automation Cases", shortLabel: "Cases", icon: "automation" },
  { to: "/object-repository", label: "Object Repository", shortLabel: "OR", icon: "repository" },
  { to: "/local-playwright", label: "Local Playwright", shortLabel: "Local", icon: "playwright" }
];

export const TESTOPS_SECTION_ITEMS: WorkspaceSectionItem[] = [
  { to: "/testops", label: "Batch Process", shortLabel: "Batch", icon: "ops" },
  { to: "/ops-telemetry", label: "OPS Telemetry", shortLabel: "Telemetry", icon: "telemetry" },
  { to: "/traces", label: "Distributed Traces", shortLabel: "Traces", icon: "traces" }
];

export const WORKSPACE_PAGE_LABELS: Record<string, string> = {
  "/": "Dashboard",
  "/projects": "Projects",
  "/requirements": "Requirements",
  "/test-cases": "Test Cases",
  "/shared-steps": "Shared Step Groups",
  "/design": "Test Suites",
  "/executions": "Test Runs",
  "/automation": "Automation Cases",
  "/object-repository": "Object Repository",
  "/local-playwright": "Local Playwright",
  "/testops": "Batch Process",
  "/ops-telemetry": "OPS Telemetry",
  "/traces": "Distributed Traces",
  "/test-environments": "Environments",
  "/test-data": "Test Data",
  "/test-configurations": "Configurations",
  "/people": "Users",
  "/integrations": "Integrations",
  "/support": "Support",
  "/notifications": "Notifications",
  "/settings": "Settings",
  "/feedback": "Reporting & Feedback"
};

export const WORKSPACE_SECTION_LABEL_KEYS: Record<string, string> = {
  "/requirements": "workspace.requirements",
  "/test-cases": "workspace.testCases",
  "/shared-steps": "workspace.sharedSteps",
  "/design": "workspace.testSuites",
  "/executions": "workspace.executions",
  "/automation": "workspace.automationCases",
  "/object-repository": "workspace.objectRepository",
  "/local-playwright": "workspace.localPlaywright",
  "/testops": "workspace.batchProcess",
  "/ops-telemetry": "workspace.opsTelemetry",
  "/traces": "workspace.traces",
  "/test-environments": "workspace.environments",
  "/test-data": "workspace.testData",
  "/test-configurations": "workspace.configurations"
};

export const WORKSPACE_LIBRARY_PATHS = new Set([
  ...TEST_AUTHORING_SECTION_ITEMS.map((item) => item.to),
  "/executions",
  ...AUTOMATION_SECTION_ITEMS.map((item) => item.to),
  ...TESTOPS_SECTION_ITEMS.map((item) => item.to),
  ...TEST_ENVIRONMENT_SECTION_ITEMS.map((item) => item.to)
]);
