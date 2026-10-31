import { AgentAutomationBuildAction } from "@hellotest/automation/frontend/components/AgentAutomationBuildAction";
import { AgentEvidenceScope } from "../components/AgentEvidenceScope";
import { createPortal } from "react-dom";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { agentFromSpecialist, agentResultLabel, projectAgentNode, type AgentDefinition, type ProjectAgent } from "../agents/agentDefinitions";
import { specialistDefaults } from "../workflows/specialistProfiles";
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
import { useDialogFocus } from "@hellotest/platform/frontend/src/shared/hooks/useDialogFocus";
import { PageHeader } from "@hellotest/platform/frontend/src/shared/components/PageHeader";
import { Panel } from "@hellotest/platform/frontend/src/shared/components/Panel";
import { LoadingState } from "@hellotest/platform/frontend/src/shared/components/LoadingState";
import { RichTextContent, richTextToPlainText } from "@hellotest/platform/frontend/src/platform/components/RichTextEditor";
import { StatusBadge } from "@hellotest/platform/frontend/src/shared/components/StatusBadge";
import { type SmartContextSelection } from "@hellotest/ai/frontend/components/SmartContextWorkbench";
import { ToastMessage } from "@hellotest/platform/frontend/src/shared/components/ToastMessage";
import { useDeleteConfirmation } from "@hellotest/platform/frontend/src/shared/components/DeleteConfirmationDialog";
import { useCapabilityAccess } from "@hellotest/platform/frontend/src/platform/hooks/useCapabilityAccess";
import { useCurrentAppType, useCurrentProject } from "@hellotest/platform/frontend/src/platform/hooks/useCurrentProject";
import { useWorkspaceResource } from "@hellotest/platform/frontend/src/platform/hooks/useWorkspaceData";
import { api } from "@hellotest/platform/frontend/src/lib/api";
import { asArray } from "@hellotest/platform/frontend/src/shared/lib/collectionGuards";

import { areFeatureFlagsEnabled, requiredFeatureFlagsForPath } from "@hellotest/platform/frontend/src/platform/lib/featureFlags";
import { isRovoIntegrationId } from "@hellotest/integration/frontend/lib/rovo";
import { readDefaultCatalogViewMode } from "@hellotest/platform/frontend/src/shared/lib/viewPreferences";
import type { AgenticWorkflow, AgenticAssistantSessionResponse, AgenticWorkflowEdge, AgenticWorkflowNode, AgenticWorkflowNodeData, AgenticWorkflowRun, AgenticWorkflowReadiness, Integration, WorkspaceTransaction } from "@hellotest/platform/frontend/src/types";
import "./AgenticWorkflowsPage.css";
import { SprintAutomatorSetup } from "../workflows/SprintAutomatorSetup";
import { isSprintAutomator, sprintInputDefaults, restoredSprintInput, migrateSprintConfiguration } from "../workflows/sprintAutomatorInput";
import { WorkflowStudio } from "../workflows/WorkflowStudio";
import { WorkflowExecutionView } from "../workflows/WorkflowExecutionView";
import { WORKFLOW_TEMPLATES, draftFromTemplate } from "../workflows/workflowTemplates";
import { isQualityAgentKind } from "../lib/qualityAgentExperience";
import { QualityAgentLab } from "../quality/QualityAgentLab";
import { AgentOutcomePreview } from '../components/AgentOutcomePreview';
import type { AgentOutcomePreview as OutcomePreview } from '../lib/assistantProgressStream';

type WorkflowViewMode = "tile" | "list";
type WorkflowTab = "workflows" | "runs";
type AgenticPageSurface = "quality" | "agents" | "workbench" | "repository" | WorkflowTab;
import { WorkflowNodeKind, WorkflowDraft, AgenticCredential, AgenticApiResponseStyle, DEFAULT_RUN_INPUT, runMatchesDraft, layoutWorkflow, compactCount, safeJsonParse, prettyJson, buildNodeDefaults, createNodeId, createFlowEdge, insertWorkflowNode, defaultSourceHandle, isLoopReturnEdge, canConnectWorkflow, type NodeInsertion, decorateFlowEdge, reviewDefinitionKey, normalizeWorkflowNodeDirectLlm, createWorkflowDraft, buildN8nPayload } from "../workflows/workflowGraph";

