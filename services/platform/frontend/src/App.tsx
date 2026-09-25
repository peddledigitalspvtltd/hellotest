import { capabilityView } from "./platform/capabilities/CapabilityView";
import {
  Navigate,
  RouterProvider,
  createBrowserRouter,
  useLocation,
  useNavigate,
  useRouteError
} from "react-router-dom";
import { Suspense, lazy, useEffect, useRef } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider, useAuth } from "./auth/AuthContext";
import { AppErrorState } from "./platform/components/AppErrorBoundary";
import { AppShell } from "./platform/components/AppShell";
import { WorkspacePageSkeleton } from "./platform/components/WorkspacePageSkeleton";
import { LocalizationProvider, useLocalization } from "./context/LocalizationContext";
import {
  getRouteFromLocation,
  isBrowserReload,
  readCurrentWorkspaceRoute,
  readPostAuthRoute,
  rememberAuthRedirectRoute,
  rememberCurrentWorkspaceRoute
} from "./platform/lib/routeHistory";
import { readWorkspaceTheme, writeWorkspaceTheme } from "./platform/lib/workspacePreferences";
import { WORKSPACE_ROUTES, workspaceChildPath } from "./platform/lib/workspaceRoutes";
import { createAppQueryClient } from "./platform/lib/appQueryClient";

const queryClient = createAppQueryClient();

const AuthPage = lazy(() => import("@hellotest/platform/frontend/pages/AuthPage").then((module) => ({ default: module.AuthPage })));

const PAGE_TITLES: Record<string, { key?: string; fallback: string }> = {
  [WORKSPACE_ROUTES.home]: { key: "page.overview", fallback: "Overview" },
  "/people": { key: "page.people", fallback: "People" },
  "/admin-space": { key: "page.adminSpace", fallback: "Admin Space" },
  "/projects": { key: "page.projects", fallback: "Projects" },
  "/integrations": { key: "page.integrations", fallback: "Integrations" },
  "/design": { key: "page.design", fallback: "Test Design" },
  "/requirements": { key: "page.requirements", fallback: "Backlog" },
  "/backlog": { fallback: "Backlog" },
  "/sprints": { fallback: "Sprints" },
  "/releases": { fallback: "Releases" },
  "/issues": { key: "page.issues", fallback: "Defects" },
  "/feedback": { key: "page.issues", fallback: "Defects" },
  "/support": { key: "page.support", fallback: "Support" },
  "/notifications": { key: "page.notifications", fallback: "Notifications" },
  "/settings": { key: "page.settings", fallback: "Settings" },
  "/test-cases": { key: "page.testCases", fallback: "Test Cases" },
  "/shared-steps": { key: "page.sharedSteps", fallback: "Shared Step Groups" },
  "/executions": { key: "page.executions", fallback: "Test Runs" },
  "/automation": { fallback: "Automation Cases" },
  "/object-repository": { fallback: "Object Repository" },
  "/agentic-workflows": { key: "page.agenticWorkflows", fallback: "Agentic Workflows" },
  "/testops": { fallback: "Batch Process" },
  "/ops-telemetry": { fallback: "OPS Telemetry" },
  "/traces": { fallback: "Distributed Traces" },
  "/test-environments": { key: "page.testEnvironments", fallback: "Test Environments" },
  "/test-data": { key: "page.testData", fallback: "Test Data" },
  "/test-configurations": { key: "page.testConfigurations", fallback: "Test Configurations" },
  "/knowledge-repo": { key: "page.knowledgeRepo", fallback: "Knowledge Repo" },
  "/auth": { fallback: "Sign In" },
  "/signup": { fallback: "Sign Up" }
};

function PersonalLocalization({ children }: { children: React.ReactNode }) {
  const { session } = useAuth();
  return <LocalizationProvider key={session?.user.id || "guest"} userId={session?.user.id}>{children}</LocalizationProvider>;
}

function ThemeBootstrap() {
  useEffect(() => {
    writeWorkspaceTheme(readWorkspaceTheme());
  }, []);

  return null;
}

