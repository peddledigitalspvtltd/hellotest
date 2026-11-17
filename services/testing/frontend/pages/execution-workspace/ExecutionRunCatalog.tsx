import { type SessionPayload, type Execution, type ExecutionSchedule, type ExecutionStatus, type TestSuite, type WorkspaceTransaction } from "@hellotest/platform/frontend/src/types";
import { formatDuration } from "../../lib/executionTiming";
import { type ExecutionRunImpactSummary, executionScopeCaseCount, normalizeExecutionStatus, ExecutionListCard, ExecutionStatusIndicator } from "../../components/ExecutionRunListCard";
import { useMemo, type Dispatch, type SetStateAction } from "react";
import { ActivityIcon, CalendarIcon, OpenIcon, PlayIcon, TrashIcon } from "@hellotest/platform/frontend/src/platform/components/AppIcons";
import { CatalogActionMenu } from "@hellotest/platform/frontend/src/shared/components/CatalogActionMenu";
import { CatalogSelectionControls } from "@hellotest/platform/frontend/src/shared/components/CatalogSelectionControls";
import { CatalogViewToggle } from "@hellotest/platform/frontend/src/shared/components/CatalogViewToggle";
import { CatalogSearchFilter } from "@hellotest/platform/frontend/src/shared/components/CatalogSearchFilter";
import { CreateRunActionButton } from "../../components/CreateRunActionButton";
import { DataTable, type DataTableColumn } from "@hellotest/platform/frontend/src/shared/components/DataTable";
import { DisplayIdBadge } from "@hellotest/platform/frontend/src/shared/components/DisplayIdBadge";
import { runStoryCounts } from "../../lib/runCatalog";
import { Panel } from "@hellotest/platform/frontend/src/shared/components/Panel";
import { StatusBadge } from "@hellotest/platform/frontend/src/shared/components/StatusBadge";
import { TileCardSkeletonGrid } from "@hellotest/platform/frontend/src/shared/components/TileCardSkeletonGrid";
import { ExecutionScheduleCard, WorkspaceTransactionCard } from "./ExecutionCatalogCards";
import { resolveExecutionAssigneeSummary, ExecutionEditIcon } from "./ExecutionWorkspacePrimitives";
import { ExecutionIssueFilter, ExecutionEvidenceFilter, ExecutionStartMode, TestRunsView, EMPTY_EXECUTION_RUN_SUMMARY, EMPTY_EXECUTION_RUN_IMPACT_SUMMARY, formatScheduleCadence, executionStatusLabel, formatExecutionTimestamp, describeWorkspaceTransaction, truncateProcessName, isExecutionRunsView, resolveExecutionRunBucket } from "./executionWorkspaceModel";
import { useExecutionCatalogController } from "./useExecutionCatalogController";
import { useExecutionCatalogData } from "./useExecutionCatalogData";
import { useExecutionCatalogState } from "./useExecutionCatalogState";

