import type { useCaseLibrary } from './useCaseLibrary';
import type { SetURLSearchParams } from 'react-router-dom';
import type { UseQueryResult } from '@tanstack/react-query';
import type { SessionPayload } from '@hellotest/platform/frontend/src/types';
import type { WorkflowReviewScope } from '../../lib/workflowReviewScope';

import { TEST_CASE_RENDER_BATCH_SIZE, getTestCaseWorkflowStatus, formatTestCaseWorkflowStatus, calculateTestCaseAiQualityScore } from "./testCaseWorkspaceUtils";
import { TestCaseImportIcon, TestCaseExportIcon, TestCaseSparkIcon, TestCaseCreateIcon, TestCaseSplitActionButton, TestCaseRunIcon, ModuleChevronIcon, ModulePencilIcon, TestCaseAcceptIcon, TestCaseRejectIcon } from "./CaseLibraryActions";
import { type ExecutionStartMode, type TestCaseDeliveryContext, type CaseStepFilter, type CaseRunFilter } from "./testCaseWorkspaceTypes";
import { CaseLibraryCard } from "./../../components/CaseLibraryCard";
import { caseExecutionGuidance } from "./../../lib/caseLibrarySignals";
import { type SuiteTransferAction } from "./../../components/TestCaseSuiteTransferModal";
import { Fragment, type DragEvent as ReactDragEvent } from "react";
import { isPendingCaseReview } from "./../../lib/testCaseReview";
import { AddIcon, CopyIcon, ExportIcon, FolderAddIcon, FolderOffIcon, ModuleIcon, MoveIcon, OpenIcon, SelectionToggleIcon, TrashIcon } from "@hellotest/platform/frontend/src/platform/components/AppIcons";
import { CatalogSelectionControls } from "@hellotest/platform/frontend/src/shared/components/CatalogSelectionControls";
import { CatalogViewToggle } from "@hellotest/platform/frontend/src/shared/components/CatalogViewToggle";
import { CatalogSearchFilter } from "@hellotest/platform/frontend/src/shared/components/CatalogSearchFilter";
import { DataTable, type DataTableColumn } from "@hellotest/platform/frontend/src/shared/components/DataTable";
import { HierarchyAutoLoadSentinel } from "./../../components/HierarchyLoadMoreButton";
import { InlineLoadingState } from "@hellotest/platform/frontend/src/shared/components/LoadingSkeleton";
import { Panel } from "@hellotest/platform/frontend/src/shared/components/Panel";
import { EntityHealthButton } from "@hellotest/manual/frontend/components/EntityHealthDialog";
import { TileCardSuiteIcon } from "@hellotest/platform/frontend/src/shared/components/TileCardPrimitives";
import { TileBrowserPane } from "@hellotest/platform/frontend/src/shared/components/TileBrowserPane";
import { TileCardSkeletonGrid } from "@hellotest/platform/frontend/src/shared/components/TileCardSkeletonGrid";
import { type PreparedTestCaseImportBatch, type TestCaseImportSourceSelection } from "./../../lib/testCaseSourceImport";
import { deriveModuleHealth } from "./../../lib/hierarchyHealth";
import type { ExecutionResult, TestCase, TestCaseModule } from "@hellotest/platform/frontend/src/types";

