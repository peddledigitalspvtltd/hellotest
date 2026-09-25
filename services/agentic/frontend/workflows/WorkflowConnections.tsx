import { useQuery } from "@tanstack/react-query";
import { IconPlugConnected, IconLock } from "@tabler/icons-react";
import { agenticApi } from "../api.client";
export function WorkflowConnections({ projectId }: { projectId: string }) {
  const query = useQuery({
    queryKey: ["workflow-connections", projectId],
    queryFn: () => agenticApi.agenticWorkflows.connections(projectId),
    enabled: Boolean(projectId),
    staleTime: 30000,
  });
  return (
    <section className="studio-connections" aria-label="Project connections">
      <h3>
        <IconPlugConnected size={18} />
        Project connections
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
      ) : query.data?.length ? (
        <ul>
          {query.data.map((item) => (
            <li key={item.id}>
              <span>
                <strong>{item.name}</strong>
                <small>
                  {item.kind === "mcp" ? "MCP server" : "HTTP API"} ·{" "}
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
          No managed connections are configured for this project. Public HTTP
          GET requests can run without authentication. Ask your administrator to
          add an API or MCP connection.
        </p>
      )}
    </section>
  );
}
