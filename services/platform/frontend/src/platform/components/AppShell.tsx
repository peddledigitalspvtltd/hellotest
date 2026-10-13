import { LoadingState } from "../../shared/components/LoadingState";
import { IconChevronRight, IconFolder, IconLayoutSidebarLeftCollapse, IconLayoutSidebarLeftExpand, IconSearch } from "@tabler/icons-react";
import { useDialogFocus } from "../../shared/hooks/useDialogFocus";
import { WorkspaceProjectSwitcher } from "./WorkspaceProjectSwitcher";
import { ProjectDeletionRecovery } from "./ProjectDeletionRecovery";
import "./workspace-shell.css";
import "./workspace-surfaces.css";
import type { ReactNode } from "react";
import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigation } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../../auth/AuthContext";
import { useLocalization } from "../../context/LocalizationContext";
import { AppErrorBoundary } from "./AppErrorBoundary";
import { AiKnowledgeBaseIcon, DatabaseConfigurationIcon, AiAgentStudioIcon, TestAutomationIcon, ProjectOverviewIcon, TestPlanIcon, TestRunsResultsIcon, AiAgentsIcon, BacklogIcon, ReleaseIcon, SprintIcon, StoryIcon, TestCaseIcon, TestDataIcon, TestSuiteIcon } from "./AppIcons";
import { BrandWordmark } from "./BrandWordmark";
import { WorkspacePageSkeleton } from "./WorkspacePageSkeleton";
import { UserProfileDialog } from "./UserProfileDialog";
import { WorkspacePreferencesMenu } from "./WorkspacePreferencesMenu";
import { capabilityView } from "../capabilities/CapabilityView";
const GroundedAssistant = capabilityView("chatbot", "GroundedAssistant", () => import("@hellotest/chatbot/frontend/components/GroundedAssistant"), "Ask HelloTest");
import "./module-navigation.css";
import "./workspace-experience.css";
import { useCurrentProject } from "../hooks/useCurrentProject";
import { useDomainMetadata } from "../hooks/useDomainMetadata";
import { useFeatureFlags } from "../hooks/useFeatureFlags";
import { useCapabilityAccess } from "../hooks/useCapabilityAccess";
import { useWorkspaceScrollRestoration } from "../hooks/useWorkspaceScrollRestoration";
import { api } from "../../lib/api";
import { asArray } from "../../shared/lib/collectionGuards";
import { areFeatureFlagsEnabled, requiredFeatureFlagsForPath } from "../lib/featureFlags";
import { getNavigationItemLabel, getNavigationItemPermissions, isNavigationItemActive, isNavigationDestinationActive } from "../lib/navigation";
import { getUnreadNotificationCount, NOTIFICATIONS_UPDATED_EVENT } from "../lib/notificationCenter";
import { readNotificationPreferences } from "../lib/notificationPreferences";
import { canAccessPath, hasAnyPermission } from "../lib/permissions";
import { queryKeys } from "../lib/queryKeys";
import { optionalQueryView } from "../../shared/lib/optionalQueryView";
import { availableWorkspaceProjects } from "../lib/workspaceSwitcher";
import { preloadWorkspaceRoute } from "../lib/routePrefetch";
import { capabilityForDestination, recentCapabilityKey, recordRecentCapability } from "../lib/workspaceDiscovery";
import {
  PREFERENCES_UPDATED_EVENT,
  readSidebarMode,
  readWorkspaceTheme,
  writeSidebarMode,
  writeWorkspaceTheme,
  type SidebarMode,
  type WorkspacePreferenceUpdate
} from "../lib/workspacePreferences";
import {
  AGENTIC_WORKFLOW_SECTION_ITEMS,
  AUTOMATION_SECTION_ITEMS,
  DASHBOARD_SECTION_ITEMS,
  PRODUCT_MANAGEMENT_SECTION_ITEMS,
  TEST_AUTHORING_SECTION_ITEMS,
  TEST_ENVIRONMENT_SECTION_ITEMS,
  TEST_RUNS_SECTION_ITEMS,
  TEST_PLAN_SECTION_ITEMS,
  TESTOPS_SECTION_ITEMS,
  WORKSPACE_LIBRARY_PATHS,
  WORKSPACE_PAGE_LABELS,
  WORKSPACE_SECTION_LABEL_KEYS
} from "../lib/workspaceSections";
import { WORKSPACE_ROUTES } from "../lib/workspaceRoutes";

const WorkspaceNavigator = lazy(() => import("./WorkspaceNavigator").then(module => ({ default: module.WorkspaceNavigator })));
const RegionalPreferencesDialog = lazy(() => import("./RegionalPreferencesDialog").then(module => ({ default: module.RegionalPreferencesDialog })));

const MOBILE_SIDEBAR_BREAKPOINT = "(max-width: 768px)";

