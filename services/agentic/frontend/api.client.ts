import { consumeAssistantProgress, type AgentProgress } from "./lib/assistantProgressStream";
import { streamQualityProgress, type QualityStreamOptions } from './lib/qualityProgressStream';
import type { AgentStructuredArtifact } from '@hellotest/platform/frontend/src/types';
import { AI_REQUEST_TIMEOUT_MS } from "@hellotest/platform/frontend/src/platform/lib/requestTimeout";
import type { RepositoryAgentCatalog, RepositoryAgentPublicationStatus, RepositoryAgentPublishResult, RepositoryAgentRun, RepositoryAgentRunInput, RepositoryAgentRunPage } from "./agents/agentTypes";
import type { AgenticAssistantMode, AgenticAssistantSessionResponse, AgenticAssistantSavedSessionResponse, AgenticWorkflow, AgenticWorkflowRun, AgenticWorkflowReadiness, RecorderSessionResponse, WorkspaceTransaction } from "@hellotest/platform/frontend/src/types";
import { resolveServiceBase } from "@hellotest/platform/frontend/src/platform/lib/serviceEndpoints";
import { API_BASE_URL, readRequestSession, request, requestBlob, requestForm, toQueryString } from "@hellotest/platform/frontend/src/lib/httpClient";

import type { AgentDefinition, ProjectAgent } from "./agents/agentDefinitions";
import type { QualityAgentBaseline, QualityAgentCatalog, QualityAgentKind, QualityAgentLaunch, QualityAgentPlan, QualityAgentPlanInput, QualityAgentRun } from "./lib/qualityAgentContracts";

type AgenticApiAgentTestInput = {
  project_id: string;
  method?: string;
  url: string;
  auth?: string;
  responseStyle?: string;
  body?: string;
  credential?: Record<string, unknown> | null;
};

