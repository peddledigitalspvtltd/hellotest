import { takeAgentProposal } from "@hellotest/platform/frontend/src/lib/agentProposalDraft";
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
import { mergeAiReferenceImagesWithinBudget, parseExternalLinks, readImageFiles, toggleRequirementOnPreviewCase } from "@hellotest/ai/frontend/lib/aiDesignStudio";
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
  buildStepParameterDefinitionsFromValues,
  buildDataSetParameterValues,
  combineStepParameterValues,
  collectSensitiveDataSetParameterNames,
  collectStepParameters,
  excludeSensitiveStepParameterValues,
  mergeStepParameterDefinitions,
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

type TestCaseDraft = {
  ai_generation_source?: "interactive";
  title: string;
  description: string;
  externalReferencesText: string;
  labelsText: string;
  automated: "yes" | "no";
  priority: number;
  status: string;
  requirement_id: string;
  module_id: string;
  author_id: string;
  reviewer_id: string;
  authoring_mode: "structured" | "gherkin";
  test_case_type: NonNullable<TestCase["test_case_type"]>;
  gherkin_document: string;
};

type ExecutionStartMode = "manual" | "local" | "remote";
type TestCaseDeliveryContext = { release?: string; sprint?: string };

type StepDraft = {
  action: string;
  expected_result: string;
  step_type: TestStep["step_type"];
  automation_code: string;
  api_request: TestStep["api_request"];
};

type TestCaseAuthoringLens = "manual" | "ui-script" | "api-script";

type AuthoringStepProjection = Pick<TestStep, "id" | "step_order" | "action" | "expected_result" | "step_type" | "automation_code" | "api_request">;

type DraftTestStep = {
  id: string;
  action: string;
  expected_result: string;
  step_type: TestStep["step_type"];
  automation_code: string;
  api_request: TestStep["api_request"];
  group_id: string | null;
  group_name: string | null;
  group_kind: "local" | "reusable" | null;
  reusable_group_id: string | null;
};

type CopiedTestStep = {
  action: string;
  expected_result: string;
  step_type: TestStep["step_type"];
  automation_code: string;
  api_request: TestStep["api_request"];
  group_id: string | null;
  group_name: string | null;
  group_kind: "local" | "reusable" | null;
  reusable_group_id: string | null;
};

type StepInsertionGroupContext = Pick<CopiedTestStep, "group_id" | "group_name" | "group_kind" | "reusable_group_id">;

const stepClipboardScopeKey = (step: Pick<TestStep, "group_id" | "group_name" | "group_kind" | "reusable_group_id">) => {
  if ((step.group_name || "").trim().toLowerCase() === "preconditions") return "preconditions";
  if (step.reusable_group_id) return `shared:${step.reusable_group_id}`;
  if (step.group_id) return `group:${step.group_id}`;
  return "test-steps";
};

const stepInsertionContextFromStep = (
  step?: Pick<TestStep, "group_id" | "group_name" | "group_kind" | "reusable_group_id"> | null
): StepInsertionGroupContext | null => step?.group_id ? {
  group_id: step.group_id,
  group_name: step.group_name || null,
  group_kind: step.group_kind || null,
  reusable_group_id: step.reusable_group_id || null
} : null;

type CutStepSource = {
  stepIds: string[];
  testCaseId: string | null;
  isDraft: boolean;
};

type StepActionMenuAction = {
  label: string;
  description?: string;
  icon: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  tone?: "default" | "danger" | "primary";
};

type CaseStepFilter = "all" | "with-steps" | "no-steps";
type CaseRunFilter = "all" | "with-runs" | "no-runs";
const TEST_CASE_RENDER_BATCH_SIZE = 240;
const TEST_CASE_DETAIL_STALE_TIME_MS = 30_000;
const TEST_CASE_COPY_HYDRATION_BATCH_SIZE = 4;
const normalizeDeliveryScopeValue = (value: unknown) => String(value || "").trim().toLocaleLowerCase();
const testCaseDetailQueryKey = (projectId: string, testCaseId: string) =>
  ["test-case-detail", projectId || "unselected", testCaseId] as const;

type TestCaseExecutionAssigneeOption = AssigneeOption;

type TestCaseEditorSectionKey = "case" | "preconditions" | "steps" | "dataSets" | "automation" | "history";
type TestCaseDetailTab = "details" | "automation" | "assurance" | "suites" | "history" | "defects" | "evidence";

const isLegacyInlineAutomationBuilderEnabled = () => false;

const TEST_CASE_REVIEW_STATUS_LABELS: Record<NonNullable<TestCase["review_status"]>, string> = {
  not_requested: "Not requested",
  pending: "Pending",
  accepted: "Accepted",
  changes_requested: "Changes requested"
};

const TEST_CASE_WORKFLOW_STATUS_OPTIONS = [
  { value: "ai-generated", label: "AI Generated" },
  { value: "draft", label: "Draft" },
  { value: "pending-review", label: "Pending for review" },
  { value: "active", label: "Active" },
  { value: "ready", label: "Ready" },
  { value: "automated", label: "Automated" },
  { value: "retired", label: "Retired" },
  { value: "passed", label: "Passed" },
  { value: "failed", label: "Failed" }
];

const TEST_CASE_TYPE_OPTIONS: Array<{ value: NonNullable<TestCase["test_case_type"]>; label: string; description: string }> = [
  { value: "functional", label: "Functional", description: "Validates a user or system behavior." },
  { value: "regression", label: "Regression", description: "Protects an established behavior from change." },
  { value: "smoke", label: "Smoke", description: "Checks a critical path quickly." },
  { value: "integration", label: "Integration", description: "Validates boundaries between systems or services." },
  { value: "acceptance", label: "Acceptance", description: "Confirms a business outcome or acceptance criterion." },
  { value: "exploratory", label: "Exploratory", description: "Guides investigation without a rigid script." },
  { value: "performance", label: "Performance", description: "Measures response, throughput, or stability." },
  { value: "security", label: "Security", description: "Validates controls, permissions, and abuse resistance." },
  { value: "accessibility", label: "Accessibility", description: "Checks inclusive interaction and assistive support." },
  { value: "ios", label: "iOS", description: "Validates behavior specific to the iOS application." }
];

const TEST_CASE_WORKFLOW_STATUS_LABELS = Object.fromEntries(
  TEST_CASE_WORKFLOW_STATUS_OPTIONS.map((option) => [option.value, option.label])
) as Record<string, string>;

const getTestCaseWorkflowStatus = (testCase: TestCase, latestStatus?: string | null, fallbackStatus = "active") => {
  const normalizedLatest = String(latestStatus || "").toLowerCase();

  if (testCase.ai_generation_source === "scheduler" && testCase.ai_generation_review_status === "pending") {
    return "ai-generated";
  }

  if ((testCase.review_status || "not_requested") === "pending") {
    return "pending-review";
  }

  if (normalizedLatest === "failed" || normalizedLatest === "blocked") {
    return "failed";
  }

  if (normalizedLatest === "passed") {
    return "passed";
  }

  if (testCase.automated === "yes") {
    return "automated";
  }

  const normalizedStatus = String(testCase.status || fallbackStatus || "active").toLowerCase();
  return TEST_CASE_WORKFLOW_STATUS_LABELS[normalizedStatus] ? normalizedStatus : "active";
};

const formatTestCaseWorkflowStatus = (value: string) =>
  TEST_CASE_WORKFLOW_STATUS_LABELS[value] || formatTileCardLabel(value, "Active");

const formatCompactDuration = (durationMs: number | null) => {
  if (durationMs === null || !Number.isFinite(durationMs) || durationMs < 0) {
    return "No runs";
  }
  if (durationMs < 1_000) {
    return `${Math.round(durationMs)}ms`;
  }
  if (durationMs < 60_000) {
    const seconds = durationMs / 1_000;
    return `${seconds >= 10 ? Math.round(seconds) : seconds.toFixed(1)}s`;
  }
  const minutes = durationMs / 60_000;
  return `${minutes >= 10 ? Math.round(minutes) : minutes.toFixed(1)}m`;
};

const getTestCaseExecutionTypeLabel = (steps: Array<Pick<TestStep, "step_type" | "api_request">> = []) => {
  if (!steps.length) {
    return "Web";
  }

  const types = new Set(steps.map((step) => normalizeStepType(step.step_type)));
  const hasApi = Array.from(types).some((type) => type === "api") || steps.some((step) => Boolean(step.api_request));
  const hasWeb = types.has("web");
  const hasMobile = types.has("android") || types.has("ios");

  if (hasMobile && (hasWeb || hasApi || types.size > 1)) {
    return "Unified";
  }

  if (hasMobile) {
    return "Mobile";
  }

  if (hasApi && !hasWeb) {
    return "API";
  }

  return "Web";
};

function CaseLabelsField({
  value,
  onChange,
  availableLabels,
  domainField = "test_cases.labels"
}: {
  domainField?: string;
  value: string;
  onChange: (value: string) => void;
  availableLabels: string[];
}) {
  const suggestedLabels = useDomainSuggestions(domainField, availableLabels);
  const [draftLabel, setDraftLabel] = useState("");
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const inputId = `case-label-${useId().replace(/:/g, "")}`;
  const pickerRef = useRef<HTMLDivElement | null>(null);
  const selectedLabels = useMemo(() => parseReferenceList(value), [value]);
  const filteredLabels = useMemo(() => {
    const search = draftLabel.trim().toLowerCase();
    const selected = new Set(selectedLabels.map((label) => label.toLowerCase()));
    return suggestedLabels
      .filter((label) => !selected.has(label.value.toLowerCase()))
      .filter((label) => !search || `${label.label} ${label.value}`.toLowerCase().includes(search));
  }, [suggestedLabels, draftLabel, selectedLabels]);

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      if (!pickerRef.current?.contains(event.target as Node | null)) {
        setIsMenuOpen(false);
      }
    };

    window.addEventListener("mousedown", handlePointerDown);
    return () => window.removeEventListener("mousedown", handlePointerDown);
  }, []);

  const commitLabel = (label: string) => {
    const normalizedLabel = resolveDomainSuggestionValue(label, suggestedLabels);

    if (!normalizedLabel) {
      return;
    }

    if (!selectedLabels.some((item) => item.toLowerCase() === normalizedLabel.toLowerCase())) {
      onChange(formatReferenceList([...selectedLabels, normalizedLabel]));
    }

    setDraftLabel("");
    setIsMenuOpen(false);
  };

  const removeLabel = (labelToRemove: string) => {
    onChange(formatReferenceList(selectedLabels.filter((label) => label.toLowerCase() !== labelToRemove.toLowerCase())));
  };

  return (
    <FormField className="canonical-labels-field" composite inputId={inputId} label="Labels" labelIcon={<TagIcon size={15} />}>
      <div className="requirement-label-picker" ref={pickerRef}>
        <div className="requirement-label-combobox">
          <div className="requirement-label-entry">
            <input
              aria-autocomplete="list"
              aria-expanded={isMenuOpen}
              aria-label="Select or add labels"
              id={inputId}
              placeholder="Select or add label"
              role="combobox"
              value={draftLabel}
              onChange={(event) => {
                setDraftLabel(event.target.value);
                setIsMenuOpen(true);
              }}
              onFocus={() => setIsMenuOpen(true)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  commitLabel(draftLabel);
                }

                if (event.key === "Escape") {
                  setIsMenuOpen(false);
                }
              }}
            />
            {draftLabel.trim() ? (
              <button className="ghost-button requirement-label-add-button" onClick={() => commitLabel(draftLabel)} type="button">
                Add
              </button>
            ) : null}
          </div>
          {isMenuOpen && (filteredLabels.length || draftLabel.trim()) ? (
            <div className="requirement-label-menu" role="listbox" aria-label="Available labels">
              {filteredLabels.map((label) => (
                <button className="requirement-label-menu-option" key={label.value} onClick={() => commitLabel(label.value)} role="option" type="button">
                  {label.label}
                </button>
              ))}
              {draftLabel.trim() && !filteredLabels.some((label) => [label.value, label.label].some(value => value.toLowerCase() === draftLabel.trim().toLowerCase())) ? (
                <button className="requirement-label-menu-option is-add" onClick={() => commitLabel(draftLabel)} role="option" type="button">
                  Add "{draftLabel.trim()}"
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
        {selectedLabels.length ? (
          <div className="requirement-label-chip-row">
            {selectedLabels.map((label) => (
              <span className="requirement-label-chip" key={label}>
                {label}
                <button aria-label={`Remove ${label}`} onClick={() => removeLabel(label)} type="button">x</button>
              </span>
            ))}
          </div>
        ) : null}
      </div>
    </FormField>
  );
}

const createEmptyCaseDraft = (
  defaultStatus = "active",
  defaultAutomated: "yes" | "no" = "no",
  currentUserId = "",
  defaultType = "functional"
): TestCaseDraft => ({
  title: "",
  description: "",
  externalReferencesText: "",
  labelsText: "",
  automated: defaultAutomated,
  priority: 3,
  status: defaultStatus,
  requirement_id: "",
  module_id: "",
  author_id: currentUserId,
  reviewer_id: "",
  authoring_mode: "structured",
  test_case_type: defaultType,
  gherkin_document: ""
});

const EMPTY_STEP_DRAFT: StepDraft = {
  action: "",
  expected_result: "",
  step_type: "web",
  automation_code: "",
  api_request: null
};

const executionHistoryDateFormatter = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit"
});

const createDefaultTestCaseSections = (): Record<TestCaseEditorSectionKey, boolean> => ({
  case: true,
  preconditions: true,
  steps: true,
  dataSets: true,
  automation: false,
  history: false
});

const createCreateModeTestCaseSections = (): Record<TestCaseEditorSectionKey, boolean> => ({
  case: true,
  preconditions: true,
  steps: true,
  dataSets: true,
  automation: false,
  history: false
});

const createDraftStepId = () =>
  globalThis.crypto?.randomUUID?.() || `draft-step-${Date.now()}-${Math.random().toString(16).slice(2)}`;

const buildCaseStepsFromGherkin = (value: string, previousSteps: DraftTestStep[]): DraftTestStep[] => {
  const converted = gherkinToStructuredCase(value);
  const createStep = (): DraftTestStep => ({ id: createDraftStepId(), action: "", expected_result: "", step_type: "web", automation_code: "", api_request: null, group_id: null, group_name: null, group_kind: null, reusable_group_id: null });
  const isPrecondition = (step: DraftTestStep) => (step.group_name || "").toLowerCase() === "preconditions";
  const preconditions = mergeGherkinStepMetadata(converted.preconditions, previousSteps.filter(isPrecondition), createStep)
    .map((step) => ({ ...step, group_name: "Preconditions", group_kind: "local" as const }));
  const groupMembership = splitGherkinDocument(value).scenarios.flatMap((scenario) => collectBehaviorRowGroups(scenario.scenario));
  const main = mergeGherkinStepMetadata(converted.steps, previousSteps.filter((step) => !isPrecondition(step)), createStep)
    .map((step, index) => {
      const group = groupMembership[index];
      if (!group) return step;
      const previousGroup = previousSteps.find((item) => item.group_id === group.id);
      return { ...step, group_id: group.id, group_name: group.name, group_kind: "reusable" as const, reusable_group_id: previousGroup?.reusable_group_id || step.reusable_group_id };
    });
  return [...preconditions, ...main];
};

const buildGroupedCaseGherkin = (input: Omit<Parameters<typeof structuredCaseToGherkin>[0], "steps"> & { steps?: Array<Partial<TestStep>> }) => {
  const groups = (input.steps || []).reduce<Array<{ id: string; name: string; steps: Array<Partial<TestStep>> }>>((result, step) => {
    if (!step.group_id || step.group_kind !== "reusable") return result;
    const previous = result[result.length - 1];
    if (previous?.id === step.group_id) previous.steps.push(step);
    else result.push({ id: step.group_id, name: step.group_name || "Shared Step Group", steps: [step] });
    return result;
  }, []);
  return annotateGherkinStepGroups(structuredCaseToGherkin(input), groups.map((group) => ({
    id: group.id, name: group.name,
    lines: splitGherkinDocument(structuredCaseToGherkin({ title: input.title, steps: group.steps })).scenarios[0]?.scenario.split("\n").slice(1) || []
  })));
};

const createDraftGroupId = () =>
  globalThis.crypto?.randomUUID?.() || `draft-group-${Date.now()}-${Math.random().toString(16).slice(2)}`;

const buildGherkinQualitySteps = (document: string) => splitGherkinDocument(document).scenarios.map((item) => {
  const behaviorLines = item.scenario
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /^(?:Given|When|Then|And|But|\*)\b/i.test(line));
  const expectedIndex = behaviorLines.findIndex((line) => /^Then\b/i.test(line));
  const actionLines = behaviorLines.slice(0, expectedIndex < 0 ? behaviorLines.length : expectedIndex);
  const expectedLines = expectedIndex < 0 ? [] : behaviorLines.slice(expectedIndex);
  return {
    action: actionLines.join("\n"),
    expected_result: expectedLines.join("\n"),
    step_type: "web" as const,
    automation_code: null,
    api_request: null
  };
});

const calculateTestCaseAiQualityScore = ({
  title,
  description,
  steps,
  requirementId,
  labels,
  parameterValues
}: {
  title: string;
  description?: string | null;
  steps: Array<Pick<TestStep, "action" | "expected_result" | "step_type" | "automation_code" | "api_request">> | DraftTestStep[];
  requirementId?: string | null;
  labels?: string[];
  parameterValues?: Record<string, string>;
}) => {
  let score = 8;
  const plainTitle = richTextToPlainText(title);
  const plainDescription = richTextToPlainText(description || "");
  const meaningfulSteps = steps.filter((step) => richTextToPlainText(step.action || "").trim() || richTextToPlainText(step.expected_result || "").trim());
  const completeSteps = meaningfulSteps.filter((step) => richTextToPlainText(step.action || "").trim() && richTextToPlainText(step.expected_result || "").trim());
  const automationReadySteps = meaningfulSteps.filter((step) => {
    const hasAutomationCode = "automation_code" in step && richTextToPlainText(step.automation_code || "").trim();
    const hasApiRequest = "api_request" in step && step.api_request;
    return hasAutomationCode || hasApiRequest;
  });
  const parameterCount = Object.keys(parameterValues || {}).filter((key) => key.trim()).length;

  if (plainTitle.length >= 8) score += 12;
  if (plainTitle.length >= 28) score += 4;
  if (plainDescription.length >= 40) score += 14;
  if (plainDescription.length >= 120) score += 6;
  if (requirementId) score += 12;
  if (labels?.length) score += Math.min(10, labels.length * 4);
  if (meaningfulSteps.length) score += Math.min(22, meaningfulSteps.length * 5);
  if (meaningfulSteps.length && completeSteps.length === meaningfulSteps.length) score += 14;
  if (parameterCount) score += Math.min(8, parameterCount * 4);
  if (automationReadySteps.length) score += Math.min(8, automationReadySteps.length * 3);

  return Math.max(0, Math.min(100, score));
};

const buildTestCaseQualitySuggestions = ({
  title,
  description,
  steps,
  requirementId,
  labels,
  parameterValues,
  authoringMode = "structured"
}: {
  title: string;
  description?: string | null;
  steps: Array<Pick<TestStep, "action" | "expected_result" | "step_type" | "automation_code" | "api_request">> | DraftTestStep[];
  requirementId?: string | null;
  labels?: string[];
  parameterValues?: Record<string, string>;
  authoringMode?: "structured" | "gherkin";
}) => {
  const suggestions: string[] = [];
  const plainTitle = richTextToPlainText(title);
  const plainDescription = richTextToPlainText(description || "");
  const meaningfulSteps = steps.filter((step) => richTextToPlainText(step.action || "").trim() || richTextToPlainText(step.expected_result || "").trim());
  const incompleteSteps = meaningfulSteps.filter((step) => !richTextToPlainText(step.action || "").trim() || !richTextToPlainText(step.expected_result || "").trim());
  const parameterCount = Object.keys(parameterValues || {}).filter((key) => key.trim()).length;

  if (plainTitle.length < 28) suggestions.push("Make the title describe the business condition and expected outcome.");
  if (plainDescription.length < 120) suggestions.push("Add a richer description with scope, entry criteria, and validation intent.");
  if (!requirementId) suggestions.push("Link the test case to a story so coverage remains traceable.");
  if (!labels?.length) suggestions.push("Add labels for area, risk, platform, or release slicing.");
  if (authoringMode === "gherkin") {
    if (!meaningfulSteps.length) suggestions.push("Add at least one Scenario with an action and an observable Then outcome.");
    if (incompleteSteps.length) suggestions.push("Give every Scenario both an action and an observable Then outcome.");
  } else {
    if (meaningfulSteps.length < 3) suggestions.push("Add enough ordered steps to make the case independently executable.");
    if (incompleteSteps.length) suggestions.push("Complete both action and expected result for every step.");
  }
  if (!parameterCount) suggestions.push("Capture reusable Test Params where the case depends on specific values.");

  return suggestions;
};

const TEST_CASE_PARAMETER_DRAFT_STORAGE_KEY = "hellotest.testCaseParameterDrafts.v1";
const SUITE_PARAMETER_DRAFT_STORAGE_KEY = "hellotest.suiteParameterDrafts.v1";
const RUN_PARAMETER_PREVIEW_STORAGE_KEY = "hellotest.runParameterPreviewDrafts.v1";
const TEST_CASE_RUN_POLL_INTERVAL_MS = 20_000;

const normalizeScopedParameterValues = (
  values?: Record<string, unknown> | null,
  scope: StepParameterScope = "t"
) => normalizeStepParameterValues((values || {}) as Record<string, string>, scope);

const normalizeTestCaseParameterValues = (values?: Record<string, unknown> | null) =>
  normalizeScopedParameterValues(values, "t");

const normalizeSuiteParameterValues = (values?: Record<string, unknown> | null) =>
  normalizeScopedParameterValues(values, "s");

const normalizeRunParameterValues = (values?: Record<string, unknown> | null) =>
  normalizeScopedParameterValues(values, "r");

const serializeScopedParameterValues = (
  values?: Record<string, unknown> | null,
  scope: StepParameterScope = "t"
) =>
  JSON.stringify(
    Object.entries(normalizeScopedParameterValues(values, scope))
      .sort(([left], [right]) => left.localeCompare(right))
  );

const serializeTestCaseParameterValues = (values?: Record<string, unknown> | null) =>
  serializeScopedParameterValues(values, "t");

const areTestCaseParameterValuesEqual = (
  left?: Record<string, unknown> | null,
  right?: Record<string, unknown> | null
) => serializeTestCaseParameterValues(left) === serializeTestCaseParameterValues(right);

const areSuiteParameterValuesEqual = (
  left?: Record<string, unknown> | null,
  right?: Record<string, unknown> | null
) => serializeScopedParameterValues(left, "s") === serializeScopedParameterValues(right, "s");

const readStoredParameterDrafts = (storageKey: string, scope: StepParameterScope = "t") => {
  if (typeof window === "undefined") {
    return {};
  }

  try {
    const stored = window.localStorage.getItem(storageKey);

    if (!stored) {
      return {};
    }

    const parsed = JSON.parse(stored);

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }

    return Object.entries(parsed).reduce<Record<string, Record<string, string>>>((next, [scopeKey, values]) => {
      next[scopeKey] = normalizeScopedParameterValues(values as Record<string, unknown>, scope);
      return next;
    }, {});
  } catch {
    return {};
  }
};

const writeStoredParameterDrafts = (storageKey: string, drafts: Record<string, Record<string, string>>) => {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(storageKey, JSON.stringify(drafts));
  } catch {
    // Ignore storage failures and keep the in-memory editor responsive.
  }
};

const readStoredTestCaseParameterDrafts = () => readStoredParameterDrafts(TEST_CASE_PARAMETER_DRAFT_STORAGE_KEY, "t");
const readStoredSuiteParameterDrafts = () => readStoredParameterDrafts(SUITE_PARAMETER_DRAFT_STORAGE_KEY, "s");
const readStoredRunParameterDrafts = () => readStoredParameterDrafts(RUN_PARAMETER_PREVIEW_STORAGE_KEY, "r");

const readStoredParameterDraft = (
  storageKey: string,
  scopeKey: string,
  scope: StepParameterScope = "t"
) => {
  if (!scopeKey) {
    return {};
  }

  const drafts = readStoredParameterDrafts(storageKey, scope);
  return normalizeScopedParameterValues(drafts[scopeKey], scope);
};

const hasStoredParameterDraft = (
  storageKey: string,
  scopeKey: string,
  scope: StepParameterScope = "t"
) => {
  if (!scopeKey) {
    return false;
  }

  const drafts = readStoredParameterDrafts(storageKey, scope);
  return Object.prototype.hasOwnProperty.call(drafts, scopeKey);
};

const writeStoredParameterDraft = (
  storageKey: string,
  scopeKey: string,
  values: Record<string, string>,
  scope: StepParameterScope = "t"
) => {
  if (!scopeKey) {
    return;
  }

  const drafts = readStoredParameterDrafts(storageKey, scope);
  drafts[scopeKey] = normalizeScopedParameterValues(values, scope);
  writeStoredParameterDrafts(storageKey, drafts);
};

const clearStoredParameterDraft = (
  storageKey: string,
  scopeKey: string,
  scope: StepParameterScope = "t"
) => {
  if (!scopeKey || typeof window === "undefined") {
    return;
  }

  try {
    const drafts = readStoredParameterDrafts(storageKey, scope);

    if (!(scopeKey in drafts)) {
      return;
    }

    delete drafts[scopeKey];

    if (Object.keys(drafts).length) {
      writeStoredParameterDrafts(storageKey, drafts);
    } else {
      window.localStorage.removeItem(storageKey);
    }
  } catch {
    // Ignore storage failures and keep the in-memory editor responsive.
  }
};

const readStoredTestCaseParameterDraft = (scopeKey: string) => readStoredParameterDraft(TEST_CASE_PARAMETER_DRAFT_STORAGE_KEY, scopeKey, "t");
const hasStoredTestCaseParameterDraft = (scopeKey: string) => hasStoredParameterDraft(TEST_CASE_PARAMETER_DRAFT_STORAGE_KEY, scopeKey, "t");
const writeStoredTestCaseParameterDraft = (scopeKey: string, values: Record<string, string>) =>
  writeStoredParameterDraft(TEST_CASE_PARAMETER_DRAFT_STORAGE_KEY, scopeKey, values, "t");
const clearStoredTestCaseParameterDraft = (scopeKey: string) => clearStoredParameterDraft(TEST_CASE_PARAMETER_DRAFT_STORAGE_KEY, scopeKey, "t");
const readStoredSuiteParameterDraft = (scopeKey: string) => readStoredParameterDraft(SUITE_PARAMETER_DRAFT_STORAGE_KEY, scopeKey, "s");
const hasStoredSuiteParameterDraft = (scopeKey: string) => hasStoredParameterDraft(SUITE_PARAMETER_DRAFT_STORAGE_KEY, scopeKey, "s");
const writeStoredSuiteParameterDraft = (scopeKey: string, values: Record<string, string>) =>
  writeStoredParameterDraft(SUITE_PARAMETER_DRAFT_STORAGE_KEY, scopeKey, values, "s");
const clearStoredSuiteParameterDraft = (scopeKey: string) => clearStoredParameterDraft(SUITE_PARAMETER_DRAFT_STORAGE_KEY, scopeKey, "s");
const readStoredRunParameterDraft = (scopeKey: string) => readStoredParameterDraft(RUN_PARAMETER_PREVIEW_STORAGE_KEY, scopeKey, "r");
const writeStoredRunParameterDraft = (scopeKey: string, values: Record<string, string>) =>
  writeStoredParameterDraft(RUN_PARAMETER_PREVIEW_STORAGE_KEY, scopeKey, values, "r");
const clearStoredRunParameterDraft = (scopeKey: string) => clearStoredParameterDraft(RUN_PARAMETER_PREVIEW_STORAGE_KEY, scopeKey, "r");

const buildTestCaseParameterDraftScopeKey = ({
  isCreating,
  testCaseId,
  appTypeId
}: {
  isCreating: boolean;
  testCaseId?: string | null;
  appTypeId?: string | null;
}) => {
  if (isCreating) {
    return `draft:${appTypeId || "global"}`;
  }

  return testCaseId ? `case:${testCaseId}` : "";
};

const buildSuiteParameterDraftScopeKey = (suiteId?: string | null) => (suiteId ? `suite:${suiteId}` : "");
const buildRunParameterDraftScopeKey = (appTypeId?: string | null) => `run:${appTypeId || "global"}`;

