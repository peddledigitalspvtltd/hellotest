import { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@hellotest/platform/frontend/src/auth/AuthContext";
import { traceApi } from "../api.client";
import { OpsPlatformPanel } from "./OpsPlatformPanel";
import { OpsApplicationHealth } from "./OpsApplicationHealth";
import { LlmTraces } from "./LlmTraces";
import { OpsEmbeddedConsole } from "./OpsEmbeddedConsole";
import type { OpsMonitoringSection } from "@hellotest/platform/frontend/src/types";
import "./OpsMonitoringWorkspace.css";

const tabs = [
  { id: "dashboard", label: "Dashboard", description: "Live and historical runtime metrics", admin: true },
  { id: "logs", label: "Infrastructure logs", description: "Container and TestGrid worker logs across the deployment", admin: true },
  { id: "traces", label: "Distributed traces", description: "Follow requests across services", admin: true },
  { id: "ai", label: "AI calls", description: "Model requests, responses, errors and performance for this project", admin: false },
  { id: "alerts", label: "Alerts", description: "Active and suppressed operational alerts", admin: true },
  { id: "health", label: "Service health", description: "Application readiness and monitoring component health", admin: false }
] as const;

function MonitoringData({ projectId, section }: { projectId: string; section: OpsMonitoringSection }) {
  const [search, setSearch] = useState("");
  const query = useQuery({
    queryKey: ["ops-monitoring", projectId, section],
    queryFn: ({ signal }) => traceApi.opsTelemetry.monitoring(projectId, section, signal),
    enabled: Boolean(projectId), staleTime: 15000, refetchInterval: 30000,
    refetchIntervalInBackground: false, retry: false
  });
  const data = query.data;
  const logs = (data?.logs || []).filter(log => `${log.container} ${log.message}`.toLowerCase().includes(search.toLowerCase()));
  return <div className="ops-monitoring-data">
    <div className="ops-monitoring-toolbar">
      <p>{section === "dashboard" ? "Runtime metrics · Prometheus" : section === "logs" ? "Infrastructure logs · Loki · Latest 100 lines from the last 15 minutes" : "Alertmanager · Active and suppressed alerts (up to 100)"}</p>
      <div>
        <button className="ghost-button" type="button" disabled={query.isFetching} onClick={() => void query.refetch()}>{query.isFetching ? "Refreshing…" : "Refresh"}</button>
      </div>
    </div>
    {query.isLoading && <p role="status">Reading {section}…</p>}
    {query.isError && <p role="alert">Unable to refresh this view. Use Refresh to retry. Other Test Ops views remain available.{data ? " Displaying the previous result." : ""}</p>}
    {data?.state === "not_configured" && <p role="status">Monitoring is disabled for this deployment. Start the local stack with monitoring enabled.</p>}
    {data?.state === "unavailable" && <p role="status">{section === "dashboard" ? "Prometheus" : section === "logs" ? "Loki" : "Alertmanager"} is temporarily unavailable. Use Refresh to retry, or check Service health.</p>}
    {data?.state === "available" && <>
      {section === "logs" && <>
        <label className="ops-monitoring-search">Filter loaded log lines<input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Container or message" /></label>
        <div className="ops-monitoring-log-list">{logs.map((log, index) => <article key={`${log.timestamp}-${index}`}>
          <header><strong>{log.container}</strong><time dateTime={log.time}>{new Date(log.time).toLocaleString()}</time></header>
          <pre>{log.message}</pre>
        </article>)}</div>
        {!logs.length && <p role="status">{search ? "No loaded log lines match this filter." : "No recent container logs. Check Alloy and Loki in Service health."}</p>}
      </>}
      <p className="ops-monitoring-info">Updated {new Date(data.checked_at).toLocaleTimeString()}. Infrastructure data covers the deployment and is restricted to workspace administrators.</p>
    </>}
  </div>;
}

export function OpsMonitoringWorkspace({ projectId }: { projectId: string }) {
  const { session } = useAuth();
  const [params, setParams] = useSearchParams();
  const visibleTabs = tabs.filter(tab => !tab.admin || session?.user.role === "admin");
  const requested = params.get("monitoring") || visibleTabs[0].id;
  const canonical = requested === "grafana" ? "dashboard" : requested === "project" ? "logs" : requested;
  const selected = visibleTabs.some(tab => tab.id === canonical) ? canonical : visibleTabs[0].id;
  const select = (id: string) => setParams(current => { const next = new URLSearchParams(current); next.set("monitoring", id); return next; }, { replace: true });
  useEffect(() => { if (requested !== selected) select(selected); }, [requested, selected]);
  return <section className="panel card ops-monitoring-workspace" aria-label="OPS telemetry workspace">
    <header className="ops-monitoring-heading"><div><span className="ops-monitoring-eyebrow">OBSERVABILITY</span><h2>Operations workspace</h2><p>Investigate AI calls and runtime signals from one place.</p></div><span className="ops-monitoring-scope">{selected === "ai" ? "Selected project" : "Deployment overview"}</span></header>
    <nav className="ops-monitoring-tabs" role="tablist" aria-label="Monitoring views">{visibleTabs.map((tab, index) => <button key={tab.id} id={`ops-tab-${tab.id}`} type="button" role="tab" className={selected === tab.id ? "is-active" : ""} aria-selected={selected === tab.id} aria-controls="ops-monitoring-panel" tabIndex={selected === tab.id ? 0 : -1} onClick={() => select(tab.id)} onKeyDown={event => {
      const offset = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
      if (!offset && event.key !== "Home" && event.key !== "End") return;
      event.preventDefault();
      const next = event.key === "Home" ? visibleTabs[0] : event.key === "End" ? visibleTabs[visibleTabs.length - 1] : visibleTabs[(index + offset + visibleTabs.length) % visibleTabs.length];
      select(next.id); document.getElementById(`ops-tab-${next.id}`)?.focus();
    }}>{tab.label}</button>)}</nav>
    <div id="ops-monitoring-panel" role="tabpanel" aria-labelledby={`ops-tab-${selected}`} className="ops-monitoring-panel">
      <p className="ops-monitoring-section-description">{tabs.find(tab => tab.id === selected)?.description}</p>
      {selected === "ai" ? <LlmTraces key={projectId} projectId={projectId} /> : selected === "health" ? <div className="ops-health-workspace"><OpsApplicationHealth projectId={projectId} /><OpsPlatformPanel projectId={projectId} /></div> : selected === "logs" ? <MonitoringData projectId={projectId} section="logs" /> : <OpsEmbeddedConsole key={selected} projectId={projectId} provider={selected === "dashboard" ? "grafana" : selected as "traces" | "alerts"} />}
    </div>
  </section>;
}
