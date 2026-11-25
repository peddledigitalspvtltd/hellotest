import type { WorkflowReviewScope } from "../../lib/workflowReviewScope";

import { TEST_CASE_RENDER_BATCH_SIZE } from "./testCaseWorkspaceUtils";
import { type CaseStepFilter, type CaseRunFilter } from "./testCaseWorkspaceTypes";
import { useDeferredValue, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useInfiniteQuery, useQueries, useQuery } from "@tanstack/react-query";
import { optionalQueryView } from "@hellotest/platform/frontend/src/shared/lib/optionalQueryView";
import { api } from "@hellotest/platform/frontend/src/lib/api";
import { asArray, getVerifiedNextPageCursor, normalizePagedResult } from "@hellotest/platform/frontend/src/shared/lib/collectionGuards";
import { getHierarchyPageSize, getUnassignedPageSize } from "./../../lib/hierarchyPagination";
import { readDefaultCatalogViewMode } from "@hellotest/platform/frontend/src/shared/lib/viewPreferences";
import type { TestCase } from "@hellotest/platform/frontend/src/types";

export interface useCaseLibraryInputs {
  workflowReviewScope: WorkflowReviewScope | null;
  projectId: string;
  appTypeId: string;
  can: (permission: string) => boolean;
  canViewExecutionInsights: boolean;
  reviewUserId: string;
  isReviewQueueOpen: boolean;
}