const normalizeSharedGroupComparableText = (value?: string | null) =>
  richTextToPlainText(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();

const normalizeComparableAutomationCode = (value?: string | null) => normalizeAutomationCode(value).trim();

const normalizeComparableApiRequest = (value?: TestStep["api_request"]) =>
  JSON.stringify(normalizeApiRequest(value) || null);

const buildAuthoringLensCode = (title: string, steps: AuthoringStepProjection[], emptyMessage: string) => {
  if (!steps.length) {
    return `// ${emptyMessage}`;
  }

  const caseTitle = title.trim() || "Test case";
  const blocks = steps.map((step) => {
    const stepType = normalizeStepType(step.step_type);
    const stepLabel = [`Step ${step.step_order}`, stepType.toUpperCase()].join(" · ");
    const action = richTextToPlainText(step.action || "").trim();
    const expected = richTextToPlainText(step.expected_result || "").trim();

    return [
      `// ${stepLabel}`,
      action ? `// Manual action: ${action}` : "",
      expected ? `// Expected result: ${expected}` : "",
      resolveStepAutomationCode(step)
    ].filter(Boolean).join("\n");
  });

  return [`// Test case: ${caseTitle}`, ...blocks].join("\n\n");
};

const areComparableStepAutomationEqual = (
  left: Pick<TestStep, "step_type" | "automation_code" | "api_request">,
  right: Pick<TestStep, "step_type" | "automation_code" | "api_request">
) =>
  normalizeStepType(left.step_type) === normalizeStepType(right.step_type)
  && normalizeComparableAutomationCode(left.automation_code) === normalizeComparableAutomationCode(right.automation_code)
  && normalizeComparableApiRequest(left.api_request) === normalizeComparableApiRequest(right.api_request);

const normalizeDraftSteps = (steps: DraftTestStep[]) =>
  steps
    .map((step, index) => ({
      step_order: index + 1,
      action: step.action.trim(),
      expected_result: step.expected_result.trim(),
      step_type: normalizeStepType(step.step_type),
      automation_code: normalizeAutomationCode(step.automation_code) || undefined,
      api_request: normalizeApiRequest(step.api_request) || undefined,
      group_id: step.group_id || undefined,
      group_name: step.group_name?.trim() || undefined,
      group_kind: step.group_kind || undefined,
      reusable_group_id: step.reusable_group_id || undefined
    }))
    .filter((step) => richTextToPlainText(step.action).trim() || richTextToPlainText(step.expected_result).trim());

function stripAutomationStepFields<T extends { automation_code?: unknown; api_request?: unknown }>(step: T) {
  const { automation_code: _automationCode, api_request: _apiRequest, ...manualFields } = step;
  return manualFields;
}

function importedRowHasProtectedAutomation(row: ImportedTestCaseRow) {
  const containsProtectedValue = (value: unknown): boolean => {
    if (!value || typeof value !== "object") return false;
    if (Array.isArray(value)) return value.some(containsProtectedValue);
    return Object.entries(value).some(([key, child]) => {
      if (key === "automation_code") return Boolean(String(child || "").trim());
      if (key === "api_request") return Boolean(child && typeof child === "object" && Object.keys(child).length);
      return containsProtectedValue(child);
    });
  };

  return containsProtectedValue(row);
}

const buildDraftStepsFromAiAuthoringPreview = (preview: AiAuthoredTestCasePreview): DraftTestStep[] =>
  preview.steps.map((step) => ({
    id: createDraftStepId(),
    action: step.action || "",
    expected_result: step.expected_result || "",
    step_type: normalizeStepType(step.step_type),
    automation_code: "",
    api_request: null,
    group_id: null,
    group_name: null,
    group_kind: null,
    reusable_group_id: null
  }));

const buildPersistedStepsFromAiAuthoringPreview = (preview: AiAuthoredTestCasePreview) =>
  preview.steps.map((step) => ({
    step_order: step.step_order,
    step_type: normalizeStepType(step.step_type),
    action: step.action || undefined,
    expected_result: step.expected_result || undefined
  }));

const normalizeCopiedSteps = (
  steps: Array<Pick<TestStep, "action" | "expected_result" | "step_type" | "automation_code" | "api_request" | "group_id" | "group_name" | "group_kind" | "reusable_group_id">>,
  mode: "copy" | "cut"
): CopiedTestStep[] =>
  steps.map((step) => {
    if (mode === "cut") {
      return {
        action: step.action || "",
        expected_result: step.expected_result || "",
        step_type: normalizeStepType(step.step_type),
        automation_code: normalizeAutomationCode(step.automation_code),
        api_request: normalizeApiRequest(step.api_request),
        group_id: step.group_id || null,
        group_name: step.group_name || null,
        group_kind: step.group_kind || null,
        reusable_group_id: step.reusable_group_id || null
      };
    }

    return {
      action: step.action || "",
      expected_result: step.expected_result || "",
      step_type: normalizeStepType(step.step_type),
      automation_code: normalizeAutomationCode(step.automation_code),
      api_request: normalizeApiRequest(step.api_request),
      group_id: null,
      group_name: null,
      group_kind: null,
      reusable_group_id: null
    };
  });

const materializeCopiedSteps = (steps: CopiedTestStep[]) => {
  const nextGroupIds = new Map<string, string>();

  return steps.map((step) => {
    const nextGroupId = step.group_id
      ? (nextGroupIds.get(step.group_id) || createDraftGroupId())
      : null;

    if (step.group_id && nextGroupId && !nextGroupIds.has(step.group_id)) {
      nextGroupIds.set(step.group_id, nextGroupId);
    }

    return {
      ...step,
      group_id: nextGroupId
    };
  });
};

const formatBulkStepActionLabel = (
  step: Pick<TestStep, "action" | "group_id" | "group_name" | "group_kind" | "reusable_group_id">,
  sharedGroupNameById: Record<string, string>
) => {
  const action = step.action || "";

  if (step.reusable_group_id) {
    const sharedName = sharedGroupNameById[step.reusable_group_id] || step.group_name || "Shared Step Group";
    return `[Shared Step Group: ${sharedName}]${action ? ` ${action}` : ""}`;
  }

  if (step.group_id || (step.group_kind === "local" && step.group_name)) {
    return `[Group: ${step.group_name || "Grouped steps"}]${action ? ` ${action}` : ""}`;
  }

  return action;
};

function TestCaseActionIcon({ children }: { children: ReactNode }) {
  return (
    <svg aria-hidden="true" fill="none" height="16" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" viewBox="0 0 24 24" width="16">
      {children}
    </svg>
  );
}

function TestCaseImportIcon() {
  return (
    <TestCaseActionIcon>
      <path d="M12 3v12" />
      <path d="m7 10 5 5 5-5" />
      <path d="M5 21h14" />
    </TestCaseActionIcon>
  );
}

function TestCaseExportIcon() {
  return (
    <TestCaseActionIcon>
      <path d="M12 21V9" />
      <path d="m17 14-5-5-5 5" />
      <path d="M5 3h14" />
    </TestCaseActionIcon>
  );
}

function TestCaseSparkIcon() {
  return (
    <TestCaseActionIcon>
      <path d="m12 3 1.8 4.7L18 9.5l-4.2 1.8L12 16l-1.8-4.7L6 9.5l4.2-1.8Z" />
    </TestCaseActionIcon>
  );
}

function TestCaseCreateIcon() {
  return (
    <TestCaseActionIcon>
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </TestCaseActionIcon>
  );
}

function TestCaseDropdownIcon() {
  return (
    <TestCaseActionIcon>
      <path d="m6 9 6 6 6-6" />
    </TestCaseActionIcon>
  );
}

type TestCaseSplitAction = {
  label: string;
  description?: string;
  icon: ReactNode;
  disabled?: boolean;
  visible?: boolean;
  onClick: () => void;
};

function TestCaseSplitActionButton({
  label,
  icon,
  iconOnly = false,
  className = "",
  tone = "blue",
  disabled,
  visible = true,
  onClick,
  menuLabel,
  actions
}: {
  label: string;
  icon: ReactNode;
  iconOnly?: boolean;
  className?: string;
  tone?: "blue" | "green";
  disabled?: boolean;
  visible?: boolean;
  onClick: () => void;
  menuLabel: string;
  actions: TestCaseSplitAction[];
}) {
  const [isOpen, setIsOpen] = useState(false);
  const triggerRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const permittedActions = actions.filter(action => action.visible !== false);
  const primaryAction = visible ? { label, icon, disabled, onClick } : permittedActions[0];
  const menuActions = visible ? permittedActions : permittedActions.slice(1);
  const canOpenMenu = menuActions.length > 0;
  const { menuStyle } = useSplitActionMenu(isOpen && canOpenMenu, triggerRef, menuRef);

  useEffect(() => {
    if (!isOpen) return;

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setIsOpen(false);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsOpen(false);
    };

    window.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  const menu = isOpen && canOpenMenu ? (
    <div data-split-action-menu className={["run-action-dropdown test-case-action-dropdown", tone === "green" ? "test-case-run-action-dropdown" : ""].filter(Boolean).join(" ")} ref={menuRef} role="menu" style={menuStyle}>
      {menuActions.map((action) => (
        <button
          disabled={action.disabled}
          key={action.label}
          onClick={() => {
            setIsOpen(false);
            action.onClick();
          }}
          role="menuitem"
          type="button"
        >
          <span className="run-action-option-icon">{action.icon}</span>
          <strong>{action.label}</strong>
        </button>
      ))}
    </div>
  ) : null;

  if (!primaryAction) return null;

  return (
    <div className={["create-run-action-button", tone === "blue" ? "test-case-split-action-button" : "test-case-run-split-action-button", canOpenMenu ? "" : "is-single", iconOnly ? "is-explorer-compact" : "", className].filter(Boolean).join(" ")} ref={triggerRef}>
      <button aria-label={iconOnly ? primaryAction.label : undefined} className="run-action-main issue-report-split-main" disabled={primaryAction.disabled} onClick={primaryAction.onClick} title={iconOnly ? primaryAction.label : undefined} type="button">
        {primaryAction.icon}
        {iconOnly ? null : <span>{primaryAction.label}</span>}
      </button>
      {canOpenMenu ? (
        <button
          aria-expanded={isOpen}
          aria-haspopup="menu"
          aria-label={menuLabel}
          className="run-action-toggle"
          onClick={() => setIsOpen((current) => !current)}
          type="button"
        >
          <TestCaseDropdownIcon />
        </button>
      ) : null}
      {menu ? createPortal(menu, document.body) : null}
    </div>
  );
}

function TestCaseDeleteIcon() {
  return (
    <TestCaseActionIcon>
      <path d="M4 7h16" />
      <path d="M9 7V4h6v3" />
      <path d="M7 7v11a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2V7" />
      <path d="M10 11v5" />
      <path d="M14 11v5" />
    </TestCaseActionIcon>
  );
}

function TestCaseRunIcon() {
  return (
    <TestCaseActionIcon>
      <path d="m9 7 8 5-8 5z" fill="currentColor" stroke="none" />
    </TestCaseActionIcon>
  );
}

function DeferredTestCaseCatalogValue({ field }: { field: string }) {
  const guidance = `Open this test case to load ${field}.`;
  return <span aria-label={guidance} title={guidance}>On open</span>;
}

function ModuleChevronIcon({ isExpanded }: { isExpanded: boolean }) {
  return (
    <span aria-hidden="true" className="hierarchy-toggle-glyph" data-state={isExpanded ? "expanded" : "collapsed"}>
      {isExpanded ? <ChevronDownIcon size={16} /> : <ChevronRightIcon size={16} />}
    </span>
  );
}

function ModulePencilIcon() {
  return (
    <TestCaseActionIcon>
      <path d="M4 20h4" />
      <path d="M14.5 5.5 18.5 9.5" />
      <path d="m6 18 10.5-10.5a2.1 2.1 0 0 1 3 3L9 21H6z" />
    </TestCaseActionIcon>
  );
}

function TestCaseFlowMapIcon() {
  return (
    <TestCaseActionIcon>
      <rect height="4" rx="1" width="7" x="8.5" y="3.5" />
      <rect height="4" rx="1" width="7" x="3" y="16.5" />
      <rect height="4" rx="1" width="7" x="14" y="16.5" />
      <path d="M12 7.5v4.5" />
      <path d="M6.5 16.5V12H17.5v4.5" />
    </TestCaseActionIcon>
  );
}

function TestCaseAcceptIcon() {
  return (
    <TestCaseActionIcon>
      <path d="M6 12.5 10 16l8-8" />
    </TestCaseActionIcon>
  );
}

function TestCaseRejectIcon() {
  return (
    <TestCaseActionIcon>
      <path d="m8 8 8 8" />
      <path d="m16 8-8 8" />
    </TestCaseActionIcon>
  );
}

function TestCaseTileActionButton({
  children,
  className = "",
  disabled = false,
  onClick,
  title
}: {
  children: ReactNode;
  className?: string;
  disabled?: boolean;
  onClick: () => void;
  title: string;
}) {
  return (
    <button
      aria-label={title}
      className={["test-case-tile-action-button", className].filter(Boolean).join(" ")}
      disabled={disabled}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      title={title}
      type="button"
    >
      {children}
    </button>
  );
}

const formatExecutionHistoryDate = (value?: string | null) => {
  if (!value) {
    return "Recent run";
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : executionHistoryDateFormatter.format(parsed);
};

function resolveScopedIntegration(integrations: Integration[], type: Integration["type"], projectId: string) {
  const active = integrations.filter((integration) => integration.type === type && integration.is_active);
  const scoped = projectId
    ? active.find((integration) => String(integration.config?.project_id || "") === projectId)
    : null;

  return scoped || active.find((integration) => !String(integration.config?.project_id || "").trim()) || active[0] || null;
}

function formatRecorderDisplayMode(value?: string | null) {
  return value === "browser-live-view" ? "Live view" : value === "local-browser-with-live-view" ? "Local browser + live view" : "Recorder";
}

type CreateModuleDraft = {
  description: string;
  name: string;
  requirementIds: string[];
  testCaseIds: string[];
};

const MAX_CREATE_MODULE_REQUIREMENTS = 100;

const formatModuleCaseUpdatedAt = (value?: string | null) => {
  if (!value) return "—";
  const updatedAt = new Date(value);
  if (Number.isNaN(updatedAt.getTime())) return value;
  const elapsedMs = Math.max(0, Date.now() - updatedAt.getTime());
  const elapsedHours = Math.floor(elapsedMs / 3_600_000);
  if (elapsedHours < 1) return "Just now";
  if (elapsedHours < 24) return `${elapsedHours}h ago`;
  const elapsedDays = Math.floor(elapsedHours / 24);
  if (elapsedDays === 1) return "Yesterday";
  if (elapsedDays < 14) return `${elapsedDays}d ago`;
  return updatedAt.toLocaleDateString(undefined, { day: "numeric", month: "short" });
};

function ModuleRequirementPicker({
  candidateRequirements,
  canSelectRequirements,
  hasMoreRequirements,
  isLoadingMoreRequirements,
  isLoadingRequirements,
  isLocked,
  isSaving,
  onLoadMoreRequirements,
  onSelectionChange,
  selectedIds
}: {
  candidateRequirements: Requirement[];
  canSelectRequirements: boolean;
  hasMoreRequirements: boolean;
  isLoadingMoreRequirements: boolean;
  isLoadingRequirements: boolean;
  isLocked: boolean;
  isSaving: boolean;
  onLoadMoreRequirements: () => void | Promise<unknown>;
  onSelectionChange: (ids: string[]) => void;
  selectedIds: string[];
}) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [priorityFilter, setPriorityFilter] = useState("");
  const [isFilterMenuOpen, setIsFilterMenuOpen] = useState(false);
  const filterMenuRef = useRef<HTMLDivElement | null>(null);
  const filterTriggerRef = useRef<HTMLButtonElement | null>(null);
  const selectAllVisibleRef = useRef<HTMLInputElement | null>(null);
  const isDisabled = !canSelectRequirements || isLocked || isSaving;
  const visibleOptions = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    return candidateRequirements
      .filter((requirement) => {
        if (statusFilter && String(requirement.status || "").toLowerCase() !== statusFilter.toLowerCase()) return false;
        if (priorityFilter && String(requirement.priority ?? "") !== priorityFilter) return false;
        if (!normalizedSearch) return true;
        return [
          requirement.display_id || "",
          requirement.id,
          requirement.title,
          requirement.status || "",
          requirement.priority === null || requirement.priority === undefined ? "" : `P${requirement.priority}`
        ].some((value) => String(value).toLowerCase().includes(normalizedSearch));
      })
      .sort((left, right) => (
        left.title.localeCompare(right.title)
        || String(left.display_id || left.id).localeCompare(String(right.display_id || right.id))
      ));
  }, [candidateRequirements, priorityFilter, search, statusFilter]);
  const statusOptions = useMemo(
    () => [...new Set(candidateRequirements.map((requirement) => String(requirement.status || "").trim()).filter(Boolean))].sort(),
    [candidateRequirements]
  );
  const priorityOptions = useMemo(
    () => [...new Set(candidateRequirements
      .map((requirement) => requirement.priority)
      .filter((priority): priority is number => priority !== null && priority !== undefined))]
      .sort((left, right) => left - right),
    [candidateRequirements]
  );
  const visibleIds = visibleOptions.map((requirement) => requirement.id);
  const visibleSelectedCount = visibleIds.filter((requirementId) => selectedIds.includes(requirementId)).length;
  const areAllVisibleSelected = Boolean(visibleIds.length) && visibleSelectedCount === visibleIds.length;
  const areSomeVisibleSelected = visibleSelectedCount > 0 && !areAllVisibleSelected;

  useEffect(() => {
    if (selectAllVisibleRef.current) {
      selectAllVisibleRef.current.indeterminate = areSomeVisibleSelected;
    }
  }, [areSomeVisibleSelected]);

  useEffect(() => {
    if (!isFilterMenuOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (!filterMenuRef.current?.contains(event.target as Node)) {
        setIsFilterMenuOpen(false);
      }
    };
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [isFilterMenuOpen]);

  const setVisibleSelection = (checked: boolean) => {
    onSelectionChange(checked
      ? [...new Set([...selectedIds, ...visibleIds])]
      : selectedIds.filter((requirementId) => !visibleIds.includes(requirementId)));
  };

  return (
    <section
      className="test-case-create-module-requirements"
      aria-labelledby="module-requirements-heading"
      onKeyDownCapture={(event) => {
        if (event.key === "Escape" && isFilterMenuOpen) {
          event.preventDefault();
          event.stopPropagation();
          setIsFilterMenuOpen(false);
          window.requestAnimationFrame(() => filterTriggerRef.current?.focus());
        }
      }}
    >
      <div className="test-case-create-module-section-heading test-case-create-module-requirement-heading">
        <div>
          <h3 id="module-requirements-heading">Requirement Selection</h3>
          {isLocked ? <p>The selected Requirements were saved when this module was created.</p> : null}
          {!isLocked && !canSelectRequirements ? <p>Viewing Requirements requires Story access.</p> : null}
        </div>
        <span className="test-case-create-module-selection-count" aria-live="polite">
          {selectedIds.length} selected
        </span>
      </div>

      <div className="test-case-create-module-picker-panel test-case-create-module-requirement-panel">
        <div className="test-case-create-module-picker-toolbar test-case-create-module-requirement-toolbar">
          <label className="test-case-create-module-search">
            <SearchIcon size={16} />
            <span className="sr-only">Search Requirements</span>
            <input
              aria-label="Search Requirements by ID or title"
              disabled={isDisabled}
              onChange={(event) => setSearch(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") event.preventDefault();
              }}
              placeholder="Search ID or title..."
              type="search"
              value={search}
            />
          </label>
          <div className="test-case-create-module-filter-wrap" ref={filterMenuRef}>
            <button
              aria-controls="create-module-requirement-filter-menu"
              aria-expanded={isFilterMenuOpen}
              aria-haspopup="dialog"
              aria-label="Filter Requirements"
              className={statusFilter || priorityFilter ? "ghost-button is-active" : "ghost-button"}
              disabled={isDisabled}
              onClick={() => setIsFilterMenuOpen((current) => !current)}
              ref={filterTriggerRef}
              type="button"
            >
              <IconFilter aria-hidden="true" size={15} stroke={1.8} />
              <span className="sr-only">Filters</span>
            </button>
            {isFilterMenuOpen ? (
              <div
                aria-label="Filter Requirements"
                className="test-case-create-module-filter-menu test-case-create-module-requirement-filter-menu"
                id="create-module-requirement-filter-menu"
                role="dialog"
              >
                <FormField label="Status">
                  <select disabled={isSaving} value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
                    <option value="">All statuses</option>
                    {statusOptions.map((status) => <option key={status} value={status}>{status}</option>)}
                  </select>
                </FormField>
                <FormField label="Priority">
                  <select disabled={isSaving} value={priorityFilter} onChange={(event) => setPriorityFilter(event.target.value)}>
                    <option value="">All priorities</option>
                    {priorityOptions.map((priority) => <option key={priority} value={priority}>P{priority}</option>)}
                  </select>
                </FormField>
                <button
                  className="ghost-button test-case-create-module-clear-filters"
                  disabled={!statusFilter && !priorityFilter}
                  onClick={() => {
                    setStatusFilter("");
                    setPriorityFilter("");
                  }}
                  type="button"
                >
                  Clear filters
                </button>
              </div>
            ) : null}
          </div>
          <div className="test-case-create-module-selection-actions" aria-label="Requirement selection actions">
            <button
              aria-label="Select visible Requirements"
              className="ghost-button"
              disabled={isDisabled || !visibleIds.length || areAllVisibleSelected}
              onClick={() => setVisibleSelection(true)}
              title="Select visible Requirements"
              type="button"
            >
              <SelectionToggleIcon checked />
              Select all visible
            </button>
            <span aria-hidden="true" className="test-case-create-module-action-divider" />
            <button
              aria-label="Clear selected Requirements"
              className="ghost-button"
              disabled={isDisabled || !selectedIds.length}
              onClick={() => onSelectionChange([])}
              title="Clear selected Requirements"
              type="button"
            >
              <SelectionToggleIcon checked={false} />
              Clear
            </button>
          </div>
        </div>

        <div
          aria-busy={isLoadingRequirements || isLoadingMoreRequirements}
          aria-label="Requirements available for this module"
          className="test-case-create-module-options test-case-create-module-requirement-options"
          role="table"
        >
          <div className="test-case-create-module-table-head test-case-create-module-requirement-table-head" role="row">
            <span className="test-case-create-module-table-select" role="columnheader">
              <input
                aria-label="Select all visible Requirements"
                checked={areAllVisibleSelected}
                disabled={isDisabled || !visibleIds.length}
                onChange={(event) => setVisibleSelection(event.target.checked)}
                ref={selectAllVisibleRef}
                type="checkbox"
              />
            </span>
            <span role="columnheader">Requirement</span>
            <span role="columnheader">Priority</span>
            <span role="columnheader">Status</span>
          </div>
          {visibleOptions.map((requirement) => {
            const isChecked = selectedIds.includes(requirement.id);
            const requirementLabel = requirement.display_id || "Story";
            return (
              <div
                className={isChecked
                  ? "test-case-create-module-option test-case-create-module-requirement-option is-selected"
                  : "test-case-create-module-option test-case-create-module-requirement-option"}
                key={requirement.id}
                onClick={() => {
                  if (isDisabled) return;
                  onSelectionChange(isChecked
                    ? selectedIds.filter((requirementId) => requirementId !== requirement.id)
                    : [...new Set([...selectedIds, requirement.id])]);
                }}
                role="row"
              >
                <span className="test-case-create-module-option-select" role="cell">
                  <input
                    aria-label={`${isChecked ? "Remove" : "Add"} ${requirementLabel} ${isChecked ? "from" : "to"} the new module`}
                    checked={isChecked}
                    disabled={isDisabled}
                    onChange={(event) => onSelectionChange(event.target.checked
                      ? [...new Set([...selectedIds, requirement.id])]
                      : selectedIds.filter((requirementId) => requirementId !== requirement.id))}
                    onClick={(event) => event.stopPropagation()}
                    type="checkbox"
                  />
                </span>
                <span className="test-case-create-module-requirement-identity" role="cell">
                  <span className="test-case-create-module-option-id">
                    <StoryIcon size={15} />
                    <strong>{requirementLabel}</strong>
                  </span>
                  <span className="test-case-create-module-option-title" title={requirement.title}>{requirement.title}</span>
                </span>
                <span className="test-case-create-module-requirement-priority" role="cell">
                  {requirement.priority === null || requirement.priority === undefined ? "—" : `P${requirement.priority}`}
                </span>
                <span className="test-case-create-module-option-status" role="cell">
                  <StatusBadge value={requirement.status || "Unassigned"} />
                </span>
              </div>
            );
          })}
          {isLoadingRequirements && !visibleOptions.length ? <LoadingState label="Loading Requirements" /> : null}
          {!isLoadingRequirements && !visibleOptions.length ? (
            <div className="empty-state compact">
              {!canSelectRequirements
                ? "Requirement access is not available."
                : search.trim() || statusFilter || priorityFilter
                  ? hasMoreRequirements
                    ? "Searching additional Requirements…"
                    : "No Requirements match these filters."
                  : "No Requirements are available in this project."}
            </div>
          ) : null}
          {hasMoreRequirements ? (
            <div className="test-case-create-module-load-more" role="row">
              <span role="cell">
                <HierarchyAutoLoadSentinel
                  isLoading={isDisabled || isLoadingMoreRequirements}
                  onLoad={onLoadMoreRequirements}
                  progressKey={candidateRequirements.length}
                  scopeLabel="Requirements"
                />
              </span>
            </div>
          ) : null}
        </div>
      </div>
      {selectedIds.length > MAX_CREATE_MODULE_REQUIREMENTS ? (
        <p className="test-case-create-module-requirement-limit" role="alert">
          Select no more than {MAX_CREATE_MODULE_REQUIREMENTS} Requirements.
        </p>
      ) : null}
    </section>
  );
}

function TestCaseCreateModuleModal({
  projectId,
  appTypeId,
  assignmentRetryName,
  canAssignCases,
  canSelectRequirements,
  candidateRequirements,
  candidateTestCases,
  hasMoreRequirements,
  isLoadingMoreRequirements,
  isLoadingRequirements,
  isSaving,
  moduleNameByCaseId,
  initialSelectedIds,
  onClose,
  onLoadMoreRequirements,
  onResolveRequirementCases,
  onSubmit
}: {
  projectId: string;
  appTypeId: string;
  assignmentRetryName?: string;
  canAssignCases: boolean;
  canSelectRequirements: boolean;
  candidateRequirements: Requirement[];
  candidateTestCases: TestCase[];
  hasMoreRequirements: boolean;
  isLoadingMoreRequirements: boolean;
  isLoadingRequirements: boolean;
  isSaving: boolean;
  moduleNameByCaseId: ReadonlyMap<string, string>;
  initialSelectedIds: string[];
  onClose: () => void;
  onLoadMoreRequirements: () => void | Promise<unknown>;
  onResolveRequirementCases: (requirementIds: string[]) => Promise<TestCase[]>;
  onSubmit: (draft: CreateModuleDraft) => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [selectedRequirementIds, setSelectedRequirementIds] = useState<string[]>([]);
  const selectedRequirementIdsRef = useRef<string[]>([]);
  const [manualSelectedCaseIds, setManualSelectedCaseIds] = useState<string[]>(() => (
    canAssignCases ? [...new Set(initialSelectedIds)] : []
  ));
  const [selectedCaseOrder, setSelectedCaseOrder] = useState<string[]>(() => (
    canAssignCases ? [...new Set(initialSelectedIds)] : []
  ));
  const [excludedAutoCaseIds, setExcludedAutoCaseIds] = useState<string[]>([]);
  const [linkedCasesByRequirement, setLinkedCasesByRequirement] = useState<Record<string, TestCase[]>>({});
  const [resolvingRequirementIds, setResolvingRequirementIds] = useState<string[]>([]);
  const [failedRequirementIds, setFailedRequirementIds] = useState<string[]>([]);
  const candidateCasesWithLinkedCases = useMemo(() => {
    const byId = new Map(candidateTestCases.map((testCase) => [testCase.id, testCase]));
    Object.values(linkedCasesByRequirement)
      .flat()
      .forEach((testCase) => byId.set(testCase.id, testCase));
    return [...byId.values()];
  }, [candidateTestCases, linkedCasesByRequirement]);
  const activeAutoLinkedCaseIds = useMemo(() => [...new Set(
    selectedRequirementIds.flatMap((requirementId) => (
      linkedCasesByRequirement[requirementId] || []
    ).map((testCase) => testCase.id))
  )], [linkedCasesByRequirement, selectedRequirementIds]);
  const excludedAutoCaseIdSet = useMemo(() => new Set(excludedAutoCaseIds), [excludedAutoCaseIds]);
  const selectedCaseMembership = useMemo(() => [...new Set([
    ...manualSelectedCaseIds,
    ...activeAutoLinkedCaseIds.filter((testCaseId) => !excludedAutoCaseIdSet.has(testCaseId))
  ])], [activeAutoLinkedCaseIds, excludedAutoCaseIdSet, manualSelectedCaseIds]);
  const selectedIds = useMemo(() => {
    const membership = new Set(selectedCaseMembership);
    return [...new Set([...selectedCaseOrder, ...selectedCaseMembership])].filter(id => membership.has(id));
  }, [selectedCaseMembership, selectedCaseOrder]);
  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const activeResolvingRequirementIds = resolvingRequirementIds.filter((requirementId) => selectedRequirementIds.includes(requirementId));
  const activeFailedRequirementIds = failedRequirementIds.filter((requirementId) => selectedRequirementIds.includes(requirementId));
  const isResolvingRequirementCases = canAssignCases && activeResolvingRequirementIds.length > 0;
  const hasRequirementCaseResolutionError = canAssignCases && activeFailedRequirementIds.length > 0;
  const selectedAutoLinkedCaseCount = activeAutoLinkedCaseIds.filter((testCaseId) => selectedIdSet.has(testCaseId)).length;
  const closeModal = () => {
    if (!isSaving) onClose();
  };
  const dialogRef = useDialogFocus<HTMLFormElement>({
    active: true,
    closeDisabled: isSaving,
    onClose: closeModal
  });
  const selectedAssignedCaseCount = selectedIds.filter((testCaseId) => moduleNameByCaseId.has(testCaseId)).length;
  const isRequirementSelectionOverLimit = selectedRequirementIds.length > MAX_CREATE_MODULE_REQUIREMENTS;
  const resolveLinkedRequirementCases = async (requirementIds: string[]) => {
    const ids = [...new Set(requirementIds.filter(Boolean))];
    if (!canAssignCases || !ids.length) return;

    setResolvingRequirementIds((current) => [...new Set([...current, ...ids])]);
    setFailedRequirementIds((current) => current.filter((requirementId) => !ids.includes(requirementId)));

    try {
      const batches: string[][] = [];
      for (let offset = 0; offset < ids.length; offset += MAX_CREATE_MODULE_REQUIREMENTS) {
        batches.push(ids.slice(offset, offset + MAX_CREATE_MODULE_REQUIREMENTS));
      }
      const responses = await Promise.all(batches.map((batch) => onResolveRequirementCases(batch)));
      const linkedCases = [...new Map(
        responses.flat().map((testCase) => [testCase.id, testCase])
      ).values()];

      setLinkedCasesByRequirement((current) => {
        const next = { ...current };
        ids.forEach((requirementId) => {
          next[requirementId] = linkedCases.filter((testCase) => (
            testCase.requirement_ids || (testCase.requirement_id ? [testCase.requirement_id] : [])
          ).includes(requirementId));
        });
        return next;
      });
    } catch {
      const activeIds = ids.filter((requirementId) => selectedRequirementIdsRef.current.includes(requirementId));
      if (activeIds.length) {
        setFailedRequirementIds((current) => [...new Set([...current, ...activeIds])]);
      }
    } finally {
      setResolvingRequirementIds((current) => current.filter((requirementId) => !ids.includes(requirementId)));
    }
  };

  const handleRequirementSelectionChange = (nextRequirementIds: string[]) => {
    const nextIds = [...new Set(nextRequirementIds.filter(Boolean))];
    const currentIds = selectedRequirementIdsRef.current;
    const newlySelectedRequirementIds = nextIds.filter((requirementId) => !currentIds.includes(requirementId));
    selectedRequirementIdsRef.current = nextIds;
    setSelectedRequirementIds(nextIds);

    const unresolvedRequirementIds = newlySelectedRequirementIds.filter((requirementId) => (
      !Object.prototype.hasOwnProperty.call(linkedCasesByRequirement, requirementId)
    ));
    if (unresolvedRequirementIds.length) {
      void resolveLinkedRequirementCases(unresolvedRequirementIds);
    }
  };

  const updateCaseSelection = (nextIds: string[]) => {
    const nextIdSet = new Set(nextIds);
    // Keep the explicit order independent of automatic Requirement membership.
    // Moving an automatic case must not turn it into a permanent manual choice.
    setSelectedCaseOrder([...nextIdSet]);
    // Existing automatic selections stay tied to their Requirements. Only an
    // explicit addition becomes manual; exclusions survive search and paging.
    setManualSelectedCaseIds((current) => [...new Set([
      ...current.filter((id) => nextIdSet.has(id)),
      ...nextIds.filter((id) => !selectedIdSet.has(id))
    ])]);
    setExcludedAutoCaseIds((current) => [...new Set([
      ...current.filter((id) => !nextIdSet.has(id)),
      ...activeAutoLinkedCaseIds.filter((id) => !nextIdSet.has(id))
    ])]);
  };

  return (
    <div
      className="modal-backdrop modal-backdrop--scroll test-case-create-module-backdrop"
      onClick={closeModal}
      role="presentation"
    >
      <form
        aria-describedby="create-test-case-module-description"
        aria-labelledby="create-test-case-module-title"
        aria-modal="true"
        className="modal-card requirement-create-modal test-case-create-module-modal"
        onClick={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault();
          if (
            !name.trim()
            || isSaving
            || isRequirementSelectionOverLimit
            || isResolvingRequirementCases
            || hasRequirementCaseResolutionError
          ) return;
          onSubmit({
            description,
            name: name.trim(),
            requirementIds: canSelectRequirements ? selectedRequirementIds : [],
            testCaseIds: canAssignCases ? selectedIds : []
          });
        }}
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
      >
        <div className="test-case-create-module-header">
          <div className="test-case-create-module-title">
            <div>
              <div className="test-case-create-module-title-row">
                <span className="test-case-create-module-title-icon"><ModuleIcon size={20} /></span>
                <h2 className="dialog-title" id="create-test-case-module-title">Create module</h2>
              </div>
              <p id="create-test-case-module-description">
                {assignmentRetryName
                  ? `Finish assigning Test Cases to ${assignmentRetryName}.`
                  : "Define the module and optionally move Test Cases into it."}
              </p>
            </div>
          </div>
          <DialogCloseButton
            disabled={isSaving}
            label="Close create module"
            onClick={closeModal}
          />
        </div>

        <div className="test-case-create-module-body">
          <section className="test-case-create-module-details" aria-labelledby="module-details-heading">
            <div className="test-case-create-module-section-heading">
              <div>
                <h3 id="module-details-heading">Module Details</h3>
                <p>Define the core identity of your new testing module.</p>
              </div>
            </div>
            {assignmentRetryName ? (
              <div className="test-case-create-module-retry-note" role="status">
                <IconInfoCircle aria-hidden="true" size={16} stroke={1.8} />
                <span>
                  The module was created successfully. Its selected Test Cases still need to be assigned.
                </span>
              </div>
            ) : null}
            <div className="test-case-create-module-fields">
              <FormField className="test-case-create-module-name" label="Module name" required>
                <input
                  autoFocus
                  data-autofocus="true"
                  disabled={isSaving || Boolean(assignmentRetryName)}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="e.g., Authentication Services"
                  required
                  value={name}
                />
              </FormField>
              <FormField className="test-case-create-module-description" label="Description">
                <RichTextEditor
                  appearance="canonical"
                  aria-label="Module description"
                  disabled={isSaving || Boolean(assignmentRetryName)}
                  onChange={setDescription}
                  placeholder="Describe the purpose and scope of this module..."
                  rows={12}
                  value={description}
                />
              </FormField>
            </div>
          </section>

          <section
            className="test-case-create-module-picker"
            aria-labelledby="module-test-cases-heading"
          >
            <ModuleRequirementPicker
              candidateRequirements={candidateRequirements}
              canSelectRequirements={canSelectRequirements}
              hasMoreRequirements={hasMoreRequirements}
              isLoadingMoreRequirements={isLoadingMoreRequirements}
              isLoadingRequirements={isLoadingRequirements}
              isLocked={Boolean(assignmentRetryName)}
              isSaving={isSaving}
              onLoadMoreRequirements={onLoadMoreRequirements}
              onSelectionChange={handleRequirementSelectionChange}
              selectedIds={selectedRequirementIds}
            />
            <div className={canAssignCases ? "sr-only" : "test-case-create-module-section-heading test-case-create-module-picker-heading"}>
              <div>
                <h3 id="module-test-cases-heading">Test Case Selection</h3>
                {!canAssignCases ? <p>Assigning Test Cases requires update permission.</p> : null}
              </div>
            </div>

            {canAssignCases && selectedRequirementIds.length ? (
              <div
                aria-atomic="true"
                aria-live={hasRequirementCaseResolutionError ? "assertive" : "polite"}
                className={hasRequirementCaseResolutionError
                  ? "test-case-create-module-auto-link-status is-error"
                  : isResolvingRequirementCases
                    ? "test-case-create-module-auto-link-status is-loading"
                    : "test-case-create-module-auto-link-status is-ready"}
                role={hasRequirementCaseResolutionError ? "alert" : "status"}
              >
                <IconInfoCircle aria-hidden="true" size={15} stroke={1.8} />
                <span>
                  {hasRequirementCaseResolutionError
                    ? `Linked Test Cases could not be loaded for ${activeFailedRequirementIds.length} Requirement${activeFailedRequirementIds.length === 1 ? "" : "s"}.`
                    : isResolvingRequirementCases
                      ? `Finding all linked Test Cases for ${activeResolvingRequirementIds.length} Requirement${activeResolvingRequirementIds.length === 1 ? "" : "s"}…`
                      : activeAutoLinkedCaseIds.length
                        ? `${selectedAutoLinkedCaseCount} of ${activeAutoLinkedCaseIds.length} linked Test Case${activeAutoLinkedCaseIds.length === 1 ? "" : "s"} selected.`
                        : "No linked Test Cases were found for the selected Requirements."}
                </span>
                {hasRequirementCaseResolutionError ? (
                  <button
                    className="ghost-button"
                    disabled={isResolvingRequirementCases || isSaving}
                    onClick={() => void resolveLinkedRequirementCases(activeFailedRequirementIds)}
                    type="button"
                  >
                    Retry
                  </button>
                ) : null}
              </div>
            ) : null}

            {canAssignCases ? (
              <TestCasePicker
                projectId={projectId}
                appTypeId={appTypeId}
                selectedIds={selectedIds}
                initialItems={candidateCasesWithLinkedCases}
                onChange={updateCaseSelection}
                disabled={isSaving || isResolvingRequirementCases}
                heading="Test Case Selection"
                presentation="inline"
                allowReorder
                emptyMessage="No Test Cases match this search."
              />
            ) : null}
          </section>
        </div>

        <div className="action-row requirement-create-modal-actions test-case-create-module-footer">
          <p
            className={isRequirementSelectionOverLimit || hasRequirementCaseResolutionError ? "is-error" : ""}
            role={isRequirementSelectionOverLimit || hasRequirementCaseResolutionError ? "alert" : undefined}
          >
            <IconInfoCircle aria-hidden="true" size={15} stroke={1.8} />
            <span>
              {assignmentRetryName
                ? `Retry the assignment without creating a duplicate of ${assignmentRetryName}.`
                : isResolvingRequirementCases
                  ? "Selecting every Test Case linked to the chosen Requirements…"
                : hasRequirementCaseResolutionError
                  ? "Retry linked Test Case selection or remove the affected Requirement before creating the module."
                : isRequirementSelectionOverLimit
                  ? `Select no more than ${MAX_CREATE_MODULE_REQUIREMENTS} Requirements before creating this module.`
                : selectedAssignedCaseCount
                  ? `${selectedAssignedCaseCount} selected Test Case${selectedAssignedCaseCount === 1 ? "" : "s"} will move from the current module into the new module.`
                  : selectedIds.length
                    ? "Selected Test Cases will be moved into the new module."
                    : "Create an empty module now and assign Test Cases later."}
            </span>
          </p>
          <button className="ghost-button" disabled={isSaving} onClick={closeModal} type="button">Cancel</button>
          <button
            className="primary-button"
            disabled={isSaving
              || !name.trim()
              || isRequirementSelectionOverLimit
              || isResolvingRequirementCases
              || hasRequirementCaseResolutionError}
            type="submit"
          >
            {isResolvingRequirementCases ? "Selecting linked cases…" : isSaving ? (assignmentRetryName ? "Assigning Test Cases…" : "Creating module…") : (
              <>
                <AddIcon size={16} />
                <span>{assignmentRetryName ? "Retry assignment" : "Create module"}</span>
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  );
}

export function TestCasesPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
	  const [searchParams, setSearchParams] = useSearchParams();
	  const { session } = useAuth();
	  const [projectId, setProjectId] = useCurrentProject();
	  const [appTypeId, setAppTypeId] = useCurrentAppType(projectId);
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
  const [searchTerm, setSearchTerm] = useState("");
  const [catalogViewMode, setCatalogViewMode] = useState<"tile" | "list">(() => readDefaultCatalogViewMode());
  const [isCatalogViewPending, startCatalogViewTransition] = useTransition();
  const deferredSearchTerm = useDeferredValue(searchTerm);
  const [visibleTestCaseCount, setVisibleTestCaseCount] = useState(TEST_CASE_RENDER_BATCH_SIZE);
  const [caseStatusFilter, setCaseStatusFilter] = useState("all");
  const [casePriorityFilter, setCasePriorityFilter] = useState("all");
  const [caseStepFilter, setCaseStepFilter] = useState<CaseStepFilter>("all");
  const [caseRunFilter, setCaseRunFilter] = useState<CaseRunFilter>("all");
  const [isCreating, setIsCreating] = useState(false);
  const [selectedActionTestCaseIds, setSelectedActionTestCaseIds] = useState<string[]>([]);
  const selectedActionCaseSnapshotsRef = useRef<Map<string, TestCase>>(new Map());
  const [linkedPreviewCaseId, setLinkedPreviewCaseId] = useState("");
  const [isDeletingSelectedTestCases, setIsDeletingSelectedTestCases] = useState(false);
  const [isCreateSuiteModalOpen, setIsCreateSuiteModalOpen] = useState(false);
  const [isCreateModuleModalOpen, setIsCreateModuleModalOpen] = useState(false);
  const [isCreatingModuleWorkflow, setIsCreatingModuleWorkflow] = useState(false);
  const [moduleDraftInitialCaseIds, setModuleDraftInitialCaseIds] = useState<string[]>([]);
  const [moduleAssignmentRetry, setModuleAssignmentRetry] = useState<{ id: string; name: string } | null>(null);
  const moduleCreateWorkflowPendingRef = useRef(false);
  const [expandedModuleIds, setExpandedModuleIds] = useState<string[]>([]);
  const [isUnassignedModuleExpanded, setIsUnassignedModuleExpanded] = useState(true);
  const [modulePageCursorsById, setModulePageCursorsById] = useState<Record<string, Array<string | null>>>({});
  const [selectedModuleIds, setSelectedModuleIds] = useState<string[]>([]);
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
  const lastCaseSaveNoticeRef = useRef("");
  const lastTestCaseParameterSeedRef = useRef("");
  const lastExpandedStepSeedRef = useRef("");
  const generationJobAlertScopeRef = useRef("");
  const surfacedGenerationJobFailureIdsRef = useRef<Set<string>>(new Set());
  const surfacedGenerationJobCompletionIdsRef = useRef<Set<string>>(new Set());
  const defaultTestCaseStatus = domainMetadataQuery.data?.test_cases?.default_status || "active";
  const defaultTestCaseAutomated = (domainMetadataQuery.data?.test_cases?.default_automated || "no") as "yes" | "no";
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
  const [linkedDataSetDraftIds, setLinkedDataSetDraftIds] = useState<string[]>([]);
  const [overrideSharedGroupData, setOverrideSharedGroupData] = useState(false);
  const [dataSetSearch, setDataSetSearch] = useState("");
  const [dataSetLinkDraftId, setDataSetLinkDraftId] = useState("");
  const [isDataSetLinkerOpen, setIsDataSetLinkerOpen] = useState(false);
  const [isDataSetCreatorOpen, setIsDataSetCreatorOpen] = useState(false);
  const [newDataSetDraft, setNewDataSetDraft] = useState<DataSetDraft>(() => buildEmptyDataSetDraft());
  const [testCaseParameterValues, setTestCaseParameterValues] = useState<Record<string, string>>({});
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
  const [maxCases, setMaxCases] = useState(3);
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
  const catalogFilters = useMemo(() => ({
    search: isReviewQueueOpen ? undefined : deferredSearchTerm.trim() || undefined,
    workflow_status: isReviewQueueOpen || caseStatusFilter === "all" ? undefined : caseStatusFilter,
    priority: isReviewQueueOpen || casePriorityFilter === "all" ? undefined : Number(casePriorityFilter),
    step_filter: isReviewQueueOpen || caseStepFilter === "all" ? undefined : caseStepFilter,
    run_filter: isReviewQueueOpen || caseRunFilter === "all" ? undefined : caseRunFilter,
    review_queue: isReviewQueueOpen ? "mine" as const : undefined,
    exclude_automated: isReviewQueueOpen ? undefined : true,
    include_total: false,
    include_execution: canViewExecutionInsights
  }), [isReviewQueueOpen, deferredSearchTerm, caseStatusFilter, casePriorityFilter, caseStepFilter, caseRunFilter, canViewExecutionInsights]);
  const catalogFilterKey = JSON.stringify(catalogFilters);
  const [modulePageFilterKey, setModulePageFilterKey] = useState(catalogFilterKey);
  const scopedModulePageCursors = useMemo(() => modulePageFilterKey === catalogFilterKey ? modulePageCursorsById : {}, [modulePageFilterKey, catalogFilterKey, modulePageCursorsById]);
  const isCatalogFiltered = Boolean(isReviewQueueOpen || catalogFilters.search || catalogFilters.workflow_status || catalogFilters.priority || catalogFilters.step_filter || catalogFilters.run_filter);
  const [collapsedFilteredModuleIds, setCollapsedFilteredModuleIds] = useState<string[]>([]);
  const isModuleExpanded = (moduleId: string) => isCatalogFiltered ? !collapsedFilteredModuleIds.includes(moduleId) : expandedModuleIds.includes(moduleId);
  useEffect(() => {
    setCollapsedFilteredModuleIds([]);
    setModulePageFilterKey(catalogFilterKey);
    setModulePageCursorsById({});
  }, [catalogFilterKey]);
  const testCaseMetricsQuery = useQuery({
    queryKey: ["test-case-metrics", appTypeId, projectId, canViewExecutionInsights, reviewUserId, isReviewQueueOpen],
    queryFn: () => api.testCases.metrics({ app_type_id: appTypeId, project_id: projectId, exclude_automated: isReviewQueueOpen ? undefined : true, review_queue: isReviewQueueOpen ? "mine" : undefined, include_execution: canViewExecutionInsights }),
    enabled: can("testcase.view") && Boolean(appTypeId && projectId),
    staleTime: 120_000,
    gcTime: 600_000
  });
  const testCasesQuery = useInfiniteQuery({
    queryKey: ["global-test-cases", appTypeId, projectId, catalogFilters, reviewUserId],
    queryFn: async ({ pageParam, signal }) => normalizePagedResult<TestCase>(
      await api.testCases.listPage({
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
      && !(previousQuery?.queryKey[3] as { review_queue?: string })?.review_queue ? previous : undefined,
    refetchInterval: isReviewQueueOpen ? 30_000 : false,
    staleTime: 120_000,
    gcTime: 600_000
  });
  const testCaseModulesQuery = optionalQueryView(useQuery({
    queryKey: ["test-case-modules", appTypeId, projectId],
    queryFn: async () => asArray(await api.testCaseModules.list({ app_type_id: appTypeId, projection: "summary" })),
    enabled: !isReviewQueueOpen && (can("testcase.view")) && Boolean(appTypeId),
    staleTime: 120_000,
    gcTime: 600_000
  }), can("testcase.view"));
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
    queryKey: [...testCaseDetailQueryKey(projectId, selectedTestCaseId), reviewUserId],
    queryFn: () => api.testCases.get(selectedTestCaseId, { project_id: projectId }),
    enabled: (can("testcase.view")) && Boolean(projectId && selectedTestCaseId),
    initialData: () => {
      const deepLinkedCase = deepLinkTestCasesQuery.data;
      return deepLinkedCase?.id === selectedTestCaseId ? deepLinkedCase : undefined;
    },
    staleTime: TEST_CASE_DETAIL_STALE_TIME_MS
  });
  const automationCaseLinksQuery = optionalQueryView(useQuery({
    queryKey: ["test-cases", "manual-automation-links", appTypeId, selectedTestCaseId],
    queryFn: () => api.testCases.list({ app_type_id: appTypeId, projection: "summary" }),
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
    mutationFn: ({ id, parameter_values }: { id: string; parameter_values: Record<string, string> }) =>
      api.testCases.update(id, { parameter_values })
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
  const rephraseStepWithAi = useMutation({ mutationFn: api.testCases.rephraseStep });
  const previewDesignedCases = useMutation({
    mutationFn: ({ input, signal }: { input: Parameters<typeof api.testCases.previewDesignedCases>[0]; signal: AbortSignal }) => api.testCases.previewDesignedCases(input, { signal })
  });
  const acceptDesignedCases = useMutation({ mutationFn: api.testCases.acceptDesignedCases });
  const buildSingleAutomation = useMutation({
    mutationFn: ({ testCaseId }: { testCaseId: string }) =>
      api.testCases.queueAutomationGenerator(testCaseId, {
        integration_id: integrationId || undefined,
        start_url: automationStartUrl.trim() || undefined,
        additional_context: automationContext.trim() || undefined,
        test_environment_id: can("environment.view") ? selectedExecutionEnvironmentId || undefined : undefined,
        test_configuration_id: can("configuration.view") ? selectedExecutionConfigurationId || undefined : undefined,
        test_data_set_id: can("data.view") ? selectedExecutionDataSetId || undefined : undefined
      })
  });
  const buildBatchAutomation = useMutation({
    mutationFn: ({ testCaseIds, aiRequested = false }: { testCaseIds: string[]; aiRequested?: boolean }) =>
      api.testCases.buildAutomationBatch({
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
      })
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
      return [...byId.values()].filter((testCase) => ownsCaseReview(testCase, reviewUserId) && isPendingCaseReview(testCase));
    }
    for (const query of moduleCaseQueries) {
      for (const testCase of query.data?.items || []) byId.set(testCase.id, testCase);
    }
    if (deepLinkTestCasesQuery.data) byId.set(deepLinkTestCasesQuery.data.id, deepLinkTestCasesQuery.data);
    if (selectedTestCaseDetailQuery.data) byId.set(selectedTestCaseDetailQuery.data.id, selectedTestCaseDetailQuery.data);
    return [...byId.values()].filter((testCase) => testCase.automated !== "yes");
  }, [deepLinkTestCasesQuery.data, isReviewQueueOpen, moduleCaseQueries, reviewUserId, selectedTestCaseDetailQuery.data, testCasesQuery.data]);
  useEffect(() => {
    const selectedIds = new Set(selectedActionTestCaseIds);
    testCases.forEach((testCase) => {
      if (selectedIds.has(testCase.id)) selectedActionCaseSnapshotsRef.current.set(testCase.id, testCase);
    });
    selectedActionCaseSnapshotsRef.current.forEach((_testCase, testCaseId) => {
      if (!selectedIds.has(testCaseId)) selectedActionCaseSnapshotsRef.current.delete(testCaseId);
    });
  }, [selectedActionTestCaseIds, testCases]);
  const testCaseModules = isReviewQueueOpen ? [] : asArray(testCaseModulesQuery.data);
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
      setCaseDraft(current => ({ ...current, title: agentProposal.title, description: [agentProposal.description, agentProposal.prerequisites?.length ? `Prerequisites:\n${agentProposal.prerequisites.join("\n")}` : ""].filter(Boolean).join("\n\n"), priority: Number(agentProposal.priority.slice(1)) || 3, authoring_mode: "structured" }));
      setDraftSteps((agentProposal.steps || []).map(step => ({ id: createDraftStepId(), action: step.action, expected_result: step.expected_result, step_type: "web", automation_code: "", api_request: null, group_id: null, group_name: null, group_kind: null, reusable_group_id: null })));
    }
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      ["create", "agent_proposal", "source", "module", "suite", "requirement", "release_id", "release", "sprint_id", "sprint"]
        .forEach((key) => next.delete(key));
      return next;
    }, { replace: true });
  }, [
    appTypeId,
    isCapabilityLoading,
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
  const hasActiveCaseCatalogFilter = isReviewQueueOpen || Boolean(deferredSearchTerm.trim())
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
      { label: "Latest Pass Rate", value: !canViewExecutionInsights ? "Unavailable" : health.latestPassRatePercent === null ? "No runs" : `${health.latestPassRatePercent}%`,
        tone: !canViewExecutionInsights || health.latestPassRatePercent === null ? "neutral" : health.latestPassRatePercent >= 80 ? "success" : "warning",
        detail: !canViewExecutionInsights ? executionUnavailable : health.latestPassRatePercent === null ? "No finalized case outcomes are available in this module." : `${health.latestPassRatePercent}% of cases with a latest finalized outcome passed.`, methodology: "Uses one latest finalized passed, failed, or blocked outcome per Test Case. Cases without a finalized outcome are excluded from the denominator." },
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
        detail: `${health.automationPercent}% of evaluated module Test Cases are automated.`, methodology: "Automated cases divided by module cases whose automation status is known (yes or no)." },
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
          label: "Latest Pass Rate",
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

    if (isReviewQueueOpen) return filteredCases.map((testCase) => ({ kind: "case" as const, testCase }));
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
	  }, [expandedModuleIds, collapsedFilteredModuleIds, isCatalogFiltered, isReviewQueueOpen, filteredCases, isUnassignedModuleExpanded, moduleCaseGroups.unassignedCases, testCasesQuery.hasNextPage, visibleModuleCaseGroups]);
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
  const linkedDataSetSensitiveParameterNames = useMemo(
    () => new Set(collectSensitiveDataSetParameterNames(linkedDataSet)),
    [linkedDataSet]
  );
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
    () => combineStepParameterValues(linkedDataSetDefaultParameterValues, visibleTestCaseParameterValues),
    [linkedDataSetDefaultParameterValues, visibleTestCaseParameterValues]
  );
  const mergedScopedParameterValues = useMemo(
    () => combineStepParameterValues(effectiveTestCaseParameterValues, suiteParameterValues, runPreviewParameterValues),
    [effectiveTestCaseParameterValues, runPreviewParameterValues, suiteParameterValues]
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
      ...(canViewTestData ? { test_data_set_ids: linkedDataSetDraftIds, test_data_options: { override_shared_steps: overrideSharedGroupData } } : {}),
      description: caseDraft.description,
      authoring_mode: caseDraft.authoring_mode,
      gherkin_document: caseDraft.gherkin_document,
      parameter_values: testCaseParameterValues,
      steps: caseDraft.authoring_mode === "gherkin" ? buildGherkinQualitySteps(caseDraft.gherkin_document).map((step, index) => ({ ...step, step_order: index + 1 })) : displaySteps.map((step) => ({
        step_order: step.step_order,
        step_type: stepDrafts[step.id]?.step_type ?? step.step_type,
        action: stepDrafts[step.id]?.action ?? step.action,
        expected_result: stepDrafts[step.id]?.expected_result ?? step.expected_result
      }))
    }),
    [canViewTestData, linkedDataSetDraftIds, overrideSharedGroupData, caseDraft.priority, caseDraft.status, caseDraft.test_case_type, caseDraft.automated, caseDraft.module_id, caseDraft.reviewer_id, caseDraft.labelsText, caseDraft.externalReferencesText, caseDraft.authoring_mode, caseDraft.description, caseDraft.gherkin_document, caseDraft.title, displaySteps, selectedTestCase?.display_id, selectedTestCase?.id, stepDrafts, testCaseParameterValues]
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
  const resolveScopedParameterInputState = (scope: StepParameterScope) => {
    if (scope === "s") {
      if (!selectedCaseSuiteIds.length) {
        return {
          disabled: true,
          hint: "Link this case to a suite before saving suite-shared values."
        };
      }

      if (!selectedParameterSuite) {
        return {
          disabled: true,
          hint: "Choose a suite target before editing suite-shared values."
        };
      }

      return {
        disabled: false,
        hint: selectedCaseSuiteIds.length > 1
          ? `Saved on suite "${selectedParameterSuite.name}".`
          : `Saved on linked suite "${selectedParameterSuite.name}".`
      };
    }

    if (scope === "r") {
      return {
        disabled: false,
        hint: "Preview only here. Real runs resolve @r values from the attached run data set."
      };
    }

    return {
      disabled: false,
      hint: isCreating
        ? "Saved with this draft test case."
        : "Saved on this test case and reused across its steps."
    };
  };
  const handleScopedParameterValueChange = (name: string, value: string) => {
    const parsed = parseStepParameterName(name);

    if (!parsed || linkedDataSetSensitiveParameterNames.has(parsed.name) || resolveScopedParameterInputState(parsed.scope).disabled) {
      return;
    }

    if (parsed.scope === "s") {
      setSuiteParameterValues((current) => ({
        ...current,
        [parsed.name]: value
      }));
      return;
    }

    if (parsed.scope === "r") {
      setRunPreviewParameterValues((current) => ({
        ...current,
        [parsed.name]: value
      }));
      return;
    }

    setTestCaseParameterValues((current) => ({
      ...current,
      [parsed.name]: value
    }));
  };
  const syncCachedTestCaseParameterValues = (testCaseId: string, parameterValues: Record<string, string>, revision?: number) => {
    const normalizedValues = normalizeTestCaseParameterValues(parameterValues);

    if (revision && selectedTestCaseId === testCaseId) {
      lastCaseDraftSeedRef.current = `case:${testCaseId}:${revision}:${selectedCaseModuleId}`;
      lastTestCaseParameterSeedRef.current = `case:${testCaseId}:${revision}`;
    }

    queryClient.setQueryData<TestCase>(testCaseDetailQueryKey(projectId, testCaseId), (current) =>
      current
        ? {
            ...current,
            parameter_values: normalizedValues,
            ...(revision ? { revision } : {})
          }
        : current
    );

    queryClient.setQueryData<TestCase[]>(["global-test-cases", appTypeId], (current) =>
      current
        ? current.map((item) =>
            item.id === testCaseId
              ? {
                  ...item,
                  parameter_values: normalizedValues
                }
              : item
          )
        : current
    );
  };
  const syncCachedTestCaseSuiteIds = (testCaseId: string, suiteIds: string[], revision?: number) => {
    const normalizedSuiteIds = Array.from(new Set(suiteIds.filter(Boolean)));
    if (revision && currentCaseLinkScopeRef.current === `${projectId}:${testCaseId}`) {
      // A relationship-only revision must not reseed unsaved metadata, Gherkin, or parameter drafts.
      lastCaseDraftSeedRef.current = `case:${testCaseId}:${revision}:${selectedCaseModuleId}`;
      lastTestCaseParameterSeedRef.current = `case:${testCaseId}:${revision}`;
    }
    queryClient.setQueriesData<TestCase>({ queryKey: testCaseDetailQueryKey(projectId, testCaseId) }, current => current ? {
      ...current, suite_id: normalizedSuiteIds[0] || null, suite_ids: normalizedSuiteIds,
      ...(revision ? { revision } : {})
    } : current);

    queryClient.setQueryData<TestCase[]>(["global-test-cases", appTypeId], (current) =>
      current
        ? current.map((item) =>
            item.id === testCaseId
              ? {
                  ...item,
                  suite_id: normalizedSuiteIds[0] || null,
                  suite_ids: normalizedSuiteIds
                }
              : item
          )
        : current
    );
  };
  const syncCachedSuiteParameterValues = (suiteId: string, parameterValues: Record<string, string>) => {
    const normalizedValues = normalizeSuiteParameterValues(parameterValues);

    queryClient.setQueryData<TestSuite[]>(["test-case-suites", appTypeId], (current) =>
      current
        ? current.map((suite) =>
            suite.id === suiteId
              ? {
                  ...suite,
                  parameter_values: normalizedValues
                }
              : suite
          )
        : current
    );
  };

  useEffect(() => {
    if (isCreating) {
      lastCaseDraftSeedRef.current = "__draft__";
      return;
    }

    if (!selectedTestCaseId) {
      if (lastCaseDraftSeedRef.current !== "__none__") {
        setCaseDraft(emptyCaseDraft);
        setLinkedDataSetDraftIds([]);
    setOverrideSharedGroupData(false);
        lastCaseDraftSeedRef.current = "__none__";
      }
      return;
    }

    // Keep the requested workspace stable while its detail payload is loading.
    // Clearing the selection in this window made the module child flash closed
    // and then reopen once the route/query caught up.
    if (isSelectedTestCaseDetailPending) {
      return;
    }

    if (selectedTestCase) {
      const nextSeedKey = `case:${selectedTestCase.id}:${selectedTestCase.revision ?? selectedTestCase.updated_at ?? "detail"}:${selectedCaseModuleId}`;

      if (lastCaseDraftSeedRef.current === nextSeedKey) {
        return;
      }

      setCaseDraft({
        title: selectedTestCase.title,
        description: selectedTestCase.description || "",
        externalReferencesText: formatReferenceList(selectedTestCase.external_references),
        labelsText: formatReferenceList(selectedTestCase.labels),
        automated: (selectedTestCase.automated || defaultTestCaseAutomated) as "yes" | "no",
        priority: selectedTestCase.priority ?? 3,
        status: selectedTestCase.status || defaultTestCaseStatus,
        requirement_id: selectedTestCase.requirement_ids?.[0] || selectedTestCase.requirement_id || "",
        module_id: selectedCaseModuleId,
        author_id: selectedTestCase.author_id || selectedTestCase.author?.id || selectedTestCase.created_by || session?.user.id || "",
        reviewer_id: selectedTestCase.reviewer_id || "",
        authoring_mode: selectedTestCase.authoring_mode || "structured",
        test_case_type: selectedTestCase.test_case_type || "functional",
        gherkin_document: selectedTestCase.gherkin_document || ""
      });
      setLinkedDataSetDraftIds((selectedTestCase.test_data_set_ids || []).slice(0, 1));
      setOverrideSharedGroupData(selectedTestCase.test_data_options?.override_shared_steps !== false);
      lastCaseDraftSeedRef.current = nextSeedKey;
      return;
    }

    const requestedCaseId = searchParams.get("case");
    if (requestedCaseId) {
      const requestedCase = findByRoutableId(testCases, requestedCaseId);
      if (requestedCase) {
        setSelectedTestCaseId(requestedCase.id);
        return;
      }

      if (deepLinkTestCasesQuery.isLoading || deepLinkTestCasesQuery.isFetching) {
        return;
      }

      const deepLinkedCase = findByRoutableId(deepLinkTestCases, requestedCaseId);
      if (deepLinkedCase?.app_type_id && deepLinkedCase.app_type_id !== appTypeId) {
        setAppTypeId(deepLinkedCase.app_type_id);
        return;
      }

      if (deepLinkedCase && selectedTestCaseId === deepLinkedCase.id) {
        return;
      }

      if (selectedTestCaseId === requestedCaseId) {
        return;
      }
    }

    syncTestCaseSearchParams(null);
    setSelectedTestCaseId("");
    setCaseDraft(emptyCaseDraft);
    setLinkedDataSetDraftIds([]);
    setOverrideSharedGroupData(false);
  }, [
    defaultTestCaseAutomated,
    defaultTestCaseStatus,
    emptyCaseDraft,
    appTypeId,
    deepLinkTestCases,
    deepLinkTestCasesQuery.isFetching,
    deepLinkTestCasesQuery.isLoading,
    isCreating,
    isSelectedTestCaseDetailPending,
    selectedCaseModuleId,
    selectedTestCase,
    selectedTestCaseId,
    searchParams,
    setAppTypeId,
    testCases
  ]);

  useEffect(() => {
    if (isCreating) {
      const nextSeedKey = `draft:${appTypeId || "global"}`;

      if (lastTestCaseParameterSeedRef.current !== nextSeedKey) {
        setTestCaseParameterValues(readStoredTestCaseParameterDraft(createCaseParameterDraftScopeKey));
        setIsCaseParameterDialogOpen(false);
        lastTestCaseParameterSeedRef.current = nextSeedKey;
      }
      return;
    }

    if (!selectedTestCaseId) {
      if (lastTestCaseParameterSeedRef.current !== "__none__") {
        setTestCaseParameterValues({});
        setIsCaseParameterDialogOpen(false);
        lastTestCaseParameterSeedRef.current = "__none__";
      }
      return;
    }

    if (!selectedTestCase) {
      return;
    }

    const nextSeedKey = activeTestCaseParameterSeedKey;

    if (lastTestCaseParameterSeedRef.current === nextSeedKey) {
      return;
    }

    const storedDraft = readStoredTestCaseParameterDraft(selectedCaseParameterDraftScopeKey);
    const nextValues = Object.keys(storedDraft).length || hasStoredTestCaseParameterDraft(selectedCaseParameterDraftScopeKey)
      ? storedDraft
      : normalizeTestCaseParameterValues(selectedTestCase.parameter_values);

    setTestCaseParameterValues(nextValues);
    setIsCaseParameterDialogOpen(false);
    lastTestCaseParameterSeedRef.current = nextSeedKey;
  }, [
    activeTestCaseParameterSeedKey,
    appTypeId,
    createCaseParameterDraftScopeKey,
    isCreating,
    selectedCaseParameterDraftScopeKey,
    selectedTestCase,
    selectedTestCaseId
  ]);

  useEffect(() => {
    if (!searchParams.get("case")) {
      suppressCaseSelectionFromUrlRef.current = false;
    }

    if (suppressCaseSelectionFromUrlRef.current) {
      return;
    }

    if (isCreating || selectedTestCaseId) {
      return;
    }

    const requestedCaseId = searchParams.get("case");
    if (!requestedCaseId) {
      return;
    }

    if (testCasesQuery.isLoading || testCasesQuery.isFetching) {
      return;
    }

    const requestedCase = findByRoutableId(testCases, requestedCaseId);
    if (requestedCase) {
      setSelectedTestCaseId(requestedCase.id);
      if (requestedCase.display_id && requestedCaseId !== requestedCase.display_id) {
        syncTestCaseSearchParams(requestedCase.display_id);
      }
      return;
    }

    if (deepLinkTestCasesQuery.isLoading || deepLinkTestCasesQuery.isFetching) {
      return;
    }

    const deepLinkedCase = findByRoutableId(deepLinkTestCases, requestedCaseId);
    if (deepLinkedCase?.app_type_id && deepLinkedCase.app_type_id !== appTypeId) {
      setAppTypeId(deepLinkedCase.app_type_id);
      return;
    }

    if (deepLinkedCase) {
      setSelectedTestCaseId(deepLinkedCase.id);
    }
  }, [
    appTypeId,
    deepLinkTestCases,
    deepLinkTestCasesQuery.isFetching,
    deepLinkTestCasesQuery.isLoading,
    isCreating,
    searchParams,
    selectedTestCaseId,
    setAppTypeId,
    testCases,
    testCasesQuery.isFetching,
    testCasesQuery.isLoading
  ]);

  useEffect(() => {
    if (!selectedCaseSuiteIds.length) {
      setSelectedParameterSuiteId("");
      setSuiteParameterValues({});
      return;
    }

    if (!selectedCaseSuiteIds.includes(selectedParameterSuiteId)) {
      setSelectedParameterSuiteId(selectedCaseSuiteIds[0] || "");
    }
  }, [selectedCaseSuiteIds, selectedParameterSuiteId]);

  useEffect(() => {
    const scopeKey = isCreating ? createCaseParameterDraftScopeKey : selectedCaseParameterDraftScopeKey;

    if (!scopeKey || lastTestCaseParameterSeedRef.current !== activeTestCaseParameterSeedKey) {
      return;
    }

    writeStoredTestCaseParameterDraft(scopeKey, testCaseParameterValues);
  }, [
    activeTestCaseParameterSeedKey,
    createCaseParameterDraftScopeKey,
    isCreating,
    selectedCaseParameterDraftScopeKey,
    testCaseParameterValues
  ]);

  useEffect(() => {
    if (
      isCreating
      || !selectedTestCase
      || lastTestCaseParameterSeedRef.current !== activeTestCaseParameterSeedKey
      || persistCaseParameterValues.isPending
      || updateTestCase.isPending
      || linkedDataSetId !== (selectedTestCase.test_data_set_ids?.[0] || "")
      || overrideSharedGroupData !== (selectedTestCase.test_data_options?.override_shared_steps !== false)
    ) {
      return;
    }

    const normalizedCurrentValues = normalizeTestCaseParameterValues(testCaseParameterValues);
    const normalizedSavedValues = normalizeTestCaseParameterValues(selectedTestCase.parameter_values);

    if (areTestCaseParameterValuesEqual(normalizedCurrentValues, normalizedSavedValues)) {
      clearStoredTestCaseParameterDraft(selectedCaseParameterDraftScopeKey);
      return;
    }

    const timeoutId = window.setTimeout(() => {
      persistCaseParameterValues.mutate(
        { id: selectedTestCase.id, parameter_values: normalizedCurrentValues },
        {
          onSuccess: (response) => {
            syncCachedTestCaseParameterValues(selectedTestCase.id, normalizedCurrentValues, response.revision);

            if (areTestCaseParameterValuesEqual(readStoredTestCaseParameterDraft(selectedCaseParameterDraftScopeKey), normalizedCurrentValues)) {
              clearStoredTestCaseParameterDraft(selectedCaseParameterDraftScopeKey);
            }
          },
          onError: (error) => {
            showError(error, "Unable to store Test Params");
          }
        }
      );
    }, 450);

    return () => window.clearTimeout(timeoutId);
  }, [
    activeTestCaseParameterSeedKey,
    isCreating,
    linkedDataSetId,
    overrideSharedGroupData,
    persistCaseParameterValues.isPending,
    selectedCaseParameterDraftScopeKey,
    selectedTestCase,
    testCaseParameterValues,
    updateTestCase.isPending
  ]);

  useEffect(() => {
    if (!selectedParameterSuiteId) {
      return;
    }

    const storedDraft = readStoredSuiteParameterDraft(selectedSuiteParameterDraftScopeKey);
    const nextValues = Object.keys(storedDraft).length || hasStoredSuiteParameterDraft(selectedSuiteParameterDraftScopeKey)
      ? storedDraft
      : normalizeSuiteParameterValues(selectedParameterSuite?.parameter_values);

    setSuiteParameterValues(nextValues);
  }, [selectedParameterSuite?.parameter_values, selectedParameterSuiteId, selectedSuiteParameterDraftScopeKey]);

  useEffect(() => {
    setRunPreviewParameterValues(readStoredRunParameterDraft(runPreviewParameterDraftScopeKey));
  }, [runPreviewParameterDraftScopeKey]);

  useEffect(() => {
    if (!selectedSuiteParameterDraftScopeKey || !selectedParameterSuiteId) {
      return;
    }

    writeStoredSuiteParameterDraft(selectedSuiteParameterDraftScopeKey, suiteParameterValues);
  }, [selectedParameterSuiteId, selectedSuiteParameterDraftScopeKey, suiteParameterValues]);

  useEffect(() => {
    writeStoredRunParameterDraft(runPreviewParameterDraftScopeKey, runPreviewParameterValues);
  }, [runPreviewParameterDraftScopeKey, runPreviewParameterValues]);

  useEffect(() => {
    if (!selectedParameterSuite || updateSuite.isPending) {
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
    selectedSuiteParameterDraftScopeKey,
    suiteParameterValues,
    updateSuite,
    updateSuite.isPending
  ]);

  useEffect(() => {
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

  const persistSelectedSuiteParameterValues = async () => {
    if (!selectedParameterSuite) {
      return;
    }

    const normalizedCurrentValues = normalizeSuiteParameterValues(suiteParameterValues);
    const normalizedSavedValues = normalizeSuiteParameterValues(selectedParameterSuite.parameter_values);

    if (areSuiteParameterValuesEqual(normalizedCurrentValues, normalizedSavedValues)) {
      clearStoredSuiteParameterDraft(selectedSuiteParameterDraftScopeKey);
      return;
    }

    await updateSuite.mutateAsync({
      id: selectedParameterSuite.id,
      input: {
        parameter_values: normalizedCurrentValues
      }
    });
    syncCachedSuiteParameterValues(selectedParameterSuite.id, normalizedCurrentValues);
    clearStoredSuiteParameterDraft(selectedSuiteParameterDraftScopeKey);
  };

  const handleCreateAndLinkDataSet = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canCreateAndLinkTestData) {
      showError(new Error("Data Set management and Test Case edit permissions are required."), "Unable to create data set");
      return;
    }
    if (!projectId) return;
    try {
      const { payload, didSanitizeInvalidChars } = buildDataSetPayload(projectId, appTypeId || undefined, newDataSetDraft);
      if (!payload.name) {
        showError(new Error("Provide a data set name."), "Unable to create data set");
        return;
      }
      const created = await createTestDataSet.mutateAsync(payload);
      setLinkedDataSetDraftIds([created.id]);
      setNewDataSetDraft(emptyDataSetDraft);
      setIsDataSetCreatorOpen(false);
      await queryClient.invalidateQueries({ queryKey: ["test-data-sets", projectId, appTypeId] });
      showSuccess(didSanitizeInvalidChars
        ? "Data set created and selected. Invalid characters were removed automatically; save the test case to keep the link."
        : "Data set created and selected. Save the test case to keep this relationship.");
    } catch (error) {
      showError(error, "Unable to create data set");
    }
  };

	  const handleSaveCaseDirect = async (announce = true, stepOverrides: Record<string, StepDraft> = {}) => {
		    if ((isCreating && !canCreateTestCases) || (!isCreating && !canUpdateTestCases)) {
		      showError(new Error(`Permission required: ${isCreating ? "testcase.create" : "testcase.update"}`), isCreating ? "Unable to create test case" : "Unable to update test case");
		      return false;
		    }

		    if (!isCreating && (!selectedTestCase || isSelectedTestCaseDetailPending)) {
		      showError(new Error("Wait for the complete test case details to load before saving."), "Unable to update test case");
		      return false;
		    }

	    try {
	      await persistSelectedSuiteParameterValues();
      const labels = parseReferenceList(caseDraft.labelsText);
      const sanitizedGherkinDocument = sanitizeGherkinDocumentText(caseDraft.gherkin_document);
      const persistedGherkinDocument = linkedRequirementTitle
        ? setGherkinFeatureTitle(sanitizedGherkinDocument, linkedRequirementTitle)
        : sanitizedGherkinDocument;
      const persistedSteps = displaySteps.map((step, index) => {
        const draft = stepOverrides[step.id] || stepDrafts[step.id];
        const persistedStep = {
          id: step.id,
          test_case_id: step.test_case_id,
          step_order: index + 1,
          action: draft?.action ?? step.action ?? "",
          expected_result: draft?.expected_result ?? step.expected_result ?? "",
          step_type: normalizeStepType(draft?.step_type || step.step_type),
          automation_code: normalizeAutomationCode(draft?.automation_code ?? step.automation_code),
          api_request: normalizeApiRequest(draft?.api_request ?? step.api_request),
          group_id: step.group_id || null,
          group_name: step.group_name || null,
          group_kind: step.group_kind || null,
          reusable_group_id: step.reusable_group_id || null
        };
        return persistedStep;
      });
      const authoredSteps = caseDraft.authoring_mode === "gherkin"
        ? buildCaseStepsFromGherkin(persistedGherkinDocument, persistedSteps)
            .map((step, index) => ({ ...step, step_order: index + 1 }))
        : persistedSteps;
      const savedSteps = authoredSteps.map((step) => canEditAutomationCode ? step : stripAutomationStepFields(step));
      const resolvedAiQualityScore = calculateTestCaseAiQualityScore({
        title: caseDraft.title,
        description: caseDraft.description,
        steps: authoredSteps,
        requirementId: caseDraft.requirement_id,
        labels,
        parameterValues: visibleTestCaseParameterValues
      });

      if (isCreating) {
        lastCaseSaveNoticeRef.current = "";
        const requirementIds = canViewRequirements ? [...new Set([
          ...(caseDraft.requirement_id ? [caseDraft.requirement_id] : []),
          ...(activeBugConversion?.requirementIds || [])
        ])] : [];
        const moduleIds = [...new Set([
          ...(caseDraft.module_id ? [caseDraft.module_id] : []),
          ...(activeBugConversion?.moduleIds || [])
        ])];
        const suiteIds = can("suite.view") ? [...new Set([
          ...(createSuiteContextId ? [createSuiteContextId] : []),
          ...(activeBugConversion?.suiteIds || [])
        ])] : [];
        const response = await createTestCase.mutateAsync({
          app_type_id: appTypeId,
          source_issue_id: activeBugConversion?.bugId,
          suite_ids: suiteIds,
          title: caseDraft.title,
          description: caseDraft.description || undefined,
          external_references: parseReferenceList(caseDraft.externalReferencesText),
          labels,
          parameter_values: visibleTestCaseParameterValues,
          automated: caseDraft.automated,
          authoring_mode: caseDraft.authoring_mode,
          test_case_type: caseDraft.test_case_type,
          gherkin_document: persistedGherkinDocument || null,
          ...(canViewTestData ? { test_data_set_ids: linkedDataSetDraftIds.slice(0, 1), test_data_options: { override_shared_steps: overrideSharedGroupData } } : {}),
          priority: Number(caseDraft.priority),
          status: caseDraft.status,
          requirement_ids: requirementIds,
          author_id: caseDraft.author_id,
          reviewer_id: caseDraft.reviewer_id || (caseDraft.ai_generation_source ? reviewUserId : null),
          review_status: caseDraft.reviewer_id || caseDraft.ai_generation_source ? "pending" : "not_requested",
          ...(caseDraft.ai_generation_source ? { ai_generation_source: caseDraft.ai_generation_source } : {}),
          ai_quality_score: resolvedAiQualityScore,
          steps: (caseDraft.authoring_mode === "gherkin" ? normalizeDraftSteps(authoredSteps) : normalizeDraftSteps(draftSteps)).map((step) => (
            canEditAutomationCode ? step : stripAutomationStepFields(step)
          ))
        });

        if (moduleIds.length) {
          const moduleAssignments = await Promise.allSettled(moduleIds.map((moduleId) => assignCasesToModule.mutateAsync({
            id: moduleId,
            testCaseIds: [response.id],
            append: true
          })));
          const failedModuleCount = moduleAssignments.filter((result) => result.status === "rejected").length;
          if (failedModuleCount) {
            lastCaseSaveNoticeRef.current = `Test Case created, but ${failedModuleCount} imported Module link${failedModuleCount === 1 ? "" : "s"} could not be saved.`;
          }
        }

        if (activeBugConversion?.bugId) {
          // Creation records conversion origin even if the editable back-link
          // cannot be saved. Refresh the catalog metric in either outcome.
          await queryClient.invalidateQueries({ queryKey: ["issues"] });
          try {
            const sourceBug = await api.issues.get(activeBugConversion.bugId, { project_id: projectId || undefined });
            await api.issues.update(activeBugConversion.bugId, {
              linked_test_case_ids: [...new Set([
                ...(sourceBug.linked_test_case_ids || activeBugConversion.existingTestCaseIds),
                response.id
              ])],
              expected_revision: sourceBug.revision
            });
            await queryClient.invalidateQueries({ queryKey: ["issues"] });
            lastCaseSaveNoticeRef.current = [
              lastCaseSaveNoticeRef.current,
              `Test Case created and linked back to Defect ${activeBugConversion.bugDisplayId}.`
            ].filter(Boolean).join(" ");
          } catch {
            lastCaseSaveNoticeRef.current = [
              lastCaseSaveNoticeRef.current,
              `The source Defect ${activeBugConversion.bugDisplayId} link could not be updated; you can link it manually from the Defect details screen.`
            ].filter(Boolean).join(" ");
          }
        }

        clearStoredTestCaseParameterDraft(createCaseParameterDraftScopeKey);
        syncTestCaseSearchParams(response.id);
        setCreateSuiteContextId("");
        setActiveBugConversion(null);
        setSelectedTestCaseId(response.id);
        setIsCreating(false);
        setCaseDeliveryRelease("");
        setCaseDeliverySprint("");
        setDraftSteps([]);
        setSelectedStepIds([]);
        setStepInsertIndex(null);
        setStepInsertGroupContext(null);
        if (announce) {
          showSuccess("Test case created with its draft steps.");
        }
      } else if (selectedTestCase) {
        const existingAutomationStatus = selectedTestCase.automation_status
          || (selectedTestCase.automated === "yes" ? "ready" : "not_automated");
        const hasMappedAutomation = canViewAutomationCode
          && displaySteps.some((step) => stepHasAutomation(stepDrafts[step.id] || step));

        await updateTestCase.mutateAsync({
          id: selectedTestCase.id,
          input: {
            app_type_id: appTypeId,
            title: caseDraft.title,
            description: caseDraft.description,
            external_references: parseReferenceList(caseDraft.externalReferencesText),
            labels,
            parameter_values: visibleTestCaseParameterValues,
            automated: caseDraft.automated,
            authoring_mode: caseDraft.authoring_mode,
            test_case_type: caseDraft.test_case_type,
            gherkin_document: persistedGherkinDocument || null,
            ...(canViewTestData ? { test_data_set_ids: linkedDataSetDraftIds.slice(0, 1), test_data_options: { override_shared_steps: overrideSharedGroupData } } : {}),
            automation_status: caseDraft.automated === "yes"
              ? selectedTestCase.automated === "yes" ? existingAutomationStatus : hasMappedAutomation ? "ready" : "incomplete"
              : "not_automated",
            priority: Number(caseDraft.priority),
            status: caseDraft.status,
            ...(canViewRequirements ? { requirement_ids: caseDraft.requirement_id ? [caseDraft.requirement_id] : [] } : {}),
            author_id: caseDraft.author_id,
            reviewer_id: caseDraft.reviewer_id || null,
            ai_quality_score: resolvedAiQualityScore,
            expected_revision: selectedTestCase.revision,
            steps: savedSteps
          }
        });

        if (caseDraft.module_id && caseDraft.module_id !== selectedCaseModuleId) {
          await assignCasesToModule.mutateAsync({
            id: caseDraft.module_id,
            testCaseIds: [selectedTestCase.id],
            append: true
          });
        } else if (!caseDraft.module_id && selectedCaseModuleId) {
          const removal = await removeCasesFromModule.mutateAsync({
            id: selectedCaseModuleId,
            testCaseIds: [selectedTestCase.id]
          });
          if (removal.retained_test_case_ids?.includes(selectedTestCase.id)) {
            lastCaseSaveNoticeRef.current = `Test Case saved. ${removal.message || "Story-linked module membership remains. Change the Story assignment to remove it."}`;
            setCaseDraft((current) => ({ ...current, module_id: selectedCaseModuleId }));
          }
        }

        syncCachedTestCaseParameterValues(selectedTestCase.id, visibleTestCaseParameterValues);
        clearStoredTestCaseParameterDraft(selectedCaseParameterDraftScopeKey);
        await queryClient.invalidateQueries({ queryKey: ["test-case-steps", selectedTestCase.id] });
        if (persistedSteps.some((step) => step.reusable_group_id)) {
          await refreshSharedGroups();
        }
        clearStepSelectionIfClipboardActive();
        if (announce) {
          showSuccess(lastCaseSaveNoticeRef.current || "Test case updated.");
        }
      }

      await refreshCases();
      return true;
    } catch (error) {
      showError(error, "Unable to save test case");
      return false;
    }
  };

  const handleSaveCase = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await handleSaveCaseAndSteps();
  };

  const handleSaveCaseAndSteps = async (stepOverrides: Record<string, StepDraft> = {}, successMessage?: string) => {
    if (!caseDraft.title.trim()) {
      setExpandedSections((current) => ({ ...current, case: true }));
      setMessageTone("error");
      setMessage("Add a test case title before saving.");
      return false;
    }

    if (stepInsertIndex !== null) {
      setMessageTone("error");
      setMessage("Save or cancel the open step draft before saving the test case.");
      return false;
    }

    lastCaseSaveNoticeRef.current = "";
    const didSaveCase = await handleSaveCaseDirect(false, stepOverrides);

    if (!didSaveCase) {
      return false;
    }

    showSuccess(lastCaseSaveNoticeRef.current || successMessage || (isCreating ? "Test case created with its draft steps." : "Test case details, Test Params, preconditions, and steps saved."));
    lastCaseSaveNoticeRef.current = "";
    return true;
  };

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
        showSuccess(`Automation generator queued as ${response.transaction_id.slice(0, 8)}. Track it in TestOps.`);
      } else {
        const response = await buildBatchAutomation.mutateAsync({ testCaseIds: automationTargetCaseIds });
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

  const handleCreateStep = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const normalizedDraft = {
      action: newStepDraft.action.trim(),
      expected_result: newStepDraft.expected_result.trim(),
      step_type: normalizeStepType(newStepDraft.step_type),
      automation_code: normalizeAutomationCode(newStepDraft.automation_code),
      api_request: normalizeApiRequest(newStepDraft.api_request)
    };

    if (!normalizedDraft.action && !normalizedDraft.expected_result) {
      setMessageTone("error");
      setMessage("Add an action or expected result before creating a step.");
      return;
    }

    if (isCreating) {
      const draftId = createDraftStepId();
      const insertionIndex = resolveStepInsertIndex(draftSteps);
      const insertionGroupContext =
        stepInsertIndex !== null && stepInsertGroupContext
          ? stepInsertGroupContext
          : getInsertionGroupContext(displaySteps, insertionIndex);

      setDraftSteps((current) => {
        const next = [...current];
        next.splice(insertionIndex, 0, {
          id: draftId,
          ...normalizedDraft,
          group_id: insertionGroupContext?.group_id || null,
          group_name: insertionGroupContext?.group_name || null,
          group_kind: insertionGroupContext?.group_kind || null,
          reusable_group_id: insertionGroupContext?.reusable_group_id || null
        });
        return next;
      });
      setExpandedStepIds((current) => [...new Set([...current, draftId])]);
      setNewStepDraft(EMPTY_STEP_DRAFT);
      setStepInsertIndex(null);
      setStepInsertGroupContext(null);
      showSuccess("Draft step added to the new test case.");
      return;
    }

    if (!selectedTestCaseId) {
      return;
    }

    try {
      const insertionIndex = resolveStepInsertIndex(steps);
      const insertionGroupContext =
        stepInsertIndex !== null && stepInsertGroupContext
          ? stepInsertGroupContext
          : getInsertionGroupContext(displaySteps, insertionIndex);
      const nextStepOrder = insertionIndex + 1;
      const stepInput = {
        test_case_id: selectedTestCaseId,
        step_order: nextStepOrder,
        action: normalizedDraft.action || undefined,
        expected_result: normalizedDraft.expected_result || undefined,
        step_type: normalizedDraft.step_type,
        automation_code: normalizedDraft.automation_code || undefined,
        api_request: normalizedDraft.api_request || undefined,
        group_id: insertionGroupContext?.group_id || undefined,
        group_name: insertionGroupContext?.group_name || undefined,
        group_kind: insertionGroupContext?.group_kind || undefined,
        reusable_group_id: insertionGroupContext?.reusable_group_id || undefined
      };
      const response = await createStep.mutateAsync(
        canEditAutomationCode ? stepInput : stripAutomationStepFields(stepInput)
      );
      setNewStepDraft(EMPTY_STEP_DRAFT);
      setStepInsertIndex(null);
      setStepInsertGroupContext(null);
      setExpandedStepIds((current) => [...new Set([...current, response.id])]);
      showSuccess("Step added.");
      await queryClient.invalidateQueries({ queryKey: ["test-case-steps", selectedTestCaseId] });
      if (insertionGroupContext?.reusable_group_id) {
        await refreshSharedGroups();
      }
    } catch (error) {
      showError(error, "Unable to add step");
    }
  };

  useEffect(() => {
    setStepInsertIndex(null);
    setStepInsertGroupContext(null);
  }, [isCreating, selectedTestCaseId]);

  const handleUpdateStep = async (step: TestStep, input: StepDraft) => {
    const normalizedInput = {
      action: input.action,
      expected_result: input.expected_result,
      step_type: normalizeStepType(input.step_type),
      automation_code: normalizeAutomationCode(input.automation_code),
      api_request: normalizeApiRequest(input.api_request)
    };

    setStepDrafts((current) => ({
      ...current,
      [step.id]: normalizedInput
    }));
    await handleSaveCaseAndSteps({ [step.id]: normalizedInput }, "Test case and step edits saved.");
  };

  const handleReorderStep = async (stepId: string, direction: "up" | "down") => {
    if (!selectedTestCaseId) {
      return;
    }

    const currentIndex = steps.findIndex((step) => step.id === stepId);
    const targetIndex = direction === "up" ? currentIndex - 1 : currentIndex + 1;

    if (currentIndex === -1 || targetIndex < 0 || targetIndex >= steps.length) {
      return;
    }

    const currentStep = steps[currentIndex];
    const targetStep = steps[targetIndex];

    let reordered: TestStep[] = [];

    if (currentStep.group_id) {
      if (targetStep.group_id !== currentStep.group_id) {
        return;
      }

      reordered = [...steps];
      const [movedStep] = reordered.splice(currentIndex, 1);
      reordered.splice(targetIndex, 0, movedStep);
    } else {
      const blocks = buildStepBlocks(steps);
      const blockIndex = blocks.findIndex((block) => block.steps.some((step) => step.id === stepId));
      const swapIndex = direction === "up" ? blockIndex - 1 : blockIndex + 1;

      if (blockIndex === -1 || swapIndex < 0 || swapIndex >= blocks.length) {
        return;
      }

      const reorderedBlocks = [...blocks];
      const [movedBlock] = reorderedBlocks.splice(blockIndex, 1);
      reorderedBlocks.splice(swapIndex, 0, movedBlock);
      const newOrderIds = reorderedBlocks.flatMap((block) => block.steps.map((step) => step.id));
      const stepById = new Map(steps.map((step) => [step.id, step]));
      reordered = newOrderIds.map((id) => stepById.get(id)).filter(Boolean) as TestStep[];
    }

    try {
      await reorderSteps.mutateAsync({
        testCaseId: selectedTestCaseId,
        stepIds: reordered.map((step) => step.id)
      });
      showSuccess("Step order updated.");
      await queryClient.invalidateQueries({ queryKey: ["test-case-steps", selectedTestCaseId] });
      if (currentStep.reusable_group_id) {
        await refreshSharedGroups();
      }
    } catch (error) {
      showError(error, "Unable to reorder steps");
    }
  };

  const handleMoveStepGroup = async (groupId: string, direction: "up" | "down") => {
    if (!groupId) {
      return;
    }

    const items = displaySteps;
    const blocks = buildStepBlocks(items);
    const blockIndex = blocks.findIndex((block) => block.group_id === groupId);
    const swapIndex = direction === "up" ? blockIndex - 1 : blockIndex + 1;

    if (blockIndex === -1 || swapIndex < 0 || swapIndex >= blocks.length) {
      return;
    }

    const reorderedBlocks = [...blocks];
    const [movedBlock] = reorderedBlocks.splice(blockIndex, 1);
    reorderedBlocks.splice(swapIndex, 0, movedBlock);
    const newOrderIds = reorderedBlocks.flatMap((block) => block.steps.map((step) => step.id));

    if (isCreating) {
      setDraftSteps((current) => {
        const stepById = new Map(current.map((step) => [step.id, step]));
        return newOrderIds.map((id) => stepById.get(id)).filter(Boolean) as DraftTestStep[];
      });
      showSuccess("Step group order updated.");
      return;
    }

    if (!selectedTestCaseId) {
      return;
    }

    try {
      await reorderSteps.mutateAsync({
        testCaseId: selectedTestCaseId,
        stepIds: newOrderIds
      });
      showSuccess("Step group order updated.");
      await queryClient.invalidateQueries({ queryKey: ["test-case-steps", selectedTestCaseId] });
    } catch (error) {
      showError(error, "Unable to move step group");
    }
  };

  const handleDeleteStep = async (stepId: string) => {
    const targetStep = displaySteps.find((step) => step.id === stepId) || null;

    if (!isCreating && targetStep && stepHasAutomation(targetStep) && !canEditAutomationCode) {
      showError(new Error("Automation build and code access are required to delete an automated step."), "Unable to delete step");
      return;
    }

    if (isCreating) {
      setDraftSteps((current) => current.filter((step) => step.id !== stepId));
      if (copiedSteps.length || cutStepSource?.stepIds.length) {
        setSelectedStepIds([]);
      } else {
        setSelectedStepIds((current) => current.filter((id) => id !== stepId));
      }
      setExpandedStepIds((current) => current.filter((id) => id !== stepId));
      showSuccess("Draft step removed.");
      return;
    }

    if (!(await confirmDelete({ message: "Delete this step?" }))) {
      return;
    }

    try {
      await deleteStep.mutateAsync(stepId);
      if (copiedSteps.length || cutStepSource?.stepIds.length) {
        setSelectedStepIds([]);
      } else {
        setSelectedStepIds((current) => current.filter((id) => id !== stepId));
      }
      setExpandedStepIds((current) => current.filter((id) => id !== stepId));
      showSuccess("Step deleted.");
      await queryClient.invalidateQueries({ queryKey: ["test-case-steps", selectedTestCaseId] });
      if (targetStep?.reusable_group_id) {
        await refreshSharedGroups();
      }
    } catch (error) {
      showError(error, "Unable to delete step");
    }
  };

  const handleDeleteSelectedSteps = async () => {
    const targetIds = selectedStepIds.filter((id) => displaySteps.some((step) => step.id === id));

    if (!targetIds.length) {
      showError(new Error("Select one or more steps to delete."), "Unable to delete selected steps");
      return;
    }

    const targetSteps = displaySteps.filter((step) => targetIds.includes(step.id));
    if (!isCreating && targetSteps.some((step) => stepHasAutomation(step)) && !canEditAutomationCode) {
      showError(new Error("Automation build and code access are required to delete automated steps."), "Unable to delete selected steps");
      return;
    }

    const countLabel = `${targetIds.length} selected step${targetIds.length === 1 ? "" : "s"}`;

    if (!(await confirmDelete({ message: `Delete ${countLabel}?` }))) {
      return;
    }

    if (isCreating) {
      setDraftSteps((current) => current.filter((step) => !targetIds.includes(step.id)));
      setSelectedStepIds([]);
      setExpandedStepIds((current) => current.filter((id) => !targetIds.includes(id)));
      cancelStepInsert();
      showSuccess(`${countLabel} deleted.`);
      return;
    }

    if (!selectedTestCaseId) {
      return;
    }

    try {
      await api.testSteps.deleteMany({ test_case_id: selectedTestCaseId, step_ids: targetIds });

      setSelectedStepIds([]);
      setExpandedStepIds((current) => current.filter((id) => !targetIds.includes(id)));
      cancelStepInsert();
      showSuccess(`${countLabel} deleted.`);
      await queryClient.invalidateQueries({ queryKey: ["test-case-steps", selectedTestCaseId] });
      if (targetSteps.some((step) => step.reusable_group_id)) {
        await refreshSharedGroups();
      }
    } catch (error) {
      showError(error, "Unable to delete selected steps");
    }
  };

  const handleUpdateDraftStep = (stepId: string, input: StepDraft) => {
    setDraftSteps((current) =>
      current.map((step) =>
        step.id === stepId
          ? {
              ...step,
              action: input.action,
              expected_result: input.expected_result,
              step_type: normalizeStepType(input.step_type),
              automation_code: normalizeAutomationCode(input.automation_code),
              api_request: normalizeApiRequest(input.api_request)
            }
          : step
      )
    );
  };

  const handleRephraseStepWithAi = async (step: TestStep) => {
    if (!appTypeId) {
      showError(new Error("Select an app type before asking AI to rephrase a step."), "Unable to rephrase step");
      return;
    }

    const currentDraft = stepDrafts[step.id] || {
      action: step.action || "",
      expected_result: step.expected_result || "",
      step_type: normalizeStepType(step.step_type),
      automation_code: normalizeAutomationCode(step.automation_code),
      api_request: normalizeApiRequest(step.api_request)
    };

    if (!currentDraft.action.trim() && !currentDraft.expected_result.trim()) {
      showError(new Error("Write an action or expected result before asking AI to rephrase this step."), "Unable to rephrase step");
      return;
    }

    setRephrasingStepId(step.id);

    try {
      const response = await rephraseStepWithAi.mutateAsync({
        app_type_id: appTypeId,
        requirement_id: caseDraft.requirement_id || undefined,
        integration_id: integrationId || undefined,
        test_case: {
          title: caseDraft.title || selectedTestCase?.title || "",
          description: caseDraft.description || selectedTestCase?.description || "",
          parameter_values: testCaseParameterValues
        },
        step: {
          step_order: step.step_order,
          step_type: normalizeStepType(currentDraft.step_type || step.step_type),
          action: currentDraft.action,
          expected_result: currentDraft.expected_result
        }
      });
      const nextDraft: StepDraft = {
        ...currentDraft,
        action: response.step.action || "",
        expected_result: response.step.expected_result || "",
        step_type: normalizeStepType(response.step.step_type || currentDraft.step_type)
      };

      if (isCreating) {
        handleUpdateDraftStep(step.id, nextDraft);
      } else {
        await updateStep.mutateAsync({
          id: step.id,
          input: {
            action: nextDraft.action,
            expected_result: nextDraft.expected_result,
            step_type: nextDraft.step_type
          }
        });
        setStepDrafts((current) => ({
          ...current,
          [step.id]: nextDraft
        }));
        await queryClient.invalidateQueries({ queryKey: ["test-case-steps", selectedTestCaseId] });
        if (step.reusable_group_id) {
          await refreshSharedGroups();
        }
      }

      showSuccess(`Step ${step.step_order} rephrased with AI.`);
    } catch (error) {
      showError(error, "Unable to rephrase step");
    } finally {
      setRephrasingStepId("");
    }
  };

  const buildStepBlocks = <T extends { id: string; group_id?: string | null }>(items: T[]) =>
    items.reduce<Array<{ group_id: string | null; steps: T[] }>>((blocks, step) => {
      const previousBlock = blocks[blocks.length - 1];

      const resolvedGroupId = step.group_id ?? null;

      if (resolvedGroupId && previousBlock?.group_id === resolvedGroupId) {
        previousBlock.steps.push(step);
        return blocks;
      }

      blocks.push({
        group_id: resolvedGroupId,
        steps: [step]
      });

      return blocks;
    }, []);

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

  const handleCloneCase = async (testCase: TestCase) => {
	    if (!canCreateTestCases) {
	      showError(new Error("Permission required: testcase.create"), "Unable to clone test case");
	      return;
	    }

    if (!projectId) {
      showError(new Error("Select a project before cloning a test case."), "Unable to clone test case");
      return;
    }

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
        automated: canEditAutomationCode ? sourceTestCase.automated || defaultTestCaseAutomated : "no",
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
      setDraftSteps([]);
      showSuccess(`Cloned "${sourceTestCase.title}" with its current steps.`);
      await refreshCases();
    } catch (error) {
      showError(error, "Unable to clone test case");
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
    setAiPreviewCases([]);
    setAiPreviewMessage("");
    setAiPreviewTone("success");
    setIsAiStudioOpen(true);
  };

	  const handleAddAiReferenceImages = async (files: FileList | null) => {
	    try {
	      const images = await readImageFiles(files);
      setAiPreviewCases([]);
      setAiPreviewMessage("");
      let budgetMessage = "";
      setAiReferenceImages((current) => {
        const result = mergeAiReferenceImagesWithinBudget(current, images);
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
      const images = await readImageFiles(files);
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

	    if (!appTypeId || !aiRequirementIds.length) {
	      return;
	    }

    if (previewDesignedCases.isPending) return;
    aiDesignControllerRef.current?.abort();
    const controller = new AbortController();
    aiDesignControllerRef.current = controller;
    try {
      const response = await previewDesignedCases.mutateAsync({ signal: controller.signal, input: {
        app_type_id: appTypeId,
        requirement_ids: aiRequirementIds,
        integration_id: integrationId || undefined,
        max_cases: maxCases,
        authoring_mode: authoringMode,
        additional_context: aiAdditionalContext || undefined,
        external_links: parseExternalLinks(aiExternalLinksText),
        images: aiReferenceImages
      } });
      if (controller.signal.aborted || aiDesignControllerRef.current !== controller) return;

      setAiPreviewCases(response.cases);
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

	    if (!appTypeId || !aiCaseAuthoringRequirementId) {
	      setAiCaseAuthoringTone("error");
      setAiCaseAuthoringMessage("Choose the linked story before generating an AI authoring preview.");
      return;
    }

    if (previewCaseAuthoring.isPending) return;
    aiCaseAuthoringControllerRef.current?.abort();
    const controller = new AbortController();
    aiCaseAuthoringControllerRef.current = controller;
    try {
      const response = await previewCaseAuthoring.mutateAsync({ signal: controller.signal, input: {
        app_type_id: appTypeId,
        requirement_id: aiCaseAuthoringRequirementId,
        authoring_mode: authoringMode,
        integration_id: integrationId || undefined,
        additional_context: aiCaseAuthoringAdditionalContext || undefined,
        external_links: parseExternalLinks(aiCaseAuthoringExternalLinksText),
        images: aiCaseAuthoringReferenceImages,
        test_case: aiCaseAuthoringSourceDraft
      } });
      if (controller.signal.aborted || aiCaseAuthoringControllerRef.current !== controller) return;

      setAiCaseAuthoringPreview(response.case);
      setAiCaseAuthoringTone("success");
      setAiCaseAuthoringMessage(
        response.context_reduced ? response.context_reduction_reason || "Reduced context was used; review against the original Story." : response.case.authoring_mode === "gherkin"
          ? "Prepared an improved Gherkin specification from the selected Story and current Test Case. Review it before applying."
          : `Prepared ${response.case.step_count} assisted step${response.case.step_count === 1 ? "" : "s"} from the selected Story and current draft. Review before applying.`
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

    if (!aiCaseAuthoringPreview.title.trim() || aiCaseAuthoringPreview.title.length > 255) {
      setAiCaseAuthoringTone("error");
      setAiCaseAuthoringMessage("Enter a test case title between 1 and 255 characters before applying the improvement.");
      return;
    }

    const normalizedPreviewParameterValues = normalizeTestCaseParameterValues(aiCaseAuthoringPreview.parameter_values);

    if (isCreating) {
      const nextDraftSteps = aiCaseAuthoringPreview.authoring_mode === "gherkin"
        ? []
        : buildDraftStepsFromAiAuthoringPreview(aiCaseAuthoringPreview);

      setCaseDraft((current) => ({
        ...current,
        ai_generation_source: "interactive",
        reviewer_id: current.reviewer_id || reviewUserId,
        title: aiCaseAuthoringPreview.title,
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
      showSuccess("AI-authored content applied to the new test case draft.");
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
          description: aiCaseAuthoringPreview.description || "",
          authoring_mode: aiCaseAuthoringPreview.authoring_mode || "structured",
          gherkin_document: aiCaseAuthoringPreview.authoring_mode === "gherkin" ? aiCaseAuthoringPreview.gherkin_document || "" : null,
          parameter_values: normalizedPreviewParameterValues,
          requirement_ids: aiCaseAuthoringRequirementId ? [aiCaseAuthoringRequirementId] : [],
          steps: aiCaseAuthoringPreview.authoring_mode === "gherkin" ? [] : buildPersistedStepsFromAiAuthoringPreview(aiCaseAuthoringPreview)
        }
      });

      setCaseDraft((current) => ({
        ...current,
        title: aiCaseAuthoringPreview.title,
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
      showSuccess("AI-authored content replaced the saved test case steps and Test Params.");
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

	    if (!appTypeId || !aiRequirementIds.length || !aiPreviewCases.length) {
	      return;
	    }
    const selectedCaseSet = new Set(selectedClientIds?.length ? selectedClientIds : aiPreviewCases.map((item) => item.client_id));
    const acceptedPreviewCases = aiPreviewCases.filter((item) => selectedCaseSet.has(item.client_id));

    if (!acceptedPreviewCases.length) {
      setAiPreviewTone("error");
      setAiPreviewMessage("Select at least one AI-generated case to accept.");
      return;
    }

    if (acceptedPreviewCases.some((item) => !item.title.trim() || item.title.length > 255)) {
      setAiPreviewTone("error");
      setAiPreviewMessage("Every selected Test Case draft needs a title between 1 and 255 characters.");
      return;
    }

    try {
      const response = await acceptDesignedCases.mutateAsync({
        app_type_id: appTypeId,
        requirement_ids: aiRequirementIds,
        status: "draft",
        cases: acceptedPreviewCases.map((item) => ({
          title: item.title,
          description: item.description,
          priority: item.priority,
          requirement_ids: item.requirement_ids,
          authoring_mode: item.authoring_mode,
          gherkin_document: item.gherkin_document,
          parameter_values: item.parameter_values,
          steps: item.steps.map((step) => ({
            step_order: step.step_order,
            step_type: step.step_type || "web",
            action: step.action,
            expected_result: step.expected_result
          }))
        }))
      });

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
      const response = await createGenerationJob.mutateAsync({
        app_type_id: appTypeId,
        requirement_ids: aiRequirementIds,
        integration_id: integrationId || undefined,
        max_cases_per_requirement: maxCases,
        parallel_requirement_limit: parallelRequirementLimit,
        authoring_mode: authoringMode,
        additional_context: aiAdditionalContext || undefined,
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

  const selectedRequirement = requirements.find((item) => item.id === caseDraft.requirement_id) || null;
  const caseDraftLabels = useMemo(() => parseReferenceList(caseDraft.labelsText), [caseDraft.labelsText]);
  const gherkinQualitySteps = useMemo(() => buildGherkinQualitySteps(caseDraft.gherkin_document), [caseDraft.gherkin_document]);
  const qualityAnalysisSteps = useMemo(
    () => caseDraft.authoring_mode === "gherkin"
      ? gherkinQualitySteps
      : canViewAutomationCode
        ? displaySteps
        : displaySteps.map((step) => ({ ...step, automation_code: "", api_request: null })),
    [canViewAutomationCode, caseDraft.authoring_mode, displaySteps, gherkinQualitySteps]
  );
  const computedCaseAiQualityScore = useMemo(
    () =>
      calculateTestCaseAiQualityScore({
        title: caseDraft.title,
        description: caseDraft.description,
        steps: qualityAnalysisSteps,
        requirementId: caseDraft.requirement_id,
        labels: caseDraftLabels,
        parameterValues: testCaseParameterValues
      }),
    [caseDraft.description, caseDraft.requirement_id, caseDraft.title, caseDraftLabels, qualityAnalysisSteps, testCaseParameterValues]
  );
  const caseQualitySuggestions = useMemo(
    () =>
      buildTestCaseQualitySuggestions({
        title: caseDraft.title,
        description: caseDraft.description,
        steps: qualityAnalysisSteps,
        requirementId: caseDraft.requirement_id,
        labels: caseDraftLabels,
        parameterValues: testCaseParameterValues,
        authoringMode: caseDraft.authoring_mode
      }),
    [caseDraft.authoring_mode, caseDraft.description, caseDraft.requirement_id, caseDraft.title, caseDraftLabels, qualityAnalysisSteps, testCaseParameterValues]
  );
  const testCaseReviewReadiness = useMemo(() => {
    const reviewSteps = caseDraft.authoring_mode === "gherkin"
      ? gherkinQualitySteps
      : displaySteps.map((step) => ({
          action: stepDrafts[step.id]?.action ?? step.action ?? "",
          expected_result: stepDrafts[step.id]?.expected_result ?? step.expected_result ?? ""
        }));
    const completeStepCount = reviewSteps.filter((step) =>
      richTextToPlainText(step.action || "").trim()
      && richTextToPlainText(step.expected_result || "").trim()
    ).length;

    return assessTestCaseReviewReadiness({
      qualityScore: computedCaseAiQualityScore,
      stepCount: reviewSteps.length,
      completeStepCount,
      requirementCount: caseDraft.requirement_id ? 1 : 0,
      reviewStatus: isCreating ? "not_requested" : selectedReviewStatus,
      suggestions: caseQualitySuggestions
    });
  }, [caseDraft.authoring_mode, caseDraft.requirement_id, caseQualitySuggestions, computedCaseAiQualityScore, displaySteps, gherkinQualitySteps, isCreating, selectedReviewStatus, stepDrafts]);
  const selectedTestCaseAssuranceProposedChange = useMemo(() => ({
    title: caseDraft.title,
    description: richTextToPlainText(caseDraft.description),
    status: caseDraft.status,
    priority: caseDraft.priority,
    automated: caseDraft.automated,
    requirement_id: caseDraft.requirement_id,
    module_id: caseDraft.module_id,
    author_id: caseDraft.author_id,
    reviewer_id: caseDraft.reviewer_id,
    authoring_mode: caseDraft.authoring_mode,
    gherkin_document: caseDraft.gherkin_document,
    test_case_type: caseDraft.test_case_type,
    ...(canViewTestData ? { test_data_set_ids: linkedDataSetDraftIds, test_data_options: { override_shared_steps: overrideSharedGroupData } } : {}),
    external_references: parseReferenceList(caseDraft.externalReferencesText),
    labels: caseDraftLabels,
    parameter_values: testCaseParameterValues,
    steps: caseDraft.authoring_mode === "gherkin" ? gherkinQualitySteps : displaySteps.map((step) => ({
      id: step.id,
      step_order: step.step_order,
      step_type: stepDrafts[step.id]?.step_type ?? step.step_type,
      action: richTextToPlainText(stepDrafts[step.id]?.action ?? step.action ?? ""),
      expected_result: richTextToPlainText(stepDrafts[step.id]?.expected_result ?? step.expected_result ?? ""),
      automation_code: canViewAutomationCode ? stepDrafts[step.id]?.automation_code ?? step.automation_code ?? "" : undefined,
      api_request: canViewAutomationCode ? stepDrafts[step.id]?.api_request ?? step.api_request ?? null : undefined
    }))
  }), [canViewTestData, linkedDataSetDraftIds, overrideSharedGroupData, caseDraft.module_id, caseDraft.author_id, caseDraft.reviewer_id, caseDraft.authoring_mode, caseDraft.gherkin_document, caseDraft.test_case_type, gherkinQualitySteps, canViewAutomationCode, caseDraft.automated, caseDraft.description, caseDraft.externalReferencesText, caseDraft.priority, caseDraft.requirement_id, caseDraft.status, caseDraft.title, caseDraftLabels, displaySteps, stepDrafts, testCaseParameterValues]);
  const selectedTestCaseAssuranceSteps = useMemo(
    () => caseDraft.authoring_mode === "gherkin" ? gherkinQualitySteps : selectedTestCaseAssuranceProposedChange.steps,
    [caseDraft.authoring_mode, gherkinQualitySteps, selectedTestCaseAssuranceProposedChange.steps]
  );
  const selectedTestCaseAssuranceFingerprint = useMemo(
    () => JSON.stringify(selectedTestCaseAssuranceProposedChange),
    [selectedTestCaseAssuranceProposedChange]
  );
  useEffect(() => {
    setIsTestCaseImpactPreviewOpen(false);
  }, [selectedTestCase?.id, selectedTestCaseAssuranceFingerprint]);
  const testCaseAssuranceRequestMatchesDraft = Boolean(
    selectedTestCase
    && previewTestCaseImpact.variables?.testCaseId === selectedTestCase.id
    && JSON.stringify(previewTestCaseImpact.variables.input.proposed_change) === selectedTestCaseAssuranceFingerprint
    && (previewTestCaseImpact.variables.input.additional_context || "") === testCaseAssuranceContext
    && previewTestCaseImpact.variables.input.prompt_guidance === [testCaseAssurancePromptGuidance ?? getPrompt("ai.quality.test_case_assurance"), getMetricCriteria("metric.assurance.test_case")].filter(Boolean).join("\n\n")
    && (previewTestCaseImpact.variables.input.integration_id || "") === (testCaseAssuranceIntegrationId || testCaseAssuranceDefaultIntegrationId)
  );
  const testCaseAssurancePreviewMatchesDraft = Boolean(
    testCaseAssuranceRequestMatchesDraft
    && selectedTestCase
    && previewTestCaseImpact.data?.test_case?.id === selectedTestCase.id
  );
  const isTestCaseAssuranceDraftChanged = Boolean(
    selectedTestCase
    && (previewTestCaseImpact.data?.assurance_review || previewTestCaseImpact.data?.assurance)
    && previewTestCaseImpact.data.test_case.id === selectedTestCase.id
    && previewTestCaseImpact.variables?.testCaseId === selectedTestCase.id
    && !testCaseAssurancePreviewMatchesDraft
  );
  const selectedTestCaseImpactPreview = testCaseAssurancePreviewMatchesDraft
    ? previewTestCaseImpact.data
    : null;
  const runTestCaseAssuranceAnalysis = (openImpactPreview = false) => {
    if (!selectedTestCase || !projectId || !canUseTestCaseAi || previewTestCaseImpact.isPending || testCaseAssuranceContextBusy) return;
    setIsTestCaseImpactPreviewOpen(openImpactPreview);
    previewTestCaseImpact.reset();
    previewTestCaseImpact.mutate({
      testCaseId: selectedTestCase.id,
      input: {
        project_id: projectId,
        proposed_change: selectedTestCaseAssuranceProposedChange,
        integration_id: testCaseAssuranceIntegrationId || testCaseAssuranceDefaultIntegrationId || undefined,
        prompt_guidance: [testCaseAssurancePromptGuidance ?? getPrompt("ai.quality.test_case_assurance"), getMetricCriteria("metric.assurance.test_case")].filter(Boolean).join("\n\n"),
        additional_context: testCaseAssuranceContext,
        assurance_baseline: selectedTestCaseLocalAssurance
      }
    });
  };
  const openTestCaseImpactPreview = () => {
    if (testCaseAssurancePreviewMatchesDraft && previewTestCaseImpact.data) {
      setIsTestCaseImpactPreviewOpen(true);
      return;
    }
    runTestCaseAssuranceAnalysis(true);
  };
  const selectedSuiteContext = suites.find((suite) => suite.id === createSuiteContextId) || null;
  const selectedCaseSuites = useMemo(() => {
    if (isCreating) {
      return selectedSuiteContext ? [selectedSuiteContext] : [];
    }

    if (!selectedTestCase) {
      return [];
    }

    const suiteIds = [
      ...(selectedTestCase.suite_ids || []),
      ...(selectedTestCase.suite_id ? [selectedTestCase.suite_id] : [])
    ].filter(Boolean);

    if (!suiteIds.length) {
      return [];
    }

    const suiteIdSet = new Set(suiteIds);
    return suites.filter((suite) => suiteIdSet.has(suite.id));
  }, [isCreating, selectedSuiteContext, selectedTestCase, suites]);
  const selectedHistory = useMemo(() => {
    if (!selectedTestCase) return [];
    const selectedCaseReferences = new Set(
      [selectedTestCase.id, selectedTestCase.display_id].filter(Boolean).map(String)
    );
    const source = selectedTestCaseResultsQuery.data ?? historyByCaseId[selectedTestCase.id] ?? [];
    return source
      .filter((result) => [result.test_case_id, result.test_case_display_id]
        .filter(Boolean)
        .some((reference) => selectedCaseReferences.has(String(reference))))
      .slice()
      .sort((left, right) => {
        const leftTime = Date.parse(String(left.updated_at || left.created_at || "")) || 0;
        const rightTime = Date.parse(String(right.updated_at || right.created_at || "")) || 0;
        if (leftTime !== rightTime) return rightTime - leftTime;
        return String(right.id || "").localeCompare(String(left.id || ""));
      });
  }, [historyByCaseId, selectedTestCase, selectedTestCaseResultsQuery.data]);
  const selectedCaseHealthMetrics = useMemo(() => {
    const latestCaseResultByRun = new Map<string, ExecutionResult>();
    selectedHistory.forEach((result) => {
      const resultWithRunAliases = result as ExecutionResult & {
        run_id?: string | null;
        test_run_id?: string | null;
        executionId?: string | null;
        runId?: string | null;
      };
      const executionId = [
        resultWithRunAliases.execution_id,
        resultWithRunAliases.run_id,
        resultWithRunAliases.test_run_id,
        resultWithRunAliases.executionId,
        resultWithRunAliases.runId
      ].map((value) => String(value || "").trim()).find(Boolean) || "";
      if (!executionId || (!latestCaseResultByRun.has(executionId) && latestCaseResultByRun.size >= 25)) return;

      const current = latestCaseResultByRun.get(executionId);
      if (!current) {
        latestCaseResultByRun.set(executionId, result);
        return;
      }

      const currentTime = Date.parse(String(current.updated_at || current.created_at || ""));
      const resultTime = Date.parse(String(result.updated_at || result.created_at || ""));
      if (
        (Number.isFinite(resultTime) && (!Number.isFinite(currentTime) || resultTime >= currentTime))
        || (!Number.isFinite(resultTime) && !Number.isFinite(currentTime))
      ) {
        latestCaseResultByRun.set(executionId, result);
      }
    });

    const finalizedRuns = [...latestCaseResultByRun.values()]
      .filter((result) => ["passed", "failed", "blocked"].includes(String(result.status || "").toLowerCase()));
    const passedRuns = finalizedRuns.filter((result) => String(result.status || "").toLowerCase() === "passed").length;
    const authoredBehaviorSteps = caseDraft.authoring_mode === "gherkin"
      ? gherkinQualitySteps
      : displaySteps.map((step) => ({
          action: stepDrafts[step.id]?.action ?? step.action ?? "",
          expected_result: stepDrafts[step.id]?.expected_result ?? step.expected_result ?? ""
        }));
    const completeSteps = authoredBehaviorSteps.filter((step) =>
      richTextToPlainText(step.action || "").trim()
      && richTextToPlainText(step.expected_result || "").trim()
    ).length;
    const stepCompleteness = authoredBehaviorSteps.length
      ? Math.round((completeSteps / authoredBehaviorSteps.length) * 100)
      : 0;
    const passRate = finalizedRuns.length ? Math.round((passedRuns / finalizedRuns.length) * 100) : null;

    return {
      authoring: computedCaseAiQualityScore,
      finalizedRuns: finalizedRuns.length,
      passedRuns,
      stepCompleteness,
      passRate
    };
  }, [caseDraft.authoring_mode, computedCaseAiQualityScore, displaySteps, gherkinQualitySteps, selectedHistory, stepDrafts]);
  const authoredBehaviorUnitCount = caseDraft.authoring_mode === "gherkin"
    ? gherkinQualitySteps.length
    : displaySteps.length;
  const selectedTestCaseLocalAssurance = useMemo(
    () => buildTestCaseAssuranceAnalysis({
      title: selectedTestCaseAssuranceProposedChange.title,
      description: selectedTestCaseAssuranceProposedChange.description,
      steps: selectedTestCaseAssuranceSteps,
      requirementCount: selectedTestCaseAssuranceProposedChange.requirement_id ? 1 : 0,
      labels: selectedTestCaseAssuranceProposedChange.labels,
      parameterValues: selectedTestCaseAssuranceProposedChange.parameter_values,
      reviewStatus: selectedReviewStatus,
      finalizedRunCount: selectedCaseHealthMetrics.finalizedRuns,
      passRate: selectedCaseHealthMetrics.passRate,
      suiteCount: selectedCaseSuites.length,
      externalReferenceCount: selectedTestCaseAssuranceProposedChange.external_references.length
    }),
    [selectedCaseHealthMetrics.finalizedRuns, selectedCaseHealthMetrics.passRate, selectedCaseSuites.length, selectedReviewStatus, selectedTestCaseAssuranceProposedChange, selectedTestCaseAssuranceSteps]
  );
  const selectedTestCaseAssurance = mergeAssuranceReview(selectedTestCaseLocalAssurance,
    testCaseAssurancePreviewMatchesDraft ? previewTestCaseImpact.data?.assurance_review || previewTestCaseImpact.data?.assurance : null);
  const selectedTestCaseAssuranceSource = testCaseAssurancePreviewMatchesDraft && previewTestCaseImpact.data?.fallback_used
    ? "fallback"
    : testCaseAssurancePreviewMatchesDraft && (previewTestCaseImpact.data?.assurance_review || previewTestCaseImpact.data?.assurance) ? "ai" : "local";
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
  const detectedStepParameters = useMemo<StepParameterDefinition[]>(
    () => mergeStepParameterDefinitions(
      collectStepParameters([
        { id: `${selectedTestCaseId || "draft"}:title`, action: caseDraft.authoring_mode === "gherkin" ? normalizeGherkinParameterReferences(caseDraft.title) : caseDraft.title, expected_result: "", automation_code: "", api_request: null },
        ...displaySteps.map((step) => ({
          id: step.id,
          action: stepDrafts[step.id]?.action ?? step.action,
          expected_result: stepDrafts[step.id]?.expected_result ?? step.expected_result,
          automation_code: canViewAutomationCode ? stepDrafts[step.id]?.automation_code ?? step.automation_code : "",
          api_request: canViewAutomationCode ? stepDrafts[step.id]?.api_request ?? step.api_request : null
        })),
        ...(caseDraft.authoring_mode === "gherkin" && caseDraft.gherkin_document.trim()
          ? [{
              id: `${selectedTestCaseId || "draft"}:gherkin`,
              action: normalizeGherkinParameterReferences(caseDraft.gherkin_document.split("\n").filter((line) => !/^\s*[@#]/.test(line)).join("\n")),
              expected_result: "",
              automation_code: "",
              api_request: null
            }]
          : [])
      ]).map((definition) => ({ ...definition, source: "authoring" as const })),
      linkedDataSetParameterDefinitions,
      buildStepParameterDefinitionsFromValues(mergedScopedParameterValues)
    ),
    [canViewAutomationCode, caseDraft.title, caseDraft.authoring_mode, caseDraft.gherkin_document, displaySteps, linkedDataSetParameterDefinitions, mergedScopedParameterValues, selectedTestCaseId, stepDrafts]
  );
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
            aria-label={isVisualBuilderActive ? "Return to step list" : "Open flow map"}
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
            disabled={!appTypeId || !integrations.length || !requirements.length}
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
      label: "Automated",
      width: 104,
      minWidth: 88,
      render: (testCase: TestCase) => (testCase.automated === "yes" ? "Yes" : "No")
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
            <LoadingState
              description="Preparing this module while keeping the list in place."
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
      {!isCaseWorkspaceOpen ? (
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
                label: "Total cases",
                value: isTestCaseCatalogMetricLoading ? "—" : testCaseCatalogMetrics.total,
                detail: isTestCaseCatalogMetricLoading
                  ? "Loading catalog"
                  : `${coverageMetrics.covered} linked to requirements across the catalog`
              },
              ...(canViewAutomationInsights ? [{
                label: "Automation coverage",
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
                label: "Recent pass rate",
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
        browseView={(
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
                    description: "Generate draft test cases from linked stories with AI assistance.",
                    icon: <TestCaseSparkIcon />,
                    visible: canUseTestCaseAi && canCreateTestCases && canViewRequirements,
                    disabled: !canUseTestCaseAi || !canCreateTestCases || !canViewRequirements || !appTypeId,
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
                            <LoadingState
                              description="Preparing this module while keeping the workspace responsive."
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
                    const aiInsightTone = isFailedCase ? "danger" : isUnlinkedCase || stabilityScore < 60 ? "warning" : "success";
                    const aiInsight = isFailedCase
                      ? "Signal: Recent failures point to unstable execution evidence. Review latest run details and add negative coverage."
                      : isUnlinkedCase
                        ? "Signal: Link this case to a story so release scope and risk coverage stay traceable."
                        : canUseAutomationWorkspace && testCase.automated !== "yes" && automationReadiness !== null && automationReadiness >= 70
                          ? "Signal: Strong automation candidate with clear scope and repeatable validation steps."
                          : "Signal: Stable recent coverage. Keep it in the release gate for confidence tracking.";
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
                      <div
                        aria-label={`Open test case ${testCase.display_id || testCase.id}: ${testCase.title}`}
                        aria-pressed={isActive}
                        className={[
                          "record-card tile-card test-case-card test-case-catalog-card",
                          isFailedCase ? "is-risk" : isUnlinkedCase || stabilityScore < 60 ? "is-warning" : "is-healthy",
                          isActive ? "is-active" : "",
                          isSelectedForAction ? "is-marked-for-delete" : "",
                          caseModuleById.has(testCase.id) ? "is-module-child" : ""
                        ].filter(Boolean).join(" ")}
                        draggable={canUpdateTestCases && !isDeletingSelectedTestCases}
                        onClick={() => {
                          openTestCaseWorkspace(testCase.id);
                          setIsCreating(false);
                          setDraftSteps([]);
                        }}
                        onDragEnd={() => setDraggingCaseIds([])}
                        onDragStart={(event) => {
                          startDraggingTestCases(testCase.id, event.dataTransfer);
                        }}
                        onKeyDown={(event) => {
                          if (event.target !== event.currentTarget) {
                            return;
                          }

                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            openTestCaseWorkspace(testCase.id);
                            setIsCreating(false);
                            setDraftSteps([]);
                          }
                        }}
                        role="button"
                        tabIndex={0}
                      >
                        <div className="tile-card-main">
                          <div className="tile-card-select-row test-case-card-header">
                            <label className="checkbox-field test-case-delete-checkbox" onClick={(event) => event.stopPropagation()}>
	                              <input
	                                checked={isSelectedForAction}
                                aria-label={`Select Test Case ${testCase.title}`}
                                disabled={isBulkReviewRunning}
                                onChange={(event) =>
                                  setSelectedActionTestCaseIds((current) =>
                                    event.target.checked ? [...new Set([...current, testCase.id])] : current.filter((id) => id !== testCase.id)
                                  )
                                }
		                                type="checkbox"
		                              />
		                            </label>
		                            <span className="test-case-identity">
		                              <TestCaseIcon size={16} />
		                              <DisplayIdBadge value={testCase.display_id || testCase.id} />
		                            </span>
	                            <div className="catalog-inline-actions test-case-top-actions">
	                              {renderReviewDecision(testCase, true)}
	                              <StatusBadge value={statusLabel} />
	                              <div onClick={(event) => event.stopPropagation()}>
	                                <CatalogActionMenu actions={tileActions} label={`${testCase.title} actions`} />
	                              </div>
	                            </div>
		                          </div>
		                          <div className="test-case-requirement-block">
		                            <span className="test-case-requirement-label">Story</span>
		                            <p>
		                              {requirementDisplayId ? (
                                        <span className="test-case-linked-story-id requirement-story-identity">
                                          <StoryIcon size={14} />
                                          <DisplayIdBadge value={requirementDisplayId} />
                                        </span>
                                      ) : null}
		                              <strong title={requirementTitle || "No story linked"}>{requirementTitle || "No story linked"}</strong>
		                            </p>
		                          </div>
		                          <div className="tile-card-title-group test-case-card-title-group test-case-card-title-group--identity">
		                            <strong>{testCase.title}</strong>
		                          </div>
	                          <CatalogCardDescription
	                            fallback="No description yet for this test case."
	                            profile="test-case"
	                            value={testCase.description}
	                          />
                          <div className="test-case-readiness-grid test-case-card-progress-stack">
                            {canUseAutomationWorkspace ? <TileCardProgress
                              breakdown={buildReadinessScoreBreakdown(automationReadiness)}
                              displayValue={automationReadiness === null ? "On open" : `${automationReadiness}%`}
                              label="Automation readiness"
                              title={automationReadiness === null ? "Automation readiness available on open" : `${automationReadiness}% automation readiness score`}
                              value={automationReadiness}
                            /> : null}
                            <TileCardProgress
                              breakdown={buildHistoryStatusBreakdown(history)}
                              displayValue={history.length ? `${stabilityScore}%` : "No runs"}
                              label="Stability"
                              title={history.length ? `${passedRuns} of the last ${history.length} case results passed` : "No recent run stability"}
                              tone={!history.length ? "neutral" : stabilityScore >= 80 ? "success" : stabilityScore >= 60 ? "warning" : "danger"}
                              value={history.length ? stabilityScore : null}
                            />
                          </div>
                          <div className="tile-card-facts test-case-tile-metrics" aria-label={`${testCase.title} facts`}>
                            <TileCardMetric
                              className="test-case-tile-metric"
                              label="Steps"
                              title={stepCount === undefined ? "Open this case to load step details" : `${stepCount} step${stepCount === 1 ? "" : "s"}`}
                              tone={stepCount ? "success" : "neutral"}
                              value={stepCount ?? "—"}
                            />
                            <TileCardMetric
                              className="test-case-tile-metric"
                              label="Defect density"
                              title={`${linkedDefectCount} distinct linked defect${linkedDefectCount === 1 ? "" : "s"} per Test Case`}
                              tone={linkedDefectCount ? "warning" : "success"}
                              value={linkedDefectCount.toFixed(2)}
                            />
                            <TileCardMetric
                              className="test-case-tile-metric"
                              label="Test Quality"
                              title={qualityScore === null ? "Open this case to calculate its Test Quality Score" : `${qualityScore}% Test Quality Score`}
                              tone={qualityScore === null ? "neutral" : qualityScore >= 80 ? "success" : qualityScore >= 60 ? "info" : "warning"}
                              value={qualityScore === null ? "—" : `${qualityScore}%`}
                            />
                            <TileCardMetric
                              className="test-case-tile-metric"
                              label="Failed"
                              title={`${failedRunCount} failed or blocked recent run${failedRunCount === 1 ? "" : "s"}`}
                              tone={failedRunCount ? "danger" : "success"}
                              value={failedRunCount ? `${failedRunCount}x` : "0x"}
                            />
                          </div>
                          <div className="tile-card-footer test-case-card-footer">
                            <div className={`test-case-ai-note ${aiInsightTone}`}>
                              <span aria-hidden="true">{isFailedCase ? "!" : "S"}</span>
                              <p>{aiInsight}</p>
                            </div>
                          </div>
                        </div>
                      </div>
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
                  columns={isReviewQueueOpen
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
                  rowGroups={isReviewQueueOpen ? undefined : testCaseListRowGroups}
                  rows={isReviewQueueOpen ? filteredCases : []}
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
        )}
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
	                  <LoadingState
	                    description="Retrieving the complete metadata before enabling edits, Test Params, and run actions."
	                    label="Loading test case details"
	                  />
	                ) : null}
	                {!isCreating && selectedTestCaseId && !selectedTestCase && !isSelectedTestCaseDetailPending ? (
	                  <div className="empty-state compact">
	                    <div>Complete test case details could not be loaded safely.</div>
	                    <button className="primary-button" onClick={() => void selectedTestCaseDetailQuery.refetch()} type="button">Retry details</button>
	                  </div>
	                ) : null}
	                {isCreating || (selectedTestCase && activeTestCaseDetailTab === "details") ? (
                <div className="detail-section-panel test-case-detail-layout" role="tabpanel">
                <div
                  {...(isTestCaseWorkspaceMutationPending ? ({ inert: "" } as Record<string, string>) : {})}
                  aria-busy={isTestCaseWorkspaceMutationPending}
                  className="editor-accordion test-case-detail-grid"
                >
                  {(() => {
                    const activeLinkedDataSet = testDataSets.find((item) => item.id === linkedDataSetDraftIds[0]);
                    const selectTestCaseAuthoringMode = (authoringMode: "structured" | "gherkin") => {
                      if (authoringMode === caseDraft.authoring_mode) return;
                      if (authoringMode === "structured" && caseDraft.gherkin_document.trim()) {
                        const converted = gherkinToStructuredCase(caseDraft.gherkin_document);
                        if (converted.exampleColumns.length && converted.exampleRows.length && canManageTestData && projectId) {
                          const persistExamples = activeLinkedDataSet
                            ? api.testDataSets.update(activeLinkedDataSet.id, { mode: "table", columns: converted.exampleColumns, rows: converted.exampleRows })
                                .then(() => activeLinkedDataSet.id)
                            : api.testDataSets.create({ project_id: projectId, app_type_id: appTypeId || undefined, name: `${caseDraft.title || "Test case"} examples`, mode: "table", columns: converted.exampleColumns, rows: converted.exampleRows })
                                .then((response) => response.id);
                          void persistExamples.then((dataSetId) => {
                            setLinkedDataSetDraftIds([dataSetId]);
                            return queryClient.invalidateQueries({ queryKey: ["test-data-sets"] });
                          }).catch((error) => showError(error, "Structured steps were restored, but Gherkin Examples could not be saved as Test Data"));
                        }
                        const existingSteps = displaySteps.map((step) => ({ ...step, ...(stepDrafts[step.id] || {}) }));
                        const usedIds = new Set<string>();
                        const toDraft = (step: { action: string; expected_result: string }, index: number, isPrecondition = false): DraftTestStep => {
                          const candidates = existingSteps.filter((item) => !usedIds.has(item.id)
                            && ((item.group_name || "").toLowerCase() === "preconditions") === isPrecondition);
                          const matchingStep = candidates.find((item) =>
                            normalizeSharedGroupComparableText(item.action) === normalizeSharedGroupComparableText(step.action)
                            && normalizeSharedGroupComparableText(item.expected_result) === normalizeSharedGroupComparableText(step.expected_result));
                          const existing = matchingStep || (existingSteps.length === converted.preconditions.length + converted.steps.length
                            ? candidates.find((item) => item.id === existingSteps[index]?.id) : undefined);
                          if (existing) usedIds.add(existing.id);
                          return {
                            id: existing?.id || createDraftStepId(), action: step.action, expected_result: step.expected_result,
                            step_type: normalizeStepType(existing?.step_type), automation_code: normalizeAutomationCode(existing?.automation_code),
                            api_request: normalizeApiRequest(existing?.api_request), group_id: existing?.group_id || null,
                            group_name: existing?.group_name || (isPrecondition ? "Preconditions" : null),
                            group_kind: existing?.group_kind || (isPrecondition ? "local" : null), reusable_group_id: existing?.reusable_group_id || null
                          };
                        };
                        const convertedDrafts = [
                          ...converted.preconditions.map((step, index) => toDraft(step, index, true)),
                          ...converted.steps.map((step, index) => toDraft(step, converted.preconditions.length + index))
                        ];
                        if (isCreating) {
                          setDraftSteps(convertedDrafts);
                        } else {
                          setStepDrafts((current) => ({ ...current, ...Object.fromEntries(convertedDrafts
                            .filter((step) => usedIds.has(step.id))
                            .map((step) => [step.id, {
                              action: step.action, expected_result: step.expected_result, step_type: step.step_type,
                              automation_code: step.automation_code, api_request: step.api_request
                            }])) }));
                          const missingSteps = convertedDrafts.filter((step) => !usedIds.has(step.id));
                          if (selectedTestCaseId && missingSteps.length) {
                            void api.testSteps.createMany({
                              test_case_id: selectedTestCaseId,
                              insertion_index: displaySteps.length,
                              steps: missingSteps.map((step) => ({
                                action: step.action || undefined, expected_result: step.expected_result || undefined,
                                step_type: normalizeStepType(step.step_type), group_id: step.group_id || undefined,
                                group_name: step.group_name || undefined, group_kind: step.group_kind || undefined,
                                reusable_group_id: step.reusable_group_id || undefined
                              }))
                            }).then(async (response) => {
                              const createdIdByDraftId = new Map(missingSteps.map((step, index) => [step.id, response.ids[index]]));
                              const orderedIds = convertedDrafts.map((step) => createdIdByDraftId.get(step.id) || step.id);
                              // Retain any unmatched saved rows and their automation until
                              // the author explicitly removes them in the structured editor.
                              orderedIds.push(...displaySteps.filter((step) => !usedIds.has(step.id)).map((step) => step.id));
                              await api.testSteps.reorder(selectedTestCaseId, orderedIds);
                              await queryClient.invalidateQueries({ queryKey: ["test-case-steps", selectedTestCaseId] });
                            }).catch((error) => showError(error, "Gherkin was retained, but some structured rows could not be created"));
                          }
                        }
                      }
                      setCaseDraft((current) => ({
                        ...current,
                        authoring_mode: authoringMode,
                        gherkin_document: authoringMode === "gherkin"
                          ? buildGroupedCaseGherkin({
                              title: current.title,
                              featureTitle: caseGherkinFeatureTitle,
                              preconditions: preconditionSteps.map((step) => stepDrafts[step.id] || step),
                              steps: mainSteps.map((step) => ({ ...step, ...(stepDrafts[step.id] || {}) })),
                              columns: activeLinkedDataSet?.mode === "table" ? activeLinkedDataSet.columns : [],
                              rows: activeLinkedDataSet?.mode === "table" ? activeLinkedDataSet.rows : []
                            })
                          : current.gherkin_document
                      }));
                    };
                    const handleTestCaseAuthoringTabKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
                      const nextMode = event.key === "ArrowLeft" || event.key === "Home"
                        ? "structured"
                        : event.key === "ArrowRight" || event.key === "End"
                          ? "gherkin"
                          : null;
                      if (!nextMode) return;
                      event.preventDefault();
                      selectTestCaseAuthoringMode(nextMode);
                      requestAnimationFrame(() => document.getElementById(`test-case-${nextMode}-authoring-tab`)?.focus());
                    };
                    const caseDetailsSidebar = (
                  <aside className="test-case-detail-sidebar" aria-label="Test case details and preconditions">
                  <div className="test-case-detail-case-region" ref={caseSectionRef}>
                    <EditorAccordionSection
                      countLabel={isCreating ? "Draft" : caseDraft.status || defaultTestCaseStatus}
                      isExpanded={expandedSections.case}
                      onToggle={() => setExpandedSections((current) => ({ ...current, case: !current.case }))}
                      summary={caseSectionSummary}
                      title={caseSectionTitleContent}
                    >
                      <form id="test-case-authoring-form" className="form-grid test-case-details-form" onInvalidCapture={event => { let panel = (event.target as HTMLElement).closest("details"); while (panel) { panel.open = true; panel = panel.parentElement?.closest("details") || null; } }} onSubmit={(event) => void handleSaveCase(event)}>
                        {!isCreating && selectedTestCase ? (
                          <div className="test-case-detail-identity-card">
                            <span>Test case ID</span>
                            <span className="test-case-detail-record-id test-case-identity">
                              <TestCaseIcon size={15} strokeWidth={1.8} />
                              <DisplayIdBadge value={selectedCaseDisplayId || "Unavailable"} />
                            </span>
                          </div>
                        ) : null}

                        {isCreating && activeBugConversion ? (
                          <section className="bug-conversion-map" aria-label={`Mapped fields from Defect ${activeBugConversion.bugDisplayId}`}>
                            <div className="bug-conversion-map-head">
                              <span className="bug-conversion-map-icon"><BugIcon /></span>
                              <span>
                                <strong>Mapped from Defect {activeBugConversion.bugDisplayId}</strong>
                                <small>Review the imported regression coverage before creating the Test Case.</small>
                              </span>
                              <button
                                className="ghost-button compact"
                                onClick={() => {
                                  setCaseDraft((current) => ({ ...current, requirement_id: "", module_id: "" }));
                                  setCreateSuiteContextId("");
                                  setActiveBugConversion((current) => current ? ({
                                    ...current,
                                    requirementIds: [],
                                    moduleIds: [],
                                    suiteIds: []
                                  }) : current);
                                }}
                                type="button"
                              >
                                Clear linked scope
                              </button>
                            </div>
                            <p>
                              Title, description, priority, labels, delivery context, preconditions, and reproduction steps were copied. The new Test Case will remain linked to the source Defect.
                            </p>
                            {activeBugConversion.requirementIds.length || activeBugConversion.moduleIds.length || createSuiteContextId || activeBugConversion.suiteIds.length ? (
                              <div className="bug-conversion-scope-chips" aria-label="Additional imported associations">
                                {activeBugConversion.requirementIds.map((requirementId) => {
                                  const requirement = requirements.find((item: Requirement) => item.id === requirementId);
                                  return (
                                    <span className="bug-conversion-scope-chip" key={`requirement:${requirementId}`}>
                                      Story · {requirement?.display_id || requirement?.title || requirementId}
                                      <button
                                        aria-label={`Remove imported Story ${requirement?.display_id || requirement?.title || requirementId}`}
                                        onClick={() => setActiveBugConversion((current) => current ? ({ ...current, requirementIds: current.requirementIds.filter((id) => id !== requirementId) }) : current)}
                                        type="button"
                                      >×</button>
                                    </span>
                                  );
                                })}
                                {activeBugConversion.moduleIds.map((moduleId) => {
                                  const module = testCaseModules.find((item) => item.id === moduleId);
                                  return (
                                    <span className="bug-conversion-scope-chip" key={`module:${moduleId}`}>
                                      Module · {module?.name || moduleId}
                                      <button
                                        aria-label={`Remove imported Module ${module?.name || moduleId}`}
                                        onClick={() => setActiveBugConversion((current) => current ? ({ ...current, moduleIds: current.moduleIds.filter((id) => id !== moduleId) }) : current)}
                                        type="button"
                                      >×</button>
                                    </span>
                                  );
                                })}
                                {[...new Set([createSuiteContextId, ...activeBugConversion.suiteIds].filter(Boolean))].map((suiteId) => {
                                  const suite = suites.find((item) => item.id === suiteId);
                                  return (
                                    <span className="bug-conversion-scope-chip" key={`suite:${suiteId}`}>
                                      Suite · {suite?.display_id || suite?.name || suiteId}
                                      <button
                                        aria-label={`Remove imported Suite ${suite?.display_id || suite?.name || suiteId}`}
                                        onClick={() => {
                                          const nextSuiteIds = [createSuiteContextId, ...activeBugConversion.suiteIds]
                                            .filter((id) => id && id !== suiteId);
                                          setCreateSuiteContextId(nextSuiteIds[0] || "");
                                          setActiveBugConversion((current) => current ? ({ ...current, suiteIds: nextSuiteIds.slice(1) }) : current);
                                        }}
                                        type="button"
                                      >×</button>
                                    </span>
                                  );
                                })}
                              </div>
                            ) : null}
                          </section>
                        ) : null}

                        <FormField className="test-case-authoring-field" label="Authoring completeness">
                          <div className="ai-quality-inline test-case-authoring-completeness">
                            <span className={computedCaseAiQualityScore < 70 ? "ai-quality-score is-low" : "ai-quality-score"}>
                              {computedCaseAiQualityScore}%
                            </span>
                            <span>{testCaseReviewReadiness.summary}</span>
                            {computedCaseAiQualityScore < 70 && caseQualitySuggestions.length ? (
                              <button className="ghost-button compact" onClick={() => setIsQualitySuggestionModalOpen(true)} type="button">
                                <TestCaseSparkIcon />
                                <span>Review gaps</span>
                              </button>
                            ) : null}
                          </div>
                        </FormField>

                        <div className="record-grid">
                          <div className="test-case-title-field">
                            <FormField label="Title" required>
                              <input
                                data-autofocus={isCreating ? "true" : undefined}
                                placeholder="Name the behavior…"
                                required
                                value={caseDraft.title}
                                onChange={(event) => setCaseDraft((current) => ({ ...current, title: event.target.value }))}
                              />
                            </FormField>
                          </div>
                          <FormField className="test-case-description-field" label="Description">
                            <RichTextEditor
                              appearance="canonical"
                              aiRephraseContext={{
                                entityType: "test case",
                                entityId: selectedTestCase?.id,
                                entityTitle: caseDraft.title,
                                fieldLabel: "Description",
                                appTypeId,
                                requirementId: caseDraft.requirement_id || undefined,
                                moduleId: caseDraft.module_id || undefined
                              }}
                              aiRephraseTitle="Rephrase test case description with AI"
                              rows={4}
                              value={caseDraft.description}
                              onChange={(description) => setCaseDraft((current) => ({ ...current, description }))}
                            />
                          </FormField>
                          <FormField className="form-field--compact-enum test-case-status-field authoring-property-field" label="Status">
                            <ContextSelect label="Status"
                              value={caseDraft.status}
                              onChange={(event) => setCaseDraft((current) => ({ ...current, status: event.target.value }))}
                            >
                              {testCaseStatusOptions.map((option) => (
                                <option key={option.value} value={option.value}>{option.label}</option>
                              ))}
                            </ContextSelect>
                          </FormField>
                          <FormField className="form-field--compact-enum test-case-priority-field authoring-property-field" label="Priority">
                            <ContextSelect label="Priority"
                              value={caseDraft.priority}
                              onChange={(event) => setCaseDraft((current) => ({ ...current, priority: Number(event.target.value) || 3 }))}
                            >
                              <option value={1}>1 - Highest</option>
                              <option value={2}>2 - High</option>
                              <option value={3}>3 - Medium</option>
                              <option value={4}>4 - Low</option>
                              <option value={5}>5 - Lowest</option>
                            </ContextSelect>
                          </FormField>
                          <details id="test-case-context-properties" className="test-case-context-properties authoring-disclosure" open={!caseDraft.author_id}>
                            <summary><span>Properties & linked work</span><small>{caseDraft.requirement_id ? "Story linked" : caseDraft.module_id ? "Module linked" : caseDraft.test_case_type || "Functional"}</small></summary>
                            <div className="authoring-disclosure-body record-grid">
                          <FormField className="form-field--compact-enum" label="Test case type">
                            <select
                              aria-describedby="test-case-type-hint"
                              value={caseDraft.test_case_type}
                              onChange={(event) => setCaseDraft((current) => ({
                                ...current,
                                test_case_type: event.target.value as NonNullable<TestCase["test_case_type"]>
                              }))}
                            >
                              {testCaseTypeOptions.map((option) => (
                                <option key={option.value} value={option.value}>{option.label}</option>
                              ))}
                            </select>
                            <small id="test-case-type-hint">
                              {testCaseTypeOptions.find((option) => option.value === caseDraft.test_case_type)?.description}
                            </small>
                          </FormField>
                          <FormField className="test-case-author-selector-field" label="Author" required>
                            <select
                              aria-label="Test case author"
                              required
                              value={caseDraft.author_id}
                              onChange={(event) => setCaseDraft((current) => ({ ...current, author_id: event.target.value }))}
                            >
                              <option disabled value="">Select an author</option>
                              {caseDraft.author_id && !assigneeOptions.some((option) => option.id === caseDraft.author_id) ? (
                                <option value={caseDraft.author_id}>
                                  {caseDraft.author_id === session?.user.id
                                    ? `${session.user.name || session.user.email || "Current user"} (You)`
                                    : `${selectedTestCase?.author?.name || selectedTestCase?.author?.email || "Current author"} (Former project member)`}
                                </option>
                              ) : null}
                              {assigneeOptions.map((option) => (
                                <option key={option.id} value={option.id}>
                                  {option.label}{option.id === session?.user.id ? " (You)" : ""}
                                </option>
                              ))}
                            </select>
                          </FormField>
                          <FormField className="test-case-reviewer-field" label="Reviewer">
                            <select
                              value={caseDraft.reviewer_id}
                              onChange={(event) => setCaseDraft((current) => ({ ...current, reviewer_id: event.target.value }))}
                            >
                              <option value="">No reviewer</option>
                              {assigneeOptions.map((option) => (
                                <option key={option.id} value={option.id}>{option.label}</option>
                              ))}
                            </select>
                          </FormField>
                          {isCreating && canViewDeliveryScopes ? (
                            <FormField label="Release" hint="Filters the Story choices without storing duplicate release data on the test case.">
                              <select
                                aria-label="Test case release scope"
                                value={caseDeliveryRelease}
                                onChange={(event) => updateCaseDeliveryScope(event.target.value, caseDeliverySprint)}
                              >
                                <option value="">All releases</option>
                                {deliveryReleaseOptions.map((option) => (
                                  <option key={`${option.source}:${option.sourceId || option.value}`} value={option.value}>
                                    {option.label}
                                  </option>
                                ))}
                              </select>
                            </FormField>
                          ) : null}
                          {isCreating && canViewDeliveryScopes ? (
                            <FormField label="Sprint" hint="Filters Story choices to the selected sprint.">
                              <select
                                aria-label="Test case sprint scope"
                                value={caseDeliverySprint}
                                onChange={(event) => updateCaseDeliveryScope(caseDeliveryRelease, event.target.value)}
                              >
                                <option value="">All sprints</option>
                                {deliverySprintOptions.map((option) => (
                                  <option key={`${option.source}:${option.sourceId || option.value}`} value={option.value}>
                                    {option.label}
                                  </option>
                                ))}
                              </select>
                            </FormField>
                          ) : null}
                          {canViewRequirements ? <FormField
                            label="Story"
                            hint={isCreating && (caseDeliveryRelease || caseDeliverySprint)
                              ? `${creationRequirementOptions.length} matching ${creationRequirementOptions.length === 1 ? "story" : "stories"}`
                              : undefined}
                          >
                            <select
                              value={caseDraft.requirement_id}
                              onChange={(event) => updateCaseRequirement(event.target.value)}
                            >
                              <option value="">No story</option>
                              {(isCreating ? visibleCreationRequirementOptions : requirements).map((requirement: Requirement) => (
                                <option key={requirement.id} value={requirement.id}>
                                  {requirement.display_id ? `${requirement.display_id} · ` : ""}{requirement.title}
                                </option>
                              ))}
                            </select>
                          </FormField> : null}
                          <FormField label="Module">
                            <select
                              value={caseDraft.module_id}
                              onChange={(event) => setCaseDraft((current) => ({ ...current, module_id: event.target.value }))}
                            >
                              <option value="">No module</option>
                              {testCaseModules.map((module) => (
                                <option key={module.id} value={module.id}>{module.name}</option>
                              ))}
                            </select>
                          </FormField>
                          <div className="test-case-labels-field">
                            <CaseLabelsField
                              availableLabels={existingCaseLabels}
                              value={caseDraft.labelsText}
                              onChange={(labelsText) => setCaseDraft((current) => ({ ...current, labelsText }))}
                            />
                          </div>
                            </div>
                          </details>
                        </div>
                        <AuthoringContextMenu sections={[{ id: "test-case-context-properties", label: "Properties & linked work", icon: <TestCaseIcon size={16} />, summary: "Ownership, scope and labels" }, { id: "test-case-advanced-properties", label: "Advanced details", icon: <PencilIcon size={16} />, disabled: !(canUseAutomationWorkspace || hasReadableCasePreview || (!isCreating && selectedTestCase && canReviewSelectedTestCase)) }]} disabled={isTestCaseWorkspaceMutationPending} />
                        <ExternalReferencesField
                          value={caseDraft.externalReferencesText}
                          onChange={(externalReferencesText) => setCaseDraft((current) => ({ ...current, externalReferencesText }))}
                        />

                        {canUseAutomationWorkspace || hasReadableCasePreview || (!isCreating && selectedTestCase && canReviewSelectedTestCase) ? (
                          <details id="test-case-advanced-properties" className="test-case-details-advanced">
                            <summary>
                              <span>
                                <strong>Advanced details</strong>
                                <small>Parameter preview, traceability, and review workflow</small>
                              </span>
                              <span>Manual test design</span>
                            </summary>
                            <div className="test-case-details-advanced-body">
                              {hasReadableCasePreview ? (
                                <div className="step-parameter-preview">
                                  <span className="step-parameter-preview-label">Readable preview on this screen</span>
                                  <strong>{readableCaseTitle || "No title written yet"}</strong>
                                  <span>{readableCaseDescription || "Description, step cards, and section summaries will resolve saved values here without changing the stored authoring text."}</span>
                                </div>
                              ) : null}

                              {!isCreating && selectedTestCase && canUseAutomationWorkspace ? (
                          <div className="detail-summary automation-link-summary">
                            <strong>Automation cases</strong>
                            <span>
                              Executable keywords, recorder evidence, and repository bindings are maintained in dedicated Automation Cases. This manual case remains the traceable source.
                            </span>
                            <StatusBadge value={linkedAutomationCases.length ? "linked" : "not linked"} />
                            <button className="ghost-button compact" onClick={() => setActiveTestCaseDetailTab("automation")} type="button">
                              <OpenIcon size={16} />
                              <span>{linkedAutomationCases.length ? `View automation cases (${linkedAutomationCases.length})` : "Create automation case"}</span>
                            </button>
                          </div>
                              ) : null}

                              {!isCreating && selectedTestCase && canReviewSelectedTestCase ? (
                          <details
                            className="detail-summary test-case-review-summary"
                            key={`${selectedTestCase.id}:${selectedReviewStatus}`}
                            open={isSelectedReviewPending}
                          >
                            <summary className="test-case-review-summary-head">
                              <div>
                                <strong>Review</strong>
                                <span>{TEST_CASE_REVIEW_STATUS_LABELS[selectedReviewStatus]}</span>
                              </div>
                              <StatusBadge value={isSelectedReviewPending ? "pending" : "completed"} />
                            </summary>
                            <div className="test-case-review-summary-body">
                              {isSelectedReviewPending ? (
                                <>
                                  <textarea
                                    placeholder="Reviewer comments"
                                    rows={2}
                                    value={reviewComment}
                                    onChange={(event) => setReviewComment(event.target.value)}
                                  />
                                  <div className="action-row">
                                    <button
                                      className="ghost-button compact test-case-review-reject"
                                      disabled={reviewTestCase.isPending}
                                      onClick={() => openReviewSuggestionDialog(selectedTestCase.id, reviewComment)}
                                      type="button"
                                    >
                                      Suggest changes
                                    </button>
                                    <button
                                      className="primary-button compact test-case-review-approve"
                                      disabled={reviewTestCase.isPending}
                                      onClick={() => void handleSubmitReview("accepted")}
                                      type="button"
                                    >
                                      Accept
                                    </button>
                                  </div>
                                </>
                              ) : (
                                <div className="review-readonly-note">
                                  Review action is complete. Expand this section to inspect the captured decision history.
                                </div>
                              )}
                              {selectedTestCase.review_history?.length ? (
                                <div className="data-table-multiline">
                                  {selectedTestCase.review_history.slice().reverse().slice(0, 4).map((entry) => (
                                    <span className="data-table-multiline-line" key={entry.id}>
                                      {`${TEST_CASE_REVIEW_STATUS_LABELS[entry.status]} · ${resolveAuditUserLabel(entry.user_id, userById)} · ${formatAuditTimestamp(entry.created_at)}${entry.comment ? ` · ${entry.comment}` : ""}`}
                                    </span>
                                  ))}
                                </div>
                              ) : null}
                            </div>
                          </details>
                              ) : null}
                            </div>
                          </details>
                        ) : null}

                        <div className="action-row test-case-inline-save-actions">
		                          <button className="primary-button" disabled={(isCreating ? !canCreateTestCases : !canUpdateTestCases || isSelectedTestCaseDetailPending || !selectedTestCase) || createTestCase.isPending || updateTestCase.isPending || updateStep.isPending || updateSuite.isPending || assignCasesToModule.isPending || removeCasesFromModule.isPending} type="submit">
                            {isCreating
                              ? (createTestCase.isPending || updateSuite.isPending || assignCasesToModule.isPending ? "Creating…" : "Create test case")
                              : (updateTestCase.isPending || updateStep.isPending || updateSuite.isPending || assignCasesToModule.isPending || removeCasesFromModule.isPending ? "Saving…" : "Save test case")}
                          </button>
                          {isCreating ? (
                            <button
                              className="ghost-button"
                              onClick={() => {
                                setCreateSuiteContextId("");
                                setIsCreating(false);
                                setCaseDeliveryRelease("");
                                setCaseDeliverySprint("");
                                setDraftSteps([]);
                                setNewStepDraft(EMPTY_STEP_DRAFT);
                                setStepInsertIndex(null);
                                setStepInsertGroupContext(null);
                                setSelectedStepIds([]);
                              }}
                              type="button"
                            >
                              Cancel new case
                            </button>
                          ) : null}
                          {!isCreating && selectedTestCase ? (
                            <button className="ghost-button danger" onClick={() => void handleDeleteCase()} type="button">
                              Delete test case
                            </button>
                          ) : null}
                        </div>
                      </form>
                    </EditorAccordionSection>
                  </div>

                  </aside>
                    );

                    return (
                    <>
                  <div className="test-case-detail-primary">
                  <QualityMetricStrip
                    ariaLabel="Test case authoring and execution health"
                    className="test-case-health-strip"
                    metrics={[
                      {
                        label: "Authoring",
                        value: `${selectedCaseHealthMetrics.authoring}%`,
                        detail: caseQualitySuggestions.length
                          ? `${caseQualitySuggestions.length} case-specific gap${caseQualitySuggestions.length === 1 ? "" : "s"}: ${caseQualitySuggestions[0]}`
                          : "Title, scope, traceability, behavior and data are sufficiently authored",
                        progress: selectedCaseHealthMetrics.authoring,
                        tone: "info",
                        disabled: isCreating && !(computedCaseAiQualityScore < 70 && caseQualitySuggestions.length),
                        onClick: () => {
                          if (computedCaseAiQualityScore < 70 && caseQualitySuggestions.length) {
                            setIsQualitySuggestionModalOpen(true);
                            return;
                          }
                          if (!isCreating && canUseTestCaseAi) {
                            setActiveTestCaseDetailTab("assurance");
                          }
                        },
                        title: caseQualitySuggestions.length
                          ? `This case is missing: ${caseQualitySuggestions.join(" ")}`
                          : "This score considers this case's title, description, Story link, labels, authored behavior, Test Params and automation readiness."
                      },
                      {
                        label: caseDraft.authoring_mode === "gherkin" ? "Scenario completeness" : "Step completeness",
                        value: authoredBehaviorUnitCount ? `${selectedCaseHealthMetrics.stepCompleteness}%` : "—",
                        detail: authoredBehaviorUnitCount
                          ? `${Math.round((selectedCaseHealthMetrics.stepCompleteness / 100) * authoredBehaviorUnitCount)} of ${authoredBehaviorUnitCount} ${caseDraft.authoring_mode === "gherkin" ? "scenarios include action and outcome" : "steps include action and expected result"}`
                          : caseDraft.authoring_mode === "gherkin" ? "No scenarios" : "No steps",
                        progress: authoredBehaviorUnitCount ? selectedCaseHealthMetrics.stepCompleteness : null,
                        tone: "success",
                        title: caseDraft.authoring_mode === "gherkin"
                          ? "Complete means each Scenario has an action and an observable Then outcome."
                          : "Complete means each step has both an Action and an Expected result."
                      },
                      {
                        label: "Pass rate",
                        value: selectedCaseHealthMetrics.passRate === null ? "—" : `${selectedCaseHealthMetrics.passRate}%`,
                        detail: selectedCaseHealthMetrics.finalizedRuns
                          ? `${selectedCaseHealthMetrics.passedRuns} of ${selectedCaseHealthMetrics.finalizedRuns} passed`
                          : "No runs",
                        tone: selectedCaseHealthMetrics.passRate === null ? "neutral" : "success"
                      },
                      {
                        label: "Linked defects",
                        value: selectedTestCase?.defect_ids?.length || 0,
                        detail: selectedTestCase?.defect_ids?.length
                          ? "Traceable defects"
                          : "No linked defects",
                        tone: selectedTestCase?.defect_ids?.length ? "danger" : "neutral"
                      }
                    ]}
                  />

                  <div aria-label="Step authoring format" className="test-authoring-mode-card">
                    <div className="test-authoring-mode-toggle" role="tablist" aria-label="Step authoring mode">
                      <button
                        aria-controls="test-case-authoring-mode-panel"
                        aria-selected={caseDraft.authoring_mode === "structured"}
                        className={caseDraft.authoring_mode === "structured" ? "is-active" : ""}
                        id="test-case-structured-authoring-tab"
                        onClick={() => selectTestCaseAuthoringMode("structured")}
                        onKeyDown={handleTestCaseAuthoringTabKeyDown}
                        role="tab"
                        tabIndex={caseDraft.authoring_mode === "structured" ? 0 : -1}
                        type="button"
                      >
                        Structured
                      </button>
                      <button
                        aria-controls="test-case-authoring-mode-panel"
                        aria-selected={caseDraft.authoring_mode === "gherkin"}
                        className={caseDraft.authoring_mode === "gherkin" ? "is-active" : ""}
                        id="test-case-gherkin-authoring-tab"
                        onClick={() => selectTestCaseAuthoringMode("gherkin")}
                        onKeyDown={handleTestCaseAuthoringTabKeyDown}
                        role="tab"
                        tabIndex={caseDraft.authoring_mode === "gherkin" ? 0 : -1}
                        type="button"
                      >
                        Gherkin
                      </button>
                    </div>
                    <button
                      className="ghost-button compact"
                      disabled={!appTypeId || (isCreating ? !canCreateTestCases : !canUpdateTestCases) || isInsertingSharedGroups || stepInsertIndex !== null}
                      onClick={() => { setSelectedSharedGroupIds([]); setIsSharedGroupPickerOpen(true); }}
                      type="button"
                    >
                      <StepSharedGroupIcon /> Insert Shared Step Group
                    </button>
                  </div>

                  <div
                    aria-labelledby={`test-case-${caseDraft.authoring_mode}-authoring-tab`}
                    className="test-authoring-mode-panel"
                    id="test-case-authoring-mode-panel"
                    role="tabpanel"
                  >
                  {caseDraft.authoring_mode === "structured" ? (
                    <EditorAccordionSection
                      countLabel={`${preconditionSteps.length}`}
                      isExpanded={expandedSections.preconditions}
                      onToggle={() => setExpandedSections((current) => ({ ...current, preconditions: !current.preconditions }))}
                      summary={preconditionSteps.length ? "Setup assumptions and pre-run steps captured before the main flow." : "Add setup assumptions before the draft steps."}
                      title="Preconditions"
                    >
                      <div className="step-editor step-editor--embedded">
                        <div className="step-list">
                          {!preconditionSteps.length ? renderStepInsertSlot(0, preconditionGroupContext) : null}
                          {preconditionSteps.map((step, index) => (
                            <Fragment key={step.id}>
                              {renderStepInsertSlot(Math.max(0, step.step_order - 1), preconditionGroupContext)}
                              {renderStepCard(step, index, preconditionGroupContext, preconditionSteps, true)}
                              {index === preconditionSteps.length - 1 ? renderStepInsertSlot(step.step_order, preconditionGroupContext) : null}
                            </Fragment>
                          ))}
                        </div>
                        {!preconditionSteps.length ? (
                          <div className="empty-state compact">
                            <div>No preconditions yet. Add the setup required before the first draft step.</div>
                            {stepInsertIndex === null ? <button className="ghost-button" onClick={() => activateStepInsert(0, preconditionGroupContext)} type="button">Add first precondition</button> : null}
                          </div>
                        ) : null}
                        {preconditionSteps.length && stepInsertIndex === null ? (
                          <button className="test-case-add-row" onClick={() => activateStepInsert(preconditionSteps[preconditionSteps.length - 1].step_order, preconditionGroupContext)} type="button">
                            <AddIcon /><span>Add precondition</span>
                          </button>
                        ) : null}
                      </div>
                    </EditorAccordionSection>
                  ) : (
                    <GherkinEditor
                      exampleColumns={linkedDataSet?.mode === "table" ? linkedDataSet.columns : []}
                      exampleRows={linkedDataSet?.mode === "table" ? linkedDataSet.rows : []}
                      featureTitle={caseGherkinFeatureTitle}
                      featureTitleLocked={Boolean(linkedRequirementTitle)}
                      onChange={(gherkin_document) => setCaseDraft((current) => ({ ...current, gherkin_document: linkedRequirementTitle ? setGherkinFeatureTitle(gherkin_document, linkedRequirementTitle) : gherkin_document }))}
                      availableParameters={detectedStepParameters}
                      minimalBehaviorEditor
                      parameterValues={resolvedScopedParameterValues}
                      value={caseDraft.gherkin_document}
                    />
                  )}

                  {caseDraft.authoring_mode === "structured" ? <EditorAccordionSection
                    countLabel={stepCountLabel}
                    isExpanded={expandedSections.steps}
                    onToggle={() => setExpandedSections((current) => ({ ...current, steps: !current.steps }))}
                    summary={stepSectionSummary}
                    title={isCreating ? "Draft steps" : "Test steps"}
                  >
                    {isVisualBuilderActive ? (
                      <VisualTestBuilder testSteps={mainSteps} />
                    ) : (
                    <div className="step-editor step-editor--embedded">
                      <div className="step-editor-toolbar">
                        <label className="checkbox-field step-select-all">
                          <input
                            checked={allStepsSelected}
                            disabled={!mainSteps.length}
                            onChange={(event) =>
                              setSelectedStepIds(event.target.checked ? mainSteps.map((step) => step.id) : [])
                            }
                            type="checkbox"
                          />
                          Select all
                        </label>
                        <StepActionMenu
                          className="step-card-menu--inline step-card-menu--inline-right"
                          label="Test step actions"
                          openOnHover
                          previewActions={editorStepActions}
                          actions={editorStepActions}
                        />
                      </div>

      {copiedSteps.length ? null : null}

      {!isCreating && stepsQuery.isLoading ? <LoadingState label="Loading steps" /> : null}

      <div className="step-list">
                        {!mainSteps.length ? (
                          <>
                            <div className="step-empty-insert">
                              <StepIconButton ariaLabel="Add first step" onClick={() => activateStepInsert(preconditionSteps.length, null)} title="Add first step" type="button">
                                <StepInsertIcon />
                              </StepIconButton>
                            </div>
                            {renderStepInsertSlot(preconditionSteps.length, null)}
                          </>
                        ) : null}

                        {stepBlocks.map((block) => {
                          if (block.group_id) {
                            const firstStep = block.steps[0];
                            const lastStep = block.steps[block.steps.length - 1];
                            const isGroupExpanded = expandedStepGroupIds.includes(block.group_id);
                            const blockIndex = stepBlocks.findIndex((item) => item.key === block.key);
                            const canMoveGroupUp = blockIndex > 0;
                            const canMoveGroupDown = blockIndex < stepBlocks.length - 1;
                            const blockGroupContext: StepInsertionGroupContext = {
                              group_id: block.group_id,
                              group_name: block.group_name,
                              group_kind: block.group_kind || null,
                              reusable_group_id: block.reusable_group_id
                            };

                            return (
                              <Fragment key={block.key}>
                                {renderStepInsertSlot(Math.max(0, firstStep.step_order - 1))}
                                <div
                                  className={[
                                    isGroupExpanded ? "step-group-block is-expanded" : "step-group-block is-collapsed",
                                    block.group_kind === "reusable" ? "is-shared-group" : "is-local-group"
                                  ].join(" ")}
                                >
                                  <StepGroupHeader
                                    isExpanded={isGroupExpanded}
                                    kind={block.group_kind}
                                    name={block.group_name || "Step group"}
                                    canMoveUp={canMoveGroupUp}
                                    canMoveDown={canMoveGroupDown}
                                    showAutomationTools={canPreviewAutomationCode}
                                    onConvertToLocal={() =>
                                      void handleConvertStepGroup(
                                        block.group_id as string,
                                        block.group_name || "Step group",
                                        block.steps,
                                        "local"
                                      )
                                    }
                                    onConvertToShared={() =>
                                      void handleConvertStepGroup(
                                        block.group_id as string,
                                        block.group_name || "Step group",
                                        block.steps,
                                        "reusable"
                                      )
                                    }
                                    onToggle={() =>
                                      setExpandedStepGroupIds((current) =>
                                        current.includes(block.group_id as string)
                                          ? current.filter((id) => id !== block.group_id)
                                          : [...current, block.group_id as string]
                                      )
                                    }
                                    onMoveUp={() => void handleMoveStepGroup(block.group_id as string, "up")}
                                    onMoveDown={() => void handleMoveStepGroup(block.group_id as string, "down")}
                                    onPreviewCode={() => openGroupAutomationPreview(block.group_name || "Step group", block.steps)}
                                    onRemoveGroup={() => void handleRemoveStepGroup(block.group_id as string, block.steps, block.group_kind)}
                                    onUngroup={() => void handleUngroupStepGroup(block.group_id as string, block.group_kind)}
                                    onToggleSelect={(checked) => {
                                      const groupStepIds = block.steps.map((step) => step.id);
                                      if (checked) {
                                        setSelectedStepIds((current) => Array.from(new Set([...current, ...groupStepIds])));
                                      } else {
                                        setSelectedStepIds((current) => current.filter((id) => !groupStepIds.includes(id)));
                                      }
                                    }}
                                    selectionState={(() => {
                                      const groupStepIds = block.steps.map((step) => step.id);
                                      const selectedCount = groupStepIds.filter((id) => selectedStepIds.includes(id)).length;
                                      if (!selectedCount) {
                                        return "none";
                                      }
                                      if (selectedCount === groupStepIds.length) {
                                        return "all";
                                      }
                                      return "some";
                                    })()}
                                    stepCount={block.steps.length}
                                  />
                                  {isGroupExpanded ? (
                                    <div className="step-group-block-body">
                                      {block.steps.map((step) => {
                                        const stepIndex = mainSteps.findIndex((item) => item.id === step.id);

                                        return (
                                          <Fragment key={step.id}>
                                            {renderStepInsertSlot(Math.max(0, step.step_order - 1), blockGroupContext)}
                                            {renderStepCard(step, stepIndex, blockGroupContext, mainSteps)}
                                          </Fragment>
                                        );
                                      })}
                                      {renderStepInsertSlot(lastStep.step_order, blockGroupContext)}
                                    </div>
                                  ) : null}
                                </div>
                                {lastStep.id === mainSteps[mainSteps.length - 1]?.id ? renderStepInsertSlot(lastStep.step_order) : null}
                              </Fragment>
                            );
                          }

                          const step = block.steps[0];
                          const stepIndex = mainSteps.findIndex((item) => item.id === step.id);

                          return (
                            <Fragment key={block.key}>
                              {renderStepInsertSlot(Math.max(0, step.step_order - 1))}
                              {renderStepCard(step, stepIndex, null, mainSteps)}
                              {step.id === mainSteps[mainSteps.length - 1]?.id ? renderStepInsertSlot(step.step_order) : null}
                            </Fragment>
                          );
                        })}
                      </div>

                      {mainSteps.length && stepInsertIndex === null ? (
                        <button
                          className="test-case-add-row"
                          onClick={() => activateStepInsert(mainSteps[mainSteps.length - 1].step_order, null)}
                          type="button"
                        >
                          <AddIcon />
                          <span>Add step</span>
                        </button>
                      ) : null}

                      {!mainSteps.length ? (
                        <div className="empty-state compact">
                          <div>
                            {isCreating
                              ? "No draft steps yet. Use the inline + action to add the first step or insert a Shared Step Group."
                              : "No steps yet for this test case. Use the inline + action to add one or insert a Shared Step Group."}
                          </div>
                          {stepInsertIndex === null ? (
                            <button className="ghost-button" onClick={() => activateStepInsert(preconditionSteps.length, null)} type="button">Add first step</button>
                          ) : null}
                        </div>
                      ) : null}

                      {!isCreating ? (
                        <div className="action-row step-editor-save-row">
	                          <button className="primary-button" disabled={isSelectedTestCaseDetailPending || !selectedTestCase || updateTestCase.isPending || updateStep.isPending || updateSuite.isPending || assignCasesToModule.isPending || removeCasesFromModule.isPending} onClick={() => void handleSaveCaseAndSteps()} type="button">
                            {updateTestCase.isPending || updateStep.isPending || updateSuite.isPending || assignCasesToModule.isPending || removeCasesFromModule.isPending ? "Saving…" : "Save test case"}
                          </button>
                        </div>
                      ) : null}
                    </div>
                    )}
                  </EditorAccordionSection> : null}
                  </div>

                  <EditorAccordionSection
                    countLabel={linkedDataSet ? `${linkedDataSetIterationCount} ${linkedDataSetIterationCount === 1 ? "iteration" : "iterations"}` : "None"}
                    isExpanded={expandedSections.dataSets}
                    onToggle={() => setExpandedSections((current) => ({ ...current, dataSets: !current.dataSets }))}
                    summary={caseDraft.authoring_mode === "gherkin" ? "Create, link, change, or unlink reusable Test Data. Linked table rows are rendered under Gherkin Examples." : "Create or link one reusable data set. A table can carry one or many row-level execution iterations."}
                    title={caseDraft.authoring_mode === "gherkin" ? "Examples · Linked Test Data" : "Data Sets"}
                  >
                    <AuthoringDataSetPanel
                      dataSet={linkedDataSet}
                      linkedDataSetId={linkedDataSetId}
                      isLoading={testDataSetsQuery.isLoading}
                      error={testDataSetsQuery.isError ? "Data sets could not be loaded." : undefined}
                      onRetry={() => { void testDataSetsQuery.refetch(); }}
                      gherkin={caseDraft.authoring_mode === "gherkin"}
                      canView={canViewTestData}
                      canLink={canLinkTestDataToCurrentCase}
                      canCreate={canCreateAndLinkTestData}
                      overrideSharedSteps={overrideSharedGroupData}
                      onOverrideSharedStepsChange={setOverrideSharedGroupData}
                      hasParameters={detectedStepParameters.length > 0}
                      onDownloadTemplate={() => downloadParameterCsvTemplate(detectedStepParameters, "test-case-parameter-template.csv")}
                      onManageParameters={() => setIsCaseParameterDialogOpen(true)}
                      onCreate={() => {
                        setNewDataSetDraft(emptyDataSetDraft);
                        setIsDataSetCreatorOpen(true);
                      }}
                      onLink={() => {
                        setDataSetLinkDraftId(linkedDataSet?.id || "");
                        setDataSetSearch("");
                        setIsDataSetLinkerOpen(true);
                      }}
                      onUnlink={() => setLinkedDataSetDraftIds([])}
                    />
                  </EditorAccordionSection>

                  {/* Retained temporarily for backward-compatible state handling; authoring has moved to Automation. */}
                  {!isCreating && canUseAutomationWorkspace && isLegacyInlineAutomationBuilderEnabled() ? (
                    <EditorAccordionSection
                      countLabel={automationTargetCaseIds.length ? `${automationTargetCaseIds.length} target${automationTargetCaseIds.length === 1 ? "" : "s"}` : "Ready"}
                      isExpanded={expandedSections.automation}
                      onToggle={() => setExpandedSections((current) => ({ ...current, automation: !current.automation }))}
                      summary={automationSectionSummary}
                      title="Automation builder"
                    >
                      <div className="automation-builder-panel">
                        <details className="automation-run-context-section">
                          <summary>
                            <ExecutionStepsIcon />
                            <span>Run context</span>
                          </summary>
                          <ExecutionContextSelector
                            appTypeId={appTypeId}
                            onConfigurationChange={setSelectedExecutionConfigurationId}
                            onDataSetChange={setSelectedExecutionDataSetId}
                            onEnvironmentChange={setSelectedExecutionEnvironmentId}
                            prefillFirstAvailable
                            projectId={projectId}
                            selectedConfigurationId={selectedExecutionConfigurationId}
                            selectedDataSetId={selectedExecutionDataSetId}
                            selectedEnvironmentId={selectedExecutionEnvironmentId}
                          />
                        </details>

                        <div className="record-grid automation-builder-form">
                          <FormField label="Start URL">
                            <input
                              onChange={(event) => setAutomationStartUrl(event.target.value)}
                              placeholder="Uses selected environment base URL when blank"
                              value={automationStartUrl}
                            />
                          </FormField>
                          <FormField label="Failure threshold">
                            <input
                              min={1}
                              max={50}
                              onChange={(event) => setAutomationFailureThreshold(Math.max(1, Number(event.target.value) || 1))}
                              type="number"
                              value={automationFailureThreshold}
                            />
                          </FormField>
                        </div>

                        <FormField label="Builder guidance">
                          <textarea
                            onChange={(event) => setAutomationContext(event.target.value)}
                            placeholder="Auth assumptions, preferred data tokens, flows to ignore, or edge cases to preserve."
                            rows={4}
                            value={automationContext}
                          />
                        </FormField>

                        <div className="testops-action-row">
                          {canUseAutomationAi ? (<button
                            className="primary-button"
                            disabled={!canBuildAutomation || !canUseAutomationAi || !automationTargetCaseIds.length || buildSingleAutomation.isPending || buildBatchAutomation.isPending}
                            onClick={() => void handleBuildSelectedAutomation()}
                            type="button"
                          >
                            <TestCaseSparkIcon />
                            <span>
                              {buildSingleAutomation.isPending || buildBatchAutomation.isPending
                                ? "Automating..."
                                : automationTargetCaseIds.length > 1
                                  ? "Queue AI automation"
                                  : "Automate case with AI"}
                            </span>
                          </button>) : null}
                        </div>

                        <div className="stack-list automation-recorder-stack">
                          <div className="stack-item recorder-command-card">
                            <div>
                              <strong>Recorder</strong>
                              <span>{recorderSession ? `Session ${recorderSession.id.slice(0, 8)} is ${recorderSession.status}.` : "Capture clicks, fills, tab navigation, and business API traffic for this case."}</span>
                            </div>
                            <div className="recorder-workspace-pane">
	                              <RecorderStartControls
	                                disabled={!canUseRecorder || !selectedTestCase || !testEngineIntegration}
                                hasSession={Boolean(recorderSession)}
                                isStarting={startRecorder.isPending}
                                mobileAppiumEnabled={canUseMobileAppium}
                                mobileRemoteEnabled={mobileRemoteRecorderEnabled}
                                onStart={(options) => void handleStartRecorder(options)}
                                primaryAction={(
                                  <button
                                    className="primary-button recorder-stop-button"
                                    disabled={!recorderSession || finishRecorder.isPending}
                                    onClick={() => void handleFinishRecorder()}
                                    type="button"
                                  >
                                    <PauseIcon />
                                    <span>{finishRecorder.isPending ? "Stopping..." : "Stop and capture steps"}</span>
                                  </button>
                                )}
                                moreActions={recorderLiveUrl ? (
                                  <a className="ghost-button compact" href={recorderLiveUrl} rel="noreferrer" target="_blank">
                                    <OpenIcon size={16} />
                                    <span>Open live view</span>
                                  </a>
                                ) : null}
                              />
                            </div>
                          </div>
                          {recorderSession ? (
                            <div className="stack-item">
                              <div>
                                <strong>{formatRecorderDisplayMode(recorderSession.display_mode)}</strong>
                                <span>{recorderSession.action_count || 0} actions · {recorderSession.network_count || 0} API candidates</span>
                              </div>
                              <StatusBadge value={recorderSession.status} />
                            </div>
                          ) : null}
                          {!recorderSession && selectedTestCase && recentRecorderCompletedCaseId === selectedTestCase.id && supportsLocalDesktopExecution ? (
                            <div className="stack-item">
                              <div>
                                <strong>Recorded automation ready</strong>
                                <span>Start a local Playwright run from this machine and review it under Local Runs.</span>
                              </div>
                              <button
                                className="primary-button"
                                disabled={isSelectedCaseLocalRunning || createLocalRun.isPending || !canSelectedCaseRunLocally || !projectId || !appTypeId || !session?.user.id}
                                onClick={() => openRunBuilder([selectedTestCase.id], "local")}
                                type="button"
                              >
                                <TestCaseRunIcon />
                                <span>{isSelectedCaseLocalRunning ? "Starting..." : selectedCaseLocalRunLabel}</span>
                              </button>
                            </div>
                          ) : null}
                          {recorderLiveUrl ? (
                            <iframe
                              allow="clipboard-read; clipboard-write"
                              className="recorder-live-frame"
                              src={recorderLiveUrl}
                              title="HelloTest recorder live view"
                            />
                          ) : null}
                          <RecorderSessionInsights session={recorderSession} />
                        </div>

                        <AutomationLearningMemory entries={automationLearningCache} />
                      </div>
                    </EditorAccordionSection>
                  ) : null}

                </div>
                    {caseDetailsSidebar}
                    </>
                    );
                  })()}
                </div>
                <footer className="test-case-detail-footer" aria-label="Test case actions">
                  <div className="test-case-detail-footer-danger">
                    {!isCreating && selectedTestCase ? (
                      (canDeleteTestCases ? (<button
                        className="test-case-detail-delete-button"
                        disabled={!canDeleteTestCases || isTestCaseWorkspaceMutationPending}
                        onClick={() => void handleDeleteCase()}
                        type="button"
                      >
                        <TrashIcon />
                        <span>{deleteTestCase.isPending ? "Deleting…" : "Delete test case"}</span>
                      </button>) : null)
                    ) : null}
                  </div>
                  <div className="test-case-detail-footer-primary">
                    {testCaseSaveBlockedReason ? (
                      <span className="test-case-detail-save-hint" id="test-case-save-blocked-reason" role="status">
                        {testCaseSaveBlockedReason}
                      </span>
                    ) : null}
                    <button
                      className="ghost-button test-case-detail-cancel-button"
                      disabled={isTestCaseWorkspaceMutationPending}
                      onClick={isCreating ? closeCaseWorkspace : handleWorkspaceBack}
                      type="button"
                    >
                      Cancel
                    </button>
                    <button
                      aria-describedby={testCaseSaveBlockedReason ? "test-case-save-blocked-reason" : undefined}
                      className="primary-button test-case-detail-save-button"
                      disabled={isTestCaseSaveDisabled}
                      onClick={() => void handleSaveCaseAndSteps()}
                      title={testCaseSaveBlockedReason || undefined}
                      type="button"
                    >
                      {isCreating
                        ? (createTestCase.isPending || updateSuite.isPending || assignCasesToModule.isPending ? "Creating…" : "Create test case")
                        : (updateTestCase.isPending || updateStep.isPending || updateSuite.isPending || assignCasesToModule.isPending || removeCasesFromModule.isPending ? "Saving…" : "Save test case")}
                    </button>
                  </div>
                </footer>
                </div>
                ) : null}
                {!isCreating && activeTestCaseDetailTab === "automation" && selectedTestCase ? (
                  <div className="detail-section-panel requirement-detail-wide-panel test-case-automation-cases-panel" role="tabpanel">
                    <div className="test-case-automation-cases-header">
                      <div className="detail-summary">
                        <strong>Automation cases</strong>
                        <span>Dedicated automation records preserve traceability to this manual case and open in the complete Automation workspace.</span>
                      </div>
                      <button className="primary-button" onClick={() => navigate(`/automation?create=1&manual=${encodeURIComponent(selectedTestCase.id)}`)} type="button">
                        <AutomationCodeIcon />
                        <span>Create automation case</span>
                      </button>
                    </div>
                    {automationCaseLinksQuery.isLoading ? <TileCardSkeletonGrid count={3} /> : null}
                    {!automationCaseLinksQuery.isLoading && linkedAutomationCases.length ? (
                      <div className="tile-browser-grid test-case-linked-automation-grid">
                        {linkedAutomationCases.map((automationCase) => {
                          const recentHistory = (historyByCaseId[automationCase.id] || []).slice(0, 10);
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
                    {!automationCaseLinksQuery.isLoading && !linkedAutomationCases.length ? (
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
                      providerControl={<AiReviewControls key={`case-assurance-${projectId}-${selectedTestCase.id}`} usageKey="ai.quality.test_case_assurance" promptMaxLength={Math.max(0, 12_000 - getMetricCriteria("metric.assurance.test_case").length - 2)} projectId={projectId} appTypeId={appTypeId} integrations={integrations} integrationId={testCaseAssuranceIntegrationId} onIntegrationIdChange={setTestCaseAssuranceIntegrationId} promptGuidance={testCaseAssurancePromptGuidance} onPromptGuidanceChange={setTestCaseAssurancePromptGuidance} additionalContext={testCaseAssuranceContext} onAdditionalContextChange={setTestCaseAssuranceContext} artifactIds={[selectedTestCase.id]} artifactContext={JSON.stringify(selectedTestCaseAssuranceProposedChange)} disabled={previewTestCaseImpact.isPending} onBusyChange={setTestCaseAssuranceContextBusy} />}
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

      {isCaseParameterDialogOpen ? (
        <StepParameterDialog
          defaultValues={linkedDataSetDefaultParameterValues}
          getInputState={(parameter) => parameter.sensitive
            ? { disabled: true, hint: "Hidden by the linked Data Set. The value is never inserted into visible step text." }
            : resolveScopedParameterInputState(parameter.scope)}
          onChange={handleScopedParameterValueChange}
          onClose={() => setIsCaseParameterDialogOpen(false)}
          onRefreshPreviews={refreshParameterPreviews}
          onReset={resetTestCaseParameterOverride}
          overrideValues={visibleTestCaseParameterValues}
          parameters={detectedStepParameters}
          previewValues={resolvedScopedParameterValues}
          subtitle="Review inherited Data Set columns and edit only this Test Case's parameter overrides."
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

      {isAiCaseAuthoringOpen && canUseTestCaseAi ? (
        <AiCaseAuthoringModal
          additionalContext={aiCaseAuthoringAdditionalContext}
          externalLinksText={aiCaseAuthoringExternalLinksText}
          applyLabel={isCreating ? "Apply Improvement To Draft" : "Apply Reviewed Improvement"}
          closeDisabled={previewCaseAuthoring.isPending || updateTestCase.isPending}
	          disableApply={!canUseTestCaseAi || (!isCreating && !canUpdateTestCases) || (aiCaseAuthoringNeedsAutomationEdit && !canEditAutomationCode) || !aiCaseAuthoringPreview || updateTestCase.isPending}
	          disableGenerate={!canUseTestCaseAi || !appTypeId || !aiCaseAuthoringRequirementId || previewCaseAuthoring.isPending || !integrations.length}
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
          acceptLabel="Accept Into Test Case Library"
          additionalContext={aiAdditionalContext}
          allowMultipleRequirements={true}
          appTypeName={appTypes.find((item) => item.id === appTypeId)?.name || "No app type selected"}
          closeDisabled={previewDesignedCases.isPending || acceptDesignedCases.isPending || createGenerationJob.isPending}
	          disableAccept={!canCreateTestCases || !aiPreviewCases.length || acceptDesignedCases.isPending}
	          disablePreview={!canUseTestCaseAi || !aiRequirementIds.length || !appTypeId || previewDesignedCases.isPending || !integrations.length}
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
          requirementHelpText="Select one or more stories, provide extra context, then review the generated drafts before approving them into the reusable library."
          requirementLabel="Stories"
          requirements={requirements}
          scheduleHelperText="Schedule batch AI generation for selected stories. The worker processes one story at a time with a cooldown between stories to reduce LLM rate-limit pressure, then returns generated cases as drafts with green accept and red reject actions."
          selectedRequirementIds={aiSelectedRequirements.map((requirement) => requirement.id)}
        />
      ) : null}

      <TestCaseChangeImpactDialog
        error={previewTestCaseImpact.error instanceof Error && testCaseAssuranceRequestMatchesDraft ? previewTestCaseImpact.error.message : null}
        loading={previewTestCaseImpact.isPending && testCaseAssuranceRequestMatchesDraft}
        onClose={() => setIsTestCaseImpactPreviewOpen(false)}
        onRetry={() => runTestCaseAssuranceAnalysis(true)}
        open={canUseTestCaseAi && isTestCaseImpactPreviewOpen && testCaseAssuranceRequestMatchesDraft}
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

function AutomationScriptLens({
  lens,
  steps,
  code,
  onEditStep
}: {
  lens: Exclude<TestCaseAuthoringLens, "manual">;
  steps: AuthoringStepProjection[];
  code: string;
  onEditStep: (stepId: string) => void;
}) {
  const { session } = useAuth();
  const featureFlagsQuery = useFeatureFlags(Boolean(session));
  const canViewAutomationCode = resolveCanViewAutomationCode(session, featureFlagsQuery.data);
  const canEditAutomationCode = resolveCanEditAutomationCode(session, featureFlagsQuery.data);
  const title = lens === "api-script" ? "API script" : "UI automation script";
  const emptyCopy = lens === "api-script"
    ? "No API steps are present yet. Change a step type to API or import a Postman collection to author request-level coverage."
    : "No UI or mobile steps are present yet. Add web, Android, or iOS steps to create executable UI coverage.";

  if (!canViewAutomationCode) return null;

  return (
    <div className="automation-script-lens">
      <div className="automation-script-map" aria-label={`${title} step map`}>
        {steps.length ? (
          steps.map((step) => {
            const stepType = normalizeStepType(step.step_type);
            const hasSavedAutomation = stepHasAutomation(step);
            const request = normalizeApiRequest(step.api_request);
            const subtitle = stepType === "api" && request
              ? `${request.method || "GET"} ${request.url || "No URL"}`
              : richTextToPlainText(step.expected_result || "") || "No expected result written yet";

            return (
              <article className="automation-script-step" key={step.id}>
                <div className="automation-script-step-copy">
                  <div className="automation-script-step-head">
                    <span className={hasSavedAutomation ? "automation-script-step-status is-ready" : "automation-script-step-status"}>
                      {hasSavedAutomation ? "Ready" : "Generated"}
                    </span>
                    <strong>Step {step.step_order}</strong>
                    <span>{stepType.toUpperCase()}</span>
                  </div>
                  <RichTextContent as="p" fallback="No manual action written yet" value={step.action} />
                  <small>{subtitle}</small>
                </div>
                {canEditAutomationCode ? (
                  <button className="ghost-button compact" onClick={() => onEditStep(step.id)} type="button">
                    <AutomationCodeIcon />
                    <span>Edit</span>
                  </button>
                ) : null}
              </article>
            );
          })
        ) : (
          <div className="empty-state compact">{emptyCopy}</div>
        )}
      </div>

      <div className="automation-script-code-panel">
        <div className="automation-script-code-head">
          <strong>{title}</strong>
          <span>{steps.length} mapped step{steps.length === 1 ? "" : "s"}</span>
        </div>
        <pre className="automation-script-code"><code>{code}</code></pre>
      </div>
    </div>
  );
}

function AutomationLearningMemory({ entries }: { entries: AutomationLearningCacheEntry[] }) {
  const readMetaText = (entry: AutomationLearningCacheEntry, key: string) => {
    const value = entry.metadata?.[key];
    return typeof value === "string" ? value.trim() : "";
  };
  const isNonElementEntry = (entry: AutomationLearningCacheEntry) => {
    const locator = String(entry.locator || "").trim().toLowerCase();
    const intent = String(entry.locator_intent || "").trim().toLowerCase();
    const role = readMetaText(entry, "object_role").toLowerCase();
    const blockedLocators = new Set(["viewport", "location", "browser.tab", "keyboard", "window", "document", "page"]);
    const blockedIntents = new Set(["scroll", "navigation", "navigate", "goto", "tab", "press"]);

    return blockedLocators.has(locator) || blockedIntents.has(intent) || role === "viewport" || role === "page";
  };
  const toTitleText = (value: string) => {
    const normalized = value
      .replace(/^[#.]+/, "")
      .replace(/\[[^\]]+\]/g, " ")
      .replace(/[_./:-]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    if (!normalized) {
      return "";
    }

    return normalized
      .split(" ")
      .filter(Boolean)
      .slice(0, 6)
      .map((token) => token.charAt(0).toUpperCase() + token.slice(1))
      .join(" ");
  };
  const toPascalCase = (value: string) => {
    const normalized = value.replace(/https?:\/\//i, "").replace(/[^A-Za-z0-9]+/g, " ").trim();
    const tokens = normalized ? normalized.split(/\s+/) : ["Page"];
    const name = tokens.map((token) => token.charAt(0).toUpperCase() + token.slice(1)).join("");
    return name.toLowerCase().endsWith("page") ? name : `${name}Page`;
  };
  const getObjectLabel = (entry: AutomationLearningCacheEntry) => {
    const metadataLabel =
      readMetaText(entry, "object_label") ||
      readMetaText(entry, "field_name") ||
      readMetaText(entry, "name");
    const objectName = readMetaText(entry, "object_name");
    const objectNameTail = objectName.includes(".") ? objectName.split(".").filter(Boolean).pop() || "" : objectName;
    const intent = String(entry.locator_intent || "").trim();
    const genericIntent = ["click", "fill", "change", "select", "check", "uncheck", "submit", "object"].includes(intent.toLowerCase()) ? "" : intent;
    const locatorAttr =
      String(entry.locator || "").match(/\[(?:aria-label|name|id|data-testid|placeholder)=["']?([^"'\]]+)["']?\]/i)?.[1] ||
      String(entry.locator || "").match(/^#([\w-]+)/)?.[1] ||
      String(entry.locator || "").match(/text=["']?([^"']+)["']?/i)?.[1] ||
      "";

    return toTitleText(metadataLabel || objectNameTail || genericIntent || locatorAttr || "HTML element");
  };
  const getHtmlTag = (entry: AutomationLearningCacheEntry) => {
    const metadataTag =
      readMetaText(entry, "html_tag") ||
      readMetaText(entry, "tag_name") ||
      readMetaText(entry, "tag") ||
      readMetaText(entry, "element_tag");
    const domStructure = readMetaText(entry, "dom_structure") || readMetaText(entry, "dom_path") || readMetaText(entry, "html");
    const domTag = domStructure.match(/<\s*([a-z][a-z0-9-]*)/i)?.[1] || "";
    const locatorTag = String(entry.locator || "").match(/^([a-z][a-z0-9-]*)[#.[\s]/i)?.[1] || "";
    const role = (readMetaText(entry, "object_role") || entry.locator_kind || entry.locator_intent || "").toLowerCase();

    if (metadataTag) {
      return metadataTag.toLowerCase();
    }

    if (domTag) {
      return domTag.toLowerCase();
    }

    if (locatorTag) {
      return locatorTag.toLowerCase();
    }

    if (role.includes("textbox") || role.includes("field") || role.includes("fill") || role.includes("input")) {
      return "input";
    }

    if (role.includes("dropdown") || role.includes("select") || role.includes("combobox")) {
      return "select";
    }

    if (role.includes("link")) {
      return "a";
    }

    if (role.includes("button") || role.includes("click") || role.includes("submit")) {
      return "button";
    }

    return "element";
  };
  const getTagDetail = (entry: AutomationLearningCacheEntry) => {
    const tag = getHtmlTag(entry);
    const locator = String(entry.locator || "").trim();
    const locatorId = locator.match(/^#([\w-]+)/)?.[1] || locator.match(/\bid=["']?([^"'\]\s>]+)/i)?.[1] || "";
    const locatorName = locator.match(/\bname=["']?([^"'\]\s>]+)/i)?.[1] || "";
    const role = readMetaText(entry, "object_role");
    const qualifier = locatorId ? `#${locatorId}` : locatorName ? `[name="${locatorName}"]` : role ? `[role="${role}"]` : "";

    return `${tag}${qualifier}`;
  };
  const elementEntries = entries
    .filter((entry) => !isNonElementEntry(entry))
    .sort((left, right) => Number(right.confidence || 0) - Number(left.confidence || 0) || Number(right.hit_count || 0) - Number(left.hit_count || 0));
  const pageObjects = Array.from(elementEntries.reduce<Map<string, AutomationLearningCacheEntry[]>>((map, entry) => {
    const screen = readMetaText(entry, "screen_name") || entry.page_key || "UnassignedPage";
    map.set(screen, [...(map.get(screen) || []), entry]);
    return map;
  }, new Map()).entries()).slice(0, 4);
  const strongEntries = elementEntries.filter((entry) => Number(entry.confidence) >= 0.8).length;

  return (
    <details className="automation-learning-memory">
      <summary className="automation-learning-memory-head">
        <div>
          <strong>Object repository</strong>
          <span>
            {elementEntries.length
              ? `${elementEntries.length} HTML element${elementEntries.length === 1 ? "" : "s"} · ${strongEntries} high confidence`
              : "No reusable screen objects learned for this scope yet"}
          </span>
        </div>
        <AutomationCodeIcon />
      </summary>

      {pageObjects.length ? (
        <div className="automation-learning-pom-list">
          {pageObjects.map(([screen, pageEntries]) => (
            <article className="automation-learning-pom-card" key={screen}>
              <div className="automation-learning-card-head">
                <strong>class {toPascalCase(screen)}</strong>
                <span>{pageEntries.length} member{pageEntries.length === 1 ? "" : "s"}</span>
              </div>
              <span className="automation-learning-page">{pageEntries[0]?.page_url || screen}</span>
              <div className="automation-learning-pom-members">
                {pageEntries.slice(0, 5).map((entry) => (
                  <div className="automation-learning-pom-member" key={entry.id}>
                    <code>{getObjectLabel(entry).replace(/\s+/g, "")}</code>
                    <span>{getTagDetail(entry)}</span>
                    <small>{entry.locator}</small>
                  </div>
                ))}
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="empty-state compact">No HTML elements are available yet. Run a click, fill, select, or check recording so HelloTest can learn friendly element names and tags.</div>
      )}
    </details>
  );
}




function TestCaseExecutionModal({
  isPreparingOptions,
  testCases,
  selectedProject,
  selectedAppType,
  projectId,
  appTypeId,
  executionName,
  selectedAssigneeIds,
  assigneeOptions,
  selectedEnvironmentId,
  selectedConfigurationId,
  selectedDataSetId, dataOptions, onDataOptionsChange,
  executionStartMode,
  executionStartDate,
  executionEndDate,
  onExecutionStartDateChange,
  onExecutionEndDateChange,
  executionParallelEnabled,
  executionParallelCount,
  executionRelease,
  releaseOptions,
  executionSprint,
  sprintOptions,
  executionBuild,
  canConfigureParallelAutomation,
  canRunLocalAutomation,
  canRunRemoteAutomation,
  canCreateExecution,
  isSubmitting,
  onAssigneeChange,
  onEnvironmentChange,
  onConfigurationChange,
  onDataSetChange,
  onExecutionNameChange,
  onExecutionStartModeChange,
  onExecutionParallelEnabledChange,
  onExecutionParallelCountChange,
  onExecutionReleaseChange,
  onExecutionSprintChange,
  onExecutionBuildChange,
  onRemoveTestCase,
  onClose,
  onSubmit
}: {
  isPreparingOptions: boolean;
  testCases: TestCase[];
  selectedProject: string;
  selectedAppType: string;
  projectId: string;
  appTypeId: string;
  executionName: string;
  selectedAssigneeIds: string[];
  assigneeOptions: TestCaseExecutionAssigneeOption[];
  selectedEnvironmentId: string;
  selectedConfigurationId: string;
  selectedDataSetId: string;
  dataOptions: TestDataOptions; onDataOptionsChange: (value: TestDataOptions) => void;
  executionStartMode: ExecutionStartMode;
  executionStartDate: string;
  executionEndDate: string;
  onExecutionStartDateChange: (value: string) => void;
  onExecutionEndDateChange: (value: string) => void;
  executionParallelEnabled: boolean;
  executionParallelCount: number;
  executionRelease: string;
  releaseOptions: DeliveryScopeOption[];
  executionSprint: string;
  sprintOptions: DeliveryScopeOption[];
  executionBuild: string;
  canConfigureParallelAutomation: boolean;
  canRunLocalAutomation: boolean;
  canRunRemoteAutomation: boolean;
  canCreateExecution: boolean;
  isSubmitting: boolean;
  onAssigneeChange: (value: string[]) => void;
  onEnvironmentChange: (value: string) => void;
  onConfigurationChange: (value: string) => void;
  onDataSetChange: (value: string) => void;
  onExecutionNameChange: (value: string) => void;
  onExecutionStartModeChange: (value: ExecutionStartMode) => void;
  onExecutionParallelEnabledChange: (value: boolean) => void;
  onExecutionParallelCountChange: (value: number) => void;
  onExecutionReleaseChange: (value: string) => void;
  onExecutionSprintChange: (value: string) => void;
  onExecutionBuildChange: (value: string) => void;
  onRemoveTestCase: (testCaseId: string) => void;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const [dataSetValid, setDataSetValid] = useState(!selectedDataSetId);
  const [selectedCaseSearch, setSelectedCaseSearch] = useState("");
  const deferredSelectedCaseSearch = useDeferredValue(selectedCaseSearch);
  const visibleSelectedCases = testCases.filter(item => `${item.title} ${item.display_id || item.id}`.toLowerCase().includes(deferredSelectedCaseSearch.trim().toLowerCase()));
  const { can } = useCapabilityAccess(projectId);
  const dialogRef = useDialogFocus<HTMLDivElement>({ closeDisabled: isSubmitting, onClose });
  return (
    <div className="modal-backdrop" onClick={() => !isSubmitting && onClose()} role="presentation">
      <div
        aria-labelledby="create-test-case-execution-title"
        aria-modal="true"
        className="modal-card execution-create-modal scoped-run-create-modal"
        onClick={(event) => event.stopPropagation()}
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
      >
        <form className="execution-create-form" onSubmit={(event) => {
          if (!dataSetValid) { event.preventDefault(); return; }
          onSubmit(event);
        }}>
          <div className="execution-create-header">
            <div className="execution-create-title">
              <h2 className="dialog-title" id="create-test-case-execution-title">Create run</h2>
              <p>Run the selected test cases.</p>
            </div>
            <DialogCloseButton disabled={isSubmitting} label="Close create run dialog" onClick={onClose} />
          </div>

          <div className="execution-create-body scoped-run-create-body">
            <fieldset disabled={isSubmitting} className="scoped-run-authoring-fields">
            <aside className="scoped-run-config-pane" aria-label="Run configuration">
              <div className="scoped-run-pane-heading"><strong>Run Configuration</strong><span>Settings and reusable test data</span></div>
            {isPreparingOptions ? <p className="inline-message" role="status">Preparing Release and Sprint options… You can continue configuring this run.</p> : null}

            <div className="execution-create-grid">
              <FormField label="Run name">
                <input
                  autoFocus
                  placeholder="Optional run name"
                  value={executionName}
                  onChange={(event) => onExecutionNameChange(event.target.value)}
                />
              </FormField>
              <FormField label="Assign to" hint="Select one or more testers for this run.">
                <MultiAssigneePicker
                  disabled={!projectId || !assigneeOptions.length || isSubmitting}
                  options={assigneeOptions}
                  selectedIds={selectedAssigneeIds}
                  onChange={onAssigneeChange}
                />
              </FormField>
            </div>

            <RunDataSetup onValidityChange={setDataSetValid} dataOptions={dataOptions} onDataOptionsChange={onDataOptionsChange} projectId={projectId} appTypeId={appTypeId}
              cases={testCases} dataSetId={selectedDataSetId} onDataSetChange={onDataSetChange} environmentId={selectedEnvironmentId} configurationId={selectedConfigurationId} disabled={isSubmitting} />

            <details className="authoring-disclosure" open={Boolean(executionRelease || executionSprint || executionBuild)}>
              <summary><span>Delivery context</span><small>Release, Sprint and build</small></summary>
              <div className="authoring-disclosure-body execution-create-grid execution-create-grid--metadata">
              {can("requirement_iteration.view") ? <FormField label="Release">
                <select value={executionRelease} onChange={(event) => onExecutionReleaseChange(event.target.value)}>
                  <option value="">No release</option>
                  {releaseOptions.map((option) => (
                    <option key={`${option.source}:${option.sourceId || option.value}`} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </FormField> : null}
              {can("requirement_iteration.view") ? <FormField label="Sprint">
                <select value={executionSprint} onChange={(event) => onExecutionSprintChange(event.target.value)}>
                  <option value="">No sprint</option>
                  {sprintOptions.map((option) => (
                    <option key={`${option.source}:${option.sourceId || option.value}`} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </FormField> : null}
              <FormField label="Build">
                <input placeholder="Build 2026.07.02" value={executionBuild} onChange={(event) => onExecutionBuildChange(event.target.value)} />
              </FormField>
            </div>

            </details>
            <div className="detail-summary">
              <strong>{selectedProject || "Select a project to continue"}</strong>
              <span>{selectedAppType || "Choose an app type"}</span>
            </div>

            <ExecutionContextSelector hideDataSet
              appTypeId={appTypeId}
              onConfigurationChange={onConfigurationChange}
              onDataSetChange={onDataSetChange}
              onEnvironmentChange={onEnvironmentChange}
              prefillFirstAvailable={true}
              projectId={projectId}
              selectedConfigurationId={selectedConfigurationId}
              selectedDataSetId={selectedDataSetId}
              selectedEnvironmentId={selectedEnvironmentId}
            />



            <div className="execution-create-grid">
              <RunPlanningFields
                canRunLocalAutomation={canRunLocalAutomation}
                canRunRemoteAutomation={canRunRemoteAutomation}
                disabled={isSubmitting}
                endDate={executionEndDate}
                mode={executionStartMode}
                onEndDateChange={onExecutionEndDateChange}
                onModeChange={onExecutionStartModeChange}
                onStartDateChange={onExecutionStartDateChange}
                startDate={executionStartDate}
              />

              {executionStartMode !== "manual" && canConfigureParallelAutomation ? (
                <FormField label="Parallel execution">
                <div className="execution-parallel-control">
                  <label>
                    <input
                      checked={executionParallelEnabled}
                      onChange={(event) => onExecutionParallelEnabledChange(event.target.checked)}
                      type="checkbox"
                    />
                    <span>Run tests in parallel</span>
                  </label>
                  <input
                    aria-label="Parallel test count"
                    disabled={!executionParallelEnabled}
                    min={1}
                    max={50}
                    onChange={(event) => onExecutionParallelCountChange(Math.max(1, Number(event.target.value) || 1))}
                    type="number"
                    value={executionParallelCount}
                  />
                </div>
              </FormField>
              ) : null}
            </div>

            </aside>
            <section className="scoped-run-selection-pane" aria-label="Selected test cases">
              <div className="scoped-run-pane-heading"><strong>Selected Test Cases</strong><span>{testCases.length} selected for this run</span></div>
            <FormField label="Run scope" required>
              <div className="selection-summary-card">
                <div className="selection-summary-header">
                  <div>
                    <strong>{testCases.length ? `${testCases.length} test cases selected` : "No test cases selected yet"}</strong>
                    <span>Review the scope before creating your run.</span>
                  </div>
                </div>

                {testCases.length > 8 || selectedCaseSearch ? <input aria-label="Search selected test cases" className="scoped-run-selected-search" placeholder="Find a selected test case…" value={selectedCaseSearch} onChange={event => setSelectedCaseSearch(event.target.value)} type="search" /> : null}
                {testCases.length ? (
                  <div className="scoped-run-selected-list">
                    {visibleSelectedCases.map((testCase) => (
                      <div key={testCase.id} className="scoped-run-selected-item">
                        <TestCaseIcon size={16} />
                        <span><strong>{testCase.title}</strong>{testCase.display_id ? <small>{testCase.display_id}</small> : null}</span>
                        <button aria-label={`Remove ${testCase.title} from this run`} className="ghost-button" disabled={isSubmitting} onClick={() => onRemoveTestCase(testCase.id)} title="Remove from run" type="button"><span aria-hidden="true">×</span></button>
                      </div>
                    ))}
                    {!visibleSelectedCases.length ? <div className="empty-state compact">No selected cases match. <button className="text-button" onClick={() => setSelectedCaseSearch("")} type="button">Clear search</button></div> : null}
                  </div>
                ) : <p className="inline-message" role="status">Choose at least one test case to create a run.</p>}
              </div>
            </FormField>
            </section>
            </fieldset>
          </div>

          <div className="action-row execution-create-actions">
            <button className="ghost-button" disabled={isSubmitting} onClick={onClose} type="button">
              Cancel
            </button>
            <button className="primary-button" disabled={!testCases.length || !canCreateExecution || isSubmitting || isPreparingOptions || !dataSetValid} type="submit">
              {isSubmitting
                ? "Creating…"
                : executionStartMode === "local"
                  ? "Create Local Run"
                  : executionStartMode === "remote"
                    ? "Create Remote Run"
                    : "Create Manual Run"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function EditorAccordionSection({
  title,
  summary,
  countLabel,
  isExpanded,
  onToggle,
  actions,
  children
}: {
  title: ReactNode;
  summary: ReactNode;
  countLabel: string;
  isExpanded: boolean;
  onToggle: () => void;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className={isExpanded ? "editor-accordion-section is-expanded" : "editor-accordion-section"}>
      <div className="editor-accordion-head">
        <button
          aria-expanded={isExpanded}
          className="editor-accordion-toggle"
          onClick={onToggle}
          type="button"
        >
          <div className="editor-accordion-toggle-main">
            <span aria-hidden="true" className={isExpanded ? "editor-accordion-icon is-expanded" : "editor-accordion-icon"}>
              <EditorAccordionChevronIcon />
            </span>
            <div className="editor-accordion-toggle-copy">
              <strong>{title}</strong>
              <span>{summary}</span>
            </div>
          </div>
        </button>
        <div className="editor-accordion-toggle-meta">
          <span className="editor-accordion-toggle-count">{countLabel}</span>
          {actions ? <div className="editor-accordion-actions">{actions}</div> : null}
          <button
            aria-label={isExpanded ? "Collapse section" : "Expand section"}
            className="editor-accordion-toggle-state explorer-icon-button"
            onClick={onToggle}
            title={isExpanded ? "Collapse section" : "Expand section"}
            type="button"
          >
            <CollapseExpandIcon isExpanded={isExpanded} />
          </button>
        </div>
      </div>
      {isExpanded ? <div className="editor-accordion-body">{children}</div> : null}
    </section>
  );
}

function EditorAccordionChevronIcon() {
  return (
    <svg aria-hidden="true" fill="none" height="18" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" viewBox="0 0 24 24" width="18">
      <path d="m9 6 6 6-6 6" />
    </svg>
  );
}

function StepIconButton({
  children,
  ariaLabel,
  title,
  onClick,
  count = 0,
  disabled = false,
  tone = "ghost",
  type = "button"
}: {
  children: ReactNode;
  ariaLabel: string;
  title: string;
  onClick: () => void;
  count?: number;
  disabled?: boolean;
  tone?: "ghost" | "primary" | "danger";
  type?: "button" | "submit" | "reset";
}) {
  const className =
    tone === "primary"
      ? "step-action-button step-action-button--primary"
      : tone === "danger"
        ? "step-action-button step-action-button--danger"
        : "step-action-button";

  return (
    <button aria-label={ariaLabel} className={count ? `${className} has-count` : className} disabled={disabled} onClick={onClick} title={title} type={type}>
      {children}
      {count ? <span className="step-action-count">{count}</span> : null}
    </button>
  );
}

function StepIconShell({ children }: { children: ReactNode }) {
  return (
    <svg aria-hidden="true" fill="none" height="16" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.9" viewBox="0 0 24 24" width="16">
      {children}
    </svg>
  );
}

function StepAiIcon() {
  return <RichTextAiRephraseIcon />;
}

function StepMoveUpIcon() {
  return (
    <StepIconShell>
      <path d="m12 6-4 4" />
      <path d="m12 6 4 4" />
      <path d="M12 6v12" />
    </StepIconShell>
  );
}

function StepMoveDownIcon() {
  return (
    <StepIconShell>
      <path d="m12 18-4-4" />
      <path d="m12 18 4-4" />
      <path d="M12 6v12" />
    </StepIconShell>
  );
}

function StepSaveIcon() {
  return (
    <StepIconShell>
      <path d="M5 6.5A1.5 1.5 0 0 1 6.5 5h9l3.5 3.5V17.5A1.5 1.5 0 0 1 17.5 19h-11A1.5 1.5 0 0 1 5 17.5z" />
      <path d="M9 5v5h6V6" />
      <path d="M9 15h6" />
    </StepIconShell>
  );
}

function StepDeleteIcon() {
  return (
    <StepIconShell>
      <path d="M4 7h16" />
      <path d="M9 7V5.8A1.8 1.8 0 0 1 10.8 4h2.4A1.8 1.8 0 0 1 15 5.8V7" />
      <path d="M7 7l.8 11.1A2 2 0 0 0 9.8 20h4.4a2 2 0 0 0 2-1.9L17 7" />
      <path d="M10 11v5" />
      <path d="M14 11v5" />
    </StepIconShell>
  );
}

function StepExpandAllIcon() {
  return (
    <StepIconShell>
      <path d="M12 12V4" />
      <path d="m8.5 7.5 3.5-3.5 3.5 3.5" />
      <path d="M12 12v8" />
      <path d="m8.5 16.5 3.5 3.5 3.5-3.5" />
    </StepIconShell>
  );
}

function StepCollapseAllIcon() {
  return (
    <StepIconShell>
      <path d="M12 4v8" />
      <path d="m8.5 8.5 3.5 3.5 3.5-3.5" />
      <path d="M12 20v-8" />
      <path d="m8.5 15.5 3.5-3.5 3.5 3.5" />
    </StepIconShell>
  );
}

function StepCopyIcon() {
  return (
    <StepIconShell>
      <rect x="9" y="9" width="10" height="10" rx="2" />
      <path d="M7 15H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v1" />
    </StepIconShell>
  );
}

function StepInsertIcon() {
  return (
    <StepIconShell>
      <path d="M12 5v14" />
      <path d="M5 12h14" />
      <path d="M7 5h10" />
      <path d="M7 19h10" />
    </StepIconShell>
  );
}

function StepInsertAboveIcon() {
  return (
    <StepIconShell>
      <path d="M12 19V7" />
      <path d="m8.5 10.5 3.5-3.5 3.5 3.5" />
      <path d="M6 4h12" />
      <path d="M8 15h8" />
    </StepIconShell>
  );
}

function StepInsertBelowIcon() {
  return (
    <StepIconShell>
      <path d="M12 5v12" />
      <path d="m8.5 13.5 3.5 3.5 3.5-3.5" />
      <path d="M8 9h8" />
      <path d="M6 20h12" />
    </StepIconShell>
  );
}

function StepPasteIcon() {
  return (
    <StepIconShell>
      <path d="M8 5.5A2.5 2.5 0 0 1 10.5 3h3A2.5 2.5 0 0 1 16 5.5V7H8z" />
      <path d="M7 7h10a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2z" />
      <path d="M12 10v6" />
      <path d="m9.5 13.5 2.5 2.5 2.5-2.5" />
    </StepIconShell>
  );
}

function StepCutIcon() {
  return (
    <StepIconShell>
      <circle cx="6" cy="7" r="2" />
      <circle cx="6" cy="17" r="2" />
      <path d="M8 8.5 19 18" />
      <path d="M8 15.5 19 6" />
    </StepIconShell>
  );
}

function StepPasteAboveIcon() {
  return (
    <StepIconShell>
      <path d="M8 5.5A2.5 2.5 0 0 1 10.5 3h3A2.5 2.5 0 0 1 16 5.5V7H8z" />
      <path d="M7 7h10a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2z" />
      <path d="M12 16V10" />
      <path d="m8.5 12.5 3.5-3.5 3.5 3.5" />
    </StepIconShell>
  );
}

function StepPasteBelowIcon() {
  return (
    <StepIconShell>
      <path d="M8 5.5A2.5 2.5 0 0 1 10.5 3h3A2.5 2.5 0 0 1 16 5.5V7H8z" />
      <path d="M7 7h10a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2z" />
      <path d="M12 10v6" />
      <path d="m8.5 15.5 3.5 3.5 3.5-3.5" />
    </StepIconShell>
  );
}

function StepParameterIcon() {
  return (
    <StepIconShell>
      <path d="M5 7h14" />
      <path d="M5 12h14" />
      <path d="M5 17h14" />
      <circle cx="10" cy="7" r="2.1" fill="currentColor" stroke="none" />
      <circle cx="15" cy="12" r="2.1" fill="currentColor" stroke="none" />
      <circle cx="11.5" cy="17" r="2.1" fill="currentColor" stroke="none" />
      <path d="M4 11.5a3.7 3.7 0 0 0 0 1" />
      <path d="M3.1 9.4 4.3 10" />
      <path d="M4.3 14 3.1 14.6" />
      <path d="M2.5 12h1.2" />
    </StepIconShell>
  );
}

function StepKebabIcon() {
  return (
    <StepIconShell>
      <circle cx="12" cy="6" r="1.5" />
      <circle cx="12" cy="12" r="1.5" />
      <circle cx="12" cy="18" r="1.5" />
    </StepIconShell>
  );
}

function StepGroupIcon() {
  return (
    <StepIconShell>
      <path d="M4 7.5A2.5 2.5 0 0 1 6.5 5H10l2 2h5.5A2.5 2.5 0 0 1 20 9.5v7A2.5 2.5 0 0 1 17.5 19h-11A2.5 2.5 0 0 1 4 16.5z" />
      <path d="M4 10h16" />
    </StepIconShell>
  );
}

function StepSharedGroupIcon() {
  return <SharedStepsIconGraphic size={16} />;
}

function StepGroupChevronIcon() {
  return (
    <StepIconShell>
      <path d="m7 10 5 5 5-5" />
    </StepIconShell>
  );
}

function ExecutionStepsIcon() {
  return (
    <StepIconShell>
      <path d="M8 7h10" />
      <path d="M8 12h10" />
      <path d="M8 17h10" />
      <circle cx="5" cy="7" r="1" fill="currentColor" stroke="none" />
      <circle cx="5" cy="12" r="1" fill="currentColor" stroke="none" />
      <circle cx="5" cy="17" r="1" fill="currentColor" stroke="none" />
    </StepIconShell>
  );
}

function getStepKindMeta(groupKind?: TestStep["group_kind"] | null) {
  if (groupKind === "reusable") {
    return { label: "Shared Step Group step", tone: "shared" as const };
  }

  if (groupKind === "local") {
    return { label: "Local group step", tone: "local" as const };
  }

  return { label: "Standard step", tone: "default" as const };
}



function StepUngroupIcon() {
  return (
    <StepIconShell>
      <path d="M5 7h6v6H5z" />
      <path d="M13 11h6v6h-6z" />
      <path d="m9 16-3 3" />
      <path d="m6 16 3 3" />
      <path d="m18 5-3 3" />
      <path d="m15 5 3 3" />
    </StepIconShell>
  );
}



const STEP_ACTION_HOVER_EXIT_DELAY_MS = 1000;

function StepActionMenu({
  className = "",
  label,
  actions,
  previewActions,
  openOnHover = false
}: {
  className?: string;
  label: string;
  actions: StepActionMenuAction[];
  previewActions?: StepActionMenuAction[];
  openOnHover?: boolean;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [isHovering, setIsHovering] = useState(false);
  const [menuPlacement, setMenuPlacement] = useState<"below" | "above">("below");
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const hoverExitTimeoutRef = useRef<number | null>(null);

  const updateMenuPlacement = () => {
    const trigger = triggerRef.current;
    if (!trigger || typeof window === "undefined") {
      return;
    }

    const rect = trigger.getBoundingClientRect();
    const estimatedMenuHeight = Math.max(menuRef.current?.offsetHeight || 260, 220);
    const bottomRoom = window.innerHeight - rect.bottom;
    const topRoom = rect.top;
    setMenuPlacement(bottomRoom < estimatedMenuHeight + 24 && topRoom > bottomRoom ? "above" : "below");
  };

  const clearHoverExitTimeout = () => {
    if (hoverExitTimeoutRef.current === null) {
      return;
    }

    window.clearTimeout(hoverExitTimeoutRef.current);
    hoverExitTimeoutRef.current = null;
  };

  const handleHoverEnter = () => {
    if (!openOnHover) {
      return;
    }

    clearHoverExitTimeout();
    setIsHovering(true);
  };

  const handleHoverLeave = () => {
    if (!openOnHover) {
      return;
    }

    clearHoverExitTimeout();
    hoverExitTimeoutRef.current = window.setTimeout(() => {
      setIsHovering(false);
      hoverExitTimeoutRef.current = null;
    }, STEP_ACTION_HOVER_EXIT_DELAY_MS);
  };

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handlePointer = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) {
        return;
      }
      setIsOpen(false);
    };

    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    };

    window.addEventListener("mousedown", handlePointer);
    window.addEventListener("keydown", handleKey);
    return () => {
      window.removeEventListener("mousedown", handlePointer);
      window.removeEventListener("keydown", handleKey);
    };
  }, [isOpen]);

  useEffect(
    () => () => {
      if (hoverExitTimeoutRef.current !== null) {
        window.clearTimeout(hoverExitTimeoutRef.current);
      }
    },
    []
  );

  return (
    <div
      className={["step-card-menu", className].filter(Boolean).join(" ")}
      onMouseEnter={handleHoverEnter}
      onMouseLeave={handleHoverLeave}
    >
      <button
        aria-expanded={isOpen}
        aria-haspopup="menu"
        aria-label={label}
        className="step-card-menu-trigger"
        onClick={() => {
          updateMenuPlacement();
          setIsOpen((current) => !current);
        }}
        ref={triggerRef}
        title={label}
        type="button"
      >
        <StepKebabIcon />
      </button>
      {openOnHover && previewActions?.length && isHovering && !isOpen ? (
        <div className="step-card-menu-panel is-horizontal" role="menu">
          {previewActions.map((action) => (
            <button
              aria-label={action.label}
              className={["step-card-menu-item", action.tone ? `is-${action.tone}` : ""].filter(Boolean).join(" ")}
              disabled={action.disabled}
              key={action.label}
              onClick={() => {
                action.onClick();
                setIsHovering(false);
              }}
              role="menuitem"
              title={action.label}
              type="button"
            >
              {action.icon}
            </button>
          ))}
        </div>
      ) : null}
      {isOpen ? (
        <div className={["step-card-menu-panel", menuPlacement === "above" ? "is-open-above" : ""].filter(Boolean).join(" ")} ref={menuRef} role="menu">
          {actions.map((action) => (
            <button
              className={["step-card-menu-item", action.tone ? `is-${action.tone}` : ""].filter(Boolean).join(" ")}
              disabled={action.disabled}
              key={action.label}
              onClick={() => {
                action.onClick();
                setIsOpen(false);
              }}
              role="menuitem"
              title={action.label}
              type="button"
            >
              {action.icon}
              <span className="step-card-menu-item-content">
                <span className="step-card-menu-item-label-row">
                  <span className="step-card-menu-item-label">{action.label}</span>
                  {action.description ? (
                    <InfoTooltip
                      content={action.description}
                      label={`${action.label} information`}
                      trigger="span"
                    />
                  ) : null}
                </span>
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function InlineStepInsertSlot({
  availableParameters,
  parameterValues,
  index,
  isActive,
  draft,
  onCancel,
  onChange,
  onSubmit
}: {
  availableParameters: StepParameterDefinition[];
  parameterValues: Record<string, string>;
  index: number;
  isActive: boolean;
  draft: StepDraft;
  onCancel: () => void;
  onChange: (draft: StepDraft) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  if (!isActive) {
    return null;
  }

  return (
    <div className="step-insert-slot is-active">
      <form className="step-create step-create--inline" onSubmit={onSubmit}>
        <strong>{index === 0 ? "+ Add Step" : "+ Insert Step"}</strong>
        <FormField label="Action">
          <RichTextEditor availableParameters={availableParameters} parameterValues={parameterValues}
            autoFocus
            value={draft.action}
            onChange={(value) => onChange({ ...draft, action: value })}
          />
        </FormField>
        <FormField label="Expected result">
          <RichTextEditor availableParameters={availableParameters} parameterValues={parameterValues}
            value={draft.expected_result}
            onChange={(value) => onChange({ ...draft, expected_result: value })}
          />
        </FormField>
        <div className="action-row">
          <button className="ghost-button" onClick={onCancel} type="button">
            Cancel
          </button>
          <button className="primary-button" type="submit">Save step</button>
        </div>
      </form>
    </div>
  );
}

function StepGroupHeader({
  name,
  kind,
  stepCount,
  isExpanded,
  canMoveUp,
  canMoveDown,
  showAutomationTools,
  selectionState,
  onConvertToLocal,
  onConvertToShared,
  onToggle,
  onMoveUp,
  onMoveDown,
  onPreviewCode,
  onRemoveGroup,
  onUngroup,
  onToggleSelect
}: {
  name: string;
  kind: TestStep["group_kind"];
  stepCount: number;
  isExpanded: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  showAutomationTools: boolean;
  selectionState: "all" | "some" | "none";
  onConvertToLocal: () => void;
  onConvertToShared: () => void;
  onToggle: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onPreviewCode: () => void;
  onRemoveGroup: () => void;
  onUngroup: () => void;
  onToggleSelect: (checked: boolean) => void;
}) {
  const isSharedGroup = kind === "reusable";
  const unlinkTitle = isSharedGroup ? "Unlink Shared Step Group from this case" : "Ungroup steps";
  const removeTitle = isSharedGroup ? "Remove Shared Step Group from this case" : "Remove group and steps";
  const selectionRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!selectionRef.current) {
      return;
    }
    selectionRef.current.indeterminate = selectionState === "some";
  }, [selectionState]);

  return (
    <div className="step-group-header">
      <div
        aria-expanded={isExpanded}
        aria-label={`${isExpanded ? "Collapse" : "Expand"} ${name}`}
        className="step-group-toggle"
        onClick={onToggle}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onToggle();
          }
        }}
        role="button"
        tabIndex={0}
      >
        <label className="checkbox-field step-group-select" onClick={(event) => event.stopPropagation()}>
          <input
            aria-label={`Select steps in ${name}`}
            checked={selectionState === "all"}
            onChange={(event) => onToggleSelect(event.target.checked)}
            ref={selectionRef}
            type="checkbox"
          />
        </label>
        <span aria-hidden="true" className={isExpanded ? "step-group-chevron is-expanded" : "step-group-chevron"}>
          <StepGroupChevronIcon />
        </span>
        <span className="step-group-title">
          <span className="step-group-title-row">
            <span aria-hidden="true" className={isSharedGroup ? "step-group-icon is-shared" : "step-group-icon is-local"}>
              <SharedGroupLevelIcon kind={kind} />
            </span>
            <strong>{name}</strong>
          </span>
        </span>
      </div>
      <div className="step-group-meta">
        <span className="step-group-count">
          {stepCount} step{stepCount === 1 ? "" : "s"}
        </span>
        {showAutomationTools ? (
          <InlineStepToolButton
            ariaLabel={`Preview automation for ${name}`}
            className="step-inline-tool--group"
            onClick={onPreviewCode}
            title="Preview consolidated automation"
          >
            <AutomationCodeIcon />
          </InlineStepToolButton>
        ) : null}
        <StepActionMenu
          className="step-group-header-actions step-card-menu--flat"
          label="Group actions"
          actions={[
            {
              label: "Move group up",
              icon: <StepMoveUpIcon />,
              onClick: onMoveUp,
              disabled: !canMoveUp
            },
            {
              label: "Move group down",
              icon: <StepMoveDownIcon />,
              onClick: onMoveDown,
              disabled: !canMoveDown
            },
            ...(isSharedGroup
              ? [{
                  label: "Convert to local group",
                  icon: <StepGroupIcon />,
                  onClick: onConvertToLocal
                }]
              : [{
                  label: "Convert to Shared Step Group",
                  icon: <StepSharedGroupIcon />,
                  onClick: onConvertToShared
                }]),
            {
              label: unlinkTitle,
              icon: <StepUngroupIcon />,
              onClick: onUngroup
            },
            {
              label: removeTitle,
              icon: <StepDeleteIcon />,
              onClick: onRemoveGroup,
              tone: "danger"
            }
          ]}
        />
      </div>
    </div>
  );
}

function EditableStepCard({
  step,
  draft,
  displayLabel,
  parameterValues,
  availableParameters,
  isExpanded,
  isSelected,
  isRephrasing,
  canPaste,
  canMoveUp,
  canMoveDown,
  showAutomationTools,
  showRecorderTools,
  onSave,
  onDraftChange,
  onCopy,
  onCut,
  onDelete,
  onInsertAbove,
  onInsertBelow,
  onToggle,
  onToggleSelect,
  onMoveUp,
  onMoveDown,
  onChangeStepType,
  onEditAutomation,
  onInspect,
  onRephrase,
  onPasteAbove,
  onPasteBelow
}: {
  step: TestStep;
  draft: StepDraft;
  displayLabel?: string;
  parameterValues: Record<string, string>;
  availableParameters: StepParameterDefinition[];
  isExpanded: boolean;
  isSelected: boolean;
  isRephrasing: boolean;
  canPaste: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  showAutomationTools: boolean;
  showRecorderTools: boolean;
  onSave: (input: StepDraft) => void;
  onDraftChange: (input: StepDraft) => void;
  onCopy: () => void;
  onCut: () => void;
  onDelete: () => void;
  onInsertAbove: () => void;
  onInsertBelow: () => void;
  onToggle: () => void;
  onToggleSelect: (checked: boolean) => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onChangeStepType: (nextType: TestStep["step_type"]) => void;
  onEditAutomation: () => void;
  onInspect: () => void;
  onRephrase: () => void;
  onPasteAbove: () => void;
  onPasteBelow: () => void;
}) {
  const stepKind = getStepKindMeta(step.group_kind);
  const isDirty =
    normalizeSharedGroupComparableText(draft.action) !== normalizeSharedGroupComparableText(step.action)
    || normalizeSharedGroupComparableText(draft.expected_result) !== normalizeSharedGroupComparableText(step.expected_result)
    || !areComparableStepAutomationEqual(draft, step);
  const stepActions: StepActionMenuAction[] = [
    {
      label: "Insert above",
      description: "Open a new step slot right above this step.",
      icon: <StepInsertAboveIcon />,
      onClick: onInsertAbove
    },
    {
      label: "Insert below",
      description: "Open a new step slot right below this step.",
      icon: <StepInsertBelowIcon />,
      onClick: onInsertBelow
    },
    ...(canPaste
      ? [{
          label: "Paste above",
          description: "Insert the clipboard steps before this step.",
          icon: <StepPasteAboveIcon />,
          onClick: onPasteAbove
        }, {
          label: "Paste below",
          description: "Insert the clipboard steps after this step.",
          icon: <StepPasteBelowIcon />,
          onClick: onPasteBelow
        }]
      : []),
    {
      label: "Copy step",
      description: "Place this step in the clipboard.",
      icon: <StepCopyIcon />,
      onClick: onCopy
    },
    {
      label: "Cut step",
      description: "Move this step after you paste it somewhere else.",
      icon: <StepCutIcon />,
      onClick: onCut
    },
    {
      label: "Move up",
      description: "Shift this step earlier in its current order.",
      icon: <StepMoveUpIcon />,
      onClick: onMoveUp,
      disabled: !canMoveUp
    },
    {
      label: "Move down",
      description: "Shift this step later in its current order.",
      icon: <StepMoveDownIcon />,
      onClick: onMoveDown,
      disabled: !canMoveDown
    },
    ...(showRecorderTools
      ? [{
          label: "Inspect and record",
          description: "Open the recorder for this step action.",
          icon: <RecordIcon size={16} />,
          onClick: onInspect
        }]
      : []),
    {
      label: isRephrasing ? "Rephrasing with AI…" : "Rephrase with AI",
      description: "Improve the action and expected result without changing the test intent.",
      icon: <StepAiIcon />,
      onClick: onRephrase,
      disabled: isRephrasing
    },
    ...(showAutomationTools
      ? [{
          label: stepHasAutomation(draft) ? "View or edit automation" : "Edit step automation",
          description: "Manage the automation mapped to this step.",
          icon: <AutomationCodeIcon />,
          onClick: onEditAutomation
        }]
      : []),
    {
      label: isDirty ? "Save all changes" : "Save test case",
      description: "Save case details, Test Params, preconditions, and all edited steps together.",
      icon: <StepSaveIcon />,
      onClick: () => onSave(draft),
      tone: "primary"
    },
    {
      label: "Delete step",
      description: "Remove this step from the current test case.",
      icon: <StepDeleteIcon />,
      onClick: onDelete,
      tone: "danger"
    }
  ];

  return (
    <article
      className={[
        isExpanded ? "step-card is-expanded" : "step-card",
        displayLabel ? "step-card--plain-label" : "",
        step.group_kind === "reusable" ? "step-card--shared" : "",
        step.group_kind === "local" ? "step-card--grouped" : ""
      ].filter(Boolean).join(" ")}
    >
      <div className="step-card-top">
        <label className="checkbox-field step-card-select">
          <input
            aria-label={`Select step ${step.step_order}`}
            checked={isSelected}
            onChange={(event) => onToggleSelect(event.target.checked)}
            type="checkbox"
          />
        </label>
        <div className="step-card-type-tool">
          <StepTypePickerButton value={draft.step_type || step.step_type} onChange={onChangeStepType} />
        </div>
        <button
          aria-label={isExpanded ? `Hide step ${step.step_order} details` : `Show step ${step.step_order} details`}
          className="step-card-toggle"
          onClick={onToggle}
          type="button"
        >
          <div className="step-card-summary">
            <div className="step-card-summary-row">
              <div className="step-card-summary-top">
                <StepKindIconBadge label={stepKind.label} tone={stepKind.tone} />
                <strong>{displayLabel || `Step ${step.step_order}`}</strong>
              </div>
              <StepParameterizedText
                className="step-card-parameterized"
                fallback="No action written yet"
                text={richTextToPlainText(draft.action)}
                values={parameterValues}
              />
            </div>
          </div>
        </button>
        <div className="step-inline-tools">
          {showRecorderTools ? <InlineStepToolButton
            ariaLabel={`Inspect and record action for step ${step.step_order}`}
            onClick={onInspect}
            title="Inspect and record this step action"
          >
            <RecordIcon size={16} />
          </InlineStepToolButton> : null}
          <InlineStepToolButton
            ariaLabel={`Rephrase step ${step.step_order} with AI`}
            className={isRephrasing ? "is-active" : ""}
            disabled={isRephrasing}
            onClick={onRephrase}
            title={isRephrasing ? "AI is rephrasing this step" : "Rephrase step with AI"}
          >
            {isRephrasing ? <LoadingState label={`Rephrasing step ${step.step_order}`} /> : <StepAiIcon />}
          </InlineStepToolButton>
          {showAutomationTools ? <InlineStepToolButton
            ariaLabel={`Edit automation for step ${step.step_order}`}
            className={stepHasAutomation(draft) ? "is-active" : ""}
            onClick={onEditAutomation}
            title={stepHasAutomation(draft) ? "View or edit mapped automation for this step" : "Edit step automation"}
          >
            <AutomationCodeIcon />
          </InlineStepToolButton> : null}
        </div>
        <StepActionMenu
          className="step-card-menu--floating"
          label={`Step ${step.step_order} actions`}
          openOnHover
          previewActions={stepActions}
          actions={stepActions}
        />
      </div>

      {isExpanded ? (
        <div className="step-card-body">
          <FormField label="Action">
            <RichTextEditor availableParameters={availableParameters} parameterValues={parameterValues} value={draft.action} onChange={(value) => onDraftChange({ ...draft, action: value })} />
          </FormField>
          <FormField label="Expected result">
            <RichTextEditor availableParameters={availableParameters} parameterValues={parameterValues} value={draft.expected_result} onChange={(value) => onDraftChange({ ...draft, expected_result: value })} />
          </FormField>
        </div>
      ) : null}
    </article>
  );
}

function DraftStepCard({
  step,
  displayLabel,
  parameterValues,
  availableParameters,
  isSelected,
  isExpanded,
  isRephrasing,
  canPaste,
  canMoveUp,
  canMoveDown,
  showAutomationTools,
  showRecorderTools,
  onChange,
  onCopy,
  onCut,
  onDelete,
  onInsertAbove,
  onInsertBelow,
  onToggle,
  onToggleSelect,
  onMoveUp,
  onMoveDown,
  onChangeStepType,
  onEditAutomation,
  onInspect,
  onRephrase,
  onPasteAbove,
  onPasteBelow
}: {
  step: { id: string; step_order: number; action: string; expected_result: string; step_type: TestStep["step_type"]; automation_code: string; api_request: TestStep["api_request"]; group_id: string | null; group_name: string | null; group_kind: "local" | "reusable" | null; reusable_group_id: string | null };
  displayLabel?: string;
  parameterValues: Record<string, string>;
  availableParameters: StepParameterDefinition[];
  isSelected: boolean;
  isExpanded: boolean;
  isRephrasing: boolean;
  canPaste: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  showAutomationTools: boolean;
  showRecorderTools: boolean;
  onChange: (input: StepDraft) => void;
  onCopy: () => void;
  onCut: () => void;
  onDelete: () => void;
  onInsertAbove: () => void;
  onInsertBelow: () => void;
  onToggle: () => void;
  onToggleSelect: (checked: boolean) => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onChangeStepType: (nextType: TestStep["step_type"]) => void;
  onEditAutomation: () => void;
  onInspect: () => void;
  onRephrase: () => void;
  onPasteAbove: () => void;
  onPasteBelow: () => void;
}) {
  const stepKind = getStepKindMeta(step.group_kind);
  const stepActions: StepActionMenuAction[] = [
    {
      label: "Insert above",
      description: "Open a new step slot right above this draft step.",
      icon: <StepInsertAboveIcon />,
      onClick: onInsertAbove
    },
    {
      label: "Insert below",
      description: "Open a new step slot right below this draft step.",
      icon: <StepInsertBelowIcon />,
      onClick: onInsertBelow
    },
    ...(canPaste
      ? [{
          label: "Paste above",
          description: "Insert the clipboard steps before this draft step.",
          icon: <StepPasteAboveIcon />,
          onClick: onPasteAbove
        }, {
          label: "Paste below",
          description: "Insert the clipboard steps after this draft step.",
          icon: <StepPasteBelowIcon />,
          onClick: onPasteBelow
        }]
      : []),
    {
      label: "Copy step",
      description: "Place this draft step in the clipboard.",
      icon: <StepCopyIcon />,
      onClick: onCopy
    },
    {
      label: "Cut step",
      description: "Move this draft step after you paste it somewhere else.",
      icon: <StepCutIcon />,
      onClick: onCut
    },
    {
      label: "Move up",
      description: "Shift this draft step earlier in its current order.",
      icon: <StepMoveUpIcon />,
      onClick: onMoveUp,
      disabled: !canMoveUp
    },
    {
      label: "Move down",
      description: "Shift this draft step later in its current order.",
      icon: <StepMoveDownIcon />,
      onClick: onMoveDown,
      disabled: !canMoveDown
    },
    ...(showRecorderTools
      ? [{
          label: "Inspect and record",
          description: "Open the recorder for this draft step action.",
          icon: <RecordIcon size={16} />,
          onClick: onInspect
        }]
      : []),
    {
      label: isRephrasing ? "Rephrasing with AI…" : "Rephrase with AI",
      description: "Improve the draft action and expected result without changing the test intent.",
      icon: <StepAiIcon />,
      onClick: onRephrase,
      disabled: isRephrasing
    },
    ...(showAutomationTools
      ? [{
          label: stepHasAutomation(step) ? "View or edit automation" : "Edit step automation",
          description: "Manage the automation mapped to this draft step.",
          icon: <AutomationCodeIcon />,
          onClick: onEditAutomation
        }]
      : []),
    {
      label: "Delete step",
      description: "Remove this draft step from the test case.",
      icon: <StepDeleteIcon />,
      onClick: onDelete,
      tone: "danger"
    }
  ];

  return (
    <article
      className={[
        isExpanded ? "step-card is-expanded" : "step-card",
        displayLabel ? "step-card--plain-label" : "",
        step.group_kind === "reusable" ? "step-card--shared" : "",
        step.group_kind === "local" ? "step-card--grouped" : ""
      ].filter(Boolean).join(" ")}
    >
      <div className="step-card-top">
        <label className="checkbox-field step-card-select">
          <input
            aria-label={`Select step ${step.step_order}`}
            checked={isSelected}
            onChange={(event) => onToggleSelect(event.target.checked)}
            type="checkbox"
          />
        </label>
        <div className="step-card-type-tool">
          <StepTypePickerButton value={step.step_type} onChange={onChangeStepType} />
        </div>
        <button
          aria-label={isExpanded ? `Hide step ${step.step_order} details` : `Show step ${step.step_order} details`}
          className="step-card-toggle"
          onClick={onToggle}
          type="button"
        >
          <div className="step-card-summary">
            <div className="step-card-summary-row">
              <div className="step-card-summary-top">
                <StepKindIconBadge label={stepKind.label} tone={stepKind.tone} />
                <strong>{displayLabel || `Step ${step.step_order}`}</strong>
              </div>
              <StepParameterizedText
                className="step-card-parameterized"
                fallback="Draft step details"
                text={richTextToPlainText(step.action || step.expected_result)}
                values={parameterValues}
              />
            </div>
          </div>
        </button>
        <div className="step-inline-tools">
          {showRecorderTools ? <InlineStepToolButton
            ariaLabel={`Inspect and record action for step ${step.step_order}`}
            onClick={onInspect}
            title="Inspect and record this step action"
          >
            <RecordIcon size={16} />
          </InlineStepToolButton> : null}
          <InlineStepToolButton
            ariaLabel={`Rephrase step ${step.step_order} with AI`}
            className={isRephrasing ? "is-active" : ""}
            disabled={isRephrasing}
            onClick={onRephrase}
            title={isRephrasing ? "AI is rephrasing this step" : "Rephrase step with AI"}
          >
            {isRephrasing ? <LoadingState label={`Rephrasing step ${step.step_order}`} /> : <StepAiIcon />}
          </InlineStepToolButton>
          {showAutomationTools ? <InlineStepToolButton
            ariaLabel={`Edit automation for step ${step.step_order}`}
            className={stepHasAutomation(step) ? "is-active" : ""}
            onClick={onEditAutomation}
            title={stepHasAutomation(step) ? "View or edit mapped automation for this step" : "Edit step automation"}
          >
            <AutomationCodeIcon />
          </InlineStepToolButton> : null}
        </div>
        <StepActionMenu
          className="step-card-menu--floating"
          label={`Step ${step.step_order} actions`}
          openOnHover
          previewActions={stepActions}
          actions={stepActions}
        />
      </div>

      {isExpanded ? (
        <div className="step-card-body">
          <FormField label="Action">
            <RichTextEditor availableParameters={availableParameters} parameterValues={parameterValues}
              value={step.action}
              onChange={(value) =>
                onChange({
                  action: value,
                  expected_result: step.expected_result,
                  step_type: step.step_type,
                  automation_code: step.automation_code,
                  api_request: step.api_request
                })
              }
            />
          </FormField>
          <FormField label="Expected result">
            <RichTextEditor availableParameters={availableParameters} parameterValues={parameterValues}
              value={step.expected_result}
              onChange={(value) =>
                onChange({
                  action: step.action,
                  expected_result: value,
                  step_type: step.step_type,
                  automation_code: step.automation_code,
                  api_request: step.api_request
                })
              }
            />
          </FormField>
        </div>
      ) : null}
    </article>
  );
}


function StepGroupModal({
  name,
  reusable,
  selectedCount,
  isSaving,
  onNameChange,
  setReusable,
  onSave,
  onClose
}: {
  name: string;
  reusable: boolean;
  selectedCount: number;
  isSaving: boolean;
  onNameChange: (value: string) => void;
  setReusable: (value: boolean) => void;
  onSave: () => void;
  onClose: () => void;
}) {
  const dialogRef = useDialogFocus<HTMLDivElement>({ closeDisabled: isSaving, onClose });

  return (
    <div className="modal-backdrop" onClick={() => !isSaving && onClose()} role="presentation">
      <div
        aria-label="Create step group"
        aria-modal="true"
        className="modal-card suite-create-modal"
        onClick={(event) => event.stopPropagation()}
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
      >
        <div className="suite-create-header">
          <div className="suite-create-title">
            <h2 className="dialog-title">Create step group</h2>
            <p>Name this group and decide whether it should stay local to this case or become a linked Shared Step Group used in other cases.</p>
          </div>
          <DialogCloseButton disabled={isSaving} label="Close create step group" onClick={onClose} />
        </div>

        <div className="form-grid">
          <FormField label="Group name" required>
            <input
              data-autofocus="true"
              required
              value={name}
              onChange={(event) => onNameChange(event.target.value)}
            />
          </FormField>

          <label className="checkbox-field">
            <input checked={reusable} onChange={(event) => setReusable(event.target.checked)} type="checkbox" />
            Save as Shared Step Group
          </label>

          <div className="detail-summary">
            <strong>{selectedCount} step{selectedCount === 1 ? "" : "s"} selected</strong>
            <span>{reusable ? "Shared Step Groups stay linked across every test case that references them." : "Local groups only organize the current case."}</span>
          </div>
        </div>

        <div className="action-row">
          <button className="ghost-button" disabled={isSaving} onClick={onClose} type="button">
            Cancel
          </button>
          <button className="primary-button" disabled={isSaving} onClick={onSave} type="button">
            {isSaving ? "Saving…" : reusable ? "Create Shared Step Group" : "Create group"}
          </button>
        </div>
      </div>
    </div>
  );
}

function SharedGroupPickerModal({
  groups,
  selectedGroupIds,
  selectedGroups,
  isLoading,
  isInserting,
  searchValue,
  onSearchChange,
  setSelectedGroupIds,
  onConfirm,
  onClose
}: {
  groups: SharedStepGroup[];
  selectedGroupIds: string[];
  selectedGroups: SharedStepGroup[];
  isLoading: boolean;
  isInserting: boolean;
  searchValue: string;
  onSearchChange: (value: string) => void;
  setSelectedGroupIds: (value: string[]) => void;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const dialogRef = useDialogFocus<HTMLDivElement>({ onClose });
  const [usageFilter, setUsageFilter] = useState<"all" | "linked" | "unused">("all");
  const visibleGroups = groups.filter((group) => {
    const usageCount = group.usage_count ?? group.used_test_cases?.length ?? 0;
    return usageFilter === "all" || (usageFilter === "linked" ? usageCount > 0 : usageCount === 0);
  });

  return (
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <div
        aria-label="Insert Shared Step Group"
        aria-modal="true"
        className="modal-card suite-create-modal shared-group-picker-modal"
        onClick={(event) => event.stopPropagation()}
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
      >
        <div className="suite-create-header">
          <div className="suite-create-title">
            <div className="modal-title-info-row">
              <h2 className="dialog-title">Insert Shared Step Group</h2>
              <InfoTooltip
                content="Choose a Shared Step Group to insert into this case. Edits inside the group stay linked across every referencing test case."
                label="Insert Shared Step Group information"
              />
            </div>
          </div>
          <DialogCloseButton label="Close Shared Step Group picker" onClick={onClose} />
        </div>

        <div className="shared-group-picker-body">
          <div className="shared-group-picker-toolbar">
            <label className="shared-group-picker-search">
              <span className="sr-only">Search Shared Step Groups</span>
              <SearchIcon />
              <input
                data-autofocus="true"
                placeholder="Search by ID, name, description, or step text"
                value={searchValue}
                onChange={(event) => onSearchChange(event.target.value)}
              />
            </label>
            <label className="shared-group-picker-filter">
              <span className="sr-only">Filter Shared Step Groups</span>
              <select value={usageFilter} onChange={(event) => setUsageFilter(event.target.value as typeof usageFilter)}>
                <option value="all">All groups</option>
                <option value="linked">Linked to cases</option>
                <option value="unused">Not yet linked</option>
              </select>
            </label>
            <button
              className="ghost-button compact"
              disabled={!visibleGroups.length}
              onClick={() => setSelectedGroupIds([...new Set([...selectedGroupIds, ...visibleGroups.map((group) => group.id)])])}
              type="button"
            >
              <SelectionToggleIcon checked />
              Select All
            </button>
            <button className="ghost-button compact" disabled={!selectedGroupIds.length} onClick={() => setSelectedGroupIds([])} type="button"><SelectionToggleIcon checked={false} />Clear</button>
            <span className="shared-group-picker-selected-count">{selectedGroupIds.length} selected</span>
          </div>

          <div className="shared-group-picker-list" role="list">
            {isLoading ? <LoadingState label="Loading Shared Step Groups" /> : null}
            {!isLoading && visibleGroups.map((group) => {
              const stepCount = group.step_count ?? group.steps.length;
              const linkedCaseCount = group.usage_count ?? group.used_test_cases?.length ?? 0;
              const isSelected = selectedGroupIds.includes(group.id);

              return (
              <div className={isSelected ? "shared-group-picker-row is-selected" : "shared-group-picker-row"} key={group.id} role="listitem">
                <input
                  aria-label={`Select ${group.name}`}
                  checked={isSelected}
                  onChange={(event) => setSelectedGroupIds(event.target.checked ? [...new Set([...selectedGroupIds, group.id])] : selectedGroupIds.filter((id) => id !== group.id))}
                  type="checkbox"
                />
                <span className="shared-group-picker-identity">
                  <span className="step-group-title-row">
                    <span aria-hidden="true" className="step-kind-badge is-shared">
                      <SharedStepsIconGraphic size={14} />
                    </span>
                    <DisplayIdBadge value={group.display_id || group.id} />
                  </span>
                  <strong>{group.name}</strong>
                  <span>{group.description ? richTextToPlainText(group.description) : "No description provided."}</span>
                </span>
                <span className="shared-group-picker-metrics">
                  <span><strong>{stepCount}</strong> {stepCount === 1 ? "step" : "steps"}</span>
                  <span><strong>{linkedCaseCount}</strong> linked {linkedCaseCount === 1 ? "case" : "cases"}</span>
                  {linkedCaseCount ? (
                    <a
                      href={`/shared-steps?group=${encodeURIComponent(group.id)}&usage=1`}
                      onClick={(event) => event.stopPropagation()}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Open associated cases
                    </a>
                  ) : <span className="shared-group-picker-no-link">No associated cases</span>}
                </span>
              </div>
            );})}
            {!isLoading && !visibleGroups.length ? <div className="empty-state compact">No Shared Step Groups match this search and filter.</div> : null}
          </div>

          {selectedGroups.length ? (
            <div className="detail-summary">
              <div className="step-group-title-row">
                <span aria-hidden="true" className="step-kind-badge is-shared">
                  <SharedStepsIconGraphic size={14} />
                </span>
                <strong>{selectedGroups.length === 1 ? selectedGroups[0].name : `${selectedGroups.length} Shared Step Groups`}</strong>
              </div>
              <span>
                {selectedGroups.reduce((count, group) => count + (group.step_count ?? group.steps.length), 0)} linked steps will be inserted in selection order.
              </span>
            </div>
          ) : null}
        </div>

        <div className="action-row">
          <button className="ghost-button" onClick={onClose} type="button">
            Cancel
          </button>
          <button className="primary-button" disabled={!selectedGroupIds.length || isLoading || isInserting} onClick={onConfirm} type="button">
            {isInserting ? "Inserting…" : `Insert ${selectedGroupIds.length || "selected"} group${selectedGroupIds.length === 1 ? "" : "s"}`}
          </button>
        </div>
      </div>
    </div>
  );
}
