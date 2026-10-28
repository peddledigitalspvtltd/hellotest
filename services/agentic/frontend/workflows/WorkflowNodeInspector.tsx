import { WorkflowOperationFields } from "./WorkflowOperationFields";
import { WorkflowNodeIcon } from "./WorkflowNodeIcon";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useDialogFocus } from "@hellotest/platform/frontend/src/shared/hooks/useDialogFocus";
import {
  IconX,
  IconArrowsMaximize,
  IconPlayerPlay,
  IconTrash,
} from "@tabler/icons-react";
import type {
  AgenticWorkflowNode,
  AgenticWorkflowNodeData,
  AgenticWorkflowRun,
} from "@hellotest/platform/frontend/src/types";
import { HELLOTEST_AGENT_CATALOG } from "../components/AgenticExperience";
import { REPOSITORY_AGENTS } from "../agents/RepositoryAgents";
import { SmartContextWorkbench } from "@hellotest/ai/frontend/components/SmartContextWorkbench";
import { projectAgentNode, type ProjectAgent } from "../agents/agentDefinitions";
import { WorkflowSkills } from "./WorkflowSkills";
import { specialistDefaults } from "./specialistProfiles";
import { WorkflowDataView } from "./WorkflowDataView";
import { WorkflowExecutionLog, executionDuration } from "./WorkflowExecutionLog";
import { EXECUTABLE_NODE_KINDS } from "./WorkflowCanvas";
import {
  nodeKindLabels,
  buildNodeDefaults,
  type WorkflowNodeKind,
} from "./workflowGraph";

