import { type ExecutionCaseInstanceView, type ExecutionRunSummary, type ExecutionRunImpactSummary, buildExecutionCaseInstances, type BoardStatusTone, BOARD_STATUS_META, normalizeExecutionStatus } from "../../components/ExecutionRunListCard";
import { ArchiveIcon, GithubIcon, GoogleDriveIcon, ImportIcon, PlayIcon, SparkIcon, UsersIcon } from "@hellotest/platform/frontend/src/platform/components/AppIcons";
import { resolveExecutionParameterContext } from "../../lib/executionParameterContext";
import { runCatalogBucket } from "../../lib/runCatalog";
import { AutomationCodeIcon } from "@hellotest/automation/frontend/components/StepAutomationEditor";
import { type RunHookSelection } from "../../components/RunHooksBuilder";
import { parseExecutionLogs, type ExecutionStepApiDetail, type ExecutionStepCaptureMap, type ExecutionStepEvidence } from "../../lib/executionLogs";
import { parseStepParameterName } from "@hellotest/platform/frontend/src/shared/lib/stepParameters";
import { type AssigneeOption } from "@hellotest/platform/frontend/src/platform/lib/userDisplay";
import { type Execution, type ExecutionCaseSnapshot, type ExecutionResult, type ExecutionStepSnapshot, type SmartExecutionImpactCase, type TestStep, type WorkspaceTransaction } from "@hellotest/platform/frontend/src/types";

export type ExecutionTab = "overview" | "logs" | "failures" | "history" | "evidence";

export type ExecutionSuiteNode = {
  id: string;
  name: string;
  isHistorical?: boolean;
};

