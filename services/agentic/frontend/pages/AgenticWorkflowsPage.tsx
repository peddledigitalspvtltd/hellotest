import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { IconArrowLeft, IconArrowRight, IconClock, IconHistory, IconLayoutGrid, IconRoute, IconShieldCheck } from "@tabler/icons-react";
import { MarkerType, addEdge, type Connection, useEdgesState, useNodesState } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useAuth } from "@hellotest/platform/frontend/src/auth/AuthContext";
import { useLocalization } from "@hellotest/platform/frontend/src/context/LocalizationContext";
import { RepositoryAgents, REPOSITORY_AGENTS, isRepositoryAgentType } from "../agents/RepositoryAgents";
import { AgentDirectory } from "../agents/AgentDirectory";
import { AgentDefinitionEditor } from "../agents/AgentDefinitionEditor";
import { agentFromSpecialist, projectAgentNode, type AgentDefinition, type ProjectAgent } from "../agents/agentDefinitions";
import { specialistDefaults } from "../workflows/specialistProfiles";
import { AgentActivityCenter } from "../agents/AgentActivityCenter";
import { AGENT_EXPERIENCES } from "../agents/agentExperience";
import type { RepositoryAgentType } from "../agents/agentTypes";
import { CatalogSearchFilter } from "@hellotest/platform/frontend/src/shared/components/CatalogSearchFilter";
import { CatalogSelectionControls } from "@hellotest/platform/frontend/src/shared/components/CatalogSelectionControls";
import { CatalogViewToggle } from "@hellotest/platform/frontend/src/shared/components/CatalogViewToggle";
import { DataTable, type DataTableColumn } from "@hellotest/platform/frontend/src/shared/components/DataTable";
import { AddIcon, PlayIcon, SparkIcon } from "@hellotest/platform/frontend/src/platform/components/AppIcons";
import {
  AgentActivityTimeline,
  AgenticCommandComposer,
  AgenticOutcomePanel,
  HELLOTEST_AGENT_CATALOG,
  type HelloTestAgent
} from "../components/AgenticExperience";
import { PageHeader } from "@hellotest/platform/frontend/src/shared/components/PageHeader";
import { Panel } from "@hellotest/platform/frontend/src/shared/components/Panel";
import { LoadingState } from "@hellotest/platform/frontend/src/shared/components/LoadingState";
import { RichTextContent, richTextToPlainText } from "@hellotest/platform/frontend/src/platform/components/RichTextEditor";
import { StatusBadge } from "@hellotest/platform/frontend/src/shared/components/StatusBadge";
import { type SmartContextSelection } from "@hellotest/ai/frontend/components/SmartContextWorkbench";
import { ToastMessage } from "@hellotest/platform/frontend/src/shared/components/ToastMessage";
import { useCapabilityAccess } from "@hellotest/platform/frontend/src/platform/hooks/useCapabilityAccess";
import { useCurrentAppType, useCurrentProject } from "@hellotest/platform/frontend/src/platform/hooks/useCurrentProject";
import { useWorkspaceResource } from "@hellotest/platform/frontend/src/platform/hooks/useWorkspaceData";
import { api } from "@hellotest/platform/frontend/src/lib/api";
import { asArray } from "@hellotest/platform/frontend/src/shared/lib/collectionGuards";

import { areFeatureFlagsEnabled, requiredFeatureFlagsForPath } from "@hellotest/platform/frontend/src/platform/lib/featureFlags";
import { isRovoIntegrationId } from "@hellotest/integration/frontend/lib/rovo";
import { readDefaultCatalogViewMode } from "@hellotest/platform/frontend/src/shared/lib/viewPreferences";
import type { AgenticWorkflow, AgenticAssistantMode, AgenticAssistantSessionResponse, AgenticWorkflowEdge, AgenticWorkflowNode, AgenticWorkflowNodeData, AgenticWorkflowRun, AgenticWorkflowReadiness, Integration, WorkspaceTransaction } from "@hellotest/platform/frontend/src/types";
import "./AgenticWorkflowsPage.css";
import { WorkflowStudio } from "../workflows/WorkflowStudio";
import { WorkflowExecutionView } from "../workflows/WorkflowExecutionView";
import { WORKFLOW_TEMPLATES, draftFromTemplate } from "../workflows/workflowTemplates";

type WorkflowViewMode = "tile" | "list";
type WorkflowTab = "workflows" | "runs";
type AgenticPageSurface = "agents" | "activity" | "workbench" | "repository" | WorkflowTab;
import { WorkflowNodeKind, WorkflowDraft, AgenticCredential, AgenticApiResponseStyle, DEFAULT_RUN_INPUT, runMatchesDraft, layoutWorkflow, compactCount, safeJsonParse, prettyJson, buildNodeDefaults, createNodeId, createFlowEdge, insertWorkflowNode, canConnectWorkflow, type NodeInsertion, decorateFlowEdge, reviewDefinitionKey, normalizeWorkflowNodeDirectLlm, createWorkflowDraft, buildN8nPayload } from "../workflows/workflowGraph";

