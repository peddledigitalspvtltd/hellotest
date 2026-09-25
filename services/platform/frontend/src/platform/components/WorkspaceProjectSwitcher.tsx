import { LoadingState } from "../../shared/components/LoadingState";
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { useQuery } from "@tanstack/react-query";
import { IconAlertCircle, IconApps, IconCheck, IconChevronDown, IconFolder, IconSearch, IconX } from "@tabler/icons-react";
import { useLocalization } from "../../context/LocalizationContext";
import { setCurrentScope, useCurrentAppType } from "../hooks/useCurrentProject";
import { api } from "../../lib/api";
import { queryKeys } from "../lib/queryKeys";
import { optionalQueryView } from "../../shared/lib/optionalQueryView";
import { SWITCHER_MESSAGES, type SwitcherMessage } from "../lib/switcherMessages";
import { applicationsForWorkspace, availableWorkspaceProjects, filterWorkspaceOptions, workspaceMenuPosition, type WorkspaceScopeSelection } from "../lib/workspaceSwitcher";
import type { AppType, WorkspaceProjectScope } from "../../types";
import "./workspace-project-switcher.css";

export type WorkspaceProjectSwitcherProps = {
  projects: WorkspaceProjectScope[];
  projectId: string;
  /** Stable authenticated identity + effective grants, shared with project catalog. */
  accessKey: string;
  isCollapsed?: boolean;
  isLoadingProjects?: boolean;
  projectsError?: boolean;
  canViewApplications?: boolean;
  onRetryProjects?: () => void;
  /** Pure navigation/access check. The switcher commits scope only after approval. */
  beforeScopeChange?: (next: WorkspaceScopeSelection) => boolean | Promise<boolean>;
};

type Menu = "project" | "application";

