import type { AdminHealthSnapshot, ApiKeyScope, ApiKeyScopeOption, AppNotification, AuthSetupPayload, AppType, DomainMetadata, FeatureFlagSnapshot, JiraAttachment, JiraComment, Permission, PermissionGroup, Project, ProjectDeletionJob, ProjectDeletionResponse, ProjectPortfolioAnalytics, ProjectActivationBatchResult, ProjectActivationCatalog, ProjectActivationResourceResolutions, ProjectActivationSiteSnapshot, ProjectActivationSourceMapping, ProjectActivationSnapshot, ProjectMember, Role, SessionPayload, UserApiKey, User, WorkspaceTransaction, WorkspaceTransactionArtifact, WorkspaceTransactionEvent } from "./src/types";
import { readCurrentProjectId } from "./src/platform/lib/currentScope";
import { DashboardStyledReportPayload, PagedResult, clientGetResponseCache, request, requestBlob, requestForm, toQueryString } from "./src/lib/httpClient";

export type HelloTestEntityScope = {
  project_id: string;
  entity_type: "project" | "requirement" | "test_case" | "test_suite" | "shared_step_group" | "execution" | "execution_result" | "issue";
  entity_id: string;
};

const normalizeEntityScope = (value: HelloTestEntityScope | string): HelloTestEntityScope => {
  if (typeof value !== "string") return value;
  const normalized = value.toUpperCase();
  const entityType: HelloTestEntityScope["entity_type"] = normalized.startsWith("TC-")
    ? "test_case"
    : normalized.startsWith("RUN-") || normalized.startsWith("EXEC-")
      ? "execution"
      : normalized.startsWith("BUG-") || normalized.startsWith("ISSUE-")
        ? "issue"
        : "requirement";
  return { project_id: readCurrentProjectId(), entity_type: entityType, entity_id: value };
};

export const hellotestAuthSessionEvents = {
  refresh: "hellotest-auth-session-refresh"
} as const;

