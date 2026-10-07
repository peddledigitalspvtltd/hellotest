import { useMemo } from "react";
import type { AiAuthoredTestCasePreview, AiDesignImageInput, AiDesignedTestCaseCandidate, Integration, Requirement, TestStep } from "@hellotest/platform/frontend/src/types";
import { AiDesignStudioModal, type AiDesignSourceCase } from "./AiDesignStudioModal";
import { parseSharedStepGherkin } from "@hellotest/testing/frontend/lib/gherkin";

type AuthoringMode = "structured" | "gherkin";

type SourceDraft = {
  id?: string;
  display_id?: string;
  title: string;
  description: string;
  authoring_mode?: AuthoringMode;
  gherkin_document?: string;
  parameter_values: Record<string, string>;
  steps: Array<{ step_order: number; step_type?: TestStep["step_type"]; action: string | null; expected_result: string | null }>;
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
  onGenerate: (authoringMode: AuthoringMode) => void;
  onApply: () => void;
  onClose: () => void;
  onCancel?: () => void;
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
  appTypeName?: string;
  promptTemplateProjectId?: string;
  promptTemplateAppTypeId?: string;
};

const IMPROVED_DRAFT_ID = "improved-test-case";

function toCandidate(preview: AiAuthoredTestCasePreview, requirement?: Requirement | null): AiDesignedTestCaseCandidate {
  return {
    client_id: IMPROVED_DRAFT_ID,
    title: preview.title,
    description: preview.description,
    priority: 3,
    authoring_mode: preview.authoring_mode || "structured",
    gherkin_document: preview.gherkin_document,
    parameter_values: preview.parameter_values,
    parameter_count: preview.parameter_count,
    requirement_ids: requirement ? [requirement.id] : [],
    requirement_titles: requirement ? [requirement.title] : [],
    steps: preview.steps,
    step_count: preview.step_count
  };
}

function fromCandidate(candidate: AiDesignedTestCaseCandidate, current: AiAuthoredTestCasePreview): AiAuthoredTestCasePreview {
  return {
    ...current,
    title: candidate.title,
    description: candidate.description,
    authoring_mode: candidate.authoring_mode || "structured",
    gherkin_document: candidate.gherkin_document || "",
    parameter_values: candidate.parameter_values || {},
    parameter_count: Object.keys(candidate.parameter_values || {}).length,
    steps: candidate.steps,
    step_count: candidate.authoring_mode === "gherkin"
      ? parseSharedStepGherkin(candidate.gherkin_document || "").length
      : candidate.steps.length
  };
}

export function AiCaseAuthoringModal(props: AiCaseAuthoringModalProps) {
  const {
    requirementId, requirements, integrationId, integrations, additionalContext, externalLinksText, referenceImages,
    sourceDraft, preview, previewMessage, previewTone, onRequirementChange, onIntegrationIdChange,
    onAdditionalContextChange, onExternalLinksTextChange, onAddImages, onRemoveImage, onGenerate, onApply, onClose,
    onPreviewChange, onPreviewMessageDismiss, isPreviewing, isApplying, closeDisabled, disableGenerate, disableApply,
    applyLabel, hasAutomationWarning, isCreating, appTypeName = "Current application", promptTemplateProjectId, promptTemplateAppTypeId, onCancel
  } = props;
  const selectedRequirement = requirements.find((requirement) => requirement.id === requirementId) || null;
  const previewCases = useMemo(() => preview ? [toCandidate(preview, selectedRequirement)] : [], [preview, selectedRequirement]);
  const sourceCase = useMemo<AiDesignSourceCase>(() => ({
    id: sourceDraft.id,
    displayId: sourceDraft.display_id,
    title: sourceDraft.title,
    description: sourceDraft.description,
    authoringMode: sourceDraft.authoring_mode || "structured",
    gherkinDocument: sourceDraft.gherkin_document,
    parameterValues: sourceDraft.parameter_values,
    steps: sourceDraft.steps
  }), [sourceDraft]);
  const warning = hasAutomationWarning && !isCreating
    ? "Applying this proposal replaces the saved step set, including existing automation code or API request setup."
    : "";

  return <AiDesignStudioModal
    acceptLabel={applyLabel}
    additionalContext={additionalContext}
    allowMultipleRequirements={false}
    appTypeName={appTypeName}
    closeDisabled={closeDisabled}
    dialogClassName="ai-test-case-improve-generator ai-feature-dialog"
    disableAccept={disableApply}
    disablePreview={disableGenerate}
    existingCases={[]}
    existingCasesSubtitle=""
    existingCasesTitle=""
    externalLinksText={externalLinksText}
    eyebrow="AI Improvement"
    integrationId={integrationId}
    integrations={integrations}
    llmUsageKey="ai.case_authoring.full_case"
    isAccepting={isApplying}
    isPreviewing={isPreviewing}
    maxCases={1}
    onAccept={() => onApply()}
    onAddImages={onAddImages}
    onAdditionalContextChange={onAdditionalContextChange}
    onAuthoringModeChange={() => onPreviewChange?.(null)}
    onClose={onClose}
    onCancel={onCancel}
    onExternalLinksTextChange={onExternalLinksTextChange}
    onIntegrationIdChange={onIntegrationIdChange}
    onMaxCasesChange={() => undefined}
    onPreview={onGenerate}
    onPreviewCaseChange={(_, candidate) => { if (preview) onPreviewChange?.(fromCandidate(candidate, preview)); }}
    onPreviewMessageDismiss={onPreviewMessageDismiss}
    onRemoveImage={onRemoveImage}
    onRemovePreviewCase={() => onPreviewChange?.(null)}
    onRequirementSelectionChange={(ids) => onRequirementChange(ids[0] || "")}
    previewCases={previewCases}
    previewMessage={previewMessage || warning}
    previewTone={previewMessage ? previewTone : "error"}
    promptTemplateAppTypeId={promptTemplateAppTypeId}
    promptTemplateProjectId={promptTemplateProjectId}
    referenceImages={referenceImages}
    requirementHelpText="Choose the Story this existing Test Case must continue to satisfy."
    requirementLabel="Story"
    requirements={requirements}
    selectedRequirementIds={requirementId ? [requirementId] : []}
    sourceCase={sourceCase}
    studioDescription="Improve the current Test Case using the same structured or Gherkin generation workbench, then explicitly apply the reviewed proposal."
    studioTitle={isCreating ? "AI Draft Test Case" : "AI Improve Test Case"}
  />;
}