export function WorkspaceProjectSwitcher({ projects, projectId, accessKey, isCollapsed = false, isLoadingProjects = false, projectsError = false, canViewApplications = true, onRetryProjects, beforeScopeChange }: WorkspaceProjectSwitcherProps) {
  const { t } = useLocalization();
  const copy = (key: SwitcherMessage, values?: Record<string, string | number>) => t(`switcher.${key}`, SWITCHER_MESSAGES[`switcher.${key}`], values);
  const id = useId();
  const [appTypeId] = useCurrentAppType(projectId);
  const accessibleProjects = useMemo(() => availableWorkspaceProjects(projects), [projects]);
  const currentProject = accessibleProjects.find((project) => String(project.id) === projectId);
  const canLoadApplications = Boolean(currentProject && canViewApplications);
  const applicationsQuery = optionalQueryView(useQuery({
    queryKey: [...queryKeys.appTypes(projectId), "workspace-access", accessKey],
    queryFn: ({ signal }) => api.appTypes.list({ project_id: projectId }, { signal }),
    enabled: canLoadApplications,
    staleTime: 60_000,
    retry: 1,
    // Never inherit a previous project's placeholder catalog from query defaults.
    placeholderData: undefined,
  }), canLoadApplications);
  const applications = useMemo(() => currentProject ? applicationsForWorkspace(projectId, applicationsQuery.data) : [], [projectId, applicationsQuery.data, Boolean(currentProject)]);
  const currentApplication = applications.find((app) => String(app.id) === appTypeId);
  const [menu, setMenu] = useState<Menu | null>(null);
  const [search, setSearch] = useState("");
  const [switching, setSwitching] = useState(false);
  const [selectionError, setSelectionError] = useState<SwitcherMessage | null>(null);
  const [position, setPosition] = useState<ReturnType<typeof workspaceMenuPosition> | null>(null);
  const triggers = useRef<Record<Menu, HTMLButtonElement | null>>({ project: null, application: null });
  const popup = useRef<HTMLDivElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const busy = useRef(false);
  const mounted = useRef(true);
  const scopeRevision = useRef(0);
  const liveScope = useRef({ projectId, accessKey, accessibleProjects, applications });
  liveScope.current = { projectId, accessKey, accessibleProjects, applications };

  const loading = menu === "project" ? isLoadingProjects : Boolean(currentProject) && applicationsQuery.isPending;
  const loadError = menu === "project" ? projectsError : Boolean(currentProject) && applicationsQuery.isError;
  const options = menu === "project" ? accessibleProjects : applications;
  const filteredOptions = useMemo(() => filterWorkspaceOptions<AppType | WorkspaceProjectScope>(options, search), [options, search]);
  const selectedId = menu === "project" ? projectId : appTypeId;
  const searchable = options.length > 7 && !loading && !loadError;
  const listId = `${id}-${menu || "project"}-options`;

  const closeMenu = (restoreFocus = false) => {
    if (restoreFocus && menu) triggers.current[menu]?.focus();
    setMenu(null);
    setSearch("");
    setSelectionError(null);
  };
  const openMenu = (nextMenu: Menu) => {
    if (busy.current) return;
    if (menu === nextMenu) { closeMenu(); return; }
    setSearch("");
    setSelectionError(null);
    setPosition(null);
    setMenu(nextMenu);
  };

  useEffect(() => {
    mounted.current = true;
    // Storage changes can arrive before React renders the new hook value. A
    // synchronous revision prevents an awaited guard overwriting that change.
    const invalidatePendingSelection = () => {
      scopeRevision.current += 1;
      setMenu(null);
      setSearch("");
      setSelectionError(null);
    };
    const onStorage = (event: StorageEvent) => {
      if (!event.key || ["hellotest.current_project_id", "hellotest.current_app_type_by_project"].includes(event.key)) invalidatePendingSelection();
    };
    window.addEventListener("hellotest:current-project-change", invalidatePendingSelection);
    window.addEventListener("hellotest:current-app-type-change", invalidatePendingSelection);
    window.addEventListener("storage", onStorage);
    return () => {
      mounted.current = false;
      window.removeEventListener("hellotest:current-project-change", invalidatePendingSelection);
      window.removeEventListener("hellotest:current-app-type-change", invalidatePendingSelection);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  useEffect(() => {
    // A change from another tab or page invalidates an open child menu.
    setMenu(null);
    setSearch("");
    setSelectionError(null);
  }, [projectId, accessKey]);

  useLayoutEffect(() => {
    if (!menu) return;
    const updatePosition = () => {
      const trigger = triggers.current[menu];
      const anchor = trigger?.getBoundingClientRect();
      if (!trigger || !anchor) return;
      const viewport = window.visualViewport;
      if (getComputedStyle(trigger).visibility === "hidden" || anchor.right <= (viewport?.offsetLeft || 0) || anchor.left >= (viewport?.offsetLeft || 0) + (viewport?.width || window.innerWidth)) {
        setMenu(null);
        return;
      }
      setPosition(workspaceMenuPosition(anchor, {
        width: viewport?.width || window.innerWidth, height: viewport?.height || window.innerHeight,
        left: viewport?.offsetLeft || 0, top: viewport?.offsetTop || 0,
      }, isCollapsed));
    };
    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    window.visualViewport?.addEventListener("resize", updatePosition);
    window.visualViewport?.addEventListener("scroll", updatePosition);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
      window.visualViewport?.removeEventListener("resize", updatePosition);
      window.visualViewport?.removeEventListener("scroll", updatePosition);
    };
  }, [menu, isCollapsed]);

  useEffect(() => {
    if (!menu) return;
    const contains = (target: EventTarget | null) => target instanceof Node && (popup.current?.contains(target) || Object.values(triggers.current).some((trigger) => trigger?.contains(target)));
    const outside = (event: Event) => { if (!contains(event.target)) closeMenu(); };
    const escape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); closeMenu(true); }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("focusin", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("focusin", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [menu]);

  useEffect(() => {
    if (!menu || !position) return;
    // Initial focus follows the current selection; catalogs arriving later do
    // not steal focus from the search field or a recovery action.
    if (popup.current?.contains(document.activeElement)) return;
    const target = searchInput.current || popup.current?.querySelector<HTMLButtonElement>('[role="option"][aria-selected="true"]') || popup.current?.querySelector<HTMLButtonElement>('[role="option"]') || popup.current;
    target?.focus({ preventScroll: true });
  }, [menu, Boolean(position)]);

  const moveThroughOptions = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "Tab") { closeMenu(true); return; }
    const fromSearch = event.target === searchInput.current;
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key) || (fromSearch && ["Home", "End"].includes(event.key))) return;
    const items = [...(popup.current?.querySelectorAll<HTMLButtonElement>('[role="option"]:not(:disabled)') || [])];
    if (!items.length) return;
    event.preventDefault();
    const current = items.findIndex((item) => item === document.activeElement);
    const index = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : event.key === "ArrowDown" ? (current + 1) % items.length : (current <= 0 ? items.length : current) - 1;
    items[index].focus({ preventScroll: true });
    items[index].scrollIntoView({ block: "nearest" });
  };

  const choose = async (targetId: string) => {
    if (!menu || busy.current) return;
    const origin = projectId;
    const revision = scopeRevision.current;
    const next: WorkspaceScopeSelection = menu === "project" ? { projectId: targetId } : { projectId, appTypeId: targetId };
    if (targetId === selectedId) { closeMenu(true); return; }
    busy.current = true;
    setSwitching(true);
    setSelectionError(null);
    try {
      const approved = beforeScopeChange ? await beforeScopeChange(next) : true;
      if (!mounted.current || !approved || scopeRevision.current !== revision || liveScope.current.projectId !== origin || liveScope.current.accessKey !== accessKey) return;
      const projectExists = liveScope.current.accessibleProjects.some((project) => String(project.id) === next.projectId);
      const applicationExists = !next.appTypeId || liveScope.current.applications.some((app) => String(app.id) === next.appTypeId && String(app.project_id) === next.projectId);
      if (!projectExists || !applicationExists) { setSelectionError("selectionUnavailable"); return; }
      // Project-only switches restore that project's own remembered child scope.
      setCurrentScope(next.projectId, next.appTypeId);
      closeMenu(true);
    } catch {
      if (mounted.current && liveScope.current.projectId === origin) setSelectionError("switchError");
    } finally {
      busy.current = false;
      if (mounted.current) setSwitching(false);
    }
  };

  const projectName = currentProject?.name || copy(isLoadingProjects ? "loadingProjects" : "chooseProject");
  const applicationName = !currentProject ? copy("projectFirst") : currentApplication?.name || copy(applicationsQuery.isPending ? "loadingApplications" : appTypeId && applicationsQuery.isSuccess ? "currentUnavailable" : "chooseApplication");
  const retry = () => { if (menu === "project") onRetryProjects?.(); else void applicationsQuery.refetch(); };

  return <div className={`workspace-project-switcher${isCollapsed ? " is-collapsed" : ""}`} aria-busy={switching}>
    {(["project", "application"] as const).map((kind) => {
      const name = kind === "project" ? projectName : applicationName;
      const Icon = kind === "project" ? IconFolder : IconApps;
      return <button key={kind} id={`${id}-${kind}-trigger`} type="button" className={`workspace-scope-trigger workspace-scope-trigger--${kind}`} ref={(node) => { triggers.current[kind] = node; }}
        aria-label={copy(kind === "project" ? "projectLabel" : "applicationLabel", { name })} title={name}
        aria-haspopup="listbox" aria-expanded={menu === kind} aria-controls={menu === kind ? listId : undefined}
        disabled={kind === "application" && !canLoadApplications} aria-disabled={switching || undefined}
        onClick={() => openMenu(kind)} onKeyDown={(event) => { if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); openMenu(kind); } }}>
        <span className="workspace-scope-trigger__icon"><Icon size={17} stroke={1.8} aria-hidden="true" /></span>
        {!isCollapsed && <span className="workspace-scope-trigger__copy"><span>{copy(kind)}</span><strong>{name}</strong></span>}
        {!isCollapsed && <IconChevronDown className="workspace-scope-trigger__chevron" size={14} aria-hidden="true" />}
      </button>;
    })}
    {menu && createPortal(<div ref={popup} className="workspace-scope-menu" tabIndex={-1} data-dialog-popover-owner={`${id}-${menu}-trigger`} onKeyDown={moveThroughOptions}
      style={{ ...(position || {}), visibility: position ? "visible" : "hidden" }}>
      <div className="workspace-scope-menu__heading"><div><strong>{copy(menu === "project" ? "chooseProject" : "chooseApplication")}</strong>{menu === "application" && <small title={currentProject?.name}>{currentProject?.name}</small>}</div>
        <button className="workspace-scope-menu__close" type="button" aria-label={copy("close")} onClick={() => closeMenu(true)}><IconX size={15} aria-hidden="true" /></button>
      </div>
      {searchable && <div className="workspace-scope-menu__search"><IconSearch size={16} aria-hidden="true" /><input ref={searchInput} aria-label={copy(menu === "project" ? "searchProjects" : "searchApplications")} placeholder={copy(menu === "project" ? "searchProjects" : "searchApplications")}
        value={search} onChange={(event) => setSearch(event.target.value)} autoComplete="off" spellCheck={false} />{search && <button type="button" aria-label={copy("clearSearch")} onClick={() => { setSearch(""); searchInput.current?.focus(); }}><IconX size={14} aria-hidden="true" /></button>}</div>}
      <div className="workspace-scope-menu__body">
        {loading ? <LoadingState label={copy(menu === "project" ? "loadingProjects" : "loadingApplications")} />
          : loadError ? <div className="workspace-scope-menu__state workspace-scope-menu__state--error" role="alert"><IconAlertCircle size={20} aria-hidden="true" /><span>{copy(menu === "project" ? "projectError" : "applicationError")}</span>{(menu === "application" || onRetryProjects) && <button type="button" onClick={retry} disabled={menu === "application" && applicationsQuery.isFetching}>{copy("retry")}</button>}</div>
          : options.length === 0 ? <div className="workspace-scope-menu__state" role="status"><IconApps size={21} aria-hidden="true" /><strong>{copy(menu === "project" ? "emptyProjects" : "emptyApplications")}</strong><span>{copy(menu === "project" ? "emptyProjectsHelp" : "emptyApplicationsHelp")}</span></div>
          : filteredOptions.length === 0 ? <div className="workspace-scope-menu__state" role="status"><span>{copy("noMatches")}</span><button type="button" onClick={() => { setSearch(""); searchInput.current?.focus(); }}>{copy("clearSearch")}</button></div>
          : <div role="listbox" id={listId} aria-label={copy(menu)}>{filteredOptions.map((option) => {
            const selected = String(option.id) === selectedId;
            const Icon = menu === "project" ? IconFolder : IconApps;
            const kind = "type" in option ? option.type : null;
            return <button role="option" aria-selected={selected} tabIndex={-1} disabled={switching} type="button" key={option.id} title={option.name}
              className={`workspace-scope-option${selected ? " is-selected" : ""}`} onClick={() => void choose(String(option.id))}>
              <Icon size={18} stroke={1.7} aria-hidden="true" /><span><strong>{option.name}</strong>{kind && <small>{copy(kind)}</small>}</span>{selected && <IconCheck size={17} aria-hidden="true" />}
            </button>;
          })}</div>}
      </div>
      {switching && <LoadingState label={copy("switching")} />}
      {selectionError && <div className="workspace-scope-menu__feedback is-error" role="alert">{copy(selectionError)}</div>}
    </div>, document.body)}
  </div>;
}
