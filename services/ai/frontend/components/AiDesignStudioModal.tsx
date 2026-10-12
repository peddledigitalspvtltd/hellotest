import { AiTestCaseDraftFields } from "./AiTestCaseDraftFields";
import { AiTestCaseStepTable } from "./AiTestCaseStepTable";
import { useAiOutputSizing } from "../lib/useAiOutputSizing";
import { useEffect, useId, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { createPortal } from "react-dom";
import {
  IconAdjustmentsHorizontal, IconCalendarTime, IconCheck, IconChevronDown, IconChevronUp,
  IconEdit, IconLayoutGrid, IconLibraryPlus,
  IconBraces, IconListDetails, IconPlus, IconRefresh, IconSearch, IconSparkles, IconTrash, IconX
} from "@tabler/icons-react";
import type { AiDesignImageInput, AiDesignedTestCaseCandidate, Integration, Requirement, TestCase } from "@hellotest/platform/frontend/src/types";
import { useDialogFocus } from "@hellotest/platform/frontend/src/shared/hooks/useDialogFocus";
import { useAiLlmDefault } from "@hellotest/integration/frontend/hooks/useAiLlmDefault";
import { AiPromptContextPanel } from "./AiPromptContextPanel";
import { AiLlmSelect } from "./AiLlmSelect";
import { AiGenerationProgress } from "./AiGenerationProgress";
import { AiIntentCanvas } from "./AiIntentCanvas";
import { AiContextPeek } from "./AiContextPeek";
import { AiProposalCompare } from "./AiProposalCompare";
import { draftReadinessIssues } from "../lib/draftReadiness";
import { SelectionToggleIcon } from "@hellotest/platform/frontend/src/platform/components/AppIcons";
import { buildGherkinFromSteps, GherkinEditor } from "@hellotest/testing/frontend/components/GherkinEditor";
import { parseSharedStepGherkin } from "@hellotest/testing/frontend/lib/gherkin";
import { FormField } from "@hellotest/platform/frontend/src/shared/components/FormField";
import { InfoTooltip } from "@hellotest/platform/frontend/src/shared/components/InfoTooltip";
import { ToastMessage } from "@hellotest/platform/frontend/src/shared/components/ToastMessage";
import "./TestCaseAiStudioModal.css";

type AuthoringMode = "structured" | "gherkin";

export type AiDesignSourceCase = {
  id?: string;
  displayId?: string;
  title: string;
  description: string;
  authoringMode?: AuthoringMode;
  gherkinDocument?: string;
  parameterValues?: Record<string, string>;
  steps: Array<{
    step_order: number;
    step_type?: "web" | "api" | "android" | "ios" | null;
    action: string | null;
    expected_result: string | null;
  }>;
};

type AiDesignStudioModalProps = {
  eyebrow: string;
  requirementLabel: string;
  requirementHelpText: string;
  requirements: Requirement[];
  selectedRequirementIds: string[];
  allowMultipleRequirements: boolean;
  onRequirementSelectionChange: (requirementIds: string[]) => void;
  integrations: Integration[];
  llmUsageKey?: string;
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
  onPreview: (authoringMode: AuthoringMode) => void;
  onSchedule?: (authoringMode: AuthoringMode) => void;
  onAuthoringModeChange?: (authoringMode: AuthoringMode) => void;
  onAccept: (selectedClientIds: string[]) => void;
  onClose: () => void;
  onCancel?: () => void;
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
  sourceCase?: AiDesignSourceCase;
  studioTitle?: string;
  studioDescription?: string;
};

const plainText = (value: string | null | undefined) => String(value || "")
  .replace(/<[^>]*>/g, " ").replace(/[#*_`>\[\]()]/g, " ").replace(/\s+/g, " ").trim();
const normalizeTitle = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const gherkinFor = (candidate: AiDesignedTestCaseCandidate) => candidate.gherkin_document
  || buildGherkinFromSteps(candidate.title, [], candidate.steps);

export function AiDesignStudioModal(props: AiDesignStudioModalProps) {
  const {
    requirementLabel, requirementHelpText, requirements, selectedRequirementIds, allowMultipleRequirements,
    onRequirementSelectionChange, integrations, integrationId, onIntegrationIdChange, maxCases, onMaxCasesChange,
    additionalContext, onAdditionalContextChange, externalLinksText, onExternalLinksTextChange, referenceImages,
    onAddImages, onRemoveImage, appTypeName, existingCases, existingCasesTitle, existingCasesSubtitle,
    onViewExistingCase, previewCases, onPreviewCaseChange, onRemovePreviewCase, onTogglePreviewRequirement,
    previewMessage, previewTone, onPreviewMessageDismiss, isPreviewing, isAccepting, onPreview, onSchedule,
    onAuthoringModeChange, onAccept, onClose, onCancel, disablePreview, disableSchedule = true, disableAccept,
    isScheduling = false, closeDisabled = false, acceptLabel, dialogClassName,
    onParallelRequirementCountChange, scheduleHelperText, promptTemplateProjectId, promptTemplateAppTypeId,
    sourceCase, llmUsageKey = "ai.test_case.design", studioTitle = "AI Test Case Generator",
    studioDescription = "Generate structured or Gherkin Test Case drafts, review them, and accept selected drafts into the library."
  } = props;
  const [authoringMode, setAuthoringMode] = useState<AuthoringMode>(() => previewCases[0]?.authoring_mode || sourceCase?.authoringMode || "structured");
  const [viewMode, setViewMode] = useState<"list" | "grid">("list");
  const [draftSearch, setDraftSearch] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [expandedIds, setExpandedIds] = useState<string[]>([]);
  const [editingIds, setEditingIds] = useState<string[]>([]);
  const outputRef = useAiOutputSizing<HTMLDivElement>([previewCases, editingIds]);
  const [storyPickerOpen, setStoryPickerOpen] = useState(false);
  const [draftStoryIds, setDraftStoryIds] = useState<string[]>([]);
  const [storySearch, setStorySearch] = useState("");
  const [contextBusy, setContextBusy] = useState(false);
  const [comparing, setComparing] = useState(false);
  const [contextOpen, setContextOpen] = useState(false);
  const surfaceId = useId();
  const previousIdsRef = useRef<string[]>([]);
  const closeIsDisabled = closeDisabled || contextBusy;
  const busy = isPreviewing || isAccepting || isScheduling || contextBusy;
  const dialogRef = useDialogFocus<HTMLDivElement>({ closeDisabled: closeIsDisabled, onClose });
  const pickerRef = useDialogFocus<HTMLDivElement>({ active: storyPickerOpen, closeDisabled: closeIsDisabled, onClose: () => setStoryPickerOpen(false) });

  const selectedStories = useMemo(() => requirements.filter((item) => selectedRequirementIds.includes(item.id)), [requirements, selectedRequirementIds]);
  const selectedStory = selectedStories[0];
  const linkCount = externalLinksText.split(/\r?\n/).filter((value) => value.trim()).length;
  const defaultIntegrationId = useAiLlmDefault({ usageKey: llmUsageKey, projectId: promptTemplateProjectId, integrations });
  const currentIntegration = integrations.find((item) => item.id === integrationId && item.is_active !== false);
  const integrationLabel = integrationId ? currentIntegration?.name || "Unavailable LLM" : "Configured LLM";
  const integrationUnavailable = Boolean(integrationId && !currentIntegration);
  const visibleDrafts = useMemo(() => {
    const query = draftSearch.trim().toLowerCase();
    return query ? previewCases.filter((item) => [item.title, item.description, ...item.requirement_titles].some((value) => String(value || "").toLowerCase().includes(query))) : previewCases;
  }, [draftSearch, previewCases]);
  const visibleStories = useMemo(() => {
    const query = storySearch.trim().toLowerCase();
    return query ? requirements.filter((item) => [item.display_id, item.id, item.title, item.description, item.status].some((value) => String(value || "").toLowerCase().includes(query))) : requirements;
  }, [requirements, storySearch]);

  useEffect(() => {
    const nextIds = previewCases.map((item) => item.client_id);
    const newIds = nextIds.filter((id) => !previousIdsRef.current.includes(id));
    previousIdsRef.current = nextIds;
    setSelectedIds((current) => [...new Set([...current.filter((id) => nextIds.includes(id)), ...newIds])]);
    setExpandedIds((current) => current.some((id) => nextIds.includes(id)) ? current.filter((id) => nextIds.includes(id)) : nextIds.slice(0, 1));
    if (previewCases[0]?.authoring_mode) setAuthoringMode(previewCases[0].authoring_mode);
  }, [previewCases]);

  const selectedCount = previewCases.filter((item) => selectedIds.includes(item.client_id)).length;
  const selectedDraftIssues = previewCases.filter(item => selectedIds.includes(item.client_id))
    .flatMap(item => draftReadinessIssues(item, authoringMode).map(issue => `${item.title || "Untitled draft"}: ${issue}`));
  const invalidSelectedDraft = selectedDraftIssues.length > 0;

  const updateDraft = (draft: AiDesignedTestCaseCandidate, changes: Partial<AiDesignedTestCaseCandidate>) => {
    if (busy) return;
    const updated = { ...draft, ...changes };
    updated.step_count = updated.authoring_mode === "gherkin"
      ? parseSharedStepGherkin(updated.gherkin_document || "").length
      : updated.steps.length;
    onPreviewCaseChange?.(draft.client_id, updated);
  };
  const toggleFrom = (setter: Dispatch<SetStateAction<string[]>>, id: string) => setter((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  const changeMode = (mode: AuthoringMode) => {
    if (mode === authoringMode || busy) return;
    setAuthoringMode(mode);
    setSelectedIds([]);
    setExpandedIds([]);
    onAuthoringModeChange?.(mode);
  };
  const toggleStory = (id: string, checked: boolean) => setDraftStoryIds((current) => allowMultipleRequirements
    ? checked ? [...new Set([...current, id])] : current.filter((item) => item !== id)
    : checked ? [id] : []);

  const storyPicker = storyPickerOpen ? (
    <div className="modal-backdrop nested-modal-backdrop" onClick={() => !closeIsDisabled && setStoryPickerOpen(false)} role="presentation">
      <div aria-labelledby="ai-test-case-story-selection-title" aria-modal="true" className="modal-card requirement-selection-dialog test-case-studio-story-picker" onClick={(event) => event.stopPropagation()} ref={pickerRef} role="dialog" tabIndex={-1}>
        <header><div><span>{requirementLabel}</span><h2 id="ai-test-case-story-selection-title">Select Story context</h2><p>{draftStoryIds.length} of {requirements.length} selected</p></div><button aria-label="Close Story selection" disabled={closeIsDisabled} onClick={() => setStoryPickerOpen(false)} type="button"><IconX size={18} /></button></header>
        <FormField label="Search Stories"><input autoFocus disabled={closeIsDisabled} onChange={(event) => setStorySearch(event.target.value)} placeholder="Search title, description, or status" value={storySearch} /></FormField>
        <div className="test-case-studio-story-picker__actions">{allowMultipleRequirements ? <button onClick={() => setDraftStoryIds(visibleStories.map((item) => item.id))} type="button"><SelectionToggleIcon checked />Select visible</button> : null}<button onClick={() => setDraftStoryIds([])} type="button"><SelectionToggleIcon checked={false} />Clear</button></div>
        <div className="test-case-studio-story-picker__list">{visibleStories.map((story) => <label key={story.id}><input checked={draftStoryIds.includes(story.id)} name={allowMultipleRequirements ? undefined : "ai-test-story-context"} onChange={(event) => toggleStory(story.id, event.target.checked)} type={allowMultipleRequirements ? "checkbox" : "radio"} /><span><strong>{story.title}</strong><small>{plainText(story.description) || "No description available."}</small><em>Priority P{story.priority ?? 3} · {story.status || "open"}</em></span></label>)}</div>
        <footer><button onClick={() => setStoryPickerOpen(false)} type="button">Cancel</button><button className="primary-button" onClick={() => { onRequirementSelectionChange(draftStoryIds); setStoryPickerOpen(false); }} type="button">Use selected context</button></footer>
      </div>
    </div>
  ) : null;

  return <>
    <div
      className="modal-backdrop test-case-ai-studio-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget && !closeIsDisabled) onClose();
      }}
      role="presentation"
    >
      <div aria-describedby="ai-design-studio-description" aria-labelledby="ai-design-studio-title" aria-modal="true" className={`modal-card test-case-ai-studio-modal ai-test-generator-modal ai-command-studio has-review-footer${previewCases.length ? " has-proposal" : ""}${dialogClassName ? ` ${dialogClassName}` : ""}`} onClick={(event) => event.stopPropagation()} ref={dialogRef} role="dialog" tabIndex={-1}>
        <header className="ai-test-generator-header">
          <div><IconSparkles size={20} /><h1 id="ai-design-studio-title">{studioTitle}</h1></div>
          <p className="sr-only" id="ai-design-studio-description">{studioDescription}</p>
          <div className="ai-test-generator-header__actions">
            <button aria-controls={`${surfaceId}-context`} aria-expanded={contextOpen} aria-label={`${contextOpen ? "Hide" : "Show"} context`} className="ai-test-generator-context-toggle" onClick={() => setContextOpen(current => !current)} type="button"><IconAdjustmentsHorizontal size={17} /><span>Context</span></button>
            <button aria-label="Search generated test cases" aria-expanded={searchOpen} aria-controls="ai-test-generator-search" className="ai-studio-search-toggle" onClick={() => { setSearchOpen(current => !current); window.requestAnimationFrame(() => document.getElementById("ai-test-generator-search")?.focus()); }} type="button"><IconSearch size={17} /></button>
            <label className={`ai-studio-search${searchOpen ? " is-open" : ""}`}><IconSearch size={17} /><input aria-label="Search generated test cases" id="ai-test-generator-search" onChange={(event) => setDraftSearch(event.target.value)} placeholder="Search cases…" value={draftSearch} /></label>
            <button aria-label="Close AI Test Case Generator" className="ai-test-generator-close" disabled={closeIsDisabled} onClick={onClose} type="button"><IconX size={20} /></button>
          </div>
        </header>

        <div className={`ai-test-generator-layout is-intelligence-collapsed${contextOpen ? "" : " is-context-collapsed"}`}>


          <main className="ai-test-generator-workspace">
            <AiIntentCanvas value={additionalContext} onChange={onAdditionalContextChange} onSubmit={() => onPreview(authoringMode)} disabled={busy} submitDisabled={disablePreview || integrationUnavailable} hasOutput={Boolean(previewCases.length)}
              title={sourceCase ? "What should improve?" : "What should we cover?"}
              placeholder={sourceCase ? "Describe what to clarify, preserve, or add to this Test Case." : "Describe the risks, user journeys, and acceptance boundaries to cover."}
              chips={[
                { id: "stories", label: selectedStories.length > 1 ? "Stories attached" : selectedStory?.title || "Story (optional)", count: selectedStories.length, onClick: () => { setDraftStoryIds(selectedRequirementIds); setStorySearch(""); setStoryPickerOpen(true); } },
                ...(sourceCase ? [{ id: "source", label: sourceCase.displayId || "Current Test Case", onClick: () => setContextOpen(true) }] : []),
                { id: "evidence", label: additionalContext.includes("[HELLOTEST_SMART_CONTEXT_START]") ? "Reviewed evidence included" : additionalContext.includes("[HELLOTEST_TEMPLATE_CONTEXT_START]") ? "Template included" : "Attach evidence", count: linkCount + referenceImages.length, onClick: () => setContextOpen(true) }
              ]}
              suggestions={sourceCase ? [{ label: "Clarify results", instruction: "Make every expected result measurable. Preserve the current intent and linked Story." }, { label: "Cover recovery", instruction: "Include failure recovery and boundary conditions supported by the evidence." }] : [{ label: "Edge cases", instruction: "Cover boundary conditions and invalid inputs supported by the selected Stories." }, { label: "Failure recovery", instruction: "Cover interrupted workflows and recovery without losing user data." }, { label: "Permission checks", instruction: "Cover the allowed and denied actions for roles described in the evidence." }]}
              options={<div aria-label="Test Case authoring format" className="ai-test-generator-authoring-tabs" role="radiogroup">
                <button aria-checked={authoringMode === "structured"} className={authoringMode === "structured" ? "is-active" : ""} disabled={busy} onClick={() => changeMode("structured")} role="radio" type="button"><IconListDetails size={15} />Structured</button>
                <button aria-checked={authoringMode === "gherkin"} className={authoringMode === "gherkin" ? "is-active" : ""} disabled={busy} onClick={() => changeMode("gherkin")} role="radio" type="button"><IconBraces size={15} />Gherkin</button>
              </div>} />
            <div className="ai-test-generator-workspace__header">
              <div className="ai-test-generator-workspace__identity">
                <div><h2>Test Case Drafts</h2><p>Review, refine, and accept only the coverage you want.</p></div>
                <span>{previewCases.length} Generated</span>
              </div>
            </div>
            <div className={`ai-test-generator-toast${previewMessage ? " has-message" : ""}`}>
              {previewMessage ? <ToastMessage message={previewMessage} onDismiss={onPreviewMessageDismiss} tone={previewTone} /> : null}
            </div>

            <div className={`ai-test-generator-drafts is-${viewMode}`} ref={outputRef} aria-busy={isPreviewing}>
              {isPreviewing ? <AiGenerationProgress modelLabel={integrationLabel} onCancel={onCancel} /> : null}
              {!previewCases.length && !isPreviewing ? <div className="ai-test-generator-empty"><h3>{selectedStories.length ? "Your proposal will appear here" : "Your proposal will appear here"}</h3><p>{selectedStories.length ? "Generate a proposal, then refine and save the drafts you choose." : requirementHelpText}</p></div> : null}
              {visibleDrafts.length ? <div className="ai-artifact-workspace">
                <nav aria-label="Proposal outline" className="ai-artifact-outline">
                  <div className="ai-artifact-outline__tools"><label><input aria-label="Select all" checked={visibleDrafts.every(item => selectedIds.includes(item.client_id))} disabled={busy} onChange={event => setSelectedIds(current => event.target.checked ? [...new Set([...current, ...visibleDrafts.map(item => item.client_id)])] : current.filter(id => !visibleDrafts.some(item => item.client_id === id)))} type="checkbox" />Select all</label><button disabled={!selectedIds.length || busy} onClick={() => setSelectedIds([])} type="button">Clear selection</button></div>
                  {visibleDrafts.map((draft, index) => <article aria-current={(expandedIds[0] || visibleDrafts[0]?.client_id) === draft.client_id ? "true" : undefined} className="ai-artifact-item" key={draft.client_id}>
                    <input aria-label={`Select ${draft.title}`} checked={selectedIds.includes(draft.client_id)} disabled={busy} onChange={event => setSelectedIds(current => event.target.checked ? [...new Set([...current, draft.client_id])] : current.filter(id => id !== draft.client_id))} type="checkbox" />
                    <button aria-current={(expandedIds[0] || visibleDrafts[0]?.client_id) === draft.client_id ? "true" : undefined} onClick={() => setExpandedIds([draft.client_id])} onKeyDown={event => {
                      const next = event.key === "ArrowDown" ? index + 1 : event.key === "ArrowUp" ? index - 1 : event.key === "Home" ? 0 : event.key === "End" ? visibleDrafts.length - 1 : -1;
                      if (next >= 0 && next < visibleDrafts.length) { event.preventDefault(); setExpandedIds([visibleDrafts[next].client_id]); event.currentTarget.closest("nav")?.querySelectorAll<HTMLButtonElement>(".ai-artifact-item > button")[next]?.focus(); }
                    }} type="button"><strong>{draft.title || "Untitled draft"}</strong><small>P{draft.priority} · {draft.step_count} {draft.authoring_mode === "gherkin" ? "scenario lines" : "steps"}{draftReadinessIssues(draft, authoringMode).length ? " · Needs attention" : ""}</small></button>
                  </article>)}
                </nav>
                {visibleDrafts.filter(draft => draft.client_id === (visibleDrafts.some(item => item.client_id === expandedIds[0]) ? expandedIds[0] : visibleDrafts[0]?.client_id)).map(draft => {
                  const editing = editingIds.includes(draft.client_id);
                  const draftMode = draft.authoring_mode || authoringMode;
                  const issues = draftReadinessIssues(draft, authoringMode);
                  return <article aria-label={`Review ${draft.title}`} className="ai-artifact-detail" key={draft.client_id}>
                    <header><span><IconSparkles size={13} /> Proposal · review before saving</span><div className="ai-artifact-detail__tools">
                      {sourceCase ? <button aria-pressed={comparing} onClick={() => setComparing(current => !current)} type="button">{comparing ? "Hide comparison" : "Compare"}</button> : null}
                      {onPreviewCaseChange ? <button aria-label={editing ? "Finish editing draft" : "Edit draft"} disabled={busy} onClick={() => toggleFrom(setEditingIds, draft.client_id)} type="button">{editing ? <IconCheck size={15} /> : <IconEdit size={15} />}{editing ? "Done" : "Edit"}</button> : null}
                      <button aria-label="Delete draft" disabled={busy} onClick={() => onRemovePreviewCase(draft.client_id)} type="button"><IconTrash size={15} /></button>
                    </div></header>
                    <AiTestCaseDraftFields section="title" title={draft.title} description={draft.description} priority={draft.priority} editing={editing} disabled={busy} onChange={patch => updateDraft(draft,patch)} />
                    {sourceCase && comparing ? <AiProposalCompare fields={[
                      { label: "Title", before: sourceCase.title, after: draft.title },
                      { label: "Description", before: plainText(sourceCase.description), after: plainText(draft.description) },
                      { label: "Test content", before: sourceCase.authoringMode === "gherkin" ? sourceCase.gherkinDocument || "" : sourceCase.steps.map(step => `${step.step_order}. ${step.action || ""}\nExpected: ${step.expected_result || ""}`).join("\n\n"), after: draftMode === "gherkin" ? gherkinFor(draft) : draft.steps.map(step => `${step.step_order}. ${step.action || ""}\nExpected: ${step.expected_result || ""}`).join("\n\n") }
                    ]} /> : null}
                    {issues.length ? <p className="ai-test-generator-draft-issues" role="status">{issues.join(" ")}</p> : null}
                    <AiTestCaseDraftFields section="fields" title={draft.title} description={draft.description} descriptionText={plainText(draft.description)} priority={draft.priority} editing={editing} disabled={busy} onChange={patch => updateDraft(draft,patch)} />
                    {draftMode === "gherkin" ? <GherkinEditor compact featureTitle={draft.title} onChange={(document) => updateDraft(draft, { authoring_mode: "gherkin", gherkin_document: document })} parameterValues={draft.parameter_values} readOnly={!editing} value={gherkinFor(draft)} /> : <AiTestCaseStepTable steps={draft.steps} editing={editing} disabled={busy} newStep={() => ({ step_order: draft.steps.length + 1, step_type: "web" as const, action: "", expected_result: "" })} onChange={items => { const steps = items.map((step, index) => ({ ...step, step_order: index + 1 })); updateDraft(draft, { steps, step_count: steps.length }); }} />}
                    {selectedStories.length > 1 ? <div className="ai-test-generator-traceability"><span>Story traceability</span>{selectedStories.map((story) => <button className={draft.requirement_ids.includes(story.id) ? "is-linked" : ""} disabled={!onTogglePreviewRequirement || busy} key={story.id} onClick={() => onTogglePreviewRequirement?.(draft.client_id, story.id)} type="button">{draft.requirement_ids.includes(story.id) ? <IconCheck size={13} /> : <IconPlus size={13} />}{story.display_id || story.title}</button>)}</div> : null}

                  </article>;
                })}
              </div> : null}
              {previewCases.length && !visibleDrafts.length ? <div className="ai-test-generator-empty"><IconSearch size={30} /><h3>No matching drafts</h3><p>Clear or change the search to see generated cases.</p></div> : null}
              {existingCases.length ? <details className="ai-test-generator-existing"><summary><span><strong>{existingCasesTitle}</strong><small>{existingCasesSubtitle}</small></span><span>{existingCases.length}</span></summary><div>{existingCases.slice(0, 8).map((testCase) => <button disabled={!onViewExistingCase} key={testCase.id} onClick={() => onViewExistingCase?.(testCase.id)} type="button"><strong>{testCase.title}</strong><span>{testCase.step_count || 0} steps</span></button>)}</div></details> : null}
            </div>

          </main>


        </div>
            <footer className="ai-test-generator-footer"><strong>{previewCases.length ? `${selectedCount} selected of ${previewCases.length}` : "Draft first. Save after review."}</strong><div>{previewCases.length ? <button disabled={busy} onClick={() => previewCases.forEach((draft) => onRemovePreviewCase(draft.client_id))} type="button">Decline all</button> : null}{onSchedule ? <span><button disabled={disableSchedule || busy || integrationUnavailable} onClick={() => onSchedule(authoringMode)} type="button"><IconCalendarTime size={17} />{isScheduling ? "Scheduling…" : "Schedule"}</button><InfoTooltip content={scheduleHelperText || "Queue generation for the selected Stories. Generated cases return as reviewable drafts."} label="Scheduled generation information" /></span> : null}<button disabled={disablePreview || busy || integrationUnavailable} onClick={() => onPreview(authoringMode)} className={!previewCases.length ? "primary-button" : undefined} type="button"><IconSparkles size={17} />{isPreviewing ? "Generating…" : previewTone === "error" && previewMessage ? "Retry" : previewCases.length ? "Regenerate" : "Generate drafts"}</button>{previewCases.length ? <button className="primary-button" disabled={disableAccept || !selectedCount || invalidSelectedDraft || busy} onClick={() => onAccept(selectedIds)} title={invalidSelectedDraft ? "Complete the selected draft title and required test content before accepting." : undefined} type="button"><IconLibraryPlus size={17} />{isAccepting ? "Accepting…" : `${acceptLabel} (${selectedCount})`}</button> : null}</div></footer>
        <footer className="ai-test-generator-status-footer">
          <span>{isPreviewing ? "Waiting for the model" : isAccepting ? "Saving reviewed drafts…" : previewCases.length ? "Proposal ready for review" : "Ready to generate"}</span>
          <div>
            <span>Model: {currentIntegration?.model || integrationLabel}</span>
            <span>Review before saving</span>
          </div>
        </footer>
      </div>
    </div>
    <AiContextPeek id={`${surfaceId}-context`} open={contextOpen} onClose={() => setContextOpen(false)} description={appTypeName}>

            <section className="ai-test-generator-section">
              <label className="ai-test-generator-label">Target {allowMultipleRequirements ? "Stories" : "Story"}</label>
              <button className="ai-test-generator-story-select" disabled={busy} onClick={() => { setDraftStoryIds(selectedRequirementIds); setStorySearch(""); setStoryPickerOpen(true); }} type="button"><span>{selectedStories.length === 1 ? `${selectedStory?.display_id || selectedStory?.id}: ${selectedStory?.title}` : selectedStories.length > 1 ? `${selectedStories.length} Stories selected` : "Select a Story (optional)"}</span><IconChevronDown size={17} /></button>
              {selectedStory ? <div className="ai-test-generator-story-meta"><span>ID: {selectedStory.display_id || selectedStory.id}</span><span>{selectedStory.status || "Open"}</span></div> : null}<p>{requirementHelpText}</p>
            </section>
            {sourceCase ? <section className="ai-test-generator-section ai-test-generator-source-case" aria-label="Existing Test Case details">
              <div className="ai-test-generator-section__heading"><span>Existing Test Case</span><small>{sourceCase.authoringMode === "gherkin" ? "Gherkin" : `${sourceCase.steps.length} steps`}</small></div>
              <div className="ai-test-generator-source-case__identity"><strong>{sourceCase.title || "Untitled Test Case"}</strong>{sourceCase.displayId || sourceCase.id ? <code>{sourceCase.displayId || sourceCase.id}</code> : null}</div>
              {sourceCase.description ? <p>{plainText(sourceCase.description)}</p> : <p>No description is currently recorded.</p>}
              <details>
                <summary>Review current authored content</summary>
                {sourceCase.authoringMode === "gherkin" && sourceCase.gherkinDocument ? <pre>{sourceCase.gherkinDocument}</pre> : <ol>{sourceCase.steps.map((step) => <li key={step.step_order}><strong>{plainText(step.action) || "No action"}</strong><span>{plainText(step.expected_result) || "No expected result"}</span></li>)}</ol>}
              </details>
            </section> : null}
            <section className="ai-test-generator-section ai-test-generator-context-engine">
              <div className="ai-test-generator-section__heading"><span>Generation Context</span><small>Manual + Templates</small></div>
              <AiPromptContextPanel additionalContext={additionalContext} includeArtifactContextInPack={false} artifactIds={sourceCase?.id ? [sourceCase.id] : []} artifactContext={sourceCase ? [
                `Current Test Case: ${sourceCase.displayId || sourceCase.id || "draft"} — ${sourceCase.title}`,
                sourceCase.description.slice(0, 1_500),
                ...sourceCase.steps.slice(0, 8).map((step, index) => `${index + 1}. ${String(step.action || "").slice(0, 240)} Expected: ${String(step.expected_result || "").slice(0, 180)}`)
              ].filter(Boolean).join("\n") : ""} appTypeId={promptTemplateAppTypeId} disabled={busy} externalLinksText={externalLinksText} onAddImages={onAddImages} onAdditionalContextChange={onAdditionalContextChange} onBusyChange={setContextBusy} onExternalLinksTextChange={onExternalLinksTextChange} onRemoveImage={onRemoveImage} promptScope={sourceCase ? "test_case_steps" : "test_case_generation"} projectId={promptTemplateProjectId} referenceImages={referenceImages} referenceUploadPresentation="dropzone" requirements={selectedStories} showPromptEditor={false} />
            </section>
            <details className="ai-test-generator-section ai-test-generator-model-settings" open={integrationUnavailable || undefined}>
              <summary><span>Model & generation</span><small>{integrationLabel}{!sourceCase ? ` · ${maxCases} drafts` : ""}</small><IconChevronDown size={15} /></summary>
              <AiLlmSelect defaultIntegrationId={defaultIntegrationId} disabled={busy} integrations={integrations} onChange={onIntegrationIdChange} scopeKey={`${promptTemplateProjectId}:${llmUsageKey}`} value={integrationId} />
              {integrationUnavailable ? <p role="status">Choose an available LLM or Configured LLM to generate new drafts.</p> : null}
              {!sourceCase ? <label className="ai-test-generator-count">Draft count<select disabled={busy} onChange={(event) => onMaxCasesChange(Number(event.target.value))} value={maxCases}>{[1, 2, 3].map((count) => <option key={count} value={count}>{count}</option>)}</select></label> : null}
              {onParallelRequirementCountChange ? <p className="ai-test-generator-queue-note">Scheduled Stories run one at a time to keep provider usage predictable.</p> : null}
            </details>
    </AiContextPeek>
    {storyPicker && typeof document !== "undefined" ? createPortal(storyPicker, document.body) : storyPicker}
  </>;
}