export type RunCatalogData = Pick<ReturnType<typeof useExecutionCatalogData>, "executionSummaryById" | "executionsQuery" | "executionSchedulesQuery" | "workspaceTransactionsQuery">;
export type RunCatalogState = Pick<ReturnType<typeof useExecutionCatalogState>, "runLibraryTitle" | "runLibrarySubtitle" | "handleCatalogViewModeChange" | "catalogViewMode" | "runLibrarySearchPlaceholder" | "handleRunLibrarySearchChange" | "runLibrarySearchSubtitle" | "runLibrarySearchTitle" | "executionSearch" | "executionStatusFilter" | "setExecutionStatusFilter" | "executionIssueFilter" | "setExecutionIssueFilter" | "executionEvidenceFilter" | "setExecutionEvidenceFilter" | "setSelectedActionExecutionIds" | "setSelectedActionScheduleIds" | "setSelectedActionOperationIds" | "selectedActionExecutionIds" | "selectedActionScheduleIds" | "selectedActionOperationIds">;
export type RunCatalogController = Pick<ReturnType<typeof useExecutionCatalogController>, "activeExecutionFilterCount" | "executionStatusOptions" | "areAllFilteredRunLibraryItemsSelected" | "visibleRunLibraryIds" | "selectedRunLibraryActionIds" | "activeExecutionCatalogRows" | "filteredSchedules" | "filteredWorkspaceTransactions" | "selectedWorkspaceTransaction" | "clearRunLibrarySelection" | "selectAllRunLibraryItems">;
export interface RunCatalogActions {
  setTestRunsView: Dispatch<SetStateAction<TestRunsView>>;
  focusExecution: (executionId: string) => void;
  handleRerunExecutionItem: (execution: Execution, failedOnly: boolean) => Promise<void>;
  rerunExecution: { isPending: boolean };
  focusExecutionSchedule: (scheduleId: string) => void;
  openEditScheduleBuilder: (schedule: ExecutionSchedule) => void;
  handleRunExecutionSchedule: (scheduleId: string) => Promise<void>;
  handleDeleteExecutionSchedule: (scheduleId: string, scheduleName: string) => Promise<void>;
  openWorkspaceTransactionDetail: (transactionId: string) => void;
  openCreateScheduleBuilder: () => void;
  openExecutionBuilder: (mode?: ExecutionStartMode) => void;
}
export interface RunCatalogAccess {
  canExecuteRuns: boolean;
  canUpdateSchedules: boolean;
  canRunSchedules: boolean;
  canDeleteSchedules: boolean;
  canUpdateRuns: boolean;
  canCreateSchedules: boolean;
  canViewSchedules: boolean;
}
export interface RunCatalogSelection {
  selectedExecution: Execution | null;
  selectedSchedule: ExecutionSchedule | null;
}
export interface RunCatalogMetadata {
  session: SessionPayload | null;
  executionImpactSummaryById: Record<string, ExecutionRunImpactSummary>;
  liveNow: number;
  appTypeNameById: Record<string, string>;
  projectNameById: Record<string, string>;
  testRunsView: TestRunsView;
  projectId: string;
  scopeSuites: TestSuite[];
}

export interface ExecutionRunCatalogProps {
  data: RunCatalogData;
  state: RunCatalogState;
  controller: RunCatalogController;
  actions: RunCatalogActions;
  access: RunCatalogAccess;
  selection: RunCatalogSelection;
  metadata: RunCatalogMetadata;
}

