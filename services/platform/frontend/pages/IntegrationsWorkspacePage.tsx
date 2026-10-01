import { useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { capabilityView } from "../src/platform/capabilities/CapabilityView";
import { useFeatureFlags } from "../src/platform/hooks/useFeatureFlags";
import { useCurrentProject } from "../src/platform/hooks/useCurrentProject";
import { useAuth } from "../src/auth/AuthContext";
import { hasPermission } from "../src/platform/lib/permissions";
import { areFeatureFlagsEnabled } from "../src/platform/lib/featureFlags";
import { agenticApi } from "@hellotest/agentic/frontend/api.client";
import type { IntegrationsPageProps, IntegrationProviderExtension } from "@hellotest/integration/frontend/pages/IntegrationsPage";
import type { WorkflowConnectionSettingsProps } from "@hellotest/agentic/frontend/workflows/WorkflowConnectionSettings";
import type { Integration } from "../src/types";

const Providers = capabilityView<IntegrationsPageProps>("integration", "IntegrationsPage", () => import("@hellotest/integration/frontend/pages/IntegrationsPage"), "integration providers");
const ConnectionEditor = capabilityView<WorkflowConnectionSettingsProps>("agentic", "WorkflowConnectionSettings", () => import("@hellotest/agentic/frontend/workflows/WorkflowConnectionSettings"), "connection editor");
const connectionPrefix = "workflow-connection:";

export function useWorkflowProviderConnections(active = true) {
  const [projectId] = useCurrentProject();
  const { session } = useAuth();
  const flags = useFeatureFlags();
  const enabled = active && areFeatureFlagsEnabled(flags.data, ["hellotest.ai.agentic_workflows"]);
  const connections = useQuery({ queryKey: ["workflow-admin-connections", projectId], queryFn: () => agenticApi.workflowConnections.list(projectId), enabled: Boolean(enabled && projectId && hasPermission(session, "integration.view")), refetchOnWindowFocus: "always" });
  return { projectId, enabled, connections };
}

export function IntegrationsWorkspacePage({ embedded = false }: { embedded?: boolean }) {
  const [params] = useSearchParams();
  const { projectId, enabled, connections } = useWorkflowProviderConnections();
  const providers = useMemo<IntegrationProviderExtension[]>(() => !enabled ? [] : (["mcp", "http"] as const).map(kind => ({
    definition: { value: kind, label: kind === "mcp" ? "MCP Server" : "HTTP API", description: kind === "mcp" ? "Connect server tools to AI workflows" : "Connect HTTP endpoints to workflows" },
    records: (connections.data || []).filter(row => row.kind === kind).map(row => ({ id: connectionPrefix + row.id, type: kind, name: row.name, base_url: row.url, is_active: row.enabled, api_key: null, model: null, username: null, project_key: null, config: { tools: row.tools, methods: row.methods }, updated_at: row.updated_at } satisfies Integration)),
    loading: Boolean(projectId && connections.isLoading),
    error: kind === "mcp" && connections.isError ? "Workflow providers could not be loaded." : undefined,
    retry: () => { void connections.refetch(); },
    renderEditor: ({ integrationId, onSaved, onClose }) => <ConnectionEditor kind={kind} connectionId={integrationId?.slice(connectionPrefix.length)} onSaved={id => onSaved(connectionPrefix + id)} onClose={onClose} />,
  })), [enabled, projectId, connections.data, connections.isLoading, connections.isError]);
  const initialProvider = enabled && (params.get("integration") === "mcpServers" || params.get("provider") === "mcp") ? "mcp" : enabled && params.get("provider") === "http" ? "http" : undefined;
  return <Providers key={`${projectId}:${initialProvider || "all"}`} embedded={embedded} additionalProviders={providers} initialProvider={initialProvider} />;
}
