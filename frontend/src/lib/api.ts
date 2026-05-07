import type {
  ApiRequestPreview,
  AiCaseAuthoringPreviewResponse,
  AiDesignImageInput,
  AiDesignPreviewResponse,
  AiStepRephraseResponse,
  AiTestCaseGenerationJob,
  AutomationBuildResponse,
  AutomationLearningCacheEntry,
  AuthSetupPayload,
  ApiError,
  AppType,
  DomainMetadata,
  Execution,
  ExecutionResult,
  ExecutionSchedule,
  Feedback,
  Integration,
  KeyValueEntry,
  Project,
  ProjectMember,
  Requirement,
  Role,
  SessionPayload,
  RecorderSessionResponse,
  SharedStepGroup,
  SmartExecutionPreviewResponse,
  TestConfiguration,
  TestCase,
  TestDataSet,
  TestDataSetMode,
  TestEnvironment,
  TestStep,
  TestSuite,
  User,
  WorkspaceTransaction,
  WorkspaceTransactionArtifact,
  WorkspaceTransactionEvent
} from "../types";
import type { ExecutionStartResponse } from "./executionStartSummary";
import type { ExecutionAiAnalysis } from "./executionLogs";

declare global {
  interface Window {
    __QAIRA_CONFIG__?: {
      API_BASE_URL?: string;
    };
  }
}

const API_BASE_URL =
  window.__QAIRA_CONFIG__?.API_BASE_URL ||
  import.meta.env.VITE_API_BASE_URL ||
  "/api";
const SESSION_KEY = "qaira.session";

const getStoredToken = () => {
  const raw = window.localStorage.getItem(SESSION_KEY);

  if (!raw) {
    return null;
  }

  try {
    const session = JSON.parse(raw) as SessionPayload;
    return session.token;
  } catch {
    window.localStorage.removeItem(SESSION_KEY);
    return null;
  }
};

export const sessionStorage = {
  read(): SessionPayload | null {
    const raw = window.localStorage.getItem(SESSION_KEY);

    if (!raw) {
      return null;
    }

    try {
      return JSON.parse(raw) as SessionPayload;
    } catch {
      window.localStorage.removeItem(SESSION_KEY);
      return null;
    }
  },
  write(session: SessionPayload) {
    window.localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  },
  clear() {
    window.localStorage.removeItem(SESSION_KEY);
  }
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  const token = getStoredToken();

  if (!headers.has("Content-Type") && init?.body) {
    headers.set("Content-Type", "application/json");
  }

  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  let response: Response;

  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      ...init,
      headers,
      signal: AbortSignal.timeout(30000) // 30 second timeout
    });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(`Request timeout: ${path} took too long to respond`);
    }
    throw new Error(`Unable to reach API at ${API_BASE_URL}. Check your connection and try again.`);
  }

  // Handle authentication errors
  if (response.status === 401 && token) {
    sessionStorage.clear();

    if (!path.startsWith("/auth/")) {
      window.location.href = "/auth";
    }
  }

  const isJson = response.headers.get("content-type")?.includes("application/json");
  const payload = isJson ? await response.json() : null;

  if (!response.ok) {
    const error = (payload || {}) as ApiError;
    const message = error.message || `Request failed with status ${response.status}`;
    throw new Error(message);
  }

  return payload as T;
}

async function requestBlob(path: string, init?: RequestInit): Promise<Blob> {
  const headers = new Headers(init?.headers);
  const token = getStoredToken();

  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  let response: Response;

  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      ...init,
      headers,
      signal: AbortSignal.timeout(30000)
    });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(`Request timeout: ${path} took too long to respond`);
    }
    throw new Error(`Unable to reach API at ${API_BASE_URL}. Check your connection and try again.`);
  }

  if (!response.ok) {
    const isJson = response.headers.get("content-type")?.includes("application/json");
    const payload = isJson ? await response.json() : null;
    const message = (payload as ApiError | null)?.message || `Request failed with status ${response.status}`;
    throw new Error(message);
  }

  return response.blob();
}

type TestCaseImportSourceValue = "csv" | "junit_xml" | "testng_xml" | "postman_collection";

type BatchQueueResponse = {
  id: string;
  transaction_id: string;
  job_id?: string;
  transaction_ids?: string[];
  job_ids?: string[];
  split_count?: number;
  queued: boolean;
  status: string;
};

type TestCaseImportBatchInput = {
  file_name?: string;
  import_source: TestCaseImportSourceValue;
  rows: Array<Record<string, unknown>>;
};

const MAX_IMPORT_REQUEST_BYTES = 4 * 1024 * 1024;
const MAX_IMPORT_ROWS_PER_BATCH = 250;

