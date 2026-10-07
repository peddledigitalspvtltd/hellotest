import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  IconBold,
  IconChecklist,
  IconChevronDown,
  IconCode,
  IconItalic,
  IconList,
  IconPlus,
  IconSparkles,
  IconTrash
} from "@tabler/icons-react";
import { AiEvidenceButton, AiEvidenceFlyout } from "@hellotest/agentic/frontend/components/AgenticExperience";
import { AiProposalCompare } from "./AiProposalCompare";
import { SelectionToggleIcon } from "@hellotest/platform/frontend/src/platform/components/AppIcons";
import type { AiStoryEvidenceSource } from "@hellotest/platform/frontend/src/lib/api";
import "./StoryAiStudioContent.css";

export type StoryAiStudioDraft = {
  id: string;
  sequence?: number;
  title: string;
  description: string;
  acceptanceCriteria?: string[];
  gherkinScenarios?: string[];
  estimateLabel?: string;
  confidenceLabel?: string;
  qualityPercent?: number;
  displayId?: string | null;
  generated?: boolean;
  status?: string | null;
  priority?: number | null;
  labels?: string[];
  sprint?: string | null;
  release?: string | null;
  externalReferences?: string[];
  risks?: string[];
  openQuestions?: string[];
  rationale?: string;
  changeSummary?: string[];
  evidence?: AiStoryEvidenceSource[];
  evidenceRefs?: string[];
  limitations?: string[];
  fallbackReason?: string | null;
  contextReductionReason?: string | null;
  generationMode?: string;
  evaluation?: { score: number; grounding: string; completeness: string; testability: string };
  fieldEvidence?: Record<string, string[]>;
  humanEditedFields?: string[];
  requestId?: string;
  inputFingerprint?: string;
};

export type StoryAiStudioFieldSelection = {
  key: string;
  label: string;
  value: string;
  checked: boolean;
};