export function AgenticWorkflowsPage() {
  const { formatDate } = useLocalization();
  const formatTimestamp = useCallback((value?: string | null, fallback = "Not recorded") => !value || Number.isNaN(new Date(value).getTime()) ? fallback : formatDate(value, { dateStyle: "medium", timeStyle: "short" }), [formatDate]);
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const { session } = useAuth();
  const [projectId, setProjectId] = useCurrentProject();
  const [appTypeId, setAppTypeId] = useCurrentAppType(projectId);
  const { can, snapshot: featureFlags } = useCapabilityAccess(projectId);
  const isAgenticWorkflowsEnabled = areFeatureFlagsEnabled(
    featureFlags,
    ["hellotest.ai.agentic_workflows"]
  );
  const canViewAgenticWorkflows = can("agentic_workflow.view");
  const canManageAgenticWorkflows = can("agentic_workflow.manage");
  const canRunAgenticWorkflows = can("agentic_workflow.run");
  const canViewIntegrations = can("integration.view");
  const canUseKnowledge = can("knowledge.view");
  const projectAgentsQuery = useQuery({ queryKey: ["project-agents", projectId, session?.user.id], queryFn: ({ signal }) => api.agentDefinitions.list(projectId, { signal }), enabled: Boolean(projectId) && canViewAgenticWorkflows && isAgenticWorkflowsEnabled });
  const projectAgents = asArray(projectAgentsQuery.data);
  const agentCatalog = useMemo(() => [...HELLOTEST_AGENT_CATALOG, ...projectAgents.filter(item => item.active_version && !item.archived).map(item => {
    const definition = item.active_definition || item.definition;
    return { id: item.id, agentVersion: item.active_version!, name: definition.name, shortName: definition.name, description: definition.description, capabilities: ["Custom task"], contextScopes: definition.context_scopes, prompt: definition.objective, icon: <IconShieldCheck /> };
  })], [projectAgentsQuery.data]);
  const [agentEditor, setAgentEditor] = useState<{ agent?: ProjectAgent; initial?: AgentDefinition } | null>(null);
  const [agentEditorError, setAgentEditorError] = useState("");
  const [agentInputs, setAgentInputs] = useState<Record<string, unknown>>({});
  const requestedSurface = searchParams.get("view");
  const activeSurface: AgenticPageSurface = requestedSurface === "workbench"
    || requestedSurface === "activity"
    || requestedSurface === "repository"
    || requestedSurface === "agents"
    || requestedSurface === "workflows"
    || requestedSurface === "runs"
    ? requestedSurface
    : "workflows";
  const activeTab: WorkflowTab = activeSurface === "runs" ? "runs" : "workflows";
  const repositoryAgentType = isRepositoryAgentType(searchParams.get("agent")) ? searchParams.get("agent") as RepositoryAgentType : "object_repository";
  const selectedRepositoryAgent = REPOSITORY_AGENTS.find((agent) => agent.id === repositoryAgentType)!;
  const openRepositoryAgent = useCallback((agent: RepositoryAgentType, runId?: string) => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.set("view", "repository");
      next.set("agent", agent);
      if (runId) next.set("run", runId); else next.delete("run");
      next.delete("session");
      return next;
    });
  }, [setSearchParams]);
  const setActiveTab = useCallback((nextTab: WorkflowTab) => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.set("view", nextTab);
      next.delete("agent");
      next.delete("run");
      next.delete("session");
      return next;
    }, { replace: true });
  }, [setSearchParams]);
  const [searchTerm, setSearchTerm] = useState("");
  const [viewMode, setViewMode] = useState<WorkflowViewMode>(() => readDefaultCatalogViewMode());
  const [selectedActionWorkflowIds, setSelectedActionWorkflowIds] = useState<string[]>([]);
  const [selectedActionRunIds, setSelectedActionRunIds] = useState<string[]>([]);
  const [draft, setDraft] = useState<WorkflowDraft | null>(null);
  const [inspectedRun, setInspectedRun] = useState<AgenticWorkflowRun | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState("");
  const [selectedRunId, setSelectedRunId] = useState(() => searchParams.get("view") === "runs" ? searchParams.get("workflow_run") || "" : "");
  const [testingApiNodeId, setTestingApiNodeId] = useState("");
  const [runInput, setRunInput] = useState(DEFAULT_RUN_INPUT);
  const [reviewReadiness, setReviewReadiness] = useState<{ definition: string; workflow: AgenticWorkflow; report: AgenticWorkflowReadiness } | null>(null);
  const [checkingReview, setCheckingReview] = useState(false);
  const [reviewStartError, setReviewStartError] = useState("");
  const reviewRequest = useRef<{ key: string; id: string } | null>(null);
  const [assistantMode, setAssistantMode] = useState<AgenticAssistantMode>("agent");
  const [assistantAgentId, setAssistantAgentId] = useState("quality-orchestrator");
  const [assistantPrompt, setAssistantPrompt] = useState(HELLOTEST_AGENT_CATALOG[0].prompt);
  const [assistantContextScopes, setAssistantContextScopes] = useState<string[]>(["stories", "test-cases", "automation", "runs", "bugs", "knowledge"]);
  const [assistantSmartContext, setAssistantSmartContext] = useState<SmartContextSelection | null>(null);
  const [assistantIntegrationId, setAssistantIntegrationId] = useState("");
  const [selectedAssistantSessionId, setSelectedAssistantSessionId] = useState("");
  const [assistantReply, setAssistantReply] = useState<AgenticAssistantSessionResponse | null>(null);
  const [assistantResultTab, setAssistantResultTab] = useState<"brief" | "activity" | "history">("brief");
  const [assistantNotice, setAssistantNotice] = useState("");
  const [assistantTaskExpanded, setAssistantTaskExpanded] = useState(false);
  const [assistantStartedAt, setAssistantStartedAt] = useState<number | null>(null);
  const [assistantElapsed, setAssistantElapsed] = useState(0);
  const assistantController = useRef<AbortController | null>(null);
  const assistantRequestId = useRef(0);
  const workspaceScopeKey = `${projectId}:${appTypeId}`;
  const currentWorkspaceScope = useRef(workspaceScopeKey);
  const currentProjectId = useRef(projectId);
  currentProjectId.current = projectId;
  const previousWorkspaceScope = useRef(workspaceScopeKey);
  currentWorkspaceScope.current = workspaceScopeKey;
  const assistantScopeKey = `${projectId}:${appTypeId}:${activeSurface}:${assistantAgentId}`;
  const activeAssistantScope = useRef(assistantScopeKey);
  activeAssistantScope.current = assistantScopeKey;
  const [toastMessage, setToastMessage] = useState("");
  const [toastTone, setToastTone] = useState<"success" | "error" | "info">("success");
  const [nodes, setNodes, onNodesChange] = useNodesState<AgenticWorkflowNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<AgenticWorkflowEdge>([]);

  useEffect(() => {
    if (activeSurface !== "workbench") return;
    const requestedAgentId = searchParams.get("agent") || "";
    const requestedAgent = agentCatalog.find((agent) => agent.id === requestedAgentId);
    if (!requestedAgent || requestedAgent.id === assistantAgentId) return;
    setAssistantAgentId(requestedAgent.id);
    setAssistantPrompt(requestedAgent.prompt);
    setAssistantContextScopes(requestedAgent.contextScopes);
    setAssistantSmartContext(null);
    setAgentInputs({});
    setAssistantIntegrationId(projectAgents.find(agent => agent.id === requestedAgent.id)?.active_definition?.integration_id || "");
  }, [activeSurface, assistantAgentId, searchParams, agentCatalog]);

  useEffect(() => {
    setAssistantSmartContext(null);
    setAssistantIntegrationId("");
    setAgentEditor(null); setAgentEditorError(""); setAgentInputs({});
  }, [appTypeId, projectId]);

  useEffect(() => {
    if (previousWorkspaceScope.current === workspaceScopeKey) return;
    if (assistantAgentId.startsWith("agent-")) {
      setAssistantAgentId(HELLOTEST_AGENT_CATALOG[0].id); setAssistantPrompt(HELLOTEST_AGENT_CATALOG[0].prompt); setAssistantContextScopes(HELLOTEST_AGENT_CATALOG[0].contextScopes);
      setSearchParams(current => { const next = new URLSearchParams(current); next.delete("agent"); next.delete("session"); return next; }, { replace: true });
    }
    setDraft(null); setInspectedRun(null); setSelectedNodeId(""); setReviewReadiness(null); setReviewStartError(""); reviewRequest.current = null;
    setRunInput(DEFAULT_RUN_INPUT);
    setNodes([]); setEdges([]); setTestingApiNodeId(""); setSelectedActionWorkflowIds([]); setSelectedActionRunIds([]);
    if (previousWorkspaceScope.current !== workspaceScopeKey) setSearchParams(current => { const next = new URLSearchParams(current); next.delete("workflow_run"); return next; }, { replace: true });
    previousWorkspaceScope.current = workspaceScopeKey;
  }, [workspaceScopeKey, setNodes, setEdges, setSearchParams]);

  useEffect(() => {
    setSelectedRunId(activeSurface === "runs" ? searchParams.get("workflow_run") || "" : "");
  }, [activeSurface, searchParams]);

  useEffect(() => {
    setAssistantReply(null);
    setAssistantTaskExpanded(false);
    setAssistantNotice("");
    setAssistantStartedAt(null);
    setAssistantResultTab("brief");
    setSelectedAssistantSessionId("");
    return () => { assistantController.current?.abort(); assistantRequestId.current += 1; };
  }, [assistantScopeKey]);

  useEffect(() => {
    if (!assistantStartedAt) { setAssistantElapsed(0); return; }
    const update = () => setAssistantElapsed(Math.max(0, Math.floor((Date.now() - assistantStartedAt) / 1000)));
    update(); const timer = window.setInterval(update, 1000); return () => window.clearInterval(timer);
  }, [assistantStartedAt]);

  useEffect(() => {
    if (activeSurface === "workbench") setSelectedAssistantSessionId(searchParams.get("session") || "");
  }, [activeSurface, assistantScopeKey, searchParams]);

  useEffect(() => {
    const handoff = window.sessionStorage.getItem("hellotest.agentic.handoff");
    if (!handoff) return;

    window.sessionStorage.removeItem("hellotest.agentic.handoff");
    try {
      const context = JSON.parse(handoff) as { prompt?: string; source?: string; created_at?: string };
      if (!context.prompt) return;
      setRunInput(JSON.stringify({
        request: context.prompt,
        handoff: {
          source: context.source || "HelloTest workspace",
          created_at: context.created_at || new Date().toISOString(),
          requires_human_review: true
        }
      }, null, 2));
      setToastTone("info");
      setToastMessage("Review context is available in the workflow preview input. Choose or create a workflow to inspect the plan.");
    } catch {
      setToastTone("error");
      setToastMessage("The agent review context could not be restored. Open the source review again to retry.");
    }
  }, []);

  const projectsQuery = useWorkspaceResource(["projects"], signal => api.projects.list({ signal }), can("project.view", null), true);
  const appTypesQuery = useWorkspaceResource(
    ["app-types", projectId], signal => api.appTypes.list({ project_id: projectId }, { signal }),
    Boolean(projectId) && can("app_type.view"), true
  );
  const llmIntegrationsQuery = useWorkspaceResource(
    ["integrations", "agentic-workflows", "llm", projectId, appTypeId],
    signal => api.integrations.list({ type: "llm" }, { signal }),
    canViewIntegrations, activeSurface === "workbench" || activeSurface === "workflows" || Boolean(agentEditor)
  );

  const projects = asArray(projectsQuery.data);
  const allAppTypes = asArray(appTypesQuery.data);
  const llmIntegrations = asArray(llmIntegrationsQuery.data).filter((integration) => !isRovoIntegrationId(integration.id));
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
    queryFn: ({ signal }) => api.agenticWorkflows.list({ project_id: projectId, app_type_id: appTypeId }, { signal }),
    enabled: Boolean(projectId) && canViewAgenticWorkflows && (activeSurface === "workflows" || activeSurface === "runs")
  });

  const runsQuery = useQuery({
    queryKey: ["agentic-workflow-runs", projectId, appTypeId],
    queryFn: ({ signal }) => api.agenticWorkflows.listRuns({ project_id: projectId, app_type_id: appTypeId, limit: 50, summary_only: true }, { signal }),
    enabled: Boolean(projectId) && canViewAgenticWorkflows && (activeSurface === "workflows" || activeSurface === "runs"),
    refetchInterval: (query) => (activeSurface === "workflows" || activeSurface === "runs") && ((query.state.data || []) as AgenticWorkflowRun[]).some((run) => ["queued", "running"].includes(run.status)) ? 2000 : false
  });

  const workflowHistoryQuery = useQuery({
    queryKey: ["agentic-workflow-runs", projectId, appTypeId, draft?.id],
    queryFn: ({ signal }) => api.agenticWorkflows.listRuns({ project_id: projectId, app_type_id: appTypeId, workflow_id: draft!.id, limit: 50, summary_only: true }, { signal }),
    enabled: Boolean(projectId && draft?.id) && canViewAgenticWorkflows,
    retry: false
  });

  const selectedRunQuery = useQuery({
    queryKey: ["agentic-workflow-run", projectId, appTypeId, selectedRunId],
    queryFn: async ({ signal }) => {
      const run = await api.agenticWorkflows.getRun(selectedRunId, { signal });
      if (run?.id && (run.project_id !== projectId || (appTypeId && run.app_type_id !== appTypeId))) throw new Error("This workflow execution does not belong to the selected project and application.");
      return run;
    },
    enabled: Boolean(projectId && selectedRunId) && canViewAgenticWorkflows,
    refetchInterval: query => query.state.data?.status === "running" ? 2000 : false
  });

  const assistantSessionsQuery = useQuery({
    queryKey: ["workspace-transactions", "ai-agent", projectId, appTypeId],
    queryFn: ({ signal }) => api.agenticWorkflows.listSessions({
      project_id: projectId,
      app_type_id: appTypeId || undefined,
      limit: 20
    }, { signal }),
    enabled: Boolean(projectId) && canViewAgenticWorkflows && activeSurface === "workbench"
  });

  const assistantSavedSessionQuery = useQuery({
    queryKey: ["agent-specialist-session", projectId, appTypeId, assistantAgentId, selectedAssistantSessionId],
    queryFn: async ({ signal }) => {
      const saved = await api.agenticWorkflows.getSession(selectedAssistantSessionId, { signal });
      if (saved.transaction.project_id !== projectId || (saved.transaction.app_type_id || "") !== appTypeId || saved.transaction.metadata.agent_id !== assistantAgentId) {
        throw new Error("This review belongs to a different project, application or specialist.");
      }
      return saved;
    },
    enabled: Boolean(projectId && selectedAssistantSessionId) && canViewAgenticWorkflows && activeSurface === "workbench" && assistantReply?.transaction.id !== selectedAssistantSessionId,
    retry: false,
    refetchInterval: query => query.state.data?.session_state === "running" ? 3000 : false
  });

  const workflows = asArray(workflowsQuery.data);
  const runs = asArray(runsQuery.data);
  const assistantSessions = asArray(assistantSessionsQuery.data) as WorkspaceTransaction[];
  const selectedRun = selectedRunQuery.data?.id === selectedRunId ? selectedRunQuery.data : runs.find((run) => run.id === selectedRunId) || null;
  const selectedAssistantAgent = agentCatalog.find((agent) => agent.id === assistantAgentId) || HELLOTEST_AGENT_CATALOG[0];
  const selectedProjectAgent = projectAgents.find(item => item.id === assistantAgentId);
  const specialistExperience = AGENT_EXPERIENCES[selectedAssistantAgent.id] || { category: "planning", outcome: selectedAssistantAgent.description || selectedAssistantAgent.prompt, inputs: "Configured project evidence and supplied inputs", output: "Structured AI review", destination: "/agentic-workflows?view=agents", destinationLabel: "Agent library", destinationPermission: "agentic_workflow.view", starters: [selectedAssistantAgent.prompt] };
  const selectedNode = nodes.find((node) => node.id === selectedNodeId) || null;
  const workflowCredentials = useMemo(() => {
    const credentials = draft?.settings?.agenticCredentials;
    return Array.isArray(credentials) ? (credentials as AgenticCredential[]) : [];
  }, [draft?.settings]);
  const llmProviderOptions = useMemo(() => {
    const providers = llmIntegrations
      .filter((integration) => integration.type === "llm" && (!integration.config?.project_id || integration.config.project_id === projectId))
      .sort((left, right) => Number(right.is_active) - Number(left.is_active) || left.name.localeCompare(right.name))
      .map((integration: Integration) => ({
        value: integration.id,
        label: `${integration.name}${integration.model ? ` · ${integration.model}` : ""}${integration.is_active ? "" : " · inactive"}`,
        modelLabel: integration.model || integration.name
      }));

    return [
      { value: "", label: "Default workspace LLM", modelLabel: "Default workspace LLM" },
      ...providers
    ];
  }, [llmIntegrations, projectId]);
  const saveAgentMutation = useMutation({
    mutationFn: (submission: { project_id: string; definition: AgentDefinition; activate: boolean; id?: string; expected_version?: number }) => api.agentDefinitions.save(submission, submission.id),
    onSuccess: (saved, submission) => {
      void queryClient.invalidateQueries({ queryKey: ["project-agents", submission.project_id] });
      if (submission.project_id !== currentProjectId.current) return;
      setAgentEditor(null); setAgentEditorError(""); setToastTone("success");
      setToastMessage(submission.activate ? `${saved.definition.name} is active and available in workflows.` : "Agent draft saved. Activate it when ready.");
    },
    onError: (failure, submission) => { if (submission.project_id === currentProjectId.current) setAgentEditorError(failure instanceof Error ? failure.message : "Unable to save this agent."); }
  });
  const invalidateWorkflowData = () => {
    void queryClient.invalidateQueries({ queryKey: ["agentic-workflows"] });
    void queryClient.invalidateQueries({ queryKey: ["agentic-workflow-runs"] });
  };

  type AssistantSubmission = { input: Parameters<typeof api.agenticWorkflows.ask>[0]; scope: string; requestId: number; signal: AbortSignal };
  const assistantMutation = useMutation({
    mutationFn: (submission: AssistantSubmission) => api.agenticWorkflows.ask(submission.input, { signal: submission.signal }),
    onSuccess: (response, submission) => {
      if (submission.signal.aborted || submission.scope !== activeAssistantScope.current || submission.requestId !== assistantRequestId.current) return;
      if (response.transaction.project_id !== submission.input.project_id || (response.transaction.app_type_id || "") !== (submission.input.app_type_id || "")) { setAssistantStartedAt(null); setAssistantNotice("The review response did not match this workspace. Start a fresh review."); return; }
      setAssistantTaskExpanded(false);
      setAssistantReply(response);
      setSelectedAssistantSessionId(response.transaction.id);
      setAssistantStartedAt(null);
      setAssistantResultTab("brief");
      void queryClient.invalidateQueries({ queryKey: ["workspace-transactions", "ai-agent", projectId, appTypeId] });
      queryClient.setQueryData(["workspace-transaction-events", projectId, appTypeId, response.transaction.id], response.events);
      setSearchParams(current => { const next = new URLSearchParams(current); next.set("session", response.transaction.id); return next; }, { replace: true });
    },
    onError: (error, submission) => {
      if (submission.scope !== activeAssistantScope.current || submission.requestId !== assistantRequestId.current) return;
      setAssistantStartedAt(null);
      setAssistantNotice(submission.signal.aborted ? "Review stopped. Your task is retained and can be started again." : error instanceof Error ? error.message : "The review could not finish. Your task is retained; try again.");
    }
  });
  const startAssistantReview = () => {
    if (!projectId || !canRunAgenticWorkflows || assistantMutation.isPending || !assistantPrompt.trim()) return;
    assistantController.current?.abort();
    const controller = new AbortController(); assistantController.current = controller;
    const requestId = ++assistantRequestId.current;
    setAssistantNotice(""); setAssistantReply(null); setSelectedAssistantSessionId(""); setAssistantResultTab("brief"); setAssistantStartedAt(Date.now());
    setSearchParams(current => { const next = new URLSearchParams(current); next.delete("session"); return next; }, { replace: true });
    assistantMutation.mutate({ scope: assistantScopeKey, requestId, signal: controller.signal, input: {
      project_id: projectId, app_type_id: appTypeId || undefined, mode: assistantMode,
      agent_id: assistantAgentId, agent_version: selectedAssistantAgent.agentVersion, inputs: agentInputs, prompt: assistantPrompt, context_scopes: assistantContextScopes,
      smart_context: canUseKnowledge && assistantSmartContext ? { query: assistantSmartContext.query, source_ids: assistantSmartContext.sourceIds, source_kinds: assistantSmartContext.sourceKinds, reviewed_context: assistantSmartContext.contextText } : undefined,
      integration_id: canViewIntegrations ? assistantIntegrationId || undefined : undefined
    } });
  };

  const saveMutation = useMutation({
    mutationFn: async (nextDraft: WorkflowDraft) => {
      if (!projectId) {
        throw new Error("Select a project first.");
      }

      const directLlmNodes = nodes.map(normalizeWorkflowNodeDirectLlm);
      const payload = {
        project_id: projectId,
        app_type_id: appTypeId || undefined,
        name: nextDraft.name,
        description: nextDraft.description,
        status: nextDraft.status,
        trigger_kind: nextDraft.trigger_kind,
        nodes: directLlmNodes,
        edges,
        settings: nextDraft.settings,
        n8n_payload: buildN8nPayload(nextDraft, directLlmNodes, edges)
      };

      return nextDraft.id
        ? api.agenticWorkflows.update(nextDraft.id, payload)
        : api.agenticWorkflows.create(payload);
    },
    onSuccess: (workflow) => {
      invalidateWorkflowData();
      if (`${workflow.project_id}:${workflow.app_type_id || ""}` !== currentWorkspaceScope.current) return;
      setDraft(createWorkflowDraft(workflow));
      setNodes(workflow.nodes.map(normalizeWorkflowNodeDirectLlm));
      setEdges(workflow.edges.map(decorateFlowEdge));
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
      if (`${run.project_id}:${run.app_type_id || ""}` !== currentWorkspaceScope.current) return;
      queryClient.setQueryData<AgenticWorkflowRun[]>(["agentic-workflow-runs", projectId, appTypeId], current => [run, ...asArray(current).filter(item => item.id !== run.id)]);
      openRun(run);
      setToastTone("success");
      setToastMessage("Workflow preview captured. Tools and model calls were not executed.");
    },
    onError: (error) => {
      setToastTone("error");
      setToastMessage(error instanceof Error ? error.message : "Unable to preview workflow.");
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

  const executeReviewMutation = useMutation({
    mutationFn: ({ workflow, input, requestId, targetNodeId }: { workflow: AgenticWorkflow; input: Record<string, unknown>; requestId: string; targetNodeId?: string }) =>
      api.agenticWorkflows.execute(workflow.id, { request_id: requestId, input_payload: input, target_node_id: targetNodeId }),
    onSuccess: run => {
      invalidateWorkflowData();
      if (`${run.project_id}:${run.app_type_id || ""}` !== currentWorkspaceScope.current) return;
      queryClient.setQueryData<AgenticWorkflowRun[]>(["agentic-workflow-runs", projectId, appTypeId], current => [run, ...asArray(current).filter(item => item.id !== run.id)]);
      reviewRequest.current = null;
      setReviewStartError("");
      openRun(run);
      setToastTone("success"); setToastMessage("Review workflow started. Each specialist result will be saved as it finishes.");
    },
    onError: (error, submission) => { if (`${submission.workflow.project_id}:${submission.workflow.app_type_id || ""}` === currentWorkspaceScope.current) setReviewStartError(error instanceof Error ? error.message : "The review could not start. Your input is retained; try again."); }
  });

  const cancelReviewMutation = useMutation({
    mutationFn: api.agenticWorkflows.cancelRun,
    onSuccess: run => {
      queryClient.setQueryData(["agentic-workflow-run", run.project_id, run.app_type_id || "", run.id], run);
      queryClient.setQueryData<AgenticWorkflowRun[]>(["agentic-workflow-runs", run.project_id, run.app_type_id || ""], current => asArray(current).map(item => item.id === run.id ? run : item));
      invalidateWorkflowData();
      setToastTone("success"); setToastMessage("Review workflow stopped. Completed specialist reviews are preserved.");
    },
    onError: error => { setToastTone("error"); setToastMessage(error instanceof Error ? error.message : "Unable to stop the review. Refresh its status and try again."); }
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
        <div className="agentic-table-primary" title={richTextToPlainText(workflow.description) || workflow.name}>
          <strong>{workflow.name}</strong>
          <span>{richTextToPlainText(workflow.description) || "No description"}</span>
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
  ], [formatTimestamp]);

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
      render: (run) => <span className="agent-workflow-status">{run.execution_mode === "review" ? "Review" : "Preview"} · <StatusBadge value={run.status || "queued"} /></span>
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
  ], [formatTimestamp]);

  const openDraft = (workflow?: AgenticWorkflow, inspection?: AgenticWorkflowRun) => {
    setInspectedRun(inspection || null);
    setSearchParams(current => { const next = new URLSearchParams(current); next.set("view", "workflows"); next.delete("workflow_run"); next.delete("agent"); next.delete("session"); next.delete("run"); return next; });
    const nextDraft = createWorkflowDraft(workflow);
    setSelectedRunId("");
    setReviewReadiness(null); setReviewStartError(""); reviewRequest.current = null;
    setDraft(nextDraft);
    setNodes(nextDraft.nodes.map((node) => ({ ...node, type: node.type || "agenticStep" })));
    setEdges(nextDraft.edges.map(decorateFlowEdge));
    setSelectedNodeId(nextDraft.nodes[0]?.id || "");
  };

  const selectAssistantAgent = (agent: HelloTestAgent) => {
    setAssistantAgentId(agent.id);
    setAgentInputs({});
    setAssistantIntegrationId(projectAgents.find(item => item.id === agent.id)?.active_definition?.integration_id || "");
    setAssistantPrompt(agent.prompt);
    setAssistantContextScopes(agent.contextScopes);
    setAssistantSmartContext(null);
  };

  const openAgentWorkbench = (agent: HelloTestAgent) => {
    selectAssistantAgent(agent);
    setSelectedAssistantSessionId("");
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.set("view", "workbench");
      next.set("agent", agent.id);
      next.delete("run");
      next.delete("session");
      return next;
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const openAgentCatalog = () => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.set("view", "agents");
      next.delete("agent");
      next.delete("run");
      next.delete("session");
      return next;
    });
  };

  const openAssistantWorkflowDraft = () => {
    const specialist = selectedAssistantAgent;
    const reviewTransaction = mutationSessionIsSelected ? assistantReply?.transaction : savedAssistant?.transaction;
    const reviewMetadata = reviewTransaction?.metadata || {};
    const reviewRoute = reviewMetadata.context_route as { resolved_query?: string } | undefined;
    const reviewPrompt = reviewRoute?.resolved_query || reviewTransaction?.description || assistantPrompt;
    const reviewScopes = Array.isArray(reviewMetadata.context_scopes) ? reviewMetadata.context_scopes.filter((value): value is string => typeof value === "string") : assistantContextScopes;
    const reviewSmartContext = canUseKnowledge && mutationSessionIsSelected ? assistantSmartContext : null;
    const nextNodes: AgenticWorkflowNode[] = [
      {
        id: "agent-request-intake",
        type: "agenticStep",
        position: { x: 60, y: 145 },
        data: {
          label: "Request intake",
          kind: "trigger",
          summary: "Capture the user objective, selected scopes, and approval boundary.",
          outputKey: "bounded_request",
          sampleOutput: "Validated agent request"
        }
      },
      {
        id: `specialist-${specialist.id}`,
        type: "agenticStep",
        position: { x: 370, y: 90 },
        data: {
          ...(selectedProjectAgent ? projectAgentNode(selectedProjectAgent) : specialistDefaults(specialist.id)),
          label: specialist.name,
          kind: "agent",
          agentId: specialist.id,
          summary: specialist.description,
          intent: reviewPrompt,
          prompt: reviewPrompt,
          model: "Default workspace LLM",
          llmIntegrationId: assistantIntegrationId,
          knowledgeScope: reviewScopes.join(","),
          knowledgeQuery: reviewSmartContext?.query || reviewPrompt,
          knowledgeSourceIds: reviewSmartContext?.sourceIds || [],
          reviewedContextFingerprint: reviewSmartContext?.contextText ? `reviewed:${reviewSmartContext.chunkIds.join(",")}` : "",
          toolPolicy: "approved-tools-only",
          timeoutMs: "45000",
          retryCount: "1",
          redactSecrets: "true",
          outputKey: "specialist_outcome",
          sampleOutput: "Grounded specialist recommendation"
        }
      },
      {
        id: "agent-quality-evaluator",
        type: "agenticStep",
        position: { x: 990, y: 90 },
        data: {
          label: "Quality Evaluator",
          kind: "agent",
          agentId: "quality-evaluator",
          summary: "Review evidence coverage, traceability and unresolved risks.",
          prompt: "Evaluate the guarded outcome. Return scores, limitations, citations, and the human decision required.",
          model: "Default workspace LLM",
          outputKey: "evaluated_outcome",
          sampleOutput: "Maturity evaluation and evidence"
        }
      },
      {
        id: "agent-human-review",
        type: "agenticStep",
        position: { x: 1300, y: 145 },
        data: {
          label: "Human review",
          kind: "output",
          summary: "Present the outcome and require a person to approve any artifact change.",
          outputKey: "review_packet",
          sampleOutput: "Review-ready result"
        }
      }
    ];
    const nextEdges = [
      createFlowEdge("agent-request-intake", `specialist-${specialist.id}`),
      createFlowEdge(`specialist-${specialist.id}`, "agent-quality-evaluator"),
      createFlowEdge("agent-quality-evaluator", "agent-human-review")
    ];
    const nextDraft: WorkflowDraft = {
      name: `${specialist.name} · governed workflow`,
      description: `A reusable ${specialist.name} review followed by independent evidence evaluation and a human review packet.`,
      status: "draft",
      trigger_kind: "manual",
      nodes: nextNodes,
      edges: nextEdges,
      settings: {
        execution_mode: "review",
        source_review_id: reviewTransaction?.id || null,
        snapshot_runs: true,
        requires_human_review: true,
        context_scopes: reviewScopes,
        smart_context: reviewSmartContext ? {
          query: reviewSmartContext.query,
          source_ids: reviewSmartContext.sourceIds,
          source_kinds: reviewSmartContext.sourceKinds,
          chunk_ids: reviewSmartContext.chunkIds
        } : null
      }
    };
    setSelectedAssistantSessionId("");
    setSelectedRunId("");
    setRunInput(JSON.stringify({ ...agentInputs, request: reviewPrompt, source_review_id: reviewTransaction?.id || null, reviewed_outcome: activeAssistantResult?.response || "" }, null, 2));
    setActiveTab("workflows");
    setDraft(nextDraft);
    setNodes(nextNodes);
    setEdges(nextEdges);
    setSelectedNodeId(nextNodes[0].id);
  };

  const openRun = (run: AgenticWorkflowRun) => {
    setDraft(null);
    setSelectedNodeId("");
    setNodes([]);
    setEdges([]);
    setSelectedRunId(run.id);
    setSearchParams(current => { const next = new URLSearchParams(current); next.set("view", "runs"); next.set("workflow_run", run.id); next.delete("agent"); next.delete("run"); next.delete("session"); return next; });
  };

  const closeRun = () => {
    setSelectedRunId("");
    setSearchParams(current => { const next = new URLSearchParams(current); next.delete("workflow_run"); return next; }, { replace: true });
  };

  const closeDraft = () => {
    setDraft(null);
    setSelectedNodeId("");
    setNodes([]);
    setEdges([]);
  };

  const addWorkflowNode = (kind: WorkflowNodeKind, insertion?: NodeInsertion, agent?: ProjectAgent) => {
    try {
      let target = insertion;
      if (!target && selectedNode) {
        target = selectedNode.data.kind === "output"
          ? { edgeId: edges.find(edge => edge.target === selectedNode.id)?.id }
          : { sourceId: selectedNode.id, sourceHandle: selectedNode.data.kind === "condition" ? "true" : null };
      }
      if (!target && nodes.length) {
        const leaf = nodes.find(node => node.data.kind !== "output" && !edges.some(edge => edge.source === node.id));
        target = leaf ? { sourceId: leaf.id, sourceHandle: leaf.data.kind === "condition" ? "true" : null } : { edgeId: edges.find(edge => nodes.find(node => node.id === edge.target)?.data.kind === "output")?.id };
      }
      const next = insertWorkflowNode(nodes, edges, kind, target);
      if (agent) next.node.data = { ...next.node.data, ...projectAgentNode(agent) };
      setNodes(next.nodes); setEdges(next.edges); setSelectedNodeId(next.node.id);
    } catch (failure) {
      setReviewStartError(failure instanceof Error ? failure.message : "Unable to add this node.");
    }
  };

  const deleteSelectedNode = () => {
    if (!selectedNode) {
      return;
    }

    const deletedNodeId = selectedNode.id;
    const nextNodes = nodes.filter((node) => node.id !== deletedNodeId);
    setNodes(nextNodes);
    setEdges(current => {
      const incoming = current.filter(edge => edge.target === deletedNodeId), outgoing = current.filter(edge => edge.source === deletedNodeId);
      const retained = current.filter(edge => edge.source !== deletedNodeId && edge.target !== deletedNodeId);
      return incoming.length === 1 && outgoing.length === 1 && !retained.some(edge => edge.source === incoming[0].source && edge.target === outgoing[0].target)
        ? [...retained, { ...createFlowEdge(incoming[0].source, outgoing[0].target), sourceHandle: incoming[0].sourceHandle, targetHandle: outgoing[0].targetHandle }] : retained;
    });
    updateDraftSetting(
      "agenticCredentials",
      workflowCredentials.map((credential) =>
        credential.agentId === deletedNodeId ? { ...credential, agentId: "" } : credential
      )
    );
    setSelectedNodeId(nextNodes[0]?.id || "");
    setToastTone("info");
    setToastMessage("Node deleted and connected edges removed.");
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

  const updateSelectedNodeFields = (patch: Partial<AgenticWorkflowNodeData>) => {
    if (!selectedNode) {
      return;
    }

    setNodes((current) =>
      current.map((node) =>
        node.id === selectedNode.id
          ? { ...node, data: { ...node.data, ...patch } }
          : node
      )
    );
  };

  const updateDraftSetting = (key: string, value: unknown) => {
    setDraft((current) => current ? { ...current, settings: { ...current.settings, [key]: value } } : current);
  };

  const testSelectedApiAgent = async () => {
    const requestScope = workspaceScopeKey;
    if (!selectedNode || !projectId || !canRunAgenticWorkflows) {
      return;
    }
    if (/\$(?:input|request|item|nodes)(?:\.|\b)/.test(`${selectedNode.data.apiUrl || ""} ${selectedNode.data.apiBody || ""}`)) {
      await prepareAndExecute(selectedNode.id);
      return;
    }

    const method = String(selectedNode.data.apiMethod || "GET");
    const url = String(selectedNode.data.apiUrl || "");
    const responseStyle = String(selectedNode.data.apiResponseStyle || "json") as AgenticApiResponseStyle;

    if (!url.trim() && !selectedNode.data.connectionId) {
      updateSelectedNode("apiTestOutput", prettyJson({ ok: false, status: 422, message: "Configure an endpoint URL before testing." }));
      return;
    }

    setTestingApiNodeId(selectedNode.id);
    updateSelectedNode("apiTestOutput", prettyJson({ status: "running", method, url, responseStyle }));

    try {
      const result = await api.agenticWorkflows.testHttpNode(projectId, selectedNode.data);

      if (requestScope !== currentWorkspaceScope.current) return;
      updateSelectedNode("apiTestOutput", prettyJson(result));
      setToastTone("success");
      setToastMessage("API agent test completed.");
    } catch (error) {
      if (requestScope !== currentWorkspaceScope.current) return;
      const message = error instanceof Error ? error.message : "Unable to test API agent.";
      updateSelectedNode("apiTestOutput", prettyJson({ ok: false, method, url, responseStyle, message }));
      setToastTone("error");
      setToastMessage(message);
    } finally {
      if (requestScope === currentWorkspaceScope.current) setTestingApiNodeId("");
    }
  };

  const saveCurrentDraft = async () => {
    if (!draft || !canManageAgenticWorkflows) {
      return null;
    }

    try { return await saveMutation.mutateAsync(draft); }
    catch { return null; }
  };

  const runCurrentDraft = async () => {
    const requestScope = workspaceScopeKey;
    if (!draft || !canRunAgenticWorkflows) {
      return;
    }

    try { safeJsonParse(runInput); } catch (error) { setToastTone("error"); setToastMessage(error instanceof Error ? error.message : "Invalid preview input."); return; }
    const workflow = canManageAgenticWorkflows
      ? await saveCurrentDraft()
      : workflows.find((candidate) => candidate.id === draft.id) || null;
    if (workflow && requestScope === currentWorkspaceScope.current) {
      runMutation.mutate(workflow);
    }
  };

  const checkReviewReadiness = async () => {
    if (!draft || checkingReview) return;
    const requestScope = workspaceScopeKey;
    setCheckingReview(true); setReviewStartError("");
    try {
      const workflow = canManageAgenticWorkflows ? await saveCurrentDraft() : draft.id ? await api.agenticWorkflows.get(draft.id) : null;
      if (!workflow) return;
      const report = await api.agenticWorkflows.readiness(workflow.id);
      if (requestScope !== currentWorkspaceScope.current) return;
      setReviewReadiness({ definition: reviewDefinitionKey(workflow.nodes, workflow.edges, workflow.status, workflow.trigger_kind, workflow.settings), workflow, report });
    } catch (error) {
      if (requestScope === currentWorkspaceScope.current) setReviewStartError(error instanceof Error ? error.message : "Could not check this workflow. Try again.");
    } finally { setCheckingReview(false); }
  };

  const readinessMatchesDraft = Boolean(draft && reviewReadiness && reviewReadiness.workflow.id === draft.id
    && reviewReadiness.definition === reviewDefinitionKey(nodes, edges, draft.status, draft.trigger_kind, draft.settings));

  const prepareAndExecute = async (targetNodeId?: string) => {
    if (!draft || !canRunAgenticWorkflows || checkingReview || executeReviewMutation.isPending) return;
    const requestScope = workspaceScopeKey;
    setCheckingReview(true); setReviewStartError("");
    try {
      const input = safeJsonParse(runInput);
      const workflow = canManageAgenticWorkflows ? await saveCurrentDraft() : draft.id ? await api.agenticWorkflows.get(draft.id) : null;
      if (!workflow || requestScope !== currentWorkspaceScope.current) return;
      const report = await api.agenticWorkflows.readiness(workflow.id, targetNodeId);
      if (requestScope !== currentWorkspaceScope.current) return;
      setReviewReadiness({ definition: reviewDefinitionKey(workflow.nodes, workflow.edges, workflow.status, workflow.trigger_kind, workflow.settings), workflow, report });
      if (!report.ready) return;
      const requestKey = JSON.stringify([workflow.id, workflow.name, workflow.description, workflow.settings, workflow.nodes.map(node => node.position), reviewDefinitionKey(workflow.nodes, workflow.edges, workflow.status, workflow.trigger_kind, workflow.settings), input, targetNodeId]);
      if (reviewRequest.current?.key !== requestKey) reviewRequest.current = { key: requestKey, id: crypto.randomUUID() };
      executeReviewMutation.mutate({ workflow, input, requestId: reviewRequest.current.id, targetNodeId });
    } catch (error) { if (requestScope === currentWorkspaceScope.current) setReviewStartError(error instanceof Error ? error.message : "Unable to prepare execution. Try again."); }
    finally { if (requestScope === currentWorkspaceScope.current) setCheckingReview(false); }
  };

  const onConnect = useCallback((connection: Connection) => {
    setEdges((currentEdges) => canConnectWorkflow(nodes, currentEdges, connection.source, connection.target, connection.sourceHandle) ? addEdge({
      ...connection,
      id: `${connection.source}-${connection.target}-${Date.now()}`,
      animated: true,
      markerEnd: { type: MarkerType.ArrowClosed },
      style: { strokeWidth: 1.8 }
    }, currentEdges) : currentEdges);
  }, [setEdges, nodes]);

  const emptyScope = !projectId || !appTypeId;
  const mutationSessionIsSelected = Boolean(assistantReply && (!selectedAssistantSessionId || assistantReply.transaction.id === selectedAssistantSessionId));
  const savedAssistant = assistantSavedSessionQuery.data;
  const activeAssistantResult = mutationSessionIsSelected ? assistantReply?.result : savedAssistant?.result;
  const activeAssistantEvents = mutationSessionIsSelected ? assistantReply?.events : savedAssistant?.events;
  const activeAssistantCitations = mutationSessionIsSelected ? assistantReply?.citations || [] : savedAssistant?.citations || [];
  const activeAssistantGuardrails = mutationSessionIsSelected ? assistantReply?.guardrails || [] : savedAssistant?.guardrails || [];
  const activeAssistantProvenance = mutationSessionIsSelected ? assistantReply?.provenance : savedAssistant?.provenance;
  const activeAssistantName = selectedAssistantAgent.name;
  const savedAssistantMessage = assistantSavedSessionQuery.error instanceof Error ? assistantSavedSessionQuery.error.message : savedAssistant?.message || "Only reviews belonging to this project, application and specialist can be opened here.";
  const specialistSessions = assistantSessions.filter(item => item.project_id === projectId && (!appTypeId || item.app_type_id === appTypeId) && item.metadata.agent_id === assistantAgentId);
  const openAssistantSession = (agentId: string, id: string) => {
    const agent = agentCatalog.find(item => item.id === agentId);
    if (!agent) return;
    assistantController.current?.abort(); assistantRequestId.current += 1;
    setAssistantStartedAt(null); setAssistantNotice(""); setAssistantTaskExpanded(false);
    selectAssistantAgent(agent);
    setAssistantReply(null); setSelectedAssistantSessionId(id); setAssistantResultTab("brief");
    setSearchParams(current => { const next = new URLSearchParams(current); next.set("view", "workbench"); next.set("agent", agent.id); next.set("session", id); next.delete("run"); return next; });
  };
  const openHubSurface = (view: "agents" | "activity" | "workflows" | "runs") => {
    setSearchParams(current => { const next = new URLSearchParams(current); next.set("view", view); next.delete("agent"); next.delete("run"); next.delete("session"); return next; });
  };
  const newSpecialistReview = () => {
    setAssistantReply(null); setSelectedAssistantSessionId(""); setAssistantNotice(""); setAssistantResultTab("brief");
    setSearchParams(current => { const next = new URLSearchParams(current); next.delete("session"); return next; }, { replace: true });
  };

  if (!canViewAgenticWorkflows || !isAgenticWorkflowsEnabled) return <div className="empty-state">Agentic Studio is not available with your current workspace access.</div>;

  return (
    <div className="page page-agentic-workflows">
      {!draft && !selectedRun && <PageHeader
        eyebrow={activeSurface === "repository" ? "Repository agents" : activeSurface === "agents" ? "AI specialists" : activeSurface === "workbench" ? "Agent Workbench" : "Agentic automation"}
        title={activeSurface === "activity" ? "Recent agent work" : activeSurface === "repository" ? selectedRepositoryAgent.name : activeSurface === "agents" ? "AI Agents" : activeSurface === "workbench" ? selectedAssistantAgent.name : activeTab === "runs" ? "Execution history" : "Agentic Studio"}
        description={activeSurface === "activity" ? "Resume source analyses and revisit your evidence-based reviews." : activeSurface === "agents"
          ? "Turn repository source and project evidence into useful quality work."
          : activeSurface === "repository"
            ? selectedRepositoryAgent.outcome
          : activeSurface === "workbench"
            ? specialistExperience.outcome
            : activeTab === "runs"
              ? "Inspect actual specialist executions and saved graph previews, with a clear record of what ran."
              : "Design reusable evidence reviews, execute registered specialists and inspect their saved outcomes."}
        meta={activeSurface === "agents"
          ? [
              { label: "Agents", value: agentCatalog.length + REPOSITORY_AGENTS.length },
              { label: "Review gate", value: "Required" },
              { label: "Scope", value: selectedAppType?.name || selectedProject?.name || "Not selected" }
            ]
          : activeSurface === "repository"
            ? [{ label: "Scope", value: selectedAppType?.name || selectedProject?.name || "Not selected" }]
          : activeSurface === "workbench"
            ? [
                { label: "Specialist", value: selectedAssistantAgent.shortName },
                { label: "Recent reviews", value: specialistSessions.length },
                { label: "Scope", value: selectedAppType?.name || selectedProject?.name || "Not selected" }
              ]
            : [
                { label: "Workflows", value: workflows.length },
                { label: "Recent executions", value: runs.length },
                { label: "Scope", value: selectedAppType?.name || selectedProject?.name || "Not selected" }
              ]}
      />}

      <div className="agentic-page-stage">
      {!draft && !selectedRun && <nav className="agent-hub-nav" aria-label="Agent workspace navigation">
        <button type="button" aria-current={activeSurface === "agents" ? "page" : undefined} onClick={() => openHubSurface("agents")}><IconLayoutGrid size={17} aria-hidden="true" />Agent library</button>
        <button type="button" aria-current={activeSurface === "activity" ? "page" : undefined} onClick={() => openHubSurface("activity")}><IconClock size={17} aria-hidden="true" />Recent work</button>
        <button type="button" aria-current={activeSurface === "workflows" ? "page" : undefined} onClick={() => openHubSurface("workflows")}><IconRoute size={17} aria-hidden="true" />Workflows</button>
        <button type="button" aria-current={activeSurface === "runs" ? "page" : undefined} onClick={() => openHubSurface("runs")}><IconHistory size={17} aria-hidden="true" />Workflow history</button>
      </nav>}
      {!draft && !selectedRun && activeSurface === "agents" ? <AgentDirectory key={`${session?.user.id}:${projectId}`} userId={session?.user.id || "anonymous"} onOpenRepository={openRepositoryAgent} onOpenSpecialist={openAgentWorkbench}
        projectAgents={projectAgents} canManage={Boolean(projectId) && canManageAgenticWorkflows} loading={projectAgentsQuery.isLoading} error={projectAgentsQuery.error instanceof Error ? projectAgentsQuery.error.message : undefined} onRetry={() => void projectAgentsQuery.refetch()}
        onCreate={() => { setAgentEditorError(""); setAgentEditor({}); }} onEdit={agent => { setAgentEditorError(""); setAgentEditor({ agent }); }} onCustomize={agent => { setAgentEditorError(""); setAgentEditor({ initial: agentFromSpecialist(agent.id, agent.name) }); }} /> : null}
      {!draft && !selectedRun && activeSurface === "activity" ? <AgentActivityCenter key={`${projectId}:${appTypeId}`} projectId={projectId} appTypeId={appTypeId} enabled={canViewAgenticWorkflows} onOpenRepository={openRepositoryAgent} onOpenSession={openAssistantSession} /> : null}
      {!draft && !selectedRun && activeSurface === "repository" ? (
        <RepositoryAgents
          key={`${projectId}:${appTypeId}:${repositoryAgentType}:${searchParams.get("run") || "new"}`}
          projectId={projectId}
          appTypeId={appTypeId}
          scopeLabel={[selectedProject?.name, selectedAppType?.name].filter(Boolean).join(" · ")}
          agentType={repositoryAgentType}
          runId={searchParams.get("run") || ""}
          enabled={isAgenticWorkflowsEnabled}
          onOpen={openRepositoryAgent}
          onBack={openAgentCatalog}
        />
      ) : null}
      {!draft && !selectedRun && activeSurface === "workbench" ? (
        <section className="agent-specialist-workspace" aria-label={`${selectedAssistantAgent.name} workspace`}>
          <div className="agent-specialist-heading"><div><button aria-label="Back to all AI Agents" className="ghost-button" type="button" onClick={openAgentCatalog}><IconArrowLeft size={16} /><span>Back</span></button><span className="agent-specialist-mode"><IconShieldCheck size={16} aria-hidden="true" />Workspace evidence review</span></div>{activeAssistantResult && <button type="button" className="ghost-button" disabled={assistantMutation.isPending} onClick={newSpecialistReview}>New review</button>}</div>
          <div className="agent-specialist-grid">
            <div className="agent-specialist-main">
              <section className="agent-specialist-brief" aria-labelledby="specialist-task-title"><header><h2 id="specialist-task-title">{activeAssistantResult ? "Task summary" : "Your task"}</h2><span>{selectedAppType?.name || selectedProject?.name || "Select a project"}</span>{activeAssistantResult && <button type="button" className="ghost-button compact" aria-expanded={assistantTaskExpanded} onClick={() => setAssistantTaskExpanded(value => !value)}>{assistantTaskExpanded ? "Hide task setup" : "Review another task"}</button>}</header>
                {activeAssistantResult && !assistantTaskExpanded && <p className="agent-task-receipt">{(mutationSessionIsSelected ? assistantReply?.transaction.description : savedAssistant?.transaction.description) || assistantPrompt}</p>}
                <div hidden={Boolean(activeAssistantResult) && !assistantTaskExpanded}>
                <AgenticCommandComposer
                  agents={agentCatalog} agentId={assistantAgentId} appTypeId={appTypeId} contextScopes={assistantContextScopes}
                  disabled={!projectId || !canRunAgenticWorkflows} integrationId={canViewIntegrations ? assistantIntegrationId : ""} integrations={llmIntegrations.filter(item => item.is_active)} mode={assistantMode}
                  onAgentChange={agentId => { const agent = agentCatalog.find(item => item.id === agentId); if (agent) openAgentWorkbench(agent); }}
                  onContextScopesChange={setAssistantContextScopes} onIntegrationChange={canViewIntegrations ? setAssistantIntegrationId : undefined} onModeChange={setAssistantMode} onPromptChange={setAssistantPrompt}
                  onSmartContextChange={canUseKnowledge ? selection => { setAssistantSmartContext(selection); setAssistantContextScopes(current => current.includes("knowledge") ? current : [...current, "knowledge"]); } : undefined}
                  onSubmit={startAssistantReview} prompt={assistantPrompt} projectId={projectId} running={assistantMutation.isPending}
                  scopeLabel={selectedAppType?.name || selectedProject?.name || "Select a project"} smartContext={assistantSmartContext}
                />
                </div>
              </section>
              {["release-readiness", "coverage-assurance", "impact-analysis", "risk-prediction", "flaky-test-intelligence", "release-risk-simulation", "quality-graph", "automation-repair"].includes(assistantAgentId) && <details className="agent-definition-editor agent-task-inputs"><summary>Evidence scope</summary><p>Set exact identifiers when narrowing the review. Missing scope remains unknown.</p>{[["release_id", "Release ID"], ["build", "Exact build"], ["environment_id", "Environment ID"], ["story_id", "Story ID"], ["test_case_id", "Test Case ID"], ["execution_id", "Failed Run ID (repair)"]].map(([key, name]) => <label key={key}><span>{name}</span><input disabled={assistantMutation.isPending} maxLength={255} value={String(agentInputs[key] ?? "")} onChange={event => setAgentInputs(current => ({ ...current, [key]: event.target.value }))} /></label>)}</details>}
              {selectedProjectAgent && (selectedProjectAgent.active_definition || selectedProjectAgent.definition).required_inputs.length > 0 && <section className="agent-definition-editor agent-task-inputs" aria-label="Agent task inputs"><h3>Task inputs</h3>{(selectedProjectAgent.active_definition || selectedProjectAgent.definition).required_inputs.map(key => <label key={key}><span>{key}</span><input disabled={assistantMutation.isPending} value={String(agentInputs[key] ?? "")} onChange={event => setAgentInputs(current => ({ ...current, [key]: event.target.value }))} /></label>)}</section>}
              {!canRunAgenticWorkflows && <p className="agent-specialist-error">{!projectId ? "Select a project to start a review." : "Starting reviews requires agent run permission and the Agents feature to be enabled. Saved reviews remain available within your access."}</p>}
              {assistantMutation.isPending && <div className="agent-specialist-progress" role="status"><LoadingState label="Review in progress" /><div><strong>Review in progress · {assistantElapsed}s</strong><p>{assistantElapsed >= 20 ? "The specialist is still working. If a source or model is unavailable, the result will explain any evidence gaps." : "Gathering the evidence available for this task and preparing its review."}</p></div><button type="button" className="ghost-button" onClick={() => assistantController.current?.abort()}>Stop review</button></div>}
              {assistantNotice && <div role="alert" className="agent-specialist-error">{assistantNotice}</div>}
              <div className="agent-specialist-result-tabs" role="group" aria-label="Specialist review views">{[{ id: "brief", label: "Review brief" }, { id: "activity", label: "Activity" }, { id: "history", label: "Saved reviews" }].map(tab => <button type="button" key={tab.id} aria-pressed={assistantResultTab === tab.id} onClick={() => setAssistantResultTab(tab.id as typeof assistantResultTab)}>{tab.label}{tab.id === "history" ? ` (${specialistSessions.length})` : ""}</button>)}</div>
              {assistantResultTab === "brief" ? activeAssistantResult ? <>
                <AgenticOutcomePanel key={selectedAssistantSessionId || assistantReply?.transaction.id || "current"} citations={activeAssistantCitations as Array<{ scope: string; id: string; label: string }>} guardrails={activeAssistantGuardrails as string[]} provenance={activeAssistantProvenance} result={activeAssistantResult} />
                <div className="agent-specialist-destination"><p>Use this brief to guide your next change. Review and save it in the appropriate workspace.</p>{can(specialistExperience.destinationPermission) && areFeatureFlagsEnabled(featureFlags, requiredFeatureFlagsForPath(specialistExperience.destination)) && <Link className="ghost-button" to={specialistExperience.destination}>{specialistExperience.destinationLabel}<IconArrowRight size={16} /></Link>}</div>
                {canManageAgenticWorkflows && <details className="agent-brief-diagnostics"><summary>Plan a reusable workflow</summary><p>Create a reusable specialist review with evidence evaluation and a human decision at the end.</p><button className="ghost-button" type="button" onClick={openAssistantWorkflowDraft}>Create workflow draft</button></details>}
              </> : <div className="agent-specialist-ready"><span className="agent-eyebrow">{selectedAssistantSessionId ? "Saved review" : "What you will get"}</span><h3>{selectedAssistantSessionId ? assistantSavedSessionQuery.isLoading ? <LoadingState label="Loading saved review" /> : savedAssistant?.session_state === "running" ? "This review is still in progress" : savedAssistant?.session_state === "failed" ? "This review could not finish" : "This saved review is unavailable" : specialistExperience.output}</h3><p>{selectedAssistantSessionId ? savedAssistantMessage : "A decision summary, cited findings, proposed next actions and explicit evidence gaps. The generated brief is saved in your review history."}</p></div>
              : assistantResultTab === "activity" ? activeAssistantEvents?.length ? <AgentActivityTimeline activeAgentName={activeAssistantName} events={activeAssistantEvents} running={false} /> : <div className="agent-specialist-ready"><h3>{assistantMutation.isPending ? "Activity will be available with the result" : "No recorded activity yet"}</h3><p>Completed reviews include the actual context, validation and model events recorded by the service.</p></div>
              : <div className="agent-specialist-history">{assistantSessionsQuery.isError && <div className="agent-specialist-error" role="alert">Saved reviews could not be loaded. <button className="ghost-button compact" type="button" disabled={assistantSessionsQuery.isFetching} onClick={() => void assistantSessionsQuery.refetch()}>Retry saved reviews</button></div>}{assistantSessionsQuery.isLoading && <LoadingState label="Loading saved reviews" />}{specialistSessions.map(item => <button type="button" key={item.id} aria-pressed={selectedAssistantSessionId === item.id} onClick={() => openAssistantSession(String(item.metadata.agent_id), item.id)}><IconHistory size={17} aria-hidden="true" /><span><strong>{item.title}</strong><small>{item.status === "completed" ? "Saved review" : item.status} · {item.event_count || 0} recorded events</small></span><time>{formatTimestamp(item.created_at)}</time><IconArrowRight size={16} /></button>)}{!assistantSessionsQuery.isLoading && !assistantSessionsQuery.isError && !specialistSessions.length && <div className="agent-specialist-ready"><h3>No saved reviews for this specialist</h3><p>Start a task above. Its result and source evidence will remain available here.</p></div>}</div>}
            </div>
            <aside className="agent-specialist-guide" aria-label="Specialist task guidance"><section><span className="agent-eyebrow">The outcome</span><h3>{specialistExperience.output}</h3><p>{specialistExperience.outcome}</p><span className="agent-eyebrow">Useful evidence</span><p>{specialistExperience.inputs}</p><p>Live records are limited to your permissions. Relevant indexed knowledge is included when available.</p></section><section><span className="agent-eyebrow">Try a task</span>{specialistExperience.starters.map((prompt, index) => <button type="button" key={prompt} disabled={assistantMutation.isPending} onClick={() => setAssistantPrompt(prompt)}><strong>{index === 0 ? "Start with a focused review" : "Explore a related question"}</strong><br />{prompt}</button>)}<p>These specialists prepare briefs. Source builders publish test drafts, objects and knowledge after your review.</p></section></aside>
          </div>
        </section>
      ) : null}
      {!draft && !selectedRun && activeSurface === "workflows" && canManageAgenticWorkflows && !emptyScope && <section className="studio-template-gallery" aria-label="Workflow templates">
        <header><div><span className="studio-caption">START FROM A TEMPLATE</span><h2>A useful workflow in a few steps</h2></div><button className="ghost-button" type="button" onClick={() => { openDraft(); setDraft(current => current ? { ...current, name: "Untitled workflow", description: "", nodes: [], edges: [] } : current); setNodes([]); setEdges([]); setSelectedNodeId(""); }}>Start from scratch</button></header>
        <div>{WORKFLOW_TEMPLATES.map(template => <button className="studio-template-card" key={template.id} type="button" onClick={() => { const value = draftFromTemplate(template); openDraft(); setDraft(value.draft); setNodes(value.draft.nodes); setEdges(value.draft.edges.map(decorateFlowEdge)); setSelectedNodeId(value.draft.nodes[0]?.id || ""); setRunInput(value.input || DEFAULT_RUN_INPUT); }}><span>{template.category}</span><strong>{template.name}</strong><p>{template.description}</p><small>Use template →</small></button>)}</div>
      </section>}
      {!draft && !selectedRun && (activeSurface === "workflows" || activeSurface === "runs") ? (
        <Panel
          className="agentic-workflows-panel"
          title={activeTab === "workflows" ? "Saved workflows" : "Workflow history"}
          titleVariant="eyebrow"
          subtitle={activeTab === "workflows" ? "Browse saved workflow definitions in the current project and app type." : "Inspect real executions, saved results and graph previews."}
        >
          <div className="design-list-toolbar catalog-command-toolbar agentic-workflows-toolbar">
            <div className="catalog-toolbar-discovery" aria-label="Workflow views, search, and selection">
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
              <CatalogSelectionControls
                showLabels
                clearLabel="Clear all"
                allSelected={areAllFilteredActionItemsSelected}
                canSelectAll={Boolean(visibleActionIds.length)}
                onClear={() => {
                  if (activeTab === "workflows") {
                    setSelectedActionWorkflowIds([]);
                  } else {
                    setSelectedActionRunIds([]);
                  }
                }}
                onSelectAll={() => {
                  if (activeTab === "workflows") {
                    setSelectedActionWorkflowIds((current) => Array.from(new Set([...current, ...visibleWorkflowIds])));
                  } else {
                    setSelectedActionRunIds((current) => Array.from(new Set([...current, ...visibleRunIds])));
                  }
                }}
                selectedCount={selectedActionIds.length}
              />
            </div>
            {activeTab === "workflows" ? (
              <div className="catalog-toolbar-actions" aria-label="Workflow actions">
                {canManageAgenticWorkflows ? (<button
                  className="primary-button catalog-selection-button"
                  disabled={emptyScope || !canManageAgenticWorkflows}
                  onClick={() => openDraft()}
                  type="button"
                >
                  <AddIcon />
                  <span>Create Agentic Workflow</span>
                </button>) : null}
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
                  enableRowSelection
                  selectedRowKeys={selectedActionWorkflowIds}
                  onSelectedRowKeysChange={setSelectedActionWorkflowIds}
                  getRowKey={(workflow) => workflow.id}
                  hideToolbarCopy
                  onRowClick={openDraft}
                  storageKey="agentic-workflows-list-columns"
                />
              ) : (
                <div className="tile-browser-grid agentic-workflow-grid">
                  {filteredWorkflows.map((workflow) => (
                    <button className="record-card tile-card agentic-workflow-card" key={workflow.id} onClick={() => openDraft(workflow)} type="button">
                      <div className="tile-card-main">
                        <div className="tile-card-select-row" onClick={(event) => event.stopPropagation()}>
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
                        <div className="tile-card-header">
                          <span className="agentic-type-badge" aria-hidden="true"><SparkIcon size={14} /></span>
                          <div className="tile-card-title-group">
                            <span className="tile-card-kicker">{workflow.trigger_kind}</span>
                            <strong>{workflow.name}</strong>
                          </div>
                          <StatusBadge value={workflow.status} />
                        </div>
                        <RichTextContent className="tile-card-description" title={richTextToPlainText(workflow.description)} value={workflow.description} fallback="No description" />
                        <div className="tile-card-facts">
                          <span><strong>{workflow.nodes.length}</strong><small>Steps</small></span>
                          <span><strong>{workflow.run_count || 0}</strong><small>Runs</small></span>
                          <span><strong>{workflow.latest_run_status || "none"}</strong><small>Latest</small></span>
                        </div>
                      </div>
                    </button>
                  ))}
                  {!filteredWorkflows.length ? <div className="empty-state compact">No agentic workflows created yet.</div> : null}
                </div>
              )
            ) : viewMode === "list" ? (
              <DataTable
                columns={runColumns}
                rows={filteredRuns}
                emptyMessage="No workflow previews yet. Save a definition, then preview its data flow."
                enableColumnResize
                enableHeaderColumnReorder
                enableRowSelection
                selectedRowKeys={selectedActionRunIds}
                onSelectedRowKeysChange={setSelectedActionRunIds}
                getRowKey={(run) => run.id}
                getRowClassName={(run) => (selectedRunId === run.id ? "is-active-row" : "")}
                hideToolbarCopy
                onRowClick={openRun}
                storageKey="agentic-workflow-runs-list-columns"
              />
            ) : (
              <div className="tile-browser-grid agentic-workflow-grid">
                {filteredRuns.map((run) => (
                  <button className={selectedRunId === run.id ? "record-card tile-card agentic-workflow-card is-active" : "record-card tile-card agentic-workflow-card"} key={run.id} onClick={() => openRun(run)} type="button">
                    <div className="tile-card-main">
                      <div className="tile-card-select-row" onClick={(event) => event.stopPropagation()}>
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
                      <div className="tile-card-header">
                        <span className="agentic-type-badge" aria-hidden="true"><PlayIcon size={14} /></span>
                        <div className="tile-card-title-group">
                          <span className="tile-card-kicker">{formatTimestamp(run.created_at)}</span>
                          <strong>{run.workflow_name}</strong>
                        </div>
                        <span className="agent-workflow-status">{run.execution_mode === "review" ? "Review" : "Preview"} · <StatusBadge value={run.status || "queued"} /></span>
                      </div>
                      <p className="tile-card-description" title={run.id}>{run.id}</p>
                      <div className="tile-card-facts">
                        <span><strong>{run.node_results.length}</strong><small>Steps</small></span>
                        <span><strong>{run.trigger_kind}</strong><small>Trigger</small></span>
                        <span><strong>{run.completed_at ? "Yes" : "No"}</strong><small>Snapshot</small></span>
                      </div>
                    </div>
                  </button>
                ))}
                {!filteredRuns.length ? <div className="empty-state compact">No workflow previews yet. Save a definition, then preview its data flow.</div> : null}
              </div>
            )}
          </div>
        </Panel>
      ) : null}

      {draft && <WorkflowStudio
        projectAgents={projectAgents.filter(agent => agent.active_version && !agent.archived)} onAddAgent={(agent, insertion) => addWorkflowNode("agent", insertion, agent)}
        draft={draft} nodes={nodes} edges={edges} selectedNodeId={selectedNodeId}
        editable={canManageAgenticWorkflows} canRun={canRunAgenticWorkflows}
        busy={saveMutation.isPending || checkingReview || executeReviewMutation.isPending || runMutation.isPending}
        error={reviewStartError} input={runInput} onInput={setRunInput}
        onDraft={patch => setDraft(current => current ? { ...current, ...patch } : null)}
        onBack={closeDraft} onSave={() => void saveCurrentDraft()} onPreview={() => void runCurrentDraft()}
        onExecute={target => void prepareAndExecute(target)} onCheck={() => void checkReviewReadiness()}
        readiness={reviewReadiness?.report} readinessCurrent={readinessMatchesDraft}
        onSelect={setSelectedNodeId} onAdd={addWorkflowNode} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange}
        onConnect={onConnect} onLayout={() => setNodes(current => layoutWorkflow(current, edges))}
        runs={asArray(workflowHistoryQuery.data).filter(run => run.workflow_id === draft.id)} onOpenRun={openRun}
        historyLoading={workflowHistoryQuery.isFetching} historyError={workflowHistoryQuery.error instanceof Error ? workflowHistoryQuery.error.message : undefined}
        onRetryHistory={() => void workflowHistoryQuery.refetch()}
        inspector={{ projectId, appTypeId, run: inspectedRun, result: inspectedRun?.node_results.find(result => result.node_id === selectedNodeId),
          stale: Boolean(inspectedRun && !runMatchesDraft(inspectedRun, draft, nodes, edges, runInput)),
          onOpenReview: (agent, session) => { closeDraft(); openAssistantSession(agent, session); },
          onOpenSource: (agent, run) => { if (isRepositoryAgentType(agent)) { closeDraft(); openRepositoryAgent(agent, run); } },
          canKnowledge: canUseKnowledge, providers: llmProviderOptions, projectAgents: projectAgents.filter(agent => agent.active_version && !agent.archived),
          onChange: updateSelectedNodeFields, onDelete: deleteSelectedNode, onTestApi: testSelectedApiAgent, testingApi: Boolean(testingApiNodeId) }}
      />}
      {selectedRunId && !selectedRun && <section className="studio-notice" role={selectedRunQuery.isError ? "alert" : "status"}>{selectedRunQuery.isError ? <><p>{selectedRunQuery.error instanceof Error ? selectedRunQuery.error.message : "Unable to load execution."}</p><button type="button" onClick={() => void selectedRunQuery.refetch()}>Retry execution details</button><button type="button" onClick={closeRun}>Back</button></> : "Loading execution…"}</section>}
      {selectedRun && <WorkflowExecutionView run={selectedRun} onBack={closeRun} canRun={canRunAgenticWorkflows} canViewTraces={can("ops.view")}
        stopping={cancelReviewMutation.isPending} onStop={() => cancelReviewMutation.mutate(selectedRun.id)}
        error={selectedRunQuery.error instanceof Error ? selectedRunQuery.error.message : undefined}
        onRefresh={() => void selectedRunQuery.refetch()}
        onRetry={selectedRun.workflow_id ? () => { const workflow = workflows.find(item => item.id === selectedRun.workflow_id); if (workflow) { setRunInput(prettyJson(selectedRun.input_payload)); openDraft(workflow, selectedRun); } else { setToastTone("error"); setToastMessage("The original workflow is no longer available in this workspace."); } } : undefined}
        onOpenReview={(agent, session) => { closeRun(); openAssistantSession(agent, session); }}
        onOpenSource={(agent, run) => { if (isRepositoryAgentType(agent)) { closeRun(); setSearchParams(current => { const next = new URLSearchParams(current); next.set("view", "repository"); next.set("agent", agent); next.set("run", run); return next; }); } }}
      />}
      </div>

      {agentEditor && <AgentDefinitionEditor key={`${projectId}:${agentEditor.agent?.id || "new"}`} agent={agentEditor.agent} initial={agentEditor.initial} projectId={projectId} appTypeId={appTypeId} providers={llmProviderOptions} busy={saveAgentMutation.isPending} error={agentEditorError}
        onClose={() => setAgentEditor(null)} onSave={(definition, activate) => saveAgentMutation.mutate({ project_id: projectId, definition, activate, id: agentEditor.agent?.id, expected_version: agentEditor.agent?.current_version })} />}
      <ToastMessage message={toastMessage} onDismiss={() => setToastMessage("")} tone={toastTone} />
    </div>
  );
}
