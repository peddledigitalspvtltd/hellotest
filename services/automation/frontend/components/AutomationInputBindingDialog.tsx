import { useMemo, useState } from "react";
import type { TestStep } from "@hellotest/platform/frontend/src/types";
import type { StepParameterDefinition } from "@hellotest/platform/frontend/src/shared/lib/stepParameters";
import { useDialogFocus } from "@hellotest/platform/frontend/src/shared/hooks/useDialogFocus";
import { DialogCloseButton } from "@hellotest/platform/frontend/src/shared/components/DialogCloseButton";
import { collectAutomationInputBindings, suggestedAutomationInputBindings } from "../lib/automationInputBindings";

export function AutomationInputBindingDialog({ step, parameters, values, privateNames, onClose, onApply }: {
  step: TestStep; parameters: StepParameterDefinition[]; values: Record<string, string>; privateNames: Set<string>;
  onClose: () => void; onApply: (selections: Record<string, string>) => void;
}) {
  const dialog = useDialogFocus<HTMLDivElement>({ onClose });
  const inputs = useMemo(() => collectAutomationInputBindings(step), [step]);
  const [selections, setSelections] = useState(() => suggestedAutomationInputBindings(inputs, values));
  const hasSelection = Object.values(selections).some(Boolean);
  return <div className="modal-backdrop modal-backdrop--scroll" onClick={onClose} role="presentation">
    <div className="modal-card step-parameter-dialog" role="dialog" aria-modal="true" aria-label="Bind instruction inputs to parameters" onClick={event => event.stopPropagation()} ref={dialog} tabIndex={-1}>
      <div className="suite-create-header"><h2>Bind instruction inputs to parameters</h2><DialogCloseButton onClick={onClose} label="Close input bindings" /></div>
      <div className="step-parameter-dialog-body">
        <p>Choose parameters for the inputs below. Instructions, Source and Gherkin will use the same saved bindings. Save the section to apply your changes.</p>
        {!parameters.length ? <p>Add parameters in Test Params before binding these inputs.</p> : null}
        {inputs.map((input, index) => {
          const privateValue = [...privateNames].some(name => values[name] && values[name] === input.value);
          return <div className="step-parameter-row" key={input.id}>
            <strong>{index + 1}. {input.label}</strong>
            <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", maxWidth: "100%" }}>{privateValue ? "Hidden value" : input.value.length > 140 ? input.value.slice(0, 140) + "…" : input.value || "(empty)"}</pre>
            <label className="form-field"><span>Parameter for input {index + 1}</span><select aria-label={`Parameter for input ${index + 1}`} value={selections[input.id] || ""} onChange={event => setSelections(current => ({ ...current, [input.id]: event.target.value }))}>
              <option value="">Keep current input</option>
              {parameters.map(parameter => <option key={parameter.name} value={parameter.token}>{parameter.token}{parameter.sensitive ? " · Secret" : ""}</option>)}
            </select></label>
          </div>;
        })}
        {!inputs.length ? <p>No literal inputs are available in this section. Calculated values and existing parameter expressions remain in Source.</p> : null}
      </div>
      <div className="modal-footer"><button className="ghost-button" onClick={onClose} type="button">Cancel</button><button className="primary-button" disabled={!hasSelection} onClick={() => onApply(selections)} type="button">Apply parameter bindings</button></div>
    </div>
  </div>;
}
