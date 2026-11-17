import type { WorkflowReviewScope } from "../../lib/workflowReviewScope";
import type { UseInfiniteQueryResult } from "@tanstack/react-query";
import type { SafePagedResult } from "@hellotest/platform/frontend/src/shared/lib/collectionGuards";
import type { useCaseLibrary } from './useCaseLibrary';

import { TEST_CASE_RENDER_BATCH_SIZE, TEST_CASE_WORKFLOW_STATUS_OPTIONS, formatCompactDuration } from "./testCaseWorkspaceUtils";
import { type CaseStepFilter, type CaseRunFilter } from "./testCaseWorkspaceTypes";
import { useEffect, useMemo } from "react";
import type { InfiniteData } from "@tanstack/react-query";
import { IconChartBar, IconClipboardCheck } from "@tabler/icons-react";
import { HierarchyQuickInsights } from "./../../components/HierarchyQuickInsights";
import { HierarchyAutoLoadSentinel } from "./../../components/HierarchyLoadMoreButton";
import { type QualityMetric } from "@hellotest/dashboard/frontend/components/QualityMetricStrip";
import { asArray } from "@hellotest/platform/frontend/src/shared/lib/collectionGuards";
import { deriveModuleHealth } from "./../../lib/hierarchyHealth";
import type { ExecutionResult, Requirement, SharedStepGroup, TestCase, TestCaseModule, TestSuite } from "@hellotest/platform/frontend/src/types";

export interface useCaseLibraryModelInputs {
  workflowReviewScope: WorkflowReviewScope | null;
  appTypeId: string;
  can: (permission: string, overrideProjectId?: string | null | undefined) => boolean;
  canViewRequirements: boolean;
  canViewExecutionInsights: boolean;
  isReviewQueueOpen: boolean;
  catalogViewMode: "tile" | "list";
  deferredSearchTerm: string;
  visibleTestCaseCount: number;
  setVisibleTestCaseCount: React.Dispatch<React.SetStateAction<number>>;
  caseStatusFilter: string;
  casePriorityFilter: string;
  caseStepFilter: CaseStepFilter;
  caseRunFilter: CaseRunFilter;
  selectedActionTestCaseIds: string[];
  setSelectedActionTestCaseIds: React.Dispatch<React.SetStateAction<string[]>>;
  selectedActionCaseSnapshotsRef: React.MutableRefObject<Map<string, TestCase>>;
  expandedModuleIds: string[];
  isUnassignedModuleExpanded: boolean;
  selectedModuleIds: string[];
  setSelectedModuleIds: React.Dispatch<React.SetStateAction<string[]>>;
  libraryScope: "automation" | "manual" | "both";
  catalogFilterKey: string;
  isCatalogFiltered: boolean;
  collapsedFilteredModuleIds: string[];
  isModuleExpanded: (moduleId: string) => boolean;
  testCaseMetricsQuery: ReturnType<typeof useCaseLibrary>["testCaseMetricsQuery"];
  testCasesQuery: ReturnType<typeof useCaseLibrary>["testCasesQuery"];
  modulePageRequests: { module: TestCaseModule; cursor: string | null; pageIndex: number; }[];
  moduleCaseQueries: ReturnType<typeof useCaseLibrary>["moduleCaseQueries"];
  modulePageStateById: Record<string, { loaded: number; total: number; nextCursor: string | null; isInitialLoading: boolean; isLoadingMore: boolean; failedPageIndex: number | null; }>;
  loadNextModulePage: (moduleId: string) => void;
  testCaseModules: TestCaseModule[];
  moduleDraftInitialCaseIds: string[];
  healthModuleId: string | null;
  modulePickerRequirementsQuery: UseInfiniteQueryResult<InfiniteData<SafePagedResult<Requirement>, unknown>, Error>;
  requirements: Requirement[];
  suites: TestSuite[];
  testCases: TestCase[];
  sharedStepGroups: SharedStepGroup[];
  executionResults: ExecutionResult[];
}

