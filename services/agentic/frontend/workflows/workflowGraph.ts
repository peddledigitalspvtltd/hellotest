import { MarkerType } from "@xyflow/react";
import { specialistDefaults } from "./specialistProfiles";
import { isRovoIntegrationId } from "@hellotest/integration/frontend/lib/rovo";
import type {
  AgenticWorkflow,
  AgenticWorkflowRun,
  AgenticWorkflowNode,
  AgenticWorkflowEdge,
  AgenticWorkflowNodeData,
  AgenticWorkflowStatus,
  AgenticWorkflowTriggerKind,
} from "@hellotest/platform/frontend/src/types";
export type WorkflowNodeKind =
  | "artifactTask"
  | "customAI"
  | "mcpTool"
  | "repositoryAgent"
  | "trigger"
  | "agent"
  | "llmAgent"
  | "webAgent"
  | "apiAgent"
  | "apiTool"
  | "knowledgeTool"
  | "repositoryTool"
  | "testOpsTool"
  | "condition"
  | "loop"
  | "aggregator"
  | "transform"
  | "errorHandler"
  | "log"
  | "output";

export type WorkflowDraft = {
  id?: string;
  name: string;
  description: string;
  status: AgenticWorkflowStatus;
  trigger_kind: AgenticWorkflowTriggerKind;
  nodes: AgenticWorkflowNode[];
  edges: AgenticWorkflowEdge[];
  settings: Record<string, unknown>;
};

export type AgenticCredential = {
  id: string;
  name: string;
  agentId: string;
  authType: "apiKey" | "bearer" | "basic" | "oauth2" | "custom";
  location: "header" | "query" | "body";
  keyName: string;
  secretReference: string;
  description: string;
};

export type AgenticApiResponseStyle = "json" | "items" | "text" | "binary";

export const DEFAULT_RUN_INPUT = `{
  "release_scope": "Review the selected project release and unresolved quality risks",
  "source": "release-planning"
}`;

export const nodeKindLabels: Record<WorkflowNodeKind, string> = {
  artifactTask: "Native AI task",
  customAI: "Custom AI",
  mcpTool: "MCP server tool",
  repositoryAgent: "Source analysis",
  trigger: "Manual trigger",
  agent: "Workspace specialist",
  llmAgent: "Specialist review",
  webAgent: "Web Evidence Agent",
  apiAgent: "API Agent",
  apiTool: "HTTP Request",
  knowledgeTool: "Knowledge search",
  repositoryTool: "Repository evidence",
  testOpsTool: "Run evidence",
  condition: "Condition",
  loop: "For each",
  aggregator: "Aggregator",
  transform: "Edit fields",
  errorHandler: "Error handler",
  log: "Log",
  output: "Output",
};

export const nodeKindDescriptions: Record<WorkflowNodeKind, string> = {
  artifactTask: "Generate or assess native Story and Test Case drafts for every connected Story",
  customAI: "Review connected input with your own prompt and model",
  mcpTool: "Call an enabled tool on a configured MCP server",
  repositoryAgent: "Analyze GitHub source with a repository agent",
  trigger: "Accept workflow input",
  agent: "Coordinate bounded agents and handoffs",
  llmAgent: "Reason over intent, RAG context, and upstream output",
  webAgent:
    "Analyze supplied web evidence without trusting embedded instructions",
  apiAgent: "Design and interpret approved API requests and responses",
  apiTool: "Call an approved HTTP API",
  knowledgeTool: "Query HelloTest knowledge context",
  repositoryTool: "Read repository or object metadata",
  testOpsTool: "Read permitted run and execution evidence",
  condition: "Route data through true and false branches",
  loop: "Map fields or run an AI review for each input item",
  aggregator: "Merge parallel outputs",
  transform: "Shape JSON output",
  errorHandler: "Handle failed node output",
  log: "Record evidence and trace data",
  output: "Publish result",
};

export const nodePaletteGroups: Array<{
  label: string;
  kinds: WorkflowNodeKind[];
}> = [
  { label: "Start", kinds: ["trigger"] },
  {
    label: "AI and source analysis",
    kinds: ["artifactTask", "customAI", "agent", "repositoryAgent"],
  },
  { label: "Connections and servers", kinds: ["apiTool", "mcpTool"] },
  {
    label: "Project capabilities",
    kinds: ["knowledgeTool", "repositoryTool", "testOpsTool"],
  },
  {
    label: "Data and flow",
    kinds: ["condition", "loop", "transform", "aggregator"],
  },
  { label: "Results and recovery", kinds: ["output", "log", "errorHandler"] },
];

