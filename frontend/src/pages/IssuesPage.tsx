import { FormEvent, useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { BugIcon, ClearSelectionIcon, SelectAllIcon } from "../components/AppIcons";
import { CatalogSearchFilter } from "../components/CatalogSearchFilter";
import { CatalogViewToggle } from "../components/CatalogViewToggle";
import { DataTable, type DataTableColumn } from "../components/DataTable";
import { FormField } from "../components/FormField";
import { PageHeader } from "../components/PageHeader";
import { Panel } from "../components/Panel";
import { TileCardSkeletonGrid } from "../components/TileCardSkeletonGrid";
import { TileCardStatusIndicator, formatTileCardLabel, getTileCardTone } from "../components/TileCardPrimitives";
import { WorkspaceBackButton, WorkspaceMasterDetail } from "../components/WorkspaceMasterDetail";
import { useDeleteConfirmation } from "../components/DeleteConfirmationDialog";
import { useDomainMetadata } from "../hooks/useDomainMetadata";
import { api } from "../lib/api";
import { readDefaultCatalogViewMode } from "../lib/viewPreferences";
import { useWorkspaceData } from "../hooks/useWorkspaceData";
import type { Issue } from "../types";

type IssueDraft = {
  title: string;
  message: string;
  status: string;
};

const DEFAULT_ISSUE_STATUS_OPTIONS = [
  { value: "open", label: "Open" },
  { value: "reviewed", label: "Reviewed" },
  { value: "planned", label: "Planned" },
  { value: "closed", label: "Closed" }
];

const createEmptyIssueDraft = (defaultStatus = "open"): IssueDraft => ({
  title: "",
  message: "",
  status: defaultStatus
});

const createIssueDraftFromQuery = (searchParams: URLSearchParams, defaultStatus: string): IssueDraft => {
  const runId = searchParams.get("run") || "";
  const title = searchParams.get("title") || (runId ? `Run issue: ${runId}` : "");
  const message = searchParams.get("message") || [
    "Reported from run details.",
    "",
    runId ? `Run ID: ${runId}` : "",
    searchParams.get("runName") ? `Run name: ${searchParams.get("runName")}` : "",
    searchParams.get("status") ? `Run status: ${searchParams.get("status")}` : "",
    "",
    "Issue details:"
  ].filter((line) => line !== "").join("\n");

  return {
    title,
    message,
    status: defaultStatus
  };
};

export function IssuesPage() {
  const queryClient = useQueryClient();
  const { session } = useAuth();
  const { confirmDelete, confirmationDialog } = useDeleteConfirmation();
  const domainMetadataQuery = useDomainMetadata();
  const { issues } = useWorkspaceData();
  const [searchParams, setSearchParams] = useSearchParams();
  const issueMetadata = domainMetadataQuery.data?.issues || domainMetadataQuery.data?.feedback;
  const defaultIssueStatus = issueMetadata?.default_status || "open";
  const issueStatusOptions = issueMetadata?.statuses?.length ? issueMetadata.statuses : DEFAULT_ISSUE_STATUS_OPTIONS;
  const emptyDraft = useMemo(() => createEmptyIssueDraft(defaultIssueStatus), [defaultIssueStatus]);
  const [selectedIssueId, setSelectedIssueId] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [draft, setDraft] = useState<IssueDraft>(() => createEmptyIssueDraft());
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState<"success" | "error">("success");
  const [catalogViewMode, setCatalogViewMode] = useState<"tile" | "list">(() => readDefaultCatalogViewMode());
  const [selectedActionIssueIds, setSelectedActionIssueIds] = useState<string[]>([]);
  const [issueSearch, setIssueSearch] = useState("");

  const items = issues.data || [];
  const filteredItems = useMemo(() => {
    const normalizedSearch = issueSearch.trim().toLowerCase();

    if (!normalizedSearch) {
      return items;
    }

    return items.filter((item) =>
      [
        item.id,
        item.title,
        item.message,
        item.status,
        item.user_name,
        item.user_email,
        item.user_id
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(normalizedSearch)
    );
  }, [issueSearch, items]);
  const visibleIssueIds = useMemo(() => filteredItems.map((item) => item.id), [filteredItems]);
  const areAllFilteredIssuesSelected = visibleIssueIds.length > 0 && visibleIssueIds.every((id) => selectedActionIssueIds.includes(id));
  const openIssueCount = items.filter((item) => (item.status || defaultIssueStatus) === defaultIssueStatus).length;
  const selectedItem = useMemo(
    () => items.find((item) => item.id === selectedIssueId) || null,
    [items, selectedIssueId]
  );
  const issueListColumns = useMemo<Array<DataTableColumn<Issue>>>(() => [
    {
      key: "title",
      label: "Issue",
      canToggle: false,
      width: 280,
      minWidth: 180,
      sortValue: (item) => item.title,
      render: (item) => (
        <div className="data-table-multiline">
          <strong>{item.title}</strong>
          <span className="data-table-multiline-line">{item.message}</span>
        </div>
      )
    },
    {
      key: "status",
      label: "Status",
      width: 132,
      minWidth: 104,
      sortValue: (item) => item.status || defaultIssueStatus,
      render: (item) => formatTileCardLabel(item.status, "Open")
    },
    {
      key: "reporter",
      label: "Reporter",
      width: 220,
      minWidth: 150,
      sortValue: (item) => item.user_name || item.user_email || item.user_id || "",
      render: (item) => item.user_name || item.user_email || item.user_id || "Unknown"
    },
    {
      key: "message",
      label: "Message",
      defaultVisible: false,
      width: 360,
      minWidth: 200,
      render: (item) => item.message
    }
  ], [defaultIssueStatus]);

  useEffect(() => {
    if (searchParams.get("create") !== "1") {
      return;
    }

    setIsCreating(true);
    setSelectedIssueId("");
    setDraft(createIssueDraftFromQuery(searchParams, defaultIssueStatus));

    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete("create");
    setSearchParams(nextParams, { replace: true });
  }, [defaultIssueStatus, searchParams, setSearchParams]);

  useEffect(() => {
    if (isCreating) {
      return;
    }

    if (!selectedIssueId) {
      setDraft(emptyDraft);
      return;
    }

    if (selectedItem) {
      setDraft({
        title: selectedItem.title,
        message: selectedItem.message,
        status: selectedItem.status || defaultIssueStatus
      });
      return;
    }

    setSelectedIssueId("");
    setDraft(emptyDraft);
  }, [defaultIssueStatus, emptyDraft, isCreating, selectedIssueId, selectedItem]);

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ["issues"] });
  };

  const createIssue = useMutation({
    mutationFn: api.issues.create,
    onSuccess: async () => {
      setMessageTone("success");
      setMessage("Issue saved.");
      await refresh();
    },
    onError: (error) => {
      setMessageTone("error");
      setMessage(error instanceof Error ? error.message : "Unable to save issue");
    }
  });

  const updateIssue = useMutation({
    mutationFn: ({ id, input }: { id: string; input: Parameters<typeof api.issues.update>[1] }) =>
      api.issues.update(id, input),
    onSuccess: async () => {
      setMessageTone("success");
      setMessage("Issue updated.");
      await refresh();
    },
    onError: (error) => {
      setMessageTone("error");
      setMessage(error instanceof Error ? error.message : "Unable to update issue");
    }
  });

  const deleteIssue = useMutation({
    mutationFn: api.issues.delete,
    onSuccess: async () => {
      setMessageTone("success");
      setMessage("Issue deleted.");
      setSelectedIssueId("");
      setDraft(emptyDraft);
      setIsCreating(false);
      await refresh();
    },
    onError: (error) => {
      setMessageTone("error");
      setMessage(error instanceof Error ? error.message : "Unable to delete issue");
    }
  });

  const handleSave = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!session?.user.id) {
      return;
    }

    if (isCreating || !selectedItem) {
      const response = await createIssue.mutateAsync({
        user_id: session.user.id,
        title: draft.title,
        message: draft.message,
        status: draft.status
      });
      setSelectedIssueId(response.id);
      setIsCreating(false);
      return;
    }

    await updateIssue.mutateAsync({
      id: selectedItem.id,
      input: {
        title: draft.title,
        message: draft.message,
        status: draft.status
      }
    });
  };

  const closeIssueWorkspace = () => {
    setSelectedIssueId("");
    setIsCreating(false);
    setDraft(emptyDraft);
  };

  return (
    <div className="page-content">
      {confirmationDialog}
      <PageHeader
        eyebrow="Issues"
        title="Issues"
        description="Capture bugs, product requests, and run follow-ups in a shared queue the whole team can track."
        meta={[
          { label: "Issues", value: items.length },
          { label: "Open", value: openIssueCount },
          { label: "Selected", value: isCreating ? "New draft" : selectedItem?.status || "None" }
        ]}
        actions={
          <button
            className="primary-button"
            onClick={() => {
              setIsCreating(true);
              setSelectedIssueId("");
              setDraft(emptyDraft);
            }}
            type="button"
          >
            <BugIcon />
            Report Issue
          </button>
        }
      />

      {message ? <p className={messageTone === "error" ? "inline-message error-message" : "inline-message success-message"}>{message}</p> : null}

      <WorkspaceMasterDetail
        browseView={(
          <Panel title="Issues" titleVariant="eyebrow" subtitle="Open one issue at a time from a card-first queue without keeping a split panel on screen.">
            <div className="design-list-toolbar issue-catalog-toolbar">
              <CatalogSearchFilter
                activeFilterCount={issueSearch.trim() ? 1 : 0}
                ariaLabel="Search issues"
                onChange={setIssueSearch}
                placeholder="Search issues"
                subtitle="Search by title, message, status, or reporter."
                title="Issue search"
                type="search"
                value={issueSearch}
              >
                <div className="catalog-filter-grid">
                  <div className="catalog-filter-actions">
                    <button className="ghost-button" disabled={!issueSearch.trim()} onClick={() => setIssueSearch("")} type="button">
                      Clear search
                    </button>
                  </div>
                </div>
              </CatalogSearchFilter>
              <button
                className="ghost-button catalog-selection-button"
                disabled={!visibleIssueIds.length || areAllFilteredIssuesSelected}
                onClick={() => setSelectedActionIssueIds((current) => Array.from(new Set([...current, ...visibleIssueIds])))}
                type="button"
              >
                <SelectAllIcon />
                <span>Select all</span>
              </button>
              <button
                className="ghost-button catalog-selection-button"
                disabled={!selectedActionIssueIds.length}
                onClick={() => setSelectedActionIssueIds([])}
                type="button"
              >
                <ClearSelectionIcon />
                <span>Clear</span>
              </button>
              <CatalogViewToggle onChange={setCatalogViewMode} value={catalogViewMode} />
            </div>

            {issues.isLoading ? (
              <TileCardSkeletonGrid />
            ) : null}

            {!issues.isLoading && filteredItems.length && catalogViewMode === "tile" ? (
            <div className="tile-browser-grid">
              {filteredItems.map((item: Issue) => {
                const issueTone = getTileCardTone(item.status || defaultIssueStatus);
                const issueStatus = formatTileCardLabel(item.status, "Open");

                return (
                  <button
                    key={item.id}
                    className={selectedIssueId === item.id ? "record-card tile-card is-active" : "record-card tile-card"}
                    onClick={() => {
                      setSelectedIssueId(item.id);
                      setIsCreating(false);
                    }}
                    type="button"
                  >
                    <div className="tile-card-main">
                      <div className="tile-card-select-row" onClick={(event) => event.stopPropagation()}>
                        <label className="checkbox-field">
                          <input
                            aria-label={`Select ${item.title}`}
                            checked={selectedActionIssueIds.includes(item.id)}
                            onChange={() =>
                              setSelectedActionIssueIds((current) =>
                                current.includes(item.id) ? current.filter((id) => id !== item.id) : [...current, item.id]
                              )
                            }
                            type="checkbox"
                          />
                          <span className="sr-only">Select issue</span>
                        </label>
                      </div>
                      <div className="tile-card-header">
                        <span className="issue-card-badge">IS</span>
                        <div className="tile-card-title-group">
                          <strong>{item.title}</strong>
                          <span className="tile-card-kicker">{item.user_name || item.user_email || item.user_id}</span>
                        </div>
                        <TileCardStatusIndicator title={issueStatus} tone={issueTone} />
                      </div>
                      <p className="tile-card-description">{item.message}</p>
                      <div className="issue-card-footer">
                        <span className="count-pill">{issueStatus}</span>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
            ) : null}

            {!issues.isLoading && filteredItems.length && catalogViewMode === "list" ? (
              <DataTable
                columns={issueListColumns}
                enableColumnResize
                enableHeaderColumnReorder
                emptyMessage="No issues match the current search."
                getRowClassName={(item) => (selectedIssueId === item.id ? "is-active-row" : "")}
                getRowKey={(item) => item.id}
                hideToolbarCopy
                onRowClick={(item) => {
                  setSelectedIssueId(item.id);
                  setIsCreating(false);
                }}
                rows={filteredItems}
                storageKey="qaira:issues:list-columns"
              />
            ) : null}

            {!issues.isLoading && !items.length ? <div className="empty-state compact">No issues reported yet.</div> : null}
            {!issues.isLoading && items.length > 0 && !filteredItems.length ? <div className="empty-state compact">No issues match the current search.</div> : null}
          </Panel>
        )}
        detailView={(
          <Panel
            actions={<WorkspaceBackButton label="Back to issue tiles" onClick={closeIssueWorkspace} />}
            title={isCreating ? "New issue" : selectedItem ? "Selected issue" : "Issue editor"}
            subtitle="Use this space to capture bugs, requests, or run follow-ups and keep the thread visible to the whole team."
          >
            {(isCreating || selectedItem) ? (
              <form className="form-grid" onSubmit={(event) => void handleSave(event)}>
                <FormField label="Title">
                  <input required value={draft.title} onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))} />
                </FormField>
                <FormField label="Status">
                  <select value={draft.status} onChange={(event) => setDraft((current) => ({ ...current, status: event.target.value }))}>
                    {issueStatusOptions.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </FormField>
                <FormField label="Message">
                  <textarea required rows={8} value={draft.message} onChange={(event) => setDraft((current) => ({ ...current, message: event.target.value }))} />
                </FormField>
                <div className="action-row">
                  <button className="primary-button" type="submit">{isCreating ? "Save issue" : "Update issue"}</button>
                  {!isCreating && selectedItem ? (
                    <button
                      className="ghost-button danger"
                      onClick={async () => {
                        if (await confirmDelete({ message: `Delete issue "${selectedItem.title}"?` })) {
                          void deleteIssue.mutateAsync(selectedItem.id);
                        }
                      }}
                      type="button"
                    >
                      Delete issue
                    </button>
                  ) : null}
                </div>
              </form>
            ) : (
              <div className="empty-state compact">Select an issue from the tiles or create a new entry.</div>
            )}
          </Panel>
        )}
        isDetailOpen={isCreating || Boolean(selectedItem)}
      />
    </div>
  );
}
