import type { useCaseLibrary } from "./useCaseLibrary";
import type { NavigateFunction } from "react-router-dom";
import type { UseQueryResult, UseInfiniteQueryResult, UseMutationResult } from "@tanstack/react-query";
import type { SafePagedResult } from "@hellotest/platform/frontend/src/shared/lib/collectionGuards";
import type { SessionPayload } from '@hellotest/platform/frontend/src/types';
import { getTestCaseWorkflowStatus, formatTestCaseWorkflowStatus } from "./testCaseWorkspaceUtils";
import { TestCaseRunIcon, DeferredTestCaseCatalogValue, ModuleChevronIcon, ModulePencilIcon } from "./CaseLibraryActions";
import { type ExecutionStartMode, type TestCaseDeliveryContext } from "./testCaseWorkspaceTypes";
import { type SuiteTransferAction } from "./../../components/TestCaseSuiteTransferModal";
import type { TestDataOptions } from "@hellotest/platform/frontend/src/types";
import { useMemo, type DragEvent as ReactDragEvent } from "react";
import type { InfiniteData } from "@tanstack/react-query";
import { AddIcon, CopyIcon, ExportIcon, FolderOffIcon, ModuleIcon, MoveIcon, OpenIcon, SelectionToggleIcon, TestCaseIcon, TrashIcon } from "@hellotest/platform/frontend/src/platform/components/AppIcons";
import { CatalogActionMenu } from "@hellotest/platform/frontend/src/shared/components/CatalogActionMenu";
import { type DataTableColumn } from "@hellotest/platform/frontend/src/shared/components/DataTable";
import { DisplayIdBadge } from "@hellotest/platform/frontend/src/shared/components/DisplayIdBadge";
import { HierarchyAutoLoadSentinel } from "./../../components/HierarchyLoadMoreButton";
import { InlineLoadingState } from "@hellotest/platform/frontend/src/shared/components/LoadingSkeleton";
import { EntityHealthButton } from "@hellotest/manual/frontend/components/EntityHealthDialog";
import { richTextToPlainText } from "@hellotest/platform/frontend/src/platform/components/RichTextEditor";
import { StatusBadge } from "@hellotest/platform/frontend/src/shared/components/StatusBadge";
import { formatTileCardLabel } from "@hellotest/platform/frontend/src/shared/components/TileCardPrimitives";
import { formatAuditTimestamp, resolveAuditUserLabel } from "@hellotest/platform/frontend/src/shared/lib/auditDisplay";
import { hasAutomationCoverage } from "./../../lib/caseIdentity";
import { formatReferenceList } from "@hellotest/platform/frontend/src/shared/lib/externalReferences";
import { deriveModuleHealth } from "./../../lib/hierarchyHealth";
import type { ExecutionResult, TestCase, TestCaseModule, User } from "@hellotest/platform/frontend/src/types";

