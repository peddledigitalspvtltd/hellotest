import { WORKSPACE_ROUTES, routePath } from "./workspaceRoutes";

type RoutePreloader = () => Promise<unknown>;

const routePreloaders: Record<string, RoutePreloader> = {
  [WORKSPACE_ROUTES.home]: () => import("../pages/OverviewPage"),
  [WORKSPACE_ROUTES.adminSpace]: () => import("../pages/AdminSpacePage"),
  [WORKSPACE_ROUTES.agenticWorkflows]: () => import("../pages/AgenticWorkflowsPage"),
  [WORKSPACE_ROUTES.automation]: () => import("../pages/AutomationPage"),
  [WORKSPACE_ROUTES.objectRepository]: () => import("../pages/AutomationPage"),
  [WORKSPACE_ROUTES.design]: () => import("../pages/DesignPage"),
  [WORKSPACE_ROUTES.executions]: () => import("../pages/ExecutionsPage"),
  [WORKSPACE_ROUTES.integrations]: () => import("../pages/IntegrationsPage"),
  [WORKSPACE_ROUTES.issues]: () => import("../pages/IssuesPage"),
  [WORKSPACE_ROUTES.feedback]: () => import("../pages/IssuesPage"),
  [WORKSPACE_ROUTES.knowledgeRepo]: () => import("../pages/KnowledgeRepoPage"),
  [WORKSPACE_ROUTES.notifications]: () => import("../pages/NotificationsPage"),
  [WORKSPACE_ROUTES.people]: () => import("../pages/PeoplePage"),
  [WORKSPACE_ROUTES.projects]: () => import("../pages/ProjectsPage"),
  [WORKSPACE_ROUTES.requirements]: () => import("../pages/RequirementsPage"),
  [WORKSPACE_ROUTES.settings]: () => import("../pages/SettingsPage"),
  [WORKSPACE_ROUTES.sharedSteps]: () => import("../pages/SharedStepsPage"),
  [WORKSPACE_ROUTES.support]: () => import("../pages/SupportPage"),
  [WORKSPACE_ROUTES.testCases]: () => import("../pages/TestCasesPage"),
  [WORKSPACE_ROUTES.testEnvironments]: () => import("../pages/TestEnvironmentPage"),
  [WORKSPACE_ROUTES.testData]: () => import("../pages/TestEnvironmentPage"),
  [WORKSPACE_ROUTES.testConfigurations]: () => import("../pages/TestEnvironmentPage"),
  [WORKSPACE_ROUTES.testOps]: () => import("../pages/TestOpsPage"),
  [WORKSPACE_ROUTES.opsTelemetry]: () => import("../pages/TestOpsPage"),
  [WORKSPACE_ROUTES.traces]: () => import("../pages/TestOpsPage")
};

const preloadedRoutes = new Set<string>();

const normalizeRoutePath = (to: string) => {
  const path = routePath(to).trim();
  return path.startsWith("/") ? path : `/${path}`;
};

const scheduleIdle = (work: () => void) => {
  const runtime = globalThis as typeof globalThis & {
    requestIdleCallback?: (callback: () => void, options?: { timeout?: number }) => number;
  };

  if (typeof runtime.requestIdleCallback === "function") {
    runtime.requestIdleCallback(work, { timeout: 1_200 });
    return;
  }

  globalThis.setTimeout(work, 80);
};

export const preloadWorkspaceRoute = (to: string) => {
  if (!to) {
    return;
  }

  const path = normalizeRoutePath(to);
  const preloader = routePreloaders[path];

  if (!preloader || preloadedRoutes.has(path)) {
    return;
  }

  preloadedRoutes.add(path);
  scheduleIdle(() => {
    void preloader().catch(() => {
      preloadedRoutes.delete(path);
    });
  });
};