const splitRowsForImport = (rows: Array<Record<string, unknown>>) => {
  const chunks: Array<Array<Record<string, unknown>>> = [];
  let current: Array<Record<string, unknown>> = [];
  let currentBytes = 0;

  rows.forEach((row) => {
    const rowBytes = JSON.stringify(row).length + 2;
    const shouldStartNext =
      current.length > 0
      && (current.length >= MAX_IMPORT_ROWS_PER_BATCH || currentBytes + rowBytes > MAX_IMPORT_REQUEST_BYTES);

    if (shouldStartNext) {
      chunks.push(current);
      current = [];
      currentBytes = 0;
    }

    current.push(row);
    currentBytes += rowBytes;
  });

  if (current.length) {
    chunks.push(current);
  }

  return chunks;
};

const splitTestCaseImportInput = (input: {
  app_type_id: string;
  requirement_id?: string;
  import_source?: TestCaseImportSourceValue;
  rows?: Array<Record<string, unknown>>;
  batches?: TestCaseImportBatchInput[];
}) => {
  const payloads: Array<typeof input> = [];

  if (input.batches?.length) {
    input.batches.forEach((batch) => {
      splitRowsForImport(batch.rows || []).forEach((rows, index) => {
        payloads.push({
          app_type_id: input.app_type_id,
          requirement_id: input.requirement_id,
          import_source: input.import_source,
          batches: [{
            file_name: index ? `${batch.file_name || "import"} part ${index + 1}` : batch.file_name,
            import_source: batch.import_source,
            rows
          }]
        });
      });
    });
  } else if (input.rows?.length) {
    splitRowsForImport(input.rows).forEach((rows) => {
      payloads.push({
        app_type_id: input.app_type_id,
        requirement_id: input.requirement_id,
        import_source: input.import_source,
        rows
      });
    });
  }

  return payloads.length ? payloads : [input];
};

