import { useEffect, type Dispatch, type SetStateAction, type MutableRefObject } from "react";
import { normalizeRunCatalogView } from "../../lib/runCatalog";
import { type Execution } from "@hellotest/platform/frontend/src/types";
import { TestRunsView, isExecutionRunsView, resolveExecutionRunBucket } from "./executionWorkspaceModel";
import { type NavigateFunction, type SetURLSearchParams } from "react-router-dom";

export interface ExecutionRouteNavigationRouter {
  searchParams: URLSearchParams;
  setSearchParams: SetURLSearchParams;
  location: { key: string };
  navigate: NavigateFunction;
}

export interface ExecutionRouteNavigationSelection {
  dismissedExecutionRouteRef: MutableRefObject<string>;
  dismissedCaseRouteRef: MutableRefObject<string>;
  setSelectedExecutionId: Dispatch<SetStateAction<string>>;
  setFocusedSuiteId: Dispatch<SetStateAction<string>>;
  setSelectedTestCaseId: Dispatch<SetStateAction<string>>;
  setSelectedCaseInstanceKey: Dispatch<SetStateAction<string>>;
  dismissedScheduleRouteRef: MutableRefObject<string>;
  setTestRunsView: Dispatch<SetStateAction<TestRunsView>>;
  setSelectedScheduleId: Dispatch<SetStateAction<string>>;
  selectedExecutionQuery: { data?: Execution; isLoading: boolean; isFetching: boolean };
  testRunsView: TestRunsView;
  selectedExecutionId: string;
  selectedScheduleId: string;
  selectedOperationId: string;
  setSelectedOperationId: Dispatch<SetStateAction<string>>;
  selectedTestCaseId: string;
  setExpandedExecutionSuiteIds: Dispatch<SetStateAction<string[]>>;
}

export interface ExecutionRouteNavigationAccess {
  featureFlagsQuery: { isPending: boolean };
  canRunLocalAutomation: boolean;
}

export interface ExecutionRouteNavigationScope {
  executions: Execution[];
  executionsQuery: { isLoading: boolean; isFetching: boolean };
  availableExecutionCatalogRows: Execution[];
}

export interface ExecutionRouteNavigationOptions {
  router: ExecutionRouteNavigationRouter;
  selection: ExecutionRouteNavigationSelection;
  access: ExecutionRouteNavigationAccess;
  scope: ExecutionRouteNavigationScope;
}

