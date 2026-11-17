import { formatDuration, DEFAULT_DURATION_LABEL } from "../../lib/executionTiming";
import { type ExecutionCaseInstanceView, type ExecutionRunImpactSummary, ExecutionRunIcon } from "../../components/ExecutionRunListCard";
import { IconActivity, IconAlertTriangle, IconArrowLeft, IconArrowRight, IconBug, IconChevronDown, IconChevronRight, IconCircleCheck, IconCircleX, IconClock, IconExternalLink, IconFolder, IconLink, IconListDetails, IconMail, IconPhoto, IconPlayerPlay, IconRefresh, IconSearch, IconShieldCheck, IconUser, IconX } from "@tabler/icons-react";
import { ExportIcon } from "@hellotest/platform/frontend/src/platform/components/AppIcons";
import { AiFeatureComposer } from "@hellotest/agentic/frontend/components/AgenticExperience";
import { CatalogViewToggle } from "@hellotest/platform/frontend/src/shared/components/CatalogViewToggle";
import { EvidenceFlipCard } from "@hellotest/platform/frontend/src/shared/components/EvidenceFlipCard";
import { RunResultChart } from "../../components/RunResultChart";
import { RunContextLinks } from "../../components/RunContextLinks";
import { type RunConfigurationResource } from "../../components/RunConfigurationDialog";
import { runStoryCounts } from "../../lib/runCatalog";
import { summarizeRunScopeCompletion } from "../../lib/runScopeCompletion";
import { MultiAssigneePicker } from "@hellotest/platform/frontend/src/shared/components/MultiAssigneePicker";
import { ReportBugSplitActionButton } from "../../components/ReportBugSplitActionButton";
import { richTextToPlainText } from "@hellotest/platform/frontend/src/platform/components/RichTextEditor";
import { StatusBadge } from "@hellotest/platform/frontend/src/shared/components/StatusBadge";
import { selectExecutionInspectorEvidence } from "../../lib/executionInspectorEvidence";
import { type ExecutionStepEvidence } from "../../lib/executionLogs";
import { type AssigneeOption } from "@hellotest/platform/frontend/src/platform/lib/userDisplay";
import { type Execution, type ExecutionResult, type ExecutionStatus, type TestStep } from "@hellotest/platform/frontend/src/types";
import { ExecutionStructuredLogSummary } from "./ExecutionRunLogs";
import { ExecutionSuiteNode, ExecutionCaseView, CatalogViewMode, executionResultMatchesCaseInstance, evidenceMimeType, formatExecutionTimestamp } from "./executionWorkspaceModel";
import { type ExecutionRunEvidenceAssessment } from "../../lib/executionFailureEvidence";
import { type Dispatch, type SetStateAction } from "react";

import type { FrozenScopeEvidence } from "../../lib/executionRunSummary";

export interface RunDetailSnapshot {
  selectedExecution: Execution | null;
  latestExecutionResults: ExecutionResult[];
  stepsByCaseId: Record<string, TestStep[]>;
  resultByCaseId: Record<string, ExecutionResult>;
  selectedFrozenEvidence: FrozenScopeEvidence | undefined;
}

export interface RunDetailScope {
  isSelectedExecutionTestCaseRun: boolean;
  executionSuites: ExecutionSuiteNode[];
  focusedSuiteId: string;
  displayCasesBySuiteId: Record<string, ExecutionCaseView[]>;
  executionCaseOrder: ExecutionCaseView[];
  instanceDerivedStatus: (instance: ExecutionCaseInstanceView) => "pending" | "failed" | "blocked" | "aborted" | "running" | "paused" | "passed" | "skipped" | "queued";
  focusedExecutionModuleId: string;
  executionCaseSearch: string;
  caseDerivedStatus: (testCase: ExecutionCaseView) => "pending" | "failed" | "blocked" | "aborted" | "running" | "paused" | "passed" | "skipped" | "queued";
  inspectedExecutionCaseId: string;
  nextFocusCase: ExecutionCaseView;
  executionSuiteSearch: string;
  setFocusedSuiteId: Dispatch<SetStateAction<string>>;
  setFocusedExecutionModuleId: Dispatch<SetStateAction<string>>;
  setInspectedExecutionCaseId: Dispatch<SetStateAction<string>>;
  setExpandedExecutionSuiteIds: Dispatch<SetStateAction<string[]>>;
  setExecutionCaseSearch: Dispatch<SetStateAction<string>>;
  setRunConfigurationResource: Dispatch<SetStateAction<RunConfigurationResource | null>>;
  isExecutionHierarchyCollapsed: boolean;
  setIsExecutionHierarchyCollapsed: Dispatch<SetStateAction<boolean>>;
  setExecutionSuiteSearch: Dispatch<SetStateAction<string>>;
  filteredExecutionSuites: ExecutionSuiteNode[];
  expandedExecutionSuiteIds: string[];
  toggleSuiteGroup: (suiteId: string) => void;
  setIsRunWorkflowOpen: Dispatch<SetStateAction<boolean>>;
  setExecutionCaseCatalogViewMode: Dispatch<SetStateAction<CatalogViewMode>>;
  executionCaseCatalogViewMode: CatalogViewMode;
  selectedExecutionSuiteIds: string[];
}

