import { request, toQueryString } from "@hellotest/platform/frontend/src/lib/httpClient";



export const traceApi = {
opsTelemetry: {
    platform: (projectId: string, signal?: AbortSignal) => request<import("@hellotest/platform/frontend/src/types").OpsPlatformSnapshot>(`/ops-telemetry/platform${toQueryString({ project_id: projectId })}`, { signal, cache: "no-store" }, 6000),
    monitoring: (projectId: string, section: import("@hellotest/platform/frontend/src/types").OpsMonitoringSection, signal?: AbortSignal) => request<import("@hellotest/platform/frontend/src/types").OpsMonitoringSnapshot>(`/ops-telemetry/monitoring/${section}${toQueryString({ project_id: projectId })}`, { signal, cache: "no-store" }, 6000),
    consoleSession: (projectId: string, provider: "traces" | "alerts") => request<{ url: string; expires_at: string }>(`/ops-telemetry/console-session/${provider}`, { method: "POST", body: JSON.stringify({ project_id: projectId }) }, 15000),
    grafanaSession: (projectId: string) => request<{ url: string; expires_at: string }>("/ops-telemetry/grafana-session", { method: "POST", body: JSON.stringify({ project_id: projectId }) }, 35000),
    endGrafanaSession: () => request<{ closed: boolean }>("/ops-telemetry/grafana-session", { method: "DELETE" }),
    snapshot: (query: { project_id: string; include_workers?: boolean; service_name?: string; event_type?: string; status?: string; execution_id?: string; search?: string; limit?: number }, options?: { signal?: AbortSignal }) =>
      request<import("@hellotest/platform/frontend/src/types").OpsTelemetrySnapshot>(`/ops-telemetry/snapshot${toQueryString(query)}`, { signal: options?.signal }),
    clearLogs: (query?: { project_id?: string }) =>
      request<{ cleared: boolean; deleted: number; events_path: string }>(`/ops-telemetry/logs${toQueryString(query)}`, {
        method: "DELETE"
      })
  }
};

