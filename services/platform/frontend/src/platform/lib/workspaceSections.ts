import { WORKSPACE_ROUTES } from "./workspaceRoutes";

export type WorkspaceSectionItem = {
  to: string;
  label: string;
  shortLabel?: string;
  featureKeys?: string[];
  icon?:
    | "analytics"
    | "backlog"
    | "stories"
    | "dashboard"
    | "requirements"
    | "release"
    | "sprint"
    | "cases"
    | "shared"
    | "suites"
    | "executions"
    | "automation"
    | "agents"
    | "repository"
    | "playwright"
    | "ops"
    | "telemetry"
    | "traces"
    | "environments"
    | "data"
    | "configurations";
};

export const DASHBOARD_SECTION_ITEMS: WorkspaceSectionItem[] = [
  { to: "/?view=analytics", label: "Quality Analytics", shortLabel: "Analytics", icon: "analytics" },
  { to: "/?view=readiness", label: "Release Readiness", shortLabel: "Readiness", icon: "analytics" },
  { to: "/?view=custom", label: "Custom Dashboards", shortLabel: "Custom", icon: "dashboard" }
];

export const PRODUCT_MANAGEMENT_SECTION_ITEMS: WorkspaceSectionItem[] = [
  { to: WORKSPACE_ROUTES.stories, label: "Stories", shortLabel: "Stories", icon: "stories", featureKeys: ["hellotest.manual.requirements"] },
  { to: WORKSPACE_ROUTES.backlog, label: "Backlog", shortLabel: "Backlog", icon: "backlog", featureKeys: ["hellotest.manual.requirements"] },
  { to: WORKSPACE_ROUTES.sprints, label: "Sprints", shortLabel: "Sprints", icon: "sprint", featureKeys: ["hellotest.manual.requirements"] },
  { to: WORKSPACE_ROUTES.releases, label: "Releases", shortLabel: "Releases", icon: "release", featureKeys: ["hellotest.manual.requirements"] }
];

export const TEST_AUTHORING_SECTION_ITEMS: WorkspaceSectionItem[] = [
  { to: WORKSPACE_ROUTES.testCases, label: "Cases", shortLabel: "Cases", icon: "cases", featureKeys: ["hellotest.manual.test_cases"] },
  { to: WORKSPACE_ROUTES.sharedSteps, label: "Shared Step Groups", shortLabel: "Groups", icon: "shared", featureKeys: ["hellotest.manual.suites"] },
];

export const TEST_ENVIRONMENT_SECTION_ITEMS: WorkspaceSectionItem[] = [
  { to: WORKSPACE_ROUTES.testEnvironments, label: "Environments", shortLabel: "Env", icon: "environments", featureKeys: ["hellotest.manual.environments"] },
  { to: WORKSPACE_ROUTES.testData, label: "Test Data", shortLabel: "Data", icon: "data", featureKeys: ["hellotest.manual.test_data"] },
  { to: WORKSPACE_ROUTES.testConfigurations, label: "Configurations", shortLabel: "Config", icon: "configurations", featureKeys: ["hellotest.manual.environments"] }
];

export const AUTOMATION_SECTION_ITEMS: WorkspaceSectionItem[] = [
  { to: WORKSPACE_ROUTES.automation, label: "Test Automation", shortLabel: "Test Automation", icon: "automation", featureKeys: ["hellotest.automation.workspace"] },
  { to: `${WORKSPACE_ROUTES.sharedSteps}?view=automation`, label: "Shared Section Groups", shortLabel: "Shared Sections", icon: "shared", featureKeys: ["hellotest.automation.workspace", "hellotest.manual.suites"] },
  { to: WORKSPACE_ROUTES.objectRepository, label: "Objects", shortLabel: "Objects", icon: "repository", featureKeys: ["hellotest.automation.workspace", "hellotest.automation.object_repository"] }
];

export const TESTOPS_SECTION_ITEMS: WorkspaceSectionItem[] = [
  { to: WORKSPACE_ROUTES.opsTelemetry, label: "OPS Telemetry", shortLabel: "Telemetry", icon: "telemetry", featureKeys: ["hellotest.ops.telemetry"] },
  { to: WORKSPACE_ROUTES.testOps, label: "Jobs", shortLabel: "Jobs", icon: "ops", featureKeys: ["hellotest.automation.batch_process"] }
];

