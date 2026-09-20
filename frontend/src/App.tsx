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
import { AppErrorState } from "./components/AppErrorBoundary";
import { AppShell } from "./components/AppShell";
import { WorkspacePageSkeleton } from "./components/WorkspacePageSkeleton";
import { LocalizationProvider, useLocalization } from "./context/LocalizationContext";
import {
  getRouteFromLocation,
  isBrowserReload,
  readCurrentWorkspaceRoute,
  readPostAuthRoute,
  rememberAuthRedirectRoute,
  rememberCurrentWorkspaceRoute
} from "./lib/routeHistory";
import { readWorkspaceTheme, writeWorkspaceTheme } from "./lib/workspacePreferences";
import { WORKSPACE_ROUTES, workspaceChildPath } from "./lib/workspaceRoutes";
import { createAppQueryClient } from "./lib/appQueryClient";

const queryClient = createAppQueryClient();

const AuthPage = lazy(() => import("./pages/AuthPage").then((module) => ({ default: module.AuthPage })));

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
      { index: true, lazy: () => import("./pages/OverviewPage").then(({ OverviewPage }) => ({ Component: OverviewPage })) },
      { path: workspaceChildPath(WORKSPACE_ROUTES.adminSpace), lazy: () => import("./pages/AdminSpacePage").then(({ AdminSpacePage }) => ({ Component: AdminSpacePage })) },
      { path: workspaceChildPath(WORKSPACE_ROUTES.people), lazy: () => import("./pages/PeoplePage").then(({ PeoplePage }) => ({ Component: PeoplePage })) },
      { path: workspaceChildPath(WORKSPACE_ROUTES.projects), lazy: () => import("./pages/ProjectsPage").then(({ ProjectsPage }) => ({ Component: ProjectsPage })) },
      { path: workspaceChildPath(WORKSPACE_ROUTES.integrations), lazy: () => import("./pages/IntegrationsPage").then(({ IntegrationsPage }) => ({ Component: IntegrationsPage })) },
      { path: workspaceChildPath(WORKSPACE_ROUTES.design), lazy: () => import("./pages/DesignPage").then(({ DesignPage }) => ({ Component: DesignPage })) },
      { path: workspaceChildPath(WORKSPACE_ROUTES.requirements), element: <Navigate to={WORKSPACE_ROUTES.stories} replace /> },
      { path: workspaceChildPath(WORKSPACE_ROUTES.stories), lazy: () => import("./pages/RequirementsPage").then(({ RequirementsPage }) => ({ Component: () => <RequirementsPage workspaceMode="stories" /> })) },
      { path: workspaceChildPath(WORKSPACE_ROUTES.backlog), lazy: () => import("./pages/RequirementsPage").then(({ RequirementsPage }) => ({ Component: () => <RequirementsPage workspaceMode="backlog" /> })) },
      { path: workspaceChildPath(WORKSPACE_ROUTES.sprints), lazy: () => import("./pages/RequirementsPage").then(({ RequirementsPage }) => ({ Component: () => <RequirementsPage workspaceMode="sprints" /> })) },
      { path: workspaceChildPath(WORKSPACE_ROUTES.releases), lazy: () => import("./pages/ReleasesPage").then(({ ReleasesPage }) => ({ Component: ReleasesPage })) },
      { path: workspaceChildPath(WORKSPACE_ROUTES.issues), lazy: () => import("./pages/IssuesPage").then(({ IssuesPage }) => ({ Component: IssuesPage })) },
      { path: workspaceChildPath(WORKSPACE_ROUTES.feedback), element: <Navigate to={WORKSPACE_ROUTES.issues} replace /> },
      { path: workspaceChildPath(WORKSPACE_ROUTES.support), lazy: () => import("./pages/SupportPage").then(({ SupportPage }) => ({ Component: SupportPage })) },
      { path: workspaceChildPath(WORKSPACE_ROUTES.notifications), lazy: () => import("./pages/NotificationsPage").then(({ NotificationsPage }) => ({ Component: NotificationsPage })) },
      { path: workspaceChildPath(WORKSPACE_ROUTES.settings), lazy: () => import("./pages/SettingsPage").then(({ SettingsPage }) => ({ Component: SettingsPage })) },
      { path: workspaceChildPath(WORKSPACE_ROUTES.testCases), lazy: () => import("./pages/TestCasesPage").then(({ TestCasesPage }) => ({ Component: TestCasesPage })) },
      { path: workspaceChildPath(WORKSPACE_ROUTES.sharedSteps), lazy: () => import("./pages/SharedStepsPage").then(({ SharedStepsPage }) => ({ Component: SharedStepsPage })) },
      { path: workspaceChildPath(WORKSPACE_ROUTES.executions), lazy: () => import("./pages/ExecutionsPage").then(({ ExecutionsPage }) => ({ Component: ExecutionsPage })) },
      { path: workspaceChildPath(WORKSPACE_ROUTES.automation), lazy: () => import("./pages/AutomationPage").then(({ AutomationPage }) => ({ Component: () => <AutomationPage initialView="cases" /> })) },
      { path: workspaceChildPath(WORKSPACE_ROUTES.objectRepository), lazy: () => import("./pages/AutomationPage").then(({ AutomationPage }) => ({ Component: () => <AutomationPage initialView="repository" /> })) },
      { path: workspaceChildPath(WORKSPACE_ROUTES.agenticWorkflows), lazy: () => import("./pages/AgenticWorkflowsPage").then(({ AgenticWorkflowsPage }) => ({ Component: AgenticWorkflowsPage })) },
      { path: workspaceChildPath(WORKSPACE_ROUTES.localPlaywright), element: <Navigate to={WORKSPACE_ROUTES.automation} replace /> },
      { path: workspaceChildPath(WORKSPACE_ROUTES.testOps), lazy: () => import("./pages/TestOpsPage").then(({ TestOpsPage }) => ({ Component: () => <TestOpsPage initialView="batch-process" /> })) },
      { path: workspaceChildPath(WORKSPACE_ROUTES.opsTelemetry), lazy: () => import("./pages/TestOpsPage").then(({ TestOpsPage }) => ({ Component: () => <TestOpsPage initialView="ops-telemetry" /> })) },
      { path: workspaceChildPath(WORKSPACE_ROUTES.traces), lazy: () => import("./pages/TestOpsPage").then(({ TestOpsPage }) => ({ Component: () => <TestOpsPage initialView="traces" /> })) },
      { path: workspaceChildPath(WORKSPACE_ROUTES.testEnvironments), lazy: () => import("./pages/TestEnvironmentPage").then(({ TestEnvironmentPage }) => ({ Component: () => <TestEnvironmentPage view="environments" /> })) },
      { path: workspaceChildPath(WORKSPACE_ROUTES.testData), lazy: () => import("./pages/TestEnvironmentPage").then(({ TestEnvironmentPage }) => ({ Component: () => <TestEnvironmentPage view="data" /> })) },
      { path: workspaceChildPath(WORKSPACE_ROUTES.testConfigurations), lazy: () => import("./pages/TestEnvironmentPage").then(({ TestEnvironmentPage }) => ({ Component: () => <TestEnvironmentPage view="configurations" /> })) },
      { path: workspaceChildPath(WORKSPACE_ROUTES.knowledgeRepo), lazy: () => import("./pages/KnowledgeRepoPage").then(({ KnowledgeRepoPage }) => ({ Component: KnowledgeRepoPage })) },
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
