import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { AddIcon, ClearSelectionIcon, ExportIcon, ImportIcon, SelectAllIcon, TrashIcon, UsersIcon } from "../components/AppIcons";
import { api } from "../lib/api";
import { CatalogSearchFilter } from "../components/CatalogSearchFilter";
import { CatalogViewToggle } from "../components/CatalogViewToggle";
import { DataTable, type DataTableColumn } from "../components/DataTable";
import { FormField } from "../components/FormField";
import { InfoTooltip } from "../components/InfoTooltip";
import { PageHeader } from "../components/PageHeader";
import { Panel } from "../components/Panel";
import { SubnavTabs } from "../components/SubnavTabs";
import { TileCardSkeletonGrid } from "../components/TileCardSkeletonGrid";
import { TileCardFact, TileCardIconFrame, TileCardStatusIndicator, TileCardUsersIcon } from "../components/TileCardPrimitives";
import { ToastMessage } from "../components/ToastMessage";
import { WorkspaceBackButton, WorkspaceMasterDetail } from "../components/WorkspaceMasterDetail";
import { useDeleteConfirmation } from "../components/DeleteConfirmationDialog";
import { useAuth } from "../auth/AuthContext";
import { useWorkspaceData } from "../hooks/useWorkspaceData";
import { hasPermission } from "../lib/permissions";
import { parseUserCsv, type ImportedUserRow } from "../lib/userImport";
import { resolveVisibleEmail } from "../lib/userDisplay";
import { readDefaultCatalogViewMode } from "../lib/viewPreferences";
import type { PermissionGroup, Role, User } from "../types";

type PeopleView = "users" | "roles";
type FeedbackTone = "success" | "error";

const createEmptyUserDraft = (roleId = "") => ({ name: "", email: "", password_hash: "", role_id: roleId });
const EMPTY_ROLE_DRAFT = { name: "" };
const formatPermissionLabel = (code: string) =>
  code
    .split(".")
    .map((part) => part.replace(/_/g, " "))
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" / ");

