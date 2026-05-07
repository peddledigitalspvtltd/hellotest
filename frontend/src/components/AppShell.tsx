import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "../auth/AuthContext";
import { useLocalization } from "../context/LocalizationContext";
import { ProjectDropdown } from "./ProjectDropdown";
import { UserProfileDialog } from "./UserProfileDialog";
import { useCurrentProject } from "../hooks/useCurrentProject";
import { api } from "../lib/api";
import {
  TEST_AUTHORING_SECTION_ITEMS,
  TEST_ENVIRONMENT_SECTION_ITEMS,
  WORKSPACE_LIBRARY_PATHS,
  WORKSPACE_PAGE_LABELS
} from "../lib/workspaceSections";

const THEME_KEY = "app_theme";
const SIDEBAR_KEY = "sidebar_collapsed";
const MOBILE_SIDEBAR_BREAKPOINT = "(max-width: 768px)";
const PREFERENCES_UPDATED_EVENT = "qaira:preferences-updated";

const navigation = [
  {
    label: "Main",
    items: [
      { id: "overview", to: "/", label: "Dashboard", shortLabel: "Home", icon: DashboardIcon },
      { id: "projects", to: "/projects", label: "Projects", shortLabel: "Projects", icon: FolderIcon, countKey: "projects" }
    ]
  },
  {
    label: "Test Management",
    items: [
      {
        id: "authoring",
        to: "/test-cases",
        label: "Test Authoring",
        shortLabel: "Authoring",
        icon: FlaskIcon,
        subItems: TEST_AUTHORING_SECTION_ITEMS,
        matchPaths: TEST_AUTHORING_SECTION_ITEMS.map((item) => item.to),
        disabledWhenNoProjects: true
      },
      {
        id: "runs",
        to: "/executions",
        label: "Test Runs",
        shortLabel: "Runs",
        icon: PlayIcon,
        subItems: [{ to: "/executions", label: "Run Console", shortLabel: "Console", icon: "executions" }],
        matchPaths: ["/executions"],
        disabledWhenNoProjects: true
      },
      {
        id: "testops",
        to: "/testops",
        label: "TestOps",
        shortLabel: "Ops",
        icon: ActivityIcon,
        disabledWhenNoProjects: true
      },
      {
        id: "environment",
        to: "/test-environments",
        label: "Test Environment",
        shortLabel: "Environment",
        icon: ServerIcon,
        subItems: TEST_ENVIRONMENT_SECTION_ITEMS,
        matchPaths: TEST_ENVIRONMENT_SECTION_ITEMS.map((item) => item.to),
        disabledWhenNoProjects: true
      }
    ]
  },
  {
    label: "Administration",
    items: [
      { id: "people", to: "/people", label: "Users", shortLabel: "Users", icon: UsersIcon },
      { id: "integrations", to: "/integrations", label: "Integrations", shortLabel: "Connect", icon: PlugIcon },
      { id: "knowledge", to: "/knowledge-repo", label: "AI Knowledge", shortLabel: "Knowledge", icon: DocumentIcon }
    ]
  },
  {
    label: "Settings",
    items: [
      { id: "notifications", to: "/notifications", label: "Notifications", shortLabel: "Alerts", icon: BellIcon },
      { id: "settings", to: "/settings", label: "Settings", shortLabel: "Settings", icon: CogIcon },
      { id: "support", to: "/support", label: "Support", shortLabel: "Support", icon: SupportIcon },
      { id: "feedback", to: "/feedback", label: "Reporting & Feedback", shortLabel: "Feedback", icon: ChatIcon }
    ]
  }
] as const;

function isNavigationItemActive(item: { to: string; matchPaths?: readonly string[] }, pathname: string) {
  if (item.to === "/") {
    return pathname === "/";
  }

  if (pathname === item.to) {
    return true;
  }

  return Boolean(item.matchPaths?.includes(pathname));
}

function getNavigationItemLabel(item: { label: string; shortLabel?: string }, shouldCollapseSidebar: boolean) {
  return shouldCollapseSidebar ? item.shortLabel || item.label : item.label;
}

