import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { IconCalendarTime, IconDatabase, IconSettings } from "@tabler/icons-react";
import type { AiDesignImageInput, AiDesignedTestCaseCandidate, Integration, Requirement, TestCase } from "../types";
import { useDialogFocus } from "../hooks/useDialogFocus";
import { FormField } from "./FormField";
import { InfoTooltip } from "./InfoTooltip";
import { RovoProviderStatus } from "./RovoProviderStatus";
import { AiPromptContextPanel } from "./AiPromptContextPanel";
import { StoryAiDraftQueue, type StoryAiStudioDraft } from "./StoryAiStudioContent";
import { StoryAiSettingsGroup, StoryAiStudioShell } from "./StoryAiStudioShell";
import {
  TestCaseAiStudioDraftInspector,
  type TestCaseAiStudioDraft,
  type TestCaseAiStudioStep
} from "./TestCaseAiStudioContent";
import { ToastMessage } from "./ToastMessage";
import "./TestCaseAiStudioModal.css";

type AiDesignStudioModalProps = {
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
  onPreviewCaseChange?: (clientId: string, next: AiDesignedTestCaseCandidate) => void;
  onRemovePreviewCase: (clientId: string) => void;
  onTogglePreviewRequirement?: (clientId: string, requirementId: string) => void;
  previewMessage: string;
  previewTone: "success" | "error";
  onPreviewMessageDismiss: () => void;
  isPreviewing: boolean;
  isAccepting: boolean;
  onPreview: () => void;
  onSchedule?: () => void;
  onAccept: (selectedClientIds: string[]) => void;
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
  promptTemplateProjectId?: string;
  promptTemplateAppTypeId?: string;
};