export function PeoplePage({
  forcedView,
  embedded = false
}: {
  forcedView?: PeopleView;
  embedded?: boolean;
} = {}) {
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const { session } = useAuth();
  const { confirmDelete, confirmationDialog } = useDeleteConfirmation();
  const { users, roles } = useWorkspaceData();
  const permissions = useQuery({
    queryKey: ["permissions"],
    queryFn: api.roles.permissions,
    enabled: Boolean(session)
  });
  const [feedback, setFeedback] = useState<{ message: string; tone: FeedbackTone } | null>(null);
  const [view, setView] = useState<PeopleView>(forcedView || (searchParams.get("view") === "roles" ? "roles" : "users"));
  const [selectedUserId, setSelectedUserId] = useState("");
  const [selectedRoleId, setSelectedRoleId] = useState("");
  const [userDraft, setUserDraft] = useState(createEmptyUserDraft());
  const [roleDraft, setRoleDraft] = useState(EMPTY_ROLE_DRAFT);
  const [rolePermissionDraft, setRolePermissionDraft] = useState<string[]>([]);
  const [createRolePermissionDraft, setCreateRolePermissionDraft] = useState<string[]>([]);
  const [isCreateUserModalOpen, setIsCreateUserModalOpen] = useState(false);
  const [isCreateRoleModalOpen, setIsCreateRoleModalOpen] = useState(false);
  const [isCreateRolePermissionExpanded, setIsCreateRolePermissionExpanded] = useState(false);
  const [activeCreateRolePermissionGroup, setActiveCreateRolePermissionGroup] = useState("");
  const [activeEditRolePermissionGroup, setActiveEditRolePermissionGroup] = useState("");
  const [isImportUsersModalOpen, setIsImportUsersModalOpen] = useState(false);
  const [userCatalogViewMode, setUserCatalogViewMode] = useState<"tile" | "list">(() => readDefaultCatalogViewMode());
  const [roleCatalogViewMode, setRoleCatalogViewMode] = useState<"tile" | "list">(() => readDefaultCatalogViewMode());
  const [selectedActionUserIds, setSelectedActionUserIds] = useState<string[]>([]);
  const [selectedActionRoleIds, setSelectedActionRoleIds] = useState<string[]>([]);
  const [userSearch, setUserSearch] = useState("");
  const [roleSearch, setRoleSearch] = useState("");
  const [createUserDraft, setCreateUserDraft] = useState(createEmptyUserDraft());
  const [createRoleDraft, setCreateRoleDraft] = useState(EMPTY_ROLE_DRAFT);
  const [importUsersDefaultRoleId, setImportUsersDefaultRoleId] = useState("");
  const [importUsersFileName, setImportUsersFileName] = useState("");
  const [importUserRows, setImportUserRows] = useState<ImportedUserRow[]>([]);
  const [importUserWarnings, setImportUserWarnings] = useState<string[]>([]);
  const selectedRolePermissions = useQuery({
    queryKey: ["roles", selectedRoleId, "permissions"],
    queryFn: () => api.roles.rolePermissions(selectedRoleId),
    enabled: Boolean(session && selectedRoleId)
  });

  const userItems = users.data || [];
  const roleItems = roles.data || [];
  const isUserCatalogLoading = users.isPending;
  const isRoleCatalogLoading = roles.isPending || users.isPending;
  const selectedUser = useMemo(
    () => userItems.find((item) => item.id === selectedUserId) || null,
    [selectedUserId, userItems]
  );
  const selectedRole = useMemo(
    () => roleItems.find((item) => item.id === selectedRoleId) || null,
    [selectedRoleId, roleItems]
  );
  const isAdmin = session?.user.role === "admin";
  const canManageUsers = hasPermission(session, "user.manage");
  const visibleUserEmail = (email?: string | null) => resolveVisibleEmail(email, canManageUsers);
  const permissionGroups = permissions.data || [];
  const allPermissionCodes = useMemo(
    () => permissionGroups.flatMap((group) => group.permissions.map((permission) => permission.code)),
    [permissionGroups]
  );
  const memberDefaultPermissionCodes = useMemo(
    () => allPermissionCodes.filter((code) => ![
      "project.delete",
      "settings.manage",
      "user.manage",
      "role.manage",
      "project_member.manage",
      "requirement.delete",
      "testcase.delete",
      "suite.delete",
      "run.delete",
      "schedule.delete",
      "integration.manage",
      "transaction.manage",
      "ops.manage"
    ].includes(code)),
    [allPermissionCodes]
  );
  const defaultMemberRoleId = useMemo(
    () => roleItems.find((item) => item.name === "member")?.id || roleItems[0]?.id || "",
    [roleItems]
  );
  const userCountByRoleName = useMemo(
    () =>
      userItems.reduce<Record<string, number>>((counts, user) => {
        const roleName = user.role || "member";
        counts[roleName] = (counts[roleName] || 0) + 1;
        return counts;
      }, {}),
    [userItems]
  );
  const filteredUserItems = useMemo(() => {
    const normalizedSearch = userSearch.trim().toLowerCase();

    if (!normalizedSearch) {
      return userItems;
    }

    return userItems.filter((user) =>
      [user.id, user.name, visibleUserEmail(user.email), user.role]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(normalizedSearch)
    );
  }, [userItems, userSearch, visibleUserEmail]);
  const filteredRoleItems = useMemo(() => {
    const normalizedSearch = roleSearch.trim().toLowerCase();

    if (!normalizedSearch) {
      return roleItems;
    }

    return roleItems.filter((role) =>
      [role.id, role.name, `${userCountByRoleName[role.name] || 0} assigned`]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(normalizedSearch)
    );
  }, [roleItems, roleSearch, userCountByRoleName]);
  const visibleUserIds = useMemo(() => filteredUserItems.map((user) => user.id), [filteredUserItems]);
  const visibleRoleIds = useMemo(() => filteredRoleItems.map((role) => role.id), [filteredRoleItems]);
  const areAllFilteredUsersSelected = visibleUserIds.length > 0 && visibleUserIds.every((id) => selectedActionUserIds.includes(id));
  const areAllFilteredRolesSelected = visibleRoleIds.length > 0 && visibleRoleIds.every((id) => selectedActionRoleIds.includes(id));
  const userListColumns = useMemo<Array<DataTableColumn<User>>>(() => [
    {
      key: "name",
      label: "User",
      canToggle: false,
      width: 260,
      minWidth: 180,
      sortValue: (user) => user.name || visibleUserEmail(user.email),
      render: (user) => (
        <div className="data-table-multiline">
          <strong>{user.name || "Unnamed user"}</strong>
          <span className="data-table-multiline-line">{visibleUserEmail(user.email)}</span>
        </div>
      )
    },
    {
      key: "role",
      label: "Role",
      width: 140,
      minWidth: 110,
      sortValue: (user) => user.role || "member",
      render: (user) => user.role === "admin" ? "Org Admin" : "Member"
    },
    {
      key: "email",
      label: "Email",
      defaultVisible: false,
      width: 260,
      minWidth: 160,
      render: (user) => visibleUserEmail(user.email)
    }
  ], [visibleUserEmail]);
  const roleListColumns = useMemo<Array<DataTableColumn<Role>>>(() => [
    {
      key: "role",
      label: "Role",
      canToggle: false,
      width: 240,
      minWidth: 160,
      sortValue: (role) => role.name,
      render: (role) => <strong>{role.name}</strong>
    },
    {
      key: "assigned",
      label: "Assigned users",
      width: 150,
      minWidth: 120,
      sortValue: (role) => userCountByRoleName[role.name] || 0,
      render: (role) => userCountByRoleName[role.name] || 0
    }
  ], [userCountByRoleName]);
  const importUsersPasswordCount = useMemo(
    () => importUserRows.filter((row) => row.password || row.password_hash).length,
    [importUserRows]
  );
  const importUsersExplicitRoleCount = useMemo(
    () => importUserRows.filter((row) => row.role || row.role_id).length,
    [importUserRows]
  );

  useEffect(() => {
    if (selectedUser) {
      const matchedRole = roleItems.find((item) => item.name === selectedUser.role);
      setUserDraft({
        name: selectedUser.name || "",
        email: selectedUser.email,
        password_hash: "",
        role_id: matchedRole?.id || defaultMemberRoleId
      });
      return;
    }

    setUserDraft(createEmptyUserDraft(defaultMemberRoleId));
  }, [defaultMemberRoleId, roleItems, selectedUser]);

  useEffect(() => {
    if (selectedRole) {
      setRoleDraft({ name: selectedRole.name });
      return;
    }

    setRoleDraft(EMPTY_ROLE_DRAFT);
  }, [selectedRole]);

  useEffect(() => {
    setRolePermissionDraft((selectedRolePermissions.data || []).map((permission) => permission.code));
  }, [selectedRolePermissions.data]);

  useEffect(() => {
    setActiveEditRolePermissionGroup("");
  }, [selectedRoleId]);

  useEffect(() => {
    if (forcedView) {
      if (view !== forcedView) {
        setView(forcedView);
      }
      return;
    }

    const requestedView = searchParams.get("view");
    if ((requestedView === "users" || requestedView === "roles") && requestedView !== view) {
      setView(requestedView);
    }
  }, [forcedView, searchParams, view]);

  useEffect(() => {
    if (view !== "users") {
      return;
    }

    const requestedUserId = searchParams.get("userId") || "";

    if (!requestedUserId) {
      if (selectedUserId) {
        setSelectedUserId("");
      }
      return;
    }

    if (requestedUserId === selectedUserId) {
      return;
    }

    if (userItems.some((item) => item.id === requestedUserId)) {
      setSelectedUserId(requestedUserId);
    }
  }, [searchParams, selectedUserId, userItems, view]);

  useEffect(() => {
    if (view !== "roles") {
      return;
    }

    const requestedRoleId = searchParams.get("roleId") || "";

    if (!requestedRoleId) {
      if (selectedRoleId) {
        setSelectedRoleId("");
      }
      return;
    }

    if (requestedRoleId === selectedRoleId) {
      return;
    }

    if (roleItems.some((item) => item.id === requestedRoleId)) {
      setSelectedRoleId(requestedRoleId);
    }
  }, [roleItems, searchParams, selectedRoleId, view]);

  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["users"] }),
      queryClient.invalidateQueries({ queryKey: ["roles"] }),
      queryClient.invalidateQueries({ queryKey: ["permissions"] })
    ]);
  };

  const showFeedback = (message: string, tone: FeedbackTone) => {
    setFeedback({ message, tone });
  };

  const syncPeopleSearchParams = (nextView: PeopleView, nextUserId?: string | null, nextRoleId?: string | null) => {
    const nextParams = new URLSearchParams(searchParams);
    nextParams.set("view", nextView);

    if (nextView === "users") {
      if (nextUserId) {
        nextParams.set("userId", nextUserId);
      } else {
        nextParams.delete("userId");
      }
      nextParams.delete("roleId");
    } else {
      if (nextRoleId) {
        nextParams.set("roleId", nextRoleId);
      } else {
        nextParams.delete("roleId");
      }
      nextParams.delete("userId");
    }

    if (nextParams.toString() !== searchParams.toString()) {
      setSearchParams(nextParams, { replace: true });
    }
  };

  const openUserWorkspace = (userId: string) => {
    setView("users");
    setSelectedRoleId("");
    setSelectedUserId(userId);
    syncPeopleSearchParams("users", userId, null);
  };

  const openRoleWorkspace = (roleId: string) => {
    setView("roles");
    setSelectedUserId("");
    setSelectedRoleId(roleId);
    setActiveEditRolePermissionGroup("");
    syncPeopleSearchParams("roles", null, roleId);
  };

  const handleViewChange = (nextView: PeopleView) => {
    setView(nextView);

    if (nextView === "users") {
      setSelectedRoleId("");
      syncPeopleSearchParams("users", selectedUserId || null, null);
      return;
    }

    setSelectedUserId("");
    syncPeopleSearchParams("roles", null, selectedRoleId || null);
  };

  const openCreateUserModal = () => {
    setCreateUserDraft(createEmptyUserDraft(defaultMemberRoleId));
    setIsCreateUserModalOpen(true);
  };

  const closeCreateUserModal = () => {
    if (createUser.isPending) {
      return;
    }

    setIsCreateUserModalOpen(false);
    setCreateUserDraft(createEmptyUserDraft(defaultMemberRoleId));
  };

  const openCreateRoleModal = () => {
    setCreateRoleDraft(EMPTY_ROLE_DRAFT);
    setCreateRolePermissionDraft(memberDefaultPermissionCodes);
    setIsCreateRolePermissionExpanded(false);
    setActiveCreateRolePermissionGroup("");
    setIsCreateRoleModalOpen(true);
  };

  const closeCreateRoleModal = () => {
    if (createRole.isPending) {
      return;
    }

    setIsCreateRoleModalOpen(false);
    setIsCreateRolePermissionExpanded(false);
    setActiveCreateRolePermissionGroup("");
    setCreateRoleDraft(EMPTY_ROLE_DRAFT);
    setCreateRolePermissionDraft(memberDefaultPermissionCodes);
  };

  const openImportUsersModal = () => {
    setImportUsersDefaultRoleId(defaultMemberRoleId);
    setImportUsersFileName("");
    setImportUserRows([]);
    setImportUserWarnings([]);
    setIsImportUsersModalOpen(true);
  };

  const closeImportUsersModal = (force = false) => {
    if (importUsers.isPending && !force) {
      return;
    }

    setIsImportUsersModalOpen(false);
    setImportUsersDefaultRoleId(defaultMemberRoleId);
    setImportUsersFileName("");
    setImportUserRows([]);
    setImportUserWarnings([]);
  };

  const createUser = useMutation({
    mutationFn: api.users.create,
    onSuccess: async (response) => {
      showFeedback("User created.", "success");
      openUserWorkspace(response.id);
      setIsCreateUserModalOpen(false);
      setCreateUserDraft(createEmptyUserDraft(defaultMemberRoleId));
      await invalidate();
    },
    onError: (error) => showFeedback(error instanceof Error ? error.message : "Unable to create user", "error")
  });

  const updateUser = useMutation({
    mutationFn: ({ id, input }: { id: string; input: Partial<{ email: string; password: string; name: string; role_id: string }> }) =>
      api.users.update(id, input),
    onSuccess: async () => {
      showFeedback("User updated.", "success");
      await invalidate();
    },
    onError: (error) => showFeedback(error instanceof Error ? error.message : "Unable to update user", "error")
  });

  const importUsers = useMutation({
    mutationFn: api.users.bulkImport,
    onSuccess: async (response) => {
      showFeedback(
        `User import queued. Track progress in TestOps batch process ${response.transaction_id.slice(0, 8)}.`,
        "success"
      );
      closeImportUsersModal(true);
      await invalidate();
    },
    onError: (error) => showFeedback(error instanceof Error ? error.message : "Unable to import users", "error")
  });

  const deleteUser = useMutation({
    mutationFn: api.users.delete,
    onSuccess: async () => {
      showFeedback("User removed.", "success");
      setSelectedUserId("");
      syncPeopleSearchParams("users", null, null);
      await invalidate();
    },
    onError: (error) => showFeedback(error instanceof Error ? error.message : "Unable to delete user", "error")
  });

  const createRole = useMutation({
    mutationFn: api.roles.create,
    onSuccess: async (response) => {
      showFeedback("Role created.", "success");
      openRoleWorkspace(response.id);
      setIsCreateRoleModalOpen(false);
      setIsCreateRolePermissionExpanded(false);
      setActiveCreateRolePermissionGroup("");
      setCreateRoleDraft(EMPTY_ROLE_DRAFT);
      await invalidate();
    },
    onError: (error) => showFeedback(error instanceof Error ? error.message : "Unable to create role", "error")
  });

  const updateRole = useMutation({
    mutationFn: ({ id, input }: { id: string; input: { name: string; permission_codes?: string[] } }) => api.roles.update(id, input),
    onSuccess: async () => {
      showFeedback("Role updated.", "success");
      await invalidate();
    },
    onError: (error) => showFeedback(error instanceof Error ? error.message : "Unable to update role", "error")
  });

  const deleteRole = useMutation({
    mutationFn: api.roles.delete,
    onSuccess: async () => {
      showFeedback("Role removed.", "success");
      setSelectedRoleId("");
      syncPeopleSearchParams("roles", null, null);
      await invalidate();
    },
    onError: (error) => showFeedback(error instanceof Error ? error.message : "Unable to delete role", "error")
  });

  const replaceRolePermissions = useMutation({
    mutationFn: ({ id, permissionCodes }: { id: string; permissionCodes: string[] }) =>
      api.roles.replacePermissions(id, permissionCodes),
    onSuccess: async () => {
      showFeedback("Role permissions updated.", "success");
      await queryClient.invalidateQueries({ queryKey: ["roles", selectedRoleId, "permissions"] });
    },
    onError: (error) => showFeedback(error instanceof Error ? error.message : "Unable to update role permissions", "error")
  });

  const handleUserCreate = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    createUser.mutate({
      email: createUserDraft.email,
      password: createUserDraft.password_hash,
      name: createUserDraft.name,
      role_id: createUserDraft.role_id || defaultMemberRoleId
    });
  };

  const handleRoleCreate = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    createRole.mutate({ name: createRoleDraft.name, permission_codes: createRolePermissionDraft });
  };

  const togglePermission = (code: string, target: "create" | "edit") => {
    const setter = target === "create" ? setCreateRolePermissionDraft : setRolePermissionDraft;
    setter((current) => current.includes(code) ? current.filter((item) => item !== code) : [...current, code].sort());
  };

  const setPermissionGroup = (group: PermissionGroup, checked: boolean, target: "create" | "edit") => {
    const groupCodes = group.permissions.map((permission) => permission.code);
    const setter = target === "create" ? setCreateRolePermissionDraft : setRolePermissionDraft;

    setter((current) => {
      const next = new Set(current);
      for (const code of groupCodes) {
        if (checked) {
          next.add(code);
        } else {
          next.delete(code);
        }
      }
      return [...next].sort();
    });
  };

  const renderPermissionMatrix = (selectedCodes: string[], target: "create" | "edit") => {
    const selectedSet = new Set(selectedCodes);
    const selectedPermissions = permissionGroups.flatMap((group) =>
      group.permissions
        .filter((permission) => selectedSet.has(permission.code))
        .map((permission) => ({ ...permission, groupLabel: group.label }))
    );
    const availablePermissions = permissionGroups.flatMap((group) =>
      group.permissions
        .filter((permission) => !selectedSet.has(permission.code))
        .map((permission) => ({ ...permission, groupLabel: group.label }))
    );

    const setAllPermissions = (checked: boolean) => {
      const setter = target === "create" ? setCreateRolePermissionDraft : setRolePermissionDraft;
      setter(checked ? allPermissionCodes : []);
    };

    const totalPermissionCount = permissionGroups.reduce((total, group) => total + group.permissions.length, 0);
    const selectedPercent = totalPermissionCount ? Math.round((selectedPermissions.length / totalPermissionCount) * 100) : 0;
    const activeGroupKey = target === "create"
      ? activeCreateRolePermissionGroup
      : activeEditRolePermissionGroup;
    const setActiveGroupKey = target === "create" ? setActiveCreateRolePermissionGroup : setActiveEditRolePermissionGroup;

    return (
      <div className="permission-designer">
        <div className={target === "create" ? "permission-designer-summary permission-designer-summary--create-role" : "permission-designer-summary"}>
          {target === "create" ? (
            <div className="permission-create-role-inline">
              <FormField label="Role name" required>
                <input
                  autoFocus
                  name="name"
                  placeholder="qa-manager"
                  value={createRoleDraft.name}
                  onChange={(event) => setCreateRoleDraft({ name: event.target.value })}
                />
              </FormField>
              <div className="detail-summary permission-create-role-default-copy">
                <strong>Default permissions</strong>
                <span>Member-safe permissions are selected by default. Adjust the list below before creating the role.</span>
              </div>
            </div>
          ) : null}
          <div className="permission-designer-counts">
            <strong>{selectedPermissions.length} selected</strong>
            <span>{availablePermissions.length} available to add</span>
          </div>
          <div className="permission-designer-actions">
            <button className="ghost-button compact-button" onClick={() => setAllPermissions(true)} type="button">
              Add All
            </button>
            <button className="ghost-button compact-button danger" onClick={() => setAllPermissions(false)} type="button">
              Clear
            </button>
          </div>
        </div>
        <div className="permission-designer-progress">
          <strong>{selectedPermissions.length} of {totalPermissionCount} permissions selected</strong>
          <span aria-hidden="true"><i style={{ width: `${selectedPercent}%` }} /></span>
        </div>

        <div className="permission-group-strip permission-group-strip--accordion">
          {permissionGroups.map((group) => {
            const groupCodes = group.permissions.map((permission) => permission.code);
            const selectedCount = groupCodes.filter((code) => selectedCodes.includes(code)).length;
            const isAllSelected = selectedCount === groupCodes.length && groupCodes.length > 0;
            const isExpanded = group.key === activeGroupKey;

            return (
              <section className={isExpanded ? "permission-group-card is-expanded" : "permission-group-card is-collapsed"} key={group.key}>
                <div className="permission-group-head">
                  <button
                    aria-expanded={isExpanded}
                    className="permission-group-expand-button"
                    onClick={() => setActiveGroupKey((current) => current === group.key ? "" : group.key)}
                    type="button"
                  >
                    <span aria-hidden="true" className="permission-group-chevron">{isExpanded ? "-" : "+"}</span>
                    <span className="permission-group-copy">
                      <strong>{group.label}</strong>
                      <span>{selectedCount} of {groupCodes.length} selected</span>
                    </span>
                  </button>
                  <label className="permission-toggle-all">
                    <input
                      checked={isAllSelected}
                      onChange={(event) => setPermissionGroup(group, event.target.checked, target)}
                      type="checkbox"
                    />
                    <span>All</span>
                  </label>
                </div>
                {isExpanded ? (
                  <div className="permission-option-list">
                    {group.permissions.map((permission) => (
                      <label className="permission-option" key={permission.code}>
                        <input
                          checked={selectedCodes.includes(permission.code)}
                          onChange={() => togglePermission(permission.code, target)}
                          type="checkbox"
                        />
                        <span className="permission-option-copy">
                          <strong className="permission-option-title">{formatPermissionLabel(permission.code)}</strong>
                          <code className="permission-option-code">{permission.code}</code>
                          {permission.description ? <small className="permission-option-description">{permission.description}</small> : null}
                        </span>
                      </label>
                    ))}
                  </div>
                ) : null}
              </section>
            );
          })}
        </div>
      </div>
    );
  };

  const confirmDeleteUser = async (user: User) => {
    const warning =
      user.id === session?.user.id
        ? "This will remove your own workspace access."
        : "This removes the user from the workspace directory.";

    if (!(await confirmDelete({ message: `Delete user "${user.name || user.email}"? ${warning}` }))) {
      return;
    }

    deleteUser.mutate(user.id);
  };

  const confirmDeleteRole = async (role: Role) => {
    if (!(await confirmDelete({ message: `Delete role "${role.name}"? Users currently assigned to this role may need reassignment first.` }))) {
      return;
    }

    deleteRole.mutate(role.id);
  };

  useEffect(() => {
    if (!isCreateUserModalOpen) {
      return;
    }

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !createUser.isPending) {
        closeCreateUserModal();
      }
    };

    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [createUser.isPending, isCreateUserModalOpen]);

  useEffect(() => {
    if (!isCreateRoleModalOpen) {
      return;
    }

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !createRole.isPending) {
        closeCreateRoleModal();
      }
    };

    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [createRole.isPending, isCreateRoleModalOpen]);

  useEffect(() => {
    if (!isImportUsersModalOpen) {
      return;
    }

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !importUsers.isPending) {
        closeImportUsersModal();
      }
    };

    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [importUsers.isPending, isImportUsersModalOpen]);

  const closeUserWorkspace = () => {
    setSelectedUserId("");
    setUserDraft(createEmptyUserDraft(defaultMemberRoleId));
    syncPeopleSearchParams("users", null, null);
  };

  const closeRoleWorkspace = () => {
    setSelectedRoleId("");
    setRoleDraft(EMPTY_ROLE_DRAFT);
    syncPeopleSearchParams("roles", null, null);
  };

  const handleImportUsersFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    try {
      const parsed = parseUserCsv(await file.text());
      setImportUsersFileName(file.name);
      setImportUserRows(parsed.rows);
      setImportUserWarnings(parsed.warnings);
    } catch (error) {
      showFeedback(error instanceof Error ? error.message : "Unable to read the CSV file", "error");
    } finally {
      event.target.value = "";
    }
  };

  const handleBulkImportUsers = async () => {
    if (!importUserRows.length) {
      return;
    }

    try {
      await importUsers.mutateAsync({
        rows: importUserRows,
        default_role_id: importUsersDefaultRoleId || undefined
      });
    } catch {
      // handled in mutation callbacks
    }
  };

  const downloadJsonFile = (filename: string, value: unknown) => {
    const blob = new Blob([JSON.stringify(value, null, 2)], { type: "application/json" });
    const url = window.URL.createObjectURL(blob);
    const anchor = document.createElement("a");

    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.URL.revokeObjectURL(url);
  };

  const handleExportUsers = () => {
    downloadJsonFile(`qaira-users-${new Date().toISOString().slice(0, 10)}.json`, {
      exported_at: new Date().toISOString(),
      users: userItems.map((user) => ({
        id: user.id,
        name: user.name,
        email: user.email,
        visible_email: visibleUserEmail(user.email),
        role: user.role
      }))
    });
  };

  const handleExportRoles = () => {
    downloadJsonFile(`qaira-roles-${new Date().toISOString().slice(0, 10)}.json`, {
      exported_at: new Date().toISOString(),
      roles: roleItems.map((role) => ({
        id: role.id,
        name: role.name,
        assigned_users: userCountByRoleName[role.name] || 0
      }))
    });
  };

  const handleDeleteSelectedUsers = async () => {
    const selectedIds = selectedActionUserIds.filter((id) => userItems.some((user) => user.id === id));

    if (!selectedIds.length || !(await confirmDelete({ message: `Delete ${selectedIds.length} selected user${selectedIds.length === 1 ? "" : "s"}?` }))) {
      return;
    }

    try {
      await Promise.all(selectedIds.map((id) => api.users.delete(id)));
      setSelectedActionUserIds([]);
      if (selectedIds.includes(selectedUserId)) {
        setSelectedUserId("");
        syncPeopleSearchParams("users", null, null);
      }
      showFeedback(`${selectedIds.length} user${selectedIds.length === 1 ? "" : "s"} removed.`, "success");
      await invalidate();
    } catch (error) {
      showFeedback(error instanceof Error ? error.message : "Unable to delete selected users", "error");
    }
  };

  const handleDeleteSelectedRoles = async () => {
    const selectedIds = selectedActionRoleIds.filter((id) => roleItems.some((role) => role.id === id));

    if (!selectedIds.length || !(await confirmDelete({ message: `Delete ${selectedIds.length} selected role${selectedIds.length === 1 ? "" : "s"}? Assigned users may need reassignment.` }))) {
      return;
    }

    try {
      await Promise.all(selectedIds.map((id) => api.roles.delete(id)));
      setSelectedActionRoleIds([]);
      if (selectedIds.includes(selectedRoleId)) {
        setSelectedRoleId("");
        syncPeopleSearchParams("roles", null, null);
      }
      showFeedback(`${selectedIds.length} role${selectedIds.length === 1 ? "" : "s"} removed.`, "success");
      await invalidate();
    } catch (error) {
      showFeedback(error instanceof Error ? error.message : "Unable to delete selected roles", "error");
    }
  };

  const accessActions = canManageUsers ? (
    view === "users" ? (
      <>
        <button className="ghost-button" disabled={!userItems.length} onClick={handleExportUsers} type="button"><ExportIcon />Export users</button>
        <button className="ghost-button" onClick={openImportUsersModal} type="button"><ImportIcon />Bulk Import users</button>
        <button className="primary-button" onClick={openCreateUserModal} type="button"><UsersIcon />Create user</button>
      </>
    ) : (
      <>
        <button className="ghost-button" disabled={!roleItems.length} onClick={handleExportRoles} type="button"><ExportIcon />Export roles</button>
        <button className="primary-button" onClick={openCreateRoleModal} type="button"><AddIcon />Create role</button>
      </>
    )
  ) : null;

  return (
    <div className={embedded ? "admin-embedded-page people-access-page" : "page-content people-access-page"}>
      {confirmationDialog}
      {!embedded ? (
        <PageHeader
          eyebrow="People & Access"
          title={forcedView === "roles" ? "Roles" : forcedView === "users" ? "Users" : "User Management"}
          description={forcedView === "roles" ? "Review role definitions, selected permissions, and reusable access labels." : "Review workspace users, refine role assignments, and keep access governance easy to audit."}
          meta={[
            { label: "Users", value: userItems.length },
            { label: "Roles", value: roleItems.length },
            { label: "Your access", value: canManageUsers ? "User manager" : isAdmin ? "Admin" : "Member" }
          ]}
          actions={accessActions}
        />
      ) : null}

      {feedback ? (
        <ToastMessage message={feedback.message} onDismiss={() => setFeedback(null)} tone={feedback.tone} />
      ) : null}

      {!forcedView ? (
        <SubnavTabs
          value={view}
          onChange={handleViewChange}
          items={[
            { value: "users", label: "Users", meta: `${userItems.length} records` },
            { value: "roles", label: "Roles", meta: `${roleItems.length} records` }
          ]}
        />
      ) : null}

      {view === "users" ? (
        <WorkspaceMasterDetail
          className="people-roles-workspace"
          browseView={(
            <Panel
              title="Users"
              titleVariant="eyebrow"
              subtitle="Scan the directory in card form first, then open one person into a focused access editor."
            >
              <div className="design-list-toolbar people-catalog-toolbar">
                <CatalogSearchFilter
                  activeFilterCount={userSearch.trim() ? 1 : 0}
                  ariaLabel="Search users"
                  onChange={setUserSearch}
                  placeholder="Search users"
                  subtitle="Search by name, email, or role."
                  title="User search"
                  type="search"
                  value={userSearch}
                >
                  <div className="catalog-filter-grid">
                    <div className="catalog-filter-actions">
                      <button className="ghost-button" disabled={!userSearch.trim()} onClick={() => setUserSearch("")} type="button">
                        Clear search
                      </button>
                    </div>
                  </div>
                </CatalogSearchFilter>
                <button
                  className="ghost-button catalog-selection-button"
                  disabled={!visibleUserIds.length || areAllFilteredUsersSelected}
                  onClick={() => setSelectedActionUserIds((current) => Array.from(new Set([...current, ...visibleUserIds])))}
                  type="button"
                >
                  <SelectAllIcon />
                  <span>Select all</span>
                </button>
                <button
                  className="ghost-button catalog-selection-button"
                  disabled={!selectedActionUserIds.length}
                  onClick={() => setSelectedActionUserIds([])}
                  type="button"
                >
                  <ClearSelectionIcon />
                  <span>Clear</span>
                </button>
                <button
                  className="ghost-button danger catalog-selection-button"
                  disabled={!selectedActionUserIds.length}
                  onClick={() => void handleDeleteSelectedUsers()}
                  type="button"
                >
                  <TrashIcon />
                  <span>Delete users</span>
                </button>
                <CatalogViewToggle onChange={setUserCatalogViewMode} value={userCatalogViewMode} />
                {embedded && accessActions ? <div className="catalog-toolbar-actions">{accessActions}</div> : null}
              </div>
              {isUserCatalogLoading ? <TileCardSkeletonGrid /> : null}
              {!isUserCatalogLoading && filteredUserItems.length && userCatalogViewMode === "tile" ? (
                <div className="tile-browser-grid">
                  {filteredUserItems.map((user) => (
                    <button
                      className={selectedUser?.id === user.id ? "record-card tile-card is-active" : "record-card tile-card"}
                      key={user.id}
                      onClick={() => openUserWorkspace(user.id)}
                      type="button"
                    >
                      <div className="tile-card-main">
                        <div className="tile-card-select-row" onClick={(event) => event.stopPropagation()}>
                          <label className="checkbox-field">
                            <input
                              aria-label={`Select ${user.name || visibleUserEmail(user.email)}`}
                              checked={selectedActionUserIds.includes(user.id)}
                              onChange={() =>
                                setSelectedActionUserIds((current) =>
                                  current.includes(user.id) ? current.filter((id) => id !== user.id) : [...current, user.id]
                                )
                              }
                              type="checkbox"
                            />
                            <span className="sr-only">Select user</span>
                          </label>
                        </div>
                        <div className="tile-card-header">
                          <TileCardIconFrame tone={user.role === "admin" ? "info" : "success"}>
                            <TileCardUsersIcon />
                          </TileCardIconFrame>
                          <div className="tile-card-title-group">
                            <strong>{user.name || "Unnamed user"}</strong>
                            <span className="tile-card-kicker">{visibleUserEmail(user.email)}</span>
                          </div>
                          <TileCardStatusIndicator title={user.role === "admin" ? "Admin access" : "Member access"} tone={user.role === "admin" ? "info" : "success"} />
                        </div>
                        <p className="tile-card-description">{user.role === "admin" ? "Workspace administrator with directory controls." : "Active workspace member with assigned project access."}</p>
                        <div className="people-card-footer">
                          <span className="count-pill">{user.role === "admin" ? "Org Admin" : "Member"}</span>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              ) : null}
              {!isUserCatalogLoading && filteredUserItems.length && userCatalogViewMode === "list" ? (
                <DataTable
                  columns={userListColumns}
                  enableColumnResize
                  enableHeaderColumnReorder
                  emptyMessage="No users match the current search."
                  getRowClassName={(user) => (selectedUser?.id === user.id ? "is-active-row" : "")}
                  getRowKey={(user) => user.id}
                  hideToolbarCopy
                  onRowClick={(user) => openUserWorkspace(user.id)}
                  rows={filteredUserItems}
                  storageKey="qaira:users:list-columns"
                />
              ) : null}
              {!isUserCatalogLoading && !userItems.length ? <div className="empty-state compact">No users found yet.</div> : null}
              {!isUserCatalogLoading && userItems.length > 0 && !filteredUserItems.length ? <div className="empty-state compact">No users match the current search.</div> : null}
            </Panel>
          )}
          detailView={(
            <Panel
              actions={<WorkspaceBackButton label="Back to user tiles" onClick={closeUserWorkspace} />}
              title="Selected user"
              subtitle={selectedUser ? "Refine the record without leaving the list." : "Create your first user to begin."}
            >
              {selectedUser ? (
                <div className="detail-stack">
                  <div className="detail-summary">
                    <strong>{selectedUser.name || "Unnamed user"}</strong>
                    <span>{visibleUserEmail(selectedUser.email)}</span>
                    <span>{selectedUser.role === "admin" ? "Admin access" : "Member access"}</span>
                  </div>
                  {canManageUsers ? (
                    <form
                      className="form-grid"
                      onSubmit={(event) => {
                        event.preventDefault();
                        updateUser.mutate({
                          id: selectedUser.id,
                          input: {
                            name: userDraft.name,
                            email: userDraft.email,
                            role_id: userDraft.role_id,
                            ...(userDraft.password_hash ? { password: userDraft.password_hash } : {})
                          }
                        });
                      }}
                    >
                      <FormField label="Name">
                        <input
                          name="name"
                          value={userDraft.name}
                          onChange={(event) => setUserDraft((current) => ({ ...current, name: event.target.value }))}
                        />
                      </FormField>
                      <FormField label="Email">
                        <input
                          name="email"
                          type="email"
                          value={userDraft.email}
                          onChange={(event) => setUserDraft((current) => ({ ...current, email: event.target.value }))}
                        />
                      </FormField>
                      <FormField label="Role">
                        <select
                          name="role_id"
                          value={userDraft.role_id}
                          onChange={(event) => setUserDraft((current) => ({ ...current, role_id: event.target.value }))}
                        >
                          {roleItems.map((role) => (
                            <option key={role.id} value={role.id}>
                              {role.name === "admin" ? "Admin" : role.name === "member" ? "Member" : role.name}
                            </option>
                          ))}
                        </select>
                      </FormField>
                      <FormField label="New password">
                        <input
                          name="password"
                          placeholder="Leave blank to keep current password"
                          type="password"
                          value={userDraft.password_hash}
                          onChange={(event) => setUserDraft((current) => ({ ...current, password_hash: event.target.value }))}
                        />
                      </FormField>
                      <div className="action-row">
                        <button className="primary-button" disabled={updateUser.isPending} type="submit">
                          {updateUser.isPending ? "Saving…" : "Save user"}
                        </button>
                        <button className="ghost-button danger" disabled={deleteUser.isPending || updateUser.isPending} onClick={() => void confirmDeleteUser(selectedUser)} type="button">
                          Delete user
                        </button>
                      </div>
                    </form>
                  ) : (
                    <div className="empty-state compact">Read-only access. Ask an admin to update this record.</div>
                  )}
                </div>
              ) : (
                <div className="empty-state compact">No user selected.</div>
              )}
            </Panel>
          )}
          isDetailOpen={Boolean(selectedUser)}
        />
      ) : (
        <WorkspaceMasterDetail
          browseView={(
            <Panel
              title="Roles"
              titleVariant="eyebrow"
              subtitle="Keep role definitions scannable, then open one label into a focused editor when needed."
            >
              <div className="design-list-toolbar people-catalog-toolbar">
                <CatalogSearchFilter
                  activeFilterCount={roleSearch.trim() ? 1 : 0}
                  ariaLabel="Search roles"
                  onChange={setRoleSearch}
                  placeholder="Search roles"
                  subtitle="Search by role name or assigned-user count."
                  title="Role search"
                  type="search"
                  value={roleSearch}
                >
                  <div className="catalog-filter-grid">
                    <div className="catalog-filter-actions">
                      <button className="ghost-button" disabled={!roleSearch.trim()} onClick={() => setRoleSearch("")} type="button">
                        Clear search
                      </button>
                    </div>
                  </div>
                </CatalogSearchFilter>
                <button
                  className="ghost-button catalog-selection-button"
                  disabled={!visibleRoleIds.length || areAllFilteredRolesSelected}
                  onClick={() => setSelectedActionRoleIds((current) => Array.from(new Set([...current, ...visibleRoleIds])))}
                  type="button"
                >
                  <SelectAllIcon />
                  <span>Select all</span>
                </button>
                <button
                  className="ghost-button catalog-selection-button"
                  disabled={!selectedActionRoleIds.length}
                  onClick={() => setSelectedActionRoleIds([])}
                  type="button"
                >
                  <ClearSelectionIcon />
                  <span>Clear</span>
                </button>
                <button
                  className="ghost-button danger catalog-selection-button"
                  disabled={!selectedActionRoleIds.length}
                  onClick={() => void handleDeleteSelectedRoles()}
                  type="button"
                >
                  <TrashIcon />
                  <span>Delete roles</span>
                </button>
                <CatalogViewToggle onChange={setRoleCatalogViewMode} value={roleCatalogViewMode} />
                {embedded && accessActions ? <div className="catalog-toolbar-actions">{accessActions}</div> : null}
              </div>
              {isRoleCatalogLoading ? <TileCardSkeletonGrid /> : null}
              {!isRoleCatalogLoading && filteredRoleItems.length && roleCatalogViewMode === "tile" ? (
                <div className="tile-browser-grid">
                  {filteredRoleItems.map((role) => (
                    <button
                      key={role.id}
                      className={selectedRole?.id === role.id ? "record-card tile-card is-active" : "record-card tile-card"}
                      onClick={() => openRoleWorkspace(role.id)}
                      type="button"
                    >
                      <div className="tile-card-main">
                        <div className="tile-card-select-row" onClick={(event) => event.stopPropagation()}>
                          <label className="checkbox-field">
                            <input
                              aria-label={`Select ${role.name}`}
                              checked={selectedActionRoleIds.includes(role.id)}
                              onChange={() =>
                                setSelectedActionRoleIds((current) =>
                                  current.includes(role.id) ? current.filter((id) => id !== role.id) : [...current, role.id]
                                )
                              }
                              type="checkbox"
                            />
                            <span className="sr-only">Select role</span>
                          </label>
                        </div>
                        <div className="tile-card-header">
                          <TileCardIconFrame tone={role.name === "admin" ? "info" : "success"}>
                            <TileCardUsersIcon />
                          </TileCardIconFrame>
                          <div className="tile-card-title-group">
                            <strong>{role.name}</strong>
                            <span className="tile-card-kicker">{userCountByRoleName[role.name] || 0} assigned</span>
                          </div>
                          <TileCardStatusIndicator title="Reusable role" tone={role.name === "admin" ? "info" : "success"} />
                        </div>
                        <p className="tile-card-description">Project membership label used across assignments and access views.</p>
                        <div className="tile-card-facts" aria-label={`${role.name} facts`}>
                          <TileCardFact label={String(userCountByRoleName[role.name] || 0)} title={`${userCountByRoleName[role.name] || 0} user${(userCountByRoleName[role.name] || 0) === 1 ? "" : "s"} assigned`} tone={(userCountByRoleName[role.name] || 0) ? "success" : "neutral"}>
                            <TileCardUsersIcon />
                          </TileCardFact>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              ) : null}
              {!isRoleCatalogLoading && filteredRoleItems.length && roleCatalogViewMode === "list" ? (
                <DataTable
                  columns={roleListColumns}
                  enableColumnResize
                  enableHeaderColumnReorder
                  emptyMessage="No roles match the current search."
                  getRowClassName={(role) => (selectedRole?.id === role.id ? "is-active-row" : "")}
                  getRowKey={(role) => role.id}
                  hideToolbarCopy
                  onRowClick={(role) => openRoleWorkspace(role.id)}
                  rows={filteredRoleItems}
                  storageKey="qaira:roles:list-columns"
                />
              ) : null}
              {!isRoleCatalogLoading && !roleItems.length ? <div className="empty-state compact">No roles defined yet.</div> : null}
              {!isRoleCatalogLoading && roleItems.length > 0 && !filteredRoleItems.length ? <div className="empty-state compact">No roles match the current search.</div> : null}
            </Panel>
          )}
          detailView={(
            <Panel
              actions={<WorkspaceBackButton label="Back to role tiles" onClick={closeRoleWorkspace} />}
              title="Selected role"
              subtitle={selectedRole ? "Adjust the role name in place." : "Create a role to start reusing it in memberships."}
            >
              {selectedRole ? (
                <div className="detail-stack">
                  <div className="detail-summary">
                    <strong>{selectedRole.name}</strong>
                    <span>{rolePermissionDraft.length} permissions selected</span>
                  </div>
                  {isAdmin ? (
                    <>
                      <form
                        className="form-grid"
                        onSubmit={(event) => {
                          event.preventDefault();
                          updateRole.mutate({ id: selectedRole.id, input: { name: roleDraft.name, permission_codes: rolePermissionDraft } });
                        }}
                      >
                        <FormField label="Role name">
                          <input
                            name="name"
                            value={roleDraft.name}
                            onChange={(event) => setRoleDraft({ name: event.target.value })}
                          />
                        </FormField>
                        <div className="action-row">
                          <button className="primary-button" disabled={updateRole.isPending} type="submit">
                            {updateRole.isPending ? "Saving…" : "Save role"}
                          </button>
                          <button className="ghost-button danger" disabled={deleteRole.isPending || updateRole.isPending} onClick={() => void confirmDeleteRole(selectedRole)} type="button">
                            Delete role
                          </button>
                        </div>
                      </form>

                      <div className="role-permission-editor role-permission-editor--edit people-role-existing-permissions">
                        <div className="detail-summary">
                          <strong>Permissions</strong>
                          <span>Bind feature access and CRUD actions to this role. Changes apply anywhere this role is assigned.</span>
                        </div>
                        {permissions.isLoading || selectedRolePermissions.isLoading ? <TileCardSkeletonGrid /> : renderPermissionMatrix(rolePermissionDraft, "edit")}
                        <div className="action-row">
                          <button
                            className="primary-button"
                            disabled={replaceRolePermissions.isPending || updateRole.isPending || selectedRolePermissions.isLoading}
                            onClick={() => replaceRolePermissions.mutate({ id: selectedRole.id, permissionCodes: rolePermissionDraft })}
                            type="button"
                          >
                            {replaceRolePermissions.isPending ? "Saving permissions…" : "Save permissions"}
                          </button>
                          <button
                            className="ghost-button"
                            disabled={replaceRolePermissions.isPending || selectedRolePermissions.isLoading}
                            onClick={() => setRolePermissionDraft((selectedRolePermissions.data || []).map((permission) => permission.code))}
                            type="button"
                          >
                            Reset
                          </button>
                        </div>
                      </div>
                    </>
                  ) : (
                    <div className="empty-state compact">Read-only access. Ask an admin to change role definitions.</div>
                  )}
                </div>
              ) : (
                <div className="empty-state compact">No role selected.</div>
              )}
            </Panel>
          )}
          isDetailOpen={Boolean(selectedRole)}
          variant="split"
        />
      )}

      {isCreateUserModalOpen ? (
        <div className="modal-backdrop" onClick={closeCreateUserModal} role="presentation">
          <div
            aria-labelledby="create-user-title"
            aria-modal="true"
            className="modal-card people-modal-card people-create-user-card"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
          >
            <div className="people-modal-header">
              <div className="people-modal-title">
                <div className="modal-title-info-row">
                  <p className="eyebrow" id="create-user-title">Create user</p>
                  <InfoTooltip content="Add a workspace user without leaving the directory view." label="Create user information" />
                </div>
              </div>
              <button
                aria-label="Close create user dialog"
                className="ghost-button"
                onClick={closeCreateUserModal}
                type="button"
              >
                Close
              </button>
            </div>

            <form className="people-modal-form" onSubmit={handleUserCreate}>
              <div className="people-modal-body">
                <div className="record-grid">
                  <FormField label="Name">
                    <input
                      autoFocus
                      name="name"
                      placeholder="Quality lead"
                      value={createUserDraft.name}
                      onChange={(event) => setCreateUserDraft((current) => ({ ...current, name: event.target.value }))}
                    />
                  </FormField>
                  <FormField label="Email" required>
                    <input
                      name="email"
                      type="email"
                      value={createUserDraft.email}
                      onChange={(event) => setCreateUserDraft((current) => ({ ...current, email: event.target.value }))}
                    />
                  </FormField>
                  <FormField label="Role" required>
                    <select
                      name="role_id"
                      value={createUserDraft.role_id}
                      onChange={(event) => setCreateUserDraft((current) => ({ ...current, role_id: event.target.value }))}
                    >
                      <option value="">Select a role</option>
                      {roleItems.map((role) => (
                        <option key={role.id} value={role.id}>
                          {role.name.charAt(0).toUpperCase() + role.name.slice(1)}
                        </option>
                      ))}
                    </select>
                  </FormField>
                  <FormField label="Temporary password" required>
                    <input
                      name="password"
                      placeholder="At least 6 characters"
                      type="password"
                      value={createUserDraft.password_hash}
                      onChange={(event) => setCreateUserDraft((current) => ({ ...current, password_hash: event.target.value }))}
                    />
                  </FormField>
                </div>
              </div>

              <div className="action-row people-modal-actions">
                <button className="primary-button" disabled={createUser.isPending} type="submit">
                  {createUser.isPending ? "Creating…" : "Create user"}
                </button>
                <button className="ghost-button" disabled={createUser.isPending} onClick={closeCreateUserModal} type="button">
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {isImportUsersModalOpen ? (
        <div className="modal-backdrop" onClick={() => closeImportUsersModal()} role="presentation">
          <div
            aria-labelledby="import-users-title"
            aria-modal="true"
            className="modal-card people-modal-card import-modal-card"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
          >
            <div className="people-modal-header">
              <div className="people-modal-title">
                <p>People & Access</p>
                <div className="modal-title-info-row">
                  <p className="eyebrow" id="import-users-title">Import users from CSV</p>
                  <InfoTooltip
                    content="Upload a CSV with `Email`, optional `Name`, `Password` or `Password Hash`, and optional `Role` or `Role ID`. Plain passwords are hashed before users are stored."
                    label="User import information"
                  />
                </div>
              </div>
              <button
                aria-label="Close user import dialog"
                className="ghost-button"
                disabled={importUsers.isPending}
                onClick={() => closeImportUsersModal()}
                type="button"
              >
                Close
              </button>
            </div>

            <div className="people-modal-body">
              <div className="record-grid">
                <FormField label="CSV file">
                  <input accept=".csv,text/csv" onChange={(event) => void handleImportUsersFile(event)} type="file" />
                </FormField>

                <FormField label="Default role">
                  <select value={importUsersDefaultRoleId} onChange={(event) => setImportUsersDefaultRoleId(event.target.value)}>
                    <option value="">Require role per row</option>
                    {roleItems.map((role) => (
                      <option key={role.id} value={role.id}>
                        {role.name.charAt(0).toUpperCase() + role.name.slice(1)}
                      </option>
                    ))}
                  </select>
                </FormField>
              </div>

              <div className="metric-strip compact">
                <div className="mini-card">
                  <strong>{importUserRows.length}</strong>
                  <span>Rows ready</span>
                </div>
                <div className="mini-card">
                  <strong>{importUsersPasswordCount}</strong>
                  <span>Password values</span>
                </div>
                <div className="mini-card">
                  <strong>{importUsersExplicitRoleCount}</strong>
                  <span>Rows with roles</span>
                </div>
              </div>

              <div className="detail-summary">
                <strong>{importUsersFileName || "No CSV loaded yet"}</strong>
                <span>Accepted columns: `Email`, `Name`, `Password`, `Password Hash`, `Role`, and `Role ID`. Any row without a role uses the selected default role when one is provided.</span>
              </div>

              {importUserWarnings.length ? (
                <div className="empty-state compact">
                  {importUserWarnings.slice(0, 4).map((warning) => (
                    <div key={warning}>{warning}</div>
                  ))}
                </div>
              ) : null}

              {importUserRows.length ? (
                <div className="table-wrap import-preview-table">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Email</th>
                        <th>Name</th>
                        <th>Role</th>
                        <th>Password source</th>
                      </tr>
                    </thead>
                    <tbody>
                      {importUserRows.slice(0, 5).map((row, index) => (
                        <tr key={`${row.email}-${index}`}>
                          <td>{visibleUserEmail(row.email)}</td>
                          <td>{row.name || "—"}</td>
                          <td>{row.role || row.role_id || "Default role"}</td>
                          <td>{row.password_hash ? "Password hash" : row.password ? "Plain password" : "Missing"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </div>

            <div className="action-row people-modal-actions">
              <button className="primary-button" disabled={!importUserRows.length || importUsers.isPending} onClick={() => void handleBulkImportUsers()} type="button">
                {importUsers.isPending ? "Queuing…" : `Queue ${importUserRows.length || ""} Users`}
              </button>
              <button
                className="ghost-button"
                disabled={!importUserRows.length || importUsers.isPending}
                onClick={() => {
                  setImportUsersFileName("");
                  setImportUserRows([]);
                  setImportUserWarnings([]);
                }}
                type="button"
              >
                Clear preview
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {isCreateRoleModalOpen ? (
        <div className="modal-backdrop" onClick={closeCreateRoleModal} role="presentation">
          <div
            aria-labelledby="create-role-title"
            aria-modal="true"
            className={`modal-card people-modal-card people-role-modal-card people-role-create-card${isCreateRolePermissionExpanded ? " is-permission-expanded" : ""}`}
            onClick={(event) => event.stopPropagation()}
            role="dialog"
          >
            <div className="people-modal-header">
              <div className="people-modal-title">
                <p>People & Access</p>
                <div className="modal-title-info-row">
                  <p className="eyebrow" id="create-role-title">Create role</p>
                  <InfoTooltip content="Keep the role library concise and reusable across assignments." label="Create role information" />
                </div>
              </div>
              <button
                aria-label="Close create role dialog"
                className="ghost-button"
                onClick={closeCreateRoleModal}
                type="button"
              >
                Close
              </button>
            </div>

            <form className="people-modal-form" onSubmit={handleRoleCreate}>
              <div className="people-modal-body people-role-modal-body people-role-create-body">
                <section className="people-role-permissions-panel people-role-create-permissions">
                  <div className="role-permission-editor role-permission-editor--create">
                    {permissions.isLoading ? <TileCardSkeletonGrid /> : renderPermissionMatrix(createRolePermissionDraft, "create")}
                  </div>
                </section>
              </div>

              <div className="action-row people-modal-actions">
                <button className="primary-button" disabled={createRole.isPending} type="submit">
                  {createRole.isPending ? "Creating…" : "Create role"}
                </button>
                <button className="ghost-button" disabled={createRole.isPending} onClick={closeCreateRoleModal} type="button">
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
