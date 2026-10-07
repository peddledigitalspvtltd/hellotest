import { useMemo, useState, FormEvent } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { useAuth } from "@hellotest/platform/frontend/src/auth/AuthContext";
import { useCurrentProject, useCurrentAppType } from "@hellotest/platform/frontend/src/platform/hooks/useCurrentProject";
import { knowledgeApi } from "../api.client";
import { asArray } from "@hellotest/platform/frontend/src/shared/lib/collectionGuards";
import { PageHeader } from "@hellotest/platform/frontend/src/shared/components/PageHeader";
import { Panel } from "@hellotest/platform/frontend/src/shared/components/Panel";
import { LoadingState } from "@hellotest/platform/frontend/src/shared/components/LoadingState";
import { CatalogActionMenu } from "@hellotest/platform/frontend/src/shared/components/CatalogActionMenu";
import { CatalogSearchFilter } from "@hellotest/platform/frontend/src/shared/components/CatalogSearchFilter";
import { CatalogViewToggle } from "@hellotest/platform/frontend/src/shared/components/CatalogViewToggle";
import { DataTable } from "@hellotest/platform/frontend/src/shared/components/DataTable";
import { AddIcon, TrashIcon, OpenIcon } from "@hellotest/platform/frontend/src/platform/components/AppIcons";
import { ToastMessage } from "@hellotest/platform/frontend/src/shared/components/ToastMessage";
import { FormField } from "@hellotest/platform/frontend/src/shared/components/FormField";
import { RichTextEditor, richTextToPlainText } from "@hellotest/platform/frontend/src/platform/components/RichTextEditor";
import { DialogCloseButton } from "@hellotest/platform/frontend/src/shared/components/DialogCloseButton";
import { useDeleteConfirmation } from "@hellotest/platform/frontend/src/shared/components/DeleteConfirmationDialog";
import { useDialogFocus } from "@hellotest/platform/frontend/src/shared/hooks/useDialogFocus";
import { readDefaultCatalogViewMode } from "@hellotest/platform/frontend/src/shared/lib/viewPreferences";
import { hasPermission } from "@hellotest/platform/frontend/src/platform/lib/permissions";
import { KnowledgeContextStudio } from "../components/KnowledgeContextStudio";

