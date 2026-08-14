import { useEffect, useMemo, useState } from "react";
import { IconChecklist, IconDatabase, IconSettings, IconX } from "@tabler/icons-react";
import type { AiAuthoredTestCasePreview, AiDesignImageInput, Integration, Requirement, TestStep } from "../types";
import { useDialogFocus } from "../hooks/useDialogFocus";
import { normalizeStepParameterValues } from "../lib/stepParameters";
import { AiPromptContextPanel } from "./AiPromptContextPanel";
import { FormField } from "./FormField";
import { RovoProviderStatus } from "./RovoProviderStatus";
import { StoryAiDraftQueue, type StoryAiStudioDraft } from "./StoryAiStudioContent";
import { StoryAiStudioShell } from "./StoryAiStudioShell";
import {
  TestCaseAiStudioDraftInspector,
  type TestCaseAiStudioDraft,
  type TestCaseAiStudioStep
} from "./TestCaseAiStudioContent";
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

type AiCaseAuthoringModalProps = {
  requirementId: string;
  requirements: Requirement[];
  integrationId: string;
  integrations: Integration[];
  additionalContext: string;
  externalLinksText: string;
  referenceImages: AiDesignImageInput[];
  sourceDraft: SourceDraft;
  preview: AiAuthoredTestCasePreview | null;
  previewMessage: string;
  previewTone: "success" | "error";
  onRequirementChange: (value: string) => void;
  onIntegrationIdChange: (value: string) => void;
  onAdditionalContextChange: (value: string) => void;
  onExternalLinksTextChange: (value: string) => void;
  onAddImages: (files: FileList | null) => void;
  onRemoveImage: (imageUrl: string) => void;
  onGenerate: () => void;
  onApply: () => void;
  onClose: () => void;
  onPreviewChange?: (preview: AiAuthoredTestCasePreview | null) => void;
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
};

const CURRENT_DRAFT_ID = "current-test-case";
const IMPROVED_DRAFT_ID = "improved-test-case";

function sourceQueueDraft(sourceDraft: SourceDraft, isCreating: boolean): StoryAiStudioDraft {
  return {
    id: CURRENT_DRAFT_ID,
    displayId: isCreating ? "NEW CASE" : "CURRENT CASE",
    title: sourceDraft.title.trim() || (isCreating ? "New test case draft" : "Current test case"),
    description: sourceDraft.description,
    estimateLabel: `${sourceDraft.steps.length} Step${sourceDraft.steps.length === 1 ? "" : "s"}`,
    confidenceLabel: "Existing context",
    generated: false,
    priority: 3
  };
}

function previewQueueDraft(preview: AiAuthoredTestCasePreview): StoryAiStudioDraft {
  return {
    id: IMPROVED_DRAFT_ID,
    sequence: 1,
    title: preview.title,
    description: preview.description || "",
    estimateLabel: `${preview.step_count} Step${preview.step_count === 1 ? "" : "s"}`,
    confidenceLabel: `${preview.parameter_count} Data value${preview.parameter_count === 1 ? "" : "s"}`,
    generated: true,
    priority: 3
  };
}

function sourceInspectorDraft(sourceDraft: SourceDraft, isCreating: boolean, requirement?: Requirement | null): TestCaseAiStudioDraft {
  return {
    id: CURRENT_DRAFT_ID,
    displayId: isCreating ? "NEW CASE" : "CURRENT CASE",
    generated: false,
    title: sourceDraft.title.trim() || (isCreating ? "New test case draft" : "Current test case"),
    description: sourceDraft.description,
    priority: 3,
    status: isCreating ? "Unsaved draft" : "Saved case",
    requirementIds: requirement ? [requirement.id] : [],
    requirementTitles: requirement ? [requirement.title] : [],
    parameterValues: sourceDraft.parameter_values,
    steps: sourceDraft.steps.map((step) => ({
      stepOrder: step.step_order,
      stepType: step.step_type,
      action: step.action || "",
      expectedResult: step.expected_result || ""
    }))
  };
}

