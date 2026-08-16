import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  IconBold,
  IconBulb,
  IconChecklist,
  IconChevronDown,
  IconCode,
  IconGauge,
  IconItalic,
  IconList,
  IconPlus,
  IconRosetteDiscountCheck,
  IconSparkles,
  IconTrash
} from "@tabler/icons-react";
import { AiEvidenceButton, AiEvidenceFlyout } from "./AgenticExperience";
import type { AiStoryEvidenceSource } from "../lib/api";
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
  activeDraftId,
  allowSelection = true,
  drafts,
  emptyMessage = "Add prompt context, then generate Story drafts for review.",
  emptyHeading = "Ready for a governed draft",
  itemNoun = "draft",
  isDraftSelectable,
  onActivateDraft,
  onClearSelection,
  onSelectAll,
  onToggleDraft,
  queueTitle = "Draft Queue",
  selectAllLabel = "Select all",
  selectedDraftIds
}: {
  activeDraftId?: string;
  allowSelection?: boolean;
  drafts: StoryAiStudioDraft[];
  emptyMessage?: string;
  emptyHeading?: string;
  itemNoun?: string;
  isDraftSelectable?: (draft: StoryAiStudioDraft) => boolean;
  onActivateDraft: (draftId: string) => void;
  onClearSelection?: () => void;
  onSelectAll?: (selected: boolean) => void;
  onToggleDraft?: (draftId: string, selected: boolean) => void;
  queueTitle?: string;
  selectAllLabel?: string;
  selectedDraftIds: string[];
}) {
  const selectableDrafts = drafts.filter((draft) => allowSelection && (isDraftSelectable?.(draft) ?? true));
  const allSelected = Boolean(selectableDrafts.length) && selectableDrafts.every((draft) => selectedDraftIds.includes(draft.id));

  return (
    <section className="story-studio-queue" aria-label="Draft queue">
      <header className="story-studio-queue__toolbar">
        <div><h2>{queueTitle}</h2><span>{drafts.length} {drafts.length === 1 ? itemNoun : `${itemNoun}s`}</span></div>
        {selectableDrafts.length ? (
          <div className="story-studio-queue__selection">
            <label>
              <input checked={allSelected} onChange={(event) => onSelectAll?.(event.target.checked)} type="checkbox" />
              <span>{selectAllLabel}</span>
            </label>
            {selectedDraftIds.length ? <button onClick={onClearSelection} type="button">Clear</button> : null}
          </div>
        ) : null}
      </header>
      <div className="story-studio-queue__list" role="list">
        {drafts.length ? drafts.map((draft) => {
          const isActive = draft.id === activeDraftId;
          const isSelected = selectedDraftIds.includes(draft.id);
          const isSelectable = allowSelection && (isDraftSelectable?.(draft) ?? true);
          const rawConfidence = draft.confidenceLabel
            || (Number.isFinite(draft.qualityPercent) ? `${Math.round(draft.qualityPercent || 0)}% Conf.` : draft.generated ? "AI Generated" : "Existing Story");
          const usesNumericConfidenceLabel = /\b\d{1,3}%\s*(?:conf|confidence|quality)\b/i.test(rawConfidence);
          const confidence = usesNumericConfidenceLabel ? "Review required" : rawConfidence;
          return (
            <article
              aria-current={isActive ? "true" : undefined}
              className={isActive ? "story-studio-draft-tile is-active" : "story-studio-draft-tile"}
              key={draft.id}
              role="listitem"
            >
              <input
                aria-label={`Select ${draft.title}`}
                checked={isSelected}
                disabled={!isSelectable}
                onChange={(event) => onToggleDraft?.(draft.id, event.target.checked)}
                type="checkbox"
              />
              <button
                aria-pressed={isActive}
                className="story-studio-draft-tile__activation"
                onClick={() => onActivateDraft(draft.id)}
                type="button"
              >
                <h3>{draft.title}</h3>
                <div className="story-studio-draft-tile__meta">
                  <span><IconGauge size={14} stroke={1.9} />{draft.estimateLabel || `P${draft.priority || 3} Priority`}</span>
                  <span><IconRosetteDiscountCheck size={14} stroke={1.9} />{confidence}</span>
                </div>
              </button>
            </article>
          );
        }) : (
          <div className="story-studio-queue__empty">
            <IconSparkles size={24} stroke={1.7} />
            <strong>{emptyHeading}</strong>
            <span>{emptyMessage}</span>
          </div>
        )}
      </div>
    </section>
  );
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
  editable = false,
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
  showGherkin = true,
  showProperties = true,
  statusContent
}: {
  draft?: StoryAiStudioDraft | null;
  editable?: boolean;
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
  showGherkin?: boolean;
  showProperties?: boolean;
  statusContent?: ReactNode;
}) {
  const descriptionRef = useRef<HTMLTextAreaElement>(null);
  const [editingScenarioIndex, setEditingScenarioIndex] = useState<number | null>(null);
  const [isEvidenceOpen, setIsEvidenceOpen] = useState(false);

  useEffect(() => {
    setEditingScenarioIndex(null);
    setIsEvidenceOpen(false);
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
    humanEditedFields.size ? `Human-edited fields are not covered by the original AI evidence or evaluation: ${[...humanEditedFields].map((field) => field.replace(/_/g, " ")).join(", ")}.` : ""
  ].filter(Boolean))];
  const evidenceByRef = new Map(evidence.map((item) => [item.ref, item]));
  const fieldEvidence = activeFieldEvidence
    .map(([field, refs]) => ({ field, refs: [...new Set(refs)].filter((ref) => evidenceByRef.has(ref)) }))
    .filter((item) => item.refs.length);
  const hasEvidenceReview = Boolean(evidence.length || limitations.length || draft.evaluation || humanEditedFields.size);

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
        </div>
        {hasEvidenceReview ? (
          <AiEvidenceButton
            className="story-studio-evidence-trigger"
            count={citedEvidence.length || evidence.length}
            label={citedEvidence.length ? "View cited evidence" : "View evidence boundary"}
            onClick={() => setIsEvidenceOpen(true)}
          />
        ) : null}
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
      </header>

      <section className="story-studio-card story-studio-description-card">
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

      {fieldSelection.length ? (
        <section className="story-studio-card story-studio-field-review">
          <div className="story-studio-card__section-heading">
            <h2><IconChecklist size={20} stroke={1.9} />Apply reviewed fields</h2>
            <span>Only checked changes will update the selected Jira Story.</span>
          </div>
          <div className="story-studio-field-review__grid">
            {fieldSelection.map((field) => (
              <label key={field.key}>
                <input checked={field.checked} disabled={fieldSelectionDisabled} onChange={(event) => onFieldSelectionChange?.(field.key, event.target.checked)} type="checkbox" />
                <span><strong>{field.label}</strong><small>{field.value || "No suggestion"}</small></span>
              </label>
            ))}
          </div>
        </section>
      ) : null}

      {showProperties ? (
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

      {showGherkin ? (
        <details className="story-studio-card story-studio-disclosure-card story-studio-gherkin-card">
          <summary><span><strong><IconChecklist size={18} stroke={1.9} />Gherkin scenarios</strong><small>{scenarios.length} scenario{scenarios.length === 1 ? "" : "s"} ready for review</small></span><IconChevronDown aria-hidden="true" size={17} stroke={1.9} /></summary>
          <div className="story-studio-disclosure-actions">
            <button
              className="story-studio-inline-action"
              disabled={!editable || !onGherkinScenariosChange}
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
            const isEditing = editable && editingScenarioIndex === index;
            return (
              <article className={isEditing ? "story-studio-scenario is-editing" : "story-studio-scenario"} key={`${draft.id}-scenario-${index}`}>
                <div className="story-studio-scenario__heading">
                  <h3>{parsed.title}</h3>
                  {editable && onGherkinScenariosChange ? (
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
            <div className="story-studio-gherkin-card__empty">No Gherkin scenario is available yet. Generate or regenerate with Include Gherkin enabled.</div>
          )}
        </details>
      ) : null}

      {draft.rationale || draft.changeSummary?.length || draft.risks?.length || draft.openQuestions?.length ? (
        <details className="story-studio-card story-studio-disclosure-card story-studio-rationale-card">
          <summary><span><strong><IconBulb size={18} stroke={1.9} />Review notes</strong><small>Rationale, risks, and open questions</small></span><IconChevronDown aria-hidden="true" size={17} stroke={1.9} /></summary>
          <div className="story-studio-rationale-card__body">
            <p>{draft.rationale || draft.changeSummary?.join(" ") || "Generated from the supplied bounded context."}</p>
            {draft.risks?.length || draft.openQuestions?.length ? (
              <div className="story-studio-rationale-card__notes">
                {draft.risks?.length ? <div><strong>Risks</strong><span>{draft.risks.join(" ")}</span></div> : null}
                {draft.openQuestions?.length ? <div><strong>Open questions</strong><span>{draft.openQuestions.join(" ")}</span></div> : null}
              </div>
            ) : null}
          </div>
        </details>
      ) : null}

      {extraContent ? <div className="story-studio-inspector__extra">{extraContent}</div> : null}

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
      >
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
      </AiEvidenceFlyout>
    </div>
  );
}