export const api = {
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
      })
  },
  metadata: {
    domain: () => request<DomainMetadata>("/metadata/domain")
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
    session: () => request<SessionPayload>("/auth/session")
  },
  users: {
    list: () => request<User[]>("/users"),
    create: (input: { email: string; password_hash: string; name?: string; role_id: string }) =>
      request<{ id: string }>("/users", { method: "POST", body: JSON.stringify(input) }),
    bulkImport: (input: {
      rows: Array<Record<string, string | number | null | undefined>>;
      default_role_id?: string;
    }) =>
      request<BatchQueueResponse>("/users/import", {
        method: "POST",
        body: JSON.stringify(input)
      }),
    update: (id: string, input: Partial<{ email: string; password_hash: string; name: string; role_id: string; avatar_data_url: string | null }>) =>
      request<{ updated: boolean }>(`/users/${id}`, { method: "PUT", body: JSON.stringify(input) }),
    delete: (id: string) => request<{ deleted: boolean }>(`/users/${id}`, { method: "DELETE" })
  },
  roles: {
    list: () => request<Role[]>("/roles"),
    create: (input: { name: string }) =>
      request<{ id: string }>("/roles", { method: "POST", body: JSON.stringify(input) }),
    update: (id: string, input: Partial<{ name: string }>) =>
      request<{ updated: boolean }>(`/roles/${id}`, { method: "PUT", body: JSON.stringify(input) }),
    delete: (id: string) => request<{ deleted: boolean }>(`/roles/${id}`, { method: "DELETE" })
  },
  projects: {
    list: () => request<Project[]>("/projects"),
    create: (input: { name: string; description?: string; created_by?: string; member_ids?: string[]; app_types?: Array<{ name: string; type: AppType["type"]; is_unified?: boolean }> }) =>
      request<{ id: string; members_added: number; app_types_created: number }>("/projects", { method: "POST", body: JSON.stringify(input) }),
    sync: (id: string, provider: "google_drive" | "github") =>
      request<{ id: string; duplicate?: boolean }>(`/projects/${id}/sync/${provider}`, { method: "POST" }),
    update: (id: string, input: Partial<{ name: string; description: string }>) =>
      request<{ updated: boolean }>(`/projects/${id}`, { method: "PUT", body: JSON.stringify(input) }),
    delete: (id: string) => request<{ deleted: boolean }>(`/projects/${id}`, { method: "DELETE" })
  },
  projectMembers: {
    list: (query?: { project_id?: string; user_id?: string; role_id?: string }) =>
      request<ProjectMember[]>(`/project-members${toQueryString(query)}`),
    create: (input: { project_id: string; user_id: string; role_id: string }) =>
      request<{ id: string }>("/project-members", { method: "POST", body: JSON.stringify(input) }),
    update: (id: string, input: Partial<{ project_id: string; user_id: string; role_id: string }>) =>
      request<{ updated: boolean }>(`/project-members/${id}`, { method: "PUT", body: JSON.stringify(input) }),
    delete: (id: string) => request<{ deleted: boolean }>(`/project-members/${id}`, { method: "DELETE" })
  },
  appTypes: {
    list: (query?: { project_id?: string }) => request<AppType[]>(`/app-types${toQueryString(query)}`),
    create: (input: { project_id: string; name: string; type: AppType["type"]; is_unified?: boolean }) =>
      request<{ id: string }>("/app-types", { method: "POST", body: JSON.stringify(input) }),
    update: (id: string, input: Partial<{ name: string; is_unified: boolean }>) =>
      request<{ updated: boolean }>(`/app-types/${id}`, { method: "PUT", body: JSON.stringify(input) }),
    delete: (id: string) => request<{ deleted: boolean }>(`/app-types/${id}`, { method: "DELETE" })
  },
  requirements: {
    list: (query?: { project_id?: string; status?: string; priority?: number }) =>
      request<Requirement[]>(`/requirements${toQueryString(query)}`),
    create: (input: { project_id: string; title: string; description?: string; external_references?: string[]; priority?: number; status?: string }) =>
      request<{ id: string }>("/requirements", { method: "POST", body: JSON.stringify(input) }),
    bulkImport: (input: { project_id: string; rows: Array<Record<string, unknown>> }) =>
      request<BatchQueueResponse>("/requirements/import", {
        method: "POST",
        body: JSON.stringify(input)
      }),
    previewDesignedTestCases: (id: string, input: { app_type_id: string; integration_id?: string; max_cases?: number; additional_context?: string; external_links?: string[]; images?: AiDesignImageInput[] }) =>
      request<AiDesignPreviewResponse>(`/requirements/${id}/design-test-cases-preview`, {
        method: "POST",
        body: JSON.stringify(input)
      }),
    acceptDesignedTestCases: (id: string, input: { app_type_id: string; status?: string; cases: Array<{ title: string; description?: string | null; priority?: number; requirement_ids?: string[]; steps?: Array<{ step_order?: number; action?: string | null; expected_result?: string | null }> }> }) =>
      request<{ accepted: number; created: Array<{ id: string; title: string; step_count: number; requirement_ids: string[] }> }>(`/requirements/${id}/design-test-cases-accept`, {
        method: "POST",
        body: JSON.stringify(input)
      }),
    generateTestCases: (id: string, input: { app_type_id: string; integration_id?: string; max_cases?: number; status?: string; additional_context?: string; external_links?: string[]; images?: AiDesignImageInput[] }) =>
      request<{ generated: number; created: Array<{ id: string; title: string; step_count: number }>; integration: { id: string; name: string; type: string; model?: string | null } }>(`/requirements/${id}/generate-test-cases`, {
        method: "POST",
        body: JSON.stringify(input)
      }),
    update: (id: string, input: Partial<{ project_id: string; title: string; description: string; external_references: string[]; priority: number; status: string }>) =>
      request<{ updated: boolean }>(`/requirements/${id}`, { method: "PUT", body: JSON.stringify(input) }),
    delete: (id: string) => request<{ deleted: boolean }>(`/requirements/${id}`, { method: "DELETE" })
  },
  feedback: {
    list: (query?: { user_id?: string; status?: string }) =>
      request<Feedback[]>(`/feedback${toQueryString(query)}`),
    create: (input: { user_id: string; title: string; message: string; status?: string }) =>
      request<{ id: string }>("/feedback", { method: "POST", body: JSON.stringify(input) }),
    update: (id: string, input: Partial<{ user_id: string; title: string; message: string; status: string }>) =>
      request<{ updated: boolean }>(`/feedback/${id}`, { method: "PUT", body: JSON.stringify(input) }),
    delete: (id: string) => request<{ deleted: boolean }>(`/feedback/${id}`, { method: "DELETE" })
  },
  integrations: {
    list: (query?: { type?: Integration["type"]; is_active?: boolean }) =>
      request<Integration[]>(`/integrations${toQueryString(query)}`),
    create: (input: { type: Integration["type"]; name: string; base_url?: string; api_key?: string; model?: string; project_key?: string; username?: string; config?: Record<string, unknown>; is_active?: boolean }) =>
      request<{ id: string }>("/integrations", { method: "POST", body: JSON.stringify(input) }),
    testConnection: (input: { type: Integration["type"]; base_url?: string; api_key?: string; config?: Record<string, unknown> }) =>
      request<
        | {
            ok: boolean;
            type: "testengine";
            base_url: string;
            health_url: string;
            capabilities_url: string;
            latency_ms: number;
            service: string;
            runner: string;
            ui: string;
            control_plane: string;
            execution_scope: string;
            supported_step_types: string[];
            supported_web_engines: string[];
            qaira_result_log_compatibility?: string | null;
          }
        | {
            ok: boolean;
            type: "ops";
            base_url: string;
            health_url: string;
            events_url: string;
            board_url: string;
            latency_ms: number;
            service: string;
            events_path: string;
          }
      >("/integrations/test-connection", { method: "POST", body: JSON.stringify(input) }),
    update: (id: string, input: Partial<{ type: Integration["type"]; name: string; base_url: string; api_key: string; model: string; project_key: string; username: string; config: Record<string, unknown>; is_active: boolean }>) =>
      request<{ updated: boolean }>(`/integrations/${id}`, { method: "PUT", body: JSON.stringify(input) }),
    delete: (id: string) => request<{ deleted: boolean }>(`/integrations/${id}`, { method: "DELETE" })
  },
  requirementTestCases: {
    list: (query?: { requirement_id?: string; test_case_id?: string }) =>
      request<Array<{ requirement_id: string; test_case_id: string }>>(`/requirement-test-cases${toQueryString(query)}`),
    replace: (requirement_id: string, test_case_ids: string[]) =>
      request<{ updated: boolean; mapped: number }>(`/requirement-test-cases/replace`, {
        method: "PUT",
        body: JSON.stringify({ requirement_id, test_case_ids })
      })
  },
  testSuites: {
    list: (query?: { app_type_id?: string; parent_id?: string }) =>
      request<TestSuite[]>(`/test-suites${toQueryString(query)}`),
    create: (input: { app_type_id: string; name: string; parent_id?: string; parameter_values?: Record<string, string> }) =>
      request<{ id: string }>("/test-suites", { method: "POST", body: JSON.stringify(input) }),
    update: (id: string, input: Partial<{ name: string; parent_id: string; parameter_values: Record<string, string> }>) =>
      request<{ updated: boolean }>(`/test-suites/${id}`, { method: "PUT", body: JSON.stringify(input) }),
    assignTestCases: (id: string, test_case_ids: string[]) =>
      request<{ updated: boolean; assigned: number }>(`/test-suites/${id}/assign-test-cases`, {
        method: "POST",
        body: JSON.stringify({ test_case_ids })
      }),
    delete: (id: string) => request<{ deleted: boolean }>(`/test-suites/${id}`, { method: "DELETE" })
  },
  testCases: {
    list: (query?: { suite_id?: string; requirement_id?: string; status?: string; app_type_id?: string }) =>
      request<TestCase[]>(`/test-cases${toQueryString(query)}`),
    create: (input: { app_type_id?: string; suite_id?: string; suite_ids?: string[]; title: string; description?: string; external_references?: string[]; parameter_values?: Record<string, string>; automated?: "yes" | "no"; priority?: number; status?: string; requirement_id?: string; requirement_ids?: string[]; steps?: Array<{ step_order?: number; action?: string; expected_result?: string; step_type?: TestStep["step_type"]; automation_code?: string; api_request?: TestStep["api_request"]; group_id?: string; group_name?: string; group_kind?: "local" | "reusable"; reusable_group_id?: string }> }) =>
      request<{ id: string }>("/test-cases", { method: "POST", body: JSON.stringify(input) }),
    previewCaseAuthoring: (input: {
      app_type_id: string;
      requirement_id: string;
      integration_id?: string;
      additional_context?: string;
      test_case?: {
        title?: string;
        description?: string;
        parameter_values?: Record<string, string>;
        steps?: Array<{
          step_order?: number;
          step_type?: TestStep["step_type"];
          action?: string | null;
          expected_result?: string | null;
        }>;
      };
    }) =>
      request<AiCaseAuthoringPreviewResponse>("/test-cases/ai-authoring-preview", {
        method: "POST",
        body: JSON.stringify(input)
      }),
    rephraseStep: (input: {
      app_type_id: string;
      requirement_id?: string;
      integration_id?: string;
      additional_context?: string;
      test_case?: {
        title?: string;
        description?: string;
        parameter_values?: Record<string, string>;
      };
      step: {
        step_order?: number;
        step_type?: TestStep["step_type"];
        action?: string | null;
        expected_result?: string | null;
      };
    }) =>
      request<AiStepRephraseResponse>("/test-cases/ai-step-rephrase", {
        method: "POST",
        body: JSON.stringify(input)
      }),
    previewDesignedCases: (input: { app_type_id: string; requirement_ids: string[]; integration_id?: string; max_cases?: number; additional_context?: string; external_links?: string[]; images?: AiDesignImageInput[] }) =>
      request<AiDesignPreviewResponse>("/test-cases/design-test-cases-preview", {
        method: "POST",
        body: JSON.stringify(input)
      }),
    acceptDesignedCases: (input: { app_type_id: string; requirement_ids: string[]; status?: string; cases: Array<{ title: string; description?: string | null; priority?: number; requirement_ids?: string[]; steps?: Array<{ step_order?: number; action?: string | null; expected_result?: string | null }> }> }) =>
      request<{ accepted: number; created: Array<{ id: string; title: string; step_count: number; requirement_ids: string[] }> }>("/test-cases/design-test-cases-accept", {
        method: "POST",
        body: JSON.stringify(input)
      }),
    listGenerationJobs: (query: { app_type_id: string; status?: string }) =>
      request<AiTestCaseGenerationJob[]>(`/test-cases/ai-generation-jobs${toQueryString(query)}`),
    createGenerationJob: (input: {
      app_type_id: string;
      requirement_ids: string[];
      integration_id?: string;
      max_cases_per_requirement?: number;
      parallel_requirement_limit?: number;
      additional_context?: string;
      external_links?: string[];
      images?: AiDesignImageInput[];
    }) =>
      request<{ id: string }>("/test-cases/ai-generation-jobs", {
        method: "POST",
        body: JSON.stringify(input)
      }),
    acceptGeneratedCase: (id: string) =>
      request<{ accepted: boolean }>(`/test-cases/${id}/accept-generated`, {
        method: "POST"
      }),
    rejectGeneratedCase: (id: string) =>
      request<{ deleted: boolean }>(`/test-cases/${id}/reject-generated`, {
        method: "DELETE"
      }),
    bulkImport: (input: {
      app_type_id: string;
      requirement_id?: string;
      import_source?: TestCaseImportSourceValue;
      rows?: Array<Record<string, unknown>>;
      batches?: TestCaseImportBatchInput[];
    }) => {
      const payloads = splitTestCaseImportInput(input);

      return Promise.all(
        payloads.map((payload) =>
          request<BatchQueueResponse>("/test-cases/import", {
            method: "POST",
            body: JSON.stringify(payload)
          })
        )
      ).then((responses) => {
        const first = responses[0];

        return {
          ...first,
          transaction_ids: responses.map((response) => response.transaction_id),
          job_ids: responses.map((response) => response.job_id).filter(Boolean) as string[],
          split_count: responses.length
        };
      });
    },
    exportCases: (input: { app_type_id: string; test_case_ids?: string[] }) =>
      request<BatchQueueResponse>("/test-cases/export", {
        method: "POST",
        body: JSON.stringify(input)
      }),
    learningCache: (query?: { project_id?: string; app_type_id?: string; limit?: number }) =>
      request<AutomationLearningCacheEntry[]>(`/test-cases/automation/learning-cache${toQueryString(query)}`),
    buildAutomation: (id: string, input?: { integration_id?: string; start_url?: string; additional_context?: string; test_environment_id?: string; test_configuration_id?: string; test_data_set_id?: string; captured_actions?: unknown[]; captured_network?: unknown[] }) =>
      request<AutomationBuildResponse>(`/test-cases/${id}/automation/build`, {
        method: "POST",
        body: JSON.stringify(input || {})
      }),
    queueAutomationGenerator: (id: string, input?: { integration_id?: string; start_url?: string; additional_context?: string; test_environment_id?: string; test_configuration_id?: string; test_data_set_id?: string }) =>
      request<BatchQueueResponse>(`/test-cases/${id}/automation/generator-jobs`, {
        method: "POST",
        body: JSON.stringify(input || {})
      }),
    buildAutomationBatch: (input: { app_type_id: string; test_case_ids?: string[]; integration_id?: string; start_url?: string; additional_context?: string; test_environment_id?: string; test_configuration_id?: string; test_data_set_id?: string; failure_threshold?: number }) =>
      request<BatchQueueResponse>("/test-cases/automation/build-batch", {
        method: "POST",
        body: JSON.stringify(input)
      }),
    startRecorderSession: (id: string, input?: { start_url?: string; recorder_mode?: "local" | "remote"; engine_base_url?: string; recorder_public_base_url?: string; test_environment_id?: string; test_configuration_id?: string; test_data_set_id?: string }) =>
      request<RecorderSessionResponse>(`/test-cases/${id}/automation/recorder-session`, {
        method: "POST",
        body: JSON.stringify(input || {})
      }),
    finishRecorderSession: (id: string, sessionId: string, input?: { transaction_id?: string; integration_id?: string; additional_context?: string; recorder_mode?: "local" | "remote"; engine_base_url?: string; test_environment_id?: string; test_configuration_id?: string; test_data_set_id?: string }) =>
      request<AutomationBuildResponse & { recorder_session?: { id: string; action_count: number; network_count: number } }>(`/test-cases/${id}/automation/recorder-session/${sessionId}/finish`, {
        method: "POST",
        body: JSON.stringify(input || {})
      }),
    update: (id: string, input: Partial<{ app_type_id: string; suite_id: string; suite_ids: string[]; title: string; description: string; external_references: string[]; parameter_values: Record<string, string>; automated: "yes" | "no"; priority: number; status: string; requirement_id: string; requirement_ids: string[]; steps: Array<{ step_order?: number; action?: string; expected_result?: string; step_type?: TestStep["step_type"]; automation_code?: string; api_request?: TestStep["api_request"]; group_id?: string; group_name?: string; group_kind?: "local" | "reusable"; reusable_group_id?: string }> }>) =>
      request<{ updated: boolean }>(`/test-cases/${id}`, { method: "PUT", body: JSON.stringify(input) }),
    delete: (id: string) => request<{ deleted: boolean }>(`/test-cases/${id}`, { method: "DELETE" })
  },
  suiteTestCases: {
    list: (query?: { suite_id?: string; test_case_id?: string }) =>
      request<Array<{ suite_id: string; test_case_id: string; sort_order: number }>>(`/suite-test-cases${toQueryString(query)}`),
    reorder: (suite_id: string, test_case_ids: string[]) =>
      request<{ reordered: boolean }>(`/suite-test-cases/reorder`, {
        method: "PUT",
        body: JSON.stringify({ suite_id, test_case_ids })
      })
  },
  testSteps: {
    list: (query?: { test_case_id?: string }) =>
      request<TestStep[]>(`/test-steps${toQueryString(query)}`),
    runApiRequest: (input: { api_request: TestStep["api_request"] }) =>
      request<ApiRequestPreview>("/test-steps/run-api-request", {
        method: "POST",
        body: JSON.stringify(input)
      }),
    create: (input: { test_case_id: string; step_order: number; action?: string; expected_result?: string; step_type?: TestStep["step_type"]; automation_code?: string; api_request?: TestStep["api_request"]; group_id?: string; group_name?: string; group_kind?: "local" | "reusable"; reusable_group_id?: string }) =>
      request<{ id: string }>("/test-steps", { method: "POST", body: JSON.stringify(input) }),
    update: (id: string, input: Partial<{ test_case_id: string; step_order: number; action: string; expected_result: string; step_type: TestStep["step_type"] | null; automation_code: string; api_request: TestStep["api_request"]; group_id: string | null; group_name: string | null; group_kind: "local" | "reusable" | null; reusable_group_id: string | null }>) =>
      request<{ updated: boolean }>(`/test-steps/${id}`, { method: "PUT", body: JSON.stringify(input) }),
    reorder: (test_case_id: string, step_ids: string[]) =>
      request<{ reordered: boolean }>(`/test-steps/reorder`, {
        method: "PUT",
        body: JSON.stringify({ test_case_id, step_ids })
      }),
    duplicate: (input: { test_case_id: string; step_ids: string[]; insert_after_step_id?: string }) =>
      request<{ duplicated: boolean }>("/test-steps/duplicate", {
        method: "POST",
        body: JSON.stringify(input)
      }),
    group: (input: { test_case_id: string; step_ids: string[]; name: string; kind?: "local" | "reusable"; group_id?: string; reusable_group_id?: string }) =>
      request<{ grouped: boolean; group_id: string }>("/test-steps/group", {
        method: "POST",
        body: JSON.stringify(input)
      }),
    ungroup: (input: { test_case_id: string; group_id: string }) =>
      request<{ updated: boolean }>("/test-steps/ungroup", {
        method: "POST",
        body: JSON.stringify(input)
      }),
    insertSharedGroup: (input: { test_case_id: string; shared_step_group_id: string; insert_after_step_id?: string }) =>
      request<{ inserted: boolean }>("/test-steps/insert-shared-group", {
        method: "POST",
        body: JSON.stringify(input)
      }),
    delete: (id: string) => request<{ deleted: boolean }>(`/test-steps/${id}`, { method: "DELETE" })
  },
  sharedStepGroups: {
    list: (query?: { app_type_id?: string }) =>
      request<SharedStepGroup[]>(`/shared-step-groups${toQueryString(query)}`),
    get: (id: string) =>
      request<SharedStepGroup>(`/shared-step-groups/${id}`),
    create: (input: { app_type_id: string; name: string; description?: string; parameter_values?: Record<string, string>; steps?: Array<{ step_order?: number; action?: string; expected_result?: string; step_type?: TestStep["step_type"]; automation_code?: string; api_request?: TestStep["api_request"] }> }) =>
      request<{ id: string }>("/shared-step-groups", { method: "POST", body: JSON.stringify(input) }),
    update: (id: string, input: Partial<{ app_type_id: string; name: string; description: string; parameter_values: Record<string, string>; steps: Array<{ step_order?: number; action?: string; expected_result?: string; step_type?: TestStep["step_type"]; automation_code?: string; api_request?: TestStep["api_request"] }> }>) =>
      request<{ updated: boolean }>(`/shared-step-groups/${id}`, { method: "PUT", body: JSON.stringify(input) }),
    delete: (id: string) => request<{ deleted: boolean }>(`/shared-step-groups/${id}`, { method: "DELETE" })
  },
  testEnvironments: {
    list: (query?: { project_id?: string; app_type_id?: string }) =>
      request<TestEnvironment[]>(`/test-environments${toQueryString(query)}`),
    create: (input: { project_id: string; app_type_id?: string; name: string; description?: string; base_url?: string; variables?: KeyValueEntry[] }) =>
      request<{ id: string }>("/test-environments", { method: "POST", body: JSON.stringify(input) }),
    update: (id: string, input: Partial<{ project_id: string; app_type_id: string; name: string; description: string; base_url: string; variables: KeyValueEntry[] }>) =>
      request<{ updated: boolean }>(`/test-environments/${id}`, { method: "PUT", body: JSON.stringify(input) }),
    delete: (id: string) => request<{ deleted: boolean }>(`/test-environments/${id}`, { method: "DELETE" })
  },
  testConfigurations: {
    list: (query?: { project_id?: string; app_type_id?: string }) =>
      request<TestConfiguration[]>(`/test-configurations${toQueryString(query)}`),
    create: (input: { project_id: string; app_type_id?: string; name: string; description?: string; browser?: string; mobile_os?: string; platform_version?: string; variables?: KeyValueEntry[] }) =>
      request<{ id: string }>("/test-configurations", { method: "POST", body: JSON.stringify(input) }),
    update: (id: string, input: Partial<{ project_id: string; app_type_id: string; name: string; description: string; browser: string; mobile_os: string; platform_version: string; variables: KeyValueEntry[] }>) =>
      request<{ updated: boolean }>(`/test-configurations/${id}`, { method: "PUT", body: JSON.stringify(input) }),
    delete: (id: string) => request<{ deleted: boolean }>(`/test-configurations/${id}`, { method: "DELETE" })
  },
  testDataSets: {
    list: (query?: { project_id?: string; app_type_id?: string }) =>
      request<TestDataSet[]>(`/test-data-sets${toQueryString(query)}`),
    create: (input: { project_id: string; app_type_id?: string; name: string; description?: string; mode: TestDataSetMode; columns?: string[]; rows?: Array<Record<string, string>> }) =>
      request<{ id: string }>("/test-data-sets", { method: "POST", body: JSON.stringify(input) }),
    update: (id: string, input: Partial<{ project_id: string; app_type_id: string; name: string; description: string; mode: TestDataSetMode; columns: string[]; rows: Array<Record<string, string>> }>) =>
      request<{ updated: boolean }>(`/test-data-sets/${id}`, { method: "PUT", body: JSON.stringify(input) }),
    delete: (id: string) => request<{ deleted: boolean }>(`/test-data-sets/${id}`, { method: "DELETE" })
  },
  executions: {
    list: (query?: { project_id?: string; app_type_id?: string; status?: string }) =>
      request<Execution[]>(`/executions${toQueryString(query)}`),
    get: (id: string) =>
      request<Execution>(`/executions/${id}`),
    previewSmartPlan: (input: { project_id: string; app_type_id: string; integration_id?: string; release_scope?: string; additional_context?: string; impacted_requirement_ids?: string[]; test_environment_id?: string; test_configuration_id?: string; test_data_set_id?: string }) =>
      request<SmartExecutionPreviewResponse>("/executions/smart-plan-preview", { method: "POST", body: JSON.stringify(input) }),
    create: (input: { project_id: string; app_type_id?: string; suite_ids?: string[]; test_case_ids?: string[]; test_environment_id?: string; test_configuration_id?: string; test_data_set_id?: string; assigned_to?: string; name?: string; created_by: string }) =>
      request<{ id: string }>("/executions", { method: "POST", body: JSON.stringify(input) }),
    update: (id: string, input: { assigned_to?: string }) =>
      request<{ updated: boolean }>(`/executions/${id}`, { method: "PUT", body: JSON.stringify(input) }),
    runApiStep: (executionId: string, testCaseId: string, stepId: string) =>
      request<{
        execution_id: string;
        test_case_id: string;
        step_id: string;
        step_status: "passed" | "failed" | null;
        case_status: ExecutionResult["status"];
        execution_status: Execution["status"];
        note: string;
        detail: import("../lib/executionLogs").ExecutionStepApiDetail | null;
        captures?: Record<string, string>;
        execution_result_id: string;
        queued_for_engine?: boolean;
        job_id?: string;
        engine_run_id?: string;
        transaction_id?: string;
        active_web_engine?: "playwright" | "selenium" | string;
        live_view_url?: string | null;
      }>(`/executions/${executionId}/cases/${testCaseId}/steps/${stepId}/run`, { method: "POST" }),
    analyzeCase: (executionId: string, testCaseId: string) =>
      request<{ recorded: boolean; execution_result_id?: string; analysis?: ExecutionAiAnalysis }>(
        `/executions/${executionId}/cases/${testCaseId}/ai-analysis`,
        { method: "POST" }
      ),
    updateCaseAssignment: (executionId: string, testCaseId: string, input: { assigned_to?: string }) =>
      request<{ updated: boolean }>(`/executions/${executionId}/cases/${testCaseId}/assignment`, { method: "PUT", body: JSON.stringify(input) }),
    rerun: (id: string, input: { failed_only?: boolean; created_by: string; name?: string }) =>
      request<{ id: string }>(`/executions/${id}/rerun`, { method: "POST", body: JSON.stringify(input) }),
    start: (id: string, input?: { execution_mode?: "local" | "remote"; engine_base_url?: string }) =>
      request<ExecutionStartResponse>(`/executions/${id}/start`, { method: "POST", body: JSON.stringify(input || {}) }),
    downloadReportPdf: (id: string) => requestBlob(`/executions/${id}/report.pdf`),
    shareReport: (id: string, input: { recipients: string[] }) =>
      request<{ sent: boolean; recipients: number }>(`/executions/${id}/share-report`, {
        method: "POST",
        body: JSON.stringify(input)
      }),
    complete: (id: string, input: { status: "completed" | "failed" | "aborted" }) =>
      request<{ completed: boolean }>(`/executions/${id}/complete`, { method: "POST", body: JSON.stringify(input) }),
    delete: (id: string) => request<{ deleted: boolean }>(`/executions/${id}`, { method: "DELETE" })
  },
  executionSchedules: {
    list: (query?: { project_id?: string; app_type_id?: string; is_active?: boolean }) =>
      request<ExecutionSchedule[]>(`/execution-schedules${toQueryString(query)}`),
    get: (id: string) =>
      request<ExecutionSchedule>(`/execution-schedules/${id}`),
    create: (input: { project_id: string; app_type_id?: string; name?: string; cadence?: string; next_run_at?: string; suite_ids?: string[]; test_case_ids?: string[]; test_environment_id?: string; test_configuration_id?: string; test_data_set_id?: string; assigned_to?: string; created_by: string }) =>
      request<{ id: string }>("/execution-schedules", { method: "POST", body: JSON.stringify(input) }),
    update: (id: string, input: { project_id?: string; app_type_id?: string; name?: string; cadence?: string; next_run_at?: string; suite_ids?: string[]; test_case_ids?: string[]; test_environment_id?: string; test_configuration_id?: string; test_data_set_id?: string; assigned_to?: string }) =>
      request<{ updated: boolean }>(`/execution-schedules/${id}`, { method: "PUT", body: JSON.stringify(input) }),
    run: (id: string) =>
      request<{ id: string }>(`/execution-schedules/${id}/run`, { method: "POST" }),
    delete: (id: string) => request<{ deleted: boolean }>(`/execution-schedules/${id}`, { method: "DELETE" })
  },
  executionResults: {
    list: (query?: { execution_id?: string; test_case_id?: string; app_type_id?: string }) =>
      request<ExecutionResult[]>(`/execution-results${toQueryString(query)}`),
    create: (input: { execution_id: string; test_case_id: string; app_type_id: string; status: ExecutionResult["status"]; duration_ms?: number; error?: string; logs?: string; external_references?: string[]; defects?: string[]; executed_by?: string }) =>
      request<{ id: string }>("/execution-results", { method: "POST", body: JSON.stringify(input) }),
    update: (id: string, input: Partial<{ status: ExecutionResult["status"]; duration_ms: number; error: string; logs: string; external_references: string[]; defects: string[] }>) =>
      request<{ updated: boolean }>(`/execution-results/${id}`, { method: "PUT", body: JSON.stringify(input) }),
    delete: (id: string) => request<{ deleted: boolean }>(`/execution-results/${id}`, { method: "DELETE" })
  },
  workspaceTransactions: {
    list: (query?: { project_id?: string; app_type_id?: string; category?: string; include_global?: boolean; limit?: number }) =>
      request<WorkspaceTransaction[]>(`/workspace-transactions${toQueryString(query)}`),
    events: (id: string) =>
      request<WorkspaceTransactionEvent[]>(`/workspace-transactions/${id}/events`),
    artifacts: (id: string) =>
      request<WorkspaceTransactionArtifact[]>(`/workspace-transactions/${id}/artifacts`),
    downloadArtifact: (transactionId: string, artifactId: string) =>
      requestBlob(`/workspace-transactions/${transactionId}/artifacts/${artifactId}/download`),
    delete: (id: string) =>
      request<{ deleted: boolean }>(`/workspace-transactions/${id}`, { method: "DELETE" })
  },
  opsTelemetry: {
    clearLogs: (query?: { project_id?: string }) =>
      request<{ cleared: boolean; deleted: number; events_path: string }>(`/ops-telemetry/logs${toQueryString(query)}`, {
        method: "DELETE"
      })
  }
};

function toQueryString(query?: Record<string, string | number | boolean | undefined>) {
  if (!query) {
    return "";
  }

  const params = new URLSearchParams();

  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined && value !== "") {
      params.set(key, String(value));
    }
  });

  const serialized = params.toString();
  return serialized ? `?${serialized}` : "";
}
