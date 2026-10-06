export const WORKSPACE_ROUTES = {
  home: "/",
  projects: "/projects",
  requirements: "/requirements",
  stories: "/stories",
  backlog: "/backlog",
  sprints: "/sprints",
  releases: "/releases",
  testCases: "/test-cases",
  sharedSteps: "/shared-steps",
  design: "/design",
  executions: "/executions",
  automation: "/automation",
  objectRepository: "/object-repository",
  mcpServers: "/mcp-servers",
  agenticWorkflows: "/agentic-workflows",
  localPlaywright: "/local-playwright",
  testOps: "/testops",
  opsTelemetry: "/ops-telemetry",
  traces: "/traces",
  testEnvironments: "/test-environments",
  testData: "/test-data",
  testConfigurations: "/test-configurations",
  knowledgeRepo: "/knowledge-repo",
  issues: "/issues",
  feedback: "/feedback",
  adminSpace: "/admin-space",
  people: "/people",
  integrations: "/integrations",
  notifications: "/notifications",
  settings: "/settings",
  support: "/support"
} as const;

export type WorkspaceRoute = typeof WORKSPACE_ROUTES[keyof typeof WORKSPACE_ROUTES];

export const WORKSPACE_ROUTE_PATHS = new Set<WorkspaceRoute>(Object.values(WORKSPACE_ROUTES));

export const workspaceChildPath = (route: WorkspaceRoute) => route === "/" ? "" : route.slice(1);

export const routePath = (target: string) => target.split(/[?#]/, 1)[0] || "/";
