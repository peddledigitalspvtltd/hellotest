import { formatDuration } from "../../lib/executionTiming";
import { type BoardStatusTone, BOARD_STATUS_META } from "../../components/ExecutionRunListCard";
import { executionStepText } from "../../components/ExecutionRunnerStep";
import { ExecutionHookResults } from "../../components/ExecutionHookResults";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { MailIcon, PlayIcon } from "@hellotest/platform/frontend/src/platform/components/AppIcons";
import { FormField } from "@hellotest/platform/frontend/src/shared/components/FormField";
import { useDialogFocus } from "@hellotest/platform/frontend/src/shared/hooks/useDialogFocus";
import { RunReviewDialog } from "../../components/RunReviewDialog";
import { CaseRunAttachmentPanel } from "../../components/CaseRunAttachmentPanel";
import { LoadingState } from "@hellotest/platform/frontend/src/shared/components/LoadingState";
import { ApiRequestInfoDetails, JsonResponseTreeNode, StepTypeIcon } from "@hellotest/automation/frontend/components/StepAutomationEditor";
import { StatusBadge } from "@hellotest/platform/frontend/src/shared/components/StatusBadge";
import { api } from "@hellotest/platform/frontend/src/lib/api";
import { parseExecutionLogs } from "../../lib/executionLogs";
import { type ExecutionResult, type TestStep } from "@hellotest/platform/frontend/src/types";
import { ExecutionApiStepDialogProps, toStepView, formatExecutionTimestamp } from "./executionWorkspaceModel";
import { ExecutionStructuredLogView } from "./ExecutionRunLogs";

export function ReportEmailModal({
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
  const dialogRef = useDialogFocus<HTMLFormElement>({ onClose, closeDisabled: isSubmitting });
  return (
    <div className="modal-backdrop" onClick={() => !isSubmitting && onClose()} role="presentation">
      <form
        aria-label="Email run report"
        aria-modal="true"
        className="modal-card resource-modal-card"
        onClick={(event) => event.stopPropagation()}
        onSubmit={onSubmit}
        ref={dialogRef}
        tabIndex={-1}
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
            data-autofocus="true"
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

export function ExecutionApiStepDialog({
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
  const dialogRef = useDialogFocus<HTMLDivElement>({ onClose });
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
        ref={dialogRef}
        tabIndex={-1}
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
                {detail?.response?.body_truncated ? <p className="inline-message" role="status">Response preview is shortened to {Number(detail.response.body_retained_bytes || 0).toLocaleString()}{typeof detail.response.body_original_bytes === "number" ? ` of ${detail.response.body_original_bytes.toLocaleString()}` : ""} bytes. Review the recorded assertions and captures below. JSON exploration is unavailable for a partial body.</p> : null}
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

export function ExecutionAttemptDialog({ result, runName, canViewEvidence, onClose }: {
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
    <ExecutionHookResults logs={result.logs} canViewEvidence={canViewEvidence} />
    <ExecutionStructuredLogView logsJson={result.logs} steps={steps} />
    <CaseRunAttachmentPanel resultId={result.id} executionId={result.execution_id} testCaseId={result.test_case_id} iterationKey={result.data_set_iteration_key || undefined} canView={canViewEvidence} canUpload={false} canDelete={false} ensureResult={async () => result} legacyEvidence={parseExecutionLogs(result.logs).stepEvidence || {}} />
  </RunReviewDialog>;
}