function PageTitleUpdater() {
  const location = useLocation();
  const { t } = useLocalization();

  useEffect(() => {
    const meta = PAGE_TITLES[location.pathname];
    document.title = meta ? `${meta.key ? t(meta.key, meta.fallback) : meta.fallback} · HelloTest` : "HelloTest";
  }, [location.pathname, t]);

  return null;
}

function RouteContinuityManager() {
  const location = useLocation();
  const navigate = useNavigate();
  const checkedInitialRouteRef = useRef(false);

  useEffect(() => {
    const route = getRouteFromLocation(location);
    const isRootRoute = location.pathname === "/" && !location.search && !location.hash;

    if (!checkedInitialRouteRef.current) {
      checkedInitialRouteRef.current = true;

      if (isRootRoute && isBrowserReload()) {
        const previousRoute = readCurrentWorkspaceRoute();

        if (previousRoute && previousRoute !== "/") {
          navigate(previousRoute, { replace: true });
          return;
        }
      }
    }

    rememberCurrentWorkspaceRoute(route);
  }, [location, navigate]);

  return null;
}

function ProtectedLayout() {
  const { session, isLoading } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return <div className="splash-screen"><WorkspacePageSkeleton label="Loading workspace" /></div>;
  }

  if (!session) {
    rememberAuthRedirectRoute(getRouteFromLocation(location));
    return <Navigate to="/auth" replace />;
  }

  return (
    <>
      <RouteContinuityManager />
      <PageTitleUpdater />
      <AppShell />
    </>
  );
}

function AuthRoute({ initialMode = "login" }: { initialMode?: "login" | "signup" }) {
  const { session, isLoading } = useAuth();

  if (isLoading) {
    return <div className="splash-screen">Checking session…</div>;
  }

  if (session) {
    return <Navigate to={readPostAuthRoute()} replace />;
  }

  return (
    <>
      <PageTitleUpdater />
      <AuthPage initialMode={initialMode} />
    </>
  );
}

function WorkspaceRouteError() {
  const error = useRouteError();

  return (
    <div className="splash-screen">
      <AppErrorState
        error={error}
        fallbackMessage="HelloTest could not finish loading this page. Reload to request a fresh application bundle and try again."
        onRetry={() => window.location.reload()}
        title="The page could not be loaded"
      />
    </div>
  );
}

