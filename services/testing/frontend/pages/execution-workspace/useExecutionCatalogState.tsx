import { useDeferredValue, useEffect, useRef, useState } from "react";
import { readDefaultCatalogViewMode } from "@hellotest/platform/frontend/src/shared/lib/viewPreferences";
import { type ExecutionStatus } from "@hellotest/platform/frontend/src/types";
import { ExecutionIssueFilter, ExecutionEvidenceFilter, TestRunsView, CatalogViewMode, DEFAULT_CATALOG_VIEW_MODE_BY_RUN_VIEW, DEFAULT_RUN_LIBRARY_SEARCH_BY_VIEW } from "./executionWorkspaceModel";

export interface ExecutionCatalogStateOptions { projectId: string; appTypeId: string; testRunsView: TestRunsView; }
export function useExecutionCatalogState({ projectId, appTypeId, testRunsView }: ExecutionCatalogStateOptions) {
const [runLibrarySearchByView, setRunLibrarySearchByView] = useState<Record<TestRunsView, string>>(DEFAULT_RUN_LIBRARY_SEARCH_BY_VIEW);

const [catalogViewModeByView, setCatalogViewModeByView] = useState<Record<TestRunsView, CatalogViewMode>>(() => {
    const preferredCatalogViewMode = readDefaultCatalogViewMode();

    return Object.fromEntries(
      Object.keys(DEFAULT_CATALOG_VIEW_MODE_BY_RUN_VIEW).map((key) => [key, preferredCatalogViewMode])
    ) as Record<TestRunsView, CatalogViewMode>;
  });

const [selectedActionExecutionIds, setSelectedActionExecutionIds] = useState<string[]>([]);

const [selectedActionScheduleIds, setSelectedActionScheduleIds] = useState<string[]>([]);

const [selectedActionOperationIds, setSelectedActionOperationIds] = useState<string[]>([]);

const [executionStatusFilter, setExecutionStatusFilter] = useState<ExecutionStatus | "all">("all");

const [executionIssueFilter, setExecutionIssueFilter] = useState<ExecutionIssueFilter>("all");

const [executionEvidenceFilter, setExecutionEvidenceFilter] = useState<ExecutionEvidenceFilter>("all");

const [executionListItemHeight, setExecutionListItemHeight] = useState(236);

const executionCardMeasureRef = useRef<HTMLDivElement | null>(null);

const executionSearch = runLibrarySearchByView[testRunsView];

const catalogViewMode = catalogViewModeByView[testRunsView];

const deferredExecutionSearch = useDeferredValue(executionSearch);

const runLibraryTitle =
    testRunsView === "suite-runs"
        ? "Runs"
        : testRunsView === "local-runs"
          ? "Runs"
        : testRunsView === "scheduled-runs"
          ? "Test Plans"
          : "Batch process";

const runLibrarySubtitle =
    testRunsView === "suite-runs"
        ? "Review suite, local and schedule-triggered runs and their results."
        : testRunsView === "local-runs"
          ? "Review suite, local and schedule-triggered runs and their results."
        : testRunsView === "scheduled-runs"
          ? "Plan recurring checks and launch them when the team is ready."
          : "Track imports, exports, AI generation, and other long-running background work in one place.";

const runLibrarySearchPlaceholder =
    testRunsView === "scheduled-runs"
      ? "Search test plans"
      : testRunsView === "batch-process"
        ? "Search batch process records"
        : "Search runs";

const runLibrarySearchTitle =
    testRunsView === "scheduled-runs"
      ? "Filter scheduled runs"
      : testRunsView === "batch-process"
        ? "Filter batch process records"
        : "Filter runs";

const runLibrarySearchSubtitle =
    testRunsView === "scheduled-runs"
      ? "Filter scheduled runs by cadence, timing, or scope context."
      : testRunsView === "batch-process"
        ? "Search titles, providers, repositories, or generated artifact details."
        : "Filter run tiles by the status and facts shown on each card.";

const handleCatalogViewModeChange = (nextValue: CatalogViewMode) => {
    setCatalogViewModeByView((current) =>
      current[testRunsView] === nextValue
        ? current
        : {
            ...current,
            [testRunsView]: nextValue
          }
    );
  };

const handleRunLibrarySearchChange = (nextValue: string) => {
    setRunLibrarySearchByView((current) =>
      current[testRunsView] === nextValue
        ? current
        : {
            ...current,
            [testRunsView]: nextValue
        }
    );
  };
  useEffect(() => { setSelectedActionExecutionIds([]); }, [projectId, appTypeId, testRunsView]);
  return { runLibrarySearchByView, setRunLibrarySearchByView, catalogViewModeByView, setCatalogViewModeByView, selectedActionExecutionIds, setSelectedActionExecutionIds, selectedActionScheduleIds, setSelectedActionScheduleIds, selectedActionOperationIds, setSelectedActionOperationIds, executionStatusFilter, setExecutionStatusFilter, executionIssueFilter, setExecutionIssueFilter, executionEvidenceFilter, setExecutionEvidenceFilter, executionListItemHeight, setExecutionListItemHeight, executionCardMeasureRef, executionSearch, catalogViewMode, deferredExecutionSearch, runLibraryTitle, runLibrarySubtitle, runLibrarySearchPlaceholder, runLibrarySearchTitle, runLibrarySearchSubtitle, handleCatalogViewModeChange, handleRunLibrarySearchChange };
}

