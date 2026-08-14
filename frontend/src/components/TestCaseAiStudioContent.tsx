import { useRef, type ReactNode } from "react";
import {
  IconBold,
  IconChecklist,
  IconCode,
  IconItalic,
  IconList,
  IconPlus,
  IconSparkles,
  IconTrash
} from "@tabler/icons-react";
import { StepParameterizedText } from "./StepParameterizedText";
import "./TestCaseAiStudioContent.css";

export type TestCaseAiStudioStep = {
  stepOrder: number;
  stepType?: "web" | "api" | "android" | "ios" | null;
  action: string;
  expectedResult: string;
};

export type TestCaseAiStudioDraft = {
  id: string;
  sequence?: number;
  displayId?: string | null;
  generated: boolean;
  title: string;
  description: string;
  summary?: string;
  priority?: number | null;
  status?: string | null;
  automated?: "yes" | "no" | null;
  requirementIds?: string[];
  requirementTitles?: string[];
  parameterValues?: Record<string, string>;
  steps: TestCaseAiStudioStep[];
};

type TestCaseAiStudioDraftInspectorProps = {
  draft?: TestCaseAiStudioDraft | null;
  editable?: boolean;
  extraContent?: ReactNode;
  requirements?: Array<{ id: string; title: string }>;
  onDescriptionChange?: (value: string) => void;
  onOpenExisting?: () => void;
  onPriorityChange?: (value: number) => void;
  onRequirementToggle?: (requirementId: string) => void;
  onStepChange?: (index: number, next: TestCaseAiStudioStep) => void;
  onStepsChange?: (steps: TestCaseAiStudioStep[]) => void;
  onTitleChange?: (value: string) => void;
  statusContent?: ReactNode;
};

const propertyValue = (value: string | number | null | undefined) =>
  value === null || value === undefined || String(value).trim() === "" ? "Not set" : String(value);

