import { useEffect, useMemo, useRef, useState, type CSSProperties, type Dispatch, type SetStateAction } from "react";
import { createPortal } from "react-dom";
import {
  IconAdjustmentsHorizontal, IconCalendarTime, IconChartDonut, IconCheck, IconChevronDown, IconChevronUp,
  IconDatabase, IconEdit, IconExternalLink, IconFile, IconHistory, IconLayoutGrid, IconLibraryPlus,
  IconBraces, IconListDetails, IconPlus, IconRefresh, IconSearch, IconSparkles, IconTrash, IconX
} from "@tabler/icons-react";
import type { AiDesignImageInput, AiDesignedTestCaseCandidate, Integration, Requirement, TestCase } from "../types";
import { useDialogFocus } from "../hooks/useDialogFocus";
import { AiPromptContextPanel } from "./AiPromptContextPanel";
import { SelectionToggleIcon } from "./AppIcons";
import { buildGherkinFromSteps, GherkinEditor } from "./GherkinEditor";
import { FormField } from "./FormField";
import { InfoTooltip } from "./InfoTooltip";
import { ToastMessage } from "./ToastMessage";
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
    onAuthoringModeChange, onAccept, onClose, disablePreview, disableSchedule = true, disableAccept,
    isScheduling = false, closeDisabled = false, acceptLabel, dialogClassName, parallelRequirementCount,
    onParallelRequirementCountChange, scheduleHelperText, promptTemplateProjectId, promptTemplateAppTypeId,
    sourceCase, studioTitle = "AI Test Case Generator",
    studioDescription = "Generate structured or Gherkin Test Case drafts, review them, and accept selected drafts into the library."
  } = props;
  const [authoringMode, setAuthoringMode] = useState<AuthoringMode>(() => previewCases[0]?.authoring_mode || "structured");
  const [viewMode, setViewMode] = useState<"list" | "grid">("list");
  const [draftSearch, setDraftSearch] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [expandedIds, setExpandedIds] = useState<string[]>([]);
  const [editingIds, setEditingIds] = useState<string[]>([]);
  const [storyPickerOpen, setStoryPickerOpen] = useState(false);
  const [draftStoryIds, setDraftStoryIds] = useState<string[]>([]);
  const [storySearch, setStorySearch] = useState("");
  const [contextBusy, setContextBusy] = useState(false);
  const [intelligenceOpen, setIntelligenceOpen] = useState(false);
  const previousIdsRef = useRef<string[]>([]);
  const closeIsDisabled = closeDisabled || contextBusy;
  const busy = isPreviewing || isAccepting || isScheduling || contextBusy;
  const dialogRef = useDialogFocus<HTMLDivElement>({ closeDisabled: closeIsDisabled, onClose });
  const pickerRef = useDialogFocus<HTMLDivElement>({ active: storyPickerOpen, closeDisabled: closeIsDisabled, onClose: () => setStoryPickerOpen(false) });

  const selectedStories = useMemo(() => requirements.filter((item) => selectedRequirementIds.includes(item.id)), [requirements, selectedRequirementIds]);
  const selectedStory = selectedStories[0];
  const linkCount = externalLinksText.split(/\r?\n/).filter((value) => value.trim()).length;
  const currentIntegration = integrations.find((item) => item.id === integrationId) || integrations[0];
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
  const invalidSelectedDraft = previewCases.some((item) => selectedIds.includes(item.client_id) && (
    !item.title.trim()
    || item.title.length > 255
    || ((item.authoring_mode || authoringMode) === "gherkin"
      ? !/^\s*Feature\s*:/im.test(item.gherkin_document || "") || !/^\s*Scenario(?: Outline| Template)?\s*:/im.test(item.gherkin_document || "")
      : !item.steps.length || item.steps.some((step) => !String(step.action || "").trim() || !String(step.expected_result || "").trim()))
  ));
  const duplicateCount = previewCases.filter((draft) => existingCases.some((saved) => normalizeTitle(saved.title) === normalizeTitle(draft.title))).length;
  const completeCount = previewCases.filter((draft) => draft.title.trim() && ((draft.authoring_mode || authoringMode) === "gherkin"
    ? /^\s*Feature\s*:/im.test(draft.gherkin_document || "") && /^\s*Scenario(?: Outline| Template)?\s*:/im.test(draft.gherkin_document || "")
    : draft.steps.length > 0 && draft.steps.every((step) => String(step.action || "").trim() && String(step.expected_result || "").trim()))).length;
  const confidence = previewCases.length ? Math.min(97, Math.round(54 + (selectedRequirementIds.length ? 10 : 0)
    + (completeCount / previewCases.length) * 22 + (additionalContext.trim() || linkCount || referenceImages.length ? 7 : 0) + (duplicateCount ? 0 : 4))) : 0;
  const confidenceLabel = confidence >= 85 ? "High Confidence" : confidence >= 70 ? "Ready for Review" : previewCases.length ? "Needs Review" : "Awaiting Drafts";

  const updateDraft = (draft: AiDesignedTestCaseCandidate, changes: Partial<AiDesignedTestCaseCandidate>) => onPreviewCaseChange?.(draft.client_id, { ...draft, ...changes });
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
        <footer><button onClick={() => setStoryPickerOpen(false)} type="button">Cancel</button><button className="primary-button" disabled={!draftStoryIds.length} onClick={() => { onRequirementSelectionChange(draftStoryIds); setStoryPickerOpen(false); }} type="button">Use selected context</button></footer>
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
      <div aria-describedby="ai-design-studio-description" aria-labelledby="ai-design-studio-title" aria-modal="true" className={`modal-card test-case-ai-studio-modal ai-test-generator-modal${dialogClassName ? ` ${dialogClassName}` : ""}`} onClick={(event) => event.stopPropagation()} ref={dialogRef} role="dialog" tabIndex={-1}>
        <header className="ai-test-generator-header">
          <div><IconSparkles size={20} /><h1 id="ai-design-studio-title">{studioTitle}</h1></div>
          <p className="sr-only" id="ai-design-studio-description">{studioDescription}</p>
          <div className="ai-test-generator-header__actions">
            <label><IconSearch size={17} /><input aria-label="Search generated test cases" id="ai-test-generator-search" onChange={(event) => setDraftSearch(event.target.value)} placeholder="Search cases…" value={draftSearch} /></label>
            <button aria-expanded={intelligenceOpen} aria-label={`${intelligenceOpen ? "Hide" : "Show"} intelligence status`} className={`ai-test-generator-insight-toggle${intelligenceOpen ? " is-active" : ""}`} onClick={() => setIntelligenceOpen((current) => !current)} type="button"><IconChartDonut size={17} /><span>Intelligence</span></button>
            <button aria-label="Close AI Test Case Generator" className="ai-test-generator-close" disabled={closeIsDisabled} onClick={onClose} type="button"><IconX size={20} /></button>
          </div>
        </header>

        <div className={`ai-test-generator-layout${intelligenceOpen ? " is-intelligence-open" : " is-intelligence-collapsed"}`}>
          <aside aria-label="Test case generation context" className="ai-test-generator-context">
            <div className="ai-test-generator-pane-title"><IconAdjustmentsHorizontal size={19} /><div><strong>Context Setup</strong><span>Define the scope for AI generation.</span></div></div>
            <section className="ai-test-generator-section">
              <label className="ai-test-generator-label">Target {allowMultipleRequirements ? "Stories" : "Story"}</label>
              <button className="ai-test-generator-story-select" disabled={busy} onClick={() => { setDraftStoryIds(selectedRequirementIds); setStorySearch(""); setStoryPickerOpen(true); }} type="button"><span>{selectedStories.length === 1 ? `${selectedStory?.display_id || selectedStory?.id}: ${selectedStory?.title}` : selectedStories.length > 1 ? `${selectedStories.length} Stories selected` : "Choose a Story"}</span><IconChevronDown size={17} /></button>
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
              <AiPromptContextPanel additionalContext={additionalContext} appTypeId={promptTemplateAppTypeId} disabled={busy} externalLinksText={externalLinksText} onAddImages={onAddImages} onAdditionalContextChange={onAdditionalContextChange} onBusyChange={setContextBusy} onExternalLinksTextChange={onExternalLinksTextChange} onRemoveImage={onRemoveImage} promptScope="test_case_generation" projectId={promptTemplateProjectId} referenceImages={referenceImages} referenceUploadPresentation="dropzone" requirements={selectedStories} showPromptEditor />
            </section>
            <section className="ai-test-generator-section">
              <div className="ai-test-generator-section__heading"><span>Intelligence Engine</span><small>{currentIntegration?.name || "Configured provider"}</small></div>
              <div className="ai-test-generator-engines" role="radiogroup" aria-label="Intelligence engine">{integrations.map((engine, index) => <label className={engine.id === (integrationId || integrations[0]?.id) ? "is-selected" : ""} key={engine.id}><input checked={engine.id === (integrationId || integrations[0]?.id)} disabled={busy} name="ai-test-generator-engine" onChange={() => onIntegrationIdChange(engine.id)} type="radio" /><span><strong>{engine.name}</strong><small>{index === 0 ? "Recommended" : engine.type}</small></span>{index === 0 ? <IconSparkles size={15} /> : null}</label>)}</div>
              <label className="ai-test-generator-count">Draft count<select disabled={busy} onChange={(event) => onMaxCasesChange(Number(event.target.value))} value={maxCases}>{[1, 2, 3].map((count) => <option key={count} value={count}>{count}</option>)}</select></label>
              {onParallelRequirementCountChange ? <label className="ai-test-generator-count">Stories in parallel<input disabled={busy} max="5" min="1" onChange={(event) => onParallelRequirementCountChange(Number(event.target.value) || 1)} type="number" value={parallelRequirementCount || 1} /></label> : null}
            </section>
          </aside>

          <main className="ai-test-generator-workspace">
            <div className="ai-test-generator-workspace__header">
              <div className="ai-test-generator-workspace__identity">
                <div><h2>Test Case Drafts</h2><p>Review, refine, and accept only the coverage you want.</p></div>
                <span>{previewCases.length} Generated</span>
              </div>
              <div className="ai-test-generator-view-controls">
                <div aria-label="Test Case authoring format" className="ai-test-generator-authoring-tabs" role="radiogroup">
                  <button aria-checked={authoringMode === "structured"} className={authoringMode === "structured" ? "is-active" : ""} disabled={busy} onClick={() => changeMode("structured")} role="radio" type="button"><IconListDetails size={15} />Structured</button>
                  <button aria-checked={authoringMode === "gherkin"} className={authoringMode === "gherkin" ? "is-active" : ""} disabled={busy} onClick={() => changeMode("gherkin")} role="radio" type="button"><IconBraces size={15} />Gherkin</button>
                </div>
                <div className="ai-test-generator-view-toggle" role="group"><button aria-label="List view" aria-pressed={viewMode === "list"} onClick={() => setViewMode("list")} type="button"><IconListDetails size={18} /></button><button aria-label="Grid view" aria-pressed={viewMode === "grid"} onClick={() => setViewMode("grid")} type="button"><IconLayoutGrid size={18} /></button></div>
              </div>
            </div>
            <div className="ai-test-generator-selection-bar"><label><input checked={Boolean(visibleDrafts.length) && visibleDrafts.every((item) => selectedIds.includes(item.client_id))} disabled={!visibleDrafts.length || busy} onChange={(event) => setSelectedIds((current) => event.target.checked ? [...new Set([...current, ...visibleDrafts.map((item) => item.client_id)])] : current.filter((id) => !visibleDrafts.some((item) => item.client_id === id)))} type="checkbox" />Select all</label><button disabled={!selectedIds.length || busy} onClick={() => setSelectedIds([])} type="button"><SelectionToggleIcon checked={false} />Clear selection</button><span>{authoringMode === "gherkin" ? "Gherkin feature drafts" : "Structured action and result steps"}</span></div>
            <div className={`ai-test-generator-toast${previewMessage ? " has-message" : ""}`}>
              {previewMessage ? <ToastMessage message={previewMessage} onDismiss={onPreviewMessageDismiss} tone={previewTone} /> : null}
            </div>

            <div className={`ai-test-generator-drafts is-${viewMode}`}>
              {!previewCases.length ? <div className="ai-test-generator-empty"><IconSparkles size={34} /><h3>Ready to generate {authoringMode === "gherkin" ? "Gherkin" : "structured"} drafts</h3><p>Select Story evidence, choose an intelligence engine, and add coverage constraints.</p><button className="primary-button" disabled={disablePreview || busy} onClick={() => onPreview(authoringMode)} type="button">{isPreviewing ? "Generating…" : "Generate drafts"}</button></div> : null}
              {visibleDrafts.map((draft, draftIndex) => {
                const expanded = expandedIds.includes(draft.client_id);
                const editing = editingIds.includes(draft.client_id);
                const draftMode = draft.authoring_mode || authoringMode;
                return <article className={`ai-test-generator-draft${expanded ? " is-expanded" : ""}`} key={draft.client_id}>
                  <header>
                    <input aria-label={`Select ${draft.title}`} checked={selectedIds.includes(draft.client_id)} disabled={busy} onChange={(event) => setSelectedIds((current) => event.target.checked ? [...new Set([...current, draft.client_id])] : current.filter((id) => id !== draft.client_id))} type="checkbox" />
                    <span className={`ai-test-generator-priority p${draft.priority}`}>P{draft.priority}</span>
                    <div className="ai-test-generator-draft__identity">{editing ? <input aria-label="Test case title" maxLength={255} onChange={(event) => updateDraft(draft, { title: event.target.value })} value={draft.title} /> : <button onClick={() => toggleFrom(setExpandedIds, draft.client_id)} type="button"><strong>{draft.title}</strong><small>{draft.step_count} {draftMode === "gherkin" ? "scenario lines" : `step${draft.step_count === 1 ? "" : "s"}`} · {draft.requirement_ids.length} Story link{draft.requirement_ids.length === 1 ? "" : "s"}</small></button>}</div>
                    <span className="ai-test-generator-ai-badge"><IconSparkles size={13} />AI Draft</span>
                    {onPreviewCaseChange ? <button aria-label={editing ? "Finish editing draft" : "Edit draft"} disabled={busy} onClick={() => { setExpandedIds((current) => current.includes(draft.client_id) ? current : [...current, draft.client_id]); toggleFrom(setEditingIds, draft.client_id); }} type="button">{editing ? <IconCheck size={18} /> : <IconEdit size={18} />}</button> : null}
                    <button aria-label="Delete draft" disabled={busy} onClick={() => onRemovePreviewCase(draft.client_id)} type="button"><IconTrash size={18} /></button><button aria-label={expanded ? "Collapse draft" : "Expand draft"} onClick={() => toggleFrom(setExpandedIds, draft.client_id)} type="button">{expanded ? <IconChevronUp size={18} /> : <IconChevronDown size={18} />}</button>
                  </header>
                  {expanded ? <div className="ai-test-generator-draft__body">
                    {editing ? <div className="ai-test-generator-draft-fields"><label>Description<textarea onChange={(event) => updateDraft(draft, { description: event.target.value })} rows={2} value={draft.description || ""} /></label><label>Priority<select onChange={(event) => updateDraft(draft, { priority: Number(event.target.value) })} value={draft.priority}>{[1, 2, 3, 4, 5].map((priority) => <option key={priority} value={priority}>P{priority}</option>)}</select></label></div> : draft.description ? <p className="ai-test-generator-draft-description">{plainText(draft.description)}</p> : null}
                    {draftMode === "gherkin" ? <GherkinEditor compact featureTitle={draft.title} onChange={(document) => updateDraft(draft, { authoring_mode: "gherkin", gherkin_document: document })} parameterValues={draft.parameter_values} readOnly={!editing} value={gherkinFor(draft)} /> : <div className="ai-test-generator-step-table"><div className="ai-test-generator-step-table__head"><span>Step</span><span>Action</span><span>Expected Result</span><span /></div>{draft.steps.map((step, stepIndex) => <div className="ai-test-generator-step-row" key={`${draft.client_id}:${stepIndex}`}><span>{stepIndex + 1}</span>{editing ? <textarea aria-label={`Step ${stepIndex + 1} action`} onChange={(event) => updateDraft(draft, { steps: draft.steps.map((item, index) => index === stepIndex ? { ...item, action: event.target.value } : item) })} rows={2} value={step.action || ""} /> : <p>{step.action || "Add an action"}</p>}{editing ? <textarea aria-label={`Step ${stepIndex + 1} expected result`} onChange={(event) => updateDraft(draft, { steps: draft.steps.map((item, index) => index === stepIndex ? { ...item, expected_result: event.target.value } : item) })} rows={2} value={step.expected_result || ""} /> : <p>{step.expected_result || "Add an expected result"}</p>}{editing ? <button aria-label={`Remove step ${stepIndex + 1}`} onClick={() => { const steps = draft.steps.filter((_, index) => index !== stepIndex).map((item, index) => ({ ...item, step_order: index + 1 })); updateDraft(draft, { steps, step_count: steps.length }); }} type="button"><IconTrash size={15} /></button> : <span />}</div>)}{editing ? <button className="ai-test-generator-add-step" onClick={() => { const steps = [...draft.steps, { step_order: draft.steps.length + 1, step_type: "web" as const, action: "", expected_result: "" }]; updateDraft(draft, { steps, step_count: steps.length }); }} type="button"><IconPlus size={16} />Add step</button> : null}</div>}
                    {selectedStories.length > 1 ? <div className="ai-test-generator-traceability"><span>Story traceability</span>{selectedStories.map((story) => <button className={draft.requirement_ids.includes(story.id) ? "is-linked" : ""} disabled={!onTogglePreviewRequirement || busy} key={story.id} onClick={() => onTogglePreviewRequirement?.(draft.client_id, story.id)} type="button">{draft.requirement_ids.includes(story.id) ? <IconCheck size={13} /> : <IconPlus size={13} />}{story.display_id || story.title}</button>)}</div> : null}
                  </div> : null}<span className="sr-only">Draft {draftIndex + 1}</span>
                </article>;
              })}
              {previewCases.length && !visibleDrafts.length ? <div className="ai-test-generator-empty"><IconSearch size={30} /><h3>No matching drafts</h3><p>Clear or change the search to see generated cases.</p></div> : null}
              {existingCases.length ? <details className="ai-test-generator-existing"><summary><span><strong>{existingCasesTitle}</strong><small>{existingCasesSubtitle}</small></span><span>{existingCases.length}</span></summary><div>{existingCases.slice(0, 8).map((testCase) => <button disabled={!onViewExistingCase} key={testCase.id} onClick={() => onViewExistingCase?.(testCase.id)} type="button"><strong>{testCase.title}</strong><span>{testCase.step_count || 0} steps</span></button>)}</div></details> : null}
            </div>
            <footer className="ai-test-generator-footer"><strong>{selectedCount} Selected</strong><div>{previewCases.length ? <button disabled={busy} onClick={() => previewCases.forEach((draft) => onRemovePreviewCase(draft.client_id))} type="button">Decline all</button> : null}{onSchedule ? <span><button disabled={disableSchedule || busy} onClick={() => onSchedule(authoringMode)} type="button"><IconCalendarTime size={17} />{isScheduling ? "Scheduling…" : "Schedule"}</button><InfoTooltip content={scheduleHelperText || "Queue generation for the selected Stories. Generated cases return as reviewable drafts."} label="Scheduled generation information" /></span> : null}<button disabled={disablePreview || busy} onClick={() => onPreview(authoringMode)} type="button"><IconRefresh size={17} />{isPreviewing ? "Generating…" : previewCases.length ? "Regenerate" : "Generate"}</button>{previewCases.length ? <button className="primary-button" disabled={disableAccept || !selectedCount || invalidSelectedDraft || busy} onClick={() => onAccept(selectedIds)} title={invalidSelectedDraft ? "Complete the selected draft title and required test content before accepting." : undefined} type="button"><IconLibraryPlus size={17} />{isAccepting ? "Accepting…" : `${acceptLabel} (${selectedCount})`}</button> : null}</div></footer>
          </main>

          {intelligenceOpen ? <aside aria-label="AI generation intelligence status" className="ai-test-generator-intelligence">
            <div className="ai-test-generator-pane-title"><IconChartDonut size={19} /><div><strong>Intelligence Status</strong><span>Live validation of this draft set.</span></div></div>
            <section className="ai-test-generator-confidence"><div aria-label={`${confidence}% confidence`} className="ai-test-generator-confidence__ring" style={{ "--confidence": `${confidence * 3.6}deg` } as CSSProperties}><strong>{confidence}<small>%</small></strong></div><h3>{confidenceLabel}</h3><p>{previewCases.length ? `${completeCount} of ${previewCases.length} drafts pass current structure checks.` : "Generate drafts to calculate grounding and structure confidence."}</p></section>
            <section className="ai-test-generator-analysis"><h3><IconDatabase size={17} />Grounding Analysis</h3><ul>
              <li className={selectedRequirementIds.length ? "is-complete" : ""}><span>{selectedRequirementIds.length ? <IconCheck size={14} /> : "1"}</span><div><strong>Story Brief Parsed</strong><small>{selectedRequirementIds.length ? `${selectedRequirementIds.length} selected Story context${selectedRequirementIds.length === 1 ? "" : "s"}` : "Select Story context"}</small></div></li>
              <li className={additionalContext.trim() || linkCount || referenceImages.length ? "is-complete" : ""}><span>{additionalContext.trim() || linkCount || referenceImages.length ? <IconCheck size={14} /> : "2"}</span><div><strong>Sources Grounded</strong><small>{linkCount} links · {referenceImages.length} images · {additionalContext.trim() ? "instructions added" : "no extra instructions"}</small></div></li>
              <li className={completeCount === previewCases.length && previewCases.length ? "is-complete" : ""}><span>{completeCount === previewCases.length && previewCases.length ? <IconCheck size={14} /> : "3"}</span><div><strong>{authoringMode === "gherkin" ? "Gherkin Syntax Checked" : "Step Quality Checked"}</strong><small>{completeCount} valid draft{completeCount === 1 ? "" : "s"}</small></div></li>
              <li className={previewCases.length && duplicateCount === 0 ? "is-complete" : ""}><span>{previewCases.length && duplicateCount === 0 ? <IconCheck size={14} /> : "4"}</span><div><strong>Conflict Check</strong><small>{duplicateCount ? `${duplicateCount} matching existing title${duplicateCount === 1 ? "" : "s"}` : previewCases.length ? "No exact existing-title match" : "Awaiting drafts"}</small></div></li>
            </ul></section>
            <section className="ai-test-generator-session"><h3><IconHistory size={17} />Session Log</h3><ol>{previewCases.length ? <li><span /><div><strong>Drafts generated</strong><small>{previewCases.length} {authoringMode} · {currentIntegration?.name || "configured provider"}</small></div></li> : null}<li><span /><div><strong>Context synced</strong><small>{selectedRequirementIds.length} Stories · {linkCount + referenceImages.length} attachments</small></div></li><li><span /><div><strong>{appTypeName}</strong><small>Application scope loaded</small></div></li></ol></section>
            <section className="ai-test-generator-sources"><span><IconFile size={15} />{referenceImages.length} visual references</span><span><IconExternalLink size={15} />{linkCount} external links</span></section>
          </aside> : null}
        </div>
        <footer className="ai-test-generator-status-footer">
          <span>© {new Date().getFullYear()} HelloTest QA Intelligence</span>
          <div>
            <span>API Status</span>
            <span>Model: {currentIntegration?.model || currentIntegration?.name || "Configured provider"}</span>
            <span>Human-reviewed output</span>
          </div>
        </footer>
      </div>
    </div>
    {storyPicker && typeof document !== "undefined" ? createPortal(storyPicker, document.body) : storyPicker}
  </>;
}
