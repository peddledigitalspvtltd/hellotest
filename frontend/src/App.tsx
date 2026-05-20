import {
  Navigate,
  RouterProvider,
  createBrowserRouter,
  useLocation
} from "react-router-dom";
import { useEffect } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider, useAuth } from "./auth/AuthContext";
import { AppShell } from "./components/AppShell";
import { LocalizationProvider, useLocalization } from "./context/LocalizationContext";
import { AuthPage } from "./pages/AuthPage";
import { DesignPage } from "./pages/DesignPage";
import { ExecutionsPage } from "./pages/ExecutionsPage";
import { OverviewPage } from "./pages/OverviewPage";
import { PeoplePage } from "./pages/PeoplePage";
import { ProjectsPage } from "./pages/ProjectsPage";
import { RequirementsPage } from "./pages/RequirementsPage";
import { FeedbackPage } from "./pages/FeedbackPage";
import { TestCasesPage } from "./pages/TestCasesPage";
import { IntegrationsPage } from "./pages/IntegrationsPage";
import { SupportPage } from "./pages/SupportPage";
import { NotificationsPage } from "./pages/NotificationsPage";
import { SettingsPage } from "./pages/SettingsPage";
import { SharedStepsPage } from "./pages/SharedStepsPage";
import { TestEnvironmentPage } from "./pages/TestEnvironmentPage";
import { TestOpsPage } from "./pages/TestOpsPage";
import { KnowledgeRepoPage } from "./pages/KnowledgeRepoPage";
import { AutomationPage } from "./pages/AutomationPage";

const queryClient = new QueryClient();
const THEME_KEY = "app_theme";

const PAGE_TITLES: Record<string, { key?: string; fallback: string }> = {
  "/": { key: "page.overview", fallback: "Overview" },
  "/people": { key: "page.people", fallback: "People" },
  "/projects": { key: "page.projects", fallback: "Projects" },
  "/integrations": { key: "page.integrations", fallback: "Integrations" },
  "/design": { key: "page.design", fallback: "Test Design" },
  "/requirements": { key: "page.requirements", fallback: "Requirements" },
  "/feedback": { key: "page.feedback", fallback: "Feedback" },
  "/support": { key: "page.support", fallback: "Support" },
  "/notifications": { key: "page.notifications", fallback: "Notifications" },
  "/settings": { key: "page.settings", fallback: "Settings" },
  "/test-cases": { key: "page.testCases", fallback: "Test Cases" },
  "/shared-steps": { key: "page.sharedSteps", fallback: "Shared Step Groups" },
  "/executions": { key: "page.executions", fallback: "Test Runs" },
  "/automation": { fallback: "Automation" },
  "/testops": { fallback: "TestOps" },
  "/ops-telemetry": { fallback: "OPS Telemetry" },
  "/traces": { fallback: "Distributed Traces" },
  "/test-environments": { key: "page.testEnvironments", fallback: "Test Environments" },
  "/test-data": { key: "page.testData", fallback: "Test Data" },
  "/test-configurations": { key: "page.testConfigurations", fallback: "Test Configurations" },
  "/knowledge-repo": { fallback: "AI Knowledge" },
  "/auth": { fallback: "Sign In" }
};

function ThemeBootstrap() {
  useEffect(() => {
    const stored = window.localStorage.getItem(THEME_KEY);
    const theme = stored === "dark" || stored === "light"
      ? stored
      : window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light";

    document.documentElement.dataset.theme = theme;
  }, []);

  return null;
}

function PageTitleUpdater() {
  const location = useLocation();
  const { t } = useLocalization();

  useEffect(() => {
    const meta = PAGE_TITLES[location.pathname];
    document.title = meta ? `${meta.key ? t(meta.key, meta.fallback) : meta.fallback} · QAIra` : "QAIra";
  }, [location.pathname, t]);

  return null;
}

function ProtectedLayout() {
  const { session, isLoading } = useAuth();

  if (isLoading) {
    return <div className="splash-screen">Loading workspace…</div>;
  }

  if (!session) {
    return <Navigate to="/auth" replace />;
  }

  return (
    <>
      <PageTitleUpdater />
      <AppShell />
    </>
  );
}

function AuthRoute() {
  const { session, isLoading } = useAuth();

  if (isLoading) {
    return <div className="splash-screen">Checking session…</div>;
  }

  if (session) {
    return <Navigate to="/" replace />;
  }

  return (
    <>
      <PageTitleUpdater />
      <AuthPage />
    </>
  );
}

const router = createBrowserRouter([
  {
    path: "/auth",
    element: <AuthRoute />
  },
  {
    path: "/",
    element: <ProtectedLayout />,
    children: [
      { index: true, element: <OverviewPage /> },
      { path: "people", element: <PeoplePage /> },
      { path: "projects", element: <ProjectsPage /> },
      { path: "integrations", element: <IntegrationsPage /> },
      { path: "design", element: <DesignPage /> },
      { path: "requirements", element: <RequirementsPage /> },
      { path: "feedback", element: <FeedbackPage /> },
      { path: "support", element: <SupportPage /> },
      { path: "notifications", element: <NotificationsPage /> },
      { path: "settings", element: <SettingsPage /> },
      { path: "test-cases", element: <TestCasesPage /> },
      { path: "shared-steps", element: <SharedStepsPage /> },
      { path: "executions", element: <ExecutionsPage /> },
      { path: "automation", element: <AutomationPage /> },
      { path: "testops", element: <TestOpsPage /> },
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
          <RouterProvider router={router} />
        </LocalizationProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}