export type AgentProposalReceipt = { id: string; kind: 'story' | 'test_case' | 'defect' | 'run' | 'automation'; updated: boolean; proposal_index: number; saved: boolean; reused?: boolean };
export type AgentEvidenceScopeOption = { id: string; label: string; description?: string };
export const agenticApi = {
  evidenceScope: {
    options: (query: { project_id: string; app_type_id?: string; field: string; search?: string; limit?: number; story_id?: string; test_case_id?: string; execution_id?: string; release_id?: string; sprint_id?: string }, options?: { signal?: AbortSignal }) => request<{ items: AgentEvidenceScopeOption[]; has_more: boolean }>(`/agentic-workflows/evidence-scope/options${toQueryString(query)}`, { signal: options?.signal, cache: 'no-store' }),
  },
  agentProposals: {
    list: (sessionId: string) => request<Array<{ proposal_index: number; receipt: AgentProposalReceipt }>>(`/agentic-assistant/sessions/${encodeURIComponent(sessionId)}/proposals`, { cache: 'no-store' }),
    accept: (sessionId: string, input: { index: number; artifact: AgentStructuredArtifact; app_type_id?: string }) => request<AgentProposalReceipt>(`/agentic-assistant/sessions/${encodeURIComponent(sessionId)}/proposals/accept`, { method: 'POST', body: JSON.stringify(input) })
  },
  mcp: {
    status: (projectId:string) => request<{status:string;tool_count:number;checked_at:string;external_transport?:{public_endpoint_configured:boolean;request_host_allowed:boolean;request_origin_allowed:boolean}}>(`/agentic-workflows/mcp/status${toQueryString({project_id:projectId})}`,{cache:"no-store"},10000),
    server: (projectId:string) => request<{id:string;name:string;endpoint:string;operation_count:number;protocol_versions?:string[];authentication?:string;client_contract?:{authentication:string;credential_ttl_seconds:number;project_id:string;accept:string;stateless:boolean;standalone_get_supported:boolean;oauth_supported:boolean};discovery?:{tools:number;resources:string[];resource_templates:string[];prompts:string[]};tools:Array<{name:string;description:string;read_only:boolean;input_schema?:Record<string,unknown>;output_schema?:Record<string,unknown>}>}>(`/agentic-workflows/mcp/server${toQueryString({project_id:projectId})}`),
    credentials: (projectId:string) => request<Array<{id:string;client_id:string;expires_at:string;revoked_at:string|null}>>(`/agentic-workflows/mcp/credentials${toQueryString({project_id:projectId})}`),
    issue: (projectId:string) => request<{id:string;token:string;expires_at:string}>("/agentic-workflows/mcp/credentials",{method:"POST",body:JSON.stringify({project_id:projectId,client_id:"external-host"})}),
    revoke: (projectId:string,id:string) => request(`/agentic-workflows/mcp/credentials/${encodeURIComponent(id)}${toQueryString({project_id:projectId})}`,{method:"DELETE"}),
    plans: (projectId:string) => request<Array<{id:string;client_id:string;operation_id:string;operation:{method:string;path:string;permission:string};arguments:Record<string,unknown>;digest:string;state:string;expires_at:string;receipt?:Record<string,unknown>}>>(`/agentic-workflows/mcp/plans${toQueryString({project_id:projectId})}`),
    authorize: (projectId:string,id:string,digest:string) => request(`/agentic-workflows/mcp/plans/${encodeURIComponent(id)}/authorize`,{method:"POST",body:JSON.stringify({project_id:projectId,digest})}),
  },
  qualityAgents: {
    stream: async (id: string, onProgress: (run: QualityAgentRun) => void, signal: AbortSignal, options?: QualityStreamOptions) => {
      const path = `/agentic-quality/runs/${encodeURIComponent(id)}/events`;
      return streamQualityProgress({ runId: id, onSnapshot: onProgress, options, signal,
        sessionRevision: () => readRequestSession().revision,
        connect: (cursor, streamSignal) => {
          const session = readRequestSession();
          const headers: Record<string, string> = { Accept: 'text/event-stream', ...(session.token ? { Authorization: `Bearer ${session.token}` } : {}), ...(cursor ? { 'Last-Event-ID': cursor } : {}) };
          return fetch(`${resolveServiceBase(path, API_BASE_URL)}${path}${cursor ? toQueryString({ after: cursor }) : ''}`, { headers, signal: streamSignal, cache: 'no-store' });
        },
      });
    },
    catalog: (scope: { project_id: string; app_type_id?: string }, options?: { signal?: AbortSignal }) => request<QualityAgentCatalog>(`/agentic-quality/catalog${toQueryString(scope)}`, { signal: options?.signal }),
    plan: (input: QualityAgentPlanInput, options?: { signal?: AbortSignal }) => request<QualityAgentPlan>("/agentic-quality/plan", { method: "POST", body: JSON.stringify(input), signal: options?.signal }, AI_REQUEST_TIMEOUT_MS),
    list: (scope: { project_id: string; app_type_id?: string; limit?: number }, options?: { signal?: AbortSignal }) => request<{ items: QualityAgentRun[] }>(`/agentic-quality/runs${toQueryString(scope)}`, { signal: options?.signal, cache: "no-store" }),
    get: (id: string, options?: { signal?: AbortSignal }) => request<QualityAgentRun>(`/agentic-quality/runs/${encodeURIComponent(id)}`, { signal: options?.signal, cache: "no-store" }),
    start: (input: QualityAgentLaunch, options?: { signal?: AbortSignal; idempotencyKey?: string }) => request<QualityAgentRun>("/agentic-quality/runs", { method: "POST", body: JSON.stringify(input), signal: options?.signal, headers: options?.idempotencyKey ? { "Idempotency-Key": options.idempotencyKey } : undefined }),
    cancel: (id: string, options?: { signal?: AbortSignal }) => request<QualityAgentRun>(`/agentic-quality/runs/${encodeURIComponent(id)}/cancel`, { method: "POST", signal: options?.signal }),
    artifact: (id: string, artifactId: string, options?: { signal?: AbortSignal }) => requestBlob(`/agentic-quality/runs/${encodeURIComponent(id)}/artifacts/${encodeURIComponent(artifactId)}`, { signal: options?.signal }),
    baselines: (scope: { project_id: string; app_type_id?: string }, options?: { signal?: AbortSignal }) => request<{ items: QualityAgentBaseline[] }>(`/agentic-quality/baselines${toQueryString(scope)}`, { signal: options?.signal, cache: "no-store" }),
    baselineImage: (id: string, options?: { signal?: AbortSignal }) => requestBlob(`/agentic-quality/baselines/${encodeURIComponent(id)}/artifact`, { signal: options?.signal }),
    approveBaseline: (id: string, input: { artifact_id: string; label?: string }, options?: { signal?: AbortSignal }) => request<QualityAgentBaseline>(`/agentic-quality/runs/${encodeURIComponent(id)}/baseline`, { method: "POST", body: JSON.stringify(input), signal: options?.signal }),
  },
  agentDefinitions: {
    list: (projectId: string, options?: { signal?: AbortSignal }) => request<ProjectAgent[]>(`/agentic-workflows/agents${toQueryString({ project_id: projectId })}`, { signal: options?.signal }),
    save: (input: { project_id: string; definition: AgentDefinition; activate: boolean; expected_version?: number }, id?: string) => request<ProjectAgent>(`/agentic-workflows/agents${id ? `/${encodeURIComponent(id)}` : ""}`, { method: id ? "PUT" : "POST", body: JSON.stringify(input) }),
    archive: (agent: ProjectAgent) => request<{ archived: boolean }>(`/agentic-workflows/agents/${encodeURIComponent(agent.id)}${toQueryString({ project_id: agent.project_id, version: agent.current_version })}`, { method: "DELETE" }),
  },
workflowConnections: {
    list: (projectId: string) => request<ManagedWorkflowConnection[]>(`/agentic-workflows/admin/connections${toQueryString({ project_id: projectId })}`),
    create: (input: WorkflowConnectionSettingsInput) => request<ManagedWorkflowConnection>("/agentic-workflows/admin/connections", { method: "POST", body: JSON.stringify(input) }),
    update: (id: string, input: WorkflowConnectionSettingsInput) => request<ManagedWorkflowConnection>(`/agentic-workflows/admin/connections/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify(input) }),
    delete: (id: string, projectId: string) => request<{ deleted: boolean }>(`/agentic-workflows/admin/connections/${encodeURIComponent(id)}${toQueryString({ project_id: projectId })}`, { method: "DELETE" }),
    discover: (id: string, projectId: string) => request<McpToolDefinition[]>(`/agentic-workflows/admin/connections/${encodeURIComponent(id)}/discover${toQueryString({ project_id: projectId })}`, { method: "POST" }),
    discoverDraft: (input: WorkflowConnectionSettingsInput, connectionId?: string) => request<McpDiscoveryResult>("/agentic-workflows/admin/connections/discover", { method: "POST", body: JSON.stringify({ ...input, connection_id: connectionId }) }, 75000),
  },
repositoryInspection: {
    localAgentSetup: async (input: { project_id: string; origin: string; agent_token: string }, options?: { signal?: AbortSignal }) => {
      const setup = await request<{ download_url: string; expires_at: string }>("/repository-inspection/local-agent/setup", { method: "POST", body: JSON.stringify(input), signal: options?.signal });
      const serviceBase = resolveServiceBase("/repository-inspection", API_BASE_URL);
      return { ...setup, download_url: new URL(`${serviceBase}/${setup.download_url.replace(/^\//, "")}`, window.location.origin).href };
    },
    capabilities: (projectId: string, options?: { signal?: AbortSignal }) =>
      request<{ remote: { available: boolean; reason: string | null }; local: { base_url: string; setup_command: string } }>(`/repository-inspection/capabilities${toQueryString({ project_id: projectId })}`, { signal: options?.signal, cache: "no-store" }),
    start: async (input: { project_id: string; app_type_id?: string; start_url?: string }) => {
      const session = await request<RecorderSessionResponse>("/repository-inspection/sessions", { method: "POST", body: JSON.stringify(input) }, 90_000);
      const resolve = (path: string | null | undefined) => path ? new URL(`${resolveServiceBase(path, API_BASE_URL)}/${path.replace(/^\//, "")}`, window.location.origin).href : undefined;
      return { ...session, recorder_mode: "remote" as const, status_url: resolve(session.status_url), live_view_url: resolve(session.live_view_url) };
    }
  },
repositoryAgents: {
    catalog: (options?: { signal?: AbortSignal }) =>
      request<RepositoryAgentCatalog>("/repository-agents", { signal: options?.signal }),
    list: (query: { project_id: string; app_type_id?: string; page?: number; agent_type?: RepositoryAgentRunInput["agent_type"]; status?: RepositoryAgentRun["status"] }, options?: { signal?: AbortSignal }) =>
      request<RepositoryAgentRunPage>(`/repository-agents/runs${toQueryString(query)}`, { signal: options?.signal, cache: "no-store" }),
    get: (id: string, options?: { signal?: AbortSignal }) =>
      request<RepositoryAgentRun>(`/repository-agents/runs/${encodeURIComponent(id)}`, { signal: options?.signal, cache: "no-store" }),
    create: (input: RepositoryAgentRunInput, options?: { signal?: AbortSignal; idempotencyKey?: string }) =>
      request<RepositoryAgentRun>("/repository-agents/runs", { method: "POST", body: JSON.stringify(input), signal: options?.signal, headers: options?.idempotencyKey ? { "Idempotency-Key": options.idempotencyKey } : undefined }, 120_000),
    upload: (input: import("./lib/qualityAgentContracts").QualityAgentContext & { goal?: string; project_id: string; app_type_id?: string; agent_type: RepositoryAgentRunInput["agent_type"]; file: File }, options?: { signal?: AbortSignal; idempotencyKey?: string }) => {
      const formData = new FormData();
      formData.set("project_id", input.project_id);
      if (input.app_type_id) formData.set("app_type_id", input.app_type_id);
      formData.set("agent_type", input.agent_type);
      formData.set("context", JSON.stringify({ ai_configuration:input.ai_configuration, instructions:input.instructions, guardrails:input.guardrails, review_criteria:input.review_criteria, llm_integration_id: input.llm_integration_id, goal: input.goal, context_scopes: input.context_scopes, evidence_scope: input.evidence_scope, smart_context: input.smart_context }));
      formData.set("file", input.file);
      return requestForm<RepositoryAgentRun>("/repository-agents/runs", formData, options);
    },
    cancel: (id: string, options?: { signal?: AbortSignal }) =>
      request<RepositoryAgentRun>(`/repository-agents/runs/${encodeURIComponent(id)}/cancel`, { method: "POST", signal: options?.signal }),
    retry: (id: string, options?: { signal?: AbortSignal }) =>
      request<RepositoryAgentRun>(`/repository-agents/runs/${encodeURIComponent(id)}/retry`, { method: "POST", signal: options?.signal }),
    publish: (id: string, input: { item_ids: string[]; module_id?: string; automation_start_url?:string }, options?: { signal?: AbortSignal }) =>
      request<RepositoryAgentPublishResult>(`/repository-agents/runs/${encodeURIComponent(id)}/publish`, { method: "POST", body: JSON.stringify(input), signal: options?.signal }, 120_000),
    publicationStatus: (id:string, options?:{signal?:AbortSignal}) =>
      request<RepositoryAgentPublicationStatus>(`/repository-agents/runs/${encodeURIComponent(id)}/publication-status`,{signal:options?.signal,cache:'no-store'}),
    processKnowledge: (id:string,input:{item_ids:string[]},options?:{signal?:AbortSignal}) =>
      request<RepositoryAgentPublicationStatus>(`/repository-agents/runs/${encodeURIComponent(id)}/process-knowledge`,{method:'POST',body:JSON.stringify(input),signal:options?.signal}),
    artifact: (id: string, name: string) =>
      requestBlob(`/repository-agents/runs/${encodeURIComponent(id)}/artifacts/${encodeURIComponent(name)}`)
  },
agenticWorkflows: {
    listSessions: (query: { project_id: string; app_type_id?: string; limit?: number }, options?: { signal?: AbortSignal }) =>
      request<WorkspaceTransaction[]>(`/agentic-assistant/sessions${toQueryString(query)}`, { signal: options?.signal }),
    getSession: (id: string, options?: { signal?: AbortSignal }) =>
      request<AgenticAssistantSavedSessionResponse>(`/agentic-assistant/sessions/${encodeURIComponent(id)}`, { signal: options?.signal }),
    ask: (input: {
      project_id: string;
      app_type_id?: string;
      mode: AgenticAssistantMode;
      agent_id: string;
      agent_version?: number;
      inputs?: Record<string, unknown>;
      prompt: string;
      context_scopes: string[];
      smart_context?: {
        query: string;
        source_ids?: string[];
        source_kinds?: string[];
        reviewed_context?: string;
      };
      integration_id?: string;
      history?: Array<{ role: "user" | "assistant"; content: string }>;
    }, options?: { signal?: AbortSignal; onProgress?: (event: AgentProgress) => void }) => {
      if (!options?.onProgress) return request<AgenticAssistantSessionResponse>("/agentic-assistant/sessions", {
        method: "POST", body: JSON.stringify(input), signal: options?.signal
      }, AI_REQUEST_TIMEOUT_MS);
      return (async () => {
        const controller=new AbortController();
        const abort=()=>controller.abort();
        options.signal?.addEventListener("abort",abort,{once:true});
        if(options.signal?.aborted)controller.abort();
        const timer=setTimeout(abort,AI_REQUEST_TIMEOUT_MS);
        try {
          const path="/agentic-assistant/sessions";
          const token=readRequestSession().token;
          const response=await fetch(`${resolveServiceBase(path,API_BASE_URL)}${path}`,{
            method:"POST",headers:{"Content-Type":"application/json",Accept:"text/event-stream",...(token?{Authorization:`Bearer ${token}`}:{})},
            body:JSON.stringify(input),signal:controller.signal
          });
          if(!response.ok) {const failure=await response.json().catch(()=>({}));throw new Error(failure.message || failure.error || `Review request failed (${response.status}).`);}
          if(!response.headers.get("content-type")?.includes("text/event-stream"))return response.json() as Promise<AgenticAssistantSessionResponse>;
          return await consumeAssistantProgress<AgenticAssistantSessionResponse>(response,options.onProgress,controller.signal);
        } finally {clearTimeout(timer);options.signal?.removeEventListener("abort",abort);}
      })();
    },
    list: (query?: { project_id?: string; app_type_id?: string; status?: string }, options?: { signal?: AbortSignal; fresh?: boolean }) =>
      request<AgenticWorkflow[]>(`/agentic-workflows${toQueryString(query)}`, { signal: options?.signal, cache: options?.fresh ? "no-store" : undefined }),
    get: (id: string) =>
      request<AgenticWorkflow>(`/agentic-workflows/${id}`),
    create: (input: {
      project_id: string;
      app_type_id?: string;
      name: string;
      description?: string;
      status?: AgenticWorkflow["status"];
      trigger_kind?: AgenticWorkflow["trigger_kind"];
      nodes?: AgenticWorkflow["nodes"];
      edges?: AgenticWorkflow["edges"];
      settings?: Record<string, unknown>;
      n8n_payload?: Record<string, unknown>;
    }) =>
      request<AgenticWorkflow>("/agentic-workflows", {
        method: "POST",
        body: JSON.stringify(input)
      }),
    update: (id: string, input: Partial<{
      project_id: string;
      app_type_id: string;
      name: string;
      description: string | null;
      status: AgenticWorkflow["status"];
      trigger_kind: AgenticWorkflow["trigger_kind"];
      nodes: AgenticWorkflow["nodes"];
      edges: AgenticWorkflow["edges"];
      settings: Record<string, unknown>;
      n8n_payload: Record<string, unknown>;
    }>) =>
      request<AgenticWorkflow>(`/agentic-workflows/${id}`, {
        method: "PUT",
        body: JSON.stringify(input)
      }),
    delete: (id: string) =>
      request<{ deleted: boolean }>(`/agentic-workflows/${id}`, { method: "DELETE" }),
    connections: (projectId: string) => request<WorkflowConnection[]>(`/agentic-workflows/connections${toQueryString({ project_id: projectId })}`),
    mcpTools: (projectId: string, connectionId: string, signal?: AbortSignal) => request<McpToolDefinition[]>("/agentic-workflows/connections/mcp-tools", { method: "POST", body: JSON.stringify({ project_id: projectId, connection_id: connectionId }), signal }),
    testHttpNode: (projectId: string, data: Record<string, unknown>) => request<Record<string, unknown>>("/agentic-workflows/connections/http-test", { method: "POST", body: JSON.stringify({ project_id: projectId, data }) }),
    testApiAgent: (input: AgenticApiAgentTestInput) =>
      request<Record<string, unknown>>("/agentic-workflows/api-agent-test", {
        method: "POST",
        body: JSON.stringify(input)
      }),
    run: (id: string, input?: { trigger_kind?: AgenticWorkflow["trigger_kind"]; input_payload?: Record<string, unknown> }) =>
      request<AgenticWorkflowRun>(`/agentic-workflows/${id}/runs`, {
        method: "POST",
        body: JSON.stringify(input || {})
      }),
    readiness: (id: string, targetNodeId?: string, inputPayload?: Record<string, unknown>) =>
      inputPayload === undefined
        ? request<AgenticWorkflowReadiness>(`/agentic-workflows/${encodeURIComponent(id)}/readiness${toQueryString({ target_node_id: targetNodeId })}`, { cache: "no-store" })
        : request<AgenticWorkflowReadiness>(`/agentic-workflows/${encodeURIComponent(id)}/readiness`, { method: "POST", body: JSON.stringify({ target_node_id: targetNodeId, input_payload: inputPayload }), cache: "no-store" }),
    execute: (id: string, input: { request_id: string; input_payload: Record<string, unknown>; target_node_id?: string }) =>
      request<AgenticWorkflowRun>(`/agentic-workflows/${encodeURIComponent(id)}/executions`, { method: "POST", body: JSON.stringify(input) }),
    acceptWorkflowDraft: (id: string, input: { node_id: string; story_index: number; case_index: number; kind: "manual" | "automation" }) =>
      request<{ id: string; title: string; kind: string; saved: boolean; reused?: boolean }>(`/agentic-workflow-runs/${encodeURIComponent(id)}/drafts/accept`, { method: "POST", body: JSON.stringify(input) }),
    cancelRun: (id: string) =>
      request<AgenticWorkflowRun>(`/agentic-workflow-runs/${encodeURIComponent(id)}/cancel`, { method: "POST", body: "{}" }),
    listRuns: (query?: { project_id?: string; app_type_id?: string; workflow_id?: string; status?: string; limit?: number; summary_only?: boolean }, options?: { signal?: AbortSignal }) =>
      request<AgenticWorkflowRun[]>(`/agentic-workflow-runs${toQueryString(query)}`, { signal: options?.signal }),
    getRun: (id: string, options?: { signal?: AbortSignal }) =>
      request<AgenticWorkflowRun>(`/agentic-workflow-runs/${encodeURIComponent(id)}`, { signal: options?.signal, cache: "no-store" }),
    nodeModelCalls: (runId: string, nodeId: string, cursor?: string, signal?: AbortSignal) =>
      request<import('@hellotest/trace/client').LlmTracePage>(`/agentic-workflow-runs/${encodeURIComponent(runId)}/nodes/${encodeURIComponent(nodeId)}/model-calls${toQueryString({ cursor })}`, { signal, cache: 'no-store' }),
    nodeModelCall: (runId: string, nodeId: string, callId: string, signal?: AbortSignal) =>
      request<import('@hellotest/trace/client').LlmTrace>(`/agentic-workflow-runs/${encodeURIComponent(runId)}/nodes/${encodeURIComponent(nodeId)}/model-calls/${encodeURIComponent(callId)}`, { signal, cache: 'no-store' })
  }
};

export type WorkflowConnection = { id: string; name: string; kind: "http" | "mcp"; url: string; authenticated: boolean; authType?: "none" | "bearer" | "basic" | "header"; username?: string; builtin?: boolean; authenticationMode?: "current-user" | "managed-credential"; methods: string[]; tools: string[]; toolDefinitions?: McpToolDefinition[]; timeoutMs?: number; transport?: string; serverInfo?: { name: string; version: string }; discovered_at?: string };
export type WorkflowConnectionSettingsInput = {
  name: string; kind: "mcp" | "http"; url: string; project_id: string; tools: string[]; methods: string[];
  authType: "none" | "bearer" | "basic" | "header"; header: string; secretEnv: string; secret?: string;
  allowPrivateNetwork: boolean; enabled: boolean;
  transport?: "streamable-http"; timeoutMs?: number; headers?: Record<string, string>; username?: string;
  toolDefinitions?: McpToolDefinition[]; serverInfo?: { name: string; version: string }; protocolVersion?: string; discovered_at?: string;
};
export type ManagedWorkflowConnection = WorkflowConnectionSettingsInput & { id: string; authenticated: boolean; updated_at: string };
export type McpToolDefinition = { name: string; description: string; inputSchema: Record<string, unknown>; outputSchema?: Record<string, unknown>; annotations?: Record<string, unknown> };
export type McpDiscoveryResult = { tools: McpToolDefinition[]; serverInfo?: { name: string; version: string }; protocolVersion: string; discovered_at: string };
