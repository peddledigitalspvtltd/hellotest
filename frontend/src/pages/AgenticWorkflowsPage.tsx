import { useCallback, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Background,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  addEdge,
  useEdgesState,
  useNodesState
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useAuth } from "../auth/AuthContext";
import { CatalogSearchFilter } from "../components/CatalogSearchFilter";
import { CatalogViewToggle } from "../components/CatalogViewToggle";
import { DataTable, type DataTableColumn } from "../components/DataTable";
import { AddIcon, ClearSelectionIcon, PlayIcon, SaveIcon, SelectAllIcon, SparkIcon } from "../components/AppIcons";
import { PageHeader } from "../components/PageHeader";
import { Panel } from "../components/Panel";
import { StatusBadge } from "../components/StatusBadge";
import { ToastMessage } from "../components/ToastMessage";
import { WorkspaceScopeBar } from "../components/WorkspaceScopeBar";
import { useCurrentAppType, useCurrentProject } from "../hooks/useCurrentProject";
import { api } from "../lib/api";
import { readDefaultCatalogViewMode } from "../lib/viewPreferences";
import type {
  AgenticWorkflow,
  AgenticWorkflowEdge,
  AgenticWorkflowNode,
  AgenticWorkflowNodeData,
  AgenticWorkflowRun,
  AgenticWorkflowStatus,
  AgenticWorkflowTriggerKind
} from "../types";

type WorkflowViewMode = "tile" | "list";
type WorkflowTab = "workflows" | "runs";
type WorkflowNodeKind = "trigger" | "agent" | "tool" | "condition" | "transform" | "output";

type WorkflowDraft = {
  id?: string;
  name: string;
  description: string;
  status: AgenticWorkflowStatus;
  trigger_kind: AgenticWorkflowTriggerKind;
  nodes: AgenticWorkflowNode[];
  edges: AgenticWorkflowEdge[];
  settings: Record<string, unknown>;
};

const DEFAULT_RUN_INPUT = `{
  "release_scope": "Release 2026.06 contains checkout, billing, and user profile updates",
  "source": "release-planning"
}`;

const nodeKindLabels: Record<WorkflowNodeKind, string> = {
  trigger: "Trigger",
  agent: "Agent",
  tool: "Tool",
  condition: "Condition",
  transform: "Transform",
  output: "Output"
};

const nodeKindDescriptions: Record<WorkflowNodeKind, string> = {
  trigger: "Accept release scope",
  agent: "Reason over context",
  tool: "Fetch or enrich data",
  condition: "Branch on criteria",
  transform: "Shape JSON output",
  output: "Publish result"
};

