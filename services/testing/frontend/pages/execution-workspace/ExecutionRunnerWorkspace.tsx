import { type ReactNode, Fragment, type Dispatch, type SetStateAction } from "react";
import { formatDuration, DEFAULT_DURATION_LABEL } from "../../lib/executionTiming";
import { type ExecutionCaseInstanceView, type BoardStatusTone, BOARD_STATUS_META, ExecutionRunIcon } from "../../components/ExecutionRunListCard";
import { ExecutionAutomationStepCard } from "../../components/ExecutionRunnerStep";
import { ExecutionHookResults } from "../../components/ExecutionHookResults";
import { capabilityView } from "@hellotest/platform/frontend/src/platform/capabilities/CapabilityView";
import { getAdminFeatureUrl } from "@hellotest/platform/frontend/src/platform/lib/adminFeatureLinks";
import { IconActivity, IconArrowLeft, IconArrowRight, IconBug, IconCheck, IconCheckbox, IconChevronDown, IconChevronRight, IconDots, IconCircleCheck, IconCircleX, IconClock, IconCode, IconExternalLink, IconFileReport, IconInfoCircle, IconLink, IconListDetails, IconMail, IconPhoto, IconPlayerPlay, IconPlayerPause, IconRefresh, IconTerminal2, IconUser, IconX } from "@tabler/icons-react";
import { CollapseExpandIcon, OpenIcon } from "@hellotest/platform/frontend/src/platform/components/AppIcons";
import { FormField } from "@hellotest/platform/frontend/src/shared/components/FormField";
import { CaseRunAttachmentPanel } from "../../components/CaseRunAttachmentPanel";
import { CaseRunParameterContext } from "../../components/CaseRunParameterContext";
import { RunContextLinks } from "../../components/RunContextLinks";
import { type RunConfigurationResource } from "../../components/RunConfigurationDialog";
import { ExternalReferencesField } from "@hellotest/manual/frontend/components/ExternalReferencesField";
import { JiraAttachmentPanel } from "@hellotest/integration/frontend/components/JiraAttachmentPanel";
import { ProgressMeter } from "@hellotest/platform/frontend/src/shared/components/ProgressMeter";
import { ReportBugSplitActionButton } from "../../components/ReportBugSplitActionButton";
import { type ExecutionCaseLifecycleAction } from "../../lib/executionCaseLifecycle";
import { StatusBadge } from "@hellotest/platform/frontend/src/shared/components/StatusBadge";
import { SubnavTabs } from "@hellotest/platform/frontend/src/shared/components/SubnavTabs";
import { areFeatureFlagsEnabled } from "@hellotest/platform/frontend/src/platform/lib/featureFlags";
import { hasPermission } from "@hellotest/platform/frontend/src/platform/lib/permissions";
import { resolveStepAutomationCode } from "@hellotest/automation/frontend/lib/stepAutomation";
import { type ExecutionStepApiDetail, type ExecutionStepEvidence, type ExecutionStepStatus, type ExecutionStepAutomationDetail, type ExecutionStepWebDetail } from "../../lib/executionLogs";
import { combineStepParameterValues } from "@hellotest/platform/frontend/src/shared/lib/stepParameters";
import { type AssigneeOption, resolveUserPrimaryLabel } from "@hellotest/platform/frontend/src/platform/lib/userDisplay";
import { type Execution, type ExecutionCaseSnapshot, type ExecutionResult, type ExecutionStatus, type Integration, type TestStep, type SessionPayload, type FeatureFlagSnapshot } from "@hellotest/platform/frontend/src/types";
import { ExecutionStructuredLogView, ExecutionStructuredLogSummary } from "./ExecutionRunLogs";
import { ExecutionAssigneeChip, ExecutionStepGroupRow } from "./ExecutionWorkspacePrimitives";
import { ExecutionTab, ExecutionSuiteNode, ExecutionCaseView, ExecutionStepBlock, executionResultMatchesCaseInstance, executionStatusLabel, buildProgressSegments, formatExecutionTimestamp } from "./executionWorkspaceModel";

const AiLifecycleReview = capabilityView<import("react").ComponentProps<typeof import("@hellotest/ai/frontend/components/AiLifecycleReview")["AiLifecycleReview"]>>("ai", "AiLifecycleReview", () => import("@hellotest/ai/frontend/components/AiLifecycleReview"), "AI review");

