import { useMemo } from "react";
import { AddIcon, TrashIcon } from "./AppIcons";
import { StepParameterizedText } from "./StepParameterizedText";
import { extractStepParameterMatches } from "../lib/stepParameters";

type SharedGherkinKeyword = "Given" | "When" | "Then" | "And" | "But";

type SharedGherkinStep = {
  keyword: SharedGherkinKeyword;
  text: string;
};

const SHARED_GHERKIN_KEYWORDS: SharedGherkinKeyword[] = ["Given", "When", "Then", "And", "But"];
const SHARED_GHERKIN_STEP_PATTERN = /^\s*(Given|When|Then|And|But)\s*(.*)$/i;

const normalizeKeyword = (value: string): SharedGherkinKeyword =>
  SHARED_GHERKIN_KEYWORDS.find((keyword) => keyword.toLowerCase() === value.toLowerCase()) || "And";

export function parseSharedStepGherkin(value: string): SharedGherkinStep[] {
  return String(value || "")
    .split(/\r?\n/)
    .map((line) => line.match(SHARED_GHERKIN_STEP_PATTERN))
    .filter((match): match is RegExpMatchArray => Boolean(match))
    .map((match) => ({ keyword: normalizeKeyword(match[1]), text: match[2] || "" }));
}

export function composeSharedStepGherkin(groupName: string, steps: SharedGherkinStep[]) {
  const name = groupName.trim().replace(/\s+/g, " ") || "Reusable step group";
  return [
    `Feature: ${name}`,
    "",
    `  Scenario: ${name}`,
    ...steps.map((step) => `    ${step.keyword} ${step.text}`.trimEnd())
  ].join("\n");
}

const starterSteps = (): SharedGherkinStep[] => [
  { keyword: "Given", text: "" },
  { keyword: "When", text: "" },
  { keyword: "Then", text: "" }
];

export function SharedStepGherkinEditor({
  groupName,
  onChange,
  onManageParameters,
  parameterValues,
  value
}: {
  groupName: string;
  onChange: (value: string) => void;
  onManageParameters?: () => void;
  parameterValues?: Record<string, string>;
  value: string;
}) {
  const parsedSteps = useMemo(() => parseSharedStepGherkin(value), [value]);
  const steps = parsedSteps.length ? parsedSteps : starterSteps();

  const commit = (nextSteps: SharedGherkinStep[]) => onChange(composeSharedStepGherkin(groupName, nextSteps));
  const updateStep = (index: number, input: Partial<SharedGherkinStep>) => {
    commit(steps.map((step, currentIndex) => currentIndex === index ? { ...step, ...input } : step));
  };
  const addStep = () => {
    const lastKeyword = steps[steps.length - 1]?.keyword;
    const keyword: SharedGherkinKeyword = !steps.length ? "Given" : lastKeyword === "When" ? "Then" : "And";
    commit([...steps, { keyword, text: "" }]);
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
    <section aria-label="Shared Step Group Gherkin steps" className="shared-gherkin-step-group">
      <header className="shared-gherkin-step-group-head">
        <div>
          <span>Reusable behavior group</span>
          <strong>{groupName.trim() || "Untitled Shared Step Group"}</strong>
          <p>Author only the reusable Given, When, and Then steps. HelloTest maintains the surrounding Gherkin document when the group is saved.</p>
        </div>
        <div className="shared-gherkin-step-group-head-actions">
          <span className="count-pill">{steps.length} step{steps.length === 1 ? "" : "s"}</span>
          {onManageParameters ? <button className="ghost-button compact" onClick={onManageParameters} type="button">Manage parameter values</button> : null}
        </div>
      </header>

      <div className="shared-gherkin-parameter-guide">
        <strong>Parameters</strong>
        <span>Insert <code>@t.name</code>, <code>@s.name</code>, or <code>@r.name</code>. Defined values are previewed directly below the step.</span>
      </div>

      <div className="shared-gherkin-step-list">
        {steps.map((step, index) => {
          const parameters = Array.from(
            new Map(extractStepParameterMatches(step.text).map((parameter) => [parameter.name, parameter])).values()
          );
          const keywordTone = step.keyword.toLowerCase();

          return (
            <article className="shared-gherkin-step-row" key={`${index}-${step.keyword}`}>
              <span className="shared-gherkin-step-number">{index + 1}</span>
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
              <div className="shared-gherkin-step-content">
                <input
                  aria-label={`Shared Gherkin step ${index + 1}`}
                  onChange={(event) => updateStep(index, { text: event.target.value })}
                  placeholder={step.keyword === "Given" ? "the reusable setup, including @t.parameters" : step.keyword === "Then" ? "the expected reusable outcome" : "the reusable action"}
                  value={step.text}
                />
                {step.text ? (
                  <div className="shared-gherkin-step-preview">
                    <span>Preview</span>
                    <StepParameterizedText text={step.text} values={parameterValues} />
                  </div>
                ) : null}
                {parameters.length ? (
                  <div aria-label={`Parameters used by shared step ${index + 1}`} className="shared-gherkin-parameter-values">
                    {parameters.map((parameter) => (
                      <span className={parameterValues?.[parameter.name] !== undefined ? "is-resolved" : "is-unresolved"} key={parameter.name}>
                        <code>{parameter.token}</code>
                        <strong>{parameterValues?.[parameter.name] || "Value not set"}</strong>
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>
              <div className="shared-gherkin-step-actions">
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