const formatTimestamp = (value?: string | null, fallback = "Not recorded") => {
  if (!value) {
    return fallback;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return fallback;
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(date);
};

const compactCount = (count: number, singular: string, plural = `${singular}s`) =>
  `${count} ${count === 1 ? singular : plural}`;

const safeJsonParse = (value: string): Record<string, unknown> => {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
};

const prettyJson = (value: unknown) => JSON.stringify(value ?? {}, null, 2);

const getDefaultWorkflowNodes = (): AgenticWorkflowNode[] => [
  {
    id: "release-scope",
    type: "agenticStep",
    position: { x: 80, y: 120 },
    data: {
      label: "Release scope intake",
      kind: "trigger",
      summary: "Capture release scope and source metadata.",
      outputKey: "release_scope",
      sampleOutput: "Normalized release scope"
    }
  },
  {
    id: "story-discovery-agent",
    type: "agenticStep",
    position: { x: 390, y: 80 },
    data: {
      label: "Story discovery agent",
      kind: "agent",
      summary: "Identify stories included in the release.",
      prompt: "Read the release scope, identify matching stories, and return story IDs with confidence.",
      outputKey: "stories",
      sampleOutput: "JSON array of release stories"
    }
  },
  {
    id: "json-contract",
    type: "agenticStep",
    position: { x: 700, y: 120 },
    data: {
      label: "JSON contract",
      kind: "transform",
      summary: "Normalize agent output into the downstream schema.",
      outputKey: "release_story_payload",
      sampleOutput: "Validated workflow JSON"
    }
  },
  {
    id: "test-planning-agent",
    type: "agenticStep",
    position: { x: 1010, y: 80 },
    data: {
      label: "Test planning agent",
      kind: "agent",
      summary: "Use release stories to propose impacted tests.",
      prompt: "Take release_story_payload and return impacted requirements, tests, and risk notes.",
      outputKey: "test_plan",
      sampleOutput: "Prioritized test plan"
    }
  }
];

const getDefaultWorkflowEdges = (): AgenticWorkflowEdge[] => [
  { id: "release-scope-story-discovery-agent", source: "release-scope", target: "story-discovery-agent", animated: true },
  { id: "story-discovery-agent-json-contract", source: "story-discovery-agent", target: "json-contract", animated: true },
  { id: "json-contract-test-planning-agent", source: "json-contract", target: "test-planning-agent", animated: true }
];

const createWorkflowDraft = (workflow?: AgenticWorkflow | null): WorkflowDraft => ({
  id: workflow?.id,
  name: workflow?.name || "Release scope to story map",
  description:
    workflow?.description ||
    "Takes release scope, identifies included stories, emits JSON, and passes the payload to downstream agents.",
  status: workflow?.status || "draft",
  trigger_kind: workflow?.trigger_kind || "manual",
  nodes: workflow?.nodes?.length ? workflow.nodes.map((node) => ({ ...node, type: node.type || "agenticStep" })) : getDefaultWorkflowNodes(),
  edges: workflow?.edges?.length ? workflow.edges : getDefaultWorkflowEdges(),
  settings: workflow?.settings || {
    execution_mode: "sequential",
    snapshot_runs: true
  }
});

const buildN8nPayload = (draft: WorkflowDraft, nodes: AgenticWorkflowNode[], edges: AgenticWorkflowEdge[]) => {
  const connections = edges.reduce<Record<string, { main: Array<Array<{ node: string; type: string; index: number }>> }>>((accumulator, edge) => {
    const sourceNode = nodes.find((node) => node.id === edge.source);
    const targetNode = nodes.find((node) => node.id === edge.target);

    if (!sourceNode || !targetNode) {
      return accumulator;
    }

    const sourceName = String(sourceNode.data.label || sourceNode.data.name || sourceNode.id);
    const targetName = String(targetNode.data.label || targetNode.data.name || targetNode.id);
    const current = accumulator[sourceName] || { main: [[]] };
    current.main[0].push({ node: targetName, type: "main", index: 0 });
    accumulator[sourceName] = current;
    return accumulator;
  }, {});

  return {
    name: draft.name,
    active: draft.status === "active",
    nodes: nodes.map((node) => ({
      id: node.id,
      name: String(node.data.label || node.data.name || node.id),
      type: `qaira.agentic.${node.data.kind || "agent"}`,
      typeVersion: 1,
      position: [node.position.x, node.position.y],
      parameters: {
        summary: node.data.summary || "",
        prompt: node.data.prompt || "",
        inputKey: node.data.inputKey || "",
        outputKey: node.data.outputKey || "",
        sampleOutput: node.data.sampleOutput || ""
      }
    })),
    connections,
    settings: draft.settings,
    pinData: {},
    meta: {
      source: "qaira-agentic-workflows",
      compatible_with: "n8n-workflow-json",
      generated_at: new Date().toISOString()
    }
  };
};

function AgenticStepNode({ data }: { data: AgenticWorkflowNodeData }) {
  const kind = String(data.kind || "agent") as WorkflowNodeKind;

  return (
    <div className={`agentic-flow-node agentic-flow-node--${kind}`}>
      <Handle className="agentic-flow-handle" position={Position.Left} type="target" />
      <div className="agentic-flow-node-kicker">{nodeKindLabels[kind] || "Step"}</div>
      <strong>{data.label || data.name || "Workflow step"}</strong>
      <p>{data.summary || nodeKindDescriptions[kind] || "Workflow operation"}</p>
      <span>{data.outputKey ? `Output: ${data.outputKey}` : "Output: default"}</span>
      <Handle className="agentic-flow-handle" position={Position.Right} type="source" />
    </div>
  );
}

const nodeTypes = {
  agenticStep: AgenticStepNode
};

export function AgenticWorkflowsPage() {
  const queryClient = useQueryClient();
  const { session } = useAuth();
  const [projectId, setProjectId] = useCurrentProject();
  const [appTypeId, setAppTypeId] = useCurrentAppType(projectId);
  const [activeTab, setActiveTab] = useState<WorkflowTab>("workflows");
  const [searchTerm, setSearchTerm] = useState("");
  const [viewMode, setViewMode] = useState<WorkflowViewMode>(() => readDefaultCatalogViewMode());
  const [selectedActionWorkflowIds, setSelectedActionWorkflowIds] = useState<string[]>([]);
  const [selectedActionRunIds, setSelectedActionRunIds] = useState<string[]>([]);
  const [draft, setDraft] = useState<WorkflowDraft | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState("");
  const [selectedRunId, setSelectedRunId] = useState("");
  const [runInput, setRunInput] = useState(DEFAULT_RUN_INPUT);
  const [toastMessage, setToastMessage] = useState("");
  const [toastTone, setToastTone] = useState<"success" | "error" | "info">("success");
  const [nodes, setNodes, onNodesChange] = useNodesState<AgenticWorkflowNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<AgenticWorkflowEdge>([]);

  const projectsQuery = useQuery({ queryKey: ["projects"], queryFn: api.projects.list });
  const appTypesQuery = useQuery({ queryKey: ["app-types"], queryFn: () => api.appTypes.list() });

  const projects = projectsQuery.data || [];
  const allAppTypes = appTypesQuery.data || [];
  const scopedAppTypes = allAppTypes.filter((appType) => appType.project_id === projectId);
  const selectedProject = projects.find((project) => project.id === projectId) || null;
  const selectedAppType = scopedAppTypes.find((appType) => appType.id === appTypeId) || null;

  useEffect(() => {
    if (!projectId && projects.length) {
      setProjectId(projects[0].id);
    }
  }, [projectId, projects, setProjectId]);

  useEffect(() => {
    if (!projectId || !scopedAppTypes.length) {
      return;
    }

    if (!appTypeId || !scopedAppTypes.some((appType) => appType.id === appTypeId)) {
      setAppTypeId(scopedAppTypes[0].id);
    }
  }, [appTypeId, projectId, scopedAppTypes, setAppTypeId]);

  const workflowsQuery = useQuery({
    queryKey: ["agentic-workflows", projectId, appTypeId],
    queryFn: () => api.agenticWorkflows.list({ project_id: projectId, app_type_id: appTypeId }),
    enabled: Boolean(projectId)
  });

  const runsQuery = useQuery({
    queryKey: ["agentic-workflow-runs", projectId, appTypeId],
    queryFn: () => api.agenticWorkflows.listRuns({ project_id: projectId, app_type_id: appTypeId }),
    enabled: Boolean(projectId)
  });

  const workflows = workflowsQuery.data || [];
  const runs = runsQuery.data || [];
  const selectedRun = runs.find((run) => run.id === selectedRunId) || null;
  const selectedNode = nodes.find((node) => node.id === selectedNodeId) || nodes[0] || null;

  const invalidateWorkflowData = () => {
    void queryClient.invalidateQueries({ queryKey: ["agentic-workflows"] });
    void queryClient.invalidateQueries({ queryKey: ["agentic-workflow-runs"] });
  };

  const saveMutation = useMutation({
    mutationFn: async (nextDraft: WorkflowDraft) => {
      if (!projectId) {
        throw new Error("Select a project first.");
      }

      const payload = {
        project_id: projectId,
        app_type_id: appTypeId || undefined,
        name: nextDraft.name,
        description: nextDraft.description,
        status: nextDraft.status,
        trigger_kind: nextDraft.trigger_kind,
        nodes,
        edges,
        settings: nextDraft.settings,
        n8n_payload: buildN8nPayload(nextDraft, nodes, edges)
      };

      return nextDraft.id
        ? api.agenticWorkflows.update(nextDraft.id, payload)
        : api.agenticWorkflows.create(payload);
    },
    onSuccess: (workflow) => {
      invalidateWorkflowData();
      setDraft(createWorkflowDraft(workflow));
      setNodes(workflow.nodes.map((node) => ({ ...node, type: node.type || "agenticStep" })));
      setEdges(workflow.edges);
      setToastTone("success");
      setToastMessage("Agentic workflow saved.");
    },
    onError: (error) => {
      setToastTone("error");
      setToastMessage(error instanceof Error ? error.message : "Unable to save workflow.");
    }
  });

  const runMutation = useMutation({
    mutationFn: async (workflow: AgenticWorkflow) =>
      api.agenticWorkflows.run(workflow.id, {
        trigger_kind: draft?.trigger_kind || workflow.trigger_kind,
        input_payload: safeJsonParse(runInput)
      }),
    onSuccess: (run) => {
      invalidateWorkflowData();
      setSelectedRunId(run.id);
      setActiveTab("runs");
      setToastTone("success");
      setToastMessage("Workflow run captured with a frozen snapshot.");
    },
    onError: (error) => {
      setToastTone("error");
      setToastMessage(error instanceof Error ? error.message : "Unable to run workflow.");
    }
  });

  const deleteMutation = useMutation({
    mutationFn: api.agenticWorkflows.delete,
    onSuccess: () => {
      invalidateWorkflowData();
      setDraft(null);
      setToastTone("success");
      setToastMessage("Agentic workflow deleted.");
    },
    onError: (error) => {
      setToastTone("error");
      setToastMessage(error instanceof Error ? error.message : "Unable to delete workflow.");
    }
  });

  const filteredWorkflows = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();

    if (!term) {
      return workflows;
    }

    return workflows.filter((workflow) =>
      [
        workflow.name,
        workflow.description,
        workflow.status,
        workflow.trigger_kind,
        workflow.latest_run_status
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(term))
    );
  }, [searchTerm, workflows]);

  const filteredRuns = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();

    if (!term) {
      return runs;
    }

    return runs.filter((run) =>
      [
        run.workflow_name,
        run.status,
        run.trigger_kind,
        run.id,
        run.workflow_id
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(term))
    );
  }, [runs, searchTerm]);
  const visibleWorkflowIds = useMemo(() => filteredWorkflows.map((workflow) => workflow.id), [filteredWorkflows]);
  const visibleRunIds = useMemo(() => filteredRuns.map((run) => run.id), [filteredRuns]);
  const selectedActionIds = activeTab === "workflows" ? selectedActionWorkflowIds : selectedActionRunIds;
  const visibleActionIds = activeTab === "workflows" ? visibleWorkflowIds : visibleRunIds;
  const areAllFilteredActionItemsSelected = visibleActionIds.length > 0 && visibleActionIds.every((id) => selectedActionIds.includes(id));

  const workflowColumns = useMemo<Array<DataTableColumn<AgenticWorkflow>>>(() => [
    {
      key: "name",
      label: "Workflow",
      minWidth: 240,
      sortValue: (workflow) => workflow.name,
      render: (workflow) => (
        <div className="agentic-table-primary" title={workflow.description || workflow.name}>
          <strong>{workflow.name}</strong>
          <span>{workflow.description || "No description"}</span>
        </div>
      )
    },
    {
      key: "status",
      label: "Status",
      width: 120,
      sortValue: (workflow) => workflow.status,
      render: (workflow) => <StatusBadge value={workflow.status} />
    },
    {
      key: "trigger",
      label: "Trigger",
      width: 130,
      sortValue: (workflow) => workflow.trigger_kind,
      render: (workflow) => <span className="count-pill">{workflow.trigger_kind}</span>
    },
    {
      key: "steps",
      label: "Steps",
      width: 110,
      sortValue: (workflow) => workflow.nodes.length,
      render: (workflow) => compactCount(workflow.nodes.length, "step")
    },
    {
      key: "runs",
      label: "Runs",
      width: 110,
      sortValue: (workflow) => workflow.run_count || 0,
      render: (workflow) => workflow.run_count || 0
    },
    {
      key: "latest",
      label: "Latest run",
      minWidth: 170,
      sortValue: (workflow) => workflow.latest_run_at || "",
      render: (workflow) => formatTimestamp(workflow.latest_run_at, "No runs")
    }
  ], []);

  const runColumns = useMemo<Array<DataTableColumn<AgenticWorkflowRun>>>(() => [
    {
      key: "workflow",
      label: "Workflow",
      minWidth: 240,
      sortValue: (run) => run.workflow_name,
      render: (run) => (
        <div className="agentic-table-primary" title={run.id}>
          <strong>{run.workflow_name}</strong>
          <span>{run.id}</span>
        </div>
      )
    },
    {
      key: "status",
      label: "Status",
      width: 125,
      sortValue: (run) => run.status,
      render: (run) => <StatusBadge value={run.status || "queued"} />
    },
    {
      key: "trigger",
      label: "Trigger",
      width: 130,
      sortValue: (run) => run.trigger_kind,
      render: (run) => <span className="count-pill">{run.trigger_kind}</span>
    },
    {
      key: "steps",
      label: "Step results",
      width: 140,
      sortValue: (run) => run.node_results.length,
      render: (run) => compactCount(run.node_results.length, "step")
    },
    {
      key: "created",
      label: "Created",
      minWidth: 170,
      sortValue: (run) => run.created_at || "",
      render: (run) => formatTimestamp(run.created_at)
    }
  ], []);

  const openDraft = (workflow?: AgenticWorkflow) => {
    const nextDraft = createWorkflowDraft(workflow);
    setDraft(nextDraft);
    setNodes(nextDraft.nodes.map((node) => ({ ...node, type: node.type || "agenticStep" })));
    setEdges(nextDraft.edges.map((edge) => ({
      ...edge,
      markerEnd: { type: MarkerType.ArrowClosed },
      style: { strokeWidth: 1.8 }
    })));
    setSelectedNodeId(nextDraft.nodes[0]?.id || "");
  };

  const closeDraft = () => {
    setDraft(null);
    setSelectedNodeId("");
    setNodes([]);
    setEdges([]);
  };

  const addWorkflowNode = (kind: WorkflowNodeKind) => {
    const id = `${kind}-${Date.now()}`;
    const x = Math.max(80, 90 + nodes.length * 260);
    const y = nodes.length % 2 === 0 ? 260 : 80;
    const nextNode: AgenticWorkflowNode = {
      id,
      type: "agenticStep",
      position: { x, y },
      data: {
        label: `${nodeKindLabels[kind]} step`,
        kind,
        summary: nodeKindDescriptions[kind],
        outputKey: `${kind}_${nodes.length + 1}`
      }
    };

    setNodes((current) => [...current, nextNode]);
    setSelectedNodeId(id);
  };

  const updateSelectedNode = (field: keyof AgenticWorkflowNodeData, value: string) => {
    if (!selectedNode) {
      return;
    }

    setNodes((current) =>
      current.map((node) =>
        node.id === selectedNode.id
          ? { ...node, data: { ...node.data, [field]: value } }
          : node
      )
    );
  };

  const saveCurrentDraft = async () => {
    if (!draft) {
      return null;
    }

    const workflow = await saveMutation.mutateAsync(draft);
    return workflow;
  };

  const runCurrentDraft = async () => {
    if (!draft) {
      return;
    }

    const workflow = await saveCurrentDraft();
    if (workflow) {
      runMutation.mutate(workflow);
    }
  };

  const onConnect = useCallback((connection: any) => {
    setEdges((currentEdges) => addEdge({
      ...connection,
      id: `${connection.source}-${connection.target}-${Date.now()}`,
      animated: true,
      markerEnd: { type: MarkerType.ArrowClosed },
      style: { strokeWidth: 1.8 }
    }, currentEdges));
  }, [setEdges]);

  const emptyScope = !projectId || !appTypeId;

  return (
    <div className="page page-agentic-workflows">
      <PageHeader
        eyebrow="Agent farm"
        title="Agentic Workflows"
        description="Create multi-agent workflow definitions, run them with immutable snapshots, and review historical workflow output."
        meta={[
          { label: "Workflows", value: workflows.length },
          { label: "Runs", value: runs.length },
          { label: "Scope", value: selectedAppType?.name || selectedProject?.name || "Not selected" }
        ]}
        actions={(
          <>
            <button
              className="primary-button"
              disabled={emptyScope}
              onClick={() => openDraft()}
              type="button"
            >
              <AddIcon />
              Create Agentic Workflow
            </button>
          </>
        )}
      />

      <WorkspaceScopeBar
        appTypeId={appTypeId}
        appTypes={scopedAppTypes}
        onAppTypeChange={setAppTypeId}
        onProjectChange={setProjectId}
        projectId={projectId}
        projects={projects}
      />

      <div className="agentic-workflows-tabs" role="tablist" aria-label="Agentic workflow sections">
        <button className={activeTab === "workflows" ? "is-active" : ""} onClick={() => setActiveTab("workflows")} type="button">
          Workflows <span>{workflows.length}</span>
        </button>
        <button className={activeTab === "runs" ? "is-active" : ""} onClick={() => setActiveTab("runs")} type="button">
          Workflow Runs <span>{runs.length}</span>
        </button>
      </div>

      <div className={draft || selectedRun ? "agentic-workspace-grid has-detail" : "agentic-workspace-grid"}>
      <Panel
        className="agentic-workflows-panel"
        title={activeTab === "workflows" ? "Agentic workflow catalog" : "Workflow run history"}
        titleVariant="eyebrow"
        subtitle={activeTab === "workflows" ? "Browse saved workflow definitions in the current project and app type." : "Review run records with the workflow snapshot captured at launch time."}
      >
        <div className="design-list-toolbar agentic-workflows-toolbar">
          <CatalogViewToggle onChange={setViewMode} value={viewMode} />
          <CatalogSearchFilter
            activeFilterCount={searchTerm.trim() ? 1 : 0}
            ariaLabel={activeTab === "workflows" ? "Search workflows" : "Search workflow runs"}
            onChange={setSearchTerm}
            placeholder={activeTab === "workflows" ? "Search workflows" : "Search workflow runs"}
            title={activeTab === "workflows" ? "Filter workflows" : "Filter workflow runs"}
            type="search"
            value={searchTerm}
          >
            <div className="catalog-filter-grid">
              <label className="catalog-filter-field">
                <span>Search</span>
                <input onChange={(event) => setSearchTerm(event.target.value)} value={searchTerm} />
              </label>
            </div>
          </CatalogSearchFilter>
          <button
            className="ghost-button catalog-selection-button"
            disabled={!visibleActionIds.length || areAllFilteredActionItemsSelected}
            onClick={() => {
              if (activeTab === "workflows") {
                setSelectedActionWorkflowIds((current) => Array.from(new Set([...current, ...visibleWorkflowIds])));
              } else {
                setSelectedActionRunIds((current) => Array.from(new Set([...current, ...visibleRunIds])));
              }
            }}
            type="button"
          >
            <SelectAllIcon />
            <span>Select all</span>
          </button>
          <button
            className="ghost-button catalog-selection-button"
            disabled={!selectedActionIds.length}
            onClick={() => {
              if (activeTab === "workflows") {
                setSelectedActionWorkflowIds([]);
              } else {
                setSelectedActionRunIds([]);
              }
            }}
            type="button"
          >
            <ClearSelectionIcon />
            <span>Clear</span>
          </button>
          {activeTab === "workflows" ? (
            <div className="agentic-workflows-toolbar-actions">
              <button className="ghost-button" disabled={emptyScope} onClick={() => openDraft()} type="button">
                <AddIcon />
                New
              </button>
            </div>
          ) : null}
        </div>

        <div className="agentic-catalog-stage" data-tab={activeTab} data-view={viewMode}>
          {emptyScope ? (
            <div className="empty-state compact">Select a project and app type to manage agentic workflows.</div>
          ) : activeTab === "workflows" ? (
            viewMode === "list" ? (
              <DataTable
                columns={workflowColumns}
                rows={filteredWorkflows}
                emptyMessage="No agentic workflows created yet."
                enableColumnResize
                enableHeaderColumnReorder
                getRowKey={(workflow) => workflow.id}
                getRowClassName={(workflow) => (draft?.id === workflow.id ? "is-active-row" : "")}
                hideToolbarCopy
                onRowClick={openDraft}
                storageKey="agentic-workflows-list-columns"
              />
            ) : (
              <div className="tile-browser-grid agentic-workflow-grid">
                {filteredWorkflows.map((workflow) => (
                  <article className={draft?.id === workflow.id ? "record-card tile-card agentic-workflow-card is-active" : "record-card tile-card agentic-workflow-card"} key={workflow.id}>
                    <div className="tile-card-select-row">
                      <label className="checkbox-field">
                        <input
                          aria-label={`Select ${workflow.name}`}
                          checked={selectedActionWorkflowIds.includes(workflow.id)}
                          onChange={() =>
                            setSelectedActionWorkflowIds((current) =>
                              current.includes(workflow.id) ? current.filter((id) => id !== workflow.id) : [...current, workflow.id]
                            )
                          }
                          type="checkbox"
                        />
                        <span className="sr-only">Select workflow</span>
                      </label>
                    </div>
                    <button className="tile-card-main agentic-workflow-card-button" onClick={() => openDraft(workflow)} type="button">
                      <div className="tile-card-header">
                        <div className="tile-card-title-group">
                          <span className="tile-card-kicker">{workflow.trigger_kind}</span>
                          <strong>{workflow.name}</strong>
                        </div>
                        <StatusBadge value={workflow.status} />
                      </div>
                      <p className="tile-card-description" title={workflow.description || ""}>{workflow.description || "No description"}</p>
                      <div className="tile-card-facts">
                        <span><strong>{workflow.nodes.length}</strong><small>Steps</small></span>
                        <span><strong>{workflow.run_count || 0}</strong><small>Runs</small></span>
                        <span><strong>{workflow.latest_run_status || "none"}</strong><small>Latest</small></span>
                      </div>
                    </button>
                  </article>
                ))}
                {!filteredWorkflows.length ? <div className="empty-state compact">No agentic workflows created yet.</div> : null}
              </div>
            )
          ) : viewMode === "list" ? (
            <DataTable
              columns={runColumns}
              rows={filteredRuns}
              emptyMessage="No workflow runs captured yet."
              enableColumnResize
              enableHeaderColumnReorder
              getRowKey={(run) => run.id}
              getRowClassName={(run) => (selectedRunId === run.id ? "is-active-row" : "")}
              hideToolbarCopy
              onRowClick={(run) => setSelectedRunId(run.id)}
              storageKey="agentic-workflow-runs-list-columns"
            />
          ) : (
            <div className="tile-browser-grid agentic-workflow-grid">
              {filteredRuns.map((run) => (
                <article className={selectedRunId === run.id ? "record-card tile-card agentic-workflow-card is-active" : "record-card tile-card agentic-workflow-card"} key={run.id}>
                  <div className="tile-card-select-row">
                    <label className="checkbox-field">
                      <input
                        aria-label={`Select ${run.workflow_name}`}
                        checked={selectedActionRunIds.includes(run.id)}
                        onChange={() =>
                          setSelectedActionRunIds((current) =>
                            current.includes(run.id) ? current.filter((id) => id !== run.id) : [...current, run.id]
                          )
                        }
                        type="checkbox"
                      />
                      <span className="sr-only">Select workflow run</span>
                    </label>
                  </div>
                  <button className="tile-card-main agentic-workflow-card-button" onClick={() => setSelectedRunId(run.id)} type="button">
                    <div className="tile-card-header">
                      <div className="tile-card-title-group">
                        <span className="tile-card-kicker">{formatTimestamp(run.created_at)}</span>
                        <strong>{run.workflow_name}</strong>
                      </div>
                      <StatusBadge value={run.status || "queued"} />
                    </div>
                    <p className="tile-card-description" title={run.id}>{run.id}</p>
                    <div className="tile-card-facts">
                      <span><strong>{run.node_results.length}</strong><small>Steps</small></span>
                      <span><strong>{run.trigger_kind}</strong><small>Trigger</small></span>
                      <span><strong>{run.completed_at ? "Yes" : "No"}</strong><small>Snapshot</small></span>
                    </div>
                  </button>
                </article>
              ))}
              {!filteredRuns.length ? <div className="empty-state compact">No workflow runs captured yet.</div> : null}
            </div>
          )}
        </div>
      </Panel>

      {draft ? (
        <Panel
          className="agentic-playground-panel"
          title="Agentic workflow playground"
          titleVariant="eyebrow"
          subtitle="Compose agent steps, connect them, and save a workflow definition."
          actions={(
            <div className="agentic-playground-actions">
              <button className="ghost-button" onClick={closeDraft} type="button">Close</button>
              {draft.id ? (
                <button
                  className="ghost-button danger"
                  disabled={deleteMutation.isPending}
                  onClick={() => deleteMutation.mutate(draft.id!)}
                  type="button"
                >
                  Delete
                </button>
              ) : null}
              <button className="ghost-button agentic-save-button" disabled={saveMutation.isPending} onClick={saveCurrentDraft} type="button">
                <SaveIcon />
                Save
              </button>
              <button className="primary-button" disabled={saveMutation.isPending || runMutation.isPending} onClick={runCurrentDraft} type="button">
                <PlayIcon />
                Run workflow
              </button>
            </div>
          )}
        >
          <div className="agentic-playground-grid">
            <div className="agentic-playground-main">
              <div className="agentic-workflow-form">
                <label>
                  <span>Name</span>
                  <input
                    onChange={(event) => setDraft((current) => current ? { ...current, name: event.target.value } : current)}
                    value={draft.name}
                  />
                </label>
                <label>
                  <span>Status</span>
                  <select
                    onChange={(event) => setDraft((current) => current ? { ...current, status: event.target.value as AgenticWorkflowStatus } : current)}
                    value={draft.status}
                  >
                    <option value="draft">Draft</option>
                    <option value="active">Active</option>
                    <option value="paused">Paused</option>
                  </select>
                </label>
                <label>
                  <span>Trigger</span>
                  <select
                    onChange={(event) => setDraft((current) => current ? { ...current, trigger_kind: event.target.value as AgenticWorkflowTriggerKind } : current)}
                    value={draft.trigger_kind}
                  >
                    <option value="manual">Manual</option>
                    <option value="release">Release</option>
                    <option value="schedule">Schedule</option>
                    <option value="webhook">Webhook</option>
                    <option value="event">Event</option>
                  </select>
                </label>
                <label className="agentic-workflow-form-wide">
                  <span>Description</span>
                  <input
                    onChange={(event) => setDraft((current) => current ? { ...current, description: event.target.value } : current)}
                    value={draft.description}
                  />
                </label>
              </div>

              <div className="agentic-node-palette" aria-label="Workflow node palette">
                {(Object.keys(nodeKindLabels) as WorkflowNodeKind[]).map((kind) => (
                  <button key={kind} onClick={() => addWorkflowNode(kind)} type="button">
                    <SparkIcon size={14} />
                    {nodeKindLabels[kind]}
                  </button>
                ))}
              </div>

              <div className="agentic-flow-shell">
                <ReactFlow
                  attributionPosition="bottom-right"
                  edges={edges}
                  fitView
                  nodeTypes={nodeTypes}
                  nodes={nodes}
                  onConnect={onConnect}
                  onEdgesChange={onEdgesChange}
                  onNodeClick={(_, node) => setSelectedNodeId(node.id)}
                  onNodesChange={onNodesChange}
                >
                  <Controls />
                  <MiniMap pannable zoomable />
                  <Background gap={18} size={1} />
                </ReactFlow>
              </div>
            </div>

            <aside className="agentic-playground-sidebar">
              <section className="agentic-inspector-card">
                <h3>Step inspector</h3>
                {selectedNode ? (
                  <>
                    <label>
                      <span>Label</span>
                      <input onChange={(event) => updateSelectedNode("label", event.target.value)} value={String(selectedNode.data.label || "")} />
                    </label>
                    <label>
                      <span>Kind</span>
                      <select onChange={(event) => updateSelectedNode("kind", event.target.value)} value={String(selectedNode.data.kind || "agent")}>
                        {(Object.keys(nodeKindLabels) as WorkflowNodeKind[]).map((kind) => (
                          <option key={kind} value={kind}>{nodeKindLabels[kind]}</option>
                        ))}
                      </select>
                    </label>
                    <label>
                      <span>Summary</span>
                      <textarea onChange={(event) => updateSelectedNode("summary", event.target.value)} value={String(selectedNode.data.summary || "")} />
                    </label>
                    <label>
                      <span>Prompt</span>
                      <textarea onChange={(event) => updateSelectedNode("prompt", event.target.value)} value={String(selectedNode.data.prompt || "")} />
                    </label>
                    <label>
                      <span>Output key</span>
                      <input onChange={(event) => updateSelectedNode("outputKey", event.target.value)} value={String(selectedNode.data.outputKey || "")} />
                    </label>
                  </>
                ) : (
                  <div className="empty-state compact">Select a workflow step.</div>
                )}
              </section>

              <section className="agentic-inspector-card">
                <h3>Run input</h3>
                <textarea className="agentic-run-input" onChange={(event) => setRunInput(event.target.value)} value={runInput} />
              </section>
            </aside>
          </div>
        </Panel>
      ) : null}

      {selectedRun ? (
        <Panel
          className="agentic-run-detail-panel"
          title="Workflow run snapshot"
          titleVariant="eyebrow"
          subtitle="The workflow snapshot below is the copy captured when this run was launched."
          actions={<button className="ghost-button" onClick={() => setSelectedRunId("")} type="button">Close</button>}
        >
          <div className="agentic-run-detail-grid">
            <div className="agentic-run-summary">
              <span className="count-pill">{selectedRun.trigger_kind}</span>
              <StatusBadge value={selectedRun.status || "queued"} />
              <strong>{selectedRun.workflow_name}</strong>
              <p>{formatTimestamp(selectedRun.created_at)}</p>
              <div>
                <span>Step results</span>
                <strong>{selectedRun.node_results.length}</strong>
              </div>
            </div>
            <div className="agentic-json-panel">
              <h3>Workflow snapshot</h3>
              <pre>{prettyJson(selectedRun.workflow_snapshot)}</pre>
            </div>
            <div className="agentic-json-panel">
              <h3>Output</h3>
              <pre>{prettyJson(selectedRun.output_payload)}</pre>
            </div>
          </div>
        </Panel>
      ) : null}
      </div>

      <ToastMessage message={toastMessage} onDismiss={() => setToastMessage("")} tone={toastTone} />
    </div>
  );
}
