import { useMemo, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { Link, useNavigate } from "react-router-dom";
import { IconArrowRight, IconListDetails, IconPencil, IconPlayerPlay, IconRobot, IconSearch, IconSettings, IconTargetArrow, IconX } from "@tabler/icons-react";
import { useAuth } from "../../auth/AuthContext";
import { useLocalization } from "../../context/LocalizationContext";
import { useDialogFocus } from "../../shared/hooks/useDialogFocus";
import { capabilityAvailability, searchCapabilities, WORKSPACE_CAPABILITIES, type CapabilityGroup } from "../lib/workspaceCapabilities";
import { readRecentCapabilities, recentCapabilityKey, recordRecentCapability } from "../lib/workspaceDiscovery";
import { preloadWorkspaceRoute } from "../lib/routePrefetch";
import type { PageAccessMap } from "../lib/permissions";
import type { FeatureFlagSnapshot } from "../../types";
const groups: Array<CapabilityGroup | "all"> = ["all", "plan", "design", "automate", "execute", "investigate", "manage"];
const groupIcons = { plan: IconListDetails, design: IconPencil, automate: IconRobot, execute: IconPlayerPlay, investigate: IconTargetArrow, manage: IconSettings };
const defaultOrder = ["cases", "stories", "runs", "agents", "knowledge", "bugs", "automation", "readiness", "suites", "projects"];
export function WorkspaceNavigator({ onClose, projectId, projectName, flags, flagsError, pageAccess }: {
  onClose: () => void; projectId: string; projectName: string; flags?: FeatureFlagSnapshot; flagsError?: boolean; pageAccess?: PageAccessMap;
}) {
  const { session } = useAuth();
  const { t, formatNumber } = useLocalization();
  const navigate = useNavigate();
  const dialogRef = useDialogFocus<HTMLDivElement>({ onClose });
  const searchRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const [group, setGroup] = useState<CapabilityGroup | "all">("all");
  const [availableOnly, setAvailableOnly] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const recentKey = recentCapabilityKey(session?.user.id, projectId);
  const recent = useMemo(() => readRecentCapabilities(recentKey), [recentKey]);
  const isBrowsing = !query.trim() && group === "all";
  const results = useMemo(() => searchCapabilities(query, WORKSPACE_CAPABILITIES.map(item => ({ ...item, name: t(`capability.${item.id}.name`, item.name), description: t(`capability.${item.id}.description`, item.description), keywords: `${item.keywords || ""} ${item.name}` })))
    .filter(item => group === "all" || item.group === group)
    .map(item => ({ ...item, availability: capabilityAvailability(item, { session, projectId, flags, flagsError, pageAccess }) }))
    .filter(item => item.availability !== "disabled" && item.availability !== "restricted")
    .filter(item => !availableOnly || item.availability === "available")
    .sort((left, right) => {
      if (!isBrowsing) return 0;
      const rank = (id: string) => recent.includes(id) ? recent.indexOf(id) : recent.length + (defaultOrder.includes(id) ? defaultOrder.indexOf(id) : defaultOrder.length);
      return rank(left.id) - rank(right.id);
    }), [query, group, availableOnly, session, projectId, flags, flagsError, pageAccess, t, isBrowsing, recent]);
  const visibleResults = isBrowsing && !showAll ? results.slice(0, 10) : results;
  const reasons = { restricted: t("navigator.restricted", "Permission required"), disabled: t("navigator.disabled", "Feature disabled"), project: t("navigator.project", "Select a project"), unavailable: t("navigator.unavailable", "Availability unverified") };
  const handleSearchKey = (event: KeyboardEvent<HTMLInputElement>) => {
    const links = resultsRef.current?.querySelectorAll<HTMLAnchorElement>("a");
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      links?.[event.key === "ArrowDown" ? 0 : links.length - 1]?.focus();
    } else if (event.key === "Enter") {
      const first = visibleResults.find(item => item.availability === "available");
      if (first) {
        event.preventDefault(); recordRecentCapability(recentKey, first.id); onClose(); navigate(first.to);
      }
    }
  };
  return createPortal(<div className="workspace-dialog-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="workspace-dialog workspace-navigator" role="dialog" aria-modal="true" aria-labelledby="navigator-title" aria-describedby="navigator-description" tabIndex={-1} ref={dialogRef}>
      <header><div><span className="workspace-dialog-eyebrow">{projectName}</span><h2 id="navigator-title">{t("navigator.title", "What would you like to do?")}</h2><p id="navigator-description">{t("navigator.description", "Find a capability and continue in your current project.")}</p></div><button type="button" className="workspace-icon-button" onClick={onClose} aria-label={t("common.close", "Close")}><IconX size={18} aria-hidden="true" /></button></header>
      <div className="navigator-search"><IconSearch size={20} aria-hidden="true" /><input ref={searchRef} data-autofocus="true" type="search" value={query} onChange={event => { setQuery(event.target.value); setShowAll(false); }} onKeyDown={handleSearchKey} aria-label={t("shell.find", "Find a capability")} aria-controls="navigator-results" placeholder={t("navigator.search", "Search tests, agents, evidence…")} /></div>
      <div className="navigator-groups" role="group" aria-label={t("navigator.filter", "Filter by activity")}>{groups.map(value => <button type="button" key={value} aria-pressed={group === value} onClick={() => { setGroup(value); setShowAll(false); }}>{t(`navigator.${value}`, value[0].toUpperCase() + value.slice(1))}</button>)}</div>
      <div className="navigator-result-summary"><span role="status">{isBrowsing && !showAll ? t("navigator.recommended", "Recent & popular") : `${formatNumber(results.length)} ${t("navigator.capabilities", "capabilities")}`}</span><label><input type="checkbox" checked={availableOnly} onChange={event => setAvailableOnly(event.target.checked)} />{t("navigator.availableOnly", "Available only")}</label></div>
      <div className="navigator-results" id="navigator-results" ref={resultsRef} onKeyDown={event => {
        if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
        const links = Array.from(event.currentTarget.querySelectorAll<HTMLAnchorElement>("a"));
        const index = links.indexOf(document.activeElement as HTMLAnchorElement);
        if (index < 0) return;
        event.preventDefault();
        if (event.key === "ArrowUp" && index === 0) { searchRef.current?.focus(); return; }
        const next = event.key === "Home" ? 0 : event.key === "End" ? links.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + links.length) % links.length;
        links[next]?.focus();
      }}>
        {visibleResults.length ? visibleResults.map(item => {
          const Glyph = groupIcons[item.group];
          const content = <><span className={`navigator-glyph group-${item.group}`} aria-hidden="true"><Glyph size={19} /></span><div className="navigator-result-copy"><span className="navigator-result-title">{item.name}</span><p>{item.description}</p></div>{isBrowsing && recent.includes(item.id) && <span className="navigator-recent-label" aria-hidden="true">{t("navigator.recent", "Recent")}</span>}<IconArrowRight className="navigator-result-arrow" size={16} aria-hidden="true" /></>;
          return <article key={item.id} className={`navigator-result is-${item.availability}`}>
            {item.availability === "available" ? <Link to={item.to} aria-label={item.name} onClick={() => { recordRecentCapability(recentKey, item.id); onClose(); }} onFocus={() => preloadWorkspaceRoute(item.to)} onMouseEnter={() => preloadWorkspaceRoute(item.to)}>{content}</Link> : <div className="navigator-unavailable-result">{content}<span className="navigator-reason">{reasons[item.availability]}</span></div>}
          </article>;
        }) : <div className="navigator-empty"><h3>{t("navigator.empty", "No matching capabilities")}</h3><p>{t("navigator.emptyHelp", "Try another term or clear the filters.")}</p><button className="ghost-button" type="button" onClick={() => { setQuery(""); setGroup("all"); setAvailableOnly(false); searchRef.current?.focus(); }}>{t("common.reset", "Reset")}</button></div>}
        {isBrowsing && !showAll && results.length > visibleResults.length && <button className="navigator-browse-all" type="button" onClick={() => setShowAll(true)}>{t("navigator.browseAll", "Browse all capabilities")} <span>{formatNumber(results.length)}</span></button>}
      </div>
      <footer><span>{t("navigator.keyboardQuick", "↑ ↓ to navigate · Enter to open · Esc to close")}</span></footer>
    </div>
  </div>, document.body);
}