export const compactCount = (
  count: number,
  singular: string,
  plural = `${singular}s`,
) => `${count} ${count === 1 ? singular : plural}`;

export const safeJsonParse = (value: string): Record<string, unknown> => {
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      throw new Error("Invalid object");
    return parsed;
  } catch {
    throw new Error(
      "Workflow input must be a valid JSON object. Correct it before starting.",
    );
  }
};

export const prettyJson = (value: unknown) =>
  JSON.stringify(value ?? {}, null, 2);

export const buildNodeDefaults = (
  kind: WorkflowNodeKind,
  index: number,
): AgenticWorkflowNodeData => {
  const isAgentKind = ["agent", "llmAgent", "webAgent", "apiAgent"].includes(
    kind,
  );
  const base: AgenticWorkflowNodeData = {
    label: `${nodeKindLabels[kind]} step`,
    ...(["agent", "llmAgent"].includes(kind)
      ? {
          agentId: "quality-evaluator",
          prompt:
            "Review the workflow request using permitted project evidence. Identify gaps and cite supporting sources.",
        }
      : {}),
    kind,
    summary: nodeKindDescriptions[kind],
    outputKey: `${kind}_${index + 1}`,
    retryCount: kind === "apiTool" || isAgentKind ? "2" : "0",
    retryDelayMs: "1000",
    timeoutMs: isAgentKind ? "60000" : "30000",
    onError: "stop",
    logLevel: "standard",
    redactSecrets: "true",
  };

  if (kind === "customAI")
    return {
      ...base,
      ...specialistDefaults("quality-evaluator"),
      label: "Custom AI review",
      prompt:
        "Review the connected input and project evidence. Return a clear answer with supporting sources.",
      instructions: "",
      knowledgeScope: "requirements,test-cases,test-runs,knowledge",
      timeoutMs: "60000",
    };
  if (kind === "mcpTool")
    return {
      ...base,
      label: "MCP tool",
      connectionId: "",
      mcpTool: "",
      mcpArguments: "{}",
      retryCount: "0",
    };
  if (kind === "transform")
    return {
      ...base,
      label: "Edit fields",
      transformMapping: '{\n  "result": "$input"\n}',
    };
  if (kind === "condition")
    return {
      ...base,
      label: "Check condition",
      conditionPath: "input.status",
      conditionOperator: "equals",
      conditionValue: '"passed"',
    };
  if (isAgentKind) {
    return {
      ...base,
      agentId: "quality-orchestrator",
      model: "Default workspace LLM",
      intent:
        "Produce a quality-engineering decision grounded in the connected evidence.",
      instructions:
        "Return a concise result with evidence, risks, and the recommended next action.",
      prompt:
        "Use the workflow input and connected tools to produce a structured answer.",
      toolPolicy: "approved-tools-only",
      knowledgeScope: "requirements,test-cases,test-runs,knowledge",
      ...(kind === "webAgent"
        ? {
            webSourceMode: "supplied-evidence-only",
            externalLinksKey: "external_links",
          }
        : {}),
      ...(kind === "apiAgent"
        ? {
            apiMethod: "GET",
            apiResponseStyle: "json",
            apiValidationMode: "schema-and-status",
          }
        : {}),
      ...(["agent", "llmAgent"].includes(kind) ? specialistDefaults("quality-orchestrator") : {}),
    };
  }

  if (kind === "apiTool") {
    return {
      ...base,
      label: "API tool",
      apiMethod: "GET",
      apiResponseStyle: "json",
      toolName: "HTTP Request",
      summary:
        "Call an approved REST API with bounded timeout and response preview.",
    };
  }

  if (kind === "knowledgeTool") {
    return {
      ...base,
      label: "Knowledge lookup",
      toolName: "HelloTest Knowledge",
      knowledgeScope: "requirements,test-cases,object-repository",
      summary:
        "Search project knowledge without leaving the HelloTest boundary.",
    };
  }

  if (kind === "repositoryTool") {
    return {
      ...base,
      label: "Repository lookup",
      toolName: "Repository",
      repositoryScope: "object-repository,automation-code",
      summary:
        "Resolve code, locator, and repository metadata through configured integrations.",
    };
  }

  if (kind === "testOpsTool") {
    return {
      ...base,
      label: "TestOps tool",
      toolName: "TestOps",
      testOpsAction: "read-runs",
      summary:
        "Use HelloTest TestOps adapters for controlled background activity.",
    };
  }

  if (kind === "artifactTask") {
    return { ...base, label: "AI Story Assurance", artifactTask: "story-assurance", timeoutMs: "1800000", retryCount: "0", outputKey: "" };
  }

  if (kind === "loop") {
    return {
      ...base,
      label: "For each item",
      loopSourceKey: "input.items",
      loopBatchSize: "1",
      loopMaxIterations: "10",
      loopAction: "transform",
      transformMapping: '{\n  "item": "$item"\n}',
      summary:
        "Iterate over a selected item array with clear batch and iteration limits.",
    };
  }

  if (kind === "aggregator") {
    return {
      ...base,
      label: "Aggregate branch outputs",
      inputMode: "allIncoming",
      mergeMode: "waitAllAppend",
      aggregateKey: "id",
      outputKey: "aggregated_results",
      summary:
        "Collect parallel branch outputs into one deterministic downstream payload.",
    };
  }

  if (kind === "errorHandler") {
    return {
      ...base,
      label: "Error recovery",
      errorRoute: "notify-and-continue",
      outputKey: "error_recovery",
      summary:
        "Collect failed node context and route it to a safe recovery path.",
    };
  }

  if (kind === "log") {
    return {
      ...base,
      label: "Execution log",
      logLevel: "audit",
      outputKey: "execution_log",
      summary: "Persist node-level input, output, timings, and retry evidence.",
    };
  }

  if (kind === "repositoryAgent")
    return {
      ...base,
      repositoryAgentType: "api_tests",
      timeoutMs: "180000",
      retryCount: "0",
    };
  return base;
};

