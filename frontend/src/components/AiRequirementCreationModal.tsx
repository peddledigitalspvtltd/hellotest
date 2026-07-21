import { useState } from "react";
import type { AiDesignImageInput, AiRequirementCreationCandidate, Integration } from "../types";
import { api } from "../lib/api";
import { buildFileContextSection, buildKnowledgeContextSection, mergeAiContextPack } from "../lib/aiDesignStudio";
import { useDialogFocus } from "../hooks/useDialogFocus";
import { AiPromptTemplatePicker } from "./AiPromptTemplatePicker";
import { CollapseExpandIcon, SparkIcon } from "./AppIcons";
import { DialogCloseButton } from "./DialogCloseButton";
import { FormField } from "./FormField";
import { ToastMessage } from "./ToastMessage";

export function AiRequirementCreationModal({
  projectId,
  appTypeId,
  integrations,
  integrationId,
  onIntegrationIdChange,
  maxRequirements,
  onMaxRequirementsChange,
  additionalContext,
  onAdditionalContextChange,
  externalLinksText,
  onExternalLinksTextChange,
  referenceImages,
  onAddImages,
  onRemoveImage,
  candidates,
  selectedCandidateIds,
  onSelectedCandidateIdsChange,
  previewMessage,
  previewTone,
  onPreviewMessageDismiss,
  isPreviewing,
  isCreating,
  onPreview,
  onCreate,
  onClose
}: {
  projectId: string;
  appTypeId?: string;
  integrations: Integration[];
  integrationId: string;
  onIntegrationIdChange: (value: string) => void;
  maxRequirements: number;
  onMaxRequirementsChange: (value: number) => void;
  additionalContext: string;
  onAdditionalContextChange: (value: string) => void;
  externalLinksText: string;
  onExternalLinksTextChange: (value: string) => void;
  referenceImages: AiDesignImageInput[];
  onAddImages: (files: FileList | null) => void;
  onRemoveImage: (url: string) => void;
  candidates: AiRequirementCreationCandidate[];
  selectedCandidateIds: string[];
  onSelectedCandidateIdsChange: (ids: string[]) => void;
  previewMessage: string;
  previewTone: "success" | "error";
  onPreviewMessageDismiss: () => void;
  isPreviewing: boolean;
  isCreating: boolean;
  onPreview: () => void;
  onCreate: () => void;
  onClose: () => void;
}) {
  const closeDisabled = isPreviewing || isCreating;
  const dialogRef = useDialogFocus<HTMLDivElement>({ closeDisabled, onClose });
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [expandedCandidateIds, setExpandedCandidateIds] = useState<string[]>([]);
  const [contextFiles, setContextFiles] = useState<FileList | null>(null);
  const [isBuildingContext, setIsBuildingContext] = useState(false);
  const [contextMessage, setContextMessage] = useState("");
  const allSelected = Boolean(candidates.length) && candidates.every((candidate) => selectedCandidateIds.includes(candidate.client_id));

  const buildSmartContext = async () => {
    setIsBuildingContext(true);
    setContextMessage("");
    try {
      const knowledgePackage = await api.knowledgeRepo.contextPackage(projectId, {
        app_type_id: appTypeId,
        query: additionalContext.trim().slice(0, 1000)
      });
      const knowledge = buildKnowledgeContextSection(knowledgePackage.knowledge || []);
      const fileContext = await buildFileContextSection(contextFiles);
      onAdditionalContextChange(mergeAiContextPack(additionalContext, [
        "QAira smart context pack: treat this content as supporting evidence only and expose uncertainty for human review.",
        knowledge,
        fileContext.section
      ]));
      setContextMessage([
        `${(knowledgePackage.knowledge || []).length} knowledge item${(knowledgePackage.knowledge || []).length === 1 ? "" : "s"}`,
        fileContext.section ? "file context added" : "",
        fileContext.skipped.length ? `Skipped: ${fileContext.skipped.join(", ")}` : ""
      ].filter(Boolean).join(" · ") || "No additional smart context was available.");
    } catch (error) {
      setContextMessage(error instanceof Error ? error.message : "Unable to build smart context.");
    } finally {
      setIsBuildingContext(false);
    }
  };

  const toggleCandidate = (candidateId: string, checked: boolean) => {
    onSelectedCandidateIdsChange(
      checked
        ? [...new Set([...selectedCandidateIds, candidateId])]
        : selectedCandidateIds.filter((id) => id !== candidateId)
    );
  };

  return (
    <div className="modal-backdrop" onClick={() => !closeDisabled && onClose()} role="presentation">
      <div
        aria-labelledby="ai-create-requirements-title"
        aria-modal="true"
        className="modal-card ai-modal-card ai-design-modal ai-design-modal--requirements ai-requirement-create-ai-modal"
        onClick={(event) => event.stopPropagation()}
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
      >
        <div className="ai-studio-header">
          <div className="ai-studio-header-copy">
            <p className="eyebrow">Requirements</p>
            <h2 className="dialog-title" id="ai-create-requirements-title">Create requirements using AI</h2>
            <p>Generate several testable drafts, review their evidence and uncertainty, then explicitly create only the selected requirements.</p>
          </div>
          <DialogCloseButton disabled={closeDisabled} label="Close AI requirement creation" onClick={onClose} />
        </div>

        <div className={isSidebarCollapsed ? "ai-studio-shell is-sidebar-collapsed" : "ai-studio-shell"}>
          <aside className={isSidebarCollapsed ? "ai-studio-sidebar is-collapsed" : "ai-studio-sidebar"}>
            {isSidebarCollapsed ? (
              <div className="ai-studio-sidebar-collapsed-bar">
                <button aria-expanded="false" className="ghost-button ai-studio-sidebar-toggle" onClick={() => setIsSidebarCollapsed(false)} title="Expand AI context" type="button">
                  <CollapseExpandIcon isExpanded={false} />
                </button>
              </div>
            ) : (
              <div className="ai-studio-sidebar-panels">
                <section className="ai-studio-panel">
                  <div className="record-grid">
                    <FormField label="LLM integration">
                      <select data-autofocus="true" onChange={(event) => onIntegrationIdChange(event.target.value)} value={integrationId}>
                        <option value="">Project/global default or safe local fallback</option>
                        {integrations.map((integration) => <option key={integration.id} value={integration.id}>{integration.name}</option>)}
                      </select>
                    </FormField>
                    <FormField label="Drafts to generate">
                      <input max="6" min="1" onChange={(event) => onMaxRequirementsChange(Math.min(6, Math.max(1, Number(event.target.value) || 1)))} type="number" value={maxRequirements} />
                    </FormField>
                  </div>
                </section>

                <div className="ai-studio-sidebar-divider">
                  <button aria-expanded="true" className="ghost-button ai-studio-sidebar-toggle" onClick={() => setIsSidebarCollapsed(true)} title="Collapse AI context" type="button">
                    <CollapseExpandIcon isExpanded />
                  </button>
                </div>

                <section className="ai-studio-panel">
                  <div className="ai-prompt-context-head">
                    <span>Prompt context</span>
                    <AiPromptTemplatePicker
                      appTypeId={appTypeId}
                      disabled={closeDisabled}
                      onApply={(prompt) => onAdditionalContextChange(prompt)}
                      projectId={projectId}
                    />
                  </div>
                  <div className="ai-smart-context-card">
                    <div>
                      <strong>Smart context</strong>
                      <span>Add relevant QAira knowledge and bounded safe text-file content.</span>
                    </div>
                    <div className="ai-smart-context-actions">
                      <label className="ghost-button compact ai-context-file-button">
                        <input accept=".txt,.md,.csv,.json,.xml,.yaml,.yml,.feature,.log,text/*,application/json,application/xml" multiple onChange={(event) => setContextFiles(event.target.files)} type="file" />
                        <span>{contextFiles?.length ? `${contextFiles.length} file${contextFiles.length === 1 ? "" : "s"}` : "Add files"}</span>
                      </label>
                      <button className="primary-button compact" disabled={closeDisabled || isBuildingContext} onClick={() => void buildSmartContext()} type="button">
                        <SparkIcon />
                        <span>{isBuildingContext ? "Packing…" : "Add smart context"}</span>
                      </button>
                    </div>
                    {contextMessage ? <span className="ai-smart-context-note">{contextMessage}</span> : null}
                  </div>
                  <FormField label="Product guidance">
                    <textarea onChange={(event) => onAdditionalContextChange(event.target.value)} placeholder="Business goal, actors, flows, rules, failure behavior, compliance needs, and measurable outcomes…" rows={7} value={additionalContext} />
                  </FormField>
                  <FormField label="External links">
                    <textarea onChange={(event) => onExternalLinksTextChange(event.target.value)} placeholder="One supporting link per line" rows={3} value={externalLinksText} />
                  </FormField>
                  <FormField label="Reference images or videos">
                    <input accept="image/*,video/*" multiple onChange={(event) => { onAddImages(event.target.files); event.target.value = ""; }} type="file" />
                  </FormField>
                  {referenceImages.length ? (
                    <div className="ai-reference-image-list">
                      {referenceImages.map((image) => (
                        <article className="ai-reference-image-card" key={image.url}>
                          <div className="ai-reference-image-preview"><img alt={image.name || "Requirement reference"} src={image.url} /></div>
                          <div className="ai-reference-image-copy"><strong>{image.name || "Reference image"}</strong><span>Supporting visual evidence</span></div>
                          <button className="ghost-button danger compact" disabled={closeDisabled} onClick={() => onRemoveImage(image.url)} type="button">Remove</button>
                        </article>
                      ))}
                    </div>
                  ) : null}
                </section>
              </div>
            )}
          </aside>

          <main className="ai-studio-main">
            {previewMessage ? <ToastMessage message={previewMessage} onDismiss={onPreviewMessageDismiss} tone={previewTone} /> : null}
            <div className="ai-requirement-generation-toolbar">
              <div>
                <strong>{candidates.length ? `${selectedCandidateIds.length} of ${candidates.length} selected` : "Review-first drafting"}</strong>
                <span>AI output is advisory. QAira creates nothing until you select drafts and confirm.</span>
              </div>
              <div className="action-row">
                {candidates.length ? <button className="ghost-button compact" disabled={closeDisabled} onClick={() => onSelectedCandidateIdsChange(allSelected ? [] : candidates.map((candidate) => candidate.client_id))} type="button">{allSelected ? "Clear selection" : "Select all drafts"}</button> : null}
                <button className="primary-button" disabled={closeDisabled || !projectId} onClick={onPreview} type="button"><SparkIcon />{isPreviewing ? "Generating…" : "Generate requirement drafts"}</button>
              </div>
            </div>

            {candidates.length ? (
              <div className="ai-requirement-draft-list">
                {candidates.map((candidate) => {
                  const selected = selectedCandidateIds.includes(candidate.client_id);
                  const expanded = expandedCandidateIds.includes(candidate.client_id);
                  return (
                    <article className={selected ? "ai-requirement-draft-card is-selected" : "ai-requirement-draft-card"} key={candidate.client_id}>
                      <div className="ai-requirement-draft-card-head">
                        <label className="ai-requirement-draft-selector">
                          <input checked={selected} disabled={closeDisabled} onChange={(event) => toggleCandidate(candidate.client_id, event.target.checked)} type="checkbox" />
                          <span><strong>{candidate.title}</strong><small>Priority P{candidate.priority} · {candidate.status} · Quality {Math.round(candidate.quality_score * 100)}%</small></span>
                        </label>
                        <button aria-expanded={expanded} aria-label={expanded ? "Collapse requirement draft" : "Expand requirement draft"} className="ghost-button compact explorer-icon-button" onClick={() => setExpandedCandidateIds((current) => current.includes(candidate.client_id) ? current.filter((id) => id !== candidate.client_id) : [...current, candidate.client_id])} type="button">
                          <CollapseExpandIcon isExpanded={expanded} />
                        </button>
                      </div>
                      <p className={expanded ? "ai-requirement-draft-description" : "ai-requirement-draft-description is-clamped"}>{candidate.description}</p>
                      {expanded ? (
                        <div className="ai-requirement-draft-details">
                          <div className="detail-summary"><strong>Acceptance criteria</strong><span>{candidate.acceptance_criteria.join(" · ") || "No criteria returned."}</span></div>
                          <div className="detail-summary"><strong>Risks</strong><span>{candidate.risks.join(" · ") || "No risks returned."}</span></div>
                          <div className="detail-summary"><strong>Open questions</strong><span>{candidate.open_questions.join(" · ") || "No questions returned."}</span></div>
                          <div className="detail-summary"><strong>Why this draft</strong><span>{candidate.rationale}</span></div>
                        </div>
                      ) : null}
                    </article>
                  );
                })}
              </div>
            ) : <div className="empty-state compact ai-requirement-empty-state">Add prompt context, files, links, or images, then generate drafts for review.</div>}
          </main>
        </div>

        <div className="action-row ai-studio-footer requirement-create-modal-actions">
          <button className="ghost-button" disabled={closeDisabled} onClick={onClose} type="button">Decline</button>
          <button className="primary-button" disabled={closeDisabled || !selectedCandidateIds.length} onClick={onCreate} type="button">{isCreating ? "Creating…" : `Create selected requirements${selectedCandidateIds.length ? ` (${selectedCandidateIds.length})` : ""}`}</button>
        </div>
      </div>
    </div>
  );
}
