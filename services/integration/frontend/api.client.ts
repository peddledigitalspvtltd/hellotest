import type { IntegrationConnectionInput, IntegrationConnectionResult } from "./lib/integrationConnection";
import type { AiPromptTemplate, Integration } from "@hellotest/platform/frontend/src/types";
import { request, toQueryString } from "@hellotest/platform/frontend/src/lib/httpClient";



export const integrationApi = {
integrations: {
    list: (query?: { type?: Integration["type"]; is_active?: boolean }, options?: { signal?: AbortSignal }) =>
      request<Integration[]>(`/integrations${toQueryString(query)}`, { signal: options?.signal }),
    create: (input: { type: Integration["type"]; name: string; base_url?: string; api_key?: string; model?: string; project_key?: string; username?: string; config?: Record<string, unknown>; is_active?: boolean }) =>
      request<{ id: string }>("/integrations", { method: "POST", body: JSON.stringify(input) }),
    testConnection: (input: IntegrationConnectionInput, options?: { signal?: AbortSignal }) =>
      request<IntegrationConnectionResult>("/integrations/test-connection", { method: "POST", body: JSON.stringify(input), signal: options?.signal }, 40_000),
	    update: (id: string, input: Partial<{ type: Integration["type"]; name: string; base_url: string; api_key: string; model: string; project_key: string; username: string; config: Record<string, unknown>; is_active: boolean }>) =>
	      request<{ updated: boolean }>(`/integrations/${id}`, { method: "PUT", body: JSON.stringify(input) }),
	    export: () =>
	      request<{ version: number; exported_at: string; integrations: Integration[]; transaction_id?: string; artifact_id?: string }>("/integrations/export"),
	    import: (input: { integrations: Integration[] }) =>
	      request<{ imported: number; updated: number; failed: number; transaction_id?: string; failures: Array<{ name: string; error: string }> }>("/integrations/import", {
	        method: "POST",
	        body: JSON.stringify(input)
	      }),
	    delete: (id: string) => request<{ deleted: boolean }>(`/integrations/${id}`, { method: "DELETE" })
	  },
aiPromptTemplates: {
    list: (query: { project_id?: string; app_type_id?: string; scope?: string }) =>
      request<AiPromptTemplate[]>(`/ai-prompt-templates${toQueryString(query)}`),
    create: (input: Partial<AiPromptTemplate> & { project_id?: string; app_type_id?: string; name: string; prompt_text: string }) =>
      request<AiPromptTemplate>("/ai-prompt-templates", {
        method: "POST",
        body: JSON.stringify(input)
      }),
    update: (id: string, input: Partial<AiPromptTemplate>) =>
      request<AiPromptTemplate>(`/ai-prompt-templates/${id}`, {
        method: "PUT",
        body: JSON.stringify(input)
      }),
    delete: (id: string) =>
      request<{ deleted: boolean; id: string }>(`/ai-prompt-templates/${id}`, {
        method: "DELETE"
      })
  }
};