const navigation = [
  {
    label: "Workspace",
    items: [
      { id: "overview", to: WORKSPACE_ROUTES.home, label: "Home", shortLabel: "Home", icon: DashboardIcon, matchPaths: [WORKSPACE_ROUTES.home], featureKeys: ["hellotest.analytics.dashboards"] },
      { id: "projects", to: WORKSPACE_ROUTES.projects, label: "Project Overview", shortLabel: "Project Overview", icon: ProjectOverviewIcon, countKey: "projects", featureKeys: ["hellotest.ops.projects"] }
    ]
  },
  {
    label: "Build",
    items: [
      {
        id: "agentic-workflows",
        matchPaths: [WORKSPACE_ROUTES.agenticWorkflows, WORKSPACE_ROUTES.mcpServers],
        to: WORKSPACE_ROUTES.agenticWorkflows,
        label: "Agentic AI Studio",
        shortLabel: "Agentic AI Studio",
        icon: AiAgentStudioIcon,
        featureKeys: ["hellotest.ai.agentic_workflows"],
        disabledWhenNoProjects: true
      },
      { id: "knowledge", to: WORKSPACE_ROUTES.knowledgeRepo, label: "AI Knowledge Base", shortLabel: "AI Knowledge Base", icon: AiKnowledgeBaseIcon, featureKeys: ["hellotest.ai.knowledge"] },
      {
        id: "product-management",
        to: WORKSPACE_ROUTES.stories,
        label: "Product Management",
        shortLabel: "Product",
        icon: ProductManagementIcon,
        matchPaths: PRODUCT_MANAGEMENT_SECTION_ITEMS.map((item) => item.to),
        featureKeys: ["hellotest.manual.requirements"],
        disabledWhenNoProjects: true
      },
      {
        id: "authoring",
        to: WORKSPACE_ROUTES.testCases,
        label: "Library",
        shortLabel: "Library",
        icon: FlaskIcon,
        matchPaths: TEST_AUTHORING_SECTION_ITEMS.map((item) => item.to),
        featureKeys: ["hellotest.manual.requirements", "hellotest.manual.test_cases", "hellotest.manual.suites"],
        featureMatch: "any",
        disabledWhenNoProjects: true
      },
      {
        id: "automation",
        to: WORKSPACE_ROUTES.automation,
        label: "Test Automation",
        shortLabel: "Test Automation",
        icon: TestAutomationIcon,
        matchPaths: AUTOMATION_SECTION_ITEMS.map((item) => item.to),
        featureKeys: ["hellotest.automation.workspace"],
        disabledWhenNoProjects: true
      },
      {
        id: "environment",
        to: WORKSPACE_ROUTES.testEnvironments,
        label: "Test Data & Configuration",
        shortLabel: "Test Data & Configuration",
        icon: DatabaseConfigurationIcon,
        matchPaths: TEST_ENVIRONMENT_SECTION_ITEMS.map((item) => item.to),
        featureKeys: ["hellotest.manual.environments"],
        disabledWhenNoProjects: true
      },
      { id: "test-plan", to: WORKSPACE_ROUTES.design, label: "Test Plan", shortLabel: "Test Plan", icon: TestPlanIcon, matchPaths: ["/design"], featureKeys: ["hellotest.manual.suites", "hellotest.manual.runs"], featureMatch: "any", disabledWhenNoProjects: true }

    ]
  },
  {
    label: "Validate",
    items: [
      {
        id: "runs",
        to: WORKSPACE_ROUTES.executions,
        label: "Test Runs & Results",
        shortLabel: "Test Runs & Results",
        icon: TestRunsResultsIcon,
        matchPaths: ["/executions"],
        featureKeys: ["hellotest.manual.runs"],
        disabledWhenNoProjects: true
      },
      { id: "issues", to: WORKSPACE_ROUTES.issues, label: "Defects", shortLabel: "Defects", icon: BugIcon, featureKeys: ["hellotest.manual.bugs"] },
      {
        id: "testops",
        to: WORKSPACE_ROUTES.opsTelemetry,
        label: "TestOps",
        shortLabel: "TestOps",
        icon: ActivityIcon,
        matchPaths: TESTOPS_SECTION_ITEMS.map((item) => item.to),
        featureKeys: ["hellotest.automation.batch_process", "hellotest.ops.telemetry"],
        featureMatch: "any",
        disabledWhenNoProjects: true
      },


    ]
  },
  {
    label: "Connect",
    items: [
      {
        id: "admin-space",
        to: WORKSPACE_ROUTES.adminSpace,
        label: "Admin Space",
        shortLabel: "Admin",
        icon: UsersIcon,
        matchPaths: [WORKSPACE_ROUTES.adminSpace, WORKSPACE_ROUTES.people, WORKSPACE_ROUTES.integrations, WORKSPACE_ROUTES.settings]
      }
    ]
  },
  {
    label: "Settings",
    items: [
      { id: "notifications", to: WORKSPACE_ROUTES.notifications, label: "Notifications", shortLabel: "Alerts", icon: BellIcon, featureKeys: ["hellotest.ops.notifications"] },
      { id: "support", to: WORKSPACE_ROUTES.support, label: "Support", shortLabel: "Support", icon: SupportIcon }
    ]
  }
] as const;

export function AppShell() {
  return <ReadyAppShell />;
}

function WorkspaceLocalizationLoader() {
  const { setWorkspaceStrings } = useLocalization();

  useEffect(() => {
    let isCancelled = false;

    void api.settings.getLocalization()
      .then((response) => {
        if (!isCancelled) setWorkspaceStrings(response.strings);
      })
      .catch(() => undefined);

    return () => {
      isCancelled = true;
    };
  }, [setWorkspaceStrings]);

  return null;
}

