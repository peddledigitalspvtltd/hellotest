import { useMemo } from "react";
import { AddIcon, TrashIcon } from "./AppIcons";
import { GherkinStepTextField } from "./GherkinStepTextField";
import { composeSharedStepGherkin, parseSharedStepGherkin, SHARED_GHERKIN_KEYWORDS, type SharedGherkinKeyword, type SharedGherkinStep } from "../lib/gherkin";
import type { StepParameterDefinition } from "../lib/stepParameters";

const normalizeKeyword = (value: string): SharedGherkinKeyword =>
  SHARED_GHERKIN_KEYWORDS.find((keyword) => keyword.toLowerCase() === value.toLowerCase()) || "And";

const starterSteps = (): SharedGherkinStep[] => [
  { keyword: "Given", text: "" },
  { keyword: "When", text: "" },
  { keyword: "Then", text: "" }
];

export function SharedStepGherkinEditor({
  availableParameters,
  groupName,
  onChange,
  onManageParameters,
  parameterValues,
  value
}: {
  availableParameters?: StepParameterDefinition[];
  groupName: string;
  onChange: (value: string) => void;
  onManageParameters?: () => void;
  parameterValues?: Record<string, string>;
  value: string;
}) {
  const parsedSteps = useMemo(() => parseSharedStepGherkin(value), [value]);
  const steps = parsedSteps.length ? parsedSteps : starterSteps();

  const commit = (nextSteps: SharedGherkinStep[]) => onChange(composeSharedStepGherkin(nextSteps));
  const updateStep = (index: number, input: Partial<SharedGherkinStep>) => {
    commit(steps.map((step, currentIndex) => currentIndex === index ? { ...step, ...input } : step));
  };
  const addStep = () => {
    const lastKeyword = steps[steps.length - 1]?.keyword;
    const keyword: SharedGherkinKeyword = !steps.length ? "Given" : lastKeyword === "When" ? "Then" : "And";
    commit([...steps, { keyword, text: "" }]);
  };
  const insertStepAfter = (index: number) => {
    const nextSteps = [...steps];
    const keyword: SharedGherkinKeyword = steps[index]?.keyword === "When" ? "Then" : "And";
    nextSteps.splice(index + 1, 0, { keyword, text: "" });
    commit(nextSteps);
  };
  const moveStep = (index: number, direction: -1 | 1) => {
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= steps.length) return;
    const nextSteps = [...steps];
    const [step] = nextSteps.splice(index, 1);
    nextSteps.splice(nextIndex, 0, step);
    commit(nextSteps);
  };

  return (
    <section aria-label="Shared Step Group Gherkin steps" className="shared-gherkin-step-group is-document-layout">
      <header className="shared-gherkin-step-group-head">
        <div className="shared-gherkin-document-heading">
          <strong>{groupName.trim() || "Reusable behavior group"}</strong>
        </div>
        <div className="shared-gherkin-step-group-head-actions">
          {onManageParameters ? <button className="ghost-button compact" onClick={onManageParameters} type="button">Manage parameter values</button> : null}
        </div>
      </header>

      <div className="shared-gherkin-step-list">
        {steps.map((step, index) => {
          const keywordTone = step.keyword.toLowerCase();

          return (
            <article className="shared-gherkin-step-row gherkin-minimal-step" key={`${index}-${step.keyword}`}>
              <label className={`shared-gherkin-keyword is-${keywordTone}`}>
                <span className="sr-only">Keyword for step {index + 1}</span>
                <select
                  aria-label={`Gherkin keyword for shared step ${index + 1}`}
                  onChange={(event) => updateStep(index, { keyword: normalizeKeyword(event.target.value) })}
                  value={step.keyword}
                >
                  {SHARED_GHERKIN_KEYWORDS.map((keyword) => <option key={keyword} value={keyword}>{keyword}</option>)}
                </select>
              </label>
              <div className="shared-gherkin-step-description">
                <GherkinStepTextField
                  ariaLabel={`Shared Gherkin step ${index + 1}`}
                  availableParameters={availableParameters}
                  onChange={(text) => updateStep(index, { text })}
                  parameterValues={parameterValues}
                  placeholder={step.keyword === "Given" ? "the reusable setup, including @t.parameters" : step.keyword === "Then" ? "the expected reusable outcome" : "the reusable action"}
                  value={step.text}
                />
                {step.argument ? <pre className="gherkin-step-argument">{step.argument}</pre> : null}
              </div>
              <div className="shared-gherkin-step-actions">
                <button aria-label={`Insert shared Gherkin step after ${index + 1}`} className="ghost-button compact" onClick={() => insertStepAfter(index)} title="Insert behavior step" type="button"><AddIcon size={13} /></button>
                <button aria-label={`Move shared Gherkin step ${index + 1} up`} className="ghost-button compact" disabled={index === 0} onClick={() => moveStep(index, -1)} title="Move up" type="button">↑</button>
                <button aria-label={`Move shared Gherkin step ${index + 1} down`} className="ghost-button compact" disabled={index === steps.length - 1} onClick={() => moveStep(index, 1)} title="Move down" type="button">↓</button>
                <button aria-label={`Remove shared Gherkin step ${index + 1}`} className="ghost-button compact danger" disabled={steps.length === 1} onClick={() => commit(steps.filter((_, currentIndex) => currentIndex !== index))} title="Remove step" type="button"><TrashIcon size={14} /></button>
              </div>
            </article>
          );
        })}
      </div>

      <button className="ghost-button shared-gherkin-add-step" onClick={addStep} type="button"><AddIcon size={15} />Add behavior step</button>
    </section>
  );
}