export function StoryAiDraftQueue({
  activeDraftId, activeContent, allowSelection = true, drafts, itemNoun = "Story", itemMeta, queueTitle, searchQuery = "", viewMode = "list",
  emptyMessage = "Add prompt context, then generate Story drafts for review.",
  emptyHeading = "Ready to generate Story drafts", isDraftSelectable, onActivateDraft,
  onClearSelection, onSelectAll, onToggleDraft, selectedDraftIds, selectAllLabel = "Select all"
}: {
  activeDraftId?: string;
  activeContent?: ReactNode;
  allowSelection?: boolean;
  drafts: StoryAiStudioDraft[];
  searchQuery?: string;
  viewMode?: string;
  emptyMessage?: string;
  emptyHeading?: string;
  itemNoun?: string;
  itemMeta?: string;
  queueTitle?: string;
  isDraftSelectable?: (draft: StoryAiStudioDraft) => boolean;
  onActivateDraft: (draftId: string) => void;
  onClearSelection?: () => void;
  onSelectAll?: (selected: boolean) => void;
  onToggleDraft?: (draftId: string, selected: boolean) => void;
  selectAllLabel?: string;
  selectedDraftIds: string[];
}) {
  const selectableDrafts = drafts.filter(draft => allowSelection && (isDraftSelectable?.(draft) ?? true));
  const allSelected = Boolean(selectableDrafts.length) && selectableDrafts.every(draft => selectedDraftIds.includes(draft.id));
  const visibleDrafts = drafts.filter(draft => `${draft.title} ${draft.description}`.toLowerCase().includes(searchQuery.toLowerCase().trim()));
  useEffect(() => {
    if (visibleDrafts.length && !visibleDrafts.some(draft => draft.id === activeDraftId)) onActivateDraft(visibleDrafts[0].id);
  }, [activeDraftId, visibleDrafts, onActivateDraft]);
  return <section className="story-studio-queue" aria-label={queueTitle || `${itemNoun} drafts`}>
    {!drafts.length ? activeContent || <div className="ai-test-generator-empty"><IconSparkles size={32} /><h3>{emptyHeading}</h3><p>{emptyMessage}</p></div> : null}
    {drafts.length && !visibleDrafts.length ? <div className="ai-test-generator-empty"><h3>No matching drafts</h3><p>Change the search to see the generated drafts.</p></div> : null}
    {visibleDrafts.length ? <div className="ai-artifact-workspace">
      <nav aria-label={`${itemNoun} proposal outline`} className="ai-artifact-outline">
        <div className="ai-artifact-outline__tools">
          {allowSelection ? <><label><input checked={allSelected} disabled={!selectableDrafts.length || !onSelectAll} onChange={event => onSelectAll?.(event.target.checked)} type="checkbox" />{selectAllLabel}</label><button disabled={!selectedDraftIds.length} onClick={onClearSelection} type="button">Clear selection</button></> : <strong>{drafts.length} proposal{drafts.length === 1 ? "" : "s"}</strong>}
        </div>
        {visibleDrafts.map((draft, index) => <article aria-current={draft.id === activeDraftId ? "true" : undefined} className="story-studio-draft-tile ai-artifact-item" key={draft.id}>
          {allowSelection ? <input aria-label={`Select ${draft.title}`} checked={selectedDraftIds.includes(draft.id)} disabled={!(isDraftSelectable?.(draft) ?? true)} onChange={event => onToggleDraft?.(draft.id, event.target.checked)} type="checkbox" /> : null}
          <button aria-current={draft.id === activeDraftId ? "true" : undefined} onClick={() => onActivateDraft(draft.id)} onKeyDown={event => {
            const next = event.key === "ArrowDown" ? index + 1 : event.key === "ArrowUp" ? index - 1 : event.key === "Home" ? 0 : event.key === "End" ? visibleDrafts.length - 1 : -1;
            if (next >= 0 && next < visibleDrafts.length) { event.preventDefault(); onActivateDraft(visibleDrafts[next].id); event.currentTarget.closest("nav")?.querySelectorAll<HTMLButtonElement>(".ai-artifact-item > button")[next]?.focus(); }
          }} type="button"><strong>{draft.title || "Untitled proposal"}</strong><small>{itemMeta || `P${draft.priority || 3} · ${draft.acceptanceCriteria?.length || 0} criteria · ${draft.gherkinScenarios?.length || 0} scenarios`}</small></button>
        </article>)}
      </nav>
      {activeContent ? <article aria-label={`Review ${visibleDrafts.find(draft => draft.id === activeDraftId)?.title || itemNoun}`} className="ai-artifact-detail story-studio-inspector-scroll">{activeContent}</article> : null}
    </div> : null}
  </section>;
}

