import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { AddIcon, ImportIcon, UsersIcon } from "../components/AppIcons";
import { api } from "../lib/api";
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
import { parseUserCsv, type ImportedUserRow } from "../lib/userImport";
import type { PermissionGroup, Role, User } from "../types";

type PeopleView = "users" | "roles";
type FeedbackTone = "success" | "error";

const createEmptyUserDraft = (roleId = "") => ({ name: "", email: "", password_hash: "", role_id: roleId });
const EMPTY_ROLE_DRAFT = { name: "" };

export function PeoplePage() {
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
  const [view, setView] = useState<PeopleView>(searchParams.get("view") === "roles" ? "roles" : "users");
  const [selectedUserId, setSelectedUserId] = useState("");
  const [selectedRoleId, setSelectedRoleId] = useState("");
  const [userDraft, setUserDraft] = useState(createEmptyUserDraft());
  const [roleDraft, setRoleDraft] = useState(EMPTY_ROLE_DRAFT);
  const [rolePermissionDraft, setRolePermissionDraft] = useState<string[]>([]);
  const [createRolePermissionDraft, setCreateRolePermissionDraft] = useState<string[]>([]);
  const [isCreateUserModalOpen, setIsCreateUserModalOpen] = useState(false);
  const [isCreateRoleModalOpen, setIsCreateRoleModalOpen] = useState(false);
  const [isImportUsersModalOpen, setIsImportUsersModalOpen] = useState(false);
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
    const requestedView = searchParams.get("view");
    if ((requestedView === "users" || requestedView === "roles") && requestedView !== view) {
      setView(requestedView);
    }
  }, [searchParams, view]);

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
    setIsCreateRoleModalOpen(true);
  };

  const closeCreateRoleModal = () => {
    if (createRole.isPending) {
      return;
    }

    setIsCreateRoleModalOpen(false);
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
    mutationFn: ({ id, input }: { id: string; input: Partial<{ email: string; password_hash: string; name: string; role_id: string }> }) =>
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
      setCreateRoleDraft(EMPTY_ROLE_DRAFT);
      await invalidate();
    },
    onError: (error) => showFeedback(error instanceof Error ? error.message : "Unable to create role", "error")
  });

  const updateRole = useMutation({
    mutationFn: ({ id, input }: { id: string; input: { name: string } }) => api.roles.update(id, input),
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
      password_hash: createUserDraft.password_hash,
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

    return (
    <div className="permission-transfer">
      <div className="permission-transfer-column">
        <div className="permission-transfer-head">
          <div>
            <strong>Not selected</strong>
            <span>{availablePermissions.length} permission{availablePermissions.length === 1 ? "" : "s"}</span>
          </div>
          <button className="ghost-button compact-button" onClick={() => setAllPermissions(true)} type="button">
            Add all
          </button>
        </div>
        <div className="permission-transfer-list">
          {availablePermissions.map((permission) => (
            <button className="permission-transfer-item" key={permission.code} onClick={() => togglePermission(permission.code, target)} type="button">
              <span>
                <strong>{permission.code}</strong>
                <small>{permission.groupLabel} · {permission.description}</small>
              </span>
              <span aria-hidden="true" className="permission-transfer-arrow">→</span>
            </button>
          ))}
          {!availablePermissions.length ? <div className="empty-state compact">Every permission is selected.</div> : null}
        </div>
      </div>

      <div aria-hidden="true" className="permission-transfer-bridge">⇄</div>

      <div className="permission-transfer-column is-selected">
        <div className="permission-transfer-head">
          <div>
            <strong>Selected</strong>
            <span>{selectedPermissions.length} permission{selectedPermissions.length === 1 ? "" : "s"}</span>
          </div>
          <button className="ghost-button compact-button danger" onClick={() => setAllPermissions(false)} type="button">
            Clear
          </button>
        </div>
        <div className="permission-transfer-list">
          {selectedPermissions.map((permission) => (
            <button className="permission-transfer-item is-selected" key={permission.code} onClick={() => togglePermission(permission.code, target)} type="button">
              <span aria-hidden="true" className="permission-transfer-arrow">←</span>
              <span>
                <strong>{permission.code}</strong>
                <small>{permission.groupLabel} · {permission.description}</small>
              </span>
            </button>
          ))}
          {!selectedPermissions.length ? <div className="empty-state compact">No permissions selected.</div> : null}
        </div>
      </div>

      <div className="permission-group-strip">
      {permissionGroups.map((group) => {
        const groupCodes = group.permissions.map((permission) => permission.code);
        const selectedCount = groupCodes.filter((code) => selectedCodes.includes(code)).length;
        const isAllSelected = selectedCount === groupCodes.length && groupCodes.length > 0;

        return (
          <section className="permission-group-card" key={group.key}>
            <div className="permission-group-head">
              <div>
                <strong>{group.label}</strong>
                <span>{selectedCount} of {groupCodes.length} selected</span>
              </div>
              <label className="permission-toggle-all">
                <input
                  checked={isAllSelected}
                  onChange={(event) => setPermissionGroup(group, event.target.checked, target)}
                  type="checkbox"
                />
                <span>All</span>
              </label>
            </div>
            <div className="permission-option-list">
              {group.permissions.map((permission) => (
                <label className="permission-option" key={permission.code}>
                  <input
                    checked={selectedCodes.includes(permission.code)}
                    onChange={() => togglePermission(permission.code, target)}
                    type="checkbox"
                  />
                  <span>
                    <strong>{permission.code}</strong>
                    <small>{permission.description}</small>
                  </span>
                </label>
              ))}
            </div>
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

  return (
    <div className="page-content">
      {confirmationDialog}
      <PageHeader
        eyebrow="People & Access"
        title="User Management"
        description="Review workspace users, refine role assignments, and keep access governance easy to audit."
        meta={[
          { label: "Users", value: userItems.length },
          { label: "Roles", value: roleItems.length },
          { label: "Your access", value: isAdmin ? "Admin" : "Member" }
        ]}
        actions={
          isAdmin ? (
            view === "users" ? (
              <>
                <button className="ghost-button" onClick={openImportUsersModal} type="button"><ImportIcon />Bulk Import users</button>
                <button className="primary-button" onClick={openCreateUserModal} type="button"><UsersIcon />Create user</button>
              </>
            ) : (
              <button className="primary-button" onClick={openCreateRoleModal} type="button"><AddIcon />Create role</button>
            )
          ) : null
        }
      />

      {feedback ? (
        <ToastMessage message={feedback.message} onDismiss={() => setFeedback(null)} tone={feedback.tone} />
      ) : null}

      <SubnavTabs
        value={view}
        onChange={handleViewChange}
        items={[
          { value: "users", label: "Users", meta: `${userItems.length} records` },
          { value: "roles", label: "Roles", meta: `${roleItems.length} records` }
        ]}
      />

      {view === "users" ? (
        <WorkspaceMasterDetail
          browseView={(
            <Panel title="Users" titleVariant="eyebrow" subtitle="Scan the directory in card form first, then open one person into a focused access editor.">
              {isUserCatalogLoading ? <TileCardSkeletonGrid /> : null}
              {!isUserCatalogLoading ? (
                <div className="tile-browser-grid">
                  {userItems.map((user) => (
                    <button
                      className={selectedUser?.id === user.id ? "record-card tile-card is-active" : "record-card tile-card"}
                      key={user.id}
                      onClick={() => openUserWorkspace(user.id)}
                      type="button"
                    >
                      <div className="tile-card-main">
                        <div className="tile-card-header">
                          <TileCardIconFrame tone={user.role === "admin" ? "info" : "success"}>
                            <TileCardUsersIcon />
                          </TileCardIconFrame>
                          <div className="tile-card-title-group">
                            <strong>{user.name || "Unnamed user"}</strong>
                            <span className="tile-card-kicker">{user.email}</span>
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
              {!isUserCatalogLoading && !userItems.length ? <div className="empty-state compact">No users found yet.</div> : null}
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
                    <span>{selectedUser.email}</span>
                    <span>{selectedUser.role === "admin" ? "Admin access" : "Member access"}</span>
                  </div>
                  {isAdmin ? (
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
                            ...(userDraft.password_hash ? { password_hash: userDraft.password_hash } : {})
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
                      <FormField label="Password hash">
                        <input
                          name="password_hash"
                          placeholder="Leave blank to keep current value"
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
            <Panel title="Roles" titleVariant="eyebrow" subtitle="Keep role definitions scannable, then open one label into a focused editor when needed.">
              {isRoleCatalogLoading ? <TileCardSkeletonGrid /> : null}
              {!isRoleCatalogLoading ? (
                <div className="tile-browser-grid">
                  {roleItems.map((role) => (
                    <button
                      key={role.id}
                      className={selectedRole?.id === role.id ? "record-card tile-card is-active" : "record-card tile-card"}
                      onClick={() => openRoleWorkspace(role.id)}
                      type="button"
                    >
                      <div className="tile-card-main">
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
              {!isRoleCatalogLoading && !roleItems.length ? <div className="empty-state compact">No roles defined yet.</div> : null}
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
                          updateRole.mutate({ id: selectedRole.id, input: { name: roleDraft.name } });
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

                      <div className="role-permission-editor">
                        <div className="detail-summary">
                          <strong>Permissions</strong>
                          <span>Bind feature access and CRUD actions to this role. Changes apply anywhere this role is assigned.</span>
                        </div>
                        {permissions.isLoading || selectedRolePermissions.isLoading ? <TileCardSkeletonGrid /> : renderPermissionMatrix(rolePermissionDraft, "edit")}
                        <div className="action-row">
                          <button
                            className="primary-button"
                            disabled={replaceRolePermissions.isPending || selectedRolePermissions.isLoading}
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
        />
      )}

      {isCreateUserModalOpen ? (
        <div className="modal-backdrop" onClick={closeCreateUserModal} role="presentation">
          <div
            aria-labelledby="create-user-title"
            aria-modal="true"
            className="modal-card people-modal-card"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
          >
            <div className="people-modal-header">
              <div className="people-modal-title">
                <p className="eyebrow">People & Access</p>
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
                  <FormField label="Password hash" required>
                    <input
                      name="password_hash"
                      placeholder="Stored password value"
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
                <p className="eyebrow">People & Access</p>
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
                          <td>{row.email}</td>
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
            className="modal-card people-modal-card people-role-modal-card"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
          >
            <div className="people-modal-header">
              <div className="people-modal-title">
                <p className="eyebrow">People & Access</p>
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
              <div className="people-modal-body">
                <FormField label="Role name" required>
                  <input
                    autoFocus
                    name="name"
                    placeholder="qa-manager"
                    value={createRoleDraft.name}
                    onChange={(event) => setCreateRoleDraft({ name: event.target.value })}
                  />
                </FormField>
                <div className="detail-summary">
                  <strong>Default permissions</strong>
                  <span>Member-safe permissions are selected by default. Adjust before creating the role.</span>
                </div>
                {permissions.isLoading ? <TileCardSkeletonGrid /> : renderPermissionMatrix(createRolePermissionDraft, "create")}
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