export function ExecutionRunCatalog({ data, state, controller, actions, access, selection, metadata }: ExecutionRunCatalogProps) {
  const { executionSummaryById, executionsQuery, executionSchedulesQuery, workspaceTransactionsQuery } = data;
  const { runLibraryTitle, runLibrarySubtitle, handleCatalogViewModeChange, catalogViewMode, runLibrarySearchPlaceholder, handleRunLibrarySearchChange, runLibrarySearchSubtitle, runLibrarySearchTitle, executionSearch, executionStatusFilter, setExecutionStatusFilter, executionIssueFilter, setExecutionIssueFilter, executionEvidenceFilter, setExecutionEvidenceFilter, setSelectedActionExecutionIds, setSelectedActionScheduleIds, setSelectedActionOperationIds, selectedActionExecutionIds, selectedActionScheduleIds, selectedActionOperationIds } = state;
  const { clearRunLibrarySelection, selectAllRunLibraryItems, activeExecutionFilterCount, executionStatusOptions, areAllFilteredRunLibraryItemsSelected, visibleRunLibraryIds, selectedRunLibraryActionIds, activeExecutionCatalogRows, filteredSchedules, filteredWorkspaceTransactions, selectedWorkspaceTransaction } = controller;
  const { setTestRunsView, focusExecution, handleRerunExecutionItem, rerunExecution, focusExecutionSchedule, openEditScheduleBuilder, handleRunExecutionSchedule, handleDeleteExecutionSchedule, openWorkspaceTransactionDetail, openCreateScheduleBuilder, openExecutionBuilder } = actions;
  const { canExecuteRuns, canUpdateSchedules, canRunSchedules, canDeleteSchedules, canUpdateRuns, canCreateSchedules, canViewSchedules } = access;
  const { selectedExecution, selectedSchedule } = selection;
  const { session, executionImpactSummaryById, liveNow, appTypeNameById, projectNameById, testRunsView, projectId, scopeSuites } = metadata;
const renderExecutionRowActions = (execution: Execution) => {
    const summary = executionSummaryById[execution.id] || EMPTY_EXECUTION_RUN_SUMMARY;

    return (
      <CatalogActionMenu
        actions={[
          {
            label: "Open run",
            description: "Open this run and review its evidence.",
            icon: <OpenIcon />,
            onClick: () => {
              setTestRunsView(resolveExecutionRunBucket(execution));
              focusExecution(execution.id);
            }
          },
          {
            label: "Rerun all",
            description: "Create a fresh run with the same scope.",
            icon: <PlayIcon />,
            onClick: () => void handleRerunExecutionItem(execution, false),
            disabled: !session?.user.id || !canExecuteRuns || rerunExecution.isPending
          },
          {
            label: "Rerun failed",
            description: summary.failed
              ? `Create a new run using the ${summary.failed} failed case${summary.failed === 1 ? "" : "s"}.`
              : "No failed cases are available for a targeted rerun.",
            icon: <PlayIcon />,
            onClick: () => void handleRerunExecutionItem(execution, true),
            disabled: !session?.user.id || !canExecuteRuns || !summary.failed || rerunExecution.isPending
          }
        ]}
        label={`${execution.name || "Run"} actions`}
      />
    );
  };

const renderExecutionScheduleRowActions = (schedule: ExecutionSchedule) => (
    <CatalogActionMenu
      actions={[
        {
          label: "Open schedule",
          description: "Review cadence, suites, and direct cases for this schedule.",
          icon: <CalendarIcon />,
          onClick: () => focusExecutionSchedule(schedule.id)
        },
        {
          label: "Edit schedule",
          description: "Adjust cadence, scope, context, or ownership for this recurring run.",
          icon: <ExecutionEditIcon />,
          onClick: () => openEditScheduleBuilder(schedule),
          disabled: !canUpdateSchedules
        },
        {
          label: "Run now",
          description: "Launch this schedule immediately as a fresh run.",
          icon: <PlayIcon />,
          onClick: () => void handleRunExecutionSchedule(schedule.id),
          disabled: !canRunSchedules
        },
        {
          label: "Delete schedule",
          description: "Remove this schedule from future run planning.",
          icon: <TrashIcon />,
          onClick: () => void handleDeleteExecutionSchedule(schedule.id, schedule.name),
          disabled: !canDeleteSchedules,
          tone: "danger" as const
        }
      ]}
      label={`${schedule.name} actions`}
    />
  );

const renderOperationRowActions = (transaction: WorkspaceTransaction) => (
    <CatalogActionMenu
      actions={[
        {
          label: "Open batch process",
          description: "Inspect transaction metadata and event logs.",
          icon: <ActivityIcon />,
          onClick: () => {
            setTestRunsView("batch-process");
            openWorkspaceTransactionDetail(transaction.id);
          }
        }
      ]}
      label={`${transaction.title} actions`}
    />
  );

const executionListColumns = useMemo<Array<DataTableColumn<Execution>>>(() => [
    { key: "execution", label: "Run Name", canToggle: false, render: (execution) => <strong>{execution.name || "Unnamed run"}</strong> },
    { key: "status", label: "Status", render: (execution) => <ExecutionStatusIndicator status={normalizeExecutionStatus(execution.status)} /> },
    { key: "cases", label: "Cases", render: (execution) => execution.metrics?.total_cases ?? executionScopeCaseCount(execution) },
    { key: "defects", label: "Defects", render: (execution) => execution.metrics?.defect_count ?? 0 },
    { key: "stories", label: "Story impact", render: (execution) => { const count = runStoryCounts(execution, executionImpactSummaryById[execution.id] || EMPTY_EXECUTION_RUN_IMPACT_SUMMARY); return `${count.failed}/${count.total}`; } },
    { key: "startDate", label: "Start date", render: (execution) => execution.start_date?.slice(0, 10) || "Not planned" },
    { key: "endDate", label: "End date", render: (execution) => execution.end_date?.slice(0, 10) || "Not planned" },
    { key: "duration", label: "Duration", render: (execution) => formatDuration(execution.metrics?.duration_ms ?? executionSummaryById[execution.id]?.totalDurationMs ?? 0, "0s") },
  ], [canUpdateRuns, executionImpactSummaryById, liveNow]);

const executionScheduleListColumns = useMemo<Array<DataTableColumn<ExecutionSchedule>>>(() => [
    {
      key: "id",
      label: "Schedule ID",
      defaultVisible: false,
      sortValue: (schedule) => schedule.id,
      render: (schedule) => <DisplayIdBadge value={schedule.id} />
    },
    {
      key: "schedule",
      label: "Schedule",
      canToggle: false,
      render: (schedule) => <strong>{schedule.name}</strong>
    },
    {
      key: "status",
      label: "Status",
      sortValue: (schedule) => schedule.is_active ? "active" : "inactive",
      render: (schedule) => (schedule.is_active ? "Active" : "Inactive")
    },
    {
      key: "cadence",
      label: "Cadence",
      sortValue: (schedule) => formatScheduleCadence(schedule.cadence),
      render: (schedule) => formatScheduleCadence(schedule.cadence)
    },
    {
      key: "assignee",
      label: "Assigned To",
      sortValue: (schedule) => resolveExecutionAssigneeSummary(schedule),
      render: (schedule) => resolveExecutionAssigneeSummary(schedule)
    },
    {
      key: "release",
      label: "Release",
      sortValue: (schedule) => schedule.release || "",
      render: (schedule) => schedule.release || "Not set"
    },
    {
      key: "sprint",
      label: "Sprint",
      defaultVisible: false,
      sortValue: (schedule) => schedule.sprint || "",
      render: (schedule) => schedule.sprint || "Not set"
    },
    {
      key: "build",
      label: "Build",
      defaultVisible: false,
      sortValue: (schedule) => schedule.build || "",
      render: (schedule) => schedule.build || "Not set"
    },
    {
      key: "suites",
      label: "Suites",
      render: (schedule) => schedule.suite_ids.length
    },
    {
      key: "directCases",
      label: "Direct cases",
      render: (schedule) => schedule.test_case_ids.length
    },
    {
      key: "nextRun",
      label: "Next run",
      render: (schedule) => formatExecutionTimestamp(schedule.next_run_at, "Not scheduled")
    },
    {
      key: "lastRun",
      label: "Last run",
      defaultVisible: false,
      render: (schedule) => formatExecutionTimestamp(schedule.last_run_at, "No runs yet")
    }
  ], [handleDeleteExecutionSchedule, handleRunExecutionSchedule, openEditScheduleBuilder]);

const operationListColumns = useMemo<Array<DataTableColumn<WorkspaceTransaction>>>(() => [
    {
      key: "id",
      label: "Operation ID",
      defaultVisible: false,
      sortValue: (transaction) => transaction.id,
      render: (transaction) => <DisplayIdBadge value={transaction.id} />
    },
    {
      key: "operation",
      label: "Batch process",
      canToggle: false,
      render: (transaction) => {
        const presentation = describeWorkspaceTransaction(transaction, {
          appTypeNameById,
          projectNameById
        });

        return (
          <div className="data-table-multiline batch-process-name-cell">
            <strong title={transaction.title}>{truncateProcessName(transaction.title)}</strong>
            <span className="data-table-multiline-line" title={presentation.eyebrow}>
              {truncateProcessName(presentation.eyebrow, 64)}
            </span>
          </div>
        );
      }
    },
    {
      key: "status",
      label: "Status",
      render: (transaction) => <StatusBadge value={transaction.status} />
    },
    {
      key: "provider",
      label: "Provider",
      defaultVisible: false,
      render: (transaction) => String(transaction.metadata?.provider || transaction.category).replace(/_/g, " ")
    },
    {
      key: "events",
      label: "Events",
      render: (transaction) => transaction.event_count || 0
    },
    {
      key: "updated",
      label: "Last activity",
      render: (transaction) => formatExecutionTimestamp(transaction.latest_event_at || transaction.updated_at || transaction.completed_at || transaction.created_at, "Not recorded")
    }
  ], [appTypeNameById, projectNameById]);
return (
<Panel
            className="execution-panel execution-panel--list"
            title={runLibraryTitle}
            subtitle={runLibrarySubtitle}
          >
            <div className="design-list-toolbar catalog-command-toolbar executions-list-toolbar">
              <div className="catalog-toolbar-discovery" aria-label="Run views, search, and selection">
                <CatalogViewToggle onChange={handleCatalogViewModeChange} value={catalogViewMode} />
                <CatalogSearchFilter
                activeFilterCount={isExecutionRunsView(testRunsView) ? activeExecutionFilterCount : 0}
                ariaLabel={runLibrarySearchPlaceholder}
                onChange={handleRunLibrarySearchChange}
                placeholder={runLibrarySearchPlaceholder}
                subtitle={runLibrarySearchSubtitle}
                title={runLibrarySearchTitle}
                type="search"
                value={executionSearch}
              >
                <div className="catalog-filter-grid">
                  {isExecutionRunsView(testRunsView) ? (
                  <label className="catalog-filter-field">
                    <span>Status</span>
                    <select
                      value={executionStatusFilter}
                      onChange={(event) => setExecutionStatusFilter(event.target.value as ExecutionStatus | "all")}
                    >
                      <option value="all">All statuses</option>
                      {executionStatusOptions.map((status) => (
                        <option key={status} value={status}>
                          {executionStatusLabel(status)}
                        </option>
                      ))}
                    </select>
                  </label>
                  ) : null}

                  {isExecutionRunsView(testRunsView) ? (
                  <label className="catalog-filter-field">
                    <span>Defects</span>
                    <select
                      value={executionIssueFilter}
                      onChange={(event) => setExecutionIssueFilter(event.target.value as ExecutionIssueFilter)}
                    >
                      <option value="all">All runs</option>
                      <option value="with-issues">With linked defects</option>
                      <option value="clean">No linked defects</option>
                    </select>
                  </label>
                  ) : null}

                  {isExecutionRunsView(testRunsView) ? (
                  <label className="catalog-filter-field">
                    <span>Evidence activity</span>
                    <select
                      value={executionEvidenceFilter}
                      onChange={(event) => setExecutionEvidenceFilter(event.target.value as ExecutionEvidenceFilter)}
                    >
                      <option value="all">All runs</option>
                      <option value="with-evidence">Media evidence attached</option>
                      <option value="no-evidence">No evidence yet</option>
                    </select>
                  </label>
                  ) : null}

                  <div className="catalog-filter-actions">
                    <button
                      className="ghost-button"
                      disabled={!activeExecutionFilterCount}
                      onClick={() => {
                        setExecutionStatusFilter("all");
                        setExecutionIssueFilter("all");
                        setExecutionEvidenceFilter("all");
                      }}
                      type="button"
                    >
                      Clear filters
                    </button>
                  </div>
                </div>
                </CatalogSearchFilter>
                <CatalogSelectionControls
                  allSelected={areAllFilteredRunLibraryItemsSelected}
                  canSelectAll={Boolean(visibleRunLibraryIds.length)}
                  onClear={clearRunLibrarySelection}
                  onSelectAll={selectAllRunLibraryItems}
                  selectedCount={selectedRunLibraryActionIds.length}
                />

              </div>
              {testRunsView !== "batch-process" ? (
                <div className="catalog-toolbar-actions executions-run-actions" aria-label="Run actions">
                  {testRunsView === "scheduled-runs" && canCreateSchedules ? (<button
                    className="ghost-button"
                    disabled={!canCreateSchedules}
                    onClick={openCreateScheduleBuilder}
                    type="button"
                  >
                    <CalendarIcon />
                    Add test plan
                  </button>) : null}
                  {isExecutionRunsView(testRunsView) ? (
                  <CreateRunActionButton
                    projectId={projectId}
                    source="TEST_RUNS"
                    onCreateManualRun={() => openExecutionBuilder("manual")}
                    onCreateLocalRun={() => openExecutionBuilder("local")}
                    onCreateRemoteRun={() => openExecutionBuilder("remote")}
                  />
                  ) : null}
                </div>
              ) : null}
            </div>

            {testRunsView === "scheduled-runs" && !canViewSchedules ? (
              <div className="empty-state compact">Permission required: schedule.view.</div>
            ) : null}

            {(isExecutionRunsView(testRunsView) ? executionsQuery.isLoading : testRunsView === "scheduled-runs" ? executionSchedulesQuery.isLoading : workspaceTransactionsQuery.isLoading) ? (
              <TileCardSkeletonGrid />
            ) : null}

            {!(isExecutionRunsView(testRunsView) ? executionsQuery.isLoading : testRunsView === "scheduled-runs" ? executionSchedulesQuery.isLoading : workspaceTransactionsQuery.isLoading) ? (
              <div className={catalogViewMode === "tile" ? `tile-browser-grid execution-run-tile-grid${testRunsView === "batch-process" ? " batch-process-browser-grid" : ""}` : ""}>
                {isExecutionRunsView(testRunsView) && catalogViewMode === "tile"
                  ? activeExecutionCatalogRows.map((execution) => (
                      <ExecutionListCard
                        key={execution.id}
                        execution={execution}
                        isActive={selectedExecution?.id === execution.id}
                        isSelected={selectedActionExecutionIds.includes(execution.id)}
                        liveNow={liveNow}
                        onSelect={() => focusExecution(execution.id)}
                        onToggleSelected={() =>
                          setSelectedActionExecutionIds((current) =>
                            current.includes(execution.id)
                              ? current.filter((id) => id !== execution.id)
                              : [...current, execution.id]
                          )
                        }
                        impactSummary={executionImpactSummaryById[execution.id] || EMPTY_EXECUTION_RUN_IMPACT_SUMMARY}
                        summary={executionSummaryById[execution.id] || EMPTY_EXECUTION_RUN_SUMMARY}
                      />
                    ))
                  : null}
                {testRunsView === "scheduled-runs" && catalogViewMode === "tile"
                  ? filteredSchedules.map((schedule) => (
                      <ExecutionScheduleCard
                        key={schedule.id}
                        isActive={selectedSchedule?.id === schedule.id}
                        isSelected={selectedActionScheduleIds.includes(schedule.id)}
                        onSelect={() => focusExecutionSchedule(schedule.id)}
                        onToggleSelected={() =>
                          setSelectedActionScheduleIds((current) =>
                            current.includes(schedule.id)
                              ? current.filter((id) => id !== schedule.id)
                              : [...current, schedule.id]
                          )
                        }
                        liveNow={liveNow}
                        resolvedCaseCount={new Set([
                          ...(schedule.test_case_ids || []),
                          ...scopeSuites
                            .filter((suite) => schedule.suite_ids.includes(suite.id))
                            .flatMap((suite) => suite.test_case_ids || [])
                        ]).size}
                        schedule={schedule}
                      />
                    ))
                  : null}
                {testRunsView === "batch-process" && catalogViewMode === "tile"
                  ? filteredWorkspaceTransactions.map((transaction) => (
                      <WorkspaceTransactionCard
                        appTypeNameById={appTypeNameById}
                        isActive={selectedWorkspaceTransaction?.id === transaction.id}
                        isSelected={selectedActionOperationIds.includes(transaction.id)}
                        key={transaction.id}
                        onSelect={() => openWorkspaceTransactionDetail(transaction.id)}
                        onToggleSelected={() =>
                          setSelectedActionOperationIds((current) =>
                            current.includes(transaction.id)
                              ? current.filter((id) => id !== transaction.id)
                              : [...current, transaction.id]
                          )
                        }
                        projectNameById={projectNameById}
                        transaction={transaction}
                      />
                    ))
                  : null}
                {isExecutionRunsView(testRunsView) && catalogViewMode === "list" ? (
                  <DataTable
                    columns={executionListColumns}
                    emptyMessage="No runs created yet."
                    getRowClassName={(execution) => (selectedExecution?.id === execution.id ? "is-active-row" : "")}
                    getRowKey={(execution) => execution.id}
                    onRowClick={(execution) => focusExecution(execution.id)}
                    renderRowActions={renderExecutionRowActions}
                    rows={activeExecutionCatalogRows}
                    enableRowSelection
                    selectedRowKeys={selectedActionExecutionIds}
                    onSelectedRowKeysChange={setSelectedActionExecutionIds}
                    storageKey="hellotest:executions:list-columns"
                  />
                ) : null}
                {testRunsView === "scheduled-runs" && catalogViewMode === "list" && canViewSchedules ? (
                  <DataTable
                    columns={executionScheduleListColumns}
                    emptyMessage="No schedules created yet."
                    getRowClassName={(schedule) => (selectedSchedule?.id === schedule.id ? "is-active-row" : "")}
                    getRowKey={(schedule) => schedule.id}
                    onRowClick={(schedule) => focusExecutionSchedule(schedule.id)}
                    renderRowActions={renderExecutionScheduleRowActions}
                    rows={filteredSchedules}
                    storageKey="hellotest:execution-schedules:list-columns"
                  />
                ) : null}
                {testRunsView === "batch-process" && catalogViewMode === "list" ? (
                  <DataTable
                    columns={operationListColumns}
                    emptyMessage="No batch process records have been recorded yet."
                    getRowClassName={(transaction) => (selectedWorkspaceTransaction?.id === transaction.id ? "is-active-row" : "")}
                    getRowKey={(transaction) => transaction.id}
                    onRowClick={(transaction) => openWorkspaceTransactionDetail(transaction.id)}
                    renderRowActions={renderOperationRowActions}
                    rows={filteredWorkspaceTransactions}
                    storageKey="hellotest:operations:list-columns"
                  />
                ) : null}
                {catalogViewMode === "tile" && isExecutionRunsView(testRunsView) && !activeExecutionCatalogRows.length ? (
                  <div className="empty-state compact">
                    {testRunsView === "local-runs"
                        ? "No local runs created yet."
                        : "No suite or individual case runs created yet."}
                  </div>
                ) : null}
                {catalogViewMode === "tile" && testRunsView === "scheduled-runs" && canViewSchedules && !filteredSchedules.length ? <div className="empty-state compact">No schedules created yet.</div> : null}
                {catalogViewMode === "tile" && testRunsView === "batch-process" && !filteredWorkspaceTransactions.length ? <div className="empty-state compact">No batch process records have been recorded for this scope yet.</div> : null}
              </div>
            ) : null}
          </Panel>
);
}
