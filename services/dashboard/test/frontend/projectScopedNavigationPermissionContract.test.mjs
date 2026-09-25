import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { canAccessPath, hasAnyPermission } from "../../../platform/frontend/src/platform/lib/permissions.ts";

const readSource = (relativePath) => readFile(new URL(relativePath, import.meta.url), "utf8");

const session = {
  user: {
    id: "member-1",
    role: "member",
    workspace_permissions: ["workspace.view", "settings.view"],
    project_permissions: {
      "project-allowed": ["requirement.view", "suite.view"],
      "project-restricted": []
    }
  }
};

test("navigation permission helpers evaluate project capabilities in the active project", () => {
  assert.equal(hasAnyPermission(session, ["requirement.view"], "project-allowed"), true);
  assert.equal(hasAnyPermission(session, ["requirement.view"], "project-restricted"), false);
  assert.equal(canAccessPath(session, "/requirements", undefined, "project-allowed"), true);
  assert.equal(canAccessPath(session, "/requirements", undefined, "project-restricted"), false);

  // Workspace-global capabilities continue to use the workspace role even when
  // navigation has an active project.
  assert.equal(hasAnyPermission(session, ["settings.view"], "project-restricted"), true);
});

test("workspace route and quick-action gates pass the active project", async () => {
  const [shell, overview] = await Promise.all([
    readSource("../../../platform/frontend/src/platform/components/AppShell.tsx"),
    readSource("../../frontend/components/QualityAnalyticsDashboard.tsx")
  ]);

  assert.match(shell, /canAccessPath\(session, location\.pathname, pageAccess, sidebarProjectId\)/);
  assert.match(shell, /hasAnyPermission\(session, getNavigationItemPermissions\(item, pageAccess\), sidebarProjectId\)/);
  assert.match(overview, /canAccessPath\(session, to, undefined, projectId\)/);
});
