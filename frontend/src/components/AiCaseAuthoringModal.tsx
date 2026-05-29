import { useMemo } from "react";
import type { AiAuthoredTestCasePreview, Integration, Requirement, TestStep } from "../types";
import { useDialogFocus } from "../hooks/useDialogFocus";
import { normalizeStepParameterValues } from "../lib/stepParameters";
import { AiPromptTemplatePicker } from "./AiPromptTemplatePicker";
import { FormField } from "./FormField";
import { InfoTooltip } from "./InfoTooltip";
import { StepParameterizedText } from "./StepParameterizedText";
import { ToastMessage } from "./ToastMessage";

type SourceDraft = {
  title: string;
  description: string;
  parameter_values: Record<string, string>;
  steps: Array<{
    step_order: number;
    step_type?: TestStep["step_type"];
    action: string | null;
    expected_result: string | null;
  }>;
};

export function AiCaseAuthoringModal({
  requirementId,
  requirements,
  integrationId,
  integrations,
  additionalContext,
  sourceDraft,
  preview,
  previewMessage,
  previewTone,
  onRequirementChange,
  onIntegrationIdChange,
  onAdditionalContextChange,
  onGenerate,
  onApply,
  onClose,
  onPreviewMessageDismiss,
  isPreviewing,
  isApplying,
  closeDisabled,
  disableGenerate,
  disableApply,
  applyLabel,
  hasAutomationWarning,
  isCreating,
  promptTemplateProjectId,
  promptTemplateAppTypeId
}: {
  requirementId: string;
  requirements: Requirement[];
  integrationId: string;
  integrations: Integration[];
  additionalContext: string;
  sourceDraft: SourceDraft;
  preview: AiAuthoredTestCasePreview | null;
  previewMessage: string;
  previewTone: "success" | "error";
  onRequirementChange: (value: string) => void;
  onIntegrationIdChange: (value: string) => void;
  onAdditionalContextChange: (value: string) => void;
  onGenerate: () => void;
  onApply: () => void;
  onClose: () => void;
  onPreviewMessageDismiss: () => void;
  isPreviewing: boolean;
  isApplying: boolean;
  closeDisabled: boolean;
  disableGenerate: boolean;
  disableApply: boolean;
  applyLabel: string;
  hasAutomationWarning: boolean;
  isCreating: boolean;
  promptTemplateProjectId?: string;
  promptTemplateAppTypeId?: string;
}) {
  const dialogRef = useDialogFocus<HTMLDivElement>();
  const selectedRequirement = requirements.find((requirement) => requirement.id === requirementId) || null;
  const previewParameterValues = useMemo(
    () => normalizeStepParameterValues(preview?.parameter_values || {}, "t"),
    [preview?.parameter_values]
  );
  const previewParameters = useMemo(
    () => Object.entries(preview?.parameter_values || {}).sort(([left], [right]) => left.localeCompare(right)),
    [preview?.parameter_values]
  );
  const sourceParameters = useMemo(
    () => Object.entries(sourceDraft.parameter_values || {}).sort(([left], [right]) => left.localeCompare(right)),
    [sourceDraft.parameter_values]
  );

  return (
    <div className="modal-backdrop" onClick={() => !closeDisabled && onClose()} role="presentation">
      <div
        aria-label="AI case authoring"
        aria-modal="true"
        className="modal-card ai-modal-card ai-case-authoring-modal"
        onClick={(event) => event.stopPropagation()}
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
      >
        <div className="ai-case-authoring-header">
          <div className="ai-case-authoring-header-copy">
            <p className="eyebrow">AI Authoring</p>
            <div className="modal-title-info-row">
              <p className="eyebrow">Complete This Test Case</p>
              <InfoTooltip
                content="Use the linked requirement, current draft, and optional extra guidance to rephrase steps, fill gaps, and declare reusable test data for this case."
                label="AI authoring information"
              />
            </div>
          </div>
          <button className="ghost-button" disabled={closeDisabled} onClick={onClose} type="button">
            Close
          </button>
        </div>

        <div className="ai-case-authoring-shell">
          <aside className="ai-case-authoring-sidebar">
            <section className="ai-case-authoring-panel">
              <div className="record-grid">
                <FormField label="Requirement">
                  <select
                    data-autofocus="true"
                    value={requirementId}
                    onChange={(event) => onRequirementChange(event.target.value)}
                  >
                    <option value="">Select a requirement</option>
                    {requirements.map((requirement) => (
                      <option key={requirement.id} value={requirement.id}>
                        {requirement.title}
                      </option>
                    ))}
                  </select>
                </FormField>

                <FormField label="LLM integration">
                  <select value={integrationId} onChange={(event) => onIntegrationIdChange(event.target.value)}>
                    <option value="">Default active integration</option>
                    {integrations.map((integration) => (
                      <option key={integration.id} value={integration.id}>
                        {integration.name}
                      </option>
                    ))}
                  </select>
                </FormField>
              </div>

              {selectedRequirement ? (
                <div className="detail-summary compact-summary">
                  <strong>{selectedRequirement.title}</strong>
                  <span>{selectedRequirement.description || "No requirement description available yet."}</span>
                </div>
              ) : (
                <div className="empty-state compact">Choose the requirement this case should satisfy before generating.</div>
              )}

              <div className="ai-prompt-context-head">
                <span>Additional context</span>
                <AiPromptTemplatePicker
                  appTypeId={promptTemplateAppTypeId}
                  disabled={isPreviewing || isApplying}
                  onApply={(prompt) => onAdditionalContextChange(prompt)}
                  projectId={promptTemplateProjectId}
                />
              </div>
              <FormField label="Prompt copy">
                <textarea
                  placeholder="Risk areas, acceptance notes, edge cases, user roles, environment assumptions..."
                  rows={6}
                  value={additionalContext}
                  onChange={(event) => onAdditionalContextChange(event.target.value)}
                />
              </FormField>

              {hasAutomationWarning && !isCreating ? (
                <div className="inline-message error-message">
                  Replacing this case will overwrite the current saved step set, including any existing automation code or API request setup.
                </div>
              ) : null}
            </section>

            <section className="ai-case-authoring-panel">
              <div className="panel-head">
                <div>
                  <p className="eyebrow">Current Draft Context</p>
                  <p>The model uses the current workspace content as the starting point.</p>
                </div>
              </div>

              <div className="metric-strip compact ai-case-authoring-metrics">
                <div className="mini-card">
                  <strong>{sourceDraft.steps.length}</strong>
                  <span>Drafted steps</span>
                </div>
                <div className="mini-card">
                  <strong>{sourceParameters.length}</strong>
                  <span>Test data values</span>
                </div>
              </div>

              <div className="detail-summary compact-summary">
                <strong>{sourceDraft.title || "Untitled case draft"}</strong>
                <span>{sourceDraft.description || "No case description written yet."}</span>
              </div>

              <div className="ai-case-authoring-source-list">
                {sourceDraft.steps.length ? (
                  sourceDraft.steps.slice(0, 6).map((step) => (
                    <article className="ai-case-authoring-source-step" key={`source-step-${step.step_order}`}>
                      <div className="ai-case-authoring-source-step-head">
                        <strong>Step {step.step_order}</strong>
                        <span>{String(step.step_type || "web").toUpperCase()}</span>
                      </div>
                      <p>{step.action || "No action written yet."}</p>
                      <span>{step.expected_result || "No expected result written yet."}</span>
                    </article>
                  ))
                ) : (
                  <div className="empty-state compact">No drafted steps yet. AI will draft the case from the requirement and your extra context.</div>
                )}
                {sourceDraft.steps.length > 6 ? (
                  <div className="empty-state compact">+ {sourceDraft.steps.length - 6} more drafted step{sourceDraft.steps.length - 6 === 1 ? "" : "s"} included in the prompt.</div>
                ) : null}
              </div>
            </section>
          </aside>

          <section className="ai-case-authoring-main">
            <ToastMessage message={previewMessage} onDismiss={onPreviewMessageDismiss} tone={previewTone} />

            {!integrations.length ? (
              <div className="inline-message error-message">
                No active LLM integrations are available yet. Create one in Integrations to use AI authoring.
              </div>
            ) : null}

            <div className="action-row ai-case-authoring-actions">
              <button className="primary-button" disabled={disableGenerate} onClick={onGenerate} type="button">
                {isPreviewing ? "Generating…" : "Generate Preview"}
              </button>
              <button className="ghost-button" disabled={disableApply} onClick={onApply} type="button">
                {isApplying ? "Applying…" : applyLabel}
              </button>
            </div>

            {preview ? (
              <div className="ai-case-authoring-preview">
                <div className="detail-summary">
                  <strong>{preview.title}</strong>
                  <span>{preview.summary || "AI completed the case using the selected requirement and current draft context."}</span>
                </div>

                <div className="metric-strip compact ai-case-authoring-metrics">
                  <div className="mini-card">
                    <strong>{preview.step_count}</strong>
                    <span>Preview steps</span>
                  </div>
                  <div className="mini-card">
                    <strong>{preview.parameter_count}</strong>
                    <span>Test data declarations</span>
                  </div>
                </div>

                <div className="ai-case-authoring-preview-section">
                  <span className="ai-case-authoring-label">Description</span>
                  <StepParameterizedText
                    className="ai-case-authoring-copy"
                    fallback="No description proposed."
                    text={preview.description}
                    values={previewParameterValues}
                  />
                </div>

                <div className="ai-case-authoring-preview-section">
                  <div className="ai-case-authoring-section-head">
                    <span className="ai-case-authoring-label">Test data</span>
                    <span>{previewParameters.length ? `${previewParameters.length} declaration${previewParameters.length === 1 ? "" : "s"}` : "No reusable declarations suggested"}</span>
                  </div>

                  {previewParameters.length ? (
                    <div className="ai-case-authoring-parameter-list">
                      {previewParameters.map(([key, value]) => (
                        <div className="ai-case-authoring-parameter-item" key={key}>
                          <strong>{`@t.${key}`}</strong>
                          <span>{value || "Empty declaration"}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="empty-state compact">AI did not need reusable test data for this case preview.</div>
                  )}
                </div>

                <div className="ai-case-authoring-preview-section">
                  <div className="ai-case-authoring-section-head">
                    <span className="ai-case-authoring-label">Steps</span>
                    <span>{preview.steps.length} total</span>
                  </div>

                  <div className="ai-case-authoring-step-list">
                    {preview.steps.map((step) => (
                      <article className="ai-case-authoring-step-card" key={`preview-step-${step.step_order}`}>
                        <div className="ai-case-authoring-step-card-head">
                          <strong>Step {step.step_order}</strong>
                          <span>{String(step.step_type || "web").toUpperCase()}</span>
                        </div>
                        <div className="ai-case-authoring-step-card-copy">
                          <StepParameterizedText
                            className="ai-case-authoring-copy"
                            fallback="No action"
                            text={step.action}
                            values={previewParameterValues}
                          />
                          <StepParameterizedText
                            className="ai-case-authoring-copy is-secondary"
                            fallback="No expected result"
                            text={step.expected_result}
                            values={previewParameterValues}
                          />
                        </div>
                      </article>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <div className="empty-state compact ai-case-authoring-empty">
                Generate a preview to review rewritten steps, extra coverage, and suggested reusable test data before applying it to the workspace.
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
