import { ExecutionRunCatalog } from "./execution-workspace/ExecutionRunCatalog";
import { useExecutionCaseNavigation } from "./execution-workspace/useExecutionCaseNavigation";
import { useExecutionRouteNavigation } from "./execution-workspace/useExecutionRouteNavigation";
import { useExecutionNavigationState } from "./execution-workspace/useExecutionNavigationState";
import { useExecutionCaseLifecycle } from "./execution-workspace/useExecutionCaseLifecycle";
import { useExecutionCatalogController } from "./execution-workspace/useExecutionCatalogController";
import { useExecutionCatalogState } from "./execution-workspace/useExecutionCatalogState";
import { useExecutionCatalogData } from "./execution-workspace/useExecutionCatalogData";
import { ExecutionRunnerWorkspace } from "./execution-workspace/ExecutionRunnerWorkspace";
import { ExecutionRunDetail } from "./execution-workspace/ExecutionRunDetail";
import { formatDuration, DEFAULT_DURATION_LABEL } from "../lib/executionTiming";
import { ExecutionContextSnapshotSummary, ExecutionContextSnapshotModal } from "../components/ExecutionFrozenContext";
import { type ExecutionCaseInstanceView, type ExecutionRunSummary, type ExecutionRunImpactSummary, executionCaseInstanceKey, buildExecutionCaseInstances, executionExpectedOutcomeCount, normalizeExecutionStatus, boardStatusTooltip, buildRunOutcomeBreakdown, ExecutionListCard, ExecutionStatusIndicator } from "../components/ExecutionRunListCard";
import { hasExecutionEvidence, ExecutionEvidencePreviewIcon, ExecutionStepCard } from "../components/ExecutionRunnerStep";
import { ExecutionCreateModal } from "../components/ExecutionCreateDrawer";
import { type ExecutionEvidenceReceipt } from "../lib/executionRunSummary";
import { type AiDesignImageInput, type TestDataOptions, type Execution, type ExecutionResult, type ExecutionSchedule, type Issue, type RequirementIteration, type RequirementRelease, type SmartExecutionPreviewResponse, type TestCase, type TestStep } from "@hellotest/platform/frontend/src/types";
import { capabilityView } from "@hellotest/platform/frontend/src/platform/capabilities/CapabilityView";
import { mapRunHooksToExecutionHooks } from "../lib/runHooks";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { IconAlertTriangle, IconArrowLeft, IconCheckbox, IconCircleCheck, IconClock, IconDatabase, IconFlag, IconFolder, IconInfoCircle, IconListDetails, IconPlayerPlay, IconShieldCheck, IconSparkles, IconUser } from "@tabler/icons-react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "@hellotest/platform/frontend/src/auth/AuthContext";
import { AddIcon, CalendarIcon, CollapseExpandIcon, ExportIcon, LayersIcon, MailIcon, OpenIcon, TestCaseIcon, TrashIcon } from "@hellotest/platform/frontend/src/platform/components/AppIcons";
import { type AiPreviewFinding } from "@hellotest/ai/frontend/components/AiInsightPreviewDialog";
import { AgenticProcessRail } from "@hellotest/agentic/frontend/components/AgenticExperience";
import { CatalogActionMenu } from "@hellotest/platform/frontend/src/shared/components/CatalogActionMenu";
import { CatalogViewToggle } from "@hellotest/platform/frontend/src/shared/components/CatalogViewToggle";
import { CatalogSearchFilter } from "@hellotest/platform/frontend/src/shared/components/CatalogSearchFilter";
import { DataTable, type DataTableColumn } from "@hellotest/platform/frontend/src/shared/components/DataTable";
import { RunReviewDialog } from "../components/RunReviewDialog";
import { uploadExecutionAttachment } from "../lib/executionAttachments";
import { resolveExecutionParameterContext } from "../lib/executionParameterContext";
import { type TestCaseSelectionResolution } from "../components/TestCasePicker";
import { runCaseReferences, runPickerIdBatches, retainEligibleRunCases, loadRunPickerCaseBatch } from "../lib/runPickerCases";
import { clearCreateRunNavigation, createRunDeliveryUpdates, createRunSelectionReadiness, deriveCreateRunDelivery, readCreateRunNavigation, type CreateRunNavigationPrefill } from "../lib/createRunNavigation";
import { RunConfigurationDialog, type RunConfigurationResource } from "../components/RunConfigurationDialog";
import { isRunFinished, runStoryCounts } from "../lib/runCatalog";
import { caseLiveViewSession } from "../lib/executionLiveView";
import { InfoTooltip } from "@hellotest/platform/frontend/src/shared/components/InfoTooltip";
import { HierarchyMetricStrip } from "../components/HierarchyMetricStrip";
import { LoadingState } from "@hellotest/platform/frontend/src/shared/components/LoadingState";
import { MultiAssigneePicker } from "@hellotest/platform/frontend/src/shared/components/MultiAssigneePicker";
import { PageHeader } from "@hellotest/platform/frontend/src/shared/components/PageHeader";
import { Panel } from "@hellotest/platform/frontend/src/shared/components/Panel";
import { CodePreviewDialog } from "@hellotest/automation/frontend/components/StepAutomationEditor";
import { ProgressMeter } from "@hellotest/platform/frontend/src/shared/components/ProgressMeter";
import { QualityMetricStrip } from "@hellotest/dashboard/frontend/components/QualityMetricStrip";
import { ReportBugSplitActionButton } from "../components/ReportBugSplitActionButton";
import { richTextToPlainText } from "@hellotest/platform/frontend/src/platform/components/RichTextEditor";
import { getExecutionResultDurationMs } from "../lib/executionCaseLifecycle";
import { StatusBadge } from "@hellotest/platform/frontend/src/shared/components/StatusBadge";
import { type SuitePickerMetadataByCaseId } from "../components/SuiteCasePicker";
import { TileCardProgress } from "@hellotest/platform/frontend/src/shared/components/TileCardPrimitives";
import { ToastMessage } from "@hellotest/platform/frontend/src/shared/components/ToastMessage";
import { WorkspaceBackButton, WorkspaceMasterDetail } from "@hellotest/platform/frontend/src/platform/components/WorkspaceMasterDetail";
import { useDeleteConfirmation } from "@hellotest/platform/frontend/src/shared/components/DeleteConfirmationDialog";
import { useAiPromptRegistry } from "@hellotest/integration/frontend/hooks/useAiPromptRegistry";
import { useCurrentAppType, useCurrentProject } from "@hellotest/platform/frontend/src/platform/hooks/useCurrentProject";
import { useFeatureFlags } from "@hellotest/platform/frontend/src/platform/hooks/useFeatureFlags";
import { useCapabilityAccess } from "@hellotest/platform/frontend/src/platform/hooks/useCapabilityAccess";
import { optionalQueryView } from "@hellotest/platform/frontend/src/shared/lib/optionalQueryView";
import { api } from "@hellotest/platform/frontend/src/lib/api";
import { canEditAutomationCode as resolveCanEditAutomationCode, canPreviewAutomationCode as resolveCanPreviewAutomationCode, canViewAutomationCode as resolveCanViewAutomationCode } from "@hellotest/automation/frontend/lib/automationAccess";
import { assessExecutionRunEvidence, executionFailureRiskLines, executionFailureReferenceContext } from "../lib/executionFailureEvidence";
import { asArray } from "@hellotest/platform/frontend/src/shared/lib/collectionGuards";
import { buildDeliveryScopeOptions, resolveDeliveryScopePrefill } from "@hellotest/manual/frontend/lib/deliveryScopeOptions";
import { formatReferenceList, parseReferenceList } from "@hellotest/platform/frontend/src/shared/lib/externalReferences";
import { areFeatureFlagsEnabled } from "@hellotest/platform/frontend/src/platform/lib/featureFlags";
import { summarizeExecutionStart } from "../lib/executionStartSummary";
import { selectLatestExecutionResultInstances } from "../lib/executionResultMetrics";
import { buildBugReportPath } from "../lib/bugReportNavigation";
import { isRovoIntegrationId } from "@hellotest/integration/frontend/lib/rovo";
import { readDefaultCatalogViewMode } from "@hellotest/platform/frontend/src/shared/lib/viewPreferences";
import { buildGroupAutomationCode, resolveStepAutomationCode } from "@hellotest/automation/frontend/lib/stepAutomation";
import { parseExecutionLogs, stringifyExecutionLogs, type ExecutionAiAnalysis, type ExecutionStepEvidence, type ExecutionStepStatus, type ExecutionStepWebDetail } from "../lib/executionLogs";
import { combineStepParameterValues } from "@hellotest/platform/frontend/src/shared/lib/stepParameters";
import { buildAssigneeOptions, resolveUserPrimaryLabel } from "@hellotest/platform/frontend/src/platform/lib/userDisplay";
import "./ExecutionsPage.case-run.css";
import "./ExecutionsPage.command-center.css";
import "./ExecutionsPage.run-metrics.css";
import "./ExecutionsPage.hierarchy.css";
import { ExecutionTab, ExecutionSuiteNode, ExecutionCaseView, ExecutionStepBlock, ExecutionCreateMode, ExecutionStartMode, ExecutionHookDraft, emptyExecutionHookDraft, TestRunsView, CatalogViewMode, ExecutionAssigneeOption, ExecutionEvidencePreviewState, ExecutionApiDetailState, SmartExecutionRequirementOption, ExecutionScheduleCadence, EMPTY_EXECUTION_RUN_IMPACT_SUMMARY, getExecutionRiskTone, getExecutionRiskLabel, getExecutionRiskInsight, buildIntervalCadence, parseIntervalCadenceMinutes, isIntervalCadence, formatScheduleCadence, EXECUTION_POLL_INTERVAL_MS, MAX_AI_BUG_CONTEXT_ITEMS, MAX_AI_BUG_EVIDENCE_LINES, EXECUTION_CASE_LIST_COLUMN_PREFERENCE_KEY, suiteBoardStatus, toCaseView, toStepView, evidenceMimeType, buildProgressSegments, toTimestamp, formatExecutionTimestamp, toDateTimeLocalValue, computeExecutionDurationMs, describeWorkspaceTransaction, resolveWorkspaceTransactionSummary, formatWorkspaceTransactionActionLabel, formatWorkspaceTransactionMetadataValue, resolveWorkspaceTransactionReadableMetadata, resolveWorkspaceTransactionComplexMetadata, averageDuration, buildExecutionInputParameterValues, collectExecutionOutputParameterValues, collectSuiteScopedExecutionOutputParameterValues, mergeExecutionStepCaptures } from "./execution-workspace/executionWorkspaceModel";
import { ExecutionAccordionSection, ExecutionAccordionChevronIcon, ExecutionAssigneeChip, resolveExecutionAssigneeSummary, ExecutionCardFact, ExecutionEditIcon, ExecutionStartIcon, ExecutionCompleteIcon, ExecutionAbortIcon, ExecutionRerunIcon, ExecutionAssigneeIcon, ExecutionSuiteIcon, ExecutionScopeIcon, ExecutionProgressFactsIcon, ExecutionRiskIcon, ExecutionRequirementImpactIcon, ExecutionReferenceIcon, ExecutionTimeIcon, ExecutionOverviewOrb, ExecutionSuiteCaseCard } from "./execution-workspace/ExecutionWorkspacePrimitives";
import { ReportEmailModal, ExecutionApiStepDialog, ExecutionAttemptDialog } from "./execution-workspace/ExecutionRunnerDialogs";
import { ExecutionAiAnalysisPanel } from "./execution-workspace/ExecutionRunLogs";
import { CreateExecutionScheduleModal } from "./execution-workspace/ExecutionScheduleDrawer";

export { ExecutionListCard } from "../components/ExecutionRunListCard";
export { ExecutionCreateModal } from "../components/ExecutionCreateDrawer";
const AiLifecycleReview = capabilityView<import("react").ComponentProps<typeof import("@hellotest/ai/frontend/components/AiLifecycleReview")["AiLifecycleReview"]>>("ai", "AiLifecycleReview", () => import("@hellotest/ai/frontend/components/AiLifecycleReview"), "AI review");
const AiReferenceImages = capabilityView<import('react').ComponentProps<typeof import('@hellotest/ai/frontend/components/AiReferenceImages')['AiReferenceImages']>>('ai', 'AiReferenceImages', () => import('@hellotest/ai/frontend/components/AiReferenceImages'), 'Reference screenshots');
const AiAssurancePanel = capabilityView<import("react").ComponentProps<typeof import("@hellotest/ai/frontend/components/AiAssurancePanel")["AiAssurancePanel"]> & {}>("ai", "AiAssurancePanel", () => import("@hellotest/ai/frontend/components/AiAssurancePanel"), "ai");
const AiInsightPreviewDialog = capabilityView<import("react").ComponentProps<typeof import("@hellotest/ai/frontend/components/AiInsightPreviewDialog")["AiInsightPreviewDialog"]> & {}>("ai", "AiInsightPreviewDialog", () => import("@hellotest/ai/frontend/components/AiInsightPreviewDialog"), "ai");