export interface useCaseLibraryTableInputs {
  navigate: NavigateFunction;
  session: SessionPayload | null;
  projectId: string;
  appTypeId: string;
  canDeleteTestCases: boolean;
  canCreateRuns: boolean;
  canUseAutomationWorkspace: boolean;
  canRunLocalAutomation: boolean;
  isReviewQueueOpen: boolean;
  reviewingCaseIds: string[];
  selectedActionTestCaseIds: string[];
  setSelectedActionTestCaseIds: React.Dispatch<React.SetStateAction<string[]>>;
  isUnassignedModuleExpanded: boolean;
  setIsUnassignedModuleExpanded: React.Dispatch<React.SetStateAction<boolean>>;
  selectedModuleIds: string[];
  catalogFilterKey: string;
  isCatalogFiltered: boolean;
  isModuleExpanded: (moduleId: string) => boolean;
  testCaseMetricsQuery: ReturnType<typeof useCaseLibrary>["testCaseMetricsQuery"];
  testCasesQuery: UseInfiniteQueryResult<InfiniteData<SafePagedResult<TestCase>, unknown>, Error>;
  modulePageStateById: Record<string, { loaded: number; total: number; nextCursor: string | null; isInitialLoading: boolean; isLoadingMore: boolean; failedPageIndex: number | null; }>;
  retryModulePage: (moduleId: string, pageIndex: number) => void;
  toggleModuleExpansion: (moduleId: string) => void;
  isDeletingSelectedTestCases: boolean;
  setHealthModuleId: React.Dispatch<React.SetStateAction<string | null>>;
  deletingModuleId: string;
  renamingModuleId: string;
  setRenamingModuleId: React.Dispatch<React.SetStateAction<string>>;
  renamingModuleName: string;
  setRenamingModuleName: React.Dispatch<React.SetStateAction<string>>;
  draggingCaseIds: string[];
  defaultTestCaseStatus: string;
  defaultTestCaseAutomated: "no";
  schedulerActionCaseId: string;
  schedulerActionKind: "" | "run" | "run-local" | "run-remote";
  createTestCase: { isPending: boolean };
  createLocalRun: { isPending: boolean };
  deleteTestCase: { isPending: boolean };
  userById: Record<string, User>;
  beginCreateCase: (suiteContextId?: string, requirementId?: string, deliveryContext?: TestCaseDeliveryContext, moduleId?: string) => void;
  historyByCaseId: Record<string, ExecutionResult[]>;
  sharedGroupNameById: Record<string, string>;
  stepCountByCaseId: Record<string, number | undefined>;
  requirementTitleById: Record<string, string>;
  caseModuleById: Map<string, TestCaseModule>;
  moduleCaseGroups: { groups: { module: TestCaseModule; cases: TestCase[]; }[]; unassignedCases: TestCase[]; };
  visibleModuleCaseGroups: { module: TestCaseModule; cases: TestCase[]; }[];
  moduleHealth: { byId: Map<string, ReturnType<typeof deriveModuleHealth>>; unassigned: ReturnType<typeof deriveModuleHealth> };
  renderModuleMetrics: (health: ReturnType<typeof deriveModuleHealth>) => JSX.Element;
  renderDeferredModuleMetrics: (count?: number) => JSX.Element;
  hasCompleteModuleMetrics: (_moduleId: string) => boolean;
  renderModuleLoadMoreFooter: (moduleId: string, moduleName: string) => JSX.Element | null;
  selectableFilteredCases: TestCase[];
  unassignedCaseIds: string[];
  areAllFilteredCasesSelected: boolean;
  areAllUnassignedCasesSelected: boolean;
  setTestCaseIdsSelected: (caseIds: string[], checked: boolean) => void;
  setAllFilteredTestCaseItemsSelected: (checked: boolean) => void;
  setModuleSelected: (moduleId: string, checked: boolean) => void;
  setUnassignedTestCasesSelected: (checked: boolean) => void;
  testCaseApiOnlyState: (testCaseId: string) => boolean | undefined;
  openRunBuilder: (testCaseIds: string[], mode?: ExecutionStartMode) => void;
  handleDropCaseOnModule: (moduleId: string, event: ReactDragEvent<HTMLDivElement>) => void;
  getTestCaseDropState: (module: TestCaseModule) => { canAcceptDrop: boolean; dropLabel: string; };
  handleRenameModule: (moduleId: string) => Promise<void>;
  handleDeleteModule: (module: TestCaseModule) => Promise<void>;
  openSuiteTransferModal: (testCaseIds: string[], action?: SuiteTransferAction) => void;
  exportCasesToCsv: (testCasesToExport: TestCase[], options?: { fileLabel?: string; successMessage?: string; }) => Promise<void>;
  handleCloneCase: (testCase: TestCase, requestedStartUrl?: string) => Promise<void>;
  handleDeleteCaseItem: (testCase: TestCase) => Promise<void>;
  handleRunTestCase: (testCaseId: string, mode?: "local" | "remote") => Promise<void>;
  getRequirementTitleForCase: (testCase: TestCase) => string;
  openLibraryCase: (testCaseId: string) => void;
  openLatestFailureRun: (testCaseId: string) => Promise<void>;
  renderAiGeneratedDecision: (testCase: TestCase) => JSX.Element;
  renderReviewDecision: (testCase: TestCase, iconOnly?: boolean) => string | JSX.Element | null;
}