export const getNodeOutputKey = (
  node: AgenticWorkflowNode | null | undefined,
) =>
  String(node?.data.outputKey || node?.data.output_key || node?.id || "output");

export const createNodeId = (kind: WorkflowNodeKind) =>
  `${kind}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

export const createFlowEdge = (
  source: string,
  target: string,
  label?: string,
): AgenticWorkflowEdge => ({
  id: `${source}-${target}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
  source,
  target,
  animated: true,
  label,
  markerEnd: { type: MarkerType.ArrowClosed },
  style: { strokeWidth: 1.8 },
});

export const decorateFlowEdge = (
  edge: AgenticWorkflowEdge,
): AgenticWorkflowEdge => ({
  ...edge,
  markerEnd: edge.markerEnd || { type: MarkerType.ArrowClosed },
  style: { ...(edge.style || {}), strokeWidth: 1.8 },
});

export type NodeInsertion = { sourceId?: string; sourceHandle?: string | null; edgeId?: string };

export function canConnectWorkflow(nodes: AgenticWorkflowNode[], edges: AgenticWorkflowEdge[], source: string, target: string, handle?: string | null) {
  const from = nodes.find(node => node.id === source), to = nodes.find(node => node.id === target);
  if (!from || !to || source === target || from.data.kind === "output" || to.data.kind === "trigger") return false;
  if (from.data.kind === "condition" && !["true", "false"].includes(handle || "")) return false;
  if (edges.some(edge => edge.source === source && edge.target === target && (edge.sourceHandle || null) === (handle || null))) return false;
  const visited = new Set<string>();
  const reachesSource = (id: string): boolean => {
    if (id === source) return true;
    if (visited.has(id)) return false;
    visited.add(id);
    return edges.filter(edge => edge.source === id).some(edge => reachesSource(edge.target));
  };
  return !reachesSource(target);
}