export const platformApi = {
admin: {
    health: (query?: { project_id?: string }) => request<AdminHealthSnapshot>(`/admin/health${toQueryString(query)}`)
  },
attachments: {
    meta: () => request<{ enabled: boolean; provider: string; uploadLimit: number; compression: "gzip" | "none" | string }>("/attachments/meta"),
    list: (scopeInput: HelloTestEntityScope | string) => {
      const scope = normalizeEntityScope(scopeInput);
      return request<JiraAttachment[]>(`/attachments${toQueryString(scope)}`);
    },
    upload: async (scopeInput: HelloTestEntityScope | string, file: File) => {
      const scope = normalizeEntityScope(scopeInput);
      const formData = new FormData();
      formData.append("project_id", scope.project_id);
      formData.append("entity_type", scope.entity_type);
      formData.append("entity_id", scope.entity_id);
      formData.append("file", file, file.name);
      return requestForm<JiraAttachment>("/attachments", formData);
    },
    download: (attachmentId: string) => requestBlob(`/attachments/${attachmentId}/download`),
    delete: (attachmentId: string) => request<{ deleted: boolean; id: string }>(`/attachments/${attachmentId}`, { method: "DELETE" })
  },
comments: {
    list: (scopeInput: HelloTestEntityScope | string) => {
      const scope = normalizeEntityScope(scopeInput);
      return request<JiraComment[]>(`/comments${toQueryString(scope)}`);
    },
    create: (scopeInput: HelloTestEntityScope | string, body: string) => {
      const text = body.trim();
      if (!text) throw new Error("Write a comment before posting.");
      const scope = normalizeEntityScope(scopeInput);
      return request<JiraComment>("/comments", {
        method: "POST",
        body: JSON.stringify({ ...scope, body: text })
      });
    }
  },
settings: {
    getLocalization: () => request<{ strings: Record<string, string> }>("/settings/localization"),
    updateLocalization: (input: { strings: Record<string, string> }) =>
      request<{ updated: boolean; strings: Record<string, string> }>("/settings/localization", {
        method: "PUT",
        body: JSON.stringify(input)
      }),
    getWorkspacePreferences: () => request<{ preferences: Record<string, unknown> }>("/settings/workspace-preferences"),
    updateWorkspacePreferences: (input: { preferences: Record<string, unknown> }) =>
      request<{ updated: boolean; preferences: Record<string, unknown> }>("/settings/workspace-preferences", {
        method: "PUT",
        body: JSON.stringify(input)
      }),
    listApiKeys: () => request<{ api_keys: UserApiKey[]; scopes: ApiKeyScopeOption[] }>("/settings/api-keys"),
    createApiKey: (input: { name: string; scope?: ApiKeyScope }) =>
      request<{
        key: string;
        api_key: UserApiKey;
        authorization_header: string;
        x_api_key_header: string;
      }>("/settings/api-keys", {
        method: "POST",
        body: JSON.stringify(input)
      }),
    revokeApiKey: (id: string) =>
      request<{ revoked: boolean; api_key: UserApiKey }>(`/settings/api-keys/${id}`, {
        method: "DELETE"
      }),
    deleteApiKey: (id: string) =>
      request<{ deleted: boolean; id: string }>(`/settings/api-keys/${id}/permanent`, {
        method: "DELETE"
      })
  },
featureFlags: {
    snapshot: (options?: { signal?: AbortSignal; fresh?: boolean }) => request<FeatureFlagSnapshot>("/feature-flags", { signal: options?.signal, cache: options?.fresh ? "no-store" : undefined })
  },
metadata: {
    domain: (options?: { signal?: AbortSignal }) => request<DomainMetadata>("/metadata/domain", { signal: options?.signal }),
    workspaceScopes: (options?: { signal?: AbortSignal }) =>
      request<{ projects: import("./src/types").WorkspaceProjectScope[] }>("/metadata/workspace-scopes", { signal: options?.signal })
  },
auth: {
    setup: () => request<AuthSetupPayload>("/auth/setup"),
    requestSignupCode: (input: { email: string; password: string; name?: string }) =>
      request<{ success: boolean; expiresAt?: string }>("/auth/signup/request-code", {
        method: "POST",
        body: JSON.stringify(input)
      }),
    verifySignupCode: (input: { email: string; code: string }) =>
      request<{ success: boolean }>("/auth/signup/verify", {
        method: "POST",
        body: JSON.stringify(input)
      }),
    login: (input: { email: string; password: string }) =>
      request<SessionPayload>("/auth/login", {
        method: "POST",
        body: JSON.stringify(input)
      }),
    loginWithGoogle: (input: { idToken: string }) =>
      request<SessionPayload>("/auth/login/google", {
        method: "POST",
        body: JSON.stringify(input)
      }),
    requestPasswordResetCode: (input: { email: string; newPassword: string }) =>
      request<{ success: boolean; expiresAt?: string }>("/auth/forgot-password/request-code", {
        method: "POST",
        body: JSON.stringify(input)
      }),
    verifyPasswordResetCode: (input: { email: string; code: string }) =>
      request<{ success: boolean }>("/auth/forgot-password/verify", {
        method: "POST",
        body: JSON.stringify(input)
      }),
    session: () => request<SessionPayload>("/auth/session", { cache: "no-store" })
  },
users: {
    list: (options?: { signal?: AbortSignal }) => request<User[]>("/users", { signal: options?.signal }),
    get: (id: string) => request<User>(`/users/${id}`),
    create: (input: { email: string; password: string; name?: string; role_id: string }) =>
      request<{ id: string }>("/users", { method: "POST", body: JSON.stringify(input) }),
    update: (id: string, input: Partial<{ email: string; password: string; name: string; role_id: string; avatar_data_url: string | null }>) =>
      request<{ updated: boolean }>(`/users/${id}`, { method: "PUT", body: JSON.stringify(input) }),
    changePassword: (id: string, input: { current_password: string; new_password: string }) =>
      request<{ updated: boolean }>(`/users/${id}/password`, { method: "PUT", body: JSON.stringify(input) }),
    delete: (id: string) => request<{ deleted: boolean }>(`/users/${id}`, { method: "DELETE" })
  },
notifications: {
    list: (query?: { status?: "unread" | "read" | string; cursor?: string; limit?: number }) =>
      request<PagedResult<AppNotification> & { unread_count: number }>(`/notifications${toQueryString(query)}`),
    unreadCount: () =>
      request<{ count: number; by_preference: Record<string, number> }>("/notifications/unread-count"),
    realtimeToken: () =>
      request<{ token: string; expires_at: number }>("/notifications/realtime-token"),
    markRead: (id: string) =>
      request<{ updated: boolean }>(`/notifications/${encodeURIComponent(id)}/read`, { method: "PUT" }),
    markAllRead: async () => {
      let count = 0;
      let remaining = 0;
      let hasMore = true;
      let failedCount = 0;
      let stalledBatches = 0;

      for (let batch = 0; batch < 15 && hasMore; batch += 1) {
        const result = await request<{ updated: boolean; count: number; remaining: number; has_more: boolean; failed_count: number }>("/notifications/read-all", { method: "PUT" });
        count += result.count;
        remaining = result.remaining;
        hasMore = result.has_more;
        failedCount = result.failed_count;
        stalledBatches = result.count === 0 && result.has_more ? stalledBatches + 1 : 0;
        if (stalledBatches >= 2) break;
      }

      return { updated: !hasMore, partial: hasMore, count, remaining, failed_count: failedCount };
    },
    delete: (id: string) =>
      request<{ deleted: boolean; id: string }>(`/notifications/${encodeURIComponent(id)}`, { method: "DELETE" }),
    deleteAll: async () => {
      let before: string | undefined;
      let count = 0;
      let hasMore = true;
      let remaining = 0;
      let failedCount = 0;
      let stalledBatches = 0;

      // Keep each Forge invocation bounded. The backend compacts the sharded
      // project-property index once per batch, while this loop preserves a
      // single, predictable user action even at the retention ceiling.
      for (let batch = 0; batch < 10 && hasMore; batch += 1) {
        const result = await request<{ deleted: boolean; count: number; has_more: boolean; remaining: number; failed_count: number; before: string }>("/notifications", {
          method: "DELETE",
          // Let Forge establish the first cutoff with its own clock, then pin
          // every continuation to that same snapshot boundary.
          body: JSON.stringify(before ? { before } : {})
        });
        before = result.before;
        count += result.count;
        hasMore = result.has_more;
        remaining = result.remaining;
        failedCount = result.failed_count;
        stalledBatches = result.count === 0 && result.has_more ? stalledBatches + 1 : 0;
        if (stalledBatches >= 2) break;
      }

      return {
        deleted: !hasMore,
        partial: hasMore,
        count,
        remaining,
        failed_count: failedCount,
        before: before || ""
      };
    }
  },
roles: {
    list: (options?: { signal?: AbortSignal }) => request<Role[]>("/roles", { signal: options?.signal }),
    permissions: () => request<PermissionGroup[]>("/permissions"),
    rolePermissions: (id: string) => request<Permission[]>(`/roles/${id}/permissions`),
    create: (input: { name: string; permission_codes?: string[] }) =>
      request<{ id: string }>("/roles", { method: "POST", body: JSON.stringify(input) }),
    update: (id: string, input: Partial<{ name: string; permission_codes: string[] }>) =>
      request<{ updated: boolean }>(`/roles/${id}`, { method: "PUT", body: JSON.stringify(input) }),
    replacePermissions: (id: string, permission_codes: string[]) =>
      request<{ updated: boolean; permission_codes: string[] }>(`/roles/${id}/permissions`, {
        method: "PUT",
        body: JSON.stringify({ permission_codes })
      }),
    delete: (id: string) => request<{ deleted: boolean }>(`/roles/${id}`, { method: "DELETE" })
  },
projects: {
    list: (options?: { signal?: AbortSignal }) => request<Project[]>("/projects?projection=summary", { signal: options?.signal }),
    catalog: (options?: { signal?: AbortSignal }) => request<Project[]>("/projects/catalog?projection=summary", { signal: options?.signal }),
    get: (id: string, options?: { signal?: AbortSignal }) => request<Project>(`/projects/${encodeURIComponent(id)}`, { signal: options?.signal }),
    portfolioAnalytics: (options?: { signal?: AbortSignal }) => request<ProjectPortfolioAnalytics>("/projects/portfolio-analytics", { signal: options?.signal }),
    downloadPortfolioAttentionPdf: (input: DashboardStyledReportPayload) =>
      requestBlob("/projects/portfolio-attention-report.pdf", { method: "POST", body: JSON.stringify(input) }),
    create: (input: { name: string; description?: string; visibility: "private" | "public"; created_by?: string; members?: Array<{ user_id: string; role_id: string }>; app_types?: Array<{ name: string; type: AppType["type"]; is_unified?: boolean }> }) =>
      request<{ id: string; display_id?: string; name: string; description: string | null; visibility: "private" | "public"; created_by: string; members_added: number; app_types_created: number; provisioning_errors?: Array<{ area: string; reference?: string; code?: string; message: string }> }>("/projects", { method: "POST", body: JSON.stringify(input) }),
    favorite: (id: string) => request<{ updated: boolean; is_favorite: boolean }>(`/projects/${id}/favorite`, { method: "PUT" }),
    unfavorite: (id: string) => request<{ updated: boolean; is_favorite: boolean }>(`/projects/${id}/favorite`, { method: "DELETE" }),
    sync: (id: string, provider: "google_drive" | "github") =>
      request<{ id: string; duplicate?: boolean }>(`/projects/${id}/sync/${provider}`, { method: "POST" }),
    update: (id: string, input: Partial<{ name: string; description: string }>) =>
      request<{ updated: boolean }>(`/projects/${id}`, { method: "PUT", body: JSON.stringify(input) }),
    delete: (id: string) => request<ProjectDeletionResponse>(`/projects/${encodeURIComponent(id)}`, { method: "DELETE" }),
    deletion: (id: string, options?: { signal?: AbortSignal }) =>
      request<ProjectDeletionJob>(`/projects/${encodeURIComponent(id)}/deletion`, { signal: options?.signal, cache: "no-store" }).then((job) => {
        // Completion happens after the DELETE response. Lists cached while the
        // worker was running must be refreshed after this observation.
        if (job.status === "completed") clientGetResponseCache.clear();
        return job;
      })
  },
projectActivation: {
    projects: () => request<ProjectActivationCatalog>("/project-activation/projects"),
    site: () => request<ProjectActivationSiteSnapshot>("/project-activation/site"),
    prepareSite: (resourceResolutions?: ProjectActivationResourceResolutions) => request<ProjectActivationSiteSnapshot>("/project-activation/site", {
      method: "POST",
      body: JSON.stringify({
        confirmed: true,
        ...(resourceResolutions ? { resource_resolutions: resourceResolutions } : {})
      })
    }),
    bulkEnable: (projectIds: string[]) => request<ProjectActivationBatchResult>("/project-activation/bulk", {
      method: "POST",
      body: JSON.stringify({ confirmed: true, project_ids: projectIds })
    }),
    status: (projectId: string) =>
      request<ProjectActivationSnapshot>(`/project-activation${toQueryString({ project_id: projectId })}`),
    enable: (input: {
      project_id: string;
      confirmed: true;
      requirement_issue_type_ids?: ProjectActivationSourceMapping["requirement_issue_type_ids"];
      defect_issue_type_ids?: ProjectActivationSourceMapping["defect_issue_type_ids"];
    }) => request<ProjectActivationSnapshot>("/project-activation", {
      method: "POST",
      body: JSON.stringify(input)
    })
  },
projectMembers: {
    list: (query?: { project_id?: string; user_id?: string; role_id?: string }, options?: { signal?: AbortSignal }) =>
      request<ProjectMember[]>(`/project-members${toQueryString(query)}`, { signal: options?.signal }),
    create: (input: { project_id: string; user_id: string; role_id: string }) =>
      request<{ id: string }>("/project-members", { method: "POST", body: JSON.stringify(input) }),
    update: (id: string, input: Partial<{ project_id: string; user_id: string; role_id: string }>) =>
      request<{ updated: boolean }>(`/project-members/${id}`, { method: "PUT", body: JSON.stringify(input) }),
    delete: (id: string) => request<{ deleted: boolean }>(`/project-members/${id}`, { method: "DELETE" })
  },
appTypes: {
    list: (query?: { project_id?: string }, options?: { signal?: AbortSignal }) => request<AppType[]>(`/app-types${toQueryString(query)}`, { signal: options?.signal }),
    create: (input: { project_id: string; name: string; type: AppType["type"]; is_unified?: boolean }) =>
      request<{ id: string }>("/app-types", { method: "POST", body: JSON.stringify(input) }),
    update: (id: string, input: Partial<{ name: string; is_unified: boolean }>) =>
      request<{ updated: boolean }>(`/app-types/${id}`, { method: "PUT", body: JSON.stringify(input) }),
    delete: (id: string) => request<{ deleted: boolean }>(`/app-types/${id}`, { method: "DELETE" })
  },
workspaceTransactions: {
    list: (query?: { project_id?: string; app_type_id?: string; category?: string; include_global?: boolean; limit?: number }, options?: { signal?: AbortSignal }) =>
      request<WorkspaceTransaction[]>(`/workspace-transactions${toQueryString(query)}`, { signal: options?.signal }),
    events: (id: string, options?: { signal?: AbortSignal }) =>
      request<WorkspaceTransactionEvent[]>(`/workspace-transactions/${id}/events`, { signal: options?.signal }),
    artifacts: (id: string, options?: { signal?: AbortSignal }) =>
      request<WorkspaceTransactionArtifact[]>(`/workspace-transactions/${id}/artifacts`, { signal: options?.signal }),
    downloadArtifact: (transactionId: string, artifactId: string) =>
      requestBlob(`/workspace-transactions/${transactionId}/artifacts/${artifactId}/download`),
    delete: (id: string) =>
      request<{ deleted: boolean }>(`/workspace-transactions/${id}`, { method: "DELETE" })
  }
};

