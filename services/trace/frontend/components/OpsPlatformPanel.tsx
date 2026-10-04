import { useQuery } from "@tanstack/react-query";
import { traceApi } from "../api.client";
import { Panel } from "@hellotest/platform/frontend/src/shared/components/Panel";


export function OpsPlatformPanel({ projectId }: { projectId: string }) {
  const query = useQuery({
    queryKey: ["ops-platform", projectId],
    queryFn: ({ signal }) => traceApi.opsTelemetry.platform(projectId, signal),
    enabled: Boolean(projectId), staleTime: 30000, refetchInterval: 60000,
    refetchIntervalInBackground: false, retry: false
  });
  return <Panel title="Monitoring health" subtitle="Independent component checks. Monitoring outages do not block test execution."
    actions={<button className="ghost-button" type="button" disabled={query.isFetching} onClick={() => void query.refetch()}>{query.isFetching ? "Checking…" : "Refresh health"}</button>}>
    {query.isError && <p role="status">Monitoring status is temporarily unavailable. Your test operations remain accessible. Retry using Refresh health.</p>}
    {query.isLoading && <p role="status">Checking monitoring services…</p>}
    {query.data && <>
      <p role="status">{!query.data.enabled ? "Monitoring is not enabled for this deployment." : query.data.state === "available" ? "All monitoring components are available." : "Some monitoring components are unavailable. Available components continue operating."} Last checked {new Date(query.data.checked_at).toLocaleTimeString()}.</p>
      <div style={{ overflowX: "auto" }}><table className="data-table">
        <thead><tr><th>Component</th><th>Purpose</th><th>Status</th><th>Memory ceiling</th></tr></thead>
        <tbody>{query.data.components.map(component => <tr key={component.id}>
          <td>{component.id}</td><td>{component.purpose}</td><td>{component.state.replace(/_/g, " ")}</td><td>{component.memory_limit_mib} MiB</td>
        </tr>)}</tbody>
      </table></div>
      <p>Metrics: {query.data.policy.metrics_retention}. Logs: {query.data.policy.logs_retention}. Traces: {query.data.policy.trace_capacity}.</p>
    </>}
  </Panel>;
}