export function insertWorkflowNode(nodes: AgenticWorkflowNode[], edges: AgenticWorkflowEdge[], kind: WorkflowNodeKind, insertion: NodeInsertion = {}) {
  if (!nodes.length) kind = "trigger";
  if (kind === "trigger" && nodes.some(node => node.data.kind === "trigger")) throw new Error("A workflow already has a manual trigger.");
  const edge = edges.find(item => item.id === insertion.edgeId);
  if (insertion.edgeId && !edge) throw new Error("This connection was removed. Choose where to add the node again.");
  const source = nodes.find(node => node.id === (edge?.source || insertion.sourceId));
  if (source?.data.kind === "output") throw new Error("Output ends a branch. Add a node before it.");
  if (edge && ["trigger", "output", "errorHandler"].includes(kind)) throw new Error("Choose a processing node to insert on a connection.");
  const handle = edge?.sourceHandle ?? insertion.sourceHandle ?? null;
  if (source?.data.kind === "condition" && !["true", "false"].includes(handle || "")) throw new Error("Choose the true or false branch to add a node.");
  const id = createNodeId(kind);
  const downstream = source ? edges.filter(item => item.source === source.id && (item.sourceHandle || null) === handle && nodes.find(node => node.id === item.target)?.data.kind !== "errorHandler") : [];
  const rewired = edge ? [edge] : ["output", "errorHandler", "trigger"].includes(kind) ? [] : downstream;
  const shifted = new Set<string>();
  const visit = (nodeId: string) => {
    if (shifted.has(nodeId)) return;
    shifted.add(nodeId);
    edges.filter(item => item.source === nodeId).forEach(item => visit(item.target));
  };
  rewired.forEach(item => visit(item.target));
  const next: AgenticWorkflowNode = { id, type: "agenticStep", position: {
    x: source ? source.position.x + 310 : 70 + nodes.length * 310,
    y: (source?.position.y ?? 140) + (source && !rewired.length && downstream.length ? 170 : handle === "false" ? 170 : 0),
  }, data: buildNodeDefaults(kind, nodes.length) };
  const aliases = new Set(nodes.flatMap(node => [node.id, node.data.outputKey]).filter(Boolean));
  const baseAlias = next.data.outputKey || kind;
  let alias = baseAlias;
  let suffix = 2;
  while (aliases.has(alias)) alias = `${baseAlias}_${suffix++}`;
  next.data.outputKey = alias;
  return {
    node: next,
    nodes: [...nodes.map(node => ({ ...node,
      ...(source?.id === node.id && kind === "errorHandler" ? { data: { ...node.data, onError: "errorOutput" } } : {}),
      position: shifted.has(node.id) ? { ...node.position, x: node.position.x + 310 } : node.position,
    })), next],
    edges: [...edges.filter(item => !rewired.includes(item)),
      ...(source && kind !== "trigger" ? [{ ...createFlowEdge(source.id, id), sourceHandle: handle }] : []),
      ...rewired.map(item => ({ ...item, source: id, sourceHandle: kind === "condition" ? "true" : null })),
    ],
  };
}

export function layoutWorkflow(
  nodes: AgenticWorkflowNode[],
  edges: AgenticWorkflowEdge[],
): AgenticWorkflowNode[] {
  const depth = new Map<string, number>();
  const remaining = new Set(nodes.map((node) => node.id));
  while (remaining.size) {
    let advanced = false;
    for (const id of remaining) {
      const parents = edges
        .filter((edge) => edge.target === id)
        .map((edge) => edge.source)
        .filter((source) => nodes.some((node) => node.id === source));
      if (parents.every((parent) => depth.has(parent))) {
        depth.set(
          id,
          parents.length
            ? Math.max(...parents.map((parent) => depth.get(parent)!)) + 1
            : 0,
        );
        remaining.delete(id);
        advanced = true;
      }
    }
    if (!advanced) {
      for (const id of remaining) depth.set(id, depth.size);
      break;
    }
  }
  const row = new Map<number, number>();
  return nodes.map((node) => {
    const column = depth.get(node.id) || 0,
      index = row.get(column) || 0;
    row.set(column, index + 1);
    return {
      ...node,
      position: { x: 70 + column * 310, y: 140 + index * 170 },
    };
  });
}

