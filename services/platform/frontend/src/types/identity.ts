export type User = {
  id: string;
  email: string;
  name: string | null;
  avatar_data_url?: string | null;
  role?: "admin" | "member";
  status?: "active" | "suspended";
  role_id?: string;
  role_name?: string;
  permissions?: string[];
  workspace_permissions?: string[];
  project_permissions?: Record<string, string[]>;
  auth_provider?: "local" | "google";
  email_verified?: boolean;
  login_failed_attempts?: number;
  login_locked_until?: string | null;
  created_at?: string;
};

export type Role = {
  id: string;
  name: string;
  system?: boolean;
  permission_count?: number;
};