function ReadyAppShell() {
  const location = useLocation();
  const queryClient = useQueryClient();
  const routeNavigation = useNavigation();
  const { session, error, clearError, logout } = useAuth();
  const { t } = useLocalization();
  const domainMetadataQuery = useDomainMetadata();
  const projectAccessKey = JSON.stringify([
    session?.user.id, session?.user.role, session?.user.role_id, session?.user.status,
    session?.user.permissions, session?.user.workspace_permissions, session?.user.project_permissions
  ]);
  const projectsQuery = useQuery({
    queryKey: [...queryKeys.projects(), "workspace-scopes", projectAccessKey],
    queryFn: api.metadata.workspaceScopes,
    retry: 1,
    staleTime: 60 * 1000
  });
  const featureFlagsQuery = useFeatureFlags(Boolean(session));
  const [sidebarProjectId, setSidebarProjectId] = useCurrentProject();
  useWorkspaceScrollRestoration(`${session?.user.id || "anonymous"}:${sidebarProjectId}`);
  const { can } = useCapabilityAccess(sidebarProjectId);
  const canViewNotifications = can("notification.view");
  const serverUnreadNotificationCountQuery = optionalQueryView(useQuery({
    queryKey: ["notifications", "unread", sidebarProjectId || "workspace"],
    queryFn: api.notifications.unreadCount,
    enabled: canViewNotifications,
    refetchInterval: 300_000,
    staleTime: 240_000
  }), canViewNotifications, { count: 0, by_preference: {} });
  const [theme, setTheme] = useState(readWorkspaceTheme);
  const [isCollapsed, setIsCollapsed] = useState(() => readSidebarMode() === "collapsed");
  const [isMobileViewport, setIsMobileViewport] = useState(() => window.matchMedia(MOBILE_SIDEBAR_BREAKPOINT).matches);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [isNavigatorOpen, setIsNavigatorOpen] = useState(false);
  const [isRegionalDialogOpen, setIsRegionalDialogOpen] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  useEffect(() => {
    const openNavigator = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k" && !event.altKey && !document.querySelector("[role=dialog][aria-modal=true]")) {
        event.preventDefault(); setIsNavigatorOpen(true);
      }
    };
    window.addEventListener("keydown", openNavigator);
    return () => window.removeEventListener("keydown", openNavigator);
  }, []);
  const [isProfileDialogOpen, setIsProfileDialogOpen] = useState(false);
  const [notificationUnreadCount, setNotificationUnreadCount] = useState(() => getUnreadNotificationCount());

  const projects = useMemo(() => availableWorkspaceProjects(asArray(projectsQuery.data?.projects)), [projectsQuery.data]);
  const hasNoProjects = projectsQuery.isSuccess && projects.length === 0;
  const currentProjectName =
    projects.find((project) => String(project.id) === String(sidebarProjectId))?.name ||
    (hasNoProjects ? t("shell.noProject", "No active project") : t("switcher.chooseProject", "Choose project"));

  useEffect(() => {
    const capability = capabilityForDestination(location.pathname, location.search);
    if (capability && session?.user.id) recordRecentCapability(recentCapabilityKey(session.user.id, sidebarProjectId), capability.id);
  }, [location.pathname, location.search, session?.user.id, sidebarProjectId]);
  const navCounts = {
    projects: projects.length
  };
  const notificationPreferences = readNotificationPreferences();
  const visibleServerUnreadCount = Object.entries(serverUnreadNotificationCountQuery.data?.by_preference || {})
    .reduce((total, [preference, count]) => {
      if (preference !== "unspecified" && notificationPreferences[preference as keyof typeof notificationPreferences] === false) return total;
      return total + Number(count || 0);
    }, 0);
  const totalNotificationUnreadCount = notificationUnreadCount + visibleServerUnreadCount;




  useEffect(() => {
    writeWorkspaceTheme(theme);
  }, [theme]);

  useEffect(() => {
    writeSidebarMode(isCollapsed ? "collapsed" : "expanded");
  }, [isCollapsed]);

  useEffect(() => {
    const syncNotifications = () => setNotificationUnreadCount(getUnreadNotificationCount());

    syncNotifications();
    window.addEventListener(NOTIFICATIONS_UPDATED_EVENT, syncNotifications);
    window.addEventListener("storage", syncNotifications);
    return () => {
      window.removeEventListener(NOTIFICATIONS_UPDATED_EVENT, syncNotifications);
      window.removeEventListener("storage", syncNotifications);
    };
  }, []);

  useEffect(() => {
    const syncPreferences = (event?: Event) => {
      const detail =
        event && "detail" in event
          ? (event as CustomEvent<WorkspacePreferenceUpdate>).detail
          : undefined;
      const nextTheme = detail?.theme || readWorkspaceTheme();
      const nextSidebarMode: SidebarMode = detail?.sidebarMode ?? readSidebarMode();

      if (nextTheme === "light" || nextTheme === "dark") {
        setTheme(nextTheme);
      }

      setIsCollapsed(nextSidebarMode === "collapsed");
    };

    window.addEventListener(PREFERENCES_UPDATED_EVENT, syncPreferences as EventListener);
    window.addEventListener("storage", syncPreferences);

    return () => {
      window.removeEventListener(PREFERENCES_UPDATED_EVENT, syncPreferences as EventListener);
      window.removeEventListener("storage", syncPreferences);
    };
  }, []);

  useEffect(() => {
    const mediaQuery = window.matchMedia(MOBILE_SIDEBAR_BREAKPOINT);

    const syncViewport = (event: MediaQueryList | MediaQueryListEvent) => {
      setIsMobileViewport(event.matches);
    };

    syncViewport(mediaQuery);

    if (typeof mediaQuery.addEventListener === "function") {
      mediaQuery.addEventListener("change", syncViewport);
      return () => mediaQuery.removeEventListener("change", syncViewport);
    }

    mediaQuery.addListener(syncViewport);
    return () => mediaQuery.removeListener(syncViewport);
  }, []);

  useEffect(() => {
    setIsMobileSidebarOpen(false);
  }, [location.hash, location.pathname, location.search]);

  useEffect(() => {
    if (!isMobileViewport) {
      setIsMobileSidebarOpen(false);
    }
  }, [isMobileViewport]);

  const mobileSidebarRef = useDialogFocus<HTMLElement>({
    active: isMobileViewport && isMobileSidebarOpen,
    onClose: () => setIsMobileSidebarOpen(false)
  });

  useEffect(() => {
    if (!projectsQuery.isSuccess) {
      return;
    }

    if (!projects.length) {
      if (sidebarProjectId) {
        setSidebarProjectId("");
      }
      return;
    }

    if (!sidebarProjectId || !projects.some((project) => String(project.id) === String(sidebarProjectId))) {
      setSidebarProjectId(projects[0].id);
    }
  }, [projects, projectsQuery.isSuccess, setSidebarProjectId, sidebarProjectId]);

  const canChangeScope = useCallback(({ projectId }: { projectId: string }) =>
    projects.some(project => String(project.id) === projectId), [projects]);

  const isWorkspaceWideLibrary = WORKSPACE_LIBRARY_PATHS.has(location.pathname);

  const currentSection = useMemo(() => WORKSPACE_PAGE_LABELS[location.pathname] || "Workspace", [location.pathname]);
  const nextSection = WORKSPACE_PAGE_LABELS[routeNavigation.location?.pathname || ""] || "page";
  const isRouteTransitioning = routeNavigation.state === "loading";
  const pageAccess = domainMetadataQuery.data?.access?.pages;
  const canAccessCurrentRoute = canAccessPath(session, location.pathname, pageAccess, sidebarProjectId);
  const currentFeatureKeys = requiredFeatureFlagsForPath(location.pathname);
  const canAccessCurrentFeature = areFeatureFlagsEnabled(
    featureFlagsQuery.data,
    currentFeatureKeys
  );
  const canAccessNavigationFeature = (item: { id: string; featureKeys?: readonly string[]; featureMatch?: "any" }) => {
    const keys = item.featureKeys || [];
    if (item.featureMatch === "any") {
      return Boolean(featureFlagsQuery.data) && keys.some((key) => areFeatureFlagsEnabled(featureFlagsQuery.data, [key]));
    }
    return areFeatureFlagsEnabled(featureFlagsQuery.data, keys);
  };

  const sidebarNavigationRef = useRef<HTMLElement>(null);
  const shouldCollapseSidebar = !isMobileViewport && isCollapsed;
  useLayoutEffect(() => { if (shouldCollapseSidebar && sidebarNavigationRef.current) sidebarNavigationRef.current.scrollTop = 0; }, [shouldCollapseSidebar]);
  const sidebarClassName = `${shouldCollapseSidebar ? "sidebar is-collapsed" : "sidebar"}${isMobileSidebarOpen ? " is-mobile-open" : ""}`;

  useEffect(() => {
    document.documentElement.dataset.sidebar = shouldCollapseSidebar ? "collapsed" : "expanded";
  }, [shouldCollapseSidebar]);

  const toggleSidebarCollapse = () => {
    setIsCollapsed((current) => !current);
  };

  const resolveNavLabel = (item: { id: string; label: string; shortLabel?: string }) => {
    const defaultLabel = getNavigationItemLabel(item, shouldCollapseSidebar);

    switch (item.id) {
      case "overview":
        return t("nav.dashboard", defaultLabel);
      case "projects":
        return t("nav.projects", defaultLabel);
      case "authoring":
        return t("nav.testAuthoring", defaultLabel);
      case "product-management":
        return t("nav.product", defaultLabel);
      case "runs":
        return t("nav.testRuns", defaultLabel);
      case "agentic-workflows":
        return t("nav.agenticWorkflows", defaultLabel);
      case "admin-space":
        return t("nav.adminSpace", defaultLabel);
      case "automation":
        return t("nav.automation", defaultLabel);
      case "testops":
        return t("nav.testops", defaultLabel);
      case "environment":
        return t("nav.testEnvironment", defaultLabel);
      case "people":
        return t("nav.users", defaultLabel);
      case "integrations":
        return t("nav.integrations", defaultLabel);
      case "knowledge":
        return t("nav.knowledge", defaultLabel);
      case "support":
        return t("nav.support", defaultLabel);
      case "notifications":
        return t("nav.notifications", defaultLabel);
      case "settings":
        return t("nav.settings", defaultLabel);
      case "issues":
        return t("nav.reportIssue", defaultLabel);
      default:
        return defaultLabel;
    }
  };

  const resolveSubItemLabel = (subItem: { to: string; label: string }) => {
    const labelKey = WORKSPACE_SECTION_LABEL_KEYS[subItem.to];
    return labelKey ? t(labelKey, subItem.label) : subItem.label;
  };

  const resolveSidebarSubItems = (item: { id: string }) => {
    const items = item.id === "test-plan" ? TEST_PLAN_SECTION_ITEMS : item.id === "overview"
      ? DASHBOARD_SECTION_ITEMS
      : item.id === "product-management"
      ? PRODUCT_MANAGEMENT_SECTION_ITEMS
      : item.id === "authoring"
      ? TEST_AUTHORING_SECTION_ITEMS
      : item.id === "automation"
        ? AUTOMATION_SECTION_ITEMS
        : item.id === "testops"
          ? TESTOPS_SECTION_ITEMS
          : item.id === "environment"
            ? TEST_ENVIRONMENT_SECTION_ITEMS
            : item.id === "runs"
              ? TEST_RUNS_SECTION_ITEMS
              : item.id === "agentic-workflows"
                ? AGENTIC_WORKFLOW_SECTION_ITEMS
                : [];
    return items.filter((subItem) => canAccessPath(session, subItem.to, pageAccess, sidebarProjectId) && areFeatureFlagsEnabled(featureFlagsQuery.data, [...requiredFeatureFlagsForPath(subItem.to), ...(subItem.featureKeys || [])]));
  };

  const activeSubSection = navigation.flatMap(group => group.items.flatMap(item => resolveSidebarSubItems(item)))
    .find(item => isNavigationDestinationActive(item.to, location.pathname, location.search));
  const currentSectionLabel = activeSubSection ? resolveSubItemLabel(activeSubSection)
    : t(WORKSPACE_SECTION_LABEL_KEYS[location.pathname] || "shell.workspace", currentSection);
  const searchShortcut = /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘ K" : "Ctrl K";

  const refreshCurrentScreen = async () => {
    setIsRefreshing(true);
    try {
      // Refetch mounted data without discarding an open editor or unsaved form.
      await queryClient.invalidateQueries({ refetchType: "active" });
    } finally {
      setIsRefreshing(false);
    }
  };
  const prefetchNavigationTarget = (target: string, disabled = false) => {
    if (!disabled) {
      preloadWorkspaceRoute(target);
    }
  };

  return (
    <div className="app-shell app-layout app-layout--workspace-wide workspace-experience-v2">
      <a className="workspace-skip-link" href="#workspace-content" onClick={event => { event.preventDefault(); document.getElementById("workspace-content")?.focus(); }}>{t("shell.skip", "Skip to content")}</a>
      <WorkspaceLocalizationLoader />
      {error && (
        <div className="global-alert" role="alert">
          <p>{error}</p>
          <button 
            className="ghost-button" 
            onClick={clearError}
            aria-label="Dismiss error"
          >
            ✕
          </button>
        </div>
      )}
      {!error && hasNoProjects ? (
        <div className="global-alert" role="status">
          <p>No default HelloTest project is available for your account. Create a project from the Projects page to start working.</p>
          <NavLink className="ghost-button" to="/projects">Create project</NavLink>
        </div>
      ) : null}
      
      <aside ref={mobileSidebarRef} className={sidebarClassName} id="app-sidebar" role={isMobileViewport && isMobileSidebarOpen ? "dialog" : undefined} aria-modal={isMobileViewport && isMobileSidebarOpen ? true : undefined} aria-label={t("shell.navigation", "Navigation")} tabIndex={-1}>
        <div className="sidebar-top">
          <div className="sidebar-brand-row">
            <NavLink className="sidebar-brand-lockup" to="/" aria-label="Go to dashboard">
              <BrandWordmark className="sidebar-brand-mark" variant={shouldCollapseSidebar ? "mark" : "wordmark"} />
            </NavLink>
            {isMobileViewport ? (
              <button
                aria-label={t("shell.closeNavigation", "Close navigation")}
                className="sidebar-mobile-close ghost-button"
                onClick={() => setIsMobileSidebarOpen(false)}
                type="button"
              >
                <CloseIcon />
              </button>
            ) : null}
            {!isMobileViewport ? (
              <button
                aria-label={t(shouldCollapseSidebar ? "shell.expandSidebar" : "shell.collapseSidebar", shouldCollapseSidebar ? "Expand sidebar" : "Collapse sidebar")}
                className="sidebar-collapse-button ghost-button"
                onClick={toggleSidebarCollapse}
                type="button"
              >
                {shouldCollapseSidebar ? <IconLayoutSidebarLeftExpand size={18} /> : <IconLayoutSidebarLeftCollapse size={18} />}
              </button>
            ) : null}
          </div>

          <WorkspaceProjectSwitcher
            canViewApplications={can("app_type.view")}
            accessKey={projectAccessKey}
            isCollapsed={shouldCollapseSidebar}
            isLoadingProjects={projectsQuery.isPending}
            projectsError={projectsQuery.isError}
            onRetryProjects={() => void projectsQuery.refetch()}
            beforeScopeChange={canChangeScope}
            projectId={sidebarProjectId}
            projects={projects}
          />
        </div>

        <nav className="nav-list" aria-label="Main navigation" ref={sidebarNavigationRef}>
          {navigation.map((group) => (
            <div className="nav-group" key={group.label}>
              <div className="nav-group-items">
                {group.items.map((item) => {
                  if (!hasAnyPermission(session, getNavigationItemPermissions(item, pageAccess), sidebarProjectId)) {
                    return null;
                  }

                  if (!canAccessNavigationFeature(item)) {
                    return null;
                  }

                  const Icon = item.icon;
                  const isDisabled = Boolean("disabledWhenNoProjects" in item && item.disabledWhenNoProjects && hasNoProjects);
                  const badgeCount = item.id === "notifications"
                    ? totalNotificationUnreadCount
                    : "countKey" in item
                      ? navCounts[item.countKey as keyof typeof navCounts]
                      : undefined;
                  const isPlanning = location.pathname === "/executions" && new URLSearchParams(location.search).get("view") === "scheduled-runs";
                  const isSharedSectionLibrary = location.pathname === "/shared-steps" && new URLSearchParams(location.search).get("view") === "automation";
                  const isActive = item.id === "automation" && isSharedSectionLibrary ? true : item.id === "authoring" && isSharedSectionLibrary ? false : item.id === "test-plan" ? location.pathname === "/design" || isPlanning : item.id === "runs" ? location.pathname === "/executions" && !isPlanning : isNavigationItemActive(item, location.pathname);
                  const subItems = resolveSidebarSubItems(item);
                  const primaryFeatureEnabled = areFeatureFlagsEnabled(
                    featureFlagsQuery.data,
                    requiredFeatureFlagsForPath(item.to)
                  );
                  if (!subItems.length && (!primaryFeatureEnabled || !canAccessPath(session, item.to, pageAccess, sidebarProjectId))) return null;
                  const navigationTarget = primaryFeatureEnabled && canAccessPath(session, item.to, pageAccess, sidebarProjectId) ? item.to : subItems[0]?.to || item.to;

                  return (
                    <div className="nav-item-stack" key={item.to}>
                      <NavLink
                        aria-disabled={isDisabled || undefined}
                        aria-current={isActive ? "page" : undefined}
                        data-nav-identity={item.id}
                        to={navigationTarget}
                        replace={isActive && `${location.pathname}${location.search}` !== navigationTarget}
                        className={isActive ? "nav-link is-active" : "nav-link"}
                        end={item.to === "/"}
                        title={shouldCollapseSidebar ? resolveNavLabel(item) : undefined}
                        aria-label={resolveNavLabel(item)}
                        onFocus={() => prefetchNavigationTarget(navigationTarget, isDisabled)}
                        onMouseEnter={() => prefetchNavigationTarget(navigationTarget, isDisabled)}
                        onClick={(e) => {
                          if (isDisabled) {
                            e.preventDefault();
                            return;
                          }
                          if (shouldCollapseSidebar && subItems.length) {
                            setIsCollapsed(false);
                          }
                        }}
                        style={{ opacity: isDisabled ? 0.5 : 1, cursor: isDisabled ? "not-allowed" : "pointer" }}
                      >
                        <span className="nav-link-icon" aria-hidden="true">
                          <Icon />
                          {item.id === "notifications" && totalNotificationUnreadCount > 0 ? (
                            <span className="nav-link-icon-badge">{totalNotificationUnreadCount > 99 ? "99+" : totalNotificationUnreadCount}</span>
                          ) : null}
                        </span>
                        <span className="nav-link-label">{resolveNavLabel(item)}</span>
                        {!shouldCollapseSidebar && typeof badgeCount === "number" && badgeCount > 0 ? (
                          <span className={item.id === "notifications" ? "nav-link-badge is-alert" : "nav-link-badge"}>{badgeCount > 99 ? "99+" : badgeCount}</span>
                        ) : null}
                      </NavLink>
                      {!shouldCollapseSidebar && subItems.length && isActive ? (
                        <div className="nav-submenu" aria-label={`${resolveNavLabel(item)} sections`}>
                          {subItems.map((subItem) => {
                            const isSubActive = isNavigationDestinationActive(subItem.to, location.pathname, location.search);
                            const SubIcon = getWorkspaceSubItemIcon("icon" in subItem ? subItem.icon : undefined);

                            return (
                              <NavLink
                                aria-current={isSubActive ? "page" : false}
                                className={isSubActive ? "nav-submenu-link is-active" : "nav-submenu-link"}
                                data-nav-identity={"icon" in subItem ? subItem.icon : "default"}
                                key={subItem.to}
                                onFocus={() => preloadWorkspaceRoute(subItem.to)}
                                onMouseEnter={() => preloadWorkspaceRoute(subItem.to)}
                                to={subItem.to}
                              >
                                <span className="nav-submenu-icon" aria-hidden="true"><SubIcon /></span>
                                {resolveSubItemLabel(subItem)}
                              </NavLink>
                            );
                          })}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        <div className="sidebar-footer">
          <button className="sidebar-signout" onClick={logout} type="button" aria-label={t("shell.signOut", "Sign out")} title={t("shell.signOut", "Sign out")}>
            <LogoutIcon />{!shouldCollapseSidebar && <span>{t("shell.signOut", "Sign out")}</span>}
          </button>
        </div>
      </aside>

      {isMobileViewport ? (
        <button
          aria-label={t("shell.closeNavigation", "Close navigation")}
          aria-hidden={!isMobileSidebarOpen}
          className={isMobileSidebarOpen ? "sidebar-backdrop is-visible" : "sidebar-backdrop"}
          onClick={() => setIsMobileSidebarOpen(false)}
          tabIndex={isMobileSidebarOpen ? 0 : -1}
          type="button"
        />
      ) : null}

      <main
        id="workspace-content"
        tabIndex={-1}
        aria-busy={isRouteTransitioning}
        className={`workspace-main main${isWorkspaceWideLibrary ? " main--library-fill" : ""}`}
        data-route={location.pathname}
        data-section={currentSection}
      >
        <header className="workspace-context-bar">
          <div className="workspace-header-leading">
            {isMobileViewport && <button aria-controls="app-sidebar" aria-expanded={isMobileSidebarOpen} aria-label={t("shell.openNavigation", "Open navigation")} className="workspace-header-icon mobile-sidebar-toggle" onClick={() => setIsMobileSidebarOpen(true)} type="button"><MenuIcon /></button>}
            <div className="workspace-breadcrumb" aria-label={t("shell.currentLocation", "Current location")}>
              <span className="workspace-breadcrumb-project" title={currentProjectName}>{currentProjectName}</span>
              <IconChevronRight size={14} aria-hidden="true" />
              <strong>{currentSectionLabel}</strong>
            </div>
          </div>
          <div className="workspace-context-actions">
            <button className="workspace-search-trigger" type="button" onClick={() => setIsNavigatorOpen(true)} aria-keyshortcuts="Control+k Meta+k" aria-label={t("shell.find", "Find a capability")}><IconSearch size={17} aria-hidden="true"/><span>{t("shell.find", "Find a capability")}</span><kbd>{searchShortcut}</kbd></button>
            <WorkspacePreferencesMenu theme={theme} refreshing={isRefreshing} onThemeChange={() => setTheme(current => current === "light" ? "dark" : "light")} onRegionalPreferences={() => setIsRegionalDialogOpen(true)} onRefresh={() => void refreshCurrentScreen()} />
            <button className="workspace-profile-button" type="button" aria-haspopup="dialog" aria-expanded={isProfileDialogOpen} aria-label={t("shell.profile", "Open your profile")} onClick={() => setIsProfileDialogOpen(true)}>
              <span className="workspace-profile-avatar" aria-hidden="true">{session?.user.avatar_data_url ? <img src={session.user.avatar_data_url} alt=""/> : (session?.user.name || session?.user.email || "QA").split(/\s+/).slice(0, 2).map(part => part[0]).join("").toUpperCase()}</span>
              <span className="workspace-profile-copy"><strong>{session?.user.name || t("shell.user", "Workspace user")}</strong><small>{t(session?.user.role === "admin" ? "shell.admin" : "shell.member", session?.user.role === "admin" ? "Workspace admin" : "Workspace member")}</small></span>
            </button>
          </div>
        </header>
        {!canAccessPath(session, WORKSPACE_ROUTES.projects, pageAccess, sidebarProjectId) ? <ProjectDeletionRecovery /> : null}
        {isRouteTransitioning ? (
          <LoadingState label={`Loading ${nextSection}`} />
        ) : null}
        {featureFlagsQuery.isError && featureFlagsQuery.data ? <div className="workspace-policy-refresh" role="status"><span>{t("access.refreshHelp", "Availability couldn’t be refreshed. Your current work is still here.")}</span><button className="ghost-button" type="button" disabled={featureFlagsQuery.isFetching} onClick={() => void featureFlagsQuery.refetch()}>{t("common.retry", "Retry")}</button></div> : null}
        {!featureFlagsQuery.data && featureFlagsQuery.isFetching && currentFeatureKeys.length ? (
          <WorkspacePageSkeleton label="Loading project capabilities" />
        ) : featureFlagsQuery.isError && !featureFlagsQuery.data && currentFeatureKeys.length ? (
          <section className="workspace-access-state" role="alert"><h1>{t("access.errorTitle", "We couldn’t verify availability")}</h1><p>{t("access.errorHelp", "Workspace capabilities couldn’t be loaded. Retry the connection to continue.")}</p><div className="workspace-access-actions"><button className="primary-button" type="button" disabled={featureFlagsQuery.isFetching} onClick={() => void featureFlagsQuery.refetch()}>{t("common.retry", "Retry")}</button><button className="ghost-button" type="button" onClick={() => setIsNavigatorOpen(true)}>{t("shell.find", "Find a capability")}</button></div></section>
        ) : canAccessCurrentRoute && canAccessCurrentFeature ? (
          <AppErrorBoundary key={location.pathname}>
            <Suspense fallback={<WorkspacePageSkeleton label={`Loading ${currentSection}`} />}>
              <Outlet />
            </Suspense>
          </AppErrorBoundary>
        ) : (
          <section className="workspace-access-state">
            <h1>{canAccessCurrentRoute ? t("access.disabledTitle", "This capability is turned off") : t("access.deniedTitle", "You need access to this area")}</h1>
            <p>{canAccessCurrentRoute ? t("access.disabledHelp", "An administrator can enable this capability. You can continue in another available area.") : t("access.deniedHelp", "Ask an administrator to review your project permissions, or choose another capability.")}</p>
            <div className="workspace-access-actions"><button className="primary-button" type="button" onClick={() => setIsNavigatorOpen(true)}>{t("shell.find", "Find a capability")}</button></div>
          </section>
        )}
      </main>

      <Suspense fallback={null}>{isNavigatorOpen ? <WorkspaceNavigator onClose={() => setIsNavigatorOpen(false)} projectId={sidebarProjectId} projectName={currentProjectName} flags={featureFlagsQuery.data} flagsError={featureFlagsQuery.isError} pageAccess={pageAccess} /> : null}{isRegionalDialogOpen ? <RegionalPreferencesDialog onClose={() => setIsRegionalDialogOpen(false)} /> : null}</Suspense>
      <UserProfileDialog isOpen={isProfileDialogOpen} onClose={() => setIsProfileDialogOpen(false)} />
      {sidebarProjectId && hasAnyPermission(session, ["knowledge.view"], sidebarProjectId) && areFeatureFlagsEnabled(featureFlagsQuery.data, ["hellotest.ai.knowledge", "hellotest.ai.chatbot"]) ? <GroundedAssistant /> : null}
    </div>
  );
}

function IconFrame({ children }: { children: ReactNode }) {
  return <svg aria-hidden="true" fill="none" height="20" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" viewBox="0 0 24 24" width="20">{children}</svg>;
}

function DashboardIcon() {
  return <IconFrame><rect x="2.5" y="3" width="19" height="18" rx="2.5" /><path d="M3 6.5h18" /><circle cx="8.5" cy="14" r="3.5" /><path d="M8.5 10.5V14H12M15 17v-2M18 17v-4M20.5 17v-6" /></IconFrame>;
}

function UsersIcon() {
  return <IconFrame><path d="M16 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2" /><circle cx="9.5" cy="7" r="3.5" /><path d="M20 8.5a3 3 0 0 1 0 5.8" /><path d="M23 21v-2a4 4 0 0 0-3-3.85" /></IconFrame>;
}

function UserIcon() {
  return <IconFrame><path d="M4 21v-1.6A4.4 4.4 0 0 1 8.4 15h7.2A4.4 4.4 0 0 1 20 19.4V21" /><circle cx="12" cy="8.2" r="3.6" /></IconFrame>;
}

function ServerIcon() {
  return <IconFrame><rect x="4" y="4" width="16" height="6" rx="1.5" /><rect x="4" y="14" width="16" height="6" rx="1.5" /><path d="M8 7h.01" /><path d="M8 17h.01" /><path d="M16 7h2" /><path d="M16 17h2" /></IconFrame>;
}

function ChevronIcon() {
  return <IconFrame><path d="m8 10 4 4 4-4" /></IconFrame>;
}

function PlugIcon() {
  return <IconFrame><path d="M8 7v5" /><path d="M16 7v5" /><path d="M7 12h10" /><path d="M12 12v5a3 3 0 0 1-3 3H8" /><path d="M16 20h-1" /></IconFrame>;
}

function FlaskIcon() {
  return <IconFrame><path d="M10 3v5l-5.5 9a2 2 0 0 0 1.73 3h11.54A2 2 0 0 0 19.5 17L14 8V3" /><path d="M8 3h8" /><path d="M8.5 14h7" /></IconFrame>;
}

function ProductManagementIcon() {
  return <svg aria-hidden="true" width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3l8 4.5l0 9l-8 4.5l-8 -4.5l0 -9l8 -4.5" /><path d="M12 12l8 -4.5" /><path d="M12 12l0 9" /><path d="M12 12l-8 -4.5" /></svg>;
}

function LayersIcon() {
  return <IconFrame><path d="m12 4 8 4-8 4-8-4 8-4Z" /><path d="m4 12 8 4 8-4" /><path d="m4 16 8 4 8-4" /></IconFrame>;
}

function SharedStepsIcon() {
  return <IconFrame><circle cx="7" cy="8" r="2.5" /><circle cx="17" cy="8" r="2.5" /><circle cx="12" cy="17" r="2.5" /><path d="m9.2 9.4 2 5.2" /><path d="m14.8 9.4-2 5.2" /><path d="M9.5 8h5" /></IconFrame>;
}

function getWorkspaceSubItemIcon(icon?: string) {
  switch (icon) {
    case "stories":
      return StoryIcon;
    case "backlog":
      return BacklogIcon;
    case "sprint":
      return SprintIcon;
    case "release":
      return ReleaseIcon;
    case "analytics":
      return ActivityIcon;
    case "dashboard":
      return DashboardIcon;
    case "requirements":
      return StoryIcon;
    case "cases":
      return TestCaseIcon;
    case "shared":
      return SharedStepsIcon;
    case "suites":
      return TestSuiteIcon;
    case "executions":
      return RunIcon;
    case "automation":
      return AutomationIcon;
    case "agents":
      return AiAgentsIcon;
    case "repository":
      return LayersIcon;
    case "playwright":
      return PlayIcon;
    case "ops":
      return ActivityIcon;
    case "telemetry":
      return SlidersIcon;
    case "traces":
      return SharedStepsIcon;
    case "environments":
      return ServerIcon;
    case "data":
      return TestDataIcon;
    case "configurations":
      return SlidersIcon;
    default:
      return SubmenuDotIcon;
  }
}

function SubmenuDotIcon() {
  return <IconFrame><circle cx="12" cy="12" r="2.2" fill="currentColor" stroke="none" /></IconFrame>;
}

function PlayIcon() {
  return <IconFrame><path d="m7 4 12 8-12 8z" /></IconFrame>;
}

function RunIcon() {
  return <IconFrame><circle cx="12" cy="12" r="8" /><path d="m10 8 6 4-6 4z" /></IconFrame>;
}

function ActivityIcon() {
  return <IconFrame><path d="M4 12h3l2-6 4 12 2-6h5" /></IconFrame>;
}

function AutomationIcon() {
  return (
    <IconFrame>
      <rect x="6" y="8" width="12" height="10" rx="2.5" />
      <path d="M12 8V5" />
      <path d="M9 5h6" />
      <path d="M9.5 13h.01" />
      <path d="M14.5 13h.01" />
      <path d="M10 16h4" />
      <path d="M4 12h2" />
      <path d="M18 12h2" />
    </IconFrame>
  );
}

function LogoutIcon() {
  return <IconFrame><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="m16 17 5-5-5-5" /><path d="M21 12H9" /></IconFrame>;
}

function BugIcon() {
  return (
    <IconFrame>
      <path d="M8 7.5V7a4 4 0 0 1 8 0v.5" />
      <rect x="7" y="7.5" width="10" height="12" rx="5" />
      <path d="M12 11v8" />
      <path d="m8.5 4-2-2" />
      <path d="m15.5 4 2-2" />
      <path d="M4 12h3" />
      <path d="M17 12h3" />
      <path d="m5 17 2.4-1.2" />
      <path d="m18.6 15.8 2.4 1.2" />
      <path d="m5 7.5 2.3 1.2" />
      <path d="m16.7 8.7 2.3-1.2" />
    </IconFrame>
  );
}

function BellIcon() {
  return <IconFrame><path d="M15 17H5l1.4-1.4A2 2 0 0 0 7 14.2V11a5 5 0 0 1 10 0v3.2a2 2 0 0 0 .6 1.4L19 17h-4" /><path d="M10 20a2 2 0 0 0 4 0" /></IconFrame>;
}

function CogIcon() {
  return <IconFrame><circle cx="12" cy="12" r="3.2" /><path d="M19.4 15a1 1 0 0 0 .2 1.1l.1.1a2 2 0 0 1-2.8 2.8l-.1-.1a1 1 0 0 0-1.1-.2 1 1 0 0 0-.6.9V20a2 2 0 0 1-4 0v-.2a1 1 0 0 0-.6-.9 1 1 0 0 0-1.1.2l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1 1 0 0 0 .2-1.1 1 1 0 0 0-.9-.6H4a2 2 0 0 1 0-4h.2a1 1 0 0 0 .9-.6 1 1 0 0 0-.2-1.1l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1 1 0 0 0 1.1.2 1 1 0 0 0 .6-.9V4a2 2 0 0 1 4 0v.2a1 1 0 0 0 .6.9 1 1 0 0 0 1.1-.2l.1-.1a2 2 0 0 1 2.8 2.8l-.1.1a1 1 0 0 0-.2 1.1 1 1 0 0 0 .9.6h.2a2 2 0 0 1 0 4h-.2a1 1 0 0 0-.9.6" /></IconFrame>;
}

function SlidersIcon() {
  return <IconFrame><path d="M4 6h6" /><path d="M14 6h6" /><path d="M10 6a2 2 0 1 0 4 0 2 2 0 0 0-4 0Z" /><path d="M4 12h10" /><path d="M18 12h2" /><path d="M14 12a2 2 0 1 0 4 0 2 2 0 0 0-4 0Z" /><path d="M4 18h3" /><path d="M11 18h9" /><path d="M7 18a2 2 0 1 0 4 0 2 2 0 0 0-4 0Z" /></IconFrame>;
}

function SupportIcon() {
  return <IconFrame><path d="M9.1 9a3 3 0 1 1 5.8 1c-.5 1.2-1.6 1.7-2.4 2.3-.6.5-1 1-1 1.7" /><circle cx="12" cy="18" r="1" /><path d="M20 12a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z" /></IconFrame>;
}

function MenuIcon() {
  return <IconFrame><path d="M4 7h16" /><path d="M4 12h16" /><path d="M4 17h16" /></IconFrame>;
}

function CloseIcon() {
  return <IconFrame><path d="m6 6 12 12" /><path d="M18 6 6 18" /></IconFrame>;
}

function SunIcon() {
  return <IconFrame><circle cx="12" cy="12" r="4" /><path d="M12 2.5v2.5" /><path d="M12 19v2.5" /><path d="m4.93 4.93 1.77 1.77" /><path d="m17.3 17.3 1.77 1.77" /><path d="M2.5 12H5" /><path d="M19 12h2.5" /><path d="m4.93 19.07 1.77-1.77" /><path d="m17.3 6.7 1.77-1.77" /></IconFrame>;
}

function MoonIcon() {
  return <IconFrame><path d="M20 14.5A8.5 8.5 0 1 1 9.5 4 6.8 6.8 0 0 0 20 14.5z" /></IconFrame>;
}
