import { resolveServiceBase } from "../src/platform/lib/serviceEndpoints";

declare global {
  interface Window {
    __HELLOTEST_CONFIG__?: {
      API_BASE_URL?: string;
      CAPABILITY_UI_URLS?: Partial<Record<import("../src/services/shared").HelloTestService, string>>;
      SERVICE_URLS?: Partial<Record<"platform" | "testing" | "knowledge" | "manual" | "dashboard" | "automation" | "agentic" | "chatbot" | "ai" | "trace" | "integration", string>>;
    };
  }
}

const runtimeApiBase = window.__HELLOTEST_CONFIG__?.API_BASE_URL;
const baseUrl = runtimeApiBase !== undefined
  ? runtimeApiBase
  : import.meta.env.VITE_API_BASE_URL || "/api";
const STORAGE_KEY = "hellotest.admin.session";

export function workspaceUrl(path = "/") {
  const runtime = window.__HELLOTEST_CONFIG__ as { API_BASE_URL?: string; WORKSPACE_BASE_URL?: string } | undefined;
  const configured = runtime?.WORKSPACE_BASE_URL || import.meta.env.VITE_WORKSPACE_BASE_URL;
  let base = new URL(window.location.origin);
  if (base.port === "8081") base.port = "8080";
  else if (base.port === "5174") base.port = "5173";
  if (configured) {
    try {
      const candidate = new URL(configured, window.location.origin);
      if (["http:", "https:"].includes(candidate.protocol) && !candidate.username && !candidate.password) base = candidate;
    } catch { /* Retain the known local/same-origin workspace location. */ }
  }
  base.search = ""; base.hash = "";
  const target = path.startsWith("/") && !path.startsWith("//") ? path : "/";
  return `${base.origin}${base.pathname.replace(/\/$/, "")}${target}`;
}

export type AdminSession = {
  token: string;
  user: {
    id: string; email: string; name?: string; username?: string; role: string;
    must_change_password?: boolean; last_login_at?: string; status?: string;
  };
};

export const sessionStore = {
  read(): AdminSession | null {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "null") as AdminSession | null; } catch { return null; }
  },
  write(session: AdminSession) { localStorage.setItem(STORAGE_KEY, JSON.stringify(session)); },
  clear() { localStorage.removeItem(STORAGE_KEY); }
};

export async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const session = sessionStore.read();
  const response = await fetch(`${resolveServiceBase(path, baseUrl)}${path}`, {
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(session?.token ? { Authorization: `Bearer ${session.token}` } : {}),
      ...options.headers
    }
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401 && !path.includes("/auth/login")) sessionStore.clear();
    throw Object.assign(new Error(body?.message || body?.error || `Request failed (${response.status})`),
      { status: response.status, code: body?.code });
  }
  return body as T;
}

// Setup work runs in a durable server job; only its short control requests need a
// client deadline. A lost response must be reconciled through status, not replayed.
async function setupRequest(path: string, options: RequestInit = {}): Promise<SampleSetupState> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  let timedOut = false;
  if (options.signal?.aborted) abort();
  else options.signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, 20000);
  try {
    const state = await request<SampleSetupState>(path, { ...options, signal: controller.signal });
    if (controller.signal.aborted) throw new DOMException('The setup request was aborted.', 'AbortError');
    if (typeof state?.running !== 'boolean' || (state.job !== null && (!state.job?.id || !Array.isArray(state.job.files)))) {
      throw new Error('The setup status response was incomplete. Reconnecting to saved progress.');
    }
    return state;
  } catch (reason) {
    if (timedOut && !options.signal?.aborted) throw new Error('The setup connection timed out. Checking the saved setup status will resume progress.');
    throw reason;
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', abort);
  }
}

