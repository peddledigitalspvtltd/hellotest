import { canonicalRunSummary } from "../../lib/executionRunSummary";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { optionalQueryView } from "@hellotest/platform/frontend/src/shared/lib/optionalQueryView";
import { api } from "@hellotest/platform/frontend/src/lib/api";
import { asArray } from "@hellotest/platform/frontend/src/shared/lib/collectionGuards";
import { type Execution, type ExecutionResult, type WorkspaceTransaction, type SessionPayload } from "@hellotest/platform/frontend/src/types";
import { TestRunsView, EMPTY_EXECUTION_RUN_SUMMARY, EXECUTION_POLL_INTERVAL_MS, toTimestamp, isExecutionRunsView, isBatchProcessTransaction } from "./executionWorkspaceModel";

export interface ExecutionCatalogQueryOptions { projectId: string; appTypeId: string; testRunsView: TestRunsView; isCreateScheduleModalOpen: boolean; canViewSchedules: boolean; can: (permission: string) => boolean; session: SessionPayload | null; }
export function useExecutionCatalogData({ projectId, appTypeId, testRunsView, isCreateScheduleModalOpen, canViewSchedules, can, session }: ExecutionCatalogQueryOptions) {
const executionsQuery = useQuery({
    queryKey: ["executions", projectId, appTypeId],
    queryFn: () => api.executions.list(projectId ? { project_id: projectId, app_type_id: appTypeId || undefined } : undefined),
    enabled: (can("run.view")) && Boolean(projectId && isExecutionRunsView(testRunsView)),
    refetchInterval: (query) => asArray<Execution>(query.state.data)
      .some((execution) => ["queued", "running"].includes(String(execution.status).toLowerCase()))
      ? EXECUTION_POLL_INTERVAL_MS
      : false
  });

const executionSchedulesQuery = optionalQueryView(useQuery({
    queryKey: ["execution-schedules", projectId, appTypeId],
    queryFn: () => api.executionSchedules.list({
      project_id: projectId || undefined,
      app_type_id: appTypeId || undefined
    }),
    enabled: (canViewSchedules) && Boolean(projectId && canViewSchedules && (testRunsView === "scheduled-runs" || isCreateScheduleModalOpen)),
    refetchInterval: false
  }), canViewSchedules);

const allExecutionResultsQuery = optionalQueryView(useQuery({
    queryKey: ["execution-results", "all", projectId],
    queryFn: () => api.executionResults.list({ project_id: projectId, limit: 5000 }),
    enabled: (can("result.view")) && Boolean(projectId && isExecutionRunsView(testRunsView)),
    refetchInterval: (query) => (query.state.data as ExecutionResult[] | undefined)
      ?.some((result) => String(result.status).toLowerCase() === "running")
      ? EXECUTION_POLL_INTERVAL_MS
      : false
  }), can("result.view"));

const workspaceTransactionsQuery = optionalQueryView(useQuery({
    queryKey: ["workspace-transactions", projectId, appTypeId],
    queryFn: () => api.workspaceTransactions.list({
      project_id: projectId || undefined,
      app_type_id: appTypeId || undefined,
      limit: 100
    }),
    enabled: (can("transaction.view")) && Boolean(projectId && session && testRunsView === "batch-process"),
    refetchInterval: (query) => (query.state.data as WorkspaceTransaction[] | undefined)
      ?.some((transaction) => ["queued", "running", "processing"].includes(String(transaction.status).toLowerCase()))
      ? EXECUTION_POLL_INTERVAL_MS
      : false
  }), can("transaction.view"));

const executions = useMemo(
    () =>
      [...asArray(executionsQuery.data)].sort((left, right) => {
        const rightTimestamp =
          toTimestamp(right.created_at) ??
          toTimestamp(right.started_at) ??
          toTimestamp(right.updated_at) ??
          0;
        const leftTimestamp =
          toTimestamp(left.created_at) ??
          toTimestamp(left.started_at) ??
          toTimestamp(left.updated_at) ??
          0;

        if (rightTimestamp !== leftTimestamp) {
          return rightTimestamp - leftTimestamp;
        }

        return String(right.id).localeCompare(String(left.id));
      }),
    [executionsQuery.data]
  );

const executionSchedules = asArray(executionSchedulesQuery.data);

const allExecutionResults = asArray(allExecutionResultsQuery.data);

const workspaceTransactions = useMemo(
    () =>
      asArray(workspaceTransactionsQuery.data).filter((transaction) => isBatchProcessTransaction(transaction)),
    [workspaceTransactionsQuery.data]
  );

const workspaceTransactionStatusCounts = useMemo(
    () =>
      workspaceTransactions.reduce<Record<string, number>>((accumulator, transaction) => {
        accumulator[transaction.status] = (accumulator[transaction.status] || 0) + 1;
        return accumulator;
      }, {}),
    [workspaceTransactions]
  );

const executionSummaryById = useMemo(() => Object.fromEntries(executions.map(execution => {
    const receipt = canonicalRunSummary(execution, allExecutionResults);
    return [execution.id, { ...EMPTY_EXECUTION_RUN_SUMMARY, total: receipt.total,
      passed: receipt.passed, failed: receipt.failed, blocked: receipt.blocked,
      running: receipt.running, paused: receipt.paused, skipped: receipt.skipped,
      aborted: receipt.aborted, caseCount: receipt.distinct_cases, passRate: receipt.pass_rate || 0,
      latestActivityAt: execution.updated_at || execution.created_at || null,
      totalDurationMs: execution.metrics?.duration_ms || 0 }];
  })), [executions, allExecutionResults]);

const executionById = useMemo(
    () =>
      executions.reduce<Record<string, Execution>>((accumulator, execution) => {
        accumulator[execution.id] = execution;
        return accumulator;
      }, {}),
    [executions]
  );

  return { executionsQuery, executionSchedulesQuery, allExecutionResultsQuery, workspaceTransactionsQuery, executions, executionSchedules, allExecutionResults, workspaceTransactions, workspaceTransactionStatusCounts, executionSummaryById, executionById };
}