export interface RunnerSnapshot {
  selectedExecution: Execution | null;
  selectedExecutionCase: ExecutionCaseView | null;
  selectedExecutionCaseReadableTitle: string;
  selectedExecutionCaseReadableDescription: string;
  hasSelectedCaseTestData: boolean;
  selectedExecutionCaseInstance: ExecutionCaseInstanceView;
  selectedCaseLiveView: { engine_run_id: string; test_case_id: string; data_set_iteration_index: number | null; data_set_iteration_key: string | null; provider: string; url: string; } | null;
  currentExecutionStatus: ExecutionStatus;
  selectedExecutionResult: ExecutionResult | null;
  selectedExecutionCaseSnapshot: ExecutionCaseSnapshot | null;
  selectedExecutionAppTypeKind: "web" | "api" | "android" | "ios" | "unified" | null;
  instanceDerivedStatus: (instance: ExecutionCaseInstanceView) => "pending" | "failed" | "blocked" | "aborted" | "running" | "paused" | "passed" | "skipped" | "queued";
  selectedSteps: TestStep[];
  suiteExecutionOutputParameterValues: Record<string, string>;
  executionOutputParameterValues: Record<string, string>;
  executionPreconditionSteps: TestStep[];
  executionStepGroupIds: string[];
  executionMainSteps: TestStep[];
  executionStepBlocks: ExecutionStepBlock[];
  stepAutomationDetails: Record<string, ExecutionStepAutomationDetail>;
  stepApiDetails: Record<string, ExecutionStepApiDetail>;
  stepNotes: Record<string, string>;
  stepStatuses: Record<string, ExecutionStepStatus>;
  stepWebDetails: Record<string, ExecutionStepWebDetail>;
  selectedTestCaseId: string;
  executionResults: ExecutionResult[];
  selectedCaseHistory: ExecutionResult[];
  executionById: Record<string, Execution>;
  stepEvidence: Record<string, ExecutionStepEvidence>;
  selectedExecutionCaseEffectiveUser: { id: string; email: string; name: string | null; avatar_data_url?: string | null | undefined; } | null;
  assigneeOptions: AssigneeOption[];
}

export interface RunnerView {
  hasSelectedStepAutomationCode: boolean;
  setActiveTab: Dispatch<SetStateAction<ExecutionTab>>;
  setExecutionStepViewMode: Dispatch<SetStateAction<"gherkin" | "structured" | "automation">>;
  setRunConfigurationResource: Dispatch<SetStateAction<RunConfigurationResource | null>>;
  activeTab: ExecutionTab;
  expandedExecutionStepSections: { preconditions: boolean; testSteps: boolean; };
  setExpandedExecutionStepSections: Dispatch<SetStateAction<{ preconditions: boolean; testSteps: boolean; }>>;
  visibleExecutionStepViewMode: "gherkin" | "structured" | "automation";
  bulkSelectedStepIds: string[];
  setBulkSelectedStepIds: Dispatch<SetStateAction<string[]>>;
  expandedExecutionStepGroupIds: string[];
  setExpandedExecutionStepGroupIds: Dispatch<SetStateAction<string[]>>;
  setHistoryResult: Dispatch<SetStateAction<ExecutionResult | null>>;
}

export interface RunnerAccess {
  canReportBugs: boolean;
  canUseAiBugTriage: boolean;
  canExportRunReports: boolean;
  canShareRunReports: boolean;
  canViewRunAutomationCode: boolean;
  canExecuteRuns: boolean;
  canManageRunResults: boolean;
  canViewRunEvidence: boolean;
  canViewRunGherkin: boolean;
  session: SessionPayload | null;
  canRecordSelectedCase: boolean;
  canPreviewRunAutomation: boolean;
  canUseRunAi: boolean;
  can: (permission: string, overrideProjectId?: string | null | undefined) => boolean;
  featureFlagsQuery: { data?: FeatureFlagSnapshot };
  projectId: string;
  appTypeId: string;
  integrations: Integration[];
  canCreateRunEvidence: boolean;
  canDeleteRunEvidence: boolean;
  canUpdateRuns: boolean;
}

