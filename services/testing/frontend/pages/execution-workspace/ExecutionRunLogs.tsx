import { executionStepText, formatExecutionParameterToken, ExecutionEvidencePreviewIcon } from "../../components/ExecutionRunnerStep";
import { Fragment } from "react";
import { useAuth } from "@hellotest/platform/frontend/src/auth/AuthContext";
import { SparkIcon } from "@hellotest/platform/frontend/src/platform/components/AppIcons";
import { SharedGroupLevelIcon } from "@hellotest/automation/frontend/components/StepAutomationEditor";
import { StatusBadge } from "@hellotest/platform/frontend/src/shared/components/StatusBadge";
import { useFeatureFlags } from "@hellotest/platform/frontend/src/platform/hooks/useFeatureFlags";
import { canViewAutomationCode as resolveCanViewAutomationCode } from "@hellotest/automation/frontend/lib/automationAccess";
import { parseExecutionLogs, type ExecutionAiAnalysis, type ExecutionStepEvidence } from "../../lib/executionLogs";
import { type TestStep } from "@hellotest/platform/frontend/src/types";
import { isStepGroupStart, evidenceMimeType, formatExecutionTimestamp, mergeExecutionStepCaptures } from "./executionWorkspaceModel";

export function ExecutionAiAnalysisPanel({
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

export function ExecutionStructuredLogView({
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

export function ExecutionStructuredLogSummary({ logsJson }: { logsJson: string | null }) {
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
