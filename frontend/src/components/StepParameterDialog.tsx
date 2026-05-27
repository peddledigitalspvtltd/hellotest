import { useState, type ReactNode } from "react";
import { FormField } from "./FormField";
import type { StepParameterDefinition } from "../lib/stepParameters";
import { evaluateTestDataTemplate, TEST_DATA_GENERATOR_TEMPLATES } from "../lib/testDataGenerators";

type StepParameterDialogInputState = {
  disabled?: boolean;
  hint?: string;
  placeholder?: string;
};

function StepParameterUtilityIcon() {
  return (
    <svg aria-hidden="true" fill="none" height="15" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" viewBox="0 0 24 24" width="15">
      <path d="M12 3v3" />
      <path d="M12 18v3" />
      <path d="m4.8 7.8 2.1 2.1" />
      <path d="m17.1 14.1 2.1 2.1" />
      <path d="M3 12h3" />
      <path d="M18 12h3" />
      <path d="m4.8 16.2 2.1-2.1" />
      <path d="m17.1 9.9 2.1-2.1" />
      <circle cx="12" cy="12" r="4.25" />
    </svg>
  );
}

export function StepParameterDialog({
  title,
  subtitle,
  parameters,
  values,
  onChange,
  onClose,
  headerContent,
  getInputState
}: {
  title: string;
  subtitle: string;
  parameters: StepParameterDefinition[];
  values: Record<string, string>;
  onChange: (name: string, value: string) => void;
  onClose: () => void;
  headerContent?: ReactNode;
  getInputState?: (parameter: StepParameterDefinition) => StepParameterDialogInputState;
}) {
  const groupedParameters = [
    {
      scope: "t",
      title: "Test case data",
      items: parameters.filter((parameter) => parameter.scope === "t")
    },
    {
      scope: "s",
      title: "Suite-shared data",
      items: parameters.filter((parameter) => parameter.scope === "s")
    },
    {
      scope: "r",
      title: "Run data",
      items: parameters.filter((parameter) => parameter.scope === "r")
    }
  ].filter((group) => group.items.length);
  const parameterCount = parameters.length;
  const [activeUtilityParameter, setActiveUtilityParameter] = useState("");
  const [utilityDrafts, setUtilityDrafts] = useState<Record<string, string>>({});
  const [utilityFeedbackByParameter, setUtilityFeedbackByParameter] = useState<Record<string, string>>({});

  const toggleUtilityBuilder = (parameterName: string) => {
    const nextValue = activeUtilityParameter === parameterName ? "" : parameterName;

    if (nextValue) {
      setUtilityDrafts((currentDrafts) =>
        Object.prototype.hasOwnProperty.call(currentDrafts, parameterName)
          ? currentDrafts
          : { ...currentDrafts, [parameterName]: values[parameterName] || "" }
      );
    }

    setActiveUtilityParameter(nextValue);
  };

  const appendUtilityToken = (parameterName: string, token: string) => {
    setUtilityDrafts((currentDrafts) => ({
      ...currentDrafts,
      [parameterName]: `${currentDrafts[parameterName] || values[parameterName] || ""}${token}`
    }));
    setUtilityFeedbackByParameter((current) => ({
      ...current,
      [parameterName]: ""
    }));
  };

  const applyUtilityTemplate = (parameterName: string) => {
    const template = utilityDrafts[parameterName] || "";
    const sampleValue = evaluateTestDataTemplate(template);

    onChange(parameterName, template);
    setUtilityFeedbackByParameter((current) => ({
      ...current,
      [parameterName]: sampleValue
        ? `Template saved. Example for a new run: ${sampleValue}`
        : "Saved an empty generator template."
    }));
  };

  return (
    <div className="modal-backdrop modal-backdrop--scroll" onClick={onClose} role="presentation">
      <div
        aria-label={title}
        aria-modal="true"
        className="modal-card suite-create-modal step-parameter-dialog"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
      >
        <div className="suite-create-header step-parameter-dialog-header">
          <div className="suite-create-title">
            <p className="eyebrow">Test data</p>
            <h3>{title}</h3>
            <p>{subtitle}</p>
          </div>
          <div className="step-parameter-dialog-head-meta">
            <span className="count-pill">{parameterCount} field{parameterCount === 1 ? "" : "s"}</span>
            <button className="ghost-button" onClick={onClose} type="button">
              Close
            </button>
          </div>
        </div>

        <div className="step-parameter-dialog-body">
          {headerContent ? <div className="step-parameter-dialog-header-slot">{headerContent}</div> : null}
          {parameters.length ? (
            <div className="step-parameter-list">
              {groupedParameters.map((group) => (
                <section className="step-parameter-group" key={group.scope}>
                  <div className="step-parameter-group-head">
                    <strong>{group.title}</strong>
                    <span>{group.items.length} item{group.items.length === 1 ? "" : "s"}</span>
                  </div>
                  {group.items.map((parameter) => {
                    const inputState = getInputState?.(parameter) || {};

                    return (
                      <div className="step-parameter-row" key={parameter.name}>
                        <FormField
                          label={parameter.token}
                          hint={[
                            `${parameter.occurrenceCount} mention${parameter.occurrenceCount === 1 ? "" : "s"} across ${parameter.stepIds.length} step${parameter.stepIds.length === 1 ? "" : "s"}.`,
                            inputState.hint || ""
                          ].filter(Boolean).join(" ")}
                        >
                          <div className="step-parameter-input-row">
                            <input
                              disabled={inputState.disabled}
                              placeholder={inputState.placeholder || `Value for ${parameter.token}`}
                              value={values[parameter.name] || ""}
                              onChange={(event) => onChange(parameter.name, event.target.value)}
                            />
                            <button
                              aria-label={`Open utility generator for ${parameter.token}`}
                              className={activeUtilityParameter === parameter.name ? "step-parameter-utility-trigger is-active" : "step-parameter-utility-trigger"}
                              disabled={inputState.disabled}
                              onClick={() => toggleUtilityBuilder(parameter.name)}
                              title="Open generation utilities"
                              type="button"
                            >
                              <StepParameterUtilityIcon />
                            </button>
                          </div>
                          {activeUtilityParameter === parameter.name ? (
                            <div className="step-parameter-utility-panel">
                              <div className="step-parameter-utility-actions">
                                <button className="ghost-button" onClick={() => appendUtilityToken(parameter.name, TEST_DATA_GENERATOR_TEMPLATES.randomNumber)} type="button">
                                  Random number
                                </button>
                                <button className="ghost-button" onClick={() => appendUtilityToken(parameter.name, TEST_DATA_GENERATOR_TEMPLATES.randomString)} type="button">
                                  Random string
                                </button>
                                <button className="ghost-button" onClick={() => appendUtilityToken(parameter.name, TEST_DATA_GENERATOR_TEMPLATES.yopmail)} type="button">
                                  Yopmail email
                                </button>
                                <button className="ghost-button" onClick={() => appendUtilityToken(parameter.name, TEST_DATA_GENERATOR_TEMPLATES.date)} type="button">
                                  Today
                                </button>
                                <button className="ghost-button" onClick={() => appendUtilityToken(parameter.name, TEST_DATA_GENERATOR_TEMPLATES.tomorrow)} type="button">
                                  Tomorrow
                                </button>
                              </div>
                              <textarea
                                className="step-parameter-utility-template"
                                onChange={(event) => {
                                  const nextValue = event.target.value;
                                  setUtilityDrafts((currentDrafts) => ({
                                    ...currentDrafts,
                                    [parameter.name]: nextValue
                                  }));
                                  setUtilityFeedbackByParameter((current) => ({
                                    ...current,
                                    [parameter.name]: ""
                                  }));
                                }}
                                placeholder="Example: ORD-{{randomNumber:6}}-{{date:YYYYMMDD}}"
                                rows={3}
                                value={utilityDrafts[parameter.name] || ""}
                              />
                              <div className="step-parameter-utility-footer">
                                <span>
                                  Templates are resolved freshly for every run and rerun. Use <code>{"{{yopmail}}"}</code>, <code>{"{{date:YYYY-MM-DD|+1d}}"}</code>, <code>{"{{randomNumber:6}}"}</code>, or <code>{"{{randomString:8}}"}</code>.
                                </span>
                                <button className="primary-button" onClick={() => applyUtilityTemplate(parameter.name)} type="button">
                                  Save template
                                </button>
                              </div>
                              {utilityFeedbackByParameter[parameter.name] ? (
                                <span className="step-parameter-utility-feedback">{utilityFeedbackByParameter[parameter.name]}</span>
                              ) : null}
                            </div>
                          ) : null}
                        </FormField>
                      </div>
                    );
                  })}
                </section>
              ))}
            </div>
          ) : (
            <div className="empty-state compact">No `@params` detected in these steps yet.</div>
          )}
        </div>

        <div className="step-parameter-dialog-footer">
          <span>
            {parameterCount
              ? `${parameterCount} detected field${parameterCount === 1 ? "" : "s"} stay scoped to this case, suite, or run context.`
              : "Detected params will appear here once steps reference @tokens."}
          </span>
          <button className="ghost-button" onClick={onClose} type="button">
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