export interface RunnerActions {
  handleReportSelectedExecutionIssue: (scope?: "suite" | "run" | "module" | "case", scopedContext?: { testCaseId?: string | undefined; suiteId?: string | undefined; suiteName?: string | undefined; moduleId?: string | undefined; moduleName?: string | undefined; }, mode?: "manual" | "ai") => void;
  downloadExecutionCaseReport: { isPending: boolean };
  handleDownloadExecutionCaseReport: () => Promise<void>;
  shareExecutionCaseReport: { isPending: boolean };
  handleOpenCaseReportEmailModal: () => void;
  completeExecution: { isPending: boolean };
  startExecution: { isPending: boolean };
  handleFinalizeExecution: (mode: "abort" | "complete") => Promise<void>;
  executionFinalizeAction: "abort" | "complete" | null;
  handleStartSelectedExecution: (mode?: "local" | "remote" | "manual") => Promise<void>;
  rerunExecution: { isPending: boolean };
  handleRerunExecution: (failedOnly: boolean) => Promise<void>;
  caseLifecycleAction: string | null;
  handleCaseLifecycle: (action: ExecutionCaseLifecycleAction) => Promise<void>;
  renderExecutionStepCard: (step: TestStep) => ReactNode;
  openHookEvidence: (evidence: ExecutionStepEvidence, stepId: string) => Promise<void>;
  handleBulkStepStatus: (status: "failed" | "passed", scope: "selected" | "all") => Promise<void>;
  openExecutionGroupAutomationPreview: (groupName: string, steps: TestStep[]) => void;
  openExecutionEvidence: (step: Pick<TestStep, "id" | "step_order">, evidence: ExecutionStepEvidence, label?: string) => Promise<void>;
  ensureSelectedCaseResult: () => Promise<ExecutionResult>;
  refreshExecutionScope: (executionId?: string) => Promise<void>;
}

export interface RunnerProgress {
  selectedCaseStatusLabel: string;
  selectedCaseDurationMs: number | null;
  isSelectedResultDerived: boolean;
  isSelectedCaseAutomated: boolean;
  isExecutionStarted: boolean;
  isExecutionLocked: boolean;
  isSelectedCaseTimerActive: boolean;
  selectedStepProgress: { passedCount: number; failedCount: number; pendingCount: number; percent: number; };
  selectedRuntimeTelemetry: { webStepCount: number; consoleCount: number; networkCount: number; artifactCount: number; avgWebDurationMs: number | null; };
  resolvedEvidenceArtifactCount: number;
}

export interface RunnerNavigation {
  focusedExecutionSuite: ExecutionSuiteNode | null;
  closeCaseDrilldown: () => void;
  focusExecutionCase: (testCaseId: string, executionId?: string, caseInstanceKey?: string | null | undefined) => void;
  previousExecutionCaseInstance: { testCase: ExecutionCaseView; instance: ExecutionCaseInstanceView; } | null;
  focusNeighborExecutionCase: (entry: { testCase: ExecutionCaseView; instance: ExecutionCaseInstanceView; } | null) => Promise<void>;
  selectedExecutionCaseInstanceIndex: number;
  executionCaseInstanceOrder: { testCase: ExecutionCaseView; instance: ExecutionCaseInstanceView; }[];
  nextExecutionCaseInstance: { testCase: ExecutionCaseView; instance: ExecutionCaseInstanceView; } | null;
}

export interface RunnerAssignment {
  selectedExecutionCaseAssignmentHint: string;
  updateExecutionCaseAssignment: { isPending: boolean };
  caseAssignmentDraft: string;
  setCaseAssignmentDraft: Dispatch<SetStateAction<string>>;
  hasCaseAssignmentChange: boolean;
  handleSaveCaseAssignment: () => Promise<void>;
  updateResult: { isPending: boolean };
  createResult: { isPending: boolean };
  caseReferenceDraft: string;
  setCaseReferenceDraft: Dispatch<SetStateAction<string>>;
  setCaseDefectDraft: Dispatch<SetStateAction<string>>;
  caseDefectDraft: string;
  hasCaseReferenceChange: boolean;
  handleSaveCaseReferences: () => Promise<void>;
}

export interface ExecutionRunnerWorkspaceProps {
  snapshot: RunnerSnapshot;
  view: RunnerView;
  access: RunnerAccess;
  actions: RunnerActions;
  progress: RunnerProgress;
  navigation: RunnerNavigation;
  assignment: RunnerAssignment;
}