export interface RunDetailMetrics {
  averageCaseDurationMs: number | null;
  remainingCaseCount: number;
  executionStatusCounts: Record<string, number>;
  selectedExecutionImpactSummary: ExecutionRunImpactSummary;
  isExecutionLocked: boolean;
  currentExecutionStatus: ExecutionStatus;
  selectedExecutionStartMode: "local" | "remote" | "manual";
  selectedRunPassRate: number | null;
  selectedRunFinalizedCount: number;
  executionProgress: { totalCases: number; passedCount: number; failedCount: number; blockedCount: number; runningCount: number; completedCases: number; percent: number; derivedStatus: string; };
  selectedRunCompletionPercent: number;
  selectedExecutionDurationMs: number;
  isExecutionStarted: boolean;
  resolveExecutionCaseDurationMs: (testCase: ExecutionCaseView) => number;
  executionResultsWithTiming: number;
}

export interface RunDetailAccess {
  canExecuteRuns: boolean;
  canRunLocalAutomation: boolean;
  canRunRemoteAutomation: boolean;
  canExportRunReports: boolean;
  canShareRunReports: boolean;
  canReportBugs: boolean;
  canUseAiBugTriage: boolean;
  canUseRunAi: boolean;
  canUpdateRuns: boolean;
  canManageRunResults: boolean;
  canViewRunEvidence: boolean;
}

export interface RunDetailActions {
  startExecution: { isPending: boolean };
  closeExecutionDrilldown: () => void;
  htmlReportMutation: { isPending: boolean };
  handleOpenHtmlReport: () => Promise<void>;
  handleStartSelectedExecution: (mode?: "local" | "remote" | "manual") => Promise<void>;
  focusExecutionCase: (testCaseId: string, executionId?: string, caseInstanceKey?: string | null | undefined) => void;
  rerunExecution: { isPending: boolean };
  handleRerunExecution: (failedOnly: boolean) => Promise<void>;
  downloadExecutionReport: { isPending: boolean };
  handleDownloadExecutionReport: () => Promise<void>;
  shareExecutionReport: { isPending: boolean };
  handleOpenReportEmailModal: () => void;
  handleReportSelectedExecutionIssue: (scope?: "suite" | "run" | "module" | "case", scopedContext?: { testCaseId?: string | undefined; suiteId?: string | undefined; suiteName?: string | undefined; moduleId?: string | undefined; moduleName?: string | undefined; }, mode?: "manual" | "ai") => void;
  completeExecution: { isPending: boolean };
  handleFinalizeExecution: (mode: "abort" | "complete") => Promise<void>;
  executionFinalizeAction: "abort" | "complete" | null;
  handleRunExecutionAiAnalysis: () => Promise<void>;
  handlePreviewFailureClusters: () => void;
  updateExecutionScopeAssignment: { isPending: boolean };
  handleScopeAssignmentChange: (level: "suites" | "modules", scopeId: string, assignedToIds: string[]) => Promise<void>;
  assigneeOptions: AssigneeOption[];
  handleSuiteBulkStatus: (suiteId: string, status: "failed" | "passed") => Promise<void>;
  openingEvidenceStepId: string;
  openExecutionEvidence: (step: Pick<TestStep, "id" | "step_order">, evidence: ExecutionStepEvidence, label?: string) => Promise<void>;
}

export interface RunDetailAnalysis {
  selectedRunEvidenceReadiness: ExecutionRunEvidenceAssessment;
  setIsRunEvidenceAnalysisOpen: Dispatch<SetStateAction<boolean>>;
  runAnalysisInteractionMode: "chat" | "agent";
  setRunAnalysisInteractionMode: Dispatch<SetStateAction<"chat" | "agent">>;
  setRunAnalysisInstruction: Dispatch<SetStateAction<string>>;
  runAnalysisInstruction: string;
  isSelectedRunAnalysisPending: boolean;
  hasRecordedRunAnalysis: boolean;
  projectId: string;
}

export interface ExecutionRunDetailProps {
  snapshot: RunDetailSnapshot;
  scope: RunDetailScope;
  metrics: RunDetailMetrics;
  access: RunDetailAccess;
  actions: RunDetailActions;
  analysis: RunDetailAnalysis;
}