export const adminApi = {
  status: () => request<Record<string, unknown>>("/admin-portal/status"),
  login: (username: string, password: string) => request<AdminSession>("/admin-portal/auth/login", { method: "POST", body: JSON.stringify({ username, password }) }),
  session: () => request<AdminSession>("/auth/session"),
  overview: () => request<Overview>("/admin-portal/overview"),
  users: () => request<User[]>("/users"),
  roles: () => request<Role[]>("/roles"),
  createAdmin: (input: { name: string; email: string; password: string; role_id: string }) => request<{ id: string }>("/admin-portal/users", { method: "POST", body: JSON.stringify(input) }),
  setUserStatus: (id: string, status: "active" | "suspended") => request(`/admin-portal/users/${id}/status`, { method: "PUT", body: JSON.stringify({ status }) }),
  applySchema: () => request<Overview["schema"]>("/admin-portal/setup/schema", { method: "POST" }),
  performanceIndexing: (options?: { signal?: AbortSignal }) => request<PerformanceIndexingState>("/admin-portal/setup/performance-indexing", { signal: options?.signal, cache: "no-store" }),
  startPerformanceIndexing: () => request<PerformanceIndexingState>("/admin-portal/setup/performance-indexing", { method: "POST" }),
  sampleCatalog: (options?: { signal?: AbortSignal }) => request<SampleCatalog>("/admin-portal/setup/sample-data", { signal: options?.signal, cache: "no-store" }),
  seedSamples: (modules: string[], options?: { signal?: AbortSignal }) => setupRequest("/admin-portal/setup/sample-data", { method: "POST", body: JSON.stringify({ modules }), signal: options?.signal }),
  sampleSetupStatus: (options?: { jobId?: string; signal?: AbortSignal }) => setupRequest(`/admin-portal/setup/sample-data/status${options?.jobId ? `?job_id=${encodeURIComponent(options.jobId)}` : ""}`, { signal: options?.signal, cache: "no-store" }),
  retrySampleSetup: (jobId: string, options?: { signal?: AbortSignal }) => setupRequest(`/admin-portal/setup/sample-data/${encodeURIComponent(jobId)}/retry`, { method: "POST", signal: options?.signal }),
  dropdownCatalog: (options?: { signal?: AbortSignal }) => request<DropdownCatalog>("/admin-portal/dropdowns", { signal: options?.signal, cache: "no-store" }),
  updateDropdown: (key: string, input: DropdownUpdate) => request<DropdownCatalog>(`/admin-portal/dropdowns/${encodeURIComponent(key)}`, { method: "PUT", body: JSON.stringify(input) }),
  flags: (options?: { signal?: AbortSignal }) => request<FlagSnapshot>("/feature-flags", { signal: options?.signal, cache: "no-store" }),
  updateFlags: (flags: Record<string, boolean>) => request<{ updated: boolean; flags: Record<string, boolean> }>("/admin-portal/feature-flags", { method: "PUT", body: JSON.stringify({ flags }) }),
  integrations: () => request<Integration[]>("/integrations"),
  integrationTypes: () => request<IntegrationType[]>("/admin-portal/integration-types"),
  createIntegration: (input: Record<string, unknown>) => request<{ id: string }>("/admin-portal/integrations", { method: "POST", body: JSON.stringify(input) }),
  deleteIntegration: (id: string) => request(`/admin-portal/integrations/${id}`, { method: "DELETE" }),
  audit: () => request<AuditEvent[]>("/admin-portal/audit?limit=100"),
  changePassword: (_id: string, current_password: string, new_password: string) => request("/admin-portal/security/password", { method: "PUT", body: JSON.stringify({ current_password, new_password }) })
};

