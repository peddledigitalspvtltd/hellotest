exports.assertProjectRoleAssignmentAllowed = (user, role) => {
  if (role?.id === "jira-admin") {
    const error = new Error("Integration-managed administrator roles must be assigned through workspace synchronization");
    error.statusCode = 403;
    throw error;
  }
  if (String(role?.name || "").trim().toLowerCase() === "admin" && !user?.is_workspace_admin) {
    const error = new Error("The workspace administrator role cannot be assigned through project membership");
    error.statusCode = 403;
    throw error;
  }
};