export function useCaseLibraryModel({ workflowReviewScope, appTypeId, can, canViewRequirements, canViewExecutionInsights, isReviewQueueOpen, catalogViewMode, deferredSearchTerm, visibleTestCaseCount, setVisibleTestCaseCount, caseStatusFilter, casePriorityFilter, caseStepFilter, caseRunFilter, selectedActionTestCaseIds, setSelectedActionTestCaseIds, selectedActionCaseSnapshotsRef, expandedModuleIds, isUnassignedModuleExpanded, selectedModuleIds, setSelectedModuleIds, libraryScope, catalogFilterKey, isCatalogFiltered, collapsedFilteredModuleIds, isModuleExpanded, testCaseMetricsQuery, testCasesQuery, modulePageRequests, moduleCaseQueries, modulePageStateById, loadNextModulePage, testCaseModules, moduleDraftInitialCaseIds, healthModuleId, modulePickerRequirementsQuery, requirements, suites, testCases, sharedStepGroups, executionResults }: useCaseLibraryModelInputs) {
const historyByCaseId = useMemo(() => {
    const map: Record<string, ExecutionResult[]> = {};

    executionResults.forEach((result) => {
      map[result.test_case_id] = map[result.test_case_id] || [];
      map[result.test_case_id].push(result);
    });

    Object.values(map).forEach((items) => {
      items.sort((left, right) => String(right.created_at || "").localeCompare(String(left.created_at || "")));
    });

    return map;
  }, [executionResults]);

const sharedGroupNameById = useMemo(
    () =>
      sharedStepGroups.reduce<Record<string, string>>((accumulator, group) => {
        accumulator[group.id] = group.name;
        return accumulator;
      }, {}),
    [sharedStepGroups]
  );

const stepCountByCaseId = useMemo(
    () =>
      testCases.reduce<Record<string, number | undefined>>((counts, testCase) => {
        counts[testCase.id] = Number.isFinite(testCase.step_count)
          ? Number(testCase.step_count)
          : undefined;
        return counts;
      }, {}),
    [testCases]
  );

const requirementTitleById = useMemo(
    () =>
      requirements.reduce<Record<string, string>>((map, requirement) => {
        map[requirement.id] = requirement.title;
        return map;
      }, {}),
    [requirements]
  );

const requirementDisplayIdById = useMemo(
    () =>
      requirements.reduce<Record<string, string>>((map, requirement) => {
        map[requirement.id] = requirement.display_id || "Story";
        return map;
      }, {}),
    [requirements]
  );

const suiteNameById = useMemo(
    () =>
      suites.reduce<Record<string, string>>((accumulator, suite) => {
        accumulator[suite.id] = suite.name;
        return accumulator;
      }, {}),
    [suites]
  );

const caseStatusOptions = TEST_CASE_WORKFLOW_STATUS_OPTIONS;

const casePriorityOptions = useMemo(
    () => ["1", "2", "3", "4", "5"],
    []
  );

const existingCaseLabels = useMemo(() => {
    const labels = new Map<string, string>();
    testCases.flatMap((testCase) => testCase.labels || []).forEach((label) => {
      const normalizedLabel = String(label || "").trim();
      if (normalizedLabel && !labels.has(normalizedLabel.toLowerCase())) {
        labels.set(normalizedLabel.toLowerCase(), normalizedLabel);
      }
    });
    return Array.from(labels.values()).sort((left, right) => left.localeCompare(right));
  }, [testCases]);

const existingSuiteLabels = useMemo(() => {
    const labels = new Map<string, string>();
    [...existingCaseLabels, ...suites.flatMap((suite) => suite.labels || [])].forEach((label) => {
      const normalizedLabel = String(label || "").trim();
      if (normalizedLabel && !labels.has(normalizedLabel.toLowerCase())) {
        labels.set(normalizedLabel.toLowerCase(), normalizedLabel);
      }
    });
    return Array.from(labels.values()).sort((left, right) => left.localeCompare(right));
  }, [existingCaseLabels, suites]);

const caseModuleById = useMemo(() => {
    const map = new Map<string, TestCaseModule>();
    testCaseModules.forEach((module) => {
      (module.test_case_ids || []).forEach((testCaseId) => {
        map.set(testCaseId, module);
      });
    });

    testCases.forEach((testCase) => {
      const module = (testCase.module_ids || []).map((id) => testCaseModules.find((candidate) => candidate.id === id)).find(Boolean);
      if (module) map.set(testCase.id, module);
    });

    // Treat the scoped child response as authoritative for the module being
    // expanded. This keeps expansion reliable even while a module header from
    // an older Forge deployment has a missing or stale test_case_ids array.
    modulePageRequests.forEach(({ module }, queryIndex) => {
      asArray(moduleCaseQueries[queryIndex]?.data?.items).forEach((testCase) => {
        if (!map.has(testCase.id)) map.set(testCase.id, module);
      });
    });
    return map;
  }, [moduleCaseQueries, modulePageRequests, testCaseModules, testCases]);

const modulePickerTestCases = useMemo(() => {
    const byId = new Map<string, TestCase>();
    testCases.forEach((testCase) => byId.set(testCase.id, testCase));
    moduleDraftInitialCaseIds.forEach((testCaseId) => {
      const snapshot = selectedActionCaseSnapshotsRef.current.get(testCaseId);
      if (snapshot) byId.set(testCaseId, snapshot);
    });
    return [...byId.values()];
  }, [moduleDraftInitialCaseIds, testCases]);

const modulePickerRequirements = useMemo(() => {
    const byId = new Map<string, Requirement>();
    asArray(modulePickerRequirementsQuery.data?.pages)
      .flatMap((page) => asArray(page.items))
      .forEach((requirement) => byId.set(requirement.id, requirement));
    requirements.forEach((requirement) => byId.set(requirement.id, requirement));
    return [...byId.values()];
  }, [modulePickerRequirementsQuery.data?.pages, requirements]);

const moduleNameByPickerCaseId = useMemo(() => {
    const map = new Map<string, string>();
    modulePickerTestCases.forEach((testCase) => {
      const moduleName = caseModuleById.get(testCase.id)?.name || testCaseModules.find((module) => testCase.module_ids?.includes(module.id))?.name;
      if (moduleName) map.set(testCase.id, moduleName);
    });
    return map;
  }, [caseModuleById, modulePickerTestCases, testCaseModules]);

const filteredCases = testCases;

const hasActiveCaseCatalogFilter = Boolean(workflowReviewScope) || isReviewQueueOpen || Boolean(deferredSearchTerm.trim())
    || caseStatusFilter !== "all"
    || casePriorityFilter !== "all"
    || caseStepFilter !== "all"
    || caseRunFilter !== "all";

const moduleCaseGroups = useMemo(() => {
    const casesByModuleId = new Map<string, TestCase[]>();
    const unassignedCases: TestCase[] = [];

    filteredCases.forEach((testCase) => {
      const moduleIds = [...new Set([
        ...(testCase.module_ids || []),
        ...testCaseModules.filter((module) => module.test_case_ids?.includes(testCase.id)).map((module) => module.id),
        ...modulePageRequests.filter((_, index) => asArray(moduleCaseQueries[index]?.data?.items).some((item) => item.id === testCase.id)).map(({ module }) => module.id)
      ])];
      if (!moduleIds.length) {
        unassignedCases.push(testCase);
        return;
      }
      moduleIds.forEach((moduleId) => casesByModuleId.set(moduleId, [...(casesByModuleId.get(moduleId) || []), testCase]));
    });

    const groups = testCaseModules.map((module) => ({
      module,
      cases: casesByModuleId.get(module.id) || []
    }));

    return { groups, unassignedCases };
  }, [filteredCases, testCaseModules, modulePageRequests, moduleCaseQueries]);

const visibleModuleCaseGroups = useMemo(() => moduleCaseGroups.groups.filter(({ cases }) =>
    !hasActiveCaseCatalogFilter || cases.length > 0
  ), [hasActiveCaseCatalogFilter, moduleCaseGroups.groups]);

const moduleHealth = useMemo(() => ({
    byId: new Map(testCaseModules.map((module) => [module.id, testCaseMetricsQuery.data?.modules[module.id] || deriveModuleHealth([])])),
    unassigned: testCaseMetricsQuery.data?.unassigned || deriveModuleHealth([])
  }), [testCaseMetricsQuery.data, testCaseModules]);

const healthModule = healthModuleId === "unassigned"
    ? { name: "Ungrouped", health: moduleHealth.unassigned }
    : testCaseModules.some((module) => module.id === healthModuleId)
      ? { name: testCaseModules.find((module) => module.id === healthModuleId)!.name, health: moduleHealth.byId.get(healthModuleId!)! }
      : null;

const moduleHealthMetrics = (health: ReturnType<typeof deriveModuleHealth>): QualityMetric[] => {
    const executionUnavailable = "Run and result access is required to view execution evidence.";
    const noCases = health.count === 0;
    const riskAvailable = canViewExecutionInsights && canViewRequirements;
    return [
      { label: "Test Cases", value: health.count, tone: "info", detail: `${health.count} Test Cases in this module's current library scope.`, methodology: "Uses complete module totals from the catalog API, independent of loaded pages or search. Review mode includes only cases assigned to you for review." },
      { label: libraryScope === "manual" ? "Latest of manual or automation" : "Latest per catalog case", criteriaKey: libraryScope === "manual" ? "metric.module.latest_effective_pass" : "metric.module.latest_catalog_pass", value: !canViewExecutionInsights ? "Unavailable" : health.latestPassRatePercent === null ? "No runs" : `${health.latestPassRatePercent}%`,
        tone: !canViewExecutionInsights || health.latestPassRatePercent === null ? "neutral" : health.latestPassRatePercent >= 80 ? "success" : "warning",
        detail: !canViewExecutionInsights ? executionUnavailable : health.latestPassRatePercent === null ? "No finalized case outcomes are available in this module." : `${health.latestPassRatePercent}% of cases with a latest finalized outcome passed.`, methodology: "Uses the latest finalized manual or linked automation outcome per manual origin. Both source verdicts remain visible on each case tile; historical manual outcomes are preserved. Cases without a finalized outcome are excluded from the denominator." },
      { label: "At Risk", value: riskAvailable ? health.riskCount : "Unavailable", tone: !riskAvailable ? "neutral" : health.riskCount ? "warning" : "success",
        detail: riskAvailable ? `${health.riskCount}/${health.count} Test Cases have at least one risk signal.` : "Story and execution access is required to evaluate every risk signal.", methodology: "Counts each case once if it has no linked Story, no executable steps, a latest failed/blocked result, or Critical/High priority without automation. Signals may overlap." },
      { label: "Pending Review", value: health.pendingReviewCount, tone: health.pendingReviewCount ? "warning" : "success",
        detail: `${health.pendingReviewCount}/${health.count} Test Cases await review.`, methodology: "Includes pending human reviews and AI-generated cases awaiting review. Review mode limits the module scope to your assigned review queue." },
      { label: "Story Traceability", value: !canViewRequirements ? "Unavailable" : noCases ? "No cases" : `${health.traceabilityPercent}%`, tone: "info",
        detail: canViewRequirements ? `${health.traceabilityPercent}% of module Test Cases are linked to at least one Story.` : "Story access is required to view traceability evidence.", methodology: "Cases with a linked Story divided by Test Cases in this module. A case with multiple Story links is counted once." },
      { label: "Executable Cases", value: noCases ? "No cases" : `${health.executablePercent}%`, tone: noCases ? "neutral" : health.executablePercent === 100 ? "success" : "warning",
        detail: `${health.executablePercent}% of module Test Cases have authored steps.`, methodology: "Cases with at least one executable step divided by Test Cases in the module." },
      { label: "Execution Coverage", value: !canViewExecutionInsights ? "Unavailable" : noCases ? "No cases" : `${health.executionPercent}%`, tone: "info",
        detail: canViewExecutionInsights ? `${health.executionPercent}% of module cases have a finalized outcome.` : executionUnavailable, methodology: "Cases with a finalized passed, failed, or blocked result divided by Test Cases in this module." },
      { label: "Automation Coverage", value: noCases ? "No cases" : `${health.automationPercent}%`, tone: "info",
        detail: `${health.automationPercent}% of evaluated module Test Cases have automation coverage.`, methodology: "Cases with a linked automation case, divided by evaluated module cases. Manual and automation identities remain separate." },
      { label: "Average Execution", value: canViewExecutionInsights ? formatCompactDuration(health.averageExecutionMs) : "Unavailable", tone: "neutral",
        detail: !canViewExecutionInsights ? executionUnavailable : health.executionDurationSampleCount ? `Average across ${health.executionDurationSampleCount} recent finalized result durations.` : "No finalized execution durations are available.", methodology: "Total recorded duration divided by recent finalized results with a valid duration; missing durations are excluded." },
      { label: "Defect Density", value: !can("feedback.view") ? "Unavailable" : noCases ? "No cases" : health.defectDensity.toFixed(2), tone: !can("feedback.view") ? "neutral" : health.defectCount ? "warning" : "success",
        detail: can("feedback.view") ? `${health.defectCount} distinct linked Defects across ${health.count} Test Cases.` : "Defect access is required to view linked Defect evidence.", methodology: "Distinct linked Defects divided by module Test Cases. Includes open and closed Defects; a Defect linked to multiple cases is counted once." }
    ];
  };

const renderModuleMetrics = (health: ReturnType<typeof deriveModuleHealth>) => (
    <HierarchyQuickInsights
      count={health.count}
      countLabel={health.count === 1 ? "Test Case" : "Test Cases"}
      metrics={[
        {
          icon: <IconChartBar aria-hidden="true" size={13} stroke={1.8} />,
          label: libraryScope === "manual" ? "Latest of manual or automation" : "Latest per catalog case", criteriaKey: libraryScope === "manual" ? "metric.module.latest_effective_pass" : "metric.module.latest_catalog_pass",
          value: !canViewExecutionInsights ? "Unavailable" : health.latestPassRatePercent === null ? "No runs" : `${health.latestPassRatePercent}%`,
          tone: !canViewExecutionInsights || health.latestPassRatePercent === null ? "neutral" : health.latestPassRatePercent >= 80 ? "success" : health.latestPassRatePercent >= 60 ? "warning" : "danger",
          title: canViewExecutionInsights ? "Pass rate from the latest finalized outcome for each module Test Case" : "Run and result access is required."
        },
        {
          icon: <IconClipboardCheck aria-hidden="true" size={13} stroke={1.8} />,
          label: "At Risk",
          value: canViewExecutionInsights && canViewRequirements ? health.riskCount : "Unavailable",
          tone: !canViewExecutionInsights || !canViewRequirements ? "neutral" : health.riskCount ? "warning" : "success",
          title: canViewExecutionInsights && canViewRequirements ? `${health.riskCount}/${health.count} cases have missing Story links or steps, a failed/blocked outcome, or high priority without automation.` : "Story and execution access is required to evaluate every risk signal."
        }
      ]}
    />
  );

const renderDeferredModuleMetrics = (count?: number) => (
    <div className="module-deferred-summary">
      <strong>{Number.isFinite(count) ? Number(count) : "—"}</strong>
      <span>{Number(count) === 1 ? "Test case" : "Test cases"}</span>
      <small>{testCaseMetricsQuery.isError ? "Metrics unavailable" : "Loading metrics"}</small>
    </div>
  );

const hasCompleteModuleMetrics = (_moduleId: string) => Boolean(testCaseMetricsQuery.data);

const renderModuleLoadMoreFooter = (moduleId: string, moduleName: string) => {
    if (isCatalogFiltered) return null;
    const pageState = modulePageStateById[moduleId];
    if (
      !pageState
      || pageState.isInitialLoading
      || (!pageState.nextCursor && !pageState.isLoadingMore && Number(pageState.failedPageIndex) <= 0)
    ) {
      return null;
    }

    return (
      <HierarchyAutoLoadSentinel
        isLoading={pageState.isLoadingMore}
        error={pageState.failedPageIndex !== null ? "Unable to load more test cases" : undefined}
        onRetry={() => loadNextModulePage(moduleId)}
        progressKey={`${catalogFilterKey}:${pageState.loaded}`}
        onLoad={() => loadNextModulePage(moduleId)}
        scopeLabel={`test cases in ${moduleName}`}
      />
    );
  };

const moduleTileEntries = useMemo(() => {
    const entries: Array<
      | { kind: "module"; module: TestCaseModule; count: number }
      | { kind: "unassigned"; count: number }
      | { kind: "case"; testCase: TestCase; module?: TestCaseModule }
    > = [];

    if (workflowReviewScope || isReviewQueueOpen) return filteredCases.map((testCase) => ({ kind: "case" as const, testCase }));
    visibleModuleCaseGroups.forEach(({ module, cases }) => {
      entries.push({ kind: "module", module, count: cases.length });

      if (isModuleExpanded(module.id)) {
        cases.forEach((testCase) => entries.push({ kind: "case", testCase, module }));
      }
    });

    if (moduleCaseGroups.unassignedCases.length || (!isCatalogFiltered && testCasesQuery.hasNextPage)) {
      entries.push({ kind: "unassigned", count: moduleCaseGroups.unassignedCases.length });
      if (isUnassignedModuleExpanded) {
        moduleCaseGroups.unassignedCases.forEach((testCase) => entries.push({ kind: "case", testCase }));
      }
    }

	    return entries;
	  }, [expandedModuleIds, collapsedFilteredModuleIds, isCatalogFiltered, workflowReviewScope, isReviewQueueOpen, filteredCases, isUnassignedModuleExpanded, moduleCaseGroups.unassignedCases, testCasesQuery.hasNextPage, visibleModuleCaseGroups]);

const visibleModuleTileEntries = useMemo(
    () => moduleTileEntries.slice(0, visibleTestCaseCount),
    [moduleTileEntries, visibleTestCaseCount]
  );

const isUnassignedModuleTileVisible = visibleModuleTileEntries.some((entry) => entry.kind === "unassigned");

const visibleTileCaseCount = visibleModuleTileEntries.filter((entry) => entry.kind === "case").length;

const totalTileCaseCount = moduleTileEntries.filter((entry) => entry.kind === "case").length;

const hasMoreVisibleTestCases = catalogViewMode === "tile"
    && visibleModuleTileEntries.length < moduleTileEntries.length;

useEffect(() => {
    setVisibleTestCaseCount(TEST_CASE_RENDER_BATCH_SIZE);
  }, [appTypeId, casePriorityFilter, caseRunFilter, caseStatusFilter, caseStepFilter, catalogViewMode, deferredSearchTerm]);

const activeCaseFilterCount =
    Number(caseStatusFilter !== "all") +
    Number(casePriorityFilter !== "all") +
    Number(caseStepFilter !== "all") +
    Number(caseRunFilter !== "all");

const hasIncompleteCaseFilterScope = hasActiveCaseCatalogFilter && testCasesQuery.isFetching && !testCasesQuery.isFetchingNextPage;

const selectableFilteredCases = useMemo(
    () => filteredCases,
    [filteredCases]
  );

const selectableModuleIds = useMemo(
    () => visibleModuleCaseGroups.map(({ module }) => module.id),
    [visibleModuleCaseGroups]
  );

const unassignedCaseIds = useMemo(
    () => moduleCaseGroups.unassignedCases.map((testCase) => testCase.id),
    [moduleCaseGroups.unassignedCases]
  );

const areAllFilteredCasesSelected =
    (selectableFilteredCases.length > 0 || selectableModuleIds.length > 0)
    && selectableFilteredCases.every((item) => selectedActionTestCaseIds.includes(item.id))
    && selectableModuleIds.every((moduleId) => selectedModuleIds.includes(moduleId));

const areAllUnassignedCasesSelected =
    unassignedCaseIds.length > 0 && unassignedCaseIds.every((id) => selectedActionTestCaseIds.includes(id));

const setTestCaseIdsSelected = (caseIds: string[], checked: boolean) => {
    const uniqueIds = [...new Set(caseIds)];
    setSelectedActionTestCaseIds((current) => checked
      ? [...new Set([...current, ...uniqueIds])]
      : current.filter((id) => !uniqueIds.includes(id)));
  };

const setAllFilteredTestCaseItemsSelected = (checked: boolean) => {
    const caseIds = selectableFilteredCases.map((testCase) => testCase.id);
    setTestCaseIdsSelected(caseIds, checked);
    setSelectedModuleIds((current) => checked
      ? [...new Set([...current, ...selectableModuleIds])]
      : current.filter((id) => !selectableModuleIds.includes(id)));
  };

const setModuleSelected = (moduleId: string, checked: boolean) => {
    setSelectedModuleIds((current) => checked
      ? [...new Set([...current, moduleId])]
      : current.filter((id) => id !== moduleId));
  };

const setUnassignedTestCasesSelected = (checked: boolean) => {
    setTestCaseIdsSelected(unassignedCaseIds, checked);
  };

return { historyByCaseId, sharedGroupNameById, stepCountByCaseId, requirementTitleById, requirementDisplayIdById, caseStatusOptions, casePriorityOptions, existingCaseLabels, existingSuiteLabels, caseModuleById, modulePickerTestCases, modulePickerRequirements, moduleNameByPickerCaseId, filteredCases, hasActiveCaseCatalogFilter, moduleCaseGroups, visibleModuleCaseGroups, moduleHealth, healthModule, moduleHealthMetrics, renderModuleMetrics, renderDeferredModuleMetrics, hasCompleteModuleMetrics, renderModuleLoadMoreFooter, moduleTileEntries, visibleModuleTileEntries, isUnassignedModuleTileVisible, visibleTileCaseCount, totalTileCaseCount, hasMoreVisibleTestCases, activeCaseFilterCount, hasIncompleteCaseFilterScope, selectableFilteredCases, selectableModuleIds, unassignedCaseIds, areAllFilteredCasesSelected, areAllUnassignedCasesSelected, setTestCaseIdsSelected, setAllFilteredTestCaseItemsSelected, setModuleSelected, setUnassignedTestCasesSelected };
}
