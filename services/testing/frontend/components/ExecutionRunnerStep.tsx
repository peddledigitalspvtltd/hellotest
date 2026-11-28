import { formatDuration, DEFAULT_DURATION_LABEL } from "../lib/executionTiming";
import { useCallback, useEffect, useMemo, useRef, type ReactNode } from "react";
import { IconCheck, IconChevronDown, IconPhoto, IconX } from "@tabler/icons-react";
import { AutomationCodeIcon, StepIconButton as InlineStepToolButton, StepTypeIcon } from "@hellotest/automation/frontend/components/StepAutomationEditor";
import { richTextToPlainText } from "@hellotest/platform/frontend/src/platform/components/RichTextEditor";
import { StepParameterizedText } from "./StepParameterizedText";
import { gherkinDescriptionToPlainText, matchGherkinKeyword, normalizeGherkinParameterReferences } from "../lib/gherkin";
import { StatusBadge } from "@hellotest/platform/frontend/src/shared/components/StatusBadge";
import { EXECUTION_ATTACHMENT_ACCEPT } from "../lib/executionAttachments";
import { type ExecutionStepApiDetail, type ExecutionStepEvidence, type ExecutionStepStatus, type ExecutionStepAutomationDetail, type ExecutionStepWebDetail } from "../lib/executionLogs";
import { parseStepParameterName, resolveStepParameterText } from "@hellotest/platform/frontend/src/shared/lib/stepParameters";
import type { ExecutionResult, Issue, TestStep } from "@hellotest/platform/frontend/src/types";

export function executionStepText(value?: string | null, parameterValues: Record<string, string> = {}) {
  const plainText = richTextToPlainText(value);
  return resolveStepParameterText(plainText, parameterValues) || plainText;
}

export function getExecutionStepKindMeta(kind?: TestStep["group_kind"] | null) {
  if (kind === "reusable") {
    return { label: "Shared Step Group step", detail: "Shared Step Group snapshot", tone: "shared" as const };
  }

  if (kind === "local") {
    return { label: "Local group", detail: "Local group snapshot", tone: "local" as const };
  }

  return { label: "Standard step", detail: "Standard step", tone: "default" as const };
}

export const hasExecutionEvidence = (evidence?: ExecutionStepEvidence | null) =>
  Boolean(evidence?.attachmentId || evidence?.dataUrl);

export function formatExecutionParameterToken(key: string, fallbackScope: "t" | "s" | "r" = "t") {
  return parseStepParameterName(key, fallbackScope)?.token || `@${String(key || "").trim()}`;
}

export function ExecutionIconShell({ children }: { children: ReactNode }) {
  return <svg aria-hidden="true" fill="none" height="14" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" viewBox="0 0 24 24" width="14">{children}</svg>;
}

export function ExecutionEvidenceImageIcon() {
  return (
    <ExecutionIconShell>
      <rect height="14" rx="2" width="16" x="4" y="5" />
      <circle cx="9" cy="10" r="1.4" fill="currentColor" stroke="none" />
      <path d="m7 17 3-3 2.5 2.5 2.5-3 2 3.5" />
    </ExecutionIconShell>
  );
}

export function ExecutionEvidencePreviewIcon() {
  return (
    <ExecutionIconShell>
      <path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z" />
      <circle cx="12" cy="12" r="2.5" />
    </ExecutionIconShell>
  );
}

export function ExecutionEvidenceDeleteIcon() {
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

export function ExecutionStructuredStepText({ label, text, values }: {
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

export function ExecutionBehaviorText({ text, values, fallbackKeyword }: {
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

export function ExecutionStepCard({
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
    <article className={toneClass} data-step-id={step.id} data-step-view={viewMode} role="listitem">
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
          aria-expanded={isExpanded}
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
                  const lineResult = automationDetail.line_results?.filter((result) => result.line === lineNumber).at(-1);
                  const isHotLine = lineNumber === automationDetail.error_line || lineNumber === automationDetail.active_line;
                  return (
                    <span className={isHotLine ? "is-hot-line" : ""} key={`${lineNumber}:${line}`}>
                      <strong title={lineResult ? `${lineResult.status} · ${lineResult.duration_ms}ms · attempt ${lineResult.attempt}` : "No awaited operation recorded"}>{lineNumber}{lineResult ? lineResult.status === "passed" ? " ✓" : " ✕" : ""}</strong>
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
            <textarea aria-label={`Step ${step.step_order} comments`}
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
                  {[bug.jira_bug_key || bug.display_id || bug.id, bug.title].filter(Boolean).join(" · ")}
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
              accept={EXECUTION_ATTACHMENT_ACCEPT}
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

export function ExecutionAutomationStepCard({
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
          const lineResult = automationDetail?.line_results?.filter((result) => result.line === lineNumber).at(-1);
          const isHotLine = lineNumber === activeLine;
          return (
            <span className={isHotLine ? "is-hot-line" : ""} key={`${step.id}:${lineNumber}`}>
              <strong title={lineResult ? `${lineResult.status} · ${lineResult.duration_ms}ms · attempt ${lineResult.attempt}` : "No awaited operation recorded"}>{lineNumber}{lineResult ? lineResult.status === "passed" ? " ✓" : " ✕" : ""}</strong>
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
