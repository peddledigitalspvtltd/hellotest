import { StepExpandAllIcon, StepCollapseAllIcon, StepInsertIcon, StepPasteIcon, StepParameterIcon, ExecutionStepsIcon } from "./../workspaces/test-cases/CaseStepToolbar";
import { useCaseParameters } from "./../workspaces/test-cases/useCaseParameters";
import { getAiFailureProcessing } from "@hellotest/ai/frontend/components/AiFailureNotice";
import { pendingAuthoringProcessing } from "@hellotest/ai/frontend/lib/authoringLifecycle";
import { buildStepBlocks } from "../workspaces/test-cases/testCaseWorkspaceUtils";
import { useCaseStepEditing } from "./../workspaces/test-cases/useCaseStepEditing";
import { useCaseLibraryTable } from "./../workspaces/test-cases/useCaseLibraryTable";
import { useCaseLibraryModel } from "./../workspaces/test-cases/useCaseLibraryModel";
import { useCaseAuthoringSave } from "./../workspaces/test-cases/useCaseAuthoringSave";
import { CaseAuthoringWorkspace } from "./../workspaces/test-cases/CaseAuthoringWorkspace";
import { CaseMetadataAuthoring } from "./../workspaces/test-cases/CaseMetadataAuthoring";
import { StepIconButton, InlineStepInsertSlot } from "./../workspaces/test-cases/CaseStepInsert";
import { TestCaseExecutionModal } from "./../workspaces/test-cases/CaseExecutionModal";
import { CaseLibraryView } from "./../workspaces/test-cases/CaseLibraryView";
import { useCaseHealth } from "./../workspaces/test-cases/useCaseHealth";
import { useCaseLibrary } from "./../workspaces/test-cases/useCaseLibrary";
import { stepClipboardScopeKey, stepInsertionContextFromStep, TEST_CASE_RENDER_BATCH_SIZE, TEST_CASE_DETAIL_STALE_TIME_MS, TEST_CASE_COPY_HYDRATION_BATCH_SIZE, normalizeDeliveryScopeValue, testCaseDetailQueryKey, isLegacyInlineAutomationBuilderEnabled, TEST_CASE_REVIEW_STATUS_LABELS, TEST_CASE_WORKFLOW_STATUS_OPTIONS, TEST_CASE_TYPE_OPTIONS, TEST_CASE_WORKFLOW_STATUS_LABELS, getTestCaseWorkflowStatus, formatTestCaseWorkflowStatus, formatCompactDuration, getTestCaseExecutionTypeLabel, createEmptyCaseDraft, EMPTY_STEP_DRAFT, executionHistoryDateFormatter, createDefaultTestCaseSections, createCreateModeTestCaseSections, createDraftStepId, buildCaseStepsFromGherkin, buildGroupedCaseGherkin, createDraftGroupId, buildGherkinQualitySteps, calculateTestCaseAiQualityScore, buildTestCaseQualitySuggestions, TEST_CASE_PARAMETER_DRAFT_STORAGE_KEY, SUITE_PARAMETER_DRAFT_STORAGE_KEY, RUN_PARAMETER_PREVIEW_STORAGE_KEY, TEST_CASE_RUN_POLL_INTERVAL_MS, normalizeScopedParameterValues, normalizeTestCaseParameterValues, normalizeSuiteParameterValues, normalizeRunParameterValues, serializeScopedParameterValues, serializeTestCaseParameterValues, areTestCaseParameterValuesEqual, areSuiteParameterValuesEqual, readStoredParameterDrafts, writeStoredParameterDrafts, readStoredTestCaseParameterDrafts, readStoredSuiteParameterDrafts, readStoredRunParameterDrafts, readStoredParameterDraft, hasStoredParameterDraft, writeStoredParameterDraft, clearStoredParameterDraft, readStoredTestCaseParameterDraft, hasStoredTestCaseParameterDraft, writeStoredTestCaseParameterDraft, clearStoredTestCaseParameterDraft, readStoredSuiteParameterDraft, hasStoredSuiteParameterDraft, writeStoredSuiteParameterDraft, clearStoredSuiteParameterDraft, readStoredRunParameterDraft, writeStoredRunParameterDraft, clearStoredRunParameterDraft, buildTestCaseParameterDraftScopeKey, buildSuiteParameterDraftScopeKey, buildRunParameterDraftScopeKey, buildAuthoringLensCode, normalizeDraftSteps, stripAutomationStepFields, importedRowHasProtectedAutomation, buildDraftStepsFromAiAuthoringPreview, buildPersistedStepsFromAiAuthoringPreview, normalizeCopiedSteps, materializeCopiedSteps, formatBulkStepActionLabel, formatExecutionHistoryDate, resolveScopedIntegration, formatRecorderDisplayMode, formatModuleCaseUpdatedAt } from "./../workspaces/test-cases/testCaseWorkspaceUtils";
import { TestCaseActionIcon, TestCaseImportIcon, TestCaseExportIcon, TestCaseSparkIcon, TestCaseCreateIcon, TestCaseDropdownIcon, type TestCaseSplitAction, TestCaseSplitActionButton, TestCaseDeleteIcon, TestCaseRunIcon, DeferredTestCaseCatalogValue, ModuleChevronIcon, ModulePencilIcon, TestCaseFlowMapIcon, TestCaseAcceptIcon, TestCaseRejectIcon, TestCaseTileActionButton } from "./../workspaces/test-cases/CaseLibraryActions";
import { CaseLabelsField, AutomationScriptLens, AutomationLearningMemory, EditorAccordionSection, EditorAccordionChevronIcon } from "./../workspaces/test-cases/CaseWorkspacePrimitives";
import { StepGroupIcon, StepSharedGroupIcon, StepGroupChevronIcon, StepUngroupIcon, StepGroupHeader, StepGroupModal, SharedGroupPickerModal } from "./../workspaces/test-cases/CaseStepGroups";
import { normalizeSharedGroupComparableText, normalizeComparableAutomationCode, normalizeComparableApiRequest, areComparableStepAutomationEqual, StepIconShell, StepAiIcon, StepMoveUpIcon, StepMoveDownIcon, StepSaveIcon, StepDeleteIcon, StepCopyIcon, StepInsertAboveIcon, StepInsertBelowIcon, StepCutIcon, StepPasteAboveIcon, StepPasteBelowIcon, StepKebabIcon, getStepKindMeta, STEP_ACTION_HOVER_EXIT_DELAY_MS, StepActionMenu, EditableStepCard, DraftStepCard } from "./../workspaces/test-cases/CaseStepCards";
import { type TestCaseDraft, type ExecutionStartMode, type TestCaseDeliveryContext, type StepDraft, type TestCaseAuthoringLens, type AuthoringStepProjection, type DraftTestStep, type CopiedTestStep, type StepInsertionGroupContext, type CutStepSource, type StepActionMenuAction, type CaseStepFilter, type CaseRunFilter, type TestCaseExecutionAssigneeOption, type TestCaseEditorSectionKey, type TestCaseDetailTab } from "./../workspaces/test-cases/testCaseWorkspaceTypes";
import { LoadingSkeleton } from "@hellotest/platform/frontend/src/shared/components/LoadingSkeleton";
import { type CreateModuleDraft, MAX_CREATE_MODULE_REQUIREMENTS, ModuleRequirementPicker, TestCaseCreateModuleModal } from "../components/TestCaseModuleAuthoring";
import { CaseLibraryCard } from "../components/CaseLibraryCard";
import { CaseAuthoringHealth } from "../components/CaseAuthoringHealth";
import { CaseEvidenceLineage } from "../components/CaseEvidenceLineage";
import { caseExecutionGuidance } from "../lib/caseLibrarySignals";
import { takeAgentProposal } from "@hellotest/platform/frontend/src/lib/agentProposalDraft";
import { prepareAiPromptFiles } from '../lib/aiPromptFiles';
import { platformApi } from '@hellotest/platform/client';
import { automationStartUrlError, reviewedAutomationStartUrl } from "@hellotest/automation/frontend/lib/automationStartUrl";
import { useAutomationBuildParameters } from "@hellotest/automation/frontend/hooks/useAutomationBuildParameters";
import { getAutomationRuntimeTypes } from "@hellotest/automation/frontend/lib/automationRuntime";
import { capabilityView } from "@hellotest/platform/frontend/src/platform/capabilities/CapabilityView";
const AiLifecycleReview = capabilityView<import("react").ComponentProps<typeof import("@hellotest/ai/frontend/components/AiLifecycleReview")["AiLifecycleReview"]>>("ai", "AiLifecycleReview", () => import("@hellotest/ai/frontend/components/AiLifecycleReview"), "AI review");
const AiCaseAuthoringModal = capabilityView<import("react").ComponentProps<typeof import("@hellotest/ai/frontend/components/AiCaseAuthoringModal")["AiCaseAuthoringModal"]> & {}>("ai", "AiCaseAuthoringModal", () => import("@hellotest/ai/frontend/components/AiCaseAuthoringModal"), "ai");
const AiDesignStudioModal = capabilityView<import("react").ComponentProps<typeof import("@hellotest/ai/frontend/components/AiDesignStudioModal")["AiDesignStudioModal"]> & {}>("ai", "AiDesignStudioModal", () => import("@hellotest/ai/frontend/components/AiDesignStudioModal"), "ai");
const TestCaseChangeImpactDialog = capabilityView<import("react").ComponentProps<typeof import("@hellotest/ai/frontend/components/TestCaseChangeImpactDialog")["TestCaseChangeImpactDialog"]> & {}>("ai", "TestCaseChangeImpactDialog", () => import("@hellotest/ai/frontend/components/TestCaseChangeImpactDialog"), "ai");
import { TestCaseSuiteTransferModal, type SuiteTransferAction } from "../components/TestCaseSuiteTransferModal";
import { StepKindIconBadge } from "../components/StepKindIconBadge";
import "../components/ScopedRunCreation.css";
import "../components/AuthoringExperience.css";
import { AiReviewControls } from "@hellotest/ai/frontend/components/AiReviewControls";
import { draftReadinessIssues, restoreAiPrivateParameterValues } from "@hellotest/ai/frontend/lib/draftReadiness";
import { useAiLlmDefault } from "@hellotest/integration/frontend/hooks/useAiLlmDefault";
import { AuthoringDataSetPanel } from "@hellotest/platform/frontend/src/platform/components/AuthoringDataSetPanel";
import { TestDataSetPickerDialog } from "../components/TestDataSetPickerDialog";
import { downloadParameterCsvTemplate } from "../lib/executionParameterContext";
import type { TestDataOptions } from "@hellotest/platform/frontend/src/types";
import { RunDataSetup } from "../components/RunDataSetup";
import { ChangeEvent, FormEvent, Fragment, useDeferredValue, useEffect, useId, useMemo, useRef, useState, useTransition, type DragEvent as ReactDragEvent, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useSplitActionMenu } from "@hellotest/platform/frontend/src/shared/hooks/useSplitActionMenu";
import { useInfiniteQuery, useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import type { InfiniteData } from "@tanstack/react-query";
import { isPendingCaseReview, ownsCaseReview } from "../lib/testCaseReview";
import { parseWorkflowReviewScope } from "../lib/workflowReviewScope";
import "../components/test-case-review.css";
import "./TestCasesPage.import.css";
import "./TestCasesPage.detail.css";
import { useNavigate, useSearchParams } from "react-router-dom";
import { IconChartBar, IconClipboardCheck, IconDownload, IconFilter, IconInfoCircle } from "@tabler/icons-react";
import { useAuth } from "@hellotest/platform/frontend/src/auth/AuthContext";
import { ArtifactAssuranceWorkspace } from "@hellotest/ai/frontend/components/ArtifactAssuranceWorkspace";


import { ActivityIcon, AddIcon, BugIcon, ChevronDownIcon, ChevronRightIcon, CollapseExpandIcon, CopyIcon, ExportIcon, FolderAddIcon, FolderOffIcon, ModuleIcon, MoveIcon, OpenIcon, PauseIcon, PencilIcon, RecordIcon, SearchIcon, SelectionToggleIcon, StoryIcon, TagIcon, TestCaseIcon, TrashIcon } from "@hellotest/platform/frontend/src/platform/components/AppIcons";
import { CatalogActionMenu } from "@hellotest/platform/frontend/src/shared/components/CatalogActionMenu";
import { CatalogCardDescription } from "@hellotest/platform/frontend/src/shared/components/CatalogCardDescription";
import { CatalogSelectionControls } from "@hellotest/platform/frontend/src/shared/components/CatalogSelectionControls";
import { CatalogViewToggle } from "@hellotest/platform/frontend/src/shared/components/CatalogViewToggle";
import { CatalogSearchFilter } from "@hellotest/platform/frontend/src/shared/components/CatalogSearchFilter";
import { DataTable, type DataTableColumn } from "@hellotest/platform/frontend/src/shared/components/DataTable";
import { DetailSectionTabs } from "@hellotest/platform/frontend/src/shared/components/DetailSectionTabs";
import { RelatedWorkItemsPanel } from "@hellotest/manual/frontend/components/RelatedWorkItemsPanel";
import { DisplayIdBadge } from "@hellotest/platform/frontend/src/shared/components/DisplayIdBadge";
import { ExternalReferencesField } from "@hellotest/manual/frontend/components/ExternalReferencesField";
import { DialogCloseButton } from "@hellotest/platform/frontend/src/shared/components/DialogCloseButton";
import { ExecutionContextSelector } from "../components/ExecutionContextSelector";
import { FormField } from "@hellotest/platform/frontend/src/shared/components/FormField";
import { ContextSelect } from "@hellotest/platform/frontend/src/shared/components/ContextSelect";
import { AuthoringContextMenu } from "@hellotest/platform/frontend/src/shared/components/AuthoringContextMenu";
import { RunPlanningFields } from "../components/RunPlanningFields";
import { buildGherkinFromSteps, GherkinEditor } from "../components/GherkinEditor";
import { composeGherkinDocument, gherkinToStructuredCase, mergeGherkinStepMetadata, normalizeGherkinParameterReferences, sanitizeGherkinDocumentText, setGherkinFeatureTitle, splitGherkinDocument, structuredCaseToGherkin } from "../lib/gherkin";
import { annotateGherkinStepGroups, collectBehaviorRowGroups } from "../lib/gherkinBehavior";
import { InfoTooltip } from "@hellotest/platform/frontend/src/shared/components/InfoTooltip";
import { HierarchyQuickInsights } from "../components/HierarchyQuickInsights";
import { HierarchyAutoLoadSentinel } from "../components/HierarchyLoadMoreButton";
import { JiraAttachmentIcon, JiraAttachmentPanel } from "@hellotest/integration/frontend/components/JiraAttachmentPanel";
import { LinkedTestCaseModal } from "../components/LinkedTestCaseModal";
import { LinkedDefectsPanel } from "../components/LinkedDefectsPanel";
import { LoadingState } from "@hellotest/platform/frontend/src/shared/components/LoadingState";
import { MultiAssigneePicker } from "@hellotest/platform/frontend/src/shared/components/MultiAssigneePicker";
import { PageHeader } from "@hellotest/platform/frontend/src/shared/components/PageHeader";
import { Panel } from "@hellotest/platform/frontend/src/shared/components/Panel";
import { QualityMetricStrip, type QualityMetric } from "@hellotest/dashboard/frontend/components/QualityMetricStrip";
import { EntityHealthButton, EntityHealthDialog } from "@hellotest/manual/frontend/components/EntityHealthDialog";
import { RecorderSessionInsights } from "@hellotest/automation/frontend/components/RecorderSessionInsights";
import { RecorderStartControls, type RecorderStartOptions } from "@hellotest/automation/frontend/components/RecorderStartControls";
import { RichTextAiRephraseIcon, RichTextContent, RichTextEditor, richTextToPlainText } from "@hellotest/platform/frontend/src/platform/components/RichTextEditor";
import { StepParameterDialog } from "../components/StepParameterDialog";
import { migrateCaseParameterScope } from "../lib/caseParameterScope";
import { casePrivateParameterNames, collectPrivateParameterNames, caseParameterSaveOptions, caseParameterDraftValues, restoreCaseParameterDraftValues, isPrivateParameterName } from "@hellotest/platform/frontend/src/shared/lib/parameterPrivacy";
import { StepParameterizedText } from "../components/StepParameterizedText";
import {
  AutomationCodeIcon,
  CodePreviewDialog,
  SharedGroupLevelIcon,
  StepAutomationDialog,
  StepIconButton as InlineStepToolButton,
  StepTypePickerButton
} from "@hellotest/automation/frontend/components/StepAutomationEditor";
import { SharedStepsIcon as SharedStepsIconGraphic } from "../components/SharedStepsIcon";
import { StatusBadge } from "@hellotest/platform/frontend/src/shared/components/StatusBadge";
import {
  TileCardCaseIcon,
  TileCardFact,
  TileCardIconFrame,
  TileCardMetric,
  TileCardProgress,
  TileCardSuiteIcon,
  TileCardStepsIcon,
  formatTileCardLabel
} from "@hellotest/platform/frontend/src/shared/components/TileCardPrimitives";
import { TestCasePicker } from "../components/TestCasePicker";
import { SuiteCreateModal, type SuiteCreateInput } from "../components/SuiteCreateModal";
import { TileBrowserPane } from "@hellotest/platform/frontend/src/shared/components/TileBrowserPane";
import { TileCardSkeletonGrid } from "@hellotest/platform/frontend/src/shared/components/TileCardSkeletonGrid";
import { ToastMessage } from "@hellotest/platform/frontend/src/shared/components/ToastMessage";
import { TestCaseVersionHistory } from "../components/TestCaseVersionHistory";
import { TraceabilityRunHistory } from "@hellotest/manual/frontend/components/TraceabilityRunHistory";
import { WorkspaceBackButton, WorkspaceMasterDetail } from "@hellotest/platform/frontend/src/platform/components/WorkspaceMasterDetail";
import { VisualTestBuilder } from "@hellotest/automation/frontend/components/VisualTestBuilder";
import { useDeleteConfirmation } from "@hellotest/platform/frontend/src/shared/components/DeleteConfirmationDialog";
import "@hellotest/platform/frontend/src/platform/components/module-navigation.css";
import "../components/suite-authoring-reference.css";
import "../components/create-module-modal.css";
import "../components/create-suite-modal.css";
import {
  buildDataSetPayload,
  buildEmptyDataSetDraft,
  DataSetForm,
  ResourceModalShell,
  type DataSetDraft
} from "./TestEnvironmentPage";
import { useCurrentAppType, useCurrentProject } from "@hellotest/platform/frontend/src/platform/hooks/useCurrentProject";
import { useDomainMetadata } from "@hellotest/platform/frontend/src/platform/hooks/useDomainMetadata";
import { useDomainSuggestions } from "@hellotest/platform/frontend/src/platform/hooks/useDomainOptions";
import { getDomainOptions, getDomainDefault, resolveDomainSuggestionValue } from "@hellotest/platform/frontend/src/platform/lib/domainOptions";
import { useDialogFocus } from "@hellotest/platform/frontend/src/shared/hooks/useDialogFocus";
import { useAiPromptRegistry } from "@hellotest/integration/frontend/hooks/useAiPromptRegistry";
import { useFeatureFlags } from "@hellotest/platform/frontend/src/platform/hooks/useFeatureFlags";
import { useCapabilityAccess } from "@hellotest/platform/frontend/src/platform/hooks/useCapabilityAccess";
import { optionalQueryView } from "@hellotest/platform/frontend/src/shared/lib/optionalQueryView";
import { formatAuditTimestamp, resolveAuditUserLabel } from "@hellotest/platform/frontend/src/shared/lib/auditDisplay";
import { buildTestCaseImportTemplate,
  countImportedGroups,
  countImportedSuites,
  countImportedSteps,
  getImportedStepPreviewLabel,
  type ImportedTestCaseRow
} from "../lib/testCaseImport";
import {
  getTestCaseImportSourceLabel,
  prepareTestCaseImportBatch,
  TEST_CASE_IMPORT_SOURCE_OPTIONS,
  type PreparedTestCaseImportBatch,
  type TestCaseImportSource,
  type TestCaseImportSourceSelection
} from "../lib/testCaseSourceImport";
import { api } from "@hellotest/platform/frontend/src/lib/api";
import type { TestCaseCatalogRow } from "../lib/testCaseCatalog";
import { hasAutomationCoverage } from "../lib/caseIdentity";
import {
  BUG_TO_TEST_CASE_STORAGE_KEY,
  buildConvertedBugSteps,
  parseStoredBugToTestCaseDraft,
  type BugToTestCaseDraft
} from "../lib/bugToTestCaseConversion";
import {
  buildDeliveryScopeOptions,
  resolveDeliveryScopePrefill,
  type DeliveryScopeOption
} from "@hellotest/manual/frontend/lib/deliveryScopeOptions";
import {
  canEditAutomationCode as resolveCanEditAutomationCode,
  canGenerateAutomationCode as resolveCanGenerateAutomationCode,
  canPreviewAutomationCode as resolveCanPreviewAutomationCode,
  canRecordAutomationCode as resolveCanRecordAutomationCode,
  canViewAutomationCode as resolveCanViewAutomationCode
} from "@hellotest/automation/frontend/lib/automationAccess";
import { asArray, getVerifiedNextPageCursor, normalizePagedResult } from "@hellotest/platform/frontend/src/shared/lib/collectionGuards";
import { AI_DESIGN_DEFAULT_DRAFT_COUNT, AI_REFERENCE_IMAGE_LIMITS, mergeAiReferenceImagesWithinBudget, parseExternalLinks, readImageFiles, toggleRequirementOnPreviewCase } from "@hellotest/ai/frontend/lib/aiDesignStudio";
import { assessTestCaseReviewReadiness } from "@hellotest/ai/frontend/lib/aiAssurance";
import { buildTestCaseAssuranceAnalysis, mergeAssuranceReview } from "@hellotest/ai/frontend/lib/artifactAssurance";
import { formatReferenceList, parseReferenceList } from "@hellotest/platform/frontend/src/shared/lib/externalReferences";
import { areFeatureFlagsEnabled, requiredFeatureFlagsForPath } from "@hellotest/platform/frontend/src/platform/lib/featureFlags";
import { downloadCsvRecords } from "@hellotest/platform/frontend/src/shared/lib/csvExport";
import { summarizeExecutionStart } from "../lib/executionStartSummary";
import { deriveModuleHealth } from "../lib/hierarchyHealth";
import { buildHistoryStatusBreakdown, buildReadinessScoreBreakdown } from "@hellotest/platform/frontend/src/shared/lib/tileProgressBreakdown";
import { chunkHierarchyMoveIds, readHierarchyDragPayload, resolveHierarchyDragIds, writeHierarchyDragPayload } from "../lib/hierarchyDrag";
import { getHierarchyPageSize, getUnassignedPageSize } from "../lib/hierarchyPagination";
import { upsertSharedStepGroupInCache } from "../lib/sharedStepGroupCache";
import { findByRoutableId, getRoutableId } from "@hellotest/platform/frontend/src/shared/lib/urlSelection";
import { evaluateTestDataTemplate, hasTestDataGeneratorTemplate } from "../lib/testDataGenerators";
import {
  buildCaseAutomationCode,
  buildGroupAutomationCode,
  normalizeApiRequest,
  normalizeAutomationCode,
  normalizeStepType,
  resolveStepAutomationCode,
  stepHasAutomation
} from "@hellotest/automation/frontend/lib/stepAutomation";
import { type AssigneeOption, buildAssigneeOptions } from "@hellotest/platform/frontend/src/platform/lib/userDisplay";
import {
  buildDataSetParameterDefinitions,
  buildDataSetParameterValues,
  buildCaseParameterValues,
  combineStepParameterValues,
  collectSensitiveDataSetParameterNames,
  collectCaseStepParameters,
  excludeSensitiveStepParameterValues,
  normalizeStepParameterValues,
  parseStepParameterName,
  resolveStepParameterText,
  type StepParameterDefinition,
  type StepParameterScope
} from "@hellotest/platform/frontend/src/shared/lib/stepParameters";
import { readDefaultCatalogViewMode } from "@hellotest/platform/frontend/src/shared/lib/viewPreferences";
import { isRovoIntegrationId } from "@hellotest/integration/frontend/lib/rovo";
import type {
  AiAuthoredTestCasePreview,
  AiDesignImageInput,
  AiDesignedTestCaseCandidate,
  AiTestCaseGenerationJob,
  AppType,
  AutomationLearningCacheEntry,
  Execution,
  ExecutionResult,
  Integration,
  ProjectMember,
  Project,
  RecorderSessionResponse,
  Requirement,
  RequirementIteration,
  RequirementRelease,
  SharedStepGroup,
  TestCase,
  TestDataSet,
  TestCaseModule,
  TestStep,
  TestSuite,
  User
} from "@hellotest/platform/frontend/src/types";

export function TestCasesPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [automationCloneSource, setAutomationCloneSource] = useState<TestCase | null>(null);
  const [automationCloneStartUrl, setAutomationCloneStartUrl] = useState("");
  const [automationCloneSubmitting, setAutomationCloneSubmitting] = useState(false);
	  const [searchParams, setSearchParams] = useSearchParams();
  const workflowReviewParam = searchParams.get("review_cases");
  const workflowReviewScope = useMemo(() => parseWorkflowReviewScope(workflowReviewParam), [workflowReviewParam]);
	  const { session } = useAuth();
	  const [projectId, setProjectId] = useCurrentProject();
	  const [appTypeId, setAppTypeId] = useCurrentAppType(projectId);
  const { reviewBuildParameters, parameterReviewDialog } = useAutomationBuildParameters(`${projectId}:${appTypeId}`);
	  const featureFlagsQuery = useFeatureFlags(Boolean(session));
  const { can, isLoading: isCapabilityLoading } = useCapabilityAccess(projectId);
	  const canCreateTestCases = can("testcase.create");
	  const canImportTestCases = can("testcase.import");
	  const canUpdateTestCases = can("testcase.update");
	  const canViewRequirements = can("requirement.view");
	  const canViewDeliveryScopes = can("requirement_iteration.view")
	    && areFeatureFlagsEnabled(featureFlagsQuery.data, ["hellotest.manual.requirements"]);
	  const canViewProjectMembers = can("project_member.view");
	  const canUseTestData = areFeatureFlagsEnabled(featureFlagsQuery.data, ["hellotest.manual.test_data"]);
	  const canViewTestData = can("data.view") && canUseTestData;
	  const canManageTestData = can("data.manage") && canUseTestData;
	  const canDeleteTestCases = can("testcase.delete");
	  const canViewAttachments = can("attachment.view");
	  const canCreateAttachments = can("attachment.create");
	  const canDeleteAttachments = can("attachment.delete");
	  const canExportTestCases = can("testcase.export");
	  const canUseTestCaseAi = can("testcase.ai")
	    && areFeatureFlagsEnabled(featureFlagsQuery.data, ["hellotest.ai.test_authoring"]);
	  const canCreateSuites = can("suite.create")
	    && areFeatureFlagsEnabled(featureFlagsQuery.data, ["hellotest.manual.suites"]);
	  const canUpdateSuites = can("suite.update")
	    && areFeatureFlagsEnabled(featureFlagsQuery.data, ["hellotest.manual.suites"]);
  const canEditSuiteLinks = canUpdateSuites && canUpdateTestCases && can("suite.view");
	  const canCreateRuns = can("run.create")
	    && areFeatureFlagsEnabled(featureFlagsQuery.data, ["hellotest.manual.runs"]);
	  const canViewExecutionInsights = can("run.view")
	    && can("result.view")
	    && areFeatureFlagsEnabled(featureFlagsQuery.data, requiredFeatureFlagsForPath("/executions"));
	  const canUseAutomationWorkspace = areFeatureFlagsEnabled(featureFlagsQuery.data, ["hellotest.automation.workspace"]);
	  const canViewAutomationInsights = can("automation.view")
	    && areFeatureFlagsEnabled(featureFlagsQuery.data, requiredFeatureFlagsForPath("/automation"));
	  const canViewAutomationCode = resolveCanViewAutomationCode(session, featureFlagsQuery.data, projectId);
	  const canEditAutomationCode = resolveCanEditAutomationCode(session, featureFlagsQuery.data, projectId);
	  const canPreviewAutomationCode = resolveCanPreviewAutomationCode(session, featureFlagsQuery.data, projectId);
	  const canBuildAutomation = canEditAutomationCode;
	  const canUseAutomationAi = resolveCanGenerateAutomationCode(session, featureFlagsQuery.data, projectId);
	  const canUseRecorder = resolveCanRecordAutomationCode(session, featureFlagsQuery.data, projectId);
	  const canRunLocalAutomation = can("automation.run.local")
	    && canUseAutomationWorkspace
	    && areFeatureFlagsEnabled(featureFlagsQuery.data, ["hellotest.automation.local_execution"]);
	  const canRunRemoteAutomation = can("automation.run.remote")
	    && canUseAutomationWorkspace
	    && areFeatureFlagsEnabled(featureFlagsQuery.data, ["hellotest.automation.remote_execution"]);
	  const canConfigureParallelAutomation = can("automation.run.parallel")
	    && canUseAutomationWorkspace
	    && areFeatureFlagsEnabled(featureFlagsQuery.data, ["hellotest.automation.parallel_execution"]);
	  const canUseMobileAppium = can("mobile.manage")
	    && canUseAutomationWorkspace
	    && areFeatureFlagsEnabled(featureFlagsQuery.data, ["hellotest.mobile.appium"]);
	  const { getPrompt, getLlmIntegrationId, getMetricCriteria } = useAiPromptRegistry(Boolean(session));
  const { confirmAction, confirmDelete, confirmationDialog } = useDeleteConfirmation();
  const domainMetadataQuery = useDomainMetadata();
  const ensureTestCaseDetail = (testCaseId: string) => queryClient.fetchQuery<TestCase>({
    queryKey: testCaseDetailQueryKey(projectId, testCaseId),
    queryFn: () => api.testCases.get(testCaseId, { project_id: projectId }),
    staleTime: TEST_CASE_DETAIL_STALE_TIME_MS
  });
  const reviewUserId = session?.user.id || "";
  const reviewScopeKey = JSON.stringify([reviewUserId, projectId, appTypeId]);
  const currentReviewScopeRef = useRef(reviewScopeKey);
  currentReviewScopeRef.current = reviewScopeKey;
  const [reviewQueueScope, setReviewQueueScope] = useState("");
  const isReviewQueueOpen = reviewQueueScope === reviewScopeKey && Boolean(reviewUserId);
  const reviewActionsRef = useRef(new Set<string>());
  const reviewSuggestionSnapshotRef = useRef<TestCase | null>(null);
  const [reviewingCaseIds, setReviewingCaseIds] = useState<string[]>([]);
  const [isBulkReviewRunning, setIsBulkReviewRunning] = useState(false);
  const bulkReviewRunningRef = useRef(false);
  const [isBulkReviewRejectOpen, setIsBulkReviewRejectOpen] = useState(false);
  const [bulkReviewComment, setBulkReviewComment] = useState("");
  const [bulkReviewError, setBulkReviewError] = useState("");
  const [selectedTestCaseId, setSelectedTestCaseId] = useState("");
  const currentCaseLinkScopeRef = useRef("");
  currentCaseLinkScopeRef.current = `${projectId}:${selectedTestCaseId}`;
  const [activeTestCaseDetailTab, setActiveTestCaseDetailTab] = useState<TestCaseDetailTab>("details");
  useEffect(() => {
    if (!canUseTestCaseAi && activeTestCaseDetailTab === "assurance") setActiveTestCaseDetailTab("details");
  }, [canUseTestCaseAi, activeTestCaseDetailTab]);
  const { searchTerm, setSearchTerm, catalogViewMode, setCatalogViewMode, isCatalogViewPending, startCatalogViewTransition, deferredSearchTerm, visibleTestCaseCount, setVisibleTestCaseCount, caseStatusFilter, setCaseStatusFilter, casePriorityFilter, setCasePriorityFilter, caseStepFilter, setCaseStepFilter, caseRunFilter, setCaseRunFilter, selectedActionTestCaseIds, setSelectedActionTestCaseIds, selectedActionCaseSnapshotsRef, expandedModuleIds, setExpandedModuleIds, isUnassignedModuleExpanded, setIsUnassignedModuleExpanded, setModulePageCursorsById, selectedModuleIds, setSelectedModuleIds, libraryScope, setLibraryScope, catalogFilterKey, isCatalogFiltered, collapsedFilteredModuleIds, isModuleExpanded, testCaseMetricsQuery, testCasesQuery, testCaseModulesQuery, modulePageRequests, moduleCaseQueries, modulePageStateById, retryModulePage, loadNextModulePage, toggleModuleExpansion, testCaseModules } = useCaseLibrary({ workflowReviewScope, projectId, appTypeId, can, canViewExecutionInsights, reviewUserId, isReviewQueueOpen });
  const [isCreating, setIsCreating] = useState(false);
  const [linkedPreviewCaseId, setLinkedPreviewCaseId] = useState("");
  const [isDeletingSelectedTestCases, setIsDeletingSelectedTestCases] = useState(false);
  const [isCreateSuiteModalOpen, setIsCreateSuiteModalOpen] = useState(false);
  const [isCreateModuleModalOpen, setIsCreateModuleModalOpen] = useState(false);
  const [isCreatingModuleWorkflow, setIsCreatingModuleWorkflow] = useState(false);
  const [moduleDraftInitialCaseIds, setModuleDraftInitialCaseIds] = useState<string[]>([]);
  const [moduleAssignmentRetry, setModuleAssignmentRetry] = useState<{ id: string; name: string } | null>(null);
  const moduleCreateWorkflowPendingRef = useRef(false);
  const [healthModuleId, setHealthModuleId] = useState<string | null>(null);
  useEffect(() => setHealthModuleId(null), [projectId, appTypeId, isReviewQueueOpen]);
  const [deletingModuleId, setDeletingModuleId] = useState("");
  const [renamingModuleId, setRenamingModuleId] = useState("");
  const [renamingModuleName, setRenamingModuleName] = useState("");
  const [draggingCaseIds, setDraggingCaseIds] = useState<string[]>([]);
  const testCaseMovePendingRef = useRef(false);
  const testCaseMoveScopeRef = useRef(`${projectId}:${appTypeId}`);
  const [reviewComment, setReviewComment] = useState("");
  const [reviewSuggestionCaseId, setReviewSuggestionCaseId] = useState("");
  const [reviewSuggestionComment, setReviewSuggestionComment] = useState("");
  const [reviewSuggestionError, setReviewSuggestionError] = useState("");
  const [reviewSuggestionConfirmed, setReviewSuggestionConfirmed] = useState(true);
  const [isQualitySuggestionModalOpen, setIsQualitySuggestionModalOpen] = useState(false);
  const [isSuiteTransferModalOpen, setIsSuiteTransferModalOpen] = useState(false);
  const [suiteTransferAction, setSuiteTransferAction] = useState<SuiteTransferAction>("move");
  const [suiteTransferCaseIds, setSuiteTransferCaseIds] = useState<string[]>([]);
  const [suiteTransferProjectId, setSuiteTransferProjectId] = useState("");
  const [suiteTransferAppTypeId, setSuiteTransferAppTypeId] = useState("");
  const [suiteTransferSuiteIds, setSuiteTransferSuiteIds] = useState<string[]>([]);
  const [isCreateExecutionModalOpen, setIsCreateExecutionModalOpen] = useState(false);
  const runDeliveryFieldsEditedRef = useRef({ release: false, sprint: false });
  const [pendingRunBuilder, setPendingRunBuilder] = useState<{ testCaseIds: string[]; mode: ExecutionStartMode; projectId: string; appTypeId: string } | null>(null);
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
  const [caseDeliveryRelease, setCaseDeliveryRelease] = useState("");
  const [caseDeliverySprint, setCaseDeliverySprint] = useState("");
  const [executionBuild, setExecutionBuild] = useState("");
  const [executionStartMode, setExecutionStartMode] = useState<ExecutionStartMode>("manual");
  const [executionParallelEnabled, setExecutionParallelEnabled] = useState(false);
  const [executionParallelCount, setExecutionParallelCount] = useState(1);

  useEffect(() => {
    if (!canConfigureParallelAutomation && executionParallelEnabled) {
      setExecutionParallelEnabled(false);
      setExecutionParallelCount(1);
    }
    if (executionStartMode === "local" && !canRunLocalAutomation) setExecutionStartMode("manual");
    if (executionStartMode === "remote" && !canRunRemoteAutomation) setExecutionStartMode("manual");
  }, [canConfigureParallelAutomation, canRunLocalAutomation, canRunRemoteAutomation, executionParallelEnabled, executionStartMode]);
  const [automationStartUrl, setAutomationStartUrl] = useState("");
  const [automationContext, setAutomationContext] = useState("");
  const [automationFailureThreshold, setAutomationFailureThreshold] = useState(3);
  const [recorderSession, setRecorderSession] = useState<RecorderSessionResponse | null>(null);
  const [recorderSessionCaseId, setRecorderSessionCaseId] = useState("");
  const [recorderStartOptions, setRecorderStartOptions] = useState<RecorderStartOptions | null>(null);
  const [recentRecorderCompletedCaseId, setRecentRecorderCompletedCaseId] = useState("");
  const [expandedSections, setExpandedSections] = useState<Record<TestCaseEditorSectionKey, boolean>>(createDefaultTestCaseSections);
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState<"success" | "error">("success");
  const lastCaseDraftSeedRef = useRef("");
  const initializingCreateLinkScopeRef = useRef("");
  const lastCaseSaveNoticeRef = useRef("");
  const lastTestCaseParameterSeedRef = useRef("");
  const lastExpandedStepSeedRef = useRef("");
  const generationJobAlertScopeRef = useRef("");
  const surfacedGenerationJobFailureIdsRef = useRef<Set<string>>(new Set());
  const surfacedGenerationJobCompletionIdsRef = useRef<Set<string>>(new Set());
  const defaultTestCaseStatus = domainMetadataQuery.data?.test_cases?.default_status || "active";
  const defaultTestCaseAutomated = "no" as const;
  const testCaseStatusOptions = domainMetadataQuery.data?.test_cases?.statuses || [];
  const dataSetModeOptions = domainMetadataQuery.data?.test_data_sets?.modes?.length
    ? domainMetadataQuery.data.test_data_sets.modes
    : [
        { value: "table", label: "Table" },
        { value: "key_value", label: "Key/value" }
      ];
  const defaultDataSetMode = (domainMetadataQuery.data?.test_data_sets?.default_mode || "table") as TestDataSet["mode"];
  const emptyDataSetDraft = useMemo(() => buildEmptyDataSetDraft(defaultDataSetMode), [defaultDataSetMode]);
  const defaultTestCaseType = getDomainDefault(domainMetadataQuery.data, "test_cases.types", "functional");
  const emptyCaseDraft = useMemo(
    () => createEmptyCaseDraft(defaultTestCaseStatus, defaultTestCaseAutomated, session?.user.id || "", defaultTestCaseType),
    [defaultTestCaseAutomated, defaultTestCaseStatus, defaultTestCaseType, session?.user.id]
  );
  const [caseDraft, setCaseDraft] = useState<TestCaseDraft>(() => createEmptyCaseDraft("active", "no", session?.user.id || ""));
  const testCaseTypeOptions = getDomainOptions(domainMetadataQuery.data, "test_cases.types", TEST_CASE_TYPE_OPTIONS, [caseDraft.test_case_type]);
  const [newStepDraft, setNewStepDraft] = useState<StepDraft>(EMPTY_STEP_DRAFT);
  const [stepInsertIndex, setStepInsertIndex] = useState<number | null>(null);
  const [stepInsertGroupContext, setStepInsertGroupContext] = useState<StepInsertionGroupContext | null>(null);
  const [draftSteps, setDraftSteps] = useState<DraftTestStep[]>([]);
  const [selectedStepIds, setSelectedStepIds] = useState<string[]>([]);
  const [isCaseParameterDialogOpen, setIsCaseParameterDialogOpen] = useState(false);
  const [hasParameterScopeDraft, setHasParameterScopeDraft] = useState(false);
  const [linkedDataSetDraftIds, setLinkedDataSetDraftIds] = useState<string[]>([]);
  const [overrideSharedGroupData, setOverrideSharedGroupData] = useState(false);
  const [dataSetSearch, setDataSetSearch] = useState("");
  const [dataSetLinkDraftId, setDataSetLinkDraftId] = useState("");
  const [isDataSetLinkerOpen, setIsDataSetLinkerOpen] = useState(false);
  const [isDataSetCreatorOpen, setIsDataSetCreatorOpen] = useState(false);
  const [newDataSetDraft, setNewDataSetDraft] = useState<DataSetDraft>(() => buildEmptyDataSetDraft());
  const [testCaseParameterValues, setTestCaseParameterValues] = useState<Record<string, string>>({});
  const [privateCaseParameterDraft, setPrivateCaseParameterDraft] = useState<{ scope: string; names: string[] }>({ scope: "", names: [] });
  const caseParameterOverrideDraftRef = useRef<{ scope: string; names: Set<string> }>({ scope: "", names: new Set() });
  const pendingCaseParameterSaveRef = useRef<{ id: string; promise: ReturnType<typeof api.testCases.update> } | null>(null);
  const caseParameterAutosaveTimeoutRef = useRef<number | null>(null);
  const openingLinkedAutomationRef = useRef(false);
  const [isOpeningLinkedAutomation, setIsOpeningLinkedAutomation] = useState(false);
  const [suiteParameterValues, setSuiteParameterValues] = useState<Record<string, string>>({});
  const [runPreviewParameterValues, setRunPreviewParameterValues] = useState<Record<string, string>>({});
  const [parameterPreviewRevision, setParameterPreviewRevision] = useState(0);
  const parameterPreviewCacheRef = useRef<Map<string, string>>(new Map());
  const [selectedParameterSuiteId, setSelectedParameterSuiteId] = useState("");
  const [copiedSteps, setCopiedSteps] = useState<CopiedTestStep[]>([]);
  const [copiedStepContext, setCopiedStepContext] = useState<StepInsertionGroupContext | null>(null);
  const [copiedStepMode, setCopiedStepMode] = useState<"copy" | "cut">("copy");
  const [cutStepSource, setCutStepSource] = useState<CutStepSource | null>(null);
  const [expandedStepIds, setExpandedStepIds] = useState<string[]>([]);
  const [expandedStepGroupIds, setExpandedStepGroupIds] = useState<string[]>([]);
  const [stepDrafts, setStepDrafts] = useState<Record<string, StepDraft>>({});
  const [isStepGroupModalOpen, setIsStepGroupModalOpen] = useState(false);
  const [stepGroupName, setStepGroupName] = useState("");
  const [saveAsReusableGroup, setSaveAsReusableGroup] = useState(false);
  const [isSharedGroupPickerOpen, setIsSharedGroupPickerOpen] = useState(false);
  const [isInsertingSharedGroups, setIsInsertingSharedGroups] = useState(false);
  const [selectedSharedGroupIds, setSelectedSharedGroupIds] = useState<string[]>([]);
  const [sharedGroupSearchTerm, setSharedGroupSearchTerm] = useState("");
  const [isSavingSuiteLinks, setIsSavingSuiteLinks] = useState(false);
  const [editingAutomationStepId, setEditingAutomationStepId] = useState("");
  const [rephrasingStepId, setRephrasingStepId] = useState("");
  const [codePreviewState, setCodePreviewState] = useState<{ title: string; subtitle: string; code: string; objectRepository?: AutomationLearningCacheEntry[] } | null>(null);
  const caseSectionRef = useRef<HTMLDivElement | null>(null);
  const suppressCaseSelectionFromUrlRef = useRef(false);
  const [createSuiteContextId, setCreateSuiteContextId] = useState("");
  const [activeBugConversion, setActiveBugConversion] = useState<BugToTestCaseDraft | null>(null);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [importBatches, setImportBatches] = useState<PreparedTestCaseImportBatch[]>([]);
  const [importFileWarnings, setImportFileWarnings] = useState<string[]>([]);
  const [importRequirementId, setImportRequirementId] = useState("");
  const [importSourceSelection, setImportSourceSelection] = useState<TestCaseImportSourceSelection>("auto");
  const [isAiCaseAuthoringOpen, setIsAiCaseAuthoringOpen] = useState(false);
  const [isTestCaseImpactPreviewOpen, setIsTestCaseImpactPreviewOpen] = useState(false);
  const [aiCaseAuthoringRequirementId, setAiCaseAuthoringRequirementId] = useState("");
  const [aiCaseAuthoringAdditionalContext, setAiCaseAuthoringAdditionalContext] = useState("");
  const [aiCaseAuthoringExternalLinksText, setAiCaseAuthoringExternalLinksText] = useState("");
  const [aiCaseAuthoringReferenceImages, setAiCaseAuthoringReferenceImages] = useState<AiDesignImageInput[]>([]);
  const [aiCaseContextFiles, setAiCaseContextFiles] = useState<File[]>([]);
  const [aiContextFiles, setAiContextFiles] = useState<File[]>([]);
  const aiOriginalImagesRef = useRef(new Map<string, File>());
  const pendingDraftEvidenceRef = useRef<string[]>([]);
  const [pendingAiEvidence, setPendingAiEvidence] = useState<Array<{projectId:string;caseId:string;ids:string[]}>>([]);
  const retainAiEvidence = async (caseId:string, ids:string[], scopeProject=projectId) => {
    const outcomes = await Promise.allSettled(ids.map(id=>platformApi.attachments.copy(id,{project_id:scopeProject,entity_type:'test_case',entity_id:caseId})));
    const pending=ids.filter((_,index)=>outcomes[index].status==='rejected');
    setPendingAiEvidence(current=>[...current.filter(item=>item.caseId!==caseId),...(pending.length?[{projectId:scopeProject,caseId,ids:pending}]:[])]);
    return !pending.length;
  };
  const [aiCaseAuthoringPreview, setAiCaseAuthoringPreview] = useState<AiAuthoredTestCasePreview | null>(null);
  const [aiCaseAuthoringMessage, setAiCaseAuthoringMessage] = useState("");
  const [aiCaseAuthoringTone, setAiCaseAuthoringTone] = useState<"success" | "error">("success");
  const [isAiStudioOpen, setIsAiStudioOpen] = useState(false);
  const [aiRequirementIds, setAiRequirementIds] = useState<string[]>([]);
  const [integrationId, setIntegrationId] = useState("");
  const [testCaseAssuranceIntegrationId, setTestCaseAssuranceIntegrationId] = useState("");
  const [testCaseAssurancePromptGuidance, setTestCaseAssurancePromptGuidance] = useState<string | undefined>();
  const [testCaseAssuranceContext, setTestCaseAssuranceContext] = useState("");
  const [testCaseAssuranceContextBusy, setTestCaseAssuranceContextBusy] = useState(false);
  useEffect(() => {
    setTestCaseAssuranceIntegrationId(""); setTestCaseAssurancePromptGuidance(undefined); setTestCaseAssuranceContext("");
  }, [projectId, selectedTestCaseId]);
  const [maxCases, setMaxCases] = useState(AI_DESIGN_DEFAULT_DRAFT_COUNT);
  const parallelRequirementLimit = 1;
  const [aiAdditionalContext, setAiAdditionalContext] = useState("");
  const [aiExternalLinksText, setAiExternalLinksText] = useState("");
  const [aiReferenceImages, setAiReferenceImages] = useState<AiDesignImageInput[]>([]);
  const [aiPreviewCases, setAiPreviewCases] = useState<AiDesignedTestCaseCandidate[]>([]);
  const [aiPreviewMessage, setAiPreviewMessage] = useState("");
  const [aiPreviewTone, setAiPreviewTone] = useState<"success" | "error">("success");
  const [schedulerActionCaseId, setSchedulerActionCaseId] = useState("");
  const [schedulerActionKind, setSchedulerActionKind] = useState<"run" | "run-local" | "run-remote" | "">("");
  const [inspectingStepId, setInspectingStepId] = useState("");

  useEffect(() => {
    if (!canEditAutomationCode) setEditingAutomationStepId("");
    if (!canPreviewAutomationCode) setCodePreviewState(null);
    if (canViewAutomationCode) return;
    setNewStepDraft((current) => ({ ...current, automation_code: "", api_request: null }));
    setDraftSteps((current) => current.map((step) => ({ ...step, automation_code: "", api_request: null })));
    setCopiedSteps((current) => current.map((step) => ({ ...step, automation_code: "", api_request: null })));
    setStepDrafts((current) => Object.fromEntries(
      Object.entries(current).map(([stepId, step]) => [stepId, { ...step, automation_code: "", api_request: null }])
    ));
  }, [canEditAutomationCode, canPreviewAutomationCode, canViewAutomationCode]);

  const projectsQuery = useQuery({
    queryKey: ["projects", "workspace-scopes", JSON.stringify([session?.user.id, session?.user.role, session?.user.role_id, session?.user.status, session?.user.permissions, session?.user.workspace_permissions, session?.user.project_permissions])],
    queryFn: ({ signal }) => api.metadata.workspaceScopes({ signal }),
    select: (data) => data.projects,
    enabled: can("workspace.view")
  });
  const projectMembersQuery = optionalQueryView(useQuery({
    queryKey: ["project-members", projectId],
    queryFn: () => api.projectMembers.list({ project_id: projectId }),
    enabled: (canViewProjectMembers) && Boolean(projectId && session && canViewProjectMembers)
  }), canViewProjectMembers);
  const appTypesQuery = useQuery({
    queryKey: ["app-types", projectId],
    queryFn: () => api.appTypes.list({ project_id: projectId }),
    enabled: (can("app_type.view")) && Boolean(projectId)
  });
  const allAppTypesQuery = useQuery({
    queryKey: ["app-types", "all", projectId],
    queryFn: () => api.appTypes.list({ project_id: projectId }),
    enabled: (can("app_type.view")) && Boolean(session && projectId)
  });
  // These complete selector catalogs are needed only while authoring or planning a run.
  // A normal library visit reads metrics, module headers and a bounded case page.
  const needsAuthoringCatalog = Boolean(selectedTestCaseId || isCreating || isCreateExecutionModalOpen
    || pendingRunBuilder || isAiStudioOpen || isAiCaseAuthoringOpen
    || isImportModalOpen || searchParams.get("create") === "1" || searchParams.get("case"));
  const requirementsQuery = optionalQueryView(useQuery({
    queryKey: ["requirements", projectId],
    queryFn: async () => asArray(await api.requirements.list({ project_id: projectId })),
    enabled: (canViewRequirements) && Boolean(projectId && canViewRequirements && needsAuthoringCatalog),
    staleTime: 120_000
  }), canViewRequirements);
  const deliveryReleasesQuery = optionalQueryView(useQuery({
    queryKey: ["requirement-releases", projectId],
    queryFn: () => api.requirementReleases.list({ project_id: projectId }),
    enabled: (canViewDeliveryScopes) && Boolean(projectId && canViewDeliveryScopes && needsAuthoringCatalog),
    staleTime: 120_000
  }), canViewDeliveryScopes);
  const deliveryIterationsQuery = optionalQueryView(useQuery({
    queryKey: ["requirement-iterations", projectId],
    queryFn: () => api.requirementIterations.list({ project_id: projectId }),
    enabled: (canViewDeliveryScopes) && Boolean(projectId && canViewDeliveryScopes && needsAuthoringCatalog),
    staleTime: 120_000
  }), canViewDeliveryScopes);
  const suitesQuery = optionalQueryView(useQuery({
    queryKey: ["test-case-suites", appTypeId, projectId],
    queryFn: async () => asArray(await api.testSuites.list({ app_type_id: appTypeId })),
    enabled: (can("suite.view")) && Boolean(appTypeId && needsAuthoringCatalog),
    staleTime: 120_000
  }), can("suite.view"));
  const testDataSetsQuery = optionalQueryView(useQuery({
    queryKey: ["test-data-sets", projectId, appTypeId],
    queryFn: () => api.testDataSets.list({ project_id: projectId, app_type_id: appTypeId || undefined }),
    enabled: (canViewTestData) && Boolean(projectId && canViewTestData && needsAuthoringCatalog),
    staleTime: 120_000
  }), canViewTestData);
  const requestedCaseRouteId = searchParams.get("case") || "";
  const reviewSummaryQueryKey = ["test-case-review-summary", reviewUserId, projectId, appTypeId] as const;
  const reviewSummaryQuery = useQuery({
    queryKey: reviewSummaryQueryKey,
    queryFn: ({ signal }) => api.testCases.reviewSummary({ project_id: projectId, app_type_id: appTypeId }, { signal }),
    enabled: can("testcase.view") && Boolean(reviewUserId && projectId && appTypeId),
    staleTime: 15_000,
    refetchInterval: 30_000
  });
  const pendingReviewCount = canUpdateTestCases ? Number(reviewSummaryQuery.data?.pending || 0) : 0;
  const overallPendingReviewCount = Number(reviewSummaryQuery.data?.overall_pending || 0);
  const modulePickerRequirementsQuery = useInfiniteQuery({
    queryKey: ["test-case-module-requirement-picker", projectId],
    queryFn: async ({ pageParam }) => normalizePagedResult<Requirement>(
      await api.requirements.listPage({
        project_id: projectId,
        page_size: 25,
        include_total: false,
        cursor: pageParam,
        projection: "summary"
      })
    ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage, _allPages, _lastPageParam, allPageParams) => {
      const nextCursor = getVerifiedNextPageCursor(lastPage);
      return nextCursor && !allPageParams.includes(nextCursor) ? nextCursor : undefined;
    },
    enabled: (canViewRequirements) && Boolean(projectId && isCreateModuleModalOpen && canViewRequirements),
    staleTime: 30_000
  });
  useEffect(() => {
    testCaseMoveScopeRef.current = `${projectId}:${appTypeId}`;
    selectedActionCaseSnapshotsRef.current.clear();
    setExpandedModuleIds([]);
    setIsUnassignedModuleExpanded(true);
    setModulePageCursorsById({});
    setSelectedActionTestCaseIds([]);
    setSelectedModuleIds([]);
    setDraggingCaseIds([]);
    setIsCreateModuleModalOpen(false);
    setModuleDraftInitialCaseIds([]);
    setModuleAssignmentRetry(null);
    setReviewQueueScope("");
    setIsBulkReviewRejectOpen(false);
    setBulkReviewComment("");
    setReviewSuggestionCaseId("");
    setReviewSuggestionError("");
    setCaseDraft(emptyCaseDraft);
    reviewSuggestionSnapshotRef.current = null;
    setReviewingCaseIds([]);
    setSelectedTestCaseId("");
  }, [appTypeId, projectId, reviewUserId]);
  useEffect(() => {
    const requestedModuleId = searchParams.get("module") || "";
    if (!requestedModuleId || !asArray(testCaseModulesQuery.data).some((module) => module.id === requestedModuleId)) return;
    setExpandedModuleIds((current) => current.includes(requestedModuleId) ? current : [...current, requestedModuleId]);
    setSelectedModuleIds([requestedModuleId]);
  }, [searchParams, testCaseModulesQuery.data]);
  const deepLinkTestCasesQuery = useQuery({
    queryKey: ["global-test-cases", "deep-link", requestedCaseRouteId, projectId, reviewUserId],
    queryFn: () => api.testCases.get(requestedCaseRouteId, { project_id: projectId }),
    enabled: (can("testcase.view")) && Boolean(
      session
      && projectId
      && requestedCaseRouteId
      && !asArray(testCasesQuery.data?.pages).flatMap((page) => asArray(page.items)).some((testCase) => [testCase.id, testCase.display_id].filter(Boolean).includes(requestedCaseRouteId))
    ),
    staleTime: 60_000,
    retry: false
  });
  const selectedTestCaseDetailQuery = useQuery({
    queryKey: [...testCaseDetailQueryKey(projectId, selectedTestCaseId), reviewUserId, canViewExecutionInsights],
    queryFn: () => api.testCases.get(selectedTestCaseId, { project_id: projectId, include_execution: canViewExecutionInsights }),
    enabled: (can("testcase.view")) && Boolean(projectId && selectedTestCaseId),
    initialData: () => {
      const deepLinkedCase = deepLinkTestCasesQuery.data;
      return deepLinkedCase?.id === selectedTestCaseId ? deepLinkedCase : undefined;
    },
    staleTime: TEST_CASE_DETAIL_STALE_TIME_MS
  });
  const automationCaseLinksQuery = optionalQueryView(useQuery({
    queryKey: ["test-cases", "manual-automation-links", projectId, appTypeId, selectedTestCaseId, canViewExecutionInsights],
    queryFn: async ({ signal }) => {
      const linked: TestCase[] = [];
      const seen = new Set<string>();
      let cursor: string | undefined;
      do {
        const page = await api.testCases.listPage({
          project_id: projectId, app_type_id: appTypeId, manual_test_case_id: selectedTestCaseId,
          automated: "yes", projection: "summary", include_execution: canViewExecutionInsights,
          include_total: false, page_size: 100, cursor
        }, { signal });
        linked.push(...page.items);
        if (page.is_last) break;
        if (!page.next_cursor || seen.has(page.next_cursor)) throw new Error("Linked automation cases could not be fully loaded. Retry the lookup.");
        cursor = page.next_cursor;
        seen.add(cursor);
      } while (cursor);
      return linked;
    },
    enabled: (canViewAutomationInsights) && Boolean(appTypeId && selectedTestCaseId && canViewAutomationInsights),
    staleTime: 30_000
  }), canViewAutomationInsights);
  const generationJobsQuery = optionalQueryView(useQuery({
    queryKey: ["ai-test-case-generation-jobs", appTypeId, projectId],
    queryFn: () => api.testCases.listGenerationJobs({ app_type_id: appTypeId }),
    enabled: (canUseTestCaseAi && can("transaction.view")) && Boolean(appTypeId),
    refetchInterval: (query) => (query.state.data as AiTestCaseGenerationJob[] | undefined)
      ?.some((job) => ["queued", "running"].includes(String(job.status).toLowerCase())) ? 5_000 : false
  }), canUseTestCaseAi && can("transaction.view"));
  const executionsQuery = optionalQueryView(useQuery({
    queryKey: ["executions", projectId],
    queryFn: ({ signal }) => api.executions.list({ project_id: projectId }, { signal }),
    enabled: (can("run.view")) && Boolean(projectId && selectedTestCaseId),
    refetchInterval: (query) => (query.state.data as Execution[] | undefined)
      ?.some((execution) => ["queued", "running"].includes(String(execution.status).toLowerCase()))
      ? TEST_CASE_RUN_POLL_INTERVAL_MS
      : false
  }), can("run.view"));
  const sharedStepGroupsQuery = optionalQueryView(useQuery({
    queryKey: ["shared-step-groups", appTypeId, projectId],
    queryFn: () => api.sharedStepGroups.list({ app_type_id: appTypeId }),
    enabled: (can("shared_step.view")) && Boolean(appTypeId && (selectedTestCaseId || isCreating || isSharedGroupPickerOpen)),
    staleTime: 30_000
  }), can("shared_step.view"));
  const selectedTestCaseResultsQuery = optionalQueryView(useQuery({
    queryKey: ["test-case-assurance-results", appTypeId, projectId, selectedTestCaseId],
    queryFn: () => api.executionResults.list({
      project_id: projectId,
      app_type_id: appTypeId,
      test_case_id: selectedTestCaseId,
      run_limit: 25
    }),
    enabled: (canViewExecutionInsights) && Boolean(appTypeId && selectedTestCaseId && canViewExecutionInsights),
    staleTime: 30_000,
    refetchInterval: (query) => (query.state.data as ExecutionResult[] | undefined)
      ?.some((result) => String(result.status).toLowerCase() === "running")
      ? TEST_CASE_RUN_POLL_INTERVAL_MS
      : false
  }), canViewExecutionInsights);
  const integrationsQuery = optionalQueryView(useQuery({
    queryKey: ["integrations", "llm", projectId],
    queryFn: () => api.integrations.list({ type: "llm", is_active: true }),
    enabled: can("integration.view") && (canUseTestCaseAi || canUseAutomationAi)
  }), can("integration.view") && (canUseTestCaseAi || canUseAutomationAi));
  const testEngineIntegrationsQuery = optionalQueryView(useQuery({
    queryKey: ["integrations", "testengine", projectId],
    queryFn: () => api.integrations.list({ type: "testengine", is_active: true }),
    enabled: (can("integration.view") && (canRunLocalAutomation || canRunRemoteAutomation)) && Boolean(projectId && session)
  }), can("integration.view") && (canRunLocalAutomation || canRunRemoteAutomation));
  const automationLearningCacheQuery = optionalQueryView(useQuery({
    queryKey: ["automation-learning-cache", projectId, appTypeId],
    queryFn: () => api.testCases.learningCache({
      project_id: projectId || undefined,
      app_type_id: appTypeId || undefined,
      limit: 12
    }),
    enabled: (can("automation.view")) && Boolean(canUseAutomationWorkspace && (projectId || appTypeId) && session)
  }), can("automation.view"));
  const stepsQuery = useQuery({
    queryKey: ["test-case-steps", selectedTestCaseId, projectId],
    queryFn: () => api.testSteps.list({ test_case_id: selectedTestCaseId }),
    enabled: (can("testcase.view")) && Boolean(selectedTestCaseId)
  });

  const createTestCase = useMutation({ mutationFn: api.testCases.create });
  const createTestDataSet = useMutation({ mutationFn: api.testDataSets.create });
  const createTestCaseModule = useMutation({ mutationFn: api.testCaseModules.create });
  const updateTestCaseModule = useMutation({
    mutationFn: ({ id, input }: { id: string; input: Parameters<typeof api.testCaseModules.update>[1] }) =>
      api.testCaseModules.update(id, input)
  });
  const assignCasesToModule = useMutation({
    mutationFn: ({ id, testCaseIds, append }: { id: string; testCaseIds: string[]; append?: boolean }) =>
      api.testCaseModules.assignCases(id, testCaseIds, append ?? true)
  });
  const removeCasesFromModule = useMutation({
    mutationFn: ({ id, testCaseIds }: { id: string; testCaseIds: string[] }) =>
      api.testCaseModules.removeCases(id, testCaseIds)
  });
  const deleteTestCaseModule = useMutation({ mutationFn: api.testCaseModules.delete });
  const reviewTestCase = useMutation({
    mutationFn: ({ id, input }: { id: string; input: Parameters<typeof api.testCases.review>[1] }) =>
      api.testCases.review(id, input)
  });
  const createGenerationJob = useMutation({ mutationFn: api.testCases.createGenerationJob });
  const createSuite = useMutation({ mutationFn: api.testSuites.create });
  const updateSuite = useMutation({
    mutationFn: ({ id, input }: { id: string; input: Parameters<typeof api.testSuites.update>[1] }) =>
      api.testSuites.update(id, input)
  });
  const assignSuiteCases = useMutation({
    mutationFn: ({ id, testCaseIds }: { id: string; testCaseIds: string[] }) => api.testSuites.assignTestCases(id, testCaseIds)
  });
  const createExecution = useMutation({ mutationFn: api.executions.create });
  const createLocalRun = useMutation({ mutationFn: api.executions.createLocalRun });
  const startExecution = useMutation({ mutationFn: (id: string) => api.executions.start(id) });
  const updateTestCase = useMutation({
    mutationFn: ({ id, input }: { id: string; input: Parameters<typeof api.testCases.update>[1] }) =>
      api.testCases.update(id, input)
  });
  const persistCaseParameterValues = useMutation({
    mutationFn: ({ id, parameter_values, test_data_options, test_data_set_ids, expected_revision }: { id: string; parameter_values: Record<string, string>; test_data_options?: TestCase["test_data_options"]; test_data_set_ids?: string[]; expected_revision?: number }) =>
      api.testCases.update(id, { parameter_values, ...(test_data_options ? { test_data_options } : {}), ...(test_data_set_ids ? { test_data_set_ids } : {}), expected_revision })
  });
  const deleteTestCase = useMutation({ mutationFn: api.testCases.delete });
  const importTestCases = useMutation({ mutationFn: api.testCases.bulkImport });
  const aiCaseAuthoringControllerRef = useRef<AbortController | null>(null);
  const aiDesignControllerRef = useRef<AbortController | null>(null);
  useEffect(() => () => {
    aiCaseAuthoringControllerRef.current?.abort();
    aiDesignControllerRef.current?.abort();
  }, [projectId, appTypeId]);
  const previewCaseAuthoring = useMutation({
    mutationFn: ({ input, signal }: { input: Parameters<typeof api.testCases.previewCaseAuthoring>[0]; signal: AbortSignal }) => api.testCases.previewCaseAuthoring(input, { signal })
  });
  const previewTestCaseImpact = useMutation({
    mutationFn: ({ testCaseId, input }: { testCaseId: string; input: Parameters<typeof api.testCases.previewImpact>[1] }) =>
      api.testCases.previewImpact(testCaseId, input)
  });
  const previewTestCaseChangeImpact = useMutation({
    mutationFn: ({ testCaseId, input }: { testCaseId: string; input: Parameters<typeof api.testCases.previewImpact>[1] }) =>
      api.testCases.previewImpact(testCaseId, input)
  });
  const rephraseStepWithAi = useMutation({ mutationFn: api.testCases.rephraseStep });
  const previewDesignedCases = useMutation({
    mutationFn: ({ input, signal }: { input: Parameters<typeof api.testCases.previewDesignedCases>[0]; signal: AbortSignal }) => api.testCases.previewDesignedCases(input, { signal })
  });
  const acceptDesignedCases = useMutation({ mutationFn: api.testCases.acceptDesignedCases });
  const buildSingleAutomation = useMutation({
    mutationFn: async ({ testCaseId }: { testCaseId: string }) => {
      const context = {
        test_environment_id: can("environment.view") ? selectedExecutionEnvironmentId || undefined : undefined,
        test_configuration_id: can("configuration.view") ? selectedExecutionConfigurationId || undefined : undefined,
        test_data_set_id: can("data.view") ? selectedExecutionDataSetId || undefined : undefined
      };
      const reviewed = await reviewBuildParameters([testCaseId], context, selectedTestCase ? { [selectedTestCase.id]: selectedTestCase.title } : {});
      if (!reviewed) return null;
      return api.testCases.queueAutomationGenerator(testCaseId, {
        parameter_values: reviewed.parameter_values_by_case[testCaseId],
        parameter_plan_key: reviewed.parameter_plan_keys_by_case[testCaseId],
        integration_id: integrationId || undefined,
        start_url: automationStartUrl.trim() || undefined,
        additional_context: automationContext.trim() || undefined,
        test_environment_id: can("environment.view") ? selectedExecutionEnvironmentId || undefined : undefined,
        test_configuration_id: can("configuration.view") ? selectedExecutionConfigurationId || undefined : undefined,
        test_data_set_id: can("data.view") ? selectedExecutionDataSetId || undefined : undefined
      });
    }
  });
  const buildBatchAutomation = useMutation({
    mutationFn: async ({ testCaseIds, aiRequested = false }: { testCaseIds: string[]; aiRequested?: boolean }) => {
      const context = {
        test_environment_id: can("environment.view") ? selectedExecutionEnvironmentId || undefined : undefined,
        test_configuration_id: can("configuration.view") ? selectedExecutionConfigurationId || undefined : undefined,
        test_data_set_id: can("data.view") ? selectedExecutionDataSetId || undefined : undefined
      };
      const reviewed = await reviewBuildParameters([...testCaseIds], context);
      if (!reviewed) return null;
      return api.testCases.buildAutomationBatch({
        ...reviewed,
        app_type_id: appTypeId,
        test_case_ids: testCaseIds,
        integration_id: integrationId || undefined,
        start_url: automationStartUrl.trim() || undefined,
        additional_context: automationContext.trim() || undefined,
        test_environment_id: can("environment.view") ? selectedExecutionEnvironmentId || undefined : undefined,
        test_configuration_id: can("configuration.view") ? selectedExecutionConfigurationId || undefined : undefined,
        test_data_set_id: can("data.view") ? selectedExecutionDataSetId || undefined : undefined,
        failure_threshold: automationFailureThreshold,
        ai_requested: aiRequested
      });
    }
  });
  const startRecorder = useMutation({
    mutationFn: ({ testCaseId, options, targetStepId }: { testCaseId: string; options: RecorderStartOptions; targetStepId?: string }) =>
      api.testCases.startRecorderSession(testCaseId, {
        start_url: automationStartUrl.trim() || undefined,
        recorder_mode: options.recorder_mode,
        recorder_target: options.recorder_target,
        engine_base_url: options.engine_base_url,
        recorder_public_base_url: options.recorder_public_base_url,
        reuse_existing: options.recorder_mode === "local" && options.recorder_target === "web",
        test_environment_id: can("environment.view") ? selectedExecutionEnvironmentId || undefined : undefined,
        test_configuration_id: can("configuration.view") ? selectedExecutionConfigurationId || undefined : undefined,
        test_data_set_id: can("data.view") ? selectedExecutionDataSetId || undefined : undefined,
        target_step_id: targetStepId || undefined
      })
  });
  const finishRecorder = useMutation({
    mutationFn: ({ testCaseId, sessionId, transactionId, recorderStartOptions, targetStepId }: { testCaseId: string; sessionId: string; transactionId?: string; recorderStartOptions?: RecorderStartOptions | null; targetStepId?: string }) =>
      api.testCases.finishRecorderSession(testCaseId, sessionId, {
        transaction_id: transactionId,
        integration_id: integrationId || undefined,
        additional_context: automationContext.trim() || undefined,
        recorder_mode: recorderStartOptions?.recorder_mode,
        recorder_target: recorderStartOptions?.recorder_target,
        engine_base_url: recorderStartOptions?.engine_base_url,
        test_environment_id: can("environment.view") ? selectedExecutionEnvironmentId || undefined : undefined,
        test_configuration_id: can("configuration.view") ? selectedExecutionConfigurationId || undefined : undefined,
        test_data_set_id: can("data.view") ? selectedExecutionDataSetId || undefined : undefined,
        target_step_id: targetStepId || undefined
      })
  });
  const createStep = useMutation({ mutationFn: api.testSteps.create });
  const groupSteps = useMutation({ mutationFn: api.testSteps.group });
  const ungroupSteps = useMutation({ mutationFn: api.testSteps.ungroup });
  const insertSharedGroup = useMutation({ mutationFn: api.testSteps.insertSharedGroup });
  const createSharedStepGroup = useMutation({ mutationFn: api.sharedStepGroups.create });
  const updateStep = useMutation({
    mutationFn: ({ id, input }: { id: string; input: Parameters<typeof api.testSteps.update>[1] }) =>
      api.testSteps.update(id, input)
  });
  const reorderSteps = useMutation({
    mutationFn: ({ testCaseId, stepIds }: { testCaseId: string; stepIds: string[] }) =>
      api.testSteps.reorder(testCaseId, stepIds)
  });
  const deleteStep = useMutation({ mutationFn: api.testSteps.delete });

  const projects = asArray(projectsQuery.data);
  const projectMembers = asArray<ProjectMember>(projectMembersQuery.data);
  const users = useMemo<User[]>(() => {
    const members = projectMembers.map((member) => ({
      id: member.user_id,
      name: member.user_name || null,
      email: member.user_email || ""
    }));
    if (session?.user.id && !members.some((user) => user.id === session.user.id)) {
      members.push({ id: session.user.id, name: session.user.name || null, email: session.user.email || "" });
    }
    return members;
  }, [projectMembers, session?.user.email, session?.user.id, session?.user.name]);
  const testEngineIntegrations = asArray(testEngineIntegrationsQuery.data);
  const appTypes = asArray(appTypesQuery.data);
  const accessibleProjectIds = useMemo(
    () => new Set(projects.map((project) => String(project.id))),
    [projects]
  );
  const allAppTypes = useMemo(
    () => asArray(allAppTypesQuery.data || appTypes).filter((item) => accessibleProjectIds.has(String(item.project_id))),
    [accessibleProjectIds, allAppTypesQuery.data, appTypes]
  );
  const requirements = asArray(requirementsQuery.data);
  const deliveryReleases = asArray<RequirementRelease>(deliveryReleasesQuery.data);
  const deliveryIterations = asArray<RequirementIteration>(deliveryIterationsQuery.data);
  const deliveryScopeCatalog = useMemo(() => ({
    releases: deliveryReleases,
    iterations: deliveryIterations,
    jiraVersions: domainMetadataQuery.data?.jira?.versions || [],
    jiraSprints: domainMetadataQuery.data?.jira?.sprints || []
  }), [
    deliveryIterations,
    deliveryReleases,
    domainMetadataQuery.data?.jira?.sprints,
    domainMetadataQuery.data?.jira?.versions
  ]);
  const { releaseOptions: deliveryReleaseOptions, sprintOptions: deliverySprintOptions } = useMemo(
    () => buildDeliveryScopeOptions({
      ...deliveryScopeCatalog,
      currentRelease: isCreating ? caseDeliveryRelease : executionRelease,
      currentSprint: isCreating ? caseDeliverySprint : executionSprint
    }),
    [caseDeliveryRelease, caseDeliverySprint, deliveryScopeCatalog, executionRelease, executionSprint, isCreating]
  );
  const requirementDeliveryScopeById = useMemo(() => {
    const result = new Map<string, { release: string; sprint: string }>();
    const iterationByReference = new Map<string, RequirementIteration>();

    deliveryIterations.forEach((iteration) => {
      [iteration.id, iteration.jira_sprint_id, iteration.jira_sprint_name, iteration.name]
        .filter(Boolean)
        .forEach((value) => iterationByReference.set(normalizeDeliveryScopeValue(value), iteration));
    });

    requirements.forEach((requirement: Requirement) => {
      const linkedIteration = [requirement.iteration_id, requirement.sprint_id, requirement.sprint]
        .map((value) => iterationByReference.get(normalizeDeliveryScopeValue(value)))
        .find(Boolean)
        || deliveryIterations.find((iteration) => iteration.requirement_ids?.includes(requirement.id));
      const sprint = String(
        linkedIteration?.jira_sprint_name
        || linkedIteration?.name
        || requirement.sprint
        || ""
      ).trim();
      const linkedRelease = deliveryReleases.find((release) => {
        if (release.requirement_ids?.includes(requirement.id)) return true;
        if (!linkedIteration) return false;
        return release.sprint_ids?.some((sprintId) => [
          linkedIteration.id,
          linkedIteration.jira_sprint_id,
          linkedIteration.jira_sprint_name,
          linkedIteration.name
        ].some((value) => normalizeDeliveryScopeValue(value) === normalizeDeliveryScopeValue(sprintId)));
      });
      const release = String(
        requirement.fix_version
        || linkedRelease?.fix_version
        || linkedRelease?.name
        || requirement.release
        || ""
      ).trim();

      result.set(requirement.id, { release, sprint });
    });

    return result;
  }, [deliveryIterations, deliveryReleases, requirements]);
  const creationRequirementOptions = useMemo(() => requirements.filter((requirement: Requirement) => {
    const scope = requirementDeliveryScopeById.get(requirement.id);
    const releaseMatches = !caseDeliveryRelease
      || normalizeDeliveryScopeValue(scope?.release) === normalizeDeliveryScopeValue(caseDeliveryRelease);
    const sprintMatches = !caseDeliverySprint
      || normalizeDeliveryScopeValue(scope?.sprint) === normalizeDeliveryScopeValue(caseDeliverySprint);
    return releaseMatches && sprintMatches;
  }), [caseDeliveryRelease, caseDeliverySprint, requirementDeliveryScopeById, requirements]);
  const visibleCreationRequirementOptions = useMemo(() => {
    if (!caseDraft.requirement_id || creationRequirementOptions.some((item: Requirement) => item.id === caseDraft.requirement_id)) {
      return creationRequirementOptions;
    }
    const selectedRequirement = requirements.find((item: Requirement) => item.id === caseDraft.requirement_id);
    return selectedRequirement ? [selectedRequirement, ...creationRequirementOptions] : creationRequirementOptions;
  }, [caseDraft.requirement_id, creationRequirementOptions, requirements]);
  const linkedRequirementTitle = requirements.find((requirement) => requirement.id === caseDraft.requirement_id)?.title || "";
  const caseGherkinFeatureTitle = linkedRequirementTitle || caseDraft.title;
  useEffect(() => {
    if (!linkedRequirementTitle || !caseDraft.gherkin_document.trim()) return;
    setCaseDraft((current) => {
      const gherkin_document = setGherkinFeatureTitle(current.gherkin_document, linkedRequirementTitle);
      return gherkin_document === current.gherkin_document ? current : { ...current, gherkin_document };
    });
  }, [linkedRequirementTitle, caseDraft.gherkin_document]);
  const suites = asArray(suitesQuery.data);
  const testDataSets = asArray<TestDataSet>(testDataSetsQuery.data);
  const testCases = useMemo(() => {
    const byId = new Map<string, TestCase>();
    for (const testCase of asArray(testCasesQuery.data?.pages).flatMap((page) => asArray(page.items))) byId.set(testCase.id, testCase);
    if (isReviewQueueOpen) {
      return [...byId.values()].filter((testCase) => (!workflowReviewScope || workflowReviewScope.ids.includes(testCase.id)) && ownsCaseReview(testCase, reviewUserId) && isPendingCaseReview(testCase));
    }
    if (workflowReviewScope) return [...byId.values()].filter(testCase => workflowReviewScope.ids.includes(testCase.id) && testCase.automated !== "yes");
    for (const query of moduleCaseQueries) {
      for (const testCase of query.data?.items || []) byId.set(testCase.id, testCase);
    }
    if (deepLinkTestCasesQuery.data) byId.set(deepLinkTestCasesQuery.data.id, deepLinkTestCasesQuery.data);
    if (selectedTestCaseDetailQuery.data) byId.set(selectedTestCaseDetailQuery.data.id, selectedTestCaseDetailQuery.data);
    return [...byId.values()].filter((testCase) => libraryScope === "both" || (libraryScope === "automation" ? testCase.automated === "yes" : testCase.automated !== "yes"));
  }, [deepLinkTestCasesQuery.data, workflowReviewScope, isReviewQueueOpen, moduleCaseQueries, reviewUserId, selectedTestCaseDetailQuery.data, testCasesQuery.data, libraryScope]);
  useEffect(() => {
    const selectedIds = new Set(selectedActionTestCaseIds);
    testCases.forEach((testCase) => {
      if (selectedIds.has(testCase.id)) selectedActionCaseSnapshotsRef.current.set(testCase.id, testCase);
    });
    selectedActionCaseSnapshotsRef.current.forEach((_testCase, testCaseId) => {
      if (!selectedIds.has(testCaseId)) selectedActionCaseSnapshotsRef.current.delete(testCaseId);
    });
  }, [selectedActionTestCaseIds, testCases]);
  const deepLinkTestCases = useMemo(
    () => deepLinkTestCasesQuery.data ? [deepLinkTestCasesQuery.data] : [],
    [deepLinkTestCasesQuery.data]
  );
  const generationJobs = asArray(generationJobsQuery.data);
  const executions = asArray(executionsQuery.data);
  const sharedStepGroups = asArray(sharedStepGroupsQuery.data);
  const executionResults = useMemo(() => canViewExecutionInsights ? testCases.flatMap((testCase) => (testCase as TestCaseCatalogRow).recent_results || []) : [], [testCases, canViewExecutionInsights]);
  const integrations = useMemo(
    () => asArray(integrationsQuery.data).filter((integration) => !isRovoIntegrationId(integration.id)),
    [integrationsQuery.data]
  );

  const testCaseAssuranceDefaultIntegrationId = useAiLlmDefault({ usageKey: "ai.quality.test_case_assurance", projectId, integrations: can("integration.view") ? integrations : undefined });
  const testCaseImpactDefaultIntegrationId = useAiLlmDefault({ usageKey: "ai.test_case.change_impact", projectId, integrations: can("integration.view") ? integrations : undefined });
  const supportsLocalDesktopExecution = Boolean(session && canRunLocalAutomation);
  const userById = useMemo(
    () =>
      users.reduce<Record<string, User>>((accumulator, user) => {
        accumulator[user.id] = user;
        return accumulator;
      }, {}),
    [users]
  );
  const assigneeOptions = useMemo<TestCaseExecutionAssigneeOption[]>(
    () => buildAssigneeOptions(projectMembers, users),
    [projectMembers, users]
  );
  const steps = useMemo(
    () => ((stepsQuery.data || []) as TestStep[]).slice().sort((left, right) => left.step_order - right.step_order),
    [stepsQuery.data]
  );
  const [isVisualBuilderActive, setIsVisualBuilderActive] = useState(false);
  useEffect(() => setIsVisualBuilderActive(false), [isCreating, selectedTestCaseId]);

  const displaySteps = useMemo(
    () =>
      isCreating
        ? draftSteps.map((step, index) => ({
            id: step.id,
            test_case_id: selectedTestCaseId || "draft",
            step_order: index + 1,
            action: step.action,
            expected_result: step.expected_result,
            step_type: step.step_type,
            automation_code: step.automation_code,
            api_request: step.api_request,
            group_id: step.group_id,
            group_name: step.group_name,
            group_kind: step.group_kind,
            reusable_group_id: step.reusable_group_id
          }))
        : steps,
    [draftSteps, isCreating, selectedTestCaseId, steps]
  );
  const preconditionSteps = useMemo(
    () => displaySteps.filter((step) => (step.group_name || "").toLowerCase() === "preconditions"),
    [displaySteps]
  );
  const mainSteps = useMemo(
    () => displaySteps.filter((step) => (step.group_name || "").toLowerCase() !== "preconditions"),
    [displaySteps]
  );

  const showSuccess = (text: string) => {
    setMessageTone("success");
    setMessage(text);
  };

  const showError = (error: unknown, fallback: string) => {
    setMessageTone("error");
    setMessage(error instanceof Error ? error.message : fallback);
  };

  function syncTestCaseSearchParams(nextCaseId?: string | null) {
    const currentCaseId = searchParams.get("case") || "";
    const targetCaseId = nextCaseId || "";

    if (currentCaseId === targetCaseId) {
      if (!targetCaseId) {
        suppressCaseSelectionFromUrlRef.current = false;
      }
      return;
    }

    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      if (targetCaseId) {
        next.set("case", targetCaseId);
      } else {
        next.delete("case");
        suppressCaseSelectionFromUrlRef.current = true;
      }
      return next;
    }, { replace: true });
  }

  const openTestCaseWorkspace = (testCaseId: string) => {
    const targetTestCase = testCases.find((item) => item.id === testCaseId) || null;

    syncTestCaseSearchParams(getRoutableId(targetTestCase) || testCaseId);
    setSelectedTestCaseId(testCaseId);
  };

  const resetExecutionContextSelection = () => {
    setSelectedExecutionEnvironmentId("");
    setSelectedExecutionConfigurationId("");
    setSelectedExecutionDataSetId("");
    setSelectedExecutionDataOptions({});
  };

  const closeCreateExecutionModal = () => {
    setIsCreateExecutionModalOpen(false);
    setPendingRunBuilder(null);
    setExecutionName("");
    setExecutionStartDate("");
    setExecutionEndDate("");
    setSelectedExecutionAssigneeIds([]);
    setExecutionRelease("");
    setExecutionSprint("");
    setExecutionBuild("");
    setExecutionStartMode("manual");
    setExecutionParallelEnabled(false);
    setExecutionParallelCount(1);
    resetExecutionContextSelection();
  };

	  const beginCreateCase = (
    suiteContextId = "",
    requirementId = "",
    deliveryContext: TestCaseDeliveryContext = {},
    moduleId = ""
  ) => {
	    if (!canCreateTestCases) {
	      showError(new Error("Permission required: testcase.create"), "Unable to create test case");
	      return;
	    }

	    syncTestCaseSearchParams(null);
	    setCreateSuiteContextId(suiteContextId);
    setActiveBugConversion(null);
    pendingDraftEvidenceRef.current=[];
    const requirementScope = requirementDeliveryScopeById.get(requirementId);
    setCaseDeliveryRelease(deliveryContext.release || requirementScope?.release || "");
    setCaseDeliverySprint(deliveryContext.sprint || requirementScope?.sprint || "");
    setIsCreating(true);
    setSelectedTestCaseId("");
    setCaseDraft({
      ...emptyCaseDraft,
      requirement_id: requirementId,
      module_id: moduleId
    });
    setDraftSteps([]);
    setNewStepDraft(EMPTY_STEP_DRAFT);
    setStepInsertIndex(null);
    setStepInsertGroupContext(null);
    setSelectedStepIds([]);
    setLinkedDataSetDraftIds([]);
    setOverrideSharedGroupData(false);
    setDataSetSearch("");
    setIsDataSetCreatorOpen(false);
    setExpandedStepIds([]);
    setExpandedStepGroupIds([]);
  };

  useEffect(() => {
    if (!isCreating) return;
    const frame = requestAnimationFrame(() => caseSectionRef.current?.querySelector<HTMLInputElement>("[data-autofocus=true]")?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(frame);
  }, [isCreating]);

  const updateCaseDeliveryScope = (release: string, sprint: string) => {
    setCaseDeliveryRelease(release);
    setCaseDeliverySprint(sprint);
    setCaseDraft((current) => {
      if (!current.requirement_id) return current;
      const scope = requirementDeliveryScopeById.get(current.requirement_id);
      const releaseMatches = !release
        || normalizeDeliveryScopeValue(scope?.release) === normalizeDeliveryScopeValue(release);
      const sprintMatches = !sprint
        || normalizeDeliveryScopeValue(scope?.sprint) === normalizeDeliveryScopeValue(sprint);
      return releaseMatches && sprintMatches ? current : { ...current, requirement_id: "" };
    });
  };

  const updateCaseRequirement = (requirementId: string) => {
    setCaseDraft((current) => ({ ...current, requirement_id: requirementId }));
    if (!requirementId) return;
    const scope = requirementDeliveryScopeById.get(requirementId);
    setCaseDeliveryRelease(scope?.release || "");
    setCaseDeliverySprint(scope?.sprint || "");
  };

  useEffect(() => {
    if (appTypesQuery.isPending) {
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
      return;
    }

    if (!scopedAppTypes.some((item) => item.id === appTypeId)) {
      setAppTypeId(scopedAppTypes[0].id);
    }
  }, [appTypeId, appTypes, appTypesQuery.isPending, projectId, setAppTypeId]);

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
    const requestedProjectId = searchParams.get("project");

    if (!requestedProjectId || projectsQuery.isPending) {
      return;
    }

    if (projects.some((project) => String(project.id) === requestedProjectId) && requestedProjectId !== projectId) {
      setProjectId(requestedProjectId);
    }

    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      next.delete("project");
      return next;
    }, { replace: true });
  }, [projectId, projects, projectsQuery.isPending, searchParams, setProjectId, setSearchParams]);

  useEffect(() => {
    const requestedAppTypeId = searchParams.get("appType");

    if (!requestedAppTypeId || appTypesQuery.isPending) {
      return;
    }

    if (appTypes.some((appType) => appType.id === requestedAppTypeId)) {
      if (requestedAppTypeId !== appTypeId) {
        setAppTypeId(requestedAppTypeId);
      }
    }

    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      next.delete("appType");
      return next;
    }, { replace: true });
  }, [appTypeId, appTypes, appTypesQuery.isPending, searchParams, setAppTypeId, setSearchParams]);

  useEffect(() => {
    if (!searchParams.get("case")) {
      syncTestCaseSearchParams(null);
    }
    setCreateSuiteContextId("");
    setActiveBugConversion(null);
    setSelectedTestCaseId("");
    setIsCreating(false);
    setIsImportModalOpen(false);
    setImportBatches([]);
    setImportFileWarnings([]);
    setImportSourceSelection("auto");
    setIsAiCaseAuthoringOpen(false);
    setAiCaseAuthoringRequirementId("");
    setAiCaseAuthoringAdditionalContext("");
    setAiCaseAuthoringPreview(null);
    setAiCaseAuthoringMessage("");
    setIsCreateSuiteModalOpen(false);
    setIsCreateExecutionModalOpen(false);
    setExecutionName("");
    setSelectedExecutionAssigneeIds([]);
    setExecutionRelease("");
    setExecutionSprint("");
    setCaseDeliveryRelease("");
    setCaseDeliverySprint("");
    setExecutionBuild("");
    resetExecutionContextSelection();
    setAutomationStartUrl("");
    setAutomationContext("");
    setAutomationFailureThreshold(3);
    setRecorderSession(null);
    setRecorderSessionCaseId("");
    setInspectingStepId("");
    setCaseDraft(emptyCaseDraft);
    setNewStepDraft(EMPTY_STEP_DRAFT);
    setStepInsertIndex(null);
    setStepInsertGroupContext(null);
    setDraftSteps([]);
    setSelectedStepIds([]);
    setCopiedSteps([]);
    setCopiedStepContext(null);
    setCopiedStepMode("copy");
    setCutStepSource(null);
    setExpandedStepIds([]);
    setExpandedStepGroupIds([]);
    setIsStepGroupModalOpen(false);
    setStepGroupName("");
    setSaveAsReusableGroup(false);
    setIsSharedGroupPickerOpen(false);
    setSelectedSharedGroupIds([]);
    setSharedGroupSearchTerm("");
    setSelectedActionTestCaseIds([]);
    setImportRequirementId("");
    setIsAiStudioOpen(false);
    setAiRequirementIds([]);
    setAiPreviewCases([]);
    setAiPreviewMessage("");
    setSchedulerActionCaseId("");
    setSchedulerActionKind("");
    setRephrasingStepId("");
  }, [appTypeId]);

  useEffect(() => {
    if (searchParams.get("create") !== "1") {
      initializingCreateLinkScopeRef.current = "";
      return;
    }

    // Do not consume a deep-linked draft while session and project access are still resolving.
    if (isCapabilityLoading || isCreating || selectedTestCaseId || !appTypeId) {
      return;
    }

    const requestedReleaseId = searchParams.get("release_id") || "";
    const requestedSprintId = searchParams.get("sprint_id") || "";
    const requestedRequirementId = searchParams.get("requirement") || "";
    if (
      (canViewRequirements && requestedRequirementId && requirementsQuery.isPending)
      || (canViewDeliveryScopes && (
        (requestedReleaseId && deliveryReleasesQuery.isPending)
        || (requestedSprintId && deliveryIterationsQuery.isPending)
        || (requestedRequirementId && (deliveryReleasesQuery.isPending || deliveryIterationsQuery.isPending))
      ))
    ) {
      return;
    }

    // Query results can rerender the page before both the draft state and
    // navigation cleanup commit. Initialize this incoming link only once.
    const createScope = `${projectId}:${appTypeId}:${reviewUserId}`;
    if (initializingCreateLinkScopeRef.current === createScope) return;
    initializingCreateLinkScopeRef.current = createScope;

    const requestedSuiteId = searchParams.get("suite") || "";
    let bugDraft: BugToTestCaseDraft | null = null;
    if (searchParams.get("source") === "bug") {
      bugDraft = parseStoredBugToTestCaseDraft(sessionStorage.getItem(BUG_TO_TEST_CASE_STORAGE_KEY));
      sessionStorage.removeItem(BUG_TO_TEST_CASE_STORAGE_KEY);
    }
    const deliveryPrefill = resolveDeliveryScopePrefill({
      releaseId: requestedReleaseId,
      releaseToken: searchParams.get("release"),
      sprintId: requestedSprintId,
      sprintToken: searchParams.get("sprint")
    }, deliveryScopeCatalog);
    const primaryRequirementId = bugDraft?.requirementIds[0] || requestedRequirementId;
    const primaryModuleId = bugDraft?.moduleIds[0] || searchParams.get("module") || "";
    const primarySuiteId = bugDraft?.suiteIds[0] || requestedSuiteId;
    beginCreateCase(primarySuiteId, primaryRequirementId, {
      release: bugDraft?.release || deliveryPrefill.release,
      sprint: bugDraft?.sprint || deliveryPrefill.sprint
    }, primaryModuleId);
    if (bugDraft) {
      setActiveBugConversion({
        ...bugDraft,
        requirementIds: bugDraft.requirementIds.filter((id) => id !== primaryRequirementId),
        moduleIds: bugDraft.moduleIds.filter((id) => id !== primaryModuleId),
        suiteIds: bugDraft.suiteIds.filter((id) => id !== primarySuiteId)
      });
      setCaseDraft((current) => ({
        ...current,
        title: bugDraft.title || current.title,
        description: bugDraft.description,
        externalReferencesText: formatReferenceList(bugDraft.externalReferences),
        labelsText: formatReferenceList(bugDraft.labels),
        priority: bugDraft.priority,
        requirement_id: primaryRequirementId,
        module_id: primaryModuleId,
        test_case_type: "regression"
      }));
      const preconditionGroupId = bugDraft.preconditions.length ? createDraftGroupId() : null;
      const convertedSteps: DraftTestStep[] = buildConvertedBugSteps(bugDraft).map((step) => ({
        id: createDraftStepId(),
        action: step.action,
        expected_result: step.expectedResult,
        step_type: "web",
        automation_code: "",
        api_request: null,
        group_id: step.isPrecondition ? preconditionGroupId : null,
        group_name: step.isPrecondition ? "Preconditions" : null,
        group_kind: step.isPrecondition ? "local" : null,
        reusable_group_id: null
      }));
      setDraftSteps(convertedSteps);
      setExpandedStepGroupIds(preconditionGroupId ? [preconditionGroupId] : []);
    }

    const agentProposal = canCreateTestCases ? takeAgentProposal(searchParams.get("agent_proposal"), projectId, appTypeId, "test_case") : null;
    if (agentProposal) {
      setCaseDraft(current => ({ ...current, title: agentProposal.title,
        description: [agentProposal.description, agentProposal.prerequisites?.length ? `Prerequisites:\n${agentProposal.prerequisites.join("\n")}` : "", agentProposal.test_data?.length ? `Test data:\n${agentProposal.test_data.join("\n")}` : "", agentProposal.cleanup?.length ? `Cleanup:\n${agentProposal.cleanup.join("\n")}` : ""].filter(Boolean).join("\n\n"),
        priority: Number(agentProposal.priority.slice(1)) || 3, test_case_type: agentProposal.test_case_type || current.test_case_type,
        authoring_mode: agentProposal.authoring_mode || "structured", gherkin_document: agentProposal.authoring_mode === "gherkin" ? agentProposal.gherkin_document || "" : "",
        requirement_id: agentProposal.requirement_ids?.[0] || current.requirement_id }));
      setDraftSteps(agentProposal.authoring_mode === "gherkin" ? [] : (agentProposal.steps || []).map(step => ({ id: createDraftStepId(), action: step.action, expected_result: step.expected_result, step_type: step.step_type || "web", automation_code: "", api_request: null, group_id: null, group_name: null, group_kind: null, reusable_group_id: null })));
      setTestCaseParameterValues(normalizeTestCaseParameterValues(agentProposal.parameter_values || {}));
      lastTestCaseParameterSeedRef.current = `draft:${appTypeId || "global"}`;
    }
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      ["create", "agent_proposal", "source", "module", "suite", "requirement", "release_id", "release", "sprint_id", "sprint"]
        .forEach((key) => next.delete(key));
      return next;
    }, { replace: true });
  }, [
    appTypeId,
    projectId,
    reviewUserId,
    isCapabilityLoading,
    canCreateTestCases,
    canViewDeliveryScopes,
    canViewRequirements,
    deliveryIterationsQuery.isPending,
    deliveryReleasesQuery.isPending,
    deliveryScopeCatalog,
    isCreating,
    requirementsQuery.isPending,
    searchParams,
    selectedTestCaseId,
    setSearchParams
  ]);
const { historyByCaseId, sharedGroupNameById, stepCountByCaseId, requirementTitleById, requirementDisplayIdById, caseStatusOptions, casePriorityOptions, existingCaseLabels, existingSuiteLabels, caseModuleById, modulePickerTestCases, modulePickerRequirements, moduleNameByPickerCaseId, filteredCases, hasActiveCaseCatalogFilter, moduleCaseGroups, visibleModuleCaseGroups, moduleHealth, healthModule, moduleHealthMetrics, renderModuleMetrics, renderDeferredModuleMetrics, hasCompleteModuleMetrics, renderModuleLoadMoreFooter, moduleTileEntries, visibleModuleTileEntries, isUnassignedModuleTileVisible, visibleTileCaseCount, totalTileCaseCount, hasMoreVisibleTestCases, activeCaseFilterCount, hasIncompleteCaseFilterScope, selectableFilteredCases, selectableModuleIds, unassignedCaseIds, areAllFilteredCasesSelected, areAllUnassignedCasesSelected, setTestCaseIdsSelected, setAllFilteredTestCaseItemsSelected, setModuleSelected, setUnassignedTestCasesSelected } = useCaseLibraryModel({ workflowReviewScope, appTypeId, can, canViewRequirements, canViewExecutionInsights, isReviewQueueOpen, catalogViewMode, deferredSearchTerm, visibleTestCaseCount, setVisibleTestCaseCount, caseStatusFilter, casePriorityFilter, caseStepFilter, caseRunFilter, selectedActionTestCaseIds, setSelectedActionTestCaseIds, selectedActionCaseSnapshotsRef, expandedModuleIds, isUnassignedModuleExpanded, selectedModuleIds, setSelectedModuleIds, libraryScope, catalogFilterKey, isCatalogFiltered, collapsedFilteredModuleIds, isModuleExpanded, testCaseMetricsQuery, testCasesQuery, modulePageRequests, moduleCaseQueries, modulePageStateById, loadNextModulePage, testCaseModules, moduleDraftInitialCaseIds, healthModuleId, modulePickerRequirementsQuery, requirements, suites, testCases, sharedStepGroups, executionResults });

  const selectedProject = projects.find((project) => String(project.id) === String(projectId)) || null;
  const selectedAppType = appTypes.find((appType) => appType.id === appTypeId) || null;
  const testCaseApiOnlyState = (testCaseId: string) =>
    (testCases.find((testCase) => testCase.id === testCaseId) || selectedActionCaseSnapshotsRef.current.get(testCaseId))?.api_only;
  const testEngineIntegration = resolveScopedIntegration(testEngineIntegrations, "testengine", projectId);
  const mobileRemoteRecorderEnabled = Boolean(
    testEngineIntegration?.config?.mobile_cloud_provider
    && testEngineIntegration.config.mobile_cloud_provider !== "none"
    && testEngineIntegration.config.mobile_remote_url
  );
  const automationLearningCache = asArray(automationLearningCacheQuery.data);
  const recorderLiveUrl = recorderSession?.live_view_url || "";

  useEffect(() => {
    if (!recorderSession?.status_url || recorderSession.status !== "running") {
      return undefined;
    }

    let cancelled = false;
    const refreshRecorderSession = async () => {
      try {
        const response = await fetch(recorderSession.status_url as string, { cache: "no-store" });

        if (!response.ok) {
          return;
        }

        const next = await response.json() as Partial<RecorderSessionResponse>;

        if (!cancelled) {
          setRecorderSession((current) => current?.id === recorderSession.id ? { ...current, ...next } : current);
        }
      } catch {
        // Live recorder stats are best-effort; the stream remains the source of truth for interaction.
      }
    };
    const timer = window.setInterval(() => void refreshRecorderSession(), 1000);

    void refreshRecorderSession();
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [recorderSession?.id, recorderSession?.status, recorderSession?.status_url]);

  const executionsById = useMemo(
    () =>
      executions.reduce<Record<string, Execution>>((map, execution) => {
        map[execution.id] = execution;
        return map;
      }, {}),
    [executions]
  );
  const selectedActionCases = useMemo(
    () => {
      const loadedById = new Map(testCases.map((testCase) => [testCase.id, testCase]));
      return selectedActionTestCaseIds
        .map((testCaseId) => loadedById.get(testCaseId) || selectedActionCaseSnapshotsRef.current.get(testCaseId) || null)
        .filter(Boolean) as TestCase[];
    },
    [selectedActionTestCaseIds, testCases]
  );
  const getRunDeliveryPrefill = (testCaseIds: string[]) => {
    const normalizedIds = [...new Set(testCaseIds.filter(Boolean))];
    const loadedById = new Map(testCases.map((testCase) => [testCase.id, testCase]));
    if (selectedTestCase) loadedById.set(selectedTestCase.id, selectedTestCase);
    const scopes = normalizedIds
      .flatMap((testCaseId) => {
        const testCase = loadedById.get(testCaseId) || selectedActionCaseSnapshotsRef.current.get(testCaseId);
        return [...new Set([
          ...(testCase?.requirement_ids || []),
          ...(testCase?.requirement_id ? [testCase.requirement_id] : [])
        ].filter(Boolean))]
          .map((requirementId) => requirementDeliveryScopeById.get(requirementId));
      })
      .filter((scope): scope is { release: string; sprint: string } => Boolean(scope));
    const releases = [...new Set(scopes.map((scope) => scope.release).filter(Boolean))];
    const sprints = [...new Set(scopes.map((scope) => scope.sprint).filter(Boolean))];

    return { release: releases.length === 1 ? releases[0] : "", sprint: sprints.length === 1 ? sprints[0] : "" };
  };
  const openRunBuilder = (testCaseIds: string[], mode: ExecutionStartMode = "manual") => {
    const normalizedIds = [...new Set(testCaseIds.filter(Boolean))];
    const prefill = getRunDeliveryPrefill(normalizedIds);
    if (mode === "manual") {
      navigate(`/executions?${new URLSearchParams({ create: "1", mode, project: projectId })}`, {
        state: { createRun: { projectId, appTypeId, testCaseIds: normalizedIds, ...prefill } }
      });
      return;
    }
    runDeliveryFieldsEditedRef.current = { release: false, sprint: false };
    setSelectedActionTestCaseIds(normalizedIds);
    setExecutionRelease(prefill.release);
    setExecutionSprint(prefill.sprint);
    setExecutionStartMode(mode);
    setIsCreateExecutionModalOpen(true);
    setPendingRunBuilder((canViewRequirements && !requirementsQuery.data)
      || (canViewDeliveryScopes && (!deliveryReleasesQuery.data || !deliveryIterationsQuery.data))
      ? { testCaseIds: normalizedIds, mode, projectId, appTypeId } : null);
  };
  useEffect(() => {
    if (!pendingRunBuilder) return;
    if (!isCreateExecutionModalOpen || pendingRunBuilder.projectId !== projectId || pendingRunBuilder.appTypeId !== appTypeId) {
      setPendingRunBuilder(null);
      return;
    }
    const requiredQueries = [
      ...(canViewRequirements ? [requirementsQuery] : []),
      ...(canViewDeliveryScopes ? [deliveryReleasesQuery, deliveryIterationsQuery] : [])
    ];
    const failed = requiredQueries.find((query) => query.isError && !query.data);
    if (failed) {
      setPendingRunBuilder(null);
      showError(failed.error, "Some run options could not be filled automatically. You can continue configuring this run.");
      return;
    }
    if (requiredQueries.some((query) => !query.data)) return;
    const prefill = getRunDeliveryPrefill(selectedActionTestCaseIds);
    if (!runDeliveryFieldsEditedRef.current.release) setExecutionRelease(prefill.release);
    if (!runDeliveryFieldsEditedRef.current.sprint) setExecutionSprint(prefill.sprint);
    setPendingRunBuilder(null);
  }, [isCreateExecutionModalOpen, pendingRunBuilder, selectedActionTestCaseIds, projectId, appTypeId, canViewRequirements, canViewDeliveryScopes, requirementsQuery.data, requirementsQuery.isError,
    deliveryReleasesQuery.data, deliveryReleasesQuery.isError, deliveryIterationsQuery.data, deliveryIterationsQuery.isError, requirementDeliveryScopeById]);

  const selectedTestCase = selectedTestCaseDetailQuery.data?.id === selectedTestCaseId
    ? selectedTestCaseDetailQuery.data
    : null;
  useEffect(() => {
    if (selectedTestCase?.automated === "yes" && canViewAutomationInsights) {
      navigate(`/automation?case=${encodeURIComponent(selectedTestCase.display_id || selectedTestCase.id)}`, { replace: true });
    }
  }, [selectedTestCase?.id, selectedTestCase?.display_id, selectedTestCase?.automated, canViewAutomationInsights, navigate]);
  const selectedCaseDisplayId = selectedTestCase?.display_id?.trim()
    || testCases.find((testCase) => testCase.id === selectedTestCaseId)?.display_id?.trim()
    || deepLinkTestCases.find((testCase) => testCase.id === selectedTestCaseId)?.display_id?.trim()
    || (/^TC[_-][a-z0-9_-]+$/i.test(requestedCaseRouteId) ? requestedCaseRouteId : "");
  const canLinkTestDataToCurrentCase = canViewTestData
    && (isCreating ? canCreateTestCases : canUpdateTestCases);
  const canCreateAndLinkTestData = canManageTestData && canLinkTestDataToCurrentCase;
  const linkedDataSetId = linkedDataSetDraftIds[0] || "";
  const linkedDataSet = canViewTestData
    ? testDataSets.find((item) => item.id === linkedDataSetId)
      || selectedTestCase?.test_data_sets?.find((item) => item.id === linkedDataSetId)
      || null
    : null;
  const linkedDataSetIterationCount = linkedDataSet
    ? linkedDataSet.mode === "key_value" ? 1 : Math.max(1, linkedDataSet.rows.length)
    : 0;
  const linkedDataSetDefaultParameterValues = useMemo(
    () => buildDataSetParameterValues(linkedDataSet),
    [linkedDataSet]
  );
  const linkedDataSetParameterDefinitions = useMemo(
    () => buildDataSetParameterDefinitions(linkedDataSet, linkedDataSet?.name),
    [linkedDataSet]
  );
  const caseParameterPrivacyScope = isCreating ? `draft:${appTypeId}` : `case:${selectedTestCaseId}`;
  const linkedDataSetSensitiveParameterNames = useMemo(
    () => collectPrivateParameterNames([testCaseParameterValues, linkedDataSetDefaultParameterValues, suiteParameterValues, runPreviewParameterValues], [
      ...collectSensitiveDataSetParameterNames(linkedDataSet), ...casePrivateParameterNames(selectedTestCase),
      ...(privateCaseParameterDraft.scope === caseParameterPrivacyScope ? privateCaseParameterDraft.names : [])
    ]),
    [linkedDataSet, linkedDataSetDefaultParameterValues, selectedTestCase?.test_data_options?.private_parameter_names, selectedTestCase?.effective_private_parameter_names, testCaseParameterValues, suiteParameterValues, runPreviewParameterValues, privateCaseParameterDraft, caseParameterPrivacyScope]
  );
  useEffect(() => {
    const names = Object.keys(testCaseParameterValues).filter(name => linkedDataSetSensitiveParameterNames.has(name)).sort();
    setPrivateCaseParameterDraft(current => current.scope === caseParameterPrivacyScope && current.names.join("\0") === names.join("\0") ? current : { scope: caseParameterPrivacyScope, names });
  }, [caseParameterPrivacyScope, testCaseParameterValues, linkedDataSetSensitiveParameterNames]);
  const linkedAutomationCases = useMemo(
    () => asArray<TestCase>(automationCaseLinksQuery.data).filter((testCase) =>
      testCase.automated === "yes" && (
        testCase.manual_test_case_ids?.includes(selectedTestCaseId)
        || testCase.manual_test_case_id === selectedTestCaseId
      )
    ),
    [automationCaseLinksQuery.data, selectedTestCaseId]
  );
  const isSelectedTestCaseDetailPending = Boolean(
    selectedTestCaseId
    && !selectedTestCase
    && (selectedTestCaseDetailQuery.isPending || selectedTestCaseDetailQuery.isFetching)
  );
  const selectedCaseModuleId = selectedTestCase ? caseModuleById.get(selectedTestCase.id)?.id || "" : "";
  const canReviewSelectedTestCase = canUpdateTestCases && ownsCaseReview(selectedTestCase, reviewUserId);
  const isSelectedReviewPending = isPendingCaseReview(selectedTestCase);
  const selectedReviewStatus = isSelectedReviewPending ? "pending" : selectedTestCase?.review_status || "not_requested";
  const automationTargetCaseIds = useMemo(
    () =>
      selectedActionTestCaseIds.length
        ? selectedActionTestCaseIds
        : selectedTestCase
          ? [selectedTestCase.id]
          : [],
    [selectedActionTestCaseIds, selectedTestCase]
  );
  const automationTargetCases = useMemo(
    () => {
      const loadedById = new Map(testCases.map((testCase) => [testCase.id, testCase]));
      return automationTargetCaseIds
        .map((testCaseId) => loadedById.get(testCaseId) || selectedActionCaseSnapshotsRef.current.get(testCaseId) || null)
        .filter(Boolean) as TestCase[];
    },
    [automationTargetCaseIds, testCases]
  );
  const selectedCaseSuiteIds = useMemo(
    () =>
      Array.from(
        new Set(
          (
            isCreating
              ? [
                  ...(createSuiteContextId ? [createSuiteContextId] : []),
                  ...(activeBugConversion?.suiteIds || [])
                ]
              : [...(selectedTestCase?.suite_ids || []), ...(selectedTestCase?.suite_id ? [selectedTestCase.suite_id] : [])]
          ).filter(Boolean)
        )
      ) as string[],
    [activeBugConversion?.suiteIds, createSuiteContextId, isCreating, selectedTestCase?.suite_id, selectedTestCase?.suite_ids]
  );
  const selectedParameterSuite = suites.find((suite) => suite.id === selectedParameterSuiteId) || null;
  const createCaseParameterDraftScopeKey = useMemo(
    () => buildTestCaseParameterDraftScopeKey({ isCreating: true, appTypeId }),
    [appTypeId]
  );
  const selectedCaseParameterDraftScopeKey = useMemo(
    () => buildTestCaseParameterDraftScopeKey({ isCreating: false, testCaseId: selectedTestCaseId }),
    [selectedTestCaseId]
  );
  const selectedSuiteParameterDraftScopeKey = useMemo(
    () => buildSuiteParameterDraftScopeKey(selectedParameterSuiteId),
    [selectedParameterSuiteId]
  );
  const runPreviewParameterDraftScopeKey = useMemo(
    () => buildRunParameterDraftScopeKey(appTypeId),
    [appTypeId]
  );
  const activeTestCaseParameterSeedKey = useMemo(() => {
    if (isCreating) {
      return `draft:${appTypeId || "global"}`;
    }

    return selectedTestCase
      ? `case:${selectedTestCase.id}:${selectedTestCase.revision ?? selectedTestCase.updated_at ?? "detail"}`
      : selectedTestCaseId ? "__loading__" : "__none__";
  }, [appTypeId, isCreating, selectedTestCase, selectedTestCaseId]);
  const visibleTestCaseParameterValues = useMemo(
    () => excludeSensitiveStepParameterValues(testCaseParameterValues, linkedDataSetSensitiveParameterNames),
    [linkedDataSetSensitiveParameterNames, testCaseParameterValues]
  );
  const effectiveTestCaseParameterValues = useMemo(
    () => buildCaseParameterValues({ ownValues: visibleTestCaseParameterValues, dataSet: linkedDataSet,
      overrideNames: caseParameterSaveOptions(selectedTestCase?.test_data_options, testCaseParameterValues, selectedTestCase?.parameter_values, linkedDataSetSensitiveParameterNames, caseParameterOverrideDraftRef.current.scope === caseParameterPrivacyScope ? caseParameterOverrideDraftRef.current.names : []).parameter_overrides }),
    [linkedDataSet, visibleTestCaseParameterValues, selectedTestCase?.test_data_options, selectedTestCase?.parameter_values, testCaseParameterValues, linkedDataSetSensitiveParameterNames]
  );
  const mergedScopedParameterValues = useMemo(
    () => excludeSensitiveStepParameterValues(combineStepParameterValues(effectiveTestCaseParameterValues, suiteParameterValues, runPreviewParameterValues), linkedDataSetSensitiveParameterNames),
    [effectiveTestCaseParameterValues, runPreviewParameterValues, suiteParameterValues, linkedDataSetSensitiveParameterNames]
  );
  const parameterPreviewScopeKey = `${isCreating ? createCaseParameterDraftScopeKey : selectedCaseParameterDraftScopeKey}\u0000${linkedDataSetId || "no-data-set"}`;
  const resolvedScopedParameterValues = useMemo(() => {
    const cache = parameterPreviewCacheRef.current;
    const activeCacheKeys = new Set<string>();
    const resolved = Object.entries(mergedScopedParameterValues).reduce<Record<string, string>>((next, [name, value]) => {
      if (!hasTestDataGeneratorTemplate(value)) {
        next[name] = value;
        return next;
      }

      const cacheKey = `${parameterPreviewScopeKey}\u0000${name}\u0000${value}`;
      activeCacheKeys.add(cacheKey);
      if (!cache.has(cacheKey)) {
        cache.set(cacheKey, evaluateTestDataTemplate(value));
      }
      next[name] = cache.get(cacheKey) || "";
      return next;
    }, {});

    Array.from(cache.keys()).forEach((cacheKey) => {
      if (!activeCacheKeys.has(cacheKey)) cache.delete(cacheKey);
    });

    return resolved;
  }, [mergedScopedParameterValues, parameterPreviewRevision, parameterPreviewScopeKey]);
  const sharedGroupPreviewValues = useMemo(() => new Map(sharedStepGroups.map((group) => {
    const dataSet = canViewTestData ? testDataSets.find((item) => item.id === group.test_data_set_id) || group.test_data_set : null;
    const rowData = dataSet?.mode === "table"
      ? { ...dataSet, rows: dataSet.rows.slice(group.test_data_row_index || 0, (group.test_data_row_index || 0) + 1) }
      : dataSet;
    const inherited = combineStepParameterValues(normalizeStepParameterValues(group.parameter_values || {}), buildDataSetParameterValues(rowData));
    const values = overrideSharedGroupData
      ? combineStepParameterValues(inherited, resolvedScopedParameterValues)
      : combineStepParameterValues(inherited, visibleTestCaseParameterValues, suiteParameterValues, runPreviewParameterValues);
    const safeValues = excludeSensitiveStepParameterValues(values, collectSensitiveDataSetParameterNames(rowData));
    return [group.id, Object.fromEntries(Object.entries(safeValues).map(([name, value]) =>
      [name, hasTestDataGeneratorTemplate(value) ? evaluateTestDataTemplate(value) : value]))] as const;
  })), [canViewTestData, overrideSharedGroupData, resolvedScopedParameterValues, runPreviewParameterValues, sharedStepGroups, suiteParameterValues, testDataSets, visibleTestCaseParameterValues]);
  const parameterValuesForStep = (step: Pick<TestStep, "reusable_group_id">) => step.reusable_group_id
    ? sharedGroupPreviewValues.get(step.reusable_group_id) || resolvedScopedParameterValues
    : resolvedScopedParameterValues;
  const refreshParameterPreviews = () => {
    parameterPreviewCacheRef.current.clear();
    setParameterPreviewRevision((current) => current + 1);
  };
  const resetTestCaseParameterOverride = (name: string) => {
    if (caseParameterOverrideDraftRef.current.scope === caseParameterPrivacyScope) caseParameterOverrideDraftRef.current.names.delete(name);
    setTestCaseParameterValues((current) => {
      if (!Object.prototype.hasOwnProperty.call(current, name)) return current;
      const next = { ...current };
      delete next[name];
      return next;
    });
  };
  const aiCaseAuthoringSourceDraft = useMemo(
    () => ({
      id: selectedTestCase?.id,
      display_id: selectedTestCase?.display_id || undefined,
      title: caseDraft.title,
      priority: caseDraft.priority,
      status: caseDraft.status,
      test_case_type: caseDraft.test_case_type,
      automated: caseDraft.automated,
      module_ids: caseDraft.module_id ? [caseDraft.module_id] : [],
      reviewer_id: caseDraft.reviewer_id || null,
      labels: parseReferenceList(caseDraft.labelsText),
      external_references: parseReferenceList(caseDraft.externalReferencesText),
      ...(canViewTestData ? { test_data_set_ids: linkedDataSetDraftIds, test_data_options: { ...selectedTestCase?.test_data_options, private_parameter_names: [...linkedDataSetSensitiveParameterNames].sort(), override_shared_steps: overrideSharedGroupData } } : {}),
      description: caseDraft.description,
      authoring_mode: caseDraft.authoring_mode,
      gherkin_document: caseDraft.gherkin_document,
      parameter_values: visibleTestCaseParameterValues,
      steps: caseDraft.authoring_mode === "gherkin" ? buildGherkinQualitySteps(caseDraft.gherkin_document).map((step, index) => ({ ...step, step_order: index + 1 })) : displaySteps.map((step) => ({
        step_order: step.step_order,
        step_type: stepDrafts[step.id]?.step_type ?? step.step_type,
        action: stepDrafts[step.id]?.action ?? step.action,
        expected_result: stepDrafts[step.id]?.expected_result ?? step.expected_result
      }))
    }),
    [canViewTestData, linkedDataSetDraftIds, overrideSharedGroupData, caseDraft.priority, caseDraft.status, caseDraft.test_case_type, caseDraft.automated, caseDraft.module_id, caseDraft.reviewer_id, caseDraft.labelsText, caseDraft.externalReferencesText, caseDraft.authoring_mode, caseDraft.description, caseDraft.gherkin_document, caseDraft.title, displaySteps, selectedTestCase?.display_id, selectedTestCase?.id, selectedTestCase?.test_data_options, linkedDataSetSensitiveParameterNames, stepDrafts, visibleTestCaseParameterValues]
  );
  const aiCaseAuthoringAutomationStepCount = useMemo(
    () => canViewAutomationCode
      ? displaySteps.filter((step) =>
        stepHasAutomation({
          action: stepDrafts[step.id]?.action ?? step.action,
          expected_result: stepDrafts[step.id]?.expected_result ?? step.expected_result,
          step_type: stepDrafts[step.id]?.step_type ?? step.step_type,
          automation_code: stepDrafts[step.id]?.automation_code ?? step.automation_code,
          api_request: stepDrafts[step.id]?.api_request ?? step.api_request
        })
      ).length
      : 0,
    [canViewAutomationCode, displaySteps, stepDrafts]
  );
  const aiCaseAuthoringNeedsAutomationEdit = !isCreating && Boolean(
    aiCaseAuthoringAutomationStepCount
    || selectedTestCase?.automated === "yes"
    || selectedTestCase?.automation_status === "ready"
  );
const { resolveScopedParameterInputState, handleScopedParameterValueChange, resolveParameterScopeState, handleParameterScopeChange, syncCachedTestCaseParameterValues, syncCachedTestCaseSuiteIds, syncCachedSuiteParameterValues, detectedStepParameters } = useCaseParameters({ queryClient, searchParams, session, projectId, appTypeId, setAppTypeId, canCreateTestCases, canUpdateTestCases, canViewTestData, canUpdateSuites, canViewAutomationCode, canEditAutomationCode, selectedTestCaseId, setSelectedTestCaseId, currentCaseLinkScopeRef, testCasesQuery, isCreating, lastCaseDraftSeedRef, lastTestCaseParameterSeedRef, defaultTestCaseStatus, defaultTestCaseAutomated, emptyCaseDraft, caseDraft, setCaseDraft, setDraftSteps, setIsCaseParameterDialogOpen, hasParameterScopeDraft, setHasParameterScopeDraft, setLinkedDataSetDraftIds, overrideSharedGroupData, setOverrideSharedGroupData, testCaseParameterValues, setTestCaseParameterValues, privateCaseParameterDraft, setPrivateCaseParameterDraft, caseParameterOverrideDraftRef, pendingCaseParameterSaveRef, caseParameterAutosaveTimeoutRef, isOpeningLinkedAutomation, suiteParameterValues, setSuiteParameterValues, setRunPreviewParameterValues, selectedParameterSuiteId, setSelectedParameterSuiteId, stepDrafts, setStepDrafts, suppressCaseSelectionFromUrlRef, deepLinkTestCasesQuery, updateSuite, updateTestCase, persistCaseParameterValues, testCases, deepLinkTestCases, displaySteps, showError, syncTestCaseSearchParams, selectedTestCase, linkedDataSetId, linkedDataSet, linkedDataSetParameterDefinitions, caseParameterPrivacyScope, linkedDataSetSensitiveParameterNames, isSelectedTestCaseDetailPending, selectedCaseModuleId, selectedCaseSuiteIds, selectedParameterSuite, createCaseParameterDraftScopeKey, selectedCaseParameterDraftScopeKey, activeTestCaseParameterSeedKey, mergedScopedParameterValues });


  const handleCreateLinkedAutomation = async () => {
    if (!selectedTestCase || openingLinkedAutomationRef.current) return;
    if (hasParameterScopeDraft && !await handleSaveCaseAndSteps()) return;
    openingLinkedAutomationRef.current = true;
    setIsOpeningLinkedAutomation(true);
    if (caseParameterAutosaveTimeoutRef.current !== null) {
      window.clearTimeout(caseParameterAutosaveTimeoutRef.current);
      caseParameterAutosaveTimeoutRef.current = null;
    }
    const manualCase = selectedTestCase;
    const parameterValues = normalizeTestCaseParameterValues(testCaseParameterValues);
    try {
      // Flush the reviewed test-data choices before leaving. The automation
      // inherits the saved manual values without copying them into AT overrides.
      const pending = pendingCaseParameterSaveRef.current;
      if (pending?.id === manualCase.id) await pending.promise;
      if (currentCaseLinkScopeRef.current !== `${projectId}:${manualCase.id}`) return;
      const latest = queryClient.getQueryData<TestCase>([
        ...testCaseDetailQueryKey(projectId, manualCase.id), reviewUserId, canViewExecutionInsights
      ]) || queryClient.getQueryData<TestCase>(testCaseDetailQueryKey(projectId, manualCase.id)) || manualCase;
      const selectedDataSetIds = linkedDataSetDraftIds.slice(0, 1);
      const dataLinkChanged = canViewTestData && selectedDataSetIds.join("\0") !== (latest.test_data_set_ids || []).slice(0, 1).join("\0");
      const dataPolicyChanged = canViewTestData && overrideSharedGroupData !== (latest.test_data_options?.override_shared_steps !== false);
      const parameterSaveOptions = canViewTestData ? { ...caseParameterSaveOptions(latest.test_data_options, parameterValues, latest.parameter_values, linkedDataSetSensitiveParameterNames, caseParameterOverrideDraftRef.current.scope === caseParameterPrivacyScope ? caseParameterOverrideDraftRef.current.names : []), override_shared_steps: overrideSharedGroupData } : undefined;
      const priorityChanged = parameterSaveOptions && (parameterSaveOptions.parameter_overrides || []).join("\0") !== [...(latest.test_data_options?.parameter_overrides || [])].sort().join("\0");
      if (!areTestCaseParameterValuesEqual(parameterValues, latest.parameter_values) || dataLinkChanged || dataPolicyChanged || priorityChanged) {
        if (!canUpdateTestCases) throw new Error("Save permissions are required to use the edited Test Params.");
        const response = await persistCaseParameterValues.mutateAsync({
          id: manualCase.id,
          parameter_values: parameterValues,
          ...(parameterSaveOptions ? { test_data_options: parameterSaveOptions } : {}),
          ...(dataLinkChanged ? { test_data_set_ids: selectedDataSetIds } : {}),
          expected_revision: latest.revision
        });
        syncCachedTestCaseParameterValues(manualCase.id, parameterValues, response.revision, parameterSaveOptions, dataLinkChanged ? selectedDataSetIds : undefined);
        if (areTestCaseParameterValuesEqual(readStoredTestCaseParameterDraft(selectedCaseParameterDraftScopeKey), caseParameterDraftValues(parameterValues, linkedDataSetSensitiveParameterNames))) {
          clearStoredTestCaseParameterDraft(selectedCaseParameterDraftScopeKey);
        }
      }
      if (currentCaseLinkScopeRef.current === `${projectId}:${manualCase.id}`) {
        navigate(`/automation?create=1&manual=${encodeURIComponent(manualCase.id)}&editor=api`);
      }
    } catch (error) {
      showError(error, "Unable to prepare the manual case's Test Params for automation.");
    } finally {
      openingLinkedAutomationRef.current = false;
      setIsOpeningLinkedAutomation(false);
    }
  };

  useEffect(() => {
    if (!selectedParameterSuiteId || hasParameterScopeDraft) {
      return;
    }

    const storedDraft = readStoredSuiteParameterDraft(selectedSuiteParameterDraftScopeKey);
    const nextValues = Object.keys(storedDraft).length || hasStoredSuiteParameterDraft(selectedSuiteParameterDraftScopeKey)
      ? storedDraft
      : normalizeSuiteParameterValues(selectedParameterSuite?.parameter_values);

    setSuiteParameterValues(nextValues);
  }, [selectedParameterSuite?.parameter_values, selectedParameterSuiteId, selectedSuiteParameterDraftScopeKey, hasParameterScopeDraft]);

  useEffect(() => {
    setRunPreviewParameterValues(readStoredRunParameterDraft(runPreviewParameterDraftScopeKey));
  }, [runPreviewParameterDraftScopeKey]);

  useEffect(() => {
    if (!selectedSuiteParameterDraftScopeKey || !selectedParameterSuiteId) {
      return;
    }

    if (!hasParameterScopeDraft) writeStoredSuiteParameterDraft(selectedSuiteParameterDraftScopeKey, suiteParameterValues);
  }, [selectedParameterSuiteId, selectedSuiteParameterDraftScopeKey, suiteParameterValues, hasParameterScopeDraft]);

  useEffect(() => {
    writeStoredRunParameterDraft(runPreviewParameterDraftScopeKey, runPreviewParameterValues);
  }, [runPreviewParameterDraftScopeKey, runPreviewParameterValues]);

  useEffect(() => {
    if (!selectedParameterSuite || updateSuite.isPending || hasParameterScopeDraft) {
      return;
    }

    const normalizedCurrentValues = normalizeSuiteParameterValues(suiteParameterValues);
    const normalizedSavedValues = normalizeSuiteParameterValues(selectedParameterSuite.parameter_values);

    if (areSuiteParameterValuesEqual(normalizedCurrentValues, normalizedSavedValues)) {
      clearStoredSuiteParameterDraft(selectedSuiteParameterDraftScopeKey);
      return;
    }

    const timeoutId = window.setTimeout(() => {
      updateSuite.mutate(
        {
          id: selectedParameterSuite.id,
          input: {
            parameter_values: normalizedCurrentValues
          }
        },
        {
          onSuccess: () => {
            syncCachedSuiteParameterValues(selectedParameterSuite.id, normalizedCurrentValues);

            if (areSuiteParameterValuesEqual(readStoredSuiteParameterDraft(selectedSuiteParameterDraftScopeKey), normalizedCurrentValues)) {
              clearStoredSuiteParameterDraft(selectedSuiteParameterDraftScopeKey);
            }
          },
          onError: (error) => {
            showError(error, "Unable to store Suite Params");
          }
        }
      );
    }, 450);

    return () => window.clearTimeout(timeoutId);
  }, [
    selectedParameterSuite,
    hasParameterScopeDraft,
    selectedSuiteParameterDraftScopeKey,
    suiteParameterValues,
    updateSuite,
    updateSuite.isPending
  ]);

  useEffect(() => {
    setHasParameterScopeDraft(false);
    setNewStepDraft(EMPTY_STEP_DRAFT);
    setStepInsertIndex(null);
    setStepInsertGroupContext(null);
    setSelectedStepIds([]);
    setExpandedStepIds([]);
    setExpandedStepGroupIds([]);
    lastExpandedStepSeedRef.current = "";
    setStepDrafts({});
    setEditingAutomationStepId("");
    setRephrasingStepId("");
    setCodePreviewState(null);
    setExpandedSections(isCreating ? createCreateModeTestCaseSections() : createDefaultTestCaseSections());
    setActiveTestCaseDetailTab("details");
  }, [isCreating, selectedTestCaseId]);

  useEffect(() => {
    setExpandedStepIds((current) => {
      const validIds = current.filter((id) => displaySteps.some((step) => step.id === id));
      return validIds;
    });

    setExpandedStepGroupIds((current) => {
      const validGroupIds = new Set(displaySteps.map((step) => step.group_id).filter(Boolean));
      return current.filter((id) => validGroupIds.has(id));
    });

    setSelectedStepIds((current) => current.filter((id) => displaySteps.some((step) => step.id === id)));

    setStepDrafts((current) => {
      const next = { ...current };
      displaySteps.forEach((step) => {
        if (!next[step.id]) {
          next[step.id] = {
            action: step.action || "",
            expected_result: step.expected_result || "",
            step_type: normalizeStepType(step.step_type),
            automation_code: normalizeAutomationCode(step.automation_code),
            api_request: normalizeApiRequest(step.api_request)
          };
        }
      });
      Object.keys(next).forEach((stepId) => {
        if (!displaySteps.some((step) => step.id === stepId)) {
          delete next[stepId];
        }
      });
      return next;
    });
  }, [displaySteps]);

  useEffect(() => {
    if (isCreating || !selectedTestCaseId || !displaySteps.length || stepsQuery.isFetching) {
      return;
    }

    if (lastExpandedStepSeedRef.current === selectedTestCaseId) {
      return;
    }

    const initiallyExpandedSteps = mainSteps.slice(0, 3);

    setExpandedStepIds(initiallyExpandedSteps.map((step) => step.id));
    setExpandedStepGroupIds(
      Array.from(new Set(initiallyExpandedSteps.map((step) => step.group_id).filter((groupId): groupId is string => Boolean(groupId))))
    );
    lastExpandedStepSeedRef.current = selectedTestCaseId;
  }, [displaySteps, isCreating, mainSteps, selectedTestCaseId, stepsQuery.isFetching]);

  useEffect(() => {
    if (!isImportModalOpen) {
      return;
    }

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsImportModalOpen(false);
      }
    };

    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [isImportModalOpen]);

  useEffect(() => {
    if (!isAiCaseAuthoringOpen) {
      return;
    }

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !previewCaseAuthoring.isPending && !updateTestCase.isPending) {
        setIsAiCaseAuthoringOpen(false);
      }
    };

    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [isAiCaseAuthoringOpen, previewCaseAuthoring.isPending, updateTestCase.isPending]);

  useEffect(() => {
    if (!isAiStudioOpen) {
      return;
    }

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !previewDesignedCases.isPending && !acceptDesignedCases.isPending && !createGenerationJob.isPending) {
        setIsAiStudioOpen(false);
      }
    };

    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [acceptDesignedCases.isPending, createGenerationJob.isPending, isAiStudioOpen, previewDesignedCases.isPending]);

  const refreshCases = async () => {
    const moduleChildrenPrefix = ["test-case-module-children", projectId, appTypeId] as const;
    setModulePageCursorsById({});
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: reviewSummaryQueryKey }),
      queryClient.invalidateQueries({ queryKey: ["global-test-cases", appTypeId] }),
      queryClient.invalidateQueries({ queryKey: ["test-case-metrics", appTypeId] }),
      queryClient.invalidateQueries({ queryKey: ["test-case-detail", projectId] }),
      queryClient.invalidateQueries({ queryKey: ["global-test-case-results", appTypeId] }),
      queryClient.invalidateQueries({ queryKey: ["ai-test-case-generation-jobs", appTypeId] }),
      queryClient.invalidateQueries({ queryKey: ["test-case-suites", appTypeId] }),
      queryClient.invalidateQueries({ queryKey: ["test-case-modules", appTypeId] }),
      queryClient.invalidateQueries({
        refetchType: "none",
        predicate: (candidate) => {
          const key = candidate.queryKey;
          return key[0] === moduleChildrenPrefix[0]
            && key[1] === moduleChildrenPrefix[1]
            && key[2] === moduleChildrenPrefix[2]
            && Number(key[4]) === 0;
        }
      }),
      queryClient.invalidateQueries({ queryKey: ["test-suites"] }),
      queryClient.invalidateQueries({ queryKey: ["test-case-steps", selectedTestCaseId] }),
      queryClient.invalidateQueries({ queryKey: ["requirements", projectId] }),
      queryClient.invalidateQueries({ queryKey: ["requirement-release-readiness", "project", projectId] }),
      queryClient.invalidateQueries({ predicate: ({ queryKey }) =>
        queryKey[1] === projectId && ["requirement-detail", "requirement-route-detail", "requirement-sprint-health", "sprint-requirement-children"].includes(String(queryKey[0]))
        || queryKey[2] === projectId && ["release-review-context", "release-review-stories", "release-review-cases", "release-review-bugs"].includes(String(queryKey[0]))
      }),
      queryClient.invalidateQueries({ queryKey: ["design-test-cases", appTypeId] }),
      queryClient.invalidateQueries({ queryKey: ["design-suites", appTypeId] }),
      queryClient.invalidateQueries({ queryKey: ["test-cases"] }),
      queryClient.invalidateQueries({ queryKey: ["test-case-picker", projectId] }),
      queryClient.invalidateQueries({ queryKey: ["test-case-picker-selected", projectId] }),
      queryClient.invalidateQueries({ queryKey: ["test-case-picker-modules", projectId] }),
      queryClient.invalidateQueries({ queryKey: ["suite-scope-picker", projectId] }),
      queryClient.invalidateQueries({ queryKey: ["bug-suite-picker", projectId] }),
      queryClient.invalidateQueries({ queryKey: ["design-run-scope-cases", projectId] }),
      queryClient.invalidateQueries({ queryKey: ["design-run-scope-stories", projectId] }),
      queryClient.invalidateQueries({ queryKey: ["automation-learning-cache"] }),
      queryClient.invalidateQueries({ queryKey: ["workspace-transactions"] })
    ]);
    await queryClient.refetchQueries({
      type: "active",
      predicate: (candidate) => {
        const key = candidate.queryKey;
        return key[0] === moduleChildrenPrefix[0]
          && key[1] === moduleChildrenPrefix[1]
          && key[2] === moduleChildrenPrefix[2]
          && Number(key[4]) === 0;
      }
    });
  };

  const refreshSharedGroups = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["shared-step-groups"] }),
      queryClient.invalidateQueries({ queryKey: ["shared-step-groups", appTypeId] })
    ]);
  };

  const generationJobSyncToken = useMemo(
    () =>
      generationJobs
        .map((job) => `${job.id}:${job.status}:${job.processed_requirements}:${job.generated_cases_count}`)
        .join("|"),
    [generationJobs]
  );
  const lastGenerationJobSyncTokenRef = useRef("");

  useEffect(() => {
    if (!appTypeId) {
      lastGenerationJobSyncTokenRef.current = "";
      return;
    }

    if (!generationJobSyncToken) {
      lastGenerationJobSyncTokenRef.current = "";
      return;
    }

    if (!lastGenerationJobSyncTokenRef.current) {
      lastGenerationJobSyncTokenRef.current = generationJobSyncToken;
      return;
    }

    if (lastGenerationJobSyncTokenRef.current === generationJobSyncToken) {
      return;
    }

    lastGenerationJobSyncTokenRef.current = generationJobSyncToken;

    void Promise.all([
      queryClient.invalidateQueries({ queryKey: ["global-test-cases", appTypeId] }),
      queryClient.invalidateQueries({ queryKey: ["test-case-metrics", appTypeId] }),
      queryClient.invalidateQueries({ queryKey: ["requirements", projectId] }),
      queryClient.invalidateQueries({ queryKey: ["requirement-release-readiness", "project", projectId] }),
      queryClient.invalidateQueries({ predicate: ({ queryKey }) =>
        queryKey[1] === projectId && ["requirement-detail", "requirement-route-detail", "requirement-sprint-health", "sprint-requirement-children"].includes(String(queryKey[0]))
        || queryKey[2] === projectId && ["release-review-context", "release-review-stories", "release-review-cases"].includes(String(queryKey[0]))
      })
    ]);
  }, [appTypeId, generationJobSyncToken, projectId, queryClient]);

  useEffect(() => {
    if (!appTypeId) {
      generationJobAlertScopeRef.current = "";
      surfacedGenerationJobFailureIdsRef.current = new Set();
      surfacedGenerationJobCompletionIdsRef.current = new Set();
      return;
    }

    if (!generationJobsQuery.isFetched) {
      return;
    }

    if (generationJobAlertScopeRef.current !== appTypeId) {
      generationJobAlertScopeRef.current = appTypeId;
      surfacedGenerationJobFailureIdsRef.current = new Set(
        generationJobs.filter((job) => job.status === "failed").map((job) => job.id)
      );
      surfacedGenerationJobCompletionIdsRef.current = new Set(
        generationJobs.filter((job) => job.status === "completed").map((job) => job.id)
      );
      return;
    }

    const latestUnsurfacedFailure = generationJobs.find(
      (job) => job.status === "failed" && !surfacedGenerationJobFailureIdsRef.current.has(job.id)
    );

    if (!latestUnsurfacedFailure) {
      return;
    }

    surfacedGenerationJobFailureIdsRef.current = new Set(surfacedGenerationJobFailureIdsRef.current).add(latestUnsurfacedFailure.id);
    setMessageTone("error");
    setMessage(latestUnsurfacedFailure.error || latestUnsurfacedFailure.last_error || "One or more queued AI generations failed.");
  }, [appTypeId, generationJobs, generationJobsQuery.isFetched]);

  useEffect(() => {
    if (!appTypeId || !generationJobsQuery.isFetched || generationJobAlertScopeRef.current !== appTypeId) {
      return;
    }

    const latestCompleted = generationJobs.find(
      (job) => job.status === "completed" && !surfacedGenerationJobCompletionIdsRef.current.has(job.id)
    );

    if (!latestCompleted) {
      return;
    }

    surfacedGenerationJobCompletionIdsRef.current = new Set(surfacedGenerationJobCompletionIdsRef.current).add(latestCompleted.id);
    const generatedCount = Number(latestCompleted.generated_cases_count || latestCompleted.created_cases?.length || 0);
    setMessageTone("success");
    setMessage(`${generatedCount} AI-generated draft test case${generatedCount === 1 ? "" : "s"} created and ready for review.`);
    void refreshCases();
  }, [appTypeId, generationJobs, generationJobsQuery.isFetched]);

  const resolveStepInsertIndex = (items: Array<{ id: string }>) => {
    if (stepInsertIndex !== null) {
      return Math.max(0, Math.min(stepInsertIndex, items.length));
    }

    if (!selectedStepIds.length) {
      return items.length;
    }

    const selectedIndexSet = new Set(selectedStepIds);
    let lastSelectedIndex = -1;

    items.forEach((step, index) => {
      if (selectedIndexSet.has(step.id)) {
        lastSelectedIndex = index;
      }
    });

    return lastSelectedIndex >= 0 ? lastSelectedIndex + 1 : items.length;
  };

  const isContinuousStepSelection = (items: Array<{ id: string; step_order: number }>, stepIds: string[]) => {
    if (!stepIds.length) {
      return false;
    }

    const selected = items
      .filter((step) => stepIds.includes(step.id))
      .slice()
      .sort((left, right) => left.step_order - right.step_order);

    if (!selected.length) {
      return false;
    }

    return selected.every((step, index) => index === 0 || step.step_order === selected[index - 1].step_order + 1);
  };

  const getInsertionGroupContext = (
    items: Array<Pick<TestStep, "group_id" | "group_name" | "group_kind" | "reusable_group_id">>,
    insertionIndex: number
  ) => {
    const previousStep = items[insertionIndex - 1];
    const nextStep = items[insertionIndex];

    if (!previousStep?.group_id || previousStep.group_id !== nextStep?.group_id) {
      return null;
    }

    return {
      group_id: previousStep.group_id || null,
      group_name: previousStep.group_name || null,
      group_kind: previousStep.group_kind || null,
      reusable_group_id: previousStep.reusable_group_id || null
    };
  };

  const getOrCreateSharedGroupRecord = async (
    name: string,
    selectedSteps: Array<Pick<TestStep, "action" | "expected_result" | "step_type" | "automation_code" | "api_request">>
  ) => {
    if (!appTypeId) {
      throw new Error("Select an app type before creating a Shared Step Group.");
    }

    const matchingGroup = sharedStepGroups.find((group) => {
      if (normalizeSharedGroupComparableText(group.name) !== normalizeSharedGroupComparableText(name)) {
        return false;
      }

      if ((group.steps || []).length !== selectedSteps.length) {
        return false;
      }

      return group.steps.every((step, index) => {
        const candidate = selectedSteps[index];
        return (
          normalizeSharedGroupComparableText(step.action) === normalizeSharedGroupComparableText(candidate?.action) &&
          normalizeSharedGroupComparableText(step.expected_result) === normalizeSharedGroupComparableText(candidate?.expected_result) &&
          areComparableStepAutomationEqual(step, {
            step_type: candidate?.step_type,
            automation_code: candidate?.automation_code,
            api_request: candidate?.api_request
          })
        );
      });
    });

    if (matchingGroup) {
      return matchingGroup.id;
    }

    const response = await createSharedStepGroup.mutateAsync({
      app_type_id: appTypeId,
      name,
      steps: selectedSteps.map((step, index) => {
        const nextStep = {
          step_order: index + 1,
          action: step.action || undefined,
          expected_result: step.expected_result || undefined,
          step_type: normalizeStepType(step.step_type),
          automation_code: normalizeAutomationCode(step.automation_code) || undefined,
          api_request: normalizeApiRequest(step.api_request) || undefined
        };
        return canEditAutomationCode ? nextStep : stripAutomationStepFields(nextStep);
      })
    });

    const createdGroup = await api.sharedStepGroups.get(response.id);
    upsertSharedStepGroupInCache(queryClient, appTypeId, createdGroup);

    return createdGroup.id;
  };

  const hasUnsavedStepGroupDrafts = (groupItems: TestStep[]) =>
    !isCreating &&
    groupItems.some((step) => {
      const draft = stepDrafts[step.id];

      if (!draft) {
        return false;
      }

      return (
        normalizeSharedGroupComparableText(draft.action) !== normalizeSharedGroupComparableText(step.action) ||
        normalizeSharedGroupComparableText(draft.expected_result) !== normalizeSharedGroupComparableText(step.expected_result) ||
        !areComparableStepAutomationEqual(draft, step)
      );
    });

  const handleConvertStepGroup = async (
    groupId: string,
    groupName: string,
    groupItems: TestStep[],
    targetKind: "local" | "reusable"
  ) => {
    if (!groupItems.length) {
      return;
    }

    if (hasUnsavedStepGroupDrafts(groupItems)) {
      showError(
        new Error("Save or discard the inline edits inside this group before changing how it is linked."),
        targetKind === "reusable" ? "Unable to convert to Shared Step Group" : "Unable to convert to local group"
      );
      return;
    }

    const resolvedName = groupName.trim() || groupItems[0]?.group_name?.trim() || "Step group";

    try {
      const reusableGroupId =
        targetKind === "reusable"
          ? await getOrCreateSharedGroupRecord(
              resolvedName,
              groupItems.map((step) => ({
                action: step.action,
                expected_result: step.expected_result,
                step_type: step.step_type,
                automation_code: step.automation_code,
                api_request: step.api_request
              }))
            )
          : null;

      if (isCreating) {
        setDraftSteps((current) =>
          current.map((step) =>
            step.group_id === groupId
              ? {
                  ...step,
                  group_name: resolvedName,
                  group_kind: targetKind,
                  reusable_group_id: reusableGroupId
                }
              : step
          )
        );
      } else if (selectedTestCaseId) {
        const response = await groupSteps.mutateAsync({
          test_case_id: selectedTestCaseId,
          step_ids: groupItems.map((step) => step.id),
          name: resolvedName,
          kind: targetKind,
          group_id: groupId,
          reusable_group_id: reusableGroupId || undefined
        });
        setExpandedStepGroupIds((current) =>
          current.includes(groupId) ? [...current.filter((id) => id !== groupId), response.group_id] : current
        );
        await queryClient.invalidateQueries({ queryKey: ["test-case-steps", selectedTestCaseId] });
      }

      if (targetKind === "reusable" || groupItems.some((step) => step.reusable_group_id)) {
        await refreshSharedGroups();
      }

      showSuccess(
        targetKind === "reusable"
          ? `Converted "${resolvedName}" to a Shared Step Group.`
          : `Converted "${resolvedName}" to a local step group.`
      );
    } catch (error) {
      showError(error, targetKind === "reusable" ? "Unable to convert to Shared Step Group" : "Unable to convert to local group");
    }
  };

  const activateStepInsert = (index: number, groupContext: StepInsertionGroupContext | null = null) => {
    setStepInsertIndex(index);
    setStepInsertGroupContext(groupContext);
    setNewStepDraft(EMPTY_STEP_DRAFT);
  };

  const cancelStepInsert = () => {
    setStepInsertIndex(null);
    setStepInsertGroupContext(null);
    setNewStepDraft(EMPTY_STEP_DRAFT);
  };

  const clearStepSelectionIfClipboardActive = () => {
    if (copiedSteps.length || cutStepSource?.stepIds.length) {
      setSelectedStepIds([]);
    }
  };
const { handleCreateAndLinkDataSet, handleSaveCase, handleSaveCaseAndSteps } = useCaseAuthoringSave({ queryClient, projectId, appTypeId, can, canCreateTestCases, canUpdateTestCases, canViewRequirements, canViewTestData, canViewAutomationCode, canEditAutomationCode, reviewUserId, setSelectedTestCaseId, isCreating, setIsCreating, setCaseDeliveryRelease, setCaseDeliverySprint, setExpandedSections, setMessage, setMessageTone, lastCaseSaveNoticeRef, emptyDataSetDraft, caseDraft, setCaseDraft, stepInsertIndex, setStepInsertIndex, setStepInsertGroupContext, draftSteps, setDraftSteps, setSelectedStepIds, setHasParameterScopeDraft, linkedDataSetDraftIds, setLinkedDataSetDraftIds, overrideSharedGroupData, setIsDataSetCreatorOpen, newDataSetDraft, setNewDataSetDraft, testCaseParameterValues, caseParameterOverrideDraftRef, suiteParameterValues, stepDrafts, createSuiteContextId, setCreateSuiteContextId, activeBugConversion, setActiveBugConversion, pendingDraftEvidenceRef, retainAiEvidence, createTestCase, createTestDataSet, assignCasesToModule, removeCasesFromModule, updateSuite, updateTestCase, linkedRequirementTitle, displaySteps, showSuccess, showError, syncTestCaseSearchParams, selectedTestCase, canCreateAndLinkTestData, caseParameterPrivacyScope, linkedDataSetSensitiveParameterNames, isSelectedTestCaseDetailPending, selectedCaseModuleId, selectedParameterSuite, createCaseParameterDraftScopeKey, selectedCaseParameterDraftScopeKey, selectedSuiteParameterDraftScopeKey, visibleTestCaseParameterValues, syncCachedTestCaseParameterValues, syncCachedSuiteParameterValues, refreshCases, refreshSharedGroups, clearStepSelectionIfClipboardActive });


	  const handleDeleteCase = async () => {
	    if (!canDeleteTestCases) {
	      showError(new Error("Permission required: testcase.delete"), "Unable to delete test case");
	      return;
	    }

	    if (!selectedTestCase || !(await confirmDelete({ message: `Delete test case "${selectedTestCase.title}"? Historical run evidence will stay preserved.` }))) {
	      return;
	    }

    try {
      await deleteTestCase.mutateAsync(selectedTestCase.id);
      clearStoredTestCaseParameterDraft(buildTestCaseParameterDraftScopeKey({ isCreating: false, testCaseId: selectedTestCase.id }));
      setSelectedActionTestCaseIds((current) => current.filter((id) => id !== selectedTestCase.id));
      syncTestCaseSearchParams(null);
      setSelectedTestCaseId("");
      setCaseDraft(emptyCaseDraft);
      setIsCreating(false);
      setSelectedStepIds([]);
      setStepInsertIndex(null);
      setStepInsertGroupContext(null);
      showSuccess("Test case deleted. Run snapshots remain available.");
      await refreshCases();
    } catch (error) {
      showError(error, "Unable to delete test case");
    }
  };

	  const handleDeleteSelectedCases = async () => {
	    const selectedCaseIds = [...new Set(selectedActionTestCaseIds)];

	    if (!selectedCaseIds.length || !canDeleteTestCases) {
	      return;
	    }

    const confirmed = await confirmDelete({
      message: `Delete ${selectedCaseIds.length} test case${selectedCaseIds.length === 1 ? "" : "s"}? Historical execution evidence will stay preserved.`
    });

    if (!confirmed) {
      return;
    }

    setIsDeletingSelectedTestCases(true);

    try {
      const results = await Promise.allSettled(selectedCaseIds.map((testCaseId) => api.testCases.delete(testCaseId)));
      const deletedIds = selectedCaseIds.filter((_, index) => results[index]?.status === "fulfilled");
      const failedResults = results.filter((result): result is PromiseRejectedResult => result.status === "rejected");

      deletedIds.forEach((testCaseId) => {
        clearStoredTestCaseParameterDraft(buildTestCaseParameterDraftScopeKey({ isCreating: false, testCaseId }));
      });
      setSelectedActionTestCaseIds((current) => current.filter((id) => !deletedIds.includes(id)));

      if (deletedIds.includes(selectedTestCaseId)) {
        syncTestCaseSearchParams(null);
        setSelectedTestCaseId("");
        setCaseDraft(emptyCaseDraft);
        setDraftSteps([]);
        setNewStepDraft(EMPTY_STEP_DRAFT);
        setStepInsertIndex(null);
        setStepInsertGroupContext(null);
        setSelectedStepIds([]);
        setExpandedStepIds([]);
        setExpandedStepGroupIds([]);
        setIsCreating(false);
      }

      if (deletedIds.length) {
        await refreshCases();
      }

      if (!failedResults.length) {
        showSuccess(`${deletedIds.length} test case${deletedIds.length === 1 ? "" : "s"} deleted. Run history remains preserved.`);
        return;
      }

      const firstError = failedResults[0]?.reason;
      setMessageTone("error");
      setMessage(
        `${deletedIds.length} test case${deletedIds.length === 1 ? "" : "s"} deleted, ${failedResults.length} failed.${firstError instanceof Error ? ` ${firstError.message}` : ""}`
      );
    } finally {
      setIsDeletingSelectedTestCases(false);
    }
  };

  const handleCreateModule = async (draft: CreateModuleDraft) => {
    if (!appTypeId || !draft.name.trim() || moduleCreateWorkflowPendingRef.current) {
      return;
    }
    if (!canCreateTestCases) {
      showError(null, "Permission required: testcase.create");
      return;
    }

    moduleCreateWorkflowPendingRef.current = true;
    setIsCreatingModuleWorkflow(true);
    const moduleCaseIds = canUpdateTestCases ? [...new Set(draft.testCaseIds.filter(Boolean))] : [];
    const moduleRequirementIds = canViewRequirements ? [...new Set(draft.requirementIds.filter(Boolean))] : [];
    let targetModule = moduleAssignmentRetry;
    let createdModuleThisAttempt = false;

    try {
      if (!targetModule) {
        const response = await createTestCaseModule.mutateAsync({
          app_type_id: appTypeId,
          name: draft.name.trim(),
          description: draft.description.trim() || undefined,
          requirement_ids: moduleRequirementIds
        });
        targetModule = { id: response.id, name: draft.name.trim() };
        createdModuleThisAttempt = true;
      }

      if (moduleCaseIds.length) {
        const assignment = await assignCasesToModule.mutateAsync({
          id: targetModule.id,
          testCaseIds: moduleCaseIds,
          append: true
        });
        if (!assignment.updated || assignment.assigned < moduleCaseIds.length) {
          throw new Error(
            `Only ${Math.max(0, assignment.assigned)} of ${moduleCaseIds.length} selected Test Cases were assigned.`
          );
        }
      }

      const completedModule = targetModule;
      setIsCreateModuleModalOpen(false);
      setModuleDraftInitialCaseIds([]);
      setModuleAssignmentRetry(null);
      setExpandedModuleIds((current) => [...new Set([...current, completedModule.id])]);

      try {
        await refreshCases();
        const linkedScope = [
          moduleRequirementIds.length
            ? `${moduleRequirementIds.length} Requirement${moduleRequirementIds.length === 1 ? "" : "s"}`
            : "",
          moduleCaseIds.length
            ? `${moduleCaseIds.length} Test Case${moduleCaseIds.length === 1 ? "" : "s"}`
            : ""
        ].filter(Boolean).join(" and ");
        showSuccess(linkedScope ? `Module created with ${linkedScope}.` : "Module created.");
      } catch {
        const linkedScope = [
          moduleRequirementIds.length
            ? `${moduleRequirementIds.length} Requirement${moduleRequirementIds.length === 1 ? "" : "s"}`
            : "",
          moduleCaseIds.length
            ? `${moduleCaseIds.length} Test Case${moduleCaseIds.length === 1 ? "" : "s"}`
            : ""
        ].filter(Boolean).join(" and ");
        showSuccess(
          `Module created${linkedScope ? ` with ${linkedScope}` : ""}. The catalog refresh is still pending.`
        );
      }
    } catch (error) {
      if (targetModule && moduleCaseIds.length) {
        setModuleAssignmentRetry(targetModule);
        showError(
          error,
          `Module “${targetModule.name}” exists, but its Test Case assignment did not finish. Review the selection and retry without creating a duplicate.`
        );
      } else {
        setModuleAssignmentRetry(null);
        showError(error, createdModuleThisAttempt
          ? `Module “${targetModule?.name || draft.name.trim()}” was created, but the workflow could not finish.`
          : "Unable to create module");
      }
    } finally {
      moduleCreateWorkflowPendingRef.current = false;
      setIsCreatingModuleWorkflow(false);
    }
  };

  const startDraggingTestCases = (testCaseId: string, dataTransfer?: DataTransfer) => {
    if (isDeletingSelectedTestCases) return [];
    const ids = resolveHierarchyDragIds(testCaseId, selectedActionTestCaseIds);
    setDraggingCaseIds(ids);
    if (dataTransfer) {
      writeHierarchyDragPayload(dataTransfer, "test-case", ids);
    }
    return ids;
  };

  const moveTestCasesToModule = async (moduleId: string, candidateIds: string[]) => {
    const moveScope = `${projectId}:${appTypeId}`;
    const targetModule = testCaseModules.find((module) => module.id === moduleId);
    const dragIds = [...new Set(candidateIds.filter(Boolean))];
    const movableIds = dragIds.filter((id) => caseModuleById.get(id)?.id !== moduleId);

    if (!canUpdateTestCases) {
      setDraggingCaseIds([]);
      showError(null, "Permission required: testcase.update");
      return;
    }

    if (isDeletingSelectedTestCases) {
      setDraggingCaseIds([]);
      return;
    }

    if (!targetModule || !movableIds.length || assignCasesToModule.isPending || testCaseMovePendingRef.current) {
      setDraggingCaseIds([]);
      return;
    }

    testCaseMovePendingRef.current = true;
    const movedIds: string[] = [];
    try {
      for (const batchIds of chunkHierarchyMoveIds(movableIds)) {
        if (testCaseMoveScopeRef.current !== moveScope) {
          return;
        }
        await assignCasesToModule.mutateAsync({ id: moduleId, testCaseIds: batchIds, append: true });
        if (testCaseMoveScopeRef.current !== moveScope) {
          return;
        }
        movedIds.push(...batchIds);
        setSelectedActionTestCaseIds((current) => current.filter((id) => !batchIds.includes(id)));
      }

      const movedCount = movedIds.length;
      setSelectedActionTestCaseIds((current) => current.filter((id) => !dragIds.includes(id)));
      setExpandedModuleIds((current) => [...new Set([...current, moduleId])]);
      showSuccess(`${movedCount} test case${movedCount === 1 ? "" : "s"} moved into module.`);
      await refreshCases();
    } catch (error) {
      if (movedIds.length && testCaseMoveScopeRef.current === moveScope) {
        setExpandedModuleIds((current) => [...new Set([...current, moduleId])]);
        setMessageTone("error");
        setMessage(`${movedIds.length} test case${movedIds.length === 1 ? " was" : "s were"} moved before the remaining move stopped.${error instanceof Error ? ` ${error.message}` : ""}`);
        try {
          await refreshCases();
        } catch {
          // The partial result remains explicit and a normal refresh can reconcile the hierarchy.
        }
      } else {
        showError(error, "Unable to move test case");
      }
    } finally {
      testCaseMovePendingRef.current = false;
      setDraggingCaseIds([]);
    }
  };

  const handleDropCaseOnModule = (
    moduleId: string,
    event: ReactDragEvent<HTMLDivElement>
  ) => {
    event.preventDefault();
    event.stopPropagation();
    const ids = readHierarchyDragPayload(event.dataTransfer, "test-case", draggingCaseIds);
    void moveTestCasesToModule(moduleId, ids);
  };

  const getTestCaseDropState = (module: TestCaseModule) => {
    if (!draggingCaseIds.length) {
      return { canAcceptDrop: false, dropLabel: "" };
    }

    const movableCount = draggingCaseIds.filter((id) => caseModuleById.get(id)?.id !== module.id).length;
    const canAcceptDrop = canUpdateTestCases && !assignCasesToModule.isPending && !isDeletingSelectedTestCases && movableCount > 0;
    const dropLabel = !canUpdateTestCases
      ? "Permission required to move test cases"
      : isDeletingSelectedTestCases
        ? "Deleting selected test cases…"
        : assignCasesToModule.isPending
        ? "Moving test cases…"
        : movableCount
          ? `Move ${movableCount} test case${movableCount === 1 ? "" : "s"} to ${module.name}`
          : `Already in ${module.name}`;

    return { canAcceptDrop, dropLabel };
  };

  const handleRenameModule = async (moduleId: string) => {
    if (!renamingModuleName.trim()) {
      return;
    }

    try {
      await updateTestCaseModule.mutateAsync({
        id: moduleId,
        input: { name: renamingModuleName.trim() }
      });
      setRenamingModuleId("");
      setRenamingModuleName("");
      showSuccess("Module renamed.");
      await refreshCases();
    } catch (error) {
      showError(error, "Unable to rename module");
    }
  };

  const handleDeleteModule = async (module: TestCaseModule) => {
    if (
      !canDeleteTestCases
      || !selectedModuleIds.includes(module.id)
      || deletingModuleId
      || isDeletingSelectedTestCases
    ) {
      return;
    }

    const confirmed = await confirmDelete({
      message: `Delete module “${module.name}”? Its test cases will stay available as unassigned cases.`
    });

    if (!confirmed) {
      return;
    }

    setDeletingModuleId(module.id);

    try {
      await deleteTestCaseModule.mutateAsync(module.id);
      setSelectedModuleIds((current) => current.filter((id) => id !== module.id));
      showSuccess(`Module “${module.name}” deleted. Its test cases are now unassigned.`);
      await refreshCases();
    } catch (error) {
      showError(error, "Unable to delete module");
    } finally {
      setDeletingModuleId("");
    }
  };

  const handleDeleteSelectedTestCaseItems = async () => {
    const selectedCaseIds = [...new Set(selectedActionTestCaseIds)];
    const selectedModules = selectedModuleIds;

    if (!selectedCaseIds.length && !selectedModules.length) {
      return;
    }

    if ((selectedCaseIds.length && !canDeleteTestCases) || (selectedModules.length && !canDeleteTestCases)) {
      showError(new Error("Permission required: testcase.delete"), "Unable to delete selected items");
      return;
    }

    const parts = [
      selectedCaseIds.length ? `${selectedCaseIds.length} test case${selectedCaseIds.length === 1 ? "" : "s"}` : "",
      selectedModules.length ? `${selectedModules.length} module${selectedModules.length === 1 ? "" : "s"}` : ""
    ].filter(Boolean);
    const confirmed = await confirmDelete({
      message: `Delete ${parts.join(" and ")}? Historical execution evidence stays preserved; only cases not selected for deletion remain unassigned when a module is removed.`
    });

    if (!confirmed) {
      return;
    }

    setIsDeletingSelectedTestCases(true);

    try {
      const [caseResults, moduleResults] = await Promise.all([
        Promise.allSettled(selectedCaseIds.map((testCaseId) => api.testCases.delete(testCaseId))),
        Promise.allSettled(selectedModules.map((moduleId) => deleteTestCaseModule.mutateAsync(moduleId)))
      ]);
      const deletedCaseIds = selectedCaseIds.filter((_, index) => caseResults[index]?.status === "fulfilled");
      const deletedModuleIds = selectedModules.filter((_, index) => moduleResults[index]?.status === "fulfilled");
      const failedCount = caseResults.filter((result) => result.status === "rejected").length + moduleResults.filter((result) => result.status === "rejected").length;

      deletedCaseIds.forEach((testCaseId) => {
        clearStoredTestCaseParameterDraft(buildTestCaseParameterDraftScopeKey({ isCreating: false, testCaseId }));
      });
      setSelectedActionTestCaseIds((current) => current.filter((id) => !deletedCaseIds.includes(id)));
      setSelectedModuleIds((current) => current.filter((id) => !deletedModuleIds.includes(id)));

      if (deletedCaseIds.includes(selectedTestCaseId)) {
        syncTestCaseSearchParams(null);
        setSelectedTestCaseId("");
        setCaseDraft(emptyCaseDraft);
        setDraftSteps([]);
        setNewStepDraft(EMPTY_STEP_DRAFT);
        setStepInsertIndex(null);
        setStepInsertGroupContext(null);
        setSelectedStepIds([]);
        setExpandedStepIds([]);
        setExpandedStepGroupIds([]);
        setIsCreating(false);
      }

      if (deletedCaseIds.length || deletedModuleIds.length) {
        await refreshCases();
      }

      const deletedParts = [
        deletedCaseIds.length ? `${deletedCaseIds.length} test case${deletedCaseIds.length === 1 ? "" : "s"}` : "",
        deletedModuleIds.length ? `${deletedModuleIds.length} module${deletedModuleIds.length === 1 ? "" : "s"}` : ""
      ].filter(Boolean);
      const deletedSummary = deletedParts.length ? deletedParts.join(" and ") : "No selected items";

      if (failedCount) {
        setMessageTone("error");
        setMessage(`${deletedSummary} deleted; ${failedCount} failed.`);
        return;
      }

      showSuccess(`${deletedSummary} deleted.`);
    } catch (error) {
      showError(error, "Unable to delete selected items");
    } finally {
      setIsDeletingSelectedTestCases(false);
    }
  };

  const handleSubmitReviewForCase = async (
    testCaseId: string, reviewStatus: "accepted" | "changes_requested", comment = "", snapshot?: TestCase, options?: { quiet?: boolean; onError?: (message: string) => void }
  ): Promise<boolean> => {
    const testCase = snapshot || (selectedTestCase?.id === testCaseId ? selectedTestCase : testCases.find((item) => item.id === testCaseId));
    const actionScope = reviewScopeKey;
    const actionKey = `${actionScope}:${testCaseId}`;
    if (!canUpdateTestCases || !ownsCaseReview(testCase, reviewUserId) || !isPendingCaseReview(testCase)
      || reviewActionsRef.current.has(actionKey)) return false;
    reviewActionsRef.current.add(actionKey);
    setReviewingCaseIds((current) => [...current, testCaseId]);
    try {
      const response = await reviewTestCase.mutateAsync({
        id: testCaseId,
        input: {
          review_status: reviewStatus,
          comment: comment.trim() || undefined,
          expected_updated_at: testCase?.updated_at,
          expected_revision: testCase?.revision
        }
      });
      // Cancel older reads before committing the successful decision locally.
      // The following refresh reconciles counts and cursor pages with the server.
      await Promise.all([
        queryClient.cancelQueries({ queryKey: reviewSummaryQueryKey }),
        queryClient.cancelQueries({ queryKey: ["global-test-cases", appTypeId, projectId] })
      ]);
      const updateCase = (item: TestCase): TestCase => item.id !== testCaseId ? item : {
        ...item, review_status: reviewStatus,
        ...(item.ai_generation_source ? { ai_generation_review_status: reviewStatus === "accepted" ? "accepted" as const : "rejected" as const } : {}),
        review_history: [...(item.review_history || []), ...(response.review ? [response.review] : [])]
      };
      queryClient.setQueryData<{ pending: number; overall_pending: number }>(reviewSummaryQueryKey, (current) => current
        ? { ...current, pending: Math.max(0, current.pending - 1), overall_pending: Math.max(0, current.overall_pending - 1) } : current);
      for (const query of queryClient.getQueryCache().findAll({ queryKey: ["global-test-cases", appTypeId, projectId] })) {
        if (query.queryKey[4] !== reviewUserId) continue;
        const isQueue = Boolean((query.queryKey[3] as { review_queue?: string })?.review_queue);
        queryClient.setQueryData<InfiniteData<ReturnType<typeof normalizePagedResult<TestCase>>>>(query.queryKey, (current) => current ? {
          ...current, pages: current.pages.map((page) => ({ ...page,
            items: isQueue ? page.items.filter((item) => item.id !== testCaseId) : page.items.map(updateCase)
          }))
        } : current);
      }
      queryClient.setQueriesData<TestCase>({ queryKey: testCaseDetailQueryKey(projectId, testCaseId) }, (current) => current ? updateCase(current) : current);
      queryClient.setQueriesData<ReturnType<typeof normalizePagedResult<TestCase>>>({ queryKey: ["test-case-module-children", projectId, appTypeId] },
        (current) => current ? { ...current, items: current.items.map(updateCase) } : current);
      if (currentReviewScopeRef.current === actionScope) {
        setSelectedActionTestCaseIds((current) => current.filter((id) => id !== testCaseId));
        if (!options?.quiet) showSuccess(reviewStatus === "accepted" ? "Test case review accepted." : "Changes requested. The test case and feedback have been saved.");
      }
      if (!options?.quiet) void refreshCases();
      return true;
    } catch (error) {
      options?.onError?.(error instanceof Error ? error.message : "Unable to update review status");
      if (currentReviewScopeRef.current === actionScope) {
        if (!options?.quiet) showError(error, "Unable to update review status");
        if (reviewSuggestionCaseId === testCaseId) setReviewSuggestionError(error instanceof Error ? error.message : "Unable to save feedback. Please retry.");
        if (!options?.quiet && [403, 409].includes(Number((error as { status?: number })?.status))) void refreshCases();
      }
      return false;
    } finally {
      reviewActionsRef.current.delete(actionKey);
      if (currentReviewScopeRef.current === actionScope) setReviewingCaseIds((current) => current.filter((id) => id !== testCaseId));
    }
  };

  const selectedReviewCases = selectedActionTestCaseIds.map((id) =>
    testCases.find((item) => item.id === id) || selectedActionCaseSnapshotsRef.current.get(id)
  ).filter((item): item is TestCase => Boolean(item && ownsCaseReview(item, reviewUserId) && isPendingCaseReview(item)));

  const handleBulkReview = async (status: "accepted" | "changes_requested") => {
    if (!isReviewQueueOpen || !canUpdateTestCases || !selectedReviewCases.length || bulkReviewRunningRef.current) return;
    const scope = reviewScopeKey;
    const cases = [...selectedReviewCases];
    const failures: string[] = [];
    let completed = 0;
    bulkReviewRunningRef.current = true;
    setIsBulkReviewRunning(true);
    setBulkReviewError("");
    try {
      // Preserve each selected revision and use the same assigned-reviewer endpoint
      // as individual decisions. One request at a time bounds load for large selections.
      for (const item of cases) {
        if (currentReviewScopeRef.current !== scope) break;
        if (await handleSubmitReviewForCase(item.id, status, bulkReviewComment, item, {
          quiet: true, onError: (message) => failures.push(`${item.display_id || item.title}: ${message}`)
        })) completed += 1;
      }
      if (currentReviewScopeRef.current === scope) {
        const failed = cases.length - completed;
        setMessageTone(failed ? "error" : "success");
        setMessage(`${completed} Test Case${completed === 1 ? "" : "s"} ${status === "accepted" ? "approved" : "sent back for changes"}.${failed ? ` ${failed} could not be reviewed and remain selected. ${failures.slice(0, 3).join("; ")}` : ""}`);
        setBulkReviewError(failed ? `${failed} could not be reviewed and remain selected. ${failures.slice(0, 3).join("; ")}` : "");
        if (!failed) { setIsBulkReviewRejectOpen(false); setBulkReviewComment(""); }
        void refreshCases();
      }
    } finally {
      bulkReviewRunningRef.current = false;
      setIsBulkReviewRunning(false);
    }
  };

  const handleSubmitReview = async (reviewStatus: "accepted" | "changes_requested") => {
    if (selectedTestCase && await handleSubmitReviewForCase(selectedTestCase.id, reviewStatus, reviewComment, selectedTestCase)) setReviewComment("");
  };

  const openReviewSuggestionDialog = (testCaseId: string, comment = "", snapshot?: TestCase) => {
    const testCase = snapshot || (selectedTestCase?.id === testCaseId ? selectedTestCase : testCases.find((item) => item.id === testCaseId));
    if (!canUpdateTestCases || !ownsCaseReview(testCase, reviewUserId) || !isPendingCaseReview(testCase)) return;
    reviewSuggestionSnapshotRef.current = testCase || null;
    setReviewSuggestionCaseId(testCaseId);
    setReviewSuggestionError("");
    setReviewSuggestionComment(comment);
    setReviewSuggestionConfirmed(true);
  };

  const handleSubmitReviewSuggestion = async () => {
    const actionScope = reviewScopeKey;
    setReviewSuggestionError("");
    if (await handleSubmitReviewForCase(reviewSuggestionCaseId, "changes_requested", reviewSuggestionComment, reviewSuggestionSnapshotRef.current || undefined) && currentReviewScopeRef.current === actionScope) {
      setReviewSuggestionCaseId("");
      setReviewSuggestionComment("");
      setReviewSuggestionConfirmed(true);
      reviewSuggestionSnapshotRef.current = null;
    }
  };

  const persistCaseSuiteLinks = async (nextSuiteIds: string[]) => {
    if (!selectedTestCase || !canEditSuiteLinks || isSavingSuiteLinks) return;
    setIsSavingSuiteLinks(true);
    try {
      const response = await updateTestCase.mutateAsync({ id: selectedTestCase.id, input: { suite_ids: nextSuiteIds } });
      syncCachedTestCaseSuiteIds(selectedTestCase.id, nextSuiteIds, response.revision);
    } finally {
      // Only relationship IDs are sent; authoring drafts and other Suite members remain separate.
      try {
        await Promise.all([refreshCases(), queryClient.invalidateQueries({ queryKey: ["test-case-suites", appTypeId, projectId] })]);
      } finally { setIsSavingSuiteLinks(false); }
    }
  };


	  const handleCreateSuite = async (input: SuiteCreateInput) => {
	    if (!canCreateSuites) {
	      setMessageTone("error");
	      setMessage("Permission required: suite.create");
	      return;
	    }

	    if (!appTypeId) {
	      setMessageTone("error");
      setMessage("Select an app type before creating a suite.");
      return;
    }

    try {
      await createSuite.mutateAsync({
        app_type_id: appTypeId,
        name: input.name,
        description: input.description,
        labels: input.labels,
        test_data_set_id: input.test_data_set_id || undefined,
        test_data_options: input.test_data_options,
        test_case_ids: input.selectedIds,
        module_ids: input.module_ids, module_membership: input.module_membership,
        parallel_enabled: canConfigureParallelAutomation ? input.parallel_enabled : false,
        parallel_count: canConfigureParallelAutomation && input.parallel_enabled ? input.parallel_count : 1
      });

      setIsCreateSuiteModalOpen(false);
      setSelectedActionTestCaseIds([]);
      showSuccess(input.selectedIds.length ? "Suite created and linked to the selected test cases." : "Suite created.");
      await refreshCases();
    } catch (error) {
      showError(error, "Unable to create suite");
    }
  };

	  const openSuiteTransferModal = (testCaseIds: string[], action: SuiteTransferAction = "move") => {
	    if (action === "copy" ? !canCreateTestCases : !canUpdateSuites) {
	      showError(new Error(`Permission required: ${action === "copy" ? "testcase.create" : "suite.update"}`), "Unable to open suite transfer");
	      return;
	    }

	    const normalizedCaseIds = Array.from(new Set(testCaseIds.filter(Boolean)));

    if (!normalizedCaseIds.length) {
      showError(new Error("Select one or more test cases first."), "Unable to open suite transfer");
      return;
    }

    setSuiteTransferAction(action);
    setSuiteTransferCaseIds(normalizedCaseIds);
    setSuiteTransferProjectId(projectId || "");
    setSuiteTransferAppTypeId(appTypeId || "");
    setSuiteTransferSuiteIds([]);
    setIsSuiteTransferModalOpen(true);
  };

  const closeSuiteTransferModal = () => {
    setIsSuiteTransferModalOpen(false);
    setSuiteTransferCaseIds([]);
    setSuiteTransferSuiteIds([]);
  };

  const handleApplySuiteTransfer = async () => {
    const targetAppType = allAppTypes.find((item) => item.id === suiteTransferAppTypeId) || null;
    const loadedCaseById = new Map(testCases.map((item) => [item.id, item]));
    const selectedCases = suiteTransferCaseIds
      .map((testCaseId) => loadedCaseById.get(testCaseId) || selectedActionCaseSnapshotsRef.current.get(testCaseId))
      .filter((item): item is TestCase => Boolean(item));

    if (!targetAppType || !selectedCases.length) {
      showError(new Error("Select a target app type and at least one test case."), "Unable to update suite links");
      return;
    }

    if (!suiteTransferSuiteIds.length) {
      showError(new Error("Select one or more target suites."), "Unable to update suite links");
      return;
    }

    const isCrossAppType = suiteTransferAppTypeId !== appTypeId;
    const isCrossProject = String(targetAppType.project_id) !== String(projectId);

    if (suiteTransferAction === "add" && isCrossAppType) {
      showError(new Error("Use Copy or Move when the target suite belongs to another app type or project."), "Unable to add suite links");
      return;
    }

    try {
      if (suiteTransferAction === "copy") {
        for (let offset = 0; offset < selectedCases.length; offset += TEST_CASE_COPY_HYDRATION_BATCH_SIZE) {
          const hydratedBatch = await Promise.all(
            selectedCases.slice(offset, offset + TEST_CASE_COPY_HYDRATION_BATCH_SIZE).map(async (catalogTestCase) => {
              const [testCase, caseSteps] = await Promise.all([
                ensureTestCaseDetail(catalogTestCase.id),
                queryClient.fetchQuery({
                  queryKey: ["test-case-steps", catalogTestCase.id],
                  queryFn: () => api.testSteps.list({ test_case_id: catalogTestCase.id }),
                  staleTime: 30_000
                })
              ]);
              return { testCase, caseSteps };
            })
          );

          for (const { testCase, caseSteps } of hydratedBatch) {
            await createTestCase.mutateAsync({
              app_type_id: suiteTransferAppTypeId,
              suite_ids: suiteTransferSuiteIds,
              title: `${testCase.title} (Copy)`,
              description: testCase.description || undefined,
              external_references: testCase.external_references || [],
              parameter_values: testCase.parameter_values || undefined,
              test_case_type: testCase.test_case_type || "functional",
              test_data_set_ids: isCrossProject ? [] : (testCase.test_data_set_ids || []).slice(0, 1),
              test_data_options: testCase.test_data_options,
              automated: canEditAutomationCode ? testCase.automated || defaultTestCaseAutomated : "no",
              priority: testCase.priority || 3,
              status: testCase.status || defaultTestCaseStatus,
              requirement_ids: isCrossProject
                ? []
                : testCase.requirement_ids || (testCase.requirement_id ? [testCase.requirement_id] : []),
              steps: caseSteps.map((step) => {
                const nextStep = {
                  step_order: step.step_order,
                  action: step.action || undefined,
                  expected_result: step.expected_result || undefined,
                  step_type: step.step_type,
                  automation_code: step.automation_code || undefined,
                  api_request: step.api_request || undefined,
                  group_id: step.group_id || undefined,
                  group_name: step.group_name || undefined,
                  group_kind: step.group_kind || undefined,
                  reusable_group_id: step.reusable_group_id || undefined
                };
                return canEditAutomationCode ? nextStep : stripAutomationStepFields(nextStep);
              })
            });
          }
        }
      } else {
        for (const testCase of selectedCases) {
          const currentSuiteIds = testCase.suite_ids || (testCase.suite_id ? [testCase.suite_id] : []);
          const nextSuiteIds = suiteTransferAction === "add"
            ? Array.from(new Set([...currentSuiteIds, ...suiteTransferSuiteIds]))
            : suiteTransferSuiteIds;

          await updateTestCase.mutateAsync({
            id: testCase.id,
            input: {
              app_type_id: suiteTransferAppTypeId,
              suite_ids: nextSuiteIds,
              requirement_ids: isCrossProject
                ? []
                : testCase.requirement_ids || (testCase.requirement_id ? [testCase.requirement_id] : [])
            }
          });
          syncCachedTestCaseSuiteIds(testCase.id, nextSuiteIds);
        }
      }

      closeSuiteTransferModal();
      setSelectedActionTestCaseIds([]);
      await refreshCases();
      await queryClient.invalidateQueries({ queryKey: ["test-case-suites", suiteTransferAppTypeId] });
      showSuccess(
        suiteTransferAction === "copy"
          ? `Copied ${selectedCases.length} case${selectedCases.length === 1 ? "" : "s"} into the selected suite scope.`
          : suiteTransferAction === "add"
            ? `Added ${selectedCases.length} case${selectedCases.length === 1 ? "" : "s"} to the selected suite link${suiteTransferSuiteIds.length === 1 ? "" : "s"}.`
            : `Moved ${selectedCases.length} case${selectedCases.length === 1 ? "" : "s"} to the selected suite link${suiteTransferSuiteIds.length === 1 ? "" : "s"}.`
      );
    } catch (error) {
      showError(error, "Unable to update suite links");
    }
  };

	  const handleCreateExecution = async (event: FormEvent<HTMLFormElement>) => {
	    event.preventDefault();
      if (pendingRunBuilder) return;
    if (executionStartDate && executionEndDate && executionEndDate < executionStartDate) {
      showError(new Error("End date must be on or after start date."), "Unable to create run");
      return;
    }

		    const canCreateSelectedRunMode = executionStartMode === "local"
		      ? canRunLocalAutomation
		      : executionStartMode === "remote"
		        ? canRunRemoteAutomation
		        : canCreateRuns;

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

	    if (!session?.user.id) {
	      setMessageTone("error");
	      setMessage("You need an active session before creating a run.");
      return;
    }

    if (!projectId || !appTypeId || !selectedActionTestCaseIds.length) {
      setMessageTone("error");
      setMessage("Select one or more test cases before creating a run.");
      return;
    }

    try {
      const response = await createExecution.mutateAsync({
        project_id: projectId,
        app_type_id: appTypeId,
        test_case_ids: selectedActionTestCaseIds,
        test_data_options: selectedExecutionDataOptions,
        test_environment_id: can("environment.view") ? selectedExecutionEnvironmentId || undefined : undefined,
        test_configuration_id: can("configuration.view") ? selectedExecutionConfigurationId || undefined : undefined,
        test_data_set_id: can("data.view") ? selectedExecutionDataSetId || undefined : undefined,
        parallel_enabled: canConfigureParallelAutomation && executionParallelEnabled,
        parallel_count: canConfigureParallelAutomation && executionParallelEnabled ? executionParallelCount : 1,
        execution_mode: executionStartMode === "local" && canRunLocalAutomation
          ? "local"
          : executionStartMode === "remote" && canRunRemoteAutomation ? "remote" : "manual",
        engine_base_url: undefined,
        assigned_to_ids: selectedExecutionAssigneeIds.length ? selectedExecutionAssigneeIds : undefined,
        release: canViewDeliveryScopes ? executionRelease.trim() || undefined : undefined,
        sprint: canViewDeliveryScopes ? executionSprint.trim() || undefined : undefined,
        build: executionBuild.trim() || undefined,
        name: executionName.trim() || undefined,
        start_date: executionStartDate || undefined,
        end_date: executionEndDate || undefined,
        created_by: session.user.id
      });

      closeCreateExecutionModal();
      setSelectedActionTestCaseIds([]);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["executions"] }),
        queryClient.invalidateQueries({ queryKey: ["executions", projectId] })
      ]);
      navigate(`/executions?view=${executionStartMode === "local" ? "local-runs" : "suite-runs"}&execution=${response.id}`);
      showSuccess(
        executionStartMode === "manual"
          ? `Manual run created with ${selectedActionTestCaseIds.length} selected test case${selectedActionTestCaseIds.length === 1 ? "" : "s"}.`
          : `${executionStartMode === "local" ? "Local" : "Remote"} run created and started with ${selectedActionTestCaseIds.length} selected test case${selectedActionTestCaseIds.length === 1 ? "" : "s"}.`
      );
    } catch (error) {
      showError(error, "Unable to create run");
    }
  };

	  const handleBuildSelectedAutomation = async () => {
	    if (!canBuildAutomation || !canUseAutomationAi) {
	      showError(new Error(`Permission required: ${!canBuildAutomation ? "automation.build" : "automation.ai"}`), "Unable to build automation");
	      return;
	    }

	    if (!appTypeId || !automationTargetCaseIds.length) {
	      showError(new Error("Select one or more test cases before building automation."), "Unable to build automation");
	      return;
    }

    try {
      if (automationTargetCaseIds.length === 1) {
        const response = await buildSingleAutomation.mutateAsync({ testCaseId: automationTargetCaseIds[0] });
        if (!response) return;
        showSuccess(`Automation generator queued as ${response.transaction_id.slice(0, 8)}. Track it in TestOps.`);
      } else {
        const response = await buildBatchAutomation.mutateAsync({ testCaseIds: automationTargetCaseIds });
        if (!response) return;
        showSuccess(`Batch AI automation queued as ${response.transaction_id}. Track it in TestOps.`);
      }

      await refreshCases();
    } catch (error) {
      showError(error, "Unable to build automation");
    }
  };

	  const handleStartRecorder = async (options: RecorderStartOptions, targetStepId = inspectingStepId) => {
	    if (!canUseRecorder) {
	      showError(new Error("Permission required: automation.recorder"), "Unable to start recorder");
	      return;
	    }

	    if (!selectedTestCase) {
	      showError(new Error("Select a saved test case before starting the recorder."), "Unable to start recorder");
      return;
    }

    if (!testEngineIntegration) {
      showError(new Error("Configure an active Test Engine integration before starting the recorder."), "Unable to start recorder");
      return;
    }

    try {
      const response = await startRecorder.mutateAsync({ testCaseId: selectedTestCase.id, options, targetStepId: targetStepId || undefined });
      setRecorderSession(response);
      setRecorderSessionCaseId(selectedTestCase.id);
      setRecorderStartOptions(options);
      showSuccess(response.reused
        ? "Reused the open local browser and started a fresh capture for this step."
        : response.live_view_url ? "Recorder live view is ready in HelloTest." : "Recorder started in the Test Engine browser session.");
    } catch (error) {
      showError(error, "Unable to start recorder");
    }
  };

  const handleFinishRecorder = async () => {
    if (!canUseRecorder) {
      showError(new Error("Permission required: automation.build, automation.code.view, and automation.recorder"), "Unable to finish recorder session");
      return;
    }
    if (!recorderSession?.id || !recorderSessionCaseId) {
      showError(new Error("Start a recorder session before finishing it."), "Unable to finish recorder session");
      return;
    }

    try {
      const response = await finishRecorder.mutateAsync({
        testCaseId: recorderSessionCaseId,
        sessionId: recorderSession.id,
        recorderStartOptions,
        transactionId: recorderSession.transaction_id,
        targetStepId: inspectingStepId || undefined
      });
      setRecorderSession(null);
      setRecorderSessionCaseId("");
      setInspectingStepId("");
      setRecentRecorderCompletedCaseId(recorderSessionCaseId);
      showSuccess(
        response.generated_step_count
          ? `Recorder stopped. Created ${response.created_step_count || 0} and updated ${response.updated_step_count || 0} web step${response.generated_step_count === 1 ? "" : "s"}. You can run it locally now.`
          : "Recorder stopped. No supported interactions were captured for step creation."
      );
      await refreshCases();
    } catch (error) {
      showError(error, "Unable to finish recorder session");
    }
  };

  const openExecutionHistoryResult = (result: ExecutionResult) => {
    const params = new URLSearchParams({
      execution: result.execution_id,
      testCase: result.test_case_id
    });

    navigate(`/executions?${params.toString()}`);
  };
const { handleCreateStep, handleUpdateStep, handleReorderStep, handleMoveStepGroup, handleDeleteStep, handleDeleteSelectedSteps, handleUpdateDraftStep, handleRephraseStepWithAi } = useCaseStepEditing({ queryClient, appTypeId, canEditAutomationCode, confirmDelete, selectedTestCaseId, isCreating, setMessage, setMessageTone, caseDraft, newStepDraft, setNewStepDraft, stepInsertIndex, setStepInsertIndex, stepInsertGroupContext, setStepInsertGroupContext, draftSteps, setDraftSteps, selectedStepIds, setSelectedStepIds, copiedSteps, cutStepSource, setExpandedStepIds, stepDrafts, setStepDrafts, setRephrasingStepId, integrationId, rephraseStepWithAi, createStep, updateStep, reorderSteps, deleteStep, steps, displaySteps, showSuccess, showError, selectedTestCase, visibleTestCaseParameterValues, refreshSharedGroups, resolveStepInsertIndex, getInsertionGroupContext, cancelStepInsert, handleSaveCaseAndSteps });

  const handleReorderDraftStep = (stepId: string, direction: "up" | "down") => {
    setDraftSteps((current) => {
      const currentIndex = current.findIndex((step) => step.id === stepId);
      const targetIndex = direction === "up" ? currentIndex - 1 : currentIndex + 1;

      if (currentIndex === -1 || targetIndex < 0 || targetIndex >= current.length) {
        return current;
      }

      const currentStep = current[currentIndex];
      const targetStep = current[targetIndex];

      if (currentStep.group_id) {
        if (targetStep.group_id !== currentStep.group_id) {
          return current;
        }

        const reordered = [...current];
        const [movedStep] = reordered.splice(currentIndex, 1);
        reordered.splice(targetIndex, 0, movedStep);
        return reordered;
      }

      const blocks = buildStepBlocks(current);
      const blockIndex = blocks.findIndex((block) => block.steps.some((step) => step.id === stepId));
      const swapIndex = direction === "up" ? blockIndex - 1 : blockIndex + 1;

      if (blockIndex === -1 || swapIndex < 0 || swapIndex >= blocks.length) {
        return current;
      }

      const reorderedBlocks = [...blocks];
      const [movedBlock] = reorderedBlocks.splice(blockIndex, 1);
      reorderedBlocks.splice(swapIndex, 0, movedBlock);
      const newOrderIds = reorderedBlocks.flatMap((block) => block.steps.map((step) => step.id));
      const stepById = new Map(current.map((step) => [step.id, step]));

      return newOrderIds.map((id) => stepById.get(id)).filter(Boolean) as DraftTestStep[];
    });
    showSuccess("Draft step order updated.");
  };

  const handleCopySteps = (stepIds?: string[]) => {
    const targetIds = (stepIds && stepIds.length ? stepIds : selectedStepIds).filter(Boolean);

    if (!targetIds.length) {
      showError(new Error("Select one or more steps to copy."), "Unable to copy steps");
      return;
    }

    const orderedSelection = displaySteps.filter((step) => targetIds.includes(step.id)).map((step) => ({
      ...step,
      ...(stepDrafts[step.id] || {})
    }));

    if (!orderedSelection.length) {
      return;
    }

    const selectedScopes = new Set(orderedSelection.map(stepClipboardScopeKey));
    setCopiedSteps(normalizeCopiedSteps(orderedSelection, "copy"));
    setCopiedStepContext(selectedScopes.size === 1 ? stepInsertionContextFromStep(orderedSelection[0]) : null);
    setCopiedStepMode("copy");
    setCutStepSource(null);
    showSuccess(`${orderedSelection.length} step${orderedSelection.length === 1 ? "" : "s"} copied. Use paste to insert them where you want.`);
  };

  const handleCutSteps = (stepIds?: string[]) => {
    const targetIds = (stepIds && stepIds.length ? stepIds : selectedStepIds).filter(Boolean);

    if (!targetIds.length) {
      showError(new Error("Select one or more steps to cut."), "Unable to cut steps");
      return;
    }

    const orderedSelection = displaySteps.filter((step) => targetIds.includes(step.id)).map((step) => ({
      ...step,
      ...(stepDrafts[step.id] || {})
    }));

    if (!orderedSelection.length) {
      return;
    }

    if (!isCreating && orderedSelection.some((step) => stepHasAutomation(step)) && !canEditAutomationCode) {
      showError(new Error("Automation build and code access are required to move automated steps."), "Unable to cut steps");
      return;
    }

    const selectedScopes = new Set(orderedSelection.map(stepClipboardScopeKey));
    setCopiedSteps(normalizeCopiedSteps(orderedSelection, "cut"));
    setCopiedStepContext(selectedScopes.size === 1 ? stepInsertionContextFromStep(orderedSelection[0]) : null);
    setCopiedStepMode("cut");
    setCutStepSource({
      stepIds: orderedSelection.map((step) => step.id),
      testCaseId: isCreating ? null : selectedTestCaseId,
      isDraft: isCreating
    });
    showSuccess(`${orderedSelection.length} step${orderedSelection.length === 1 ? "" : "s"} cut. Paste to move ${orderedSelection.length === 1 ? "it" : "them"} into place.`);
  };

  const handlePasteSteps = async (targetIndex?: number, groupContext?: StepInsertionGroupContext | null) => {
    if (!copiedSteps.length) {
      showError(new Error("Copy one or more steps before pasting."), "Unable to paste steps");
      return;
    }

    const materialized = materializeCopiedSteps(copiedSteps);
    const insertionIndex = targetIndex ?? resolveStepInsertIndex(displaySteps);
    const hasExplicitTargetContext = groupContext !== undefined;
    const insertionGroupContext = hasExplicitTargetContext
      ? groupContext
      : stepInsertIndex !== null
        ? stepInsertGroupContext
        : copiedStepContext || getInsertionGroupContext(displaySteps, insertionIndex);
    const preserveClipboardGrouping = !copiedStepContext && !hasExplicitTargetContext;
    const stepsToPaste = preserveClipboardGrouping
      ? materialized
      : (hasExplicitTargetContext || insertionGroupContext)
      ? materialized.map((step) => ({
          ...step,
          group_id: insertionGroupContext?.group_id || null,
          group_name: insertionGroupContext?.group_name || null,
          group_kind: insertionGroupContext?.group_kind || null,
          reusable_group_id: insertionGroupContext?.reusable_group_id || null
        }))
      : materialized.map((step) => ({
          ...step,
          group_id: null,
          group_name: null,
          group_kind: null,
          reusable_group_id: null
        }));

    try {
      if (isCreating) {
        const pastedDraftSteps = stepsToPaste.map((step) => ({
          ...step,
          id: createDraftStepId()
        }));

        setDraftSteps((current) => {
          const next = [...current];
          next.splice(insertionIndex, 0, ...pastedDraftSteps);
          return next;
        });
        setExpandedStepIds((current) => [...new Set([...current, ...pastedDraftSteps.map((step) => step.id)])]);
      } else if (selectedTestCaseId) {
        const response = await api.testSteps.createMany({
          test_case_id: selectedTestCaseId,
          insertion_index: insertionIndex,
          steps: stepsToPaste.map((step) => {
            const nextStep = {
              action: step.action || undefined,
              expected_result: step.expected_result || undefined,
              step_type: normalizeStepType(step.step_type),
              automation_code: normalizeAutomationCode(step.automation_code) || undefined,
              api_request: normalizeApiRequest(step.api_request) || undefined,
              group_id: step.group_id || undefined,
              group_name: step.group_name || undefined,
              group_kind: step.group_kind || undefined,
              reusable_group_id: step.reusable_group_id || undefined
            };
            return canEditAutomationCode ? nextStep : stripAutomationStepFields(nextStep);
          })
        });
        const createdStepIds = response.ids;

        setExpandedStepIds((current) => [...new Set([...current, ...createdStepIds])]);
        await queryClient.invalidateQueries({ queryKey: ["test-case-steps", selectedTestCaseId] });
      }

      if (copiedStepMode === "cut" && cutStepSource?.stepIds.length) {
        if (cutStepSource.isDraft) {
          setDraftSteps((current) => current.filter((step) => !cutStepSource.stepIds.includes(step.id)));
        } else {
          const cutSourceSteps = displaySteps.filter((step) => cutStepSource.stepIds.includes(step.id));
          if (cutStepSource.testCaseId) {
            await api.testSteps.deleteMany({
              test_case_id: cutStepSource.testCaseId,
              step_ids: cutStepSource.stepIds
            });
          }

          if (cutStepSource.testCaseId && cutStepSource.testCaseId !== selectedTestCaseId) {
            await queryClient.invalidateQueries({ queryKey: ["test-case-steps", cutStepSource.testCaseId] });
          }

          if (selectedTestCaseId) {
            await queryClient.invalidateQueries({ queryKey: ["test-case-steps", selectedTestCaseId] });
          }

          if (cutSourceSteps.some((step) => step.reusable_group_id) || stepsToPaste.some((step) => step.reusable_group_id)) {
            await refreshSharedGroups();
          }
        }

        setExpandedStepIds((current) => current.filter((id) => !cutStepSource.stepIds.includes(id)));
        setCopiedSteps([]);
        setCopiedStepContext(null);
        setCopiedStepMode("copy");
        setCutStepSource(null);
      }

      setStepInsertIndex(null);
      setStepInsertGroupContext(null);
      setSelectedStepIds([]);
      showSuccess(`${copiedStepMode === "cut" ? "Moved" : "Pasted"} ${stepsToPaste.length} step${stepsToPaste.length === 1 ? "" : "s"}.`);
    } catch (error) {
      showError(error, "Unable to paste steps");
    }
  };

  const handleOpenStepGroupModal = () => {
    if (!selectedStepIds.length) {
      showError(new Error("Select one or more steps to group."), "Unable to group steps");
      return;
    }

    if (!isContinuousStepSelection(displaySteps, selectedStepIds)) {
      showError(new Error("Select a continuous step range before grouping."), "Unable to group steps");
      return;
    }

    setStepGroupName("");
    setSaveAsReusableGroup(false);
    setIsStepGroupModalOpen(true);
  };

  const handleConfirmStepGroup = async () => {
    const name = stepGroupName.trim();

    if (!name) {
      showError(new Error("Enter a group name before saving the step group."), "Unable to group steps");
      return;
    }

    const selectedStepsForGrouping = displaySteps.filter((step) => selectedStepIds.includes(step.id));

    if (!selectedStepsForGrouping.length) {
      return;
    }

    try {
      const reusableGroupId = saveAsReusableGroup
        ? await getOrCreateSharedGroupRecord(
            name,
            selectedStepsForGrouping.map((step) => ({
              action: step.action,
              expected_result: step.expected_result,
              step_type: step.step_type,
              automation_code: step.automation_code,
              api_request: step.api_request
            }))
          )
        : null;

      if (isCreating) {
        const groupId = createDraftGroupId();

        setDraftSteps((current) =>
          current.map((step) =>
            selectedStepIds.includes(step.id)
              ? {
                  ...step,
                  group_id: groupId,
                  group_name: name,
                  group_kind: saveAsReusableGroup ? "reusable" : "local",
                  reusable_group_id: reusableGroupId
                }
              : step
          )
        );
      } else if (selectedTestCaseId) {
        await groupSteps.mutateAsync({
          test_case_id: selectedTestCaseId,
          step_ids: selectedStepIds,
          name,
          kind: saveAsReusableGroup ? "reusable" : "local",
          reusable_group_id: reusableGroupId || undefined
        });
        await queryClient.invalidateQueries({ queryKey: ["test-case-steps", selectedTestCaseId] });
      }

      setIsStepGroupModalOpen(false);
      setStepGroupName("");
      setSaveAsReusableGroup(false);
      setSelectedStepIds([]);

      if (reusableGroupId) {
        await refreshSharedGroups();
      }

      showSuccess(saveAsReusableGroup ? "Shared Step Group created." : "Step group created.");
    } catch (error) {
      showError(error, "Unable to group steps");
    }
  };

  const handleUngroupStepGroup = async (groupId: string, kind?: TestStep["group_kind"]) => {
    const successMessage =
      kind === "reusable"
        ? "Shared Step Group unlinked from this test case. Steps stayed in place."
        : "Step group removed. Steps stayed in place.";

    if (isCreating) {
      setDraftSteps((current) =>
        current.map((step) =>
          step.group_id === groupId
            ? {
                ...step,
                group_id: null,
                group_name: null,
                group_kind: null,
                reusable_group_id: null
              }
            : step
        )
      );
      cancelStepInsert();
      showSuccess(successMessage);
      return;
    }

    if (!selectedTestCaseId) {
      return;
    }

    try {
      await ungroupSteps.mutateAsync({
        test_case_id: selectedTestCaseId,
        group_id: groupId
      });
      cancelStepInsert();
      showSuccess(successMessage);
      await queryClient.invalidateQueries({ queryKey: ["test-case-steps", selectedTestCaseId] });
      if (kind === "reusable") {
        await refreshSharedGroups();
      }
    } catch (error) {
      showError(error, "Unable to ungroup steps");
    }
  };

  const handleRemoveStepGroup = async (groupId: string, groupSteps: TestStep[], kind?: TestStep["group_kind"]) => {
    const targetIds = groupSteps.map((step) => step.id);

    if (!targetIds.length) {
      return;
    }

    if (!isCreating && groupSteps.some((step) => stepHasAutomation(step)) && !canEditAutomationCode) {
      showError(new Error("Automation build and code access are required to remove a group containing automated steps."), "Unable to remove step group");
      return;
    }

    const groupName = groupSteps[0]?.group_name || "this step group";
    const isSharedGroup = kind === "reusable";
    const confirmMessage = isSharedGroup
      ? `Remove Shared Step Group "${groupName}" from this test case? The Shared Step Group library item will stay available.`
      : `Delete "${groupName}" and its ${targetIds.length} step${targetIds.length === 1 ? "" : "s"}?`;

    if (!(await confirmDelete({ message: confirmMessage }))) {
      return;
    }

    if (isCreating) {
      setDraftSteps((current) => current.filter((step) => step.group_id !== groupId));
      setSelectedStepIds((current) => current.filter((id) => !targetIds.includes(id)));
      setExpandedStepIds((current) => current.filter((id) => !targetIds.includes(id)));
      setExpandedStepGroupIds((current) => current.filter((id) => id !== groupId));
      cancelStepInsert();
      showSuccess(isSharedGroup ? "Shared Step Group removed from this draft case." : "Step group and its steps removed.");
      return;
    }

    if (!selectedTestCaseId) {
      return;
    }

    try {
      await api.testSteps.deleteMany({ test_case_id: selectedTestCaseId, step_ids: targetIds });
      setSelectedStepIds((current) => current.filter((id) => !targetIds.includes(id)));
      setExpandedStepIds((current) => current.filter((id) => !targetIds.includes(id)));
      setExpandedStepGroupIds((current) => current.filter((id) => id !== groupId));
      cancelStepInsert();
      showSuccess(isSharedGroup ? "Shared Step Group removed from this test case." : "Step group and its steps removed.");
      await queryClient.invalidateQueries({ queryKey: ["test-case-steps", selectedTestCaseId] });
      if (isSharedGroup) {
        await refreshSharedGroups();
      }
    } catch (error) {
      showError(error, "Unable to remove step group");
    }
  };

  const handleInsertSharedGroup = async () => {
    if (isInsertingSharedGroups) return;
    if (!selectedSharedGroupIds.length) {
      showError(new Error("Choose one or more Shared Step Groups to insert."), "Unable to insert Shared Step Groups");
      return;
    }

    const successfullyInsertedGroups: string[] = [];
    const appendGroupsToGherkin = (selectedGroups: SharedStepGroup[], insertedGroupIds: string[]) => {
      if (caseDraft.authoring_mode !== "gherkin") return;
        setCaseDraft((current) => {
          const sections = splitGherkinDocument(current.gherkin_document || structuredCaseToGherkin({ title: current.title, featureTitle: caseGherkinFeatureTitle }));
          if (!sections.scenarios.length) sections.scenarios.push({ scenario: `  Scenario: ${current.title || "Expected behavior"}`, examples: "" });
          const scenario = sections.scenarios[sections.scenarios.length - 1];
          const insertedBehavior = selectedGroups.map((group, index) => {
            const behavior = splitGherkinDocument(structuredCaseToGherkin({ title: current.title, steps: group.steps }))
              .scenarios[0]?.scenario.split("\n").slice(1).join("\n") || "";
            const groupId = insertedGroupIds[index] || group.id;
            return `    # Shared Step Group [${groupId}]: ${group.name.replace(/[\r\n]+/g, " ")}\n${behavior}\n    # End Shared Step Group [${groupId}]`;
          }).join("\n");
          scenario.scenario = `${scenario.scenario.trimEnd()}\n${insertedBehavior}`;
          return { ...current, gherkin_document: composeGherkinDocument(sections) };
        });
    };
    setIsInsertingSharedGroups(true);
    try {
      // Resolve full definitions in selection order, including groups whose
      // catalog entry only contains counts. Check every group before inserting.
      const selectedGroups = await Promise.all(selectedSharedGroupIds.map((id) => api.sharedStepGroups.get(id)));
      if (selectedGroups.some((group) => !group.steps.length)) {
        throw new Error("Every selected Shared Step Group must contain at least one step.");
      }
      if (selectedGroups.some((group) => group.steps.some((step) => stepHasAutomation(step))) && !canEditAutomationCode) {
        throw new Error("Automation build and code access are required to insert a Shared Step Group containing automation.");
      }
      const insertedGroupIds: string[] = [];
      if (isCreating) {
        const insertionIndex = caseDraft.authoring_mode === "gherkin" ? draftSteps.length : resolveStepInsertIndex(draftSteps);
        const insertedSteps = selectedGroups.flatMap((sharedGroup) => {
          const groupInstanceId = createDraftGroupId();
          insertedGroupIds.push(groupInstanceId);
          return sharedGroup.steps.map((step) => ({
            id: createDraftStepId(), action: step.action || "", expected_result: step.expected_result || "",
            step_type: normalizeStepType(step.step_type), automation_code: normalizeAutomationCode(step.automation_code),
            api_request: normalizeApiRequest(step.api_request), group_id: groupInstanceId,
            group_name: sharedGroup.name, group_kind: "reusable" as const, reusable_group_id: sharedGroup.id
          }));
        });
        setDraftSteps((current) => {
          const next = [...current];
          next.splice(insertionIndex, 0, ...insertedSteps);
          return next;
        });
        appendGroupsToGherkin(selectedGroups, insertedGroupIds);
        successfullyInsertedGroups.push(...selectedGroups.map((group) => group.id));
      } else if (selectedTestCaseId) {
        const insertionIndex = caseDraft.authoring_mode === "gherkin" ? steps.length : resolveStepInsertIndex(steps);
        let insertAfterStepId = insertionIndex > 0 ? steps[insertionIndex - 1]?.id : undefined;
        let knownStepIds = new Set(steps.map((step) => step.id));
        const insertedStepIds: string[] = [];
        for (const sharedGroup of selectedGroups) {
          await insertSharedGroup.mutateAsync({ test_case_id: selectedTestCaseId, shared_step_group_id: sharedGroup.id, insert_after_step_id: insertAfterStepId });
          const updatedSteps = (await api.testSteps.list({ test_case_id: selectedTestCaseId })).slice().sort((left, right) => left.step_order - right.step_order);
          const newSteps = updatedSteps.filter((step) => !knownStepIds.has(step.id));
          insertedStepIds.push(...newSteps.map((step) => step.id));
          insertedGroupIds.push(...new Set(newSteps.flatMap((step) => step.group_id ? [step.group_id] : [])));
          insertAfterStepId = newSteps[newSteps.length - 1]?.id || insertAfterStepId;
          knownStepIds = new Set(updatedSteps.map((step) => step.id));
          queryClient.setQueryData(["test-case-steps", selectedTestCaseId], updatedSteps);
          appendGroupsToGherkin([sharedGroup], [newSteps[0]?.group_id || sharedGroup.id]);
          successfullyInsertedGroups.push(sharedGroup.id);
        }
        // The insert endpoint appends when there is no anchor. Move the batch
        // to the start for an explicit insertion before the first step.
        if (insertionIndex === 0 && steps.length && insertedStepIds.length) {
          await api.testSteps.reorder(selectedTestCaseId, [...insertedStepIds, ...steps.map((step) => step.id)]);
        }
        await queryClient.invalidateQueries({ queryKey: ["test-case-steps", selectedTestCaseId] });
        await refreshSharedGroups();
      }


      setExpandedSections((current) => ({ ...current, steps: true }));
      setExpandedStepGroupIds((current) => current.filter((id) => !insertedGroupIds.includes(id)));
      setIsSharedGroupPickerOpen(false);
      setSelectedSharedGroupIds([]);
      setSharedGroupSearchTerm("");
      setStepInsertIndex(null);
      setStepInsertGroupContext(null);
      setSelectedStepIds([]);
      showSuccess(`Inserted ${selectedGroups.length} Shared Step Group${selectedGroups.length === 1 ? "" : "s"}.`);
    } catch (error) {
      setSelectedSharedGroupIds((current) => current.filter((id) => !successfullyInsertedGroups.includes(id)));
      showError(error, "Unable to insert Shared Step Group");
    } finally {
      setIsInsertingSharedGroups(false);
    }
  };

  const handleImportFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);

    if (!files.length) {
      return;
    }

    const preparedBatches: PreparedTestCaseImportBatch[] = [];
    const failedFiles: string[] = [];

    try {
      for (const file of files) {
        try {
          preparedBatches.push(await prepareTestCaseImportBatch(file, importSourceSelection));
        } catch (error) {
          failedFiles.push(`${file.name}: ${error instanceof Error ? error.message : "Unable to parse file"}`);
        }
      }

      if (preparedBatches.length) {
        setImportBatches((current) => [...current, ...preparedBatches]);
      }

      if (failedFiles.length) {
        setImportFileWarnings((current) => [...current, ...failedFiles]);
      }

      const preparedCaseCount = preparedBatches.reduce((total, batch) => total + batch.rows.length, 0);

      if (preparedCaseCount) {
        setMessageTone("success");
        setMessage(
          `Prepared ${preparedCaseCount} test case${preparedCaseCount === 1 ? "" : "s"} from ${preparedBatches.length} file${preparedBatches.length === 1 ? "" : "s"}.`
        );
      } else if (failedFiles[0]) {
        setMessageTone("error");
        setMessage(failedFiles[0]);
      } else {
        setMessageTone("error");
        setMessage("No importable test cases were found in the selected files.");
      }
    } finally {
      event.target.value = "";
    }
  };

	  const handleBulkImport = async () => {
	    if (!canImportTestCases) {
	      showError(new Error("Permission required: testcase.import"), "Unable to import test cases");
	      return;
	    }
	    if (importContainsProtectedAutomation && !canEditAutomationCode) {
	      showError(new Error("Automation build and code access are required to import automation code or API request definitions."), "Unable to import automated test cases");
	      return;
	    }

	    if (!appTypeId || !importRows.length) {
	      return;
	    }

    try {
      const response = await importTestCases.mutateAsync({
        app_type_id: appTypeId,
        requirement_id: importRequirementId || undefined,
        batches: importBatches
          .filter((batch) => batch.rows.length)
          .map((batch) => ({
            file_name: batch.fileName,
            row_offset: batch.rowOffset || 0,
            import_source: batch.source,
            rows: batch.rows
          }))
      });

      setMessageTone("success");
      setMessage(
        response.split_count && response.split_count > 1
          ? `Test case import split into ${response.split_count} queued batch processes. Track progress in TestOps.`
          : `Test case import queued. Track progress in TestOps batch process ${response.transaction_id.slice(0, 8)}.`
      );
      setImportBatches([]);
      setImportFileWarnings([]);
      setImportSourceSelection("auto");
      setIsImportModalOpen(false);
      await refreshCases();
    } catch (error) {
      const remaining = (error as { remaining_payloads?: Array<{ batches?: Array<{ file_name?: string; import_source: TestCaseImportSourceSelection; row_offset?: number; rows: ImportedTestCaseRow[] }> }> }).remaining_payloads;
      if (remaining?.length) {
        setImportBatches(remaining.flatMap(payload => payload.batches || []).map((batch, index) => ({
          id: `remaining-${Date.now()}-${index}`, fileName: batch.file_name || "Import", source: batch.import_source === "auto" ? "csv" : batch.import_source,
          rowOffset: batch.row_offset || 0, rows: batch.rows, warnings: ["Only this unqueued portion remains. Previously accepted batches are tracked in Batch Process."]
        })));
      }
      showError(error, "Unable to import test cases");
    }
  };

  const exportCasesToCsv = async (
	    testCasesToExport: TestCase[],
    options?: {
      fileLabel?: string;
      successMessage?: string;
    }
	  ) => {
	    if (!canExportTestCases) {
	      setMessageTone("error");
	      setMessage("Permission required: testcase.export");
	      return;
	    }

	    if (!testCasesToExport.length) {
	      setMessageTone("error");
      setMessage("No test cases are available to export.");
      return;
    }

    try {
      const response = await api.testCases.exportCases({
        app_type_id: appTypeId || "",
        test_case_ids: testCasesToExport.map((testCase) => testCase.id)
      });
      const exportRecordById = new Map((response.records || []).map((record) => [record.id, record]));
      const requirementById = new Map<string, Requirement>();
      requirements.forEach((item) => {
        requirementById.set(item.id, item);
        if (item.display_id) requirementById.set(item.display_id, item);
      });
      const suiteById = new Map<string, TestSuite>();
      suites.forEach((item) => {
        suiteById.set(item.id, item);
        if (item.display_id) suiteById.set(item.display_id, item);
      });
      const exportedRows = testCasesToExport.map((catalogTestCase) => {
        const exportRecord = exportRecordById.get(catalogTestCase.id);
        const testCase = exportRecord || catalogTestCase;
        const steps = (exportRecord?.steps || []).map((step) => {
          const exportStep = {
            step_order: step.step_order,
            action: step.action || "",
            expected_result: step.expected_result || "",
            step_type: step.step_type || "web",
            automation_code: step.automation_code || "",
            api_request: step.api_request || null,
            group_id: step.group_id || null,
            group_name: step.group_name || null,
            group_kind: step.group_kind || null,
            reusable_group_id: step.reusable_group_id || null
          };
          return canViewAutomationCode ? exportStep : stripAutomationStepFields(exportStep);
        });
        const sharedGroupIds = new Set(steps.map((step) => step.reusable_group_id).filter(Boolean));
        const moduleRecords = testCaseModules.filter((module) => testCase.module_ids?.includes(module.id) || module.test_case_ids?.includes(testCase.id));
        const dataSetIds = (testCase as TestCase & { test_data_set_ids?: string[]; test_data_set_id?: string | null }).test_data_set_ids
          || ((testCase as TestCase & { test_data_set_id?: string | null }).test_data_set_id ? [(testCase as TestCase & { test_data_set_id?: string }).test_data_set_id as string] : []);

        return {
          Title: testCase.title,
          Description: testCase.description || "",
          Status: testCase.status || "",
          Priority: testCase.priority || 3,
          Author: testCase.author?.email || testCase.author_id || testCase.created_by || "",
          "Test Case Type": testCase.test_case_type || "functional",
          Reviewer: testCase.reviewer_id || "",
          "Authoring Mode": testCase.authoring_mode || "structured",
          "Gherkin Document": testCase.gherkin_document || "",
          "Automation Status": canUseAutomationWorkspace ? testCase.automation_status || "not_automated" : undefined,
          "Automation Start URL": canUseAutomationWorkspace ? testCase.automation_start_url || "" : undefined,
          Automated: canUseAutomationWorkspace ? testCase.automated || "no" : undefined,
          Labels: (testCase.labels || []).join("|"),
          "External References": (testCase.external_references || []).join("|"),
          Stories: (testCase.requirement_ids || (testCase.requirement_id ? [testCase.requirement_id] : []))
            .map((id) => requirementById.get(id)?.display_id || id)
            .join("|"),
          Suites: (testCase.suite_ids || (testCase.suite_id ? [testCase.suite_id] : []))
            .map((id) => suiteById.get(id)?.display_id || id)
            .join("|"),
          Modules: (exportRecord as (TestCase & { primary_module_id?: string | null }) | undefined)?.primary_module_id || (moduleRecords.length === 1 ? moduleRecords[0].name : ""),
          "Parameter Values": testCase.parameter_values || {},
          "Test Data References": dataSetIds.join("|"),
          "Test Data Options": testCase.test_data_options || {},
          Steps: steps,
          "Shared Step Groups": sharedStepGroups
            .filter((group) => sharedGroupIds.has(group.id))
            .map((group) => ({
              id: group.id,
              name: group.name,
              description: group.description,
              authoring_mode: group.authoring_mode,
              gherkin_document: group.gherkin_document,
              parameter_values: group.parameter_values,
              ...(canViewTestData ? { test_data_set_id: group.test_data_set_id, test_data_row_index: group.test_data_row_index } : {}),
              steps: group.steps.map((step) => (
                canViewAutomationCode ? step : stripAutomationStepFields(step)
              ))
            }))
        };
      });
      const safeLabel = (options?.fileLabel || "test-cases").replace(/[^a-z0-9._-]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() || "test-cases";
      downloadCsvRecords(`hellotest-${safeLabel}.csv`, exportedRows);
      showSuccess(
        options?.successMessage
          || `Test case export${options?.fileLabel ? ` for "${options.fileLabel}"` : ""} queued. Track progress in TestOps batch process ${response.transaction_id.slice(0, 8)}.`
      );
    } catch (error) {
      showError(error, "Unable to export test cases");
    }
  };

  const handleCloneCase = async (testCase: TestCase, requestedStartUrl?: string) => {
	    if (automationCloneSubmitting) return;
	    if (!canCreateTestCases) {
	      showError(new Error("Permission required: testcase.create"), "Unable to clone test case");
	      return;
	    }

    if (!projectId) {
      showError(new Error("Select a project before cloning a test case."), "Unable to clone test case");
      return;
    }

    setAutomationCloneSubmitting(true);
    try {
      const [sourceTestCase, caseSteps] = await Promise.all([
        ensureTestCaseDetail(testCase.id),
        queryClient.fetchQuery({
          queryKey: ["test-case-steps", testCase.id],
          queryFn: () => api.testSteps.list({ test_case_id: testCase.id }),
          staleTime: 30_000
        })
      ]);
      const nextAppTypeId = sourceTestCase.app_type_id || appTypeId;

      if (!nextAppTypeId) {
        showError(new Error("Select an app type before cloning a test case."), "Unable to clone test case");
        return;
      }

      const automated = canEditAutomationCode ? sourceTestCase.automated || defaultTestCaseAutomated : "no";
      const requiresStartUrl = automated === "yes" && getAutomationRuntimeTypes(caseSteps, appTypes.find(app => app.id === nextAppTypeId)?.type || "web").includes("web");
      const suppliedStartUrl = requestedStartUrl ?? sourceTestCase.automation_start_url ?? "";
      if (requiresStartUrl && automationStartUrlError(suppliedStartUrl, true)) {
        setAutomationCloneSource(sourceTestCase);
        setAutomationCloneStartUrl(requestedStartUrl ?? "");
        return;
      }
      const cloneStartUrl = automated === "yes" ? reviewedAutomationStartUrl(suppliedStartUrl, requiresStartUrl) : undefined;

      const response = await createTestCase.mutateAsync({
        app_type_id: nextAppTypeId,
        suite_ids: sourceTestCase.suite_ids || (sourceTestCase.suite_id ? [sourceTestCase.suite_id] : []),
        title: `${sourceTestCase.title} (Copy)`,
        description: sourceTestCase.description || undefined,
        external_references: sourceTestCase.external_references || [],
        parameter_values: sourceTestCase.parameter_values || undefined,
        test_case_type: sourceTestCase.test_case_type || "functional",
        test_data_set_ids: (sourceTestCase.test_data_set_ids || []).slice(0, 1),
        test_data_options: sourceTestCase.test_data_options,
        automated,
        automation_start_url: cloneStartUrl || null,
        execution_hooks: sourceTestCase.execution_hooks,
        priority: sourceTestCase.priority || 3,
        status: sourceTestCase.status || defaultTestCaseStatus,
        requirement_ids: sourceTestCase.requirement_ids || (sourceTestCase.requirement_id ? [sourceTestCase.requirement_id] : []),
        steps: caseSteps.map((step) => {
          const nextStep = {
            step_order: step.step_order,
            action: step.action || undefined,
            expected_result: step.expected_result || undefined,
            step_type: step.step_type,
            automation_code: step.automation_code || undefined,
            api_request: step.api_request || undefined,
            group_id: step.group_id || undefined,
            group_name: step.group_name || undefined,
            group_kind: step.group_kind || undefined,
            reusable_group_id: step.reusable_group_id || undefined
          };
          return canEditAutomationCode ? nextStep : stripAutomationStepFields(nextStep);
        })
      });

      syncTestCaseSearchParams(response.id);
      setSelectedTestCaseId(response.id);
      setIsCreating(false);
      setAutomationCloneSource(null);
      setAutomationCloneStartUrl("");
      setDraftSteps([]);
      showSuccess(`Cloned "${sourceTestCase.title}" with its current steps.`);
      await refreshCases();
    } catch (error) {
      showError(error, "Unable to clone test case");
    } finally {
      setAutomationCloneSubmitting(false);
    }
  };

	  const handleDeleteCaseItem = async (testCase: TestCase) => {
	    if (!canDeleteTestCases) {
	      showError(new Error("Permission required: testcase.delete"), "Unable to delete test case");
	      return;
	    }

	    if (!(await confirmDelete({ message: `Delete test case "${testCase.title}"? Historical execution evidence will stay preserved.` }))) {
	      return;
	    }

    try {
      await deleteTestCase.mutateAsync(testCase.id);
      setSelectedActionTestCaseIds((current) => current.filter((id) => id !== testCase.id));

      if (selectedTestCaseId === testCase.id) {
        syncTestCaseSearchParams(null);
        setSelectedTestCaseId("");
        setCaseDraft(emptyCaseDraft);
        setIsCreating(false);
        setSelectedStepIds([]);
        setStepInsertIndex(null);
        setStepInsertGroupContext(null);
      }

      showSuccess("Test case deleted. Run snapshots remain available.");
      await refreshCases();
    } catch (error) {
      showError(error, "Unable to delete test case");
    }
  };

	  const openAiCaseAuthoring = () => {
	    if (!canUseTestCaseAi) {
	      showError(new Error("Permission required: testcase.ai"), "Unable to open AI authoring");
	      return;
	    }

	    const seededRequirementId =
	      caseDraft.requirement_id
      || selectedTestCase?.requirement_ids?.[0]
      || selectedTestCase?.requirement_id
      || "";

    setAiCaseAuthoringRequirementId(seededRequirementId);
    setAiCaseAuthoringAdditionalContext("");
    setAiCaseAuthoringExternalLinksText("");
    setAiCaseAuthoringReferenceImages([]);
    aiOriginalImagesRef.current.clear();
    setAiCaseContextFiles([]);
    setAiCaseAuthoringPreview(null);
    setAiCaseAuthoringMessage(
      aiCaseAuthoringNeedsAutomationEdit && !canEditAutomationCode
        ? "Automation build and code access are required before replacing the saved steps on this automated test case."
        : ""
    );
    setAiCaseAuthoringTone(aiCaseAuthoringNeedsAutomationEdit && !canEditAutomationCode ? "error" : "success");
    setIsAiCaseAuthoringOpen(true);
  };

	  const openAiStudio = () => {
	    if (!canUseTestCaseAi || !canCreateTestCases) {
	      showError(new Error(`Permission required: ${!canUseTestCaseAi ? "testcase.ai" : "testcase.create"}`), "Unable to open AI Test Cases Generation");
	      return;
	    }

	    const seededRequirementIds = [
      ...(selectedTestCase?.requirement_ids || []),
      ...(selectedTestCase?.requirement_id ? [selectedTestCase.requirement_id] : []),
      ...(caseDraft.requirement_id ? [caseDraft.requirement_id] : [])
    ].filter(Boolean);

    const nextRequirementIds = [...new Set(seededRequirementIds)];

    setAiRequirementIds(nextRequirementIds);
    setAiAdditionalContext("");
    setAiExternalLinksText("");
    setAiReferenceImages([]);
    aiOriginalImagesRef.current.clear();
    setAiContextFiles([]);
    setAiPreviewCases([]);
    setAiPreviewMessage("");
    setAiPreviewTone("success");
    setIsAiStudioOpen(true);
  };

	  const handleAddAiReferenceImages = async (files: FileList | null) => {
	    try {
	      const originals = Array.from(files || []);
	      const images = await readImageFiles(files, AI_REFERENCE_IMAGE_LIMITS.testCaseGeneration);
      images.forEach((image,index) => { const original=originals[index]; if(original)aiOriginalImagesRef.current.set(image.url,original); });
      setAiPreviewCases([]);
      setAiPreviewMessage("");
      let budgetMessage = "";
      setAiReferenceImages((current) => {
        const result = mergeAiReferenceImagesWithinBudget(current, images, AI_REFERENCE_IMAGE_LIMITS.testCaseGeneration);
        budgetMessage = result.message;
        return result.images;
      });
      if (budgetMessage) {
        setAiPreviewTone("error");
        setAiPreviewMessage(budgetMessage);
      }
    } catch (error) {
      setAiPreviewTone("error");
      setAiPreviewMessage(error instanceof Error ? error.message : "Unable to attach the selected image");
    }
  };

  const handleAddAiCaseAuthoringReferenceImages = async (files: FileList | null) => {
    try {
      const originals = Array.from(files || []);
      const images = await readImageFiles(files);
      images.forEach((image,index) => { const original=originals[index]; if(original)aiOriginalImagesRef.current.set(image.url,original); });
      setAiCaseAuthoringPreview(null);
      setAiCaseAuthoringMessage("");
      let budgetMessage = "";
      setAiCaseAuthoringReferenceImages((current) => {
        const result = mergeAiReferenceImagesWithinBudget(current, images);
        budgetMessage = result.message;
        return result.images;
      });
      if (budgetMessage) {
        setAiCaseAuthoringTone("error");
        setAiCaseAuthoringMessage(budgetMessage);
      }
    } catch (error) {
      setAiCaseAuthoringTone("error");
      setAiCaseAuthoringMessage(error instanceof Error ? error.message : "Unable to attach the selected image");
    }
  };

	  const handlePreviewDesignedCases = async (authoringMode: "structured" | "gherkin" = "structured") => {
	    if (!canUseTestCaseAi) {
	      setAiPreviewTone("error");
	      setAiPreviewMessage("Permission required: testcase.ai");
	      return;
	    }

	    if (!appTypeId) {
	      return;
	    }

    if (previewDesignedCases.isPending) return;
    aiDesignControllerRef.current?.abort();
    const controller = new AbortController();
    aiDesignControllerRef.current = controller;
    try {
      const promptFiles = await prepareAiPromptFiles({ projectId, files:[...aiContextFiles,...aiReferenceImages.flatMap(image=>aiOriginalImagesRef.current.get(image.url)||[])], additionalContext:aiAdditionalContext, signal:controller.signal });
      const response = await previewDesignedCases.mutateAsync({ signal: controller.signal, input: {
        app_type_id: appTypeId,
        requirement_ids: aiRequirementIds,
        integration_id: integrationId || undefined,
        max_cases: maxCases,
        authoring_mode: authoringMode,
        additional_context: promptFiles.additionalContext || undefined,
        external_links: parseExternalLinks(aiExternalLinksText),
        images: aiReferenceImages
      } });
      if (controller.signal.aborted || aiDesignControllerRef.current !== controller) return;

      setAiPreviewCases(response.cases.map(candidate=>({...candidate,reference_attachment_ids:promptFiles.attachmentIds.length?promptFiles.attachmentIds:candidate.reference_attachment_ids})));
      setAiPreviewTone("success");
      setAiPreviewMessage(`${response.context_reduced ? `${response.context_reduction_reason} ` : ""}${response.generated} ${authoringMode === "gherkin" ? "Gherkin" : "structured"} draft case${response.generated === 1 ? "" : "s"} prepared. Review and edit each draft before accepting.`);
    } catch (error) {
      if (controller.signal.aborted || aiDesignControllerRef.current !== controller) return;
      setAiPreviewTone("error");
      setAiPreviewMessage(formatAiStudioErrorMessage(error, "Unable to preview AI-generated test cases right now."));
    } finally { if (aiDesignControllerRef.current === controller) aiDesignControllerRef.current = null; }
  };

  const formatAiStudioErrorMessage = (error: unknown, fallback: string) => {
    const message = error instanceof Error ? error.message.trim() : "";
    const normalized = message.toLowerCase();

    if (!message) {
      return fallback;
    }

    if (normalized.includes("rate limit") || normalized.includes("too many") || normalized.includes("429")) {
      return "AI generation is being rate-limited right now. Please wait a moment and try again.";
    }

    if (normalized.includes("timeout") || normalized.includes("took too long")) {
      return "AI generation took too long to respond. Please try again in a moment.";
    }

    if (normalized.includes("unable to reach api") || normalized.includes("network") || normalized.includes("connection")) {
      return "Couldn't reach the AI generation service. Check the connection and try again.";
    }

    return message;
  };

	  const handlePreviewAiCaseAuthoring = async (authoringMode: "structured" | "gherkin" = caseDraft.authoring_mode) => {
	    if (!canUseTestCaseAi) {
	      setAiCaseAuthoringTone("error");
	      setAiCaseAuthoringMessage("Permission required: testcase.ai");
	      return;
	    }

	    if (!appTypeId) {
	      setAiCaseAuthoringTone("error");
      setAiCaseAuthoringMessage("Select an application before generating an AI authoring preview.");
      return;
    }

    if (previewCaseAuthoring.isPending) return;
    aiCaseAuthoringControllerRef.current?.abort();
    const controller = new AbortController();
    aiCaseAuthoringControllerRef.current = controller;
    try {
      const promptFiles = await prepareAiPromptFiles({projectId,files:[...aiCaseContextFiles,...aiCaseAuthoringReferenceImages.flatMap(image=>aiOriginalImagesRef.current.get(image.url)||[])],additionalContext:aiCaseAuthoringAdditionalContext,signal:controller.signal});
      const response = await previewCaseAuthoring.mutateAsync({ signal: controller.signal, input: {
        app_type_id: appTypeId,
        requirement_id: aiCaseAuthoringRequirementId || undefined,
        authoring_mode: authoringMode,
        integration_id: integrationId || undefined,
        additional_context: promptFiles.additionalContext || undefined,
        external_links: parseExternalLinks(aiCaseAuthoringExternalLinksText),
        images: aiCaseAuthoringReferenceImages,
        test_case: aiCaseAuthoringSourceDraft
      } });
      if (controller.signal.aborted || aiCaseAuthoringControllerRef.current !== controller) return;

      setAiCaseAuthoringPreview({...response.case,reference_attachment_ids:promptFiles.attachmentIds.length?promptFiles.attachmentIds:response.case.reference_attachment_ids});
      setAiCaseAuthoringTone("success");
      setAiCaseAuthoringMessage(
        response.context_reduced ? response.context_reduction_reason || "Reduced context was used; review against the original Story." : response.case.authoring_mode === "gherkin"
          ? "Prepared an improved Gherkin specification from the current Test Case and available context. Review it before applying."
          : `Prepared ${response.case.step_count} assisted step${response.case.step_count === 1 ? "" : "s"} from the current draft and available context. Review before applying.`
      );
    } catch (error) {
      if (controller.signal.aborted || aiCaseAuthoringControllerRef.current !== controller) return;
      setAiCaseAuthoringTone("error");
      setAiCaseAuthoringMessage(formatAiStudioErrorMessage(error, "Unable to preview AI authoring right now."));
    } finally { if (aiCaseAuthoringControllerRef.current === controller) aiCaseAuthoringControllerRef.current = null; }
  };

	  const handleApplyAiCaseAuthoring = async () => {
	    if (!canUseTestCaseAi || (!isCreating && !canUpdateTestCases)) {
	      setAiCaseAuthoringTone("error");
	      setAiCaseAuthoringMessage(`Permission required: ${!canUseTestCaseAi ? "testcase.ai" : "testcase.update"}`);
	      return;
	    }
	    if (aiCaseAuthoringNeedsAutomationEdit && !canEditAutomationCode) {
	      setAiCaseAuthoringTone("error");
	      setAiCaseAuthoringMessage("Automation build and code access are required before replacing the saved steps on this automated test case.");
	      return;
	    }

	    if (!aiCaseAuthoringPreview) {
	      return;
	    }

    const authoringIssues = draftReadinessIssues(aiCaseAuthoringPreview);
    if (authoringIssues.length) {
      setAiCaseAuthoringTone("error");
      setAiCaseAuthoringMessage(authoringIssues.join(" "));
      return;
    }

    const privatePreservation = restoreAiPrivateParameterValues(
      normalizeTestCaseParameterValues(aiCaseAuthoringPreview.parameter_values),
      testCaseParameterValues,
      linkedDataSetSensitiveParameterNames
    );
    const normalizedPreviewParameterValues = privatePreservation.values;
    const privatePreservationNotice = privatePreservation.preservedNames.length
      ? " Existing private Test Params were preserved; change private values in Test Params."
      : "";

    if (isCreating) {
      pendingDraftEvidenceRef.current=[...new Set([...pendingDraftEvidenceRef.current,...(aiCaseAuthoringPreview.reference_attachment_ids||[])])];
      const nextDraftSteps = aiCaseAuthoringPreview.authoring_mode === "gherkin"
        ? []
        : buildDraftStepsFromAiAuthoringPreview(aiCaseAuthoringPreview);

      setCaseDraft((current) => ({
        ...current,
        ai_generation_source: "interactive",
        reviewer_id: current.reviewer_id || reviewUserId,
        title: aiCaseAuthoringPreview.title,
        priority: aiCaseAuthoringPreview.priority ?? current.priority,
        test_case_type: aiCaseAuthoringPreview.test_case_type ?? current.test_case_type,
        description: aiCaseAuthoringPreview.description || "",
        authoring_mode: aiCaseAuthoringPreview.authoring_mode || "structured",
        gherkin_document: aiCaseAuthoringPreview.authoring_mode === "gherkin" ? aiCaseAuthoringPreview.gherkin_document || "" : "",
        requirement_id: aiCaseAuthoringRequirementId || current.requirement_id
      }));
      setTestCaseParameterValues(normalizedPreviewParameterValues);
      setDraftSteps(nextDraftSteps);
      setSelectedStepIds([]);
      setExpandedStepIds(nextDraftSteps.map((step) => step.id));
      setExpandedStepGroupIds([]);
      setIsAiCaseAuthoringOpen(false);
      setAiCaseAuthoringPreview(null);
      setAiCaseAuthoringMessage("");
      showSuccess(`AI-authored content applied to the new test case draft.${privatePreservationNotice}`);
      return;
    }

    if (!selectedTestCase) {
      return;
    }

    const stepReplacementMessage = aiCaseAuthoringAutomationStepCount
      ? `Replace "${selectedTestCase.title}" with the AI-authored draft? This will overwrite ${displaySteps.length} saved step${displaySteps.length === 1 ? "" : "s"} and remove automation code or API request setup from ${aiCaseAuthoringAutomationStepCount} step${aiCaseAuthoringAutomationStepCount === 1 ? "" : "s"}.`
      : `Replace "${selectedTestCase.title}" with the AI-authored draft and overwrite its ${displaySteps.length} saved step${displaySteps.length === 1 ? "" : "s"}?`;

    if (!(await confirmAction({
      title: "Replace saved steps?",
      message: stepReplacementMessage,
      confirmLabel: "Replace steps",
      tone: "danger"
    }))) {
      return;
    }

    try {
      await updateTestCase.mutateAsync({
        id: selectedTestCase.id,
        input: {
          title: aiCaseAuthoringPreview.title,
          priority: aiCaseAuthoringPreview.priority ?? caseDraft.priority,
          test_case_type: aiCaseAuthoringPreview.test_case_type ?? caseDraft.test_case_type,
          description: aiCaseAuthoringPreview.description || "",
          authoring_mode: aiCaseAuthoringPreview.authoring_mode || "structured",
          gherkin_document: aiCaseAuthoringPreview.authoring_mode === "gherkin" ? aiCaseAuthoringPreview.gherkin_document || "" : null,
          parameter_values: normalizedPreviewParameterValues,
          requirement_ids: aiCaseAuthoringRequirementId ? [aiCaseAuthoringRequirementId] : [],
          steps: aiCaseAuthoringPreview.authoring_mode === "gherkin" ? [] : buildPersistedStepsFromAiAuthoringPreview(aiCaseAuthoringPreview)
        }
      });
      await retainAiEvidence(selectedTestCase.id,aiCaseAuthoringPreview.reference_attachment_ids||[]);

      setCaseDraft((current) => ({
        ...current,
        title: aiCaseAuthoringPreview.title,
        priority: aiCaseAuthoringPreview.priority ?? current.priority,
        test_case_type: aiCaseAuthoringPreview.test_case_type ?? current.test_case_type,
        description: aiCaseAuthoringPreview.description || "",
        authoring_mode: aiCaseAuthoringPreview.authoring_mode || "structured",
        gherkin_document: aiCaseAuthoringPreview.authoring_mode === "gherkin" ? aiCaseAuthoringPreview.gherkin_document || "" : "",
        requirement_id: aiCaseAuthoringRequirementId || current.requirement_id
      }));
      setTestCaseParameterValues(normalizedPreviewParameterValues);
      syncCachedTestCaseParameterValues(selectedTestCase.id, normalizedPreviewParameterValues);
      clearStoredTestCaseParameterDraft(selectedCaseParameterDraftScopeKey);
      setIsAiCaseAuthoringOpen(false);
      setAiCaseAuthoringPreview(null);
      setAiCaseAuthoringMessage("");
      showSuccess(`AI-authored content replaced the saved test case steps and Test Params.${privatePreservationNotice}`);
      await refreshCases();
    } catch (error) {
      setAiCaseAuthoringTone("error");
      setAiCaseAuthoringMessage(formatAiStudioErrorMessage(error, "Unable to apply AI authoring right now."));
    }
  };

	  const handleAcceptDesignedCases = async (selectedClientIds?: string[]) => {
	    if (!canCreateTestCases) {
	      setAiPreviewTone("error");
	      setAiPreviewMessage("Permission required: testcase.create");
	      return;
	    }

	    if (!appTypeId || !aiPreviewCases.length) {
	      return;
	    }
    const selectedCaseSet = new Set(selectedClientIds?.length ? selectedClientIds : aiPreviewCases.map((item) => item.client_id));
    const acceptedPreviewCases = aiPreviewCases.filter((item) => selectedCaseSet.has(item.client_id));

    if (!acceptedPreviewCases.length) {
      setAiPreviewTone("error");
      setAiPreviewMessage("Select at least one AI-generated case to accept.");
      return;
    }

    const acceptanceIssues = acceptedPreviewCases.flatMap(item => draftReadinessIssues(item).map(issue => `${item.title || "Untitled draft"}: ${issue}`));
    if (acceptanceIssues.length) {
      setAiPreviewTone("error");
      setAiPreviewMessage(acceptanceIssues.join(" "));
      return;
    }

    try {
      const response = await acceptDesignedCases.mutateAsync({
        app_type_id: appTypeId,
        requirement_ids: aiRequirementIds,
        status: "draft",
        cases: acceptedPreviewCases.map((item) => ({
          reference_attachment_ids:item.reference_attachment_ids,
          title: item.title,
          description: item.description,
          priority: item.priority,
          test_case_type: item.test_case_type,
          requirement_ids: item.requirement_ids,
          authoring_mode: item.authoring_mode,
          gherkin_document: item.gherkin_document,
          parameter_values: item.parameter_values,
          steps: item.steps.map((step, index) => ({
            step_order: index + 1,
            step_type: step.step_type || "web",
            action: step.action,
            expected_result: step.expected_result
          }))
        }))
      });

      for(const item of response.created){if(item.pending_reference_attachment_ids?.length)setPendingAiEvidence(current=>[...current,{projectId,caseId:item.id,ids:item.pending_reference_attachment_ids!}]);}
      setAiPreviewCases([]);
      setAiPreviewMessage("");
      setIsAiStudioOpen(false);
      if (response.created[0]) {
        syncTestCaseSearchParams(response.created[0].id);
        setSelectedTestCaseId(response.created[0].id);
        setIsCreating(false);
      }
      showSuccess(`${acceptedPreviewCases.length} AI-designed test case${acceptedPreviewCases.length === 1 ? "" : "s"} accepted into the library.`);
      await refreshCases();
    } catch (error) {
      setAiPreviewTone("error");
      setAiPreviewMessage(formatAiStudioErrorMessage(error, "Unable to accept AI-generated test cases right now."));
    }
  };

	  const handleScheduleDesignedCases = async (authoringMode: "structured" | "gherkin" = "structured") => {
	    if (!canUseTestCaseAi || !canCreateTestCases) {
	      setAiPreviewTone("error");
	      setAiPreviewMessage(`Permission required: ${!canUseTestCaseAi ? "testcase.ai" : "testcase.create"}`);
	      return;
	    }

	    if (!appTypeId || !aiRequirementIds.length) {
	      setAiPreviewTone("error");
      setAiPreviewMessage("Select at least one story before scheduling AI generation.");
      return;
    }

    try {
      const promptFiles = await prepareAiPromptFiles({projectId,files:[...aiContextFiles,...aiReferenceImages.flatMap(image=>aiOriginalImagesRef.current.get(image.url)||[])],additionalContext:aiAdditionalContext});
      const response = await createGenerationJob.mutateAsync({
        app_type_id: appTypeId,
        requirement_ids: aiRequirementIds,
        integration_id: integrationId || undefined,
        max_cases_per_requirement: maxCases,
        parallel_requirement_limit: parallelRequirementLimit,
        authoring_mode: authoringMode,
        additional_context: promptFiles.additionalContext || undefined,
        external_links: parseExternalLinks(aiExternalLinksText),
        images: aiReferenceImages
      });

      setAiPreviewCases([]);
      setAiPreviewMessage("");
      setIsAiStudioOpen(false);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["ai-test-case-generation-jobs", appTypeId] }),
        queryClient.invalidateQueries({ queryKey: ["requirements", projectId] })
      ]);
      showSuccess(`${response.context_reduced ? `${response.context_reduction_reason} ` : ""}AI Test Cases Generation scheduled. Draft cases will appear in the library with accept and reject controls once processing completes.`);
    } catch (error) {
      setAiPreviewTone("error");
      setAiPreviewMessage(formatAiStudioErrorMessage(error, "Unable to schedule AI-generated test cases right now."));
    }
  };

	  const handleRunTestCase = async (testCaseId: string, mode?: "local" | "remote") => {
	    const catalogTestCase = testCases.find((item) => item.id === testCaseId)
        || selectedActionCaseSnapshotsRef.current.get(testCaseId);

		    const canRunSelectedMode = mode === "local"
		      ? canRunLocalAutomation
		      : mode === "remote"
		        ? canRunRemoteAutomation
		        : canCreateRuns;

		    if (!canRunSelectedMode) {
		      showError(
		        new Error(
		          mode === "local"
		            ? "Permission required: automation.run.local"
		            : mode === "remote"
		              ? "Permission required: automation.run.remote"
		              : "Permission required: run.create"
		        ),
		        "Unable to run test case"
		      );
		      return;
		    }

	    if (!session?.user.id) {
	      showError(new Error("You need an active session before running a test case."), "Unable to run test case");
      return;
    }

    if (!projectId || !appTypeId || !catalogTestCase) {
      showError(new Error("Select a project and app type before running a test case."), "Unable to run test case");
      return;
    }

    setSchedulerActionCaseId(testCaseId);
    setSchedulerActionKind(mode === "local" ? "run-local" : mode === "remote" ? "run-remote" : "run");

    try {
      const testCase = mode === "local"
        ? await ensureTestCaseDetail(testCaseId)
        : catalogTestCase;
      const resolvedRunDataSetId = selectedExecutionDataSetId || testCase.test_data_set_ids?.[0] || undefined;

      if (mode === "local") {
        const isApiOnlyLocalRun = testCase.api_only === true;

        if (testCase.automated !== "yes" && !isApiOnlyLocalRun) {
          showError(
            new Error("Local execution requires an automated browser case or an API-only case."),
            "Unable to run test case"
          );
          return;
        }

        const response = await createLocalRun.mutateAsync({
          project_id: projectId,
          app_type_id: appTypeId,
          test_case_ids: [testCaseId],
          assigned_to_ids: selectedExecutionAssigneeIds.length ? selectedExecutionAssigneeIds : undefined,
          release: canViewDeliveryScopes ? executionRelease.trim() || undefined : undefined,
          sprint: canViewDeliveryScopes ? executionSprint.trim() || undefined : undefined,
          build: executionBuild.trim() || undefined,
          name: `${testCase.title} ${isApiOnlyLocalRun ? "Local API Run" : "Local Run"}`,
	          created_by: session.user.id,
	          test_environment_id: can("environment.view") ? selectedExecutionEnvironmentId || undefined : undefined,
          test_configuration_id: can("configuration.view") ? selectedExecutionConfigurationId || undefined : undefined,
          test_data_set_id: resolvedRunDataSetId,
          engine_base_url: undefined
        });

        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ["executions"] }),
          queryClient.invalidateQueries({ queryKey: ["executions", projectId] }),
          queryClient.invalidateQueries({ queryKey: ["workspace-transactions"] })
        ]);

        navigate(`/executions?view=local-runs&execution=${response.id}&testCase=${testCaseId}`);
        if(response.acknowledgement === "unknown")showError(new Error(response.warnings?.[0] || "Inspect this run for incoming results before retrying."),"Local dispatch needs reconciliation");
        else showSuccess(`${isApiOnlyLocalRun ? "Local API run" : "Local run"} started for ${testCase.title}.`);
        return;
      }

      const response = await createExecution.mutateAsync({
        project_id: projectId,
        app_type_id: appTypeId,
        test_case_ids: [testCaseId],
        assigned_to_ids: selectedExecutionAssigneeIds.length ? selectedExecutionAssigneeIds : undefined,
        release: canViewDeliveryScopes ? executionRelease.trim() || undefined : undefined,
        sprint: canViewDeliveryScopes ? executionSprint.trim() || undefined : undefined,
	        build: executionBuild.trim() || undefined,
	        name: `${testCase.title} Run`,
	        created_by: session.user.id,
	        execution_mode: mode === "remote" ? "remote" : undefined,
	        test_environment_id: can("environment.view") ? selectedExecutionEnvironmentId || undefined : undefined,
        test_configuration_id: can("configuration.view") ? selectedExecutionConfigurationId || undefined : undefined,
        test_data_set_id: resolvedRunDataSetId
      });

      if (mode === "remote") {
        await api.executions.start(response.id, { execution_mode: "remote" });
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ["executions"] }),
          queryClient.invalidateQueries({ queryKey: ["executions", projectId] }),
          queryClient.invalidateQueries({ queryKey: ["workspace-transactions"] })
        ]);
        navigate(`/executions?view=suite-runs&execution=${response.id}&testCase=${testCaseId}`);
        showSuccess(`Remote run started for ${testCase.title}.`);
        return;
      }

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["executions"] }),
        queryClient.invalidateQueries({ queryKey: ["executions", projectId] })
      ]);

      navigate(`/executions?view=suite-runs&execution=${response.id}&testCase=${testCaseId}`);
      showSuccess(`Manual run created for ${testCase.title}.`);
    } catch (error) {
      showError(error, "Unable to run test case");
    } finally {
      setSchedulerActionCaseId("");
      setSchedulerActionKind("");
    }
  };

  const coverageMetrics = testCaseMetricsQuery.data?.coverage || {
    total: 0, covered: 0, automated: 0, automationKnown: 0, withHistory: 0, withSuites: 0
  };
  const testCaseCatalogMetrics = testCaseMetricsQuery.data?.catalog || {
    total: 0, automationPercent: 0, blocked: 0, critical: 0, failed: 0, averageExecutionMs: null,
    executionDurationSampleCount: 0, finalizedResults: 0, passedResults: 0, recentPassRate: null
  };
  const importRows = useMemo(
    () => importBatches.flatMap((batch) => batch.rows),
    [importBatches]
  );
  const importContainsProtectedAutomation = useMemo(
    () => importRows.some(importedRowHasProtectedAutomation),
    [importRows]
  );
  const importWarnings = useMemo(
    () =>
      [
        ...importBatches.flatMap((batch) =>
          batch.warnings.map((warning) => `${batch.fileName}: ${warning}`)
        ),
        ...importFileWarnings,
        ...(importContainsProtectedAutomation && !canEditAutomationCode
          ? ["Automation code or API requests were detected. Automation build and code access are required before this batch can be imported."]
          : [])
      ],
    [canEditAutomationCode, importBatches, importContainsProtectedAutomation, importFileWarnings]
  );
  const importStepCount = useMemo(
    () => importRows.reduce((total, row) => total + countImportedSteps(row), 0),
    [importRows]
  );
  const importFileCount = importBatches.length;
  const importFileName = useMemo(() => {
    if (!importBatches.length) {
      return "";
    }

    if (importBatches.length === 1) {
      return importBatches[0]?.fileName || "";
    }

    return `${importBatches[0]?.fileName || "Import batch"} + ${importBatches.length - 1} more`;
  }, [importBatches]);
  const importSourceSummary = useMemo(() => {
    if (!importBatches.length) {
      return "";
    }

    const uniqueSources = Array.from(new Set(importBatches.map((batch) => batch.source)));

    if (uniqueSources.length === 1) {
      return getTestCaseImportSourceLabel(uniqueSources[0] as TestCaseImportSource);
    }

    return "Mixed sources";
  }, [importBatches]);
  const isLibraryLoading = testCasesQuery.isLoading;
  const isTestCaseCatalogMetricLoading = !testCaseMetricsQuery.data;
const { computedCaseAiQualityScore, caseQualitySuggestions, testCaseReviewReadiness, selectedTestCaseAssuranceProposedChange, testCaseAssuranceRequestMatchesDraft, testCaseAssurancePreviewMatchesDraft, isTestCaseAssuranceDraftChanged, testCaseImpactRequestMatchesDraft, selectedTestCaseImpactPreview, runTestCaseImpactAnalysis, runTestCaseAssuranceAnalysis, openTestCaseImpactPreview, selectedHistory, selectedCaseHealthMetrics, authoredBehaviorUnitCount, selectedTestCaseAssurance, selectedTestCaseAssuranceSource } = useCaseHealth({ projectId, canViewTestData, canUseTestCaseAi, canViewAutomationCode, getPrompt, isCreating, caseDraft, linkedDataSetDraftIds, overrideSharedGroupData, testCaseParameterValues, stepDrafts, createSuiteContextId, setIsTestCaseImpactPreviewOpen, testCaseAssuranceIntegrationId, testCaseAssurancePromptGuidance, testCaseAssuranceContext, testCaseAssuranceContextBusy, selectedTestCaseResultsQuery, previewTestCaseImpact, previewTestCaseChangeImpact, requirements, suites, testCaseAssuranceDefaultIntegrationId, testCaseImpactDefaultIntegrationId, displaySteps, historyByCaseId, selectedTestCase, linkedDataSetSensitiveParameterNames, selectedReviewStatus, visibleTestCaseParameterValues });

  const selectedEditorSteps = useMemo(
    () => displaySteps.filter((step) => selectedStepIds.includes(step.id)),
    [displaySteps, selectedStepIds]
  );
  const stepBlocks = useMemo(() => {
    return mainSteps.reduce<Array<{
      key: string;
      group_id: string | null;
      group_name: string | null;
      group_kind: TestStep["group_kind"];
      reusable_group_id: string | null;
      steps: TestStep[];
    }>>((blocks, step) => {
      const previousBlock = blocks[blocks.length - 1];

      if (step.group_id && previousBlock?.group_id === step.group_id) {
        previousBlock.steps.push(step);
        return blocks;
      }

      blocks.push({
        key: step.group_id ? `group-${step.group_id}` : `step-${step.id}`,
        group_id: step.group_id || null,
        group_name: step.group_name || null,
        group_kind: step.group_kind || null,
        reusable_group_id: step.reusable_group_id || null,
        steps: [step]
      });

      return blocks;
    }, []);
  }, [mainSteps]);
  const stepGroupIds = useMemo(
    () => [...new Set(stepBlocks.map((block) => block.group_id).filter((groupId): groupId is string => Boolean(groupId)))],
    [stepBlocks]
  );
  const filteredSharedGroups = useMemo(() => {
    const search = sharedGroupSearchTerm.trim().toLowerCase();

    return sharedStepGroups.filter((group) => {
      if (!search) {
        return true;
      }

      return [group.name, group.description || "", ...group.steps.map((step) => `${step.action || ""} ${step.expected_result || ""}`)]
        .join(" ")
        .toLowerCase()
        .includes(search);
    });
  }, [sharedGroupSearchTerm, sharedStepGroups]);
  const selectedSharedGroups = selectedSharedGroupIds.flatMap((id) => {
    const group = sharedStepGroups.find((item) => item.id === id);
    return group ? [group] : [];
  });
  const isCaseWorkspaceOpen = Boolean(selectedTestCaseId) || isCreating;
  const stepCountLabel = `${mainSteps.length} step${mainSteps.length === 1 ? "" : "s"}`;
  const allStepsSelected = Boolean(mainSteps.length) && mainSteps.every((step) => selectedStepIds.includes(step.id));
  const dirtyStepIds = useMemo(
    () =>
      displaySteps
        .filter((step) => {
          const draft = stepDrafts[step.id];
          if (!draft) {
            return false;
          }
          return normalizeSharedGroupComparableText(draft.action) !== normalizeSharedGroupComparableText(step.action)
            || normalizeSharedGroupComparableText(draft.expected_result) !== normalizeSharedGroupComparableText(step.expected_result)
            || !areComparableStepAutomationEqual(draft, step);
        })
        .map((step) => step.id),
    [displaySteps, stepDrafts]
  );
  const dirtySelectedStepIds = selectedEditorSteps.map((step) => step.id).filter((id) => dirtyStepIds.includes(id));
  const selectionIsContinuous = isContinuousStepSelection(displaySteps, selectedStepIds);
  const selectionGroupId = selectedEditorSteps.length && selectedEditorSteps.every((step) => step.group_id && step.group_id === selectedEditorSteps[0]?.group_id)
    ? (selectedEditorSteps[0]?.group_id as string)
    : "";
  const selectionGroupKind = selectionGroupId ? (selectedEditorSteps[0]?.group_kind || null) : null;
  const selectionGroupContext = selectionGroupId ? stepInsertionContextFromStep(selectedEditorSteps[0]) : null;
  const canUngroupSelection = Boolean(selectionGroupId && selectionIsContinuous);
  const selectionMinOrder = selectedEditorSteps.length ? Math.min(...selectedEditorSteps.map((step) => step.step_order)) : null;
  const selectionMaxOrder = selectedEditorSteps.length ? Math.max(...selectedEditorSteps.map((step) => step.step_order)) : null;
  const selectionPasteAboveIndex = selectionMinOrder ? Math.max(0, selectionMinOrder - 1) : null;
  const selectionPasteBelowIndex = selectionMaxOrder ? selectionMaxOrder : null;
  const testCaseSaveBlockedReason = !caseDraft.title.trim()
    ? "Add a test case title before saving."
    : stepInsertIndex !== null
      ? "Save or cancel the open step draft before saving the test case."
      : "";
  const isTestCaseWorkspaceMutationPending =
    createTestCase.isPending
    || updateTestCase.isPending
    || updateStep.isPending
    || updateSuite.isPending
    || assignCasesToModule.isPending
    || removeCasesFromModule.isPending
    || deleteTestCase.isPending
    || isInsertingSharedGroups;
  const isTestCaseSaveDisabled =
    Boolean(testCaseSaveBlockedReason)
    || (isCreating ? !canCreateTestCases : !canUpdateTestCases || isSelectedTestCaseDetailPending || !selectedTestCase)
    || isTestCaseWorkspaceMutationPending;
  const editorStepActions: StepActionMenuAction[] = [
    {
      label: isCreating ? "Create test case" : "Save changes",
      description: testCaseSaveBlockedReason || (isCreating ? "Create this test case and keep the current draft steps." : "Save the case metadata and all step edits together."),
	      icon: <StepSaveIcon />,
	      onClick: () => void handleSaveCaseAndSteps(),
	      tone: "primary",
		      disabled: isTestCaseSaveDisabled
    },
    {
      label: "Expand all steps",
      description: "Open every step editor in the current case.",
      icon: <StepExpandAllIcon />,
      onClick: () => {
        setExpandedStepIds(displaySteps.map((step) => step.id));
        setExpandedStepGroupIds(stepGroupIds);
      },
      disabled: !displaySteps.length
    },
    {
      label: "Collapse all steps",
      description: "Close all expanded step editors.",
      icon: <StepCollapseAllIcon />,
      onClick: () => {
        setExpandedStepIds([]);
        setExpandedStepGroupIds([]);
      },
      disabled: !displaySteps.length
    },
    {
      label: "Copy selected steps",
      description: "Place the selected steps in the clipboard for reuse.",
      icon: <StepCopyIcon />,
      onClick: () => handleCopySteps(),
      disabled: !selectedEditorSteps.length
    },
    {
      label: "Cut selected steps",
      description: "Move the selected steps after you paste them into a new position.",
      icon: <StepCutIcon />,
      onClick: () => handleCutSteps(),
      disabled: !selectedEditorSteps.length
    },
    ...(copiedSteps.length && selectionPasteAboveIndex !== null
      ? [{
          label: "Paste above selection",
          description: "Insert the clipboard steps before the current selection.",
          icon: <StepPasteAboveIcon />,
          onClick: () => void handlePasteSteps(selectionPasteAboveIndex, selectionGroupContext)
        }, {
          label: "Paste below selection",
          description: "Insert the clipboard steps after the current selection.",
          icon: <StepPasteBelowIcon />,
          onClick: () => void handlePasteSteps(selectionPasteBelowIndex as number, selectionGroupContext)
        }]
      : copiedSteps.length
        ? [{
            label: copiedStepMode === "cut" ? "Paste cut steps" : "Paste copied steps",
            description: "Insert the clipboard steps at the active step insertion point.",
            icon: <StepPasteIcon />,
            onClick: () => void handlePasteSteps()
          }]
        : []),
    ...(canUngroupSelection
      ? [{
          label: "Ungroup selected",
          description: "Remove the current selection from its group while keeping the steps in place.",
          icon: <StepUngroupIcon />,
          onClick: () => void handleUngroupStepGroup(selectionGroupId, selectionGroupKind || undefined)
        }]
      : [{
          label: "Group selected steps",
          description: "Turn the current continuous selection into one local group or Shared Step Group.",
          icon: <StepGroupIcon />,
          onClick: handleOpenStepGroupModal,
          disabled: !selectedEditorSteps.length || !selectionIsContinuous
        }]),
    {
      label: "Delete selected steps",
      description: "Remove the selected steps from this test case.",
      icon: <StepDeleteIcon />,
      onClick: () => void handleDeleteSelectedSteps(),
      disabled: !selectedEditorSteps.length,
      tone: "danger"
    },
    {
      label: "Insert Shared Step Group",
      description: "Add a linked Shared Step Group into this test case.",
      icon: <StepSharedGroupIcon />,
      onClick: () => {
        setIsSharedGroupPickerOpen(true);
        setSelectedSharedGroupIds([]);
      },
      disabled: !appTypeId
    },
    {
      label: "Clear step selection",
      description: "Reset the current multi-step selection.",
      icon: <SelectionToggleIcon checked={false} />,
      onClick: () => setSelectedStepIds([]),
      disabled: !selectedEditorSteps.length
    }
  ];
  const readableCaseTitle = resolveStepParameterText(caseDraft.title, resolvedScopedParameterValues);
  const plainCaseDescription = richTextToPlainText(caseDraft.description);
  const readableCaseDescription = resolveStepParameterText(plainCaseDescription, resolvedScopedParameterValues);
  const hasReadableCasePreview = Boolean(
    detectedStepParameters.length
    || Object.keys(mergedScopedParameterValues).length
    || readableCaseTitle !== caseDraft.title
    || readableCaseDescription !== plainCaseDescription
  );
  const firstStepPreview = resolveStepParameterText(
    richTextToPlainText(mainSteps[0]?.action || mainSteps[0]?.expected_result || ""),
    resolvedScopedParameterValues
  );
  const caseSectionSummary = isCreating
    ? "Enter the reusable case details before saving it."
    : "Update the reusable test case definition, ownership, traceability, and references.";
  const stepSectionSummary = firstStepPreview
    ? `Starts with: ${firstStepPreview}`
    : isCreating
      ? "No draft steps added yet."
      : "No steps added yet for this test case.";
  const preconditionGroupContext: StepInsertionGroupContext = {
    group_id: preconditionSteps[0]?.group_id || `preconditions-${selectedTestCaseId || "draft"}`,
    group_name: "Preconditions",
    group_kind: "local",
    reusable_group_id: null
  };
  const automationSectionSummary = automationTargetCaseIds.length
    ? `${automationTargetCaseIds.length} case${automationTargetCaseIds.length === 1 ? "" : "s"} selected for AI automation or recorder capture.`
    : "Select a saved case to automate with AI or recorder capture.";
  const caseSectionTitleContent = isCreating ? "New test case" : "Case details";
  const historySectionSummary = selectedHistory.length
    ? "Review the latest recorded outcomes and preserved run evidence for this reusable test case."
    : "No run history has been recorded for this reusable test case yet.";
  const aiSelectedRequirements = useMemo(
    () => requirements.filter((requirement) => aiRequirementIds.includes(requirement.id)),
    [aiRequirementIds, requirements]
  );
  const aiExistingCases = useMemo(() => {
    if (!aiRequirementIds.length) {
      return [];
    }

    const requirementSet = new Set(aiRequirementIds);
    return testCases.filter((testCase) =>
      (testCase.requirement_ids || [testCase.requirement_id]).filter(Boolean).some((requirementId) => requirementSet.has(requirementId as string))
    );
  }, [aiRequirementIds, testCases]);
  const linkedPreviewCase = useMemo(
    () => testCases.find((testCase) => testCase.id === linkedPreviewCaseId) || null,
    [linkedPreviewCaseId, testCases]
  );
  const activeGenerationJobs = useMemo(
    () => generationJobs.filter((job): job is AiTestCaseGenerationJob => ["queued", "running"].includes(job.status)),
    [generationJobs]
  );
  const generationQueueSummary = useMemo(() => {
    if (activeGenerationJobs.length) {
      const processed = activeGenerationJobs.reduce((total, job) => total + job.processed_requirements, 0);
      const total = activeGenerationJobs.reduce((count, job) => count + job.total_requirements, 0);

      return {
        tone: "success" as const,
        title: `${activeGenerationJobs.length} AI generation job${activeGenerationJobs.length === 1 ? "" : "s"} in progress`,
        detail: `${processed} of ${total} ${total === 1 ? "story" : "stories"} processed in the current app type.`
      };
    }

    return null;
  }, [activeGenerationJobs]);

  const openExistingCaseFromAi = (testCaseId: string) => setLinkedPreviewCaseId(testCaseId);
  const closeCaseWorkspace = () => {
    syncTestCaseSearchParams(null);
    setCreateSuiteContextId("");
    setIsCreating(false);
    setCaseDeliveryRelease("");
    setCaseDeliverySprint("");
    setSelectedTestCaseId("");
    setCaseDraft(emptyCaseDraft);
    setNewStepDraft(EMPTY_STEP_DRAFT);
    setStepInsertIndex(null);
    setStepInsertGroupContext(null);
    setDraftSteps([]);
    setSelectedStepIds([]);
    setExpandedStepIds([]);
    setExpandedStepGroupIds([]);
    setExpandedSections(createDefaultTestCaseSections());
    setIsStepGroupModalOpen(false);
    setStepGroupName("");
    setSaveAsReusableGroup(false);
    setIsSharedGroupPickerOpen(false);
    setSelectedSharedGroupIds([]);
    setSharedGroupSearchTerm("");
    setTestCaseParameterValues({});
    setIsCaseParameterDialogOpen(false);
    setIsAiCaseAuthoringOpen(false);
    setAiCaseAuthoringRequirementId("");
    setAiCaseAuthoringPreview(null);
    setAiCaseAuthoringMessage("");
  };

  const handleWorkspaceBack = () => {
    closeCaseWorkspace();
  };

  const isSelectedCaseRunning =
    Boolean(selectedTestCase?.id)
    && schedulerActionCaseId === selectedTestCase?.id
    && schedulerActionKind === "run";
  const isSelectedCaseLocalRunning =
    Boolean(selectedTestCase?.id)
    && schedulerActionCaseId === selectedTestCase?.id
    && schedulerActionKind === "run-local";
  const isSelectedCaseRemoteRunning =
    Boolean(selectedTestCase?.id)
    && schedulerActionCaseId === selectedTestCase?.id
    && schedulerActionKind === "run-remote";
	  const isSelectedCasePureApi = selectedTestCase?.api_only === true;
	  const canSelectedCaseRunLocally = Boolean(selectedTestCase && (selectedTestCase.automated === "yes" || isSelectedCasePureApi));
	  const isSelectedCaseManualRunDisabled = isSelectedCaseRunning || !canCreateRuns || !projectId || !appTypeId || !session?.user.id;
	  const isSelectedCaseLocalRunDisabled =
	    !selectedTestCase
	    || isSelectedCaseLocalRunning
	    || createLocalRun.isPending
	    || !canRunLocalAutomation
	    || !canSelectedCaseRunLocally
	    || !supportsLocalDesktopExecution
    || !projectId
    || !appTypeId
    || !session?.user.id;
  const isSelectedCaseRemoteRunDisabled =
	    !selectedTestCase
	    || isSelectedCaseRemoteRunning
	    || !canRunRemoteAutomation
	    || selectedTestCase.automated !== "yes"
    || selectedTestCase.automation_status === "incomplete"
    || !projectId
    || !appTypeId
    || !session?.user.id;
  const selectedCaseLocalRunLabel = isSelectedCasePureApi ? "Run API locally" : "Run local Playwright";
  const caseHeaderSecondaryActions: StepActionMenuAction[] = [
    ...(selectedTestCase && canPreviewAutomationCode
      ? [{
          label: "Preview execution script",
          description: "Open the consolidated automation script without leaving the case.",
          icon: <AutomationCodeIcon />,
          onClick: () => openCaseAutomationPreview(),
          disabled: !mainSteps.length
        }]
      : []),
  ];
  const caseHeaderActions = (
    <div className="panel-head-actions-row test-case-workspace-commandbar">
        <div className="test-case-workspace-identity">
          <WorkspaceBackButton disabled={isTestCaseWorkspaceMutationPending} label="Back to test case tiles" onClick={handleWorkspaceBack} />
        {isCreating ? (
          <span className="test-case-workspace-draft-badge">New</span>
        ) : selectedCaseDisplayId ? (
          <span className="test-case-workspace-record-id test-case-identity">
            <TestCaseIcon size={15} strokeWidth={1.8} />
            <DisplayIdBadge value={selectedCaseDisplayId} />
          </span>
        ) : null}
        <h1 className="test-case-workspace-title" title={(isCreating ? caseDraft.title : readableCaseTitle).trim() || undefined}>
          {(isCreating ? caseDraft.title : readableCaseTitle).trim() || (isCreating ? "Untitled test case" : isSelectedTestCaseDetailPending ? "Loading test case…" : "Test case")}
        </h1>
      </div>

        <div
          {...(isTestCaseWorkspaceMutationPending ? ({ inert: "" } as Record<string, string>) : {})}
          aria-busy={isTestCaseWorkspaceMutationPending}
          className="test-case-workspace-primary-actions"
        >
        {selectedTestCase ? (
          <button
            aria-label={isVisualBuilderActive ? "Step list" : "Visual builder"}
            className="ghost-button test-case-workspace-icon-action test-case-workspace-named-action"
            onClick={() => setIsVisualBuilderActive((current) => !current)}
            title={isVisualBuilderActive ? "Step list" : "Visual builder"}
            type="button"
          >
            {isVisualBuilderActive ? <TileCardStepsIcon /> : <TestCaseFlowMapIcon />}
            <span>{isVisualBuilderActive ? "Step list" : "Visual builder"}</span>
          </button>
        ) : null}
        {isCaseWorkspaceOpen && canUseTestCaseAi ? (
          <button
            className="ghost-button test-case-workspace-named-action"
            disabled={!appTypeId || !integrations.length}
            onClick={openAiCaseAuthoring}
            title="Author manual test steps with AI"
            type="button"
          >
            <TestCaseSparkIcon />
            <span>AI Improve Test Cases</span>
          </button>
        ) : null}
        {isCaseWorkspaceOpen ? (
          <button
            className="ghost-button test-case-workspace-named-action"
            onClick={() => setIsCaseParameterDialogOpen(true)}
            type="button"
          >
            <StepParameterIcon />
            <span>{detectedStepParameters.length ? `Test Params · ${detectedStepParameters.length}` : "Test Params"}</span>
          </button>
        ) : null}
        {selectedTestCase ? (
          <div className="test-case-workspace-run-action">
            <TestCaseSplitActionButton
              actions={[]}
              disabled={isSelectedCaseManualRunDisabled}
              icon={<TestCaseRunIcon />}
              label={isSelectedCaseRunning ? "Creating…" : "Run manually"}
              menuLabel="Open run options"
              onClick={() => openRunBuilder([selectedTestCase.id])}
              tone="green"
            />
          </div>
        ) : null}
        {caseHeaderSecondaryActions.map((action) => (
          <button
            className="ghost-button test-case-workspace-named-action"
            disabled={action.disabled}
            key={action.label}
            onClick={action.onClick}
            title={action.description || action.label}
            type="button"
          >
            {action.icon}
            <span>{action.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
  const getRequirementTitleForCase = (testCase: TestCase) => {
    const linkedRequirementId = (testCase.requirement_ids || [testCase.requirement_id]).find(Boolean);
    if (!linkedRequirementId) return "";
    const linked = testCase.linked_requirements?.find((story) => story.id === linkedRequirementId);
    return linked?.title || requirementTitleById[linkedRequirementId] || "Linked Story";
  };
  const openLibraryCase = (testCaseId: string) => {
    openTestCaseWorkspace(testCaseId);
    setIsCreating(false);
    setDraftSteps([]);
  };
  const openLatestFailureRun = async (testCaseId: string) => {
    const latestFailure = (historyByCaseId[testCaseId] || [])
      .find((result) => ["failed", "blocked"].includes(String(result.status || "").toLowerCase()));

    if (!latestFailure) {
      openLibraryCase(testCaseId);
      return;
    }

    try {
      const execution = executions.find((item) => item.id === latestFailure.execution_id)
        || await api.executions.get(latestFailure.execution_id);
      const runView = execution?.trigger === "local"
        ? "local-runs"
        : execution?.suite_ids?.length || latestFailure.suite_id
          ? "suite-runs"
          : "suite-runs";

      navigate(`/executions?view=${runView}&execution=${latestFailure.execution_id}&testCase=${testCaseId}`);
    } catch (error) {
      showError(error, "Unable to open the latest failure run");
    }
  };

  const renderAiGeneratedDecision = (testCase: TestCase) => (
    <span className={testCase.ai_generation_source ? "decision-status is-yes" : "decision-status is-no"}>
      {testCase.ai_generation_source ? <TestCaseAcceptIcon /> : <TestCaseRejectIcon />}
      <span>{testCase.ai_generation_source ? "Yes" : "No"}</span>
    </span>
  );

  const renderReviewDecision = (testCase: TestCase, iconOnly = false) => {
    if (testCase.detail_complete === false && testCase.summary_complete !== true) {
      return <DeferredTestCaseCatalogValue field="review status" />;
    }
    if (canUpdateTestCases && ownsCaseReview(testCase, reviewUserId) && isPendingCaseReview(testCase)) {
      const isSaving = reviewingCaseIds.includes(testCase.id);
      return (
        <div className={`yes-no-action-row test-case-review-actions${iconOnly ? " is-icon-only" : ""}`} onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
          <button aria-label={`Approve review for ${testCase.title}`} className="decision-button is-yes"
            disabled={isSaving} onClick={() => void handleSubmitReviewForCase(testCase.id, "accepted", "", testCase)} title="Approve review" type="button">
            <TestCaseAcceptIcon />{!iconOnly ? <span>Approve</span> : null}
          </button>
          <button aria-label={`Request changes for ${testCase.title}`} className="decision-button is-no"
            disabled={isSaving} onClick={() => openReviewSuggestionDialog(testCase.id, "", testCase)} title="Request changes" type="button">
            <TestCaseRejectIcon />{!iconOnly ? <span>Reject</span> : null}
          </button>
        </div>
      );
    }
    return iconOnly ? null : TEST_CASE_REVIEW_STATUS_LABELS[isPendingCaseReview(testCase) ? "pending" : testCase.review_status || "not_requested"];
  };
const { testCaseListColumns, renderTestCaseRowActions, testCaseListRowGroups } = useCaseLibraryTable({ navigate, session, projectId, appTypeId, canDeleteTestCases, canCreateRuns, canUseAutomationWorkspace, canRunLocalAutomation, isReviewQueueOpen, reviewingCaseIds, selectedActionTestCaseIds, setSelectedActionTestCaseIds, isUnassignedModuleExpanded, setIsUnassignedModuleExpanded, selectedModuleIds, catalogFilterKey, isCatalogFiltered, isModuleExpanded, testCaseMetricsQuery, testCasesQuery, modulePageStateById, retryModulePage, toggleModuleExpansion, isDeletingSelectedTestCases, setHealthModuleId, deletingModuleId, renamingModuleId, setRenamingModuleId, renamingModuleName, setRenamingModuleName, draggingCaseIds, defaultTestCaseStatus, defaultTestCaseAutomated, schedulerActionCaseId, schedulerActionKind, createTestCase, createLocalRun, deleteTestCase, userById, beginCreateCase, historyByCaseId, sharedGroupNameById, stepCountByCaseId, requirementTitleById, caseModuleById, moduleCaseGroups, visibleModuleCaseGroups, moduleHealth, renderModuleMetrics, renderDeferredModuleMetrics, hasCompleteModuleMetrics, renderModuleLoadMoreFooter, selectableFilteredCases, unassignedCaseIds, areAllFilteredCasesSelected, areAllUnassignedCasesSelected, setTestCaseIdsSelected, setAllFilteredTestCaseItemsSelected, setModuleSelected, setUnassignedTestCasesSelected, testCaseApiOnlyState, openRunBuilder, handleDropCaseOnModule, getTestCaseDropState, handleRenameModule, handleDeleteModule, openSuiteTransferModal, exportCasesToCsv, handleCloneCase, handleDeleteCaseItem, handleRunTestCase, getRequirementTitleForCase, openLibraryCase, openLatestFailureRun, renderAiGeneratedDecision, renderReviewDecision });


  const isMatchingStepInsertContext = (groupContext: StepInsertionGroupContext | null = null) =>
    (stepInsertGroupContext?.group_id || null) === (groupContext?.group_id || null);

  const renderStepInsertSlot = (index: number, groupContext: StepInsertionGroupContext | null = null) => (
    <InlineStepInsertSlot
      availableParameters={detectedStepParameters}
      parameterValues={resolvedScopedParameterValues}
      draft={newStepDraft}
      index={index}
      isActive={stepInsertIndex === index && isMatchingStepInsertContext(groupContext)}
      onCancel={cancelStepInsert}
      onChange={setNewStepDraft}
      onSubmit={(event) => void handleCreateStep(event)}
    />
  );

  const openStepInspect = (step: TestStep) => {
    if (isCreating) {
      showError(new Error("Save the test case before recording an action for this step."), "Unable to inspect draft step");
      return;
    }

    if (recorderSession) {
      showError(new Error("Stop the active recorder session before inspecting another step."), "Unable to start step inspection");
      return;
    }

    setInspectingStepId(step.id);
  };

  const renderStepCard = (
    step: TestStep,
    index: number,
    groupContext: StepInsertionGroupContext | null = null,
    sectionSteps: TestStep[] = displaySteps,
    usePlainCardAppearance = false
  ) => {
    const insertAboveIndex = Math.max(0, step.step_order - 1);
    const insertBelowIndex = step.step_order;
    const stepDraft = stepDrafts[step.id] || {
      action: step.action || "",
      expected_result: step.expected_result || "",
      step_type: normalizeStepType(step.step_type),
      automation_code: normalizeAutomationCode(step.automation_code),
      api_request: normalizeApiRequest(step.api_request)
    };
    const previousStep = sectionSteps[index - 1];
    const nextStep = sectionSteps[index + 1];
    const canMoveUp = step.group_id ? Boolean(previousStep && previousStep.group_id === step.group_id) : index > 0;
    const canMoveDown = step.group_id ? Boolean(nextStep && nextStep.group_id === step.group_id) : index < sectionSteps.length - 1;

    if (isCreating) {
      return (
        <DraftStepCard
          showAutomationTools={false}
          showRecorderTools={false}
          displayLabel={usePlainCardAppearance ? `S${index + 1}` : undefined}
          parameterValues={parameterValuesForStep(step)}
          availableParameters={detectedStepParameters}
          canPaste={Boolean(copiedSteps.length)}
          canMoveDown={canMoveDown}
          canMoveUp={canMoveUp}
          isExpanded={expandedStepIds.includes(step.id)}
          isRephrasing={rephrasingStepId === step.id}
          isSelected={selectedStepIds.includes(step.id)}
          onChange={(input) => handleUpdateDraftStep(step.id, input)}
          onCopy={() => handleCopySteps([step.id])}
          onCut={() => handleCutSteps([step.id])}
          onDelete={() => void handleDeleteStep(step.id)}
          onInsertAbove={() => activateStepInsert(insertAboveIndex, groupContext)}
          onInsertBelow={() => activateStepInsert(insertBelowIndex, groupContext)}
          onMoveDown={() => handleReorderDraftStep(step.id, "down")}
          onMoveUp={() => handleReorderDraftStep(step.id, "up")}
          onChangeStepType={(nextType) => void handleChangeStepType(step.id, nextType)}
          onEditAutomation={() => setEditingAutomationStepId(step.id)}
          onInspect={() => openStepInspect(step)}
          onRephrase={() => void handleRephraseStepWithAi(step)}
          onPasteAbove={() => void handlePasteSteps(insertAboveIndex, groupContext)}
          onPasteBelow={() => void handlePasteSteps(insertBelowIndex, groupContext)}
          onToggle={() =>
            setExpandedStepIds((current) =>
              current.includes(step.id) ? current.filter((id) => id !== step.id) : [...current, step.id]
            )
          }
          onToggleSelect={(checked) =>
            setSelectedStepIds((current) =>
              checked ? [...new Set([...current, step.id])] : current.filter((id) => id !== step.id)
            )
          }
          step={{
            id: step.id,
            step_order: step.step_order,
            action: step.action || "",
            expected_result: step.expected_result || "",
            step_type: normalizeStepType(step.step_type),
            automation_code: normalizeAutomationCode(step.automation_code),
            api_request: normalizeApiRequest(step.api_request),
            group_id: step.group_id || null,
            group_name: step.group_name || null,
            group_kind: usePlainCardAppearance ? null : step.group_kind || null,
            reusable_group_id: step.reusable_group_id || null
          }}
        />
      );
    }

      return (
        <EditableStepCard
          showAutomationTools={false}
          showRecorderTools={false}
          displayLabel={usePlainCardAppearance ? `S${index + 1}` : undefined}
          parameterValues={parameterValuesForStep(step)}
          availableParameters={detectedStepParameters}
          canPaste={Boolean(copiedSteps.length)}
        canMoveDown={canMoveDown}
        canMoveUp={canMoveUp}
        draft={stepDraft}
        isExpanded={expandedStepIds.includes(step.id)}
        isRephrasing={rephrasingStepId === step.id}
        isSelected={selectedStepIds.includes(step.id)}
        onChangeStepType={(nextType) => void handleChangeStepType(step.id, nextType)}
        onCopy={() => handleCopySteps([step.id])}
        onCut={() => handleCutSteps([step.id])}
        onDelete={() => void handleDeleteStep(step.id)}
        onEditAutomation={() => setEditingAutomationStepId(step.id)}
        onInspect={() => openStepInspect(step)}
        onRephrase={() => void handleRephraseStepWithAi(step)}
        onInsertAbove={() => activateStepInsert(insertAboveIndex, groupContext)}
        onInsertBelow={() => activateStepInsert(insertBelowIndex, groupContext)}
        onMoveDown={() => void handleReorderStep(step.id, "down")}
        onMoveUp={() => void handleReorderStep(step.id, "up")}
        onPasteAbove={() => void handlePasteSteps(insertAboveIndex, groupContext)}
        onPasteBelow={() => void handlePasteSteps(insertBelowIndex, groupContext)}
        onSave={(input) => void handleUpdateStep(step, input)}
        onDraftChange={(input) =>
          setStepDrafts((current) => ({
            ...current,
            [step.id]: input
          }))
        }
        onToggle={() =>
          setExpandedStepIds((current) =>
            current.includes(step.id) ? current.filter((id) => id !== step.id) : [...current, step.id]
          )
        }
        onToggleSelect={(checked) =>
          setSelectedStepIds((current) =>
            checked ? [...new Set([...current, step.id])] : current.filter((id) => id !== step.id)
          )
        }
        step={usePlainCardAppearance ? { ...step, group_kind: null } : step}
      />
    );
  };

  const editingAutomationStep = editingAutomationStepId
    ? displaySteps.find((step) => step.id === editingAutomationStepId) || null
    : null;
  const inspectingStep = inspectingStepId
    ? displaySteps.find((step) => step.id === inspectingStepId) || null
    : null;

	  const openCaseAutomationPreview = () => {
	    if (!canPreviewAutomationCode) {
	      showError(new Error("Permission and feature access required: automation.preview"), "Unable to open automation code");
	      return;
	    }

	    setCodePreviewState({
	      title: "Test case automation",
      subtitle: "This consolidated view is read-only here. Edit automation from individual steps.",
      code: buildCaseAutomationCode(caseDraft.title || selectedTestCase?.title || "Test case", displaySteps),
      objectRepository: automationLearningCache
    });
  };

	  const openGroupAutomationPreview = (groupName: string, groupSteps: TestStep[]) => {
	    if (!canPreviewAutomationCode) {
	      showError(new Error("Permission and feature access required: automation.preview"), "Unable to open automation code");
	      return;
	    }

	    setCodePreviewState({
      title: `${groupName} automation`,
      subtitle: "This consolidated group view is read-only. Update code from the steps inside the group.",
      code: buildGroupAutomationCode(groupName, groupSteps),
      objectRepository: automationLearningCache
    });
  };

  const handleChangeStepType = async (stepId: string, nextType: TestStep["step_type"]) => {
    const targetStep = displaySteps.find((step) => step.id === stepId);

    if (!targetStep || !nextType) {
      return;
    }

    if (isCreating) {
      setDraftSteps((current) =>
        current.map((step) =>
          step.id === stepId
            ? {
                ...step,
                step_type: normalizeStepType(nextType)
              }
            : step
        )
      );
      setStepDrafts((current) => ({
        ...current,
        [stepId]: {
          ...(current[stepId] || {
            action: targetStep.action || "",
            expected_result: targetStep.expected_result || "",
            automation_code: normalizeAutomationCode(targetStep.automation_code),
            api_request: normalizeApiRequest(targetStep.api_request),
            step_type: normalizeStepType(targetStep.step_type)
          }),
          step_type: normalizeStepType(nextType)
        }
      }));
      return;
    }

    try {
      await updateStep.mutateAsync({
        id: stepId,
        input: {
          step_type: normalizeStepType(nextType)
        }
      });
      setStepDrafts((current) => ({
        ...current,
        [stepId]: {
          ...(current[stepId] || {
            action: targetStep.action || "",
            expected_result: targetStep.expected_result || "",
            automation_code: normalizeAutomationCode(targetStep.automation_code),
            api_request: normalizeApiRequest(targetStep.api_request),
            step_type: normalizeStepType(targetStep.step_type)
          }),
          step_type: normalizeStepType(nextType)
        }
      }));
      await queryClient.invalidateQueries({ queryKey: ["test-case-steps", selectedTestCaseId] });
      if (targetStep.reusable_group_id) {
        await refreshSharedGroups();
      }
    } catch (error) {
      showError(error, "Unable to update step type");
    }
  };

  const handleSaveStepAutomation = async (
    stepId: string,
    input: { step_type: TestStep["step_type"]; automation_code: string; api_request: TestStep["api_request"] }
  ) => {
    if (!canEditAutomationCode) {
      showError(new Error("Permission required: automation.build and automation.code.view"), "Unable to save automation");
      return;
    }
    const targetStep = displaySteps.find((step) => step.id === stepId);

    if (!targetStep || !input.step_type) {
      return;
    }

    const nextDraft = {
      ...(stepDrafts[stepId] || {
        action: targetStep.action || "",
        expected_result: targetStep.expected_result || "",
        step_type: normalizeStepType(targetStep.step_type),
        automation_code: normalizeAutomationCode(targetStep.automation_code),
        api_request: normalizeApiRequest(targetStep.api_request)
      }),
      step_type: normalizeStepType(input.step_type),
      automation_code: normalizeAutomationCode(input.automation_code),
      api_request: normalizeApiRequest(input.api_request)
    };

    if (isCreating) {
      setDraftSteps((current) =>
        current.map((step) =>
          step.id === stepId
            ? {
                ...step,
                step_type: nextDraft.step_type,
                automation_code: nextDraft.automation_code,
                api_request: nextDraft.api_request
              }
            : step
        )
      );
      setStepDrafts((current) => ({
        ...current,
        [stepId]: nextDraft
      }));
      if (stepHasAutomation(nextDraft)) {
        setCaseDraft((current) => ({ ...current, automated: "yes" }));
      }
      setEditingAutomationStepId("");
      showSuccess("Step automation updated.");
      return;
    }

    try {
      const didSave = await handleSaveCaseAndSteps(
        { [stepId]: nextDraft },
        "Automation and all current test case edits saved."
      );

      if (!didSave) {
        return;
      }

      if (selectedTestCase && stepHasAutomation(nextDraft)) {
        await api.testCases.update(selectedTestCase.id, {
          automated: "yes",
          automation_status: "ready"
        });
        setCaseDraft((current) => ({ ...current, automated: "yes" }));
      }
      setStepDrafts((current) => ({
        ...current,
        [stepId]: nextDraft
      }));
      setEditingAutomationStepId("");
      await refreshCases();
    } catch (error) {
      showError(error, "Unable to update step automation");
    }
  };

  return (
    <div className={["page-content", "page-content--library-full", "page-content--test-cases", isCaseWorkspaceOpen ? "page-content--workspace-focus" : ""].join(" ")}>
      {confirmationDialog}
      {pendingAiEvidence.filter(item=>item.projectId===projectId).map(item=><div key={item.caseId} className="inline-message error-message" role="alert">The Test Case was saved, but {item.ids.length} reference file{item.ids.length===1?'':'s'} still need to be attached.
        <button className="ghost-button compact" type="button" onClick={()=>void retainAiEvidence(item.caseId,item.ids,item.projectId)}>Retry evidence upload</button>
      </div>)}
      {healthModule && testCaseMetricsQuery.data ? <EntityHealthDialog
        entityType="Module"
        entityName={healthModule.name}
        metrics={moduleHealthMetrics(healthModule.health)}
        summary={isReviewQueueOpen ? "Scope: Test Cases assigned to you for review in this module. Metrics include all matching cases, across every page." : "Scope: non-automated Test Cases in this module. Metrics include all pages and remain independent of search and expanded cases."}
        onClose={() => setHealthModuleId(null)}
      /> : null}
      <PageHeader
        className={["page-header--test-cases", isCaseWorkspaceOpen ? "page-header--workspace-context" : ""].filter(Boolean).join(" ")}
        eyebrow="Test Authoring"
        title="Test Case Library"
        description="Build reusable coverage with clear preconditions, structured or Gherkin steps, Story traceability, Suite linkage, and run-ready evidence."
      />
      {!isCaseWorkspaceOpen && !workflowReviewScope ? (
        <>
          {testCaseMetricsQuery.isError ? (
            <div className="inline-message error-message" role="alert">Metrics could not be refreshed.
              <button className="ghost-button compact" onClick={() => void testCaseMetricsQuery.refetch()} type="button">Retry</button>
            </div>
          ) : null}
          <QualityMetricStrip
            ariaLabel="Test case library quality metrics"
            metrics={[
              {
                label: "Catalog cases",
                criteriaKey: "metric.project.case_catalog",
                population: "project_catalog_cases", unit: "cases",
                value: isTestCaseCatalogMetricLoading ? "—" : testCaseCatalogMetrics.total,
                detail: isTestCaseCatalogMetricLoading
                  ? "Loading catalog"
                  : `${libraryScope === "both" ? "Manual and automation" : libraryScope === "manual" ? "Manual" : "Automation"} catalog identities · ${coverageMetrics.covered} linked to Stories`
              },
              ...(canViewAutomationInsights ? [{
                label: "Automation coverage", criteriaKey: libraryScope === "manual" ? "metric.library.automation_coverage" : "metric.catalog.linked_automation_coverage",
                value: isTestCaseCatalogMetricLoading ? "—" : `${testCaseCatalogMetrics.automationPercent}%`,
                detail: isTestCaseCatalogMetricLoading
                  ? "Loading summaries"
                  : `${coverageMetrics.automated} automated of ${coverageMetrics.automationKnown} evaluated cases`,
                progress: isTestCaseCatalogMetricLoading ? null : testCaseCatalogMetrics.automationPercent,
                tone: "info" as const
              }] : []),
              {
                label: "Pending Review",
                value: reviewSummaryQuery.isPending || reviewSummaryQuery.isError ? "—" : overallPendingReviewCount,
                detail: reviewSummaryQuery.isError ? "Unable to load pending reviews"
                  : reviewSummaryQuery.isPending ? "Loading pending reviews"
                  : "All pending reviews across the selected application",
                tone: overallPendingReviewCount ? "info" : "neutral"
              },
              {
                label: "Recent outcome pass rate",
                criteriaKey: "metric.library.recent_pass_rate",
                value: !canViewExecutionInsights || isTestCaseCatalogMetricLoading || testCaseCatalogMetrics.recentPassRate === null ? "—" : `${testCaseCatalogMetrics.recentPassRate}%`,
                detail: !canViewExecutionInsights
                  ? "Run result access required"
                  : isTestCaseCatalogMetricLoading
                  ? "Loading recent results"
                  : testCaseCatalogMetrics.finalizedResults
                  ? `${testCaseCatalogMetrics.passedResults} of ${testCaseCatalogMetrics.finalizedResults} passed`
                  : "No recent runs",
                tone: testCaseCatalogMetrics.recentPassRate === null ? "neutral" : "success"
              },
              {
                label: "Failed or Blocked Cases",
                value: !canViewExecutionInsights || isTestCaseCatalogMetricLoading ? "—" : testCaseCatalogMetrics.failed + testCaseCatalogMetrics.blocked,
                detail: !canViewExecutionInsights
                  ? "Run result access required"
                  : isTestCaseCatalogMetricLoading
                  ? "Loading recent results"
                  : `${testCaseCatalogMetrics.blocked} blocked · ${testCaseCatalogMetrics.failed} failed · latest finalized outcome per case`,
                tone: !canViewExecutionInsights || isTestCaseCatalogMetricLoading ? "neutral" : testCaseCatalogMetrics.failed + testCaseCatalogMetrics.blocked > 0 ? "danger" : "neutral"
              }
            ]}
          />
        </>
      ) : null}

      <ToastMessage message={message} onDismiss={() => setMessage("")} tone={messageTone} />

      {generationQueueSummary ? (
        <div className="inline-message success-message">
          <strong>{generationQueueSummary.title}</strong>
          <span>{generationQueueSummary.detail}</span>
        </div>
      ) : null}

      <WorkspaceMasterDetail
        browseView={
<CaseLibraryView setSearchParams={setSearchParams} workflowReviewScope={workflowReviewScope} session={session} projectId={projectId} appTypeId={appTypeId} canCreateTestCases={canCreateTestCases} canImportTestCases={canImportTestCases} canUpdateTestCases={canUpdateTestCases} canDeleteTestCases={canDeleteTestCases} canExportTestCases={canExportTestCases} canUseTestCaseAi={canUseTestCaseAi} canCreateSuites={canCreateSuites} canUpdateSuites={canUpdateSuites} canCreateRuns={canCreateRuns} canUseAutomationWorkspace={canUseAutomationWorkspace} reviewScopeKey={reviewScopeKey} setReviewQueueScope={setReviewQueueScope} isReviewQueueOpen={isReviewQueueOpen} reviewingCaseIds={reviewingCaseIds} isBulkReviewRunning={isBulkReviewRunning} setIsBulkReviewRejectOpen={setIsBulkReviewRejectOpen} setBulkReviewError={setBulkReviewError} selectedTestCaseId={selectedTestCaseId} searchTerm={searchTerm} setSearchTerm={setSearchTerm} catalogViewMode={catalogViewMode} setCatalogViewMode={setCatalogViewMode} isCatalogViewPending={isCatalogViewPending} startCatalogViewTransition={startCatalogViewTransition} visibleTestCaseCount={visibleTestCaseCount} setVisibleTestCaseCount={setVisibleTestCaseCount} caseStatusFilter={caseStatusFilter} setCaseStatusFilter={setCaseStatusFilter} casePriorityFilter={casePriorityFilter} setCasePriorityFilter={setCasePriorityFilter} caseStepFilter={caseStepFilter} setCaseStepFilter={setCaseStepFilter} caseRunFilter={caseRunFilter} setCaseRunFilter={setCaseRunFilter} selectedActionTestCaseIds={selectedActionTestCaseIds} setSelectedActionTestCaseIds={setSelectedActionTestCaseIds} setExpandedModuleIds={setExpandedModuleIds} isUnassignedModuleExpanded={isUnassignedModuleExpanded} setIsUnassignedModuleExpanded={setIsUnassignedModuleExpanded} setModulePageCursorsById={setModulePageCursorsById} selectedModuleIds={selectedModuleIds} setSelectedModuleIds={setSelectedModuleIds} libraryScope={libraryScope} setLibraryScope={setLibraryScope} catalogFilterKey={catalogFilterKey} isCatalogFiltered={isCatalogFiltered} isModuleExpanded={isModuleExpanded} testCaseMetricsQuery={testCaseMetricsQuery} testCasesQuery={testCasesQuery} modulePageStateById={modulePageStateById} retryModulePage={retryModulePage} toggleModuleExpansion={toggleModuleExpansion} testCaseModules={testCaseModules} isCreating={isCreating} isDeletingSelectedTestCases={isDeletingSelectedTestCases} setIsCreateSuiteModalOpen={setIsCreateSuiteModalOpen} setIsCreateModuleModalOpen={setIsCreateModuleModalOpen} setModuleDraftInitialCaseIds={setModuleDraftInitialCaseIds} setModuleAssignmentRetry={setModuleAssignmentRetry} setHealthModuleId={setHealthModuleId} deletingModuleId={deletingModuleId} renamingModuleId={renamingModuleId} setRenamingModuleId={setRenamingModuleId} renamingModuleName={renamingModuleName} setRenamingModuleName={setRenamingModuleName} draggingCaseIds={draggingCaseIds} setDraggingCaseIds={setDraggingCaseIds} defaultTestCaseStatus={defaultTestCaseStatus} setIsImportModalOpen={setIsImportModalOpen} setImportBatches={setImportBatches} setImportFileWarnings={setImportFileWarnings} setImportSourceSelection={setImportSourceSelection} schedulerActionCaseId={schedulerActionCaseId} schedulerActionKind={schedulerActionKind} reviewSummaryQuery={reviewSummaryQuery} pendingReviewCount={pendingReviewCount} createTestCase={createTestCase} assignCasesToModule={assignCasesToModule} deleteTestCase={deleteTestCase} testCases={testCases} beginCreateCase={beginCreateCase} historyByCaseId={historyByCaseId} stepCountByCaseId={stepCountByCaseId} requirementTitleById={requirementTitleById} requirementDisplayIdById={requirementDisplayIdById} caseStatusOptions={caseStatusOptions} casePriorityOptions={casePriorityOptions} caseModuleById={caseModuleById} filteredCases={filteredCases} hasActiveCaseCatalogFilter={hasActiveCaseCatalogFilter} moduleCaseGroups={moduleCaseGroups} visibleModuleCaseGroups={visibleModuleCaseGroups} moduleHealth={moduleHealth} renderModuleMetrics={renderModuleMetrics} renderDeferredModuleMetrics={renderDeferredModuleMetrics} hasCompleteModuleMetrics={hasCompleteModuleMetrics} renderModuleLoadMoreFooter={renderModuleLoadMoreFooter} moduleTileEntries={moduleTileEntries} visibleModuleTileEntries={visibleModuleTileEntries} isUnassignedModuleTileVisible={isUnassignedModuleTileVisible} visibleTileCaseCount={visibleTileCaseCount} totalTileCaseCount={totalTileCaseCount} hasMoreVisibleTestCases={hasMoreVisibleTestCases} activeCaseFilterCount={activeCaseFilterCount} hasIncompleteCaseFilterScope={hasIncompleteCaseFilterScope} selectableFilteredCases={selectableFilteredCases} selectableModuleIds={selectableModuleIds} unassignedCaseIds={unassignedCaseIds} areAllFilteredCasesSelected={areAllFilteredCasesSelected} areAllUnassignedCasesSelected={areAllUnassignedCasesSelected} setTestCaseIdsSelected={setTestCaseIdsSelected} setAllFilteredTestCaseItemsSelected={setAllFilteredTestCaseItemsSelected} setModuleSelected={setModuleSelected} setUnassignedTestCasesSelected={setUnassignedTestCasesSelected} testCaseApiOnlyState={testCaseApiOnlyState} openRunBuilder={openRunBuilder} startDraggingTestCases={startDraggingTestCases} moveTestCasesToModule={moveTestCasesToModule} handleDropCaseOnModule={handleDropCaseOnModule} getTestCaseDropState={getTestCaseDropState} handleRenameModule={handleRenameModule} handleDeleteModule={handleDeleteModule} handleDeleteSelectedTestCaseItems={handleDeleteSelectedTestCaseItems} selectedReviewCases={selectedReviewCases} handleBulkReview={handleBulkReview} openSuiteTransferModal={openSuiteTransferModal} exportCasesToCsv={exportCasesToCsv} handleCloneCase={handleCloneCase} handleDeleteCaseItem={handleDeleteCaseItem} openAiStudio={openAiStudio} isLibraryLoading={isLibraryLoading} closeCaseWorkspace={closeCaseWorkspace} openLibraryCase={openLibraryCase} openLatestFailureRun={openLatestFailureRun} renderReviewDecision={renderReviewDecision} testCaseListColumns={testCaseListColumns} renderTestCaseRowActions={renderTestCaseRowActions} testCaseListRowGroups={testCaseListRowGroups} />
}
        detailView={(
          <Panel
            actions={caseHeaderActions}
            className="test-case-workspace-shell"
            title="Test case workspace"
            subtitle={selectedTestCaseId || isCreating ? "Switch between case details and step editing without losing the selected context." : "Select a test case or create a new one."}
          >
            {selectedTestCaseId || isCreating ? (
              <div className="detail-stack">
                {!isCreating && selectedTestCase ? (
                  <div className="test-case-workspace-tabs">
                    <DetailSectionTabs
                      activeTab={activeTestCaseDetailTab}
                      ariaLabel="Test case detail sections"
                      presentation="inline"
                      className="test-case-detail-navigation"
                      items={[
                        { value: "details", label: "Details", description: "Metadata, steps & data", icon: <PencilIcon /> },
                        { value: "automation" as const, label: "Automation Cases", description: "Executable coverage", icon: <AutomationCodeIcon />, count: linkedAutomationCases.length },
                        ...(canUseTestCaseAi ? [{ value: "assurance" as const, label: "Assurance", description: "Quality & impact", icon: <TestCaseSparkIcon /> }] : []),
                        { value: "suites", label: "Suites", description: "Collection links", icon: <TileCardSuiteIcon />, count: selectedCaseSuiteIds.length },
                        { value: "history", label: "History", description: "Trend, runs & versions", icon: <ActivityIcon /> },
                        { value: "defects", label: "Defects", description: "Failure traceability", icon: <BugIcon />, count: selectedTestCase.defect_ids?.length || 0 },
                        { value: "evidence", label: "Evidence", description: "Files & attachments", icon: <JiraAttachmentIcon /> }
                      ]}
                      onChange={setActiveTestCaseDetailTab}
                    />
                  </div>
	                ) : null}
	                {!isCreating && isSelectedTestCaseDetailPending ? (
	                  <LoadingSkeleton label="Loading saved case details" count={2} />
	                ) : null}
	                {!isCreating && selectedTestCaseId && !selectedTestCase && !isSelectedTestCaseDetailPending ? (
	                  <div className="empty-state compact">
	                    <div>Complete test case details could not be loaded safely.</div>
	                    <button className="primary-button" onClick={() => void selectedTestCaseDetailQuery.refetch()} type="button">Retry details</button>
	                  </div>
	                ) : null}
	                {isCreating || (selectedTestCase && activeTestCaseDetailTab === "details") ? (

<CaseAuthoringWorkspace queryClient={queryClient} session={session} projectId={projectId} appTypeId={appTypeId} canCreateTestCases={canCreateTestCases} canUpdateTestCases={canUpdateTestCases} canViewRequirements={canViewRequirements} canViewDeliveryScopes={canViewDeliveryScopes} canViewTestData={canViewTestData} canManageTestData={canManageTestData} canDeleteTestCases={canDeleteTestCases} canUseTestCaseAi={canUseTestCaseAi} canUseAutomationWorkspace={canUseAutomationWorkspace} canPreviewAutomationCode={canPreviewAutomationCode} canBuildAutomation={canBuildAutomation} canUseAutomationAi={canUseAutomationAi} canUseRecorder={canUseRecorder} canUseMobileAppium={canUseMobileAppium} selectedTestCaseId={selectedTestCaseId} setActiveTestCaseDetailTab={setActiveTestCaseDetailTab} testCaseModules={testCaseModules} isCreating={isCreating} setIsCreating={setIsCreating} reviewComment={reviewComment} setReviewComment={setReviewComment} setIsQualitySuggestionModalOpen={setIsQualitySuggestionModalOpen} selectedExecutionEnvironmentId={selectedExecutionEnvironmentId} setSelectedExecutionEnvironmentId={setSelectedExecutionEnvironmentId} selectedExecutionConfigurationId={selectedExecutionConfigurationId} setSelectedExecutionConfigurationId={setSelectedExecutionConfigurationId} selectedExecutionDataSetId={selectedExecutionDataSetId} setSelectedExecutionDataSetId={setSelectedExecutionDataSetId} caseDeliveryRelease={caseDeliveryRelease} setCaseDeliveryRelease={setCaseDeliveryRelease} caseDeliverySprint={caseDeliverySprint} setCaseDeliverySprint={setCaseDeliverySprint} automationStartUrl={automationStartUrl} setAutomationStartUrl={setAutomationStartUrl} automationContext={automationContext} setAutomationContext={setAutomationContext} automationFailureThreshold={automationFailureThreshold} setAutomationFailureThreshold={setAutomationFailureThreshold} recorderSession={recorderSession} recentRecorderCompletedCaseId={recentRecorderCompletedCaseId} expandedSections={expandedSections} setExpandedSections={setExpandedSections} defaultTestCaseStatus={defaultTestCaseStatus} testCaseStatusOptions={testCaseStatusOptions} emptyDataSetDraft={emptyDataSetDraft} caseDraft={caseDraft} setCaseDraft={setCaseDraft} testCaseTypeOptions={testCaseTypeOptions} setNewStepDraft={setNewStepDraft} stepInsertIndex={stepInsertIndex} setStepInsertIndex={setStepInsertIndex} setStepInsertGroupContext={setStepInsertGroupContext} setDraftSteps={setDraftSteps} selectedStepIds={selectedStepIds} setSelectedStepIds={setSelectedStepIds} setIsCaseParameterDialogOpen={setIsCaseParameterDialogOpen} linkedDataSetDraftIds={linkedDataSetDraftIds} setLinkedDataSetDraftIds={setLinkedDataSetDraftIds} overrideSharedGroupData={overrideSharedGroupData} setOverrideSharedGroupData={setOverrideSharedGroupData} setDataSetSearch={setDataSetSearch} setDataSetLinkDraftId={setDataSetLinkDraftId} setIsDataSetLinkerOpen={setIsDataSetLinkerOpen} setIsDataSetCreatorOpen={setIsDataSetCreatorOpen} setNewDataSetDraft={setNewDataSetDraft} copiedSteps={copiedSteps} expandedStepGroupIds={expandedStepGroupIds} setExpandedStepGroupIds={setExpandedStepGroupIds} stepDrafts={stepDrafts} setStepDrafts={setStepDrafts} setIsSharedGroupPickerOpen={setIsSharedGroupPickerOpen} isInsertingSharedGroups={isInsertingSharedGroups} setSelectedSharedGroupIds={setSelectedSharedGroupIds} caseSectionRef={caseSectionRef} createSuiteContextId={createSuiteContextId} setCreateSuiteContextId={setCreateSuiteContextId} activeBugConversion={activeBugConversion} setActiveBugConversion={setActiveBugConversion} testDataSetsQuery={testDataSetsQuery} stepsQuery={stepsQuery} createTestCase={createTestCase} assignCasesToModule={assignCasesToModule} removeCasesFromModule={removeCasesFromModule} reviewTestCase={reviewTestCase} updateSuite={updateSuite} createLocalRun={createLocalRun} updateTestCase={updateTestCase} deleteTestCase={deleteTestCase} buildSingleAutomation={buildSingleAutomation} buildBatchAutomation={buildBatchAutomation} startRecorder={startRecorder} finishRecorder={finishRecorder} updateStep={updateStep} requirements={requirements} deliveryReleaseOptions={deliveryReleaseOptions} deliverySprintOptions={deliverySprintOptions} creationRequirementOptions={creationRequirementOptions} visibleCreationRequirementOptions={visibleCreationRequirementOptions} linkedRequirementTitle={linkedRequirementTitle} caseGherkinFeatureTitle={caseGherkinFeatureTitle} suites={suites} testDataSets={testDataSets} supportsLocalDesktopExecution={supportsLocalDesktopExecution} userById={userById} assigneeOptions={assigneeOptions} isVisualBuilderActive={isVisualBuilderActive} displaySteps={displaySteps} preconditionSteps={preconditionSteps} mainSteps={mainSteps} showError={showError} updateCaseDeliveryScope={updateCaseDeliveryScope} updateCaseRequirement={updateCaseRequirement} existingCaseLabels={existingCaseLabels} testEngineIntegration={testEngineIntegration} mobileRemoteRecorderEnabled={mobileRemoteRecorderEnabled} automationLearningCache={automationLearningCache} recorderLiveUrl={recorderLiveUrl} openRunBuilder={openRunBuilder} selectedTestCase={selectedTestCase} selectedCaseDisplayId={selectedCaseDisplayId} canLinkTestDataToCurrentCase={canLinkTestDataToCurrentCase} canCreateAndLinkTestData={canCreateAndLinkTestData} linkedDataSetId={linkedDataSetId} linkedDataSet={linkedDataSet} linkedDataSetIterationCount={linkedDataSetIterationCount} linkedAutomationCases={linkedAutomationCases} isSelectedTestCaseDetailPending={isSelectedTestCaseDetailPending} canReviewSelectedTestCase={canReviewSelectedTestCase} isSelectedReviewPending={isSelectedReviewPending} selectedReviewStatus={selectedReviewStatus} automationTargetCaseIds={automationTargetCaseIds} resolvedScopedParameterValues={resolvedScopedParameterValues} handleConvertStepGroup={handleConvertStepGroup} activateStepInsert={activateStepInsert} handleSaveCase={handleSaveCase} handleSaveCaseAndSteps={handleSaveCaseAndSteps} handleDeleteCase={handleDeleteCase} handleSubmitReview={handleSubmitReview} openReviewSuggestionDialog={openReviewSuggestionDialog} handleBuildSelectedAutomation={handleBuildSelectedAutomation} handleStartRecorder={handleStartRecorder} handleFinishRecorder={handleFinishRecorder} handleMoveStepGroup={handleMoveStepGroup} handleUngroupStepGroup={handleUngroupStepGroup} handleRemoveStepGroup={handleRemoveStepGroup} computedCaseAiQualityScore={computedCaseAiQualityScore} caseQualitySuggestions={caseQualitySuggestions} testCaseReviewReadiness={testCaseReviewReadiness} selectedCaseHealthMetrics={selectedCaseHealthMetrics} authoredBehaviorUnitCount={authoredBehaviorUnitCount} stepBlocks={stepBlocks} detectedStepParameters={detectedStepParameters} stepCountLabel={stepCountLabel} allStepsSelected={allStepsSelected} testCaseSaveBlockedReason={testCaseSaveBlockedReason} isTestCaseWorkspaceMutationPending={isTestCaseWorkspaceMutationPending} isTestCaseSaveDisabled={isTestCaseSaveDisabled} editorStepActions={editorStepActions} readableCaseTitle={readableCaseTitle} readableCaseDescription={readableCaseDescription} hasReadableCasePreview={hasReadableCasePreview} caseSectionSummary={caseSectionSummary} stepSectionSummary={stepSectionSummary} preconditionGroupContext={preconditionGroupContext} automationSectionSummary={automationSectionSummary} caseSectionTitleContent={caseSectionTitleContent} closeCaseWorkspace={closeCaseWorkspace} handleWorkspaceBack={handleWorkspaceBack} isSelectedCaseLocalRunning={isSelectedCaseLocalRunning} canSelectedCaseRunLocally={canSelectedCaseRunLocally} selectedCaseLocalRunLabel={selectedCaseLocalRunLabel} renderStepInsertSlot={renderStepInsertSlot} renderStepCard={renderStepCard} openGroupAutomationPreview={openGroupAutomationPreview} />

                ) : null}
                {!isCreating && activeTestCaseDetailTab === "automation" && selectedTestCase ? (
                  <div className="detail-section-panel requirement-detail-wide-panel test-case-automation-cases-panel" role="tabpanel">
                    <div className="test-case-automation-cases-header">
                      <div className="detail-summary">
                        <strong>Automation cases</strong>
                        <span>Automation cases have independent AT IDs. Link them to this manual case to track automation coverage and its execution outcomes.</span>
                      </div>
                      <button className="primary-button" disabled={isOpeningLinkedAutomation} onClick={() => void handleCreateLinkedAutomation()} type="button">
                        <AutomationCodeIcon />
                        <span>{isOpeningLinkedAutomation ? "Preparing automation…" : "Create automation twin"}</span>
                      </button>
                    </div>
                    {canViewExecutionInsights && selectedTestCase.automation_coverage ? (
                      <section className="detail-summary automation-link-summary" aria-label="Automation coverage outcome">
                        <strong>Automation coverage outcome</strong>
                        <StatusBadge value={selectedTestCase.automation_coverage.status || "not_run"} />
                        <span>{selectedTestCase.automation_coverage.latest_result
                          ? `Latest linked automation outcome from ${selectedTestCase.automation_coverage.latest_result.source_display_id || "an automation case"}. Manual execution evidence remains available in History.`
                          : `${selectedTestCase.automation_coverage.linked_case_count} linked automation case${selectedTestCase.automation_coverage.linked_case_count === 1 ? "" : "s"}; no execution outcome yet.`}</span>
                        {selectedTestCase.automation_coverage.latest_result ? <button className="ghost-button compact" type="button" onClick={() => {
                          const result = selectedTestCase.automation_coverage!.latest_result!;
                          navigate(`/executions?${new URLSearchParams({ view: "suite-runs", execution: result.execution_id, testCase: result.source_test_case_id || result.test_case_id })}`);
                        }}><OpenIcon size={16} />Open automation evidence</button> : null}
                      </section>
                    ) : null}
                    {automationCaseLinksQuery.isError ? <div className="empty-state compact" role="alert">Linked automation cases could not be loaded. <button className="ghost-button compact" type="button" onClick={() => void automationCaseLinksQuery.refetch()}>Retry linked cases</button></div> : null}
                    {automationCaseLinksQuery.isLoading ? <TileCardSkeletonGrid count={3} /> : null}
                    {!automationCaseLinksQuery.isLoading && linkedAutomationCases.length ? (
                      <div className="tile-browser-grid test-case-linked-automation-grid">
                        {linkedAutomationCases.map((automationCase) => {
                          const recentHistory = ((automationCase as TestCaseCatalogRow).recent_results || historyByCaseId[automationCase.id] || []).slice(0, 10);
                          const passedRuns = recentHistory.filter((result) => result.status === "passed").length;
                          const passRate = recentHistory.length ? Math.round((passedRuns / recentHistory.length) * 100) : 0;
                          return (
                            <button
                              className="record-card tile-card test-case-card test-case-catalog-card automation-case-tile test-case-linked-automation-card"
                              key={automationCase.id}
                              onClick={() => navigate(`/automation?case=${encodeURIComponent(automationCase.display_id || automationCase.id)}`)}
                              type="button"
                            >
                              <div className="tile-card-main">
                                <div className="tile-card-select-row test-case-card-header">
                                  <DisplayIdBadge value={automationCase.display_id?.trim() || "Unavailable"} />
                                  <div className="catalog-inline-actions test-case-top-actions">
                                    <StatusBadge value="automated" />
                                    <StatusBadge value={automationCase.automation_status || "incomplete"} />
                                  </div>
                                </div>
                                <div className="tile-card-header">
                                  <TileCardIconFrame tone={automationCase.automation_status === "incomplete" ? "neutral" : "success"}>
                                    <TileCardCaseIcon />
                                  </TileCardIconFrame>
                                  <div className="tile-card-title-group test-case-card-title-group">
                                    <span className="tile-card-kicker">Linked automation</span>
                                    <strong>{automationCase.title}</strong>
                                  </div>
                                </div>
                                <CatalogCardDescription fallback="Automation is mapped to this manual test case." profile="test-case" value={automationCase.description} />
                                <div className="tile-card-facts">
                                  <TileCardFact label={`${automationCase.step_count || 0} steps`} title="Automation steps"><TileCardStepsIcon /></TileCardFact>
                                  <TileCardFact label={`${recentHistory.length} runs`} title="Recent run history" tone={recentHistory.length ? "info" : "neutral"}><ActivityIcon /></TileCardFact>
                                  <TileCardFact label={`P${automationCase.priority || 3}`} title="Priority"><TestCaseIcon /></TileCardFact>
                                </div>
                                <div className="tile-card-footer">
                                  <TileCardProgress
                                    breakdown={buildHistoryStatusBreakdown(recentHistory)}
                                    displayValue={recentHistory.length ? `${passRate}% passed` : "No runs yet"}
                                    label="Pass rate"
                                    title={recentHistory.length ? `${passedRuns} of the last ${recentHistory.length} case results passed` : "No recent run coverage"}
                                    value={recentHistory.length ? passRate : null}
                                  />
                                  <span className="test-case-linked-automation-open">Open workspace <OpenIcon size={16} /></span>
                                </div>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    ) : null}
                    {!automationCaseLinksQuery.isLoading && !automationCaseLinksQuery.isError && !linkedAutomationCases.length ? (
                      <div className="empty-state compact test-case-automation-empty-state">
                        <AutomationCodeIcon />
                        <strong>No automation case is linked yet.</strong>
                        <span>Create one with AI, the smart recorder, or a blank canvas while keeping this manual case unchanged.</span>
                      </div>
                    ) : null}
                  </div>
                ) : null}
                {!isCreating && canUseTestCaseAi && activeTestCaseDetailTab === "assurance" && selectedTestCase ? (
                  <div className="detail-section-panel requirement-detail-wide-panel" role="tabpanel">
                    <ArtifactAssuranceWorkspace
                      providerControl={<AiReviewControls key={`case-assurance-${projectId}-${selectedTestCase.id}`} usageKey="ai.quality.test_case_assurance" promptMaxLength={12_000} projectId={projectId} appTypeId={appTypeId} integrations={integrations} integrationId={testCaseAssuranceIntegrationId} onIntegrationIdChange={setTestCaseAssuranceIntegrationId} promptGuidance={testCaseAssurancePromptGuidance} onPromptGuidanceChange={setTestCaseAssurancePromptGuidance} additionalContext={testCaseAssuranceContext} onAdditionalContextChange={setTestCaseAssuranceContext} artifactIds={[selectedTestCase.id]} artifactContext={JSON.stringify(selectedTestCaseAssuranceProposedChange)} disabled={previewTestCaseImpact.isPending} onBusyChange={setTestCaseAssuranceContextBusy} />}
                      analysis={selectedTestCaseAssurance}
                      analysisDisabled={!canUseTestCaseAi || !projectId || previewTestCaseImpact.isPending || testCaseAssuranceContextBusy}
                      analysisNotice={testCaseAssurancePreviewMatchesDraft && previewTestCaseImpact.data?.fallback_used ? previewTestCaseImpact.data.fallback_reason : null}
                      analysisError={previewTestCaseImpact.error instanceof Error && testCaseAssuranceRequestMatchesDraft ? previewTestCaseImpact.error.message : null}
                      analysisSource={selectedTestCaseAssuranceSource}
                      criteriaKey="metric.assurance.test_case"
                      generatedAt={testCaseAssurancePreviewMatchesDraft ? previewTestCaseImpact.data?.generated_at : null}
                      isAnalyzing={previewTestCaseImpact.isPending && testCaseAssuranceRequestMatchesDraft}
                      isDraftChanged={isTestCaseAssuranceDraftChanged}
                      onAnalyze={() => runTestCaseAssuranceAnalysis(false)}
                      onInspectImpact={openTestCaseImpactPreview}
                      reviewState={selectedReviewStatus === "accepted" ? "human-reviewed" : selectedReviewStatus === "pending" ? "pending-review" : "review-required"}
                      title="Test design & evidence analysis"
                    />
                    {can("agentic_workflow.run") && areFeatureFlagsEnabled(featureFlagsQuery.data, ["hellotest.ai.agentic_workflows"]) && <AiLifecycleReview projectId={projectId} appTypeId={appTypeId} inputs={{ test_case_id: selectedTestCase.id }} integrations={integrations} features={["coverage-assurance", "impact-analysis", "quality-graph"]} title="Coverage, impact & traceability" />}
                  </div>
                ) : null}
                {!isCreating && activeTestCaseDetailTab === "suites" && selectedTestCase ? (
                  <div className="detail-section-panel requirement-detail-wide-panel" role="tabpanel">
                    <RelatedWorkItemsPanel key={selectedTestCase.id} ariaLabel="Linked Suites" title="Linked Suites" eyebrow="Traceability" description="Organize this Test Case in reusable Suites and keep its coverage connections visible."
                      items={selectedCaseSuiteIds.map(id => { const suite = suites.find(item => item.id === id); return { id, displayId: suite?.display_id, title: suite?.name || id, description: richTextToPlainText(suite?.description || ""), relation: "included in", icon: <TileCardSuiteIcon />, canUnlink: canEditSuiteLinks, onOpen: () => navigate(`/design?suite=${encodeURIComponent(id)}`) }; })}
                      linking={canEditSuiteLinks ? {
                        scopeKey: `case-suites:${projectId}:${appTypeId}:${selectedTestCase.id}`,
                        loadCandidates: async () => ({ items: asArray(await api.testSuites.list({ app_type_id: appTypeId })).map(suite => ({ id: suite.id, displayId: suite.display_id, title: suite.name, description: richTextToPlainText(suite.description || ""), relation: "included in", icon: <TileCardSuiteIcon />, onOpen: () => navigate(`/design?suite=${encodeURIComponent(suite.id)}`) })) }),
                        onLink: async suite => { await persistCaseSuiteLinks([...new Set([...selectedCaseSuiteIds, suite.id])]); }
                      } : undefined}
                      onUnlink={canEditSuiteLinks ? async suite => {
                        const nextIds = selectedCaseSuiteIds.filter(id => id !== suite.id);
                        await persistCaseSuiteLinks(nextIds);
                      } : undefined}
                    />
                  </div>
                ) : null}
                {!isCreating && activeTestCaseDetailTab === "history" && selectedTestCase ? (
                  <div className="detail-section-panel" role="tabpanel">
                    <TraceabilityRunHistory
                      appTypeId={appTypeId || undefined}
                      projectId={projectId}
                      testCaseId={selectedTestCase.id}
                    />
                    <TestCaseVersionHistory
                      canRestore={canUpdateTestCases}
                      currentCase={selectedTestCase}
                      currentSteps={steps}
                      key={selectedTestCase.id}
                    />
                  </div>
                ) : null}
                {!isCreating && activeTestCaseDetailTab === "defects" && selectedTestCase ? (
                  <div className="detail-section-panel" role="tabpanel">
                    <LinkedDefectsPanel
                      canUpdate={canUpdateTestCases}
                      itemId={selectedTestCase.id}
                      projectId={projectId}
                      subject="test-case"
                    />
                  </div>
                ) : null}
                {!isCreating && activeTestCaseDetailTab === "evidence" && selectedTestCase ? (
                  <div className="detail-section-panel" role="tabpanel">
                    <JiraAttachmentPanel
                      canDelete={canDeleteAttachments}
                      canUpload={canCreateAttachments}
                      canView={canViewAttachments}
                      entityId={selectedTestCase.id}
                      entityType="test_case"
                      issueKey={selectedCaseDisplayId || "this Test Case"}
                      projectId={projectId}
                    />
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="empty-state compact">Select a test case from the library, or start a new one for this app type.</div>
            )}
          </Panel>
        )}
        isDetailOpen={Boolean(selectedTestCaseId) || isCreating}
      />

      {isStepGroupModalOpen ? (
        <StepGroupModal
          isSaving={groupSteps.isPending || createSharedStepGroup.isPending}
          name={stepGroupName}
          onClose={() => {
            setIsStepGroupModalOpen(false);
            setStepGroupName("");
            setSaveAsReusableGroup(false);
          }}
          onNameChange={setStepGroupName}
          onSave={() => void handleConfirmStepGroup()}
          reusable={saveAsReusableGroup}
          selectedCount={selectedEditorSteps.length}
          setReusable={setSaveAsReusableGroup}
        />
      ) : null}

      {isSharedGroupPickerOpen ? (
        <SharedGroupPickerModal
          groups={filteredSharedGroups}
          isLoading={sharedStepGroupsQuery.isLoading}
          isInserting={isInsertingSharedGroups}
          onClose={() => {
            if (isInsertingSharedGroups) return;
            setIsSharedGroupPickerOpen(false);
            setSelectedSharedGroupIds([]);
            setSharedGroupSearchTerm("");
          }}
          onConfirm={() => void handleInsertSharedGroup()}
          onSearchChange={setSharedGroupSearchTerm}
          searchValue={sharedGroupSearchTerm}
          selectedGroups={selectedSharedGroups}
          selectedGroupIds={selectedSharedGroupIds}
          setSelectedGroupIds={setSelectedSharedGroupIds}
        />
      ) : null}


      {isDataSetCreatorOpen && canCreateAndLinkTestData ? (
        <ResourceModalShell
          className="resource-modal-card--test-data"
          closeDisabled={createTestDataSet.isPending}
          onClose={() => {
            if (createTestDataSet.isPending) return;
            setIsDataSetCreatorOpen(false);
            setNewDataSetDraft(emptyDataSetDraft);
          }}
          title="Create Test Data Set"
          titleIcon={<IconChartBar size={18} />}
        >
          <DataSetForm
            dataSetModeOptions={dataSetModeOptions}
            draft={newDataSetDraft}
            isSubmitting={createTestDataSet.isPending}
            onChange={setNewDataSetDraft}
            onSubmit={handleCreateAndLinkDataSet}
            savedDataSets={testDataSets}
            submitLabel={createTestDataSet.isPending ? "Creating…" : "Create and Select"}
          />
        </ResourceModalShell>
      ) : null}

      {isDataSetLinkerOpen && canLinkTestDataToCurrentCase ? (
        <TestDataSetPickerDialog
          canCreateDataSet={canCreateAndLinkTestData}
          dataSets={testDataSets}
          isLoading={testDataSetsQuery.isLoading}
          error={testDataSetsQuery.isError ? "Data sets could not be loaded." : undefined}
          onRetry={() => { void testDataSetsQuery.refetch(); }}
          onClose={() => {
            setIsDataSetLinkerOpen(false);
            setDataSetLinkDraftId("");
            setDataSetSearch("");
          }}
          onConfirm={() => {
            if (!dataSetLinkDraftId) return;
            setLinkedDataSetDraftIds([dataSetLinkDraftId]);
            setIsDataSetLinkerOpen(false);
            setDataSetSearch("");
            showSuccess("Data set selected. Save the test case to keep this relationship.");
          }}
          onCreateNew={() => {
            setIsDataSetLinkerOpen(false);
            setDataSetLinkDraftId("");
            setDataSetSearch("");
            setNewDataSetDraft(emptyDataSetDraft);
            setIsDataSetCreatorOpen(true);
          }}
          onSearchChange={setDataSetSearch}
          onSelect={setDataSetLinkDraftId}
          search={dataSetSearch}
          selectedId={dataSetLinkDraftId}
        />
      ) : null}

      {parameterReviewDialog}
      {isCaseParameterDialogOpen ? (
        <StepParameterDialog
          key={isCreating ? createCaseParameterDraftScopeKey : selectedTestCaseId}
          allowSensitiveValueOverrides
          defaultValues={linkedDataSetDefaultParameterValues}
          inheritedParameterNames={linkedDataSetParameterDefinitions.map(parameter => parameter.name)}
          headerContent={selectedCaseSuiteIds.length > 1 ? <label>Suite for shared parameters<select aria-label="Suite for shared parameters" disabled={hasParameterScopeDraft || updateSuite.isPending} value={selectedParameterSuiteId} onChange={event => setSelectedParameterSuiteId(event.target.value)}>{suites.filter(suite => selectedCaseSuiteIds.includes(suite.id)).map(suite => <option key={suite.id} value={suite.id}>{suite.name}</option>)}</select></label> : undefined}
          getInputState={(parameter) => resolveScopedParameterInputState(parameter.scope)}
          getScopeState={resolveParameterScopeState}
          onChange={handleScopedParameterValueChange}
          onScopeChange={handleParameterScopeChange}
          onClose={() => setIsCaseParameterDialogOpen(false)}
          onRefreshPreviews={refreshParameterPreviews}
          onReset={resetTestCaseParameterOverride}
          overrideValues={testCaseParameterValues}
          parameters={detectedStepParameters}
          previewValues={resolvedScopedParameterValues}
          subtitle="Review inherited Data Set columns and edit only this Test Case's parameter overrides."
          footerContent={hasParameterScopeDraft ? <><p role="status">Save the test case to keep the updated scopes, values, and step references.</p><button className="primary-button" disabled={updateTestCase.isPending || updateSuite.isPending} onClick={() => void handleSaveCaseAndSteps()} type="button">Save test case</button></> : undefined}
          title="Test Params"
          values={mergedScopedParameterValues}
        />
      ) : null}

      {inspectingStep ? (
        <div className="modal-backdrop modal-backdrop--scroll" onClick={() => !recorderSession && setInspectingStepId("")} role="presentation">
          <div
            aria-label={`Inspect step ${inspectingStep.step_order}`}
            aria-modal="true"
            className="modal-card resource-modal-card step-inspect-modal"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
          >
            <div className="resource-modal-header">
              <div className="resource-modal-title">
                <p>Inspect step {inspectingStep.step_order}</p>
                <p>{richTextToPlainText(inspectingStep.action || inspectingStep.expected_result) || "Record an action for this step."}</p>
              </div>
              <button className="ghost-button" disabled={Boolean(recorderSession)} onClick={() => setInspectingStepId("")} type="button">
                Close
              </button>
            </div>
            <div className="detail-stack step-inspect-body">
              <div className="detail-summary">
                <strong>Step-level capture</strong>
                <InfoTooltip
                  content="Start an inspector session and perform only this step action. Local inspection reuses the open HelloTest browser on port 4311 when available; captured automation and repository evidence remain mapped to this step."
                  label="Step-level capture information"
                />
              </div>
	              <RecorderStartControls
	                disabled={!canUseRecorder || !selectedTestCase || !testEngineIntegration}
                hasSession={Boolean(recorderSession)}
                isStarting={startRecorder.isPending}
                mobileAppiumEnabled={canUseMobileAppium}
                mobileRemoteEnabled={mobileRemoteRecorderEnabled}
                onStart={(options) => void handleStartRecorder(options, inspectingStep.id)}
                localLabel="Inspect locally"
                remoteLabel="Inspect remotely"
                primaryAction={(
                  <button
                    className="primary-button recorder-stop-button"
                    disabled={!recorderSession || finishRecorder.isPending}
                    onClick={() => void handleFinishRecorder()}
                    type="button"
                  >
                    <PauseIcon />
                    <span>{finishRecorder.isPending ? "Saving..." : "Stop and map action"}</span>
                  </button>
                )}
              />
              {recorderLiveUrl ? (
                <div className="step-inspect-browser-shell">
                  <div className="step-inspect-browser-toolbar">
                    <strong>Live browser view</strong>
                    <InfoTooltip
                      content="Scroll vertically or horizontally to review the captured browser viewport."
                      label="Live browser view information"
                    />
                  </div>
                  <div className="step-inspect-browser-viewport">
                    <iframe
                      allow="clipboard-read; clipboard-write"
                      className="recorder-live-frame step-inspect-live-frame"
                      src={recorderLiveUrl}
                      title={`HelloTest inspector for step ${inspectingStep.step_order}`}
                    />
                  </div>
                </div>
              ) : null}
              <RecorderSessionInsights session={recorderSession} />
            </div>
          </div>
        </div>
      ) : null}

      {canEditAutomationCode && editingAutomationStep ? (
        <StepAutomationDialog
          availableParameters={detectedStepParameters}
          getParameterScopeState={resolveScopedParameterInputState}
          objectRepository={automationLearningCache}
          onClose={() => setEditingAutomationStepId("")}
          onSaveResponseValue={handleScopedParameterValueChange}
          onSave={(input) => void handleSaveStepAutomation(editingAutomationStep.id, input)}
          parameterValues={resolvedScopedParameterValues}
          step={{
            id: editingAutomationStep.id,
            step_order: editingAutomationStep.step_order,
            action: stepDrafts[editingAutomationStep.id]?.action ?? editingAutomationStep.action,
            expected_result: stepDrafts[editingAutomationStep.id]?.expected_result ?? editingAutomationStep.expected_result,
            step_type: stepDrafts[editingAutomationStep.id]?.step_type ?? editingAutomationStep.step_type,
            automation_code: stepDrafts[editingAutomationStep.id]?.automation_code ?? editingAutomationStep.automation_code,
            api_request: stepDrafts[editingAutomationStep.id]?.api_request ?? editingAutomationStep.api_request
          }}
          subtitle="Use @t for case data, @s for suite-shared data, and @r for run-level data previews."
          title={`Step ${editingAutomationStep.step_order} automation`}
        />
      ) : null}

      {canPreviewAutomationCode && codePreviewState ? (
        <CodePreviewDialog
          code={codePreviewState.code}
          objectRepository={codePreviewState.objectRepository}
          onClose={() => setCodePreviewState(null)}
          subtitle={codePreviewState.subtitle}
          title={codePreviewState.title}
        />
      ) : null}

      {isSuiteTransferModalOpen ? (
        <TestCaseSuiteTransferModal
          action={suiteTransferAction}
          appTypes={allAppTypes}
          caseCount={suiteTransferCaseIds.length}
          currentAppTypeId={appTypeId}
          isSaving={createTestCase.isPending || updateTestCase.isPending}
          onActionChange={setSuiteTransferAction}
          onAppTypeChange={setSuiteTransferAppTypeId}
          onClose={closeSuiteTransferModal}
          onProjectChange={setSuiteTransferProjectId}
          onSubmit={() => void handleApplySuiteTransfer()}
          onSuiteIdsChange={setSuiteTransferSuiteIds}
          projects={projects}
          selectedSuiteIds={suiteTransferSuiteIds}
          targetAppTypeId={suiteTransferAppTypeId}
          targetProjectId={suiteTransferProjectId}
        />
      ) : null}

      {isCreateSuiteModalOpen ? (
        <SuiteCreateModal
          mode="create"
          suite={null}
          childSuites={[]}
          projectId={projectId}
          appTypeId={appTypeId}
          appTypeCases={testCases}
          availableLabels={existingSuiteLabels}
          canConfigureParallelAutomation={canConfigureParallelAutomation}
          isSaving={createSuite.isPending || assignSuiteCases.isPending}
          onClose={() => setIsCreateSuiteModalOpen(false)}
          onSubmit={handleCreateSuite}
          selectedCaseIds={selectedActionTestCaseIds}
        />
      ) : null}

      {isCreateModuleModalOpen ? (
        <TestCaseCreateModuleModal
          projectId={projectId}
          appTypeId={appTypeId}
          assignmentRetryName={moduleAssignmentRetry?.name}
          canAssignCases={canUpdateTestCases}
          canSelectRequirements={canViewRequirements}
          candidateRequirements={modulePickerRequirements}
          candidateTestCases={modulePickerTestCases}
          hasMoreRequirements={Boolean(modulePickerRequirementsQuery.hasNextPage)}
          initialSelectedIds={moduleDraftInitialCaseIds}
          isLoadingRequirements={modulePickerRequirementsQuery.isPending}
          isLoadingMoreRequirements={modulePickerRequirementsQuery.isFetchingNextPage}
          isSaving={isCreatingModuleWorkflow || createTestCaseModule.isPending || assignCasesToModule.isPending}
          moduleNameByCaseId={moduleNameByPickerCaseId}
          onClose={() => {
            setIsCreateModuleModalOpen(false);
            setModuleDraftInitialCaseIds([]);
            setModuleAssignmentRetry(null);
          }}
          onLoadMoreRequirements={() => modulePickerRequirementsQuery.fetchNextPage()}
          onResolveRequirementCases={(requirementIds) => api.testCases.resolveRequirementCases({
            app_type_id: appTypeId,
            requirement_ids: requirementIds
          })}
          onSubmit={(draft) => void handleCreateModule(draft)}
        />
      ) : null}

      {isBulkReviewRejectOpen && isReviewQueueOpen ? (
        <div className="modal-backdrop" role="presentation" onClick={() => { if (!isBulkReviewRunning) setIsBulkReviewRejectOpen(false); }}>
          <div className="modal-card resource-modal-card" role="dialog" aria-modal="true" aria-label="Reject selected Test Cases" onClick={(event) => event.stopPropagation()}>
            <div className="resource-modal-header"><h3>Request Changes for {selectedReviewCases.length} Test Cases</h3>
              <button className="ghost-button" type="button" disabled={isBulkReviewRunning} onClick={() => setIsBulkReviewRejectOpen(false)}>Close</button></div>
            <div className="form-grid review-suggestion-body">
              {bulkReviewError ? <div className="inline-message error-message" role="alert">{bulkReviewError}</div> : null}
              <p>Feedback is saved in each selected Test Case's review history. The cases remain available for the author to update.</p>
              <FormField label="Comments"><textarea rows={5} placeholder="Add the changes needed before approval." value={bulkReviewComment} onChange={(event) => setBulkReviewComment(event.target.value)} disabled={isBulkReviewRunning} /></FormField>
            </div>
            <div className="modal-actions"><button className="ghost-button" type="button" disabled={isBulkReviewRunning} onClick={() => setIsBulkReviewRejectOpen(false)}>Cancel</button>
              <button className="ghost-button danger test-case-review-reject" type="button" disabled={isBulkReviewRunning || !selectedReviewCases.length || !bulkReviewComment.trim()} onClick={() => void handleBulkReview("changes_requested")}>{isBulkReviewRunning ? "Saving..." : "Reject Selected"}</button></div>
          </div>
        </div>
      ) : null}

      {reviewSuggestionCaseId ? (
        <div
          className="modal-backdrop"
          onClick={() => {
            if (reviewingCaseIds.includes(reviewSuggestionCaseId)) return;
            setReviewSuggestionCaseId("");
            setReviewSuggestionComment("");
            setReviewSuggestionConfirmed(true);
          }}
          role="presentation"
        >
          <div
            aria-label="Suggest test case review changes"
            aria-modal="true"
            className="modal-card resource-modal-card"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
          >
            <div className="resource-modal-header">
              <div className="resource-modal-title">
                <p>Review feedback</p>
                <h3>Suggest changes</h3>
              </div>
              <button
                className="ghost-button"
                disabled={reviewingCaseIds.includes(reviewSuggestionCaseId)}
                onClick={() => {
                  setReviewSuggestionCaseId("");
                  setReviewSuggestionComment("");
                  setReviewSuggestionConfirmed(true);
                }}
                type="button"
              >
                Close
              </button>
            </div>
            <div className="form-grid review-suggestion-body">
              {reviewSuggestionError ? <div className="inline-message error-message" role="alert">{reviewSuggestionError}</div> : null}
              <p className="review-suggestion-intro">
                Share clear, actionable notes for the author. These comments are saved into the test case review history.
              </p>
              <label className="checkbox-field review-suggestion-confirm">
                <input
                  checked={reviewSuggestionConfirmed}
                  onChange={(event) => setReviewSuggestionConfirmed(event.target.checked)}
                  type="checkbox"
                />
                <span>Suggest changes for this test case</span>
              </label>
              <FormField label="Comments">
                <textarea
                  placeholder="Add the changes needed before approval."
                  rows={5}
                  value={reviewSuggestionComment}
                  onChange={(event) => setReviewSuggestionComment(event.target.value)}
                />
              </FormField>
            </div>
            <div className="modal-actions">
              <button
                className="ghost-button"
                disabled={reviewingCaseIds.includes(reviewSuggestionCaseId)}
                onClick={() => {
                  setReviewSuggestionCaseId("");
                  setReviewSuggestionComment("");
                  setReviewSuggestionConfirmed(true);
                }}
                type="button"
              >
                Cancel
              </button>
              <button
                className="primary-button"
                disabled={!reviewSuggestionConfirmed || reviewingCaseIds.includes(reviewSuggestionCaseId)}
                onClick={() => void handleSubmitReviewSuggestion()}
                type="button"
              >
                {reviewingCaseIds.includes(reviewSuggestionCaseId) ? "Saving..." : "Send feedback"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {isQualitySuggestionModalOpen ? (
        <div className="modal-backdrop" onClick={() => setIsQualitySuggestionModalOpen(false)} role="presentation">
          <div
            aria-label="Test Quality Score suggestions"
            aria-modal="true"
            className="modal-card resource-modal-card"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
          >
            <div className="resource-modal-header">
              <div className="resource-modal-title">
                <p>Test Quality Score</p>
                <h3>{computedCaseAiQualityScore}% quality</h3>
              </div>
              <button className="ghost-button" onClick={() => setIsQualitySuggestionModalOpen(false)} type="button">Close</button>
            </div>
            <div className="stack-list">
              {caseQualitySuggestions.map((suggestion) => (
                <div className="stack-item" key={suggestion}>
                  <div>
                    <strong>{suggestion}</strong>
                  </div>
                </div>
              ))}
              {!caseQualitySuggestions.length ? <div className="empty-state compact">No quality suggestions right now.</div> : null}
            </div>
            <div className="modal-actions">
              <button className="primary-button" onClick={() => setIsQualitySuggestionModalOpen(false)} type="button">Done</button>
            </div>
          </div>
        </div>
      ) : null}

      {isCreateExecutionModalOpen ? (
        <TestCaseExecutionModal dataOptions={selectedExecutionDataOptions} onDataOptionsChange={setSelectedExecutionDataOptions}
          isPreparingOptions={Boolean(pendingRunBuilder)}
          appTypeId={appTypeId}
          assigneeOptions={assigneeOptions}
	          canCreateExecution={Boolean(
	            projectId
	            && appTypeId
	            && selectedActionCases.length
	            && session?.user.id
	            && (executionStartMode === "local"
	              ? canRunLocalAutomation
	              : executionStartMode === "remote"
	                ? canRunRemoteAutomation
	                : canCreateRuns)
	          )}
          canConfigureParallelAutomation={canConfigureParallelAutomation}
          canRunLocalAutomation={canRunLocalAutomation}
          canRunRemoteAutomation={canRunRemoteAutomation}
          executionName={executionName}
          executionStartDate={executionStartDate}
          executionEndDate={executionEndDate}
          onExecutionStartDateChange={setExecutionStartDate}
          onExecutionEndDateChange={setExecutionEndDate}
          isSubmitting={createExecution.isPending}
          executionParallelCount={executionParallelCount}
          executionParallelEnabled={executionParallelEnabled}
          executionRelease={executionRelease}
          releaseOptions={deliveryReleaseOptions}
          executionStartMode={executionStartMode}
          executionSprint={executionSprint}
          sprintOptions={deliverySprintOptions}
          executionBuild={executionBuild}
          onAssigneeChange={setSelectedExecutionAssigneeIds}
          onClose={closeCreateExecutionModal}
          onConfigurationChange={setSelectedExecutionConfigurationId}
          onDataSetChange={setSelectedExecutionDataSetId}
          onEnvironmentChange={setSelectedExecutionEnvironmentId}
          onExecutionBuildChange={setExecutionBuild}
          onExecutionNameChange={setExecutionName}
          onExecutionParallelCountChange={setExecutionParallelCount}
          onExecutionParallelEnabledChange={setExecutionParallelEnabled}
          onExecutionReleaseChange={(value) => { runDeliveryFieldsEditedRef.current.release = true; setExecutionRelease(value); }}
          onExecutionSprintChange={(value) => { runDeliveryFieldsEditedRef.current.sprint = true; setExecutionSprint(value); }}
          onExecutionStartModeChange={setExecutionStartMode}
          onRemoveTestCase={(testCaseId) =>
            setSelectedActionTestCaseIds((current) => current.filter((id) => id !== testCaseId))
          }
          onSubmit={handleCreateExecution}
          projectId={projectId}
          selectedAssigneeIds={selectedExecutionAssigneeIds}
          selectedConfigurationId={selectedExecutionConfigurationId}
          selectedAppType={selectedAppType?.name || ""}
          selectedDataSetId={selectedExecutionDataSetId}
          selectedEnvironmentId={selectedExecutionEnvironmentId}
          selectedProject={selectedProject?.name || ""}
          testCases={selectedActionCases}
        />
      ) : null}

      {isImportModalOpen ? (
        <div
          className="modal-backdrop"
          onClick={() => {
            if (importTestCases.isPending) {
              return;
            }

            setImportBatches([]);
            setImportFileWarnings([]);
            setImportSourceSelection("auto");
            setIsImportModalOpen(false);
          }}
        >
          <div
            aria-labelledby="bulk-import-title"
            aria-modal="true"
            className="modal-card import-modal-card test-case-import-modal-card"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
          >
            <div className="import-modal-header">
              <div className="import-modal-title">
                <div className="modal-title-info-row">
                  <h2 className="dialog-title" id="bulk-import-title">Import test cases from external sources</h2>
                  <InfoTooltip
                    content={(
                      <>
                        <p>Queue CSV, JUnit XML, TestNG XML, or Postman collections. Large files are queued in smaller batches. Track progress and download row outcomes in TestOps → Batch Process.</p>
                        <p>The CSV template includes metadata, local and Shared Step Groups, Steps and Parameter Values. Structured fields use JSON. Use Story/Suite short IDs or exact names, one primary Module, existing dataset IDs or names, and project member emails or IDs for Author/Reviewer. Leave optional links blank. Shared group definitions create missing groups and preserve existing ones.</p>
                      </>
                    )}
                    label="Test case import information"
                  />
                </div>
              </div>
              <button className="ghost-button compact template-download-action" type="button" onClick={() => downloadCsvRecords("hellotest-test-case-import-template.csv", buildTestCaseImportTemplate())}><IconDownload aria-hidden="true" size={16} /><span>Download Template</span></button>
              <DialogCloseButton disabled={importTestCases.isPending} label="Close bulk import" onClick={() => {
                setImportBatches([]);
                setImportFileWarnings([]);
                setImportSourceSelection("auto");
                setIsImportModalOpen(false);
              }} />
            </div>

            <div className="import-modal-body">
              <div className="record-grid">
                <FormField label="Source type">
                  <select value={importSourceSelection} onChange={(event) => setImportSourceSelection(event.target.value as TestCaseImportSourceSelection)}>
                    {TEST_CASE_IMPORT_SOURCE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </FormField>

                <FormField label="Import file">
                  <input accept=".csv,.xml,.json,text/csv,text/xml,application/xml,application/json" multiple onChange={(event) => void handleImportFile(event)} type="file" />
                </FormField>

                <FormField label="Default story">
                  <select value={importRequirementId} onChange={(event) => setImportRequirementId(event.target.value)}>
                    <option value="">No story</option>
                    {requirements.map((requirement) => (
                      <option key={requirement.id} value={requirement.id}>{requirement.title}</option>
                    ))}
                  </select>
                </FormField>
              </div>

              <div className="metric-strip compact">
                <div className="mini-card">
                  <strong>{importRows.length}</strong>
                  <span>Cases ready</span>
                </div>
                <div className="mini-card">
                  <strong>{importStepCount}</strong>
                  <span>Steps detected</span>
                </div>
                <div className="mini-card">
                  <strong>{importFileCount}</strong>
                  <span>Files queued</span>
                </div>
              </div>

              <div className="detail-summary">
                <strong>{importFileName || "No import file loaded yet"}</strong>
                <span>
                  {importSourceSummary
                    ? `${importSourceSummary} batch prepared. Missing suites are created automatically during import when a source references them.`
                    : "Use auto-detect or choose a source type before adding files to the batch queue."}
                </span>
              </div>

              {importBatches.length ? (
                <div className="table-wrap import-preview-table">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>File</th>
                        <th>Source</th>
                        <th>Cases</th>
                        <th>Warnings</th>
                      </tr>
                    </thead>
                    <tbody>
                      {importBatches.map((batch) => (
                        <tr key={batch.id}>
                          <td>{batch.fileName}</td>
                          <td>{getTestCaseImportSourceLabel(batch.source)}</td>
                          <td>{batch.rows.length}</td>
                          <td>{batch.warnings.length}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}

              {importWarnings.length ? (
                <div className="empty-state compact">
                  {importWarnings.slice(0, 4).map((warning) => (
                    <div key={warning}>{warning}</div>
                  ))}
                </div>
              ) : null}

              {importRows.length ? (
                <div className="table-wrap import-preview-table">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Title</th>
                        <th>References</th>
                        <th>Step count</th>
                        <th>Groups</th>
                        <th>Suites</th>
                        <th>Preview</th>
                      </tr>
                    </thead>
                    <tbody>
                      {importRows.slice(0, 5).map((row, index) => (
                        <tr key={`${row.title}-${index}`}>
                          <td>{row.title}</td>
                          <td>{formatReferenceList(row.external_references) || "—"}</td>
                          <td>{countImportedSteps(row)}</td>
                          <td>{countImportedGroups(row)}</td>
                          <td>{countImportedSuites(row)}</td>
                          <td>{getImportedStepPreviewLabel(row)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </div>

            <div className="action-row import-modal-actions">
              <button
                className="ghost-button"
                disabled={(!importBatches.length && !importWarnings.length) || importTestCases.isPending}
                onClick={() => {
                  setImportBatches([]);
                  setImportFileWarnings([]);
                  setImportSourceSelection("auto");
                }}
                type="button"
              >
                Clear
              </button>
	              {canImportTestCases ? (<button className="primary-button" disabled={!canImportTestCases || !appTypeId || !importRows.length || (importContainsProtectedAutomation && !canEditAutomationCode) || importTestCases.isPending} onClick={() => void handleBulkImport()} type="button">
                {importTestCases.isPending ? "Queuing…" : `Queue ${importRows.length || ""} Test Cases`}
              </button>) : null}
            </div>
          </div>
        </div>
      ) : null}

      {automationCloneSource ? createPortal(<ResourceModalShell title="Review cloned automation Start URL" closeDisabled={automationCloneSubmitting} onClose={() => { if (!automationCloneSubmitting) { setAutomationCloneSource(null); setAutomationCloneStartUrl(""); } }}>
        <form className="resource-form" onSubmit={event => { event.preventDefault(); void handleCloneCase(automationCloneSource, automationCloneStartUrl); }}>
          <div className="resource-form-body stack-list">
            <p>Enter the application URL for “{automationCloneSource.title} (Copy)”. The source case has no valid saved Start URL.</p>
            <label className="form-field"><span>Start URL (required)</span><input aria-label="Cloned automation start URL" type="url" required disabled={automationCloneSubmitting} value={automationCloneStartUrl} onChange={event => setAutomationCloneStartUrl(event.target.value)} placeholder="https://your-application.example.com" />{automationCloneStartUrl.trim() && automationStartUrlError(automationCloneStartUrl, true) ? <small role="alert">{automationStartUrlError(automationCloneStartUrl, true)}</small> : null}</label>
          </div>
          <div className="resource-form-footer"><button className="ghost-button" disabled={automationCloneSubmitting} type="button" onClick={() => { setAutomationCloneSource(null); setAutomationCloneStartUrl(""); }}>Cancel</button><button className="primary-button" disabled={automationCloneSubmitting || Boolean(automationStartUrlError(automationCloneStartUrl, true))} type="submit">{automationCloneSubmitting ? "Cloning…" : "Clone automation case"}</button></div>
        </form>
      </ResourceModalShell>, document.body) : null}

      {isAiCaseAuthoringOpen && canUseTestCaseAi ? (
        <AiCaseAuthoringModal
          processing={previewCaseAuthoring.isPending ? pendingAuthoringProcessing() : previewCaseAuthoring.data?.processing || getAiFailureProcessing(previewCaseAuthoring.error)}
          failure={previewCaseAuthoring.error}
          contextFiles={aiCaseContextFiles}
          onContextFilesChange={files=>{setAiCaseContextFiles(files);setAiCaseAuthoringPreview(null);}}
          additionalContext={aiCaseAuthoringAdditionalContext}
          externalLinksText={aiCaseAuthoringExternalLinksText}
          applyLabel={isCreating ? "Apply Improvement To Draft" : "Apply Reviewed Improvement"}
          closeDisabled={previewCaseAuthoring.isPending || updateTestCase.isPending}
	          disableApply={!canUseTestCaseAi || (!isCreating && !canUpdateTestCases) || (aiCaseAuthoringNeedsAutomationEdit && !canEditAutomationCode) || !aiCaseAuthoringPreview || updateTestCase.isPending}
	          disableGenerate={!canUseTestCaseAi || !appTypeId || previewCaseAuthoring.isPending || !integrations.length}
          hasAutomationWarning={aiCaseAuthoringAutomationStepCount > 0}
          integrationId={integrationId}
          integrations={integrations}
          isApplying={updateTestCase.isPending}
          isCreating={isCreating}
          isPreviewing={previewCaseAuthoring.isPending}
          onAddImages={(files) => void handleAddAiCaseAuthoringReferenceImages(files)}
          onAdditionalContextChange={(value) => {
            setAiCaseAuthoringAdditionalContext(value);
            setAiCaseAuthoringPreview(null);
            setAiCaseAuthoringMessage("");
          }}
          onApply={() => void handleApplyAiCaseAuthoring()}
          onClose={() => {
            setIsAiCaseAuthoringOpen(false);
            setAiCaseAuthoringPreview(null);
            setAiCaseAuthoringMessage("");
          }}
          onCancel={() => {
            aiCaseAuthoringControllerRef.current?.abort();
            aiCaseAuthoringControllerRef.current = null;
            previewCaseAuthoring.reset();
            setAiCaseAuthoringTone("success");
            setAiCaseAuthoringMessage("Stopped waiting. Existing drafts are unchanged.");
          }}
          onGenerate={(authoringMode) => void handlePreviewAiCaseAuthoring(authoringMode)}
          onIntegrationIdChange={(value) => {
            setIntegrationId(value);
            setAiCaseAuthoringPreview(null);
            setAiCaseAuthoringMessage("");
          }}
          onExternalLinksTextChange={(value) => {
            setAiCaseAuthoringExternalLinksText(value);
            setAiCaseAuthoringPreview(null);
            setAiCaseAuthoringMessage("");
          }}
          onPreviewMessageDismiss={() => setAiCaseAuthoringMessage("")}
          onPreviewChange={setAiCaseAuthoringPreview}
          onRequirementChange={(value) => {
            setAiCaseAuthoringRequirementId(value);
            setAiCaseAuthoringPreview(null);
            setAiCaseAuthoringMessage("");
          }}
          onRemoveImage={(imageUrl) => {
            setAiCaseAuthoringReferenceImages((current) => current.filter((image) => image.url !== imageUrl));
            setAiCaseAuthoringPreview(null);
            setAiCaseAuthoringMessage("");
          }}
          preview={aiCaseAuthoringPreview}
          previewMessage={aiCaseAuthoringMessage}
          previewTone={aiCaseAuthoringTone}
          appTypeName={appTypes.find((item) => item.id === appTypeId)?.name || "No app type selected"}
          promptTemplateAppTypeId={appTypeId}
          promptTemplateProjectId={projectId}
          requirementId={aiCaseAuthoringRequirementId}
          referenceImages={aiCaseAuthoringReferenceImages}
          requirements={requirements}
          sourceDraft={aiCaseAuthoringSourceDraft}
        />
      ) : null}

      {isAiStudioOpen && canUseTestCaseAi ? (
        <AiDesignStudioModal
          processing={previewDesignedCases.isPending ? pendingAuthoringProcessing() : previewDesignedCases.data?.processing || getAiFailureProcessing(previewDesignedCases.error)}
          failure={previewDesignedCases.error || createGenerationJob.error || undefined}
          imageLimit={AI_REFERENCE_IMAGE_LIMITS.testCaseGeneration}
          contextFiles={aiContextFiles}
          onContextFilesChange={files=>{setAiContextFiles(files);setAiPreviewCases([]);}}
          acceptLabel={`Save ${aiPreviewCases.length} case${aiPreviewCases.length === 1 ? "" : "s"}`}
          additionalContext={aiAdditionalContext}
          allowMultipleRequirements={true}
          appTypeName={appTypes.find((item) => item.id === appTypeId)?.name || "No app type selected"}
          closeDisabled={previewDesignedCases.isPending || acceptDesignedCases.isPending || createGenerationJob.isPending}
	          disableAccept={!canCreateTestCases || !aiPreviewCases.length || acceptDesignedCases.isPending}
	          disablePreview={!canUseTestCaseAi || !appTypeId || previewDesignedCases.isPending || !integrations.length}
	          disableSchedule={!canUseTestCaseAi || !canCreateTestCases || !aiRequirementIds.length || !appTypeId || createGenerationJob.isPending || !integrations.length}
          existingCases={aiExistingCases}
          existingCasesSubtitle="These reusable cases are already linked to one or more of the selected stories in the current app type."
          existingCasesTitle="Linked test cases"
          externalLinksText={aiExternalLinksText}
          eyebrow="AI Generation"
          integrationId={integrationId}
          integrations={integrations}
          isAccepting={acceptDesignedCases.isPending}
          isPreviewing={previewDesignedCases.isPending}
          isScheduling={createGenerationJob.isPending}
          maxCases={maxCases}
          onAccept={(selectedClientIds) => void handleAcceptDesignedCases(selectedClientIds)}
          onAddImages={(files) => void handleAddAiReferenceImages(files)}
          onAdditionalContextChange={(value) => {
            setAiAdditionalContext(value);
            setAiPreviewCases([]);
            setAiPreviewMessage("");
          }}
          onClose={() => {
            setIsAiStudioOpen(false);
            setAiPreviewCases([]);
            setAiPreviewMessage("");
          }}
          onExternalLinksTextChange={(value) => {
            setAiExternalLinksText(value);
            setAiPreviewCases([]);
            setAiPreviewMessage("");
          }}
          onIntegrationIdChange={(value) => {
            setIntegrationId(value);
            setAiPreviewCases([]);
            setAiPreviewMessage("");
          }}
          onViewExistingCase={openExistingCaseFromAi}
          onAuthoringModeChange={() => {
            setAiPreviewCases([]);
            setAiPreviewMessage("");
          }}
          onCancel={() => {
            aiDesignControllerRef.current?.abort();
            aiDesignControllerRef.current = null;
            previewDesignedCases.reset();
            setAiPreviewTone("success");
            setAiPreviewMessage("Stopped waiting. Existing drafts are unchanged.");
          }}
          onPreview={(authoringMode) => void handlePreviewDesignedCases(authoringMode)}
          onPreviewCaseChange={(clientId, next) => setAiPreviewCases((current) => current.map((candidate) => candidate.client_id === clientId ? next : candidate))}
          onPreviewCasesReorder={(orderedClientIds) => setAiPreviewCases((current) => {
            const byId = new Map(current.map(candidate => [candidate.client_id, candidate]));
            return [...new Set(orderedClientIds)].flatMap(id => byId.has(id) ? [byId.get(id)!] : []).concat(current.filter(candidate => !orderedClientIds.includes(candidate.client_id)));
          })}
          onSchedule={(authoringMode) => void handleScheduleDesignedCases(authoringMode)}
          onRemoveImage={(imageUrl) => {
            setAiReferenceImages((current) => current.filter((image) => image.url !== imageUrl));
            setAiPreviewCases([]);
            setAiPreviewMessage("");
          }}
          onRemovePreviewCase={(clientId) => setAiPreviewCases((current) => current.filter((candidate) => candidate.client_id !== clientId))}
          onRequirementSelectionChange={(requirementIds) => {
            setAiRequirementIds(requirementIds);
            setAiPreviewCases([]);
            setAiPreviewMessage("");
          }}
          onTogglePreviewRequirement={(clientId, requirementId) => {
            const requirement = requirements.find((item) => item.id === requirementId);

            if (!requirement) {
              return;
            }

            setAiPreviewCases((current) => toggleRequirementOnPreviewCase(current, clientId, requirementId, requirement.title));
          }}
          onMaxCasesChange={(value) => {
            setMaxCases(value);
            setAiPreviewCases([]);
            setAiPreviewMessage("");
          }}
          previewCases={aiPreviewCases}
          previewMessage={aiPreviewMessage}
          promptTemplateAppTypeId={appTypeId}
          promptTemplateProjectId={projectId}
          onPreviewMessageDismiss={() => setAiPreviewMessage("")}
          previewTone={aiPreviewTone}
          referenceImages={aiReferenceImages}
          requirementHelpText="Story selection is optional. Select the most relevant Story for better context, or describe the behavior and coverage you need in your instructions."
          requirementLabel="Stories"
          requirements={requirements}
          scheduleHelperText="Schedule batch AI generation for selected stories. The worker processes one story at a time with a cooldown between stories to reduce LLM rate-limit pressure, then returns generated cases as drafts with green accept and red reject actions."
          selectedRequirementIds={aiSelectedRequirements.map((requirement) => requirement.id)}
        />
      ) : null}

      <TestCaseChangeImpactDialog
        error={previewTestCaseChangeImpact.error instanceof Error && testCaseImpactRequestMatchesDraft ? previewTestCaseChangeImpact.error.message : null}
        loading={previewTestCaseChangeImpact.isPending && testCaseImpactRequestMatchesDraft}
        onClose={() => setIsTestCaseImpactPreviewOpen(false)}
        onRetry={() => runTestCaseImpactAnalysis(true)}
        open={canUseTestCaseAi && isTestCaseImpactPreviewOpen}
        response={selectedTestCaseImpactPreview}
        showAutomation={canUseAutomationWorkspace}
        testCaseTitle={caseDraft.title || selectedTestCase?.title || "Selected Test Case"}
      />

      {linkedPreviewCase ? (
        <LinkedTestCaseModal
          appTypeName={appTypes.find((item) => item.id === appTypeId)?.name || ""}
          projectName={selectedProject?.name || ""}
          requirements={requirements}
          suites={suites}
          testCase={linkedPreviewCase}
          onClose={() => setLinkedPreviewCaseId("")}
        />
      ) : null}
    </div>
  );
}
