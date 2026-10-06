import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { IconPlugConnected, IconLock } from "@tabler/icons-react";
import { agenticApi } from "../api.client";
export function WorkflowConnections({ projectId }: { projectId: string }) {
  const query = useQuery({
    queryKey: ["workflow-connections", projectId],
    queryFn: () => agenticApi.agenticWorkflows.connections(projectId),
    enabled: Boolean(projectId),
    staleTime: 30000,
    refetchOnWindowFocus: "always",
    refetchOnMount: "always",
  });
  return (
    <section className="studio-connections" aria-label="HTTP credentials">
      <h3>
        <IconPlugConnected size={18} />
        Credentials
      </h3>
      {query.isPending ? (
        <p className="studio-caption">Loading connections…</p>
      ) : query.isError ? (
        <p role="alert">
          Could not load connections.{" "}
          <button
            type="button"
            className="ghost-button"
            onClick={() => void query.refetch()}
          >
            Retry
          </button>
        </p>
      ) : query.data?.some(item => item.kind === "http") ? (
        <ul>
          {query.data.filter(item => item.kind === "http").map((item) => (
            <li key={item.id}>
              <span>
                <strong>{item.name}</strong>
                <small>
                  HTTP API ·{" "}
                  {item.authenticated
                    ? "Managed credential"
                    : "No authentication"}
                </small>
              </span>
              <IconLock size={16} aria-hidden="true" />
            </li>
          ))}
        </ul>
      ) : (
        <p className="studio-caption">
          No HTTP credentials are configured for this project. Public HTTP
          GET requests can run without authentication. Ask your administrator to
          add an HTTP credential.
        </p>
      )}
      <Link to="/integrations?provider=http" target="_blank" rel="noreferrer">Manage HTTP credentials</Link>
      <Link to="/mcp-servers" target="_blank" rel="noreferrer">Manage MCP servers</Link>
    </section>
  );
}