export function ExecutionsPage() {
  const queryClient = useQueryClient();
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const hasCreateExecutionDeepLink = searchParams.get("create") === "1";
  const createRunNavigation = useMemo(() => readCreateRunNavigation(location.state), [location.state]);
  const { session } = useAuth();
  const { getPrompt } = useAiPromptRegistry(Boolean(session));
  const [projectId, setProjectId] = useCurrentProject();
  const [appTypeId, setAppTypeId] = useCurrentAppType(projectId);
  const featureFlagsQuery = useFeatureFlags(Boolean(session));
  const { can, isLoading: isCapabilityAccessLoading } = useCapabilityAccess(projectId);
  const canCreateManualRuns = can("run.create")
    && areFeatureFlagsEnabled(featureFlagsQuery.data, ["hellotest.manual.runs"]);
  const canExecuteRuns = can("run.execute")
    && areFeatureFlagsEnabled(featureFlagsQuery.data, ["hellotest.manual.runs"]);
  const canUpdateRuns = can("run.update");
  const canViewSchedules = can("schedule.view");
  const canCreateSchedules = can("schedule.create");
  const canViewDeliveryScopes = can("requirement_iteration.view")
    && areFeatureFlagsEnabled(featureFlagsQuery.data, ["hellotest.manual.requirements"]);
  const canUpdateSchedules = can("schedule.update");
  const canDeleteSchedules = can("schedule.delete");
  const canRunSchedules = can("schedule.run");
  const canManageRunResults = can("result.manage");
  const canRunLocalAutomation = can("automation.run.local")
    && areFeatureFlagsEnabled(featureFlagsQuery.data, ["hellotest.automation.workspace", "hellotest.automation.local_execution"]);
  const canRunRemoteAutomation = can("automation.run.remote")
    && areFeatureFlagsEnabled(featureFlagsQuery.data, ["hellotest.automation.workspace", "hellotest.automation.remote_execution"]);
  const canConfigureParallelAutomation = can("automation.run.parallel")
    && areFeatureFlagsEnabled(featureFlagsQuery.data, ["hellotest.automation.workspace", "hellotest.automation.parallel_execution"]);
  const canUseRunAi = can("run.ai")
    && areFeatureFlagsEnabled(featureFlagsQuery.data, ["hellotest.ai.execution_analysis"]);
  const canReportBugs = can("feedback.create")
    && areFeatureFlagsEnabled(featureFlagsQuery.data, ["hellotest.manual.bugs"]);
  const canUseAiBugTriage = canReportBugs
    && areFeatureFlagsEnabled(featureFlagsQuery.data, ["hellotest.ai.bug_triage"]);
  const canViewRunGherkin = can("run.gherkin.view")
    && areFeatureFlagsEnabled(featureFlagsQuery.data, ["hellotest.manual.runs", "hellotest.manual.run_gherkin"]);
  const canViewRunAutomationCode = resolveCanViewAutomationCode(session, featureFlagsQuery.data, projectId);
  const canBuildRunAutomation = resolveCanEditAutomationCode(session, featureFlagsQuery.data, projectId);
  const canPreviewRunAutomation = resolveCanPreviewAutomationCode(session, featureFlagsQuery.data, projectId);
  const canExportRunReports = can("run.report.export");
  const canShareRunReports = can("run.report.share");
  const canViewRunEvidence = can("result.view")
    && can("attachment.view");
  const canCreateRunEvidence = can("result.manage")
    && can("attachment.create");
  const canDeleteRunEvidence = can("result.manage")
    && can("attachment.delete");
  const { confirmDelete, confirmationDialog } = useDeleteConfirmation();
  const { selectedExecutionId, setSelectedExecutionId, dismissedExecutionRouteRef, dismissedScheduleRouteRef, dismissedCaseRouteRef, selectedScheduleId, setSelectedScheduleId, selectedOperationId, setSelectedOperationId, focusedSuiteId, setFocusedSuiteId, focusedExecutionModuleId, setFocusedExecutionModuleId, inspectedExecutionCaseId, setInspectedExecutionCaseId, expandedExecutionSuiteIds, setExpandedExecutionSuiteIds, expandedExecutionModuleKeys, setExpandedExecutionModuleKeys, selectedTestCaseId, setSelectedTestCaseId, selectedCaseInstanceKey, setSelectedCaseInstanceKey } = useExecutionNavigationState();

  const [executionCreateMode, setExecutionCreateMode] = useState<ExecutionCreateMode>("manual");
  const [executionStartMode, setExecutionStartMode] = useState<ExecutionStartMode>("manual");
  const [executionParallelEnabled, setExecutionParallelEnabled] = useState(false);
  const [executionParallelCount, setExecutionParallelCount] = useState(1);
  const [executionHookDraft, setExecutionHookDraft] = useState<ExecutionHookDraft>(() => emptyExecutionHookDraft());
  const [testRunsView, setTestRunsView] = useState<TestRunsView>("suite-runs");
  const [selectedSuiteIds, setSelectedSuiteIds] = useState<string[]>([]);
  const [selectedDirectCaseIds, setSelectedDirectCaseIds] = useState<string[]>([]);
  const [resolvedDirectCases, setResolvedDirectCases] = useState<TestCase[]>([]);
  const [directCaseResolution, setDirectCaseResolution] = useState<TestCaseSelectionResolution | null>(null);
  const [isCreateExecutionModalOpen, setIsCreateExecutionModalOpen] = useState(false);
  const [isCreateScheduleModalOpen, setIsCreateScheduleModalOpen] = useState(false);
  const [scheduleModalMode, setScheduleModalMode] = useState<"create" | "edit">("create");
  const [editingScheduleId, setEditingScheduleId] = useState("");
  const processedCreateExecutionDeepLinkRef = useRef("");
  const openedCreateExecutionDeepLinkRef = useRef("");
  const deliveryPrefillEditedRef = useRef({ release: false, sprint: false });
  const navigationRunScopeRef = useRef<{ projectId: string; appTypeId: string } | null>(null);
  const [pendingNavigationDelivery, setPendingNavigationDelivery] = useState<CreateRunNavigationPrefill | null>(null);
  const clearCreateExecutionDeepLink = useCallback(() => {
    if (!hasCreateExecutionDeepLink && !readCreateRunNavigation(location.state)) return;
    const cleared = clearCreateRunNavigation(location.search, location.state);
    navigate({ pathname: location.pathname, search: cleared.search, hash: location.hash }, { replace: true, state: cleared.state });
  }, [hasCreateExecutionDeepLink, location.hash, location.pathname, location.search, location.state, navigate]);

  useEffect(() => {
    if (!canUseRunAi && executionCreateMode === "smart") {
      setExecutionCreateMode("manual");
    }
    if (!canConfigureParallelAutomation && executionParallelEnabled) {
      setExecutionParallelEnabled(false);
      setExecutionParallelCount(1);
    }
    if (executionStartMode === "local" && !canRunLocalAutomation) setExecutionStartMode("manual");
    if (executionStartMode === "remote" && !canRunRemoteAutomation) setExecutionStartMode("manual");
  }, [canConfigureParallelAutomation, canRunLocalAutomation, canRunRemoteAutomation, canUseRunAi, executionCreateMode, executionParallelEnabled, executionStartMode]);
  const [isExecutionHierarchyCollapsed, setIsExecutionHierarchyCollapsed] = useState(false);
  const [expandedExecutionStepGroupIds, setExpandedExecutionStepGroupIds] = useState<string[]>([]);
  const [expandedExecutionStepSections, setExpandedExecutionStepSections] = useState({ preconditions: true, testSteps: true });
  const [expandedExecutionStepIds, setExpandedExecutionStepIds] = useState<string[]>([]);
  const [bulkSelectedStepIds, setBulkSelectedStepIds] = useState<string[]>([]);
  const [runConfigurationResource, setRunConfigurationResource] = useState<RunConfigurationResource | null>(null);
  const [isRunEvidenceAnalysisOpen, setIsRunEvidenceAnalysisOpen] = useState(false);
  const [isRunWorkflowOpen, setIsRunWorkflowOpen] = useState(false);
  const [executionName, setExecutionName] = useState("");
  const [executionStartDate, setExecutionStartDate] = useState("");
  const [executionEndDate, setExecutionEndDate] = useState("");
  const [selectedExecutionEnvironmentId, setSelectedExecutionEnvironmentId] = useState("");
  const [selectedExecutionConfigurationId, setSelectedExecutionConfigurationId] = useState("");
  const [selectedExecutionDataOptions, setSelectedExecutionDataOptions] = useState<TestDataOptions>({});
  const [selectedExecutionDataSetId, setSelectedExecutionDataSetId] = useState("");
  const [selectedExecutionAssigneeIds, setSelectedExecutionAssigneeIds] = useState<string[]>([]);
  const [executionRelease, setExecutionRelease] = useState("");
  const [executionSprint, setExecutionSprint] = useState("");
  const [executionBuild, setExecutionBuild] = useState("");
  const [scheduleCadence, setScheduleCadence] = useState<ExecutionScheduleCadence>("weekly");
  const [scheduleIntervalMinutes, setScheduleIntervalMinutes] = useState(5);
  const [scheduleNextRunAt, setScheduleNextRunAt] = useState("");
  const [smartExecutionIntegrationId, setSmartExecutionIntegrationId] = useState("");
  const [smartExecutionReleaseScope, setSmartExecutionReleaseScope] = useState("");
  const [smartExecutionAdditionalContext, setSmartExecutionAdditionalContext] = useState("");
  const [smartExecutionImages, setSmartExecutionImages] = useState<AiDesignImageInput[]>([]);
  const [smartExecutionImagesBusy, setSmartExecutionImagesBusy] = useState(false);
  const [selectedSmartRequirementIds, setSelectedSmartRequirementIds] = useState<string[]>([]);
  const [smartExecutionRequirementSearch, setSmartExecutionRequirementSearch] = useState("");
  const [smartExecutionPreview, setSmartExecutionPreview] = useState<SmartExecutionPreviewResponse | null>(null);
  const [selectedSmartExecutionCaseIds, setSelectedSmartExecutionCaseIds] = useState<string[]>([]);
  const [smartExecutionPreviewMessage, setSmartExecutionPreviewMessage] = useState("");
  const [smartExecutionPreviewTone, setSmartExecutionPreviewTone] = useState<"success" | "error">("success");
  const [smartExecutionPreviewScopeKey, setSmartExecutionPreviewScopeKey] = useState("");
  const smartExecutionBuilderSessionRef = useRef(0);
  const smartExecutionPreviewRequestRef = useRef(0);
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState<"success" | "error">("success");
  const [activeTab, setActiveTab] = useState<ExecutionTab>("overview");
  const [executionSuiteCatalogViewMode, setExecutionSuiteCatalogViewMode] = useState<CatalogViewMode>(() => readDefaultCatalogViewMode());
  const [executionCaseCatalogViewMode, setExecutionCaseCatalogViewMode] = useState<CatalogViewMode>(() => readDefaultCatalogViewMode());
  const [executionSuiteSearch, setExecutionSuiteSearch] = useState("");
  const [executionCaseSearch, setExecutionCaseSearch] = useState("");
  const [isExecutionListMinimized, setIsExecutionListMinimized] = useState(false);
  const [isSuiteTreeMinimized, setIsSuiteTreeMinimized] = useState(false);
  const [isExecutionHealthExpanded, setIsExecutionHealthExpanded] = useState(true);
  const [isExecutionSupportExpanded, setIsExecutionSupportExpanded] = useState(true);
  const [isExecutionAiAnalysisExpanded, setIsExecutionAiAnalysisExpanded] = useState(false);
  const [runAnalysisInstruction, setRunAnalysisInstruction] = useState("Explain the run verdict, separate product risk from environment noise, cite failed or blocked evidence, and recommend the next review sequence.");
  const [runAnalysisInteractionMode, setRunAnalysisInteractionMode] = useState<"chat" | "agent">("agent");
  const [runAnalysisOperations, setRunAnalysisOperations] = useState<Record<string, {
    status: "running" | "completed" | "failed";
    error: string | null;
    completedCaseCount: number;
    totalCaseCount: number;
    recordedCount: number;
    previewOnlyCount: number;
  }>>({});
  const activeRunAnalysisIdsRef = useRef(new Set<string>());
  const selectedAnalysisExecutionIdRef = useRef(selectedExecutionId);
  selectedAnalysisExecutionIdRef.current = selectedExecutionId;
  const [runAnalysisReviewDraft, setRunAnalysisReviewDraft] = useState("");
  const [isRunAnalysisReviewAccepted, setIsRunAnalysisReviewAccepted] = useState(false);
  const [runAnalysisSourceChanged, setRunAnalysisSourceChanged] = useState(false);
  const runAnalysisReviewSourceRef = useRef<{ executionId: string; response: string; generatedAt: string } | null>(null);
  const [isFailureClusterPreviewOpen, setIsFailureClusterPreviewOpen] = useState(false);
  const [executionStepViewMode, setExecutionStepViewMode] = useState<"structured" | "gherkin" | "automation">("structured");
  const visibleExecutionStepViewMode = (executionStepViewMode === "gherkin" && !canViewRunGherkin)
    || (executionStepViewMode === "automation" && !canViewRunAutomationCode)
    ? "structured" : executionStepViewMode;
  const [liveNow, setLiveNow] = useState(() => Date.now());
  const [historyResult, setHistoryResult] = useState<ExecutionResult | null>(null);
  const [executionFinalizeAction, setExecutionFinalizeAction] = useState<"complete" | "abort" | null>(null);
  const [uploadingEvidenceStepId, setUploadingEvidenceStepId] = useState("");
  const [openingEvidenceStepId, setOpeningEvidenceStepId] = useState("");
  const [linkingDefectStepId, setLinkingDefectStepId] = useState("");
  const [runningExecutionApiStepId, setRunningExecutionApiStepId] = useState("");
  const [executionEvidencePreview, setExecutionEvidencePreview] = useState<ExecutionEvidencePreviewState | null>(null);
  const executionEvidenceObjectUrlRef = useRef<string | null>(null);
  const [executionApiDetailState, setExecutionApiDetailState] = useState<ExecutionApiDetailState | null>(null);
  const [isExecutionContextModalOpen, setIsExecutionContextModalOpen] = useState(false);
  const [isReportEmailModalOpen, setIsReportEmailModalOpen] = useState(false);
  const [reportEmailCaseId, setReportEmailCaseId] = useState("");
  const [reportEmailDraft, setReportEmailDraft] = useState("");
  const [codePreviewState, setCodePreviewState] = useState<{ title: string; subtitle: string; code: string } | null>(null);
  const [executionAssignmentDraftIds, setExecutionAssignmentDraftIds] = useState<string[]>([]);
  const [caseAssignmentDraft, setCaseAssignmentDraft] = useState("");
  const [caseReferenceDraft, setCaseReferenceDraft] = useState("");
  const [caseDefectDraft, setCaseDefectDraft] = useState("");
  const [supportsLocalDesktopExecution, setSupportsLocalDesktopExecution] = useState(true);

  const closeExecutionEvidence = () => {
    if (executionEvidenceObjectUrlRef.current) {
      URL.revokeObjectURL(executionEvidenceObjectUrlRef.current);
      executionEvidenceObjectUrlRef.current = null;
    }
    setExecutionEvidencePreview(null);
  };

  useEffect(() => () => {
    if (executionEvidenceObjectUrlRef.current) {
      URL.revokeObjectURL(executionEvidenceObjectUrlRef.current);
    }
  }, []);

  const catalogData = useExecutionCatalogData({ projectId, appTypeId, testRunsView, isCreateScheduleModalOpen, canViewSchedules, can, session });
  const { executionsQuery, executionSchedulesQuery, allExecutionResultsQuery, workspaceTransactionsQuery, executions, executionSchedules, allExecutionResults, workspaceTransactions, workspaceTransactionStatusCounts, executionSummaryById, executionById } = catalogData;
  const catalogState = useExecutionCatalogState({ projectId, appTypeId, testRunsView });
  const { runLibrarySearchByView, setRunLibrarySearchByView, catalogViewModeByView, setCatalogViewModeByView, selectedActionExecutionIds, setSelectedActionExecutionIds, selectedActionScheduleIds, setSelectedActionScheduleIds, selectedActionOperationIds, setSelectedActionOperationIds, executionStatusFilter, setExecutionStatusFilter, executionIssueFilter, setExecutionIssueFilter, executionEvidenceFilter, setExecutionEvidenceFilter, executionListItemHeight, setExecutionListItemHeight, executionCardMeasureRef, executionSearch, catalogViewMode, deferredExecutionSearch, runLibraryTitle, runLibrarySubtitle, runLibrarySearchPlaceholder, runLibrarySearchTitle, runLibrarySearchSubtitle, handleCatalogViewModeChange, handleRunLibrarySearchChange } = catalogState;
  const projectsQuery = useQuery({
    queryKey: ["projects", "workspace-scopes", JSON.stringify([session?.user.id, session?.user.role, session?.user.role_id, session?.user.status, session?.user.permissions, session?.user.workspace_permissions, session?.user.project_permissions])],
    queryFn: ({ signal }) => api.metadata.workspaceScopes({ signal }),
    select: (data) => data.projects,
    enabled: can("workspace.view")
  });
  const projectMembersQuery = optionalQueryView(useQuery({
    queryKey: ["project-members", projectId],
    queryFn: () => api.projectMembers.list({ project_id: projectId }),
    enabled: (can("project_member.view")) && Boolean(projectId && session)
  }), can("project_member.view"));
  const selectedExecutionQuery = useQuery({
    queryKey: ["execution", selectedExecutionId, projectId],
    queryFn: () => api.executions.get(selectedExecutionId),
    enabled: (can("run.view")) && Boolean(selectedExecutionId),
    refetchInterval: (query) => {
      const execution = query.state.data as Execution | undefined;
      return execution && ["queued", "running"].includes(String(execution.status).toLowerCase())
        ? EXECUTION_POLL_INTERVAL_MS
        : false;
    }
  });
  const appTypesQuery = useQuery({
    queryKey: ["app-types", projectId],
    queryFn: () => api.appTypes.list({ project_id: projectId }),
    enabled: (can("app_type.view")) && Boolean(projectId)
  });
  const requirementsQuery = optionalQueryView(useQuery({
    queryKey: ["requirements", projectId],
    queryFn: ({ signal }) => api.requirements.list({ project_id: projectId }, { signal }),
    enabled: (can("requirement.view")) && Boolean(projectId && (selectedExecutionId || (isCreateExecutionModalOpen && (executionCreateMode === "smart" || pendingNavigationDelivery)))),
    staleTime: 60_000
  }), can("requirement.view"));
  const shouldLoadExecutionDeliveryScope = Boolean(
    projectId
    && (isCreateExecutionModalOpen || isCreateScheduleModalOpen || hasCreateExecutionDeepLink)
  );
  const executionDomainMetadataQuery = useQuery({
    queryKey: ["domain-metadata", "execution-builder", projectId],
    queryFn: api.metadata.domain,
    enabled: shouldLoadExecutionDeliveryScope,
    staleTime: 10 * 60 * 1000
  });
  const executionReleasesQuery = optionalQueryView(useQuery({
    queryKey: ["requirement-releases", projectId],
    queryFn: () => api.requirementReleases.list({ project_id: projectId }),
    enabled: (canViewDeliveryScopes) && shouldLoadExecutionDeliveryScope && canViewDeliveryScopes,
    staleTime: 30_000
  }), canViewDeliveryScopes);
  const executionIterationsQuery = optionalQueryView(useQuery({
    queryKey: ["requirement-iterations", projectId],
    queryFn: () => api.requirementIterations.list({ project_id: projectId }),
    enabled: (canViewDeliveryScopes) && shouldLoadExecutionDeliveryScope && canViewDeliveryScopes,
    staleTime: 30_000
  }), canViewDeliveryScopes);
  const bugsQuery = optionalQueryView(useQuery({
    queryKey: ["execution-bugs", projectId],
    queryFn: () => api.issues.list({ project_id: projectId, page_size: 100, projection: "detail" }),
    enabled: (can("feedback.view")) && Boolean(projectId && selectedExecutionId)
  }), can("feedback.view"));
  const runPickerCaseIds = useMemo(() => [
    ...(isCreateExecutionModalOpen ? asArray(smartExecutionPreview?.cases).map(item => item.test_case_id) : []),
    ...(selectedTestCaseId ? [selectedTestCaseId] : []),
    ...asArray(executionSchedulesQuery.data).filter(schedule => schedule.id === selectedScheduleId).flatMap(schedule => schedule.test_case_ids || [])
  ], [executionSchedulesQuery.data, isCreateExecutionModalOpen, selectedScheduleId, selectedTestCaseId, smartExecutionPreview]);
  const runPickerBatches = useMemo(() => runPickerIdBatches(runPickerCaseIds), [runPickerCaseIds]);
  const runPickerCaseQueries = useQueries({ queries: runPickerBatches.map(ids => ({
    queryKey: ["run-picker-cases", projectId, appTypeId, ids],
    queryFn: ({ signal }: { signal: AbortSignal }) => loadRunPickerCaseBatch(ids, query => api.testCases.listPicker({ project_id: projectId, app_type_id: appTypeId, ...query }, { signal })),
    enabled: Boolean(projectId && appTypeId && can("testcase.view")),
    staleTime: 60_000,
    refetchOnWindowFocus: false
  })) });
  const scopedSuitesQuery = optionalQueryView(useQuery({
    queryKey: ["execution-suites", appTypeId, projectId, testRunsView === "scheduled-runs" ? "detail" : "picker"],
    queryFn: () => api.testSuites.list({ project_id: projectId, app_type_id: appTypeId, projection: testRunsView === "scheduled-runs" ? undefined : "picker" }),
    enabled: (can("suite.view")) && Boolean(appTypeId && (isCreateExecutionModalOpen || isCreateScheduleModalOpen || testRunsView === "scheduled-runs")),
    staleTime: 60_000
  }), can("suite.view"));
  const executionResultsQuery = optionalQueryView(useQuery({
    queryKey: ["execution-results", selectedExecutionId, projectId],
    queryFn: ({ signal }) => api.executionResults.list({ execution_id: selectedExecutionId }, { signal }),
    enabled: (can("result.view")) && Boolean(selectedExecutionId),
    refetchInterval: () => ["queued", "running", "retrying"].includes(String(selectedExecutionQuery.data?.status || ""))
      ? EXECUTION_POLL_INTERVAL_MS
      : false
  }), can("result.view"));
  // Completion may arrive between the run poll and the result poll. Fetch the final
  // step statuses/evidence once more before polling stops on a terminal run.
  useEffect(() => {
    if (selectedExecutionId && ["completed", "failed", "cancelled", "stopped"].includes(String(selectedExecutionQuery.data?.status || ""))) {
      void queryClient.invalidateQueries({ queryKey: ["execution-results", selectedExecutionId, projectId], exact: true });
    }
  }, [selectedExecutionId, projectId, selectedExecutionQuery.data?.status, queryClient]);
  useEffect(() => {
    // Fetch the final outcomes once when a run finishes before stopping polling.
    const status = selectedExecutionQuery.data?.status;
    if (selectedExecutionId && status && !["queued", "running", "retrying"].includes(status)) {
      void queryClient.invalidateQueries({ queryKey: ["execution-results", selectedExecutionId, projectId], exact: true });
    }
  }, [selectedExecutionId, selectedExecutionQuery.data?.status, projectId, queryClient]);
  const integrationsQuery = optionalQueryView(useQuery({
    queryKey: ["integrations", "llm", projectId],
    queryFn: () => api.integrations.list({ type: "llm", is_active: true }),
    enabled: (can("integration.view") && canUseRunAi) && Boolean(session)
  }), can("integration.view") && canUseRunAi);
  const testEngineIntegrationsQuery = optionalQueryView(useQuery({
    queryKey: ["integrations", "testengine", projectId],
    queryFn: () => api.integrations.list({ type: "testengine", is_active: true }),
    enabled: (can("integration.view") && (canRunLocalAutomation || canRunRemoteAutomation)) && Boolean(session)
  }), can("integration.view") && (canRunLocalAutomation || canRunRemoteAutomation));
  const selectedWorkspaceTransactionEventsQuery = useQuery({
    queryKey: ["workspace-transaction-events", selectedOperationId, projectId],
    queryFn: () => api.workspaceTransactions.events(selectedOperationId),
    enabled: Boolean(selectedOperationId && session),
    refetchInterval: (query) => {
      const events = query.state.data as Array<{ status?: string }> | undefined;
      return events?.some((event) => ["queued", "running", "processing"].includes(String(event.status).toLowerCase()))
        ? EXECUTION_POLL_INTERVAL_MS
        : false;
    }
  });

  const createExecution = useMutation({ mutationFn: api.executions.create });
  const updateExecutionAssignment = useMutation({
    mutationFn: ({ id, assigned_to_ids }: { id: string; assigned_to_ids: string[] }) => api.executions.update(id, { assigned_to_ids })
  });
  const updateExecutionCaseAssignment = useMutation({
    mutationFn: ({ executionId, testCaseId, assigned_to }: { executionId: string; testCaseId: string; assigned_to?: string }) =>
      api.executions.updateCaseAssignment(executionId, testCaseId, { assigned_to })
  });
  const updateExecutionScopeAssignment = useMutation({
    mutationFn: ({ executionId, level, scopeId, assignedToIds }: { executionId: string; level: "suites" | "modules"; scopeId: string; assignedToIds: string[] }) =>
      api.executions.updateScopeAssignment(executionId, level, scopeId, { assigned_to_ids: assignedToIds })
  });
  const createExecutionSchedule = useMutation({ mutationFn: api.executionSchedules.create });
  const updateExecutionSchedule = useMutation({
    mutationFn: ({ id, input }: { id: string; input: Parameters<typeof api.executionSchedules.update>[1] }) =>
      api.executionSchedules.update(id, input)
  });
  const runExecutionSchedule = useMutation({ mutationFn: api.executionSchedules.run });
  const deleteExecutionSchedule = useMutation({ mutationFn: api.executionSchedules.delete });
  const rerunExecution = useMutation({
    mutationFn: ({ id, input }: { id: string; input: Parameters<typeof api.executions.rerun>[1] }) =>
      api.executions.rerun(id, input)
  });
  const previewSmartExecution = useMutation({ mutationFn: api.executions.previewSmartPlan });
  const startExecution = useMutation({
    mutationFn: (input: string | { id: string; options?: Parameters<typeof api.executions.start>[1] }) =>
      typeof input === "string" ? api.executions.start(input) : api.executions.start(input.id, input.options)
  });
  const attachNetworkAutomationToCase = useMutation({
    mutationFn: ({ testCaseId, network }: { testCaseId: string; network: NonNullable<ExecutionStepWebDetail["network"]> }) =>
      api.testCases.buildAutomation(testCaseId, {
        ai_feature: "ai.execution.network_to_api_steps",
        captured_actions: [],
        captured_network: network
      })
  });
  const completeExecution = useMutation({
    mutationFn: ({ id, status }: { id: string; status: "completed" | "failed" | "aborted" }) => api.executions.complete(id, { status })
  });
  const runExecutionApiStep = useMutation({
    mutationFn: ({ executionId, testCaseId, stepId, dataSetIterationIndex }: { executionId: string; testCaseId: string; stepId: string; dataSetIterationIndex?: number }) =>
      api.executions.runApiStep(executionId, testCaseId, stepId, { data_set_iteration_index: dataSetIterationIndex })
  });
  const runExecutionAiAnalysis = useMutation({
    mutationFn: ({ executionId, testCaseId, instruction, interactionMode }: { executionId: string; testCaseId: string; instruction?: string; interactionMode?: "chat" | "agent" }) =>
      api.executions.analyzeCase(executionId, testCaseId, { instruction, interaction_mode: interactionMode })
  });
  const previewExecutionFailureClusters = useMutation({
    mutationFn: ({ executionId, input }: { executionId: string; input: Parameters<typeof api.executions.previewFailureClusters>[1] }) =>
      api.executions.previewFailureClusters(executionId, input)
  });
  const downloadExecutionReport = useMutation({
    mutationFn: (executionId: string) => api.executions.downloadReportPdf(executionId)
  });
  const downloadExecutionCaseReport = useMutation({
    mutationFn: ({ executionId, testCaseId }: { executionId: string; testCaseId: string }) =>
      api.executions.downloadCaseReportPdf(executionId, testCaseId)
  });
  const shareExecutionReport = useMutation({
    mutationFn: ({ executionId, recipients }: { executionId: string; recipients: string[] }) =>
      api.executions.shareReport(executionId, { recipients })
  });
  const shareExecutionCaseReport = useMutation({
    mutationFn: ({ executionId, testCaseId, recipients }: { executionId: string; testCaseId: string; recipients: string[] }) =>
      api.executions.shareCaseReport(executionId, testCaseId, { recipients })
  });

  const projects = asArray(projectsQuery.data);
  const projectMembers = asArray(projectMembersQuery.data);
  const appTypes = asArray(appTypesQuery.data);
  const requirements = asArray(requirementsQuery.data);
  const executionReleases = asArray<RequirementRelease>(executionReleasesQuery.data);
  const executionIterations = asArray<RequirementIteration>(executionIterationsQuery.data);
  const nativeExecutionDeliveryScope = () => {
    if (!canViewDeliveryScopes) return {};
    const normalized = (value?: string | null) => String(value || "").trim().toLowerCase();
    const releases = executionReleases.filter(item => item.project_id === projectId && executionRelease.trim()
      && (normalized(item.fix_version) === normalized(executionRelease) || normalized(item.name) === normalized(executionRelease)));
    const sprints = executionIterations.filter(item => item.project_id === projectId && executionSprint.trim()
      && normalized(item.name) === normalized(executionSprint));
    return { release_id: releases.length === 1 ? releases[0].id : undefined, iteration_id: sprints.length === 1 ? sprints[0].id : undefined };
  };
  const bugs = asArray<Issue>(bugsQuery.data);
  const runPickerDataRevision = runPickerCaseQueries.map(query => query.dataUpdatedAt).join(":");
  const smartExecutionLibraryCases = useMemo(() => can("testcase.view") ? runPickerCaseQueries.flatMap(query => asArray(query.data)) : [], [can, projectId, appTypeId, runPickerBatches, runPickerDataRevision]);
  const scopeSuites = asArray(scopedSuitesQuery.data);
  const executionPickerMetadataByCaseId = useMemo<SuitePickerMetadataByCaseId>(() => ({}), []);
  const executionResults = asArray(executionResultsQuery.data);
  const integrations = useMemo(
    () => asArray(integrationsQuery.data).filter((integration) => !isRovoIntegrationId(integration.id)),
    [integrationsQuery.data]
  );
  const testEngineIntegrations = asArray(testEngineIntegrationsQuery.data);
  const selectedProject = projects.find((project) => String(project.id) === String(projectId)) || null;
  const selectedAppType = appTypes.find((appType) => appType.id === appTypeId) || null;
  const { releaseOptions: executionReleaseOptions, sprintOptions: executionSprintOptions } = useMemo(
    () => buildDeliveryScopeOptions({
      releases: executionReleases,
      iterations: executionIterations,
      jiraVersions: executionDomainMetadataQuery.data?.jira?.versions,
      jiraSprints: executionDomainMetadataQuery.data?.jira?.sprints,
      currentRelease: executionRelease,
      currentSprint: executionSprint
    }),
    [
      executionDomainMetadataQuery.data?.jira?.sprints,
      executionDomainMetadataQuery.data?.jira?.versions,
      executionIterations,
      executionRelease,
      executionReleases,
      executionSprint
    ]
  );
  const smartExecutionBuildOptions = useMemo(
    () => [...new Set(executions.map((execution) => execution.build).filter((value): value is string => Boolean(value)))],
    [executions]
  );
  const assigneeOptions = useMemo<ExecutionAssigneeOption[]>(
    () => buildAssigneeOptions(projectMembers),
    [projectMembers]
  );
  const projectNameById = useMemo(
    () =>
      projects.reduce<Record<string, string>>((accumulator, project) => {
        accumulator[project.id] = project.name;
        return accumulator;
      }, {}),
    [projects]
  );
  const appTypeNameById = useMemo(
    () =>
      appTypes.reduce<Record<string, string>>((accumulator, appType) => {
        accumulator[appType.id] = appType.name;
        return accumulator;
      }, {}),
    [appTypes]
  );
  const catalogController = useExecutionCatalogController({ data: catalogData, state: catalogState, testRunsView, selectedOperationId, projectNameById, appTypeNameById });
  const { filteredWorkspaceTransactions, selectedWorkspaceTransaction, executionStatusOptions, executionIdsWithEvidence, filteredExecutions, activeExecutionCatalogRows, availableExecutionCatalogRows, filteredSchedules, runCatalogMetricCards, isRunCatalogMetricLoading, visibleRunLibraryIds, selectedRunLibraryActionIds, areAllFilteredRunLibraryItemsSelected, activeExecutionFilterCount, executionCardMeasureTarget } = catalogController;
  const smartExecutionLibraryCaseById = useMemo(
    () => new Map(smartExecutionLibraryCases.map((testCase) => [testCase.id, testCase])),
    [smartExecutionLibraryCases]
  );
  const requirementById = useMemo(
    () => new Map(requirements.map((requirement) => [requirement.id, requirement])),
    [requirements]
  );
  const smartExecutionRequirementOptions = useMemo<SmartExecutionRequirementOption[]>(() => requirements
    .map(requirement => ({
      id: requirement.id,
      title: requirement.title,
      description: requirement.description,
      linkedCaseCount: requirement.catalog_metrics?.linked_cases ?? new Set(requirement.test_case_ids || []).size
    }))
    .filter(requirement => requirement.linkedCaseCount > 0)
    .sort((left, right) => right.linkedCaseCount - left.linkedCaseCount || left.title.localeCompare(right.title)),
  [requirements]);

  useEffect(() => {
    if (testRunsView !== "batch-process") {
      return;
    }

    if (!selectedOperationId) {
      return;
    }

    if (workspaceTransactions.some((transaction) => transaction.id === selectedOperationId)) {
      return;
    }

    setSelectedOperationId("");
  }, [selectedOperationId, testRunsView, workspaceTransactions]);

  useEffect(() => {
    if (testRunsView !== "scheduled-runs") {
      return;
    }

    if (!selectedScheduleId || executionSchedules.some((schedule) => schedule.id === selectedScheduleId)) {
      return;
    }

    setSelectedScheduleId("");
  }, [executionSchedules, selectedScheduleId, testRunsView]);

  useEffect(() => {
    if (testRunsView !== "scheduled-runs") {
      return;
    }

    const requestedScheduleId = searchParams.get("schedule") || "";
    if (requestedScheduleId && dismissedScheduleRouteRef.current === `${location.key}:${requestedScheduleId}`) return;
    if (!requestedScheduleId) dismissedScheduleRouteRef.current = "";
    if (
      requestedScheduleId
      && requestedScheduleId !== selectedScheduleId
      && executionSchedules.some((schedule) => schedule.id === requestedScheduleId)
    ) {
      setSelectedScheduleId(requestedScheduleId);
    }
  }, [executionSchedules, searchParams, selectedScheduleId, testRunsView, location.key]);

  useEffect(() => {
    const validRequirementIds = new Set(smartExecutionRequirementOptions.map((requirement) => requirement.id));

    setSelectedSmartRequirementIds((current) => {
      const next = current.filter((requirementId) => validRequirementIds.has(requirementId));

      if (next.length === current.length && next.every((requirementId, index) => requirementId === current[index])) {
        return current;
      }

      return next;
    });
  }, [smartExecutionRequirementOptions]);

  const showSuccess = (text: string) => {
    setMessageTone("success");
    setMessage(text);
  };

  const showError = (error: unknown, fallback: string) => {
    setMessageTone("error");
    setMessage(error instanceof Error ? error.message : fallback);
  };

  const buildSmartExecutionScopeKey = () => JSON.stringify({
    project_id: projectId,
    app_type_id: appTypeId,
    integration_id: smartExecutionIntegrationId,
    release: executionRelease.trim(),
    sprint: executionSprint.trim(),
    build: executionBuild.trim(),
    scope_description: smartExecutionReleaseScope.trim(),
    additional_context: smartExecutionAdditionalContext,
    reference_images: smartExecutionImages.map(image=>image.url),
    impacted_requirement_ids: [...selectedSmartRequirementIds].sort(),
    test_environment_id: selectedExecutionEnvironmentId,
    test_configuration_id: selectedExecutionConfigurationId,
    test_data_set_id: selectedExecutionDataSetId
  });

  const resetSmartExecutionPreview = useCallback(() => {
    smartExecutionPreviewRequestRef.current += 1;
    setSmartExecutionPreview(null);
    setSelectedSmartExecutionCaseIds([]);
    setSmartExecutionPreviewMessage("");
    setSmartExecutionPreviewTone("success");
    setSmartExecutionPreviewScopeKey("");
  }, []);

  const closeCreateExecutionModal = () => {
    setIsCreateExecutionModalOpen(false);
  };

  const resetExecutionContextSelection = useCallback(() => {
    setSelectedExecutionEnvironmentId("");
    setSelectedExecutionConfigurationId("");
    setSelectedExecutionDataSetId("");
    setSelectedExecutionDataOptions({});
  }, []);

  const resetScheduleBuilder = () => {
    setExecutionName("");
    setSelectedSuiteIds([]);
    setSelectedDirectCaseIds([]);
    setResolvedDirectCases([]);
    setSelectedExecutionAssigneeIds([]);
    setExecutionRelease("");
    setExecutionSprint("");
    setExecutionBuild("");
    setScheduleCadence("weekly");
    setScheduleIntervalMinutes(5);
    setScheduleNextRunAt("");
    setEditingScheduleId("");
    setScheduleModalMode("create");
    resetExecutionContextSelection();
  };

  const resetSmartExecutionBuilder = () => {
    setExecutionCreateMode("manual");
    setSelectedExecutionAssigneeIds([]);
    setExecutionRelease("");
    setExecutionSprint("");
    setExecutionBuild("");
    setSmartExecutionIntegrationId("");
    setSmartExecutionReleaseScope("");
    setSmartExecutionAdditionalContext("");
    setSmartExecutionImages([]);
    setSmartExecutionImagesBusy(false);
    setSelectedSmartRequirementIds([]);
    setSmartExecutionRequirementSearch("");
    resetSmartExecutionPreview();
  };

  const closeExecutionBuilder = () => {
    navigationRunScopeRef.current = null;
    clearCreateExecutionDeepLink();
    setPendingNavigationDelivery(null);
    smartExecutionBuilderSessionRef.current += 1;
    closeCreateExecutionModal();
    setSelectedDirectCaseIds([]);
    setResolvedDirectCases([]);
    setExecutionName("");
    setExecutionStartDate("");
    setExecutionEndDate("");
    setExecutionStartMode("manual");
    setExecutionParallelEnabled(false);
    setExecutionParallelCount(1);
    setExecutionHookDraft(emptyExecutionHookDraft());
    setSelectedExecutionAssigneeIds([]);
    setExecutionRelease("");
    setExecutionSprint("");
    setExecutionBuild("");
    resetExecutionContextSelection();
    resetSmartExecutionBuilder();
  };

	  const openExecutionBuilder = (mode: ExecutionStartMode = "manual") => {
	    const hasModeAccess = mode === "local"
	      ? canRunLocalAutomation
	      : mode === "remote"
	        ? canRunRemoteAutomation
	        : canCreateManualRuns;

	    if (!hasModeAccess) {
	      showError(
	        new Error(
	          mode === "local"
	            ? "Permission required: automation.run.local"
	            : mode === "remote"
	              ? "Permission required: automation.run.remote"
	              : "Permission required: run.create"
	        ),
	        "Unable to open run builder"
	      );
	      return;
	    }

	    smartExecutionBuilderSessionRef.current += 1;
	    resetSmartExecutionPreview();
	    setExecutionStartMode(mode);
	    setIsCreateExecutionModalOpen(true);
	  };

  const closeScheduleBuilder = () => {
    setIsCreateScheduleModalOpen(false);
    resetScheduleBuilder();
  };

  const openCreateScheduleBuilder = () => {
    if (!canCreateSchedules) {
      showError(new Error("Permission required: schedule.create"), "Unable to create schedule");
      return;
    }

    resetScheduleBuilder();
    const nextHour = new Date();
    nextHour.setMinutes(0, 0, 0);
    nextHour.setHours(nextHour.getHours() + 1);
    setScheduleNextRunAt(toDateTimeLocalValue(nextHour.toISOString()));

    setScheduleModalMode("create");
    setIsCreateScheduleModalOpen(true);
  };

  useEffect(() => {
    if (searchParams.get("create_plan") !== "1" || !canCreateSchedules || !projectId || testRunsView !== "scheduled-runs") return;
    openCreateScheduleBuilder();
    setSearchParams(current => { const next = new URLSearchParams(current); next.delete("create_plan"); return next; }, {replace:true});
  }, [searchParams, canCreateSchedules, projectId, testRunsView]);

  const openEditScheduleBuilder = (schedule: ExecutionSchedule) => {
    if (!canUpdateSchedules) {
      showError(new Error("Permission required: schedule.update"), "Unable to edit schedule");
      return;
    }

    setScheduleModalMode("edit");
    setEditingScheduleId(schedule.id);
    setExecutionName(schedule.name || "");
    setSelectedSuiteIds(schedule.suite_ids || []);
    setSelectedExecutionEnvironmentId(schedule.test_environment_id || "");
    setSelectedExecutionConfigurationId(schedule.test_configuration_id || "");
    setSelectedExecutionDataSetId(schedule.test_data_set_id || "");
    setSelectedExecutionDataOptions(schedule.test_data_options || {});
    setSelectedExecutionAssigneeIds(schedule.assigned_to_ids?.length ? schedule.assigned_to_ids : schedule.assigned_to ? [schedule.assigned_to] : []);
    setExecutionRelease(schedule.release || "");
    setExecutionSprint(schedule.sprint || "");
    setExecutionBuild(schedule.build || "");
    setScheduleCadence(
      isIntervalCadence(schedule.cadence)
        ? "interval_minutes"
        : schedule.cadence === "daily" || schedule.cadence === "weekly" || schedule.cadence === "monthly" || schedule.cadence === "once"
          ? schedule.cadence
          : "weekly"
    );
    setScheduleIntervalMinutes(parseIntervalCadenceMinutes(schedule.cadence));
    setScheduleNextRunAt(toDateTimeLocalValue(schedule.next_run_at));
    setIsCreateScheduleModalOpen(true);
  };

  const handleExecutionProjectChange = (value: string) => {
    setSmartExecutionImages([]);
    setSmartExecutionImagesBusy(false);
    navigationRunScopeRef.current = null;
    setPendingNavigationDelivery(null);
    setProjectId(value);
    setSelectedSuiteIds([]);
    setSelectedDirectCaseIds([]);
    setResolvedDirectCases([]);
    setSelectedExecutionAssigneeIds([]);
    setSelectedSmartRequirementIds([]);
    setSmartExecutionRequirementSearch("");
    resetExecutionContextSelection();
    resetSmartExecutionPreview();
  };

  const handleExecutionAppTypeChange = (value: string) => {
    setSmartExecutionImages([]);
    setSmartExecutionImagesBusy(false);
    navigationRunScopeRef.current = null;
    setPendingNavigationDelivery(null);
    setAppTypeId(value);
    setSelectedSuiteIds([]);
    setSelectedDirectCaseIds([]);
    setResolvedDirectCases([]);
    setSelectedSmartRequirementIds([]);
    setSmartExecutionRequirementSearch("");
    resetExecutionContextSelection();
    resetSmartExecutionPreview();
  };

  const handleExecutionEnvironmentChange = (value: string) => {
    setSelectedExecutionEnvironmentId(value);
    resetSmartExecutionPreview();
  };

  const handleExecutionConfigurationChange = (value: string) => {
    setSelectedExecutionConfigurationId(value);
    resetSmartExecutionPreview();
  };

  const handleExecutionDataSetChange = (value: string) => {
    setSelectedExecutionDataSetId(value);
    resetSmartExecutionPreview();
  };

  const handleExecutionReleaseChange = (value: string) => {
    deliveryPrefillEditedRef.current.release = true;
    setExecutionRelease(value);
    resetSmartExecutionPreview();
  };

  const handleExecutionSprintChange = (value: string) => {
    deliveryPrefillEditedRef.current.sprint = true;
    setExecutionSprint(value);
    resetSmartExecutionPreview();
  };

  const handleExecutionBuildChange = (value: string) => {
    setExecutionBuild(value);
    resetSmartExecutionPreview();
  };

  const handleSmartExecutionIntegrationChange = (value: string) => {
    setSmartExecutionIntegrationId(value);
    resetSmartExecutionPreview();
  };

  const handleSmartExecutionReleaseScopeChange = (value: string) => {
    setSmartExecutionReleaseScope(value);
    resetSmartExecutionPreview();
  };

  const handleSmartExecutionAdditionalContextChange = (value: string) => {
    setSmartExecutionAdditionalContext(value);
    resetSmartExecutionPreview();
  };

  useEffect(() => {
    if (!hasCreateExecutionDeepLink) {
      processedCreateExecutionDeepLinkRef.current = "";
      openedCreateExecutionDeepLinkRef.current = "";
      return;
    }

    const requestedProjectId = createRunNavigation?.projectId || String(searchParams.get("project") || "").trim();
    const requestedReleaseId = String(searchParams.get("release_id") || "").trim();
    const requestedReleaseToken = createRunNavigation?.release || String(searchParams.get("release") || "").trim();
    const requestedSprintId = String(searchParams.get("sprint_id") || "").trim();
    const requestedSprintToken = createRunNavigation?.sprint || String(searchParams.get("sprint") || "").trim();
    const requestedModeToken = String(searchParams.get("mode") || "manual").trim().toLowerCase();
    const requestedMode: ExecutionStartMode = requestedModeToken === "local" || requestedModeToken === "remote"
      ? requestedModeToken
      : "manual";
    const deepLinkSignature = [
      location.key,
      requestedProjectId,
      requestedReleaseId,
      requestedReleaseToken,
      requestedSprintId,
      requestedSprintToken,
      requestedMode,
      createRunNavigation?.appTypeId || ""
    ].join("\u0000");

    if (processedCreateExecutionDeepLinkRef.current === deepLinkSignature) return;
    if (featureFlagsQuery.isPending || isCapabilityAccessLoading) return;
    if (projectsQuery.isPending && (!projectId || (requestedProjectId && requestedProjectId !== projectId)) && can("workspace.view")) return;

    if (requestedProjectId && requestedProjectId !== projectId) {
      if (!projects.some((project) => String(project.id) === requestedProjectId)) {
        processedCreateExecutionDeepLinkRef.current = deepLinkSignature;
        setMessageTone("error");
        setMessage("The requested project is unavailable. Select an accessible project before creating this run.");
        clearCreateExecutionDeepLink();
        return;
      }

      handleExecutionProjectChange(requestedProjectId);
      return;
    }

    if (!projectId) {
      const fallbackProjectId = requestedProjectId || String(projects[0]?.id || "");
      if (!fallbackProjectId) return;
      handleExecutionProjectChange(fallbackProjectId);
      return;
    }

    if (createRunNavigation && openedCreateExecutionDeepLinkRef.current !== deepLinkSignature) {
      const isCurrentScope = createRunNavigation.projectId === projectId && createRunNavigation.appTypeId === appTypeId;
      if (!isCurrentScope && appTypesQuery.isPending && can("app_type.view")) return;
      const requestedApp = appTypes.find(item => item.id === createRunNavigation.appTypeId && item.project_id === projectId);
      if ((!requestedApp && !isCurrentScope) || !can("testcase.view")) {
        processedCreateExecutionDeepLinkRef.current = deepLinkSignature;
        setMessageTone("error");
        setMessage(!requestedApp ? "The requested application is unavailable. Select an accessible application before creating this run." : "Permission required: testcase.view");
        clearCreateExecutionDeepLink();
        return;
      }
      if (requestedApp && appTypeId !== requestedApp.id) {
        handleExecutionAppTypeChange(requestedApp.id);
        return;
      }
    }

    const deliveryScopePrefill = resolveDeliveryScopePrefill({
      releaseId: requestedReleaseId,
      releaseToken: requestedReleaseToken,
      sprintId: requestedSprintId,
      sprintToken: requestedSprintToken
    }, {
      releases: executionReleases,
      iterations: executionIterations,
      jiraVersions: executionDomainMetadataQuery.data?.jira?.versions,
      jiraSprints: executionDomainMetadataQuery.data?.jira?.sprints
    });
    const deliveryScopeCatalogsPending = (canViewDeliveryScopes && (
      executionReleasesQuery.isPending
      || executionIterationsQuery.isPending
    ))
      || executionDomainMetadataQuery.isPending;
    const wasOpened = openedCreateExecutionDeepLinkRef.current === deepLinkSignature;
    if (!wasOpened) {
      const hasModeAccess = requestedMode === "local" ? canRunLocalAutomation : requestedMode === "remote" ? canRunRemoteAutomation : canCreateManualRuns;
      if (!hasModeAccess) {
        processedCreateExecutionDeepLinkRef.current = deepLinkSignature;
        openExecutionBuilder(requestedMode);
        clearCreateExecutionDeepLink();
        return;
      }
      openedCreateExecutionDeepLinkRef.current = deepLinkSignature;
      deliveryPrefillEditedRef.current = { release: false, sprint: false };
      setExecutionCreateMode("manual");
      if (createRunNavigation) {
        navigationRunScopeRef.current = { projectId, appTypeId };
        setSelectedSuiteIds([]);
        setSelectedDirectCaseIds(createRunNavigation.testCaseIds);
        setResolvedDirectCases([]);
        setDirectCaseResolution(null);
        setExecutionName("");
        setExecutionStartDate("");
        setExecutionEndDate("");
        setExecutionBuild("");
        setExecutionHookDraft(emptyExecutionHookDraft());
        setExecutionParallelEnabled(false);
        setExecutionParallelCount(1);
        setSelectedExecutionAssigneeIds([]);
        resetExecutionContextSelection();
        setPendingNavigationDelivery(canViewDeliveryScopes && can("requirement.view") && (!createRunNavigation.release || !createRunNavigation.sprint) ? createRunNavigation : null);
      }
      setExecutionRelease(requestedReleaseToken);
      setExecutionSprint(requestedSprintToken);
      openExecutionBuilder(requestedMode);
    }
    if (deliveryScopeCatalogsPending && (deliveryScopePrefill.unresolvedReleaseId || deliveryScopePrefill.unresolvedSprintId)) return;

    processedCreateExecutionDeepLinkRef.current = deepLinkSignature;
    if (!deliveryPrefillEditedRef.current.release) setExecutionRelease(deliveryScopePrefill.release);
    if (!deliveryPrefillEditedRef.current.sprint) setExecutionSprint(deliveryScopePrefill.sprint);
    clearCreateExecutionDeepLink();
  }, [
    appTypeId,
    appTypes,
    appTypesQuery.isPending,
    can,
    canCreateManualRuns,
    canRunLocalAutomation,
    canRunRemoteAutomation,
    clearCreateExecutionDeepLink,
    createRunNavigation,
    location.key,
    executionDomainMetadataQuery.data?.jira?.sprints,
    executionDomainMetadataQuery.data?.jira?.versions,
    executionDomainMetadataQuery.isPending,
    executionIterations,
    executionIterationsQuery.isPending,
    executionReleases,
    executionReleasesQuery.isPending,
    canViewDeliveryScopes,
    featureFlagsQuery.isPending,
    hasCreateExecutionDeepLink,
    isCapabilityAccessLoading,
    projectId,
    projects,
    projectsQuery.isPending,
    searchParams,
    setProjectId,
    setSearchParams
  ]);

  useEffect(() => {
    if (!pendingNavigationDelivery) return;
    if (!isCreateExecutionModalOpen || pendingNavigationDelivery.projectId !== projectId || pendingNavigationDelivery.appTypeId !== appTypeId
      || !canViewDeliveryScopes || !can("requirement.view") || !selectedDirectCaseIds.length) {
      setPendingNavigationDelivery(null);
      return;
    }
    const selectionReadiness = createRunSelectionReadiness(selectedDirectCaseIds, resolvedDirectCases, directCaseResolution);
    if (selectionReadiness === "unavailable") {
      setPendingNavigationDelivery(null);
      setMessageTone("error");
      setMessage("Some selected cases could not be loaded. Retry the selection lookup or configure Release and Sprint manually.");
      return;
    }
    const requiredQueries = [requirementsQuery, executionReleasesQuery, executionIterationsQuery];
    const failed = requiredQueries.find(query => query.isError && !query.data);
    if (failed) {
      setPendingNavigationDelivery(null);
      showError(failed.error, "Some run options could not be filled automatically. You can continue configuring this run.");
      return;
    }
    if (requiredQueries.some(query => !query.data) || selectionReadiness === "pending") return;
    const derived = deriveCreateRunDelivery(selectedDirectCaseIds, resolvedDirectCases, requirements, executionReleases, executionIterations);
    const updates = createRunDeliveryUpdates(pendingNavigationDelivery, deliveryPrefillEditedRef.current, derived);
    if (updates.release !== undefined) setExecutionRelease(updates.release);
    if (updates.sprint !== undefined) setExecutionSprint(updates.sprint);
    setPendingNavigationDelivery(null);
  }, [appTypeId, can, canViewDeliveryScopes, directCaseResolution, executionIterations, executionIterationsQuery.data, executionIterationsQuery.isError,
    executionReleases, executionReleasesQuery.data, executionReleasesQuery.isError, isCreateExecutionModalOpen, pendingNavigationDelivery,
    projectId, requirements, requirementsQuery.data, requirementsQuery.isError, resolvedDirectCases, selectedDirectCaseIds]);

  const handleToggleSmartExecutionRequirement = (requirementId: string) => {
    setSelectedSmartRequirementIds((current) =>
      current.includes(requirementId) ? current.filter((id) => id !== requirementId) : [...current, requirementId]
    );
    resetSmartExecutionPreview();
  };

  const handleClearSmartExecutionRequirements = () => {
    setSelectedSmartRequirementIds([]);
    resetSmartExecutionPreview();
  };

  const handleSelectSmartExecutionRequirements = (requirementIds: string[]) => {
    setSelectedSmartRequirementIds(requirementIds);
    resetSmartExecutionPreview();
  };

  useEffect(() => {
    if (isCreateExecutionModalOpen && navigationRunScopeRef.current?.projectId === projectId && navigationRunScopeRef.current.appTypeId === appTypeId) return;
    if (appTypesQuery.isPending || (hasCreateExecutionDeepLink && createRunNavigation)) {
      return;
    }

    const scopedAppTypes = projectId
      ? appTypes.filter((item) => String(item.project_id) === String(projectId))
      : appTypes;

    if (projectId && appTypes.length && !scopedAppTypes.length) {
      return;
    }

    if (!scopedAppTypes.length) {
      setAppTypeId("");
      setSelectedSuiteIds([]);
    setSelectedDirectCaseIds([]);
    setResolvedDirectCases([]);
      resetExecutionContextSelection();
      resetSmartExecutionPreview();
      return;
    }

    if (!scopedAppTypes.some((item) => item.id === appTypeId)) {
      setAppTypeId(scopedAppTypes[0].id);
      setSelectedSuiteIds([]);
    setSelectedDirectCaseIds([]);
    setResolvedDirectCases([]);
      resetExecutionContextSelection();
      resetSmartExecutionPreview();
    }
  }, [appTypeId, appTypes, appTypesQuery.isPending, createRunNavigation, hasCreateExecutionDeepLink, isCreateExecutionModalOpen, projectId, resetExecutionContextSelection, resetSmartExecutionPreview, setAppTypeId]);

  useEffect(() => {
    if (projectMembersQuery.isPending) {
      return;
    }

    const validAssigneeIds = new Set(assigneeOptions.map((option) => option.id));
    if (selectedExecutionAssigneeIds.some((assigneeId) => !validAssigneeIds.has(assigneeId))) {
      setSelectedExecutionAssigneeIds((current) => current.filter((assigneeId) => validAssigneeIds.has(assigneeId)));
    }
  }, [assigneeOptions, projectMembersQuery.isPending, selectedExecutionAssigneeIds]);

  useEffect(() => {
    if (projectMembersQuery.isPending) {
      return;
    }

    const validAssigneeIds = new Set(assigneeOptions.map((option) => option.id));
    if (executionAssignmentDraftIds.some((assigneeId) => !validAssigneeIds.has(assigneeId))) {
      setExecutionAssignmentDraftIds((current) => current.filter((assigneeId) => validAssigneeIds.has(assigneeId)));
    }

    if (caseAssignmentDraft && !assigneeOptions.some((option) => option.id === caseAssignmentDraft)) {
      setCaseAssignmentDraft("");
    }
  }, [assigneeOptions, caseAssignmentDraft, executionAssignmentDraftIds, projectMembersQuery.isPending]);

  const { syncExecutionSearchParams, focusExecution, focusExecutionSchedule, closeExecutionScheduleDetail, closeExecutionDrilldown, closeCaseDrilldown, toggleSuiteGroup } = useExecutionRouteNavigation({ router: { searchParams, setSearchParams, location, navigate }, selection: { dismissedExecutionRouteRef, dismissedCaseRouteRef, setSelectedExecutionId, setFocusedSuiteId, setSelectedTestCaseId, setSelectedCaseInstanceKey, dismissedScheduleRouteRef, setTestRunsView, setSelectedScheduleId, selectedExecutionQuery, testRunsView, selectedExecutionId, selectedScheduleId, selectedOperationId, setSelectedOperationId, selectedTestCaseId, setExpandedExecutionSuiteIds }, access: { featureFlagsQuery, canRunLocalAutomation }, scope: { executions, executionsQuery, availableExecutionCatalogRows } });

  const selectedExecution = selectedExecutionQuery.data || executions.find((execution) => execution.id === selectedExecutionId) || null;
  const selectedRunAnalysisOperation = runAnalysisOperations[selectedExecution?.id || ""] || null;
  const isSelectedRunAnalysisPending = selectedRunAnalysisOperation?.status === "running";
  const selectedSchedule = executionSchedules.find((schedule) => schedule.id === selectedScheduleId) || null;
  const selectedExecutionSuiteIds = asArray(selectedExecution?.suite_ids);
  const selectedExecutionSuites = asArray(selectedExecution?.suite_snapshots);
  const currentExecutionStatus = normalizeExecutionStatus(selectedExecution?.status);
  const selectedExecutionStartMode = selectedExecution?.run_mode || (selectedExecution?.trigger === "local" ? "local" : selectedExecution?.trigger === "ci" ? "remote" : "manual");
  const selectedExecutionAppTypeKind = selectedExecution?.app_type_id
    ? appTypes.find((appType) => appType.id === selectedExecution.app_type_id)?.type || null
    : null;
  const isExecutionStarted = currentExecutionStatus === "running";
  const isExecutionLocked = selectedExecution ? isRunFinished(selectedExecution) : false;
  const snapshotCases = useMemo(
    () => ((selectedExecution?.case_snapshots || []).slice().sort((left, right) => left.sort_order - right.sort_order)),
    [selectedExecution?.case_snapshots]
  );
  const snapshotSteps = asArray(selectedExecution?.step_snapshots);
  const hasExecutionLevelTestData = Boolean(selectedExecution?.test_data_set);
  const selectedExecutionCaseSnapshot = useMemo(
    () => snapshotCases.find((snapshot) => snapshot.test_case_id === selectedTestCaseId) || null,
    [selectedTestCaseId, snapshotCases]
  );
  const selectedExecutionCaseInstances = useMemo(
    () => selectedExecutionCaseSnapshot
      ? buildExecutionCaseInstances(selectedExecutionCaseSnapshot, selectedExecution)
      : [],
    [selectedExecution, selectedExecutionCaseSnapshot]
  );
  const selectedExecutionCaseInstance = useMemo(
    () => selectedExecutionCaseInstances.find((instance) => instance.instance_key === selectedCaseInstanceKey)
      || selectedExecutionCaseInstances[0]
      || null,
    [selectedCaseInstanceKey, selectedExecutionCaseInstances]
  );
  const hasSelectedCaseTestData = Boolean(selectedExecutionCaseInstance?.test_data_set_id);
  const selectedCaseLiveView = caseLiveViewSession(selectedExecution, selectedExecutionCaseInstance);
  const executionInputParameterValues = useMemo(
    () => buildExecutionInputParameterValues(selectedExecution, selectedExecutionCaseSnapshot, selectedExecutionCaseInstance),
    [selectedExecution, selectedExecutionCaseInstance, selectedExecutionCaseSnapshot]
  );


  useEffect(() => {
    setExecutionAssignmentDraftIds(selectedExecution?.assigned_to_ids?.length ? selectedExecution.assigned_to_ids : selectedExecution?.assigned_to ? [selectedExecution.assigned_to] : []);
  }, [selectedExecution?.assigned_to, selectedExecution?.assigned_to_ids, selectedExecution?.id]);

  useEffect(() => {
    if (currentExecutionStatus !== "running") {
      setLiveNow(Date.now());
      return;
    }

    const timer = window.setInterval(() => setLiveNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [currentExecutionStatus, selectedExecutionId]);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return;
    }

    const query = window.matchMedia("(pointer: fine) and (min-width: 769px)");
    const sync = () => setSupportsLocalDesktopExecution(query.matches);
    sync();
    query.addEventListener("change", sync);

    return () => query.removeEventListener("change", sync);
  }, []);


  useEffect(() => {
    setExpandedExecutionSuiteIds([]);
    setExpandedExecutionModuleKeys([]);
    setFocusedExecutionModuleId("");
    setInspectedExecutionCaseId("");
    setExecutionSuiteSearch("");
    setExecutionCaseSearch("");
  }, [selectedExecutionId]);

  useEffect(() => {
    if (!selectedExecution) {
      return;
    }

    if (selectedExecution.project_id && selectedExecution.project_id !== projectId) {
      setSelectedExecutionId("");
      setFocusedSuiteId("");
      setSelectedTestCaseId("");
      setSelectedCaseInstanceKey("");
      syncExecutionSearchParams("", null);
      return;
    }

    if (selectedExecution.app_type_id && selectedExecution.app_type_id !== appTypeId) {
      setAppTypeId(selectedExecution.app_type_id);
    }
  }, [appTypeId, projectId, selectedExecution, setProjectId]);

  useEffect(() => {
    setExpandedExecutionStepGroupIds([]);
    setExpandedExecutionStepSections({ preconditions: true, testSteps: true });
  }, [selectedExecutionId, selectedTestCaseId]);

  useEffect(() => {
    setExpandedExecutionStepIds([]);
  }, [selectedExecutionId, selectedTestCaseId]);

  useEffect(() => {
    setIsExecutionAiAnalysisExpanded(false);
  }, [selectedExecutionId, selectedTestCaseId]);

  const executionSuites = useMemo<ExecutionSuiteNode[]>(
    () => selectedExecutionSuites.map((suite) => ({ id: suite.id, name: suite.name })),
    [selectedExecutionSuites]
  );

  const displayCasesBySuiteId = useMemo(() => {
    return snapshotCases.reduce<Record<string, ExecutionCaseView[]>>((groups, snapshot) => {
      const suiteId = snapshot.suite_id || "unsorted";
      groups[suiteId] = groups[suiteId] || [];
      groups[suiteId].push(toCaseView(snapshot, selectedExecution));
      return groups;
    }, {});
  }, [selectedExecution, snapshotCases]);

  const executionCaseOrder = useMemo(
    () => snapshotCases.map((snapshot) => toCaseView(snapshot, selectedExecution)),
    [selectedExecution, snapshotCases]
  );

  const stepsByCaseId = useMemo(() => {
    return snapshotSteps.reduce<Record<string, TestStep[]>>((groups, snapshot) => {
      groups[snapshot.test_case_id] = groups[snapshot.test_case_id] || [];
      groups[snapshot.test_case_id].push(toStepView(snapshot));
      return groups;
    }, {});
  }, [snapshotSteps]);

  const selectedSteps = useMemo(
    () => (stepsByCaseId[selectedTestCaseId] || []).slice().sort((left, right) => left.step_order - right.step_order),
    [selectedTestCaseId, stepsByCaseId]
  );
  const executionPreconditionSteps = useMemo(
    () => selectedSteps.filter((step) => (step.group_name || "").trim().toLowerCase() === "preconditions"),
    [selectedSteps]
  );
  const executionMainSteps = useMemo(
    () => selectedSteps.filter((step) => (step.group_name || "").trim().toLowerCase() !== "preconditions"),
    [selectedSteps]
  );
  const executionStepBlocks = useMemo<ExecutionStepBlock[]>(
    () =>
      executionMainSteps.reduce<ExecutionStepBlock[]>((blocks, step) => {
        const previousBlock = blocks[blocks.length - 1];

        if (step.group_id && previousBlock?.groupId === step.group_id) {
          previousBlock.steps.push(step);
          return blocks;
        }

        blocks.push({
          key: step.group_id ? `group-${step.group_id}` : `step-${step.id}`,
          groupId: step.group_id || null,
          groupName: step.group_name || null,
          groupKind: step.group_kind || null,
          steps: [step]
        });

        return blocks;
      }, []),
    [executionMainSteps]
  );
  const executionStepGroupIds = useMemo(
    () => executionStepBlocks.map((block) => block.groupId).filter((groupId): groupId is string => Boolean(groupId)),
    [executionStepBlocks]
  );

  useEffect(() => {
    setExecutionStepViewMode("structured");
  }, [selectedExecutionId, selectedTestCaseId]);

  useEffect(() => {
    const requestedTestCaseId = searchParams.get("testCase");
    const requestedCaseInstanceKey = searchParams.get("iteration") || "";
    const requestedCaseRoute = `${searchParams.get("execution") || ""}:${requestedTestCaseId || ""}`;
    if (dismissedCaseRouteRef.current) {
      if (requestedCaseRoute === dismissedCaseRouteRef.current) return;
      dismissedCaseRouteRef.current = "";
    }

    if (requestedTestCaseId && executionCaseOrder.some((testCase) => testCase.id === requestedTestCaseId)) {
      const requestedCase = executionCaseOrder.find((testCase) => testCase.id === requestedTestCaseId);
      const requestedSuiteId = requestedCase?.suite_id;

      if (requestedSuiteId) {
        setFocusedSuiteId(requestedSuiteId);
      }

      if (selectedTestCaseId !== requestedTestCaseId) {
        setSelectedTestCaseId(requestedTestCaseId);
      }
      const nextInstanceKey = requestedCase?.data_set_instances.some((instance) => instance.instance_key === requestedCaseInstanceKey)
        ? requestedCaseInstanceKey
        : requestedCase?.data_set_instances[0]?.instance_key || "";
      if (selectedCaseInstanceKey !== nextInstanceKey) {
        setSelectedCaseInstanceKey(nextInstanceKey);
      }
      return;
    }

    if (selectedTestCaseId && executionCaseOrder.some((testCase) => testCase.id === selectedTestCaseId)) {
      const selectedCase = executionCaseOrder.find((testCase) => testCase.id === selectedTestCaseId);
      const selectedSuiteId = selectedCase?.suite_id;
      if (selectedSuiteId && focusedSuiteId !== selectedSuiteId) {
        setFocusedSuiteId(selectedSuiteId);
      }
      if (!selectedCase?.data_set_instances.some((instance) => instance.instance_key === selectedCaseInstanceKey)) {
        setSelectedCaseInstanceKey(selectedCase?.data_set_instances[0]?.instance_key || "");
      }
      return;
    }

    if (selectedTestCaseId) {
      setSelectedTestCaseId("");
    }
    if (selectedCaseInstanceKey) {
      setSelectedCaseInstanceKey("");
    }
  }, [executionCaseOrder, focusedSuiteId, searchParams, selectedCaseInstanceKey, selectedTestCaseId]);

  useEffect(() => {
    if (!executionSuites.length) {
      setFocusedSuiteId("");
      return;
    }

    setFocusedSuiteId((current) => (current && executionSuites.some((suite) => suite.id === current) ? current : ""));
  }, [executionSuites]);

  useEffect(() => {
    const validSuiteIds = new Set(executionSuites.map((suite) => suite.id));
    setExpandedExecutionSuiteIds((current) => {
      const next = current.filter((suiteId) => validSuiteIds.has(suiteId));
      return next.length === current.length ? current : next;
    });
  }, [executionSuites]);

  useEffect(() => {
    if (!selectedExecution || !executionSuites.length) {
      return;
    }

    setExpandedExecutionSuiteIds((current) => current.length ? current : [executionSuites[0].id]);
  }, [executionSuites, selectedExecution]);

  useEffect(() => {
    const requestedSuiteId = searchParams.get("suite") || "";
    if (!requestedSuiteId || !executionSuites.some((suite) => suite.id === requestedSuiteId)) return;
    setFocusedSuiteId(requestedSuiteId);
    setExpandedExecutionSuiteIds((current) => current.includes(requestedSuiteId) ? current : [...current, requestedSuiteId]);
  }, [executionSuites, searchParams]);

  useEffect(() => {
    const validGroupIds = new Set(executionStepGroupIds);
    setExpandedExecutionStepGroupIds((current) => {
      const validCurrent = current.filter((groupId) => validGroupIds.has(groupId));
      if (!current.length && executionStepGroupIds.length) return executionStepGroupIds;
      return validCurrent.length === current.length ? current : validCurrent;
    });
  }, [executionStepGroupIds]);

  useEffect(() => {
    if (!selectedTestCaseId || !focusedSuiteId) {
      return;
    }

    setExpandedExecutionSuiteIds((current) =>
      current.includes(focusedSuiteId) ? current : [...current, focusedSuiteId]
    );
  }, [focusedSuiteId, selectedTestCaseId]);

  useEffect(() => {
    setBulkSelectedStepIds([]);
    setActiveTab("overview");
    closeExecutionEvidence();
    setExecutionApiDetailState(null);
    setRunningExecutionApiStepId("");
  }, [selectedExecutionId, selectedTestCaseId]);

  useEffect(() => {
    setIsExecutionContextModalOpen(false);
  }, [selectedExecutionId]);

  const latestExecutionResults = useMemo(
    () => selectLatestExecutionResultInstances(executionResults),
    [executionResults]
  );
  const resultByCaseInstanceKey = useMemo(() => {
    const map: Record<string, ExecutionResult> = {};
    latestExecutionResults.forEach((result) => {
      const exactKey = executionCaseInstanceKey(
        result.test_case_id,
        result.data_set_iteration_index,
        result.data_set_iteration_key
      );
      const indexKey = executionCaseInstanceKey(
        result.test_case_id,
        result.data_set_iteration_index,
        null
      );
      map[exactKey] = result;
      map[indexKey] = result;
    });
    return map;
  }, [latestExecutionResults]);
  const resultByCaseId = useMemo(() => {
    const map: Record<string, ExecutionResult> = {};
    latestExecutionResults.forEach((result) => {
      const current = map[result.test_case_id];
      if (
        !current
        || (toTimestamp(result.created_at) || 0) > (toTimestamp(current.created_at) || 0)
      ) {
        map[result.test_case_id] = result;
      }
    });
    return map;
  }, [latestExecutionResults]);

  const resultForCaseInstance = (instance?: ExecutionCaseInstanceView | null) =>
    instance
      ? resultByCaseInstanceKey[instance.instance_key]
        || resultByCaseInstanceKey[executionCaseInstanceKey(
          instance.test_case_id,
          instance.data_set_iteration_index,
          null
        )]
        || (resultByCaseId[instance.test_case_id]?.derived && resultByCaseId[instance.test_case_id]?.covers_entire_case
          ? resultByCaseId[instance.test_case_id] : null)
        || null
      : null;

  const instanceDerivedStatus = (instance: ExecutionCaseInstanceView): ExecutionResult["status"] | "queued" =>
    resultForCaseInstance(instance)?.status || "queued";

  const selectedCaseLogs = useMemo(
    () => parseExecutionLogs(resultForCaseInstance(selectedExecutionCaseInstance)?.logs || null),
    [resultByCaseInstanceKey, selectedExecutionCaseInstance]
  );
  const selectedCaseAiAnalysis = selectedCaseLogs.aiAnalysis || null;

  const stepStatuses = selectedCaseLogs.stepStatuses || {};
  const stepNotes = selectedCaseLogs.stepNotes || {};
  const stepEvidence = selectedCaseLogs.stepEvidence || {};
  const stepDefects = selectedCaseLogs.stepDefects || {};
  const stepApiDetails = selectedCaseLogs.stepApiDetails || {};
  const stepWebDetails = selectedCaseLogs.stepWebDetails || {};
  const stepAutomationDetails = selectedCaseLogs.stepAutomationDetails || {};
  const hasSelectedStepAutomationCode = useMemo(
    () =>
      canViewRunAutomationCode && selectedSteps.some((step) =>
        (
          stepAutomationDetails[step.id]?.code
          || step.automation_code
          || (step.step_type === "api" && step.api_request ? resolveStepAutomationCode(step) : "")
        ).trim()
      ),
    [canViewRunAutomationCode, selectedSteps, stepAutomationDetails]
  );
  const stepCaptures = useMemo(
    () => mergeExecutionStepCaptures(selectedCaseLogs.stepCaptures || {}, stepApiDetails),
    [selectedCaseLogs.stepCaptures, stepApiDetails]
  );
  const executionOutputParameterValues = useMemo(
    () => collectExecutionOutputParameterValues(stepCaptures, selectedSteps),
    [selectedSteps, stepCaptures]
  );
  const suiteExecutionOutputParameterValues = useMemo(
    () => collectSuiteScopedExecutionOutputParameterValues(resultByCaseId, snapshotCases, selectedTestCaseId),
    [resultByCaseId, selectedTestCaseId, snapshotCases]
  );

  const executionStepParameterValues = useMemo(
    () => combineStepParameterValues(executionInputParameterValues, suiteExecutionOutputParameterValues, executionOutputParameterValues),
    [executionInputParameterValues, executionOutputParameterValues, suiteExecutionOutputParameterValues]
  );

  const caseDerivedStatus = (testCase: ExecutionCaseView): ExecutionResult["status"] | "queued" => {
    const statuses = testCase.data_set_instances.map(instanceDerivedStatus);
    if (statuses.includes("failed")) return "failed";
    if (statuses.includes("blocked")) return "blocked";
    if (statuses.includes("running")) return "running";
    if (statuses.includes("paused")) return "paused";
    if (statuses.includes("aborted")) return "aborted";
    if (statuses.length && statuses.every((status) => status === "skipped")) return "skipped";
    if (statuses.length && statuses.every((status) => status === "passed" || status === "skipped")) return "passed";
    if (statuses.includes("passed")) return "running";
    return "queued";
  };

  const suiteMetrics = useMemo(() => {
    return executionSuites.map((suite) => {
      const scopedCases = displayCasesBySuiteId[suite.id] || [];
      const scopedInstances = scopedCases.flatMap((testCase) => testCase.data_set_instances);
      const passedCount = scopedInstances.filter((instance) => instanceDerivedStatus(instance) === "passed").length;
      const failedCount = scopedInstances.filter((instance) => instanceDerivedStatus(instance) === "failed").length;
      const blockedCount = scopedInstances.filter((instance) => instanceDerivedStatus(instance) === "blocked").length;
      const runningCount = scopedInstances.filter((instance) => instanceDerivedStatus(instance) === "running").length;
      const pausedCount = scopedInstances.filter((instance) => instanceDerivedStatus(instance) === "paused").length;
      const skippedCount = scopedInstances.filter((instance) => instanceDerivedStatus(instance) === "skipped").length;
      const abortedCount = scopedInstances.filter((instance) => instanceDerivedStatus(instance) === "aborted").length;
      const finalizedCount = scopedInstances.filter((instance) => ["passed", "failed", "blocked", "skipped", "aborted"].includes(instanceDerivedStatus(instance))).length;
      const percent = scopedInstances.length
        ? Math.round((finalizedCount / scopedInstances.length) * 100)
        : 0;

      return {
        suiteId: suite.id,
        count: scopedInstances.length,
        passedCount,
        failedCount,
        blockedCount,
        runningCount, pausedCount, skippedCount, abortedCount, completedCount: finalizedCount,
        percent,
        status: failedCount ? "failed" : runningCount ? "running" : percent === 100 ? "completed" : "queued"
      };
    });
  }, [displayCasesBySuiteId, executionSuites, resultByCaseInstanceKey]);

  const executionProgress = useMemo(() => {
    const executionCaseInstances = executionCaseOrder.flatMap((testCase) => testCase.data_set_instances);
    const totalCases = executionCaseInstances.length;
    const passedCount = executionCaseInstances.filter((instance) => instanceDerivedStatus(instance) === "passed").length;
    const failedCount = executionCaseInstances.filter((instance) => instanceDerivedStatus(instance) === "failed").length;
    const blockedCount = executionCaseInstances.filter((instance) => instanceDerivedStatus(instance) === "blocked").length;
    const runningCount = executionCaseInstances.filter((instance) => instanceDerivedStatus(instance) === "running").length;
    const finalizedCount = executionCaseInstances.filter((instance) => ["passed", "failed", "blocked", "skipped", "aborted"].includes(instanceDerivedStatus(instance))).length;
    const percent = totalCases ? Math.round((finalizedCount / totalCases) * 100) : 0;

    return {
      totalCases,
      passedCount,
      failedCount,
      blockedCount,
      runningCount,
      completedCases: finalizedCount,
      percent,
      derivedStatus: failedCount ? "failed" : runningCount ? "running" : percent === 100 ? "completed" : "queued"
    };
  }, [executionCaseOrder, resultByCaseInstanceKey]);

  const executionStatusCounts = useMemo(() => {
    return executionCaseOrder.flatMap((testCase) => testCase.data_set_instances).reduce(
      (summary, instance) => {
        const status = instanceDerivedStatus(instance);
        summary[status] = (summary[status] || 0) + 1;
        return summary;
      },
      { queued: 0, pending: 0, running: 0, paused: 0, passed: 0, failed: 0, blocked: 0, skipped: 0, aborted: 0 } as Record<string, number>
    );
  }, [executionCaseOrder, resultByCaseInstanceKey]);
  const selectedRunFinalizedCount = executionStatusCounts.passed + executionStatusCounts.failed + executionStatusCounts.blocked + executionStatusCounts.skipped + executionStatusCounts.aborted;
  const selectedRunCompletionPercent = executionProgress.totalCases
    ? Math.round((selectedRunFinalizedCount / executionProgress.totalCases) * 100)
    : 0;
  const selectedRunPassRate = selectedRunFinalizedCount
    ? Math.round((executionStatusCounts.passed / selectedRunFinalizedCount) * 100)
    : null;

  const blockingCases = useMemo(
    () => executionCaseOrder.filter((testCase) => ["failed", "blocked"].includes(caseDerivedStatus(testCase))).slice(0, 8),
    [executionCaseOrder, resultByCaseId]
  );

  const focusedExecutionSuite = useMemo(
    () => executionSuites.find((suite) => suite.id === focusedSuiteId) || null,
    [executionSuites, focusedSuiteId]
  );

  const executionImpactSummaryById = useMemo(() => {
    const resultByExecutionCaseInstance = new Map<string, ExecutionResult>();

    selectLatestExecutionResultInstances(allExecutionResults).forEach((result) => {
      const exactKey = `${result.execution_id}:${executionCaseInstanceKey(result.test_case_id, result.data_set_iteration_index, result.data_set_iteration_key)}`;
      const indexKey = `${result.execution_id}:${executionCaseInstanceKey(result.test_case_id, result.data_set_iteration_index, null)}`;
      resultByExecutionCaseInstance.set(exactKey, result);
      resultByExecutionCaseInstance.set(indexKey, result);
    });

    return executions.map(item => selectedExecution?.id === item.id ? selectedExecution : item).reduce<Record<string, ExecutionRunImpactSummary>>((summary, execution) => {
      const savedRequirementById = new Map(asArray(execution.requirement_snapshots).map(item => [item.id, item]));
      const requirementStats = new Map<string, { totalCases: Set<string>; failedCases: Set<string> }>();
      const failedCases: ExecutionRunImpactSummary["failedCases"] = [];

      const scopedInstances = execution.case_snapshots?.length
        ? execution.case_snapshots.flatMap((snapshot) =>
            buildExecutionCaseInstances(snapshot, execution).map((instance) => ({
              snapshot,
              instance,
              testCaseId: snapshot.test_case_id
            }))
          )
        : (execution.test_case_ids || []).map((testCaseId) => ({ snapshot: null, instance: null, testCaseId }));

      scopedInstances.forEach(({ snapshot, instance, testCaseId }) => {
        const linkedCase = smartExecutionLibraryCaseById.get(testCaseId);
        const requirementIds = [...new Set(Array.isArray(snapshot?.requirement_ids) ? snapshot.requirement_ids : [...(linkedCase?.requirement_ids || []), linkedCase?.requirement_id].filter(Boolean))] as string[];
        const instanceKey = instance?.instance_key || executionCaseInstanceKey(testCaseId);
        const result = resultByExecutionCaseInstance.get(`${execution.id}:${instanceKey}`)
          || (instance
            ? resultByExecutionCaseInstance.get(`${execution.id}:${executionCaseInstanceKey(testCaseId, instance.data_set_iteration_index, null)}`)
            : null);
        const status = result?.status || "queued";
        const resultIdentity = instanceKey;

        requirementIds.forEach((requirementId) => {
          const stats = requirementStats.get(requirementId) || { totalCases: new Set<string>(), failedCases: new Set<string>() };
          stats.totalCases.add(resultIdentity);
          if (status === "failed") {
            stats.failedCases.add(resultIdentity);
          }
          requirementStats.set(requirementId, stats);
        });

        if (["failed", "blocked"].includes(status)) {
          failedCases.push({
            id: testCaseId,
            title: `${snapshot?.test_case_title || linkedCase?.title || "Unnamed Test Case"}${instance?.test_data_set_id ? ` · Row ${(instance.data_set_iteration_index ?? 0) + 1}` : ""}`,
            status,
            priority: snapshot?.priority ?? linkedCase?.priority ?? null,
            suiteId: snapshot?.suite_id || linkedCase?.suite_id || linkedCase?.suite_ids?.[0] || null,
            suiteName: snapshot?.suite_name || null,
            requirementIds,
            requirementTitles: requirementIds.map((requirementId) => savedRequirementById.get(requirementId)?.title || requirementById.get(requirementId)?.title || requirementId),
            error: result?.error || null
          });
        }
      });

      const impactedRequirements = Array.from(requirementStats.entries())
        .map(([requirementId, stats]) => {
          const totalCases = stats.totalCases.size;
          const failedRequirementCases = stats.failedCases.size;
          return {
            id: requirementId,
            title: savedRequirementById.get(requirementId)?.title || requirementById.get(requirementId)?.title || requirementId,
            priority: savedRequirementById.get(requirementId)?.priority ?? requirementById.get(requirementId)?.priority ?? null,
            totalCases,
            failedCases: failedRequirementCases,
            failureRate: totalCases ? Math.round((failedRequirementCases / totalCases) * 100) : 0
          };
        })
        .sort((left, right) => {
          if (right.failedCases !== left.failedCases) return right.failedCases - left.failedCases;
          if ((left.priority || 99) !== (right.priority || 99)) return (left.priority || 99) - (right.priority || 99);
          return left.title.localeCompare(right.title);
        });

      const totalCases = scopedInstances.length || executionExpectedOutcomeCount(execution);
      summary[execution.id] = {
        failedCases,
        impactedRequirements,
        totalRequirements: impactedRequirements.length,
        failedRequirementCount: impactedRequirements.filter((requirement) => requirement.failedCases > 0).length,
        failureRate: totalCases ? Math.round((failedCases.length / totalCases) * 100) : 0
      };

      return summary;
    }, {});
  }, [allExecutionResults, executions, selectedExecution, requirementById, smartExecutionLibraryCaseById]);

  const selectedFrozenEvidence = (selectedExecution as ExecutionEvidenceReceipt | null)?.frozen_scope_evidence;
  const selectedExecutionImpactSummary = selectedExecution
    ? selectedFrozenEvidence?.availability === "available" ? {
      ...(executionImpactSummaryById[selectedExecution.id] || EMPTY_EXECUTION_RUN_IMPACT_SUMMARY),
      totalRequirements: selectedFrozenEvidence.total_stories,
      failedRequirementCount: selectedFrozenEvidence.impacted_stories.length,
      impactedRequirements: selectedFrozenEvidence.stories.map(story => ({
        id: story.id, title: [story.display_id, story.title].filter(Boolean).join(" · "), priority: null,
        totalCases: story.test_case_ids.length,
        failedCases: story.failed_test_case_ids?.length || 0,
        failureRate: story.test_case_ids.length ? Math.round((story.failed_test_case_ids?.length || 0) / story.test_case_ids.length * 100) : 0
      }))
    } : executionImpactSummaryById[selectedExecution.id] || EMPTY_EXECUTION_RUN_IMPACT_SUMMARY
    : EMPTY_EXECUTION_RUN_IMPACT_SUMMARY;

  const selectedSuiteImpactSummaryById = useMemo(() => {
    if (!selectedExecution) {
      return {};
    }

    return executionSuites.reduce<Record<string, ExecutionRunImpactSummary>>((summary, suite) => {
      const savedRequirementById = new Map(asArray(selectedExecution.requirement_snapshots).map(item => [item.id, item]));
      const requirementStats = new Map<string, { totalCases: Set<string>; failedCases: Set<string> }>();
      const failedCases: ExecutionRunImpactSummary["failedCases"] = [];
      const suiteCases = displayCasesBySuiteId[suite.id] || [];

      suiteCases.forEach((testCase) => {
        const snapshot = selectedExecution.case_snapshots?.find(item => item.test_case_id === testCase.id);
        const linkedCase = smartExecutionLibraryCaseById.get(testCase.id);
        const requirementIds = [...new Set(Array.isArray(snapshot?.requirement_ids) ? snapshot.requirement_ids : [...(linkedCase?.requirement_ids || []), linkedCase?.requirement_id].filter(Boolean))] as string[];
        testCase.data_set_instances.forEach((instance) => {
          const status = instanceDerivedStatus(instance);

          requirementIds.forEach((requirementId) => {
            const stats = requirementStats.get(requirementId) || { totalCases: new Set<string>(), failedCases: new Set<string>() };
            stats.totalCases.add(instance.instance_key);
            if (status === "failed") {
              stats.failedCases.add(instance.instance_key);
            }
            requirementStats.set(requirementId, stats);
          });

          if (["failed", "blocked"].includes(status)) {
            failedCases.push({
              id: testCase.id,
              title: `${testCase.title}${instance.test_data_set_id ? ` · Row ${(instance.data_set_iteration_index ?? 0) + 1}` : ""}`,
              status,
              priority: testCase.priority,
              suiteId: suite.id,
              suiteName: suite.name,
              requirementIds,
              requirementTitles: requirementIds.map((requirementId) => savedRequirementById.get(requirementId)?.title || requirementById.get(requirementId)?.title || requirementId),
              error: resultForCaseInstance(instance)?.error || null
            });
          }
        });
      });

      const impactedRequirements = Array.from(requirementStats.entries())
        .map(([requirementId, stats]) => {
          const totalCases = stats.totalCases.size;
          const failedRequirementCases = stats.failedCases.size;
          return {
            id: requirementId,
            title: savedRequirementById.get(requirementId)?.title || requirementById.get(requirementId)?.title || requirementId,
            priority: savedRequirementById.get(requirementId)?.priority ?? requirementById.get(requirementId)?.priority ?? null,
            totalCases,
            failedCases: failedRequirementCases,
            failureRate: totalCases ? Math.round((failedRequirementCases / totalCases) * 100) : 0
          };
        })
        .sort((left, right) => {
          if (right.failedCases !== left.failedCases) return right.failedCases - left.failedCases;
          if ((left.priority || 99) !== (right.priority || 99)) return (left.priority || 99) - (right.priority || 99);
          return left.title.localeCompare(right.title);
        });

      summary[suite.id] = {
        failedCases,
        impactedRequirements,
        totalRequirements: impactedRequirements.length,
        failedRequirementCount: impactedRequirements.filter((requirement) => requirement.failedCases > 0).length,
        failureRate: suiteCases.length
          ? Math.round((failedCases.length / suiteCases.flatMap((testCase) => testCase.data_set_instances).length) * 100)
          : 0
      };

      return summary;
    }, {});
  }, [displayCasesBySuiteId, executionSuites, requirementById, resultByCaseInstanceKey, selectedExecution, smartExecutionLibraryCaseById]);

  const refreshExecutionScope = async (executionId = selectedExecutionId) => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["executions"] }),
      queryClient.invalidateQueries({ queryKey: ["executions", projectId] }),
      queryClient.invalidateQueries({ queryKey: ["execution-results", executionId] }),
      queryClient.invalidateQueries({ queryKey: ["execution", executionId] }),
      queryClient.invalidateQueries({ queryKey: ["execution-results"] }),
      queryClient.invalidateQueries({ queryKey: ["requirement-release-readiness", "project", projectId] }),
      queryClient.invalidateQueries({ predicate: ({ queryKey }) =>
        queryKey[1] === projectId && ["requirements", "requirement-detail", "requirement-route-detail", "requirement-sprint-health", "sprint-requirement-children", "test-case-module-children"].includes(String(queryKey[0]))
        || queryKey[2] === projectId && ["release-review-runs", "test-case-metrics", "global-test-cases", "test-case-assurance-results"].includes(String(queryKey[0]))
      }),
      queryClient.invalidateQueries({ queryKey: ["workspace-transactions"] })
    ]);

    await Promise.all([
      executionsQuery.refetch(),
      allExecutionResultsQuery.refetch(),
      executionId
        ? queryClient.fetchQuery({
            queryKey: ["execution", executionId],
            queryFn: () => api.executions.get(executionId)
          })
        : Promise.resolve(),
      executionId
        ? queryClient.fetchQuery({
            queryKey: ["execution-results", executionId],
            queryFn: () => api.executionResults.list({ execution_id: executionId })
          })
        : Promise.resolve(),
      workspaceTransactionsQuery.refetch()
    ]);
  };

  const patchExecutionCache = (executionId: string, patch: Partial<Execution>) => {
    queryClient.setQueryData<Execution>(["execution", executionId], (current) =>
      current ? { ...current, ...patch } : current
    );
    queryClient.setQueriesData<Execution[]>({ queryKey: ["executions"] }, (current) =>
      Array.isArray(current)
        ? current.map((execution) => (execution.id === executionId ? { ...execution, ...patch } : execution))
        : current
    );
  };

  const scheduleExecutionRefresh = (executionId: string) => {
    if (typeof window === "undefined") {
      return;
    }

    window.setTimeout(() => void refreshExecutionScope(executionId), 750);
    window.setTimeout(() => void refreshExecutionScope(executionId), 2500);
  };

  const refreshExecutionSchedules = async () => {
    await queryClient.invalidateQueries({ queryKey: ["execution-schedules"] });
  };

  const handleSaveExecutionAssignment = async () => {
    if (!selectedExecution) {
      return;
    }
    if (!canUpdateRuns) {
      showError(new Error("Permission required: run.update"), "Unable to update run assignee");
      return;
    }

    try {
      await updateExecutionAssignment.mutateAsync({
        id: selectedExecution.id,
        assigned_to_ids: executionAssignmentDraftIds
      });
      await refreshExecutionScope(selectedExecution.id);
      showSuccess(
        executionAssignmentDraftIds.length
          ? "Run assignees updated. Unoverridden test cases now follow the primary tester."
          : "Run assignees cleared."
      );
    } catch (error) {
      showError(error, "Unable to update run assignee");
    }
  };

  const handleSaveCaseAssignment = async () => {
    if (!selectedExecution || !selectedExecutionCase) {
      return;
    }
    if (!canUpdateRuns) {
      showError(new Error("Permission required: run.update"), "Unable to update test case assignee");
      return;
    }

    try {
      await updateExecutionCaseAssignment.mutateAsync({
        executionId: selectedExecution.id,
        testCaseId: selectedExecutionCase.id,
        assigned_to: caseAssignmentDraft || ""
      });
      await refreshExecutionScope(selectedExecution.id);
      showSuccess(
        caseAssignmentDraft
          ? "Test case assignee updated for this run."
          : selectedExecution.assigned_user
            ? "Test case assignee reset to the run owner."
            : "Test case assignee cleared."
      );
    } catch (error) {
      showError(error, "Unable to update test case assignee");
    }
  };

  const handleScopeAssignmentChange = async (level: "suites" | "modules", scopeId: string, assignedToIds: string[]) => {
    if (!selectedExecution || scopeId === "unassigned-module") return;
    if (!canUpdateRuns) {
      showError(new Error("Permission required: run.update"), `Unable to update ${level === "suites" ? "suite" : "module"} responsibility`);
      return;
    }
    try {
      await updateExecutionScopeAssignment.mutateAsync({
        executionId: selectedExecution.id,
        level,
        scopeId,
        assignedToIds
      });
      await refreshExecutionScope(selectedExecution.id);
      showSuccess(`${level === "suites" ? "Suite" : "Module"} responsibility updated.`);
    } catch (error) {
      showError(error, `Unable to update ${level === "suites" ? "suite" : "module"} responsibility`);
    }
  };

  const handleSaveCaseReferences = async () => {
    if (!selectedExecution || !selectedExecutionCase || !selectedExecutionCaseInstance || !selectedExecution.app_type_id) {
      return;
    }
    if (isSelectedResultDerived) return;
    if (!canManageRunResults) {
      showError(new Error("Permission required: result.manage"), "Unable to update case traceability");
      return;
    }

    const externalReferences = parseReferenceList(caseReferenceDraft);
    const defects = parseReferenceList(caseDefectDraft);
    const safeStatus: ExecutionResult["status"] = selectedExecutionResult?.status || "pending";

    try {
      if (selectedExecutionResult) {
        const updateResponse = await updateResult.mutateAsync({
          id: selectedExecutionResult.id,
          input: {
            external_references: externalReferences,
            defects,
            expected_revision: selectedExecutionResult.revision
          }
        });
        queryClient.setQueryData<ExecutionResult[]>(["execution-results", selectedExecution.id], (current = []) =>
          current.map((item) => item.id === selectedExecutionResult.id ? { ...item, external_references: externalReferences, case_defects: updateResponse.case_defects, defects: updateResponse.defects, revision: updateResponse.revision } : item)
        );
      } else {
        const response = await createResult.mutateAsync({
          execution_id: selectedExecution.id,
          test_case_id: selectedExecutionCase.id,
          app_type_id: selectedExecution.app_type_id,
          status: safeStatus,
          duration_ms: selectedCaseDurationMs ?? undefined,
          logs: stringifyExecutionLogs(selectedCaseLogs),
          test_data_set_id: selectedExecutionCaseInstance.test_data_set_id || undefined,
          test_data_set_name: selectedExecutionCaseInstance.test_data_set_name || undefined,
          data_set_iteration_index: selectedExecutionCaseInstance.data_set_iteration_index ?? undefined,
          data_set_iteration_key: selectedExecutionCaseInstance.data_set_iteration_key || undefined,
          data_set_row_snapshot: selectedExecutionCaseInstance.data_set_row_snapshot || undefined,
          external_references: externalReferences,
          defects,
          executed_by: session!.user.id
        });

        queryClient.setQueryData<ExecutionResult[]>(["execution-results", selectedExecution.id], (current = []) => [
          {
            id: response.id,
            execution_id: selectedExecution.id,
            test_case_id: selectedExecutionCase.id,
            test_case_title: selectedExecutionCase.title,
            suite_id: selectedExecutionCase.suite_id,
            suite_name: selectedExecutionCase.suite_name,
            app_type_id: selectedExecution.app_type_id || "",
            status: safeStatus,
            duration_ms: selectedCaseDurationMs,
            error: null,
            logs: stringifyExecutionLogs(selectedCaseLogs),
            test_data_set_id: selectedExecutionCaseInstance.test_data_set_id,
            test_data_set_name: selectedExecutionCaseInstance.test_data_set_name,
            data_set_iteration_index: selectedExecutionCaseInstance.data_set_iteration_index,
            data_set_iteration_key: selectedExecutionCaseInstance.data_set_iteration_key,
            data_set_row_snapshot: selectedExecutionCaseInstance.data_set_row_snapshot,
            external_references: externalReferences,
            case_defects: defects,
            defects,
            revision: response.revision,
            executed_by: session!.user.id
          },
          ...current
        ]);
      }

      await refreshExecutionScope(selectedExecution.id);
      showSuccess("Execution references updated.");
    } catch (error) {
      showError(error, "Unable to update execution references");
    }
  };

  const handleFinalizeExecution = async (mode: "complete" | "abort") => {
    if (!selectedExecution) {
      return;
    }
    if (!canExecuteRuns) {
      showError(new Error("Permission required: run.execute"), mode === "abort" ? "Unable to abort run" : "Unable to complete run");
      return;
    }

    const status = mode === "abort" ? "aborted" : executionProgress.failedCount ? "failed" : "completed";
    const failureMessage = mode === "abort" ? "Unable to abort run" : "Unable to complete run";

    setExecutionFinalizeAction(mode);

    try {
      const response = await completeExecution.mutateAsync({ id: selectedExecution.id, status });
      patchExecutionCache(selectedExecution.id, {
        status: response.status || status,
        ended_at: new Date().toISOString()
      });
      scheduleExecutionRefresh(selectedExecution.id);
      await refreshExecutionScope(selectedExecution.id);
    } catch (error) {
      showError(error, failureMessage);
    } finally {
      setExecutionFinalizeAction(null);
    }
  };

  const handlePreviewSmartExecution = async () => {
    if(smartExecutionImagesBusy)return;
    if (!projectId || !appTypeId) {
      setSmartExecutionPreviewTone("error");
      setSmartExecutionPreviewMessage("Choose a project and app type before generating an AI smart run.");
      return;
    }

    if (
      !executionRelease.trim()
      && !executionSprint.trim()
      && !executionBuild.trim()
      && !smartExecutionReleaseScope.trim()
      && !smartExecutionAdditionalContext.trim()
      && !selectedSmartRequirementIds.length
    ) {
      setSmartExecutionPreviewTone("error");
      setSmartExecutionPreviewMessage("Select a Release, Sprint, Build, impacted Story, or add change context so HelloTest can retrieve relevant test evidence.");
      return;
    }

    if (smartExecutionReleaseScope.trim().length > 4000 || smartExecutionAdditionalContext.trim().length > 4000) {
      setSmartExecutionPreviewTone("error");
      setSmartExecutionPreviewMessage("Keep change scope and additional context within 4,000 characters each. Select fewer Smart Context records or shorten the notes.");
      return;
    }

    const requestToken = smartExecutionPreviewRequestRef.current + 1;
    const builderSessionToken = smartExecutionBuilderSessionRef.current;
    const requestScopeKey = buildSmartExecutionScopeKey();
    smartExecutionPreviewRequestRef.current = requestToken;
    setSmartExecutionPreview(null);
    setSelectedSmartExecutionCaseIds([]);
    setSmartExecutionPreviewMessage("");
    setSmartExecutionPreviewTone("success");
    setSmartExecutionPreviewScopeKey("");

    try {
      const response = await previewSmartExecution.mutateAsync({
        project_id: projectId,
        app_type_id: appTypeId,
        integration_id: smartExecutionIntegrationId || undefined,
        release: canViewDeliveryScopes ? executionRelease.trim() || undefined : undefined,
        sprint: canViewDeliveryScopes ? executionSprint.trim() || undefined : undefined,
        build: executionBuild.trim() || undefined,
        scope_description: smartExecutionReleaseScope.trim() || undefined,
        additional_context: smartExecutionAdditionalContext || undefined,
        images: smartExecutionImages,
        prompt_guidance: getPrompt("ai.execution.smart_plan") || undefined,
        impacted_requirement_ids: selectedSmartRequirementIds.length ? selectedSmartRequirementIds : undefined,
        test_environment_id: can("environment.view") ? selectedExecutionEnvironmentId || undefined : undefined,
        test_configuration_id: can("configuration.view") ? selectedExecutionConfigurationId || undefined : undefined,
        test_data_options: selectedExecutionDataOptions,
        test_data_set_id: can("data.view") ? selectedExecutionDataSetId || undefined : undefined
      });

      if (
        smartExecutionPreviewRequestRef.current !== requestToken
        || smartExecutionBuilderSessionRef.current !== builderSessionToken
      ) {
        return;
      }

      setSmartExecutionPreview(response);
      setSelectedSmartExecutionCaseIds(
        retainEligibleRunCases(response.cases.map((testCase) => testCase.test_case_id), smartExecutionLibraryCaseById, executionStartMode !== "manual")
      );
      setExecutionName(response.execution_name || executionName);
      setSmartExecutionPreviewScopeKey(requestScopeKey);
      setSmartExecutionPreviewTone("success");
      const evidenceSummary = response.evidence_summary;
      setSmartExecutionPreviewMessage(
        response.cases.length
          ? `${response.matched_case_count} evidence-linked case${response.matched_case_count === 1 ? "" : "s"} are ready for review from ${evidenceSummary?.candidate_case_count || 0} scoped candidate${evidenceSummary?.candidate_case_count === 1 ? "" : "s"}. ${response.generation_mode === "hybrid" ? `${response.integration.name} refined explanations with cited records; ranking remained deterministic.` : "Risk and selection were calculated deterministically from the returned project records."}`
          : "No Test Cases were linked to the supplied exact delivery keys, selected Stories, or change context within the recorded scan boundary."
      );
    } catch (error) {
      if (
        smartExecutionPreviewRequestRef.current !== requestToken
        || smartExecutionBuilderSessionRef.current !== builderSessionToken
      ) {
        return;
      }

      resetSmartExecutionPreview();
      setSmartExecutionPreviewTone("error");
      setSmartExecutionPreviewMessage(error instanceof Error ? error.message : "Unable to generate a smart run preview");
    }
  };

  const handleCreateExecution = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (event.target !== event.currentTarget) return;

    if (executionStartDate && executionEndDate && executionEndDate < executionStartDate) {
      showError(new Error("End date must be on or after start date."), "Unable to create run");
      return;
    }

    if (!session?.user.id) {
      setMessageTone("error");
      setMessage("You need an active session before creating a run.");
      return;
    }

    if (!canCreateExecution) {
      showError(new Error(isResolvingDeliveryPrefill
        ? "Delivery scope is still loading. Your run settings are saved in this form."
        : directCaseSelectionMessage || (isResolvingSmartRunCases
          ? "Selected case details must finish loading before this run can be created."
          : "Select an available run scope before creating the run.")), "Unable to create run");
      return;
    }

    const selectedSmartCaseIds = selectedSmartExecutableCaseIds;

    if (executionCreateMode === "smart" && !canUseRunAi) {
	  showError(new Error("Permission required: run.ai"), "Unable to create AI smart run");
	  return;
	}

	if (
	  executionCreateMode === "smart"
	  && (
	    !smartExecutionPreview
	    || !smartExecutionPreviewScopeKey
	    || smartExecutionPreviewScopeKey !== buildSmartExecutionScopeKey()
	  )
	) {
	  resetSmartExecutionPreview();
	  setSmartExecutionPreviewTone("error");
	  setSmartExecutionPreviewMessage("Delivery scope changed. Generate a fresh impact preview before creating this Smart Run.");
	  return;
	}

	if (executionCreateMode === "smart" && !selectedSmartCaseIds.length) {
	      setMessageTone("error");
	      setMessage(
        executionStartMode === "manual"
          ? "Select at least one impacted test case before creating an AI smart run."
          : "Select at least one automated impacted case before creating a Test Engine smart run."
      );
	      return;
	    }

    const acceptedSmartPlan = executionCreateMode === "smart"
      && smartExecutionPreview?.acceptance_token
      && smartExecutionPreview.request_id
      && smartExecutionPreview.input_fingerprint
      ? {
          acceptance_token: smartExecutionPreview.acceptance_token,
          request_id: smartExecutionPreview.request_id,
          input_fingerprint: smartExecutionPreview.input_fingerprint,
          selected_test_case_ids: selectedSmartCaseIds
        }
      : null;

    if (executionCreateMode === "smart" && !acceptedSmartPlan) {
      resetSmartExecutionPreview();
      setSmartExecutionPreviewTone("error");
      setSmartExecutionPreviewMessage("The reviewed Smart Run acceptance proof is missing. Generate a fresh impact preview before creating the run.");
      return;
    }

	    const canCreateSelectedRunMode = executionStartMode === "local"
	      ? canRunLocalAutomation
	      : executionStartMode === "remote"
	        ? canRunRemoteAutomation
	        : canCreateManualRuns;

	    if (!canCreateSelectedRunMode) {
	      showError(
	        new Error(
	          executionStartMode === "local"
	            ? "Permission required: automation.run.local"
	            : executionStartMode === "remote"
	              ? "Permission required: automation.run.remote"
	              : "Permission required: run.create"
	        ),
	        "Unable to create run"
	      );
	      return;
	    }

	    const executionHooks = mapRunHooksToExecutionHooks(
      executionHookDraft.filter(hook => can(hook.itemType === "suite" ? "suite.view" : "testcase.view"))
    );

    try {
      const response = await createExecution.mutateAsync({
        ...nativeExecutionDeliveryScope(),
        project_id: projectId,
        app_type_id: appTypeId || undefined,
        suite_ids: can("suite.view") && executionCreateMode === "manual" ? selectedSuiteIds : undefined,
        test_case_ids: can("testcase.view") ? executionCreateMode === "smart" ? selectedSmartCaseIds : selectedDirectCaseIds.length ? selectedDirectCaseIds : undefined : undefined,
        test_environment_id: can("environment.view") ? selectedExecutionEnvironmentId || undefined : undefined,
        test_configuration_id: can("configuration.view") ? selectedExecutionConfigurationId || undefined : undefined,
        test_data_options: selectedExecutionDataOptions,
        test_data_set_id: can("data.view") ? selectedExecutionDataSetId || undefined : undefined,
        execution_hooks: executionHooks.length ? executionHooks : undefined,
        parallel_enabled: canConfigureParallelAutomation && executionParallelEnabled,
        parallel_count: canConfigureParallelAutomation && executionParallelEnabled ? executionParallelCount : 1,
        execution_mode: executionStartMode,
        start_date: executionStartDate || undefined,
        end_date: executionEndDate || undefined,
        assigned_to_ids: selectedExecutionAssigneeIds.length ? selectedExecutionAssigneeIds : undefined,
        release: canViewDeliveryScopes ? executionRelease.trim() || undefined : undefined,
        sprint: canViewDeliveryScopes ? executionSprint.trim() || undefined : undefined,
        build: executionBuild.trim() || undefined,
        name: executionName || undefined,
        scope_source: executionCreateMode === "smart" ? "smart-run" : undefined,
        smart_plan: acceptedSmartPlan || undefined,
        created_by: session.user.id
      });

      closeExecutionBuilder();
      focusExecution(response.id);
      setFocusedSuiteId("");
      if (executionStartMode !== "manual") {
        patchExecutionCache(response.id, {
          status: "running",
          started_at: new Date().toISOString(),
          trigger: executionStartMode === "local" ? "local" : "ci"
        });
        scheduleExecutionRefresh(response.id);
      }
      showSuccess(
        executionCreateMode === "smart"
          ? `AI smart run created with ${selectedSmartCaseIds.length} impacted case${selectedSmartCaseIds.length === 1 ? "" : "s"} in Direct impacted scope.`
          : executionStartMode === "manual"
            ? "Manual run created from a snapshot of the selected scope."
            : `Automation run created and started ${executionStartMode === "local" ? "locally" : "remotely"}.`
      );
      await refreshExecutionScope(response.id);
    } catch (error) {
      showError(error, "Unable to create run");
    }
  };

  const handleSubmitExecutionSchedule = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const canSaveSchedule = scheduleModalMode === "edit" ? canUpdateSchedules : canCreateSchedules;
    if (!canSaveSchedule) {
      showError(
        new Error(`Permission required: ${scheduleModalMode === "edit" ? "schedule.update" : "schedule.create"}`),
        scheduleModalMode === "edit" ? "Unable to update schedule" : "Unable to create schedule"
      );
      return;
    }

    if (!session?.user.id) {
      showError(
        new Error(`You need an active session before ${scheduleModalMode === "edit" ? "editing" : "creating"} a schedule.`),
        scheduleModalMode === "edit" ? "Unable to update schedule" : "Unable to create schedule"
      );
      return;
    }

    if (!projectId || !appTypeId) {
      showError(
        new Error(`Choose a project and app type before ${scheduleModalMode === "edit" ? "editing" : "creating"} a schedule.`),
        scheduleModalMode === "edit" ? "Unable to update schedule" : "Unable to create schedule"
      );
      return;
    }

    if (!selectedSuiteIds.length) {
      showError(
        new Error("Select at least one suite to schedule."),
        scheduleModalMode === "edit" ? "Unable to update schedule" : "Unable to create schedule"
      );
      return;
    }

    if (!scheduleNextRunAt) {
      showError(
        new Error("Choose the first run time for this schedule."),
        scheduleModalMode === "edit" ? "Unable to update schedule" : "Unable to create schedule"
      );
      return;
    }

    const cadencePayload = scheduleCadence === "interval_minutes"
      ? buildIntervalCadence(scheduleIntervalMinutes)
      : scheduleCadence;

    try {
      if (scheduleModalMode === "edit") {
        if (!editingScheduleId) {
          throw new Error("Select a schedule to edit.");
        }

        await updateExecutionSchedule.mutateAsync({
          id: editingScheduleId,
          input: {
            project_id: projectId,
            app_type_id: appTypeId,
            name: executionName || undefined,
            cadence: cadencePayload,
            next_run_at: new Date(scheduleNextRunAt).toISOString(),
            ...(can("suite.view") ? { suite_ids: selectedSuiteIds } : {}),
            ...(can("environment.view") ? { test_environment_id: selectedExecutionEnvironmentId || "" } : {}),
            ...(can("configuration.view") ? { test_configuration_id: selectedExecutionConfigurationId || "" } : {}),
            ...(can("data.view") ? { test_data_options: selectedExecutionDataOptions, test_data_set_id: selectedExecutionDataSetId || "" } : {}),
            ...(canViewDeliveryScopes ? { release: executionRelease.trim() || "" } : {}),
            ...(canViewDeliveryScopes ? { sprint: executionSprint.trim() || "" } : {}),
            build: executionBuild.trim() || "",
            assigned_to_ids: selectedExecutionAssigneeIds
          }
        });
      } else {
        await createExecutionSchedule.mutateAsync({
          project_id: projectId,
          app_type_id: appTypeId,
          name: executionName || undefined,
          cadence: cadencePayload,
          next_run_at: new Date(scheduleNextRunAt).toISOString(),
          suite_ids: selectedSuiteIds,
          test_environment_id: can("environment.view") ? selectedExecutionEnvironmentId || undefined : undefined,
          test_configuration_id: can("configuration.view") ? selectedExecutionConfigurationId || undefined : undefined,
          test_data_options: selectedExecutionDataOptions,
        test_data_set_id: can("data.view") ? selectedExecutionDataSetId || undefined : undefined,
          release: canViewDeliveryScopes ? executionRelease.trim() || undefined : undefined,
          sprint: canViewDeliveryScopes ? executionSprint.trim() || undefined : undefined,
          build: executionBuild.trim() || undefined,
          assigned_to_ids: selectedExecutionAssigneeIds.length ? selectedExecutionAssigneeIds : undefined,
          created_by: session.user.id
        });
      }

      closeScheduleBuilder();
      setTestRunsView("scheduled-runs");
      await refreshExecutionSchedules();
      if (editingScheduleId) {
        focusExecutionSchedule(editingScheduleId);
      }
      showSuccess(scheduleModalMode === "edit" ? "Scheduled run updated." : "Scheduled run created.");
    } catch (error) {
      showError(error, scheduleModalMode === "edit" ? "Unable to update schedule" : "Unable to create schedule");
    }
  };

  const handleRerunExecutionItem = async (execution: Execution, failedOnly: boolean) => {
    if (!session?.user.id || !canExecuteRuns) {
      if (!canExecuteRuns) {
        showError(new Error("Permission required: run.execute"), failedOnly ? "Unable to rerun failed cases" : "Unable to create rerun");
      }
      return;
    }

    try {
      const response = await rerunExecution.mutateAsync({
        id: execution.id,
        input: {
          failed_only: failedOnly,
          created_by: session.user.id
        }
      });

      focusExecution(response.id);
      await refreshExecutionScope(response.id);
      showSuccess(failedOnly ? "Failed cases were queued into a fresh rerun run." : "A fresh rerun was created with the same run context.");
    } catch (error) {
      showError(error, failedOnly ? "Unable to rerun failed cases" : "Unable to create rerun");
    }
  };

	  const handleStartSelectedExecution = async (mode: "manual" | "remote" | "local" = selectedExecutionStartMode) => {
	    if (!selectedExecution) {
	      return;
	    }

	    const hasModeAccess = mode === "local"
	      ? canRunLocalAutomation && canExecuteRuns
	      : mode === "remote"
	        ? canRunRemoteAutomation && canExecuteRuns
	        : canExecuteRuns;

	    if (!hasModeAccess) {
	      showError(
	        new Error(
	          mode === "local"
	            ? "Permission required: run.execute and automation.run.local"
	            : mode === "remote"
	              ? "Permission required: run.execute and automation.run.remote"
	              : "Permission required: run.execute"
	        ),
	        "Unable to start run"
	      );
	      return;
	    }

	    try {
      const response = await startExecution.mutateAsync({
        id: selectedExecution.id,
        options: mode === "local"
          ? { execution_mode: "local" }
          : mode === "remote"
            ? { execution_mode: "remote" }
            : undefined
      });
      patchExecutionCache(selectedExecution.id, {
        status: "running",
        started_at: new Date().toISOString(),
        trigger: mode === "local" ? "local" : mode === "remote" ? "ci" : selectedExecution.trigger || "manual"
      });
      scheduleExecutionRefresh(selectedExecution.id);
      await refreshExecutionScope(selectedExecution.id);
      showSuccess(summarizeExecutionStart(response));
    } catch (error) {
      showError(error, "Unable to start run");
    }
  };

  const htmlReportMutation = useMutation({ mutationFn: api.executions.downloadReportHtml });
  const handleOpenHtmlReport = async () => {
    if (!selectedExecution || !canExportRunReports || htmlReportMutation.isPending) return;
    const reportName = selectedExecution.name || "Run report";
    const tab = window.open("about:blank", "_blank");
    if (tab) { tab.opener = null; tab.document.title = reportName; tab.document.body.textContent = "Preparing detailed run report…"; }
    try {
      const blob = await htmlReportMutation.mutateAsync(selectedExecution.id);
      const url = URL.createObjectURL(new Blob([blob], { type: "text/html" }));
      if (tab && !tab.closed) tab.location.replace(url);
      else { const link = document.createElement("a"); link.href = url; link.download = `${reportName.replace(/[^A-Za-z0-9._-]+/g, "-")}.html`; link.click(); }
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (error) { tab?.close(); showError(error, "Unable to prepare detailed run report"); }
  };

  const handleDownloadExecutionReport = async () => {
    if (!selectedExecution) {
      return;
    }

    try {
      const blob = await downloadExecutionReport.mutateAsync(selectedExecution.id);
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${(selectedExecution.name || selectedExecution.id || "hellotest-run-report").replace(/[^A-Za-z0-9._-]+/g, "-")}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
      showSuccess("Run report PDF exported.");
    } catch (error) {
      showError(error, "Unable to export run report");
    }
  };

  const handleOpenReportEmailModal = () => {
    setReportEmailCaseId("");
    setReportEmailDraft(session?.user.email || "");
    setIsReportEmailModalOpen(true);
  };

  const handleDownloadExecutionCaseReport = async () => {
    if (!selectedExecution || !selectedExecutionCase) {
      return;
    }

    try {
      const blob = await downloadExecutionCaseReport.mutateAsync({
        executionId: selectedExecution.id,
        testCaseId: selectedExecutionCase.id
      });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${(selectedExecutionCase.title || selectedExecutionCase.id || "hellotest-case-run-report").replace(/[^A-Za-z0-9._-]+/g, "-")}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
      showSuccess("Test case run report PDF exported.");
    } catch (error) {
      showError(error, "Unable to export test case run report");
    }
  };

  const handleOpenCaseReportEmailModal = () => {
    if (!selectedExecutionCase) {
      return;
    }
    setReportEmailCaseId(selectedExecutionCase.id);
    setReportEmailDraft(session?.user.email || "");
    setIsReportEmailModalOpen(true);
  };

  const handleReportSelectedExecutionIssue = (
    scope: "run" | "case" | "suite" | "module" = "run",
    scopedContext: { testCaseId?: string; suiteId?: string; suiteName?: string; moduleId?: string; moduleName?: string } = {},
    mode: "manual" | "ai" = "manual"
  ) => {
    if (!selectedExecution) {
      return;
    }

    const scopedCase = scope === "case"
      ? executionCaseOrder.find((testCase) => testCase.id === (scopedContext.testCaseId || selectedExecutionCase?.id)) || null
      : null;
    const scopedCaseTitle = scopedCase
      ? scopedCase.id === selectedExecutionCase?.id
        ? selectedExecutionCaseReadableTitle || scopedCase.title
        : scopedCase.title
      : "";
    const suiteId = scopedContext.suiteId || scopedCase?.suite_id || "";
    const suiteName = scopedContext.suiteName || scopedCase?.suite_name || "";
    const moduleId = scopedContext.moduleId || scopedCase?.module_id || "";
    const moduleName = scopedContext.moduleName || scopedCase?.module_name || "";
    const linkedLibraryCase = scopedCase ? smartExecutionLibraryCaseById.get(scopedCase.id) : null;
    const scopedCaseSnapshot = scopedCase
      ? selectedExecution.case_snapshots?.find((snapshot) => snapshot.test_case_id === scopedCase.id)
      : null;
    const scopedCaseRequirementIds = scopedCase
      ? [...new Set(
        scopedCaseSnapshot?.requirement_ids?.length
          ? scopedCaseSnapshot.requirement_ids
          : [...(linkedLibraryCase?.requirement_ids || []), linkedLibraryCase?.requirement_id].filter(Boolean)
      )] as string[]
      : [];
    const failedCasesForAiContext: ExecutionRunImpactSummary["failedCases"] = scope === "suite"
      ? selectedSuiteImpactSummaryById[suiteId]?.failedCases || []
      : scope === "module"
        ? selectedExecutionImpactSummary.failedCases.filter((failedCase) => {
          const snapshot = selectedExecution.case_snapshots?.find((candidate) => candidate.test_case_id === failedCase.id);
          const libraryCase = smartExecutionLibraryCaseById.get(failedCase.id);
          return snapshot?.module_id === moduleId || (libraryCase?.module_ids || []).includes(moduleId);
        })
        : scope === "run"
          ? selectedExecutionImpactSummary.failedCases
          : [];
    const selectedAiFailureCases = mode === "ai"
      ? failedCasesForAiContext.slice(0, MAX_AI_BUG_CONTEXT_ITEMS)
      : [];
    const contextualCaseIds = scopedCase
      ? [scopedCase.id]
      : selectedAiFailureCases.map((failedCase) => failedCase.id);
    const contextualRequirementIds = scopedCase
      ? scopedCaseRequirementIds.slice(0, MAX_AI_BUG_CONTEXT_ITEMS)
      : [...new Set(selectedAiFailureCases.flatMap((failedCase) => {
        const snapshot = selectedExecution.case_snapshots?.find((candidate) => candidate.test_case_id === failedCase.id);
        return snapshot?.requirement_ids?.length ? snapshot.requirement_ids : failedCase.requirementIds;
      }))].slice(0, MAX_AI_BUG_CONTEXT_ITEMS);
    const compactFailureEvidence = (value: string | null | undefined) =>
      String(value || "").replace(/\s+/g, " ").trim().slice(0, 180);
    const selectedCaseResult = scopedCase
      ? scopedCase.id === selectedExecutionCase?.id ? selectedExecutionResult : resultByCaseId[scopedCase.id]
      : null;
    const aiFailureEvidenceLines = selectedAiFailureCases
      .slice(0, MAX_AI_BUG_EVIDENCE_LINES)
      .map((failedCase) => {
        const error = compactFailureEvidence(failedCase.error);
        return `- ${failedCase.title} (${failedCase.id}): ${failedCase.status}${error ? ` — ${error}` : ""}`;
      });
    const returnParams = new URLSearchParams(searchParams);
    returnParams.set("view", testRunsView);
    returnParams.set("execution", selectedExecution.id);
    if (scopedCase) returnParams.set("testCase", scopedCase.id);
    else returnParams.delete("testCase");
    if (suiteId) returnParams.set("suite", suiteId);
    else returnParams.delete("suite");
    if (moduleId) returnParams.set("module", moduleId);
    else returnParams.delete("module");
    const returnTo = `${location.pathname}?${returnParams.toString()}`;
    const title = scopedCase
      ? `Case defect: ${scopedCaseTitle || scopedCase.id}`
      : scope === "module"
        ? `Module defect: ${moduleName || moduleId}`
        : scope === "suite"
          ? `Suite defect: ${suiteName || suiteId}`
          : `Run defect: ${selectedExecution.name || selectedExecution.id}`;
    const message = [
      scopedCase
        ? "Reported from a test case run."
        : scope === "module"
          ? "Reported from a module within a test run."
          : scope === "suite"
            ? "Reported from a suite within a test run."
            : "Reported from run details.",
      "",
      `Run ID: ${selectedExecution.id}`,
      selectedExecution.name ? `Run name: ${selectedExecution.name}` : "",
      `Run status: ${currentExecutionStatus}`,
      `Run trigger: ${selectedExecution.trigger || "manual"}`,
      scopedCase ? `Test case ID: ${scopedCase.id}` : "",
      scopedCase ? `Test case title: ${scopedCaseTitle || scopedCase.title}` : "",
      suiteName ? `Suite: ${suiteName}` : "",
      moduleName ? `Module: ${moduleName}` : "",
      selectedExecution.test_environment?.name ? `Environment: ${selectedExecution.test_environment.name}` : "",
      selectedExecution.build ? `Build: ${selectedExecution.build}` : "",
      `Run totals: ${executionProgress.totalCases} case instances, ${executionStatusCounts.failed} failed, ${executionStatusCounts.blocked} blocked`,
      mode === "ai" && !scopedCase
        ? failedCasesForAiContext.length
          ? `AI context: ${selectedAiFailureCases.length} of ${failedCasesForAiContext.length} failed or blocked cases selected from this ${scope}.`
          : `AI context: no failed or blocked cases are recorded in this ${scope}; select evidence before generating the draft.`
        : "",
      mode === "ai" && failedCasesForAiContext.length > selectedAiFailureCases.length
        ? `Context limit: the first ${MAX_AI_BUG_CONTEXT_ITEMS} failed or blocked cases are included.`
        : "",
      mode === "ai" && scopedCase && selectedCaseResult
        ? `Selected case result: ${selectedCaseResult.status}${compactFailureEvidence(selectedCaseResult.error) ? ` — ${compactFailureEvidence(selectedCaseResult.error)}` : ""}`
        : "",
      aiFailureEvidenceLines.length ? "Selected failure evidence:" : "",
      ...aiFailureEvidenceLines,
      aiFailureEvidenceLines.length && selectedAiFailureCases.length > aiFailureEvidenceLines.length
        ? `- ${selectedAiFailureCases.length - aiFailureEvidenceLines.length} additional failed or blocked case${selectedAiFailureCases.length - aiFailureEvidenceLines.length === 1 ? "" : "s"} retained in the selected context.`
        : "",
      "",
      "Defect details:"
    ].filter(Boolean).join("\n");

    navigate(buildBugReportPath({
      runId: selectedExecution.id,
      executionResultId: selectedCaseResult?.derived ? undefined : selectedCaseResult?.id,
      runName: selectedExecution.name,
      runStatus: currentExecutionStatus,
      testCaseIds: contextualCaseIds,
      testCaseTitle: scopedCaseTitle || scopedCase?.title,
      suiteIds: scope === "suite" && suiteId ? [suiteId] : [],
      suiteName,
      moduleIds: scope === "module" && moduleId ? [moduleId] : [],
      moduleName,
      requirementIds: contextualRequirementIds,
      sprint: selectedExecution.sprint,
      release: selectedExecution.release,
      fixVersion: selectedExecution.release,
      environment: selectedExecution.test_environment?.name,
      build: selectedExecution.build,
      title,
      message,
      returnTo,
      returnLabel: scopedCase ? "test case run" : scope === "module" ? "run module" : scope === "suite" ? "run suite" : "test run"
    }, mode));
  };

  const handleShareExecutionReport = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!selectedExecution) {
      return;
    }

    const recipients = reportEmailDraft
      .split(/[,\n;]/)
      .map((entry) => entry.trim())
      .filter(Boolean);

    if (!recipients.length) {
      showError(null, "Enter at least one report recipient.");
      return;
    }

    try {
      const response = reportEmailCaseId
        ? await shareExecutionCaseReport.mutateAsync({
            executionId: selectedExecution.id,
            testCaseId: reportEmailCaseId,
            recipients
          })
        : await shareExecutionReport.mutateAsync({
            executionId: selectedExecution.id,
            recipients
          });
      setIsReportEmailModalOpen(false);
      setReportEmailCaseId("");
      showSuccess(`${reportEmailCaseId ? "Test case run" : "Run"} report emailed to ${response.recipients} recipient${response.recipients === 1 ? "" : "s"}.`);
    } catch (error) {
      showError(error, reportEmailCaseId ? "Unable to email test case run report" : "Unable to email run report");
    }
  };

  const handleRerunExecution = async (failedOnly: boolean) => {
    if (!selectedExecution) {
      return;
    }

    await handleRerunExecutionItem(selectedExecution, failedOnly);
  };

  const handleRunExecutionSchedule = async (scheduleId: string) => {
    if (!canRunSchedules) {
      showError(new Error("Permission required: schedule.run"), "Unable to run the schedule");
      return;
    }

    try {
      const response = await runExecutionSchedule.mutateAsync(scheduleId);
      const launchedSchedule = executionSchedules.find((schedule) => schedule.id === scheduleId);
      const launchedView: TestRunsView = "suite-runs";
      const nextParams = new URLSearchParams(searchParams);
      nextParams.set("view", launchedView);
      nextParams.set("execution", response.id);
      nextParams.delete("testCase");
      nextParams.delete("schedule");
      setSelectedScheduleId("");
      setTestRunsView(launchedView);
      setSelectedExecutionId(response.id);
      setFocusedSuiteId("");
      setSelectedTestCaseId("");
      setSelectedCaseInstanceKey("");
      setSearchParams(nextParams, { replace: true });
      await Promise.all([refreshExecutionScope(response.id), refreshExecutionSchedules()]);
      showSuccess("Scheduled run was launched as a fresh run.");
    } catch (error) {
      showError(error, "Unable to run the schedule");
    }
  };

  const handleDeleteExecutionSchedule = async (scheduleId: string, scheduleName: string) => {
    if (!canDeleteSchedules) {
      showError(new Error("Permission required: schedule.delete"), "Unable to delete schedule");
      return;
    }

    if (!(await confirmDelete({ message: `Delete schedule "${scheduleName}"?` }))) {
      return;
    }

    try {
      await deleteExecutionSchedule.mutateAsync(scheduleId);
      if (selectedScheduleId === scheduleId) {
        closeExecutionScheduleDetail();
      }
      await refreshExecutionSchedules();
      showSuccess("Scheduled run removed.");
    } catch (error) {
      showError(error, "Unable to delete schedule");
    }
  };

  const { caseLifecycleAction, setCaseLifecycleAction, createResult, updateResult, resolvePersistedCaseDurationMs, persistCaseResult, handleStepDefectsChange, handleRecordStep, pendingStepNoteSavesRef, handleSaveStepNote, handleBulkStepStatus, selectedExecutionCase, selectedExecutionResult, isSelectedResultDerived, isSelectedCaseAutomated, isSelectedCaseTimerActive, canRecordSelectedCase, selectedExecutionCaseEffectiveUser, selectedExecutionCaseExplicitAssigneeId, selectedExecutionCaseReadableTitle, selectedExecutionCaseReadableDescription, ensureSelectedCaseResult, handleCaseLifecycle, prepareCaseForBulkResult, persistCaseOutcomeOnly } = useExecutionCaseLifecycle({ scope: { selectedExecution, snapshotCases, executionCaseOrder, selectedTestCaseId, selectedExecutionCaseInstance, executionResults, stepsByCaseId, isExecutionLocked, stepNotes, isExecutionStarted, stepStatuses, selectedSteps, bulkSelectedStepIds, resultForCaseInstance, selectedExecutionCaseSnapshot, selectedExecutionStartMode, executionStepParameterValues }, cache: { queryClient, refreshExecutionScope }, access: { session, canManageRunResults, canExecuteRuns }, feedback: { showError, setLinkingDefectStepId, showSuccess, setBulkSelectedStepIds, setLiveNow } });

  const openExecutionEvidence = async (step: Pick<TestStep, "id" | "step_order">, evidence: ExecutionStepEvidence, label = `Step ${step.step_order}`) => {
    if (!hasExecutionEvidence(evidence)) {
      return;
    }
    if (!canViewRunEvidence) {
      showError(new Error("Permission required: result.view and attachment.view"), "Unable to open evidence");
      return;
    }

    setOpeningEvidenceStepId(step.id);
    try {
      closeExecutionEvidence();
      if (evidence.dataUrl) {
        setExecutionEvidencePreview({
          stepLabel: label,
          fileName: evidence.fileName || null,
          mimeType: evidenceMimeType(evidence),
          sourceUrl: evidence.dataUrl
        });
        return;
      }

      const blob = await api.attachments.download(evidence.attachmentId as string);
      const sourceUrl = URL.createObjectURL(blob);
      executionEvidenceObjectUrlRef.current = sourceUrl;
      setExecutionEvidencePreview({
        attachmentId: evidence.attachmentId,
        stepLabel: label,
        fileName: evidence.fileName || null,
        mimeType: evidence.mimeType || blob.type || "application/octet-stream",
        sourceUrl
      });
    } catch (error) {
      showError(error, "Unable to open evidence");
    } finally {
      setOpeningEvidenceStepId((current) => current === step.id ? "" : current);
    }
  };

  const openHookEvidence = (evidence: ExecutionStepEvidence, stepId: string) =>
    openExecutionEvidence({ id: stepId, step_order: 0 }, evidence, stepId.split(":")[1] === "pre" ? "Setup evidence" : "Teardown evidence");

  const handleUploadStepEvidence = async (step: TestStep, file: File) => {
    if (!selectedExecution || !selectedTestCaseId) return;
    const previousEvidence = stepEvidence[step.id];
    if (!canCreateRunEvidence || (hasExecutionEvidence(previousEvidence) && !canDeleteRunEvidence)) {
      showError(new Error("Attachment permissions are required to add or replace evidence."), "Unable to save evidence");
      return;
    }
    const executionId = selectedExecution.id;
    setUploadingEvidenceStepId(step.id);
    try {
      const result = await ensureSelectedCaseResult();
      await uploadExecutionAttachment(result.id, file, { stepId: step.id, expectedRevision: result.revision });
      await queryClient.invalidateQueries({ queryKey: ["execution-result-attachments", result.id] });
      await refreshExecutionScope(executionId);
      showSuccess("Step evidence saved.");
    } catch (error) {
      showError(error, "Unable to save evidence");
    } finally {
      setUploadingEvidenceStepId((current) => current === step.id ? "" : current);
    }
  };

  const handleDeleteStepEvidence = async (step: TestStep) => {
    if (!selectedExecution || !selectedTestCaseId || !canDeleteRunEvidence) return;
    const evidence = stepEvidence[step.id];
    if (!evidence || !(await confirmDelete({ message: `Delete "${evidence.fileName || `Step ${step.step_order} evidence`}" from this run?` }))) return;
    const executionId = selectedExecution.id;
    try {
      const result = await ensureSelectedCaseResult();
      const nativeFiles = evidence.attachmentId ? await api.executionResultAttachments.list(result.id) : [];
      if (evidence.attachmentId && nativeFiles.some(file => file.id === evidence.attachmentId)) {
        await api.executionResultAttachments.delete(result.id, evidence.attachmentId);
        await queryClient.invalidateQueries({ queryKey: ["execution-result-attachments", result.id] });
        await refreshExecutionScope(executionId);
      } else {
        // Historical run-level evidence retains its original ownership.
        await persistCaseResult(selectedTestCaseId, { stepEvidencePatch: { [step.id]: null } });
        if (evidence.attachmentId) {
          try { await api.attachments.delete(evidence.attachmentId); }
          catch (error) {
            await persistCaseResult(selectedTestCaseId, { stepEvidencePatch: { [step.id]: evidence } });
            throw error;
          }
        }
      }
      if (executionEvidencePreview?.attachmentId === evidence.attachmentId || executionEvidencePreview?.sourceUrl === evidence.dataUrl) closeExecutionEvidence();
      showSuccess("Evidence removed.");
    } catch (error) { showError(error, "Unable to delete evidence"); }
  };

  const handleAttachStepNetworkAutomation = async (network: NonNullable<ExecutionStepWebDetail["network"]>) => {
    if (!canBuildRunAutomation) {
      showError(new Error("Permission required: automation.build and automation.code.view"), "Unable to map API automation");
      return;
    }
    if (!selectedExecutionCase?.id || !network.length) {
      return;
    }

    try {
      const response = await attachNetworkAutomationToCase.mutateAsync({ testCaseId: selectedExecutionCase.id, network });
      showSuccess(response.generated_step_count
        ? `Mapped ${response.generated_step_count} API automation step${response.generated_step_count === 1 ? "" : "s"} onto "${selectedExecutionCase.title}".`
        : "Captured network calls did not add executable API steps to this test case.");
      await queryClient.invalidateQueries({ queryKey: ["global-test-cases"] });
    } catch (error) {
      showError(error, "Unable to map API automation from network calls");
    }
  };
  const selectedExecutionCaseReferenceText = formatReferenceList(
    selectedExecutionResult?.external_references?.length
      ? selectedExecutionResult.external_references
      : selectedExecutionCase?.external_references || []
  );
  const selectedExecutionCaseDefectText = formatReferenceList(selectedExecutionResult?.case_defects ?? selectedExecutionResult?.defects ?? []);

  useEffect(() => {
    setCaseReferenceDraft(selectedExecutionCaseReferenceText);
    setCaseDefectDraft(selectedExecutionCaseDefectText);
  }, [selectedExecutionCaseDefectText, selectedExecutionCaseReferenceText, selectedExecution?.id, selectedExecutionCase?.id, selectedExecutionCaseInstance?.instance_key]);

  const openExecutionGroupAutomationPreview = (groupName: string, steps: TestStep[]) => {
    if (!canPreviewRunAutomation) return;
    setCodePreviewState({
      title: `${groupName} automation`,
      subtitle: "This is the snapped automation for the selected run.",
      code: buildGroupAutomationCode(groupName, steps)
    });
  };

  const openExecutionStepAutomationPreview = (step: TestStep) => {
    if (!canPreviewRunAutomation) return;
    setCodePreviewState({
      title: `Step ${step.step_order} automation`,
      subtitle: "Run snapshots are read-only. This preview reflects the preserved step automation for this run.",
      code: resolveStepAutomationCode(step)
    });
  };

  const handleRunExecutionApiStep = async (step: TestStep) => {
    if (!selectedExecution || !selectedTestCaseId) {
      return;
    }
    if (!canExecuteRuns || !canManageRunResults || !isExecutionStarted || isExecutionLocked || !canRecordSelectedCase) {
      showError(new Error("Start or resume the case before running a step."), "Unable to run API step");
      return;
    }

    setRunningExecutionApiStepId(step.id);

    try {
      const response = await runExecutionApiStep.mutateAsync({
        executionId: selectedExecution.id,
        testCaseId: selectedTestCaseId,
        stepId: step.id,
        dataSetIterationIndex: selectedExecutionCaseInstance?.data_set_iteration_index ?? undefined
      });

      await refreshExecutionScope(selectedExecution.id);
      if (step.step_type === "api" || response.detail) {
        setExecutionApiDetailState({
          step,
          detail: response.detail,
          captures: response.detail?.captures || response.captures || {},
          note: response.note,
          status: response.step_status || "queued"
        });
      }
      showSuccess(
        response.queued_for_engine
          ? `Step ${step.step_order} queued for Test Engine.`
          : `Step ${step.step_order} ${response.step_status}.`
      );
    } catch (error) {
      showError(error, "Unable to run step");
    } finally {
      setRunningExecutionApiStepId((current) => (current === step.id ? "" : current));
    }
  };

  const handleRunExecutionAiAnalysis = async () => {
    if (!selectedExecution || !executionCaseOrder.length) return;
    if (!canUseRunAi) {
      showError(new Error("Permission required: run.ai"), "Unable to refresh run evidence analysis");
      return;
    }
    if (!["completed", "failed"].includes(currentExecutionStatus)) {
      showError(new Error("Complete the run before running evidence analysis."), "Unable to refresh run evidence analysis");
      return;
    }

    const executionId = selectedExecution.id;
    if (activeRunAnalysisIdsRef.current.has(executionId)) return;
    activeRunAnalysisIdsRef.current.add(executionId);
    const cases = executionCaseOrder;
    let recordedCount = 0;
    let previewOnlyCount = 0;
    const updateOperation = (status: "running" | "completed" | "failed", error: string | null = null) => {
      const operation = {
        status, error, recordedCount, previewOnlyCount,
        completedCaseCount: recordedCount + previewOnlyCount,
        totalCaseCount: cases.length
      };
      setRunAnalysisOperations((current) => ({ ...current, [executionId]: operation }));
    };
    updateOperation("running");

    try {
      for (const testCase of cases) {
        const response = await runExecutionAiAnalysis.mutateAsync({
          executionId,
          testCaseId: testCase.id,
          instruction: runAnalysisInstruction,
          interactionMode: runAnalysisInteractionMode
        });
        if (response.recorded) recordedCount += 1;
        else previewOnlyCount += 1;
        updateOperation("running");
      }

      await refreshExecutionScope(executionId);
      updateOperation("completed");
      if (selectedAnalysisExecutionIdRef.current === executionId) {
        setIsExecutionAiAnalysisExpanded(true);
        showSuccess([
          `Evidence analysis recorded for ${recordedCount} case${recordedCount === 1 ? "" : "s"}.`,
          previewOnlyCount ? `${previewOnlyCount} case${previewOnlyCount === 1 ? " has" : "s have"} no result to attach analysis to yet.` : ""
        ].filter(Boolean).join(" "));
      }
    } catch (error) {
      if (recordedCount > 0 && recordedCount + previewOnlyCount < cases.length) {
        // Preserve analyses already saved before a later case failed.
        await refreshExecutionScope(executionId).catch(() => undefined);
      }
      updateOperation("failed", error instanceof Error ? error.message : "The analysis could not be completed. You can retry.");
      if (selectedAnalysisExecutionIdRef.current === executionId) {
        showError(error, "Unable to refresh run evidence analysis");
      }
    } finally {
      activeRunAnalysisIdsRef.current.delete(executionId);
    }
  };

  const handlePreviewFailureClusters = () => {
    if (!selectedExecution || !projectId || !canUseRunAi) return;
    setIsFailureClusterPreviewOpen(true);
    previewExecutionFailureClusters.reset();
    previewExecutionFailureClusters.mutate({
      executionId: selectedExecution.id,
      input: { project_id: projectId, scope: "failed-and-blocked" }
    });
  };

  const openExecutionApiDetail = (step: TestStep) => {
    if (!canViewRunAutomationCode) return;
    setExecutionApiDetailState({
      step,
      detail: stepApiDetails[step.id] || null,
      captures: stepCaptures[step.id] || stepApiDetails[step.id]?.captures || {},
      note: stepNotes[step.id] || "",
      status: stepStatuses[step.id] || "queued"
    });
  };

  useEffect(() => {
    setCaseAssignmentDraft(selectedExecutionCaseExplicitAssigneeId);
  }, [selectedExecutionCase?.id, selectedExecutionCaseExplicitAssigneeId]);

  useEffect(() => {
    setCodePreviewState(null);
  }, [selectedExecutionId, selectedTestCaseId]);

  useEffect(() => {
    if (!canViewRunAutomationCode) {
      setCodePreviewState(null);
      setExecutionApiDetailState(null);
      setExecutionStepViewMode((current) => current === "automation" ? "structured" : current);
    }
  }, [canViewRunAutomationCode]);

  useEffect(() => {
    if (!canViewRunGherkin) setExecutionStepViewMode((current) => current === "gherkin" ? "structured" : current);
  }, [canViewRunGherkin]);

  const resolveCaseDurationMs = (_caseInstanceKey: string, result?: ExecutionResult | null) =>
    getExecutionResultDurationMs(result, liveNow);

  const selectedStepProgress = useMemo(() => {
    const passedCount = selectedSteps.filter((step) => stepStatuses[step.id] === "passed").length;
    const failedCount = selectedSteps.filter((step) => stepStatuses[step.id] === "failed").length;
    const pendingCount = Math.max(selectedSteps.length - passedCount - failedCount, 0);
    const percent = selectedSteps.length ? Math.round(((passedCount + failedCount) / selectedSteps.length) * 100) : 0;

    return {
      passedCount,
      failedCount,
      pendingCount,
      percent
    };
  }, [selectedSteps, stepStatuses]);

  const selectedExecutionDurationMs = useMemo(
    () => executionResults.reduce((sum, result) => sum + getExecutionResultDurationMs(result, liveNow), 0),
    [executionResults, liveNow]
  );

  const selectedCaseDurationMs = useMemo(
    () => (selectedExecutionCaseInstance
      ? resolveCaseDurationMs(selectedExecutionCaseInstance.instance_key, selectedExecutionResult)
      : null),
    [isExecutionLocked, isExecutionStarted, liveNow, selectedExecutionCaseInstance, selectedExecutionResult]
  );

  const averageCaseDurationMs = useMemo(
    () => averageDuration(latestExecutionResults.map((result) => result.duration_ms)),
    [latestExecutionResults]
  );

  const resolveExecutionCaseDurationMs = (testCase: ExecutionCaseView) => executionResults
    .filter((result) => result.test_case_id === testCase.id)
    .reduce((sum, result) => sum + getExecutionResultDurationMs(result, liveNow), 0);

  const suiteDurationById = useMemo(() => {
    return executionSuites.reduce<Record<string, number | null>>((accumulator, suite) => {
      const suiteCases = displayCasesBySuiteId[suite.id] || [];
      const total = suiteCases.reduce((sum, testCase) => {
        const duration = resolveExecutionCaseDurationMs(testCase);
        return sum + (duration || 0);
      }, 0);
      accumulator[suite.id] = total > 0 ? total : null;
      return accumulator;
    }, {});
  }, [displayCasesBySuiteId, executionSuites, executionResults, isExecutionLocked, isExecutionStarted, liveNow]);

  const filteredExecutionSuites = useMemo(() => {
    const query = executionSuiteSearch.trim().toLowerCase();

    if (!query) {
      return executionSuites;
    }

    return executionSuites.filter((suite) => {
      const suiteCases = displayCasesBySuiteId[suite.id] || [];
      const suiteMetric = suiteMetrics.find((item) => item.suiteId === suite.id);
      const suiteImpactSummary = selectedSuiteImpactSummaryById[suite.id] || EMPTY_EXECUTION_RUN_IMPACT_SUMMARY;
      const suiteStatus = suiteMetric ? suiteBoardStatus(suiteMetric) : "queued";
      const searchableValues = [
        suite.id,
        suite.name,
        suiteStatus,
        `${suiteCases.length} cases`,
        `${suiteMetric?.passedCount || 0} passed`,
        `${suiteMetric?.failedCount || 0} failed`,
        `${suiteMetric?.blockedCount || 0} blocked`,
        `${suiteImpactSummary.failedRequirementCount} impacted stories`,
        ...suiteCases.flatMap((testCase) => [
          testCase.id,
          testCase.title,
          richTextToPlainText(testCase.description),
          testCase.suite_name || ""
        ])
      ];

      return searchableValues.some((value) => String(value || "").toLowerCase().includes(query));
    });
  }, [displayCasesBySuiteId, executionSuiteSearch, executionSuites, selectedSuiteImpactSummaryById, suiteMetrics]);

  const filteredExecutionCaseOrder = useMemo(() => {
    const query = executionCaseSearch.trim().toLowerCase();

    if (!query) {
      return executionCaseOrder;
    }

    return executionCaseOrder.filter((testCase) => {
      const status = caseDerivedStatus(testCase);
      const assignedUser = testCase.assigned_user || selectedExecution?.assigned_user || null;
      const searchableValues = [
        testCase.id,
        testCase.title,
        richTextToPlainText(testCase.description),
        testCase.suite_name || "",
        status,
        `P${testCase.priority || 3}`,
        `${(stepsByCaseId[testCase.id] || []).length} steps`,
        assignedUser ? resolveUserPrimaryLabel(assignedUser) : "Unassigned"
      ];

      return searchableValues.some((value) => String(value || "").toLowerCase().includes(query));
    });
  }, [executionCaseOrder, executionCaseSearch, resultByCaseId, selectedExecution?.assigned_user, stepsByCaseId]);

  const filteredDisplayCasesBySuiteId = useMemo(() => {
    const query = executionCaseSearch.trim().toLowerCase();

    if (!query) {
      return displayCasesBySuiteId;
    }

    return Object.entries(displayCasesBySuiteId).reduce<Record<string, ExecutionCaseView[]>>((accumulator, [suiteId, suiteCases]) => {
      accumulator[suiteId] = suiteCases.filter((testCase) => {
        const status = caseDerivedStatus(testCase);
        const assignedUser = testCase.assigned_user || selectedExecution?.assigned_user || null;
        const searchableValues = [
          testCase.id,
          testCase.title,
          richTextToPlainText(testCase.description),
          testCase.suite_name || "",
          status,
          `P${testCase.priority || 3}`,
          `${(stepsByCaseId[testCase.id] || []).length} steps`,
          assignedUser ? resolveUserPrimaryLabel(assignedUser) : "Unassigned"
        ];

        return searchableValues.some((value) => String(value || "").toLowerCase().includes(query));
      });
      return accumulator;
    }, {});
  }, [displayCasesBySuiteId, executionCaseSearch, resultByCaseId, selectedExecution?.assigned_user, stepsByCaseId]);

  const executionResultsWithTiming = useMemo(
    () => latestExecutionResults.filter((result) => typeof result.duration_ms === "number").length,
    [latestExecutionResults]
  );

  const queuedCases = useMemo(
    () => executionCaseOrder.filter((testCase) => caseDerivedStatus(testCase) === "queued"),
    [executionCaseOrder, resultByCaseId]
  );

  const nextFocusCase = useMemo(
    () => filteredExecutionCaseOrder.find(testCase => !["passed", "failed", "blocked", "skipped", "aborted"].includes(caseDerivedStatus(testCase))) || filteredExecutionCaseOrder[0] || null,
    [filteredExecutionCaseOrder, resultByCaseId]
  );

  const runReferenceContext = useMemo(() => executionFailureReferenceContext(selectedExecution), [selectedExecution]);

  const selectedRunEvidenceReadiness = useMemo(
    () => assessExecutionRunEvidence(selectedExecution, {
      totalCaseCount: executionProgress.totalCases,
      touchedCaseCount: executionProgress.completedCases,
      linkedRequirementCount: selectedExecution
        ? runStoryCounts(selectedExecution, selectedExecutionImpactSummary).total
        : selectedExecutionImpactSummary.totalRequirements,
      failedCount: executionStatusCounts.failed,
      blockedCount: executionStatusCounts.blocked
    }),
    [executionProgress.completedCases, executionProgress.totalCases, executionStatusCounts.blocked, executionStatusCounts.failed, selectedExecution, selectedExecutionImpactSummary.totalRequirements]
  );
  const failureClusterFindings = useMemo<AiPreviewFinding[]>(
    () => (previewExecutionFailureClusters.data?.clusters || []).map((cluster) => ({
      id: cluster.id,
      title: `${cluster.label} · ${cluster.count} result${cluster.count === 1 ? "" : "s"}`,
      severity: cluster.id === "unclassified" ? "high" : cluster.count > 2 ? "medium" : "info",
      description: cluster.explanation,
      action: cluster.recommended_action,
      meta: `Model-reviewed hypothesis · ${cluster.count} observed outcomes`,
      evidence: cluster.evidence_refs
    })),
    [previewExecutionFailureClusters.data]
  );

  const runAiAnalysis = useMemo<(ExecutionAiAnalysis & { recordedCaseCount: number }) | null>(() => {
	    if (!selectedExecution || !["completed", "failed"].includes(currentExecutionStatus)) {
	      return null;
	    }

	    const selectedRunStartedAt = toTimestamp(selectedExecution.started_at)
	      || toTimestamp(selectedExecution.created_at)
	      || 0;

	    const caseAnalysisRows = executionCaseOrder
	      .map((testCase) => {
	        const result = resultByCaseId[testCase.id] || null;
	        const analysis = parseExecutionLogs(result?.logs || null).aiAnalysis || null;

	        if (!result || result.execution_id !== selectedExecution.id || !analysis) {
	          return null;
	        }

	        if (analysis.executionId && analysis.executionId !== selectedExecution.id) {
	          return null;
	        }

	        if (analysis.testCaseId && analysis.testCaseId !== testCase.id) {
	          return null;
	        }

	        const generatedAt = toTimestamp(analysis.generatedAt);

	        if (generatedAt && selectedRunStartedAt && generatedAt < selectedRunStartedAt) {
	          return null;
	        }

	        return {
	          analysis,
	          result,
	          status: caseDerivedStatus(testCase),
	          testCase
	        };
	      })
	      .filter((row): row is { analysis: ExecutionAiAnalysis; result: ExecutionResult; status: ReturnType<typeof caseDerivedStatus>; testCase: ExecutionCaseView } => Boolean(row));
    const latestAnalysis = caseAnalysisRows
      .map((row) => row.analysis)
      .filter((analysis): analysis is ExecutionAiAnalysis => Boolean(analysis))
      .sort((left, right) => String(right.generatedAt || "").localeCompare(String(left.generatedAt || "")))[0] || null;
    const suiteLines = executionSuites.length
      ? executionSuites.map((suite) => {
          const suiteMetric = suiteMetrics.find((item) => item.suiteId === suite.id);
          return `- ${suite.name}: ${suiteMetric?.count || 0} case instances, ${suiteMetric?.passedCount || 0} passed, ${suiteMetric?.failedCount || 0} failed, ${suiteMetric?.blockedCount || 0} blocked.`;
        })
      : ["- Direct test case run with no suite grouping."];
    const riskLines = executionFailureRiskLines(selectedExecution, executionCaseOrder);
    const caseAnalysisLines = caseAnalysisRows.length
      ? caseAnalysisRows.slice(0, 6).map((row) => {
          const response = row.analysis?.response.trim().replace(/\s+/g, " ") || "No analysis text.";
          return `- ${row.testCase.title}: ${response.slice(0, 420)}${response.length > 420 ? "..." : ""}`;
        })
      : ["- No per-case evidence analysis has been recorded yet. Run analysis to refresh all case-level signals and rebuild this rollup."];

    return {
      recordedCaseCount: caseAnalysisRows.length,
      generatedAt: latestAnalysis?.generatedAt || selectedExecution.updated_at || selectedExecution.created_at,
      integration: latestAnalysis?.integration,
      response: [
        "Run-level analysis consolidated from the current run snapshot, suites, cases, result evidence, references, defects, and recorded case analysis.",
        "",
        `Run: ${selectedExecution.name || selectedExecution.id}`,
        `Status: ${currentExecutionStatus}. Scope: ${executionProgress.totalCases} case instances, ${executionSuites.length} suites, ${executionStatusCounts.passed} passed, ${executionStatusCounts.failed} failed, ${executionStatusCounts.blocked} blocked, ${Math.max(executionProgress.totalCases - executionProgress.completedCases, 0)} remaining.`,
        "",
        "Suite coverage:",
        ...suiteLines,
        "",
        "Risk and reference focus:",
        ...riskLines,
        "",
        "Case analysis signals:",
        ...caseAnalysisLines
      ].join("\n")
    };
  }, [currentExecutionStatus, executionCaseOrder, executionProgress.completedCases, executionProgress.totalCases, executionStatusCounts.blocked, executionStatusCounts.failed, executionStatusCounts.passed, executionSuites, resultByCaseId, selectedExecution, suiteMetrics]);

  const hasRecordedRunAnalysis = Boolean(runAiAnalysis?.recordedCaseCount);
  const runAnalysisWorkflowStatus = selectedRunAnalysisOperation?.status || (hasRecordedRunAnalysis ? "completed" : "idle");
  const runAnalysisWorkflowOutcome = selectedRunAnalysisOperation
    ? selectedRunAnalysisOperation.status === "running"
      ? `${selectedRunAnalysisOperation.completedCaseCount} of ${selectedRunAnalysisOperation.totalCaseCount} cases analyzed. The review remains active until all results are refreshed.`
      : selectedRunAnalysisOperation.status === "failed"
        ? `Analysis stopped after ${selectedRunAnalysisOperation.completedCaseCount} of ${selectedRunAnalysisOperation.totalCaseCount} cases. ${selectedRunAnalysisOperation.error} ${selectedRunAnalysisOperation.recordedCount ? `${selectedRunAnalysisOperation.recordedCount} case analyses were saved before this failure. ` : ""}You can retry this analysis.`
        : `Analysis completed for ${selectedRunAnalysisOperation.totalCaseCount} cases. ${selectedRunAnalysisOperation.recordedCount} analyses recorded${selectedRunAnalysisOperation.previewOnlyCount ? `; ${selectedRunAnalysisOperation.previewOnlyCount} previews could not be attached to a result` : ""}.`
    : hasRecordedRunAnalysis
      ? `${runAiAnalysis?.recordedCaseCount} recorded case analyses are included in Evidence Analysis.`
      : "No Failure Analyst analysis has been recorded for this run. Evidence Analysis contains a summary of the saved run results.";

  useEffect(() => {
    const next = { executionId: selectedExecutionId, response: runAiAnalysis?.response || "", generatedAt: runAiAnalysis?.generatedAt || "" };
    const previous = runAnalysisReviewSourceRef.current;
    if (!previous || previous.executionId !== next.executionId) {
      setRunAnalysisReviewDraft(next.response);
      setRunAnalysisSourceChanged(false);
      setIsRunAnalysisReviewAccepted(false);
    } else if (previous.response !== next.response || previous.generatedAt !== next.generatedAt) {
      const hasEdits = runAnalysisReviewDraft !== previous.response;
      if (!hasEdits) setRunAnalysisReviewDraft(next.response);
      setRunAnalysisSourceChanged(hasEdits);
      setIsRunAnalysisReviewAccepted(false);
    } else if (runAnalysisReviewDraft === next.response) {
      setRunAnalysisSourceChanged(false);
    }
    runAnalysisReviewSourceRef.current = next;
  }, [runAiAnalysis?.response, runAiAnalysis?.generatedAt, runAnalysisReviewDraft, selectedExecutionId]);

  useEffect(() => {
    setIsRunEvidenceAnalysisOpen(false);
    setIsRunWorkflowOpen(false);
  }, [selectedExecutionId]);

  const selectedCaseHistory = useMemo(
    () =>
      selectedTestCaseId
        ? allExecutionResults
            .filter((result) => result.test_case_id === selectedTestCaseId)
            .slice()
            .sort((left, right) => String(right.created_at || "").localeCompare(String(left.created_at || "")))
        : [],
    [allExecutionResults, selectedTestCaseId]
  );

  const resolvedStepNoteCount = useMemo(
    () => Object.values(stepNotes).filter((value) => value.trim()).length,
    [stepNotes]
  );
  const resolvedStepImageCount = useMemo(
    () => Object.values(stepEvidence).filter(hasExecutionEvidence).length,
    [stepEvidence]
  );
  const resolvedEvidenceArtifactCount = resolvedStepNoteCount + resolvedStepImageCount;
  const selectedRuntimeTelemetry = useMemo(() => {
    const webDetails = Object.values(stepWebDetails || {});
    const consoleCount = webDetails.reduce((total, detail) => total + (detail?.console?.length || 0), 0);
    const networkCount = webDetails.reduce((total, detail) => total + (detail?.network?.length || 0), 0);
    const timedWebSteps = webDetails.filter((detail) => typeof detail?.duration_ms === "number");
    const webDurationMs = timedWebSteps.reduce((total, detail) => total + Number(detail?.duration_ms || 0), 0);

    return {
      webStepCount: webDetails.length,
      consoleCount,
      networkCount,
      artifactCount: resolvedEvidenceArtifactCount,
      avgWebDurationMs: timedWebSteps.length ? Math.round(webDurationMs / timedWebSteps.length) : null
    };
  }, [resolvedEvidenceArtifactCount, stepWebDetails]);

  const selectedExecutionAppTypeLabel =
    appTypeNameById[selectedExecution?.app_type_id || ""] || selectedExecution?.app_type_id || "No app type scoped";
  const selectedExecutionProjectLabel =
    projectNameById[selectedExecution?.project_id || ""] ||
    projects.find((project) => project.id === selectedExecution?.project_id)?.name ||
    selectedExecution?.project_id ||
    "No project scoped";
  const currentExecutionAssigneeIds = selectedExecution?.assigned_to_ids?.length ? selectedExecution.assigned_to_ids : selectedExecution?.assigned_to ? [selectedExecution.assigned_to] : [];
  const hasExecutionAssignmentChange =
    executionAssignmentDraftIds.length !== currentExecutionAssigneeIds.length
    || executionAssignmentDraftIds.some((assigneeId) => !currentExecutionAssigneeIds.includes(assigneeId));
  const hasCaseAssignmentChange = caseAssignmentDraft !== selectedExecutionCaseExplicitAssigneeId;
  const hasCaseReferenceChange =
    caseReferenceDraft.trim() !== selectedExecutionCaseReferenceText
    || caseDefectDraft.trim() !== selectedExecutionCaseDefectText;
  const selectedExecutionCaseAssignmentHint = selectedExecutionCaseEffectiveUser
    ? `${resolveUserPrimaryLabel(selectedExecutionCaseEffectiveUser)} · ${selectedExecutionCase?.assignment_source || "run"} assignment`
    : "Uses the run assignee unless a suite, module, or case assignee is set.";
  const remainingCaseCount = Math.max(executionProgress.totalCases - executionProgress.completedCases, 0);
  const isSelectedExecutionTestCaseRun = Boolean(selectedExecution && !selectedExecutionSuiteIds.length);
  const selectedCaseStatusLabel = selectedExecutionCaseInstance ? instanceDerivedStatus(selectedExecutionCaseInstance) : executionProgress.derivedStatus;
  const { focusExecutionCase, executionCaseInstanceOrder, selectedExecutionCaseInstanceIndex, previousExecutionCaseInstance, nextExecutionCaseInstance, focusNeighborExecutionCase } = useExecutionCaseNavigation({ selection: { selectedExecutionId, dismissedExecutionRouteRef, dismissedCaseRouteRef, setFocusedSuiteId, setSelectedExecutionId, setSelectedTestCaseId, setSelectedCaseInstanceKey, selectedExecutionCaseInstance }, scope: { executionCaseOrder, filteredExecutionCaseOrder }, navigation: { syncExecutionSearchParams, pendingStepNoteSavesRef } });

  const activeExecutionStage = selectedExecutionCase ? "case" : selectedExecution ? (isSelectedExecutionTestCaseRun ? "cases" : "suites") : "executions";
  const showExecutionListHeader =
    testRunsView === "scheduled-runs"
      ? !selectedSchedule
      : testRunsView === "batch-process"
        ? !selectedWorkspaceTransaction
        : !selectedExecution;
  const executionControlTitle =
    currentExecutionStatus === "running"
      ? "Run is live"
      : currentExecutionStatus === "queued"
        ? "Run ready to start"
        : currentExecutionStatus === "aborted"
          ? "Run was aborted"
          : "Run locked";
  const executionControlDescription =
    currentExecutionStatus === "running"
      ? `${formatDuration(selectedExecutionDurationMs, DEFAULT_DURATION_LABEL)} active case time across the run.`
      : currentExecutionStatus === "queued"
        ? "Start the run before step-level result capture."
        : currentExecutionStatus === "aborted"
          ? "This run was stopped early. Captured evidence remains available for review."
          : "This run has been completed. Evidence remains available for review.";

  const openWorkspaceTransactionDetail = (transactionId: string) => {
    setSelectedOperationId(transactionId);
  };
  const closeWorkspaceTransactionDetail = () => {
    setSelectedOperationId("");
  };

  const renderExecutionSuiteRowActions = (suite: ExecutionSuiteNode) => (
    <CatalogActionMenu
      actions={[
        {
          label: "Open suite",
          description: "Show this suite's snapped cases.",
          icon: <OpenIcon />,
          onClick: () => {
            setFocusedSuiteId(suite.id);
            setExpandedExecutionSuiteIds((current) => (current.includes(suite.id) ? current : [...current, suite.id]));
          }
        }
      ]}
      label={`${suite.name} actions`}
    />
  );

  const renderExecutionCaseRowActions = (testCase: ExecutionCaseView) => (
    <CatalogActionMenu
      actions={[
        {
          label: "Open case",
          description: "Open the run console for this case.",
          icon: <OpenIcon />,
          onClick: () => focusExecutionCase(testCase.id)
        }
      ]}
      label={`${testCase.title} actions`}
    />
  );







  const executionSuiteListColumns = useMemo<Array<DataTableColumn<ExecutionSuiteNode>>>(() => [
    {
      key: "suite",
      label: "Suite",
      canToggle: false,
      minWidth: 220,
      render: (suite) => (
        <div className="automation-list-primary-cell">
          <strong>{suite.name}</strong>
          <span>{suite.id}</span>
        </div>
      ),
      sortValue: (suite) => suite.name
    },
    {
      key: "status",
      label: "Status",
      render: (suite) => {
        const suiteMetric = suiteMetrics.find((item) => item.suiteId === suite.id);
        return suiteMetric ? suiteBoardStatus(suiteMetric) : "queued";
      }
    },
    {
      key: "cases",
      label: "Cases",
      render: (suite) => (displayCasesBySuiteId[suite.id] || []).length
    },
    {
      key: "resolved",
      label: "Resolved",
      render: (suite) => {
        const suiteMetric = suiteMetrics.find((item) => item.suiteId === suite.id);
        const resolvedCount = suiteMetric?.completedCount || 0;
        return `${resolvedCount}/${suiteMetric?.count || 0}`;
      }
    },
    {
      key: "issues",
      label: "Defects",
      render: (suite) => {
        const suiteMetric = suiteMetrics.find((item) => item.suiteId === suite.id);
        return (suiteMetric?.failedCount || 0) + (suiteMetric?.blockedCount || 0);
      }
    },
    {
      key: "requirements",
      label: "Impacted stories",
      defaultVisible: false,
      render: (suite) => {
        const summary = selectedSuiteImpactSummaryById[suite.id] || EMPTY_EXECUTION_RUN_IMPACT_SUMMARY;
        return summary.totalRequirements ? `${summary.failedRequirementCount}/${summary.totalRequirements}` : "0";
      }
    },
    {
      key: "duration",
      label: "Duration",
      render: (suite) => formatDuration(suiteDurationById[suite.id], DEFAULT_DURATION_LABEL)
    }
  ], [displayCasesBySuiteId, selectedSuiteImpactSummaryById, suiteDurationById, suiteMetrics]);

  const executionCaseListColumns = useMemo<Array<DataTableColumn<ExecutionCaseView>>>(() => [
    {
      key: "case",
      label: "Test case",
      canToggle: false,
      minWidth: 240,
      render: (testCase) => (
        <div className="automation-list-primary-cell execution-case-list-copy">
          <strong title={testCase.title}>{testCase.title}</strong>
          <span>{richTextToPlainText(testCase.description) || "No description provided"}</span>
        </div>
      ),
      sortValue: (testCase) => testCase.title
    },
    {
      key: "status",
      label: "Status",
      render: (testCase) => caseDerivedStatus(testCase)
    },
    {
      key: "suite",
      label: "Suite",
      render: (testCase) => testCase.suite_name || "Test case run"
    },
    {
      key: "module",
      label: "Module",
      render: (testCase) => testCase.module_name || "Unassigned module",
      sortValue: (testCase) => testCase.module_name || "Unassigned module"
    },
    {
      key: "priority",
      label: "Priority",
      render: (testCase) => `P${testCase.priority || 3}`
    },
    {
      key: "steps",
      label: "Steps",
      render: (testCase) => (stepsByCaseId[testCase.id] || []).length
    },
    {
      key: "duration",
      label: "Duration",
      render: (testCase) => formatDuration(resolveExecutionCaseDurationMs(testCase), DEFAULT_DURATION_LABEL)
    },
    {
      key: "assignee",
      label: "Assignee",
      render: (testCase) => {
        const assignedUser = testCase.assigned_user || selectedExecution?.assigned_user || null;
        return assignedUser ? resolveUserPrimaryLabel(assignedUser) : "Unassigned";
      }
    },
    {
      key: "references",
      label: "References",
      defaultVisible: false,
      render: (testCase) => testCase.external_references.length
    }
  ], [isExecutionLocked, isExecutionStarted, liveNow, resultByCaseInstanceKey, selectedExecution?.assigned_user, selectedExecutionId, stepsByCaseId]);





  const smartPreviewCases = smartExecutionPreview?.cases || [];
  const selectedSmartExecutionCases = useMemo(
    () => smartPreviewCases.filter((testCase) => selectedSmartExecutionCaseIds.includes(testCase.test_case_id)),
    [selectedSmartExecutionCaseIds, smartPreviewCases]
  );
  const selectedSmartExecutableCaseIds = useMemo(
    () =>
      selectedSmartExecutionCases
        .filter((testCase) => executionStartMode === "manual" || smartExecutionLibraryCaseById.get(testCase.test_case_id)?.automated === "yes")
        .map((testCase) => testCase.test_case_id),
    [executionStartMode, selectedSmartExecutionCases, smartExecutionLibraryCaseById]
  );

  useEffect(() => {
    if (executionCreateMode !== "smart" || executionStartMode === "manual" || !selectedSmartExecutionCaseIds.length) {
      return;
    }

    const automatedSelectedIds = retainEligibleRunCases(selectedSmartExecutionCaseIds, smartExecutionLibraryCaseById, true);

    if (automatedSelectedIds.length !== selectedSmartExecutionCaseIds.length) {
      setSelectedSmartExecutionCaseIds(automatedSelectedIds);
    }
  }, [executionCreateMode, executionStartMode, selectedSmartExecutionCaseIds, smartExecutionLibraryCaseById]);

  const canCreateSelectedRunMode = executionStartMode === "local"
    ? canRunLocalAutomation
    : executionStartMode === "remote" ? canRunRemoteAutomation : canCreateManualRuns;
  const hasCurrentSmartExecutionPreview = Boolean(
    smartExecutionPreview
    && smartExecutionPreviewScopeKey
    && smartExecutionPreviewScopeKey === buildSmartExecutionScopeKey()
  );
  const isResolvingSmartRunCases = can("testcase.view") && executionCreateMode === "smart" && executionStartMode !== "manual" && selectedSmartExecutionCaseIds.some(id => !smartExecutionLibraryCaseById.has(id));
  const hasUnavailableSmartCases = isResolvingSmartRunCases && runPickerCaseQueries.every(query => !query.isPending && !query.isFetching);
  const runCaseResolutionError = runPickerCaseQueries.find(query => query.isError)?.error
    || (hasUnavailableSmartCases ? new Error("Some selected cases are unavailable in the current project. Retry their details or remove them.") : null);
  const resolvedDirectCaseById = new Map(resolvedDirectCases.map(testCase => [testCase.id, testCase]));
  const ineligibleDirectCaseCount = executionCreateMode === "manual" && executionStartMode !== "manual"
    ? selectedDirectCaseIds.filter(id => resolvedDirectCaseById.get(id)?.automated !== "yes").length : 0;
  const directCaseSelectionMessage = ineligibleDirectCaseCount
    ? `${ineligibleDirectCaseCount} selected direct ${ineligibleDirectCaseCount === 1 ? "case is" : "cases are"} not confirmed automated. Choose Manual or remove these cases to create an automated run.` : "";
  const isResolvingDeliveryPrefill = Boolean(pendingNavigationDelivery) || (canViewDeliveryScopes && hasCreateExecutionDeepLink && Boolean(searchParams.get("release_id") || searchParams.get("sprint_id")));
  const canCreateExecution = canCreateSelectedRunMode && !isResolvingSmartRunCases && !isResolvingDeliveryPrefill && !ineligibleDirectCaseCount && (
    executionCreateMode === "smart"
      ? Boolean(canUseRunAi && can("testcase.view") && projectId && appTypeId && hasCurrentSmartExecutionPreview && selectedSmartExecutableCaseIds.length)
      : Boolean(projectId && appTypeId && ((can("suite.view") && selectedSuiteIds.length) || (can("testcase.view") && selectedDirectCaseIds.length)))
  );

  const handleSuiteBulkStatus = async (suiteId: string, status: "passed" | "failed") => {
    if (!selectedExecution || !canExecuteRuns || !canManageRunResults || !isExecutionStarted || isExecutionLocked) {
      return;
    }

    const suiteCases = displayCasesBySuiteId[suiteId] || [];
    if (!suiteCases.length) {
      return;
    }

    try {
      for (const testCase of suiteCases) {
        const steps = stepsByCaseId[testCase.id] || [];
        for (const instance of testCase.data_set_instances) {
          if (steps.length) {
            await prepareCaseForBulkResult(instance);
            const patch = steps.reduce<Record<string, ExecutionStepStatus>>((acc, step) => {
              acc[step.id] = status;
              return acc;
            }, {});
            await persistCaseResult(testCase.id, { stepStatusesPatch: patch }, { refresh: false, instance });
          } else {
            await persistCaseOutcomeOnly(testCase.id, status, instance);
          }
        }
      }

      await refreshExecutionScope();
      showSuccess(`Suite marked ${status} for all cases.`);
    } catch (error) {
      await refreshExecutionScope();
      showError(error, "Unable to update suite");
    }
  };

  const renderExecutionCaseCatalog = ({
    cases,
    emptyMessage,
    suiteId,
    suiteName
  }: {
    cases: ExecutionCaseView[];
    emptyMessage: string;
    suiteId?: string;
    suiteName: string;
  }) => {
    const resolvedEmptyMessage = executionCaseSearch.trim() ? "No cases match the current search." : emptyMessage;
    const moduleGroups = suiteId
      ? Object.values(cases.reduce<Record<string, { id: string; name: string; cases: ExecutionCaseView[] }>>((groups, testCase) => {
          const moduleId = testCase.module_id || "unassigned-module";
          groups[moduleId] = groups[moduleId] || { id: moduleId, name: testCase.module_name || "Unassigned module", cases: [] };
          groups[moduleId].cases.push(testCase);
          return groups;
        }, {}))
      : [];
    const renderCaseCards = (scopedCases: ExecutionCaseView[]) => scopedCases.map((testCase) => (
      <ExecutionSuiteCaseCard
        assignedUser={testCase.assigned_user || selectedExecution?.assigned_user || null}
        caseStatus={caseDerivedStatus(testCase)}
        durationLabel={formatDuration(resolveExecutionCaseDurationMs(testCase), DEFAULT_DURATION_LABEL)}
        getInstanceStatus={instanceDerivedStatus}
        isActive={selectedTestCaseId === testCase.id}
        isNext={nextFocusCase?.id === testCase.id}
        key={`${testCase.suite_id || "direct"}-${testCase.module_id || "unassigned"}-${testCase.id}`}
        onSelect={() => focusExecutionCase(testCase.id)}
        onSelectInstance={(instanceKey) => focusExecutionCase(testCase.id, selectedExecutionId, instanceKey)}
        selectedInstanceKey={selectedTestCaseId === testCase.id ? selectedCaseInstanceKey : ""}
        stepCount={(stepsByCaseId[testCase.id] || []).length}
        suiteName={suiteName}
        testCase={testCase}
      />
    ));
    const getModuleExpansionKey = (moduleId: string) => `${selectedExecution?.id || "run"}:${suiteId || "direct"}:${moduleId}`;
    const renderExecutionModuleHeader = (module: typeof moduleGroups[number]) => {
      const moduleInstances = module.cases.flatMap((testCase) => testCase.data_set_instances);
      const passed = moduleInstances.filter((instance) => instanceDerivedStatus(instance) === "passed").length;
      const failed = moduleInstances.filter((instance) => instanceDerivedStatus(instance) === "failed").length;
      const blocked = moduleInstances.filter((instance) => instanceDerivedStatus(instance) === "blocked").length;
      const resolved = passed + failed + blocked;
      const completion = moduleInstances.length ? Math.round((resolved / moduleInstances.length) * 100) : 0;
      const passRate = resolved ? Math.round((passed / resolved) * 100) : 0;
      const moduleAssignees = selectedExecution?.module_assignments?.[module.id] || [];
      const expansionKey = getModuleExpansionKey(module.id);
      const isExpanded = expandedExecutionModuleKeys.includes(expansionKey);
      const resolvedSuiteId = suiteId || "";

      return (
        <div className="execution-module-scope-header">
          <button
            aria-expanded={isExpanded}
            className="execution-module-scope-title execution-module-scope-toggle"
            onClick={() => setExpandedExecutionModuleKeys((current) => current.includes(expansionKey)
              ? current.filter((key) => key !== expansionKey)
              : [...current, expansionKey])}
            type="button"
          >
            <CollapseExpandIcon isExpanded={isExpanded} />
            <LayersIcon />
            <div>
              <strong>{module.name}</strong>
              <span>{module.cases.length} cases · {moduleInstances.length} instances · {resolved} resolved</span>
            </div>
          </button>
          <HierarchyMetricStrip
            count={moduleInstances.length}
            noun="instance"
            metrics={[
              { label: "Complete", value: `${completion}%`, tone: completion === 100 ? "success" : completion ? "warning" : "neutral" },
              { label: "Pass rate", value: resolved ? `${passRate}%` : "—", tone: !resolved ? "neutral" : passRate >= 85 ? "success" : passRate >= 65 ? "warning" : "danger" },
              { label: "Failed", value: failed, tone: failed ? "danger" : "success" },
              { label: "Blocked", value: blocked, tone: blocked ? "warning" : "success" }
            ]}
          />
          <div className="execution-scope-assignee" title="Assign module responsibility">
            <ExecutionAssigneeIcon />
            <MultiAssigneePicker
              disabled={!canUpdateRuns || isExecutionLocked || module.id === "unassigned-module" || updateExecutionScopeAssignment.isPending}
              emptyLabel={module.id === "unassigned-module" ? "No module owner" : "Inherit suite/run"}
              onChange={(ids) => void handleScopeAssignmentChange("modules", module.id, ids)}
              options={assigneeOptions}
              selectedIds={moduleAssignees}
            />
          </div>
          {canReportBugs ? (<ReportBugSplitActionButton
            canUseAi={canUseAiBugTriage}
            className="execution-scope-report-bug"
            disabled={!canReportBugs || module.id === "unassigned-module" || !resolvedSuiteId}
            onReportBug={() => handleReportSelectedExecutionIssue("module", { suiteId: resolvedSuiteId, suiteName, moduleId: module.id, moduleName: module.name })}
            onReportBugWithAi={() => handleReportSelectedExecutionIssue("module", { suiteId: resolvedSuiteId, suiteName, moduleId: module.id, moduleName: module.name }, "ai")}
          />) : null}
        </div>
      );
    };

    return (
      <div className="execution-run-case-catalog">
        <div className="design-list-toolbar catalog-command-toolbar execution-run-detail-toolbar execution-suite-case-toolbar">
          <div className="catalog-toolbar-discovery" aria-label="Run case views and search">
            <CatalogViewToggle onChange={setExecutionCaseCatalogViewMode} value={executionCaseCatalogViewMode} />
            <CatalogSearchFilter
              activeFilterCount={executionCaseSearch.trim() ? 1 : 0}
              ariaLabel="Search run cases"
              onChange={setExecutionCaseSearch}
              placeholder="Search cases"
              subtitle="Search the snapped case title, suite, status, priority, assignee, or step count."
              title="Case search"
              type="search"
              value={executionCaseSearch}
            >
              <div className="catalog-filter-grid">
                <div className="catalog-filter-actions">
                  <button className="ghost-button" disabled={!executionCaseSearch.trim()} onClick={() => setExecutionCaseSearch("")} type="button">
                    Clear search
                  </button>
                </div>
              </div>
            </CatalogSearchFilter>
          </div>
          {suiteId ? (
            <div className="catalog-toolbar-actions" aria-label="Run case actions">
              {canReportBugs ? (<ReportBugSplitActionButton
                canUseAi={canUseAiBugTriage}
                className="execution-scope-report-bug"
                disabled={!canReportBugs}
                onReportBug={() => handleReportSelectedExecutionIssue("suite", { suiteId, suiteName })}
                onReportBugWithAi={() => handleReportSelectedExecutionIssue("suite", { suiteId, suiteName }, "ai")}
              />) : null}
              {canExecuteRuns && canManageRunResults ? (<button
                className="ghost-button suite-bulk-pass"
                disabled={!canExecuteRuns || !canManageRunResults || !isExecutionStarted || isExecutionLocked}
                onClick={() => void handleSuiteBulkStatus(suiteId, "passed")}
                type="button"
              >
                <ExecutionSuiteIcon />
                <span>Suite Pass</span>
              </button>) : null}
              {canExecuteRuns && canManageRunResults ? (<button
                className="ghost-button danger suite-bulk-fail"
                disabled={!canExecuteRuns || !canManageRunResults || !isExecutionStarted || isExecutionLocked}
                onClick={() => void handleSuiteBulkStatus(suiteId, "failed")}
                type="button"
              >
                <ExecutionSuiteIcon />
                <span>Suite Fail</span>
              </button>) : null}
            </div>
          ) : null}
        </div>

        {executionCaseCatalogViewMode === "tile" ? (
          suiteId ? (
            <div className="execution-module-tree">
              {moduleGroups.map((module) => {
                const isExpanded = expandedExecutionModuleKeys.includes(getModuleExpansionKey(module.id));
                return (
                  <section className="execution-module-scope" key={`${suiteId}-${module.id}`}>
                    {renderExecutionModuleHeader(module)}
                    {isExpanded ? <div className="tree-children">{renderCaseCards(module.cases)}</div> : null}
                  </section>
                );
              })}
              {!cases.length ? <div className="empty-state compact">{resolvedEmptyMessage}</div> : null}
            </div>
          ) : (
            <div className="tree-children">
              {renderCaseCards(cases)}
              {!cases.length ? <div className="empty-state compact">{resolvedEmptyMessage}</div> : null}
            </div>
          )
        ) : suiteId ? (
          <div className="execution-module-tree execution-module-tree--list">
            <DataTable
              columns={executionCaseListColumns}
              enableColumnResize
              enableHeaderColumnReorder
              emptyMessage={resolvedEmptyMessage}
              getRowClassName={(testCase) => (selectedTestCaseId === testCase.id ? "is-active-row" : "")}
              getRowKey={(testCase) => `${testCase.suite_id || "direct"}-${testCase.module_id || "unassigned-module"}-${testCase.id}`}
              onRowClick={(testCase) => focusExecutionCase(testCase.id)}
              renderRowActions={renderExecutionCaseRowActions}
              rowGroups={moduleGroups.map((module) => ({
                key: `${suiteId}-${module.id}`,
                header: renderExecutionModuleHeader(module),
                isCollapsed: !expandedExecutionModuleKeys.includes(getModuleExpansionKey(module.id)),
                rows: module.cases
              }))}
              rows={cases}
              storageKey={EXECUTION_CASE_LIST_COLUMN_PREFERENCE_KEY}
            />
          </div>
        ) : (
          <DataTable
            columns={executionCaseListColumns}
            enableColumnResize
            enableHeaderColumnReorder
            emptyMessage={resolvedEmptyMessage}
            getRowClassName={(testCase) => (selectedTestCaseId === testCase.id ? "is-active-row" : "")}
            getRowKey={(testCase, index) => `${testCase.suite_id || "direct"}-${testCase.id}-${index}`}
            onRowClick={(testCase) => focusExecutionCase(testCase.id)}
            renderRowActions={renderExecutionCaseRowActions}
            rows={cases}
            storageKey={EXECUTION_CASE_LIST_COLUMN_PREFERENCE_KEY}
          />
        )}
      </div>
    );
  };

  const renderExecutionStepCard = (step: TestStep) => (
    <ExecutionStepCard
      viewMode={visibleExecutionStepViewMode === "gherkin" ? "gherkin" : "structured"}
      apiDetail={stepApiDetails[step.id] || null}
      automationDetail={stepAutomationDetails[step.id] || null}
      availableBugs={bugs}
      canCreateEvidence={canCreateRunEvidence}
      canDeleteEvidence={canDeleteRunEvidence && canViewRunEvidence}
      canAttachNetworkAutomation={canBuildRunAutomation}
      canInspectApi={canViewRunAutomationCode && (step.step_type === "api" || (!step.step_type && selectedExecutionAppTypeKind === "api"))}
      canPreviewAutomation={canPreviewRunAutomation}
      canRecordResult={canExecuteRuns && canManageRunResults && canRecordSelectedCase && !caseLifecycleAction}
      canViewAutomationCode={canViewRunAutomationCode}
      canViewEvidence={canViewRunEvidence}
      captures={stepCaptures[step.id] || stepApiDetails[step.id]?.captures || {}}
      defectIds={stepDefects[step.id] || []}
      evidence={stepEvidence[step.id] || null}
      isExpanded={expandedExecutionStepIds.includes(step.id)}
      isLinkingDefects={linkingDefectStepId === step.id}
      isLocked={!isExecutionStarted || isExecutionLocked}
      isOpeningEvidence={openingEvidenceStepId === step.id}
      isRunningApi={runningExecutionApiStepId === step.id}
      isSelected={bulkSelectedStepIds.includes(step.id)}
      isUploadingEvidence={uploadingEvidenceStepId === step.id}
      key={step.id}
      note={stepNotes[step.id] || ""}
      onAttachNetworkAutomation={(network) => void handleAttachStepNetworkAutomation(network)}
      onDefectsChange={(defectIds) => void handleStepDefectsChange(step, defectIds)}
      onDeleteEvidence={() => void handleDeleteStepEvidence(step)}
      onFail={() => void handleRecordStep(step.id, "failed")}
      onInspectApi={() => openExecutionApiDetail(step)}
      onNoteBlur={(value) => void handleSaveStepNote(step.id, value)}
      onPass={() => void handleRecordStep(step.id, "passed")}
      onPreviewCode={() => openExecutionStepAutomationPreview(step)}
      onRunStep={() => void handleRunExecutionApiStep(step)}
      onToggle={() =>
        setExpandedExecutionStepIds((current) =>
          current.includes(step.id) ? current.filter((id) => id !== step.id) : [...current, step.id]
        )
      }
      onToggleSelect={(checked) =>
        setBulkSelectedStepIds((current) =>
          checked ? [...new Set([...current, step.id])] : current.filter((id) => id !== step.id)
        )
      }
      onUploadEvidence={(file) => void handleUploadStepEvidence(step, file)}
      onViewEvidence={() => openExecutionEvidence(step, stepEvidence[step.id] as ExecutionStepEvidence)}
      parameterValues={resolveExecutionParameterContext({ execution: selectedExecution, caseSnapshot: selectedExecutionCaseSnapshot,
        stepSnapshot: snapshotSteps.find(snapshot => snapshot.snapshot_step_id === step.id),
        dataSetRow: selectedExecutionCaseInstance?.data_set_row_snapshot, rowIndex: selectedExecutionCaseInstance?.data_set_iteration_index,
        capturedValues: { ...suiteExecutionOutputParameterValues, ...executionOutputParameterValues }
      }).values}
      status={stepStatuses[step.id] || "queued"}
      step={step}
      webDetail={stepWebDetails[step.id] || null}
    />
  );


  const renderScheduleCommandCenter = () => {
    if (!selectedSchedule) {
      return null;
    }

    const scheduledSuites = scopeSuites.filter((suite) => selectedSchedule.suite_ids.includes(suite.id));
    const scheduledDirectCases = runCaseReferences(selectedSchedule.test_case_ids || [], smartExecutionLibraryCases);
    const scheduledSuiteCaseCount = scheduledSuites.reduce((count, suite) => count + (suite.test_case_ids?.length || 0), 0);
    const totalScheduledCases = new Set([
      ...scheduledDirectCases.map((testCase) => testCase.id),
      ...scheduledSuites.flatMap((suite) => suite.test_case_ids || [])
    ]).size;
    const nextRunTimestamp = toTimestamp(selectedSchedule.next_run_at);
    const lastRunTimestamp = toTimestamp(selectedSchedule.last_run_at);
    const nowTimestamp = Date.now();
    const timeToNextRun = nextRunTimestamp === null
      ? null
      : Math.max(nextRunTimestamp - nowTimestamp, 0);
    const scheduleContextItems = [
      selectedSchedule.release ? `Release ${selectedSchedule.release}` : null,
      selectedSchedule.sprint ? `Sprint ${selectedSchedule.sprint}` : null,
      selectedSchedule.build ? `Build ${selectedSchedule.build}` : null
    ].filter(Boolean);
    const scheduleAppTypeLabel = appTypeNameById[selectedSchedule.app_type_id || ""] || selectedSchedule.app_type_id || "No app type";

    return (
      <section className="execution-command-center execution-schedule-command-center" aria-labelledby="execution-schedule-command-title">
        <header className="execution-command-header">
          <div className="execution-command-identity">
            <button
              aria-label="Back to scheduled runs"
              className="execution-command-icon-button"
              onClick={closeExecutionScheduleDetail}
              title="Back to scheduled runs"
              type="button"
            >
              <IconArrowLeft aria-hidden="true" size={20} stroke={1.9} />
              <span>Back</span>
            </button>
            <span className="execution-command-mark is-schedule" aria-hidden="true">
              <CalendarIcon />
            </span>
            <div>
              <h1 id="execution-schedule-command-title">{selectedSchedule.name}</h1>
              <span>Schedule ID: {selectedSchedule.id}</span>
            </div>
          </div>

          <div className="execution-command-context" aria-label="Schedule context">
            <div className="execution-command-context-item">
              <span>Cadence</span>
              <strong>{formatScheduleCadence(selectedSchedule.cadence)}</strong>
            </div>
            <div className="execution-command-context-item">
              <span>Next run</span>
              <strong>{formatExecutionTimestamp(selectedSchedule.next_run_at, "Not scheduled")}</strong>
            </div>
            <div className="execution-command-context-item">
              <span>Application</span>
              <strong>{scheduleAppTypeLabel}</strong>
            </div>
          </div>

          <div className="execution-command-actions" aria-label="Schedule actions">
            {canRunSchedules ? (<button
              className="execution-command-button is-primary"
              disabled={!canRunSchedules || runExecutionSchedule.isPending}
              onClick={() => void handleRunExecutionSchedule(selectedSchedule.id)}
              type="button"
            >
              <IconPlayerPlay aria-hidden="true" size={18} stroke={2} />
              <span>{runExecutionSchedule.isPending ? "Launching…" : "Run now"}</span>
            </button>) : null}
            {canUpdateSchedules ? (<button
              className="execution-command-button"
              disabled={!canUpdateSchedules}
              onClick={() => openEditScheduleBuilder(selectedSchedule)}
              type="button"
            >
              <ExecutionEditIcon />
              <span>Edit schedule</span>
            </button>) : null}
            {testRunsView === "scheduled-runs" && canCreateSchedules ? (<button
              className="execution-command-button"
              disabled={!canCreateSchedules}
              onClick={openCreateScheduleBuilder}
              type="button"
            >
              <AddIcon />
              <span>Add test plan</span>
            </button>) : null}
            {canDeleteSchedules ? (<button
              className="execution-command-button is-danger"
              disabled={!canDeleteSchedules || deleteExecutionSchedule.isPending}
              onClick={() => void handleDeleteExecutionSchedule(selectedSchedule.id, selectedSchedule.name)}
              type="button"
            >
              <TrashIcon />
              <span>{deleteExecutionSchedule.isPending ? "Deleting…" : "Delete"}</span>
            </button>) : null}
          </div>
        </header>

        <div className="execution-command-metrics execution-schedule-metrics" aria-label="Schedule planning metrics">
          <article className="execution-command-metric">
            <div className="execution-command-duration">
              <IconFolder aria-hidden="true" size={32} stroke={1.7} />
              <div>
                <span>Suite scope</span>
                <strong>{selectedSchedule.suite_ids.length}</strong>
                <small>{scheduledSuiteCaseCount} suite-linked cases</small>
              </div>
            </div>
          </article>
          <article className="execution-command-metric">
            <div className="execution-command-duration">
              <TestCaseIcon size={32} strokeWidth={1.7} />
              <div>
                <span>Total case scope</span>
                <strong>{totalScheduledCases || selectedSchedule.test_case_ids.length}</strong>
                <small>{selectedSchedule.test_case_ids.length} direct cases</small>
              </div>
            </div>
          </article>
          <article className="execution-command-metric">
            <div className="execution-command-duration">
              <IconClock aria-hidden="true" size={32} stroke={1.7} />
              <div>
                <span>Time to next run</span>
                <strong>{timeToNextRun === null ? "—" : formatDuration(timeToNextRun, "Due now")}</strong>
                <small>{formatExecutionTimestamp(selectedSchedule.next_run_at, "No next run")}</small>
              </div>
            </div>
          </article>
          <article className={selectedSchedule.is_active ? "execution-command-metric" : "execution-command-metric is-risk"}>
            <div className="execution-command-blockers">
              <div>
                <span>Schedule state</span>
                <strong>{selectedSchedule.is_active ? "Active" : "Paused"}</strong>
                <div className="execution-command-priority-row">
                  <span>{lastRunTimestamp ? `Last ${formatExecutionTimestamp(selectedSchedule.last_run_at)}` : "Never launched"}</span>
                </div>
              </div>
              <CalendarIcon />
            </div>
          </article>
        </div>

        <div className="execution-command-toolbar" aria-label="Schedule release context">
          <div className="execution-command-toolbar-item">
            <span>Release context</span>
            <strong>{scheduleContextItems.join(" · ") || "Release, sprint, and build not set"}</strong>
          </div>
          <div className="execution-command-toolbar-item">
            <span>Environment</span>
            <strong>{selectedSchedule.test_environment_id ? "Environment attached" : "Not attached"}</strong>
          </div>
          <div className="execution-command-toolbar-item">
            <span>Configuration and data</span>
            <strong>
              {[
                selectedSchedule.test_configuration_id ? "Configuration attached" : null,
                selectedSchedule.test_data_set_id ? "Data set attached" : null
              ].filter(Boolean).join(" · ") || "Not attached"}
            </strong>
          </div>
          <div className="execution-command-toolbar-item">
            <span>Run assignees</span>
            <strong>{resolveExecutionAssigneeSummary(selectedSchedule)}</strong>
          </div>
        </div>

        <div className="execution-command-content execution-schedule-command-content">
          <aside className="execution-command-hierarchy" aria-label="Scheduled test hierarchy">
            <div className="execution-command-pane-heading">
              <div>
                <IconListDetails aria-hidden="true" size={18} stroke={1.9} />
                <strong>Scheduled scope</strong>
              </div>
              <span>{selectedSchedule.suite_ids.length + selectedSchedule.test_case_ids.length} items</span>
            </div>
            <div className="execution-command-tree">
              {scheduledSuites.map((suite) => (
                <section className="execution-command-tree-group" key={suite.id}>
                  <div className="execution-command-tree-row">
                    <span className="execution-command-tree-static-icon"><IconFolder aria-hidden="true" size={18} stroke={1.8} /></span>
                    <span><strong>{suite.name}</strong><small>{suite.test_case_ids?.length || 0} reusable cases</small></span>
                  </div>
                </section>
              ))}
              {selectedSchedule.suite_ids
                .filter((suiteId) => !scheduledSuites.some((suite) => suite.id === suiteId))
                .map((suiteId) => (
                  <section className="execution-command-tree-group" key={suiteId}>
                    <div className="execution-command-tree-row">
                      <span className="execution-command-tree-static-icon"><IconFolder aria-hidden="true" size={18} stroke={1.8} /></span>
                      <span><strong>{suiteId}</strong><small>Suite snapshot unavailable</small></span>
                    </div>
                  </section>
                ))}
              {scheduledDirectCases.length ? (
                <section className="execution-command-tree-group">
                  <div className="execution-command-tree-row">
                    <span className="execution-command-tree-static-icon"><TestCaseIcon size={18} strokeWidth={1.8} /></span>
                    <span><strong>Direct test cases</strong><small>{scheduledDirectCases.length} cases</small></span>
                  </div>
                </section>
              ) : null}
              {!selectedSchedule.suite_ids.length && !selectedSchedule.test_case_ids.length ? (
                <div className="empty-state compact">No test scope is attached to this schedule.</div>
              ) : null}
            </div>
            <div className="execution-command-ai-card execution-schedule-tip">
              <div>
                <IconInfoCircle aria-hidden="true" size={18} stroke={1.9} />
                <strong>Immutable launch scope</strong>
              </div>
              <p>Each launch creates a new execution snapshot. Editing this schedule does not rewrite evidence from earlier runs.</p>
            </div>
          </aside>

          <main className="execution-command-cases execution-schedule-plan">
            <div className="execution-command-cases-header">
              <div>
                <span>Recurring run plan</span>
                <h2>{selectedSchedule.name}</h2>
                <p>Review cadence, ownership, release context, and reusable scope before the next launch.</p>
              </div>
              <StatusBadge value={selectedSchedule.is_active ? "queued" : "aborted"} />
            </div>
            <div className="execution-schedule-plan-grid">
              <article>
                <IconClock aria-hidden="true" size={22} stroke={1.8} />
                <span>Cadence</span>
                <strong>{formatScheduleCadence(selectedSchedule.cadence)}</strong>
                <small>Next: {formatExecutionTimestamp(selectedSchedule.next_run_at, "Not scheduled")}</small>
              </article>
              <article>
                <IconUser aria-hidden="true" size={22} stroke={1.8} />
                <span>Ownership</span>
                <strong>{resolveExecutionAssigneeSummary(selectedSchedule)}</strong>
                <small>Becomes the default tester group for every new run.</small>
              </article>
              <article>
                <IconDatabase aria-hidden="true" size={22} stroke={1.8} />
                <span>Frozen run context</span>
                <strong>
                  {[selectedSchedule.test_environment_id, selectedSchedule.test_configuration_id, selectedSchedule.test_data_set_id].filter(Boolean).length}/3 attached
                </strong>
                <small>Environment, configuration, and data are snapped when the schedule launches.</small>
              </article>
              <article>
                <IconFlag aria-hidden="true" size={22} stroke={1.8} />
                <span>Release traceability</span>
                <strong>{scheduleContextItems.length ? `${scheduleContextItems.length} fields set` : "Not set"}</strong>
                <small>{scheduleContextItems.join(" · ") || "Add release, sprint, or build context from Edit schedule."}</small>
              </article>
            </div>

            <section className="execution-schedule-scope-table">
              <div className="execution-command-section-title">
                <IconFolder aria-hidden="true" size={18} stroke={1.9} />
                <strong>Reusable suites</strong>
              </div>
              <div>
                {scheduledSuites.map((suite) => (
                  <article key={suite.id}>
                    <span className="execution-schedule-scope-icon"><ExecutionSuiteIcon /></span>
                    <div><strong>{suite.name}</strong><small>{suite.id}</small></div>
                    <b>{suite.test_case_ids?.length || 0} cases</b>
                  </article>
                ))}
                {!scheduledSuites.length ? <div className="empty-state compact">No reusable suites are available in the current project scope.</div> : null}
              </div>
            </section>
          </main>

          <aside className="execution-command-analysis execution-schedule-analysis" aria-label="Schedule readiness">
            <div className="execution-command-pane-heading">
              <div>
                <IconShieldCheck aria-hidden="true" size={18} stroke={1.9} />
                <strong>Schedule readiness</strong>
              </div>
              <span className={selectedSchedule.is_active ? "count-pill success" : "count-pill warning"}>
                {selectedSchedule.is_active ? "Active" : "Paused"}
              </span>
            </div>
            <article className="execution-command-readiness">
              <div>
                <span>Next launch</span>
                <b>{nextRunTimestamp && nextRunTimestamp >= nowTimestamp ? "Planned" : "Needs review"}</b>
              </div>
              <strong>{nextRunTimestamp ? "Ready" : "—"}</strong>
              <p>
                {nextRunTimestamp
                  ? `${formatScheduleCadence(selectedSchedule.cadence)} cadence with ${totalScheduledCases || selectedSchedule.test_case_ids.length} unique cases resolved from current scope.`
                  : "Choose the next run time before relying on this schedule."}
              </p>
            </article>
            <section className="execution-schedule-checklist">
              <div className="execution-command-section-title">
                <IconCheckbox aria-hidden="true" size={18} stroke={1.9} />
                <strong>Launch checklist</strong>
              </div>
              {[
                { label: "Test scope", ready: Boolean(selectedSchedule.suite_ids.length || selectedSchedule.test_case_ids.length) },
                { label: "Next run time", ready: Boolean(selectedSchedule.next_run_at) },
                { label: "Assignee group", ready: Boolean(selectedSchedule.assigned_to_ids?.length || selectedSchedule.assigned_to) },
                { label: "Environment", ready: Boolean(selectedSchedule.test_environment_id) },
                { label: "Configuration", ready: Boolean(selectedSchedule.test_configuration_id) },
                { label: "Test data", ready: Boolean(selectedSchedule.test_data_set_id) }
              ].map((item) => (
                <div key={item.label}>
                  {item.ready
                    ? <IconCircleCheck aria-hidden="true" size={17} stroke={2} />
                    : <IconAlertTriangle aria-hidden="true" size={17} stroke={2} />}
                  <span>{item.label}</span>
                  <b>{item.ready ? "Ready" : "Optional / missing"}</b>
                </div>
              ))}
            </section>
            {canRunSchedules ? (<button
              className="execution-command-summary-button"
              disabled={!canRunSchedules || runExecutionSchedule.isPending}
              onClick={() => void handleRunExecutionSchedule(selectedSchedule.id)}
              type="button"
            >
              <IconPlayerPlay aria-hidden="true" size={18} stroke={1.9} />
              <span>{runExecutionSchedule.isPending ? "Launching scheduled run…" : "Launch scheduled run now"}</span>
            </button>) : null}
          </aside>
        </div>

        <footer className="execution-command-footer">
          <span className={selectedSchedule.is_active ? "is-live" : ""}>
            <i aria-hidden="true" />
            {selectedSchedule.is_active ? "Schedule active" : "Schedule paused"}
          </span>
          <span>{formatScheduleCadence(selectedSchedule.cadence)} · {selectedSchedule.suite_ids.length} suites · {totalScheduledCases || selectedSchedule.test_case_ids.length} cases</span>
        </footer>
      </section>
    );
  };
  const shouldRenderExecutionCommandCenter = Boolean(selectedExecution);
  const shouldRenderScheduleCommandCenter = Boolean(selectedSchedule);

  return (
    <div
      className={[
        "page-content",
        "page-content--executions-full",
        selectedExecution || activeExecutionStage === "case" ? "page-content--workspace-focus" : "",
        (selectedExecution && activeExecutionStage !== "case") || selectedSchedule ? "page-content--execution-command-center" : ""
      ].filter(Boolean).join(" ")}
    >
      {confirmationDialog}
      {showExecutionListHeader ? (
        <>
          <PageHeader
            eyebrow={testRunsView === "scheduled-runs" ? "Test Plan" : "Test Runs & Results"}
            title={
              testRunsView === "suite-runs"
                  ? "Runs"
                  : testRunsView === "local-runs"
                    ? "Runs"
                  : testRunsView === "scheduled-runs"
                    ? "Test Plans"
                    : "Batch Process"
            }
            description={
              testRunsView === "suite-runs"
                  ? "Manage suite and individual case runs together, monitor progress, and review their evidence."
                  : testRunsView === "local-runs"
                    ? "Watch runs started directly on your local Playwright runner and review the callback evidence they produce."
                  : testRunsView === "scheduled-runs"
                    ? "Plan recurring release checks separately from live runs so teams can see what is scheduled next without cluttering the active runs board."
                    : "Review imports, exports, AI generation, and other background jobs with full traceable details."
            }
          />
          <QualityMetricStrip
            ariaLabel={`${testRunsView === "scheduled-runs" ? "Scheduled run" : testRunsView === "batch-process" ? "Batch process" : "Test run"} quality metrics`}
            metrics={isRunCatalogMetricLoading
              ? runCatalogMetricCards.map((metric) => ({
                  ...metric,
                  detail: "Loading metrics",
                  progress: null,
                  tone: "neutral",
                  value: "—"
                }))
              : runCatalogMetricCards}
          />
        </>
      ) : null}

      <ToastMessage message={message} onDismiss={() => setMessage("")} tone={messageTone} />

      <WorkspaceMasterDetail
        browseView={(
          <ExecutionRunCatalog
            data={catalogData}
            state={catalogState}
            controller={catalogController}
            actions={{ setTestRunsView, focusExecution, handleRerunExecutionItem, rerunExecution, focusExecutionSchedule, openEditScheduleBuilder, handleRunExecutionSchedule, handleDeleteExecutionSchedule, openWorkspaceTransactionDetail, openCreateScheduleBuilder, openExecutionBuilder }}
            access={{ canExecuteRuns, canUpdateSchedules, canRunSchedules, canDeleteSchedules, canUpdateRuns, canCreateSchedules, canViewSchedules }}
            selection={{ selectedExecution, selectedSchedule }}
            metadata={{ session, executionImpactSummaryById, liveNow, appTypeNameById, projectNameById, testRunsView, projectId, scopeSuites }}
          />
        )}
        detailView={(
          testRunsView === "batch-process" ? (
            <Panel
              actions={selectedWorkspaceTransaction ? <WorkspaceBackButton label="Back to batch process" onClick={closeWorkspaceTransactionDetail} /> : undefined}
              className="execution-panel execution-panel--detail"
              title={selectedWorkspaceTransaction ? selectedWorkspaceTransaction.title : "Batch process detail"}
              subtitle={selectedWorkspaceTransaction ? "Inspect metadata, recent state, and the full event timeline for this background process." : "Select a batch process tile or list row to inspect its trace log."}
            >
              {selectedWorkspaceTransaction ? (
                (() => {
                  const presentation = describeWorkspaceTransaction(selectedWorkspaceTransaction, {
                    appTypeNameById,
                    projectNameById
                  });
                  const summary = resolveWorkspaceTransactionSummary(selectedWorkspaceTransaction, presentation);
                  const readableMetadata = resolveWorkspaceTransactionReadableMetadata(selectedWorkspaceTransaction);
                  const complexMetadata = resolveWorkspaceTransactionComplexMetadata(selectedWorkspaceTransaction);
                  const durationLabel = formatDuration(
                    computeExecutionDurationMs(
                      selectedWorkspaceTransaction.started_at || selectedWorkspaceTransaction.created_at || null,
                      selectedWorkspaceTransaction.completed_at || selectedWorkspaceTransaction.updated_at || null,
                      liveNow
                    ),
                    DEFAULT_DURATION_LABEL
                  );
                  const relatedLabel =
                    selectedWorkspaceTransaction.related_kind && selectedWorkspaceTransaction.related_id
                      ? `${formatWorkspaceTransactionActionLabel(selectedWorkspaceTransaction.related_kind)} · ${selectedWorkspaceTransaction.related_id}`
                      : "Not linked";

                  return (
                <div className="detail-stack">
                  <div className="detail-summary">
                    <strong>{selectedWorkspaceTransaction.title}</strong>
                    <span>{selectedWorkspaceTransaction.description || summary || "No summary provided for this background process."}</span>
                    <span>{selectedWorkspaceTransaction.created_user ? resolveUserPrimaryLabel(selectedWorkspaceTransaction.created_user) : "System"} · {formatExecutionTimestamp(selectedWorkspaceTransaction.created_at, "Timestamp unavailable")}</span>
                  </div>

                  <div className="metric-strip compact">
                    <div className="mini-card">
                      <strong>{selectedWorkspaceTransaction.status}</strong>
                      <span>Status</span>
                    </div>
                    <div className="mini-card">
                      <strong>{selectedWorkspaceTransaction.event_count || 0}</strong>
                      <span>Events</span>
                    </div>
                    <div className="mini-card">
                      <strong>{durationLabel}</strong>
                      <span>Duration</span>
                    </div>
                    <div className="mini-card">
                      <strong>{formatExecutionTimestamp(selectedWorkspaceTransaction.latest_event_at || selectedWorkspaceTransaction.updated_at, "Not recorded")}</strong>
                      <span>Latest activity</span>
                    </div>
                  </div>

                  <div className="stack-list">
                    <div className="stack-item">
                      <div>
                        <strong>Scope</strong>
                        <span>
                          {selectedWorkspaceTransaction.app_type_id
                            ? appTypeNameById[selectedWorkspaceTransaction.app_type_id] || "App type scope"
                            : selectedWorkspaceTransaction.project_id
                              ? projectNameById[selectedWorkspaceTransaction.project_id] || "Project scope"
                              : "Workspace scope"}
                        </span>
                      </div>
                      <StatusBadge value={selectedWorkspaceTransaction.status} />
                    </div>
                    <div className="stack-item">
                      <div>
                        <strong>Action</strong>
                        <span>{formatWorkspaceTransactionActionLabel(selectedWorkspaceTransaction.action)}</span>
                      </div>
                    </div>
                    <div className="stack-item">
                      <div>
                        <strong>Category</strong>
                        <span>{formatWorkspaceTransactionActionLabel(selectedWorkspaceTransaction.category)}</span>
                      </div>
                    </div>
                    <div className="stack-item">
                      <div>
                        <strong>Related record</strong>
                        <span>{relatedLabel}</span>
                      </div>
                    </div>
                    {readableMetadata.length ? (
                      <div className="stack-item execution-operation-metadata">
                        <div>
                          <strong>Captured details</strong>
                          <span>Readable metadata collected for this batch process.</span>
                        </div>
                        <div className="stack-list execution-operation-detail-list">
                          {readableMetadata.map((entry) => (
                            <div className="stack-item" key={entry.key}>
                              <div>
                                <strong>{entry.label}</strong>
                                <span>{formatWorkspaceTransactionMetadataValue(entry.value)}</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : null}
                    {complexMetadata ? (
                      <div className="stack-item execution-operation-metadata">
                        <div>
                          <strong>Raw metadata</strong>
                          <span>Structured context that did not fit into the readable detail fields above.</span>
                        </div>
                        <code className="execution-operation-json">{JSON.stringify(complexMetadata, null, 2)}</code>
                      </div>
                    ) : null}
                  </div>

                  <div className="execution-context-summary-head">
                    <div className="execution-context-summary-copy">
                      <div className="execution-context-summary-title-row">
                        <strong>Trace log</strong>
                        <InfoTooltip
                          content="Every recorded stage for this batch process appears below in the order it happened."
                          label="Trace log information"
                        />
                      </div>
                    </div>
                    <span className="count-pill">
                      {selectedWorkspaceTransactionEventsQuery.isLoading
                        ? "Loading…"
                        : `${(selectedWorkspaceTransactionEventsQuery.data || []).length} event${(selectedWorkspaceTransactionEventsQuery.data || []).length === 1 ? "" : "s"}`}
                    </span>
                  </div>

                  {selectedWorkspaceTransactionEventsQuery.error instanceof Error ? (
                    <div className="empty-state compact">{selectedWorkspaceTransactionEventsQuery.error.message}</div>
                  ) : null}

                  {!selectedWorkspaceTransactionEventsQuery.error && selectedWorkspaceTransactionEventsQuery.isLoading ? (
                    <LoadingState label="Loading process events" />
                  ) : null}

                  {!selectedWorkspaceTransactionEventsQuery.error && !(selectedWorkspaceTransactionEventsQuery.data || []).length && !selectedWorkspaceTransactionEventsQuery.isLoading ? (
                    <div className="empty-state compact">No event log has been recorded for this batch process yet.</div>
                  ) : null}

                  {!selectedWorkspaceTransactionEventsQuery.error && (selectedWorkspaceTransactionEventsQuery.data || []).length ? (
                    <div className="stack-list execution-activity-list">
                      {(selectedWorkspaceTransactionEventsQuery.data || []).map((event) => (
                        <details className="stack-item execution-operation-event" key={event.id}>
                          <summary className="execution-operation-event-summary">
                            <div>
                              <strong>{event.message}</strong>
                              <span>{event.phase ? `${event.phase} · ` : ""}{formatExecutionTimestamp(event.created_at, "Timestamp unavailable")}</span>
                            </div>
                            <span className={`status-badge ${event.level}`}>{event.level}</span>
                          </summary>
                          {Object.keys(event.details || {}).length ? (
                            <code className="execution-operation-json">{JSON.stringify(event.details, null, 2)}</code>
                          ) : null}
                        </details>
                      ))}
                    </div>
                  ) : null}
                </div>
                  );
                })()
              ) : (
                <div className="empty-state compact">Choose a batch process tile to review its full timeline, captured metadata, and related job context.</div>
              )}
            </Panel>
          ) : testRunsView === "scheduled-runs" && shouldRenderScheduleCommandCenter ? (
            renderScheduleCommandCenter()
          ) : testRunsView === "scheduled-runs" ? (
            <Panel
              className="execution-panel execution-panel--detail"
              title="Scheduled run"
              subtitle={selectedSchedule ? "Review cadence, scope, and run context for this recurring run." : "Select a scheduled run to inspect its scope."}
            >
              {selectedSchedule ? (
                <div className="detail-stack">
                  <div className="detail-summary">
                    <strong>{selectedSchedule.name}</strong>
                    <span>{selectedSchedule.is_active ? "Active schedule" : "Inactive schedule"} · {formatScheduleCadence(selectedSchedule.cadence)}</span>
                    <span>Next run: {formatExecutionTimestamp(selectedSchedule.next_run_at, "Not set")}</span>
                    <span>{[selectedSchedule.release ? `Release ${selectedSchedule.release}` : null, selectedSchedule.sprint ? `Sprint ${selectedSchedule.sprint}` : null, selectedSchedule.build ? `Build ${selectedSchedule.build}` : null].filter(Boolean).join(" · ") || "Release, sprint, and build not set"}</span>
                  </div>
                  <div className="metric-strip compact">
                    <div className="mini-card">
                      <strong>{selectedSchedule.suite_ids.length}</strong>
                      <span>Suites</span>
                    </div>
                    <div className="mini-card">
                      <strong>{selectedSchedule.test_case_ids.length}</strong>
                      <span>Direct cases</span>
                    </div>
                    <div className="mini-card">
                      <strong>{resolveExecutionAssigneeSummary(selectedSchedule)}</strong>
                      <span>Assigned To</span>
                    </div>
                    <div className="mini-card">
                      <strong>{selectedSchedule.release || "Not set"}</strong>
                      <span>Release</span>
                    </div>
                    <div className="mini-card">
                      <strong>{selectedSchedule.build || selectedSchedule.sprint || "Not set"}</strong>
                      <span>{selectedSchedule.build ? "Build" : selectedSchedule.sprint ? "Sprint" : "Build / Sprint"}</span>
                    </div>
                  </div>
                  <div className="action-row">
                    <button className="ghost-button" onClick={() => openEditScheduleBuilder(selectedSchedule)} type="button">
                      <ExecutionEditIcon />
                      <span>Edit schedule</span>
                    </button>
                    <button className="ghost-button" onClick={openCreateScheduleBuilder} type="button">
                      <CalendarIcon />
                      <span>Add test plan</span>
                    </button>
                    <button className="primary-button" onClick={() => void handleRunExecutionSchedule(selectedSchedule.id)} type="button">
                      Run now
                    </button>
                    <button className="ghost-button danger" onClick={() => void handleDeleteExecutionSchedule(selectedSchedule.id, selectedSchedule.name)} type="button">
                      Delete schedule
                    </button>
                  </div>
                </div>
              ) : (
                <div className="detail-stack">
                  <div className="empty-state compact">Choose a scheduled run from the left to review or launch it.</div>
                  <div className="action-row">
                    <button className="ghost-button" onClick={openCreateScheduleBuilder} type="button">
                      <CalendarIcon />
                      <span>Add test plan</span>
                    </button>
                  </div>
                </div>
              )}
            </Panel>
          ) : activeExecutionStage === "case" ? (
            <ExecutionRunnerWorkspace
            snapshot={{ selectedExecution, selectedExecutionCase, selectedExecutionCaseReadableTitle, selectedExecutionCaseReadableDescription, hasSelectedCaseTestData, selectedExecutionCaseInstance, selectedCaseLiveView, currentExecutionStatus, selectedExecutionResult, selectedExecutionCaseSnapshot, selectedExecutionAppTypeKind, instanceDerivedStatus, selectedSteps, suiteExecutionOutputParameterValues, executionOutputParameterValues, executionPreconditionSteps, executionStepGroupIds, executionMainSteps, executionStepBlocks, stepAutomationDetails, stepApiDetails, stepNotes, stepStatuses, stepWebDetails, selectedTestCaseId, executionResults, selectedCaseHistory, executionById, stepEvidence, selectedExecutionCaseEffectiveUser, assigneeOptions }}
            view={{ hasSelectedStepAutomationCode, setActiveTab, setExecutionStepViewMode, setRunConfigurationResource, activeTab, expandedExecutionStepSections, setExpandedExecutionStepSections, visibleExecutionStepViewMode, bulkSelectedStepIds, setBulkSelectedStepIds, expandedExecutionStepGroupIds, setExpandedExecutionStepGroupIds, setHistoryResult }}
            access={{ canReportBugs, canUseAiBugTriage, canExportRunReports, canShareRunReports, canViewRunAutomationCode, canExecuteRuns, canManageRunResults, canViewRunEvidence, canViewRunGherkin, session, canRecordSelectedCase, canPreviewRunAutomation, canUseRunAi, can, featureFlagsQuery, projectId, appTypeId, integrations, canCreateRunEvidence, canDeleteRunEvidence, canUpdateRuns }}
            actions={{ handleReportSelectedExecutionIssue, downloadExecutionCaseReport, handleDownloadExecutionCaseReport, shareExecutionCaseReport, handleOpenCaseReportEmailModal, completeExecution, startExecution, handleFinalizeExecution, executionFinalizeAction, handleStartSelectedExecution, rerunExecution, handleRerunExecution, caseLifecycleAction, handleCaseLifecycle, renderExecutionStepCard, openHookEvidence, handleBulkStepStatus, openExecutionGroupAutomationPreview, openExecutionEvidence, ensureSelectedCaseResult, refreshExecutionScope }}
            progress={{ selectedCaseStatusLabel, selectedCaseDurationMs, isSelectedResultDerived, isSelectedCaseAutomated, isExecutionStarted, isExecutionLocked, isSelectedCaseTimerActive, selectedStepProgress, selectedRuntimeTelemetry, resolvedEvidenceArtifactCount }}
            navigation={{ focusedExecutionSuite, closeCaseDrilldown, focusExecutionCase, previousExecutionCaseInstance, focusNeighborExecutionCase, selectedExecutionCaseInstanceIndex, executionCaseInstanceOrder, nextExecutionCaseInstance }}
            assignment={{ selectedExecutionCaseAssignmentHint, updateExecutionCaseAssignment, caseAssignmentDraft, setCaseAssignmentDraft, hasCaseAssignmentChange, handleSaveCaseAssignment, updateResult, createResult, caseReferenceDraft, setCaseReferenceDraft, setCaseDefectDraft, caseDefectDraft, hasCaseReferenceChange, handleSaveCaseReferences }}
          />
          ) : shouldRenderExecutionCommandCenter ? (
            <ExecutionRunDetail
      snapshot={{ selectedExecution, latestExecutionResults, stepsByCaseId, resultByCaseId, selectedFrozenEvidence }}
      scope={{ isSelectedExecutionTestCaseRun, executionSuites, focusedSuiteId, displayCasesBySuiteId, executionCaseOrder, instanceDerivedStatus, focusedExecutionModuleId, executionCaseSearch, caseDerivedStatus, inspectedExecutionCaseId, nextFocusCase, executionSuiteSearch, setFocusedSuiteId, setFocusedExecutionModuleId, setInspectedExecutionCaseId, setExpandedExecutionSuiteIds, setExecutionCaseSearch, setRunConfigurationResource, isExecutionHierarchyCollapsed, setIsExecutionHierarchyCollapsed, setExecutionSuiteSearch, filteredExecutionSuites, expandedExecutionSuiteIds, toggleSuiteGroup, setIsRunWorkflowOpen, setExecutionCaseCatalogViewMode, executionCaseCatalogViewMode, selectedExecutionSuiteIds }}
      metrics={{ averageCaseDurationMs, remainingCaseCount, executionStatusCounts, selectedExecutionImpactSummary, isExecutionLocked, currentExecutionStatus, selectedExecutionStartMode, selectedRunPassRate, selectedRunFinalizedCount, executionProgress, selectedRunCompletionPercent, selectedExecutionDurationMs, isExecutionStarted, resolveExecutionCaseDurationMs, executionResultsWithTiming }}
      access={{ canExecuteRuns, canRunLocalAutomation, canRunRemoteAutomation, canExportRunReports, canShareRunReports, canReportBugs, canUseAiBugTriage, canUseRunAi, canUpdateRuns, canManageRunResults, canViewRunEvidence }}
      actions={{ startExecution, closeExecutionDrilldown, htmlReportMutation, handleOpenHtmlReport, handleStartSelectedExecution, focusExecutionCase, rerunExecution, handleRerunExecution, downloadExecutionReport, handleDownloadExecutionReport, shareExecutionReport, handleOpenReportEmailModal, handleReportSelectedExecutionIssue, completeExecution, handleFinalizeExecution, executionFinalizeAction, handleRunExecutionAiAnalysis, handlePreviewFailureClusters, updateExecutionScopeAssignment, handleScopeAssignmentChange, assigneeOptions, handleSuiteBulkStatus, openingEvidenceStepId, openExecutionEvidence }}
      analysis={{ selectedRunEvidenceReadiness, setIsRunEvidenceAnalysisOpen, runAnalysisInteractionMode, setRunAnalysisInteractionMode, setRunAnalysisInstruction, runAnalysisInstruction, isSelectedRunAnalysisPending, hasRecordedRunAnalysis, projectId }}
    />
          ) : (
            <Panel
              className="execution-panel execution-panel--tree"
              actions={<WorkspaceBackButton label="Back to run library" onClick={closeExecutionDrilldown} />}
              title={selectedExecution?.name || (isSelectedExecutionTestCaseRun ? "Run cases" : "Run suites")}
              subtitle={
                isSelectedExecutionTestCaseRun
                  ? "Open the snapped case tiles for this run and jump directly into the case workspace when deeper evidence is needed."
                  : "Expand suite groups to review snapped test cases inline and jump straight into the run workspace."
              }
            >
              {(
                <div className="empty-state compact">Select an execution to inspect its snapshot scope.</div>
              )}
            </Panel>
          )
        )}
        isDetailOpen={
          testRunsView === "scheduled-runs"
            ? Boolean(selectedSchedule)
            : testRunsView === "batch-process"
              ? Boolean(selectedWorkspaceTransaction)
              : Boolean(selectedExecution)
        }
      />

      {isRunEvidenceAnalysisOpen && selectedExecution ? (
        <RunReviewDialog title="Evidence Analysis" runName={selectedExecution.name || "Unnamed run"} onClose={() => setIsRunEvidenceAnalysisOpen(false)}>
          <section aria-label="Run evidence details">
            <h3>Evidence details</h3>
            <dl className="run-review-facts">
              {selectedRunEvidenceReadiness.signals.map((signal) => <div key={signal.label}><dt>{signal.label}</dt><dd>{signal.value}</dd></div>)}
            </dl>
            {selectedRunEvidenceReadiness.gaps.length ? <ul className="run-review-gaps">{selectedRunEvidenceReadiness.gaps.map((gap) => <li key={gap}>{gap}</li>)}</ul> : null}
          </section>
          <section aria-label="Run analysis review">
            <h3>Analysis summary</h3>
            {isSelectedRunAnalysisPending ? <p role="status">Failure Analyst is reviewing this run’s evidence… {selectedRunAnalysisOperation?.completedCaseCount} of {selectedRunAnalysisOperation?.totalCaseCount} cases analyzed.</p> : null}
            {selectedRunAnalysisOperation?.status === "failed" ? <p role="alert">{runAnalysisWorkflowOutcome}</p> : null}
            {runAiAnalysis ? <>
              {runAnalysisSourceChanged ? <details className="run-review-source-change"><summary>Run evidence changed. Your edits are preserved; compare with the latest summary.</summary><pre>{runAiAnalysis.response}</pre></details> : null}
              <textarea aria-label="Edit run analysis summary" disabled={isSelectedRunAnalysisPending} onChange={(event) => { setRunAnalysisReviewDraft(event.target.value); setIsRunAnalysisReviewAccepted(false); }} rows={10} value={runAnalysisReviewDraft} />
              <div className="run-review-actions">
                <span role="status">{isRunAnalysisReviewAccepted ? "Accepted for this review" : "Edit and accept this summary for your review session."}</span>
                <button className="ghost-button" disabled={isSelectedRunAnalysisPending || runAnalysisReviewDraft === runAiAnalysis.response} onClick={() => { setRunAnalysisReviewDraft(runAiAnalysis.response); setRunAnalysisSourceChanged(false); setIsRunAnalysisReviewAccepted(false); }} type="button">{runAnalysisSourceChanged ? "Use latest summary" : "Reset"}</button>
                <button className="primary-button" disabled={isSelectedRunAnalysisPending || !runAnalysisReviewDraft.trim() || isRunAnalysisReviewAccepted} onClick={() => { setIsRunAnalysisReviewAccepted(true); setRunAnalysisSourceChanged(false); }} type="button">Accept reviewed summary</button>
              </div>
            </> : !isSelectedRunAnalysisPending ? <p>No run-level analysis is available yet. Generate a summary with Failure Analyst after the run finishes.</p> : null}
            <div className="run-review-actions">
              {canUseRunAi ? (<button className="ghost-button" disabled={!canUseRunAi || !["completed", "failed"].includes(currentExecutionStatus) || isSelectedRunAnalysisPending} onClick={() => void handleRunExecutionAiAnalysis()} type="button"><IconSparkles aria-hidden="true" size={16} />{hasRecordedRunAnalysis ? "Refresh analysis" : "Analyze run"}</button>) : null}
            </div>
          </section>
        </RunReviewDialog>
      ) : null}

      {isRunWorkflowOpen && selectedExecution ? (
        <RunReviewDialog title="Failure Analyst workflow" runName={selectedExecution.name || "Unnamed run"} onClose={() => setIsRunWorkflowOpen(false)}>
          <p role={runAnalysisWorkflowStatus === "failed" ? "alert" : "status"}>{runAnalysisWorkflowOutcome}</p>
          <AgenticProcessRail
            agentName="Failure Analyst"
            orientation="vertical"
            stageEvidence={{
              context: `${executionProgress.totalCases} run case instances, ${executionStatusCounts.failed} failed, ${executionStatusCounts.blocked} blocked; ${runReferenceContext}.`,
              outcome: runAnalysisWorkflowOutcome,
              review: isRunAnalysisReviewAccepted ? "The summary is accepted for this review session." : "Edit and accept the summary in Evidence Analysis."
            }}
            status={runAnalysisWorkflowStatus}
          />
        </RunReviewDialog>
      ) : null}

      {executionEvidencePreview ? (
        <div className="modal-backdrop" onClick={closeExecutionEvidence} role="presentation">
          <div
            aria-labelledby="execution-evidence-modal-title"
            aria-modal="true"
            className="modal-card execution-evidence-modal"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
          >
            <div className="execution-evidence-modal-header">
              <div className="execution-evidence-modal-copy">
                <h2 className="dialog-title" id="execution-evidence-modal-title">{executionEvidencePreview.fileName || "Run evidence"}</h2>
                <p>{executionEvidencePreview.stepLabel}</p>
              </div>
              <button className="ghost-button" onClick={closeExecutionEvidence} type="button">
                Close
              </button>
            </div>
            <div className="execution-evidence-modal-body">
              {executionEvidencePreview.mimeType.startsWith("video/") ? (
                <video
                  className="execution-evidence-modal-image"
                  controls
                  src={executionEvidencePreview.sourceUrl}
                />
              ) : executionEvidencePreview.mimeType.startsWith("image/") ? (
                <img
                  alt={`${executionEvidencePreview.stepLabel} evidence`}
                  className="execution-evidence-modal-image"
                  src={executionEvidencePreview.sourceUrl}
                />
              ) : executionEvidencePreview.mimeType === "application/pdf" || executionEvidencePreview.mimeType.startsWith("text/") || executionEvidencePreview.mimeType.includes("json") || executionEvidencePreview.mimeType.includes("xml") ? (
                <iframe
                  className="execution-evidence-modal-document"
                  src={executionEvidencePreview.sourceUrl}
                  title={executionEvidencePreview.fileName || "Run evidence"}
                />
              ) : (
                <div className="execution-evidence-file-preview">
                  <ExecutionEvidencePreviewIcon />
                  <strong>{executionEvidencePreview.fileName || "Attached evidence"}</strong>
                  <a href={executionEvidencePreview.sourceUrl} rel="noreferrer" target="_blank">Open attachment</a>
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}

      <AiInsightPreviewDialog
        assuranceTitle="Failure cluster grounding"
        emptyMessage="No failed or blocked result is available to cluster for this run."
        error={previewExecutionFailureClusters.error instanceof Error ? previewExecutionFailureClusters.error.message : null}
        eyebrow="Run evidence"
        findings={failureClusterFindings}
        gaps={previewExecutionFailureClusters.data?.unclassified_count ? [`${previewExecutionFailureClusters.data.unclassified_count} result${previewExecutionFailureClusters.data.unclassified_count === 1 ? " needs" : "s need"} manual classification.`] : []}
        loading={previewExecutionFailureClusters.isPending}
        onClose={() => setIsFailureClusterPreviewOpen(false)}
        open={canUseRunAi && isFailureClusterPreviewOpen}
        recommendedActions={previewExecutionFailureClusters.data?.recommended_actions || []}
        response={previewExecutionFailureClusters.data}
        signals={previewExecutionFailureClusters.data ? [
          { label: "Failed / blocked", value: String(previewExecutionFailureClusters.data.failed_or_blocked_results), tone: previewExecutionFailureClusters.data.failed_or_blocked_results ? "warning" : "positive" },
          { label: "Symptom groups", value: String(previewExecutionFailureClusters.data.clusters.length), tone: "neutral" },
          { label: "Unclassified", value: String(previewExecutionFailureClusters.data.unclassified_count), tone: previewExecutionFailureClusters.data.unclassified_count ? "warning" : "positive" }
        ] : []}
        subtitle={previewExecutionFailureClusters.data ? `${previewExecutionFailureClusters.data.execution.display_id} · ${previewExecutionFailureClusters.data.execution.name}` : selectedExecution?.name || "Selected run"}
        summary={previewExecutionFailureClusters.data?.explanation}
        title="Preview failure clusters"
      />

      {canViewRunAutomationCode && executionApiDetailState ? (
        <ExecutionApiStepDialog
          canRun={canExecuteRuns && canManageRunResults && canRecordSelectedCase && isExecutionStarted && !isExecutionLocked && Boolean(selectedExecution && selectedTestCaseId) && Boolean(executionApiDetailState.step.api_request)}
          captures={executionApiDetailState.captures}
          detail={executionApiDetailState.detail}
          isRunning={runningExecutionApiStepId === executionApiDetailState.step.id}
          note={executionApiDetailState.note}
          onClose={() => setExecutionApiDetailState(null)}
          onRun={() => void handleRunExecutionApiStep(executionApiDetailState.step)}
          status={executionApiDetailState.status}
          step={executionApiDetailState.step}
        />
      ) : null}

      {canPreviewRunAutomation && codePreviewState ? (
        <CodePreviewDialog
          code={codePreviewState.code}
          onClose={() => setCodePreviewState(null)}
          subtitle={codePreviewState.subtitle}
          title={codePreviewState.title}
        />
      ) : null}

      {historyResult ? <ExecutionAttemptDialog result={historyResult} runName={executionById[historyResult.execution_id]?.name || "Case run history"} canViewEvidence={canViewRunEvidence} onClose={() => setHistoryResult(null)} /> : null}

      {selectedExecution && runConfigurationResource ? <RunConfigurationDialog resource={runConfigurationResource} projectId={selectedExecution.project_id} appTypeId={selectedExecution.app_type_id} resourceId={runConfigurationResource === "environment" ? selectedExecution.test_environment?.id : runConfigurationResource === "configuration" ? selectedExecution.test_configuration?.id : selectedExecutionCaseSnapshot?.test_data_set_id || selectedExecution.test_data_set?.id} snapshot={runConfigurationResource === "environment" ? selectedExecution.test_environment?.snapshot : runConfigurationResource === "configuration" ? selectedExecution.test_configuration?.snapshot : selectedExecutionCaseSnapshot?.test_data_set_snapshot || selectedExecution.test_data_set?.snapshot} onClose={() => setRunConfigurationResource(null)} /> : null}

      {selectedExecution && isExecutionContextModalOpen ? (
        <ExecutionContextSnapshotModal execution={selectedExecution} onClose={() => setIsExecutionContextModalOpen(false)} />
      ) : null}

      {selectedExecution && isReportEmailModalOpen ? (
        <ReportEmailModal
          isSubmitting={shareExecutionReport.isPending || shareExecutionCaseReport.isPending}
          onClose={() => {
            setIsReportEmailModalOpen(false);
            setReportEmailCaseId("");
          }}
          onRecipientsChange={setReportEmailDraft}
          onSubmit={(event) => void handleShareExecutionReport(event)}
          recipients={reportEmailDraft}
          runName={reportEmailCaseId
            ? selectedExecutionCase?.title || "Selected test case run"
            : selectedExecution.name || "Selected run"}
        />
      ) : null}

      {isCreateExecutionModalOpen ? (
        <ExecutionCreateModal
          appTypeId={appTypeId}
          appTypes={appTypes}
          assigneeOptions={assigneeOptions}
          canCreateExecution={canCreateExecution}
          canConfigureParallelAutomation={canConfigureParallelAutomation}
          canRunLocalAutomation={canRunLocalAutomation}
          canRunRemoteAutomation={canRunRemoteAutomation}
          canUseRunAi={canUseRunAi}
          executionCreateMode={executionCreateMode}
          executionStartMode={executionStartMode}
          executionParallelEnabled={executionParallelEnabled}
          executionParallelCount={executionParallelCount}
          executionName={executionName}
          executionStartDate={executionStartDate}
          executionEndDate={executionEndDate}
          integrations={integrations}
          executionHookDraft={executionHookDraft}
          isPreviewingSmartExecution={previewSmartExecution.isPending || smartExecutionImagesBusy}
          isSubmitting={createExecution.isPending}
          isResolvingCases={isResolvingSmartRunCases}
          isPreparingDeliveryOptions={Boolean(pendingNavigationDelivery)}
          caseResolutionError={runCaseResolutionError}
          onRetryCaseResolution={() => { runPickerCaseQueries.forEach(query => void query.refetch()); }}
          directCaseSelectionMessage={directCaseSelectionMessage}
          libraryCases={smartExecutionLibraryCases}
          metadataByCaseId={executionPickerMetadataByCaseId}
          onAssigneeChange={setSelectedExecutionAssigneeIds}
          onConfigurationChange={handleExecutionConfigurationChange}
          onDataSetChange={handleExecutionDataSetChange}
          onEnvironmentChange={handleExecutionEnvironmentChange}
          onAppTypeChange={handleExecutionAppTypeChange}
          onClose={closeExecutionBuilder}
          onExecutionCreateModeChange={setExecutionCreateMode}
          onExecutionStartModeChange={setExecutionStartMode}
          onExecutionParallelEnabledChange={setExecutionParallelEnabled}
          onExecutionParallelCountChange={setExecutionParallelCount}
          onExecutionNameChange={setExecutionName}
          onExecutionStartDateChange={setExecutionStartDate}
          onExecutionEndDateChange={setExecutionEndDate}
          onExecutionReleaseChange={handleExecutionReleaseChange}
          onExecutionSprintChange={handleExecutionSprintChange}
          onExecutionBuildChange={handleExecutionBuildChange}
          onExecutionHookDraftChange={setExecutionHookDraft}
          onPreviewSmartExecution={() => void handlePreviewSmartExecution()}
          onProjectChange={handleExecutionProjectChange}
          onSuiteSelectionChange={setSelectedSuiteIds}
          onSelectAllSmartExecutionCases={() =>
            setSelectedSmartExecutionCaseIds(
              retainEligibleRunCases(smartPreviewCases.map(testCase => testCase.test_case_id), smartExecutionLibraryCaseById, executionStartMode !== "manual")
            )
          }
          onClearSmartExecutionCases={() => setSelectedSmartExecutionCaseIds([])}
          onClearSmartExecutionRequirements={handleClearSmartExecutionRequirements}
          onSmartExecutionAdditionalContextChange={handleSmartExecutionAdditionalContextChange}
          onSmartExecutionIntegrationChange={handleSmartExecutionIntegrationChange}
          onSmartExecutionRequirementSearchChange={setSmartExecutionRequirementSearch}
          onSmartExecutionReleaseScopeChange={handleSmartExecutionReleaseScopeChange}
          onSelectAllSmartExecutionRequirements={(requirementIds) => handleSelectSmartExecutionRequirements(requirementIds)}
          onSubmit={(event) => void handleCreateExecution(event)}
          onToggleSmartExecutionRequirement={handleToggleSmartExecutionRequirement}
          onToggleSmartExecutionCase={(testCaseId) =>
            setSelectedSmartExecutionCaseIds((current) =>
              current.includes(testCaseId) ? current.filter((id) => id !== testCaseId) : [...current, testCaseId]
            )
          }
          projectId={projectId}
          projects={projects}
          selectedConfigurationId={selectedExecutionConfigurationId}
          selectedExecutionAssigneeIds={selectedExecutionAssigneeIds}
          executionRelease={executionRelease}
          executionSprint={executionSprint}
          executionBuild={executionBuild}
          releaseOptions={executionReleaseOptions}
          sprintOptions={executionSprintOptions}
          buildOptions={smartExecutionBuildOptions}
          scopeSuites={scopeSuites} isLoadingSuites={Boolean(appTypeId && scopedSuitesQuery.isPending)}
          selectedAppType={selectedAppType?.name || ""}
          dataOptions={selectedExecutionDataOptions}
          onDataOptionsChange={setSelectedExecutionDataOptions}
          selectedDataSetId={selectedExecutionDataSetId}
          selectedEnvironmentId={selectedExecutionEnvironmentId}
          selectedProject={selectedProject?.name || ""}
          selectedSuiteIds={selectedSuiteIds}
          selectedDirectCaseIds={selectedDirectCaseIds}
          onDirectCaseSelectionChange={(ids, items) => { setSelectedDirectCaseIds(ids); setResolvedDirectCases(items); }}
          onDirectCaseItemsResolved={setResolvedDirectCases}
          onDirectCaseResolutionChange={setDirectCaseResolution}
          selectedSmartExecutionCaseIds={selectedSmartExecutionCaseIds}
          smartExecutionAdditionalContext={smartExecutionAdditionalContext}
          smartExecutionImages={smartExecutionImages}
          onSmartExecutionImagesBusyChange={setSmartExecutionImagesBusy}
          onSmartExecutionImagesChange={images=>{setSmartExecutionImages(images);resetSmartExecutionPreview();}}
          smartExecutionIntegrationId={smartExecutionIntegrationId}
          smartExecutionPreview={smartExecutionPreview}
          smartExecutionPreviewMessage={smartExecutionPreviewMessage}
          smartExecutionPreviewTone={smartExecutionPreviewTone}
          smartExecutionRequirementOptions={smartExecutionRequirementOptions}
          smartExecutionRequirementSearch={smartExecutionRequirementSearch}
          smartExecutionReleaseScope={smartExecutionReleaseScope}
          selectedSmartRequirementIds={selectedSmartRequirementIds}
        />
      ) : null}

      {isCreateScheduleModalOpen ? (
        <CreateExecutionScheduleModal
          appTypeId={appTypeId}
          appTypeName={selectedAppType?.name || ""}
          assigneeOptions={assigneeOptions}
          cadence={scheduleCadence}
          intervalMinutes={scheduleIntervalMinutes}
          executionName={executionName}
          isSubmitting={createExecutionSchedule.isPending || updateExecutionSchedule.isPending}
          mode={scheduleModalMode}
          nextRunAt={scheduleNextRunAt}
          releaseOptions={executionReleaseOptions}
          sprintOptions={executionSprintOptions}
          onAssigneeChange={setSelectedExecutionAssigneeIds}
          onCadenceChange={setScheduleCadence}
          onExecutionBuildChange={setExecutionBuild}
          onExecutionReleaseChange={setExecutionRelease}
          onExecutionSprintChange={setExecutionSprint}
          onIntervalMinutesChange={setScheduleIntervalMinutes}
          onClose={closeScheduleBuilder}
          onConfigurationChange={setSelectedExecutionConfigurationId}
          onDataSetChange={setSelectedExecutionDataSetId}
          onEnvironmentChange={setSelectedExecutionEnvironmentId}
          onExecutionNameChange={setExecutionName}
          onNextRunAtChange={setScheduleNextRunAt}
          onSubmit={(event) => void handleSubmitExecutionSchedule(event)}
          onSuiteSelectionChange={setSelectedSuiteIds}
          projectId={projectId}
          projectName={selectedProject?.name || ""}
          scopeSuites={scopeSuites}
          testCases={smartExecutionLibraryCases}
          metadataByCaseId={executionPickerMetadataByCaseId}
          selectedAssigneeIds={selectedExecutionAssigneeIds}
          selectedConfigurationId={selectedExecutionConfigurationId}
          dataOptions={selectedExecutionDataOptions}
          onDataOptionsChange={setSelectedExecutionDataOptions}
          selectedDataSetId={selectedExecutionDataSetId}
          selectedEnvironmentId={selectedExecutionEnvironmentId}
          selectedSuiteIds={selectedSuiteIds}
          executionRelease={executionRelease}
          executionSprint={executionSprint}
          executionBuild={executionBuild}
        />
      ) : null}
    </div>
  );
}
