import { AI_REQUEST_TIMEOUT_MS } from "@hellotest/platform/frontend/src/platform/lib/requestTimeout";
import type { RepositoryAgentCatalog, RepositoryAgentPublishResult, RepositoryAgentRun, RepositoryAgentRunInput, RepositoryAgentRunPage } from "./agents/agentTypes";
import type { AgenticAssistantMode, AgenticAssistantSessionResponse, AgenticAssistantSavedSessionResponse, AgenticWorkflow, AgenticWorkflowRun, AgenticWorkflowReadiness, RecorderSessionResponse, WorkspaceTransaction } from "@hellotest/platform/frontend/src/types";
import { resolveServiceBase } from "@hellotest/platform/frontend/src/platform/lib/serviceEndpoints";
import { API_BASE_URL, request, requestBlob, requestForm, toQueryString } from "@hellotest/platform/frontend/src/lib/httpClient";

type AgenticApiAgentTestInput = {
  project_id: string;
  method?: string;
  url: string;
  auth?: string;
  responseStyle?: string;
  body?: string;
  credential?: Record<string, unknown> | null;
};

export const agenticApi = {
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
    upload: (input: { project_id: string; app_type_id?: string; agent_type: RepositoryAgentRunInput["agent_type"]; file: File }, options?: { signal?: AbortSignal; idempotencyKey?: string }) => {
      const formData = new FormData();
      formData.set("project_id", input.project_id);
      if (input.app_type_id) formData.set("app_type_id", input.app_type_id);
      formData.set("agent_type", input.agent_type);
      formData.set("file", input.file);
      return requestForm<RepositoryAgentRun>("/repository-agents/runs", formData, options);
    },
    cancel: (id: string, options?: { signal?: AbortSignal }) =>
      request<RepositoryAgentRun>(`/repository-agents/runs/${encodeURIComponent(id)}/cancel`, { method: "POST", signal: options?.signal }),
    retry: (id: string, options?: { signal?: AbortSignal }) =>
      request<RepositoryAgentRun>(`/repository-agents/runs/${encodeURIComponent(id)}/retry`, { method: "POST", signal: options?.signal }),
    publish: (id: string, input: { item_ids: string[]; module_id?: string }, options?: { signal?: AbortSignal }) =>
      request<RepositoryAgentPublishResult>(`/repository-agents/runs/${encodeURIComponent(id)}/publish`, { method: "POST", body: JSON.stringify(input), signal: options?.signal }, 120_000),
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
    }, options?: { signal?: AbortSignal }) => request<AgenticAssistantSessionResponse>("/agentic-assistant/sessions", {
      method: "POST",
      body: JSON.stringify(input),
      signal: options?.signal
    }, AI_REQUEST_TIMEOUT_MS),
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
    readiness: (id: string) =>
      request<AgenticWorkflowReadiness>(`/agentic-workflows/${encodeURIComponent(id)}/readiness`, { cache: "no-store" }),
    execute: (id: string, input: { request_id: string; input_payload: Record<string, unknown> }) =>
      request<AgenticWorkflowRun>(`/agentic-workflows/${encodeURIComponent(id)}/executions`, { method: "POST", body: JSON.stringify(input) }),
    cancelRun: (id: string) =>
      request<AgenticWorkflowRun>(`/agentic-workflow-runs/${encodeURIComponent(id)}/cancel`, { method: "POST", body: "{}" }),
    listRuns: (query?: { project_id?: string; app_type_id?: string; workflow_id?: string; status?: string; limit?: number; summary_only?: boolean }, options?: { signal?: AbortSignal }) =>
      request<AgenticWorkflowRun[]>(`/agentic-workflow-runs${toQueryString(query)}`, { signal: options?.signal }),
    getRun: (id: string, options?: { signal?: AbortSignal }) =>
      request<AgenticWorkflowRun>(`/agentic-workflow-runs/${encodeURIComponent(id)}`, { signal: options?.signal, cache: "no-store" })
  }
};

