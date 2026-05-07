import { useState, FormEvent } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useCurrentProject, useCurrentAppType } from "../hooks/useCurrentProject";
import { api } from "../lib/api";
import { PageHeader } from "../components/PageHeader";
import { DataTable } from "../components/DataTable";
import { AddIcon, TrashIcon, OpenIcon } from "../components/AppIcons";
import { ToastMessage } from "../components/ToastMessage";
import { FormField } from "../components/FormField";
import { useDeleteConfirmation } from "../components/DeleteConfirmationDialog";

export function KnowledgeRepoPage() {
  const queryClient = useQueryClient();
  const [projectId] = useCurrentProject();
  const [appTypeId] = useCurrentAppType(projectId);
  const { confirmDelete, confirmationDialog } = useDeleteConfirmation();

  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState<"success" | "error">("success");
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const [draft, setDraft] = useState({
    title: "",
    description: "",
    content_type: "text",
    content: "",
    is_active: true
  });

  const knowledgeQuery = useQuery({
    queryKey: ["knowledge", projectId],
    queryFn: () => api.knowledgeRepo.list(projectId),
    enabled: Boolean(projectId)
  });

  const createKnowledge = useMutation({
    mutationFn: (data: any) => api.knowledgeRepo.create(projectId, { ...data, app_type_id: appTypeId })
  });

  const updateKnowledge = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => api.knowledgeRepo.update(projectId, id, { ...data, app_type_id: appTypeId })
  });

  const deleteKnowledge = useMutation({
    mutationFn: (id: string) => api.knowledgeRepo.delete(projectId, id)
  });

  const items = knowledgeQuery.data || [];

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

    try {
      if (editingId) {
        await updateKnowledge.mutateAsync({ id: editingId, data: draft });
        showSuccess("Knowledge item updated successfully.");
      } else {
        await createKnowledge.mutateAsync(draft);
        showSuccess("Knowledge item created successfully.");
      }
      setIsModalOpen(false);
      queryClient.invalidateQueries({ queryKey: ["knowledge", projectId] });
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
      } catch (error) {
        showError(error, "Failed to delete item.");
      }
    }
  };

  return (
    <div className="workspace-layout">
      {confirmationDialog}
      <ToastMessage message={message} tone={messageTone} onDismiss={() => setMessage("")} />
      
      <div className="workspace-main">
        <PageHeader eyebrow="Administration" title="AI Knowledge Base" description="Train the AI on your domain-specific rules, flows, and terminology." />
        
        <div className="workspace-toolbar">
          <div className="workspace-toolbar-actions">
            <button className="button" onClick={handleOpenCreateModal} disabled={!projectId}>
              <AddIcon />
              Add Knowledge
            </button>
          </div>
        </div>

        <div className="workspace-content">
          <DataTable
            rows={items}
            columns={[
              {
                key: "title",
                label: "Title",
                render: (item: any) => <strong>{item.title}</strong>
              },
              {
                key: "type",
                label: "Type",
                render: (item: any) => <span className="badge badge-neutral">{item.content_type}</span>
              },
              {
                key: "description",
                label: "Description",
                render: (item: any) => item.description || "—"
              },
              {
                key: "status",
                label: "Status",
                render: (item: any) => (
                  <span className={`badge ${item.is_active ? "badge-success" : "badge-neutral"}`}>
                    {item.is_active ? "Active" : "Inactive"}
                  </span>
                )
              },
              {
                key: "actions",
                label: "Actions",
                render: (item: any) => (
                  <div className="flex gap-2">
                    <button className="button button-small button-ghost" onClick={() => handleOpenEditModal(item)} title="Edit">
                      <OpenIcon />
                    </button>
                    <button className="button button-small button-ghost text-danger" onClick={() => handleDelete(item.id)} title="Delete">
                      <TrashIcon />
                    </button>
                  </div>
                )
              }
            ]}
            emptyMessage="No AI knowledge items found."
          />
        </div>
      </div>

      {isModalOpen && (
        <div className="modal-overlay" onClick={() => setIsModalOpen(false)}>
          <div className="modal-content" style={{ maxWidth: "600px", width: "100%" }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>{editingId ? "Edit Knowledge" : "Add Knowledge"}</h2>
            </div>
            <form onSubmit={handleSubmit}>
              <div className="modal-body" style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
                <FormField label="Title" required>
                  <input
                    type="text"
                    className="input"
                    value={draft.title}
                    onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                    required
                    placeholder="e.g. User Registration Flow"
                  />
                </FormField>

                <FormField label="Description">
                  <input
                    type="text"
                    className="input"
                    value={draft.description}
                    onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                    placeholder="Brief summary of this knowledge"
                  />
                </FormField>

                <FormField label="Content Type" required>
                  <select
                    className="input"
                    value={draft.content_type}
                    onChange={(e) => setDraft({ ...draft, content_type: e.target.value })}
                  >
                    <option value="text">Text / Rules</option>
                    <option value="url">URL Reference</option>
                  </select>
                </FormField>

                <FormField label="Content" required>
                  <textarea
                    className="input"
                    value={draft.content}
                    onChange={(e) => setDraft({ ...draft, content: e.target.value })}
                    rows={6}
                    required
                    placeholder={draft.content_type === "url" ? "https://..." : "Describe the domain rules or test instructions..."}
                  />
                </FormField>

                <FormField label="Active">
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={draft.is_active}
                      onChange={(e) => setDraft({ ...draft, is_active: e.target.checked })}
                    />
                    <span>Use this knowledge in AI prompt generation</span>
                  </label>
                </FormField>
              </div>
              <div className="modal-footer">
                <button type="button" className="button button-ghost" onClick={() => setIsModalOpen(false)}>
                  Cancel
                </button>
                <button type="submit" className="button button-primary" disabled={createKnowledge.isPending || updateKnowledge.isPending}>
                  {editingId ? "Save Changes" : "Create"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