export const getDefaultWorkflowNodes = (): AgenticWorkflowNode[] => [
  {
    id: "review-request",
    type: "agenticStep",
    position: { x: 70, y: 140 },
    data: {
      label: "Review request",
      kind: "trigger",
      summary: "Capture the release scope and task.",
      outputKey: "request",
    },
  },
  {
    id: "story-review",
    type: "agenticStep",
    position: { x: 390, y: 140 },
    data: {
      ...specialistDefaults("story-architect"),
      label: "Story Architect",
      kind: "agent",
      agentId: "story-architect",
      prompt:
        "Review the requested release scope. Identify missing acceptance boundaries and uncovered stories using permitted project evidence.",
      knowledgeScope: "stories,test-cases,knowledge",
      timeoutMs: "70000",
      retryCount: "0",
      outputKey: "story_review",
    },
  },
  {
    id: "run-review",
    type: "agenticStep",
    position: { x: 710, y: 140 },
    data: {
      ...specialistDefaults("run-planner"),
      label: "Smart Run Planner",
      kind: "agent",
      agentId: "run-planner",
      prompt:
        "Review the release scope and prior review proposals. Independently verify evidence, then recommend impacted tests and unresolved risks. Do not create or start a test run.",
      knowledgeScope: "stories,test-cases,runs,knowledge",
      timeoutMs: "70000",
      retryCount: "0",
      outputKey: "run_plan",
    },
  },
  {
    id: "review-packet",
    type: "agenticStep",
    position: { x: 1030, y: 140 },
    data: {
      label: "Human review",
      kind: "output",
      summary:
        "Collect the actual specialist reviews and citations for a human decision.",
      outputKey: "review_packet",
    },
  },
];

export const getDefaultWorkflowEdges = (): AgenticWorkflowEdge[] => [
  {
    id: "request-stories",
    source: "review-request",
    target: "story-review",
    animated: true,
  },
  {
    id: "stories-run",
    source: "story-review",
    target: "run-review",
    animated: true,
  },
  {
    id: "run-packet",
    source: "run-review",
    target: "review-packet",
    animated: true,
  },
];

export const reviewDefinitionKey = (
  workflowNodes: AgenticWorkflowNode[],
  workflowEdges: AgenticWorkflowEdge[],
  status?: string,
  trigger?: string,
  settings?: Record<string, unknown>,
) =>
  JSON.stringify({
    nodes: workflowNodes.map((node) => ({
      id: node.id,
      type: node.type,
      data: node.data,
    })),
    edges: workflowEdges.map((edge) => ({
      source: edge.source,
      target: edge.target,
      sourceHandle: edge.sourceHandle,
      targetHandle: edge.targetHandle,
    })),
    status,
    trigger,
    settings,
  });

export function runMatchesDraft(
  run: AgenticWorkflowRun,
  draft: WorkflowDraft,
  nodes: AgenticWorkflowNode[],
  edges: AgenticWorkflowEdge[],
  input: string,
): boolean {
  const snapshot = run.workflow_snapshot;
  if (!Array.isArray(snapshot.nodes) || !Array.isArray(snapshot.edges))
    return false;
  try {
    return (
      JSON.stringify(JSON.parse(input)) === JSON.stringify(run.input_payload) &&
      reviewDefinitionKey(
        nodes,
        edges,
        draft.status,
        draft.trigger_kind,
        draft.settings,
      ) ===
        reviewDefinitionKey(
          snapshot.nodes,
          snapshot.edges,
          String(snapshot.status),
          String(snapshot.trigger_kind),
          snapshot.settings as Record<string, unknown>,
        )
    );
  } catch {
    return false;
  }
}

export const normalizeWorkflowNodeDirectLlm = (
  node: AgenticWorkflowNode,
): AgenticWorkflowNode => {
  if (!isRovoIntegrationId(String(node.data.llmIntegrationId || ""))) {
    return { ...node, type: node.type || "agenticStep" };
  }

  return {
    ...node,
    type: node.type || "agenticStep",
    data: {
      ...node.data,
      llmIntegrationId: "",
      model: "Default workspace LLM",
    },
  };
};

export const createWorkflowDraft = (
  workflow?: AgenticWorkflow | null,
): WorkflowDraft => ({
  id: workflow?.id,
  name: workflow?.name || "Release readiness review",
  description:
    workflow?.description ||
    "Review release scope with Story Architect and Smart Run Planner, then inspect the evidence before deciding what to test.",
  status: workflow?.status || "draft",
  trigger_kind: workflow?.trigger_kind || "manual",
  nodes: workflow
    ? workflow.nodes.map(normalizeWorkflowNodeDirectLlm)
    : getDefaultWorkflowNodes(),
  edges: workflow ? workflow.edges : getDefaultWorkflowEdges(),
  settings: workflow?.settings || {
    execution_mode: "review",
    snapshot_runs: true,
  },
});