export function useCaseLibraryTable({ navigate, session, projectId, appTypeId, canDeleteTestCases, canCreateRuns, canUseAutomationWorkspace, canRunLocalAutomation, isReviewQueueOpen, reviewingCaseIds, selectedActionTestCaseIds, setSelectedActionTestCaseIds, isUnassignedModuleExpanded, setIsUnassignedModuleExpanded, selectedModuleIds, catalogFilterKey, isCatalogFiltered, isModuleExpanded, testCaseMetricsQuery, testCasesQuery, modulePageStateById, retryModulePage, toggleModuleExpansion, isDeletingSelectedTestCases, setHealthModuleId, deletingModuleId, renamingModuleId, setRenamingModuleId, renamingModuleName, setRenamingModuleName, draggingCaseIds, defaultTestCaseStatus, defaultTestCaseAutomated, schedulerActionCaseId, schedulerActionKind, createTestCase, createLocalRun, deleteTestCase, userById, beginCreateCase, historyByCaseId, sharedGroupNameById, stepCountByCaseId, requirementTitleById, caseModuleById, moduleCaseGroups, visibleModuleCaseGroups, moduleHealth, renderModuleMetrics, renderDeferredModuleMetrics, hasCompleteModuleMetrics, renderModuleLoadMoreFooter, selectableFilteredCases, unassignedCaseIds, areAllFilteredCasesSelected, areAllUnassignedCasesSelected, setTestCaseIdsSelected, setAllFilteredTestCaseItemsSelected, setModuleSelected, setUnassignedTestCasesSelected, testCaseApiOnlyState, openRunBuilder, handleDropCaseOnModule, getTestCaseDropState, handleRenameModule, handleDeleteModule, openSuiteTransferModal, exportCasesToCsv, handleCloneCase, handleDeleteCaseItem, handleRunTestCase, getRequirementTitleForCase, openLibraryCase, openLatestFailureRun, renderAiGeneratedDecision, renderReviewDecision }: useCaseLibraryTableInputs) {
const testCaseListColumns = useMemo<Array<DataTableColumn<TestCase>>>(() => [
    {
      key: "select",
      label: "",
      canToggle: false,
      canReorder: false,
      canResize: false,
      width: 56,
      headerRender: () => (
        <label className="data-table-header-checkbox" onClick={(event) => event.stopPropagation()}>
          <input
            aria-label="Select all test cases"
            checked={areAllFilteredCasesSelected}
            onChange={(event) => setAllFilteredTestCaseItemsSelected(event.target.checked)}
            type="checkbox"
          />
        </label>
      ),
      render: (testCase) => (
        <div onClick={(event) => event.stopPropagation()}>
          <input
            aria-label={`Select Test Case ${testCase.title}`}
            checked={selectedActionTestCaseIds.includes(testCase.id)}
            onChange={(event) =>
              setSelectedActionTestCaseIds((current) =>
                event.target.checked ? [...new Set([...current, testCase.id])] : current.filter((id) => id !== testCase.id)
              )
            }
            type="checkbox"
          />
        </div>
      )
    },
    {
      key: "id",
      label: "ID",
      width: 128,
      minWidth: 112,
      sortValue: (testCase) => testCase.display_id || testCase.id,
      render: (testCase) => (
        <span className="test-case-list-id test-case-identity">
          <TestCaseIcon size={16} />
          <DisplayIdBadge value={testCase.display_id || testCase.id} />
        </span>
      )
    },
    {
      key: "title",
      label: "Test case",
      canToggle: false,
      width: 360,
      minWidth: 320,
      render: (testCase) => <strong className="data-table-primary-title" title={testCase.title}>{testCase.title}</strong>
    },
    {
      key: "requirement",
      label: "Story",
      width: 220,
      minWidth: 150,
      render: (testCase) => getRequirementTitleForCase(testCase) || "No story linked"
    },
    {
      key: "module",
      label: "Module",
      width: 180,
      minWidth: 132,
      render: (testCase) => caseModuleById.get(testCase.id)?.name || "Unassigned"
    },
    {
      key: "aiGenerated",
      label: "AI generated",
      defaultVisible: false,
      width: 152,
      minWidth: 132,
      render: (testCase) => renderAiGeneratedDecision(testCase)
    },
    {
      key: "labels",
      label: "Labels",
      defaultVisible: false,
      width: 200,
      minWidth: 132,
      render: (testCase) => formatReferenceList(testCase.labels) || "—"
    },
    {
      key: "reviewStatus",
      label: "Review",
      defaultVisible: true,
      canToggle: !isReviewQueueOpen,
      width: 152,
      minWidth: 108,
      render: (testCase) => renderReviewDecision(testCase)
    },
    {
      key: "reviewer",
      label: "Reviewer",
      defaultVisible: false,
      width: 160,
      minWidth: 124,
      render: (testCase) => testCase.detail_complete === false && testCase.summary_complete !== true
        ? <DeferredTestCaseCatalogValue field="reviewer details" />
        : testCase.reviewer_id ? resolveAuditUserLabel(testCase.reviewer_id, userById) : "Unassigned"
    },
    {
      key: "quality",
      label: "Test Quality",
      defaultVisible: false,
      width: 104,
      minWidth: 92,
      render: (testCase) => testCase.ai_quality_score === null || testCase.ai_quality_score === undefined ? "—" : `${testCase.ai_quality_score}%`
    },
    {
      key: "description",
      label: "Description",
      defaultVisible: false,
      width: 320,
      minWidth: 180,
      render: (testCase) => <span className="data-table-description-clamp">{richTextToPlainText(testCase.description) || "No description yet for this test case."}</span>
    },
    {
      key: "externalReferences",
      label: "References",
      defaultVisible: false,
      width: 220,
      minWidth: 150,
      render: (testCase) => {
        if (testCase.detail_complete === false && testCase.summary_complete !== true) {
          return <DeferredTestCaseCatalogValue field="references" />;
        }
        const references = formatReferenceList(testCase.external_references);
        const hiddenReferenceCount = Math.max(
          0,
          Number(testCase.external_reference_count || 0) - (testCase.external_references || []).length
        );
        return `${references || "—"}${hiddenReferenceCount ? ` · +${hiddenReferenceCount} more` : ""}`;
      }
    },
    {
      key: "status",
      label: "Status",
      width: 108,
      minWidth: 92,
      render: (testCase) => {
        const history = historyByCaseId[testCase.id] || [];
        const latest = history[0];
        return <StatusBadge value={formatTestCaseWorkflowStatus(getTestCaseWorkflowStatus(testCase, latest?.status, defaultTestCaseStatus))} />;
      }
    },
    ...(canUseAutomationWorkspace ? [{
      key: "automated",
      label: "Automation coverage",
      width: 104,
      minWidth: 88,
      render: (testCase: TestCase) => <span>{testCase.linked_automation_cases?.map(twin => <button className="link-button" key={twin.id} onClick={() => navigate(`/automation?case=${encodeURIComponent(twin.id)}`)} type="button">{twin.display_id || "Automation twin"}</button>)}{!testCase.linked_automation_cases?.length ? hasAutomationCoverage(testCase) ? "Linked" : "Not linked" : null}</span>
    }] : []),
    {
      key: "priority",
      label: "Priority",
      width: 88,
      minWidth: 76,
      render: (testCase) => `P${testCase.priority || 3}`
    },
    {
      key: "steps",
      label: "Steps",
      width: 92,
      minWidth: 80,
      render: (testCase) => stepCountByCaseId[testCase.id] ?? <DeferredTestCaseCatalogValue field="step details" />
    },
    {
      key: "testSteps",
      label: "Test steps",
      defaultVisible: false,
      width: 380,
      minWidth: 220,
      render: (testCase) => {
        if (!Number.isFinite(testCase.step_count)) {
          return <DeferredTestCaseCatalogValue field="step details" />;
        }
        const stepCount = Number(testCase.step_count);
        if (!stepCount) {
          return "No steps yet";
        }
        const types = (testCase.step_types || []).map((value) => formatTileCardLabel(value, value));
        return `${stepCount} step${stepCount === 1 ? "" : "s"}${types.length ? ` · ${types.join(", ")}` : ""}`;
      }
    },
    {
      key: "testData",
      label: "Test Params",
      defaultVisible: false,
      width: 260,
      minWidth: 180,
      render: (testCase) => {
        if (testCase.detail_complete === false) {
          return <DeferredTestCaseCatalogValue field="Test Params" />;
        }
        const parameterEntries = Object.entries(testCase.parameter_values || {}).sort(([left], [right]) => left.localeCompare(right));

        if (!parameterEntries.length) {
          return "No Test Params";
        }

        return (
          <div className="data-table-multiline">
            {parameterEntries.map(([name, value]) => (
              <span className="data-table-multiline-line" key={name}>{`${name} = ${value}`}</span>
            ))}
          </div>
        );
      }
    },
    {
      key: "suites",
      label: "Suites",
      defaultVisible: false,
      width: 92,
      minWidth: 80,
      render: (testCase) => (testCase.suite_ids || (testCase.suite_id ? [testCase.suite_id] : [])).length || 0
    },
    {
      key: "runs",
      label: "Runs",
      width: 88,
      minWidth: 76,
      render: (testCase) => (historyByCaseId[testCase.id] || []).length
    },
    {
      key: "createdBy",
      label: "Created by",
      defaultVisible: false,
      width: 160,
      minWidth: 124,
      render: (testCase) => resolveAuditUserLabel(testCase.created_by, userById)
    },
    {
      key: "createdAt",
      label: "Created at",
      defaultVisible: false,
      width: 172,
      minWidth: 140,
      render: (testCase) => formatAuditTimestamp(testCase.created_at)
    },
    {
      key: "updatedBy",
      label: "Last updated by",
      defaultVisible: false,
      width: 172,
      minWidth: 132,
      render: (testCase) => resolveAuditUserLabel(testCase.updated_by || testCase.created_by, userById)
    },
    {
      key: "updatedAt",
      label: "Last updated at",
      defaultVisible: false,
      width: 184,
      minWidth: 148,
      render: (testCase) => formatAuditTimestamp(testCase.updated_at || testCase.created_at)
    }
  ], [
    caseModuleById,
    appTypeId,
    canCreateRuns,
    canRunLocalAutomation,
    canUseAutomationWorkspace,
    createLocalRun.isPending,
    createTestCase.isPending,
    defaultTestCaseAutomated,
    defaultTestCaseStatus,
    deleteTestCase.isPending,
    exportCasesToCsv,
    handleCloneCase,
    handleDeleteCaseItem,
    handleRunTestCase,
    historyByCaseId,
    testCaseApiOnlyState,
    openLatestFailureRun,
    openLibraryCase,
    projectId,
    requirementTitleById,
    renderAiGeneratedDecision,
    renderReviewDecision,
    schedulerActionCaseId,
    schedulerActionKind,
    session?.user.id,
    areAllFilteredCasesSelected,
    selectedActionTestCaseIds,
    selectableFilteredCases,
    sharedGroupNameById,
    stepCountByCaseId,
    userById
  ]);

const renderTestCaseRowActions = (testCase: TestCase) => {
    const history = historyByCaseId[testCase.id] || [];
    const latest = history[0];
    const isFailedCase = ["failed", "blocked"].includes(String(latest?.status || "").toLowerCase());
    const isRunningCase = schedulerActionCaseId === testCase.id && schedulerActionKind === "run";
    const isRunningLocalCase = schedulerActionCaseId === testCase.id && schedulerActionKind === "run-local";
    const apiOnlyState = testCaseApiOnlyState(testCase.id);
    const isApiOnlyCase = apiOnlyState === true;
    const isLocalExecutionTypeKnown = typeof apiOnlyState === "boolean";
    const canRunLocalCase = testCase.automated === "yes" || !isLocalExecutionTypeKnown || isApiOnlyCase;
    const rowActions = [
      {
        label: "Open case",
        description: "Open this test case in the workspace.",
        icon: <OpenIcon />,
        onClick: () => openLibraryCase(testCase.id),
        requiredPermissions: ["testcase.view"]
      },
      ...[
          ...(isFailedCase
            ? [{
                label: "View latest failure",
                description: "Open the most recent failed or blocked execution.",
                icon: <OpenIcon />,
                onClick: () => openLatestFailureRun(testCase.id),
                requiredPermissions: ["run.view"]
              }]
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
        ]
    ];

    return <CatalogActionMenu actions={rowActions} label={`${testCase.title} actions`} />;
  };

const testCaseListRowGroups = [
    ...visibleModuleCaseGroups.map(({ module, cases }) => {
      const isCollapsed = !isModuleExpanded(module.id);
      const modulePageState = modulePageStateById[module.id];
      const isSelected = selectedModuleIds.includes(module.id);
      const moduleCaseIds = cases.map((testCase) => testCase.id);
      const areAllModuleCasesSelected = moduleCaseIds.length > 0
        && moduleCaseIds.every((id) => selectedActionTestCaseIds.includes(id));
      const { canAcceptDrop, dropLabel } = getTestCaseDropState(module);
      const isInitialLoading = Boolean(modulePageState?.isInitialLoading);
      const hasInitialError = modulePageState?.failedPageIndex === 0;

      return {
        key: `module:${module.id}`,
        isCollapsed,
        rows: isInitialLoading || hasInitialError ? [] : cases,
        header: (
          <div
            className={[
              "test-case-module-header test-case-module-list-header entity-health-hierarchy-header",
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
            onDrop={canAcceptDrop ? (event) => handleDropCaseOnModule(module.id, event) : undefined}
            title={dropLabel || undefined}
          >
            <label className="checkbox-field" onClick={(event) => event.stopPropagation()}>
              <input
                aria-label={`Select module ${module.name}`}
                checked={isSelected}
                onChange={(event) => setModuleSelected(module.id, event.target.checked)}
                type="checkbox"
              />
            </label>
            <button
              aria-expanded={!isCollapsed}
              aria-label={isCollapsed ? "Expand module" : "Collapse module"}
              className={isCollapsed ? "ghost-button compact module-toggle-button" : "ghost-button compact module-toggle-button is-expanded"}
              onClick={() => toggleModuleExpansion(module.id)}
              type="button"
            >
              <ModuleChevronIcon isExpanded={!isCollapsed} />
            </button>
            <span className="module-folder-icon">
              <ModuleIcon size={18} />
            </span>
            {renamingModuleId === module.id ? (
              <input
                aria-label={`Module name for ${module.name}`}
                    className="module-rename-input"
                value={renamingModuleName}
                onChange={(event) => setRenamingModuleName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    void handleRenameModule(module.id);
                  }
                  if (event.key === "Escape") {
                    setRenamingModuleId("");
                    setRenamingModuleName("");
                  }
                }}
              />
            ) : (
              <strong>{module.name}</strong>
            )}
            {!isCollapsed && moduleCaseIds.length ? (
              <button
                aria-label={`${areAllModuleCasesSelected ? "Clear selection for" : "Select all loaded test cases in"} ${module.name}`}
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
                <button aria-label={`Create test case in ${module.name}`} className="ghost-button compact module-add-case-button" onClick={() => beginCreateCase("", module.requirement_ids?.[0] || "", {}, module.id)} title="Create Test Case" type="button">
                  <AddIcon /><span className="sr-only">Create Test Case</span>
                </button>
                {renamingModuleId === module.id ? (
                  <button className="primary-button compact" onClick={() => void handleRenameModule(module.id)} type="button">Save</button>
                ) : (
                  <button
                    aria-label={`Rename module ${module.name}`}
                    className="ghost-button compact module-edit-button"
                    onClick={() => {
                      setRenamingModuleId(module.id);
                      setRenamingModuleName(module.name);
                    }}
                    title="Rename module"
                    type="button"
                  >
                    <ModulePencilIcon />
                  </button>
                )}
                {canDeleteTestCases ? (<button
                  aria-label={`${deletingModuleId === module.id ? "Deleting" : "Delete"} module ${module.name}`}
                  className="ghost-button compact danger module-delete-button"
                  disabled={!isSelected || !canDeleteTestCases || Boolean(deletingModuleId) || isDeletingSelectedTestCases}
                  onClick={() => void handleDeleteModule(module)}
                  title={isSelected ? "Delete module" : "Select the module to enable delete"}
                  type="button"
                >
                  <TrashIcon />
                </button>) : null}
              </div>
            </div>
            <div className="entity-health-ribbon">
              {!hasCompleteModuleMetrics(module.id)
                ? renderDeferredModuleMetrics(module.test_case_count)
                : renderModuleMetrics(moduleHealth.byId.get(module.id)!)}
              <EntityHealthButton entityType="Module" entityName={module.name} disabled={!testCaseMetricsQuery.data} onClick={() => setHealthModuleId(module.id)} />
            </div>
          </div>
        ),
        content: !isCollapsed && isInitialLoading ? (
          <div className="hierarchy-children-state hierarchy-children-state--list">
            <InlineLoadingState
              label={`Loading test cases in ${module.name}`}
            />
          </div>
        ) : !isCollapsed && hasInitialError ? (
          <div className="hierarchy-children-state hierarchy-children-state--list hierarchy-children-state--error" role="alert">
            <span>Test cases in this module could not be loaded.</span>
            <button className="ghost-button compact" onClick={() => retryModulePage(module.id, 0)} type="button">Retry</button>
          </div>
        ) : !isCollapsed && !cases.length ? (
          <div className="empty-state compact">No test cases in this module.</div>
        ) : null,
        footer: !isCollapsed ? renderModuleLoadMoreFooter(module.id, module.name) : null
      };
    }),
    ...(moduleCaseGroups.unassignedCases.length || (!isCatalogFiltered && testCasesQuery.hasNextPage) ? [{
      key: "unassigned",
      isCollapsed: !isUnassignedModuleExpanded,
      rows: isUnassignedModuleExpanded ? moduleCaseGroups.unassignedCases : [],
      header: (
        <div className="test-case-module-header test-case-module-list-header is-unassigned entity-health-hierarchy-header" data-health-entity="Module">
          <label className="checkbox-field" onClick={(event) => event.stopPropagation()}>
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
      ),
      content: isUnassignedModuleExpanded && !moduleCaseGroups.unassignedCases.length ? (
        <div className="empty-state compact">No Ungrouped test cases are loaded yet.</div>
      ) : null,
      footer: !isCatalogFiltered && isUnassignedModuleExpanded && testCasesQuery.hasNextPage ? (
        <HierarchyAutoLoadSentinel isLoading={testCasesQuery.isFetchingNextPage} error={testCasesQuery.isFetchNextPageError ? testCasesQuery.error : undefined} onRetry={() => testCasesQuery.fetchNextPage()} progressKey={`${catalogFilterKey}:${testCasesQuery.isPlaceholderData}:${testCasesQuery.data?.pages.length}`} onLoad={() => { if (!testCasesQuery.isPlaceholderData) return testCasesQuery.fetchNextPage(); }} scopeLabel="Ungrouped test cases" />
      ) : null
    }] : [])
  ];

return { testCaseListColumns, renderTestCaseRowActions, testCaseListRowGroups };
}
