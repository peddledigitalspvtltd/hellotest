import { useState } from "react";
import { StepParameterDialog } from "@hellotest/testing/frontend/components/StepParameterDialog";
import { automationBuildParameterOverrides, automationBuildParameterReview, isPrivateBuildParameterName, type AutomationBuildParameterPlan } from "../lib/automationBuildParameters";

export function AutomationBuildParameterDialog({ plan, caseTitle, onContinue, onClose }: {
  plan: AutomationBuildParameterPlan; caseTitle: string;
  onContinue: (values: Record<string, string>) => void; onClose: () => void;
}) {
  const [edits, setEdits] = useState<Record<string, string>>({});
  const { definitions, values, missingNames, emptyNames, unsetNames, privateNames, deferredNames } = automationBuildParameterReview(plan);
  const blankCount = [...unsetNames].filter(name => !Object.prototype.hasOwnProperty.call(edits, name) || edits[name] === "").length;
  return <StepParameterDialog title="Review automation test data" subtitle={caseTitle}
    allowSensitiveValueOverrides inheritedParameterNames={plan.parameter_references.filter(name => !missingNames.has(name))}
    parameters={definitions} values={{ ...values, ...edits }} defaultValues={values} overrideValues={edits} overrideLabel="Build override" resetLabel="Restore configured value"
    onChange={(name, value) => setEdits(current => ({ ...current, [name]: value }))}
    onReset={name => setEdits(current => { const next = { ...current }; delete next[name]; return next; })}
    onClose={onClose}
    getInputState={parameter => deferredNames.has(parameter.name)
      ? { disabled: true, placeholder: "Generated when this build starts", hint: "The configured generator is resolved once and shared by the agent and browser." }
      : { inputType: privateNames.has(parameter.name) || isPrivateBuildParameterName(parameter.name) ? "password" : "text",
          hint: missingNames.has(parameter.name) ? "No configured value. Enter a value or deliberately continue with an empty string."
            : emptyNames.has(parameter.name) ? "The configured value is empty. Enter a value or deliberately keep an empty string."
              : "This configured default stays inherited unless you edit it." }}
    headerContent={<div className="step-parameter-dialog-context-card"><strong>Values for this build</strong>
      <span>Review unset parameters before starting. Blank fields use empty strings for one case. Changed inputs save as automation overrides with accepted sections. The agent and browser use the same resolved data; manual defaults stay linked.</span>
    </div>}
    footerContent={<><button className="ghost-button" onClick={onClose} type="button">Cancel build</button>
      <button className="primary-button" onClick={() => onContinue(automationBuildParameterOverrides(plan, edits))} type="button">
        {blankCount ? `Continue with ${blankCount} blank value${blankCount === 1 ? "" : "s"}` : "Continue build"}
      </button></>}
  />;
}
