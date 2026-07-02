import type { SessionPayload } from "../types";

const ADMIN_ROLE = "admin";
export type PageAccessMap = Record<string, string[]>;

const MEMBER_DEFAULT_PERMISSIONS = new Set([
  "workspace.view",
  "project.view",
  "project.sync",
  "user.view",
  "role.view",
  "project_member.view",
  "requirement.view",
  "requirement.create",
  "requirement.update",
  "requirement.ai",
  "testcase.view",
  "testcase.create",
  "testcase.update",
  "testcase.export",
  "step.manage",
  "shared_step.view",
  "shared_step.manage",
  "suite.view",
  "suite.create",
  "suite.update",
  "automation.view",
  "automation.repository.manage",
  "automation.build",
  "automation.recorder",
  "automation.preview",
  "agentic_workflow.view",
  "agentic_workflow.manage",
  "agentic_workflow.run",
  "run.view",
  "run.create",
  "run.update",
  "run.execute",
  "run.report.share",
  "result.view",
  "result.manage",
  "schedule.view",
  "schedule.create",
  "schedule.update",
  "schedule.run",
  "environment.view",
  "environment.manage",
  "configuration.view",
  "configuration.manage",
  "data.view",
  "data.manage",
  "app_type.view",
  "app_type.manage",
  "integration.view",
  "knowledge.view",
  "knowledge.manage",
  "prompt_template.view",
  "transaction.view",
  "notification.view",
  "feedback.view",
  "feedback.manage",
  "ops.view"
]);

const PATH_PERMISSIONS: PageAccessMap = {
  "/": ["workspace.view"],
  "/projects": ["project.view"],
  "/admin-space": ["user.view", "role.view", "integration.view", "settings.manage"],
  "/people": ["user.view", "role.view"],
  "/integrations": ["integration.view"],
  "/requirements": ["requirement.view"],
  "/test-cases": ["testcase.view"],
  "/shared-steps": ["shared_step.view"],
  "/design": ["suite.view"],
  "/automation": ["automation.view"],
  "/object-repository": ["automation.view"],
  "/agentic-workflows": ["agentic_workflow.view"],
  "/executions": ["run.view"],
  "/testops": ["transaction.view", "ops.view"],
  "/ops-telemetry": ["ops.view"],
  "/traces": ["ops.view"],
  "/test-environments": ["environment.view"],
  "/test-configurations": ["configuration.view"],
  "/test-data": ["data.view"],
  "/knowledge-repo": ["knowledge.view"],
  "/issues": ["feedback.view"],
  "/feedback": ["feedback.view"],
  "/settings": ["settings.manage"],
  "/support": ["workspace.view"],
  "/notifications": ["notification.view"]
};

export function hasPermission(session: SessionPayload | null, permission: string) {
  if (!session?.user) {
    return false;
  }

  if (session.user.role === ADMIN_ROLE) {
    return true;
  }

  if (Array.isArray(session.user.permissions)) {
    return session.user.permissions.includes(permission);
  }

  return MEMBER_DEFAULT_PERMISSIONS.has(permission);
}

export function hasAnyPermission(session: SessionPayload | null, permissions: readonly string[]) {
  return permissions.some((permission) => hasPermission(session, permission));
}

export function requiredPermissionsForPath(pathname: string, pageAccess?: PageAccessMap | null) {
  return pageAccess?.[pathname] || PATH_PERMISSIONS[pathname] || ["workspace.view"];
}

export function canAccessPath(session: SessionPayload | null, pathname: string, pageAccess?: PageAccessMap | null) {
  return hasAnyPermission(session, requiredPermissionsForPath(pathname, pageAccess));
}