export function AppShell() {
  const location = useLocation();
  const { session, logout, error, clearError } = useAuth();
  const { t } = useLocalization();
  const projectsQuery = useQuery({
    queryKey: ["projects"],
    queryFn: api.projects.list,
    retry: 1,
    staleTime: 60 * 1000
  });
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    const stored = window.localStorage.getItem(THEME_KEY);

    if (stored === "dark" || stored === "light") {
      return stored;
    }

    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  });
  const [isCollapsed, setIsCollapsed] = useState(() => {
    const stored = window.localStorage.getItem(SIDEBAR_KEY);
    return stored === null ? true : stored === "true";
  });
  const [isMobileViewport, setIsMobileViewport] = useState(() => window.matchMedia(MOBILE_SIDEBAR_BREAKPOINT).matches);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [isProfileDialogOpen, setIsProfileDialogOpen] = useState(false);
  const [sidebarProjectId, setSidebarProjectId] = useCurrentProject();

  const projects = projectsQuery.data || [];
  const hasNoProjects = !projectsQuery.isPending && projects.length === 0;
  const currentProjectName =
    projects.find((project) => String(project.id) === String(sidebarProjectId))?.name ||
    (hasNoProjects ? "No active project" : "Select a project");
  const navCounts = {
    projects: projects.length
  };

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem(THEME_KEY, theme);
  }, [theme]);

  useEffect(() => {
    window.localStorage.setItem(SIDEBAR_KEY, String(isCollapsed));
  }, [isCollapsed]);

  useEffect(() => {
    const syncPreferences = (event?: Event) => {
      const detail =
        event && "detail" in event
          ? (event as CustomEvent<{ theme?: "light" | "dark"; sidebarMode?: "expanded" | "collapsed" }>).detail
          : undefined;
      const nextTheme = detail?.theme || window.localStorage.getItem(THEME_KEY);
      const nextSidebarMode =
        detail?.sidebarMode ??
        (window.localStorage.getItem(SIDEBAR_KEY) === "false" ? "expanded" : "collapsed");

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
  }, [location.pathname]);

  useEffect(() => {
    if (!isMobileViewport) {
      setIsMobileSidebarOpen(false);
    }
  }, [isMobileViewport]);

  useEffect(() => {
    if (!isMobileSidebarOpen) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsMobileSidebarOpen(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isMobileSidebarOpen]);

  useEffect(() => {
    if (!isMobileViewport || !isMobileSidebarOpen) {
      document.body.style.overflow = "";
      return;
    }

    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, [isMobileSidebarOpen, isMobileViewport]);

  useEffect(() => {
    if (projectsQuery.isPending) {
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
  }, [projects, projectsQuery.isPending, setSidebarProjectId, sidebarProjectId]);

  const isWorkspaceWideLibrary = WORKSPACE_LIBRARY_PATHS.has(location.pathname);

  const currentSection = useMemo(() => WORKSPACE_PAGE_LABELS[location.pathname] || "Workspace", [location.pathname]);

  const shouldCollapseSidebar = !isMobileViewport && isCollapsed;
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
      case "runs":
        return t("nav.testRuns", defaultLabel);
      case "testops":
        return defaultLabel;
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
      case "feedback":
        return t("nav.feedback", defaultLabel);
      default:
        return defaultLabel;
    }
  };

  return (
    <div className="app-shell app-layout app-layout--workspace-wide">
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
          <p>No default QAira project is available for your account. Create a project from the Projects page to start working.</p>
          <NavLink className="ghost-button" to="/projects">Create project</NavLink>
        </div>
      ) : null}
      
      <aside className={sidebarClassName} id="app-sidebar" role="navigation">
        <div className="sidebar-top">
          <div className="sidebar-brand-row">
            <div className="sidebar-brand-lockup">
              <div
                aria-label="QAIra Home"
                className="brand-mark"
                title={shouldCollapseSidebar ? "QAIra Home" : undefined}
              >
                {shouldCollapseSidebar ? "Q" : "QAIra"}
              </div>
              {!shouldCollapseSidebar ? (
                <div className="brand-copy">
                  <strong>QAIra</strong>
                  <span>Workspace</span>
                </div>
              ) : null}
            </div>
            {isMobileViewport ? (
              <button
                aria-label="Close navigation"
                className="sidebar-mobile-close ghost-button"
                onClick={() => setIsMobileSidebarOpen(false)}
                type="button"
              >
                <CloseIcon />
              </button>
            ) : null}
            {!shouldCollapseSidebar && !isMobileViewport ? (
              <button
                aria-label={shouldCollapseSidebar ? "Expand sidebar" : "Collapse sidebar"}
                className="sidebar-collapse-button ghost-button"
                onClick={toggleSidebarCollapse}
                type="button"
              >
                <MenuIcon />
              </button>
            ) : null}
          </div>

          {shouldCollapseSidebar ? (
          <button
            aria-label="Expand sidebar"
            className="sidebar-collapse-button sidebar-collapse-button-compact ghost-button"
            onClick={toggleSidebarCollapse}
            title="Expand sidebar"
            type="button"
          >
            <MenuIcon />
          </button>
          ) : null}

          {!shouldCollapseSidebar ? (
            hasNoProjects ? (
              <div className="sidebar-notice">
                <p>No projects assigned yet.</p>
                <p className="text-muted">Ask an admin to add you to a project.</p>
              </div>
            ) : (
              <div className="sidebar-project-picker">
                <span>Current Project</span>
                <ProjectDropdown
                  ariaLabel="Select a project"
                  onChange={setSidebarProjectId}
                  projects={projects}
                  value={sidebarProjectId}
                />
              </div>
            )
          ) : null}

          {!shouldCollapseSidebar ? (
            <div className="sidebar-context-card" aria-label="Current workspace context">
              <span className="sidebar-context-kicker">Current Workspace</span>
              <strong>{currentSection}</strong>
              <span>{currentProjectName}</span>
            </div>
          ) : null}
        </div>

        <nav className="nav-list" aria-label="Main navigation">
          {navigation.map((group) => (
            <div className="nav-group" key={group.label}>
              {!shouldCollapseSidebar ? (
                <p className="nav-group-label">
                  {group.label === "Main"
                    ? t("nav.section.main", group.label)
                    : group.label === "Test Management"
                      ? t("nav.section.testManagement", group.label)
                      : group.label === "Administration"
                        ? t("nav.section.administration", group.label)
                        : t("nav.section.settings", group.label)}
                </p>
              ) : null}
              <div className="nav-group-items">
                {group.items.map((item) => {
                  const Icon = item.icon;
                  const isDisabled = Boolean("disabledWhenNoProjects" in item && item.disabledWhenNoProjects && hasNoProjects);
                  const badgeCount = "countKey" in item ? navCounts[item.countKey as keyof typeof navCounts] : undefined;
                  const isActive = isNavigationItemActive(item, location.pathname);
                  const subItems = "subItems" in item ? item.subItems : undefined;

                  return (
                    <div className="nav-item-stack" key={item.to}>
                      <NavLink
                        aria-current={isActive ? "page" : undefined}
                        to={item.to}
                        className={isActive ? "nav-link is-active" : "nav-link"}
                        end={item.to === "/"}
                        title={shouldCollapseSidebar ? resolveNavLabel(item) : undefined}
                        aria-label={resolveNavLabel(item)}
                        onClick={(e) => {
                          if (isDisabled) {
                            e.preventDefault();
                          }
                        }}
                        style={{ opacity: isDisabled ? 0.5 : 1, cursor: isDisabled ? "not-allowed" : "pointer" }}
                      >
                        <span className="nav-link-icon" aria-hidden="true"><Icon /></span>
                        <span className="nav-link-label">{resolveNavLabel(item)}</span>
                        {!shouldCollapseSidebar && typeof badgeCount === "number" ? <span className="nav-link-badge">{badgeCount}</span> : null}
                      </NavLink>

                      {!shouldCollapseSidebar && subItems?.length ? (
                        <div className="nav-subgroup">
                          {subItems.map((subItem) => {
                            const isSubItemActive = location.pathname === subItem.to;
                            const SubItemIcon = getWorkspaceSubItemIcon(subItem.icon);

                            return (
                              <NavLink
                                aria-current={isSubItemActive ? "page" : undefined}
                                className={isSubItemActive ? "nav-sublink is-active" : "nav-sublink"}
                                key={subItem.to}
                                to={subItem.to}
                              >
                                <span className="nav-sublink-icon" aria-hidden="true">
                                  <SubItemIcon />
                                </span>
                                <span className="nav-sublink-label">
                                  {subItem.to === "/requirements"
                                    ? t("workspace.requirements", subItem.label)
                                    : subItem.to === "/test-cases"
                                      ? t("workspace.testCases", subItem.label)
                                      : subItem.to === "/shared-steps"
                                        ? t("workspace.sharedSteps", subItem.label)
                                        : subItem.to === "/design"
                                          ? t("workspace.testSuites", subItem.label)
                                          : subItem.to === "/executions"
                                            ? t("workspace.executions", subItem.label)
                                            : subItem.to === "/test-environments"
                                              ? t("workspace.environments", subItem.label)
                                              : subItem.to === "/test-data"
                                                ? t("workspace.testData", subItem.label)
                                                : subItem.to === "/test-configurations"
                                                  ? t("workspace.configurations", subItem.label)
                                                  : subItem.label}
                                </span>
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
          {!shouldCollapseSidebar ? (
            <div className="theme-toggle">
              <div>
                <strong>Theme</strong>
                <span>{theme === "light" ? "Light mode" : "Dark mode"}</span>
              </div>
              <button
                aria-label="Toggle theme"
                className={theme === "dark" ? "theme-switch is-dark" : "theme-switch"}
                onClick={() => setTheme((current) => current === "light" ? "dark" : "light")}
                type="button"
              >
                <span />
              </button>
            </div>
          ) : (
            <button
              aria-label="Toggle theme"
              className={theme === "dark" ? "sidebar-icon-button is-dark" : "sidebar-icon-button"}
              onClick={() => setTheme((current) => current === "light" ? "dark" : "light")}
              title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
              type="button"
            >
              {theme === "dark" ? <MoonIcon /> : <SunIcon />}
            </button>
          )}

          <button
            aria-expanded={isProfileDialogOpen}
            aria-haspopup="dialog"
            aria-label="Open your profile"
            className="user-chip user-chip-button"
            onClick={() => setIsProfileDialogOpen(true)}
            title={shouldCollapseSidebar ? (session?.user.name || "Workspace user") : undefined}
            type="button"
          >
            <div className="user-chip-head">
              <span className="user-chip-icon" aria-hidden="true">
                {session?.user.avatar_data_url ? <img alt="" className="user-chip-avatar" src={session.user.avatar_data_url} /> : <UserIcon />}
              </span>
              <div className="user-chip-copy">
                <strong>{session?.user.name || "Workspace User"}</strong>
                {!shouldCollapseSidebar ? (
                  <>
                    <span>{session?.user.email}</span>
                    <span>{session?.user.role === "admin" ? "Admin" : "Member"}</span>
                  </>
                ) : null}
              </div>
            </div>
          </button>

          <button 
            className="ghost-button sidebar-signout" 
            onClick={logout} 
            type="button"
            aria-label="Sign out"
            title={shouldCollapseSidebar ? "Sign out" : undefined}
          >
            <LogoutIcon />
            {shouldCollapseSidebar ? null : <span>Sign out</span>}
          </button>
        </div>
      </aside>

      {isMobileViewport ? (
        <button
          aria-hidden={!isMobileSidebarOpen}
          className={isMobileSidebarOpen ? "sidebar-backdrop is-visible" : "sidebar-backdrop"}
          onClick={() => setIsMobileSidebarOpen(false)}
          tabIndex={isMobileSidebarOpen ? 0 : -1}
          type="button"
        />
      ) : null}

      <main
        className={`workspace-main main${isWorkspaceWideLibrary ? " main--library-fill" : ""}`}
        data-route={location.pathname}
        data-section={currentSection}
      >
        {isMobileViewport ? (
          <div className="mobile-sidebar-bar">
            <button
              aria-controls="app-sidebar"
              aria-expanded={isMobileSidebarOpen}
              className="mobile-sidebar-toggle ghost-button"
              onClick={() => setIsMobileSidebarOpen(true)}
              type="button"
            >
              <MenuIcon />
              <span>Navigation</span>
            </button>
            <div className="mobile-sidebar-copy">
              <span className="mobile-sidebar-section">{currentSection}</span>
              <span className="mobile-sidebar-context">{currentProjectName}</span>
            </div>
          </div>
        ) : null}
        <Outlet />
      </main>

      <UserProfileDialog isOpen={isProfileDialogOpen} onClose={() => setIsProfileDialogOpen(false)} />
    </div>
  );
}

function IconFrame({ children }: { children: ReactNode }) {
  return <svg aria-hidden="true" fill="none" height="20" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" viewBox="0 0 24 24" width="20">{children}</svg>;
}

function DashboardIcon() {
  return <IconFrame><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></IconFrame>;
}

function UsersIcon() {
  return <IconFrame><path d="M16 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2" /><circle cx="9.5" cy="7" r="3.5" /><path d="M20 8.5a3 3 0 0 1 0 5.8" /><path d="M23 21v-2a4 4 0 0 0-3-3.85" /></IconFrame>;
}

function UserIcon() {
  return <IconFrame><path d="M4 21v-1.6A4.4 4.4 0 0 1 8.4 15h7.2A4.4 4.4 0 0 1 20 19.4V21" /><circle cx="12" cy="8.2" r="3.6" /></IconFrame>;
}

function FolderIcon() {
  return <IconFrame><path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H10l2 2h6.5A2.5 2.5 0 0 1 21 9.5v9A2.5 2.5 0 0 1 18.5 21h-13A2.5 2.5 0 0 1 3 18.5z" /><path d="M9 12v5" /><path d="M13 14v3" /></IconFrame>;
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

function DocumentIcon() {
  return <IconFrame><path d="M7 3h7l5 5v13H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" /><path d="M14 3v6h6" /><path d="M9 13h6" /><path d="M9 17h6" /></IconFrame>;
}

function PencilIcon() {
  return <IconFrame><path d="M4 20l4.5-1 9-9-3.5-3.5-9 9z" /><path d="M13.5 6.5l3.5 3.5" /></IconFrame>;
}

function LayersIcon() {
  return <IconFrame><path d="m12 4 8 4-8 4-8-4 8-4Z" /><path d="m4 12 8 4 8-4" /><path d="m4 16 8 4 8-4" /></IconFrame>;
}

function SharedStepsIcon() {
  return <IconFrame><circle cx="7" cy="8" r="2.5" /><circle cx="17" cy="8" r="2.5" /><circle cx="12" cy="17" r="2.5" /><path d="m9.2 9.4 2 5.2" /><path d="m14.8 9.4-2 5.2" /><path d="M9.5 8h5" /></IconFrame>;
}

function getWorkspaceSubItemIcon(icon?: string) {
  switch (icon) {
    case "requirements":
      return DocumentIcon;
    case "cases":
      return PencilIcon;
    case "shared":
      return SharedStepsIcon;
    case "suites":
      return LayersIcon;
    case "executions":
      return RunIcon;
    case "environments":
      return ServerIcon;
    case "data":
      return DatabaseIcon;
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

function LogoutIcon() {
  return <IconFrame><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="m16 17 5-5-5-5" /><path d="M21 12H9" /></IconFrame>;
}

function ChatIcon() {
  return <IconFrame><path d="M21 15a2 2 0 0 1-2 2H8l-5 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /><path d="M8 9h8" /><path d="M8 13h5" /></IconFrame>;
}

function BellIcon() {
  return <IconFrame><path d="M15 17H5l1.4-1.4A2 2 0 0 0 7 14.2V11a5 5 0 0 1 10 0v3.2a2 2 0 0 0 .6 1.4L19 17h-4" /><path d="M10 20a2 2 0 0 0 4 0" /></IconFrame>;
}

function CogIcon() {
  return <IconFrame><circle cx="12" cy="12" r="3.2" /><path d="M19.4 15a1 1 0 0 0 .2 1.1l.1.1a2 2 0 0 1-2.8 2.8l-.1-.1a1 1 0 0 0-1.1-.2 1 1 0 0 0-.6.9V20a2 2 0 0 1-4 0v-.2a1 1 0 0 0-.6-.9 1 1 0 0 0-1.1.2l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1 1 0 0 0 .2-1.1 1 1 0 0 0-.9-.6H4a2 2 0 0 1 0-4h.2a1 1 0 0 0 .9-.6 1 1 0 0 0-.2-1.1l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1 1 0 0 0 1.1.2 1 1 0 0 0 .6-.9V4a2 2 0 0 1 4 0v.2a1 1 0 0 0 .6.9 1 1 0 0 0 1.1-.2l.1-.1a2 2 0 0 1 2.8 2.8l-.1.1a1 1 0 0 0-.2 1.1 1 1 0 0 0 .9.6h.2a2 2 0 0 1 0 4h-.2a1 1 0 0 0-.9.6" /></IconFrame>;
}

function DatabaseIcon() {
  return <IconFrame><ellipse cx="12" cy="6" rx="7" ry="3" /><path d="M5 6v6c0 1.66 3.13 3 7 3s7-1.34 7-3V6" /><path d="M5 12v6c0 1.66 3.13 3 7 3s7-1.34 7-3v-6" /></IconFrame>;
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
