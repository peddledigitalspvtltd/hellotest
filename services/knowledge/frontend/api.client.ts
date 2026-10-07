import type { KnowledgeCollection, KnowledgeIngestion, KnowledgeIngestionRequest, KnowledgeIngestionResponse, KnowledgeOverview, KnowledgeSearchFilters, KnowledgeSearchMode, KnowledgeSearchResponse, KnowledgeSource, KnowledgeSourceDetail, KnowledgeSourceRevision } from "@hellotest/platform/frontend/src/types";
import { request, requestBlob, requestForm, toQueryString } from "@hellotest/platform/frontend/src/lib/httpClient";



export type KnowledgeRefresh = {
  project_id: string; enabled: boolean; interval_ms: number; status: string; requested: boolean;
  last_completed_at?: string; last_error?: string | null;
  last_result: { scanned?: number; queued?: number; unchanged?: number; inaccessible?: number };
};
export const knowledgeApi = {
knowledgeRepo: {
refresh: {
  get: (projectId: string) => request<KnowledgeRefresh>(`/projects/${projectId}/knowledge/refresh`),
  run: (projectId: string) => request<KnowledgeRefresh>(`/projects/${projectId}/knowledge/refresh`, { method: "POST" }),
  configure: (projectId: string, input: { enabled: boolean; interval_ms: number }) => request<KnowledgeRefresh>(`/projects/${projectId}/knowledge/refresh`, { method: "PUT", body: JSON.stringify(input) })
},
list: (projectId: string, options?: { signal?: AbortSignal }) => request<any[]>(`/projects/${projectId}/knowledge`, { signal: options?.signal }),
overview: (projectId: string, options?: { signal?: AbortSignal }) =>
      request<KnowledgeOverview>(`/projects/${projectId}/knowledge/overview`, { signal: options?.signal }),
search: (input: {
      project_id: string;
      query: string;
      mode?: KnowledgeSearchMode;
      limit?: number;
      filters?: KnowledgeSearchFilters;
    }, options?: { signal?: AbortSignal }) => request<KnowledgeSearchResponse>("/knowledge/search", {
      method: "POST",
      body: JSON.stringify(input),
      signal: options?.signal
    }),
sources: (projectId: string, options?: { includeArchived?: boolean; signal?: AbortSignal }) =>
      request<KnowledgeSource[]>(`/knowledge/sources${toQueryString({ project_id: projectId, include_archived: options?.includeArchived || undefined })}`, { signal: options?.signal }),
sourceDetail: (id: string, query?: { revision_id?: string; as_of?: string }) =>
      request<KnowledgeSourceDetail>(`/knowledge/sources/${id}${toQueryString(query)}`),
sourceRevisions: (id: string) =>
      request<{ source_id: string; canonical_id?: string; revisions: KnowledgeSourceRevision[]; historical_access?: boolean }>(`/knowledge/sources/${id}/revisions`),
deleteSource: (id: string) =>
      request<{ deleted: boolean; id: string; retained_history?: boolean }>(`/knowledge/sources/${id}`, { method: "DELETE" }),
downloadSource: (id: string) => requestBlob(`/knowledge/sources/${id}/file`),
contextPackage: (projectId: string, query?: { app_type_id?: string; query?: string; asset_type?: string; priority?: string }) =>
      request<{ project_id: string; knowledge: any[]; related_context?: any[] }>(
        `/projects/${projectId}/knowledge/context-package${toQueryString(query)}`
      ),
create: (projectId: string, input: any) => request<any>(`/projects/${projectId}/knowledge`, { method: "POST", body: JSON.stringify(input) }),
update: (projectId: string, id: string, input: any) => request<any>(`/projects/${projectId}/knowledge/${id}`, { method: "PUT", body: JSON.stringify(input) }),
delete: (projectId: string, id: string) => request<{ success: boolean }>(`/projects/${projectId}/knowledge/${id}`, { method: "DELETE" }),
ingestions: {
      create: (input: KnowledgeIngestionRequest, options?: { idempotencyKey?: string }) =>
        request<KnowledgeIngestionResponse>("/knowledge/ingestions", {
          method: "POST",
          body: JSON.stringify(input),
          headers: options?.idempotencyKey ? { "Idempotency-Key": options.idempotencyKey } : undefined
        }),
      upload: (input: KnowledgeIngestionRequest, file: File, extractedText?: string, options?: { idempotencyKey?: string }) => {
        const formData = new FormData();
        formData.set("file", file);
        formData.set("project_id", input.project_id);
        if (input.app_type_id) formData.set("app_type_id", input.app_type_id);
        if (input.collection_id) formData.set("collection_id", input.collection_id);
        if (input.title) formData.set("title", input.title);
        if (input.chunking) formData.set("chunking", JSON.stringify(input.chunking));
        if (input.inputs?.length) formData.set("inputs", JSON.stringify(input.inputs));
        if (input.selected_records) formData.set("selected_records", JSON.stringify(input.selected_records));
        if (extractedText?.trim()) formData.set("extracted_text", extractedText.trim());
        return requestForm<KnowledgeIngestionResponse>("/knowledge/ingestions", formData, options);
      },
      get: (id: string) => request<KnowledgeIngestion>(`/knowledge/ingestions/${id}`),
      retry: (id: string) => request<KnowledgeIngestionResponse>(`/knowledge/ingestions/${id}/retry`, { method: "POST" })
    },
collections: {
      list: (projectId: string, options?: { signal?: AbortSignal }) =>
        request<KnowledgeCollection[]>(`/knowledge/collections${toQueryString({ project_id: projectId })}`, { signal: options?.signal }),
      get: (id: string) => request<KnowledgeCollection>(`/knowledge/collections/${id}`),
      create: (input: { project_id: string; app_type_id?: string | null; name: string; description?: string; color?: string }) =>
        request<KnowledgeCollection>("/knowledge/collections", {
          method: "POST",
          body: JSON.stringify(input)
        }),
      update: (id: string, input: Partial<Pick<KnowledgeCollection, "name" | "description" | "color" | "is_active">>) =>
        request<KnowledgeCollection>(`/knowledge/collections/${id}`, {
          method: "PUT",
          body: JSON.stringify(input)
        }),
      delete: (id: string) => request<{ deleted: boolean; id?: string }>(`/knowledge/collections/${id}`, { method: "DELETE" }),
      addSources: (id: string, sourceIds: string[]) =>
        request<KnowledgeCollection>(`/knowledge/collections/${id}/sources`, {
          method: "POST",
          body: JSON.stringify({ source_ids: sourceIds })
        }),
      removeSources: (id: string, sourceIds: string[]) =>
        request<KnowledgeCollection>(`/knowledge/collections/${id}/sources`, {
          method: "DELETE",
          body: JSON.stringify({ source_ids: sourceIds })
        })
    } }
};

