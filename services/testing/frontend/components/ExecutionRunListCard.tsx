import { formatDuration } from "../lib/executionTiming";
import { runStoryCounts } from "../lib/runCatalog";
import { TileCardValue, TileCardProgress } from "@hellotest/platform/frontend/src/shared/components/TileCardPrimitives";
import type { ExecutionEvidenceReceipt } from "../lib/executionRunSummary";
import type { Execution, ExecutionCaseSnapshot, ExecutionResult, ExecutionStatus } from "@hellotest/platform/frontend/src/types";

export type ExecutionCaseInstanceView = {
  instance_key: string;
  test_case_id: string;
  test_data_set_id: string | null;
  test_data_set_name: string | null;
  data_set_source: string | null;
  data_set_iteration_index: number | null;
  data_set_iteration_key: string | null;
  data_set_row_snapshot: Record<string, string> | null;
};

export type ExecutionRunSummary = {
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

export type ExecutionRunImpactSummary = {
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

export function executionScopeCaseCount(execution: Execution) {
  return Math.max(
    Number(execution.scope_case_count || 0),
    execution.case_snapshots?.length || 0,
    execution.test_case_ids?.length || 0
  );
}

export function executionDataIterationCount(execution: Execution) {
  const snapshot = execution.test_data_set?.snapshot;
  const rowCount = Math.max(snapshot?.rows?.length || 0, snapshot?.template_rows?.length || 0);
  return Math.max(rowCount, 1);
}

export function executionCaseInstanceKey(
  testCaseId: string,
  iterationIndex?: number | null,
  iterationKey?: string | null
) {
  const resolvedIteration = String(iterationKey || "").trim()
    || (iterationIndex === null || iterationIndex === undefined ? "default" : `row-${iterationIndex + 1}`);
  return `${testCaseId}:${resolvedIteration}`;
}

export function resolveExecutionCaseDataSet(
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

export function buildExecutionCaseInstances(
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

export function executionExpectedOutcomeCount(execution: Execution) {
  if (execution.case_snapshots?.length) {
    return execution.case_snapshots.reduce(
      (count, snapshot) => count + buildExecutionCaseInstances(snapshot, execution).length,
      0
    );
  }

  return executionScopeCaseCount(execution) * executionDataIterationCount(execution);
}

export type BoardStatusTone = ExecutionStatus | ExecutionResult["status"];

export const BOARD_STATUS_META: Record<BoardStatusTone, { label: string; description: string }> = {
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

export function normalizeExecutionStatus(status: Execution["status"] | null | undefined): ExecutionStatus {
  if (status && Object.prototype.hasOwnProperty.call(BOARD_STATUS_META, status)) {
    return status;
  }

  return "queued";
}

export function boardStatusTooltip(status: BoardStatusTone) {
  const { label, description } = BOARD_STATUS_META[status];
  return `${label}: ${description}`;
}

export function buildRunOutcomeBreakdown(
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

export function ExecutionListCard({ execution, summary, impactSummary, liveNow, isActive, isSelected, onSelect, onToggleSelected }: {
  execution: Execution; summary: ExecutionRunSummary; impactSummary: ExecutionRunImpactSummary; liveNow: number;
  isActive: boolean; isSelected: boolean; onSelect: () => void; onToggleSelected: () => void;
}) {
  const totalScopedCases = execution.metrics?.total_cases ?? (executionScopeCaseCount(execution) || summary.caseCount || 0);
  const expectedOutcomeCount = execution.case_snapshots?.length ? executionExpectedOutcomeCount(execution) : totalScopedCases * executionDataIterationCount(execution);
  const resolvedOutcomeCount = Math.max(expectedOutcomeCount, summary.total, 0);
  const finalizedTotal = summary.passed + summary.failed + summary.blocked;
  const completedTotal = finalizedTotal + (summary.skipped || 0) + (summary.aborted || 0);
  const executionStatus = normalizeExecutionStatus(execution.status);
  const defects = execution.metrics?.defect_count ?? 0;
  const stories = runStoryCounts(execution, impactSummary);
  const storyProvenance = (execution as ExecutionEvidenceReceipt).frozen_scope_evidence?.story_link_provenance;
  const storyImpactDescription = storyProvenance === "legacy_current_links"
    ? "Current authorized Story links for this historical run: Stories with failed or blocked cases / all linked Stories. This does not prove historical membership."
    : storyProvenance === "frozen_snapshot"
      ? "Frozen Story identities linked to failed or blocked run cases / all frozen Story identities in this run."
      : "Stories linked to failed or blocked run cases / all authorized Stories in this run scope. Open run details to verify the Story-link provenance.";
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
        <TileCardProgress criteriaKey="metric.execution.instance_completion" population="frozen_run_instances" unit="percent" breakdown={resolvedOutcomeCount ? buildRunOutcomeBreakdown(summary.passed, summary.failed, summary.blocked, resolvedOutcomeCount, summary) : undefined} displayValue={resolvedOutcomeCount ? `${completionPercent}%` : "No cases"} label="Run completion" title={`${completedTotal}/${resolvedOutcomeCount} case outcomes finalized, including skipped and aborted outcomes`} tone={!resolvedOutcomeCount ? "neutral" : completionPercent === 100 ? "success" : "info"} value={resolvedOutcomeCount ? completionPercent : null} />
        <TileCardProgress criteriaKey="metric.execution.pass_rate" population="frozen_run_instances" unit="percent" breakdown={finalizedTotal ? buildRunOutcomeBreakdown(summary.passed, summary.failed, summary.blocked, finalizedTotal) : undefined} displayValue={finalizedTotal ? `${passRate}%` : "No results"} label="Pass rate" title={finalizedTotal ? `${summary.passed} of ${finalizedTotal} passed, failed, or blocked results passed` : "No passed, failed, or blocked results yet"} tone={!finalizedTotal ? "neutral" : passRate >= 85 ? "success" : passRate >= 65 ? "warning" : "danger"} value={finalizedTotal ? passRate : null} />
      </div>
      <div className="tile-card-metric-grid execution-tile-metrics" aria-label="Run metrics">
        <TileCardValue label="Cases" title="Distinct test cases in this run" value={totalScopedCases} tone={totalScopedCases ? "info" : "neutral"} />
        <TileCardValue label="Duration" title="Recorded active case duration for this run" value={durationLabel} />
        <TileCardValue label="Defects" title="Unique authorized defects linked to this run across recorded attempts" value={defects} tone={defects ? "danger" : "neutral"} />
        <TileCardValue label="Story impact" title={storyImpactDescription} value={`${stories.failed}/${stories.total}`} tone={stories.failed ? "warning" : "neutral"} />
      </div>
      {visibleImpactedRequirements.length ? <div className="execution-card-impact-strip" aria-label="Run impacted stories"><strong>Impacted stories</strong><div className="execution-card-impact-chips">{visibleImpactedRequirements.map((story) => <span className="execution-impact-chip is-impacted" key={story.id}><b>{story.title}</b><small>{story.failedCases} failed</small></span>)}</div></div> : null}
    </div>

  </article>;
}

export function ExecutionStatusIndicator({ status }: { status: BoardStatusTone }) {
  const tooltip = boardStatusTooltip(status);

  return (
    <span aria-label={tooltip} className={`execution-card-status status-${status}`} title={tooltip}>
      <ExecutionStatusIcon status={status} />
    </span>
  );
}

export function ExecutionStatusIcon({ status }: { status: BoardStatusTone }) {
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

export function ExecutionRunIcon() {
  return (
    <svg aria-hidden="true" fill="none" height="20" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.9" viewBox="0 0 24 24" width="20">
      <path d="m9 7 8 5-8 5z" />
    </svg>
  );
}
