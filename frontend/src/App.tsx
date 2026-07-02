import {
  Navigate,
  RouterProvider,
  createBrowserRouter,
  useLocation,
  useNavigate
} from "react-router-dom";
import { Suspense, lazy, useEffect, useRef } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider, useAuth } from "./auth/AuthContext";
import { AppShell } from "./components/AppShell";
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

const queryClient = new QueryClient();

const AdminSpacePage = lazy(() => import("./pages/AdminSpacePage").then((module) => ({ default: module.AdminSpacePage })));
const AgenticWorkflowsPage = lazy(() => import("./pages/AgenticWorkflowsPage").then((module) => ({ default: module.AgenticWorkflowsPage })));
const AuthPage = lazy(() => import("./pages/AuthPage").then((module) => ({ default: module.AuthPage })));
const AutomationPage = lazy(() => import("./pages/AutomationPage").then((module) => ({ default: module.AutomationPage })));
const DesignPage = lazy(() => import("./pages/DesignPage").then((module) => ({ default: module.DesignPage })));
const ExecutionsPage = lazy(() => import("./pages/ExecutionsPage").then((module) => ({ default: module.ExecutionsPage })));
const IntegrationsPage = lazy(() => import("./pages/IntegrationsPage").then((module) => ({ default: module.IntegrationsPage })));
const IssuesPage = lazy(() => import("./pages/IssuesPage").then((module) => ({ default: module.IssuesPage })));
const KnowledgeRepoPage = lazy(() => import("./pages/KnowledgeRepoPage").then((module) => ({ default: module.KnowledgeRepoPage })));
const NotificationsPage = lazy(() => import("./pages/NotificationsPage").then((module) => ({ default: module.NotificationsPage })));
const OverviewPage = lazy(() => import("./pages/OverviewPage").then((module) => ({ default: module.OverviewPage })));
const PeoplePage = lazy(() => import("./pages/PeoplePage").then((module) => ({ default: module.PeoplePage })));
const ProjectsPage = lazy(() => import("./pages/ProjectsPage").then((module) => ({ default: module.ProjectsPage })));
const RequirementsPage = lazy(() => import("./pages/RequirementsPage").then((module) => ({ default: module.RequirementsPage })));
const SettingsPage = lazy(() => import("./pages/SettingsPage").then((module) => ({ default: module.SettingsPage })));
const SharedStepsPage = lazy(() => import("./pages/SharedStepsPage").then((module) => ({ default: module.SharedStepsPage })));
const SupportPage = lazy(() => import("./pages/SupportPage").then((module) => ({ default: module.SupportPage })));
const TestCasesPage = lazy(() => import("./pages/TestCasesPage").then((module) => ({ default: module.TestCasesPage })));
const TestEnvironmentPage = lazy(() => import("./pages/TestEnvironmentPage").then((module) => ({ default: module.TestEnvironmentPage })));
const TestOpsPage = lazy(() => import("./pages/TestOpsPage").then((module) => ({ default: module.TestOpsPage })));

const PAGE_TITLES: Record<string, { key?: string; fallback: string }> = {
  "/": { key: "page.overview", fallback: "Overview" },
  "/people": { key: "page.people", fallback: "People" },
  "/admin-space": { key: "page.adminSpace", fallback: "Admin Space" },
  "/projects": { key: "page.projects", fallback: "Projects" },
  "/integrations": { key: "page.integrations", fallback: "Integrations" },
  "/design": { key: "page.design", fallback: "Test Design" },
  "/requirements": { key: "page.requirements", fallback: "Requirements" },
  "/issues": { key: "page.issues", fallback: "Report Issue" },
  "/feedback": { key: "page.issues", fallback: "Report Issue" },
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
    document.title = meta ? `${meta.key ? t(meta.key, meta.fallback) : meta.fallback} · QAira` : "QAira";
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
    return <div className="splash-screen">Loading workspace…</div>;
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
    children: [
      { index: true, element: <OverviewPage /> },
      { path: "admin-space", element: <AdminSpacePage /> },
      { path: "people", element: <PeoplePage /> },
      { path: "projects", element: <ProjectsPage /> },
      { path: "integrations", element: <IntegrationsPage /> },
      { path: "design", element: <DesignPage /> },
      { path: "requirements", element: <RequirementsPage /> },
      { path: "issues", element: <IssuesPage /> },
      { path: "feedback", element: <Navigate to="/issues" replace /> },
      { path: "support", element: <SupportPage /> },
      { path: "notifications", element: <NotificationsPage /> },
      { path: "settings", element: <SettingsPage /> },
      { path: "test-cases", element: <TestCasesPage /> },
      { path: "shared-steps", element: <SharedStepsPage /> },
      { path: "executions", element: <ExecutionsPage /> },
      { path: "automation", element: <AutomationPage initialView="cases" /> },
      { path: "object-repository", element: <AutomationPage initialView="repository" /> },
      { path: "agentic-workflows", element: <AgenticWorkflowsPage /> },
      { path: "local-playwright", element: <Navigate to="/automation" replace /> },
      { path: "testops", element: <TestOpsPage initialView="batch-process" /> },
      { path: "ops-telemetry", element: <TestOpsPage initialView="ops-telemetry" /> },
      { path: "traces", element: <TestOpsPage initialView="traces" /> },
      { path: "test-environments", element: <TestEnvironmentPage view="environments" /> },
      { path: "test-data", element: <TestEnvironmentPage view="data" /> },
      { path: "test-configurations", element: <TestEnvironmentPage view="configurations" /> },
      { path: "knowledge-repo", element: <KnowledgeRepoPage /> }
    ]
  }
]);

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeBootstrap />
      <AuthProvider>
        <LocalizationProvider>
          <Suspense fallback={<div className="splash-screen">Loading workspace…</div>}>
            <RouterProvider router={router} />
          </Suspense>
        </LocalizationProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}