export interface CaseLibraryViewInputs {
  setSearchParams: SetURLSearchParams;
  workflowReviewScope: WorkflowReviewScope | null;
  session: SessionPayload | null;
  projectId: string;
  appTypeId: string;
  canCreateTestCases: boolean;
  canImportTestCases: boolean;
  canUpdateTestCases: boolean;
  canDeleteTestCases: boolean;
  canExportTestCases: boolean;
  canUseTestCaseAi: boolean;
  canCreateSuites: boolean;
  canUpdateSuites: boolean;
  canCreateRuns: boolean;
  canUseAutomationWorkspace: boolean;
  reviewScopeKey: string;
  setReviewQueueScope: React.Dispatch<React.SetStateAction<string>>;
  isReviewQueueOpen: boolean;
  reviewingCaseIds: string[];
  isBulkReviewRunning: boolean;
  setIsBulkReviewRejectOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setBulkReviewError: React.Dispatch<React.SetStateAction<string>>;
  selectedTestCaseId: string;
  searchTerm: string;
  setSearchTerm: React.Dispatch<React.SetStateAction<string>>;
  catalogViewMode: "tile" | "list";
  setCatalogViewMode: React.Dispatch<React.SetStateAction<"tile" | "list">>;
  isCatalogViewPending: boolean;
  startCatalogViewTransition: React.TransitionStartFunction;
  visibleTestCaseCount: number;
  setVisibleTestCaseCount: React.Dispatch<React.SetStateAction<number>>;
  caseStatusFilter: string;
  setCaseStatusFilter: React.Dispatch<React.SetStateAction<string>>;
  casePriorityFilter: string;
  setCasePriorityFilter: React.Dispatch<React.SetStateAction<string>>;
  caseStepFilter: CaseStepFilter;
  setCaseStepFilter: React.Dispatch<React.SetStateAction<CaseStepFilter>>;
  caseRunFilter: CaseRunFilter;
  setCaseRunFilter: React.Dispatch<React.SetStateAction<CaseRunFilter>>;
  selectedActionTestCaseIds: string[];
  setSelectedActionTestCaseIds: React.Dispatch<React.SetStateAction<string[]>>;
  setExpandedModuleIds: React.Dispatch<React.SetStateAction<string[]>>;
  isUnassignedModuleExpanded: boolean;
  setIsUnassignedModuleExpanded: React.Dispatch<React.SetStateAction<boolean>>;
  setModulePageCursorsById: React.Dispatch<React.SetStateAction<Record<string, (string | null)[]>>>;
  selectedModuleIds: string[];
  setSelectedModuleIds: React.Dispatch<React.SetStateAction<string[]>>;
  libraryScope: "manual" | "automation" | "both";
  setLibraryScope: React.Dispatch<React.SetStateAction<"manual" | "automation" | "both">>;
  catalogFilterKey: string;
  isCatalogFiltered: boolean;
  isModuleExpanded: (moduleId: string) => boolean;
  testCaseMetricsQuery: ReturnType<typeof useCaseLibrary>["testCaseMetricsQuery"];
  testCasesQuery: ReturnType<typeof useCaseLibrary>["testCasesQuery"];
  modulePageStateById: Record<string, { loaded: number; total: number; nextCursor: string | null; isInitialLoading: boolean; isLoadingMore: boolean; failedPageIndex: number | null; }>;
  retryModulePage: (moduleId: string, pageIndex: number) => void;
  toggleModuleExpansion: (moduleId: string) => void;
  testCaseModules: TestCaseModule[];
  isCreating: boolean;
  isDeletingSelectedTestCases: boolean;
  setIsCreateSuiteModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setIsCreateModuleModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setModuleDraftInitialCaseIds: React.Dispatch<React.SetStateAction<string[]>>;
  setModuleAssignmentRetry: React.Dispatch<React.SetStateAction<{ id: string; name: string; } | null>>;
  setHealthModuleId: React.Dispatch<React.SetStateAction<string | null>>;
  deletingModuleId: string;
  renamingModuleId: string;
  setRenamingModuleId: React.Dispatch<React.SetStateAction<string>>;
  renamingModuleName: string;
  setRenamingModuleName: React.Dispatch<React.SetStateAction<string>>;
  draggingCaseIds: string[];
  setDraggingCaseIds: React.Dispatch<React.SetStateAction<string[]>>;
  defaultTestCaseStatus: string;
  setIsImportModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setImportBatches: React.Dispatch<React.SetStateAction<PreparedTestCaseImportBatch[]>>;
  setImportFileWarnings: React.Dispatch<React.SetStateAction<string[]>>;
  setImportSourceSelection: React.Dispatch<React.SetStateAction<TestCaseImportSourceSelection>>;
  schedulerActionCaseId: string;
  schedulerActionKind: "" | "run" | "run-local" | "run-remote";
  reviewSummaryQuery: UseQueryResult<{ pending: number; overall_pending: number; }, Error>;
  pendingReviewCount: number;
  createTestCase: { isPending: boolean };
  assignCasesToModule: { isPending: boolean };
  deleteTestCase: { isPending: boolean };
  testCases: TestCase[];
  beginCreateCase: (suiteContextId?: string, requirementId?: string, deliveryContext?: TestCaseDeliveryContext, moduleId?: string) => void;
  historyByCaseId: Record<string, ExecutionResult[]>;
  stepCountByCaseId: Record<string, number | undefined>;
  requirementTitleById: Record<string, string>;
  requirementDisplayIdById: Record<string, string>;
  caseStatusOptions: { value: string; label: string; }[];
  casePriorityOptions: string[];
  caseModuleById: Map<string, TestCaseModule>;
  filteredCases: TestCase[];
  hasActiveCaseCatalogFilter: boolean;
  moduleCaseGroups: { groups: { module: TestCaseModule; cases: TestCase[]; }[]; unassignedCases: TestCase[]; };
  visibleModuleCaseGroups: { module: TestCaseModule; cases: TestCase[]; }[];
  moduleHealth: { byId: Map<string, ReturnType<typeof deriveModuleHealth>>; unassigned: ReturnType<typeof deriveModuleHealth> };
  renderModuleMetrics: (health: ReturnType<typeof deriveModuleHealth>) => JSX.Element;
  renderDeferredModuleMetrics: (count?: number) => JSX.Element;
  hasCompleteModuleMetrics: (_moduleId: string) => boolean;
  renderModuleLoadMoreFooter: (moduleId: string, moduleName: string) => JSX.Element | null;
  moduleTileEntries: { kind: "case"; testCase: TestCase; }[] | ({ kind: "module"; module: TestCaseModule; count: number; } | { kind: "unassigned"; count: number; } | { kind: "case"; testCase: TestCase; module?: TestCaseModule; })[];
  visibleModuleTileEntries: { kind: "case"; testCase: TestCase; }[] | ({ kind: "module"; module: TestCaseModule; count: number; } | { kind: "unassigned"; count: number; } | { kind: "case"; testCase: TestCase; module?: TestCaseModule; })[];
  isUnassignedModuleTileVisible: boolean;
  visibleTileCaseCount: number;
  totalTileCaseCount: number;
  hasMoreVisibleTestCases: boolean;
  activeCaseFilterCount: number;
  hasIncompleteCaseFilterScope: boolean;
  selectableFilteredCases: TestCase[];
  selectableModuleIds: string[];
  unassignedCaseIds: string[];
  areAllFilteredCasesSelected: boolean;
  areAllUnassignedCasesSelected: boolean;
  setTestCaseIdsSelected: (caseIds: string[], checked: boolean) => void;
  setAllFilteredTestCaseItemsSelected: (checked: boolean) => void;
  setModuleSelected: (moduleId: string, checked: boolean) => void;
  setUnassignedTestCasesSelected: (checked: boolean) => void;
  testCaseApiOnlyState: (testCaseId: string) => boolean | undefined;
  openRunBuilder: (testCaseIds: string[], mode?: ExecutionStartMode) => void;
  startDraggingTestCases: (testCaseId: string, dataTransfer?: DataTransfer) => string[];
  moveTestCasesToModule: (moduleId: string, candidateIds: string[]) => Promise<void>;
  handleDropCaseOnModule: (moduleId: string, event: ReactDragEvent<HTMLDivElement>) => void;
  getTestCaseDropState: (module: TestCaseModule) => { canAcceptDrop: boolean; dropLabel: string; };
  handleRenameModule: (moduleId: string) => Promise<void>;
  handleDeleteModule: (module: TestCaseModule) => Promise<void>;
  handleDeleteSelectedTestCaseItems: () => Promise<void>;
  selectedReviewCases: TestCase[];
  handleBulkReview: (status: "accepted" | "changes_requested") => Promise<void>;
  openSuiteTransferModal: (testCaseIds: string[], action?: SuiteTransferAction) => void;
  exportCasesToCsv: (testCasesToExport: TestCase[], options?: { fileLabel?: string; successMessage?: string; }) => Promise<void>;
  handleCloneCase: (testCase: TestCase, requestedStartUrl?: string) => Promise<void>;
  handleDeleteCaseItem: (testCase: TestCase) => Promise<void>;
  openAiStudio: () => void;
  isLibraryLoading: boolean;
  closeCaseWorkspace: () => void;
  openLibraryCase: (testCaseId: string) => void;
  openLatestFailureRun: (testCaseId: string) => Promise<void>;
  renderReviewDecision: (testCase: TestCase, iconOnly?: boolean) => string | JSX.Element | null;
  testCaseListColumns: DataTableColumn<TestCase>[];
  renderTestCaseRowActions: (testCase: TestCase) => JSX.Element;
  testCaseListRowGroups: { key: string; isCollapsed: boolean; rows: TestCase[]; header: JSX.Element; content: JSX.Element | null; footer: JSX.Element | null; }[];
}

