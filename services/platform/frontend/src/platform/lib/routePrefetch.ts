import { loadCapabilityView } from "../capabilities/loadCapability";
import { WORKSPACE_ROUTES, routePath } from "./workspaceRoutes";

type RoutePreloader = () => Promise<unknown>;

const routePreloaders: Record<string, RoutePreloader> = {
  [WORKSPACE_ROUTES.home]: () => loadCapabilityView("dashboard", "OverviewPage", () => import("@hellotest/dashboard/frontend/pages/OverviewPage")),
  [WORKSPACE_ROUTES.adminSpace]: () => loadCapabilityView("platform", "AdminSpacePage", () => import("@hellotest/platform/frontend/pages/AdminSpacePage")),
  [WORKSPACE_ROUTES.agenticWorkflows]: () => loadCapabilityView("agentic", "AgenticWorkflowsPage", () => import("@hellotest/agentic/frontend/pages/AgenticWorkflowsPage")),
  [WORKSPACE_ROUTES.automation]: () => loadCapabilityView("automation", "AutomationPage", () => import("@hellotest/automation/frontend/pages/AutomationPage")),
  [WORKSPACE_ROUTES.objectRepository]: () => loadCapabilityView("automation", "AutomationPage", () => import("@hellotest/automation/frontend/pages/AutomationPage")),
  [WORKSPACE_ROUTES.design]: () => loadCapabilityView("testing", "DesignPage", () => import("@hellotest/testing/frontend/pages/DesignPage")),
  [WORKSPACE_ROUTES.executions]: () => loadCapabilityView("testing", "ExecutionsPage", () => import("@hellotest/testing/frontend/pages/ExecutionsPage")),
  [WORKSPACE_ROUTES.integrations]: () => loadCapabilityView("integration", "IntegrationsPage", () => import("@hellotest/integration/frontend/pages/IntegrationsPage")),
  [WORKSPACE_ROUTES.issues]: () => loadCapabilityView("testing", "IssuesPage", () => import("@hellotest/testing/frontend/pages/IssuesPage")),
  [WORKSPACE_ROUTES.feedback]: () => loadCapabilityView("testing", "IssuesPage", () => import("@hellotest/testing/frontend/pages/IssuesPage")),
  [WORKSPACE_ROUTES.knowledgeRepo]: () => loadCapabilityView("knowledge", "KnowledgeRepoPage", () => import("@hellotest/knowledge/frontend/pages/KnowledgeRepoPage")),
  [WORKSPACE_ROUTES.notifications]: () => loadCapabilityView("platform", "NotificationsPage", () => import("@hellotest/platform/frontend/pages/NotificationsPage")),
  [WORKSPACE_ROUTES.people]: () => loadCapabilityView("platform", "PeoplePage", () => import("@hellotest/platform/frontend/pages/PeoplePage")),
  [WORKSPACE_ROUTES.projects]: () => loadCapabilityView("platform", "ProjectsPage", () => import("@hellotest/platform/frontend/pages/ProjectsPage")),
  [WORKSPACE_ROUTES.requirements]: () => loadCapabilityView("manual", "RequirementsPage", () => import("@hellotest/manual/frontend/pages/RequirementsPage")),
  [WORKSPACE_ROUTES.stories]: () => loadCapabilityView("manual", "RequirementsPage", () => import("@hellotest/manual/frontend/pages/RequirementsPage")),
  [WORKSPACE_ROUTES.backlog]: () => loadCapabilityView("manual", "RequirementsPage", () => import("@hellotest/manual/frontend/pages/RequirementsPage")),
  [WORKSPACE_ROUTES.sprints]: () => loadCapabilityView("manual", "RequirementsPage", () => import("@hellotest/manual/frontend/pages/RequirementsPage")),
  [WORKSPACE_ROUTES.releases]: () => loadCapabilityView("manual", "ReleasesPage", () => import("@hellotest/manual/frontend/pages/ReleasesPage")),
  [WORKSPACE_ROUTES.settings]: () => loadCapabilityView("platform", "SettingsPage", () => import("@hellotest/platform/frontend/pages/SettingsPage")),
  [WORKSPACE_ROUTES.sharedSteps]: () => loadCapabilityView("testing", "SharedStepsPage", () => import("@hellotest/testing/frontend/pages/SharedStepsPage")),
  [WORKSPACE_ROUTES.support]: () => import("../pages/SupportPage"),
  [WORKSPACE_ROUTES.testCases]: () => loadCapabilityView("testing", "TestCasesPage", () => import("@hellotest/testing/frontend/pages/TestCasesPage")),
  [WORKSPACE_ROUTES.testEnvironments]: () => loadCapabilityView("testing", "TestEnvironmentPage", () => import("@hellotest/testing/frontend/pages/TestEnvironmentPage")),
  [WORKSPACE_ROUTES.testData]: () => loadCapabilityView("testing", "TestEnvironmentPage", () => import("@hellotest/testing/frontend/pages/TestEnvironmentPage")),
  [WORKSPACE_ROUTES.testConfigurations]: () => loadCapabilityView("testing", "TestEnvironmentPage", () => import("@hellotest/testing/frontend/pages/TestEnvironmentPage")),
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
