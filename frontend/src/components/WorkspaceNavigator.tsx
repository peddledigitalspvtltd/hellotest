import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { useLocalization } from "../context/LocalizationContext";
import { useDialogFocus } from "../hooks/useDialogFocus";
import { capabilityAvailability, searchCapabilities, WORKSPACE_CAPABILITIES, type CapabilityGroup } from "../lib/workspaceCapabilities";
import type { PageAccessMap } from "../lib/permissions";
import type { FeatureFlagSnapshot } from "../types";
const groups: Array<CapabilityGroup | "all"> = ["all", "plan", "design", "automate", "execute", "investigate", "manage"];
export function WorkspaceNavigator({ onClose, projectId, projectName, flags, flagsError, pageAccess }: {
  onClose: () => void; projectId: string; projectName: string; flags?: FeatureFlagSnapshot; flagsError?: boolean; pageAccess?: PageAccessMap;
}) {
  const { session } = useAuth();
  const { t, formatNumber } = useLocalization();
  const dialogRef = useDialogFocus<HTMLDivElement>({ onClose });
  const [query, setQuery] = useState("");
  const [group, setGroup] = useState<CapabilityGroup | "all">("all");
  const [availableOnly, setAvailableOnly] = useState(false);
  const results = useMemo(() => searchCapabilities(query, WORKSPACE_CAPABILITIES.map(item => ({ ...item, name: t(`capability.${item.id}.name`, item.name), description: t(`capability.${item.id}.description`, item.description), keywords: `${item.keywords || ""} ${item.name}` })))
    .filter(item => group === "all" || item.group === group)
    .map(item => ({ ...item, availability: capabilityAvailability(item, { session, projectId, flags, flagsError, pageAccess }) }))
    .filter(item => !availableOnly || item.availability === "available"), [query, group, availableOnly, session, projectId, flags, flagsError, pageAccess, t]);
  const reasons = { restricted: t("navigator.restricted", "Permission required"), disabled: t("navigator.disabled", "Feature disabled"), project: t("navigator.project", "Select a project"), unavailable: t("navigator.unavailable", "Availability unverified") };
  return createPortal(<div className="workspace-dialog-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="workspace-dialog workspace-navigator" role="dialog" aria-modal="true" aria-labelledby="navigator-title" aria-describedby="navigator-description" tabIndex={-1} ref={dialogRef}>
      <header><div><span className="workspace-dialog-eyebrow">HelloTest · {projectName}</span><h2 id="navigator-title">{t("navigator.title", "What would you like to do?")}</h2><p id="navigator-description">{t("navigator.description", "Find a capability and continue in your current project.")}</p></div><button type="button" className="workspace-icon-button" onClick={onClose} aria-label={t("common.close", "Close")}>×</button></header>
      <div className="navigator-search"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true"><circle cx="10" cy="10" r="6"/><path d="m15 15 6 6"/></svg><input data-autofocus="true" type="search" value={query} onChange={event => setQuery(event.target.value)} aria-label={t("shell.find", "Find a capability")} placeholder={t("navigator.search", "Search tests, agents, evidence…")} /></div>
      <div className="navigator-groups" role="group" aria-label={t("navigator.filter", "Filter by activity")}>{groups.map(value => <button type="button" key={value} aria-pressed={group === value} onClick={() => setGroup(value)}>{t(`navigator.${value}`, value[0].toUpperCase() + value.slice(1))}</button>)}</div>
      <div className="navigator-result-summary"><span role="status">{formatNumber(results.length)} {t("navigator.capabilities", "capabilities")}</span><label><input type="checkbox" checked={availableOnly} onChange={event => setAvailableOnly(event.target.checked)} />{t("navigator.availableOnly", "Available only")}</label></div>
      <div className="navigator-results">
        {results.length ? results.map(item => <article key={item.id} className={`navigator-result is-${item.availability}`}>
          <span className={`navigator-glyph group-${item.group}`} aria-hidden="true">{item.group === "automate" ? "✧" : item.group === "execute" ? "▷" : item.group === "investigate" ? "◎" : item.group === "design" ? "◇" : item.group === "plan" ? "▤" : "⚙"}</span>
          <div>{item.availability === "available" ? <Link to={item.to} onClick={onClose}>{item.name}<span aria-hidden="true">→</span></Link> : <strong>{item.name}</strong>}<p>{item.description}</p><span className="navigator-result-category">{t(`navigator.${item.group}`, item.group)}</span></div>
          {item.availability !== "available" ? <span className="navigator-reason">{reasons[item.availability]}</span> : null}
        </article>) : <div className="navigator-empty"><h3>{t("navigator.empty", "No matching capabilities")}</h3><p>{t("navigator.emptyHelp", "Try another term or clear the filters.")}</p><button className="ghost-button" type="button" onClick={() => { setQuery(""); setGroup("all"); setAvailableOnly(false); }}>{t("common.reset", "Reset")}</button></div>}
      </div>
      <footer><span>{t("navigator.keyboard", "Tab to a destination · Enter to open · Esc to close")}</span></footer>
    </div>
  </div>, document.body);
}