export function ExecutionRunnerWorkspace({ snapshot, view, access, actions, progress, navigation, assignment }: ExecutionRunnerWorkspaceProps) {
  const { selectedExecution, selectedExecutionCase, selectedExecutionCaseReadableTitle, selectedExecutionCaseReadableDescription, hasSelectedCaseTestData, selectedExecutionCaseInstance, selectedCaseLiveView, currentExecutionStatus, selectedExecutionResult, selectedExecutionCaseSnapshot, selectedExecutionAppTypeKind, instanceDerivedStatus, selectedSteps, suiteExecutionOutputParameterValues, executionOutputParameterValues, executionPreconditionSteps, executionStepGroupIds, executionMainSteps, executionStepBlocks, stepAutomationDetails, stepApiDetails, stepNotes, stepStatuses, stepWebDetails, selectedTestCaseId, executionResults, selectedCaseHistory, executionById, stepEvidence, selectedExecutionCaseEffectiveUser, assigneeOptions } = snapshot;
  const { hasSelectedStepAutomationCode, setActiveTab, setExecutionStepViewMode, setRunConfigurationResource, activeTab, expandedExecutionStepSections, setExpandedExecutionStepSections, visibleExecutionStepViewMode, bulkSelectedStepIds, setBulkSelectedStepIds, expandedExecutionStepGroupIds, setExpandedExecutionStepGroupIds, setHistoryResult } = view;
  const { canReportBugs, canUseAiBugTriage, canExportRunReports, canShareRunReports, canViewRunAutomationCode, canExecuteRuns, canManageRunResults, canViewRunEvidence, canViewRunGherkin, session, canRecordSelectedCase, canPreviewRunAutomation, canUseRunAi, can, featureFlagsQuery, projectId, appTypeId, integrations, canCreateRunEvidence, canDeleteRunEvidence, canUpdateRuns } = access;
  const { handleReportSelectedExecutionIssue, downloadExecutionCaseReport, handleDownloadExecutionCaseReport, shareExecutionCaseReport, handleOpenCaseReportEmailModal, completeExecution, startExecution, handleFinalizeExecution, executionFinalizeAction, handleStartSelectedExecution, rerunExecution, handleRerunExecution, caseLifecycleAction, handleCaseLifecycle, renderExecutionStepCard, openHookEvidence, handleBulkStepStatus, openExecutionGroupAutomationPreview, openExecutionEvidence, ensureSelectedCaseResult, refreshExecutionScope } = actions;
  const { selectedCaseStatusLabel, selectedCaseDurationMs, isSelectedResultDerived, isSelectedCaseAutomated, isExecutionStarted, isExecutionLocked, isSelectedCaseTimerActive, selectedStepProgress, selectedRuntimeTelemetry, resolvedEvidenceArtifactCount } = progress;
  const { focusedExecutionSuite, closeCaseDrilldown, focusExecutionCase, previousExecutionCaseInstance, focusNeighborExecutionCase, selectedExecutionCaseInstanceIndex, executionCaseInstanceOrder, nextExecutionCaseInstance } = navigation;
  const { selectedExecutionCaseAssignmentHint, updateExecutionCaseAssignment, caseAssignmentDraft, setCaseAssignmentDraft, hasCaseAssignmentChange, handleSaveCaseAssignment, updateResult, createResult, caseReferenceDraft, setCaseReferenceDraft, setCaseDefectDraft, caseDefectDraft, hasCaseReferenceChange, handleSaveCaseReferences } = assignment;
  return (
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
                      {selectedCaseLiveView ? (
                        <a className="execution-case-run-button" href={selectedCaseLiveView.url} rel="noopener noreferrer" target="_blank" title="Open the live browser for this test case and data row in a new tab">
                          <IconExternalLink aria-hidden="true" size={18} stroke={1.9} />
                          <span>Live Run View</span>
                        </a>
                      ) : (
                        <button className="execution-case-run-button" disabled type="button" title={currentExecutionStatus === "running"
                          ? "Waiting for an automated browser session for this test case and data row. API-only and manual cases do not have a live browser."
                          : "Live Run View is available while this test case's automated browser is running."}>
                          <IconExternalLink aria-hidden="true" size={18} stroke={1.9} />
                          <span>Live Run View</span>
                        </button>
                      )}
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
                      {canExecuteRuns && canManageRunResults && !isSelectedResultDerived ? (<button className="execution-case-run-button is-primary" title={isSelectedCaseAutomated ? 'TestEngine owns execution of this automated case.' : undefined} disabled={isSelectedCaseAutomated || !canExecuteRuns || !canManageRunResults || !isExecutionStarted || isExecutionLocked || Boolean(caseLifecycleAction)} onClick={() => void handleCaseLifecycle(isSelectedCaseTimerActive ? "pause" : selectedCaseStatusLabel === "paused" ? "resume" : "start")} type="button">
                        {isSelectedCaseTimerActive ? <IconPlayerPause size={17} /> : <IconPlayerPlay size={17} />}
                        <span>{caseLifecycleAction ? "Saving…" : isSelectedCaseTimerActive ? "Pause case" : selectedCaseStatusLabel === "paused" ? "Resume case" : ["queued", "pending", "running"].includes(selectedCaseStatusLabel) ? "Start case" : "Start new attempt"}</span>
                      </button>) : null}
                      <label className="execution-case-outcome-control"><span className="sr-only">Set case outcome</span>
                        <select aria-label="Set case outcome" value="" disabled={isSelectedCaseAutomated || isSelectedResultDerived || !canExecuteRuns || !canManageRunResults || !isExecutionStarted || isExecutionLocked || Boolean(caseLifecycleAction)} onChange={(event) => { if (event.target.value) void handleCaseLifecycle(event.target.value as ExecutionCaseLifecycleAction); }}>
                          <option value="" disabled>Set outcome…</option>
                          <option value="block">Blocked</option><option value="skip">N/A</option><option value="abort">Aborted</option><option value="reset">Unexecuted</option>
                        </select>
                      </label>
                    </div>
                  </div>

                  {isSelectedCaseAutomated ? <p role="status">TestEngine starts this automated case and records its outcome. Refresh the run to follow its queue and results.</p> : null}
                  {isSelectedResultDerived ? <section className="execution-case-context" aria-label="Linked automation outcome"><div className="execution-case-context-heading"><strong>Outcome from {selectedExecutionResult?.source_display_id || "linked automation"}</strong><span>This manual case is covered by an automation result. Evidence and instructions belong to the source automation case.</span></div><button className="ghost-button compact" type="button" onClick={() => {
                    if (selectedExecutionResult?.source_test_case_id) focusExecutionCase(selectedExecutionResult.source_test_case_id, selectedExecutionResult.execution_id);
                  }}>Open automation evidence<OpenIcon size={16} /></button></section> : null}

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
                            {!executionPreconditionSteps.length ? <div className="empty-state compact" role="listitem">No preconditions were captured in this run snapshot.</div> : null}
                          </div>
                        ) : null}
                      </section>
                        ) : null}

                        <ExecutionHookResults logs={selectedExecutionResult?.logs || null} canViewEvidence={canViewRunEvidence} canViewAutomationCode={canViewRunAutomationCode} onOpenEvidence={openHookEvidence} />
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
                                        {!executionMainSteps.length ? <div className="empty-state compact" role="listitem">No main test steps were captured in this run snapshot.</div> : null}
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
                        {canUseRunAi && can("agentic_workflow.run") && areFeatureFlagsEnabled(featureFlagsQuery.data, ["hellotest.ai.agentic_workflows"]) && <AiLifecycleReview projectId={projectId} appTypeId={appTypeId} inputs={{ test_case_id: selectedTestCaseId, build: selectedExecution.build || undefined, environment_id: selectedExecution.test_environment?.id || undefined }} integrations={integrations} features={["flaky-test-intelligence", "quality-graph"]} title="Reliability investigation" />}
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
                            <ExecutionHookResults logs={selectedExecutionResult.logs} canViewEvidence={canViewRunEvidence} canViewAutomationCode={canViewRunAutomationCode} onOpenEvidence={openHookEvidence} />
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
                            canUpload={canCreateRunEvidence && !isSelectedResultDerived}
                            canDelete={canDeleteRunEvidence && !isSelectedResultDerived}
                            live={selectedExecutionResult?.status === "running" || ["queued", "running", "retrying"].includes(selectedExecution.status || "")}
                            refreshVersion={selectedExecutionResult ? `${selectedExecutionResult.revision || 0}:${selectedExecutionResult.updated_at || ""}` : undefined}
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
                          <select aria-label="Case assignee"
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
                            disabled={isSelectedResultDerived || !canManageRunResults || updateResult.isPending || createResult.isPending}
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
                              disabled={isSelectedResultDerived || !canManageRunResults || updateResult.isPending || createResult.isPending}
                              onChange={(event) => setCaseDefectDraft(event.target.value)}
                              placeholder="One Defect key or ID per line"
                              rows={3}
                              value={caseDefectDraft}
                            />
                          </FormField>
                          {canManageRunResults && !isSelectedResultDerived ? (<button
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
                        className="execution-case-run-button"
                        disabled={!nextExecutionCaseInstance}
                        onClick={() => focusNeighborExecutionCase(nextExecutionCaseInstance)}
                        title="Next case instance"
                        type="button"
                      >
                        <IconArrowRight aria-hidden="true" size={18} stroke={2} />
                        <span>Next case</span>
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
  );
}
