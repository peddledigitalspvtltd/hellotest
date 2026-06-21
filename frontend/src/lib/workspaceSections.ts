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
  { to: "/test-cases", label: "Cases", shortLabel: "Cases", icon: "cases" },
  { to: "/shared-steps", label: "Shared Steps", shortLabel: "Shared", icon: "shared" },
  { to: "/design", label: "Suites", shortLabel: "Suites", icon: "suites" }
];

export const TEST_ENVIRONMENT_SECTION_ITEMS: WorkspaceSectionItem[] = [
  { to: "/test-environments", label: "Environments", shortLabel: "Env", icon: "environments" },
  { to: "/test-data", label: "Test Data", shortLabel: "Data", icon: "data" },
  { to: "/test-configurations", label: "Configurations", shortLabel: "Config", icon: "configurations" }
];

export const AUTOMATION_SECTION_ITEMS: WorkspaceSectionItem[] = [
  { to: "/automation", label: "Automation", shortLabel: "Auto", icon: "automation" },
  { to: "/object-repository", label: "Objects", shortLabel: "Objects", icon: "repository" },
  { to: "/local-playwright", label: "Recorder", shortLabel: "Record", icon: "playwright" }
];

export const TESTOPS_SECTION_ITEMS: WorkspaceSectionItem[] = [
  { to: "/testops", label: "Jobs", shortLabel: "Jobs", icon: "ops" },
  { to: "/ops-telemetry", label: "Telemetry", shortLabel: "Telemetry", icon: "telemetry" },
  { to: "/traces", label: "Traces", shortLabel: "Traces", icon: "traces" }
];

export const WORKSPACE_PAGE_LABELS: Record<string, string> = {
  "/": "Home",
  "/projects": "Projects",
  "/requirements": "Requirements",
  "/test-cases": "Cases",
  "/shared-steps": "Shared Step Groups",
  "/design": "Suites",
  "/executions": "Runs",
  "/automation": "Automation",
  "/object-repository": "Objects",
  "/local-playwright": "Recorder",
  "/testops": "Jobs",
  "/ops-telemetry": "Telemetry",
  "/traces": "Traces",
  "/test-environments": "Environments",
  "/test-data": "Test Data",
  "/test-configurations": "Configurations",
  "/people": "People",
  "/integrations": "Integrations",
  "/support": "Support",
  "/notifications": "Notifications",
  "/settings": "Settings",
  "/issues": "Report Issue",
  "/feedback": "Report Issue"
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
