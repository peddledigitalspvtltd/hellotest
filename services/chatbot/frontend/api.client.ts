import type { KnowledgeAssistantIntegration, KnowledgeAssistantMessageResponse, KnowledgeAssistantSession, KnowledgeSearchFilters, KnowledgeRetrievalEvent } from "@hellotest/platform/frontend/src/types";
import { consumeKnowledgeAssistantStream, KnowledgeStreamError } from "./lib/knowledgeAssistantStream";
import { resolveServiceBase } from "@hellotest/platform/frontend/src/platform/lib/serviceEndpoints";
import { appendCurrentProjectScope } from "@hellotest/platform/frontend/src/platform/lib/currentScope";
import { API_BASE_URL, clientGetResponseCache, isSessionAuthFailure, parseApiError, readRequestSession, request, sessionStorage, toQueryString } from "@hellotest/platform/frontend/src/lib/httpClient";

async function requestKnowledgeStream(path: string, input: unknown, options: { signal?: AbortSignal; onProgress?: (event: KnowledgeRetrievalEvent) => void } = {}) {
  const scopedPath = appendCurrentProjectScope(path);
  const serviceBase = resolveServiceBase(scopedPath, API_BASE_URL);
  const requestSession = readRequestSession();
  const { token } = requestSession;
  const timeout = AbortSignal.timeout(210_000);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
  let response: Response;
  try {
    response = await fetch(`${serviceBase}${scopedPath}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "text/event-stream", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(input),
      signal
    });
  } catch (error) {
    if (options.signal?.aborted) throw error;
    if (timeout.aborted) throw new KnowledgeStreamError("The answer did not finish within the connection time limit.", "REQUEST_TIMEOUT");
    throw new KnowledgeStreamError("The assistant could not be reached. Check your connection and retry this turn.", "NETWORK_UNAVAILABLE");
  }
  if (!response.ok) {
    const error = await parseApiError(response);
    if (response.status === 401 && token && isSessionAuthFailure(scopedPath, error.message) && readRequestSession().revision === requestSession.revision) {
      sessionStorage.clear();
      window.location.assign("/auth");
    }
    throw new KnowledgeStreamError(error.message, `HTTP_${response.status}`, response.status === 429 || response.status >= 500);
  }
  let result: KnowledgeAssistantMessageResponse;
  try {
    result = await consumeKnowledgeAssistantStream(response, { ...options, signal });
  } catch (error) {
    if (!options.signal?.aborted && timeout.aborted) throw new KnowledgeStreamError("The answer did not finish within the connection time limit.", "REQUEST_TIMEOUT");
    throw error;
  }
  clientGetResponseCache.clear();
  return result;
}

export const chatbotApi = {
assistant: {
      listIntegrations: (projectId: string) =>
        request<KnowledgeAssistantIntegration[]>(`/knowledge/assistant/integrations${toQueryString({ project_id: projectId })}`),
      listSessions: (projectId: string) =>
        request<KnowledgeAssistantSession[]>(`/knowledge/assistant/sessions${toQueryString({ project_id: projectId })}`),
      createSession: (input: { project_id: string; app_type_id?: string | null; title?: string; integration_id?: string }, options?: { signal?: AbortSignal }) =>
        request<KnowledgeAssistantSession>("/knowledge/assistant/sessions", {
          method: "POST",
          body: JSON.stringify(input),
          signal: options?.signal
        }),
      getSession: (id: string) => request<KnowledgeAssistantSession>(`/knowledge/assistant/sessions/${id}`),
      updateSession: (id: string, input: { title?: string; status?: "archived" | "active" }) => request<KnowledgeAssistantSession>(`/knowledge/assistant/sessions/${id}`, { method: "PATCH", body: JSON.stringify(input) }),
      streamMessage: (id: string, input: { message: string; client_turn_id: string; retry_provider?: boolean; filters?: KnowledgeSearchFilters; integration_id?: string; response_mode?: "answer" | "evidence"; smart_context?: { query?: string; source_ids?: string[]; source_kinds?: string[]; reviewed_context?: string } }, options?: { signal?: AbortSignal; onProgress?: (event: KnowledgeRetrievalEvent) => void }) =>
        requestKnowledgeStream(`/knowledge/assistant/sessions/${id}/messages/stream`, input, options),
      sendMessage: (id: string, input: { message: string; client_turn_id: string; retry_provider?: boolean; filters?: KnowledgeSearchFilters; integration_id?: string; smart_context?: { query?: string; source_ids?: string[]; source_kinds?: string[]; reviewed_context?: string } }, options?: { signal?: AbortSignal }) =>
        request<KnowledgeAssistantMessageResponse>(`/knowledge/assistant/sessions/${id}/messages`, {
          method: "POST",
          body: JSON.stringify(input),
          signal: options?.signal
        }, 210_000)
    }
};

