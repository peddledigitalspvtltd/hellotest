import assert from "node:assert/strict";
import test from "node:test";
import { hasPermission } from "../src/lib/permissions.ts";

const session = {
  user: {
    id: "reporter",
    role: "member",
    permissions: ["feedback.manage"],
    workspace_permissions: ["workspace.view"],
    project_permissions: {
      reporter: ["feedback.view", "feedback.create", "attachment.create", "comment.create"],
      legacy: ["feedback.view", "feedback.manage"],
      restricted: []
    }
  }
};

test("Reporter Bug creation and collaboration permissions do not unlock edit/delete or administration", () => {
  for (const permission of ["feedback.create", "attachment.create", "comment.create"]) {
    assert.equal(hasPermission(session, permission, "reporter"), true);
  }
  for (const permission of ["feedback.manage", "attachment.delete", "project.delete", "role.manage", "settings.manage"]) {
    assert.equal(hasPermission(session, permission, "reporter"), false);
  }
});

test("legacy management grants retain creation only within their authorized project", () => {
  assert.equal(hasPermission(session, "feedback.create", "legacy"), true);
  assert.equal(hasPermission(session, "feedback.manage", "legacy"), true);
  assert.equal(hasPermission(session, "feedback.create", "restricted"), false);
  assert.equal(hasPermission(session, "feedback.create", "missing"), false);
  assert.equal(hasPermission({ user: { ...session.user, status: "suspended" } }, "feedback.create", "legacy"), false);
});