export function KnowledgeRepoPage() {
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const { session } = useAuth();
  const [projectId] = useCurrentProject();
  const [appTypeId] = useCurrentAppType(projectId);
  const canManageKnowledge = hasPermission(session, "knowledge.manage", projectId);
  const { confirmDelete, confirmationDialog } = useDeleteConfirmation();

  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState<"success" | "error">("success");
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [catalogViewMode, setCatalogViewMode] = useState<"tile" | "list">(() => readDefaultCatalogViewMode());
  const [knowledgeSearch, setKnowledgeSearch] = useState("");
  const [showNotes, setShowNotes] = useState(false);

  const [draft, setDraft] = useState({
    title: "",
    description: "",
    content_type: "text",
    content: "",
    is_active: true
  });
  const knowledgeQuery = useQuery({
    queryKey: ["knowledge", projectId],
    queryFn: ({ signal }) => knowledgeApi.knowledgeRepo.list(projectId, { signal }),
    enabled: Boolean(projectId && (showNotes || searchParams.get("item"))),
    staleTime: 20_000
  });
  const createKnowledge = useMutation({
    mutationFn: (data: any) => knowledgeApi.knowledgeRepo.create(projectId, { ...data, app_type_id: appTypeId })
  });

  const updateKnowledge = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => knowledgeApi.knowledgeRepo.update(projectId, id, { ...data, app_type_id: appTypeId })
  });

  const deleteKnowledge = useMutation({
    mutationFn: (id: string) => knowledgeApi.knowledgeRepo.delete(projectId, id)
  });
  const isKnowledgeMutationPending = createKnowledge.isPending || updateKnowledge.isPending;
  const closeKnowledgeDialog = () => {
    if (isKnowledgeMutationPending) return;
    setIsModalOpen(false);
  };
  const knowledgeDialogRef = useDialogFocus<HTMLDivElement>({
    active: isModalOpen,
    closeDisabled: isKnowledgeMutationPending,
    onClose: closeKnowledgeDialog
  });

  const items = asArray(knowledgeQuery.data);
  const linkedItemId = searchParams.get("item") || "";
  const linkedItem = items.find((item: any) => item.id === linkedItemId);
  const closeLinkedKnowledge = () => {
    const next = new URLSearchParams(searchParams);
    next.delete("item");
    setSearchParams(next, { replace: true });
  };
  const linkedKnowledgeRef = useDialogFocus<HTMLDivElement>({
    active: Boolean(linkedItemId && projectId),
    onClose: closeLinkedKnowledge
  });
  const filteredItems = useMemo(() => {
    const normalizedSearch = knowledgeSearch.trim().toLowerCase();
    if (!normalizedSearch) return items;

    return items.filter((item: any) => [
      item.title,
      richTextToPlainText(item.description),
      item.content_type,
      item.is_active ? "active" : "inactive"
    ].filter(Boolean).join(" ").toLowerCase().includes(normalizedSearch));
  }, [items, knowledgeSearch]);
  const showSuccess = (text: string) => {
    setMessageTone("success");
    setMessage(text);
  };

  const showError = (error: unknown, fallback: string) => {
    setMessageTone("error");
    setMessage(error instanceof Error ? error.message : fallback);
  };

  const handleOpenCreateModal = () => {
    setEditingId(null);
    setDraft({ title: "", description: "", content_type: "text", content: "", is_active: true });
    setIsModalOpen(true);
  };

  const handleOpenEditModal = (item: any) => {
    setEditingId(item.id);
    setDraft({
      title: item.title,
      description: item.description || "",
      content_type: item.content_type || "text",
      content: item.content || "",
      is_active: item.is_active
    });
    setIsModalOpen(true);
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!projectId) {
      showError(null, "Select a project first.");
      return;
    }

    if (!canManageKnowledge) return;
    if (!draft.title.trim() || !draft.content.trim()) { showError(null, "Add a title and content."); return; }
    if (draft.content_type === "url" && !/^https?:\/\//i.test(draft.content.trim())) { showError(null, "Enter a URL beginning with https:// or http://."); return; }
    const input = { ...draft, title: draft.title.trim(), content: draft.content.trim() };
    try {
      if (editingId) {
        await updateKnowledge.mutateAsync({ id: editingId, data: input });
        showSuccess("Knowledge item updated successfully.");
      } else {
        await createKnowledge.mutateAsync(input);
        showSuccess("Knowledge item created successfully.");
      }
      setIsModalOpen(false);
      queryClient.invalidateQueries({ queryKey: ["knowledge", projectId] });
      queryClient.invalidateQueries({ queryKey: ["knowledge-sources", projectId] });
      queryClient.invalidateQueries({ queryKey: ["knowledge-overview", projectId] });
    } catch (error) {
      showError(error, "Failed to save knowledge item.");
    }
  };

  const handleDelete = async (id: string) => {
    const confirmed = await confirmDelete({
      message: "Are you sure you want to delete this AI knowledge item? It will no longer be used for generation."
    });
    if (confirmed) {
      try {
        await deleteKnowledge.mutateAsync(id);
        showSuccess("Knowledge item deleted.");
        queryClient.invalidateQueries({ queryKey: ["knowledge", projectId] });
      queryClient.invalidateQueries({ queryKey: ["knowledge-sources", projectId] });
      queryClient.invalidateQueries({ queryKey: ["knowledge-overview", projectId] });
      } catch (error) {
        showError(error, "Failed to delete item.");
      }
    }
  };
  const getKnowledgeActions = (item: any) => [
    {
      label: "Edit knowledge",
      description: "Open this knowledge item for editing.",
      icon: <OpenIcon />,
      onClick: () => handleOpenEditModal(item)
    },
    {
      label: "Delete knowledge",
      description: "Remove this knowledge item from AI retrieval context.",
      icon: <TrashIcon />,
      onClick: () => void handleDelete(item.id),
      tone: "danger" as const
    }
  ];

  return (
    <div className="page-content knowledge-repo-page">
      {confirmationDialog}
      <ToastMessage message={message} tone={messageTone} onDismiss={() => setMessage("")} />
      
      <div className="knowledge-repo-content">
        <PageHeader
          eyebrow="Project context"
          title="Knowledge Repo"
          description="The evidence behind your AI answers."
        />

        <div className="knowledge-repo-workspace">
          {!projectId ? <div className="knowledge-project-empty"><strong>Select a project</strong><p>Choose a project in the workspace switcher to view its knowledge.</p></div> : <KnowledgeContextStudio
            key={`${projectId}:${appTypeId}`}
            initialSourceId={searchParams.get("source_id") || ""}
            initialRevisionId={searchParams.get("revision_id") || ""}
            appTypeId={appTypeId}
            canManage={canManageKnowledge}
            onError={showError}
            onSuccess={showSuccess}
            projectId={projectId}
          />}
          {projectId ? <section className="knowledge-notes-section"><button aria-controls="knowledge-notes-panel" aria-expanded={showNotes} className="knowledge-notes-toggle" onClick={() => setShowNotes(!showNotes)} type="button"><span>Notes & rules <small>{knowledgeQuery.data ? items.length : ""}</small></span><span>{showNotes ? "Hide" : "Browse"}</span></button>{showNotes ? <div id="knowledge-notes-panel"><Panel title="Notes & rules">
            <div className="design-list-toolbar catalog-command-toolbar resource-catalog-toolbar knowledge-repo-toolbar">
              <div className="catalog-toolbar-discovery" aria-label="Knowledge views and search">
                <CatalogViewToggle onChange={setCatalogViewMode} value={catalogViewMode} />
                <CatalogSearchFilter
                  activeFilterCount={knowledgeSearch.trim() ? 1 : 0}
                  ariaLabel="Search knowledge items"
                  onChange={setKnowledgeSearch}
                  placeholder="Search title, description, type, or status"
                  subtitle="Search the active project knowledge catalog."
                  title="Knowledge search"
                  type="search"
                  value={knowledgeSearch}
                >
                  <div className="catalog-filter-actions">
                    <button className="ghost-button" disabled={!knowledgeSearch.trim()} onClick={() => setKnowledgeSearch("")} type="button">
                      Clear search
                    </button>
                  </div>
                </CatalogSearchFilter>
              </div>
              <div className="catalog-toolbar-actions" aria-label="Knowledge actions">
                {canManageKnowledge ? (<button className="primary-button" onClick={handleOpenCreateModal} disabled={!projectId || !canManageKnowledge} type="button">
                  <AddIcon />
                  <span>Add note</span>
                </button>) : null}
              </div>
            </div>

            {filteredItems.length && catalogViewMode === "tile" ? (
              <div className="tile-browser-grid">
                {filteredItems.map((item: any) => (
                  <article
                    aria-label={`Open knowledge item ${item.title}`}
                    className="record-card tile-card knowledge-catalog-card"
                    key={item.id}
                    onClick={() => { const next = new URLSearchParams(searchParams); next.set("item", item.id); setSearchParams(next); }}
                    onKeyDown={(event) => {
                      if (event.target !== event.currentTarget) return;
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        const next = new URLSearchParams(searchParams); next.set("item", item.id); setSearchParams(next);
                      }
                    }}
                    role="button"
                    tabIndex={0}
                  >
                    <div className="tile-card-main">
                      <div className="tile-card-select-row">
                        <span className="badge badge-neutral">{item.content_type || "text"}</span>
                        {canManageKnowledge ? <div onClick={(event) => event.stopPropagation()}>
                          <CatalogActionMenu actions={getKnowledgeActions(item)} label={`${item.title} actions`} />
                        </div> : null}
                      </div>
                      <div className="tile-card-header">
                        <div className="tile-card-title-group">
                          <strong>{item.title}</strong>
                        </div>
                      </div>
                      <p className="tile-card-description">
                        {richTextToPlainText(item.description) || richTextToPlainText(item.content).slice(0, 160)}
                      </p>
                      <div className="tile-card-footer">
                        <span className={`badge ${item.is_active ? "badge-success" : "badge-neutral"}`}>
                          {item.is_active ? "Active" : "Inactive"}
                        </span>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            ) : null}

            {filteredItems.length && catalogViewMode === "list" ? <DataTable
              rows={filteredItems}
              columns={[
                {
                  key: "title",
                  label: "Title",
                  render: (item: any) => <button className="knowledge-source-title-button" onClick={() => { const next = new URLSearchParams(searchParams); next.set("item", item.id); setSearchParams(next); }} type="button">{item.title}</button>
                },
                {
                  key: "type",
                  label: "Type",
                  render: (item: any) => <span className="badge badge-neutral">{item.content_type}</span>
                },
                {
                  key: "description",
                  label: "Description",
                  render: (item: any) => richTextToPlainText(item.description) || "—"
                },
                {
                  key: "status",
                  label: "Status",
                  render: (item: any) => (
                    <span className={`badge ${item.is_active ? "badge-success" : "badge-neutral"}`}>
                      {item.is_active ? "Active" : "Inactive"}
                    </span>
                  )
                }
              ]}
              enableColumnResize
              enableHeaderColumnReorder
              emptyMessage="No AI knowledge items found."
              renderRowActions={canManageKnowledge ? (item: any) => (
                <CatalogActionMenu
                  actions={getKnowledgeActions(item)}
                  label={`${item.title} actions`}
                />
              ) : undefined}
              storageKey="hellotest:knowledge:list-columns:v2"
            /> : null}
            {knowledgeQuery.isPending ? <LoadingState label="Loading knowledge notes" /> : knowledgeQuery.isError ? <div className="knowledge-inline-error" role="alert">Notes could not be loaded.<button className="ghost-button compact" onClick={() => void knowledgeQuery.refetch()} type="button">Retry</button></div> : null}
            {!knowledgeQuery.isPending && !knowledgeQuery.isError && !filteredItems.length ? (
              <div className="empty-state compact">
                {items.length ? "No knowledge items match the current search." : "No AI knowledge items found."}
              </div>
            ) : null}
          </Panel></div> : null}</section> : null}
        </div>
      </div>

      {linkedItemId && projectId && (
        <div className="modal-backdrop modal-backdrop--scroll" onClick={closeLinkedKnowledge} role="presentation">
          <div
            aria-labelledby="linked-knowledge-title"
            aria-modal="true"
            className="modal-card requirement-create-modal knowledge-item-modal"
            onClick={(event) => event.stopPropagation()}
            ref={linkedKnowledgeRef}
            role="dialog"
            tabIndex={-1}
          >
            <div className="requirement-create-header">
              <div className="requirement-create-title" style={{ minWidth: 0, overflowWrap: "anywhere" }}>
                <p className="dialog-context-label">Knowledge document</p>
                <h2 className="dialog-title" id="linked-knowledge-title">{linkedItem?.title || "Knowledge document"}</h2>
                {linkedItem && <p>{linkedItem.is_active ? "Active" : "Inactive"} · {linkedItem.content_type || "text"}</p>}
              </div>
              <DialogCloseButton label="Close knowledge document" onClick={closeLinkedKnowledge} />
            </div>
            <div className="requirement-create-modal-body" style={{ minWidth: 0 }}>
              {knowledgeQuery.isPending ? <LoadingState label="Loading knowledge document" />
                : knowledgeQuery.isError ? <p role="alert">The document could not be loaded. Close this dialog and try again.</p>
                : !linkedItem ? <p role="status">This document is unavailable in the selected project.</p>
                : <>
                  {linkedItem.description && <p>{richTextToPlainText(linkedItem.description)}</p>}
                  {linkedItem.metadata?.repository && <p style={{ overflowWrap: "anywhere" }}><strong>Repository:</strong> {String(linkedItem.metadata.repository)}</p>}
                  {linkedItem.metadata?.revision && <p style={{ overflowWrap: "anywhere" }}><strong>Revision:</strong> {String(linkedItem.metadata.revision)}</p>}
                  <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", font: "inherit", margin: 0 }}>{linkedItem.content}</pre>
                </>}
            </div>
            <div className="action-row requirement-create-modal-actions">
              <button type="button" className="ghost-button" onClick={closeLinkedKnowledge}>Close</button>
            </div>
          </div>
        </div>
      )}

      {isModalOpen && (
        <div className="modal-backdrop modal-backdrop--scroll" onClick={closeKnowledgeDialog} role="presentation">
          <div
            aria-labelledby="knowledge-item-dialog-title"
            aria-modal="true"
            className="modal-card requirement-create-modal knowledge-item-modal"
            onClick={(e) => e.stopPropagation()}
            ref={knowledgeDialogRef}
            role="dialog"
            tabIndex={-1}
          >
            <div className="requirement-create-header">
              <div className="requirement-create-title">
                <p className="dialog-context-label">AI knowledge</p>
                <h2 className="dialog-title" id="knowledge-item-dialog-title">{editingId ? "Edit knowledge" : "Add knowledge"}</h2>
                <p>Add a product rule, decision or playbook.</p>
              </div>
              <DialogCloseButton
                disabled={isKnowledgeMutationPending}
                label={`Close ${editingId ? "edit" : "add"} knowledge dialog`}
                onClick={closeKnowledgeDialog}
              />
            </div>
            <form onSubmit={handleSubmit}>
              <div className="requirement-create-modal-body">
                <FormField label="Title" required>
                  <input
                    data-autofocus="true"
                    type="text"
                    value={draft.title}
                    onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                    required
                    placeholder="e.g. User Registration Flow"
                  />
                </FormField>

                <FormField label="Summary (optional)">
                  <RichTextEditor
                    appearance="canonical"
                    rows={3}
                    value={draft.description}
                    onChange={(description) => setDraft({ ...draft, description })}
                    placeholder="Brief summary of this knowledge"
                  />
                </FormField>

                <FormField label="Format" required>
                  <select
                    value={draft.content_type}
                    onChange={(e) => setDraft({ ...draft, content_type: e.target.value })}
                  >
                    <option value="text">Text / Rules</option>
                    <option value="markdown">Markdown Playbook</option>
                    <option value="url">URL Reference</option>
                    <option value="pdf">PDF Reference</option>
                    <option value="image">Screenshot / Image Notes</option>
                  </select>
                </FormField>

                <FormField label="Content" required>
                  <textarea
                    value={draft.content}
                    onChange={(e) => setDraft({ ...draft, content: e.target.value })}
                    rows={6}
                    required
                    placeholder={draft.content_type === "url" ? "https://..." : "Describe the domain rules or test instructions..."}
                  />
                </FormField>

                <FormField label="Active">
                  <label className="checkbox-field">
                    <input
                      type="checkbox"
                      checked={draft.is_active}
                      onChange={(e) => setDraft({ ...draft, is_active: e.target.checked })}
                    />
                    <span>Available to AI</span>
                  </label>
                </FormField>
              </div>
              <div className="action-row requirement-create-modal-actions">
                <button type="button" className="ghost-button" disabled={isKnowledgeMutationPending} onClick={closeKnowledgeDialog}>
                  Cancel
                </button>
                <button type="submit" className="primary-button" disabled={isKnowledgeMutationPending}>
                  {isKnowledgeMutationPending ? "Saving…" : editingId ? "Save changes" : "Add note"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