export function AgenticWorkflowsPage() {
  const { formatDate } = useLocalization();
  const formatTimestamp = useCallback((value?: string | null, fallback = "Not recorded") => !value || Number.isNaN(new Date(value).getTime()) ? fallback : formatDate(value, { dateStyle: "medium", timeStyle: "short" }), [formatDate]);
  const queryClient = useQueryClient();
  const { confirmDelete, confirmationDialog } = useDeleteConfirmation();
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
  const requestedSurface = searchParams.get("view") || searchParams.get("surface");
  const browserKind = searchParams.get("agent")?.replace(/^browser-/, "");
  const browserAgent = searchParams.get("agent")?.startsWith("browser-") && isQualityAgentKind(browserKind);
  const activeSurface: AgenticPageSurface = browserAgent ? "quality" : requestedSurface === "workbench"
    || requestedSurface === "repository"
    || requestedSurface === "agents"
    || requestedSurface === "workflows"
    || requestedSurface === "runs"

    ? requestedSurface
    : "agents";
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
  const [runPresentation, setRunPresentation] = useState<"history" | "live">("history");
  const [testingApiNodeId, setTestingApiNodeId] = useState("");
  const [runInput, setRunInput] = useState(DEFAULT_RUN_INPUT);
  const [reviewReadiness, setReviewReadiness] = useState<{ definition: string; input: string; workflow: AgenticWorkflow; report: AgenticWorkflowReadiness } | null>(null);
  const [checkingReview, setCheckingReview] = useState(false);
  const [reviewStartError, setReviewStartError] = useState("");
  const reviewRequest = useRef<{ key: string; id: string } | null>(null);
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
  const assistantLiveSession = useRef("");
  const [assistantProgress, setAssistantProgress] = useState<Array<{phase:string;message:string;sessionId?:string}>>([]);
  const [assistantPreview, setAssistantPreview] = useState<OutcomePreview | null>(null);
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
    if (previousWorkspaceScope.current !== workspaceScopeKey) setSearchParams(current => { const next = new URLSearchParams(current); next.delete("workflow_run"); next.delete("quality_run"); return next; }, { replace: true });
    previousWorkspaceScope.current = workspaceScopeKey;
  }, [workspaceScopeKey, setNodes, setEdges, setSearchParams]);

  useEffect(() => {
    setSelectedRunId(searchParams.get("workflow_run") || "");
  }, [activeSurface, searchParams]);

  useEffect(() => {
    setAssistantReply(null);
    setAssistantPreview(null);
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
    canViewIntegrations, activeSurface === "workbench" || activeSurface === "workflows" || activeSurface === "quality" || activeSurface === "repository" || Boolean(agentEditor)
  );

  const projects = asArray(projectsQuery.data);
  const allAppTypes = asArray(appTypesQuery.data);
  const llmIntegrations = asArray(llmIntegrationsQuery.data).filter((integration) => !isRovoIntegrationId(integration.id) && (!integration.config?.project_id || integration.config.project_id === projectId));
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
    retry: false,
    refetchInterval: query => ((query.state.data || []) as AgenticWorkflowRun[]).some(run => ["queued", "running"].includes(run.status)) ? 2000 : false
  });

  const selectedRunQuery = useQuery({
    queryKey: ["agentic-workflow-run", projectId, appTypeId, selectedRunId],
    queryFn: async ({ signal }) => {
      const run = await api.agenticWorkflows.getRun(selectedRunId, { signal });
      if (run?.id && (run.project_id !== projectId || (appTypeId && run.app_type_id !== appTypeId))) throw new Error("This workflow execution does not belong to the selected project and application.");
      return run;
    },
    enabled: Boolean(projectId && selectedRunId) && canViewAgenticWorkflows,
    refetchInterval: query => ["queued", "running"].includes(query.state.data?.status || "") ? 2000 : false
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
  useEffect(() => {
    if (!workflowsQuery.isSuccess) return;
    const available = new Set(asArray(workflowsQuery.data).map(workflow => workflow.id));
    setSelectedActionWorkflowIds(current => current.every(id => available.has(id)) ? current : current.filter(id => available.has(id)));
  }, [workflowsQuery.data, workflowsQuery.isSuccess]);
  useEffect(() => {
    if (!selectedRun || ["queued", "running"].includes(selectedRun.status)) return;
    void queryClient.invalidateQueries({ queryKey: ["agentic-workflow-runs", selectedRun.project_id, selectedRun.app_type_id || ""] });
  }, [queryClient, selectedRun?.id, selectedRun?.status]);
  const selectedAssistantAgent = agentCatalog.find((agent) => agent.id === assistantAgentId) || HELLOTEST_AGENT_CATALOG[0];
  const selectedProjectAgent = projectAgents.find(item => item.id === assistantAgentId);
  const specialistExperience = AGENT_EXPERIENCES[selectedAssistantAgent.id] || { category: "planning", outcome: selectedAssistantAgent.description || selectedAssistantAgent.prompt, inputs: "Configured project evidence and supplied inputs", output: agentResultLabel(selectedProjectAgent?.active_definition || selectedProjectAgent?.definition), destination: "/agentic-workflows?view=agents", destinationLabel: "Agent library", destinationPermission: "agentic_workflow.view", starters: [selectedAssistantAgent.prompt] };
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
    mutationFn: (submission: AssistantSubmission) => api.agenticWorkflows.ask(submission.input, { signal: submission.signal, onProgress: event => {
      if (submission.signal.aborted || submission.scope !== activeAssistantScope.current || submission.requestId !== assistantRequestId.current) return;
      const message=typeof event.message === "string" ? event.message.slice(0,2000) : "";
      if(event.session_id) assistantLiveSession.current=event.session_id;
      if(event.outcome_preview) setAssistantPreview(event.outcome_preview);
      if(!message)return;
      setAssistantProgress(items=>[...items,{phase:event.phase || event.stage || "working",message,sessionId:event.session_id}].slice(-12));
    } }),
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
      if(assistantLiveSession.current) {setSelectedAssistantSessionId(assistantLiveSession.current);void queryClient.invalidateQueries({queryKey:["workspace-transactions","ai-agent",projectId,appTypeId]});}
      setAssistantNotice(submission.signal.aborted ? "Review stopped. Your task is retained and can be started again." : error instanceof Error ? error.message : "The review could not finish. Your task is retained; try again.");
    }
  });
  const startAssistantReview = () => {
    if (!projectId || !canRunAgenticWorkflows || assistantMutation.isPending || !assistantPrompt.trim()) return;
    assistantController.current?.abort();
    const controller = new AbortController(); assistantController.current = controller;
    const requestId = ++assistantRequestId.current;
    assistantLiveSession.current=""; setAssistantNotice(""); setAssistantProgress([]); setAssistantReply(null); setSelectedAssistantSessionId(""); setAssistantResultTab("brief"); setAssistantStartedAt(Date.now());
    setAssistantPreview(null);
    setSearchParams(current => { const next = new URLSearchParams(current); next.delete("session"); return next; }, { replace: true });
    assistantMutation.mutate({ scope: assistantScopeKey, requestId, signal: controller.signal, input: {
      project_id: projectId, app_type_id: appTypeId || undefined, mode: "agent",
      agent_id: assistantAgentId, agent_version: selectedAssistantAgent.agentVersion, inputs: assistantAgentId === "automation-engineer" ? { ...agentInputs, allow_browser_actions: agentInputs.allow_browser_actions !== false } : agentInputs, prompt: assistantPrompt, context_scopes: assistantContextScopes,
      smart_context: canUseKnowledge && assistantSmartContext ? { query: assistantSmartContext.query, source_ids: assistantSmartContext.sourceIds, source_kinds: assistantSmartContext.sourceKinds, reviewed_context: assistantSmartContext.contextText } : undefined,
      integration_id: canViewIntegrations ? assistantIntegrationId || undefined : undefined
    } });
  };

  const saveMutation = useMutation({
    mutationFn: async (nextDraft: WorkflowDraft & { initialInput?: string }) => {
      if (!projectId) {
        throw new Error("Select a project first.");
      }

      const migrated = migrateSprintConfiguration(nextDraft.nodes, safeJsonParse(nextDraft.initialInput ?? runInput));
      const directLlmNodes = migrated.nodes.map(normalizeWorkflowNodeDirectLlm);
      const settings = isSprintAutomator(directLlmNodes)
        ? { ...nextDraft.settings, template_id: "sprint-automator", sprint_input_defaults: sprintInputDefaults(safeJsonParse(nextDraft.initialInput ?? runInput)) }
        : nextDraft.settings;
      const payload = {
        project_id: projectId,
        app_type_id: appTypeId || undefined,
        name: nextDraft.name,
        description: nextDraft.description,
        status: nextDraft.status,
        trigger_kind: nextDraft.trigger_kind,
        nodes: directLlmNodes,
        edges: nextDraft.edges,
        settings,
        n8n_payload: buildN8nPayload({ ...nextDraft, settings }, directLlmNodes, nextDraft.edges)
      };

      return nextDraft.id
        ? api.agenticWorkflows.update(nextDraft.id, payload)
        : api.agenticWorkflows.create(payload);
    },
    onSuccess: (workflow, submitted) => {
      invalidateWorkflowData();
      if (`${workflow.project_id}:${workflow.app_type_id || ""}` !== currentWorkspaceScope.current) return;
      if (submitted.initialInput !== undefined) {
        openDraft(workflow);
        setRunInput(prettyJson(migrateSprintConfiguration(workflow.nodes, safeJsonParse(submitted.initialInput)).input));
      } else {
        setDraft(createWorkflowDraft(workflow));
        setNodes(workflow.nodes.map(normalizeWorkflowNodeDirectLlm));
        setEdges(workflow.edges.map(decorateFlowEdge));
      }
      setToastTone("success");
      setToastMessage(submitted.id ? "Workflow changes saved." : "Workflow created. You can now configure and modify it.");
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
    mutationFn: async ({ workflows: selected, scope }: { workflows: Array<{ id: string; name: string }>; scope: string }) => {
      const deleted: string[] = [], failed: Array<{ id: string; name: string; message: string }> = [];
      for (const workflow of selected) {
        try { await api.agenticWorkflows.delete(workflow.id); deleted.push(workflow.id); }
        catch (error) { failed.push({ ...workflow, message: error instanceof Error ? error.message : "Unable to delete workflow." }); }
      }
      return { deleted, failed, scope };
    },
    onSuccess: ({ deleted, failed, scope }) => {
      invalidateWorkflowData();
      if (scope !== currentWorkspaceScope.current) return;
      setSelectedActionWorkflowIds(current => current.filter(id => !deleted.includes(id)));
      setToastTone(failed.length ? "error" : "success");
      setToastMessage(`${deleted.length} workflow${deleted.length === 1 ? "" : "s"} deleted.${failed.length ? ` ${failed.length} could not be deleted and remain selected. ${failed[0].name}: ${failed[0].message}` : " Saved executions remain available."}`);
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
      openRun(run, "live");
      setToastMessage("");
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
      render: (run) => <span className="agent-workflow-status">{run.execution_mode === "review" ? "Execution" : "Preview"} · <StatusBadge value={run.status || "queued"} /></span>
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
    const initialInput = inspection ? inspection.input_payload : isSprintAutomator(nextDraft.nodes) ? safeJsonParse(restoredSprintInput(nextDraft.settings)) : safeJsonParse(DEFAULT_RUN_INPUT);
    const migrated = migrateSprintConfiguration(nextDraft.nodes, initialInput);
    setDraft({ ...nextDraft, nodes: migrated.nodes });
    setRunInput(prettyJson(migrated.input));
    setNodes(migrated.nodes.map((node) => ({ ...node, type: node.type || "agenticStep" })));
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

  const openRun = (run: AgenticWorkflowRun, presentation: "history" | "live" = "history") => {
    setRunPresentation(presentation);
    if (!run.summary_only) queryClient.setQueryData(["agentic-workflow-run", run.project_id, run.app_type_id || "", run.id], run);
    setSelectedRunId(run.id);
    setSearchParams(current => { const next = new URLSearchParams(current); next.set("view", draft ? "workflows" : "runs"); next.set("workflow_run", run.id); next.delete("agent"); next.delete("run"); next.delete("session"); return next; });
  };

  const closeRun = () => {
    if (runPresentation === "live" && selectedRun?.workflow_id === draft?.id) setInspectedRun(selectedRun);
    setSelectedRunId("");
    setRunPresentation("history");
    setSearchParams(current => { const next = new URLSearchParams(current); next.delete("workflow_run"); next.delete("quality_run"); next.set("view", draft ? "workflows" : "runs"); return next; }, { replace: true });
  };

  const closeDraft = () => {
    setDraft(null);
    setSelectedNodeId("");
    setNodes([]);
    setEdges([]);
  };

  const deleteSelectedWorkflows = async () => {
    if (!canManageAgenticWorkflows || deleteMutation.isPending) return;
    const scope = currentWorkspaceScope.current;
    const selected = workflows.filter(workflow => selectedActionWorkflowIds.includes(workflow.id)).map(({ id, name }) => ({ id, name }));
    if (!selected.length) return;
    const names = selected.slice(0, 5).map(workflow => `“${workflow.name}”`).join(", ");
    const confirmed = await confirmDelete({
      title: `Delete ${selected.length === 1 ? "workflow" : `${selected.length} workflows`}?`,
      confirmLabel: "Delete workflows",
      message: `Delete ${names}${selected.length > 5 ? ` and ${selected.length - 5} more` : ""}? Saved executions are retained. Any running execution continues with its saved definition.`
    });
    if (confirmed && scope === currentWorkspaceScope.current) deleteMutation.mutate({ workflows: selected, scope });
  };

  const createFromTemplate = (template: (typeof WORKFLOW_TEMPLATES)[number]) => {
    if (!projectId || !appTypeId || !canManageAgenticWorkflows || saveMutation.isPending) return;
    const value = draftFromTemplate(template);
    saveMutation.mutate({ ...value.draft, initialInput: value.input || DEFAULT_RUN_INPUT });
  };

  const addWorkflowNode = (kind: WorkflowNodeKind, insertion?: NodeInsertion, agent?: ProjectAgent) => {
    try {
      let target = insertion;
      if (!target && selectedNode) {
        target = ["output", "stop"].includes(String(selectedNode.data.kind))
          ? { edgeId: edges.find(edge => edge.target === selectedNode.id)?.id }
          : { sourceId: selectedNode.id, sourceHandle: defaultSourceHandle(selectedNode) };
      }
      if (!target && nodes.length) {
        const leaf = nodes.find(node => !["output", "stop"].includes(String(node.data.kind)) && !edges.some(edge => edge.source === node.id));
        target = leaf ? { sourceId: leaf.id, sourceHandle: defaultSourceHandle(leaf) } : { edgeId: edges.find(edge => nodes.find(node => node.id === edge.target)?.data.kind === "output")?.id };
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
      return !["loop", "stop"].includes(String(selectedNode.data.kind)) && incoming.length === 1 && outgoing.length === 1 && !isLoopReturnEdge(incoming[0], nodes) && !isLoopReturnEdge(outgoing[0], nodes) && !retained.some(edge => edge.source === incoming[0].source && edge.target === outgoing[0].target)
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

    try { return await saveMutation.mutateAsync({ ...draft, nodes, edges }); }
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
      const input = safeJsonParse(runInput);
      const workflow = canManageAgenticWorkflows ? await saveCurrentDraft() : draft.id ? await api.agenticWorkflows.get(draft.id) : null;
      if (!workflow) return;
      const report = await api.agenticWorkflows.readiness(workflow.id, undefined, input);
      if (requestScope !== currentWorkspaceScope.current) return;
      setReviewReadiness({ definition: reviewDefinitionKey(workflow.nodes, workflow.edges, workflow.status, workflow.trigger_kind, workflow.settings), input: JSON.stringify(input), workflow, report });
    } catch (error) {
      if (requestScope === currentWorkspaceScope.current) setReviewStartError(error instanceof Error ? error.message : "Could not check this workflow. Try again.");
    } finally { setCheckingReview(false); }
  };

  const readinessMatchesDraft = Boolean(draft && reviewReadiness && reviewReadiness.workflow.id === draft.id
    && reviewReadiness.input === (() => { try { return JSON.stringify(safeJsonParse(runInput)); } catch { return "invalid"; } })()
    && reviewReadiness.definition === reviewDefinitionKey(nodes, edges, draft.status, draft.trigger_kind, draft.settings));

  const prepareAndExecute = async (targetNodeId?: string) => {
    if (!draft || !canRunAgenticWorkflows || checkingReview || executeReviewMutation.isPending) return;
    const requestScope = workspaceScopeKey;
    setCheckingReview(true); setReviewStartError("");
    try {
      const input = safeJsonParse(runInput);
      const workflow = canManageAgenticWorkflows ? await saveCurrentDraft() : draft.id ? await api.agenticWorkflows.get(draft.id) : null;
      if (!workflow || requestScope !== currentWorkspaceScope.current) return;
      const report = await api.agenticWorkflows.readiness(workflow.id, targetNodeId, input);
      if (requestScope !== currentWorkspaceScope.current) return;
      setReviewReadiness({ definition: reviewDefinitionKey(workflow.nodes, workflow.edges, workflow.status, workflow.trigger_kind, workflow.settings), input: JSON.stringify(input), workflow, report });
      if (!report.ready) return;
      const requestKey = JSON.stringify([workflow.id, workflow.name, workflow.description, workflow.settings, workflow.nodes.map(node => node.position), reviewDefinitionKey(workflow.nodes, workflow.edges, workflow.status, workflow.trigger_kind, workflow.settings), input, targetNodeId]);
      if (reviewRequest.current?.key !== requestKey) reviewRequest.current = { key: requestKey, id: crypto.randomUUID() };
      executeReviewMutation.mutate({ workflow, input, requestId: reviewRequest.current.id, targetNodeId });
    } catch (error) { if (requestScope === currentWorkspaceScope.current) setReviewStartError(error instanceof Error ? error.message : "Unable to prepare execution. Try again."); }
    finally { if (requestScope === currentWorkspaceScope.current) setCheckingReview(false); }
  };

  const onConnect = useCallback((connection: Connection) => {
    setEdges((currentEdges) => canConnectWorkflow(nodes, currentEdges, connection.source, connection.target, connection.sourceHandle, connection.targetHandle) ? addEdge({
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
  const openHubSurface = (view: "quality" | "agents" | "workflows" | "runs") => {
    setSearchParams(current => { const next = new URLSearchParams(current); next.set("view", view); next.delete("surface"); next.delete("agent"); next.delete("run"); next.delete("session"); return next; });
  };
  const workflowHistoryRef = useDialogFocus<HTMLDivElement>({ active: activeSurface === "runs" && !selectedRun && !draft, onClose: () => openHubSurface("workflows") });
  const workflowRunRef = useDialogFocus<HTMLDivElement>({ active: Boolean(selectedRun) && runPresentation === "history", onClose: closeRun });
  const newSpecialistReview = () => {
    setAssistantReply(null); setSelectedAssistantSessionId(""); setAssistantNotice(""); setAssistantResultTab("brief");
    setSearchParams(current => { const next = new URLSearchParams(current); next.delete("session"); return next; }, { replace: true });
  };

  const renderCatalog = (content: ReactNode) => activeSurface === "runs" ? createPortal(content, document.body) : content;
  if (!canViewAgenticWorkflows || !isAgenticWorkflowsEnabled) return <div className="empty-state">AI Agent Studio is not available with your current workspace access.</div>;

  return (
    <div className="page page-agentic-workflows">
      {!draft && !selectedRun && activeSurface !== "quality" && <PageHeader
        eyebrow={activeSurface === "repository" ? "Repository agents" : activeSurface === "agents" ? "AI specialists" : activeSurface === "workbench" ? "Agent Workbench" : "Agentic automation"}
        title={activeSurface === "repository" ? selectedRepositoryAgent.name : activeSurface === "agents" ? "AI Agents" : activeSurface === "workbench" ? selectedAssistantAgent.name : "Workflows"}
        description={activeSurface === "agents"
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
              { label: "Agents", value: agentCatalog.length + REPOSITORY_AGENTS.length + 5 },
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
      {!draft && !selectedRun && activeSurface === "quality" ? <QualityAgentLab key={`${session?.user.id}:${projectId}:${appTypeId}`} projectId={projectId} appTypeId={appTypeId} scopeLabel={[selectedProject?.name, selectedAppType?.name].filter(Boolean).join(" · ")} userId={session?.user.id || ""} canRun={canRunAgenticWorkflows} canManage={canManageAgenticWorkflows} canCreateDefect={can("feedback.create")} integrations={canViewIntegrations ? llmIntegrations : []} /> : null}
      {!draft && !selectedRun && activeSurface === "agents" ? <AgentDirectory key={`${session?.user.id}:${projectId}`} userId={session?.user.id || "anonymous"} onOpenRepository={openRepositoryAgent} onOpenSpecialist={openAgentWorkbench} onOpenQuality={kind => setSearchParams({ view: "workbench", agent: `browser-${kind}`, quality_agent: kind })}
        projectAgents={projectAgents} canManage={Boolean(projectId) && canManageAgenticWorkflows} loading={projectAgentsQuery.isLoading} error={projectAgentsQuery.error instanceof Error ? projectAgentsQuery.error.message : undefined} onRetry={() => void projectAgentsQuery.refetch()}
        onCreate={() => { setAgentEditorError(""); setAgentEditor({}); }} onEdit={agent => { setAgentEditorError(""); setAgentEditor({ agent }); }} onCustomize={agent => { setAgentEditorError(""); setAgentEditor({ initial: agentFromSpecialist(agent.id, agent.name) }); }} /> : null}
      {!draft && !selectedRun && activeSurface === "repository" ? (
        <RepositoryAgents
          key={`${projectId}:${appTypeId}:${repositoryAgentType}:${searchParams.get("run") || "new"}`}
          projectId={projectId}
          appTypeId={appTypeId}
          scopeLabel={[selectedProject?.name, selectedAppType?.name].filter(Boolean).join(" · ")}
          integrations={canViewIntegrations ? llmIntegrations : []}
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
                  disabled={!projectId || !canRunAgenticWorkflows} integrationId={canViewIntegrations ? assistantIntegrationId : ""} integrations={llmIntegrations.filter(item => item.is_active)}
                  onAgentChange={agentId => { const agent = agentCatalog.find(item => item.id === agentId); if (agent) openAgentWorkbench(agent); }}
                  optionsContent={["automation-engineer","automation-repair"].includes(assistantAgentId) ? <div className="agent-automation-browser-options"><label><span>Start URL (uses this case’s saved URL when blank)</span><input type="url" value={String(agentInputs.start_url || "")} disabled={assistantMutation.isPending} onChange={event=>setAgentInputs(current=>({...current,start_url:event.target.value}))}/></label><label><input type="checkbox" checked={assistantAgentId === "automation-engineer" ? agentInputs.allow_browser_actions !== false : agentInputs.allow_browser_actions === true} disabled={assistantMutation.isPending} onChange={event=>setAgentInputs(current=>({...current,allow_browser_actions:event.target.checked}))}/>Perform steps in the browser (can click, type and submit forms)</label><p>{assistantAgentId === "automation-engineer" && agentInputs.allow_browser_actions !== false ? "Playwright MCP performs the scoped steps during development. Generated instructions and a passing Test Engine run are separate outcomes." : "Read-only when disabled: the agent inspects the page without performing its actions. Test execution is verified separately."}</p></div> : undefined}
                  evidenceScope={agentInputs} evidenceScopeControl={<AgentEvidenceScope projectId={projectId} appTypeId={appTypeId} scopes={assistantContextScopes} values={agentInputs} disabled={assistantMutation.isPending} onChange={(key, value) => { setAgentInputs(current => ({ ...current, [key]: value })); setAssistantSmartContext(null); }} />}
                  onContextScopesChange={values => { setAssistantContextScopes(values); setAssistantSmartContext(null); }} onIntegrationChange={canViewIntegrations ? setAssistantIntegrationId : undefined} onPromptChange={setAssistantPrompt}
                  onSmartContextChange={canUseKnowledge ? selection => { setAssistantSmartContext(selection); setAssistantContextScopes(current => current.includes("knowledge") ? current : [...current, "knowledge"]); } : undefined}
                  onSubmit={startAssistantReview} prompt={assistantPrompt} projectId={projectId} running={assistantMutation.isPending}
                  scopeLabel={selectedAppType?.name || selectedProject?.name || "Select a project"} smartContext={assistantSmartContext}
                />
                </div>
                {assistantAgentId === "automation-engineer" ? <AgentAutomationBuildAction projectId={projectId} appTypeId={appTypeId} caseId={String(agentInputs.test_case_id || "")} prompt={assistantPrompt} integrationId={assistantIntegrationId}
                  context={{context_scopes:assistantContextScopes,inputs:Object.fromEntries(Object.entries(agentInputs).filter((entry):entry is [string,string]=>typeof entry[1]==="string")),smart_context:assistantSmartContext?{query:assistantSmartContext.query,source_ids:assistantSmartContext.sourceIds,source_kinds:assistantSmartContext.sourceKinds,reviewed_context:assistantSmartContext.contextText}:undefined}}
                  allowBrowserActions={agentInputs.allow_browser_actions !== false} startUrl={String(agentInputs.start_url || "")} environmentId={String(agentInputs.environment_id || "")}/>:null}
              </section>

              {selectedProjectAgent && (selectedProjectAgent.active_definition || selectedProjectAgent.definition).required_inputs.length > 0 && <section className="agent-definition-editor agent-task-inputs" aria-label="Agent task inputs"><h3>Task inputs</h3>{(selectedProjectAgent.active_definition || selectedProjectAgent.definition).required_inputs.map(key => <label key={key}><span>{key}</span><input disabled={assistantMutation.isPending} value={String(agentInputs[key] ?? "")} onChange={event => setAgentInputs(current => ({ ...current, [key]: event.target.value }))} /></label>)}</section>}
              {!canRunAgenticWorkflows && <p className="agent-specialist-error">{!projectId ? "Select a project to start a review." : "Starting reviews requires agent run permission and the Agents feature to be enabled. Saved reviews remain available within your access."}</p>}
              {assistantMutation.isPending && <div className="agent-specialist-progress" role="status"><LoadingState label="Review in progress" /><div><strong>Review in progress · {assistantElapsed}s</strong><p>{assistantProgress.at(-1)?.message || "Gathering the evidence available for this task and preparing its review."}</p>{assistantProgress.length > 1 ? <details><summary>Live activity · {assistantProgress.length} recent updates</summary><ol>{assistantProgress.map((event,index)=><li key={`${event.phase}-${index}`}>{event.message}</li>)}</ol></details> : null}</div><button type="button" className="ghost-button" onClick={() => assistantController.current?.abort()}>Stop review</button></div>}
              {assistantMutation.isPending && assistantPreview && <AgentOutcomePreview value={assistantPreview} />}
              {assistantNotice && <div role="alert" className="agent-specialist-error">{assistantNotice}</div>}
              <div className="agent-specialist-result-tabs" role="group" aria-label="Specialist review views">{[{ id: "brief", label: "Review brief" }, { id: "activity", label: "Activity" }, { id: "history", label: "Saved reviews" }].map(tab => <button type="button" key={tab.id} aria-pressed={assistantResultTab === tab.id} onClick={() => setAssistantResultTab(tab.id as typeof assistantResultTab)}>{tab.label}{tab.id === "history" ? ` (${specialistSessions.length})` : ""}</button>)}</div>
              {assistantResultTab === "brief" ? activeAssistantResult ? <>
                <AgenticOutcomePanel key={selectedAssistantSessionId || assistantReply?.transaction.id || "current"} citations={activeAssistantCitations as Array<{ scope: string; id: string; label: string }>} guardrails={activeAssistantGuardrails as string[]} provenance={activeAssistantProvenance} result={activeAssistantResult} sessionId={selectedAssistantSessionId || assistantReply?.transaction.id} />


              </> : <div className="agent-specialist-ready"><span className="agent-eyebrow">{selectedAssistantSessionId ? "Saved review" : "What you will get"}</span><h3>{selectedAssistantSessionId ? assistantSavedSessionQuery.isLoading ? <LoadingState label="Loading saved review" /> : savedAssistant?.session_state === "running" ? "This review is still in progress" : savedAssistant?.session_state === "failed" ? "This review could not finish" : "This saved review is unavailable" : specialistExperience.output}</h3><p>{selectedAssistantSessionId ? savedAssistantMessage : "A decision summary, cited findings, proposed next actions and explicit evidence gaps. The generated brief is saved in your review history."}</p></div>
              : assistantResultTab === "activity" ? activeAssistantEvents?.length ? <AgentActivityTimeline projectId={projectId} activeAgentName={activeAssistantName} events={activeAssistantEvents} running={false} /> : <div className="agent-specialist-ready"><h3>{assistantMutation.isPending ? "Activity will be available with the result" : "No recorded activity yet"}</h3><p>Completed reviews include the actual context, validation and model events recorded by the service.</p></div>
              : <div className="agent-specialist-history">{assistantSessionsQuery.isError && <div className="agent-specialist-error" role="alert">Saved reviews could not be loaded. <button className="ghost-button compact" type="button" disabled={assistantSessionsQuery.isFetching} onClick={() => void assistantSessionsQuery.refetch()}>Retry saved reviews</button></div>}{assistantSessionsQuery.isLoading && <LoadingState label="Loading saved reviews" />}{specialistSessions.map(item => <button type="button" key={item.id} aria-pressed={selectedAssistantSessionId === item.id} onClick={() => openAssistantSession(String(item.metadata.agent_id), item.id)}><IconHistory size={17} aria-hidden="true" /><span><strong>{item.title}</strong><small>{item.status === "completed" ? "Saved review" : item.status} · {item.event_count || 0} recorded events</small></span><time>{formatTimestamp(item.created_at)}</time><IconArrowRight size={16} /></button>)}{!assistantSessionsQuery.isLoading && !assistantSessionsQuery.isError && !specialistSessions.length && <div className="agent-specialist-ready"><h3>No saved reviews for this specialist</h3><p>Start a task above. Its result and source evidence will remain available here.</p></div>}</div>}
            </div>
            <aside className="agent-specialist-guide" aria-label="Specialist task guidance"><section><span className="agent-eyebrow">The outcome</span><h3>{specialistExperience.output}</h3><p>{specialistExperience.outcome}</p><span className="agent-eyebrow">Useful evidence</span><p>{specialistExperience.inputs}</p><p>Live records are limited to your permissions. Relevant indexed knowledge is included when available.</p></section><section><span className="agent-eyebrow">Try a task</span>{specialistExperience.starters.map((prompt, index) => <button type="button" key={prompt} disabled={assistantMutation.isPending} onClick={() => setAssistantPrompt(prompt)}><strong>{index === 0 ? "Start with a focused review" : "Explore a related question"}</strong><br />{prompt}</button>)}<p>Specialists return evidence-based reviews and structured proposals. Review the drafts before saving changes.</p></section></aside>
          </div>
        </section>
      ) : null}
      {!draft && !selectedRun && activeSurface === "workflows" && canManageAgenticWorkflows && !emptyScope && <section className="studio-template-gallery" aria-label="Workflow templates">
        <header><div><span className="studio-caption">START FROM A TEMPLATE</span><h2>A useful workflow in a few steps</h2></div><button className="ghost-button" type="button" onClick={() => { openDraft(); setDraft(current => current ? { ...current, name: "Untitled workflow", description: "", nodes: [], edges: [] } : current); setNodes([]); setEdges([]); setSelectedNodeId(""); }}>Start from scratch</button></header>
        <div>{WORKFLOW_TEMPLATES.map(template => <button className="studio-template-card" key={template.id} type="button" disabled={emptyScope || saveMutation.isPending} onClick={() => createFromTemplate(template)}><span>{template.category}</span><strong>{template.name}</strong><p>{template.description}</p><small>{saveMutation.isPending ? "Creating…" : "Create Workflow →"}</small></button>)}</div>
      </section>}
      {!draft && !selectedRun && (activeSurface === "workflows" || activeSurface === "runs") ? renderCatalog(
        <div className={activeSurface === "runs" ? "modal-backdrop workflow-history-backdrop" : "workflow-catalog-container"}><div className={activeSurface === "runs" ? "modal-card workflow-history-dialog page-agentic-workflows" : "workflow-catalog-container"} role={activeSurface === "runs" ? "dialog" : undefined} aria-modal={activeSurface === "runs" ? true : undefined} aria-label={activeSurface === "runs" ? "Workflow executions" : undefined} ref={activeSurface === "runs" ? workflowHistoryRef : undefined} tabIndex={activeSurface === "runs" ? -1 : undefined}>
        {activeSurface === "runs" ? <button className="ghost-button workflow-history-close" aria-label="Close workflow executions" onClick={() => openHubSurface("workflows")} type="button">Close</button> : null}
        <Panel
          className="agentic-workflows-panel"
          title={activeTab === "workflows" ? "Saved workflows" : "Workflow history"}
          titleVariant="eyebrow"
          subtitle={activeTab === "workflows" ? "Browse saved workflow definitions in the current project and app type." : "Inspect real executions, saved results and graph previews."}
        >
      {selectedRunId && !selectedRun && <section className="studio-notice" role={selectedRunQuery.isError ? "alert" : "status"}>{selectedRunQuery.isError ? <><p>{selectedRunQuery.error instanceof Error ? selectedRunQuery.error.message : "Unable to load execution."}</p><button type="button" onClick={() => void selectedRunQuery.refetch()}>Retry execution details</button><button type="button" onClick={closeRun}>Back</button></> : "Loading execution…"}</section>}
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
                {canManageAgenticWorkflows && selectedActionWorkflowIds.length > 0 && <button
                  className="ghost-button danger-button"
                  disabled={deleteMutation.isPending}
                  onClick={() => void deleteSelectedWorkflows()}
                  type="button"
                >{deleteMutation.isPending ? "Deleting…" : `Delete selected (${selectedActionWorkflowIds.length})`}</button>}
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
                emptyMessage="No workflow executions yet. Create a workflow, then run it to inspect its results."
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
                        <span className="agent-workflow-status">{run.execution_mode === "review" ? "Execution" : "Preview"} · <StatusBadge value={run.status || "queued"} /></span>
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
                {!filteredRuns.length ? <div className="empty-state compact">No workflow executions yet. Create a workflow, then run it to inspect its results.</div> : null}
              </div>
            )}
          </div>
        </Panel></div></div>
      ) : null}

      {draft && !(selectedRun && runPresentation === "live") && <WorkflowStudio
        key={`${workspaceScopeKey}:${draft.id || "new"}`}
        projectAgents={projectAgents.filter(agent => agent.active_version && !agent.archived)} onAddAgent={(agent, insertion) => addWorkflowNode("agent", insertion, agent)}
        draft={draft} nodes={nodes} edges={edges} selectedNodeId={selectedNodeId}
        editable={canManageAgenticWorkflows} canRun={canRunAgenticWorkflows}
        busy={saveMutation.isPending || checkingReview || executeReviewMutation.isPending || runMutation.isPending}
        error={reviewStartError} input={runInput} onInput={setRunInput}
        inputSetup={isSprintAutomator(nodes) ? <SprintAutomatorSetup projectId={projectId} input={runInput} onInput={setRunInput}
          editable={canManageAgenticWorkflows} canRun={canRunAgenticWorkflows} busy={saveMutation.isPending || checkingReview || executeReviewMutation.isPending}
          canViewSprints={can("requirement_iteration.view")} /> : undefined}
        onDraft={patch => setDraft(current => current ? { ...current, ...patch } : null)}
        onBack={closeDraft} onSave={() => void checkReviewReadiness()} onPreview={() => void runCurrentDraft()}
        onExecute={target => void prepareAndExecute(target)} onCheck={() => void checkReviewReadiness()}
        readiness={reviewReadiness?.report} readinessCurrent={readinessMatchesDraft}
        onSelect={setSelectedNodeId} onAdd={addWorkflowNode} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange}
        onConnect={onConnect} onLayout={() => setNodes(current => layoutWorkflow(current, edges))}
        onRestoreGraph={snapshot => { setNodes(snapshot.nodes); setEdges(snapshot.edges); setSelectedNodeId(current => snapshot.nodes.some(node => node.id === current) ? current : ""); }}
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

      {draft && selectedRunId && !selectedRun && createPortal(<div className="modal-backdrop"><div className="modal-card workflow-history-dialog" role="dialog" aria-modal="true" aria-label="Workflow execution details"><p role={selectedRunQuery.isError ? "alert" : "status"}>{selectedRunQuery.isError ? "Execution details could not be loaded." : "Loading execution…"}</p>{selectedRunQuery.isError ? <button className="ghost-button" type="button" onClick={() => void selectedRunQuery.refetch()}>Retry</button> : null}<button className="ghost-button" type="button" onClick={closeRun}>Back to workflow</button></div></div>, document.body)}

      {selectedRun && runPresentation === "live" && <WorkflowExecutionView key={selectedRun.id} run={selectedRun} presentation="live" onBack={closeRun} canRun={canRunAgenticWorkflows} canViewTraces={can("ops.view")}
        stopping={cancelReviewMutation.isPending} onStop={() => cancelReviewMutation.mutate(selectedRun.id)}
        error={selectedRunQuery.error instanceof Error ? selectedRunQuery.error.message : undefined}
        onRefresh={() => void selectedRunQuery.refetch()}
        onOpenReview={(agent, session) => { closeRun(); closeDraft(); openAssistantSession(agent, session); }}
        onOpenSource={(agent, run) => { if (isRepositoryAgentType(agent)) { closeRun(); closeDraft(); openRepositoryAgent(agent, run); } }}
      />}

      {selectedRun && runPresentation === "history" && createPortal(<div className="modal-backdrop"><div className="modal-card workflow-history-dialog workflow-execution-dialog page-agentic-workflows" role="dialog" aria-modal="true" aria-label="Workflow execution details" ref={workflowRunRef} tabIndex={-1}><WorkflowExecutionView key={selectedRun.id} run={selectedRun} onBack={closeRun} canRun={canRunAgenticWorkflows} canViewTraces={can("ops.view")}
        stopping={cancelReviewMutation.isPending} onStop={() => cancelReviewMutation.mutate(selectedRun.id)}
        error={selectedRunQuery.error instanceof Error ? selectedRunQuery.error.message : undefined}
        onRefresh={() => void selectedRunQuery.refetch()}
        onRetry={selectedRun.workflow_id ? () => { const workflow = workflows.find(item => item.id === selectedRun.workflow_id); if (workflow) { setRunInput(prettyJson(selectedRun.input_payload)); openDraft(workflow, selectedRun); } else { setToastTone("error"); setToastMessage("The original workflow is no longer available in this workspace."); } } : undefined}
        onOpenReview={(agent, session) => { closeRun(); openAssistantSession(agent, session); }}
        onOpenSource={(agent, run) => { if (isRepositoryAgentType(agent)) { closeRun(); setSearchParams(current => { const next = new URLSearchParams(current); next.set("view", "repository"); next.set("agent", agent); next.set("run", run); return next; }); } }}
      /></div></div>, document.body)}
      </div>

      {agentEditor && <AgentDefinitionEditor key={`${projectId}:${agentEditor.agent?.id || "new"}`} agent={agentEditor.agent} initial={agentEditor.initial} projectId={projectId} appTypeId={appTypeId} providers={llmProviderOptions} busy={saveAgentMutation.isPending} error={agentEditorError}
        onClose={() => setAgentEditor(null)} onSave={(definition, activate) => saveAgentMutation.mutate({ project_id: projectId, definition, activate, id: agentEditor.agent?.id, expected_version: agentEditor.agent?.current_version })} />}
      <ToastMessage message={toastMessage} onDismiss={() => setToastMessage("")} tone={toastTone} />
      {confirmationDialog}
    </div>
  );
}