export function ExecutionRunDetail({ snapshot, scope, metrics, access, actions, analysis }: ExecutionRunDetailProps) {
  const { selectedExecution, latestExecutionResults, stepsByCaseId, resultByCaseId, selectedFrozenEvidence } = snapshot;
  const { isSelectedExecutionTestCaseRun, executionSuites, focusedSuiteId, displayCasesBySuiteId, executionCaseOrder, instanceDerivedStatus, focusedExecutionModuleId, executionCaseSearch, caseDerivedStatus, inspectedExecutionCaseId, nextFocusCase, executionSuiteSearch, setFocusedSuiteId, setFocusedExecutionModuleId, setInspectedExecutionCaseId, setExpandedExecutionSuiteIds, setExecutionCaseSearch, setRunConfigurationResource, isExecutionHierarchyCollapsed, setIsExecutionHierarchyCollapsed, setExecutionSuiteSearch, filteredExecutionSuites, expandedExecutionSuiteIds, toggleSuiteGroup, setIsRunWorkflowOpen, setExecutionCaseCatalogViewMode, executionCaseCatalogViewMode, selectedExecutionSuiteIds } = scope;
  const { averageCaseDurationMs, remainingCaseCount, executionStatusCounts, selectedExecutionImpactSummary, isExecutionLocked, currentExecutionStatus, selectedExecutionStartMode, selectedRunPassRate, selectedRunFinalizedCount, executionProgress, selectedRunCompletionPercent, selectedExecutionDurationMs, isExecutionStarted, resolveExecutionCaseDurationMs, executionResultsWithTiming } = metrics;
  const { canExecuteRuns, canRunLocalAutomation, canRunRemoteAutomation, canExportRunReports, canShareRunReports, canReportBugs, canUseAiBugTriage, canUseRunAi, canUpdateRuns, canManageRunResults, canViewRunEvidence } = access;
  const { startExecution, closeExecutionDrilldown, htmlReportMutation, handleOpenHtmlReport, handleStartSelectedExecution, focusExecutionCase, rerunExecution, handleRerunExecution, downloadExecutionReport, handleDownloadExecutionReport, shareExecutionReport, handleOpenReportEmailModal, handleReportSelectedExecutionIssue, completeExecution, handleFinalizeExecution, executionFinalizeAction, handleRunExecutionAiAnalysis, handlePreviewFailureClusters, updateExecutionScopeAssignment, handleScopeAssignmentChange, assigneeOptions, handleSuiteBulkStatus, openingEvidenceStepId, openExecutionEvidence } = actions;
  const { selectedRunEvidenceReadiness, setIsRunEvidenceAnalysisOpen, runAnalysisInteractionMode, setRunAnalysisInteractionMode, setRunAnalysisInstruction, runAnalysisInstruction, isSelectedRunAnalysisPending, hasRecordedRunAnalysis, projectId } = analysis;

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
    const { result: inspectedResult, evidence: inspectedEvidence, step: inspectedEvidenceStep } = selectExecutionInspectorEvidence({
      executionId: selectedExecution.id,
      testCaseId: inspectedCase?.id || "",
      results: latestExecutionResults,
      steps: inspectedCase ? stepsByCaseId[inspectedCase.id] || [] : []
    });
    const inspectedInstance = inspectedResult
      ? inspectedCase?.data_set_instances.find((instance) => executionResultMatchesCaseInstance(inspectedResult, instance))
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
    const runStories = selectedFrozenEvidence?.availability === "available" ? {failed: selectedFrozenEvidence.impacted_stories.length, total: selectedFrozenEvidence.total_stories} : runStoryCounts(selectedExecution, selectedExecutionImpactSummary);
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
            caption={selectedFrozenEvidence?.story_link_provenance === "legacy_current_links" ? "Historical run · current Story links fallback" : "Frozen Stories linked to failed or blocked cases / all frozen Stories"}
            frontIcon={<IconLink size={18} stroke={1.8} />}
            tone={runStories.failed ? "warning" : "success"}
            evidence={(selectedFrozenEvidence?.story_link_provenance === "legacy_current_links" ? ["This historical run has no saved Story-link snapshot. Counts use current authorized links; they do not prove the historical Story membership."] : []).concat(selectedExecutionImpactSummary.impactedRequirements.filter((story) => story.failedCases > 0).map((story) => `${story.title} · ${story.failedCases} failed case${story.failedCases === 1 ? "" : "s"}`).concat(!selectedFrozenEvidence || selectedFrozenEvidence.availability !== "available" ? ["Frozen Story evidence is unavailable or still loading. Reload run details to verify scope."] : selectedExecutionImpactSummary.failedRequirementCount ? [] : ["No failed or blocked cases are linked to Stories in this run scope."]))}
            actionLabel="Inspect failed cases"
            actionDisabled={!selectedExecutionImpactSummary.failedCases.some((item) => item.status === "failed")}
            onAction={() => { const first = selectedExecutionImpactSummary.failedCases.find((item) => item.status === "failed"); if (first) { if (first.suiteId) setFocusedSuiteId(first.suiteId); setFocusedExecutionModuleId(""); setInspectedExecutionCaseId(first.id); setExecutionCaseSearch("failed"); } }}
          />
          <EvidenceFlipCard
            key={`${selectedExecution.id}-readiness`}
            autoResetMs={0}
            resetOnChange={false}
            className="execution-run-insight-card"
            label="Evidence completeness"
            value={selectedRunEvidenceReadiness.scoreDisplay || `${selectedRunEvidenceReadiness.score}%`}
            caption={selectedRunEvidenceReadiness.summary}
            frontIcon={<IconShieldCheck size={18} stroke={1.8} />}
            tone="info"
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
                      title={`Inspect ${testCase.title}`}
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
                    <button onClick={() => focusExecutionCase(inspectedCase.id, selectedExecution.id, inspectedInstance?.instance_key)} type="button">
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

}