export type WorkflowNodeInspectorProps = {
  node: AgenticWorkflowNode;
  incoming: AgenticWorkflowNode[];
  result?: Record<string, unknown>;
  run?: AgenticWorkflowRun | null;
  editable: boolean;
  canRun: boolean;
  busy: boolean;
  expanded: boolean;
  collapsible?: boolean;
  stale?: boolean;
  projectId: string;
  projectAgents?: ProjectAgent[];
  appTypeId: string;
  canKnowledge: boolean;
  providers: Array<{ value: string; label: string; modelLabel: string }>;
  onChange: (patch: Partial<AgenticWorkflowNodeData>) => void;
  onExecute: () => void;
  onDelete: () => void;
  onClose: () => void;
  onExpand: () => void;
  onOpenReview?: (agent: string, session: string) => void;
  onOpenSource?: (agent: string, run: string) => void;
  onTestApi?: () => void;
  testingApi?: boolean;
};
export function WorkflowNodeInspector(props: WorkflowNodeInspectorProps) {
  const { node, result, run, editable, expanded, incoming } = props;
  const registeredAgent = props.projectAgents?.find(agent => agent.id === node.data.agentId);
  const [tab, setTab] = useState<"parameters" | "input" | "output" | "logs">(
    "parameters",
  );
  const contentRef = useRef<HTMLDivElement>(null);
  const expandButtonRef = useRef<HTMLButtonElement>(null);
  const wasExpanded = useRef(expanded);
  const [advanced, setAdvanced] = useState("");
  const [error, setError] = useState("");
  const root = useDialogFocus<HTMLElement>({
    active: expanded,
    onClose: props.onExpand,
  });
  useEffect(() => {
    // Moving the inspector into its portal replaces the original trigger.
    // Return focus to the newly mounted trigger when the dialog collapses.
    if (wasExpanded.current && !expanded) expandButtonRef.current?.focus();
    wasExpanded.current = expanded;
  }, [expanded]);
  useEffect(() => {
    setTab(run ? "output" : "parameters");
    setError("");
    if (contentRef.current) contentRef.current.scrollTop = 0;
    setAdvanced(JSON.stringify(node.data, null, 2));
  }, [node.id, run?.id]);
  const kind = String(node.data.kind || "agent");
  const specialist = ["agent", "llmAgent", "customAI"].includes(kind) || (kind === "loop" && node.data.loopAction === "customAI");
  const canRetry = specialist || (["apiTool", "apiAgent", "webAgent"].includes(kind) && ["GET", "HEAD"].includes(kind === "webAgent" ? "GET" : String(node.data.apiMethod || "GET")));
  const recordedInput = result && Object.prototype.hasOwnProperty.call(result, "input") ? result.input : result?.input_context;
  const inputContext = recordedInput && typeof recordedInput === "object" && !Array.isArray(recordedInput) ? recordedInput as Record<string, unknown> : undefined;
  const progress = result?.progress as
    | {
        repository_run_id?: string;
        repository_agent_type?: string;
        percent?: number;
        stages?: Array<{
          id: string;
          label: string;
          status: string;
          detail?: string;
        }>;
      }
    | undefined;
  const output = result?.output as Record<string, unknown> | undefined;
  const splitData = expanded && tab !== "logs" && (!run || editable || tab !== "parameters");
  const field = (name: string, label: string, multiline = false) => (
    <label>
      <span>{label}</span>
      {multiline ? (
        <textarea
          aria-label={label}
          value={String(node.data[name] || "")}
          onChange={(event) => props.onChange({ [name]: event.target.value })}
          rows={4}
        />
      ) : (
        <input
          aria-label={label}
          value={String(node.data[name] || "")}
          onChange={(event) => props.onChange({ [name]: event.target.value })}
        />
      )}
    </label>
  );
  const input = (
    <section className="studio-inspector-pane" aria-label="Node input">
      <h3>Input</h3>
      <p className="studio-caption">
        {incoming.length
          ? `Connected from ${incoming.map((item) => item.data.label || item.id).join(", ")}`
          : "Workflow request"}
      </p>
      <WorkflowDataView
        value={inputContext && Object.prototype.hasOwnProperty.call(inputContext, "input") ? inputContext.input : recordedInput}
        pathPrefix="$input"
        defaultMode={run ? "json" : "readable"}
        jsonLabel="Node input JSON"
        empty={
          run ? "No input was recorded for this step." : incoming.length
            ? "Execute this step to receive upstream data. Required preceding steps will run first."
            : "The manual trigger receives your workflow input."
        }
      />
      {inputContext && Object.prototype.hasOwnProperty.call(inputContext, "input") && <details><summary>Recorded input context and prompt</summary><WorkflowDataView value={inputContext} defaultMode={run ? "json" : "readable"} jsonLabel="Recorded input context JSON" /></details>}
    </section>
  );
  const outputPane = (
    <section className="studio-inspector-pane" aria-label="Node output">
      <h3>Output</h3>
      {props.stale && (
        <p className="studio-notice">
          The definition has changed. Run again to refresh this result.
        </p>
      )}
      {run && run.execution_mode !== "review" && (
        <p className="studio-notice">
          Preview data. No model or workflow tool was executed.
        </p>
      )}
      {result && (
        <p className="studio-caption" role="status">
          {String(result.status).replace(/_/g, " ")} ·{" "}
          {String(result.attempts || 0)}{" "}
          {Number(result.attempts) === 1 ? "attempt" : "attempts"}
          {result.started_at ? ` · ${executionDuration(result.started_at, result.completed_at)}` : ""}
        </p>
      )}
      {progress && (
        <div className="studio-source-progress">
          <progress
            max={100}
            value={Number(progress.percent) || 0}
            aria-label="Source analysis progress"
          />
          <ol>
            {progress.stages?.map((stage) => (
              <li key={stage.id}>
                <strong>{stage.label}</strong>
                <span>{stage.status.replace(/_/g, " ")}</span>
                {stage.detail && <small>{stage.detail}</small>}
              </li>
            ))}
          </ol>
          {!output && progress.repository_run_id && props.onOpenSource && (
            <button
              className="ghost-button"
              type="button"
              onClick={() =>
                props.onOpenSource?.(
                  String(progress.repository_agent_type),
                  String(progress.repository_run_id),
                )
              }
            >
              Open source analysis
            </button>
          )}
        </div>
      )}
      <WorkflowDataView
        value={output}
        defaultMode={run ? "json" : "readable"}
        jsonLabel="Node output JSON"
        empty={
          result?.status === "running"
            ? "This step is running. Output appears here when it completes."
            : result?.status === "skipped"
              ? String(result.skip_reason || "This step was not reached.")
              : run ? "No output was recorded for this step." : undefined
        }
      />
      {output?.session_id && props.onOpenReview ? (
        <button
          type="button"
          className="ghost-button"
          onClick={() =>
            props.onOpenReview?.(
              String(output.specialist_id || node.data.agentId),
              String(output.session_id),
            )
          }
        >
          Open saved review and sources
        </button>
      ) : null}
      {output?.repository_run_id && props.onOpenSource ? (
        <button
          type="button"
          className="ghost-button"
          onClick={() =>
            props.onOpenSource?.(
              String(output.repository_agent_type),
              String(output.repository_run_id),
            )
          }
        >
          Review source analysis
        </button>
      ) : null}
      {result?.error ? (
        <p role="alert" className="studio-notice">
          {typeof result.error === "string"
            ? result.error
            : JSON.stringify(result.error)}
        </p>
      ) : null}
    </section>
  );
  const parameters = (
    <section className="studio-inspector-pane">
      <h3 className="studio-parameter-title">
        <WorkflowNodeIcon kind={kind} size={19} />
        Parameters
      </h3>
      {!EXECUTABLE_NODE_KINDS.has(kind) && (
        <p className="studio-notice">
          This node is available for graph previews. It cannot execute in a
          review workflow.
        </p>
      )}
      <fieldset disabled={!editable || props.busy}>
        {field("label", "Node name")}
        <label>
          <span>Step kind</span>
          <select
            aria-label="Step kind"
            value={kind}
            onChange={(event) =>
              props.onChange({
                ...Object.fromEntries(
                  Object.keys(node.data).map((key) => [key, undefined]),
                ),
                ...buildNodeDefaults(event.target.value as WorkflowNodeKind, 0),
                label: node.data.label,
              })
            }
          >
            {Object.entries(nodeKindLabels).map(([value, label]) => (
              <option value={value} key={value}>
                {label}
                {EXECUTABLE_NODE_KINDS.has(value) ? "" : " · preview only"}
              </option>
            ))}
          </select>
        </label>
        {kind === "artifactTask" && <p className="studio-caption">Uses the native Story and Test Case services. Connected Story packets move through each task. Sprint Automator saves generated Test Cases to the Library as AI generated and pending review when automatic publication is enabled.</p>}
        {kind === "artifactTask" && <label><span>Model connection</span><select value={String(node.data.llmIntegrationId || "")} onChange={event => props.onChange({ llmIntegrationId: event.target.value })}><option value="">Trigger model or configured feature default</option>{props.providers.filter(item => item.value).map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>}
        {specialist && (
          <>
            {kind !== "customAI" && kind !== "loop" && (
              <label>
                <span>Specialist</span>
                <select
                  value={String(node.data.agentId || "")}
                  onChange={(event) => {
                    const saved = props.projectAgents?.find(agent => agent.id === event.target.value);
                    props.onChange(saved ? projectAgentNode(saved) : { ...specialistDefaults(event.target.value), agentVersion: undefined, agentSnapshot: undefined });
                  }}
                >
                  <option value="">Choose a specialist</option>
                  {String(node.data.agentId || "").startsWith("agent-") && !props.projectAgents?.some(agent => agent.id === node.data.agentId) && <option value={String(node.data.agentId)}>Unavailable project agent · choose another</option>}
                  {(props.projectAgents || []).map(agent => <option value={agent.id} key={agent.id}>{(agent.active_definition || agent.definition).name} · v{agent.active_version}</option>)}
                  {HELLOTEST_AGENT_CATALOG.map((agent) => (
                    <option value={agent.id} key={agent.id}>
                      {agent.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <p className="studio-caption">LLM required. Model failures stop this step; results include evidence and completion checks.{node.data.agentVersion ? ` This node uses saved agent version ${node.data.agentVersion}. Reselect the agent to adopt its latest active version.` : ""}</p>
            {registeredAgent && registeredAgent.active_version !== node.data.agentVersion && <button type="button" className="ghost-button" onClick={() => props.onChange(projectAgentNode(registeredAgent))}>Use active version {registeredAgent.active_version}</button>}
            {field(
              "prompt",
              kind === "customAI" ? "Your AI task" : kind === "loop" ? "Task for each item" : "Task",
              true,
            )}
            {field("instructions", kind === "loop" ? "Per-item instructions" : "Instructions", true)}
            <WorkflowSkills data={node.data} projectId={props.projectId} appTypeId={props.appTypeId} disabled={!editable || props.busy} onChange={props.onChange} />
            <label>
              <span>Model connection</span>
              <select
                value={String(node.data.llmIntegrationId || "")}
                onChange={(event) =>
                  props.onChange({
                    llmIntegrationId: event.target.value,
                    model:
                      props.providers.find(
                        (item) => item.value === event.target.value,
                      )?.modelLabel || "",
                  })
                }
              >
                {props.providers.map((item) => (
                  <option value={item.value} key={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
            <details>
              <summary>Grounding and context</summary>
              {field("knowledgeScope", "Evidence scopes")}
              {field("knowledgeQuery", "Retrieval query")}
              {field("contextInstructions", "Additional context", true)}
              {props.canKnowledge && (
                <SmartContextWorkbench
                  projectId={props.projectId}
                  appTypeId={props.appTypeId}
                  initialQuery={String(
                    node.data.knowledgeQuery || node.data.prompt || "",
                  )}
                  disabled={!editable || props.busy}
                  onApply={(selection) =>
                    props.onChange({
                      knowledgeSourceIds: selection.sourceIds,
                      knowledgeQuery: selection.query,
                      knowledgeSourceKinds: selection.sourceKinds,
                    })
                  }
                />
              )}
            </details>
          </>
        )}
        {kind === "repositoryAgent" && (
          <>
            <label><span>LLM provider</span><select value={String(node.data.llmIntegrationId || "")} onChange={event => props.onChange({ llmIntegrationId: event.target.value })}>{props.providers.map(provider => <option key={provider.value} value={provider.value}>{provider.label}</option>)}</select><small>An active model must review the extracted source findings.</small></label>
            <label>
              <span>Source agent</span>
              <select
                value={String(node.data.repositoryAgentType || "")}
                onChange={(event) =>
                  props.onChange({ repositoryAgentType: event.target.value })
                }
              >
                <option value="">Choose a source agent</option>
                {REPOSITORY_AGENTS.map((agent) => (
                  <option key={agent.id} value={agent.id}>
                    {agent.name}
                  </option>
                ))}
              </select>
            </label>
            <p className="studio-caption">
              Uses the existing source analysis pipeline: fetch, inspect, derive
              and validate. Set the GitHub URL and optional saved integration in
              Workflow input. Findings remain drafts for human review.
            </p>
          </>
        )}
        <WorkflowOperationFields
          data={node.data}
          projectId={props.projectId}
          canRun={props.canRun}
          onChange={props.onChange}
        />
        {kind === "trigger" && (
          <p className="studio-caption">
            Starts manually with the JSON object in Workflow input. Connect its
            output to your first step.
          </p>
        )}
        {["aggregator", "output"].includes(kind) && (
          <p className="studio-caption">
            Collects every connected review. Results and source analyses remain
            available for inspection; publishing is a separate action.
          </p>
        )}
        {field("summary", "Description", true)}
        <details>
          <summary>Execution settings</summary>
          <label><span>Timeout (ms)</span><input type="number" min={1000} max={kind === "artifactTask" ? 3600000 : kind === "repositoryAgent" ? 180000 : kind === "agent" || kind === "customAI" ? 150000 : 70000} step={1000} value={String(node.data.timeoutMs ?? "")} onChange={event => props.onChange({ timeoutMs: event.target.value })} /></label>
          <label>
            <span>On error</span>
            <select
              aria-label="On error"
              value={String(node.data.onError || "stop")}
              onChange={(event) =>
                props.onChange({ onError: event.target.value })
              }
            >
              <option value="stop">Stop workflow</option>
              <option value="errorOutput">Route to error handler</option>
            </select>
          </label>
          {canRetry ? <>
            <label><span>Retries</span><select aria-label="Retries" value={String(node.data.retryCount || "0")} onChange={event => props.onChange({ retryCount: event.target.value })}><option value="0">No automatic retries</option><option value="1">Retry once</option><option value="2">Retry twice</option></select></label>
            <label><span>Retry delay (ms)</span><input type="number" min={0} max={10000} step={100} value={String(node.data.retryDelayMs ?? 500)} onChange={event => props.onChange({ retryDelayMs: event.target.value })} /></label>
            <p className="studio-caption">Only transient failures retry, within this step's timeout. Each retry and its delay appear in the log.</p>
          </> : <p className="studio-caption">This node runs once per execution. Automatic retries are unavailable for operations that may change data.</p>}
          {!canRetry && Number(node.data.retryCount) > 0 && <button type="button" className="ghost-button" onClick={() => props.onChange({ retryCount: "0" })}>Clear unsupported retries</button>}
          <label><span>Logging</span><select aria-label="Logging" value={String(node.data.logLevel || "standard")} onChange={event => props.onChange({ logLevel: event.target.value })}><option value="standard">Standard · events and errors</option><option value="audit">Audit · include sizes and source IDs</option></select></label>
          {field("outputKey", "Output label")}
          <p className="studio-caption">
            Failed steps stop by default. Connect an Error handler to recover.
            Source analysis and MCP calls run once.
          </p>
        </details>
        <details
          onToggle={(event) => {
            if (event.currentTarget.open)
              setAdvanced(JSON.stringify(node.data, null, 2));
          }}
        >
          <summary>Advanced configuration</summary>
          <p className="studio-caption">
            Existing preview and tool settings are preserved here. Readiness
            validates all settings before execution.
          </p>
          <label>
            <span>Node configuration JSON</span>
            <textarea
              rows={10}
              value={advanced}
              onChange={(event) => setAdvanced(event.target.value)}
            />
          </label>
          {editable && (
            <button
              className="ghost-button"
              type="button"
              onClick={() => {
                try {
                  const parsed = JSON.parse(advanced);
                  if (
                    !parsed ||
                    Array.isArray(parsed) ||
                    typeof parsed !== "object"
                  )
                    throw Error("Enter a JSON object.");
                  props.onChange({
                    ...Object.fromEntries(
                      Object.keys(node.data).map((key) => [key, undefined]),
                    ),
                    ...parsed,
                  });
                  setError("");
                } catch (failure) {
                  setError(
                    failure instanceof Error
                      ? failure.message
                      : "Invalid configuration",
                  );
                }
              }}
            >
              Apply configuration
            </button>
          )}
          {error && <p role="alert">{error}</p>}
        </details>
      </fieldset>
      {["apiTool", "apiAgent"].includes(kind) &&
        props.onTestApi &&
        props.canRun && (
          <>
            <p className="studio-caption">
              Testing sends a real HTTP request. Workflow graph previews do not
              call this endpoint. Mapped requests run their preceding steps to resolve input.
            </p>
            <button
              type="button"
              className="ghost-button"
              disabled={props.busy || props.testingApi}
              onClick={props.onTestApi}
            >
              {props.testingApi ? "Testing API…" : "Test API output"}
            </button>
            {node.data.apiTestOutput ? (
              <WorkflowDataView value={String(node.data.apiTestOutput)} />
            ) : null}
          </>
        )}
    </section>
  );
  const inspector = (
    <>
      {expanded && (
        <div
          className="studio-inspector-backdrop"
          aria-hidden="true"
          onClick={props.onExpand}
        />
      )}
      <aside
        ref={root}
        tabIndex={-1}
        className={`studio-inspector ${props.collapsible ? "is-execution-inspector" : ""} ${expanded ? "workflow-studio is-expanded" : ""}`}
        role={expanded ? "dialog" : undefined}
        aria-modal={expanded || undefined}
        aria-label={`Inspect ${node.data.label || node.id}`}
      >
        <header>
          <div>
            <small>{nodeKindLabels[kind as WorkflowNodeKind] || kind}</small>
            <strong>{String(node.data.label || "Node details")}</strong>
          </div>
          <button
            ref={expandButtonRef}
            type="button"
            className="studio-icon-button"
            aria-label={
              expanded ? "Collapse node details" : "Expand node details"
            }
            title={expanded ? "Collapse node details" : "Expand input and output"}
            onClick={props.onExpand}
          >
            <IconArrowsMaximize size={17} />
          </button>
          {(editable || !run || expanded || props.collapsible) && (
            <button
              type="button"
              className="studio-icon-button"
              aria-label={props.collapsible && !expanded ? "Hide node details" : "Close node details"}
              onClick={props.onClose}
            >
              <IconX size={18} />
            </button>
          )}
        </header>
        <nav aria-label="Node details">
          {(["parameters", "input", "output", "logs"] as const).map((item) => (
            <button
              key={item}
              type="button"
              aria-pressed={tab === item}
              onClick={() => setTab(item)}
            >
              {item[0].toUpperCase() + item.slice(1)}
            </button>
          ))}
        </nav>
        <div
          ref={contentRef}
          className={`studio-inspector-content ${splitData ? run && !editable ? "is-two-pane" : "is-three-pane" : ""}`}
        >
          {splitData ? (
            <>
              {input}
              {(!run || editable) && parameters}
              {outputPane}
            </>
          ) : tab === "input" ? (
            input
          ) : tab === "output" ? (
            outputPane
          ) : tab === "logs" ? (
            <section className="studio-inspector-pane">
              <h3>Execution log</h3>
              <WorkflowExecutionLog logs={result?.logs} />
            </section>
          ) : (
            parameters
          )}
        </div>
        {(editable || props.canRun) && (
          <footer>
            {editable && (
              <button
                type="button"
                className="studio-icon-button"
                disabled={props.busy}
                aria-label="Delete selected node"
                onClick={props.onDelete}
              >
                <IconTrash size={17} />
              </button>
            )}
            {props.canRun && EXECUTABLE_NODE_KINDS.has(kind) && (
              <button
                type="button"
                className="primary-button"
                disabled={props.busy}
                onClick={props.onExecute}
              >
                <IconPlayerPlay size={16} />
                Execute step
              </button>
            )}
            {props.canRun && <small>Preceding steps run first.</small>}
          </footer>
        )}
      </aside>
    </>
  );
  // Expanded execution details must sit outside the execution dialog: its
  // focus manager correctly makes the parent inert while this dialog is open.
  return expanded ? createPortal(inspector, document.body) : inspector;
}
