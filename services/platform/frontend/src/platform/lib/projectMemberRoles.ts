import type { Role } from "../../types";

export const getAssignableProjectRoles = (roles: readonly Role[]) => roles.filter((role) =>
  role.id !== "jira-admin" && role.name.trim().toLowerCase() !== "admin"
);

export const getDefaultProjectMemberRoleId = (roles: readonly Role[]) =>
  roles.find((role) => role.id === "qa-member")?.id
  || roles.find((role) => role.name.trim().toLowerCase() === "member")?.id
  || roles[0]?.id
  || "";
