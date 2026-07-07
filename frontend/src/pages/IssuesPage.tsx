import { FormEvent, useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { BugIcon, ExportIcon } from "../components/AppIcons";
import { CatalogSelectionControls } from "../components/CatalogSelectionControls";
import { CatalogSearchFilter } from "../components/CatalogSearchFilter";
import { CatalogViewToggle } from "../components/CatalogViewToggle";
import { DataTable, type DataTableColumn } from "../components/DataTable";
import { DisplayIdBadge } from "../components/DisplayIdBadge";
import { FormField } from "../components/FormField";
import { PageHeader } from "../components/PageHeader";
import { Panel } from "../components/Panel";
import { RichTextContent, RichTextEditor, richTextToPlainText } from "../components/RichTextEditor";
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
  steps_to_reproduce: string;
  expected_result: string;
  actual_result: string;
  severity: string;
  priority: string;
  environment: string;
  build: string;
  jira_bug_key: string;
  linked_test_run_id: string;
  assignee_id: string;
  root_cause: string;
  status: string;
};

const DEFAULT_ISSUE_STATUS_OPTIONS = [
  { value: "open", label: "Open" },
  { value: "reviewed", label: "Reviewed" },
  { value: "planned", label: "Planned" },
  { value: "closed", label: "Closed" }
];

const ISSUE_SEVERITY_OPTIONS = [
  { value: "", label: "Not set" },
  { value: "critical", label: "Critical" },
  { value: "high", label: "High" },
  { value: "medium", label: "Medium" },
  { value: "low", label: "Low" }
];

const ISSUE_PRIORITY_OPTIONS = [
  { value: "", label: "Not set" },
  { value: "p1", label: "P1" },
  { value: "p2", label: "P2" },
  { value: "p3", label: "P3" },
  { value: "p4", label: "P4" }
];

const createEmptyIssueDraft = (defaultStatus = "open"): IssueDraft => ({
  title: "",
  message: "",
  steps_to_reproduce: "",
  expected_result: "",
  actual_result: "",
  severity: "",
  priority: "",
  environment: "",
  build: "",
  jira_bug_key: "",
  linked_test_run_id: "",
  assignee_id: "",
  root_cause: "",
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
    steps_to_reproduce: "",
    expected_result: "",
    actual_result: "",
    severity: "",
    priority: "",
    environment: searchParams.get("environment") || "",
    build: searchParams.get("build") || "",
    jira_bug_key: searchParams.get("jira") || searchParams.get("jiraBugKey") || "",
    linked_test_run_id: runId,
    assignee_id: "",
    root_cause: "",
    status: defaultStatus
  };
};

const optionalDraftValue = (value: string) => {
  return value.trim();
};

const buildIssuePayload = (draft: IssueDraft, userId: string) => ({
  user_id: userId,
  title: draft.title,
  message: draft.message,
  steps_to_reproduce: optionalDraftValue(draft.steps_to_reproduce),
  expected_result: optionalDraftValue(draft.expected_result),
  actual_result: optionalDraftValue(draft.actual_result),
  severity: optionalDraftValue(draft.severity),
  priority: optionalDraftValue(draft.priority),
  environment: optionalDraftValue(draft.environment),
  build: optionalDraftValue(draft.build),
  jira_bug_key: optionalDraftValue(draft.jira_bug_key),
  linked_test_run_id: optionalDraftValue(draft.linked_test_run_id),
  assignee_id: optionalDraftValue(draft.assignee_id),
  root_cause: optionalDraftValue(draft.root_cause),
  status: draft.status
});