export function CaseLibraryView({ setSearchParams, workflowReviewScope, session, projectId, appTypeId, canCreateTestCases, canImportTestCases, canUpdateTestCases, canDeleteTestCases, canExportTestCases, canUseTestCaseAi, canCreateSuites, canUpdateSuites, canCreateRuns, canUseAutomationWorkspace, reviewScopeKey, setReviewQueueScope, isReviewQueueOpen, reviewingCaseIds, isBulkReviewRunning, setIsBulkReviewRejectOpen, setBulkReviewError, selectedTestCaseId, searchTerm, setSearchTerm, catalogViewMode, setCatalogViewMode, isCatalogViewPending, startCatalogViewTransition, visibleTestCaseCount, setVisibleTestCaseCount, caseStatusFilter, setCaseStatusFilter, casePriorityFilter, setCasePriorityFilter, caseStepFilter, setCaseStepFilter, caseRunFilter, setCaseRunFilter, selectedActionTestCaseIds, setSelectedActionTestCaseIds, setExpandedModuleIds, isUnassignedModuleExpanded, setIsUnassignedModuleExpanded, setModulePageCursorsById, selectedModuleIds, setSelectedModuleIds, libraryScope, setLibraryScope, catalogFilterKey, isCatalogFiltered, isModuleExpanded, testCaseMetricsQuery, testCasesQuery, modulePageStateById, retryModulePage, toggleModuleExpansion, testCaseModules, isCreating, isDeletingSelectedTestCases, setIsCreateSuiteModalOpen, setIsCreateModuleModalOpen, setModuleDraftInitialCaseIds, setModuleAssignmentRetry, setHealthModuleId, deletingModuleId, renamingModuleId, setRenamingModuleId, renamingModuleName, setRenamingModuleName, draggingCaseIds, setDraggingCaseIds, defaultTestCaseStatus, setIsImportModalOpen, setImportBatches, setImportFileWarnings, setImportSourceSelection, schedulerActionCaseId, schedulerActionKind, reviewSummaryQuery, pendingReviewCount, createTestCase, assignCasesToModule, deleteTestCase, testCases, beginCreateCase, historyByCaseId, stepCountByCaseId, requirementTitleById, requirementDisplayIdById, caseStatusOptions, casePriorityOptions, caseModuleById, filteredCases, hasActiveCaseCatalogFilter, moduleCaseGroups, visibleModuleCaseGroups, moduleHealth, renderModuleMetrics, renderDeferredModuleMetrics, hasCompleteModuleMetrics, renderModuleLoadMoreFooter, moduleTileEntries, visibleModuleTileEntries, isUnassignedModuleTileVisible, visibleTileCaseCount, totalTileCaseCount, hasMoreVisibleTestCases, activeCaseFilterCount, hasIncompleteCaseFilterScope, selectableFilteredCases, selectableModuleIds, unassignedCaseIds, areAllFilteredCasesSelected, areAllUnassignedCasesSelected, setTestCaseIdsSelected, setAllFilteredTestCaseItemsSelected, setModuleSelected, setUnassignedTestCasesSelected, testCaseApiOnlyState, openRunBuilder, startDraggingTestCases, moveTestCasesToModule, handleDropCaseOnModule, getTestCaseDropState, handleRenameModule, handleDeleteModule, handleDeleteSelectedTestCaseItems, selectedReviewCases, handleBulkReview, openSuiteTransferModal, exportCasesToCsv, handleCloneCase, handleDeleteCaseItem, openAiStudio, isLibraryLoading, closeCaseWorkspace, openLibraryCase, openLatestFailureRun, renderReviewDecision, testCaseListColumns, renderTestCaseRowActions, testCaseListRowGroups }: CaseLibraryViewInputs) {
  return ((
          <Panel title="Test Cases" titleVariant="eyebrow" subtitle={appTypeId ? undefined : "Choose an app type to begin."}>
            <div className="design-list-toolbar catalog-command-toolbar test-case-catalog-toolbar">
              <div className="catalog-toolbar-discovery" aria-label="Test case views, search, and selection">
                <div aria-busy={isCatalogViewPending}><CatalogViewToggle onChange={(value) => startCatalogViewTransition(() => setCatalogViewMode(value))} value={catalogViewMode} /></div>
                {!isReviewQueueOpen ? <CatalogSearchFilter
                activeFilterCount={activeCaseFilterCount}
                ariaLabel="Search test cases"
                onChange={setSearchTerm}
                placeholder="Search title, description, or story"
                subtitle="Filter the case tiles by the status and facts shown on each card."
                title="Filter test cases"
                value={searchTerm}
              >
                <div className="catalog-filter-grid">
                  <label className="catalog-filter-field">
                    <span>Status</span>
                    <select value={caseStatusFilter} onChange={(event) => setCaseStatusFilter(event.target.value)}>
                      <option value="all">All statuses</option>
                      {caseStatusOptions.map((status) => (
                        <option key={status.value} value={status.value}>
                          {status.label}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="catalog-filter-field">
                    <span>Priority</span>
                    <select value={casePriorityFilter} onChange={(event) => setCasePriorityFilter(event.target.value)}>
                      <option value="all">All priorities</option>
                      {casePriorityOptions.map((priority) => (
                        <option key={priority} value={priority}>
                          {`P${priority}`}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="catalog-filter-field">
                    <span>Steps</span>
                    <select value={caseStepFilter} onChange={(event) => setCaseStepFilter(event.target.value as CaseStepFilter)}>
                      <option value="all">All cases</option>
                      <option value="with-steps">With steps</option>
                      <option value="no-steps">Without steps</option>
                    </select>
                  </label>

                  <label className="catalog-filter-field">
                    <span>Recent runs</span>
                    <select value={caseRunFilter} onChange={(event) => setCaseRunFilter(event.target.value as CaseRunFilter)}>
                      <option value="all">All cases</option>
                      <option value="with-runs">With recent runs</option>
                      <option value="no-runs">No recent runs</option>
                    </select>
                  </label>

                  <div className="catalog-filter-actions">
                    <button
                      className="ghost-button"
                      disabled={!activeCaseFilterCount}
                      onClick={() => {
                        setCaseStatusFilter("all");
                        setCasePriorityFilter("all");
                        setCaseStepFilter("all");
                        setCaseRunFilter("all");
                      }}
                      type="button"
                    >
                      <SelectionToggleIcon checked={false} />
                      Clear filters
                    </button>
                  </div>
                </div>
                </CatalogSearchFilter> : null}
                <CatalogSelectionControls
                  allSelected={areAllFilteredCasesSelected}
                  canSelectAll={Boolean(selectableFilteredCases.length || selectableModuleIds.length)}
                  onClear={() => {
                    setSelectedActionTestCaseIds([]);
                    setSelectedModuleIds([]);
                  }}
                  onSelectAll={() => setAllFilteredTestCaseItemsSelected(true)}
                  selectedCount={selectedActionTestCaseIds.length + selectedModuleIds.length}
                />
              </div>
              <div className="catalog-toolbar-actions" aria-label="Test case actions">
              <label>Catalog scope <select aria-label="Catalog scope" value={libraryScope} onChange={event => { setLibraryScope(event.target.value as typeof libraryScope); setSelectedActionTestCaseIds([]); }}><option value="manual">Manual cases</option><option value="automation">Automation cases</option><option value="both">Manual and automation</option></select></label>
              <label className="catalog-hierarchy-move-control">
                  <span className="sr-only">Move selected test cases to module</span>
                  <select
                    aria-label={`Move ${selectedActionTestCaseIds.length} selected test case${selectedActionTestCaseIds.length === 1 ? "" : "s"} to module`}
                    className="compact-select catalog-hierarchy-move-select"
                    disabled={!selectedActionTestCaseIds.length || !testCaseModules.length || !canUpdateTestCases || assignCasesToModule.isPending || isDeletingSelectedTestCases}
                    onChange={(event) => {
                      if (event.target.value) {
                        void moveTestCasesToModule(event.target.value, selectedActionTestCaseIds);
                      }
                    }}
                    value=""
                  >
                    <option value="">{testCaseModules.length ? "Move selected to module…" : "No modules available"}</option>
                    {testCaseModules.map((module) => {
                      const movableCount = selectedActionTestCaseIds.filter((id) => caseModuleById.get(id)?.id !== module.id).length;
                      return (
                        <option disabled={!movableCount} key={module.id} value={module.id}>
                          {module.name}{movableCount ? "" : " · already assigned"}
                        </option>
                      );
                    })}
                  </select>
              </label>
              <TestCaseSplitActionButton
                className="test-case-toolbar-secondary-action test-case-create-module-action"
                visible={canCreateTestCases} disabled={!canCreateTestCases || !appTypeId}
                icon={<FolderAddIcon />}
                iconOnly={false}
                label="Create Module"
                menuLabel="Open create module options"
                onClick={() => {
                  setModuleAssignmentRetry(null);
                  setModuleDraftInitialCaseIds(canUpdateTestCases ? selectedActionTestCaseIds : []);
                  setIsCreateModuleModalOpen(true);
                }}
                actions={selectedActionTestCaseIds.length ? [{
                  label: "Create empty module",
                  description: "Create a module without moving the currently selected test cases.",
                  icon: <FolderAddIcon />,
                  visible: canCreateTestCases,
                    disabled: !canCreateTestCases || !appTypeId,
                  onClick: () => {
                    setModuleAssignmentRetry(null);
                    setModuleDraftInitialCaseIds([]);
                    setIsCreateModuleModalOpen(true);
                  }
                }] : []}
              />
              <>
                  <TestCaseSplitActionButton
                    visible={canCreateRuns} disabled={!selectedActionTestCaseIds.length || !canCreateRuns || !projectId || !appTypeId || !session?.user.id}
                    icon={<TestCaseRunIcon />}
                    label="Run manually"
                    menuLabel="Open selected test case run options"
                    tone="green"
                    onClick={() => openRunBuilder(selectedActionTestCaseIds)}
                    actions={[]}
                  />
              </>
              <TestCaseSplitActionButton
                visible={canCreateTestCases} disabled={!canCreateTestCases || !appTypeId}
                icon={<TestCaseCreateIcon />}
                label="Create Test Case"
                menuLabel="Open create test case options"
                onClick={() => beginCreateCase()}
                actions={[
                  {
                    label: "Bulk Import",
                    description: "Import test cases from CSV, XML, JSON, or supported source exports.",
                    icon: <TestCaseImportIcon />,
                    visible: canImportTestCases,
                    disabled: !canImportTestCases || !appTypeId,
                    onClick: () => {
                      setImportBatches([]);
                      setImportFileWarnings([]);
                      setImportSourceSelection("auto");
                      setIsImportModalOpen(true);
                    }
                  },
                  {
                    label: "AI Test Cases Generation",
                    description: "Generate draft test cases from your instructions and optional Story context.",
                    icon: <TestCaseSparkIcon />,
                    visible: canUseTestCaseAi && canCreateTestCases,
                    disabled: !canUseTestCaseAi || !canCreateTestCases || !appTypeId,
                    onClick: openAiStudio
                  }
                ]}
              />
              <TestCaseSplitActionButton
                className="test-case-toolbar-secondary-action"
                visible={canCreateSuites} disabled={!canCreateSuites || !appTypeId}
                icon={<TileCardSuiteIcon />}
                label="Create Suite"
                menuLabel="Open suite actions"
                onClick={() => setIsCreateSuiteModalOpen(true)}
                actions={[
                  {
                    label: `Add to suite${selectedActionTestCaseIds.length ? ` (${selectedActionTestCaseIds.length})` : ""}`,
                    description: "Attach selected cases to one or more existing suites without removing current links.",
                    icon: <AddIcon />,
                    visible: canUpdateSuites,
                    disabled: !canUpdateSuites || !selectedActionTestCaseIds.length || !appTypeId,
                    onClick: () => openSuiteTransferModal(selectedActionTestCaseIds, "add")
                  },
                  {
                    label: `Move to suite${selectedActionTestCaseIds.length ? ` (${selectedActionTestCaseIds.length})` : ""}`,
                    description: "Replace selected cases' suite links with the chosen suite scope.",
                    icon: <MoveIcon />,
                    visible: canUpdateSuites,
                    disabled: !canUpdateSuites || !selectedActionTestCaseIds.length || !appTypeId,
                    onClick: () => openSuiteTransferModal(selectedActionTestCaseIds, "move")
                  },
                  {
                    label: `Copy to suite/project${selectedActionTestCaseIds.length ? ` (${selectedActionTestCaseIds.length})` : ""}`,
                    description: "Duplicate selected cases and steps into another suite, app type, or project.",
                    icon: <CopyIcon />,
                    visible: canCreateTestCases,
                    disabled: !selectedActionTestCaseIds.length || !appTypeId,
                    onClick: () => openSuiteTransferModal(selectedActionTestCaseIds, "copy")
                  }
                ]}
              />
              {isReviewQueueOpen && (selectedReviewCases.length > 0 || isBulkReviewRunning) ? (
                <>
                  <button className="ghost-button catalog-selection-button test-case-review-approve" type="button" disabled={isBulkReviewRunning || !selectedReviewCases.length}
                    onClick={() => void handleBulkReview("accepted")}><TestCaseAcceptIcon /><span>Approve ({selectedReviewCases.length})</span></button>
                  <button className="ghost-button catalog-selection-button danger test-case-review-reject" type="button" disabled={isBulkReviewRunning || !selectedReviewCases.length}
                    onClick={() => { setBulkReviewError(""); setIsBulkReviewRejectOpen(true); }}><TestCaseRejectIcon /><span>Reject ({selectedReviewCases.length})</span></button>
                </>
              ) : (
              (canUpdateTestCases ? (<button className="ghost-button catalog-selection-button" type="button"
                disabled={!canUpdateTestCases || pendingReviewCount < 1 || reviewSummaryQuery.isError}
                onClick={() => {
                  setSearchTerm(""); setCaseStatusFilter("all"); setCasePriorityFilter("all"); setCaseStepFilter("all"); setCaseRunFilter("all");
                  setSelectedActionTestCaseIds([]); setSelectedModuleIds([]); setExpandedModuleIds([]); setModulePageCursorsById({});
                  setVisibleTestCaseCount(TEST_CASE_RENDER_BATCH_SIZE);
                  closeCaseWorkspace(); setReviewQueueScope(reviewScopeKey);
                }}
                title={pendingReviewCount ? `${pendingReviewCount} pending reviews assigned to you` : "No pending reviews assigned to you"}>
                <TestCaseAcceptIcon /><span>Review Cases</span>
                {pendingReviewCount > 0 ? <span className="test-case-review-count">{pendingReviewCount}</span> : null}
              </button>) : null)
              )}
              {canExportTestCases ? (<button
                className="ghost-button catalog-selection-button"
                disabled={!selectedActionTestCaseIds.length || !canExportTestCases}
                onClick={() => void exportCasesToCsv(
                  filteredCases.filter((testCase) => selectedActionTestCaseIds.includes(testCase.id)),
                  { fileLabel: "selected-test-cases" }
                )}
                title={selectedActionTestCaseIds.length ? "Export selected test cases and their authored detail" : "Select test cases to export"}
                type="button"
              >
                <TestCaseExportIcon />
                <span>{`Export${selectedActionTestCaseIds.length ? ` (${selectedActionTestCaseIds.length})` : ""}`}</span>
              </button>) : null}
              {canDeleteTestCases ? (<button
                  className="ghost-button danger catalog-selection-button"
                  disabled={(!selectedActionTestCaseIds.length && !selectedModuleIds.length) || isDeletingSelectedTestCases || Boolean(deletingModuleId) || !canDeleteTestCases}
                  onClick={() => void handleDeleteSelectedTestCaseItems()}
                  type="button"
                >
                  <TrashIcon />
                  <span>
                    {isDeletingSelectedTestCases
                      ? "Deleting"
                      : selectedActionTestCaseIds.length + selectedModuleIds.length
                        ? `Delete (${selectedActionTestCaseIds.length + selectedModuleIds.length})`
                        : "Delete"}
                  </span>
                </button>) : null}
              </div>
            </div>

            {workflowReviewScope ? <div className="test-case-review-queue-banner" role={workflowReviewScope.error ? "alert" : "status"}>
              <div><strong>Workflow Test Case review</strong><span>{workflowReviewScope.error || `${workflowReviewScope.ids.length} generated Test Case${workflowReviewScope.ids.length === 1 ? "" : "s"} · Only these cases are shown. Open a case to review its steps and data.`}</span></div>
              <button className="ghost-button compact" type="button" onClick={() => setSearchParams(previous => { const next = new URLSearchParams(previous); next.delete("review_cases"); return next; }, {replace: true})}>Show all cases</button>
            </div> : null}
            {isReviewQueueOpen ? (
              <div className="test-case-review-queue-banner" role="status">
                <div><strong>My pending reviews</strong><span>{pendingReviewCount} pending · manual and AI-generated cases</span></div>
                <button className="ghost-button compact" type="button" onClick={() => setReviewQueueScope("")}>Back to all cases</button>
              </div>
            ) : null}
            {reviewSummaryQuery.isError && canUpdateTestCases ? (
              <div className="inline-message error-message" role="alert">Pending reviews could not be loaded.
                <button className="ghost-button compact" type="button" onClick={() => void reviewSummaryQuery.refetch()}>Retry reviews</button>
              </div>
            ) : null}
            {hasIncompleteCaseFilterScope ? (
              <div className="hierarchy-filter-scope-note" role="status">
                Updating filtered test cases…
              </div>
            ) : null}

            <div aria-live="polite" className="sr-only">
              {draggingCaseIds.length
                ? `Moving ${draggingCaseIds.length} selected test case${draggingCaseIds.length === 1 ? "" : "s"}. Choose an available module.`
                : ""}
            </div>
            <TileBrowserPane className="test-case-library-scroll" scrollKey={`test-cases:${projectId}:${appTypeId}`}>
              {isLibraryLoading ? <TileCardSkeletonGrid /> : null}
              {testCasesQuery.isFetching && !testCasesQuery.isFetchingNextPage && !isLibraryLoading ? (
                <div className="hierarchy-pagination-status" role="status" aria-live="polite">Updating test cases…</div>
              ) : null}
              {testCasesQuery.isError && !testCasesQuery.data ? (
                <div className="inline-message error-message" role="alert">
                  Test cases could not be loaded.
                  <button className="ghost-button compact" onClick={() => void testCasesQuery.refetch()} type="button">Retry</button>
                </div>
              ) : null}

              {!isLibraryLoading && (filteredCases.length || visibleModuleCaseGroups.length || testCasesQuery.hasNextPage) && catalogViewMode === "tile" ? (
                <div className="tile-browser-grid">
	                  {visibleModuleTileEntries.map((entry, entryIndex) => {
                    if (entry.kind === "module") {
                      const isCollapsed = !isModuleExpanded(entry.module.id);
                      const modulePageState = modulePageStateById[entry.module.id];
                      const isSelected = selectedModuleIds.includes(entry.module.id);
                      const moduleCases = moduleCaseGroups.groups.find(({ module }) => module.id === entry.module.id)?.cases || [];
                      const moduleCaseIds = moduleCases.map((testCase) => testCase.id);
                      const areAllModuleCasesSelected = moduleCaseIds.length > 0
                        && moduleCaseIds.every((id) => selectedActionTestCaseIds.includes(id));
                      const { canAcceptDrop, dropLabel } = getTestCaseDropState(entry.module);

                      return (
                        <Fragment key={`module-${entry.module.id}`}>
                        <div
                          className={[
                            "test-case-module-header entity-health-hierarchy-header",
                            draggingCaseIds.length ? (canAcceptDrop ? "is-drop-ready" : "is-drop-blocked") : ""
                          ].filter(Boolean).join(" ")}
                          data-health-entity="Module"
                          data-drop-label={dropLabel || undefined}
                          onDragOver={(event) => {
                            if (canAcceptDrop) {
                              event.preventDefault();
                              event.dataTransfer.dropEffect = "move";
                            } else {
                              event.dataTransfer.dropEffect = "none";
                            }
                          }}
                          onDrop={canAcceptDrop ? (event) => handleDropCaseOnModule(entry.module.id, event) : undefined}
                          title={dropLabel || undefined}
                        >
                          <label className="checkbox-field">
                            <input
                              aria-label={`Select module ${entry.module.name}`}
                              checked={isSelected}
                              onChange={(event) => setModuleSelected(entry.module.id, event.target.checked)}
                              type="checkbox"
                            />
                          </label>
                          <button
                            aria-expanded={!isCollapsed}
                            aria-label={isCollapsed ? "Expand module" : "Collapse module"}
                            className={isCollapsed ? "ghost-button compact module-toggle-button" : "ghost-button compact module-toggle-button is-expanded"}
                            onClick={() => toggleModuleExpansion(entry.module.id)}
                            type="button"
                          >
                            <ModuleChevronIcon isExpanded={!isCollapsed} />
                          </button>
                          <span className="module-folder-icon">
                            <ModuleIcon size={18} />
                          </span>
                          {renamingModuleId === entry.module.id ? (
                            <input
                              aria-label={`Module name for ${entry.module.name}`}
                              className="module-rename-input"
                              value={renamingModuleName}
                              onChange={(event) => setRenamingModuleName(event.target.value)}
                              onKeyDown={(event) => {
                                if (event.key === "Enter") {
                                  void handleRenameModule(entry.module.id);
                                }
                                if (event.key === "Escape") {
                                  setRenamingModuleId("");
                                  setRenamingModuleName("");
                                }
                              }}
                            />
                          ) : (
                            <strong>{entry.module.name}</strong>
                          )}
                          {!isCollapsed && moduleCaseIds.length ? (
                            <button
                              aria-label={`${areAllModuleCasesSelected ? "Clear selection for" : "Select all loaded test cases in"} ${entry.module.name}`}
                              aria-pressed={areAllModuleCasesSelected}
                              className="ghost-button compact module-case-selection-button"
                              onClick={() => setTestCaseIdsSelected(moduleCaseIds, !areAllModuleCasesSelected)}
                              title={areAllModuleCasesSelected ? "Clear loaded case selection" : "Select all loaded cases"}
                              type="button"
                            >
                              <SelectionToggleIcon checked={!areAllModuleCasesSelected} />
                              <span className="sr-only">{areAllModuleCasesSelected ? "Clear all selected test cases" : "Select all test cases"}</span>
                            </button>
                          ) : null}
                          <div className="action-row">
                            <div className="hierarchy-parent-actions">
                              <button aria-label={`Create test case in ${entry.module.name}`} className="ghost-button compact module-add-case-button" onClick={() => beginCreateCase("", entry.module.requirement_ids?.[0] || "", {}, entry.module.id)} title="Create Test Case" type="button">
                                <AddIcon /><span className="sr-only">Create Test Case</span>
                              </button>
                              {renamingModuleId === entry.module.id ? (
                                <button className="primary-button compact" onClick={() => void handleRenameModule(entry.module.id)} type="button">Save</button>
                              ) : (
                                <button
                                  aria-label={`Rename module ${entry.module.name}`}
                                  className="ghost-button compact module-edit-button"
                                  onClick={() => {
                                    setRenamingModuleId(entry.module.id);
                                    setRenamingModuleName(entry.module.name);
                                  }}
                                  title="Rename module"
                                  type="button"
                                >
                                  <ModulePencilIcon />
                                </button>
                              )}
                              {canDeleteTestCases ? (<button
                                aria-label={`${deletingModuleId === entry.module.id ? "Deleting" : "Delete"} module ${entry.module.name}`}
                                className="ghost-button compact danger module-delete-button"
                                disabled={!isSelected || !canDeleteTestCases || Boolean(deletingModuleId) || isDeletingSelectedTestCases}
                                onClick={() => void handleDeleteModule(entry.module)}
                                title={isSelected ? "Delete module" : "Select the module to enable delete"}
                                type="button"
                              >
                                <TrashIcon />
                              </button>) : null}
                            </div>
                          </div>
                          <div className="entity-health-ribbon">
                            {!hasCompleteModuleMetrics(entry.module.id)
                              ? renderDeferredModuleMetrics(entry.module.test_case_count)
                              : renderModuleMetrics(moduleHealth.byId.get(entry.module.id)!)}
                            <EntityHealthButton entityType="Module" entityName={entry.module.name} disabled={!testCaseMetricsQuery.data} onClick={() => setHealthModuleId(entry.module.id)} />
                          </div>
                        </div>
                        {!isCollapsed && modulePageState?.isInitialLoading ? (
                          <div className="hierarchy-children-state hierarchy-children-state--tile">
                            <InlineLoadingState
                              label={`Loading test cases in ${entry.module.name}`}
                            />
                          </div>
                        ) : null}
                        {!isCollapsed && modulePageState?.failedPageIndex === 0 ? (
                          <div className="hierarchy-children-state hierarchy-children-state--tile hierarchy-children-state--error" role="alert">
                            <span>Test cases in this module could not be loaded.</span>
                            <button className="ghost-button compact" onClick={() => retryModulePage(entry.module.id, 0)} type="button">Retry</button>
                          </div>
                        ) : null}
                        {!isCollapsed && !entry.count ? renderModuleLoadMoreFooter(entry.module.id, entry.module.name) : null}
                        </Fragment>
                      );
                    }

                    if (entry.kind === "unassigned") {
                      return (
                        <div className="test-case-module-header is-unassigned entity-health-hierarchy-header" data-health-entity="Module" key="module-unassigned">
                          <label className="checkbox-field">
                            <input
                              aria-label="Select all Ungrouped test cases"
                              checked={areAllUnassignedCasesSelected}
                              onChange={(event) => setUnassignedTestCasesSelected(event.target.checked)}
                              type="checkbox"
                            />
                          </label>
                          <button
                            aria-expanded={isUnassignedModuleExpanded}
                            aria-label={isUnassignedModuleExpanded ? "Collapse Ungrouped" : "Expand Ungrouped"}
                            className={isUnassignedModuleExpanded ? "ghost-button compact module-toggle-button is-expanded" : "ghost-button compact module-toggle-button"}
                            onClick={() => setIsUnassignedModuleExpanded((current) => !current)}
                            type="button"
                          >
                            <ModuleChevronIcon isExpanded={isUnassignedModuleExpanded} />
                          </button>
                          <span className="module-folder-icon">
                            <FolderOffIcon size={16} />
                          </span>
                          <strong>Ungrouped</strong>
                          {isUnassignedModuleExpanded && unassignedCaseIds.length ? (
                            <button
                              aria-label={`${areAllUnassignedCasesSelected ? "Clear selection for" : "Select all loaded test cases in"} Ungrouped`}
                              aria-pressed={areAllUnassignedCasesSelected}
                              className="ghost-button compact module-case-selection-button"
                              onClick={() => setUnassignedTestCasesSelected(!areAllUnassignedCasesSelected)}
                              title={areAllUnassignedCasesSelected ? "Clear loaded case selection" : "Select all loaded cases"}
                              type="button"
                            >
                              <SelectionToggleIcon checked={!areAllUnassignedCasesSelected} />
                              <span className="sr-only">{areAllUnassignedCasesSelected ? "Clear all selected test cases" : "Select all test cases"}</span>
                            </button>
                          ) : null}
                          <div className="entity-health-ribbon">
                            {!testCaseMetricsQuery.data
                              ? renderDeferredModuleMetrics(moduleHealth.unassigned.count)
                              : renderModuleMetrics(moduleHealth.unassigned)}
                            <EntityHealthButton entityType="Module" entityName="Ungrouped" disabled={!testCaseMetricsQuery.data} onClick={() => setHealthModuleId("unassigned")} />
                          </div>
                        </div>
                      );
                    }

                    const testCase = entry.testCase;
                    const currentModule = "module" in entry ? entry.module : undefined;
                    const nextEntry = moduleTileEntries[entryIndex + 1];
                    const nextModuleId = nextEntry?.kind === "case"
                      ? ("module" in nextEntry ? nextEntry.module?.id : undefined)
                      : "";
                    const isLastCaseInModule = Boolean(currentModule?.id) && nextModuleId !== currentModule?.id;
                    const isSelectedForAction = selectedActionTestCaseIds.includes(testCase.id);
                    const isActive = selectedTestCaseId === testCase.id && !isCreating;
                    const history = (historyByCaseId[testCase.id] || []).slice(0, 10);
                    const latest = history[0];
                    const linkedRequirementId = (testCase.requirement_ids || [testCase.requirement_id]).find(Boolean) || "";
                    const linkedStory = testCase.linked_requirements?.find((story) => story.id === linkedRequirementId);
                    const requirementDisplayId = linkedRequirementId ? linkedStory?.display_id || requirementDisplayIdById[linkedRequirementId] || "Story" : "";
                    const requirementTitle = linkedRequirementId
                      ? linkedStory?.title || requirementTitleById[linkedRequirementId] || "Linked Story"
                      : "";
                    const stepCount = stepCountByCaseId[testCase.id];
                    const suiteCount = (testCase.suite_ids || []).length || 0;
                    const failedRunCount = history.filter((result) => ["failed", "blocked"].includes(String(result.status || "").toLowerCase())).length;
                    const passedRuns = history.filter((result) => result.status === "passed").length;
                    const passRate = history.length ? Math.round((passedRuns / history.length) * 100) : 0;
                    const statusLabel = formatTestCaseWorkflowStatus(getTestCaseWorkflowStatus(testCase, latest?.status, defaultTestCaseStatus));
                    const isFailedCase = ["failed", "blocked"].includes(String(latest?.status || "").toLowerCase());
                    const isUnlinkedCase = !linkedRequirementId;
                    const isPendingSchedulerCase = isPendingCaseReview(testCase);
                    const isRunningCase = schedulerActionCaseId === testCase.id && schedulerActionKind === "run";
                    const isRunningLocalCase = schedulerActionCaseId === testCase.id && schedulerActionKind === "run-local";
                    const apiOnlyState = testCaseApiOnlyState(testCase.id);
                    const isApiOnlyCase = apiOnlyState === true;
                    const isLocalExecutionTypeKnown = typeof apiOnlyState === "boolean";
                    const canRunLocalCase = testCase.automated === "yes" || !isLocalExecutionTypeKnown || isApiOnlyCase;
                    const automationReadiness = testCase.automated === "yes"
                      ? 100
                      : stepCount === undefined
                        ? null
                        : Math.min(96, Math.max(26, 36 + stepCount * 4 + (requirementTitle ? 14 : 0) + (history.length ? 8 : 0) - failedRunCount * 6));
                    const stabilityScore = history.length ? passRate : 0;
                    const linkedDefectCount = new Set((testCase.defect_ids || []).filter(Boolean)).size;
                    const qualityScore = testCase.ai_quality_score === null || testCase.ai_quality_score === undefined
                      ? testCase.detail_complete === false
                        ? null
                        : calculateTestCaseAiQualityScore({
                          title: testCase.title,
                          description: testCase.description,
                          steps: [],
                          requirementId: testCase.requirement_ids?.[0] || testCase.requirement_id,
                          labels: testCase.labels || [],
                          parameterValues: (testCase.parameter_values || {}) as Record<string, string>
                        })
                      : testCase.ai_quality_score;
                    const guidance = caseExecutionGuidance({ hasRuns: history.length > 0, failed: isFailedCase,
                      unlinked: isUnlinkedCase, automationCandidate: canUseAutomationWorkspace && testCase.automated !== "yes" && automationReadiness !== null && automationReadiness >= 70 });
                    const aiInsightTone = guidance.tone;
                    const aiInsight = guidance.text;
                    const tileActions = [
	                      {
	                        label: "Open case",
	                        description: "Open this test case in the workspace.",
	                        icon: <OpenIcon />,
	                        onClick: () => openLibraryCase(testCase.id),
	                        requiredPermissions: ["testcase.view"]
	                      },
                      ...(isFailedCase
                        ? [
                          {
                            label: "View latest failure",
	                            description: "Open the most recent failed or blocked execution.",
	                            icon: <OpenIcon />,
	                            onClick: () => openLatestFailureRun(testCase.id),
	                            requiredPermissions: ["run.view"]
	                          }
                        ]
                        : []),
                      {
                        label: "Run manually",
                        description: "Create a manual execution run for this test case.",
		                        icon: <TestCaseRunIcon />,
                        onClick: () => openRunBuilder([testCase.id]),
		                        disabled: isRunningCase || isRunningLocalCase || reviewingCaseIds.includes(testCase.id) || !canCreateRuns || !projectId || !appTypeId || !session?.user.id,
	                        featureKeys: ["hellotest.manual.runs"],
	                        requiredPermissions: ["run.create"],
	                        tone: "primary" as const
	                      },
                      ...(isPendingSchedulerCase
                        ? []
                        : [
                          {
                            label: "Clone case",
	                            description: "Create a copy with the same steps, Test Params, and linked Data Set.",
	                            icon: <CopyIcon />,
	                            onClick: () => void handleCloneCase(testCase),
	                            disabled: createTestCase.isPending,
	                            requiredPermissions: ["testcase.create"]
	                          },
                          {
                            label: "Export test case",
                            description: "Download this test case as a CSV file.",
	                            icon: <ExportIcon />,
	                            onClick: () => void exportCasesToCsv([testCase], {
	                              fileLabel: testCase.title
	                            }),
	                            requiredPermissions: ["testcase.export"]
	                          },
                          {
                            label: "Move to suite",
	                            description: "Pick existing suite links and replace this case's current suite scope.",
	                            icon: <MoveIcon />,
	                            onClick: () => openSuiteTransferModal([testCase.id], "move"),
	                            requiredPermissions: ["suite.update"]
	                          },
                          {
                            label: "Delete case",
                            description: "Remove this test case while preserving run history.",
	                            icon: <TrashIcon />,
	                            onClick: () => void handleDeleteCaseItem(testCase),
	                            disabled: deleteTestCase.isPending,
	                            requiredPermissions: ["testcase.delete"],
	                            tone: "danger" as const
	                          }
                        ])
                    ];

                    return (
                      <Fragment key={`${currentModule?.id || "unassigned"}:${testCase.id}`}>
                      <CaseLibraryCard testCase={testCase} history={history} tileActions={tileActions} isActive={isActive} isSelectedForAction={isSelectedForAction} isFailedCase={isFailedCase} isUnlinkedCase={isUnlinkedCase} canUpdateTestCases={canUpdateTestCases} isDeletingSelectedTestCases={isDeletingSelectedTestCases} isBulkReviewRunning={isBulkReviewRunning} canUseAutomationWorkspace={canUseAutomationWorkspace} requirementDisplayId={requirementDisplayId} requirementTitle={requirementTitle} statusLabel={statusLabel} stepCount={stepCount} automationReadiness={automationReadiness} stabilityScore={stabilityScore} passedRuns={passedRuns} linkedDefectCount={linkedDefectCount} qualityScore={qualityScore} failedRunCount={failedRunCount} aiInsightTone={aiInsightTone} aiInsight={aiInsight} openLibraryCase={openLibraryCase} isModuleChild={caseModuleById.has(testCase.id)} reviewDecision={renderReviewDecision(testCase, true)} onOpen={() => openLibraryCase(testCase.id)} onDragEnd={() => setDraggingCaseIds([])} onDragStart={transfer => startDraggingTestCases(testCase.id, transfer)} onToggleSelected={checked => setSelectedActionTestCaseIds(current => checked ? [...new Set([...current, testCase.id])] : current.filter(id => id !== testCase.id))} />
                      {isLastCaseInModule && currentModule
                        ? renderModuleLoadMoreFooter(currentModule.id, currentModule.name)
                        : null}
                      </Fragment>
                    );
                  })}
                </div>
              ) : null}
              {!isLibraryLoading && catalogViewMode === "tile" && !hasMoreVisibleTestCases && (isCatalogFiltered || (isUnassignedModuleExpanded && isUnassignedModuleTileVisible)) && testCasesQuery.hasNextPage ? (
                <HierarchyAutoLoadSentinel
                  isLoading={testCasesQuery.isFetchingNextPage}
                  error={testCasesQuery.isFetchNextPageError ? testCasesQuery.error : undefined}
                  onRetry={() => testCasesQuery.fetchNextPage()}
                  progressKey={`${catalogFilterKey}:${testCasesQuery.isPlaceholderData}:${testCasesQuery.data?.pages.length}`}
                  onLoad={() => { if (!testCasesQuery.isPlaceholderData) return testCasesQuery.fetchNextPage(); }}
                  scopeLabel={isCatalogFiltered ? "matching test cases" : "unassigned test cases"}
                />
              ) : null}
              {!isLibraryLoading && (filteredCases.length || visibleModuleCaseGroups.length || testCasesQuery.hasNextPage) && catalogViewMode === "list" ? (
                <DataTable
                  columns={workflowReviewScope || isReviewQueueOpen
                    ? ["select", "id", "title", "reviewStatus", "priority", "status"].flatMap((key) => testCaseListColumns.filter((column) => column.key === key))
                    : testCaseListColumns}
                  enableColumnResize
                  enableHeaderColumnReorder
                  emptyMessage="No test cases match the current search and filters."
                  getRowDraggable={() => canUpdateTestCases && !isDeletingSelectedTestCases}
                  getRowClassName={(testCase) => (selectedTestCaseId === testCase.id && !isCreating ? "is-active-row" : "")}
                  getRowKey={(testCase) => testCase.id}
                  onRowDragEnd={() => setDraggingCaseIds([])}
                  onRowDragStart={(testCase, event) => startDraggingTestCases(testCase.id, event.dataTransfer)}
                  onRowClick={(testCase) => openLibraryCase(testCase.id)}
                  renderRowActions={renderTestCaseRowActions}
                  rowGroups={workflowReviewScope || isReviewQueueOpen ? undefined : testCaseListRowGroups}
                  rows={workflowReviewScope || isReviewQueueOpen ? filteredCases : []}
                  storageKey={isReviewQueueOpen ? "hellotest:test-cases:review-list-columns:v1" : "hellotest:test-cases:list-columns:v2"}
                />
              ) : null}
              {!isLibraryLoading && catalogViewMode === "list" && isCatalogFiltered && testCasesQuery.hasNextPage ? (
                <HierarchyAutoLoadSentinel
                  isLoading={testCasesQuery.isFetchingNextPage || testCasesQuery.isPlaceholderData}
                  error={testCasesQuery.isFetchNextPageError ? testCasesQuery.error : undefined}
                  onRetry={() => testCasesQuery.fetchNextPage()}
                  progressKey={`${catalogFilterKey}:${testCasesQuery.data?.pages.length}`}
                  onLoad={() => { if (!testCasesQuery.isPlaceholderData) return testCasesQuery.fetchNextPage(); }}
                  scopeLabel="matching test cases"
                />
              ) : null}
	              {!isLibraryLoading && hasMoreVisibleTestCases ? (
	                <div className="catalog-progressive-load">
	                  <span>
	                    Showing {visibleTileCaseCount} of {totalTileCaseCount} matching test cases.
	                  </span>
                  <HierarchyAutoLoadSentinel
                    isLoading={false}
                    onLoad={() => setVisibleTestCaseCount((current) => current + TEST_CASE_RENDER_BATCH_SIZE)}
                    progressKey={visibleTestCaseCount}
                    scopeLabel="test cases"
                  />
	                </div>
	              ) : null}
	              {!isLibraryLoading && !testCasesQuery.isError && !filteredCases.length && !visibleModuleCaseGroups.length && !testCasesQuery.hasNextPage ? (
                isReviewQueueOpen ? (
                  <div className="empty-state compact">No pending reviews assigned to you in this application.</div>
                ) : hasActiveCaseCatalogFilter || testCases.length ? (
                  <div className="empty-state compact">No test cases match the current search.</div>
                ) : (
                  <div className="empty-state compact">
                    <div>No test cases exist for this app type yet.</div>
                    <button className="primary-button" disabled={!appTypeId} onClick={() => beginCreateCase()} type="button">Create first case</button>
                  </div>
                )
              ) : null}
            </TileBrowserPane>
          </Panel>
        ));
}