export const AGENTIC_WORKFLOW_SECTION_ITEMS: WorkspaceSectionItem[] = [
  { to: WORKSPACE_ROUTES.mcpServers, label: "MCP Servers", shortLabel: "MCP", icon: "agents", featureKeys: ["hellotest.ai.agentic_workflows"] },
  { to: `${WORKSPACE_ROUTES.agenticWorkflows}?view=agents`, label: "AI Agents", shortLabel: "Agents", icon: "agents", featureKeys: ["hellotest.ai.agentic_workflows"] },
  { to: `${WORKSPACE_ROUTES.agenticWorkflows}?view=workflows`, label: "Workflows", shortLabel: "Flows", icon: "traces", featureKeys: ["hellotest.ai.agentic_workflows"] },
];

export const TEST_RUNS_SECTION_ITEMS: WorkspaceSectionItem[] = [];
export const TEST_PLAN_SECTION_ITEMS: WorkspaceSectionItem[] = [
  { to: WORKSPACE_ROUTES.design, label: "Test Suites", icon: "suites", featureKeys: ["hellotest.manual.suites"] },
  { to: `${WORKSPACE_ROUTES.executions}?view=scheduled-runs`, label: "Test Plans", icon: "executions", featureKeys: ["hellotest.manual.runs"] }
];

export const WORKSPACE_PAGE_LABELS: Record<string, string> = {
  "/": "Home",
  "/projects": "Project Overview",
  "/stories": "Stories",
  "/agentic-workflows": "AI Agent Studio",
  "/mcp-servers": "MCP Servers",
  "/knowledge-repo": "AI Knowledge Base",
  "/requirements": "Backlog",
  "/backlog": "Backlog",
  "/sprints": "Sprints",
  "/releases": "Releases",
  "/test-cases": "Cases",
  "/shared-steps": "Shared Step Groups",
  "/design": "Suites",
  "/executions": "Runs",
  "/automation": "Test Automation",
  "/object-repository": "Objects",
  "/testops": "Jobs",
  "/ops-telemetry": "Telemetry",
  "/traces": "Traces",
  "/test-environments": "Environments",
  "/test-data": "Test Data",
  "/test-configurations": "Configurations",
  "/admin-space": "Admin Space",
  "/people": "People",
  "/integrations": "Integrations",
  "/support": "Support",
  "/notifications": "Notifications",
  "/settings": "Settings",
  "/issues": "Defects",
  "/feedback": "Defects"
};

export const WORKSPACE_SECTION_LABEL_KEYS: Record<string, string> = {
  "/": "page.overview",
  "/projects": "page.projects",
  "/admin-space": "page.adminSpace",
  "/people": "page.people",
  "/integrations": "page.integrations",
  "/knowledge-repo": "page.knowledgeRepo",
  "/agentic-workflows": "page.agenticWorkflows",
  "/support": "page.support",
  "/notifications": "page.notifications",
  "/settings": "page.settings",
  "/issues": "page.issues",
  "/feedback": "page.feedback",
  "/agentic-workflows?view=agents": "workspace.aiAgents",
  "/agentic-workflows?view=workflows": "workspace.workflows",
  "/agentic-workflows?view=runs": "workspace.workflowRuns",
  "/executions?view=suite-runs": "workspace.suiteRuns",
  "/executions?view=local-runs": "workspace.localRuns",
  "/executions?view=scheduled-runs": "workspace.scheduledRuns",
  "/?view=analytics": "workspace.qualityAnalytics",
  "/?view=readiness": "workspace.releaseReadiness",
  "/?view=custom": "workspace.customDashboards",
  "/requirements": "workspace.requirements",
  "/stories": "workspace.stories",
  "/backlog": "workspace.backlog",
  "/sprints": "workspace.sprints",
  "/releases": "workspace.releases",
  "/test-cases": "workspace.testCases",
  "/shared-steps": "workspace.sharedSteps",
  "/shared-steps?view=automation": "workspace.sharedSections",
  "/design": "workspace.testSuites",
  "/executions": "workspace.executions",
  "/automation": "workspace.automationCases",
  "/object-repository": "workspace.objectRepository",
  "/testops": "workspace.batchProcess",
  "/ops-telemetry": "workspace.opsTelemetry",
  "/traces": "workspace.traces",
  "/test-environments": "workspace.environments",
  "/test-data": "workspace.testData",
  "/test-configurations": "workspace.configurations"
};

export const WORKSPACE_LIBRARY_PATHS = new Set([
  ...PRODUCT_MANAGEMENT_SECTION_ITEMS.map((item) => item.to),
  ...TEST_AUTHORING_SECTION_ITEMS.map((item) => item.to),
  "/executions",
  ...AUTOMATION_SECTION_ITEMS.map((item) => item.to),
  ...TESTOPS_SECTION_ITEMS.map((item) => item.to),
  ...TEST_ENVIRONMENT_SECTION_ITEMS.map((item) => item.to)
]);