const csvEscape = (value: unknown) => {
  const text = String(value ?? "").replace(/\r?\n/g, " ").trim();
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

const downloadCsv = (filename: string, rows: string[][]) => {
  const csv = rows.map((row) => row.map(csvEscape).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
};

export function IssuesPage() {
  const queryClient = useQueryClient();
  const { session } = useAuth();
  const { confirmDelete, confirmationDialog } = useDeleteConfirmation();
  const domainMetadataQuery = useDomainMetadata();
  const { issues, users, executions } = useWorkspaceData();
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
  const userItems = users.data || [];
  const executionItems = executions.data || [];
  const executionById = useMemo(() => new Map(executionItems.map((execution) => [execution.id, execution])), [executionItems]);
  const assigneeLabelById = useMemo(
    () => new Map(userItems.map((user) => [user.id, user.name || user.email || user.id])),
    [userItems]
  );
  const runLabelById = useMemo(
    () => new Map(executionItems.map((execution) => [
      execution.id,
      [
        execution.name || execution.id,
        execution.status || null,
        execution.release ? `Release ${execution.release}` : null,
        execution.build ? `Build ${execution.build}` : null
      ].filter(Boolean).join(" · ")
    ])),
    [executionItems]
  );
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
        item.severity,
        item.priority,
        item.environment,
        item.build,
        item.jira_bug_key,
        item.linked_test_run_id,
        runLabelById.get(item.linked_test_run_id || ""),
        item.assignee_id,
        assigneeLabelById.get(item.assignee_id || ""),
        item.assignee_name,
        item.assignee_email,
        item.steps_to_reproduce,
        item.expected_result,
        item.actual_result,
        item.root_cause,
        item.user_name,
        item.user_email,
        item.user_id
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(normalizedSearch)
    );
  }, [assigneeLabelById, issueSearch, items, runLabelById]);
  const visibleIssueIds = useMemo(() => filteredItems.map((item) => item.id), [filteredItems]);
  const areAllFilteredIssuesSelected = visibleIssueIds.length > 0 && visibleIssueIds.every((id) => selectedActionIssueIds.includes(id));
  const openIssueCount = items.filter((item) => (item.status || defaultIssueStatus) === defaultIssueStatus).length;
  const selectedItem = useMemo(
    () => items.find((item) => item.id === selectedIssueId) || null,
    [items, selectedIssueId]
  );
  const syncIssueSearchParams = (issueId?: string | null) => {
    const currentIssueId = searchParams.get("issue") || "";
    const targetIssueId = issueId || "";

    if (currentIssueId === targetIssueId) {
      return;
    }

    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (targetIssueId) {
        next.set("issue", targetIssueId);
      } else {
        next.delete("issue");
      }
      return next;
    }, { replace: true });
  };
  const openIssueWorkspace = (issueId: string) => {
    syncIssueSearchParams(issueId);
    setSelectedIssueId(issueId);
    setIsCreating(false);
  };
  const issueListColumns = useMemo<Array<DataTableColumn<Issue>>>(() => [
    {
      key: "id",
      label: "ID",
      width: 132,
      minWidth: 100,
      sortValue: (item) => item.id,
      render: (item) => <DisplayIdBadge value={item.id} />
    },
    {
      key: "title",
      label: "Issue Title",
      canToggle: false,
      width: 280,
      minWidth: 180,
      sortValue: (item) => item.title,
      render: (item) => (
        <div className="data-table-multiline">
          <strong>{item.title}</strong>
        </div>
      )
    },
    {
      key: "description",
      label: "Description",
      width: 360,
      minWidth: 200,
      render: (item) => <span className="data-table-description-clamp">{richTextToPlainText(item.message)}</span>
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
      key: "jira",
      label: "Jira Bug Key",
      width: 150,
      minWidth: 120,
      sortValue: (item) => item.jira_bug_key || "",
      render: (item) => item.jira_bug_key || "—"
    },
    {
      key: "severity",
      label: "Severity",
      width: 132,
      minWidth: 104,
      sortValue: (item) => item.severity || "",
      render: (item) => formatTileCardLabel(item.severity, "Not set")
    },
    {
      key: "priority",
      label: "Priority",
      width: 120,
      minWidth: 96,
      sortValue: (item) => item.priority || "",
      render: (item) => formatTileCardLabel(item.priority, "Not set")
    },
    {
      key: "linkedRun",
      label: "Linked Test Run",
      defaultVisible: false,
      width: 240,
      minWidth: 160,
      sortValue: (item) => runLabelById.get(item.linked_test_run_id || "") || item.linked_test_run_id || "",
      render: (item) => runLabelById.get(item.linked_test_run_id || "") || item.linked_test_run_id || "—"
    },
    {
      key: "environment",
      label: "Environment",
      defaultVisible: false,
      width: 160,
      minWidth: 120,
      sortValue: (item) => item.environment || "",
      render: (item) => item.environment || "—"
    },
    {
      key: "build",
      label: "Build",
      defaultVisible: false,
      width: 150,
      minWidth: 110,
      sortValue: (item) => item.build || "",
      render: (item) => item.build || "—"
    },
    {
      key: "assignee",
      label: "Assignee",
      width: 220,
      minWidth: 150,
      sortValue: (item) => item.assignee_name || item.assignee_email || assigneeLabelById.get(item.assignee_id || "") || "",
      render: (item) => item.assignee_name || item.assignee_email || assigneeLabelById.get(item.assignee_id || "") || "Unassigned"
    },
    {
      key: "reporter",
      label: "Reporter",
      defaultVisible: false,
      width: 220,
      minWidth: 150,
      sortValue: (item) => item.user_name || item.user_email || item.user_id || "",
      render: (item) => item.user_name || item.user_email || item.user_id || "Unknown"
    },
  ], [assigneeLabelById, defaultIssueStatus, runLabelById]);

  const handleExportIssuesCsv = () => {
    downloadCsv("issues.csv", [
      ["ID", "Issue Title", "Description", "Status", "Jira Bug Key", "Severity", "Priority", "Linked Test Run", "Environment", "Build", "Assignee", "Reporter", "Steps To Reproduce", "Expected Result", "Actual Result", "Root Cause"],
      ...filteredItems.map((item) => [
        item.id,
        item.title,
        richTextToPlainText(item.message),
        formatTileCardLabel(item.status, "Open"),
        item.jira_bug_key || "",
        formatTileCardLabel(item.severity, "Not set"),
        formatTileCardLabel(item.priority, "Not set"),
        runLabelById.get(item.linked_test_run_id || "") || item.linked_test_run_id || "",
        item.environment || "",
        item.build || "",
        item.assignee_name || item.assignee_email || assigneeLabelById.get(item.assignee_id || "") || "Unassigned",
        item.user_name || item.user_email || item.user_id || "Unknown",
        richTextToPlainText(item.steps_to_reproduce),
        richTextToPlainText(item.expected_result),
        richTextToPlainText(item.actual_result),
        richTextToPlainText(item.root_cause)
      ])
    ]);
  };

  useEffect(() => {
    if (searchParams.get("create") !== "1") {
      return;
    }

    setIsCreating(true);
    setSelectedIssueId("");
    setDraft(createIssueDraftFromQuery(searchParams, defaultIssueStatus));

    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete("create");
    nextParams.delete("issue");
    setSearchParams(nextParams, { replace: true });
  }, [defaultIssueStatus, searchParams, setSearchParams]);

  useEffect(() => {
    if (issues.isLoading || issues.isFetching) {
      return;
    }

    const requestedIssueId = searchParams.get("issue");

    if (requestedIssueId && items.some((item) => item.id === requestedIssueId)) {
      if (selectedIssueId !== requestedIssueId) {
        setSelectedIssueId(requestedIssueId);
        setIsCreating(false);
      }
      return;
    }

    if (requestedIssueId) {
      if (selectedIssueId === requestedIssueId) {
        return;
      }

      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        next.delete("issue");
        return next;
      }, { replace: true });
    }
  }, [issues.isFetching, issues.isLoading, items, searchParams, selectedIssueId, setSearchParams]);

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
        steps_to_reproduce: selectedItem.steps_to_reproduce || "",
        expected_result: selectedItem.expected_result || "",
        actual_result: selectedItem.actual_result || "",
        severity: selectedItem.severity || "",
        priority: selectedItem.priority || "",
        environment: selectedItem.environment || "",
        build: selectedItem.build || "",
        jira_bug_key: selectedItem.jira_bug_key || "",
        linked_test_run_id: selectedItem.linked_test_run_id || "",
        assignee_id: selectedItem.assignee_id || "",
        root_cause: selectedItem.root_cause || "",
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
      syncIssueSearchParams(null);
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
      const response = await createIssue.mutateAsync(buildIssuePayload(draft, session.user.id));
      syncIssueSearchParams(response.id);
      setSelectedIssueId(response.id);
      setIsCreating(false);
      return;
    }

    await updateIssue.mutateAsync({
      id: selectedItem.id,
      input: buildIssuePayload(draft, selectedItem.user_id)
    });
  };

  const closeIssueWorkspace = () => {
    syncIssueSearchParams(null);
    setSelectedIssueId("");
    setIsCreating(false);
    setDraft(emptyDraft);
  };

  return (
    <div className="page-content">
      {confirmationDialog}
      {!(isCreating || selectedItem) ? (
        <PageHeader
          eyebrow="Defects"
          title="Report Issue"
          description="Capture Jira-ready bugs with reproduction details, run context, ownership, and root cause."
          meta={[
            { label: "Issues", value: items.length },
            { label: "Open", value: openIssueCount },
            { label: "Selected", value: "None" }
          ]}
        />
      ) : null}

      {message ? <p className={messageTone === "error" ? "inline-message error-message" : "inline-message success-message"}>{message}</p> : null}

      <WorkspaceMasterDetail
        browseView={(
          <Panel title="Issues" titleVariant="eyebrow" subtitle="Open one issue at a time from a card-first queue with severity, priority, Jira, and run context visible.">
            <div className="design-list-toolbar issue-catalog-toolbar">
              <CatalogSearchFilter
                activeFilterCount={issueSearch.trim() ? 1 : 0}
                ariaLabel="Search issues"
                onChange={setIssueSearch}
                placeholder="Search issues"
                subtitle="Search by title, description, Jira key, run, status, severity, priority, assignee, or reporter."
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
              <CatalogSelectionControls
                allSelected={areAllFilteredIssuesSelected}
                canSelectAll={Boolean(visibleIssueIds.length)}
                onClear={() => setSelectedActionIssueIds([])}
                onSelectAll={() => setSelectedActionIssueIds((current) => Array.from(new Set([...current, ...visibleIssueIds])))}
                selectedCount={selectedActionIssueIds.length}
              />
              <button
                className="primary-button catalog-selection-button"
                onClick={() => {
                  syncIssueSearchParams(null);
                  setIsCreating(true);
                  setSelectedIssueId("");
                  setDraft(emptyDraft);
                }}
                type="button"
              >
                <BugIcon />
                <span>Report Issue</span>
              </button>
              <button className="ghost-button catalog-selection-button" disabled={!filteredItems.length} onClick={handleExportIssuesCsv} type="button">
                <ExportIcon />
                <span>Export</span>
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
                    onClick={() => openIssueWorkspace(item.id)}
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
                        <DisplayIdBadge value={item.id} />
                      </div>
                      <div className="tile-card-header">
                        <span className="issue-card-badge">IS</span>
                        <div className="tile-card-title-group">
                          <strong>{item.title}</strong>
                          <span className="tile-card-kicker">
                            {[
                              item.jira_bug_key || null,
                              item.severity ? `Severity ${formatTileCardLabel(item.severity, "Not set")}` : null,
                              item.priority ? `Priority ${formatTileCardLabel(item.priority, "Not set")}` : null
                            ].filter(Boolean).join(" · ") || item.user_name || item.user_email || item.user_id}
                          </span>
                        </div>
                        <TileCardStatusIndicator title={issueStatus} tone={issueTone} />
                      </div>
                      <RichTextContent className="tile-card-description" value={item.message} />
                      <div className="issue-card-footer">
                        <span className="count-pill">{issueStatus}</span>
                        {item.build ? <span className="count-pill">Build {item.build}</span> : null}
                        {item.linked_test_run_id ? <span className="count-pill">{runLabelById.get(item.linked_test_run_id) || item.linked_test_run_id}</span> : null}
                        <span className="count-pill">{item.assignee_name || item.assignee_email || assigneeLabelById.get(item.assignee_id || "") || "Unassigned"}</span>
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
                onRowClick={(item) => openIssueWorkspace(item.id)}
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
            title={isCreating ? "Report issue" : selectedItem ? "Issue details" : "Issue editor"}
            subtitle="Capture the defect in a Jira-ready structure with run context, reproduction evidence, ownership, and root cause."
          >
            {(isCreating || selectedItem) ? (
              <form className="issue-report-form" onSubmit={(event) => void handleSave(event)}>
                <section className="issue-form-section">
                  <div className="issue-form-section-head">
                    <strong>Issue summary</strong>
                    <span>Title, classification, ownership, and linked execution context.</span>
                  </div>
                  <div className="issue-form-grid">
                    <FormField label="Title" required>
                      <input required value={draft.title} onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))} />
                    </FormField>
                    <FormField label="Jira Bug Key">
                      <input placeholder="BUG-123" value={draft.jira_bug_key} onChange={(event) => setDraft((current) => ({ ...current, jira_bug_key: event.target.value }))} />
                    </FormField>
                  </div>

                  <div className="issue-form-grid issue-form-grid--triple">
                    <FormField label="Status">
                      <select value={draft.status} onChange={(event) => setDraft((current) => ({ ...current, status: event.target.value }))}>
                        {issueStatusOptions.map((option) => (
                          <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                      </select>
                    </FormField>
                    <FormField label="Severity">
                      <select value={draft.severity} onChange={(event) => setDraft((current) => ({ ...current, severity: event.target.value }))}>
                        {ISSUE_SEVERITY_OPTIONS.map((option) => (
                          <option key={option.value || "none"} value={option.value}>{option.label}</option>
                        ))}
                      </select>
                    </FormField>
                    <FormField label="Priority">
                      <select value={draft.priority} onChange={(event) => setDraft((current) => ({ ...current, priority: event.target.value }))}>
                        {ISSUE_PRIORITY_OPTIONS.map((option) => (
                          <option key={option.value || "none"} value={option.value}>{option.label}</option>
                        ))}
                      </select>
                    </FormField>
                  </div>

                  <div className="issue-form-grid issue-form-grid--triple">
                    <FormField label="Assignee">
                      <select value={draft.assignee_id} onChange={(event) => setDraft((current) => ({ ...current, assignee_id: event.target.value }))}>
                        <option value="">Unassigned</option>
                        {userItems.map((user) => (
                          <option key={user.id} value={user.id}>{user.name || user.email || user.id}</option>
                        ))}
                      </select>
                    </FormField>
                    <FormField label="Environment">
                      <input placeholder="QA, UAT, iOS 18, Chrome" value={draft.environment} onChange={(event) => setDraft((current) => ({ ...current, environment: event.target.value }))} />
                    </FormField>
                    <FormField label="Build">
                      <input placeholder="2026.07.02" value={draft.build} onChange={(event) => setDraft((current) => ({ ...current, build: event.target.value }))} />
                    </FormField>
                  </div>

                  <FormField label="Linked Test Run">
                    <select value={draft.linked_test_run_id} onChange={(event) => setDraft((current) => ({ ...current, linked_test_run_id: event.target.value }))}>
                      <option value="">No linked run</option>
                      {draft.linked_test_run_id && !executionById.has(draft.linked_test_run_id) ? (
                        <option value={draft.linked_test_run_id}>{draft.linked_test_run_id}</option>
                      ) : null}
                      {executionItems.map((execution) => (
                        <option key={execution.id} value={execution.id}>{runLabelById.get(execution.id) || execution.id}</option>
                      ))}
                    </select>
                  </FormField>
                </section>

                <section className="issue-form-section">
                  <div className="issue-form-section-head">
                    <strong>Failure evidence</strong>
                    <span>Description, reproduction steps, expected result, and actual result.</span>
                  </div>
                  <FormField label="Description" required>
                    <RichTextEditor
                      required
                      rows={6}
                      value={draft.message}
                      onChange={(message) => setDraft((current) => ({ ...current, message }))}
                    />
                  </FormField>
                  <FormField label="Steps to Reproduce">
                    <RichTextEditor
                      rows={6}
                      value={draft.steps_to_reproduce}
                      onChange={(steps_to_reproduce) => setDraft((current) => ({ ...current, steps_to_reproduce }))}
                    />
                  </FormField>
                  <div className="issue-form-grid issue-form-evidence-result-grid">
                    <FormField label="Expected Result">
                      <RichTextEditor
                        rows={5}
                        value={draft.expected_result}
                        onChange={(expected_result) => setDraft((current) => ({ ...current, expected_result }))}
                      />
                    </FormField>
                    <FormField label="Actual Result">
                      <RichTextEditor
                        rows={5}
                        value={draft.actual_result}
                        onChange={(actual_result) => setDraft((current) => ({ ...current, actual_result }))}
                      />
                    </FormField>
                  </div>
                </section>

	                <section className="issue-form-section">
	                  <div className="issue-form-section-head">
	                    <strong>Resolution tracking</strong>
	                    <span>Root cause details for closure readiness.</span>
	                  </div>
	                  <FormField label="Root Cause">
	                    <RichTextEditor
	                      rows={4}
	                      value={draft.root_cause}
	                      onChange={(root_cause) => setDraft((current) => ({ ...current, root_cause }))}
	                    />
	                  </FormField>
	                </section>
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