const router = createBrowserRouter([
  {
    path: "/auth",
    element: <AuthRoute />
  },
  {
    path: "/signup",
    element: <AuthRoute initialMode="signup" />
  },
  {
    path: "/",
    element: <ProtectedLayout />,
    errorElement: <WorkspaceRouteError />,
    hydrateFallbackElement: <div className="splash-screen"><WorkspacePageSkeleton label="Loading workspace" /></div>,
    children: [
      { index: true, lazy: () => Promise.resolve({ OverviewPage: capabilityView<React.ComponentProps<typeof import("@hellotest/dashboard/frontend/pages/OverviewPage")["OverviewPage"]> & {}>("dashboard", "OverviewPage", () => import("@hellotest/dashboard/frontend/pages/OverviewPage"), "dashboard") }).then(({ OverviewPage }) => ({ Component: OverviewPage })) },
      { path: workspaceChildPath(WORKSPACE_ROUTES.adminSpace), lazy: () => Promise.resolve({ AdminSpacePage: capabilityView<React.ComponentProps<typeof import("@hellotest/platform/frontend/pages/AdminSpacePage")["AdminSpacePage"]> & {}>("platform", "AdminSpacePage", () => import("@hellotest/platform/frontend/pages/AdminSpacePage"), "platform") }).then(({ AdminSpacePage }) => ({ Component: AdminSpacePage })) },
      { path: workspaceChildPath(WORKSPACE_ROUTES.people), lazy: () => Promise.resolve({ PeoplePage: capabilityView<React.ComponentProps<typeof import("@hellotest/platform/frontend/pages/PeoplePage")["PeoplePage"]> & {}>("platform", "PeoplePage", () => import("@hellotest/platform/frontend/pages/PeoplePage"), "platform") }).then(({ PeoplePage }) => ({ Component: PeoplePage })) },
      { path: workspaceChildPath(WORKSPACE_ROUTES.projects), lazy: () => Promise.resolve({ ProjectsPage: capabilityView<React.ComponentProps<typeof import("@hellotest/platform/frontend/pages/ProjectsPage")["ProjectsPage"]> & {}>("platform", "ProjectsPage", () => import("@hellotest/platform/frontend/pages/ProjectsPage"), "platform") }).then(({ ProjectsPage }) => ({ Component: ProjectsPage })) },
      { path: workspaceChildPath(WORKSPACE_ROUTES.integrations), lazy: () => Promise.resolve({ IntegrationsPage: capabilityView<React.ComponentProps<typeof import("@hellotest/integration/frontend/pages/IntegrationsPage")["IntegrationsPage"]> & {}>("integration", "IntegrationsPage", () => import("@hellotest/integration/frontend/pages/IntegrationsPage"), "integration") }).then(({ IntegrationsPage }) => ({ Component: IntegrationsPage })) },
      { path: workspaceChildPath(WORKSPACE_ROUTES.design), lazy: () => Promise.resolve({ DesignPage: capabilityView<React.ComponentProps<typeof import("@hellotest/testing/frontend/pages/DesignPage")["DesignPage"]> & {}>("testing", "DesignPage", () => import("@hellotest/testing/frontend/pages/DesignPage"), "testing") }).then(({ DesignPage }) => ({ Component: DesignPage })) },
      { path: workspaceChildPath(WORKSPACE_ROUTES.requirements), element: <Navigate to={WORKSPACE_ROUTES.stories} replace /> },
      { path: workspaceChildPath(WORKSPACE_ROUTES.stories), lazy: () => Promise.resolve({ RequirementsPage: capabilityView<React.ComponentProps<typeof import("@hellotest/manual/frontend/pages/RequirementsPage")["RequirementsPage"]> & {}>("manual", "RequirementsPage", () => import("@hellotest/manual/frontend/pages/RequirementsPage"), "manual") }).then(({ RequirementsPage }) => ({ Component: () => <RequirementsPage workspaceMode="stories" /> })) },
      { path: workspaceChildPath(WORKSPACE_ROUTES.backlog), lazy: () => Promise.resolve({ RequirementsPage: capabilityView<React.ComponentProps<typeof import("@hellotest/manual/frontend/pages/RequirementsPage")["RequirementsPage"]> & {}>("manual", "RequirementsPage", () => import("@hellotest/manual/frontend/pages/RequirementsPage"), "manual") }).then(({ RequirementsPage }) => ({ Component: () => <RequirementsPage workspaceMode="backlog" /> })) },
      { path: workspaceChildPath(WORKSPACE_ROUTES.sprints), lazy: () => Promise.resolve({ RequirementsPage: capabilityView<React.ComponentProps<typeof import("@hellotest/manual/frontend/pages/RequirementsPage")["RequirementsPage"]> & {}>("manual", "RequirementsPage", () => import("@hellotest/manual/frontend/pages/RequirementsPage"), "manual") }).then(({ RequirementsPage }) => ({ Component: () => <RequirementsPage workspaceMode="sprints" /> })) },
      { path: workspaceChildPath(WORKSPACE_ROUTES.releases), lazy: () => Promise.resolve({ ReleasesPage: capabilityView<React.ComponentProps<typeof import("@hellotest/manual/frontend/pages/ReleasesPage")["ReleasesPage"]> & {}>("manual", "ReleasesPage", () => import("@hellotest/manual/frontend/pages/ReleasesPage"), "manual") }).then(({ ReleasesPage }) => ({ Component: ReleasesPage })) },
      { path: workspaceChildPath(WORKSPACE_ROUTES.issues), lazy: () => Promise.resolve({ IssuesPage: capabilityView<React.ComponentProps<typeof import("@hellotest/testing/frontend/pages/IssuesPage")["IssuesPage"]> & {}>("testing", "IssuesPage", () => import("@hellotest/testing/frontend/pages/IssuesPage"), "testing") }).then(({ IssuesPage }) => ({ Component: IssuesPage })) },
      { path: workspaceChildPath(WORKSPACE_ROUTES.feedback), element: <Navigate to={WORKSPACE_ROUTES.issues} replace /> },
      { path: workspaceChildPath(WORKSPACE_ROUTES.support), lazy: () => import("./platform/pages/SupportPage").then(({ SupportPage }) => ({ Component: SupportPage })) },
      { path: workspaceChildPath(WORKSPACE_ROUTES.notifications), lazy: () => Promise.resolve({ NotificationsPage: capabilityView<React.ComponentProps<typeof import("@hellotest/platform/frontend/pages/NotificationsPage")["NotificationsPage"]> & {}>("platform", "NotificationsPage", () => import("@hellotest/platform/frontend/pages/NotificationsPage"), "platform") }).then(({ NotificationsPage }) => ({ Component: NotificationsPage })) },
      { path: workspaceChildPath(WORKSPACE_ROUTES.settings), lazy: () => Promise.resolve({ SettingsPage: capabilityView<React.ComponentProps<typeof import("@hellotest/platform/frontend/pages/SettingsPage")["SettingsPage"]> & {}>("platform", "SettingsPage", () => import("@hellotest/platform/frontend/pages/SettingsPage"), "platform") }).then(({ SettingsPage }) => ({ Component: SettingsPage })) },
      { path: workspaceChildPath(WORKSPACE_ROUTES.testCases), lazy: () => Promise.resolve({ TestCasesPage: capabilityView<React.ComponentProps<typeof import("@hellotest/testing/frontend/pages/TestCasesPage")["TestCasesPage"]> & {}>("testing", "TestCasesPage", () => import("@hellotest/testing/frontend/pages/TestCasesPage"), "testing") }).then(({ TestCasesPage }) => ({ Component: TestCasesPage })) },
      { path: workspaceChildPath(WORKSPACE_ROUTES.sharedSteps), lazy: () => Promise.resolve({ SharedStepsPage: capabilityView<React.ComponentProps<typeof import("@hellotest/testing/frontend/pages/SharedStepsPage")["SharedStepsPage"]> & {}>("testing", "SharedStepsPage", () => import("@hellotest/testing/frontend/pages/SharedStepsPage"), "testing") }).then(({ SharedStepsPage }) => ({ Component: SharedStepsPage })) },
      { path: workspaceChildPath(WORKSPACE_ROUTES.executions), lazy: () => Promise.resolve({ ExecutionsPage: capabilityView<React.ComponentProps<typeof import("@hellotest/testing/frontend/pages/ExecutionsPage")["ExecutionsPage"]> & {}>("testing", "ExecutionsPage", () => import("@hellotest/testing/frontend/pages/ExecutionsPage"), "testing") }).then(({ ExecutionsPage }) => ({ Component: ExecutionsPage })) },
      { path: workspaceChildPath(WORKSPACE_ROUTES.automation), lazy: () => Promise.resolve({ AutomationPage: capabilityView<React.ComponentProps<typeof import("@hellotest/automation/frontend/pages/AutomationPage")["AutomationPage"]> & {}>("automation", "AutomationPage", () => import("@hellotest/automation/frontend/pages/AutomationPage"), "automation") }).then(({ AutomationPage }) => ({ Component: () => <AutomationPage initialView="cases" /> })) },
      { path: workspaceChildPath(WORKSPACE_ROUTES.objectRepository), lazy: () => Promise.resolve({ AutomationPage: capabilityView<React.ComponentProps<typeof import("@hellotest/automation/frontend/pages/AutomationPage")["AutomationPage"]> & {}>("automation", "AutomationPage", () => import("@hellotest/automation/frontend/pages/AutomationPage"), "automation") }).then(({ AutomationPage }) => ({ Component: () => <AutomationPage initialView="repository" /> })) },
      { path: workspaceChildPath(WORKSPACE_ROUTES.agenticWorkflows), lazy: () => Promise.resolve({ AgenticWorkflowsPage: capabilityView<React.ComponentProps<typeof import("@hellotest/agentic/frontend/pages/AgenticWorkflowsPage")["AgenticWorkflowsPage"]> & {}>("agentic", "AgenticWorkflowsPage", () => import("@hellotest/agentic/frontend/pages/AgenticWorkflowsPage"), "agentic") }).then(({ AgenticWorkflowsPage }) => ({ Component: AgenticWorkflowsPage })) },
      { path: workspaceChildPath(WORKSPACE_ROUTES.localPlaywright), element: <Navigate to={WORKSPACE_ROUTES.automation} replace /> },
      { path: workspaceChildPath(WORKSPACE_ROUTES.testOps), lazy: () => import("./platform/pages/TestOpsPage").then(({ TestOpsPage }) => ({ Component: () => <TestOpsPage initialView="batch-process" /> })) },
      { path: workspaceChildPath(WORKSPACE_ROUTES.opsTelemetry), lazy: () => import("./platform/pages/TestOpsPage").then(({ TestOpsPage }) => ({ Component: () => <TestOpsPage initialView="ops-telemetry" /> })) },
      { path: workspaceChildPath(WORKSPACE_ROUTES.traces), element: <Navigate to="/ops-telemetry?monitoring=traces" replace /> },
      { path: workspaceChildPath(WORKSPACE_ROUTES.testEnvironments), lazy: () => Promise.resolve({ TestEnvironmentPage: capabilityView<React.ComponentProps<typeof import("@hellotest/testing/frontend/pages/TestEnvironmentPage")["TestEnvironmentPage"]> & {}>("testing", "TestEnvironmentPage", () => import("@hellotest/testing/frontend/pages/TestEnvironmentPage"), "testing") }).then(({ TestEnvironmentPage }) => ({ Component: () => <TestEnvironmentPage view="environments" /> })) },
      { path: workspaceChildPath(WORKSPACE_ROUTES.testData), lazy: () => Promise.resolve({ TestEnvironmentPage: capabilityView<React.ComponentProps<typeof import("@hellotest/testing/frontend/pages/TestEnvironmentPage")["TestEnvironmentPage"]> & {}>("testing", "TestEnvironmentPage", () => import("@hellotest/testing/frontend/pages/TestEnvironmentPage"), "testing") }).then(({ TestEnvironmentPage }) => ({ Component: () => <TestEnvironmentPage view="data" /> })) },
      { path: workspaceChildPath(WORKSPACE_ROUTES.testConfigurations), lazy: () => Promise.resolve({ TestEnvironmentPage: capabilityView<React.ComponentProps<typeof import("@hellotest/testing/frontend/pages/TestEnvironmentPage")["TestEnvironmentPage"]> & {}>("testing", "TestEnvironmentPage", () => import("@hellotest/testing/frontend/pages/TestEnvironmentPage"), "testing") }).then(({ TestEnvironmentPage }) => ({ Component: () => <TestEnvironmentPage view="configurations" /> })) },
      { path: workspaceChildPath(WORKSPACE_ROUTES.knowledgeRepo), lazy: () => Promise.resolve({ KnowledgeRepoPage: capabilityView<React.ComponentProps<typeof import("@hellotest/knowledge/frontend/pages/KnowledgeRepoPage")["KnowledgeRepoPage"]> & {}>("knowledge", "KnowledgeRepoPage", () => import("@hellotest/knowledge/frontend/pages/KnowledgeRepoPage"), "knowledge") }).then(({ KnowledgeRepoPage }) => ({ Component: KnowledgeRepoPage })) },
      { path: "*", element: <Navigate to={WORKSPACE_ROUTES.home} replace /> }
    ]
  }
]);

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeBootstrap />
      <AuthProvider>
        <PersonalLocalization>
          <Suspense fallback={<div className="splash-screen">Loading workspace…</div>}>
            <RouterProvider router={router} />
          </Suspense>
        </PersonalLocalization>
      </AuthProvider>
    </QueryClientProvider>
  );
}