const existingQueueId = (id: string) => `existing:${id}`;
const plainText = (value: string | null | undefined) => String(value || "")
  .replace(/<[^>]*>/g, " ")
  .replace(/[#*_`>\[\]()]/g, " ")
  .replace(/\s+/g, " ")
  .trim();

function toQueueDraft(candidate: AiDesignedTestCaseCandidate, sequence: number): StoryAiStudioDraft {
  return {
    id: candidate.client_id,
    sequence,
    title: candidate.title,
    description: candidate.description || "",
    estimateLabel: `${candidate.step_count} Step${candidate.step_count === 1 ? "" : "s"}`,
    confidenceLabel: `${candidate.requirement_ids.length} ${candidate.requirement_ids.length === 1 ? "Story" : "Stories"}`,
    generated: true,
    priority: candidate.priority
  };
}

function existingToQueueDraft(testCase: TestCase): StoryAiStudioDraft {
  return {
    id: existingQueueId(testCase.id),
    displayId: testCase.display_id,
    title: testCase.title,
    description: testCase.description || "",
    estimateLabel: `${testCase.step_count || 0} Step${testCase.step_count === 1 ? "" : "s"}`,
    confidenceLabel: "Existing case",
    generated: false,
    priority: testCase.priority,
    status: testCase.status
  };
}

function candidateToInspectorDraft(candidate: AiDesignedTestCaseCandidate, sequence: number): TestCaseAiStudioDraft {
  return {
    id: candidate.client_id,
    sequence,
    generated: true,
    title: candidate.title,
    description: candidate.description || "",
    priority: candidate.priority,
    status: "Draft",
    requirementIds: candidate.requirement_ids,
    requirementTitles: candidate.requirement_titles,
    steps: candidate.steps.map((step) => ({
      stepOrder: step.step_order,
      stepType: step.step_type || "web",
      action: step.action || "",
      expectedResult: step.expected_result || ""
    }))
  };
}

function existingToInspectorDraft(testCase: TestCase): TestCaseAiStudioDraft {
  return {
    id: existingQueueId(testCase.id),
    displayId: testCase.display_id,
    generated: false,
    title: testCase.title,
    description: testCase.description || "",
    priority: testCase.priority,
    status: testCase.status,
    automated: testCase.automated,
    requirementIds: testCase.requirement_ids || (testCase.requirement_id ? [testCase.requirement_id] : []),
    parameterValues: testCase.parameter_values,
    steps: []
  };
}

export function AiDesignStudioModal({
  requirementLabel,
  requirementHelpText,
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
  appTypeName,
  existingCases,
  existingCasesTitle,
  existingCasesSubtitle,
  onViewExistingCase,
  previewCases,
  onPreviewCaseChange,
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
  scheduleHelperText,
  promptTemplateProjectId,
  promptTemplateAppTypeId
}: AiDesignStudioModalProps) {
  const [isRequirementDialogOpen, setIsRequirementDialogOpen] = useState(false);
  const [draftRequirementIds, setDraftRequirementIds] = useState<string[]>([]);
  const [requirementSearchTerm, setRequirementSearchTerm] = useState("");
  const [selectedPreviewCaseIds, setSelectedPreviewCaseIds] = useState<string[]>([]);
  const [activeDraftId, setActiveDraftId] = useState("");
  const [isContextBusy, setIsContextBusy] = useState(false);
  const previousPreviewCaseIdsRef = useRef<string[]>([]);
  const effectiveCloseDisabled = closeDisabled || isContextBusy;
  const dialogRef = useDialogFocus<HTMLDivElement>({ closeDisabled: effectiveCloseDisabled, onClose });
  const requirementDialogRef = useDialogFocus<HTMLDivElement>({
    active: isRequirementDialogOpen,
    closeDisabled: effectiveCloseDisabled,
    onClose: () => setIsRequirementDialogOpen(false)
  });
  const isBusy = isPreviewing || isAccepting || isScheduling || isContextBusy;
  const selectedRequirements = requirements.filter((requirement) => selectedRequirementIds.includes(requirement.id));
  const selectedRequirementLabel = allowMultipleRequirements
    ? `${selectedRequirementIds.length} selected`
    : selectedRequirements[0]?.title || "No Story selected";
  const filteredRequirements = requirements.filter((requirement) => {
    const query = requirementSearchTerm.trim().toLowerCase();
    if (!query) return true;
    return [requirement.display_id, requirement.id, requirement.title, requirement.description, requirement.status, String(requirement.priority ?? "")]
      .some((value) => String(value || "").toLowerCase().includes(query));
  });
  const queueDrafts = useMemo(
    () => [
      ...previewCases.map(toQueueDraft),
      ...existingCases.map(existingToQueueDraft)
    ],
    [existingCases, previewCases]
  );

  useEffect(() => {
    const previousPreviewIds = previousPreviewCaseIdsRef.current;
    const previewIds = previewCases.map((item) => item.client_id);
    previousPreviewCaseIdsRef.current = previewIds;
    setSelectedPreviewCaseIds((current) => {
      if (!previewIds.length) return [];
      const retained = current.filter((id) => previewIds.includes(id));
      const newlyGenerated = previewIds.filter((id) => !previousPreviewIds.includes(id));
      return [...new Set([...retained, ...newlyGenerated])];
    });
  }, [previewCases]);

  useEffect(() => {
    setActiveDraftId((current) => queueDrafts.some((draft) => draft.id === current) ? current : queueDrafts[0]?.id || "");
  }, [queueDrafts]);

  const activeCandidate = previewCases.find((item) => item.client_id === activeDraftId) || null;
  const activeExistingCase = activeDraftId.startsWith("existing:")
    ? existingCases.find((item) => existingQueueId(item.id) === activeDraftId) || null
    : null;
  const activeDraft = activeCandidate
    ? candidateToInspectorDraft(activeCandidate, Math.max(1, previewCases.findIndex((item) => item.client_id === activeCandidate.client_id) + 1))
    : activeExistingCase ? existingToInspectorDraft(activeExistingCase) : null;
  const selectedPreviewCount = previewCases.filter((item) => selectedPreviewCaseIds.includes(item.client_id)).length;
  const selectedPreviewHasInvalidTitle = previewCases.some((item) =>
    selectedPreviewCaseIds.includes(item.client_id) && (!item.title.trim() || item.title.length > 255)
  );
  const schedulerHelpText = scheduleHelperText || "Queue one generation job per selected Story. Generated cases return to the library as reviewable drafts.";

  const updateActiveCandidate = (changes: Partial<AiDesignedTestCaseCandidate>) => {
    if (!activeCandidate || !onPreviewCaseChange) return;
    onPreviewCaseChange(activeCandidate.client_id, { ...activeCandidate, ...changes });
  };
  const updateActiveSteps = (steps: TestCaseAiStudioStep[]) => {
    if (!activeCandidate) return;
    updateActiveCandidate({
      steps: steps.map((step, index) => ({
        step_order: index + 1,
        step_type: step.stepType || "web",
        action: step.action || null,
        expected_result: step.expectedResult || null
      })),
      step_count: steps.length
    });
  };

  const openRequirementDialog = () => {
    setDraftRequirementIds(selectedRequirementIds);
    setRequirementSearchTerm("");
    setIsRequirementDialogOpen(true);
  };
  const toggleRequirement = (requirementId: string, checked: boolean) => {
    if (allowMultipleRequirements) {
      setDraftRequirementIds((current) => checked
        ? [...new Set([...current, requirementId])]
        : current.filter((id) => id !== requirementId));
      return;
    }
    setDraftRequirementIds(checked ? [requirementId] : []);
  };

  const requirementDialog = isRequirementDialogOpen ? (
    <div className="modal-backdrop nested-modal-backdrop" onClick={() => !effectiveCloseDisabled && setIsRequirementDialogOpen(false)} role="presentation">
      <div
        aria-labelledby="ai-test-case-story-selection-title"
        aria-modal="true"
        className="modal-card requirement-selection-dialog test-case-studio-story-picker"
        onClick={(event) => event.stopPropagation()}
        ref={requirementDialogRef}
        role="dialog"
        tabIndex={-1}
      >
        <header>
          <div><span>{requirementLabel}</span><h2 id="ai-test-case-story-selection-title">Select Story context</h2><p>{draftRequirementIds.length} of {requirements.length} selected</p></div>
          <button aria-label="Close Story selection" disabled={effectiveCloseDisabled} onClick={() => setIsRequirementDialogOpen(false)} type="button">Close</button>
        </header>
        <FormField label="Search Stories">
          <input autoFocus disabled={effectiveCloseDisabled} onChange={(event) => setRequirementSearchTerm(event.target.value)} placeholder="Search title, description, status, or priority" value={requirementSearchTerm} />
        </FormField>
        <div className="test-case-studio-story-picker__actions">
          {allowMultipleRequirements ? <button disabled={effectiveCloseDisabled} onClick={() => setDraftRequirementIds(filteredRequirements.map((item) => item.id))} type="button">Select visible</button> : null}
          <button disabled={effectiveCloseDisabled} onClick={() => setDraftRequirementIds([])} type="button">Clear</button>
        </div>
        <div className="test-case-studio-story-picker__list">
          {filteredRequirements.map((requirement) => (
            <label key={requirement.id}>
              <input
                checked={draftRequirementIds.includes(requirement.id)}
                disabled={effectiveCloseDisabled}
                name={allowMultipleRequirements ? undefined : "ai-test-case-story-context"}
                onChange={(event) => toggleRequirement(requirement.id, event.target.checked)}
                type={allowMultipleRequirements ? "checkbox" : "radio"}
              />
              <span><strong>{requirement.title}</strong><small>{plainText(requirement.description) || "No description available."}</small><em>Priority P{requirement.priority ?? 3} · {requirement.status || "open"}</em></span>
            </label>
          ))}
          {!filteredRequirements.length ? <div className="test-case-studio-card-empty">No Stories match the current search.</div> : null}
        </div>
        <footer>
          <button disabled={effectiveCloseDisabled} onClick={() => setIsRequirementDialogOpen(false)} type="button">Cancel</button>
          <button
            className="primary-button"
            disabled={effectiveCloseDisabled || !draftRequirementIds.length}
            onClick={() => {
              onRequirementSelectionChange(draftRequirementIds);
              setIsRequirementDialogOpen(false);
            }}
            type="button"
          >
            Use selected context
          </button>
        </footer>
      </div>
    </div>
  ) : null;

  const settingsPane = (
    <div className="test-case-studio-settings">
      <StoryAiSettingsGroup
        defaultOpen={!selectedRequirementIds.length}
        description={`${selectedRequirementIds.length} Stor${selectedRequirementIds.length === 1 ? "y" : "ies"} · ${maxCases} draft${maxCases === 1 ? "" : "s"}`}
        icon={<IconSettings aria-hidden="true" size={17} stroke={1.9} />}
        title="Generation setup"
      >
        <button className="test-case-studio-context-button" disabled={isBusy} onClick={openRequirementDialog} type="button">
          <span><strong>{requirementLabel}</strong><small>{selectedRequirementLabel}</small></span>
          <span>Choose</span>
        </button>
        <div className="test-case-studio-model-grid">
          <FormField label="Direct LLM provider">
            <select disabled={isBusy} onChange={(event) => onIntegrationIdChange(event.target.value)} value={integrationId}>
              <option value="">Configured direct provider</option>
              {integrations.map((integration) => <option key={integration.id} value={integration.id}>{integration.name}</option>)}
            </select>
          </FormField>
          <FormField label="Count">
            <select disabled={isBusy} onChange={(event) => onMaxCasesChange(Number(event.target.value))} value={maxCases}>
              {[1, 2, 3].map((count) => <option key={count} value={count}>{count} draft{count === 1 ? "" : "s"}</option>)}
            </select>
          </FormField>
        </div>
        <RovoProviderStatus
          className="test-case-studio-rovo-provider"
          compact
          prompt={[
            "Review test design for the selected Jira Stories in the Jira-native HelloTest QA Agent. This is an interactive Rovo review, not direct test-case generation, and must not create or save records.",
            `Application context: ${appTypeName}.`,
            selectedRequirements.length
              ? `Selected Stories: ${selectedRequirements.slice(0, 8).map((item) => item.title).join("; ")}.`
              : "No Story context is selected yet."
          ].join(" ").slice(0, 3_800)}
        />
        {onSchedule && onParallelRequirementCountChange ? (
          <FormField label="Stories processed in parallel">
            <input disabled={isBusy} max="5" min="1" onChange={(event) => onParallelRequirementCountChange(Number(event.target.value) || 1)} type="number" value={parallelRequirementCount || 1} />
          </FormField>
        ) : null}
        <div className="test-case-studio-scope-note"><strong>{appTypeName}</strong><span>{requirementHelpText}</span></div>
      </StoryAiSettingsGroup>
      <StoryAiSettingsGroup
        defaultOpen={Boolean(selectedRequirementIds.length)}
        description={`${referenceImages.length} image${referenceImages.length === 1 ? "" : "s"} · ${externalLinksText.split(/\r?\n/).filter((value) => value.trim()).length} link${externalLinksText.split(/\r?\n/).filter((value) => value.trim()).length === 1 ? "" : "s"}`}
        icon={<IconDatabase aria-hidden="true" size={17} stroke={1.9} />}
        title="Context sources"
      >
        <AiPromptContextPanel
          additionalContext={additionalContext}
          appTypeId={promptTemplateAppTypeId}
          disabled={isBusy}
          externalLinksText={externalLinksText}
          onAddImages={onAddImages}
          onAdditionalContextChange={onAdditionalContextChange}
          onBusyChange={setIsContextBusy}
          onExternalLinksTextChange={onExternalLinksTextChange}
          onRemoveImage={onRemoveImage}
          promptScope="test_case_generation"
          projectId={promptTemplateProjectId}
          referenceImages={referenceImages}
          referenceUploadPresentation="dropzone"
          requirements={selectedRequirements}
          showPromptEditor={false}
        />
      </StoryAiSettingsGroup>
    </div>
  );

  const inspectorStatus = previewMessage ? <ToastMessage message={previewMessage} onDismiss={onPreviewMessageDismiss} tone={previewTone} /> : null;

  return (
    <>
      <div className="modal-backdrop test-case-ai-studio-backdrop" onClick={() => !effectiveCloseDisabled && onClose()} role="presentation">
        <div
          aria-describedby="ai-design-studio-description"
          aria-labelledby="ai-design-studio-title"
          aria-modal="true"
          className={dialogClassName ? `modal-card test-case-ai-studio-modal ${dialogClassName}` : "modal-card test-case-ai-studio-modal"}
          onClick={(event) => event.stopPropagation()}
          ref={dialogRef}
          role="dialog"
          tabIndex={-1}
        >
          <StoryAiStudioShell
            agentName="Test Design Agent"
            agentStatus={isPreviewing ? "running" : previewCases.length ? "completed" : previewTone === "error" && previewMessage ? "failed" : "idle"}
            contextLabel={`${selectedRequirementIds.length} Stor${selectedRequirementIds.length === 1 ? "y" : "ies"} · ${referenceImages.length} visual reference${referenceImages.length === 1 ? "" : "s"}`}
            closeDisabled={effectiveCloseDisabled}
            commandBar={(
              <>
                <div className="test-case-studio-command-secondary">
                  {activeCandidate ? <button disabled={isBusy} onClick={() => onRemovePreviewCase(activeCandidate.client_id)} type="button">Decline draft</button> : null}
                  {onSchedule ? (
                    <span>
                      <button disabled={disableSchedule || isBusy} onClick={onSchedule} type="button"><IconCalendarTime size={16} stroke={1.9} />{isScheduling ? "Scheduling…" : "Schedule generation"}</button>
                      <InfoTooltip content={schedulerHelpText} label="Scheduled test case generation information" />
                    </span>
                  ) : null}
                </div>
                {previewCases.length ? (
                  <button
                    className="test-case-studio-accept"
                    disabled={disableAccept || !selectedPreviewCount || selectedPreviewHasInvalidTitle || isBusy}
                    onClick={() => onAccept(selectedPreviewCaseIds)}
                    type="button"
                  >
                    {isAccepting ? "Accepting…" : selectedPreviewCount ? `${acceptLabel} (${selectedPreviewCount})` : "Select drafts to accept"}
                  </button>
                ) : null}
              </>
            )}
            descriptionId="ai-design-studio-description"
            entityLabel="Test Case"
            inspectorAriaLabel="Test case draft inspector"
            inspectorContent={(
              <TestCaseAiStudioDraftInspector
                draft={activeDraft}
                editable={Boolean(activeCandidate && onPreviewCaseChange) && !isBusy}
                extraContent={existingCases.length ? (
                  <details className="test-case-studio-existing-coverage">
                    <summary><span><strong>{existingCasesTitle}</strong><small>{existingCasesSubtitle}</small></span><span>{existingCases.length}</span></summary>
                    <div>
                      {existingCases.slice(0, 8).map((testCase) => (
                        <button disabled={!onViewExistingCase} key={testCase.id} onClick={() => onViewExistingCase?.(testCase.id)} type="button">
                          <strong>{testCase.title}</strong><span>{testCase.step_count || 0} steps</span>
                        </button>
                      ))}
                    </div>
                  </details>
                ) : null}
                onDescriptionChange={(value) => updateActiveCandidate({ description: value })}
                onOpenExisting={activeExistingCase && onViewExistingCase ? () => onViewExistingCase(activeExistingCase.id) : undefined}
                onPriorityChange={(value) => updateActiveCandidate({ priority: value })}
                onRequirementToggle={activeCandidate && onTogglePreviewRequirement ? (requirementId) => onTogglePreviewRequirement(activeCandidate.client_id, requirementId) : undefined}
                onStepChange={(index, next) => {
                  if (!activeDraft) return;
                  updateActiveSteps(activeDraft.steps.map((step, itemIndex) => itemIndex === index ? next : step));
                }}
                onStepsChange={updateActiveSteps}
                onTitleChange={(value) => updateActiveCandidate({ title: value })}
                requirements={selectedRequirements.map((requirement) => ({ id: requirement.id, title: requirement.title }))}
                statusContent={inspectorStatus}
              />
            )}
            mode="create"
            mission={additionalContext}
            missionPlaceholder="Describe the coverage objective, risk boundaries, data variations, and test style you want the agent to produce."
            onIntegrationChange={onIntegrationIdChange}
            onMissionChange={onAdditionalContextChange}
            onClose={onClose}
            onPrimaryGenerate={onPreview}
            outputLabel="Selectable, editable Test Case drafts"
            approvalLabel="Only selected drafts enter the Test Case library"
            primaryGenerateDisabled={disablePreview || isBusy}
            primaryGenerateLabel={isPreviewing ? "Generating drafts…" : previewCases.length ? "Regenerate drafts" : "Generate drafts"}
            integrationId={integrationId}
            integrations={integrations}
            stageEvidence={{
              intake: additionalContext.trim() ? "Coverage intent, risk boundaries, data variations, and requested test style define the task." : "The selected Stories define the minimum coverage objective; add an instruction for a narrower test strategy.",
              context: `${selectedRequirementIds.length} selected Stor${selectedRequirementIds.length === 1 ? "y" : "ies"}, ${referenceImages.length} image${referenceImages.length === 1 ? "" : "s"}, project knowledge, and safe attachments form the evidence scope.`,
              guardrails: "Generation cannot overwrite existing Test Cases and cannot create library records without a human selection.",
              specialist: "Test Design Agent is balancing happy paths, negative paths, boundaries, reusable steps, test data, and automation readiness.",
              outcome: "Generated Test Cases remain selectable and editable beside existing coverage.",
              evaluation: "Drafts are checked for traceability, duplicate coverage, step quality, assertions, and title validity.",
              review: "Only selected drafts are accepted into the Test Case library."
            }}
            queueAriaLabel="Test case draft and existing coverage queue"
            queuePane={(
              <StoryAiDraftQueue
                activeDraftId={activeDraftId}
                allowSelection={!isBusy}
                drafts={queueDrafts}
                emptyHeading="Ready for governed coverage"
                emptyMessage="Choose Story context, then generate reusable Test Case drafts for review."
                isDraftSelectable={(draft) => Boolean(draft.generated)}
                itemNoun="case"
                onActivateDraft={setActiveDraftId}
                onClearSelection={() => setSelectedPreviewCaseIds([])}
                onSelectAll={(selected) => setSelectedPreviewCaseIds(selected ? previewCases.map((item) => item.client_id) : [])}
                onToggleDraft={(draftId, selected) => setSelectedPreviewCaseIds((current) => selected ? [...new Set([...current, draftId])] : current.filter((id) => id !== draftId))}
                queueTitle="Case Queue"
                selectedDraftIds={selectedPreviewCaseIds}
              />
            )}
            settingsAriaLabel="Test case generation settings"
            settingsPane={settingsPane}
            showIncludeGherkin={false}
            studioDescription="Generate or schedule reusable Test Cases from selected Jira Story evidence, then review each draft before it enters the library."
            studioTitle="Test Case Generator"
            titleId="ai-design-studio-title"
          />
        </div>
      </div>
      {requirementDialog && typeof document !== "undefined" ? createPortal(requirementDialog, document.body) : requirementDialog}
    </>
  );
}
