import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { IconPlugConnected, IconRefresh } from "@tabler/icons-react";
import type { AgenticWorkflowNodeData } from "@hellotest/platform/frontend/src/types";
import { agenticApi } from "../api.client";
import { WorkflowConditionFields } from "./WorkflowConditionFields";
import { nativeTaskDefaults, nativeTaskProfiles } from "./nativeTaskProfiles";
import { sprintStoriesUrl } from "./sprintStoriesUrl";
export function WorkflowOperationFields({
  data,
  projectId,
  canRun,
  triggerInput,
  onChange,
}: {
  data: AgenticWorkflowNodeData;
  projectId: string;
  canRun: boolean;
  triggerInput?: Record<string, unknown>;
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
    refetchOnWindowFocus: "always",
    refetchOnMount: "always",
  });
  const connection = connections.data?.find(item => item.id === data.connectionId);
  const mcp = useQuery({
    queryKey: ["workflow-mcp-tools", projectId, data.connectionId, connection?.discovered_at || connection?.url],
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
  const catalog = mcp.data || (connection?.toolDefinitions?.length ? connection.toolDefinitions : (connection?.tools || []).map(name => ({ name })));
  const availableTools = catalog
    .filter(item => connection?.tools.includes(item.name));
  const tool = (mcp.data || connection?.toolDefinitions)?.find((item) => item.name === data.mcpTool && connection?.tools.includes(item.name));
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
      {kind === "artifactTask" ? <>
        <label><span>Native task</span><select aria-label="Native task" value={String(data.artifactTask || "story-assurance")} onChange={event => onChange({ ...nativeTaskDefaults(event.target.value), prompt: "" })}>
          {Object.entries(nativeTaskProfiles).map(([value, profile]) => <option key={value} value={value}>{profile.label}</option>)}
        </select></label>
        <div className="studio-parameter-group">
          {field("task", "Task", true)}
          {field("instructions", "Instructions", true)}
          {field("guardrails", "Guardrails", true)}
          <button type="button" className="ghost-button" onClick={() => {
            const defaults = nativeTaskDefaults(String(data.artifactTask || "story-assurance"));
            onChange({ task: defaults.task, instructions: defaults.instructions, guardrails: defaults.guardrails, prompt: "" });
          }}>Restore task defaults</button>
          <p className="studio-caption">Saved with this node. Project access, source traceability and output validation are always enforced. Shared model contracts and quality metrics are configurable in AI Controls.</p>
        </div>
        {data.artifactTask === "automation-engineer" && <label className="studio-checkbox"><input type="checkbox" checked={data.inspectBrowser !== false} onChange={event => onChange({ inspectBrowser: event.target.checked })} /><span>Inspect the browser before building</span><small>Uses the trigger Start URL in read-only mode. API-only cases use their contracts directly.</small></label>}
        {data.artifactTask === "automation-engineer" && <>
          {select("readinessPolicy", "Readiness handling", [["verify-inputs", "Automation Engineer verifies inputs"], ["require-ready", "Require a ready assurance assessment"]], "verify-inputs")}
          <p className="studio-caption">The builder checks prior findings against the selected Story. Missing dependencies and invalid automation remain explicit failures.</p>
        </>}
      </> : null}
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
                  ...(selected?.timeoutMs ? { timeoutMs: String(selected.timeoutMs) } : {}),
                  ...(kind === "mcpTool"
                    ? { mcpTool: "", mcpArguments: "{}" }
                    : {
                        apiUrl: data.apiResource === "sprintStories" ? sprintStoriesUrl(selected?.url || "", projectId, String(triggerInput?.sprint_id || "")) : selected?.url || "",
                        apiMethod: data.apiResource === "sprintStories" || kind === "webAgent" ? "GET" : selected?.methods[0] || "GET",
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
          <button type="button" className="ghost-button" disabled={connections.isFetching} onClick={() => void connections.refetch()}><IconRefresh size={14} />Refresh connections</button>
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
          <Link to={kind === "mcpTool" ? "/mcp-servers" : "/integrations?provider=http"} target="_blank" rel="noreferrer" className="studio-caption">Manage this provider in Integrations</Link>
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
            (kind === "webAgent" || data.apiResource === "sprintStories"
              ? ["GET"]
              : connection?.methods || ["GET", "HEAD"]
            ).map((value) => [value, value]),
            "GET",
          )}
          {data.apiResource === "sprintStories" ? <>
            <label><span>Endpoint URL</span><textarea aria-label="Endpoint URL" rows={3} readOnly spellCheck={false} value={sprintStoriesUrl(String(data.apiUrl || connection?.url || ""), projectId, String(triggerInput?.sprint_id || ""))} placeholder="Choose the HelloTest API connection" /></label>
            <p className="studio-caption">Current project and trigger Sprint. All cursor pages are read, up to 100 Stories. Larger Sprints stop with an explicit limit. Authentication uses the managed connection.</p>
          </> : field(
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
            are not followed. Use <code>{"{{ $input.id }}"}</code> in the endpoint and <code>"$input.id"</code> in the JSON body.
            {!["GET", "HEAD", "OPTIONS"].includes(String(data.apiMethod || "GET")) ? " This request can change the remote system and runs once. If its response is lost, verify the saved operation receipt and remote outcome before sending it again." : ""}
          </p>
        </>
      ) : null}
      {kind === "mcpTool" ? (
        <>
          {connection && <p className="studio-caption">{connection.serverInfo?.name || connection.name} · Streamable HTTP<br />{connection.url}<br />{connection.tools.length} enabled tools{connection.discovered_at ? " · saved server catalog" : ""}</p>}
          {canRun ? <button
            type="button"
            className="ghost-button"
            disabled={!connection || mcp.isFetching}
            onClick={() => void mcp.refetch()}
          >
            <IconRefresh size={15} />
            {mcp.isFetching ? "Reading server tools…" : connection?.toolDefinitions?.length ? "Refresh server tools" : "Load server tools"}
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
            ...availableTools.map((item) => [item.name, item.name] as [string, string]),
          ])}
          {tool?.description ? (
            <p className="studio-caption">{tool.description}</p>
          ) : null}
          {data.mcpTool && connection && !availableTools.some(item => item.name === data.mcpTool) && <p role="alert">This tool is no longer enabled. Choose a current server tool or update the provider in Integrations.</p>}
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
      {kind === "condition" ? <WorkflowConditionFields data={data} onChange={onChange} /> : null}
      {kind === "aggregator" ? <>
        {select("mergeMode", "Merge inputs", [["waitAllAppend", "Wait for all · append items"], ["waitAllMerge", "Wait for all · combine fields"]], "waitAllAppend")}
        <p className="studio-caption">Waits for connected branches. Combine fields preserves conflicting values in connection order instead of overwriting them.</p>
      </> : null}
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
              ["storyPackets", "Native Story pipeline"],
            ],
            "transform",
          )}
          {data.loopAction === "customAI" ? (
            <>
              <p className="studio-caption">
                The current item and its index are passed to your configured
                project model. Each result remains available in Output.
              </p>
            </>
          ) : null}
          <p className="studio-caption">
            Items run sequentially inside this node. Native Story pipelines support up to 100 Stories; other actions support 10 items, within
            this node's timeout. The next node receives the collected results.
          </p>
        </>
      ) : null}
      {kind === "transform" ||
      (kind === "loop" && !["customAI", "storyPackets"].includes(String(data.loopAction))) ? (
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
