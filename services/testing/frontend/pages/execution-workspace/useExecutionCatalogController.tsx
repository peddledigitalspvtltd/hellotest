import { normalizeExecutionStatus } from "../../components/ExecutionRunListCard";
import { hasExecutionEvidence } from "../../components/ExecutionRunnerStep";
import { useEffect, useMemo } from "react";
import { type QualityMetric } from "@hellotest/dashboard/frontend/components/QualityMetricStrip";
import { parseExecutionLogs } from "../../lib/executionLogs";
import { resolveExecutionAssigneeSummary } from "./ExecutionWorkspacePrimitives";
import { TestRunsView, EMPTY_EXECUTION_RUN_SUMMARY, toTimestamp, formatExecutionTimestamp, isExecutionRunsView } from "./executionWorkspaceModel";
import { useExecutionCatalogData } from "./useExecutionCatalogData";
import { useExecutionCatalogState } from "./useExecutionCatalogState";

export interface ExecutionCatalogControllerOptions {
  data: ReturnType<typeof useExecutionCatalogData>;
  state: ReturnType<typeof useExecutionCatalogState>;
  testRunsView: TestRunsView;
  selectedOperationId: string;
  projectNameById: Record<string, string>;
  appTypeNameById: Record<string, string>;
}

export function useExecutionCatalogController({ data, state, testRunsView, selectedOperationId, projectNameById, appTypeNameById }: ExecutionCatalogControllerOptions) {
const { executionsQuery, executionSchedulesQuery, allExecutionResultsQuery, workspaceTransactionsQuery, executions, executionSchedules, allExecutionResults, workspaceTransactions, workspaceTransactionStatusCounts, executionSummaryById } = data;
const { setSelectedActionExecutionIds, setSelectedActionScheduleIds, setSelectedActionOperationIds, deferredExecutionSearch, executionStatusFilter, executionIssueFilter, executionEvidenceFilter, selectedActionExecutionIds, selectedActionScheduleIds, selectedActionOperationIds, executionCardMeasureRef, setExecutionListItemHeight } = state;
const filteredWorkspaceTransactions = useMemo(() => {
    const search = deferredExecutionSearch.trim().toLowerCase();

    if (!search) {
      return workspaceTransactions;
    }

    return workspaceTransactions.filter((transaction) =>
      [
        transaction.id,
        transaction.related_id,
        transaction.title,
        transaction.description,
        transaction.status,
        transaction.category,
        transaction.action,
        String(transaction.metadata?.provider || ""),
        String(transaction.metadata?.repository || ""),
        String(transaction.metadata?.file_name || "")
      ].some((value) => String(value || "").toLowerCase().includes(search))
    );
  }, [deferredExecutionSearch, workspaceTransactions]);

const selectedWorkspaceTransaction = useMemo(
    () => filteredWorkspaceTransactions.find((transaction) => transaction.id === selectedOperationId) || workspaceTransactions.find((transaction) => transaction.id === selectedOperationId) || null,
    [filteredWorkspaceTransactions, selectedOperationId, workspaceTransactions]
  );

const executionStatusOptions = useMemo(
    () => Array.from(new Set(executions.map((execution) => normalizeExecutionStatus(execution.status)))),
    [executions]
  );

const executionIdsWithEvidence = useMemo(
    () => new Set(
      allExecutionResults
        .filter((result) => {
          const parsed = parseExecutionLogs(result.logs || null);
          return Object.values(parsed.stepEvidence || {}).some((evidence) => hasExecutionEvidence(evidence));
        })
        .map((result) => result.execution_id)
    ),
    [allExecutionResults]
  );

const filteredExecutions = useMemo(() => {
    const search = deferredExecutionSearch.trim().toLowerCase();

    return executions.filter((execution) => {
      const projectName = projectNameById[execution.project_id] || "";
      const assigneeLabel = resolveExecutionAssigneeSummary(execution);
      const summary = executionSummaryById[execution.id] || EMPTY_EXECUTION_RUN_SUMMARY;
      const executionStatus = normalizeExecutionStatus(execution.status);
      const hasIssues = Number(execution.metrics?.defect_count || 0) > 0;
      const hasEvidence = executionIdsWithEvidence.has(execution.id);
      const matchesSearch = !search || [
        execution.id,
        execution.name || "",
        projectName,
        assigneeLabel,
        execution.release || "",
        execution.sprint || "",
        execution.build || "",
        ...(execution.suite_ids || []),
        ...(execution.test_case_ids || []),
        ...(execution.case_snapshots || []).flatMap((snapshot) => [snapshot.test_case_id, snapshot.test_case_title, snapshot.suite_id || "", snapshot.suite_name || ""]),
        ...(execution.step_snapshots || []).flatMap((snapshot) => [snapshot.snapshot_step_id, snapshot.test_case_id, snapshot.group_id || "", snapshot.reusable_group_id || ""])
      ].some((value) => String(value || "").toLowerCase().includes(search));

      if (!matchesSearch) {
        return false;
      }

      if (executionStatusFilter !== "all" && executionStatus !== executionStatusFilter) {
        return false;
      }

      if (executionIssueFilter === "with-issues" && !hasIssues) {
        return false;
      }

      if (executionIssueFilter === "clean" && hasIssues) {
        return false;
      }

      if (executionEvidenceFilter === "with-evidence" && !hasEvidence) {
        return false;
      }

      if (executionEvidenceFilter === "no-evidence" && hasEvidence) {
        return false;
      }

      return true;
    });
  }, [deferredExecutionSearch, executionEvidenceFilter, executionIdsWithEvidence, executionIssueFilter, executionStatusFilter, executionSummaryById, executions, projectNameById]);

const activeExecutionCatalogRows = isExecutionRunsView(testRunsView) ? filteredExecutions : [];

const availableExecutionCatalogRows = isExecutionRunsView(testRunsView) ? executions : [];

const filteredSchedules = useMemo(() => {
    const search = deferredExecutionSearch.trim().toLowerCase();

    return executionSchedules.filter((schedule) => {
      const appTypeName = appTypeNameById[schedule.app_type_id || ""] || "";
      const assigneeLabel = resolveExecutionAssigneeSummary(schedule);
      const nextRunLabel = schedule.next_run_at || "";

      return !search || [
        schedule.id,
        schedule.name,
        appTypeName,
        assigneeLabel,
        nextRunLabel,
        schedule.release,
        schedule.sprint,
        schedule.build,
        ...(schedule.suite_ids || []),
        ...(schedule.test_case_ids || [])
      ].some((value) => String(value || "").toLowerCase().includes(search));
    });
  }, [appTypeNameById, deferredExecutionSearch, executionSchedules]);

const runCatalogMetricCards = useMemo<QualityMetric[]>(() => {
    if (isExecutionRunsView(testRunsView)) {
      const summaries = availableExecutionCatalogRows.map((execution) =>
        executionSummaryById[execution.id] || EMPTY_EXECUTION_RUN_SUMMARY
      );
      const passed = summaries.reduce((sum, summary) => sum + summary.passed, 0);
      const failed = summaries.reduce((sum, summary) => sum + summary.failed, 0);
      const blocked = summaries.reduce((sum, summary) => sum + summary.blocked, 0);
      const finalized = passed + failed + blocked;
      const passRate = finalized ? Math.round((passed / finalized) * 100) : null;
      const running = availableExecutionCatalogRows.filter((execution) => normalizeExecutionStatus(execution.status) === "running").length;
      const queued = availableExecutionCatalogRows.filter((execution) => normalizeExecutionStatus(execution.status) === "queued").length;
      const atRisk = summaries.filter((summary) => summary.failed + summary.blocked > 0).length;

      return [
        {
          label: "Total runs",
          value: availableExecutionCatalogRows.length,
          detail: "Current run view"
        },
        {
          label: "Active runs",
          value: running,
          detail: `${queued} queued`,
          tone: running ? "info" : "neutral"
        },
        {
          label: "Recent pass rate",
          value: passRate === null ? "—" : `${passRate}%`,
          detail: finalized ? `${passed} of ${finalized} passed` : "No finalized results",
          tone: passRate === null ? "neutral" : "success"
        },
        {
          label: "At-risk runs",
          value: atRisk,
          detail: `${failed} failed · ${blocked} blocked cases`,
          tone: atRisk ? "danger" : "neutral"
        }
      ];
    }

    if (testRunsView === "scheduled-runs") {
      const active = executionSchedules.filter((schedule) => schedule.is_active).length;
      const paused = executionSchedules.length - active;
      const nextDueTimestamp = executionSchedules
        .map((schedule) => toTimestamp(schedule.next_run_at))
        .filter((timestamp): timestamp is number => timestamp !== null)
        .sort((left, right) => left - right)[0];

      return [
        { label: "Total schedules", value: executionSchedules.length },
        {
          label: "Active schedules",
          value: active,
          progress: executionSchedules.length ? Math.round((active / executionSchedules.length) * 100) : 0,
          tone: "success"
        },
        {
          label: "Paused",
          value: paused,
          detail: "Needs manual resume",
          tone: paused ? "danger" : "neutral"
        },
        {
          label: "Next due",
          value: nextDueTimestamp
            ? new Date(nextDueTimestamp).toLocaleDateString(undefined, { day: "numeric", month: "short" })
            : "—",
          detail: nextDueTimestamp ? formatExecutionTimestamp(new Date(nextDueTimestamp).toISOString()) : "No run scheduled"
        }
      ];
    }

    const completed = workspaceTransactionStatusCounts.completed || 0;
    const failed = workspaceTransactionStatusCounts.failed || 0;
    const finalized = completed + failed;
    const completionRate = finalized ? Math.round((completed / finalized) * 100) : null;

    return [
      {
        label: "Total processes",
        value: workspaceTransactions.length,
        detail: "Current process history"
      },
      {
        label: "Running now",
        value: workspaceTransactionStatusCounts.running || 0,
        detail: `${workspaceTransactionStatusCounts.queued || 0} queued`,
        tone: workspaceTransactionStatusCounts.running ? "info" : "neutral"
      },
      {
        label: "Completion rate",
        value: completionRate === null ? "—" : `${completionRate}%`,
        detail: finalized ? `${completed} of ${finalized} completed` : "No finalized processes",
        progress: completionRate,
        tone: completionRate === null ? "neutral" : "success"
      },
      {
        label: "Failures",
        value: failed,
        detail: "Processes needing review",
        tone: failed ? "danger" : "neutral"
      }
    ];
  }, [
    availableExecutionCatalogRows,
    executionSchedules,
    executionSummaryById,
    testRunsView,
    workspaceTransactionStatusCounts,
    workspaceTransactions.length
  ]);

const isRunCatalogMetricLoading = isExecutionRunsView(testRunsView)
    ? executionsQuery.isLoading || allExecutionResultsQuery.isLoading
    : testRunsView === "scheduled-runs"
      ? executionSchedulesQuery.isLoading
      : workspaceTransactionsQuery.isLoading;

const visibleRunLibraryIds = useMemo(() => {
    if (isExecutionRunsView(testRunsView)) {
      return activeExecutionCatalogRows.map((execution) => execution.id);
    }

    if (testRunsView === "scheduled-runs") {
      return filteredSchedules.map((schedule) => schedule.id);
    }

    if (testRunsView === "batch-process") {
      return filteredWorkspaceTransactions.map((transaction) => transaction.id);
    }

    return [];
  }, [activeExecutionCatalogRows, filteredSchedules, filteredWorkspaceTransactions, testRunsView]);

const selectedRunLibraryActionIds = isExecutionRunsView(testRunsView)
    ? selectedActionExecutionIds
    : testRunsView === "scheduled-runs"
      ? selectedActionScheduleIds
      : selectedActionOperationIds;

const areAllFilteredRunLibraryItemsSelected = visibleRunLibraryIds.length > 0 && visibleRunLibraryIds.every((id) => selectedRunLibraryActionIds.includes(id));

const activeExecutionFilterCount =
    Number(executionStatusFilter !== "all") +
    Number(executionIssueFilter !== "all") +
    Number(executionEvidenceFilter !== "all");

const executionCardMeasureTarget = activeExecutionCatalogRows[0] || null;
useEffect(() => {
    const node = executionCardMeasureRef.current;
    if (!node) {
      return;
    }

    const updateHeight = () => {
      const nextHeight = Math.max(180, Math.ceil(node.getBoundingClientRect().height) + 12);
      setExecutionListItemHeight((current) => (Math.abs(current - nextHeight) > 1 ? nextHeight : current));
    };

    updateHeight();

    if (typeof ResizeObserver === "undefined") {
      return;
    }

    const observer = new ResizeObserver(() => updateHeight());
    observer.observe(node);

    return () => observer.disconnect();
  }, [executionCardMeasureTarget?.id]);
  const clearRunLibrarySelection = () => {
                    if (isExecutionRunsView(testRunsView)) {
                      setSelectedActionExecutionIds([]);
                    } else if (testRunsView === "scheduled-runs") {
                      setSelectedActionScheduleIds([]);
                    } else {
                      setSelectedActionOperationIds([]);
                    }
                  };
  const selectAllRunLibraryItems = () => {
                  if (isExecutionRunsView(testRunsView)) {
                    setSelectedActionExecutionIds((current) => Array.from(new Set([...current, ...visibleRunLibraryIds])));
                  } else if (testRunsView === "scheduled-runs") {
                    setSelectedActionScheduleIds((current) => Array.from(new Set([...current, ...visibleRunLibraryIds])));
                  } else {
                    setSelectedActionOperationIds((current) => Array.from(new Set([...current, ...visibleRunLibraryIds])));
                  }
                  };
  return { clearRunLibrarySelection, selectAllRunLibraryItems, filteredWorkspaceTransactions, selectedWorkspaceTransaction, executionStatusOptions, executionIdsWithEvidence, filteredExecutions, activeExecutionCatalogRows, availableExecutionCatalogRows, filteredSchedules, runCatalogMetricCards, isRunCatalogMetricLoading, visibleRunLibraryIds, selectedRunLibraryActionIds, areAllFilteredRunLibraryItemsSelected, activeExecutionFilterCount, executionCardMeasureTarget };
}