export type Overview = {
  status: string;
  schema: { status: string; required_tables: number; available_tables: number; missing_tables: string[] };
  metrics: Record<string, number>;
  runtime: Record<string, string | number | boolean>;
};
export type PerformanceIndexingState = {
  running: boolean;
  catalog: Array<{ name: string; label: string }>;
  job: null | {
    id: string; status: 'running' | 'completed' | 'partial' | 'failed' | 'interrupted';
    started_at: string; finished_at: string | null; completed: number; error?: string;
    indexes: Array<{ name: string; label: string; status: 'pending' | 'running' | 'created' | 'existing' | 'failed'; error?: string; existing_name?: string }>;
  };
};
export type User = { id: string; name?: string; email: string; role: string; role_id?: string; role_name?: string; status?: string; created_at: string; last_login_at?: string };
export type Role = { id: string; name: string };
export type DropdownOption = { value: string; label: string; description: string; active: boolean; builtin: boolean };
export type DropdownField = {
  key: string; label: string; group: string; description: string;
  kind: "configurable" | "suggestions" | "system" | "records";
  value_format: "text" | "slug" | "integer"; can_add: boolean; can_edit: boolean; required: boolean;
  supports_default?: boolean; usage: Array<{ label: string; path: string }>; options: DropdownOption[];
  default_value: string | null; reason?: string; manage_path?: string;
};
export type DropdownCatalog = { revision: number; updated_at: string | null; fields: DropdownField[] };
export type DropdownUpdate = { expected_revision: number; options: Array<{ value: string; label: string; description?: string; active: boolean }>; default_value?: string | null };
export type SampleModule = { key: string; label: string; group: string; description: string; tables: string[]; features: string[]; depends_on: string[]; routes: string[]; feature_keys: string[]; available: boolean; record_count: number; expected_record_count: number; status: 'installed' | 'partial' | 'not_installed' };
export type SetupRole = { key: string; name: string; description: string; permission_codes: string[]; current_permission_codes: string[]; role_id: string | null; status: 'not_installed' | 'installed' | 'customized' };
export type SetupRoleResult = { created: Array<{ id: string; name: string }>; retained: Array<{ id: string; name: string }> };
export type SampleCatalog = { version: number; project_id: string | null; project_name: string; description: string; notes: string[]; modules: SampleModule[]; roles?: SetupRole[]; dataset?: { id: string; version: number; authored_at: string; manifest_hash: string; file_count: number; source: 'repository' }; blueprint?: { title: string; story_count: number; backlog_count: number; sprint_count: number; release_count: number }; workspace?: { description: string; applications: Array<{ id: string; name: string; type: string; is_unified: boolean }>; member_count: number; membership: string } };
export type SampleInstallResult = { version: number; requested: string[]; installed: string[]; dependencies_added: string[]; project_id: string | null; administrator_memberships: number; roles?: SetupRoleResult; idempotent: boolean; inserted_records: number; existing_records: number; module_results: Array<{ key: string; inserted_records: number; existing_records: number; total_records: number }> };
export type SampleSetupFile = {
  key: string; path: string; module: string; status: 'pending' | 'running' | 'retrying' | 'completed' | 'failed';
  attempts: number; inserted_records?: number; existing_records?: number; total_records?: number; error?: string | null;
};
export type SampleSetupJob = {
  id: string; status: 'queued' | 'running' | 'completed' | 'failed'; phase: 'validating' | 'installing' | 'verifying';
  requested_modules: string[]; installed_modules: string[]; dataset_version: number; manifest_hash: string;
  files: SampleSetupFile[]; current_file: string | null; total_files: number; completed_files: number; attempts: number;
  error: { code: string; message: string; file?: string; retryable: boolean } | null; result: SampleInstallResult | null;
  created_at: string; started_at: string | null; finished_at: string | null; updated_at: string;
};
export type SampleSetupState = { running: boolean; job: SampleSetupJob | null };

export type FlagSnapshot = {
  capability_availability?: Record<string, boolean>;
  groups: Array<{
    key: string;
    label: string;
    description: string;
    features: Array<{
      key: string;
      label: string;
      description?: string;
      permissions?: string[];
      routes?: string[];
      default_enabled?: boolean;
    }>;
  }>;
  flags: Record<string, boolean>;
  local_flags?: Record<string, boolean>;
  dependencies?: Record<string, string[]>;
  optional_dependencies?: Record<string, string[]>;
  permission_features?: Record<string, string[]>;
};
export type Integration = { id: string; type: string; name: string; base_url?: string; model?: string; is_active: boolean; updated_at: string };
export type IntegrationType = { value: string; label: string; description: string; defaults?: Record<string, unknown> };
export type AuditEvent = { id: string; action: string; summary: string; target_type?: string; actor_name?: string; actor_email?: string; created_at: string };
