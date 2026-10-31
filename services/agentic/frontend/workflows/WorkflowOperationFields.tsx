import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { IconPlugConnected, IconRefresh } from "@tabler/icons-react";
import type { AgenticWorkflowNodeData } from "@hellotest/platform/frontend/src/types";
import { agenticApi } from "../api.client";
import { WorkflowConditionFields } from "./WorkflowConditionFields";
import { WorkflowDataOperationFields } from "./WorkflowDataOperationFields";
import { nativeTaskDefaults, nativeTaskProfiles, nativeTaskResetPatch } from "./nativeTaskProfiles";
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
  const automation = kind === "artifactTask" && data.artifactTask === "automation-engineer";
  const usesConnection = [
    "apiTool",
    "apiAgent",
    "webAgent",
    "mcpTool",
  ].includes(kind);
  const connections = useQuery({
    queryKey: ["workflow-connections", projectId],
    queryFn: () => agenticApi.agenticWorkflows.connections(projectId),
    enabled: Boolean(projectId && (usesConnection || automation)),
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
          value={typeof data[key] === "object" && data[key] !== null ? JSON.stringify(data[key], null, 2) : String(data[key] ?? "")}
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
        onChange={(event) => onChange({ [key]: event.target.value,
          ...(key === "mergeMode" && event.target.value === "combineMatching" && data.mergeMatchFields == null ? { mergeMatchFields: '[{"left":"id","right":"id"}]' } : {}),
          ...(key === "loopAction" && event.target.value === "transform" && data.transformMapping == null ? { transformMapping: '{\n  "item": "$item"\n}' } : {}),
        })}
      >
        {options.map(([value, title]) => (
          <option value={value} key={value}>
            {title}
          </option>
        ))}
      </select>
    </label>
  );
  const number = (key: string, label: string, min: number, max: number, fallback: number) => <label><span>{label}</span><input type="number" aria-label={label} min={min} max={max} step={1} value={String(data[key] ?? fallback)} onChange={event => onChange({ [key]: event.target.value === "" ? "" : Number(event.target.value), ...(key === "waitMs" && Number(event.target.value) >= Number(data.timeoutMs || 30000) ? { timeoutMs: String(Number(event.target.value) + 1000) } : {}) })} /></label>;
  const checkbox = (key: string, label: string, fallback = false) => <label className="studio-checkbox"><input type="checkbox" checked={typeof data[key] === "boolean" ? data[key] : fallback} onChange={event => onChange({ [key]: event.target.checked })} /><span>{label}</span></label>;
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
          <button type="button" className="ghost-button" onClick={() => onChange(nativeTaskResetPatch(String(data.artifactTask || "story-assurance")))}>Restore task defaults</button>
          <p className="studio-caption">This saved node owns its instructions, guardrails and model settings. Admin AI Controls do not change this task. Project access, source traceability and native output validation are always enforced.</p>
        </div>
        {data.artifactTask === "test-case-generation" && <div className="studio-parameter-group">
          <h4>Case generation</h4>
          <label><span>Test Cases per Story</span><input type="number" aria-label="Test Cases per Story" min={1} max={10} step={1}
            value={String(data.maxCasesPerStory ?? triggerInput?.max_cases_per_story ?? 5)}
            onChange={event => onChange({ maxCasesPerStory: event.target.value === "" ? "" : Number(event.target.value) })} /></label>
          {select("authoringMode", "Test Case format", [["structured", "Structured steps"], ["gherkin", "Gherkin scenarios"]], String(triggerInput?.authoring_mode || "structured"))}
          {field("generationInstructions", "Generation guidance (optional)", true, "Additional coverage or test data requirements")}
          <p className="studio-caption">Uses the current Story title, description and acceptance criteria. Saved cases are AI generated and pending review.</p>
        </div>}
        {automation && <div className="studio-parameter-group">
          <h4>Application and test data</h4>
          {field("automationStartUrl", "Application URL", false, "https://your-application.example")}
          {field("automationUsername", "Username (optional)", false)}
          <label><span>Password connection</span><select aria-label="Password connection" value={String(data.automationCredentialId || "")} onChange={event => onChange({ automationCredentialId: event.target.value })}>
            <option value="">No password · use case parameters</option>
            {data.automationCredentialId && !connections.data?.some(item => item.id === data.automationCredentialId && item.authType === "basic") ? <option value={String(data.automationCredentialId)}>Unavailable credential · choose another</option> : null}
            {connections.data?.filter(item => item.kind === "http" && item.authType === "basic" && item.authenticated).map(item => <option key={item.id} value={item.id}>{item.name}{item.username ? ` · ${item.username}` : ""}</option>)}
          </select></label>
          <div className="studio-parameter-actions"><Link to="/integrations?provider=http" target="_blank" rel="noreferrer" className="studio-caption">Manage passwords</Link><button type="button" className="ghost-button compact" disabled={connections.isFetching} onClick={() => void connections.refetch()}><IconRefresh size={14} />Refresh</button></div>
          {connections.isError ? <p role="alert">Password connections could not be loaded. Refresh to retry.</p> : null}
          <p className="studio-caption">Add an HTTP connection with Basic authentication for this application URL. Its protected password is supplied as @t.password; the username uses @t.username.</p>
          {field("automationData", "Test data JSON", true, '{"invoice_id":"known-invoice","region":"EU"}')}
          <p className="studio-caption">JSON object, up to 16 KB. Values override matching case parameters. Use parameter references for sensitive data. Each case is built in order; failures preserve completed cases and continue.</p>
        </div>}
        {automation && <label className="studio-checkbox"><input type="checkbox" checked={data.inspectBrowser !== false} onChange={event => onChange({ inspectBrowser: event.target.checked })} /><span>Inspect the browser before building</span><small>Uses the application URL in read-only mode. API-only cases use their contracts directly.</small></label>}
        {automation && <>
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
          {data.apiResource === "sprintStories" && <Link to="/admin-space?section=settings#api-keys" target="_blank" rel="noreferrer" className="studio-caption">Settings → API Keys</Link>}
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
      {kind === "dataOperation" ? <WorkflowDataOperationFields data={data} onChange={onChange} /> : null}
      {kind === "wait" ? <>{number("waitMs", "Wait duration (ms)", 0, 60000, 1000)}<p className="studio-caption">Pauses this branch for up to 60 seconds. Other independent branches can continue in parallel. The timeout increases when needed to include the wait.</p></> : null}
      {kind === "stop" ? <>{field("stopMessage", "Error message", true)}<p className="studio-caption">Stops execution with this message. Connect it to a condition or switch branch that should fail.</p></> : null}
      {kind === "aggregator" ? <>
        {select("mergeMode", "Merge inputs", [["waitAllAppend", "Append items"], ["combinePosition", "Combine by position"], ["combineMatching", "Combine by matching fields"], ["combineAll", "All combinations"], ["chooseInput", "Choose one input"], ["waitAllMerge", "Combine branch objects (legacy)"]], "waitAllAppend")}
        {data.mergeMode === "combineMatching" && <>
          {field("mergeMatchFields", "Matching fields JSON", true, '[{"left":"id","right":"id"}]')}
          {select("mergeJoin", "Include matches", [["inner", "Matching items"], ["left", "All input 1 items"], ["right", "All input 2 items"], ["outer", "All items"], ["nonMatches", "Only unmatched items"]], "inner")}
          {select("mergeMultiple", "Multiple matches", [["all", "Keep all matches"], ["first", "Use the first match"]], "all")}
        </>}
        {data.mergeMode === "combinePosition" && checkbox("mergeIncludeUnpaired", "Include unpaired items")}
        {["combinePosition", "combineMatching", "combineAll"].includes(String(data.mergeMode)) && <>
          {select("mergeClash", "When fields have the same name", [["preferLast", "Prefer input 2"], ["preferFirst", "Prefer input 1"], ["keepBoth", "Keep both values"]], "preferLast")}
          {checkbox("mergeDeep", "Merge nested objects", true)}
        </>}
        {data.mergeMode === "chooseInput" && select("mergeChooseInput", "Return input", [["1", "Input 1"], ["2", "Input 2"]], "1")}
        <p className="studio-caption">Waits until connected branches finish or are skipped. Append preserves connection order. Combine and choose operations use two inputs; connect them to the numbered ports. Skipped branches contribute no items.</p>
        {data.mergeMode === "combineAll" && <p className="studio-notice">Pairs every item from input 1 with every item from input 2. Output grows with both inputs and must stay within the execution item limit.</p>}
      </> : null}
      {kind === "loop" ? (
        <>
          {select(
            "loopAction",
            "Action for each item",
            [
              ["workflow", "Connected workflow steps"],
              ["transform", "Map fields"],
              ["customAI", "AI review"],
              ["storyPackets", "Native Story pipeline"],
            ],
            "transform",
          )}
          {field("loopSourceKey", "Items path", false, "input.items")}
          {number("loopMaxIterations", "Maximum items", 1, ["workflow", "storyPackets"].includes(String(data.loopAction)) ? 100 : 10, 10)}
          {data.loopAction === "workflow" && <>
            {number("loopBatchSize", "Batch size", 1, 100, 1)}
            <p className="studio-caption">Connect <strong>loop</strong> to the first body step and return the last body step to <strong>continue</strong>. Connect <strong>done</strong> to the step that receives all completed batch results. Batches run in order; the body must return before the next batch starts.</p>
            <p className="studio-caption"><code>$input</code> is the current batch array. With batch size 1, <code>$item</code> is the item. Iteration metadata includes index, number, total and batch_size. The item limit rejects larger inputs instead of silently dropping items.</p>
            <p className="studio-caption">This node's timeout covers every batch and body step. The remaining workflow deadline also applies; adjust both in Execution settings and Workflow settings for longer jobs.</p>
          </>}
          {data.loopAction === "customAI" ? (
            <>
              <p className="studio-caption">
                The current item and its index are passed to your configured
                project model. Each result remains available in Output.
              </p>
            </>
          ) : null}
          {data.loopAction !== "workflow" && <p className="studio-caption">
            Items run sequentially inside this node. Native Story pipelines support up to 100 Stories; other actions support 10 items, within
            this node's timeout. The next node receives the collected results.
          </p>}
        </>
      ) : null}
      {kind === "transform" ||
      (kind === "loop" && !["workflow", "customAI", "storyPackets"].includes(String(data.loopAction))) ? (
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
