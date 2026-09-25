import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { traceApi } from "../api.client";

const consoles = {
  grafana: { label: "Grafana dashboard", title: "Grafana runtime dashboard", detail: "Historical metrics · Automatic sign-in" },
  traces: { label: "Distributed traces", title: "Jaeger distributed traces", detail: "Jaeger · Search requests, inspect spans, and follow service dependencies" },
  alerts: { label: "Alertmanager", title: "Alertmanager console", detail: "Alertmanager · Filter alerts, inspect groups, and review silences" }
} as const;

export function OpsEmbeddedConsole({ projectId, provider }: { projectId: string; provider: keyof typeof consoles }) {
  const console = consoles[provider];
  const [revision, setRevision] = useState(0);
  const [frameFailed, setFrameFailed] = useState(false);
  const [frameLoading, setFrameLoading] = useState(true);
  const query = useQuery({
    queryKey: ["ops-console-session", provider, projectId, revision],
    queryFn: () => provider === "grafana" ? traceApi.opsTelemetry.grafanaSession(projectId) : traceApi.opsTelemetry.consoleSession(projectId, provider),
    enabled: Boolean(projectId), retry: false, staleTime: 0, gcTime: 0,
    refetchInterval: 10 * 60 * 1000, refetchIntervalInBackground: false
  });
  const unavailable = query.isError || frameFailed;
  return <div className="ops-embedded-console">
    <div className="ops-monitoring-toolbar"><div><h3>{console.label}</h3><p className="ops-monitoring-info">{console.detail}</p></div>
      <span className="ops-monitoring-scope">Read-only</span><button className="ghost-button" type="button" disabled={query.isFetching} onClick={() => { setFrameFailed(false); setFrameLoading(true); setRevision(value => value + 1); }}>{query.isFetching ? "Connecting…" : "Reconnect"}</button>
    </div>
    {query.isPending && <div className="ops-monitoring-empty" role="status"><strong>Connecting to {console.label}</strong><p>Preparing your protected dashboard session…</p></div>}
    {unavailable && <div className="ops-monitoring-empty" role="alert"><strong>{console.label} unavailable</strong><p>{query.error instanceof Error ? query.error.message : "The dashboard connection ended or expired. Use Reconnect to try again."}</p><p>Your other OPS views remain available.</p></div>}
    {query.data && !unavailable && frameLoading && <p className="ops-monitoring-info" role="status">Loading {console.label}…</p>}
    {query.data && !unavailable && <iframe key={`${provider}-${projectId}-${revision}`} className="ops-console-frame" src={query.data.url} title={console.title} sandbox="allow-scripts allow-same-origin allow-downloads" referrerPolicy="no-referrer" onError={() => setFrameFailed(true)} onLoad={event => {
      setFrameLoading(false);
      // HTTP errors still trigger iframe load; detect the API error document.
      try {
        const document = event.currentTarget.contentDocument;
        if (document?.contentType.includes("json")) { setFrameFailed(true); return; }
        if (provider === "alerts" && document) {
          const style = document.createElement("style");
          style.textContent = 'a[href^="#/silences/new"] { display:none !important; } body { font-family:system-ui,sans-serif; } .container { max-width:100%; width:100%; padding-left:24px; padding-right:24px; } .btn,.alert,.card { border-radius:8px; }';
          document.head.appendChild(style);
        }
      } catch { setFrameFailed(true); }
    }} />}
  </div>;
}