export type ExecutionCaseView = {
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

export type ExecutionStepBlock = {
  key: string;
  groupId: string | null;
  groupName: string | null;
  groupKind: TestStep["group_kind"];
  steps: TestStep[];
};

export type ExecutionIssueFilter = "all" | "with-issues" | "clean";

export type ExecutionEvidenceFilter = "all" | "with-evidence" | "no-evidence";

export type ExecutionCreateMode = "manual" | "smart";

export type ExecutionStartMode = "manual" | "remote" | "local";

export type ExecutionHookDraft = RunHookSelection[];

export const emptyExecutionHookDraft = (): ExecutionHookDraft => [];

export type TestRunsView = "suite-runs" | "local-runs" | "scheduled-runs" | "batch-process";

export type CatalogViewMode = "tile" | "list";

export type ExecutionAssigneeOption = AssigneeOption;

export type ExecutionEvidencePreviewState = {
  attachmentId?: string;
  stepLabel: string;
  fileName: string | null;
  mimeType: string;
  sourceUrl: string;
};

export type ExecutionApiDetailState = {
  step: TestStep;
  detail: ExecutionStepApiDetail | null;
  captures: Record<string, string>;
  note: string;
  status: ExecutionResult["status"] | "queued";
};

export type ExecutionApiStepDialogProps = {
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

export type SmartExecutionRequirementOption = {
  id: string;
  title: string;
  description: string | null;
  linkedCaseCount: number;
};

export type ExecutionScheduleCadence = "once" | "daily" | "weekly" | "monthly" | "interval_minutes";

export const BATCH_PROCESS_CATEGORIES = new Set([
  "bulk_import",
  "ai_generation",
  "backup",
  "automation_build",
  "smart_execution",
  "reporting"
]);

export const EMPTY_EXECUTION_RUN_SUMMARY: ExecutionRunSummary = {
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

export const EMPTY_EXECUTION_RUN_IMPACT_SUMMARY: ExecutionRunImpactSummary = {
  failedCases: [],
  impactedRequirements: [],
  totalRequirements: 0,
  failedRequirementCount: 0,
  failureRate: 0
};

export function executionResultMatchesCaseInstance(
  result: ExecutionResult,
  instance: ExecutionCaseInstanceView
) {
  if (result.test_case_id !== instance.test_case_id) {
    return false;
  }
  if (result.derived && result.covers_entire_case) return true;

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

export function getExecutionRiskTone(summary: ExecutionRunSummary, impactSummary: ExecutionRunImpactSummary): "success" | "info" | "warning" | "danger" {
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

export function getExecutionRiskLabel(summary: ExecutionRunSummary, impactSummary: ExecutionRunImpactSummary) {
  const tone = getExecutionRiskTone(summary, impactSummary);
  if (tone === "danger") return "High risk";
  if (tone === "warning") return "Watch";
  if (tone === "success") return "Healthy";
  return "Learning";
}

export function getExecutionRiskInsight(summary: ExecutionRunSummary, impactSummary: ExecutionRunImpactSummary, scopedCaseCount: number) {
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

export const DEFAULT_CATALOG_VIEW_MODE_BY_RUN_VIEW: Record<TestRunsView, CatalogViewMode> = {
  "suite-runs": "tile",
  "local-runs": "tile",
  "scheduled-runs": "tile",
  "batch-process": "tile"
};

export const DEFAULT_RUN_LIBRARY_SEARCH_BY_VIEW: Record<TestRunsView, string> = {
  "suite-runs": "",
  "local-runs": "",
  "scheduled-runs": "",
  "batch-process": ""
};

export const buildIntervalCadence = (minutes: number) => `every:${Math.max(1, Math.floor(minutes || 5))}:minutes`;

export const parseIntervalCadenceMinutes = (cadence?: string | null) => {
  const match = String(cadence || "").match(/^every:(\d+):minutes$/);
  return match ? Math.max(1, Number(match[1]) || 5) : 5;
};

export const isIntervalCadence = (cadence?: string | null) => /^every:\d+:minutes$/.test(String(cadence || ""));

export const formatScheduleCadence = (cadence?: string | null) =>
  isIntervalCadence(cadence)
    ? `Every ${parseIntervalCadenceMinutes(cadence)} mins`
    : String(cadence || "once").replace(/[_-]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());

export const EXECUTION_POLL_INTERVAL_MS = 20_000;

export const WORKSPACE_TRANSACTION_METADATA_LABELS: Record<string, string> = {
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

export const MAX_AI_BUG_CONTEXT_ITEMS = 25;

export const MAX_AI_BUG_EVIDENCE_LINES = 5;

export const EXECUTION_CASE_LIST_COLUMN_PREFERENCE_KEY = "hellotest:execution-cases:list-columns:v2";

export function executionStatusLabel(status: Execution["status"] | null | undefined) {
  return BOARD_STATUS_META[normalizeExecutionStatus(status)].label;
}

export function executionStatusTooltip(status: Execution["status"] | null | undefined) {
  const { label, description } = BOARD_STATUS_META[normalizeExecutionStatus(status)];
  return `${label}: ${description}`;
}

export function suiteBoardStatus(metric: {
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

export function toCaseView(snapshot: ExecutionCaseSnapshot, execution?: Execution | null): ExecutionCaseView {
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

export function toStepView(snapshot: ExecutionStepSnapshot): TestStep {
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

export function isStepGroupStart(steps: TestStep[], index: number) {
  const currentStep = steps[index];
  const previousStep = steps[index - 1];

  return Boolean(currentStep?.group_id) && currentStep.group_id !== previousStep?.group_id;
}

export const mergeExecutionEvidencePatch = (
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

export const evidenceMimeType = (evidence?: ExecutionStepEvidence | null) => {
  if (evidence?.mimeType) {
    return evidence.mimeType;
  }
  return evidence?.dataUrl?.match(/^data:([^;,]+)/i)?.[1] || "application/octet-stream";
};

export function buildProgressSegments(
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

export const executionDateTimeFormatter = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit"
});

export function toTimestamp(value?: string | null) {
  if (!value) {
    return null;
  }

  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? null : parsed;
}

export function formatExecutionTimestamp(value?: string | null, fallback = "Not recorded") {
  const timestamp = toTimestamp(value);
  return timestamp ? executionDateTimeFormatter.format(timestamp) : fallback;
}

export function toDateTimeLocalValue(value?: string | null) {
  const timestamp = toTimestamp(value);

  if (!timestamp) {
    return "";
  }

  const date = new Date(timestamp);
  const offsetMs = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
}

export function computeExecutionDurationMs(
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

export function readWorkspaceTransactionCount(transaction: WorkspaceTransaction, key: string) {
  const value = transaction.metadata?.[key];
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function formatCountLabel(count: number, singular: string, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

export function describeWorkspaceTransaction(
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

export function resolveWorkspaceTransactionSummary(
  transaction: WorkspaceTransaction,
  presentation: ReturnType<typeof describeWorkspaceTransaction>
) {
  if (transaction.action === "scheduled_test_case_generation" || transaction.category === "ai_generation") {
    return presentation.detail;
  }

  return transaction.description || presentation.detail;
}

export function formatWorkspaceTransactionActionLabel(value: string | null | undefined) {
  const normalized = String(value || "").trim();

  if (!normalized) {
    return "Not recorded";
  }

  return normalized.replace(/_/g, " ");
}

export function truncateProcessName(value?: string | null, limit = 46) {
  const normalized = String(value || "Batch process").trim();

  if (normalized.length <= limit) {
    return normalized;
  }

  return `${normalized.slice(0, Math.max(0, limit - 1)).trimEnd()}…`;
}

export function formatWorkspaceTransactionMetadataLabel(key: string) {
  return WORKSPACE_TRANSACTION_METADATA_LABELS[key] || key.replace(/_/g, " ");
}

export function formatWorkspaceTransactionMetadataValue(value: unknown): string {
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

export function resolveWorkspaceTransactionMetadataEntries(transaction: WorkspaceTransaction) {
  return Object.entries(transaction.metadata || {})
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .map(([key, value]) => ({
      key,
      label: formatWorkspaceTransactionMetadataLabel(key),
      value
    }));
}

export function resolveWorkspaceTransactionReadableMetadata(transaction: WorkspaceTransaction) {
  return resolveWorkspaceTransactionMetadataEntries(transaction).filter(({ value }) => typeof value !== "object" || Array.isArray(value));
}

export function resolveWorkspaceTransactionComplexMetadata(transaction: WorkspaceTransaction) {
  const entries = resolveWorkspaceTransactionMetadataEntries(transaction).filter(({ value }) => typeof value === "object" && value !== null && !Array.isArray(value));

  return entries.length
    ? entries.reduce<Record<string, unknown>>((accumulator, { key, value }) => {
        accumulator[key] = value;
        return accumulator;
      }, {})
    : null;
}

export function executionImpactLevelLabel(level: SmartExecutionImpactCase["impact_level"]) {
  return level.charAt(0).toUpperCase() + level.slice(1);
}

export function averageDuration(values: Array<number | null | undefined>) {
  const scoped = values.filter((value): value is number => typeof value === "number" && !Number.isNaN(value));

  if (!scoped.length) {
    return null;
  }

  return Math.round(scoped.reduce((sum, value) => sum + value, 0) / scoped.length);
}

export function isExecutionRunsView(view: TestRunsView) {
  return view === "suite-runs" || view === "local-runs";
}

export function resolveExecutionRunBucket(execution: Execution): Extract<TestRunsView, "suite-runs" | "local-runs"> {
  if (execution.trigger === "local") {
    return "local-runs";
  }

  return runCatalogBucket(execution);
}

export function buildExecutionInputParameterValues(
  execution: Execution | null,
  caseSnapshot: ExecutionCaseSnapshot | null,
  caseInstance?: ExecutionCaseInstanceView | null
) {
  return resolveExecutionParameterContext({ execution, caseSnapshot,
    dataSetRow: caseInstance?.data_set_row_snapshot,
    rowIndex: caseInstance?.data_set_iteration_index
  }).values;
}

export function collectExecutionOutputParameterValues(
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

export function collectSuiteScopedExecutionOutputParameterValues(
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

export function mergeExecutionStepCaptures(
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

export function isBatchProcessTransaction(transaction: WorkspaceTransaction) {
  return BATCH_PROCESS_CATEGORIES.has(transaction.category)
    || transaction.action === "testengine_run"
    || transaction.action === "execution_report_export"
    || transaction.action === "run_report_export";
}
