import { MarkerType } from "@xyflow/react";
import nodeKinds from "../../shared/workflowNodeKinds.json";
import { nativeTaskDefaults, withNativeTaskDefaults } from "./nativeTaskProfiles";
import { dataOperationDefaults } from "./dataOperationProfiles";
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
export type WorkflowNodeKind = keyof typeof nodeKinds.kinds;
export const WORKFLOW_LIMITS = nodeKinds.limits;
export const workflowSpecialistCount = (nodes: AgenticWorkflowNode[]) => nodes.filter(node => nodeKinds.kinds[node.data.kind as WorkflowNodeKind]?.specialist).length;

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

export const DEFAULT_RUN_INPUT = "{}";

export const nodeKindLabels = Object.fromEntries(Object.entries(nodeKinds.kinds).map(([kind, entry]) => [kind, entry.label])) as Record<WorkflowNodeKind, string>;
export const nodeKindDescriptions = Object.fromEntries(Object.entries(nodeKinds.kinds).map(([kind, entry]) => [kind, entry.description])) as Record<WorkflowNodeKind, string>;
export const executableNodeKinds = new Set(Object.entries(nodeKinds.kinds).filter(([, entry]) => entry.executable).map(([kind]) => kind));

const paletteOrder = ["Start","Native artifact tasks","AI reviews and source analysis","Connections and servers","Project capabilities","Data and flow","Results and recovery"];
export const legacyNodeKinds = new Set<WorkflowNodeKind>(['llmAgent','apiAgent']);
export const nodePaletteGroups: Array<{label:string;kinds:WorkflowNodeKind[]}> = [...new Set(Object.values(nodeKinds.kinds).map(entry=>entry.ui.paletteGroup))]
 .sort((a,b)=>paletteOrder.indexOf(a)-paletteOrder.indexOf(b))
 .map(label=>({label,kinds:(Object.keys(nodeKinds.kinds) as WorkflowNodeKind[]).filter(kind=>!legacyNodeKinds.has(kind)&&nodeKinds.kinds[kind].ui.paletteGroup===label)}));

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

export const buildNodeDefaults = (kind: WorkflowNodeKind, index: number): AgenticWorkflowNodeData => ({
  outputKey: kind + "_" + String(index + 1), ...structuredClone(nodeKinds.kinds[kind].defaults), kind
});

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

export const isWorkflowLoop = (node: AgenticWorkflowNode | undefined) => node?.data.kind === "loop" && node.data.loopAction === "workflow";
export const isLoopReturnEdge = (edge: AgenticWorkflowEdge, nodes: AgenticWorkflowNode[]) => edge.targetHandle === "continue" && isWorkflowLoop(nodes.find(node => node.id === edge.target));
export function switchRoutes(data: AgenticWorkflowNodeData): Array<{ id: string; label: string }> {
  if (data.kind !== "dataOperation" || data.dataOperation !== "switch") return [];
  try {
    const configured = data.dataRoutes === undefined ? dataOperationDefaults("switch").dataRoutes : data.dataRoutes;
    const routes = typeof configured === "string" ? JSON.parse(configured) : configured;
    const seen = new Set<string>();
    return Array.isArray(routes) ? routes.filter(route => {
      if (!route || typeof route.id !== "string" || !/^[a-zA-Z][\w-]{0,63}$/.test(route.id) || ["fallback", "__proto__", "constructor", "prototype"].includes(route.id) || seen.has(route.id)) return false;
      seen.add(route.id); return true;
    }).map(route => ({ id: route.id, label: String(route.label || route.id) })) : [];
  } catch { return []; }
}
export function workflowSourceHandles(node: AgenticWorkflowNode): Array<{ id: string; label: string }> {
  if (isWorkflowLoop(node)) return [{ id: "loop", label: "loop" }, { id: "done", label: "done" }];
  if (node.data.kind === "dataOperation" && node.data.dataOperation === "switch") return [...switchRoutes(node.data), ...((node.data.dataFallback ?? "fallback") === "fallback" ? [{ id: "fallback", label: "fallback" }] : [])];
  return nodeKinds.kinds[node.data.kind as WorkflowNodeKind]?.handles || [];
}
export const defaultSourceHandle = (node: AgenticWorkflowNode) => isWorkflowLoop(node) ? "done" : workflowSourceHandles(node)[0]?.id || null;
export function canConnectWorkflow(nodes: AgenticWorkflowNode[], edges: AgenticWorkflowEdge[], source: string, target: string, handle?: string | null, targetHandle?: string | null) {
  const from = nodes.find(node => node.id === source), to = nodes.find(node => node.id === target);
  if (!from || !to || source === target || ["output", "stop"].includes(String(from.data.kind)) || to.data.kind === "trigger") return false;
  const handles = workflowSourceHandles(from);
  if (from.data.kind === "dataOperation" && from.data.dataOperation === "switch" && !handles.length) return false;
  if (handles.length && !handles.some(port => port.id === handle)) return false;
  if (edges.some(edge => edge.source === source && edge.target === target && (edge.sourceHandle || null) === (handle || null) && (edge.targetHandle || null) === (targetHandle || null))) return false;
  const forward = edges.filter(edge => !isLoopReturnEdge(edge, nodes));
  if (targetHandle === "continue") {
    if (!isWorkflowLoop(to)) return false;
    const body = new Set<string>();
    const visitBody = (id: string) => {
      if (body.has(id) || id === target) return;
      body.add(id); forward.filter(edge => edge.source === id).forEach(edge => visitBody(edge.target));
    };
    forward.filter(edge => edge.source === target && edge.sourceHandle === "loop").forEach(edge => visitBody(edge.target));
    return body.has(source);
  }
  if (targetHandle && !(to.data.kind === "aggregator" && /^input-[12]$/.test(targetHandle))) return false;
  const visited = new Set<string>();
  const reachesSource = (id: string): boolean => {
    if (id === source) return true;
    if (visited.has(id)) return false;
    visited.add(id);
    return forward.filter(edge => edge.source === id).some(edge => reachesSource(edge.target));
  };
  return !reachesSource(target);
}

