import { capabilityView } from "@hellotest/platform/frontend/src/platform/capabilities/CapabilityView";
const AiAssurancePanel = capabilityView<import("react").ComponentProps<typeof import("@hellotest/ai/frontend/components/AiAssurancePanel")["AiAssurancePanel"]> & {}>("ai", "AiAssurancePanel", () => import("@hellotest/ai/frontend/components/AiAssurancePanel"), "ai");
const AiInsightPreviewDialog = capabilityView<import("react").ComponentProps<typeof import("@hellotest/ai/frontend/components/AiInsightPreviewDialog")["AiInsightPreviewDialog"]> & {}>("ai", "AiInsightPreviewDialog", () => import("@hellotest/ai/frontend/components/AiInsightPreviewDialog"), "ai");
import { StepKindIconBadge } from "../components/StepKindIconBadge";
import { mapRunHooksToExecutionHooks } from "../lib/runHooks";
import type { TestDataOptions } from "@hellotest/platform/frontend/src/types";
import { FormEvent, Fragment, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { getAdminFeatureUrl } from "@hellotest/platform/frontend/src/platform/lib/adminFeatureLinks";
import {
  IconActivity,
  IconAlertTriangle,
  IconArrowLeft,
  IconArrowRight,
  IconBug,
  IconCheck,
  IconCheckbox,
  IconChevronDown,
  IconChevronRight,
  IconDots,
  IconCircleCheck,
  IconCircleX,
  IconClock,
  IconCode,
  IconDatabase,
  IconExternalLink,
  IconFileReport,
  IconFlag,
  IconFolder,
  IconInfoCircle,
  IconLink,
  IconListDetails,
  IconMail,
  IconPencil,
  IconPhoto,
  IconPlayerPlay,
  IconPlayerPause,
  IconRefresh,
  IconRocket,
  IconSearch,
  IconShieldCheck,
  IconSparkles,
  IconTerminal2,
  IconUser,
  IconX
} from "@tabler/icons-react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "@hellotest/platform/frontend/src/auth/AuthContext";
import { ActivityIcon, AddIcon, ArchiveIcon, CalendarIcon, CollapseExpandIcon, EyeIcon, ExportIcon, GithubIcon, GoogleDriveIcon, ImportIcon, LayersIcon, MailIcon, OpenIcon, PlayIcon, SearchIcon, SelectionToggleIcon, SparkIcon, TestCaseIcon, TestSuiteIcon, TrashIcon, UsersIcon } from "@hellotest/platform/frontend/src/platform/components/AppIcons";
import { AppTypeDropdown } from "@hellotest/platform/frontend/src/platform/components/AppTypeDropdown";

import { type AiPreviewFinding } from "@hellotest/ai/frontend/components/AiInsightPreviewDialog";
import { AgenticProcessRail, AiEvidenceButton, AiEvidenceFlyout, AiFeatureComposer } from "@hellotest/agentic/frontend/components/AgenticExperience";
import { CatalogActionMenu } from "@hellotest/platform/frontend/src/shared/components/CatalogActionMenu";
import { CatalogSelectionControls } from "@hellotest/platform/frontend/src/shared/components/CatalogSelectionControls";
import { CatalogViewToggle } from "@hellotest/platform/frontend/src/shared/components/CatalogViewToggle";
import { CatalogSearchFilter } from "@hellotest/platform/frontend/src/shared/components/CatalogSearchFilter";
import { CreateRunActionButton } from "../components/CreateRunActionButton";
import { DataTable, type DataTableColumn } from "@hellotest/platform/frontend/src/shared/components/DataTable";
import { DisplayIdBadge } from "@hellotest/platform/frontend/src/shared/components/DisplayIdBadge";
import { EntityIdBadge } from "@hellotest/platform/frontend/src/shared/components/EntityIdBadge";
import { FormField } from "@hellotest/platform/frontend/src/shared/components/FormField";
import { ExecutionContextSelector } from "../components/ExecutionContextSelector";
import { EvidenceFlipCard } from "@hellotest/platform/frontend/src/shared/components/EvidenceFlipCard";
import { RunEditDialog } from "../components/RunEditDialog";
import { RunResultChart } from "../components/RunResultChart";
import { RunReviewDialog } from "../components/RunReviewDialog";
import { CaseRunAttachmentPanel } from "../components/CaseRunAttachmentPanel";
import { uploadExecutionAttachment } from "../lib/executionAttachments";
import { CaseRunParameterContext } from "../components/CaseRunParameterContext";
import { resolveExecutionParameterContext } from "../lib/executionParameterContext";
import { RunDataSetup } from "../components/RunDataSetup";
import { TestCasePicker, type TestCaseSelectionResolution } from "../components/TestCasePicker";
import { runCaseReferences, runPickerIdBatches, retainEligibleRunCases, loadRunPickerCaseBatch } from "../lib/runPickerCases";
import { clearCreateRunNavigation, createRunDeliveryUpdates, createRunSelectionReadiness, deriveCreateRunDelivery, readCreateRunNavigation, type CreateRunNavigationPrefill } from "../lib/createRunNavigation";
import { expandSelectedSuiteIds } from "../lib/runDataTemplate";
import { RunContextLinks } from "../components/RunContextLinks";
import { RunConfigurationDialog, type RunConfigurationResource } from "../components/RunConfigurationDialog";
import { isRunFinished, normalizeRunCatalogView, runCatalogBucket, runStoryCounts } from "../lib/runCatalog";
import { summarizeRunScopeCompletion } from "../lib/runScopeCompletion";
import { ExternalReferencesField } from "@hellotest/manual/frontend/components/ExternalReferencesField";
import { InfoTooltip } from "@hellotest/platform/frontend/src/shared/components/InfoTooltip";
import { HierarchyMetricStrip } from "../components/HierarchyMetricStrip";
import { JiraAttachmentPanel } from "@hellotest/integration/frontend/components/JiraAttachmentPanel";
import { LoadingState } from "@hellotest/platform/frontend/src/shared/components/LoadingState";
import { MultiAssigneePicker } from "@hellotest/platform/frontend/src/shared/components/MultiAssigneePicker";
import { PageHeader } from "@hellotest/platform/frontend/src/shared/components/PageHeader";
import { Panel } from "@hellotest/platform/frontend/src/shared/components/Panel";
import {
  ApiRequestInfoDetails,
  AutomationCodeIcon,
  CodePreviewDialog,
  JsonResponseTreeNode,
  SharedGroupLevelIcon,
  StepIconButton as InlineStepToolButton,
  StepTypeIcon
} from "@hellotest/automation/frontend/components/StepAutomationEditor";
import { ProjectDropdown } from "@hellotest/platform/frontend/src/platform/components/ProjectDropdown";
import { ProgressMeter } from "@hellotest/platform/frontend/src/shared/components/ProgressMeter";
import { QualityMetricStrip, type QualityMetric } from "@hellotest/dashboard/frontend/components/QualityMetricStrip";
import { ReportBugSplitActionButton } from "../components/ReportBugSplitActionButton";
import { richTextToPlainText } from "@hellotest/platform/frontend/src/platform/components/RichTextEditor";
import { RunPlanningFields } from "../components/RunPlanningFields";
import { RunHooksBuilder, type RunHookSelection } from "../components/RunHooksBuilder";
import { StepParameterizedText } from "../components/StepParameterizedText";
import { gherkinDescriptionToPlainText, matchGherkinKeyword, normalizeGherkinParameterReferences } from "../lib/gherkin";
import { getExecutionResultDurationMs, type ExecutionCaseLifecycleAction } from "../lib/executionCaseLifecycle";
import { StatusBadge } from "@hellotest/platform/frontend/src/shared/components/StatusBadge";
import { SubnavTabs } from "@hellotest/platform/frontend/src/shared/components/SubnavTabs";
import { SuiteScopePicker, type SuitePickerMetadataByCaseId } from "../components/SuiteCasePicker";
import { TileCardMetric, TileCardProgress } from "@hellotest/platform/frontend/src/shared/components/TileCardPrimitives";
import { TileCardSkeletonGrid } from "@hellotest/platform/frontend/src/shared/components/TileCardSkeletonGrid";
import { ToastMessage } from "@hellotest/platform/frontend/src/shared/components/ToastMessage";
import { VirtualList } from "@hellotest/platform/frontend/src/shared/components/VirtualList";
import { WorkspaceBackButton, WorkspaceMasterDetail } from "@hellotest/platform/frontend/src/platform/components/WorkspaceMasterDetail";
import { useDeleteConfirmation } from "@hellotest/platform/frontend/src/shared/components/DeleteConfirmationDialog";
import { AiLlmSelect } from "@hellotest/ai/frontend/components/AiLlmSelect";
import { useAiLlmDefault } from "@hellotest/integration/frontend/hooks/useAiLlmDefault";
import { useAiPromptRegistry } from "@hellotest/integration/frontend/hooks/useAiPromptRegistry";
import { useCurrentAppType, useCurrentProject } from "@hellotest/platform/frontend/src/platform/hooks/useCurrentProject";
import { useDialogFocus } from "@hellotest/platform/frontend/src/shared/hooks/useDialogFocus";
import { useFeatureFlags } from "@hellotest/platform/frontend/src/platform/hooks/useFeatureFlags";
import { useCapabilityAccess } from "@hellotest/platform/frontend/src/platform/hooks/useCapabilityAccess";
import { optionalQueryView } from "@hellotest/platform/frontend/src/shared/lib/optionalQueryView";
import { api } from "@hellotest/platform/frontend/src/lib/api";
import {
  canEditAutomationCode as resolveCanEditAutomationCode,
  canPreviewAutomationCode as resolveCanPreviewAutomationCode,
  canViewAutomationCode as resolveCanViewAutomationCode
} from "@hellotest/automation/frontend/lib/automationAccess";
import { assessRunEvidenceReadiness } from "@hellotest/ai/frontend/lib/aiAssurance";
import { asArray } from "@hellotest/platform/frontend/src/shared/lib/collectionGuards";
import { buildDeliveryScopeOptions, resolveDeliveryScopePrefill } from "@hellotest/manual/frontend/lib/deliveryScopeOptions";
import { formatReferenceList, parseReferenceList } from "@hellotest/platform/frontend/src/shared/lib/externalReferences";
import { areFeatureFlagsEnabled } from "@hellotest/platform/frontend/src/platform/lib/featureFlags";
import { summarizeExecutionStart } from "../lib/executionStartSummary";
import { selectLatestExecutionResultInstances } from "../lib/executionResultMetrics";
import { buildBrowserUrl } from "@hellotest/integration/frontend/lib/integrationUrls";
import { buildBugReportPath } from "../lib/bugReportNavigation";
import { hasPermission } from "@hellotest/platform/frontend/src/platform/lib/permissions";
import { isRovoIntegrationId } from "@hellotest/integration/frontend/lib/rovo";
import { readDefaultCatalogViewMode } from "@hellotest/platform/frontend/src/shared/lib/viewPreferences";
import { buildGroupAutomationCode, resolveStepAutomationCode } from "@hellotest/automation/frontend/lib/stepAutomation";
import {
  deriveCaseStatusFromSteps,
  parseExecutionLogs,
  stringifyExecutionLogs,
  type ExecutionStepApiDetail,
  type ExecutionAiAnalysis,
  type ExecutionStepCaptureMap,
  type ExecutionStepEvidence,
  type ExecutionStepStatus,
  type ExecutionStepAutomationDetail,
  type ExecutionStepWebDetail
} from "../lib/executionLogs";
import { combineStepParameterValues, normalizeStepParameterValues, parseStepParameterName, resolveStepParameterText } from "@hellotest/platform/frontend/src/shared/lib/stepParameters";
import { type AssigneeOption, buildAssigneeOptions, resolveUserInitials, resolveUserPrimaryLabel, resolveUserSecondaryLabel } from "@hellotest/platform/frontend/src/platform/lib/userDisplay";
import type {
  AppType,
  Execution,
  ExecutionCaseSnapshot,
  ExecutionDataSetSnapshot,
  ExecutionResult,
  ExecutionSchedule,
  ExecutionStatus,
  ExecutionStepSnapshot,
  Integration,
  Issue,
  KeyValueEntry,
  Project,
  RequirementIteration,
  RequirementRelease,
  SmartExecutionImpactCase,
  SmartExecutionPreviewResponse,
  TestCase,
  TestStep,
  TestSuite,
  WorkspaceTransaction
} from "@hellotest/platform/frontend/src/types";
import "./ExecutionsPage.case-run.css";
import "./ExecutionsPage.command-center.css";
import "./ExecutionsPage.run-metrics.css";
import "./ExecutionsPage.hierarchy.css";

type ExecutionTab = "overview" | "logs" | "failures" | "history" | "evidence";

type ExecutionSuiteNode = {
  id: string;
  name: string;
  isHistorical?: boolean;
};

type ExecutionCaseView = {
  id: string;
  title: string;
  description: string | null;
  external_references: string[];
  priority: number | null;
  status: string | null;
  parameter_values: Record<string, string>;
  suite_id: string | null;
  suite_name: string | null;
  module_id: string | null;
  module_name: string | null;
  suite_ids: string[];
  sort_order: number;
  assigned_to: string | null;
  assigned_to_ids: string[];
  assignment_source: "run" | "suite" | "module" | "case" | null;
  assigned_user: Execution["assigned_user"];
  data_set_instances: ExecutionCaseInstanceView[];
};

type ExecutionCaseInstanceView = {
  instance_key: string;
  test_case_id: string;
  test_data_set_id: string | null;
  test_data_set_name: string | null;
  data_set_source: string | null;
  data_set_iteration_index: number | null;
  data_set_iteration_key: string | null;
  data_set_row_snapshot: Record<string, string> | null;
};

type ExecutionRunSummary = {
  caseCount: number;
  passed: number;
  failed: number;
  blocked: number;
  skipped: number;
  aborted: number;
  running: number;
  paused: number;
  total: number;
  passRate: number;
  avgDurationMs: number | null;
  timedCount: number;
  latestActivityAt: string | null;
  totalDurationMs: number;
};

type ExecutionRunImpactSummary = {
  failedCases: Array<{
    id: string;
    title: string;
    status: string;
    priority: number | null;
    suiteId: string | null;
    suiteName: string | null;
    requirementIds: string[];
    requirementTitles: string[];
    error: string | null;
  }>;
  impactedRequirements: Array<{
    id: string;
    title: string;
    priority: number | null;
    totalCases: number;
    failedCases: number;
    failureRate: number;
  }>;
  totalRequirements: number;
  failedRequirementCount: number;
  failureRate: number;
};

type ExecutionStepBlock = {
  key: string;
  groupId: string | null;
  groupName: string | null;
  groupKind: TestStep["group_kind"];
  steps: TestStep[];
};

type ExecutionIssueFilter = "all" | "with-issues" | "clean";
type ExecutionEvidenceFilter = "all" | "with-evidence" | "no-evidence";
type ExecutionCreateMode = "manual" | "smart";
type ExecutionStartMode = "manual" | "remote" | "local";
type ExecutionHookDraft = RunHookSelection[];

const emptyExecutionHookDraft = (): ExecutionHookDraft => [];

type TestRunsView = "suite-runs" | "local-runs" | "scheduled-runs" | "batch-process";
type CatalogViewMode = "tile" | "list";

type ExecutionAssigneeOption = AssigneeOption;

type ExecutionEvidencePreviewState = {
  attachmentId?: string;
  stepLabel: string;
  fileName: string | null;
  mimeType: string;
  sourceUrl: string;
};

type ExecutionApiDetailState = {
  step: TestStep;
  detail: ExecutionStepApiDetail | null;
  captures: Record<string, string>;
  note: string;
  status: ExecutionResult["status"] | "queued";
};

type ExecutionApiStepDialogProps = {
  step: TestStep;
  detail: ExecutionStepApiDetail | null;
  captures: Record<string, string>;
  note: string;
  status: ExecutionResult["status"] | "queued";
  canRun: boolean;
  isRunning: boolean;
  onClose: () => void;
  onRun: () => void;
};

type SmartExecutionRequirementOption = {
  id: string;
  title: string;
  description: string | null;
  linkedCaseCount: number;
};

type ExecutionScheduleCadence = "once" | "daily" | "weekly" | "monthly" | "interval_minutes";


const BATCH_PROCESS_CATEGORIES = new Set([
  "bulk_import",
  "ai_generation",
  "backup",
  "automation_build",
  "smart_execution",
  "reporting"
]);

const EMPTY_EXECUTION_RUN_SUMMARY: ExecutionRunSummary = {
  caseCount: 0,
  passed: 0,
  failed: 0,
  blocked: 0,
  skipped: 0,
  aborted: 0,
  running: 0,
  paused: 0,
  total: 0,
  passRate: 0,
  avgDurationMs: null,
  timedCount: 0,
  latestActivityAt: null,
  totalDurationMs: 0
};

const EMPTY_EXECUTION_RUN_IMPACT_SUMMARY: ExecutionRunImpactSummary = {
  failedCases: [],
  impactedRequirements: [],
  totalRequirements: 0,
  failedRequirementCount: 0,
  failureRate: 0
};

function executionScopeCaseCount(execution: Execution) {
  return Math.max(
    Number(execution.scope_case_count || 0),
    execution.case_snapshots?.length || 0,
    execution.test_case_ids?.length || 0
  );
}

function executionDataIterationCount(execution: Execution) {
  const snapshot = execution.test_data_set?.snapshot;
  const rowCount = Math.max(snapshot?.rows?.length || 0, snapshot?.template_rows?.length || 0);
  return Math.max(rowCount, 1);
}

function executionCaseInstanceKey(
  testCaseId: string,
  iterationIndex?: number | null,
  iterationKey?: string | null
) {
  const resolvedIteration = String(iterationKey || "").trim()
    || (iterationIndex === null || iterationIndex === undefined ? "default" : `row-${iterationIndex + 1}`);
  return `${testCaseId}:${resolvedIteration}`;
}

function executionResultMatchesCaseInstance(
  result: ExecutionResult,
  instance: ExecutionCaseInstanceView
) {
  if (result.test_case_id !== instance.test_case_id) {
    return false;
  }

  if (
    Number.isInteger(result.data_set_iteration_index)
    || Number.isInteger(instance.data_set_iteration_index)
  ) {
    return result.data_set_iteration_index === instance.data_set_iteration_index;
  }

  const resultIterationKey = String(result.data_set_iteration_key || "").trim();
  const instanceIterationKey = String(instance.data_set_iteration_key || "").trim();
  return resultIterationKey === instanceIterationKey;
}

function resolveExecutionCaseDataSet(
  snapshot: ExecutionCaseSnapshot,
  execution?: Execution | null
) {
  const caseSnapshot = snapshot.test_data_set_snapshot || null;

  if (caseSnapshot || snapshot.test_data_set_id) {
    return {
      id: snapshot.test_data_set_id || caseSnapshot?.id || null,
      name: snapshot.test_data_set_name || caseSnapshot?.name || "Deleted Data Set",
      snapshot: caseSnapshot,
      source: snapshot.data_set_source || "test_case"
    };
  }

  return execution?.test_data_set
    ? {
        id: execution.test_data_set.id || execution.test_data_set.snapshot?.id || null,
        name: execution.test_data_set.name || execution.test_data_set.snapshot?.name || "Deleted Data Set",
        snapshot: execution.test_data_set.snapshot,
        source: "run"
      }
    : null;
}

function buildExecutionCaseInstances(
  snapshot: ExecutionCaseSnapshot,
  execution?: Execution | null
): ExecutionCaseInstanceView[] {
  const dataSet = resolveExecutionCaseDataSet(snapshot, execution);

  if (!dataSet) {
    return [{
      instance_key: executionCaseInstanceKey(snapshot.test_case_id),
      test_case_id: snapshot.test_case_id,
      test_data_set_id: null,
      test_data_set_name: null,
      data_set_source: null,
      data_set_iteration_index: null,
      data_set_iteration_key: null,
      data_set_row_snapshot: null
    }];
  }

  const dataSetId = dataSet.id || "data-set";
  const resolvedRows = dataSet.snapshot?.rows?.length
    ? dataSet.snapshot.rows
    : dataSet.snapshot?.template_rows || [];

  if (dataSet.snapshot?.mode === "key_value") {
    const rowSnapshot = Object.fromEntries(
      resolvedRows
        .map((row) => [String(row.key || "").trim(), String(row.value ?? "")])
        .filter(([key]) => Boolean(key))
    );
    const iterationKey = `${dataSetId}:1`;
    return [{
      instance_key: executionCaseInstanceKey(snapshot.test_case_id, 0, iterationKey),
      test_case_id: snapshot.test_case_id,
      test_data_set_id: dataSet.id,
      test_data_set_name: dataSet.name,
      data_set_source: dataSet.source,
      data_set_iteration_index: 0,
      data_set_iteration_key: iterationKey,
      data_set_row_snapshot: rowSnapshot
    }];
  }

  const tableRows = resolvedRows.length ? resolvedRows : [null];
  return tableRows.map((row, index) => {
    const iterationKey = `${dataSetId}:${index + 1}`;
    return {
      instance_key: executionCaseInstanceKey(snapshot.test_case_id, index, iterationKey),
      test_case_id: snapshot.test_case_id,
      test_data_set_id: dataSet.id,
      test_data_set_name: dataSet.name,
      data_set_source: dataSet.source,
      data_set_iteration_index: index,
      data_set_iteration_key: iterationKey,
      data_set_row_snapshot: row ? { ...row } : null
    };
  });
}

function executionExpectedOutcomeCount(execution: Execution) {
  if (execution.case_snapshots?.length) {
    return execution.case_snapshots.reduce(
      (count, snapshot) => count + buildExecutionCaseInstances(snapshot, execution).length,
      0
    );
  }

  return executionScopeCaseCount(execution) * executionDataIterationCount(execution);
}

function getExecutionRiskTone(summary: ExecutionRunSummary, impactSummary: ExecutionRunImpactSummary): "success" | "info" | "warning" | "danger" {
  if (summary.failed > 0 || impactSummary.failureRate >= 30 || impactSummary.failedRequirementCount >= 3) {
    return "danger";
  }

  if (summary.blocked > 0 || impactSummary.failedRequirementCount > 0 || impactSummary.failureRate >= 12) {
    return "warning";
  }

  if (summary.total > 0 && summary.passRate >= 90) {
    return "success";
  }

  return "info";
}

function getExecutionRiskLabel(summary: ExecutionRunSummary, impactSummary: ExecutionRunImpactSummary) {
  const tone = getExecutionRiskTone(summary, impactSummary);
  if (tone === "danger") return "High risk";
  if (tone === "warning") return "Watch";
  if (tone === "success") return "Healthy";
  return "Learning";
}

function getExecutionRiskInsight(summary: ExecutionRunSummary, impactSummary: ExecutionRunImpactSummary, scopedCaseCount: number) {
  const affectedRequirements = impactSummary.failedRequirementCount;
  const topRequirement = impactSummary.impactedRequirements.find((requirement) => requirement.failedCases > 0) || impactSummary.impactedRequirements[0] || null;

  if (summary.failed > 0 && topRequirement) {
    return `Evidence-based risk signal: ${summary.failed} failed case${summary.failed === 1 ? "" : "s"} are touching ${affectedRequirements || 1} ${(affectedRequirements || 1) === 1 ? "story" : "stories"}; start with ${topRequirement.title}.`;
  }

  if (summary.blocked > 0) {
    return `Evidence-based risk signal: ${summary.blocked} blocked case${summary.blocked === 1 ? "" : "s"} can hide release confidence until the affected story coverage is cleared.`;
  }

  if (!summary.total && scopedCaseCount) {
    return `Evidence-based risk signal: ${scopedCaseCount} scoped case${scopedCaseCount === 1 ? "" : "s"} are queued; story impact will sharpen as evidence arrives.`;
  }

  if (summary.passRate >= 90 && summary.total) {
    return `Evidence-based risk signal: pass confidence is strong across touched coverage; keep an eye on high-priority linked stories.`;
  }

  return `Evidence-based risk signal: run evidence is still forming; linked stories and references are ready for trace review.`;
}

const DEFAULT_CATALOG_VIEW_MODE_BY_RUN_VIEW: Record<TestRunsView, CatalogViewMode> = {
  "suite-runs": "tile",
  "local-runs": "tile",
  "scheduled-runs": "tile",
  "batch-process": "tile"
};

const DEFAULT_RUN_LIBRARY_SEARCH_BY_VIEW: Record<TestRunsView, string> = {
  "suite-runs": "",
  "local-runs": "",
  "scheduled-runs": "",
  "batch-process": ""
};

const buildIntervalCadence = (minutes: number) => `every:${Math.max(1, Math.floor(minutes || 5))}:minutes`;

const parseIntervalCadenceMinutes = (cadence?: string | null) => {
  const match = String(cadence || "").match(/^every:(\d+):minutes$/);
  return match ? Math.max(1, Number(match[1]) || 5) : 5;
};

const isIntervalCadence = (cadence?: string | null) => /^every:\d+:minutes$/.test(String(cadence || ""));

const formatScheduleCadence = (cadence?: string | null) =>
  isIntervalCadence(cadence)
    ? `Every ${parseIntervalCadenceMinutes(cadence)} mins`
    : String(cadence || "once").replace(/[_-]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());

const EXECUTION_POLL_INTERVAL_MS = 20_000;

const WORKSPACE_TRANSACTION_METADATA_LABELS: Record<string, string> = {
  current_phase: "Current phase",
  queue_lane: "Queue lane",
  provider: "Provider",
  repository: "Repository",
  branch: "Branch",
  file_name: "File name",
  import_source: "Import source",
  exported: "Reports exported",
  imported: "Imported",
  failed: "Failed",
  total_rows: "Total rows",
  processed_items: "Processed items",
  total_items: "Total items",
  built_cases: "Scripts built",
  reused_scripts: "Scripts reused",
  healed_cases: "Cases healed",
  generated_cases_count: "Cases generated",
  requirement_count: "Stories",
  selected_case_count: "Selected cases",
  matched_case_count: "Matched cases",
  worker_count: "Workers"
};

const DEFAULT_DURATION_LABEL = "0s";
const MAX_AI_BUG_CONTEXT_ITEMS = 25;
const MAX_AI_BUG_EVIDENCE_LINES = 5;
const EXECUTION_CASE_LIST_COLUMN_PREFERENCE_KEY = "hellotest:execution-cases:list-columns:v2";

type BoardStatusTone = ExecutionStatus | ExecutionResult["status"];

const BOARD_STATUS_META: Record<BoardStatusTone, { label: string; description: string }> = {
  pending: { label: "Unexecuted", description: "This case has not been started." },
  paused: { label: "Paused", description: "Case timing is paused." },
  queued: {
    label: "Queued",
    description: "Run is ready to start."
  },
  running: {
    label: "Running",
    description: "Run is actively capturing evidence."
  },
  completed: {
    label: "Completed",
    description: "Run finished successfully."
  },
  failed: {
    label: "Failed",
    description: "Run finished with one or more failures."
  },
  aborted: {
    label: "Aborted",
    description: "Run stopped before normal completion."
  },
  passed: {
    label: "Passed",
    description: "Case finished successfully."
  },
  blocked: {
    label: "Blocked",
    description: "Execution is blocked and needs attention."
  },
  retrying: { label: "Retrying", description: "Run is retrying execution." },
  skipped: { label: "N/A", description: "This case is not applicable to this run." },
  cancelled: { label: "Cancelled", description: "Run was cancelled." },
  partially_completed: { label: "Partially completed", description: "Run finished with incomplete coverage." }
};

function normalizeExecutionStatus(status: Execution["status"] | null | undefined): ExecutionStatus {
  if (status && Object.prototype.hasOwnProperty.call(BOARD_STATUS_META, status)) {
    return status;
  }

  return "queued";
}

function executionStatusLabel(status: Execution["status"] | null | undefined) {
  return BOARD_STATUS_META[normalizeExecutionStatus(status)].label;
}

function executionStatusTooltip(status: Execution["status"] | null | undefined) {
  const { label, description } = BOARD_STATUS_META[normalizeExecutionStatus(status)];
  return `${label}: ${description}`;
}

function boardStatusTooltip(status: BoardStatusTone) {
  const { label, description } = BOARD_STATUS_META[status];
  return `${label}: ${description}`;
}

function suiteBoardStatus(metric: {
  count: number;
  passedCount: number;
  failedCount: number;
  blockedCount: number;
  runningCount?: number; pausedCount?: number; skippedCount?: number; abortedCount?: number;
}): BoardStatusTone {
  if (metric.failedCount) {
    return "failed";
  }

  if (metric.blockedCount) {
    return "blocked";
  }

  if (!metric.count) {
    return "queued";
  }

  if (metric.runningCount) return "running";
  if (metric.pausedCount) return "paused";
  if (metric.abortedCount) return "aborted";
  if (metric.passedCount + (metric.skippedCount || 0) >= metric.count) {
    return "completed";
  }

  if (metric.passedCount > 0) {
    return "running";
  }

  return "queued";
}

function toCaseView(snapshot: ExecutionCaseSnapshot, execution?: Execution | null): ExecutionCaseView {
  return {
    id: snapshot.test_case_id,
    title: snapshot.test_case_title || "Unnamed Test Case",
    description: snapshot.test_case_description,
    external_references: snapshot.external_references || [],
    priority: snapshot.priority,
    status: snapshot.status,
    parameter_values: snapshot.parameter_values || {},
    suite_id: snapshot.suite_id,
    suite_name: snapshot.suite_name,
    module_id: snapshot.module_id || null,
    module_name: snapshot.module_name || null,
    suite_ids: snapshot.suite_id ? [snapshot.suite_id] : [],
    sort_order: snapshot.sort_order,
    assigned_to: snapshot.assigned_to || null,
    assigned_to_ids: snapshot.assigned_to_ids || (snapshot.assigned_to ? [snapshot.assigned_to] : []),
    assignment_source: snapshot.assignment_source || null,
    assigned_user: snapshot.assigned_user || null,
    data_set_instances: buildExecutionCaseInstances(snapshot, execution)
  };
}

function toStepView(snapshot: ExecutionStepSnapshot): TestStep {
  return {
    id: snapshot.snapshot_step_id,
    test_case_id: snapshot.test_case_id,
    step_order: snapshot.step_order,
    action: snapshot.action,
    expected_result: snapshot.expected_result,
    step_type: snapshot.step_type,
    automation_code: snapshot.automation_code,
    api_request: snapshot.api_request,
    group_id: snapshot.group_id,
    group_name: snapshot.group_name,
    group_kind: snapshot.group_kind,
    reusable_group_id: snapshot.reusable_group_id
  };
}

function executionStepText(value?: string | null, parameterValues: Record<string, string> = {}) {
  const plainText = richTextToPlainText(value);
  return resolveStepParameterText(plainText, parameterValues) || plainText;
}

function isStepGroupStart(steps: TestStep[], index: number) {
  const currentStep = steps[index];
  const previousStep = steps[index - 1];

  return Boolean(currentStep?.group_id) && currentStep.group_id !== previousStep?.group_id;
}

function getExecutionStepKindMeta(kind?: TestStep["group_kind"] | null) {
  if (kind === "reusable") {
    return { label: "Shared Step Group step", detail: "Shared Step Group snapshot", tone: "shared" as const };
  }

  if (kind === "local") {
    return { label: "Local group", detail: "Local group snapshot", tone: "local" as const };
  }

  return { label: "Standard step", detail: "Standard step", tone: "default" as const };
}

const mergeExecutionEvidencePatch = (
  current: Record<string, ExecutionStepEvidence>,
  patch?: Record<string, ExecutionStepEvidence | null>
) => {
  if (!patch) {
    return current;
  }

  const next = { ...current };

  Object.entries(patch).forEach(([stepId, evidence]) => {
    if (!evidence?.attachmentId && !evidence?.dataUrl) {
      delete next[stepId];
      return;
    }

    next[stepId] = evidence;
  });

  return next;
};

const hasExecutionEvidence = (evidence?: ExecutionStepEvidence | null) =>
  Boolean(evidence?.attachmentId || evidence?.dataUrl);

const evidenceMimeType = (evidence?: ExecutionStepEvidence | null) => {
  if (evidence?.mimeType) {
    return evidence.mimeType;
  }
  return evidence?.dataUrl?.match(/^data:([^;,]+)/i)?.[1] || "application/octet-stream";
};


function buildProgressSegments(
  passedCount: number,
  failedCount: number,
  blockedCount: number,
  totalCount: number
) {
  if (!totalCount) {
    return [{ value: 100, tone: "neutral" as const }];
  }

  const pendingCount = Math.max(totalCount - passedCount - failedCount - blockedCount, 0);
  const segments = [
    { value: (passedCount / totalCount) * 100, tone: "success" as const },
    { value: (failedCount / totalCount) * 100, tone: "danger" as const },
    { value: (blockedCount / totalCount) * 100, tone: "info" as const },
    { value: (pendingCount / totalCount) * 100, tone: "neutral" as const }
  ];

  return segments.filter((segment) => segment.value > 0);
}

function buildRunOutcomeBreakdown(
  passedCount: number,
  failedCount: number,
  blockedCount: number,
  totalCount: number,
  otherOutcomes: { skipped?: number; aborted?: number; running?: number; paused?: number } = {}
) {
  const segments = [
    { key: "passed", label: "Passed", count: passedCount },
    { key: "failed", label: "Failed", count: failedCount },
    { key: "blocked", label: "Blocked", count: blockedCount },
    { key: "skipped", label: "Skipped", count: otherOutcomes.skipped || 0 },
    { key: "aborted", label: "Aborted", count: otherOutcomes.aborted || 0 },
    { key: "running", label: "Running", count: otherOutcomes.running || 0 },
    { key: "paused", label: "Paused", count: otherOutcomes.paused || 0 }
  ];
  return {
    total: totalCount,
    segments: [...segments, { key: "pending", label: "Pending", count: Math.max(totalCount - segments.reduce((sum, segment) => sum + segment.count, 0), 0) }]
  };
}

const executionDateTimeFormatter = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit"
});

function toTimestamp(value?: string | null) {
  if (!value) {
    return null;
  }

  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? null : parsed;
}

function formatExecutionTimestamp(value?: string | null, fallback = "Not recorded") {
  const timestamp = toTimestamp(value);
  return timestamp ? executionDateTimeFormatter.format(timestamp) : fallback;
}

function toDateTimeLocalValue(value?: string | null) {
  const timestamp = toTimestamp(value);

  if (!timestamp) {
    return "";
  }

  const date = new Date(timestamp);
  const offsetMs = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
}

function computeExecutionDurationMs(
  startedAt?: string | null,
  endedAt?: string | null,
  now = Date.now()
) {
  const start = toTimestamp(startedAt);

  if (!start) {
    return null;
  }

  const end = toTimestamp(endedAt) || now;
  return Math.max(end - start, 0);
}

function formatDuration(ms?: number | null, fallback = DEFAULT_DURATION_LABEL) {
  if (ms == null || Number.isNaN(ms)) {
    return fallback;
  }

  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours) {
    return `${hours}h ${minutes}m`;
  }

  if (minutes) {
    return `${minutes}m ${seconds}s`;
  }

  return `${seconds}s`;
}

function readWorkspaceTransactionCount(transaction: WorkspaceTransaction, key: string) {
  const value = transaction.metadata?.[key];
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatCountLabel(count: number, singular: string, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function describeWorkspaceTransaction(
  transaction: WorkspaceTransaction,
  {
    appTypeNameById,
    projectNameById
  }: {
    appTypeNameById: Record<string, string>;
    projectNameById: Record<string, string>;
  }
) {
  const importSource = String(transaction.metadata?.import_source || "").toLowerCase();
  const requirementCount = readWorkspaceTransactionCount(transaction, "requirement_count");
  const generatedCaseCount = readWorkspaceTransactionCount(transaction, "generated_cases_count");
  const importedCount = readWorkspaceTransactionCount(transaction, "imported");
  const failedCount = readWorkspaceTransactionCount(transaction, "failed");
  const totalRows = readWorkspaceTransactionCount(transaction, "total_rows");
  const processedItems = readWorkspaceTransactionCount(transaction, "processed_items");
  const totalItems = readWorkspaceTransactionCount(transaction, "total_items");
  const builtCaseCount = readWorkspaceTransactionCount(transaction, "built_cases");
  const reusedScriptCount = readWorkspaceTransactionCount(transaction, "reused_scripts");
  const healedCaseCount = readWorkspaceTransactionCount(transaction, "healed_cases");
  const selectedCaseCount = readWorkspaceTransactionCount(transaction, "selected_case_count");
  const matchedCaseCount = readWorkspaceTransactionCount(transaction, "matched_case_count");
  const exportedCount = readWorkspaceTransactionCount(transaction, "exported");
  const workerCount = readWorkspaceTransactionCount(transaction, "worker_count");
  const queueLane = String(transaction.metadata?.queue_lane || "").trim();
  const currentPhase = String(transaction.metadata?.current_phase || "").trim();
  const scopeLabel = transaction.app_type_id
    ? appTypeNameById[transaction.app_type_id] || "App type scope"
    : transaction.project_id
      ? projectNameById[transaction.project_id] || "Project scope"
      : "Workspace scope";

  if (transaction.action === "scheduled_test_case_generation" || transaction.category === "ai_generation") {
    const readyForReviewDetail = generatedCaseCount
      ? `${formatCountLabel(generatedCaseCount, "scheduler-generated test case")} ready for review.`
      : "No scheduler-generated test cases are ready for review yet.";

    return {
      icon: <SparkIcon />,
      eyebrow:
        transaction.status === "completed"
          ? "Latest AI generation job completed"
          : transaction.status === "failed"
            ? "AI generation finished with issues"
            : "Scheduled AI generation",
      detail:
        transaction.status === "completed"
          ? readyForReviewDetail
          : generatedCaseCount || requirementCount
            ? `${formatCountLabel(requirementCount, "story")} queued or processed · ${formatCountLabel(generatedCaseCount, "case")} generated`
            : "AI-assisted test case generation workflow"
    };
  }

  if (transaction.action === "smart_execution_creation" || transaction.action === "smart_execution_plan" || transaction.category === "smart_execution") {
    const planningDetail =
      matchedCaseCount || selectedCaseCount
        ? `${formatCountLabel(matchedCaseCount || selectedCaseCount, "case")} matched · ${formatCountLabel(workerCount, "worker")}`
        : currentPhase
          ? `Phase: ${currentPhase}`
          : "Smart run planning and materialization";

    return {
      icon: <SparkIcon />,
      eyebrow:
        transaction.status === "completed"
          ? "Smart execution ready"
          : transaction.status === "failed"
            ? "Smart execution finished with issues"
            : "Smart execution planning",
      detail: planningDetail
    };
  }

  if (
    transaction.action === "automation_build"
    || transaction.action === "test_case_automation_build"
    || transaction.action === "suite_automation_build"
    || transaction.category === "automation_build"
  ) {
    const automationDetail =
      builtCaseCount || reusedScriptCount || healedCaseCount
        ? `${formatCountLabel(builtCaseCount, "script")} built · ${formatCountLabel(reusedScriptCount, "script")} reused · ${formatCountLabel(healedCaseCount, "case")} healed`
        : processedItems || totalItems
          ? `${formatCountLabel(processedItems, "item")} processed of ${formatCountLabel(totalItems, "item")}`
          : currentPhase
            ? `Phase: ${currentPhase}`
            : "AI automation build process";

    return {
      icon: <AutomationCodeIcon />,
      eyebrow:
        transaction.status === "completed"
          ? "Automation build completed"
          : transaction.status === "failed"
            ? "Automation build finished with issues"
            : "Automation build running",
      detail: automationDetail
    };
  }

  if (transaction.action === "test_case_import") {
    return {
      icon: <ImportIcon />,
      eyebrow: importSource === "junit_xml" ? "JUnit XML import" : "Test case CSV import",
      detail:
        importedCount || failedCount || totalRows
          ? `${formatCountLabel(importedCount, "case")} imported · ${formatCountLabel(failedCount, "row")} failed`
          : "Bulk test case import"
    };
  }

  if (transaction.action === "requirement_import") {
    return {
      icon: <ImportIcon />,
      eyebrow: "Story import",
      detail:
        importedCount || failedCount || totalRows
          ? `${formatCountLabel(importedCount, "story")} imported · ${formatCountLabel(failedCount, "row")} failed`
          : "Bulk story import"
    };
  }

  if (transaction.action === "user_import") {
    return {
      icon: <UsersIcon />,
      eyebrow: "User import",
      detail:
        importedCount || failedCount || totalRows
          ? `${formatCountLabel(importedCount, "user")} imported · ${formatCountLabel(failedCount, "row")} failed`
          : "Bulk user import"
    };
  }

  if (transaction.category === "backup" || transaction.action === "project_artifact_backup" || transaction.action === "project_code_sync") {
    const provider = String(transaction.metadata?.provider || "").toLowerCase();
    const repository = String(transaction.metadata?.repository || "");
    const fileName = String(transaction.metadata?.file_name || "");

    if (provider === "google_drive" || transaction.action === "project_artifact_backup") {
      return {
        icon: <GoogleDriveIcon />,
        eyebrow: "Google Drive backup",
        detail: fileName ? `Uploaded ${fileName}` : "Compressed project artifact backup"
      };
    }

    if (provider === "github" || transaction.action === "project_code_sync") {
      return {
        icon: <GithubIcon />,
        eyebrow: "GitHub sync",
        detail: repository ? `Automation code synced to ${repository}` : "Project automation code sync"
      };
    }

    return {
      icon: <ArchiveIcon />,
      eyebrow: "Project backup",
      detail: transaction.description || "Project backup activity"
    };
  }

  if (transaction.action === "execution_report_export" || transaction.action === "run_report_export" || transaction.category === "reporting") {
    const reportDetail =
      exportedCount
        ? `${formatCountLabel(exportedCount, "report")} generated`
        : currentPhase
          ? `Phase: ${currentPhase}`
          : "Execution report export";

    return {
      icon: <ArchiveIcon />,
      eyebrow:
        transaction.status === "completed"
          ? "Run report ready"
          : transaction.status === "failed"
            ? "Run report failed"
            : "Generating run report",
      detail: reportDetail
    };
  }

  if (transaction.action === "testengine_run") {
    const engineDetail =
      healedCaseCount
        ? `${formatCountLabel(healedCaseCount, "healed case")} during engine execution`
        : queueLane
          ? `Lane: ${queueLane}`
          : currentPhase
            ? `Phase: ${currentPhase}`
            : "Test Engine dispatch and execution";

    return {
      icon: <PlayIcon />,
      eyebrow:
        transaction.status === "completed"
          ? "Engine execution completed"
          : transaction.status === "failed"
            ? "Engine execution failed"
            : "Engine execution running",
      detail: engineDetail
    };
  }

  return {
    icon: transaction.category === "bulk_import" ? <ImportIcon /> : <SparkIcon />,
    eyebrow: transaction.title,
    detail: transaction.description || scopeLabel
  };
}

function resolveWorkspaceTransactionSummary(
  transaction: WorkspaceTransaction,
  presentation: ReturnType<typeof describeWorkspaceTransaction>
) {
  if (transaction.action === "scheduled_test_case_generation" || transaction.category === "ai_generation") {
    return presentation.detail;
  }

  return transaction.description || presentation.detail;
}

function formatWorkspaceTransactionActionLabel(value: string | null | undefined) {
  const normalized = String(value || "").trim();

  if (!normalized) {
    return "Not recorded";
  }

  return normalized.replace(/_/g, " ");
}

function truncateProcessName(value?: string | null, limit = 46) {
  const normalized = String(value || "Batch process").trim();

  if (normalized.length <= limit) {
    return normalized;
  }

  return `${normalized.slice(0, Math.max(0, limit - 1)).trimEnd()}…`;
}

function formatWorkspaceTransactionMetadataLabel(key: string) {
  return WORKSPACE_TRANSACTION_METADATA_LABELS[key] || key.replace(/_/g, " ");
}

function formatWorkspaceTransactionMetadataValue(value: unknown): string {
  if (value === undefined || value === null || value === "") {
    return "Not recorded";
  }

  if (typeof value === "boolean") {
    return value ? "Yes" : "No";
  }

  if (Array.isArray(value)) {
    const normalized = value
      .map((entry) => formatWorkspaceTransactionMetadataValue(entry))
      .filter((entry) => entry && entry !== "Not recorded");

    return normalized.length ? normalized.join(", ") : "Not recorded";
  }

  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return "[Object]";
    }
  }

  return String(value);
}

function resolveWorkspaceTransactionMetadataEntries(transaction: WorkspaceTransaction) {
  return Object.entries(transaction.metadata || {})
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .map(([key, value]) => ({
      key,
      label: formatWorkspaceTransactionMetadataLabel(key),
      value
    }));
}

function resolveWorkspaceTransactionReadableMetadata(transaction: WorkspaceTransaction) {
  return resolveWorkspaceTransactionMetadataEntries(transaction).filter(({ value }) => typeof value !== "object" || Array.isArray(value));
}

function resolveWorkspaceTransactionComplexMetadata(transaction: WorkspaceTransaction) {
  const entries = resolveWorkspaceTransactionMetadataEntries(transaction).filter(({ value }) => typeof value === "object" && value !== null && !Array.isArray(value));

  return entries.length
    ? entries.reduce<Record<string, unknown>>((accumulator, { key, value }) => {
        accumulator[key] = value;
        return accumulator;
      }, {})
    : null;
}

function executionImpactLevelLabel(level: SmartExecutionImpactCase["impact_level"]) {
  return level.charAt(0).toUpperCase() + level.slice(1);
}

function averageDuration(values: Array<number | null | undefined>) {
  const scoped = values.filter((value): value is number => typeof value === "number" && !Number.isNaN(value));

  if (!scoped.length) {
    return null;
  }

  return Math.round(scoped.reduce((sum, value) => sum + value, 0) / scoped.length);
}

function isExecutionRunsView(view: TestRunsView) {
  return view === "suite-runs" || view === "local-runs";
}

function resolveExecutionRunBucket(execution: Execution): Extract<TestRunsView, "suite-runs" | "local-runs"> {
  if (execution.trigger === "local") {
    return "local-runs";
  }

  return runCatalogBucket(execution);
}

function buildExecutionInputParameterValues(
  execution: Execution | null,
  caseSnapshot: ExecutionCaseSnapshot | null,
  caseInstance?: ExecutionCaseInstanceView | null
) {
  return resolveExecutionParameterContext({ execution, caseSnapshot,
    dataSetRow: caseInstance?.data_set_row_snapshot,
    rowIndex: caseInstance?.data_set_iteration_index
  }).values;
}

function formatExecutionParameterToken(key: string, fallbackScope: "t" | "s" | "r" = "t") {
  return parseStepParameterName(key, fallbackScope)?.token || `@${String(key || "").trim()}`;
}

function collectExecutionOutputParameterValues(
  stepCaptures: Record<string, ExecutionStepCaptureMap>,
  steps: TestStep[]
) {
  return steps
    .slice()
    .sort((left, right) => left.step_order - right.step_order)
    .reduce<Record<string, string>>((accumulator, step) => {
      Object.assign(accumulator, stepCaptures[step.id] || {});
      return accumulator;
    }, {});
}

function collectSuiteScopedExecutionOutputParameterValues(
  resultByCaseId: Record<string, ExecutionResult>,
  caseSnapshots: ExecutionCaseSnapshot[],
  selectedTestCaseId: string
) {
  const selectedSnapshot = caseSnapshots.find((snapshot) => snapshot.test_case_id === selectedTestCaseId);

  if (!selectedSnapshot) {
    return {};
  }

  return caseSnapshots
    .filter((snapshot) =>
      snapshot.test_case_id !== selectedTestCaseId
      && snapshot.sort_order < selectedSnapshot.sort_order
    )
    .sort((left, right) => left.sort_order - right.sort_order)
    .reduce<Record<string, string>>((accumulator, snapshot) => {
      const result = resultByCaseId[snapshot.test_case_id];

      if (!result?.logs) {
        return accumulator;
      }

      const parsed = parseExecutionLogs(result.logs);
      const captures = mergeExecutionStepCaptures(parsed.stepCaptures || {}, parsed.stepApiDetails || {});

      Object.values(captures).forEach((captureMap) => {
        Object.entries(captureMap || {}).forEach(([key, value]) => {
          const parsedName = parseStepParameterName(key, "t");

          if (parsedName?.scope === "r" || (parsedName?.scope === "s" && selectedSnapshot.suite_id && snapshot.suite_id === selectedSnapshot.suite_id)) {
            accumulator[parsedName.name] = value;
          }
        });
      });

      return accumulator;
    }, {});
}

function mergeExecutionStepCaptures(
  stepCaptures: Record<string, ExecutionStepCaptureMap>,
  stepApiDetails: Record<string, ExecutionStepApiDetail>
) {
  const merged: Record<string, ExecutionStepCaptureMap> = { ...stepCaptures };

  Object.entries(stepApiDetails || {}).forEach(([stepId, detail]) => {
    const apiCaptures = detail?.captures || {};

    if (!Object.keys(apiCaptures).length) {
      return;
    }

    merged[stepId] = {
      ...(merged[stepId] || {}),
      ...apiCaptures
    };
  });

  return merged;
}

function deriveTestEngineLiveViewUrl(integration?: Integration | null) {
  if (!integration) {
    return "";
  }

  const configured = String(integration.config?.live_view_url || integration.config?.vnc_url || "").trim();
  const provider = String(integration.config?.active_web_engine || "playwright").trim().toLowerCase();

  if (
    configured
    && !(provider === "playwright" && !configured.includes("/api/v1/live-session"))
    && !(provider === "selenium" && configured.includes("/api/v1/live-session"))
  ) {
    return configured;
  }

  if (!integration.base_url) {
    return "";
  }

  try {
    const parsed = new URL(integration.base_url);
    if (provider === "selenium") {
      parsed.port = "7900";
      parsed.pathname = "/";
      parsed.search = "?autoconnect=1&resize=scale";
    } else {
      return buildBrowserUrl(integration, "/api/v1/live-session?provider=playwright", ["live_view_url", "public_base_url"]);
    }

    parsed.hash = "";
    return parsed.toString();
  } catch {
    return "";
  }
}

function isBatchProcessTransaction(transaction: WorkspaceTransaction) {
  return BATCH_PROCESS_CATEGORIES.has(transaction.category)
    || transaction.action === "testengine_run"
    || transaction.action === "execution_report_export"
    || transaction.action === "run_report_export";
}

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
  const [selectedExecutionId, setSelectedExecutionId] = useState("");
  const dismissedExecutionRouteRef = useRef("");
  const dismissedCaseRouteRef = useRef("");
  const [selectedScheduleId, setSelectedScheduleId] = useState("");
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
  const [selectedOperationId, setSelectedOperationId] = useState("");
  const [focusedSuiteId, setFocusedSuiteId] = useState("");
  const [focusedExecutionModuleId, setFocusedExecutionModuleId] = useState("");
  const [isExecutionHierarchyCollapsed, setIsExecutionHierarchyCollapsed] = useState(false);
  const [inspectedExecutionCaseId, setInspectedExecutionCaseId] = useState("");
  const [expandedExecutionSuiteIds, setExpandedExecutionSuiteIds] = useState<string[]>([]);
  const [expandedExecutionModuleKeys, setExpandedExecutionModuleKeys] = useState<string[]>([]);
  const [selectedTestCaseId, setSelectedTestCaseId] = useState("");
  const [selectedCaseInstanceKey, setSelectedCaseInstanceKey] = useState("");
  const [expandedExecutionStepGroupIds, setExpandedExecutionStepGroupIds] = useState<string[]>([]);
  const [expandedExecutionStepSections, setExpandedExecutionStepSections] = useState({ preconditions: true, testSteps: true });
  const [expandedExecutionStepIds, setExpandedExecutionStepIds] = useState<string[]>([]);
  const [bulkSelectedStepIds, setBulkSelectedStepIds] = useState<string[]>([]);
  const [editingRunId, setEditingRunId] = useState("");
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
  const [runLibrarySearchByView, setRunLibrarySearchByView] = useState<Record<TestRunsView, string>>(DEFAULT_RUN_LIBRARY_SEARCH_BY_VIEW);
  const [catalogViewModeByView, setCatalogViewModeByView] = useState<Record<TestRunsView, CatalogViewMode>>(() => {
    const preferredCatalogViewMode = readDefaultCatalogViewMode();

    return Object.fromEntries(
      Object.keys(DEFAULT_CATALOG_VIEW_MODE_BY_RUN_VIEW).map((key) => [key, preferredCatalogViewMode])
    ) as Record<TestRunsView, CatalogViewMode>;
  });
  const [executionSuiteCatalogViewMode, setExecutionSuiteCatalogViewMode] = useState<CatalogViewMode>(() => readDefaultCatalogViewMode());
  const [executionCaseCatalogViewMode, setExecutionCaseCatalogViewMode] = useState<CatalogViewMode>(() => readDefaultCatalogViewMode());
  const [selectedActionExecutionIds, setSelectedActionExecutionIds] = useState<string[]>([]);
  const [selectedActionScheduleIds, setSelectedActionScheduleIds] = useState<string[]>([]);
  const [selectedActionOperationIds, setSelectedActionOperationIds] = useState<string[]>([]);
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
  const [executionStatusFilter, setExecutionStatusFilter] = useState<ExecutionStatus | "all">("all");
  const [executionIssueFilter, setExecutionIssueFilter] = useState<ExecutionIssueFilter>("all");
  const [executionEvidenceFilter, setExecutionEvidenceFilter] = useState<ExecutionEvidenceFilter>("all");
  const [liveNow, setLiveNow] = useState(() => Date.now());
  const [executionListItemHeight, setExecutionListItemHeight] = useState(236);
  const [historyResult, setHistoryResult] = useState<ExecutionResult | null>(null);
  const [caseLifecycleAction, setCaseLifecycleAction] = useState<string | null>(null);
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
  const executionCardMeasureRef = useRef<HTMLDivElement | null>(null);
  const executionSearch = runLibrarySearchByView[testRunsView];
  const catalogViewMode = catalogViewModeByView[testRunsView];
  const deferredExecutionSearch = useDeferredValue(executionSearch);

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
  const allExecutionResultsQuery = optionalQueryView(useQuery({
    queryKey: ["execution-results", "all", projectId],
    queryFn: () => api.executionResults.list({ project_id: projectId, limit: 5000 }),
    enabled: (can("result.view")) && Boolean(projectId && isExecutionRunsView(testRunsView)),
    refetchInterval: (query) => (query.state.data as ExecutionResult[] | undefined)
      ?.some((result) => String(result.status).toLowerCase() === "running")
      ? EXECUTION_POLL_INTERVAL_MS
      : false
  }), can("result.view"));
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
        additional_context: getPrompt("ai.execution.network_to_api_steps"),
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
  const createResult = useMutation({ mutationFn: api.executionResults.create });
  const updateResult = useMutation({
    mutationFn: ({ id, input }: { id: string; input: Parameters<typeof api.executionResults.update>[1] }) =>
      api.executionResults.update(id, input)
  });

  const projects = asArray(projectsQuery.data);
  const projectMembers = asArray(projectMembersQuery.data);
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
  const allExecutionResults = asArray(allExecutionResultsQuery.data);
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
  const filteredWorkspaceTransactions = useMemo(() => {
    const search = deferredExecutionSearch.trim().toLowerCase();

    if (!search) {
      return workspaceTransactions;
    }

    return workspaceTransactions.filter((transaction) =>
      [
        transaction.id,
        transaction.related_id,
        transaction.title,
        transaction.description,
        transaction.status,
        transaction.category,
        transaction.action,
        String(transaction.metadata?.provider || ""),
        String(transaction.metadata?.repository || ""),
        String(transaction.metadata?.file_name || "")
      ].some((value) => String(value || "").toLowerCase().includes(search))
    );
  }, [deferredExecutionSearch, workspaceTransactions]);
  const selectedWorkspaceTransaction = useMemo(
    () => filteredWorkspaceTransactions.find((transaction) => transaction.id === selectedOperationId) || workspaceTransactions.find((transaction) => transaction.id === selectedOperationId) || null,
    [filteredWorkspaceTransactions, selectedOperationId, workspaceTransactions]
  );
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
    if (
      requestedScheduleId
      && requestedScheduleId !== selectedScheduleId
      && executionSchedules.some((schedule) => schedule.id === requestedScheduleId)
    ) {
      setSelectedScheduleId(requestedScheduleId);
    }
  }, [executionSchedules, searchParams, selectedScheduleId, testRunsView]);

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
    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete("schedule");
    setSelectedScheduleId("");
    setSearchParams(nextParams, { replace: true });
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
  const selectedTestEngineIntegration = useMemo(() => {
    if (!selectedExecution) {
      return null;
    }

    const projectScoped = testEngineIntegrations.find(
      (integration) => String(integration.config?.project_id || "").trim() === selectedExecution.project_id
    );

    return projectScoped || testEngineIntegrations.find((integration) => !String(integration.config?.project_id || "").trim()) || null;
  }, [selectedExecution, testEngineIntegrations]);
  const testEngineLiveViewUrl = selectedTestEngineIntegration ? deriveTestEngineLiveViewUrl(selectedTestEngineIntegration) : "";
  const isExecutionLiveViewEligible =
    currentExecutionStatus === "running"
    && Boolean(testEngineLiveViewUrl)
    && (selectedExecutionAppTypeKind === "web" || selectedExecutionAppTypeKind === "unified");
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

  const executionSummaryById = useMemo(() => {
    const summary: Record<string, ExecutionRunSummary> = {};
    const caseIdsByExecutionId: Record<string, Set<string>> = {};
    selectLatestExecutionResultInstances(allExecutionResults).forEach((result) => {
      summary[result.execution_id] = summary[result.execution_id] || { ...EMPTY_EXECUTION_RUN_SUMMARY };
      caseIdsByExecutionId[result.execution_id] = caseIdsByExecutionId[result.execution_id] || new Set<string>();
      caseIdsByExecutionId[result.execution_id].add(result.test_case_id);
      summary[result.execution_id].total += 1;
      if (result.status === "passed") {
        summary[result.execution_id].passed += 1;
      } else if (result.status === "failed") {
        summary[result.execution_id].failed += 1;
      } else if (result.status === "blocked") {
        summary[result.execution_id].blocked += 1;
      } else if (result.status === "skipped" || result.status === "aborted" || result.status === "running" || result.status === "paused") {
        summary[result.execution_id][result.status] += 1;
      }


      if (result.created_at && (!summary[result.execution_id].latestActivityAt || result.created_at > summary[result.execution_id].latestActivityAt!)) {
        summary[result.execution_id].latestActivityAt = result.created_at;
      }
    });

    allExecutionResults.forEach((result) => {
      const item = summary[result.execution_id];
      if (!item) return;
      item.timedCount += Number(Boolean(result.started_at || result.duration_ms));
      item.totalDurationMs += getExecutionResultDurationMs(result, liveNow);
    });

    Object.entries(summary).forEach(([executionId, item]) => {
      const finalizedCount = item.passed + item.failed + item.blocked;
      item.caseCount = caseIdsByExecutionId[executionId]?.size || 0;
      item.passRate = finalizedCount ? Math.round((item.passed / finalizedCount) * 100) : 0;
      item.avgDurationMs = item.timedCount ? Math.round(item.totalDurationMs / item.timedCount) : null;
    });

    return summary;
  }, [allExecutionResults, liveNow]);

  const executionImpactSummaryById = useMemo(() => {
    const resultByExecutionCaseInstance = new Map<string, ExecutionResult>();

    selectLatestExecutionResultInstances(allExecutionResults).forEach((result) => {
      const exactKey = `${result.execution_id}:${executionCaseInstanceKey(result.test_case_id, result.data_set_iteration_index, result.data_set_iteration_key)}`;
      const indexKey = `${result.execution_id}:${executionCaseInstanceKey(result.test_case_id, result.data_set_iteration_index, null)}`;
      resultByExecutionCaseInstance.set(exactKey, result);
      resultByExecutionCaseInstance.set(indexKey, result);
    });

    return executions.reduce<Record<string, ExecutionRunImpactSummary>>((summary, execution) => {
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
  }, [allExecutionResults, executions, requirementById, smartExecutionLibraryCaseById]);

  const selectedExecutionImpactSummary = selectedExecution
    ? executionImpactSummaryById[selectedExecution.id] || EMPTY_EXECUTION_RUN_IMPACT_SUMMARY
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

  const executionById = useMemo(
    () =>
      executions.reduce<Record<string, Execution>>((accumulator, execution) => {
        accumulator[execution.id] = execution;
        return accumulator;
      }, {}),
    [executions]
  );

  const resolvePersistedCaseDurationMs = (_caseInstanceKey: string, existing?: ExecutionResult) =>
    getExecutionResultDurationMs(existing);

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
        engine_base_url: executionStartMode === "local" ? "http://host.docker.internal:4301" : undefined,
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
          ? { execution_mode: "local", engine_base_url: "http://host.docker.internal:4301" }
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
    const selectedCaseResult = scopedCase ? resultByCaseId[scopedCase.id] : null;
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

  const persistCaseResult = async (
    testCaseId: string,
    patches: {
      stepStatusesPatch?: Record<string, ExecutionStepStatus>;
      stepNotesPatch?: Record<string, string>;
      stepEvidencePatch?: Record<string, ExecutionStepEvidence | null>;
    },
    options: { refresh?: boolean; instance?: ExecutionCaseInstanceView | null } = {}
  ) => {
    const shouldRefresh = options.refresh !== false;
    const scopedAppTypeId = selectedExecution?.app_type_id;
    const currentCaseSnapshot = snapshotCases.find((snapshot) => snapshot.test_case_id === testCaseId);
    const currentCase = executionCaseOrder.find((testCase) => testCase.id === testCaseId);
    const targetInstance = options.instance
      || (selectedTestCaseId === testCaseId ? selectedExecutionCaseInstance : null)
      || currentCase?.data_set_instances[0]
      || null;

    if (!selectedExecution || !testCaseId || !scopedAppTypeId || !currentCaseSnapshot || !targetInstance) {
      return;
    }

    const fresh =
      queryClient.getQueryData<ExecutionResult[]>(["execution-results", selectedExecution.id]) || executionResults;
    const existing = selectLatestExecutionResultInstances(fresh)
      .find((item) => executionResultMatchesCaseInstance(item, targetInstance));
    const prev = parseExecutionLogs(existing?.logs || null);
    const mergedStatuses = { ...(prev.stepStatuses || {}), ...(patches.stepStatusesPatch || {}) };
    const mergedNotes = { ...(prev.stepNotes || {}), ...(patches.stepNotesPatch || {}) };
    const mergedEvidence = mergeExecutionEvidencePatch(prev.stepEvidence || {}, patches.stepEvidencePatch);

    const caseStepIds = (stepsByCaseId[testCaseId] || [])
      .slice()
      .sort((left, right) => left.step_order - right.step_order)
      .map((step) => step.id);
    const hasStatusChanges = Object.keys(patches.stepStatusesPatch || {}).length > 0;
    const allStepsResolved = caseStepIds.length > 0 && caseStepIds.every((id) => ["passed", "failed", "blocked"].includes(mergedStatuses[id]));
    const aggregateStatus = hasStatusChanges
      ? allStepsResolved ? deriveCaseStatusFromSteps(caseStepIds, mergedStatuses) : "running"
      : existing?.status || "pending";
    const logs = stringifyExecutionLogs({
      stepStatuses: mergedStatuses,
      stepNotes: mergedNotes,
      stepEvidence: mergedEvidence,
      stepDefects: prev.stepDefects || {},
      stepApiDetails: prev.stepApiDetails || {},
      stepWebDetails: prev.stepWebDetails || {},
      stepCaptures: prev.stepCaptures || {}
    });
    const durationMs = resolvePersistedCaseDurationMs(targetInstance.instance_key, existing);

    if (existing) {
      const updateResponse = await updateResult.mutateAsync({
        id: existing.id,
        input: {
          status: aggregateStatus,
          logs,
          error: aggregateStatus === "failed" ? "Step failed during run" : "",
          expected_revision: existing.revision
        }
      });
      queryClient.setQueryData<ExecutionResult[]>(["execution-results", selectedExecution.id], (current = []) =>
        current.map((item) =>
          item.id === existing.id
            ? {
                ...item,
                status: aggregateStatus,
                duration_ms: existing.duration_ms,
                logs,
                error: aggregateStatus === "failed" ? "Step failed during run" : null,
                case_defects: updateResponse.case_defects,
                defects: updateResponse.defects,
                revision: updateResponse.revision
              }
            : item
        )
      );
      if (shouldRefresh) {
        await refreshExecutionScope(selectedExecution.id);
      }
      return existing.id;
    }

    const shouldCreate =
      Object.keys(patches.stepStatusesPatch || {}).length > 0
      || Object.keys(patches.stepNotesPatch || {}).length > 0
      || Object.keys(patches.stepEvidencePatch || {}).length > 0;
    if (!shouldCreate) {
      return;
    }

    const response = await createResult.mutateAsync({
      execution_id: selectedExecution.id,
      test_case_id: testCaseId,
      app_type_id: scopedAppTypeId,
      status: aggregateStatus,
      duration_ms: durationMs ?? undefined,
      logs,
      error: aggregateStatus === "failed" ? "Step failed during run" : undefined,
      test_data_set_id: targetInstance.test_data_set_id || undefined,
      test_data_set_name: targetInstance.test_data_set_name || undefined,
      data_set_iteration_index: targetInstance.data_set_iteration_index ?? undefined,
      data_set_iteration_key: targetInstance.data_set_iteration_key || undefined,
      data_set_row_snapshot: targetInstance.data_set_row_snapshot || undefined,
      external_references: currentCaseSnapshot.external_references || [],
      defects: [],
      executed_by: session!.user.id
    });

    queryClient.setQueryData<ExecutionResult[]>(["execution-results", selectedExecution.id], (current = []) => [
      {
        id: response.id,
        execution_id: selectedExecution.id,
        test_case_id: testCaseId,
        test_case_title: currentCaseSnapshot.test_case_title,
        suite_id: currentCaseSnapshot.suite_id,
        suite_name: currentCaseSnapshot.suite_name,
        app_type_id: scopedAppTypeId,
        status: aggregateStatus,
        duration_ms: durationMs,
        error: aggregateStatus === "failed" ? "Step failed during run" : null,
        logs,
        test_data_set_id: targetInstance.test_data_set_id,
        test_data_set_name: targetInstance.test_data_set_name,
        data_set_iteration_index: targetInstance.data_set_iteration_index,
        data_set_iteration_key: targetInstance.data_set_iteration_key,
        data_set_row_snapshot: targetInstance.data_set_row_snapshot,
        external_references: currentCaseSnapshot.external_references || [],
        case_defects: [],
        defects: [],
        revision: response.revision,
        executed_by: session!.user.id
      },
      ...current
    ]);
    if (shouldRefresh) {
      await refreshExecutionScope(selectedExecution.id);
    }
    return response.id;
  };

  const handleStepDefectsChange = async (step: TestStep, defectIds: string[]) => {
    if (!selectedExecution || !selectedTestCaseId || isExecutionLocked) {
      return;
    }
    if (!canManageRunResults) {
      showError(new Error("Permission required: result.manage"), "Unable to update step defect links");
      return;
    }

    setLinkingDefectStepId(step.id);
    try {
      const existingResultId = selectedExecutionResult?.id;
      const createdResultId = existingResultId
        ? undefined
        : await persistCaseResult(
          selectedTestCaseId,
          { stepNotesPatch: { [step.id]: stepNotes[step.id] || "" } },
          { refresh: false }
        );
      const resultId = existingResultId || createdResultId;

      if (!resultId) {
        throw new Error("A test case result could not be created for this step.");
      }

      const cachedResult = queryClient
        .getQueryData<ExecutionResult[]>(["execution-results", selectedExecution.id])
        ?.find((item) => item.id === resultId);
      const linkResponse = await api.executionResults.linkStepDefects(resultId, {
        step_id: step.id,
        defect_ids: [...new Set(defectIds)].slice(0, 50),
        expected_revision: cachedResult?.revision
      });
      queryClient.setQueryData<ExecutionResult[]>(["execution-results", selectedExecution.id], (current = []) =>
        current.map((item) => item.id === resultId
          ? { ...item, revision: linkResponse.revision, defects: linkResponse.defects, step_defects: linkResponse.step_defects }
          : item)
      );
      await refreshExecutionScope(selectedExecution.id);
      showSuccess(defectIds.length ? "Step defect links updated." : "Step defect links cleared.");
    } catch (error) {
      showError(error, "Unable to update step defect links");
    } finally {
      setLinkingDefectStepId("");
    }
  };

  const handleRecordStep = async (stepId: string, status: "passed" | "failed") => {
    if (!selectedExecution || !selectedTestCaseId) {
      return;
    }
    if (!canExecuteRuns || !canManageRunResults || !isExecutionStarted || isExecutionLocked || !canRecordSelectedCase || caseLifecycleAction) {
      showError(new Error("Start or resume the case before recording step results."), "Unable to record step result");
      return;
    }

    const updatedStepStatuses = { ...stepStatuses, [stepId]: status };
    const currentSteps = selectedSteps.map((step) => step.id);
    const allResolved = currentSteps.length > 0 && currentSteps.every((id) => updatedStepStatuses[id]);

    try {
      await persistCaseResult(selectedTestCaseId, { stepStatusesPatch: { [stepId]: status } });
      showSuccess(`Step marked ${status}.`);

      if (allResolved) {
        const instanceOrder = executionCaseOrder.flatMap((testCase) =>
          testCase.data_set_instances.map((instance) => ({ testCase, instance }))
        );
        const currentInstanceIndex = instanceOrder.findIndex(
          ({ instance }) => instance.instance_key === selectedExecutionCaseInstance?.instance_key
        );
        const nextCaseInstance = instanceOrder[currentInstanceIndex + 1];

        if (nextCaseInstance) {
          if (nextCaseInstance.testCase.suite_id) {
            setFocusedSuiteId(nextCaseInstance.testCase.suite_id);
          }
          focusExecutionCase(
            nextCaseInstance.testCase.id,
            selectedExecutionId,
            nextCaseInstance.instance.instance_key
          );
        }
      }
    } catch (error) {
      showError(error, "Unable to record step result");
    }
  };

  const handleSaveStepNote = async (stepId: string, note: string) => {
    if (!selectedExecution || !selectedTestCaseId) {
      return;
    }
    if (!canManageRunResults) {
      showError(new Error("Permission required: result.manage"), "Unable to save step note");
      return;
    }

    try {
      await persistCaseResult(selectedTestCaseId, { stepNotesPatch: { [stepId]: note } });
    } catch (error) {
      showError(error, "Unable to save step note");
    }
  };

  const openExecutionEvidence = async (step: TestStep, evidence: ExecutionStepEvidence) => {
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
          stepLabel: `Step ${step.step_order}`,
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
        stepLabel: `Step ${step.step_order}`,
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

  const handleBulkStepStatus = async (status: "passed" | "failed", scope: "selected" | "all") => {
    if (!selectedExecution || !selectedTestCaseId || !selectedSteps.length) {
      return;
    }
    if (!canExecuteRuns || !canManageRunResults || !isExecutionStarted || isExecutionLocked || !canRecordSelectedCase || caseLifecycleAction) {
      showError(new Error("Start or resume the case before recording step results."), "Unable to update steps");
      return;
    }

    const targetIds =
      scope === "all"
        ? selectedSteps.map((step) => step.id)
        : bulkSelectedStepIds.filter((id) => selectedSteps.some((step) => step.id === id));

    if (!targetIds.length) {
      showError(null, scope === "selected" ? "Select at least one step." : "No steps to update.");
      return;
    }

    const patch = targetIds.reduce<Record<string, ExecutionStepStatus>>((acc, id) => {
      acc[id] = status;
      return acc;
    }, {});

    try {
      await persistCaseResult(selectedTestCaseId, { stepStatusesPatch: patch });
      setBulkSelectedStepIds([]);
      showSuccess(`${targetIds.length} step${targetIds.length === 1 ? "" : "s"} marked ${status}.`);
    } catch (error) {
      showError(error, "Unable to update steps");
    }
  };

  const selectedExecutionCase = executionCaseOrder.find((testCase) => testCase.id === selectedTestCaseId) || null;
  const selectedExecutionResult = selectedExecutionCase
    ? resultForCaseInstance(selectedExecutionCaseInstance)
    : null;
  const isSelectedCaseTimerActive = selectedExecutionResult?.status === "running" && Boolean(selectedExecutionResult.timer_started_at);
  const canRecordSelectedCase = selectedExecutionResult?.status === "running" && Boolean(selectedExecutionResult.started_at || selectedExecutionStartMode !== "manual");
  const selectedExecutionCaseEffectiveUser = selectedExecutionCase?.assigned_user || selectedExecution?.assigned_user || null;
  const selectedExecutionCaseExplicitAssigneeId = selectedExecutionCase?.assignment_source === "case" ? selectedExecutionCase.assigned_to || "" : "";
  const selectedExecutionCaseReadableTitle = selectedExecutionCase
    ? resolveStepParameterText(selectedExecutionCase.title, executionStepParameterValues) || selectedExecutionCase.title
    : "";
  const selectedExecutionCaseReadableDescription = selectedExecutionCase
    ? executionStepText(selectedExecutionCase.description, executionStepParameterValues)
    : "";

  const ensureSelectedCaseResult = async () => {
    if (!selectedExecution || !selectedExecutionCaseInstance) throw new Error("Select a case row first.");
    const result = await api.executionResults.ensure({
      execution_id: selectedExecution.id,
      test_case_id: selectedExecutionCaseInstance.test_case_id,
      data_set_iteration_index: selectedExecutionCaseInstance.data_set_iteration_index ?? undefined,
      data_set_iteration_key: selectedExecutionCaseInstance.data_set_iteration_key || undefined
    });
    await refreshExecutionScope(selectedExecution.id);
    return result;
  };

  const handleCaseLifecycle = async (action: ExecutionCaseLifecycleAction) => {
    if (!selectedExecution || !selectedExecutionCaseInstance || caseLifecycleAction) return;
    const executionId = selectedExecution.id;
    setCaseLifecycleAction(action);
    try {
      await api.executionResults.transition({
        execution_id: executionId,
        test_case_id: selectedExecutionCaseInstance.test_case_id,
        data_set_iteration_index: selectedExecutionCaseInstance.data_set_iteration_index ?? undefined,
        data_set_iteration_key: selectedExecutionCaseInstance.data_set_iteration_key || undefined,
        expected_revision: selectedExecutionResult?.revision,
        expected_result_id: selectedExecutionResult?.id,
        action
      });
      await refreshExecutionScope(executionId);
      setLiveNow(Date.now());
    } catch (error) {
      showError(error, "Unable to update case run");
      await refreshExecutionScope(executionId);
    } finally {
      setCaseLifecycleAction(null);
    }
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

  const focusExecutionCase = (
    testCaseId: string,
    executionId = selectedExecutionId,
    caseInstanceKey?: string | null
  ) => {
    dismissedExecutionRouteRef.current = "";
    dismissedCaseRouteRef.current = "";
    const scopedCase = executionCaseOrder.find((testCase) => testCase.id === testCaseId);
    const nextInstanceKey = caseInstanceKey
      || scopedCase?.data_set_instances[0]?.instance_key
      || "";

    if (scopedCase?.suite_id) {
      setFocusedSuiteId(scopedCase.suite_id);
    }

    if (executionId && executionId !== selectedExecutionId) {
      setSelectedExecutionId(executionId);
    }

    setSelectedTestCaseId(testCaseId);
    setSelectedCaseInstanceKey(nextInstanceKey);

    if (executionId) {
      syncExecutionSearchParams(executionId, testCaseId, nextInstanceKey);
    }
  };

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
    () => blockingCases[0] || queuedCases[0] || executionCaseOrder[0] || null,
    [blockingCases, executionCaseOrder, queuedCases]
  );

  const runReferenceRows = useMemo(() => {
    return executionCaseOrder
      .map((testCase) => {
        const result = resultByCaseId[testCase.id];
        const status = caseDerivedStatus(testCase);
        const references = result?.external_references?.length
          ? result.external_references
          : testCase.external_references || [];
        const defects = result?.defects || [];

        return {
          defects,
          error: result?.error || "",
          references,
          status,
          testCase
        };
      })
      .filter((row) => ["failed", "blocked"].includes(row.status));
  }, [executionCaseOrder, resultByCaseId]);

  const runReferenceStats = useMemo(() => {
    const failedRows = runReferenceRows.filter((row) => ["failed", "blocked"].includes(row.status));
    const referenceCount = runReferenceRows.reduce((count, row) => count + row.references.length, 0);
    const defectCount = runReferenceRows.reduce((count, row) => count + row.defects.length, 0);

    return {
      defectCount,
      failedCaseCount: failedRows.length,
      referenceCount
    };
  }, [runReferenceRows]);

  const selectedRunEvidenceReadiness = useMemo(
    () => assessRunEvidenceReadiness({
      totalCaseCount: executionProgress.totalCases,
      touchedCaseCount: executionProgress.completedCases,
      linkedRequirementCount: selectedExecutionImpactSummary.totalRequirements,
      referenceCount: runReferenceStats.referenceCount + runReferenceStats.defectCount,
      failedCount: executionStatusCounts.failed,
      blockedCount: executionStatusCounts.blocked
    }),
    [executionProgress.completedCases, executionProgress.totalCases, executionStatusCounts.blocked, executionStatusCounts.failed, runReferenceStats.defectCount, runReferenceStats.referenceCount, selectedExecutionImpactSummary.totalRequirements]
  );
  const failureClusterFindings = useMemo<AiPreviewFinding[]>(
    () => (previewExecutionFailureClusters.data?.clusters || []).map((cluster) => ({
      id: cluster.id,
      title: `${cluster.label} · ${cluster.count} result${cluster.count === 1 ? "" : "s"}`,
      severity: cluster.id === "unclassified" ? "high" : cluster.count > 2 ? "medium" : "info",
      description: cluster.explanation,
      action: cluster.recommended_action,
      meta: `${Math.round(cluster.confidence * 100)}% deterministic rule-match strength · not root-cause certainty`,
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
    const riskRows = runReferenceRows.filter((row) => ["failed", "blocked"].includes(row.status));
    const riskLines = riskRows.length
      ? riskRows.slice(0, 8).map((row) => `- ${row.testCase.title}: ${row.status}${row.defects.length ? `, defects ${row.defects.join(", ")}` : ""}${row.references.length ? `, references ${row.references.join(", ")}` : ""}${row.error ? `, note ${row.error}` : ""}.`)
      : ["- No failed or blocked cases are currently recorded."];
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
  }, [currentExecutionStatus, executionCaseOrder, executionProgress.completedCases, executionProgress.totalCases, executionStatusCounts.blocked, executionStatusCounts.failed, executionStatusCounts.passed, executionSuites, resultByCaseId, runReferenceRows, selectedExecution, suiteMetrics]);

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
  const executionCaseInstanceOrder = executionCaseOrder.flatMap((testCase) =>
    testCase.data_set_instances.map((instance) => ({ testCase, instance }))
  );
  const selectedExecutionCaseInstanceIndex = selectedExecutionCaseInstance
    ? executionCaseInstanceOrder.findIndex(({ instance }) => instance.instance_key === selectedExecutionCaseInstance.instance_key)
    : -1;
  const previousExecutionCaseInstance = selectedExecutionCaseInstanceIndex > 0
    ? executionCaseInstanceOrder[selectedExecutionCaseInstanceIndex - 1]
    : null;
  const nextExecutionCaseInstance = selectedExecutionCaseInstanceIndex >= 0 && selectedExecutionCaseInstanceIndex < executionCaseInstanceOrder.length - 1
    ? executionCaseInstanceOrder[selectedExecutionCaseInstanceIndex + 1]
    : null;
  const focusNeighborExecutionCase = (entry: typeof executionCaseInstanceOrder[number] | null) => {
    if (!entry) return;
    if (entry.testCase.suite_id) setFocusedSuiteId(entry.testCase.suite_id);
    focusExecutionCase(entry.testCase.id, selectedExecutionId, entry.instance.instance_key);
  };
  const activeExecutionStage = selectedExecutionCase ? "case" : selectedExecution ? (isSelectedExecutionTestCaseRun ? "cases" : "suites") : "executions";
  const showExecutionListHeader =
    testRunsView === "scheduled-runs"
      ? !selectedSchedule
      : testRunsView === "batch-process"
        ? !selectedWorkspaceTransaction
        : !selectedExecution;
  const runLibraryTitle =
    testRunsView === "suite-runs"
        ? "Suite runs"
        : testRunsView === "local-runs"
          ? "Local runs"
        : testRunsView === "scheduled-runs"
          ? "Scheduled runs"
          : "Batch process";
  const runLibrarySubtitle =
    testRunsView === "suite-runs"
        ? "Browse suite and individual case runs, inspect their results, and update active run plans."
        : testRunsView === "local-runs"
          ? "Review runs launched directly against your local Playwright runner without using the Test Engine queue."
        : testRunsView === "scheduled-runs"
          ? "Keep recurring release checks separate from live runs, then launch one instantly when the team is ready."
          : "Track imports, exports, AI generation, and other long-running background work in one place.";
  const runLibrarySearchPlaceholder =
    testRunsView === "scheduled-runs"
      ? "Search scheduled runs"
      : testRunsView === "batch-process"
        ? "Search batch process records"
        : `Search ${testRunsView === "local-runs" ? "local runs" : "suite runs"}`;
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

  const openWorkspaceTransactionDetail = (transactionId: string) => {
    setSelectedOperationId(transactionId);
  };
  const closeWorkspaceTransactionDetail = () => {
    setSelectedOperationId("");
  };

  const toggleSuiteGroup = (suiteId: string) => {
    setFocusedSuiteId(suiteId);
    setExpandedExecutionSuiteIds((current) =>
      current.includes(suiteId)
        ? current.filter((id) => id !== suiteId)
        : [...current, suiteId]
    );
  };

  const executionStatusOptions = useMemo(
    () => Array.from(new Set(executions.map((execution) => normalizeExecutionStatus(execution.status)))),
    [executions]
  );
  const executionIdsWithEvidence = useMemo(
    () => new Set(
      allExecutionResults
        .filter((result) => {
          const parsed = parseExecutionLogs(result.logs || null);
          return Object.values(parsed.stepEvidence || {}).some((evidence) => hasExecutionEvidence(evidence));
        })
        .map((result) => result.execution_id)
    ),
    [allExecutionResults]
  );
  const filteredExecutions = useMemo(() => {
    const search = deferredExecutionSearch.trim().toLowerCase();

    return executions.filter((execution) => {
      const projectName = projectNameById[execution.project_id] || "";
      const assigneeLabel = resolveExecutionAssigneeSummary(execution);
      const summary = executionSummaryById[execution.id] || EMPTY_EXECUTION_RUN_SUMMARY;
      const executionStatus = normalizeExecutionStatus(execution.status);
      const hasIssues = Number(execution.metrics?.defect_count || 0) > 0;
      const hasEvidence = executionIdsWithEvidence.has(execution.id);
      const matchesSearch = !search || [
        execution.id,
        execution.name || "",
        projectName,
        assigneeLabel,
        execution.release || "",
        execution.sprint || "",
        execution.build || "",
        ...(execution.suite_ids || []),
        ...(execution.test_case_ids || []),
        ...(execution.case_snapshots || []).flatMap((snapshot) => [snapshot.test_case_id, snapshot.test_case_title, snapshot.suite_id || "", snapshot.suite_name || ""]),
        ...(execution.step_snapshots || []).flatMap((snapshot) => [snapshot.snapshot_step_id, snapshot.test_case_id, snapshot.group_id || "", snapshot.reusable_group_id || ""])
      ].some((value) => String(value || "").toLowerCase().includes(search));

      if (!matchesSearch) {
        return false;
      }

      if (executionStatusFilter !== "all" && executionStatus !== executionStatusFilter) {
        return false;
      }

      if (executionIssueFilter === "with-issues" && !hasIssues) {
        return false;
      }

      if (executionIssueFilter === "clean" && hasIssues) {
        return false;
      }

      if (executionEvidenceFilter === "with-evidence" && !hasEvidence) {
        return false;
      }

      if (executionEvidenceFilter === "no-evidence" && hasEvidence) {
        return false;
      }

      return true;
    });
  }, [deferredExecutionSearch, executionEvidenceFilter, executionIdsWithEvidence, executionIssueFilter, executionStatusFilter, executionSummaryById, executions, projectNameById]);
  const filteredSuiteExecutions = useMemo(
    () => filteredExecutions.filter((execution) => resolveExecutionRunBucket(execution) === "suite-runs"),
    [filteredExecutions]
  );
  const filteredLocalExecutions = useMemo(
    () => filteredExecutions.filter((execution) => resolveExecutionRunBucket(execution) === "local-runs"),
    [filteredExecutions]
  );
  const activeExecutionCatalogRows = useMemo(
    () =>
      testRunsView === "suite-runs"
          ? filteredSuiteExecutions
          : testRunsView === "local-runs"
            ? filteredLocalExecutions
          : [],
    [filteredLocalExecutions, filteredSuiteExecutions, testRunsView]
  );
  const availableExecutionCatalogRows = useMemo(
    () =>
      testRunsView === "suite-runs"
          ? executions.filter((execution) => resolveExecutionRunBucket(execution) === "suite-runs")
          : testRunsView === "local-runs"
            ? executions.filter((execution) => resolveExecutionRunBucket(execution) === "local-runs")
          : [],
    [executions, testRunsView]
  );

  const filteredSchedules = useMemo(() => {
    const search = deferredExecutionSearch.trim().toLowerCase();

    return executionSchedules.filter((schedule) => {
      const appTypeName = appTypeNameById[schedule.app_type_id || ""] || "";
      const assigneeLabel = resolveExecutionAssigneeSummary(schedule);
      const nextRunLabel = schedule.next_run_at || "";

      return !search || [
        schedule.id,
        schedule.name,
        appTypeName,
        assigneeLabel,
        nextRunLabel,
        schedule.release,
        schedule.sprint,
        schedule.build,
        ...(schedule.suite_ids || []),
        ...(schedule.test_case_ids || [])
      ].some((value) => String(value || "").toLowerCase().includes(search));
    });
  }, [appTypeNameById, deferredExecutionSearch, executionSchedules]);
  const runCatalogMetricCards = useMemo<QualityMetric[]>(() => {
    if (isExecutionRunsView(testRunsView)) {
      const summaries = availableExecutionCatalogRows.map((execution) =>
        executionSummaryById[execution.id] || EMPTY_EXECUTION_RUN_SUMMARY
      );
      const passed = summaries.reduce((sum, summary) => sum + summary.passed, 0);
      const failed = summaries.reduce((sum, summary) => sum + summary.failed, 0);
      const blocked = summaries.reduce((sum, summary) => sum + summary.blocked, 0);
      const finalized = passed + failed + blocked;
      const passRate = finalized ? Math.round((passed / finalized) * 100) : null;
      const running = availableExecutionCatalogRows.filter((execution) => normalizeExecutionStatus(execution.status) === "running").length;
      const queued = availableExecutionCatalogRows.filter((execution) => normalizeExecutionStatus(execution.status) === "queued").length;
      const atRisk = summaries.filter((summary) => summary.failed + summary.blocked > 0).length;

      return [
        {
          label: "Total runs",
          value: availableExecutionCatalogRows.length,
          detail: "Current run view"
        },
        {
          label: "Active runs",
          value: running,
          detail: `${queued} queued`,
          tone: running ? "info" : "neutral"
        },
        {
          label: "Recent pass rate",
          value: passRate === null ? "—" : `${passRate}%`,
          detail: finalized ? `${passed} of ${finalized} passed` : "No finalized results",
          tone: passRate === null ? "neutral" : "success"
        },
        {
          label: "At-risk runs",
          value: atRisk,
          detail: `${failed} failed · ${blocked} blocked cases`,
          tone: atRisk ? "danger" : "neutral"
        }
      ];
    }

    if (testRunsView === "scheduled-runs") {
      const active = executionSchedules.filter((schedule) => schedule.is_active).length;
      const paused = executionSchedules.length - active;
      const nextDueTimestamp = executionSchedules
        .map((schedule) => toTimestamp(schedule.next_run_at))
        .filter((timestamp): timestamp is number => timestamp !== null)
        .sort((left, right) => left - right)[0];

      return [
        { label: "Total schedules", value: executionSchedules.length },
        {
          label: "Active schedules",
          value: active,
          progress: executionSchedules.length ? Math.round((active / executionSchedules.length) * 100) : 0,
          tone: "success"
        },
        {
          label: "Paused",
          value: paused,
          detail: "Needs manual resume",
          tone: paused ? "danger" : "neutral"
        },
        {
          label: "Next due",
          value: nextDueTimestamp
            ? new Date(nextDueTimestamp).toLocaleDateString(undefined, { day: "numeric", month: "short" })
            : "—",
          detail: nextDueTimestamp ? formatExecutionTimestamp(new Date(nextDueTimestamp).toISOString()) : "No run scheduled"
        }
      ];
    }

    const completed = workspaceTransactionStatusCounts.completed || 0;
    const failed = workspaceTransactionStatusCounts.failed || 0;
    const finalized = completed + failed;
    const completionRate = finalized ? Math.round((completed / finalized) * 100) : null;

    return [
      {
        label: "Total processes",
        value: workspaceTransactions.length,
        detail: "Current process history"
      },
      {
        label: "Running now",
        value: workspaceTransactionStatusCounts.running || 0,
        detail: `${workspaceTransactionStatusCounts.queued || 0} queued`,
        tone: workspaceTransactionStatusCounts.running ? "info" : "neutral"
      },
      {
        label: "Completion rate",
        value: completionRate === null ? "—" : `${completionRate}%`,
        detail: finalized ? `${completed} of ${finalized} completed` : "No finalized processes",
        progress: completionRate,
        tone: completionRate === null ? "neutral" : "success"
      },
      {
        label: "Failures",
        value: failed,
        detail: "Processes needing review",
        tone: failed ? "danger" : "neutral"
      }
    ];
  }, [
    availableExecutionCatalogRows,
    executionSchedules,
    executionSummaryById,
    testRunsView,
    workspaceTransactionStatusCounts,
    workspaceTransactions.length
  ]);
  const isRunCatalogMetricLoading = isExecutionRunsView(testRunsView)
    ? executionsQuery.isLoading || allExecutionResultsQuery.isLoading
    : testRunsView === "scheduled-runs"
      ? executionSchedulesQuery.isLoading
      : workspaceTransactionsQuery.isLoading;
  const visibleRunLibraryIds = useMemo(() => {
    if (isExecutionRunsView(testRunsView)) {
      return activeExecutionCatalogRows.map((execution) => execution.id);
    }

    if (testRunsView === "scheduled-runs") {
      return filteredSchedules.map((schedule) => schedule.id);
    }

    if (testRunsView === "batch-process") {
      return filteredWorkspaceTransactions.map((transaction) => transaction.id);
    }

    return [];
  }, [activeExecutionCatalogRows, filteredSchedules, filteredWorkspaceTransactions, testRunsView]);
  const selectedRunLibraryActionIds = isExecutionRunsView(testRunsView)
    ? selectedActionExecutionIds
    : testRunsView === "scheduled-runs"
      ? selectedActionScheduleIds
      : selectedActionOperationIds;
  const areAllFilteredRunLibraryItemsSelected = visibleRunLibraryIds.length > 0 && visibleRunLibraryIds.every((id) => selectedRunLibraryActionIds.includes(id));
  const runSelectedForEditing = isExecutionRunsView(testRunsView) && selectedActionExecutionIds.length === 1
    ? availableExecutionCatalogRows.find((execution) => execution.id === selectedActionExecutionIds[0]) || null
    : null;
  const canEditSelectedRun = Boolean(canUpdateRuns && runSelectedForEditing && !isRunFinished(runSelectedForEditing));

  useEffect(() => {
    setSelectedActionExecutionIds([]);
  }, [projectId, appTypeId, testRunsView]);

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

  const renderExecutionRowActions = (execution: Execution) => {
    const summary = executionSummaryById[execution.id] || EMPTY_EXECUTION_RUN_SUMMARY;

    return (
      <CatalogActionMenu
        actions={[
          {
            label: "Open run",
            description: "Open this run and review its evidence.",
            icon: <OpenIcon />,
            onClick: () => {
              setTestRunsView(resolveExecutionRunBucket(execution));
              focusExecution(execution.id);
            }
          },
          {
            label: "Rerun all",
            description: "Create a fresh run with the same scope.",
            icon: <PlayIcon />,
            onClick: () => void handleRerunExecutionItem(execution, false),
            disabled: !session?.user.id || !canExecuteRuns || rerunExecution.isPending
          },
          {
            label: "Rerun failed",
            description: summary.failed
              ? `Create a new run using the ${summary.failed} failed case${summary.failed === 1 ? "" : "s"}.`
              : "No failed cases are available for a targeted rerun.",
            icon: <PlayIcon />,
            onClick: () => void handleRerunExecutionItem(execution, true),
            disabled: !session?.user.id || !canExecuteRuns || !summary.failed || rerunExecution.isPending
          }
        ]}
        label={`${execution.name || "Run"} actions`}
      />
    );
  };

  const renderExecutionScheduleRowActions = (schedule: ExecutionSchedule) => (
    <CatalogActionMenu
      actions={[
        {
          label: "Open schedule",
          description: "Review cadence, suites, and direct cases for this schedule.",
          icon: <CalendarIcon />,
          onClick: () => focusExecutionSchedule(schedule.id)
        },
        {
          label: "Edit schedule",
          description: "Adjust cadence, scope, context, or ownership for this recurring run.",
          icon: <ExecutionEditIcon />,
          onClick: () => openEditScheduleBuilder(schedule),
          disabled: !canUpdateSchedules
        },
        {
          label: "Run now",
          description: "Launch this schedule immediately as a fresh run.",
          icon: <PlayIcon />,
          onClick: () => void handleRunExecutionSchedule(schedule.id),
          disabled: !canRunSchedules
        },
        {
          label: "Delete schedule",
          description: "Remove this schedule from future run planning.",
          icon: <TrashIcon />,
          onClick: () => void handleDeleteExecutionSchedule(schedule.id, schedule.name),
          disabled: !canDeleteSchedules,
          tone: "danger" as const
        }
      ]}
      label={`${schedule.name} actions`}
    />
  );

  const renderOperationRowActions = (transaction: WorkspaceTransaction) => (
    <CatalogActionMenu
      actions={[
        {
          label: "Open batch process",
          description: "Inspect transaction metadata and event logs.",
          icon: <ActivityIcon />,
          onClick: () => {
            setTestRunsView("batch-process");
            openWorkspaceTransactionDetail(transaction.id);
          }
        }
      ]}
      label={`${transaction.title} actions`}
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

  const executionListColumns = useMemo<Array<DataTableColumn<Execution>>>(() => [
    { key: "execution", label: "Run Name", canToggle: false, render: (execution) => <strong>{execution.name || "Unnamed run"}</strong> },
    { key: "status", label: "Status", render: (execution) => <ExecutionStatusIndicator status={normalizeExecutionStatus(execution.status)} /> },
    { key: "cases", label: "Cases", render: (execution) => execution.metrics?.total_cases ?? executionScopeCaseCount(execution) },
    { key: "defects", label: "Defects", render: (execution) => execution.metrics?.defect_count ?? 0 },
    { key: "stories", label: "Story impact", render: (execution) => { const count = runStoryCounts(execution, executionImpactSummaryById[execution.id] || EMPTY_EXECUTION_RUN_IMPACT_SUMMARY); return `${count.failed}/${count.total}`; } },
    { key: "startDate", label: "Start date", render: (execution) => execution.start_date?.slice(0, 10) || "Not planned" },
    { key: "endDate", label: "End date", render: (execution) => execution.end_date?.slice(0, 10) || "Not planned" },
    { key: "duration", label: "Duration", render: (execution) => formatDuration(execution.metrics?.duration_ms ?? executionSummaryById[execution.id]?.totalDurationMs ?? 0, "0s") },
    { key: "edit", label: "Actions", render: (execution) => (canUpdateRuns ? (<button aria-label={`Edit ${execution.name || "run"}`} className="ghost-button" disabled={!canUpdateRuns || isRunFinished(execution)} onClick={(event) => { event.stopPropagation(); setEditingRunId(execution.id); }} type="button"><IconPencil size={16} />Edit run</button>) : null) }
  ], [canUpdateRuns, executionImpactSummaryById, liveNow]);
  const executionScheduleListColumns = useMemo<Array<DataTableColumn<ExecutionSchedule>>>(() => [
    {
      key: "id",
      label: "Schedule ID",
      defaultVisible: false,
      sortValue: (schedule) => schedule.id,
      render: (schedule) => <DisplayIdBadge value={schedule.id} />
    },
    {
      key: "schedule",
      label: "Schedule",
      canToggle: false,
      render: (schedule) => <strong>{schedule.name}</strong>
    },
    {
      key: "status",
      label: "Status",
      sortValue: (schedule) => schedule.is_active ? "active" : "inactive",
      render: (schedule) => (schedule.is_active ? "Active" : "Inactive")
    },
    {
      key: "cadence",
      label: "Cadence",
      sortValue: (schedule) => formatScheduleCadence(schedule.cadence),
      render: (schedule) => formatScheduleCadence(schedule.cadence)
    },
    {
      key: "assignee",
      label: "Assigned To",
      sortValue: (schedule) => resolveExecutionAssigneeSummary(schedule),
      render: (schedule) => resolveExecutionAssigneeSummary(schedule)
    },
    {
      key: "release",
      label: "Release",
      sortValue: (schedule) => schedule.release || "",
      render: (schedule) => schedule.release || "Not set"
    },
    {
      key: "sprint",
      label: "Sprint",
      defaultVisible: false,
      sortValue: (schedule) => schedule.sprint || "",
      render: (schedule) => schedule.sprint || "Not set"
    },
    {
      key: "build",
      label: "Build",
      defaultVisible: false,
      sortValue: (schedule) => schedule.build || "",
      render: (schedule) => schedule.build || "Not set"
    },
    {
      key: "suites",
      label: "Suites",
      render: (schedule) => schedule.suite_ids.length
    },
    {
      key: "directCases",
      label: "Direct cases",
      render: (schedule) => schedule.test_case_ids.length
    },
    {
      key: "nextRun",
      label: "Next run",
      render: (schedule) => formatExecutionTimestamp(schedule.next_run_at, "Not scheduled")
    },
    {
      key: "lastRun",
      label: "Last run",
      defaultVisible: false,
      render: (schedule) => formatExecutionTimestamp(schedule.last_run_at, "No runs yet")
    }
  ], [handleDeleteExecutionSchedule, handleRunExecutionSchedule, openEditScheduleBuilder]);
  const operationListColumns = useMemo<Array<DataTableColumn<WorkspaceTransaction>>>(() => [
    {
      key: "id",
      label: "Operation ID",
      defaultVisible: false,
      sortValue: (transaction) => transaction.id,
      render: (transaction) => <DisplayIdBadge value={transaction.id} />
    },
    {
      key: "operation",
      label: "Batch process",
      canToggle: false,
      render: (transaction) => {
        const presentation = describeWorkspaceTransaction(transaction, {
          appTypeNameById,
          projectNameById
        });

        return (
          <div className="data-table-multiline batch-process-name-cell">
            <strong title={transaction.title}>{truncateProcessName(transaction.title)}</strong>
            <span className="data-table-multiline-line" title={presentation.eyebrow}>
              {truncateProcessName(presentation.eyebrow, 64)}
            </span>
          </div>
        );
      }
    },
    {
      key: "status",
      label: "Status",
      render: (transaction) => <StatusBadge value={transaction.status} />
    },
    {
      key: "provider",
      label: "Provider",
      defaultVisible: false,
      render: (transaction) => String(transaction.metadata?.provider || transaction.category).replace(/_/g, " ")
    },
    {
      key: "events",
      label: "Events",
      render: (transaction) => transaction.event_count || 0
    },
    {
      key: "updated",
      label: "Last activity",
      render: (transaction) => formatExecutionTimestamp(transaction.latest_event_at || transaction.updated_at || transaction.completed_at || transaction.created_at, "Not recorded")
    }
  ], [appTypeNameById, projectNameById]);

  const activeExecutionFilterCount =
    Number(executionStatusFilter !== "all") +
    Number(executionIssueFilter !== "all") +
    Number(executionEvidenceFilter !== "all");

  const executionCardMeasureTarget = activeExecutionCatalogRows[0] || null;

  useEffect(() => {
    const node = executionCardMeasureRef.current;
    if (!node) {
      return;
    }

    const updateHeight = () => {
      const nextHeight = Math.max(180, Math.ceil(node.getBoundingClientRect().height) + 12);
      setExecutionListItemHeight((current) => (Math.abs(current - nextHeight) > 1 ? nextHeight : current));
    };

    updateHeight();

    if (typeof ResizeObserver === "undefined") {
      return;
    }

    const observer = new ResizeObserver(() => updateHeight());
    observer.observe(node);

    return () => observer.disconnect();
  }, [executionCardMeasureTarget?.id]);

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

  const prepareCaseForBulkResult = async (instance: ExecutionCaseInstanceView) => {
    if (!selectedExecution) throw new Error("Select a run first.");
    const fresh = queryClient.getQueryData<ExecutionResult[]>(["execution-results", selectedExecution.id]) || executionResults;
    const existing = selectLatestExecutionResultInstances(fresh).find((result) => executionResultMatchesCaseInstance(result, instance));
    if (existing?.status === "running" && existing.started_at) return existing;
    const result = await api.executionResults.transition({
      execution_id: selectedExecution.id, test_case_id: instance.test_case_id,
      data_set_iteration_index: instance.data_set_iteration_index,
      data_set_iteration_key: instance.data_set_iteration_key,
      expected_revision: existing?.revision, expected_result_id: existing?.id,
      action: existing?.status === "paused" ? "resume" : "start"
    });
    queryClient.setQueryData<ExecutionResult[]>(["execution-results", selectedExecution.id], (current = []) => [result, ...current.filter(item => item.id !== result.id)]);
    return result;
  };

  const persistCaseOutcomeOnly = async (testCaseId: string, status: "passed" | "failed", targetInstance: ExecutionCaseInstanceView) => {
    if (!selectedExecution) return;
    const existing = await prepareCaseForBulkResult(targetInstance);
    await api.executionResults.transition({ execution_id: selectedExecution.id, test_case_id: testCaseId,
      data_set_iteration_index: targetInstance.data_set_iteration_index, data_set_iteration_key: targetInstance.data_set_iteration_key,
      expected_revision: existing.revision, expected_result_id: existing.id, action: status === "passed" ? "pass" : "fail" });
  };

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

  const renderExecutionCommandCenter = () => {
    if (!selectedExecution) {
      return null;
    }

    type CommandModuleGroup = {
      id: string;
      name: string;
      cases: ExecutionCaseView[];
    };

    const activeSuite = isSelectedExecutionTestCaseRun
      ? null
      : executionSuites.find((suite) => suite.id === focusedSuiteId) || null;
    const activeSuiteId = activeSuite?.id || "";
    const activeScopeCases = activeSuite
      ? displayCasesBySuiteId[activeSuiteId] || []
      : executionCaseOrder;
    const scopeCompletion = (cases: ExecutionCaseView[]) => summarizeRunScopeCompletion(
      cases.flatMap(testCase => testCase.data_set_instances.map(instanceDerivedStatus))
    );
    const runHierarchyCompletion = scopeCompletion(executionCaseOrder);
    const moduleGroups = Object.values(
      activeScopeCases.reduce<Record<string, CommandModuleGroup>>((groups, testCase) => {
        const moduleId = testCase.module_id || "unassigned-module";
        groups[moduleId] = groups[moduleId] || {
          id: moduleId,
          name: testCase.module_name || "Unassigned module",
          cases: []
        };
        groups[moduleId].cases.push(testCase);
        return groups;
      }, {})
    );
    const activeModule = moduleGroups.find((module) => module.id === focusedExecutionModuleId) || null;
    const scopedCases = activeModule ? activeModule.cases : activeScopeCases;
    const normalizedCaseSearch = executionCaseSearch.trim().toLowerCase();
    const visibleCases = normalizedCaseSearch
      ? scopedCases.filter((testCase) => [
          testCase.id,
          testCase.title,
          richTextToPlainText(testCase.description),
          testCase.module_name,
          testCase.suite_name,
          caseDerivedStatus(testCase),
          `P${testCase.priority || 3}`
        ].some((value) => String(value || "").toLowerCase().includes(normalizedCaseSearch)))
      : scopedCases;
    const inspectedCase =
      visibleCases.find((testCase) => testCase.id === inspectedExecutionCaseId)
      || visibleCases.find((testCase) => ["failed", "blocked"].includes(caseDerivedStatus(testCase)))
      || visibleCases[0]
      || executionCaseOrder.find((testCase) => ["failed", "blocked"].includes(caseDerivedStatus(testCase)))
      || executionCaseOrder[0]
      || null;
    const inspectedResult = inspectedCase ? resultByCaseId[inspectedCase.id] || null : null;
    const inspectedLogs = parseExecutionLogs(inspectedResult?.logs || null);
    const inspectedEvidenceEntry = Object.entries(inspectedLogs.stepEvidence || {})
      .find(([, evidence]) => hasExecutionEvidence(evidence));
    const inspectedEvidence = inspectedEvidenceEntry?.[1] || null;
    const inspectedEvidenceStep = inspectedCase && inspectedEvidenceEntry
      ? (stepsByCaseId[inspectedCase.id] || []).find((step) => step.id === inspectedEvidenceEntry[0]) || null
      : null;
    const recentActivity = executionCaseOrder
      .map((testCase) => ({ testCase, result: resultByCaseId[testCase.id] || null }))
      .filter((entry) => entry.result)
      .sort((left, right) => String(right.result?.created_at || "").localeCompare(String(left.result?.created_at || "")))
      .slice(0, 5);
    const estimatedRemainingMs = averageCaseDurationMs === null
      ? null
      : averageCaseDurationMs * remainingCaseCount;
    const blockingCount = executionStatusCounts.failed + executionStatusCounts.blocked;
    const criticalBlockingCount = selectedExecutionImpactSummary.failedCases
      .filter((testCase) => (testCase.priority || 3) <= 1).length;
    const highBlockingCount = selectedExecutionImpactSummary.failedCases
      .filter((testCase) => (testCase.priority || 3) === 2).length;
    const environmentSnapshot = selectedExecution.test_environment?.snapshot;
    const configurationSnapshot = selectedExecution.test_configuration?.snapshot;
    const dataSetSnapshot = selectedExecution.test_data_set?.snapshot;
    const runDefectCount = selectedExecution.metrics?.defect_count;
    const runStories = runStoryCounts(selectedExecution, selectedExecutionImpactSummary);
    const timedResultCount = latestExecutionResults.filter((result) => typeof result.duration_ms === "number" && !Number.isNaN(result.duration_ms)).length;
    const primaryActionDisabled = isExecutionLocked || (
      currentExecutionStatus === "queued"
        ? !canExecuteRuns || startExecution.isPending
          || (selectedExecutionStartMode === "local" && !canRunLocalAutomation)
          || (selectedExecutionStartMode === "remote" && !canRunRemoteAutomation)
        : currentExecutionStatus === "running"
          ? !nextFocusCase
          : true);
    const primaryActionLabel =
      currentExecutionStatus === "queued"
        ? startExecution.isPending ? "Starting…" : "Start execution"
        : currentExecutionStatus === "running"
          ? nextFocusCase ? "Open next case" : "No cases remaining"
          : "Execution locked";
    const hierarchySearch = isSelectedExecutionTestCaseRun ? executionCaseSearch : executionSuiteSearch;
    const scopedAssignmentIds = activeModule && activeModule.id !== "unassigned-module"
      ? selectedExecution.module_assignments?.[activeModule.id] || []
      : activeSuite
        ? selectedExecution.suite_assignments?.[activeSuite.id] || []
        : [];
    const scopeAssignmentLevel = activeModule && activeModule.id !== "unassigned-module"
      ? "modules"
      : activeSuite
        ? "suites"
        : null;
    const scopeAssignmentId = activeModule && activeModule.id !== "unassigned-module"
      ? activeModule.id
      : activeSuite?.id || "";
    const scopeTitle = activeModule
      ? `Module: ${activeModule.name}`
      : activeSuite
        ? `Suite: ${activeSuite.name}`
        : isSelectedExecutionTestCaseRun ? "Direct test cases" : "All run cases";
    const scopeSubtitle = `${visibleCases.length} of ${scopedCases.length} case${scopedCases.length === 1 ? "" : "s"} shown`;

    const setActiveSuite = (suiteId: string) => {
      setFocusedSuiteId(suiteId);
      setFocusedExecutionModuleId("");
      setInspectedExecutionCaseId("");
      setExpandedExecutionSuiteIds((current) => current.includes(suiteId) ? current : [...current, suiteId]);
    };

    const inspectCase = (testCaseId: string) => {
      setInspectedExecutionCaseId(testCaseId);
    };

    return (
      <section className="execution-command-center execution-run-command-center" aria-labelledby="execution-command-title">
        <header className="execution-command-header">
          <div className="execution-command-identity">
            <button
              aria-label="Back to run library"
              className="execution-command-icon-button"
              onClick={closeExecutionDrilldown}
              title="Back to run library"
              type="button"
            >
              <IconArrowLeft aria-hidden="true" size={20} stroke={1.9} />
              <span>Back</span>
            </button>
            <span className="execution-command-mark" aria-hidden="true">
              <ExecutionRunIcon />
            </span>
            <div>
              <h1 id="execution-command-title">{selectedExecution.name || "Unnamed execution"}</h1>

            </div>
          </div>

          <StatusBadge value={currentExecutionStatus} />
        </header>

          <div className="execution-command-actions" aria-label="Execution actions">
            {canExportRunReports ? (<button className="execution-command-button" disabled={!canExportRunReports || htmlReportMutation.isPending} type="button" onClick={() => void handleOpenHtmlReport()}><IconExternalLink size={18} aria-hidden="true" /><span>{htmlReportMutation.isPending ? "Preparing report…" : "Detailed report"}</span></button>) : null}
            {canUpdateRuns ? (<button className="execution-command-button" disabled={!canUpdateRuns || isRunFinished(selectedExecution)} onClick={() => setEditingRunId(selectedExecution.id)} type="button"><IconPencil size={18} /><span>Edit run</span></button>) : null}
            <button
              className="execution-command-button is-primary"
              disabled={primaryActionDisabled}
              onClick={() => {
                if (currentExecutionStatus === "queued") {
                  void handleStartSelectedExecution();
                } else if (currentExecutionStatus === "running" && nextFocusCase) {
                  focusExecutionCase(nextFocusCase.id);
                }
              }}
              type="button"
            >
              <IconPlayerPlay aria-hidden="true" size={18} stroke={2} />
              <span>{primaryActionLabel}</span>
            </button>
            {isExecutionLiveViewEligible ? (
              <a
                className="execution-command-button"
                href={testEngineLiveViewUrl}
                rel="noreferrer"
                target="_blank"
              >
                <IconExternalLink aria-hidden="true" size={18} stroke={1.9} />
                <span>Live run</span>
              </a>
            ) : null}
            {canExecuteRuns ? (<button
              className="execution-command-button"
              disabled={!canExecuteRuns || rerunExecution.isPending}
              onClick={() => void handleRerunExecution(false)}
              type="button"
            >
              <IconRefresh aria-hidden="true" size={18} stroke={1.9} />
              <span>{rerunExecution.isPending ? "Preparing…" : "Rerun"}</span>
            </button>) : null}
            {canExportRunReports ? (<button
              className="execution-command-button"
              disabled={!canExportRunReports || downloadExecutionReport.isPending}
              onClick={() => void handleDownloadExecutionReport()}
              type="button"
            >
              <ExportIcon />
              <span>{downloadExecutionReport.isPending ? "Exporting…" : "PDF report"}</span>
            </button>) : null}
            {canShareRunReports ? (<button
              className="execution-command-button"
              disabled={!canShareRunReports || shareExecutionReport.isPending}
              onClick={handleOpenReportEmailModal}
              type="button"
            >
              <IconMail aria-hidden="true" size={18} stroke={1.9} />
              <span>Email</span>
            </button>) : null}
            {canReportBugs ? (<ReportBugSplitActionButton
              canUseAi={canUseAiBugTriage}
              className="execution-command-report-bug"
              disabled={!canReportBugs}
              onReportBug={() => handleReportSelectedExecutionIssue("run")}
              onReportBugWithAi={() => handleReportSelectedExecutionIssue("run", {}, "ai")}
            />) : null}
            {canExecuteRuns ? (<button
              className="execution-command-button"
              disabled={currentExecutionStatus !== "running" || !canExecuteRuns || completeExecution.isPending}
              onClick={() => void handleFinalizeExecution("complete")}
              type="button"
            >
              <IconCircleCheck aria-hidden="true" size={18} stroke={1.9} />
              <span>{completeExecution.isPending && executionFinalizeAction === "complete" ? "Completing…" : "Complete"}</span>
            </button>) : null}
            {canExecuteRuns ? (<button
              className="execution-command-button"
              disabled={!canExecuteRuns || !executionStatusCounts.failed || rerunExecution.isPending}
              onClick={() => void handleRerunExecution(true)}
              type="button"
            >
              <IconRefresh aria-hidden="true" size={18} stroke={1.9} />
              <span>Rerun failed</span>
            </button>) : null}
            {canExecuteRuns ? (<button
              className="execution-command-button is-danger"
              disabled={currentExecutionStatus !== "running" || !canExecuteRuns || completeExecution.isPending}
              onClick={() => void handleFinalizeExecution("abort")}
              type="button"
            >
              <IconCircleX aria-hidden="true" size={18} stroke={1.9} />
              <span>{completeExecution.isPending && executionFinalizeAction === "abort" ? "Aborting…" : "Abort run"}</span>
            </button>) : null}
          </div>


        <div className="execution-command-metrics" aria-label="Execution health">
          <EvidenceFlipCard
            key={`${selectedExecution.id}-results`}
            autoResetMs={0}
            resetOnChange={false}
            className="execution-run-metric-card execution-run-metric-card--results"
            label="Run results"
            value={selectedRunPassRate === null ? "—" : `${selectedRunPassRate}%`}
            caption={selectedRunFinalizedCount ? `${executionStatusCounts.passed} of ${selectedRunFinalizedCount} finalized instances passed` : "Pass rate available after the first finalized result"}
            tone={executionStatusCounts.failed ? "danger" : executionStatusCounts.blocked ? "warning" : selectedRunFinalizedCount ? "success" : "info"}
            frontAccessory={<RunResultChart counts={executionStatusCounts} total={executionProgress.totalCases} />}
            evidence={[
              `${executionStatusCounts.passed} passed · ${executionStatusCounts.failed} failed · ${executionStatusCounts.blocked} blocked.`,
              `${executionStatusCounts.running} running · ${executionStatusCounts.paused} paused · ${executionStatusCounts.queued + executionStatusCounts.pending} unexecuted.`,
              `${executionStatusCounts.skipped} N/A · ${executionStatusCounts.aborted} aborted · ${executionProgress.totalCases} total case instances.`,
              selectedRunPassRate === null ? "No finalized results yet; a pass rate is not available." : `Pass rate: ${executionStatusCounts.passed} passed ÷ ${selectedRunFinalizedCount} finalized × 100 = ${selectedRunPassRate}% (rounded).`,
              "Finalized results include passed, failed, blocked, N/A and aborted instances. Each data row counts separately."
            ]}
          />
          <EvidenceFlipCard
            key={`${selectedExecution.id}-progress`}
            autoResetMs={0}
            resetOnChange={false}
            className="execution-run-metric-card execution-run-metric-card--progress"
            label="Execution progress"
            value={`${selectedRunCompletionPercent}%`}
            caption={`${selectedRunFinalizedCount} of ${executionProgress.totalCases} finalized · ${remainingCaseCount} remaining`}
            tone={selectedRunCompletionPercent === 100 ? "success" : "info"}
            frontIcon={<IconActivity size={18} stroke={1.8} />}
            frontVisual={<span className="execution-run-progress-track"><span style={{ width: `${selectedRunCompletionPercent}%` }} /></span>}
            evidence={[
              `${selectedRunFinalizedCount} finalized of ${executionProgress.totalCases} case instances in this run.`,
              `${executionStatusCounts.running} running · ${executionStatusCounts.paused} paused · ${executionStatusCounts.queued + executionStatusCounts.pending} unexecuted · ${remainingCaseCount} awaiting an outcome.`,
              "Progress counts passed, failed, blocked, N/A and aborted results as finalized; it does not indicate that the run passed.",
              executionProgress.totalCases ? `Completion: ${selectedRunFinalizedCount} ÷ ${executionProgress.totalCases} × 100 = ${selectedRunCompletionPercent}% (rounded).` : "No case instances are available for this run."
            ]}
          />
          <EvidenceFlipCard
            key={`${selectedExecution.id}-duration`}
            autoResetMs={0}
            resetOnChange={false}
            className="execution-run-metric-card"
            label="Total duration"
            value={formatDuration(selectedExecutionDurationMs, "0s")}
            caption="Cumulative active time from case attempts"
            tone="info"
            frontIcon={<IconClock size={18} stroke={1.8} />}
            evidence={[
              selectedExecution.started_at ? `Started: ${formatExecutionTimestamp(selectedExecution.started_at)}.` : "This run has not recorded a start time.",
              selectedExecution.ended_at ? `Ended: ${formatExecutionTimestamp(selectedExecution.ended_at)}.` : "No finish time has been recorded.",
              averageCaseDurationMs === null ? "No timed case results are available for an estimate." : `Average recorded case duration: ${formatDuration(averageCaseDurationMs)} across ${timedResultCount} timed result${timedResultCount === 1 ? "" : "s"}.`,
              "Adds active case time across all attempts. Pauses and time spent browsing are excluded; previous attempts remain included."
            ]}
          />
          <EvidenceFlipCard
            key={`${selectedExecution.id}-defects`}
            autoResetMs={0}
            resetOnChange={false}
            className="execution-run-metric-card"
            label="Defects"
            value={runDefectCount ?? "—"}
            caption={runDefectCount === undefined ? "Defect count is not available" : "Unique defects linked to this run"}
            tone={runDefectCount ? "danger" : "info"}
            frontIcon={<IconBug size={18} stroke={1.8} />}
            evidence={[
              runDefectCount === undefined ? "The run response did not include a defect count." : `${runDefectCount} distinct defect reference${runDefectCount === 1 ? "" : "s"} recorded for this run.`,
              "A defect linked to multiple results in this run is counted once.",
              `${executionStatusCounts.failed} failed and ${executionStatusCounts.blocked} blocked case instances are recorded separately from linked defects.`,
              runDefectCount === 0 ? "No defects have been linked to this run. Unreported failures may still need review." : "Includes saved result, case and step defect links across this run's attempts."
            ]}
          />
        </div>

        <div className="execution-command-toolbar execution-run-insight-cards" aria-label="Run evidence and configuration">
          <EvidenceFlipCard
            key={`${selectedExecution.id}-stories`}
            autoResetMs={0}
            resetOnChange={false}
            className="execution-run-insight-card"
            label="Run impacted stories"
            value={`${runStories.failed}/${runStories.total}`}
            caption="Stories linked to failed cases / all stories in this run"
            frontIcon={<IconLink size={18} stroke={1.8} />}
            tone={runStories.failed ? "warning" : "success"}
            evidence={selectedExecutionImpactSummary.impactedRequirements.filter((story) => story.failedCases > 0).map((story) => `${story.title} · ${story.failedCases} failed case${story.failedCases === 1 ? "" : "s"}`).concat(selectedExecutionImpactSummary.failedRequirementCount ? [] : ["No stories linked to failed cases in the current results."])}
            actionLabel="Inspect failed cases"
            actionDisabled={!selectedExecutionImpactSummary.failedCases.some((item) => item.status === "failed")}
            onAction={() => { const first = selectedExecutionImpactSummary.failedCases.find((item) => item.status === "failed"); if (first) { if (first.suiteId) setFocusedSuiteId(first.suiteId); setFocusedExecutionModuleId(""); setInspectedExecutionCaseId(first.id); setExecutionCaseSearch("failed"); } }}
          />
          <EvidenceFlipCard
            key={`${selectedExecution.id}-readiness`}
            autoResetMs={0}
            resetOnChange={false}
            className="execution-run-insight-card"
            label="Evidence readiness"
            value={`${selectedRunEvidenceReadiness.score}%`}
            caption={selectedRunEvidenceReadiness.summary}
            frontIcon={<IconShieldCheck size={18} stroke={1.8} />}
            tone={selectedRunEvidenceReadiness.score >= 80 ? "success" : "warning"}
            evidence={[...selectedRunEvidenceReadiness.signals.map((signal) => `${signal.label}: ${signal.value}`), ...selectedRunEvidenceReadiness.gaps]}
            actionLabel="Open evidence"
            onAction={() => setIsRunEvidenceAnalysisOpen(true)}
          />
          <div className="execution-command-toolbar-item execution-run-config-card">
            <span>Run configuration</span>
            <RunContextLinks execution={selectedExecution} onOpen={setRunConfigurationResource} />
          </div>
        </div>

        <div className={isExecutionHierarchyCollapsed ? "execution-command-content is-hierarchy-collapsed" : "execution-command-content"}>
          <aside className="execution-command-hierarchy" aria-label="Test hierarchy">
            <div className="execution-command-pane-heading execution-hierarchy-heading">
              <div className="execution-hierarchy-heading-copy">
                <strong>Test hierarchy</strong>
                <span>{executionProgress.totalCases} case instances</span>
              </div>
              <button
                aria-controls="execution-hierarchy-content"
                aria-expanded={!isExecutionHierarchyCollapsed}
                aria-label={isExecutionHierarchyCollapsed ? "Expand test hierarchy" : "Collapse test hierarchy"}
                className="execution-hierarchy-toggle"
                onClick={() => setIsExecutionHierarchyCollapsed(current => !current)}
                title={isExecutionHierarchyCollapsed ? "Expand test hierarchy" : "Collapse test hierarchy"}
                type="button"
              >
                <IconChevronRight aria-hidden="true" size={20} stroke={1.9} />
              </button>
            </div>
            <div className="execution-hierarchy-body" hidden={isExecutionHierarchyCollapsed} id="execution-hierarchy-content">
            <label className="execution-command-search">
              <IconSearch aria-hidden="true" size={17} stroke={1.8} />
              <input
                aria-label="Filter test hierarchy"
                onChange={(event) => {
                  if (isSelectedExecutionTestCaseRun) {
                    setExecutionCaseSearch(event.target.value);
                  } else {
                    setExecutionSuiteSearch(event.target.value);
                  }
                }}
                placeholder="Filter hierarchy"
                value={hierarchySearch}
              />
              {hierarchySearch ? (
                <button
                  aria-label="Clear hierarchy search"
                  onClick={() => {
                    setExecutionSuiteSearch("");
                    setExecutionCaseSearch("");
                  }}
                  type="button"
                >
                  <IconX aria-hidden="true" size={15} stroke={1.8} />
                </button>
              ) : null}
            </label>

            <div className="execution-command-tree">
              <button
                aria-current={!activeSuite && !activeModule ? "true" : undefined}
                aria-label={`Run: ${selectedExecution.name || "Unnamed run"}`}
                className={`execution-command-tree-row execution-hierarchy-run-root${!activeSuite && !activeModule ? " is-active" : ""}`}
                onClick={() => { setFocusedSuiteId(""); setFocusedExecutionModuleId(""); setInspectedExecutionCaseId(""); }}
                title={runHierarchyCompletion.description}
                type="button"
              >
                <ExecutionRunIcon />
                <span><small className="execution-hierarchy-kind">Run Name</small><strong>{selectedExecution.name || "Unnamed run"}</strong><small>{executionCaseOrder.length} cases</small></span>
                <b className="execution-hierarchy-completion" title={runHierarchyCompletion.description}>{runHierarchyCompletion.percent}%</b>
              </button>
              <div className="execution-hierarchy-run-children">
              {isSelectedExecutionTestCaseRun ? (
                <section className="execution-command-tree-group">
                  <button
                    aria-label="Direct test cases"
                    className="execution-command-tree-row"
                    onClick={() => {
                      setFocusedExecutionModuleId("");
                      setInspectedExecutionCaseId("");
                    }}
                    title={runHierarchyCompletion.description}
                    type="button"
                  >
                    <IconFolder aria-hidden="true" size={18} stroke={1.8} />
                    <span><strong>Direct test cases</strong><small>{executionCaseOrder.length} cases</small></span>
                    <b className="execution-hierarchy-completion" title={runHierarchyCompletion.description}>{runHierarchyCompletion.percent}%</b>
                  </button>
                  <div className="execution-command-tree-children">
                    {moduleGroups.map((module) => {
                      const completion = scopeCompletion(module.cases);
                      return (
                      <button
                        aria-current={activeModule?.id === module.id ? "true" : undefined}
                        aria-label={`Module: ${module.name}`}
                        className={activeModule?.id === module.id ? "execution-command-tree-row is-active" : "execution-command-tree-row"}
                        key={module.id}
                        onClick={() => {
                          setFocusedExecutionModuleId(module.id);
                          setInspectedExecutionCaseId("");
                        }}
                        title={completion.description}
                        type="button"
                      >
                        <IconChevronRight aria-hidden="true" size={16} stroke={1.8} />
                        <span><small className="execution-hierarchy-kind">Module</small><strong>{module.name}</strong><small>{module.cases.length} cases</small></span>
                        <b className="execution-hierarchy-completion" title={completion.description}>{completion.percent}%</b>
                      </button>
                    );})}
                  </div>
                </section>
              ) : filteredExecutionSuites.length ? (
                filteredExecutionSuites.map((suite) => {
                  const suiteCases = displayCasesBySuiteId[suite.id] || [];
                  const suiteCompletion = scopeCompletion(suiteCases);
                  const suiteModules = Object.values(
                    suiteCases.reduce<Record<string, CommandModuleGroup>>((groups, testCase) => {
                      const moduleId = testCase.module_id || "unassigned-module";
                      groups[moduleId] = groups[moduleId] || {
                        id: moduleId,
                        name: testCase.module_name || "Unassigned module",
                        cases: []
                      };
                      groups[moduleId].cases.push(testCase);
                      return groups;
                    }, {})
                  );
                  const isExpanded = expandedExecutionSuiteIds.includes(suite.id);
                  const isActive = activeSuiteId === suite.id && !activeModule;

                  return (
                    <section className="execution-command-tree-group" key={suite.id}>
                      <div className={isActive ? "execution-command-tree-row is-active" : "execution-command-tree-row"}>
                        <button
                          aria-expanded={isExpanded}
                          aria-label={`${isExpanded ? "Collapse" : "Expand"} ${suite.name}`}
                          className="execution-command-tree-chevron"
                          onClick={() => toggleSuiteGroup(suite.id)}
                          type="button"
                        >
                          <IconChevronDown aria-hidden="true" className={isExpanded ? "" : "is-collapsed"} size={17} stroke={1.9} />
                        </button>
                        <button
                          aria-label={`Suite: ${suite.name}`}
                          className="execution-command-tree-main"
                          onClick={() => setActiveSuite(suite.id)}
                          title={suiteCompletion.description}
                          type="button"
                        >
                          <IconFolder aria-hidden="true" size={18} stroke={1.8} />
                          <span><small className="execution-hierarchy-kind">Suite</small><strong>{suite.name}</strong><small>{suiteCases.length} cases</small></span>
                          <b className="execution-hierarchy-completion" title={suiteCompletion.description}>{suiteCompletion.percent}%</b>
                        </button>
                      </div>
                      {isExpanded ? (
                        <div className="execution-command-tree-children">
                          {suiteModules.map((module) => {
                            const completion = scopeCompletion(module.cases);
                            return (
                            <button
                              aria-current={activeSuiteId === suite.id && activeModule?.id === module.id ? "true" : undefined}
                              aria-label={`Module: ${module.name}`}
                              className={activeSuiteId === suite.id && activeModule?.id === module.id ? "execution-command-tree-row is-active" : "execution-command-tree-row"}
                              key={module.id}
                              onClick={() => {
                                setFocusedSuiteId(suite.id);
                                setFocusedExecutionModuleId(module.id);
                                setInspectedExecutionCaseId("");
                              }}
                              title={completion.description}
                              type="button"
                            >
                              <IconChevronRight aria-hidden="true" size={16} stroke={1.8} />
                              <span><small className="execution-hierarchy-kind">Module</small><strong>{module.name}</strong><small>{module.cases.length} cases</small></span>
                              <b className="execution-hierarchy-completion" title={completion.description}>{completion.percent}%</b>
                            </button>
                          );})}
                        </div>
                      ) : null}
                    </section>
                  );
                })
              ) : (
                <div className="empty-state compact">No suites match the hierarchy filter.</div>
              )}
              </div>
            </div>

            <section className="execution-command-failure-analysis" aria-label="AI failure analysis">
            <AiFeatureComposer
              agentName="Failure Analyst"
              headerActions={<button aria-haspopup="dialog" className="ghost-button run-analyst-workflow-button" onClick={() => setIsRunWorkflowOpen(true)} type="button"><IconListDetails aria-hidden="true" size={15} />Workflow</button>}
              briefCollapsible
              briefItems={[
                { id: "context", kind: "context", label: "Run evidence", state: "ready", value: `${executionProgress.totalCases} instances · ${executionStatusCounts.failed} failed · ${executionStatusCounts.blocked} blocked` },
                { id: "output", kind: "output", label: "Output contract", state: "ready", value: "Editable verdict, clusters, risks, and next review sequence" },
                { id: "approval", kind: "approval", label: "Human gate", state: "ready", value: "Accept the reviewed summary for this session" }
              ]}
              contextLabel={`${executionProgress.totalCases} instances · ${executionStatusCounts.failed + executionStatusCounts.blocked} risks`}
              onContextClick={() => setIsRunEvidenceAnalysisOpen(true)}
              disabled={!canUseRunAi || !["completed", "failed"].includes(currentExecutionStatus)}
              mode={runAnalysisInteractionMode}
              onModeChange={setRunAnalysisInteractionMode}
              onPromptChange={setRunAnalysisInstruction}
              onSubmit={() => { setIsRunEvidenceAnalysisOpen(true); void handleRunExecutionAiAnalysis(); }}
              placeholder="Ask for a verdict, failure clustering, environment-noise separation, evidence gaps, or an executive summary."
              prompt={runAnalysisInstruction}
              running={isSelectedRunAnalysisPending}
              submitLabel={hasRecordedRunAnalysis ? "Refresh analysis" : "Analyze run"}
            />
              {canUseRunAi ? (<button className="execution-command-cluster-button" disabled={!canUseRunAi || !projectId || !["completed", "failed"].includes(currentExecutionStatus)} onClick={handlePreviewFailureClusters} type="button">
                View cluster insights
              </button>) : null}
            </section>
            </div>
          </aside>

          <main className="execution-command-cases">
            <div className="execution-command-cases-header">
              <div>
                <span>{activeModule ? "Focused module" : activeSuite ? "Focused suite" : "Execution scope"}</span>
                <h2>{scopeTitle}</h2>
                <p>{scopeSubtitle}</p>
              </div>
              <div className="execution-command-scope-actions">
                {scopeAssignmentLevel ? (
                  <div aria-busy={updateExecutionScopeAssignment.isPending} aria-label={scopeAssignmentLevel === "modules" ? "Module assignees" : "Suite assignees"} className="execution-scope-assignees" role="group">
                    <div className="execution-scope-assignees-label"><IconUser aria-hidden="true" size={15} /><strong>{scopeAssignmentLevel === "modules" ? "Module assignees" : "Suite assignees"}</strong>{updateExecutionScopeAssignment.isPending ? <span role="status">Saving…</span> : null}</div>
                    <MultiAssigneePicker
                    disabled={!canUpdateRuns || isExecutionLocked || updateExecutionScopeAssignment.isPending || scopeAssignmentId === "unassigned-module"}
                    emptyLabel="Select assignees"
                    onChange={(ids) => void handleScopeAssignmentChange(scopeAssignmentLevel, scopeAssignmentId, ids)}
                    options={assigneeOptions}
                    selectedIds={scopedAssignmentIds}
                  />
                  </div>
                ) : null}
                {canReportBugs ? (<ReportBugSplitActionButton
                  canUseAi={canUseAiBugTriage}
                  disabled={!canReportBugs || (activeModule?.id === "unassigned-module")}
                  onReportBug={() => activeModule && activeSuite
                    ? handleReportSelectedExecutionIssue("module", { suiteId: activeSuite.id, suiteName: activeSuite.name, moduleId: activeModule.id, moduleName: activeModule.name })
                    : activeSuite
                      ? handleReportSelectedExecutionIssue("suite", { suiteId: activeSuite.id, suiteName: activeSuite.name })
                      : handleReportSelectedExecutionIssue("run")}
                  onReportBugWithAi={() => activeModule && activeSuite
                    ? handleReportSelectedExecutionIssue("module", { suiteId: activeSuite.id, suiteName: activeSuite.name, moduleId: activeModule.id, moduleName: activeModule.name }, "ai")
                    : activeSuite
                      ? handleReportSelectedExecutionIssue("suite", { suiteId: activeSuite.id, suiteName: activeSuite.name }, "ai")
                      : handleReportSelectedExecutionIssue("run", {}, "ai")}
                />) : null}
                {activeSuite ? (
                  <>
                    {canExecuteRuns && canManageRunResults ? (<button
                      className="execution-command-scope-button"
                      disabled={!canExecuteRuns || !canManageRunResults || !isExecutionStarted || isExecutionLocked}
                      onClick={() => void handleSuiteBulkStatus(activeSuite.id, "passed")}
                      type="button"
                    >
                      <IconCircleCheck aria-hidden="true" size={17} stroke={1.9} />
                      Suite pass
                    </button>) : null}
                    {canExecuteRuns && canManageRunResults ? (<button
                      className="execution-command-scope-button is-danger"
                      disabled={!canExecuteRuns || !canManageRunResults || !isExecutionStarted || isExecutionLocked}
                      onClick={() => void handleSuiteBulkStatus(activeSuite.id, "failed")}
                      type="button"
                    >
                      <IconCircleX aria-hidden="true" size={17} stroke={1.9} />
                      Suite fail
                    </button>) : null}
                  </>
                ) : null}
              </div>
            </div>

            <div className="execution-command-case-toolbar">
              <label className="execution-command-search">
                <IconSearch aria-hidden="true" size={17} stroke={1.8} />
                <input
                  aria-label="Search cases in focused scope"
                  onChange={(event) => setExecutionCaseSearch(event.target.value)}
                  placeholder="Search case ID, title, status, module…"
                  value={executionCaseSearch}
                />
                {executionCaseSearch ? (
                  <button aria-label="Clear case search" onClick={() => setExecutionCaseSearch("")} type="button">
                    <IconX aria-hidden="true" size={15} stroke={1.8} />
                  </button>
                ) : null}
              </label>
              <CatalogViewToggle onChange={setExecutionCaseCatalogViewMode} value={executionCaseCatalogViewMode} />
            </div>

            <div
              className={executionCaseCatalogViewMode === "tile"
                ? "execution-command-case-list is-tile"
                : "execution-command-case-list is-list"}
              role="list"
            >
              {visibleCases.map((testCase) => {
                const status = caseDerivedStatus(testCase);
                const result = resultByCaseId[testCase.id] || null;
                const isInspected = inspectedCase?.id === testCase.id;

                return (
                  <article
                    className={["execution-command-case-row", isInspected ? "is-inspected" : "", `status-${status}`].filter(Boolean).join(" ")}
                    key={`${testCase.suite_id || "direct"}-${testCase.module_id || "unassigned"}-${testCase.id}`}
                    role="listitem"
                  >
                    <button
                      aria-label={`Inspect ${testCase.title}`}
                      className="execution-command-case-inspect"
                      onClick={() => inspectCase(testCase.id)}
                      type="button"
                    >
                      <StatusBadge value={status} />
                      <div className="execution-command-case-copy">
                        <div>
                          <strong title={testCase.title}>{testCase.title}</strong>
                        </div>
                        <span>
                          {result?.error
                            || richTextToPlainText(testCase.description)
                            || `${testCase.module_name || "Unassigned module"} · ${testCase.suite_name || "Direct run"}`}
                        </span>
                        {(result?.external_references?.length || result?.defects?.length) ? (
                          <small>
                            {[...(result?.defects || []), ...(result?.external_references || [])].slice(0, 3).join(" · ")}
                          </small>
                        ) : null}
                      </div>
                      <div className="execution-command-case-facts">
                        <span>P{testCase.priority || 3}</span>
                        <span>{(stepsByCaseId[testCase.id] || []).length} steps</span>
                        <span>{formatDuration(resolveExecutionCaseDurationMs(testCase), DEFAULT_DURATION_LABEL)}</span>
                      </div>
                    </button>
                    <button
                      aria-label={`Open ${testCase.title} case workspace`}
                      className="execution-command-open-case"
                      onClick={() => focusExecutionCase(testCase.id)}
                      title="Open case workspace"
                      type="button"
                    >
                      <IconArrowRight aria-hidden="true" size={18} stroke={1.9} />
                    </button>
                  </article>
                );
              })}
              {!visibleCases.length ? (
                <div className="empty-state compact">
                  {executionCaseSearch.trim() ? "No cases match the current search." : "No cases are available in this scope."}
                </div>
              ) : null}
            </div>
          </main>

          <aside className="execution-command-analysis" aria-label="Run analysis workspace">
            <div className="execution-command-pane-heading">
              <div>
                <IconShieldCheck aria-hidden="true" size={18} stroke={1.9} />
                <strong>Run analysis workspace</strong>
              </div>
              <StatusBadge value={currentExecutionStatus} />
            </div>



            <section className="execution-command-feed">
              <div className="execution-command-section-title">
                <IconActivity aria-hidden="true" size={18} stroke={1.9} />
                <strong>Live feed</strong>
              </div>
              <div>
                {recentActivity.map(({ testCase, result }) => (
                  <button key={`${testCase.id}-${result?.id}`} onClick={() => inspectCase(testCase.id)} type="button">
                    <span className={`execution-command-feed-dot status-${result?.status || "queued"}`} />
                    <span>
                      <strong title={testCase.title}>{testCase.title}</strong>
                      <small>{formatExecutionTimestamp(result?.created_at, "Activity recorded")}</small>
                    </span>
                    <StatusBadge value={result?.status || "queued"} />
                  </button>
                ))}
                {!recentActivity.length ? <small>No recorded result activity yet.</small> : null}
              </div>
            </section>

            <section className="execution-command-inspector">
              <div className="execution-command-section-title">
                <IconAlertTriangle aria-hidden="true" size={18} stroke={1.9} />
                <strong>{inspectedCase && ["failed", "blocked"].includes(caseDerivedStatus(inspectedCase)) ? "Failure inspector" : "Case inspector"}</strong>
              </div>
              {inspectedCase ? (
                <article className="execution-command-inspector-card">
                  <div className="execution-command-inspector-head">
                    <div>
                      <strong title={inspectedCase.title}>{inspectedCase.title}</strong>
                    </div>
                    <StatusBadge value={caseDerivedStatus(inspectedCase)} />
                  </div>
                  <div className="execution-command-log-line">
                    <span>{inspectedResult?.error || "No failure message recorded for this case."}</span>
                  </div>
                  {inspectedResult?.logs ? (
                    <ExecutionStructuredLogSummary logsJson={inspectedResult.logs} />
                  ) : (
                    <small>No structured runtime trace recorded.</small>
                  )}
                  {inspectedEvidence && inspectedEvidenceStep ? (
                    (canViewRunEvidence ? (<button
                      className="execution-command-evidence-preview"
                      disabled={!canViewRunEvidence || openingEvidenceStepId === inspectedEvidenceStep.id}
                      onClick={() => void openExecutionEvidence(inspectedEvidenceStep, inspectedEvidence)}
                      type="button"
                    >
                      {inspectedEvidence.dataUrl && evidenceMimeType(inspectedEvidence).startsWith("image/") ? (
                        <img alt="" src={inspectedEvidence.dataUrl} />
                      ) : (
                        <IconPhoto aria-hidden="true" size={32} stroke={1.6} />
                      )}
                      <span>
                        <strong>{inspectedEvidence.fileName || "Captured run evidence"}</strong>
                        <small>{openingEvidenceStepId === inspectedEvidenceStep.id ? "Opening…" : `View Step ${inspectedEvidenceStep.step_order} evidence`}</small>
                      </span>
                    </button>) : null)
                  ) : (
                    <div className="execution-command-no-evidence">
                      <IconPhoto aria-hidden="true" size={24} stroke={1.6} />
                      <span>No media evidence attached to this case.</span>
                    </div>
                  )}
                  <div className="execution-command-inspector-actions">
                    <button onClick={() => focusExecutionCase(inspectedCase.id)} type="button">
                      Open case
                      <IconArrowRight aria-hidden="true" size={16} stroke={1.9} />
                    </button>
                    {canReportBugs ? (<ReportBugSplitActionButton
                      canUseAi={canUseAiBugTriage}
                      disabled={!canReportBugs}
                      onReportBug={() => handleReportSelectedExecutionIssue("case", { testCaseId: inspectedCase.id })}
                      onReportBugWithAi={() => handleReportSelectedExecutionIssue("case", { testCaseId: inspectedCase.id }, "ai")}
                    />) : null}
                  </div>
                </article>
              ) : (
                <div className="empty-state compact">No cases are available to inspect.</div>
              )}
            </section>





          </aside>
        </div>

        <footer className="execution-command-footer">
          <span className={currentExecutionStatus === "running" ? "is-live" : ""}>
            <i aria-hidden="true" />
            {currentExecutionStatus === "running" ? "Execution polling active" : "Run snapshot preserved"}
          </span>
          <span>{executionResultsWithTiming} timed result{executionResultsWithTiming === 1 ? "" : "s"} · {executionProgress.totalCases} case instances · {selectedExecutionSuiteIds.length} suites</span>
        </footer>
      </section>
    );
  };
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
            {canCreateSchedules ? (<button
              className="execution-command-button"
              disabled={!canCreateSchedules}
              onClick={openCreateScheduleBuilder}
              type="button"
            >
              <AddIcon />
              <span>New schedule</span>
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
        activeExecutionStage === "case" ? "page-content--workspace-focus" : "",
        (selectedExecution && activeExecutionStage !== "case") || selectedSchedule ? "page-content--execution-command-center" : ""
      ].filter(Boolean).join(" ")}
    >
      {confirmationDialog}
      {showExecutionListHeader ? (
        <>
          <PageHeader
            eyebrow="Test Runs"
            title={
              testRunsView === "suite-runs"
                  ? "Suite Runs"
                  : testRunsView === "local-runs"
                    ? "Local Runs"
                  : testRunsView === "scheduled-runs"
                    ? "Scheduled Runs"
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
          <Panel
            className="execution-panel execution-panel--list"
            title={runLibraryTitle}
            subtitle={runLibrarySubtitle}
          >
            <div className="design-list-toolbar catalog-command-toolbar executions-list-toolbar">
              <div className="catalog-toolbar-discovery" aria-label="Run views, search, and selection">
                <CatalogViewToggle onChange={handleCatalogViewModeChange} value={catalogViewMode} />
                <CatalogSearchFilter
                activeFilterCount={isExecutionRunsView(testRunsView) ? activeExecutionFilterCount : 0}
                ariaLabel={runLibrarySearchPlaceholder}
                onChange={handleRunLibrarySearchChange}
                placeholder={runLibrarySearchPlaceholder}
                subtitle={runLibrarySearchSubtitle}
                title={runLibrarySearchTitle}
                type="search"
                value={executionSearch}
              >
                <div className="catalog-filter-grid">
                  {isExecutionRunsView(testRunsView) ? (
                  <label className="catalog-filter-field">
                    <span>Status</span>
                    <select
                      value={executionStatusFilter}
                      onChange={(event) => setExecutionStatusFilter(event.target.value as ExecutionStatus | "all")}
                    >
                      <option value="all">All statuses</option>
                      {executionStatusOptions.map((status) => (
                        <option key={status} value={status}>
                          {executionStatusLabel(status)}
                        </option>
                      ))}
                    </select>
                  </label>
                  ) : null}

                  {isExecutionRunsView(testRunsView) ? (
                  <label className="catalog-filter-field">
                    <span>Defects</span>
                    <select
                      value={executionIssueFilter}
                      onChange={(event) => setExecutionIssueFilter(event.target.value as ExecutionIssueFilter)}
                    >
                      <option value="all">All runs</option>
                      <option value="with-issues">With linked defects</option>
                      <option value="clean">No linked defects</option>
                    </select>
                  </label>
                  ) : null}

                  {isExecutionRunsView(testRunsView) ? (
                  <label className="catalog-filter-field">
                    <span>Evidence activity</span>
                    <select
                      value={executionEvidenceFilter}
                      onChange={(event) => setExecutionEvidenceFilter(event.target.value as ExecutionEvidenceFilter)}
                    >
                      <option value="all">All runs</option>
                      <option value="with-evidence">Media evidence attached</option>
                      <option value="no-evidence">No evidence yet</option>
                    </select>
                  </label>
                  ) : null}

                  <div className="catalog-filter-actions">
                    <button
                      className="ghost-button"
                      disabled={!activeExecutionFilterCount}
                      onClick={() => {
                        setExecutionStatusFilter("all");
                        setExecutionIssueFilter("all");
                        setExecutionEvidenceFilter("all");
                      }}
                      type="button"
                    >
                      Clear filters
                    </button>
                  </div>
                </div>
                </CatalogSearchFilter>
                <CatalogSelectionControls
                  allSelected={areAllFilteredRunLibraryItemsSelected}
                  canSelectAll={Boolean(visibleRunLibraryIds.length)}
                  onClear={() => {
                    if (isExecutionRunsView(testRunsView)) {
                      setSelectedActionExecutionIds([]);
                    } else if (testRunsView === "scheduled-runs") {
                      setSelectedActionScheduleIds([]);
                    } else {
                      setSelectedActionOperationIds([]);
                    }
                  }}
                  onSelectAll={() => {
                  if (isExecutionRunsView(testRunsView)) {
                    setSelectedActionExecutionIds((current) => Array.from(new Set([...current, ...visibleRunLibraryIds])));
                  } else if (testRunsView === "scheduled-runs") {
                    setSelectedActionScheduleIds((current) => Array.from(new Set([...current, ...visibleRunLibraryIds])));
                  } else {
                    setSelectedActionOperationIds((current) => Array.from(new Set([...current, ...visibleRunLibraryIds])));
                  }
                  }}
                  selectedCount={selectedRunLibraryActionIds.length}
                />
                {isExecutionRunsView(testRunsView) ? (
                  <button
                    aria-label="Edit selected run"
                    className="ghost-button"
                    disabled={!canEditSelectedRun}
                    onClick={() => { if (canEditSelectedRun && runSelectedForEditing) setEditingRunId(runSelectedForEditing.id); }}
                    title={!runSelectedForEditing ? "Select one run to edit" : isRunFinished(runSelectedForEditing) ? "Finished runs cannot be edited" : !canUpdateRuns ? "Permission required to edit runs" : `Edit ${runSelectedForEditing.name || "selected run"}`}
                    type="button"
                  ><IconPencil aria-hidden="true" size={16} />Edit Run</button>
                ) : null}
              </div>
              {testRunsView !== "batch-process" ? (
                <div className="catalog-toolbar-actions executions-run-actions" aria-label="Run actions">
                  {canCreateSchedules ? (<button
                    className="ghost-button"
                    disabled={!canCreateSchedules}
                    onClick={openCreateScheduleBuilder}
                    type="button"
                  >
                    <CalendarIcon />
                    Schedule Run
                  </button>) : null}
                  <CreateRunActionButton
                    projectId={projectId}
                    source="TEST_RUNS"
                    onCreateManualRun={() => openExecutionBuilder("manual")}
                    onCreateLocalRun={() => openExecutionBuilder("local")}
                    onCreateRemoteRun={() => openExecutionBuilder("remote")}
                  />
                </div>
              ) : null}
            </div>

            {testRunsView === "scheduled-runs" && !canViewSchedules ? (
              <div className="empty-state compact">Permission required: schedule.view.</div>
            ) : null}

            {(isExecutionRunsView(testRunsView) ? executionsQuery.isLoading : testRunsView === "scheduled-runs" ? executionSchedulesQuery.isLoading : workspaceTransactionsQuery.isLoading) ? (
              <TileCardSkeletonGrid />
            ) : null}

            {!(isExecutionRunsView(testRunsView) ? executionsQuery.isLoading : testRunsView === "scheduled-runs" ? executionSchedulesQuery.isLoading : workspaceTransactionsQuery.isLoading) ? (
              <div className={catalogViewMode === "tile" ? `tile-browser-grid execution-run-tile-grid${testRunsView === "batch-process" ? " batch-process-browser-grid" : ""}` : ""}>
                {isExecutionRunsView(testRunsView) && catalogViewMode === "tile"
                  ? activeExecutionCatalogRows.map((execution) => (
                      <ExecutionListCard
                        key={execution.id}
                        canEdit={canUpdateRuns && !isRunFinished(execution)}
                        onEdit={() => setEditingRunId(execution.id)}
                        execution={execution}
                        isActive={selectedExecution?.id === execution.id}
                        isSelected={selectedActionExecutionIds.includes(execution.id)}
                        liveNow={liveNow}
                        onSelect={() => focusExecution(execution.id)}
                        onToggleSelected={() =>
                          setSelectedActionExecutionIds((current) =>
                            current.includes(execution.id)
                              ? current.filter((id) => id !== execution.id)
                              : [...current, execution.id]
                          )
                        }
                        impactSummary={executionImpactSummaryById[execution.id] || EMPTY_EXECUTION_RUN_IMPACT_SUMMARY}
                        summary={executionSummaryById[execution.id] || EMPTY_EXECUTION_RUN_SUMMARY}
                      />
                    ))
                  : null}
                {testRunsView === "scheduled-runs" && catalogViewMode === "tile"
                  ? filteredSchedules.map((schedule) => (
                      <ExecutionScheduleCard
                        key={schedule.id}
                        isActive={selectedSchedule?.id === schedule.id}
                        isSelected={selectedActionScheduleIds.includes(schedule.id)}
                        onSelect={() => focusExecutionSchedule(schedule.id)}
                        onToggleSelected={() =>
                          setSelectedActionScheduleIds((current) =>
                            current.includes(schedule.id)
                              ? current.filter((id) => id !== schedule.id)
                              : [...current, schedule.id]
                          )
                        }
                        liveNow={liveNow}
                        resolvedCaseCount={new Set([
                          ...(schedule.test_case_ids || []),
                          ...scopeSuites
                            .filter((suite) => schedule.suite_ids.includes(suite.id))
                            .flatMap((suite) => suite.test_case_ids || [])
                        ]).size}
                        schedule={schedule}
                      />
                    ))
                  : null}
                {testRunsView === "batch-process" && catalogViewMode === "tile"
                  ? filteredWorkspaceTransactions.map((transaction) => (
                      <WorkspaceTransactionCard
                        appTypeNameById={appTypeNameById}
                        isActive={selectedWorkspaceTransaction?.id === transaction.id}
                        isSelected={selectedActionOperationIds.includes(transaction.id)}
                        key={transaction.id}
                        onSelect={() => openWorkspaceTransactionDetail(transaction.id)}
                        onToggleSelected={() =>
                          setSelectedActionOperationIds((current) =>
                            current.includes(transaction.id)
                              ? current.filter((id) => id !== transaction.id)
                              : [...current, transaction.id]
                          )
                        }
                        projectNameById={projectNameById}
                        transaction={transaction}
                      />
                    ))
                  : null}
                {isExecutionRunsView(testRunsView) && catalogViewMode === "list" ? (
                  <DataTable
                    columns={executionListColumns}
                    emptyMessage="No runs created yet."
                    getRowClassName={(execution) => (selectedExecution?.id === execution.id ? "is-active-row" : "")}
                    getRowKey={(execution) => execution.id}
                    onRowClick={(execution) => focusExecution(execution.id)}
                    renderRowActions={renderExecutionRowActions}
                    rows={activeExecutionCatalogRows}
                    enableRowSelection
                    selectedRowKeys={selectedActionExecutionIds}
                    onSelectedRowKeysChange={setSelectedActionExecutionIds}
                    storageKey="hellotest:executions:list-columns"
                  />
                ) : null}
                {testRunsView === "scheduled-runs" && catalogViewMode === "list" && canViewSchedules ? (
                  <DataTable
                    columns={executionScheduleListColumns}
                    emptyMessage="No schedules created yet."
                    getRowClassName={(schedule) => (selectedSchedule?.id === schedule.id ? "is-active-row" : "")}
                    getRowKey={(schedule) => schedule.id}
                    onRowClick={(schedule) => focusExecutionSchedule(schedule.id)}
                    renderRowActions={renderExecutionScheduleRowActions}
                    rows={filteredSchedules}
                    storageKey="hellotest:execution-schedules:list-columns"
                  />
                ) : null}
                {testRunsView === "batch-process" && catalogViewMode === "list" ? (
                  <DataTable
                    columns={operationListColumns}
                    emptyMessage="No batch process records have been recorded yet."
                    getRowClassName={(transaction) => (selectedWorkspaceTransaction?.id === transaction.id ? "is-active-row" : "")}
                    getRowKey={(transaction) => transaction.id}
                    onRowClick={(transaction) => openWorkspaceTransactionDetail(transaction.id)}
                    renderRowActions={renderOperationRowActions}
                    rows={filteredWorkspaceTransactions}
                    storageKey="hellotest:operations:list-columns"
                  />
                ) : null}
                {catalogViewMode === "tile" && isExecutionRunsView(testRunsView) && !activeExecutionCatalogRows.length ? (
                  <div className="empty-state compact">
                    {testRunsView === "local-runs"
                        ? "No local runs created yet."
                        : "No suite or individual case runs created yet."}
                  </div>
                ) : null}
                {catalogViewMode === "tile" && testRunsView === "scheduled-runs" && canViewSchedules && !filteredSchedules.length ? <div className="empty-state compact">No schedules created yet.</div> : null}
                {catalogViewMode === "tile" && testRunsView === "batch-process" && !filteredWorkspaceTransactions.length ? <div className="empty-state compact">No batch process records have been recorded for this scope yet.</div> : null}
              </div>
            ) : null}
          </Panel>
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
                      <span>New schedule</span>
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
                      <span>Create schedule</span>
                    </button>
                  </div>
                </div>
              )}
            </Panel>
          ) : activeExecutionStage === "case" ? (
            <section className="execution-case-run-workspace" aria-labelledby="execution-case-run-title">
              {selectedExecution && selectedExecutionCase ? (
                <>
                  <header className="execution-case-run-header">
                    <div className="execution-case-run-identity">
                      <button
                        aria-label={`Back to ${focusedExecutionSuite?.name || "run cases"}`}
                        className="execution-case-run-back"
                        onClick={closeCaseDrilldown}
                        title={`Back to ${focusedExecutionSuite?.name || "run cases"}`}
                        type="button"
                      >
                        <IconArrowLeft aria-hidden="true" size={20} stroke={1.9} />
                        <span>Back</span>
                      </button>

                      <span className="execution-case-run-identity-icon"><ExecutionRunIcon /></span>
                      <div className="execution-case-run-title-copy">
                        <span className="execution-case-run-eyebrow">Test case execution</span>
                        <div className="execution-case-run-title-row">
                          <h1 id="execution-case-run-title">{selectedExecutionCaseReadableTitle || selectedExecutionCase.title}</h1>
                        </div>
                        <p>{selectedExecutionCaseReadableDescription || "Execute this case step by step and capture evidence as you go."}</p>
                        <span>
                          {selectedExecution.name || "Selected run"}
                          {selectedExecutionCase.suite_name ? ` · ${selectedExecutionCase.suite_name}` : ""}
                          {selectedExecutionCase.module_name ? ` · ${selectedExecutionCase.module_name}` : ""}
                          {hasSelectedCaseTestData
                            ? ` · ${selectedExecutionCaseInstance?.test_data_set_name || "Data Set"} row ${(selectedExecutionCaseInstance?.data_set_iteration_index ?? 0) + 1} of ${selectedExecutionCase.data_set_instances.length}`
                            : ""}
                        </span>
                      </div>
                    </div>

                    <div className="execution-case-run-header-actions" aria-label="Case run actions">
                      {canReportBugs ? (<ReportBugSplitActionButton
                        canUseAi={canUseAiBugTriage}
                        className="execution-case-run-report-bug"
                        disabled={!selectedExecution || !canReportBugs}
                        onReportBug={() => handleReportSelectedExecutionIssue(selectedExecutionCase ? "case" : "run")}
                        onReportBugWithAi={() => handleReportSelectedExecutionIssue(selectedExecutionCase ? "case" : "run", {}, "ai")}
                      />) : null}
                      <details className="execution-case-more-actions" onBlur={(event) => {
                        if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) event.currentTarget.open = false;
                      }} onKeyDown={(event) => {
                        if (event.key === "Escape") {
                          event.currentTarget.open = false;
                          event.currentTarget.querySelector("summary")?.focus();
                          event.stopPropagation();
                        }
                      }}>
                        <summary><IconDots aria-hidden="true" size={18} /><span>More actions</span><IconChevronDown aria-hidden="true" size={14} /></summary>
                        <div className="execution-case-more-menu" onClick={(event) => {
                          if ((event.target as HTMLElement).closest("button:not(:disabled), a")) {
                            const disclosure = event.currentTarget.closest("details");
                            if (disclosure) disclosure.open = false;
                          }
                        }}>
                      {canExportRunReports ? (<button
                        className="execution-case-run-button"
                        disabled={!canExportRunReports || downloadExecutionCaseReport.isPending}
                        onClick={() => void handleDownloadExecutionCaseReport()}
                        type="button"
                      >
                        <IconFileReport aria-hidden="true" size={18} stroke={1.9} />
                        <span>{downloadExecutionCaseReport.isPending ? "Exporting…" : "Case PDF"}</span>
                      </button>) : null}
                      {canShareRunReports ? (<button
                        className="execution-case-run-button"
                        disabled={!canShareRunReports || shareExecutionCaseReport.isPending}
                        onClick={handleOpenCaseReportEmailModal}
                        type="button"
                      >
                        <IconMail aria-hidden="true" size={18} stroke={1.9} />
                        <span>Email report</span>
                      </button>) : null}
                      {canViewRunAutomationCode ? (
                        <button
                          className="execution-case-run-button"
                          disabled={!hasSelectedStepAutomationCode}
                          onClick={() => {
                            setActiveTab("overview");
                            setExecutionStepViewMode("automation");
                          }}
                          type="button"
                        >
                          <IconCode aria-hidden="true" size={18} stroke={1.9} />
                          <span>Coded steps</span>
                        </button>
                      ) : null}
                      {isExecutionLiveViewEligible ? (
                        <a
                          className="execution-case-run-button"
                          href={testEngineLiveViewUrl}
                          rel="noreferrer"
                          target="_blank"
                          title="View live browser session"
                        >
                          <IconExternalLink aria-hidden="true" size={18} stroke={1.9} />
                          <span>Live run</span>
                        </a>
                      ) : null}
                      {currentExecutionStatus === "running" ? (
                        (canExecuteRuns ? (<button
                          className="execution-case-run-button is-danger"
                          disabled={completeExecution.isPending || startExecution.isPending || !canExecuteRuns}
                          onClick={() => void handleFinalizeExecution("abort")}
                          type="button"
                        >
                          <IconCircleX aria-hidden="true" size={18} stroke={1.9} />
                          <span>{completeExecution.isPending && executionFinalizeAction === "abort" ? "Aborting…" : "Abort run"}</span>
                        </button>) : null)
                      ) : null}
                      {currentExecutionStatus === "queued" ? (
                        (canExecuteRuns ? (<button
                          className="execution-case-run-button is-primary"
                          disabled={startExecution.isPending || completeExecution.isPending || !canExecuteRuns}
                          onClick={() => void handleStartSelectedExecution()}
                          type="button"
                        >
                          <IconPlayerPlay aria-hidden="true" size={18} stroke={2} />
                          <span>{startExecution.isPending ? "Starting…" : "Start run"}</span>
                        </button>) : null)
                      ) : currentExecutionStatus === "running" ? (
                        (canExecuteRuns ? (<button
                          className="execution-case-run-button is-primary"
                          disabled={completeExecution.isPending || startExecution.isPending || !canExecuteRuns}
                          onClick={() => void handleFinalizeExecution("complete")}
                          type="button"
                        >
                          <IconCircleCheck aria-hidden="true" size={18} stroke={2} />
                          <span>{completeExecution.isPending && executionFinalizeAction === "complete" ? "Completing…" : "Complete run"}</span>
                        </button>) : null)
                      ) : (
                        <button
                          className="execution-case-run-button is-primary"
                          disabled={!selectedExecution || rerunExecution.isPending || startExecution.isPending || completeExecution.isPending}
                          onClick={() => void handleRerunExecution(false)}
                          type="button"
                        >
                          <IconRefresh aria-hidden="true" size={18} stroke={2} />
                          <span>{rerunExecution.isPending ? "Preparing…" : "Rerun"}</span>
                        </button>
                      )}
                        </div>
                      </details>
                    </div>
                  </header>

                  <div className="execution-case-lifecycle" data-status={selectedCaseStatusLabel} aria-label="Case execution controls">
                    <div className="execution-case-clock" aria-label="Current attempt active time" title="Active time for this attempt. Earlier attempts remain included in the run total."><IconClock size={19} aria-hidden="true" /><span className="execution-case-clock-label">Active time</span><strong>{formatDuration(selectedCaseDurationMs, "0s")}</strong><StatusBadge value={selectedCaseStatusLabel === "running" ? "in_progress" : selectedCaseStatusLabel === "queued" ? "pending" : selectedCaseStatusLabel} /></div>
                    <div className="execution-case-lifecycle-actions">
                      {canExecuteRuns && canManageRunResults ? (<button className="execution-case-run-button is-primary" disabled={!canExecuteRuns || !canManageRunResults || !isExecutionStarted || isExecutionLocked || Boolean(caseLifecycleAction)} onClick={() => void handleCaseLifecycle(isSelectedCaseTimerActive ? "pause" : selectedCaseStatusLabel === "paused" ? "resume" : "start")} type="button">
                        {isSelectedCaseTimerActive ? <IconPlayerPause size={17} /> : <IconPlayerPlay size={17} />}
                        <span>{caseLifecycleAction ? "Saving…" : isSelectedCaseTimerActive ? "Pause case" : selectedCaseStatusLabel === "paused" ? "Resume case" : ["queued", "pending", "running"].includes(selectedCaseStatusLabel) ? "Start case" : "Start new attempt"}</span>
                      </button>) : null}
                      <label className="execution-case-outcome-control"><span className="sr-only">Set case outcome</span>
                        <select aria-label="Set case outcome" value="" disabled={!canExecuteRuns || !canManageRunResults || !isExecutionStarted || isExecutionLocked || Boolean(caseLifecycleAction)} onChange={(event) => { if (event.target.value) void handleCaseLifecycle(event.target.value as ExecutionCaseLifecycleAction); }}>
                          <option value="" disabled>Set outcome…</option>
                          <option value="block">Blocked</option><option value="skip">N/A</option><option value="abort">Aborted</option><option value="reset">Unexecuted</option>
                        </select>
                      </label>
                    </div>
                  </div>

                  <section className="execution-case-context" aria-label="Case run context">
                    <div className="execution-case-context-heading"><strong>Run context</strong><span>Values frozen for this run</span></div>
                    <RunContextLinks execution={selectedExecution} dataSet={selectedExecutionCaseSnapshot?.test_data_set_snapshot} dataSetName={selectedExecutionCaseInstance?.test_data_set_name} appTypeKind={selectedExecutionAppTypeKind} showTarget onOpen={setRunConfigurationResource} />
                    {hasSelectedCaseTestData ? <label className="execution-case-row-selector">
                      <span>Active data row</span>
                      <select aria-label="Active data row" value={selectedExecutionCaseInstance?.instance_key || ""} onChange={(event) => focusExecutionCase(selectedExecutionCase.id, selectedExecution.id, event.target.value)}>
                        {selectedExecutionCase.data_set_instances.map((instance) => <option key={instance.instance_key} value={instance.instance_key}>
                          Row {(instance.data_set_iteration_index ?? 0) + 1} of {selectedExecutionCase.data_set_instances.length} · {BOARD_STATUS_META[instanceDerivedStatus(instance)]?.label || "Unexecuted"}
                        </option>)}
                      </select>
                      <small>{selectedExecutionCaseInstance?.data_set_source === "run" ? "Run data overrides case data" : "Test case data"} · Each row has its own outcome and clock</small>
                    </label> : null}
                    <CaseRunParameterContext collapsible execution={selectedExecution} caseSnapshot={selectedExecutionCaseSnapshot} steps={selectedSteps} caseTitle={selectedExecutionCase.title} dataSetRow={selectedExecutionCaseInstance?.data_set_row_snapshot} rowIndex={selectedExecutionCaseInstance?.data_set_iteration_index} capturedValues={combineStepParameterValues(suiteExecutionOutputParameterValues, executionOutputParameterValues)} />

                  </section>

                  <div className="execution-case-run-tabs">
                    <SubnavTabs
                      ariaLabel="Case run sections"
                      items={[
                        { value: "overview", label: "Overview" },
                        { value: "history", label: "History" },
                        { value: "logs", label: "Logs" },
                        { value: "evidence", label: "Attachments" }
                      ]}
                      onChange={setActiveTab}
                      value={activeTab}
                    />
                  </div>

                  <div className={activeTab === "overview" ? "execution-case-run-body" : "execution-case-run-body is-tab-focused"}>
                    <main className="execution-case-run-primary">


                      {activeTab === "overview" ? (
                        <div className="execution-overview-tab execution-case-run-overview">
                        <div className="execution-step-progress-card">
                          <ProgressMeter
                            detail={`${selectedStepProgress.passedCount} passed · ${selectedStepProgress.failedCount} failed · ${selectedStepProgress.pendingCount} pending`}
                            label="Step progress"
                            segments={buildProgressSegments(
                              selectedStepProgress.passedCount,
                              selectedStepProgress.failedCount,
                              0,
                              selectedSteps.length
                            )}
                            value={selectedStepProgress.percent}
                          />
                        </div>

                        {executionPreconditionSteps.length ? (
                      <section className="execution-case-run-inspector-panel execution-case-run-preconditions">
                        <button
                          aria-expanded={expandedExecutionStepSections.preconditions}
                          className="execution-case-run-inspector-header execution-case-run-inspector-toggle"
                          onClick={() => setExpandedExecutionStepSections((current) => ({ ...current, preconditions: !current.preconditions }))}
                          type="button"
                        >
                          <div>
                            <IconCheckbox aria-hidden="true" size={20} stroke={1.9} />
                            <h2>Preconditions</h2>
                            <span className="count-pill">{executionPreconditionSteps.length}</span>
                          </div>
                          <IconChevronRight
                            aria-hidden="true"
                            className={expandedExecutionStepSections.preconditions ? "is-expanded" : ""}
                            size={18}
                            stroke={2}
                          />
                        </button>
                        {expandedExecutionStepSections.preconditions ? (
                          <div className="execution-step-card-list execution-case-run-precondition-list" role="list" aria-label="Preconditions for this case">
                            {executionPreconditionSteps.map(renderExecutionStepCard)}
                            {!executionPreconditionSteps.length ? <div className="empty-state compact">No preconditions were captured in this run snapshot.</div> : null}
                          </div>
                        ) : null}
                      </section>
                        ) : null}

                        {!selectedSteps.length ? <div className="empty-state compact">No snapshot steps are available for this case.</div> : null}

                        {selectedSteps.length ? (
                          <div className="execution-step-view-shell execution-case-run-step-workspace">
                            <div className="execution-step-view-header">
                              <div>
                                <strong>Test steps</strong>
                                <span>
                                  Follow the saved behavior and record each step’s outcome.
                                </span>
                              </div>
                              <div className="execution-step-view-header-actions">
                                <div className="execution-step-view-toggle" role="tablist" aria-label="Step view">
                                  <button
                                    aria-selected={visibleExecutionStepViewMode === "structured"}
                                    className={visibleExecutionStepViewMode === "structured" ? "is-active" : ""}
                                    onClick={() => setExecutionStepViewMode("structured")}
                                    role="tab"
                                    type="button"
                                  >
                                    <IconListDetails aria-hidden="true" size={16} stroke={1.9} />
                                    <span>Structured steps</span>
                                  </button>
                                  {canViewRunGherkin ? (
                                    <button
                                      aria-selected={visibleExecutionStepViewMode === "gherkin"}
                                      className={visibleExecutionStepViewMode === "gherkin" ? "is-active" : ""}
                                      onClick={() => setExecutionStepViewMode("gherkin")}
                                      role="tab"
                                      type="button"
                                    >
                                      <IconActivity aria-hidden="true" size={16} stroke={1.9} />
                                      <span>Gherkin steps</span>
                                    </button>
                                  ) : null}
                                  {canViewRunAutomationCode ? (
                                    <button
                                      aria-selected={visibleExecutionStepViewMode === "automation"}
                                      className={visibleExecutionStepViewMode === "automation" ? "is-active" : ""}
                                      disabled={!hasSelectedStepAutomationCode}
                                      onClick={() => setExecutionStepViewMode("automation")}
                                      role="tab"
                                      title={hasSelectedStepAutomationCode ? "View coded steps and runtime logs" : "Automation code is not available for this case yet"}
                                      type="button"
                                    >
                                      <IconCode aria-hidden="true" size={16} stroke={1.9} />
                                      <span>Coded steps</span>
                                    </button>
                                  ) : null}
                                </div>
                                {session?.user.role === "admin" && hasPermission(session, "feature_flag.manage") ? (
                                  <div className="execution-step-feature-links" aria-label="Step view feature settings">
                                    <a href={getAdminFeatureUrl("hellotest.manual.run_gherkin")} target="_blank" rel="noopener noreferrer">Gherkin feature <IconExternalLink aria-hidden="true" size={12} /></a>
                                    <a href={getAdminFeatureUrl("hellotest.automation.step_code")} target="_blank" rel="noopener noreferrer">Coded feature <IconExternalLink aria-hidden="true" size={12} /></a>
                                  </div>
                                ) : null}
                              </div>
                            </div>

                            {visibleExecutionStepViewMode !== "automation" ? (
                              <>
                                <div className="execution-steps-toolbar">
                                  <div className="execution-steps-bulk-buttons">
                                    <label className="execution-select-all">
                                      <input
                                        checked={selectedSteps.length > 0 && bulkSelectedStepIds.length === selectedSteps.length}
                                        onChange={() => {
                                          if (bulkSelectedStepIds.length === selectedSteps.length) {
                                            setBulkSelectedStepIds([]);
                                          } else {
                                            setBulkSelectedStepIds(selectedSteps.map((step) => step.id));
                                          }
                                        }}
                                        type="checkbox"
                                      />
                                      <span>Select all steps</span>
                                    </label>
                                    <span aria-hidden="true" className="execution-case-run-action-divider" />
                                    {canExecuteRuns && canManageRunResults ? (<button
                                      className="ghost-button execution-steps-bulk-action"
                                      disabled={!canExecuteRuns || !canManageRunResults || !isExecutionStarted || isExecutionLocked || !canRecordSelectedCase || Boolean(caseLifecycleAction) || !bulkSelectedStepIds.length}
                                      onClick={() => void handleBulkStepStatus("passed", "selected")}
                                      type="button"
                                    >
                                      <IconCheck aria-hidden="true" size={16} stroke={2} />
                                      <span>Pass selected</span>
                                    </button>) : null}
                                    {canExecuteRuns && canManageRunResults ? (<button
                                      className="ghost-button danger execution-steps-bulk-action"
                                      disabled={!canExecuteRuns || !canManageRunResults || !isExecutionStarted || isExecutionLocked || !canRecordSelectedCase || Boolean(caseLifecycleAction) || !bulkSelectedStepIds.length}
                                      onClick={() => void handleBulkStepStatus("failed", "selected")}
                                      type="button"
                                    >
                                      <IconX aria-hidden="true" size={16} stroke={2} />
                                      <span>Fail selected</span>
                                    </button>) : null}
                                    {executionStepGroupIds.length ? (
                                      <>
                                        <button
                                          aria-label="Expand groups"
                                          className="ghost-button execution-steps-bulk-action explorer-icon-button"
                                          disabled={expandedExecutionStepGroupIds.length === executionStepGroupIds.length}
                                          onClick={() => setExpandedExecutionStepGroupIds(executionStepGroupIds)}
                                          title="Expand groups"
                                          type="button"
                                        >
                                          <CollapseExpandIcon isExpanded={false} />
                                        </button>
                                        <button
                                          aria-label="Collapse groups"
                                          className="ghost-button execution-steps-bulk-action explorer-icon-button"
                                          disabled={!expandedExecutionStepGroupIds.length}
                                          onClick={() => setExpandedExecutionStepGroupIds([])}
                                          title="Collapse groups"
                                          type="button"
                                        >
                                          <CollapseExpandIcon isExpanded={true} />
                                        </button>
                                      </>
                                    ) : null}
                                  </div>
                                </div>

                                <div className="execution-step-section-list">
                                  <section className="execution-step-section execution-case-run-test-steps">
                                    <button
                                      aria-expanded={expandedExecutionStepSections.testSteps}
                                      className="execution-step-section-toggle"
                                      onClick={() => setExpandedExecutionStepSections((current) => ({ ...current, testSteps: !current.testSteps }))}
                                      type="button"
                                    >
                                      <span aria-hidden="true" className={expandedExecutionStepSections.testSteps ? "execution-step-group-chevron is-expanded" : "execution-step-group-chevron"}>
                                        <IconChevronRight size={16} stroke={2} />
                                      </span>
                                      <span>
                                        <strong>Test steps</strong>
                                        <small>Ungrouped steps, local groups, and Shared Step Group snapshots in execution order.</small>
                                      </span>
                                      <span className="execution-step-section-count">{executionMainSteps.length}</span>
                                    </button>
                                    {expandedExecutionStepSections.testSteps ? (
                                      <div className="execution-step-card-list execution-step-section-body" role="list" aria-label="Test steps for this case">
                                        {executionStepBlocks.map((block) => {
                                          if (!block.groupId) return block.steps.map(renderExecutionStepCard);
                                          const isExpanded = expandedExecutionStepGroupIds.includes(block.groupId);
                                          return (
                                            <Fragment key={block.key}>
                                              <ExecutionStepGroupRow
                                                canPreviewAutomation={canPreviewRunAutomation}
                                                isExpanded={isExpanded}
                                                kind={block.groupKind}
                                                name={block.groupName || "Step group"}
                                                onPreviewCode={() => openExecutionGroupAutomationPreview(block.groupName || "Step group", block.steps)}
                                                onToggle={() =>
                                                  setExpandedExecutionStepGroupIds((current) =>
                                                    current.includes(block.groupId as string)
                                                      ? current.filter((groupId) => groupId !== block.groupId)
                                                      : [...current, block.groupId as string]
                                                  )
                                                }
                                                stepCount={block.steps.length}
                                              />
                                              {isExpanded ? block.steps.map(renderExecutionStepCard) : null}
                                            </Fragment>
                                          );
                                        })}
                                        {!executionMainSteps.length ? <div className="empty-state compact">No main test steps were captured in this run snapshot.</div> : null}
                                      </div>
                                    ) : null}
                                  </section>
                                </div>
                              </>
                            ) : canViewRunAutomationCode ? (
                              <div className="execution-console-code-list execution-console-code-list--embedded" role="list" aria-label="Coded steps for this case">
                                {selectedSteps.map((step) => {
                                  const detail = stepAutomationDetails[step.id] || null;
                                  const code = detail?.code
                                    || step.automation_code
                                    || (step.step_type === "api" && step.api_request ? resolveStepAutomationCode(step) : "");

                                  if (!code.trim()) {
                                    return null;
                                  }

                                  return (
                                    <ExecutionAutomationStepCard
                                      apiDetail={stepApiDetails[step.id] || null}
                                      automationDetail={detail}
                                      code={code}
                                      key={step.id}
                                      note={stepNotes[step.id] || ""}
                                      status={detail?.status || stepStatuses[step.id] || "queued"}
                                      step={step}
                                      webDetail={stepWebDetails[step.id] || null}
                                    />
                                  );
                                })}
                                {!hasSelectedStepAutomationCode ? (
                                  <div className="empty-state compact">Automation code is not available for this case yet.</div>
                                ) : null}
                              </div>
                            ) : null}
                          </div>
                        ) : null}

                        {(!isExecutionStarted || selectedExecutionResult?.status !== "running") && !isExecutionLocked ? <div className="empty-state compact">Start the run, then start this case to enable step outcomes and timing.</div> : null}
                        {isExecutionLocked ? <div className="empty-state compact">This execution is locked because it is {executionStatusLabel(currentExecutionStatus).toLowerCase()}.</div> : null}
                      </div>
                      ) : null}

                      {activeTab === "logs" ? (
                        <div className="stack-list execution-logs-stack execution-case-run-tab-panel">
                        {selectedExecutionResult ? (
                          <div className="execution-log-focus">
                            <div className="execution-section-head">
                              <strong>{selectedExecutionCaseReadableTitle || selectedExecutionResult.test_case_title || selectedExecutionCase.title || "Selected case logs"}</strong>
                              <span>{selectedExecutionResult.error || "Structured evidence and notes for the focused case."}</span>
                            </div>
                            <ExecutionStructuredLogView
                              logsJson={selectedExecutionResult.logs}
                              onOpenEvidence={openExecutionEvidence}
                              steps={selectedSteps}
                            />
                          </div>
                        ) : (
                          <div className="empty-state compact">No logs yet for the selected case.</div>
                        )}

                        {executionResults
                          .filter((result) => result.id !== selectedExecutionResult?.id && selectedExecutionCaseInstance && executionResultMatchesCaseInstance(result, selectedExecutionCaseInstance))
                          .map((result) => (
                            <div className="stack-item execution-log-row" key={result.id}>
                              <div>
                                <strong>{result.test_case_title || "Unnamed Test Case"}</strong>
                                <ExecutionStructuredLogSummary logsJson={result.logs} />
                                <span>{formatExecutionTimestamp(result.created_at, "Timestamp unavailable")} · {formatDuration(result.duration_ms, DEFAULT_DURATION_LABEL)}</span>
                                {result.error ? <span className="execution-log-error">{result.error}</span> : null}
                              </div>
                              <StatusBadge value={result.status} />
                            </div>
                          ))}
                        {!executionResults.length ? <div className="empty-state compact">No execution results have been logged yet.</div> : null}
                      </div>
                      ) : null}

                      {activeTab === "history" ? (
                        <div className="stack-list execution-history-stack execution-case-run-tab-panel">
                        {selectedExecutionResult?.lifecycle_history?.length ? <ol className="execution-case-history-events" aria-label="Case activity">
                          {selectedExecutionResult.lifecycle_history.slice().reverse().map((event, index) => <li key={`${event.at}-${index}`}>
                            <strong>{event.actor_name || event.actor_email || "Tester"}</strong>
                            <span>{event.from_status ? `${BOARD_STATUS_META[event.from_status as BoardStatusTone]?.label || event.from_status} → ` : ""}{BOARD_STATUS_META[event.to_status as BoardStatusTone]?.label || event.to_status}</span>
                            <small>{formatDuration(event.duration_ms, "0s")} active time</small><time dateTime={event.at}>{formatExecutionTimestamp(event.at)}</time>
                          </li>)}
                        </ol> : null}
                        {selectedCaseHistory.map((result) => {
                          const linkedExecution = executionById[result.execution_id];
                          const isCurrentExecution = result.execution_id === selectedExecution.id;

                          return (
                            <button
                              className={isCurrentExecution ? "stack-item stack-item-button execution-history-row is-current" : "stack-item stack-item-button execution-history-row"}
                              key={result.id}
                              onClick={() => setHistoryResult(result)}
                              type="button"
                            >
                              <div>
                                <strong>{linkedExecution?.name || result.test_case_title || "Run record"}</strong>
                                <span>{result.suite_name || "Recorded case evidence"} · {formatExecutionTimestamp(result.created_at, "Timestamp unavailable")}</span>
                                <small>{formatDuration(result.duration_ms, DEFAULT_DURATION_LABEL)} · {result.data_set_iteration_index != null ? `Row ${result.data_set_iteration_index + 1} · ` : ""}View saved attempt</small>
                              </div>
                              <StatusBadge value={result.status} />
                            </button>
                          );
                        })}
                        {!selectedCaseHistory.length ? <div className="empty-state compact">No run history exists yet for this selected case.</div> : null}
                      </div>
                      ) : null}
                      {activeTab === "evidence" ? (
                        <div className="execution-case-run-tab-panel">
                          <CaseRunAttachmentPanel
                            key={`${selectedExecution.id}:${selectedExecutionCaseInstance?.instance_key}`}
                            resultId={selectedExecutionResult?.id}
                            executionId={selectedExecution.id}
                            testCaseId={selectedExecutionCase.id}
                            iterationKey={selectedExecutionCaseInstance?.instance_key}
                            canView={canViewRunEvidence}
                            canUpload={canCreateRunEvidence}
                            canDelete={canDeleteRunEvidence}
                            ensureResult={ensureSelectedCaseResult}
                            onEvidenceChange={() => refreshExecutionScope(selectedExecution.id)}
                            legacyEvidence={stepEvidence}
                          />
                          <details className="execution-legacy-attachments"><summary>Earlier run attachments</summary>
                            <JiraAttachmentPanel canDelete={canDeleteRunEvidence} canUpload={false} canView={canViewRunEvidence} entityId={selectedExecution.id} entityType="execution" issueKey={selectedExecution.id} projectId={projectId} title="Earlier run attachments" />
                          </details>
                        </div>
                      ) : null}
                    </main>

                    {activeTab === "overview" ? <aside className="execution-case-run-inspector" aria-label="Case run details and context">
                      <section className="execution-case-run-inspector-panel">
                        <header className="execution-case-run-inspector-header">
                          <div>
                            <IconInfoCircle aria-hidden="true" size={20} stroke={1.9} />
                            <h2>Case details</h2>
                          </div>
                        </header>
                        <div className="execution-case-run-inspector-content">
                          <dl className="execution-case-run-detail-grid">
                            <div>
                              <dt>Case ID</dt>
                              <dd>{selectedExecutionCase.id}</dd>
                            </div>
                            <div>
                              <dt>Outcome</dt>
                              <dd><StatusBadge value={selectedCaseStatusLabel} /></dd>
                            </div>
                            <div>
                              <dt>Priority</dt>
                              <dd>P{selectedExecutionCase.priority ?? 3}</dd>
                            </div>
                            <div>
                              <dt>Run</dt>
                              <dd>{selectedExecution.name || selectedExecution.id}</dd>
                            </div>
                            <div>
                              <dt>Suite</dt>
                              <dd>{selectedExecutionCase.suite_name || "Direct case"}</dd>
                            </div>
                            <div>
                              <dt>Module</dt>
                              <dd>{selectedExecutionCase.module_name || "Unassigned module"}</dd>
                            </div>
                          </dl>
                          <div className="execution-case-run-description">
                            <span>Description</span>
                            <p>{selectedExecutionCaseReadableDescription || "No case description was captured in this run snapshot."}</p>
                          </div>
                        </div>
                      </section>



                      <section className="execution-case-run-inspector-panel execution-case-run-assignee-panel">
                        <header className="execution-case-run-inspector-header">
                          <div>
                            <IconUser aria-hidden="true" size={20} stroke={1.9} />
                            <h2>Case assignee</h2>
                          </div>
                          <ExecutionAssigneeChip className="execution-card-assignee--compact" user={selectedExecutionCaseEffectiveUser} />
                        </header>
                        <div className="execution-case-run-inspector-content">
                          <p className="execution-case-run-panel-help">{selectedExecutionCaseAssignmentHint}</p>
                          <select
                            disabled={!canUpdateRuns || isExecutionLocked || !assigneeOptions.length || updateExecutionCaseAssignment.isPending}
                            value={caseAssignmentDraft}
                            onChange={(event) => setCaseAssignmentDraft(event.target.value)}
                          >
                            <option value="">
                              {selectedExecution?.assigned_user
                                ? `Use execution assignee (${resolveUserPrimaryLabel(selectedExecution.assigned_user)})`
                                : assigneeOptions.length
                                  ? "Unassigned"
                                  : "No project members available"}
                            </option>
                            {assigneeOptions.map((option) => (
                              <option key={option.id} value={option.id}>
                                {option.caption ? `${option.label} · ${option.caption}` : option.label}
                              </option>
                            ))}
                          </select>
                          {canUpdateRuns ? (<button
                            className="execution-case-run-button"
                            disabled={!canUpdateRuns || isExecutionLocked || !assigneeOptions.length || !hasCaseAssignmentChange || updateExecutionCaseAssignment.isPending}
                            onClick={() => void handleSaveCaseAssignment()}
                            type="button"
                          >
                            <IconUser aria-hidden="true" size={17} stroke={1.9} />
                            <span>{updateExecutionCaseAssignment.isPending ? "Saving…" : "Update assignee"}</span>
                          </button>) : null}
                        </div>
                      </section>

                      {selectedRuntimeTelemetry.webStepCount > 0 ? <section className="execution-case-run-inspector-panel execution-engine-cockpit" aria-label="Test engine cockpit">
                        <header className="execution-case-run-inspector-header">
                          <div>
                            <IconTerminal2 aria-hidden="true" size={20} stroke={1.9} />
                            <h2>Test engine cockpit</h2>
                          </div>
                        </header>
                        <div className="execution-case-run-inspector-content">
                          <p className="execution-case-run-panel-help">
                            {selectedRuntimeTelemetry.webStepCount
                              ? `${selectedRuntimeTelemetry.webStepCount} automated web step${selectedRuntimeTelemetry.webStepCount === 1 ? "" : "s"} reported runtime diagnostics.`
                              : "Ready for manual, API, web, mobile, or mixed execution evidence."}
                          </p>
                          <div className="execution-engine-signal-grid">
                            <span>
                              <IconTerminal2 aria-hidden="true" size={15} stroke={1.8} />
                              <strong>{selectedRuntimeTelemetry.consoleCount}</strong>
                              <small>Console logs</small>
                            </span>
                            <span>
                              <IconActivity aria-hidden="true" size={15} stroke={1.8} />
                              <strong>{selectedRuntimeTelemetry.networkCount}</strong>
                              <small>Network calls</small>
                            </span>
                            <span>
                              <IconPhoto aria-hidden="true" size={15} stroke={1.8} />
                              <strong>{selectedRuntimeTelemetry.artifactCount}</strong>
                              <small>Evidence items</small>
                            </span>
                            <span>
                              <IconClock aria-hidden="true" size={15} stroke={1.8} />
                              <strong>{selectedRuntimeTelemetry.avgWebDurationMs !== null ? formatDuration(selectedRuntimeTelemetry.avgWebDurationMs, DEFAULT_DURATION_LABEL) : "0s"}</strong>
                              <small>Avg web step</small>
                            </span>
                          </div>
                        </div>
                      </section> : null}



                      <section className="execution-case-run-inspector-panel execution-case-run-references">
                        <header className="execution-case-run-inspector-header">
                          <div>
                            <IconLink aria-hidden="true" size={20} stroke={1.9} />
                            <h2>Traceability</h2>
                          </div>
                        </header>
                        <div className="execution-case-run-inspector-content">
                          <ExternalReferencesField
                            className="execution-case-run-reference-field"
                            disabled={!canManageRunResults || updateResult.isPending || createResult.isPending}
                            placeholder="Paste work-item links, docs, or IDs..."
                            value={caseReferenceDraft}
                            onChange={setCaseReferenceDraft}
                          />
                          <FormField
                            className="execution-case-run-defect-field"
                            label="Linked defects"
                            labelIcon={<IconBug aria-hidden="true" size={15} stroke={1.9} />}
                          >
                            <textarea
                              disabled={!canManageRunResults || updateResult.isPending || createResult.isPending}
                              onChange={(event) => setCaseDefectDraft(event.target.value)}
                              placeholder="One Defect key or ID per line"
                              rows={3}
                              value={caseDefectDraft}
                            />
                          </FormField>
                          {canManageRunResults ? (<button
                            className="execution-case-run-button is-primary is-full-width"
                            disabled={!canManageRunResults || !hasCaseReferenceChange || updateResult.isPending || createResult.isPending}
                            onClick={() => void handleSaveCaseReferences()}
                            type="button"
                          >
                            <IconLink aria-hidden="true" size={17} stroke={1.9} />
                            <span>{updateResult.isPending || createResult.isPending ? "Saving…" : "Save traceability"}</span>
                          </button>) : null}
                        </div>
                      </section>


                    </aside> : null}
                  </div>

                  <footer className="execution-case-run-footer">
                    <div className="execution-case-run-footer-status">
                      <StatusBadge value={selectedCaseStatusLabel === "running" ? "in_progress" : selectedCaseStatusLabel === "queued" ? "pending" : selectedCaseStatusLabel} />
                      <span>{formatDuration(selectedCaseDurationMs, DEFAULT_DURATION_LABEL)} current attempt</span>
                      <span>{resolvedEvidenceArtifactCount} evidence item{resolvedEvidenceArtifactCount === 1 ? "" : "s"}</span>
                    </div>
                    <div className="execution-case-run-navigation" aria-label="Case navigation">
                      <button
                        className="execution-case-run-button is-icon-only"
                        disabled={!previousExecutionCaseInstance}
                        onClick={() => focusNeighborExecutionCase(previousExecutionCaseInstance)}
                        title="Previous case instance"
                        type="button"
                      >
                        <IconArrowLeft aria-hidden="true" size={18} stroke={2} />
                        <span className="sr-only">Previous case instance</span>
                      </button>
                      <span>
                        Instance {selectedExecutionCaseInstanceIndex >= 0 ? selectedExecutionCaseInstanceIndex + 1 : "—"} of {executionCaseInstanceOrder.length}
                      </span>
                      <button
                        className="execution-case-run-button is-icon-only"
                        disabled={!nextExecutionCaseInstance}
                        onClick={() => focusNeighborExecutionCase(nextExecutionCaseInstance)}
                        title="Next case instance"
                        type="button"
                      >
                        <IconArrowRight aria-hidden="true" size={18} stroke={2} />
                        <span className="sr-only">Next case instance</span>
                      </button>
                    </div>
                    <div className="execution-case-run-footer-actions">
                      {canExecuteRuns && canManageRunResults ? (<button
                        className="execution-case-run-button is-fail"
                        disabled={!canExecuteRuns || !canManageRunResults || !isExecutionStarted || isExecutionLocked || !canRecordSelectedCase || Boolean(caseLifecycleAction)}
                        onClick={() => void (selectedSteps.length ? handleBulkStepStatus("failed", "all") : handleCaseLifecycle("fail"))}
                        type="button"
                      >
                        <IconCircleX aria-hidden="true" size={18} stroke={2} />
                        <span>Fail case</span>
                      </button>) : null}
                      {canExecuteRuns && canManageRunResults ? (<button
                        className="execution-case-run-button is-pass"
                        disabled={!canExecuteRuns || !canManageRunResults || !isExecutionStarted || isExecutionLocked || !canRecordSelectedCase || Boolean(caseLifecycleAction)}
                        onClick={() => void (selectedSteps.length ? handleBulkStepStatus("passed", "all") : handleCaseLifecycle("pass"))}
                        type="button"
                      >
                        <IconCircleCheck aria-hidden="true" size={18} stroke={2} />
                        <span>Pass case</span>
                      </button>) : null}
                    </div>
                  </footer>
                </>
              ) : (
                <div className="execution-panel-body execution-panel-body--detail">
                  <div className="empty-state compact">Select a case to continue.</div>
                </div>
              )}
            </section>
          ) : shouldRenderExecutionCommandCenter ? (
            renderExecutionCommandCenter()
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
              {selectedExecution ? (
                <div className="detail-stack">
                  <div className="execution-health-layout">
                    <div className="execution-health-hero">
                      <ExecutionOverviewOrb
                        blockedCount={executionStatusCounts.blocked}
                        failedCount={executionStatusCounts.failed}
                        passedCount={executionStatusCounts.passed}
                        passPercent={executionProgress.totalCases ? Math.round((executionStatusCounts.passed / executionProgress.totalCases) * 100) : 0}
                        totalCount={executionProgress.totalCases}
                      />

                      <div className="execution-health-copy">
                        <div className="execution-health-status-row">
                          <StatusBadge value={currentExecutionStatus} />
                          <span className="count-pill">{selectedExecutionAppTypeLabel}</span>
                          <ExecutionAssigneeChip
                            className="execution-card-assignee--compact"
                            labelOverride={resolveExecutionAssigneeSummary(selectedExecution)}
                            user={selectedExecution?.assigned_users?.[0] || selectedExecution?.assigned_user || null}
                          />
                          {selectedExecution.release ? <span className="count-pill">Release {selectedExecution.release}</span> : null}
                          {selectedExecution.sprint ? <span className="count-pill">Sprint {selectedExecution.sprint}</span> : null}
                          {selectedExecution.build ? <span className="count-pill">Build {selectedExecution.build}</span> : null}
                          <span className="execution-health-trigger">{(selectedExecution.trigger || "manual").toUpperCase()} trigger</span>
                        </div>

                        <div className="execution-health-heading">
                          <strong>{selectedExecution.name || "Unnamed run"}</strong>
                          <span>
                            {isSelectedExecutionTestCaseRun
                              ? `${executionProgress.totalCases} direct test case instance${executionProgress.totalCases === 1 ? "" : "s"} preserved for run evidence.`
                              : `${selectedExecutionSuiteIds.length} suites snapped into this run with ${executionProgress.totalCases} case instances preserved for run evidence.`}
                          </span>
                        </div>

                        <ProgressMeter
                          detail={`${executionProgress.totalCases} total · ${executionStatusCounts.passed} passed · ${executionStatusCounts.failed} failed · ${executionStatusCounts.blocked} blocked · ${remainingCaseCount} remaining`}
                          label="Run completion"
                          segments={buildProgressSegments(
                            executionStatusCounts.passed,
                            executionStatusCounts.failed,
                            executionStatusCounts.blocked,
                            executionProgress.totalCases
                          )}
                          value={executionProgress.percent}
                        />
                      </div>
                    </div>

                    <QualityMetricStrip
                      ariaLabel="Selected run quality metrics"
                      className="execution-run-quality-strip"
                      metrics={[
                        {
                          label: "Total cases",
                          value: executionProgress.totalCases,
                          detail: `${executionStatusCounts.running} currently running`
                        },
                        {
                          label: "Completion",
                          value: `${selectedRunCompletionPercent}%`,
                          detail: `${selectedRunFinalizedCount} of ${executionProgress.totalCases} finalized`,
                          progress: selectedRunCompletionPercent,
                          tone: "info"
                        },
                        {
                          label: "Pass rate",
                          value: selectedRunPassRate === null ? "—" : `${selectedRunPassRate}%`,
                          detail: selectedRunFinalizedCount
                            ? `${executionStatusCounts.passed} of ${selectedRunFinalizedCount} passed`
                            : "No finalized cases",
                          tone: selectedRunPassRate === null ? "neutral" : "success"
                        },
                        {
                          label: "Defects",
                          value: selectedExecution.metrics?.defect_count ?? 0,
                          detail: "Distinct defects linked to this run",
                          tone: selectedExecution.metrics?.defect_count ? "danger" : "neutral"
                        }
                      ]}
                    />

                    <div className="execution-run-impact-panel">
                      <div className="execution-run-impact-head">
                        <div>
                          <strong>Run impact areas</strong>
                          <span>
                            {selectedExecutionImpactSummary.failedCases.length
                              ? `${selectedExecutionImpactSummary.failedCases.length} failed or blocked case${selectedExecutionImpactSummary.failedCases.length === 1 ? "" : "s"} mapped to ${selectedExecutionImpactSummary.failedRequirementCount} ${selectedExecutionImpactSummary.failedRequirementCount === 1 ? "story" : "stories"}.`
                              : selectedExecutionImpactSummary.totalRequirements
                                ? `${selectedExecutionImpactSummary.totalRequirements} linked ${selectedExecutionImpactSummary.totalRequirements === 1 ? "story" : "stories"} in this run. No failed story impact yet.`
                                : "No linked story impact detected for this run yet."}
                          </span>
                        </div>
                        <span className={selectedExecutionImpactSummary.failureRate ? "count-pill warning" : "count-pill success"}>
                          {selectedExecutionImpactSummary.failureRate}% case failure rate
                        </span>
                      </div>

                      {selectedExecutionImpactSummary.impactedRequirements.length ? (
                        <div className="execution-run-impact-grid">
                          {selectedExecutionImpactSummary.impactedRequirements.slice(0, 6).map((requirement) => (
                            <article className={requirement.failedCases ? "execution-run-impact-card is-impacted" : "execution-run-impact-card"} key={requirement.id}>
                              <div>
                                <strong>{requirement.title}</strong>
                                <span>P{requirement.priority || 3} · {requirement.failedCases}/{requirement.totalCases} failed or blocked</span>
                              </div>
                              <span className={requirement.failureRate ? "count-pill warning" : "count-pill success"}>{requirement.failureRate}%</span>
                            </article>
                          ))}
                        </div>
                      ) : null}

                      {selectedExecutionImpactSummary.failedCases.length ? (
                        <div className="execution-run-failure-list">
                          {selectedExecutionImpactSummary.failedCases.slice(0, 8).map((testCase) => (
                            <button
                              className="execution-run-failure-row"
                              key={testCase.id}
                              onClick={() => focusExecutionCase(testCase.id)}
                              type="button"
                            >
                              <StatusBadge value={testCase.status} />
                              <div>
                                <strong title={testCase.title}>{testCase.title}</strong>
                                <span>
                                  {[
                                    testCase.suiteName || "Direct case",
                                    testCase.requirementTitles.length ? `Stories: ${testCase.requirementTitles.join(" · ")}` : "No linked story",
                                    testCase.error || null
                                  ].filter(Boolean).join(" · ")}
                                </span>
                              </div>
                            </button>
                          ))}
                        </div>
                      ) : null}
                    </div>

                    <AiAssurancePanel
                      gaps={selectedRunEvidenceReadiness.gaps}
                      provenance="Deterministic run results, case snapshots, story links, defects, and external references"
                      reviewState={["completed", "failed", "aborted"].includes(currentExecutionStatus) ? "review-required" : "evidence-forming"}
                      score={selectedRunEvidenceReadiness.score}
                      scoreLabel={selectedRunEvidenceReadiness.scoreLabel}
                      signals={selectedRunEvidenceReadiness.signals}
                      summary={selectedRunEvidenceReadiness.summary}
                      title="Release evidence readiness"
                    />

                    <ExecutionContextSnapshotSummary execution={selectedExecution} onViewFull={() => setIsExecutionContextModalOpen(true)} />

                    <div className="execution-assignment-panel">
                      <div className="execution-assignment-copy">
                        <strong>Run assignees</strong>
                        <span>Set the tester group for this run. Test cases without their own override follow the primary tester.</span>
                      </div>
                      <div className="execution-assignment-actions">
                        <MultiAssigneePicker
                          disabled={!canUpdateRuns || isExecutionLocked || !assigneeOptions.length || updateExecutionAssignment.isPending}
                          options={assigneeOptions}
                          selectedIds={executionAssignmentDraftIds}
                          onChange={setExecutionAssignmentDraftIds}
                        />
                        {canUpdateRuns ? (<button
                          className="ghost-button"
                          disabled={!canUpdateRuns || isExecutionLocked || !assigneeOptions.length || !hasExecutionAssignmentChange || updateExecutionAssignment.isPending}
                          onClick={() => void handleSaveExecutionAssignment()}
                          type="button"
                        >
                          <ExecutionAssigneeIcon />
                          <span>{updateExecutionAssignment.isPending ? "Saving…" : "Update assignees"}</span>
                        </button>) : null}
                      </div>
                    </div>

                    <div className="execution-control-strip">
                      <div className="execution-control-copy">
                        <strong>{executionControlTitle}</strong>
                        <span>{executionControlDescription}</span>
                      </div>
                      <div className="action-row">
	                        {canExecuteRuns ? (<button
	                          className="ghost-button"
	                          disabled={currentExecutionStatus !== "queued" || startExecution.isPending || completeExecution.isPending || !canExecuteRuns}
	                          onClick={() => void handleStartSelectedExecution()}
	                          type="button"
	                        >
                          <ExecutionStartIcon />
                          <span>{startExecution.isPending ? "Starting…" : "Start run"}</span>
                        </button>) : null}

                        {canExportRunReports ? (<button
                          className="ghost-button"
                          disabled={!selectedExecution || !canExportRunReports || downloadExecutionReport.isPending}
                          onClick={() => void handleDownloadExecutionReport()}
                          type="button"
                        >
                          <ExportIcon />
                          <span>{downloadExecutionReport.isPending ? "Exporting…" : "PDF report"}</span>
                        </button>) : null}
                        {canShareRunReports ? (<button
                          className="ghost-button"
                          disabled={!selectedExecution || !canShareRunReports || shareExecutionReport.isPending}
                          onClick={handleOpenReportEmailModal}
                          type="button"
                        >
                          <MailIcon />
                          <span>Email report</span>
                        </button>) : null}
                        {canReportBugs ? (<ReportBugSplitActionButton
                          canUseAi={canUseAiBugTriage}
                          disabled={!selectedExecution || !canReportBugs}
                          onReportBug={() => handleReportSelectedExecutionIssue(selectedExecutionCase ? "case" : "run")}
                          onReportBugWithAi={() => handleReportSelectedExecutionIssue(selectedExecutionCase ? "case" : "run", {}, "ai")}
                        />) : null}

                        {canExecuteRuns ? (<button
                          className="ghost-button"
                          disabled={currentExecutionStatus !== "running" || completeExecution.isPending || startExecution.isPending || !canExecuteRuns}
                          onClick={() => void handleFinalizeExecution("complete")}
                          type="button"
                        >
                          <ExecutionCompleteIcon />
                          <span>{completeExecution.isPending && executionFinalizeAction === "complete" ? "Completing…" : "Complete run"}</span>
                        </button>) : null}
                        <button
                          className="ghost-button"
                          disabled={!selectedExecution || rerunExecution.isPending || startExecution.isPending || completeExecution.isPending}
                          onClick={() => void handleRerunExecution(false)}
                          type="button"
                        >
                          <ExecutionRerunIcon />
                          <span>{rerunExecution.isPending ? "Preparing rerun…" : "Rerun all"}</span>
                        </button>
                        <button
                          className="ghost-button"
                          disabled={!selectedExecution || !executionStatusCounts.failed || rerunExecution.isPending || startExecution.isPending || completeExecution.isPending}
                          onClick={() => void handleRerunExecution(true)}
                          type="button"
                        >
                          <ExecutionRerunIcon />
                          <span>{rerunExecution.isPending ? "Preparing failed rerun…" : `Rerun failed (${executionStatusCounts.failed})`}</span>
                        </button>
                        {canExecuteRuns ? (<button
                          className="ghost-button danger"
                          disabled={currentExecutionStatus !== "running" || completeExecution.isPending || startExecution.isPending || !canExecuteRuns}
                          onClick={() => void handleFinalizeExecution("abort")}
                          type="button"
                        >
                          <ExecutionAbortIcon />
                          <span>{completeExecution.isPending && executionFinalizeAction === "abort" ? "Aborting run…" : "Abort run"}</span>
                        </button>) : null}
                      </div>
                    </div>



                    <ExecutionAccordionSection
                      className="execution-ai-analysis-section execution-run-ai-analysis-section"
                      isExpanded={isExecutionAiAnalysisExpanded}
                      onToggle={() => setIsExecutionAiAnalysisExpanded((current) => !current)}
                      summary={runAiAnalysis?.generatedAt ? `Run rollup ${formatExecutionTimestamp(runAiAnalysis.generatedAt)}` : "No run assets available"}
                      title="Evidence analysis"
                    >
	                      <ExecutionAiAnalysisPanel
	                        analysis={runAiAnalysis}
	                        canRun={canUseRunAi && ["completed", "failed"].includes(currentExecutionStatus)}
	                        canPreviewClusters={canUseRunAi && Boolean(projectId) && ["completed", "failed"].includes(currentExecutionStatus)}
	                        isRunning={isSelectedRunAnalysisPending}
	                        isPreviewingClusters={previewExecutionFailureClusters.isPending}
	                        onRun={() => void handleRunExecutionAiAnalysis()}
	                        onPreviewClusters={handlePreviewFailureClusters}
	                      />
                    </ExecutionAccordionSection>

                    {isSelectedExecutionTestCaseRun ? (
                      renderExecutionCaseCatalog({
                        cases: filteredExecutionCaseOrder,
                        emptyMessage: "No direct test cases were snapped into this run.",
                        suiteName: "Test case run"
                      })
                    ) : (
                      <div className="execution-run-detail-catalog">
                        <div className="design-list-toolbar catalog-command-toolbar execution-run-detail-toolbar">
                          <div className="catalog-toolbar-discovery" aria-label="Run suite views and search">
                            <CatalogViewToggle onChange={setExecutionSuiteCatalogViewMode} value={executionSuiteCatalogViewMode} />
                            <CatalogSearchFilter
                              activeFilterCount={executionSuiteSearch.trim() ? 1 : 0}
                              ariaLabel="Search run suites"
                              onChange={setExecutionSuiteSearch}
                              placeholder="Search suites"
                              subtitle="Search suite names, statuses, impacted stories, and snapped case titles."
                              title="Suite search"
                              type="search"
                              value={executionSuiteSearch}
                            >
                              <div className="catalog-filter-grid">
                                <div className="catalog-filter-actions">
                                  <button className="ghost-button" disabled={!executionSuiteSearch.trim()} onClick={() => setExecutionSuiteSearch("")} type="button">
                                    Clear search
                                  </button>
                                </div>
                              </div>
                            </CatalogSearchFilter>
                          </div>
                        </div>

                        {executionSuiteCatalogViewMode === "tile" ? (
                    <div className="suite-tree">
                      {filteredExecutionSuites.map((suite) => {
                        const suiteCases = displayCasesBySuiteId[suite.id] || [];
                        const suiteMetric = suiteMetrics.find((item) => item.suiteId === suite.id);
                        const suiteStatus = suiteMetric ? suiteBoardStatus(suiteMetric) : "queued";
                        const suiteResolvedCount =
                          (suiteMetric?.passedCount || 0) +
                          (suiteMetric?.failedCount || 0) +
                          (suiteMetric?.blockedCount || 0);
                        const suiteImpactSummary = selectedSuiteImpactSummaryById[suite.id] || EMPTY_EXECUTION_RUN_IMPACT_SUMMARY;
                        const suiteSummaryForRisk: ExecutionRunSummary = {
                          caseCount: suiteMetric?.count || suiteCases.length,
                          passed: suiteMetric?.passedCount || 0,
                          failed: suiteMetric?.failedCount || 0,
                          blocked: suiteMetric?.blockedCount || 0,
                          skipped: 0,
                          aborted: 0,
                          running: 0,
                          paused: 0,
                          total: suiteResolvedCount,
                          passRate: suiteResolvedCount ? Math.round(((suiteMetric?.passedCount || 0) / suiteResolvedCount) * 100) : 0,
                          avgDurationMs: null,
                          timedCount: 0,
                          latestActivityAt: null,
                          totalDurationMs: 0
                        };
                        const suiteRiskTone = getExecutionRiskTone(suiteSummaryForRisk, suiteImpactSummary);
                        const suiteRiskLabel = getExecutionRiskLabel(suiteSummaryForRisk, suiteImpactSummary);
                        const suiteRiskInsight = getExecutionRiskInsight(suiteSummaryForRisk, suiteImpactSummary, suiteMetric?.count || suiteCases.length).replace("run evidence", "suite evidence");
                        const suiteReferenceCount = new Set(
                          suiteCases
                            .flatMap((testCase) => testCase.external_references || [])
                            .map((reference) => String(reference).trim())
                            .filter(Boolean)
                        ).size;
                        const isExpanded = expandedExecutionSuiteIds.includes(suite.id);
                        const isFocusedSuite = focusedSuiteId === suite.id;

                        return (
                          <div className={["tree-suite", isExpanded ? "is-expanded" : ""].filter(Boolean).join(" ")} key={suite.id}>
                            <div
                              className={[
                                "record-card tile-card execution-suite-card",
                                isFocusedSuite ? "is-active" : "",
                                isExpanded ? "is-expanded" : ""
                              ].filter(Boolean).join(" ")}
                            >
                              <div className="tree-suite-row">
                                <button
                                  aria-expanded={isExpanded}
                                  className="tree-suite-expand"
                                  onClick={() => toggleSuiteGroup(suite.id)}
                                  type="button"
                                >
                                  <div className="tile-card-main">
                                    <div className="tile-card-header">
                                      <div className="execution-suite-card-actions">
                                        <span aria-hidden="true" className={isExpanded ? "tree-suite-chevron is-expanded" : "tree-suite-chevron"}>
                                          <ExecutionAccordionChevronIcon />
                                        </span>
                                        <div
                                          aria-hidden="true"
                                          className={`record-card-icon execution-board-icon status-${suiteStatus}`}
                                          title={boardStatusTooltip(suiteStatus)}
                                        >
                                          <ExecutionSuiteIcon />
                                        </div>
                                      </div>
                                      <div className="tile-card-title-group">
                                        <strong>{suite.name}</strong>
                                        <span className="tile-card-kicker">{suiteResolvedCount}/{suiteMetric?.count || 0} resolved</span>
                                      </div>
                                      <ExecutionStatusIndicator status={suiteStatus} />
                                    </div>

                                    <div className="execution-card-facts" aria-label={`${suite.name} facts`}>
                                      <ExecutionCardFact
                                        ariaLabel={`${suiteCases.length} cases in suite`}
                                        label={String(suiteCases.length)}
                                        title={`${suiteCases.length} cases in suite`}
                                      >
                                        <ExecutionScopeIcon />
                                      </ExecutionCardFact>
                                      <ExecutionCardFact
                                        ariaLabel={`${suiteResolvedCount} of ${suiteMetric?.count || 0} case instances resolved`}
                                        label={`${suiteResolvedCount}/${suiteMetric?.count || 0}`}
                                        title={`${suiteResolvedCount}/${suiteMetric?.count || 0} case instances resolved`}
                                      >
                                        <ExecutionProgressFactsIcon />
                                      </ExecutionCardFact>
                                      <ExecutionCardFact
                                        ariaLabel={`${(suiteMetric?.failedCount || 0) + (suiteMetric?.blockedCount || 0)} failing or blocked case instances`}
                                        label={String((suiteMetric?.failedCount || 0) + (suiteMetric?.blockedCount || 0))}
                                        title={`${suiteMetric?.failedCount || 0} failed · ${suiteMetric?.blockedCount || 0} blocked`}
                                        tone={suiteMetric?.failedCount ? "danger" : suiteMetric?.blockedCount ? "warning" : "success"}
                                      >
                                        <ExecutionRiskIcon />
                                      </ExecutionCardFact>
                                      <ExecutionCardFact
                                        ariaLabel={`${suiteImpactSummary.failedRequirementCount} impacted stories with failed or blocked cases`}
                                        label={suiteImpactSummary.totalRequirements ? `${suiteImpactSummary.failedRequirementCount}/${suiteImpactSummary.totalRequirements}` : "0"}
                                        title={suiteImpactSummary.impactedRequirements[0] ? `${suiteImpactSummary.impactedRequirements[0].title} · ${suiteImpactSummary.impactedRequirements[0].failureRate}% failure rate` : "No story impact detected in this suite"}
                                        tone={suiteImpactSummary.failedRequirementCount ? "warning" : "neutral"}
                                      >
                                        <ExecutionRequirementImpactIcon />
                                      </ExecutionCardFact>
                                      <ExecutionCardFact
                                        ariaLabel={`${suiteReferenceCount} external references in suite cases`}
                                        label={String(suiteReferenceCount)}
                                        title={suiteReferenceCount ? `${suiteReferenceCount} linked reference${suiteReferenceCount === 1 ? "" : "s"}` : "No linked external references in this suite"}
                                        tone={suiteReferenceCount ? "info" : "neutral"}
                                      >
                                        <ExecutionReferenceIcon />
                                      </ExecutionCardFact>
                                      <ExecutionCardFact
                                        ariaLabel={`Suite duration ${formatDuration(suiteDurationById[suite.id], DEFAULT_DURATION_LABEL)}`}
                                        label={formatDuration(suiteDurationById[suite.id], DEFAULT_DURATION_LABEL)}
                                        title={`Total recorded suite duration ${formatDuration(suiteDurationById[suite.id], DEFAULT_DURATION_LABEL)}`}
                                        tone={suiteStatus === "blocked" ? "warning" : "neutral"}
                                      >
                                        <ExecutionTimeIcon />
                                      </ExecutionCardFact>
                                    </div>

                                    <div className={`execution-card-risk-note ${suiteRiskTone}`}>
                                      <span>{suiteRiskLabel}</span>
                                      <p>{suiteRiskInsight}</p>
                                    </div>

                                    {suiteImpactSummary.impactedRequirements.length ? (
                                      <div className="execution-suite-impact-row" aria-label={`${suite.name} impacted stories`}>
                                        {suiteImpactSummary.impactedRequirements.slice(0, 4).map((requirement) => (
                                          <span className={requirement.failedCases ? "execution-impact-chip is-impacted" : "execution-impact-chip"} key={requirement.id}>
                                            <b>{requirement.title}</b>
                                            <small>P{requirement.priority ?? 3} · {requirement.failedCases}/{requirement.totalCases} failed</small>
                                          </span>
                                        ))}
                                      </div>
                                    ) : null}

                                    <TileCardProgress
                                      displayValue={suiteMetric?.count ? `${suiteMetric.percent}%` : "No cases"}
                                      label="Suite completion"
                                      title={`${suiteMetric?.completedCount || 0} of ${suiteMetric?.count || 0} case instances finalized, including skipped and aborted outcomes`}
                                      breakdown={buildRunOutcomeBreakdown(
                                        suiteMetric?.passedCount || 0,
                                        suiteMetric?.failedCount || 0,
                                        suiteMetric?.blockedCount || 0,
                                        suiteMetric?.count || 0,
                                        {
                                          skipped: suiteMetric?.skippedCount || 0,
                                          aborted: suiteMetric?.abortedCount || 0,
                                          running: suiteMetric?.runningCount || 0,
                                          paused: suiteMetric?.pausedCount || 0
                                        }
                                      )}
                                      value={suiteMetric?.count ? suiteMetric.percent : null}
                                    />
                                  </div>
                                </button>

                                {isExpanded ? (
                                  <div className="tree-suite-body">
                                    <div className="execution-scope-assignment-bar">
                                      <div>
                                        <ExecutionAssigneeIcon />
                                        <span><strong>Suite owner</strong><small>Cases inherit this unless their module or case has an override.</small></span>
                                      </div>
                                      <MultiAssigneePicker
                                        disabled={!canUpdateRuns || isExecutionLocked || updateExecutionScopeAssignment.isPending}
                                        emptyLabel="Inherit run owner"
                                        onChange={(ids) => void handleScopeAssignmentChange("suites", suite.id, ids)}
                                        options={assigneeOptions}
                                        selectedIds={selectedExecution?.suite_assignments?.[suite.id] || []}
                                      />
                                    </div>
                                    {renderExecutionCaseCatalog({
                                      cases: filteredDisplayCasesBySuiteId[suite.id] || [],
                                      emptyMessage: "No test cases were snapped into this suite.",
                                      suiteId: suite.id,
                                      suiteName: suite.name
                                    })}
                                  </div>
                                ) : null}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                      {!filteredExecutionSuites.length ? (
                        <div className="empty-state compact">
                          {executionSuiteSearch.trim() ? "No suites match the current search." : "No suites were selected for this execution."}
                        </div>
                      ) : null}
                    </div>
                        ) : (
                          <>
                            <DataTable
                              columns={executionSuiteListColumns}
                              enableColumnResize
                              enableHeaderColumnReorder
                              emptyMessage={executionSuiteSearch.trim() ? "No suites match the current search." : "No suites were selected for this execution."}
                              getRowClassName={(suite) => (focusedSuiteId === suite.id ? "is-active-row" : "")}
                              getRowKey={(suite) => suite.id}
                              onRowClick={(suite) => {
                                setFocusedSuiteId(suite.id);
                                setExpandedExecutionSuiteIds((current) => (current.includes(suite.id) ? current : [...current, suite.id]));
                              }}
                              renderRowActions={renderExecutionSuiteRowActions}
                              rows={filteredExecutionSuites}
                              storageKey="hellotest:execution-run-suites:list-columns"
                            />
                            <div className="execution-open-suite-panels">
                              {filteredExecutionSuites
                                .filter((suite) => expandedExecutionSuiteIds.includes(suite.id))
                                .map((suite) => (
                                  <div className="execution-open-suite-panel" key={`open-${suite.id}`}>
                                    <div className="execution-open-suite-panel-head">
                                      <strong>{suite.name}</strong>
                                      <button
                                        className="ghost-button"
                                        onClick={() => setExpandedExecutionSuiteIds((current) => current.filter((suiteId) => suiteId !== suite.id))}
                                        type="button"
                                      >
                                        Close suite
                                      </button>
                                    </div>
                                    <div className="execution-scope-assignment-bar">
                                      <div>
                                        <ExecutionAssigneeIcon />
                                        <span><strong>Suite owner</strong><small>Module and case overrides take precedence.</small></span>
                                      </div>
                                      <MultiAssigneePicker
                                        disabled={!canUpdateRuns || isExecutionLocked || updateExecutionScopeAssignment.isPending}
                                        emptyLabel="Inherit run owner"
                                        onChange={(ids) => void handleScopeAssignmentChange("suites", suite.id, ids)}
                                        options={assigneeOptions}
                                        selectedIds={selectedExecution?.suite_assignments?.[suite.id] || []}
                                      />
                                    </div>
                                    {renderExecutionCaseCatalog({
                                      cases: filteredDisplayCasesBySuiteId[suite.id] || [],
                                      emptyMessage: "No test cases were snapped into this suite.",
                                      suiteId: suite.id,
                                      suiteName: suite.name
                                    })}
                                  </div>
                                ))}
                            </div>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              ) : (
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
              context: `${executionProgress.totalCases} run case instances, ${executionStatusCounts.failed} failed, ${executionStatusCounts.blocked} blocked, and ${runReferenceStats.defectCount + runReferenceStats.referenceCount} references are bounded to this run.`,
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
          { label: "Rule clusters", value: String(previewExecutionFailureClusters.data.clusters.length), tone: "neutral" },
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

      {editingRunId ? <RunEditDialog executionId={editingRunId} assigneeOptions={assigneeOptions} canRunLocalAutomation={canRunLocalAutomation} canRunRemoteAutomation={canRunRemoteAutomation} canConfigureParallelAutomation={canConfigureParallelAutomation} onClose={() => setEditingRunId("")} onSaved={() => { setMessage("Run updated."); setMessageTone("success"); }} /> : null}
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
          isPreviewingSmartExecution={previewSmartExecution.isPending}
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
          scopeSuites={scopeSuites}
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

function ExecutionAccordionPanel({
  title,
  subtitle,
  isExpanded,
  onToggle,
  className = "",
  children
}: {
  title: string;
  subtitle?: string;
  isExpanded: boolean;
  onToggle: () => void;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={`panel card execution-accordion-panel ${className}`.trim()}>
      <button
        aria-expanded={isExpanded}
        className="execution-accordion-toggle execution-accordion-toggle--panel"
        onClick={onToggle}
        title={isExpanded ? `Collapse ${title}` : `Expand ${title}`}
        type="button"
      >
        <div className="execution-accordion-toggle-main">
          <span aria-hidden="true" className={isExpanded ? "execution-accordion-icon is-expanded" : "execution-accordion-icon"}>
            <ExecutionAccordionChevronIcon />
          </span>
          <div className="execution-accordion-toggle-copy">
            <strong>{title}</strong>
            {subtitle ? <span>{subtitle}</span> : null}
          </div>
        </div>
        <div className="execution-accordion-toggle-meta">
          <span aria-hidden="true" className="execution-accordion-toggle-state explorer-toggle-glyph"><CollapseExpandIcon isExpanded={isExpanded} /></span>
        </div>
      </button>
      {isExpanded ? <div className="execution-accordion-panel-body">{children}</div> : null}
    </section>
  );
}

function ExecutionAccordionSection({
  title,
  summary,
  isExpanded,
  onToggle,
  className = "",
  children
}: {
  title: string;
  summary: string;
  isExpanded: boolean;
  onToggle: () => void;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={`${isExpanded ? "execution-accordion-section is-expanded" : "execution-accordion-section"} ${className}`.trim()}>
      <button
        aria-expanded={isExpanded}
        className="execution-accordion-toggle execution-accordion-toggle--section"
        onClick={onToggle}
        title={isExpanded ? `Collapse ${title}` : `Expand ${title}`}
        type="button"
      >
        <div className="execution-accordion-toggle-main">
          <span aria-hidden="true" className={isExpanded ? "execution-accordion-icon is-expanded" : "execution-accordion-icon"}>
            <ExecutionAccordionChevronIcon />
          </span>
          <div className="execution-accordion-toggle-copy">
            <strong>{title}</strong>
            <span>{summary}</span>
          </div>
        </div>
        <div className="execution-accordion-toggle-meta">
          <span aria-hidden="true" className="execution-accordion-toggle-state explorer-toggle-glyph"><CollapseExpandIcon isExpanded={isExpanded} /></span>
        </div>
      </button>
      {isExpanded ? <div className="execution-accordion-body">{children}</div> : null}
    </section>
  );
}

function ReportEmailModal({
  runName,
  recipients,
  isSubmitting,
  onRecipientsChange,
  onClose,
  onSubmit
}: {
  runName: string;
  recipients: string;
  isSubmitting: boolean;
  onRecipientsChange: (value: string) => void;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <div className="modal-backdrop" onClick={() => !isSubmitting && onClose()} role="presentation">
      <form
        aria-label="Email run report"
        aria-modal="true"
        className="modal-card resource-modal-card"
        onClick={(event) => event.stopPropagation()}
        onSubmit={onSubmit}
        role="dialog"
      >
        <div className="resource-modal-header">
          <div className="resource-modal-title">
            <p className="dialog-context-label">Run report</p>
            <h2 className="dialog-title">Email report</h2>
            <p>{runName}</p>
          </div>
          <button className="ghost-button" disabled={isSubmitting} onClick={onClose} type="button">
            Close
          </button>
        </div>
        <div className="resource-form">
          <div className="resource-form-body">
            <FormField label="Recipients" hint="Separate multiple recipients with commas, semicolons, or new lines.">
              <textarea
                autoFocus
                onChange={(event) => onRecipientsChange(event.target.value)}
                placeholder="qa-lead@example.com, release-manager@example.com"
                rows={4}
                value={recipients}
              />
            </FormField>
          </div>
          <div className="resource-form-actions action-row">
            <button className="primary-button" disabled={isSubmitting} type="submit">
              <MailIcon />
              <span>{isSubmitting ? "Sending…" : "Send HTML report"}</span>
            </button>
            <button className="ghost-button" disabled={isSubmitting} onClick={onClose} type="button">
              Cancel
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}

function ExecutionApiStepDialog({
  step,
  detail,
  captures: capturedParams,
  note,
  status,
  canRun,
  isRunning,
  onClose,
  onRun
}: ExecutionApiStepDialogProps) {
  const [selectedJsonPath, setSelectedJsonPath] = useState<{ path: string; value: unknown } | null>(null);
  const requestHeaders = useMemo(
    () =>
      detail?.request?.headers
        ? Object.entries(detail.request.headers).sort(([left], [right]) => left.localeCompare(right))
        : (step.api_request?.headers || [])
            .filter((header) => header?.key)
            .map((header) => [String(header.key), String(header.value || "")] as const),
    [detail?.request?.headers, step.api_request?.headers]
  );
  const responseHeaders = useMemo(
    () => Object.entries(detail?.response?.headers || {}).sort(([left], [right]) => left.localeCompare(right)),
    [detail?.response?.headers]
  );
  const captures = useMemo(
    () => Object.entries(capturedParams || detail?.captures || {}).sort(([left], [right]) => left.localeCompare(right)),
    [capturedParams, detail?.captures]
  );
  const assertions = detail?.assertions || (step.api_request?.validations || []).map((validation) => ({
    kind: validation.kind || "status",
    passed: false,
    target: validation.target || null,
    expected: validation.expected || null,
    actual: null
  }));
  const requestBody =
    detail?.request?.body !== undefined
      ? detail.request.body
      : step.api_request?.body || null;
  const requestInfo = useMemo(
    () => ({
      method: (detail?.request?.method || step.api_request?.method || "GET") as NonNullable<NonNullable<TestStep["api_request"]>["method"]>,
      url: detail?.request?.url || step.api_request?.url || "",
      headers: requestHeaders.map(([key, value]) => ({ key, value })),
      body_mode: step.api_request?.body_mode || (requestBody ? "text" : "none"),
      body: requestBody || ""
    }),
    [detail?.request?.method, detail?.request?.url, requestBody, requestHeaders, step.api_request?.body_mode, step.api_request?.method, step.api_request?.url]
  );
  const responseJson = detail?.response?.json !== undefined ? detail.response.json : null;
  const responseBody = detail?.response
    ? detail.response.json !== undefined && detail.response.json !== null
      ? JSON.stringify(detail.response.json, null, 2)
      : detail.response.body || ""
    : "";
  const selectedJsonValue = useMemo(() => {
    if (!selectedJsonPath) {
      return "";
    }

    if (selectedJsonPath.value === null || selectedJsonPath.value === undefined) {
      return String(selectedJsonPath.value);
    }

    if (typeof selectedJsonPath.value === "string") {
      return selectedJsonPath.value;
    }

    try {
      return JSON.stringify(selectedJsonPath.value, null, 2);
    } catch {
      return String(selectedJsonPath.value);
    }
  }, [selectedJsonPath]);

  useEffect(() => {
    setSelectedJsonPath(null);
  }, [detail?.response?.body, detail?.response?.status, step.id]);

  return (
    <div className="modal-backdrop modal-backdrop--scroll" onClick={onClose} role="presentation">
      <div
        aria-label={`Step ${step.step_order} API execution details`}
        aria-modal="true"
        className="modal-card resource-modal-card automation-editor-modal execution-api-detail-modal"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
      >
        <div className="resource-modal-header">
          <div className="resource-modal-title">
            <div className="execution-api-detail-title-row">
              <span className="execution-step-type-chip">
                <StepTypeIcon size={14} type={step.step_type || "api"} />
              </span>
              <StatusBadge value={status} />
            </div>
            <h2 className="dialog-title">{`Step ${step.step_order} API details`}</h2>
            <p>{executionStepText(step.action) || "Inspect the snapped API request, latest response, and configured assertions for this run."}</p>
          </div>
          <button className="ghost-button" onClick={onClose} type="button">
            Close
          </button>
        </div>
        <div className="resource-form">
          <div className="resource-form-body execution-api-detail-body">
            <div className="metric-strip compact">
              <div className="mini-card">
                <strong>{detail?.request?.method || step.api_request?.method || "GET"}</strong>
                <span>Method</span>
              </div>
              <div className="mini-card">
                <strong>{detail?.response?.status ?? "Pending"}</strong>
                <span>Response</span>
              </div>
              <div className="mini-card">
                <strong>{assertions.length}</strong>
                <span>Assertions</span>
              </div>
            </div>

            <div className="automation-response-results">
              <div className="automation-response-header">
                <div>
                  <strong>API response capture</strong>
                  <span>Use the same HelloTest backend API step runner that powers engine-side API execution, then inspect the persisted request, response, assertions, and captures for this run.</span>
                </div>
                {canRun ? (
                  <button
                    className="primary-button automation-run-button"
                    disabled={isRunning}
                    onClick={onRun}
                    type="button"
                  >
                    <PlayIcon />
                    <span>{isRunning ? "Running..." : "Run step"}</span>
                  </button>
                ) : null}
              </div>

              <ApiRequestInfoDetails request={requestInfo} />

              <div className="automation-response-meta">
                <strong>Request</strong>
                <span>{detail?.request?.url || step.api_request?.url || "No request URL captured yet."}</span>
                {requestHeaders.length ? (
                  <details className="automation-request-details execution-api-header-details">
                    <summary>
                      <span>Request headers</span>
                      <strong>{requestHeaders.length}</strong>
                    </summary>
                    <div className="automation-request-details-body automation-response-headers">
                    {requestHeaders.map(([key, value]) => (
                      <span className="automation-response-header-chip" key={key}>
                        <strong>{key}</strong>
                        <span>{value}</span>
                      </span>
                    ))}
                    </div>
                  </details>
                ) : null}
                {requestBody ? (
                  <pre className="automation-code-block automation-code-block--compact automation-code-block--selection">
                    <code>{requestBody}</code>
                  </pre>
                ) : null}
              </div>

              <div className="automation-response-meta">
                <strong>Response</strong>
                <span>
                  {detail?.response
                    ? `${detail.response.status} ${detail.response.status_text || ""}`.trim()
                    : "This step has not returned a structured API response yet."}
                </span>
                {detail?.response ? (
                  <div className="automation-response-summary">
                    <span className={status === "passed" ? "automation-response-pill is-success" : status === "failed" ? "automation-response-pill is-danger" : "automation-response-pill"}>
                      {detail.response.status}
                    </span>
                    <span className="automation-response-pill">{detail.request?.method || step.api_request?.method || "GET"}</span>
                    <span className="automation-response-pill">{detail.response.headers?.["content-type"] || "Unknown content type"}</span>
                  </div>
                ) : null}
                {responseHeaders.length ? (
                  <details className="automation-request-details execution-api-header-details">
                    <summary>
                      <span>Response headers</span>
                      <strong>{responseHeaders.length}</strong>
                    </summary>
                    <div className="automation-request-details-body automation-response-headers">
                    {responseHeaders.map(([key, value]) => (
                      <span className="automation-response-header-chip" key={key}>
                        <strong>{key}</strong>
                        <span>{value}</span>
                      </span>
                    ))}
                    </div>
                  </details>
                ) : null}
                {responseBody ? (
                  <pre className="automation-code-block automation-code-block--compact automation-code-block--selection">
                    <code>{responseBody}</code>
                  </pre>
                ) : null}
              </div>

              {responseJson !== null && responseJson !== undefined ? (
                <div className="automation-response-tree-shell">
                  <div className="automation-response-tree-panel">
                    <strong>JSON path explorer</strong>
                    <span>Inspect the structured response with the same read format used in API authoring.</span>
                    <div className="api-response-tree">
                      <JsonResponseTreeNode
                        depth={0}
                        label="$"
                        onSelect={setSelectedJsonPath}
                        path="$"
                        selectedPath={selectedJsonPath?.path || ""}
                        value={responseJson}
                      />
                    </div>
                  </div>
                  <div className="automation-response-selection">
                    <strong>Selected node</strong>
                    <span>{selectedJsonPath ? selectedJsonPath.path : "Choose a node from the JSON hierarchy to inspect its value."}</span>
                    {selectedJsonPath ? (
                      <pre className="automation-code-block automation-code-block--compact automation-code-block--selection">
                        <code>{selectedJsonValue}</code>
                      </pre>
                    ) : null}
                    {captures.length ? (
                      <div className="automation-response-save">
                        <strong>Captured params</strong>
                        <span>These values were persisted from the response and are available to later steps in this run.</span>
                        <div className="automation-response-headers">
                          {captures.map(([key, value]) => (
                            <span className="automation-response-header-chip" key={key}>
                              <strong>{key}</strong>
                              <span>{value}</span>
                            </span>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </div>
                </div>
              ) : null}

              <div className="automation-response-meta">
                <strong>Assertions</strong>
                {assertions.length ? (
                  <div className="execution-api-assertion-list">
                    {assertions.map((assertion, index) => (
                      <div className="execution-api-assertion-row" key={`${assertion.kind}-${assertion.target || "status"}-${index}`}>
                        <span className={assertion.passed ? "automation-response-pill is-success" : "automation-response-pill is-danger"}>
                          {assertion.passed ? "Passed" : detail ? "Failed" : "Configured"}
                        </span>
                        <div className="execution-api-assertion-copy">
                          <strong>{assertion.kind}{assertion.target ? ` · ${assertion.target}` : ""}</strong>
                          <span>
                            {assertion.expected ? `Expected ${assertion.expected}` : "No explicit expected value"}
                            {detail && assertion.actual !== undefined && assertion.actual !== null ? ` · Actual ${assertion.actual}` : ""}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="empty-state compact">No assertions configured for this API step.</div>
                )}
              </div>

              {captures.length && (responseJson === null || responseJson === undefined) ? (
                <div className="automation-response-meta">
                  <strong>Captured values</strong>
                  <div className="automation-response-headers">
                    {captures.map(([key, value]) => (
                      <span className="automation-response-header-chip" key={key}>
                        <strong>{key}</strong>
                        <span>{value}</span>
                      </span>
                    ))}
                  </div>
                </div>
              ) : null}

              {note ? (
                <div className="automation-response-meta">
                  <strong>Run note</strong>
                  <pre className="automation-code-block automation-code-block--compact automation-code-block--selection">
                    <code>{note}</code>
                  </pre>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ExecutionAccordionChevronIcon() {
  return <IconChevronRight aria-hidden="true" size={18} stroke={1.8} />;
}

function ExecutionAssigneeChip({
  user,
  className = "",
  fallback = "Unassigned",
  labelOverride
}: {
  user?: { name?: string | null; email?: string | null } | null;
  className?: string;
  fallback?: string;
  labelOverride?: string;
}) {
  const label = labelOverride || (user ? resolveUserPrimaryLabel(user) : fallback);
  const detail = user ? resolveUserSecondaryLabel(user) : null;

  return (
    <span className={["execution-card-assignee", className].filter(Boolean).join(" ")} title={detail || label}>
      <span className="execution-card-assignee-avatar" aria-hidden="true">
        {resolveUserInitials(user)}
      </span>
      <span>{label}</span>
    </span>
  );
}

function resolveExecutionAssigneeSummary(execution?: Pick<Execution, "assigned_user" | "assigned_users"> | null) {
  const users = execution?.assigned_users?.length
    ? execution.assigned_users
    : execution?.assigned_user
      ? [execution.assigned_user]
      : [];

  if (!users.length) {
    return "Unassigned";
  }

  if (users.length <= 2) {
    return users.map((user) => resolveUserPrimaryLabel(user)).join(", ");
  }

  return `${users.slice(0, 2).map((user) => resolveUserPrimaryLabel(user)).join(", ")} +${users.length - 2}`;
}

export function ExecutionListCard({ execution, summary, impactSummary, liveNow, isActive, isSelected, onSelect, onToggleSelected }: {
  execution: Execution; summary: ExecutionRunSummary; impactSummary: ExecutionRunImpactSummary; liveNow: number;
  isActive: boolean; isSelected: boolean; canEdit: boolean; onSelect: () => void; onToggleSelected: () => void; onEdit: () => void;
}) {
  const totalScopedCases = execution.metrics?.total_cases ?? (executionScopeCaseCount(execution) || summary.caseCount || 0);
  const expectedOutcomeCount = execution.case_snapshots?.length ? executionExpectedOutcomeCount(execution) : totalScopedCases * executionDataIterationCount(execution);
  const resolvedOutcomeCount = Math.max(expectedOutcomeCount, summary.total, 0);
  const finalizedTotal = summary.passed + summary.failed + summary.blocked;
  const completedTotal = finalizedTotal + (summary.skipped || 0) + (summary.aborted || 0);
  const executionStatus = normalizeExecutionStatus(execution.status);
  const defects = execution.metrics?.defect_count ?? 0;
  const stories = runStoryCounts(execution, impactSummary);
  const visibleImpactedRequirements = impactSummary.impactedRequirements.filter((story) => story.failedCases > 0).slice(0, 3);
  const durationLabel = formatDuration(execution.metrics?.duration_ms ?? summary.totalDurationMs, "0s");
  const completionPercent = resolvedOutcomeCount ? Math.round(completedTotal / resolvedOutcomeCount * 100) : 0;
  const passRate = finalizedTotal ? Math.round(summary.passed / finalizedTotal * 100) : 0;
  return <article aria-label={`Open run ${execution.name || "Unnamed run"}`} className={`record-card tile-card execution-card execution-run-tile-card virtual-card${isActive ? " is-active" : ""}`} onClick={(event) => { if (!(event.target as HTMLElement).closest("a, button, input, label, select, textarea")) onSelect(); }}>
    <div className="tile-card-select-row execution-run-selection-row" onClick={(event) => event.stopPropagation()}>
      <label className="checkbox-field"><input aria-label={`Select ${execution.name || "Unnamed run"}`} checked={isSelected} onChange={onToggleSelected} type="checkbox" /><span className="sr-only">Select run</span></label>
      <ExecutionStatusIndicator status={executionStatus} />
    </div>
    <div className="tile-card-main">
      <div className="tile-card-header">
        <div aria-hidden="true" className={`record-card-icon execution status-${executionStatus}`}><ExecutionRunIcon /></div>
        <button aria-current={isActive ? "page" : undefined} className="tile-card-title-group tile-card-open-button" onClick={onSelect} type="button"><span className="tile-card-kicker">Run Name</span><strong>{execution.name || "Unnamed run"}</strong></button>
      </div>
      <div className="tile-card-progress-stack execution-run-progress-stack">
        <TileCardProgress breakdown={resolvedOutcomeCount ? buildRunOutcomeBreakdown(summary.passed, summary.failed, summary.blocked, resolvedOutcomeCount, summary) : undefined} displayValue={resolvedOutcomeCount ? `${completionPercent}%` : "No cases"} label="Run completion" title={`${completedTotal}/${resolvedOutcomeCount} case outcomes finalized, including skipped and aborted outcomes`} tone={!resolvedOutcomeCount ? "neutral" : completionPercent === 100 ? "success" : "info"} value={resolvedOutcomeCount ? completionPercent : null} />
        <TileCardProgress breakdown={finalizedTotal ? buildRunOutcomeBreakdown(summary.passed, summary.failed, summary.blocked, finalizedTotal) : undefined} displayValue={finalizedTotal ? `${passRate}%` : "No results"} label="Pass rate" title={finalizedTotal ? `${summary.passed} of ${finalizedTotal} passed, failed, or blocked results passed` : "No passed, failed, or blocked results yet"} tone={!finalizedTotal ? "neutral" : passRate >= 85 ? "success" : passRate >= 65 ? "warning" : "danger"} value={finalizedTotal ? passRate : null} />
      </div>
      <div className="tile-card-metric-grid execution-tile-metrics" aria-label="Run metrics">
        <TileCardMetric label="Cases" title="Distinct test cases in this run" value={totalScopedCases} tone={totalScopedCases ? "info" : "neutral"} />
        <TileCardMetric label="Duration" title="Elapsed run duration" value={durationLabel} />
        <TileCardMetric label="Defects" title="Distinct defects linked to this run's recorded results" value={defects} tone={defects ? "danger" : "neutral"} />
        <TileCardMetric label="Story impact" title="Distinct stories linked to failed cases / all stories associated with cases in this run" value={`${stories.failed}/${stories.total}`} tone={stories.failed ? "warning" : "neutral"} />
      </div>
      {visibleImpactedRequirements.length ? <div className="execution-card-impact-strip" aria-label="Run impacted stories"><strong>Impacted stories</strong><div className="execution-card-impact-chips">{visibleImpactedRequirements.map((story) => <span className="execution-impact-chip is-impacted" key={story.id}><b>{story.title}</b><small>{story.failedCases} failed</small></span>)}</div></div> : null}
    </div>

  </article>;
}

function ExecutionScheduleCard({
  schedule,
  isActive,
  isSelected,
  liveNow,
  onSelect,
  onToggleSelected,
  resolvedCaseCount
}: {
  schedule: ExecutionSchedule;
  isActive: boolean;
  isSelected: boolean;
  liveNow: number;
  onSelect: () => void;
  onToggleSelected: () => void;
  resolvedCaseCount: number;
}) {
  const assigneeLabel = resolveExecutionAssigneeSummary(schedule);
  const cadenceLabel = formatScheduleCadence(schedule.cadence);
  const assigneeCount = new Set([
    ...(schedule.assigned_to_ids || []),
    ...(schedule.assigned_to ? [schedule.assigned_to] : [])
  ].filter(Boolean)).size;
  const contextAttachedCount = [
    schedule.test_environment_id,
    schedule.test_configuration_id,
    schedule.test_data_set_id
  ].filter(Boolean).length;
  const nextRunTimestamp = toTimestamp(schedule.next_run_at);
  const launchSignals = [
    { label: "active schedule", ready: schedule.is_active },
    { label: "test scope", ready: resolvedCaseCount > 0 },
    { label: "upcoming run time", ready: nextRunTimestamp !== null && nextRunTimestamp >= liveNow }
  ];
  const completedLaunchCount = launchSignals.filter((signal) => signal.ready).length;
  const launchPercent = Math.round((completedLaunchCount / launchSignals.length) * 100);
  const contextPercent = Math.round((contextAttachedCount / 3) * 100);
  const missingLaunchLabels = launchSignals.filter((signal) => !signal.ready).map((signal) => signal.label);
  const launchTitle = missingLaunchLabels.length
    ? `Still needed: ${missingLaunchLabels.join(", ")}`
    : "The schedule is active with resolved scope and an upcoming run time.";

  return (
    <article
      aria-label={`Open Scheduled Run ${schedule.id}: ${schedule.name}`}
      className={isActive ? "record-card tile-card execution-card execution-schedule-tile-card virtual-card is-active" : "record-card tile-card execution-card execution-schedule-tile-card virtual-card"}
      onClick={(event) => {
        if ((event.target as HTMLElement).closest("a, button, input, label, select, textarea")) return;
        onSelect();
      }}
    >
      <div className="tile-card-select-row" onClick={(event) => event.stopPropagation()}>
        <label className="checkbox-field">
          <input
            aria-label={`Select ${schedule.name}`}
            checked={isSelected}
            onChange={onToggleSelected}
            type="checkbox"
          />
          <span className="sr-only">Select schedule</span>
        </label>
        <EntityIdBadge icon={<ExecutionScheduleIcon />} value={schedule.id} />
      </div>
      <div className="tile-card-main execution-schedule-card-main">
        <div className="tile-card-header">
          <div aria-hidden="true" className={`record-card-icon execution status-${schedule.is_active ? "queued" : "aborted"}`}>
            <ExecutionScheduleIcon />
          </div>
          <button aria-current={isActive ? "page" : undefined} className="tile-card-title-group tile-card-open-button" onClick={onSelect} type="button">
            <strong>{schedule.name}</strong>
            <span className="execution-card-assignee">{schedule.is_active ? `${cadenceLabel} cadence` : `Inactive · ${cadenceLabel} cadence`}</span>
          </button>
          <ExecutionStatusIndicator status={schedule.is_active ? "queued" : "aborted"} />
        </div>

        <div className="tile-card-progress-stack execution-schedule-progress-stack">
          <TileCardProgress
            breakdown={{ total: launchSignals.length, segments: [
              { key: "passed", label: "Ready", count: completedLaunchCount },
              { key: "pending", label: "Not ready", count: launchSignals.length - completedLaunchCount }
            ] }}
            displayValue={`${completedLaunchCount}/${launchSignals.length} ready`}
            label="Launch readiness"
            title={launchTitle}
            tone={launchPercent === 100 ? "success" : launchPercent >= 67 ? "info" : "warning"}
            value={launchPercent}
          />
          <TileCardProgress
            breakdown={{ total: 3, segments: [
              { key: "covered", label: "Attached", count: contextAttachedCount },
              { key: "uncovered", label: "Not attached", count: 3 - contextAttachedCount }
            ] }}
            displayValue={`${contextAttachedCount}/3 attached`}
            label="Run context"
            title={`${contextAttachedCount} of 3 run context resources attached: environment, configuration, and test data`}
            tone={contextPercent === 100 ? "success" : contextAttachedCount ? "info" : "warning"}
            value={contextPercent}
          />
        </div>

        <div className="tile-card-metric-grid execution-schedule-tile-metrics" aria-label={`${schedule.name} schedule metrics`}>
          <TileCardMetric
            label="Suites"
            title={`${schedule.suite_ids.length} suite${schedule.suite_ids.length === 1 ? "" : "s"} in schedule scope`}
            tone={schedule.suite_ids.length ? "info" : "neutral"}
            value={schedule.suite_ids.length}
          />
          <TileCardMetric
            label="Cases"
            title={`${resolvedCaseCount} unique test case${resolvedCaseCount === 1 ? "" : "s"} resolved across direct and Suite scope`}
            tone={resolvedCaseCount ? "info" : "warning"}
            value={resolvedCaseCount}
          />
          <TileCardMetric
            label="Assignees"
            title={`Assigned to ${assigneeLabel}`}
            tone={assigneeCount ? "success" : "warning"}
            value={assigneeCount}
          />
          <TileCardMetric
            label="Context"
            title={`${contextAttachedCount} of 3 run context resources attached`}
            tone={contextPercent === 100 ? "success" : contextAttachedCount ? "info" : "warning"}
            value={`${contextAttachedCount}/3`}
          />
        </div>

      </div>

    </article>
  );
}

function WorkspaceTransactionCard({
  transaction,
  isActive,
  isSelected,
  onSelect,
  onToggleSelected,
  appTypeNameById,
  projectNameById
}: {
  transaction: WorkspaceTransaction;
  isActive: boolean;
  isSelected: boolean;
  onSelect: () => void;
  onToggleSelected: () => void;
  appTypeNameById: Record<string, string>;
  projectNameById: Record<string, string>;
}) {
  const presentation = describeWorkspaceTransaction(transaction, {
    appTypeNameById,
    projectNameById
  });
  const summary = resolveWorkspaceTransactionSummary(transaction, presentation);
  const scopeLabel = transaction.app_type_id
    ? appTypeNameById[transaction.app_type_id] || "App type scope"
    : transaction.project_id
      ? projectNameById[transaction.project_id] || "Project scope"
      : "Workspace scope";
  const statusTone: BoardStatusTone =
    transaction.status === "queued" || transaction.status === "running" || transaction.status === "failed"
      ? transaction.status
      : "completed";
  const latestActivityLabel = formatExecutionTimestamp(
    transaction.latest_event_at || transaction.updated_at || transaction.created_at,
    "Timestamp unavailable"
  );
  const actionLabel = formatWorkspaceTransactionActionLabel(transaction.action);

  return (
    <div className={isActive ? "record-card tile-card execution-card workspace-transaction-card virtual-card is-active" : "record-card tile-card execution-card workspace-transaction-card virtual-card"}>
      <div className="tile-card-select-row">
        <label className="checkbox-field">
          <input
            aria-label={`Select ${transaction.title}`}
            checked={isSelected}
            onChange={onToggleSelected}
            type="checkbox"
          />
          <span className="sr-only">Select batch process</span>
        </label>
      </div>
      <button className="tile-card-main execution-schedule-card-button workspace-transaction-card-button" onClick={onSelect} type="button">
        <div className="tile-card-header">
          <div aria-hidden="true" className={`record-card-icon execution status-${statusTone}`}>
            {presentation.icon}
          </div>
          <div className="tile-card-title-group">
            <strong>{transaction.title}</strong>
            <span className="execution-card-assignee execution-card-assignee--wrap">{presentation.eyebrow}</span>
          </div>
          <ExecutionStatusIndicator status={statusTone} />
        </div>

        <div className="execution-card-facts" aria-label="Batch process facts">
          <ExecutionCardFact ariaLabel={`Scope ${scopeLabel}`} label={scopeLabel} title={`Scope ${scopeLabel}`}>
            <ActivityIcon />
          </ExecutionCardFact>
          <ExecutionCardFact ariaLabel={`Action ${actionLabel}`} label={actionLabel} title={`Action ${actionLabel}`}>
            <ExecutionRunIcon />
          </ExecutionCardFact>
          <ExecutionCardFact ariaLabel={`${transaction.event_count || 0} logged events`} label={formatCountLabel(transaction.event_count || 0, "event")} title={`${transaction.event_count || 0} logged events`}>
            <ExecutionScopeIcon />
          </ExecutionCardFact>
          <ExecutionCardFact ariaLabel={`Last activity ${latestActivityLabel}`} label={latestActivityLabel} title={`Last activity ${latestActivityLabel}`}>
            <ExecutionTimeIcon />
          </ExecutionCardFact>
        </div>

        <p className="tile-card-description workspace-transaction-card-summary">{summary}</p>
      </button>

      <div className="action-row execution-schedule-actions workspace-transaction-card-actions">
        <button className="ghost-button" onClick={onSelect} type="button">
          <OpenIcon />
          <span>Open details</span>
        </button>
      </div>
    </div>
  );
}

function ExecutionCardFact({
  title,
  ariaLabel,
  label,
  tone = "neutral",
  children
}: {
  title: string;
  ariaLabel: string;
  label?: string;
  tone?: "neutral" | "info" | "success" | "danger" | "warning";
  children: ReactNode;
}) {
  return (
    <span
      aria-label={ariaLabel}
      className={`execution-card-fact tone-${tone}`}
      title={title}
    >
      <span aria-hidden="true" className="execution-card-fact-icon">
        {children}
      </span>
      {label ? <span className="execution-card-fact-label">{label}</span> : null}
    </span>
  );
}

function ExecutionStatusIndicator({ status }: { status: BoardStatusTone }) {
  const tooltip = boardStatusTooltip(status);

  return (
    <span aria-label={tooltip} className={`execution-card-status status-${status}`} title={tooltip}>
      <ExecutionStatusIcon status={status} />
    </span>
  );
}

function ExecutionStatusIcon({ status }: { status: BoardStatusTone }) {
  if (status === "queued") {
    return (
      <svg aria-hidden="true" fill="none" height="16" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.9" viewBox="0 0 24 24" width="16">
        <circle cx="12" cy="12" r="8" />
        <path d="M12 8v4l3 2" />
      </svg>
    );
  }

  if (status === "running") {
    return (
      <svg aria-hidden="true" fill="none" height="16" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.9" viewBox="0 0 24 24" width="16">
        <path d="M5 12a7 7 0 0 1 7-7" />
        <path d="M19 12a7 7 0 0 1-7 7" />
        <path d="m13 8 4 0 0-4" />
        <path d="m11 16-4 0 0 4" />
      </svg>
    );
  }

  if (status === "completed" || status === "passed") {
    return (
      <svg aria-hidden="true" fill="none" height="16" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" width="16">
        <path d="M6 12.5 10 16l8-8" />
      </svg>
    );
  }

  if (status === "blocked") {
    return (
      <svg aria-hidden="true" fill="none" height="16" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.9" viewBox="0 0 24 24" width="16">
        <circle cx="12" cy="12" r="8" />
        <path d="M8 12h8" />
      </svg>
    );
  }

  if (status === "failed") {
    return (
      <svg aria-hidden="true" fill="none" height="16" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.9" viewBox="0 0 24 24" width="16">
        <path d="m12 4 8 14H4z" />
        <path d="M12 9v4" />
        <path d="M12 17h.01" />
      </svg>
    );
  }

  return (
    <svg aria-hidden="true" fill="none" height="16" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.9" viewBox="0 0 24 24" width="16">
      <circle cx="12" cy="12" r="8" />
      <path d="M9 9l6 6" />
      <path d="M15 9l-6 6" />
    </svg>
  );
}

function ExecutionRunIcon() {
  return (
    <svg aria-hidden="true" fill="none" height="20" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.9" viewBox="0 0 24 24" width="20">
      <path d="m9 7 8 5-8 5z" />
    </svg>
  );
}

function LiveRunIcon() {
  return (
    <ExecutionIconShell>
      <rect height="10" rx="2" width="16" x="4" y="5" />
      <path d="M8 19h8" />
      <path d="M12 15v4" />
      <path d="M10 9.5 13.5 12 10 14.5z" />
    </ExecutionIconShell>
  );
}

function ExecutionEditIcon() {
  return (
    <ExecutionIconShell>
      <path d="M4 20h4l10-10-4-4L4 16z" />
      <path d="m12 6 4 4" />
    </ExecutionIconShell>
  );
}

function ExecutionStartIcon() {
  return (
    <ExecutionIconShell>
      <path d="m9 7 8 5-8 5z" />
    </ExecutionIconShell>
  );
}

function ExecutionCompleteIcon() {
  return (
    <ExecutionIconShell>
      <path d="M6 12.5 10 16l8-8" />
    </ExecutionIconShell>
  );
}

function ExecutionAbortIcon() {
  return (
    <ExecutionIconShell>
      <circle cx="12" cy="12" r="8" />
      <rect height="5" rx="0.8" width="5" x="9.5" y="9.5" />
    </ExecutionIconShell>
  );
}

function ExecutionRerunIcon() {
  return (
    <ExecutionIconShell>
      <path d="M20 12a8 8 0 1 1-2.3-5.6" />
      <path d="M20 4v6h-6" />
    </ExecutionIconShell>
  );
}

function ExecutionScheduleIcon() {
  return (
    <ExecutionIconShell>
      <rect height="15" rx="2" width="16" x="4" y="5" />
      <path d="M8 3v4" />
      <path d="M16 3v4" />
      <path d="M4 10h16" />
      <path d="m10 15 1.5 1.5L15 13" />
    </ExecutionIconShell>
  );
}

function ExecutionReleaseIcon() {
  return (
    <ExecutionIconShell>
      <path d="M5 5h14v14H5z" />
      <path d="M8 9h8" />
      <path d="M8 13h5" />
      <path d="M15 15h2" />
    </ExecutionIconShell>
  );
}

function ExecutionBuildIcon() {
  return (
    <ExecutionIconShell>
      <path d="M8 7h8" />
      <path d="M7 12h10" />
      <path d="M9 17h6" />
      <path d="M5 9v6" />
      <path d="M19 9v6" />
    </ExecutionIconShell>
  );
}

function ExecutionAssigneeIcon() {
  return (
    <ExecutionIconShell>
      <path d="M4 20v-1.2A4.8 4.8 0 0 1 8.8 14h6.4a4.8 4.8 0 0 1 4.8 4.8V20" />
      <circle cx="12" cy="8.2" r="3.2" />
    </ExecutionIconShell>
  );
}

function ExecutionDeleteIcon() {
  return (
    <ExecutionIconShell>
      <path d="M4 7h16" />
      <path d="M9 7V5.8A1.8 1.8 0 0 1 10.8 4h2.4A1.8 1.8 0 0 1 15 5.8V7" />
      <path d="M7 7l.8 11.1A2 2 0 0 0 9.8 20h4.4a2 2 0 0 0 2-1.9L17 7" />
      <path d="M10 11v5" />
      <path d="M14 11v5" />
    </ExecutionIconShell>
  );
}

function ExecutionIconShell({ children }: { children: ReactNode }) {
  return <svg aria-hidden="true" fill="none" height="14" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" viewBox="0 0 24 24" width="14">{children}</svg>;
}

function TestCaseBoardIcon() {
  return <TestCaseIcon size={14} strokeWidth={1.8} />;
}

function ExecutionSuiteIcon() {
  return <TestSuiteIcon size={14} />;
}

function ExecutionScopeIcon() {
  return (
    <TestCaseBoardIcon />
  );
}

function ExecutionProgressFactsIcon() {
  return (
    <ExecutionIconShell>
      <path d="M4 16h16" />
      <path d="M7 13 10 10l3 2 4-5" />
    </ExecutionIconShell>
  );
}

function ExecutionRiskIcon() {
  return (
    <ExecutionIconShell>
      <path d="m12 4 8 14H4z" />
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
    </ExecutionIconShell>
  );
}

function ExecutionRequirementImpactIcon() {
  return (
    <ExecutionIconShell>
      <path d="M5 5h14v14H5z" />
      <path d="M8 9h8" />
      <path d="M8 13h5" />
      <path d="m15 14 2 2 3-4" />
    </ExecutionIconShell>
  );
}

function ExecutionReferenceIcon() {
  return (
    <ExecutionIconShell>
      <path d="M10 13a4 4 0 0 0 5.7.1l2-2a4 4 0 0 0-5.6-5.6l-1.1 1.1" />
      <path d="M14 11a4 4 0 0 0-5.7-.1l-2 2a4 4 0 0 0 5.6 5.6l1.1-1.1" />
    </ExecutionIconShell>
  );
}

function ExecutionTimeIcon() {
  return (
    <ExecutionIconShell>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 8v5l3 2" />
    </ExecutionIconShell>
  );
}

function ExecutionPriorityIcon() {
  return (
    <ExecutionIconShell>
      <path d="M7 20V5" />
      <path d="M7 5h10l-2 4 2 4H7" />
    </ExecutionIconShell>
  );
}

function ExecutionStepsIcon() {
  return (
    <ExecutionIconShell>
      <path d="M8 7h10" />
      <path d="M8 12h10" />
      <path d="M8 17h10" />
      <circle cx="5" cy="7" r="1" fill="currentColor" stroke="none" />
      <circle cx="5" cy="12" r="1" fill="currentColor" stroke="none" />
      <circle cx="5" cy="17" r="1" fill="currentColor" stroke="none" />
    </ExecutionIconShell>
  );
}



function ExecutionStepPassIcon() {
  return (
    <ExecutionIconShell>
      <path d="m7.5 12.5 3 3 6-7" />
    </ExecutionIconShell>
  );
}

function ExecutionStepFailIcon() {
  return (
    <ExecutionIconShell>
      <path d="m8 8 8 8" />
      <path d="m16 8-8 8" />
    </ExecutionIconShell>
  );
}

function ExecutionEvidenceImageIcon() {
  return (
    <ExecutionIconShell>
      <rect height="14" rx="2" width="16" x="4" y="5" />
      <circle cx="9" cy="10" r="1.4" fill="currentColor" stroke="none" />
      <path d="m7 17 3-3 2.5 2.5 2.5-3 2 3.5" />
    </ExecutionIconShell>
  );
}

function ExecutionEvidencePreviewIcon() {
  return (
    <ExecutionIconShell>
      <path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z" />
      <circle cx="12" cy="12" r="2.5" />
    </ExecutionIconShell>
  );
}

function ExecutionEvidenceDeleteIcon() {
  return (
    <ExecutionIconShell>
      <path d="M4 7h16" />
      <path d="M9 7V5.8A1.8 1.8 0 0 1 10.8 4h2.4A1.8 1.8 0 0 1 15 5.8V7" />
      <path d="M7 7l.8 11.1A2 2 0 0 0 9.8 20h4.4a2 2 0 0 0 2-1.9L17 7" />
      <path d="M10 11v5" />
      <path d="M14 11v5" />
    </ExecutionIconShell>
  );
}

function ExecutionOverviewOrb({
  passedCount,
  failedCount,
  blockedCount,
  totalCount,
  passPercent
}: {
  passedCount: number;
  failedCount: number;
  blockedCount: number;
  totalCount: number;
  passPercent: number;
}) {
  const safeTotal = Math.max(totalCount, 1);
  const pendingCount = Math.max(totalCount - passedCount - failedCount - blockedCount, 0);
  const passedStop = (passedCount / safeTotal) * 100;
  const failedStop = passedStop + (failedCount / safeTotal) * 100;
  const blockedStop = failedStop + (blockedCount / safeTotal) * 100;
  const orbBackground = `conic-gradient(
    #1aa96b 0% ${passedStop}%,
    #d04668 ${passedStop}% ${failedStop}%,
    #2d66e6 ${failedStop}% ${blockedStop}%,
    rgba(94, 116, 146, 0.16) ${blockedStop}% 100%
  )`;

  return (
    <div className="execution-overview-orb-shell">
      <div className="execution-overview-orb" style={{ background: orbBackground }}>
        <div className="execution-overview-orb-core">
          <strong>{passPercent}%</strong>
          <span>Pass rate</span>
        </div>
      </div>
      <div className="execution-overview-legend">
        <span className="execution-legend-item tone-total">{totalCount} total</span>
        <span className="execution-legend-item tone-passed">{passedCount} passed</span>
        <span className="execution-legend-item tone-failed">{failedCount} failed</span>
        <span className="execution-legend-item tone-blocked">{blockedCount} blocked</span>
        <span className="execution-legend-item tone-pending">{pendingCount} queued</span>
      </div>
    </div>
  );
}

function ExecutionSuiteCaseCard({
  testCase,
  suiteName,
  stepCount,
  durationLabel,
  caseStatus,
  assignedUser,
  isActive,
  isNext,
  onSelect,
  getInstanceStatus,
  onSelectInstance,
  selectedInstanceKey
}: {
  testCase: ExecutionCaseView;
  suiteName: string;
  stepCount: number;
  durationLabel: string;
  caseStatus: ExecutionResult["status"] | "queued";
  assignedUser?: Execution["assigned_user"];
  isActive: boolean;
  isNext: boolean;
  onSelect: () => void;
  getInstanceStatus: (instance: ExecutionCaseInstanceView) => ExecutionResult["status"] | "queued";
  onSelectInstance: (instanceKey: string) => void;
  selectedInstanceKey: string;
}) {
  const dataSetInstances = testCase.data_set_instances.filter((instance) => Boolean(instance.test_data_set_id));

  return (
    <div
      aria-pressed={isActive}
      className={[
        "record-card tile-card test-case-card execution-case-card execution-board-case-card",
        isActive ? "is-active" : "",
        !isActive && isNext ? "is-next" : ""
      ].filter(Boolean).join(" ")}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) {
          return;
        }

        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect();
        }
      }}
      role="button"
      tabIndex={0}
    >
      <button
        aria-label={`View ${testCase.title}`}
        className="ghost-button test-case-card-eye-action execution-case-eye-action"
        onClick={(event) => {
          event.stopPropagation();
          onSelect();
        }}
        title="View test case"
        type="button"
      >
        <EyeIcon size={16} />
      </button>
      <div className="tile-card-main">
        <div className="tile-card-header">
          <div
            aria-hidden="true"
            className={`record-card-icon execution-board-icon status-${caseStatus}`}
            title={boardStatusTooltip(caseStatus)}
          >
            <TestCaseBoardIcon />
          </div>
          <div className="tile-card-title-group">
            <strong title={testCase.title}>{testCase.title}</strong>
            <div className="execution-case-card-meta">
              <span className="tile-card-kicker">{isNext ? "Next recommended case" : suiteName || "Suite case"}</span>
              <ExecutionAssigneeChip className="execution-card-assignee--compact" user={assignedUser} />
            </div>
          </div>
          <ExecutionStatusIndicator status={caseStatus} />
        </div>
        {dataSetInstances.length ? (
          <div className="execution-case-instance-list" aria-label={`${testCase.title} Data Set row instances`} role="list">
            <div className="execution-case-instance-list-header">
              <span>
                <strong>{dataSetInstances[0].test_data_set_name || "Data Set"}</strong>
                <small>{dataSetInstances[0].data_set_source === "test_case" ? "Linked to test case" : dataSetInstances[0].data_set_source === "suite" ? "Inherited suite data" : "Run data set"}</small>
              </span>
              <span>{dataSetInstances.length} instance{dataSetInstances.length === 1 ? "" : "s"}</span>
            </div>
            <div className="execution-case-instance-scroll">
              {dataSetInstances.map((instance) => {
                const instanceStatus = getInstanceStatus(instance);
                const rowValues = Object.entries(instance.data_set_row_snapshot || {});
                const rowNumber = (instance.data_set_iteration_index ?? 0) + 1;
                return (
                  <button
                    aria-current={selectedInstanceKey === instance.instance_key ? "true" : undefined}
                    className={selectedInstanceKey === instance.instance_key ? "execution-case-instance-row is-active" : "execution-case-instance-row"}
                    key={instance.instance_key}
                    onClick={(event) => {
                      event.stopPropagation();
                      onSelectInstance(instance.instance_key);
                    }}
                    role="listitem"
                    type="button"
                  >
                    <span className="execution-case-instance-identity">
                      <strong>Row {rowNumber}</strong>
                      <StatusBadge value={instanceStatus} />
                    </span>
                    <span className="execution-case-instance-values">
                      {rowValues.length ? rowValues.map(([key, value]) => (
                        <span className="execution-case-instance-value" key={`${instance.instance_key}-${key}`}>
                          <small>{key}</small>
                          <b>{value || "—"}</b>
                        </span>
                      )) : <small>No row values were captured.</small>}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}
        <div className="execution-card-facts" aria-label={`${testCase.title} facts`}>
          <ExecutionCardFact
            ariaLabel={`Priority P${testCase.priority || 3}`}
            label={`P${testCase.priority || 3}`}
            title={`Priority P${testCase.priority || 3}`}
          >
            <ExecutionPriorityIcon />
          </ExecutionCardFact>
          <ExecutionCardFact
            ariaLabel={`${stepCount} steps`}
            label={String(stepCount)}
            title={`${stepCount} steps`}
          >
            <ExecutionStepsIcon />
          </ExecutionCardFact>
          <ExecutionCardFact
            ariaLabel={`Case duration ${durationLabel}`}
            label={durationLabel}
            title={`Case duration ${durationLabel}`}
            tone={caseStatus === "blocked" ? "warning" : "neutral"}
          >
            <ExecutionTimeIcon />
          </ExecutionCardFact>
        </div>
      </div>
    </div>
  );
}

function ExecutionStepGroupRow({
  canPreviewAutomation,
  name,
  kind,
  isExpanded,
  stepCount,
  onPreviewCode,
  onToggle
}: {
  canPreviewAutomation: boolean;
  name: string;
  kind: TestStep["group_kind"];
  isExpanded: boolean;
  stepCount: number;
  onPreviewCode: () => void;
  onToggle: () => void;
}) {
  const stepKind = getExecutionStepKindMeta(kind || "local");

  return (
    <div className={["execution-step-group-row", kind === "reusable" ? "is-shared-group" : "is-local-group"].join(" ")} role="row">
      <div className="execution-step-group-toggle-button">
        <button
          aria-expanded={isExpanded}
          className="execution-step-group-button-main"
          onClick={onToggle}
          type="button"
        >
          <span className="execution-step-group-label" role="cell">
            <span className="execution-step-group-label-main">
              <span className="execution-step-group-toggle">
                <span aria-hidden="true" className={isExpanded ? "execution-step-group-chevron is-expanded" : "execution-step-group-chevron"}>
                  <ExecutionAccordionChevronIcon />
                </span>
                <span aria-hidden="true" className={kind === "reusable" ? "step-group-icon is-shared" : "step-group-icon is-local"}>
                  <SharedGroupLevelIcon kind={kind} />
                </span>
                <strong>{name}</strong>
              </span>
            </span>
            <span>{stepKind.detail} · {isExpanded ? "Expanded" : "Collapsed"}</span>
          </span>
        </button>
        <span className="execution-step-group-meta" role="cell">
          <span className="execution-step-group-count">{stepCount} step{stepCount === 1 ? "" : "s"}</span>
          {canPreviewAutomation ? (
            <button
              aria-label={`Preview automation for ${name}`}
              className="step-inline-tool is-active"
              onClick={onPreviewCode}
              title="Preview group automation"
              type="button"
            >
              <AutomationCodeIcon />
            </button>
          ) : null}
        </span>
      </div>
    </div>
  );
}

function ExecutionAttemptDialog({ result, runName, canViewEvidence, onClose }: {
  result: ExecutionResult; runName: string; canViewEvidence: boolean; onClose: () => void;
}) {
  const run = useQuery({ queryKey: ["execution", result.execution_id], queryFn: () => api.executions.get(result.execution_id) });
  const steps = (run.data?.step_snapshots || []).filter(step => step.test_case_id === result.test_case_id).map(toStepView);
  return <RunReviewDialog title="Case attempt" runName={runName} onClose={onClose}>
    <div className="execution-attempt-summary"><StatusBadge value={result.status} /><span>{formatDuration(result.duration_ms, "0s")} active time</span><span>{result.data_set_iteration_index != null ? `Data row ${result.data_set_iteration_index + 1}` : "Default case instance"}</span></div>
    {result.lifecycle_history?.length ? <ol className="execution-case-history-events" aria-label="Attempt activity">
      {result.lifecycle_history.slice().reverse().map((event, index) => <li key={`${event.at}-${index}`}><strong>{event.actor_name || event.actor_email || "Tester"}</strong><span>{event.action.replace(/_/g, " ")} · {BOARD_STATUS_META[event.to_status as BoardStatusTone]?.label || event.to_status}</span><time dateTime={event.at}>{formatExecutionTimestamp(event.at)}</time></li>)}
    </ol> : null}
    {run.isLoading ? <LoadingState label="Loading saved case steps" /> : run.isError ? <p role="alert">Saved steps could not be loaded. The recorded logs remain available.</p> : null}
    <ExecutionStructuredLogView logsJson={result.logs} steps={steps} />
    <CaseRunAttachmentPanel resultId={result.id} executionId={result.execution_id} testCaseId={result.test_case_id} iterationKey={result.data_set_iteration_key || undefined} canView={canViewEvidence} canUpload={false} canDelete={false} ensureResult={async () => result} legacyEvidence={parseExecutionLogs(result.logs).stepEvidence || {}} />
  </RunReviewDialog>;
}

function ExecutionStructuredStepText({ label, text, values }: {
  label: string;
  text: string | null | undefined;
  values: Record<string, string>;
}) {
  const source = normalizeGherkinParameterReferences(gherkinDescriptionToPlainText(text));
  const content = source.split(/\r?\n/).map((line) => {
    const match = matchGherkinKeyword(line);
    return match?.kind === "step" ? match.rest.trimStart() : line;
  }).join("\n");
  return <span className="execution-structured-step-field">
    <strong>{label}</strong>
    <StepParameterizedText text={content} values={values} fallback="Not specified" />
  </span>;
}

function ExecutionBehaviorText({ text, values, fallbackKeyword }: {
  text: string | null | undefined;
  values: Record<string, string>;
  fallbackKeyword: "Given" | "When" | "Then";
}) {
  const source = normalizeGherkinParameterReferences(gherkinDescriptionToPlainText(text));
  if (!source.trim()) return null;
  return <span className="execution-behavior-lines">{source.split(/\r?\n/).map((line, index) => {
    const match = matchGherkinKeyword(line);
    const keyword = match?.kind === "step" ? match.keyword : index === 0 ? fallbackKeyword : "";
    const body = match?.kind === "step" ? match.rest.trimStart() : line;
    return <span className="execution-behavior-line" key={index}>
      {keyword ? <strong className="gherkin-keyword">{keyword}</strong> : null}
      <StepParameterizedText text={body} values={values} fallback=" " />
    </span>;
  })}</span>;
}

function ExecutionStepCard({
  step,
  viewMode,
  status,
  note,
  evidence,
  canCreateEvidence,
  canDeleteEvidence,
  canAttachNetworkAutomation,
  canRecordResult,
  canViewEvidence,
  canViewAutomationCode,
  apiDetail,
  webDetail,
  automationDetail,
  captures,
  canInspectApi,
  canPreviewAutomation,
  isRunningApi,
  parameterValues,
  isLocked,
  isSelected,
  isExpanded,
  isUploadingEvidence,
  isOpeningEvidence,
  onToggle,
  onToggleSelect,
  onPass,
  onFail,
  onDeleteEvidence,
  onInspectApi,
  onAttachNetworkAutomation,
  onRunStep,
  onNoteBlur,
  onUploadEvidence,
  onViewEvidence,
  onPreviewCode,
  availableBugs,
  defectIds,
  isLinkingDefects,
  onDefectsChange
}: {
  step: TestStep;
  viewMode: "structured" | "gherkin";
  status: ExecutionResult["status"] | "queued";
  note: string;
  evidence: ExecutionStepEvidence | null;
  canCreateEvidence: boolean;
  canDeleteEvidence: boolean;
  canAttachNetworkAutomation: boolean;
  canRecordResult: boolean;
  canViewEvidence: boolean;
  canViewAutomationCode: boolean;
  apiDetail: ExecutionStepApiDetail | null;
  webDetail: ExecutionStepWebDetail | null;
  automationDetail: ExecutionStepAutomationDetail | null;
  captures: Record<string, string>;
  canInspectApi: boolean;
  canPreviewAutomation: boolean;
  isRunningApi: boolean;
  parameterValues: Record<string, string>;
  isLocked: boolean;
  isSelected: boolean;
  isExpanded: boolean;
  isUploadingEvidence: boolean;
  isOpeningEvidence: boolean;
  onToggle: () => void;
  onToggleSelect: (checked: boolean) => void;
  onPass: () => void;
  onFail: () => void;
  onDeleteEvidence: () => void;
  onInspectApi: () => void;
  onAttachNetworkAutomation: (network: NonNullable<ExecutionStepWebDetail["network"]>) => void;
  onRunStep: () => void;
  onNoteBlur: (value: string) => void;
  onUploadEvidence: (file: File) => void;
  onViewEvidence: () => void;
  onPreviewCode: () => void;
  availableBugs: Issue[];
  defectIds: string[];
  isLinkingDefects: boolean;
  onDefectsChange: (defectIds: string[]) => void;
}) {
  const evidenceInputRef = useRef<HTMLInputElement | null>(null);
  const noteInputRef = useRef<HTMLTextAreaElement | null>(null);
  const resizeNoteInput = useCallback(() => {
    const input = noteInputRef.current;
    if (!input || CSS.supports("field-sizing", "content")) return;
    input.style.height = "auto";
    const style = getComputedStyle(input);
    input.style.height = `${input.scrollHeight + parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth)}px`;
  }, []);
  useEffect(() => {
    const input = noteInputRef.current;
    if (!input || CSS.supports("field-sizing", "content")) return;
    resizeNoteInput();
    let width = input.getBoundingClientRect().width;
    const observer = new ResizeObserver(() => {
      const nextWidth = input.getBoundingClientRect().width;
      if (nextWidth !== width) {
        width = nextWidth;
        resizeNoteInput();
      }
    });
    observer.observe(input);
    return () => observer.disconnect();
  }, [isExpanded, note, resizeNoteInput]);
  const resolvedKind = step.group_name ? step.group_kind || "local" : step.group_kind;
  const stepKind = getExecutionStepKindMeta(resolvedKind);
  const trimmedNote = note.trim();
  const hasEvidence = hasExecutionEvidence(evidence);
  const captureEntries = useMemo(
    () => Object.entries(captures || {}).sort(([left], [right]) => left.localeCompare(right)),
    [captures]
  );
  const consoleCount = webDetail?.console?.length || 0;
  const networkCount = webDetail?.network?.length || 0;
  const linkedDefectIds = [...new Set(defectIds.map(String))];
  const linkedDefectIdSet = new Set(linkedDefectIds);
  const availableDefectOptions = availableBugs.filter((bug) => !linkedDefectIdSet.has(String(bug.id)));
  const stepTypeLabel = String(step.step_type || (canInspectApi ? "api" : "web")).toUpperCase();
  const toneClass = [
    "step-card execution-step-card execution-behavior-step",
    isExpanded ? "is-expanded" : "",
    status === "passed" ? "step-status-passed" : "",
    status === "failed" ? "step-status-failed" : "",
    status === "blocked" ? "step-status-blocked" : "",
    stepKind.tone === "shared" ? "is-shared-step" : "",
    stepKind.tone === "local" ? "is-local-step" : ""
  ].filter(Boolean).join(" ");

  return (
    <article className={toneClass} data-step-id={step.id} data-step-view={viewMode}>
      <div className="step-card-top">
        <label className="checkbox-field step-card-select">
          <input
            aria-label={`Select step ${step.step_order}`}
            checked={isSelected}
            disabled={isLocked || !canRecordResult}
            onChange={(event) => onToggleSelect(event.target.checked)}
            type="checkbox"
          />
        </label>
        <button
          aria-label={isExpanded ? `Hide step ${step.step_order} details` : `Show step ${step.step_order} details`}
          className="step-card-toggle execution-step-card-toggle"
          onClick={onToggle}
          type="button"
        >
          <div className="step-card-summary execution-step-card-summary">
            <div className="execution-step-card-summary-head">
              <div className="step-card-summary-top">
                <span className="execution-step-type-chip" title={`Step type: ${stepTypeLabel}`}>
                  <StepTypeIcon size={14} type={step.step_type || (canInspectApi ? "api" : "web")} />
                </span>
                <strong>Step {step.step_order}</strong>
                {resolvedKind ? (
                  <span className={resolvedKind === "reusable" ? "execution-step-group-chip is-shared" : "execution-step-group-chip is-local"}>
                    {resolvedKind === "reusable" ? "Shared Step Group" : "Local group"}
                  </span>
                ) : null}
                <StatusBadge value={status} />
              </div>
            </div>
            <span className="execution-step-card-primary">
              {viewMode === "gherkin" ? (
                <>
                  <ExecutionBehaviorText text={step.action} values={parameterValues} fallbackKeyword={(step.group_name || "").trim().toLowerCase() === "preconditions" ? "Given" : "When"} />
                  {step.expected_result ? <ExecutionBehaviorText text={step.expected_result} values={parameterValues} fallbackKeyword="Then" /> : null}
                </>
              ) : (
                <>
                  <ExecutionStructuredStepText label="Action" text={step.action} values={parameterValues} />
                  <ExecutionStructuredStepText label="Expected result" text={step.expected_result} values={parameterValues} />
                </>
              )}
            </span>
          </div>
        </button>
        <div className="execution-step-card-summary-tools">
          <button
            aria-label={`Mark step ${step.step_order} passed`}
            className={status === "passed" ? "execution-step-mark-button is-pass is-active" : "execution-step-mark-button is-pass"}
            disabled={isLocked || !canRecordResult}
            onClick={onPass}
            title="Mark step passed"
            type="button"
          >
            <IconCheck aria-hidden="true" size={17} stroke={2.25} />
          </button>
          <button
            aria-label={`Mark step ${step.step_order} failed`}
            className={status === "failed" ? "execution-step-mark-button is-fail is-active" : "execution-step-mark-button is-fail"}
            disabled={isLocked || !canRecordResult}
            onClick={onFail}
            title="Mark step failed"
            type="button"
          >
            <IconX aria-hidden="true" size={17} stroke={2.25} />
          </button>
          <button
            aria-label={`Evidence and comments for step ${step.step_order}`}
            aria-expanded={isExpanded}
            className="execution-step-evidence-summary"
            onClick={onToggle}
            title={`${hasEvidence ? "Evidence attached" : "Attach evidence"} · ${trimmedNote ? "Comment saved" : "Add comment"}`}
            type="button"
          >
            <IconPhoto aria-hidden="true" size={16} />
            <span>Evidence</span>
            {hasEvidence || trimmedNote ? <b>{Number(hasEvidence) + Number(Boolean(trimmedNote))}</b> : null}
            <IconChevronDown aria-hidden="true" size={14} />
          </button>
          {canInspectApi ? (
            <button
              aria-label={`Inspect API details for step ${step.step_order}`}
              className="execution-step-type-chip execution-step-type-chip--button"
              onClick={onInspectApi}
              title="Inspect API request, response, and assertions"
              type="button"
            >
              <StepTypeIcon size={14} type={step.step_type || "api"} />
            </button>
          ) : null}
          {canPreviewAutomation ? (
            <InlineStepToolButton
              ariaLabel={`Preview automation for step ${step.step_order}`}
              className="is-active"
              onClick={onPreviewCode}
              title="Preview step automation"
            >
              <AutomationCodeIcon />
            </InlineStepToolButton>
          ) : null}
        </div>
      </div>

      {isExpanded ? (
        <div className="step-card-body execution-step-card-body">
          {captureEntries.length ? (
            <div className="execution-step-card-block">
              <div className="execution-step-card-block-head">
                <span>Output params</span>
                <span>{captureEntries.length} captured in this step</span>
              </div>
              <div className="execution-step-param-chip-list">
                {captureEntries.map(([key, value]) => (
                  <span className="execution-step-param-chip" key={key}>
                    <strong>{formatExecutionParameterToken(key)}</strong>
                    <span>{value || "—"}</span>
                  </span>
                ))}
              </div>
            </div>
          ) : null}

          {webDetail ? (
            <div className="execution-step-card-block">
              <div className="execution-step-card-block-head">
                <span>Runtime trace</span>
                <span>{webDetail.provider || "web"} · {consoleCount} console · {networkCount} network</span>
              </div>
              <div className="execution-step-param-chip-list">
                {webDetail.url ? (
                  <span className="execution-step-param-chip">
                    <strong>URL</strong>
                    <span>{webDetail.url}</span>
                  </span>
                ) : null}
                {typeof webDetail.duration_ms === "number" ? (
                  <span className="execution-step-param-chip">
                    <strong>Duration</strong>
                    <span>{formatDuration(webDetail.duration_ms, DEFAULT_DURATION_LABEL)}</span>
                  </span>
                ) : null}
                {consoleCount ? (
                  <span className="execution-step-param-chip">
                    <strong>Console</strong>
                    <span>{webDetail.console?.slice(-1)[0]?.text || `${consoleCount} entries`}</span>
                  </span>
                ) : null}
                {networkCount ? (
                  <span className="execution-step-param-chip">
                    <strong>Network</strong>
                    <span>{webDetail.network?.slice(-1)[0]?.url || `${networkCount} entries`}</span>
                  </span>
                ) : null}
              </div>
              {networkCount ? (
                <div className="execution-network-call-list">
                  {(webDetail.network || []).slice(-6).map((entry, index) => (
                    <div className="execution-network-call-row" key={`${entry.method || "GET"}:${entry.url || index}:${entry.timestamp || index}`}>
                      <strong>{entry.method || "GET"} {entry.status || "pending"}</strong>
                      <span>{entry.url || "Unknown URL"}</span>
                    </div>
                  ))}
                  {canAttachNetworkAutomation ? <button className="ghost-button compact" onClick={() => onAttachNetworkAutomation(webDetail.network || [])} type="button">
                    <StepTypeIcon size={14} type="api" />
                    <span>Add API steps to this case</span>
                  </button> : null}
                </div>
              ) : null}
            </div>
          ) : null}

          {canViewAutomationCode && automationDetail?.code ? (
            <div className="execution-step-card-block">
              <div className="execution-step-card-block-head">
                <span>Automation code</span>
                <span>
                  {automationDetail.engine || step.step_type || "step"} · {automationDetail.status || status}
                  {automationDetail.error_line ? ` · line ${automationDetail.error_line}` : automationDetail.active_line ? ` · line ${automationDetail.active_line}` : ""}
                </span>
              </div>
              <pre className="execution-automation-code-block">
                {automationDetail.code.split(/\r?\n/).map((line, index) => {
                  const lineNumber = index + 1;
                  const isHotLine = lineNumber === automationDetail.error_line || lineNumber === automationDetail.active_line;
                  return (
                    <span className={isHotLine ? "is-hot-line" : ""} key={`${lineNumber}:${line}`}>
                      <strong>{lineNumber}</strong>
                      <code>{line || " "}</code>
                    </span>
                  );
                })}
              </pre>
              {automationDetail.error_message ? (
                <div className="inline-message error-message">
                  <span>{automationDetail.error_message}</span>
                </div>
              ) : null}
            </div>
          ) : null}

          <div className="execution-step-card-block execution-step-card-block--notes">
            <div className="execution-step-card-block-head">
              <span className="execution-step-card-label">Comments</span>
              <span>{trimmedNote ? "Saved on blur" : "Write observations, defect IDs, or runtime notes"}</span>
            </div>
            <textarea
              className="execution-step-note-input"
              ref={noteInputRef}
              defaultValue={note}
              disabled={isLocked}
              key={`${step.id}:${note}`}
              onInput={resizeNoteInput}
              onBlur={(event) => {
                const raw = event.target.value;
                if (raw.trim() !== (note || "").trim()) {
                  onNoteBlur(raw);
                }
              }}
              placeholder="Add an observation…"
              rows={2}
            />
          </div>

          <div className="execution-step-defect-links">
            <div className="execution-step-card-block-head">
              <span className="execution-step-card-label">Linked defects</span>
              <span>{isLinkingDefects ? "Saving links…" : `${linkedDefectIds.length} linked to this step, case, and run`}</span>
            </div>
            <select
              aria-label={`Link a defect to step ${step.step_order}`}
              disabled={isLocked || isLinkingDefects || !availableDefectOptions.length}
              onChange={(event) => {
                if (event.target.value) {
                  onDefectsChange([...linkedDefectIds, event.target.value]);
                  event.currentTarget.value = "";
                }
              }}
              value=""
            >
              <option value="">{availableDefectOptions.length ? "Link an existing defect…" : "No more project defects to link"}</option>
              {availableDefectOptions.map((bug) => (
                <option key={bug.id} value={bug.id}>
                  {[bug.jira_bug_key || bug.id, bug.title].filter(Boolean).join(" · ")}
                </option>
              ))}
            </select>
            {linkedDefectIds.length ? (
              <div className="execution-step-defect-chip-list">
                {linkedDefectIds.map((defectId) => {
                  const bug = availableBugs.find((candidate) => String(candidate.id) === defectId);
                  return (
                    <span className="execution-step-defect-chip" key={defectId}>
                      <span title={bug?.title || defectId}>{bug?.jira_bug_key || bug?.title || defectId}</span>
                      <button
                        aria-label={`Unlink ${bug?.jira_bug_key || bug?.title || defectId} from step ${step.step_order}`}
                        disabled={isLocked || isLinkingDefects}
                        onClick={() => onDefectsChange(linkedDefectIds.filter((id) => id !== defectId))}
                        type="button"
                      >
                        <IconX aria-hidden="true" size={14} stroke={2.2} />
                      </button>
                    </span>
                  );
                })}
              </div>
            ) : (
              <span className="execution-step-evidence-empty">No defects linked to this step</span>
            )}
          </div>

          <div className="execution-step-evidence-cell">
            <input
              accept="image/*,video/*,application/pdf,text/plain,text/csv,application/json,application/xml,text/xml,application/zip"
              hidden
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.currentTarget.value = "";

                if (file) {
                  onUploadEvidence(file);
                }
              }}
              ref={evidenceInputRef}
              disabled={!canCreateEvidence || (hasEvidence && !canDeleteEvidence)}
              type="file"
            />
            <div className="execution-step-evidence-actions">
              {canCreateEvidence && (!hasEvidence || canDeleteEvidence) ? (<button
                className="execution-step-evidence-button"
                disabled={isLocked || isUploadingEvidence || !canCreateEvidence || (hasEvidence && !canDeleteEvidence)}
                onClick={() => evidenceInputRef.current?.click()}
                title={!canCreateEvidence
                  ? "Permission required: result.manage and attachment.create"
                  : hasEvidence && !canDeleteEvidence
                    ? "Replacing evidence also requires attachment.delete"
                    : evidence ? "Replace evidence" : "Attach evidence"}
                type="button"
              >
                <ExecutionEvidenceImageIcon />
                <span>{isUploadingEvidence ? "Uploading…" : evidence ? "Replace file" : "Attach file"}</span>
              </button>) : null}
              {evidence ? (
                <>
                  {canViewEvidence ? (<button
                    className="execution-step-evidence-link"
                    disabled={isUploadingEvidence || isOpeningEvidence || !canViewEvidence}
                    onClick={onViewEvidence}
                    title={canViewEvidence ? evidence.fileName || "View saved evidence" : "Permission required: result.view and attachment.view"}
                    type="button"
                  >
                    <ExecutionEvidencePreviewIcon />
                    <span>{isOpeningEvidence ? "Loading evidence…" : evidence.fileName || "View file"}</span>
                  </button>) : null}
                  {canDeleteEvidence ? (<button
                    className="execution-step-evidence-delete"
                    disabled={isLocked || isUploadingEvidence || !canDeleteEvidence}
                    onClick={onDeleteEvidence}
                    title={canDeleteEvidence ? "Delete saved evidence" : "Permission required: result.manage and attachment.delete"}
                    type="button"
                  >
                    <ExecutionEvidenceDeleteIcon />
                    <span>Delete file</span>
                  </button>) : null}
                </>
              ) : (
                <span className="execution-step-evidence-empty">No evidence attached</span>
              )}
            </div>
          </div>

          <div className="execution-step-card-footer">
            {canInspectApi ? (
              <button className="ghost-button" onClick={onInspectApi} type="button">
                <StepTypeIcon size={14} type={step.step_type || "api"} />
                <span>{apiDetail ? "Inspect API detail" : "Open API panel"}</span>
              </button>
            ) : (
              <span className="execution-step-card-footer-note">{stepKind.detail}</span>
            )}
            {isRunningApi ? <span className="execution-step-card-footer-note">Step execution in progress…</span> : null}
          </div>
        </div>
      ) : null}
    </article>
  );
}

function ExecutionAutomationStepCard({
  step,
  status,
  code,
  automationDetail,
  webDetail,
  apiDetail,
  note
}: {
  step: TestStep;
  status: ExecutionStepAutomationDetail["status"] | ExecutionStepStatus | "queued";
  code: string;
  automationDetail: ExecutionStepAutomationDetail | null;
  webDetail: ExecutionStepWebDetail | null;
  apiDetail: ExecutionStepApiDetail | null;
  note: string;
}) {
  const consoleCount = webDetail?.console?.length || 0;
  const networkCount = webDetail?.network?.length || 0;
  const captureCount = Object.keys(webDetail?.captures || apiDetail?.captures || {}).length;
  const activeLine = automationDetail?.error_line || automationDetail?.active_line || null;
  const latestConsole = webDetail?.console?.slice(-1)[0]?.text || "";
  const latestNetwork = webDetail?.network?.slice(-1)[0];
  const httpStatus = apiDetail?.response?.status;

  return (
    <article className="execution-console-code-item execution-console-code-card" role="listitem">
      <div className="execution-console-code-item-head">
        <div className="execution-console-code-title">
          <strong>Step {step.step_order}</strong>
          <span>{executionStepText(step.action) || "No action captured"}</span>
        </div>
        <StatusBadge value={status || "queued"} />
      </div>

      <div className="execution-console-code-runtime" aria-label={`Runtime details for step ${step.step_order}`}>
        <span>
          <strong>Engine</strong>
          <span>{automationDetail?.engine || webDetail?.provider || step.step_type || "step"}</span>
        </span>
        {webDetail?.duration_ms !== undefined ? (
          <span>
            <strong>Duration</strong>
            <span>{formatDuration(webDetail.duration_ms, DEFAULT_DURATION_LABEL)}</span>
          </span>
        ) : null}
        {httpStatus ? (
          <span>
            <strong>HTTP</strong>
            <span>{httpStatus}</span>
          </span>
        ) : null}
        {consoleCount ? (
          <span>
            <strong>Console</strong>
            <span>{consoleCount}</span>
          </span>
        ) : null}
        {networkCount ? (
          <span>
            <strong>Network</strong>
            <span>{networkCount}</span>
          </span>
        ) : null}
        {captureCount ? (
          <span>
            <strong>Captures</strong>
            <span>{captureCount}</span>
          </span>
        ) : null}
      </div>

      <pre className="execution-automation-code-block">
        {code.split(/\r?\n/).map((line, index) => {
          const lineNumber = index + 1;
          const isHotLine = lineNumber === activeLine;
          return (
            <span className={isHotLine ? "is-hot-line" : ""} key={`${step.id}:${lineNumber}`}>
              <strong>{lineNumber}</strong>
              <code>{line || " "}</code>
            </span>
          );
        })}
      </pre>

      {automationDetail?.error_message ? (
        <div className="inline-message error-message">
          <span>{automationDetail.error_message}</span>
        </div>
      ) : null}

      {latestConsole || latestNetwork || webDetail?.url || note ? (
        <div className="execution-console-code-trace">
          {webDetail?.url ? <span><strong>URL</strong>{webDetail.url}</span> : null}
          {latestConsole ? <span><strong>Console</strong>{latestConsole}</span> : null}
          {latestNetwork ? <span><strong>Network</strong>{latestNetwork.method || "GET"} {latestNetwork.status || "pending"} · {latestNetwork.url}</span> : null}
          {note ? <span><strong>Manual note</strong>{note}</span> : null}
        </div>
      ) : null}
    </article>
  );
}

function ExecutionAiAnalysisPanel({
  analysis,
  canRun,
  canPreviewClusters,
  isRunning,
  isPreviewingClusters,
  onRun,
  onPreviewClusters
}: {
  analysis: ExecutionAiAnalysis | null;
  canRun: boolean;
  canPreviewClusters: boolean;
  isRunning: boolean;
  isPreviewingClusters: boolean;
  onRun: () => void;
  onPreviewClusters: () => void;
}) {
  return (
    <div className="execution-ai-analysis-panel">
      <div className="execution-ai-analysis-actions">
        <button className="ghost-button" disabled={isRunning || !canRun} onClick={onRun} type="button">
          <SparkIcon />
          <span>{isRunning ? "Analyzing…" : analysis ? "Refresh analysis" : "Run evidence analysis"}</span>
        </button>
        <button className="ghost-button" disabled={isPreviewingClusters || !canPreviewClusters} onClick={onPreviewClusters} type="button">
          <SparkIcon />
          <span>{isPreviewingClusters ? "Clustering…" : "Preview failure clusters"}</span>
        </button>
        {analysis?.integration?.name ? (
          <span className="count-pill">
            {analysis.integration.model ? `${analysis.integration.name} · ${analysis.integration.model}` : analysis.integration.name}
          </span>
        ) : null}
      </div>

      {analysis ? (
        <div className="execution-ai-analysis-response">
          <div className="execution-ai-analysis-meta">
            <SparkIcon />
            <span>{formatExecutionTimestamp(analysis.generatedAt, "Timestamp unavailable")}</span>
          </div>
          <pre>{analysis.response}</pre>
        </div>
      ) : (
        <div className="empty-state compact">No evidence analysis has been recorded yet. Complete the run, then analyze the stored results and trace links.</div>
      )}
    </div>
  );
}

function ExecutionStructuredLogView({
  logsJson,
  steps,
  onOpenEvidence
}: {
  logsJson: string | null;
  steps: TestStep[];
  onOpenEvidence?: (step: TestStep, evidence: ExecutionStepEvidence) => void;
}) {
  const { session } = useAuth();
  const featureFlagsQuery = useFeatureFlags(Boolean(session));
  const canViewAutomationCode = resolveCanViewAutomationCode(session, featureFlagsQuery.data);
  const parsed = parseExecutionLogs(logsJson);
  const stepCaptures = mergeExecutionStepCaptures(parsed.stepCaptures || {}, parsed.stepApiDetails || {});
  const apiDetails = Object.values(parsed.stepApiDetails || {});
  const webDetails = Object.values(parsed.stepWebDetails || {});
  const automationDetails = Object.values(parsed.stepAutomationDetails || {});
  const noteCount = parsed.stepNotes ? Object.values(parsed.stepNotes).filter((value) => String(value || "").trim()).length : 0;
  const statusCount = parsed.stepStatuses ? Object.keys(parsed.stepStatuses).length : 0;
  const failedStepCount = parsed.stepStatuses ? Object.values(parsed.stepStatuses).filter((status) => status === "failed").length : 0;
  const blockedStepCount = parsed.stepStatuses ? Object.values(parsed.stepStatuses).filter((status) => status === "blocked").length : 0;
  const evidenceEntries = Object.values(parsed.stepEvidence || {});
  const imageEvidenceCount = evidenceEntries.filter((evidence) => evidenceMimeType(evidence).startsWith("image/")).length;
  const videoEvidenceCount = evidenceEntries.filter((evidence) => evidenceMimeType(evidence).startsWith("video/")).length;
  const captureCount = Object.values(stepCaptures).reduce((count, captures) => count + Object.keys(captures || {}).length, 0);
  const apiStepCount = apiDetails.length;
  const apiAssertionCount = apiDetails.reduce((count, detail) => count + (detail?.assertions?.length || 0), 0);
  const failedApiAssertionCount = apiDetails.reduce((count, detail) => count + (detail?.assertions || []).filter((assertion) => assertion && !assertion.passed).length, 0);
  const consoleCount = webDetails.reduce((count, detail) => count + (detail?.console?.length || 0), 0);
  const networkCount = webDetails.reduce((count, detail) => count + (detail?.network?.length || 0), 0);
  const networkIssueCount = webDetails.reduce(
    (count, detail) => count + (detail?.network || []).filter((entry) => entry?.error || Number(entry?.status || 0) >= 400).length,
    0
  );
  const automationStepCount = automationDetails.length;
  const hasNotes = parsed.stepNotes && Object.keys(parsed.stepNotes).length > 0;
  const hasStatuses = parsed.stepStatuses && Object.keys(parsed.stepStatuses).length > 0;
  const hasEvidence = parsed.stepEvidence && Object.keys(parsed.stepEvidence).length > 0;
  const hasCaptures = Object.keys(stepCaptures).length > 0;
  const hasWebDetails = parsed.stepWebDetails && Object.keys(parsed.stepWebDetails).length > 0;
  const hasApiDetails = parsed.stepApiDetails && Object.keys(parsed.stepApiDetails).length > 0;
  const hasAutomationDetails = parsed.stepAutomationDetails && Object.keys(parsed.stepAutomationDetails).length > 0;
  const hasAiAnalysis = Boolean(parsed.aiAnalysis?.response);
  const formatTraceJson = (value: unknown) => JSON.stringify(value, null, 2);

  if (!hasNotes && !hasStatuses && !hasEvidence && !hasCaptures && !hasWebDetails && !hasApiDetails && !hasAutomationDetails && !hasAiAnalysis && !logsJson?.trim()) {
    return <span className="execution-log-empty">No structured step data recorded yet.</span>;
  }

  const rows = steps
    .map((step, index) => {
      const st = parsed.stepStatuses?.[step.id];
      const nt = parsed.stepNotes?.[step.id];
      const evidence = parsed.stepEvidence?.[step.id];
      const rawApiDetail = parsed.stepApiDetails?.[step.id];
      const apiDetail = rawApiDetail && !canViewAutomationCode
        ? { ...rawApiDetail, request: undefined }
        : rawApiDetail;
      const webDetail = parsed.stepWebDetails?.[step.id];
      const rawAutomationDetail = parsed.stepAutomationDetails?.[step.id];
      const automationDetail = rawAutomationDetail && !canViewAutomationCode
        ? { ...rawAutomationDetail, code: undefined }
        : rawAutomationDetail;
      const captures = Object.entries(stepCaptures[step.id] || {}).sort(([left], [right]) => left.localeCompare(right));
      const apiStatus = apiDetail?.response?.status;
      const apiAssertions = apiDetail?.assertions || [];
      const apiFailedAssertions = apiAssertions.filter((assertion) => assertion && !assertion.passed).length;

      if (!st && !nt && !evidence && !captures.length && !apiDetail && !webDetail && !automationDetail) {
        if (!isStepGroupStart(steps, index)) {
          return null;
        }
      }
      return (
        <Fragment key={step.id}>
          {isStepGroupStart(steps, index) ? (
            <div className="execution-structured-log-row execution-structured-log-row--group">
              <strong>{step.group_name || "Step group"}</strong>
              <span aria-hidden="true" className={step.group_kind === "reusable" ? "step-group-icon is-shared" : "step-group-icon is-local"}>
                <SharedGroupLevelIcon kind={step.group_kind} />
              </span>
              <span className="execution-structured-note">
                {step.group_kind === "reusable" ? "Shared Step Group snapshot" : "Local group snapshot"}
              </span>
            </div>
          ) : null}
          {st || nt || evidence || captures.length || apiDetail || webDetail || automationDetail ? (
            <article className="execution-structured-log-row execution-structured-log-row--verbose">
              <div className="execution-verbose-log-head">
                <div>
                  <strong>Step {step.step_order}</strong>
                  <span>{executionStepText(step.action) || "No step action snapshot"}</span>
                </div>
                {st ? <StatusBadge value={st} /> : null}
              </div>
              {step.expected_result ? (
                <div className="execution-verbose-log-block">
                  <small>Expected result</small>
                  <span>{executionStepText(step.expected_result)}</span>
                </div>
              ) : null}
              {nt ? (
                <div className="execution-verbose-log-block">
                  <small>Runtime note</small>
                  <span>{nt}</span>
                </div>
              ) : null}
              {captures.length ? (
                <div className="execution-verbose-log-block">
                  <small>Captured output params</small>
                  <div className="execution-structured-capture-list">
                    {captures.map(([key, value]) => (
                      <span className="execution-structured-capture-chip" key={key}>
                        <strong>{formatExecutionParameterToken(key)}</strong>
                        <span>{value || "—"}</span>
                      </span>
                    ))}
                  </div>
                </div>
              ) : null}
              {apiDetail ? (
                <details className="execution-verbose-log-details" open={apiFailedAssertions > 0 || Number(apiStatus || 0) >= 400}>
                  <summary>
                    <span>API trace</span>
                    <small>
                      {[
                        apiDetail.request?.method || "API",
                        apiDetail.request?.url || null,
                        apiStatus ? `HTTP ${apiStatus}` : "no response",
                        apiAssertions.length ? `${apiAssertions.length} assertion${apiAssertions.length === 1 ? "" : "s"}` : null,
                        apiFailedAssertions ? `${apiFailedAssertions} failed` : null
                      ].filter(Boolean).join(" · ")}
                    </small>
                  </summary>
                  <pre>{formatTraceJson(apiDetail)}</pre>
                </details>
              ) : null}
              {webDetail ? (
                <details className="execution-verbose-log-details" open={networkIssueCount > 0}>
                  <summary>
                    <span>Browser trace</span>
                    <small>
                      {[
                        webDetail.provider || "web",
                        webDetail.url || null,
                        `${webDetail.console?.length || 0} console`,
                        `${webDetail.network?.length || 0} network`
                      ].filter(Boolean).join(" · ")}
                    </small>
                  </summary>
                  <pre>{formatTraceJson(webDetail)}</pre>
                </details>
              ) : null}
              {automationDetail ? (
                <details className="execution-verbose-log-details" open={Boolean(automationDetail.error_message)}>
                  <summary>
                    <span>Automation trace</span>
                    <small>
                      {[
                        automationDetail.engine || automationDetail.provider || "automation",
                        automationDetail.status || null,
                        typeof automationDetail.active_line === "number" ? `line ${automationDetail.active_line}` : null,
                        automationDetail.error_message || null
                      ].filter(Boolean).join(" · ")}
                    </small>
                  </summary>
                  <pre>{formatTraceJson(automationDetail)}</pre>
                </details>
              ) : null}
              {evidence ? (
                <button
                  className="execution-structured-evidence-button"
                  onClick={() => evidence && onOpenEvidence?.(step, evidence)}
                  type="button"
                >
                  <ExecutionEvidencePreviewIcon />
                  <span>{evidence.fileName || "View image evidence"}</span>
                </button>
              ) : null}
            </article>
          ) : null}
        </Fragment>
      );
    })
    .filter(Boolean);

  return (
    <div className="execution-structured-log">
      <div className="execution-log-evidence-grid" aria-label="Execution evidence summary">
        <span>
          <strong>{statusCount}/{steps.length}</strong>
          <small>{failedStepCount || blockedStepCount ? `${failedStepCount} failed · ${blockedStepCount} blocked` : "step outcomes"}</small>
        </span>
        <span>
          <strong>{noteCount + imageEvidenceCount + videoEvidenceCount}</strong>
          <small>{noteCount} notes · {imageEvidenceCount} images · {videoEvidenceCount} videos</small>
        </span>
        <span>
          <strong>{apiStepCount}</strong>
          <small>{apiAssertionCount} API assertions · {failedApiAssertionCount} failed</small>
        </span>
        <span>
          <strong>{webDetails.length}</strong>
          <small>{consoleCount} console · {networkCount} network · {networkIssueCount} issues</small>
        </span>
        <span>
          <strong>{captureCount}</strong>
          <small>captured runtime values</small>
        </span>
        <span>
          <strong>{automationStepCount}</strong>
          <small>automation code traces</small>
        </span>
      </div>
      {parsed.aiAnalysis ? (
        <div className="execution-structured-log-row execution-structured-log-row--ai">
          <strong>Evidence analysis</strong>
          <span className="execution-structured-note">
            {formatExecutionTimestamp(parsed.aiAnalysis.generatedAt, "Timestamp unavailable")}
          </span>
          <span className="execution-structured-note">{parsed.aiAnalysis.response}</span>
        </div>
      ) : null}
      {rows.length ? rows : null}
      {!rows.length && !parsed.aiAnalysis && logsJson?.trim()
        ? canViewAutomationCode
          ? <pre className="execution-log-raw">{logsJson}</pre>
          : <span className="execution-log-empty">Unstructured log text is hidden because it cannot be safely classified without automation code access.</span>
        : null}
    </div>
  );
}

function ExecutionStructuredLogSummary({ logsJson }: { logsJson: string | null }) {
  const parsed = parseExecutionLogs(logsJson);
  const stepCaptures = mergeExecutionStepCaptures(parsed.stepCaptures || {}, parsed.stepApiDetails || {});
  const noteCount = parsed.stepNotes ? Object.values(parsed.stepNotes).filter(Boolean).length : 0;
  const statusCount = parsed.stepStatuses ? Object.keys(parsed.stepStatuses).length : 0;
  const evidenceCount = parsed.stepEvidence ? Object.keys(parsed.stepEvidence).length : 0;
  const apiTraceCount = parsed.stepApiDetails ? Object.keys(parsed.stepApiDetails).length : 0;
  const webTraceCount = parsed.stepWebDetails ? Object.keys(parsed.stepWebDetails).length : 0;
  const automationTraceCount = parsed.stepAutomationDetails ? Object.keys(parsed.stepAutomationDetails).length : 0;
  const aiAnalysisCount = parsed.aiAnalysis ? 1 : 0;
  const captureCount = Object.values(stepCaptures).reduce((count, captures) => count + Object.keys(captures || {}).length, 0);
  if (!noteCount && !statusCount && !evidenceCount && !captureCount && !apiTraceCount && !webTraceCount && !automationTraceCount && !aiAnalysisCount) {
    return <span className="execution-log-summary-muted">No step details</span>;
  }
  const parts = [
    statusCount ? `${statusCount} step result${statusCount === 1 ? "" : "s"}` : null,
    noteCount ? `${noteCount} note${noteCount === 1 ? "" : "s"}` : null,
    evidenceCount ? `${evidenceCount} media item${evidenceCount === 1 ? "" : "s"}` : null,
    captureCount ? `${captureCount} captured value${captureCount === 1 ? "" : "s"}` : null,
    apiTraceCount ? `${apiTraceCount} API trace${apiTraceCount === 1 ? "" : "s"}` : null,
    webTraceCount ? `${webTraceCount} web trace${webTraceCount === 1 ? "" : "s"}` : null,
    automationTraceCount ? `${automationTraceCount} automation trace${automationTraceCount === 1 ? "" : "s"}` : null,
    aiAnalysisCount ? "Evidence analysis" : null
  ].filter(Boolean);

  return (
    <span className="execution-log-summary">
      {parts.join(" · ")}
    </span>
  );
}

function ExecutionMinimizedRail({
  label,
  count,
  onExpand
}: {
  label: string;
  count?: number;
  onExpand: () => void;
}) {
  return (
    <button aria-label={`Expand ${label}`} className="execution-panel-rail" onClick={onExpand} type="button">
      <span className="execution-panel-rail-label">{label}</span>
      <span className="execution-panel-rail-meta">{typeof count === "number" ? count : "Show"}</span>
    </button>
  );
}

export function ExecutionCreateModal({
  projects,
  projectId,
  onProjectChange,
  appTypes,
  appTypeId,
  onAppTypeChange,
  executionCreateMode,
  onExecutionCreateModeChange,
  executionStartMode,
  onExecutionStartModeChange,
  executionStartDate,
  executionEndDate,
  onExecutionStartDateChange,
  onExecutionEndDateChange,
  executionParallelEnabled,
  executionParallelCount,
  onExecutionParallelEnabledChange,
  onExecutionParallelCountChange,
  selectedProject,
  selectedAppType,
  scopeSuites,
  selectedSuiteIds,
  selectedDirectCaseIds = [],
  onDirectCaseSelectionChange,
  onDirectCaseItemsResolved,
  onDirectCaseResolutionChange,
  directCaseSelectionMessage,
  executionName,
  selectedEnvironmentId,
  selectedConfigurationId,
  selectedDataSetId,
  dataOptions, onDataOptionsChange,
  selectedExecutionAssigneeIds,
  executionRelease,
  executionSprint,
  executionBuild,
  releaseOptions,
  sprintOptions,
  buildOptions,
  assigneeOptions,
  integrations,
  executionHookDraft,
  libraryCases,
  metadataByCaseId = {},
  smartExecutionIntegrationId,
  smartExecutionReleaseScope,
  smartExecutionAdditionalContext,
  smartExecutionRequirementOptions,
  smartExecutionRequirementSearch,
  smartExecutionPreview,
  selectedSmartRequirementIds,
  selectedSmartExecutionCaseIds,
  smartExecutionPreviewMessage,
  smartExecutionPreviewTone,
  onExecutionNameChange,
  onExecutionReleaseChange,
  onExecutionSprintChange,
  onExecutionBuildChange,
  onExecutionHookDraftChange,
  onEnvironmentChange,
  onConfigurationChange,
  onDataSetChange,
  onAssigneeChange,
  onSuiteSelectionChange,
  onPreviewSmartExecution,
  onSmartExecutionIntegrationChange,
  onSmartExecutionReleaseScopeChange,
  onSmartExecutionAdditionalContextChange,
  onSmartExecutionRequirementSearchChange,
  onToggleSmartExecutionRequirement,
  onToggleSmartExecutionCase,
  onSelectAllSmartExecutionRequirements,
  onClearSmartExecutionRequirements,
  onSelectAllSmartExecutionCases,
  onClearSmartExecutionCases,
  canConfigureParallelAutomation,
  canRunLocalAutomation,
  canRunRemoteAutomation,
  canUseRunAi,
  canCreateExecution,
  isPreviewingSmartExecution,
  isSubmitting,
  isResolvingCases = false,
  isPreparingDeliveryOptions = false,
  caseResolutionError,
  onRetryCaseResolution,
  onClose,
  onSubmit
}: {
  projects: Pick<Project, "id" | "display_id" | "name">[];
  projectId: string;
  onProjectChange: (value: string) => void;
  appTypes: AppType[];
  appTypeId: string;
  onAppTypeChange: (value: string) => void;
  executionCreateMode: ExecutionCreateMode;
  onExecutionCreateModeChange: (value: ExecutionCreateMode) => void;
  executionStartMode: ExecutionStartMode;
  onExecutionStartModeChange: (value: ExecutionStartMode) => void;
  executionStartDate: string;
  executionEndDate: string;
  onExecutionStartDateChange: (value: string) => void;
  onExecutionEndDateChange: (value: string) => void;
  executionParallelEnabled: boolean;
  executionParallelCount: number;
  onExecutionParallelEnabledChange: (value: boolean) => void;
  onExecutionParallelCountChange: (value: number) => void;
  selectedProject: string;
  selectedAppType: string;
  scopeSuites: TestSuite[];
  selectedSuiteIds: string[];
  selectedDirectCaseIds?: string[];
  onDirectCaseSelectionChange?: (ids: string[], items: TestCase[]) => void;
  onDirectCaseItemsResolved?: (items: TestCase[]) => void;
  onDirectCaseResolutionChange?: (resolution: TestCaseSelectionResolution) => void;
  directCaseSelectionMessage?: string;
  executionName: string;
  selectedEnvironmentId: string;
  selectedConfigurationId: string;
  selectedDataSetId: string;
  dataOptions?: TestDataOptions; onDataOptionsChange?: (value: TestDataOptions) => void;
  selectedExecutionAssigneeIds: string[];
  executionRelease: string;
  executionSprint: string;
  executionBuild: string;
  releaseOptions: Array<{ value: string; label: string }>;
  sprintOptions: Array<{ value: string; label: string }>;
  buildOptions: string[];
  assigneeOptions: ExecutionAssigneeOption[];
  integrations: Integration[];
  executionHookDraft: ExecutionHookDraft;
  libraryCases: TestCase[];
  metadataByCaseId?: SuitePickerMetadataByCaseId;
  smartExecutionIntegrationId: string;
  smartExecutionReleaseScope: string;
  smartExecutionAdditionalContext: string;
  smartExecutionRequirementOptions: SmartExecutionRequirementOption[];
  smartExecutionRequirementSearch: string;
  smartExecutionPreview: SmartExecutionPreviewResponse | null;
  selectedSmartRequirementIds: string[];
  selectedSmartExecutionCaseIds: string[];
  smartExecutionPreviewMessage: string;
  smartExecutionPreviewTone: "success" | "error";
  onExecutionNameChange: (value: string) => void;
  onExecutionReleaseChange: (value: string) => void;
  onExecutionSprintChange: (value: string) => void;
  onExecutionBuildChange: (value: string) => void;
  onExecutionHookDraftChange: (value: ExecutionHookDraft) => void;
  onEnvironmentChange: (value: string) => void;
  onConfigurationChange: (value: string) => void;
  onDataSetChange: (value: string) => void;
  onAssigneeChange: (value: string[]) => void;
  onSuiteSelectionChange: (nextIds: string[]) => void;
  onPreviewSmartExecution: () => void;
  onSmartExecutionIntegrationChange: (value: string) => void;
  onSmartExecutionReleaseScopeChange: (value: string) => void;
  onSmartExecutionAdditionalContextChange: (value: string) => void;
  onSmartExecutionRequirementSearchChange: (value: string) => void;
  onToggleSmartExecutionRequirement: (requirementId: string) => void;
  onToggleSmartExecutionCase: (testCaseId: string) => void;
  onSelectAllSmartExecutionRequirements: (requirementIds: string[]) => void;
  onClearSmartExecutionRequirements: () => void;
  onSelectAllSmartExecutionCases: () => void;
  onClearSmartExecutionCases: () => void;
  canConfigureParallelAutomation: boolean;
  canRunLocalAutomation: boolean;
  canRunRemoteAutomation: boolean;
  canUseRunAi: boolean;
  canCreateExecution: boolean;
  isPreviewingSmartExecution: boolean;
  isSubmitting: boolean;
  isResolvingCases?: boolean;
  isPreparingDeliveryOptions?: boolean;
  caseResolutionError?: unknown;
  onRetryCaseResolution?: () => void;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {

  const { can } = useCapabilityAccess(projectId);
  const dialogRef = useDialogFocus<HTMLDivElement>({
    closeDisabled: isSubmitting || isPreviewingSmartExecution,
    onClose
  });
  const [dataSetValid, setDataSetValid] = useState(!selectedDataSetId);
  const [smartSidebarTab, setSmartSidebarTab] = useState<"context" | "settings">("context");
  const [smartEvidenceView, setSmartEvidenceView] = useState<{ kind: "plan" } | { kind: "case"; caseId: string } | null>(null);
  const [areSmartHooksOpen, setAreSmartHooksOpen] = useState(Boolean(executionHookDraft.length));
  const canCreateRunMode = executionStartMode === "local" ? can("automation.run.local")
    : executionStartMode === "remote" ? can("automation.run.remote") : can("run.create");
  const isSmartMode = canUseRunAi && executionCreateMode === "smart";
  const smartExecutionDefaultIntegrationId = useAiLlmDefault({ usageKey: "ai.execution.smart_plan", projectId, integrations, enabled: isSmartMode });
  const smartPreviewCases = smartExecutionPreview?.cases || [];
  const hasSmartPlanningInput = Boolean(
    executionRelease.trim()
    || executionSprint.trim()
    || executionBuild.trim()
    || smartExecutionReleaseScope.trim()
    || smartExecutionAdditionalContext.trim()
    || selectedSmartRequirementIds.length
  );
  const canGenerateSmartPlan = Boolean(
    projectId
    && appTypeId
    && hasSmartPlanningInput
    && !isPreviewingSmartExecution
    && !isSubmitting
  );
  const libraryCaseById = useMemo(() => new Map(libraryCases.map((testCase) => [testCase.id, testCase])), [libraryCases]);
  const isEngineSmartMode = isSmartMode && executionStartMode !== "manual";
  const automatedSmartPreviewCount = smartPreviewCases.filter((testCase) => libraryCaseById.get(testCase.test_case_id)?.automated === "yes").length;
  const normalizedRequirementSearch = smartExecutionRequirementSearch.trim().toLowerCase();
  const filteredSmartRequirementOptions = normalizedRequirementSearch
    ? smartExecutionRequirementOptions.filter((requirement) =>
        [requirement.title, requirement.description || ""].some((value) => value.toLowerCase().includes(normalizedRequirementSearch))
      )
    : smartExecutionRequirementOptions;
  const areAllVisibleSmartRequirementsSelected =
    Boolean(filteredSmartRequirementOptions.length)
    && filteredSmartRequirementOptions.every((requirement) => selectedSmartRequirementIds.includes(requirement.id));
  const selectedSmartCaseCount = selectedSmartExecutionCaseIds.length;
  const selectedSmartExecutableCaseCount = isEngineSmartMode
    ? selectedSmartExecutionCaseIds.filter((testCaseId) => libraryCaseById.get(testCaseId)?.automated === "yes").length
    : selectedSmartCaseCount;
  const areAllSmartCasesSelected = isEngineSmartMode
    ? Boolean(automatedSmartPreviewCount) && selectedSmartExecutableCaseCount === automatedSmartPreviewCount
    : Boolean(smartPreviewCases.length) && selectedSmartCaseCount === smartPreviewCases.length;
  const activeSmartEvidenceCase = smartEvidenceView?.kind === "case"
    ? smartPreviewCases.find((testCase) => testCase.test_case_id === smartEvidenceView.caseId) || null
    : null;
  const activeSmartEvidenceRefs = new Set(activeSmartEvidenceCase?.evidence_refs || []);
  const activeSmartEvidenceRecords = (smartExecutionPreview?.evidence || []).filter((record) =>
    smartEvidenceView?.kind === "plan" || activeSmartEvidenceRefs.has(record.ref)
  );
  const activeSmartEvidenceContext = smartExecutionPreview?.context || null;
  const selectedSuiteIdSet = expandSelectedSuiteIds(scopeSuites, selectedSuiteIds);
  const selectedSuiteCaseIds = new Set(
    scopeSuites
      .filter((suite) => selectedSuiteIdSet.has(suite.id))
      .flatMap((suite) => suite.test_case_ids || [])
  );
  let estimatedDurationMs = 0;
  let estimatedDurationSampleCount = 0;
  selectedSuiteCaseIds.forEach((testCaseId) => {
    const testCase = libraryCaseById.get(testCaseId);
    const durationMs = Number(testCase?.duration_ms || 0);
    const durationMinutes = Number(testCase?.estimated_duration_minutes || testCase?.average_duration_minutes || 0);

    if (Number.isFinite(durationMs) && durationMs > 0) {
      estimatedDurationMs += durationMs;
      estimatedDurationSampleCount += 1;
    } else if (Number.isFinite(durationMinutes) && durationMinutes > 0) {
      estimatedDurationMs += durationMinutes * 60_000;
      estimatedDurationSampleCount += 1;
    }
  });
  const estimatedDurationLabel = selectedSuiteCaseIds.size > 0 && estimatedDurationSampleCount === selectedSuiteCaseIds.size
    ? formatDuration(estimatedDurationMs, "Not estimated")
    : "Not estimated";
  return (
    <div className={`modal-backdrop modal-backdrop--scroll${isSmartMode ? " execution-smart-studio-backdrop" : ""}`} onClick={() => !isSubmitting && !isPreviewingSmartExecution && onClose()} role="presentation">
      <div
        aria-labelledby="create-execution-title"
        aria-modal="true"
        className={[
          "modal-card execution-create-modal execution-run-builder-modal",
          isSmartMode ? "execution-smart-studio-modal ai-feature-dialog" : ""
        ].filter(Boolean).join(" ")}
        onClick={(event) => event.stopPropagation()}
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
      >
        <form className="execution-create-form" onSubmit={event => { if (!dataSetValid) { event.preventDefault(); return; } onSubmit(event); }}>
          <div className="execution-create-header execution-run-builder-header">
            <div className="execution-run-builder-title">
              <span className="execution-run-builder-title-icon" aria-hidden="true">
                {isSmartMode ? <IconSparkles size={18} stroke={1.9} /> : <IconRocket size={17} stroke={1.9} />}
              </span>
              <div className="execution-run-builder-title-copy">
                <h2 className="dialog-title" id="create-execution-title">
                  {isSmartMode ? "AI Smart Run" : "Create new run"}
                </h2>
                {isSmartMode ? <span>Choose context, review coverage, create a run</span> : null}
              </div>
            </div>
            <div className="execution-run-builder-header-actions">
              <button
                aria-label="Close create run dialog"
                className="ghost-button dialog-close-button"
                disabled={isSubmitting || isPreviewingSmartExecution}
                onClick={onClose}
                title="Close create run dialog"
                type="button"
              >
                <IconX aria-hidden="true" size={19} stroke={1.9} />
              </button>
            </div>
          </div>

          <div className="execution-create-body execution-run-builder-body">
            <aside className="execution-run-config-rail" aria-label="Run configuration">
              <div className="execution-run-config-heading">
                <span>{isSmartMode ? "Context & settings" : "Run Configuration"}</span>
                {isSmartMode ? <small>Choose the changes and stories to cover.</small> : null}
              </div>

              {isSmartMode ? (
                <div className="execution-smart-sidebar-tabs" role="tablist" aria-label="Smart run setup">
                  <button aria-selected={smartSidebarTab === "context"} aria-controls="smart-run-context-panel" id="smart-run-context-tab" role="tab" type="button" onClick={() => setSmartSidebarTab("context")}>Context</button>
                  <button aria-selected={smartSidebarTab === "settings"} aria-controls="smart-run-settings-panel" id="smart-run-settings-tab" role="tab" type="button" onClick={() => setSmartSidebarTab("settings")}>Run settings</button>
                </div>
              ) : null}
              <div className="execution-run-config-stack" hidden={isSmartMode && smartSidebarTab !== "context"} id="smart-run-context-panel" role={isSmartMode ? "tabpanel" : undefined} aria-labelledby={isSmartMode ? "smart-run-context-tab" : undefined}>
              <FormField label="Project" required>
                <ProjectDropdown
                  ariaLabel="Select a project"
                  onChange={onProjectChange}
                  projects={!projectId || projects.some(project => project.id === projectId) ? projects : [...projects, { id: projectId, name: projectId }]}
                  value={projectId}
                />
              </FormField>

              <FormField label="App type" required>
                <AppTypeDropdown
                  ariaLabel="Select an app type"
                  disabled={!projectId}
                  emptyLabel={!projectId ? "Select a project first" : "No app types available"}
                  onChange={onAppTypeChange}
                  options={[...appTypes.map((appType) => ({
                    value: appType.id,
                    label: appType.name,
                    type: appType.type,
                    isUnified: appType.is_unified
                  })), ...(!appTypeId || appTypes.some(appType => appType.id === appTypeId) ? [] : [{ value: appTypeId, label: appTypeId }])]}
                  placeholder="Select app type"
                  value={appTypeId}
                />
              </FormField>

              {isSmartMode ? (
                <div className="execution-smart-provider-section">
                  <FormField label="AI model" hint="Optional. Refines explanations using the linked evidence.">
                    <AiLlmSelect
                      autoLabel="Configured prompt model, active default, or deterministic only"
                      defaultIntegrationId={smartExecutionDefaultIntegrationId}
                      integrations={integrations}
                      onChange={onSmartExecutionIntegrationChange}
                      scopeKey={projectId}
                      value={smartExecutionIntegrationId}
                    />
                  </FormField>
                </div>
              ) : null}

              <div className="execution-run-config-pair">
                {can("requirement_iteration.view") ? <FormField label="Release" hint={isSmartMode ? "Finds stories and results in this release." : undefined}>
                  <select value={executionRelease} onChange={(event) => onExecutionReleaseChange(event.target.value)}>
                    <option value="">No release filter</option>
                    {executionRelease && !releaseOptions.some((option) => option.value === executionRelease) ? (
                      <option value={executionRelease}>{executionRelease}</option>
                    ) : null}
                    {releaseOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                </FormField> : null}
                {can("requirement_iteration.view") ? <FormField label="Sprint" hint={isSmartMode ? "Finds stories and results in this sprint." : undefined}>
                  <select value={executionSprint} onChange={(event) => onExecutionSprintChange(event.target.value)}>
                    <option value="">No Sprint filter</option>
                    {executionSprint && !sprintOptions.some((option) => option.value === executionSprint) ? (
                      <option value={executionSprint}>{executionSprint}</option>
                    ) : null}
                    {sprintOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                </FormField> : null}
              </div>

              <FormField label="Build" hint={isSmartMode ? "Finds results and defects for this build." : undefined}>
                <input list="smart-run-build-options" placeholder="SHA-88219 or build tag" value={executionBuild} onChange={(event) => onExecutionBuildChange(event.target.value)} />
                <datalist id="smart-run-build-options">
                  {buildOptions.map((build) => <option key={build} value={build} />)}
                </datalist>
              </FormField>

                {isSmartMode ? <>
                <div className="ai-studio-sidebar execution-smart-scope-pane" aria-label="Smart Run evidence scope">
                  <div className="execution-smart-pane-header">
                    <div>
                      <div>
                        <h3>Context Setup</h3>
                        <p>Define the delivery change and coverage scope.</p>
                      </div>
                    </div>
                    <IconDatabase aria-hidden="true" size={18} stroke={1.8} />
                  </div>
                  <section className="ai-studio-panel">
                    <div className="panel-head">
                      <div>
                        <p className="eyebrow">Evidence scope</p>
                        <p>Select impacted stories or add notes to focus the plan.</p>
                      </div>
                    </div>

                    <FormField label="Change intent" hint="Describe what changed and the coverage outcome this run should prove.">
                      <textarea
                        placeholder="Changed workflows, integrations, rollout risks, customer impact, and desired coverage..."
                        maxLength={4000}
                        rows={4}
                        value={smartExecutionReleaseScope}
                        onChange={(event) => onSmartExecutionReleaseScopeChange(event.target.value)}
                      />
                    </FormField>

                    <FormField label="Additional context" hint="Rollout notes, known gaps, customer risk, or environment details.">
                      <textarea
                        placeholder="Environment notes, known gaps, customer impact, compliance focus..."
                        maxLength={4000}
                        rows={4}
                        value={smartExecutionAdditionalContext}
                        onChange={(event) => onSmartExecutionAdditionalContextChange(event.target.value)}
                      />
                    </FormField>

                    <FormField composite inputId="smart-run-impacted-story-filter" label="Impacted stories">
                      <div aria-label="Impacted stories" className="execution-smart-requirements-panel" role="group">
                        <div className="execution-smart-requirement-toolbar">
                          <input
                            aria-label="Filter impacted Stories"
                            id="smart-run-impacted-story-filter"
                            onKeyDown={(event) => {
                              if (event.key === "Enter") {
                                event.preventDefault();
                                event.stopPropagation();
                              }
                            }}
                            placeholder="Filter linked stories"
                            value={smartExecutionRequirementSearch}
                            onChange={(event) => onSmartExecutionRequirementSearchChange(event.target.value)}
                          />
                          <button
                            className="ghost-button"
                            disabled={!filteredSmartRequirementOptions.length || areAllVisibleSmartRequirementsSelected}
                            onClick={() => onSelectAllSmartExecutionRequirements(filteredSmartRequirementOptions.map((requirement) => requirement.id))}
                            type="button"
                          >
                            <SelectionToggleIcon checked />
                            Select visible
                          </button>
                          <button
                            className="ghost-button"
                            disabled={!selectedSmartRequirementIds.length}
                            onClick={onClearSmartExecutionRequirements}
                            type="button"
                          >
                            <SelectionToggleIcon checked={false} />
                            Clear
                          </button>
                        </div>

                        {smartExecutionRequirementOptions.length ? (
                          <div className="execution-smart-requirement-list">
                            {filteredSmartRequirementOptions.map((requirement) => {
                              const isSelected = selectedSmartRequirementIds.includes(requirement.id);

                              return (
                                <label
                                  className={isSelected ? "execution-smart-requirement-card is-selected" : "execution-smart-requirement-card"}
                                  key={requirement.id}
                                >
                                  <input
                                    checked={isSelected}
                                    onChange={() => onToggleSmartExecutionRequirement(requirement.id)}
                                    type="checkbox"
                                  />
                                  <div className="execution-smart-requirement-copy">
                                    <strong>{requirement.title}</strong>
                                    <span>{richTextToPlainText(requirement.description) || "Story-linked coverage available in this app type."}</span>
                                  </div>
                                  <span className="execution-smart-requirement-count">
                                    {requirement.linkedCaseCount} case{requirement.linkedCaseCount === 1 ? "" : "s"}
                                  </span>
                                </label>
                              );
                            })}

                            {!filteredSmartRequirementOptions.length ? (
                              <div className="empty-state compact">No linked stories match the current search.</div>
                            ) : null}
                          </div>
                        ) : (
                          <div className="empty-state compact">No story-linked test cases are available for this app type yet.</div>
                        )}
                      </div>
                    </FormField>

                    <div className="detail-summary compact-summary">
                      <strong>{selectedSmartRequirementIds.length ? `${selectedSmartRequirementIds.length} impacted ${selectedSmartRequirementIds.length === 1 ? "story" : "stories"} selected` : "Story filter is optional"}</strong>
                      <span>
                        {selectedSmartRequirementIds.length
                          ? "Selected Stories are added as explicit evidence alongside the Release, Sprint, Build, Defect, and prior-result scope."
                          : "Choose impacted Stories to add explicit traceability evidence to the delivery scope."}
                      </span>
                    </div>

                    <div className="detail-summary compact-summary">
                      <strong>{smartExecutionPreview?.default_suite.name || "Direct impacted scope"}</strong>
                      <span>Recommended cases are staged as direct run scope; no existing suite membership is invented or changed.</span>
                    </div>

                    <div className="execution-smart-generate-row">
                      <button
                        className="primary-button"
                        disabled={!canGenerateSmartPlan}
                        onClick={onPreviewSmartExecution}
                        type="button"
                      >
                        <IconSparkles aria-hidden="true" size={17} stroke={1.9} />
                        {isPreviewingSmartExecution
                          ? "Generating plan…"
                          : smartExecutionPreviewTone === "error" && smartExecutionPreviewMessage
                            ? "Retry impact plan"
                            : smartExecutionPreview
                              ? "Regenerate impact plan"
                              : "Generate impact plan"}
                      </button>
                    </div>
                  </section>
                </div>

                </> : null}
              </div>
              <div className="execution-run-config-stack execution-smart-run-settings" hidden={isSmartMode && smartSidebarTab !== "settings"} id="smart-run-settings-panel" role={isSmartMode ? "tabpanel" : undefined} aria-labelledby={isSmartMode ? "smart-run-settings-tab" : undefined}>
              <FormField label="Run Name">
                <input
                  data-autofocus="true"
                  placeholder="e.g. Q4_Regression_v2"
                  value={executionName}
                  onChange={(event) => onExecutionNameChange(event.target.value)}
                />
              </FormField>

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

              <div className="execution-run-config-context">
                <ExecutionContextSelector hideDataSet
                  appTypeId={appTypeId}
                  onConfigurationChange={onConfigurationChange}
                  onDataSetChange={onDataSetChange}
                  onEnvironmentChange={onEnvironmentChange}
                  prefillFirstAvailable={false}
                  projectId={projectId}
                  selectedConfigurationId={selectedConfigurationId}
                  selectedDataSetId={selectedDataSetId}
                  selectedEnvironmentId={selectedEnvironmentId}
                />
                <RunDataSetup dataOptions={dataOptions} onDataOptionsChange={onDataOptionsChange}
                  onValidityChange={setDataSetValid}
                  appTypeId={appTypeId}
                  onDataSetChange={onDataSetChange}
                  cases={runCaseReferences(isSmartMode ? selectedSmartExecutionCaseIds : selectedDirectCaseIds, libraryCases)}
                  suites={scopeSuites.filter(suite => selectedSuiteIdSet.has(suite.id))}
                  projectId={projectId}
                  environmentId={selectedEnvironmentId}
                  configurationId={selectedConfigurationId}
                  dataSetId={selectedDataSetId}
                  disabled={isSubmitting}
                />
              </div>

              <FormField label="Primary assignee" hint="Select one or more testers for this run.">
                <MultiAssigneePicker
                  disabled={!projectId || !assigneeOptions.length}
                  options={assigneeOptions}
                  selectedIds={selectedExecutionAssigneeIds}
                  onChange={onAssigneeChange}
                />
              </FormField>

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

            <main className="execution-run-selection-workspace">
              <div className="execution-run-selection-header">
                <div>
                  <h3>{isSmartMode ? "Review run plan" : "Suites"}</h3>
                  {isSmartMode ? <p>Select the recommended cases to include in your run.</p> : null}
                </div>
                {canUseRunAi ? (
                  <div className="execution-create-mode-segmented" aria-label="Run creation mode" role="group">
                    <button
                      aria-pressed={!isSmartMode}
                      className={!isSmartMode ? "is-active" : ""}
                      onClick={() => onExecutionCreateModeChange("manual")}
                      type="button"
                    >
                      <IconCheckbox aria-hidden="true" size={16} stroke={1.9} />
                      <span>Manual Snapshot</span>
                    </button>
                    <button
                      aria-pressed={isSmartMode}
                      className={isSmartMode ? "is-active" : ""}
                      onClick={() => onExecutionCreateModeChange("smart")}
                      type="button"
                    >
                      <IconSparkles aria-hidden="true" size={16} stroke={1.9} />
                      <span>AI Smart Run</span>
                    </button>
                  </div>
                ) : null}
              </div>

            {isSmartMode ? (
              <div className="execution-smart-agent-workspace">
                <div className="ai-studio-main execution-smart-plan-pane" aria-label="Smart Run ranked coverage">
                  <div className="execution-smart-pane-header">
                    <div>
                      <div>
                        <h3>Smart Run Drafts</h3>
                        <p>Review why each case is included and adjust your selection.</p>
                      </div>
                    </div>
                    <span className="execution-smart-pane-count">
                      {smartExecutionPreview ? `${smartPreviewCases.length} ranked` : "Awaiting plan"}
                    </span>
                  </div>

                  {!smartExecutionPreview ? (
                    <div className="detail-summary execution-smart-plan-overview">
                      <strong>Build a focused run plan</strong>
                      <span>Choose delivery scope, impacted stories, or change notes in Context, then generate a plan to review the recommended cases and their evidence.</span>
                    </div>
                  ) : null}

                  {smartExecutionPreview?.evidence_summary ? (
                    <div aria-label="Smart Run evidence summary" className="metric-strip execution-smart-evidence-strip" role="group">
                      <div className="mini-card">
                        <span>Failed cases</span>
                        <strong>{smartExecutionPreview.evidence_summary.failed_case_count}</strong>
                        <small>from matching runs</small>
                      </div>
                      <div className="mini-card">
                        <span>Blocked cases</span>
                        <strong>{smartExecutionPreview.evidence_summary.blocked_case_count}</strong>
                        <small>from matching runs</small>
                      </div>
                      <div className="mini-card">
                        <span>Scoped Defects</span>
                        <strong>{smartExecutionPreview.evidence_summary.scoped_bug_count}</strong>
                        <small>expanded through links</small>
                      </div>
                      <div className="mini-card">
                        <span>Scoped Stories</span>
                        <strong>{smartExecutionPreview.evidence_summary.scoped_requirement_count}</strong>
                        <small>linked coverage</small>
                      </div>
                      <AiEvidenceButton
                        className="execution-smart-evidence-open"
                        count={smartExecutionPreview.evidence?.length || 0}
                        label="Review sources"
                        onClick={() => setSmartEvidenceView({ kind: "plan" })}
                      />
                    </div>
                  ) : null}

                  {smartExecutionPreview?.evidence_summary?.scan_truncated ? (
                    <p className="inline-message warning-message">
                      This project exceeds the safe synchronous scan limit. The plan keeps failed and Defect-linked cases first; narrow Release, Sprint, or Build before sign-off to verify the remaining scope.
                    </p>
                  ) : null}

                  {smartExecutionPreviewMessage && (smartExecutionPreviewTone === "error" || !smartExecutionPreview) ? (
                    <p className={smartExecutionPreviewTone === "error" ? "inline-message error-message" : "inline-message success-message"}>
                      {smartExecutionPreviewMessage}
                    </p>
                  ) : null}

                  {smartExecutionPreview?.fallback_reason ? <p className="inline-message warning-message">{smartExecutionPreview.fallback_reason}</p> : null}

                  {!integrations.length && !smartExecutionPreview ? (
                    <div className="inline-message warning-message">
                      No direct LLM integration is configured. The evidence retrieval, deterministic risk ranking, and human-review flow remain available; model-refined explanations will be skipped.
                    </div>
                  ) : null}

                  <div className="action-row">
                    <button
                      className="ghost-button"
                      disabled={!smartPreviewCases.length || areAllSmartCasesSelected}
                      onClick={onSelectAllSmartExecutionCases}
                      type="button"
                    >
                      <SelectionToggleIcon checked />
                      Select all
                    </button>
                    <button
                      className="ghost-button"
                      disabled={!selectedSmartCaseCount}
                      onClick={onClearSmartExecutionCases}
                      type="button"
                    >
                      <SelectionToggleIcon checked={false} />
                      Clear
                    </button>
                  </div>

                  {smartExecutionPreview ? (
                    <div className="selection-summary-card execution-smart-summary-card">
                      <div className="selection-summary-header">
                        <div>
                          <strong>{smartExecutionPreview.execution_name}</strong>
                          <span>{smartExecutionPreview.summary}</span>
                        </div>
                        <span className="count-pill">{selectedSmartExecutableCaseCount}/{isEngineSmartMode ? automatedSmartPreviewCount : smartExecutionPreview.matched_case_count} selected</span>
                      </div>
                    </div>
                  ) : null}

                  <div className="execution-smart-impact-list">
                    {smartPreviewCases.map((testCase, index) => {
                      const isSelected = selectedSmartExecutionCaseIds.includes(testCase.test_case_id);
                      const automationState = libraryCaseById.get(testCase.test_case_id)?.automated;
                      const isAutomatedSmartCase = automationState === "yes";
                      const isDisabledForEngine = isEngineSmartMode && !isAutomatedSmartCase;
                      const explanationSignals = Array.from(new Set([
                        ...(testCase.selection_basis || []),
                        ...(testCase.signals || [])
                      ])).slice(0, 6);

                      return (
                        <article
                          className={[
                            "execution-smart-impact-card",
                            isSelected ? "is-selected" : "",
                            isDisabledForEngine ? "is-disabled" : ""
                          ].filter(Boolean).join(" ")}
                          key={testCase.test_case_id}
                        >
                          <label className="execution-smart-impact-selector">
                            <input
                              checked={isSelected}
                              disabled={isDisabledForEngine}
                              onChange={() => onToggleSmartExecutionCase(testCase.test_case_id)}
                              type="checkbox"
                            />
                            <span className="sr-only">Select {testCase.title}</span>
                          </label>
                          <div className="execution-smart-impact-body">
                            <div className="execution-smart-impact-top">
                              <div className="execution-smart-impact-heading">
                                <div>
                                  <span className="execution-smart-rank-badge" aria-label={`Rank ${index + 1}`}>#{index + 1}</span>
                                  <strong title={testCase.title}>{testCase.title}</strong>
                                </div>
                                <span>{richTextToPlainText(testCase.description) || "No description available."}</span>
                              </div>
                              <div className="execution-smart-impact-facts">
                                <span className={`execution-smart-impact-level is-${testCase.impact_level}`}>
                                  {executionImpactLevelLabel(testCase.impact_level)}
                                </span>
                                <span className="count-pill">
                                  {testCase.step_count} step{testCase.step_count === 1 ? "" : "s"}
                                </span>
                                {typeof testCase.risk_score === "number" ? (
                                  <span className="count-pill">Risk {Math.round(testCase.risk_score)}</span>
                                ) : null}
                                {testCase.failure_count ? (
                                  <span className="count-pill danger">
                                    {testCase.failure_count} failure{testCase.failure_count === 1 ? "" : "s"}
                                  </span>
                                ) : null}
                                {testCase.blocked_count ? (
                                  <span className="count-pill warning">
                                    {testCase.blocked_count} blocked
                                  </span>
                                ) : null}
                                {testCase.bug_count ? (
                                  <span className="count-pill warning">
                                    {testCase.bug_count} Defect{testCase.bug_count === 1 ? "" : "s"}
                                  </span>
                                ) : null}
                                <span
                                  className={isAutomatedSmartCase ? "count-pill success" : "count-pill"}
                                >
                                  {isAutomatedSmartCase ? "Automated" : "Not automated"}
                                </span>
                                <AiEvidenceButton
                                  count={testCase.evidence_refs?.length || 0}
                                  label="Evidence"
                                  onClick={() => setSmartEvidenceView({ kind: "case", caseId: testCase.test_case_id })}
                                />
                              </div>
                            </div>

                            <div className="execution-smart-impact-reason">
                              <span>Why this case</span>
                              <p>{testCase.reason}</p>
                            </div>

                            {explanationSignals.length ? (
                              <div className="execution-smart-signal-row" aria-label="Deterministic selection basis">
                                {explanationSignals.map((signal) => (
                                  <span className="execution-smart-signal-chip" key={signal}>{signal}</span>
                                ))}
                              </div>
                            ) : null}

                            <div className="detail-summary compact-summary">
                              <strong>{testCase.suite_names.length ? testCase.suite_names.join(" · ") : "No suite mapping"}</strong>
                              <span>
                                {testCase.requirement_titles.length
                                  ? `Stories: ${testCase.requirement_titles.join(" · ")}`
                                  : "No linked stories"}
                              </span>
                              {testCase.module_names?.length ? <span>Modules: {testCase.module_names.join(" · ")}</span> : null}
                            </div>
                          </div>
                        </article>
                      );
                    })}

                    {smartExecutionPreview && !smartPreviewCases.length ? (
                      <div className="empty-state compact">No impacted cases were identified for the current release scope.</div>
                    ) : null}
                    {!smartExecutionPreview ? (
                      <div className="empty-state compact">Generate a preview to review the cases proposed for direct impacted scope.</div>
                    ) : null}
                  </div>

                </div>
              </div>
            ) : (
              <section className="execution-suite-selection" aria-label="Run test case and suite selection">
                {onDirectCaseSelectionChange ? <TestCasePicker
                  projectId={projectId}
                  appTypeId={appTypeId}
                  selectedIds={selectedDirectCaseIds}
                  onChange={onDirectCaseSelectionChange}
                  onItemsResolved={onDirectCaseItemsResolved}
                  onSelectionResolutionChange={onDirectCaseResolutionChange}
                  initialItems={libraryCases}
                  filters={executionStartMode === "manual" ? undefined : { automated: "yes" }}
                  disabled={isSubmitting}
                  heading="Test Case Selection"
                  emptyMessage="No test cases match the current scope."
                  presentation="inline"
                  selectionContext="run"
                  allowReorder
                /> : null}
                <SuiteScopePicker
                  projectId={projectId}
                  appTypeId={appTypeId}
                  emptyMessage={appTypeId ? "No suites are available for this app type. Create a suite first." : "Select an application type to load reusable suites."}
                  metadataByCaseId={metadataByCaseId}
                  onChange={onSuiteSelectionChange}
                  selectedSuiteIds={selectedSuiteIds}
                  suites={scopeSuites}
                  testCases={libraryCases}
                />
              </section>
            )}

              {isSmartMode ? (
                <details className="execution-smart-hooks-disclosure" onToggle={(event) => setAreSmartHooksOpen(event.currentTarget.open)} open={areSmartHooksOpen}>
                  <summary>
                    <span>
                      <strong>Setup &amp; cleanup automation</strong>
                      <small>Optional run hooks stay available without obscuring the ranked impact plan.</small>
                    </span>
                    <span>{executionHookDraft.length ? `${executionHookDraft.length} configured` : "Optional"}</span>
                  </summary>
                  <div className="execution-run-hooks-workspace">
                    <RunHooksBuilder
                      projectId={projectId}
                      appTypeId={appTypeId}
                      onChange={onExecutionHookDraftChange}
                      suites={scopeSuites}
                      testCases={libraryCases}
                      value={executionHookDraft}
                    />
                  </div>
                </details>
              ) : (
                <div className="execution-run-hooks-workspace">
                  <RunHooksBuilder
                    projectId={projectId}
                    appTypeId={appTypeId}
                    onChange={onExecutionHookDraftChange}
                    suites={scopeSuites}
                    testCases={libraryCases}
                    value={executionHookDraft}
                  />
                </div>
              )}
            </main>
          </div>

          {isPreparingDeliveryOptions ? <p className="inline-message" role="status">Preparing Release and Sprint options… You can continue configuring this run.</p> : null}
          {directCaseSelectionMessage ? <div className="hierarchy-filter-scope-note" role="alert">{directCaseSelectionMessage}</div> : null}
          {isResolvingCases ? <div className="hierarchy-filter-scope-note" role={caseResolutionError ? "alert" : "status"}>{caseResolutionError ? <>{caseResolutionError instanceof Error ? caseResolutionError.message : "Selected case details could not be loaded."} <button type="button" className="ghost-button compact" onClick={onRetryCaseResolution}>Retry case details</button></> : "Checking the selected cases for this run mode…"}</div> : null}
          <div className="execution-run-builder-footer">
            <div
              className="execution-run-builder-status"
              aria-label={`${selectedProject || "No project"} · ${selectedAppType || "No app type"}`}
            >
              <strong>
                {isSmartMode
                  ? `${selectedSmartExecutableCaseCount} ${selectedSmartExecutableCaseCount === 1 ? "case" : "cases"} selected`
                  : `${selectedSuiteIds.length} ${selectedSuiteIds.length === 1 ? "suite" : "suites"}${selectedDirectCaseIds.length ? ` · ${selectedDirectCaseIds.length} direct cases` : ""} selected`}
              </strong>
              <span aria-hidden="true">•</span>
              <span>
                <IconClock aria-hidden="true" size={15} stroke={1.8} />
                {isSmartMode ? "Review required before creation" : `Est. duration: ${estimatedDurationLabel}`}
              </span>
            </div>
            <div className="execution-run-builder-actions">
              <button className="ghost-button" disabled={isSubmitting || isPreviewingSmartExecution} onClick={onClose} type="button">
                Cancel
              </button>
              {canCreateRunMode ? (<button
                className="primary-button"
                disabled={!canCreateExecution || isSubmitting || !dataSetValid || (isSmartMode && (isPreviewingSmartExecution || !smartExecutionPreview || !selectedSmartExecutableCaseCount))}
                type="submit"
              >
                {isSubmitting
                  ? "Creating…"
                  : isSmartMode
                    ? "Create AI Smart Run"
                    : executionStartMode === "remote"
                      ? "Create Remote Run"
                      : executionStartMode === "local"
                        ? "Create Local Run"
                        : "Create Manual Run"}
              </button>) : null}
            </div>
          </div>
        </form>
        <AiEvidenceFlyout
          description={activeSmartEvidenceCase
            ? "Inspect the exact records permitted to support this Test Case recommendation."
            : "Inspect the returned records, retrieval boundary, and provenance for this preview."}
          eyebrow={activeSmartEvidenceCase ? "Smart Run · Case evidence" : "Smart Run · Plan evidence"}
          facts={activeSmartEvidenceCase
            ? [
                { label: "Risk", value: `${Math.round(activeSmartEvidenceCase.risk_score || 0)} · ${executionImpactLevelLabel(activeSmartEvidenceCase.impact_level)}` },
                { label: "Explanation", value: activeSmartEvidenceCase.reason_source === "model" ? "Model-refined with cited records" : "Deterministic from linked records" },
                { label: "Evidence refs", value: activeSmartEvidenceCase.evidence_refs?.length || 0 },
                { label: "Decision", value: "Human selection required" }
              ]
            : [
                { label: "Generation", value: smartExecutionPreview?.generation_mode === "hybrid" ? "Deterministic rank · model-refined explanations" : "Deterministic evidence rank" },
                { label: "Scan", value: `${smartExecutionPreview?.evidence_summary?.scanned_case_count || 0} of ${smartExecutionPreview?.source_case_count || 0} Test Cases` },
                { label: "Returned", value: smartExecutionPreview?.matched_case_count || 0 },
                { label: "Decision", value: "Human review required" }
              ]}
          onClose={() => setSmartEvidenceView(null)}
          open={Boolean(smartEvidenceView && smartExecutionPreview)}
          title={activeSmartEvidenceCase?.title || smartExecutionPreview?.execution_name || "Smart Run evidence"}
        >
          {smartExecutionPreview?.query_strategy?.length && !activeSmartEvidenceCase ? (
            <section className="ai-evidence-flyout__section execution-smart-evidence-path">
              <header><span>Retrieval path</span><strong>Queries that contributed to this preview</strong></header>
              <div>
                {smartExecutionPreview.query_strategy.map((strategy) => (
                  <span className="execution-smart-signal-chip" key={strategy}>{strategy}</span>
                ))}
              </div>
            </section>
          ) : null}

          {activeSmartEvidenceCase?.selection_basis?.length ? (
            <section className="ai-evidence-flyout__section execution-smart-evidence-basis">
              <header><span>Selection basis</span><strong>Deterministic factors used for ranking</strong></header>
              <ul>
                {activeSmartEvidenceCase.selection_basis.map((basis) => <li key={basis}>{basis}</li>)}
              </ul>
            </section>
          ) : null}

          <section className="ai-evidence-flyout__section execution-smart-evidence-records">
            <header>
              <span>Source records</span>
              <strong>{activeSmartEvidenceRecords.length} returned record{activeSmartEvidenceRecords.length === 1 ? "" : "s"}</strong>
            </header>
            {activeSmartEvidenceRecords.length ? (
              <ul>
                {activeSmartEvidenceRecords.map((record) => (
                  <li key={record.ref}>
                    <div>
                      <span>{record.type.replace(/-/g, " ")}</span>
                      <strong>{record.title}</strong>
                    </div>
                    <p>{record.summary || record.excerpt || "No additional source summary was returned."}</p>
                    <small>
                      {[record.id, record.status, record.observed_at ? new Date(record.observed_at).toLocaleString() : null]
                        .filter(Boolean)
                        .join(" · ")}
                    </small>
                    <code>{record.ref}</code>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="ai-evidence-flyout__boundary">No returned source record is attached to this view.</p>
            )}
          </section>

          {!activeSmartEvidenceCase && activeSmartEvidenceContext ? (
            <section className="ai-evidence-flyout__section execution-smart-evidence-boundary">
              <header><span>Retrieval boundary</span><strong>Included and omitted records</strong></header>
              <dl>
                {Object.keys(activeSmartEvidenceContext.totals).map((source) => (
                  <div key={source}>
                    <dt>{source.replace(/_/g, " ")}</dt>
                    <dd>
                      {activeSmartEvidenceContext.included[source] || 0} included
                      {activeSmartEvidenceContext.omitted[source] ? ` · ${activeSmartEvidenceContext.omitted[source]} omitted by limit` : " · none omitted"}
                    </dd>
                  </div>
                ))}
              </dl>
              {smartExecutionPreview?.input_fingerprint ? <code>Fingerprint {smartExecutionPreview.input_fingerprint}</code> : null}
              {smartExecutionPreview?.fallback_reason ? <p>{smartExecutionPreview.fallback_reason}</p> : null}
            </section>
          ) : null}
          <p className="ai-evidence-flyout__boundary">
            <IconShieldCheck aria-hidden="true" size={16} stroke={1.9} />
            This preview does not create a run. Case selection and Create AI Smart Run remain explicit human actions.
          </p>
        </AiEvidenceFlyout>
      </div>
    </div>
  );
}

function CreateExecutionScheduleModal({
  mode,
  projectId,
  projectName,
  appTypeId,
  appTypeName,
  scopeSuites,
  testCases,
  metadataByCaseId,
  selectedSuiteIds,
  executionName,
  selectedEnvironmentId,
  selectedConfigurationId,
  selectedDataSetId,
  dataOptions, onDataOptionsChange,
  selectedAssigneeIds,
  executionRelease,
  executionSprint,
  executionBuild,
  releaseOptions,
  sprintOptions,
  assigneeOptions,
  cadence,
  intervalMinutes,
  nextRunAt,
  isSubmitting,
  onExecutionNameChange,
  onEnvironmentChange,
  onConfigurationChange,
  onDataSetChange,
  onAssigneeChange,
  onExecutionReleaseChange,
  onExecutionSprintChange,
  onExecutionBuildChange,
  onSuiteSelectionChange,
  onCadenceChange,
  onIntervalMinutesChange,
  onNextRunAtChange,
  onClose,
  onSubmit
}: {
  mode: "create" | "edit";
  projectId: string;
  projectName: string;
  appTypeId: string;
  appTypeName: string;
  scopeSuites: TestSuite[];
  testCases: TestCase[];
  metadataByCaseId: SuitePickerMetadataByCaseId;
  selectedSuiteIds: string[];
  executionName: string;
  selectedEnvironmentId: string;
  selectedConfigurationId: string;
  selectedDataSetId: string;
  dataOptions?: TestDataOptions; onDataOptionsChange?: (value: TestDataOptions) => void;
  selectedAssigneeIds: string[];
  executionRelease: string;
  executionSprint: string;
  executionBuild: string;
  releaseOptions: Array<{ value: string; label: string }>;
  sprintOptions: Array<{ value: string; label: string }>;
  assigneeOptions: ExecutionAssigneeOption[];
  cadence: ExecutionScheduleCadence;
  intervalMinutes: number;
  nextRunAt: string;
  isSubmitting: boolean;
  onExecutionNameChange: (value: string) => void;
  onEnvironmentChange: (value: string) => void;
  onConfigurationChange: (value: string) => void;
  onDataSetChange: (value: string) => void;
  onAssigneeChange: (value: string[]) => void;
  onExecutionReleaseChange: (value: string) => void;
  onExecutionSprintChange: (value: string) => void;
  onExecutionBuildChange: (value: string) => void;
  onSuiteSelectionChange: (nextIds: string[]) => void;
  onCadenceChange: (value: ExecutionScheduleCadence) => void;
  onIntervalMinutesChange: (value: number) => void;
  onNextRunAtChange: (value: string) => void;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const { can } = useCapabilityAccess(projectId);
  const isEditing = mode === "edit";

  return (
    <div className="modal-backdrop modal-backdrop--scroll" onClick={() => !isSubmitting && onClose()} role="presentation">
      <div
        aria-labelledby="create-execution-schedule-title"
        aria-modal="true"
        className="modal-card execution-create-modal"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
      >
        <form className="execution-create-form" onSubmit={onSubmit}>
          <div className="execution-create-header">
            <div className="execution-create-title">
              <p className="dialog-context-label">Scheduled runs</p>
              <h2 className="dialog-title" id="create-execution-schedule-title">{isEditing ? "Edit schedule" : "Create schedule"}</h2>
              <p>{isEditing ? "Adjust the recurring run without losing its run history or current scope." : "Save a recurring run separately from the live run board, then launch it when needed."}</p>
            </div>
            <button aria-label={`Close ${isEditing ? "edit" : "create"} schedule dialog`} className="ghost-button" disabled={isSubmitting} onClick={onClose} type="button">
              Close
            </button>
          </div>

          <div className="execution-create-body">
            <div className="detail-summary">
              <strong>{projectName || "Select a project to continue"}</strong>
              <span>{appTypeName ? `${appTypeName} app type selected for this schedule.` : "Choose an app type before scheduling."}</span>
              <span>{scopeSuites.length ? `${scopeSuites.length} suites available for recurring runs.` : "No suites available yet in the selected scope."}</span>
            </div>

            <div className="execution-create-grid">
              <FormField label="Schedule name">
                <input value={executionName} onChange={(event) => onExecutionNameChange(event.target.value)} />
              </FormField>
              <FormField label="Assign to" hint="These users become the default tester group each time the schedule creates a fresh run.">
                <MultiAssigneePicker
                  disabled={!projectId || !assigneeOptions.length || isSubmitting}
                  options={assigneeOptions}
                  selectedIds={selectedAssigneeIds}
                  onChange={onAssigneeChange}
                />
              </FormField>
            </div>

            <div className="execution-create-grid execution-create-grid--metadata">
              {can("requirement_iteration.view") ? <FormField label="Release">
                <select value={executionRelease} onChange={(event) => onExecutionReleaseChange(event.target.value)}>
                  <option value="">No release</option>
                  {executionRelease && !releaseOptions.some((option) => option.value === executionRelease) ? (
                    <option value={executionRelease}>{executionRelease}</option>
                  ) : null}
                  {releaseOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
              </FormField> : null}
              {can("requirement_iteration.view") ? <FormField label="Sprint">
                <select value={executionSprint} onChange={(event) => onExecutionSprintChange(event.target.value)}>
                  <option value="">No Sprint</option>
                  {executionSprint && !sprintOptions.some((option) => option.value === executionSprint) ? (
                    <option value={executionSprint}>{executionSprint}</option>
                  ) : null}
                  {sprintOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
              </FormField> : null}
              <FormField label="Build">
                <input placeholder="Build 2026.07.02" value={executionBuild} onChange={(event) => onExecutionBuildChange(event.target.value)} />
              </FormField>
            </div>

            <div className="execution-create-grid">
              <FormField label="Cadence" required>
                <select value={cadence} onChange={(event) => onCadenceChange(event.target.value as ExecutionScheduleCadence)}>
                  <option value="once">Once</option>
                  <option value="daily">Daily</option>
                  <option value="weekly">Weekly</option>
                  <option value="monthly">Monthly</option>
                  <option value="interval_minutes">Run every N minutes</option>
                </select>
              </FormField>
              <FormField label={cadence === "interval_minutes" ? "Run every" : "First run"} required>
                {cadence === "interval_minutes" ? (
                  <div className="execution-interval-control">
                    <input
                      aria-label="Run every minutes"
                      min={1}
                      max={1440}
                      onChange={(event) => onIntervalMinutesChange(Math.max(1, Number(event.target.value) || 5))}
                      type="number"
                      value={intervalMinutes}
                    />
                    <span>minutes</span>
                    <div className="execution-interval-presets" aria-label="Common schedule intervals">
                      {[5, 10, 15].map((minutes) => (
                        <button
                          className={intervalMinutes === minutes ? "ghost-button is-active" : "ghost-button"}
                          key={minutes}
                          onClick={() => onIntervalMinutesChange(minutes)}
                          type="button"
                        >
                          {minutes} mins
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}
                <input type="datetime-local" value={nextRunAt} onChange={(event) => onNextRunAtChange(event.target.value)} />
              </FormField>
            </div>

            <ExecutionContextSelector hideDataSet
              appTypeId={appTypeId}
              onConfigurationChange={onConfigurationChange}
              onDataSetChange={onDataSetChange}
              onEnvironmentChange={onEnvironmentChange}
              prefillFirstAvailable={false}
              projectId={projectId}
              selectedConfigurationId={selectedConfigurationId}
              selectedDataSetId={selectedDataSetId}
              selectedEnvironmentId={selectedEnvironmentId}
            />

            <RunDataSetup dataOptions={dataOptions} onDataOptionsChange={onDataOptionsChange} projectId={projectId} appTypeId={appTypeId}
              cases={[]} suites={scopeSuites.filter(suite => selectedSuiteIds.includes(suite.id))} dataSetId={selectedDataSetId} onDataSetChange={onDataSetChange}
              environmentId={selectedEnvironmentId} configurationId={selectedConfigurationId} disabled={isSubmitting} />

            <FormField label="Run scope" required>
              <SuiteScopePicker
                projectId={projectId}
                appTypeId={appTypeId}
                description="Pick the reusable suites that should be snapped whenever this schedule runs."
                emptyMessage="No suites available in this app type yet."
                heading="Scheduled suite scope"
                onChange={onSuiteSelectionChange}
                selectedSuiteIds={selectedSuiteIds}
                suites={scopeSuites}
                testCases={testCases}
                metadataByCaseId={metadataByCaseId}
              />
            </FormField>
          </div>

          <div className="action-row execution-create-actions">
            <button className="primary-button" disabled={!projectId || !appTypeId || !selectedSuiteIds.length || !nextRunAt || isSubmitting} type="submit">
              {isSubmitting ? "Saving…" : isEditing ? "Save schedule" : "Create schedule"}
            </button>
            <button className="ghost-button" disabled={isSubmitting} onClick={onClose} type="button">
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function ExecutionContextSnapshotSummary({
  execution,
  onViewFull
}: {
  execution: Execution;
  onViewFull?: () => void;
}) {
  const environmentSummary = execution.test_environment?.snapshot;
  const configurationSummary = execution.test_configuration?.snapshot;
  const dataSetSummary = execution.test_data_set?.snapshot;
  const configurationTarget = [
    configurationSummary?.browser,
    configurationSummary?.mobile_os,
    configurationSummary?.platform_version
  ].filter(Boolean).join(" · ");

  return (
    <div className="execution-context-summary-shell">
      <div className="execution-context-summary-head">
        <div className="execution-context-summary-copy">
          <div className="execution-context-summary-title-row">
            <strong>Run context snapshot</strong>
            <InfoTooltip
              content="Environment, configuration, and test data were frozen when this run was created."
              label="Run context snapshot information"
            />
          </div>
        </div>
        {onViewFull ? (
          <button className="ghost-button" onClick={onViewFull} type="button">
            View full context
          </button>
        ) : null}
      </div>

      <div className="execution-context-cards">
        <div className="execution-context-card">
          <span>Environment snapshot</span>
          <strong>{environmentSummary?.name || execution.test_environment?.name || "No environment attached"}</strong>
          <small>{environmentSummary?.base_url || environmentSummary?.browser || "No environment snapshot details recorded."}</small>
        </div>
        <div className="execution-context-card">
          <span>Configuration snapshot</span>
          <strong>{configurationSummary?.name || execution.test_configuration?.name || "No configuration attached"}</strong>
          <small>{configurationTarget || (configurationSummary?.variables?.length ? `${configurationSummary.variables.length} variables available` : "No configuration snapshot details recorded.")}</small>
        </div>
        <div className="execution-context-card">
          <span>Data snapshot</span>
          <strong>{dataSetSummary?.name || execution.test_data_set?.name || "No data set attached"}</strong>
          <small>
            {dataSetSummary
              ? dataSetSummary.mode === "table"
                ? `${dataSetSummary.rows.length} table rows snapped`
                : `${dataSetSummary.rows.length} key/value pairs snapped`
              : "No data snapshot details recorded."}
          </small>
        </div>
      </div>
    </div>
  );
}

function ExecutionContextSnapshotModal({
  execution,
  onClose
}: {
  execution: Execution;
  onClose: () => void;
}) {
  const environmentSummary = execution.test_environment?.snapshot;
  const configurationSummary = execution.test_configuration?.snapshot;
  const dataSetSummary = execution.test_data_set?.snapshot;

  return (
    <div className="modal-backdrop modal-backdrop--scroll" onClick={onClose} role="presentation">
      <div
        aria-labelledby="execution-context-modal-title"
        aria-modal="true"
        className="modal-card execution-context-modal"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
      >
        <div className="execution-context-modal-header">
          <div className="execution-context-modal-copy">
            <p className="dialog-context-label">Run context snapshot</p>
            <h2 className="dialog-title" id="execution-context-modal-title">{execution.name || "Selected run"}</h2>
            <p>Review the exact environment, configuration, and test data preserved with this run. Later edits to reusable resources do not change this snapshot.</p>
          </div>
          <button className="ghost-button" onClick={onClose} type="button">
            Close
          </button>
        </div>

        <div className="execution-context-modal-body">
          <ExecutionContextSnapshotSummary execution={execution} />

          <div className="execution-context-modal-layout">
            <ExecutionContextSnapshotSection
              description="Base URL, browser, notes, and environment variables preserved for this run."
              title={environmentSummary?.name || execution.test_environment?.name || "No environment attached"}
            >
              {environmentSummary ? (
                <>
                  <ExecutionContextMetaGrid
                    items={[
                      { label: "Base URL", value: environmentSummary.base_url || "Not set" },
                      { label: "Browser", value: environmentSummary.browser || "Not set" },
                      {
                        label: "Variables",
                        value: `${environmentSummary.variables.length} variable${environmentSummary.variables.length === 1 ? "" : "s"}`
                      }
                    ]}
                  />
                  {environmentSummary.description ? (
                    <ExecutionContextSnapshotCopyBlock label="Description" value={environmentSummary.description} />
                  ) : null}
                  {environmentSummary.notes ? (
                    <ExecutionContextSnapshotCopyBlock label="Notes" value={environmentSummary.notes} />
                  ) : null}
                  <ExecutionContextVariableTable
                    emptyMessage="No environment variables were snapshotted for this run."
                    entries={environmentSummary.variables}
                    title="Environment variables"
                  />
                </>
              ) : (
                <div className="empty-state compact">No environment snapshot details were recorded for this run.</div>
              )}
            </ExecutionContextSnapshotSection>

            <ExecutionContextSnapshotSection
              description="Browser, mobile target, platform version, and configuration variables preserved with the run."
              title={configurationSummary?.name || execution.test_configuration?.name || "No configuration attached"}
            >
              {configurationSummary ? (
                <>
                  <ExecutionContextMetaGrid
                    items={[
                      { label: "Browser", value: configurationSummary.browser || "Not set" },
                      { label: "Mobile OS", value: configurationSummary.mobile_os || "Not set" },
                      { label: "Platform version", value: configurationSummary.platform_version || "Not set" },
                      {
                        label: "Variables",
                        value: `${configurationSummary.variables.length} variable${configurationSummary.variables.length === 1 ? "" : "s"}`
                      }
                    ]}
                  />
                  {configurationSummary.description ? (
                    <ExecutionContextSnapshotCopyBlock label="Description" value={configurationSummary.description} />
                  ) : null}
                  <ExecutionContextVariableTable
                    emptyMessage="No configuration variables were snapshotted for this run."
                    entries={configurationSummary.variables}
                    title="Configuration variables"
                  />
                </>
              ) : (
                <div className="empty-state compact">No configuration snapshot details were recorded for this run.</div>
              )}
            </ExecutionContextSnapshotSection>

            <ExecutionContextSnapshotSection
              description="The data rows below are the exact run data snapshot used for this run."
              title={dataSetSummary?.name || execution.test_data_set?.name || "No data set attached"}
            >
              {dataSetSummary ? (
                <>
                  <ExecutionContextMetaGrid
                    items={[
                      { label: "Mode", value: dataSetSummary.mode === "table" ? "Table data" : "Key/value data" },
                      { label: "Columns", value: String(dataSetSummary.columns.length) },
                      { label: "Rows", value: String(dataSetSummary.rows.length) }
                    ]}
                  />
                  {dataSetSummary.description ? (
                    <ExecutionContextSnapshotCopyBlock label="Description" value={dataSetSummary.description} />
                  ) : null}
                  <ExecutionContextDataTable snapshot={dataSetSummary} />
                </>
              ) : (
                <div className="empty-state compact">No test data snapshot details were recorded for this execution.</div>
              )}
            </ExecutionContextSnapshotSection>
          </div>
        </div>
      </div>
    </div>
  );
}

function ExecutionContextSnapshotSection({
  title,
  description,
  children
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section className="execution-context-modal-section">
      <div className="execution-context-modal-section-head">
        <div className="execution-context-modal-section-copy">
          <h4>{title}</h4>
          <p>{description}</p>
        </div>
      </div>
      {children}
    </section>
  );
}

function ExecutionContextMetaGrid({
  items
}: {
  items: Array<{
    label: string;
    value: string;
  }>;
}) {
  return (
    <div className="execution-context-modal-meta">
      {items.map((item) => (
        <div className="execution-context-modal-meta-card" key={item.label}>
          <span>{item.label}</span>
          <strong>{item.value}</strong>
        </div>
      ))}
    </div>
  );
}

function ExecutionContextSnapshotCopyBlock({
  label,
  value
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="execution-context-modal-copy-block">
      <strong>{label}</strong>
      <p>{value}</p>
    </div>
  );
}

function ExecutionContextVariableTable({
  entries,
  title,
  emptyMessage
}: {
  entries: KeyValueEntry[];
  title: string;
  emptyMessage: string;
}) {
  return (
    <div className="resource-table-shell execution-context-table-shell">
      <div className="resource-table-toolbar">
        <strong>{title}</strong>
        <span className="count-pill">{entries.length} item{entries.length === 1 ? "" : "s"}</span>
      </div>
      {!entries.length ? <div className="empty-state compact resource-table-empty">{emptyMessage}</div> : null}
      {entries.length ? (
        <div className="table-wrap execution-context-table-wrap">
          <table className="data-table resource-data-table">
            <thead>
              <tr>
                <th>Key</th>
                <th>Value</th>
                <th>Visibility</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry, index) => (
                <tr key={entry.id || `${entry.key}-${index}`}>
                  <td>{entry.key || "Untitled key"}</td>
                  <td>{entry.is_secret ? <span className="execution-context-hidden-value">{entry.has_stored_value ? "Stored secret" : "Hidden secret"}</span> : entry.value || "—"}</td>
                  <td>{entry.is_secret ? "Hidden" : "Visible"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}

function ExecutionContextDataTable({
  snapshot
}: {
  snapshot: ExecutionDataSetSnapshot;
}) {
  if (snapshot.mode === "table") {
    return (
      <div className="resource-table-shell execution-context-table-shell">
        <div className="resource-table-toolbar">
          <strong>Table snapshot</strong>
          <span className="count-pill">{snapshot.rows.length} row{snapshot.rows.length === 1 ? "" : "s"}</span>
        </div>
        {!snapshot.columns.length ? <div className="empty-state compact resource-table-empty">No columns were snapshotted for this data set.</div> : null}
        {snapshot.columns.length ? (
          <div className="table-wrap execution-context-table-wrap">
            <table className="data-table resource-data-table">
              <thead>
                <tr>
                  {snapshot.columns.map((column) => (
                    <th key={column}>{column}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {snapshot.rows.length ? (
                  snapshot.rows.map((row, rowIndex) => (
                    <tr key={`row-${rowIndex}`}>
                      {snapshot.columns.map((column) => (
                        <td key={`${rowIndex}-${column}`}>{row[column] || "—"}</td>
                      ))}
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={snapshot.columns.length}>No rows were snapshotted for this data set.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="resource-table-shell execution-context-table-shell">
      <div className="resource-table-toolbar">
        <strong>Key/value snapshot</strong>
        <span className="count-pill">{snapshot.rows.length} pair{snapshot.rows.length === 1 ? "" : "s"}</span>
      </div>
      {!snapshot.rows.length ? <div className="empty-state compact resource-table-empty">No key/value rows were snapshotted for this data set.</div> : null}
      {snapshot.rows.length ? (
        <div className="table-wrap execution-context-table-wrap">
          <table className="data-table resource-data-table">
            <thead>
              <tr>
                <th>Key</th>
                <th>Value</th>
              </tr>
            </thead>
            <tbody>
              {snapshot.rows.map((row, rowIndex) => (
                <tr key={`row-${rowIndex}`}>
                  <td>{row.key || `Row ${rowIndex + 1}`}</td>
                  <td>{row.value || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
