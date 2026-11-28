import { Select } from "@hellotest/platform/frontend/src/shared/components/Select";
export function AutomationBrowserBuildMode({ interactive, onChange, disabled = false, location, onLocationChange, compact = false }: { interactive: boolean; onChange: (value: boolean) => void; disabled?: boolean; location?: "local" | "remote"; onLocationChange?: (value: "local" | "remote") => void; compact?: boolean }) {
  return <>
    {onLocationChange ? <label className="form-field"><span>Build browser</span><Select aria-label="Build browser" value={location || "remote"} disabled={disabled} onChange={event => onLocationChange(event.target.value as "local" | "remote")}><option value="local">This computer · paired agent</option><option value="remote">Remote Test Engine</option></Select>
      {location === "local" ? <small className="muted">{compact ? "Keep the paired agent running." : "The Engineer opens the browser on your paired computer, including private apps. Keep the agent terminal running."}</small> : !compact ? <small className="muted">The Engineer opens a browser on the configured remote Test Engine.</small> : null}
    </label> : null}
    <label className="form-field"><span>Browser build mode</span><Select aria-label="Browser build mode" value={interactive ? "interactive" : "read_only"} disabled={disabled} onChange={event => onChange(event.target.value === "interactive")}><option value="interactive">Perform steps in browser</option><option value="read_only">Inspect page only</option></Select>
      {compact ? interactive ? <small className="muted">The agent can submit forms during the build.</small> : null : <small className="muted">{interactive ? "The agent can click, type and submit forms while developing the saved steps. Generated code and saved Plan progress are shown separately." : "Read-only: the agent can inspect this page but cannot click, type or submit forms. Generated instructions do not mean those actions were performed."}</small>}
    </label>
  </>;
}