export function insertWorkflowNode(nodes: AgenticWorkflowNode[], edges: AgenticWorkflowEdge[], kind: WorkflowNodeKind, insertion: NodeInsertion = {}) {
  if (nodes.length >= WORKFLOW_LIMITS.max_nodes) throw new Error(`A workflow supports at most ${WORKFLOW_LIMITS.max_nodes} nodes.`);
  if (nodeKinds.kinds[kind]?.specialist && workflowSpecialistCount(nodes) >= WORKFLOW_LIMITS.max_specialists) throw new Error(`A workflow supports at most ${WORKFLOW_LIMITS.max_specialists} specialist nodes.`);
  if (!nodes.length) kind = "trigger";
  if (kind === "trigger" && nodes.some(node => node.data.kind === "trigger")) throw new Error("A workflow already has a manual trigger.");
  const edge = edges.find(item => item.id === insertion.edgeId);
  if (insertion.edgeId && !edge) throw new Error("This connection was removed. Choose where to add the node again.");
  const source = nodes.find(node => node.id === (edge?.source || insertion.sourceId));
  if (["output", "stop"].includes(String(source?.data.kind))) throw new Error("This node ends a branch. Add a node before it.");
  if (edge && ["trigger", "output", "stop", "errorHandler"].includes(kind)) throw new Error("Choose a processing node to insert on a connection.");
  const handle = edge?.sourceHandle ?? insertion.sourceHandle ?? null;
  if (source && workflowSourceHandles(source).length && !workflowSourceHandles(source).some(port => port.id === handle)) throw new Error("Choose an output branch to add a node.");
  const id = createNodeId(kind);
  const downstream = source ? edges.filter(item => item.source === source.id && (item.sourceHandle || null) === handle && nodes.find(node => node.id === item.target)?.data.kind !== "errorHandler") : [];
  const rewired = edge ? [edge] : ["output", "stop", "errorHandler", "trigger"].includes(kind) ? [] : downstream;
  const shifted = new Set<string>();
  const visit = (nodeId: string) => {
    if (shifted.has(nodeId)) return;
    shifted.add(nodeId);
    edges.filter(item => item.source === nodeId && !isLoopReturnEdge(item, nodes)).forEach(item => visit(item.target));
  };
  rewired.filter(item => !isLoopReturnEdge(item, nodes)).forEach(item => visit(item.target));
  const next: AgenticWorkflowNode = { id, type: "agenticStep", position: {
    x: source ? source.position.x + 350 : 70 + nodes.length * 350,
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
      position: shifted.has(node.id) ? { ...node.position, x: node.position.x + 350 } : node.position,
    })), next],
    edges: [...edges.filter(item => !rewired.includes(item)),
      ...(source && kind !== "trigger" ? [{ ...createFlowEdge(source.id, id), sourceHandle: handle }] : []),
      ...rewired.map(item => ({ ...item, source: id, sourceHandle: defaultSourceHandle(next) })),
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
        .filter((edge) => edge.target === id && !isLoopReturnEdge(edge, nodes))
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
  const nextY = new Map<number, number>();
  return nodes.map((node) => {
    const column = depth.get(node.id) || 0,
      y = nextY.get(column) ?? 140;
    const portCount = workflowSourceHandles(node).length;
    nextY.set(column, y + (portCount > 2 ? 56 + portCount * 34 : 94) + 76);
    return {
      ...node,
      position: { x: 70 + column * 350, y },
    };
  });
}

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
  }, (_key, value: unknown) => value && typeof value === "object" && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0))
    : value);

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
  node = { ...node, data: withNativeTaskDefaults(node.data) };
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
  name: workflow?.name || "Untitled workflow",
  description: workflow?.description || "",
  status: workflow?.status || "draft",
  trigger_kind: workflow?.trigger_kind || "manual",
  nodes: workflow?.nodes.map(normalizeWorkflowNodeDirectLlm) || [],
  edges: workflow?.edges || [],
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
    const sourceIndex = Math.max(0, workflowSourceHandles(sourceNode).findIndex(port => port.id === edge.sourceHandle));
    const targetIndex = edge.targetHandle === "continue" || edge.targetHandle === "input-2" ? 1 : 0;
    while (current.main.length <= sourceIndex) current.main.push([]);
    current.main[sourceIndex].push({ node: targetName, type: "main", index: targetIndex });
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
          task: node.data.task || "",
          instructions: node.data.instructions ?? "",
          guardrails: node.data.guardrails ?? "",
          aiConfiguration: node.data.aiConfiguration || {},
          reviewCriteria: node.data.reviewCriteria || "",
          artifactTask: node.data.artifactTask || "",
          inspectBrowser: node.data.inspectBrowser ?? true,
          automationRuntime: node.data.automationRuntime ?? 'auto',
          automationBrowserMode: node.data.automationBrowserMode ?? (node.data.inspectBrowser === false ? "offline" : "read_only"),
          automationSource: node.data.automationSource || 'sprint',
          automationManualCaseId: node.data.automationManualCaseId || '',
          automationVerificationMode: node.data.automationVerificationMode || 'generate_only',
          readinessPolicy: node.data.readinessPolicy || "verify-inputs",
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
                sourceHandle: edge.sourceHandle || null,
                targetHandle: edge.targetHandle || null,
              };
            }),
            outgoing: outgoingEdges.map((edge) => ({
              edgeId: edge.id,
              targetNodeId: edge.target,
              sourceHandle: edge.sourceHandle || null,
              targetHandle: edge.targetHandle || null,
            })),
          },
          merge: {
            mode: node.data.mergeMode || "",
            aggregateKey: node.data.aggregateKey || "",
            clash: node.data.mergeClash || "preferLast",
            deep: node.data.mergeDeep ?? true,
            includeUnpaired: node.data.mergeIncludeUnpaired ?? false,
            matchFields: node.data.mergeMatchFields || "[]",
            join: node.data.mergeJoin || "inner",
            multiple: node.data.mergeMultiple || "all",
            chooseInput: node.data.mergeChooseInput || 1,
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
            action: node.data.loopAction || "",
            itemFailure: node.data.loopItemFailure || 'stop',
            maxIterations: node.data.loopMaxIterations || "",
            batchSize: node.data.loopBatchSize || 1,
          },
          dataOperation: Object.fromEntries(Object.entries(node.data).filter(([key]) => key.startsWith("data"))),
          waitMs: node.data.waitMs ?? 0,
          stopMessage: node.data.stopMessage || "",
          condition: { conditions: node.data.conditions || [{ conditionPath: node.data.conditionPath, conditionOperator: node.data.conditionOperator, conditionValue: node.data.conditionValue }], combinator: node.data.conditionCombinator || "all" },
          transformMapping: node.data.transformMapping || "",
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
            connectionId: node.data.connectionId || "",
            resource: node.data.apiResource || "",
            pagination: node.data.apiPagination || "none",
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