export function useExecutionRouteNavigation({ router, selection, access, scope }: ExecutionRouteNavigationOptions) {
  const { searchParams, setSearchParams, location, navigate } = router;
  const { dismissedExecutionRouteRef, dismissedCaseRouteRef, setSelectedExecutionId, setFocusedSuiteId, setSelectedTestCaseId, setSelectedCaseInstanceKey, dismissedScheduleRouteRef, setTestRunsView, setSelectedScheduleId, selectedExecutionQuery, testRunsView, selectedExecutionId, selectedScheduleId, selectedOperationId, setSelectedOperationId, selectedTestCaseId, setExpandedExecutionSuiteIds } = selection;
  const { featureFlagsQuery, canRunLocalAutomation } = access;
  const { executions, executionsQuery, availableExecutionCatalogRows } = scope;
const syncExecutionSearchParams = (
    executionId: string,
    testCaseId?: string | null,
    caseInstanceKey?: string | null
  ) => {
    const currentExecutionId = searchParams.get("execution") || "";
    const currentTestCaseId = searchParams.get("testCase") || "";
    const currentCaseInstanceKey = searchParams.get("iteration") || "";
    const nextTestCaseId = testCaseId || "";
    const nextCaseInstanceKey = caseInstanceKey || "";

    if (
      currentExecutionId === executionId
      && currentTestCaseId === nextTestCaseId
      && currentCaseInstanceKey === nextCaseInstanceKey
    ) {
      return;
    }

    const nextParams = new URLSearchParams(searchParams);

    if (executionId) {
      nextParams.set("execution", executionId);
    } else {
      nextParams.delete("execution");
    }

    if (testCaseId) {
      nextParams.set("testCase", testCaseId);
    } else {
      nextParams.delete("testCase");
    }

    if (testCaseId && caseInstanceKey) {
      nextParams.set("iteration", caseInstanceKey);
    } else {
      nextParams.delete("iteration");
    }

    setSearchParams(nextParams, { replace: true });
  };

const focusExecution = (executionId: string) => {
    dismissedExecutionRouteRef.current = "";
    dismissedCaseRouteRef.current = "";
    setSelectedExecutionId(executionId);
    setFocusedSuiteId("");
    setSelectedTestCaseId("");
    setSelectedCaseInstanceKey("");
    syncExecutionSearchParams(executionId, null);
  };

const focusExecutionSchedule = (scheduleId: string) => {
    dismissedScheduleRouteRef.current = "";
    const nextParams = new URLSearchParams(searchParams);
    nextParams.set("view", "scheduled-runs");
    nextParams.set("schedule", scheduleId);
    nextParams.delete("execution");
    nextParams.delete("testCase");
    setTestRunsView("scheduled-runs");
    setSelectedScheduleId(scheduleId);
    setSelectedExecutionId("");
    setFocusedSuiteId("");
    setSelectedTestCaseId("");
    setSelectedCaseInstanceKey("");
    setSearchParams(nextParams, { replace: true });
  };

const closeExecutionScheduleDetail = () => {
    dismissedScheduleRouteRef.current = `${location.key}:${searchParams.get("schedule") || ""}`;
    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete("schedule");
    setSelectedScheduleId("");
    setSearchParams(nextParams, { replace: true });
  };

useEffect(() => {
    const requestedExecutionId = searchParams.get("execution");
    const requestedViewParam = normalizeRunCatalogView(searchParams.get("view"));
    if (searchParams.get("view") === "test-case-runs") {
      const nextParams = new URLSearchParams(searchParams);
      nextParams.set("view", "suite-runs");
      setSearchParams(nextParams, { replace: true });
      return;
    }
    if (requestedViewParam === "batch-process") {
      navigate("/testops", { replace: true });
      return;
    }
    if (requestedViewParam === "local-runs" && !featureFlagsQuery.isPending && !canRunLocalAutomation) {
      navigate("/executions?view=suite-runs", { replace: true });
      return;
    }
    const requestedView: TestRunsView | null =
      requestedViewParam === "suite-runs"
      || requestedViewParam === "local-runs"
      || requestedViewParam === "scheduled-runs"
        ? requestedViewParam
        : null;
    const requestedTestCaseId = searchParams.get("testCase");
    // Router updates may commit after local state. A dismissed URL must not
    // reopen the detail while the Back navigation is settling.
    if (dismissedExecutionRouteRef.current) {
      if (requestedExecutionId === dismissedExecutionRouteRef.current) return;
      dismissedExecutionRouteRef.current = "";
    }

    if (requestedExecutionId) {
      const requestedExecution =
        executions.find((execution) => execution.id === requestedExecutionId)
        || (selectedExecutionQuery.data?.id === requestedExecutionId ? selectedExecutionQuery.data : null);
      const fallbackView = requestedView || "suite-runs";

      if (!isExecutionRunsView(testRunsView)) {
        setTestRunsView(requestedExecution ? resolveExecutionRunBucket(requestedExecution) : fallbackView);
      }

      if (requestedExecution) {
        const requestedView = resolveExecutionRunBucket(requestedExecution);
        if (testRunsView !== requestedView) {
          setTestRunsView(requestedView);
        }
      } else if (requestedView && testRunsView !== requestedView) {
        setTestRunsView(requestedView);
      }

      if (selectedExecutionId !== requestedExecutionId) {
        setSelectedExecutionId(requestedExecutionId);
      }
      return;
    }

    if (requestedView && selectedExecutionId) {
      setSelectedExecutionId("");
      setFocusedSuiteId("");
      setSelectedTestCaseId("");
      setSelectedCaseInstanceKey("");
    }

    if (requestedView && requestedView !== "scheduled-runs" && selectedScheduleId) {
      setSelectedScheduleId("");
    }

    if (requestedView && selectedOperationId) {
      setSelectedOperationId("");
    }

    if (requestedView && testRunsView !== requestedView) {
      setTestRunsView(requestedView);
      return;
    }

    if (executionsQuery.isLoading || executionsQuery.isFetching || selectedExecutionQuery.isLoading || selectedExecutionQuery.isFetching) {
      return;
    }

    if (selectedExecutionId && !executions.some((execution) => execution.id === selectedExecutionId)) {
      setSelectedExecutionId("");
    }
  }, [
    canRunLocalAutomation,
    executions,
    executionsQuery.isFetching,
    executionsQuery.isLoading,
    featureFlagsQuery.isPending,
    navigate,
    searchParams,
    selectedExecutionId,
    selectedOperationId,
    selectedScheduleId,
    selectedExecutionQuery.data,
    selectedExecutionQuery.isFetching,
    selectedExecutionQuery.isLoading,
    testRunsView
  ]);

useEffect(() => {
    if (!isExecutionRunsView(testRunsView)) {
      if (searchParams.get("execution")) {
        return;
      }

      setSelectedExecutionId("");
      setFocusedSuiteId("");
      setSelectedTestCaseId("");
      setSelectedCaseInstanceKey("");
      syncExecutionSearchParams("", null);
    }
  }, [searchParams, testRunsView]);

const closeExecutionDrilldown = () => {
    dismissedExecutionRouteRef.current = searchParams.get("execution") || selectedExecutionId;
    dismissedCaseRouteRef.current = `${searchParams.get("execution") || selectedExecutionId}:${searchParams.get("testCase") || selectedTestCaseId}`;
    setSelectedExecutionId("");
    setFocusedSuiteId("");
    setSelectedTestCaseId("");
    setSelectedCaseInstanceKey("");
    syncExecutionSearchParams("", null);
  };

const closeCaseDrilldown = () => {
    dismissedCaseRouteRef.current = `${searchParams.get("execution") || selectedExecutionId}:${searchParams.get("testCase") || selectedTestCaseId}`;
    setSelectedTestCaseId("");
    setSelectedCaseInstanceKey("");
    syncExecutionSearchParams(selectedExecutionId, null);
  };

const toggleSuiteGroup = (suiteId: string) => {
    setFocusedSuiteId(suiteId);
    setExpandedExecutionSuiteIds((current) =>
      current.includes(suiteId)
        ? current.filter((id) => id !== suiteId)
        : [...current, suiteId]
    );
  };

useEffect(() => {
    if (!isExecutionRunsView(testRunsView) || !selectedExecutionId) {
      return;
    }

    if (executionsQuery.isLoading || executionsQuery.isFetching || selectedExecutionQuery.isLoading || selectedExecutionQuery.isFetching) {
      return;
    }

    if (searchParams.get("execution") && selectedExecutionQuery.data?.id === selectedExecutionId) {
      return;
    }

    if (availableExecutionCatalogRows.some((execution) => execution.id === selectedExecutionId)) {
      return;
    }

    setSelectedExecutionId("");
    setFocusedSuiteId("");
    setSelectedTestCaseId("");
    syncExecutionSearchParams("", null);
  }, [
    availableExecutionCatalogRows,
    executionsQuery.isFetching,
    executionsQuery.isLoading,
    searchParams,
    selectedExecutionId,
    selectedExecutionQuery.data,
    selectedExecutionQuery.isFetching,
    selectedExecutionQuery.isLoading,
    testRunsView
  ]);
  return { syncExecutionSearchParams, focusExecution, focusExecutionSchedule, closeExecutionScheduleDetail, closeExecutionDrilldown, closeCaseDrilldown, toggleSuiteGroup };
}
