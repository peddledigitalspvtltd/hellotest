declare global {
  interface Window { __HELLOTEST_CONFIG__?: { API_BASE_URL?: string } }
}

const runtimeApiBase = window.__HELLOTEST_CONFIG__?.API_BASE_URL;
const baseUrl = runtimeApiBase !== undefined
  ? runtimeApiBase
  : import.meta.env.VITE_API_BASE_URL || "/api";
const STORAGE_KEY = "hellotest.admin.session";

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
  const response = await fetch(`${baseUrl}${path}`, {
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
    throw new Error(body?.message || body?.error || `Request failed (${response.status})`);
  }
  return body as T;
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
  sampleCatalog: () => request<SampleCatalog>("/admin-portal/setup/sample-data"),
  seedSamples: (modules: string[]) => request<{ installed: string[]; project_id: string; administrator_memberships: number }>("/admin-portal/setup/sample-data", { method: "POST", body: JSON.stringify({ modules }) }),
  flags: () => request<FlagSnapshot>("/feature-flags"),
  updateFlags: (flags: Record<string, boolean>) => request("/admin-portal/feature-flags", { method: "PUT", body: JSON.stringify({ flags }) }),
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
export type User = { id: string; name?: string; email: string; role: string; role_id?: string; role_name?: string; status?: string; created_at: string; last_login_at?: string };
export type Role = { id: string; name: string };
export type SampleCatalog = { project_id: string | null; modules: Array<{ key: string; label: string; description: string; tables: string[] }> };
export type FlagSnapshot = {
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
};
export type Integration = { id: string; type: string; name: string; base_url?: string; model?: string; is_active: boolean; updated_at: string };
export type IntegrationType = { value: string; label: string; description: string; defaults?: Record<string, unknown> };
export type AuditEvent = { id: string; action: string; summary: string; target_type?: string; actor_name?: string; actor_email?: string; created_at: string };