export function useCaseLibrary({ workflowReviewScope, projectId, appTypeId, can, canViewExecutionInsights, reviewUserId, isReviewQueueOpen }: useCaseLibraryInputs) {
const [searchTerm, setSearchTerm] = useState("");

const [catalogViewMode, setCatalogViewMode] = useState<"tile" | "list">(() => readDefaultCatalogViewMode());

const [isCatalogViewPending, startCatalogViewTransition] = useTransition();

const deferredSearchTerm = useDeferredValue(searchTerm);

const [visibleTestCaseCount, setVisibleTestCaseCount] = useState(TEST_CASE_RENDER_BATCH_SIZE);

const [caseStatusFilter, setCaseStatusFilter] = useState("all");

const [casePriorityFilter, setCasePriorityFilter] = useState("all");

const [caseStepFilter, setCaseStepFilter] = useState<CaseStepFilter>("all");

const [caseRunFilter, setCaseRunFilter] = useState<CaseRunFilter>("all");

const [selectedActionTestCaseIds, setSelectedActionTestCaseIds] = useState<string[]>([]);

const selectedActionCaseSnapshotsRef = useRef<Map<string, TestCase>>(new Map());

const [expandedModuleIds, setExpandedModuleIds] = useState<string[]>([]);

const [isUnassignedModuleExpanded, setIsUnassignedModuleExpanded] = useState(true);

const [modulePageCursorsById, setModulePageCursorsById] = useState<Record<string, Array<string | null>>>({});

const [selectedModuleIds, setSelectedModuleIds] = useState<string[]>([]);

const catalogFilters = useMemo(() => ({
    ids: workflowReviewScope?.ids.join(","),
    search: isReviewQueueOpen ? undefined : deferredSearchTerm.trim() || undefined,
    workflow_status: isReviewQueueOpen || caseStatusFilter === "all" ? undefined : caseStatusFilter,
    priority: isReviewQueueOpen || casePriorityFilter === "all" ? undefined : Number(casePriorityFilter),
    step_filter: isReviewQueueOpen || caseStepFilter === "all" ? undefined : caseStepFilter,
    run_filter: isReviewQueueOpen || caseRunFilter === "all" ? undefined : caseRunFilter,
    review_queue: isReviewQueueOpen ? "mine" as const : undefined,
    exclude_automated: isReviewQueueOpen ? undefined : true,
    include_total: false,
    include_execution: canViewExecutionInsights
  }), [workflowReviewScope, isReviewQueueOpen, deferredSearchTerm, caseStatusFilter, casePriorityFilter, caseStepFilter, caseRunFilter, canViewExecutionInsights]);

const catalogFilterKey = JSON.stringify(catalogFilters);

const [modulePageFilterKey, setModulePageFilterKey] = useState(catalogFilterKey);

const scopedModulePageCursors = useMemo(() => modulePageFilterKey === catalogFilterKey ? modulePageCursorsById : {}, [modulePageFilterKey, catalogFilterKey, modulePageCursorsById]);

const isCatalogFiltered = Boolean(workflowReviewScope || isReviewQueueOpen || catalogFilters.search || catalogFilters.workflow_status || catalogFilters.priority || catalogFilters.step_filter || catalogFilters.run_filter);

const [collapsedFilteredModuleIds, setCollapsedFilteredModuleIds] = useState<string[]>([]);

const isModuleExpanded = (moduleId: string) => isCatalogFiltered ? !collapsedFilteredModuleIds.includes(moduleId) : expandedModuleIds.includes(moduleId);

useEffect(() => {
    setCollapsedFilteredModuleIds([]);
    setModulePageFilterKey(catalogFilterKey);
    setModulePageCursorsById({});
  }, [catalogFilterKey]);

const testCaseMetricsQuery = useQuery({
    queryKey: ["test-case-metrics", appTypeId, projectId, canViewExecutionInsights, reviewUserId, isReviewQueueOpen],
    queryFn: () => api.testCases.metrics({
      app_type_id: appTypeId,
      project_id: projectId,
      exclude_automated: catalogFilters.exclude_automated,
      review_queue: catalogFilters.review_queue,
      include_execution: canViewExecutionInsights
    }),
    enabled: can("testcase.view") && Boolean(appTypeId && projectId && !workflowReviewScope),
    staleTime: 120_000,
    gcTime: 600_000
  });

const testCasesQuery = useInfiniteQuery({
    queryKey: ["global-test-cases", appTypeId, projectId, catalogFilters, reviewUserId],
    queryFn: async ({ pageParam, signal }) => normalizePagedResult<TestCase>(
      workflowReviewScope?.error ? {items: [], is_last: true, next_cursor: null} : await api.testCases.listPage({
        ...catalogFilters,
        project_id: projectId,
        app_type_id: appTypeId,
        unassigned_module: !isCatalogFiltered,
        page_size: getUnassignedPageSize(Boolean(pageParam)),
        cursor: pageParam,
        projection: "summary"
      }, { signal })
    ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage, _allPages, _lastPageParam, allPageParams) => {
      const nextCursor = getVerifiedNextPageCursor(lastPage);
      return nextCursor && !allPageParams.includes(nextCursor) ? nextCursor : undefined;
    },
    enabled: (can("testcase.view")) && Boolean(appTypeId),
    placeholderData: (previous, previousQuery) => !isReviewQueueOpen
      && previousQuery?.queryKey[1] === appTypeId && previousQuery?.queryKey[2] === projectId
      && previousQuery?.queryKey[4] === reviewUserId
      && (previousQuery?.queryKey[3] as { ids?: string })?.ids === catalogFilters.ids
      && !(previousQuery?.queryKey[3] as { review_queue?: string })?.review_queue ? previous : undefined,
    refetchInterval: isReviewQueueOpen ? 30_000 : false,
    staleTime: 120_000,
    gcTime: 600_000
  });

const testCaseModulesQuery = optionalQueryView(useQuery({
    queryKey: ["test-case-modules", appTypeId, projectId],
    queryFn: async () => asArray(await api.testCaseModules.list({ app_type_id: appTypeId, projection: "summary" })),
    enabled: !workflowReviewScope && !isReviewQueueOpen && (can("testcase.view")) && Boolean(appTypeId),
    staleTime: 120_000,
    gcTime: 600_000
  }), can("testcase.view"));

const moduleMetricHeaders = useMemo(
    () => asArray(testCaseModulesQuery.data),
    [testCaseModulesQuery.data]
  );

const modulePageRequests = useMemo(
    () => moduleMetricHeaders.filter((module) => !isCatalogFiltered && expandedModuleIds.includes(module.id)).flatMap((module) => {
      const cursors = scopedModulePageCursors[module.id] || [null];
      return cursors.map((cursor, pageIndex) => ({ module, cursor, pageIndex }));
    }),
    [moduleMetricHeaders, scopedModulePageCursors, expandedModuleIds, isCatalogFiltered]
  );

const moduleCaseQueries = useQueries({
    queries: modulePageRequests.map(({ module, cursor, pageIndex }) => ({
      queryKey: ["test-case-module-children", projectId, appTypeId, module.id, pageIndex, cursor || "first", catalogFilters],
      queryFn: async () => normalizePagedResult<TestCase>(
        await api.testCaseModules.listCases(module.id, {
          ...catalogFilters,
          page_size: getHierarchyPageSize(module.test_case_count, pageIndex),
          cursor: cursor || undefined,
          projection: "summary" as const
        })
      ),
      staleTime: 120_000,
      gcTime: 600_000
    }))
  });

const modulePageStateById = useMemo(() => modulePageRequests.reduce<Record<string, {
    loaded: number;
    total: number;
    nextCursor: string | null;
    isInitialLoading: boolean;
    isLoadingMore: boolean;
    failedPageIndex: number | null;
  }>>((state, request, index) => {
    const response = moduleCaseQueries[index];
    const current = state[request.module.id] || {
      loaded: 0,
      total: request.module.test_case_count || 0,
      nextCursor: null,
      isInitialLoading: false,
      isLoadingMore: false,
      failedPageIndex: null
    };
    current.loaded += asArray(response.data?.items).length;
    current.total = Math.max(current.total, response.data?.total ?? 0, current.loaded);
    if (response.data) {
      const nextCursor = getVerifiedNextPageCursor(response.data);
      const requestedCursors = scopedModulePageCursors[request.module.id] || [null];
      current.nextCursor = nextCursor && !requestedCursors.includes(nextCursor) ? nextCursor : null;
    }
    current.isInitialLoading = current.isInitialLoading || (request.pageIndex === 0 && response.isFetching && !response.data);
    current.isLoadingMore = current.isLoadingMore || (request.pageIndex > 0 && response.isFetching);
    if (response.isError) current.failedPageIndex = request.pageIndex;
    state[request.module.id] = current;
    return state;
  }, {}), [moduleCaseQueries, scopedModulePageCursors, modulePageRequests]);

const retryModulePage = (moduleId: string, pageIndex: number) => {
    const queryIndex = modulePageRequests.findIndex((request) => request.module.id === moduleId && request.pageIndex === pageIndex);
    if (queryIndex >= 0) void moduleCaseQueries[queryIndex]?.refetch();
  };

const loadNextModulePage = (moduleId: string) => {
    const pageState = modulePageStateById[moduleId];
    if (pageState?.failedPageIndex !== null && pageState?.failedPageIndex !== undefined) {
      retryModulePage(moduleId, pageState.failedPageIndex);
      return;
    }
    const nextCursor = pageState?.nextCursor;
    if (!nextCursor) return;
    setModulePageCursorsById((current) => {
      const cursors = current[moduleId] || [null];
      if (cursors.includes(nextCursor)) return current;
      return { ...current, [moduleId]: [...cursors, nextCursor] };
    });
  };

const toggleModuleExpansion = (moduleId: string) => {
    if (isCatalogFiltered) {
      setCollapsedFilteredModuleIds((current) => current.includes(moduleId) ? current.filter((id) => id !== moduleId) : [...current, moduleId]);
      return;
    }
    setExpandedModuleIds((current) => current.includes(moduleId)
      ? current.filter((id) => id !== moduleId)
      : [...current, moduleId]);
  };

const testCaseModules = workflowReviewScope || isReviewQueueOpen ? [] : asArray(testCaseModulesQuery.data);

return { searchTerm, setSearchTerm, catalogViewMode, setCatalogViewMode, isCatalogViewPending, startCatalogViewTransition, deferredSearchTerm, visibleTestCaseCount, setVisibleTestCaseCount, caseStatusFilter, setCaseStatusFilter, casePriorityFilter, setCasePriorityFilter, caseStepFilter, setCaseStepFilter, caseRunFilter, setCaseRunFilter, selectedActionTestCaseIds, setSelectedActionTestCaseIds, selectedActionCaseSnapshotsRef, expandedModuleIds, setExpandedModuleIds, isUnassignedModuleExpanded, setIsUnassignedModuleExpanded, setModulePageCursorsById, selectedModuleIds, setSelectedModuleIds, catalogFilterKey, isCatalogFiltered, collapsedFilteredModuleIds, isModuleExpanded, testCaseMetricsQuery, testCasesQuery, testCaseModulesQuery, modulePageRequests, moduleCaseQueries, modulePageStateById, retryModulePage, loadNextModulePage, toggleModuleExpansion, testCaseModules };
}