function splitGherkinScenario(rawScenario: string, index: number) {
  const lines = String(rawScenario || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const firstLine = lines[0] || "";
  const hasScenarioHeading = /^Scenario(?: Outline)?:/i.test(firstLine);
  return {
    title: hasScenarioHeading ? firstLine : `Scenario ${index + 1}`,
    steps: hasScenarioHeading ? lines.slice(1) : lines
  };
}

function GherkinStep({ line }: { line: string }) {
  const match = line.match(/^(Given|When|Then|And|But|\*)\b\s*(.*)$/i);
  if (!match) return <div>{line}</div>;
  return <div><strong>{match[1]}</strong><span>{match[2]}</span></div>;
}

function propertyValue(value: string | number | null | undefined) {
  return value === null || value === undefined || String(value).trim() === "" ? "Not set" : String(value);
}

export function StoryAiDraftInspector({
  draft,
  baseline,
  editable = false,
  evidencePlacement = "inspector",
  emptyAction,
  emptyContent,
  extraContent,
  fieldSelection = [],
  fieldSelectionDisabled = false,
  onAcceptanceCriteriaChange,
  onDescriptionChange,
  onFieldSelectionChange,
  onGherkinScenariosChange,
  onPriorityChange,
  onTitleChange,
  outputFormat = "structured",
  showGherkin = true,
  showProperties = true,
  statusContent
}: {
  draft?: StoryAiStudioDraft | null;
  baseline?: { title: string; description: string };
  editable?: boolean;
  evidencePlacement?: "inspector" | "intelligence";
  emptyAction?: ReactNode;
  emptyContent?: ReactNode;
  extraContent?: ReactNode;
  fieldSelection?: StoryAiStudioFieldSelection[];
  fieldSelectionDisabled?: boolean;
  onAcceptanceCriteriaChange?: (criteria: string[]) => void;
  onDescriptionChange?: (value: string) => void;
  onFieldSelectionChange?: (key: string, checked: boolean) => void;
  onGherkinScenariosChange?: (scenarios: string[]) => void;
  onPriorityChange?: (priority: number) => void;
  onTitleChange?: (value: string) => void;
  outputFormat?: "structured" | "gherkin";
  showGherkin?: boolean;
  showProperties?: boolean;
  statusContent?: ReactNode;
}) {
  const descriptionRef = useRef<HTMLTextAreaElement>(null);
  const [editingScenarioIndex, setEditingScenarioIndex] = useState<number | null>(null);
  const [comparing, setComparing] = useState(false);

  useEffect(() => {
    setEditingScenarioIndex(null);
    setComparing(false);
  }, [draft?.id]);

  if (!draft) {
    return (
      <div className="story-studio-inspector-empty">
        {statusContent}
        {emptyContent || (
          <>
            <IconSparkles size={28} stroke={1.7} />
            <h2>Your Story draft will appear here</h2>
            <p>Add focused context, choose a governed provider, and generate a bounded review batch.</p>
          </>
        )}
        {emptyAction}
      </div>
    );
  }

  const criteria = draft.acceptanceCriteria || [];
  const scenarios = draft.gherkinScenarios || [];
  const references = draft.externalReferences || [];
  const labels = draft.labels || [];
  const details = [
    ["Status", propertyValue(draft.status)],
    ["Sprint", propertyValue(draft.sprint)],
    ["Release", propertyValue(draft.release)]
  ];
  const hasInvalidTitle = editable && (!draft.title.trim() || draft.title.length > 255);

  const applyMarkdown = (prefix: string, suffix = prefix, linePrefix = false) => {
    if (!editable || !onDescriptionChange) return;
    const textarea = descriptionRef.current;
    if (!textarea) return;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selected = draft.description.slice(start, end) || "text";
    const replacement = linePrefix
      ? selected.split("\n").map((line) => `${prefix}${line}`).join("\n")
      : `${prefix}${selected}${suffix}`;
    onDescriptionChange(`${draft.description.slice(0, start)}${replacement}${draft.description.slice(end)}`);
    window.requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(start, start + replacement.length);
    });
  };

  return (
    <div className="story-studio-inspector">
      {statusContent}
      <header className="story-studio-inspector__title">
        <div className="story-studio-inspector__badges">
          <span>{draft.generated ? `DRAFT #${draft.sequence || 1}` : draft.displayId || "SELECTED STORY"}</span>
          <span><IconSparkles size={14} stroke={1.9} />{draft.generated ? "AI Generated" : "Existing context"}</span>
          {baseline ? <button aria-pressed={comparing} className="ai-context-chip" onClick={() => setComparing(current => !current)} type="button">{comparing ? "Hide comparison" : "Compare changes"}</button> : null}
        </div>
        {evidencePlacement === "inspector" ? <StoryAiEvidenceReview draft={draft} /> : null}
        <section className="story-studio-card story-studio-title-card">
          <div className="story-studio-card__toolbar"><h2>Title</h2></div>
          <div className="story-studio-title-card__body">
        {editable && onTitleChange ? (
          <>
            <textarea
              aria-describedby={hasInvalidTitle ? `${draft.id}-title-error` : undefined}
              aria-invalid={hasInvalidTitle || undefined}
              aria-label="Story title"
              className="story-studio-inspector__title-input"
              maxLength={255}
              onChange={(event) => onTitleChange(event.target.value)}
              rows={draft.title.length > 50 ? 2 : 1}
              value={draft.title}
            />
            {hasInvalidTitle ? (
              <small className="story-studio-inspector__title-error" id={`${draft.id}-title-error`} role="alert">
                Enter a Story title between 1 and 255 characters.
              </small>
            ) : null}
          </>
        ) : <h1>{draft.title}</h1>}
          </div>
        </section>
      </header>
      {baseline && comparing ? <AiProposalCompare fields={[{ label: "Title", before: baseline.title, after: draft.title }, { label: "Description", before: baseline.description, after: draft.description }]} /> : null}

      {outputFormat === "structured" ? <><section className="story-studio-card story-studio-description-card">
        <div className="story-studio-card__toolbar">
          <h2>Description</h2>
          <div aria-label="Description formatting" className="story-studio-editor-tools" role="toolbar">
            <button aria-label="Bold" disabled={!editable} onClick={() => applyMarkdown("**")} type="button"><IconBold size={18} stroke={2.1} /></button>
            <button aria-label="Italic" disabled={!editable} onClick={() => applyMarkdown("_")} type="button"><IconItalic size={18} stroke={2.1} /></button>
            <button aria-label="Bulleted list" disabled={!editable} onClick={() => applyMarkdown("- ", "", true)} type="button"><IconList size={18} stroke={2.1} /></button>
            <span aria-hidden="true" />
            <button aria-label="Inline code" disabled={!editable} onClick={() => applyMarkdown("`")} type="button"><IconCode size={18} stroke={2.1} /></button>
          </div>
        </div>
        <div className="story-studio-description-card__body">
          <textarea
            aria-label="Story description"
            onChange={(event) => onDescriptionChange?.(event.target.value)}
            readOnly={!editable}
            ref={descriptionRef}
            rows={Math.max(3, Math.min(8, Math.ceil((draft.description.length || 80) / 90)))}
            placeholder="No description has been added yet."
            value={draft.description}
          />
          {criteria.length || editable && onAcceptanceCriteriaChange ? (
            <div className={criteria.length ? "story-studio-criteria" : "story-studio-criteria is-empty"}>
              <strong>Acceptance Criteria:</strong>
              {criteria.length ? (
                <ul>
                  {criteria.map((criterion, index) => (
                    <li key={`${draft.id}-criterion-${index}`}>
                      {editable && onAcceptanceCriteriaChange ? (
                        <>
                          <textarea
                            aria-label={`Acceptance criterion ${index + 1}`}
                            onChange={(event) => onAcceptanceCriteriaChange(criteria.map((item, itemIndex) => itemIndex === index ? event.target.value : item))}
                            placeholder="Describe a testable outcome"
                            rows={Math.max(1, Math.min(3, Math.ceil((criterion.length || 40) / 78)))}
                            value={criterion}
                          />
                          <button
                            aria-label={`Remove acceptance criterion ${index + 1}`}
                            className="story-studio-criterion-remove"
                            onClick={() => onAcceptanceCriteriaChange(criteria.filter((_, itemIndex) => itemIndex !== index))}
                            type="button"
                          >
                            <IconTrash size={15} stroke={1.9} />
                          </button>
                        </>
                      ) : <span>{criterion}</span>}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="story-studio-criteria__empty">No acceptance criteria yet.</p>
              )}
              {editable && onAcceptanceCriteriaChange ? (
                <button
                  className="story-studio-inline-action story-studio-criteria-add"
                  onClick={() => onAcceptanceCriteriaChange([...criteria, ""])}
                  type="button"
                >
                  <IconPlus size={15} stroke={2} />Add criterion
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      </section>

      </> : null}

      {fieldSelection.length ? (
        <section className="story-studio-card story-studio-field-review">
          <div className="story-studio-card__section-heading">
            <h2><IconChecklist size={20} stroke={1.9} />Apply reviewed fields</h2>
            <span>Only checked changes will update the selected Story.</span>
          </div>
          <div className="story-studio-field-review__grid">
            {fieldSelection.map((field) => (
              <label key={field.key}>
                <input checked={field.checked} disabled={fieldSelectionDisabled} onChange={(event) => onFieldSelectionChange?.(field.key, event.target.checked)} type="checkbox" />
                <span><strong>{field.label}</strong></span>
              </label>
            ))}
          </div>
        </section>
      ) : null}

      {showProperties && outputFormat === "structured" ? (
        <details className="story-studio-card story-studio-disclosure-card story-studio-properties-card">
          <summary><span><strong>Story properties</strong><small>Status, priority, delivery scope, and references</small></span><IconChevronDown aria-hidden="true" size={17} stroke={1.9} /></summary>
          <dl>
            <div><dt>Status</dt><dd>{propertyValue(draft.status)}</dd></div>
            <div>
              <dt>Priority</dt>
              <dd>
                {editable && onPriorityChange ? (
                  <select aria-label="Story priority" onChange={(event) => onPriorityChange(Number(event.target.value) || 3)} value={draft.priority || 3}>
                    <option value={1}>P1 · Critical</option>
                    <option value={2}>P2 · High</option>
                    <option value={3}>P3 · Medium</option>
                    <option value={4}>P4 · Low</option>
                    <option value={5}>P5 · Lowest</option>
                  </select>
                ) : `P${draft.priority || 3}`}
              </dd>
            </div>
            {details.slice(1).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
            {labels.length ? <div className="story-studio-property-wide"><dt>Labels</dt><dd>{labels.join(", ")}</dd></div> : null}
            {references.length ? <div className="story-studio-property-wide"><dt>References</dt><dd>{references.join(" · ")}</dd></div> : null}
          </dl>
        </details>
      ) : null}

      {outputFormat === "gherkin" ? (
        <details open className="story-studio-card story-studio-disclosure-card story-studio-gherkin-card">
          <summary><span><strong><IconChecklist size={18} stroke={1.9} />Gherkin scenarios</strong><small>{scenarios.length} scenario{scenarios.length === 1 ? "" : "s"} ready for review</small></span><IconChevronDown aria-hidden="true" size={17} stroke={1.9} /></summary>
          {!showGherkin ? <p className="story-studio-gherkin-inclusion-note">Enable Include Gherkin in Context Setup to edit and save scenarios.</p> : null}
          <div className="story-studio-disclosure-actions">
            <button
              className="story-studio-inline-action"
              disabled={!showGherkin || !editable || !onGherkinScenariosChange}
              onClick={() => {
                const nextIndex = scenarios.length;
                onGherkinScenariosChange?.([
                  ...scenarios,
                  "Scenario: New scenario\nGiven the user has the required context\nWhen the user completes the action\nThen the expected outcome is observable"
                ]);
                setEditingScenarioIndex(nextIndex);
              }}
              type="button"
            >
              <IconPlus size={16} stroke={2} />Add scenario
            </button>
          </div>
          {scenarios.length ? scenarios.map((scenario, index) => {
            const parsed = splitGherkinScenario(scenario, index);
            const isEditing = showGherkin && editable && editingScenarioIndex === index;
            return (
              <article className={isEditing ? "story-studio-scenario is-editing" : "story-studio-scenario"} key={`${draft.id}-scenario-${index}`}>
                <div className="story-studio-scenario__heading">
                  <h3>{parsed.title}</h3>
                  {showGherkin && editable && onGherkinScenariosChange ? (
                    <div className="story-studio-scenario__actions">
                      <button onClick={() => setEditingScenarioIndex(isEditing ? null : index)} type="button">{isEditing ? "Done" : "Edit"}</button>
                      <button
                        aria-label={`Remove ${parsed.title}`}
                        className="is-danger"
                        onClick={() => {
                          onGherkinScenariosChange(scenarios.filter((_, scenarioIndex) => scenarioIndex !== index));
                          setEditingScenarioIndex(null);
                        }}
                        type="button"
                      >
                        <IconTrash size={15} stroke={1.9} />
                      </button>
                    </div>
                  ) : null}
                </div>
                {isEditing ? (
                  <textarea
                    aria-label={`Gherkin scenario ${index + 1}`}
                    onChange={(event) => onGherkinScenariosChange?.(scenarios.map((item, scenarioIndex) => scenarioIndex === index ? event.target.value : item))}
                    rows={Math.max(5, Math.min(12, scenario.split(/\r?\n/).length + 1))}
                    value={scenario}
                  />
                ) : (
                  <div className="story-studio-scenario__steps">{parsed.steps.map((line, lineIndex) => <GherkinStep key={`${line}-${lineIndex}`} line={line} />)}</div>
                )}
              </article>
            );
          }) : (
            <div className="story-studio-gherkin-card__empty">{showGherkin ? "No Gherkin scenario is available yet. Generate or regenerate with Include Gherkin enabled." : "Enable Include Gherkin in Context Setup, then generate scenarios from the supplied acceptance criteria."}</div>
          )}
        </details>
      ) : null}

      {extraContent ? <div className="story-studio-inspector__extra">{extraContent}</div> : null}


    </div>
  );
}

export function StoryAiEvidenceReview({ draft, inline = false }: { draft?: StoryAiStudioDraft | null; inline?: boolean }) {
  const [isEvidenceOpen, setIsEvidenceOpen] = useState(false);
  useEffect(() => setIsEvidenceOpen(false), [draft?.id]);
  if (!draft) return null;
  const evidence = draft.evidence || [];
  const humanEditedFields = new Set(draft.humanEditedFields || []);
  const activeFieldEvidence = Object.entries(draft.fieldEvidence || {})
    .filter(([field]) => !humanEditedFields.has(field));
  const activeFieldEvidenceRefs = activeFieldEvidence.flatMap(([, refs]) => refs);
  const evidenceRefs = new Set(humanEditedFields.size ? activeFieldEvidenceRefs : draft.evidenceRefs || []);
  const citedEvidence = evidenceRefs.size ? evidence.filter((item) => evidenceRefs.has(item.ref)) : [];
  const contextualEvidence = evidenceRefs.size ? evidence.filter((item) => !evidenceRefs.has(item.ref)) : evidence;
  const limitations = [...new Set([
    ...(draft.limitations || []),
    draft.fallbackReason || "",
    draft.contextReductionReason || "",
    humanEditedFields.size ? `Human-edited fields are not covered by the original AI evidence or evaluation: ${[...humanEditedFields].map((field) => field.replace(/_/g, " ")).join(", ")}.` : ""
  ].filter(Boolean))];
  const evidenceByRef = new Map(evidence.map((item) => [item.ref, item]));
  const fieldEvidence = activeFieldEvidence
    .map(([field, refs]) => ({ field, refs: [...new Set(refs)].filter((ref) => evidenceByRef.has(ref)) }))
    .filter((item) => item.refs.length);
  const hasEvidenceReview = Boolean(evidence.length || limitations.length || draft.evaluation || humanEditedFields.size);

  if (!hasEvidenceReview) return null;
  const content = <>
          {draft.evaluation && !humanEditedFields.size ? (
          <section className="story-studio-evidence-section">
            <header><strong>Deterministic readiness</strong><span>{draft.evaluation.score}/100</span></header>
            <dl>
              <div><dt>Grounding</dt><dd>{draft.evaluation.grounding}</dd></div>
              <div><dt>Completeness</dt><dd>{draft.evaluation.completeness}</dd></div>
              <div><dt>Testability</dt><dd>{draft.evaluation.testability}</dd></div>
            </dl>
          </section>
        ) : null}
        {citedEvidence.length ? (
          <section className="story-studio-evidence-section">
            <header><strong>Cited by this proposal</strong><span>{citedEvidence.length}</span></header>
            <ul>{citedEvidence.map((item) => (
              <li key={item.ref}>
                <span>{item.type.replace(/-/g, " ")}</span>
                <strong>{item.title || item.label}</strong>
                <p>{item.excerpt}</p>
              </li>
            ))}</ul>
          </section>
        ) : null}
        {fieldEvidence.length ? (
          <section className="story-studio-evidence-section story-studio-field-evidence">
            <header><strong>Field grounding</strong><span>{fieldEvidence.length}</span></header>
            <ul>{fieldEvidence.map(({ field, refs }) => (
              <li key={field}>
                <strong>{field.replace(/_/g, " ")}</strong>
                <div>{refs.map((ref) => <span key={ref}>{evidenceByRef.get(ref)?.title || ref}</span>)}</div>
              </li>
            ))}</ul>
          </section>
        ) : null}
        {humanEditedFields.size ? (
          <section className="story-studio-evidence-section is-limitation">
            <header><strong>Human-edited fields</strong><span>{humanEditedFields.size}</span></header>
            <p>{[...humanEditedFields].map((field) => field.replace(/_/g, " ")).join(", ")} changed after generation. Original citations are retained only as historical run context and do not verify the edited values.</p>
          </section>
        ) : null}
        {contextualEvidence.length ? (
          <section className="story-studio-evidence-section">
            <header><strong>{citedEvidence.length ? "Available but not cited" : "Available context"}</strong><span>{contextualEvidence.length}</span></header>
            <ul>{contextualEvidence.map((item) => (
              <li key={item.ref}>
                <span>{item.type.replace(/-/g, " ")}</span>
                <strong>{item.title || item.label}</strong>
                <p>{item.excerpt}</p>
                {item.limitation ? <em>{item.limitation}</em> : null}
              </li>
            ))}</ul>
          </section>
        ) : null}
        {limitations.length ? (
          <section className="story-studio-evidence-section is-limitation">
            <header><strong>Limitations to review</strong><span>{limitations.length}</span></header>
            <ul>{limitations.map((item) => <li key={item}><p>{item}</p></li>)}</ul>
          </section>
        ) : null}
</>;
  if (inline) return <section className="story-studio-intelligence-evidence" aria-label="Story cited evidence">
    <header><h3>Story Evidence</h3><span>{citedEvidence.length} cited {citedEvidence.length === 1 ? "source" : "sources"}</span></header>
    <p className="story-studio-intelligence-evidence__story">{draft.title}</p>
    {draft.contextReductionReason ? <p role="status" className="story-studio-intelligence-evidence__notice">{draft.contextReductionReason}</p> : null}
    {citedEvidence.length ? <ul className="story-studio-intelligence-evidence__sources">{citedEvidence.map(item => <li key={item.ref} title={item.excerpt || undefined}><strong>{item.title || item.label || item.ref}</strong><span>{item.type.replace(/-/g, " ")}</span></li>)}</ul> : <p>No source citation was returned for this proposal.</p>}
    <details key={draft.id}><summary>Sources and review boundaries</summary>{content}</details>
  </section>;
  return <><AiEvidenceButton className="story-studio-evidence-trigger" count={citedEvidence.length || evidence.length} label={citedEvidence.length ? "View cited evidence" : "View evidence boundary"} onClick={() => setIsEvidenceOpen(true)} />
      <AiEvidenceFlyout
        description={citedEvidence.length
          ? "These bounded sources were cited by this Story proposal. Context-only sources and limitations remain visible separately."
          : "No source citation was returned for this proposal. Review the available context and limitations before accepting it."}
        eyebrow="Story decision evidence"
        facts={[
          { label: "Cited sources", value: citedEvidence.length },
          { label: "Available context", value: evidence.length },
          { label: "Generation", value: draft.generationMode || "Not recorded" },
          { label: "Review state", value: "Awaiting human review" },
          ...(draft.requestId ? [{ label: "Run ID", value: draft.requestId.slice(0, 12) }] : []),
          ...(draft.inputFingerprint ? [{ label: "Input snapshot", value: draft.inputFingerprint.slice(0, 12) }] : [])
        ]}
        onClose={() => setIsEvidenceOpen(false)}
        open={isEvidenceOpen}
        title={`${draft.title || "Story draft"} evidence`}
      >{content}
      </AiEvidenceFlyout></>;
}