export function TestCaseAiStudioDraftInspector({
  draft,
  editable = false,
  extraContent,
  requirements = [],
  onDescriptionChange,
  onOpenExisting,
  onPriorityChange,
  onRequirementToggle,
  onStepChange,
  onStepsChange,
  onTitleChange,
  statusContent
}: TestCaseAiStudioDraftInspectorProps) {
  const descriptionRef = useRef<HTMLTextAreaElement>(null);

  if (!draft) {
    return (
      <div className="story-studio-inspector-empty test-case-studio-empty">
        {statusContent}
        <IconSparkles aria-hidden="true" size={28} stroke={1.7} />
        <h2>Your test case draft will appear here</h2>
        <p>Choose Story evidence, add focused context, and generate a bounded batch for human review.</p>
      </div>
    );
  }

  const parameterEntries = Object.entries(draft.parameterValues || {}).sort(([left], [right]) => left.localeCompare(right));
  const normalizedParameters = Object.fromEntries(parameterEntries);
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
    <div className="story-studio-inspector test-case-studio-inspector">
      {statusContent}
      <header className="story-studio-inspector__title">
        <div className="story-studio-inspector__badges">
          <span>{draft.generated ? `DRAFT #${draft.sequence || 1}` : draft.displayId || "CURRENT CASE"}</span>
          <span><IconSparkles size={14} stroke={1.9} />{draft.generated ? "AI Generated" : "Existing context"}</span>
        </div>
        {editable && onTitleChange ? (
          <>
            <textarea
              aria-describedby={hasInvalidTitle ? `${draft.id}-case-title-error` : undefined}
              aria-invalid={hasInvalidTitle || undefined}
              aria-label="Test case title"
              className="story-studio-inspector__title-input"
              maxLength={255}
              onChange={(event) => onTitleChange(event.target.value)}
              rows={draft.title.length > 50 ? 2 : 1}
              value={draft.title}
            />
            {hasInvalidTitle ? (
              <small className="story-studio-inspector__title-error" id={`${draft.id}-case-title-error`} role="alert">
                Enter a test case title between 1 and 255 characters.
              </small>
            ) : null}
          </>
        ) : <h1>{draft.title}</h1>}
      </header>

      <section className="story-studio-card story-studio-description-card test-case-studio-description-card">
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
            aria-label="Test case description"
            onChange={(event) => onDescriptionChange?.(event.target.value)}
            placeholder="No description has been added yet."
            readOnly={!editable}
            ref={descriptionRef}
            rows={Math.max(3, Math.min(8, Math.ceil((draft.description.length || 80) / 90)))}
            value={draft.description}
          />
          {draft.summary ? <p className="test-case-studio-summary">{draft.summary}</p> : null}
        </div>
      </section>

      <section className="story-studio-card story-studio-properties-card test-case-studio-properties-card">
        <div className="story-studio-card__section-heading">
          <h2>Test case properties</h2>
          <span>{draft.generated ? "Generated values stay editable until you accept the draft." : "Preloaded from the selected reusable test case."}</span>
        </div>
        <dl>
          <div>
            <dt>Priority</dt>
            <dd>{editable && onPriorityChange ? (
              <select aria-label="Test case priority" onChange={(event) => onPriorityChange(Number(event.target.value))} value={draft.priority || 3}>
                {[1, 2, 3, 4, 5].map((priority) => <option key={priority} value={priority}>P{priority}</option>)}
              </select>
            ) : `P${propertyValue(draft.priority || 3)}`}</dd>
          </div>
          <div><dt>Status</dt><dd>{propertyValue(draft.status || (draft.generated ? "Draft" : null))}</dd></div>
          <div><dt>Automation</dt><dd>{draft.automated === "yes" ? "Automated" : draft.automated === "no" ? "Manual" : "Not set"}</dd></div>
          <div><dt>Steps</dt><dd>{draft.steps.length}</dd></div>
        </dl>
      </section>

      {requirements.length || draft.requirementTitles?.length ? (
        <section className="story-studio-card test-case-studio-mapping-card">
          <div className="story-studio-card__section-heading">
            <h2><IconChecklist size={20} stroke={1.9} />Story mapping</h2>
            <span>Keep every generated case traceable to the Jira Story evidence it covers.</span>
          </div>
          <div className="test-case-studio-mapping-list">
            {requirements.length ? requirements.map((requirement) => {
              const isSelected = (draft.requirementIds || []).includes(requirement.id);
              return (
                <button
                  aria-pressed={isSelected}
                  className={isSelected ? "test-case-studio-mapping-chip is-selected" : "test-case-studio-mapping-chip"}
                  disabled={!editable || !onRequirementToggle}
                  key={requirement.id}
                  onClick={() => onRequirementToggle?.(requirement.id)}
                  type="button"
                >
                  {requirement.title}
                </button>
              );
            }) : draft.requirementTitles?.map((title) => (
              <span className="test-case-studio-mapping-chip is-selected" key={title}>{title}</span>
            ))}
          </div>
        </section>
      ) : null}

      <section className="story-studio-card test-case-studio-steps-card">
        <div className="story-studio-card__section-heading test-case-studio-section-heading">
          <div>
            <h2><IconChecklist size={20} stroke={1.9} />Test steps</h2>
            <span>{draft.steps.length} reviewable step{draft.steps.length === 1 ? "" : "s"} with expected evidence.</span>
          </div>
          {editable && onStepsChange ? (
            <button
              className="story-studio-inline-action"
              onClick={() => onStepsChange([...draft.steps, { stepOrder: draft.steps.length + 1, stepType: "web", action: "", expectedResult: "" }])}
              type="button"
            >
              <IconPlus size={15} stroke={2} />Add step
            </button>
          ) : null}
        </div>
        <div className="test-case-studio-step-list">
          {draft.steps.map((step, index) => (
            <article className="test-case-studio-step" key={`${draft.id}-step-${index}`}>
              <div className="test-case-studio-step__heading">
                <strong>Step {index + 1}</strong>
                {editable && onStepChange ? (
                  <select
                    aria-label={`Step ${index + 1} type`}
                    onChange={(event) => onStepChange(index, { ...step, stepType: event.target.value as TestCaseAiStudioStep["stepType"] })}
                    value={step.stepType || "web"}
                  >
                    <option value="web">Web</option>
                    <option value="api">API</option>
                    <option value="android">Android</option>
                    <option value="ios">iOS</option>
                  </select>
                ) : <span>{String(step.stepType || "web").toUpperCase()}</span>}
                {editable && onStepsChange ? (
                  <button
                    aria-label={`Remove step ${index + 1}`}
                    className="test-case-studio-step__remove"
                    onClick={() => onStepsChange(draft.steps.filter((_, itemIndex) => itemIndex !== index).map((item, itemIndex) => ({ ...item, stepOrder: itemIndex + 1 })))}
                    type="button"
                  >
                    <IconTrash size={15} stroke={1.9} />
                  </button>
                ) : null}
              </div>
              <div className="test-case-studio-step__body">
                <div>
                  <small>Action</small>
                  {editable && onStepChange ? (
                    <textarea
                      aria-label={`Step ${index + 1} action`}
                      onChange={(event) => onStepChange(index, { ...step, action: event.target.value })}
                      placeholder="Describe the user or system action"
                      rows={Math.max(2, Math.min(5, Math.ceil((step.action.length || 60) / 72)))}
                      value={step.action}
                    />
                  ) : (
                    <StepParameterizedText fallback="No action" text={step.action} values={normalizedParameters} />
                  )}
                </div>
                <div>
                  <small>Expected result</small>
                  {editable && onStepChange ? (
                    <textarea
                      aria-label={`Step ${index + 1} expected result`}
                      onChange={(event) => onStepChange(index, { ...step, expectedResult: event.target.value })}
                      placeholder="Describe the observable expected result"
                      rows={Math.max(2, Math.min(5, Math.ceil((step.expectedResult.length || 60) / 72)))}
                      value={step.expectedResult}
                    />
                  ) : (
                    <StepParameterizedText fallback="No expected result" text={step.expectedResult} values={normalizedParameters} />
                  )}
                </div>
              </div>
            </article>
          ))}
          {!draft.steps.length ? <div className="test-case-studio-card-empty">No test steps are available in this draft.</div> : null}
        </div>
      </section>

      <section className="story-studio-card test-case-studio-data-card">
        <div className="story-studio-card__section-heading">
          <h2>Reusable test data</h2>
          <span>Parameter declarations stay visible beside every generated step that consumes them.</span>
        </div>
        {parameterEntries.length ? (
          <dl>
            {parameterEntries.map(([key, value]) => (
              <div key={key}><dt>{`@t.${key}`}</dt><dd>{value || "Empty declaration"}</dd></div>
            ))}
          </dl>
        ) : <div className="test-case-studio-card-empty">No reusable test data is proposed for this draft.</div>}
      </section>

      {extraContent ? <div className="test-case-studio-extra">{extraContent}</div> : null}

      {!draft.generated && onOpenExisting ? (
        <button className="test-case-studio-open-existing" onClick={onOpenExisting} type="button">Open full test case details</button>
      ) : null}
    </div>
  );
}
