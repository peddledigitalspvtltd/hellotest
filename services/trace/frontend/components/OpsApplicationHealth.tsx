import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@hellotest/platform/frontend/src/auth/AuthContext";
import { useFeatureFlags } from "@hellotest/platform/frontend/src/platform/hooks/useFeatureFlags";
import { platformApi } from "@hellotest/platform/frontend/api.client";
import { hasPermission } from "@hellotest/platform/frontend/src/platform/lib/permissions";
import { areFeatureFlagsEnabled } from "@hellotest/platform/frontend/src/platform/lib/featureFlags";
import { Panel } from "@hellotest/platform/frontend/src/shared/components/Panel";
import { AppErrorState } from "@hellotest/platform/frontend/src/platform/components/AppErrorBoundary";
import { LoadingState } from "@hellotest/platform/frontend/src/shared/components/LoadingState";
import type { AdminHealthCheck, AdminHealthSnapshot, AdminHealthStatus } from "@hellotest/platform/frontend/src/types";

const HEALTH_SECTION_LABELS = {
  registry: "Project registry",
  schema: "HelloTest schema",
  storage: "Storage",
  attachments: "Attachments",
  permissions: "Permissions"
} as const;

const normalizeHealthStatus = (value: unknown): AdminHealthStatus => {
  const status = String(value || "").toLowerCase();
  if (["ready", "healthy", "ok", "passed", "pass"].includes(status)) return "ready";
  if (["blocked", "failed", "error", "critical"].includes(status)) return "blocked";
  return "degraded";
};

const healthStatusLabel = (status: AdminHealthStatus) =>
  status === "ready" ? "Ready" : status === "blocked" ? "Blocked" : "Degraded";

const healthStatusClass = (status: AdminHealthStatus) =>
  status === "ready" ? "completed" : status === "blocked" ? "failed" : "running";

function collectHealthChecks(snapshot: AdminHealthSnapshot): AdminHealthCheck[] {
  if (snapshot.checks?.length) {
    return snapshot.checks.map((check) => ({ ...check, status: normalizeHealthStatus(check.status) }));
  }

  return (Object.keys(HEALTH_SECTION_LABELS) as Array<keyof typeof HEALTH_SECTION_LABELS>).flatMap((key) => {
    const section = snapshot[key];
    return section ? [{ key, label: HEALTH_SECTION_LABELS[key], ...section, status: normalizeHealthStatus(section.status) }] : [];
  });
}

export function OpsApplicationHealth({ projectId }: { projectId: string }) {
  const { session } = useAuth();
  const flags = useFeatureFlags();
  const healthQuery = useQuery({
    queryKey: ["admin-health", projectId],
    queryFn: async () => {
      const snapshot = await platformApi.admin.health({ project_id: projectId || undefined });
      if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot) || !snapshot.status) {
        throw new Error("The installed backend does not expose a valid admin health report yet.");
      }
      return { ...snapshot, status: normalizeHealthStatus(snapshot.status) };
    },
    enabled: Boolean(projectId) && hasPermission(session, "ops.view", projectId) && areFeatureFlagsEnabled(flags.data, ["hellotest.ops.telemetry"]),
    retry: false,
    staleTime: 30_000
  });
  const healthChecks = healthQuery.data ? collectHealthChecks(healthQuery.data) : [];
  const readyHealthChecks = healthChecks.filter(check => check.status === "ready").length;
  return <section className="ops-application-health" aria-label="Application service health"><h3>Application services</h3>{healthQuery.isLoading ? (
            <Panel title="System health" subtitle="Checking the live HelloTest platform configuration.">
              <LoadingState label="Running system checks" />
            </Panel>
          ) : healthQuery.error ? (
            <AppErrorState
              compact
              error={healthQuery.error}
              fallbackMessage="HelloTest could not load system health. Confirm the backend is deployed, then retry."
              onRetry={() => void healthQuery.refetch()}
              title="System health unavailable"
            />
          ) : healthQuery.data ? (
            <Panel
              actions={(
                <button className="ghost-button compact" disabled={healthQuery.isFetching} onClick={() => void healthQuery.refetch()} type="button">
                  {healthQuery.isFetching ? "Checking…" : "Run checks again"}
                </button>
              )}
              subtitle="Live readiness checks from the deployed HelloTest backend."
              title="System health"
            >
              <div className="metric-strip compact">
                <div className="mini-card">
                  <strong>{healthStatusLabel(healthQuery.data.status)}</strong>
                  <span>Overall status</span>
                </div>
                <div className="mini-card">
                  <strong>{readyHealthChecks}/{healthChecks.length}</strong>
                  <span>Checks ready</span>
                </div>
                <div className="mini-card">
                  <strong>{healthQuery.data.version || "Current"}</strong>
                  <span>App version</span>
                </div>
                <div className="mini-card">
                  <strong>{healthQuery.data.checked_at ? new Date(healthQuery.data.checked_at).toLocaleTimeString() : "Now"}</strong>
                  <span>Last checked</span>
                </div>
              </div>
              {healthChecks.length ? (
                <div className="stack-list">
                  {healthChecks.map((check) => (
                    <div className="stack-item" key={check.key}>
                      <div>
                        <strong>{check.label}</strong>
                        <span>{check.summary || check.detail || "No diagnostic detail was returned."}</span>
                        {check.remediation ? <small>{check.remediation}</small> : null}
                      </div>
                      <span className={`status-badge ${healthStatusClass(check.status)}`}>{healthStatusLabel(check.status)}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <AppErrorState
                  compact
                  fallbackMessage="The health endpoint returned no registry, schema, storage, attachment, or permission checks."
                  onRetry={() => void healthQuery.refetch()}
                  title="No health checks returned"
                />
              )}
            </Panel>
          ) : null}</section>;
}
