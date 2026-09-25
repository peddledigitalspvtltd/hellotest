import { useQuery } from "@tanstack/react-query";
import { IconPlugConnected, IconRefresh } from "@tabler/icons-react";
import type { AgenticWorkflowNodeData } from "@hellotest/platform/frontend/src/types";
import { agenticApi } from "../api.client";
export function WorkflowOperationFields({
  data,
  projectId,
  canRun,
  onChange,
}: {
  data: AgenticWorkflowNodeData;
  projectId: string;
  canRun: boolean;
  onChange: (patch: Partial<AgenticWorkflowNodeData>) => void;
}) {
  const kind = String(data.kind);
  const usesConnection = [
    "apiTool",
    "apiAgent",
    "webAgent",
    "mcpTool",
  ].includes(kind);
  const connections = useQuery({
    queryKey: ["workflow-connections", projectId],
    queryFn: () => agenticApi.agenticWorkflows.connections(projectId),
    enabled: Boolean(projectId && usesConnection),
    staleTime: 30000,
  });
  const mcp = useQuery({
    queryKey: ["workflow-mcp-tools", projectId, data.connectionId],
    queryFn: ({ signal }) =>
      agenticApi.agenticWorkflows.mcpTools(
        projectId,
        String(data.connectionId),
        signal,
      ),
    enabled: false,
    retry: false,
    gcTime: 30000,
  });
  const connection = connections.data?.find(
    (item) => item.id === data.connectionId,
  );
  const tool = mcp.data?.find((item) => item.name === data.mcpTool);
  const field = (
    key: string,
    label: string,
    multiline = false,
    placeholder?: string,
  ) => (
    <label>
      <span>{label}</span>
      {multiline ? (
        <textarea
          value={String(data[key] ?? "")}
          aria-label={label}
          placeholder={placeholder}
          rows={5}
          spellCheck={false}
          onChange={(event) => onChange({ [key]: event.target.value })}
        />
      ) : (
        <input
          value={String(data[key] ?? "")}
          aria-label={label}
          placeholder={placeholder}
          onChange={(event) => onChange({ [key]: event.target.value })}
        />
      )}
    </label>
  );
  const select = (
    key: string,
    label: string,
    options: Array<[string, string]>,
    fallback = "",
  ) => (
    <label>
      <span>{label}</span>
      <select
        aria-label={label}
        value={String(data[key] || fallback)}
        onChange={(event) => onChange({ [key]: event.target.value })}
      >
        {options.map(([value, title]) => (
          <option value={value} key={value}>
            {title}
          </option>
        ))}
      </select>
    </label>
  );
  return (
    <>
      {usesConnection ? (
        <div className="studio-parameter-group">
          <h4>
            <IconPlugConnected size={16} />
            Connection
          </h4>
          <label>
            <span>{kind === "mcpTool" ? "MCP server" : "API connection"}</span>
            <select
              aria-label={kind === "mcpTool" ? "MCP server" : "API connection"}
              value={String(data.connectionId || "")}
              onChange={(event) => {
                const selected = connections.data?.find(
                  (item) => item.id === event.target.value,
                );
                onChange({
                  connectionId: event.target.value,
                  apiAuth: "",
                  credentialId: "",
                  ...(kind === "mcpTool"
                    ? { mcpTool: "", mcpArguments: "{}" }
                    : {
                        apiUrl: selected?.url || "",
                        apiMethod: selected?.methods[0] || "GET",
                      }),
                });
              }}
            >
              <option value="">
                {kind === "mcpTool"
                  ? "Choose a configured server"
                  : "No authentication · public endpoint"}
              </option>
              {connections.data
                ?.filter(
                  (item) => item.kind === (kind === "mcpTool" ? "mcp" : "http"),
                )
                .map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                    {item.authenticated ? " · credential managed" : ""}
                  </option>
                ))}
            </select>
          </label>
          {connections.isError ? (
            <p role="alert">
              Connections are unavailable.{" "}
              <button type="button" onClick={() => void connections.refetch()}>
                Retry
              </button>
            </p>
          ) : null}
          <p className="studio-caption">
            Credentials are resolved on the server.{" "}
            {kind === "mcpTool"
              ? "Only tools enabled for this project can run."
              : "Authenticated and private APIs require a managed connection."}
          </p>
          {data.credentialId || data.apiAuth ? (
            <p className="studio-notice">
              This node has a legacy credential binding. Select a managed
              connection to replace it.
            </p>
          ) : null}
        </div>
      ) : null}
      {["apiTool", "apiAgent", "webAgent"].includes(kind) ? (
        <>
          {select(
            "apiMethod",
            "HTTP method",
            (kind === "webAgent"
              ? ["GET"]
              : connection?.methods || ["GET", "HEAD"]
            ).map((value) => [value, value]),
            "GET",
          )}
          {field(
            "apiUrl",
            "Endpoint URL",
            false,
            "https://api.example.com/status",
          )}
          {!["GET", "HEAD"].includes(String(data.apiMethod || "GET"))
            ? field("apiBody", "Request body JSON", true)
            : null}
          <p className="studio-caption">
            Requests return the actual response as <code>data</code>. Redirects
            are not followed.
          </p>
        </>
      ) : null}
      {kind === "mcpTool" ? (
        <>
          {canRun ? <button
            type="button"
            className="ghost-button"
            disabled={!data.connectionId || mcp.isFetching}
            onClick={() => void mcp.refetch()}
          >
            <IconRefresh size={15} />
            {mcp.isFetching ? "Reading server tools…" : "Load server tools"}
          </button> : null}
          {mcp.isError ? (
            <p role="alert">
              {mcp.error instanceof Error
                ? mcp.error.message
                : "Could not read server tools."}
            </p>
          ) : null}
          {select("mcpTool", "Server tool", [
            ["", "Choose a tool"],
            ...(
              mcp.data || (connection?.tools || []).map((name) => ({ name }))
            ).map((item) => [item.name, item.name] as [string, string]),
          ])}
          {tool?.description ? (
            <p className="studio-caption">{tool.description}</p>
          ) : null}
          {field("mcpArguments", "Tool arguments JSON", true, "{}")}
          {tool ? (
            <details>
              <summary>Server input schema</summary>
              <pre className="studio-schema">
                {JSON.stringify(tool.inputSchema, null, 2)}
              </pre>
            </details>
          ) : null}
          <p className="studio-caption">
            Use JSON values or paths such as <code>"$input.id"</code>. Tool
            arguments are checked against the server schema before execution.
          </p>
        </>
      ) : null}
      {["knowledgeTool", "repositoryTool", "testOpsTool"].includes(kind) ? (
        <>
          {field("knowledgeQuery", "Search question", true)}
          <p className="studio-caption">
            Retrieves current permitted project evidence. Results include source
            IDs and evidence limits.
          </p>
          {kind === "testOpsTool" && data.testOpsAction !== "read-runs" ? (
            <button
              type="button"
              onClick={() => onChange({ testOpsAction: "read-runs" })}
            >
              Use Read runs
            </button>
          ) : null}
        </>
      ) : null}
      {kind === "condition" ? (
        <>
          {field("conditionPath", "Value path", false, "input.status")}
          {select(
            "conditionOperator",
            "Comparison",
            [
              ["equals", "Equals"],
              ["notEquals", "Does not equal"],
              ["exists", "Exists"],
              ["contains", "Contains"],
              ["greater", "Greater than"],
              ["less", "Less than"],
            ],
            "equals",
          )}
          {data.conditionOperator !== "exists"
            ? field("conditionValue", "Compare with JSON", false, '"passed"')
            : null}
          <p className="studio-caption">
            Connect the labelled true and false ports to separate branches. The
            unselected branch is skipped.
          </p>
        </>
      ) : null}
      {kind === "loop" ? (
        <>
          {field("loopSourceKey", "Items path", false, "input.items")}
          {field("loopMaxIterations", "Maximum items", false, "10")}
          {select(
            "loopAction",
            "Action for each item",
            [
              ["transform", "Map fields"],
              ["customAI", "AI review"],
            ],
            "transform",
          )}
          {data.loopAction === "customAI" ? (
            <>
              {field("prompt", "Task for each item", true)}
              {field("instructions", "Per-item instructions", true)}
              <p className="studio-caption">
                The current item and its index are passed to your configured
                project model. Each result remains available in Output.
              </p>
            </>
          ) : null}
          <p className="studio-caption">
            Items run sequentially inside this node. Maximum 10 items, within
            this node's timeout. The next node receives the collected results.
          </p>
        </>
      ) : null}
      {kind === "transform" ||
      (kind === "loop" && data.loopAction !== "customAI") ? (
        <>
          {field("transformMapping", "Field mapping JSON", true)}
          <p className="studio-caption">
            Map values with <code>"$input.title"</code>,{" "}
            <code>"$request.id"</code>
            {kind === "loop" ? (
              <>
                {" "}
                or <code>"$item.title"</code>
              </>
            ) : null}
            . Literal values are preserved. No code is evaluated.
          </p>
        </>
      ) : null}
      {kind === "errorHandler" ? (
        <p className="studio-caption">
          Connect a node whose error policy is “Route to error handler”. This
          branch runs only when that node fails; permission failures always stop
          execution.
        </p>
      ) : null}
      {kind === "log" ? field("logMessage", "Log message", true) : null}
    </>
  );
}