function previewInspectorDraft(preview: AiAuthoredTestCasePreview, requirement?: Requirement | null): TestCaseAiStudioDraft {
  return {
    id: IMPROVED_DRAFT_ID,
    sequence: 1,
    generated: true,
    title: preview.title,
    description: preview.description || "",
    summary: preview.summary || "AI improved this test case using the selected Story and the current authored context.",
    priority: 3,
    status: "Review draft",
    requirementIds: requirement ? [requirement.id] : [],
    requirementTitles: requirement ? [requirement.title] : [],
    parameterValues: normalizeStepParameterValues(preview.parameter_values || {}, "t"),
    steps: preview.steps.map((step) => ({
      stepOrder: step.step_order,
      stepType: step.step_type,
      action: step.action || "",
      expectedResult: step.expected_result || ""
    }))
  };
}

export function AiCaseAuthoringModal({
  requirementId,
  requirements,
  integrationId,
  integrations,
  additionalContext,
  externalLinksText,
  referenceImages,
  sourceDraft,
  preview,
  previewMessage,
  previewTone,
  onRequirementChange,
  onIntegrationIdChange,
  onAdditionalContextChange,
  onExternalLinksTextChange,
  onAddImages,
  onRemoveImage,
  onGenerate,
  onApply,
  onClose,
  onPreviewChange,
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
}: AiCaseAuthoringModalProps) {
  const [activeDraftId, setActiveDraftId] = useState(preview ? IMPROVED_DRAFT_ID : CURRENT_DRAFT_ID);
  const [isContextBusy, setIsContextBusy] = useState(false);
  const [isIntegrationWarningDismissed, setIsIntegrationWarningDismissed] = useState(false);
  const [isAutomationWarningDismissed, setIsAutomationWarningDismissed] = useState(false);
  const effectiveCloseDisabled = closeDisabled || isContextBusy;
  const isBusy = isPreviewing || isApplying || isContextBusy;
  const dialogRef = useDialogFocus<HTMLDivElement>({ closeDisabled: effectiveCloseDisabled, onClose });
  const selectedRequirement = requirements.find((requirement) => requirement.id === requirementId) || null;
  const sourceCaseLabel = sourceDraft.title.trim() || (isCreating ? "New test case draft" : "Current test case");
  const integrationWarning = !integrations.length
    ? "No active direct LLM integrations are available. Configure a model provider before generating this test case; Rovo remains a separate review conversation."
    : "";
  const automationWarning = hasAutomationWarning && !isCreating
    ? "Applying this proposal replaces the saved step set, including existing automation code or API request setup."
    : "";
  const toasterMessage = previewMessage
    || (!isIntegrationWarningDismissed ? integrationWarning : "")
    || (!isAutomationWarningDismissed ? automationWarning : "");
  const queueDrafts = useMemo(
    () => [sourceQueueDraft(sourceDraft, isCreating), ...(preview ? [previewQueueDraft(preview)] : [])],
    [isCreating, preview, sourceDraft]
  );
  const activeDraft = activeDraftId === IMPROVED_DRAFT_ID && preview
    ? previewInspectorDraft(preview, selectedRequirement)
    : sourceInspectorDraft(sourceDraft, isCreating, selectedRequirement);
  const isGeneratedActive = activeDraftId === IMPROVED_DRAFT_ID && Boolean(preview);

  useEffect(() => {
    setIsIntegrationWarningDismissed(false);
  }, [integrations.length]);

  useEffect(() => {
    setIsAutomationWarningDismissed(false);
  }, [hasAutomationWarning, isCreating]);

  useEffect(() => {
    if (preview) setActiveDraftId(IMPROVED_DRAFT_ID);
    else setActiveDraftId(CURRENT_DRAFT_ID);
  }, [preview]);

  const updatePreview = (changes: Partial<AiAuthoredTestCasePreview>) => {
    if (!preview || !onPreviewChange) return;
    onPreviewChange({ ...preview, ...changes });
  };
  const updatePreviewSteps = (steps: TestCaseAiStudioStep[]) => updatePreview({
    steps: steps.map((step, index) => ({
      step_order: index + 1,
      step_type: step.stepType || "web",
      action: step.action || null,
      expected_result: step.expectedResult || null
    })),
    step_count: steps.length
  });
  const previewHasInvalidTitle = Boolean(preview && (!preview.title.trim() || preview.title.length > 255));
  const dismissToast = () => {
    if (previewMessage) {
      onPreviewMessageDismiss();
      return;
    }
    if (integrationWarning && !isIntegrationWarningDismissed) {
      setIsIntegrationWarningDismissed(true);
      return;
    }
    setIsAutomationWarningDismissed(true);
  };

  const settingsPane = (
    <div className="test-case-studio-settings">
      <section>
        <div className="test-case-studio-settings__heading"><IconSettings aria-hidden="true" size={19} stroke={1.9} /><h2>Model Settings</h2></div>
        <p>Use the current case, its linked Story, and a governed provider.</p>
        <FormField label="Story">
          <select data-autofocus="true" disabled={isBusy} onChange={(event) => onRequirementChange(event.target.value)} value={requirementId}>
            <option value="">Select a Story</option>
            {requirements.map((requirement) => <option key={requirement.id} value={requirement.id}>{requirement.title}</option>)}
          </select>
        </FormField>
        <FormField label="Direct LLM provider">
          <select disabled={isBusy} onChange={(event) => onIntegrationIdChange(event.target.value)} value={integrationId}>
            <option value="">Configured provider</option>
            {integrations.map((integration) => <option key={integration.id} value={integration.id}>{integration.name}</option>)}
          </select>
        </FormField>
        <RovoProviderStatus
          className="test-case-studio-rovo-provider"
          compact
          prompt={[
            "Review this test case in the Jira-native HelloTest QA Agent. This is a Rovo conversation, not direct draft generation, and must not change the saved case.",
            `Test case: ${sourceCaseLabel}.`,
            selectedRequirement ? `Linked Story: ${selectedRequirement.title}.` : "No linked Story is selected yet."
          ].join(" ").slice(0, 3_800)}
        />
        <div className="test-case-studio-scope-note"><strong>{sourceCaseLabel}</strong><span>{selectedRequirement ? `Linked to ${selectedRequirement.title}` : "Choose the Jira Story this Test Case must satisfy."}</span></div>
      </section>
      <hr />
      <section>
        <div className="test-case-studio-settings__heading"><IconDatabase aria-hidden="true" size={19} stroke={1.9} /><h2>Data Sources</h2></div>
        <p>Add bounded instructions, project knowledge, links, and visual evidence.</p>
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
          promptScope="test_case_steps"
          projectId={promptTemplateProjectId}
          referenceImages={referenceImages}
          referenceUploadPresentation="dropzone"
          requirements={selectedRequirement ? [selectedRequirement] : []}
          showPromptEditor={false}
        />
      </section>
    </div>
  );

  return (
    <div className="modal-backdrop test-case-ai-studio-backdrop" onClick={() => !effectiveCloseDisabled && onClose()} role="presentation">
      <div
        aria-describedby="ai-case-authoring-description"
        aria-labelledby="ai-case-authoring-title"
        aria-modal="true"
        className="modal-card test-case-ai-studio-modal test-case-ai-improve-modal"
        onClick={(event) => event.stopPropagation()}
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
      >
        <StoryAiStudioShell
          agentName="Test Design Agent"
          agentStatus={isPreviewing ? "running" : preview ? "completed" : previewTone === "error" && previewMessage ? "failed" : "idle"}
          contextLabel={`${selectedRequirement ? "1 Story" : "No Story"} · ${referenceImages.length} visual reference${referenceImages.length === 1 ? "" : "s"}`}
          closeDisabled={effectiveCloseDisabled}
          commandBar={(
            <>
              <div className="test-case-studio-command-secondary">
                {preview && onPreviewChange ? (
                  <button disabled={isBusy} onClick={() => onPreviewChange(null)} type="button"><IconX size={16} stroke={1.9} />Decline proposal</button>
                ) : null}
                <button disabled={disableGenerate || isBusy} onClick={onGenerate} type="button">{isPreviewing ? "Improving…" : preview ? "Regenerate" : "Generate proposal"}</button>
              </div>
              <button
                className="test-case-studio-accept"
                disabled={disableApply || !isGeneratedActive || previewHasInvalidTitle || isBusy}
                onClick={onApply}
                type="button"
              >
                {isApplying ? "Applying…" : isGeneratedActive ? applyLabel : "Review the AI proposal to apply"}
              </button>
            </>
          )}
          descriptionId="ai-case-authoring-description"
          entityLabel="Test Case"
          headerControl={<span className="test-case-studio-header-context"><IconChecklist aria-hidden="true" size={16} stroke={1.9} />AI Improve Test Cases</span>}
          inspectorAriaLabel="Current and improved test case inspector"
          inspectorContent={(
            <TestCaseAiStudioDraftInspector
              draft={activeDraft}
              editable={isGeneratedActive && Boolean(onPreviewChange) && !isBusy}
              onDescriptionChange={(value) => updatePreview({ description: value })}
              onStepChange={(index, next) => updatePreviewSteps(activeDraft.steps.map((step, itemIndex) => itemIndex === index ? next : step))}
              onStepsChange={updatePreviewSteps}
              onTitleChange={(value) => updatePreview({ title: value })}
              requirements={selectedRequirement ? [{ id: selectedRequirement.id, title: selectedRequirement.title }] : []}
              statusContent={toasterMessage ? <ToastMessage message={toasterMessage} onDismiss={dismissToast} tone={previewMessage ? previewTone : "error"} /> : null}
            />
          )}
          mode="improve"
          mission={additionalContext}
          missionPlaceholder="Ask for stronger boundaries, clearer expected results, reusable steps, data coverage, or automation readiness."
          onIntegrationChange={onIntegrationIdChange}
          onMissionChange={onAdditionalContextChange}
          onClose={onClose}
          onPrimaryGenerate={onGenerate}
          outputLabel="Editable Test Case completion proposal"
          approvalLabel="Review the generated version before replacing saved fields"
          primaryGenerateDisabled={disableGenerate || isBusy}
          primaryGenerateLabel={isPreviewing ? "Improving test case…" : preview ? "Regenerate proposal" : "Improve test case"}
          integrationId={integrationId}
          integrations={integrations}
          stageEvidence={{
            intake: additionalContext.trim() ? "The requested improvements define the review boundary." : "The agent will focus on clarity, reusable steps, assertions, data coverage, and automation readiness.",
            context: `${selectedRequirement ? "The linked Story" : "The current Test Case"}, current reusable steps, ${referenceImages.length} image${referenceImages.length === 1 ? "" : "s"}, and supplied project evidence are bounded to this review.`,
            guardrails: "The saved Test Case is never replaced during generation; unsupported context is treated as untrusted evidence.",
            specialist: "Test Design Agent is challenging step clarity, expected results, coverage boundaries, reuse, and automation readiness.",
            outcome: "The improved Test Case remains an editable proposal beside the current version.",
            evaluation: "The proposal is checked for title validity, traceability, reusable steps, and review readiness.",
            review: "The generated version must be selected and explicitly applied before the saved Test Case changes."
          }}
          queueAriaLabel="Current and improved test case queue"
          queuePane={(
            <StoryAiDraftQueue
              activeDraftId={activeDraftId}
              allowSelection={!isBusy}
              drafts={queueDrafts}
              emptyMessage="The current Test Case remains available while the improved proposal is generated."
              isDraftSelectable={(draft) => draft.id === IMPROVED_DRAFT_ID}
              itemNoun="version"
              onActivateDraft={setActiveDraftId}
              onClearSelection={() => setActiveDraftId(CURRENT_DRAFT_ID)}
              onSelectAll={(selected) => setActiveDraftId(selected && preview ? IMPROVED_DRAFT_ID : CURRENT_DRAFT_ID)}
              onToggleDraft={(_, selected) => setActiveDraftId(selected ? IMPROVED_DRAFT_ID : CURRENT_DRAFT_ID)}
              queueTitle="Review Queue"
              selectAllLabel="Select proposal"
              selectedDraftIds={isGeneratedActive ? [IMPROVED_DRAFT_ID] : []}
            />
          )}
          settingsAriaLabel="Test case improvement settings"
          settingsPane={settingsPane}
          showIncludeGherkin={false}
          studioDescription="Use the current reusable Test Case and its Jira Story context to produce a reviewable improvement without silently replacing saved content."
          studioTitle="Test Case Generator"
          titleId="ai-case-authoring-title"
        />
      </div>
    </div>
  );
}
