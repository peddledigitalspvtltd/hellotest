import { useState } from "react";
import type { AiDesignImageInput, AiDesignedTestCaseCandidate, Integration, Requirement, TestCase } from "../types";
import { useDialogFocus } from "../hooks/useDialogFocus";
import { FormField } from "./FormField";
import { ToastMessage } from "./ToastMessage";

export function AiDesignStudioModal({
  eyebrow,
  requirementLabel,
  requirementHelpText: _requirementHelpText,
  requirements,
  selectedRequirementIds,
  allowMultipleRequirements,
  onRequirementSelectionChange,
  integrations,
  integrationId,
  onIntegrationIdChange,
  maxCases,
  onMaxCasesChange,
  additionalContext,
  onAdditionalContextChange,
  externalLinksText,
  onExternalLinksTextChange,
  referenceImages,
  onAddImages,
  onRemoveImage,
  appTypeName: _appTypeName,
  existingCases,
  existingCasesTitle,
  existingCasesSubtitle,
  onViewExistingCase,
  previewCases,
  onRemovePreviewCase,
  onTogglePreviewRequirement,
  previewMessage,
  previewTone,
  onPreviewMessageDismiss,
  isPreviewing,
  isAccepting,
  onPreview,
  onSchedule,
  onAccept,
  onClose,
  disablePreview,
  disableSchedule = true,
  disableAccept,
  isScheduling = false,
  closeDisabled = false,
  acceptLabel,
  dialogClassName,
  parallelRequirementCount,
  onParallelRequirementCountChange,
  scheduleHelperText
}: {
  eyebrow: string;
  requirementLabel: string;
  requirementHelpText: string;
  requirements: Requirement[];
  selectedRequirementIds: string[];
  allowMultipleRequirements: boolean;
  onRequirementSelectionChange: (requirementIds: string[]) => void;
  integrations: Integration[];
  integrationId: string;
  onIntegrationIdChange: (value: string) => void;
  maxCases: number;
  onMaxCasesChange: (value: number) => void;
  additionalContext: string;
  onAdditionalContextChange: (value: string) => void;
  externalLinksText: string;
  onExternalLinksTextChange: (value: string) => void;
  referenceImages: AiDesignImageInput[];
  onAddImages: (files: FileList | null) => void;
  onRemoveImage: (imageUrl: string) => void;
  appTypeName: string;
  existingCases: TestCase[];
  existingCasesTitle: string;
  existingCasesSubtitle: string;
  onViewExistingCase?: (testCaseId: string) => void;
  previewCases: AiDesignedTestCaseCandidate[];
  onRemovePreviewCase: (clientId: string) => void;
  onTogglePreviewRequirement?: (clientId: string, requirementId: string) => void;
  previewMessage: string;
  previewTone: "success" | "error";
  onPreviewMessageDismiss: () => void;
  isPreviewing: boolean;
  isAccepting: boolean;
  onPreview: () => void;
  onSchedule?: () => void;
  onAccept: () => void;
  onClose: () => void;
  disablePreview: boolean;
  disableSchedule?: boolean;
  disableAccept: boolean;
  isScheduling?: boolean;
  closeDisabled?: boolean;
  acceptLabel: string;
  dialogClassName?: string;
  parallelRequirementCount?: number;
  onParallelRequirementCountChange?: (value: number) => void;
  scheduleHelperText?: string;
}) {
  const dialogRef = useDialogFocus<HTMLDivElement>();
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isRequirementDialogOpen, setIsRequirementDialogOpen] = useState(false);

  const handleRequirementToggle = (requirementId: string, checked: boolean) => {
    if (allowMultipleRequirements) {
      onRequirementSelectionChange(
        checked
          ? [...new Set([...selectedRequirementIds, requirementId])]
          : selectedRequirementIds.filter((id) => id !== requirementId)
      );
      return;
    }

    onRequirementSelectionChange(checked ? [requirementId] : []);
  };

  const selectedRequirementCount = selectedRequirementIds.length;
  const selectedRequirementLabel = allowMultipleRequirements
    ? `${selectedRequirementCount} selected`
    : requirements.find((requirement) => requirement.id === selectedRequirementIds[0])?.title || "No requirement selected";
  const scopedPreviewRequirements = selectedRequirementIds.length
    ? requirements.filter((requirement) => selectedRequirementIds.includes(requirement.id))
    : requirements;

  return (
    <div className="modal-backdrop" onClick={() => !closeDisabled && onClose()} role="presentation">
      <div
        aria-label="AI test case generation"
        aria-modal="true"
        className={dialogClassName ? `modal-card ai-modal-card ai-design-modal ${dialogClassName}` : "modal-card ai-modal-card ai-design-modal"}
        onClick={(event) => event.stopPropagation()}
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
      >
        <div className="ai-studio-header">
          <div className="ai-studio-header-copy">
            <p className="eyebrow">{eyebrow}</p>
            <h3>AI Test Case Generation</h3>
            <p>Shape the LLM prompt with source requirements, extra context, photos, and external links before reviewing the generated cases for approval.</p>
          </div>
          <button className="ghost-button" disabled={closeDisabled} onClick={onClose} type="button">
            Close
          </button>
        </div>

        <div className={isSidebarCollapsed ? "ai-studio-shell is-sidebar-collapsed" : "ai-studio-shell"}>
          <div className={isSidebarCollapsed ? "ai-studio-sidebar is-collapsed" : "ai-studio-sidebar"}>
            {!isSidebarCollapsed ? (
              <div className="ai-studio-sidebar-panels">
                <section className="ai-studio-panel">
                  {allowMultipleRequirements ? (
                    <div className="ai-studio-requirement-summary">
                      <div>
                        <strong>{requirementLabel}</strong>
                        <span>{selectedRequirementLabel}</span>
                      </div>
                      <button
                        className="ghost-button compact ai-requirement-dialog-button"
                        data-autofocus="true"
                        onClick={() => setIsRequirementDialogOpen(true)}
                        title="Expand requirement selection"
                        type="button"
                      >
                        <AiExpandIcon />
                        <span>Choose</span>
                      </button>
                    </div>
                  ) : (
                    <FormField label={requirementLabel}>
                      <select
                        data-autofocus="true"
                        value={selectedRequirementIds[0] || ""}
                        onChange={(event) => onRequirementSelectionChange(event.target.value ? [event.target.value] : [])}
                      >
                        {requirements.map((requirement) => (
                          <option key={requirement.id} value={requirement.id}>
                            {requirement.title}
                          </option>
                        ))}
                      </select>
                    </FormField>
                  )}

                  <div className="record-grid">
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

                    <FormField label="Draft cases to generate">
                      <input min="1" max="20" type="number" value={maxCases} onChange={(event) => onMaxCasesChange(Number(event.target.value) || 6)} />
                    </FormField>

                    {onSchedule && onParallelRequirementCountChange ? (
                      <FormField label="Requirements in parallel">
                        <input
                          min="1"
                          max="5"
                          type="number"
                          value={parallelRequirementCount || 1}
                          onChange={(event) => onParallelRequirementCountChange(Number(event.target.value) || 1)}
                        />
                      </FormField>
                    ) : null}
                  </div>

                  {onSchedule ? (
                    <div className="detail-summary compact-summary">
                      <strong>AI scheduler</strong>
                      <span>{scheduleHelperText || "Queue one AI generation run per selected requirement. Generated cases land back in the library with accept and reject review actions."}</span>
                    </div>
                  ) : null}
                </section>

                <div className="ai-studio-sidebar-divider" aria-hidden="true">
                  <button
                    aria-expanded={!isSidebarCollapsed}
                    className="ghost-button ai-studio-sidebar-toggle"
                    onClick={() => setIsSidebarCollapsed((current) => !current)}
                    title="Collapse prompt sidebar"
                    type="button"
                  >
                    <AiSidebarChevronIcon />
                  </button>
                </div>

                <section className="ai-studio-panel">
                  <div className="panel-head">
                    <div>
                      <h3>Prompt context</h3>
                      <p>Provide the extra guidance the model should consider while drafting cases.</p>
                    </div>
                  </div>

                  <FormField label="Additional context">
                    <textarea
                      placeholder="Release goals, risky flows, browser/device notes, compliance rules, known gaps..."
                      rows={5}
                      value={additionalContext}
                      onChange={(event) => onAdditionalContextChange(event.target.value)}
                    />
                  </FormField>

                  <FormField label="External links">
                    <textarea
                      placeholder="One link per line"
                      rows={4}
                      value={externalLinksText}
                      onChange={(event) => onExternalLinksTextChange(event.target.value)}
                    />
                  </FormField>

                  <FormField label="Reference photos">
                    <input
                      accept="image/*"
                      multiple
                      onChange={(event) => {
                        onAddImages(event.target.files);
                        event.target.value = "";
                      }}
                      type="file"
                    />
                  </FormField>

                  {referenceImages.length ? (
                    <div className="ai-reference-image-list">
                      {referenceImages.map((image) => (
                        <article className="ai-reference-image-card" key={image.url}>
                          <div className="ai-reference-image-preview">
                            <img alt={image.name || "Reference upload"} src={image.url} />
                          </div>
                          <div className="ai-reference-image-copy">
                            <strong>{image.name || "Reference image"}</strong>
                            <span>Attached to the prompt</span>
                          </div>
                          <button className="ghost-button danger" onClick={() => onRemoveImage(image.url)} type="button">
                            Remove
                          </button>
                        </article>
                      ))}
                    </div>
                  ) : (
                    <div className="empty-state compact">Add screenshots or reference photos to give the model visual context.</div>
                  )}
                </section>
              </div>
            ) : (
              <div className="ai-studio-sidebar-collapsed-bar">
                <button
                  aria-expanded={!isSidebarCollapsed}
                  className="ghost-button ai-studio-sidebar-toggle"
                  onClick={() => setIsSidebarCollapsed((current) => !current)}
                  title="Expand prompt sidebar"
                  type="button"
                >
                  <AiSidebarChevronIcon />
                </button>
              </div>
            )}
          </div>

          <div className="ai-studio-main">
            <ToastMessage message={previewMessage} onDismiss={onPreviewMessageDismiss} tone={previewTone} />

            {!integrations.length ? (
              <div className="inline-message error-message">
                No active LLM integrations are available yet. Create one in Integrations to use AI test case generation.
              </div>
            ) : null}

            <div className="action-row ai-studio-actions">
              <button className="primary-button" disabled={disablePreview} onClick={onPreview} type="button">
                {isPreviewing ? "Designing…" : "Generate Preview"}
              </button>
              {onSchedule ? (
                <button className="ghost-button" disabled={disableSchedule} onClick={onSchedule} type="button">
                  {isScheduling ? "Scheduling…" : "Schedule Test Case Generation"}
                </button>
              ) : null}
              <button className="ghost-button" disabled={closeDisabled} onClick={onClose} type="button">
                Close
              </button>
            </div>

            <div className="ai-modal-grid">
              <div className="detail-stack">
                <div className="panel-head">
                  <div>
                    <h3>{existingCasesTitle}</h3>
                    <p>{existingCasesSubtitle}</p>
                  </div>
                </div>

                <div className="stack-list">
                  {existingCases.map((testCase) => (
                    <div className="stack-item" key={testCase.id}>
                      <div>
                        <strong>{testCase.title}</strong>
                      </div>
                      <button
                        className="ghost-button ai-existing-case-button"
                        onClick={() => onViewExistingCase?.(testCase.id)}
                        title="View test case"
                        type="button"
                      >
                        <AiViewIcon />
                      </button>
                    </div>
                  ))}
                  {!existingCases.length ? <div className="empty-state compact">No existing cases are linked to the current selection yet.</div> : null}
                </div>
              </div>

              <div className="detail-stack">
                <div className="panel-head">
                  <div>
                    <h3>AI draft cases</h3>
                    <p>Review the generated drafts, adjust requirement mapping if needed, and remove any drafts you do not want to keep.</p>
                  </div>
                </div>

                <div className="ai-case-list">
                  {previewCases.map((item) => (
                    <article className="ai-case-card" key={item.client_id}>
                      <div className="step-card-top">
                        <div>
                          <strong>{item.title}</strong>
                          <span className="ai-case-meta">
                            Priority {item.priority} · {item.step_count} steps{item.applicable_domain ? ` · ${item.applicable_domain}` : ""}
                          </span>
                        </div>
                        <button className="ghost-button danger" onClick={() => onRemovePreviewCase(item.client_id)} type="button">
                          Delete
                        </button>
                      </div>

                      <span>{item.description || "No description generated."}</span>

                      {scopedPreviewRequirements.length ? (
                        <div className="ai-case-requirements">
                          <strong>Requirement mapping</strong>
                          <div className="selection-chip-row">
                            {scopedPreviewRequirements.map((requirement) => {
                              const isSelected = item.requirement_ids.includes(requirement.id);

                              return (
                                <button
                                  className={isSelected ? "selection-chip is-selected" : "selection-chip is-unselected"}
                                  disabled={!onTogglePreviewRequirement}
                                  key={`${item.client_id}-${requirement.id}`}
                                  onClick={() => onTogglePreviewRequirement?.(item.client_id, requirement.id)}
                                  type="button"
                                >
                                  {requirement.title}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      ) : null}

                      <div className="detail-summary compact-summary">
                        <strong>{item.step_count} standard step{item.step_count === 1 ? "" : "s"}</strong>
                        <span>Accepted AI drafts start as standard steps. Add shared groups or group steps after they land in the library.</span>
                      </div>

                      <div className="ai-case-steps">
                        {item.steps.map((step) => (
                          <div className="ai-case-step-card" key={`${item.client_id}-${step.step_order}`}>
                            <div className="step-card-summary">
                              <div className="step-card-summary-top">
                                <strong>Step {step.step_order}</strong>
                                <span className="step-kind-badge">Standard step</span>
                              </div>
                              <span>{step.action || "No action"}</span>
                            </div>
                            <span className="ai-case-step-expected">{step.expected_result || "No expected result"}</span>
                          </div>
                        ))}
                      </div>
                    </article>
                  ))}
                  {!previewCases.length ? <div className="empty-state compact">Generate a preview to review AI-drafted cases here.</div> : null}
                </div>
              </div>
            </div>

            <div className="action-row ai-studio-footer">
              <button className="primary-button" disabled={disableAccept} onClick={onAccept} type="button">
                {isAccepting ? "Accepting…" : acceptLabel}
              </button>
            </div>
          </div>
        </div>
      </div>
      {isRequirementDialogOpen ? (
        <div
          className="modal-backdrop nested-modal-backdrop"
          onClick={(event) => {
            event.stopPropagation();
            setIsRequirementDialogOpen(false);
          }}
          role="presentation"
        >
          <div
            aria-label="Select requirements"
            aria-modal="true"
            className="modal-card requirement-selection-dialog"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
          >
            <div className="ai-studio-header">
              <div className="ai-studio-header-copy">
                <p className="eyebrow">Requirements</p>
                <h3>{requirementLabel}</h3>
                <p>{selectedRequirementCount} of {requirements.length} selected</p>
              </div>
              <button className="ghost-button" onClick={() => setIsRequirementDialogOpen(false)} type="button">
                Done
              </button>
            </div>
            <div className="requirement-selection-dialog-actions">
              <button className="ghost-button compact" onClick={() => onRequirementSelectionChange(requirements.map((requirement) => requirement.id))} type="button">
                Select all
              </button>
              <button className="ghost-button compact" onClick={() => onRequirementSelectionChange([])} type="button">
                Clear
              </button>
            </div>
            <div className="modal-case-picker ai-studio-requirement-picker requirement-selection-dialog-list">
              {requirements.map((requirement) => (
                <label className="modal-case-option requirement-link-option" key={requirement.id}>
                  <input
                    checked={selectedRequirementIds.includes(requirement.id)}
                    onChange={(event) => handleRequirementToggle(requirement.id, event.target.checked)}
                    type="checkbox"
                  />
                  <div>
                    <strong>{requirement.title}</strong>
                    <span>{requirement.description || "No description available."}</span>
                    <span className="requirement-link-option-meta">Priority P{requirement.priority ?? 3} · {requirement.status || "open"}</span>
                  </div>
                </label>
              ))}
            </div>
            <div className="action-row ai-studio-footer">
              <button className="ghost-button" onClick={() => onRequirementSelectionChange(requirements.map((requirement) => requirement.id))} type="button">
                Select all
              </button>
              <button className="ghost-button" onClick={() => onRequirementSelectionChange([])} type="button">
                Clear
              </button>
              <button className="primary-button" onClick={() => setIsRequirementDialogOpen(false)} type="button">
                Done
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function AiExpandIcon() {
  return (
    <svg aria-hidden="true" fill="none" height="16" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.9" viewBox="0 0 24 24" width="16">
      <path d="M8 3H3v5" />
      <path d="M3 3l7 7" />
      <path d="M16 21h5v-5" />
      <path d="M21 21l-7-7" />
    </svg>
  );
}

function AiSidebarChevronIcon() {
  return (
    <svg aria-hidden="true" fill="none" height="18" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.9" viewBox="0 0 24 24" width="18">
      <path d="m9 6 6 6-6 6" />
    </svg>
  );
}

function AiViewIcon() {
  return (
    <svg aria-hidden="true" fill="none" height="16" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.9" viewBox="0 0 24 24" width="16">
      <path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}
