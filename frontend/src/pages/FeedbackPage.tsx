import { FormEvent, useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../auth/AuthContext";
import { MessageIcon } from "../components/AppIcons";
import { FormField } from "../components/FormField";
import { PageHeader } from "../components/PageHeader";
import { Panel } from "../components/Panel";
import { TileCardSkeletonGrid } from "../components/TileCardSkeletonGrid";
import { TileCardStatusIndicator, formatTileCardLabel, getTileCardTone } from "../components/TileCardPrimitives";
import { WorkspaceBackButton, WorkspaceMasterDetail } from "../components/WorkspaceMasterDetail";
import { useDeleteConfirmation } from "../components/DeleteConfirmationDialog";
import { useDomainMetadata } from "../hooks/useDomainMetadata";
import { api } from "../lib/api";
import { useWorkspaceData } from "../hooks/useWorkspaceData";
import type { Feedback } from "../types";

type FeedbackDraft = {
  title: string;
  message: string;
  status: string;
};

const createEmptyFeedbackDraft = (defaultStatus = "open"): FeedbackDraft => ({
  title: "",
  message: "",
  status: defaultStatus
});

export function FeedbackPage() {
  const queryClient = useQueryClient();
  const { session } = useAuth();
  const { confirmDelete, confirmationDialog } = useDeleteConfirmation();
  const domainMetadataQuery = useDomainMetadata();
  const { feedback } = useWorkspaceData();
  const defaultFeedbackStatus = domainMetadataQuery.data?.feedback.default_status || "open";
  const feedbackStatusOptions = domainMetadataQuery.data?.feedback.statuses || [];
  const emptyDraft = useMemo(() => createEmptyFeedbackDraft(defaultFeedbackStatus), [defaultFeedbackStatus]);
  const [selectedFeedbackId, setSelectedFeedbackId] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [draft, setDraft] = useState<FeedbackDraft>(() => createEmptyFeedbackDraft());
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState<"success" | "error">("success");

  const items = feedback.data || [];
  const openFeedbackCount = items.filter((item) => (item.status || defaultFeedbackStatus) === defaultFeedbackStatus).length;
  const selectedItem = useMemo(
    () => items.find((item) => item.id === selectedFeedbackId) || null,
    [items, selectedFeedbackId]
  );

  useEffect(() => {
    if (isCreating) {
      return;
    }

    if (!selectedFeedbackId) {
      setDraft(emptyDraft);
      return;
    }

    if (selectedItem) {
      setDraft({
        title: selectedItem.title,
        message: selectedItem.message,
        status: selectedItem.status || defaultFeedbackStatus
      });
      return;
    }

    setSelectedFeedbackId("");
    setDraft(emptyDraft);
  }, [defaultFeedbackStatus, emptyDraft, isCreating, selectedFeedbackId, selectedItem]);

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ["feedback"] });
  };

  const createFeedback = useMutation({
    mutationFn: api.feedback.create,
    onSuccess: async () => {
      setMessageTone("success");
      setMessage("Feedback saved.");
      await refresh();
    },
    onError: (error) => {
      setMessageTone("error");
      setMessage(error instanceof Error ? error.message : "Unable to save feedback");
    }
  });

  const updateFeedback = useMutation({
    mutationFn: ({ id, input }: { id: string; input: Parameters<typeof api.feedback.update>[1] }) =>
      api.feedback.update(id, input),
    onSuccess: async () => {
      setMessageTone("success");
      setMessage("Feedback updated.");
      await refresh();
    },
    onError: (error) => {
      setMessageTone("error");
      setMessage(error instanceof Error ? error.message : "Unable to update feedback");
    }
  });

  const deleteFeedback = useMutation({
    mutationFn: api.feedback.delete,
    onSuccess: async () => {
      setMessageTone("success");
      setMessage("Feedback deleted.");
      setSelectedFeedbackId("");
      setDraft(emptyDraft);
      setIsCreating(false);
      await refresh();
    },
    onError: (error) => {
      setMessageTone("error");
      setMessage(error instanceof Error ? error.message : "Unable to delete feedback");
    }
  });

  const handleSave = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!session?.user.id) {
      return;
    }

    if (isCreating || !selectedItem) {
      const response = await createFeedback.mutateAsync({
        user_id: session.user.id,
        title: draft.title,
        message: draft.message,
        status: draft.status
      });
      setSelectedFeedbackId(response.id);
      setIsCreating(false);
      return;
    }

    await updateFeedback.mutateAsync({
      id: selectedItem.id,
      input: {
        title: draft.title,
        message: draft.message,
        status: draft.status
      }
    });
  };

  const closeFeedbackWorkspace = () => {
    setSelectedFeedbackId("");
    setIsCreating(false);
    setDraft(emptyDraft);
  };

  return (
    <div className="page-content">
      {confirmationDialog}
      <PageHeader
        eyebrow="Reporting & Feedback"
        title="Reporting & Feedback"
        description="Capture bugs, product requests, and workflow feedback in a shared queue the whole team can track."
        meta={[
          { label: "Entries", value: items.length },
          { label: "Open", value: openFeedbackCount },
          { label: "Selected", value: isCreating ? "New draft" : selectedItem?.status || "None" }
        ]}
        actions={
          <button
            className="primary-button"
            onClick={() => {
              setIsCreating(true);
              setSelectedFeedbackId("");
              setDraft(emptyDraft);
            }}
            type="button"
          >
            <MessageIcon />
            Add Feedback
          </button>
        }
      />

      {message ? <p className={messageTone === "error" ? "inline-message error-message" : "inline-message success-message"}>{message}</p> : null}

      <WorkspaceMasterDetail
        browseView={(
          <Panel title="Feedback tiles" subtitle="Open one thread at a time from a card-first stream without keeping a split panel on screen.">
            {feedback.isLoading ? (
              <TileCardSkeletonGrid />
            ) : null}

            <div className="tile-browser-grid">
              {items.map((item: Feedback) => {
                const feedbackTone = getTileCardTone(item.status || defaultFeedbackStatus);
                const feedbackStatus = formatTileCardLabel(item.status, "Open");

                return (
                  <button
                    key={item.id}
                    className={selectedFeedbackId === item.id ? "record-card tile-card is-active" : "record-card tile-card"}
                    onClick={() => {
                      setSelectedFeedbackId(item.id);
                      setIsCreating(false);
                    }}
                    type="button"
                  >
                    <div className="tile-card-main">
                      <div className="tile-card-header">
                        <span className="feedback-card-badge">FB</span>
                        <div className="tile-card-title-group">
                          <strong>{item.title}</strong>
                          <span className="tile-card-kicker">{item.user_name || item.user_email || item.user_id}</span>
                        </div>
                        <TileCardStatusIndicator title={feedbackStatus} tone={feedbackTone} />
                      </div>
                      <p className="tile-card-description">{item.message}</p>
                      <div className="feedback-card-footer">
                        <span className="count-pill">{feedbackStatus}</span>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>

            {!feedback.isLoading && !items.length ? <div className="empty-state compact">No feedback submitted yet.</div> : null}
          </Panel>
        )}
        detailView={(
          <Panel
            actions={<WorkspaceBackButton label="Back to feedback tiles" onClick={closeFeedbackWorkspace} />}
            title={isCreating ? "New feedback" : selectedItem ? "Selected feedback" : "Feedback editor"}
            subtitle="Use this space to capture requests, issues, or ideas and keep the thread visible to the whole team."
          >
            {(isCreating || selectedItem) ? (
              <form className="form-grid" onSubmit={(event) => void handleSave(event)}>
              <FormField label="Title">
                <input required value={draft.title} onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))} />
              </FormField>
              <FormField label="Status">
                <select value={draft.status} onChange={(event) => setDraft((current) => ({ ...current, status: event.target.value }))}>
                  {feedbackStatusOptions.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </FormField>
              <FormField label="Message">
                <textarea required rows={8} value={draft.message} onChange={(event) => setDraft((current) => ({ ...current, message: event.target.value }))} />
              </FormField>
              <div className="action-row">
                <button className="primary-button" type="submit">{isCreating ? "Save feedback" : "Update feedback"}</button>
                {!isCreating && selectedItem ? (
                  <button
                    className="ghost-button danger"
                    onClick={async () => {
                      if (await confirmDelete({ message: `Delete feedback "${selectedItem.title}"?` })) {
                        void deleteFeedback.mutateAsync(selectedItem.id);
                      }
                    }}
                    type="button"
                  >
                    Delete feedback
                  </button>
                ) : null}
              </div>
            </form>
            ) : (
              <div className="empty-state compact">Select feedback from the tiles or create a new entry.</div>
            )}
          </Panel>
        )}
        isDetailOpen={isCreating || Boolean(selectedItem)}
      />
    </div>
  );
}