export const buildN8nPayload = (
  draft: WorkflowDraft,
  nodes: AgenticWorkflowNode[],
  edges: AgenticWorkflowEdge[],
) => {
  const connections = edges.reduce<
    Record<
      string,
      { main: Array<Array<{ node: string; type: string; index: number }>> }
    >
  >((accumulator, edge) => {
    const sourceNode = nodes.find((node) => node.id === edge.source);
    const targetNode = nodes.find((node) => node.id === edge.target);

    if (!sourceNode || !targetNode) {
      return accumulator;
    }

    const sourceName = String(
      sourceNode.data.label || sourceNode.data.name || sourceNode.id,
    );
    const targetName = String(
      targetNode.data.label || targetNode.data.name || targetNode.id,
    );
    const current = accumulator[sourceName] || { main: [[]] };
    current.main[0].push({ node: targetName, type: "main", index: 0 });
    accumulator[sourceName] = current;
    return accumulator;
  }, {});

  return {
    name: draft.name,
    active: draft.status === "active",
    nodes: nodes.map((node) => {
      const incomingEdges = edges.filter((edge) => edge.target === node.id);
      const outgoingEdges = edges.filter((edge) => edge.source === node.id);

      return {
        id: node.id,
        name: String(node.data.label || node.data.name || node.id),
        type: `hellotest.agentic.${node.data.kind || "agent"}`,
        typeVersion: 1,
        position: [node.position.x, node.position.y],
        parameters: {
          summary: node.data.summary || "",
          prompt: node.data.prompt || "",
          model: node.data.model || "",
          llmIntegrationId: node.data.llmIntegrationId || "",
          credentialId: node.data.credentialId || "",
          inputKey: node.data.inputKey || "",
          outputKey: node.data.outputKey || "",
          sampleOutput: node.data.sampleOutput || "",
          dataFlow: {
            inputMode:
              node.data.inputMode ||
              (incomingEdges.length > 1 ? "allIncoming" : "previousOutput"),
            inputExpression: node.data.inputExpression || "",
            incoming: incomingEdges.map((edge) => {
              const sourceNode = nodes.find((item) => item.id === edge.source);
              return {
                edgeId: edge.id,
                sourceNodeId: edge.source,
                sourceOutputKey: getNodeOutputKey(sourceNode),
              };
            }),
            outgoing: outgoingEdges.map((edge) => ({
              edgeId: edge.id,
              targetNodeId: edge.target,
            })),
          },
          merge: {
            mode: node.data.mergeMode || "",
            aggregateKey: node.data.aggregateKey || "",
          },
          runtime: {
            timeoutMs: node.data.timeoutMs || "30000",
            retryCount: node.data.retryCount || "0",
            retryDelayMs: node.data.retryDelayMs || "1000",
            onError: node.data.onError || "stop",
            logLevel: node.data.logLevel || "standard",
            redactSecrets: node.data.redactSecrets ?? "true",
          },
          loop: {
            sourceKey: node.data.loopSourceKey || "",
            batchSize: node.data.loopBatchSize || "",
            maxIterations: node.data.loopMaxIterations || "",
          },
          tool: {
            name: node.data.toolName || "",
            policy: node.data.toolPolicy || "approved-tools-only",
            knowledgeScope: node.data.knowledgeScope || "",
            repositoryScope: node.data.repositoryScope || "",
            testOpsAction: node.data.testOpsAction || "",
          },
          api: {
            method: node.data.apiMethod || "GET",
            url: node.data.apiUrl || "",
            auth: node.data.apiAuth || "",
            responseStyle: node.data.apiResponseStyle || "json",
            body: node.data.apiBody || "",
          },
        },
      };
    }),
    connections,
    settings: draft.settings,
    pinData: {},
    meta: {
      source: "hellotest-agentic-workflows",
      compatible_with: "n8n-workflow-json",
      generated_at: new Date().toISOString(),
    },
  };
};
